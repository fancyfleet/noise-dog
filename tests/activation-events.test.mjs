// noise.dog activation events: `audio_start` and `engaged_10min`.
//
// Ticket: LIF-691 (follow-up to the LIF-689 activation audit). Register: life-os/development/test-writing-policy.md.
//
// Executable specification of the ticket's acceptance criteria. Every test loads the real index.html
// in real Chromium with the real GoatCounter count.js, then asserts on the hits GoatCounter would
// receive (see tests/support/visit.mjs for the three controlled seams: network, clock, Web Audio).
//
// Invariants protected (TS-4):
//   I1  An activation event means audio is audibly playing, never "a button was pressed".
//   I2  Each event is counted at most once per visit, however the visitor pauses, resumes or retunes.
//   I3  Engagement is measured in playing time: paused, suspended or interrupted audio does not
//       count, and neither does time before the first note.
//   I4  A tracking transport that is late or absent never changes whether, or how often, an event counts.
//   I5  Internal traffic never reaches a public path, for pageviews (denominator) and events (numerator).
//
// Not covered here, by design: the AC's "genuine 10-minute run on the deployed build", the GoatCounter
// API check, and the marketing README update. Those are evidence-stage items (see the hand-off).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  launch, openVisit, budgetMs, ENGAGED_SECS, TOLERANCE_SECS,
} from './support/visit.mjs';

const AUDIO_START = 'audio_start';
const ENGAGED = 'engaged_10min';
const BEFORE = ENGAGED_SECS - TOLERANCE_SECS; // clearly short of ten minutes
const AFTER = ENGAGED_SECS + TOLERANCE_SECS;  // clearly past ten minutes

let browser;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function withVisit(opts, fn) {
  const visit = await openVisit(browser, opts);
  try {
    await fn(visit);
    assert.deepEqual(visit.pageErrors, [], 'the page must not throw while tracking');
  } finally {
    await visit.close();
  }
}

const count = (v, name) => v.eventCount(name);
function expectCounts(v, expected, why) {
  assert.deepEqual(
    { [AUDIO_START]: count(v, AUDIO_START), [ENGAGED]: count(v, ENGAGED) },
    { [AUDIO_START]: expected.audio, [ENGAGED]: expected.engaged },
    `${why} (all event hits: ${JSON.stringify(v.events())})`,
  );
}

describe('audio_start: emitted once, only when audio has actually started', () => {
  it('AC1: natural playback produces exactly one audio_start, and no engagement', { timeout: budgetMs(5) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      expectCounts(v, { audio: 0, engaged: 0 }, 'loading the page is not activation');
      await v.clickPlay();
      assert.deepEqual(await v.audioStates(), ['running'], 'harness: play must leave a running AudioContext');
      await v.advance(5);
      expectCounts(v, { audio: 1, engaged: 0 }, 'one click on Play with working audio');
      const hit = v.beacons.find((h) => h.event);
      assert.equal(hit.p.replace(/^\//, ''), AUDIO_START, 'the event is counted under its documented name');
    });
  });

  it('I1: nothing counts before playback, however long the page sits open or however it is poked', { timeout: budgetMs(ENGAGED_SECS * 3) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPreset(2);       // retuning while stopped is not listening
      await v.nextPresetByKey();
      await v.pressKey('ArrowUp');            // volume
      await v.advance(ENGAGED_SECS * 3);      // 30 minutes of an idle tab
      expectCounts(v, { audio: 0, engaged: 0 }, 'an open, silent page must emit no activation events (time since load is not listening)');
      assert.equal(v.events().length, 0, 'no event of any name');
    });
  });

  it('I1: autoplay blocked - pressing Play while the AudioContext stays suspended emits neither event', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({ autoplayBlocked: true }, async (v) => {
      await v.goto();
      await v.clickPlay();
      assert.equal(await v.uiPlaying(), true, 'harness: the visitor did press Play');
      assert.deepEqual(await v.audioStates(), ['suspended'], 'harness: audio is blocked by the autoplay policy');
      await v.advance(5);
      expectCounts(v, { audio: 0, engaged: 0 }, 'audio_start must wait for audio that is really running; the context is suspended');
      await v.advance(ENGAGED_SECS * 2);
      expectCounts(v, { audio: 0, engaged: 0 }, 'twenty silent minutes behind a blocked autoplay policy are not listening time');
    });
  });

  it('I1+I3: autoplay unblocked later - audio_start fires once when sound begins, and the ten minutes start then', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({ autoplayBlocked: true }, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(ENGAGED_SECS + 30); // blocked and silent for the first ten and a half minutes
      expectCounts(v, { audio: 0, engaged: 0 }, 'still blocked');
      await v.unblockAutoplay();
      await v.advance(1);
      expectCounts(v, { audio: 1, engaged: 0 }, 'the moment audio really starts is the activation');
      await v.advance(BEFORE - 1);
      expectCounts(v, { audio: 1, engaged: 0 }, 'ten minutes are counted from the first audible second, not from the click');
      await v.advance(AFTER - BEFORE);
      expectCounts(v, { audio: 1, engaged: 1 }, 'ten minutes of real playing since audio started');
    });
  });
});

