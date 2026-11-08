"""Positions from static/js/astro.js against astropy (topocentric apparent alt/az, no refraction)."""
import json

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import AltAz, EarthLocation, SkyCoord, get_body, solar_system_ephemeris
from astropy.time import Time

from .conftest import DATES, SITES

import os
# JPL ephemeris for the reference positions: DE440s if available (env DE440S=path), else astropy's builtin (~arcsec)
EPHEM = os.environ.get("DE440S", "builtin")

ROOT_DATA = __import__("pathlib").Path(__file__).resolve().parent.parent / "static" / "data"
# (HIP) Sirius, Polaris, Barnard's star (largest proper motion), Canopus, Vega, Acrux
TEST_HIP = [32349, 11767, 87937, 30438, 91262, 60718]

JS_ALTAZ = """
  const fs = await import('node:fs');
  if (arg.eph) A.setEphemeris(JSON.parse(fs.readFileSync(arg.eph, 'utf8')));
  const out = [];
  for (const [t, lat, lon] of arg.jobs) {
    const F = A.frame(new Date(t), lat, lon);
    const stars = arg.stars.map(([ra, dec, pa, pd]) => A.altaz(A.apply(F.H, A.catalogueToDate(F, ra, dec, pa, pd))));
    const bodies = Object.fromEntries(A.bodies(F).map((b) => [b.name, A.altaz(A.apply(F.H, b.u))]));
    out.push({ stars, bodies });
  }
  return out;
"""


def sep(a1, z1, a2, z2):
    """angular separation in arcsec between (alt, az) pairs, degrees"""
    a1, z1, a2, z2 = map(np.radians, (a1, z1, a2, z2))
    c = np.sin(a1) * np.sin(a2) + np.cos(a1) * np.cos(a2) * np.cos(z1 - z2)
    return np.degrees(np.arccos(np.clip(c, -1, 1))) * 3600


@pytest.fixture(scope="module")
def results(js):
    d = json.loads((ROOT_DATA / "stars.json").read_text())
    by = {s[0]: s for s in d["stars"]}
    stars = [by[h][1:5] for h in TEST_HIP]
    jobs = [[t, lat, lon] for t in DATES for _, lat, lon in SITES]
    return stars, jobs, js(JS_ALTAZ, {"jobs": jobs, "stars": stars, "eph": str(ROOT_DATA / "ephemeris.json")})


def frame_of(t, lat, lon):
    loc = EarthLocation(lat=lat * u.deg, lon=lon * u.deg, height=0 * u.m)
    return AltAz(obstime=Time(t), location=loc, pressure=0), loc


def test_stars(results):
    stars, jobs, out = results
    worst = 0
    for (t, lat, lon), r in zip(jobs, out):
        fr, _ = frame_of(t, lat, lon)
        c = SkyCoord(ra=[s[0] for s in stars] * u.deg, dec=[s[1] for s in stars] * u.deg,
                     pm_ra_cosdec=[s[2] for s in stars] * u.mas / u.yr, pm_dec=[s[3] for s in stars] * u.mas / u.yr,
                     distance=[1000] * len(stars) * u.pc, radial_velocity=[0] * len(stars) * u.km / u.s,
                     obstime=Time("J2000"), frame="icrs").apply_space_motion(new_obstime=Time(t)).transform_to(fr)
        for (alt, az), ca, cz in zip(r["stars"], c.alt.deg, c.az.deg):
            worst = max(worst, sep(alt, az, ca, cz))
    assert worst < 5, f"star error {worst:.1f}″"


@pytest.mark.parametrize("body,tol", [("Sun", 5), ("Moon", 30), ("Mercury", 5), ("Venus", 5), ("Mars", 5),
                                      ("Jupiter", 5), ("Saturn", 5), ("Uranus", 5), ("Neptune", 5)])
def test_bodies(results, body, tol):
    _, jobs, out = results
    worst = 0
    with solar_system_ephemeris.set(EPHEM):
        for (t, lat, lon), r in zip(jobs, out):
            fr, loc = frame_of(t, lat, lon)
            c = get_body(body.lower(), Time(t), loc).transform_to(fr)
            alt, az = r["bodies"][body]
            worst = max(worst, sep(alt, az, c.alt.deg, c.az.deg))
    if EPHEM == "builtin" and body not in ("Sun", "Moon"):
        tol = 60   # astropy's builtin planet theory is itself only good to tens of arcseconds; set DE440S for 5″
    print(body, f"{worst:.1f}″")
    assert worst < tol, f"{body} error {worst:.1f}″"


