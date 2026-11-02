import { D2R, PLANET_INFO, altaz, fmtDec, fmtRA, jd, lstDeg, moonRaDec, planets, precess, sunRaDec } from '../astro.js';
import { $, S, active, fmtT, fov, store } from './core.js';
import { horizonAlt } from './horizon.js';
import { frameGeom } from './framing.js';
import { wp } from './loop.js';
import { buildObjects, gotoPlanet, nodes, planetOf, sel3D, selLabel, selRaDec } from './objects.js';
import { aimAt, camera, scene } from './scene.js';
import { renderTargets } from './targets.js';
import { drawNightBar } from './time.js';

// ---------------------------------------------------------------- API data
export async function loadCatalog() {
  const r = await fetch('/api/catalog').then((r) => r.json());
  S.catalog = r.objects; S.types = r.types;
  for (const [k, v] of Object.entries(r.types)) $('typeFilter').append(new Option(v, k));
  buildObjects();
}

export let visReq = 0;
export async function loadVisibility() {
  const id = ++visReq;
  const q = new URLSearchParams({ lat: S.lat, lon: S.lon, start: S.windowStart.toISOString(), min_alt: S.minAlt });
  const r = await fetch('/api/visibility?' + q).then((r) => r.json());
  if (id !== visReq) return;
  S.night = r.night; S.vis = Object.fromEntries(r.objects.map((o) => [o.id, o]));
  renderNight(); renderTable(); drawNightBar(); renderDetail(); renderTargets();
}

