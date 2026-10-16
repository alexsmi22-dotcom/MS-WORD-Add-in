// Radius (and interval) of convergence — AS A THEOREM, NEVER A READING.
//
// The Taylor series of f about c converges on the largest open disc around c
// on which f extends analytically, and on no larger disc (Cauchy–Taylor, then
// Cauchy–Hadamard). So the radius is the distance from c to the nearest
// SINGULARITY OF f IN ℂ — a structural fact about f, read from its formula:
//
//   * rational functions: the poles are the roots of the REDUCED denominator,
//     found exactly over ℚ (rational roots, quadratic pieces in surds) and,
//     for an irreducible piece of degree 3–8, numerically with the tolerance
//     said. 1/(1 + x²) has no real singularity and still has R = 1: its poles
//     are ±i. That is the trap every coefficient-staring method falls into.
//   * a table of elementary functions and the rule for composing them: log and
//     non-integer powers branch at the zeros of their argument; tan/sec have
//     poles at the zeros of cos; atan(u) at u = ±i; asin/acos at u = ±1; exp,
//     sin, cos, sinh, cosh are entire; x/(eˣ − 1) has its removable point at 0
//     and poles at ±2πi, so R = 2π.
//   * an explicit general term Σ aₙ(x − c)ⁿ: the ratio test computed EXACTLY on
//     the structure of aₙ (rational in n × geometric × factorial), never on a
//     table of numbers.
//
// NOT READING THE COEFFICIENTS IS THE POINT. Even with 40 exact coefficients the
// root test reads 1.097 for ln(1 + x) and 0.911 for 1/(1 − x)². Anything outside
// the rules is REFUSED BY NAME rather than estimated.
//
// SOUNDNESS OF EACH STEP. Every rule returns a SUPERSET of the singular points
// (so the minimum distance is always a valid lower bound) and marks a point as
// `sure` only when it is PROVED to be a singularity (a pole that no numerator
// zero cancels, a branch point of odd order, a log point). The radius is printed
// as an equality only when the nearest point is sure; otherwise it is printed
// as "R ≥ d". A numerator zero is only ever established EXACTLY — at a rational
// point by exact evaluation (sin 0 = 0; sin r ≠ 0 for rational r ≠ 0, by
// Lindemann), at an algebraic point by polynomial divisibility — never by a
// floating-point "close to zero".
//
// Endpoints of the real interval are decided only by a named theorem (the
// divergence test, p-series, the alternating series test, the binomial series,
// the logarithm's alternating harmonic series); otherwise they are said to be
// undetermined.

import { parseExpr, format, derivative, Expr } from "./solve";
import {
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratToNumber,
  ratSign, ratEq, parseRatLiteral, ratFunctionInVar, ratPolyTrim, ratPolyDivMod,
  ratPolyMul, ratPolyAdd, RAT_ZERO, RAT_ONE,
} from "./cas";
import type { VerbResult } from "./algebraTools";

// ---------------------------------------------------------------------------
// Caps — every one checked BEFORE the work it bounds.
// ---------------------------------------------------------------------------

/** Longest input text accepted. */
const MAX_INPUT = 400;
/** Most parenthesis nesting accepted (the parser and every walker recurse). */
const MAX_NESTING = 40;
/** Most expression nodes accepted. */
const MAX_NODES = 400;
/** Highest polynomial degree whose roots are located (the scope's cap). */
export const RADIUS_MAX_DEGREE = 8;
/** Largest coefficient (numerator or denominator) accepted, in bits. */
const MAX_COEFF_BITS = 512;
/** Highest order of a zero examined when deciding removability. */
const MAX_ORDER_TEST = 6;
/** A derivative tree larger than this is not evaluated (order left undecided). */
const MAX_DERIV_NODES = 4000;

/** A refusal by name: carried up through the analysis and reported verbatim. */
class RadiusRefusal extends Error {}
const refuse = (why: string): never => {
  throw new RadiusRefusal(why);
};

// ---------------------------------------------------------------------------
// Small exact helpers
// ---------------------------------------------------------------------------

const fmtRat = (q: Rat): string => (q.d === 1n ? q.n.toString() : `${q.n.toString()}/${q.d.toString()}`);
const ratAbs = (q: Rat): Rat => (ratSign(q) < 0 ? ratNeg(q) : q);
const bAbs = (v: bigint): bigint => (v < 0n ? -v : v);
const bGcd = (a: bigint, b: bigint): bigint => {
  a = bAbs(a);
  b = bAbs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const bits = (v: bigint): number => bAbs(v).toString(2).length;

/** A number literal as an exact rational: 0.1 is 1/10, not the nearest double. */
function numRat(v: number): Rat | null {
  if (!Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return ratInt(BigInt(v));
  return parseRatLiteral(String(v));
}

/** Exact rational value of a constant expression, or null when it is not rational. */
function constRat(e: Expr): Rat | null {
  switch (e.t) {
    case "num": return numRat(e.v);
    case "neg": { const a = constRat(e.e); return a && ratNeg(a); }
    case "add": case "sub": case "mul": case "div": {
      const a = constRat(e.l), b = constRat(e.r);
      if (!a || !b) return null;
      if (e.t === "add") return ratAdd(a, b);
      if (e.t === "sub") return ratSub(a, b);
      if (e.t === "mul") return ratMul(a, b);
      return ratIsZero(b) ? null : ratDiv(a, b);
    }
    case "pow": {
      const a = constRat(e.l), b = constRat(e.r);
      if (!a || !b || b.d !== 1n || bAbs(b.n) > 64n) return null;
      return ratPowInt(a, Number(b.n));
    }
    default: return null;
  }
}

function ratPowInt(a: Rat, k: number): Rat | null {
  // Bit cap before the work: nested powers of a constant grow as a tower.
  if ((bits(a.n) + bits(a.d)) * Math.abs(k) > 8192) return null;
  if (k < 0) {
    if (ratIsZero(a)) return null;
    const p = ratPowInt(a, -k);
    return p && ratDiv(RAT_ONE, p);
  }
  let out = RAT_ONE;
  for (let i = 0; i < k; i++) out = ratMul(out, a);
  return out;
}

/** √q for a non-negative rational, as a re-parseable string ("sqrt(3)/2", "2", "2*sqrt(2)"). */
function sqrtRatStr(q: Rat): { str: string; rat?: Rat } {
  if (ratIsZero(q)) return { str: "0", rat: RAT_ZERO };
  // √(n/d) = √(n·d)/d, then pull the square part out of n·d.
  let m = q.n * q.d;
  let k = 1n;
  // Bounded trial division: what is not pulled out stays (correctly) under the root.
  for (let p = 2n; p * p <= m && p < 100000n; p++) {
    while (m % (p * p) === 0n) {
      m /= p * p;
      k *= p;
    }
  }
  let den = q.d;
  const g = bGcd(k, den);
  k /= g;
  den /= g;
  if (m === 1n) {
    const r = ratMake(k, den);
    return { str: fmtRat(r), rat: r };
  }
  const core = `sqrt(${m.toString()})`;
  const kS = k === 1n ? core : `${k.toString()}*${core}`;
  return { str: den === 1n ? kS : `${kS}/${den.toString()}` };
}

/** A + B·π as a re-parseable string, any signs ("pi/2", "pi/2 - 1", "-3*pi/2 + 1"). */
function fmtLinPi(A: Rat, B: Rat): string {
  const piMag = (b: Rat): string => {
    const n = bAbs(b.n), d = b.d;
    const num = n === 1n ? "pi" : `${n.toString()}*pi`;
    return d === 1n ? num : `${num}/${d.toString()}`;
  };
  if (ratIsZero(B)) return fmtRat(A);
  const pi = (ratSign(B) < 0 ? "-" : "") + piMag(B);
  if (ratIsZero(A)) return pi;
  return `${pi} ${ratSign(A) < 0 ? "-" : "+"} ${fmtRat(ratAbs(A))}`;
}

/** Wraps a compound display in parentheses before it is negated or added to. */
const paren = (s: string): string => (/[ +]/.test(s.replace(/^-/, "")) || /.-/.test(s) ? `(${s})` : s);

/** |x − c| written the way a reader writes it: |x|, |x - 3|, |x + 1/2|. */
const absDiff = (x: string, c: Rat): string =>
  ratIsZero(c) ? `|${x}|` : `|${x} ${ratSign(c) < 0 ? "+" : "-"} ${fmtRat(ratAbs(c))}|`;

const sig = (v: number, d = 10): string => {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(Number(v.toPrecision(d)));
};

// ---------------------------------------------------------------------------
// Expression helpers
// ---------------------------------------------------------------------------

function countNodes(e: Expr): number {
  switch (e.t) {
    case "num": case "var": return 1;
    case "neg": return 1 + countNodes(e.e);
    case "fn": return 1 + countNodes(e.arg);
    default: return 1 + countNodes(e.l) + countNodes(e.r);
  }
}

function hasVar(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num": return false;
    case "var": return e.name === x;
    case "neg": return hasVar(e.e, x);
    case "fn": return hasVar(e.arg, x);
    default: return hasVar(e.l, x) || hasVar(e.r, x);
  }
}

function freeVars(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case "num": break;
    case "var": out.add(e.name); break;
    case "neg": freeVars(e.e, out); break;
    case "fn": freeVars(e.arg, out); break;
    default: freeVars(e.l, out); freeVars(e.r, out);
  }
  return out;
}

function fnNames(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case "num": case "var": break;
    case "neg": fnNames(e.e, out); break;
    case "fn": out.add(e.name); fnNames(e.arg, out); break;
    default: fnNames(e.l, out); fnNames(e.r, out);
  }
  return out;
}

/**
 * Purely rational structure in x: numbers, x, + − × ÷ and INTEGER powers.
 *
 * Checked BEFORE ratFunctionInVar, because the canonicaliser folds a function
 * of a constant (sqrt(3), pi) into a float-derived rational — a pole "found
 * exactly" at the double nearest 2·√3 would be a fabrication.
 */
function isRationalStructure(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num": return Number.isFinite(e.v);
    case "var": return e.name === x;
    case "neg": return isRationalStructure(e.e, x);
    case "add": case "sub": case "mul": case "div":
      return isRationalStructure(e.l, x) && isRationalStructure(e.r, x);
    case "pow": {
      const k = constRat(e.r);
      return !!k && k.d === 1n && bAbs(k.n) <= 64n && isRationalStructure(e.l, x);
    }
    default: return false;
  }
}

/** e as an exact rational function of x with GCD-reduced numerator and denominator. */
function reducedRational(e: Expr, x: string): { num: Rat[]; den: Rat[] } | null {
  if (!isRationalStructure(e, x)) return null;
  // Bound the degree BEFORE expanding: ((x+1)^64)^64 is a few nodes and an
  // expansion of degree 4096 — a clamp on node count does not bound the time.
  if (degreeBound(e, x) > MAX_EXPAND_DEGREE) {
    refuse(`${format(e)} expands past degree ${MAX_EXPAND_DEGREE} — past the cap for exact rational work.`);
  }
  const rf = ratFunctionInVar(e, x);
  if (!rf) return null;
  checkCoeffs(rf.num);
  checkCoeffs(rf.den);
  const g = polyGcd(rf.num, rf.den);
  if (g.length > 1) {
    return { num: ratPolyDivMod(rf.num, g).q, den: ratPolyDivMod(rf.den, g).q };
  }
  return { num: ratPolyTrim(rf.num), den: ratPolyTrim(rf.den) };
}

/** Largest degree an expression may expand to before the rational path refuses. */
const MAX_EXPAND_DEGREE = 128;

/** An upper bound on the degree (numerator + denominator) a rational structure expands to. */
function degreeBound(e: Expr, x: string): number {
  switch (e.t) {
    case "num": return 0;
    case "var": return e.name === x ? 1 : 0;
    case "neg": return degreeBound(e.e, x);
    case "add": case "sub": return degreeBound(e.l, x) + degreeBound(e.r, x);
    case "mul": case "div": return degreeBound(e.l, x) + degreeBound(e.r, x);
    case "pow": {
      const k = constRat(e.r);
      return k ? Math.abs(Number(k.n)) * degreeBound(e.l, x) : Infinity;
    }
    default: return Infinity;
  }
}

function checkCoeffs(p: Rat[]): void {
  for (const c of p) {
    if (bits(c.n) > MAX_COEFF_BITS || bits(c.d) > MAX_COEFF_BITS) {
      refuse(`a coefficient exceeds ${MAX_COEFF_BITS} bits — past the cap for locating poles exactly.`);
    }
  }
}

/** The linear form a·x + b of u, when u is exactly that with rational a ≠ 0. */
function linearIn(u: Expr, x: string): { a: Rat; b: Rat } | null {
  const rf = reducedRational(u, x);
  if (!rf || rf.den.length !== 1 || rf.num.length !== 2) return null;
  const d0 = rf.den[0];
  return { a: ratDiv(rf.num[1], d0), b: ratDiv(rf.num[0], d0) };
}

// ---------------------------------------------------------------------------
// Exact polynomial algebra over ℚ (ascending coefficients)
// ---------------------------------------------------------------------------

function polyMonic(p: Rat[]): Rat[] {
  const t = ratPolyTrim(p);
  if (!t.length) return t;
  const lead = t[t.length - 1];
  return t.map((c) => ratDiv(c, lead));
}

function polyGcd(a: Rat[], b: Rat[]): Rat[] {
  let x = ratPolyTrim(a), y = ratPolyTrim(b);
  if (!x.length) return polyMonic(y);
  if (!y.length) return polyMonic(x);
  let guard = 0;
  while (y.length && guard++ < 200) {
    const r = ratPolyDivMod(x, y).r;
    x = y;
    y = r;
  }
  return polyMonic(x);
}

function polyDeriv(p: Rat[]): Rat[] {
  const out: Rat[] = [];
  for (let i = 1; i < p.length; i++) out.push(ratMul(p[i], ratInt(i)));
  return ratPolyTrim(out);
}

