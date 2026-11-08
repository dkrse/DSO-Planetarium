# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] – 2026-11-08

Complete rewrite as a precise planetarium. The framing / equipment / mosaic / targets features, catalog management,
DSS images and the Three.js renderer were removed; they can be rebuilt on top of the new core later.

### Changed
- One data source per kind: Hipparcos (stars), OpenNGC (all NGC / IC / Messier + addendum, 13 372 objects),
  Stellarium "modern" (constellation lines by HIP number, IAU boundaries), JPL DE440 (planets).
  Sharpless, Barnard, the hand-picked extras and the d3-celestial star / line files are gone.
- New 2D canvas renderer with an exact stereographic projection; deep-sky outlines are computed on the sphere from
  size and position angle; objects without a catalogued PA are drawn as a dashed circle instead of a guessed ellipse.
- Constellation lines are great circles between Hipparcos stars of the same catalogue (no separate coordinates).
- Astronomy: proper motion to the date, annual aberration, nutation, apparent sidereal time, refraction,
  topocentric Sun / Moon / planets, Moon from Meeus ch. 47, planets from Keplerian elements + DE440 residuals.
  Tested against astropy with DE440: stars < 5″, Sun and planets ≈ 3″, Moon ≈ 13″.
- The right side panel (search, details, display, location) can be shown / hidden (☰ Panel, key P).
- The server only serves static files; settings are kept in the browser.

### Fixed
- Error "Cannot read properties of undefined" when the pointer moved over the sky before the first frame was drawn (e.g. while opening a second window); the error banner now also shows where an error happened.
- Labels, the selection marker and clickable objects below the horizon showed through the ground; the ground was
  also slightly translucent. The ground is now opaque and everything below it is hidden in the Alt/Az view.
- The J2000 grid, the constellation boundaries and the cursor RA/Dec now include annual aberration like the objects
  (up to 20″ offset before).
- Refraction was ~4 % too large above 15°; it now follows the ERFA model (< 0.5″ from astropy).
- Deep-sky colours were hard to read on the inverted (white) chart.

### Performance
- Proper motion and aberration of the 118 k stars are updated in place, without temporary arrays.
- Deep-sky outlines are cached for at most 1 500 objects (LRU) instead of growing without limit.
- Moving the mouse only updates the coordinate readout; the object details are rebuilt only when time or place
  change (at most 4× per second), not while panning or zooming.

### Added
- Tests: ground/horizon hiding, opaque ground, side panel, search and on-screen size, view-mode switch, speed and
  memory (headless Chromium); Sun rise / transit / set, refraction and proper motion against astropy.
- New screenshots in the README.

## [0.3.0] – 2026-11-02

Manageable catalogs, much faster rendering, settings with tabs, view modes, Sun and Moon search.

### Added
- README screenshots of the view modes (Equatorial / Alt/Az) and of the inverted chart with a Seestar S50 Pro frame;
  outdated screenshots of the old layout removed.
- Keyboard navigation: arrow keys pan the sky by 10 % of the view (Shift: 2 %), + / − zoom; works in both view modes.
**Catalogs**
- Catalog management: every catalog is a separate file in `app/data/catalogs/`; Settings › Catalogs shows / hides
  catalogs (stored on the server as `hidden_catalogs`), imports new ones from CSV or JSON and deletes them.
  Objects are merged by id with a per-catalog priority. API: `GET/POST /api/catalogs`, `DELETE /api/catalogs/{id}`.
- Sharpless (313 HII regions) and Barnard (349 dark nebulae) catalogs, built from CDS VizieR by `tools/build_vizier.py`,
  with common names for well-known objects.
- "OpenNGC faint" catalog: 2 143 NGC/IC objects between 11 and 13 mag (1 847 galaxies), for stacked imaging
  with small telescopes such as the Seestar; built with `tools/build_catalog.py --faint`.
- Cross-catalog duplicates by position: an object of a lower-priority catalog lying on a higher-priority one
  (similar size, compatible type) is merged into it; its id becomes a searchable alias (`aka`), e.g. Sh2-117 → NGC 7000.
  OpenNGC catalogs are de-duplicated by id only (neighbouring NGC/IC objects are distinct).
- Catalog filter in the object table; the object detail shows the catalog and aliases.

**Sky and objects**
- View modes (toolbar "View"): **Alt/Az** — zenith up, horizon level; **Equatorial** — celestial north up, east left,
  dragging moves in RA/Dec and the sky stays fixed while time runs (like a tracking EQ mount). "Grid" draws the grid
  of the current mode.
- Visible object types (Settings › Objects), stored on the server as `hidden_types` and applied to the API as well.
- Density control: at wide views only objects large on screen or bright enough are drawn (Messier objects, the selection
  and saved targets always); more appear when zooming in.
- Inverted colours (toolbar "Invert", shortcut **I**): white sky, black stars and outlines, negative images —
  a GPU filter on the sky only; object-type colours stay recognisable.
