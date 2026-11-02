import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { D2R, jd, lstDeg, altaz, sunRaDec, moonRaDec, moonIllum, fovDeg, fmtRA, fmtDec, planets, PLANET_INFO } from './astro.js';

const R = 100;                       // celestial sphere radius
const $ = (id) => document.getElementById(id);
const fmtT = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

// ---------------------------------------------------------------- state
const store = {
  get(k, d) { try { const v = localStorage.getItem('dso.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dso.' + k, JSON.stringify(v)); } catch { } },
};
const S = {
  lat: store.get('lat', 48.1486), lon: store.get('lon', 17.1077),
  minAlt: store.get('minAlt', 30),
  setups: null, active: null,
  time: new Date(), windowStart: null,
  catalog: [], types: {}, vis: {}, night: null,
  selected: null, track: false, playing: false,
  sort: store.get('sort', ['hours', -1]),
};

// ---------------------------------------------------------------- equipment (telescope + camera setups)
const COLORS = ['#ff5a4e', '#5ab0ff', '#4ade80', '#facc15', '#c084fc', '#fb923c', '#f472b6'];
const uid = () => Math.random().toString(36).slice(2, 10);
function defaultSetups() {                // migrate the old single-setup settings if present
  const old = store.get('sensor', null);
  let [w, h, px] = [23.5, 15.7, 3.76];
  if (old === 'custom') [w, h, px] = store.get('custom', [w, h, px]);
  else if (old) [w, h, px] = old.split('x').map(Number);
  return [{ id: uid(), name: 'My setup', focal: store.get('focal', 400), reducer: 1, aperture: 80,
    sw: w, sh: h, px, rot: store.get('rot', 0), color: COLORS[0], show: false }];
}
S.setups = store.get('setups', null) || defaultSetups();
S.active = store.get('activeSetup', S.setups[0].id);
const active = () => S.setups.find((s) => s.id === S.active) || S.setups[0];
function fovOf(s) {
  const F = s.focal * (s.reducer || 1);
  return { w: fovDeg(s.sw, F), h: fovDeg(s.sh, F), scale: 206.265 * s.px / F, F, fr: s.aperture ? F / s.aperture : null };
}
const fov = () => fovOf(active());
const saveSetups = () => { store.set('setups', S.setups); store.set('activeSetup', active().id); };
const fmtAng = (d) => d >= 1 ? d.toFixed(2) + '°' : (d * 60).toFixed(1) + '′';

// ---------------------------------------------------------------- scene
const sky = $('sky');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
sky.appendChild(renderer.domElement);
const labelR = new CSS2DRenderer();
// zIndex creates a stacking context: CSS2DRenderer gives each label z-index up to ~1000,
// which would otherwise paint labels over the UI panels
Object.assign(labelR.domElement.style, { position: 'absolute', top: 0, left: 0, zIndex: 1 });
sky.appendChild(labelR.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
camera.rotation.order = 'YXZ';
const view = { yaw: Math.PI, pitch: 25 * D2R }; // looking south

const eqGroup = new THREE.Group();            // equatorial frame, J2000
eqGroup.matrixAutoUpdate = false;
scene.add(eqGroup);

const eqVec = (ra, dec, r = R) => new THREE.Vector3(
  r * Math.cos(dec * D2R) * Math.cos(ra * D2R), r * Math.cos(dec * D2R) * Math.sin(ra * D2R), r * Math.sin(dec * D2R));
const hzVec = (alt, az, r = R) => new THREE.Vector3(
  r * Math.cos(alt * D2R) * Math.sin(az * D2R), r * Math.sin(alt * D2R), -r * Math.cos(alt * D2R) * Math.cos(az * D2R));

function label(text, cls, onClick) {
  const el = document.createElement('div');
  el.className = cls; el.textContent = text;
  el.dataset.pad = '';
  if (onClick) el.addEventListener('pointerup', (e) => { if (!drag.moved) { e.stopPropagation(); onClick(); } });
  return new CSS2DObject(el);
}
// standard placement: to the right of the object, offset by its on-screen radius
function rightOf(lbl) { lbl.center.set(0, 0.5); return lbl; }
function padLabel(lbl, px) {
  const p = Math.round(Math.min(Math.max(px, 5), 400) + 4) + 'px';
  if (lbl.element.dataset.pad !== p) { lbl.element.dataset.pad = p; lbl.element.style.paddingLeft = p; }
}

// ground + horizon
const ground = new THREE.Mesh(
  new THREE.SphereGeometry(R * 0.97, 64, 16, 0, Math.PI * 2, Math.PI / 2 + 0.0005, Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x0b0f0a, side: THREE.BackSide }));
scene.add(ground);
const ringPts = []; for (let a = 0; a <= 360; a += 2) ringPts.push(hzVec(0, a, R * 0.96));
scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x8a6a2a })));
[['N', 0], ['E', 90], ['S', 180], ['W', 270], ['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].forEach(([t, a]) => {
  const l = label(t, 'card'); l.position.copy(hzVec(1.5, a, R * 0.95)); if (t.length > 1) l.element.style.fontSize = '11px'; scene.add(l);
});

// zenith marker
{ const z = label('✛ Zenith', 'glbl'); z.element.style.color = '#8a6a2a'; z.position.set(0, R * 0.95, 0); scene.add(z); }

// Alt/Az grid
const azGrid = new THREE.Group(); scene.add(azGrid);
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

// equatorial grid
const eqGrid = new THREE.Group(); eqGroup.add(eqGrid);
const gridLabels = [];
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

// Sun + Moon
function disc(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color); gr.addColorStop(0.45, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); return s;
}
const sun = disc('#fff3c0', 3), moon = disc('#e8eef8', 2.2);
const sunL = label('Sun', 'sm'), moonL = label('Moon', 'sm');
rightOf(sunL); rightOf(moonL); sun.add(sunL); moon.add(moonL);
eqGroup.add(sun, moon);

