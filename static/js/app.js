// UI: loads the data, wires the controls, keeps the view state, shows object details.
import * as A from './astro.js';
import { Sky } from './sky.js';

const $ = (s) => document.querySelector(s);
const KEY = 'dso.planetarium.v2';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const saved = load();
let saveTimer = 0;

async function getJSON(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json();
}

const [stars, dso, cons, eph] = await Promise.all(['stars', 'dso', 'constellations', 'ephemeris']
  .map((n) => getJSON(`/static/data/${n}.json`)));
A.setEphemeris(eph);

const canvas = $('#sky'), sky = new Sky(canvas, { stars, dso, cons });
const P = sky.proj;
Object.assign(sky.opt, saved.opt || {});
if (saved.view) Object.assign(P, saved.view);
if (saved.lat != null) { sky.lat = saved.lat; sky.lon = saved.lon; }
if (saved.panelHidden) document.body.classList.add('panel-hidden');
P.update();
$('#loading').remove();

let lastInfo = 0, infoTime = 0, infoLoc = '';
let dirty = true, playing = false, lastTick = 0, followNow = saved.time == null;
sky.time = followNow ? new Date() : new Date(saved.time);
const redraw = () => { dirty = true; };
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        opt: sky.opt, view: { mode: P.mode, lon: P.lon, lat: P.lat, fov: P.fov }, lat: sky.lat, lon: sky.lon,
        panelHidden: document.body.classList.contains('panel-hidden'), time: followNow ? null : sky.time.getTime(),
      }));
    } catch { /* storage unavailable: settings are just not remembered */ }
  }, 300);
}

// ---------------------------------------------------------------- render loop
function frame(t) {
  if (playing) {
    const dt = lastTick ? t - lastTick : 0; lastTick = t;
    sky.time = new Date(sky.time.getTime() + dt * 60); dirty = true; showTime();
  } else if (followNow && Date.now() - sky.time.getTime() > 1000) { sky.time = new Date(); dirty = true; showTime(); }
  if (dirty) {
    dirty = false; sky.draw(); hud();
    // the details depend on time and place only, not on panning / zooming: rebuild at most 4× per second
    if (sky.selected && !document.body.classList.contains('panel-hidden') && t - lastInfo > 250
      && (sky.time.getTime() !== infoTime || infoLoc !== `${sky.lat},${sky.lon},${sky.opt.refraction}`)) { lastInfo = t; refreshInfo(); }
  }
  requestAnimationFrame(frame);
}
function resize() { sky.resize(); redraw(); }
new ResizeObserver(resize).observe($('#skywrap'));

// ---------------------------------------------------------------- HUD
let mouse = null;
function hud() {
  $('#hudFov').textContent = `FOV ${fmtFov(P.fov)} · ${P.mode === 'altaz' ? 'Alt/Az' : 'Equatorial'}`;
  if (!mouse) { $('#hudPos').textContent = ''; return; }
  const v = P.unproject(mouse[0], mouse[1]);
  const [ra, dec] = sky.viewToJ2000(v), [alt, az] = sky.viewToAltAz(v);
  $('#hudPos').textContent = `RA ${A.fmtRA(ra)}  Dec ${A.fmtDec(dec)} (J2000)   Alt ${alt.toFixed(2)}°  Az ${az.toFixed(2)}°`;
}
const fmtFov = (f) => f >= 1 ? `${f.toFixed(1)}°` : `${(f * 60).toFixed(1)}′`;

// ---------------------------------------------------------------- mouse / keyboard navigation
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.offsetX, y: e.offsetY, moved: false, v: P.unproject(e.offsetX, e.offsetY) };
  canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', (e) => {
  mouse = [e.offsetX, e.offsetY];
  if (drag) {
    if (Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > 3) drag.moved = true;
    if (drag.moved) { grabTo(drag.v, e.offsetX, e.offsetY); redraw(); }
  } else hud();   // only the cursor readout changes
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('drag');
  if (drag && !drag.moved) select(sky.pick(e.offsetX, e.offsetY));
  drag = null; persist();
});
canvas.addEventListener('pointerleave', () => { mouse = null; hud(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  P.zoomAt(Math.pow(1.0015, e.deltaY * (e.deltaMode ? 30 : 1)), e.offsetX, e.offsetY); redraw(); persist();
}, { passive: false });
/** Keep the sky point `v` under the cursor while dragging (exact "grab" navigation). */
function grabTo(v, x, y) {
  for (let i = 0; i < 4; i++) {
    const [l0, b0] = P.lonLatOf(v), [l1, b1] = P.lonLatOf(P.unproject(x, y));
    let dl = l0 - l1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    P.lon += dl; P.lat += b0 - b1; P.update();
  }
}
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const step = P.fov * (e.shiftKey ? 0.02 : 0.1), s = P.mode === 'altaz' ? 1 : -1;
  const k = e.key;
  if (k === 'ArrowLeft') P.lon -= s * step / Math.max(0.2, Math.cos(P.lat * A.D2R));
  else if (k === 'ArrowRight') P.lon += s * step / Math.max(0.2, Math.cos(P.lat * A.D2R));
  else if (k === 'ArrowUp') P.lat += step;
  else if (k === 'ArrowDown') P.lat -= step;
  else if (k === '+' || k === '=') P.fov /= 1.25;
  else if (k === '-') P.fov *= 1.25;
  else if (k === 'p' || k === 'P') { togglePanel(); return; }
  else if (k === 'Escape') { select(null); return; }
  else return;
  e.preventDefault(); P.update(); redraw(); persist();
});

