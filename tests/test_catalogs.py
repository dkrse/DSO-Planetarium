"""Catalog management: merging by priority, hiding, import, delete."""
import json

import pytest

from app import catalog as cat
from tests.test_api import client  # noqa: F401  (fixture)


@pytest.fixture()
def catdir(tmp_path, monkeypatch):
    d = tmp_path / "catalogs"; d.mkdir()
    def write(cid, prio, objs):
        (d / f"{cid}.json").write_text(json.dumps({"id": cid, "name": cid.upper(), "priority": prio, "builtin": True, "objects": objs}))
    o = lambda i, n="", ra=10: {"id": i, "name": n, "type": "EN", "ra": ra, "dec": 20, "mag": 0, "maj": 5, "min": 5, "pa": 0}
    write("a", 10, [o("X1", "from a"), o("X2", ra=50)])
    write("b", 20, [o("X1", "from b", ra=100), o("Y1", ra=150), o("S1", "same as X2", ra=50.01)])
    monkeypatch.setattr(cat, "CATALOG_DIR", d)
    monkeypatch.setattr(cat, "_cache", {"sig": None, "cats": []})
    return d


def test_merge_priority_and_hide(catdir):
    objs, stats = cat.merged()
    assert {o["id"]: o["name"] for o in objs}["X1"] == "from a"          # lower priority number wins
    assert stats["b"] == {"total": 3, "shown": 1, "duplicates": 2}
    # S1 sits on X2 (same type, size) → merged as an alias, its name fills the empty one
    x2 = next(o for o in objs if o["id"] == "X2")
    assert x2["aka"] == ["S1"] and x2["name"] == "same as X2" and cat.resolve("S1")["id"] == "X2"
    objs, _ = cat.merged(hidden={"a"})
    assert {o["id"]: o["name"] for o in objs} == {"X1": "from b", "Y1": "", "S1": "same as X2"}


def test_import_parsers():
    csv_text = "id;name;type;ra;dec;maj\nT1;Test;dn;05:41:00;-02:27:00;30\nT2;;EN;83.8;-5.4;\n"
    objs = cat.parse_upload(csv_text, "x.csv")
    assert objs[0]["type"] == "DN" and objs[0]["ra"] == pytest.approx(85.25) and objs[0]["dec"] == pytest.approx(-2.45)
    assert objs[1]["maj"] == 1.0
    with pytest.raises(ValueError, match="unknown type"):
        cat.parse_upload("id,type,ra,dec\nZ,XX,1,1\n")
    assert cat.parse_upload(json.dumps([{"id": "J", "ra": 1, "dec": 2}]), "x.json")[0]["type"] == "EN"


def test_catalog_api(client, catdir):  # noqa: F811
    assert [c["id"] for c in client.get("/api/catalogs").json()] == ["a", "b"]
    r = client.post("/api/catalogs", data={"id": "mine", "name": "My list"},
                    files={"file": ("m.csv", "id,name,type,ra,dec\nMY1,Thing,RN,12:00:00,+45:00:00\n")})
    assert r.status_code == 201 and r.json()["total"] == 1
    assert client.post("/api/catalogs", data={"id": "mine"}, files={"file": ("m.csv", "id,ra,dec\nQ,1,1\n")}).status_code == 409
    assert client.post("/api/catalogs", data={"id": "Bad Id"}, files={"file": ("m.csv", "id,ra,dec\nQ,1,1\n")}).status_code == 422
    assert "MY1" in {o["id"] for o in client.get("/api/catalog").json()["objects"]}
    client.patch("/api/settings", json={"hidden_catalogs": ["mine"]})
    assert "MY1" not in {o["id"] for o in client.get("/api/catalog").json()["objects"]}
    assert client.delete("/api/catalogs/mine").status_code == 204
    assert client.get("/api/settings").json()["hidden_catalogs"] == []
    assert client.delete("/api/catalogs/mine").status_code == 404


def test_hidden_types(client):  # noqa: F811
    r = client.get("/api/catalog").json()
    assert r["type_counts"]["G"] > 300
    assert client.patch("/api/settings", json={"hidden_types": ["XX"]}).status_code == 422
    client.patch("/api/settings", json={"hidden_types": ["G", "DN"]})
    r = client.get("/api/catalog").json()
    assert not {o["type"] for o in r["objects"]} & {"G", "DN"}
    assert r["type_counts"]["G"] > 300          # counts are reported before hiding types
    v = client.get("/api/visibility", params={"lat": 48.15, "lon": 17.11, "start": "2026-11-02T11:00:00Z"}).json()
    assert not any(o["id"] == "M31" for o in v["objects"])
