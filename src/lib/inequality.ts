/**
 * Income inequality (Release E5a, calculator ineq-gini): Gini, the Lorenz curve, Theil T and L, Atkinson, the Palma
 * ratio and P90/P10, for individual incomes (weight 1 each) or a grouped table (a group's income or mean with its
 * count or population weight).
 *
 * Definitions (each one is the textbook form; the oracle scripts/econ-inequality-oracle.py implements them again
 * from the same formulas in exact fractions / mpmath):
 *  - Gini G = Σᵢ Σⱼ wᵢwⱼ|xᵢ − xⱼ| / (2W²μ): the mean absolute difference over twice the mean (Sen 1973, On Economic
 *    Inequality, eq. 2.8; Cowell 2011, Measuring Inequality, 3rd ed., Technical Appendix A.4). Optional small-sample
 *    correction G·n/(n − 1) for individual data only.
 *  - Lorenz curve: cumulative population share against cumulative income share, incomes ascending, joined by straight
 *    lines (equal incomes inside each observation or group). For individual data its area gives the same G.
 *  - Generalised entropy (Shorrocks 1980, Econometrica 48(3); Cowell 2011, A.5): GE(1) = Theil T =
 *    (1/W) Σ wᵢ (xᵢ/μ) ln(xᵢ/μ), with 0·ln 0 = 0; GE(0) = Theil L (mean log deviation) = (1/W) Σ wᵢ ln(μ/xᵢ)
 *    (Theil 1967, Economics and Information Theory).
 *  - Atkinson (1970, J. Econ. Theory 2, 244–263): A(ε) = 1 − [(1/W) Σ wᵢ (xᵢ/μ)^(1−ε)]^(1/(1−ε)) for ε ≠ 1 and
 *    A(1) = 1 − exp((1/W) Σ wᵢ ln xᵢ)/μ.
 *  - Quantiles: Hyndman & Fan (1996, Am. Stat. 50(4)) definition 1, the inverse of the (weighted) empirical
 *    distribution: Q(p) is the smallest income whose cumulative population share is at least p.
 *  - Palma ratio (Palma 2011, Development and Change 42(1); Cobham & Sumner 2013): the income share of the top 10%
 *    over that of the bottom 40%, both read off the Lorenz curve.
 *
 * Domain rules: the mean must be positive. Zero incomes are fine for Gini, Theil T and Atkinson ε < 1; Theil L and
 * Atkinson ε ≥ 1 need every income positive and are left out by name otherwise. A negative income leaves out every
 * measure but Gini (Theil T and the Atkinson family take logs or fractional powers of the income).
 */
import { ratAdd, ratMul, ratSub, ratDiv, ratFromNumber, ratToNumber, RAT_ZERO, type Rat } from "./cas";

export interface IneqInput {
  /** Incomes (or group means). */
  x: number[];
  /** Weights (1 for individual data, else counts / population weights), all > 0. */
  w: number[];
  grouped: boolean;
}

export interface AtkinsonValue {
  eps: number;
  /** undefined when the measure is not defined for these incomes (see `why`). */
  value?: number;
  why?: string;
}

export interface IneqResult {
  n: number;
  W: number;
  mean: number;
  gini: number;
  /** Exact Gini as a fraction when the inputs were short decimals and n is small enough to do it exactly. */
  giniExact?: Rat;
  giniCorrected?: number;
  theilT?: number;
  theilL?: number;
  theilTWhy?: string;
  theilLWhy?: string;
  atkinson: AtkinsonValue[];
  /** Lorenz points: cumulative population share p and income share L, both from 0 to 1. */
  lorenz: { p: number; L: number }[];
  p10: number;
  p90: number;
  bottom40: number;
  top10: number;
  zeros: number;
  negatives: number;
  min: number;
  max: number;
}

/** Above this many observations the Gini is not also computed in exact fractions (it is then the double result). */
export const GINI_EXACT_MAX = 2000;

/** Natural log of Σ exp(aᵢ), without overflow. */
function logSumExp(a: number[]): number {
  let m = -Infinity;
  for (const v of a) if (v > m) m = v;
  if (m === -Infinity) return -Infinity;
  let s = 0;
  for (const v of a) s += Math.exp(v - m);
  return m + Math.log(s);
}

