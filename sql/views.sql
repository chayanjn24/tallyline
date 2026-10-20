-- Analysis views: facts joined to their dimensions, with the live hour scaled.
--
-- The newest hour is still "arriving". It is stored at its full-hour value and scaled here by
-- the share of the hour that has elapsed (live_frac), so the dashboard fills up in real time.
-- live_ts and live_frac are session variables, set before every query (see warehouse.py).
-- Every other hour has weight 1.

CREATE OR REPLACE VIEW delivery AS
WITH f AS (
    SELECT *, CASE WHEN ts = getvariable('live_ts') THEN getvariable('live_frac') ELSE 1.0 END AS w
    FROM fact_delivery
)
SELECT f.ts, f.deal_id, d.ds_id, d.dp_id, d.plc_id, d.pub_id, d.format, f.w,
       f.req * f.w AS req, f.bids * f.w AS bids, f.wins * f.w AS wins, f.imps * f.w AS imps,
       f.starts * f.w AS starts, f.completes * f.w AS completes, f.rev * f.w AS rev, f.cost * f.w AS cost
FROM f JOIN dim_deal d USING (deal_id);

CREATE OR REPLACE VIEW delivery_app AS
WITH f AS (
    SELECT *, CASE WHEN ts = getvariable('live_ts') THEN getvariable('live_frac') ELSE 1.0 END AS w
    FROM fact_delivery_app
)
SELECT f.ts, f.deal_id, f.app_id, d.ds_id, d.dp_id, d.plc_id, d.pub_id, d.format, f.w,
       f.req * f.w AS req, f.bids * f.w AS bids, f.wins * f.w AS wins, f.imps * f.w AS imps,
       f.starts * f.w AS starts, f.completes * f.w AS completes, f.rev * f.w AS rev, f.cost * f.w AS cost
FROM f JOIN dim_deal d USING (deal_id);

CREATE OR REPLACE VIEW supply AS
SELECT s.ts, s.plc_id, p.pub_id,
       s.opps * CASE WHEN s.ts = getvariable('live_ts') THEN getvariable('live_frac') ELSE 1.0 END AS opps
FROM fact_supply s JOIN dim_placement p USING (plc_id);

CREATE OR REPLACE VIEW supply_app AS
SELECT s.ts, s.plc_id, s.app_id, p.pub_id,
       s.opps * CASE WHEN s.ts = getvariable('live_ts') THEN getvariable('live_frac') ELSE 1.0 END AS opps
FROM fact_supply_app s JOIN dim_placement p USING (plc_id);
