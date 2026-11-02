import { aboveHorizon } from './horizon.js';
import * as THREE from 'three';
import { D2R, fmtDec, fmtRA } from '../astro.js';
import { $, R, S, fmtT } from './core.js';
import { updateFrame } from './framing.js';
import { imgIndex, loadImage, loading, nodes, planetNodes, sel3D, starGroup, starLabels, starUni } from './objects.js';
import { drawChart, renderTable, updateTableTime } from './panels.js';
import { DISC, aimAt, applyView, camera, eqGrid, gridLabels, labelR, lstNow, moon, moonL, padLabel, renderer, scene, sky, sun, sunL, tmpM, updateSky, view } from './scene.js';
import { fmtDate, isoDate, syncSlider } from './time.js';

// ---------------------------------------------------------------- render loop
export const camDir = new THREE.Vector3();
export const wp = new THREE.Vector3(), ndc = new THREE.Vector3();
export let last = performance.now(), lastTableUpd = 0;
// render on demand: a frame is drawn only when something changed (input, data, playback) –
// an idle planetarium uses no CPU / GPU. At least one frame per second keeps slow changes in sync.
let dirty = true;
export const invalidate = () => { dirty = true; };
// optional profiling: window.__dso.prof = {} collects the time spent in each part of a frame
const P = (name, t0) => { const p = window.__dso?.prof; if (p) p[name] = (p[name] ?? 0) + performance.now() - t0; return performance.now(); };
export function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = now - last;
  if (elapsed < 1000 / (S.perf?.fps ?? 60) - 2) return;                 // frame-rate cap
  if (!dirty && !S.playing && elapsed < 1000) return;                   // nothing to do
  dirty = false; last = now;
  const dt = Math.min(elapsed / 1000, 0.25);
  if (S.playing) {
    S.time = new Date(S.time.getTime() + dt * 1000 * +$('speed').value);
    syncSlider();
    if (now - lastTableUpd > 1000) { lastTableUpd = now; updateTableTime(); drawChart(); }
  }
  let t = performance.now();
  updateSky(); t = P('updateSky', t);
  scene.updateMatrixWorld(); t = P('matrices', t);

  if (S.track && S.selected) { sel3D(S.selected).getWorldPosition(wp); aimAt(wp); }
  applyView();
  camera.updateMatrixWorld();

  const H = sky.clientHeight, worldPerPx = 2 * R * Math.tan(camera.fov / 2 * D2R) / H;
  const showLbl = $('labels').checked, showImg = $('imgs').checked;
  // density (Settings › Objects): at wide views draw only objects that are large on screen or bright enough
  const magLim = 7 + 2 * Math.log2(100 / camera.fov);          // 100° → 7 mag, 50° → 9, 25° → 11 …
  const pinned = new Set((S.targets ?? []).map((t) => t.object_id));
  // frustum test: skip objects outside the view cone (half-diagonal of the view + margin)
  camera.getWorldDirection(camDir);
  const tv = Math.tan(camera.fov / 2 * D2R), cosView = Math.cos(Math.min(Math.PI / 2, Math.atan(tv * Math.hypot(1, camera.aspect)) + 3 * D2R));
  t = P('setup', t);
  for (const n of nodes.values()) {
    const pxSize = 2 * n.a / worldPerPx;
    const show = !S.lod || pxSize >= 6 || (n.o.mag > 0 && n.o.mag <= magLim) || n.messier
      || S.selected === n.o.id || pinned.has(n.o.id);
    if (!show) { n.holder.visible = n.lbl.visible = false; continue; }
    n.holder.getWorldPosition(wp);                                   // updates only the holder itself
    if (wp.dot(camDir) < cosView * R && pxSize < 2000) { n.holder.visible = n.lbl.visible = false; continue; }   // off screen
    // hidden subtrees are not kept up to date (see updateVisibleChildren) → refresh when it appears again
    if (!n.holder.visible) { n.holder.visible = true; n.holder.updateMatrixWorld(true); }
    const up = aboveHorizon(wp, -0.3);
    const sc = pxSize < 10 ? 10 / pxSize : 1;
    if (n.outline.scale.x !== sc) { n.outline.scale.setScalar(sc); n.outline.updateMatrix(); }   // matrices are frozen (see freeze)
    padLabel(n.lbl, Math.max(pxSize, 10) / 2);
    n.lbl.visible = showLbl && up && (camera.fov < 50 || n.o.maj > 15 || n.messier || S.selected === n.o.id);
    if (n.img) n.img.visible = showImg;
    if (showImg && up && !n.imgState && loading < 4 && pxSize > 40 && camera.fov < 40 && imgIndex[n.o.id]) {
      ndc.copy(wp).project(camera);
      if (Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3 && ndc.z < 1) loadImage(n);
    }
  }
  t = P('objects', t);
  starUni.uLim.value = +$('starMag').value + Math.min(3, Math.max(0, Math.log2(60 / camera.fov) * 0.7));
  // star names: proper names of bright stars; fainter ones and Bayer letters appear when zoomed in
  const showNames = $('starNames').checked && starGroup.visible && starUni.uDay.value < 0.8;
  const nameLim = Math.min(4.5, 1.6 + Math.max(0, Math.log2(90 / camera.fov)) * 0.9), detailed = camera.fov < 15;
  for (const s of starLabels) {
    let vis = showNames && s.mag <= nameLim && (s.name || camera.fov < 30);
    if (vis) vis = aboveHorizon(s.lbl.getWorldPosition(wp));
    s.lbl.visible = vis;
    if (vis) {
      const mode = detailed && s.full ? 'full' : 'short';
      if (s.mode !== mode) { s.mode = mode; s.lbl.element.textContent = mode === 'full' ? s.full : (s.name || s.bayer); }
    }
  }
  const showPl = $('planets').checked;
  for (const n of planetNodes) {
    const p = n.p; if (!p) continue;
    // true disc size, but never smaller than a magnitude-dependent dot
    const trueW = 2 * R * Math.tan(p.diam / 7200 * D2R) / DISC, dotPx = Math.min(16, Math.max(5, 9 - p.mag * 0.9));
    const w = Math.max(trueW, dotPx * worldPerPx);
    n.spr.scale.setScalar(w); n.spr.visible = showPl;
    n.lbl.visible = showPl && showLbl && aboveHorizon(n.spr.getWorldPosition(wp));
    padLabel(n.lbl, w * DISC / 2 / worldPerPx);
  }
  // Sun and Moon at their true angular size (≈ 32′ / 31′), never smaller than a visible dot
  for (const [spr, l, diamDeg, minPx] of [[sun, sunL, 0.533, 14], [moon, moonL, 0.518, 12]]) {
    const w = Math.max(2 * R * 0.985 * Math.tan(diamDeg / 2 * D2R) / DISC, minPx * worldPerPx);
    spr.scale.setScalar(w); padLabel(l, w * DISC / 2 / worldPerPx);
  }
  sunL.visible = showLbl && aboveHorizon(sun.getWorldPosition(wp));
  moonL.visible = showLbl && aboveHorizon(moon.getWorldPosition(wp));
  for (const l of gridLabels) l.visible = eqGrid.visible && aboveHorizon(l.getWorldPosition(wp));

  t = P('stars+planets', t);
  declutter(H); t = P('declutter', t);
  updateFrame(); t = P('frame', t);
  hud(); t = P('hud', t);
  renderer.render(scene, camera); t = P('webgl', t);
  labelR.render(scene, camera); t = P('labels', t);
  if (window.__dso?.prof) window.__dso.prof.frames = (window.__dso.prof.frames ?? 0) + 1;
}

