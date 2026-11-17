// noise.dog /brown-noise: the player and the analytics behave exactly as they do everywhere else.
//
// Ticket: LIF-938 (bounded SEO test). Register: life-os/development/test-writing-policy.md.
// Drives the real documents in real Chromium through the shared visit harness
// (tests/support/visit.mjs): the page is served from the production origin by the nginx model in
// tests/support/serve.mjs, the REAL GoatCounter count.js records what it would send, the clock is
// simulated, and Web Audio state is the controlled seam. Nothing inside the page is mocked.
//
// Invariants protected (TS-4):
//   I-6  A direct visit to /brown-noise selects Deep Focus and does NOT start audio: playback needs
//        an explicit play gesture, and that gesture starts real audio. (Each row also asserts the
//        document is the route's own, so a green row means "the NEW page behaves", not "the
//        homepage fallback behaves".)
//   I-7  Every existing control keeps working on the new document, for every member of each input
//        class: all five presets (click and keyboard), the volume (?v= boundaries, slider, keys),
//        and the query forms the page already understands.
//   I-8  LIF-691 analytics are preserved on the route: a public visit sends its pageview under the
//        route's own path and only the two real events; ?internal=<tag> keeps EVERY hit under
//        internal/<tag>/ (malformed tags fail closed into internal/invalid/); nothing internal ever
//        appears on a public path.
//   I-9  LIF-745 craft survives on the new document: inline vector brand mark, 34px centred add
//        control, instant play/pause under reduced motion, About and byline separate, no extra labels.
//
// Red reasons at base (TS-2) and mutation controls (TS-3): see the tests-ready hand-off on LIF-938.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openVisit, budgetMs, ENGAGED_SECS, TOLERANCE_SECS } from './support/visit.mjs';
import { BROWN_NOISE_TITLE } from './support/brown-noise-contract.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

const PRESETS = [
  { index: 0, name: 'Deep Focus', slug: 'deep-focus', path: '/brown-noise' },
  { index: 1, name: 'Midnight Rain', slug: 'midnight-rain', path: '/midnight-rain' },
  { index: 2, name: 'Embers', slug: 'embers', path: '/embers' },
  { index: 3, name: 'Coastal Wind', slug: 'coastal-wind', path: '/coastal-wind' },
  { index: 4, name: 'Drift', slug: 'drift', path: '/drift' },
];

async function withVisit(opts, fn) {
  const visit = await openVisit(browser, opts);
  try {
    await fn(visit);
    assert.deepEqual(visit.pageErrors, [], 'the page must not throw');
  } finally {
    await visit.close();
  }
}

/** Load /brown-noise[query] and prove it is the route's own document, not the homepage fallback. */
async function openRoute(visit, query = '') {
  await visit.gotoPath(`/brown-noise${query}`);
  assert.equal(await visit.page.title(), BROWN_NOISE_TITLE, '/brown-noise must be served as its own document (title is the specified one)');
}

const snapshot = (page) => page.evaluate(() => ({
  name: document.getElementById('presetName').textContent,
  pressed: [...document.querySelectorAll('.preset-btn[data-preset-index]')].map((b) => [Number(b.dataset.presetIndex), b.getAttribute('aria-pressed'), b.classList.contains('active')]),
  path: location.pathname,
  search: location.search,
  volume: document.getElementById('volume').value,
  volPct: document.documentElement.style.getPropertyValue('--vol-pct'),
}));

const activeIndexes = (snap) => snap.pressed.filter(([, pressed]) => pressed === 'true').map(([i]) => i);

const BUDGET = budgetMs(5);

// ─── I-6: Deep Focus selected, no autoplay ──────────────────────────

