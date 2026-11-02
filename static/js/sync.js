import { $, S, active } from './core.js';
import { setHorizon } from './horizon.js';

// ---------------------------------------------------------------- server sync (setups live in the server DB)
export const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
export const clean = (st) => { const { computed, ...rest } = st; return rest; };
export let synced = new Map(), syncedActive = null, syncTimer = 0;
// Diff the in-memory setups against the last server state and send POST / PUT / DELETE as needed (debounced).
export function saveSetups() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const now = new Map(S.setups.map((st) => [st.id, JSON.stringify(clean(st))]));
      for (const [id, json] of now) {
        if (!synced.has(id)) await api('POST', '/api/setups', JSON.parse(json));
        else if (synced.get(id) !== json) await api('PUT', `/api/setups/${id}`, JSON.parse(json));
      }
      for (const id of synced.keys()) if (!now.has(id)) await api('DELETE', `/api/setups/${id}`);
      if (syncedActive !== active().id) await api('PATCH', '/api/settings', { active_setup: active().id });
      synced = now; syncedActive = active().id;
      $('syncState').textContent = '';
    } catch (e) { console.error(e); $('syncState').textContent = '⚠ not saved'; $('syncState').title = String(e); }
  }, 400);
}
export async function loadSetups() {
  let list = (await api('GET', '/api/setups')).map(clean), settings = await api('GET', '/api/settings');
  if (!list.length) {                        // first run: migrate setups kept in this browser (or the default)
    for (const st of S.setups) await api('POST', '/api/setups', clean(st));
    await api('PATCH', '/api/settings', { active_setup: active().id });
    list = (await api('GET', '/api/setups')).map(clean); settings = { active_setup: active().id };
  }
  setHorizon(settings.horizon ?? []);
  S.hiddenTypes = settings.hidden_types ?? [];
  S.setups = list;
  S.active = list.some((x) => x.id === settings.active_setup) ? settings.active_setup : list[0].id;
  synced = new Map(list.map((st) => [st.id, JSON.stringify(st)])); syncedActive = S.active;
}

// module setup – called once from main.js after all modules are loaded
export function init() {

}
