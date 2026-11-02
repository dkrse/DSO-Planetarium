import { altaz, jd, lstDeg, sunRaDec } from '../astro.js';
import { $, S } from './core.js';
import { drawChart, loadVisibility, renderTable, renderTableSoon, updateTableTime } from './panels.js';

// ---------------------------------------------------------------- time
export function setWindowFromDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  S.windowStart = new Date(y, m - 1, d, 12, 0, 0);
}
export function syncSlider() {
  const min = (S.time - S.windowStart) / 60000;
  if (min < 0 || min > 1440) {           // rolled over into another night
    const d = new Date(S.time); if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    setDate(isoDate(d)); loadVisibility();
  }
  $('slider').value = (S.time - S.windowStart) / 60000;
}
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// date: ISO (yyyy-mm-dd) internally, shown as dd-mm-yyyy
export const fmtDate = (iso) => iso.split('-').reverse().join('-');
export function setDate(iso) {
  $('date').value = iso; $('dateTxt').value = fmtDate(iso); $('dateTxt').classList.remove('bad');
  setWindowFromDate(iso);
}
export function changeDate(iso) {
  setDate(iso);
  S.time = new Date(S.windowStart.getTime() + 10 * 3600000); // 22:00
  syncSlider(); drawNightBar(); loadVisibility();
}

export const shiftDate = (n) => { const d = new Date(S.windowStart); d.setDate(d.getDate() + n); changeDate(isoDate(d)); };

export function drawNightBar() {
  const c = $('nightbar'), g = c.getContext('2d'), W = c.width;
  for (let x = 0; x < W; x++) {
    const t = new Date(S.windowStart.getTime() + x / W * 86400000), j = jd(t);
    const [ra, dec] = sunRaDec(j), a = altaz(ra, dec, S.lat, lstDeg(j, S.lon))[0];
    g.fillStyle = a > 0 ? '#3d6fb0' : a > -6 ? '#284a7a' : a > -12 ? '#183054' : a > -18 ? '#0e1b33' : '#03050b';
    g.fillRect(x, 0, 1, c.height);
  }
}

// module setup – called once from main.js after all modules are loaded
export function init() {
  $('slider').oninput = () => { S.time = new Date(S.windowStart.getTime() + $('slider').value * 60000); updateTableTime(); drawChart(); };
  $('now').onclick = () => { S.time = new Date(); syncSlider(); renderTable(); drawChart(); };
  $('play').onclick = () => { S.playing = !S.playing; $('play').textContent = S.playing ? '❚❚' : '▶'; };
  $('date').onchange = () => { if ($('date').value) changeDate($('date').value); };
  $('dateTxt').onchange = () => {
    const m = $('dateTxt').value.trim().match(/^(\d{1,2})[-.\/ ](\d{1,2})[-.\/ ](\d{4})$/);
    const d = m && new Date(+m[3], m[2] - 1, +m[1]);
    if (!d || d.getDate() !== +m[1] || d.getMonth() !== m[2] - 1) { $('dateTxt').classList.add('bad'); return; }
    changeDate(isoDate(d));
  };
  $('dPick').onclick = () => { try { $('date').showPicker(); } catch { $('date').focus(); } };
  $('dPrev').onclick = () => shiftDate(-1);
  $('dNext').onclick = () => shiftDate(1);
}
