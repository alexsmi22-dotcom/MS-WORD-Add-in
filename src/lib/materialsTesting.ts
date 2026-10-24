// Materials testing and quality engines: tensile-test reduction, Weibull
// strength statistics, Scherrer / Williamson–Hall crystallite size, process
// capability, and tolerance stack-up. Pure numbers in, numbers out; the pane
// wording and figures live in materialsCalcs.ts.
//
// REUSE, so the app never gives two answers to one question:
//   - the Weibull MAXIMUM-LIKELIHOOD fit is reliability.ts weibullFit (the
//     Life-data tool's own fitter); only the median-rank regression that
//     ceramics people also expect is computed here;
//   - X-ray wavelengths are solidform.ts WAVELENGTHS (Hölzer et al. 1997);
//   - the normal tail is probdist.ts normalCdfPrecise;
//   - the normality check is diagnostics.ts normalityTest (D'Agostino K²);
//   - the stack-up Monte Carlo is monteCarlo.ts monteCarlo.
//
// Every loop is bounded by an input cap checked up front, and non-finite input
// is refused before any arithmetic.

import { weibullFit } from "./reliability";
import { normalCdfPrecise, normalQuantile } from "./probdist";

export type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const finite = (x: number): boolean => Number.isFinite(x);

/**
 * FREEZE CAPS (measured): the Weibull likelihood fit and the stack's Monte
 * Carlo scale with their input, and a task pane that blocks for seconds is a
 * frozen Word. 2 000 strengths and 100 dimensions stay well under 500 ms.
 */
export const MAX_STRENGTHS = 2000;
export const MAX_DIMS = 100;
/** The most rows any table here accepts (a tensile file at 100 Hz for 15 minutes). */
export const MAX_ROWS = 100000;

// ---------------------------------------------------------------------------
// Least squares, shared by the modulus, the Weibull regression and W–H.

export interface LineFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  /** Standard errors (NaN when n = 2). */
  seSlope: number;
  seIntercept: number;
}

/** Ordinary least squares y = intercept + slope·x (y on x). Null when x has no spread. */
export function lineFit(xs: number[], ys: number[]): LineFit | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - intercept - slope * xs[i];
    sse += e * e;
  }
  const r2 = syy > 0 ? 1 - sse / syy : 1;
  const s2 = n > 2 ? sse / (n - 2) : NaN;
  const seSlope = Math.sqrt(s2 / sxx);
  const seIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  // Sums of squares overflow long before the values do (1e200²): refuse rather than return NaN.
  if (![slope, intercept, r2].every(Number.isFinite)) return null;
  return { slope, intercept, r2, n, seSlope, seIntercept };
}

// ---------------------------------------------------------------------------
// 1. Tensile test

export interface TensileInput {
  /** Engineering strain, dimensionless (mm/mm), in test order. */
  strain: number[];
  /** Engineering stress, MPa, in test order. */
  stress: number[];
  /** Offset strain for the proof stress, dimensionless (0.002 for 0.2 %). */
  offset: number;
  /** A strain window for the modulus fit; automatic when absent. */
  window?: { lo: number; hi: number };
}

export interface TensileModulus {
  /** Slope of the fitted line, MPa per unit strain. */
  E: number;
  /** Intercept of the modulus line, MPa (toe/seating offset). */
  intercept: number;
  r2: number;
  points: number;
  /** How the window was chosen, in words. */
  windowRule: string;
  windowLo: number;
  windowHi: number;
  /** Relative change of the tangent slope across the window (null with 3 points). */
  curvature: number | null;
  /** True when the window is measurably curved: E is then a chord slope, not a linear modulus. */
  curved: boolean;
}

export interface TensileResult {
  ok: true;
  /** Null when no modulus could be fitted (too few rows in the window, or no rise): the rest is still reported. */
  modulus: TensileModulus | null;
  /** Offset proof stress, MPa, and its strain; null when no modulus or the offset line never meets the curve. */
  offsetYield: { stress: number; strain: number } | null;
  uts: number;
  utsStrain: number;
  /** Total strain at maximum stress, and plastic (null without a modulus). */
  uniformTotal: number;
  uniformPlastic: number | null;
  /** Total and plastic strain at the fracture row. */
  fractureTotal: number;
  fracturePlastic: number | null;
  fractureStress: number;
  /** Area under the curve to fracture, MPa = MJ/m³. */
  toughness: number;
  /** Modulus of resilience σy²/2E from the offset yield, MPa = MJ/m³ (null without both). */
  resilience: number | null;
  /** Strain decreases that were within the jitter allowance. */
  jitter: number;
  /** Rows read as the test (the rest are a terminal post-break tail and were ignored). */
  rowsUsed: number;
  /** A yield drop at the end of the elastic region, when detected. */
  yieldDrop: null | { upper: number; upperStrain: number; lower: number; lowerStrain: number; elongation: number };
  /** Why the modulus and everything built on it were withheld (null when they were not). */
  withheld: null | "no elastic region fitted" | "no linear elastic region" | "the modulus line does not fit this curve";
  notes: string[];
}

