// The shared axis and tick engine (docs/SCOPE-JOURNAL-FIGURES-2026-10.md, C.1).
//
// WHY ONE ENGINE. Before this file there were three tick algorithms (plot.ts,
// mechchart.ts, audio.ts) and every one of them formatted a label from the
// VALUE rather than from the STEP. The measured result (brief, Part B):
//   - B.1  an x axis on 20000–20050 read `2.0e+4` twelve times;
//   - B.2  e-notation on 97 labels in 22 figures;
//   - B.3  hyphen-minus instead of U+2212 on negatives;
//   - B.4  `0, 200.0, 400.0` and `0, 0.2 … 1` in one row;
//   - B.6  a step of 4 from doubling a half-space 2;
//   - B.7  `1000, 10⁴` — two notations on one log axis.
//
// THE CORE IDEA. A tick row is held as INTEGERS times one power of ten:
// value_i = ints[i] × 10^exp. Every label is then produced from its integer by
// string arithmetic, so
//   - two different ticks can never print the same label (distinct integers
//     give distinct strings), which is B.1 made impossible rather than unlikely;
//   - every label in a row has the same number of decimals, by construction;
//   - there is no float garbage (0.30000000000000004) to round away.
//
// TICK CHOICE is Talbot, Lin & Hanrahan's extended Wilkinson algorithm:
//   J. Talbot, S. Lin, P. Hanrahan, "An Extension of Wilkinson's Algorithm for
//   Positioning Tick Labels on Axes", IEEE TVCG 16(6):1036–1043, 2010
//   (InfoVis 2010).
// ported from the authors' own R reference implementation, `labeling::extended`
// (CRAN package `labeling`, R/labeling.R, fetched 2026-10-14 from
// https://raw.githubusercontent.com/cran/labeling/master/R/labeling.R).
// Q = [1, 5, 2, 2.5, 4, 3], w = [0.25, 0.2, 0.5, 0.05], legibility ≡ 1 — exactly
// the R defaults; the R file's comment says the legibility tests were done in
// the C# version only. The published reference case from that package's docs
// is `extended(8.1, 14.1, 4) = 8 10 12 14` (and `heckbert(8.1, 14.1, 4) =
// 5 10 15` for the classic 1/2/5 method kept here as the fallback).
//
// The port differs from the R code in two deliberate ways, neither of which
// changes a result on ordinary ranges:
//   1. The search runs on the range NORMALISED by its leading power of ten, and
//      the result is carried as integers. Extended Wilkinson is invariant under
//      scaling by powers of ten, and normalising is what keeps 1e-300 and 1e300
//      ranges finite (R itself bails out to `seq()` above sqrt(double.xmax)).
//   2. Every loop has a hard iteration cap. The algorithm terminates by pruning,
//      but a pruning bound that depends on float scores is not a bound, and in a
//      task pane a loop that does not terminate is a frozen Word.
//
// LABELS (journal style, and the product's display contract):
//   - the minus is U+2212, never hyphen-minus; zero is never signed;
//   - no `e+`/`e-` ever: large or small rows carry a shared ×10ⁿ multiplier,
//     which the builder draws once (on the axis title), or, when the step is fine
//     relative to the magnitude (20 000, 20 010 …), the digits are kept and
//     grouped in threes with a thin space (U+2009), as SI recommends;
//   - log axes spanning ≥ 3 decades are labelled 10ⁿ throughout, 10⁰ included.
//
// Characters outside ASCII are built with String.fromCharCode, never typed as
// escapes: this repo has shipped source whose escapes were eaten on the way in.

/** U+2212 MINUS SIGN. */
export const MINUS = String.fromCharCode(0x2212);
/** U+2009 THIN SPACE, the SI digit-group separator. */
export const THIN_SPACE = String.fromCharCode(0x2009);

/**
 * A tick label with comma grouping, for a money axis whose text and tables print commas (the damages figures): the
 * thin-space groups become commas, and a four-digit value, which the SI style leaves ungrouped, gets one (1,250).
 */
export function commaGroupLabel(label: string): string {
  return label.split(THIN_SPACE).join(",").replace(/^([−-]?)(\d)(\d{3})(?=$|\.)/, "$1$2,$3");
}
/** U+00D7 MULTIPLICATION SIGN. */
const TIMES = String.fromCharCode(0xd7);

/** The most ticks any axis may carry. Six or seven is the design. */
export const AXIS_TICK_CAP = 200;

const SUP_DIGITS = [0x2070, 0xb9, 0xb2, 0xb3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079].map((c) =>
  String.fromCharCode(c),
);
const SUP_MINUS = String.fromCharCode(0x207b);

/** An integer exponent in superscript digits: −3 → ⁻³. */
export function superscript(n: number): string {
  const s = String(Math.trunc(n));
  let out = "";
  for (const ch of s) out += ch === "-" ? SUP_MINUS : SUP_DIGITS[Number(ch)] ?? "";
  return out;
}

/** "×10ⁿ". */
export function timesTen(n: number): string {
  return `${TIMES}10${superscript(n)}`;
}

/** Leading hyphen-minus → U+2212; "-0"/"−0" style zeros → "0". */
export function trueMinus(s: string): string {
  return s.replace(/^-/, MINUS);
}

