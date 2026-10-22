// Monte Carlo uncertainty propagation as a Solve verb (student pack, release A).
//
//   monte carlo  a*b/c  a = 10.0 ± 0.1, b = 4.00 ± 0.05, c = 2.0 ± 0.1
//
// Each input written value ± u is read as a NORMAL distribution with standard
// deviation u (a standard uncertainty, 1σ). N draws (default 10⁵) are pushed
// through the expression by the SAME evaluator the Stats uncertainty
// calculator uses (stats.ts evalFormula), so both methods read the formula
// identically; the first-order (GUM) answer comes from that calculator's own
// propagateUncertainty. Reported: the mean, the standard deviation, the 95 %
// coverage interval from the 2.5th and 97.5th percentiles of the sorted draws,
// and the JCGM 101:2008 §8 comparison of that interval with the GUM y ± 1.96u.
//
// DETERMINISTIC: the generator is seeded (default seed 1, printed), so the same
// question gives the same digits every time, in the pane and in the tests.
//
// BOUNDED: the pane re-solves on every keystroke, so the work is capped by
// draws × (a fixed per-draw cost + formula length + a cost per uncertain
// input) (for the compiled formula MC_DEFAULT_WORK_BUDGET when no count is
// typed and MC_FAST_WORK_BUDGET when one is; MC_WORK_BUDGET when it falls
// back to evalFormula), never by wall-clock time — a time cut-off
// would make the answer depend on the machine. The caller is told when its
// sample count was reduced. Measured (esbuild bundle, node/V8): a·b/c ≈ 25 ms
// at the default 10⁵ draws, ≈ 0.2 s per 10⁶, ≈ 0.4 s at the 2×10⁶ cap; the
// slowest shapes tried (60-term sums, 300-factor products) stay under 0.6 s.
//
// Inputs are independent; correlated inputs are not supported (said so).
// Pass the RAW Solve input (the paste fold notes "± means two expressions").

import type { VerbResult } from "./algebraTools";
import { evalFormula, propagateUncertainty } from "./stats";
import { formatAtPlace } from "./sigFigVerb";
import { linearAxis, timesTen, superscript, THIN_SPACE } from "./axis";

const MINUS = "−";
/** No-break, thin and narrow no-break spaces (built from code points: never invisible literals in source). */
const SPACE_LIKE = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, "g");
/** A count grouped the SI way: thin spaces from five digits (100 000). */
export function fmtCount(n: number): string {
  const s = String(Math.round(n));
  return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+$)/g, THIN_SPACE);
}

/**
 * A double at `prec` significant figures, typeset: trailing zeros trimmed,
 * ×10ⁿ for what toPrecision writes as e-notation, U+2212 minus.
 */
export function fmtNum(x: number, prec = 12): string {
  if (x === 0) return "0";
  const t = x.toPrecision(prec);
  const m = /^(-?)(\d+(?:\.\d+)?)(?:e([+-]\d+))?$/.exec(t);
  if (!m) return t;
  const mant = m[2].includes(".") ? m[2].replace(/0+$/, "").replace(/\.$/, "") : m[2];
  return `${m[1] ? MINUS : ""}${mant}${m[3] ? timesTen(parseInt(m[3], 10)) : ""}`;
}

/** Claims a line for the verb. Word-led: "monte carlo" / "monte-carlo". */
export const MONTE_CARLO_RE = /\bmonte[\s-]?carlo\b/i;

export function isMonteCarloRequest(raw: string): boolean {
  return MONTE_CARLO_RE.test(raw);
}

export const MC_DEFAULT_SAMPLES = 100000;
export const MC_MAX_SAMPLES = 2000000;
export const MC_MIN_SAMPLES = 1000;
/**
 * Work units per run. One unit ≈ one formula character evaluated once
 * (≈ 0.04–0.07 µs in V8); a draw costs MC_DRAW_COST + the formula's length +
 * MC_INPUT_COST per uncertain input. Measured (bundled, V8): the brief's
 * a·b/c at 10⁵ draws ≈ 70 ms; every shape stays near or under 0.15 s, with
 * headroom for a slower engine. This budget is for the FALLBACK, evalFormula
 * re-parsing each draw (used only when the compiled formula is refused).
 */
export const MC_WORK_BUDGET = 2e6;
/**
 * The budget for the compiled formula (≈ 3× faster per draw than
 * evalFormula): 6×10⁷ units lets every short formula (a·b/c: 17 units a draw)
 * reach MC_MAX_SAMPLES = 2×10⁶ draws, the most a typed request can ask for —
 * about 0.4 s bundled; nothing measured runs past ~0.6 s.
 */
export const MC_FAST_WORK_BUDGET = 6e7;
/**
 * The compiled budget when NO sample count was typed — the pane re-solves on
 * every keystroke, so the default run stays short: 10⁵ draws for any formula
 * up to ~140 units a draw, a long formula reduced (≈ 0.15 s at most).
 */
export const MC_DEFAULT_WORK_BUDGET = 1.5e7;
/** The fixed cost of one draw (normals, bookkeeping, the sort), in formula characters. */
export const MC_DRAW_COST = 6;
/** The cost of one uncertain input per draw, in formula characters. */
export const MC_INPUT_COST = 2;
/** The largest seed: the generator's state is 32 bits, so larger seeds would wrap onto smaller ones. */
export const MC_MAX_SEED = 0xffffffff;
/** z with Φ(z) = 0.975 (scipy.stats.norm.ppf(0.975)). */
export const Z975 = 1.959963984540054;

// ---------------------------------------------------------------------------
// The seeded generator: splitmix32, and Box–Muller for the normal draws.
// ---------------------------------------------------------------------------

export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/**
 * Fills `buf` with standard normal draws (Box–Muller, both outputs used) from
 * the splitmix32 stream whose state is `state[0]`, advancing it. One tight
 * loop with no closure per draw: this is the hot path. Even-length buffers
 * keep the pairs whole, so the draws do not depend on how they are chunked.
 */
