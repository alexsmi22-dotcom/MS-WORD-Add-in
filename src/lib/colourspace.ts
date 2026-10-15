// Colour-space gamut coverage.
//
// PROVENANCE. The chromaticity primaries below were taken MECHANICALLY from the
// colour-science project's dataset modules (repository colour-science/colour,
// files colour/models/rgb/datasets/{srgb,itur_bt_709,itur_bt_2020,dci_p3}.py,
// develop branch, fetched 2026-08-02), which cite IEC 61966-2-1 for sRGB and
// ITU-R BT.709-6 / BT.2020 for the broadcast spaces. They were extracted by a
// script and no coordinate was typed by hand. `colourspace.crosscheck.test.ts`
// validates them against facts known independently of the file — chiefly that
// sRGB and Rec.709 share primaries exactly, which is true by construction of
// the sRGB standard and would break immediately on a transcription slip.
//
// This is the same treatment the NASA polynomials in flame.ts received, and the
// condition under which bundled reference data is acceptable here at all.
//
// WHY COVERAGE IS REPORTED IN u'v' AS WELL AS xy. The CIE 1931 xy diagram is
// badly non-uniform: it devotes a huge area to greens the eye discriminates
// poorly and compresses the blues and purples. CIE 1976 u'v' is far more
// uniform, so an area in it corresponds much better to perceived colour
// difference, and it is the figure to quote.
//
// NOTE that u'v' is not simply the SMALLER number — an early draft of this file
// asserted that and the data disproved it: sRGB covers 52.9% of Rec.2020 in xy
// and 58.0% in u'v'. The direction depends on where the two triangles differ,
// because the transform stretches some regions and compresses others. What is
// true in general is only that the two metrics disagree materially, which is
// why both are reported instead of one being chosen for the reader.

export interface ColourError {
  ok: false;
  error: string;
}

/** A chromaticity coordinate. */
export interface Chromaticity {
  x: number;
  y: number;
}

export interface Gamut {
  id: string;
  label: string;
  /** Red, green, blue primaries in CIE 1931 xy. */
  primaries: [Chromaticity, Chromaticity, Chromaticity];
  /** Where the numbers came from. */
  source: string;
}

const P = (x: number, y: number): Chromaticity => ({ x, y });

/** Script-extracted; see the provenance note above. */
export const GAMUTS: Gamut[] = [
  {
    id: "srgb",
    label: "sRGB",
    primaries: [P(0.64, 0.33), P(0.3, 0.6), P(0.15, 0.06)],
    source: "IEC 61966-2-1",
  },
  {
    id: "bt709",
    label: "Rec. 709 (HDTV)",
    primaries: [P(0.64, 0.33), P(0.3, 0.6), P(0.15, 0.06)],
    source: "ITU-R BT.709-6",
  },
  {
    id: "dcip3",
    label: "DCI-P3",
    primaries: [P(0.68, 0.32), P(0.265, 0.69), P(0.15, 0.06)],
    source: "SMPTE RP 431-2 / DCI",
  },
  {
    id: "bt2020",
    label: "Rec. 2020 (UHDTV)",
    primaries: [P(0.708, 0.292), P(0.17, 0.797), P(0.131, 0.046)],
    source: "ITU-R BT.2020",
  },
];

export function gamutById(id: string): Gamut | undefined {
  return GAMUTS.find((g) => g.id === id);
}

/**
 * CIE 1931 xy to CIE 1976 u'v'.
 *
 * u' = 4x / (−2x + 12y + 3), v' = 9y / (−2x + 12y + 3). The transform exists
 * because xy is perceptually lopsided; u'v' is roughly uniform, so an area in
 * it means something closer to "how much colour difference".
 */
export function xyToUv(c: Chromaticity): Chromaticity {
  const d = -2 * c.x + 12 * c.y + 3;
  if (d === 0) return { x: 0, y: 0 };
  return { x: (4 * c.x) / d, y: (9 * c.y) / d };
}