// ---------------------------------------------------------------------------
// Powers of ten that survive the ends of the double range.

/** x × 10^n, applied in chunks so 10^n never overflows or underflows on its own. */
export function scale10(x: number, n: number): number {
  // Non-finite exponents are their limits, never a loop: `while (k < -300) k += 300`
  // ran forever at k = −∞ (linearAxis at ±1.7e308, v2.143.0 second review).
  if (Number.isNaN(x) || Number.isNaN(n)) return NaN;
  if (n === Infinity) return x === 0 ? NaN : x * Infinity;
  if (n === -Infinity) return Number.isFinite(x) ? x * 0 : NaN;
  let v = x;
  // Any finite double times 10^±700 has already saturated to ±∞ or ±0, so the
  // clamp changes no finite result and bounds each loop below to three turns.
  let k = Math.max(-700, Math.min(700, Math.trunc(n)));
  while (k > 300) {
    v *= 1e300;
    k -= 300;
  }
  while (k < -300) {
    v /= 1e300;
    k += 300;
  }
  // Division by an exact power of ten is correctly rounded; multiplication by
  // 10^-k is not (3 × 0.1 = 0.30000000000000004), so negative powers divide.
  return k >= 0 ? v * Math.pow(10, k) : v / Math.pow(10, -k);
}

// ---------------------------------------------------------------------------
// Extended Wilkinson (Talbot, Lin & Hanrahan 2010), the R reference semantics.

export const WILKINSON_Q = [1, 5, 2, 2.5, 4, 3];
export const WILKINSON_W = [0.25, 0.2, 0.5, 0.05];

/** The best labelling found: lmin + i·lstep for i = 0 … k−1. */
export interface WilkinsonResult {
  lmin: number;
  lmax: number;
  lstep: number;
  score: number;
  /** The integer form: tick i = (start + i·j) × q10 × 10^(z−1). */
  start: number;
  j: number;
  q10: number;
  z: number;
  k: number;
}

const R_EPS = 2.220446049250313e-16 * 100;

function simplicity(qi: number, n: number, j: number, lmin: number, lmax: number, startDivisible: boolean): number {
  const v = startDivisible && lmin <= 0 && lmax >= 0 ? 1 : 0;
  return 1 - qi / (n - 1) - j + v;
}
function simplicityMax(qi: number, n: number, j: number): number {
  return 1 - qi / (n - 1) - j + 1;
}
function coverage(dmin: number, dmax: number, lmin: number, lmax: number): number {
  const range = dmax - dmin;
  return 1 - (0.5 * ((dmax - lmax) ** 2 + (dmin - lmin) ** 2)) / (0.1 * range) ** 2;
}
function coverageMax(dmin: number, dmax: number, span: number): number {
  const range = dmax - dmin;
  if (span > range) {
    const half = (span - range) / 2;
    return 1 - (0.5 * (half * half + half * half)) / (0.1 * range) ** 2;
  }
  return 1;
}
function density(k: number, m: number, dmin: number, dmax: number, lmin: number, lmax: number): number {
  const r = (k - 1) / (lmax - lmin);
  const rt = (m - 1) / (Math.max(lmax, dmax) - Math.min(dmin, lmin));
  return 2 - Math.max(r / rt, rt / r);
}
function densityMax(k: number, m: number): number {
  return k >= m ? 2 - (k - 1) / (m - 1) : 1;
}

/**
 * The extended-Wilkinson search over [dmin, dmax] for about m labels.
 * Returns null on a degenerate or non-finite range (the caller falls back).
 */
export function extendedWilkinson(
  dmin: number,
  dmax: number,
  m: number,
  onlyLoose = false,
  Q: number[] = WILKINSON_Q,
  w: number[] = WILKINSON_W,
): WilkinsonResult | null {
  if (!Number.isFinite(dmin) || !Number.isFinite(dmax) || !Number.isFinite(m)) return null;
  if (dmin > dmax) [dmin, dmax] = [dmax, dmin];
  const range = dmax - dmin;
  if (!(range >= R_EPS) || !Number.isFinite(range)) return null;
  m = Math.max(2, Math.min(50, Math.round(m)));
  const n = Q.length;
  let best: WilkinsonResult | null = null;
  let bestScore = -2;

  // Hard caps. The R loops end by pruning; these end them regardless.
  const J_CAP = 40;
  const K_CAP = 60;
  const Z_CAP = 40;
  const START_CAP = 2000;

  let stopJ = false;
  for (let j = 1; j <= J_CAP && !stopJ; j++) {
    for (let qi = 0; qi < n; qi++) {
      const q = Q[qi];
      const sm = simplicityMax(qi, n, j);
      if (w[0] * sm + w[1] + w[2] + w[3] < bestScore) {
        stopJ = true;
        break;
      }
      for (let k = 2; k <= K_CAP; k++) {
        const dm = densityMax(k, m);
        if (w[0] * sm + w[1] + w[2] * dm + w[3] < bestScore) break;
        const delta = range / (k + 1) / j / q;
        let z = Math.ceil(Math.log10(delta));
        if (!Number.isFinite(z)) break;
        for (let zi = 0; zi < Z_CAP; zi++, z++) {
          const step = j * q * Math.pow(10, z);
          if (!Number.isFinite(step) || step <= 0) break;
          const cm = coverageMax(dmin, dmax, step * (k - 1));
          if (w[0] * sm + w[1] * cm + w[2] * dm + w[3] < bestScore) break;
          const minStart = Math.floor(dmax / step) * j - (k - 1) * j;
          const maxStart = Math.ceil(dmin / step) * j;
          if (minStart > maxStart) continue;
          if (maxStart - minStart > START_CAP) continue;
          for (let si = 0; si <= maxStart - minStart; si++) {
            const start = minStart + si;
            const lmin = start * (step / j);
            const lmax = lmin + step * (k - 1);
            const s = simplicity(qi, n, j, lmin, lmax, start % j === 0);
            const c = coverage(dmin, dmax, lmin, lmax);
            const g = density(k, m, dmin, dmax, lmin, lmax);
            const score = w[0] * s + w[1] * c + w[2] * g + w[3] * 1;
            if (!Number.isFinite(score)) continue;
            if (score > bestScore && (!onlyLoose || (lmin <= dmin && lmax >= dmax))) {
              bestScore = score;
              best = { lmin, lmax, lstep: step, score, start, j, q10: Math.round(q * 10), z, k };
            }
          }
        }
      }
    }
  }
  return best;
}