describe('AC2: pause, resume and preset switches never duplicate audio_start', () => {
  it('I2: repeated pause/resume by mouse and keyboard keeps a single audio_start', { timeout: budgetMs(60) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      for (let i = 0; i < 3; i += 1) {
        await v.advance(10);
        await v.clickPlay();   // pause
        assert.equal(await v.uiPlaying(), false, 'harness: paused');
        await v.advance(10);
        await v.pressSpace();  // resume by keyboard
        assert.equal(await v.uiPlaying(), true, 'harness: playing again');
      }
      await v.pressSpace();
      await v.pressSpace();
      expectCounts(v, { audio: 1, engaged: 0 }, 'six pause/resume cycles after the first start');
    });
  });

  it('I2: switching presets - while playing, while paused, and before the first play - never re-fires audio_start', { timeout: budgetMs(60) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPreset(1);           // before the first play
      await v.clickPlay();
      expectCounts(v, { audio: 1, engaged: 0 }, 'play after choosing a preset');
      await v.clickPreset(2);           // chip, while playing
      await v.nextPresetByKey();        // keyboard, while playing
      await v.advance(1);               // let the 400 ms crossfade finish
      await v.clickPlay();              // pause
      await v.clickPreset(0);           // while paused
      await v.clickPlay();              // resume on the new preset
      await v.advance(5);
      expectCounts(v, { audio: 1, engaged: 0 }, 'preset changes in every state');
    });
  });

  it('I2: audio taken away and handed back by the platform (suspend/interrupt, then running) never re-fires audio_start', { timeout: budgetMs(60) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      for (const state of ['suspended', 'interrupted', 'suspended']) {
        await v.interruptAudio(state);
        await v.advance(5);
        await v.restoreAudio();
        await v.advance(5);
      }
      expectCounts(v, { audio: 1, engaged: 0 }, 'three OS interruptions that each ended with audio running again');
    });
  });

  it('I2: a reload is a new visit and honestly counts its own audio_start', { timeout: budgetMs(30) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      expectCounts(v, { audio: 1, engaged: 0 }, 'first visit');
      await v.reload();
      await v.clickPlay();
      await v.advance(1);
      expectCounts(v, { audio: 2, engaged: 0 }, 'one per visit: the second page load activates once more, not zero and not twice');
    });
  });
});

