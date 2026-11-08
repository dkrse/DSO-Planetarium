// Astronomy for the planetarium. Pure functions, no DOM.
//
// Coordinate pipeline for catalogue objects (stars, deep-sky):
//   J2000/ICRS unit vector  →  proper motion to the date  →  annual aberration
//   →  precession (IAU 1976) · nutation (IAU 1980, main terms)  =  true equator & equinox of date
//   →  Earth rotation (Greenwich apparent sidereal time) + observer latitude  =  horizontal (N, E, Up)
//   →  atmospheric refraction (optional)
// Sun and Moon are computed directly in the true equator of date; the Moon is made topocentric (parallax up to 1°).
// Accuracy (checked against astropy in tests/): stars ≪ 1″, Sun ~ 10″, Moon ~ 30″, planets ~ 1′.

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const mod = (a, b) => ((a % b) + b) % b;
const AS = D2R / 3600;   // arcsecond in radians

/** ΔT = TT − UT1 in seconds (≈ 69 s around 2020–2030; the error on the Moon is ~0.5″ per second of ΔT). */
export const DELTA_T = 69.2;

export const jdUT = (date) => date.getTime() / 86400000 + 2440587.5;
export const jdTT = (jdut) => jdut + DELTA_T / 86400;
const cent = (jdtt) => (jdtt - 2451545) / 36525;

// ---------------------------------------------------------------- vectors & matrices
export const vec = (raDeg, decDeg) => {
  const a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
};
export const radec = (v) => {
  const r = Math.hypot(v[0], v[1], v[2]);
  return [mod(Math.atan2(v[1], v[0]) * R2D, 360), Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * R2D];
};
export const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const apply = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
export const transpose = (M) => [0, 1, 2].map((i) => [M[0][i], M[1][i], M[2][i]]);
export const norm = (v) => { const r = Math.hypot(v[0], v[1], v[2]); return [v[0] / r, v[1] / r, v[2] / r]; };
// rotations of the coordinate axes (IERS convention R1, R2, R3)
const R1 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
const R2 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; };
const R3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };

// ---------------------------------------------------------------- precession, nutation, sidereal time
/** IAU 1976 precession J2000 → mean equator & equinox of date (Lieske 1977). */
export function precessionMatrix(T) {
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  return mul(R3(-z), mul(R2(th), R3(-zeta)));
}
/** Mean obliquity of the ecliptic (IAU 1980), radians. */
export const meanObliquity = (T) => (84381.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T ** 3) * AS;

/** Nutation in longitude and obliquity (IAU 1980, terms ≥ 0.1″; error < 0.5″), radians. */
export function nutation(T) {
  const Om = (125.04452 - 1934.136261 * T) * D2R;
  const L = (280.4665 + 36000.7698 * T) * D2R, Lm = (218.3165 + 481267.8813 * T) * D2R;
  const dpsi = -17.20 * Math.sin(Om) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * Om);
  const deps = 9.20 * Math.cos(Om) + 0.57 * Math.cos(2 * L) + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * Om);
  return [dpsi * AS, deps * AS];
}
/** Greenwich mean sidereal time (IAU 1982), degrees. */
export function gmst(jdut) {
  const T = (jdut - 2451545) / 36525;
  return mod(280.46061837 + 360.98564736629 * (jdut - 2451545) + 0.000387933 * T * T - T ** 3 / 38710000, 360);
}

/**
 * Everything that depends only on time and place. `frame(date, lat, lon)` returns:
 *  T, jd (UT), jde (TT), eps (true obliquity), lst (local apparent sidereal time, deg),
 *  NP  : J2000 → true equator of date,  H : true equator of date → horizontal (N, E, Up),
 *  HNP : H·NP,  vEarth : Earth velocity / c in the J2000 frame (for aberration).
 */
export function frame(date, lat, lon) {
  const jd = jdUT(date), jde = jdTT(jd), T = cent(jde);
  const P = precessionMatrix(T), [dpsi, deps] = nutation(T), eps0 = meanObliquity(T), eps = eps0 + deps;
  const N = mul(R1(-eps), mul(R3(-dpsi), R1(eps0)));
  const NP = mul(N, P);
  const lst = mod(gmst(jd) + dpsi * Math.cos(eps) * R2D + lon, 360);
  const p = lat * D2R, sp = Math.sin(p), cp = Math.cos(p);
  // R3(lst): x → meridian, y → east (H = −90°); then tilt to (North, East, Up)
  const L = [[-sp, 0, cp], [0, 1, 0], [cp, 0, sp]];
  const H = mul(L, R3(lst * D2R));
  return { jd, jde, T, eps, dpsi, lst, lat, lon, NP, H, HNP: mul(H, NP), vEarth: earthVelocity(jde) };
}