/** Linear interpolation of the Lorenz curve at population share p. */
export function lorenzAt(points: { p: number; L: number }[], p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].p < p) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  // No absolute snap (one dropped a genuine share of 1e−13 and with it the Palma ratio). Residue is snapped to 0
  // RELATIVE to the values combined: at the Lorenz points when the curve is built, and here when the interpolation
  // between a negative and a positive point lands on a true 0 (−0.05 and 0.05 halfway gave ±1e−18).
  if (b.p === a.p) return b.L;
  const v = a.L + ((b.L - a.L) * (p - a.p)) / (b.p - a.p);
  return Math.abs(v) <= 8 * Number.EPSILON * (Math.abs(a.L) + Math.abs(b.L)) ? 0 : v;
}

/** Hyndman–Fan definition 1 on weighted data sorted ascending: the smallest x with cumulative weight ≥ p·W. */
function quantile1(x: number[], cum: number[], W: number, p: number): number {
  const target = p * W;
  const tol = 1e-12 * W;
  for (let i = 0; i < x.length; i++) if (cum[i] >= target - tol) return x[i];
  return x[x.length - 1];
}

export function atkinsonOf(xs: number[], ws: number[], W: number, mean: number, eps: number, zeros: number, negatives: number): AtkinsonValue {
  if (negatives > 0) return { eps, why: "a negative income has no real power or logarithm" };
  if (eps >= 1 && zeros > 0) return { eps, why: `ε ≥ 1 needs every income positive (${zeros} zero income${zeros === 1 ? "" : "s"})` };
  if (eps === 1) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += ws[i] * Math.log(xs[i] / mean);
    return { eps, value: -Math.expm1(s / W) };
  }
  const terms: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === 0) continue; // ε < 1: 0^(1−ε) = 0
    terms.push((1 - eps) * Math.log(xs[i] / mean) + Math.log(ws[i]));
  }
  const lnM = logSumExp(terms) - Math.log(W);
  return { eps, value: -Math.expm1(lnM / (1 - eps)) };
}

/**
 * All measures. The caller has already checked: n ≥ 1, finite x, w > 0, mean > 0. Sorting is done here.
 * `exactX`/`exactW` (optional) are the inputs as exact fractions, same order as x/w, for the exact Gini.
 */