/** The automatic window: points on the rising curve between these fractions of the maximum stress. */
export const AUTO_WINDOW = { lo: 0.1, hi: 0.4 } as const;
/**
 * THE CURVATURE CHECK. A quadratic σ = a + bu + cu² is fitted over the window;
 * the relative change of the tangent slope across it, |2c·Δε|/E, says how
 * curved it is, and the t statistic of c says whether that curvature is real
 * or noise. Between 5 % and 15 % it is a WARNING (the slope is reported as the
 * chord over the window); past 15 % there is no linear elastic region and the
 * modulus and everything built on it are withheld, the rest of the report kept.
 */
export const CURVATURE_WARN = 0.05;
/** Past this slope change (with real curvature) there is no linear elastic region: everything built on E is withheld (RULE T). */
export const CURVATURE_REFUSE = 0.15;
export const CURVATURE_T = 3;
/**
 * Below this many window points the curvature t-test cannot tell a kink (a
 * seating toe) from scatter, so the slope change alone decides (RULE T, R6).
 */
export const SMALL_WINDOW = 8;
/**
 * The curvature t threshold for the quadratic term with `dof` residual degrees
 * of freedom: two-sided 99 % Student t for small windows (a 4-point window has
 * 1 dof and its t is nearly meaningless), 3 from 9 dof on. Exact (noise-free)
 * curvature has an infinite t and always counts.
 */
const T99 = [63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355];
export function curvatureT(dof: number): number {
  return dof >= 1 && dof <= T99.length ? T99[dof - 1] : CURVATURE_T;
}
/** Post-break tail: the terminal run of rows whose stress is below this fraction of the UTS. */
export const BREAK_FLOOR = 0.1;
/** Yield drop: at least this fraction of the upper value (and 8 noise SDs of the elastic fit). */
export const YIELD_DROP = 0.03;
/** Yield drop: the upper peak must lie within this plastic strain of the modulus line (the END of the elastic region). */
export const YIELD_DROP_MAX_PLASTIC = 0.005;

