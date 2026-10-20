"""Anomaly detection: run sql/anomalies.sql per level, remove duplicates, explain each incident.

Explaining: revenue is a product of funnel steps,

    revenue = requests × bid rate × win rate × render rate × eCPM / 1000

so for each incident we compare every step with its normal value and name the step that moved
the most (on a log scale, so −50% and +100% count the same). That step is the likely cause.

Scoring: the generator plants incidents and records them. scorecard() matches detections to
them, so precision and recall are measured, not claimed.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timedelta

from . import config
from .dims import Dims
from .links import SIDE, Links
from .queries import label, run
from .scope import Scope

# level → (key column, view); demand partners / sources / publishers use the hour × deal rollup
LEVELS = {
    "dp": ("dp_id", "delivery"),
    "ds": ("ds_id", "delivery"),
    "pub": ("pub_id", "delivery"),
    "app": ("app_id", "delivery_app"),
}
LEVEL_NAME = {"dp": "Demand partner", "ds": "Demand source", "pub": "Publisher", "app": "App"}
GT_LEVEL = {"demand_partner": "dp", "demand_source": "ds", "publisher": "pub", "app": "app"}
CHILD = {"dp": "ds", "pub": "app"}

Z = 4.0  # robust z-score threshold per hour
Z_SINGLE = 7.0  # …and for an incident that lasts a single hour
MIN_REV = 15.0  # $ per hour
MIN_REQ_SHARE = 0.25  # a request anomaly must be at least 25% away from normal
BASELINE_DAYS = 28
CONTEXT_H = 6  # hours of context drawn either side of an incident
LINK_SHARE = 0.15  # scorecard: a detection counts for an incident on an entity carrying ≥15% of its traffic
LINK_EXPLAINS = 0.5  # B explains A when share(A through B) × B's change covers half of A's change

_SQL = {}


def _statements() -> dict[str, str]:
    if not _SQL:
        text = (config.SQL_DIR / "anomalies.sql").read_text()
        for name, body in re.findall(r"-- name: (\w+)\n(.*?)(?=\n-- name: |\Z)", text, re.S):
            _SQL[name] = body.strip().rstrip(";")
    return _SQL


def _ratio(a: float, b: float) -> float | None:
    return a / b if b else None


FUNNEL = [
    # name, actual(x), normal(x), formatter
    ("Requests", lambda x: x["req"], lambda x: x["e_req"], lambda v: f"{v:,.0f}"),
    (
        "Bid rate",
        lambda x: _ratio(x["bids"], x["req"]),
        lambda x: _ratio(x["e_bids"], x["e_req"]),
        lambda v: f"{v * 100:.1f}%",
    ),
    (
        "Win rate",
        lambda x: _ratio(x["wins"], x["bids"]),
        lambda x: _ratio(x["e_wins"], x["e_bids"]),
        lambda v: f"{v * 100:.1f}%",
    ),
    (
        "Render rate",
        lambda x: _ratio(x["imps"], x["wins"]),
        lambda x: _ratio(x["e_imps"], x["e_wins"]),
        lambda v: f"{v * 100:.1f}%",
    ),
    (
        "eCPM",
        lambda x: _ratio(x["rev"] * 1000, x["imps"]),
        lambda x: _ratio(x["e_rev"] * 1000, x["e_imps"]),
        lambda v: f"${v:,.2f}",
    ),
]
CAUSE = {
    ("Requests", -1): "Less traffic: fewer bid requests than usual reached this entity.",
    ("Requests", 1): "More traffic than usual.",
    ("Bid rate", -1): "The buyer stopped bidding: an outage, a timeout, or a paused campaign.",
    ("Bid rate", 1): "Buyers are bidding on more requests than usual.",
    (
        "Win rate",
        -1,
    ): "Bids are losing auctions, or the traffic is low quality (it looks like bot traffic when requests also jumped).",
    ("Win rate", 1): "Bids are winning more auctions than usual.",
    ("Render rate", -1): "Won auctions are not turning into impressions: a rendering or creative problem.",
    ("Render rate", 1): "More won auctions than usual are rendering.",
    ("eCPM", -1): "Price drop: buyers are paying less per impression.",
    ("eCPM", 1): "Price rise: buyers are paying more per impression.",
}


def _driver(x: dict) -> dict | None:
    best = None
    for name, act, norm, fmt in FUNNEL:
        a, n = act(x), norm(x)
        if not a or not n or a <= 0 or n <= 0:
            if n and n > 0 and (a == 0 or a is None) and name == "Requests":
                a = 0.0
            else:
                continue
        lr = abs(math.log(max(a, 1e-9) / n))
        if best is None or lr > best["score"]:
            best = {
                "step": name,
                "actual": fmt(a),
                "normal": fmt(n),
                "change": (a / n - 1) * 100,
                "dir": 1 if a > n else -1,
                "score": lr,
            }
    if best:
        best["cause"] = CAUSE[(best["step"], best["dir"])]
        best.pop("score")
    return best


def _windows(scope: Scope, first_ts: datetime) -> tuple[datetime, datetime, datetime] | None:
    """Scan only completed hours, with four weeks of history before them."""
    s0, s1 = scope.cur
    if scope.live_ts is not None:
        s1 = min(s1, scope.live_ts)
    h0 = max(first_ts, s0 - timedelta(days=BASELINE_DAYS))
    if s1 <= s0 or (s0 - h0) < timedelta(days=21):
        return None  # not enough history for three reference weeks
    return h0, s0, s1


def detect(
    cur, scope: Scope, dims: Dims, first_ts: datetime, levels=("dp", "ds", "pub", "app"), context: bool = True
) -> list[dict]:
    win = _windows(scope, first_ts)
    if not win:
        return []
    h0, s0, s1 = win
    sql = _statements()
    found = []
    for lv in levels:
        key, view = LEVELS[lv]
        if lv == "app" or scope.needs_app_grain:
            view = "delivery_app"
        filt = scope.where()
        params = {
            **scope.params(),
            "h0": h0,
            "s0": s0,
            "s1": s1,
            "z": Z,
            "z_single": Z_SINGLE,
            "min_rev": MIN_REV,
            "min_req_share": MIN_REQ_SHARE,
        }
        run(cur, sql["scored"].format(key=key, view=view, filters=filt), params)
        rows = run(cur, sql["incidents"], params)
        series = {}
        if context and rows:
            ids = sorted({r["entity_id"] for r in rows})
            for r in run(
                cur,
                "SELECT entity_id, ts, rev, e_rev, req, e_req FROM scored "
                "WHERE entity_id IN (SELECT unnest($ids)) ORDER BY ts",
                {"ids": ids},
            ):
                series.setdefault(r["entity_id"], []).append(r)
        for r in rows:
            r["level"] = lv
            if context:
                a, b = r["start_ts"] - timedelta(hours=CONTEXT_H), r["end_ts"] + timedelta(hours=CONTEXT_H)
                r["series"] = [
                    {
                        "k": label(p["ts"]),
                        "rev": round(p["rev"], 2),
                        "e_rev": round(p["e_rev"], 2),
                        "req": round(p["req"]),
                        "e_req": round(p["e_req"]),
                    }
                    for p in series.get(r["entity_id"], [])
                    if a <= p["ts"] < b
                ]
            found.append(r)
    out = [_describe(r, dims) for r in _dedupe(found, dims)]
    if out:
        _link(out, Links.measure(cur, h0, s0))
    return out


def _origin(a: dict) -> str:
    """Which side of the marketplace the change most likely started on, from its driver."""
    d = a["driver"]
    if not d:
        return SIDE[a["level"]]
    if d["step"] == "Requests":
        return "supply"
    if d["step"] == "Win rate" and a["metric"] == "req" and a["dir"] > 0:
        return "supply"  # more requests that nobody wins: suspicious traffic from the publisher
    return "demand"


def _link(out: list[dict], links: Links) -> None:
    """Attach knock-on alerts to their likely root cause on the other side of the marketplace.

    B explains A when the part of A that flows through B, times B's own change, accounts for at
    least half of A's change. Example: a demand source carrying 62% of a publisher's revenue drops
    97%, which explains a 60% drop at the publisher. The publisher's alert gets `cause`, and the
    source's alert lists it under `effects`."""
    for a in out:
        a["origin"] = _origin(a)
    for a in out:
        if a["origin"] == SIDE[a["level"]] or not a["change"]:
            continue
        best = None
        for b in out:
            if b is a or SIDE[b["level"]] != a["origin"] or b["origin"] != a["origin"] or not _overlaps(a, b):
                continue
            b_change = b["_chg"].get(a["metric"])
            if b_change is None:
                continue
            share = links.share((a["level"], a["entityId"]), (b["level"], b["entityId"]), a["metric"])
            explained = share * b_change / a["change"]
            if explained >= LINK_EXPLAINS and (best is None or explained > best[0]):
                best = (explained, share, b)
        if best:
            _, share, b = best
            a["cause"] = {"id": b["id"], "title": b["title"], "share": round(share, 3)}
            b.setdefault("effects", []).append({"id": a["id"], "title": a["title"], "share": round(share, 3)})
    for a in out:
        a.pop("_chg", None)