/** The labels extended Wilkinson picks, as R's `seq(lmin, lmax, by = lstep)`. */
export function extendedTicks(dmin: number, dmax: number, m: number, onlyLoose = false): number[] {
  const r = extendedWilkinson(dmin, dmax, m, onlyLoose);
  if (!r) return [];
  const out: number[] = [];
  for (let i = 0; i < r.k; i++) out.push(intTickValue((r.start + i * r.j) * r.q10, r.z - 1));
  return out;
}

/**
 * Heckbert's "nice numbers" loose labelling (Graphics Gems, 1990): the 1/2/5
 * method, kept as the documented fallback. Returns [lo, hi, step] as integers
 * times 10^exp so it formats like everything else.
 */
export function heckbert(dmin: number, dmax: number, m: number): { n0: number; n1: number; unit: number; exp: number } | null {
  if (!Number.isFinite(dmin) || !Number.isFinite(dmax) || !(dmax > dmin)) return null;
  const nice = (x: number, round: boolean): { f: number; e: number } => {
    const e = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, e);
    let nf: number;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return { f: nf, e };
  };
  const r = nice(dmax - dmin, false);
  const rangeNice = r.f * Math.pow(10, r.e);
  const d = nice(rangeNice / Math.max(1, m - 1), true);
  if (!Number.isFinite(d.e)) return null;
  const unit = d.f; // 1, 2, 5 or 10
  const step = unit * Math.pow(10, d.e);
  if (!(step > 0) || !Number.isFinite(step)) return null;
  return { n0: Math.floor(dmin / step), n1: Math.ceil(dmax / step), unit, exp: d.e };
}

/** ints × 10^exp as a double. */
function intTickValue(int: number, exp: number): number {
  return scale10(int, exp);
}

// ---------------------------------------------------------------------------
// Formatting a row of ticks held as integers × 10^exp.

export interface FormattedRow {
  labels: string[];
  /** "" or "×10ⁿ" — drawn ONCE per axis by the builder (axis title or axis end). */
  multiplier: string;
  /** The n in the multiplier, 0 when there is none. */
  exponent: number;
  /** Decimals carried by every label in the row. */
  decimals: number;
  /** Must never be true: two ticks with the same text is an engine error. */
  duplicate: boolean;
}

function groupThousands(intPart: string): string {
  if (intPart.length < 4) return intPart;
  let out = "";
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) out += THIN_SPACE;
    out += intPart[i];
  }
  return out;
}

/** |int| × 10^e as a decimal string with exactly max(0, −e) decimals. */
function digitsAt(absInt: number, e: number, group: boolean): string {
  let digits = String(absInt);
  let intPart: string;
  let frac = "";
  if (e >= 0) {
    intPart = absInt === 0 ? "0" : digits + "0".repeat(e);
  } else {
    const d = -e;
    if (digits.length <= d) digits = "0".repeat(d - digits.length + 1) + digits;
    intPart = digits.slice(0, digits.length - d);
    frac = digits.slice(digits.length - d);
  }
  if (group) intPart = groupThousands(intPart);
  return frac ? `${intPart}.${frac}` : intPart;
}

/**
 * Labels for value_i = ints[i] × 10^exp. ints must be safe integers.
 *
 * Mode, from the leading power P of the largest |value|:
 *   −3 ≤ P ≤ 5   plain digits; grouped with thin spaces when P ≥ 4;
 *   P ≥ 6        ×10^P multiplier — unless the step is fine against the
 *                magnitude (more than three mantissa decimals), where the plain
 *                grouped digits read better (1 000 000, 1 000 010 …) and P < 15;
 *   P ≤ −4       ×10^P multiplier.
 */