JS_RTS = """
  const fs = await import('node:fs');
  A.setEphemeris(JSON.parse(fs.readFileSync(arg.eph, 'utf8')));
  return arg.jobs.map(([t, lat, lon]) => {
    const F = A.frame(new Date(t), lat, lon), sun = A.bodies(F).find((b) => b.name === 'Sun');
    const r = A.riseTransitSet((G) => A.bodies(G).find((b) => b.name === 'Sun').u, -0.5667 - sun.diam / 7200, new Date(t), lat, lon);
    return [r.rise && r.rise.toISOString(), r.transit && r.transit.toISOString(), r.set && r.set.toISOString()];
  });
"""


def test_sun_rise_transit_set(js):
    """At the computed times astropy puts the Sun's centre at −0.833° (rise / set) and on the meridian (transit)."""
    jobs = [["2026-06-21T12:00:00Z", 48.1486, 17.1077], ["2026-12-21T12:00:00Z", 48.1486, 17.1077],
            ["2026-03-20T12:00:00Z", -33.92, 18.42]]
    out = js(JS_RTS, {"jobs": jobs, "eph": str(ROOT_DATA / "ephemeris.json")})
    with solar_system_ephemeris.set(EPHEM):
        for (t, lat, lon), (rise, transit, setting) in zip(jobs, out):
            for ev in (rise, setting):
                fr, loc = frame_of(ev.replace("Z", ""), lat, lon)
                s = get_body("sun", Time(ev.replace("Z", "")), loc).transform_to(fr)
                assert abs(s.alt.deg + 0.8333) < 0.01, (t, ev, s.alt.deg)    # ≈ 2 s of time
            fr, loc = frame_of(transit.replace("Z", ""), lat, lon)
            s = get_body("sun", Time(transit.replace("Z", "")), loc).transform_to(fr)
            az = 180 if lat > 0 else 0
            assert abs((s.az.deg - az + 180) % 360 - 180) < 0.02, (t, transit, s.az.deg)


def test_refraction_against_astropy(js):
    """astropy (ERFA refco) is reliable above ~15°; near the horizon compare with the standard value instead."""
    r0 = js("return [A.refraction(0), A.refraction(-0.5667)];")
    assert abs(r0[1] * 60 - 33.5) < 1.5          # apparent horizon: the classic 34′ (true alt −0.57°)
    assert abs(r0[0] * 60 - 28.0) < 1.5           # true altitude 0°: ≈ 29′
    r = js("return arg.map((h) => A.refraction(h));", [15, 20, 45, 80])
    for h, rr in zip([15, 20, 45, 80], r):
        loc = EarthLocation(lat=0 * u.deg, lon=0 * u.deg)
        t = Time("2026-01-01T00:00:00")
        true = AltAz(obstime=t, location=loc, pressure=0)
        app = AltAz(obstime=t, location=loc, pressure=1010 * u.hPa, temperature=10 * u.deg_C, relative_humidity=0,
                     obswl=0.55 * u.micron)   # visual light (astropy defaults to 1 µm)
        c = SkyCoord(alt=h * u.deg, az=0 * u.deg, frame=true).transform_to(app)
        ref = c.alt.deg - h
        assert abs(rr - ref) < 0.5 / 3600, (h, rr * 3600, ref * 3600)


def test_star_positions_in_view(js):
    """Proper motion: Barnard's star moved ~ 4.6′ between 2000 and 2027."""
    r = js("""
      const F = A.frame(new Date('2027-01-01T00:00:00Z'), 0, 0);
      const u0 = A.vec(269.452077, 4.693388), u = A.properMotion(u0, 269.452077, 4.693388, -797.84, 10326.93, 27);
      return Math.acos(u0[0] * u[0] + u0[1] * u[1] + u0[2] * u[2]) * A.R2D * 60;
    """)
    assert abs(r - 10.357 * 27 / 60) < 0.01
