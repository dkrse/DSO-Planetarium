import { invalidate } from './loop.js';
import * as THREE from 'three';
import { D2R, PLANET_INFO, bodies } from '../astro.js';
import { $, R, S } from './core.js';
import { select } from './panels.js';
import { disc, eqGroup, freeze, updateVisibleChildren, eqVec, label, moon, moonL, padLabel, rightOf, sun, sunL } from './scene.js';

// ---------------------------------------------------------------- planets
export let planetNodes;
export const gotoPlanet = (name) => select('P:' + name, true);
// selection can be a DSO id ("M31") or a solar-system body ("P:Jupiter", "P:Sun", "P:Moon")
export const BODY_NAMES = ['Sun', 'Moon', ...Object.keys(PLANET_INFO)];
export function planetOf(id) {
  if (!id?.startsWith('P:')) return null;
  const name = id.slice(2);
  if (name === 'Sun') return { name, spr: sun, lbl: sunL };
  if (name === 'Moon') return { name, spr: moon, lbl: moonL };
  return planetNodes.find((x) => x.name === name) ?? null;
}
export const sel3D = (id) => planetOf(id)?.spr ?? nodes.get(id)?.holder;
export const selLabel = (id) => (planetOf(id) ?? nodes.get(id))?.lbl;
export function selRaDec(id, j) {
  const pn = planetOf(id);
  if (pn) { const p = bodies(j).find((x) => x.name === pn.name); return [p.ra, p.dec]; }
  const o = nodes.get(id).o; return [o.ra, o.dec];
}

// ---------------------------------------------------------------- DSO objects
export const TYPE_COLOR = { G: 0xf0a3ff, GC: 0xffd37a, OC: 0x9be7ff, EN: 0xff7b7b, RN: 0x7bb4ff, PN: 0x7bffb7, SNR: 0xffa65c, DN: 0xa0a0a0, AST: 0xcccccc };
export const nodes = new Map();

export function ellipse(a, b, segs = 64) {
  const p = []; for (let i = 0; i <= segs; i++) { const t = i / segs * Math.PI * 2; p.push(new THREE.Vector3(b * Math.sin(t), a * Math.cos(t), 0)); }
  return new THREE.BufferGeometry().setFromPoints(p);
}

/** Remove all deep-sky objects from the scene (before rebuilding with another set of catalogs). */
export function clearObjects() {
  for (const n of nodes.values()) {
    eqGroup.remove(n.holder); n.lbl.element.remove();
    n.outline.geometry.dispose(); n.outline.material.dispose();
    if (n.img) { eqGroup.remove(n.img); n.img.traverse((x) => { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose(); }); }
  }
  nodes.clear();
}

export function buildObjects() {
  // orient the object holders in the J2000 frame: lookAt() needs eqGroup to be identity for a moment
  const saved = eqGroup.matrix.clone(); eqGroup.matrix.identity(); eqGroup.updateMatrixWorld(true);
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
    eqGroup.add(holder); freeze(holder);
    nodes.set(o.id, { o, holder, outline, lbl, a, img: null, imgState: 0, messier: /^M\d+$/.test(o.id) });
  }
  eqGroup.matrix.copy(saved); eqGroup.matrixWorldNeedsUpdate = true;
  invalidate();
}

// local images from images/ (loaded lazily when zoomed in)
export const texLoader = new THREE.TextureLoader(); 
export let loading = 0;
export let imgIndex = {};
export function loadImage(n) {
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
    hold.visible = $('imgs').checked; eqGroup.add(hold); freeze(hold);
    n.img = hold; n.imgState = 2; invalidate();
  }, undefined, () => { loading--; n.imgState = 3; });
}
export async function loadImageIndex() {
  imgIndex = await fetch('/api/images').then((r) => r.json());
  const c = Object.keys(imgIndex).length;
  $('imgCount').textContent = c ? `(${c})` : '(0 – add files to images/)';
}

// ---------------------------------------------------------------- stars + constellations
export const starUni = { uLim: { value: 6 }, uDay: { value: 0 }, uPR: { value: devicePixelRatio } };
export const starGroup = new THREE.Group(), constGroup = new THREE.Group();
export const starLabels = [];        // names of bright stars

export function bvColor(bv) {           // B−V → RGB (approx.)
  const t = Math.max(-0.4, Math.min(2, bv));
  const c = new THREE.Color();
  if (t < 0) c.setRGB(0.62, 0.72, 1); else if (t < 0.4) c.setRGB(0.8 + t * 0.5, 0.85 + t * 0.3, 1);
  else if (t < 0.8) c.setRGB(1, 0.97 - (t - 0.4) * 0.2, 0.9 - (t - 0.4) * 0.6);
  else c.setRGB(1, 0.85 - (t - 0.8) * 0.25, 0.6 - (t - 0.8) * 0.3);
  return c;
}
export async function loadStars() {
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
  freeze(starGroup); freeze(constGroup);
  updateVisibleChildren(starGroup);               // 900 star-name labels: only the shown ones are updated
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  planetNodes = Object.entries(PLANET_INFO).map(([name, info]) => {
    const spr = disc(info.color, 1);
    const lbl = rightOf(label(name, 'plbl', () => gotoPlanet(name)));
    spr.add(lbl); eqGroup.add(spr);
    return { name, spr, lbl, p: null };
  });
  texLoader.crossOrigin = 'anonymous';
  eqGroup.add(starGroup, constGroup);
}
