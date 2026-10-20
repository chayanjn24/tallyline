"""Synthetic hourly traffic for the marketplace in catalog.py.

The funnel, per deal × app × hour:
    opportunities (publisher ad requests)
      → bid requests   (opps × deal participation, capped by the deal's QPS cap)
      → bids           (× the demand source's bid rate)
      → wins           (× the deal's win rate)
      → impressions    (× the format's render rate)
      → revenue        (impressions × CPM / 1000);  publisher payout = revenue × (1 − margin)

Volume follows a daily curve that peaks when the publisher's audience is awake, a weekend lift,
slow growth, and multiplicative noise. A few incidents are planted every day (outages, traffic
drops, bot-like spikes, price drops) and returned as ground truth so the anomaly detector can be
scored against them.

Every hour is generated from its own RNG stream seeded by (seed, hour), so history never changes
when new hours are appended, and any machine produces the same numbers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

from .catalog import BASE_CPM, COMPLETION, FORMATS, PEAK_HOUR, RENDER_RATE, Catalog

EPOCH = datetime(2026, 1, 1, tzinfo=UTC)
HOUR = timedelta(hours=1)

# incident kind → (level it hits, how it changes the funnel, (min, max) duration in hours)
INCIDENT_KINDS = {
    "demand_outage": ("demand_source", "bid rate collapses to ~3% of normal", (3, 8)),
    "price_drop": ("demand_partner", "CPMs fall to ~45% of normal", (4, 10)),
    "publisher_drop": ("publisher", "opportunities fall to ~25% of normal", (2, 6)),
    "traffic_spike": ("app", "opportunities jump 4× with very low win rate (bot-like)", (2, 5)),
}
INCIDENT_P = 0.32  # chance per day of each kind


def hour_index(ts: datetime) -> int:
    return int((ts - EPOCH) // HOUR)


def hour_ts(i: int) -> datetime:
    return EPOCH + i * HOUR


@dataclass(frozen=True)
class Incident:
    kind: str
    level: str
    entity_id: int
    start_hour: int  # hour index (see hour_index)
    hours: int

    @property
    def end_hour(self) -> int:  # exclusive
        return self.start_hour + self.hours


class Generator:
    def __init__(self, cat: Catalog, seed: int = 7):
        self.cat, self.seed = cat, seed
        dp, ds, pub, plc, app, deal = (
            cat.demand_partners,
            cat.demand_sources,
            cat.publishers,
            cat.placements,
            cat.apps,
            cat.deals,
        )
        idx = lambda ids: {v: i for i, v in enumerate(ids)}
        self.ds_ix, self.dp_ix, self.pub_ix = idx(ds["ds_id"]), idx(dp["dp_id"]), idx(pub["pub_id"])
        self.app_ids = np.asarray(app["app_id"])
        self.deal_ids = np.asarray(deal["deal_id"])
        plc_pub = np.asarray([self.pub_ix[p] for p in plc["pub_id"]])
        fmt_ix = {f: i for i, f in enumerate(FORMATS)}

        # slots: placement × app
        s_plc, s_app = cat.slots["plc"], cat.slots["app"]
        app_pub = np.asarray([self.pub_ix[p] for p in app["pub_id"]])
        self.slot_app, self.slot_plc = s_app, s_plc
        self.slot_pub = plc_pub[s_plc]
        self.slot_base = np.asarray(app["daily_opps"])[s_app] * cat.slots["share"] / 24.0
        self.slot_peak = np.asarray([PEAK_HOUR[pub["region"][p]] for p in self.slot_pub])
        self.slot_weekend = np.asarray(pub["weekend"])[self.slot_pub]
        assert (app_pub[s_app] == self.slot_pub).all()

        # lanes: deal × app
        d, s = cat.lanes["deal"], cat.lanes["slot"]
        self.lane_deal, self.lane_slot = d, s
        self.lane_app = s_app[s]
        self.lane_pub = self.slot_pub[s]
        self.lane_ds = np.asarray([self.ds_ix[x] for x in deal["ds_id"]])[d]
        self.lane_dp = np.asarray([self.dp_ix[x] for x in deal["dp_id"]])[d]
        fmt = np.asarray([fmt_ix[f] for f in deal["format"]])[d]
        self.lane_fmt = fmt
        self.lane_part = np.asarray(deal["participation"])[d] * (np.asarray(deal["status"])[d] == "On")
        self.lane_br = np.asarray(ds["bid_rate"])[self.lane_ds] * ~np.asarray(deal["never_bids"])[d]
        self.lane_wr = np.asarray(deal["win_rate"])[d]
        self.lane_render = np.asarray([RENDER_RATE[f] for f in FORMATS])[fmt]
        self.lane_cpm = (
            np.asarray([BASE_CPM[f] for f in FORMATS])[fmt]
            * np.asarray(ds["price"])[self.lane_ds]
            * np.asarray(app["quality"])[self.lane_app]
        )
        self.lane_margin = np.asarray(deal["margin_pct"])[d] / 100.0
        compl = np.asarray([COMPLETION.get(f, 0.0) for f in FORMATS])[fmt]
        self.lane_compl = np.clip(compl * np.asarray(app["completion"])[self.lane_app], 0, 0.99)
        self.lane_video = compl > 0
        self.deal_cap = np.asarray(deal["qps_cap"], dtype=float) * 3600.0  # requests per hour, 0 = none
        self.n_deals = len(deal["deal_id"])

        # typical requests and revenue per lane: used to pick incident targets, and to link
        # anomalies across the marketplace (how much of entity A's traffic flows through B)
        self.lane_w_req = self.slot_base[s] * self.lane_part
        w = self.lane_w_req * self.lane_br * self.lane_wr * self.lane_render * self.lane_cpm
        self.lane_w_rev = w
        self.weight = {
            "demand_source": np.bincount(self.lane_ds, w, len(ds["ds_id"])),
            "demand_partner": np.bincount(self.lane_dp, w, len(dp["dp_id"])),
            "publisher": np.bincount(self.lane_pub, w, len(pub["pub_id"])),
            "app": np.bincount(self.lane_app, w, len(app["app_id"])),
        }
        self.ids = {
            "demand_source": np.asarray(ds["ds_id"]),
            "demand_partner": np.asarray(dp["dp_id"]),
            "publisher": np.asarray(pub["pub_id"]),
            "app": self.app_ids,
        }

    # ---------------------------------------------------------------- incidents
    def incidents_for_day(self, day: int) -> list[Incident]:
        """Ground-truth incidents starting on day `day` (days since EPOCH)."""
        rng = np.random.default_rng([self.seed, 99, day])
        out = []
        for kind, (level, _, (lo, hi)) in INCIDENT_KINDS.items():
            if rng.random() >= INCIDENT_P:
                continue
            w = self.weight[level]
            # skip the tiny tail: an incident on an entity nobody would notice is not interesting
            p = np.where(w >= np.quantile(w, 0.35), w, 0)
            p = np.sqrt(p) / np.sqrt(p).sum()
            ent = int(self.ids[level][rng.choice(len(w), p=p)])
            hours = int(rng.integers(lo, hi + 1))
            start = day * 24 + int(rng.integers(0, 24 - hours + 1))
            out.append(Incident(kind, level, ent, start, hours))
        return out

    def incidents_between(self, h0: int, h1: int) -> list[Incident]:
        days = range(h0 // 24, (h1 - 1) // 24 + 1)
        return [i for d in days for i in self.incidents_for_day(d) if i.start_hour < h1 and i.end_hour > h0]

    # ---------------------------------------------------------------- one hour
    def hour(self, h: int, incidents: list[Incident]) -> tuple[dict, dict]:
        """Supply rows (placement × app) and delivery rows (deal × app) for hour index h."""
        rng = np.random.default_rng([self.seed, h])
        ts = hour_ts(h)
        hod, dow, day = ts.hour, ts.weekday(), h // 24

        # opportunities
        phase = np.cos(2 * np.pi * (hod + 0.5 - self.slot_peak) / 24.0)
        shape = 0.38 + 0.62 * ((1 + phase) / 2) ** 1.4
        weekly = np.where(dow >= 5, self.slot_weekend, 1.0)
        trend = 1.0 + 0.0012 * day + 0.04 * np.sin(2 * np.pi * day / 365.0)
        opps = self.slot_base * shape * weekly * trend * rng.lognormal(0, 0.07, len(self.slot_base))

        lane_n = len(self.lane_deal)
        br_mult = np.ones(lane_n)
        wr_mult = np.ones(lane_n)
        cpm_mult = np.ones(lane_n)
        for inc in incidents:
            if not (inc.start_hour <= h < inc.end_hour):
                continue
            if inc.kind == "publisher_drop":
                opps = np.where(self.slot_pub == self.pub_ix[inc.entity_id], opps * 0.25, opps)
            elif inc.kind == "traffic_spike":
                hit_app = int(np.flatnonzero(self.app_ids == inc.entity_id)[0])
                opps = np.where(self.slot_app == hit_app, opps * 4.0, opps)
                wr_mult = np.where(self.lane_app == hit_app, 0.12, wr_mult)
            elif inc.kind == "demand_outage":
                br_mult = np.where(self.lane_ds == self.ds_ix[inc.entity_id], 0.03, br_mult)
            elif inc.kind == "price_drop":
                cpm_mult = np.where(self.lane_dp == self.dp_ix[inc.entity_id], 0.45, cpm_mult)

        # bid requests, with each deal's QPS cap applied to its hourly total
        req = opps[self.lane_slot] * self.lane_part
        per_deal = np.bincount(self.lane_deal, req, self.n_deals)
        scale = np.where((self.deal_cap > 0) & (per_deal > self.deal_cap), self.deal_cap / np.maximum(per_deal, 1), 1.0)
        req = req * scale[self.lane_deal]

        # demand-side noise is shared by a demand source within the hour, plus a little per lane
        ds_noise = rng.lognormal(0, 0.06, int(self.lane_ds.max()) + 1)[self.lane_ds]
        bids = req * np.clip(self.lane_br * ds_noise * br_mult * rng.lognormal(0, 0.05, lane_n), 0, 0.95)
        wins = bids * np.clip(self.lane_wr * wr_mult * rng.lognormal(0, 0.05, lane_n), 0, 0.9)
        imps = wins * self.lane_render
        cpm = self.lane_cpm * cpm_mult * (0.86 + 0.28 * shape[self.lane_slot]) * rng.lognormal(0, 0.05, lane_n)
        rev = imps * cpm / 1000.0
        cost = rev * (1 - np.clip(self.lane_margin + rng.normal(0, 0.01, lane_n), 0.02, 0.9))
        starts = np.where(self.lane_video, imps * 0.98, 0.0)
        completes = starts * self.lane_compl

        supply = {"opps": np.rint(opps).astype(np.int64), "plc_ix": self.slot_plc, "app_ix": self.slot_app}
        delivery = {
            "deal_ix": self.lane_deal,
            "app_ix": self.lane_app,
            "req": np.rint(req).astype(np.int64),
            "bids": np.rint(bids).astype(np.int64),
            "wins": np.rint(wins).astype(np.int64),
            "imps": np.rint(imps).astype(np.int64),
            "starts": np.rint(starts).astype(np.int64),
            "completes": np.rint(completes).astype(np.int64),
            "rev": np.round(rev, 4),
            "cost": np.round(cost, 4),
        }
        return supply, delivery

    # ---------------------------------------------------------------- many hours
    def hours(self, h0: int, h1: int) -> tuple[dict, dict, list[Incident]]:
        """Columns for hours [h0, h1), ready to load into DuckDB, plus the incidents that touch them."""
        incidents = self.incidents_between(h0, h1)
        sup, dlv = [], []
        for h in range(h0, h1):
            s, d = self.hour(h, incidents)
            ts = np.datetime64(hour_ts(h).replace(tzinfo=None), "s")
            keep = d["req"] > 0
            sup.append(
                {"ts": np.full(len(s["opps"]), ts), "plc_ix": s["plc_ix"], "app_ix": s["app_ix"], "opps": s["opps"]}
            )
            dlv.append({"ts": np.full(int(keep.sum()), ts), **{k: v[keep] for k, v in d.items()}})
        cat = lambda parts: {k: np.concatenate([p[k] for p in parts]) for k in parts[0]} if parts else {}
        return cat(sup), cat(dlv), incidents