export function fillNormals(state: Int32Array, buf: Float64Array): void {
  let a = state[0];
  const n = buf.length;
  for (let i = 0; i < n; i += 2) {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    // (k + 0.5)/2³² lies strictly inside (0, 1): ln(0) can never occur.
    const u1 = ((t >>> 0) + 0.5) / 4294967296;
    a = (a + 0x9e3779b9) | 0;
    t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    const u2 = ((t >>> 0) + 0.5) / 4294967296;
    const r = Math.sqrt(-2 * Math.log(u1));
    buf[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) buf[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  state[0] = a;
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

export interface McInput {
  name: string;
  value: number;
  /** Standard uncertainty (1σ); 0 for an exact constant. */
  u: number;
}

/**
 * agree     — both endpoint differences within δ (JCGM 101 §8: validated).
 * noise     — beyond δ but within 3 standard errors of the draws' own noise:
 *             more samples are needed to decide.
 * disagree  — beyond δ + 3 standard errors: the first-order result is wrong.
 * nogum     — the first-order uncertainty is zero (a vanishing slope).
 * unsettled — the moments do not settle (heavy tails); only percentiles hold.
 * constant  — every draw gives the same value (the inputs' spread cancels).
 */
export type McVerdict = "agree" | "noise" | "disagree" | "nogum" | "unsettled" | "constant";

export interface McResult {
  expr: string;
  samples: number;
  requested: number;
  seed: number;
  mean: number;
  sd: number;
  lo: number;
  hi: number;
  /** f at the input values and its first-order (GUM) standard uncertainty. */
  gum: { value: number; u: number };
  /** JCGM 101 §8: endpoint differences, the tolerance δ, and the verdict. */
  dLow: number;
  dHigh: number;
  delta: number;
  /** About one standard error of each Monte Carlo endpoint (sampling noise). */
  seLow: number;
  seHigh: number;
  verdict: McVerdict;
  /** True only when both endpoint differences are within δ (JCGM 101 §8). */
  validated: boolean;
  /** The sorted draws (for the histogram and the tests). */
  sorted: Float64Array;
  /**
   * When unsettled: the denominators (and negative-power bases) whose draws
   * pass through zero — the named cause. Empty when none does (heavy tails).
   */
  throughZero: string[];
  /** When unsettled: denominators that never change sign but come down to zero (b² with b spanning 0). */
  nearZero: string[];
  /** The compiled evaluator ran (checked against evalFormula); else evalFormula itself, with a smaller budget. */
  compiled: boolean;
}

/** Normalises typed operators to the stats evaluator's grammar. */
export function mcNormalizeExpr(e: string): string {
  const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
  return e
    .replace(/\*\*/g, "^") // a**2, as typed from Python/Fortran, is a power
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^(${[...run].map((c) => SUP[c]).join("")})`)
    .trim();
}

/**
 * ℓ of JCGM 101 §7.9: u is FIRST rounded to two significant digits c·10^ℓ
 * (c = 10…99), on its decimal digits (nine significant, halves away from
 * zero — the same reading formatAtPlace displays), so 0.9999999999621 is 1.0
 * (ℓ = −1), never 99×10⁻² (ℓ = −2). Null for u ≤ 0 or non-finite.
 */
export function twoFigurePlace(u: number): number | null {
  if (!(u > 0) || !Number.isFinite(u)) return null;
  const m = /^(\d)\.(\d+)e([+-]\d+)$/.exec(u.toExponential(8));
  if (!m) return Math.floor(Math.log10(u)) - 1;
  let e = parseInt(m[3], 10);
  const digits = m[1] + m[2];
  const two = parseInt(digits.slice(0, 2), 10) + (digits[2] >= "5" ? 1 : 0);
  if (two >= 100) e += 1;
  return e - 1;
}

/** δ of JCGM 101 §7.9: u written to two significant digits c·10^ℓ → δ = ½·10^ℓ. */
export function numericalTolerance(u: number): number {
  const l = twoFigurePlace(u);
  return l === null ? 0 : 0.5 * Math.pow(10, l);
}

/**
 * The draws actually made: the request, capped at MC_MAX_SAMPLES and by the
 * work budget — a fixed cost per draw plus the formula's length (whitespace
 * aside) plus a cost per uncertain input.
 */
export function plannedSamples(requested: number, exprLength: number, uncertainInputs = 1, compiled = false, asked = false): number {
  const perDraw = MC_DRAW_COST + Math.max(0, exprLength) + MC_INPUT_COST * Math.max(1, uncertainInputs);
  const budget = !compiled ? MC_WORK_BUDGET : asked ? MC_FAST_WORK_BUDGET : MC_DEFAULT_WORK_BUDGET;
  const byBudget = Math.max(MC_MIN_SAMPLES, Math.floor(budget / perDraw));
  return Math.min(requested, MC_MAX_SAMPLES, byBudget);
}

// ---------------------------------------------------------------------------
// Reading the formula's shape (whitespace removed, the stats grammar).
// ---------------------------------------------------------------------------

const SUP_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁻";

/** Index of the paren matching the "(" at i (or −1). */
function closeParen(s: string, i: number): number {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "(") d++;
    else if (s[j] === ")" && --d === 0) return j;
  }
  return -1;
}

/** End of the unary operand starting at j: signs, an atom, trailing superscripts, and a right-associative ^ power. */
function operandEnd(s: string, j: number): number {
  let k = j;
  while (s[k] === "-" || s[k] === "+") k++;
  if (s[k] === "(") {
    const c = closeParen(s, k);
    if (c < 0) return -1;
    k = c + 1;
  } else {
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(k));
    if (id) {
      k += id[0].length;
      if (s[k] === "(") {
        const c = closeParen(s, k);
        if (c < 0) return -1;
        k = c + 1;
      }
    } else {
      const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(k));
      if (!num) return -1;
      k += num[0].length;
    }
  }
  while (k < s.length && SUP_CHARS.includes(s[k])) k++;
  if (s[k] === "^") {
    const e = operandEnd(s, k + 1);
    return e < 0 ? -1 : e;
  }
  return k;
}

/** Start of the base that ends just before index p (the base of a ^ at p). */
function baseStart(s: string, p: number): number {
  let k = p;
  while (k > 0 && SUP_CHARS.includes(s[k - 1])) k--;
  if (s[k - 1] === ")") {
    let d = 0;
    for (let j = k - 1; j >= 0; j--) {
      if (s[j] === ")") d++;
      else if (s[j] === "(" && --d === 0) {
        k = j;
        break;
      }
      if (j === 0) return -1;
    }
    while (k > 0 && /[A-Za-z0-9_]/.test(s[k - 1])) k--;
    return k;
  }
  while (k > 0 && /[A-Za-z0-9_.]/.test(s[k - 1])) k--;
  return k < p ? k : -1;
}

/**
 * The parts of a formula that can send it to infinity through zero: every
 * denominator (the operand after "/") and the base of every negative power
 * (c^-1, c^(-2)). Used only to NAME the cause when the moments do not settle.
 */
export function reciprocalParts(expr: string): string[] {
  const s = expr.replace(/\s+/g, "");
  const out: string[] = [];
  for (let p = 0; p < s.length; p++) {
    if (s[p] === "/") {
      const end = operandEnd(s, p + 1);
      if (end > p + 1) out.push(s.slice(p + 1, end));
    } else if (s[p] === "^" && (s[p + 1] === "-" || s.startsWith("(-", p + 1))) {
      const b = baseStart(s, p);
      if (b >= 0) out.push(s.slice(b, p));
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// The hot path: the formula compiled ONCE into closures that mirror
// stats.ts evalFormula's grammar node for node (the same precedence, the same
// right-associative ^, the same Math functions, variables before pi and e),
// so each draw costs a few calls instead of a re-parse. It is never trusted
// blindly: monteCarlo() checks it against evalFormula, bit for bit, at the
// stated values and on the first draws, and falls back to evalFormula (with
// a smaller budget) on any difference or anything it does not know.
// ---------------------------------------------------------------------------

type Fn = (v: Float64Array) => number;

const MC_FNS_1: Record<string, (v: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign, sgn: Math.sign,
  step: (v: number) => (v < 0 ? 0 : 1),
};
const MC_FNS_2: Record<string, (a: number, b: number) => number> = {
  min: Math.min, max: Math.max, atan2: Math.atan2, pow: Math.pow,
  mod: (a, b) => a - b * Math.floor(a / b),
  logbase: (a, b) => Math.log(a) / Math.log(b),
  hypot: Math.hypot,
};
const MC_FNS_3: Record<string, (a: number, b: number, c: number) => number> = {
  if: (c, a, b) => (c !== 0 ? a : b),
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};

/**
 * Compiles `expr` (the stats grammar) over the variables `names` (read from
 * v[index]), or null for anything unusual — the caller then uses evalFormula.
 */
export function compileFormula(expr: string, names: string[]): Fn | null {
  const s = expr.replace(/\s+/g, "");
  const index = new Map(names.map((n, i) => [n, i]));
  let i = 0;
  let depth = 0;
  const fail = (): never => {
    throw new Error("compile");
  };
  function expr_(): Fn {
    if (++depth > 200) fail();
    let f = additive();
    for (;;) {
      const two = s.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
        i += 2;
        const a = f;
        const b = additive();
        f = two === "<=" ? (v) => (a(v) <= b(v) ? 1 : 0) : two === ">=" ? (v) => (a(v) >= b(v) ? 1 : 0) : two === "==" ? (v) => (a(v) === b(v) ? 1 : 0) : (v) => (a(v) !== b(v) ? 1 : 0);
        continue;
      }
      const one = s[i];
      if (one === "<" || one === ">") {
        i++;
        const a = f;
        const b = additive();
        f = one === "<" ? (v) => (a(v) < b(v) ? 1 : 0) : (v) => (a(v) > b(v) ? 1 : 0);
        continue;
      }
      depth--;
      return f;
    }
  }
  function additive(): Fn {
    let f = term();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const a = f;
      const b = term();
      f = op === "+" ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
    return f;
  }
  function term(): Fn {
    let f = unary();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const a = f;
      const b = unary();
      f = op === "*" ? (v) => a(v) * b(v) : (v) => a(v) / b(v);
    }
    return f;
  }
  function unary(): Fn {
    if (++depth > 400) fail();
    let f: Fn;
    if (s[i] === "-") {
      i++;
      const a = unary();
      f = (v) => -a(v);
    } else if (s[i] === "+") {
      i++;
      f = unary();
    } else f = power();
    depth--;
    return f;
  }
  function power(): Fn {
    const base = atom();
    if (s[i] === "^") {
      i++;
      const ex = unary();
      return (v) => Math.pow(base(v), ex(v));
    }
    return base;
  }
  function atom(): Fn {
    if (s[i] === "(") {
      i++;
      const f = expr_();
      if (s[i] !== ")") fail();
      i++;
      return f;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (m) {
      const name = m[0];
      i += name.length;
      if (s[i] === "(") {
        i++;
        const args: Fn[] = [];
        if (s[i] !== ")") {
          args.push(expr_());
          while (s[i] === ",") {
            i++;
            args.push(expr_());
          }
        }
        if (s[i] !== ")") fail();
        i++;
        const f1 = MC_FNS_1[name];
        if (f1 && args.length === 1) {
          const a = args[0];
          return (v) => f1(a(v));
        }
        const f2 = MC_FNS_2[name];
        if (f2 && args.length === 2) {
          const [a, b] = args;
          return (v) => f2(a(v), b(v));
        }
        const f3 = MC_FNS_3[name];
        if (f3 && args.length === 3) {
          const [a, b, c] = args;
          return (v) => f3(a(v), b(v), c(v));
        }
        return fail();
      }
      const k = index.get(name);
      if (k !== undefined) return (v) => v[k];
      if (name === "pi") return () => Math.PI;
      if (name === "e") return () => Math.E;
      return fail();
    }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      const c = parseFloat(num[0]);
      return () => c;
    }
    return fail();
  }
  try {
    const f = expr_();
    return i === s.length ? f : null;
  } catch {
    return null;
  }
}

/**
 * Runs the Monte Carlo. Throws an Error whose message is shown to the user
 * (an unknown variable, a non-finite draw, a malformed formula).
 */
export function monteCarlo(expr: string, inputs: McInput[], opts: { samples?: number; seed?: number } = {}): McResult {
  const e = mcNormalizeExpr(expr);
  const requested = Math.round(opts.samples ?? MC_DEFAULT_SAMPLES);
  if (!Number.isFinite(requested) || requested < MC_MIN_SAMPLES) throw new Error(`Use at least ${fmtCount(MC_MIN_SAMPLES)} samples — fewer cannot place a 2.5 % tail.`);
  const seed = Math.trunc(opts.seed ?? 1);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MC_MAX_SEED) {
    throw new Error(`The seed must be a whole number from 0 to ${fmtCount(MC_MAX_SEED)} (the generator's 32-bit state; a larger seed would repeat a smaller one).`);
  }
  const vars: Record<string, number> = {};
  for (const inp of inputs) vars[inp.name] = inp.value;
  // The nominal value: also proves the formula reads, before any sampling.
  const gumIn: Record<string, { value: number; uncertainty: number }> = {};
  for (const inp of inputs) gumIn[inp.name] = { value: inp.value, uncertainty: inp.u };
  const g = propagateUncertainty(e, gumIn);
  if (!Number.isFinite(g.value) || !Number.isFinite(g.uncertainty)) {
    throw new Error("The formula is not finite at the stated values, so neither method can be applied.");
  }

  const names = inputs.map((x) => x.name);
  const vals = new Float64Array(names.length);
  inputs.forEach((x, p) => (vals[p] = x.value));
  const uncertain = inputs.filter((x) => x.u > 0);
  const uIdx = uncertain.map((x) => names.indexOf(x.name));
  const k = uncertain.length;
  const CHUNK = 4096; // even, so Box–Muller pairs never straddle two chunks
  const z = new Float64Array(CHUNK * k);
  /** Sets the inputs to draws 0 … count−1 of this seed's stream (the same draws on every pass), calling each(i). */
  const runDraws = (count: number, each: (i: number) => void, withVars = false): void => {
    const state = new Int32Array([seed | 0]); // seed ≤ 2³² − 1: the same 32 bits
    for (let i0 = 0; i0 < count; i0 += CHUNK) {
      const m = Math.min(CHUNK, count - i0);
      const zz = m === CHUNK ? z : z.subarray(0, m * k + ((m * k) % 2));
      fillNormals(state, zz);
      for (let j = 0; j < m; j++) {
        for (let q = 0; q < k; q++) vals[uIdx[q]] = uncertain[q].value + uncertain[q].u * zz[j * k + q];
        if (withVars) for (let q = 0; q < k; q++) vars[uncertain[q].name] = vals[uIdx[q]];
        each(i0 + j);
      }
    }
  };
  const same = (a: number, b: number): boolean => a === b || (a !== a && b !== b);
  // The compiled formula, trusted only after it matches evalFormula bit for
  // bit at the stated values and on the first 256 draws of this stream.
  let fast = compileFormula(e, names);
  if (fast && !same(fast(vals), evalFormula(e, vars))) fast = null;
  if (fast) {
    const f = fast;
    let ok = true;
    runDraws(Math.min(256, requested), () => {
      if (ok && !same(f(vals), evalFormula(e, vars))) ok = false;
    }, true);
    if (!ok) fast = null;
  }
  const samples = plannedSamples(requested, e.replace(/\s+/g, "").length, k, !!fast, opts.samples !== undefined);
  const ys = new Float64Array(samples);
  let bad = 0;
  let firstBad = "";
  const noteBad = (y: number): void => {
    bad++;
    if (!firstBad) firstBad = uncertain.map((x, q) => `${x.name} = ${fmtNum(vals[uIdx[q]], 4)}`).join(", ");
    void y;
  };
  if (fast) {
    const f = fast;
    runDraws(samples, (i) => {
      const y = f(vals);
      if (!(y - y === 0)) noteBad(y);
      ys[i] = y;
    });
  } else {
    runDraws(samples, (i) => {
      const y = evalFormula(e, vars);
      if (!Number.isFinite(y)) noteBad(y);
      ys[i] = y;
    }, true);
  }
  if (bad) {
    throw new Error(
      `${fmtCount(bad)} of ${fmtCount(samples)} draws made the formula non-finite (first at ${firstBad.replace(/-/g, MINUS)}) — ` +
        "an input's spread reaches a division by zero, a log or square root of a negative, or an overflow. " +
        "The output distribution then has no mean or standard deviation, so nothing is reported; tighten the inputs or change the formula.",
    );
  }
  // Squares of draws near 10^-200 underflow to 0 (and near 10^200 overflow):
  // the spread is then computed on draws scaled by their largest magnitude.
  let maxAbs = 0;
  for (let i = 0; i < samples; i++) maxAbs = Math.max(maxAbs, Math.abs(ys[i]));
  const scale = maxAbs > 0 && (maxAbs < 1e-100 || maxAbs > 1e100) ? maxAbs : 1;
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += ys[i];
  const mean = sum / samples;
  let ss = 0;
  for (let i = 0; i < samples; i++) ss += ((ys[i] - mean) / scale) ** 2;
  const sd = Math.sqrt(ss / (samples - 1)) * scale;
  const sorted = ys.slice().sort();
  // Order statistics at ranks ⌈0.025 N⌉ and ⌈0.975 N⌉ (1-based).
  const kLo = Math.ceil(0.025 * samples);
  const kHi = Math.ceil(0.975 * samples);
  const lo = sorted[kLo - 1];
  const hi = sorted[kHi - 1];
  // The sampling noise of each endpoint, distribution-free: the ranks
  // k ± √(N·p(1−p)) bracket the p-quantile by about ±1 standard error.
  const h = Math.ceil(Math.sqrt(samples * 0.025 * 0.975));
  const at = (r: number): number => sorted[Math.max(0, Math.min(samples - 1, r - 1))];
  const seLow = (at(kLo + h) - at(kLo - h)) / 2;
  const seHigh = (at(kHi + h) - at(kHi - h)) / 2;
  // Do the moments settle? Two halves of the draws must agree on the
  // standard deviation; when an input's spread reaches a singularity (1/c with
  // c near 0) the variance does not exist and the halves disagree wildly.
  const half = Math.floor(samples / 2);
  const sdOf = (from: number, to: number): number => {
    let s1 = 0;
    for (let i = from; i < to; i++) s1 += ys[i];
    const mu = s1 / (to - from);
    let s2 = 0;
    for (let i = from; i < to; i++) s2 += ((ys[i] - mu) / scale) ** 2;
    return Math.sqrt(s2 / (to - from - 1)) * scale;
  };
  const sdA = sdOf(0, half);
  const sdB = sdOf(half, samples);
  const constant = sorted[0] === sorted[samples - 1];
  const unsettled = !constant && (!(sdA > 0 && sdB > 0) ? sdA !== sdB : Math.max(sdA, sdB) / Math.min(sdA, sdB) > 1.5);
  // The cause, NAMED only when it is there. A lognormal exp(a) is unsettled
  // too, with no denominator at all. A second pass over the first draws of the
  // same stream (bounded: ≤ 10⁵ draws compiled, 2×10⁴ otherwise).
  // A denominator whose draws change sign or reach zero passes THROUGH it; one
  // that only comes within 10⁻⁶ of its own spread of zero (b² with b = 0.1 ±
  // 0.1: b crosses zero, b² just touches it) still has density there, and the
  // output's variance is just as infinite — that is named too.
  const throughZero: string[] = [];
  const nearZero: string[] = [];
  if (unsettled) {
    const parts = reciprocalParts(e);
    if (parts.length) {
      const lo2 = parts.map(() => Infinity);
      const hi2 = parts.map(() => -Infinity);
      const minAbs = parts.map(() => Infinity);
      const hitZero = parts.map(() => false);
      const compiled = parts.map((pt) => compileFormula(pt, names));
      runDraws(
        Math.min(samples, fast ? 100000 : 20000),
        () => {
          for (let p = 0; p < parts.length; p++) {
            let v: number;
            const c = compiled[p];
            if (c) v = c(vals);
            else {
              try {
                v = evalFormula(parts[p], vars);
              } catch {
                continue;
              }
            }
            if (v < lo2[p]) lo2[p] = v;
            if (v > hi2[p]) hi2[p] = v;
            const a = Math.abs(v);
            if (a < minAbs[p]) minAbs[p] = a;
            if (v === 0) hitZero[p] = true;
          }
        },
        compiled.some((c) => !c),
      );
      parts.forEach((pt, p) => {
        if ((lo2[p] < 0 && hi2[p] > 0) || hitZero[p]) throughZero.push(pt);
        else if (hi2[p] > lo2[p] && minAbs[p] <= 1e-6 * (hi2[p] - lo2[p])) nearZero.push(pt);
      });
    }
  }
  const U = Z975 * g.uncertainty;
  const dLow = Math.abs(g.value - U - lo);
  const dHigh = Math.abs(g.value + U - hi);
  const delta = numericalTolerance(g.uncertainty);
  let verdict: McVerdict;
  if (constant) verdict = "constant";
  else if (unsettled) verdict = "unsettled";
  else if (!(g.uncertainty > 0)) verdict = "nogum";
  else if (dLow <= delta && dHigh <= delta) verdict = "agree";
  else if (dLow > delta + 3 * seLow || dHigh > delta + 3 * seHigh) verdict = "disagree";
  // Beyond δ but within the draws' own noise: the Monte Carlo cannot tell —
  // more samples are needed, and the text says so.
  else verdict = "noise";
  return {
    seLow,
    seHigh,
    verdict,
    expr: e,
    samples,
    requested,
    seed,
    mean,
    sd,
    lo,
    hi,
    gum: { value: g.value, u: g.uncertainty },
    dLow,
    dHigh,
    delta,
    validated: verdict === "agree",
    sorted,
    throughZero,
    nearZero,
    compiled: !!fast,
  };
}

// ---------------------------------------------------------------------------
// Display: the uncertainty to two significant figures and every value at the
// same decimal place, U+2212 minus, ×10ⁿ factored out when large or small.
// ---------------------------------------------------------------------------

/** The display place: the second significant digit of u AFTER rounding u to two (1.0, not 0.99). */
function placeFor(u: number): number {
  return twoFigurePlace(u) ?? -6;
}

function fixed(x: number, place: number): string {
  return formatAtPlace(x, place);
}

/** Formats a set of values at the decimal place of `u` (2 figures), sharing a ×10ⁿ when needed. */
export function fmtShared(values: number[], u: number): { texts: string[]; suffix: string } {
  const place = placeFor(u);
  const big = Math.max(...values.map((v) => Math.abs(v)));
  const lead = big > 0 ? Math.floor(Math.log10(big)) : 0;
  if (lead >= 5 || lead <= -4) {
    const E = lead;
    const s = Math.pow(10, E);
    return { texts: values.map((v) => fixed(v / s, place - E)), suffix: timesTen(E) };
  }
  return { texts: values.map((v) => fixed(v, place)), suffix: "" };
}

// ---------------------------------------------------------------------------
// The histogram.
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const MC_HIST_BINS = 40;

/** Histogram of the draws (central 99.8 %), the GUM normal curve, the mean and the 95 % interval. */
export function mcHistogramSvg(r: McResult, label: string): string {
  const n = r.sorted.length;
  let a = r.sorted[Math.floor(0.001 * (n - 1))];
  let b = r.sorted[Math.ceil(0.999 * (n - 1))];
  if (!(b > a)) {
    a -= 1;
    b += 1;
  }
  const bins = MC_HIST_BINS;
  const w = (b - a) / bins;
  const counts = new Array<number>(bins).fill(0);
  let outside = 0;
  for (let i = 0; i < n; i++) {
    const v = r.sorted[i];
    if (v < a || v > b) {
      outside++;
      continue;
    }
    counts[Math.min(bins - 1, Math.floor((v - a) / w))]++;
  }
  const gumPdf = (x: number): number => (r.gum.u > 0 ? (n * w * Math.exp(-0.5 * ((x - r.gum.value) / r.gum.u) ** 2)) / (r.gum.u * Math.sqrt(2 * Math.PI)) : 0);
  const peakGum = r.gum.u > 0 ? gumPdf(r.gum.value) : 0;
  const ymax = Math.max(...counts, peakGum, 1);
  const W = 480;
  const H = 280;
  const left = 64;
  const right = 16;
  const top = 30;
  const bottom = 40;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const X = (x: number): number => left + ((x - a) / (b - a)) * plotW;
  const Y = (y: number): number => top + plotH - (y / ymax) * plotH;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="#1A1A1A">${esc(`Monte Carlo: ${label} (${fmtCount(n)} draws)`)}</text>`);
  counts.forEach((c, i) => {
    const x0 = X(a + i * w);
    const x1 = X(a + (i + 1) * w);
    parts.push(`<rect x="${(x0 + 0.5).toFixed(1)}" y="${Y(c).toFixed(1)}" width="${Math.max(0.5, x1 - x0 - 1).toFixed(1)}" height="${(top + plotH - Y(c)).toFixed(1)}" fill="#9DB3C4"/>`);
  });
  if (r.gum.u > 0) {
    const pts: string[] = [];
    for (let k = 0; k <= 120; k++) {
      const x = a + ((b - a) * k) / 120;
      pts.push(`${X(x).toFixed(1)},${Y(gumPdf(x)).toFixed(1)}`);
    }
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#B91C1C" stroke-width="1.5"/>`);
  }
  const vline = (x: number, dash: boolean, color: string): void => {
    if (x < a || x > b) return;
    parts.push(`<line x1="${X(x).toFixed(1)}" y1="${top}" x2="${X(x).toFixed(1)}" y2="${top + plotH}" stroke="${color}" stroke-width="1.2"${dash ? ' stroke-dasharray="4 3"' : ""}/>`);
  };
  vline(r.lo, true, "#0C4A6E");
  vline(r.hi, true, "#0C4A6E");
  vline(r.mean, false, "#0C4A6E");
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#1A1A1A"/>`);
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#1A1A1A"/>`);
  const xRow = linearAxis(a, b, { target: 6 });
  xRow.values.forEach((v, i) => {
    parts.push(`<text x="${X(v).toFixed(1)}" y="${top + plotH + 14}" text-anchor="middle" fill="#1A1A1A">${xRow.labels[i]}</text>`);
  });
  const yRow = linearAxis(0, ymax, { target: 5 });
  yRow.values.forEach((v, i) => {
    parts.push(`<text x="${left - 4}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="#7B8C99">${yRow.labels[i]}</text>`);
  });
  const xTitle = `${label}${xRow.multiplier ? ` (${xRow.multiplier})` : ""}`;
  const yTitle = `draws per bin${yRow.multiplier ? ` (${yRow.multiplier})` : ""}`;
  parts.push(`<text x="${left + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#7B8C99">${esc(xTitle)}</text>`);
  parts.push(`<text x="12" y="${top + plotH / 2}" text-anchor="middle" fill="#7B8C99" transform="rotate(-90 12 ${top + plotH / 2})">${esc(yTitle)}</text>`);
  // Legend.
  parts.push(`<rect x="${W - right - 150}" y="${top + 2}" width="10" height="10" fill="#9DB3C4"/><text x="${W - right - 136}" y="${top + 11}" fill="#1A1A1A">draws</text>`);
  if (r.gum.u > 0) parts.push(`<line x1="${W - right - 150}" y1="${top + 23}" x2="${W - right - 140}" y2="${top + 23}" stroke="#B91C1C" stroke-width="1.5"/><text x="${W - right - 136}" y="${top + 27}" fill="#1A1A1A">GUM normal</text>`);
  parts.push(`<line x1="${W - right - 150}" y1="${top + 39}" x2="${W - right - 140}" y2="${top + 39}" stroke="#0C4A6E" stroke-dasharray="4 3"/><text x="${W - right - 136}" y="${top + 43}" fill="#1A1A1A">95 % interval</text>`);
  if (outside) parts.push(`<text x="${left + 4}" y="${top + 11}" fill="#7B8C99">${esc(`${fmtCount(outside)} draws beyond the plotted 99.8 %`)}</text>`);
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Reading the question.
// ---------------------------------------------------------------------------

/** A typed number: decimal, e-notation, or m×10^n / m×10ⁿ (1.5×10^3, 1.5 x 10³). */
const NUM = String.raw`[-+−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+−]?\d+|\s*[×xX*·]\s*10\s*(?:\^\s*\(?\s*[-+−]?\d+\s*\)?|[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))?`;
const NUM_PARTS = new RegExp(
  "^" + String.raw`([-+−]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([-+−]?\d+)|\s*[×xX*·]\s*10\s*(?:\^\s*\(?\s*([-+−]?\d+)\s*\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?` + "$",
);
const SUP_DIGIT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "" };

/** A typed number's value and its typeset spelling (1e6 → 1×10⁶, −2 with U+2212). */
function readNum(t: string): { value: number; shown: string } | null {
  const m = NUM_PARTS.exec(t.trim());
  if (!m) return null;
  const neg = m[1] === "-" || m[1] === "−";
  const expText = m[3] ?? m[4] ?? (m[5] ? [...m[5]].map((c) => SUP_DIGIT[c] ?? "").join("") : undefined);
  const exp = expText === undefined ? null : parseInt(expText.replace("−", "-"), 10);
  const value = Number(`${neg ? "-" : ""}${m[2]}${exp !== null ? `e${exp}` : ""}`);
  return { value, shown: `${neg ? MINUS : ""}${m[2]}${exp !== null ? timesTen(exp) : ""}` };
}

/** A unit word after a value or an uncertainty — dropped (units are not carried), and said so. */
const UNIT_WORD = String.raw`(?!(?:and|with|where|given|samples|draws|trials|seed)\b)[A-Za-zµμΩ°][A-Za-z0-9µμΩ°\/^·²³⁻¹⁰⁴⁵⁶⁷⁸⁹]*(?![A-Za-z0-9_])(?!\s*=)`;
/** "a = 10.0 ± 0.1" or a constant "k = 2", ending at a separator, the next assignment, or an option. */
const ASSIGN_START = new RegExp(
  String.raw`(?:^|[\s,;:])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*` +
    NUM +
    String.raw`\s*(?:(?:±|\+\/-|\+-)\s*` +
    NUM +
    String.raw`\s*%?\s*)?(?:` +
    UNIT_WORD +
    String.raw`\s*)?(?=$|[,;\n]|\s+(?:and\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=|\s+(?:with\s+)?(?:samples|draws|trials|seed)\b)`,
);
/** One input piece, whole. */
const PIECE = new RegExp(
  String.raw`^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(` +
    NUM +
    String.raw`)\s*(?:(?:±|\+\/-|\+-)\s*(` +
    NUM +
    String.raw`)\s*(%)?)?\s*(` +
    UNIT_WORD +
    String.raw`)?\s*$`,
);

const TITLE = "Monte Carlo uncertainty propagation";
const refuse = (why: string, extra: string[] = []): VerbResult => ({ title: TITLE, lines: [], caveats: [why, ...extra] });

/** Pulls "samples 20000" / "N draws" / "seed 7" out of the text. */
function readOptions(s: string): { rest: string; samples?: number; seed?: number; problem?: string } {
  let rest = s;
  let samples: number | undefined;
  let seed: number | undefined;
  // The power forms first: "10^7" must not stop at "10".
  const count = String.raw`(10\s*\^\s*\d+|10[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d+(?:\.\d+)?(?:[eE]\+?\d+)?)`;
  const readCount = (t: string): number => {
    const p = /^10\s*\^\s*(\d+)$/.exec(t) ?? /^10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t);
    if (p) return Math.pow(10, Number([...p[1]].map((c) => SUP_DIGIT[c] ?? c).join("")));
    return Number(t);
  };
  const m1 = new RegExp(String.raw`[,;]?\s*(?:with\s+)?(?:samples|draws|trials)\s*(?:=|:)?\s*` + count, "i").exec(rest) ??
    new RegExp(String.raw`[,;]?\s*(?:with\s+)?` + count + String.raw`\s*(?:samples|draws|trials)\b`, "i").exec(rest);
  if (m1) {
    samples = readCount(m1[1]);
    rest = rest.slice(0, m1.index) + " " + rest.slice(m1.index + m1[0].length);
  }
  const m2 = /[,;]?\s*(?:with\s+)?seed\s*(?:=|:)?\s*(\S+)/i.exec(rest);
  if (m2) {
    const t = m2[1].replace(/[,;.]$/, "");
    if (!/^\d+$/.test(t)) return { rest, problem: `The seed must be a whole number from 0 to ${fmtCount(MC_MAX_SEED)}; “${m2[1]}” is not one.` };
    seed = Number(t);
    if (!(seed <= MC_MAX_SEED)) {
      return { rest, problem: `The seed must be a whole number from 0 to ${fmtCount(MC_MAX_SEED)} (the generator's 32-bit state); ${t} is beyond that, and would repeat a smaller seed.` };
    }
    rest = rest.slice(0, m2.index) + " " + rest.slice(m2.index + m2[0].length);
  }
  return { rest, samples, seed };
}

