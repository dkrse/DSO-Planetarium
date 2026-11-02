import * as THREE from 'three';
import { D2R, fmtDec, fmtRA } from '../astro.js';
import { $, R, S, active, fovOf, store } from './core.js';
import { aimAt, camera, eqGroup, eqVec, label, overlay, scene, sky, startDrag } from './scene.js';
import { fmtAng } from './targets.js';

// ---------------------------------------------------------------- framing: FOV frame, mosaic, drag + rotate
// The frame is drawn on the celestial sphere (in eqGroup), anchored to RA/Dec, so it turns with the sky
// exactly like a camera on an equatorial mount. Geometry uses the gnomonic (tangent-plane) projection.

                       // {ra, dec} anchored on the sky, or null = follows the view centre
export const frameGroup = new THREE.Group(); 
export let frameSig = '', frameGeom = null;
export const buildFovBoxes = () => { frameSig = ''; };
export const _inv = new THREE.Matrix4();
export const m360 = (x) => ((x % 360) + 360) % 360;

export const eqToWorld = (v) => v.clone().applyMatrix4(eqGroup.matrixWorld);
export function worldToRaDec(v) {
  const e = v.clone().applyMatrix4(_inv.copy(eqGroup.matrixWorld).invert()).normalize();
  return [m360(Math.atan2(e.y, e.x) / D2R), Math.asin(Math.max(-1, Math.min(1, e.z))) / D2R];
}
export function viewCenter() { const d = new THREE.Vector3(); camera.getWorldDirection(d); return worldToRaDec(d); }
export function pointerRaDec(e) {
  const r = overlay.getBoundingClientRect();
  const v = new THREE.Vector3((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1, 0.5).unproject(camera).normalize();
  return worldToRaDec(v);
}
// tangent plane around (ra0, dec0): xi towards east, eta towards north (radians)
export function toPlane(ra0, dec0, ra, dec) {
  const d0 = dec0 * D2R, d = dec * D2R, dA = (ra - ra0) * D2R;
  const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dA);
  if (c <= 1e-6) return [Infinity, Infinity];          // point on the far hemisphere
  return [Math.cos(d) * Math.sin(dA) / c, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dA)) / c];
}
export function toSky(ra0, dec0, xi, eta) {
  const d0 = dec0 * D2R;
  const dec = Math.asin((Math.sin(d0) + eta * Math.cos(d0)) / Math.sqrt(1 + xi * xi + eta * eta));
  return [m360(ra0 + Math.atan2(xi, Math.cos(d0) - eta * Math.sin(d0)) / D2R), dec / D2R];
}
// position angle of the zenith direction at (ra, dec), north through east
export function zenithPA(ra, dec) {
  const p = eqToWorld(eqVec(ra, dec, 1)).normalize();
  const n = eqToWorld(new THREE.Vector3(0, 0, 1)); n.addScaledVector(p, -n.dot(p));
  const e = eqToWorld(new THREE.Vector3(-Math.sin(ra * D2R), Math.cos(ra * D2R), 0));
  const z = new THREE.Vector3(0, 1, 0).addScaledVector(p, -p.y);
  return Math.atan2(z.dot(e), z.dot(n)) / D2R;
}
// effective position angle of the frame's top edge
export const frameRot = (st, ra, dec) => (st.mount ?? 'eq') === 'eq' ? (st.rot || 0) : zenithPA(ra, dec) - (st.rot || 0);

export function layout(st, ra, dec, mosaic) {
  const f = fovOf(st), w = 2 * Math.tan(f.w / 2 * D2R), h = 2 * Math.tan(f.h / 2 * D2R);
  const { cols, rows, overlap } = mosaic, su = w * (1 - overlap / 100), sv = h * (1 - overlap / 100);
  const pa = frameRot(st, ra, dec) * D2R, up = [Math.sin(pa), Math.cos(pa)], right = [-Math.cos(pa), Math.sin(pa)];
  const sky = (u, v) => toSky(ra, dec, u * right[0] + v * up[0], u * right[1] + v * up[1]);
  const panels = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = (i - (cols - 1) / 2) * su, v = ((rows - 1) / 2 - j) * sv;
    panels.push({ n: panels.length + 1, u, v, center: sky(u, v) });
  }
  const W = su * (cols - 1) + w, H = sv * (rows - 1) + h;
  return { st, ra, dec, pa: m360(pa / D2R), w, h, W, H, up, right, sky, panels,
    sizeDeg: [2 * Math.atan(W / 2) / D2R, 2 * Math.atan(H / 2) / D2R] };
}

export function rectLine(L, u, v, w, h, material) {
  const pts = [], c = [[-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]], N = 8;
  for (let k = 0; k < 4; k++) for (let t = 0; t < N; t++) {
    const a = c[k], b = c[k + 1], f = t / N;
    const [ra, dec] = L.sky(u + (a[0] + (b[0] - a[0]) * f) * w / 2, v + (a[1] + (b[1] - a[1]) * f) * h / 2);
    pts.push(eqVec(ra, dec, R * 0.99));
  }
  pts.push(pts[0].clone());
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material);
  if (material.isLineDashedMaterial) line.computeLineDistances();
  return line;
}

