# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Label decluttering: overlapping labels are hidden by priority
  (selected object > planets > Sun/Moon > deep-sky objects by size > stars by brightness).
- Screenshots section in the README.

### Fixed
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
