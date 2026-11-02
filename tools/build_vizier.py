#!/usr/bin/env python3
"""Build the Sharpless and Barnard catalogs (app/data/catalogs/*.json) from VizieR.

    python tools/build_vizier.py                 # both
    python tools/build_vizier.py sharpless

Sources (CDS VizieR, please acknowledge "This research has made use of the VizieR catalogue access tool, CDS"):
  VII/20    Sharpless S. (1959) – Catalogue of HII Regions, ApJS 4, 257
  VII/220A  Barnard E.E. (1927) – Catalogue of 349 Dark Objects in the Sky
"""
import http.client
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "catalogs"
MIRRORS = ["https://vizier.cfa.harvard.edu", "https://vizier.cds.unistra.fr"]

SH2_NAMES = {
    25: "Lagoon Nebula", 27: "Zeta Ophiuchi region", 30: "Trifid Nebula", 45: "Omega Nebula", 49: "Eagle Nebula",
    101: "Tulip Nebula", 103: "Cygnus Loop", 106: "Celestial Snow Angel", 108: "Sadr region",
    117: "North America Nebula", 125: "Cocoon Nebula", 129: "Flying Bat Nebula", 131: "Elephant's Trunk region",
    132: "Lion Nebula", 136: "Ghost Nebula", 142: "Wizard Nebula", 155: "Cave Nebula", 157: "Lobster Claw Nebula",
    162: "Bubble Nebula", 184: "Pacman Nebula", 190: "Heart Nebula", 199: "Soul Nebula", 220: "California Nebula",
    229: "Flaming Star Nebula", 240: "Spaghetti Nebula (Simeis 147)", 252: "Monkey Head Nebula", 261: "Lower's Nebula",
    264: "Lambda Orionis Ring", 275: "Rosette Nebula", 276: "Barnard's Loop", 277: "Flame Nebula",
    279: "Running Man Nebula", 281: "Orion Nebula", 308: "Dolphin Head Nebula",
}
B_NAMES = {33: "Horsehead Nebula", 59: "Pipe Nebula (stem)", 72: "Snake Nebula", 78: "Pipe Nebula (bowl)",
           86: "Ink Spot", 142: "Barnard's E (B142)", 143: "Barnard's E (B143)", 150: "Seahorse Nebula"}


def vizier(source: str) -> list[dict]:
    """All columns of one VizieR table (+ computed J2000 position) as a list of dicts."""
    q = urllib.parse.urlencode({"-source": source, "-out.max": "unlimited", "-out.add": "_RAJ2000,_DEJ2000", "-out.all": ""})
    err = None
    for m in MIRRORS:
        try:
            with urllib.request.urlopen(f"{m}/viz-bin/asu-tsv?{q}", timeout=120) as r:
                text = r.read().decode("utf-8")
            break
        except (OSError, http.client.HTTPException) as e:   # try the next mirror
            err = e
    else:
        raise err
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    head = lines[0].split("\t")
    return [dict(zip(head, (v.strip() for v in l.split("\t")))) for l in lines[3:]]   # skip units + dashes


def num(v, default=None):
    try:
        return float(v)
    except ValueError:
        return default


def sharpless():
    objs = []
    for r in vizier("VII/20"):
        n = int(r["Sh2"]); d = num(r["Diam"], 5.0) or 5.0
        objs.append({"id": f"Sh2-{n}", "name": SH2_NAMES.get(n, ""), "type": "EN",
                     "ra": round(float(r["_RAJ2000"]), 5), "dec": round(float(r["_DEJ2000"]), 5),
                     "mag": 0, "maj": d, "min": d, "pa": 0,
                     "bright": int(r["Bright"]) if r["Bright"].isdigit() else None})   # 1 faint … 3 bright
    return {"id": "sharpless", "name": "Sharpless (Sh2)", "priority": 20, "builtin": True,
            "description": "313 HII regions (emission nebulae) north of −27°; sizes are the catalogued diameters.",
            "source": "Sharpless (1959), ApJS 4, 257 – CDS VizieR VII/20",
            "license": "VizieR – free use with acknowledgement (CDS)", "objects": objs}


def barnard():
    objs, seen = [], set()
    for r in vizier("VII/220A/barnard"):
        bid = r["Barn"].replace(" ", "")
        if bid in seen:
            continue
        seen.add(bid)
        n = int("".join(c for c in bid if c.isdigit()))
        d = num(r["Diam"], 5.0) or 5.0
        objs.append({"id": f"B{bid}", "name": B_NAMES.get(n, "") if bid.isdigit() else "", "type": "DN",
                     "ra": round(float(r["_RAJ2000"]), 5), "dec": round(float(r["_DEJ2000"]), 5),
                     "mag": 0, "maj": d, "min": d, "pa": 0})
    return {"id": "barnard", "name": "Barnard (B)", "priority": 30, "builtin": True,
            "description": "349 dark nebulae; sizes are Barnard's diameters (objects without one get 5′).",
            "source": "Barnard (1927) – CDS VizieR VII/220A",
            "license": "VizieR – free use with acknowledgement (CDS)", "objects": objs}


def main():
    which = sys.argv[1:] or ["sharpless", "barnard"]
    OUT.mkdir(parents=True, exist_ok=True)
    for w in which:
        doc = {"sharpless": sharpless, "barnard": barnard}[w]()
        (OUT / f"{doc['id']}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{doc['id']}: {len(doc['objects'])} objects")


if __name__ == "__main__":
    main()
