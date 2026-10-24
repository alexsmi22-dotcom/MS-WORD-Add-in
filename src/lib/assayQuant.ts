// Quantitation on top of the Bio/Assay fits: reading unknown concentrations
// off a standard curve, reading a 96/384-well plate through a layout map, and
// qPCR relative quantification (Livak 2^−ΔΔCt and the Pfaffl ratio).
//
// Pure numeric/string logic, no Office.js. The pane glue (fields, text, the
// figures) is assayQuantCalcs.ts; every number is computed here.
//
// THE RULES THIS FILE KEEPS, each with its own test:
//   - an unknown outside the standards is NOT given a concentration — it is
//     "below the lowest standard" / "above the highest", never extrapolated;
//   - a 4PL response outside the fitted asymptotes is refused by name (the
//     curve never reaches it, so no concentration exists);
//   - a confidence interval is given only from a published method: the
//     classical (Fieller / Draper–Smith inverse-regression) calibration
//     interval for a straight line, and the first-order delta method for a
//     4PL — named as such wherever it is shown;
//   - a flat curve is refused, not inverted;
//   - an "Undetermined" Ct is a non-amplification, never a number: it is
//     dropped from its replicates by name, and never replaced with 40;
//   - a PCR efficiency outside 80–120 % is refused.

import { levenbergMarquardt, fourPL, linearRegression } from "./assay";
import { tCritical, tTestP, oneWayAnova } from "./stats";
import { parseCellNumber } from "./dataimport";
import { readDataBlock } from "./dataBlock";

// --------------------------------------------------------------- replicates

export interface ReplicateStats {
  values: number[];
  n: number;
  mean: number;
  /** Sample SD (n − 1); NaN when n < 2. */
  sd: number;
  /** 100·SD/mean, in percent; NaN when n < 2 or mean ≤ 0. */
  cv: number;
}

export function replicateStats(values: number[]): ReplicateStats {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : NaN;
  let sd = NaN;
  if (n >= 2) {
    let ss = 0;
    for (const v of values) ss += (v - mean) ** 2;
    sd = Math.sqrt(ss / (n - 1));
  }
  const cv = n >= 2 && mean > 0 ? (100 * sd) / mean : NaN;
  return { values: [...values], n, mean, sd, cv };
}

// ------------------------------------------------------------ small algebra

/** Gauss–Jordan inverse of a small matrix; null when singular. */
function invert(A: number[][]): number[][] | null {
  // Equilibrate to a unit diagonal first. The 4PL normal matrix of molar
  // standards (EC50 ~10⁻⁸ M beside plateaus ~1) spans 10¹⁶ on its diagonal, and
  // the RELATIVE pivot test below then called every molar curve "not
  // identifiable" although the same standards in nM fitted. inv(A) = D·inv(DAD)·D.
  const d: number[] = [];
  for (let i = 0; i < A.length; i++) {
    const v = A[i][i];
    if (!(v > 0) || !Number.isFinite(v)) return null;
    d.push(1 / Math.sqrt(v));
  }
  const inv = invertRaw(A.map((row, i) => row.map((v, j) => v * d[i] * d[j])));
  return inv ? inv.map((row, i) => row.map((v, j) => v * d[i] * d[j])) : null;
}

function invertRaw(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(1e-300, ...A.map((r) => Math.max(...r.map(Math.abs))));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-13 * scale) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

// ------------------------------------------------------------ standard curve

export type CurveModel = "linear" | "4pl";

export interface StandardInput {
  conc: number;
  responses: number[];
}
export interface UnknownInput {
  name: string;
  responses: number[];
}

export interface LinearCurve {
  model: "linear";
  slope: number;
  intercept: number;
  slopeSE: number;
  interceptSE: number;
  rsquared: number;
  /** Residual standard deviation s = √(SSR/(n − 2)). */
  s: number;
  n: number;
  df: number;
  xbar: number;
  ybar: number;
  sxx: number;
  predict: (x: number) => number;
}

export interface FourPLCurve {
  model: "4pl";
  bottom: number;
  top: number;
  ec50: number;
  hill: number;
  /** Standard errors, order bottom, top, EC50, Hill. */
  se: number[];
  /** Parameter covariance s²(JᵀJ)⁻¹, the same scaling as scipy's curve_fit pcov. */
  cov: number[][];
  rsquared: number;
  s: number;
  n: number;
  df: number;
  predict: (x: number) => number;
}

export type StandardCurve = LinearCurve | FourPLCurve;

export type UnknownStatus = "ok" | "below" | "above" | "beyond-asymptote" | "no-data";

export interface UnknownResult {
  name: string;
  stats: ReplicateStats;
  status: UnknownStatus;
  /** Back-calculated concentration (status "ok" only). */
  conc?: number;
  /** 95 % interval for the concentration, when one could be given. */
  ci?: [number, number];
  /** Why no interval is shown, when status is "ok" and ci is absent. */
  ciMissing?: string;
  /** The refusal, in words, for every status but "ok". */
  message?: string;
}

export interface StandardLevel extends StandardInput {
  stats: ReplicateStats;
}

export interface StandardCurveOk {
  ok: true;
  curve: StandardCurve;
  standards: StandardLevel[];
  unknowns: UnknownResult[];
  /** The concentration span of the standards, [lowest, highest]. */
  range: [number, number];
  /** What the interval is and what it assumes — shown with the result. */
  intervalMethod: string;
  notes: string[];
}
export interface Refusal {
  ok: false;
  error: string;
}
export type StandardCurveResult = StandardCurveOk | Refusal;

/** Confidence level for every interval this module gives. */
export const CI_LEVEL = 0.95;
/**
 * Fieller's g = t²s²/(b²Sxx) above which no straight-line calibration interval
 * is given. THIS TOOL'S threshold, stated as such: √g = t·SE(b)/|b|, so g > 0.25
 * means the slope's own 95 % CI is wider than ±50 % of the slope. (g ≥ 1 is the
 * slope not being significant at all, refused outright.)
 */
export const LINEAR_G_FLAG = 0.25;
/** Replicate CV (%) above which an unknown is flagged. THIS TOOL'S threshold. */
export const UNKNOWN_CV_FLAG = 20;
/** A 4PL hook reversal is flagged only when it is at least this fraction of the curve's span (plateau noise allowance). */
export const HOOK_SPAN_FRACTION = 0.05;

/** Short number for messages: 4 significant figures, U+2212 minus, ×10ⁿ outside 10⁻³…10⁶. */
export function qNum(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "not finite";
  if (x === 0) return "0";
  const a = Math.abs(x);
  const minus = x < 0 ? "−" : "";
  if (a >= 1e-3 && a < 1e6) return minus + String(Number(a.toPrecision(sig)));
  const m = /^(\d(?:\.\d+)?)e([+-]\d+)$/.exec(a.toExponential(sig - 1));
  if (!m) return minus + String(a);
  const mant = m[1].includes(".") ? m[1].replace(/0+$/, "").replace(/\.$/, "") : m[1];
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const e = Number(m[2]);
  const es = (e < 0 ? "⁻" : "") + String(Math.abs(e)).split("").map((d) => sup[Number(d)]).join("");
  return `${minus}${mant}×10${es}`;
}

// ------------------------------------------------- decimal commas, names

/**
 * How the commas of ONE BLOCK of numbers are read, decided for the whole block
 * (never cell by cell). parseCellNumber reads "0,123" and "1,058" as thousands
 * (123, 1058): right for English text, a silent thousand-fold error for a
 * European plate export. So:
 *   - "0,ddd" is always a decimal (no thousands group starts with 0);
 *   - a comma with other than three digits after it ("0,5", "27,1") is a decimal;
 *   - a block with such decimal commas reads its "d,ddd" cells as decimals too;
 *   - a block with dot decimals ("0.51") reads its "d,ddd" cells as thousands;
 *   - a block whose only commas are "d,ddd", with no other evidence either way,
 *     or with BOTH kinds of evidence, is refused: there is no honest reading.
 */
export type CommaMode = "comma" | "point";
export interface CommaReading {
  mode: CommaMode;
  /** An example cell whose comma was read as a decimal point (for the note), or null. */
  example: string | null;
  /** Why an ambiguous "d,ddd" was read as a decimal (a Ct cannot exceed 60), for the note. */
  reason?: string;
  /** An ambiguous "d,ddd" read as THOUSANDS on the evidence of whole-number readings, and that evidence. */
  thousands?: { example: string; evidence: string };
}

/**
 * Evidence about the data that the separators alone cannot give:
 *  - integerReadings: the reading/response cells of the assay. A plain whole
 *    number ≥ 100 among them (RLU, counts: "120") in a block with no decimal
 *    point and no decimal comma anywhere says the data are whole numbers, so
 *    "1,234" and "12,345" are thousands.
 *  - bounded: cells that cannot exceed `max` (a Ct ≤ 60). "18,123" read as
 *    thousands would be 18 123, impossible, so its comma is a decimal comma.
 */
export interface CommaEvidence {
  integerReadings?: string[];
  /**
   * Every reading cell (default: integerReadings). The thousands reading is
   * taken only when EVERY ambiguous "d,ddd" is one of these: a concentration
   * "1,250" beside whole-number readings is still refused.
   */
  readingCells?: string[];
  bounded?: { cells: string[]; max: number; why: string };
}

const AMBIGUOUS_COMMA = /^-?[1-9]\d{0,2},\d{3}$/;
/** The largest Ct read as possible when weighing a comma (a run is at most ~60 cycles). */
export const CT_MAX = 60;