// ---------------------------------------------------------------- planets
const planetNodes = Object.entries(PLANET_INFO).map(([name, info]) => {
  const spr = disc(info.color, 1);
  const lbl = rightOf(label(name, 'plbl', () => gotoPlanet(name)));
  spr.add(lbl); eqGroup.add(spr);
  return { name, spr, lbl, p: null };
});
const gotoPlanet = (name) => select('P:' + name, true);
// selection can be a DSO id ("M31") or a planet ("P:Jupiter")
const planetOf = (id) => id?.startsWith('P:') ? planetNodes.find((x) => x.name === id.slice(2)) : null;
const sel3D = (id) => planetOf(id)?.spr ?? nodes.get(id)?.holder;
const selLabel = (id) => (planetOf(id) ?? nodes.get(id))?.lbl;
function selRaDec(id, j) {
  const pn = planetOf(id);
  if (pn) { const p = planets(j).find((x) => x.name === pn.name); return [p.ra, p.dec]; }
  const o = nodes.get(id).o; return [o.ra, o.dec];
}

// ---------------------------------------------------------------- DSO objects
const TYPE_COLOR = { G: 0xf0a3ff, GC: 0xffd37a, OC: 0x9be7ff, EN: 0xff7b7b, RN: 0x7bb4ff, PN: 0x7bffb7, SNR: 0xffa65c, DN: 0xa0a0a0, AST: 0xcccccc };
const nodes = new Map();

function ellipse(a, b, segs = 64) {
  const p = []; for (let i = 0; i <= segs; i++) { const t = i / segs * Math.PI * 2; p.push(new THREE.Vector3(b * Math.sin(t), a * Math.cos(t), 0)); }
  return new THREE.BufferGeometry().setFromPoints(p);
}

function buildObjects() {
  for (const o of S.catalog) {
    const holder = new THREE.Object3D();
    holder.position.copy(eqVec(o.ra, o.dec));
    holder.up.set(0, 0, 1);            // towards the north celestial pole
    holder.lookAt(0, 0, 0);            // face the center (eqGroup is still identity here)
    const pa = new THREE.Object3D(); pa.rotation.z = o.pa * D2R; holder.add(pa);
    const a = R * Math.tan(o.maj / 120 * D2R), b = R * Math.tan(Math.max(o.min, o.maj * 0.05) / 120 * D2R);
    const outline = new THREE.Line(ellipse(a, b), new THREE.LineBasicMaterial({ color: TYPE_COLOR[o.type] ?? 0xffffff, transparent: true, opacity: 0.85 }));
    pa.add(outline);
    const lbl = rightOf(label(o.id + (o.name ? ' ' + o.name : ''), 'lbl', () => select(o.id, true)));
    lbl.position.set(0, 0, 0); holder.add(lbl);
    eqGroup.add(holder);
    nodes.set(o.id, { o, holder, outline, lbl, a, img: null, imgState: 0 });
  }
}

// local images from images/ (loaded lazily when zoomed in)
const texLoader = new THREE.TextureLoader(); texLoader.crossOrigin = 'anonymous';
let loading = 0;
let imgIndex = {};
function loadImage(n) {
  const m = imgIndex[n.o.id]; if (!m) { n.imgState = 3; return; }
  n.imgState = 1; loading++;
  texLoader.load(`/api/image/${encodeURIComponent(n.o.id)}?v=${m.v}`, (tex) => {
    loading--; tex.colorSpace = THREE.SRGBColorSpace;
    const w = 2 * R * Math.tan(m.fov / 2 * D2R), h = w * tex.image.height / tex.image.width;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    // image center may differ from the object → own north-oriented holder
    const hold = new THREE.Object3D();
    hold.position.copy(eqVec(m.ra, m.dec, R * 0.999)); hold.up.set(0, 0, 1);
    const saved = eqGroup.matrix.clone(); eqGroup.matrix.identity(); eqGroup.updateMatrixWorld(true);
    hold.lookAt(0, 0, 0);
    eqGroup.matrix.copy(saved); eqGroup.matrixWorldNeedsUpdate = true;
    mesh.rotation.z = m.rot * D2R; hold.add(mesh);
    hold.visible = $('imgs').checked; eqGroup.add(hold);
    n.img = hold; n.imgState = 2;
  }, undefined, () => { loading--; n.imgState = 3; });
}
async function loadImageIndex() {
  imgIndex = await fetch('/api/images').then((r) => r.json());
  const c = Object.keys(imgIndex).length;
  $('imgCount').textContent = c ? `(${c})` : '(0 – add files to images/)';
}

