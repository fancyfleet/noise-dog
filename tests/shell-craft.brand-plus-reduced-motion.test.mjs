// noise.dog v2 craft fixes: crisp header logo, centred "+" control, reduced motion.
//
// Ticket: LIF-745 (apply-not-redesign of Penny's approved LIF-734-production.patch on main@c7eb949).
// Register: life-os/development/test-writing-policy.md.
//
// Executable specification of the ticket's captured AC, driving the real index.html in real
// Chromium through the shared visit harness (tests/support/visit.mjs — the reducedMotion option is
// a real emulated media setting, so window.matchMedia and the CSS media block both see it; nothing
// inside index.html is mocked or stubbed).
//
// Invariants protected (TS-4):
//   I-A The header brand mark is the crisp inline vector dog in the brand gold, in the same 28px
//       box — never the noisy multi-pixel site-mark.svg raster image.
//   I-B The add-preset control is a vector plus glyph centred in a true 34px circle (0px centre
//       offset on both axes) — never a text "+" sitting on the font baseline.
//   I-C Under prefers-reduced-motion: reduce the page is motionless and play/pause swaps
//       instantly; without it production's crossfade stays exactly as it is.
//   I-D Everything else stays exactly as production: analytics and favicon metadata, About and
//       fancyma.tt as separate elements, no "Vol" label, no playback status label, and no
//       horizontal overflow at either capture width.
//
// What the suite is deliberately not: the rendered-pixel gate. The AC's PNG comparisons against
// Penny's approved after-* captures (LIF-734 #18–#23, #11) are the review/evidence stage and need
// no source change to run; this suite pins the DOM/mechanism floor they will grade.
//
// Red reasons at the hand-off SHA (TS-2) and mutation controls (TS-3): see the tests-ready
// hand-off comment on LIF-745. Baseline attribution: 43/43 passing at main@c7eb949 before this
// file; the 43 must stay green through the implementer's `git am`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openVisit, budgetMs } from './support/visit.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function withVisit(opts, fn) {
  const visit = await openVisit(browser, opts);
  try {
    await fn(visit);
    assert.deepEqual(visit.pageErrors, [], 'the page must not throw');
  } finally {
    await visit.close();
  }
}

const rectOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, selector);

// ─── I-A: crisp header logo ─────────────────────────────────────────

describe('I-A: header brand mark is the crisp inline vector dog', () => {
  it('AC1: the brand mark is an inline <svg> with the production dog viewBox, and the site-mark raster is gone', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const mark = await visit.page.evaluate(() => {
        const el = document.querySelector('header.brand .brand-mark');
        if (!el) return { found: false };
        return {
          found: true,
          tag: el.localName,
          viewBox: el.getAttribute('viewBox'),
          rasterImages: document.querySelectorAll('header.brand img').length,
        };
      });
      assert.equal(mark.found, true, 'header.brand .brand-mark must exist');
      assert.equal(mark.tag, 'svg', `the brand mark must be an inline vector <svg> (a lazy swap keeps an <img>; found <${mark.tag}>)`);
      assert.equal(mark.viewBox, '0 0 100 100', 'the vector dog artwork must carry its viewBox so it scales crisply at any DPR');
      assert.equal(mark.rasterImages, 0, 'no <img> may remain in the brand header (the noisy site-mark.svg is replaced, not kept alongside)');
    });
  });

  it('AC1: the mark still renders in the same 28px box, drawn in the brand gold', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const box = await rectOf(visit.page, 'header.brand .brand-mark');
      assert.ok(box, 'the brand mark must be laid out');
      assert.ok(Math.abs(box.width - 28) <= 0.5 && Math.abs(box.height - 28) <= 0.5,
        `same 28px sizing as production (got ${box.width}×${box.height})`);
      const gold = await visit.page.evaluate(() => {
        const svg = document.querySelector('header.brand .brand-mark');
        return [...svg.querySelectorAll('[fill],[stroke]')].some((el) => {
          const v = (el.getAttribute('fill') || el.getAttribute('stroke') || '').toLowerCase();
          return v === '#c8a96e';
        });
      });
      assert.equal(gold, true, 'the dog artwork must be drawn in the brand gold #c8a96e (a different swapped-in artwork would miss this)');
    });
  });
});

// ─── I-B: centred "+" control ───────────────────────────────────────

