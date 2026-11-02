import { $, S } from './core.js';
import { buildFovBoxes } from './framing.js';
import { frame } from './loop.js';
import { loadImageIndex, loadStars } from './objects.js';
import { loadCatalog, loadVisibility } from './panels.js';
import { resize } from './scene.js';
import { renderSetupSelect, updateFovInfo } from './settings.js';
import { loadSetups } from './sync.js';
import { loadTargets } from './targets.js';
import { drawNightBar, isoDate, setDate, syncSlider } from './time.js';
import { init as init_core } from './core.js';
import { init as init_sync } from './sync.js';
import { init as init_targets } from './targets.js';
import { init as init_scene } from './scene.js';
import { init as init_objects } from './objects.js';
import { init as init_loop } from './loop.js';
import { init as init_framing } from './framing.js';
import { init as init_time } from './time.js';
import { init as init_panels } from './panels.js';
import { init as init_settings } from './settings.js';
import { init as init_horizon } from './horizon.js';

// initialise modules in dependency order (same order as the original single-file app)
init_core();
init_sync();
init_targets();
init_scene();
init_objects();
init_loop();
init_framing();
init_time();
init_panels();
init_settings();
init_horizon();

// ---------------------------------------------------------------- start
(async function init() {
  const now = new Date(), d = new Date(now); if (now.getHours() < 12) d.setDate(d.getDate() - 1);
  setDate(isoDate(d));
  S.time = now; syncSlider();
  try { await loadSetups(); } catch (e) { console.error(e); $('syncState').textContent = '⚠ server unavailable'; }
  updateFovInfo(); renderSetupSelect(); buildFovBoxes(); resize(); drawNightBar();
  loadTargets().catch(console.error);
  loadStars(); loadImageIndex();
  await loadCatalog();
  await loadVisibility();
  requestAnimationFrame(frame);
})();
