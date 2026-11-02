#!/usr/bin/env python3
"""Build app/data/catalogs/openngc.json from OpenNGC (https://github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0).

Selection for astrophotography: all Messier objects, objects brighter than --mag, larger than --size,
or with a common name. Duplicates, single stars and non-existent entries are dropped.

    python tools/build_catalog.py                       # main catalog: Messier, ≤ 11 mag, ≥ 8′ or named
    python tools/build_catalog.py --faint               # second catalog: objects between 11 and 13 mag
    python tools/build_catalog.py --src /path/to/OpenNGC/database_files --mag 11 --size 8
"""
import argparse
import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "data" / "catalogs"
BASE = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/"

TYPE_MAP = {
    "G": "G", "GPair": "G", "GTrpl": "G", "GGroup": "G",
    "OCl": "OC", "*Ass": "OC", "GCl": "GC", "PN": "PN",
    "HII": "EN", "EmN": "EN", "Neb": "EN", "Cl+N": "EN",
    "RfN": "RN", "SNR": "SNR", "DrkN": "DN",
}
# addendum entries that duplicate other objects (C014 = NGC 869 + 884) or get a better-known id
SKIP = {"C014"}
RENAME = {"C009": "Sh2-155"}
# names chosen for this app where OpenNGC has none or a less common one
NAME_OVERRIDE = {
    "IC434": "Horsehead region", "NGC2237": "Rosette Nebula", "NGC2244": "Rosette Cluster",
    "IC1805": "Heart Nebula", "IC1848": "Soul Nebula", "NGC6960": "Western Veil", "NGC6992": "Eastern Veil",
    "NGC869": "h Persei", "NGC884": "Chi Persei", "IC1396": "Elephant's Trunk region", "NGC2264": "Cone / Christmas Tree",
    "M24": "Sagittarius Star Cloud", "M40": "Winnecke 4", "M102": "Spindle Galaxy (NGC 5866)",
}


def norm_id(name: str) -> str:
    m = re.match(r"^([A-Za-z]+)0*(\d.*)$", name)
    return f"{m.group(1)}{m.group(2)}" if m else name


def sexa(s: str, hours: bool) -> float:
    sign = -1 if s.startswith("-") else 1
    d, m, x = (float(v) for v in s.lstrip("+-").split(":"))
    return sign * (d + m / 60 + x / 3600) * (15 if hours else 1)


def num(s: str):
    try:
        return float(s)
    except ValueError:
        return None


def load(src: str | None, fname: str):
    if src:
        return (Path(src) / fname).read_text(encoding="utf-8")
    with urllib.request.urlopen(BASE + fname, timeout=60) as r:
        return r.read().decode("utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="local OpenNGC database_files directory (default: download)")
    ap.add_argument("--mag", type=float, default=11.0, help="include objects brighter than this")
    ap.add_argument("--size", type=float, default=8.0, help="include objects larger than this [arcmin]")
    ap.add_argument("--faint", action="store_true",
                    help="build the 'openngc_faint' catalog: only objects with --mag < mag ≤ --faint-mag")
    ap.add_argument("--faint-mag", type=float, default=13.0)
    a = ap.parse_args()

    rows = []
    for f in ("NGC.csv", "addendum.csv"):
        rows += list(csv.DictReader(io.StringIO(load(a.src, f)), delimiter=";"))

    out, seen = [], set()
    for r in rows:
        messier = r["M"].strip()
        typ = TYPE_MAP.get(r["Type"]) or ("AST" if messier and r["Type"] in ("*", "**") else None)
        if not typ or not r["RA"]:
            continue
        mag = num(r["V-Mag"]) or num(r["B-Mag"])
        maj, mn = num(r["MajAx"]), num(r["MinAx"])
        common = [n.strip() for n in r["Common names"].split(",") if n.strip()]
        main_sel = messier or (mag is not None and mag <= a.mag) or (maj or 0) >= a.size or common
        if a.faint:
            if main_sel or mag is None or mag > a.faint_mag:    # only what the main catalog leaves out
                continue
        elif not main_sel:
            continue
        if r["Name"] in SKIP:
            continue
        oid = f"M{int(messier)}" if messier else RENAME.get(r["Name"], norm_id(r["Name"]))
        if oid in seen:
            continue
        seen.add(oid)
        maj = maj or mn or 1.0
        out.append({
            "id": oid, "name": NAME_OVERRIDE.get(oid, common[0] if common else ""), "type": typ,
            "ra": round(sexa(r["RA"], True), 5), "dec": round(sexa(r["Dec"], False), 5),
            "mag": round(mag, 1) if mag is not None else 0, "maj": round(maj, 2), "min": round(mn or maj, 2),
            "pa": num(r["PosAng"]) or 0, "ngc": norm_id(r["Name"]) if messier else None,
        })

    out.sort(key=lambda o: (not o["id"].startswith("M"), o["id"][:1], int(re.sub(r"\D", "", o["id"]) or 0), o["id"]))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if a.faint:
        meta = {"id": "openngc_faint", "name": f"OpenNGC faint ({a.mag:g}–{a.faint_mag:g} mag)", "priority": 15,
                "description": f"Fainter NGC / IC objects, {a.mag:g} < mag ≤ {a.faint_mag:g} – mostly galaxies; "
                               "reachable with stacking, e.g. with a Seestar or a small refractor."}
    else:
        meta = {"id": "openngc", "name": "OpenNGC (NGC / IC / Messier)", "priority": 10,
                "description": f"NGC and IC objects incl. all Messier objects, selected for astrophotography "
                               f"(≤ {a.mag:g} mag, ≥ {a.size:g}′ or named)."}
    OUT = OUT_DIR / f"{meta['id']}.json"
    OUT.write_text(json.dumps({
        **meta, "builtin": True, "merge_by_position": False,   # neighbouring NGC/IC objects are distinct
        "source": "OpenNGC by Mattia Verga, https://github.com/mattiaverga/OpenNGC",
        "license": "CC-BY-SA-4.0",
        "selection": {"mag": a.mag, "size_arcmin": a.size, **({"faint_mag": a.faint_mag} if a.faint else {})},
        "objects": out}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(out)} objects → {OUT}  (Messier: {sum(o['id'].startswith('M') and o['id'][1:].isdigit() for o in out)})")


if __name__ == "__main__":
    main()
