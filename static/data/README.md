# Data files

| file | content | source |
|---|---|---|
| `stars.json` | ~41 000 stars to mag 8: `[ra°, dec°, mag, B−V]` | d3-celestial `stars.8.json` |
| `starnames.json` | 912 named stars to mag 4.5: `[ra°, dec°, mag, name, bayer]` | d3-celestial `starnames.json` + `stars.6.json` |
| `const.json` | constellation lines: `[id, [[[ra°, dec°], …], …]]` | d3-celestial `constellations.lines.json` |

The files were converted to a compact format (fields reduced, RA normalised to 0–360°)
from [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn,
licensed under the BSD 3-Clause License — see [`LICENSE-d3-celestial.txt`](LICENSE-d3-celestial.txt).
The underlying star data derive from the Hipparcos and Tycho catalogues (ESA).
