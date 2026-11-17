// noise.dog /brown-noise: the layout is the existing design, and the new copy and link fit it.
//
// Ticket: LIF-938 (bounded SEO test). Register: life-os/development/test-writing-policy.md.
// Real Chromium, real layout and hit-testing at desktop and mobile widths; nothing is stubbed.
// "Existing design is the contract" (AC2): the player must not move, the About disclosure keeps
// its existing styles, and anything that would need new layout goes to Laren, not into this PR.
//
// Invariants protected (TS-4):
//   I-10 The player is geometrically identical to the base page on the homepage and on the new
//        route, at every width class (desktop, phone, narrow phone): nothing shifts, nothing is added.
//   I-11 No horizontal overflow on either document, About closed or open, at every width class.
//   I-12 The longer About copy on the route is reachable and readable: inside the viewport, not
//        clipped, last paragraph scrollable into view and the topmost element at its centre.
//   I-13 The homepage link is a visible, hit-testable, keyboard-reachable part of the About copy in
//        the page's own type scale — not a browser-default blue link — and a real click lands on the route.
//
// Rendered/interactive surface: prototype-polish categories applied where relevant — hit-target
// boundaries (I-12/I-13 elementFromPoint), resize/safe-area (three widths, I-10/I-11), transient
// state (About open vs closed), click-through (a fixed control must not cover the last paragraph).
// Not applicable: gesture ownership, generated targets, coordinate transforms (no new gestures).
//
// Captures at desktop and mobile widths (AC5) are the evidence stage; this suite pins the numbers
// those captures will show.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openVisit, budgetMs } from './support/visit.mjs';
import { BROWN_NOISE_TITLE, HOME_LINK_TEXT, readBaseHome } from './support/brown-noise-contract.mjs';

let browser;
let baseHome;
before(async () => {
  browser = await launch();
  baseHome = await readBaseHome();
});
after(async () => { if (browser) await browser.close(); });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'narrow phone', width: 320, height: 568 },
];
const BUDGET = budgetMs(5);
const PLAYER_PARTS = ['header.brand', 'header.brand .brand-mark', '#presetName', '#presetSelector', '#playBtn', '#volume', 'details.seo-about > summary', 'a.site-byline'];

async function withVisit(opts, fn) {
  const visit = await openVisit(browser, opts);
  try {
    await fn(visit);
    assert.deepEqual(visit.pageErrors, [], 'the page must not throw');
  } finally {
    await visit.close();
  }
}

const rects = (page, selectors) => page.evaluate((sels) => Object.fromEntries(sels.map((s) => {
  const el = document.querySelector(s);
  if (!el) return [s, null];
  const r = el.getBoundingClientRect();
  return [s, [r.x, r.y + window.scrollY, r.width, r.height].map((n) => Math.round(n * 2) / 2)];
})), selectors);

const overflow = (page) => page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
  bodyScroll: document.body.scrollWidth,
}));

async function openAbout(page) {
  // The page clock is frozen by the harness, so requestAnimationFrame never fires: layout is read
  // synchronously by getBoundingClientRect, which forces it, and needs no frame to settle.
  await page.locator('details.seo-about > summary').click();
}

// ─── I-10: the player does not move ─────────────────────────────────

describe('I-10: the player is geometrically identical to the base page', () => {
  for (const vp of VIEWPORTS) {
    it(`AC2: homepage player parts sit exactly where the base page puts them (${vp.name} ${vp.width}×${vp.height}, About closed)`, { timeout: BUDGET }, async () => {
      let base;
      await withVisit({ viewport: vp, homepageBody: baseHome }, async (visit) => {
        await visit.gotoPath('/');
        base = await rects(visit.page, PLAYER_PARTS);
      });
      await withVisit({ viewport: vp }, async (visit) => {
        await visit.gotoPath('/');
        assert.deepEqual(await rects(visit.page, PLAYER_PARTS), base, 'the homepage player must not shift by even half a pixel (the added link lives inside the closed About)');
      });
    });

    it(`AC2/AC3: the /brown-noise player parts sit exactly where the homepage puts them (${vp.name} ${vp.width}×${vp.height}, About closed)`, { timeout: BUDGET }, async () => {
      let base;
      await withVisit({ viewport: vp, homepageBody: baseHome }, async (visit) => {
        await visit.gotoPath('/');
        base = await rects(visit.page, PLAYER_PARTS);
      });
      await withVisit({ viewport: vp }, async (visit) => {
        await visit.gotoPath('/brown-noise');
        assert.equal(await visit.page.title(), BROWN_NOISE_TITLE, 'the route is its own document');
        assert.deepEqual(await rects(visit.page, PLAYER_PARTS), base, 'no new slogan/status/description beside Play, and no player redesign');
      });
    });
  }
});