export function formatIntRow(ints: number[], exp: number): FormattedRow {
  const xs = ints.map((v) => (Object.is(v, -0) ? 0 : v));
  let e = exp;
  // Strip trailing zeros common to the whole row: 0, 50, 100 × 10⁻¹ → 0, 5, 10.
  if (xs.some((v) => v !== 0)) {
    for (let guard = 0; guard < 400 && xs.every((v) => v % 10 === 0); guard++) {
      for (let i = 0; i < xs.length; i++) xs[i] = xs[i] / 10;
      e++;
    }
  }
  const maxAbs = xs.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  const P = maxAbs > 0 ? String(maxAbs).length - 1 + e : 0;
  let n = 0;
  let group = false;
  if (maxAbs > 0) {
    if (P >= 6) {
      const md = P - e;
      if (md > 3 && P < 15) group = true;
      else n = P;
    } else if (P <= -4) {
      n = P;
    } else if (P >= 4) {
      group = true;
    }
  }
  const eff = e - n;
  const decimals = Math.max(0, -eff);
  const labels = xs.map((v) => {
    const body = digitsAt(Math.abs(v), eff, group);
    return v < 0 ? MINUS + body : body;
  });
  return {
    labels,
    multiplier: n === 0 ? "" : timesTen(n),
    exponent: n,
    decimals,
    duplicate: new Set(labels).size !== labels.length,
  };
}

/** Decompose a positive step into S × 10^e with S a small integer (≤ 12 significant digits). */
function decimalParts(x: number): { S: number; e: number } | null {
  if (!Number.isFinite(x) || x <= 0) return null;
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential(11));
  if (!m) return null;
  let digits = (m[1] + (m[2] ?? "")).replace(/0+$/, "");
  if (!digits) digits = "0";
  const e = Number(m[3]) - (digits.length - 1);
  return { S: Number(digits), e };
}

// ---------------------------------------------------------------------------
// A linear axis.

export interface LinearAxisOptions {
  /** Desired label count (the density target m). Default 5. */
  target?: number;
  /** Round the domain OUT to the first and last tick (loose labelling). */
  loose?: boolean;
  /** A user-set step. Ignored if it would give more than AXIS_TICK_CAP ticks. */
  step?: number;
}

export interface AxisRow extends FormattedRow {
  /** Tick positions in data units, ascending, all finite and inside [lo, hi]. */
  values: number[];
  /** The domain the ticks were placed in: the input, or rounded out when loose. */
  lo: number;
  hi: number;
  /** The tick step in data units. */
  step: number;
  /** Which method chose the ticks. */
  method: "wilkinson" | "heckbert" | "user" | "degenerate";
}

function emptyRow(lo: number, hi: number): AxisRow {
  return { values: [], labels: [], multiplier: "", exponent: 0, decimals: 0, duplicate: false, lo, hi, step: 0, method: "degenerate" };
}

/**
 * Ticks and labels for one linear axis over [lo, hi].
 *
 * Bounded on everything: Inf/NaN ends, 1e308 magnitudes and a zero span all
 * return a finite, capped row. A non-loose axis never places a tick outside
 * [lo, hi]; a loose one rounds the domain out to its end ticks (when that stays
 * finite — at ±1.7e308 it cannot, and the input domain is kept).
 */
export function linearAxis(lo: number, hi: number, opts: LinearAxisOptions = {}): AxisRow {
  const first = linearAxisOnce(lo, hi, opts);
  // A fixed domain keeps only the ticks INSIDE it, and Wilkinson scores a
  // labelling that may run past the data (0.08–2.91 at m = 5 picks 0 … 3 and
  // keeps only 1, 2). Two labels do not make a readable axis: ask for a denser
  // labelling, a bounded number of times, until at least three fall inside.
  if (opts.loose || opts.step !== undefined || first.method === "degenerate" || first.values.length >= 3) return first;
  const m = targetOf(opts);
  for (const extra of [2, 4]) {
    const r = linearAxisOnce(lo, hi, { ...opts, target: m + extra });
    if (r.values.length >= 3) return r;
  }
  return first;
}

/**
 * A linear axis whose ticks must be INTEGERS (a count k, a base-pair
 * coordinate): the linearAxis row when every tick is already whole, else the
 * same domain at the smallest 1/2/5 × 10ⁿ step that is a whole number and no
 * finer than the row's own — so 0–6 never reads 0, 2.5, 5.
 */
export function integerAxis(lo: number, hi: number, opts: Omit<LinearAxisOptions, "step"> = {}): AxisRow {
  const row = linearAxis(lo, hi, opts);
  if (row.values.every((v) => Number.isInteger(v))) return row;
  const want = Math.max(1, row.step);
  let step = 1;
  for (let guard = 0; guard < 40 && step < want; guard++) {
    const d = Math.pow(10, Math.floor(guard / 3));
    step = [1, 2, 5][guard % 3] * d;
  }
  if (step < want) return row;
  const r = linearAxis(lo, hi, { ...opts, step });
  return r.method === "user" ? r : row;
}

/** The density target, or the default 5 when it is absent or not a finite number (NaN gave zero ticks). */
function targetOf(opts: LinearAxisOptions): number {
  return typeof opts.target === "number" && Number.isFinite(opts.target) ? opts.target : 5;
}

