/**
 * Laplace transforms — forward, inverse, and initial-value problems.
 *
 * WHY THIS EXISTS. Every second-year engineering course lives on the Laplace
 * transform, and the product had none: the symbolic ODE engine solved four
 * families with no initial conditions, and the control bench computed with
 * transfer functions it could not derive. This closes that, on the machinery
 * already here — exact rational arithmetic (cas.ts), partial fractions
 * (casint.ts), symbolic differentiation (solve.ts).
 *
 * THE METHOD IS A TABLE, APPLIED HONESTLY. A function is split into terms of
 * the form  c · tⁿ · e^{at} · {1, sin bt, cos bt, sinh bt, cosh bt} · u(t−d),
 * each transformed by its table entry (tⁿ by the rule tⁿf ↦ (−d/ds)ⁿ F,
 * differentiated symbolically in s), and anything outside that table — a
 * product no identity reduces, 1/t, ln t, exp(t²) — is REFUSED BY NAME rather
 * than approximated. Trig squares and products are first rewritten by the
 * double-angle and product-to-sum identities.
 *
 * EVERY RESULT IS CROSS-CHECKED BY A ROUTE THAT SHARES NO CODE WITH THE TABLE:
 * the defining integral ∫₀^T e^{−st} f(t) dt is evaluated numerically at
 * several s inside the region of convergence and compared with F(s). An
 * inverse is additionally transformed forward again. A result that fails the
 * checks is withheld, not shown with a caveat — a wrong transform in a
 * document is worse than none.
 *
 * Exact display: coefficients stay rational; an irreducible quadratic
 * denominator whose completed square has an irrational ω keeps sqrt(·) in the
 * answer rather than a decimal. Nothing here calls the canonical simplifier
 * on an expression containing such a constant, because that simplifier folds
 * functions of constants to floating point.
 */
import { Expr, parseExpr, format, evalAst, freeVars, derivative, simplify } from "./solve";
import {
  casSimplify,
  exprEqual,
  substituteVar,
  ratFunctionInVar,
  polyInVar,
  Rat,
  ratInt,
  ratMake,
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
  ratSign,
  parseRatLiteral,
  CasBail,
} from "./cas";
import { partialFractionDecompose, type PartialFractions } from "./casint";
import { ratSqrt } from "./complexAlgebra";
import type { VerbResult } from "./algebraTools";
import { fmtRat } from "./geometry";
import { exactSimplify, constantRat } from "./exact";

// ---------------------------------------------------------------------------
// Expression constructors
// ---------------------------------------------------------------------------

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });
const FN = (name: string, arg: Expr): Expr => ({ t: "fn", name, arg });
const ADD = (l: Expr, r: Expr): Expr => ({ t: "add", l, r });
const SUB = (l: Expr, r: Expr): Expr => ({ t: "sub", l, r });
const MUL = (l: Expr, r: Expr): Expr => ({ t: "mul", l, r });
const DIV = (l: Expr, r: Expr): Expr => ({ t: "div", l, r });
const POW = (l: Expr, r: Expr): Expr => ({ t: "pow", l, r });
const NEG = (e: Expr): Expr => ({ t: "neg", e });

const isNum = (e: Expr, v?: number): boolean => e.t === "num" && (v === undefined || e.v === v);

/** A product that drops neutral factors and folds a leading sign. */
function mul(...fs: Expr[]): Expr {
  // Signs are folded to the front: (-1)·cos → -cos, (−1/3)·x → −(1/3·x).
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
function rat(q: Rat): Expr {
  return ratToExpr(q);
}
function factorial(n: number): Rat {
  let r = ratInt(1);
  for (let k = 2; k <= n; k++) r = ratMul(r, ratInt(k));
  return r;
}

/** Fold e^X into exp(X) and exp(X)^k into exp(k·X): one atom per exponential. */
export function foldExp(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg":
      return NEG(foldExp(e.e));
    case "add":
      return ADD(foldExp(e.l), foldExp(e.r));
    case "sub":
      return SUB(foldExp(e.l), foldExp(e.r));
    case "mul":
      return MUL(foldExp(e.l), foldExp(e.r));
    case "div": {
      const l = foldExp(e.l);
      const r = foldExp(e.r);
      // x/exp(X) is x·exp(−X): one exponential atom, never a quotient.
      if (r.t === "fn" && r.name === "exp") return MUL(l, FN("exp", NEG(r.arg)));
      return DIV(l, r);
    }
    case "pow": {
      const l = foldExp(e.l);
      const r = foldExp(e.r);
      if (l.t === "var" && l.name === "e") return FN("exp", r);
      if (l.t === "fn" && l.name === "exp") return FN("exp", MUL(r, l.arg));
      return POW(l, r);
    }
    case "fn":
      return FN(e.name, foldExp(e.arg));
  }
}

function containsVar(e: Expr, x: string): boolean {
  return freeVars(e).includes(x);
}
function containsFn(e: Expr, names: string[]): boolean {
  switch (e.t) {
    case "num":
    case "var":
      return false;
    case "neg":
      return containsFn(e.e, names);
    case "fn":
      return names.includes(e.name) || containsFn(e.arg, names);
    default:
      return containsFn(e.l, names) || containsFn(e.r, names);
  }
}

