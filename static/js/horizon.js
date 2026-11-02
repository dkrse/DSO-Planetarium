import { invalidate } from './loop.js';
import { onTab } from './dialog.js';
// ---------------------------------------------------------------- custom horizon profile
// A list of [azimuth, altitude] points stored on the server (settings.horizon). It is drawn as a
// silhouette on the sky, shown in the altitude chart and used by the server for imageable hours.
import * as THREE from 'three';
import { $, R, S } from './core.js';
import { ground, horizonRing, scene, hzVec } from './scene.js';
import { api } from './sync.js';
import { loadVisibility, drawChart } from './panels.js';

S.horizon = [];

/** Horizon altitude at azimuth az (linear interpolation, wraps at 360°) – mirror of app/astro.py */
export function horizonAlt(az, pts = S.horizon) {
  if (!pts.length) return 0;
  const p = [...pts].map(([a, h]) => [((a % 360) + 360) % 360, h]).sort((x, y) => x[0] - y[0]);
  az = ((az % 360) + 360) % 360;
  let prev = [p[p.length - 1][0] - 360, p[p.length - 1][1]];
  for (const [a, h] of [...p, [p[0][0] + 360, p[0][1]]]) {
    if (az <= a) return prev[1] + (h - prev[1]) * (a !== prev[0] ? (az - prev[0]) / (a - prev[0]) : 0);
    prev = [a, h];
  }
  return p[p.length - 1][1];
}

/** Is a world-space direction above the local horizon profile? (used to hide labels behind trees / buildings) */
export function aboveHorizon(v, margin = 0) {
  if (S.showGround === false) return true;              // ground hidden → everything counts as visible
  const len = v.length(), alt = Math.asin(v.y / len) * 180 / Math.PI;
  if (!S.horizon.length) return alt > margin;
  return alt > horizonAlt(Math.atan2(v.x, -v.z) * 180 / Math.PI) + margin;
}

/** Parse Stellarium (.txt), NINA (.hrz) or CSV horizon files: one "azimuth altitude" pair per line. */
export function parseHorizon(text) {
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.replace(/(#|\/\/).*$/, '').trim();          // comments: # or //
    if (!l) continue;
    const n = l.split(/[\s,;]+/).map(Number);
    if (n.length >= 2 && n.slice(0, 2).every(Number.isFinite)) pts.push([n[0], Math.max(-5, Math.min(90, n[1]))]);
  }
  return pts;
}
const formatHorizon = (pts) => pts.map(([a, h]) => `${a} ${h}`).join('\n');

// 3D silhouette between the mathematical horizon and the profile
const silhouette = new THREE.Group();
function buildSilhouette() {
  for (const c of [...silhouette.children]) { silhouette.remove(c); c.geometry.dispose(); }
  if (!S.horizon.length) return;
  const pos = [], edge = [];
  for (let az = 0; az <= 360; az += 1) {
    const h = horizonAlt(az), lo = hzVec(-0.5, az, R * 0.96), hi = hzVec(Math.max(h, -0.5), az, R * 0.96);
    pos.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z); edge.push(hi);
  }
  const idx = [];
  for (let i = 0; i < 360; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  silhouette.add(new THREE.Mesh(g, silMat));
  silhouette.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), edgeMat));
}
const silMat = new THREE.MeshBasicMaterial({ color: 0x0b0f0a, side: THREE.DoubleSide });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a6a2a });
export function setSilhouetteColor(hex) { silMat.color.setHex(hex); }

/** Show / hide the ground, the horizon line and the horizon profile (objects below the horizon become visible). */
export function setGroundVisible(on) {
  S.showGround = on;
  ground.visible = horizonRing.visible = silhouette.visible = on;
  invalidate();
}

export function setHorizon(pts) {
  S.horizon = pts; buildSilhouette(); drawChart(); invalidate();
}
async function saveHorizon(pts) {
  const r = await api('PATCH', '/api/settings', { horizon: pts });
  setHorizon(r.horizon); loadVisibility();
}

function fillTab() {
  $('hzText').value = formatHorizon(S.horizon);
  $('hzInfo').textContent = '';
}
function preview() {
  const pts = parseHorizon($('hzText').value);
  $('hzInfo').textContent = pts.length ? `${pts.length} points · max ${Math.max(...pts.map((p) => p[1])).toFixed(1)}°` : 'flat horizon (0°)';
}

export function init() {
  scene.add(silhouette);
  onTab('horizon', fillTab);
  $('hzText').addEventListener('input', preview);
  $('hzFile').onchange = async () => {
    const f = $('hzFile').files[0]; if (!f) return;
    $('hzText').value = formatHorizon(parseHorizon(await f.text())); preview(); $('hzFile').value = '';
  };
  $('hzFlat').onclick = () => { $('hzText').value = ''; preview(); };
  $('hzSave').onclick = async () => {
    try { await saveHorizon(parseHorizon($('hzText').value)); $('hzInfo').textContent = `✓ saved (${S.horizon.length} points)`; }
    catch (e) { $('hzInfo').textContent = '⚠ ' + e.message; }
  };
}