describe('I-6: a direct visit to /brown-noise selects Deep Focus and stays silent until play', () => {
  it('AC3: Deep Focus is selected on arrival (name, the one pressed preset, URL unchanged)', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      const snap = await snapshot(visit.page);
      assert.equal(snap.name, 'Deep Focus');
      assert.deepEqual(activeIndexes(snap), [0], 'only the Deep Focus preset is pressed');
      assert.equal(snap.path, '/brown-noise', 'the URL stays on the route (no redirect, no rewrite to the homepage)');
    });
  });

  it('AC3: nothing plays without a gesture — no audio context running, play control unpressed, no audio_start, even after 30 s', { timeout: budgetMs(35) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.advance(30);
      assert.equal(await visit.uiPlaying(), false, 'the play button must not report playing');
      assert.equal(await visit.page.getAttribute('#playBtn', 'aria-label'), 'Play');
      const states = await visit.audioStates();
      assert.ok(!states.includes('running'), `no AudioContext may be running before the visitor presses play (got ${JSON.stringify(states)})`);
      assert.equal(visit.eventCount('audio_start'), 0, 'no audio_start without a gesture');
      assert.equal(visit.events().length, 0, 'no activation event of any kind without a gesture');
    });
  });

  it('AC3: nothing plays under an autoplay-permissive browser either, and ?v= does not turn playback on', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit, '?v=70');
      assert.equal(await visit.uiPlaying(), false);
      assert.ok(!(await visit.audioStates()).includes('running'));
    });
  });

  it('AC3/AC5: the explicit play gesture starts real audio on the route, once, and pause stops it', { timeout: budgetMs(10) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.clickPlay();
      assert.equal(await visit.uiPlaying(), true, 'play control reports playing after a real click');
      assert.ok((await visit.audioStates()).includes('running'), 'a real AudioContext is running after the click');
      assert.equal(visit.eventCount('audio_start'), 1, 'audio_start fires once when audio actually runs');
      await visit.clickPlay();
      assert.equal(await visit.uiPlaying(), false, 'pressing the control again pauses');
      assert.equal(visit.eventCount('audio_start'), 1, 'pause does not add audio_start');
    });
  });

  it('AC3: Space on the page plays and pauses on the route (keyboard control intact)', { timeout: budgetMs(10) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.pressSpace();
      assert.equal(await visit.uiPlaying(), true);
      await visit.pressSpace();
      assert.equal(await visit.uiPlaying(), false);
    });
  });
});

// ─── I-7: every existing control, every member of its class ─────────

describe('I-7: preset, volume and query controls all work on the route', () => {
  for (const target of PRESETS.filter((p) => p.index !== 0)) {
    it(`AC3: clicking ${target.name} on /brown-noise selects it and moves the URL to ${target.path}`, { timeout: BUDGET }, async () => {
      await withVisit({}, async (visit) => {
        await openRoute(visit);
        await visit.clickPreset(target.index);
        const snap = await snapshot(visit.page);
        assert.equal(snap.name, target.name);
        assert.deepEqual(activeIndexes(snap), [target.index]);
        assert.equal(snap.path, target.path);
      });
    });
  }

  it('AC3: arrow keys cycle presets from the route in both directions and wrap (Right: Midnight Rain; Left from Deep Focus: Drift)', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.nextPresetByKey();
      assert.equal((await snapshot(visit.page)).name, 'Midnight Rain');
      await visit.pressKey('ArrowLeft');
      const back = await snapshot(visit.page);
      assert.equal(back.name, 'Deep Focus');
      assert.equal(back.path, '/brown-noise', 'returning to Deep Focus puts the URL back on the route');
      await visit.pressKey('ArrowLeft');
      assert.equal((await snapshot(visit.page)).name, 'Drift', 'Left from the first preset wraps to the last');
    });
  });

  it('AC3: switching presets while playing keeps playing', { timeout: budgetMs(10) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.clickPlay();
      await visit.clickPreset(2);
      assert.equal(await visit.uiPlaying(), true);
      assert.equal((await snapshot(visit.page)).name, 'Embers');
      assert.equal(visit.eventCount('audio_start'), 1, 'a preset switch does not re-fire audio_start');
    });
  });

  for (const [query, expected] of [['', 50], ['?v=0', 0], ['?v=30', 30], ['?v=100', 100], ['?v=250', 100], ['?v=-5', 0]]) {
    it(`AC3: /brown-noise${query} starts with the volume at ${expected}`, { timeout: BUDGET }, async () => {
      await withVisit({}, async (visit) => {
        await openRoute(visit, query);
        const snap = await snapshot(visit.page);
        assert.equal(snap.volume, String(expected));
        assert.equal(snap.volPct, `${expected}%`);
        assert.equal(snap.name, 'Deep Focus');
      });
    });
  }

  it('AC3: the volume slider and the Up/Down keys change the volume on the route, and the URL tracks it', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.page.locator('#volume').fill('80');
      let snap = await snapshot(visit.page);
      assert.equal(snap.volume, '80');
      assert.equal(snap.volPct, '80%');
      assert.equal(new URLSearchParams(snap.search).get('v'), '80', 'the volume is carried in ?v=');
      await visit.pressKey('ArrowDown');
      snap = await snapshot(visit.page);
      assert.equal(snap.volume, '75');
      await visit.pressKey('ArrowUp');
      await visit.pressKey('ArrowUp');
      assert.equal((await snapshot(visit.page)).volume, '85');
    });
  });

  it('AC3: a volume change on the route does not start audio', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.page.locator('#volume').fill('20');
      assert.equal(await visit.uiPlaying(), false);
      assert.ok(!(await visit.audioStates()).includes('running'));
    });
  });

  // Query forms the page already understands. Control rows: they hold the existing precedence
  // (a path slug beats ?p=) on every document, so the new route cannot quietly change it.
  for (const [pathAndQuery, expected] of [
    ['/brown-noise?p=mr', 'Deep Focus'],
    ['/?p=mr', 'Midnight Rain'],
    ['/?p=df', 'Deep Focus'],
    ['/?p=cw', 'Coastal Wind'],
    ['/', 'Deep Focus'],
    ['/midnight-rain', 'Midnight Rain'],
    ['/drift?v=10', 'Drift'],
  ]) {
    it(`AC3 (control): ${pathAndQuery} selects ${expected}`, { timeout: BUDGET }, async () => {
      await withVisit({}, async (visit) => {
        await visit.gotoPath(pathAndQuery);
        assert.equal((await snapshot(visit.page)).name, expected);
      });
    });
  }
});