export function commaReading(cells: string[], what: string, evidence: CommaEvidence = {}): CommaReading | Refusal {
  let dec: string | null = null;
  let pt: string | null = null;
  let amb: string | null = null;
  let reason: string | undefined;
  const ambs: string[] = [];
  if (evidence.bounded) {
    for (const raw of evidence.bounded.cells) {
      const shown = raw.trim();
      const t = shown.replace(/^[−–]/, "-");
      if (AMBIGUOUS_COMMA.test(t) && Math.abs(Number(t.replace(",", ""))) > evidence.bounded.max) {
        dec = dec ?? shown;
        reason = reason ?? evidence.bounded.why;
      }
    }
  }
  for (const raw of cells) {
    const shown = raw.trim();
    const t = shown.replace(/^[−–]/, "-").replace(/%$/, "");
    if (!/\d/.test(t) || !/^-?[\d.,]+$/.test(t)) continue;
    const comma = t.includes(",");
    const dot = t.includes(".");
    if (comma && dot) {
      if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) dec = dec ?? shown;
      else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(t)) pt = pt ?? shown;
    } else if (comma) {
      if (/^-?\d{1,3}(,\d{3}){2,}$/.test(t)) pt = pt ?? shown;
      else if (/^-?0,\d+$/.test(t)) dec = dec ?? shown;
      else if (AMBIGUOUS_COMMA.test(t)) {
        amb = amb ?? shown;
        ambs.push(shown);
      }
      else if (/^-?\d+,\d+$/.test(t)) dec = dec ?? shown;
    } else if (dot && /^-?\d*\.\d+$/.test(t)) pt = pt ?? shown;
  }
  if (amb && dec && pt) {
    return { ok: false, error: `${what} mixes decimal commas (“${dec}”) and decimal points (“${pt}”), so “${amb}” cannot be read safely. Use one decimal separator throughout.` };
  }
  if (amb && !dec && !pt) {
    // No decimal of either kind anywhere: whole-number readings ≥ 100 say the
    // data are counts, so the commas group thousands.
    const whole = (evidence.integerReadings ?? []).map((c) => c.trim()).find((c) => /^\d+$/.test(c) && Number(c) >= 100);
    const members = new Set((evidence.readingCells ?? evidence.integerReadings ?? []).map((c) => c.trim()));
    if (whole && ambs.every((a) => members.has(a))) return { mode: "point", example: null, thousands: { example: amb, evidence: whole } };
    return {
      ok: false,
      error:
        `${what}: “${amb}” could be a number with a thousands comma (${amb.replace(",", "")}) or with a decimal comma ` +
        `(${amb.replace(",", ".")}), and nothing else in the data says which. Write decimals with a decimal point, or thousands without a separator.`,
    };
  }
  const mode: CommaMode = dec && !pt ? "comma" : "point";
  return { mode, example: dec ? (amb && mode === "comma" ? amb : dec) : null, ...(reason && mode === "comma" ? { reason } : {}) };
}

/** The notes for a block's comma reading (decimal commas, or thousands read on the evidence), or none. */
export function commaNotes(what: string, c: CommaReading): string[] {
  if (c.example) {
    const n = commaNote(what, c.example);
    return [c.reason ? `${n.replace(/\.$/, "")} (${c.reason}).` : n];
  }
  if (c.thousands) {
    return [
      `Commas in the ${what} were read as thousands separators: the readings are whole numbers (“${c.thousands.evidence}”) with no decimal anywhere, so “${c.thousands.example}” is ${qNum(readNum(c.thousands.example, "point"), 7)}.`,
    ];
  }
  return [];
}

/** A cell's number under a block's comma reading (see commaReading). */
export function readNum(s: string, mode: CommaMode): number {
  const t = s.trim();
  const m = /^([-−–]?)(\d+),(\d+)(%?)$/.exec(t);
  if (m && (mode === "comma" || m[2] === "0")) return parseCellNumber(`${m[1]}${m[2]}.${m[3]}${m[4]}`);
  return parseCellNumber(t);
}

/** The note shown when a block's commas were read as decimal points. */
export function commaNote(what: string, example: string): string {
  return `Commas in the ${what} were read as decimal points (European notation): “${example}” is ${qNum(readNum(example, "comma"), 6)}.`;
}

/** Every whitespace-, tab- or semicolon-separated token of a block (the evidence commaReading weighs). */
export function blockTokens(text: string): string[] {
  return text.split(/[\s;]+/).filter(Boolean);
}

/**
 * A user-supplied name as the result prints it. An EM DASH makes the pane
 * refuse to insert the whole result (insertableResultText), so it becomes an
 * en dash, which the insert path accepts.
 */
export function cleanName(s: string): string {
  return s.replace(/—/g, "–");
}

/** Analytic partial derivatives of the 4PL at x: [∂B, ∂T, ∂C, ∂h], and ∂f/∂x. */
function fourPLGrad(p: number[], x: number): { dp: number[]; dx: number } {
  const [B, T, C, h] = p;
  if (x <= 0) return { dp: [1, 0, 0, 0], dx: 0 };
  const q = Math.pow(C / x, h);
  const D = 1 + q;
  return {
    dp: [1 - 1 / D, 1 / D, (-(T - B) * q * h) / (C * D * D), (-(T - B) * q * Math.log(C / x)) / (D * D)],
    dx: ((T - B) * q * h) / (x * D * D),
  };
}

/** The 4PL solved for x: x = C·((T − B)/(y − B) − 1)^(−1/h). NaN outside the asymptotes. */
export function inverseFourPL(bottom: number, top: number, ec50: number, hill: number, y: number): number {
  const lo = Math.min(bottom, top);
  const hi = Math.max(bottom, top);
  if (!(y > lo && y < hi)) return NaN;
  return ec50 * Math.pow((top - bottom) / (y - bottom) - 1, -1 / hill);
}