/** Yun's square-free decomposition: [piece, multiplicity], pieces square-free and coprime. */
function squareFree(p: Rat[]): { piece: Rat[]; mult: number }[] {
  const f = polyMonic(p);
  const out: { piece: Rat[]; mult: number }[] = [];
  if (f.length < 2) return out;
  const fp = polyDeriv(f);
  const a0 = polyGcd(f, fp);
  let b = ratPolyDivMod(f, a0).q;
  let c = ratPolyDivMod(fp, a0).q;
  let d = ratPolyAdd(c, polyDeriv(b).map(ratNeg));
  let i = 1;
  while (b.length > 1 && i <= 64) {
    const a = polyGcd(b, d);
    if (a.length > 1) out.push({ piece: a, mult: i });
    b = ratPolyDivMod(b, a).q;
    c = ratPolyDivMod(d, a).q;
    d = ratPolyAdd(c, polyDeriv(b).map(ratNeg));
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Complex arithmetic (numeric) — for locating roots and for NONZERO checks only
// ---------------------------------------------------------------------------

type C = [number, number];
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cabs = (a: C): number => Math.hypot(a[0], a[1]);
const cexp = (a: C): C => { const m = Math.exp(a[0]); return [m * Math.cos(a[1]), m * Math.sin(a[1])]; };
const clog = (a: C): C => [Math.log(cabs(a)), Math.atan2(a[1], a[0])];
const csqrt = (a: C): C => {
  const r = cabs(a);
  const re = Math.sqrt((r + a[0]) / 2);
  const im = Math.sqrt(Math.max(0, (r - a[0]) / 2));
  return [re, a[1] < 0 ? -im : im];
};
const csin = (a: C): C => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
const ccos = (a: C): C => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
const I: C = [0, 1];
const ONE: C = [1, 0];

/** Numeric value of e at the complex point z; null when not evaluable. */
function cEval(e: Expr, x: string, z: C): C | null {
  const rec = (n: Expr): C | null => {
    switch (n.t) {
      case "num": return [n.v, 0];
      case "var":
        if (n.name === x) return z;
        if (n.name === "pi") return [Math.PI, 0];
        if (n.name === "e") return [Math.E, 0];
        return null;
      case "neg": { const a = rec(n.e); return a && [-a[0], -a[1]]; }
      case "add": case "sub": case "mul": case "div": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        if (n.t === "add") return cadd(a, b);
        if (n.t === "sub") return csub(a, b);
        if (n.t === "mul") return cmul(a, b);
        return cdiv(a, b);
      }
      case "pow": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        if (b[1] === 0 && Number.isInteger(b[0]) && Math.abs(b[0]) <= 64) {
          let out: C = ONE;
          for (let i = 0; i < Math.abs(b[0]); i++) out = cmul(out, a);
          return b[0] < 0 ? cdiv(ONE, out) : out;
        }
        if (a[0] === 0 && a[1] === 0) return [0, 0];
        return cexp(cmul(b, clog(a)));
      }
      case "fn": {
        const a = rec(n.arg);
        if (!a) return null;
        switch (n.name) {
          case "exp": return cexp(a);
          case "ln": return clog(a);
          case "log": case "log10": { const l = clog(a); return [l[0] / Math.LN10, l[1] / Math.LN10]; }
          case "log2": { const l = clog(a); return [l[0] / Math.LN2, l[1] / Math.LN2]; }
          case "sqrt": return csqrt(a);
          case "cbrt": return a[1] === 0 ? [Math.cbrt(a[0]), 0] : cexp(cmul([1 / 3, 0], clog(a)));
          case "sin": return csin(a);
          case "cos": return ccos(a);
          case "tan": return cdiv(csin(a), ccos(a));
          case "sec": return cdiv(ONE, ccos(a));
          case "csc": return cdiv(ONE, csin(a));
          case "cot": return cdiv(ccos(a), csin(a));
          case "sinh": { const p = cexp(a), q = cexp([-a[0], -a[1]]); return [(p[0] - q[0]) / 2, (p[1] - q[1]) / 2]; }
          case "cosh": { const p = cexp(a), q = cexp([-a[0], -a[1]]); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
          case "tanh": { const p = cexp(a), q = cexp([-a[0], -a[1]]); return cdiv(csub(p, q), cadd(p, q)); }
          case "atan": { // (i/2)·log((1 − i a)/(1 + i a))
            const ia = cmul(I, a);
            const l = clog(cdiv(csub(ONE, ia), cadd(ONE, ia)));
            return cmul([0, 0.5], l);
          }
          case "asin": { // −i·log(i a + √(1 − a²))
            const l = clog(cadd(cmul(I, a), csqrt(csub(ONE, cmul(a, a)))));
            return cmul([0, -1], l);
          }
          case "acos": { // π/2 − asin a
            const l = clog(cadd(cmul(I, a), csqrt(csub(ONE, cmul(a, a)))));
            const as = cmul([0, -1], l);
            return [Math.PI / 2 - as[0], -as[1]];
          }
          default: return null;
        }
      }
    }
  };
  const v = rec(e);
  return v && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : null;
}

/** All complex roots of a SQUARE-FREE polynomial, Durand–Kerner then Newton-polished. */
function numericRoots(p: Rat[]): C[] {
  const m = polyMonic(p).map(ratToNumber);
  const n = m.length - 1;
  const evalP = (z: C): C => {
    let acc: C = [0, 0];
    for (let i = n; i >= 0; i--) acc = cadd(cmul(acc, z), [m[i], 0]);
    return acc;
  };
  const evalD = (z: C): C => {
    let acc: C = [0, 0];
    for (let i = n; i >= 1; i--) acc = cadd(cmul(acc, z), [m[i] * i, 0]);
    return acc;
  };
  // Cauchy bound for the starting circle.
  let bound = 0;
  for (let i = 0; i < n; i++) bound = Math.max(bound, Math.abs(m[i]));
  const rad = 1 + bound;
  let zs: C[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n + 0.4;
    zs.push([rad * 0.5 * Math.cos(t), rad * 0.5 * Math.sin(t)]);
  }
  for (let it = 0; it < 800; it++) {
    let move = 0;
    const next = zs.map((z, i) => {
      let den: C = ONE;
      zs.forEach((w, j) => { if (j !== i) den = cmul(den, csub(z, w)); });
      const step = cdiv(evalP(z), den);
      move = Math.max(move, cabs(step) / Math.max(1, cabs(z)));
      return csub(z, step);
    });
    zs = next;
    if (move < 1e-15) break;
  }
  // Newton polish: square-free, so every root is simple.
  zs = zs.map((z) => {
    for (let k = 0; k < 3; k++) {
      const d = evalD(z);
      if (cabs(d) === 0) break;
      z = csub(z, cdiv(evalP(z), d));
    }
    return z;
  });
  return zs;
}

// ---------------------------------------------------------------------------
// Singular points
// ---------------------------------------------------------------------------

export type SingKind = "pole" | "branch point" | "essential singularity" | "singularity";

/** A candidate singular point of f in ℂ, measured from the centre. */
export interface Singularity {
  re: number;
  im: number;
  /** |z − c|. */
  dist: number;
  /** The distance in exact, re-parseable form, when it has one. */
  distExact?: string;
  /** How the point is written: "x = -1", "x = ±i", "x = pi/2". */
  point: string;
  kind: SingKind;
  /** PROVED to be a singularity (not merely a candidate that might cancel). */
  sure: boolean;
  /** Exact metadata for removability tests. */
  rat?: Rat;
  transcendental?: boolean;
  factor?: Rat[];
  /** The point is exactly q·π (real), for exact evaluation of sin/cos there. */
  piq?: Rat;
}

interface Zero extends Singularity {
  /** Order of the zero. */
  order: number;
}

interface Ctx {
  x: string;
  c: Rat;
  cn: number;
  /** Points shown to be removable, for the explanation. */
  removable: string[];
  /** Notes such as "even-order zero: not a branch point". */
  notes: string[];
  caveats: string[];
  budget: number;
}

const samePoint = (a: { re: number; im: number }, b: { re: number; im: number }): boolean =>
  Math.abs(a.re - b.re) + Math.abs(a.im - b.im) <= 1e-9 * (1 + Math.hypot(a.re, a.im));

const tick = (ctx: Ctx): void => {
  if (--ctx.budget < 0) refuse("the analysis exceeded its work budget — the expression is too large to analyse here.");
};

/**
 * Zeros of a polynomial with rational coefficients, with multiplicities, each
 * carrying an exact distance from the centre when it has one.
 */
function polyZeros(p: Rat[], ctx: Ctx, what: string): Zero[] {
  const t = ratPolyTrim(p);
  if (t.length < 2) return [];
  const deg = t.length - 1;
  if (deg > RADIUS_MAX_DEGREE) {
    refuse(`${what} has degree ${deg}; locating its roots is capped at degree ${RADIUS_MAX_DEGREE}.`);
  }
  checkCoeffs(t);
  const out: Zero[] = [];
  const x = ctx.x;
  const rational = (root: Rat, mult: number): void => {
    const d = ratAbs(ratSub(root, ctx.c));
    out.push({
      re: ratToNumber(root), im: 0, dist: ratToNumber(d), distExact: fmtRat(d),
      point: `${x} = ${fmtRat(root)}`, kind: "pole", sure: true, order: mult, rat: root, factor: [ratNeg(root), RAT_ONE],
    });
  };
  for (const { piece, mult } of squareFree(t)) {
    tick(ctx);
    let rest = ratPolyTrim(piece);
    // Degree ≥ 3: rational roots by GUESS-AND-CERTIFY, not by the rational-root
    // theorem's search — that search enumerates divisor pairs of the end
    // coefficients and took seconds on one highly composite 64-bit coefficient.
    // Each numerically located real root is matched to its continued-fraction
    // convergents and a candidate is accepted ONLY when it is an exact root
    // (exact evaluation = 0); it is then divided out exactly. A rational root
    // with a denominator past 10⁶ is simply left to the numeric path (≈).
    if (rest.length > 3) {
      for (const root of certifiedRationalRoots(rest)) {
        rational(root, mult);
        rest = ratPolyDivMod(rest, [ratNeg(root), RAT_ONE]).q;
      }
    }
    // Then rational QUADRATIC factors, by the same guess-and-certify: pair the
    // numeric roots, read x² − s·x + p off each pair, and accept it only when it
    // divides exactly. (x² + 1)(x² + 9) then gives ±i and ±3i in surds.
    if (rest.length > 4) {
      const split = certifiedQuadraticFactors(rest);
      for (const q of split.quads) out.push(...quadraticZeros(q, mult, ctx));
      rest = split.rest;
    }
    if (rest.length === 2) {
      rational(ratDiv(ratNeg(rest[0]), rest[1]), mult);
    } else if (rest.length === 3) {
      // A quadratic with a square discriminant splits over ℚ.
      const [C0, B, A] = rest;
      const disc = ratSub(ratMul(B, B), ratMul(ratInt(4), ratMul(A, C0)));
      const sq = ratSign(disc) >= 0 ? sqrtRatStr(disc).rat : undefined;
      if (sq) {
        const two = ratMul(ratInt(2), A);
        rational(ratDiv(ratAdd(ratNeg(B), sq), two), mult);
        if (!ratIsZero(sq)) rational(ratDiv(ratSub(ratNeg(B), sq), two), mult);
      } else {
        out.push(...quadraticZeros(rest, mult, ctx));
      }
    } else if (rest.length > 3) {
      const roots = numericRoots(rest);
      const coeffs = rest.map(ratToNumber);
      for (const z of roots) {
        // Residual check, relative to the size of the terms: a root that does not
        // satisfy the polynomial is not reported as one.
        let val: C = [0, 0], mag = 0;
        for (let i = coeffs.length - 1; i >= 0; i--) {
          val = cadd(cmul(val, z), [coeffs[i], 0]);
          mag += Math.abs(coeffs[i]) * Math.pow(cabs(z), i);
        }
        if (!(cabs(val) <= 1e-9 * mag)) refuse(`the numerical roots of ${what} did not converge to the required accuracy.`);
      }
      // A BINOMIAL a·xⁿ + b has every root on the circle |x| = |b/a|^(1/n), so
      // about 0 the distance is exact even though the roots are not printed in
      // surds: 1/(x⁴ + 1) has R = 1 exactly (the four 4th roots of −1).
      const n = rest.length - 1;
      const binomial = rest.slice(1, n).every((q) => ratIsZero(q)) && !ratIsZero(rest[0]);
      let binExact: string | undefined;
      if (binomial && ratIsZero(ctx.c)) {
        const m = ratAbs(ratDiv(rest[0], rest[n]));
        const root = ratRoot(m, n);
        binExact = root ? fmtRat(root) : m.d === 1n ? `${fmtRat(m)}^(1/${n})` : `(${fmtRat(m)})^(1/${n})`;
      }
      for (const z of roots) {
        const re = z[0];
        const im = Math.abs(z[1]) < 1e-12 * (1 + Math.abs(z[0])) ? 0 : z[1];
        const dist = Math.hypot(re - ctx.cn, im);
        out.push({
          re, im, dist, ...(binExact ? { distExact: binExact } : {}),
          point: `${x} ≈ ${sig(re)}${im ? ` ${im < 0 ? "-" : "+"} ${sig(Math.abs(im))}i` : ""}`,
          kind: "pole", sure: true, order: mult, factor: rest,
        });
      }
      if (!binExact) ctx.caveats.push(
        `Some roots of ${what} come from an irreducible factor of degree ${rest.length - 1} and were located numerically (Durand–Kerner, Newton-polished, to about 1e-12); distances to them are shown with ≈.`,
      );
    }
  }
  return out;
}

/** A small-denominator rational within 1e-9 of v (continued fractions, denominators ≤ 10⁶), or null. */
function ratGuess(v: number): Rat | null {
  if (!Number.isFinite(v) || Math.abs(v) > 1e12) return null;
  let w = v;
  let h0 = 1n, h1 = 0n, k0 = 0n, k1 = 1n;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(w);
    const A = BigInt(a);
    [h0, h1] = [A * h0 + h1, h0];
    [k0, k1] = [A * k0 + k1, k0];
    if (k0 > 1000000n) return null;
    if (Math.abs(Number(h0) / Number(k0) - v) <= 1e-9 * (1 + Math.abs(v))) return ratMake(h0, k0);
    const frac = w - a;
    if (frac < 1e-15) return null;
    w = 1 / frac;
  }
  return null;
}

/** Rational quadratic factors of p, found by pairing numeric roots and certified by exact division. */
function certifiedQuadraticFactors(p: Rat[]): { quads: Rat[][]; rest: Rat[] } {
  const quads: Rat[][] = [];
  let rest = polyMonic(p);
  for (let guard = 0; guard < 4 && rest.length > 4; guard++) {
    const zs = numericRoots(rest);
    let found: Rat[] | null = null;
    for (let i = 0; i < zs.length && !found; i++) {
      for (let j = i + 1; j < zs.length && !found; j++) {
        // (x − a)(x − b) = x² − (a + b)x + ab; real only for a conjugate or real pair.
        const s = cadd(zs[i], zs[j]), pr = cmul(zs[i], zs[j]);
        if (Math.abs(s[1]) > 1e-7 * (1 + cabs(s)) || Math.abs(pr[1]) > 1e-7 * (1 + cabs(pr))) continue;
        const S = ratGuess(s[0]), P = ratGuess(pr[0]);
        if (!S || !P) continue;
        const q = [P, ratNeg(S), RAT_ONE];
        const dm = ratPolyDivMod(rest, q);
        if (!dm.r.length) {
          found = q;
          rest = dm.q;
        }
      }
    }
    if (!found) break;
    quads.push(found);
  }
  return { quads, rest };
}