- Sun and Moon can be searched and selected like planets (search box, click on their label, "Sun, Moon & planets" table):
  detail with magnitude, true size, illumination, rise / transit / set, disc size on the sensor and the altitude chart.
  Searching also lists matching planets above the deep-sky results.

- All settings are saved and restored on the next start: UI preferences (display toggles, theme, view mode, filters,
  performance, panels, …) are kept in the browser *and* on the server (`settings.ui`), so they also survive another
  browser, a private window or cleared site data. `static/js/boot.js` loads them before the app starts.
- Settings › Display tab with the display toggles (grid, horizon, invert, stars, magnitude, star names, constellations,
  planets, labels, images). The view controls — N / E / S / W, Zenith, Pole, ▭ Framing and the Alt/Az ↔ Eq selector —
  are in the header; nothing floats over the sky except the time HUD.
- The app is labelled "DSO" (header and page title).
- The framing & mosaic panel is hidden until turned on with the ▭ Framing button (shortcut **F**); the FOV frame
  itself is always drawn.
- "Horizon" toggle: hides the ground, horizon line and horizon profile; objects below the horizon are then shown too.
- Closing the object detail (✕) or pressing **Esc** clears the selection and the FOV frame follows the view again
  (selecting an object anchors the frame on it).
- The header shows the mount type of the active setup (EQ / Alt-Az).

**Settings and equipment**
- Settings dialog with tabs — Display, Objects, Catalogs, Horizon, Equipment, Performance — one ⚙ Settings… button
  instead of three separate dialogs.
- Settings › Performance: rendering mode (Hardware GPU / Software CPU), GPU preference (dedicated / integrated),
  resolution scale, antialiasing, frame-rate cap; shows the renderer the browser reports.
  On a software renderer the software preset is chosen automatically on first run.
- Seestar S50 and S50 Pro presets set sensor, focal length, aperture and the alt-az mount
  (S50: 5.57 × 3.13 mm, 250 mm → 1.28° × 0.72°; S50 Pro: 11.14 × 6.26 mm, 260 mm → 2.45° × 1.38°).
- Notice above the object table when object types or catalogs are hidden in the settings.
- `window.__dso` debugging handle (app state, scene, renderer).

### Changed
- Performance: the sky is rendered on demand (after input, data changes or during playback; 1 frame/s otherwise)
  instead of continuously at 60 fps.
- Performance: own lightweight label layer (`static/js/labels.js`) instead of three.js CSS2DRenderer, which re-styled,
  sorted and re-indexed all ~5 500 labels every frame; the new layer skips hidden subtrees and writes to the DOM only on change.
- Performance: objects outside the view are hidden completely (no draw call, no matrix update); the object table
  renders 300 rows at a time ("Show more…"); HUD text is updated only when it changes.
- Performance: static objects have frozen local matrices and only visible subtrees of the equatorial group get their
  world matrix updated (three.js recomputed ~15 000 matrices every frame); the renderer no longer traverses the scene twice.
  Frame CPU time while dragging: ~16 ms → ~4 ms.
- Performance: moving the time slider / playback only refreshes the altitude cells of the table (precession cached
  per night) instead of rebuilding it (25 ms → < 2 ms); search and filters are debounced.
- Performance: server-side visibility is computed with NumPy for all objects at once (1–2 s → 0.15 s, identical results)
  and cached; responses are gzip-compressed (visibility 1.1 MB → 107 kB). Loading a night: ~1.2 s → ~0.14 s.
- Optional profiling: `window.__dso.prof = {}` collects the time spent in each part of a frame.
- Sun, Moon and planets are drawn as crisp discs at their true angular size.
- `app/data/catalog.json` → `app/data/catalogs/openngc.json`; the hand-made fallback list moved to `catalogs/extras.json`.
- New dependency `python-multipart` (file upload).

### Fixed
- Sun and Moon were drawn about 3× too large (fixed 1.7° sprites), so they seemed not to fit into a FOV frame.
- Number fields in the settings rejected values such as 5.57 (fixed `step`) and blocked closing the dialog.
- Moving the star-magnitude slider made the toolbar re-wrap and jump.
- Dragging the sky selected (highlighted) label text when many labels were under the mouse.
- The camera frame disappeared while panning (regression of the matrix optimisation: the frame is rebuilt after the
  per-frame matrix update and was drawn with stale matrices).
- Arrow keys did nothing after switching Alt/Az ↔ Eq: the header select kept the focus (and the arrows would
  even switch it back). Header and time-bar selects now release the focus after a choice.
- After an update the browser could mix new and cached old JS modules ("core.syncUi is not a function");
  static files are now served with `Cache-Control: no-cache` (revalidated via ETag, unchanged files → 304).

## [0.2.0] – 2026-11-02

Accuracy, OpenNGC catalog, framing & mosaics, server-side setups and targets, custom horizon.

### Added
- Precession (IAU 1976): J2000 catalog, stars, images and frames are shown at their position of date
  (the 3D scene applies the precession as one rotation of the equatorial group).
