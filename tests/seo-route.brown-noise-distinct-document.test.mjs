// noise.dog: one distinct, self-canonical /brown-noise destination — the raw-document contract.
//
// Ticket: LIF-938 (bounded SEO test). Register: life-os/development/test-writing-policy.md.
// Spec of record: fancyforge/projects/software/noise-dog/marketing/2026-11-17-indexation-experiment.md,
// "Exact scope" / "Experiment contract". Copy is pinned verbatim in tests/support/brown-noise-contract.mjs.
//
// What these tests drive: the bytes the origin answers for a path (tests/support/serve.mjs, the
// nginx model) and, for the JS-off rows, a real Chromium with JavaScript disabled — i.e. the
// initial server-readable HTML a crawler's first fetch sees. Nothing here runs the page's own
// script, so "JS-only metadata" cannot satisfy it.
//
// Invariants protected (TS-4):
//   I-1 /brown-noise has its OWN initial document: not the homepage bytes, one canonical and one
//       og:url that both name /brown-noise, the specified title and description, and the specified
//       About copy — nothing more, nothing hidden.
//   I-2 The homepage stays the homepage: same canonical, same everything, plus exactly one
//       crawlable link to /brown-noise labelled "Brown noise generator" inside the existing About copy.
//   I-3 Every other preset route is untouched (still the homepage document, canonical https://noise.dog).
//   I-4 Nothing else is added: no structured data, no ratings, no medical claims, no new route
//       documents, no route-specific styling, analytics transport and head metadata unchanged.
//   I-5 Both documents work with JavaScript off for link and copy discovery.
//
// Red reasons at base (TS-2) and mutation controls (TS-3): see the tests-ready hand-off on LIF-938.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch, openVisit, budgetMs } from './support/visit.mjs';
import {
  BROWN_NOISE_URL, HOME_URL, BROWN_NOISE_TITLE, BROWN_NOISE_DESCRIPTION, BROWN_NOISE_ABOUT, HOME_LINK_TEXT,
  rawResponse, readBaseHome, parseInitialHtml, homeWithoutLink,
} from './support/brown-noise-contract.mjs';

let browser;
let blank;
before(async () => {
  browser = await launch();
  blank = await browser.newPage();
});
after(async () => {
  if (blank) await blank.close();
  if (browser) await browser.close();
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
const BUDGET = budgetMs(5);

let cache;
async function docs() {
  if (!cache) {
    const [home, brown, base] = [await rawResponse('/'), await rawResponse('/brown-noise'), await readBaseHome()];
    cache = {
      home, brown, base,
      homeSum: await parseInitialHtml(blank, home.body),
      brownSum: await parseInitialHtml(blank, brown.body),
      baseSum: await parseInitialHtml(blank, base),
    };
  }
  return cache;
}

// ─── I-1: /brown-noise is its own document ──────────────────────────

describe('I-1: /brown-noise serves its own initial HTML', () => {
  it('AC1: the route answers 200 text/html directly (no redirect to a trailing-slash or other URL)', { timeout: BUDGET }, async () => {
    const { brown } = await docs();
    assert.equal(brown.status, 200, `GET /brown-noise must be a direct 200 (got ${brown.status}${brown.location ? ` -> ${brown.location}` : ''}); a directory layout makes nginx 301 to /brown-noise/, which is not the canonical URL`);
    assert.match(brown.contentType ?? '', /^text\/html/, `the document must be served as text/html (got ${brown.contentType}); an extensionless file is served as application/octet-stream and a browser would download it`);
  });

  it('AC1: the initial HTML is not the homepage document (and not the unknown-path fallback)', { timeout: BUDGET }, async () => {
    const { home, brown, base } = await docs();
    assert.notEqual(sha(brown.body), sha(home.body), '/brown-noise must not return the homepage bytes (live baseline: both sha256 ec2125e4…8e5c)');
    assert.notEqual(sha(brown.body), sha(base), '/brown-noise must differ from the base-SHA homepage');
    assert.notEqual(brown.servedFrom, 'index.html', `/brown-noise was answered by the fallback (servedFrom=${brown.servedFrom}); it needs its own file`);
    const fallback = await rawResponse('/no-such-page-lif-938');
    assert.notEqual(sha(brown.body), sha(fallback.body), 'the route must not be the same document unknown paths fall back to');
  });

  it('AC1: exactly one canonical link, and it is https://noise.dog/brown-noise', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.deepEqual(brownSum.canonicals, [BROWN_NOISE_URL], `/brown-noise must declare exactly one canonical, self-referencing (got ${JSON.stringify(brownSum.canonicals)}; production today canonicalises to the homepage)`);
  });

  it('AC1: exactly one Open Graph URL, equal to the canonical', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.deepEqual(brownSum.ogUrls, [BROWN_NOISE_URL], `og:url must be present once and match the canonical (got ${JSON.stringify(brownSum.ogUrls)})`);
    assert.equal(brownSum.ogUrls[0], brownSum.canonicals[0], 'og:url and canonical must name the same URL');
  });

  it('AC1: the title is exactly "Brown Noise Generator for Focus — noise.dog"', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.equal(brownSum.titles, 1, 'exactly one <title>');
    assert.equal(brownSum.title, BROWN_NOISE_TITLE);
  });

  it('AC1: the meta description is exactly the contract string, once', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.deepEqual(brownSum.descriptions, [BROWN_NOISE_DESCRIPTION]);
  });

  it('AC1: the page stays indexable (robots meta unchanged: index, follow)', { timeout: BUDGET }, async () => {
    const { brownSum, baseSum } = await docs();
    assert.deepEqual(brownSum.robots, baseSum.robots, 'the robots meta must not change');
    assert.deepEqual(brownSum.robots, ['index, follow'], 'a self-canonical page the experiment wants indexed must not carry noindex');
  });

  it('AC1: the About body is exactly the four specified blocks, in order, with the specified copy', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.equal(brownSum.aboutExists, true, 'the existing details.seo-about > .seo-about-body structure must remain');
    assert.deepEqual(
      brownSum.aboutChildren.map((c) => [c.tag, c.text]),
      BROWN_NOISE_ABOUT,
      'About body must be the h2, p, h3, p, h3, p, h3, p of the contract, character for character (the old Free Online Noise Generator copy must be gone)',
    );
    assert.deepEqual(brownSum.aboutChildren.map((c) => c.childElements), BROWN_NOISE_ABOUT.map(() => 0), 'the copy is plain text in existing h2/h3/p elements: no nested links, spans or extra markup');
    assert.equal(brownSum.aboutLooseText, '', 'no stray text nodes in the About body outside the four blocks');
  });

  it('AC1/AC2: the replacement About copy carries no link, and the About disclosure keeps its summary', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    assert.deepEqual(brownSum.aboutAnchors, [], 'the target-route About copy is exactly the specified text; the homepage link does not belong there');
    assert.equal(brownSum.aboutSummary, 'About', 'the About disclosure keeps its production summary label');
  });
});

