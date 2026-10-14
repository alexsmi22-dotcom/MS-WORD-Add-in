/**
 * Fourier series of a periodic function given on one period.
 *
 *   fourier series t on (-pi, pi)
 *   fourier series t^2 on (-pi, pi)
 *   fourier series -1 on (-pi, 0); 1 on (0, pi)        ← a square wave, by pieces
 *   fourier series abs(t) on (-pi, pi)                  ← abs(linear) is split for you
 *   fourier series exp(t) on (-1, 1)
 *   fourier series sin(t)^2 on (-pi, pi)                ← a terminating series
 *
 * THE RESULT IS EXACT AND SYMBOLIC IN n WHERE THAT IS POSSIBLE: the pieces
 * are polynomials, exponentials or pure sinusoids at a multiple of the
 * fundamental, and the integrals ∫ p(t) cos(nπt/L) dt are done by tabular
 * integration by parts with n a symbol. At the period's ends the values
 * sin(nπ·m) = 0 and cos(nπ·m) = (−1)^{nm} are substituted BEFORE anything
 * is simplified, so the coefficients come out as 4·(−1)^n/n², not as a
 * floating-point residue — the simplifier in cas.ts folds sin(pi) to
 * 1.2e-16, which is why this module never lets it see one.
 *
 * When a piece boundary is not a whole multiple of the half-period, no closed
 * form in n exists through this route; the first N coefficients are then
 * computed exactly one by one and the result says so.
 *
 * EVERY SERIES IS CHECKED against numerical integration of the coefficient
 * integrals for n = 0..5. A mismatch withholds the result. The partial sum
 * S₅ is drawn against f over one period, and the caveats say where the
 * series converges to the midpoint of a jump and overshoots beside it (Gibbs).
 *
 * Refused by name: pieces outside the forms above (products of polynomials
 * and sinusoids, logarithms, 1/t), sinusoids whose frequency is not a
 * multiple of the fundamental, non-contiguous pieces, a zero-length period.
 */
import { Expr, parseExpr, format, evalAst, freeVars, derivative, simplify } from "./solve";
import {
  casSimplify,
  substituteVar,
  polyInVar,
  Rat,
  ratInt,
  ratAdd,
  ratSub,
  ratMul,
  ratDiv,
  ratNeg,
  ratIsZero,
  ratToNumber,
  ratFromNumber,
  ratToExpr,
  ratEq,
  parseRatLiteral,
  CasBail,
} from "./cas";
import type { VerbResult } from "./algebraTools";
import { exactSimplify, hasVar, piMultiple } from "./exact";
import { fmtRat } from "./geometry";

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });
const FN = (name: string, arg: Expr): Expr => ({ t: "fn", name, arg });
const ADD = (l: Expr, r: Expr): Expr => ({ t: "add", l, r });
const SUB = (l: Expr, r: Expr): Expr => ({ t: "sub", l, r });
const MUL = (l: Expr, r: Expr): Expr => ({ t: "mul", l, r });
const DIV = (l: Expr, r: Expr): Expr => ({ t: "div", l, r });
const POW = (l: Expr, r: Expr): Expr => ({ t: "pow", l, r });
const NEG = (e: Expr): Expr => ({ t: "neg", e });
const PI = V("pi");
const isNum = (e: Expr, v?: number): boolean => e.t === "num" && (v === undefined || e.v === v);
const rat = (q: Rat): Expr => ratToExpr(q);

function mul(...fs: Expr[]): Expr {
  let neg = false;
  const parts: Expr[] = [];
  for (let f of fs) {
    while (f.t === "neg") {
      neg = !neg;
      f = f.e;
    }
    if (f.t === "num" && f.v < 0) {
      neg = !neg;
      f = N(-f.v);
    }
    if (isNum(f, 0)) return N(0);
    if (!isNum(f, 1)) parts.push(f);
  }
  const p = parts.length ? parts.reduce((acc, f) => MUL(acc, f)) : N(1);
  return neg ? NEG(p) : p;
}
function add(...fs: Expr[]): Expr {
  const parts = fs.filter((f) => !isNum(f, 0));
  if (!parts.length) return N(0);
  return parts.reduce((acc, f) => (f.t === "neg" ? SUB(acc, f.e) : ADD(acc, f)));
}
/** Simplify with π and every function of a constant kept symbolic (exact.ts). */
function S(e: Expr): Expr {
  return exactSimplify(e);
}

