// ---------------------------------------------------------------- Settings › Objects: visible object types, density
import { $, S, store } from './core.js';
import { onTab } from './dialog.js';
import { api } from './sync.js';
import { reloadCatalog } from './panels.js';

S.hiddenTypes = [];
S.lod = true;

function render() {
  const counts = S.typeCounts ?? {};
  $('typeList').innerHTML = Object.entries(S.types ?? {}).map(([k, v]) => `
    <label><input type="checkbox" data-type="${k}" ${S.hiddenTypes.includes(k) ? '' : 'checked'}>
      <span class="t-${k}">${v}</span> <small class="dim">${counts[k] ?? 0}</small></label>`).join('');
  $('lod').checked = S.lod;
}

async function saveTypes(hidden) {
  await api('PATCH', '/api/settings', { hidden_types: hidden });
  S.hiddenTypes = hidden;
  await reloadCatalog(); render();
}

export function init() {
  S.lod = store.get('lod', true);
  onTab('objects', render);
  $('typeList').addEventListener('change', (e) => {
    const t = e.target.dataset.type; if (!t) return;
    const h = new Set(S.hiddenTypes); e.target.checked ? h.delete(t) : h.add(t);
    saveTypes([...h]).catch((err) => alert(err.message));
  });
  $('typesAll').onclick = () => saveTypes([]);
  $('typesNone').onclick = () => saveTypes(Object.keys(S.types));
  $('lod').onchange = () => { S.lod = $('lod').checked; store.set('lod', S.lod); };
}
