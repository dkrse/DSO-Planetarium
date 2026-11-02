#!/usr/bin/env python3
"""One-off download of catalog images into images/.

Source: NASA SkyView – DSS2 Red + DSS2 Blue, the color image is composed locally
(R = red, G = (red+blue)/2, B = blue, background subtracted). Covers the whole sky.

    python tools/download_images.py                    # whole catalog
    python tools/download_images.py --only M31 M42 --force --px 1024
Existing files (including your own photos) are not overwritten without --force.
Requires: pip install pillow numpy
"""
import argparse
import io
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.catalog import CATALOG                    # noqa: E402
from app.images import IMAGES, find, image_fov      # noqa: E402

SKYVIEW = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl"


def band(o, survey, px, tries=3):
    q = urllib.parse.urlencode({
        "Survey": survey, "Position": f"{o['ra']:.5f},{o['dec']:.5f}", "Coordinates": "J2000",
        "Projection": "Tan", "Size": f"{image_fov(o):.4f}", "Pixels": px,
        "Scaling": "Log", "Return": "JPEG"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(f"{SKYVIEW}?{q}", timeout=180) as r:
                im = Image.open(io.BytesIO(r.read()))
            if im.size != (px, px):          # SkyView returns a small "no data" image
                raise IOError(f"{survey}: no data")
            return np.asarray(im.convert("L"), dtype=np.float32)
        except IOError:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def stretch(x):
    bg, top = np.percentile(x, 45), np.percentile(x, 99.9)
    y = np.clip((x - bg) / max(top - bg, 1), 0, 1)
    return y ** 0.85


def make(o, px):
    r = stretch(band(o, "DSS2 Red", px))
    try:
        b = stretch(band(o, "DSS2 Blue", px))
    except IOError:
        b = r                                  # no blue band → mono
    rgb = np.stack([r, (r + b) / 2, b], axis=-1)
    return Image.fromarray((rgb * 255).astype(np.uint8), "RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--px", type=int, default=800)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    IMAGES.mkdir(exist_ok=True)
    objs = [o for o in CATALOG if (not a.only or o["id"] in a.only) and (a.force or not find(o["id"]))]
    print(f"Downloading {len(objs)} objects…", flush=True)

    def one(o):
        try:
            make(o, a.px).save(IMAGES / f"{o['id'].replace('/', '_')}.jpg", quality=88)
            print(f"✓ {o['id']}", flush=True)
            return True
        except Exception as e:
            print(f"✗ {o['id']}: {e}", flush=True)
            return False

    with ThreadPoolExecutor(a.workers) as ex:
        ok = sum(ex.map(one, objs))
    print(f"Done: {ok}/{len(objs)} → {IMAGES}")


if __name__ == "__main__":
    main()
