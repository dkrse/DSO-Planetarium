// Evaluates static/astro.js for the parity tests: reads a JSON job list, prints JSON results.
import * as A from '../static/astro.js';
const jobs = JSON.parse(process.argv[2]);
const out = jobs.map(({ t, lat, lon, objects }) => {
  const j = A.jd(new Date(t)), l = A.lstDeg(j, lon);
  const pos = (ra, dec) => A.altaz(ra, dec, lat, l);
  return {
    objects: objects.map(([ra, dec]) => pos(...A.precess(ra, dec, j))),
    sun: pos(...A.sunRaDec(j)),
    moon: pos(...A.moonRaDec(j)),
    planets: Object.fromEntries(A.planets(j).map((p) => [p.name, pos(...A.precess(p.ra, p.dec, j))])),
  };
});
console.log(JSON.stringify(out));