// ---------------------------------------------------------------- stars + constellations
const starUni = { uLim: { value: 6 }, uDay: { value: 0 }, uPR: { value: devicePixelRatio } };
const starGroup = new THREE.Group(), constGroup = new THREE.Group();
const starLabels = [];        // names of bright stars
eqGroup.add(starGroup, constGroup);
function bvColor(bv) {           // B−V → RGB (approx.)
  const t = Math.max(-0.4, Math.min(2, bv));
  const c = new THREE.Color();
  if (t < 0) c.setRGB(0.62, 0.72, 1); else if (t < 0.4) c.setRGB(0.8 + t * 0.5, 0.85 + t * 0.3, 1);
  else if (t < 0.8) c.setRGB(1, 0.97 - (t - 0.4) * 0.2, 0.9 - (t - 0.4) * 0.6);
  else c.setRGB(1, 0.85 - (t - 0.8) * 0.25, 0.6 - (t - 0.8) * 0.3);
  return c;
}
async function loadStars() {
  const [stars, cons, names] = await Promise.all(['stars', 'const', 'starnames'].map((f) => fetch(`/static/data/${f}.json`).then((r) => r.json())));
  for (const [ra, dec, mag, name, bayer] of names) {
    const lbl = rightOf(label(name || bayer, 'slbl'));
    lbl.position.copy(eqVec(ra, dec, R * 0.998)); lbl.visible = false;
    padLabel(lbl, 3 + Math.max(0, 3 - mag));
    starGroup.add(lbl);
    starLabels.push({ lbl, mag, name, bayer, full: name && bayer ? `${name} (${bayer})` : '' , mode: '' });
  }
  const pos = new Float32Array(stars.length * 3), col = new Float32Array(stars.length * 3), mag = new Float32Array(stars.length);
  stars.forEach(([ra, dec, m, bv], i) => {
    const v = eqVec(ra, dec, R * 0.998); pos.set([v.x, v.y, v.z], i * 3);
    const c = bvColor(bv); col.set([c.r, c.g, c.b], i * 3); mag[i] = m;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  starGroup.add(new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: starUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float mag; attribute vec3 color; uniform float uLim, uPR; varying vec3 vC; varying float vA;
      void main(){ vC = color; float d = uLim - mag;
        vA = d < 0.0 ? 0.0 : clamp(d * 0.8 + 0.25, 0.0, 1.0);
        gl_PointSize = d < 0.0 ? 0.0 : (1.4 + pow(max(d, 0.0), 1.15) * 0.9) * uPR;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uDay; varying vec3 vC; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
        float a = vA * (1.0 - smoothstep(0.35, 1.0, r)) * (1.0 - uDay);
        gl_FragColor = vec4(vC * a, a); }`,
  })));
  const m = new THREE.LineBasicMaterial({ color: 0x3f5f8f, transparent: true, opacity: 0.55 });
  for (const [, lines] of cons) for (const l of lines) {
    const pts = []; for (let i = 0; i < l.length; i++) {
      if (i) { const [a1, d1] = l[i - 1], [a2, d2] = l[i];   // subdivide long segments along the sphere
        for (let k = 1; k <= 8; k++) pts.push(new THREE.Vector3().lerpVectors(eqVec(a1, d1), eqVec(a2, d2), k / 8).setLength(R * 0.997)); }
      else pts.push(eqVec(l[0][0], l[0][1], R * 0.997));
    }
    constGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
  }
}

// ---------------------------------------------------------------- sky orientation
const tmpM = new THREE.Matrix4();
let lstNow = 0;
function updateSky() {
  const j = jd(S.time);
  lstNow = lstDeg(j, S.lon);
  const v = (ra, dec) => { const [alt, az] = altaz(ra, dec, S.lat, lstNow); return hzVec(alt, az, 1); };
  tmpM.makeBasis(v(0, 0), v(90, 0), v(0, 90));
  eqGroup.matrix.copy(tmpM); eqGroup.matrixWorldNeedsUpdate = true;

  const [sra, sdec] = sunRaDec(j), [mra, mdec] = moonRaDec(j);
  sun.position.copy(eqVec(sra, sdec, R * 0.985)); moon.position.copy(eqVec(mra, mdec, R * 0.985)); // behind the ground (0.97 R) → hidden below horizon
  planets(j).forEach((p, i) => { planetNodes[i].p = p; planetNodes[i].spr.position.copy(eqVec(p.ra, p.dec, R * 0.985)); });
  const ill = moonIllum(j);
  moonL.element.textContent = `Moon ${Math.round(ill * 100)}%`;
  moon.material.opacity = 0.35 + 0.65 * ill;

  const sAlt = altaz(sra, sdec, S.lat, lstNow)[0];
  const t = Math.max(0, Math.min(1, (sAlt + 18) / 24));      // −18° → 0, +6° → 1
  scene.background = new THREE.Color().lerpColors(new THREE.Color(0x020308), new THREE.Color(0x2d5c9a), t * t);
  starUni.uDay.value = Math.max(0, Math.min(0.97, (sAlt + 10) / 12));
  ground.material.color.setHex(sAlt > -6 ? 0x14180f : 0x080a07);
}

// ---------------------------------------------------------------- camera + controls
const drag = { on: false, x: 0, y: 0, moved: false };
const overlay = labelR.domElement;
overlay.addEventListener('pointerdown', (e) => { drag.on = true; drag.moved = false; drag.x = e.clientX; drag.y = e.clientY; });
addEventListener('pointerup', () => { drag.on = false; setTimeout(() => drag.moved = false, 0); });
addEventListener('pointermove', (e) => {
  if (!drag.on) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; S.track = false; }
  drag.x = e.clientX; drag.y = e.clientY;
  const k = camera.fov * D2R / sky.clientHeight;
  view.yaw += dx * k; view.pitch = Math.max(-0.2, Math.min(Math.PI / 2, view.pitch + dy * k));
});
overlay.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.fov = Math.max(0.15, Math.min(110, camera.fov * Math.exp(e.deltaY * 0.0012)));
  camera.updateProjectionMatrix();
}, { passive: false });

function aimAt(world) {
  view.yaw = Math.atan2(-world.x, -world.z);
  view.pitch = Math.asin(world.y / world.length());
}
function setFov(f) { camera.fov = f; camera.updateProjectionMatrix(); }
document.querySelectorAll('[data-look]').forEach((b) => b.onclick = () => {
  S.track = false; view.yaw = -b.dataset.look * D2R; view.pitch = 25 * D2R; setFov(Math.max(camera.fov, 70));
});
$('zenith').onclick = () => { S.track = false; view.pitch = Math.PI / 2 - 1e-4; setFov(Math.max(camera.fov, 100)); };
$('pole').onclick = () => {
  S.track = false; scene.updateMatrixWorld();
  aimAt(eqVec(0, S.lat >= 0 ? 90 : -90).applyMatrix4(eqGroup.matrixWorld)); setFov(Math.min(Math.max(camera.fov, 30), 60));
};
// celestial pole marker
{ const p = label('✛ NCP', 'glbl'); p.element.style.color = '#6f8fbf'; p.position.copy(eqVec(0, 90, R * 0.99)); eqGroup.add(p); gridLabels.push(p);
  const q = label('✛ SCP', 'glbl'); q.element.style.color = '#6f8fbf'; q.position.copy(eqVec(0, -90, R * 0.99)); eqGroup.add(q); gridLabels.push(q); }

function resize() {
  const w = sky.clientWidth, h = sky.clientHeight;
  renderer.setSize(w, h); labelR.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- render loop
const wp = new THREE.Vector3(), ndc = new THREE.Vector3();
let last = performance.now(), lastTableUpd = 0;
function frame(now) {
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
    const up = wp.y > -0.5;
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
    if (vis) vis = s.lbl.getWorldPosition(wp).y > 0;
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
    n.lbl.visible = showPl && showLbl && n.spr.getWorldPosition(wp).y > 0;
    padLabel(n.lbl, w * 0.45 / worldPerPx);
  }
  sunL.visible = showLbl && sun.getWorldPosition(wp).y > 0;
  moonL.visible = showLbl && moon.getWorldPosition(wp).y > 0;
  for (const l of gridLabels) l.visible = eqGrid.visible && l.getWorldPosition(wp).y > 0;

  declutter(H);
  drawFovBoxes(H);
  hud();
  renderer.render(scene, camera);
  labelR.render(scene, camera);
  requestAnimationFrame(frame);
}

const fovEls = new Map();
function buildFovBoxes() {
  const wrap = $('fovBoxes'); wrap.innerHTML = ''; fovEls.clear();
  const act = active();
  for (const st of S.setups) {
    if (st !== act && !st.show) continue;
    const el = document.createElement('div');
    el.className = 'fovBox' + (st === act ? '' : ' secondary');
    el.style.borderColor = st.color;
    const f = fovOf(st);
    el.innerHTML = `<span style="color:${st.color}">${st.name} · ${fmtAng(f.w)} × ${fmtAng(f.h)}</span>`;
    wrap.append(el); fovEls.set(st.id, el);
  }
}
// ---------------------------------------------------------------- label decluttering
// Greedy placement by priority (selected > planets > Sun/Moon > DSOs by size > stars by brightness);
// a label that would overlap an already placed one is hidden, like in Stellarium/KStars.
const measureCtx = document.createElement('canvas').getContext('2d');
function labelWidth(el) {
  const t = el.textContent;
  if (el._wText !== t) {
    const cs = getComputedStyle(el);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    el._w = measureCtx.measureText(t).width + 6; el._wText = t;
  }
  return el._w;
}
const lp = new THREE.Vector3();
function declutter(H) {
  const W = sky.clientWidth, cand = [];
  for (const n of nodes.values()) if (n.lbl.visible) cand.push([n.lbl, S.selected === n.o.id ? 1e6 : 3000 + n.o.maj + (n.o.id.startsWith('M') ? 50 : 0)]);
  for (const n of planetNodes) if (n.lbl.visible) cand.push([n.lbl, S.selected === 'P:' + n.name ? 1e6 : 9000 - n.p.mag]);
  for (const l of [sunL, moonL]) if (l.visible) cand.push([l, 8000]);
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

function drawFovBoxes(H) {
  const fpx = (H / 2) / Math.tan(camera.fov / 2 * D2R);
  for (const st of S.setups) {
    const el = fovEls.get(st.id); if (!el) continue;
    const f = fovOf(st), w = 2 * fpx * Math.tan(f.w / 2 * D2R), h = 2 * fpx * Math.tan(f.h / 2 * D2R);
    el.style.display = w > 6 && w < sky.clientWidth * 3 ? 'block' : 'none';
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${st.rot || 0}deg)`;
  }
}

function hud() {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const alt = Math.asin(d.y) / D2R, az = ((Math.atan2(d.x, -d.z) / D2R) + 360) % 360;
  // RA/Dec of the view center: inverse transform
  const e = d.clone().applyMatrix4(tmpM.clone().invert());
  const ra = Math.atan2(e.y, e.x) / D2R, dec = Math.asin(e.z) / D2R;
  $('hudTime').textContent = S.time.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + fmtDate(isoDate(S.time)) + ' ' + fmtT(S.time)
    + `   LST ${fmtRA(lstNow).replace(/ \d+s$/, '')}`;
  $('hudView').textContent = `Az ${az.toFixed(1)}°  Alt ${alt.toFixed(1)}°  |  RA ${fmtRA(ra)}  Dec ${fmtDec(dec)}  |  view ${camera.fov.toFixed(camera.fov < 5 ? 2 : 1)}°`;
}

// ---------------------------------------------------------------- time
function setWindowFromDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  S.windowStart = new Date(y, m - 1, d, 12, 0, 0);
}
function syncSlider() {
  const min = (S.time - S.windowStart) / 60000;
  if (min < 0 || min > 1440) {           // rolled over into another night
    const d = new Date(S.time); if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    setDate(isoDate(d)); loadVisibility();
  }
  $('slider').value = (S.time - S.windowStart) / 60000;
}
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

$('slider').oninput = () => { S.time = new Date(S.windowStart.getTime() + $('slider').value * 60000); renderTableSoon(); drawChart(); };
$('now').onclick = () => { S.time = new Date(); syncSlider(); renderTable(); drawChart(); };
$('play').onclick = () => { S.playing = !S.playing; $('play').textContent = S.playing ? '❚❚' : '▶'; };
// date: ISO (yyyy-mm-dd) internally, shown as dd-mm-yyyy
const fmtDate = (iso) => iso.split('-').reverse().join('-');
function setDate(iso) {
  $('date').value = iso; $('dateTxt').value = fmtDate(iso); $('dateTxt').classList.remove('bad');
  setWindowFromDate(iso);
}
function changeDate(iso) {
  setDate(iso);
  S.time = new Date(S.windowStart.getTime() + 10 * 3600000); // 22:00
  syncSlider(); drawNightBar(); loadVisibility();
}
$('date').onchange = () => { if ($('date').value) changeDate($('date').value); };
$('dateTxt').onchange = () => {
  const m = $('dateTxt').value.trim().match(/^(\d{1,2})[-.\/ ](\d{1,2})[-.\/ ](\d{4})$/);
  const d = m && new Date(+m[3], m[2] - 1, +m[1]);
  if (!d || d.getDate() !== +m[1] || d.getMonth() !== m[2] - 1) { $('dateTxt').classList.add('bad'); return; }
  changeDate(isoDate(d));
};
$('dPick').onclick = () => { try { $('date').showPicker(); } catch { $('date').focus(); } };
const shiftDate = (n) => { const d = new Date(S.windowStart); d.setDate(d.getDate() + n); changeDate(isoDate(d)); };
$('dPrev').onclick = () => shiftDate(-1);
$('dNext').onclick = () => shiftDate(1);

function drawNightBar() {
  const c = $('nightbar'), g = c.getContext('2d'), W = c.width;
  for (let x = 0; x < W; x++) {
    const t = new Date(S.windowStart.getTime() + x / W * 86400000), j = jd(t);
    const [ra, dec] = sunRaDec(j), a = altaz(ra, dec, S.lat, lstDeg(j, S.lon))[0];
    g.fillStyle = a > 0 ? '#3d6fb0' : a > -6 ? '#284a7a' : a > -12 ? '#183054' : a > -18 ? '#0e1b33' : '#03050b';
    g.fillRect(x, 0, 1, c.height);
  }
}

// ---------------------------------------------------------------- API data
async function loadCatalog() {
  const r = await fetch('/api/catalog').then((r) => r.json());
  S.catalog = r.objects; S.types = r.types;
  for (const [k, v] of Object.entries(r.types)) $('typeFilter').append(new Option(v, k));
  buildObjects();
}

let visReq = 0;
async function loadVisibility() {
  const id = ++visReq;
  const q = new URLSearchParams({ lat: S.lat, lon: S.lon, start: S.windowStart.toISOString(), min_alt: S.minAlt });
  const r = await fetch('/api/visibility?' + q).then((r) => r.json());
  if (id !== visReq) return;
  S.night = r.night; S.vis = Object.fromEntries(r.objects.map((o) => [o.id, o]));
  renderNight(); renderTable(); drawNightBar(); renderDetail();
}

function renderNight() {
  const n = S.night;
  const pl = S.planetRows = planetTable();
  $('nightInfo').innerHTML = `
    <div class="row"><span>Sunset <b>${fmtT(n.sun_dusk)}</b></span><span>Sunrise <b>${fmtT(n.sun_dawn)}</b></span></div>
    <div class="row"><span>Astro night <b>${fmtT(n.astro_dusk)}</b></span><span>to <b>${fmtT(n.astro_dawn)}</b></span><span>Dark <b>${n.dark_hours.toFixed(1)} h</b></span></div>
    <div class="row"><span>Moon ↑ <b>${fmtT(n.moon_rise)}</b> ↓ <b>${fmtT(n.moon_set)}</b></span><span>Illum. <b>${Math.round(n.moon_illum * 100)}% ${n.moon_waxing ? '(waxing)' : '(waning)'}</b></span></div>
    <details class="planets" ${store.get('plOpen', false) ? 'open' : ''}><summary>Planets</summary>
      <table><thead><tr><th>Planet</th><th>Mag</th><th>Size</th><th>Rise</th><th>Transit</th><th>Set</th><th>Max</th></tr></thead><tbody>
      ${pl.map((r) => `<tr data-planet="${r.name}"><td><span class="pdot" style="background:${PLANET_INFO[r.name].color}"></span><b>${r.name}</b></td><td>${r.mag.toFixed(1)}</td>
        <td>${r.diam.toFixed(r.diam < 10 ? 1 : 0)}″</td><td>${fmtT(r.rise)}</td><td>${fmtT(r.transit)}</td><td>${fmtT(r.set)}</td>
        <td class="${r.maxDark < S.minAlt ? 'down' : ''}" title="Max altitude during astronomical darkness">${r.maxDark > -90 ? r.maxDark.toFixed(0) + '°' : '—'}</td></tr>`).join('')}
      </tbody></table></details>`;
  $('nightInfo').querySelector('details').ontoggle = (e) => store.set('plOpen', e.target.open);
  $('nightInfo').querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr'); if (tr) gotoPlanet(tr.dataset.planet); };
}

// rise / transit / set of planets for the current night window (sampled every 10 min)
function planetTable() {
  const N = 144, t0 = S.windowStart.getTime(), rows = Object.keys(PLANET_INFO).map((name) => ({ name, alts: [], maxDark: -99 }));
  const times = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + i * 600000, j = jd(new Date(t)), l = lstDeg(j, S.lon);
    const [sra, sdec] = sunRaDec(j), dark = altaz(sra, sdec, S.lat, l)[0] <= -18;
    times.push(t);
    planets(j).forEach((p, k) => {
      const a = altaz(p.ra, p.dec, S.lat, l)[0]; rows[k].alts.push(a);
      if (dark) rows[k].maxDark = Math.max(rows[k].maxDark, a);
      if (i === N / 2) Object.assign(rows[k], { mag: p.mag, diam: p.diam });
    });
  }
  for (const r of rows) {
    let best = 0;
    for (let i = 0; i < N; i++) {
      const a0 = r.alts[i], a1 = r.alts[i + 1];
      if (a1 > r.alts[best]) best = i + 1;
      if ((a0 < 0) !== (a1 < 0)) {
        const t = new Date(times[i] + (times[i + 1] - times[i]) * a0 / (a0 - a1));
        if (a1 > a0) r.rise ??= t; else r.set ??= t;
      }
    }
    r.transit = r.alts[best] > 0 && best > 0 && best < N ? new Date(times[best]) : null;
  }
  return rows;
}