function distinct(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/**
 * Fits the standard curve to every replicate point (unweighted) and reads each
 * unknown's mean response back through its inverse.
 */
export function standardCurve(standardsIn: StandardInput[], unknownsIn: UnknownInput[], model: CurveModel): StandardCurveResult {
  // Merge repeated concentrations, drop empty levels.
  const byConc = new Map<number, number[]>();
  for (const s of standardsIn) {
    if (!Number.isFinite(s.conc)) return { ok: false, error: "A standard concentration is not a number." };
    if (s.conc < 0) return { ok: false, error: `Standard concentration ${qNum(s.conc)} is negative; a concentration cannot be.` };
    if (!s.responses.length) continue;
    byConc.set(s.conc, [...(byConc.get(s.conc) ?? []), ...s.responses]);
  }
  const standards: StandardLevel[] = [...byConc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([conc, responses]) => ({ conc, responses, stats: replicateStats(responses) }));

  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of standards) for (const r of s.responses) { xs.push(s.conc); ys.push(r); }
  if (ys.some((v) => !Number.isFinite(v))) return { ok: false, error: "A standard response is not a number." };
  const levels = distinct(xs);
  const needLevels = model === "linear" ? 3 : 5;
  if (levels.length < needLevels) {
    return {
      ok: false,
      error:
        `A ${model === "linear" ? "straight-line" : "4-parameter logistic"} standard curve needs at least ${needLevels} ` +
        `different standard concentrations; ${levels.length === 1 ? "only 1 was" : `only ${levels.length} were`} given.`,
    };
  }
  const n = xs.length;
  // THE QUANTIFIABLE RANGE starts at the lowest NON-ZERO standard. A zero
  // standard anchors the curve, but it is not a level anything can be read
  // against: a response between it and the first real standard is below the
  // lowest standard (the lower limit of quantitation), not a concentration.
  const nonzero = levels.filter((x) => x > 0);
  const range: [number, number] = [nonzero.length ? nonzero[0] : levels[0], levels[levels.length - 1]];
  const notes: string[] = [];
  if (levels[0] === 0) {
    notes.push(
      `The zero standard is fitted (it anchors the curve) but is not a reportable level: the range read is ${qNum(range[0])} ` +
        `to ${qNum(range[1])}, and a response below the ${qNum(range[0])} standard is reported as below the lowest standard.`,
    );
  }
  const t = (df: number): number => tCritical(1 - CI_LEVEL, df);

  let curve: StandardCurve;
  let intervalMethod: string;
  let invert1: (yMean: number, m: number) => Omit<UnknownResult, "name" | "stats">;

  if (model === "linear") {
    const lr = linearRegression(xs, ys);
    const xbar = xs.reduce((a, b) => a + b, 0) / n;
    const ybar = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0;
    let ssr = 0;
    for (let i = 0; i < n; i++) sxx += (xs[i] - xbar) ** 2;
    for (let i = 0; i < n; i++) ssr += (ys[i] - lr.intercept - lr.slope * xs[i]) ** 2;
    const df = n - 2;
    const s = Math.sqrt(ssr / df);
    const b = lr.slope;
    if (!(Math.abs(b) > 0) || !Number.isFinite(b)) {
      return { ok: false, error: "The standards are flat (slope 0): the response does not change with concentration, so it cannot be read back as one." };
    }
    const tc = t(df);
    // g = t²s²/(b²Sxx). g ≥ 1 is EXACTLY "the slope is not significantly
    // different from zero at this level" (|b|/SE(b) ≤ t), and it is also when
    // the calibration interval stops being a finite interval.
    const g = (tc * tc * s * s) / (b * b * sxx);
    if (g >= 1) {
      const tb = b / Math.sqrt((s * s) / sxx);
      return {
        ok: false,
        error:
          `The standards show no significant trend: slope = ${qNum(b)}, t = ${qNum(tb, 2)} on ${df} df ` +
          `(p = ${qNum(tTestP(Math.abs(tb), df), 2)}), not beyond the critical t = ±${qNum(tc, 4)}. A curve this flat cannot be ` +
          "inverted: any concentration would fit the unknowns' responses about equally well.",
      };
    }
    curve = {
      model: "linear",
      slope: b,
      intercept: lr.intercept,
      slopeSE: lr.slopeSE,
      interceptSE: lr.interceptSE,
      rsquared: lr.rsquared,
      s,
      n,
      df,
      xbar,
      ybar,
      sxx,
      predict: (x) => lr.intercept + b * x,
    };
    intervalMethod =
      `95 % CI: the classical calibration (inverse-prediction) interval of Fieller / Draper & Smith, ` +
      `t on ${df} df, for the mean of the unknown's m replicate readings read against the n = ${n} standard points. ` +
      "The unknown's scatter is taken to be the curve's residual SD s (variance s²/m), not the unknown's own replicate SD; " +
      "it assumes a straight line with constant, independent, normal scatter. " +
      `No interval is given when g = t²s²/(b²Sxx) exceeds ${LINEAR_G_FLAG} (this tool's threshold: the slope's own 95 % CI is ` +
      "then wider than ±50 % of the slope, and the interval becomes long and lopsided) or when the interval reaches zero concentration.";
    const gWithheld = g > LINEAR_G_FLAG;
    if (gWithheld) {
      notes.push(
        `No calibration intervals are given: g = ${qNum(g, 2)} exceeds ${LINEAR_G_FLAG} (the slope's 95 % CI is wider than ±50 % of the slope), ` +
          "so the standards determine the line too poorly for an interval worth reporting. Add standards or replicates.",
      );
    }
    invert1 = (y0, m) => {
      const x0 = curve.model === "linear" ? (y0 - lr.intercept) / b : NaN;
      if (x0 < range[0]) return { status: "below" };
      if (x0 > range[1]) return { status: "above" };
      if (gWithheld) {
        return { status: "ok", conc: x0, ciMissing: `no CI: the slope is too poorly determined (g = ${qNum(g, 2)} > ${LINEAR_G_FLAG})` };
      }
      const u0 = x0 - xbar;
      const half = ((tc * s) / Math.abs(b)) * Math.sqrt((u0 * u0) / sxx + (1 - g) * (1 / m + 1 / n));
      const a1 = xbar + (u0 - half) / (1 - g);
      const a2 = xbar + (u0 + half) / (1 - g);
      const lo95 = Math.min(a1, a2);
      if (!(lo95 > 0) || !Number.isFinite(a1) || !Number.isFinite(a2)) {
        return { status: "ok", conc: x0, ciMissing: "no CI: the calibration interval reaches zero concentration here, so its lower end is not meaningful" };
      }
      return { status: "ok", conc: x0, ci: [lo95, Math.max(a1, a2)] };
    };
  } else {
    // Seeds: the plateaus from the lowest and highest levels, EC50 at the level
    // whose mean is nearest the middle (positive concentrations only), Hill 1.
    const lo = standards[0].stats.mean;
    const hi = standards[standards.length - 1].stats.mean;
    const mid = (lo + hi) / 2;
    let c0 = NaN;
    let best = Infinity;
    for (const s of standards) {
      if (s.conc > 0 && Math.abs(s.stats.mean - mid) < best) {
        best = Math.abs(s.stats.mean - mid);
        c0 = s.conc;
      }
    }
    const fit = levenbergMarquardt(xs, ys, ([B, T, C, h], x) => fourPL(B, T, C, h, x), [lo, hi, c0, 1], {
      maxIter: 1000,
      tol: 1e-15,
    });
    let [B, T, C, h] = fit.params;
    // A NEGATIVE Hill slope is the same curve written the other way round:
    // B + (T − B)/(1 + (C/x)^h) with h < 0 equals T + (B − T)/(1 + (C/x)^(−h))
    // for every x > 0. Rewritten so h > 0 and `bottom` is the x → 0 plateau,
    // which the asymptote names below rely on. NOT with a zero standard:
    // fourPL() pins x = 0 to the first parameter, so there the two forms differ
    // and the fit is refused below instead.
    if (h < 0 && levels[0] > 0) {
      [B, T, h] = [T, B, -h];
      fit.params = [B, T, C, h];
    }
    // Not-converged has two causes now (v2.193): the iteration limit, or a fit
    // whose JᵀJ is singular / non-finite. The second gets the specific
    // flat / not-identifiable diagnosis below; a non-converged fit that slips
    // past every specific check is still refused after them.
    if (!fit.converged && fit.iterations >= 1000) {
      return { ok: false, error: "The 4-parameter logistic fit did not converge on these standards (the optimiser stopped at its iteration limit), so its parameters are not a best fit and nothing is read from it." };
    }
    if (!fit.params.every(Number.isFinite) || !(C > 0) || h === 0) {
      return { ok: false, error: "The 4-parameter logistic did not fit these standards (the midpoint came out non-positive or not finite). Check that the standards span the curve." };
    }
    const df = n - 4;
    let ssr = 0;
    for (let i = 0; i < n; i++) ssr += (ys[i] - fourPL(B, T, C, h, xs[i])) ** 2;
    const s = Math.sqrt(ssr / df);
    const JtJ = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (const x of xs) {
      const { dp } = fourPLGrad(fit.params, x);
      for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) JtJ[a][c] += dp[a] * dp[c];
    }
    const inv = invert(JtJ);
    if (!inv) {
      // A FLAT curve also makes JᵀJ singular (the midpoint and slope have
      // nothing to bend): said as flat when the standards' means do not differ
      // beyond their replicate scatter (one-way ANOVA), not as "not identifiable".
      const reps = standards.map((s2) => s2.responses);
      if (reps.some((r) => r.length > 1)) {
        const an = oneWayAnova(reps);
        const flat = an.msWithin > 0 ? an.p > 1 - CI_LEVEL : an.ssBetween === 0;
        if (flat) {
          return {
            ok: false,
            error:
              "The 4PL plateaus are not determined by these standards: the standard means do not differ beyond their replicate scatter " +
              `(one-way ANOVA${an.msWithin > 0 ? `, p = ${qNum(an.p, 2)}` : ""}), so the response does not change with concentration ` +
              "(a flat curve) and a 4PL cannot be inverted from it.",
          };
        }
      }
      return { ok: false, error: "The 4-parameter logistic is not identifiable from these standards (its parameters trade off exactly). Add standards where the curve bends." };
    }
    const cov = inv.map((r) => r.map((v) => v * s * s));
    const se = [0, 1, 2, 3].map((j) => Math.sqrt(Math.max(0, cov[j][j])));
    const tc = t(df);
    // FLAT CURVE: the two plateaus must be resolved from each other.
    const spanSE = Math.sqrt(Math.max(0, cov[0][0] + cov[1][1] - 2 * cov[0][1]));
    if (!(Math.abs(T - B) > tc * spanSE) || !(Math.abs(T - B) > 0)) {
      return {
        ok: false,
        error:
          `The 4PL plateaus are not determined by these standards: top − bottom = ${qNum(T - B)} ± ${qNum(spanSE, 2)} (SE), ` +
          `not beyond ${qNum(tc, 4)} standard errors. Either the response does not change with concentration (a flat curve) ` +
          "or the standards cover only part of the sigmoid (no plateau reached); a 4PL cannot be inverted from either. " +
          "If the response is straight over this range, use the straight-line model.",
      };
    }
    // h < 0 flips which plateau the curve meets at x → 0, while fourPL() pins a
    // zero standard to `bottom`: the fit would be inconsistent and the asymptote
    // names below swapped. Refused rather than reinterpreted. (After the flat
    // check, so flat data gets the more useful message.)
    if (!(h > 0)) {
      return { ok: false, error: `The 4-parameter logistic fitted a Hill slope of ${qNum(h, 3)} (not positive), so the curve's plateaus are not where this model places them. Check the standards; the fit is not used.` };
    }
    // HOOK (PROZONE) EFFECT: a 4PL is monotone, so standard means that reverse
    // direction are not a 4PL, and a response on the falling side reads as two
    // concentrations. A reversal counts only when it exceeds the replicate
    // scatter (pooled within-level SD, or the fit's s with no replicates) at
    // 95 %, AND HOOK_SPAN_FRACTION of the span, so plateau noise is not flagged.
    {
      let ssPE = 0;
      let dfPE = 0;
      for (const lv of standards) {
        if (lv.stats.n < 2) continue;
        for (const v of lv.responses) ssPE += (v - lv.stats.mean) ** 2;
        dfPE += lv.stats.n - 1;
      }
      const sN = dfPE >= 2 ? Math.sqrt(ssPE / dfPE) : s;
      const tN = dfPE >= 2 ? t(dfPE) : tc;
      const dir = T > B ? 1 : -1;
      for (let i = 0; i + 1 < standards.length; i++) {
        const a = standards[i];
        const c2 = standards[i + 1];
        const drop = -dir * (c2.stats.mean - a.stats.mean);
        const noise = tN * sN * Math.sqrt(1 / a.stats.n + 1 / c2.stats.n);
        if (drop > noise && drop > HOOK_SPAN_FRACTION * Math.abs(T - B)) {
          return {
            ok: false,
            error:
              `The standards are not monotone: the mean response ${dir > 0 ? "falls" : "rises"} from ${qNum(a.stats.mean)} at ${qNum(a.conc)} ` +
              `to ${qNum(c2.stats.mean)} at ${qNum(c2.conc)}, a reversal larger than the replicate scatter explains. That is the shape of a ` +
              "hook (prozone) effect: a 4PL never turns back, and a response on the falling side would read as two concentrations. " +
              "Leave out the standards past the turn, or dilute and re-assay.",
          };
        }
      }
    }
    // MIDPOINT OR SLOPE NOT DETERMINED: a standard error larger than the
    // estimate itself. A step between two adjacent standards (0,0,0,1,1) fits
    // exactly with any midpoint between them and an arbitrarily steep slope; the
    // optimiser stops at Hill ≈ 250 with EC50 ± 1100 %. It used to be refused
    // only because that search happened to run out of iterations.
    if (!(se[2] < C) || !(se[3] < Math.abs(h))) {
      return {
        ok: false,
        error:
          `The 4PL midpoint and slope are not determined by these standards (EC50 = ${qNum(C)} ± ${qNum(se[2], 2)}, ` +
          `Hill slope = ${qNum(h, 3)} ± ${qNum(se[3], 2)}: a standard error larger than the estimate), so the fit did not converge ` +
          "to a usable curve and nothing is read from it. Add standards (or replicates) where the curve bends.",
      };
    }
    if (!fit.converged) {
      return { ok: false, error: "The 4-parameter logistic fit did not converge on these standards (its parameters could not be determined), so nothing is read from it." };
    }
    let ssTot = 0;
    const my = ys.reduce((a, b2) => a + b2, 0) / n;
    for (const y of ys) ssTot += (y - my) ** 2;
    curve = {
      model: "4pl",
      bottom: B,
      top: T,
      ec50: C,
      hill: h,
      se,
      cov,
      rsquared: ssTot === 0 ? 1 : 1 - ssr / ssTot,
      s,
      n,
      df,
      predict: (x) => fourPL(B, T, C, h, x),
    };
    intervalMethod =
      `95 % CI: first-order delta method on the inverse 4PL, using the full parameter covariance s²(JᵀJ)⁻¹ ` +
      `and, for the unknown's mean of m readings, the curve's residual variance s²/m (the unknown's own replicate SD is not used), ` +
      `with t on ${df} df. It is an approximation: it is symmetric ` +
      "in concentration, and it is poor where the curve flattens toward an asymptote.";
    const yLo = Math.min(B, T);
    const yHi = Math.max(B, T);
    invert1 = (y0, m) => {
      if (!(y0 > yLo && y0 < yHi)) {
        const aboveHi = y0 >= yHi;
        const which = aboveHi ? (T > B ? "top" : "bottom") : T > B ? "bottom" : "top";
        const val = aboveHi ? yHi : yLo;
        return {
          status: "beyond-asymptote",
          message:
            `${aboveHi ? "above" : "below"} the fitted ${which} asymptote (${qNum(val)}): the curve never reaches this ` +
            "response, so no concentration corresponds to it",
        };
      }
      const x0 = inverseFourPL(B, T, C, h, y0);
      // A relative 1e-9 allowance: the inverse of the curve AT a standard's
      // response comes back a rounding error past it, which is that standard.
      if (x0 < range[0] * (1 - 1e-9)) return { status: "below" };
      if (x0 > range[1] * (1 + 1e-9)) return { status: "above" };
      const { dp, dx } = fourPLGrad([B, T, C, h], x0);
      const g = dp.map((d) => -d / dx);
      let v = 0;
      for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) v += g[a] * cov[a][c] * g[c];
      v += (s * s) / (m * dx * dx);
      const half = tc * Math.sqrt(v);
      const lo95 = x0 - half;
      if (!(lo95 > 0)) {
        return {
          status: "ok",
          conc: x0,
          ciMissing: "no CI: the delta-method interval reaches zero concentration here, where the approximation is not meaningful",
        };
      }
      return { status: "ok", conc: x0, ci: [lo95, x0 + half] };
    };
    notes.push(
      "4PL fitted by least squares to every replicate point, unweighted. Immunoassay responses are often more variable at " +
        "the top of the curve; if so, a weighted fit is needed and these intervals are too narrow there.",
    );
    if (levels[0] === 0) {
      notes.push("In the 4PL the zero standard is fitted at the curve's x → 0 plateau (the bottom parameter).");
    }
  }

  const unknowns: UnknownResult[] = unknownsIn.map((u) => {
    const stats = replicateStats(u.responses.filter(Number.isFinite));
    if (!stats.n) return { name: u.name, stats, status: "no-data", message: "no readings" };
    const r = invert1(stats.mean, stats.n);
    if (r.status === "below") {
      return { name: u.name, stats, status: "below", message: `below the lowest standard (${qNum(range[0])}); not extrapolated` };
    }
    if (r.status === "above") {
      return { name: u.name, stats, status: "above", message: `above the highest standard (${qNum(range[1])}); not extrapolated` };
    }
    return { name: u.name, stats, ...r };
  });
  const noisy = unknowns.filter((u) => u.status !== "no-data" && Number.isFinite(u.stats.cv) && u.stats.cv > UNKNOWN_CV_FLAG);
  if (noisy.length) {
    notes.push(
      `${noisy.map((u) => `${u.name} (CV ${qNum(u.stats.cv, 2)} %)`).join(", ")}: replicate CV above ${UNKNOWN_CV_FLAG} % (this tool's flag, ` +
        `not a published limit). The interval uses the curve's scatter, not the unknown's own, so it is too narrow for ${noisy.length === 1 ? "this unknown" : "these unknowns"}; check the replicates.`,
    );
  }

  return { ok: true, curve, standards, unknowns, range, intervalMethod, notes };
}

