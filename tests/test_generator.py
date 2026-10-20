"""The synthetic data must be deterministic and obey the funnel."""

from datetime import UTC, datetime

import numpy as np

from tallyline.catalog import build_catalog
from tallyline.generator import Generator, hour_index

H = hour_index(datetime(2026, 10, 14, 15, tzinfo=UTC))


def test_same_seed_same_numbers():
    a, b = Generator(build_catalog(7), 7), Generator(build_catalog(7), 7)
    _, da = a.hour(H, [])
    _, db = b.hour(H, [])
    for k in da:
        assert np.array_equal(da[k], db[k]), k


def test_history_does_not_depend_on_what_else_was_generated():
    g = Generator(build_catalog(7), 7)
    _, alone = g.hour(H, g.incidents_between(H, H + 1))
    _, dlv, _ = g.hours(H - 5, H + 3)
    i = 5  # the 6th hour of that batch is H
    n = len(alone["req"][alone["req"] > 0])
    ts = np.unique(dlv["ts"])[i]
    assert (dlv["req"][dlv["ts"] == ts]).sum() == alone["req"].sum()
    assert n == int((dlv["ts"] == ts).sum())


def test_other_seed_other_world():
    a, b = Generator(build_catalog(7), 7), Generator(build_catalog(8), 8)
    assert a.hour(H, [])[1]["rev"].sum() != b.hour(H, [])[1]["rev"].sum()


def test_funnel_never_widens():
    g = Generator(build_catalog(7), 7)
    _, d, _ = g.hours(H, H + 24)
    assert (d["bids"] <= d["req"]).all()
    assert (d["wins"] <= d["bids"]).all()
    assert (d["imps"] <= d["wins"]).all()
    assert (d["completes"] <= d["starts"]).all()
    assert (d["cost"] <= d["rev"] + 1e-9).all()
    assert d["rev"].sum() > 0


def test_qps_caps_hold():
    cat = build_catalog(7)
    g = Generator(cat, 7)
    _, d = g.hour(H, [])
    per_deal = np.bincount(d["deal_ix"], d["req"], len(cat.deals["deal_id"]))
    cap = np.asarray(cat.deals["qps_cap"]) * 3600
    capped = cap > 0
    # rounding each lane can add at most one request per lane
    lanes = np.bincount(d["deal_ix"], minlength=len(cap))
    assert (per_deal[capped] <= cap[capped] + lanes[capped]).all()


def test_incidents_are_planted_on_real_entities():
    g = Generator(build_catalog(7), 7)
    incs = g.incidents_between(H - 24 * 30, H)
    assert len(incs) > 10
    for i in incs:
        assert i.entity_id in set(g.ids[i.level].tolist())
        assert 0 < i.hours <= 10