/** Signed area of a polygon by the shoelace formula. */
function polygonArea(pts: Chromaticity[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Sutherland-Hodgman clip of `subject` against the convex polygon `clip`.
 *
 * Coverage is the area of the INTERSECTION of two gamut triangles over the area
 * of the reference, not the ratio of their areas. Those differ whenever one
 * gamut is not wholly inside the other, and even when it IS: DCI-P3 contains
 * sRGB entirely, so it covers 100% of it while being 126% of its area. An area
 * ratio quoted as "coverage" would claim 126% coverage of a space it merely
 * encloses — which is precisely the marketing move this reports around.
 */
function clipPolygon(subject: Chromaticity[], clip: Chromaticity[]): Chromaticity[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    // Positive side of the directed edge a->b.
    const side = (p: Chromaticity): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = side(cur) >= 0;
      const prevIn = side(prev) >= 0;
      if (curIn !== prevIn) {
        const t = side(prev) / (side(prev) - side(cur));
        output.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      if (curIn) output.push(cur);
    }
  }
  return output;
}

/** Orders a triangle's vertices counter-clockwise, as the clipper expects. */
function ccw(tri: Chromaticity[]): Chromaticity[] {
  let a = 0;
  for (let i = 0; i < tri.length; i++) {
    const p = tri[i];
    const q = tri[(i + 1) % tri.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...tri].reverse() : tri;
}

export interface CoverageResult {
  ok: true;
  gamut: string;
  reference: string;
  /** Coverage of the reference, as a fraction, in CIE 1931 xy. */
  coverageXy: number;
  /** The same in CIE 1976 u'v' — the more honest figure. */
  coverageUv: number;
  /** Ratio of the two gamut AREAS in u'v' (can exceed 1). */
  areaRatioUv: number;
  /** Fraction of the gamut that falls OUTSIDE the reference, in u'v'. */
  outsideReferenceUv: number;
  notes: string[];
}

/**
 * How much of `referenceId` the gamut `gamutId` covers.
 *
 * Two numbers that are routinely confused are both reported: COVERAGE (how much
 * of the reference this gamut can actually reproduce) and AREA RATIO (how big
 * this gamut is relative to the reference). DCI-P3 is 126% of sRGB by area and
 * covers exactly 100% of it, because it encloses sRGB completely — the extra
 * area is in colours sRGB never had. Where two gamuts merely overlap, coverage
 * falls below 100% while the ratio can still exceed 1.
 */
export function gamutCoverage(gamutId: string, referenceId: string): CoverageResult | ColourError {
  const g = gamutById(gamutId);
  const ref = gamutById(referenceId);
  if (!g) return { ok: false, error: `Unknown colour space "${gamutId}".` };
  if (!ref) return { ok: false, error: `Unknown reference colour space "${referenceId}".` };

  const measure = (toUv: boolean): { coverage: number; ratio: number; outside: number } => {
    const conv = (c: Chromaticity): Chromaticity => (toUv ? xyToUv(c) : c);
    const gt = ccw(g.primaries.map(conv));
    const rt = ccw(ref.primaries.map(conv));
    const inter = clipPolygon(gt, rt);
    const interArea = inter.length >= 3 ? polygonArea(inter) : 0;
    const gArea = polygonArea(gt);
    const rArea = polygonArea(rt);
    return {
      coverage: rArea > 0 ? interArea / rArea : 0,
      ratio: rArea > 0 ? gArea / rArea : 0,
      outside: gArea > 0 ? 1 - interArea / gArea : 0,
    };
  };

  const xy = measure(false);
  const uv = measure(true);

  const notes: string[] = [
    "COVERAGE and AREA RATIO are different numbers and are both shown. Coverage is how much of " +
      "the reference this space can actually reproduce; area ratio is how big it is relative to " +
      "the reference. A display can be 130% of sRGB by area while covering only 96% of it — the " +
      "extra area is in colours sRGB never had, and the shortfall is in ones it did.",
    "Quote the u'v' figure. CIE 1931 xy is badly non-uniform — it gives a huge area to greens " +
      "the eye discriminates poorly and compresses the blues — so an xy percentage does not " +
      "correspond to perceived difference. The two metrics disagree materially, and which is " +
      "larger depends on where the gamuts differ, so both are shown rather than one chosen.",
    `Primaries: ${g.label} from ${g.source}; ${ref.label} from ${ref.source}. Taken from a ` +
      "published dataset and cross-checked in the test suite, not transcribed by hand.",
    "A gamut TRIANGLE is only part of the story: a real display also has a luminance range and " +
      "a bit depth, and a wide gamut driven by 8 bits shows banding a narrower one would not.",
  ];
  if (uv.outside > 0.001) {
    notes.push(
      `${(uv.outside * 100).toFixed(1)}% of ${g.label} falls OUTSIDE ${ref.label} — those are ` +
        "colours the reference cannot express at all, which is what a wider gamut buys.",
    );
  }
  return {
    ok: true,
    gamut: g.label,
    reference: ref.label,
    coverageXy: xy.coverage,
    coverageUv: uv.coverage,
    areaRatioUv: uv.ratio,
    outsideReferenceUv: uv.outside,
    notes,
  };
}

/** Gamut area in u'v', for ordering colour spaces by size. */
export function gamutAreaUv(gamutId: string): number | null {
  const g = gamutById(gamutId);
  if (!g) return null;
  return polygonArea(ccw(g.primaries.map(xyToUv)));
}

// --- Colour temperature ---------------------------------------------------------
//
// MIRED IS COMPUTED, NEVER A UNIT. mired = 10⁶/T is a RECIPROCAL of
// temperature, and the units converter is linear (value × factor + offset): a
// "mired" key would turn 6500 K into nonsense silently. Same for EV and dB.
// (And never write it "MK⁻¹": "M" is molarity in units.ts, so that string
// would parse as mol·L⁻¹·K⁻¹.)

export interface ColourTempError {
  ok: false;
  error: string;
}

function checkKelvin(name: string, t: number): ColourTempError | null {
  if (!Number.isFinite(t)) return { ok: false, error: `The ${name} must be a finite number of kelvin.` };
  if (t <= 0) return { ok: false, error: `The ${name} must be above absolute zero (got ${t} K).` };
  return null;
}

/** Micro-reciprocal degrees: 10⁶ / T. 3200 K → 312.5 mired. */
export function mired(kelvin: number): number | ColourTempError {
  const e = checkKelvin("colour temperature", kelvin);
  if (e) return e;
  return 1e6 / kelvin;
}

export interface MiredShiftResult {
  ok: true;
  fromMired: number;
  toMired: number;
  /** toMired − fromMired. Negative = toward blue (raising CCT), positive = toward amber. */
  shift: number;
  direction: "blue" | "amber" | "none";
  notes: string[];
}

/**
 * The mired shift that converts light of colour temperature `fromK` to `toK`.
 *
 * Filters are rated in mired because a given filter shifts the MIRED value by
 * about the same amount whatever the source, while its effect in kelvin varies
 * enormously: −133.9 mired takes 3200 K to 5600 K, but the same filter on a
 * 5600 K source would aim for 22,600 K. Gel names and ratings are
 * manufacturer data and are not tabulated here.
 */
export function miredShift(fromK: number, toK: number): MiredShiftResult | ColourTempError {
  const a = checkKelvin("starting colour temperature", fromK);
  if (a) return a;
  const b = checkKelvin("target colour temperature", toK);
  if (b) return b;
  const fromMired = 1e6 / fromK;
  const toMired = 1e6 / toK;
  const shift = toMired - fromMired;
  const direction = shift < 0 ? "blue" : shift > 0 ? "amber" : "none";
  return {
    ok: true,
    fromMired,
    toMired,
    shift,
    direction,
    notes: [
      "mired = 10⁶ / T. A filter's effect is roughly constant in mired, not in kelvin, which is why " +
        "colour-correction filters are rated this way.",
      direction === "blue"
        ? `A shift of −${Math.abs(shift).toFixed(1)} mired is a BLUE (cooling, CTB-type) correction.`
        : direction === "amber"
          ? `A shift of +${shift.toFixed(1)} mired is an AMBER (warming, CTO-type) correction.`
          : "The two temperatures are the same; no correction is needed.",
      "Mired is computed here, never converted as a unit — it is the reciprocal of temperature.",
    ],
  };
}

export interface DaylightResult {
  ok: true;
  xy: Chromaticity;
  /** CIE 1976 u'v' of the same point. */
  uv: Chromaticity;
  notes: string[];
}

/** The CIE D-series daylight locus is defined from 4000 K to 25000 K. */
export const DAYLIGHT_RANGE_K: [number, number] = [4000, 25000];

/**
 * Chromaticity of CIE daylight (the D-series) at correlated colour temperature
 * T, by the CIE 15 polynomials:
 *   4000 ≤ T ≤ 7000:  x = −4.6070·10⁹/T³ + 2.9678·10⁶/T² + 0.09911·10³/T + 0.244063
 *   7000 < T ≤ 25000: x = −2.0064·10⁹/T³ + 1.9018·10⁶/T² + 0.24748·10³/T + 0.237040
 *   y = −3.000x² + 2.870x − 0.275
 * T is used AS GIVEN. D65 is the D-series point at 6504 K, not 6500 K: the
 * radiation constant c₂ was revised from 1.4380 to 1.4388 × 10⁻² m·K after
 * the illuminants were defined, which moved the nominal 6500 K to
 * 6500 × 1.4388/1.4380 ≈ 6504 K. Outside 4000–25000 K the polynomials are
 * not defined and the request is refused.
 */
export function daylightXy(kelvin: number): DaylightResult | ColourTempError {
  const e = checkKelvin("colour temperature", kelvin);
  if (e) return e;
  const [lo, hi] = DAYLIGHT_RANGE_K;
  if (kelvin < lo || kelvin > hi) {
    return {
      ok: false,
      error:
        `The CIE daylight (D-series) locus is defined only from ${lo} K to ${hi} K; ${kelvin} K is ` +
        "outside it. Below 4000 K, light sources are described by the Planckian (blackbody) locus, " +
        "which needs the CIE colour-matching functions (not bundled).",
    };
  }
  const T = kelvin;
  const x =
    T <= 7000
      ? -4.607e9 / T ** 3 + 2.9678e6 / T ** 2 + 0.09911e3 / T + 0.244063
      : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 0.24748e3 / T + 0.23704;
  const y = -3.0 * x * x + 2.87 * x - 0.275;
  const xy = { x, y };
  return {
    ok: true,
    xy,
    uv: xyToUv(xy),
    notes: [
      "CIE 15 daylight (D-series) chromaticity polynomials, valid 4000–25000 K.",
      "D65 is the D-series point at 6504 K, not 6500 K: the radiation constant c₂ was revised from " +
        "1.4380 to 1.4388 × 10⁻² m·K after D65 was defined, moving the nominal 6500 K to ≈ 6504 K.",
    ],
  };
}

/** CIE 1960 uv (v = 2/3 v'), the space Robertson's method and Duv use. */
function xyToUv1960(c: Chromaticity): Chromaticity {
  const d = -2 * c.x + 12 * c.y + 3;
  return { x: (4 * c.x) / d, y: (6 * c.y) / d };
}

// ROBERTSON (1968) ISOTEMPERATURE LINES: [mired, u, v, slope t] in CIE 1960 uv.
// Provenance: Robertson, A. R., "Computation of correlated color temperature
// and distribution temperature", JOSA 58 (1968) 1528–1535, as tabulated in
// Wyszecki & Stiles; copied from colour-science 0.4.7
// (colour.temperature.robertson1968.DATA_ISOTEMPERATURE_LINES_ROBERTSON1968,
// printed by script 2026-10-14). The test suite checks this implementation
// against colour-science's uv_to_CCT_Robertson1968 at a dozen blackbody
// points, which a transcription slip in any row they span would break.
const ROBERTSON_1968: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0.18006, 0.26352, -0.24341],
  [10, 0.18066, 0.26589, -0.25479],
  [20, 0.18133, 0.26846, -0.26876],
  [30, 0.18208, 0.27119, -0.28539],
  [40, 0.18293, 0.27407, -0.3047],
  [50, 0.18388, 0.27709, -0.32675],
  [60, 0.18494, 0.28021, -0.35156],
  [70, 0.18611, 0.28342, -0.37915],
  [80, 0.1874, 0.28668, -0.40955],
  [90, 0.1888, 0.28997, -0.44278],
  [100, 0.19032, 0.29326, -0.47888],
  [125, 0.19462, 0.30141, -0.58204],
  [150, 0.19962, 0.30921, -0.70471],
  [175, 0.20525, 0.31647, -0.84901],
  [200, 0.21142, 0.32312, -1.0182],
  [225, 0.21807, 0.32909, -1.2168],
  [250, 0.22511, 0.33439, -1.4512],
  [275, 0.23247, 0.33904, -1.7298],
  [300, 0.2401, 0.34308, -2.0637],
  [325, 0.24792, 0.34655, -2.4681],
  [350, 0.25591, 0.34951, -2.9641],
  [375, 0.264, 0.352, -3.5814],
  [400, 0.27218, 0.35407, -4.3633],
  [425, 0.28039, 0.35577, -5.3762],
  [450, 0.28863, 0.35714, -6.7262],
  [475, 0.29685, 0.35823, -8.5955],
  [500, 0.30505, 0.35907, -11.324],
  [525, 0.3132, 0.35968, -15.628],
  [550, 0.32129, 0.36011, -23.325],
  [575, 0.32931, 0.36038, -40.77],
  [600, 0.33724, 0.36051, -116.45],
];

