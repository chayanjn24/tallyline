"""API behaviour: totals reconcile across levels, comparisons are fair, bad input is rejected."""

import pytest

from tallyline.queries import DIMS

from .conftest import TODAY

WEEK = {"start": "2026-10-12", "end": "2026-10-18"}


def get(client, path, **params):
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_summary_total_is_the_sum_of_its_hours(client):
    s = get(client, "/api/summary", **WEEK)
    assert len(s["hours"]) == 7 * 24
    assert sum(h["rev"] for h in s["hours"]) == pytest.approx(s["total"]["rev"], rel=1e-6)
    assert sum(h["req"] for h in s["hours"]) == pytest.approx(s["total"]["req"], rel=1e-6)
    assert s["total"]["hours"] == pytest.approx(168)
    assert "cur" not in s  # a finished range compares full vs full


@pytest.mark.parametrize("dim", list(DIMS))
def test_every_breakdown_adds_up_to_the_summary(client, dim):
    s = get(client, "/api/summary", **WEEK)
    b = get(client, "/api/breakdown", dim=dim, **WEEK)
    for m in ("rev", "cost", "req", "imps"):
        assert sum(r[m] for r in b["rows"]) == pytest.approx(s["total"][m], rel=1e-6), m
    assert sum(r["prevRev"] for r in b["rows"]) == pytest.approx(s["prev"]["rev"], rel=1e-6)


def test_filters_narrow_and_combine(client):
    all_ = get(client, "/api/summary", **WEEK)["total"]["rev"]
    one = get(client, "/api/summary", dp="12", **WEEK)["total"]["rev"]
    rows = get(client, "/api/breakdown", dim="publisher", dp="12", **WEEK)["rows"]
    assert sum(r["rev"] for r in rows) == pytest.approx(one, rel=1e-6)
    pub = rows[0]["id"]  # a publisher this partner actually buys from
    both = get(client, "/api/summary", dp="12", pub=str(pub), **WEEK)["total"]["rev"]
    assert 0 < both < one < all_


def test_app_filter_uses_the_app_grain_and_still_reconciles(client):
    s = get(client, "/api/summary", app="12,34", **WEEK)
    rows = get(client, "/api/breakdown", dim="deal", app="12,34", **WEEK)["rows"]
    assert s["total"]["rev"] > 0
    assert sum(r["rev"] for r in rows) == pytest.approx(s["total"]["rev"], rel=1e-6)


def test_opportunities_are_hidden_under_demand_filters(client):
    assert get(client, "/api/summary", **WEEK)["total"]["opps"] > 0
    s = get(client, "/api/summary", ds="101", **WEEK)
    assert s["oppsAvailable"] is False and s["total"]["opps"] is None


def test_today_compares_completed_hours_at_the_same_offset(client):
    s = get(client, "/api/summary", start=TODAY, end=TODAY)
    assert s["cmp"] == {"completedOnly": True, "curTo": "2026-10-20 17", "prevTo": "2026-10-19 17"}
    live = s["hours"][-1]
    assert live["k"] == "2026-10-20 17" and live["partial"] == pytest.approx(0.5)
    # the compared side leaves the live hour out; the headline total keeps it
    assert s["cur"]["rev"] == pytest.approx(s["total"]["rev"] - live["rev"], rel=1e-6)
    assert s["prev"]["hours"] == pytest.approx(17)
    assert len(s["prevHours"]) == 24  # the whole of yesterday is still drawn


def test_dedicated_deals_serve_one_app(client, wh):
    counts = get(client, "/api/deal-apps/counts", **WEEK)["counts"]
    dedicated = [d for d, t in zip(wh.cat.deals["deal_id"], wh.cat.deals["target_app_id"], strict=True) if t]
    seen = [d for d in dedicated if str(d) in counts]
    assert seen
    for d in seen:
        assert counts[str(d)]["n"] == 1


def test_options_list_every_entity(client, wh):
    o = get(client, "/api/options", level="app", **WEEK)["options"]
    assert len(o) == len(wh.cat.apps["app_id"])
    assert o[0]["rev"] >= o[-1]["rev"]


@pytest.mark.parametrize(
    "params,msg",
    [
        ({"start": "2026-08-01", "end": "2026-10-01"}, "at most 31 days"),
        ({"dp": "12;drop"}, "ids must be numbers"),
        ({"start": "20-10-2026"}, "YYYY-MM-DD"),
        ({"start": "2025-01-01", "end": "2025-01-02"}, "data covers"),
    ],
)
def test_bad_input_is_a_400_with_a_reason(client, params, msg):
    r = client.get("/api/summary", params=params)
    assert r.status_code == 400 and msg in r.json()["error"]


def test_unknown_dimension_is_rejected(client):
    assert client.get("/api/breakdown", params={"dim": "users"}).status_code == 400


def test_front_end_is_served(client):
    assert "Tallyline" in client.get("/").text
    assert client.get("/healthz").json() == {"ok": True}