export function inequality(inp: IneqInput, epsList: number[], exact?: { x: Rat[]; w: Rat[] }): IneqResult {
  const n = inp.x.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => inp.x[a] - inp.x[b]);
  const x = order.map((i) => inp.x[i]);
  const w = order.map((i) => inp.w[i]);
  let W = 0;
  let T = 0;
  let zeros = 0;
  let negatives = 0;
  for (let i = 0; i < n; i++) {
    W += w[i];
    T += w[i] * x[i];
    if (x[i] === 0) zeros++;
    if (x[i] < 0) negatives++;
  }
  const mean = T / W;
  // Gini from sorted cumulative weights: Σᵢⱼ wᵢwⱼ|xᵢ − xⱼ| = 2 Σₖ wₖxₖ(weight before k − weight after k).
  let before = 0;
  let D = 0;
  const cum: number[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const after = W - before - w[k];
    D += 2 * w[k] * x[k] * (before - after);
    before += w[k];
    cum[k] = before;
  }
  // Every term of D is ≥ 0 in exact arithmetic, so G ≥ 0: a negative value is rounding (constant incomes).
  const equal = x[0] === x[n - 1];
  let gini = equal ? 0 : Math.max(0, D / (2 * W * T));
  let giniExact: Rat | undefined;
  if (exact && n <= GINI_EXACT_MAX) {
    const ex = order.map((i) => exact.x[i]);
    const ew = order.map((i) => exact.w[i]);
    let EW: Rat = RAT_ZERO;
    let ET: Rat = RAT_ZERO;
    for (let i = 0; i < n; i++) {
      EW = ratAdd(EW, ew[i]);
      ET = ratAdd(ET, ratMul(ew[i], ex[i]));
    }
    let eb: Rat = RAT_ZERO;
    let ED: Rat = RAT_ZERO;
    for (let k = 0; k < n; k++) {
      const ea = ratSub(ratSub(EW, eb), ew[k]);
      ED = ratAdd(ED, ratMul(ratMul(ew[k], ex[k]), ratSub(eb, ea)));
      eb = ratAdd(eb, ew[k]);
    }
    // D = 2·ED; G = D/(2·W·T) = ED/(W·T).
    giniExact = ratDiv(ED, ratMul(EW, ET));
    // The exact path exists: the printed Gini is the exact value (constant incomes give exactly 0, not 2.3×10⁻¹⁷).
    gini = ratToNumber(giniExact);
  }
  const lorenz: { p: number; L: number }[] = [{ p: 0, L: 0 }];
  let s = 0;
  let sAbs = 0;
  for (let k = 0; k < n; k++) {
    s += w[k] * x[k];
    sAbs += Math.abs(w[k] * x[k]);
    // A running sum within rounding of 0 RELATIVE TO THE TERMS ADDED (negative incomes cancelling) is exactly 0.
    const zero = Math.abs(s) <= 4 * Number.EPSILON * (k + 1) * sAbs;
    lorenz.push({ p: cum[k] / W, L: zero ? 0 : s / T });
  }
  lorenz[lorenz.length - 1] = { p: 1, L: 1 };

  let theilT: number | undefined;
  let theilTWhy: string | undefined;
  let theilL: number | undefined;
  let theilLWhy: string | undefined;
  if (negatives > 0) {
    theilTWhy = "a negative income has no logarithm";
    theilLWhy = theilTWhy;
  } else {
    let t = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0) t += w[i] * (x[i] / mean) * Math.log(x[i] / mean);
    // Theil T, Theil L and the Atkinson indices are ≥ 0 (Jensen): constant incomes give exactly 0, and a
    // negative value is rounding, clamped to 0 (never printed as a negative inequality).
    theilT = equal ? 0 : Math.max(0, t / W);
    if (zeros > 0) theilLWhy = `it needs every income positive (${zeros} zero income${zeros === 1 ? "" : "s"})`;
    else {
      let l = 0;
      for (let i = 0; i < n; i++) l += w[i] * Math.log(mean / x[i]);
      theilL = equal ? 0 : Math.max(0, l / W);
    }
  }
  const atkinson = epsList.map((e) => {
    const a = atkinsonOf(x, w, W, mean, e, zeros, negatives);
    return a.value === undefined ? a : { ...a, value: equal ? 0 : Math.max(0, a.value) };
  });
  const L40 = lorenzAt(lorenz, 0.4);
  const L90 = lorenzAt(lorenz, 0.9);
  return {
    n,
    W,
    mean,
    gini,
    giniExact,
    giniCorrected: !inp.grouped && n >= 2 ? (gini * n) / (n - 1) : undefined,
    theilT,
    theilL,
    theilTWhy,
    theilLWhy,
    atkinson,
    lorenz,
    p10: quantile1(x, cum, W, 0.1),
    p90: quantile1(x, cum, W, 0.9),
    bottom40: L40,
    top10: 1 - L90,
    zeros,
    negatives,
    min: x[0],
    max: x[n - 1],
  };
}

/** The exact rational of a finite double's shortest decimal text, or undefined when it cannot be held. */
export function exactOf(v: number): Rat | undefined {
  if (!Number.isFinite(v)) return undefined;
  try {
    return ratFromNumber(v);
  } catch {
    return undefined;
  }
}

/** A short fraction ("3/20") when both parts have at most 6 digits, else undefined. */
export function shortFraction(r: Rat): string | undefined {
  const n = r.n < 0n ? -r.n : r.n;
  if (r.d === 1n || n > 999999n || r.d > 999999n) return undefined;
  return `${r.n < 0n ? "−" : ""}${n}/${r.d}`;
}

export { ratToNumber };

// ---------------------------------------------------------------------------------------------------------------
// The Lorenz figure: the curve, the equality line, the area between them shaded and labelled with G.

const FONT = "Segoe UI, Arial";
const INK = "#111111";
const GREY = "#6b7280";
const RULE = "#888888";
const FAINT = "#e5e7eb";
const BLUE = "#1d4ed8";
const SHADE = "#93c5fd";

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pctTick = (v: number): string => (v < 0 ? "−" : "") + String(Math.round(Math.abs(v)));

/** At most this many Lorenz vertices are drawn (the curve is convex: thinning keeps its shape). */
export const LORENZ_DRAW_MAX = 1200;

