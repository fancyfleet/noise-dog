# Tests

`tests/activation-events.test.mjs` is the executable spec for the GoatCounter activation events
(`audio_start`, `engaged_10min`, and the `internal/` namespace). It drives the real `index.html` in
real Chromium; see the header of `tests/support/visit.mjs` for what is controlled (network, clock,
Web Audio state) and why.

```bash
npm ci --include=dev            # --include=dev if NODE_ENV=production is set
npx playwright-core install chromium   # once per machine; the pinned version is in package.json
npm test                        # ~35 s; no network access and no extra environment needed
```

`tests/fixtures/goatcounter-count.js` is the unmodified `https://gc.zgo.at/count.js` (sha256
`792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0`, fetched 2026-10-27). Refresh it
deliberately if GoatCounter ships a new client.

## LIF-938: the distinct /brown-noise destination

Three suites pin the bounded SEO test (spec: `fancyforge/projects/software/noise-dog/marketing/2026-11-17-indexation-experiment.md`, "Exact scope"). The contract copy lives once, in `tests/support/brown-noise-contract.mjs`.

| Suite | What it drives |
|---|---|
| `seo-route.brown-noise-distinct-document.test.mjs` | The bytes the origin answers for `/`, `/brown-noise` and the other preset routes (canonical, og:url, title, description, About copy, the one homepage link, nothing added), plus real JS-disabled browser loads. |
| `seo-route.brown-noise-player-and-analytics.test.mjs` | The new document in real Chromium: Deep Focus selected without autoplay, every preset/volume/query control, LIF-691 analytics and the `internal/` namespace, LIF-745 craft. |
| `seo-route.brown-noise-layout.test.mjs` | Real layout at 1280×800, 390×844 and 320×568: player geometry identical to the base page, no overflow, the longer About copy reachable, the homepage link visible and usable. |

`tests/support/serve.mjs` is the static-origin model (which file answers which path). It reproduces
production nginx as observed on 2026-11-17 and adds ONE rule: `/<name>` is answered by `<name>.html`.
Production needs that one-line `try_files` change (or equivalent) for any distinct `/brown-noise`
document; see its header comment. `tests/fixtures/home-at-base-94e83ed.html` is the homepage at
`main@94e83ed` (sha256 `ec2125e4…8e5c`, the live baseline); the layout and "homepage unchanged" rows
compare against it.