describe('AC3: engaged_10min is exactly once, at ten minutes of real playing time', () => {
  it('I3: ten uninterrupted minutes fire it once, at 600 s, and it never fires again', { timeout: budgetMs(ENGAGED_SECS * 3) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(BEFORE);
      expectCounts(v, { audio: 1, engaged: 0 }, `at ${BEFORE} s of playing`);
      await v.advance(AFTER - BEFORE);
      expectCounts(v, { audio: 1, engaged: 1 }, `at ${AFTER} s of playing`);
      await v.advance(ENGAGED_SECS * 2);
      await v.clickPlay();
      await v.advance(30);
      await v.pressSpace();
      await v.advance(ENGAGED_SECS);
      expectCounts(v, { audio: 1, engaged: 1 }, 'twenty more minutes with a pause and resume: still once');
    });
  });

  it('I3 (the AC scenario): a pause in the middle is not counted, and the total still fires exactly once', { timeout: budgetMs(ENGAGED_SECS * 3) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(300);                  // 300 s of playing
      await v.clickPlay();                   // pause
      await v.advance(ENGAGED_SECS);         // ten minutes paused: must not count
      expectCounts(v, { audio: 1, engaged: 0 }, 'ten paused minutes are not listening (this is what a wall-clock-since-start implementation gets wrong)');
      await v.clickPlay();                   // resume
      await v.advance(290);                  // 590 s of playing in total
      expectCounts(v, { audio: 1, engaged: 0 }, 'only 590 s of real playing so far');
      await v.advance(AFTER - 590);          // 602 s of playing in total
      expectCounts(v, { audio: 1, engaged: 1 }, 'the 300 s before the pause still count: 300 + 302 s of playing (this is what a reset-on-pause implementation gets wrong)');
    });
  });

  it('I3: time before the first Play is not listening time', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.advance(ENGAGED_SECS);         // ten minutes idle
      await v.clickPlay();
      await v.advance(400);                  // 400 s of playing, > 600 s since load
      expectCounts(v, { audio: 1, engaged: 0 }, '400 s of playing after a ten minute idle load');
      await v.advance(AFTER - 400);
      expectCounts(v, { audio: 1, engaged: 1 }, 'fires only once 600 s of playing have accumulated');
    });
  });

  for (const lost of ['suspended', 'interrupted']) {
    it(`I3: time with the AudioContext ${lost} while the page still says "playing" is not counted`, { timeout: budgetMs(ENGAGED_SECS * 3) }, async () => {
      await withVisit({}, async (v) => {
        await v.goto();
        await v.clickPlay();
        await v.advance(300);
        await v.interruptAudio(lost);
        assert.equal(await v.uiPlaying(), true, 'harness: the visitor never paused; the platform took the audio');
        await v.advance(ENGAGED_SECS);       // ten silent minutes
        expectCounts(v, { audio: 1, engaged: 0 }, `ten minutes of ${lost} audio are not listening (a flag that only tracks the Play button gets this wrong)`);
        await v.restoreAudio();
        await v.advance(290);                // 590 s of real playing
        expectCounts(v, { audio: 1, engaged: 0 }, 'only 590 s of real playing so far');
        await v.advance(AFTER - 590);
        expectCounts(v, { audio: 1, engaged: 1 }, '300 s before + 302 s after the interruption');
      });
    });
  }

  it('I3: preset switches keep the accumulator - they neither reset it nor double-fire', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(250);
      await v.clickPreset(1);
      await v.advance(100);
      await v.nextPresetByKey();
      await v.advance(100);
      await v.clickPreset(0);                // 450 s of playing, three switches
      await v.advance(BEFORE - 450);
      expectCounts(v, { audio: 1, engaged: 0 }, `at ${BEFORE} s of playing, after three preset changes`);
      await v.advance(AFTER - BEFORE);
      expectCounts(v, { audio: 1, engaged: 1 }, 'preset changes while playing must not restart the ten minutes');
    });
  });

  it('I3: preset switches while paused neither start nor reset the count', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(200);
      await v.clickPlay();                   // pause at 200 s
      await v.clickPreset(3);
      await v.nextPresetByKey();
      await v.advance(300);                  // paused for five minutes, retuning
      await v.clickPlay();
      await v.advance(395);                  // 595 s of playing
      expectCounts(v, { audio: 1, engaged: 0 }, '595 s of playing');
      await v.advance(AFTER - 595);
      expectCounts(v, { audio: 1, engaged: 1 }, '602 s of playing across a paused retune');
    });
  });

  it('I3: a backgrounded tab with throttled timers still counts real playing time, once', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(5);
      await v.setHidden(true);               // the visitor switches to their work and leaves the sound running
      assert.equal(await v.uiPlaying(), true, 'harness: still playing in the background');
      await v.advanceCoarse(BEFORE - 5);     // one-minute jumps: each timer fires at most once per jump
      expectCounts(v, { audio: 1, engaged: 0 }, `${BEFORE} s of playing in the background`);
      await v.advanceCoarse(AFTER - BEFORE + 5);
      expectCounts(v, { audio: 1, engaged: 1 }, 'ten real minutes in a background tab must count, even when ticks arrive rarely (counting ticks, not time, undercounts)');
    });
  });

  it('I3: a reload or navigation starts over - listening time is not carried between visits', { timeout: budgetMs(ENGAGED_SECS * 4) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(400);
      await v.reload();                      // new visit
      await v.clickPlay();
      await v.advance(400);                  // 800 s in total across the two visits, 400 s in this one
      expectCounts(v, { audio: 2, engaged: 0 }, 'a reload is a new visit; 400 s + 400 s must not add up to ten minutes');
      await v.goto('?p=mr');                 // navigating to a shared preset link is another new visit
      await v.clickPlay();
      await v.advance(AFTER - 100);          // 502 s in the third visit
      expectCounts(v, { audio: 3, engaged: 0 }, 'no carry across navigation either');
      await v.advance(100);
      expectCounts(v, { audio: 3, engaged: 1 }, 'the third visit reaches its own ten minutes honestly');
    });
  });
});