// ─── I-2 / I-3: the homepage and the other routes ───────────────────

describe('I-2: the homepage stays the homepage and gains exactly one crawlable link', () => {
  it('AC1/AC2: homepage canonical, og:url, title and description are unchanged', { timeout: BUDGET }, async () => {
    const { homeSum, baseSum } = await docs();
    assert.deepEqual(homeSum.canonicals, [HOME_URL], 'the homepage canonical stays https://noise.dog');
    assert.deepEqual(homeSum.ogUrls, [HOME_URL], 'the homepage og:url stays https://noise.dog');
    assert.equal(homeSum.title, baseSum.title);
    assert.deepEqual(homeSum.descriptions, baseSum.descriptions);
  });

  it('AC2: exactly one link to /brown-noise on the homepage, inside the About body, labelled "Brown noise generator"', { timeout: BUDGET }, async () => {
    const { homeSum } = await docs();
    assert.equal(homeSum.allAnchorsToBrownNoise.length, 1, `exactly one link to /brown-noise on the page (got ${JSON.stringify(homeSum.allAnchorsToBrownNoise)})`);
    const [link] = homeSum.allAnchorsToBrownNoise;
    assert.equal(link.inAbout, true, 'the link lives inside the existing homepage About content');
    assert.equal(link.text, HOME_LINK_TEXT, 'the label is exactly "Brown noise generator"');
    assert.equal(homeSum.aboutAnchors.length, 1, 'the About body gains one link and no other');
  });

  it('AC2: the link is a normal crawlable anchor: real href to the route, no nofollow, no script handler, no new target', { timeout: BUDGET }, async () => {
    const { homeSum } = await docs();
    const [a] = homeSum.aboutAnchors;
    assert.ok(a, 'the homepage About link must exist');
    assert.ok(['/brown-noise', BROWN_NOISE_URL].includes(a.href), `href must be the route itself (got ${a.href}); "#", javascript: or a ?p= URL is not a crawlable destination`);
    assert.ok(!/nofollow|noindex|sponsored|ugc/i.test(a.rel || ''), `the link must pass signals (rel="${a.rel}")`);
    assert.equal(a.target, null, 'an internal link opens in the same tab (no target attribute)');
    assert.deepEqual(a.attrs.filter((n) => /^on/.test(n) || n === 'role' || n === 'download'), [], 'a plain anchor: no onclick/role/download');
  });

  it('AC2: nothing else on the homepage changes — same page once the one link is taken out (no new slogan, label or copy)', { timeout: BUDGET }, async () => {
    const { home, base } = await docs();
    const [now, then] = [await homeWithoutLink(blank, home.body), await homeWithoutLink(blank, base)];
    assert.equal(now.removed, 1, 'exactly one anchor was added to the About body');
    assert.equal(then.removed, 0, 'sanity: the base page has no About link');
    assert.equal(now.aboutText, then.aboutText, 'the existing homepage About copy is word-for-word unchanged (the link is added to it, nothing is rewritten)');
    assert.equal(now.shellHtml, then.shellHtml, 'the homepage body markup (player, presets, volume, About, byline) is unchanged apart from the one link');
  });

  it('AC4: homepage head metadata other than the specified fields is unchanged (icons, viewport, robots, sitemap, analytics tag)', { timeout: BUDGET }, async () => {
    const { homeSum, baseSum } = await docs();
    assert.deepEqual(homeSum.headRest, baseSum.headRest);
    assert.deepEqual(homeSum.counter, baseSum.counter, 'the GoatCounter script tag is unchanged on the homepage');
    assert.equal(homeSum.counter.length, 1);
  });
});