/** Annual aberration (first order, error < 0.001″ · 20): u + v/c, renormalised. */
export const aberrate = (u, b) => norm([u[0] + b[0], u[1] + b[1], u[2] + b[2]]);

/** Apply proper motion (mas/yr, μα* includes cos δ) from J2000 to Julian year `y`, returning a unit vector. */
export function properMotion(u, raDeg, decDeg, pmra, pmde, years) {
  if (!pmra && !pmde) return u;
  const a = raDeg * D2R, d = decDeg * D2R, k = years * AS / 1000;
  const e = [-Math.sin(a), Math.cos(a), 0], n = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  return norm([u[0] + k * (pmra * e[0] + pmde * n[0]), u[1] + k * (pmra * e[1] + pmde * n[1]), u[2] + k * (pmra * e[2] + pmde * n[2])]);
}

/** Horizontal vector (N, E, Up) → [alt, az] degrees, az from north through east. */
export const altaz = (h) => [Math.asin(Math.max(-1, Math.min(1, h[2]))) * R2D, mod(Math.atan2(h[1], h[0]) * R2D, 360)];
export const fromAltAz = (alt, az) => {
  const a = alt * D2R, z = az * D2R;
  return [Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)];
};

// Refraction for 1010 hPa, 10 °C, dry air, visual light (0.55 µm).
// Above 15°: the A·tan z + B·tan³ z model of ERFA refco (Hohenkerk & Sinclair) — agrees with astropy to < 0.5″.
// Below 15°: Sæmundsson's formula (good to the horizon), scaled to join the model continuously at 15°.
const REF_A = 2.81533e-4 * R2D, REF_B = -3.1525e-7 * R2D;   // degrees
const refAB = (trueAlt) => {
  let r = 0;
  for (let i = 0; i < 3; i++) { const t = Math.tan((90 - trueAlt - r) * D2R); r = REF_A * t + REF_B * t * t * t; }
  return r;
};
const saem = (h) => 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;
const REF_K = refAB(15) / saem(15);
/** Refraction (degrees) for a true (airless) altitude in degrees. */
export function refraction(alt) {
  if (alt < -1.9) return 0;
  if (alt >= 15) return refAB(alt);
  return saem(Math.max(alt, -1.9)) * REF_K;
}
/** Apply refraction to a horizontal unit vector (lifts it towards the zenith). */
export function refract(h) {
  const alt = Math.asin(Math.max(-1, Math.min(1, h[2]))) * R2D, r = refraction(alt);
  if (!r) return h;
  const a = (alt + r) * D2R, c = Math.cos(a), k = Math.hypot(h[0], h[1]) || 1;
  return [h[0] / k * c, h[1] / k * c, Math.sin(a)];
}
/** Inverse of refract (apparent → true), for converting mouse positions to coordinates. */
export function unrefract(h) {
  const app = Math.asin(Math.max(-1, Math.min(1, h[2]))) * R2D;
  let t = app;
  for (let i = 0; i < 4; i++) t = app - refraction(t);
  const a = t * D2R, c = Math.cos(a), k = Math.hypot(h[0], h[1]) || 1;
  return [h[0] / k * c, h[1] / k * c, Math.sin(a)];
}

// ---------------------------------------------------------------- Sun (Meeus ch. 25, ~0.01°)
export function sunApparent(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  const nu = M + C * D2R, R = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu));
  const Om = (125.04 - 1934.136 * T) * D2R;
  const lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(Om)) * D2R;   // apparent: aberration + nutation
  return { lam, beta: 0, dist: R };   // ecliptic of date, AU
}

