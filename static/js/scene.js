import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { D2R, altaz, jd, lstDeg, moonIllum, moonRaDec, planets, precess, precessionMatrix, sunRaDec } from '../astro.js';
import { $, R, S, active } from './core.js';
import { frameGeom, hitFrame, m360, pointerRaDec, toPlane, viewCenter, zenithPA } from './framing.js';
import { planetNodes, starUni } from './objects.js';
import { renderDlg, updateFovInfo } from './settings.js';
import { saveSetups } from './sync.js';
import { setSilhouetteColor } from './horizon.js';

// ---------------------------------------------------------------- scene
export let sky;
export const renderer = new THREE.WebGLRenderer({ antialias: true });

export const labelR = new CSS2DRenderer();
// zIndex creates a stacking context: CSS2DRenderer gives each label z-index up to ~1000,
// which would otherwise paint labels over the UI panels

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);

export const view = { yaw: Math.PI, pitch: 25 * D2R }; // looking south

export const eqGroup = new THREE.Group();            // equatorial frame, J2000

export const eqVec = (ra, dec, r = R) => new THREE.Vector3(
  r * Math.cos(dec * D2R) * Math.cos(ra * D2R), r * Math.cos(dec * D2R) * Math.sin(ra * D2R), r * Math.sin(dec * D2R));
export const hzVec = (alt, az, r = R) => new THREE.Vector3(
  r * Math.cos(alt * D2R) * Math.sin(az * D2R), r * Math.sin(alt * D2R), -r * Math.cos(alt * D2R) * Math.cos(az * D2R));

export function label(text, cls, onClick) {
  const el = document.createElement('div');
  el.className = cls; el.textContent = text;
  el.dataset.pad = '';
  if (onClick) el.addEventListener('pointerup', (e) => { if (!drag.moved) { e.stopPropagation(); onClick(); } });
  return new CSS2DObject(el);
}
// standard placement: to the right of the object, offset by its on-screen radius
export function rightOf(lbl) { lbl.center.set(0, 0.5); return lbl; }
export function padLabel(lbl, px) {
  const p = Math.round(Math.min(Math.max(px, 5), 400) + 4) + 'px';
  if (lbl.element.dataset.pad !== p) { lbl.element.dataset.pad = p; lbl.element.style.paddingLeft = p; }
}

// ground + horizon
export let ground;

export const ringPts = []; 

// zenith marker

// Alt/Az grid
export const azGrid = new THREE.Group(); 

// equatorial grid
export const eqGrid = new THREE.Group(); 
export const gridLabels = [];

// Sun + Moon
export function disc(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color); gr.addColorStop(0.45, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); return s;
}
export const sun = disc('#fff3c0', 3), moon = disc('#e8eef8', 2.2);
export const sunL = label('Sun', 'sm'), moonL = label('Moon', 'sm');
   

// ---------------------------------------------------------------- sky orientation
export const tmpM = new THREE.Matrix4(), precM = new THREE.Matrix4();
export let lstNow = 0;
export function updateSky() {
  const j = jd(S.time);
  lstNow = lstDeg(j, S.lon);
  const v = (ra, dec) => { const [alt, az] = altaz(ra, dec, S.lat, lstNow); return hzVec(alt, az, 1); };
  // eqGroup holds J2000 data: world = (equator of date → horizon) · (precession J2000 → date)
  const P = precessionMatrix(j);
  precM.set(P[0][0], P[0][1], P[0][2], 0, P[1][0], P[1][1], P[1][2], 0, P[2][0], P[2][1], P[2][2], 0, 0, 0, 0, 1);
  tmpM.makeBasis(v(0, 0), v(90, 0), v(0, 90)).multiply(precM);
  eqGroup.matrix.copy(tmpM); eqGroup.matrixWorldNeedsUpdate = true;

  // Sun and Moon formulas give coordinates of date → back to J2000 for the J2000 group
  const [sra, sdec] = sunRaDec(j), [mra, mdec] = moonRaDec(j);
  sun.position.copy(eqVec(...precess(sra, sdec, j, true), R * 0.985)); moon.position.copy(eqVec(...precess(mra, mdec, j, true), R * 0.985)); // behind the ground (0.97 R) → hidden below horizon
  planets(j).forEach((p, i) => { planetNodes[i].p = p; planetNodes[i].spr.position.copy(eqVec(p.ra, p.dec, R * 0.985)); });
  const ill = moonIllum(j);
  moonL.element.textContent = `Moon ${Math.round(ill * 100)}%`;
  moon.material.opacity = 0.35 + 0.65 * ill;

  const sAlt = altaz(sra, sdec, S.lat, lstNow)[0];
  const t = Math.max(0, Math.min(1, (sAlt + 18) / 24));      // −18° → 0, +6° → 1
  scene.background = new THREE.Color().lerpColors(new THREE.Color(0x020308), new THREE.Color(0x2d5c9a), t * t);
  starUni.uDay.value = Math.max(0, Math.min(0.97, (sAlt + 10) / 12));
  ground.material.color.setHex(sAlt > -6 ? 0x14180f : 0x080a07);
  setSilhouetteColor(sAlt > -6 ? 0x14180f : 0x080a07);
}