// ─── I-8: LIF-691 analytics on the route ────────────────────────────

describe('I-8: activation analytics are preserved on /brown-noise', () => {
  it('AC4: a public visit sends one pageview under the route\'s own path and nothing internal', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      const views = visit.beacons.filter((h) => !h.event);
      assert.deepEqual(views.map((h) => String(h.p).replace(/^\//, '')), ['brown-noise'], 'one pageview, attributed to /brown-noise (the page\'s canonical path), so the experiment page is countable apart from the homepage');
      assert.deepEqual(visit.beacons.filter((h) => /internal/i.test(String(h.p))), [], 'no internal beacon on a public path');
      assert.equal(visit.events().length, 0, 'no event beacons from merely opening the page');
    });
  });

  it('AC4: a public visit that plays sends audio_start then, after 10 audible minutes, engaged_10min — each once, on public paths', { timeout: budgetMs(ENGAGED_SECS + 20) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      await visit.clickPlay();
      assert.deepEqual(visit.events(), ['audio_start']);
      await visit.advance(ENGAGED_SECS + TOLERANCE_SECS);
      assert.deepEqual(visit.events(), ['audio_start', 'engaged_10min']);
      assert.deepEqual(visit.beacons.filter((h) => /internal/i.test(String(h.p))), [], 'a public visit never sends an internal/ path');
    });
  });

  it('AC4: ?internal=LIF-938 keeps EVERY hit under internal/LIF-938/ — pageview, audio_start and engaged_10min — and sends no public-path hit', { timeout: budgetMs(ENGAGED_SECS + 20) }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit, '?internal=LIF-938');
      await visit.clickPlay();
      await visit.advance(ENGAGED_SECS + TOLERANCE_SECS);
      const paths = visit.beacons.map((h) => String(h.p).replace(/^\//, ''));
      assert.ok(paths.length >= 3, `expected the pageview and two events (got ${JSON.stringify(paths)})`);
      assert.deepEqual(paths.filter((p) => !p.startsWith('internal/LIF-938/')), [], 'every hit from an internal visit is under internal/LIF-938/ (a public-path leak would pollute the D28 numerator and denominator)');
      assert.ok(paths.includes('internal/LIF-938/'), 'the pageview is sent under the internal prefix');
      assert.deepEqual(visit.events('internal/LIF-938/').sort(), ['internal/LIF-938/audio_start', 'internal/LIF-938/engaged_10min']);
    });
  });

  for (const bad of ['a/b', '', '..', 'x'.repeat(65), 'has space']) {
    it(`AC4: a malformed internal tag (${JSON.stringify(bad.length > 20 ? `${bad.slice(0, 8)}…(${bad.length})` : bad)}) fails closed into internal/invalid/ on the route`, { timeout: budgetMs(10) }, async () => {
      await withVisit({}, async (visit) => {
        await openRoute(visit, `?internal=${encodeURIComponent(bad)}`);
        await visit.clickPlay();
        const paths = visit.beacons.map((h) => String(h.p).replace(/^\//, ''));
        assert.ok(paths.length >= 2, `pageview and audio_start expected (got ${JSON.stringify(paths)})`);
        assert.deepEqual(paths.filter((p) => !p.startsWith('internal/invalid/')), [], `every hit goes under internal/invalid/ (got ${JSON.stringify(paths)})`);
      });
    });
  }

  it('AC4: a repeated internal tag also fails closed on the route', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit, '?internal=a&internal=b');
      const paths = visit.beacons.map((h) => String(h.p).replace(/^\//, ''));
      assert.ok(paths.length >= 1);
      assert.deepEqual(paths.filter((p) => !p.startsWith('internal/invalid/')), []);
    });
  });

  it('AC4: with count.js blocked the route still works and sends nothing', { timeout: BUDGET }, async () => {
    await withVisit({ blockCountJs: true }, async (visit) => {
      await openRoute(visit);
      await visit.clickPlay();
      assert.equal(await visit.uiPlaying(), true, 'playback is unaffected by analytics being unavailable');
      assert.equal(visit.beacons.length, 0);
    });
  });

  it('AC4: the homepage still sends its pageview under the homepage path, exactly as before', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await visit.gotoPath('/');
      const views = visit.beacons.filter((h) => !h.event);
      assert.deepEqual(views.map((h) => String(h.p).replace(/^\//, '')), [''], 'the homepage pageview stays attributed to /');
    });
  });
});