def _span(r: dict) -> tuple:
    # raw rows carry timestamps, described alerts carry "YYYY-MM-DD HH" labels (which sort the same way)
    return (r["start_ts"], r["end_ts"]) if "start_ts" in r else (r["start"], r["end"])


def _overlaps(a: dict, b: dict) -> bool:
    (a0, a1), (b0, b1) = _span(a), _span(b)
    return a0 < b1 and b0 < a1


def _impact(r: dict) -> float:
    """Revenue-equivalent size: the revenue gap, or the request gap priced at the normal revenue per request."""
    if r["metric"] == "rev":
        return abs(r["rev"] - r["e_rev"])
    per_req = r["e_rev"] / r["e_req"] if r["e_req"] else 0
    return abs(r["req"] - r["e_req"]) * per_req


def _dedupe(found: list[dict], dims: Dims) -> list[dict]:
    """A problem shows up at several levels (one demand source's outage also dents its partner).
    When a child explains most of its parent's incident, keep the child (it's more specific);
    when several children move together, keep the parent (it's one broad problem)."""
    drop = set()
    for i, p in enumerate(found):
        if p["level"] not in CHILD:
            continue
        kids = [
            (j, c)
            for j, c in enumerate(found)
            if c["level"] == CHILD[p["level"]]
            and c["metric"] == p["metric"]
            and c["dir"] == p["dir"]
            and dims.parent(c["level"], c["entity_id"]) == (p["level"], p["entity_id"])
            and _overlaps(c, p)
        ]
        if not kids:
            continue
        top_j, top = max(kids, key=lambda jc: _impact(jc[1]))
        if _impact(top) >= 0.6 * _impact(p) and len(kids) == 1:
            drop.add(i)
        else:
            drop.update(j for j, _ in kids)
    # the same entity flagged on revenue and requests at once: keep one, mention the other
    keep = [r for i, r in enumerate(found) if i not in drop]
    out = []
    for r in sorted(keep, key=lambda r: -_impact(r)):
        twin = next(
            (o for o in out if o["level"] == r["level"] and o["entity_id"] == r["entity_id"] and _overlaps(o, r)), None
        )
        if twin:
            twin.setdefault("also", []).append(r["metric"])
            continue
        out.append(r)
    return out


