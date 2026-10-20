-- Anomaly detection, in two statements.
--
-- 1. scored: every completed hour of every entity, next to what is normal for it. "Normal" is
--    the median of the same hour of the week over the previous four weeks (Tuesday 14:00 is
--    compared with the last four Tuesdays at 14:00). Median and MAD (median absolute deviation)
--    are robust: one bad week in the history doesn't shift the baseline.
-- 2. incidents: hours whose robust z-score passes the threshold, merged into incidents when
--    they are consecutive and point the same way (the "gaps and islands" pattern).
--
-- Placeholders filled by anomalies.py from a whitelist: {key} entity column, {view} source view,
-- {filters} extra predicates. Bound parameters: $h0 history start, $s0 / $s1 scan window
-- (completed hours only), $z threshold, $min_rev minimum $ gap per hour, $min_req_share minimum
-- request gap as a share of normal, $z_single the stricter threshold for one-hour incidents.

-- name: scored
CREATE OR REPLACE TEMP TABLE scored AS
WITH series AS (
    SELECT {key} AS entity_id, ts,
           sum(req) AS req, sum(bids) AS bids, sum(wins) AS wins, sum(imps) AS imps, sum(rev) AS rev
    FROM {view}
    WHERE ts >= $h0 AND ts < $s1{filters}
    GROUP BY ALL
),
-- one row per entity per hour, so an hour with no traffic counts as zero instead of vanishing
grid AS (
    SELECT e.entity_id, g.ts
    FROM (SELECT DISTINCT entity_id FROM series) AS e
    CROSS JOIN (SELECT unnest(generate_series($h0::TIMESTAMP, $s1::TIMESTAMP - INTERVAL 1 HOUR, INTERVAL 1 HOUR)) AS ts) AS g
),
filled AS (
    SELECT g.entity_id, g.ts,
           coalesce(s.req, 0) AS req, coalesce(s.bids, 0) AS bids, coalesce(s.wins, 0) AS wins,
           coalesce(s.imps, 0) AS imps, coalesce(s.rev, 0) AS rev
    FROM grid AS g LEFT JOIN series AS s USING (entity_id, ts)
),
baseline AS (
    SELECT *,
           median(req)  OVER w AS e_req,  mad(req) OVER w AS m_req,
           median(bids) OVER w AS e_bids,
           median(wins) OVER w AS e_wins,
           median(imps) OVER w AS e_imps,
           median(rev)  OVER w AS e_rev,  mad(rev) OVER w AS m_rev,
           count(*)     OVER w AS n_ref
    FROM filled
    WINDOW w AS (PARTITION BY entity_id, dayofweek(ts), hour(ts) ORDER BY ts
                 ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING)
)
SELECT *,
       -- 1.4826 × MAD ≈ one standard deviation for normal data. The extra floor (4% of normal,
       -- plus a constant) stops small, very steady series from alarming on ordinary noise.
       (rev - e_rev) / (1.4826 * m_rev + 0.04 * e_rev + 1.0)  AS z_rev,
       (req - e_req) / (1.4826 * m_req + 0.04 * e_req + 1000) AS z_req
FROM baseline
WHERE ts >= $s0 - INTERVAL 12 HOUR AND n_ref >= 3;

-- name: incidents
WITH flags AS (
    SELECT entity_id, ts, 'rev' AS metric, z_rev AS z
    FROM scored
    WHERE ts >= $s0 AND abs(z_rev) >= $z AND abs(rev - e_rev) >= $min_rev
    UNION ALL
    SELECT entity_id, ts, 'req' AS metric, z_req AS z
    FROM scored
    WHERE ts >= $s0 AND abs(z_req) >= $z AND abs(req - e_req) >= $min_req_share * e_req
),
-- consecutive hours share the same (ts − row number) value, which becomes the island id
islands AS (
    SELECT *, ts - to_hours(row_number() OVER (PARTITION BY entity_id, metric, sign(z) ORDER BY ts)) AS island
    FROM flags
)
SELECT i.entity_id, i.metric, sign(i.z)::INTEGER AS dir,
       min(i.ts) AS start_ts, max(i.ts) + INTERVAL 1 HOUR AS end_ts, count(*) AS hours,
       max(abs(i.z)) AS peak_z,
       sum(s.req)  AS req,  sum(s.e_req)  AS e_req,
       sum(s.bids) AS bids, sum(s.e_bids) AS e_bids,
       sum(s.wins) AS wins, sum(s.e_wins) AS e_wins,
       sum(s.imps) AS imps, sum(s.e_imps) AS e_imps,
       sum(s.rev)  AS rev,  sum(s.e_rev)  AS e_rev
FROM islands AS i JOIN scored AS s USING (entity_id, ts)
GROUP BY i.entity_id, i.metric, dir, i.island
-- a single odd hour is usually noise: it needs a much stronger signal than a sustained shift
HAVING count(*) >= 2 OR max(abs(i.z)) >= $z_single
ORDER BY start_ts;
