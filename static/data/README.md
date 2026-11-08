# Data files

One source per kind of data. All files are generated — do not edit them by hand.

| file | content | source | built by |
|---|---|---|---|
| `stars.json` | 117 955 stars: `[hip, ra°, dec°, pmRA mas/yr, pmDec mas/yr, V, B−V]` at J2000.0 (ICRS), sorted by V; IAU / Stellarium names by HIP | **Hipparcos Main Catalogue** (ESA 1997, I/239), HEASARC copy | `tools/build_data.py` |
| `dso.json` | 13 372 deep-sky objects: id, other ids, type, J2000 position, major/minor axis (′), position angle (°), magnitude, surface brightness, constellation, common names | **OpenNGC** by Mattia Verga (CC-BY-SA-4.0), `NGC.csv` + `addendum.csv` | `tools/build_data.py` |
| `constellations.json` | 88 constellation figures as HIP numbers; IAU boundaries (B1875 vertices) | **Stellarium** sky culture “modern” (GPL-2.0+), boundaries from Delporte (1930) | `tools/build_data.py` |
| `ephemeris.json` | residuals DE440 − Kepler for Mercury … Neptune and the Earth–Moon barycentre, 1900–2100 | **JPL DE440s** | `tools/build_ephemeris.py` |

Constellation lines contain no coordinates — only HIP numbers — so they always pass exactly through the Hipparcos
stars of `stars.json`.

OpenNGC objects of type `Dup` become aliases of the object they duplicate (e.g. `M 102` → `M 101`), `NonEx` objects are
dropped. When OpenNGC gives no position angle, the planetarium draws the object as a dashed circle of its major axis
instead of inventing an orientation.