/** Robertson's table spans 600 mired (1667 K) down to 10 mired (100,000 K). */
export const ROBERTSON_RANGE_K: [number, number] = [1e6 / 600, 1e6 / 10];
/**
 * MEASURED accuracy of Robertson's method on the true Planckian locus
 * (colour-science 0.4.7 sd_blackbody, CIE 1931 2° CMFs, 360–830 nm at 1 nm):
 * at most 1.46 K over 2856–6504 K, and at most 0.11% of T over 1667–25000 K.
 */
export const ROBERTSON_ERROR_RELATIVE = 0.0011;

/** McCamy's band: illuminant A (2856 K) to D65 (6504 K). */
export const MCCAMY_RANGE_K: [number, number] = [2856, 6504];
/**
 * MEASURED, not quoted: the largest |McCamy − T| on the true Planckian locus
 * over 2856–6504 K is 10.06 K (at 3604 K; colour-science 0.4.7 sd_blackbody +
 * CIE 1931 2° CMFs, 360–830 nm at 1 nm). The "under 2 K" often attributed to
 * McCamy does not hold against the blackbody locus computed that way (4000 K
 * reads 4008.84 K). Outside the band the error grows fast: −118 K at
 * 10,000 K, −5,500 K at 25,000 K.
 */
export const MCCAMY_ERROR_K = 10.1;
/**
 * Beyond this distance from the Planckian locus in CIE 1960 uv a correlated
 * colour temperature is not meaningful (the CIE convention bounds |Duv| at
 * 0.05). Measured by Robertson's method.
 */