/** A constant expression's value, or null if it depends on a variable. */
function constValue(e: Expr): number | null {
  if (freeVars(e).length) return null;
  try {
    const v = evalAst(e, {});
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Exact rational value of a constant expression when it has one (exact.ts). */
function constRat(e: Expr): Rat | null {
  return constantRat(e);
}

/** [c, a] when e = a·x + c with constant a, c; else null. */
function linearIn(e: Expr, x: string): { a: Expr; c: Expr } | null {
  // Always by differentiation: polyInVar would hand back sqrt(2)·t with the
  // coefficient 1414213562373095/10^15, and that approximation then squares
  // its way into the answer.
  const a = exactSimplify(derivative(e, x));
  if (containsVar(a, x)) return null;
  const c = exactSimplify(substituteVar(e, x, N(0)));
  if (containsVar(c, x)) return null;
  return { a, c };
}

function flattenSum(e: Expr, sign = 1, out: { sign: number; term: Expr }[] = []): { sign: number; term: Expr }[] {
  if (e.t === "add") {
    flattenSum(e.l, sign, out);
    flattenSum(e.r, sign, out);
  } else if (e.t === "sub") {
    flattenSum(e.l, sign, out);
    flattenSum(e.r, -sign, out);
  } else if (e.t === "neg") {
    flattenSum(e.e, -sign, out);
  } else out.push({ sign, term: e });
  return out;
}
function flattenMul(e: Expr, out: Expr[] = []): Expr[] {
  if (e.t === "mul") {
    flattenMul(e.l, out);
    flattenMul(e.r, out);
  } else out.push(e);
  return out;
}

// ---------------------------------------------------------------------------
// Forward transform
// ---------------------------------------------------------------------------

export interface LaplaceStep {
  text: string;
  math?: boolean;
}

export interface LaplaceForward {
  /** F(s), in Solve grammar. */
  F: Expr;
  steps: LaplaceStep[];
  /** Region of convergence: s > region (numeric), when every rate is known. */
  region: number | null;
  /** The term list the table was applied to, for the caller's own words. */
  termCount: number;
}
export interface LaplaceRefusal {
  refusal: string;
}

interface Term {
  coef: Expr; // constant
  n: number; // power of t
  a: Expr; // exponential rate (constant)
  kind: "none" | "sin" | "cos" | "sinh" | "cosh";
  b: Expr; // frequency (constant)
  shift: Expr | null; // u(t − d): d
  delta: Expr | null; // δ(t − d): d
}

class Refuse extends Error {}

/** Splits one product into its classified term, or throws Refuse / returns rewrites. */
function classify(product: Expr, t: string): { term: Term } | { rewrite: Expr[] } {
  const factors = flattenMul(product);
  const term: Term = { coef: N(1), n: 0, a: N(0), kind: "none", b: N(0), shift: null, delta: null };
  const trig: { kind: Term["kind"]; b: Expr; power: number; src: Expr }[] = [];
  for (const f of factors) {
    if (!containsVar(f, t)) {
      term.coef = mul(term.coef, f);
      continue;
    }
    switch (f.t) {
      case "var":
        term.n += 1;
        continue;
      case "pow": {
        const k = constValue(f.r);
        if (f.l.t === "var" && f.l.name === t && k !== null && Number.isInteger(k) && k >= 0) {
          term.n += k;
          continue;
        }
        if (f.l.t === "fn" && ["sin", "cos", "sinh", "cosh"].includes(f.l.name) && k === 2) {
          const lin = linearIn(f.l.arg, t);
          if (!lin) throw new Refuse(`${format(f)}: the argument of ${f.l.name} must be linear in ${t}`);
          trig.push({ kind: f.l.name as Term["kind"], b: lin.a, power: 2, src: f });
          if (!isNum(lin.c, 0) && constValue(lin.c) !== 0) throw new Refuse(`${format(f)}: a phase inside a squared trig function is not reduced here`);
          continue;
        }
        if (f.l.t === "fn" && (f.l.name === "sin" || f.l.name === "cos") && (k === 3 || k === 4)) {
          // sin³ = (3 sin x − sin 3x)/4 ; cos³ = (3 cos x + cos 3x)/4 ;
          // sin⁴ = (3 − 4 cos 2x + cos 4x)/8 ; cos⁴ = (3 + 4 cos 2x + cos 4x)/8
          const x = f.l.arg;
          const others = factors.filter((g) => g !== f);
          const three = mul(N(3), x);
          const two = mul(N(2), x);
          const four = mul(N(4), x);
          let pieces: Expr[];
          if (k === 3) {
            pieces =
              f.l.name === "sin"
                ? [DIV(mul(N(3), FN("sin", x)), N(4)), NEG(DIV(FN("sin", three), N(4)))]
                : [DIV(mul(N(3), FN("cos", x)), N(4)), DIV(FN("cos", three), N(4))];
          } else {
            pieces =
              f.l.name === "sin"
                ? [DIV(N(3), N(8)), NEG(DIV(mul(N(4), FN("cos", two)), N(8))), DIV(FN("cos", four), N(8))]
                : [DIV(N(3), N(8)), DIV(mul(N(4), FN("cos", two)), N(8)), DIV(FN("cos", four), N(8))];
          }
          return { rewrite: pieces.map((p) => mul(...others, p)) };
        }
        if (f.l.t === "fn" && f.l.name === "exp" && k !== null) {
          const lin = linearIn(f.l.arg, t);
          if (!lin) throw new Refuse(`${format(f)}: the exponent must be linear in ${t}`);
          term.a = add(term.a, mul(N(k), lin.a));
          if (constValue(lin.c) !== 0) term.coef = mul(term.coef, FN("exp", mul(N(k), lin.c)));
          continue;
        }
        throw new Refuse(`no table entry for ${format(f)}`);
      }
      case "div": {
        if (f.l.t === "add" || f.l.t === "sub") {
          const others = factors.filter((g) => g !== f);
          return { rewrite: flattenSum(f.l).map(({ sign, term: tm }) => mul(...others, sign < 0 ? NEG(DIV(tm, f.r)) : DIV(tm, f.r))) };
        }
        if (containsVar(f.r, t)) throw new Refuse(`${format(f)}: division by a function of ${t} has no table entry here (1/t has no Laplace transform)`);
        term.coef = mul(term.coef, DIV(N(1), f.r));
        const inner = classify(f.l, t);
        if ("rewrite" in inner) return { rewrite: inner.rewrite.map((r) => DIV(r, f.r)) };
        const it = inner.term;
        term.coef = mul(term.coef, it.coef);
        term.n += it.n;
        term.a = add(term.a, it.a);
        if (it.kind !== "none") trig.push({ kind: it.kind, b: it.b, power: 1, src: f });
        if (it.shift) term.shift = it.shift;
        if (it.delta) term.delta = it.delta;
        continue;
      }
      case "fn": {
        const lin = linearIn(f.arg, t);
        if (f.name === "exp") {
          if (!lin) throw new Refuse(`${format(f)}: only exponentials of a LINEAR function of ${t} are in the table (exp(${t}^2) has no transform of exponential order)`);
          term.a = add(term.a, lin.a);
          if (constValue(lin.c) !== 0) term.coef = mul(term.coef, FN("exp", lin.c));
          continue;
        }
        if (["sin", "cos", "sinh", "cosh"].includes(f.name)) {
          if (!lin) throw new Refuse(`${format(f)}: the argument of ${f.name} must be linear in ${t}`);
          const phase = constValue(lin.c);
          if (phase !== null && phase !== 0) {
            // sin(bt + φ) = sin(bt)cos φ + cos(bt)sin φ, and the cosine twin.
            const others = factors.filter((g) => g !== f);
            const bt = mul(lin.a, V(t));
            let pieces: Expr[];
            if (f.name === "sin") pieces = [mul(FN("sin", bt), FN("cos", lin.c)), mul(FN("cos", bt), FN("sin", lin.c))];
            else if (f.name === "cos") pieces = [mul(FN("cos", bt), FN("cos", lin.c)), NEG(mul(FN("sin", bt), FN("sin", lin.c)))];
            else if (f.name === "sinh") pieces = [mul(FN("sinh", bt), FN("cosh", lin.c)), mul(FN("cosh", bt), FN("sinh", lin.c))];
            else pieces = [mul(FN("cosh", bt), FN("cosh", lin.c)), mul(FN("sinh", bt), FN("sinh", lin.c))];
            return { rewrite: pieces.map((p) => mul(...others, p)) };
          }
          trig.push({ kind: f.name as Term["kind"], b: lin.a, power: 1, src: f });
          continue;
        }
        if (["u", "heaviside", "step"].includes(f.name)) {
          if (!lin || constValue(lin.a) !== 1) throw new Refuse(`${format(f)}: the step must be written u(${t} - d) with a constant d`);
          const dNew = constValue(lin.c);
          if (dNew === null) throw new Refuse("the step's position must be a constant");
          if (term.shift) {
            // u(t − 2)·u(t − 3) = u(t − 3): the later step wins.
            const dOld = constValue(term.shift);
            if (dOld === null) throw new Refuse("the step's position must be a constant");
            if (-dNew > dOld) term.shift = NEG(lin.c);
            continue;
          }
          term.shift = NEG(lin.c);
          continue;
        }
        if (f.name === "delta") {
          if (!lin || constValue(lin.a) !== 1) throw new Refuse(`${format(f)}: the impulse must be written delta(${t} - d) with a constant d`);
          term.delta = NEG(lin.c);
          continue;
        }
        throw new Refuse(`no table entry for ${f.name}(${format(f.arg)})`);
      }
      default:
        throw new Refuse(`no table entry for ${format(f)}`);
    }
  }
  // Reduce trig powers and products to single factors.
  if (trig.length) {
    const sq = trig.find((x) => x.power === 2);
    if (sq) {
      const others = factors.filter((g) => g !== sq.src);
      const twice = mul(N(2), sq.b, V(t));
      let pieces: Expr[];
      // sin² = (1 − cos 2b)/2 ; cos² = (1 + cos 2b)/2 ; sinh² = (cosh 2b − 1)/2 ; cosh² = (cosh 2b + 1)/2
      if (sq.kind === "sin") pieces = [DIV(N(1), N(2)), NEG(DIV(FN("cos", twice), N(2)))];
      else if (sq.kind === "cos") pieces = [DIV(N(1), N(2)), DIV(FN("cos", twice), N(2))];
      else if (sq.kind === "sinh") pieces = [DIV(FN("cosh", twice), N(2)), NEG(DIV(N(1), N(2)))];
      else pieces = [DIV(FN("cosh", twice), N(2)), DIV(N(1), N(2))];
      return { rewrite: pieces.map((p) => mul(...others, p)) };
    }
    if (trig.length >= 2) {
      const [p, q] = trig;
      const hyp = (k: string) => k === "sinh" || k === "cosh";
      if (hyp(p.kind) !== hyp(q.kind)) throw new Refuse("a product of a trigonometric and a hyperbolic function is not reduced here");
      const others = factors.filter((g) => g !== p.src && g !== q.src);
      const plus = mul(add(p.b, q.b), V(t));
      const minus = mul(SUB(p.b, q.b), V(t));
      let pieces: Expr[];
      if (!hyp(p.kind)) {
        if (p.kind === "sin" && q.kind === "cos") pieces = [DIV(FN("sin", plus), N(2)), DIV(FN("sin", minus), N(2))];
        else if (p.kind === "cos" && q.kind === "sin") pieces = [DIV(FN("sin", plus), N(2)), NEG(DIV(FN("sin", minus), N(2)))];
        else if (p.kind === "sin") pieces = [DIV(FN("cos", minus), N(2)), NEG(DIV(FN("cos", plus), N(2)))];
        else pieces = [DIV(FN("cos", minus), N(2)), DIV(FN("cos", plus), N(2))];
      } else {
        if (p.kind === "sinh" && q.kind === "cosh") pieces = [DIV(FN("sinh", plus), N(2)), DIV(FN("sinh", minus), N(2))];
        else if (p.kind === "cosh" && q.kind === "sinh") pieces = [DIV(FN("sinh", plus), N(2)), NEG(DIV(FN("sinh", minus), N(2)))];
        else if (p.kind === "sinh") pieces = [DIV(FN("cosh", plus), N(2)), NEG(DIV(FN("cosh", minus), N(2)))];
        else pieces = [DIV(FN("cosh", plus), N(2)), DIV(FN("cosh", minus), N(2))];
      }
      return { rewrite: pieces.map((pc) => mul(...others, pc)) };
    }
    term.kind = trig[0].kind;
    term.b = trig[0].b;
  }
  return { term };
}

/** The table entry for one classified term, as F(s) plus the rule's name. */
function tableEntry(term: Term, s: string): { F: Expr; rule: string } {
  const S = V(s);
  // s − a, written s + 3 when a = −3 rather than s - -3.
  const aVal = constValue(term.a);
  const sa = isNum(term.a, 0) || aVal === 0 ? S : aVal !== null && aVal < 0 ? ADD(S, term.a.t === "neg" ? term.a.e : N(-aVal)) : SUB(S, term.a);
  const bVal = constValue(term.b);
  const b2: Expr = bVal !== null && Number.isInteger(bVal) ? N(bVal * bVal) : exactSimplify(POW(term.b, N(2)));
  let F0: Expr;
  let rule: string;
  switch (term.kind) {
    case "none":
      F0 = DIV(N(1), sa);
      rule = term.n ? "tⁿ·e^{at} ↦ n!/(s − a)^{n+1}" : "e^{at} ↦ 1/(s − a)";
      break;
    case "sin":
      F0 = DIV(term.b, ADD(POW(sa, N(2)), b2));
      rule = "e^{at} sin(bt) ↦ b/((s − a)² + b²)";
      break;
    case "cos":
      F0 = DIV(sa, ADD(POW(sa, N(2)), b2));
      rule = "e^{at} cos(bt) ↦ (s − a)/((s − a)² + b²)";
      break;
    case "sinh":
      F0 = DIV(term.b, SUB(POW(sa, N(2)), b2));
      rule = "e^{at} sinh(bt) ↦ b/((s − a)² − b²)";
      break;
    case "cosh":
      F0 = DIV(sa, SUB(POW(sa, N(2)), b2));
      rule = "e^{at} cosh(bt) ↦ (s − a)/((s − a)² − b²)";
      break;
  }
  let F = F0;
  if (term.n > 0) {
    if (term.kind === "none") {
      // tⁿ e^{at} ↦ n!/(s − a)^{n+1}, closed form — differentiating n times
      // doubled the tree at every step and t^10 never returned.
      F = DIV(rat(factorial(term.n)), POW(sa, N(term.n + 1)));
      rule = "tⁿ·e^{at} ↦ n!/(s − a)^{n+1}";
    } else {
      // tⁿ f(t) ↦ (−1)ⁿ dⁿF/dsⁿ, differentiated symbolically and SIMPLIFIED
      // between steps so the expression stays a rational function of s.
      for (let k = 0; k < term.n; k++) F = exactSimplify(derivative(F, s));
      if (term.n % 2 === 1) F = NEG(F);
      rule += "; tⁿ f ↦ (−d/ds)ⁿ F";
    }
  }
  // 10·(1/s) is 10/s and (1/2)·(1/(s²+1)) is 1/(2(s²+1)): a constant
  // coefficient folds into the table fraction, a rational one into both parts.
  const coef = exactSimplify(term.coef);
  let Fout: Expr;
  if (F.t === "div") {
    const neg = coef.t === "neg";
    const c = neg ? coef.e : coef;
    if (c.t === "div" && c.l.t === "num" && c.r.t === "num") {
      Fout = DIV(exactSimplify(mul(c.l, F.l)), mul(c.r, F.r));
    } else {
      Fout = DIV(exactSimplify(mul(c, F.l)), F.r);
    }
    if (neg) Fout = NEG(Fout);
  } else Fout = mul(coef, F);
  return { F: Fout, rule };
}

/** t − d, written t + 1 when d = −1 and t when d = 0. */
function shiftArg(t: string, d: Expr): Expr {
  const v = constValue(d);
  if (v === 0) return V(t);
  if (v !== null && Number.isFinite(v)) {
    const dd = exactSimplify(d);
    if (dd.t === "neg") return ADD(V(t), dd.e);
    if (dd.t === "num" && dd.v < 0) return ADD(V(t), N(-dd.v));
    return SUB(V(t), dd);
  }
  if (d.t === "neg") return ADD(V(t), d.e);
  return SUB(V(t), d);
}

/** Describes a classified term in the user's grammar, for the step line. */
function describeTerm(term: Term, t: string): string {
  const parts: Expr[] = [];
  if (term.n) parts.push(term.n === 1 ? V(t) : POW(V(t), N(term.n)));
  if (!isNum(term.a, 0)) parts.push(FN("exp", mul(term.a, V(t))));
  if (term.kind !== "none") parts.push(FN(term.kind, mul(term.b, V(t))));
  if (term.shift) parts.push(FN("u", shiftArg(t, term.shift)));
  if (term.delta) parts.push(FN("delta", shiftArg(t, term.delta)));
  const body = parts.length ? mul(...parts) : N(1);
  return format(isNum(term.coef, 1) ? body : mul(term.coef, body));
}

/**
 * Forward transform of `f` (a function of `t`) to `F(s)`.
 * Throws nothing: refusals come back by name.
 */
export function laplaceTransform(f: Expr, t = "t", s = "s"): LaplaceForward | LaplaceRefusal {
  if (containsVar(f, s)) return { refusal: `the function must not already contain ${s}` };
  // (A + B)/c and c·(A + B) are split into terms first: the simplifier
  // likes to return a sum over a common constant denominator, and the term
  // classifier reads products only.
  const e = distribute(exactSimplify(foldExp(f)));
  const queue: Expr[] = flattenSum(e).map(({ sign, term }) => (sign < 0 ? NEG(term) : term));
  const pieces: Expr[] = [];
  const steps: LaplaceStep[] = [];
  let region = -Infinity;
  let regionKnown = true;
  let guard = 0;
  while (queue.length) {
    if (++guard > 400) return { refusal: "the function did not reduce to table terms (too many rewrites)" };
    let cur = queue.shift()!;
    let sign = 1;
    if (cur.t === "neg") {
      sign = -1;
      cur = cur.e;
    }
    let res: { term: Term } | { rewrite: Expr[] };
    try {
      res = classify(cur, t);
    } catch (err) {
      if (err instanceof Refuse) return { refusal: err.message };
      throw err;
    }
    if ("rewrite" in res) {
      for (const r of res.rewrite) {
        const rs = distribute(exactSimplify(sign < 0 ? NEG(r) : r));
        for (const p of flattenSum(rs)) queue.push(p.sign < 0 ? NEG(p.term) : p.term);
      }
      continue;
    }
    const term = res.term;
    if (sign < 0) term.coef = mul(N(-1), term.coef);
    if (isNum(term.coef, 0)) continue;
    if (term.n > 12) return { refusal: `t^${term.n}: powers of ${t} above 12 are not transformed here` };

    // The impulse: f(t)·δ(t − d) ↦ f(d)·e^{−ds}.
    if (term.delta) {
      const d = constValue(term.delta);
      if (d === null) return { refusal: "the impulse's position must be a constant" };
      if (d < 0) continue;
      const g: Term = { ...term, delta: null, shift: null };
      const gExpr = parseExpr(describeTerm({ ...g, coef: N(1) }, t));
      const dExpr = exactSimplify(term.delta);
      const gAtD = exactSimplify(substituteVar(gExpr, t, dExpr));
      const F = mul(term.coef, gAtD, d === 0 ? N(1) : FN("exp", mul(NEG(dExpr), V(s))));
      pieces.push(F);
      steps.push({ text: `ℒ{${describeTerm(term, t)}} = ${format(F)}   (f(t)·δ(t − d) ↦ f(d)·e^{−ds})`, math: false });
      continue;
    }
    // The step: g(t)·u(t − d) ↦ e^{−ds}·ℒ{g(t + d)}.
    if (term.shift) {
      const d = constValue(term.shift);
      if (d === null) return { refusal: "the step's position must be a constant" };
      if (d <= 0) {
        // u(t − d) = 1 on t ≥ 0 when d ≤ 0.
        queue.unshift(mul(term.coef, parseExpr(describeTerm({ ...term, shift: null, coef: N(1) }, t))));
        continue;
      }
      const g = parseExpr(describeTerm({ ...term, shift: null, coef: N(1) }, t));
      const dExpr = exactSimplify(term.shift);
      const shifted = substituteVar(g, t, ADD(V(t), dExpr));
      const inner = laplaceTransform(shifted, t, s);
      if ("refusal" in inner) return inner;
      const F = mul(term.coef, FN("exp", mul(NEG(dExpr), V(s))), inner.F);
      pieces.push(F);
      steps.push({
        text: `ℒ{${describeTerm(term, t)}} = ${format(F)}   (g(t)·u(t − d) ↦ e^{−ds}·ℒ{g(t + d)}, with ℒ{${format(shifted)}} = ${format(inner.F)})`,
      });
      if (inner.region === null) regionKnown = false;
      else region = Math.max(region, inner.region);
      continue;
    }
    const { F, rule } = tableEntry(term, s);
    pieces.push(F);
    steps.push({ text: `ℒ{${describeTerm(term, t)}} = ${format(F)}   (${rule})` });
    const a = constValue(term.a);
    const bv = term.kind === "none" ? 0 : constValue(term.b);
    // A symbolic coefficient (laplace k*t) cannot be checked numerically either.
    if (a === null || bv === null || freeVars(term.coef).length) regionKnown = false;
    else region = Math.max(region, a + (term.kind === "sinh" || term.kind === "cosh" ? Math.abs(bv) : 0));
  }
  if (!pieces.length) return { F: N(0), steps, region: 0, termCount: 0 };
  // Several terms are combined over a common denominator with every constant
  // kept symbolic; a single term keeps the table's own factored form —
  // 5040/(s + 1)^8 rather than its expanded denominator.
  const F = pieces.length === 1 ? pieces[0] : exactSimplify(add(...pieces));
  return { F, steps, region: regionKnown ? region : null, termCount: pieces.length };
}

// ---------------------------------------------------------------------------
// Numeric cross-check: the defining integral, by composite Simpson.
// ---------------------------------------------------------------------------

/** The positions d of every u(t − d) in an expression, for panel alignment. */
function stepPositions(e: Expr, t: string, out: number[] = []): number[] {
  switch (e.t) {
    case "num":
    case "var":
      return out;
    case "neg":
      return stepPositions(e.e, t, out);
    case "fn": {
      if (["u", "heaviside", "step"].includes(e.name)) {
        const lin = linearIn(e.arg, t);
        const c = lin ? constValue(lin.c) : null;
        if (c !== null && -c > 0) out.push(-c);
      }
      return stepPositions(e.arg, t, out);
    }
    default:
      stepPositions(e.l, t, out);
      return stepPositions(e.r, t, out);
  }
}

/** The positions d of every delta(t − d) in an expression. */
function impulsePositions(e: Expr, t: string, out: number[] = []): number[] {
  switch (e.t) {
    case "num":
    case "var":
      return out;
    case "neg":
      return impulsePositions(e.e, t, out);
    case "fn": {
      if (e.name === "delta") {
        const lin = linearIn(e.arg, t);
        const c = lin ? constValue(lin.c) : null;
        if (c !== null) out.push(-c);
      }
      return impulsePositions(e.arg, t, out);
    }
    default:
      impulsePositions(e.l, t, out);
      return impulsePositions(e.r, t, out);
  }
}

/** Composite Simpson on [a, b]. */
function simpson(g: (x: number) => number, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    let v = g(a + i * h);
    if (!Number.isFinite(v)) v = 0;
    sum += v * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return (sum * h) / 3;
}

/**
 * f(t)·e^{−st} with the damping FOLDED INTO every exponential factor, so
 * exp(100t)·exp(−101t) is evaluated as exp(−t) rather than as ∞·0. Products
 * get one merged exponential; a lone exponential absorbs the damping; any
 * other term is multiplied by it.
 */
function damped(e: Expr, t: string, sv: number): Expr {
  const damp: Expr = mul(N(-sv), V(t));
  const term = (x: Expr): Expr => {
    if (x.t === "neg") return NEG(term(x.e));
    if (x.t === "div") return DIV(term(x.l), x.r);
    if (x.t === "fn" && x.name === "exp") return FN("exp", add(x.arg, damp));
    if (x.t === "mul") {
      const fs = flattenMul(x);
      const exps = fs.filter((g) => g.t === "fn" && g.name === "exp") as { t: "fn"; name: string; arg: Expr }[];
      const rest = fs.filter((g) => !(g.t === "fn" && g.name === "exp"));
      const arg = add(...exps.map((g) => g.arg), damp);
      return mul(...rest, FN("exp", arg));
    }
    return mul(x, FN("exp", damp));
  };
  return add(...flattenSum(e).map(({ sign, term: x }) => (sign < 0 ? NEG(term(x)) : term(x))));
}

/** The largest power of t and the largest trig frequency in f: the scales the window and panel count follow. */
function scalesOf(e: Expr, t: string): { nmax: number; bmax: number } {
  let nmax = 0;
  let bmax = 0;
  const walk = (x: Expr): void => {
    switch (x.t) {
      case "num":
      case "var":
        return;
      case "neg":
        return walk(x.e);
      case "pow": {
        if (x.l.t === "var" && x.l.name === t && x.r.t === "num") nmax = Math.max(nmax, x.r.v);
        walk(x.l);
        walk(x.r);
        return;
      }
      case "fn": {
        if (["sin", "cos", "sinh", "cosh"].includes(x.name)) {
          const lin = linearIn(x.arg, t);
          const b = lin ? constValue(lin.a) : null;
          if (b !== null) bmax = Math.max(bmax, Math.abs(b));
        }
        walk(x.arg);
        return;
      }
      default:
        walk(x.l);
        walk(x.r);
    }
  };
  walk(e);
  if (containsVar(e, t)) nmax = Math.max(nmax, 1);
  return { nmax, bmax };
}

/** ∫₀^T e^{−st} f(t) dt, with the panels split at every step's jump so a
 *  discontinuity sits on a boundary rather than inside a parabola. */
function laplaceIntegral(f: Expr, t: string, s: number, T: number, panels: number): number {
  const g0 = damped(f, t, s);
  const g = (x: number) => evalAst(g0, { [t]: x });
  const cuts = [0, ...stepPositions(f, t).filter((d) => d < T).sort((a, b) => a - b), T];
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 1e-12) continue;
    // Evaluate just inside each segment so the jump itself is never sampled.
    const eps = (b - a) * 1e-9;
    total += simpson(g, a + eps, b - eps, panels);
  }
  return total;
}