// ---------------------------------------------------------------- camera + controls
export const drag = { on: false, x: 0, y: 0, moved: false };
export const overlay = labelR.domElement;
// drag modes: 'sky' pans the view, 'frame' moves the FOV frame / mosaic, 'rotate' turns the camera
export function startDrag(e, mode) {
  Object.assign(drag, { on: true, moved: false, x: e.clientX, y: e.clientY, mode });
  if (mode === 'frame') {
    const c = S.frame ? [S.frame.ra, S.frame.dec] : viewCenter();
    drag.c0 = eqVec(c[0], c[1], 1); drag.p0 = eqVec(...pointerRaDec(e), 1);
  }
}

export const _q = new THREE.Quaternion();

export function aimAt(world) {
  view.yaw = Math.atan2(-world.x, -world.z);
  view.pitch = Math.asin(world.y / world.length());
}
export function setFov(f) { camera.fov = f; camera.updateProjectionMatrix(); }

// celestial pole marker

export function resize() {
  const w = sky.clientWidth, h = sky.clientHeight;
  renderer.setSize(w, h); labelR.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  sky = $('sky');
  renderer.setPixelRatio(devicePixelRatio);
  sky.appendChild(renderer.domElement);
  Object.assign(labelR.domElement.style, { position: 'absolute', top: 0, left: 0, zIndex: 1 });
  sky.appendChild(labelR.domElement);
  camera.rotation.order = 'YXZ';
  eqGroup.matrixAutoUpdate = false;
  scene.add(eqGroup);
  ground = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.97, 64, 16, 0, Math.PI * 2, Math.PI / 2 + 0.0005, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x0b0f0a, side: THREE.BackSide }));
  scene.add(ground);
  for (let a = 0; a <= 360; a += 2) ringPts.push(hzVec(0, a, R * 0.96));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x8a6a2a })));
  [['N', 0], ['E', 90], ['S', 180], ['W', 270], ['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].forEach(([t, a]) => {
    const l = label(t, 'card'); l.position.copy(hzVec(1.5, a, R * 0.95)); if (t.length > 1) l.element.style.fontSize = '11px'; scene.add(l);
  });
  { const z = label('✛ Zenith', 'glbl'); z.element.style.color = '#8a6a2a'; z.position.set(0, R * 0.95, 0); scene.add(z); }
  scene.add(azGrid);
  {
    const m = new THREE.LineBasicMaterial({ color: 0x3a2e1a, transparent: true, opacity: 0.7 });
    for (let alt = 15; alt < 90; alt += 15) {
      const p = []; for (let a = 0; a <= 360; a += 2) p.push(hzVec(alt, a, R * 0.99));
      azGrid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), m));
    }
    for (let az = 0; az < 360; az += 30) {
      const p = []; for (let alt = 0; alt <= 90; alt += 2) p.push(hzVec(alt, az, R * 0.99));
      azGrid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), m));
    }
  }
  eqGroup.add(eqGrid);
  {
    const m = new THREE.LineBasicMaterial({ color: 0x1b2d4c });
    const mEq = new THREE.LineBasicMaterial({ color: 0x2c4a7a });
    for (let ra = 0; ra < 360; ra += 15) {
      const p = []; for (let d = -88; d <= 88; d += 2) p.push(eqVec(ra, d, R * 0.995));
      eqGrid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), m));
      const l = label(`${ra / 15}h`, 'glbl'); l.position.copy(eqVec(ra, 0, R * 0.99)); eqGrid.add(l); gridLabels.push(l);
    }
    for (let d = -80; d <= 80; d += 10) {
      const p = []; for (let ra = 0; ra <= 360; ra += 2) p.push(eqVec(ra, d, R * 0.995));
      eqGrid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), d === 0 ? mEq : m));
      if (d) { const l = label(`${d > 0 ? '+' : ''}${d}°`, 'glbl'); l.position.copy(eqVec(0, d, R * 0.99)); eqGrid.add(l); gridLabels.push(l); }
    }
  }
  rightOf(sunL);
  rightOf(moonL);
  sun.add(sunL);
  moon.add(moonL);
  eqGroup.add(sun, moon);
  overlay.addEventListener('pointerdown', (e) => startDrag(e, hitFrame(e) ? 'frame' : 'sky'));
  addEventListener('pointerup', () => { drag.on = false; setTimeout(() => drag.moved = false, 0); });
  addEventListener('pointermove', (e) => {
    if (!drag.on) { if (e.target === overlay) overlay.style.cursor = hitFrame(e) ? 'move' : 'default'; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'frame') {
      // rotate the frame centre by the same rotation that takes the grab point to the pointer
      _q.setFromUnitVectors(drag.p0, eqVec(...pointerRaDec(e), 1));
      const c = drag.c0.clone().applyQuaternion(_q);
      S.frame = { ra: m360(Math.atan2(c.y, c.x) / D2R), dec: Math.asin(Math.max(-1, Math.min(1, c.z))) / D2R };
      return;
    }
    if (drag.mode === 'rotate') {
      const g = frameGeom, [xi, eta] = toPlane(g.ra, g.dec, ...pointerRaDec(e));
      const pa = m360(Math.round(Math.atan2(xi, eta) / D2R * 2) / 2), st = active();
      st.rot = (st.mount ?? 'eq') === 'eq' ? pa : m360(Math.round((zenithPA(g.ra, g.dec) - pa) * 2) / 2);
      saveSetups(); updateFovInfo();
      if ($('eqDlg').open) renderDlg();
      return;
    }
    if (drag.moved) S.track = false;
    const k = camera.fov * D2R / sky.clientHeight;
    view.yaw += dx * k; view.pitch = Math.max(-0.2, Math.min(Math.PI / 2, view.pitch + dy * k));
  });
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.fov = Math.max(0.15, Math.min(110, camera.fov * Math.exp(e.deltaY * 0.0012)));
    camera.updateProjectionMatrix();
  }, { passive: false });
  document.querySelectorAll('[data-look]').forEach((b) => b.onclick = () => {
    S.track = false; view.yaw = -b.dataset.look * D2R; view.pitch = 25 * D2R; setFov(Math.max(camera.fov, 70));
  });
  $('zenith').onclick = () => { S.track = false; view.pitch = Math.PI / 2 - 1e-4; setFov(Math.max(camera.fov, 100)); };
  $('pole').onclick = () => {
    S.track = false; scene.updateMatrixWorld();
    aimAt(eqVec(0, S.lat >= 0 ? 90 : -90).applyMatrix4(eqGroup.matrixWorld)); setFov(Math.min(Math.max(camera.fov, 30), 60));
  };
  { const p = label('✛ NCP', 'glbl'); p.element.style.color = '#6f8fbf'; p.position.copy(eqVec(0, 90, R * 0.99)); eqGroup.add(p); gridLabels.push(p);
    const q = label('✛ SCP', 'glbl'); q.element.style.color = '#6f8fbf'; q.position.copy(eqVec(0, -90, R * 0.99)); eqGroup.add(q); gridLabels.push(q); }
  addEventListener('resize', resize);
}
