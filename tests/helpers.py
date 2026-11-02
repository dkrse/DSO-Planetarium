"""Reference values from astropy (geometric altitude: no refraction)."""
import math
import warnings
from datetime import datetime, timezone

import astropy.units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord, get_body
from astropy.time import Time

warnings.filterwarnings("ignore")


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def frame(lat, lon, t):
    loc = EarthLocation(lat=lat * u.deg, lon=lon * u.deg, height=0 * u.m)
    return AltAz(obstime=Time(t), location=loc, pressure=0 * u.hPa), loc


def ref_star(ra, dec, lat, lon, t):
    f, _ = frame(lat, lon, t)
    a = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").transform_to(f)
    return a.alt.deg, a.az.deg


def ref_body(name, lat, lon, t):
    f, loc = frame(lat, lon, t)
    a = get_body(name, Time(t), loc).transform_to(f)
    return a.alt.deg, a.az.deg


def sep(alt1, az1, alt2, az2):
    """Angular separation of two horizontal positions [deg]."""
    r = math.radians
    c = (math.sin(r(alt1)) * math.sin(r(alt2)) + math.cos(r(alt1)) * math.cos(r(alt2)) * math.cos(r(az1 - az2)))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))