/**
 * Half-spans at or below this many units in the last place of the magnitude are
 * a zero span. Was mag × 1e-12 — about 10⁴ times too coarse: 1e15 … 1e15 + 100
 * (or a plot's x from 4.5e14 to 4.5e14 + 500) collapsed to ONE label though the
 * doubles resolve it into many distinct ticks (v2.143.0 adversarial review).
 */
const ZERO_SPAN_ULPS = 4;

function linearAxisOnce(lo: number, hi: number, opts: LinearAxisOptions): AxisRow {
  const r = linearAxisCore(lo, hi, opts, false);
  if (r.method === "degenerate" || r.method === "user" || (r.values.length > 0 && !r.duplicate)) return r;
  // Spans between a few ULPs and the old 1e-12 cutoff can still defeat the
  // integer lattice (ticks past 2^53, or none inside the domain). There — and
  // only there, so every other range is untouched — fall back to the zero-span
  // row the old cutoff gave, rather than draw an empty or duplicated axis.
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const mag = Math.max(Math.abs(a), Math.abs(b));
  if (!(Number.isFinite(a) && Number.isFinite(b) && b / 2 - a / 2 <= mag * 1e-12)) return r;
  const z = linearAxisCore(lo, hi, opts, true);
  return z.values.length ? z : r;
}

function linearAxisCore(lo: number, hi: number, opts: LinearAxisOptions, forceZero: boolean): AxisRow {
  const m = targetOf(opts);
  let a = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : 0;
  let b = Number.isFinite(hi) ? hi : a;
  if (a > b) [a, b] = [b, a];
  const mag = Math.max(Math.abs(a), Math.abs(b));
  // A span the doubles cannot resolve into distinct labels is a zero span.
  const halfSpan = b / 2 - a / 2;
  const zeroSpan = forceZero || !(b > a) || (mag > 0 && halfSpan <= mag * Number.EPSILON * ZERO_SPAN_ULPS);
  if (zeroSpan) {
    if (!opts.loose) {
      // The caller fixed the domain; one honest tick at its centre.
      const c = a / 2 + b / 2;
      return { ...emptyRow(a, b), values: [c], labels: [fmtValue(c)], step: 0, method: "degenerate" };
    }
    // A REAL (if unresolvably small) span is padded relative to what the doubles
    // can resolve at this magnitude, not by 10% of the magnitude — that padding
    // flattened the data into a sliver. Only an exactly constant row keeps ±10%.
    const pad = !(b > a) ? (mag > 0 ? mag * 0.1 : 1) : forceZero ? Math.max(b - a, mag * 1e-12) : mag * Number.EPSILON * ZERO_SPAN_ULPS * 8;
    a = a - pad;
    b = b + pad;
    // At ±1.7e308 the pad overflows. Clamp the overflowing END to the largest
    // double (as statchart.axisRange does): halving both ends, as this used to,
    // left an infinite end infinite (and then scale10(x, −∞) never returned) and
    // moved the finite end so the band no longer held the data.
    if (!Number.isFinite(a)) a = -Number.MAX_VALUE;
    if (!Number.isFinite(b)) b = Number.MAX_VALUE;
  }

  // User step first.
  if (opts.step !== undefined) {
    const user = userStepRow(a, b, opts.step);
    if (user) return user;
  }

  // Normalise by the leading power of ten so the search sees numbers near 1.
  const M = Math.max(Math.abs(a), Math.abs(b));
  const E = M > 0 ? Math.floor(Math.log10(M)) : 0;
  const dl = scale10(a, -E);
  const dh = scale10(b, -E);

  const wr = extendedWilkinson(dl, dh, m, !!opts.loose);
  if (wr) {
    // Ticks sit on a lattice t × q10 × 10^(z−1), at every t ≡ start (mod j).
    // Tick k is t = k·j + offset; its integer is t·q10, its power 10^(z−1+E).
    const { j, q10 } = wr;
    const offset = ((wr.start % j) + j) % j;
    const L = q10 * Math.pow(10, wr.z - 1);
    let k0: number;
    let k1: number;
    if (opts.loose) {
      k0 = (wr.start - offset) / j;
      k1 = k0 + wr.k - 1;
    } else {
      const tmin = Math.ceil(dl / L - 1e-9);
      const tmax = Math.floor(dh / L + 1e-9);
      k0 = Math.ceil((tmin - offset) / j);
      k1 = Math.floor((tmax - offset) / j);
    }
    return buildRow(k0, k1, (k) => (k * j + offset) * q10, wr.z - 1 + E, a, b, !!opts.loose, "wilkinson", q10 * j);
  }
  // Fallback: Heckbert 1/2/5.
  const hk = heckbert(dl, dh, m);
  if (!hk) return emptyRow(a, b);
  let n0 = hk.n0;
  let n1 = hk.n1;
  if (!opts.loose) {
    const st = hk.unit * Math.pow(10, hk.exp);
    n0 = Math.ceil(dl / st - 1e-9);
    n1 = Math.floor(dh / st + 1e-9);
  }
  return buildRow(n0, n1, (k) => k * hk.unit, hk.exp + E, a, b, !!opts.loose, "heckbert", hk.unit);
}

