// Sky renderer: 2D canvas, every point transformed rigorously (astro.js) and projected (projection.js).
// Nothing is approximated on screen: object outlines are computed on the sphere from size and position angle,
// constellation lines follow great circles between the Hipparcos stars they connect, boundaries follow the
// IAU parallels and meridians of B1875 precessed to J2000.
import * as A from './astro.js';
import { Projection } from './projection.js';

const { D2R, R2D } = A;

export const TYPE_STYLE = {   // colour and group for the deep-sky object types of OpenNGC
  G: ['#ff9f7a', 'gal'], GPair: ['#ff9f7a', 'gal'], GTrpl: ['#ff9f7a', 'gal'], GGroup: ['#ff9f7a', 'gal'],
  OCl: ['#ffd36b', 'ocl'], '*Ass': ['#ffd36b', 'ocl'], GCl: ['#ffd36b', 'gcl'], 'Cl+N': ['#7fe0a8', 'neb'],
  PN: ['#7fd6ff', 'pn'], HII: ['#7fe0a8', 'neb'], EmN: ['#7fe0a8', 'neb'], RfN: ['#9fb8ff', 'neb'],
  Neb: ['#7fe0a8', 'neb'], DrkN: ['#9a9a9a', 'neb'], SNR: ['#e98cff', 'neb'], Nova: ['#e98cff', 'star'],
  '*': ['#bdbdbd', 'star'], '**': ['#bdbdbd', 'star'], Other: ['#bdbdbd', 'star'],
};

// B−V → RGB (Ballesteros 2012 temperature, then a blackbody-ish approximation)
function bvColor(bv) {
  if (bv == null) bv = 0.6;
  bv = Math.max(-0.4, Math.min(2.0, bv));
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)), t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = (x) => Math.round(Math.max(0, Math.min(255, x)) * 0.35 + 255 * 0.65);   // keep it pastel
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

const slerpN = (a, b, n, out) => {   // n+1 points along the great circle a→b
  const d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  out.length = 0;
  if (d < 1e-9) { out.push(a, b); return out; }
  const s = Math.sin(d);
  for (let i = 0; i <= n; i++) {
    const t = i / n, ka = Math.sin((1 - t) * d) / s, kb = Math.sin(t * d) / s;
    out.push([ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]]);
  }
  return out;
};

/** Outline of an ellipse on the sphere: centre (J2000 deg), semi-axes (deg), PA (deg, north through east). */
export function ellipseOutline(ra, dec, majDeg, minDeg, paDeg, n = 64) {
  const c = A.vec(ra, dec), a = ra * D2R, d = dec * D2R;
  const e = [-Math.sin(a), Math.cos(a), 0];                                        // east
  const no = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)]; // north
  const p = (paDeg || 0) * D2R, cp = Math.cos(p), sp = Math.sin(p);
  const ux = [0, 1, 2].map((i) => no[i] * cp + e[i] * sp);     // major axis direction (PA from north to east)
  const vx = [0, 1, 2].map((i) => -no[i] * sp + e[i] * cp);    // minor axis direction
  const A2 = majDeg / 2 * D2R, B2 = minDeg / 2 * D2R, pts = [];
  for (let k = 0; k < n; k++) {
    const t = 2 * Math.PI * k / n;
    // offset in the tangent plane, then onto the sphere along the great circle (exact angular distance)
    const ox = A2 * Math.cos(t), oy = B2 * Math.sin(t), r = Math.hypot(ox, oy);
    const dir = [0, 1, 2].map((i) => (ox * ux[i] + oy * vx[i]) / r);
    pts.push([0, 1, 2].map((i) => Math.cos(r) * c[i] + Math.sin(r) * dir[i]));
  }
  return pts;
}