def _describe(r: dict, dims: Dims) -> dict:
    lv, eid = r["level"], r["entity_id"]
    metric = "Revenue" if r["metric"] == "rev" else "Requests"
    act, norm = (r["rev"], r["e_rev"]) if r["metric"] == "rev" else (r["req"], r["e_req"])
    chg = (act / norm - 1) * 100 if norm else None
    impact = _impact(r)
    parent = dims.parent(lv, eid)
    return {
        "id": f"{lv}-{eid}-{r['metric']}-{r['start_ts']:%Y%m%d%H}",
        "level": lv,
        "levelName": LEVEL_NAME[lv],
        "entityId": eid,
        "name": dims.name(lv, eid),
        "parent": {"level": parent[0], "id": parent[1], "name": dims.name(*parent)} if parent else None,
        "metric": r["metric"],
        "dir": r["dir"],
        "also": r.get("also", []),
        "start": label(r["start_ts"]),
        "end": label(r["end_ts"]),
        "hours": r["hours"],
        "actual": round(act, 2),
        "expected": round(norm, 2),
        "change": round(chg, 1) if chg is not None else None,
        "impact": round(impact, 2),
        "peakZ": round(r["peak_z"], 1),
        "severity": "hi" if impact >= 400 or r["peak_z"] >= 10 else "md",
        "title": f"{dims.name(lv, eid)}: {metric.lower()} {abs(chg):.0f}% {'below' if r['dir'] < 0 else 'above'} normal"
        if chg is not None
        else f"{dims.name(lv, eid)}: {metric.lower()} {'drop' if r['dir'] < 0 else 'spike'}",
        "driver": _driver(r),
        "series": r.get("series", []),
        "_chg": {m: (r[m] / r["e_" + m] - 1) * 100 for m in ("rev", "req") if r["e_" + m]},
    }


