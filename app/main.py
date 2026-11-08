"""DSO Planetarium – serves the static planetarium (all astronomy runs in the browser, see static/js/astro.js)."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="DSO Planetarium")
app.add_middleware(GZipMiddleware, minimum_size=1000)   # the star catalogue compresses ~3×


@app.middleware("http")
async def revalidate(request, call_next):
    """Modules and data are revalidated on each load so a browser never mixes new and stale modules."""
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.get("/api/health")
def health():
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
