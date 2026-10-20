# Deploy to Render

Render builds the Dockerfile from your GitHub repo and gives you a public `https://….onrender.com` URL. The live instance is [tallyline.onrender.com](https://tallyline.onrender.com). No database or secrets are needed: the data is generated inside the container.

## Steps
1. Push the repository to GitHub (this one lives at [chayanjn24/tallyline](https://github.com/chayanjn24/tallyline)).
2. Sign in at [render.com](https://render.com) with GitHub.
3. **New → Blueprint**, pick the repository. Render reads [`render.yaml`](../render.yaml) and proposes one web service, `tallyline`, on the free plan.
4. **Apply.** The first build takes a few minutes: it installs dependencies and generates ~100 days of data (`python -m tallyline build`).
5. Open the URL. `/healthz` should return `{"ok": true}`.

Every push to the default branch redeploys automatically (`autoDeploy: true`).

## Things to know
- **Free instances sleep after ~15 minutes idle.** The first visit after that takes about 30–60 s to wake up; after that, pages load normally. A paid instance stays awake.
- **Memory:** the free plan has 512 MB. DuckDB is capped at 384 MB (`TALLYLINE_MEMORY`) and spills to disk past that.
- **Data:** the container's disk is temporary. On every restart the image's built-in history is topped up to the current hour, which takes a second or two.
- **CPU:** the free plan's CPU is small, so one anomaly scan takes ~9 s there. The server runs the scans every visitor opens first (today's alerts and the 30-day scorecard) in the background at start-up and each new hour, so visitors get them from the cache. `TALLYLINE_WARM=0` turns this off.
- **A different marketplace:** set `TALLYLINE_SEED` to another number in the Render dashboard.

