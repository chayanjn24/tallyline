-- Tallyline warehouse: a small star schema in DuckDB.
--
--   dim_demand_partner ─┐
--   dim_demand_source ──┤
--   dim_publisher ──────┼── dim_deal ── fact_delivery_app (hour × deal × app)
--   dim_placement ──────┘                 └─ rollup → fact_delivery (hour × deal)
--   dim_app ──────────────────────────── fact_supply_app (hour × placement × app)
--                                           └─ rollup → fact_supply (hour × placement)
--
-- Queries read the smallest table that can answer them: the app-grain facts are only touched
-- when an app filter is on or the question is about apps.

CREATE TABLE IF NOT EXISTS dim_demand_partner (
    dp_id      INTEGER PRIMARY KEY,
    name       VARCHAR NOT NULL,
    code       VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_demand_source (
    ds_id      INTEGER PRIMARY KEY,
    dp_id      INTEGER NOT NULL,
    name       VARCHAR NOT NULL,
    code       VARCHAR NOT NULL,
    format     VARCHAR NOT NULL,
    region     VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_publisher (
    pub_id     INTEGER PRIMARY KEY,
    name       VARCHAR NOT NULL,
    code       VARCHAR NOT NULL,
    region     VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_placement (
    plc_id     INTEGER PRIMARY KEY,
    pub_id     INTEGER NOT NULL,
    name       VARCHAR NOT NULL,
    code       VARCHAR NOT NULL,
    format     VARCHAR NOT NULL          -- display | video | native | ctv
);

CREATE TABLE IF NOT EXISTS dim_app (
    app_id     INTEGER PRIMARY KEY,
    pub_id     INTEGER NOT NULL,
    bundle     VARCHAR NOT NULL,         -- store id, e.g. com.pinecone.wordtiles
    name       VARCHAR NOT NULL
);

-- a deal routes one placement's traffic to one demand source
CREATE TABLE IF NOT EXISTS dim_deal (
    deal_id       INTEGER PRIMARY KEY,
    name          VARCHAR NOT NULL,
    plc_id        INTEGER NOT NULL,
    ds_id         INTEGER NOT NULL,
    dp_id         INTEGER NOT NULL,
    pub_id        INTEGER NOT NULL,
    format        VARCHAR NOT NULL,
    target_app_id INTEGER NOT NULL,      -- 0 = run of network (all the publisher's apps)
    setup         VARCHAR NOT NULL,      -- Auto | Manual
    status        VARCHAR NOT NULL,      -- On | Paused
    margin_pct    INTEGER NOT NULL,
    qps_cap       INTEGER NOT NULL       -- 0 = no cap
);

CREATE TABLE IF NOT EXISTS fact_delivery_app (
    ts         TIMESTAMP NOT NULL,       -- start of the UTC hour
    deal_id    INTEGER NOT NULL,
    app_id     INTEGER NOT NULL,
    req        BIGINT NOT NULL,          -- bid requests sent
    bids       BIGINT NOT NULL,
    wins       BIGINT NOT NULL,
    imps       BIGINT NOT NULL,
    starts     BIGINT NOT NULL,          -- video starts (video / CTV only)
    completes  BIGINT NOT NULL,
    rev        DOUBLE NOT NULL,          -- gross revenue, USD (what the buyer pays)
    cost       DOUBLE NOT NULL           -- publisher payout, USD
);

CREATE TABLE IF NOT EXISTS fact_delivery (
    ts TIMESTAMP NOT NULL, deal_id INTEGER NOT NULL,
    req BIGINT, bids BIGINT, wins BIGINT, imps BIGINT, starts BIGINT, completes BIGINT,
    rev DOUBLE, cost DOUBLE
);

CREATE TABLE IF NOT EXISTS fact_supply_app (
    ts         TIMESTAMP NOT NULL,
    plc_id     INTEGER NOT NULL,
    app_id     INTEGER NOT NULL,
    opps       BIGINT NOT NULL           -- ad opportunities offered by the publisher
);

CREATE TABLE IF NOT EXISTS fact_supply (
    ts TIMESTAMP NOT NULL, plc_id INTEGER NOT NULL, opps BIGINT
);

-- ground truth: incidents the generator planted (used to score the anomaly detector)
CREATE TABLE IF NOT EXISTS planted_incident (
    kind       VARCHAR NOT NULL,
    level      VARCHAR NOT NULL,
    entity_id  INTEGER NOT NULL,
    start_ts   TIMESTAMP NOT NULL,
    end_ts     TIMESTAMP NOT NULL,       -- exclusive
    UNIQUE (kind, level, entity_id, start_ts)
);

CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