export const CCT_MAX_DUV = 0.05;

export interface RobertsonResult {
  ok: true;
  cctK: number;
  /** Signed distance from the Planckian locus in CIE 1960 uv (+ above the locus, toward green). */
  duv: number;
}

/**
 * Correlated colour temperature by Robertson's method (1968): interpolation
 * between the isotemperature lines of the table above, in CIE 1960 uv. The
 * same algorithm as colour-science's uv_to_CCT_Robertson1968. Returns null
 * outside the table (below 1667 K or above 100,000 K).
 */
function robertson(x: number, y: number): RobertsonResult | null {
  const { x: u, y: v } = xyToUv1960({ x, y });
  let lastDt = 0;
  let lastDu = 0;
  let lastDv = 0;
  let du = 0;
  let dv = 0;
  let dt = 0;
  let i = 1;
  for (; i < ROBERTSON_1968.length; i++) {
    const [, ru, rv, rt] = ROBERTSON_1968[i];
    const len = Math.sqrt(1 + rt * rt);
    du = 1 / len;
    dv = rt / len;
    dt = -(u - ru) * dv + (v - rv) * du;
    if (dt <= 0 || i === ROBERTSON_1968.length - 1) break;
    lastDt = dt;
    lastDu = du;
    lastDv = dv;
  }
  // No crossing before the last line: the point is beyond 600 mired (< 1667 K).
  if (dt > 0) return null;
  // Crossing at the first line: beyond 10 mired (> 100,000 K).
  if (i === 1) return null;
  // dt ≤ 0 here and lastDt > 0: the point lies between lines i−1 and i, and f
  // is its fractional distance back toward line i−1 (|dt| / (lastDt + |dt|)).
  const f = -dt / (lastDt - dt);
  const [r1, u1, v1] = ROBERTSON_1968[i - 1];
  const [r2, u2, v2] = ROBERTSON_1968[i];
  const cctK = 1e6 / (r1 * f + r2 * (1 - f));
  const uu = u - (u1 * f + u2 * (1 - f));
  const vv = v - (v1 * f + v2 * (1 - f));
  let ddu = du * (1 - f) + lastDu * f;
  let ddv = dv * (1 - f) + lastDv * f;
  const len = Math.hypot(ddu, ddv);
  ddu /= len;
  ddv /= len;
  return { ok: true, cctK, duv: -(uu * ddu + vv * ddv) };
}