// ------------------------------------------------------------------- plates

export interface PlateRead {
  ok: true;
  rows: number;
  cols: number;
  /** Row letters, A… */
  rowLabels: string[];
  /** well name ("A1") → reading; null = empty cell. Absent rows read as null. */
  wells: Map<string, number | null>;
  notes: string[];
}

const ROW_LETTERS = "ABCDEFGHIJKLMNOP";
const EMPTY_CELL = /^(|-|—|–|\.|n\/?a|na|nan|empty|none)$/i;

function splitLine(line: string, tabbed: boolean): string[] {
  return tabbed ? line.split("\t").map((c) => c.trim()) : line.trim().split(/[\s;]+/).filter((c) => c !== "");
}

function isColumnHeader(cells: string[]): number[] | null {
  const nums = cells.filter((c) => c !== "");
  // A leading corner cell may hold a word ("Row", "<>"): drop one non-numeric first cell.
  const body = nums.length && !/^\d+$/.test(nums[0]) ? nums.slice(1) : nums;
  if (body.length < 2 || !body.every((c) => /^\d+$/.test(c))) return null;
  // Column numbers: start at 1, all distinct, none past 24. A first row of
  // integer READINGS (0 1 2 …, or 1 1 1 …) is data, not a header.
  const v = body.map(Number);
  if (v[0] !== 1 || new Set(v).size !== v.length || v.some((x) => x < 1 || x > 24)) return null;
  return v;
}

/**
 * Reads a plate grid: a Word table (tab-joined by the table feed) or typed rows.
 * Accepted: a header row of column numbers 1…N and/or a first column of row
 * letters, or a bare 8×12 / 16×24 block (read as A1 at top left). Wells are
 * mapped by their LABELS, so a row the table reader dropped as blank is not a
 * shifted row, it is an absent one.
 */
export function readPlate(text: string, context: string[] = []): PlateRead | Refusal {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, error: "The plate is empty." };
  const tabbed = lines.some((l) => l.includes("\t"));
  let grid = lines.map((l) => splitLine(l, tabbed));
  const notes: string[] = [];
  const commas = commaReading([...grid.flat(), ...context], "The plate", { integerReadings: grid.flat() });
  if ("ok" in commas) return commas;
  notes.push(...commaNotes("plate readings", commas));

  let colNums: number[] | null = isColumnHeader(grid[0]);
  // Whether the header row has a corner cell over a row-label column (empty, or a word like "Row").
  const hasCorner = colNums !== null && (grid[0][0] === "" || !/^\d+$/.test(grid[0][0]));
  if (colNums) grid = grid.slice(1);
  // Tab-joined tables keep the empty corner cell; typed text does not. Align on the row letter.
  const rowLetterOf = (cells: string[]): string | null => (cells.length && /^[A-Za-z]$/.test(cells[0]) ? cells[0].toUpperCase() : null);
  const lettered = grid.length > 0 && grid.every((r) => rowLetterOf(r) !== null);
  if (!lettered && grid.some((r) => rowLetterOf(r) !== null)) {
    const bad = grid.find((r) => rowLetterOf(r) === null);
    return { ok: false, error: `Some rows start with a row letter and some do not (a row begins “${bad?.[0] ?? ""}”). Label every row A, B, C…, or none.` };
  }
  // An unlettered tab-joined row loses its first cell ONLY when that cell is the
  // empty row-label column: the header had a corner cell, or the row is one
  // cell longer than the plate. Otherwise an empty first WELL would shift the
  // whole row left by one column.
  const bodyRows = grid.map((r) =>
    lettered ? r.slice(1) : tabbed && r[0] === "" && (hasCorner || (colNums !== null && r.length === colNums.length + 1)) ? r.slice(1) : r,
  );

  let cols: number;
  if (colNums) {
    for (let i = 0; i < colNums.length; i++) {
      if (colNums[i] !== i + 1) {
        return { ok: false, error: `The column headers must run 1, 2, 3… in order; header ${i + 1} reads ${colNums[i]}.` };
      }
    }
    cols = colNums.length;
  } else {
    cols = Math.max(...bodyRows.map((r) => r.length));
    colNums = Array.from({ length: cols }, (_, i) => i + 1);
  }
  if (cols !== 12 && cols !== 24) {
    return {
      ok: false,
      error: `The plate has ${cols} column${cols === 1 ? "" : "s"}. A 96-well plate has 12 (rows A–H) and a 384-well plate 24 (rows A–P); include the column-number header row so empty edge columns still count.`,
    };
  }
  const nRows = cols === 12 ? 8 : 16;
  const rowLabels = ROW_LETTERS.slice(0, nRows).split("");

  let letters: string[];
  if (lettered) {
    letters = grid.map((r) => rowLetterOf(r)!);
    const seen = new Set<string>();
    let prev = -1;
    for (const L of letters) {
      const idx = ROW_LETTERS.indexOf(L);
      if (seen.has(L)) return { ok: false, error: `Row ${L} appears twice.` };
      if (idx < 0 || idx >= nRows) {
        return { ok: false, error: `Row ${L} is past ${rowLabels[nRows - 1]}: a ${nRows * cols}-well plate has rows A–${rowLabels[nRows - 1]}.` };
      }
      if (idx < prev) return { ok: false, error: `Row ${L} comes after row ${ROW_LETTERS[prev]}: the rows must run in order A, B, C….` };
      seen.add(L);
      prev = idx;
    }
    const absent = rowLabels.filter((L) => !seen.has(L));
    if (absent.length) notes.push(`Row${absent.length > 1 ? "s" : ""} ${absent.join(", ")} not in the table: read as empty.`);
  } else {
    if (grid.length > nRows) {
      return { ok: false, error: `The plate has ${grid.length} rows of ${cols}; a ${nRows * cols}-well plate has ${nRows}.` };
    }
    if (grid.length !== nRows) {
      return {
        ok: false,
        error: `The plate has ${grid.length} rows of ${cols} but no row letters, so the missing ${nRows - grid.length} row${nRows - grid.length === 1 ? "" : "s"} cannot be placed. Add row letters A–${rowLabels[nRows - 1]}.`,
      };
    }
    letters = rowLabels.slice();
    notes.push(`No row letters: read as rows A–${rowLabels[nRows - 1]} from the top.`);
  }

  const wells = new Map<string, number | null>();
  for (const L of rowLabels) for (let c = 1; c <= cols; c++) wells.set(`${L}${c}`, null);
  for (let r = 0; r < bodyRows.length; r++) {
    const cells = bodyRows[r];
    if (cells.length > cols) {
      return { ok: false, error: `Row ${letters[r]} has ${cells.length} cells but the plate has ${cols} columns.` };
    }
    // Typed rows are split on spaces, so a skipped well cannot be seen: a short
    // row would put every later reading one column to the left.
    if (!tabbed && cells.length < cols) {
      return {
        ok: false,
        error:
          `Row ${letters[r]} has ${cells.length} reading${cells.length === 1 ? "" : "s"} but the plate has ${cols} columns. Typed rows are split ` +
          "on spaces, so an empty well must be written as “-” to keep the later wells in their columns.",
      };
    }
    for (let c = 0; c < cells.length; c++) {
      const raw = cells[c].trim();
      const name = `${letters[r]}${c + 1}`;
      if (EMPTY_CELL.test(raw)) continue;
      const v = readNum(raw, commas.mode);
      if (!Number.isFinite(v)) {
        if (/^ov(e)?r|^ovrflw|^sat/i.test(raw)) {
          return { ok: false, error: `Well ${name} reads “${raw}”: the detector saturated, so that well has no value. Re-read the plate at a lower gain or dilute the sample.` };
        }
        return { ok: false, error: `Well ${name} holds “${raw}”, which is not a number.` };
      }
      wells.set(name, v);
    }
  }
  return { ok: true, rows: nRows, cols, rowLabels, wells, notes };
}

