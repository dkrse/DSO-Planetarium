"""Lightweight astronomy (no external libraries).

Accuracy: Sun ~0.01°, Moon ~0.3°, rise/set times ~1–2 min.
Good enough for astrophotography planning.
"""
import math
from datetime import datetime, timedelta, timezone

SID = 360.98564736629  # deg/day – sidereal rate
D2R = math.pi / 180.0


def jd(dt: datetime) -> float:
    return dt.timestamp() / 86400.0 + 2440587.5


def lst_deg(j: float, lon: float) -> float:
    return (280.46061837 + SID * (j - 2451545.0) + lon) % 360.0


def altaz(ra: float, dec: float, lat: float, lst: float):
    H = (lst - ra) * D2R
    d, p = dec * D2R, lat * D2R
    s = math.sin(p) * math.sin(d) + math.cos(p) * math.cos(d) * math.cos(H)
    alt = math.asin(max(-1.0, min(1.0, s)))
    az = math.atan2(math.sin(H), math.cos(H) * math.sin(p) - math.tan(d) * math.cos(p))
    return math.degrees(alt), (math.degrees(az) + 180.0) % 360.0


def _ecl_to_eq(lam, beta, eps):
    lam, beta, eps = lam * D2R, beta * D2R, eps * D2R
    ra = math.atan2(math.sin(lam) * math.cos(eps) - math.tan(beta) * math.sin(eps), math.cos(lam))
    dec = math.asin(math.sin(beta) * math.cos(eps) + math.cos(beta) * math.sin(eps) * math.sin(lam))
    return math.degrees(ra) % 360.0, math.degrees(dec)