// ─── I-9: LIF-745 craft on the new document ─────────────────────────

describe('I-9: the LIF-745 craft fixes survive on /brown-noise', () => {
  it('AC4: the brand mark is the crisp inline vector dog in the brand gold, 28px', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      const mark = await visit.page.evaluate(() => {
        const el = document.querySelector('header.brand .brand-mark');
        const r = el && el.getBoundingClientRect();
        return el && {
          tag: el.localName, viewBox: el.getAttribute('viewBox'), w: r.width, h: r.height,
          images: document.querySelectorAll('header.brand img').length,
          gold: [...el.querySelectorAll('[fill],[stroke]')].some((n) => (n.getAttribute('fill') || n.getAttribute('stroke') || '').toLowerCase() === '#c8a96e'),
        };
      });
      assert.ok(mark, 'brand mark exists');
      assert.deepEqual([mark.tag, mark.viewBox, mark.images, mark.gold], ['svg', '0 0 100 100', 0, true]);
      assert.ok(Math.abs(mark.w - 28) <= 0.5 && Math.abs(mark.h - 28) <= 0.5, `28px box (got ${mark.w}x${mark.h})`);
    });
  });

  it('AC4: the add-preset control is a 34px circle with a centred vector plus', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      const geo = await visit.page.evaluate(() => {
        const btn = document.querySelector('#presetSelector .preset-btn-add');
        const svg = btn && btn.querySelector('svg');
        if (!btn || !svg) return null;
        const b = btn.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        return { w: b.width, h: b.height, dx: Math.abs(b.x + b.width / 2 - (s.x + s.width / 2)), dy: Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)), text: btn.textContent.trim(), viewBox: svg.getAttribute('viewBox') };
      });
      assert.ok(geo, 'add control with an inline svg exists');
      assert.ok(Math.abs(geo.w - 34) <= 0.5 && Math.abs(geo.h - 34) <= 0.5 && geo.dx <= 0.6 && geo.dy <= 0.6, `34px, centred (got ${JSON.stringify(geo)})`);
      assert.deepEqual([geo.text, geo.viewBox], ['', '0 0 14 14']);
    });
  });

  it('AC4: under prefers-reduced-motion the play/pause swap on the route is instant in both directions', { timeout: BUDGET }, async () => {
    await withVisit({ reducedMotion: 'reduce' }, async (visit) => {
      await openRoute(visit);
      await visit.page.locator('#playBtn').click();
      const icons = () => visit.page.evaluate(() => ({
        playDisplay: getComputedStyle(document.getElementById('iconPlay')).display,
        pauseDisplay: getComputedStyle(document.getElementById('iconPause')).display,
        pauseOpacity: getComputedStyle(document.getElementById('iconPause')).opacity,
      }));
      assert.deepEqual(await icons(), { playDisplay: 'none', pauseDisplay: 'block', pauseOpacity: '1' });
      await visit.page.locator('#playBtn').click();
      const paused = await icons();
      assert.equal(paused.playDisplay, 'block');
      assert.equal(paused.pauseDisplay, 'none');
    });
  });

  it('AC2/AC4: no new label or status text beside Play, About and fancyma.tt stay separate, favicons unchanged', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await openRoute(visit);
      const seen = await visit.page.evaluate(() => {
        const play = document.getElementById('playBtn');
        const pr = play.getBoundingClientRect();
        // Visible text anywhere in the player area (everything above the About disclosure).
        const about = document.querySelector('details.seo-about');
        const near = [...document.querySelectorAll('.layout *')]
          .filter((el) => !about.contains(el) && !el.children.length && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
          .map((el) => el.textContent.trim())
          .filter(Boolean);
        return {
          near,
          aboutSummary: about.querySelector('summary').textContent.trim(),
          bylineInsideAbout: !!document.querySelector('a.site-byline').closest('details.seo-about'),
          bylineHref: document.querySelector('a.site-byline').getAttribute('href'),
          icons: [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href')),
          playBox: [pr.width, pr.height],
        };
      });
      assert.deepEqual(seen.near.filter((t) => t !== 'Deep Focus' && !/^(Midnight Rain|Embers|Coastal Wind|Drift)$/.test(t)), [], 'player area text is only the preset names (no slogan, status or description beside Play)');
      assert.equal(seen.aboutSummary, 'About');
      assert.equal(seen.bylineInsideAbout, false);
      assert.equal(seen.bylineHref, 'https://fancyma.tt');
      assert.deepEqual(seen.icons, ['images/favicon-32.png', 'images/favicon-64.png', 'images/apple-touch-icon.png']);
    });
  });
});