export class Sky {
  constructor(canvas, data) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.proj = new Projection();
    this.data = data;
    this.opt = {
      stars: true, starNames: true, constLines: true, constNames: true, constBounds: false,
      dso: true, dsoLabels: true, planets: true, gridEq: false, gridAltAz: false, ground: true,
      cardinals: true, refraction: true, magBoost: 0, dsoMagLimit: 14, inverted: false,
    };
    this.time = new Date(); this.lat = 48.15; this.lon = 17.11;
    this.selected = null; this.hits = [];
    this.prepare();
  }

  // ---------------------------------------------------------------- data preparation (once)
  prepare() {
    const S = this.data.stars.stars, n = S.length;
    this.starJ = new Float64Array(n * 3);   // J2000 unit vectors
    this.starApp = new Float64Array(n * 3); // + proper motion + aberration for `appEpoch`
    this.starMag = new Float32Array(n); this.starCol = new Array(n); this.hipIndex = new Map();
    for (let i = 0; i < n; i++) {
      const [hip, ra, dec, , , mag, bv] = S[i], v = A.vec(ra, dec);
      this.starJ.set(v, i * 3); this.starMag[i] = mag; this.starCol[i] = bvColor(bv); this.hipIndex.set(hip, i);
    }
    this.starNames = this.data.stars.names;
    // constellation lines as pairs of star indices
    this.constSegs = []; this.constCentres = [];
    for (const c of this.data.cons.constellations) {
      const sum = [0, 0, 0], seen = new Set();
      for (const poly of c.lines) {
        for (let k = 0; k + 1 < poly.length; k++) this.constSegs.push([this.hipIndex.get(poly[k]), this.hipIndex.get(poly[k + 1])]);
        for (const h of poly) if (!seen.has(h)) { seen.add(h); const i = this.hipIndex.get(h); for (let j = 0; j < 3; j++) sum[j] += this.starJ[i * 3 + j]; }
      }
      if (seen.size) this.constCentres.push({ id: c.id, name: c.name, v: A.norm(sum) });
    }
    // IAU boundaries: B1875 parallels / meridians, densified and precessed to J2000
    const jdB1875 = 2405889.258550475, Pb = A.transpose(A.precessionMatrix((jdB1875 - 2451545) / 36525));
    this.bounds = [];
    for (const [ra1, dec1, ra2, dec2] of this.data.cons.boundaries.edges) {
      const pts = [];
      if (Math.abs(dec1 - dec2) < 1e-6) {   // parallel of declination: small circle, sample in RA
        let d = ra2 - ra1; if (d > 180) d -= 360; if (d < -180) d += 360;
        const n2 = Math.max(2, Math.ceil(Math.abs(d) / 1));
        for (let k = 0; k <= n2; k++) pts.push(A.apply(Pb, A.vec(ra1 + d * k / n2, dec1)));
      } else {                               // meridian: great circle
        const n2 = Math.max(2, Math.ceil(Math.abs(dec2 - dec1) / 1));
        for (let k = 0; k <= n2; k++) pts.push(A.apply(Pb, A.vec(ra1, dec1 + (dec2 - dec1) * k / n2)));
      }
      this.bounds.push(pts);
    }
    // deep-sky objects
    const types = this.data.dso.types;
    this.dso = this.data.dso.objects.map(([id, ids, type, ra, dec, maj, min, pa, mag, band, sb, con, names, hubble]) => ({
      kind: 'dso', id, ids, type, typeName: types[type] || type, ra, dec, maj, min, pa, mag, band, sb, con, names, hubble,
      vJ: A.vec(ra, dec),
      // dashed when the shape is known to be elongated but its orientation is not catalogued
      outlineExact: !(pa == null && min != null && maj != null && Math.abs(min - maj) > 1e-9),
      label: names.length && (id.startsWith('M ') || mag != null && mag < 9) ? `${id} ${names[0]}` : id,
    }));
    this.appEpoch = null;
  }

  /** Recompute proper motion + aberration when the date moved by more than ~2 hours (aberration changes < 0.1″). */
  refreshApparent(F) {
    if (this.appEpoch != null && Math.abs(F.jde - this.appEpoch) < 0.08) return;
    this.appEpoch = F.jde;
    // in place, without temporary arrays (118 k stars): proper motion along east/north, then aberration
    const S = this.data.stars.stars, b = F.vEarth, k = (F.jde - 2451545) / 365.25 * D2R / 3.6e6, J = this.starJ, O = this.starApp;
    for (let i = 0, j = 0; i < S.length; i++, j += 3) {
      let x = J[j], y = J[j + 1], z = J[j + 2];
      const pa = S[i][3], pd = S[i][4];
      if (pa || pd) {
        const r = Math.hypot(x, y) || 1e-12, ca = x / r, sa = y / r;   // east = (−sin α, cos α, 0), north = (−sin δ cos α, −sin δ sin α, cos δ)
        x += k * (pa * -sa + pd * -z * ca); y += k * (pa * ca + pd * -z * sa); z += k * pd * r;
      }
      x += b[0]; y += b[1]; z += b[2];
      const n = 1 / Math.hypot(x, y, z);
      O[j] = x * n; O[j + 1] = y * n; O[j + 2] = z * n;
    }
    for (const o of this.dso) o.vApp = A.aberrate(o.vJ, b);
  }

  // ---------------------------------------------------------------- frame & transforms
  computeFrame() {
    const F = A.frame(this.time, this.lat, this.lon);
    this.F = F; this.refreshApparent(F);
    this.bodies = A.bodies(F);
    const alt = this.proj.mode === 'altaz';
    this.M = alt ? F.HNP : F.NP;        // J2000 (apparent) → mode frame
    this.Md = alt ? F.H : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];   // of date → mode frame
    this.refr = alt && this.opt.refraction;
  }
  /** J2000 apparent vector → mode-frame display vector (with refraction in alt/az). */
  toView(v, out) {
    const M = this.M;
    let x = M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2];
    let y = M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2];
    let z = M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2];
    out = out || [0, 0, 0]; out[0] = x; out[1] = y; out[2] = z;
    return this.refr ? A.refract(out) : out;
  }
  /** Catalogue coordinates (J2000 grid, boundaries) are shifted by aberration like the objects drawn on them. */
  toViewJ(v) { return this.toView(A.aberrate(v, this.F.vEarth)); }
  dateToView(u) { const h = A.apply(this.Md, u); return this.refr ? A.refract(h) : h; }
  /** Mode-frame display vector → J2000 [ra, dec] (inverse of toView, aberration not removed: < 20″). */
  viewToJ2000(v) {
    const u = this.refr ? A.unrefract(v) : v;
    const w = A.apply(A.transpose(this.M), u), b = this.F.vEarth;   // remove aberration
    return A.radec([w[0] - b[0], w[1] - b[1], w[2] - b[2]]);
  }
  viewToAltAz(v) {
    if (this.proj.mode === 'altaz') return A.altaz(v);
    return A.altaz(A.refract(A.apply(this.F.H, v)));
  }

  /** Magnitude limit for the stars at the current field of view. */
  starLimit() {
    const f = this.proj.fov;
    return Math.min(13, 5.8 + 2.4 * Math.log10(Math.max(1, 120 / f)) + this.opt.magBoost);
  }

  // ---------------------------------------------------------------- drawing
  resize() {
    const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.proj.setSize(r.width, r.height);
  }

  draw() {
    const ctx = this.ctx, P = this.proj, W = P.w, H = P.h;
    this.computeFrame();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const inv = this.opt.inverted;
    this.col = inv
      ? { bg: '#ffffff', grid: 'rgba(0,60,140,0.25)', gridAz: 'rgba(0,110,60,0.25)', cons: 'rgba(0,70,160,0.55)', bound: 'rgba(120,80,0,0.45)', text: '#222', star: '#000', ground: '#e4dccf', horizon: '#704020' }
      : { bg: '#04060c', grid: 'rgba(90,140,255,0.22)', gridAz: 'rgba(110,220,150,0.22)', cons: 'rgba(110,160,255,0.45)', bound: 'rgba(200,170,90,0.35)', text: '#cfd8e8', star: null, ground: '#121610', horizon: '#6f8a5a' };
    ctx.fillStyle = this.col.bg; ctx.fillRect(0, 0, W, H);
    this.hits = []; this.labels = [];
    this.occupied = [];

    if (this.opt.gridEq) this.drawEqGrid();
    if (this.opt.gridAltAz && P.mode === 'altaz') this.drawAltAzGrid();
    if (this.opt.constBounds) this.drawBounds();
    if (this.opt.constLines) this.drawConstLines();
    if (this.opt.dso) this.drawDSO();
    if (this.opt.stars) this.drawStars();
    if (this.opt.planets) this.drawBodies();
    if (P.mode === 'altaz' && this.opt.ground) this.drawGround();
    if (this.opt.constNames) this.drawConstNames();
    this.drawSelection();
    this.drawLabels();
    if (P.mode === 'altaz' && this.opt.cardinals) this.drawCardinals();
  }

  // polyline of mode-frame vectors, broken where a point is not projectable or the jump is huge
  strokeVecs(vs, closed = false) {
    const ctx = this.ctx, P = this.proj, p = [0, 0], lim = Math.max(P.w, P.h) * 4;
    let pen = false, px = 0, py = 0, fx = null, fy = null;
    const seq = closed ? [...vs, vs[0]] : vs;
    for (const v of seq) {
      const q = P.project(v, p);
      if (!q || Math.abs(q[0]) > lim * 4 || Math.abs(q[1]) > lim * 4) { pen = false; continue; }
      if (pen && Math.hypot(q[0] - px, q[1] - py) > lim) pen = false;
      if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); if (fx == null) { fx = q[0]; fy = q[1]; } }
      pen = true; px = q[0]; py = q[1];
    }
  }

  drawEqGrid() {
    const ctx = this.ctx, P = this.proj, f = P.fov;
    const stepDec = f > 60 ? 15 : f > 20 ? 10 : f > 8 ? 5 : f > 3 ? 2 : f > 1 ? 1 : 0.25;
    const stepRA = stepDec * (f > 60 ? 1 : 1.5);   // degrees
    ctx.strokeStyle = this.col.grid; ctx.lineWidth = 1; ctx.beginPath();
    const ds = Math.min(stepDec, 2) / 2;
    for (let dec = -90 + stepDec; dec < 90 - 1e-9; dec += stepDec) {
      const vs = []; for (let ra = 0; ra <= 360 + 1e-9; ra += ds) vs.push(this.toViewJ(A.vec(ra, dec)));
      this.strokeVecs(vs);
    }
    for (let ra = 0; ra < 360 - 1e-9; ra += stepRA) {
      const vs = []; for (let dec = -90; dec <= 90 + 1e-9; dec += ds) vs.push(this.toViewJ(A.vec(ra, dec)));
      this.strokeVecs(vs);
    }
    ctx.stroke();
  }
  drawAltAzGrid() {
    const ctx = this.ctx, f = this.proj.fov, step = f > 60 ? 10 : f > 20 ? 5 : f > 5 ? 2 : f > 1 ? 1 : 0.25;
    ctx.strokeStyle = this.col.gridAz; ctx.lineWidth = 1; ctx.beginPath();
    const ds = Math.min(step, 2) / 2;
    for (let alt = -90 + step; alt < 90 - 1e-9; alt += step) {
      const vs = []; for (let az = 0; az <= 360 + 1e-9; az += ds) vs.push(A.fromAltAz(alt, az)); this.strokeVecs(vs);
    }
    for (let az = 0; az < 360 - 1e-9; az += step * (f > 60 ? 1.5 : 1)) {
      const vs = []; for (let alt = -90; alt <= 90 + 1e-9; alt += ds) vs.push(A.fromAltAz(alt, az)); this.strokeVecs(vs);
    }
    ctx.stroke();
  }
  drawBounds() {
    const ctx = this.ctx; ctx.strokeStyle = this.col.bound; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
    for (const pts of this.bounds) {
      const vs = pts.map((v) => this.toViewJ(v));
      if (!vs.some((v) => this.proj.visible(v, 0.1))) continue;
      this.strokeVecs(vs);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  starView(i, out) {
    const a = this.starApp; return this.toView([a[i * 3], a[i * 3 + 1], a[i * 3 + 2]], out);
  }
  drawConstLines() {
    const ctx = this.ctx, P = this.proj, seg = [];
    ctx.strokeStyle = this.col.cons; ctx.lineWidth = 1.1; ctx.beginPath();
    for (const [i, j] of this.constSegs) {
      const a = this.starView(i), b = this.starView(j);
      if (!P.visible(a, 0.6) && !P.visible(b, 0.6)) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * R2D;
      const n = Math.max(1, Math.min(64, Math.ceil(ang / Math.max(0.2, P.fov / 60))));
      // great circle between the two stars (in the display frame; refraction bends it slightly — that is real)
      this.strokeVecs(slerpN(a, b, n, seg));
    }
    ctx.stroke();
  }
  drawConstNames() {
    const P = this.proj, p = [0, 0];
    if (P.fov < 3) return;
    for (const c of this.constCentres) {
      const v = this.toView(c.v);
      if (!P.visible(v) || !P.project(v, p)) continue;
      this.labels.push({ v, x: p[0], y: p[1], text: c.name, color: this.opt.inverted ? 'rgba(0,60,150,0.7)' : 'rgba(140,175,255,0.65)', font: '600 12px system-ui', prio: 1, centre: true });
    }
  }

  drawStars() {
    const ctx = this.ctx, P = this.proj, lim = this.starLimit(), n = this.starMag.length, p = [0, 0], v = [0, 0, 0];
    const showNames = this.opt.starNames, nameLim = Math.min(lim - 1, 1.6 + 2.6 * Math.log10(Math.max(1, 120 / P.fov)));
    const hideBelow = P.mode === 'altaz' && this.opt.ground;
    for (let i = 0; i < n; i++) {
      const m = this.starMag[i];
      if (m > lim) break;   // sorted by magnitude
      const a = this.starApp, u = [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
      // fast cull before refraction
      const M = this.M, d0 = (M[0][0] * u[0] + M[0][1] * u[1] + M[0][2] * u[2]) * P.c[0]
        + (M[1][0] * u[0] + M[1][1] * u[1] + M[1][2] * u[2]) * P.c[1] + (M[2][0] * u[0] + M[2][1] * u[1] + M[2][2] * u[2]) * P.c[2];
      if (d0 < P.cosMax - 0.01) continue;
      const q = P.project(this.toView(u, v), p);
      if (!q || q[0] < -10 || q[1] < -10 || q[0] > P.w + 10 || q[1] > P.h + 10) continue;
      const k = lim - m, r = Math.min(7, 0.7 + 0.42 * k + 0.035 * k * k);
      const below = hideBelow && v[2] < 0;
      ctx.fillStyle = this.col.star || this.starCol[i];
      ctx.globalAlpha = Math.min(1, 0.55 + 0.2 * k);
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1;
      if (below) continue;
      const hip = this.data.stars.stars[i][0];
      this.hits.push({ x: q[0], y: q[1], r: Math.max(r, 4), obj: { kind: 'star', index: i }, prio: 10 - m });
      if (showNames) {
        const nm = this.starNames[hip];
        if (nm && m < nameLim) this.labels.push({ v: [v[0], v[1], v[2]], x: q[0] + r + 3, y: q[1], text: nm, color: this.opt.inverted ? '#333' : '#c8d2e4', font: '11px system-ui', prio: 6 - m * 0.5 });
      }
    }
  }

  /** Outline points (J2000 unit vectors), cached for the most recently drawn objects only (bounded memory). */
  dsoOutline(o) {
    const C = this.outlines || (this.outlines = new Map());
    let pts = C.get(o);
    if (pts) { C.delete(o); C.set(o, pts); return pts; }   // LRU: move to the end
    const known = o.pa != null && o.min != null;
    pts = ellipseOutline(o.ra, o.dec, o.maj / 60, (known ? o.min : o.maj) / 60, known ? o.pa : 0, 72);
    C.set(o, pts);
    if (C.size > 1500) C.delete(C.keys().next().value);
    return pts;
  }

  drawDSO() {
    const ctx = this.ctx, P = this.proj, p = [0, 0], v = [0, 0, 0], ppd = P.pxPerDeg;
    const lim = Math.min(this.opt.dsoMagLimit, 6.5 + 2.5 * Math.log10(Math.max(1, 120 / P.fov)) + this.opt.magBoost);
    const b = this.F.vEarth;
    for (const o of this.dso) {
      const vv = this.toView(o.vApp, v);
      const sizePx = (o.maj || 0) / 60 * ppd;
      if (!P.visible(vv, (o.maj || 0) / 60 * D2R)) continue;
      const big = sizePx >= 6, bright = o.mag != null && o.mag <= lim, sel = this.selected === o;
      if (!sel && !o.id.startsWith('M ') && !(bright || (big && (o.mag == null || o.mag <= lim + 2)))) continue;
      let [color] = TYPE_STYLE[o.type] || ['#cccccc'];
      if (this.opt.inverted) color = darken(color);   // readable on the white chart
      const below = P.mode === 'altaz' && this.opt.ground && vv[2] < -(o.maj || 0) / 120 * D2R;
      const c = P.project(vv, p); if (!c) continue;
      const cx = c[0], cy = c[1];
      if (cx < -sizePx - 50 || cy < -sizePx - 50 || cx > P.w + sizePx + 50 || cy > P.h + sizePx + 50) continue;
      ctx.strokeStyle = color; ctx.lineWidth = sel ? 2 : 1.2;
      if (sizePx >= 5) {
        // true outline on the sphere — exact size, position angle and projection distortion
        const out = this.dsoOutline(o).map((u) => this.toView(A.aberrate(u, b)));
        ctx.beginPath(); if (!o.outlineExact) ctx.setLineDash([5, 4]);
        this.strokeVecs(out, true); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        this.hits.push({ x: cx, y: cy, r: Math.max(6, sizePx / 2), obj: o, prio: 4 - sizePx / 1000, area: true });
      } else {
        this.symbol(o, cx, cy, color);
        this.hits.push({ x: cx, y: cy, r: 7, obj: o, prio: 5 });
      }
      if (below) { this.hits.pop(); continue; }
      if (this.opt.dsoLabels) {
        const off = Math.max(6, sizePx / 2 * 0.72);
        this.labels.push({ v: vv.slice(), x: cx + off + 2, y: cy, text: o.label, color, font: '11px system-ui',
          prio: (o.id.startsWith('M ') ? 4 : 2) - (o.mag ?? 14) * 0.1 + Math.min(2, sizePx / 200) });
      }
    }
  }
  symbol(o, x, y, color) {   // objects without a catalogued size: fixed-size symbol by type
    const ctx = this.ctx, g = (TYPE_STYLE[o.type] || [])[1];
    ctx.beginPath();
    if (g === 'gal') ctx.ellipse(x, y, 5, 2.6, 0, 0, 2 * Math.PI);   // symbol only — no size/PA in the catalogue
    else if (g === 'gcl') { ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); }
    else if (g === 'ocl') { ctx.setLineDash([2, 2]); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); }
    else if (g === 'pn') { ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.moveTo(x + 3, y); ctx.lineTo(x + 6, y); ctx.moveTo(x - 3, y); ctx.lineTo(x - 6, y); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 6); ctx.moveTo(x, y - 3); ctx.lineTo(x, y - 6); }
    else if (g === 'neb') ctx.rect(x - 4, y - 4, 8, 8);
    else { ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  drawBodies() {
    const ctx = this.ctx, P = this.proj, p = [0, 0], ppd = P.pxPerDeg;
    const sun = this.bodies.find((b) => b.name === 'Sun');
    for (const b of [...this.bodies].sort((x, y) => y.dist - x.dist)) {
      const v = this.dateToView(b.u);
      if (!P.visible(v, b.diam / 7200 * D2R)) continue;
      const q = P.project(v, p); if (!q) continue;
      const below = P.mode === 'altaz' && this.opt.ground && v[2] < -b.diam / 7200 * D2R;
      const x = q[0], y = q[1], rTrue = b.diam / 7200 * ppd;
      const info = A.PLANET_INFO[b.name], color = b.name === 'Sun' ? '#fff1b0' : b.name === 'Moon' ? '#e9eef5' : info.color;
      const r = Math.max(rTrue, b.name === 'Sun' || b.name === 'Moon' ? 3 : Math.max(1.8, 4.5 - b.mag * 0.5));
      if (b.name === 'Moon') this.drawMoon(x, y, r, b, sun);
      else {
        ctx.fillStyle = this.opt.inverted ? '#333' : color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
      }
      if (below) continue;
      this.hits.push({ x, y, r: Math.max(r, 6), obj: { kind: 'body', name: b.name }, prio: 20 });
      this.labels.push({ v, x: x + r + 4, y, text: b.name, color: this.opt.inverted ? '#222' : '#ffe9a8', font: '600 12px system-ui', prio: 50 });
    }
  }
  drawMoon(x, y, r, m, sun) {
    const ctx = this.ctx, P = this.proj;
    // direction to the Sun on screen: project a point a little way from the Moon towards the Sun
    const mv = this.dateToView(m.u), sv = this.dateToView(sun.u);
    const t = 0.01, towards = A.norm([mv[0] + t * (sv[0] - mv[0]), mv[1] + t * (sv[1] - mv[1]), mv[2] + t * (sv[2] - mv[2])]);
    const q = P.project(towards); let ang = 0;
    if (q) ang = Math.atan2(q[1] - y, q[0] - x);
    const k = m.illum;   // illuminated fraction
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = this.opt.inverted ? '#bbb' : '#2a2e36'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = this.opt.inverted ? '#555' : '#eef2f7';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);           // lit limb on the Sun's side (+x)
    ctx.ellipse(0, 0, Math.abs(1 - 2 * k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k <= 0.5);   // terminator
    ctx.fill(); ctx.restore();
  }

  drawGround() {
    const ctx = this.ctx, P = this.proj, W = P.w, H = P.h;
    // the horizon (apparent altitude 0) is a circle on the sphere → a circle (or a line) on screen
    const pts = [];
    for (let az = 0; az < 360; az += 0.5) { const q = P.project(A.fromAltAz(0, az)); if (q && Math.abs(q[0]) < 1e5 && Math.abs(q[1]) < 1e5) pts.push(q); }
    if (pts.length < 3) return;
    const zen = P.project([0, 0, 1]);
    const [c, R] = circleFrom(pts);
    ctx.fillStyle = this.col.ground; ctx.strokeStyle = this.col.horizon; ctx.lineWidth = 1.5;
    if (!c || R > 1e5) {   // effectively a straight line: fill the half-plane away from the zenith
      const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L;
      const ref = zen || [W / 2, -1e6];
      if ((ref[0] - a[0]) * nx + (ref[1] - a[1]) * ny > 0) { nx = -nx; ny = -ny; }
      const big = 1e5, ux = dx / L, uy = dy / L;
      ctx.beginPath();
      ctx.moveTo(a[0] - ux * big, a[1] - uy * big); ctx.lineTo(a[0] + ux * big, a[1] + uy * big);
      ctx.lineTo(a[0] + ux * big + nx * big, a[1] + uy * big + ny * big); ctx.lineTo(a[0] - ux * big + nx * big, a[1] - uy * big + ny * big);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(a[0] - ux * big, a[1] - uy * big); ctx.lineTo(a[0] + ux * big, a[1] + uy * big); ctx.stroke();
      return;
    }
    const zenInside = zen ? Math.hypot(zen[0] - c[0], zen[1] - c[1]) < R : false;
    ctx.beginPath();
    if (zenInside) { ctx.rect(-10, -10, W + 20, H + 20); ctx.moveTo(c[0] + R, c[1]); ctx.arc(c[0], c[1], R, 0, 2 * Math.PI, true); }
    else ctx.arc(c[0], c[1], R, 0, 2 * Math.PI);
    ctx.fill('evenodd');
    ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, 2 * Math.PI); ctx.stroke();
  }
  drawCardinals() {
    const P = this.proj, names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = 0; i < 8; i++) {
      const q = P.project(A.fromAltAz(0, i * 45));
      if (!q || q[0] < 0 || q[0] > P.w || q[1] < 0 || q[1] > P.h) continue;
      this.labels.push({ x: q[0], y: q[1] + 14, text: names[i], color: '#e8c060', font: `700 ${i % 2 ? 12 : 15}px system-ui`, prio: 100, centre: true });
    }
  }
  drawSelection() {
    const s = this.selected; if (!s) return;
    const v = this.viewVectorOf(s); if (!v || !this.proj.visible(v)) return;
    if (this.proj.mode === 'altaz' && this.opt.ground && v[2] < 0) return;
    const q = this.proj.project(v); if (!q) return;
    const ctx = this.ctx, r = 14;
    ctx.strokeStyle = '#ff5c5c'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(q[0] + dx * r, q[1] + dy * r); ctx.lineTo(q[0] + dx * r * 1.7, q[1] + dy * r * 1.7); }
    ctx.stroke();
  }

  /** Mode-frame vector of a selectable object. */
  viewVectorOf(o) {
    if (o.kind === 'dso') return this.toView(o.vApp);
    if (o.kind === 'star') return this.starView(o.index);
    if (o.kind === 'body') { const b = this.bodies.find((x) => x.name === o.name); return b ? this.dateToView(b.u) : null; }
    if (o.kind === 'point') return this.toViewJ(A.vec(o.ra, o.dec));
    return null;
  }

  drawLabels() {
    const ctx = this.ctx, occ = [];
    this.labels.sort((a, b) => b.prio - a.prio);
    ctx.textBaseline = 'middle';
    let n = 0;
    const ground = this.proj.mode === 'altaz' && this.opt.ground;
    this.drawn = [];
    for (const L of this.labels) {
      if (ground && L.v && L.v[2] < 0) continue;   // hidden by the ground
      ctx.font = L.font;
      const w = ctx.measureText(L.text).width, h = 13;
      const x = L.centre ? L.x - w / 2 : L.x, y = L.y - h / 2;
      if (x > this.proj.w || y > this.proj.h || x + w < 0 || y + h < 0) continue;
      if (occ.some((o) => x < o[2] && x + w > o[0] && y < o[3] && y + h > o[1])) continue;
      occ.push([x - 2, y - 1, x + w + 2, y + h + 1]);
      ctx.fillStyle = L.color; ctx.fillText(L.text, x, L.y); this.drawn.push(L);
      if (++n > 400) break;
    }
  }

  /** Object under the cursor (screen px), closest first. */
  pick(x, y) {
    let best = null, bd = Infinity;
    const ground = this.proj.mode === 'altaz' && this.opt.ground;
    for (const h of this.hits) {
      if (ground && h.below) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d > h.r + 3) continue;
      const score = (h.area ? d / h.r * 12 + 6 : d) - h.prio * 0.01;
      if (score < bd) { bd = score; best = h.obj; }
    }
    return best;
  }
}


const darken = (hex) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.5).toString(16).padStart(2, '0')).join('');

/** Least-squares circle through points (Kåsa fit); returns [[cx, cy], R]. */
function circleFrom(pts) {
  let sx = 0, sy = 0, n = pts.length;
  for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x0, y0] of pts) {
    const u = x0 - mx, v = y0 - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9 * (suu * svv + 1)) return [null, Infinity];
  const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const R = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return [[uc + mx, vc + my], R];
}
