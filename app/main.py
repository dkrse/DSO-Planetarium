from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import images
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
    n = Night(_parse(start), lat, lon)
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


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
