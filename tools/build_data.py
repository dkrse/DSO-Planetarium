#!/usr/bin/env python3
"""Build the planetarium data files in static/data/ from exactly one source per kind of data.

  stars           Hipparcos Main Catalogue (ESA 1997, I/239) — HEASARC copy `heasarc_hipparcos.tdat.gz`
  deep-sky        OpenNGC (Mattia Verga) — `NGC.csv` + `addendum.csv`  (NGC, IC, Messier and a few others)
  constellations  Stellarium "modern" sky culture — `index.json` (lines by HIP number, IAU boundaries, star names)

Constellation lines reference stars by HIP number, so they are drawn exactly through the Hipparcos stars of
`stars.json` — no separate coordinate list that could disagree.

Usage:
  python3 tools/build_data.py --download DIR     # fetch the three sources into DIR, then build
  python3 tools/build_data.py --src DIR          # build from files already in DIR
"""
import argparse
import csv
import gzip
import json
import math
import re
import urllib.request
from pathlib import Path

URLS = {
    "heasarc_hipparcos.tdat.gz": "https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_hipparcos.tdat.gz",
    "NGC.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
    "addendum.csv": "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv",
    "modern.json": "https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json",
}
OUT = Path(__file__).resolve().parent.parent / "static" / "data"


def download(dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    for name, url in URLS.items():
        print("download", url)
        urllib.request.urlretrieve(url, dst / name)


# ------------------------------------------------------------------ stars (Hipparcos)
def build_stars(src: Path):
    """Positions are propagated from the catalogue epoch J1991.25 to J2000.0 with the proper motion (rigorous,
    on the sphere, parallax/radial velocity neglected). The client propagates further to the date shown."""
    rows = []
    with gzip.open(src / "heasarc_hipparcos.tdat.gz", "rt", encoding="latin-1") as f:
        header, data = True, False
        cols = None
        for line in f:
            if line.startswith("line[1]"):
                cols = line.split("=", 1)[1].split()
            if line.startswith("<DATA>"):
                data = True
                continue
            if not data or line.startswith("<END>"):
                continue
            v = dict(zip(cols, line.rstrip("\n").split("|")))
            if not v.get("ra_deg", "").strip() or not v.get("vmag", "").strip():
                continue   # a few HIP entries have no astrometric solution / magnitude
            hip = int(v["hip_number"])
            ra, dec = float(v["ra_deg"]), float(v["dec_deg"])
            pmra = float(v["pm_ra"] or 0)     # mas/yr, μα* = μα cos δ
            pmde = float(v["pm_dec"] or 0)
            ra, dec = propagate(ra, dec, pmra, pmde, 2000.0 - 1991.25)
            bv = v["bv_color"].strip()
            rows.append([hip, round(ra, 6), round(dec, 6), round(pmra, 1), round(pmde, 1),
                         round(float(v["vmag"]), 2), round(float(bv), 2) if bv else None])
    rows.sort(key=lambda r: r[5])
    return rows


def propagate(ra, dec, pmra, pmde, years):
    """Move a position along its great circle by its proper motion (mas/yr) over `years`."""
    a, d = math.radians(ra), math.radians(dec)
    p = [math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]
    e = [-math.sin(a), math.cos(a), 0.0]
    n = [-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)]
    k = math.radians(1 / 3.6e6) * years
    q = [p[i] + k * (pmra * e[i] + pmde * n[i]) for i in range(3)]
    r = math.sqrt(sum(x * x for x in q))
    q = [x / r for x in q]
    return math.degrees(math.atan2(q[1], q[0])) % 360, math.degrees(math.asin(q[2]))


# ------------------------------------------------------------------ deep-sky objects (OpenNGC)
TYPES = {   # OpenNGC type → (short code, description)
    "G": "Galaxy", "GPair": "Galaxy pair", "GTrpl": "Galaxy triplet", "GGroup": "Group of galaxies",
    "OCl": "Open cluster", "GCl": "Globular cluster", "Cl+N": "Cluster with nebula", "*Ass": "Stellar association",
    "PN": "Planetary nebula", "HII": "HII region", "EmN": "Emission nebula", "RfN": "Reflection nebula",
    "Neb": "Nebula", "DrkN": "Dark nebula", "SNR": "Supernova remnant", "Nova": "Nova star",
    "*": "Star", "**": "Double star", "Other": "Other",
}


def pretty(ident: str) -> str:
    """NGC0224 → NGC 224, IC0434 → IC 434, M045 → M 45, Mel022 → Mel 22, keeps suffixes like 'NED01'."""
    m = re.match(r"^([A-Za-z]+?)(\d+)(.*)$", ident.strip())
    if not m:
        return ident.strip()
    pre, num, rest = m.groups()
    rest = rest.strip()
    return f"{pre} {int(num)}" + (f" {rest}" if rest else "")


def hms(s):
    h, m, sec = s.split(":")
    return (int(h) + int(m) / 60 + float(sec) / 3600) * 15


def dms(s):
    sg = -1 if s.startswith("-") else 1
    d, m, sec = s.lstrip("+-").split(":")
    return sg * (int(d) + int(m) / 60 + float(sec) / 3600)


def num(s):
    s = (s or "").strip()
    return float(s) if s else None