/** Exact rational roots of a square-free polynomial, found from its numeric roots and certified exactly. */
function certifiedRationalRoots(p: Rat[]): Rat[] {
  const out: Rat[] = [];
  const isRoot = (q: Rat): boolean => {
    let acc = RAT_ZERO;
    for (let i = p.length - 1; i >= 0; i--) acc = ratAdd(ratMul(acc, q), p[i]);
    return ratIsZero(acc);
  };
  for (const z of numericRoots(p)) {
    if (Math.abs(z[1]) > 1e-7 * (1 + Math.abs(z[0])) || !Number.isFinite(z[0])) continue;
    // Continued-fraction convergents of the real part, denominators ≤ 10⁶.
    let v = z[0];
    let h0 = 1n, h1 = 0n, k0 = 0n, k1 = 1n; // h/k convergents (h_{-1}=1, h_{-2}=0)
    for (let i = 0; i < 40 && Math.abs(v) < 1e15; i++) {
      const a = Math.floor(v);
      const A = BigInt(a);
      [h0, h1] = [A * h0 + h1, h0];
      [k0, k1] = [A * k0 + k1, k0];
      if (k0 > 1000000n) break;
      const cand = ratMake(h0, k0);
      if (isRoot(cand)) {
        if (!out.some((q) => ratEq(q, cand))) out.push(cand);
        break;
      }
      const frac = v - a;
      if (frac < 1e-12) break;
      v = 1 / frac;
    }
  }
  return out;
}

/** Roots of an irreducible quadratic A x² + B x + C over ℚ, exactly (surds). */
function quadraticZeros(q: Rat[], mult: number, ctx: Ctx): Zero[] {
  const [C0, B, A] = q;
  const x = ctx.x;
  const disc = ratSub(ratMul(B, B), ratMul(ratInt(4), ratMul(A, C0)));
  const p = ratDiv(ratNeg(B), ratMul(ratInt(2), A));
  const s2 = ratDiv(ratAbs(disc), ratMul(ratInt(4), ratMul(A, A))); // (half-gap)²
  const s = sqrtRatStr(s2);
  const sN = Math.sqrt(ratToNumber(s2));
  const pN = ratToNumber(p);
  const delta = ratSub(p, ctx.c);
  if (ratSign(disc) < 0) {
    // Complex pair p ± s·i: |z − c|² = (p − c)² + s² exactly.
    const d2 = ratAdd(ratMul(delta, delta), s2);
    const dist = sqrtRatStr(d2);
    const imS = s.str === "1" ? "i" : `${s.str}*i`;
    const point = ratIsZero(p) ? `${x} = ±${imS}` : `${x} = ${fmtRat(p)} ± ${imS}`;
    const dN = Math.sqrt(ratToNumber(d2));
    return [1, -1].map((sg) => ({
      re: pN, im: sg * sN, dist: dN, distExact: dist.str, point, kind: "pole" as SingKind, sure: true, order: mult, factor: q,
    }));
  }
  // Real irrational pair p ± s: distances |δ ± s| with δ = p − c, signs decided exactly.
  const point = `${x} = ${ratIsZero(p) ? "" : `${fmtRat(p)} `}±${ratIsZero(p) ? "" : " "}${s.str}`;
  const delta2 = ratMul(delta, delta);
  const sGreater = ratSign(ratSub(s2, delta2)) > 0; // s > |δ|
  const dS = fmtRat(ratAbs(delta));
  const plusDist = (sgn: number): string => {
    // |δ + sgn·s|
    if (ratIsZero(delta)) return s.str;
    const sameSign = ratSign(delta) === sgn;
    if (sameSign) return `${dS} + ${s.str}`;
    return sGreater ? `${s.str} - ${dS}` : `${dS} - ${s.str}`;
  };
  return [1, -1].map((sg) => ({
    re: pN + sg * sN, im: 0, dist: Math.abs(pN + sg * sN - ctx.cn), distExact: plusDist(sg),
    point, kind: "pole" as SingKind, sure: true, order: mult, factor: q,
  }));
}

// ---------------------------------------------------------------------------
// Exact evaluation at a rational point (for removability)
// ---------------------------------------------------------------------------

/**
 * The value of e at the rational point x = r, classified EXACTLY:
 *   { rat }   — an exact rational value;
 *   "trans"   — a transcendental (hence nonzero) number of the form q + q'·T;
 *   null      — not decided.
 * Lindemann–Weierstrass: for rational r ≠ 0, eʳ, sin r, cos r, tan r, sinh r,
 * cosh r, tanh r, ln r (r ≠ 1), atan r and asin r are transcendental.
 */
type ExactVal = { rat: Rat } | "trans" | null;

function exactAt(e: Expr, x: string, r: Rat): ExactVal {
  const rec = (n: Expr): ExactVal => {
    switch (n.t) {
      case "num": { const q = numRat(n.v); return q ? { rat: q } : null; }
      case "var":
        if (n.name === x) return { rat: r };
        if (n.name === "pi" || n.name === "e") return "trans";
        return null;
      case "neg": { const a = rec(n.e); return a === "trans" ? "trans" : a && { rat: ratNeg(a.rat) }; }
      case "add": case "sub": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        if (a !== "trans" && b !== "trans") return { rat: n.t === "add" ? ratAdd(a.rat, b.rat) : ratSub(a.rat, b.rat) };
        if (a === "trans" && b === "trans") return null;
        return "trans";
      }
      case "mul": {
        const a = rec(n.l), b = rec(n.r);
        if (a && a !== "trans" && ratIsZero(a.rat) && b) return { rat: RAT_ZERO };
        if (b && b !== "trans" && ratIsZero(b.rat) && a) return { rat: RAT_ZERO };
        if (!a || !b) return null;
        if (a !== "trans" && b !== "trans") return { rat: ratMul(a.rat, b.rat) };
        if (a === "trans" && b === "trans") return null;
        return "trans";
      }
      case "div": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        if (b !== "trans" && ratIsZero(b.rat)) return null;
        if (a !== "trans" && b !== "trans") return { rat: ratDiv(a.rat, b.rat) };
        if (a !== "trans" && ratIsZero(a.rat)) return { rat: RAT_ZERO };
        if (a === "trans" && b === "trans") return null;
        return "trans";
      }
      case "pow": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b || a === "trans" || b === "trans") return null;
        if (b.rat.d !== 1n || bAbs(b.rat.n) > 64n) return null;
        const p = ratPowInt(a.rat, Number(b.rat.n));
        return p ? { rat: p } : null;
      }
      case "fn": {
        const a = rec(n.arg);
        if (!a || a === "trans") return null;
        const v = a.rat;
        const zero = ratIsZero(v);
        switch (n.name) {
          case "sin": case "tan": case "sinh": case "tanh": case "atan": case "asin":
            return zero ? { rat: RAT_ZERO } : "trans";
          case "cos": case "cosh": case "exp":
            return zero ? { rat: RAT_ONE } : "trans";
          case "ln": case "log": case "log10": case "log2":
            if (ratSign(v) <= 0) return null;
            if (ratEq(v, RAT_ONE)) return { rat: RAT_ZERO };
            return n.name === "ln" ? "trans" : null; // log10 of 10 is rational
          case "sqrt": {
            if (ratSign(v) < 0) return null;
            const s = sqrtRatStr(v);
            return s.rat ? { rat: s.rat } : null;
          }
          default: return null;
        }
      }
    }
  };
  return rec(e);
}

/**
 * The order of vanishing of f at the point z, decided EXACTLY, capped at
 * `need`: returns k < need when f⁽ᵏ⁾(z) ≠ 0 is proved, `need` when f vanishes
 * to at least that order, null when undecided.
 */
function orderAt(f: Expr, z: Singularity, need: number, ctx: Ctx): number | null {
  const x = ctx.x;
  if (need <= 0) return 0;
  // Polynomial numerator with rational coefficients.
  const poly = reducedRational(f, x);
  if (poly && poly.den.length === 1) {
    const fp = poly.num;
    if (!fp.length) return need; // f ≡ 0
    if (z.rat) {
      let cur = fp;
      for (let k = 0; k < need; k++) {
        let acc = RAT_ZERO;
        for (let i = cur.length - 1; i >= 0; i--) acc = ratAdd(ratMul(acc, z.rat), cur[i]);
        if (!ratIsZero(acc)) return k;
        cur = polyDeriv(cur);
      }
      return need;
    }
    if (z.transcendental) return 0; // a nonzero rational polynomial never vanishes at a transcendental point
    if (z.factor) {
      // z is a root of the square-free factor q. gcd(f, q) = 1 ⇒ f(z) ≠ 0 at
      // every root of q; q | f ⇒ f vanishes at every root; anything between is
      // a mixed case left undecided.
      let cur = fp;
      for (let k = 0; k < need; k++) {
        const g = polyGcd(cur, z.factor);
        if (g.length <= 1) return k;
        if (g.length !== z.factor.length) return null;
        cur = ratPolyDivMod(cur, z.factor).q;
      }
      return need;
    }
    return null;
  }
  if (z.rat) {
    let cur = f;
    for (let k = 0; k < Math.min(need, MAX_ORDER_TEST); k++) {
      tick(ctx);
      const v = exactAt(cur, x, z.rat);
      if (v === "trans") return k;
      if (v === null) return nonzeroNumeric(cur, z, x) ? k : null;
      if (!ratIsZero(v.rat)) return k;
      if (k + 1 < need) {
        cur = derivative(cur, x);
        if (countNodes(cur) > MAX_DERIV_NODES) return null;
      }
    }
    return need <= MAX_ORDER_TEST ? need : null;
  }
  if (z.piq) {
    // The point is exactly q·π: sin(π) = 0 is decided exactly, not by a float.
    let cur = f;
    for (let k = 0; k < Math.min(need, MAX_ORDER_TEST); k++) {
      tick(ctx);
      const v = exactAtPi(cur, x, z.piq);
      if (v === "trans") return k;
      if (v === null) return nonzeroNumeric(cur, z, x) ? k : null;
      if (!ratIsZero(v.rat)) return k;
      if (k + 1 < need) {
        cur = derivative(cur, x);
        if (countNodes(cur) > MAX_DERIV_NODES) return null;
      }
    }
    return need <= MAX_ORDER_TEST ? need : null;
  }
  // Only a CLEAR nonzero is accepted numerically; a small value decides nothing.
  return nonzeroNumeric(f, z, x) ? 0 : null;
}

/** u as a·x + b₀ + b₁·π with rational a, b₀, b₁, or null. */
function affineXPi(u: Expr, x: string): { a: Rat; b0: Rat; b1: Rat } | null {
  type L = { a: Rat; b0: Rat; b1: Rat };
  const k = (q: Rat): L => ({ a: RAT_ZERO, b0: q, b1: RAT_ZERO });
  const isConst = (l: L): boolean => ratIsZero(l.a) && ratIsZero(l.b1);
  const scale = (l: L, q: Rat): L => ({ a: ratMul(l.a, q), b0: ratMul(l.b0, q), b1: ratMul(l.b1, q) });
  const rec = (n: Expr): L | null => {
    switch (n.t) {
      case "num": { const q = numRat(n.v); return q && k(q); }
      case "var":
        if (n.name === x) return { a: RAT_ONE, b0: RAT_ZERO, b1: RAT_ZERO };
        if (n.name === "pi") return { a: RAT_ZERO, b0: RAT_ZERO, b1: RAT_ONE };
        return null;
      case "neg": { const l = rec(n.e); return l && scale(l, ratInt(-1)); }
      case "add": case "sub": {
        const l = rec(n.l), r = rec(n.r);
        if (!l || !r) return null;
        const s = n.t === "add" ? 1 : -1;
        return { a: ratAdd(l.a, ratMul(r.a, ratInt(s))), b0: ratAdd(l.b0, ratMul(r.b0, ratInt(s))), b1: ratAdd(l.b1, ratMul(r.b1, ratInt(s))) };
      }
      case "mul": {
        const l = rec(n.l), r = rec(n.r);
        if (!l || !r) return null;
        if (isConst(l)) return scale(r, l.b0);
        if (isConst(r)) return scale(l, r.b0);
        return null;
      }
      case "div": {
        const l = rec(n.l), r = rec(n.r);
        if (!l || !r || !isConst(r) || ratIsZero(r.b0)) return null;
        return scale(l, ratDiv(RAT_ONE, r.b0));
      }
      default: return null;
    }
  };
  return rec(u);
}

/**
 * The value of e at x = q·π, classified exactly like exactAt. sin and cos at
 * multiples of π/2 (sin) or π/2 (cos) — and π/6, π/3 where the value is
 * rational — are exact; q·π itself (q ≠ 0) and any rational combination with
 * a nonzero π-part are transcendental.
 */