describe('I-B: add-preset "+" is a vector glyph centred in a true 34px circle', () => {
  it('AC1: the control carries an inline 14px SVG plus and no text glyph', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const plus = await visit.page.evaluate(() => {
        const btn = document.querySelector('#presetSelector .preset-btn-add');
        if (!btn) return { found: false };
        const svg = btn.querySelector('svg');
        return {
          found: true,
          text: (btn.textContent || '').trim(),
          hasSvg: !!svg,
          viewBox: svg && svg.getAttribute('viewBox'),
        };
      });
      assert.equal(plus.found, true, '#presetSelector .preset-btn-add must exist');
      assert.equal(plus.text, '', `the control must not carry a text "+" (the old glyph sat on the font baseline; got "${plus.text}")`);
      assert.equal(plus.hasSvg, true, 'the plus must be an inline SVG, not a font glyph');
      assert.equal(plus.viewBox, '0 0 14 14', 'the plus vector must be the 14-unit approved artwork');
    });
  });

  it('AC1: the control is a true 34px circle with 0px centre offset on both axes', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const geo = await visit.page.evaluate(() => {
        const btn = document.querySelector('#presetSelector .preset-btn-add');
        if (!btn) return null;
        const b = btn.getBoundingClientRect();
        const svg = btn.querySelector('svg');
        const s = svg ? svg.getBoundingClientRect() : null;
        return {
          w: b.width, h: b.height,
          dx: s ? Math.abs((b.x + b.width / 2) - (s.x + s.width / 2)) : null,
          dy: s ? Math.abs((b.y + b.height / 2) - (s.y + s.height / 2)) : null,
        };
      });
      assert.ok(geo, 'the add control must exist');
      assert.ok(Math.abs(geo.w - 34) <= 0.5 && Math.abs(geo.h - 34) <= 0.5,
        `the control must be a true 34px box (got ${geo.w}×${geo.h}; the old padded text chip was wider and squat)`);
      assert.ok(geo.dx !== null && geo.dx <= 0.6 && geo.dy <= 0.6,
        `the glyph must be centred with 0px offset on both axes (got dx=${geo.dx}, dy=${geo.dy}; baseline text cannot centre)`);
    });
  });
});

// ─── I-C: reduced motion ────────────────────────────────────────────

describe('I-C: prefers-reduced-motion: reduce makes play/pause instant and the page motionless', () => {
  it('AC1/AC4: the play/pause icon swap is instant in both directions, with no crossfade timers', { timeout: budgetMs(5) }, async () => {
    await withVisit({ reducedMotion: 'reduce' }, async (visit) => {
      await visit.goto();
      // Press play: the pause icon must be fully shown on the same tick the click is handled.
      await visit.page.locator('#playBtn').click();
      const playing = await visit.page.evaluate(() => ({
        pauseDisplay: getComputedStyle(document.getElementById('iconPause')).display,
        pauseOpacity: getComputedStyle(document.getElementById('iconPause')).opacity,
        playDisplay: getComputedStyle(document.getElementById('iconPlay')).display,
        playOpacity: getComputedStyle(document.getElementById('iconPlay')).opacity,
      }));
      assert.deepEqual(playing, {
        pauseDisplay: 'block', pauseOpacity: '1',
        playDisplay: 'none', playOpacity: '0',
      }, `the swap to Pause must be instant under reduced motion (got ${JSON.stringify(playing)}; the production crossfade defers through setTimeout+rAF, so a deferred swap fails here while the frozen harness clock holds timers)`);
      // And back: pressing pause must restore the play icon instantly too.
      await visit.page.locator('#playBtn').click();
      const paused = await visit.page.evaluate(() => ({
        playDisplay: getComputedStyle(document.getElementById('iconPlay')).display,
        playOpacity: getComputedStyle(document.getElementById('iconPlay')).opacity,
        pauseDisplay: getComputedStyle(document.getElementById('iconPause')).display,
      }));
      assert.deepEqual(paused, {
        playDisplay: 'block', playOpacity: '1',
        pauseDisplay: 'none',
      }, `the swap back to Play must also be instant (got ${JSON.stringify(paused)})`);
    });
  });

  it('AC4: transitions and animations are disabled globally under reduce', { timeout: budgetMs(5) }, async () => {
    await withVisit({ reducedMotion: 'reduce' }, async (visit) => {
      await visit.goto();
      const motion = await visit.page.evaluate(() => {
        const dur = (sel) => getComputedStyle(document.querySelector(sel)).transitionDuration
          .split(',').map((s) => parseFloat(s));
        return {
          playBtn: dur('.play-btn'),
          customize: dur('.preset-customize-btn'),
          playAnim: getComputedStyle(document.querySelector('.play-btn')).animationName,
        };
      });
      // .play-btn and .preset-customize-btn carry plain (non-!important) production transitions,
      // so the reduce block's `transition: none !important` must zero them.
      assert.ok(motion.playBtn.every((d) => d === 0), `play button transitions must be 0s under reduce (got ${motion.playBtn})`);
      assert.ok(motion.customize.every((d) => d === 0), `customize chip transitions must be 0s under reduce (got ${motion.customize})`);
      assert.equal(motion.playAnim, 'none', 'no animation may run under reduce');
    });
  });

  it('guard/control: without reduced motion production keeps its crossfade (this is what the reduce branch must not change)', { timeout: budgetMs(10) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      await visit.clickPlay();
      const immediately = await visit.page.evaluate(() => getComputedStyle(document.getElementById('iconPause')).display);
      assert.equal(immediately, 'none', 'with motion allowed, the crossfade still hides the pause icon right after the click (the swap is deferred through its timer, not instant)');
      await visit.advance(0.6);
      const afterFade = await visit.page.evaluate(() => getComputedStyle(document.getElementById('iconPause')).display);
      assert.equal(afterFade, 'block', 'the crossfade completes once its timers run (the fade itself must survive this ticket in normal motion)');
    });
  });
});