// ─── I-11: no horizontal overflow ───────────────────────────────────

describe('I-11: no horizontal overflow, About closed or open', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ['/', '/brown-noise']) {
      for (const open of [false, true]) {
        it(`AC2/AC5: ${route} at ${vp.name} ${vp.width}×${vp.height}, About ${open ? 'open' : 'closed'}`, { timeout: BUDGET }, async () => {
          await withVisit({ viewport: vp }, async (visit) => {
            await visit.gotoPath(route);
            if (route === '/brown-noise') assert.equal(await visit.page.title(), BROWN_NOISE_TITLE, 'the route is its own document');
            if (open) await openAbout(visit.page);
            const o = await overflow(visit.page);
            assert.ok(o.scroll <= o.client, `documentElement scrollWidth ${o.scroll} > clientWidth ${o.client}`);
            assert.ok(o.bodyScroll <= o.client, `body scrollWidth ${o.bodyScroll} > clientWidth ${o.client}`);
          });
        });
      }
    }
  }
});

// ─── I-12: the longer About copy fits and is reachable ──────────────

describe('I-12: the route\'s About copy is readable and reachable', () => {
  for (const vp of VIEWPORTS) {
    it(`AC1/AC5: every About block is inside the viewport width and unclipped (${vp.name} ${vp.width}×${vp.height})`, { timeout: BUDGET }, async () => {
      await withVisit({ viewport: vp }, async (visit) => {
        await visit.gotoPath('/brown-noise');
        assert.equal(await visit.page.title(), BROWN_NOISE_TITLE);
        await openAbout(visit.page);
        const blocks = await visit.page.evaluate(() => [...document.querySelectorAll('.seo-about-body > *')].map((el) => {
          const r = el.getBoundingClientRect();
          return { tag: el.localName, left: r.left, right: r.right, width: r.width, clipped: el.scrollWidth > el.clientWidth + 1, display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility };
        }));
        assert.equal(blocks.length, 8, 'eight blocks render');
        for (const b of blocks) {
          assert.ok(b.left >= 0 && b.right <= vp.width, `${b.tag} inside 0..${vp.width} (got ${b.left}..${b.right})`);
          assert.ok(b.width > 0 && b.display !== 'none' && b.visibility !== 'hidden', `${b.tag} is rendered`);
          assert.equal(b.clipped, false, `${b.tag} is not horizontally clipped`);
        }
      });
    });

    it(`AC1/AC5: the last About paragraph scrolls fully into view and is the topmost element at its centre (${vp.name})`, { timeout: BUDGET }, async () => {
      await withVisit({ viewport: vp }, async (visit) => {
        await visit.gotoPath('/brown-noise');
        assert.equal(await visit.page.title(), BROWN_NOISE_TITLE);
        await openAbout(visit.page);
        const last = visit.page.locator('.seo-about-body > p').last();
        await last.scrollIntoViewIfNeeded();
        const hit = await last.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
          return { top: r.top, bottom: r.bottom, vh: window.innerHeight, hitIsParagraph: !!top && (top === el || el.contains(top)), hitTag: top && top.localName + (top.className ? `.${top.className}` : '') };
        });
        assert.ok(hit.top >= 0 && hit.bottom <= hit.vh, `last paragraph fully visible (top ${hit.top}, bottom ${hit.bottom}, viewport ${hit.vh}): the page must scroll to the end of the longer copy`);
        assert.equal(hit.hitIsParagraph, true, `nothing may cover the last paragraph (topmost element is ${hit.hitTag})`);
      });
    });
  }

  it('AC1: the About body keeps the existing type scale on the route (11px / 1.7 line height, 11px headings)', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await visit.gotoPath('/brown-noise');
      assert.equal(await visit.page.title(), BROWN_NOISE_TITLE);
      await openAbout(visit.page);
      const type = await visit.page.evaluate(() => {
        const cs = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return [s.fontSize, s.fontWeight, s.textTransform]; };
        return { p: cs('.seo-about-body > p'), h2: cs('.seo-about-body > h2'), h3: cs('.seo-about-body > h3'), line: getComputedStyle(document.querySelector('.seo-about-body')).lineHeight };
      });
      assert.deepEqual(type, { p: ['11px', '300', 'none'], h2: ['11px', '500', 'uppercase'], h3: ['11px', '500', 'none'], line: '18.7px' });
    });
  });
});