// ---------------------------------------------------------------- Moon (Meeus ch. 47, main terms; ~10″ lon, ~5″ lat)
// [D, M, M', F, Σl (1e-6°), Σr (1e-3 km)]
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
// [D, M, M', F, Σb (1e-6°)]
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];
/** Geocentric Moon, ecliptic & equinox of date (apparent = + Δψ). dist in km. */
export function moonGeocentric(T, dpsi = 0) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000;
  const A1 = (119.75 + 131.849 * T) * D2R, A2 = (53.09 + 479264.29 * T) * D2R, A3 = (313.45 + 481266.484 * T) * D2R;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T, Ef = [1, E, E * E];
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * D2R, k = Ef[Math.abs(m)];
    sl += l * k * Math.sin(arg); sr += r * k * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) sb += b * Ef[Math.abs(m)] * Math.sin((d * D + m * M + mp * Mp + f * F) * D2R);
  const LpR = Lp * D2R, MpR = Mp * D2R, FR = F * D2R;
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - FR) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - FR) + 175 * Math.sin(A1 + FR)
    + 127 * Math.sin(LpR - MpR) - 115 * Math.sin(LpR + MpR);
  return { lam: (Lp + sl / 1e6) * D2R + dpsi, beta: (sb / 1e6) * D2R, dist: 385000.56 + sr / 1000 };
}
const eclToEqVec = (lam, beta, eps) => {
  const cb = Math.cos(beta), x = cb * Math.cos(lam), y = cb * Math.sin(lam), z = Math.sin(beta);
  return [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
};

const EARTH_RADIUS_KM = 6378.137, AU_KM = 149597870.7;
/** Topocentric correction in the true equator of date: geocentric vector (km) − observer (km). */
function topocentric(u, distKm, F) {
  const p = F.lat * D2R, f = 1 / 298.257223563;   // WGS-84; geocentric latitude of the observer
  const u0 = Math.atan((1 - f) * Math.tan(p)), rc = Math.cos(u0), rs = (1 - f) * Math.sin(u0);
  const th = F.lst * D2R, R = EARTH_RADIUS_KM;
  const o = [R * rc * Math.cos(th), R * rc * Math.sin(th), R * rs];
  const g = [u[0] * distKm - o[0], u[1] * distKm - o[1], u[2] * distKm - o[2]];
  const d = Math.hypot(...g);
  return { u: [g[0] / d, g[1] / d, g[2] / d], dist: d };
}

// ---------------------------------------------------------------- planets (JPL Keplerian elements, Standish)
// [a, e, I, L, ϖ, Ω] and rates per Julian century, J2000 ecliptic; valid 1800–2050, error ~ 1′.
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
// absolute magnitude H, phase coefficient (mag/°), equatorial diameter at 1 AU (″), colour
export const PLANET_INFO = {
  Mercury: { H: -0.42, k: 0.038, d: 6.74, color: '#c9b8a3' },
  Venus: { H: -4.40, k: 0.0009, d: 16.92, color: '#fff2c8' },
  Mars: { H: -1.52, k: 0.016, d: 9.36, color: '#ff8a5c' },
  Jupiter: { H: -9.40, k: 0.005, d: 196.94, color: '#f3d9b1' },
  Saturn: { H: -8.88, k: 0.044, d: 165.6, color: '#ead39c' },
  Uranus: { H: -7.19, k: 0.002, d: 70.48, color: '#a8e4ef' },
  Neptune: { H: -6.87, k: 0, d: 68.3, color: '#7d9bff' },
};
function phaseMag(name, i) {   // Mallama & Hilton (2018) for Mercury / Venus, linear for the rest
  const poly = (c) => c.reduce((s, k, n) => s + k * i ** n, 0);
  if (name === 'Mercury') return poly([-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12]);
  if (name === 'Venus') return i < 163.7 ? poly([-4.384, -1.044e-3, 3.687e-4, -2.814e-6, 8.938e-9]) : poly([236.05828, -2.81914, 8.39034e-3]);
  return PLANET_INFO[name].H + PLANET_INFO[name].k * i;
}
// Residuals DE440 − Kepler (static/data/ephemeris.json, built by tools/build_ephemeris.py), cubic interpolation.
let EPH = null;
export function setEphemeris(e) { EPH = e; }
function residual(name, jde) {
  const b = EPH && EPH.bodies[name];
  if (!b) return [0, 0, 0];
  const n = b.d.length / 3, x = (jde - EPH.t0) / b.step;
  if (x < 1 || x > n - 3) return [0, 0, 0];   // outside 1900–2100: Kepler only (~1′)
  const i = Math.floor(x), f = x - i, out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p0 = b.d[(i - 1) * 3 + c], p1 = b.d[i * 3 + c], p2 = b.d[(i + 1) * 3 + c], p3 = b.d[(i + 2) * 3 + c];
    out[c] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}
export const hasEphemeris = () => !!EPH;
/** Heliocentric position, J2000 ecliptic, AU: Kepler + DE440 residual. 'Earth' = Earth–Moon barycentre. */
function helio(name, T) {
  const k = kepler(name, T), r = residual(name, T * 36525 + 2451545);
  return [k[0] + r[0], k[1] + r[1], k[2] + r[2]];
}
/** Heliocentric Earth (geocentre) = EMB − Moon / (1 + M⊕/M☾). */
function helioEarth(T) {
  const b = helio('Earth', T), m = moonGeocentric(T), d = m.dist / AU_KM / 82.30057;
  const v = eclDateToJ2000Ecl(m.lam, m.beta, T);
  return [b[0] - d * v[0], b[1] - d * v[1], b[2] - d * v[2]];
}
// ecliptic of date → J2000 ecliptic, only needed approximately (for the 4 670 km EMB offset): rotate by general precession
function eclDateToJ2000Ecl(lam, beta, T) {
  const l = lam - 5029.0966 * T * AS, cb = Math.cos(beta);
  return [cb * Math.cos(l), cb * Math.sin(l), Math.sin(beta)];
}
function kepler(name, T) {
  const [e0, r] = EL[name], [a, e, I, L, wp, Om] = e0.map((v, i) => v + r[i] * T);
  const w = (wp - Om) * D2R, M = mod(L - wp + 180, 360) * D2R - Math.PI;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 10; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om * D2R), sO = Math.sin(Om * D2R), cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp];
}
const EPS2000 = 84381.448 * AS;
const eclJ2000ToEq = (v) => [v[0], v[1] * Math.cos(EPS2000) - v[2] * Math.sin(EPS2000), v[1] * Math.sin(EPS2000) + v[2] * Math.cos(EPS2000)];
const C_AU_DAY = 173.1446327;
/** Earth's heliocentric velocity / c in the J2000 equatorial frame. */
export function earthVelocity(jde) {
  const h = 0.05, a = helio('Earth', cent(jde - h)), b = helio('Earth', cent(jde + h));   // EMB: barycentric-ish velocity
  return eclJ2000ToEq([0, 1, 2].map((i) => (b[i] - a[i]) / (2 * h) / C_AU_DAY));
}