// ---------------------------------------------------------------- header controls
document.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
  setMode('altaz'); P.lon = +b.dataset.look; P.lat = 20; P.fov = Math.max(P.fov, 60); P.update(); redraw(); persist();
}));
$('#zenith').addEventListener('click', () => { setMode('altaz'); P.lat = 90; P.fov = Math.max(P.fov, 100); P.update(); redraw(); persist(); });
$('#mode').value = P.mode;
$('#mode').addEventListener('change', (e) => setMode(e.target.value));
function setMode(m) {
  if (m === P.mode) return;
  sky.computeFrame();
  // keep the same sky point in the centre
  const c = P.c, F = sky.F;
  const v = m === 'eq' ? A.apply(A.transpose(F.H), sky.opt.refraction ? A.unrefract(c) : c)
    : (sky.opt.refraction ? A.refract(A.apply(F.H, c)) : A.apply(F.H, c));
  P.mode = m; P.lookAt(v); $('#mode').value = m; redraw(); persist();
}
function togglePanel() {
  document.body.classList.toggle('panel-hidden'); infoTime = 0;
  $('#panelToggle').classList.toggle('on', !document.body.classList.contains('panel-hidden'));
  persist();
}
$('#panelToggle').addEventListener('click', togglePanel);
$('#panelToggle').classList.toggle('on', !document.body.classList.contains('panel-hidden'));

// time
const pad = (n) => String(n).padStart(2, '0');
function showTime() {
  const d = sky.time;
  $('#dt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('#now').classList.toggle('on', followNow);
}
$('#dt').addEventListener('change', (e) => {
  const d = new Date(e.target.value); if (isNaN(d)) return;
  followNow = false; sky.time = d; showTime(); redraw(); persist();
});
$('#now').addEventListener('click', () => { followNow = true; playing = false; $('#play').textContent = '▶'; sky.time = new Date(); showTime(); redraw(); persist(); });
document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
  followNow = false; sky.time = new Date(sky.time.getTime() + b.dataset.step * 60000); showTime(); redraw(); persist();
}));
$('#play').addEventListener('click', () => {
  playing = !playing; followNow = false; lastTick = 0; $('#play').textContent = playing ? '⏸' : '▶'; $('#play').classList.toggle('on', playing); persist();
});

// display options
document.querySelectorAll('[data-opt]').forEach((cb) => {
  cb.checked = !!sky.opt[cb.dataset.opt];
  cb.addEventListener('change', () => { sky.opt[cb.dataset.opt] = cb.checked; redraw(); persist(); });
});
const range = (id, key, label, fmt) => {
  const el = $(id); el.value = sky.opt[key];
  const show = () => { $(label).textContent = fmt(sky.opt[key]); };
  el.addEventListener('input', () => { sky.opt[key] = +el.value; show(); redraw(); persist(); }); show();
};
range('#magBoost', 'magBoost', '#magVal', (v) => (v > 0 ? '+' : '') + v);
range('#dsoMag', 'dsoMagLimit', '#dsoMagVal', (v) => `≤ ${v}`);

// location
$('#lat').value = sky.lat; $('#lon').value = sky.lon;
const setLoc = () => {
  const la = +$('#lat').value, lo = +$('#lon').value;
  if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) return;
  sky.lat = la; sky.lon = lo; redraw(); persist();
};
$('#lat').addEventListener('change', setLoc); $('#lon').addEventListener('change', setLoc);
$('#geo').addEventListener('click', () => navigator.geolocation?.getCurrentPosition((p) => {
  $('#lat').value = p.coords.latitude.toFixed(4); $('#lon').value = p.coords.longitude.toFixed(4); setLoc();
}));