describe('I-3: the other preset routes are untouched', () => {
  for (const slug of ['midnight-rain', 'embers', 'coastal-wind', 'drift']) {
    it(`AC1: /${slug} still answers the homepage document, canonical https://noise.dog`, { timeout: BUDGET }, async () => {
      const [{ home }, res] = [await docs(), await rawResponse(`/${slug}`)];
      assert.equal(res.status, 200);
      assert.equal(sha(res.body), sha(home.body), `/${slug} must keep returning the homepage bytes`);
      const sum = await parseInitialHtml(blank, res.body);
      assert.deepEqual(sum.canonicals, [HOME_URL]);
      assert.deepEqual(sum.ogUrls, [HOME_URL]);
    });
  }

  it('AC1: no new page documents exist beyond the one route (no other route has its own file)', { timeout: BUDGET }, async () => {
    const homeSha = sha((await docs()).home.body);
    for (const p of ['/midnight-rain', '/embers', '/coastal-wind', '/drift', '/deep-focus', '/white-noise', '/pink-noise', '/sleep']) {
      const res = await rawResponse(p);
      assert.equal(sha(res.body), homeSha, `${p} must still be the homepage document: "no new pages beyond the existing route"`);
    }
  });
});

// ─── I-4: nothing else is added ─────────────────────────────────────