// ─── I-13: the homepage link ────────────────────────────────────────

describe('I-13: the homepage "Brown noise generator" link is a visible, understated, usable part of About', () => {
  for (const vp of VIEWPORTS) {
    it(`AC2: the opened About shows the link inside the viewport, and it is the topmost element at its centre (${vp.name})`, { timeout: BUDGET }, async () => {
      await withVisit({ viewport: vp }, async (visit) => {
        await visit.gotoPath('/');
        await openAbout(visit.page);
        const link = visit.page.getByRole('link', { name: HOME_LINK_TEXT, exact: true });
        assert.equal(await link.count(), 1, 'one visible link labelled "Brown noise generator"');
        await link.scrollIntoViewIfNeeded();
        const geo = await link.evaluate((a) => {
          const r = a.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight, w: r.width, h: r.height, hit: top === a || a.contains(top) };
        });
        assert.ok(geo.w > 0 && geo.h > 0, 'the link has a box');
        assert.ok(geo.left >= 0 && geo.right <= geo.vw && geo.top >= 0 && geo.bottom <= geo.vh, `the link sits inside the viewport (got ${JSON.stringify(geo)})`);
        assert.equal(geo.hit, true, 'the link is not covered by another element');
      });
    });
  }

  it('AC2: the link uses the existing About type scale and a palette colour — not the browser-default blue', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await visit.gotoPath('/');
      await openAbout(visit.page);
      const seen = await visit.page.evaluate((label) => {
        const a = [...document.querySelectorAll('.seo-about-body a')].find((x) => x.textContent.trim() === label);
        if (!a) return null;
        const cs = getComputedStyle(a);
        const parent = getComputedStyle(a.parentElement);
        return { size: cs.fontSize, parentSize: parent.fontSize, family: cs.fontFamily, parentFamily: parent.fontFamily, color: cs.color, weight: cs.fontWeight, parentWeight: parent.fontWeight };
      }, HOME_LINK_TEXT);
      assert.ok(seen, 'the link exists');
      assert.equal(seen.size, seen.parentSize, 'no new font size: the link reads in the About type scale');
      assert.equal(seen.family, seen.parentFamily, 'no new font family');
      assert.equal(seen.weight, seen.parentWeight, 'no new weight: an understated link, not a button or a bolded call to action');
      assert.notEqual(seen.color, 'rgb(0, 0, 238)', 'must not be the browser-default link blue');
      assert.notEqual(seen.color, 'rgb(85, 26, 139)', 'must not be the browser-default visited purple');
    });
  });

  it('AC2: the link is reachable by keyboard from the About summary and takes focus', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await visit.gotoPath('/');
      await openAbout(visit.page);
      await visit.page.locator('details.seo-about > summary').focus();
      await visit.page.keyboard.press('Tab');
      const focused = await visit.page.evaluate(() => ({ text: document.activeElement.textContent.trim(), href: document.activeElement.getAttribute('href') }));
      assert.equal(focused.text, HOME_LINK_TEXT, 'Tab from the About summary lands on the link');
    });
  });

  it('AC2/AC5: a real click on the link in a normal (JS-on) browser lands on /brown-noise with Deep Focus selected and nothing playing', { timeout: BUDGET }, async () => {
    await withVisit({}, async (visit) => {
      await visit.gotoPath('/');
      await openAbout(visit.page);
      await visit.page.getByRole('link', { name: HOME_LINK_TEXT, exact: true }).click();
      await visit.page.waitForURL('https://noise.dog/brown-noise');
      await visit.settle();
      assert.equal(await visit.page.title(), BROWN_NOISE_TITLE);
      assert.equal(await visit.page.locator('#presetName').textContent(), 'Deep Focus');
      assert.equal(await visit.uiPlaying(), false);
    });
  });
});
