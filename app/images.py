"""Local object images.

Folder `images/` in the project root:
    images/M31.jpg            – image (jpg/png/webp), file name = catalog object ID
    images/M31.json           – optional: {"fov": 3.2, "rot": 0, "ra": 10.68, "dec": 41.27}
        fov    – image width in degrees (default image_fov(obj))
        rot    – rotation: degrees north is turned from the top edge towards east
        ra/dec – image center, if not exactly on the object
Without JSON: centered on the object, north up, east left, width image_fov().
"""
import json
from pathlib import Path

IMAGES = Path(__file__).resolve().parent.parent / "images"
EXTS = (".jpg", ".jpeg", ".png", ".webp")


def image_fov(obj: dict) -> float:
    return max(obj["maj"] / 60 * 1.6, 0.12)


def find(oid: str):
    safe = oid.replace("/", "_")
    for ext in EXTS:
        p = IMAGES / f"{safe}{ext}"
        if p.exists():
            return p
    return None


def meta(obj: dict, path: Path) -> dict:
    m = {"fov": image_fov(obj), "rot": 0.0, "ra": obj["ra"], "dec": obj["dec"]}
    side = path.with_suffix(".json")
    if side.exists():
        try:
            m.update({k: float(v) for k, v in json.loads(side.read_text()).items() if k in m})
        except (ValueError, TypeError, AttributeError):
            pass
    return m


def index(catalog) -> dict:
    out = {}
    for o in catalog:
        p = find(o["id"])
        if p:
            out[o["id"]] = {**meta(o, p), "v": int(p.stat().st_mtime)}
    return out