function exactAtPi(e: Expr, x: string, q: Rat): ExactVal {
  type V = { rat: Rat } | { pi: Rat; r: Rat } | "trans" | null; // pi: value r + pi·π
  const toVal = (v: V): ExactVal => (v === null || v === "trans" ? v : "rat" in v ? v : ratIsZero(v.pi) ? { rat: v.r } : "trans");
  const asLin = (v: V): { pi: Rat; r: Rat } | null => (v === null || v === "trans" ? null : "rat" in v ? { pi: RAT_ZERO, r: v.rat } : v);
  const trigAt = (name: string, m: Rat): Rat | null => {
    // m·π with 6m integer: sin/cos rational exactly when the angle is a multiple of π/6 (sin) / π/3 (cos) in the table.
    const six = ratMul(m, ratInt(6));
    if (six.d !== 1n) return null;
    let k = Number(((six.n % 12n) + 12n) % 12n); // angle = k·π/6, k in 0..11
    const SIN: (Rat | null)[] = [RAT_ZERO, ratMake(1n, 2n), null, RAT_ONE, null, ratMake(1n, 2n), RAT_ZERO, ratMake(-1n, 2n), null, ratInt(-1), null, ratMake(-1n, 2n)];
    if (name === "sin") return SIN[k];
    if (name === "cos") { k = (k + 3) % 12; return SIN[k]; }
    return null;
  };
  const rec = (n: Expr): V => {
    switch (n.t) {
      case "num": { const r = numRat(n.v); return r ? { rat: r } : null; }
      case "var":
        if (n.name === x) return { pi: q, r: RAT_ZERO };
        if (n.name === "pi") return { pi: RAT_ONE, r: RAT_ZERO };
        if (n.name === "e") return "trans";
        return null;
      case "neg": { const a = asLin(rec(n.e)); return a && { pi: ratNeg(a.pi), r: ratNeg(a.r) }; }
      case "add": case "sub": {
        const a = asLin(rec(n.l)), b = asLin(rec(n.r));
        if (!a || !b) return null;
        return n.t === "add" ? { pi: ratAdd(a.pi, b.pi), r: ratAdd(a.r, b.r) } : { pi: ratSub(a.pi, b.pi), r: ratSub(a.r, b.r) };
      }
      case "mul": {
        const a = asLin(rec(n.l)), b = asLin(rec(n.r));
        if (a && ratIsZero(a.pi) && ratIsZero(a.r)) return { rat: RAT_ZERO };
        if (b && ratIsZero(b.pi) && ratIsZero(b.r)) return { rat: RAT_ZERO };
        if (!a || !b) return null;
        if (ratIsZero(a.pi)) return { pi: ratMul(a.r, b.pi), r: ratMul(a.r, b.r) };
        if (ratIsZero(b.pi)) return { pi: ratMul(b.r, a.pi), r: ratMul(b.r, a.r) };
        return null;
      }
      case "div": {
        const a = asLin(rec(n.l)), b = asLin(rec(n.r));
        if (!a || !b || !ratIsZero(b.pi) || ratIsZero(b.r)) return null;
        return { pi: ratDiv(a.pi, b.r), r: ratDiv(a.r, b.r) };
      }
      case "fn": {
        const a = asLin(rec(n.arg));
        if (!a) return null;
        if (ratIsZero(a.pi)) return exactAt({ t: "fn", name: n.name, arg: { t: "var", name: "__r" } }, "__r", a.r);
        if (!ratIsZero(a.r)) return null;
        const t = trigAt(n.name, a.pi);
        if (t) return { rat: t };
        if (n.name === "exp" || n.name === "sinh" || n.name === "cosh") return "trans"; // e^(qπ), q ≠ 0
        return null;
      }
      default: return null;
    }
  };
  return toVal(rec(e));
}

/**
 * g is PROVED to be the zero function: an exact-zero constant (0, sin(0), 0·π),
 * or a rational function of x whose reduced numerator is 0.
 */
function isZeroFunction(g: Expr, x: string): boolean {
  if (!hasVar(g, x)) {
    const v = exactAt(g, x, RAT_ZERO);
    return !!v && v !== "trans" && ratIsZero(v.rat);
  }
  if (!isRationalStructure(g, x) || degreeBound(g, x) > MAX_EXPAND_DEGREE) return false;
  const rf = ratFunctionInVar(g, x);
  return !!rf && ratPolyTrim(rf.num).length === 0;
}

/** g is not the zero function: clearly nonzero at one of two generic complex points. */
function notIdenticallyZero(g: Expr, x: string): boolean {
  return nonzeroNumeric(g, { re: 0.3711, im: 0.2193 }, x) || nonzeroNumeric(g, { re: -1.2913, im: 0.7071 }, x);
}

/**
 * A CLEAR nonzero, judged against the size of what was cancelled — not against
 * an absolute threshold. exp(x+40) − e⁴⁰·eˣ is identically 0, but in doubles it
 * evaluates to ~10, far above any absolute cut-off; its terms are ~10¹⁷, and
 * against that scale ~10 is rounding noise. So the value must exceed 1e-8 of a
 * running magnitude bound (|terms| summed through + and −, each function's
 * sensitivity carried through) before it counts as nonzero.
 */
function nonzeroNumeric(f: Expr, z: { re: number; im: number }, x: string): boolean {
  const r = cEvalMag(f, x, [z.re, z.im]);
  if (!r) return false;
  const a = cabs(r.v);
  return Number.isFinite(r.m) && a > 1e-8 * r.m && a > 1e-250;
}

/** Value and a magnitude bound m (the scale of the rounding error is ~1e-16·m). */
function cEvalMag(e: Expr, x: string, z: C): { v: C; m: number } | null {
  const rec = (n: Expr): { v: C; m: number } | null => {
    switch (n.t) {
      case "num": case "var": {
        const v = cEval(n, x, z);
        return v && { v, m: cabs(v) };
      }
      case "neg": { const a = rec(n.e); return a && { v: [-a.v[0], -a.v[1]], m: a.m }; }
      case "add": case "sub": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        return { v: n.t === "add" ? cadd(a.v, b.v) : csub(a.v, b.v), m: a.m + b.m };
      }
      case "mul": {
        const a = rec(n.l), b = rec(n.r);
        return a && b && { v: cmul(a.v, b.v), m: a.m * b.m };
      }
      case "div": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        const bv = cabs(b.v);
        // A denominator that is itself cancellation noise decides nothing.
        if (!(bv > 1e-8 * b.m) || bv === 0) return null;
        const v = cdiv(a.v, b.v);
        return { v, m: a.m / bv + (cabs(v) * b.m) / bv };
      }
      case "pow": {
        const a = rec(n.l), b = rec(n.r);
        if (!a || !b) return null;
        const v = cEval(n, x, z);
        if (!v) return null;
        const k = cabs(b.v);
        return { v, m: Math.pow(Math.max(a.m, cabs(a.v)), Math.max(1, k)) + cabs(v) * b.m };
      }
      case "fn": {
        const a = rec(n.arg);
        if (!a) return null;
        const v = cEval(n, x, z);
        if (!v) return null;
        // Sensitivity |f'(u)| by a central difference, times the argument's scale.
        const h = 1e-6 * (1 + cabs(a.v));
        const p = evalFnAt(n.name, cadd(a.v, [h, 0]));
        const q = evalFnAt(n.name, csub(a.v, [h, 0]));
        const fp = p && q ? cabs(csub(p, q)) / (2 * h) : Infinity;
        return { v, m: cabs(v) + fp * a.m };
      }
    }
  };
  return rec(e);
}

function evalFnAt(name: string, u: C): C | null {
  return cEval({ t: "fn", name, arg: { t: "var", name: "__u" } }, "__u", u);
}

// ---------------------------------------------------------------------------
// Families of zeros of sin, cos, sinh, cosh and polynomials in exp(u), u linear
// ---------------------------------------------------------------------------

/**
 * Points x = (θ_k − b)/a for a real family θ_k = (k·step + offset)·π.
 * `imaginary` puts the family on the imaginary u-axis (sinh/cosh, exp).
 */
function familyPoints(
  lin: { a: Rat; b: Rat },
  piStep: Rat,
  piOffset: Rat,
  imaginary: boolean,
  ctx: Ctx,
  kind: SingKind,
  reShift: number | null = 0,
): Zero[] {
  const { a, b } = lin;
  const x = ctx.x;
  const aN = ratToNumber(a), bN = ratToNumber(b);
  const out: Zero[] = [];
  const stepN = ratToNumber(piStep) * Math.PI, offN = ratToNumber(piOffset) * Math.PI;
  // The member whose u is nearest the centre's u.
  const target = imaginary ? 0 : aN * ctx.cn + bN;
  const k0 = Math.round((target - offN) / stepN);
  for (let k = k0 - 4; k <= k0 + 4; k++) {
    tick(ctx);
    const B = ratDiv(ratAdd(ratMul(ratInt(k), piStep), piOffset), a); // π-coefficient of x
    const reRat = reShift === 0 ? ratDiv(ratNeg(b), a) : null; // real part, exact when no log term
    const reN = reShift === 0 ? ratToNumber(reRat as Rat) : (reShift as number - bN) / aN;
    const piN = ratToNumber(B) * Math.PI;
    const isRational = ratIsZero(B) && reRat !== null;
    let re: number, im: number, distExact: string | undefined, point: string;
    if (!imaginary) {
      re = reN + piN;
      im = 0;
      const A = ratSub(reRat as Rat, ctx.c);
      const val = ratToNumber(A) + piN;
      distExact = val < 0 ? fmtLinPi(ratNeg(A), ratNeg(B)) : fmtLinPi(A, B);
      point = `${x} = ${fmtLinPi(reRat as Rat, B)}`;
    } else {
      re = reN;
      im = piN;
      if (reRat) {
        const A = ratSub(reRat, ctx.c);
        const B2 = ratMul(B, B);
        if (ratIsZero(A)) distExact = fmtLinPi(RAT_ZERO, ratAbs(B));
        else if (ratIsZero(B)) distExact = fmtRat(ratAbs(A));
        else distExact = `sqrt(${fmtRat(ratMul(A, A))} + ${fmtRat(B2)}*pi^2)`;
        const imS = ratIsZero(B) ? "" : `${fmtLinPi(RAT_ZERO, ratAbs(B))}*i`;
        point = ratIsZero(B)
          ? `${x} = ${fmtRat(reRat)}`
          : `${x} = ${ratIsZero(reRat) ? "" : `${fmtRat(reRat)} `}±${ratIsZero(reRat) ? "" : " "}${imS}`;
      } else {
        point = `${x} ≈ ${sig(re)} ± ${sig(Math.abs(im))}i`;
      }
    }
    const dist = Math.hypot(re - ctx.cn, im);
    out.push({
      re, im, dist, distExact, point, kind, sure: true, order: 1,
      ...(isRational ? { rat: reRat as Rat } : { transcendental: true }),
      ...(!imaginary && !isRational && reRat && ratIsZero(reRat) ? { piq: B } : {}),
    });
  }
  return out;
}

const PI_ONE = RAT_ONE;
const PI_HALF = ratMake(1n, 2n);
const PI_TWO = ratInt(2);

/** Replaces every exp(u) / e^u in g by the placeholder E and returns u (all must agree). */
function asPolyInExp(g: Expr, x: string): { P: Expr; u: Expr } | null {
  let u: Expr | null = null;
  let ok = true;
  const E = "E__exp";
  const rec = (n: Expr): Expr => {
    if (n.t === "fn" && n.name === "exp") return take(n.arg);
    if (n.t === "pow" && n.l.t === "var" && n.l.name === "e" && hasVar(n.r, x)) return take(n.r);
    switch (n.t) {
      case "num": case "var": return n;
      case "neg": return { t: "neg", e: rec(n.e) };
      case "fn": return { t: "fn", name: n.name, arg: rec(n.arg) };
      default: return { t: n.t, l: rec(n.l), r: rec(n.r) } as Expr;
    }
  };
  const take = (arg: Expr): Expr => {
    if (!u) u = arg;
    else if (format(u) !== format(arg)) ok = false;
    return { t: "var", name: E };
  };
  const P = rec(g);
  if (!ok || !u || hasVar(P, x)) return null;
  return { P, u };
}

/**
 * The COMPLETE zero set of g near the centre, with orders, or a refusal: a
 * missing zero would overstate R, so "unknown" is never treated as "none".
 */
function zerosOf(g: Expr, ctx: Ctx): Zero[] {
  const x = ctx.x;
  tick(ctx);
  if (!hasVar(g, x)) return [];
  const rf = reducedRational(g, x);
  if (rf) return polyZeros(rf.num, ctx, `the numerator of ${format(g)}`).map((z) => ({ ...z, kind: "singularity" as SingKind }));
  switch (g.t) {
    case "neg": return zerosOf(g.e, ctx);
    case "mul": {
      const a = zerosOf(g.l, ctx), b = zerosOf(g.r, ctx);
      const out = a.map((z) => ({ ...z }));
      for (const z of b) {
        const hit = out.find((w) => samePoint(w, z));
        if (hit) hit.order += z.order;
        else out.push({ ...z });
      }
      return out;
    }
    case "div":
      if (!hasVar(g.r, x)) return zerosOf(g.l, ctx);
      break;
    case "pow": {
      const k = constRat(g.r);
      if (k && k.d === 1n && k.n > 0n && !hasVar(g.r, x)) {
        return zerosOf(g.l, ctx).map((z) => ({ ...z, order: z.order * Number(k.n) }));
      }
      if (g.l.t === "var" && g.l.name === "e") return []; // eᵘ never vanishes
      break;
    }
    case "fn": {
      const lin = linearIn(g.arg, x);
      switch (g.name) {
        case "exp": return [];
        case "sin": case "tan":
          if (lin) return familyPoints(lin, PI_ONE, RAT_ZERO, false, ctx, "singularity");
          break;
        case "cos":
          if (lin) return familyPoints(lin, PI_ONE, PI_HALF, false, ctx, "singularity");
          break;
        case "sinh": case "tanh":
          if (lin) return familyPoints(lin, PI_ONE, RAT_ZERO, true, ctx, "singularity");
          break;
        case "cosh":
          if (lin) return familyPoints(lin, PI_ONE, PI_HALF, true, ctx, "singularity");
          break;
      }
      break;
    }
  }
  // A polynomial in exp(u), u linear: e^u = K for each root K of P.
  const pe = asPolyInExp(g, x);
  if (pe) {
    const lin = linearIn(pe.u, x);
    const P = reducedRational(pe.P, "E__exp");
    if (lin && P && P.den.length === 1) {
      const subCtx: Ctx = { ...ctx, x: "E", c: RAT_ZERO, cn: 0 };
      const Ks = polyZeros(P.num, subCtx, `the polynomial in exp(${format(pe.u)})`);
      ctx.budget = subCtx.budget;
      const out: Zero[] = [];
      for (const K of Ks) {
        if (K.re === 0 && K.im === 0) continue; // eᵘ = 0 has no solution
        // u = ln|K| + i(arg K + 2πm).
        if (K.rat && (ratEq(K.rat, RAT_ONE) || ratEq(K.rat, ratInt(-1)))) {
          const off = ratEq(K.rat, RAT_ONE) ? RAT_ZERO : RAT_ONE;
          out.push(...familyPoints(lin, PI_TWO, off, true, ctx, "singularity").map((z) => ({ ...z, order: K.order })));
        } else {
          const lnAbs = Math.log(Math.hypot(K.re, K.im));
          const arg = Math.atan2(K.im, K.re);
          const zs = familyPoints(lin, PI_TWO, RAT_ZERO, true, ctx, "singularity", lnAbs);
          // familyPoints placed the imaginary parts at 2πm/a; shift by arg/a.
          for (const z of zs) {
            const aN = ratToNumber(lin.a);
            const im = z.im + arg / aN;
            out.push({
              ...z, im, dist: Math.hypot(z.re - ctx.cn, im), distExact: undefined,
              point: `${x} ≈ ${sig(z.re)} ${im < 0 ? "-" : "+"} ${sig(Math.abs(im))}i`, order: K.order,
              rat: undefined, transcendental: true,
            });
          }
        }
      }
      return out;
    }
  }
  // An affine form a·x + b₀ + b₁·π (x − pi, 2x − pi/2): one simple zero,
  // x = −(b₀ + b₁π)/a, carried exactly as A + Bπ.
  const aff = affineXPi(g, x);
  if (aff && !ratIsZero(aff.a)) {
    const A = ratDiv(ratNeg(aff.b0), aff.a), B = ratDiv(ratNeg(aff.b1), aff.a);
    const re = ratToNumber(A) + ratToNumber(B) * Math.PI;
    const dA = ratSub(A, ctx.c);
    const val = ratToNumber(dA) + ratToNumber(B) * Math.PI;
    const z: Zero = {
      re, im: 0, dist: Math.abs(val), distExact: val < 0 ? fmtLinPi(ratNeg(dA), ratNeg(B)) : fmtLinPi(dA, B),
      point: `${x} = ${fmtLinPi(A, B)}`, kind: "singularity", sure: true, order: 1,
      ...(ratIsZero(B) ? { rat: A } : { transcendental: true }),
      ...(ratIsZero(A) && !ratIsZero(B) ? { piq: B } : {}),
    };
    return [z];
  }
  return refuse(`the zeros of ${format(g)} are not determined here (only polynomials, sin/cos/sinh/cosh of a linear argument, and polynomials in exp of a linear argument are covered).`);
}