- Test suite (`pytest`): accuracy against astropy for deep-sky objects, Sun, Moon, planets, rise/set and twilight;
  Python ↔ JavaScript parity; REST API tests. Dev dependencies in `requirements-dev.txt`.
- Custom horizon profile: dialog with Stellarium / NINA / CSV import, silhouette on the sky, labels hidden behind it,
  and imageable hours / "above min. altitude" computed against max(min. altitude, horizon).
- Altitude chart: imageable window (brighter when the Moon is down), horizon profile, meridian line,
  airmass axis and a legend.
- Deep-sky catalog from OpenNGC (1 036 objects, accurate sizes and PAs), built by `tools/build_catalog.py`;
  the old hand-made list is kept only as a fallback for objects OpenNGC lacks (Sh2-101, LDN 1235, IC 2118, M102, …).
- Label decluttering: overlapping labels are hidden by priority
  (selected object > Sun/Moon > planets > deep-sky objects by size > stars by brightness).
- Screenshots section in the README, incl. mosaic and framing-panel screenshots.
- Mount type per setup (Equatorial / Alt-Az).
- Mosaics: columns × rows with overlap %, panel numbers, total mosaic size.
- Draggable FOV frame (anchored to RA/Dec) and a rotation handle ⟳ that sets the camera position angle.
- Server-side storage (SQLite, `data/astro.db`) for equipment setups and planned targets;
  REST API: `/api/setups`, `/api/targets`, `/api/targets/{id}/panels`, `/api/settings`.
- Targets list in the side panel: save the current frame, load, rename, overwrite, delete.
- Framing panel: frame centre and PA, anchor / follow view, go to frame, copy panel coordinates (RA/Dec/PA) to the clipboard.

### Changed
- Front end split from one 1 100-line `app.js` into ES modules in `static/js/`.
- Uncaught errors are shown in a red bar at the top instead of failing silently.
- HUD coordinates are labelled J2000.
- Equipment setups moved from browser localStorage to the server; existing setups are migrated automatically on first load.
- The FOV frame is drawn on the celestial sphere instead of as a screen overlay, so it follows
  sky projection and rotation exactly; selecting / centering an object anchors the frame on it.
- Three.js 0.160.0 is bundled in `static/vendor/` — the app no longer needs a CDN and works fully offline.

### Fixed
- Page layout no longer breaks when the header wraps to two lines; the toolbar no longer covers the time HUD.
- Duplicate catalog entries (Caldwell 14 = NGC 869/884; Caldwell 9 is listed as Sh2-155).
- Moon position was off by up to 2.5° (wrong sign of the evection term); now within ~13′.
- Rise and set of deep-sky objects use the standard altitude −0.57° (refraction).
- FOV frame now rotates with the sky for equatorial mounts (fixed to celestial north);
  rotation is a position angle measured north through east.
- Planet names in the planet detail and planets table were hard to read in the Light theme;
  they now use theme colours with a coloured swatch.

## [0.1.0] – 2026-11-02

First release.

### Added
- FastAPI backend with catalog, night and visibility endpoints; dependency-free astronomy
  (sidereal time, Sun, Moon, twilight, rise/transit/set, imageable hours, moonless hours, Moon separation).
- 3D sky in Three.js: horizon, cardinal points, equatorial and Alt/Az grids, Sun and Moon.
- Deep-sky catalog: 110 Messier objects and ~50 popular NGC/IC/Sh2 targets, drawn with true size and position angle.
- Object table with sorting, search, type filter, "imageable tonight" and "fits in FOV" filters.
- Object detail with nightly altitude chart, Moon curve and minimum-altitude line.
- Time slider, "Now", playback and twilight bar.
- Stars to mag 8 with colours, zoom-dependent limiting magnitude, constellation lines.
- Names of bright stars with Bayer designations when zoomed in.
- Planets Mercury–Neptune (JPL elements, Mallama phase curves) on the sky, in a planets table and with their own detail panel and tracking.
- Equipment dialog with multiple telescope + camera setups, camera presets, computed FOV / image scale / f-ratio;
  several FOV frames can be shown at once.
- Local sky images in `images/` with optional JSON sidecar (fov, rotation, centre);
  `tools/download_images.py` builds DSS2 colour images from NASA SkyView.
- Dark, Light and Red (night-vision) themes, switchable with **T**.
- Date input in dd-mm-yyyy with calendar and previous/next-night buttons.
- Zenith and Pole buttons, zenith and celestial-pole markers.
- MIT license, README.
- BSD 3-Clause license and attribution for bundled d3-celestial data (`static/data/`).

### Changed
- Whole application translated to English.
- Images are served from the local `images/` folder instead of being fetched from CDS at runtime.
- Labels are placed to the right of objects (Stellarium/KStars style).
- Classic arrow cursor over the sky.

### Fixed
- Sun and Moon showed through the ground below the horizon.
- Sun/Moon labels ignored the "Labels" toggle.
- Zenith button appeared to do nothing when zoomed in.
- Object labels showed through the toolbar and time bar.
