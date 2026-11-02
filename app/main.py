from datetime import datetime, timezone
from pathlib import Path

from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query, Response
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import framing, images, store
from .astro import Night
from .catalog import CATALOG, TYPE_NAMES

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="DSO Planetarium – astrophotography planner")


def _parse(start: str) -> datetime:
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Invalid 'start' time (ISO 8601)")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@app.get("/api/catalog")
def catalog():
    return {"types": TYPE_NAMES, "objects": CATALOG}


@app.get("/api/night")
def night(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
          start: str = Query(..., description="Window start (local noon) in ISO 8601")):
    return Night(_parse(start), lat, lon).events()


@app.get("/api/visibility")
def visibility(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
               start: str = Query(...), min_alt: float = Query(30, ge=0, le=89),
               twilight: float = Query(-18, ge=-18, le=0)):
    n = Night(_parse(start), lat, lon, horizon=store.get_settings().get("horizon"))
    return {
        "night": n.events(),
        "objects": [n.visibility(o, min_alt, twilight) for o in CATALOG],
    }


_BY_ID = {o["id"]: o for o in CATALOG}


@app.get("/api/images")
def image_index():
    """Objects that have a local image, with fov/rot/center."""
    return images.index(CATALOG)


@app.get("/api/image/{oid}")
def image(oid: str):
    if oid not in _BY_ID:
        raise HTTPException(404, "Unknown object")
    path = images.find(oid)
    if path is None:
        raise HTTPException(404, "No image in the images/ folder")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- equipment setups
class Setup(BaseModel):
    id: Optional[str] = None
    name: str = "New setup"
    focal: float = Field(gt=0, description="Focal length [mm]")
    reducer: float = Field(1.0, gt=0, description="Reducer / Barlow factor")
    aperture: Optional[float] = Field(None, gt=0, description="Aperture [mm]")
    sw: float = Field(gt=0, description="Sensor width [mm]")
    sh: float = Field(gt=0, description="Sensor height [mm]")
    px: float = Field(gt=0, description="Pixel size [µm]")
    mount: Literal["eq", "altaz"] = "eq"
    rot: float = Field(0.0, description="Camera rotation: PA N→E (eq) or angle from vertical (alt-az) [deg]")
    color: str = "#ff5a4e"
    show: bool = False


def _with_fov(doc: dict) -> dict:
    return {**doc, "computed": framing.setup_fov(doc)}


@app.get("/api/setups")
def list_setups():
    return [_with_fov(d) for d in store.list_docs("setups")]


@app.post("/api/setups", status_code=201)
def create_setup(s: Setup):
    doc = s.model_dump(); doc["id"] = doc["id"] or store.new_id()
    if store.get_doc("setups", doc["id"]):
        raise HTTPException(409, "Setup id already exists")
    return _with_fov(store.put_doc("setups", doc))


@app.get("/api/setups/{sid}")
def get_setup(sid: str):
    doc = store.get_doc("setups", sid)
    if not doc:
        raise HTTPException(404, "Unknown setup")
    return _with_fov(doc)


@app.put("/api/setups/{sid}")
def update_setup(sid: str, s: Setup):
    if not store.get_doc("setups", sid):
        raise HTTPException(404, "Unknown setup")
    return _with_fov(store.put_doc("setups", {**s.model_dump(), "id": sid}))


@app.delete("/api/setups/{sid}", status_code=204)
def delete_setup(sid: str):
    if len(store.list_docs("setups")) <= 1:
        raise HTTPException(409, "At least one setup must remain")
    if not store.delete_doc("setups", sid):
        raise HTTPException(404, "Unknown setup")
    if store.get_settings().get("active_setup") == sid:
        store.update_settings({"active_setup": store.list_docs("setups")[0]["id"]})
    return Response(status_code=204)


# ---------------------------------------------------------------- planned targets
class Mosaic(BaseModel):
    cols: int = Field(1, ge=1, le=10)
    rows: int = Field(1, ge=1, le=10)
    overlap: float = Field(15, ge=0, le=50, description="Overlap between panels [%]")


class Target(BaseModel):
    id: Optional[str] = None
    name: str
    object_id: Optional[str] = Field(None, description="Catalog id, if the target is a catalog object")
    ra: float = Field(ge=0, lt=360, description="Frame centre RA J2000 [deg]")
    dec: float = Field(ge=-90, le=90, description="Frame centre Dec J2000 [deg]")
    pa: float = Field(0.0, description="Position angle of the frame top edge, N→E [deg]")
    setup_id: str
    mosaic: Mosaic = Mosaic()
    notes: str = ""


def _check_target(t: Target):
    if not store.get_doc("setups", t.setup_id):
        raise HTTPException(422, "setup_id does not exist")
    if t.object_id and t.object_id not in _BY_ID:
        raise HTTPException(422, "object_id is not in the catalog")


@app.get("/api/targets")
def list_targets():
    return store.list_docs("targets")


@app.post("/api/targets", status_code=201)
def create_target(t: Target):
    _check_target(t)
    doc = t.model_dump(); doc["id"] = doc["id"] or store.new_id()
    if store.get_doc("targets", doc["id"]):
        raise HTTPException(409, "Target id already exists")
    return store.put_doc("targets", doc)


@app.get("/api/targets/{tid}")
def get_target(tid: str):
    doc = store.get_doc("targets", tid)
    if not doc:
        raise HTTPException(404, "Unknown target")
    return doc


@app.put("/api/targets/{tid}")
def update_target(tid: str, t: Target):
    if not store.get_doc("targets", tid):
        raise HTTPException(404, "Unknown target")
    _check_target(t)
    return store.put_doc("targets", {**t.model_dump(), "id": tid})


@app.delete("/api/targets/{tid}", status_code=204)
def delete_target(tid: str):
    if not store.delete_doc("targets", tid):
        raise HTTPException(404, "Unknown target")
    return Response(status_code=204)


@app.get("/api/targets/{tid}/panels")
def target_panels(tid: str):
    """Mosaic panel centres (RA/Dec J2000, PA) ready for a capture / mount controller."""
    t = store.get_doc("targets", tid)
    if not t:
        raise HTTPException(404, "Unknown target")
    s = store.get_doc("setups", t["setup_id"])
    if not s:
        raise HTTPException(409, "The target's setup no longer exists")
    m = t["mosaic"]
    return {"target": t, "setup": s,
            **framing.panels(s, t["ra"], t["dec"], t["pa"], m["cols"], m["rows"], m["overlap"])}


# ---------------------------------------------------------------- settings
@app.get("/api/settings")
def get_settings():
    return store.get_settings()


@app.patch("/api/settings")
def patch_settings(values: dict):
    allowed = {"active_setup", "horizon"}
    if set(values) - allowed:
        raise HTTPException(422, f"Allowed keys: {sorted(allowed)}")
    if "horizon" in values:
        h = values["horizon"]
        ok = isinstance(h, list) and len(h) <= 3600 and all(
            isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(x, (int, float)) for x in p)
            and -5 <= p[1] <= 90 for p in h)
        if not ok:
            raise HTTPException(422, "horizon must be a list of [azimuth, altitude] pairs, altitude −5…90°")
        values["horizon"] = sorted([[round(p[0] % 360, 3), round(p[1], 3)] for p in h])
    if "active_setup" in values and not store.get_doc("setups", values["active_setup"]):
        raise HTTPException(422, "active_setup does not exist")
    return store.update_settings(values)


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
