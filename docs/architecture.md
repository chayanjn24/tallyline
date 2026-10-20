# Architecture

One Python process serves the API and the static front end, and reads a single DuckDB file.

```
browser ── GET /api/* (JSON) ──► FastAPI (tallyline/api.py)
   │                                 │  one DuckDB cursor per request
   └── GET /, /js, /css ─► StaticFiles│
                                     ▼
                       Warehouse (tallyline/warehouse.py)
                         ├─ refresh(): generate missing hours, drop expired ones
                         ├─ live(): the current hour and the share elapsed
                         └─ DuckDB file: data/tallyline.duckdb
                                     ▲
                       Generator (tallyline/generator.py) ← Catalog (tallyline/catalog.py)
```

## Request flow
1. `api.py` parses the query string into a `Scope` (`scope.py`): the date range, the comparison window and filters, all validated. Bad input becomes a `400 {"error": …}`.
2. `Warehouse.cursor()` tops up the data if the clock entered a new hour, then sets the live-hour session variables (`live_ts`, `live_frac`) on a new cursor.
3. `queries.py` runs SQL against the views in `sql/views.sql` and returns additive sums only.
4. The browser derives every rate (`web/js/metrics.js`) and renders.

## Data freshness
- On start-up, the hours from (today − `TALLYLINE_DAYS`) to the current hour are generated. The Docker image does this at build time, so a container only adds the hours since the build.
- The current hour is stored at its full-hour value and scaled at query time by the share of the hour elapsed. It fills in smoothly without rewriting rows.
- Hours older than the window are deleted on refresh, so a long-running instance stays the same size.

## Choosing a table
| Question | Table |
|---|---|
| Anything without an app filter or app breakdown | `fact_delivery` (hour × deal rollup, ~150 rows/hour) |
| App filter, app breakdown, deal → app drill-down, link shares | `fact_delivery_app` (hour × deal × app, ~1,700 rows/hour) |
| Opportunities | `fact_supply` / `fact_supply_app` |

## Performance (laptop, 100 days, ~4M app-grain rows)
| Call | Time |
|---|---|
| `/api/summary`, 1 day | ~25 ms |
| `/api/breakdown`, any level, 1 day | 7–30 ms |
| `/api/summary` with an app filter, 31 days | ~120 ms |
| `/api/anomalies`, 1 week (4 levels, 4-week baseline) | ~0.5 s, then cached for the hour (today's scan and the 30-day scorecard are pre-computed each hour) |
| Cold start (generate 100 days) | ~3 s |

## Front end
Plain ES modules, no build step. `main.js` is the router: the URL hash holds the page, range, filters and metric, so every view is a link. Each page module exposes `mount`, `load` and `unmount`. Loads are sequence-guarded, so a slow response can never overwrite a newer page. A 3-minute client cache with in-flight de-duplication sits in `api.js`.

| Folder | Contents |
|---|---|
| `web/js/` | `main` (boot, router, keys), `api`, `state` (hash ↔ state), `periods`, `format` (the only place that decides good/bad colour), `metrics`, `chart`, `views` (saved views), `theme`, `report` |
| `web/js/components/` | shell, filter bar, table, columns, column picker, CSV, deal → apps, drawer, ⌘K, select |
| `web/js/pages/` | overview, entity (all six levels), apps (row selection), anomalies, compare, heatmap |
