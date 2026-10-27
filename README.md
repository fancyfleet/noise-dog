# noise.dog
A noise generator that runs in the browser. 
- no ads, upsells, or tracking
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