/**
 * Sun, Moon and planets for frame F.
 * Each body: { name, u (unit vector, true equator of date, topocentric for Sun & Moon), ra, dec (of date),
 *   raJ, decJ (J2000), dist (AU), mag, diam (″), phase (°), illum (0–1) }
 */
export function bodies(F) {
  const T = cent(F.jde), out = [], NPt = transpose(F.NP);
  const add = (name, uDate, dist, mag, diam, phase) => {
    const [ra, dec] = radec(uDate), [raJ, decJ] = radec(apply(NPt, uDate));
    out.push({ name, u: uDate, ra, dec, raJ, decJ, dist, mag, diam, phase, illum: (1 + Math.cos(phase * D2R)) / 2 });
  };
  const E = EPH ? helioEarth(T) : helio('Earth', T);
  // Sun: from the ephemeris (geocentric = −Earth, light-time, aberration) or Meeus' series as a fallback
  let sg, sdist;
  if (EPH) {
    sdist = Math.hypot(...E);   // the Sun barely moves during the light time: geocentric = −Earth(t)
    sg = apply(F.NP, aberrate(norm(eclJ2000ToEq([-E[0], -E[1], -E[2]])), F.vEarth));
  } else {
    const s = sunApparent(T); sdist = s.dist; sg = eclToEqVec(s.lam, 0, F.eps);
  }
  const st = topocentric(sg, sdist * AU_KM, F), s = { dist: sdist };
  add('Sun', st.u, s.dist, -26.74, 1919.26 / s.dist, 0);
  // Moon
  const m = moonGeocentric(T, F.dpsi), mg = eclToEqVec(m.lam, m.beta, F.eps), mt = topocentric(mg, m.dist, F);
  const elong = Math.acos(Math.max(-1, Math.min(1, mg[0] * sg[0] + mg[1] * sg[1] + mg[2] * sg[2])));
  const Rs = s.dist * AU_KM, mi = Math.atan2(Rs * Math.sin(elong), m.dist - Rs * Math.cos(elong)) * R2D;
  add('Moon', mt.u, mt.dist / AU_KM, -12.73 + 0.026 * mi + 4e-9 * mi ** 4, 2 * Math.asin(1737.4 / mt.dist) * R2D * 3600, mi);
  // planets: light-time corrected, then aberration and precession-nutation like the stars
  for (const name of Object.keys(PLANET_INFO)) {
    let P = helio(name, T), g, dist = 0;
    for (let k = 0; k < 2; k++) {
      g = [P[0] - E[0], P[1] - E[1], P[2] - E[2]]; dist = Math.hypot(...g);
      P = helio(name, cent(F.jde - dist / C_AU_DAY));
    }
    g = [P[0] - E[0], P[1] - E[1], P[2] - E[2]]; dist = Math.hypot(...g);
    const r = Math.hypot(...P), R = Math.hypot(...E);
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) * R2D;
    const uJ = aberrate(norm(eclJ2000ToEq(g)), F.vEarth);
    const tp = topocentric(apply(F.NP, uJ), dist * AU_KM, F);   // parallax: Venus up to 30″
    add(name, tp.u, dist, 5 * Math.log10(r * dist) + phaseMag(name, phase), PLANET_INFO[name].d / dist, phase);
  }
  return out;
}