// ---------------------------------------------------------------- table
let tblTimer = 0;
const renderTableSoon = () => { clearTimeout(tblTimer); tblTimer = setTimeout(renderTable, 120); };
['search', 'typeFilter', 'onlyVisible', 'fitFov'].forEach((id) => $(id).addEventListener('input', renderTable));
document.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
  const k = th.dataset.sort; S.sort = [k, S.sort[0] === k ? -S.sort[1] : (k === 'id' || k === 'type' || k === 'transit' ? 1 : -1)];
  store.set('sort', S.sort); renderTable();
});

function rowData(o) {
  const f = fov(), v = S.vis[o.id] || {};
  const alt = altaz(o.ra, o.dec, S.lat, lstNow || lstDeg(jd(S.time), S.lon))[0];
  const short = Math.min(f.w, f.h) * 60;
  return { o, v, alt, fill: o.maj / short * 100, hours: v.hours ?? 0, transit: v.transit ? new Date(v.transit).getTime() : 0 };
}

function renderTable() {
  if (!S.catalog.length) return;
  lstNow = lstDeg(jd(S.time), S.lon);
  const q = $('search').value.trim().toLowerCase().replace(/\s+/g, ''), tf = $('typeFilter').value;
  const f = fov(), long = Math.max(f.w, f.h) * 60, short = Math.min(f.w, f.h) * 60;
  let rows = S.catalog.map(rowData).filter(({ o, v }) =>
    (!q || (o.id + o.name).toLowerCase().replace(/\s+/g, '').includes(q)) && (!tf || o.type === tf) &&
    (!$('onlyVisible').checked || v.hours > 0 || q) &&
    (!$('fitFov').checked || (o.maj <= long && o.min <= short)));
  const [k, dir] = S.sort;
  const key = { id: (r) => r.o.id, type: (r) => r.o.type, maj: (r) => r.o.maj, fill: (r) => r.fill, alt: (r) => r.alt, transit: (r) => r.transit, hours: (r) => r.hours }[k];
  rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dir || a.o.id.localeCompare(b.o.id, undefined, { numeric: true }); });
  $('list').tBodies[0].innerHTML = rows.map(({ o, v, alt, fill }) => `
    <tr data-id="${o.id}" class="${S.selected === o.id ? 'sel' : ''}">
      <td><b>${o.id}</b><span class="nm">${o.name || '&nbsp;'}</span></td>
      <td class="t-${o.type}">${o.type}</td>
      <td>${o.maj >= 1 ? o.maj.toFixed(0) : o.maj}′${o.min !== o.maj ? '×' + (o.min >= 1 ? o.min.toFixed(0) : o.min) + '′' : ''}</td>
      <td style="color:${fill > 100 ? '#f87171' : fill > 25 ? '#4ade80' : '#7d8aa3'}">${fill.toFixed(0)}%</td>
      <td class="${alt < 0 ? 'down' : ''}" style="${alt >= S.minAlt ? 'color:#4ade80' : ''}">${alt.toFixed(0)}°</td>
      <td>${fmtT(v.transit)}<span class="nm">max ${v.max_alt ?? '—'}°</span></td>
      <td>${(v.hours ?? 0).toFixed(1)}</td>
    </tr>`).join('');
}
$('list').tBodies[0].onclick = (e) => { const tr = e.target.closest('tr'); if (tr) select(tr.dataset.id, true); };

