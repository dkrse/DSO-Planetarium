"""REST API: catalog, visibility, setups, targets, mosaic panels."""
import math

import pytest
from fastapi.testclient import TestClient

from app import store


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(store, "_conn", None)
    from app.main import app
    with TestClient(app) as c:
        yield c


SETUP = {"name": "RC", "focal": 1600, "aperture": 203, "sw": 11.3, "sh": 11.3, "px": 3.76}


def test_catalog_and_visibility(client):
    cat = client.get("/api/catalog").json()
    assert len(cat["objects"]) > 100 and "G" in cat["types"]
    v = client.get("/api/visibility", params={"lat": 48.15, "lon": 17.11, "start": "2026-11-02T11:00:00Z"}).json()
    m31 = next(o for o in v["objects"] if o["id"] == "M31")
    assert m31["hours"] > 8 and m31["max_alt"] > 80


def test_setup_crud(client):
    s = client.post("/api/setups", json=SETUP).json()
    assert s["computed"]["f_ratio"] == pytest.approx(1600 / 203)
    assert client.put(f"/api/setups/{s['id']}", json={**SETUP, "name": "RC8"}).json()["name"] == "RC8"
    assert client.delete(f"/api/setups/{s['id']}").status_code == 409          # last one stays
    s2 = client.post("/api/setups", json={**SETUP, "focal": 400}).json()
    assert client.delete(f"/api/setups/{s['id']}").status_code == 204
    assert [x["id"] for x in client.get("/api/setups").json()] == [s2["id"]]


def test_target_validation_and_panels(client):
    s = client.post("/api/setups", json=SETUP).json()
    assert client.post("/api/targets", json={"name": "x", "ra": 1, "dec": 1, "setup_id": "nope"}).status_code == 422
    t = client.post("/api/targets", json={"name": "M31 mosaic", "object_id": "M31", "ra": 10.68, "dec": 41.27, "pa": 0,
                                          "setup_id": s["id"], "mosaic": {"cols": 2, "rows": 2, "overlap": 10}}).json()
    p = client.get(f"/api/targets/{t['id']}/panels").json()["panels"]
    assert [x["panel"] for x in p] == [1, 2, 3, 4]
    # PA 0: panel 1 is top-left = north-east of the centre (east = larger RA)
    assert p[0]["dec"] > 41.27 and p[0]["ra"] > 10.68
    # neighbouring panels are one frame width × (1 − overlap) apart
    fov = 2 * math.degrees(math.atan(11.3 / 2 / 1600))
    step = math.degrees(math.acos(math.sin(math.radians(p[0]["dec"])) * math.sin(math.radians(p[1]["dec"]))
                                  + math.cos(math.radians(p[0]["dec"])) * math.cos(math.radians(p[1]["dec"]))
                                  * math.cos(math.radians(p[0]["ra"] - p[1]["ra"]))))
    assert step == pytest.approx(fov * 0.9, rel=0.01)


def test_settings(client):
    s = client.post("/api/setups", json=SETUP).json()
    assert client.patch("/api/settings", json={"active_setup": s["id"]}).json()["active_setup"] == s["id"]
    assert client.patch("/api/settings", json={"bogus": 1}).status_code == 422