def sun_ecl(j):
    n = j - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360
    g = (357.528 + 0.9856003 * n) * D2R
    return (L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360, 23.439 - 4e-7 * n


def sun_radec(j):
    lam, eps = sun_ecl(j)
    return _ecl_to_eq(lam, 0.0, eps)


def moon_ecl(j):
    d = j - 2451545.0
    L = 218.316 + 13.176396 * d
    M = (134.963 + 13.064993 * d) * D2R
    F = (93.272 + 13.229350 * d) * D2R
    D = (297.850 + 12.190749 * d) * D2R
    Ms = (357.529 + 0.98560028 * d) * D2R
    lon = (L + 6.289 * math.sin(M) + 1.274 * math.sin(2 * D - M) + 0.658 * math.sin(2 * D)
           + 0.214 * math.sin(2 * M) - 0.186 * math.sin(Ms) - 0.114 * math.sin(2 * F))
    lat = (5.128 * math.sin(F) + 0.280 * math.sin(M + F) + 0.277 * math.sin(M - F)
           + 0.173 * math.sin(2 * D - F))
    return lon % 360, lat


def moon_radec(j):
    lam, beta = moon_ecl(j)
    _, eps = sun_ecl(j)
    return _ecl_to_eq(lam, beta, eps)


def moon_illum(j):
    lam, beta = moon_ecl(j)
    slam, _ = sun_ecl(j)
    cpsi = math.cos(beta * D2R) * math.cos((lam - slam) * D2R)
    waxing = ((lam - slam) % 360) < 180
    return (1 - cpsi) / 2, waxing


def moon_alt_topo(alt):
    # lunar parallax ~0.95°
    return alt - 0.95 * math.cos(alt * D2R)


def separation(ra1, dec1, ra2, dec2):
    a = (math.sin(dec1 * D2R) * math.sin(dec2 * D2R)
         + math.cos(dec1 * D2R) * math.cos(dec2 * D2R) * math.cos((ra1 - ra2) * D2R))
    return math.degrees(math.acos(max(-1.0, min(1.0, a))))


def precession_matrix(j: float):
    """IAU 1976 precession matrix J2000 → mean equator of date (row-major 3×3)."""
    T = (j - 2451545.0) / 36525.0
    a = 1 / 3600 * D2R
    zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * a
    z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * a
    th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * a
    cz, sz, cZ, sZ, ct, st = math.cos(zeta), math.sin(zeta), math.cos(z), math.sin(z), math.cos(th), math.sin(th)
    return [[cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
            [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
            [st * cz, -st * sz, ct]]


def precess(ra: float, dec: float, j: float, inverse: bool = False):
    """J2000 → of date (inverse=True: of date → J2000). Degrees in, degrees out."""
    P = precession_matrix(j)
    v = (math.cos(dec * D2R) * math.cos(ra * D2R), math.cos(dec * D2R) * math.sin(ra * D2R), math.sin(dec * D2R))
    if inverse:
        w = [sum(P[k][i] * v[k] for k in range(3)) for i in range(3)]
    else:
        w = [sum(P[i][k] * v[k] for k in range(3)) for i in range(3)]
    return math.degrees(math.atan2(w[1], w[0])) % 360.0, math.degrees(math.asin(max(-1.0, min(1.0, w[2]))))


def horizon_alt(az: float, points) -> float:
    """Altitude of a custom horizon profile at azimuth az (linear interpolation, wraps at 360°).
    points: [[az, alt], ...]; empty → flat horizon (0°)."""
    if not points:
        return 0.0
    pts = sorted((p[0] % 360.0, p[1]) for p in points)
    az %= 360.0
    prev = (pts[-1][0] - 360.0, pts[-1][1])
    for a, h in pts + [(pts[0][0] + 360.0, pts[0][1])]:
        if az <= a:
            return prev[1] + (h - prev[1]) * ((az - prev[0]) / (a - prev[0]) if a != prev[0] else 0)
        prev = (a, h)
    return pts[-1][1]


# standard altitude of a star / DSO at rise and set (centre at the horizon + 34′ refraction)
H0_STAR = -0.5667


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _crossings(times, alts, h):
    """Return [(time, 'rise'|'set')] for crossings of altitude h."""
    out = []
    for i in range(len(alts) - 1):
        a0, a1 = alts[i] - h, alts[i + 1] - h
        if a0 == a1 or (a0 < 0) == (a1 < 0):
            continue
        f = a0 / (a0 - a1)
        t = times[i] + (times[i + 1] - times[i]) * f
        out.append((t, "rise" if a1 > a0 else "set"))
    return out


def _first(cr, kind):
    return next((t for t, k in cr if k == kind), None)


class Night:
    """Precomputed time grid for one night (24 h from window start)."""

    def __init__(self, start: datetime, lat: float, lon: float, step_min: int = 5, horizon=None):
        self.start, self.lat, self.lon, self.horizon = start, lat, lon, horizon or []
        n = 24 * 60 // step_min + 1
        self.step_h = step_min / 60
        self.times = [start + timedelta(minutes=step_min * i) for i in range(n)]
        self.jds = [jd(t) for t in self.times]
        self.lsts = [lst_deg(j, lon) for j in self.jds]
        self.sun_alt = []
        self.moon_alt = []
        for j, l in zip(self.jds, self.lsts):
            ra, dec = sun_radec(j)
            self.sun_alt.append(altaz(ra, dec, lat, l)[0])
            ra, dec = moon_radec(j)
            self.moon_alt.append(moon_alt_topo(altaz(ra, dec, lat, l)[0]))

    def events(self):
        t, s = self.times, self.sun_alt
        ev = {}
        for name, h in (("sun", -0.833), ("civil", -6), ("nautical", -12), ("astro", -18)):
            cr = _crossings(t, s, h)
            ev[name + "_dusk"] = iso(_first(cr, "set"))
            ev[name + "_dawn"] = iso(_first(cr, "rise"))
        cr = _crossings(t, self.moon_alt, 0.125)
        ev["moon_rise"] = iso(_first(cr, "rise"))
        ev["moon_set"] = iso(_first(cr, "set"))
        mid = self.jds[len(self.jds) // 2]
        illum, waxing = moon_illum(mid)
        ev["moon_illum"] = round(illum, 3)
        ev["moon_waxing"] = waxing
        ev["dark_hours"] = round(sum(self.step_h for a in s if a <= -18), 2)
        return ev

    def visibility(self, obj, min_alt=30.0, twilight=-18.0):
        # catalog is J2000 → precess to the mean equator of this night
        ra, dec = precess(obj["ra"], obj["dec"], self.jds[len(self.jds) // 2])
        lat = self.lat
        aa = [altaz(ra, dec, lat, l) for l in self.lsts]
        alts = [a for a, _ in aa]
        cr = _crossings(self.times, alts, H0_STAR)
        # usable = above the minimum altitude AND above the local horizon profile
        margin = [a - max(min_alt, horizon_alt(z, self.horizon)) for a, z in aa]
        cr_lim = _crossings(self.times, margin, 0.0)

        # transit, analytically
        dt_days = ((ra - self.lsts[0]) % 360.0) / SID
        transit = self.start + timedelta(days=dt_days)
        max_alt = 90.0 - abs(lat - dec)

        good = [(self.times[i], a) for i, a in enumerate(alts)
                if margin[i] >= 0 and self.sun_alt[i] <= twilight]
        hours = len(good) * self.step_h
        moon_dark = [self.moon_alt[i] < 0 for i in range(len(alts))
                     if margin[i] >= 0 and self.sun_alt[i] <= twilight]

        mid_j = self.jds[len(self.jds) // 2]
        mra, mdec = moon_radec(mid_j)

        if dec > 90 - abs(lat) and (dec * lat) > 0:
            status = "circumpolar"
        elif max_alt < 0:
            status = "never"
        else:
            status = "normal"

        return {
            "id": obj["id"],
            "rise": iso(_first(cr, "rise")),
            "set": iso(_first(cr, "set")),
            "transit": iso(transit),
            "max_alt": round(max_alt, 1),
            "limit_rise": iso(_first(cr_lim, "rise")),
            "limit_set": iso(_first(cr_lim, "set")),
            "window_start": iso(good[0][0]) if good else None,
            "window_end": iso(good[-1][0]) if good else None,
            "hours": round(hours, 2),
            "moonless_hours": round(sum(self.step_h for m in moon_dark if m), 2),
            "moon_sep": round(separation(ra, dec, mra, mdec), 1),
            "status": status,
        }