// ---------------------------------------------------------------------------
// The singular set of an expression
// ---------------------------------------------------------------------------

const NOT_ANALYTIC = new Set(["abs", "floor", "ceil", "sign", "sgn", "round", "u", "heaviside", "step", "delta", "conj", "re", "im", "arg", "frac", "mod"]);

const unsure = (s: Singularity): Singularity => ({ ...s, sure: false, kind: s.kind === "pole" ? "pole" : s.kind });

function analyze(e: Expr, ctx: Ctx, top = false): Singularity[] {
  const x = ctx.x;
  tick(ctx);
  if (!hasVar(e, x)) return [];
  const rf = reducedRational(e, x);
  if (rf) {
    if (top && e.t === "div") noteRemovable(e, rf.den, ctx);
    return polyZeros(rf.den, ctx, `the denominator ${fmtPolyLabel(rf.den, x)}`).map((z) => ({ ...z, kind: "pole" as SingKind }));
  }
  switch (e.t) {
    case "neg": return analyze(e.e, ctx);
    case "add": case "sub": return combineSum(analyze(e.l, ctx), analyze(e.r, ctx));
    case "mul": {
      // An identically-zero factor makes the product the zero function, which is
      // entire: 0·log(1 − x) has no singularity at 1 (review defect).
      if (isZeroFunction(e.l, x) || isZeroFunction(e.r, x)) return [];
      if (!hasVar(e.l, x)) return analyze(e.r, ctx, top);
      if (!hasVar(e.r, x)) return analyze(e.l, ctx, top);
      // a·(b/c) is read as (a·b)/c, so a zero of a can cancel the pole of 1/c
      // (sin(x)·(1/x) is removable at 0, exactly as sin(x)/x is).
      if (e.r.t === "div") return quotient({ t: "mul", l: e.l, r: e.r.l }, e.r.r, ctx, top);
      if (e.l.t === "div") return quotient({ t: "mul", l: e.l.l, r: e.r }, e.l.r, ctx, top);
      const negPow = (h: Expr): Expr | null => {
        if (h.t !== "pow") return null;
        const k = constRat(h.r);
        return k && k.d === 1n && k.n < 0n ? { t: "pow", l: h.l, r: { t: "num", v: Number(-k.n) } } : null;
      };
      const nr = negPow(e.r), nl = negPow(e.l);
      if (nr) return quotient(e.l, nr, ctx, top);
      if (nl) return quotient(e.r, nl, ctx, top);
      return combineProduct(e.l, e.r, ctx);
    }
    case "div":
      if (isZeroFunction(e.l, x)) return [];
      return quotient(e.l, e.r, ctx, top);
    case "pow": return analyzePow(e, ctx);
    case "fn": return analyzeFn(e.name, e.arg, ctx);
    default: return [];
  }
}

function fmtPolyLabel(p: Rat[], x: string): string {
  const terms: string[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    if (ratIsZero(p[i])) continue;
    const c = p[i];
    const mag = ratAbs(c);
    const xp = i === 0 ? "" : i === 1 ? x : `${x}^${i}`;
    const body = i > 0 && ratEq(mag, RAT_ONE) ? xp : `${fmtRat(mag)}${xp ? `*${xp}` : ""}`;
    terms.push(terms.length === 0 ? (ratSign(c) < 0 ? `-${body}` : body) : `${ratSign(c) < 0 ? "- " : "+ "}${body}`);
  }
  return terms.join(" ") || "0";
}

/** Records the denominator roots that the reduction cancelled (removable points). */
function noteRemovable(e: Expr & { t: "div" }, reducedDen: Rat[], ctx: Ctx): void {
  const raw = reducedRational(e.r, ctx.x);
  // Only when the reduction actually cancelled something.
  if (!raw || raw.den.length !== 1 || raw.num.length <= reducedDen.length || raw.num.length - 1 > RADIUS_MAX_DEGREE) return;
  const roots: Rat[] = [];
  for (const { piece } of squareFree(raw.num)) {
    if (piece.length === 2) roots.push(ratDiv(ratNeg(piece[0]), piece[1]));
    else roots.push(...certifiedRationalRoots(piece));
  }
  for (const root of roots) {
    let v = RAT_ZERO;
    for (let i = reducedDen.length - 1; i >= 0; i--) v = ratAdd(ratMul(v, root), reducedDen[i]);
    if (!ratIsZero(v)) ctx.removable.push(`${ctx.x} = ${fmtRat(root)}`);
  }
}

function combineSum(a: Singularity[], b: Singularity[]): Singularity[] {
  const out: Singularity[] = [];
  for (const s of a) out.push(b.some((t) => samePoint(s, t)) ? unsure(s) : s);
  for (const s of b) if (!a.some((t) => samePoint(s, t))) out.push(s);
  return out;
}

function combineProduct(f: Expr, g: Expr, ctx: Ctx): Singularity[] {
  const Sf = analyze(f, ctx), Sg = analyze(g, ctx);
  const out: Singularity[] = [];
  // f singular at s, g analytic AND NONZERO at s ⇒ f·g singular at s. A zero
  // of g can cancel a POLE but never a branch point or an essential singularity:
  // continuing f·g around s multiplies the change in f by g ≢ 0 (monodromy), and
  // xᵐ·h·e^(1/x) is still essential. So for those, g ≢ 0 is enough.
  const keep = (s: Singularity, other: Expr, otherS: Singularity[]): Singularity => {
    if (!s.sure || otherS.some((t) => samePoint(s, t))) return unsure(s);
    if (s.kind !== "pole" && notIdenticallyZero(other, ctx.x)) return s;
    const ord = orderAt(other, s, 1, ctx);
    return ord === 0 ? s : unsure(s);
  };
  for (const s of Sf) out.push(keep(s, g, Sg));
  for (const s of Sg) if (!Sf.some((t) => samePoint(s, t))) out.push(keep(s, f, Sf));
  return out;
}

/** Splits a denominator's factors: branch-type and exp factors move up as negative powers. */
function splitDen(g: Expr): { up: Expr[]; down: Expr[] } {
  const factors: Expr[] = [];
  const flat = (n: Expr): void => {
    if (n.t === "mul") { flat(n.l); flat(n.r); } else factors.push(n);
  };
  flat(g);
  const up: Expr[] = [], down: Expr[] = [];
  for (const h of factors) {
    if (h.t === "pow" && !(h.l.t === "var" && h.l.name === "e")) {
      const k = constRat(h.r);
      if (k && !(k.d === 1n && k.n > 0n)) { up.push({ t: "pow", l: h.l, r: { t: "neg", e: h.r } }); continue; }
    }
    if (h.t === "pow" && h.l.t === "var" && h.l.name === "e") { up.push({ t: "fn", name: "exp", arg: { t: "neg", e: h.r } }); continue; }
    if (h.t === "fn" && h.name === "exp") { up.push({ t: "fn", name: "exp", arg: { t: "neg", e: h.arg } }); continue; }
    if (h.t === "fn" && (h.name === "sqrt" || h.name === "cbrt")) {
      up.push({ t: "pow", l: h.arg, r: { t: "num", v: h.name === "sqrt" ? -0.5 : NaN } });
      continue;
    }
    down.push(h);
  }
  return { up, down };
}

const mulAll = (xs: Expr[]): Expr => xs.reduce((a, b) => ({ t: "mul", l: a, r: b }));

function quotient(f: Expr, g: Expr, ctx: Ctx, top: boolean): Singularity[] {
  const x = ctx.x;
  if (!hasVar(g, x)) return analyze(f, ctx, top);
  const { up, down } = splitDen(g);
  // cbrt moved up needs an exact −1/3, which a float cannot carry: rebuild it.
  const fixUp = up.map((h) =>
    h.t === "pow" && h.r.t === "num" && Number.isNaN(h.r.v)
      ? ({ t: "pow", l: h.l, r: { t: "div", l: { t: "num", v: -1 }, r: { t: "num", v: 3 } } } as Expr)
      : h,
  );
  if (up.length) {
    const num = mulAll([f, ...fixUp]);
    if (!down.length) return analyze(num, ctx);
    return quotient(num, mulAll(down), ctx, top);
  }
  const Sf = analyze(f, ctx);
  const Sg = analyze(g, ctx);
  const Zg = zerosOf(g, ctx);
  const out: Singularity[] = [];
  for (const s of Sf) {
    if (Sg.some((t) => samePoint(s, t))) { out.push(unsure(s)); continue; }
    // Dividing by g, with g analytic at s, multiplies by a meromorphic 1/g ≢ 0:
    // that cancels nothing at a branch point or essential singularity, and a
    // pole of f is only kept when g(s) ≠ 0.
    const atZero = Zg.some((t) => samePoint(s, t));
    out.push(!atZero || (s.sure && s.kind !== "pole") ? s : unsure(s));
  }
  for (const s of Sg) if (!Sf.some((t) => samePoint(s, t))) out.push({ ...unsure(s), kind: "singularity" });
  for (const z of Zg) {
    if (Sf.some((t) => samePoint(z, t)) || Sg.some((t) => samePoint(z, t))) {
      out.push({ ...unsure(z), kind: "singularity" });
      continue;
    }
    const k = orderAt(f, z, z.order, ctx);
    if (k === null) {
      out.push({ ...z, kind: "pole", sure: false });
    } else if (k >= z.order) {
      ctx.removable.push(z.point);
    } else {
      out.push({ ...z, kind: "pole", sure: true });
    }
  }
  return out;
}

function analyzePow(e: Expr & { t: "pow" }, ctx: Ctx): Singularity[] {
  const x = ctx.x;
  const bx = hasVar(e.l, x), ex = hasVar(e.r, x);
  if (bx && ex) refuse(`${format(e)} has the variable in both base and exponent — outside the singularity table.`);
  if (ex) {
    // c^u = exp(u·ln c): entire in u for a positive constant base.
    if (e.l.t === "var" && e.l.name === "e") return analyzeFn("exp", e.r, ctx);
    const b = constRat(e.l);
    if (b && ratSign(b) > 0) return analyzeFn("exp", e.r, ctx);
    return refuse(`${format(e)}: a power with a non-positive or non-rational base is outside the singularity table.`);
  }
  const r = constRat(e.r);
  if (!r) return refuse(`${format(e)}: an exponent that is not an exact rational is outside the singularity table.`);
  if (r.d === 1n) {
    const n = Number(r.n);
    if (n === 0) return [];
    if (n > 0) return analyze(e.l, ctx).map((s) => (s.sure && s.kind === "pole" ? s : unsure(s)));
    return quotient({ t: "num", v: 1 }, { t: "pow", l: e.l, r: { t: "num", v: -n } }, ctx, false);
  }
  return branchPow(e.l, r, ctx);
}

/** u^r for non-integer rational r: branch points at the zeros of u of order m with m·r ∉ ℤ≥0. */
function branchPow(u: Expr, r: Rat, ctx: Ctx): Singularity[] {
  const Su = analyze(u, ctx).map(unsure);
  const out: Singularity[] = [...Su];
  for (const z of zerosOf(u, ctx)) {
    if (Su.some((t) => samePoint(z, t))) continue;
    const mr = ratMul(ratInt(z.order), r);
    if (mr.d === 1n && mr.n >= 0n) {
      ctx.notes.push(`${z.point} is a zero of order ${z.order} of ${format(u)}, so ${format(u)}^(${fmtRat(r)}) is analytic there (not a branch point).`);
      continue;
    }
    out.push({ ...z, kind: mr.d === 1n ? "pole" : "branch point", sure: true });
  }
  return out;
}

