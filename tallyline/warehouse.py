"""The DuckDB warehouse: builds the star schema, keeps it filled up to the current hour,
and hands out cursors with the live-hour variables set.

Generation is incremental. On start-up only the hours that are missing are generated, and the
newest hour is created as soon as the clock enters it. Hours older than the history window are
dropped, so a long-running instance stays the same size.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import numpy as np

from . import config
from .catalog import build_catalog
from .generator import Generator, hour_index, hour_ts

SCHEMA_VERSION = "1"
DIM_TABLES = {
    "dim_demand_partner": ("demand_partners", ["dp_id", "name", "code"]),
    "dim_demand_source": ("demand_sources", ["ds_id", "dp_id", "name", "code", "format", "region"]),
    "dim_publisher": ("publishers", ["pub_id", "name", "code", "region"]),
    "dim_placement": ("placements", ["plc_id", "pub_id", "name", "code", "format"]),
    "dim_app": ("apps", ["app_id", "pub_id", "bundle", "name"]),
    "dim_deal": (
        "deals",
        [
            "deal_id",
            "name",
            "plc_id",
            "ds_id",
            "dp_id",
            "pub_id",
            "format",
            "target_app_id",
            "setup",
            "status",
            "margin_pct",
            "qps_cap",
        ],
    ),
}
FACTS = ("fact_delivery_app", "fact_delivery", "fact_supply_app", "fact_supply")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Warehouse:
    def __init__(
        self,
        path: str = config.DB_PATH,
        seed: int = config.SEED,
        days: int = config.HISTORY_DAYS,
        clock: Callable[[], datetime] = utcnow,
        memory_limit: str = config.MEMORY_LIMIT,
    ):
        self.seed, self.days, self.clock = seed, days, clock
        self.cat = build_catalog(seed)
        self.gen = Generator(self.cat, seed)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(path)
        # a file-backed database spills to disk past this limit; an in-memory one (tests) needs more room
        self.con.execute(f"SET memory_limit = '{memory_limit}'")
        self.con.execute(f"SET threads = {config.THREADS}")
        self._lock = threading.Lock()
        self.latest_hour: int | None = None
        self._prepare()
        self.refresh()

    # ------------------------------------------------------------------ setup
    def _prepare(self) -> None:
        con = self.con
        con.execute((config.SQL_DIR / "schema.sql").read_text())
        stored = dict(con.execute("SELECT key, value FROM meta").fetchall())
        if stored and (stored.get("seed") != str(self.seed) or stored.get("schema") != SCHEMA_VERSION):
            # a different seed or layout: start over rather than mix two worlds
            for t in [*FACTS, *DIM_TABLES, "planted_incident", "meta"]:
                con.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
            con.execute((config.SQL_DIR / "schema.sql").read_text())
            stored = {}
        if not stored:
            for table, (attr, cols) in DIM_TABLES.items():
                src = getattr(self.cat, attr)
                con.register("_dim", {c: np.asarray(src[c]) for c in cols})
                con.execute(f"INSERT INTO {table} SELECT {', '.join(cols)} FROM _dim")
                con.unregister("_dim")
            con.executemany("INSERT INTO meta VALUES (?, ?)", [("seed", str(self.seed)), ("schema", SCHEMA_VERSION)])
        con.execute((config.SQL_DIR / "views.sql").read_text())

    # ------------------------------------------------------------------ data
    def window_start_hour(self, now_hour: int) -> int:
        return now_hour - now_hour % 24 - self.days * 24

    def refresh(self) -> None:
        """Generate every missing hour up to and including the current one; drop expired hours."""
        now_h = hour_index(self.clock())
        if self.latest_hour == now_h:
            return
        with self._lock:
            if self.latest_hour == now_h:
                return
            first = self.window_start_hour(now_h)
            last = self.con.execute("SELECT max(ts) FROM fact_delivery").fetchone()[0]
            start = first if last is None else max(first, hour_index(last.replace(tzinfo=UTC)) + 1)
            for a in range(start, now_h + 1, 24 * 7):  # a week per transaction keeps memory flat
                self._append(a, min(a + 24 * 7, now_h + 1))
            cutoff = hour_ts(first).replace(tzinfo=None)
            for t in FACTS:
                self.con.execute(f"DELETE FROM {t} WHERE ts < ?", [cutoff])
            self.con.execute("DELETE FROM planted_incident WHERE end_ts <= ?", [cutoff])
            self.latest_hour = now_h

    def _append(self, h0: int, h1: int) -> None:
        sup, dlv, incidents = self.gen.hours(h0, h1)
        deal_ids = np.asarray(self.cat.deals["deal_id"])
        app_ids = np.asarray(self.cat.apps["app_id"])
        plc_ids = np.asarray(self.cat.placements["plc_id"])
        d = {
            "ts": dlv["ts"],
            "deal_id": deal_ids[dlv["deal_ix"]],
            "app_id": app_ids[dlv["app_ix"]],
            **{k: dlv[k] for k in ("req", "bids", "wins", "imps", "starts", "completes", "rev", "cost")},
        }
        s = {"ts": sup["ts"], "plc_id": plc_ids[sup["plc_ix"]], "app_id": app_ids[sup["app_ix"]], "opps": sup["opps"]}
        con = self.con
        con.begin()
        try:
            con.register("_dlv", d)
            con.register("_sup", s)
            con.execute("""
                INSERT INTO fact_delivery_app
                SELECT ts, deal_id, app_id, req, bids, wins, imps, starts, completes, rev, cost FROM _dlv""")
            con.execute("""
                INSERT INTO fact_delivery
                SELECT ts, deal_id, sum(req), sum(bids), sum(wins), sum(imps), sum(starts), sum(completes),
                       sum(rev), sum(cost)
                FROM _dlv GROUP BY ts, deal_id""")
            con.execute("INSERT INTO fact_supply_app SELECT ts, plc_id, app_id, opps FROM _sup")
            con.execute("INSERT INTO fact_supply SELECT ts, plc_id, sum(opps) FROM _sup GROUP BY ts, plc_id")
            if incidents:  # a batch can easily have none (one new hour on a quiet day)
                con.executemany(
                    "INSERT OR IGNORE INTO planted_incident VALUES (?, ?, ?, ?, ?)",
                    [
                        (
                            i.kind,
                            i.level,
                            i.entity_id,
                            hour_ts(i.start_hour).replace(tzinfo=None),
                            hour_ts(i.end_hour).replace(tzinfo=None),
                        )
                        for i in incidents
                    ],
                )
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.unregister("_dlv")
            con.unregister("_sup")

    # ------------------------------------------------------------------ reading
    def live(self) -> tuple[datetime, float]:
        """The live hour (naive UTC) and the share of it that has elapsed."""
        now = self.clock()
        h = hour_index(now)
        start = hour_ts(h)
        frac = min(1.0, max(0.02, (now - start).total_seconds() / 3600.0))
        return start.replace(tzinfo=None), frac

    def cursor(self) -> duckdb.DuckDBPyConnection:
        """A per-request cursor; the data is topped up first if the clock entered a new hour."""
        self.refresh()
        cur = self.con.cursor()
        live_ts, frac = self.live()
        cur.execute(f"SET VARIABLE live_ts = TIMESTAMP '{live_ts:%Y-%m-%d %H:%M:%S}'")
        cur.execute(f"SET VARIABLE live_frac = {frac:.6f}::DOUBLE")
        return cur

    def first_ts(self) -> datetime:
        return hour_ts(self.window_start_hour(hour_index(self.clock()))).replace(tzinfo=None)

    def close(self) -> None:
        self.con.close()