function buildRow(
  n0: number,
  n1: number,
  intOf: (k: number) => number,
  exp: number,
  a: number,
  b: number,
  loose: boolean,
  method: AxisRow["method"],
  stepUnits: number,
): AxisRow {
  const ints: number[] = [];
  const values: number[] = [];
  if (Number.isFinite(n0) && Number.isFinite(n1)) {
    for (let k = n0, c = 0; k <= n1 && c < AXIS_TICK_CAP; k++, c++) {
      const int = intOf(k);
      if (!Number.isSafeInteger(int)) continue;
      const v = intTickValue(int, exp);
      if (!Number.isFinite(v)) continue;
      ints.push(int);
      values.push(v === 0 ? 0 : v);
    }
  }
  let lo = a;
  let hi = b;
  if (loose && values.length >= 2) {
    lo = Math.min(a, values[0]);
    hi = Math.max(b, values[values.length - 1]);
  }
  // A non-loose row never escapes the domain, whatever float rounding did.
  const keep = values.map((v) => loose || (v >= lo - Math.abs(hi - lo) * 1e-9 && v <= hi + Math.abs(hi - lo) * 1e-9));
  const fi = ints.filter((_, i) => keep[i]);
  const fv = values.filter((_, i) => keep[i]).map((v) => Math.min(Math.max(v, loose ? v : lo), loose ? v : hi));
  const f = formatIntRow(fi, exp);
  return { ...f, values: fv, lo, hi, step: intTickValue(stepUnits, exp), method };
}

function userStepRow(a: number, b: number, step: number): AxisRow | null {
  const parts = decimalParts(step);
  if (!parts) return null;
  const count = (b - a) / step;
  if (!Number.isFinite(count) || Math.floor(count + 1e-9) + 1 > AXIS_TICK_CAP) return null; // ticks = intervals + 1
  const n0 = Math.ceil(a / step - 1e-9);
  const n1 = Math.floor(b / step + 1e-9);
  if (!Number.isSafeInteger(n0 * parts.S) || !Number.isSafeInteger(n1 * parts.S)) return null;
  return buildRow(n0, n1, (k) => k * parts.S, parts.e, a, b, false, "user", parts.S);
}

// ---------------------------------------------------------------------------
// Per-value formatting (for prose, value annotations and legacy callers).

/**
 * One number, alone, for text that is not a tick row: plain up to 6 integer
 * digits (grouped with thin spaces from 5), three decimals at most, ×10ⁿ beyond,
 * U+2212 for negatives. Never e-notation, never "−0".
 *
 * A ROW of ticks must not be formatted with this: it cannot hold the decimals
 * constant. Use linearAxis / formatIntRow.
 */
export function fmtValue(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : MINUS + "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) {
    const r = Math.round(a * 1000) / 1000;
    if (r === 0) return "0";
    if (r >= 1e6) return sci(v, 3);
    const [ip, fp] = String(r).split(".");
    const body = (r >= 1e4 ? groupThousands(ip) : ip) + (fp ? `.${fp}` : "");
    return v < 0 ? MINUS + body : body;
  }
  return sci(v, 3);
}

/** m×10ⁿ with up to `sig` significant figures, trailing zeros dropped. */
function sci(v: number, sig: number): string {
  const m = /^(-?)(\d(?:\.\d+)?)e([+-]\d+)$/.exec(v.toExponential(Math.max(0, sig - 1)));
  if (!m) return String(v);
  let mant = m[2];
  if (mant.includes(".")) mant = mant.replace(/0+$/, "").replace(/\.$/, "");
  return `${m[1] ? MINUS : ""}${mant}${timesTen(Number(m[3]))}`;
}

/**
 * `sig` significant figures, KEEPING trailing zeros (a measured value: 4.00 kN).
 * Plain from 10⁻³ up to (not including) 10^plainMaxExp, else m×10ⁿ.
 */
export function fmtSig(v: number, sig: number, plainMaxExp = 5): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : MINUS + "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < Math.pow(10, plainMaxExp)) {
    // toPrecision keeps the trailing zeros the doc promises (4 → "4.00"); it
    // switches to e-notation when the integer part needs more digits than `sig`
    // (12345 at 3 → "1.23e+4"), where the plain rounded integer is the answer.
    const p = a.toPrecision(Math.max(1, Math.min(100, Math.round(sig) || 1)));
    const s = /e/i.test(p) ? String(Number(p)) : p;
    return v < 0 ? MINUS + s : s;
  }
  const m = /^(\d(?:\.\d+)?)e([+-]\d+)$/.exec(a.toExponential(Math.max(0, sig - 1)));
  if (!m) return String(v);
  return `${v < 0 ? MINUS : ""}${m[1]}${timesTen(Number(m[2]))}`;
}

/**
 * Values that are not ticks but share a row (a colour-bar's min / mid / max,
 * a ladder's end labels): one decimals count for the whole row, enough for
 * `sig` significant figures on the smallest non-zero step between them, and a
 * shared ×10ⁿ when the row is large or small. Labels are distinct whenever the
 * values differ by more than double precision can carry.
 */
/** How close a formatValueRow label must stay to its value (relative). */
const FAITHFUL_REL = 0.01;