/** A thousands separator or decimal comma in a number, named (a comma separates the inputs here). */
function commaProblem(s: string): string | null {
  const m = /(?:=|±|\+\/-|\+-|\b(?:samples|draws|trials|seed)\b)\s*[:=]?\s*[-+−]?(\d+(?:,\d+)+)(\.\d+)?/i.exec(s);
  if (!m) return null;
  const groups = m[1].split(",");
  const text = m[1] + (m[2] ?? "");
  if (groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3)) {
    return `“${text}”: write ${groups.join("")}${m[2] ?? ""} without the comma: a comma separates the inputs here, so a thousands separator cannot be read (for a decimal comma, write ${groups[0]}.${groups.slice(1).join("")}).`;
  }
  return `“${text}” has a decimal comma: write ${groups[0]}.${groups.slice(1).join("")} with a point (a comma separates the inputs here).`;
}

/**
 * The formula as displayed: e-notation typeset, ^ drawn caret-free — a
 * whole-number power as superscripts (V² , a⁻¹), any other power as
 * pow(base, exponent), which the formula grammar also reads — · for *, U+2212.
 */
export function mcDisplayFormula(text: string): string {
  let s = text.replace(/−/g, "-").replace(/(^|[^A-Za-z0-9_.])(\d+(?:\.\d*)?|\.\d+)[eE]([-+−]?\d+)/g, (_m, pre: string, mant: string, ex: string) => `${pre}${mant}${timesTen(parseInt(ex.replace("−", "-"), 10))}`);
  s = s.replace(/\*\*/g, "^").replace(/\s*\^\s*/g, "^");
  // Right-associative: the LAST caret first, so a^b^c is a^(b^c).
  for (let guard = 0; guard < 200; guard++) {
    const p = s.lastIndexOf("^");
    if (p < 0) break;
    const end = operandEnd(s, p + 1);
    const start = baseStart(s, p);
    if (end < 0 || start < 0) break;
    const base = s.slice(start, p);
    let ex = s.slice(p + 1, end);
    const int = /^\(?\s*([-+−]?\d+)\s*\)?$/.exec(ex);
    let rep: string;
    if (int && (ex.startsWith("(") === ex.endsWith(")"))) {
      rep = `${base}${superscript(parseInt(int[1].replace("−", "-").replace("+", ""), 10))}`;
    } else {
      if (ex.startsWith("(") && closeParen(ex, 0) === ex.length - 1) ex = ex.slice(1, -1);
      rep = `pow(${base}, ${ex})`;
    }
    s = s.slice(0, start) + rep + s.slice(end);
  }
  // A caret that could not be drawn (a^(b, unbalanced) is said in words.
  return s.replace(/\^/g, " to the power ").replace(/\*/g, "·").replace(/-/g, MINUS);
}

