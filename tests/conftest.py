from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from tallyline.api import create_app
from tallyline.warehouse import Warehouse

# a frozen clock: 17:30 UTC, so the 17:00 hour is "live" and half loaded
NOW = datetime(2026, 10, 20, 17, 30, tzinfo=UTC)
TODAY = "2026-10-20"


def make_warehouse(seed: int = 7) -> Warehouse:
    return Warehouse(path=":memory:", seed=seed, days=70, clock=lambda: NOW, memory_limit="2GB")


@pytest.fixture(scope="session")
def wh():
    w = make_warehouse()
    yield w
    w.close()


@pytest.fixture(scope="session")
def client(wh):
    with TestClient(create_app(wh)) as c:
        yield c
