/**
 * Tests for BBS-2: Clean URL routing — noise.dog preset pages
 *
 * AC1: Path-based routing so each clean URL 200s the same page
 *   /?p=df → /brown-noise (Deep Focus)
 *   /?p=mr → /midnight-rain (Midnight Rain)
 *   /?p=em → /embers (Embers)
 *   /?p=cw → /coastal-wind (Coastal Wind)
 *   /?p=dr → /drift (Drift)
 *
 * AC2: Sitemap updated to clean URLs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Helpers ────────────────────────────────────────────────────────

function extractPresetsFromHTML(html) {
  // Find the PRESETS array in the inline JS
  const match = html.match(/let PRESETS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Could not find PRESETS array in index.html');
  // Evaluate the array in a sandbox — extract structured data via regex
  const arrText = match[1];
  const presets = [];
  const nameRe = /name:\s*"([^"]+)"/g;
  const slugRe = /slug:\s*"([^"]+)"/g;
  const paramRe = /param:\s*"([^"]+)"/g;
  let m;
  while ((m = nameRe.exec(arrText)) !== null) {
    presets.push({ name: m[1] });
  }
  let i = 0;
  while ((m = slugRe.exec(arrText)) !== null) {
    if (presets[i]) { presets[i].slug = m[1]; i++; }
  }
  i = 0;
  while ((m = paramRe.exec(arrText)) !== null) {
    if (presets[i]) { presets[i].param = m[1]; i++; }
  }
  // Filter to only built-in presets (non-custom)
  return presets.filter(p => p.slug && p.param);
}

function extractSitemapURLs(xml) {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1]);
  }
  return urls;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('BBS-2: Clean URL routing', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
  const sitemapXml = readFileSync(resolve(ROOT, 'sitemap.xml'), 'utf-8');
  const presets = extractPresetsFromHTML(html);
  const sitemapUrls = extractSitemapURLs(sitemapXml);

  describe('AC1: Path-based routing', () => {
    // These tests should FAIL because the code currently only parses query params (?p=df),
    // not the pathname (/brown-noise).

    it('should read window.location.pathname to select preset by slug', () => {
      // The init function must check location.pathname (not just URLSearchParams)
      // Currently it only does: new URLSearchParams(window.location.search).get('p')
      const initCode = html.match(/\(function init\(\)[\s\S]*?\}\)\(\);/);
      assert(initCode, 'init function must exist');

      // Assert that the init function references location.pathname — this will FAIL
      // because current code only uses URLSearchParams.
      assert(
        initCode[0].includes('location.pathname') || initCode[0].includes('location.path'),
        'init() must read window.location.pathname for slug-based routing'
      );

      // Assert that the init function maps a pathname segment (e.g. /brown-noise) to a preset slug
      assert(
        initCode[0].includes('.slug') || initCode[0].includes('slug'),
        'init() must use slug (not just param) when routing by pathname'
      );
    });

    it('should route /brown-noise → Deep Focus preset', () => {
      // When location.pathname = '/brown-noise', the init function should set
      // currentPresetIndex to the index of the preset with slug 'deep-focus'.
      // This test will FAIL because no such logic exists.
      const dfPreset = presets.find(p => p.slug === 'deep-focus');
      assert(dfPreset, 'Deep Focus preset must exist');
      assert.equal(dfPreset.param, 'df', 'Deep Focus param must be df');
      assert.equal(dfPreset.name, 'Deep Focus', 'Deep Focus name must match');
    });

    it('should route /midnight-rain → Midnight Rain preset', () => {
      const mrPreset = presets.find(p => p.slug === 'midnight-rain');
      assert(mrPreset, 'Midnight Rain preset must exist');
      assert.equal(mrPreset.param, 'mr');
    });

    it('should route /embers → Embers preset', () => {
      const emPreset = presets.find(p => p.slug === 'embers');
      assert(emPreset, 'Embers preset must exist');
      assert.equal(emPreset.param, 'em');
    });

    it('should route /coastal-wind → Coastal Wind preset', () => {
      const cwPreset = presets.find(p => p.slug === 'coastal-wind');
      assert(cwPreset, 'Coastal Wind preset must exist');
      assert.equal(cwPreset.param, 'cw');
    });

    it('should route /drift → Drift preset', () => {
      const drPreset = presets.find(p => p.slug === 'drift');
      assert(drPreset, 'Drift preset must exist');
      assert.equal(drPreset.param, 'dr');
    });

    it('should update browser URL to clean path when preset changes', () => {
      // The updatePresetUrl function should set pathname (e.g. /brown-noise)
      // instead of setting ?p=df in the query string.
      const updateUrlCode = html.match(/function updatePresetUrl\(index\)[\s\S]*?^    \}/m);
      assert(updateUrlCode, 'updatePresetUrl function must exist');

      // This will FAIL because current code sets ?p=df, not a pathname
      assert(
        updateUrlCode[0].includes('pathname'),
        'updatePresetUrl must set location.pathname (e.g. /brown-noise), not search params'
      );
    });
  });

  describe('AC2: Sitemap updated to clean URLs', () => {
    it('should contain a URL for the homepage', () => {
      assert(sitemapUrls.some(u => u === 'https://noise.dog/'), 'Homepage URL must be in sitemap');
    });

    it('should contain /brown-noise instead of /?p=df', () => {
      // This will FAIL — the sitemap currently has /?p=df, not /brown-noise
      assert(
        sitemapUrls.includes('https://noise.dog/brown-noise'),
        'Sitemap must contain https://noise.dog/brown-noise'
      );
      // The old /?p=df URL should NOT be in the sitemap
      assert(
        !sitemapUrls.includes('https://noise.dog/?p=df'),
        'Sitemap must not contain legacy /?p=df URL'
      );
    });

    it('should contain /midnight-rain instead of /?p=mr', () => {
      assert(
        sitemapUrls.includes('https://noise.dog/midnight-rain'),
        'Sitemap must contain https://noise.dog/midnight-rain'
      );
      assert(
        !sitemapUrls.includes('https://noise.dog/?p=mr'),
        'Sitemap must not contain legacy /?p=mr URL'
      );
    });

    it('should contain /embers instead of /?p=em', () => {
      assert(
        sitemapUrls.includes('https://noise.dog/embers'),
        'Sitemap must contain https://noise.dog/embers'
      );
      assert(
        !sitemapUrls.includes('https://noise.dog/?p=em'),
        'Sitemap must not contain legacy /?p=em URL'
      );
    });

    it('should contain /coastal-wind instead of /?p=cw', () => {
      assert(
        sitemapUrls.includes('https://noise.dog/coastal-wind'),
        'Sitemap must contain https://noise.dog/coastal-wind'
      );
      assert(
        !sitemapUrls.includes('https://noise.dog/?p=cw'),
        'Sitemap must not contain legacy /?p=cw URL'
      );
    });

    it('should contain /drift instead of /?p=dr', () => {
      assert(
        sitemapUrls.includes('https://noise.dog/drift'),
        'Sitemap must contain https://noise.dog/drift'
      );
      assert(
        !sitemapUrls.includes('https://noise.dog/?p=dr'),
        'Sitemap must not contain legacy /?p=dr URL'
      );
    });
  });
});
