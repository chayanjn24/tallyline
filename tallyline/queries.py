"""SQL behind the API: summary (KPIs + hourly series), breakdowns per level, filter options,
and the deal → app drill-down.

All metric math that needs more than a SUM (eCPM, fill, win rate…) happens in the browser from
these sums, so every number on screen is traceable to an additive column. See docs/metrics.md.
"""

from __future__ import annotations

import re
from datetime import datetime

from .catalog import FORMATS
from .dims import Dims
from .scope import COLUMN, Scope

SUMS = ("req", "bids", "wins", "imps", "starts", "completes", "rev", "cost")
MONEY = {"rev", "cost"}

# page dimension → the level it lists, its key column, and the child it counts
DIMS = {
    "demand_partner": ("dp", "dp_id", "ds_id"),
    "demand_source": ("ds", "ds_id", "deal_id"),
    "deal": ("deal", "deal_id", None),
    "publisher": ("pub", "pub_id", "plc_id"),
    "placement": ("plc", "plc_id", "deal_id"),
    "app": ("app", "app_id", "deal_id"),
}


def run(cur, sql: str, params: dict) -> list[dict]:
    """Execute with only the $params the statement uses; rows come back as dicts."""
    used = set(re.findall(r"\$(\w+)", sql))
    res = cur.execute(sql, {k: v for k, v in params.items() if k in used})
    cols = [d[0] for d in res.description]
    return [dict(zip(cols, r, strict=True)) for r in res.fetchall()]


def _clean(d: dict) -> dict:
    """Round for JSON: money to 4 decimals, counts to whole numbers."""
    out = {}
    for k, v in d.items():
        if isinstance(v, float):
            out[k] = round(v, 4) if (k in MONEY or k.startswith(("rev", "cost", "prevRev", "cmpRev"))) else round(v, 2)
        else:
            out[k] = v
    return out


