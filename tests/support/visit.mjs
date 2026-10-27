// Test harness for the noise.dog activation-event suite.
//
// It drives the REAL index.html in real Chromium. Three seams are controlled, all of them at the
// browser/network boundary rather than inside the page's own code:
//
//   1. Network. The page is served from the production origin (https://noise.dog) out of the
//      working tree, so GoatCounter's own localhost filter does not hide hits. The REAL GoatCounter
//      count.js (committed byte-for-byte as tests/fixtures/goatcounter-count.js) is served for
//      //gc.zgo.at/count.js, and every request it makes to the counter endpoint is recorded. What
//      the suite asserts on is what GoatCounter would receive: path (`p`) and the event flag (`e`).
//   2. Clock. Playwright's fake clock replaces Date, performance.now and every timer. Test time
//      only moves when the test advances it, so a "10 minute" run takes milliseconds of real time.
//   3. Audio. The Web Audio API itself is the audio-state seam: window.AudioContext is replaced
//      with a subclass of the real one whose `state`, `currentTime`, `resume()` and `suspend()` the
//      test controls (autoplay-blocked, interrupted by the OS, resumed later). The page still
//      builds its real node graph. Nothing inside index.html is mocked or stubbed.
//
// An implementation is free to measure playing time with Date.now, performance.now, timers or
// AudioContext.currentTime: they all run off the same controlled clock.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOATCOUNTER_JS = path.join(ROOT, 'tests', 'fixtures', 'goatcounter-count.js');

