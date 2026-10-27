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
