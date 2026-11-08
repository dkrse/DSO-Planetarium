"""Object outlines, projection and data integrity."""
import json
import math
from pathlib import Path

from .conftest import ROOT

DATA = ROOT / "static" / "data"



def test_ellipse_size_and_pa(js):
    # outline points of M 31 (OpenNGC: 177.83′ × 69.66′, PA 35°): distance from the centre and position angle
    r = js("""
      const S = await import(arg.sky);
      const pts = S.ellipseOutline(10.684792, 41.269056, 177.83 / 60, 69.66 / 60, 35, 8);
      const c = A.vec(10.684792, 41.269056);
      const sep = (v) => Math.acos(Math.min(1, v[0] * c[0] + v[1] * c[1] + v[2] * c[2])) * A.R2D;
      const pa = (v) => {   // position angle of v seen from the centre, north through east
        const [ra, dec] = A.radec(v), a1 = 10.684792 * A.D2R, d1 = 41.269056 * A.D2R, a2 = ra * A.D2R, d2 = dec * A.D2R;
        return (Math.atan2(Math.sin(a2 - a1), Math.cos(d1) * Math.tan(d2) - Math.sin(d1) * Math.cos(a2 - a1)) * A.R2D + 360) % 360;
      };
      return pts.map((v) => [sep(v), pa(v)]);
    """, {"sky": (ROOT / "static" / "js" / "sky.js").as_uri()})
    assert abs(r[0][0] - 177.83 / 120) < 1e-9 and abs(r[0][1] - 35) < 1e-6        # end of the major axis
    assert abs(r[4][0] - 177.83 / 120) < 1e-9 and abs(r[4][1] - 215) < 1e-6
    assert abs(r[2][0] - 69.66 / 120) < 1e-9 and abs(r[2][1] - 125) < 1e-6        # end of the minor axis (PA + 90°)


def test_projection_roundtrip_and_fov(js):
    r = js("""
      const { Projection } = await import(arg.proj);
      const out = [];
      for (const mode of ['altaz', 'eq']) for (const fov of [120, 10, 0.3]) {
        const P = new Projection(); P.mode = mode; P.lon = 123; P.lat = 37; P.fov = fov; P.setSize(1000, 700);
        let worst = 0;
        for (const [x, y] of [[0, 0], [1000, 700], [500, 350], [77, 600]]) {
          const q = P.project(P.unproject(x, y)); worst = Math.max(worst, Math.hypot(q[0] - x, q[1] - y));
        }
        // horizontal field: the left and right edges at the centre line are exactly fov apart
        const a = P.unproject(0, 350), b = P.unproject(1000, 350);
        const ang = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * A.R2D;
        // east to the left in eq mode, to the right in alt/az
        const e = P.project(A.vec(P.lon + 0.01 * fov, P.lat));
        out.push({ mode, fov, worst, ang, eastRight: e[0] > 500 });
      }
      return out;
    """, {"proj": (ROOT / "static" / "js" / "projection.js").as_uri()})
    for o in r:
        assert o["worst"] < 1e-6
        assert abs(o["ang"] - o["fov"]) < 1e-6 * o["fov"]
        assert o["eastRight"] == (o["mode"] == "altaz")


def test_data_single_sources():
    stars = json.loads((DATA / "stars.json").read_text())
    dso = json.loads((DATA / "dso.json").read_text())
    cons = json.loads((DATA / "constellations.json").read_text())
    hips = {s[0] for s in stars["stars"]}
    # every constellation line ends on a Hipparcos star of the same catalogue
    assert len(cons["constellations"]) >= 88
    for c in cons["constellations"]:
        for poly in c["lines"]:
            assert set(poly) <= hips, c["id"]
    # all 110 Messier objects (M 102 = M 101 in OpenNGC)
    ms = set()
    for o in dso["objects"]:
        ms |= {x for x in [o[0], *o[1]] if x.startswith("M ")}
    assert {f"M {i}" for i in range(1, 111)} <= ms
    by = {o[0]: o for o in dso["objects"]}
    m31 = by["M 31"]
    assert (m31[5], m31[6], m31[7]) == (177.83, 69.66, 35.0)
    assert abs(m31[3] - 10.684792) < 1e-6 and abs(m31[4] - 41.269056) < 1e-6
    # no object id appears twice
    ids = [o[0] for o in dso["objects"]]
    assert len(ids) == len(set(ids))
