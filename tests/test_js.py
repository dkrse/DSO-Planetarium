"""static/astro.js: parity with app/astro.py and planet accuracy against astropy (needs Node.js)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app import astro
from tests.helpers import ref_body, sep, utc
from tests.test_astro_reference import OBJECTS

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
HERE = Path(__file__).resolve().parent


@pytest.fixture(scope="module")
def js(request):
    from tests.conftest import DATES, SITES
    jobs = [{"t": d + "Z", "lat": lat, "lon": lon, "objects": list(OBJECTS.values())} for d in DATES for _, lat, lon in SITES]
    res = subprocess.run(["node", str(HERE / "js_eval.mjs"), json.dumps(jobs)], capture_output=True, text=True, check=True)
    return list(zip(jobs, json.loads(res.stdout)))


def test_parity_with_python(js):
    for job, r in js:
        t = utc(job["t"][:-1]); j = astro.jd(t); l = astro.lst_deg(j, job["lon"])
        for (ra, dec), got in zip(job["objects"], r["objects"]):
            assert sep(*got, *astro.altaz(*astro.precess(ra, dec, j), job["lat"], l)) < 1e-6
        assert sep(*r["sun"], *astro.altaz(*astro.sun_radec(j), job["lat"], l)) < 1e-6
        assert sep(*r["moon"], *astro.altaz(*astro.moon_radec(j), job["lat"], l)) < 1e-6


@pytest.mark.parametrize("planet", ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"])
def test_planets_against_astropy(js, planet):
    for job, r in js:
        ref = ref_body(planet.lower(), job["lat"], job["lon"], job["t"][:-1])
        assert sep(*r["planets"][planet], *ref) < 0.1, (planet, job["t"])
