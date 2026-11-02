"""FOV and mosaic geometry (mirror of the framing code in static/app.js).

Tangent-plane (gnomonic) projection around the mosaic centre: xi towards east, eta towards north.
PA = position angle of the frame's top edge, measured from north through east.
"""
import math

D2R = math.pi / 180


def fov_deg(size_mm: float, focal_mm: float) -> float:
    return 2 * math.atan(size_mm / (2 * focal_mm)) / D2R


def setup_fov(setup: dict) -> dict:
    f = setup["focal"] * (setup.get("reducer") or 1)
    return {"w": fov_deg(setup["sw"], f), "h": fov_deg(setup["sh"], f),
            "scale": 206.265 * setup["px"] / f, "focal": f,
            "f_ratio": f / setup["aperture"] if setup.get("aperture") else None}


def to_sky(ra0: float, dec0: float, xi: float, eta: float):
    d0 = dec0 * D2R
    dec = math.asin((math.sin(d0) + eta * math.cos(d0)) / math.sqrt(1 + xi * xi + eta * eta))
    ra = (ra0 + math.atan2(xi, math.cos(d0) - eta * math.sin(d0)) / D2R) % 360
    return ra, dec / D2R


def panels(setup: dict, ra: float, dec: float, pa: float, cols=1, rows=1, overlap=15.0) -> dict:
    fv = setup_fov(setup)
    w, h = 2 * math.tan(fv["w"] / 2 * D2R), 2 * math.tan(fv["h"] / 2 * D2R)
    su, sv = w * (1 - overlap / 100), h * (1 - overlap / 100)
    p = pa * D2R
    up, right = (math.sin(p), math.cos(p)), (-math.cos(p), math.sin(p))
    out = []
    for j in range(rows):
        for i in range(cols):
            u, v = (i - (cols - 1) / 2) * su, ((rows - 1) / 2 - j) * sv
            pra, pdec = to_sky(ra, dec, u * right[0] + v * up[0], u * right[1] + v * up[1])
            out.append({"panel": len(out) + 1, "col": i + 1, "row": j + 1,
                        "ra": round(pra, 6), "dec": round(pdec, 6), "pa": round(pa % 360, 2)})
    W, H = su * (cols - 1) + w, sv * (rows - 1) + h
    return {"fov": {k: (round(v, 5) if isinstance(v, float) else v) for k, v in fv.items()},
            "size_deg": [round(2 * math.atan(W / 2) / D2R, 4), round(2 * math.atan(H / 2) / D2R, 4)],
            "panels": out}