export interface LayoutGroup {
  kind: "standard" | "blank" | "sample";
  /** Standard concentration. */
  conc?: number;
  name: string;
  wells: string[];
}

function expandWells(token: string, rows: number, cols: number): string[] | string {
  const m = /^([A-Pa-p])(\d{1,2})(?:\s*[-–:]\s*([A-Pa-p])(\d{1,2}))?$/.exec(token);
  if (!m) return `“${token}” is not a well (write A1, or a block A1-A3 / A1:C3).`;
  const r1 = ROW_LETTERS.indexOf(m[1].toUpperCase());
  const c1 = Number(m[2]);
  const r2 = m[3] ? ROW_LETTERS.indexOf(m[3].toUpperCase()) : r1;
  const c2 = m[4] ? Number(m[4]) : c1;
  for (const [r, c] of [[r1, c1], [r2, c2]]) {
    if (r >= rows || c < 1 || c > cols) return `Well ${ROW_LETTERS[r]}${c} is not on a ${rows * cols}-well plate.`;
  }
  const out: string[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(`${ROW_LETTERS[r]}${c}`);
  return out;
}

const STD_LABEL = /^(?:std|standard|stnd|cal)(?=[\s:#])\s*[:#]?\s*(.+)$/i;
const UNIT_TAIL = /\s*[a-zµμ/]+[a-zA-Z/µμ]*$/i;

/** The concentration text of every "std …" label in a layout (the evidence for its comma reading). */
export function layoutConcTexts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    for (const cell of line.split("\t")) {
      const lab = cell.includes(":") && !line.includes("\t") ? cell.slice(0, cell.indexOf(":")) : cell;
      const m = STD_LABEL.exec(lab.trim());
      if (m) out.push(m[1].replace(UNIT_TAIL, "").trim());
    }
  }
  return out;
}

function labelGroup(label: string, mode: CommaMode = "point"): { kind: LayoutGroup["kind"]; conc?: number; name: string } | string {
  const t = cleanName(label.trim());
  if (/^(blank|blanks|blk)$/i.test(t)) return { kind: "blank", name: "blank" };
  // "Std1"…"Std8" is how many plate maps NUMBER their standards; read as
  // concentrations 1…8 it would be a silent, wrong curve. Refused by name.
  if (/^(?:std|standard|stnd|cal)\d/i.test(t)) {
    return `“${t}” is ambiguous: a standard numbered ${t.replace(/^\D+/, "")}, or a concentration of ${t.replace(/^\D+/, "")}? Write the CONCENTRATION after a space: “std 100”.`;
  }
  // "std 100", "standard: 50" — but not "calibrator", "standardised".
  const std = STD_LABEL.exec(t);
  if (std) {
    const conc = readNum(std[1].replace(UNIT_TAIL, "").trim(), mode);
    if (!Number.isFinite(conc)) return `Standard “${t}” has no readable concentration (write e.g. “std 100”).`;
    if (conc < 0) return `Standard “${t}” has a negative concentration.`;
    return { kind: "standard", conc, name: `std ${std[1].trim()}` };
  }
  return { kind: "sample", name: t };
}

/**
 * The layout map, either as lines — "std 100: A1-A3", "blank: H10-H12",
 * "Sample 1: B4 B5 B6" — or as a plate-shaped grid of labels ("std 100",
 * "blank", a sample name; an empty cell is an unused well).
 */
export function parseLayout(text: string, rows: number, cols: number, notes?: string[], context: string[] = []): LayoutGroup[] | Refusal {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, error: "The layout is empty: say which wells are standards, blanks and samples." };
  // The plate's cells (context) are its readings: whole-number counts there
  // make its "1,234" thousands; a layout concentration "std 1,250" never is.
  const commas = commaReading([...layoutConcTexts(text), ...context], "The layout's standard concentrations", { integerReadings: context });
  if ("ok" in commas) return commas;
  if (commas.example && notes) notes.push(commaNote("standard concentrations of the layout", commas.example));
  const groups = new Map<string, LayoutGroup>();
  const owner = new Map<string, string>();
  const add = (label: string, wells: string[]): string | null => {
    const g = labelGroup(label, commas.mode);
    if (typeof g === "string") return g;
    const key = g.kind === "standard" ? `std:${g.conc}` : `${g.kind}:${g.name.toLowerCase()}`;
    const grp = groups.get(key) ?? { ...g, wells: [] };
    for (const w of wells) {
      const prior = owner.get(w);
      if (prior !== undefined && prior !== key) return `Well ${w} is assigned twice (${groups.get(prior)?.name} and ${g.name}).`;
      if (prior === undefined) {
        owner.set(w, key);
        grp.wells.push(w);
      }
    }
    groups.set(key, grp);
    return null;
  };

  const tabbedLayout = lines.some((l) => l.includes("\t"));
  // A two-column table (label | wells) is the line form laid out as a table.
  const twoCol =
    tabbedLayout &&
    lines.every((l) => {
      const c = l.split("\t").map((x) => x.trim()).filter(Boolean);
      return c.length === 2 && /^[A-Pa-p]\d/.test(c[1]);
    });
  const lineForm = twoCol
    ? lines.map((l) => {
        const c = l.split("\t").map((x) => x.trim()).filter(Boolean);
        return `${c[0].replace(/:$/, "")}: ${c[1]}`;
      })
    : lines;
  if (!tabbedLayout || twoCol) {
    for (const line of lineForm) {
      const i = line.indexOf(":");
      if (i < 0) return { ok: false, error: `Layout line “${line.trim()}” has no colon: write “std 100: A1-A3”.` };
      // "A1:C3" inside the well list is a block, not the label colon: the label is before the FIRST colon.
      const label = line.slice(0, i);
      const wellText = line.slice(i + 1).trim();
      const tokens = wellText.split(/[\s,;]+/).filter(Boolean);
      // Re-join "A1 - A3" written with spaces round the dash.
      const joined: string[] = [];
      for (let k = 0; k < tokens.length; k++) {
        if ((tokens[k] === "-" || tokens[k] === "–") && joined.length && k + 1 < tokens.length) {
          joined[joined.length - 1] += "-" + tokens[++k];
        } else joined.push(tokens[k]);
      }
      if (!joined.length) return { ok: false, error: `“${label.trim()}” lists no wells.` };
      const wells: string[] = [];
      for (const tk of joined) {
        const w = expandWells(tk, rows, cols);
        if (typeof w === "string") return { ok: false, error: w };
        wells.push(...w);
      }
      const err = add(label, wells);
      if (err) return { ok: false, error: err };
    }
  } else {
    // A plate-shaped grid of labels, tab-joined from a table (typed grids are
    // not supported: labels such as "std 100" contain spaces).
    let grid = lines.map((l) => l.split("\t").map((c) => c.trim()));
    if (isColumnHeader(grid[0])) grid = grid.slice(1);
    const lettered = grid.every((r) => /^[A-Pa-p]$/.test(r[0] ?? ""));
    if (!lettered && grid.length !== rows) {
      return { ok: false, error: `The layout grid has ${grid.length} rows and no row letters; a ${rows * cols}-well plate has ${rows}.` };
    }
    for (let r = 0; r < grid.length; r++) {
      const letter = lettered ? grid[r][0].toUpperCase() : ROW_LETTERS[r];
      const ri = ROW_LETTERS.indexOf(letter);
      if (ri >= rows) return { ok: false, error: `Layout row ${letter} is not on a ${rows * cols}-well plate.` };
      const cells = lettered ? grid[r].slice(1) : grid[r];
      if (cells.length > cols) return { ok: false, error: `Layout row ${letter} has ${cells.length} cells; the plate has ${cols} columns.` };
      for (let c = 0; c < cells.length; c++) {
        if (EMPTY_CELL.test(cells[c])) continue;
        const err = add(cells[c], [`${letter}${c + 1}`]);
        if (err) return { ok: false, error: err };
      }
    }
  }
  const out = [...groups.values()];
  if (!out.some((g) => g.kind === "standard")) return { ok: false, error: "The layout names no standards (write e.g. “std 100: A1-A3”)." };
  return out;
}

export interface PlateGroupReading {
  name: string;
  kind: LayoutGroup["kind"];
  conc?: number;
  wells: string[];
  /** Raw readings of the wells that held one. */
  raw: number[];
  /** Blank-subtracted readings. */
  corrected: number[];
  emptyWells: string[];
}

export interface PlateAnalysis {
  ok: true;
  plate: PlateRead;
  groups: PlateGroupReading[];
  blank: ReplicateStats | null;
  curve: StandardCurveResult;
  notes: string[];
}