/**
 * What more draws could do for a "noise" verdict. The endpoints still beyond
 * δ (but within 3 standard errors of it) decide; the standard error falls as
 * 1/√N, so N·(3·se / |d − δ|)² draws (with 1.5× margin) resolve each. Advised
 * only when that fits under this formula's cap; otherwise said honestly.
 */
export function noiseAdvice(r: McResult, nUncertain: number): string {
  const cap = plannedSamples(MC_MAX_SAMPLES, r.expr.replace(/\s+/g, "").length, nUncertain, r.compiled, true);
  let need = 0;
  for (const [d, se] of [
    [r.dLow, r.seLow],
    [r.dHigh, r.seHigh],
  ]) {
    if (d <= r.delta) continue;
    const gap = d - r.delta;
    need = Math.max(need, se > 0 ? 1.5 * r.samples * ((3 * se) / gap) ** 2 : Infinity);
  }
  if (!(need > r.samples)) return "";
  if (need <= cap) {
    // Rounded UP to two significant figures, and never past the cap.
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(need)) - 1));
    const n = Math.min(cap, Math.ceil(need / p) * p);
    return ` Ask for more draws (“samples ${n}”) to decide.`;
  }
  if (r.samples >= cap) {
    return ` This is the most draws this runs for this formula (${fmtCount(cap)}), and the difference from δ is still inside their noise: it cannot be settled here.`;
  }
  // No forecast: if the formula truly agrees, the excess is noise and shrinks.
  return ` Ask for more draws (“samples ${cap}”, the most this runs for this formula) to narrow it.`;
}

