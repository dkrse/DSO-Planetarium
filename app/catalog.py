"""Deep-sky catalogs.

Every catalog is one JSON file in app/data/catalogs/:

    {"id": "sharpless", "name": "Sharpless (Sh2)", "priority": 20, "builtin": true,
     "description": "...", "source": "...", "license": "...",
     "objects": [{"id": "Sh2-155", "name": "Cave Nebula", "type": "EN", "ra": 344.47, "dec": 62.52,
                  "mag": 0, "maj": 50, "min": 30, "pa": 0}, ...]}

Objects are merged by id; when two catalogs contain the same id, the catalog with the lower
`priority` number wins (OpenNGC 10, Sharpless 20, Barnard 30, user imports 50, extras 90).
Catalogs can be imported, deleted and hidden at run time (see app/main.py).

Object types: G galaxy, GC globular cluster, OC open cluster, EN emission nebula, RN reflection
nebula, PN planetary nebula, SNR supernova remnant, DN dark nebula, AST asterism / star cloud.
Coordinates J2000 in degrees, sizes in arcminutes, PA in degrees (N→E).
"""
import csv
import io
import json
import math
import re
import threading
from pathlib import Path

CATALOG_DIR = Path(__file__).resolve().parent / "data" / "catalogs"

TYPE_NAMES = {
    "G": "Galaxy", "GC": "Globular cluster", "OC": "Open cluster",
    "EN": "Emission nebula", "RN": "Reflection nebula", "PN": "Planetary nebula",
    "SNR": "Supernova remnant", "DN": "Dark nebula", "AST": "Asterism / star cloud",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")

_lock = threading.Lock()
_cache: dict = {"sig": None, "cats": []}


def _signature():
    files = sorted(CATALOG_DIR.glob("*.json")) if CATALOG_DIR.exists() else []
    return tuple((f.name, f.stat().st_mtime_ns) for f in files)


def catalogs() -> list[dict]:
    """All catalogs (with objects), sorted by priority. Re-read when files change."""
    with _lock:
        sig = _signature()
        if sig != _cache["sig"]:
            cats = []
            for name, _ in sig:
                d = json.loads((CATALOG_DIR / name).read_text(encoding="utf-8"))
                d.setdefault("id", Path(name).stem)
                d.setdefault("priority", 50)
                cats.append(d)
            _cache.update(sig=sig, cats=sorted(cats, key=lambda c: (c["priority"], c["id"])))
        return _cache["cats"]


# ---------------------------------------------------------------- cross-catalog duplicates
# The same nebula often appears under different ids (Sh2-117 = NGC 7000, Sh2-281 = M42). An object of a
# lower-priority catalog is treated as the same object when it is close to one of a higher-priority catalog
# (≤ max(5′, 20 % of the larger size)), the sizes differ at most 3× and the types are compatible.
# It is then not shown separately; its id is added to the main object's `aka` list (searchable).
# Catalogs with `"merge_by_position": false` (OpenNGC: neighbouring NGC/IC objects are distinct, e.g. M60 + NGC 4647)
# are only de-duplicated by id.
TYPE_GROUP = {"EN": "bright", "RN": "bright", "SNR": "bright", "PN": "bright", "DN": "dark",
              "G": "G", "GC": "GC", "OC": "OC", "AST": "OC"}
NO_MERGE = {"Sh2-103",   # Cygnus Loop – the whole loop, not just one Veil arc
            "Sh2-277"}   # Flame Nebula – its catalogued position lies between NGC 2024 and IC 434


def _sep_arcmin(a, b):
    r = math.radians
    c = (math.sin(r(a["dec"])) * math.sin(r(b["dec"]))
         + math.cos(r(a["dec"])) * math.cos(r(b["dec"])) * math.cos(r(a["ra"] - b["ra"])))
    return math.degrees(math.acos(max(-1.0, min(1.0, c)))) * 60


def find_same(o, buckets):
    """Best matching earlier object for o (or None). buckets: {int(dec): [objects]}."""
    if o["id"] in NO_MERGE:
        return None
    best, g = None, TYPE_GROUP.get(o["type"])
    for b in range(int(math.floor(o["dec"])) - 2, int(math.floor(o["dec"])) + 3):
        for h in buckets.get(b, ()):
            if TYPE_GROUP.get(h["type"]) != g:
                continue
            big, small = max(o["maj"], h["maj"]), max(1e-3, min(o["maj"], h["maj"]))
            if big / small > 3:
                continue
            d = _sep_arcmin(o, h)
            if d <= max(5.0, 0.2 * big):
                score = d / big + 0.3 * math.log(big / small)
                if best is None or score < best[0]:
                    best = (score, h)
    return best and best[1]


_merge_cache: dict = {}


def merged(hidden=()) -> tuple[list[dict], dict]:
    """Objects of all visible catalogs, de-duplicated by id and by position; plus per-catalog stats."""
    key = (_signature(), tuple(sorted(hidden)))
    if key in _merge_cache:
        return _merge_cache[key]
    out, by_id, stats, buckets = [], {}, {}, {}
    for c in catalogs():
        st = stats.setdefault(c["id"], {"total": len(c["objects"]), "shown": 0, "duplicates": 0})
        if c["id"] in hidden:
            continue
        added = []
        for o in c["objects"]:
            if o["id"] in by_id:
                st["duplicates"] += 1
                continue
            same = find_same(o, buckets) if c.get("merge_by_position", True) else None
            if same is not None:                       # same object under another id
                same.setdefault("aka", []).append(o["id"])
                if not same.get("name") and o.get("name"):
                    same["name"] = o["name"]
                by_id[o["id"]] = same
                st["duplicates"] += 1
                continue
            obj = {**o, "cat": c["id"]}
            out.append(obj); by_id[o["id"]] = obj; added.append(obj)
            st["shown"] += 1
        for obj in added:                              # only earlier catalogs are matched against
            buckets.setdefault(int(math.floor(obj["dec"])), []).append(obj)
    if len(_merge_cache) > 16:
        _merge_cache.clear()
    _merge_cache[key] = (out, stats)
    return out, stats


def resolve(oid: str):
    """Object by id or alias (aka), among all catalogs."""
    for o in all_objects():
        if o["id"] == oid or oid in o.get("aka", ()):
            return o
    return None


def summary(hidden=()) -> list[dict]:
    _, stats = merged(hidden)
    return [{k: c.get(k) for k in ("id", "name", "description", "source", "license", "priority", "builtin")}
            | stats[c["id"]] | {"hidden": c["id"] in hidden} for c in catalogs()]


# ---------------------------------------------------------------- import / delete
def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _angle(v, hours: bool) -> float:
    """Degrees from 12.5 / '12.5' or sexagesimal '10:41:04.5' / '10 41 04.5' (RA sexagesimal = hours)."""
    s = str(v).strip()
    if re.search(r"[:\s]", s):
        sign = -1 if s.startswith("-") else 1
        parts = [float(p) for p in re.split(r"[:\s]+", s.lstrip("+-")) if p]
        return sign * sum(p / 60 ** i for i, p in enumerate(parts)) * (15 if hours else 1)
    return float(s)


def normalise_object(o: dict) -> dict:
    """Validate one imported object; raises ValueError with a readable message."""
    oid = str(o.get("id", "")).strip()
    if not oid:
        raise ValueError("object without id")
    typ = str(o.get("type") or "EN").strip().upper()
    if typ not in TYPE_NAMES:
        raise ValueError(f"{oid}: unknown type {typ!r} (allowed: {', '.join(TYPE_NAMES)})")
    try:
        ra, dec = _angle(o["ra"], hours=True), _angle(o["dec"], hours=False)
    except (KeyError, ValueError):
        raise ValueError(f"{oid}: missing or invalid ra/dec")
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        raise ValueError(f"{oid}: coordinates out of range")
    maj = _num(o.get("maj"), 1.0) or 1.0
    return {"id": oid, "name": str(o.get("name") or ""), "type": typ, "ra": round(ra % 360, 5), "dec": round(dec, 5),
            "mag": _num(o.get("mag")), "maj": maj, "min": _num(o.get("min"), maj) or maj, "pa": _num(o.get("pa"))}


def parse_upload(text: str, filename: str = "") -> list[dict]:
    """JSON (list of objects, or a catalog document with "objects") or CSV with a header row
    id,name,type,ra,dec,mag,maj,min,pa (separated by ',', ';' or tab). RA: degrees or h:m:s."""
    if filename.lower().endswith(".json") or text.lstrip().startswith(("{", "[")):
        d = json.loads(text)
        rows = d["objects"] if isinstance(d, dict) else d
    else:
        dialect = csv.Sniffer().sniff(text.split("\n", 1)[0], delimiters=",;\t")
        rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
                for r in csv.DictReader(io.StringIO(text), dialect=dialect)]
    objs = [normalise_object(r) for r in rows]
    if not objs:
        raise ValueError("no objects found")
    return objs


def save_catalog(meta: dict, objects: list[dict]) -> dict:
    cid = meta["id"]
    if not ID_RE.match(cid):
        raise ValueError("catalog id: lowercase letters, digits, '-' or '_' (max 40 characters)")
    doc = {"id": cid, "name": meta.get("name") or cid, "priority": int(meta.get("priority") or 50),
           "builtin": False, "description": meta.get("description", ""), "source": meta.get("source") or "imported",
           "license": meta.get("license", ""), "objects": objects}
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    (CATALOG_DIR / f"{cid}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return doc


def delete_catalog(cid: str) -> bool:
    p = CATALOG_DIR / f"{cid}.json"
    if not ID_RE.match(cid) or not p.exists():
        return False
    p.unlink()
    return True


def all_objects() -> list[dict]:
    """Every object of every catalog (hidden ones too) – for scripts such as download_images.py."""
    return merged()[0]
