// Client-side astronomy (mirror of app/astro.py) – for smooth 3D animation.
export const D2R = Math.PI / 180, SID = 360.98564736629;
const mod = (a, b) => ((a % b) + b) % b;

export const jd = (date) => date.getTime() / 86400000 + 2440587.5;
export const lstDeg = (j, lon) => mod(280.46061837 + SID * (j - 2451545) + lon, 360);

export function altaz(ra, dec, lat, lst) {
  const H = (lst - ra) * D2R, d = dec * D2R, p = lat * D2R;
  const s = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, s)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(d) * Math.cos(p));
  return [alt / D2R, mod(az / D2R + 180, 360)];
}

function eclToEq(lam, beta, eps) {
  lam *= D2R; beta *= D2R; eps *= D2R;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam));
  return [mod(ra / D2R, 360), dec / D2R];
}

export function sunEcl(j) {
  const n = j - 2451545, L = mod(280.46 + 0.9856474 * n, 360), g = (357.528 + 0.9856003 * n) * D2R;
  return [mod(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g), 360), 23.439 - 4e-7 * n];
}
export const sunRaDec = (j) => { const [l, e] = sunEcl(j); return eclToEq(l, 0, e); };

export function moonEcl(j) {
  const d = j - 2451545, L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.22935 * d) * D2R;
  const D = (297.85 + 12.190749 * d) * D2R, Ms = (357.529 + 0.98560028 * d) * D2R;
  const lon = L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F);
  const lat = 5.128 * Math.sin(F) + 0.28 * Math.sin(M + F) + 0.277 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F);
  return [mod(lon, 360), lat];
}
export const moonRaDec = (j) => { const [l, b] = moonEcl(j); return eclToEq(l, b, sunEcl(j)[1]); };
export function moonIllum(j) {
  const [l, b] = moonEcl(j), [s] = sunEcl(j);
  return (1 - Math.cos(b * D2R) * Math.cos((l - s) * D2R)) / 2;
}

// IAU 1976 precession matrix J2000 → mean equator of date (row-major 3×3)
export function precessionMatrix(j) {
  const T = (j - 2451545) / 36525, a = D2R / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * a;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * a;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * a;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  return [[cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct]];
}
/** J2000 → of date (inverse: of date → J2000), degrees */
export function precess(ra, dec, j, inverse = false) {
  const P = precessionMatrix(j), v = [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
  const w = [0, 1, 2].map((i) => inverse ? P[0][i] * v[0] + P[1][i] * v[1] + P[2][i] * v[2] : P[i][0] * v[0] + P[i][1] * v[1] + P[i][2] * v[2]);
  return [mod(Math.atan2(w[1], w[0]) / D2R, 360), Math.asin(Math.max(-1, Math.min(1, w[2]))) / D2R];
}

// sensor field of view (degrees)
export const fovDeg = (sizeMm, focalMm) => 2 * Math.atan(sizeMm / (2 * focalMm)) / D2R;

export function fmtRA(deg) {
  const h = mod(deg, 360) / 15, H = Math.floor(h), m = (h - H) * 60, M = Math.floor(m), s = (m - M) * 60;
  return `${H}h ${String(M).padStart(2, '0')}m ${s.toFixed(0).padStart(2, '0')}s`;
}
export function fmtDec(deg) {
  const sg = deg < 0 ? '−' : '+', a = Math.abs(deg), D = Math.floor(a), m = (a - D) * 60;
  return `${sg}${D}° ${String(Math.floor(m)).padStart(2, '0')}′`;
}

// ---------------------------------------------------------------- planets
// JPL approximate Keplerian elements (Standish, valid 1800–2050), J2000 ecliptic.
// [a, e, I, L, varpi, Omega] and their rates per Julian century. Accuracy ~1′.
const EL = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  Mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
// absolute magnitude H, phase coefficient [mag/deg], equatorial diameter at 1 AU [″], display color
export const PLANET_INFO = {
  Mercury: { H: -0.42, k: 0.038, d: 6.74, color: '#c9b8a3' },
  Venus: { H: -4.40, k: 0.0009, d: 16.92, color: '#fff2c8' },
  Mars: { H: -1.52, k: 0.016, d: 9.36, color: '#ff8a5c' },
  Jupiter: { H: -9.40, k: 0.005, d: 196.94, color: '#f3d9b1' },
  Saturn: { H: -8.88, k: 0.044, d: 165.6, color: '#ead39c' },
  Uranus: { H: -7.19, k: 0.002, d: 70.48, color: '#a8e4ef' },
  Neptune: { H: -6.87, k: 0, d: 68.3, color: '#7d9bff' },
};

// Mallama & Hilton (2018) phase curves for Mercury/Venus, linear for the rest
function phaseMag(name, i) {
  const poly = (c) => c.reduce((s, k, n) => s + k * i ** n, 0);
  if (name === 'Mercury') return poly([-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12]);
  if (name === 'Venus') return i < 163.7 ? poly([-4.384, -1.044e-3, 3.687e-4, -2.814e-6, 8.938e-9]) : poly([236.05828, -2.81914, 8.39034e-3]);
  return PLANET_INFO[name].H + PLANET_INFO[name].k * i;
}

function helio(name, T) {
  const [e0, r] = EL[name], [a, e, I, L, wp, Om] = e0.map((v, i) => v + r[i] * T);
  const w = (wp - Om) * D2R, M = mod(L - wp + 180, 360) * D2R - Math.PI;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om * D2R), sO = Math.sin(Om * D2R), cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp];
}

/** Geocentric apparent-ish positions: [{name, ra, dec, dist, r, mag, diam(″)}] */
export function planets(j) {
  const T = (j - 2451545) / 36525, E = helio('Earth', T), eps = 23.43928 * D2R;
  return Object.keys(PLANET_INFO).map((name) => {
    const P = helio(name, T), x = P[0] - E[0], y = P[1] - E[1], z = P[2] - E[2];
    const dist = Math.hypot(x, y, z), r = Math.hypot(...P), R = Math.hypot(...E);
    const ye = y * Math.cos(eps) - z * Math.sin(eps), ze = y * Math.sin(eps) + z * Math.cos(eps);
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) / D2R;
    const info = PLANET_INFO[name];
    return { name, ra: mod(Math.atan2(ye, x) / D2R, 360), dec: Math.atan2(ze, Math.hypot(x, ye)) / D2R, dist, r,
      mag: 5 * Math.log10(r * dist) + phaseMag(name, phase), diam: info.d / dist, phase };
  });
}