/**
 * Compares F(s) with the numerically integrated definition at three s inside
 * the region of convergence. Returns "verified", "skipped" (δ present, or no
 * region known) or "failed".
 */
export function numericCheck(f: Expr, F: Expr, region: number | null, t = "t", s = "s"): "verified" | "skipped" | "failed" {
  if (containsFn(f, ["delta"])) return "skipped";
  if (region === null) return "skipped";
  const { nmax, bmax } = scalesOf(f, t);
  // Four sample points off the obvious integers, so a wrong F that happens
  // to agree at round values still fails somewhere.
  for (const off of [1.3, 2.71, 3.97, 5.5]) {
    const sv = region + off;
    // The window must outlast tⁿ's tail (its peak sits at n/(s − a)); the
    // panel count must resolve the fastest sinusoid.
    const T = (40 + 6 * nmax) / (sv - region + 0.5);
    const panels = Math.min(400_000, Math.max(2000, 2000 * Math.ceil(1 + (T * bmax) / 20)));
    let lhs: number;
    let rhs: number;
    try {
      lhs = laplaceIntegral(f, t, sv, T, panels);
      rhs = evalAst(F, { [s]: sv });
    } catch {
      return "failed";
    }
    if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) return "failed";
    const tol = 1e-5 * Math.max(1, Math.abs(rhs)) + (containsFn(f, ["u", "heaviside", "step"]) ? 2e-4 : 0);
    if (Math.abs(lhs - rhs) > tol) return "failed";
  }
  return "verified";
}