/** Least-squares quadratic over (x, y); null when singular or fewer than 4 points. */
function quadCurvature(xs: number[], ys: number[]): { t: number; span: number } | null {
  const n = xs.length;
  if (n < 4) return null;
  let mx = 0;
  for (const x of xs) mx += x;
  mx /= n;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const h = (hi - lo) / 2;
  if (!(h > 0)) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const u = (xs[i] - mx) / h;
    const u2 = u * u;
    s1 += u;
    s2 += u2;
    s3 += u2 * u;
    s4 += u2 * u2;
    t0 += ys[i];
    t1 += u * ys[i];
    t2 += u2 * ys[i];
  }
  const M = [
    [n, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const det3 = (A: number[][]): number =>
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det3(M);
  if (!(Math.abs(D) > 0) || !finite(D)) return null;
  const col = (k: number, v: number[]): number[][] => M.map((row, r) => row.map((x, cI) => (cI === k ? v[r] : x)));
  const rhs = [t0, t1, t2];
  const p0 = det3(col(0, rhs)) / D;
  const p1 = det3(col(1, rhs)) / D;
  const p2 = det3(col(2, rhs)) / D;
  let sse = 0;
  let sdd = 0;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const u = (xs[i] - mx) / h;
    const e = ys[i] - (p0 + p1 * u + p2 * u * u);
    sse += e * e;
    if (Number.isFinite(prev)) sdd += (e - prev) * (e - prev);
    prev = e;
  }
  const inv22 = (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / D;
  // The noise is the SMALLER of two estimates: the residual variance about the
  // quadratic, and the von Neumann successive-difference variance of those
  // residuals. A kinked but noise-free window (a seating toe) leaves smooth,
  // large residuals that the first estimate mistakes for noise; the second sees
  // they are not noise. Random scatter gives the two the same size.
  const s2e = n > 3 ? Math.min(sse / (n - 3), sdd / (2 * (n - 1))) : NaN;
  const se = Math.sqrt(s2e * inv22);
  const t = se > 0 ? Math.abs(p2 / se) : p2 === 0 ? 0 : Infinity;
  // Tangent slope p1 + 2·p2·u over u ∈ [−1, 1]: it changes by 4|p2| across the window.
  return { t, span: p1 !== 0 ? (4 * Math.abs(p2)) / Math.abs(p1) : Infinity };
}

export function tensileTest(inp: TensileInput): TensileResult | Fail {
  const { offset } = inp;
  let strain = inp.strain;
  let stress = inp.stress;
  if (strain.length !== stress.length) return fail("Every strain needs a matching stress.");
  if (strain.length < 5) return fail("A tensile curve needs at least 5 rows (strain, stress).");
  if (strain.length > MAX_ROWS) return fail(`That is more than ${MAX_ROWS.toLocaleString("en-US")} rows; thin the data first.`);
  for (let i = 0; i < strain.length; i++) {
    if (!finite(strain[i]) || !finite(stress[i])) return fail(`Row ${i + 1} is not two finite numbers.`);
    if (Math.abs(stress[i]) > 1e100 || Math.abs(strain[i]) > 1e100) {
      return fail(`Row ${i + 1} is beyond 10¹⁰⁰; check the units of the columns (the fit's sums of squares would overflow).`);
    }
  }
  if (!(finite(offset) && offset >= 0 && offset < 0.5)) return fail("The offset must be a strain from 0 to 50 %.");
  const notes: string[] = [];

  // Maximum stress (first occurrence) is the UTS.
  let iU = 0;
  for (let i = 1; i < stress.length; i++) if (stress[i] > stress[iU]) iU = i;
  const uts = stress[iU];
  if (!(uts > 0)) return fail("The stress never rises above zero.");

  // FRACTURE. Machines keep logging after the break, at about zero force. Only
  // a TERMINAL tail is trimmed: the run of final rows whose stress is below
  // 10 % of the UTS. A last row still at or above 10 % of the UTS is the
  // fracture row, however sharply the stress fell to reach it.
  let cut = stress.length;
  while (cut > iU + 1 && stress[cut - 1] < BREAK_FLOOR * uts) cut--;
  if (cut < stress.length) {
    notes.push(
      `The last ${stress.length - cut} row(s) are below ${BREAK_FLOOR * 100} % of the UTS, read as after the break, and were ignored; ` +
        `fracture is row ${cut}.`,
    );
    strain = strain.slice(0, cut);
    stress = stress.slice(0, cut);
  }
  const n = strain.length;

  let eMin = Infinity;
  let eMax = -Infinity;
  for (const e of strain) {
    if (e > eMax) eMax = e;
    if (e < eMin) eMin = e;
  }
  const range = eMax - eMin;
  if (!(range > 0)) return fail("The strain never increases, so there is no curve to read.");
  // Strain must run forward. A small step back is extensometer jitter; a real
  // reversal (an unload–reload loop, or columns swapped) is refused.
  let jitter = 0;
  for (let i = 1; i < n; i++) {
    const d = strain[i] - strain[i - 1];
    if (d < 0) {
      if (-d > 0.001 * range) {
        return fail(
          `The strain goes backwards at row ${i + 1}. This tool reads one monotonic pull; ` +
            "split off unload–reload cycles, and check that the strain and stress columns are not swapped.",
        );
      }
      jitter++;
    }
  }

  // Toughness: trapezoid up to fracture. Needs no modulus.
  let tough = 0;
  for (let i = 1; i < n; i++) tough += 0.5 * (stress[i] + stress[i - 1]) * (strain[i] - strain[i - 1]);
  const last = n - 1;

  // The elastic window.
  let idx: number[] = [];
  let windowRule: string;
  let wLo: number;
  let wHi: number;
  if (inp.window) {
    wLo = inp.window.lo;
    wHi = inp.window.hi;
    if (!(finite(wLo) && finite(wHi) && wHi > wLo)) return fail("The strain window needs a lower and a larger upper strain.");
    for (let i = 0; i <= iU; i++) if (strain[i] >= wLo && strain[i] <= wHi) idx.push(i);
    windowRule = "your strain window";
  } else {
    const sLo = AUTO_WINDOW.lo * uts;
    const sHi = AUTO_WINDOW.hi * uts;
    // From the first row at or above 10 % of the maximum stress up to (not past)
    // the first row above 40 %, on the rising curve before the maximum.
    let start = -1;
    for (let i = 0; i <= iU; i++) {
      if (start < 0 && stress[i] >= sLo) start = i;
      if (start >= 0) {
        if (stress[i] > sHi) break;
        idx.push(i);
      }
    }
    idx = idx.filter((i) => stress[i] >= sLo);
    windowRule = "the automatic window (the rising curve between 10 % and 40 % of the maximum stress)";
    wLo = idx.length ? strain[idx[0]] : NaN;
    wHi = idx.length ? strain[idx[idx.length - 1]] : NaN;
  }

  const base = {
    ok: true as const,
    uts,
    utsStrain: strain[iU],
    uniformTotal: strain[iU],
    fractureTotal: strain[last],
    fractureStress: stress[last],
    toughness: tough,
    jitter,
    rowsUsed: n,
    notes,
  };
  const noModulus = (why: string, code: NonNullable<TensileResult["withheld"]>): TensileResult => {
    notes.unshift(
      `${why} The modulus, offset yield, plastic strains, resilience and yield ratio are therefore not determined; ` +
        "a strain window over a straight elastic part (if the material has one) gives them.",
    );
    if (iU === last) notes.push("The maximum stress is the last row, so the record may stop before necking.");
    return { ...base, withheld: code, modulus: null, offsetYield: null, uniformPlastic: null, fracturePlastic: null, resilience: null, yieldDrop: null };
  };
  if (idx.length < 3) {
    return noModulus(
      `No elastic region could be fitted: ${idx.length === 1 ? "only 1 row falls" : `only ${idx.length} rows fall`} in ${windowRule}, and a modulus needs at least 3.`,
      "no elastic region fitted",
    );
  }
  const wx = idx.map((i) => strain[i]);
  const wy = idx.map((i) => stress[i]);
  const fit = lineFit(wx, wy);
  if (!fit || !(fit.slope > 0) || !finite(fit.slope) || !finite(fit.intercept)) {
    return noModulus(`No elastic region could be fitted: stress does not rise with strain over ${windowRule}.`, "no elastic region fitted");
  }
  const E = fit.slope;
  const a = fit.intercept;
  const keepNotes = notes.length;
  const q = quadCurvature(wx, wy);
  // RULE T. Past 15 % slope change (with real curvature, or too few points to
  // tell) there is NO linear elastic region and nothing built on E is printed:
  // a chord through a curved window gives a confident wrong modulus and yield.
  const tCrit = curvatureT(idx.length - 3);
  // A KINK (a seating toe) is not a parabola: the quadratic's residuals look like
  // noise and its t-test misses it. The two halves of the window, each fitted on
  // its own, see it: their slopes differ by more than three standard errors of
  // the difference (each half's own scatter) only when the change is real.
  let halvesDiffer = false;
  if (idx.length >= 6) {
    const half = Math.ceil(idx.length / 2);
    const f1 = lineFit(wx.slice(0, half), wy.slice(0, half));
    const f2 = lineFit(wx.slice(idx.length - half), wy.slice(idx.length - half));
    if (f1 && f2) {
      const s1 = Number.isFinite(f1.seSlope) ? f1.seSlope : 0;
      const s2 = Number.isFinite(f2.seSlope) ? f2.seSlope : 0;
      // 99 % two-sided Student t on the halves' own degrees of freedom (a 3σ rule is far too loose for 3–5 points a side).
      halvesDiffer = Math.abs(f1.slope - f2.slope) > curvatureT(2 * (half - 2)) * Math.sqrt(s1 * s1 + s2 * s2);
    }
  }
  const realCurvature = !!q && (q.t > tCrit || idx.length < SMALL_WINDOW || halvesDiffer);
  // With fewer than SMALL_WINDOW points noise and curvature cannot be told apart, so a large apparent change withholds too (tiebreak: never guess).
  if (q && q.span > CURVATURE_REFUSE && realCurvature) {
    return noModulus(
      `No linear elastic region: over ${windowRule} the slope changes by ${Math.round(q.span * 100)} % from one end ` +
        "to the other. For plastics ISO 527-1 takes the modulus as the chord between 0.05 % and 0.25 % strain (enter that as the strain window).",
        "no linear elastic region",
    );
  }
  // RULE R6: a 5–15 % change always carries the caveat in a small window (under SMALL_WINDOW points), where the t-test cannot speak.
  const curved = !!q && q.span >= CURVATURE_WARN && realCurvature;
  if (curved && q) {
    notes.push(
      `The elastic region is slightly curved: over ${windowRule} the slope changes by ${Math.round(q.span * 100)} % from one end to the other, ` +
        "so the modulus is the least-squares chord over that window, and the offset yield and plastic strains built on it carry the same caveat.",
    );
  } else if (!q) {
    notes.push("Only 3 points in the elastic window, so its straightness could not be tested.");
  }
  const modulus: TensileModulus = {
    E,
    intercept: a,
    r2: fit.r2,
    points: idx.length,
    windowRule,
    windowLo: wLo,
    windowHi: wHi,
    curvature: q ? q.span : null,
    curved,
  };

  // Residual noise of the elastic fit, for the yield-drop threshold.
  let sse = 0;
  for (let k = 0; k < wx.length; k++) {
    const e = wy[k] - (a + E * wx[k]);
    sse += e * e;
  }
  const sRes = wx.length > 2 ? Math.sqrt(sse / (wx.length - 2)) : 0;
  const plastic = (i: number): number => strain[i] - (stress[i] - a) / E;

  // YIELD DROP, only at the END of the elastic region. Scanning up from the
  // window, the running peak must still lie within 0.5 % plastic strain of the
  // modulus line; the FIRST time the stress falls from it by at least 3 % of it
  // AND eight noise SDs of the elastic fit is the only drop considered (later
  // serrations, necking and polymer necks far from the elastic limit are not
  // read). It counts when the stress stays down for at least 3 rows and then
  // recovers at least halfway. Lower: the lowest stress before that recovery.
  // Yield-drop elongation: from the peak to the last row within a quarter of
  // the drop above the lower value.
  let yieldDrop: TensileResult["yieldDrop"] = null;
  {
    const top = idx[idx.length - 1];
    let h = top;
    for (let i = top + 1; i < iU; i++) {
      if (stress[i] > stress[h]) {
        h = i;
        if (plastic(h) > YIELD_DROP_MAX_PLASTIC) break;
        continue;
      }
      const thr = Math.max(YIELD_DROP * stress[h], 8 * sRes);
      if (stress[h] - stress[i] < thr) continue;
      let m = i;
      let rec = -1;
      for (let j = i; j <= iU; j++) {
        if (stress[j] < stress[m]) m = j;
        if (stress[j] > stress[m] + 0.5 * (stress[h] - stress[m])) {
          rec = j;
          break;
        }
      }
      let low = 0;
      for (let k = h + 1; k < rec; k++) if (stress[k] <= stress[h] - thr / 2) low++;
      if (rec > 0 && low >= 3 && low * 2 >= rec - h - 1) {
        const upper = stress[h];
        const lower = stress[m];
        let end = m;
        for (let k = h + 1; k < rec; k++) if (stress[k] <= lower + 0.25 * (upper - lower)) end = k;
        yieldDrop = { upper, upperStrain: strain[h], lower, lowerStrain: strain[m], elongation: strain[end] - strain[h] };
      }
      break; // only the first drop counts
    }
  }

  // Offset line σ = a + E(ε − offset): the toe intercept a is kept, so a seated
  // specimen's offset line is parallel to the fitted one, not through the origin.
  const d = (i: number): number => stress[i] - (a + E * (strain[i] - offset));
  let offsetYield: TensileResult["offsetYield"] = null;
  for (let i = idx[0] + 1; i < n; i++) {
    const d0 = d(i - 1);
    const d1 = d(i);
    if (d0 > 0 && d1 <= 0) {
      const t = d0 / (d0 - d1);
      offsetYield = { strain: strain[i - 1] + t * (strain[i] - strain[i - 1]), stress: stress[i - 1] + t * (stress[i] - stress[i - 1]) };
      break;
    }
  }
  if (!offsetYield) {
    notes.push(
      `The ${fmtPct(offset)} offset line never meets the curve: the specimen broke (or the data stop) before ${fmtPct(offset)} plastic ` +
        "strain, so there is no offset yield (a brittle material has none; report the fracture strength).",
    );
  }
  // A NEGATIVE plastic strain means the modulus line does not describe this
  // curve (a stiffening J-curve, an outlier row): nothing built on E is printed.
  // RULE R5: a plastic strain is noise-level when it lies within three standard
  // errors of zero: the scatter of a point about the line (s_resid) plus the
  // uncertainty of the line itself, extrapolated to that stress (intercept SE and
  // slope SE times the elastic strain). Such a value reads as 0; only a clearly
  // negative one withholds the E-derived set. Never below 10⁻⁴.
  const seA = Number.isFinite(fit.seIntercept) ? fit.seIntercept : 0;
  const seE = Number.isFinite(fit.seSlope) ? fit.seSlope : 0;
  const tidy = (sig: number, eps: number): number => {
    const elastic = (sig - a) / E;
    const p = eps - elastic;
    const tol = Math.max(1e-4, (3 * (sRes + seA + seE * Math.abs(elastic))) / E);
    return p < 0 && p >= -tol ? 0 : p;
  };
  const uniformPlastic = tidy(uts, strain[iU]);
  const fracturePlastic = tidy(stress[last], strain[last]);
  if (uniformPlastic < 0 || fracturePlastic < 0) {
    notes.length = keepNotes;
    return noModulus(
      "The modulus line does not describe this curve: measured from it, the strain at the maximum or at fracture would be negative " +
        "plastic strain (a curve that stiffens, or a row far off the curve).",
      "the modulus line does not fit this curve",
    );
  }
  if (yieldDrop) {
    notes.push(
      "A yield drop was detected at the end of the elastic region. For discontinuous yielding of metals ISO 6892-1 reports the upper and " +
        "lower values as ReH and ReL; the offset yield below them is shown for comparison only. For plastics ISO 527 reports the yield " +
        "stress σy at the peak.",
    );
  }
  if (Math.abs(a) > 0.02 * uts) {
    notes.push(
      "The modulus line does not pass through the origin (a toe or seating region); the offset line is drawn parallel to it from " +
        "its own strain intercept, and plastic strains are measured from that line.",
    );
  }
  if (iU === last) {
    notes.push("The maximum stress is the last row, so the record may stop before necking; fracture values are those of the last row.");
  }
  return {
    ...base,
    withheld: null,
    modulus,
    offsetYield,
    uniformPlastic,
    fracturePlastic,
    resilience: offsetYield ? (offsetYield.stress * offsetYield.stress) / (2 * E) : null,
    yieldDrop,
  };
}


function fmtPct(strainFrac: number): string {
  return `${Number((strainFrac * 100).toPrecision(6))} %`;
}

// ---------------------------------------------------------------------------
// 2. Weibull strength

export interface WeibullStrengthResult {
  ok: true;
  n: number;
  /** Sorted strengths. */
  sorted: number[];
  /** Bernard median ranks (i − 0.3)/(n + 0.4). */
  F: number[];
  /** Regression of ln ln(1/(1−F)) on ln σ. */
  reg: { m: number; sigma0: number; r2: number; intercept: number };
  /** Maximum likelihood (reliability.ts weibullFit). */
  mle: { m: number; sigma0: number; mLow: number | null; mHigh: number | null };
}

export function weibullStrength(values: number[]): WeibullStrengthResult | Fail {
  const n = values.length;
  if (n < 3) return fail("A Weibull modulus needs at least 3 strengths (and standards ask for many more).");
  if (n > MAX_STRENGTHS) return fail(`That is more than ${MAX_STRENGTHS.toLocaleString("en-US")} strengths; the fit does not need that many (and more would hold up Word).`);
  for (const v of values) {
    if (!finite(v)) return fail("Every strength must be a finite number.");
    if (v <= 0) return fail("Every strength must be greater than zero: a Weibull distribution starts at zero stress.");
  }
  const sorted = [...values].sort((x, y) => x - y);
  if (sorted[0] === sorted[n - 1]) return fail("Every strength is the same, so there is no scatter to fit (the modulus would be infinite).");
  const F = sorted.map((_, i) => (i + 1 - 0.3) / (n + 0.4));
  const xs = sorted.map(Math.log);
  const ys = F.map((f) => Math.log(-Math.log(1 - f)));
  const lf = lineFit(xs, ys);
  if (!lf || !(lf.slope > 0)) return fail("The strengths do not rise with rank, so no Weibull line can be drawn.");
  const reg = { m: lf.slope, intercept: lf.intercept, sigma0: Math.exp(-lf.intercept / lf.slope), r2: lf.r2 };
  const ml = weibullFit({ times: values, events: values.map(() => 1) });
  if (!ml.ok) return fail("The maximum-likelihood fit did not converge for these strengths.");
  if (!finite(reg.sigma0) || !finite(ml.eta)) return fail("The characteristic strength overflowed; check the units.");
  return {
    ok: true,
    n,
    sorted,
    F,
    reg,
    mle: { m: ml.beta, sigma0: ml.eta, mLow: ml.betaLow, mHigh: ml.betaHigh },
  };
}

/** Probability of failure at stress σ for a two-parameter Weibull. */
export function weibullPf(sigma: number, m: number, sigma0: number): number {
  if (!(sigma > 0)) return 0;
  return -Math.expm1(-Math.pow(sigma / sigma0, m));
}

// ---------------------------------------------------------------------------
// 3. Scherrer and Williamson–Hall

export type Broadening = "gauss" | "lorentz" | "none";

export interface PeakIn {
  twoTheta: number; // degrees
  fwhm: number; // degrees 2θ
  inst?: number; // degrees 2θ, per-peak instrumental FWHM
}

export interface PeakOut {
  twoTheta: number;
  fwhmObs: number;
  inst: number;
  /** Corrected FWHM, degrees 2θ, and in radians. */
  beta: number;
  betaRad: number;
  /** Crystallite size, Å. */
  size: number;
}

export interface ScherrerResult {
  ok: true;
  peaks: PeakOut[];
  /** Williamson–Hall, when 3 or more peaks. */
  wh: null | {
    fit: LineFit;
    /** Size, Å, or null when the intercept is not positive. */
    size: number | null;
    strain: number;
    xs: number[];
    ys: number[];
  };
}

const RAD = Math.PI / 180;

export function scherrer(
  peaks: PeakIn[],
  opts: { K: number; lambda: number; instrument: number; mode: Broadening },
): ScherrerResult | Fail {
  const { K, lambda, instrument, mode } = opts;
  if (!(finite(K) && K > 0 && K <= 2)) return fail("The shape factor K must be a positive number (typically 0.89–0.94).");
  if (!(finite(lambda) && lambda > 0 && lambda < 100)) return fail("The wavelength must be a positive number of ångströms (below 100 Å).");
  if (!(finite(instrument) && instrument >= 0)) return fail("The instrumental FWHM must be zero or a positive number of degrees.");
  if (!peaks.length) return fail("Enter at least one peak: 2θ and FWHM in degrees.");
  if (peaks.length > 500) return fail("That is more than 500 peaks; enter the ones you are sizing.");
  const out: PeakOut[] = [];
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k];
    const lab = `Peak ${k + 1}`;
    if (!finite(p.twoTheta) || !(p.twoTheta > 0 && p.twoTheta < 180)) return fail(`${lab}: 2θ must be between 0 and 180 degrees.`);
    if (!finite(p.fwhm) || !(p.fwhm > 0)) return fail(`${lab}: the FWHM must be a positive number of degrees 2θ.`);
    if (p.fwhm >= 20) return fail(`${lab}: an FWHM of ${p.fwhm}° is not a Bragg peak; enter it in degrees 2θ, not in radians or as a 2θ position.`);
    const inst = p.inst ?? instrument;
    if (!finite(inst) || inst < 0) return fail(`${lab}: the instrumental FWHM must be zero or positive.`);
    let beta: number;
    if (mode === "none" || inst === 0) beta = p.fwhm;
    else {
      if (inst >= p.fwhm) {
        return fail(
          `${lab}: the instrumental FWHM (${inst}°) is not smaller than the observed one (${p.fwhm}°), so no sample broadening is left ` +
            "to measure; the crystallites are too large for this instrument to size.",
        );
      }
      beta = mode === "gauss" ? Math.sqrt(p.fwhm * p.fwhm - inst * inst) : p.fwhm - inst;
    }
    const betaRad = beta * RAD;
    const theta = (p.twoTheta / 2) * RAD;
    const size = (K * lambda) / (betaRad * Math.cos(theta));
    if (!finite(size)) return fail(`${lab}: the size overflowed.`);
    out.push({ twoTheta: p.twoTheta, fwhmObs: p.fwhm, inst: mode === "none" ? 0 : inst, beta, betaRad, size });
  }
  let wh: ScherrerResult["wh"] = null;
  if (out.length >= 3) {
    const xs = out.map((p) => 4 * Math.sin((p.twoTheta / 2) * RAD));
    const ys = out.map((p) => p.betaRad * Math.cos((p.twoTheta / 2) * RAD));
    const fit = lineFit(xs, ys);
    if (fit) {
      wh = { fit, size: fit.intercept > 0 ? (K * lambda) / fit.intercept : null, strain: fit.slope, xs, ys };
    }
  }
  return { ok: true, peaks: out, wh };
}