// ---------------------------------------------------------------- object detail
function select(id, center) {
  if (S.selected) selLabel(S.selected)?.element.classList.remove('sel');
  S.selected = id; S.track = false;
  selLabel(id).element.classList.add('sel');
  if (center) { scene.updateMatrixWorld(); sel3D(id).getWorldPosition(wp); aimAt(wp); frameFov(); }
  renderDetail(); renderTable();
}
function frameFov() {
  const f = fov(), o = S.selected && nodes.get(S.selected)?.o;
  const want = Math.max(f.h, f.w / camera.aspect, o ? o.maj / 60 : 0) * 1.8;
  camera.fov = Math.max(0.15, Math.min(110, want)); camera.updateProjectionMatrix();
}

function renderDetail() {
  const el = $('detail');
  if (!S.selected) { el.hidden = true; return; }
  if (planetOf(S.selected)) return renderPlanetDetail(el);
  const n = nodes.get(S.selected), o = n.o, v = S.vis[o.id] || {}, f = fov();
  const statusTxt = { circumpolar: 'circumpolar', never: 'never rises', normal: '' }[v.status] || '';
  el.hidden = false;
  el.innerHTML = `
    <h3>${o.id} ${o.name ? '– ' + o.name : ''}</h3>
    <div style="color:#7d8aa3;margin-bottom:4px"><span class="t-${o.type}">${S.types[o.type]}</span> · mag ${o.mag || '—'} · ${o.maj}′ × ${o.min}′ ${statusTxt ? '· ' + statusTxt : ''}</div>
    <div class="kv">
      <span>RA</span><b>${fmtRA(o.ra)}</b><span>Dec</span><b>${fmtDec(o.dec)}</b>
      <span>Rise</span><b>${fmtT(v.rise)}</b><span>Set</span><b>${fmtT(v.set)}</b>
      <span>Transit</span><b>${fmtT(v.transit)}</b><span>Max alt.</span><b>${v.max_alt ?? '—'}°</b>
      <span>Above ${S.minAlt}°</span><b>${fmtT(v.limit_rise)}</b><span>until</span><b>${fmtT(v.limit_set)}</b>
      <span>Dark window</span><b>${fmtT(v.window_start)}–${fmtT(v.window_end)}</b><span>Hours</span><b>${v.hours ?? 0} h (${v.moonless_hours ?? 0} moonless)</b>
      <span>Moon dist.</span><b>${v.moon_sep ?? '—'}°</b><span>In frame</span><b>${(o.maj / (Math.min(f.w, f.h) * 60) * 100).toFixed(0)}% of short side (${active().name})</b>
    </div>
    <canvas id="chart" width="840" height="240"></canvas>
    <div class="acts"><button id="bCenter">Center</button><button id="bTrack">${S.track ? 'Stop tracking' : 'Track'}</button><button id="bFrame">Zoom to FOV</button><button id="bClose">✕</button></div>`;
  $('bCenter').onclick = () => select(o.id, true);
  $('bTrack').onclick = () => { S.track = !S.track; renderDetail(); };
  $('bFrame').onclick = () => { S.track = true; frameFov(); renderDetail(); };
  $('bClose').onclick = () => { n.lbl.element.classList.remove('sel'); S.selected = null; S.track = false; renderDetail(); renderTable(); };
  drawChart();
}

