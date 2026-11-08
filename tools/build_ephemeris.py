#!/usr/bin/env python3
"""Build static/data/ephemeris.json: corrections that turn the Keplerian planet model of static/js/astro.js into
JPL DE440 positions.

The browser computes a planet's heliocentric position from mean Keplerian elements (Standish, JPL) and adds a
residual Δ = DE440 − Kepler, tabulated here every `step` days and interpolated with a cubic (Catmull-Rom / Lagrange)
polynomial. The residual varies slowly, so a coarse table reproduces DE440 to about an arcsecond.

Bodies: Mercury … Neptune and the Earth–Moon barycentre (the Earth itself is EMB − Moon/82.3, done in astro.js).
Frame: heliocentric, mean ecliptic & equinox J2000, AU.  Source: JPL DE440s (`de440s.bsp`, needs `jplephem`).

  python3 tools/build_ephemeris.py --bsp de440s.bsp [--check]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "static" / "data" / "ephemeris.json"
AU = 149597870.7
EPS = math.radians(84381.448 / 3600)
START, END = 2415020.5, 2488069.5        # 1900-01-01 … 2100-01-01 (TDB ≈ TT)
EL = {   # same table as static/js/astro.js
    "Mercury": [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    "Venus": [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
    "Earth": [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
    "Mars": [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    "Jupiter": [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    "Saturn": [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
    "Uranus": [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
    "Neptune": [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
}
NAIF = {"Mercury": 199, "Venus": 299, "Earth": 3, "Mars": 4, "Jupiter": 5, "Saturn": 6, "Uranus": 7, "Neptune": 8}
STEP = {"Mercury": 8, "Venus": 16, "Earth": 16, "Mars": 16, "Jupiter": 60, "Saturn": 80, "Uranus": 160, "Neptune": 200}


def kepler(name, jd):
    T = (jd - 2451545) / 36525
    e0, r = EL[name]
    a, e, I, L, wp, Om = [v + r[i] * T for i, v in enumerate(e0)]
    w = math.radians(wp - Om)
    M = math.radians((L - wp + 180) % 360) - math.pi
    E = M + e * math.sin(M)
    for _ in range(10):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    xp, yp = a * (math.cos(E) - e), a * math.sqrt(1 - e * e) * math.sin(E)
    cw, sw, cO, sO = math.cos(w), math.sin(w), math.cos(math.radians(Om)), math.sin(math.radians(Om))
    cI, sI = math.cos(math.radians(I)), math.sin(math.radians(I))
    return np.array([(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
                     (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
                     sw * sI * xp + cw * sI * yp])


class DE:
    def __init__(self, path):
        from jplephem.spk import SPK
        self.k = SPK.open(str(path))

    def bary(self, code, jd):
        if code in (199, 299):
            return self.k[0, code // 100].compute(jd) + self.k[code // 100, code].compute(jd)
        return self.k[0, code].compute(jd)

    def helio(self, name, jd):
        v = (self.bary(NAIF[name], jd) - self.k[0, 10].compute(jd)) / AU   # ICRF equatorial, AU
        return np.array([v[0], v[1] * math.cos(EPS) + v[2] * math.sin(EPS), -v[1] * math.sin(EPS) + v[2] * math.cos(EPS)])


def interp(tab, t0, step, jd):   # cubic Lagrange through 4 points, same as astro.js
    x = (jd - t0) / step
    i = min(max(int(math.floor(x)), 1), len(tab) - 3)
    f = x - i
    p0, p1, p2, p3 = (np.array(tab[i + k]) for k in (-1, 0, 1, 2))
    return (p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bsp", required=True)
    ap.add_argument("--check", action="store_true", help="report the interpolation error")
    a = ap.parse_args()
    de = DE(a.bsp)
    out = {"source": "JPL DE440s minus the Keplerian elements of Standish (JPL); heliocentric ecliptic J2000, AU",
           "t0": START, "bodies": {}}
    for name in EL:
        step = STEP[name]
        n = int((END - START) / step) + 1
        tab = [[round(float(x), 6) for x in de.helio(name, START + i * step) - kepler(name, START + i * step)]
               for i in range(n)]
        out["bodies"][name] = {"step": step, "d": [x for row in tab for x in row]}
        if a.check:
            worst = 0
            for jd in np.linspace(START + 2 * step, END - 2 * step, 3000):
                err = np.linalg.norm(kepler(name, jd) + interp(tab, START, step, jd) - de.helio(name, jd))
                worst = max(worst, err)
            dmin = {"Mercury": 0.55, "Venus": 0.26, "Earth": 1, "Mars": 0.37, "Jupiter": 3.9, "Saturn": 8, "Uranus": 17, "Neptune": 28}[name]
            print(f"{name:8s} step {step:3d} d  max {worst * AU:8.1f} km  ≈ {math.degrees(worst / dmin) * 3600:6.2f}″ at closest approach")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{OUT.name}: {OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