// ---------------------------------------------------------------------------
// 4. Process capability

/**
 * d₂ = E[R/σ] for subgroups of n normal observations, n = 2…25, to the three
 * decimals published in ASTM E2587 (control-chart constants) and in
 * Montgomery, Introduction to Statistical Quality Control, Appendix VI.
 * Pinned in the tests against the defining integral
 * d₂(n) = ∫ [1 − Φ(x)ⁿ − (1 − Φ(x))ⁿ] dx, evaluated with scipy.
 */
/** σ within below this fraction of the overall s suggests sorted or trending data (moving ranges then understate σ). */
export const ORDER_RATIO = 0.5;

export const D2: Readonly<Record<number, number>> = {
  2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.97, 10: 3.078,
  11: 3.173, 12: 3.258, 13: 3.336, 14: 3.407, 15: 3.472, 16: 3.532, 17: 3.588, 18: 3.64,
  19: 3.689, 20: 3.735, 21: 3.778, 22: 3.819, 23: 3.858, 24: 3.895, 25: 3.931,
};

export interface CapabilityInput {
  data: number[];
  lsl: number | null;
  usl: number | null;
  target: number | null;
  /** Subgroup size (consecutive values); 1 or null = individual values. */
  subgroup: number | null;
  /** Confidence for the Cpk interval, e.g. 0.95. */
  confidence: number;
}