export interface CctResult {
  ok: true;
  /** McCamy's cubic estimate, K (the quick formula; see `inMcCamyRange`). */
  cctK: number;
  /** Robertson's method, K — the more accurate value, shown beside McCamy. */
  robertsonK: number;
  /** Signed Duv from Robertson's method. */
  duv: number;
  /** True when the temperature (by Robertson) lies in 2856–6504 K, McCamy's band. */
  inMcCamyRange: boolean;
  method: string;
  notes: string[];
}

/** Robertson CCT alone, with the same input checks and refusals as cctMcCamy. */
export function cctRobertson(x: number, y: number): RobertsonResult | ColourTempError {
  const bad = checkChromaticity(x, y);
  if (bad) return bad;
  const r = robertson(x, y);
  if (!r) {
    return {
      ok: false,
      error:
        `(${x}, ${y}) lies outside Robertson's isotemperature table, which spans ` +
        `${Math.round(ROBERTSON_RANGE_K[0])}–${ROBERTSON_RANGE_K[1]} K.`,
    };
  }
  if (Math.abs(r.duv) > CCT_MAX_DUV) return duvRefusal(x, y, r.duv);
  return r;
}

function checkChromaticity(x: number, y: number): ColourTempError | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: "The chromaticity x and y must be finite numbers." };
  }
  if (x <= 0 || y <= 0 || x + y >= 1) {
    return { ok: false, error: `(${x}, ${y}) is not a chromaticity: x and y must be positive with x + y < 1.` };
  }
  return null;
}