# ----------------------------------------------------------------------------- scorecard
def scorecard(cur, scope: Scope, dims: Dims, first_ts: datetime) -> dict:
    """Match detections against the incidents the generator planted in the scan window.

    A detection matches an incident when their times overlap and the entities are the same, a
    parent and child, or linked by traffic (at least LINK_SHARE of the detection's traffic flows
    through the incident's entity). Recall counts incidents that any alert caught; precision
    counts top-level alerts (knock-on alerts are grouped under their cause in the UI)."""
    unfiltered = Scope(scope.start, scope.end, scope.pstart, scope.pend, {}, scope.live_ts)
    win = _windows(unfiltered, first_ts)
    if not win:
        return {"available": False}
    h0, s0, s1 = win
    dets = detect(cur, unfiltered, dims, first_ts, context=False)
    links = Links.measure(cur, h0, s0)
    planted = run(
        cur,
        "SELECT * FROM planted_incident WHERE start_ts < $s1 AND end_ts > $s0 ORDER BY start_ts",
        {"s0": s0, "s1": s1},
    )
    for g in planted:
        g["level"] = GT_LEVEL[g["level"]]
        g["start"], g["end"] = label(g.pop("start_ts")), label(g.pop("end_ts"))

    def hit(d: dict, g: dict) -> bool:
        if not _overlaps(d, g):
            return False
        a, b = (d["level"], d["entityId"]), (g["level"], g["entity_id"])
        if a == b or dims.parent(*a) == b or dims.parent(*b) == a:
            return True
        return links.share(a, b, d["metric"]) >= LINK_SHARE

    top = [d for d in dets if "cause" not in d]
    caught = [g for g in planted if any(hit(d, g) for d in dets)]
    true_top = [d for d in top if any(hit(d, g) for g in planted)]
    return {
        "available": True,
        "from": label(s0),
        "to": label(s1),
        "planted": len(planted),
        "caught": len(caught),
        "alerts": len(top),
        "trueAlerts": len(true_top),
        "knockOn": len(dets) - len(top),
        "recall": round(len(caught) / len(planted), 3) if planted else None,
        "precision": round(len(true_top) / len(top), 3) if top else None,
        "missed": [
            {
                "kind": g["kind"],
                "level": g["level"],
                "name": dims.name(g["level"], g["entity_id"]),
                "start": g["start"],
                "end": g["end"],
            }
            for g in planted
            if g not in caught
        ],
        "unmatched": [
            {"title": d["title"], "start": d["start"], "end": d["end"], "driver": (d["driver"] or {}).get("step")}
            for d in top
            if d not in true_top
        ],
    }
