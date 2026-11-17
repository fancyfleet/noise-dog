// The LIF-938 experiment contract, verbatim, plus the helpers that read a served document.
//
// Source of the copy: fancyforge/projects/software/noise-dog/marketing/2026-11-17-indexation-experiment.md,
// "Exact scope". It is pinned character for character on purpose: the AC is "specified title /
// description / About copy", so a paraphrase is a defect, not a rewording.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, respond } from './serve.mjs';

export const BROWN_NOISE_URL = 'https://noise.dog/brown-noise';
export const HOME_URL = 'https://noise.dog';

export const BROWN_NOISE_TITLE = 'Brown Noise Generator for Focus — noise.dog';
export const BROWN_NOISE_DESCRIPTION =
  'Play deep brown noise in your browser. Choose a comfortable volume, press play, and get back to work. Free, with no signup or download.';

// [tag, text] in document order: the whole of the replacement About body on the target route.
export const BROWN_NOISE_ABOUT = [
  ['h2', 'Brown Noise Generator'],
  ['p', 'Play deep brown noise in your browser with the Deep Focus preset. Choose a comfortable volume and press play. No signup or download is needed.'],
  ['h3', 'What does brown noise sound like?'],
  ['p', 'Brown noise emphasizes lower frequencies, giving it a deeper, softer sound than the brighter hiss of white noise. noise.dog synthesizes the sound in your browser rather than playing a recorded loop.'],
  ['h3', 'Using brown noise while you work'],
  ['p', 'Try it as a steady background while reading, studying or coding. Start quietly and adjust to a comfortable level. Whether background sound suits you is personal; this tool does not promise better concentration or sleep.'],
  ['h3', 'Keep your setup'],
  ['p', 'Bookmark this page to return to the brown-noise preset. Use the preset controls if you would rather hear rain or another soundscape.'],
];

export const HOME_LINK_TEXT = 'Brown noise generator';

/** What the homepage looked like at main@94e83ed, the base SHA of this ticket (== live noise.dog/ on 2026-11-17). */
export const BASE_HOME_PATH = path.join(ROOT, 'tests', 'fixtures', 'home-at-base-94e83ed.html');
export const readBaseHome = () => readFile(BASE_HOME_PATH, 'utf8');

/** The raw bytes production would answer for `pathname`, as text (no JavaScript has run on it). */
export async function rawResponse(pathname) {
  const res = await respond(pathname);
  return {
    status: res.status,
    contentType: res.contentType ?? null,
    location: res.location ?? null,
    servedFrom: res.servedFrom ?? null,
    body: res.body ? res.body.toString('utf8') : '',
  };
}

// Runs inside a blank Chromium page. DOMParser builds the document the way a crawler's HTML parser
// does: no script executes, no network is touched, and what comes back is the initial server HTML.
function summarise(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const metaContent = (sel) => [...doc.querySelectorAll(sel)].map((m) => m.getAttribute('content'));
  const about = doc.querySelector('details.seo-about > .seo-about-body');

  // Text of the page outside the About body, scripts and styles: everything a visitor or a
  // crawler could read that is NOT the About copy (so "no hidden SEO-only copy" is checkable).
  const outside = doc.body.cloneNode(true);
  outside.querySelectorAll('script, style, .seo-about-body').forEach((n) => n.remove());

  // Structure of the body outside the About body and scripts, as a normalised string: used to
  // prove the player shell is the same document shape on every route.
  const shell = doc.body.cloneNode(true);
  shell.querySelectorAll('script, style, .seo-about-body').forEach((n) => n.remove());

  const headRest = [...doc.head.children]
    .filter((el) => {
      if (['STYLE', 'SCRIPT', 'TITLE'].includes(el.tagName)) return false;
      if (el.tagName === 'META') {
        const name = el.getAttribute('name');
        const prop = el.getAttribute('property');
        if (name === 'description' || name === 'keywords' || (prop && prop.startsWith('og:'))) return false;
      }
      if (el.tagName === 'LINK' && /(^|\s)canonical(\s|$)/i.test(el.getAttribute('rel') || '')) return false;
      return true;
    })
    .map((el) => el.outerHTML.replace(/\s+/g, ' '));

  const counter = [...doc.querySelectorAll('script[data-goatcounter]')].map((s) => ({
    endpoint: s.getAttribute('data-goatcounter'),
    src: s.getAttribute('src'),
    async: s.hasAttribute('async'),
    onload: s.getAttribute('onload'),
  }));

  return {
    title: doc.title,
    titles: doc.querySelectorAll('title').length,
    canonicals: [...doc.querySelectorAll('link')]
      .filter((l) => /(^|\s)canonical(\s|$)/i.test(l.getAttribute('rel') || ''))
      .map((l) => l.getAttribute('href')),
    ogUrls: metaContent('meta[property="og:url"]'),
    descriptions: metaContent('meta[name="description"]'),
    robots: metaContent('meta[name="robots"]'),
    metaText: [...doc.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content')),
    jsonLd: [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => norm(s.textContent)),
    microdata: doc.querySelectorAll('[itemscope], [itemtype], [itemprop], [typeof], [property="aggregateRating"]').length,
    aboutSummary: (() => { const s = doc.querySelector('details.seo-about > summary'); return s ? norm(s.textContent) : null; })(),
    aboutExists: !!about,
    aboutChildren: about ? [...about.children].map((c) => ({ tag: c.localName, text: norm(c.textContent), childElements: c.children.length })) : null,
    aboutLooseText: about ? norm([...about.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')) : null,
    aboutAnchors: about ? [...about.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      text: norm(a.textContent),
      rel: a.getAttribute('rel'),
      target: a.getAttribute('target'),
      attrs: a.getAttributeNames().sort(),
    })) : [],
    allAnchorsToBrownNoise: [...doc.querySelectorAll('a[href]')]
      .filter((a) => {
        try { return new URL(a.getAttribute('href'), 'https://noise.dog/').pathname.replace(/\/$/, '') === '/brown-noise'; } catch { return false; }
      })
      .map((a) => ({ href: a.getAttribute('href'), text: norm(a.textContent), inAbout: !!a.closest('.seo-about-body') })),
    outsideAboutText: norm(outside.textContent),
    shell: norm(shell.innerHTML),
    headRest,
    styleText: [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n'),
    counter,
  };
}

/** Parse served HTML in a blank page; returns the plain-data summary above. */
export async function parseInitialHtml(page, html) {
  return page.evaluate(`(${summarise.toString()})(${JSON.stringify(html)})`);
}

/**
 * The homepage document with the one expected link taken out, for comparison against the base
 * page: the anchor is removed and any element it leaves empty is dropped. Runs in a blank page.
 */
function withoutHomeLink(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const about = doc.querySelector('details.seo-about > .seo-about-body');
  const links = about ? [...about.querySelectorAll('a')] : [];
  links.forEach((a) => {
    let parent = a.parentElement;
    a.remove();
    while (parent && parent !== about && !parent.children.length && !norm(parent.textContent)) {
      const up = parent.parentElement;
      parent.remove();
      parent = up;
    }
  });
  doc.body.querySelectorAll('script, style').forEach((n) => n.remove());
  return { shellHtml: norm(doc.body.innerHTML), aboutText: about ? norm(about.textContent) : null, removed: links.length };
}

export async function homeWithoutLink(page, html) {
  return page.evaluate(`(${withoutHomeLink.toString()})(${JSON.stringify(html)})`);
}