function duvRefusal(x: number, y: number, duv: number): ColourTempError {
  return {
    ok: false,
    error:
      `(${x}, ${y}) is ${Math.abs(duv).toFixed(3)} from the blackbody locus in CIE 1960 uv (Duv, by ` +
      `Robertson's method) — beyond the ${CCT_MAX_DUV} within which a correlated colour temperature is ` +
      "meaningful. A saturated colour has no CCT.",
  };
}

/**
 * Correlated colour temperature from CIE 1931 xy by McCamy's cubic
 * (McCamy 1992, Color Research & Application 17, 142–144):
 *   n = (x − 0.3320)/(y − 0.1858),  CCT = −449n³ + 3525n² − 6823.3n + 5520.33
 *
 * An APPROXIMATION, labelled as one, and always shown beside Robertson's
 * method. Its MEASURED error on the true blackbody locus is up to 10.06 K over
 * 2856–6504 K (illuminant A to D65); outside that band it still answers, but
 * LABELLED "outside McCamy's range — accuracy worse", with the Robertson value
 * beside it. A point far from the blackbody locus (|Duv| > 0.05, a saturated
 * colour) has no meaningful CCT and is refused, as is the formula's singular
 * line y = 0.1858.
 */
export function cctMcCamy(x: number, y: number): CctResult | ColourTempError {
  const badXy = checkChromaticity(x, y);
  if (badXy) return badXy;
  if (y <= 0.1858) {
    return {
      ok: false,
      error:
        `McCamy's formula divides by (y − 0.1858) — its epicentre — and y = ${y} is at or below it. ` +
        "No light source near the blackbody locus has a chromaticity there.",
    };
  }
  const n = (x - 0.332) / (y - 0.1858);
  const cct = -449 * n ** 3 + 3525 * n ** 2 - 6823.3 * n + 5520.33;
  const [lo, hi] = MCCAMY_RANGE_K;
  const rob = cctRobertson(x, y);
  if (!rob.ok) return rob; // off the locus (|Duv| > 0.05) or outside Robertson's table
  if (!Number.isFinite(cct) || cct <= 0) {
    return {
      ok: false,
      error: `McCamy's cubic gives no usable temperature for (${x}, ${y}); Robertson's method gives ${rob.cctK.toFixed(1)} K.`,
    };
  }
  // Judged on the ACCURATE (Robertson) temperature: D65 itself reads 6505.08 K
  // by McCamy, and must not be told it is outside the band that ends at D65.
  const inMcCamyRange = rob.cctK >= lo && rob.cctK <= hi;
  const fmt = (t: number): string => t.toFixed(1);
  return {
    ok: true,
    cctK: cct,
    robertsonK: rob.cctK,
    duv: rob.duv,
    inMcCamyRange,
    method: "McCamy 1992 cubic (quick estimate) beside Robertson 1968",
    notes: [
      inMcCamyRange
        ? `McCamy approximation: ${fmt(cct)} K. Measured error against the true blackbody locus is up to ` +
          `${MCCAMY_ERROR_K} K over ${lo}–${hi} K (illuminant A to D65).`
        : `McCamy gives ${fmt(cct)} K, but this is outside McCamy's range (${lo}–${hi} K) — accuracy worse, approx. ` +
          `Robertson's method here gives ${fmt(rob.cctK)} K.`,
      `Robertson's method (1968 isotemperature lines): ${fmt(rob.cctK)} K, Duv ${rob.duv.toFixed(4)}. ` +
        `Measured against the true blackbody locus it is within 1.5 K over ${lo}–${hi} K and 0.11% over ` +
        "1667–25000 K, so prefer it where the two disagree.",
      "CCT says only where the colour sits ALONG the blackbody locus; two lights with the same CCT " +
        "can differ visibly in the green–magenta direction (Duv).",
    ],
  };
}