export function formatValueRow(values: number[], sig = 3): FormattedRow {
  const fin = values.filter(Number.isFinite);
  if (!fin.length) return { labels: values.map(fmtValue), multiplier: "", exponent: 0, decimals: 0, duplicate: false };
  const maxAbs = fin.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  if (maxAbs === 0) return formatIntRow(values.map(() => 0), 0);
  const P = Math.floor(Math.log10(maxAbs));
  const distinctValues = new Set(values).size;
  // Quantum: sig figures on the largest value, refined until the row is distinct
  // — and then, for at most two more digits, until it is FAITHFUL: every
  // non-zero value printed within 1% of itself (FAITHFUL_REL). A shared quantum taken from the
  // largest value used to round the small end to nothing: a colour bar over
  // 1 … 10⁶ read "0×10⁶ … 1×10⁶", and 0.00012 … 0.5 read "0.0 … 0.5" (v2.143.0
  // adversarial review). A row that cannot be both distinct and faithful is
  // labelled value by value below.
  let distinctAt = -1;
  for (let extra = 0; extra <= 12; extra++) {
    const qexp = P - (sig - 1) - extra;
    const ints = values.map((v) => (Number.isFinite(v) ? Math.round(scale10(v, -qexp)) : 0));
    if (!ints.every(Number.isSafeInteger)) break;
    const row = formatIntRow(ints, qexp);
    if (new Set(row.labels).size !== distinctValues) continue;
    if (distinctAt < 0) distinctAt = extra;
    const faithful = values.every((v, i) => {
      if (!Number.isFinite(v) || v === 0) return true;
      if (ints[i] === 0) return false;
      // 1%, not 5%: a colour bar's END labels state its true min and max, and a
      // minimum of 0.096 printed "0.1" overstated it by 4% (second review).
      return Math.abs(scale10(ints[i], qexp) - v) <= FAITHFUL_REL * Math.abs(v);
    });
    if (faithful) return row;
    if (extra >= distinctAt + 2) break;
  }
  // Value by value: each label stands alone (no shared decimals or ×10ⁿ), with
  // as many significant figures as it takes to keep different values apart.
  // Never a duplicate passed off as distinct: [1, 1 + 1e−15, 2] needs sixteen.
  let labels = values.map((v) => fmtSigTrim(v, sig));
  for (let s = Math.max(1, sig); s <= 17 && new Set(labels).size !== distinctValues; s++) labels = values.map((v) => fmtSigTrim(v, s));
  return { labels, multiplier: "", exponent: 0, decimals: 0, duplicate: new Set(labels).size !== distinctValues };
}

/** `sig` significant figures, trailing zeros dropped: plain from 10⁻³ up to 10⁶, else m×10ⁿ. */
function fmtSigTrim(v: number, sig: number): string {
  if (!Number.isFinite(v)) return fmtValue(v);
  if (v === 0) return "0";
  const a = Math.abs(v);
  const s = Math.max(1, Math.min(17, Math.round(sig)));
  if (a >= 1e-3 && a < 1e6) {
    let p = a.toPrecision(s);
    if (/e/i.test(p)) p = String(Number(p));
    if (p.includes(".")) p = p.replace(/0+$/, "").replace(/\.$/, "");
    if (Number(p) >= 1e6) return sci(v, s);
    const [ip, fp] = p.split(".");
    const body = (Number(ip) >= 1e4 ? groupThousands(ip) : ip) + (fp ? `.${fp}` : "");
    return v < 0 ? MINUS + body : body;
  }
  return sci(v, s);
}

// ---------------------------------------------------------------------------
// Log axes.

export interface LogAxis {
  /** Decade values inside the domain. */
  major: number[];
  /** 2…9 × each decade inside the domain (gridlines; labelled only when in `labelled`). */
  minor: number[];
  /** Every labelled tick, ascending, with its text. */
  labelled: { v: number; text: string }[];
}

/** Decade majors and 2–9 minors over [lo, hi] in log10 units. Bounded. */
export function logDecades(lo: number, hi: number): { major: number[]; minor: number[] } {
  const major: number[] = [];
  const minor: number[] = [];
  const first = Math.floor(lo);
  const last = Math.ceil(hi);
  if (!Number.isFinite(first) || !Number.isFinite(last) || Math.abs(first) > 320 || Math.abs(last) > 320) {
    return { major, minor };
  }
  if (last - first > 40) {
    // Beyond 40 decades: every k-th decade (k = 2, 5, 10, 20, 50 or 100, the
    // smallest that leaves at most 20), on multiples of k so 10⁰ is one of them.
    // Was nothing at all — a 41-decade axis drew with no labels and no note.
    const k = [2, 5, 10, 20, 50, 100].find((s) => (last - first) / s <= 20) ?? 100;
    for (let d = Math.ceil(first / k) * k; d <= last; d += k) {
      if (d >= lo - 1e-9 && d <= hi + 1e-9) major.push(scale10(1, d));
    }
    return { major, minor };
  }
  for (let d = first; d <= last; d++) {
    const decade = scale10(1, d);
    if (d >= lo - 1e-9 && d <= hi + 1e-9) major.push(decade);
    if (last - first <= 6) {
      for (let m = 2; m <= 9; m++) {
        const v = Math.log10(m * decade);
        if (v >= lo && v <= hi) minor.push(m * decade);
      }
    }
  }
  return { major, minor };
}