// ---------------------------------------------------------------- catalogue object → true equator of date
/** J2000 position (+ proper motion in mas/yr) → unit vector in the true equator of date. */
export function catalogueToDate(F, ra, dec, pmra = 0, pmde = 0) {
  let u = vec(ra, dec);
  if (pmra || pmde) u = properMotion(u, ra, dec, pmra, pmde, (F.jde - 2451545) / 365.25);
  return apply(F.NP, aberrate(u, F.vEarth));
}

// ---------------------------------------------------------------- rise / transit / set
/**
 * Rise, upper transit and set nearest to `date` within ±12 h. `posFn(F)` returns the unit vector in the true equator
 * of date for frame F; `h0` is the geometric altitude of the event (−0.5667° for stars, minus the semidiameter for the
 * Sun and Moon — refraction at the horizon is included in h0). Sampled every 10 min, refined by bisection (< 1 s).
 */
export function riseTransitSet(posFn, h0, date, lat, lon) {
  const now = date.getTime(), t0 = now - 12 * 3600e3, N = 144, step = 600e3;
  const at = (t) => { const G = frame(new Date(t), lat, lon), u = posFn(G); return [altaz(apply(G.H, u))[0] - h0, mod(G.lst - radec(u)[0] + 180, 360) - 180]; };
  const refine = (i, a, b) => {
    let fa = at(a)[i];
    for (let k = 0; k < 22; k++) { const m = (a + b) / 2, fm = at(m)[i]; if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; }
    return (a + b) / 2;
  };
  const closer = (old, t) => (old == null || Math.abs(t - now) < Math.abs(old - now) ? t : old);
  let [pa, ph] = at(t0), rise = null, set = null, transit = null, any = pa > 0, all = pa > 0;
  for (let i = 1; i <= N; i++) {
    const t = t0 + i * step, [a, h] = at(t);
    if (a > 0) any = true; else all = false;
    if (pa <= 0 && a > 0) rise = closer(rise, refine(0, t - step, t));
    if (pa > 0 && a <= 0) set = closer(set, refine(0, t - step, t));
    if (ph < 0 && h >= 0 && h - ph < 90) transit = closer(transit, refine(1, t - step, t));
    pa = a; ph = h;
  }
  const d = (t) => (t == null ? null : new Date(t));
  return { rise: d(rise), set: d(set), transit: d(transit), maxAlt: transit == null ? null : at(transit)[0] + h0, circ: all, never: !any };
}

// ---------------------------------------------------------------- formatting
export function fmtRA(deg) {
  let s = Math.round(mod(deg, 360) / 15 * 36000) / 10;   // tenths of a second of time
  const H = Math.floor(s / 3600); s -= H * 3600; const M = Math.floor(s / 60); s -= M * 60;
  return `${String(H % 24).padStart(2, '0')}h ${String(M).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}
export function fmtDec(deg) {
  const sg = deg < 0 ? '−' : '+';
  let s = Math.round(Math.abs(deg) * 3600);
  const D = Math.floor(s / 3600); s -= D * 3600; const M = Math.floor(s / 60); s -= M * 60;
  return `${sg}${String(D).padStart(2, '0')}° ${String(M).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}
export function fmtAngle(deg) {   // object sizes
  if (deg >= 1) return `${deg.toFixed(2)}°`;
  if (deg * 60 >= 1) return `${(deg * 60).toFixed(1)}′`;
  return `${(deg * 3600).toFixed(1)}″`;
}