export interface DaylightLocusFigure {
  title: string;
  xlabel: string;
  ylabel: string;
  series: Array<{ type: "line" | "scatter"; label: string; points: Array<{ x: number; y: number }> }>;
}

/**
 * A point ON the Planckian (blackbody) locus in CIE 1931 xy, interpolated
 * linearly in mired between the locus points of Robertson's 1968 table (its
 * (u, v) columns ARE the Planckian locus in CIE 1960 uv at each mired). Valid
 * over the table, 1667–100,000 K. This is how 3200 K tungsten — which the
 * D-series cannot place, since it starts at 4000 K — is drawn. Interpolation
 * between rows 10–25 mired apart; within about 1×10⁻³ in uv of the
 * CMF-computed locus over 1667–25000 K, which is a picture's accuracy, not a
 * colorimeter's.
 */
export function planckianXy(kelvin: number): { ok: true; xy: Chromaticity } | ColourTempError {
  const e = checkKelvin("colour temperature", kelvin);
  if (e) return e;
  const m = 1e6 / kelvin;
  const rows = ROBERTSON_1968;
  if (m < rows[0][0] + 10 || m > rows[rows.length - 1][0]) {
    return {
      ok: false,
      error: `${kelvin} K is outside Robertson's Planckian table (${Math.round(ROBERTSON_RANGE_K[0])}–${ROBERTSON_RANGE_K[1]} K).`,
    };
  }
  let i = 1;
  while (i < rows.length - 1 && rows[i][0] < m) i++;
  const [m1, u1, v1] = rows[i - 1];
  const [m2, u2, v2] = rows[i];
  const f = (m - m1) / (m2 - m1);
  const u = u1 + f * (u2 - u1);
  const v = v1 + f * (v2 - v1);
  const d = 2 * u - 8 * v + 4;
  return { ok: true, xy: { x: (3 * u) / d, y: (2 * v) / d } };
}