/** Uniform decade label: 10ⁿ, including 10⁰ and 10¹. */
export function decadeLabel(v: number): string {
  return `10${superscript(Math.round(Math.log10(v)))}`;
}

/**
 * A log axis over [lo, hi] given in log10 units.
 *
 * - ≥ 3 decades: every decade labelled 10ⁿ, uniformly (journal style).
 * - fewer: decades in plain digits when every one sits in 10⁻³ … 10⁵, else 10ⁿ;
 *   and when that leaves fewer than three labels, the 2 and 5 multiples are
 *   labelled too (a 0.5–30 axis reads 0.5, 1, 2, 5, 10, 20);
 * - still fewer than two labels (a fraction of a decade): linear ticks in data
 *   units, placed on the log scale.
 */
export function logAxis(lo: number, hi: number): LogAxis {
  const { major, minor } = logDecades(lo, hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { major, minor, labelled: [] };
  const span = hi - lo;
  const exps = major.map((v) => Math.round(Math.log10(v)));
  const uniform = span >= 3 - 1e-9 || exps.some((e) => e < -3 || e > 5);
  const plainOk = (e: number): boolean => e >= -3 && e <= 5;
  const labelled = major.map((v) => ({ v, text: uniform ? decadeLabel(v) : fmtValue(v) }));
  if (labelled.length < 3 && span < 3) {
    for (const v of minor) {
      const e = Math.floor(Math.log10(v) + 1e-12);
      const mult = Math.round(v / scale10(1, e));
      if (mult === 2 || mult === 5) {
        labelled.push({ v, text: plainOk(e) && !uniform ? fmtValue(v) : `${mult}${timesTen(e)}` });
      }
    }
    labelled.sort((p, q) => p.v - q.v);
  }
  if (labelled.length < 2) {
    const row = linearAxis(Math.pow(10, lo), Math.pow(10, hi), { target: 4 });
    const out = row.values.map((v, i) => ({ v, text: row.labels[i] + row.multiplier })).filter((t) => t.v > 0);
    if (out.length >= 2) return { major, minor, labelled: out };
  }
  return { major, minor, labelled };
}

// ---------------------------------------------------------------------------
// User-set limits.

export interface AxisLimits {
  min?: number;
  max?: number;
  step?: number;
  log?: boolean;
}

export type LimitsResult =
  | { ok: true; lo: number; hi: number; step?: number; outside: number }
  | { ok: false; reason: string };

/**
 * Applies user limits to the data's range. Refuses — with the reason — a
 * non-finite limit, min ≥ max, a log axis starting at or below zero, a step that
 * is not positive or would draw more than AXIS_TICK_CAP ticks, and limits that
 * hide every data point. `values` (optional) are counted for the
 * "n points outside the axis limits" note.
 */
export function resolveLimits(dataLo: number, dataHi: number, lim: AxisLimits, values: number[] = []): LimitsResult {
  const name = (v: number | undefined): string => (v === undefined ? "" : fmtValue(v));
  for (const [k, v] of [["minimum", lim.min], ["maximum", lim.max], ["step", lim.step]] as const) {
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
      return { ok: false, reason: `the axis ${k} is not a finite number` };
    }
  }
  const lo = lim.min ?? dataLo;
  const hi = lim.max ?? dataHi;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: false, reason: "the data have no finite range to apply the limits to" };
  if (!(lo < hi)) return { ok: false, reason: `the axis minimum ${name(lo)} is not below the maximum ${name(hi)}` };
  if (lim.log && !(lo > 0)) return { ok: false, reason: `a logarithmic axis cannot start at ${name(lo)}: it must start above zero` };
  if (lim.step !== undefined) {
    if (!(lim.step > 0)) return { ok: false, reason: `the tick step ${name(lim.step)} is not positive` };
    if (lim.log) return { ok: false, reason: "a tick step cannot be set on a logarithmic axis: its ticks are decades" };
    const n = (hi - lo) / lim.step;
    if (!Number.isFinite(n) || Math.floor(n + 1e-9) + 1 > AXIS_TICK_CAP) {
      return { ok: false, reason: `a step of ${name(lim.step)} would draw more than ${AXIS_TICK_CAP} ticks` };
    }
  }
  if (Number.isFinite(dataLo) && Number.isFinite(dataHi) && (dataHi < lo || dataLo > hi)) {
    return {
      ok: false,
      reason: `the limits ${name(lo)} to ${name(hi)} hide every data point (the data run ${name(dataLo)} to ${name(dataHi)})`,
    };
  }
  let outside = 0;
  for (const v of values) if (Number.isFinite(v) && (v < lo || v > hi)) outside++;
  return { ok: true, lo, hi, step: lim.step, outside };
}

/** "3 points outside the axis limits", or "" when none. */
export function outsideNote(n: number): string {
  if (!(n > 0)) return "";
  return `${n} point${n === 1 ? "" : "s"} outside the axis limits`;
}