// ---------------------------------------------------------------------------
// Inverse transform
// ---------------------------------------------------------------------------

export interface LaplaceInverse {
  f: Expr;
  steps: LaplaceStep[];
  /** "exact" when the forward transform of f equals F canonically; "numeric" when it agreed at sample points. */
  verified: "exact" | "numeric";
  /** Region of convergence of the forward transform of f, for the caller's own check. */
  region: number | null;
}

/** (A + B)/D → A/D + B/D, and c·(A + B) → c·A + c·B, so each term can carry
 *  its own e^{−ds} delay (a pulse forcing u(t−1) − u(t−2) over a common
 *  denominator was refused as "not rational"). */
function distribute(e: Expr): Expr {
  if (e.t === "neg") return NEG(distribute(e.e));
  if (e.t === "add") return ADD(distribute(e.l), distribute(e.r));
  if (e.t === "sub") return SUB(distribute(e.l), distribute(e.r));
  if (e.t === "div") {
    const num = distribute(e.l);
    const parts = flattenSum(num);
    if (parts.length > 1) return add(...parts.map(({ sign, term }) => (sign < 0 ? NEG(DIV(term, e.r)) : DIV(term, e.r))));
    return DIV(num, e.r);
  }
  if (e.t === "mul") {
    const fs = flattenMul(e);
    const sums = fs.filter((g) => g.t === "add" || g.t === "sub");
    if (sums.length === 1) {
      const rest = fs.filter((g) => g !== sums[0]);
      return add(...flattenSum(distribute(sums[0])).map(({ sign, term }) => (sign < 0 ? NEG(mul(...rest, term)) : mul(...rest, term))));
    }
  }
  return e;
}