/**
 * Figure data: the D-series daylight locus in xy for 4000–25000 K, the
 * Planckian locus for 1667–25000 K, the sRGB triangle for orientation, each
 * given temperature marked on the locus that defines it (daylight inside
 * 4000–25000 K, Planckian below), and an entered chromaticity if one is given.
 * A temperature neither locus covers is listed in `omitted`, never dropped
 * silently.
 */
export function daylightLocusFigure(
  markK: number[] = [],
  xy?: Chromaticity,
): DaylightLocusFigure & { omitted: number[]; onPlanckian: number[] } {
  const pts: Array<{ x: number; y: number }> = [];
  const [lo, hi] = DAYLIGHT_RANGE_K;
  // Even in mired, which spaces the points evenly along the curve.
  const mLo = 1e6 / hi;
  const mHi = 1e6 / lo;
  for (let i = 0; i <= 60; i++) {
    const r = daylightXy(1e6 / (mLo + ((mHi - mLo) * i) / 60));
    if (r.ok) pts.push(r.xy);
  }
  const planck: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 60; i++) {
    const r = planckianXy(1e6 / (40 + ((600 - 40) * i) / 60));
    if (r.ok) planck.push(r.xy);
  }
  const srgb = gamutById("srgb")!.primaries;
  const marks: Array<{ x: number; y: number }> = [];
  const omitted: number[] = [];
  const onPlanckian: number[] = [];
  for (const t of markK) {
    const d = daylightXy(t);
    if (d.ok) {
      marks.push(d.xy);
      continue;
    }
    const p = planckianXy(t);
    if (p.ok) {
      marks.push(p.xy);
      onPlanckian.push(t);
    } else omitted.push(t);
  }
  const series: DaylightLocusFigure["series"] = [
    { type: "line", label: "sRGB gamut", points: [...srgb, srgb[0]] },
    { type: "line", label: "daylight locus", points: pts },
    { type: "line", label: "Planckian locus", points: planck },
    { type: "scatter", label: "entered temperatures", points: marks },
  ];
  if (xy && Number.isFinite(xy.x) && Number.isFinite(xy.y)) {
    series.push({ type: "scatter", label: "entered chromaticity", points: [xy] });
  }
  return {
    title: "Daylight (D-series) and Planckian loci",
    xlabel: "x",
    ylabel: "y",
    series,
    omitted,
    onPlanckian,
  };
}