export const ORIGIN = 'https://noise.dog';
export const COUNTER_ENDPOINT = 'https://fancymatt.goatcounter.com/count';
export const ENGAGED_SECS = 600;
// An implementation that samples playing time once a second may land on 600 +/- one sample.
export const TOLERANCE_SECS = 2;
// Real milliseconds allowed for an in-flight beacon to reach the recorder before we count hits.
export const SETTLE_MS = 150;
// Real-time budget: browser launch + page load, plus an allowance per simulated second.
// Measured on this host at ~3 ms per simulated second; the allowance leaves ~15x headroom.
export const BASE_BUDGET_MS = 30_000;
export const REAL_MS_PER_SIM_SEC = 50;
export const budgetMs = (simSeconds) => BASE_BUDGET_MS + simSeconds * REAL_MS_PER_SIM_SEC;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// Runs in the page before any page script. Wraps the real AudioContext.
function installControlledAudio() {
  const Real = window.AudioContext || window.webkitAudioContext;
  const registry = { contexts: [], blockResume: false, pendingResumes: [] };

  class ControlledAudioContext extends Real {
    constructor(...args) {
      super(...args);
      this.__state = registry.blockResume ? 'suspended' : 'running';
      this.__acc = 0;
      this.__since = this.__state === 'running' ? performance.now() : null;
      Object.defineProperty(this, 'state', { configurable: true, get: () => this.__state });
      Object.defineProperty(this, 'currentTime', {
        configurable: true,
        get: () => this.__acc + (this.__since === null ? 0 : (performance.now() - this.__since) / 1000),
      });
      registry.contexts.push(this);
    }

    __set(next) {
      if (this.__state === next) return;
      if (this.__since !== null) this.__acc += (performance.now() - this.__since) / 1000;
      this.__since = next === 'running' ? performance.now() : null;
      this.__state = next;
      queueMicrotask(() => this.dispatchEvent(new Event('statechange')));
    }

    resume() {
      if (this.__state === 'closed') return Promise.reject(new DOMException('closed', 'InvalidStateError'));
      if (registry.blockResume) {
        // Chrome with a blocked autoplay policy: the promise stays pending, the state stays put.
        return new Promise((resolve) => registry.pendingResumes.push({ ctx: this, resolve }));
      }
      this.__set('running');
      return Promise.resolve();
    }

    suspend() {
      this.__set('suspended');
      return Promise.resolve();
    }

    close() {
      this.__set('closed');
      return Promise.resolve();
    }
  }

  window.AudioContext = ControlledAudioContext;
  window.webkitAudioContext = ControlledAudioContext;

  window.__audio = {
    states: () => registry.contexts.map((c) => c.state),
    count: () => registry.contexts.length,
    // The platform takes audio away (phone call, another app, OS audio interruption).
    interrupt: (state = 'suspended') => registry.contexts.forEach((c) => c.__set(state)),
    // The platform gives it back without the page asking.
    restore: () => registry.contexts.forEach((c) => c.__set('running')),
    // Autoplay policy: contexts start suspended and resume() never settles until unblock().
    blockAutoplay: () => { registry.blockResume = true; },
    unblockAutoplay: () => {
      registry.blockResume = false;
      registry.contexts.forEach((c) => c.__set('running'));
      registry.pendingResumes.splice(0).forEach((p) => p.resolve());
    },
    setHidden: (hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

const normPath = (p) => String(p ?? '').replace(/^\//, '');

export class Visit {
  constructor(context, page) {
    this.context = context;
    this.page = page;
    this.hits = [];
    this.pageErrors = [];
    this.countJsRequests = 0;
    this.countJsGate = null;
    this.blockCountJs = false;
  }

  /** Every request the page made to the GoatCounter endpoint, in order. */
  get beacons() { return this.hits.map((h) => ({ ...h })); }
  /** GoatCounter "events" as /api/v0/stats/hits would list them (event:true), path normalised. */
  events(prefix = '') {
    return this.hits.filter((h) => h.event && normPath(h.p).startsWith(prefix)).map((h) => normPath(h.p));
  }
  eventCount(name) { return this.events().filter((p) => p === name).length; }

  async goto(query = '', waitUntil = 'load') {
    await this.page.goto(`${ORIGIN}/${query}`, { waitUntil });
    await this.settle();
  }

  async reload() {
    await this.page.reload({ waitUntil: 'load' });
    await this.settle();
  }

  async settle() {
    await this.page.evaluate(() => new Promise((r) => queueMicrotask(r)));
    await sleep(SETTLE_MS);
  }

  /** Move simulated time forward, firing timers as they fall due, then let beacons land. */
  async advance(seconds) {
    await this.page.clock.runFor(seconds * 1000);
    await this.settle();
  }

  /**
   * Move simulated time forward in coarse jumps; each timer fires at most once per jump. This is how
   * a throttled background tab or a briefly frozen page behaves: the wall clock is right, the ticks
   * are not.
   */
  async advanceCoarse(seconds, jumpSeconds = 60) {
    for (let left = seconds; left > 0; left -= jumpSeconds) {
      await this.page.clock.fastForward(Math.min(jumpSeconds, left) * 1000);
    }
    await this.settle();
  }

  // Real input events (not synthetic click()): the page sees what a visitor's browser would send.
  async #realClick(selector) {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  async clickPlay() { await this.#realClick('#playBtn'); await this.settle(); }
  // Keyboard shortcuts are bound to the document body (index.html ignores keys aimed at a focused
  // button), so a keyboard visitor is on the body: drop the focus a mouse click left on a control.
  async #pressOnBody(key) {
    await this.page.evaluate(() => document.activeElement && document.activeElement.blur());
    await this.page.keyboard.press(key);
    await this.settle();
  }
  async pressSpace() { await this.#pressOnBody('Space'); }
  async clickPreset(index) { await this.#realClick(`.preset-btn[data-preset-index="${index}"]`); await this.settle(); }
  async nextPresetByKey() { await this.#pressOnBody('ArrowRight'); }
  async pressKey(key) { await this.#pressOnBody(key); }

  /** What the visitor sees: the play button's own announcement of whether the page believes it is playing. */
  async uiPlaying() { return (await this.page.getAttribute('#playBtn', 'aria-pressed')) === 'true'; }

  async audioStates() { return this.page.evaluate(() => window.__audio.states()); }
  async interruptAudio(state) { await this.page.evaluate((s) => window.__audio.interrupt(s), state); await this.settle(); }
  async restoreAudio() { await this.page.evaluate(() => window.__audio.restore()); await this.settle(); }
  async blockAutoplay() { await this.page.evaluate(() => window.__audio.blockAutoplay()); }
  async unblockAutoplay() { await this.page.evaluate(() => window.__audio.unblockAutoplay()); await this.settle(); }
  async setHidden(hidden) { await this.page.evaluate((h) => window.__audio.setHidden(h), hidden); await this.settle(); }

  async close() { await this.context.close(); }
}

function parseBeacon(url) {
  const q = new URL(url).searchParams;
  const flag = q.get('e');
  return {
    p: q.get('p'),
    event: flag === 'true' || flag === '1',
    q: q.get('q') ?? '',
    keys: [...q.keys()].sort(),
  };
}

export async function launch() {
  return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
}

/**
 * Open a fresh browser context (fresh storage) serving the working tree as https://noise.dog.
 * `holdCountJs`: count.js is not delivered until `visit.releaseCountJs()` (a slow third-party script).
 * `blockCountJs`: count.js never loads (content blocker, offline, GoatCounter down).
 */
export async function openVisit(browser, { holdCountJs = false, blockCountJs = false, autoplayBlocked = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const visit = new Visit(context, page);
  visit.blockCountJs = blockCountJs;
  let release;
  const gate = holdCountJs ? new Promise((resolve) => { release = resolve; }) : null;
  visit.releaseCountJs = () => release && release();

  page.on('pageerror', (err) => visit.pageErrors.push(String(err && err.message || err)));

  await context.addInitScript(installControlledAudio);
  if (autoplayBlocked) await context.addInitScript(() => window.__audio.blockAutoplay());

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());

    if (url.origin === ORIGIN) {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || rel.startsWith('tests/') || rel.startsWith('node_modules/')) {
        return route.fulfill({ status: 404, body: 'not found' });
      }
      try {
        const body = await readFile(file);
        return route.fulfill({ status: 200, body, contentType: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' });
      } catch {
        return route.fulfill({ status: 404, body: 'not found' });
      }
    }

    if (url.origin === 'https://gc.zgo.at' && url.pathname === '/count.js') {
      visit.countJsRequests += 1;
      if (visit.blockCountJs) return route.abort('blockedbyclient');
      if (gate) await gate;
      return route.fulfill({ status: 200, body: await readFile(GOATCOUNTER_JS), contentType: 'application/javascript' });
    }

    if (url.origin + url.pathname === COUNTER_ENDPOINT) {
      visit.hits.push(parseBeacon(route.request().url()));
      return route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': '*' } });
    }

    if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
      return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    }

    // Any other host is a leak out of the hermetic harness; refuse it loudly (page errors / hits show it).
    return route.abort('blockedbyclient');
  });

  // Install the fake clock and freeze it: from here simulated time moves only when a test advances it.
  await context.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await context.clock.pauseAt(new Date('2026-10-27T12:00:05Z'));
  return visit;
}