function analyzeFn(name: string, u: Expr, ctx: Ctx): Singularity[] {
  const x = ctx.x;
  if (NOT_ANALYTIC.has(name)) {
    return refuse(`${name}(…) is not analytic — it has no complex-analytic extension, so no power series represents it and R is not determined.`);
  }
  switch (name) {
    case "exp": case "sin": case "cos": case "sinh": case "cosh":
      // Entire outer function: the singularities are u's. A pole of u becomes an
      // essential singularity; a branch point of u may disappear (cos √x is entire).
      return analyze(u, ctx).map((s) => (s.sure && s.kind === "pole" ? { ...s, kind: "essential singularity" as SingKind } : unsure(s)));
    case "ln": case "log": case "log10": case "log2": {
      const Su = analyze(u, ctx).map((s) => (s.sure && s.kind === "pole" ? { ...s, kind: "branch point" as SingKind } : unsure(s)));
      const out = [...Su];
      for (const z of zerosOf(u, ctx)) {
        if (Su.some((t) => samePoint(z, t))) continue;
        out.push({ ...z, kind: "branch point", sure: true });
      }
      return out;
    }
    case "sqrt": return branchPow(u, ratMake(1n, 2n), ctx);
    case "cbrt": return branchPow(u, ratMake(1n, 3n), ctx);
    case "tan": case "sec": case "cot": case "csc": case "tanh": {
      const lin = linearIn(u, x);
      if (!lin) return refuse(`${name}(${format(u)}): the poles of ${name} are located here only for a linear argument a·${x} + b with rational a, b.`);
      if (name === "tan" || name === "sec") return familyPoints(lin, PI_ONE, PI_HALF, false, ctx, "pole");
      if (name === "tanh") return familyPoints(lin, PI_ONE, PI_HALF, true, ctx, "pole");
      return familyPoints(lin, PI_ONE, RAT_ZERO, false, ctx, "pole");
    }
    case "atan": case "asin": case "acos": {
      if (!reducedRational(u, x)) {
        return refuse(`${name}(${format(u)}): the singularities of ${name} are located here only for a rational argument.`);
      }
      // atan: log singularities where u = ±i, i.e. zeros of 1 + u².
      // asin/acos: branch points where u = ±1, i.e. zeros of 1 − u² of ODD order.
      const W: Expr = name === "atan"
        ? { t: "add", l: { t: "num", v: 1 }, r: { t: "pow", l: u, r: { t: "num", v: 2 } } }
        : { t: "sub", l: { t: "num", v: 1 }, r: { t: "pow", l: u, r: { t: "num", v: 2 } } };
      const Su = analyze(u, ctx).map(unsure);
      const out = [...Su];
      for (const z of zerosOf(W, ctx)) {
        if (Su.some((t) => samePoint(z, t))) continue;
        if (name !== "atan" && z.order % 2 === 0) {
          out.push({ ...z, kind: "branch point", sure: false });
          continue;
        }
        out.push({ ...z, kind: name === "atan" ? "singularity" : "branch point", sure: true });
      }
      return out;
    }
    default:
      return refuse(`${name}(…) is outside the singularity table.`);
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ConvergenceInterval {
  /** Re-parseable endpoint displays (or "-∞"/"∞"). */
  lo: string;
  hi: string;
  loValue: number;
  hiValue: number;
  /** true = endpoint included, false = excluded, null = not determined. */
  loClosed: boolean | null;
  hiClosed: boolean | null;
  /** "(-1, 1]", or "(-1, 1) — endpoints not determined". */
  text: string;
  /** One reason line per decided endpoint, each naming its test. */
  reasons: string[];
}

export interface RadiusResult {
  /** "finite" R = d; "infinite"; "zero" (converges only at the centre);
   *  "lowerBound" (R ≥ d); "centreSingular" (no Taylor series at c); "refused". */
  kind: "finite" | "infinite" | "zero" | "lowerBound" | "centreSingular" | "refused";
  /** R as a number (Infinity for "infinite"; the bound for "lowerBound"). */
  value?: number;
  /** R exactly, in Solve grammar ("1", "pi/2", "sqrt(5)", "2*pi") — absent when only numeric. */
  exact?: string;
  /** What to print after "R = " / "R ≥ ": the exact form, or "≈ 1.2345", or "∞". */
  display?: string;
  /** For "lowerBound": a proved upper bound, when a sure singularity exists. */
  upper?: { value: number; display: string };
  /** For "centreSingular": the outer radius of the punctured disc 0 < |x − c| < ρ. */
  laurentOuter?: { value: number; display: string };
  /** The theorem that gave R, named once. */
  theorem: string;
  /** The singular points that set R. */
  nearest: Singularity[];
  /** Every candidate within 2R (for the figure). */
  singularities: Singularity[];
  /** Interval of convergence on the real line (finite, positive R only). */
  interval?: ConvergenceInterval;
  /** One-line summary for a Taylor result: "R = 1 — …". */
  line: string;
  /** Explanation lines, in reading order. */
  lines: string[];
  caveats: string[];
  /** The refusal, by name, for kind "refused". */
  reason?: string;
  /** The centre and variable, for the figure. */
  centre: number;
  centreDisplay: string;
  variable: string;
  /** Removable points noticed (not singularities). */
  removable: string[];
}

const NAMED_REFUSAL = "R not determined — reading it from the computed coefficients would be sampling, not a theorem.";

function refused(reason: string, variable: string, centre: number, centreDisplay: string): RadiusResult {
  return {
    kind: "refused", theorem: "", nearest: [], singularities: [], line: `Radius of convergence not determined: ${reason}`,
    lines: [`${reason}`, NAMED_REFUSAL], caveats: [], reason, centre, centreDisplay, variable, removable: [],
  };
}

function nestingDepth(s: string): number {
  let d = 0, m = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") m = Math.max(m, ++d);
    else if (ch === ")" || ch === "]") d--;
  }
  return m;
}

/** Parses the centre as an exact rational ("1", "-0.5", "3/2"). */
function centreRat(c: number | string): Rat | null {
  if (typeof c === "number") return numRat(c);
  return parseRatLiteral(c.trim());
}

/**
 * Radius of convergence of the Taylor series of `input` about x = `centre`.
 * A theorem or a refusal by name — never a reading of coefficients.
 */
export function radiusOfFunction(input: string, variable = "x", centre: number | string = 0): RadiusResult {
  const c = centreRat(centre);
  const cn = c ? ratToNumber(c) : NaN;
  const cDisp = c ? fmtRat(c) : String(centre);
  const text = input.trim();
  if (!c) return refused(`the centre ${String(centre)} is not an exact rational number.`, variable, cn, cDisp);
  if (text.length > MAX_INPUT) return refused(`the expression is longer than ${MAX_INPUT} characters.`, variable, cn, cDisp);
  if (nestingDepth(text) > MAX_NESTING) return refused(`the expression nests deeper than ${MAX_NESTING} levels.`, variable, cn, cDisp);
  let e: Expr;
  try {
    e = parseExpr(text);
  } catch (err) {
    const m = /Unknown function "([^"]+)"/.exec((err as Error).message);
    if (m) return refused(`${m[1]}(…) is outside the singularity table (rational functions, exp, log, powers, trig and inverse trig, hyperbolic).`, variable, cn, cDisp);
    return refused(`the expression did not parse (${(err as Error).message}).`, variable, cn, cDisp);
  }
  if (countNodes(e) > MAX_NODES) return refused(`the expression has more than ${MAX_NODES} parts — past the analysis cap.`, variable, cn, cDisp);
  const others = [...freeVars(e)].filter((v) => v !== variable && v !== "pi" && v !== "e");
  if (others.length) return refused(`the expression has another symbol (${others.join(", ")}); the radius is computed for a function of ${variable} alone.`, variable, cn, cDisp);
  for (const f of fnNames(e)) {
    if (NOT_ANALYTIC.has(f)) {
      return refused(`${f}(…) is not analytic — it has no complex-analytic extension, so no power series represents it.`, variable, cn, cDisp);
    }
  }
  const ctx: Ctx = { x: variable, c, cn, removable: [], notes: [], caveats: [], budget: 4000 };
  try {
    const sings = analyze(e, ctx, true);
    return assemble(format(e), e, sings, ctx, cDisp);
  } catch (err) {
    if (err instanceof RadiusRefusal) return refused(err.message, variable, cn, cDisp);
    // Anything else (a CAS bail, a stack overflow on a pathological input) is a
    // refusal too: the Taylor caller must never lose its series to the radius.
    return refused(`the singularity analysis could not complete (${(err as Error).message ?? "error"}).`, variable, cn, cDisp);
  }
}

function dedupe(list: Singularity[]): Singularity[] {
  const out: Singularity[] = [];
  for (const s of list) {
    const hit = out.find((t) => samePoint(s, t));
    if (!hit) out.push(s);
    else if (s.sure && !hit.sure) Object.assign(hit, s);
  }
  return out;
}

function describePoints(group: Singularity[]): string {
  const seen: string[] = [];
  for (const s of group) {
    const label = `the ${s.kind} at ${s.point}`;
    if (!seen.includes(label)) seen.push(label);
  }
  return seen.join(" and ");
}

const CAUCHY = "Cauchy–Taylor and Cauchy–Hadamard: the Taylor series converges on the largest disc about the centre on which the function is analytic, and diverges outside it — so R is the distance to the nearest singularity in ℂ";

function assemble(fText: string, e: Expr, raw: Singularity[], ctx: Ctx, cDisp: string): RadiusResult {
  const x = ctx.x;
  const sings = dedupe(raw).sort((a, b) => a.dist - b.dist);
  const removable = [...new Set(ctx.removable)];
  const base = { centre: ctx.cn, centreDisplay: cDisp, variable: x, removable };
  const caveats = [...new Set(ctx.caveats)];
  const lines: string[] = [];
  const remLine = removable.length
    ? `${removable.join(", ")}: removable (the numerator vanishes there to at least the same order), so not a singularity.`
    : "";
  if (!sings.length) {
    const line = `R = ∞ — ${fText} has no singularity in the complex plane${removable.length ? ` (${removable.join(", ")} is removable)` : ""}; its Taylor series about ${x} = ${cDisp} converges for every ${x}.`;
    lines.push(line);
    if (remLine) lines.push(remLine);
    lines.push(...ctx.notes);
    lines.push(`Theorem: ${CAUCHY}; with no singularity, R = ∞.`);
    return {
      ...base, kind: "infinite", value: Infinity, display: "∞", exact: undefined,
      theorem: CAUCHY, nearest: [], singularities: [],
      interval: { lo: "-∞", hi: "∞", loValue: -Infinity, hiValue: Infinity, loClosed: null, hiClosed: null, text: "(-∞, ∞)", reasons: [] },
      line, lines, caveats,
    };
  }
  const d = sings[0].dist;
  const near = (v: number): boolean => Math.abs(v - d) <= 1e-9 * Math.max(1, d);
  const group = sings.filter((s) => near(s.dist));
  const within = sings.filter((s) => s.dist <= 2 * Math.max(d, 1e-9) + 1e-12);

  // The centre itself is singular: no Taylor series there.
  if (d <= 1e-12) {
    const sure = group.find((s) => s.sure);
    const rest = sings.filter((s) => !near(s.dist));
    if (sure && sure.kind === "pole" && rest.length && rest[0].sure) {
      const r0 = rest[0];
      const disp = r0.distExact ?? `≈ ${sig(r0.dist)}`;
      const line = `No Taylor series about ${x} = ${cDisp}: the function has a pole at the centre. Its LAURENT series converges for 0 < ${absDiff(x, ctx.c)} <${r0.distExact ?? sig(r0.dist)} (the next singularity: ${describePoints(rest.filter((s) => Math.abs(s.dist - r0.dist) <= 1e-9 * Math.max(1, r0.dist)))}).`;
      return {
        ...base, kind: "centreSingular", theorem: "Laurent's theorem: a function analytic on 0 < |x − c| < ρ has a Laurent series there",
        laurentOuter: { value: r0.dist, display: disp }, nearest: group, singularities: within, line, lines: [line], caveats,
      };
    }
    const why = sure
      ? `the centre ${x} = ${cDisp} is a ${sure.kind} of the function, so it has no Taylor series there.`
      : `the centre ${x} = ${cDisp} may be a singularity (a candidate the rules could not rule out), so no Taylor series is asserted.`;
    return { ...refused(why, x, ctx.cn, cDisp), caveats };
  }

  const sure = group.some((s) => s.sure);
  const where = describePoints(group);
  const exact = group.find((s) => s.distExact)?.distExact;
  const dispR = exact ?? `≈ ${sig(d)}`;
  const eq = exact ? "=" : "≈";
  if (!sure) {
    const firstSure = sings.find((s) => s.sure);
    const upper = firstSure ? { value: firstSure.dist, display: firstSure.distExact ?? `≈ ${sig(firstSure.dist)}` } : undefined;
    const line = `R ≥ ${exact ?? sig(d)} — the nearest CANDIDATE singularity of ${fText} to ${x} = ${cDisp} is ${where} (distance ${exact ?? `≈ ${sig(d)}`}), but it may cancel, so this is a lower bound${upper ? `; the ${firstSure!.kind} at ${firstSure!.point} is proved, so R ≤ ${upper.display.replace(/^≈ /, "≈ ")}` : ""}.`;
    lines.push(line);
    lines.push(`Theorem: ${CAUCHY}. Every point closer than the candidates is a point of analyticity, which gives the lower bound.`);
    if (remLine) lines.push(remLine);
    lines.push(...ctx.notes);
    return {
      ...base, kind: "lowerBound", value: d, display: dispR, exact, upper,
      theorem: CAUCHY, nearest: group, singularities: within, line, lines, caveats,
    };
  }
  const realSmooth = sings.every((s) => s.im !== 0);
  const interval = decideInterval(e, ctx, d, exact);
  const line = `R ${eq} ${exact ?? sig(d)} — the nearest singularity of ${fText} to ${x} = ${cDisp} is ${where} (distance ${exact ?? `≈ ${sig(d)}`}); the series converges for ${absDiff(x, ctx.c)} < ${exact ?? sig(d)} and diverges for ${absDiff(x, ctx.c)} > ${exact ?? sig(d)}.`;
  lines.push(line);
  if (realSmooth) {
    const what = sings.every((s) => s.kind === "pole") ? "poles" : "singularities";
    lines.push(`${fText} is smooth on the whole real line; the radius is set by complex ${what}.`);
  }
  if (remLine) lines.push(remLine);
  lines.push(...ctx.notes);
  lines.push(`Theorem: ${CAUCHY}.`);
  if (!exact) caveats.push("R is the distance to a numerically located root; it is shown with ≈ and about 10 significant figures.");
  if (interval) {
    lines.push(`Interval of convergence: ${interval.text}`);
    lines.push(...interval.reasons);
  }
  return {
    ...base, kind: "finite", value: d, display: dispR, exact,
    theorem: CAUCHY, nearest: group, singularities: within, interval, line, lines, caveats,
  };
}

// ---------------------------------------------------------------------------
// Endpoints of the real interval — only by a named theorem
// ---------------------------------------------------------------------------

/** Strips a constant factor: k·h, h/k, −h → h. */
function stripConst(e: Expr, x: string): Expr {
  if (e.t === "neg") return stripConst(e.e, x);
  if (e.t === "mul" && !hasVar(e.l, x)) return stripConst(e.r, x);
  if (e.t === "mul" && !hasVar(e.r, x)) return stripConst(e.l, x);
  if (e.t === "div" && !hasVar(e.r, x)) return stripConst(e.l, x);
  return e;
}

function endpointText(c: Rat, R: string, sgn: 1 | -1, Rrat: Rat | null): string {
  if (Rrat) return fmtRat(sgn > 0 ? ratAdd(c, Rrat) : ratSub(c, Rrat));
  if (ratIsZero(c)) return sgn > 0 ? R : `-${paren(R)}`;
  return `${fmtRat(c)} ${sgn > 0 ? "+" : "-"} ${paren(R)}`;
}

function buildInterval(
  ctx: Ctx, d: number, exact: string | undefined, loClosed: boolean | null, hiClosed: boolean | null, reasons: string[],
): ConvergenceInterval {
  const Rrat = exact ? parseRatLiteral(exact) : null;
  const R = exact ?? sig(d);
  const lo = endpointText(ctx.c, R, -1, Rrat);
  const hi = endpointText(ctx.c, R, 1, Rrat);
  const open = loClosed ? "[" : "(";
  const close = hiClosed ? "]" : ")";
  const undecided = loClosed === null || hiClosed === null;
  return {
    lo, hi, loValue: ctx.cn - d, hiValue: ctx.cn + d, loClosed, hiClosed,
    text: `${open}${lo}, ${hi}${close}${undecided ? " — endpoints not determined (no named test applies here)" : ""}`,
    reasons,
  };
}

