import { $, S, active, store } from './core.js';
import { buildFovBoxes, eqToWorld, frameGeom, updateFrame } from './framing.js';
import { nodes, planetOf } from './objects.js';
import { frameFov, select } from './panels.js';
import { aimAt, eqVec, scene } from './scene.js';
import { onOptics } from './settings.js';
import { api, saveSetups } from './sync.js';

// ---------------------------------------------------------------- planned targets (server DB)

export async function loadTargets() { S.targets = await api('GET', '/api/targets'); renderTargets(); }
export function renderTargets() {
  $('tgtCount').textContent = S.targets.length ? `(${S.targets.length})` : '';
  $('tgtList').innerHTML = S.targets.length ? S.targets.map((t) => {
    const st = S.setups.find((x) => x.id === t.setup_id), v = t.object_id && S.vis[t.object_id];
    const m = t.mosaic.cols * t.mosaic.rows > 1 ? ` · ${t.mosaic.cols}×${t.mosaic.rows}` : '';
    return `<li data-id="${t.id}"><div class="tName"><b>${t.name}</b><small>${st ? st.name : '⚠ missing setup'}${m} · PA ${t.pa.toFixed(0)}°${v ? ` · ${v.hours.toFixed(1)} h tonight` : ''}</small></div>
      <button data-act="update" title="Overwrite with the current frame">⤓</button><button data-act="rename" title="Rename">✎</button><button data-act="delete" class="danger" title="Delete">✕</button></li>`;
  }).join('') : '<li class="empty">No saved targets – frame an object and press “Save target”.</li>';
}
export function frameAsTarget(name, base = {}) {
  const g = frameGeom;
  const objId = S.selected && !planetOf(S.selected) ? S.selected : null;
  return { ...base, name, object_id: base.object_id ?? objId, ra: +g.ra.toFixed(6), dec: +g.dec.toFixed(6), pa: +g.pa.toFixed(2),
    setup_id: active().id, mosaic: { ...S.mosaic }, notes: base.notes ?? '' };
}

export function loadTarget(t) {
  const st = S.setups.find((x) => x.id === t.setup_id);
  if (st) {
    S.active = st.id;
    if ((st.mount ?? 'eq') === 'eq') st.rot = t.pa;
    saveSetups(); onOptics();
  }
  S.mosaic = { ...t.mosaic }; store.set('mosaic', S.mosaic);
  $('moCols').value = S.mosaic.cols; $('moRows').value = S.mosaic.rows; $('moOv').value = S.mosaic.overlap;
  if (t.object_id && nodes.has(t.object_id)) select(t.object_id, false);
  S.frame = { ra: t.ra, dec: t.dec }; buildFovBoxes(); S.track = false;
  scene.updateMatrixWorld(); aimAt(eqToWorld(eqVec(t.ra, t.dec)));
  updateFrame(); frameFov();
}

export const fmtAng = (d) => d >= 1 ? d.toFixed(2) + '°' : (d * 60).toFixed(1) + '′';

// module setup – called once from main.js after all modules are loaded
export function init() {
  S.targets = [];
  $('frSave').onclick = async () => {
    if (!frameGeom) return;
    const o = S.selected && nodes.get(S.selected)?.o;
    const name = prompt('Target name:', o ? `${o.id}${o.name ? ' ' + o.name : ''}` : `Target ${S.targets.length + 1}`);
    if (!name) return;
    try { S.targets.push(await api('POST', '/api/targets', frameAsTarget(name))); renderTargets(); $('tgtBox').open = true; }
    catch (e) { alert('Saving failed: ' + e.message); }
  };
  $('tgtList').onclick = async (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const t = S.targets.find((x) => x.id === li.dataset.id), act = e.target.dataset.act;
    try {
      if (act === 'delete') {
        if (!confirm(`Delete target "${t.name}"?`)) return;
        await api('DELETE', `/api/targets/${t.id}`); S.targets = S.targets.filter((x) => x !== t);
      } else if (act === 'rename') {
        const name = prompt('Target name:', t.name); if (!name) return;
        Object.assign(t, await api('PUT', `/api/targets/${t.id}`, { ...t, name }));
      } else if (act === 'update') {
        if (!confirm(`Overwrite "${t.name}" with the current frame, setup and mosaic?`)) return;
        Object.assign(t, await api('PUT', `/api/targets/${t.id}`, frameAsTarget(t.name, t)));
      } else return loadTarget(t);
      renderTargets();
    } catch (err) { alert(err.message); }
  };
}
