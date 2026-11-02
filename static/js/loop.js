import { aboveHorizon } from './horizon.js';
import * as THREE from 'three';
import { D2R, fmtDec, fmtRA } from '../astro.js';
import { $, R, S, fmtT } from './core.js';
import { updateFrame } from './framing.js';
import { imgIndex, loadImage, loading, nodes, planetNodes, sel3D, starGroup, starLabels, starUni } from './objects.js';
import { drawChart, renderTable } from './panels.js';
import { aimAt, camera, eqGrid, gridLabels, labelR, lstNow, moon, moonL, padLabel, renderer, scene, sky, sun, sunL, tmpM, updateSky, view } from './scene.js';
import { fmtDate, isoDate, syncSlider } from './time.js';

// ---------------------------------------------------------------- render loop
export const wp = new THREE.Vector3(), ndc = new THREE.Vector3();
export let last = performance.now(), lastTableUpd = 0;
export function frame(now) {
  const dt = (now - last) / 1000; last = now;
  if (S.playing) {
    S.time = new Date(S.time.getTime() + dt * 1000 * +$('speed').value);
    syncSlider();
    if (now - lastTableUpd > 700) { lastTableUpd = now; renderTable(); drawChart(); }
  }
  updateSky();
  scene.updateMatrixWorld();

  if (S.track && S.selected) { sel3D(S.selected).getWorldPosition(wp); aimAt(wp); }
  camera.rotation.set(view.pitch, view.yaw, 0);
  camera.updateMatrixWorld();

  const H = sky.clientHeight, worldPerPx = 2 * R * Math.tan(camera.fov / 2 * D2R) / H;
  const showLbl = $('labels').checked, showImg = $('imgs').checked;
  for (const n of nodes.values()) {
    n.holder.getWorldPosition(wp);
    const up = aboveHorizon(wp, -0.3);
    const pxSize = 2 * n.a / worldPerPx;
    n.outline.scale.setScalar(pxSize < 10 ? 10 / pxSize : 1);
    padLabel(n.lbl, Math.max(pxSize, 10) / 2);
    n.lbl.visible = showLbl && up && (camera.fov < 50 || n.o.maj > 15 || n.o.id.startsWith('M') || S.selected === n.o.id);
    if (n.img) n.img.visible = showImg;
    if (showImg && up && !n.imgState && loading < 4 && pxSize > 40 && camera.fov < 40 && imgIndex[n.o.id]) {
      ndc.copy(wp).project(camera);
      if (Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3 && ndc.z < 1) loadImage(n);
    }
  }
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
  padLabel(sunL, sun.scale.x / 2 / worldPerPx * 0.6); padLabel(moonL, moon.scale.x / 2 / worldPerPx * 0.6);
  const showPl = $('planets').checked;
  for (const n of planetNodes) {
    const p = n.p; if (!p) continue;
    // true disc size, but never smaller than a magnitude-dependent dot
    const trueW = 2 * R * Math.tan(p.diam / 7200 * D2R) / 0.45, dotPx = Math.min(16, Math.max(5, 9 - p.mag * 0.9));
    const w = Math.max(trueW, dotPx * worldPerPx);
    n.spr.scale.setScalar(w); n.spr.visible = showPl;
    n.lbl.visible = showPl && showLbl && aboveHorizon(n.spr.getWorldPosition(wp));
    padLabel(n.lbl, w * 0.45 / worldPerPx);
  }
  sunL.visible = showLbl && aboveHorizon(sun.getWorldPosition(wp));
  moonL.visible = showLbl && aboveHorizon(moon.getWorldPosition(wp));
  for (const l of gridLabels) l.visible = eqGrid.visible && aboveHorizon(l.getWorldPosition(wp));

  declutter(H);
  updateFrame();
  hud();
  renderer.render(scene, camera);
  labelR.render(scene, camera);
  requestAnimationFrame(frame);
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
  for (const n of nodes.values()) if (n.lbl.visible) cand.push([n.lbl, S.selected === n.o.id ? 1e6 : 3000 + n.o.maj + (n.o.id.startsWith('M') ? 50 : 0)]);
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

export function hud() {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const alt = Math.asin(d.y) / D2R, az = ((Math.atan2(d.x, -d.z) / D2R) + 360) % 360;
  // RA/Dec of the view center: inverse transform
  const e = d.clone().applyMatrix4(tmpM.clone().invert());
  const ra = Math.atan2(e.y, e.x) / D2R, dec = Math.asin(e.z) / D2R;
  $('hudTime').textContent = S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + fmtDate(isoDate(S.time)) + ' ' + fmtT(S.time)
    + `   LST ${fmtRA(lstNow).replace(/ \d+s$/, '')}`;
  $('hudView').textContent = `Az ${az.toFixed(1)}°  Alt ${alt.toFixed(1)}°  |  RA ${fmtRA(ra)}  Dec ${fmtDec(dec)} (J2000)  |  view ${camera.fov.toFixed(camera.fov < 5 ? 2 : 1)}°`;
}

// module setup – called once from main.js after all modules are loaded
export function init() {

}