function decideInterval(e: Expr, ctx: Ctx, d: number, exact: string | undefined): ConvergenceInterval {
  const x = ctx.x;
  // (a) Rational: a pole on the circle |x − c| = R makes aₙRⁿ fail to tend to 0.
  if (reducedRational(e, x)) {
    return buildInterval(ctx, d, exact, false, false, [
      `Both endpoints diverge — divergence test: for a rational function with a pole on the circle |${x} - c| = R, the terms aₙ(${x} - c)ⁿ do not tend to 0 there.`,
    ]);
  }
  const core = stripConst(e, x);
  const linOf = (u: Expr): { a: Rat; b: Rat } | null => linearIn(u, x);
  // (b) log(αx + β), u(c) > 0: ln u(c) + Σ (−1)ⁿ⁺¹ wⁿ/n with w = α(x − c)/u(c).
  if (core.t === "fn" && ["ln", "log", "log10", "log2"].includes(core.name)) {
    const lin = linOf(core.arg);
    if (lin) {
      const U = ratAdd(ratMul(lin.a, ctx.c), lin.b);
      if (ratSign(U) > 0) {
        const plusIsW1 = ratSign(lin.a) > 0; // w = +1 at x = c + U/α
        const conv = "converges (conditionally) — alternating harmonic series, by the alternating series test";
        const div = "diverges — harmonic series (p-series with p = 1)";
        return buildInterval(ctx, d, exact, !plusIsW1, plusIsW1, [
          `At the ${plusIsW1 ? "right" : "left"} endpoint the series is Σ(−1)ⁿ⁺¹/n: ${conv}.`,
          `At the ${plusIsW1 ? "left" : "right"} endpoint (the branch point) it is −Σ1/n: ${div}.`,
        ]);
      }
    }
  }
  // (c) u^p with u linear, u(c) > 0, p non-integer: the binomial series in w = α(x − c)/u(c).
  let powU: Expr | null = null, p: Rat | null = null;
  if (core.t === "fn" && (core.name === "sqrt" || core.name === "cbrt")) {
    powU = core.arg;
    p = ratMake(1n, core.name === "sqrt" ? 2n : 3n);
  } else if (core.t === "pow" && !hasVar(core.r, x)) {
    powU = core.l;
    p = constRat(core.r);
  } else if (core.t === "div" && !hasVar(core.l, x) && core.r.t === "fn" && core.r.name === "sqrt") {
    powU = core.r.arg;
    p = ratMake(-1n, 2n);
  }
  if (powU && p && p.d !== 1n) {
    const lin = linOf(powU);
    if (lin && ratSign(ratAdd(ratMul(lin.a, ctx.c), lin.b)) > 0) {
      const pN = ratToNumber(p);
      const atW1 = pN > 0 ? true : pN > -1; // w = +1
      const atWm1 = pN > 0; // w = −1 (the branch point side)
      const w1Right = ratSign(lin.a) > 0;
      const loClosed = w1Right ? atWm1 : atW1;
      const hiClosed = w1Right ? atW1 : atWm1;
      const name = `binomial series Σ C(${fmtRat(p)}, n)·wⁿ (Gauss's test on the binomial coefficients)`;
      return buildInterval(ctx, d, exact, loClosed, hiClosed, [
        `At w = 1 the ${name} ${atW1 ? (pN > 0 ? "converges absolutely" : "converges conditionally") : "diverges"} (p = ${fmtRat(p)}${pN > 0 ? " > 0" : pN > -1 ? " in (−1, 0)" : " ≤ −1"}).`,
        `At w = −1 it ${atWm1 ? "converges absolutely (p > 0)" : "diverges (p < 0)"}.`,
      ]);
    }
  }
  // (d) atan(αx + β) centred where the argument is 0: Σ(−1)ⁿ w²ⁿ⁺¹/(2n+1).
  if (core.t === "fn" && core.name === "atan") {
    const lin = linOf(core.arg);
    if (lin && ratIsZero(ratAdd(ratMul(lin.a, ctx.c), lin.b))) {
      return buildInterval(ctx, d, exact, true, true, [
        "At both endpoints the series is ±Σ(−1)ⁿ/(2n + 1): converges (conditionally) by the alternating series test.",
      ]);
    }
  }
  return buildInterval(ctx, d, exact, null, null, []);
}

// ---------------------------------------------------------------------------
// Explicit general term: the ratio test, exactly, on the structure of aₙ
// ---------------------------------------------------------------------------

/**
 * Radius (and interval) of Σ term, where term = C · R(n) · gⁿ · (n!)ˢ · (αx + β)^(k·n + j):
 * R(n) rational in n (with n^p powers allowed), g rational, s an integer. Anything
 * else is refused by name.
 */
export function radiusOfSeriesTerm(termText: string, variable?: string, indexVar?: string): RadiusResult {
  try {
    return seriesTermInner(termText, variable, indexVar);
  } catch (err) {
    if (err instanceof RadiusRefusal) return refused(err.message, variable ?? "x", 0, "0");
    return refused(`the ratio test could not complete (${(err as Error).message ?? "error"}).`, variable ?? "x", 0, "0");
  }
}

function seriesTermInner(termText: string, variable?: string, indexVar?: string): RadiusResult {
  let text = termText.trim();
  const fallbackVar = variable ?? "x";
  const bad = (why: string): RadiusResult => refused(why, fallbackVar, 0, "0");
  if (text.length > MAX_INPUT) return bad(`the term is longer than ${MAX_INPUT} characters.`);
  if (nestingDepth(text) > MAX_NESTING) return bad(`the term nests deeper than ${MAX_NESTING} levels.`);
  // Pull factorials out before the parser (which has no factorial).
  const idxGuess = indexVar ?? (/\bk\b/.test(text) && !/\bn\b/.test(text) ? "k" : "n");
  const FACT = `${idxGuess}fct`;
  const idxRe = idxGuess;
  text = text
    .replace(new RegExp(`factorial\\(\\s*${idxRe}\\s*\\)`, "g"), FACT)
    .replace(new RegExp(`\\(\\s*${idxRe}\\s*\\)\\s*!`, "g"), FACT)
    .replace(new RegExp(`\\b${idxRe}\\s*!`, "g"), FACT);
  if (/!|factorial/.test(text)) {
    return bad(`only n! itself is handled; a factorial such as (2n)! or (n+1)! is outside the ratio-test forms here.`);
  }
  let e: Expr;
  try {
    e = parseExpr(text);
  } catch (err) {
    const m = /Unknown function "([^"]+)"/.exec((err as Error).message);
    if (m) return bad(`${m[1]}(…) in the general term is outside the ratio-test forms here.`);
    return bad(`the general term did not parse (${(err as Error).message}).`);
  }
  if (countNodes(e) > MAX_NODES) return bad(`the term has more than ${MAX_NODES} parts.`);
  const n = idxGuess;
  const vars = [...freeVars(e)].filter((v) => v !== n && v !== FACT && v !== "pi" && v !== "e");
  const x = variable ?? (vars.length === 1 ? vars[0] : vars.includes("x") ? "x" : vars[0]);
  if (!x) return bad("the term has no variable, so it is a numeric series, not a power series — there is no radius to compute.");
  if (vars.some((v) => v !== x)) return bad(`the term has more than one variable (${vars.join(", ")}).`);
  if (!hasVar(e, n)) return bad(`the term does not involve the index ${n}.`);

  // Flatten the product into factors with exponent ±1.
  const factors: { f: Expr; s: 1 | -1 }[] = [];
  // A sign (−term) changes no convergence question, so it is dropped.
  const flat = (node: Expr, s: 1 | -1): void => {
    if (node.t === "mul") { flat(node.l, s); flat(node.r, s); return; }
    if (node.t === "div") { flat(node.l, s); flat(node.r, s === 1 ? -1 : 1); return; }
    if (node.t === "neg") { flat(node.e, s); return; }
    factors.push({ f: node, s });
  };
  flat(e, 1);

  let g = RAT_ONE; // geometric ratio per step of n
  let fact = 0; // power of n!
  let degGap = RAT_ZERO; // degree of the rational-in-n part
  let base: { a: Rat; b: Rat } | null = null;
  let k = 0;
  for (const { f, s } of factors) {
    const hasX = hasVar(f, x), hasN = hasVar(f, n), hasF = hasVar(f, FACT);
    if (hasF) {
      if (f.t === "var") { fact += s; continue; }
      return bad(`n! may appear only as a factor of the term.`);
    }
    if (!hasX && !hasN) {
      const v = constRat(f);
      if (v && ratIsZero(v)) return bad("the term is identically zero.");
      continue; // a nonzero constant changes nothing
    }
    if (f.t === "pow" && hasVar(f.r, n)) {
      const E = reducedRational(f.r, n);
      if (!E || E.den.length !== 1 || E.num.length > 2) return bad(`the exponent ${format(f.r)} is not linear in ${n}.`);
      const kk = E.num.length === 2 ? ratDiv(E.num[1], E.den[0]) : RAT_ZERO;
      if (kk.d !== 1n || ratSign(kk) <= 0 || kk.n > 12n) return bad(`the exponent ${format(f.r)} must be k·${n} + j with a positive integer k ≤ 12.`);
      if (hasVar(f.l, n)) return bad(`${format(f)} has ${n} in both base and exponent — outside the ratio-test forms here.`);
      if (hasVar(f.l, x)) {
        if (base) return bad(`the term has more than one power of an expression in ${x}.`);
        if (s < 0) return bad(`dividing by ${format(f)} gives negative powers of ${x}: not a power series.`);
        base = linearIn(f.l, x);
        if (!base) return bad(`the base ${format(f.l)} is not linear in ${x} with rational coefficients.`);
        k = Number(kk.n);
        continue;
      }
      const B = constRat(f.l);
      if (!B || ratIsZero(B)) return bad(`the geometric factor ${format(f)} needs a nonzero rational base.`);
      const step = ratPowInt(B, Number(kk.n) * s);
      if (!step) return bad(`the geometric factor ${format(f)} could not be evaluated exactly.`);
      g = ratMul(g, step);
      continue;
    }
    if (hasX) return bad(`the factor ${format(f)} is not of the form (a·${x} + b)^(k·${n}) — the term is not a power series in this form.`);
    // A factor in n alone: rational in n, or a power n^p.
    if (f.t === "pow" && f.l.t === "var" && f.l.name === n) {
      const p = constRat(f.r);
      if (!p) return bad(`the power ${format(f)} needs an exact rational exponent.`);
      degGap = s > 0 ? ratAdd(degGap, p) : ratSub(degGap, p);
      continue;
    }
    if (f.t === "fn" && f.name === "sqrt" && f.arg.t === "var" && f.arg.name === n) {
      degGap = s > 0 ? ratAdd(degGap, ratMake(1n, 2n)) : ratSub(degGap, ratMake(1n, 2n));
      continue;
    }
    const P = reducedRational(f, n);
    if (!P) return bad(`the factor ${format(f)} is not a rational function of ${n} (logarithms and other functions of ${n} are outside the ratio-test forms here).`);
    const deg = ratInt((P.num.length - 1) - (P.den.length - 1));
    degGap = s > 0 ? ratAdd(degGap, deg) : ratSub(degGap, deg);
  }
  if (!base) return bad(`no power (a·${x} + b)^${n} was found — the term is not a power series in ${x}.`);

  const c = ratDiv(ratNeg(base.b), base.a);
  const cn = ratToNumber(c);
  const cDisp = fmtRat(c);
  const res0 = { centre: cn, centreDisplay: cDisp, variable: x, removable: [] as string[] };
  const theoremRatio = "the ratio test (Cauchy–Hadamard): R = lim |aₙ/aₙ₊₁|, computed exactly — the rational part of aₙ tends to 1 in the ratio, the geometric factor contributes 1/|g|, and n! contributes 0 or ∞";
  if (fact > 0) {
    const line = `R = 0 — the factorial dominates: |aₙ/aₙ₊₁| → 0, so the series converges only at ${x} = ${cDisp}.`;
    return { ...res0, kind: "zero", value: 0, exact: "0", display: "0", theorem: theoremRatio, nearest: [], singularities: [], line, lines: [line, `Theorem: ${theoremRatio}.`], caveats: [] };
  }
  if (fact < 0) {
    const line = `R = ∞ — 1/n! dominates: |aₙ/aₙ₊₁| → ∞, so the series converges for every ${x}.`;
    return {
      ...res0, kind: "infinite", value: Infinity, display: "∞", theorem: theoremRatio, nearest: [], singularities: [], line,
      lines: [line, `Theorem: ${theoremRatio}.`], caveats: [],
      interval: { lo: "-∞", hi: "∞", loValue: -Infinity, hiValue: Infinity, loClosed: null, hiClosed: null, text: "(-∞, ∞)", reasons: [] },
    };
  }
  // ρ = 1/|g| is the radius in w = (αx + β)^k; R = ρ^(1/k)/|α|.
  const rho = ratAbs(ratDiv(RAT_ONE, g));
  const root = ratRoot(rho, k);
  const aAbs = ratAbs(base.a);
  let exact: string;
  let Rrat: Rat | null = null;
  if (root) {
    Rrat = ratDiv(root, aAbs);
    exact = fmtRat(Rrat);
  } else if (k === 2) {
    const s = sqrtRatStr(ratDiv(rho, ratMul(aAbs, aAbs)));
    exact = s.str;
  } else {
    exact = `(${fmtRat(ratDiv(rho, ratPowInt(aAbs, k) as Rat))})^(1/${k})`;
  }
  const R = Math.pow(ratToNumber(rho), 1 / k) / ratToNumber(aAbs);
  const ctx: Ctx = { x, c, cn, removable: [], notes: [], caveats: [], budget: 100 };
  // Endpoints: at αx + β = σ·ρ^(1/k), the term is C·R(n)·(sign(g)·σᵏ)ⁿ.
  const dN = ratToNumber(degGap);
  const signG = ratSign(g);
  const pq = ratNeg(degGap);
  const pval = fmtRat(pq);
  const nPow = pq.d === 1n ? (pq.n === 1n ? `${n}` : `${n}^${pval}`) : `${n}^(${pval})`;
  const decide = (eps: number): { closed: boolean; why: string } => {
    if (dN > 0) return { closed: false, why: `diverges — divergence test: the terms do not tend to 0 (they grow like ${n}^${fmtRat(degGap).includes("/") ? `(${fmtRat(degGap)})` : fmtRat(degGap)})` };
    if (dN === 0) return { closed: false, why: `diverges — divergence test: the terms do not tend to 0 (their size tends to a nonzero constant)` };
    if (dN < -1) return { closed: true, why: `converges absolutely — p-series comparison with Σ1/${nPow}, p = ${pval} > 1` };
    if (eps > 0) return { closed: false, why: `diverges — limit comparison with the p-series Σ1/${nPow}, p = ${pval} ≤ 1${pval === "1" ? " (the harmonic series)" : ""}` };
    return { closed: true, why: `converges conditionally — alternating series test (the terms decrease to 0 like 1/${nPow}; not absolutely, since p = ${pval} ≤ 1)` };
  };
  // σ = +1 is the side where αx + β > 0.
  const plus = decide(signG * 1);
  const minus = decide(signG * (k % 2 === 0 ? 1 : -1));
  const rightIsPlus = ratSign(base.a) > 0;
  const hiD = rightIsPlus ? plus : minus;
  const loD = rightIsPlus ? minus : plus;
  const interval = buildInterval(ctx, R, exact, loD.closed, hiD.closed, [
    `At ${x} = ${endpointText(c, exact, -1, Rrat)}: ${loD.why}.`,
    `At ${x} = ${endpointText(c, exact, 1, Rrat)}: ${hiD.why}.`,
  ]);
  const absW = absDiff(x, c);
  const line = `R = ${exact} — by the ratio test the series converges for ${absW} < ${exact} and diverges for ${absW} > ${exact}.`;
  return {
    ...res0, kind: "finite", value: R, exact, display: exact, theorem: theoremRatio, nearest: [], singularities: [], interval, line,
    lines: [line, `Theorem: ${theoremRatio}.`, `Interval of convergence: ${interval.text}`, ...interval.reasons,
      "The first few terms (where the general term may be undefined, e.g. 1/n at n = 0) do not affect convergence."],
    caveats: [],
  };
}