export interface CapIndex {
  /** Cp / Pp, null when one-sided. */
  p: number | null;
  upper: number | null;
  lower: number | null;
  k: number;
  /** Bissell interval on the k index. */
  kLow: number;
  kHigh: number;
  /** Expected ppm out of spec under normality. */
  ppm: number;
  ppmUpper: number;
  ppmLower: number;
}

export interface CapabilityResult {
  ok: true;
  n: number;
  mean: number;
  sOverall: number;
  sWithin: number;
  withinMethod: string;
  subgroups: number | null;
  within: CapIndex;
  overall: CapIndex;
  observedOut: number;
  observedPpm: number;
  /** The order looks sorted or trending (monotonic, or σ within below half of s): within-σ is unreliable. */
  orderSuspect: boolean;
}

function capIndex(mean: number, s: number, lsl: number | null, usl: number | null, n: number, conf: number): CapIndex {
  const upper = usl === null ? null : (usl - mean) / (3 * s);
  const lower = lsl === null ? null : (mean - lsl) / (3 * s);
  const p = usl !== null && lsl !== null ? (usl - lsl) / (6 * s) : null;
  const k = Math.min(upper ?? Infinity, lower ?? Infinity);
  // Bissell (1990): SE(Ĉpk) ≈ √(1/(9n) + Ĉpk²/(2(n − 1))), normal theory.
  const se = Math.sqrt(1 / (9 * n) + (k * k) / (2 * (n - 1)));
  const z = normalQuantile(1 - (1 - conf) / 2);
  const ppmUpper = usl === null ? 0 : normalCdfPrecise(-(usl - mean) / s) * 1e6;
  const ppmLower = lsl === null ? 0 : normalCdfPrecise(-(mean - lsl) / s) * 1e6;
  return { p, upper, lower, k, kLow: k - z * se, kHigh: k + z * se, ppm: ppmUpper + ppmLower, ppmUpper, ppmLower };
}