/**
 * sqrt of a positive rational as an exact Expr: a rational when it is one,
 * else with every square factor pulled out — sqrt(3/4) is sqrt(3)/2 and
 * sqrt(12) is 2*sqrt(3), never a decimal.
 */
function sqrtExpr(q: Rat): Expr {
  const r = ratSqrt(q);
  if (r) return rat(r);
  // sqrt(p/q) = sqrt(p·q)/q
  const m = q.n * q.d;
  let square = 1n;
  let rest = m;
  for (let f = 2n; f * f <= rest && f < 1_000_000n; f++) {
    while (rest % (f * f) === 0n) {
      rest /= f * f;
      square *= f;
    }
  }
  // sqrt(3/4) = sqrt(12)/4 = 2·sqrt(3)/4 = sqrt(3)/2: reduce square/d.
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const g = gcd(square, q.d);
  const sq = square / g;
  const den = q.d / g;
  const root = sq === 1n ? FN("sqrt", rat(ratInt(rest))) : mul(rat(ratInt(sq)), FN("sqrt", rat(ratInt(rest))));
  return den === 1n ? root : DIV(root, rat(ratInt(den)));
}

/** Inverse of one partial-fraction term: the table read backwards. */
function inverseTerm(
  term: { kind: "linear"; root: Rat; power: number; A: Rat } | { kind: "quadratic"; b: Rat; c: Rat; power: number; B: Rat; C: Rat },
  t: string,
): { f: Expr; rule: string } {
  const T = V(t);
  if (term.kind === "linear") {
    const k = term.power;
    const coef = ratDiv(term.A, factorial(k - 1));
    const parts: Expr[] = [rat(coef)];
    if (k > 1) parts.push(k === 2 ? T : POW(T, N(k - 1)));
    if (!ratIsZero(term.root)) parts.push(FN("exp", mul(rat(term.root), T)));
    return { f: mul(...parts), rule: k === 1 ? "A/(s − r) ↦ A·e^{rt}" : "A/(s − r)^k ↦ A·t^{k−1}e^{rt}/(k−1)!" };
  }
  // (B s + C)/((s − p)² + ω²)^k with p = −b/2, ω² = c − b²/4 > 0.
  const p = ratNeg(ratDiv(term.b, ratInt(2)));
  const w2 = ratSub(term.c, ratDiv(ratMul(term.b, term.b), ratInt(4)));
  if (ratSign(w2) <= 0) throw new Refuse("a quadratic factor that is not irreducible reached the inverse table");
  const w = sqrtExpr(w2);
  const K = ratAdd(term.C, ratMul(term.B, p)); // B s + C = B(s − p) + K
  const envelope = ratIsZero(p) ? N(1) : FN("exp", mul(rat(p), T));
  const wt = mul(w, T);
  if (term.power === 1) {
    const cosPart = ratIsZero(term.B) ? N(0) : mul(rat(term.B), FN("cos", wt));
    const sinPart = ratIsZero(K) ? N(0) : mul(DIV(rat(K), w), FN("sin", wt));
    return {
      f: mul(envelope, add(cosPart, sinPart)),
      rule: "(B(s − p) + K)/((s − p)² + ω²) ↦ e^{pt}(B cos ωt + (K/ω) sin ωt)",
    };
  }
  if (term.power === 2) {
    // B(s−p)/((s−p)²+ω²)² ↦ e^{pt} t sin(ωt)/(2ω) ; K/((s−p)²+ω²)² ↦ e^{pt}(sin ωt − ωt cos ωt)/(2ω³)
    const first = ratIsZero(term.B) ? N(0) : mul(DIV(rat(term.B), mul(N(2), w)), T, FN("sin", wt));
    const second = ratIsZero(K)
      ? N(0)
      : mul(DIV(rat(K), mul(N(2), POW(w, N(3)))), SUB(FN("sin", wt), mul(w, T, FN("cos", wt))));
    return {
      f: mul(envelope, add(first, second)),
      rule: "(B(s − p) + K)/((s − p)² + ω²)² ↦ e^{pt}[B t sin ωt/(2ω) + K(sin ωt − ωt cos ωt)/(2ω³)]",
    };
  }
  throw new Refuse(`a repeated irreducible quadratic factor of power ${term.power} is beyond this table (powers 1 and 2 are covered)`);
}

/** Formats one partial-fraction term in s. */
function pfTermText(
  term: { kind: "linear"; root: Rat; power: number; A: Rat } | { kind: "quadratic"; b: Rat; c: Rat; power: number; B: Rat; C: Rat },
  s: string,
): string {
  const S = V(s);
  if (term.kind === "linear") {
    const den = ratIsZero(term.root) ? S : ratSign(term.root) < 0 ? ADD(S, rat(ratNeg(term.root))) : SUB(S, rat(term.root));
    return format(DIV(rat(term.A), term.power === 1 ? den : POW(den, N(term.power))));
  }
  const num = add(ratIsZero(term.B) ? N(0) : mul(rat(term.B), S), rat(term.C));
  const q = add(POW(S, N(2)), ratIsZero(term.b) ? N(0) : mul(rat(term.b), S), rat(term.c));
  return format(DIV(num, term.power === 1 ? q : POW(q, N(term.power))));
}