/** The exact k-th root of a non-negative rational, or null when it is irrational. */
function ratRoot(q: Rat, k: number): Rat | null {
  const ir = (v: bigint): bigint | null => {
    if (v < 0n) return null;
    if (v < 2n) return v;
    // Newton on integers.
    let x = BigInt(Math.max(1, Math.floor(Math.pow(Number(v), 1 / k))));
    for (let i = 0; i < 200; i++) {
      const kb = BigInt(k);
      const next = ((kb - 1n) * x + v / x ** (kb - 1n)) / kb;
      if (next === x) break;
      x = next;
    }
    for (const cand of [x - 1n, x, x + 1n]) if (cand >= 0n && cand ** BigInt(k) === v) return cand;
    return null;
  };
  const a = ir(q.n), b = ir(q.d);
  return a !== null && b !== null ? ratMake(a, b) : null;
}

// ---------------------------------------------------------------------------
// Requests and the verb
// ---------------------------------------------------------------------------

export interface RadiusRequest {
  mode: "radius" | "interval";
  kind: "function" | "sum";
  expr: string;
  variable: string;
  centre: string;
}

/**
 * "radius of convergence of 1/(1-x) about 2", "radius of convergence sum x^n/n",
 * "interval of convergence of sum (x-3)^n/(n*2^n)", "radius of convergence Σ x^n".
 */
export function parseRadiusRequest(text: string): RadiusRequest | null {
  const m = /^\s*(?:find\s+|what\s+is\s+|compute\s+)?(?:the\s+)?(radius|interval)\s+of\s+convergence\s+(?:of\s+|for\s+)?(?:the\s+)?(.+?)\s*\??\s*$/i.exec(text);
  if (!m) return null;
  const mode = m[1].toLowerCase() === "interval" ? "interval" : "radius";
  let rest = m[2].trim();
  rest = rest.replace(/^(?:(?:taylor|maclaurin|power)\s+)?series\s+(?:of\s+|for\s+)?/i, "");
  const sum = /^(?:sum|Σ|∑)\s*(?:_?\{?\s*([a-z])\s*=\s*-?\d+\s*\}?(?:\^\{?\s*(?:∞|inf(?:inity)?|oo)\s*\}?)?)?\s*(.+)$/i.exec(rest);
  if (sum) {
    let term = sum[2].trim();
    let idx = sum[1];
    const tail = /\s*,?\s*(?:from\s+|for\s+)?([a-z])\s*(?:=|>=|≥)\s*-?\d+(?:\s*(?:to|\.\.)\s*(?:∞|inf(?:inity)?|oo))?\s*$/i.exec(term);
    if (tail) {
      idx = idx ?? tail[1];
      term = term.slice(0, tail.index).trim();
    }
    term = term.replace(/,\s*$/, "");
    if (!term) return null;
    return { mode, kind: "sum", expr: term, variable: idx ?? "", centre: "0" };
  }
  let centre = "0", variable = "x";
  const about = /\s+(?:about|at|around|centred\s+at|centered\s+at)\s+(?:([A-Za-z]\w*)\s*=\s*)?(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*$/i.exec(rest);
  if (about) {
    centre = about[2];
    if (about[1]) variable = about[1];
    rest = rest.slice(0, about.index).trim();
  }
  if (!rest) return null;
  if (!about) {
    // A single free variable other than x names itself.
    const vs = (rest.match(/\b[a-z]\b/gi) ?? []).filter((v) => v !== "e" && v !== "i");
    const uniq = [...new Set(vs)];
    if (uniq.length === 1) variable = uniq[0];
  }
  return { mode, kind: "function", expr: rest, variable, centre };
}

/** The radius verb: VerbResult for the pane's verb chain, or null when the text is not a radius request. */
export function tryRadius(text: string): VerbResult | null {
  const req = parseRadiusRequest(text);
  if (!req) return null;
  const r = req.kind === "sum"
    ? radiusOfSeriesTerm(req.expr, undefined, req.variable || undefined)
    : radiusOfFunction(req.expr, req.variable, req.centre);
  const title = req.mode === "interval" ? "Interval of convergence" : "Radius of convergence";
  const lines: { text: string; math?: boolean }[] = [];
  if (r.kind === "refused") {
    lines.push({ text: r.reason ?? "Not determined." });
    lines.push({ text: NAMED_REFUSAL });
    return { title, lines, caveats: r.caveats };
  }
  if (r.kind === "finite" && r.exact) lines.push({ text: `R = ${r.exact}`, math: true });
  else if (r.kind === "zero") lines.push({ text: "R = 0", math: true });
  for (const l of r.lines) lines.push({ text: l });
  if (req.mode === "interval" && r.kind === "finite" && !r.interval) lines.push({ text: "Endpoints not determined." });
  const svg = radiusSvg(r);
  return {
    title, lines, caveats: r.caveats,
    ...(svg ? { svg, alt: `Complex plane: disc of convergence about ${r.variable} = ${r.centreDisplay}${r.display ? `, R = ${r.display}` : ""}.` } : {}),
  };
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The complex plane: the centre, the disc of radius R, every candidate
 * singularity within 2R labelled (pole / branch point / …), and the real
 * interval with closed (filled), open (hollow) or undetermined (grey) ends.
 * Empty string when there is nothing to draw (refused, or R = 0 / ∞).
 */
export function radiusSvg(r: RadiusResult): string {
  if (!(r.kind === "finite" || r.kind === "lowerBound") || !r.value || !Number.isFinite(r.value)) return "";
  const W = 480, H = 320, cx0 = W / 2, cy0 = H / 2 + 6;
  const R = r.value;
  const pts = r.singularities.filter((s) => s.dist <= 2 * R + 1e-12);
  let span = 1.25 * R;
  for (const s of pts) span = Math.max(span, Math.abs(s.re - r.centre) * 1.12, Math.abs(s.im) * 1.12);
  const scale = (Math.min(W, H) / 2 - 40) / span;
  const X = (re: number): number => cx0 + (re - r.centre) * scale;
  const Y = (im: number): number => cy0 - im * scale;
  const font = `font-family="Segoe UI, Helvetica, Arial, sans-serif"`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${W / 2}" y="18" text-anchor="middle" font-size="13" font-weight="600" ${font} fill="#111827">${escapeXml(`Disc of convergence about ${r.variable} = ${r.centreDisplay}: R ${r.kind === "lowerBound" ? "≥" : r.exact ? "=" : "≈"} ${(r.display ?? "").replace(/^≈ /, "")}`)}</text>`);
  // Axes.
  parts.push(`<line x1="16" y1="${cy0}" x2="${W - 16}" y2="${cy0}" stroke="#9ca3af" stroke-width="1"/>`);
  parts.push(`<line x1="${X(0)}" y1="30" x2="${X(0)}" y2="${H - 10}" stroke="#d1d5db" stroke-width="1"/>`);
  parts.push(`<text x="${W - 18}" y="${cy0 - 6}" text-anchor="end" font-size="11" ${font} fill="#6b7280">Re ${escapeXml(r.variable)}</text>`);
  parts.push(`<text x="${X(0) + 4}" y="40" font-size="11" ${font} fill="#6b7280">Im ${escapeXml(r.variable)}</text>`);
  // Disc.
  parts.push(`<circle cx="${cx0}" cy="${cy0}" r="${R * scale}" fill="#2563eb" fill-opacity="0.10" stroke="#2563eb" stroke-width="1.5"${r.kind === "lowerBound" ? ` stroke-dasharray="5 4"` : ""}/>`);
  // Real interval.
  const iv = r.interval;
  const lo = X(r.centre - R), hi = X(r.centre + R);
  parts.push(`<line x1="${lo}" y1="${cy0}" x2="${hi}" y2="${cy0}" stroke="#15803d" stroke-width="4"/>`);
  const end = (px: number, closed: boolean | null | undefined): string =>
    closed === true
      ? `<circle cx="${px}" cy="${cy0}" r="5" fill="#15803d"/>`
      : closed === false
        ? `<circle cx="${px}" cy="${cy0}" r="5" fill="#ffffff" stroke="#15803d" stroke-width="2"/>`
        : `<circle cx="${px}" cy="${cy0}" r="5" fill="#d1d5db" stroke="#6b7280" stroke-width="1.5"/>`;
  parts.push(end(lo, iv?.loClosed));
  parts.push(end(hi, iv?.hiClosed));
  // Centre.
  parts.push(`<circle cx="${cx0}" cy="${cy0}" r="3.5" fill="#111827"/>`);
  parts.push(`<text x="${cx0 + 6}" y="${cy0 + 16}" font-size="11" ${font} fill="#111827">${escapeXml(`c = ${r.centreDisplay}`)}</text>`);
  // Singularities.
  let labelled = 0;
  for (const s of pts) {
    const px = X(s.re), py = Y(s.im);
    const col = s.sure ? "#b91c1c" : "#b45309";
    if (s.kind === "branch point") parts.push(`<circle cx="${px}" cy="${py}" r="5" fill="none" stroke="${col}" stroke-width="2"/>`);
    else parts.push(`<path d="M${px - 5} ${py - 5} L${px + 5} ${py + 5} M${px - 5} ${py + 5} L${px + 5} ${py - 5}" stroke="${col}" stroke-width="2"/>`);
    if (labelled < 8) {
      labelled++;
      const tag = s.kind === "branch point" ? "branch pt" : s.kind === "essential singularity" ? "essential" : s.kind;
      parts.push(`<text x="${px + 7}" y="${py - 7}" font-size="10" ${font} fill="${col}">${escapeXml(`${tag}${s.sure ? "" : "?"}`)}</text>`);
    }
  }
  // Figure text: a hyphen-minus used as a minus ("(-1, 1)", "c - R") is set as
  // U+2212 (display contract). A hyphen inside a word or after an exponent's e is
  // left alone.
  const legend = iv ? `Real interval ${iv.text.split(" — ")[0].replace(/(?<![\p{L}\p{N}])-/gu, () => "−")}` : "";
  if (legend) {
    // PLACED BY SCORE, NOT AT A FIXED SPOT: a fixed bottom-centre legend sat on
    // the imaginary axis whenever the centre was near 0. Every drawn segment is
    // recorded (axes, interval, the disc as chords, each singularity's mark and
    // label) and the candidate box crossing the fewest is used, kept on-canvas.
    type Seg = [number, number, number, number];
    const segs: Seg[] = [
      [16, cy0, W - 16, cy0],
      [X(0), 30, X(0), H - 10],
      [lo, cy0, hi, cy0],
    ];
    const rr = R * scale;
    for (let k = 0; k < 48; k++) {
      const a0 = (2 * Math.PI * k) / 48, a1 = (2 * Math.PI * (k + 1)) / 48;
      segs.push([cx0 + rr * Math.cos(a0), cy0 + rr * Math.sin(a0), cx0 + rr * Math.cos(a1), cy0 + rr * Math.sin(a1)]);
    }
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [
      { x0: lo - 6, y0: cy0 - 6, x1: lo + 6, y1: cy0 + 6 },
      { x0: hi - 6, y0: cy0 - 6, x1: hi + 6, y1: cy0 + 6 },
      { x0: cx0 - 4, y0: cy0 - 4, x1: cx0 + 90, y1: cy0 + 20 },
    ];
    for (const s of pts) boxes.push({ x0: X(s.re) - 6, y0: Y(s.im) - 20, x1: X(s.re) + 70, y1: Y(s.im) + 6 });
    const fs = 11;
    const tw = legend.length * fs * 0.58;
    const th = fs * 1.3;
    const hitsSeg = (b: { x0: number; y0: number; x1: number; y1: number }, s: Seg): boolean => {
      // Sample the segment; fine enough at these sizes.
      for (let t = 0; t <= 1; t += 0.02) {
        const px = s[0] + (s[2] - s[0]) * t, py = s[1] + (s[3] - s[1]) * t;
        if (px >= b.x0 - 2 && px <= b.x1 + 2 && py >= b.y0 - 2 && py <= b.y1 + 2) return true;
      }
      return false;
    };
    const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a): boolean =>
      a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    let best: { x: number; y: number; s: number } | null = null;
    const ys = [H - 8, H - 24, 40, 56, cy0 + 22, cy0 - 12];
    const xs = [W / 2, 8 + tw / 2, W - 8 - tw / 2, X(0) + 10 + tw / 2, X(0) - 10 - tw / 2];
    for (const y of ys) {
      for (const x of xs) {
        const b = { x0: x - tw / 2, y0: y - th * 0.8, x1: x + tw / 2, y1: y + th * 0.2 };
        if (b.x0 < 2 || b.x1 > W - 2 || b.y0 < 24 || b.y1 > H - 2) continue;
        let s = 0;
        for (const sg of segs) if (hitsSeg(b, sg)) s += 1;
        for (const o of boxes) if (overlap(o, b)) s += 3;
        if (!best || s < best.s) best = { x, y, s };
      }
    }
    const at = best ?? { x: W / 2, y: H - 8 };
    // A white halo under the text, so even a forced crossing stays legible.
    parts.push(`<text x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}" text-anchor="middle" font-size="${fs}" ${font} fill="#15803d" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(legend)}</text>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

// Exported for tests that pin the exact helpers.
export const __test = { sqrtRatStr, fmtLinPi, squareFree, ratRoot, exactAt, polyGcd, ratPolyMul };