// ---------------------------------------------------------------- label decluttering
// Greedy placement by priority (selected > Sun/Moon > planets > DSOs by size > stars by brightness);
// a label that would overlap an already placed one is hidden, like in Stellarium/KStars.
export const measureCtx = document.createElement('canvas').getContext('2d');
export function labelWidth(el) {
  const t = el.textContent;
  if (el._wText !== t) {
    const cs = getComputedStyle(el);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    el._w = measureCtx.measureText(t).width + 6; el._wText = t;
  }
  return el._w;
}
export const lp = new THREE.Vector3();
export function declutter(H) {
  const W = sky.clientWidth, cand = [];
  for (const n of nodes.values()) if (n.holder.visible && n.lbl.visible) cand.push([n.lbl, S.selected === n.o.id ? 1e6 : 3000 + n.o.maj + (n.o.id.startsWith('M') ? 50 : 0)]);
  for (const n of planetNodes) if (n.lbl.visible) cand.push([n.lbl, S.selected === 'P:' + n.name ? 1e6 : 9000 - n.p.mag]);
  for (const l of [sunL, moonL]) if (l.visible) cand.push([l, 9500]);   // Sun/Moon above planets
  for (const s of starLabels) if (s.lbl.visible) cand.push([s.lbl, 1000 - s.mag * 10]);
  cand.sort((a, b) => b[1] - a[1]);
  const cell = 80, grid = new Map(), placed = [];
  const key = (i, j) => i * 10007 + j;
  for (const [lbl] of cand) {
    lbl.getWorldPosition(lp).project(camera);
    const x0 = (lp.x + 1) / 2 * W + (parseFloat(lbl.element.dataset.pad) || 0), yc = (1 - lp.y) / 2 * H;
    const r = [x0, yc - 7, x0 + labelWidth(lbl.element), yc + 7];
    const i0 = Math.floor(r[0] / cell), i1 = Math.floor(r[2] / cell), j0 = Math.floor(r[1] / cell), j1 = Math.floor(r[3] / cell);
    let hit = false;
    for (let i = i0; i <= i1 && !hit; i++) for (let j = j0; j <= j1 && !hit; j++)
      for (const q of grid.get(key(i, j)) || []) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) { hit = true; break; }
    if (hit) { lbl.visible = false; continue; }
    placed.push(r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(r); }
  }
}

let hudText = ['', ''];
export function hud() {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const alt = Math.asin(d.y) / D2R, az = ((Math.atan2(d.x, -d.z) / D2R) + 360) % 360;
  // RA/Dec of the view center: inverse transform
  const e = d.clone().applyMatrix4(tmpM.clone().invert());
  const ra = Math.atan2(e.y, e.x) / D2R, dec = Math.asin(e.z) / D2R;
  const t = S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + fmtDate(isoDate(S.time)) + ' ' + fmtT(S.time)
    + `   LST ${fmtRA(lstNow).replace(/ \d+s$/, '')}`;
  const v = `Az ${az.toFixed(1)}°  Alt ${alt.toFixed(1)}°  |  RA ${fmtRA(ra)}  Dec ${fmtDec(dec)} (J2000)  |  view ${camera.fov.toFixed(camera.fov < 5 ? 2 : 1)}°`;
  // touch the DOM only when the text changes
  if (t !== hudText[0]) { $('hudTime').textContent = t; hudText[0] = t; }
  if (v !== hudText[1]) { $('hudView').textContent = v; hudText[1] = v; }
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  // any user interaction may change what is drawn
  for (const ev of ['pointerdown', 'pointerup', 'wheel', 'input', 'change', 'click', 'keydown'])
    addEventListener(ev, invalidate, { capture: true, passive: true });          // window: sees every event
  addEventListener('pointermove', (e) => { if (e.buttons) invalidate(); }, { capture: true, passive: true });
  addEventListener('resize', invalidate);

}
