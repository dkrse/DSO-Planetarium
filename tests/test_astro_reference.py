"""Accuracy of app/astro.py against astropy."""
from datetime import timedelta

import pytest

from app import astro
from tests.helpers import ref_body, ref_star, sep, utc

# J2000 test objects incl. high-declination ones (precession is largest there)
OBJECTS = {"M31": (10.6847, 41.2690), "M42": (83.8221, -5.3911), "M57": (283.3963, 33.0292),
           "M81": (148.8882, 69.0653), "NGC7000": (314.75, 44.33), "NGC5128": (201.365, -43.019)}


def ours_star(ra, dec, lat, lon, t):
    j = astro.jd(t)
    ra_d, dec_d = astro.precess(ra, dec, j)
    return astro.altaz(ra_d, dec_d, lat, astro.lst_deg(j, lon))


@pytest.mark.parametrize("name", OBJECTS)
def test_dso_position(name, site, when):
    _, lat, lon = site
    ra, dec = OBJECTS[name]
    t = utc(when)
    assert sep(*ours_star(ra, dec, lat, lon, t), *ref_star(ra, dec, lat, lon, when)) < 0.02          # measured max ≈ 0.5′


def test_precession_matters():
    """Without precession the 2026 position of M81 is off by more than 0.2°."""
    t, (ra, dec) = utc("2026-11-02T20:00:00"), OBJECTS["M81"]
    j = astro.jd(t)
    no_prec = astro.altaz(ra, dec, 48.15, astro.lst_deg(j, 17.11))
    assert sep(*no_prec, *ref_star(ra, dec, 48.15, 17.11, "2026-11-02T20:00:00")) > 0.2


def test_sun_position(site, when):
    _, lat, lon = site
    t = utc(when); j = astro.jd(t)
    ours = astro.altaz(*astro.sun_radec(j), lat, astro.lst_deg(j, lon))
    assert sep(*ours, *ref_body("sun", lat, lon, when)) < 0.01                         # measured max ≈ 0.3′


def test_moon_position(site, when):
    _, lat, lon = site
    t = utc(when); j = astro.jd(t)
    alt, az = astro.altaz(*astro.moon_radec(j), lat, astro.lst_deg(j, lon))
    assert sep(astro.moon_alt_topo(alt), az, *ref_body("moon", lat, lon, when)) < 0.3   # measured max ≈ 13′


def _ref_crossing(fn, start, h, rising, minutes=24 * 60):
    """First crossing of altitude h from astropy, 1-minute sampling + interpolation."""
    import numpy as np
    from astropy.time import Time
    t0 = Time(start)
    ts = t0 + np.arange(minutes + 1) * (1 / 1440)
    alts = fn(ts)
    for i in range(len(alts) - 1):
        a0, a1 = alts[i] - h, alts[i + 1] - h
        if (a0 < 0) != (a1 < 0) and (a1 > a0) == rising:
            return start + timedelta(minutes=i + a0 / (a0 - a1))
    return None


@pytest.mark.parametrize("name", ["M31", "M42", "M57"])
def test_object_rise_set_transit(name):
    from astropy.coordinates import AltAz, EarthLocation, SkyCoord
    import astropy.units as u
    lat, lon = 48.1486, 17.1077
    start = utc("2026-11-02T11:00:00")
    ra, dec = OBJECTS[name]
    night = astro.Night(start, lat, lon, step_min=5)
    v = night.visibility({"id": name, "ra": ra, "dec": dec}, min_alt=30)
    loc = EarthLocation(lat=lat * u.deg, lon=lon * u.deg)
    c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
    fn = lambda ts: c.transform_to(AltAz(obstime=ts, location=loc, pressure=0 * u.hPa)).alt.deg
    for key, h, rising in (("rise", astro.H0_STAR, True), ("set", astro.H0_STAR, False), ("limit_rise", 30, True)):
        if v[key] is None:
            continue
        ref = _ref_crossing(fn, start, h, rising)
        ours = utc(v[key][:-1])
        assert abs((ours - ref).total_seconds()) < 120, (key, ours, ref)


def test_twilight_times():
    from astropy.coordinates import AltAz, EarthLocation, get_body
    import astropy.units as u
    lat, lon = 48.1486, 17.1077
    start = utc("2026-11-02T11:00:00")
    ev = astro.Night(start, lat, lon, step_min=5).events()
    loc = EarthLocation(lat=lat * u.deg, lon=lon * u.deg)
    fn = lambda ts: get_body("sun", ts, loc).transform_to(AltAz(obstime=ts, location=loc, pressure=0 * u.hPa)).alt.deg
    for key, h, rising in (("sun_dusk", -0.833, False), ("astro_dusk", -18, False), ("astro_dawn", -18, True)):
        ref = _ref_crossing(fn, start, h, rising)
        assert abs((utc(ev[key][:-1]) - ref).total_seconds()) < 120, (key, ev[key], ref)
