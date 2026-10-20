# Anomaly detection

Code: [`sql/anomalies.sql`](../sql/anomalies.sql) (the detection) and [`tallyline/anomalies.py`](../tallyline/anomalies.py) (de-duplication, explanation, linking, scoring).

## 1. A baseline per entity, per hour of the week
Traffic has strong daily and weekly patterns, so "normal" for Tuesday 14:00 is the **median of the last four Tuesdays at 14:00**. The spread is the **median absolute deviation (MAD)**. Both are robust: one bad week in the history barely moves them, which a mean and standard deviation would not survive.

```sql
median(rev) OVER w AS e_rev, mad(rev) OVER w AS m_rev
WINDOW w AS (PARTITION BY entity_id, dayofweek(ts), hour(ts) ORDER BY ts
             ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING)
```

Missing hours are filled with zeros first (a grid of entity × hour), so a silent hour counts as zero instead of disappearing.

## 2. A robust z-score with a floor
`z = (actual − normal) ÷ (1.4826 × MAD + 4% of normal + a small constant)`. The factor 1.4826 turns MAD into a standard-deviation equivalent. The floor stops small, very steady series from alarming on ordinary noise.

## 3. Rules
| Rule | Value | Why |
|---|---|---|
| \|z\| ≥ 4 | per hour | Far outside normal noise |
| Revenue gap ≥ $15 / hour, or request gap ≥ 25% of normal | per hour | Statistically odd but immaterial hours are not worth anyone's time |
| One-hour incidents need \|z\| ≥ 7 | per incident | Most single odd hours were noise in testing |
| History ≥ 3 reference weeks | per hour | No baseline, no verdict |
| The live hour is never scanned | | It isn't complete yet |

## 4. Incidents: gaps and islands
Consecutive flagged hours in the same direction become one incident. In a run of consecutive hours, `ts − row_number() hours` is constant, which gives each run (island) an id:

```sql
ts - to_hours(row_number() OVER (PARTITION BY entity_id, metric, sign(z) ORDER BY ts)) AS island
```

## 5. Levels, and avoiding double counting
Demand partners, demand sources, publishers and apps are scanned for revenue and requests. A problem often shows at two levels (a source outage also dents its partner):
- If one child explains at least 60% of its parent's incident, the child is kept, because it's more specific.
- If several children move together, the parent is kept, because it's one broad problem.
- Revenue and request alerts on the same entity at the same time are merged.

## 6. Likely cause
`revenue = requests × bid rate × win rate × render rate × eCPM`. Each step is compared with its normal value over the incident hours. The step with the largest change on a log scale (so −50% and +100% weigh the same) is named the driver, for example *"Bid rate 12.1% → 0.4%: the buyer stopped bidding"*.

## 7. Knock-on alerts across the marketplace
When a buyer stops bidding, the publishers it buys from lose revenue too. Those alerts are real, but they aren't the root cause. An alert A is filed under B when:
- B is on the side where A's driver points (a demand-side driver means it started with a buyer), and the two overlap in time, and
- **share(A through B) × B's change ≥ half of A's change.** Shares come from the four baseline weeks (one query builds the partner × source × publisher × app traffic matrix).

That rule handles both cases: a big share with a big change (an outage at a publisher's main buyer), and a small share with a huge change (an app whose traffic quadrupled pushing up its buyers' requests).

## 8. Scoring
`scorecard()` matches alerts with the planted incidents. A match needs time overlap plus the same entity, a parent or child, or ≥ 15% shared traffic. Results are in the [README](../README.md#does-the-detector-work), and `tests/test_anomalies.py` requires recall ≥ 90% and precision ≥ 80% on two seeds.

**Limits.** Planted incidents are sharp steps on clean data. Real data adds gradual drifts, holidays, tracking changes and incidents that overlap. Next steps would be a seasonal baseline for holidays, a change-point method for slow drifts, and feedback ("not an issue") to tune thresholds per entity.
