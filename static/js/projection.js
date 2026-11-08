// Stereographic projection of the celestial sphere seen from inside.
//
// The view is described in the frame of the current mode:
//   'altaz' — horizontal frame (North, East, Up); lon = azimuth, lat = altitude
//   'eq'    — true equator & equinox of date;      lon = right ascension, lat = declination
// Stereographic projection is conformal: object shapes are preserved locally, and circles on the sky stay circles.
// Scale at the centre: `scale` pixels per radian (2·tan(θ/2) ≈ θ), the horizontal field of view across the canvas
// width is exactly `fov` degrees.
import { D2R, R2D, mod } from './astro.js';

export class Projection {
  constructor() {
    this.mode = 'altaz'; this.lon = 180; this.lat = 30; this.fov = 90;
    this.w = 1; this.h = 1;
    this.update();
  }
  setSize(w, h) { this.w = w; this.h = h; this.update(); }
  update() {
    this.fov = Math.max(0.05, Math.min(200, this.fov));
    this.lat = Math.max(-90, Math.min(90, this.lat));
    this.lon = mod(this.lon, 360);
    const a = this.lat * D2R, z = this.lon * D2R, ca = Math.cos(a), sa = Math.sin(a), cz = Math.cos(z), sz = Math.sin(z);
    this.c = [ca * cz, ca * sz, sa];                 // view centre
    this.up = [-sa * cz, -sa * sz, ca];              // towards the zenith / celestial north pole
    // East is to the right in the horizontal frame (looking up from inside, the frame is left-handed),
    // to the left in the equatorial frame — like the real sky and printed charts.
    const s = this.mode === 'altaz' ? 1 : -1;
    this.right = [-s * sz, s * cz, 0];
    this.scale = (this.w / 2) / (2 * Math.tan(this.fov * D2R / 4));
    // cosine of the largest angle from the centre that is still on screen (+ margin)
    const diag = Math.hypot(this.w, this.h) / 2 / this.scale;           // in projected units
    this.maxAngle = 2 * Math.atan(diag / 2) + 0.05;
    this.cosMax = Math.cos(Math.min(Math.PI, this.maxAngle));
  }
  /** Unit vector in the mode frame → [x, y] pixels, or null when (almost) behind the viewer. */
  project(v, out) {
    const d = v[0] * this.c[0] + v[1] * this.c[1] + v[2] * this.c[2];
    if (d < -0.98) return null;
    const k = 2 / (1 + d) * this.scale;
    const x = (v[0] * this.right[0] + v[1] * this.right[1] + v[2] * this.right[2]) * k;
    const y = (v[0] * this.up[0] + v[1] * this.up[1] + v[2] * this.up[2]) * k;
    out = out || [0, 0];
    out[0] = this.w / 2 + x; out[1] = this.h / 2 - y;
    return out;
  }
  /** Cheap test: is the direction within the visible cap? */
  visible(v, marginRad = 0) {
    const d = v[0] * this.c[0] + v[1] * this.c[1] + v[2] * this.c[2];
    return marginRad ? d >= Math.cos(Math.min(Math.PI, this.maxAngle + marginRad)) : d >= this.cosMax;
  }
  /** Pixels → unit vector in the mode frame (exact inverse of `project`). */
  unproject(px, py) {
    const X = (px - this.w / 2) / this.scale, Y = (this.h / 2 - py) / this.scale, r2 = X * X + Y * Y;
    const d = (4 - r2) / (4 + r2), k = (1 + d) / 2, x = k * X, y = k * Y;
    return [0, 1, 2].map((i) => d * this.c[i] + x * this.right[i] + y * this.up[i]);
  }
  /** Pixels per degree at the centre of the view. */
  get pxPerDeg() { return this.scale * D2R; }
  lonLatOf(v) { return [mod(Math.atan2(v[1], v[0]) * R2D, 360), Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D]; }
  /** Point the centre of the view at direction v (mode frame). */
  lookAt(v) { [this.lon, this.lat] = this.lonLatOf(v); this.update(); }
  /** Zoom keeping the sky point under (px, py) fixed. */
  zoomAt(factor, px, py) {
    const before = this.unproject(px, py);
    this.fov *= factor; this.update();
    for (let i = 0; i < 3; i++) {   // shift the centre until `before` is under the cursor again
      const now = this.unproject(px, py);
      const [l0, b0] = this.lonLatOf(before), [l1, b1] = this.lonLatOf(now);
      let dl = l0 - l1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      this.lon += dl; this.lat += b0 - b1; this.update();
    }
  }
}
