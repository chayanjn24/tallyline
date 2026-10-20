# Decisions

A running log of product and technical decisions. Newest last. Dates are absolute.

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-10-20 | Tallyline is a standalone portfolio project, independent of any real ad platform | It's built for public demos, so it contains no real company data, names, schemas or credentials |
| D2 | 2026-10-20 | All data is synthetic and generated on the fly, deterministically, from a seed | Anyone can run it with no database access, and the numbers are reproducible |
| D3 | 2026-10-20 | Stack: Python data generator → DuckDB warehouse → FastAPI → framework-free ES-module front end | Each layer shows an analyst-relevant skill: data modelling, SQL, an API and a UI. One process, no build step |
| D4 | 2026-10-20 | Domain: an ad exchange. Demand partners → demand sources → deals ← placements ← publishers, plus apps | A realistic two-sided marketplace with a clear funnel (opportunities → requests → bids → wins → impressions → revenue) |
| D5 | 2026-10-20 | Every timestamp is UTC. No time-zone toggle | Keeps the SQL and the comparison logic simple to read |
| D6 | 2026-10-20 | The newest hour is "live": shown at the share of the hour elapsed, drawn as a projection, never used in a Δ | It mimics a real streaming dashboard and keeps comparisons fair |
| D7 | 2026-10-20 | Extra features: **anomaly detection** (robust hour-of-week baseline + root-cause driver) and **saved views + printable report** | The two features that show the most analytical depth for a monitoring dashboard |
| D8 | 2026-10-20 | Planted incidents are stored as ground truth, and the detector is scored against them in the tests | The detector's precision and recall are measured, not claimed |
| D9 | 2026-10-20 | Design: near-monochrome with green = good, red = bad; one brand accent, electric indigo `#7C83FF`, used sparingly; light + dark themes | A calm UI where the colour carries meaning |
| D10 | 2026-10-20 | Deploy target: Render (Docker, free tier) | Simplest path from GitHub to a public URL |
| D11 | 2026-10-20 | Anomaly alerts that are knock-on effects are filed under their root cause, by measured traffic share × the cause's change (≥ 50% explained) | Recall was 100% from the start, but precision was 33% until real knock-on effects were grouped; now 94–100% across seeds |
| D12 | 2026-10-20 | A one-hour incident needs \|z\| ≥ 7; longer incidents \|z\| ≥ 4 | Single odd hours were the remaining false alarms |
| D13 | 2026-10-20 | Front-end files are served with `Cache-Control: no-cache` (ETag revalidation) | No build step means no hashed file names; without this, a deploy could leave stale JS in browsers |
| D14 | 2026-10-20 | Saved views live in the viewer's browser (localStorage); the report is a print-styled page of the same view | No accounts in a portfolio demo; a shared link already carries the whole view in its URL |
| D15 | 2026-10-21 | The server pre-computes today's anomaly scan and the 30-day scorecard in a background thread, at start-up and each new hour; the anomaly cache key is the range + filters (not the raw query string) | On Render's free CPU a scan takes ~9 s, and the Overview asks for today's alerts on every first load |
