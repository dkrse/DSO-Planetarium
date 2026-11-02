# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