export function capability(inp: CapabilityInput): CapabilityResult | Fail {
  const { data, lsl, usl, target, confidence } = inp;
  const n = data.length;
  if (n < 2) return fail("Process capability needs at least 2 measurements (and 100 or more to mean much).");
  if (n > MAX_ROWS) return fail(`That is more than ${MAX_ROWS.toLocaleString("en-US")} measurements.`);
  for (const v of data) if (!finite(v)) return fail("Every measurement must be a finite number.");
  if (lsl === null && usl === null) return fail("Give at least one specification limit (LSL or USL).");
  if ((lsl !== null && !finite(lsl)) || (usl !== null && !finite(usl)) || (target !== null && !finite(target))) {
    return fail("The limits and target must be finite numbers.");
  }
  if (lsl !== null && usl !== null && !(usl > lsl)) return fail("The USL must be greater than the LSL.");
  if (!(confidence > 0 && confidence < 1)) return fail("The confidence level must be between 0 and 1.");
  let mean = 0;
  for (const v of data) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of data) ss += (v - mean) * (v - mean);
  const sOverall = Math.sqrt(ss / (n - 1));
  if (!finite(mean) || !finite(sOverall)) return fail("The measurements are too large to square in double precision; rescale them (a unit change) first.");
  if (!(sOverall > 0)) return fail("Every measurement is the same, so there is no spread and no capability index.");
  let sWithin: number;
  let withinMethod: string;
  let subgroups: number | null = null;
  const m = inp.subgroup;
  if (m === null || m === 1) {
    // INDIVIDUALS: the standard convention (AIAG SPC manual, Minitab) is the
    // average moving range of consecutive values over d₂(2) = 1.128, so a
    // process that drifts still shows Cpk above Ppk.
    let mr = 0;
    for (let i = 1; i < n; i++) mr += Math.abs(data[i] - data[i - 1]);
    const mrBar = mr / (n - 1);
    if (!(mrBar > 0) || !finite(mrBar)) return fail("Consecutive measurements never differ, so the moving range (and the within σ) is zero.");
    sWithin = mrBar / D2[2];
    withinMethod = `individuals: average moving range MR̄/d₂ with d₂ = ${D2[2].toFixed(3)} (span 2, consecutive values in the order given)`;
  } else {
    if (!Number.isInteger(m) || m < 2 || m > 25) return fail("The subgroup size must be a whole number from 2 to 25 (the d₂ table's range), or blank.");
    if (n % m !== 0) return fail(`${n} measurements do not split into subgroups of ${m}; the last subgroup would be incomplete.`);
    subgroups = n / m;
    if (subgroups < 2) return fail("A within-subgroup σ needs at least 2 subgroups.");
    let rSum = 0;
    for (let g = 0; g < subgroups; g++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < m; j++) {
        const v = data[g * m + j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      rSum += hi - lo;
    }
    const rBar = rSum / subgroups;
    if (!(rBar > 0)) return fail("Every subgroup has zero range, so the within-subgroup σ is zero.");
    sWithin = rBar / D2[m];
    withinMethod = `R̄/d₂ over ${subgroups} subgroups of ${m} (d₂ = ${D2[m].toFixed(3)})`;
  }
  let out = 0;
  for (const v of data) if ((usl !== null && v > usl) || (lsl !== null && v < lsl)) out++;
  return {
    ok: true,
    n,
    mean,
    sOverall,
    sWithin,
    withinMethod,
    subgroups,
    within: capIndex(mean, sWithin, lsl, usl, n, confidence),
    overall: capIndex(mean, sOverall, lsl, usl, n, confidence),
    observedOut: out,
    observedPpm: (out / n) * 1e6,
    orderSuspect: (() => {
      let up = true;
      let down = true;
      for (let i = 1; i < n; i++) {
        if (data[i] < data[i - 1]) up = false;
        if (data[i] > data[i - 1]) down = false;
      }
      return up || down || sWithin / sOverall < ORDER_RATIO;
    })(),
  };
}