/**
 * Inverse transform of F(s). Handles a sum of terms, each a rational function
 * of s optionally multiplied by e^{−ds} (the second shift theorem). Refuses by
 * name what the table does not reach.
 */
export function inverseLaplace(Fin: Expr, s = "s", t = "t"): LaplaceInverse | LaplaceRefusal {
  if (containsVar(Fin, t)) return { refusal: `F(s) must not contain ${t}` };
  const F = distribute(foldExp(Fin));
  const steps: LaplaceStep[] = [];
  const pieces: Expr[] = [];
  for (const { sign, term } of flattenSum(F)) {
    // Peel off e^{−ds} factors — from the numerator when the term is a
    // quotient (exp(-2s)/s is a div node, not a product).
    const quotient = term.t === "div" ? term.r : null;
    const factors = flattenMul(term.t === "div" ? term.l : term);
    let d: Expr | null = null; // the delay, an exact constant (π allowed)
    const rest: Expr[] = [];
    for (const f of factors) {
      if (f.t === "fn" && f.name === "exp" && containsVar(f.arg, s)) {
        const lin = linearIn(f.arg, s);
        const cv = lin ? constValue(lin.c) : null;
        const av = lin ? constValue(lin.a) : null;
        if (!lin || av === null || cv === null || cv !== 0 || av > 0) {
          return { refusal: `${format(f)}: only e^{−ds} with a constant d ≥ 0 (a delayed function) is inverted` };
        }
        d = exactSimplify(d ? SUB(d, lin.a) : NEG(lin.a));
      } else rest.push(f);
    }
    const Gnum = rest.length ? mul(...rest) : N(1);
    const G = quotient ? DIV(Gnum, quotient) : Gnum;
    let rf: { num: Rat[]; den: Rat[] } | null;
    try {
      rf = ratFunctionInVar(exactSimplify(G), s);
    } catch (err) {
      if (!(err instanceof CasBail)) throw err;
      rf = null;
    }
    if (!rf) {
      return {
        refusal: `${format(G)} is not a rational function of ${s} with rational coefficients — this inverse covers rational F(s) (and e^{−ds} delays of them)`,
      };
    }
    if (rf.den.length === 1 && rf.num.length > 1) {
      return { refusal: `${format(G)} is a polynomial of degree ≥ 1 in ${s}, whose inverse is a derivative of δ — not produced here` };
    }
    // A constant (or a bare e^{−ds}) is an impulse: ℒ⁻¹{c} = c·δ(t).
    // partialFractionDecompose has nothing to say about a constant
    // denominator, so that decomposition is written down here.
    const pf: PartialFractions | null =
      rf.den.length === 1 && rf.num.length <= 1
        ? { polyPart: [ratDiv(rf.num[0] ?? ratInt(0), rf.den[0])], terms: [] }
        : partialFractionDecompose(rf.num, rf.den);
    if (!pf || pf.refusal) {
      return { refusal: `${format(G)}: ${pf?.refusal ?? "no partial-fraction decomposition"} — its inverse needs roots this table does not have` };
    }
    const polyPart = pf.polyPart.filter((c) => !ratIsZero(c));
    let f: Expr = N(0);
    if (pf.polyPart.length > 1 && pf.polyPart.slice(1).some((c) => !ratIsZero(c))) {
      return { refusal: `${format(G)} is improper with a polynomial part of degree ≥ 1, whose inverse is a derivative of δ — not produced here` };
    }
    if (polyPart.length === 1) {
      // A constant part is q₀·δ(t).
      f = mul(rat(pf.polyPart[0]), FN("delta", V(t)));
      steps.push({ text: `${fmtRat(pf.polyPart[0])} ↦ ${fmtRat(pf.polyPart[0])}·δ(t)   (a constant is the impulse)` });
    }
    const termTexts: string[] = [];
    for (const term of pf.terms) {
      let inv: { f: Expr; rule: string };
      try {
        inv = inverseTerm(term, t);
      } catch (err) {
        if (err instanceof Refuse) return { refusal: `${format(G)}: ${err.message}` };
        throw err;
      }
      termTexts.push(pfTermText(term, s));
      steps.push({ text: `${pfTermText(term, s)} ↦ ${format(inv.f)}   (${inv.rule})` });
      f = add(f, inv.f);
    }
    // The decomposition is an EQUATION: a math step (typeset, inserted as a Word
    // equation), not caret/asterisk prose (review 2026-10-24).
    if (pf.terms.length > 1) {
      const rhs = termTexts.join(" + ").replace(/\+ -/g, "- ");
      steps.unshift({ text: `${format(G)} = ${rhs}`, math: true });
      steps.unshift({ text: "Partial fractions:" });
    }
    if (d !== null && constValue(d) !== 0) {
      // e^{−ds}G(s) ↦ g(t − d)·u(t − d); a pure impulse just moves to t = d.
      const shifted = substituteVar(f, t, SUB(V(t), d));
      f = pf.terms.length === 0 ? shifted : mul(shifted, FN("u", SUB(V(t), d)));
      steps.push({ text: `e^{−${format(d)}s}·G(s) ↦ g(t − ${format(d)})${pf.terms.length === 0 ? "" : `·u(t − ${format(d)})`}   (second shift theorem)` });
    }
    pieces.push(sign < 0 ? NEG(f) : f);
  }
  const f = add(...pieces);

  // VERIFY: transform forward again (a different code path) and compare.
  const back = laplaceTransform(f, t, s);
  if ("refusal" in back) return { refusal: `the inverse found (${format(f)}) could not be transformed back for checking — not shown` };
  let verified: "exact" | "numeric" | null = null;
  try {
    const eq = exprEqual(back.F, F);
    if (eq === true) verified = "exact";
  } catch {
    /* numeric below */
  }
  if (!verified) {
    const region = back.region ?? 1;
    let ok = true;
    for (const sv of [region + 1, region + 2, region + 3.5, region + 5, region + 8]) {
      let a: number;
      let b: number;
      try {
        a = evalAst(back.F, { [s]: sv });
        b = evalAst(F, { [s]: sv });
      } catch {
        ok = false;
        break;
      }
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) {
        ok = false;
        break;
      }
    }
    if (ok) verified = "numeric";
  }
  if (!verified) return { refusal: `the inverse found (${format(f)}) did not transform back to F(s) — withheld rather than shown wrong` };
  return { f: exactSimplify(f), steps, verified, region: back.region };
}

// ---------------------------------------------------------------------------
// Verbs: "laplace f", "inverse laplace F"
// ---------------------------------------------------------------------------