/** Plate + layout → blank-subtracted, replicate-grouped standards and samples → the standard curve. */
export function analysePlate(plateText: string, layoutText: string, model: CurveModel): PlateAnalysis | Refusal {
  // The plate and its layout are one assay: each is evidence for how the other's commas read.
  const plate = readPlate(plateText, layoutConcTexts(layoutText));
  if (!plate.ok) return plate;
  const p = plate;
  const notes = [...p.notes];
  const layout = parseLayout(layoutText, p.rows, p.cols, notes, blockTokens(plateText));
  if (!Array.isArray(layout)) return layout;

  const read = (g: LayoutGroup): { raw: number[]; empty: string[] } => {
    const raw: number[] = [];
    const empty: string[] = [];
    for (const w of g.wells) {
      const v = p.wells.get(w);
      if (v === null || v === undefined) empty.push(w);
      else raw.push(v);
    }
    return { raw, empty };
  };

  const blanks = layout.filter((g) => g.kind === "blank");
  const blankRaw = blanks.flatMap((g) => read(g).raw);
  const blank = blankRaw.length ? replicateStats(blankRaw) : null;
  const sub = blank ? blank.mean : 0;
  if (!blank) notes.push("No blank wells in the layout: readings are used as read, without blank subtraction.");

  const groups: PlateGroupReading[] = layout.map((g) => {
    const { raw, empty } = read(g);
    return {
      name: g.name,
      kind: g.kind,
      conc: g.conc,
      wells: g.wells,
      raw,
      corrected: g.kind === "blank" ? raw : raw.map((v) => v - sub),
      emptyWells: empty,
    };
  });
  const empties = groups.flatMap((g) => g.emptyWells.map((w) => `${w} (${g.name})`));
  if (empties.length) {
    notes.push(
      `${empties.length} assigned well${empties.length === 1 ? " is" : "s are"} empty and left out of ${empties.length === 1 ? "its" : "their"} group: ${empties.slice(0, 12).join(", ")}${empties.length > 12 ? ", …" : ""}.`,
    );
  }
  const assigned = new Set(layout.flatMap((g) => g.wells));
  const strays = [...p.wells.entries()].filter(([w, v]) => v !== null && !assigned.has(w)).map(([w]) => w);
  if (strays.length) {
    notes.push(`${strays.length} well${strays.length === 1 ? " holds a reading" : "s hold readings"} but ${strays.length === 1 ? "is" : "are"} not in the layout, and ${strays.length === 1 ? "is" : "are"} ignored: ${strays.slice(0, 12).join(", ")}${strays.length > 12 ? ", …" : ""}.`);
  }
  if (blanks.length && !blank) {
    return { ok: false, error: "Every blank well is empty, so there is no blank to subtract. Fill the blank wells or remove them from the layout." };
  }
  // Non-zero standards whose MEAN reads below the blank (a zero standard or an
  // empty sample sits at the blank level, so its wells straddle zero by noise).
  const belowBlank = groups
    .filter((g) => g.kind === "standard" && (g.conc ?? 0) > 0 && g.corrected.length && g.corrected.reduce((s2, v) => s2 + v, 0) / g.corrected.length < 0)
    .map((g) => g.name);
  if (blank && belowBlank.length) {
    notes.push(
      `The blank mean (${qNum(blank.mean)}) exceeds the mean reading of ${belowBlank.slice(0, 12).join(", ")}${belowBlank.length > 12 ? ", …" : ""}: ` +
        "the blank-subtracted mean there is negative. A blank should read below every non-zero standard; check the blank wells.",
    );
  }

  const stds = groups.filter((g) => g.kind === "standard");
  const curve = standardCurve(
    stds.map((g) => ({ conc: g.conc!, responses: g.corrected })),
    groups.filter((g) => g.kind === "sample").map((g) => ({ name: g.name, responses: g.corrected })),
    model,
  );
  return { ok: true, plate: p, groups, blank, curve, notes };
}

// --------------------------------------------------------------------- qPCR

export interface CtRecord {
  group: string;
  gene: string;
  /** null = Undetermined (no amplification). */
  ct: number | null;
}
export interface CtTable {
  ok: true;
  records: CtRecord[];
  notes: string[];
}

/**
 * A non-amplification, as instruments write it: "Undetermined" (Applied
 * Biosystems), "N/A" (Bio-Rad CFX), "No Ct"/"No Cq". NOT a number — and a
 * Ct of 40 is a number, never read as one of these.
 */
const UNDETERMINED = /^(undetermined|undet\.?|no ?ct|no ?cq|n\/?a|na|nan|none|neg|negative)$/i;
/** A blank or dashed cell is a missing replicate (not run), not a non-amplification. */
const NO_CELL = /^(|-|—|–)$/;
const CT_COL = /^(c[tqp]|c\s?t|threshold cycle)(\s*(#|no\.?|rep(licate)?)?\s*\d+)?$/i;
const GENE_COL = /^(gene|target|target name|detector|assay|primer|amplicon|gene name)$/i;
const GROUP_COL = /^(sample|sample name|group|condition|treatment|biological group|tissue|time|time point)$/i;

/**
 * A Ct table: a header row naming a sample/group column, a gene/target column
 * and one or more Ct columns ("Ct", "Ct 1", "Cq" — not "Ct Mean"/"Ct SD", which
 * are summaries and would double-count), one well per row or replicates across;
 * or header-less lines "group  gene  Ct  Ct  Ct".
 */
export function readCtTable(text: string): CtTable | Refusal {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, error: "The Ct table is empty." };
  const tabbed = lines.some((l) => l.includes("\t"));
  // Typed text splits on spaces, so keep the two-word spellings in one token.
  const rows = lines.map((l) => splitLine(tabbed ? l : l.replace(/\bno\s+(c[tq])\b/gi, "No$1"), tabbed));
  const notes: string[] = [];
  const records: CtRecord[] = [];
  const head = rows[0];
  const ctCols = head.map((h, i) => (CT_COL.test(h) ? i : -1)).filter((i) => i >= 0);
  const geneCol = head.findIndex((h) => GENE_COL.test(h));
  const groupCol = head.findIndex((h) => GROUP_COL.test(h));
  // The Ct cells (the header's Ct columns, or everything after group and gene):
  // a Ct cannot exceed ~60 cycles, so "18,123" there is a decimal comma.
  const ctCells = ctCols.length && geneCol >= 0 && groupCol >= 0 ? rows.slice(1).flatMap((row) => ctCols.map((c) => row[c] ?? "")) : rows.flatMap((row) => row.slice(2));
  const commas = commaReading(rows.flat(), "The Ct table", { bounded: { cells: ctCells, max: CT_MAX, why: `a Ct cannot exceed ${CT_MAX} cycles` } });
  if ("ok" in commas) return commas;
  notes.push(...commaNotes("Ct table", commas));
  let undet = 0;

  /** A Ct, null for Undetermined, undefined for a missing cell, or a refusal string. */
  const readCt = (raw: string, where: string): number | null | undefined | string => {
    const t = raw.trim();
    if (NO_CELL.test(t)) return undefined;
    if (UNDETERMINED.test(t)) return null;
    const v = readNum(t, commas.mode);
    if (!Number.isFinite(v)) return `${where}: “${t}” is not a Ct (a cycle number, or “Undetermined”).`;
    if (v <= 0) return `${where}: Ct ${qNum(v)} is not a cycle number (a Ct is positive).`;
    return v;
  };

  if (ctCols.length && geneCol >= 0 && groupCol >= 0) {
    // Anchored: "Ct Mean", "Cq SD" are summaries; "Detector" merely contains "ct".
    const ignored = head.filter((h, i) => /^(c[tqp]|c\s?t)\b|threshold cycle/i.test(h.trim()) && !ctCols.includes(i));
    if (ignored.length) notes.push(`Summary columns ignored (the replicates are used instead): ${ignored.join(", ")}.`);
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const group = cleanName((row[groupCol] ?? "").trim());
      const gene = cleanName((row[geneCol] ?? "").trim());
      if (!group && !gene && ctCols.every((c) => !(row[c] ?? "").trim())) continue;
      if (!group || !gene) return { ok: false, error: `Row ${r + 1} of the table has no ${!group ? "sample/group" : "gene/target"} name.` };
      for (const c of ctCols) {
        const v = readCt(row[c] ?? "", `Row ${r + 1} (${group}, ${gene})`);
        if (typeof v === "string") return { ok: false, error: v };
        if (v === undefined) continue;
        if (v === null) undet++;
        records.push({ group, gene, ct: v });
      }
    }
  } else {
    // Row 0 is a header only when it holds no Ct from its third cell on: a
    // header-less first line "Treatment  GAPDH  18.2" is data, not a header.
    const headIsData = head.slice(2).some((c) => UNDETERMINED.test(c.trim()) || Number.isFinite(readNum(c, commas.mode)));
    if (!headIsData && head.some((h) => CT_COL.test(h) || GENE_COL.test(h) || GROUP_COL.test(h))) {
      return {
        ok: false,
        error:
          "The table has a header row but not all three columns it needs: a sample/group column (Sample, Group, Condition…), " +
          "a gene column (Gene, Target, Detector…) and a Ct column (Ct, Cq, Ct 1…).",
      };
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 3) return { ok: false, error: `Line ${r + 1} needs a group, a gene and at least one Ct (e.g. “control  GAPDH  18.2  18.3”).` };
      const [group0, gene0, ...cts] = row;
      const group = cleanName(group0);
      const gene = cleanName(gene0);
      for (const c of cts) {
        const v = readCt(c, `Line ${r + 1} (${group}, ${gene})`);
        if (typeof v === "string") return { ok: false, error: v };
        if (v === undefined) continue;
        if (v === null) undet++;
        records.push({ group, gene, ct: v });
      }
    }
  }
  if (!records.length) return { ok: false, error: "The Ct table has no Ct values." };
  if (undet) {
    notes.push(
      `${undet} replicate${undet === 1 ? " is" : "s are"} Undetermined (no amplification) and left out of ${undet === 1 ? "its" : "their"} mean; ` +
        "an Undetermined well is not given a Ct (it is not replaced with 40 or the cycle count).",
    );
  }
  return { ok: true, records, notes };
}

