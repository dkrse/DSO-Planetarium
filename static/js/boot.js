// ---------------------------------------------------------------- bootstrap
// UI preferences live in localStorage *and* on the server (settings.ui), so they survive a new browser,
// a private window or cleared site data. The server copy is loaded first, then the app starts.
const KEY = 'dso.';
try {
  const s = await (await fetch('/api/settings')).json();
  if (s.ui && typeof s.ui === 'object') {
    for (const [k, v] of Object.entries(s.ui)) localStorage.setItem(KEY + k, JSON.stringify(v));
  } else {
    window.__dsoUploadUi = true;          // first run with server sync: upload what this browser has
  }
} catch (e) {
  console.warn('UI settings could not be loaded from the server – using this browser\'s copy', e);
}
const core = await import('./core.js');
await import('./main.js');
if (window.__dsoUploadUi) core.syncUi?.();      // optional: tolerate a stale cached core.js