// "laplace …", "laplace transform of …", "ℒ{…}", "L{…}"; an optional trailing
// "for s > 2" is dropped (the region is stated by the result anyway).
const FORWARD_RE = /^\s*(?:laplace(?:\s+transform)?|ℒ|L(?=\s*\{))\s*(?:of\s+)?[:{]?\s*(.+?)\s*}?\s*(?:,?\s*(?:for|where|with)\s+s\s*>.*)?$/i;
// The inverse needs an explicit marker — "inverse laplace", "laplace^-1",
// "ℒ⁻¹", "L^-1". A bare "laplace 1…" is a FORWARD transform of something
// that starts with 1 (the first version read "laplace 10" as the inverse).
const INVERSE_RE = /^\s*(?:inverse\s+laplace(?:\s+transform)?|(?:ℒ|L|laplace)\s*(?:\^\s*[({]?\s*-\s*1\s*[)}]?|⁻¹))\s*(?:of\s+)?[:{]?\s*(.+?)\s*}?\s*(?:,?\s*(?:for|where|with)\s+s\s*>.*)?$/i;

/** "Unknown function "s"" means the user wrote s(s+1): say what to write instead. */
function parseHint(msg: string): string {
  const m = /Unknown function "([A-Za-z])"/.exec(msg);
  if (m) return `${msg} In this grammar ${m[1]}(…) is a function call; write ${m[1]}*(…) for a product, e.g. 1/(s*(s+1)).`;
  return msg;
}

/** Picks the user's variable: the sole free variable, or t / s by role. */
function pickVar(e: Expr, prefer: string, avoid: string[]): string | null {
  const vars = freeVars(e).filter((v) => v !== "pi" && v !== "e");
  if (!vars.length) return prefer;
  if (vars.includes(prefer)) return prefer;
  if (vars.length === 1 && !avoid.includes(vars[0])) return vars[0];
  return null;
}

function regionText(region: number | null): string {
  if (region === null || !Number.isFinite(region)) return "";
  return `, for s > ${Number.isInteger(region) ? region : region.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function tryLaplace(input: string): VerbResult | null {
  const inv = INVERSE_RE.exec(input);
  if (inv) {
    if (inv[1].includes("=")) return null;
    const title = `inverse Laplace transform of ${inv[1]}`;
    let F: Expr;
    try {
      F = parseExpr(inv[1]);
    } catch (err) {
      return { title, lines: [], caveats: [`Couldn't read F(s): ${parseHint((err as Error).message)}`] };
    }
    const s = pickVar(F, "s", ["t"]);
    if (!s) return { title, lines: [], caveats: ["F must be a function of one variable (s)."] };
    const r = inverseLaplace(F, s, "t");
    if ("refusal" in r) return { title, lines: [], caveats: [`Not inverted: ${r.refusal}.`] };
    const fText = format(r.f);
    const check = numericCheck(r.f, F, r.region, "t", s) === "failed" ? null : true;
    const lines = [{ text: `f(t) = ${fText}`, math: true }];
    const caveats = [
      r.verified === "exact"
        ? "Verified: transforming f(t) forward again gives F(s) exactly."
        : "Verified: transforming f(t) forward again agrees with F(s) at five sample values of s.",
    ];
    if (check === null) caveats.push("The numeric check of the defining integral did not agree — treat with care.");
    return {
      title,
      lines: [...lines, ...r.steps.map((st) => (st.math ? { text: st.text, math: true } : { text: st.text }))],
      caveats,
      plot: { exprs: [{ expr: fText, label: "f(t)" }], variable: "t", window: { lo: 0, hi: 8 }, title: "f(t) = ℒ⁻¹{F}(t)" },
    };
  }
  const fw = FORWARD_RE.exec(input);
  if (!fw) return null;
  if (fw[1].includes("=")) return null;
  const title = `Laplace transform of ${fw[1]}`;
  let f: Expr;
  try {
    f = parseExpr(fw[1]);
  } catch (err) {
    return { title, lines: [], caveats: [`Couldn't read f(t): ${parseHint((err as Error).message)}`] };
  }
  const t = pickVar(f, "t", ["s"]);
  if (!t) {
    const hint = freeVars(f).includes("s") ? " It is written in s — for ℒ⁻¹ write \"inverse laplace …\"." : "";
    return { title, lines: [], caveats: [`f must be a function of one variable (t).${hint}`] };
  }
  const r = laplaceTransform(f, t, "s");
  if ("refusal" in r) return { title, lines: [], caveats: [`Not transformed: ${r.refusal}. The table covers tⁿ, e^{at}, sin, cos, sinh, cosh and their products, u(t − d) and δ(t − d).`] };
  const check = numericCheck(f, r.F, r.region, t, "s");
  if (check === "failed") {
    return { title, lines: [], caveats: ["The table result did not agree with the defining integral ∫₀^∞ e^{−st} f(t) dt at sample values of s — withheld rather than shown wrong."] };
  }
  const caveats: string[] = [];
  if (check === "verified") caveats.push("Verified against the defining integral ∫₀^∞ e^{−st} f(t) dt at three values of s.");
  else caveats.push("Not checked numerically (an impulse has no pointwise value, or the region of convergence is not rational).");
  const lines = [{ text: `F(s) = ${format(r.F)}${regionText(r.region)}`, math: true }, ...r.steps.map((st) => (st.math ? { text: st.text, math: true } : { text: st.text }))];
  return {
    title,
    lines,
    caveats,
    plot: containsFn(f, ["delta"])
      ? undefined
      : { exprs: [{ expr: format(f), label: `f(${t})` }], variable: t, window: { lo: 0, hi: 8 }, title: `f(${t}) — transformed` },
  };
}

// ---------------------------------------------------------------------------
// Initial-value problems by Laplace transform
// ---------------------------------------------------------------------------

export interface IvpResult {
  classification: string;
  solution: string;
  explicit: true;
  steps: Array<{ text?: string; math?: string }>;
  caveats: string[];
  verified: "verified" | "unverified";
  family: Array<{ expr: string; label: string }>;
  /** The independent variable (t or x). */
  variable: string;
}

/** Splits on top-level commas (outside brackets). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const IC_RE = /^y\s*(['′]?)\s*\(\s*0\s*\)\s*=\s*(.+)$/;

/** True when the text carries initial conditions y(0) = …; the IVP path owns it then. */
export function hasInitialConditions(input: string): boolean {
  return splitTop(input.replace(/\n/g, ",")).some((p) => IC_RE.test(p.replace(/\s+/g, " ").trim()));
}