// ---------------------------------------------------------------------------
// 5. Tolerance stack-up

export interface StackDim {
  name: string;
  sign: 1 | -1;
  nominal: number;
  /** Upper and lower deviations, signed (+0.10 / −0.05 → 0.10, −0.05). */
  plus: number;
  minus: number;
}

export interface StackRow extends StackDim {
  /** Mean-shifted nominal and the equal-bilateral half tolerance. */
  mid: number;
  half: number;
  /** Share of the RSS variance, 0–1. */
  share: number;
}

export interface StackResult {
  ok: true;
  rows: StackRow[];
  nominal: number;
  /** Gap with every asymmetric tolerance re-centred. */
  centre: number;
  worst: number;
  rss: number;
}

export function toleranceStack(dims: StackDim[]): StackResult | Fail {
  if (!dims.length) return fail("Enter at least one dimension.");
  if (dims.length > MAX_DIMS) return fail(`That is more than ${MAX_DIMS} dimensions in one loop; split the stack into sub-assemblies.`);
  const rows: StackRow[] = [];
  let nominal = 0;
  let centre = 0;
  let worst = 0;
  let v = 0;
  for (const d of dims) {
    if (![d.nominal, d.plus, d.minus].every(finite)) return fail(`${d.name}: the nominal and tolerances must be finite numbers.`);
    if (d.plus < d.minus) return fail(`${d.name}: the upper deviation is below the lower one.`);
    const mid = d.nominal + (d.plus + d.minus) / 2;
    const half = (d.plus - d.minus) / 2;
    nominal += d.sign * d.nominal;
    centre += d.sign * mid;
    worst += half;
    v += half * half;
    rows.push({ ...d, mid, half, share: 0 });
  }
  for (const r of rows) r.share = v > 0 ? (r.half * r.half) / v : 0;
  return { ok: true, rows, nominal, centre, worst, rss: Math.sqrt(v) };
}