export interface GeneGroupStats {
  group: string;
  gene: string;
  stats: ReplicateStats;
  undetermined: number;
}

function sameName(a: string, b: string): boolean {
  // cleanName on both sides: the table's names are cleaned at parse time, the typed fields are not.
  return cleanName(a.trim().toLowerCase()) === cleanName(b.trim().toLowerCase());
}

function tabulate(t: CtTable): { groups: string[]; genes: string[]; cell: (g: string, gene: string) => GeneGroupStats } {
  const groups: string[] = [];
  const genes: string[] = [];
  for (const r of t.records) {
    if (!groups.some((g) => sameName(g, r.group))) groups.push(r.group);
    if (!genes.some((g) => sameName(g, r.gene))) genes.push(r.gene);
  }
  const cell = (g: string, gene: string): GeneGroupStats => {
    const recs = t.records.filter((r) => sameName(r.group, g) && sameName(r.gene, gene));
    const vals = recs.map((r) => r.ct).filter((v): v is number => v !== null);
    return { group: g, gene, stats: replicateStats(vals), undetermined: recs.length - vals.length };
  };
  return { groups, genes, cell };
}

export interface LivakRow {
  group: string;
  target: string;
  targetCt: GeneGroupStats;
  refCt: GeneGroupStats;
  dCt: number;
  dCtSD: number;
  ddCt: number;
  ddCtSD: number;
  fold: number;
  /** 2^−(ΔΔCt + SD) and 2^−(ΔΔCt − SD); NaN when the SD is unavailable. */
  foldLow: number;
  foldHigh: number;
  isControl: boolean;
}

export interface LivakResult {
  ok: true;
  reference: string;
  control: string;
  targets: string[];
  groups: string[];
  rows: LivakRow[];
  /** Groups or genes that could not be computed, in words. */
  skipped: string[];
  /** Reference-gene Ct shift of each treated group from control (cycles). */
  refShift: { group: string; shift: number }[];
  notes: string[];
}

export type CalibratorError = "both" | "propagate";

/** Threshold, in cycles, at which a reference-gene shift is flagged. THIS TOOL'S choice, stated as such. */
export const REF_SHIFT_FLAG = 0.5;

function resolveName(list: string[], want: string, what: string): string | Refusal {
  const hit = list.find((g) => sameName(g, want));
  if (hit) return hit;
  return { ok: false, error: `No ${what} named “${want.trim()}” in the table; it has ${list.map((g) => `“${g}”`).join(", ")}.` };
}

/**
 * Livak & Schmittgen (2001) 2^−ΔΔCt, target and reference amplified in
 * SEPARATE wells (their Table 1): replicate Cts averaged per gene, ΔCt =
 * mean Ct(target) − mean Ct(reference) with SD √(s_T² + s_R²); ΔΔCt = ΔCt −
 * ΔCt(calibrator). With `both` (their Tables 1–2) the SD of ΔΔCt equals that of
 * ΔCt — the calibrator subtraction is treated as an arbitrary constant and the
 * calibrator keeps its own error; with `propagate` the calibrator is 1 without
 * error and its SD is propagated into each treated group. Range 2^−(ΔΔCt ± SD).
 */
export function livak(t: CtTable, reference: string, control: string, mode: CalibratorError = "both"): LivakResult | Refusal {
  const { groups, genes, cell } = tabulate(t);
  const ref = resolveName(genes, reference, "reference gene");
  if (typeof ref !== "string") return ref;
  const ctrl = resolveName(groups, control, "control group");
  if (typeof ctrl !== "string") return ctrl;
  const targets = genes.filter((g) => !sameName(g, ref));
  if (!targets.length) return { ok: false, error: `The table holds only the reference gene ${ref}; there is no target gene to quantify.` };
  if (groups.length < 2) return { ok: false, error: `The table has only the control group ${ctrl}; a fold change needs at least one other group.` };
  const skipped: string[] = [];
  const notes: string[] = [];
  const refCtrl = cell(ctrl, ref);
  if (!refCtrl.stats.n) return { ok: false, error: `The reference gene ${ref} has no Ct in the control group ${ctrl} (every replicate Undetermined or absent): nothing can be normalised.` };

  const rows: LivakRow[] = [];
  for (const target of targets) {
    const tc = cell(ctrl, target);
    if (!tc.stats.n) {
      skipped.push(`${target}: no Ct in the control group ${ctrl} (Undetermined or absent), so no group can be compared for it.`);
      continue;
    }
    const dCtCtrl = tc.stats.mean - refCtrl.stats.mean;
    const sdCtrl = Math.sqrt(tc.stats.sd ** 2 + refCtrl.stats.sd ** 2);
    for (const g of groups) {
      const isControl = g === ctrl;
      const tg = cell(g, target);
      const rg = cell(g, ref);
      if (!tg.stats.n || !rg.stats.n) {
        const which = !tg.stats.n ? target : ref;
        const c = !tg.stats.n ? tg : rg;
        // Named either way: a group that silently vanished from the result reads as "not in the experiment".
        if (!c.undetermined) skipped.push(`${g}, ${target}: the table has no ${which} Ct for ${g}, so ΔCt cannot be computed and ${g} is left out.`);
        else skipped.push(`${g}, ${target}: every ${which} replicate is Undetermined (no amplification), so ΔCt cannot be computed.`);
        continue;
      }
      const dCt = tg.stats.mean - rg.stats.mean;
      const dCtSD = Math.sqrt(tg.stats.sd ** 2 + rg.stats.sd ** 2);
      const ddCt = isControl ? 0 : dCt - dCtCtrl;
      let ddCtSD: number;
      if (mode === "both") ddCtSD = dCtSD;
      else ddCtSD = isControl ? 0 : Math.sqrt(dCtSD ** 2 + sdCtrl ** 2);
      const fold = Math.pow(2, -ddCt);
      const hasSD = Number.isFinite(ddCtSD);
      rows.push({
        group: g,
        target,
        targetCt: tg,
        refCt: rg,
        dCt,
        dCtSD,
        ddCt,
        ddCtSD,
        fold,
        foldLow: hasSD ? Math.pow(2, -(ddCt + ddCtSD)) : NaN,
        foldHigh: hasSD ? Math.pow(2, -(ddCt - ddCtSD)) : NaN,
        isControl,
      });
    }
  }
  if (!rows.some((r) => !r.isControl)) {
    return { ok: false, error: `No treated group could be computed. ${skipped.join(" ")}`.trim() };
  }
  if (rows.some((r) => !Number.isFinite(r.ddCtSD))) {
    notes.push("A gene with a single Ct replicate has no SD, so its fold change is shown without a range.");
  }
  const refShift: { group: string; shift: number }[] = [];
  for (const g of groups) {
    if (g === ctrl) continue;
    const rg = cell(g, ref);
    if (rg.stats.n) refShift.push({ group: g, shift: rg.stats.mean - refCtrl.stats.mean });
  }
  return { ok: true, reference: ref, control: ctrl, targets, groups, rows, skipped, refShift, notes };
}

// ------------------------------------------------------------------ Pfaffl

export interface DilutionPoint {
  /** Relative input amount (1, 0.1, 0.01…). */
  amount: number;
  cts: (number | null)[];
}

export interface EfficiencyFit {
  ok: true;
  slope: number;
  intercept: number;
  rsquared: number;
  /** Amplification factor per cycle, E = 10^(−1/slope) (2 = perfect doubling). */
  E: number;
  /** (E − 1)·100. */
  efficiencyPct: number;
  n: number;
  levels: number;
  undetermined: number;
  warnings: string[];
}

/** The window outside which an efficiency is refused, in percent. */
export const EFFICIENCY_WINDOW: [number, number] = [80, 120];
/** The narrower range commonly cited as acceptable; outside it a warning is shown. */
export const EFFICIENCY_GOOD: [number, number] = [90, 110];
/** R² below this is flagged. */
export const EFFICIENCY_R2_FLAG = 0.98;

/** "1:10" (= 0.1), "1/100" (= 0.01), "10^-2": the amount forms that are not plain numbers; null for anything else. */
function amountForm(raw: string): number | null {
  const t = raw.trim().replace(/−/g, "-");
  const ratio = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (ratio) return Number(ratio[1]) / Number(ratio[2]);
  const pow = /^10\s*\^\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (pow) return Math.pow(10, Number(pow[1]));
  return null;
}

/**
 * Lines "amount  Ct  Ct  Ct" (a header line is skipped) → dilution points.
 *
 * Release D: the numbers are read by dataBlock.readDataBlock (RULE N, the one number reader), so this reader gets
 * the shared separators (", " and bare commas separate; a space inside a tab or semicolon field is refused), the
 * mixed-decimal-mark refusal that names one example of each, and the comma rules with the Ct ≤ 60 evidence. Only
 * this reader's own tokens are peeled off first, through mapRow: the amount forms 1:10, 1/100 and 10^-2, the
 * Undetermined / No Ct calls (a Ct that did not cross threshold) and the "-" or empty cell (no reading). Before,
 * it split on its own and read each comma by commaReading alone: "1, 20.11" took line 1 as a header and refused
 * line 2 by its "0.1,", a "1 20.1" line in a tabbed block was silently dropped as a header, and 20,11 beside 20.05
 * was read without a word.
 */
