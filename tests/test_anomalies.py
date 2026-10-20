"""The detector is scored against the incidents the generator planted (its answer key)."""

from datetime import date, timedelta

import pytest

from tallyline import anomalies
from tallyline.dims import Dims
from tallyline.scope import Scope

from .conftest import NOW, make_warehouse


def scorecard(wh):
    live, _ = wh.live()
    end = NOW.date()
    start = end - timedelta(days=29)
    sc = Scope(start, end, start - timedelta(days=30), start - timedelta(days=1)).bind(live)
    return anomalies.scorecard(wh.cursor(), sc, Dims(wh.cat), wh.first_ts())


@pytest.mark.parametrize("seed", [7, 11])
def test_detector_finds_planted_incidents(seed):
    wh = make_warehouse(seed)
    try:
        s = scorecard(wh)
    finally:
        wh.close()
    assert s["available"] and s["planted"] >= 20
    assert s["recall"] >= 0.9, s["missed"]
    assert s["precision"] >= 0.8, s["unmatched"]


def test_alerts_explain_themselves(client):
    j = client.get("/api/anomalies", params={"start": "2026-10-12", "end": "2026-10-18"}).json()
    assert j["alerts"], "a week of data should contain incidents"
    for a in j["alerts"]:
        assert a["driver"]["step"] in {"Requests", "Bid rate", "Win rate", "Render rate", "eCPM"}
        assert a["series"] and a["start"] < a["end"]
        assert a["impact"] > 0
    ids = {a["id"] for a in j["alerts"]}
    for a in j["alerts"]:
        if "cause" in a:
            assert a["cause"]["id"] in ids  # a knock-on alert always points at an alert that exists


def test_live_hour_is_never_scanned(client):
    j = client.get("/api/anomalies", params={"start": "2026-10-20", "end": "2026-10-20"}).json()
    assert j["to"] == "2026-10-20 17"
    assert all(a["end"] <= "2026-10-20 17" for a in j["alerts"])


def test_not_enough_history_means_no_alerts(wh):
    first = wh.first_ts().date()
    sc = Scope(first, first + timedelta(days=2), first - timedelta(days=3), first - timedelta(days=1)).bind(
        wh.live()[0]
    )
    assert anomalies.detect(wh.cursor(), sc, Dims(wh.cat), wh.first_ts()) == []
    assert isinstance(first, date)
