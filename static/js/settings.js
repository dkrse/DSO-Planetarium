import { setGroundVisible } from './horizon.js';
import { deselect } from './panels.js';
import { setViewMode, view } from './scene.js';
import { onTab, openSettings } from './dialog.js';
import { $, COLORS, S, active, fov, fovOf, store, uid } from './core.js';
import { buildFovBoxes } from './framing.js';
import { constGroup, starGroup } from './objects.js';
import { drawChart, loadVisibility, renderDetail, renderTable } from './panels.js';
import { azGrid, eqGrid } from './scene.js';
import { saveSetups } from './sync.js';
import { fmtAng } from './targets.js';
import { drawNightBar } from './time.js';

// ---------------------------------------------------------------- settings
export function bindNum(id, key, after) {
  $(id).value = S[key];
  $(id).onchange = () => { const v = parseFloat($(id).value); if (!isNaN(v)) { S[key] = v; store.set(key, v); after?.(); } };
}
export const onLoc = () => { drawNightBar(); loadVisibility(); };
 
export const onOptics = () => { updateFovInfo(); renderSetupSelect(); buildFovBoxes(); renderTable(); renderDetail(); };
 

export function updateFovInfo() {
  const f = fov();
  $('fovInfo').textContent = `FOV ${fmtAng(f.w)} × ${fmtAng(f.h)} · ${f.scale.toFixed(2)}″/px · ${Math.round(f.F)} mm${f.fr ? ' f/' + f.fr.toFixed(1) : ''} · ${(active().mount ?? 'eq') === 'eq' ? 'EQ mount' : 'Alt-Az mount'}`;
  $('fovInfo').title = 'Alt-Az mount: the frame stays level with the horizon and rotates against the stars (field rotation).\nEQ mount: the frame keeps its position angle on the sky.';
}
export function renderSetupSelect() {
  const sel = $('setup'); sel.innerHTML = '';
  for (const st of S.setups) sel.append(new Option(st.name || '(unnamed)', st.id));
  sel.value = active().id;
}

// equipment dialog
export let editing = null;
export const FIELDS = ['name', 'focal', 'reducer', 'aperture', 'sw', 'sh', 'px', 'mount', 'rot', 'color', 'show'];
export function openEquipment() { openSettings('equipment'); }

export function renderDlg() {
  const cur = S.setups.find((s) => s.id === editing) || S.setups[0]; editing = cur.id;
  $('setupList').innerHTML = S.setups.map((st) => {
    const f = fovOf(st);
    return `<li data-id="${st.id}" class="${st.id === editing ? 'cur' : ''}"><span class="sw" style="background:${st.color}"></span>
      <div>${st.name || '(unnamed)'}<small>${Math.round(f.F)} mm · ${fmtAng(f.w)} × ${fmtAng(f.h)}</small></div>
      ${st.id === active().id ? '<span class="act">active</span>' : ''}</li>`;
  }).join('');
  for (const k of FIELDS) { const el = $('f_' + k); if (el.type === 'checkbox') el.checked = !!cur[k]; else el.value = cur[k] ?? (k === 'mount' ? 'eq' : ''); }
  const preset = [...$('f_preset').options].find((o) => o.value === `${cur.sw},${cur.sh},${cur.px}`);
  $('f_preset').value = preset ? preset.value : '';
  renderComputed(cur);
  $('delSetup').disabled = S.setups.length < 2;
}
export function renderComputed(st) {
  const f = fovOf(st), diag = Math.hypot(f.w, f.h);
  $('f_computed').innerHTML = `Effective focal length <b>${f.F.toFixed(0)} mm</b>${f.fr ? ` · <b>f/${f.fr.toFixed(2)}</b>` : ''}<br>
    Field of view <b>${fmtAng(f.w)} × ${fmtAng(f.h)}</b> (diagonal ${fmtAng(diag)})<br>
    Image scale <b>${f.scale.toFixed(2)}″/px</b> · ${Math.round(st.sw * 1000 / st.px)} × ${Math.round(st.sh * 1000 / st.px)} px`;
}

 