export function renderNight() {
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
export function planetTable() {
  const N = 144, t0 = S.windowStart.getTime(), rows = Object.keys(PLANET_INFO).map((name) => ({ name, alts: [], maxDark: -99 }));
  const times = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + i * 600000, j = jd(new Date(t)), l = lstDeg(j, S.lon);
    const [sra, sdec] = sunRaDec(j), dark = altaz(sra, sdec, S.lat, l)[0] <= -18;
    times.push(t);
    planets(j).forEach((p, k) => {
      const a = altaz(...precess(p.ra, p.dec, j), S.lat, l)[0]; rows[k].alts.push(a);
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
export let tblTimer = 0;
export const renderTableSoon = () => { clearTimeout(tblTimer); tblTimer = setTimeout(renderTable, 120); };

export function rowData(o) {
  const f = fov(), v = S.vis[o.id] || {};
  const j = jd(S.time), alt = altaz(...precess(o.ra, o.dec, j), S.lat, lstDeg(j, S.lon))[0];
  const short = Math.min(f.w, f.h) * 60;
  return { o, v, alt, fill: o.maj / short * 100, hours: v.hours ?? 0, transit: v.transit ? new Date(v.transit).getTime() : 0 };
}

export function renderTable() {
  if (!S.catalog.length) return;
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

// ---------------------------------------------------------------- object detail
export function select(id, center) {
  if (S.selected) selLabel(S.selected)?.element.classList.remove('sel');
  S.selected = id; S.track = false;
  selLabel(id).element.classList.add('sel');
  if (center) {
    scene.updateMatrixWorld(); sel3D(id).getWorldPosition(wp); aimAt(wp);
    const [ra, dec] = selRaDec(id, jd(S.time)); S.frame = { ra, dec }; frameFov();
  }
  renderDetail(); renderTable();
}
export function frameFov() {
  const f = fov(), o = S.selected && nodes.get(S.selected)?.o;
  const [mw, mh] = frameGeom?.sizeDeg ?? [f.w, f.h];
  const want = Math.max(mh, mw / camera.aspect, o ? o.maj / 60 : 0) * 1.5;
  camera.fov = Math.max(0.15, Math.min(110, want)); camera.updateProjectionMatrix();
}

export function renderDetail() {
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
    <canvas id="chart" width="840" height="340"></canvas>
    <div class="acts"><button id="bCenter">Center</button><button id="bTrack">${S.track ? 'Stop tracking' : 'Track'}</button><button id="bFrame">Zoom to FOV</button><button id="bClose">✕</button></div>`;
  $('bCenter').onclick = () => select(o.id, true);
  $('bTrack').onclick = () => { S.track = !S.track; renderDetail(); };
  $('bFrame').onclick = () => { S.track = true; frameFov(); renderDetail(); };
  $('bClose').onclick = () => { n.lbl.element.classList.remove('sel'); S.selected = null; S.track = false; renderDetail(); renderTable(); };
  drawChart();
}

export function renderPlanetDetail(el) {
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
    <canvas id="chart" width="840" height="340"></canvas>
    <div class="acts"><button id="bCenter">Center</button><button id="bTrack">${S.track ? 'Stop tracking' : 'Track'}</button><button id="bFrame">Zoom to FOV</button><button id="bClose">✕</button></div>`;
  $('bCenter').onclick = () => select(S.selected, true);
  $('bTrack').onclick = () => { S.track = !S.track; renderDetail(); };
  $('bFrame').onclick = () => { S.track = true; frameFov(); renderDetail(); };
  $('bClose').onclick = () => { pn.lbl.element.classList.remove('sel'); S.selected = null; S.track = false; renderDetail(); };
  drawChart();
}

export function drawChart() {
  const c = $('chart'); if (!c || !S.selected) return;
  const id = S.selected, g = c.getContext('2d'), W = c.width, H = c.height;
  const t0 = S.windowStart.getTime() + 3 * 3600000, span = 18 * 3600000; // 15:00 → 09:00
  const PL = 0, PR = 52, B = 26, T = 28, CW = W - PL - PR;           // top margin holds the legend              // plot area (right margin = airmass axis)
  const xOf = (i) => PL + i / N * CW, yOf = (a) => H - B - (Math.max(-10, Math.min(90, a)) + 10) / 100 * (H - B - T);
  const N = 216, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = new Date(t0 + span * i / N), j = jd(t), l = lstDeg(j, S.lon);
    const sun = altaz(...sunRaDec(j), S.lat, l)[0], moon = altaz(...moonRaDec(j), S.lat, l)[0];
    const [alt, az] = altaz(...precess(...selRaDec(id, j), j), S.lat, l), hz = horizonAlt(az);
    pts.push({ sun, moon, alt, hz, lim: Math.max(S.minAlt, hz) });
  }
  g.clearRect(0, 0, W, H);
  // twilight background
  pts.forEach((p, i) => {
    g.fillStyle = p.sun > 0 ? '#1e3a63' : p.sun > -6 ? '#16294a' : p.sun > -12 ? '#0f1c36' : p.sun > -18 ? '#0a1224' : '#04060d';
    g.fillRect(xOf(i), T, CW / N + 1, H - B - T);
  });
  // imageable: dark + above min altitude and horizon (brighter when the Moon is down)
  pts.forEach((p, i) => {
    if (p.sun > -18 || p.alt < p.lim) return;
    g.fillStyle = p.moon < 0 ? 'rgba(74,222,128,.30)' : 'rgba(74,222,128,.13)';
    g.fillRect(xOf(i), yOf(p.alt), CW / N + 1, yOf(-10) - yOf(p.alt));
  });
  // horizon profile in the direction of the object
  if (S.horizon.length) {
    g.fillStyle = 'rgba(138,106,42,.45)'; g.beginPath(); g.moveTo(xOf(0), yOf(-10));
    pts.forEach((p, i) => g.lineTo(xOf(i), yOf(p.hz))); g.lineTo(xOf(N), yOf(-10)); g.fill();
  }
  // grid + altitude labels
  g.font = '20px system-ui'; g.lineWidth = 1;
  for (const a of [0, 30, 60, 90]) {
    g.strokeStyle = a ? '#2a3550' : '#5b4a2a'; g.beginPath(); g.moveTo(PL, yOf(a)); g.lineTo(PL + CW, yOf(a)); g.stroke();
    g.fillStyle = '#7d8aa3'; g.fillText(a + '°', PL + 4, yOf(a) - 3);
  }
  // airmass axis (Pickering 2002 is overkill here: X ≈ 1 / sin(alt))
  g.fillStyle = '#7d8aa3'; g.textAlign = 'left';
  g.fillText('X', PL + CW + 8, T + 16);
  for (const X of [1.1, 1.5, 2, 3]) {
    const y = yOf(Math.asin(1 / X) / D2R);
    g.strokeStyle = '#7d8aa3'; g.beginPath(); g.moveTo(PL + CW, y); g.lineTo(PL + CW + 5, y); g.stroke();
    g.fillText(X.toFixed(1), PL + CW + 8, y + 5);
  }
  // minimum altitude
  g.setLineDash([6, 6]); g.strokeStyle = '#facc1588'; g.beginPath(); g.moveTo(PL, yOf(S.minAlt)); g.lineTo(PL + CW, yOf(S.minAlt)); g.stroke();
  // Moon
  g.strokeStyle = '#cbd5e166'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(xOf(i), yOf(p.moon)) : g.moveTo(xOf(i), yOf(p.moon))); g.stroke();
  // transit / meridian
  let best = 0; pts.forEach((p, i) => { if (p.alt > pts[best].alt) best = i; });
  if (best > 0 && best < N && pts[best].alt > -10) {
    g.strokeStyle = '#94a3b8aa'; g.lineWidth = 1.5; g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(xOf(best), T); g.lineTo(xOf(best), H - B); g.stroke();
    g.setLineDash([]); g.fillStyle = '#94a3b8'; g.textAlign = 'center'; g.fillText('meridian', xOf(best), H - B - 6); g.textAlign = 'left';
  }
  // object
  g.setLineDash([]); g.strokeStyle = '#ff5a4e'; g.lineWidth = 3; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(xOf(i), yOf(p.alt)) : g.moveTo(xOf(i), yOf(p.alt))); g.stroke();
  // time axis
  g.fillStyle = '#7d8aa3';
  for (let h = 0; h <= 18; h += 3) {
    const x = PL + h / 18 * CW, t = new Date(t0 + h * 3600000);
    g.textAlign = h === 0 ? 'left' : h === 18 ? 'right' : 'center';
    g.fillText(t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), x, H - 4);
  }
  g.textAlign = 'left';
  // now
  const xn = PL + (S.time.getTime() - t0) / span * CW;
  if (xn >= PL && xn <= PL + CW) { g.strokeStyle = '#4ade80'; g.lineWidth = 2; g.beginPath(); g.moveTo(xn, T); g.lineTo(xn, H - B); g.stroke(); }
  // legend
  const leg = [['#ff5a4e', 'object'], ['#cbd5e1', 'Moon'], ['#4ade80', 'imageable'], ...(S.horizon.length ? [['#8a6a2a', 'horizon']] : [])];
  let lx = PL + CW - 4; g.font = '19px system-ui'; g.textAlign = 'right';
  for (const [col, txt] of leg.reverse()) {
    g.fillStyle = '#9aa7bd'; g.fillText(txt, lx, 20); lx -= g.measureText(txt).width + 6;
    g.fillStyle = col; g.fillRect(lx - 12, 7, 12, 12); lx -= 26;
  }
  g.textAlign = 'left';
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  ['search', 'typeFilter', 'onlyVisible', 'fitFov'].forEach((id) => $(id).addEventListener('input', renderTable));
  document.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort; S.sort = [k, S.sort[0] === k ? -S.sort[1] : (k === 'id' || k === 'type' || k === 'transit' ? 1 : -1)];
    store.set('sort', S.sort); renderTable();
  });
  $('list').tBodies[0].onclick = (e) => { const tr = e.target.closest('tr'); if (tr) select(tr.dataset.id, true); };
}