// ---------------------------------------------------------------- search
const norm = (s) => s.toLowerCase().replace(/[\s\-_.']/g, '');
const index = [];
for (const o of sky.dso) {
  for (const k of [o.id, ...o.ids, ...o.names]) index.push([norm(k), k, o]);
}
stars.stars.forEach((s, i) => { const n = stars.names[s[0]]; if (n) index.push([norm(n), n, { kind: 'star', index: i }]); });
for (const b of ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) index.push([norm(b), b, { kind: 'body', name: b }]);
for (const c of sky.constCentres) index.push([norm(c.name), c.name, { kind: 'const', id: c.id, name: c.name, v: c.v }]);

let results = [];
$('#search').addEventListener('input', (e) => {
  const q = norm(e.target.value); results = [];
  if (q.length) {
    const seen = new Set(), scored = [];
    for (const [k, label, obj] of index) {
      const i = k.indexOf(q); if (i < 0) continue;
      const score = (k === q ? 0 : i === 0 ? 1 : 2) + k.length / 100;
      scored.push([score, label, obj]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    for (const [, label, obj] of scored) { if (seen.has(obj)) continue; seen.add(obj); results.push([label, obj]); if (results.length >= 40) break; }
  }
  $('#results').innerHTML = '';
  results.forEach(([label, obj], i) => {
    const li = document.createElement('li');
    const main = document.createElement('span'); main.textContent = label + (obj.kind === 'dso' && label !== obj.id ? ` (${obj.id})` : '');
    const t = document.createElement('span'); t.className = 't'; t.textContent = kindLabel(obj);
    li.append(main, t); li.addEventListener('click', () => goTo(obj));
    if (i === 0) li.classList.add('active');
    $('#results').append(li);
  });
});
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && results[0]) goTo(results[0][1]); });
const kindLabel = (o) => o.kind === 'dso' ? o.typeName : o.kind === 'star' ? 'Star' : o.kind === 'body' ? (o.name === 'Sun' || o.name === 'Moon' ? o.name : 'Planet') : 'Constellation';

function goTo(obj) {
  sky.computeFrame();
  if (obj.kind === 'const') { P.lookAt(sky.toView(obj.v)); P.fov = Math.max(P.fov, 40); P.update(); redraw(); persist(); return; }
  const v = sky.viewVectorOf(obj); if (!v) return;
  P.lookAt(v);
  if (obj.kind === 'dso' && obj.maj) P.fov = Math.min(60, Math.max(0.3, obj.maj / 60 * 3));
  else if (obj.kind === 'body' && (obj.name === 'Moon' || obj.name === 'Sun')) P.fov = 2;
  else if (P.fov > 60) P.fov = 30;
  P.update(); select(obj); persist();
}

// ---------------------------------------------------------------- selection & details
function select(obj) { sky.selected = obj; redraw(); refreshInfo(); }

let infoKey = '';
function refreshInfo() {
  const o = sky.selected, el = $('#info');
  if (!o) { el.innerHTML = '<p class="muted">Click an object on the sky or search for one.</p>'; infoKey = ''; return; }
  infoTime = sky.time.getTime(); infoLoc = `${sky.lat},${sky.lon},${sky.opt.refraction}`;
  const F = sky.F, rows = [];
  let title = '', sub = '', uDate, h0 = -0.5667, catalogue = null;
  if (o.kind === 'dso') {
    title = o.id + (o.names.length ? ` — ${o.names[0]}` : '');
    sub = `${o.typeName}${o.hubble ? ` (${o.hubble})` : ''} in ${o.con}`;
    if (o.ids.length) rows.push(['Also', o.ids.join(', ')]);
    if (o.names.length > 1) rows.push(['Names', o.names.join(', ')]);
    rows.push(['Magnitude', o.mag != null ? `${o.mag.toFixed(1)} (${o.band})` : '—']);
    if (o.sb != null) rows.push(['Surface brightness', `${o.sb.toFixed(2)} mag/arcsec²`]);
    rows.push(['Size', o.maj ? `${fmtArc(o.maj)}${o.min ? ` × ${fmtArc(o.min)}` : ''}` : 'not catalogued']);
    rows.push(['Position angle', o.pa != null ? `${o.pa}°` : (o.maj && o.min && o.min !== o.maj ? 'not catalogued (drawn as circle)' : '—')]);
    rows.push(['RA / Dec J2000', `${A.fmtRA(o.ra)}  ${A.fmtDec(o.dec)}`]);
    uDate = A.apply(F.NP, o.vApp); catalogue = (G) => A.catalogueToDate(G, o.ra, o.dec);
    rows.push(['Source', 'OpenNGC']);
  } else if (o.kind === 'star') {
    const s = stars.stars[o.index], name = stars.names[s[0]];
    title = name || `HIP ${s[0]}`; sub = 'Star';
    rows.push(['Hipparcos', `HIP ${s[0]}`], ['V magnitude', s[5].toFixed(2)], ['B − V', s[6] != null ? s[6].toFixed(2) : '—']);
    rows.push(['Proper motion', `${s[3]} / ${s[4]} mas/yr`]);
    rows.push(['RA / Dec J2000', `${A.fmtRA(s[1])}  ${A.fmtDec(s[2])}`]);
    uDate = A.catalogueToDate(F, s[1], s[2], s[3], s[4]); catalogue = (G) => A.catalogueToDate(G, s[1], s[2], s[3], s[4]);
    rows.push(['Source', 'Hipparcos (ESA 1997)']);
  } else if (o.kind === 'body') {
    const b = sky.bodies.find((x) => x.name === o.name);
    title = o.name; sub = o.name === 'Sun' ? 'Star' : o.name === 'Moon' ? 'Moon' : 'Planet';
    rows.push(['Magnitude', b.mag.toFixed(1)], ['Apparent diameter', fmtArc(b.diam / 60)]);
    if (o.name !== 'Sun') rows.push(['Illuminated', `${(b.illum * 100).toFixed(0)} %`]);
    rows.push(['Distance', o.name === 'Moon' ? `${Math.round(b.dist * 149597870.7).toLocaleString()} km` : `${b.dist.toFixed(4)} AU`]);
    rows.push(['RA / Dec J2000', `${A.fmtRA(b.raJ)}  ${A.fmtDec(b.decJ)}`]);
    uDate = b.u;
    if (o.name === 'Sun' || o.name === 'Moon') h0 = -0.5667 - b.diam / 7200;
    catalogue = (G) => A.bodies(G).find((x) => x.name === o.name).u;
  }
  const [rad, decd] = A.radec(uDate);
  rows.push(['RA / Dec of date', `${A.fmtRA(rad)}  ${A.fmtDec(decd)}`]);
  const hz = A.apply(F.H, uDate), [alt, az] = A.altaz(sky.opt.refraction ? A.refract(hz) : hz);
  rows.push(['Altitude / Azimuth', `${alt.toFixed(2)}° / ${az.toFixed(2)}°${sky.opt.refraction ? ' (refracted)' : ''}`]);
  rows.push(['Hour angle', `${(((F.lst - rad) % 360 + 540) % 360 - 180) / 15 >= 0 ? '+' : ''}${((((F.lst - rad) % 360 + 540) % 360 - 180) / 15).toFixed(2)} h`]);
  // rise / transit / set are recomputed only when the object or the hour changes
  const key = `${title}|${Math.floor(sky.time.getTime() / 600000)}|${sky.lat}|${sky.lon}`;
  if (key !== infoKey) { infoKey = key; o._rts = A.riseTransitSet(catalogue, h0, sky.time, sky.lat, sky.lon); }
  const r = o._rts, tf = (d) => d ? d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  rows.push(['Rise', r.circ ? 'circumpolar' : r.never ? 'never rises' : tf(r.rise)], ['Transit', `${tf(r.transit)}${r.maxAlt != null ? ` (${r.maxAlt.toFixed(1)}°)` : ''}`], ['Set', r.circ || r.never ? '—' : tf(r.set)]);
  el.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = title;
  const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub;
  const t = document.createElement('table');
  for (const [k, v] of rows) { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
  const act = document.createElement('div'); act.className = 'actions';
  const bc = document.createElement('button'); bc.textContent = 'Centre'; bc.onclick = () => { P.lookAt(sky.viewVectorOf(o)); redraw(); persist(); };
  const bx = document.createElement('button'); bx.textContent = 'Clear'; bx.onclick = () => select(null);
  act.append(bc, bx);
  el.append(h, s, t, act);
}
const fmtArc = (arcmin) => arcmin >= 60 ? `${(arcmin / 60).toFixed(2)}°` : arcmin >= 1 ? `${arcmin.toFixed(1)}′` : `${(arcmin * 60).toFixed(1)}″`;

showTime();
requestAnimationFrame(frame);
window.__dso = { sky, A };