// ---------------------------------------------------------------- theme
export const THEMES = ['dark', 'light', 'red'];
export function setTheme(t) {
  if (!THEMES.includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t; $('theme').value = t; store.set('theme', t);
  drawChart();
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  bindNum('lat', 'lat', onLoc);
  bindNum('lon', 'lon', onLoc);
  $('minalt').value = S.minAlt;
  $('minalt').onchange = () => { S.minAlt = +$('minalt').value; store.set('minAlt', S.minAlt); loadVisibility(); };
  $('setup').onchange = () => { S.active = $('setup').value; saveSetups(); onOptics(); };
  onTab('equipment', () => { editing = active().id; renderDlg(); });
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
    // all-in-one telescopes (Seestar) also set their optics and alt-az mount
    const d = $('f_preset').selectedOptions[0].dataset;
    if (d.focal) { st.focal = +d.focal; st.reducer = 1; }
    if (d.aperture) st.aperture = +d.aperture;
    if (d.mount) { st.mount = d.mount; st.rot = 0; }
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
  $('starMag').value = store.get('starMag', 6);
  $('starMagV').textContent = $('starMag').value;
  $('starMag').oninput = () => { $('starMagV').textContent = $('starMag').value; store.set('starMag', +$('starMag').value); };
  $('stars').checked = starGroup.visible = store.get('stars', true);
  $('const').checked = constGroup.visible = store.get('const', true);
  // inverted colours (white sky, black objects) – a GPU filter on the sky canvas and its labels only
const setInvert = (on) => { $('invert').checked = on; $('sky').classList.toggle('inverted', on); store.set('invert', on); };
setInvert(store.get('invert', false));
$('invert').onchange = () => setInvert($('invert').checked);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) setInvert(!$('invert').checked);
});
// view mode (Alt/Az or Equatorial) decides the projection and which coordinate grid is drawn
  const applyGrid = () => { const on = $('grid').checked; eqGrid.visible = on && view.mode === 'eq'; azGrid.visible = on && view.mode === 'altaz'; };
  $('viewMode').value = store.get('viewMode', 'altaz');
  setViewMode($('viewMode').value);
  $('viewMode').onchange = () => { setViewMode($('viewMode').value); store.set('viewMode', view.mode); applyGrid(); };
  $('grid').checked = store.get('grid', true);
  $('grid').onchange = () => { store.set('grid', $('grid').checked); applyGrid(); };
  applyGrid();
  // remember the remaining toggles and filters (restored before the first render)
  for (const id of ['labels', 'imgs', 'onlyVisible', 'fitFov']) {
    const el = $(id); el.checked = store.get('chk.' + id, el.checked);
    el.addEventListener('change', () => store.set('chk.' + id, el.checked));
  }
  $('speed').value = String(store.get('speed', +$('speed').value));
  $('speed').addEventListener('change', () => store.set('speed', +$('speed').value));
  $('tgtBox').open = store.get('targetsOpen', true);
  $('tgtBox').addEventListener('toggle', () => store.set('targetsOpen', $('tgtBox').open));
  for (const id of ['typeFilter', 'catFilter']) $(id).addEventListener('change', () => store.set(id, $(id).value));
  // header / time-bar selects give the focus back after a choice – otherwise the arrow keys would keep changing
  // the select (e.g. Alt/Az ↔ Eq) instead of panning the sky
  for (const id of ['viewMode', 'setup', 'theme', 'speed']) $(id).addEventListener('change', (e) => e.target.blur());
  // framing & mosaic panel: hidden until the user asks for it
  const setFraming = (on) => { $('framing').hidden = !on; $('frToggle').classList.toggle('on', on); store.set('framingPanel', on); };
  setFraming(store.get('framingPanel', false));
  $('frToggle').onclick = () => setFraming($('framing').hidden);
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)
      && !document.querySelector('dialog[open]')) setFraming($('framing').hidden);
  });
  // ground / horizon on-off
  $('horizonOn').checked = store.get('ground', true); setGroundVisible($('horizonOn').checked);
  $('horizonOn').onchange = () => { store.set('ground', $('horizonOn').checked); setGroundVisible($('horizonOn').checked); };
  // Esc: clear the selection and let the FOV frame follow the view again
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (S.selected) deselect(); else if (S.frame) { S.frame = null; buildFovBoxes(); }
  });
  $('theme').onchange = () => setTheme($('theme').value);
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    setTheme(THEMES[(THEMES.indexOf($('theme').value) + 1) % THEMES.length]);
  });
  setTheme(store.get('theme', 'dark'));
}