// ─── I-D: stays exactly as production (supplementary regression pins) ──

// These pins are guards, not the acceptance mechanism: they hold the "nothing else changes"
// contract so a patch-applier cannot regress production metadata while fixing the three
// behaviours. The rendered-pixel gate (Penny's approved after-* captures) remains the final word.
describe('I-D: stays exactly as production (regression pins)', () => {
  it('analytics metadata is untouched', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const analytics = await visit.page.evaluate(() => {
        const s = document.querySelector('script[data-goatcounter]');
        return s ? { endpoint: s.dataset.goatcounter, src: s.getAttribute('src') } : null;
      });
      assert.deepEqual(analytics, {
        endpoint: 'https://fancymatt.goatcounter.com/count',
        src: '//gc.zgo.at/count.js',
      }, 'the GoatCounter analytics transport must stay exactly as production');
    });
  });

  it('favicon metadata is untouched', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const icons = await visit.page.evaluate(() => [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')]
        .map((l) => ({ rel: l.getAttribute('rel'), sizes: l.getAttribute('sizes'), href: l.getAttribute('href') })));
      assert.deepEqual(icons, [
        { rel: 'icon', sizes: '32x32', href: 'images/favicon-32.png' },
        { rel: 'icon', sizes: '64x64', href: 'images/favicon-64.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: 'images/apple-touch-icon.png' },
      ], 'the production favicon links must survive unchanged');
    });
  });

  it('About disclosure and the fancyma.tt byline stay separate elements', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const links = await visit.page.evaluate(() => {
        const about = document.querySelector('details.seo-about > summary');
        const byline = document.querySelector('a.site-byline');
        return {
          aboutText: about && about.textContent.trim(),
          bylineText: byline && byline.textContent.trim(),
          bylineHref: byline && byline.getAttribute('href'),
          bylineInsideAbout: !!(byline && byline.closest('details.seo-about')),
        };
      });
      assert.equal(links.aboutText, 'About', 'the About disclosure keeps its production summary');
      assert.equal(links.bylineText, 'fancyma.tt', 'the fancyma.tt byline keeps its production label');
      assert.equal(links.bylineHref, 'https://fancyma.tt', 'the byline keeps its production target');
      assert.equal(links.bylineInsideAbout, false, 'About and fancyma.tt stay as separate elements (v1 merged/absorbed them — rejected)');
    });
  });

  it('no "Vol" label and no playback status label appeared (v1 scope creep stays out)', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (visit) => {
      await visit.goto();
      const labels = await visit.page.evaluate(() => {
        const visibleLeafText = (el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          if (!el.getClientRects().length) return false;
          return true;
        };
        const bad = [...document.querySelectorAll('body *')]
          .filter((el) => !el.children.length && visibleLeafText(el))
          .map((el) => el.textContent.trim())
          .filter((t) => /^(vol|vol\.|playing|paused|now playing)$/i.test(t));
        const volLabel = document.querySelector('label.volume-label[for="volume"] .sr-only');
        return { bad, volumeLabel: volLabel && volLabel.textContent.trim() };
      });
      assert.deepEqual(labels.bad, [], `no visible "Vol" or playback-status label may exist (found: ${JSON.stringify(labels.bad)})`);
      assert.equal(labels.volumeLabel, 'Volume', 'the volume control keeps production\'s full (sr-only) Volume label');
    });
  });

  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    for (const page of ['', '?p=mr']) {
      it(`AC4: no horizontal overflow at ${width}×${height} on ${page || '/'} (midnight-rain served as ?p=mr by the harness)`, { timeout: budgetMs(5) }, async () => {
        await withVisit({}, async (visit) => {
          await visit.page.setViewportSize({ width, height });
          await visit.goto(page);
          const overflow = await visit.page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }));
          assert.ok(overflow.scroll <= overflow.client,
            `no horizontal overflow at ${width}×${height} (scrollWidth ${overflow.scroll} > clientWidth ${overflow.client})`);
        });
      });
    }
  }
});