/**
 * The Monte Carlo verb. Pass the RAW Solve input. Null unless the line says
 * "monte carlo" — then it answers or refuses by name.
 */
export function tryMonteCarlo(raw: string): VerbResult | null {
  if (!isMonteCarloRequest(raw)) return null;
  if (raw.length > 4000) return refuse("That is too long for one Monte Carlo question — one formula and its inputs.");
  const body0 = raw.replace(/^[\s\S]*?\bmonte[\s-]?carlo\b/i, "").replace(/^\s*(?:uncertainty\s+)?(?:propagation|simulation|method)?\s*(?:of|for|on)?\s*[:,]?\s*/i, "");
  if (/\b(?:integral|integrate|integration|pi\s+estimate|estimate\s+pi)\b/i.test(raw)) {
    return refuse("Monte Carlo here PROPAGATES UNCERTAINTY through a formula (“monte carlo a*b/c a = 10.0 ± 0.1, …”). For an integral, use the Integral kind.");
  }
  if (/\bcorrelat/i.test(raw)) return refuse("Correlated inputs are not supported: every input is drawn independently. Remove the correlation, or propagate it by hand with the covariance.");
  const comma = commaProblem(body0.replace(SPACE_LIKE, " "));
  if (comma) return refuse(comma);
  const opt = readOptions(body0.replace(SPACE_LIKE, " "));
  if (opt.problem) return refuse(opt.problem);
  const body = opt.rest;
  const first = ASSIGN_START.exec(body);
  if (!first) {
    return refuse("Give the formula and then each input as name = value ± uncertainty, e.g. “monte carlo a*b/c a = 10.0 ± 0.1, b = 4.00 ± 0.05, c = 2.0 ± 0.1”.");
  }
  const at = first.index + (first[0].length - first[0].replace(/^[\s,;:]/, "").length);
  let exprText = body.slice(0, at).trim().replace(/[,;:]\s*$/, "").replace(/\s+(?:with|where|given)\s*$/i, "").trim();
  let label = "y";
  const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(exprText);
  if (named) {
    label = named[1];
    exprText = named[2].trim();
  }
  if (!exprText) return refuse("There is no formula before the inputs — write it first: “monte carlo a*b/c a = …”.");
  // The inputs: split on , ; newline and "and".
  const tail = body.slice(at);
  const pieces = tail.split(/[,;\n]|\s+and\s+|\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*=)/).map((p) => p.trim()).filter(Boolean);
  const inputs: McInput[] = [];
  const shownIn: string[] = [];
  const dropped: string[] = [];
  const steps: string[] = [];
  for (const p of pieces) {
    const m = PIECE.exec(p);
    if (!m) {
      return refuse(
        /±|\+\/-|\+-/.test(p)
          ? `Could not read “${p}”. Expected an input like “a = 10.0 ± 0.1” (a value, ±, and a standard uncertainty).`
          : `Could not read “${p}”. Expected an input like “a = 10.0 ± 0.1” (or an exact constant “k = 2”).`,
      );
    }
    const name = m[1];
    const v = readNum(m[2])!;
    if (!Number.isFinite(v.value)) return refuse(`“${name}” has a value that is not a finite number.`);
    if (m[5]) dropped.push(`“${m[5]}” after ${name}`);
    if (m[3] === undefined) {
      inputs.push({ name, value: v.value, u: 0 });
      shownIn.push(`${name} = ${v.shown} (exact)`);
      continue;
    }
    const uu = readNum(m[3])!;
    if (!Number.isFinite(uu.value)) return refuse(`“${name}” has an uncertainty that is not a finite number.`);
    if (uu.value < 0) return refuse(`“${name}” has a negative uncertainty (${uu.shown}). An uncertainty is a magnitude: write ${uu.shown.replace(/^−/, "")}.`);
    if (m[4]) {
      // A RELATIVE uncertainty: ± 5 % of the value.
      const u = (Math.abs(v.value) * uu.value) / 100;
      if (!(u > 0) && uu.value > 0) return refuse(`“${name}” = ${v.shown} ± ${uu.shown} %: a percentage of zero is zero, so give the uncertainty in the value's own units.`);
      inputs.push({ name, value: v.value, u });
      shownIn.push(`${name} = ${v.shown} ± ${uu.shown} % (± ${fmtNum(u, 6)})`);
    } else {
      inputs.push({ name, value: v.value, u: uu.value });
      shownIn.push(`${name} = ${v.shown} ± ${uu.shown}`);
    }
  }
  const seen = new Set<string>();
  for (const x of inputs) {
    if (seen.has(x.name)) return refuse(`“${x.name}” is given twice.`);
    seen.add(x.name);
  }
  if (!inputs.some((x) => x.u > 0)) return refuse("No input carries an uncertainty (value ± u), so there is nothing to propagate.");
  const e = mcNormalizeExpr(exprText);
  let r: McResult;
  try {
    r = monteCarlo(e, inputs, { samples: opt.samples, seed: opt.seed });
  } catch (err) {
    const msg = (err as Error).message;
    const unk = /Unknown variable "([^"]+)"/.exec(msg);
    if (unk) return refuse(`“${unk[1]}” appears in the formula but has no value — give it as ${unk[1]} = value ± uncertainty.`);
    return refuse(msg.startsWith("Unknown function") || /parse|Unexpected|Unbalanced/i.test(msg) ? `The formula “${mcDisplayFormula(exprText)}” could not be read: ${msg}` : msg);
  }
  const unused = inputs.filter((x) => !new RegExp(String.raw`(?:^|[^A-Za-z0-9_])` + x.name + String.raw`(?![A-Za-z0-9_])`).test(e));
  const display = mcDisplayFormula(exprText);
  const nUncertain = inputs.filter((x) => x.u > 0).length;
  // Monte Carlo figures at the place of the draws' sd; the GUM line at the
  // place of its own u — sharing one place made "10 ± 10" print as "0 ± 0".
  const mc = fmtShared([r.mean, r.sd, r.lo, r.hi], r.sd);
  const [mean, sd, lo, hi] = mc.texts;
  const gm = fmtShared([r.gum.value, r.gum.u, Z975 * r.gum.u], r.gum.u > 0 ? r.gum.u : r.sd);
  const [gv, gu, gU] = gm.texts;
  const wrap = (s: string, sfx: string): string => (sfx ? `${s}  (all ${sfx})` : s);
  const lines: { text: string }[] = [];
  lines.push({ text: `${label} = ${display}` });
  if (r.verdict === "constant") {
    // Only what was seen: the draws did not move. Why (a true cancellation,
    // a step function, an underflow) is not claimed.
    lines.push({
      text:
        `Every draw gives the same value: ${fmtNum(r.mean)}. The Monte Carlo spread is 0` +
        (r.gum.u === 0 ? ", and the first-order (GUM) uncertainty is 0 too." : `; the first-order (GUM) uncertainty is ${fmtNum(r.gum.u, 2)}, so the two cannot be compared here.`),
    });
  } else if (r.verdict === "unsettled") {
    const med = fmtShared([r.sorted[Math.floor((r.samples - 1) / 2)], r.lo, r.hi], Math.max(r.seHigh, r.seLow, Math.abs(r.hi - r.lo) / 100));
    lines.push({ text: wrap(`Monte Carlo: median ${med.texts[0]}, 95 % coverage interval [${med.texts[1]}, ${med.texts[2]}]`, med.suffix) });
    if (r.throughZero.length || r.nearZero.length) {
      const named = (ds: string[]): string => {
        const which = ds.map((d) => mcDisplayFormula(d.startsWith("(") && closeParen(d, 0) === d.length - 1 ? d.slice(1, -1) : d)).join(", ");
        return ds.length === 1 ? `a denominator (${which})` : `the denominators (${which})`;
      };
      const causes = [
        r.throughZero.length ? `the draws of ${named(r.throughZero)} pass through zero` : "",
        r.nearZero.length ? `the draws of ${named(r.nearZero)} come down to zero` : "",
      ].filter(Boolean);
      lines.push({
        text:
          `The mean and standard deviation do NOT settle: the two halves of the draws disagree on the spread, because ${causes.join(" and ")}. ` +
          "The output then has no finite variance, so neither a standard deviation nor the first-order (GUM) answer means anything here. The percentiles still do.",
      });
    } else {
      lines.push({
        text:
          "The mean and standard deviation settle slowly, if at all: the two halves of the draws disagree on the spread. The output is heavy-tailed (a few extreme draws dominate the variance), " +
          "so neither the standard deviation nor the first-order (GUM) answer is reliable here. The percentiles are.",
      });
    }
  } else {
    lines.push({ text: wrap(`Monte Carlo: mean ${mean}, standard deviation ${sd}`, mc.suffix) });
    lines.push({ text: wrap(`95 % coverage interval [${lo}, ${hi}]`, mc.suffix) });
    lines.push({ text: wrap(`First-order (GUM): ${gv} ± ${gu}  (95 %: ${gv} ± ${gU})`, gm.suffix) });
    const verdictText: Record<Exclude<McVerdict, "unsettled" | "constant">, string> = {
      agree: "The two AGREE: the GUM interval y ± 1.96u matches the Monte Carlo interval to within the numerical tolerance δ (JCGM 101:2008 §8) — the first-order result is validated.",
      noise:
        "The two agree to within the draws' own sampling noise — no sign of nonlinearity at this sample size — but not to within δ, which is finer than this run can resolve, so the first-order result is consistent but not formally validated." +
        noiseAdvice(r, nUncertain),
      disagree:
        "The two DISAGREE: the GUM interval y ± 1.96u misses the Monte Carlo interval by more than δ plus three standard errors of the draws — the formula is NONLINEAR over the input spread, so the first-order result is not validated. Use the Monte Carlo figures.",
      nogum: inputs.some((x) => x.u > 0 && x.u < 1e-150)
        ? "The first-order (GUM) uncertainty comes out ZERO here: with an uncertainty this small its squared terms fall below the smallest double, while the draws still spread. Use the Monte Carlo interval."
        : "The first-order (GUM) uncertainty is ZERO here — the formula's slope vanishes at the stated values — while the draws still spread: the linear method does not apply. Use the Monte Carlo interval.",
    };
    lines.push({ text: verdictText[r.verdict] });
  }
  steps.push(`Inputs (normal, standard deviation = the stated ±, drawn independently): ${shownIn.join(", ")}.`);
  const capped = r.samples < r.requested ? ` (capped from ${fmtCount(r.requested)} to keep Word responsive)` : "";
  steps.push(`${fmtCount(r.samples)} draws${capped}, seed ${r.seed} (splitmix32 + Box–Muller) — the same question always gives the same digits.`);
  const expo = (x: number): string => {
    if (x === 0) return "0";
    if (!Number.isFinite(x)) return "∞";
    let k = Math.floor(Math.log10(x));
    let m = (x / Math.pow(10, k)).toPrecision(2);
    if (Number(m) >= 10) {
      // 9.96 → "10": carry into the exponent (1.0×10ⁿ⁺¹).
      k += 1;
      m = (x / Math.pow(10, k)).toPrecision(2);
    }
    return `${m}${timesTen(k)}`;
  };
  if (r.verdict !== "unsettled" && r.verdict !== "nogum" && r.verdict !== "constant") {
    steps.push(
      `JCGM 101 §8 check: |y − U − y_low| = ${expo(r.dLow)} and |y + U − y_high| = ${expo(r.dHigh)} with U = 1.96u, against δ = ${expo(r.delta)} (half a unit in the second significant digit of u, rounded to two digits first); the endpoints' own sampling noise is about ${expo(Math.max(r.seLow, r.seHigh))}.`,
    );
    steps.push(`Mean minus f(input values): ${r.mean - r.gum.value < 0 ? MINUS : ""}${expo(Math.abs(r.mean - r.gum.value))} — a shift the first-order method cannot see (standard error of the mean ${expo(r.sd / Math.sqrt(r.samples))}).`);
  }
  for (const s of steps) lines.push({ text: s });
  const caveats = [
    "Each “value ± u” is read as a NORMAL input with standard deviation u (a standard uncertainty, 1σ), independent of the others; correlated inputs are not supported.",
    "The 95 % coverage interval is the 2.5th to 97.5th percentile of the sorted draws (order statistics at ranks ⌈0.025N⌉ and ⌈0.975N⌉) — probabilistically symmetric, not necessarily centred on the mean.",
    "Values are quoted to the decimal place of the second significant figure of their standard deviation (Monte Carlo) or of u (GUM).",
  ];
  if (r.samples < r.requested) caveats.push(`${fmtCount(r.samples)} draws (capped from ${fmtCount(r.requested)} to keep Word responsive).`);
  if (dropped.length) caveats.push(`Units are not carried: ${dropped.join(", ")} ${dropped.length === 1 ? "was" : "were"} dropped; the result is in whatever unit the formula gives.`);
  if (shownIn.some((s) => s.includes(" % ("))) caveats.push("“± p %” is a RELATIVE uncertainty: u = p % of the value's magnitude.");
  if (unused.length) caveats.push(`Not used by the formula: ${unused.map((x) => x.name).join(", ")}.`);
  return {
    title: TITLE,
    lines,
    caveats,
    svg: mcHistogramSvg(r, label),
    alt: `Histogram of ${fmtCount(r.samples)} Monte Carlo draws of ${label} = ${display}, with the first-order normal curve and the 95 % coverage interval.`,
  };
}
