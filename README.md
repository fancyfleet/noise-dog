# noise.dog
A noise generator that runs in the browser. 
- no ads, upsells, or tracking (only privacy-friendly [GoatCounter](https://www.goatcounter.com) pageview and activation counts, no cookies)
- keyboard controls
- multiple ambient presets
- cool dog

Available online for free at [noise.dog](https://noise.dog).

Developed by [fancymatt](https://fancyma.tt)

---

## Development

This is a static site — one `index.html` + `images/`. No build step.

**Local dev setup:**
```bash
git clone git@github.com:beardbird/noise-dog.git
cd noise.dog
# Open index.html in a browser — no server required for basic dev.
# For AudioContext to work, serve locally:
npx serve . # or python3 -m http.server 8080
```

## Analytics: activation events

GoatCounter (`fancymatt.goatcounter.com`) receives pageviews plus two events (LIF-691, from the LIF-689 audit):

| Event | Fires | Never |
|---|---|---|
| `audio_start` | once per page load, the first moment audio is actually running (AudioContext `running` while playing) | on a click while the browser blocks audio; again on pause/resume or preset switch |
| `engaged_10min` | once per page load, after 10 minutes of audible playing time | for paused, suspended or interrupted time, time before the first note, or time carried across a reload |

A reload or navigation is a new visit and counts again. Preset switches keep the running total. Events are queued until GoatCounter's `count.js` has loaded, and nothing is sent (and nothing breaks) if it never loads. No per-event source or category is sent.

**Internal / test traffic.** Open `https://noise.dog/?internal=<tag>` (tag: letters, digits, `.`, `_`, `-`, up to 64 characters). Every hit from that visit, the pageview and both events, goes under `internal/<tag>/` (for example `internal/LIF-691/audio_start`), so excluding the `internal/` path prefix removes it from numerator and denominator alike. A bad or repeated tag fails closed into `internal/invalid/`. Visits without the parameter never send an `internal/` path.

**Verifying on the deployed build.** Use a real, non-automated browser: GoatCounter drops `navigator.webdriver` traffic as bots. Check `/api/v0/stats/hits` (`event: true`) for the paths above. A synthetic fire is not evidence.

## Tests

`npm ci --include=dev && npx playwright-core install chromium && npm test` (30 tests, about 100 s, hermetic). See `tests/README.md`.

## Deploy

**Workflow: feature branch → PR into `main` → Yaguchi**

Production tracks **`main`** (trunk-based; `develop` is legacy and being retired). Never pull `develop` onto production.

1. Branch from `main`, make changes, and test in the browser before committing
2. Push the branch and open a PR targeting `main`:
   ```bash
   git push origin feature/<ticket>-<slug>
   ```
3. After the PR is reviewed and merged to `main`, deploy to production (Yaguchi):
   ```bash
   ssh root@146.190.2.164 'cd /var/www/noise.dog && git pull origin main'
   ```
4. Verify: `curl -s https://noise.dog/ | sha256sum` should equal `git show origin/main:index.html | sha256sum`.

Containerized agents cannot SSH to Yaguchi; step 3 is run by Grover or Matt.

**Do not edit files directly on the server.**

Production server: Yaguchi (146.190.2.164), nginx, `/var/www/noise.dog/`
