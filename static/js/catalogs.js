import { onTab } from './dialog.js';
// ---------------------------------------------------------------- catalog management dialog
// Show / hide catalogs (stored on the server as settings.hidden_catalogs), import a catalog from
// CSV / JSON and delete catalogs. Every change reloads the objects on the sky and the tables.
import { $, S } from './core.js';
import { api } from './sync.js';
import { reloadCatalog } from './panels.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function render() {
  const cats = S.catalogs ?? [];
  $('catList').innerHTML = cats.map((c) => `
    <li data-id="${esc(c.id)}">
      <label class="catShow" title="Show this catalog on the sky and in the tables">
        <input type="checkbox" data-act="toggle" ${c.hidden ? '' : 'checked'}></label>
      <div class="catInfo">
        <b>${esc(c.name)}</b> <small class="dim">${esc(c.id)} · priority ${c.priority}${c.builtin ? ' · built-in' : ''}</small>
        <small>${esc(c.description)}</small>
        <small class="dim">${c.total} objects${c.hidden ? ' · hidden' : ` · ${c.shown} shown`}${c.duplicates ? ` · ${c.duplicates} also in a higher-priority catalog` : ''}</small>
        <small class="dim">${esc(c.source)}${c.license ? ' · ' + esc(c.license) : ''}</small>
      </div>
      <button type="button" data-act="delete" class="danger" title="Delete this catalog file">✕</button>
    </li>`).join('') || '<li class="dim">No catalogs.</li>';
}

async function setHidden(id, hidden) {
  const cur = new Set((S.catalogs ?? []).filter((c) => c.hidden).map((c) => c.id));
  hidden ? cur.add(id) : cur.delete(id);
  await api('PATCH', '/api/settings', { hidden_catalogs: [...cur] });
  await reloadCatalog(); render();
}

async function remove(id) {
  const c = S.catalogs.find((x) => x.id === id);
  const warn = c.builtin ? `\n\n"${c.name}" is a built-in catalog – it can be rebuilt with the scripts in tools/.` : '';
  if (!confirm(`Delete catalog "${c.name}" (${c.total} objects)?${warn}`)) return;
  await api('DELETE', `/api/catalogs/${encodeURIComponent(id)}`);
  await reloadCatalog(); render();
}

async function importCatalog() {
  const f = $('ciFile').files[0];
  const id = $('ciId').value.trim().toLowerCase();
  if (!f || !id) { $('ciMsg').textContent = 'Choose a file and enter an id.'; return; }
  const fd = new FormData();
  fd.append('file', f); fd.append('id', id);
  for (const k of ['name', 'description', 'source', 'license', 'priority']) fd.append(k, $('ci_' + k).value);
  if (S.catalogs.some((c) => c.id === id)) {
    if (!confirm(`Catalog "${id}" exists – replace it?`)) return;
    fd.append('replace', 'true');
  }
  $('ciMsg').textContent = 'Importing…';
  const r = await fetch('/api/catalogs', { method: 'POST', body: fd });
  const body = await r.json();
  if (!r.ok) { $('ciMsg').textContent = '⚠ ' + (body.detail ?? r.status); return; }
  $('ciMsg').textContent = `✓ ${body.total} objects imported`;
  for (const el of $('ciForm').querySelectorAll('input')) el.value = el.id === 'ci_priority' ? '50' : '';
  await reloadCatalog(); render();
}

export function init() {
  onTab('catalogs', () => { render(); $('ciMsg').textContent = ''; });
  $('catList').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]'), act = e.target.dataset.act; if (!li || !act) return;
    try {
      if (act === 'toggle') await setHidden(li.dataset.id, !e.target.checked);
      if (act === 'delete') await remove(li.dataset.id);
    } catch (err) { alert(err.message); render(); }
  });
  $('ciFile').onchange = () => {            // suggest an id / name from the file name
    const base = ($('ciFile').files[0]?.name ?? '').replace(/\.[^.]+$/, '');
    if (!$('ciId').value) $('ciId').value = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!$('ci_name').value) $('ci_name').value = base;
  };
  $('ciImport').onclick = () => importCatalog().catch((e) => { $('ciMsg').textContent = '⚠ ' + e.message; });
}
