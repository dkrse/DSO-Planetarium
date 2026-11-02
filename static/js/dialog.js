// ---------------------------------------------------------------- Settings dialog with tabs
// Tabs: objects · catalogs · horizon · equipment. Each module fills its tab when it is shown (onTab).
import { $, store } from './core.js';

let current = null;
const panel = (tab) => document.querySelector(`#setDlg [data-panel="${tab}"]`);

function showTab(tab) {
  if (!panel(tab)) tab = 'objects';
  current = tab; store.set('settingsTab', tab);
  for (const b of document.querySelectorAll('#setDlg [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('#setDlg [data-panel]')) p.hidden = p.dataset.panel !== tab;
  panel(tab).dispatchEvent(new Event('tabshow'));
}

/** Open the settings dialog on a tab (default: the last used one). */
export function openSettings(tab = store.get('settingsTab', 'objects')) {
  showTab(tab);
  if (!$('setDlg').open) $('setDlg').showModal();
}
export const isSettingsOpen = (tab) => $('setDlg').open && (!tab || current === tab);
/** Run fn whenever the tab becomes visible. */
export const onTab = (tab, fn) => panel(tab).addEventListener('tabshow', fn);

export function init() {
  $('setBtn').onclick = () => openSettings();
  for (const b of document.querySelectorAll('#setDlg [data-tab]')) b.onclick = () => showTab(b.dataset.tab);
}