describe('I4: the tracking transport is never allowed to change what counts', () => {
  it('count.js still loading when Play is pressed: both events arrive once, as soon as it does', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({ holdCountJs: true }, async (v) => {
      await v.goto('', 'domcontentloaded');
      await v.clickPlay();
      await v.advance(5);
      assert.equal(v.beacons.length, 0, 'harness: nothing can have been delivered while count.js is held back');
      await v.advance(BEFORE);               // still holding: ten real minutes pass before the script arrives
      await v.advance(AFTER - BEFORE);
      v.releaseCountJs();
      await v.untilCounterReady();
      await v.advance(1);
      expectCounts(v, { audio: 1, engaged: 1 }, 'the visitor started audio and listened for ten minutes; a slow third-party script must not erase that (events dropped because window.goatcounter was not ready)');
    });
  });

  it('count.js blocked or unreachable: playback and the page are unaffected, and nothing throws', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({ blockCountJs: true }, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(ENGAGED_SECS + 30);
      assert.equal(await v.uiPlaying(), true, 'Play still works');
      assert.deepEqual(await v.audioStates(), ['running'], 'audio still runs');
      await v.clickPlay();
      await v.clickPlay();
      assert.equal(await v.uiPlaying(), true, 'pause/resume still work');
      assert.equal(v.beacons.length, 0, 'with count.js blocked there is no transport, so nothing is sent');
    });
  });
});

