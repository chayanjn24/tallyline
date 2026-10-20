# Data model and generator

## The marketplace (`tallyline/catalog.py`)
| Entity | Count (seed 7) | Notes |
|---|---|---|
| Demand partners | 12 | Fictional buyers (DSPs). Each buys some formats |
| Demand sources | 30 | One per partner × region × format, e.g. "Kestrel US Video". Each has a bid appetite and a price level |
| Publishers | 10 | Each has an audience region (it sets the daily peak) and a weekend lift |
| Placements | 29 | Ad units with one format each: display, video, native or CTV |
| Apps | 157 | Heavy-tailed popularity: a few hits, a long tail |
| Deals | ~150 | Route one placement's traffic to one demand source. Has a setup (Auto/Manual), a status, a target margin and an optional QPS cap. About 22% are dedicated to one app; the rest are run of network (all the publisher's apps) |

All names are invented. The wiring comes from the seed: the same seed always builds the same marketplace.

## Traffic (`tallyline/generator.py`)
For every deal × app × hour:

```
opportunities = app popularity × placement share × daily curve × weekend lift × growth × noise
bid requests  = opportunities × deal participation   (then capped at the deal's QPS cap)
bids          = requests × the source's bid rate     (with shared noise per source and hour)
wins          = bids × the deal's win rate
impressions   = wins × the format's render rate
revenue       = impressions × CPM ÷ 1000             (CPM: format × buyer price × app quality × time of day)
payout        = revenue × (1 − target margin ± 1 pt)
```

Each hour draws from its own random stream, seeded by `(seed, hour)`. Appending new hours never changes old ones, and two machines produce identical data.

## Planted incidents
Each day, each kind has a 32% chance of happening once. The target is drawn in proportion to the entity's size, so incidents land on entities someone would notice:

| Kind | Hits | Effect | Length |
|---|---|---|---|
| `demand_outage` | a demand source | bid rate falls to ~3% of normal | 3–8 h |
| `price_drop` | a demand partner | CPMs fall to ~45% | 4–10 h |
| `publisher_drop` | a publisher | opportunities fall to ~25% | 2–6 h |
| `traffic_spike` | an app | opportunities ×4, win rate ×0.12 (bot-like) | 2–5 h |

They are stored in `planted_incident` and used only to score the detector.

## Warehouse (`sql/schema.sql`)
A star schema: six dimension tables, `fact_delivery_app` (hour × deal × app) with an hour × deal rollup, and `fact_supply_app` (hour × placement × app) with an hour × placement rollup. The views in `sql/views.sql` join the facts to `dim_deal` and scale the live hour.