export function lorenzSvg(points: { p: number; L: number }[], giniText: string, grouped: boolean): string {
  const W = 400;
  const H = 330;
  const ML = 52;
  const MR = 14;
  const MT = 26;
  const MB = 78;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  let pts = points;
  if (pts.length > LORENZ_DRAW_MAX) {
    const step = Math.ceil(pts.length / LORENZ_DRAW_MAX);
    const thin: { p: number; L: number }[] = [];
    for (let i = 0; i < pts.length; i += step) thin.push(pts[i]);
    if (thin[thin.length - 1] !== pts[pts.length - 1]) thin.push(pts[pts.length - 1]);
    pts = thin;
  }
  let yLo = 0;
  for (const q of pts) if (q.L < yLo) yLo = q.L;
  // Negative incomes pull the curve below zero: the y axis goes down in steps of 20%.
  const yMin = yLo < 0 ? -Math.ceil((-yLo * 100) / 20) * 0.2 : 0;
  const X = (p: number): number => ML + p * pw;
  const Y = (L: number): number => MT + ph - ((L - yMin) / (1 - yMin)) * ph;
  const f = (v: number): string => v.toFixed(1);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text data-figure-title="1" x="${W / 2}" y="17" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${INK}">Lorenz curve</text>`,
  ];
  for (let t = 0; t <= 100; t += 20) {
    parts.push(`<line x1="${f(X(t / 100))}" y1="${MT}" x2="${f(X(t / 100))}" y2="${MT + ph}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(`<text x="${f(X(t / 100))}" y="${MT + ph + 14}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${GREY}">${t}</text>`);
  }
  for (let t = Math.round(yMin * 100); t <= 100; t += 20) {
    parts.push(`<line x1="${ML}" y1="${f(Y(t / 100))}" x2="${ML + pw}" y2="${f(Y(t / 100))}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(`<text x="${ML - 6}" y="${f(Y(t / 100) + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${GREY}">${pctTick(t)}</text>`);
  }
  parts.push(`<rect x="${ML}" y="${MT}" width="${pw}" height="${ph}" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  // Shaded area between the equality line and the curve (traced along the curve, back along the diagonal).
  const curve = pts.map((q) => `${f(X(q.p))},${f(Y(q.L))}`).join(" ");
  parts.push(`<polygon points="${curve} ${f(X(1))},${f(Y(1))} ${f(X(0))},${f(Y(0))}" fill="${SHADE}" fill-opacity="0.55" stroke="none"/>`);
  parts.push(`<line x1="${f(X(0))}" y1="${f(Y(0))}" x2="${f(X(1))}" y2="${f(Y(1))}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  parts.push(`<polyline points="${curve}" fill="none" stroke="${BLUE}" stroke-width="2"/>`);
  parts.push(`<text x="${ML + pw / 2}" y="${MT + ph + 30}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}">${esc(grouped ? "Cumulative share of population, poorest group first (%)" : "Cumulative share of population, poorest first (%)")}</text>`);
  parts.push(`<text x="13" y="${MT + ph / 2}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}" transform="rotate(-90 13 ${MT + ph / 2})">Cumulative share of income (%)</text>`);
  // Legend under the frame.
  const ly0 = MT + ph + 48;
  parts.push(`<line x1="${ML}" y1="${ly0}" x2="${ML + 22}" y2="${ly0}" stroke="${BLUE}" stroke-width="2"/>`);
  parts.push(`<text x="${ML + 27}" y="${ly0 + 3.5}" font-family="${FONT}" font-size="10" fill="${INK}">Lorenz curve</text>`);
  parts.push(`<line x1="${ML + 110}" y1="${ly0}" x2="${ML + 132}" y2="${ly0}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  parts.push(`<text x="${ML + 137}" y="${ly0 + 3.5}" font-family="${FONT}" font-size="10" fill="${INK}">Line of equality</text>`);
  const ly1 = ly0 + 17;
  parts.push(`<rect x="${ML + 3}" y="${ly1 - 5}" width="16" height="10" fill="${SHADE}" fill-opacity="0.55"/>`);
  parts.push(`<text x="${ML + 27}" y="${ly1 + 3.5}" font-family="${FONT}" font-size="10" fill="${INK}">${esc(`Area between the line and the curve = G/2 (G = ${giniText})`)}</text>`);
  parts.push("</svg>");
  return parts.join("");
}