function foldPrimesLocal(s: string): string {
  return s
    // y(t), y'(t), y''(t): the argument is implied here.
    .replace(/\by\s*(['′″‴]*)\s*\(\s*[tx]\s*\)/g, "y$1")
    .replace(/d2y\s*\/\s*d[tx]2|d\^2y\s*\/\s*d[tx]\^2|d²y\s*\/\s*d[tx]²/gi, " ypp ")
    .replace(/dy\s*\/\s*d[tx]/gi, " yp ")
    .replace(/y\s*'''|y‴|y′′′/g, " yppp ")
    .replace(/y\s*''|y″|y′′/g, " ypp ")
    .replace(/y\s*'|y′/g, " yp ");
}

export function solveIvpLaplace(input: string): IvpResult | null {
  const pieces = splitTop(input.replace(/\n/g, ","));
  const ics: Record<string, Rat> = {};
  const odeParts: string[] = [];
  for (const p of pieces) {
    const m = IC_RE.exec(p.replace(/\s+/g, " ").trim());
    if (m) {
      const q = parseRatLiteral(m[2].trim()) ?? (() => {
        try {
          const v = evalAst(parseExpr(m[2]), {});
          return Number.isFinite(v) ? ratFromNumber(v) : null;
        } catch {
          return null;
        }
      })();
      if (!q) return refuseIvp("unreadable", `Could not read the initial condition "${p}".`);
      const key = m[1] ? "yp" : "y";
      if (key in ics) return refuseIvp("inconsistent", `${key === "y" ? "y(0)" : "y'(0)"} is given twice.`);
      ics[key] = q;
    } else odeParts.push(p);
  }
  if (!Object.keys(ics).length) return null;
  if (odeParts.length !== 1) return refuseIvp("unreadable", "Give one equation and its initial conditions, e.g. y'' + 4y = sin(t), y(0) = 0, y'(0) = 0.");
  const folded = foldPrimesLocal(odeParts[0]);
  if (/\byppp\b/.test(folded)) return refuseIvp("third order", "Third- and higher-order equations are not solved by this transform table (order ≤ 2).");
  const sides = folded.split("=");
  if (sides.length !== 2) return refuseIvp("unreadable", "The equation needs exactly one '='.");
  let Fe: Expr;
  try {
    Fe = parseExpr(`(${sides[0]}) - (${sides[1]})`);
  } catch (err) {
    return refuseIvp("unreadable", `Could not read the equation: ${(err as Error).message}`);
  }
  const vars = freeVars(Fe).filter((v) => !["y", "yp", "ypp"].includes(v));
  const indep = vars.length === 0 ? "t" : vars.length === 1 ? vars[0] : null;
  if (!indep || !["t", "x"].includes(indep)) {
    return refuseIvp("unsupported", `The unknown is y(t) (or y(x)); found other symbols: ${vars.join(", ")}.`);
  }
  const t = indep;
  const S2 = (e: Expr): Expr => exactSimplify(e);
  const a = S2(derivative(Fe, "ypp"));
  const b = S2(derivative(Fe, "yp"));
  const c = S2(derivative(Fe, "y"));
  const ar = constRat(a);
  const br = constRat(b);
  const cr = constRat(c);
  if (ar === null || br === null || cr === null) {
    const dep = [a, b, c].flatMap((e) => freeVars(e));
    if (dep.some((v) => ["y", "yp", "ypp"].includes(v))) {
      return refuseIvp("nonlinear", "The equation is not linear in y, y', y'' — the transform method applies to linear equations only.");
    }
    return refuseIvp("not constant-coefficient", "The transform table solves a·y'' + b·y' + c·y = g(t) with CONSTANT rational a, b, c.");
  }
  // Forcing: g = −F with y, y', y'' set to zero.
  const g = S2(NEG(substituteVar(substituteVar(substituteVar(Fe, "ypp", N(0)), "yp", N(0)), "y", N(0))));
  // Linearity check: F − (a ypp + b yp + c y − g) must vanish.
  const lin = S2(SUB(Fe, SUB(add(mul(a, V("ypp")), mul(b, V("yp")), mul(c, V("y"))), g)));
  if (!(lin.t === "num" && lin.v === 0)) {
    return refuseIvp("nonlinear", "The equation is not linear with constant coefficients in y, y', y'' — the transform method does not apply.");
  }
  const order = ratIsZero(ar) ? (ratIsZero(br) ? 0 : 1) : 2;
  if (order === 0) return refuseIvp("not an ODE", "No y' or y'' found.");
  if (!("y" in ics)) return refuseIvp("missing initial condition", "The transform method needs y(0).");
  if (order === 2 && !("yp" in ics)) return refuseIvp("missing initial condition", "A second-order equation needs both y(0) and y'(0).");
  const extraIc = order === 1 && "yp" in ics ? "The equation is first order, so y'(0) follows from it; the given y'(0) was not used." : null;
  const y0 = ics.y;
  const y0p = ics.yp ?? ratInt(0);

  const G = laplaceTransform(g, t, "s");
  if ("refusal" in G) return refuseIvp("forcing outside the table", `The forcing term ${format(g)} has no table transform: ${G.refusal}.`);
  const S = V("s");
  // a(s²Y − s y0 − y0') + b(sY − y0) + cY = G  ⇒  Y = (G + a s y0 + a y0' + b y0)/(a s² + b s + c)
  const den = add(mul(rat(ar), POW(S, N(2))), mul(rat(br), S), rat(cr));
  const numExtra = add(mul(rat(ratMul(ar, y0)), S), rat(ratAdd(ratMul(ar, y0p), ratMul(br, y0))));
  const Y = DIV(add(G.F, numExtra), den);
  const steps: Array<{ text?: string; math?: string }> = [];
  steps.push({ text: `Transform both sides, using ℒ{y'} = sY − y(0) and ℒ{y''} = s²Y − s·y(0) − y'(0):` });
  // The characteristic polynomial is BRACKETED as Y's coefficient: without it
  // the line read "s² + 3·s + 2·Y − (s+3) = 0" — Y multiplying only the 2
  // (review 2026-10-24). A single-term coefficient needs no bracket.
  {
    // "3*s" → "3s": a numeric coefficient on s reads as juxtaposition, as in print.
    const charPoly = format(S2(add(mul(rat(ar), POW(S, N(2))), mul(rat(br), S), rat(cr)))).replace(/(\d)\*s\b/g, "$1s");
    const coef = /[+-]/.test(charPoly.replace(/^-/, "")) ? `(${charPoly})` : charPoly;
    steps.push({ math: `${coef} * Y - (${format(S2(numExtra))}) = ${format(G.F)}` });
  }
  for (const st of G.steps) steps.push(st.math ? { math: st.text } : { text: st.text });
  const Ysimpl: Expr = exactSimplify(Y);
  steps.push({ math: `Y(s) = ${format(Ysimpl)}` });
  const inv = inverseLaplace(Ysimpl, "s", t);
  if ("refusal" in inv) return refuseIvp("inverse not in the table", `Y(s) = ${format(Ysimpl)} could not be inverted: ${inv.refusal}.`);
  for (const st of inv.steps) steps.push(st.math ? { math: st.text } : { text: st.text });
  const y = inv.f;

  // VERIFY against the ORIGINAL equation and the initial conditions.
  //
  // A solution with a step is checked PIECEWISE: at each sample point every
  // u(t − d) is replaced by its value there (1 or 0) before differentiating,
  // because differentiating through u produces δ and then δ′, which has no
  // rule — and the equation holds classically on each side of the jump.
  let verified: "verified" | "unverified" = "verified";
  const hasStep = containsFn(y, ["u", "heaviside", "step", "delta"]);
  // delta(t) at the origin gives y' a jump of 1/a at t = 0: the condition
  // y'(0) is y'(0-), and the solution's y'(0+) differs from it by exactly that.
  const impulseAtZero = containsFn(g, ["delta"]) && impulsePositions(g, t).some((d) => d === 0);
  const atPoint = (e: Expr, tv: number): Expr => {
    if (!hasStep) return e;
    const walk = (x: Expr): Expr => {
      switch (x.t) {
        case "num":
        case "var":
          return x;
        case "neg":
          return NEG(walk(x.e));
        case "fn":
          if (["u", "heaviside", "step"].includes(x.name)) return N(evalAst(x.arg, { [t]: tv }) >= 0 ? 1 : 0);
          if (x.name === "delta") return N(0);
          return FN(x.name, walk(x.arg));
        default:
          return { ...x, l: walk(x.l), r: walk(x.r) } as Expr;
      }
    };
    return walk(e);
  };
  const samples = hasStep ? [0.3, 0.9, 1.7, 2.6, 3.9] : [0.3, 0.9, 1.7];
  // Never sample exactly at a jump.
  const jumps = stepPositions(y, t);
  try {
    for (const tv of samples) {
      if (jumps.some((d) => Math.abs(d - tv) < 1e-6)) continue;
      const yv = atPoint(y, tv);
      const dy = derivative(yv, t);
      const d2y = derivative(dy, t);
      const residual = substituteVar(substituteVar(substituteVar(Fe, "ypp", d2y), "yp", dy), "y", yv);
      const gv = atPoint(residual, tv);
      const r = evalAst(gv, { [t]: tv });
      const scale = Math.max(1, Math.abs(evalAst(yv, { [t]: tv })));
      if (!Number.isFinite(r) || Math.abs(r) > 1e-6 * scale) verified = "unverified";
    }
    const y0e = atPoint(y, 0);
    const y0v = evalAst(y0e, { [t]: 0 });
    // A first-order equation's impulse at t = 0 makes y itself jump by 1/b
    // there: y(0) is y(0⁻), and the solution's y(0⁺) differs by exactly that.
    if (!(impulseAtZero && order === 1) && Math.abs(y0v - ratToNumber(y0)) > 1e-9) verified = "unverified";
    if (order === 2 && !impulseAtZero) {
      const dy0 = evalAst(derivative(y0e, t), { [t]: 0 });
      if (Math.abs(dy0 - ratToNumber(y0p)) > 1e-9 * Math.max(1, Math.abs(ratToNumber(y0p)))) verified = "unverified";
    }
  } catch {
    verified = "unverified";
  }
  if (verified === "unverified") {
    return refuseIvp("did not verify", `The candidate y(${t}) = ${format(y)} did not satisfy the equation and initial conditions on substitution — withheld rather than shown wrong.`);
  }
  const sol = `y = ${format(y)}`;
  return {
    classification: "initial-value problem, by Laplace transform",
    solution: sol,
    explicit: true,
    steps,
    caveats: [
      `Verified by substituting y(${t}) into the equation at sample points and checking ${
        impulseAtZero
          ? order === 2
            ? "y(0) (y'(0) is the value before the impulse at t = 0, which gives y' a jump there)"
            : "that y(0) is the value before the impulse at t = 0, which gives y a jump there"
          : order === 2
            ? "y(0) and y'(0)"
            : "y(0)"
      }.`,
      ...(extraIc ? [extraIc] : []),
    ],
    verified: "verified",
    family: [{ expr: format(y), label: `y(${t})` }],
    variable: t,
  };
}

function refuseIvp(classification: string, why: string): IvpResult {
  return {
    classification,
    solution: "",
    explicit: true,
    steps: [],
    caveats: [why],
    verified: "unverified",
    family: [],
    variable: "t",
  };
}