function renderPlanetDetail(el) {
  const pn = planetOf(S.selected), p = planets(jd(S.time)).find((x) => x.name === pn.name);
  const r = (S.planetRows || []).find((x) => x.name === pn.name) || {}, f = fov();
  const ill = (1 + Math.cos(p.phase * D2R)) / 2;
  el.hidden = false;
  el.innerHTML = `
    <h3><span class="pdot" style="background:${PLANET_INFO[pn.name].color}"></span>${pn.name}</h3>
    <div style="color:var(--dim);margin-bottom:4px">Planet · mag ${p.mag.toFixed(1)} · ${p.diam.toFixed(1)}″ · ${Math.round(ill * 100)}% lit</div>
    <div class="kv">
      <span>RA</span><b>${fmtRA(p.ra)}</b><span>Dec</span><b>${fmtDec(p.dec)}</b>
      <span>Rise</span><b>${fmtT(r.rise)}</b><span>Set</span><b>${fmtT(r.set)}</b>
      <span>Transit</span><b>${fmtT(r.transit)}</b><span>Max (dark)</span><b>${r.maxDark > -90 ? r.maxDark.toFixed(0) + '°' : '—'}</b>
      <span>Distance</span><b>${p.dist.toFixed(3)} AU</b><span>From Sun</span><b>${p.r.toFixed(3)} AU</b>
      <span>Disc on sensor</span><b>${(p.diam / f.scale).toFixed(0)} px</b><span>Of short side</span><b>${(p.diam / 36 / Math.min(f.w, f.h)).toFixed(2)}%</b>
    </div>
    <canvas id="chart" width="840" height="240"></canvas>
    <div class="acts"><button id="bCenter">Center</button><button id="bTrack">${S.track ? 'Stop tracking' : 'Track'}</button><button id="bFrame">Zoom to FOV</button><button id="bClose">✕</button></div>`;
  $('bCenter').onclick = () => select(S.selected, true);
  $('bTrack').onclick = () => { S.track = !S.track; renderDetail(); };
  $('bFrame').onclick = () => { S.track = true; frameFov(); renderDetail(); };
  $('bClose').onclick = () => { pn.lbl.element.classList.remove('sel'); S.selected = null; S.track = false; renderDetail(); };
  drawChart();
}