describe('I-4: no structured data, no medical claims, no route-specific styling, nothing hidden', () => {
  it('AC1: structured data is exactly the base page\'s two JSON-LD blocks on both documents: none added, none rewritten, no ratings or reviews', { timeout: BUDGET }, async () => {
    const { homeSum, brownSum, baseSum } = await docs();
    assert.equal(baseSum.jsonLd.length, 2, 'sanity: the base page carries the WebApplication and Organization/WebSite blocks');
    for (const [name, sum] of [['/', homeSum], ['/brown-noise', brownSum]]) {
      assert.deepEqual(sum.jsonLd, baseSum.jsonLd, `${name}: structured data must be exactly the existing blocks (the contract bans new structured-data ratings)`);
      assert.doesNotMatch(sum.jsonLd.join(' '), /aggregateRating|ratingValue|ratingCount|reviewRating|"@type"\s*:\s*"(?:Review|Rating|AggregateRating)"/i, `${name}: no rating or review structured data`);
      assert.equal(sum.microdata, 0, `${name}: no itemscope/itemprop/typeof markup`);
    }
  });

  it('AC1: no medical or outcome claims anywhere in the new route\'s metadata or visible text', { timeout: BUDGET }, async () => {
    const { brownSum } = await docs();
    const claim = /\b(cure[sd]?|treats?|treatment|therap\w*|clinical\w*|proven|insomnia|adhd|anxiety|tinnitus|diagnos\w*|medical\w*|doctor\w*|improves? (?:your )?(?:sleep|focus|concentration))\b/i;
    const text = [brownSum.title, ...brownSum.metaText, brownSum.outsideAboutText, ...brownSum.aboutChildren.map((c) => c.text)].join(' | ');
    assert.doesNotMatch(text, claim, 'tripwire: the contract allows no claims of medical benefit');
  });

  it('AC1/AC2: no hidden SEO-only copy — outside the About body the new route has exactly the homepage\'s text and markup', { timeout: BUDGET }, async () => {
    const { homeSum, brownSum } = await docs();
    assert.equal(brownSum.outsideAboutText, homeSum.outsideAboutText, 'visible and hidden text outside About must equal the homepage\'s (no new slogan, status line or description beside Play)');
    assert.equal(brownSum.shell, homeSum.shell, 'player shell markup (header, preset name, presets, play, volume, byline, panels) must be identical to the homepage\'s');
  });

  it('AC2/AC4: no route-specific styling and no new head metadata: styles equal the homepage\'s; icons/viewport/robots/sitemap link/analytics tag equal the base', { timeout: BUDGET }, async () => {
    const { homeSum, brownSum, baseSum } = await docs();
    assert.equal(brownSum.styleText, homeSum.styleText, 'existing design is the contract: the new document ships the same stylesheet as the homepage');
    assert.equal(brownSum.scriptText, homeSum.scriptText, 'the new document ships the same inline app script (player, routing, LIF-691 analytics, ?internal= namespace) as the homepage; mirror every index.html script change into brown-noise.html');
    assert.ok(brownSum.scriptText.length > 1000, 'the inline app script was found (guards the comparison against comparing two empty strings)');
    assert.deepEqual(brownSum.headRest, baseSum.headRest);
    assert.deepEqual(brownSum.counter, baseSum.counter, 'the GoatCounter script tag (LIF-691 transport) is carried over unchanged');
    assert.equal(brownSum.counter.length, 1);
  });

  it('AC1: the sitemap still lists /brown-noise (the route a crawler is meant to find) and is otherwise untouched', { timeout: BUDGET }, async () => {
    const res = await rawResponse('/sitemap.xml');
    assert.equal(res.status, 200);
    const locs = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.includes(BROWN_NOISE_URL), 'sitemap keeps https://noise.dog/brown-noise');
    assert.ok(locs.includes('https://noise.dog/'), 'sitemap keeps the homepage');
    assert.equal(new Set(locs).size, locs.length, 'no duplicate sitemap entries');
  });
});

// ─── I-5: JavaScript off — the real browser, initial HTML only ──────

describe('I-5: with JavaScript disabled the route and the link still work', () => {
  it('AC1/AC5: a JS-off browser load of /brown-noise shows its own title, canonical and About copy', { timeout: budgetMs(8) }, async () => {
    const visit = await openVisit(browser, { javaScriptEnabled: false });
    try {
      await visit.page.goto('https://noise.dog/brown-noise', { waitUntil: 'load' });
      const seen = await visit.page.evaluate(() => ({
        title: document.title,
        canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
        ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
        aboutH2: document.querySelector('.seo-about-body h2')?.textContent,
        headings: [...document.querySelectorAll('.seo-about-body h3')].map((h) => h.textContent),
      }));
      assert.equal(seen.title, BROWN_NOISE_TITLE);
      assert.deepEqual(seen.canonical, [BROWN_NOISE_URL]);
      assert.equal(seen.ogUrl, BROWN_NOISE_URL);
      assert.equal(seen.aboutH2, 'Brown Noise Generator');
      assert.deepEqual(seen.headings, BROWN_NOISE_ABOUT.filter(([t]) => t === 'h3').map(([, text]) => text));
      // The copy is reachable by a visitor too: opening About with a real click (no script) shows it.
      await visit.page.locator('details.seo-about > summary').click();
      const visible = await visit.page.locator('.seo-about-body').innerText();
      for (const [, text] of BROWN_NOISE_ABOUT) assert.ok(visible.toLowerCase().includes(text.toLowerCase()), `About shows: ${text.slice(0, 50)}…`);
    } finally {
      await visit.close();
    }
  });

  it('AC2/AC5: with JS off a visitor opens About on the homepage, clicks "Brown noise generator" and lands on the distinct page', { timeout: budgetMs(8) }, async () => {
    const visit = await openVisit(browser, { javaScriptEnabled: false });
    try {
      await visit.page.goto('https://noise.dog/', { waitUntil: 'load' });
      await visit.page.locator('details.seo-about > summary').click();
      const link = visit.page.getByRole('link', { name: HOME_LINK_TEXT, exact: true });
      assert.equal(await link.count(), 1, 'one visible "Brown noise generator" link in the opened About');
      await link.click();
      await visit.page.waitForURL('https://noise.dog/brown-noise');
      assert.equal(await visit.page.title(), BROWN_NOISE_TITLE, 'the click arrives at the distinct /brown-noise document');
      assert.equal(await visit.page.locator('link[rel="canonical"]').getAttribute('href'), BROWN_NOISE_URL);
    } finally {
      await visit.close();
    }
  });
});