describe('AC4: internal traffic is namespaced and excludable (I5)', () => {
  // Contract pinned by this suite (flagged in the hand-off as a design decision): a visit to
  // `/?internal=<tag>` is internal. Every GoatCounter hit it sends - the pageview and both events -
  // is under `internal/<tag>/`, so a single path filter `internal/` removes it from numerator and
  // denominator alike. A visit without the parameter never sends an `internal/` path.
  const TAG = 'LIF-691-test';
  const PREFIX = `internal/${TAG}/`;
  const norm = (p) => String(p).replace(/^\//, '');

  it('an internal visit sends every hit - pageview and events - under internal/<tag>/', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto(`?internal=${TAG}`);
      await v.clickPreset(1);                // rewrites the URL with history.replaceState: the marker must survive that
      await v.clickPlay();
      await v.advance(AFTER);
      assert.ok(v.beacons.length >= 3, `expected a pageview and two events, got ${JSON.stringify(v.beacons.map((h) => h.p))}`);
      const outside = v.beacons.filter((h) => !norm(h.p).startsWith(PREFIX)).map((h) => h.p);
      assert.deepEqual(outside, [], 'no internal hit may land on a public path (it would inflate the denominator or numerator)');
      assert.deepEqual(
        v.events().sort(),
        [`${PREFIX}${AUDIO_START}`, `${PREFIX}${ENGAGED}`].sort(),
        'the two events keep their names under the namespace, once each',
      );
      assert.ok(v.beacons.some((h) => !h.event && norm(h.p).startsWith(PREFIX)), 'the internal pageview is namespaced too, so excluding it is symmetrical');
    });
  });

  it('a normal visit never sends an internal/ path, and sends the public event names', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto('?p=em&v=30');            // ordinary shared-link parameters
      await v.clickPlay();
      await v.advance(AFTER);
      assert.deepEqual(v.beacons.filter((h) => /^\/?internal/.test(String(h.p))), [], 'no internal namespace for real visitors');
      assert.deepEqual(v.events().sort(), [AUDIO_START, ENGAGED].sort(), 'public events are exactly the two documented names');
    });
  });

  // Representative classes of bad input, not a blacklist of strings: whatever the tag, no hit may
  // fall outside the two shapes "public" or "internal/<safe tag>/<name>", and a traversal-style tag
  // must never be able to land an event on a public path through path normalisation.
  const BAD_TAGS = {
    empty: '',
    'path separator': 'a%2Fb',
    'dot-dot traversal': '..',
    'embedded traversal': '..%2F..%2Faudio_start',
    'markup': '%3Cscript%3E',
    'whitespace': 'a%20b',
    'overlong': 'x'.repeat(300),
    'repeated parameter': `${TAG}&internal=x`,
  };
  for (const [label, raw] of Object.entries(BAD_TAGS)) {
    it(`a malformed tag (${label}) cannot smuggle a hit onto an unexpected or public-looking path`, { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
      await withVisit({}, async (v) => {
        await v.goto(`?internal=${raw}`);
        await v.clickPlay();
        await v.advance(AFTER);
        const SHAPE = /^(?:internal\/(?!\.+\/)[A-Za-z0-9._-]{1,64}\/.*|audio_start|engaged_10min|)$/;
        const bad = v.beacons.map((h) => norm(h.p)).filter((p) => !SHAPE.test(p) || p.includes('..'));
        assert.deepEqual(bad, [], 'every path is either a plain public path or a well-formed internal/<tag>/ path');
        const sawInternal = v.beacons.some((h) => norm(h.p).startsWith('internal/'));
        const sawPublicEvent = v.events().some((p) => !p.startsWith('internal/'));
        assert.ok(!(sawInternal && sawPublicEvent), 'a visit is wholly internal or wholly public, never split across the two');
      });
    });
  }
});

describe('privacy tripwire (supplementary, not AC evidence)', () => {
  it('event hits carry only the standard GoatCounter fields - no extra per-event data', { timeout: budgetMs(ENGAGED_SECS * 2) }, async () => {
    await withVisit({}, async (v) => {
      await v.goto();
      await v.clickPlay();
      await v.advance(AFTER);
      const allowed = new Set(['b', 'e', 'p', 'q', 'r', 'rnd', 's', 't']);
      const events = v.beacons.filter((h) => h.event);
      assert.equal(events.length, 2, 'precondition: both events were sent');
      for (const h of events) {
        assert.deepEqual(h.keys.filter((k) => !allowed.has(k)), [], `event ${h.p} must not add fields beyond the GoatCounter defaults (a new per-event source category needs privacy review)`);
        assert.ok(!/[?#]/.test(h.p) && !/[/]/.test(h.p.replace(/^\//, '')), `event path "${h.p}" carries no query string or sub-path`);
      }
    });
  });
});