export function readDilutionSeries(text: string, what: string, notes?: string[]): DilutionPoint[] | Refusal {
  const none: Refusal = { ok: false, error: `${what}: no dilution points.` };
  if (!(text ?? "").trim()) return none;
  /** Per line: the fields as typed, and what each peeled cell was. */
  const typed = new Map<number, string[]>();
  const peeled = new Map<number, Array<number | "undetermined" | "skip" | undefined>>();
  let first = true;
  const block = readDataBlock(text, what, {
    commaBounded: { fromColumn: 1, max: CT_MAX, why: `a Ct cannot exceed ${CT_MAX} cycles` },
    // The header is judged here, on the line as the user wrote it (mapRow), never on the peeled fields.
    noHeader: true,
    mapRow: (fields, line) => {
      const isFirst = first;
      first = false;
      // A header: a first row whose amount cell is a word ("Input", "Dilution"), whatever follows it.
      const a0 = fields[0] ?? "";
      if (isFirst && /\p{L}/u.test(a0) && amountForm(a0) === null && !Number.isFinite(parseCellNumber(a0))) return null;
      typed.set(line, fields.slice());
      const marks: Array<number | "undetermined" | "skip" | undefined> = [];
      const out = fields.map((f, k) => {
        const t = f.trim();
        if (k === 0) {
          const form = amountForm(t);
          if (form === null) return f;
          marks[0] = form;
          // A NUMERIC stand-in, not "-": the line is data as the user wrote it, so dataBlock's header rule (N4) must
          // not take "1:10  n.d." for a header and drop it (review D1). "1" carries no decimal mark, so it is no
          // evidence for N2/N3, and the value is never read (marks[0] wins).
          return "1";
        }
        if (NO_CELL.test(t)) marks[k] = "skip";
        else if (UNDETERMINED.test(t)) marks[k] = "undetermined";
        else return f;
        return "-";
      });
      peeled.set(line, marks);
      return out;
    },
  });
  const notAmount = (line: number, cell: string): Refusal => ({
    ok: false,
    error: `${what}, line ${line}: “${cell}” is not an input amount (write 1, 0.1, 0.01 or 1:10).`,
  });
  const notCt = (line: number, cell: string): Refusal => ({ ok: false, error: `${what}, line ${line}: “${cell}” is not a Ct.` });
  if (!block.ok) {
    if (block.error === `${what}: nothing to read.` || block.error === `${what}: only a header line.`) return none;
    // A word or an unreadable number where a number belongs: name the cell as an amount or a Ct, as before.
    const word = /^.*?: line (\d+) \(.*\) (?:mixes words and numbers \("(.*)"\)|has no numbers)/s.exec(block.error);
    const bad = word ? null : /^.*?: line (\d+): "(.*)" is not a number\.$/s.exec(block.error);
    const m = word ?? bad;
    if (m) {
      const line = Number(m[1]);
      const cells = typed.get(line) ?? [];
      const marks = peeled.get(line) ?? [];
      const k = m[2] !== undefined ? cells.indexOf(m[2]) : cells.findIndex((c, i) => marks[i] === undefined && c.trim() !== "");
      if (k === 0) return notAmount(line, cells[0]);
      if (k > 0) return notCt(line, cells[k]);
    }
    return { ok: false, error: block.error };
  }
  if (notes) notes.push(...block.notes);
  const out: DilutionPoint[] = [];
  for (let i = 0; i < block.rows.length; i++) {
    const line = block.lines[i];
    const row = block.rows[i];
    const cells = typed.get(line) ?? [];
    const marks = peeled.get(line) ?? [];
    const form = marks[0];
    const amount = typeof form === "number" ? form : row[0];
    if (amount === null || amount === undefined || !Number.isFinite(amount)) return notAmount(line, cells[0] ?? "");
    if (!(amount > 0)) return { ok: false, error: `${what}, line ${line}: an input amount must be positive (its log is taken).` };
    const cts: (number | null)[] = [];
    for (let k = 1; k < row.length; k++) {
      if (marks[k] === "skip") continue;
      if (marks[k] === "undetermined") {
        cts.push(null);
        continue;
      }
      const v = row[k];
      if (v === null || !Number.isFinite(v) || v <= 0) return notCt(line, cells[k] ?? "");
      cts.push(v);
    }
    if (!cts.length) return { ok: false, error: `${what}, line ${line}: no Ct after the amount.` };
    out.push({ amount, cts });
  }
  if (!out.length) return none;
  return out;
}

/**
 * PCR efficiency from a dilution series: Ct regressed on log10(input amount)
 * over every replicate, E = 10^(−1/slope) (Pfaffl 2001), efficiency % = (E − 1)·100.
 */
export function efficiencyFromDilution(series: DilutionPoint[], what: string): EfficiencyFit | Refusal {
  const x: number[] = [];
  const y: number[] = [];
  let undetermined = 0;
  for (const p of series) {
    for (const c of p.cts) {
      if (c === null) undetermined++;
      else {
        x.push(Math.log10(p.amount));
        y.push(c);
      }
    }
  }
  const levels = distinct(x).length;
  if (levels < 3) return { ok: false, error: `${what}: an efficiency needs at least 3 different dilutions with a Ct; ${levels} ${levels === 1 ? "was" : "were"} given.` };
  const lr = linearRegression(x, y);
  if (!(lr.slope < 0)) {
    return {
      ok: false,
      error:
        `${what}: Ct ${lr.slope === 0 ? "does not change" : "rises"} with the input amount (slope ${qNum(lr.slope, 3)} cycles per log₁₀ unit). ` +
        "Ct must FALL as template increases. If the first column holds dilution FACTORS (1, 10, 100), enter the relative " +
        "amounts instead (1, 0.1, 0.01, or 1:10, 1:100).",
    };
  }
  const E = Math.pow(10, -1 / lr.slope);
  const efficiencyPct = (E - 1) * 100;
  if (efficiencyPct < EFFICIENCY_WINDOW[0] || efficiencyPct > EFFICIENCY_WINDOW[1]) {
    return {
      ok: false,
      error:
        `${what}: efficiency ${qNum(efficiencyPct, 3)} % (E = ${qNum(E, 3)}, slope ${qNum(lr.slope, 4)}) is outside the ` +
        `${EFFICIENCY_WINDOW[0]}–${EFFICIENCY_WINDOW[1]} % window this tool accepts. ` +
        (efficiencyPct > EFFICIENCY_WINDOW[1]
          ? "An efficiency above 100 % usually means inhibition in the concentrated points, primer-dimers or pipetting error, not a better reaction."
          : "An efficiency this low means the assay is not doubling per cycle; redesign or optimise the primers.") +
        " No ratio is computed from it.",
    };
  }
  const warnings: string[] = [];
  if (efficiencyPct < EFFICIENCY_GOOD[0] || efficiencyPct > EFFICIENCY_GOOD[1]) {
    warnings.push(`${what}: efficiency ${qNum(efficiencyPct, 3)} % is outside the ${EFFICIENCY_GOOD[0]}–${EFFICIENCY_GOOD[1]} % range commonly cited as acceptable.`);
  }
  if (lr.rsquared < EFFICIENCY_R2_FLAG) {
    warnings.push(`${what}: R² = ${qNum(lr.rsquared, 4)} for the dilution series, below ${EFFICIENCY_R2_FLAG}; the efficiency is poorly determined.`);
  }
  if (undetermined) warnings.push(`${what}: ${undetermined} Undetermined replicate${undetermined === 1 ? "" : "s"} left out of the fit.`);
  return { ok: true, slope: lr.slope, intercept: lr.intercept, rsquared: lr.rsquared, E, efficiencyPct, n: x.length, levels, undetermined, warnings };
}

export interface PfafflRow {
  group: string;
  /** ΔCt(target) = mean Ct control − mean Ct group. */
  dCtTarget: number;
  dCtRef: number;
  ratio: number;
  isControl: boolean;
}

export interface PfafflResult {
  ok: true;
  target: string;
  reference: string;
  control: string;
  rows: PfafflRow[];
  skipped: string[];
  refShift: { group: string; shift: number }[];
}

/** Pfaffl (2001) ratio = E_target^ΔCt_target(control − sample) / E_ref^ΔCt_ref(control − sample). */
export function pfaffl(t: CtTable, target: string, reference: string, control: string, Etarget: number, Eref: number): PfafflResult | Refusal {
  const { groups, genes, cell } = tabulate(t);
  const ref = resolveName(genes, reference, "reference gene");
  if (typeof ref !== "string") return ref;
  const ctrl = resolveName(groups, control, "control group");
  if (typeof ctrl !== "string") return ctrl;
  let tgt: string;
  if (target.trim()) {
    const r = resolveName(genes, target, "target gene");
    if (typeof r !== "string") return r;
    tgt = r;
  } else {
    const others = genes.filter((g) => !sameName(g, ref));
    if (others.length !== 1) {
      return { ok: false, error: others.length ? `The table has ${others.length} target genes (${others.join(", ")}); name the one these efficiencies belong to.` : "The table has no target gene." };
    }
    tgt = others[0];
  }
  if (sameName(tgt, ref)) return { ok: false, error: "The target and reference gene are the same." };
  const tC = cell(ctrl, tgt);
  const rC = cell(ctrl, ref);
  if (!tC.stats.n || !rC.stats.n) return { ok: false, error: `The control group ${ctrl} has no ${!tC.stats.n ? tgt : ref} Ct (Undetermined or absent).` };
  const rows: PfafflRow[] = [];
  const skipped: string[] = [];
  const refShift: { group: string; shift: number }[] = [];
  for (const g of groups) {
    const tg = cell(g, tgt);
    const rg = cell(g, ref);
    if (!tg.stats.n || !rg.stats.n) {
      const c = !tg.stats.n ? tg : rg;
      const gene = !tg.stats.n ? tgt : ref;
      if (c.undetermined) skipped.push(`${g}: every ${gene} replicate is Undetermined (no amplification); no ratio.`);
      else skipped.push(`${g}: the table has no ${gene} Ct for ${g}, so no ratio is computed and ${g} is left out.`);
      continue;
    }
    const dT = tC.stats.mean - tg.stats.mean;
    const dR = rC.stats.mean - rg.stats.mean;
    rows.push({ group: g, dCtTarget: dT, dCtRef: dR, ratio: Math.pow(Etarget, dT) / Math.pow(Eref, dR), isControl: g === ctrl });
    if (g !== ctrl) refShift.push({ group: g, shift: rg.stats.mean - rC.stats.mean });
  }
  if (!rows.some((r) => !r.isControl)) return { ok: false, error: `No treated group could be computed. ${skipped.join(" ")}`.trim() };
  return { ok: true, target: tgt, reference: ref, control: ctrl, rows, skipped, refShift };
}