function drawChart() {
  const c = $('chart'); if (!c || !S.selected) return;
  const id = S.selected, g = c.getContext('2d'), W = c.width, H = c.height;
  const t0 = S.windowStart.getTime() + 3 * 3600000, span = 18 * 3600000; // 15:00 → 09:00
  const yOf = (a) => H - 18 - (Math.max(-10, a) + 10) / 100 * (H - 28);
  g.clearRect(0, 0, W, H);
  const N = 216, obj = [], mo = [];
  for (let i = 0; i <= N; i++) {
    const t = new Date(t0 + span * i / N), j = jd(t), l = lstDeg(j, S.lon);
    const [sra, sdec] = sunRaDec(j), sa = altaz(sra, sdec, S.lat, l)[0];
    const x = i / N * W;
    g.fillStyle = sa > 0 ? '#1e3a63' : sa > -6 ? '#16294a' : sa > -12 ? '#0f1c36' : sa > -18 ? '#0a1224' : '#04060d';
    g.fillRect(x, 0, W / N + 1, H - 18);
    const [ora, odec] = selRaDec(id, j); obj.push([x, yOf(altaz(ora, odec, S.lat, l)[0])]);
    const [mra, mdec] = moonRaDec(j); mo.push([x, yOf(altaz(mra, mdec, S.lat, l)[0])]);
  }
  g.strokeStyle = '#2a3550'; g.lineWidth = 1; g.font = '18px system-ui'; g.fillStyle = '#7d8aa3';
  for (const a of [0, 30, 60, 90]) { g.beginPath(); g.moveTo(0, yOf(a)); g.lineTo(W, yOf(a)); g.stroke(); g.fillText(a + '°', 4, yOf(a) - 3); }
  g.setLineDash([6, 6]); g.strokeStyle = '#facc1588'; g.beginPath(); g.moveTo(0, yOf(S.minAlt)); g.lineTo(W, yOf(S.minAlt)); g.stroke();
  g.strokeStyle = '#cbd5e166'; g.lineWidth = 2; g.beginPath(); mo.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  g.setLineDash([]); g.strokeStyle = '#ff5a4e'; g.lineWidth = 3; g.beginPath(); obj.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  for (let h = 0; h <= 18; h += 3) {
    const t = new Date(t0 + h * 3600000); g.fillStyle = '#7d8aa3';
    g.fillText(t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), h / 18 * W - (h ? 22 : 0), H - 2);
  }
  const xn = (S.time.getTime() - t0) / span * W;
  if (xn >= 0 && xn <= W) { g.strokeStyle = '#4ade80'; g.lineWidth = 2; g.beginPath(); g.moveTo(xn, 0); g.lineTo(xn, H - 18); g.stroke(); }
}

// ---------------------------------------------------------------- settings
function bindNum(id, key, after) {
  $(id).value = S[key];
  $(id).onchange = () => { const v = parseFloat($(id).value); if (!isNaN(v)) { S[key] = v; store.set(key, v); after?.(); } };
}
const onLoc = () => { drawNightBar(); loadVisibility(); };
bindNum('lat', 'lat', onLoc); bindNum('lon', 'lon', onLoc);
const onOptics = () => { updateFovInfo(); renderSetupSelect(); buildFovBoxes(); renderTable(); renderDetail(); };
$('minalt').value = S.minAlt; $('minalt').onchange = () => { S.minAlt = +$('minalt').value; store.set('minAlt', S.minAlt); loadVisibility(); };

function updateFovInfo() {
  const f = fov();
  $('fovInfo').textContent = `FOV ${fmtAng(f.w)} × ${fmtAng(f.h)} · ${f.scale.toFixed(2)}″/px · ${Math.round(f.F)} mm${f.fr ? ' f/' + f.fr.toFixed(1) : ''}`;
}
function renderSetupSelect() {
  const sel = $('setup'); sel.innerHTML = '';
  for (const st of S.setups) sel.append(new Option(st.name || '(unnamed)', st.id));
  sel.value = active().id;
}
$('setup').onchange = () => { S.active = $('setup').value; saveSetups(); onOptics(); };