def label(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H")


# ----------------------------------------------------------------------------- summary
def summary(cur, scope: Scope) -> dict:
    view = "delivery_app" if scope.needs_app_grain else "delivery"
    p = scope.params()
    rows = run(
        cur,
        f"""
        SELECT ts, format, {", ".join(f"sum({m}) AS {m}" for m in SUMS)}, max(w) AS w
        FROM {view}
        WHERE ((ts >= $c0 AND ts < $c1) OR (ts >= $p0 AND ts < $p1)){scope.where()}
        GROUP BY ts, format
        ORDER BY ts""",
        p,
    )

    opps_ok = not scope.demand_filtered
    opps = {}
    if opps_ok:
        sview = "supply_app" if scope.needs_app_grain else "supply"
        for r in run(
            cur,
            f"""
                SELECT ts, sum(opps) AS opps FROM {sview}
                WHERE ((ts >= $c0 AND ts < $c1) OR (ts >= $p0 AND ts < $p1)){scope.where("supply")}
                GROUP BY ts""",
            p,
        ):
            opps[r["ts"]] = r["opps"]

    # fold formats into one row per hour, keeping the format split
    hours: dict[datetime, dict] = {}
    for r in rows:
        h = hours.setdefault(
            r["ts"],
            {
                "ts": r["ts"],
                "w": r["w"],
                **{m: 0.0 for m in SUMS},
                "fmt": {f: {"rev": 0.0, "cost": 0.0} for f in FORMATS},
            },
        )
        for m in SUMS:
            h[m] += r[m] or 0.0
        h["fmt"][r["format"]]["rev"] += r["rev"] or 0.0
        h["fmt"][r["format"]]["cost"] += r["cost"] or 0.0
    for ts, o in opps.items():
        hours.setdefault(
            ts, {"ts": ts, "w": 1.0, **{m: 0.0 for m in SUMS}, "fmt": {f: {"rev": 0.0, "cost": 0.0} for f in FORMATS}}
        )["opps"] = o

    (c0, c1), (p0, p1) = scope.cur, scope.prev
    cur_h = [h for t, h in sorted(hours.items()) if c0 <= t < c1]
    prev_h = [h for t, h in sorted(hours.items()) if p0 <= t < p1]

    def side(hs: list[dict]) -> dict:
        tot = {m: sum(h[m] for h in hs) for m in SUMS}
        tot["opps"] = sum(h.get("opps", 0) for h in hs) if opps_ok else None
        tot["hours"] = sum(min(1.0, h["w"]) for h in hs)  # the live hour counts as the share elapsed
        tot["fmt"] = {f: {k: round(sum(h["fmt"][f][k] for h in hs), 4) for k in ("rev", "cost")} for f in FORMATS}
        return _clean(tot)

    def series(hs: list[dict]) -> list[dict]:
        out = []
        for h in hs:
            o = {"k": label(h["ts"]), "label": label(h["ts"]), **{m: h[m] for m in SUMS}}
            if opps_ok:
                o["opps"] = h.get("opps", 0)
            if scope.live_ts is not None and h["ts"] == scope.live_ts:
                o["partial"] = round(h["w"], 4)
            out.append(_clean(o))
        return out

    res = {
        "start": str(scope.start),
        "end": str(scope.end),
        "pstart": str(scope.pstart),
        "pend": str(scope.pend),
        "tz": "UTC",
        "latestUtc": label(scope.live_ts) if scope.live_ts else None,
        "total": side(cur_h),
        "prev": side([h for h in prev_h if h["ts"] < scope.pcut]),
        "hours": series(cur_h),
        "prevHours": series(prev_h),
        "oppsAvailable": opps_ok,
        "cmp": {"completedOnly": scope.running, "curTo": label(scope.cut), "prevTo": label(scope.pcut)},
    }
    if scope.running:
        res["cur"] = side([h for h in cur_h if h["ts"] < scope.cut])
    return res


# ----------------------------------------------------------------------------- breakdown
def breakdown(cur, scope: Scope, dim: str, dims: Dims) -> dict:
    level, key, child = DIMS[dim]
    app_grain = dim == "app" or scope.needs_app_grain
    view = "delivery_app" if app_grain else "delivery"
    p = scope.params()
    in_cur, in_cmp, in_prev = "ts >= $c0 AND ts < $c1", "ts >= $c0 AND ts < $cut", "ts >= $p0 AND ts < $pcut"
    fmt_cols = ", ".join(f"sum(rev) FILTER (WHERE {in_cur} AND format = '{f}') AS rev{f.capitalize()}" for f in FORMATS)
    count_col = f", count(DISTINCT {child}) FILTER (WHERE {in_cur} AND req > 0) AS count" if child else ""
    rows = run(
        cur,
        f"""
        SELECT {key} AS id,
               {", ".join(f"sum({m}) FILTER (WHERE {in_cur}) AS {m}" for m in SUMS)},
               sum(rev) FILTER (WHERE {in_cmp}) AS cmpRev,  sum(req) FILTER (WHERE {in_cmp}) AS cmpReq,
               sum(rev) FILTER (WHERE {in_prev}) AS prevRev, sum(req) FILTER (WHERE {in_prev}) AS prevReq,
               {fmt_cols}{count_col}
        FROM {view}
        WHERE ((ts >= $c0 AND ts < $c1) OR (ts >= $p0 AND ts < $p1)){scope.where()}
        GROUP BY 1""",
        p,
    )

    opps_ok = not scope.demand_filtered and level in ("pub", "plc", "app")
    opps = {}
    if opps_ok:
        sview = "supply_app" if app_grain else "supply"
        opps = {
            r["id"]: r["opps"]
            for r in run(
                cur,
                f"""
            SELECT {key} AS id, sum(opps) AS opps FROM {sview}
            WHERE ts >= $c0 AND ts < $c1{scope.where("supply")} GROUP BY 1""",
                p,
            )
        }

    out = []
    for r in rows:
        if not (r["req"] or r["prevReq"]):
            continue
        r = {k: (0.0 if v is None and k != "id" else v) for k, v in r.items()}
        r.update(dims.attrs(level, r["id"]))
        r["opps"] = opps.get(r["id"], 0) if opps_ok else None
        if not scope.running:
            r["cmpRev"], r["cmpReq"] = r["rev"], r["req"]
        out.append(_clean(r))
    out.sort(key=lambda r: -r["rev"])
    return {"dim": dim, "rows": out, "oppsAvailable": not scope.demand_filtered}


# ----------------------------------------------------------------------------- options
def options(cur, scope: Scope, level: str, dims: Dims) -> dict:
    """Every entity of a level with its revenue and requests in range (for pickers and search)."""
    key = COLUMN[level]
    view = "delivery_app" if level == "app" or scope.needs_app_grain else "delivery"
    act = {
        r["id"]: r
        for r in run(
            cur,
            f"""
        SELECT {key} AS id, sum(rev) AS rev, sum(req) AS req FROM {view}
        WHERE ts >= $c0 AND ts < $c1{scope.where()} GROUP BY 1""",
            scope.params(),
        )
    }
    opts = []
    for eid, name in dims.names(level).items():
        a = act.get(eid)
        if scope.filters and not a:
            continue  # narrowed by other filters: only entities with traffic in that scope
        opts.append(
            {
                "id": eid,
                "name": name,
                "rev": round(a["rev"], 2) if a else 0,
                "req": round(a["req"]) if a else 0,
                **({"sub": dims.attrs(level, eid).get("bundle")} if level == "app" else {}),
            }
        )
    opts.sort(key=lambda o: (-o["rev"], o["name"]))
    return {"level": level, "options": opts}


# ----------------------------------------------------------------------------- deal → apps
def deal_app_counts(cur, scope: Scope) -> dict:
    """Apps with traffic per deal: one app = dedicated deal, more = run of network."""
    rows = run(
        cur,
        f"""
        SELECT deal_id, count(*) AS n, arg_max(app_id, rev) AS top
        FROM (SELECT deal_id, app_id, sum(rev) AS rev FROM delivery_app
              WHERE ts >= $c0 AND ts < $c1{scope.where()} GROUP BY 1, 2 HAVING sum(req) > 0)
        GROUP BY 1""",
        scope.params(),
    )
    return {"counts": {str(r["deal_id"]): {"n": r["n"], "top": r["top"]} for r in rows}}


def deal_apps(cur, scope: Scope, deal_id: int, dims: Dims, limit: int = 5) -> dict:
    p = {**scope.params(), "deal": deal_id}
    rows = run(
        cur,
        f"""
        SELECT app_id, {", ".join(f"sum({m}) AS {m}" for m in SUMS)}
        FROM delivery_app
        WHERE ts >= $c0 AND ts < $c1 AND deal_id = $deal{scope.without("deal").where()}
        GROUP BY 1 ORDER BY rev DESC, req DESC LIMIT {int(limit)}""",
        p,
    )
    for r in rows:
        r.update(dims.attrs("app", r["app_id"]))
    return {"rows": [_clean(r) for r in rows]}
