// ---------------------------------------------------------------- Settings › Performance
// Rendering mode (hardware GPU / software-friendly), GPU preference, resolution, antialiasing, frame-rate cap.
// GPU preference and antialiasing are WebGL context options → applied after a reload.
// A web page cannot force the browser to use (or not use) the GPU; it can only request a preference and
// adapt its own load. The detected renderer tells which one the browser actually uses.
import { $, S, store } from './core.js';
import { onTab } from './dialog.js';

export const PRESETS = {
  hardware: { mode: 'hardware', gpu: 'high-performance', aa: true, scale: 1, fps: 60 },
  software: { mode: 'software', gpu: 'default', aa: false, scale: 0.5, fps: 30 },
};

/** Settings used when the WebGL renderer is created (read before the scene exists). */
export function loadPerf() {
  S.perf = { ...PRESETS.hardware, ...store.get('perf', {}) };
  return S.perf;
}

let renderer, applied;
export function rendererInfo() {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return { name, software: /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(name) };
}

function save() { store.set('perf', S.perf); }
const needsReload = () => S.perf.gpu !== applied.gpu || S.perf.aa !== applied.aa;

function applyLive() {
  renderer.setPixelRatio(devicePixelRatio * S.perf.scale);
  dispatchEvent(new Event('resize'));            // re-sizes the canvas and requests a frame
}

function render() {
  const info = rendererInfo();
  $('pfRenderer').textContent = info.name;
  $('pfKind').textContent = info.software ? 'software (CPU) – the browser is not using the GPU' : 'hardware (GPU)';
  $('pfKind').className = info.software ? 'warn' : 'ok';
  for (const r of document.querySelectorAll('input[name=pfMode]')) r.checked = r.value === S.perf.mode;
  $('pfGpu').value = S.perf.gpu; $('pfAa').checked = S.perf.aa;
  $('pfScale').value = String(S.perf.scale); $('pfFps').value = String(S.perf.fps);
  $('pfReload').hidden = !needsReload();
}

export function init(r) {
  renderer = r;
  applied = { ...S.perf };
  // first run on a software renderer → switch to the software-friendly preset automatically
  if (!store.get('perf', null) && rendererInfo().software) {
    S.perf = { ...PRESETS.software }; save(); applyLive();
  }
  onTab('performance', render);
  for (const r of document.querySelectorAll('input[name=pfMode]')) r.onchange = () => {
    S.perf = { ...PRESETS[r.value] }; save(); applyLive(); render();
  };
  const set = (k, v) => { S.perf[k] = v; S.perf.mode = 'custom'; save(); render(); };
  $('pfGpu').onchange = () => set('gpu', $('pfGpu').value);
  $('pfAa').onchange = () => set('aa', $('pfAa').checked);
  $('pfScale').onchange = () => { set('scale', +$('pfScale').value); applyLive(); };
  $('pfFps').onchange = () => set('fps', +$('pfFps').value);
  $('pfReload').onclick = () => location.reload();
}
