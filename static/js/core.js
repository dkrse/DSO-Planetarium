import { fovDeg } from '../astro.js';

export const R = 100;                       // celestial sphere radius
export const $ = (id) => document.getElementById(id);
export const fmtT = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

// ---------------------------------------------------------------- state
// UI preferences: localStorage + a copy on the server (settings.ui, see boot.js); every change is synced
const LEGACY = new Set(['setups', 'activeSetup', 'custom', 'sensor', 'focal', 'rot']);   // moved to the server DB
let uiTimer = 0;
export function syncUi() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    const ui = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('dso.') && !LEGACY.has(k.slice(4))) ui[k.slice(4)] = JSON.parse(localStorage.getItem(k));
      }
    } catch { return; }
    fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ui }) })
      .catch((e) => console.warn('UI settings not saved on the server', e));
  }, 600);
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem('dso.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { if (localStorage.getItem('dso.' + k) === JSON.stringify(v)) return; localStorage.setItem('dso.' + k, JSON.stringify(v)); } catch { }
    syncUi();
  },
};
export const S = {
  lat: store.get('lat', 48.1486), lon: store.get('lon', 17.1077),
  minAlt: store.get('minAlt', 30),
  setups: null, active: null,
  time: new Date(), windowStart: null,
  catalog: [], types: {}, vis: {}, night: null,
  selected: null, track: false, playing: false,
  sort: store.get('sort', ['hours', -1]),
};

// ---------------------------------------------------------------- equipment (telescope + camera setups)
export const COLORS = ['#ff5a4e', '#5ab0ff', '#4ade80', '#facc15', '#c084fc', '#fb923c', '#f472b6'];
export const uid = () => Math.random().toString(36).slice(2, 10);
export function defaultSetups() {                // migrate the old single-setup settings if present
  const old = store.get('sensor', null);
  let [w, h, px] = [23.5, 15.7, 3.76];
  if (old === 'custom') [w, h, px] = store.get('custom', [w, h, px]);
  else if (old) [w, h, px] = old.split('x').map(Number);
  return [{ id: uid(), name: 'My setup', focal: store.get('focal', 400), reducer: 1, aperture: 80,
    sw: w, sh: h, px, rot: store.get('rot', 0), color: COLORS[0], show: false }];
}

export const active = () => S.setups.find((s) => s.id === S.active) || S.setups[0];
export function fovOf(s) {
  const F = s.focal * (s.reducer || 1);
  return { w: fovDeg(s.sw, F), h: fovDeg(s.sh, F), scale: 206.265 * s.px / F, F, fr: s.aperture ? F / s.aperture : null };
}
export const fov = () => fovOf(active());

// module setup – called once from main.js after all modules are loaded
export function init() {
  S.setups = store.get('setups', null) || defaultSetups();
  S.active = store.get('activeSetup', S.setups[0].id);
}