/** A plain rational constant, else null. */
function plainRat(e: Expr): Rat | null {
  if (freeVars(e).length) return null;
  const q = parseRatLiteral(format(e));
  if (q) return q;
  try {
    const p = polyInVar(S(e), "__none__");
    if (p && p.length === 1) return p[0];
  } catch {
    /* no */
  }
  const v = evalAst(e, {});
  const r = ratFromNumber(v);
  return Math.abs(ratToNumber(r) - v) < 1e-12 ? r : null;
}

/** A bound: either q·π (piRat) or a plain rational (plain). */
interface Bound {
  expr: Expr;
  value: number;
  piRat: Rat | null;
  plain: Rat | null;
}
function readBound(text: string): Bound | null {
  let e: Expr;
  try {
    e = parseExpr(text);
  } catch {
    return null;
  }
  if (freeVars(e).some((v) => v !== "pi")) return null;
  const value = evalAst(e, {});
  if (!Number.isFinite(value)) return null;
  const piRat = piMultiple(e) ?? (value === 0 ? ratInt(0) : null);
  return { expr: e, value, piRat, plain: piRat && !ratIsZero(piRat) ? null : hasVar(e, "pi") ? null : plainRat(e) };
}

interface Piece {
  expr: Expr;
  lo: Bound;
  hi: Bound;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

const HEAD_RE = /^\s*fourier\s+series(?:\s+of)?\s*[:]?\s*(.+)$/i;
const PIECE_RE = /^(.+?)\s+(?:on|for|over)\s*\(?\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)?\s*$/i;

export interface FourierRequest {
  pieces: Piece[];
  variable: string;
}

export function parseFourierRequest(text: string): FourierRequest | { error: string } | null {
  const m = HEAD_RE.exec(text);
  if (!m) return null;
  if (m[1].includes("=")) return null;
  const parts = m[1].split(/\s*;\s*/).filter(Boolean);
  const pieces: Piece[] = [];
  let variable: string | null = null;
  for (const p of parts) {
    const pm = PIECE_RE.exec(p.trim());
    if (!pm) return { error: `Each piece needs an interval: "${p.trim()}" should read like  t^2 on (-pi, pi)` };
    let e: Expr;
    try {
      e = parseExpr(pm[1]);
    } catch (err) {
      return { error: `Couldn't read "${pm[1]}": ${(err as Error).message}` };
    }
    const lo = readBound(pm[2]);
    const hi = readBound(pm[3]);
    if (!lo || !hi) return { error: `The interval bounds must be numbers or multiples of pi: (${pm[2]}, ${pm[3]})` };
    if (!(hi.value > lo.value)) return { error: `The interval (${pm[2]}, ${pm[3]}) is empty.` };
    const vars = freeVars(e).filter((v) => v !== "pi" && v !== "e");
    if (vars.length > 1) return { error: `The function must depend on one variable; found ${vars.join(", ")}.` };
    if (vars.length === 1) {
      if (variable && variable !== vars[0]) return { error: `Pieces use different variables (${variable}, ${vars[0]}).` };
      variable = vars[0];
    }
    pieces.push({ expr: e, lo, hi });
  }
  variable = variable ?? "t";
  // Contiguous, in order.
  pieces.sort((a, b) => a.lo.value - b.lo.value);
  for (let i = 1; i < pieces.length; i++) {
    if (Math.abs(pieces[i].lo.value - pieces[i - 1].hi.value) > 1e-12) {
      return { error: "The pieces must join up to cover one period with no gap or overlap." };
    }
  }
  // abs(linear) is split at its root into two polynomial pieces.
  const split: Piece[] = [];
  for (const pc of pieces) {
    const s = splitAbs(pc, variable);
    if ("error" in s) return s;
    split.push(...s.pieces);
  }
  return { pieces: split, variable };
}

/** abs(a·t + b) → two pieces at t = −b/a when the root lies inside. */
function splitAbs(pc: Piece, t: string): { pieces: Piece[] } | { error: string } {
  const e = pc.expr;
  const findAbs = (x: Expr): Expr | null => {
    switch (x.t) {
      case "num":
      case "var":
        return null;
      case "neg":
        return findAbs(x.e);
      case "fn":
        return x.name === "abs" ? x.arg : findAbs(x.arg);
      default:
        return findAbs(x.l) ?? findAbs(x.r);
    }
  };
  const inner = findAbs(e);
  if (!inner) return { pieces: [pc] };
  const p = polyInVar(inner, t);
  if (!p || p.length > 2) return { error: "abs(…) is split for you only when its argument is linear in the variable." };
  const a = p[1] ?? ratInt(0);
  const b = p[0] ?? ratInt(0);
  const replaceAbs = (x: Expr, sign: 1 | -1): Expr => {
    switch (x.t) {
      case "num":
      case "var":
        return x;
      case "neg":
        return NEG(replaceAbs(x.e, sign));
      case "fn":
        return x.name === "abs" && x.arg === inner ? (sign > 0 ? inner : NEG(inner)) : FN(x.name, replaceAbs(x.arg, sign));
      default:
        return { ...x, l: replaceAbs(x.l, sign), r: replaceAbs(x.r, sign) } as Expr;
    }
  };
  if (ratIsZero(a)) return { pieces: [{ ...pc, expr: replaceAbs(e, ratToNumber(b) >= 0 ? 1 : -1) }] };
  const root = ratToNumber(ratNeg(ratDiv(b, a)));
  const rootBound: Bound = { expr: rat(ratNeg(ratDiv(b, a))), value: root, piRat: null, plain: ratNeg(ratDiv(b, a)) };
  const positiveRight = ratToNumber(a) > 0;
  if (root <= pc.lo.value || root >= pc.hi.value) {
    const mid = (pc.lo.value + pc.hi.value) / 2;
    const sign: 1 | -1 = ratToNumber(a) * mid + ratToNumber(b) >= 0 ? 1 : -1;
    return { pieces: [{ ...pc, expr: replaceAbs(e, sign) }] };
  }
  return {
    pieces: [
      { expr: replaceAbs(e, positiveRight ? -1 : 1), lo: pc.lo, hi: rootBound },
      { expr: replaceAbs(e, positiveRight ? 1 : -1), lo: rootBound, hi: pc.hi },
    ],
  };
}

// ---------------------------------------------------------------------------
// The coefficient integrals, symbolic in n
// ---------------------------------------------------------------------------

/** How a piece is integrated. */
type PieceForm =
  | { kind: "poly"; coeffs: Expr[] }
  | { kind: "exp"; coef: Expr; c: Rat }
  | { kind: "sinusoid"; coef: Expr; fn: "sin" | "cos"; k: Rat /* multiple of π/L */; raw: Expr };

class Refuse extends Error {}

function classifyPiece(e: Expr, t: string, L: Expr, Lnum: number): PieceForm[] {
  // A sum splits into forms; each summand must be one form.
  const terms = flattenSum(e);
  const out: PieceForm[] = [];
  for (const { sign, term } of terms) {
    const f = sign < 0 ? NEG(term) : term;
    const p = symbolicPoly(f, t);
    if (p) {
      if (p.length > 9) throw new Refuse("polynomial pieces up to degree 8");
      out.push({ kind: "poly", coeffs: p });
      continue;
    }
    // c · exp(k t)
    const factors = flattenMul(f.t === "neg" ? f.e : f);
    const signE = f.t === "neg" ? -1 : 1;
    const consts = factors.filter((x) => !freeVars(x).includes(t));
    const varying = factors.filter((x) => freeVars(x).includes(t));
    if (varying.length === 1) {
      const g = varying[0];
      const coef = mul(N(signE), ...consts);
      if (g.t === "fn" && g.name === "exp") {
        const lin = polyInVar(g.arg, t);
        if (lin && lin.length === 2 && ratIsZero(lin[0])) {
          out.push({ kind: "exp", coef, c: lin[1] });
          continue;
        }
        throw new Refuse("exponentials of the form exp(c·t) with rational c and no constant term");
      }
      if (g.t === "pow" && g.l.t === "var" && g.l.name === "e") {
        const lin = polyInVar(g.r, t);
        if (lin && lin.length === 2 && ratIsZero(lin[0])) {
          out.push({ kind: "exp", coef, c: lin[1] });
          continue;
        }
      }
      if (g.t === "fn" && (g.name === "sin" || g.name === "cos")) {
        // frequency must be a multiple k·π/L of the fundamental
        const lin = polyInVar(g.arg, t);
        if (lin && lin.length === 2 && ratIsZero(lin[0])) {
          const w = ratToNumber(lin[1]);
          const kNum = (w * Lnum) / Math.PI;
          const kRat = ratFromNumber(kNum);
          if (Math.abs(ratToNumber(kRat) - kNum) < 1e-9 && kRat.d === 1n && kRat.n > 0n) {
            out.push({ kind: "sinusoid", coef, fn: g.name, k: kRat, raw: g });
            continue;
          }
        }
        // also k·π·t/L written with pi: arg = (k π / L) t
        const argAtOne = evalAst(g.arg, { [t]: 1 });
        const kNum2 = (argAtOne * Lnum) / Math.PI;
        const kRat2 = ratFromNumber(kNum2);
        if (lin === null && Number.isFinite(argAtOne) && Math.abs(ratToNumber(kRat2) - kNum2) < 1e-9 && kRat2.d === 1n && kRat2.n > 0n && evalAst(g.arg, { [t]: 0 }) === 0) {
          out.push({ kind: "sinusoid", coef, fn: g.name, k: kRat2, raw: g });
          continue;
        }
        throw new Refuse("sinusoids whose frequency is a whole multiple of the fundamental π/L (sin(k·π·t/L)) and that span the full period");
      }
      if (g.t === "pow" && g.l.t === "fn" && (g.l.name === "sin" || g.l.name === "cos") && isNum(g.r, 2)) {
        // sin² = (1 − cos 2x)/2, cos² = (1 + cos 2x)/2 — then classify again
        const twice = mul(N(2), g.l.arg);
        const half = DIV(N(1), N(2));
        const rewritten =
          g.l.name === "sin" ? SUB(half, mul(half, FN("cos", twice))) : ADD(half, mul(half, FN("cos", twice)));
        out.push(...classifyPiece(mul(coef, rewritten), t, L, Lnum));
        continue;
      }
    }
    throw new Refuse("polynomials, exp(c·t), and sin/cos at a multiple of the fundamental (sums of those)");
  }
  return out;
}

/**
 * Coefficients of a polynomial in t whose coefficients are CONSTANTS (π and
 * other symbolic constants allowed), by Taylor at 0; null when f is not such
 * a polynomial. polyInVar wants rational coefficients, so π·t was refused.
 */
function symbolicPoly(f: Expr, t: string, maxDeg = 9): Expr[] | null {
  const coeffs: Expr[] = [];
  let d: Expr = f;
  let fact = 1;
  for (let k = 0; k <= maxDeg; k++) {
    const atZero = S(substituteVar(d, t, N(0)));
    if (freeVars(atZero).length) return null;
    coeffs.push(k === 0 ? atZero : S(DIV(atZero, N(fact))));
    d = S(derivative(d, t));
    fact *= k + 1;
    if (isNum(d, 0)) break;
    if (k === maxDeg) return null;
  }
  // The expansion must reproduce f exactly (a non-polynomial has a non-zero remainder).
  const rebuilt = polyExpr(coeffs, t);
  const diff = S(SUB(f, rebuilt));
  if (!isNum(diff, 0)) return null;
  while (coeffs.length > 1 && isNum(coeffs[coeffs.length - 1], 0)) coeffs.pop();
  return coeffs;
}

function flattenSum(e: Expr, sign = 1, out: { sign: number; term: Expr }[] = []): { sign: number; term: Expr }[] {
  if (e.t === "add") {
    flattenSum(e.l, sign, out);
    flattenSum(e.r, sign, out);
  } else if (e.t === "sub") {
    flattenSum(e.l, sign, out);
    flattenSum(e.r, -sign, out);
  } else if (e.t === "neg") flattenSum(e.e, -sign, out);
  else out.push({ sign, term: e });
  return out;
}
function flattenMul(e: Expr, out: Expr[] = []): Expr[] {
  if (e.t === "mul") {
    flattenMul(e.l, out);
    flattenMul(e.r, out);
  } else out.push(e);
  return out;
}

/**
 * ∫ p(t)·cos(ωt) dt and ∫ p(t)·sin(ωt) dt by tabular parts, as expressions
 * in t, with ω an expression (n·π/L). Returns the antiderivative.
 */
function polyTrigAntiderivative(coeffs: Expr[], t: string, omega: Expr, which: "cos" | "sin"): Expr {
  const T = V(t);
  let p: Expr = polyExpr(coeffs, t);
  const parts: Expr[] = [];
  const sinW = FN("sin", mul(omega, T));
  const cosW = FN("cos", mul(omega, T));
  // cos: + p sin/ω + p' cos/ω² − p'' sin/ω³ − p''' cos/ω⁴ + …
  // sin: − p cos/ω + p' sin/ω² + p'' cos/ω³ − p''' sin/ω⁴ − …
  for (let k = 0; k <= coeffs.length; k++) {
    const trig = which === "cos" ? (k % 2 === 0 ? sinW : cosW) : k % 2 === 0 ? cosW : sinW;
    const cycle = k % 4;
    const sign = which === "cos" ? (cycle === 0 || cycle === 1 ? 1 : -1) : cycle === 1 || cycle === 2 ? 1 : -1;
    const denom = k === 0 ? omega : POW(omega, N(k + 1));
    parts.push(mul(N(sign), DIV(mul(p, trig), denom)));
    p = S(derivative(p, t));
    if (isNum(p, 0)) break;
  }
  return add(...parts);
}

function polyExpr(coeffs: Expr[], t: string): Expr {
  const parts: Expr[] = [];
  coeffs.forEach((c, k) => {
    if (isNum(c, 0)) return;
    parts.push(mul(c, k === 0 ? N(1) : k === 1 ? V(t) : POW(V(t), N(k))));
  });
  return parts.length ? add(...parts) : N(0);
}

/** ∫ e^{ct} cos(ωt) and ∫ e^{ct} sin(ωt). */
function expTrigAntiderivative(c: Rat, t: string, omega: Expr, which: "cos" | "sin"): Expr {
  const T = V(t);
  const E = FN("exp", mul(rat(c), T));
  const den = add(rat(ratMul(c, c)), POW(omega, N(2)));
  const sinW = FN("sin", mul(omega, T));
  const cosW = FN("cos", mul(omega, T));
  if (which === "cos") return DIV(mul(E, add(mul(rat(c), cosW), mul(omega, sinW))), den);
  return DIV(mul(E, SUB(mul(rat(c), sinW), mul(omega, cosW))), den);
}

/**
 * Evaluates an antiderivative at a bound where the argument n·π·t/L becomes
 * n·π·m with m a whole number: sin → 0, cos → (−1)^{nm}. Returns null when
 * the bound is not such a multiple (no closed form in n through this route).
 */
function atBoundSymbolic(F: Expr, t: string, bound: Bound, L: Bound, n: string): Expr | null {
  // m = bound / L must be an integer
  let m: Rat | null = null;
  if (bound.piRat && L.piRat) m = ratDiv(bound.piRat, L.piRat);
  else if (bound.plain && L.plain) m = ratDiv(bound.plain, L.plain);
  else if (bound.plain && ratIsZero(bound.plain)) m = ratInt(0);
  if (!m || m.d !== 1n) return null;
  const mInt = Number(m.n);
  const sub = substituteVar(F, t, bound.expr);
  const parity = Math.abs(mInt) % 2;
  const walk = (x: Expr): Expr => {
    switch (x.t) {
      case "num":
      case "var":
        return x;
      case "neg":
        return NEG(walk(x.e));
      case "fn": {
        if ((x.name === "sin" || x.name === "cos") && freeVars(x.arg).includes(n)) {
          // the argument is (n π / L)·bound = n·π·m
          if (x.name === "sin") return N(0);
          if (mInt === 0 || parity === 0) return N(1);
          return POW(NEG(N(1)), V(n));
        }
        return FN(x.name, walk(x.arg));
      }
      default:
        return { ...x, l: walk(x.l), r: walk(x.r) } as Expr;
    }
  };
  return walk(sub);
}

// ---------------------------------------------------------------------------
// The series
// ---------------------------------------------------------------------------

export interface FourierSeries {
  variable: string;
  /** Half-period L and the period's start, as expressions. */
  L: Expr;
  a0: Expr; // the constant term a0/2 is reported; this is a0
  /** Closed forms in n (null when only the listed coefficients exist). */
  an: Expr | null;
  bn: Expr | null;
  /** Concrete coefficients for n = 1..N (exact where the closed form exists). */
  terms: { n: number; a: Expr; b: Expr }[];
  /** Where the closed form does not apply (resonant harmonics). */
  special: { n: number; a: Expr; b: Expr }[];
  steps: string[];
  caveats: string[];
  verified: boolean;
  /** f over one period as a Solve-grammar expression using u(); and S_N. */
  fExpr: string;
  partialSum: string;
  window: { lo: number; hi: number };
}

export function fourierSeries(req: FourierRequest, Nterms = 5): FourierSeries | { refusal: string } {
  const t = req.variable;
  const n = "n";
  const lo = req.pieces[0].lo;
  const hi = req.pieces[req.pieces.length - 1].hi;
  // L = (hi − lo)/2, kept exact: a multiple of π, or a rational.
  let L: Bound;
  if (lo.piRat !== null && hi.piRat !== null) {
    const q = ratDiv(ratSub(hi.piRat, lo.piRat), ratInt(2));
    L = { expr: ratEq(q, ratInt(1)) ? PI : mul(rat(q), PI), value: ratToNumber(q) * Math.PI, piRat: q, plain: null };
  } else if (lo.plain !== null && hi.plain !== null) {
    const q = ratDiv(ratSub(hi.plain ?? ratInt(0), lo.plain ?? ratInt(0)), ratInt(2));
    L = { expr: rat(q), value: ratToNumber(q), piRat: null, plain: q };
  } else {
    return { refusal: "the period's ends must both be multiples of pi, or both be plain numbers" };
  }
  const Lnum = L.value;
  const omega = L.piRat && ratEq(L.piRat, ratInt(1)) ? V(n) : DIV(mul(V(n), PI), L.expr); // n π / L
  const steps: string[] = [];
  const caveats: string[] = [];
  steps.push(`Period ${format(lo.expr)} to ${format(hi.expr)}: L = ${format(L.expr)}, ω_n = nπ/L = ${format(S(omega))}`);

  // Classify pieces.
  const forms: { piece: Piece; forms: PieceForm[] }[] = [];
  for (const pc of req.pieces) {
    try {
      forms.push({ piece: pc, forms: classifyPiece(pc.expr, t, L.expr, Lnum) });
    } catch (err) {
      if (err instanceof Refuse) return { refusal: `${format(pc.expr)} is outside this release's pieces (${err.message})` };
      throw err;
    }
  }
  // A sinusoid must span the full period for orthogonality to apply.
  for (const f of forms) {
    if (f.forms.some((x) => x.kind === "sinusoid") && (f.piece.lo !== lo || f.piece.hi !== hi)) {
      return { refusal: "a sinusoid piece must span the whole period (its coefficients come from orthogonality)" };
    }
  }

  // a0 = (1/L)∫ f ; a_n = (1/L)∫ f cos(ωt) ; b_n = (1/L)∫ f sin(ωt), summed over pieces.
  let a0: Expr = N(0);
  let an: Expr | null = N(0);
  let bn: Expr | null = N(0);
  const resonant = new Map<number, { a: Expr; b: Expr }>();
  for (const { piece, forms: fs } of forms) {
    for (const form of fs) {
      if (form.kind === "sinusoid") {
        const k = Number(form.k.n);
        const cur = resonant.get(k) ?? { a: N(0), b: N(0) };
        if (form.fn === "cos") cur.a = add(cur.a, form.coef);
        else cur.b = add(cur.b, form.coef);
        resonant.set(k, cur);
        continue;
      }
      // a0 piece: ∫ form dt over [lo, hi] exactly.
      let F0: Expr;
      let Fc: Expr;
      let Fs: Expr;
      if (form.kind === "poly") {
        const integ = form.coeffs.map((c, k) => DIV(c, N(k + 1)));
        F0 = polyExpr([N(0), ...integ], t);
        Fc = polyTrigAntiderivative(form.coeffs, t, omega, "cos");
        Fs = polyTrigAntiderivative(form.coeffs, t, omega, "sin");
      } else {
        F0 = mul(form.coef, DIV(FN("exp", mul(rat(form.c), V(t))), rat(form.c)));
        Fc = mul(form.coef, expTrigAntiderivative(form.c, t, omega, "cos"));
        Fs = mul(form.coef, expTrigAntiderivative(form.c, t, omega, "sin"));
      }
      a0 = add(a0, SUB(substituteVar(F0, t, piece.hi.expr), substituteVar(F0, t, piece.lo.expr)));
      if (an !== null) {
        const top = atBoundSymbolic(Fc, t, piece.hi, L, n);
        const bot = atBoundSymbolic(Fc, t, piece.lo, L, n);
        if (top && bot) an = add(an, SUB(top, bot));
        else an = null;
      }
      if (bn !== null) {
        const top = atBoundSymbolic(Fs, t, piece.hi, L, n);
        const bot = atBoundSymbolic(Fs, t, piece.lo, L, n);
        if (top && bot) bn = add(bn, SUB(top, bot));
        else bn = null;
      }
    }
  }
  const scale = (e: Expr): Expr => S(DIV(e, L.expr));
  a0 = scale(a0);
  if (an !== null) an = S(DIV(an, L.expr));
  if (bn !== null) bn = S(DIV(bn, L.expr));
  if (an === null || bn === null) {
    caveats.push("A piece boundary is not a whole multiple of the half-period, so no closed form in n exists through this route; the first " + Nterms + " coefficients are given exactly, one by one.");
  }

  // Concrete coefficients n = 1..N: closed form with n substituted (exact),
  // else exact per-n integration via the same antiderivatives with n numeric.
  const terms: { n: number; a: Expr; b: Expr }[] = [];
  const special: { n: number; a: Expr; b: Expr }[] = [];
  const coefAt = (closed: Expr | null, which: "cos" | "sin", k: number): Expr => {
    if (closed !== null) return S(substituteVar(closed, n, N(k)));
    // per-n: substitute n = k into the antiderivatives and evaluate at bounds
    let total: Expr = N(0);
    for (const { piece, forms: fs } of forms) {
      for (const form of fs) {
        if (form.kind === "sinusoid") continue;
        const F =
          form.kind === "poly"
            ? polyTrigAntiderivative(form.coeffs, t, substituteVar(omega, n, N(k)), which)
            : mul(form.coef, expTrigAntiderivative(form.c, t, substituteVar(omega, n, N(k)), which));
        total = add(total, SUB(substituteVar(F, t, piece.hi.expr), substituteVar(F, t, piece.lo.expr)));
      }
    }
    return S(DIV(total, L.expr));
  };
  for (let k = 1; k <= Nterms; k++) {
    let a = coefAt(an, "cos", k);
    let b = coefAt(bn, "sin", k);
    const r = resonant.get(k);
    if (r) {
      a = S(add(a, r.a));
      b = S(add(b, r.b));
      special.push({ n: k, a, b });
    }
    terms.push({ n: k, a, b });
  }
  for (const [k, r] of resonant) {
    if (k > Nterms) special.push({ n: k, a: S(r.a), b: S(r.b) });
  }

  // VERIFY numerically: a0 and the first N coefficients against Simpson.
  const fNum = (x: number): number => {
    for (const pc of req.pieces) {
      if (x >= pc.lo.value - 1e-12 && x <= pc.hi.value + 1e-12) return evalAst(pc.expr, { [t]: x });
    }
    return NaN;
  };
  const integrate = (g: (x: number) => number): number => {
    let total = 0;
    for (const pc of req.pieces) {
      const a = pc.lo.value;
      const b = pc.hi.value;
      const m = 2000;
      const h = (b - a) / m;
      let sum = 0;
      for (let i = 0; i <= m; i++) {
        const x = a + i * h;
        const xi = i === 0 ? x + 1e-9 : i === m ? x - 1e-9 : x;
        let v = g(xi);
        if (!Number.isFinite(v)) v = 0;
        sum += v * (i === 0 || i === m ? 1 : i % 2 ? 4 : 2);
      }
      total += (sum * h) / 3;
    }
    return total / Lnum;
  };
  let verified = true;
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6 * Math.max(1, Math.abs(y));
  if (!close(evalAst(a0, {}), integrate(fNum))) verified = false;
  for (const tm of terms) {
    const w = (tm.n * Math.PI) / Lnum;
    if (!close(evalAst(tm.a, {}), integrate((x) => fNum(x) * Math.cos(w * x)))) verified = false;
    if (!close(evalAst(tm.b, {}), integrate((x) => fNum(x) * Math.sin(w * x)))) verified = false;
  }

  // f and S_N as Solve-grammar strings for the plot.
  const fParts = req.pieces.map((pc) => {
    const gate = `(u(${t} - (${format(pc.lo.expr)})) - u(${t} - (${format(pc.hi.expr)})))`;
    return `(${format(pc.expr)})*${gate}`;
  });
  const fExpr = fParts.join(" + ");
  const wStr = (k: number): string => {
    const kk = k === 1 ? "" : `${k}*`;
    if (L.piRat && ratEq(L.piRat, ratInt(1))) return `${kk}${t}`;
    if (L.plain && ratEq(L.plain, ratInt(1))) return `${kk}pi*${t}`;
    return `${kk}pi*${t}/(${format(L.expr)})`;
  };
  const sParts: string[] = [`(${format(S(DIV(a0, N(2))))})`];
  for (const tm of terms) {
    if (!isNum(tm.a, 0)) sParts.push(`(${format(tm.a)})*cos(${wStr(tm.n)})`);
    if (!isNum(tm.b, 0)) sParts.push(`(${format(tm.b)})*sin(${wStr(tm.n)})`);
  }
  const partialSum = sParts.join(" + ");

  if (an !== null && bn !== null) steps.push(`Coefficient integrals done by tabular integration by parts, with sin(nπ·m) = 0 and cos(nπ·m) = (−1)^{nm} at the period's ends.`);
  if (resonant.size) steps.push(`A sinusoid at harmonic ${[...resonant.keys()].join(", ")} contributes to that coefficient alone (orthogonality).`);
  // Jumps.
  const jumps: string[] = [];
  const first = req.pieces[0];
  const last = req.pieces[req.pieces.length - 1];
  const wrap = evalAst(last.expr, { [t]: last.hi.value }) - evalAst(first.expr, { [t]: first.lo.value });
  if (Math.abs(wrap) > 1e-9) jumps.push(`at the period's ends (${format(lo.expr)} ≡ ${format(hi.expr)})`);
  for (let i = 1; i < req.pieces.length; i++) {
    const d = evalAst(req.pieces[i].expr, { [t]: req.pieces[i].lo.value }) - evalAst(req.pieces[i - 1].expr, { [t]: req.pieces[i - 1].hi.value });
    if (Math.abs(d) > 1e-9) jumps.push(`at ${t} = ${format(req.pieces[i].lo.expr)}`);
  }
  if (jumps.length) {
    caveats.push(`f jumps ${jumps.join(" and ")}: there the series converges to the midpoint of the jump, and the partial sums overshoot beside it by about 9% (Gibbs) however many terms are taken.`);
  }

  return {
    variable: t,
    L: L.expr,
    a0,
    an,
    bn,
    terms,
    special,
    steps,
    caveats,
    verified,
    fExpr,
    partialSum,
    window: { lo: lo.value, hi: hi.value },
  };
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

export function tryFourierSeries(input: string): VerbResult | null {
  const req = parseFourierRequest(input);
  if (req === null) return null;
  const title = `Fourier series of ${HEAD_RE.exec(input)![1].trim()}`;
  if ("error" in req) return { title, lines: [], caveats: [req.error] };
  const r = fourierSeries(req);
  if ("refusal" in r) return { title, lines: [], caveats: [`Not computed: ${r.refusal}.`] };
  if (!r.verified) {
    return { title, lines: [], caveats: ["The closed-form coefficients did not agree with numerical integration for n ≤ 5 — withheld rather than shown wrong."] };
  }
  const t = r.variable;
  const Ltxt = format(r.L);
  const wTxt = Ltxt === "pi" ? `n*${t}` : Ltxt === "1" ? `n*pi*${t}` : `n*pi*${t}/(${Ltxt})`;
  const lines: { text: string; math?: boolean }[] = [];
  lines.push({ text: `f(${t}) ~ a_0/2 + Σ_{n≥1} (a_n*cos(${wTxt}) + b_n*sin(${wTxt}))` });
  lines.push({ text: `a_0/2 = ${format(S(DIV(r.a0, N(2))))}`, math: true });
  if (r.an !== null) lines.push({ text: `a_n = ${format(r.an)}`, math: true });
  if (r.bn !== null) lines.push({ text: `b_n = ${format(r.bn)}`, math: true });
  for (const sp of r.special) {
    lines.push({ text: `except n = ${sp.n}: a_${sp.n} = ${format(sp.a)}, b_${sp.n} = ${format(sp.b)}` });
  }
  lines.push({ text: `First coefficients: ${r.terms.map((tm) => `a_${tm.n} = ${format(tm.a)}, b_${tm.n} = ${format(tm.b)}`).join("; ")}` });
  lines.push({ text: `S_5(${t}) = ${r.partialSum}`, math: true });
  for (const s of r.steps) lines.push({ text: s });
  const caveats = [
    "Verified: a_0 and the coefficients for n = 1..5 agree with numerical integration of the defining integrals.",
    ...r.caveats,
  ];
  return {
    title,
    lines,
    caveats,
    plot: {
      exprs: [
        { expr: r.fExpr, label: `f(${t})` },
        { expr: r.partialSum, label: "S_5" },
      ],
      variable: t,
      window: r.window,
      title: "f over one period, and the partial sum S₅",
    },
  };
}
