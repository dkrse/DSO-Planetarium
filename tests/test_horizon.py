"""Custom horizon profile."""
from datetime import datetime, timezone

import pytest

from app import astro
from tests.test_api import SETUP, client  # noqa: F401  (fixture)


def test_interpolation_and_wrap():
    pts = [[0, 10], [90, 30], [270, 0]]
    assert astro.horizon_alt(45, pts) == pytest.approx(20)
    assert astro.horizon_alt(180, pts) == pytest.approx(15)
    assert astro.horizon_alt(315, pts) == pytest.approx(5)      # wraps 270 → 360(=0)
    assert astro.horizon_alt(123, []) == 0


def test_horizon_reduces_imageable_hours():
    start = datetime(2026, 11, 2, 11, tzinfo=timezone.utc)
    m42 = {"id": "M42", "ra": 83.82, "dec": -5.39}
    flat = astro.Night(start, 48.15, 17.11).visibility(m42, min_alt=20)
    wall = astro.Night(start, 48.15, 17.11, horizon=[[90, 35], [180, 35], [270, 35], [0, 35]]).visibility(m42, min_alt=20)
    assert wall["hours"] < flat["hours"] and wall["hours"] > 0   # M42 culminates at ~36.5°


def test_horizon_api(client):  # noqa: F811
    assert client.patch("/api/settings", json={"horizon": [[0, 5], [180, 100]]}).status_code == 422
    r = client.patch("/api/settings", json={"horizon": [[370, 5], [180, 20]]}).json()
    assert r["horizon"] == [[10, 5], [180, 20]]
    v = client.get("/api/visibility", params={"lat": 48.15, "lon": 17.11, "start": "2026-11-02T11:00:00Z"}).json()
    assert v["objects"]