def build_dso(src: Path):
    rows = []
    for fn in ("NGC.csv", "addendum.csv"):
        with open(src / fn, encoding="utf-8") as f:
            rows += list(csv.DictReader(f, delimiter=";"))
    objs, dups = {}, []
    for r in rows:
        t = r["Type"]
        if t == "NonEx":
            continue
        if t == "Dup":
            dups.append(r)
            continue
        if not r["RA"] or not r["Dec"]:
            continue
        name = r["Name"]
        ids = [pretty(name)]
        if r["M"] and ids[0] != f"M {int(r['M'])}":
            ids.insert(0, f"M {int(r['M'])}")
        for col in ("NGC", "IC"):
            for x in filter(None, r[col].split(",")):
                p = pretty(("NGC" if col == "NGC" else "IC") + x.strip())
                if p not in ids:
                    ids.append(p)
        mag = num(r["V-Mag"])
        magb = num(r["B-Mag"])
        o = {
            "id": ids[0], "ids": ids[1:], "type": t,
            "ra": round(hms(r["RA"]), 6), "dec": round(dms(r["Dec"]), 6),
            "maj": num(r["MajAx"]), "min": num(r["MinAx"]), "pa": num(r["PosAng"]),
            "mag": mag if mag is not None else magb, "band": "V" if mag is not None else ("B" if magb is not None else None),
            "sb": num(r["SurfBr"]), "con": r["Const"], "names": sorted([n for n in r["Common names"].split(",") if n], key=lambda n: n.startswith("Amas ")),
            "hubble": r["Hubble"] or None,
        }
        objs[name] = o
    # Duplicates: an entry of type Dup points to the real object through its M / NGC / IC column.
    for r in dups:
        target = None
        if r["NGC"]:
            target = "NGC" + r["NGC"].split(",")[0].strip().zfill(4)
        elif r["IC"]:
            target = "IC" + r["IC"].split(",")[0].strip().zfill(4)
        o = objs.get(target) if target else None
        if o is None and r["M"]:   # e.g. M102 → M101
            o = next((x for x in objs.values() if x["id"] == f"M {int(r['M'])}"), None)
        if o is None:
            continue
        alias = pretty(r["Name"])
        if r["M"]:
            m = f"M {int(r['M'])}"
            if not o["id"].startswith("M "):
                o["ids"].insert(0, o["id"])
                o["id"] = m
            elif m != o["id"]:
                o["ids"].append(m)
        if alias not in o["ids"] and alias != o["id"]:
            o["ids"].append(alias)
    out = []
    for o in objs.values():
        out.append([o["id"], o["ids"], o["type"], o["ra"], o["dec"], o["maj"], o["min"], o["pa"],
                    o["mag"], o["band"], o["sb"], o["con"], o["names"], o["hubble"]])
    out.sort(key=lambda x: (x[8] if x[8] is not None else 99))
    return out


# ------------------------------------------------------------------ constellations (Stellarium modern)
def build_constellations(src: Path, star_hips: set):
    d = json.load(open(src / "modern.json", encoding="utf-8"))
    cons = []
    for c in d["constellations"]:
        abbr = c["id"].split()[-1]
        lines = [[h for h in poly if isinstance(h, int)] for poly in c.get("lines", [])]
        missing = {h for poly in lines for h in poly} - star_hips
        if missing:
            raise SystemExit(f"{abbr}: HIP {sorted(missing)} not in the star catalogue")
        cn = c.get("common_name", {})
        cons.append({"id": abbr, "name": cn.get("native") or abbr, "english": cn.get("english"), "lines": lines})
    # IAU boundaries (Delporte 1930, equinox B1875): "id1:id2 type ra1 dec1 ra2 dec2 CON1 CON2"
    edges = []
    for e in d["edges"]:
        p = e.split()
        edges.append([hms(p[2]), dms(p[3]), hms(p[4]), dms(p[5]), p[6].title(), p[7].title()])
    names = {}
    for k, v in d["common_names"].items():
        if k.startswith("HIP ") and v:
            names[int(k[4:])] = v[0].get("english") or v[0].get("native")
    return cons, {"epoch": d.get("edges_epoch", "B1875"), "edges": edges}, names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, help="directory with the downloaded source files")
    ap.add_argument("--download", type=Path, help="download the sources into this directory first")
    a = ap.parse_args()
    src = a.download or a.src
    if not src:
        ap.error("--src or --download required")
    if a.download:
        download(a.download)
    OUT.mkdir(parents=True, exist_ok=True)

    stars = build_stars(src)
    hips = {s[0] for s in stars}
    cons, bounds, names = build_constellations(src, hips)
    dso = build_dso(src)

    def dump(name, obj):
        (OUT / name).write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {(OUT / name).stat().st_size / 1e6:.2f} MB")

    dump("stars.json", {
        "source": "Hipparcos Main Catalogue (ESA 1997), via HEASARC",
        "epoch": 2000.0, "frame": "ICRS",
        "fields": ["hip", "ra", "dec", "pmra_mas_yr", "pmdec_mas_yr", "vmag", "b_v"],
        "names": {str(k): v for k, v in names.items() if k in hips},
        "stars": stars,
    })
    dump("constellations.json", {
        "source": "Stellarium sky culture 'modern' (lines by HIP number); IAU boundaries (Delporte 1930)",
        "constellations": cons, "boundaries": bounds,
    })
    dump("dso.json", {
        "source": "OpenNGC by Mattia Verga (CC-BY-SA-4.0), NGC.csv + addendum.csv",
        "fields": ["id", "ids", "type", "ra", "dec", "maj_arcmin", "min_arcmin", "pa_deg",
                   "mag", "band", "surf_br", "con", "names", "hubble"],
        "types": TYPES,
        "objects": dso,
    })
    print(f"{len(stars)} stars, {len(names)} star names, {len(cons)} constellations, "
          f"{len(bounds['edges'])} boundary edges, {len(dso)} deep-sky objects")


if __name__ == "__main__":
    main()
