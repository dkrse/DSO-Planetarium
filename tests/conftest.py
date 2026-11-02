import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# astropy must work offline: use the bundled IERS tables and don't try to download newer ones
from astropy.utils import iers  # noqa: E402

iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "warn"

# observers on different latitudes (north, south, high north)
SITES = [("Bratislava", 48.1486, 17.1077), ("Cape Town", -33.92, 18.42), ("Reykjavik", 64.13, -21.94)]
# dates spread over the planner's validity range
DATES = ["2020-01-15T21:00:00", "2024-06-21T23:30:00", "2026-11-02T20:00:00", "2031-03-10T02:00:00", "2035-09-05T19:00:00"]


@pytest.fixture(params=SITES, ids=[s[0] for s in SITES])
def site(request):
    return request.param


@pytest.fixture(params=DATES)
def when(request):
    return request.param
