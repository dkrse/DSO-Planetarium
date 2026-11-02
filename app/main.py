import json
from datetime import datetime, timezone
from pathlib import Path

from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import framing, images, store
from .astro import Night
from . import catalog as cat
from .catalog import TYPE_NAMES

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="DSO Planetarium – astrophotography planner")
# JSON responses and data files (catalog, visibility, stars) compress ~5–10×
app.add_middleware(GZipMiddleware, minimum_size=2000)


@app.middleware("http")
async def no_stale_static(request, call_next):
    """Static files (ES modules, CSS, data) must be revalidated on every load, otherwise a browser may combine
    new and cached old modules after an update. Unchanged files still cost only a short 304 response."""
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


def _parse(start: str) -> datetime:
    try:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Invalid 'start' time (ISO 8601)")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hidden() -> set:
    return set(store.get_settings().get("hidden_catalogs", []))


def _hidden_types() -> set:
    return set(store.get_settings().get("hidden_types", []))


def visible_objects() -> list[dict]:
    """Objects of the visible catalogs, without the hidden object types."""
    ht = _hidden_types()
    return [o for o in cat.merged(_hidden())[0] if o["type"] not in ht]


@app.get("/api/catalog")
def catalog():
    """Objects of all visible catalogs and types (each object has a `cat` field), type names,
    object counts per type (before hiding types) and the catalog list."""
    objs = cat.merged(_hidden())[0]
    counts = {t: sum(1 for o in objs if o["type"] == t) for t in TYPE_NAMES}
    return {"types": TYPE_NAMES, "type_counts": counts, "objects": visible_objects(), "catalogs": cat.summary(_hidden())}


# ---------------------------------------------------------------- catalog management
@app.get("/api/catalogs")
def list_catalogs():
    return cat.summary(_hidden())


@app.post("/api/catalogs", status_code=201)
async def import_catalog(file: UploadFile = File(...), id: str = Form(...), name: str = Form(""),
                         description: str = Form(""), source: str = Form(""), license: str = Form(""),
                         priority: int = Form(50), replace: bool = Form(False)):
    """Import a catalog from CSV (header: id,name,type,ra,dec,mag,maj,min,pa) or JSON."""
    if not replace and any(c["id"] == id for c in cat.catalogs()):
        raise HTTPException(409, f"Catalog '{id}' already exists")
    try:
        objs = cat.parse_upload((await file.read()).decode("utf-8-sig"), file.filename or "")
        cat.save_catalog({"id": id, "name": name, "description": description, "source": source,
                          "license": license, "priority": priority}, objs)
    except (ValueError, KeyError, UnicodeDecodeError) as e:
        raise HTTPException(422, f"Import failed: {e}")
    return next(c for c in cat.summary(_hidden()) if c["id"] == id)


@app.delete("/api/catalogs/{cid}", status_code=204)
def delete_catalog(cid: str):
    if not cat.delete_catalog(cid):
        raise HTTPException(404, "Unknown catalog")
    h = _hidden() - {cid}
    store.update_settings({"hidden_catalogs": sorted(h)})
    return Response(status_code=204)


@app.get("/api/night")
def night(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
          start: str = Query(..., description="Window start (local noon) in ISO 8601")):
    return Night(_parse(start), lat, lon).events()


@app.get("/api/visibility")
def visibility(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
               start: str = Query(...), min_alt: float = Query(30, ge=0, le=89),
               twilight: float = Query(-18, ge=-18, le=0)):
    st = store.get_settings()
    objs = visible_objects()
    # the same night is requested repeatedly (reloads, toggles) → small in-memory cache
    key = (start, round(lat, 4), round(lon, 4), min_alt, twilight, json.dumps(st.get("horizon")),
           cat._signature(), tuple(st.get("hidden_catalogs", [])), tuple(st.get("hidden_types", [])))
    if key not in _vis_cache:
        n = Night(_parse(start), lat, lon, horizon=st.get("horizon"))
        if len(_vis_cache) > 8:
            _vis_cache.clear()
        _vis_cache[key] = {"night": n.events(), "objects": n.visibility_many(objs, min_alt, twilight)}
    return _vis_cache[key]


_vis_cache: dict = {}


def _object(oid: str):
    return cat.resolve(oid)


@app.get("/api/images")
def image_index():
    """Objects that have a local image, with fov/rot/center."""
    return images.index(cat.all_objects())


@app.get("/api/image/{oid}")
def image(oid: str):
    o = _object(oid)
    if o is None:
        raise HTTPException(404, "Unknown object")
    path = next(filter(None, (images.find(i) for i in [o["id"], *o.get("aka", [])])), None)
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
    if t.object_id and _object(t.object_id) is None:
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
    allowed = {"active_setup", "horizon", "hidden_catalogs", "hidden_types", "ui"}
    if set(values) - allowed:
        raise HTTPException(422, f"Allowed keys: {sorted(allowed)}")
    if "hidden_catalogs" in values:
        h = values["hidden_catalogs"]
        if not (isinstance(h, list) and all(isinstance(x, str) for x in h)):
            raise HTTPException(422, "hidden_catalogs must be a list of catalog ids")
        values["hidden_catalogs"] = sorted(set(h))
    if "ui" in values:                                   # browser UI preferences (theme, toggles, filters, …)
        ui = values["ui"]
        if not isinstance(ui, dict) or len(json.dumps(ui)) > 100_000:
            raise HTTPException(422, "ui must be an object (max 100 kB)")
    if "hidden_types" in values:
        h = values["hidden_types"]
        if not (isinstance(h, list) and set(h) <= set(TYPE_NAMES)):
            raise HTTPException(422, f"hidden_types must be a list of: {', '.join(TYPE_NAMES)}")
        values["hidden_types"] = sorted(set(h))
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