// equipment dialog
let editing = null;
const FIELDS = ['name', 'focal', 'reducer', 'aperture', 'sw', 'sh', 'px', 'rot', 'color', 'show'];
function openEquipment() { editing = active().id; renderDlg(); $('eqDlg').showModal(); }
$('eqBtn').onclick = openEquipment;
function renderDlg() {
  const cur = S.setups.find((s) => s.id === editing) || S.setups[0]; editing = cur.id;
  $('setupList').innerHTML = S.setups.map((st) => {
    const f = fovOf(st);
    return `<li data-id="${st.id}" class="${st.id === editing ? 'cur' : ''}"><span class="sw" style="background:${st.color}"></span>
      <div>${st.name || '(unnamed)'}<small>${Math.round(f.F)} mm · ${fmtAng(f.w)} × ${fmtAng(f.h)}</small></div>
      ${st.id === active().id ? '<span class="act">active</span>' : ''}</li>`;
  }).join('');
  for (const k of FIELDS) { const el = $('f_' + k); if (el.type === 'checkbox') el.checked = !!cur[k]; else el.value = cur[k] ?? ''; }
  const preset = [...$('f_preset').options].find((o) => o.value === `${cur.sw},${cur.sh},${cur.px}`);
  $('f_preset').value = preset ? preset.value : '';
  renderComputed(cur);
  $('delSetup').disabled = S.setups.length < 2;
}
function renderComputed(st) {
  const f = fovOf(st), diag = Math.hypot(f.w, f.h);
  $('f_computed').innerHTML = `Effective focal length <b>${f.F.toFixed(0)} mm</b>${f.fr ? ` · <b>f/${f.fr.toFixed(2)}</b>` : ''}<br>
    Field of view <b>${fmtAng(f.w)} × ${fmtAng(f.h)}</b> (diagonal ${fmtAng(diag)})<br>
    Image scale <b>${f.scale.toFixed(2)}″/px</b> · ${Math.round(st.sw * 1000 / st.px)} × ${Math.round(st.sh * 1000 / st.px)} px`;
}
$('setupList').onclick = (e) => { const li = e.target.closest('li'); if (li) { editing = li.dataset.id; renderDlg(); } };
for (const k of FIELDS) $('f_' + k).addEventListener('input', () => {
  const st = S.setups.find((s) => s.id === editing), el = $('f_' + k);
  if (el.type === 'checkbox') st[k] = el.checked;
  else if (el.type === 'number') { const v = parseFloat(el.value); if (isNaN(v) || (k !== 'rot' && v <= 0)) return; st[k] = v; }
  else st[k] = el.value;
  if (['sw', 'sh', 'px'].includes(k)) $('f_preset').value = '';
  saveSetups(); renderDlg(); onOptics();
});
$('f_preset').onchange = () => {
  if (!$('f_preset').value) return;
  const st = S.setups.find((s) => s.id === editing);
  [st.sw, st.sh, st.px] = $('f_preset').value.split(',').map(Number);
  saveSetups(); renderDlg(); onOptics();
};
$('addSetup').onclick = () => {
  const st = { id: uid(), name: 'New setup', focal: 500, reducer: 1, aperture: 100, sw: 23.5, sh: 15.7, px: 3.76, rot: 0,
    color: COLORS[S.setups.length % COLORS.length], show: false };
  S.setups.push(st); editing = st.id; saveSetups(); renderDlg(); onOptics(); $('f_name').select();
};
$('dupSetup').onclick = () => {
  const src = S.setups.find((s) => s.id === editing);
  const st = { ...src, id: uid(), name: src.name + ' (copy)', color: COLORS[S.setups.length % COLORS.length] };
  S.setups.push(st); editing = st.id; saveSetups(); renderDlg(); onOptics();
};
$('delSetup').onclick = () => {
  if (S.setups.length < 2) return;
  const st = S.setups.find((s) => s.id === editing);
  if (!confirm(`Delete setup "${st.name}"?`)) return;
  S.setups = S.setups.filter((s) => s !== st);
  if (S.active === st.id) S.active = S.setups[0].id;
  editing = S.setups[0].id; saveSetups(); renderDlg(); onOptics();
};
$('useSetup').onclick = () => { S.active = editing; saveSetups(); renderDlg(); onOptics(); };

$('geo').onclick = () => navigator.geolocation?.getCurrentPosition((p) => {
  S.lat = +p.coords.latitude.toFixed(4); S.lon = +p.coords.longitude.toFixed(4);
  $('lat').value = S.lat; $('lon').value = S.lon; store.set('lat', S.lat); store.set('lon', S.lon); onLoc();
});
$('stars').onchange = () => { starGroup.visible = $('stars').checked; store.set('stars', $('stars').checked); };
$('starNames').checked = store.get('starNames', true);
$('planets').checked = store.get('planets', true);
$('planets').onchange = () => store.set('planets', $('planets').checked);
$('starNames').onchange = () => store.set('starNames', $('starNames').checked);
$('const').onchange = () => { constGroup.visible = $('const').checked; store.set('const', $('const').checked); };
$('starMag').value = store.get('starMag', 6); $('starMagV').textContent = $('starMag').value;
$('starMag').oninput = () => { $('starMagV').textContent = $('starMag').value; store.set('starMag', +$('starMag').value); };
$('stars').checked = starGroup.visible = store.get('stars', true);
$('const').checked = constGroup.visible = store.get('const', true);
$('grid').onchange = () => eqGrid.visible = $('grid').checked;
$('azgrid').onchange = () => azGrid.visible = $('azgrid').checked;
azGrid.visible = false;

// ---------------------------------------------------------------- theme
const THEMES = ['dark', 'light', 'red'];
function setTheme(t) {
  if (!THEMES.includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t; $('theme').value = t; store.set('theme', t);
  drawChart();
}
$('theme').onchange = () => setTheme($('theme').value);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  setTheme(THEMES[(THEMES.indexOf($('theme').value) + 1) % THEMES.length]);
});
setTheme(store.get('theme', 'dark'));

// ---------------------------------------------------------------- start
(async function init() {
  const now = new Date(), d = new Date(now); if (now.getHours() < 12) d.setDate(d.getDate() - 1);
  setDate(isoDate(d));
  S.time = now; syncSlider();
  updateFovInfo(); renderSetupSelect(); buildFovBoxes(); resize(); drawNightBar();
  loadStars(); loadImageIndex();
  await loadCatalog();
  await loadVisibility();
  requestAnimationFrame(frame);
})();