export function rebuildFrame(center) {
  for (const c of [...frameGroup.children]) {
    frameGroup.remove(c);
    if (c.isCSS2DObject) c.element.remove(); else { c.geometry?.dispose(); c.material?.dispose(); }
  }
  const act = active();
  frameGeom = layout(act, center[0], center[1], S.mosaic);
  for (const st of S.setups) {
    if (st !== act && !st.show) continue;
    const L = st === act ? frameGeom : layout(st, center[0], center[1], { cols: 1, rows: 1, overlap: 0 });
    const mat = st === act ? new THREE.LineBasicMaterial({ color: st.color })
      : new THREE.LineDashedMaterial({ color: st.color, dashSize: L.w * R * 0.04, gapSize: L.w * R * 0.03 });
    for (const p of L.panels) frameGroup.add(rectLine(L, p.u, p.v, L.w, L.h, mat));
    if (L.panels.length > 1) {          // outline of the whole mosaic + panel numbers
      frameGroup.add(rectLine(L, 0, 0, L.W, L.H, new THREE.LineBasicMaterial({ color: st.color, transparent: true, opacity: 0.35 })));
      for (const p of L.panels) {
        const n = label(String(p.n), 'pnum'); n.element.style.color = st.color;
        n.position.copy(eqVec(...p.center, R * 0.99)); frameGroup.add(n);
      }
    }
    const t = label(`${st.name} · ${fmtAng(L.sizeDeg[0])} × ${fmtAng(L.sizeDeg[1])}` +
      (L.panels.length > 1 ? ` · ${S.mosaic.cols}×${S.mosaic.rows}` : '') + ` · PA ${L.pa.toFixed(0)}°`, 'frlbl');
    t.center.set(0, 1); t.element.style.color = st.color;
    t.position.copy(eqVec(...L.sky(-L.W / 2, L.H / 2), R * 0.99)); frameGroup.add(t);
    if (st === act) {                   // rotation handle above the top edge
      const hnd = label('⟳', 'rothandle'); hnd.element.style.color = st.color; hnd.element.title = 'Drag to rotate the camera';
      hnd.position.copy(eqVec(...L.sky(0, L.H / 2 + Math.max(L.H * 0.08, 0.002)), R * 0.99));
      hnd.element.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); startDrag(e, 'rotate'); });
      frameGroup.add(hnd);
    }
  }
  renderFraming();
}

export function updateFrame() {
  const c = S.frame ? [S.frame.ra, S.frame.dec] : viewCenter();
  const act = active();
  // alt-az frames change orientation with time, so their PA is part of the signature
  const sig = JSON.stringify([c.map((x) => x.toFixed(5)), S.mosaic, S.setups.map((st) =>
    [st.id, st.show, st.color, st.name, st.focal, st.reducer, st.sw, st.sh, st.rot, st.mount, st === act,
      (st.mount ?? 'eq') === 'eq' ? 0 : frameRot(st, c[0], c[1]).toFixed(1)])]);
  if (sig !== frameSig) { frameSig = sig; rebuildFrame(c); }
}

export function hitFrame(e) {
  if (!frameGeom) return false;
  const [ra, dec] = pointerRaDec(e), [xi, eta] = toPlane(frameGeom.ra, frameGeom.dec, ra, dec);
  const u = xi * frameGeom.right[0] + eta * frameGeom.right[1], v = xi * frameGeom.up[0] + eta * frameGeom.up[1];
  return Math.abs(u) <= frameGeom.W / 2 && Math.abs(v) <= frameGeom.H / 2;
}

// framing panel (bottom left of the sky)
export function renderFraming() {
  const g = frameGeom; if (!g) return;
  $('frInfo').innerHTML = `<b>${S.frame ? 'Anchored' : 'Follows view'}</b> · RA ${fmtRA(g.ra)} · Dec ${fmtDec(g.dec)} · PA ${g.pa.toFixed(1)}°` +
    (g.panels.length > 1 ? ` · total ${fmtAng(g.sizeDeg[0])} × ${fmtAng(g.sizeDeg[1])}` : '');
  $('frAnchor').textContent = S.frame ? 'Follow view' : 'Anchor here';
}
export function setMosaic() {
  S.mosaic = { cols: Math.max(1, Math.min(10, +$('moCols').value || 1)), rows: Math.max(1, Math.min(10, +$('moRows').value || 1)),
    overlap: Math.max(0, Math.min(50, +$('moOv').value || 0)) };
  store.set('mosaic', S.mosaic);
}
  

// module setup – called once from main.js after all modules are loaded
export function init() {
  S.mosaic = store.get('mosaic', { cols: 1, rows: 1, overlap: 15 });
  S.frame = null;
  eqGroup.add(frameGroup);
  $('moCols').value = S.mosaic.cols;
  $('moRows').value = S.mosaic.rows;
  $('moOv').value = S.mosaic.overlap;
  for (const id of ['moCols', 'moRows', 'moOv']) $(id).addEventListener('input', setMosaic);
  $('frAnchor').onclick = () => {
    if (S.frame) S.frame = null; else { const [ra, dec] = viewCenter(); S.frame = { ra, dec }; }
    frameSig = '';
  };
  $('frGo').onclick = () => { if (!frameGeom) return; S.track = false; scene.updateMatrixWorld(); aimAt(eqToWorld(eqVec(frameGeom.ra, frameGeom.dec))); };
  $('frCopy').onclick = async () => {
    const g = frameGeom; if (!g) return;
    const rows = [['Panel', 'RA (hms)', 'Dec (dms)', 'RA (deg)', 'Dec (deg)', 'PA (deg)'].join('\t'),
      ...g.panels.map((p) => [p.n, fmtRA(p.center[0]), fmtDec(p.center[1]), p.center[0].toFixed(5), p.center[1].toFixed(5), g.pa.toFixed(1)].join('\t'))];
    try { await navigator.clipboard.writeText(rows.join('\n')); $('frCopy').textContent = 'Copied ✓'; }
    catch { prompt('Copy the panel coordinates:', rows.join('\n')); }
    setTimeout(() => $('frCopy').textContent = 'Copy coords', 1500);
  };
}
