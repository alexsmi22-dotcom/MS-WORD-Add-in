/**
 * Exact simplification for results that must stay symbolic.
 *
 * The canonical simplifier (cas.ts) folds every function of a constant to a
 * floating-point number: sqrt(2) → 1.4142…, cos(1) → 0.5403…, exp(1) →
 * 2.718…. That is the right behaviour for a numeric answer and the wrong one
 * for a Laplace transform or a Fourier coefficient, which a student copies
 * into a derivation. So before the simplifier runs, every such subtree is
 * MASKED behind a fresh atom (kc_0, kc_1, …), and restored afterwards; the
 * simplifier then collects and cancels around them exactly, and sqrt(2)
 * stays sqrt(2).
 *
 * Before masking, trigonometric functions of rational multiples of π are
 * folded to their exact values (sin(π/2) = 1, cos(π/3) = 1/2, sin(π/4) =
 * sqrt(2)/2, sin(π) = 0 — never 1.22e-16), because those are the constants
 * that arise from phases and period ends.
 */
import { Expr, freeVars, simplify } from "./solve";
import { casSimplify, CasBail, Rat, ratInt, polyInVar, ratIsZero, ratToNumber } from "./cas";

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });
const FN = (name: string, arg: Expr): Expr => ({ t: "fn", name, arg });
const NEG = (e: Expr): Expr => ({ t: "neg", e });
const DIV = (l: Expr, r: Expr): Expr => ({ t: "div", l, r });

/** True when the AST mentions the symbol (freeVars omits pi and e). */
export function hasVar(e: Expr, name: string): boolean {
  switch (e.t) {
    case "num":
      return false;
    case "var":
      return e.name === name;
    case "neg":
      return hasVar(e.e, name);
    case "fn":
      return hasVar(e.arg, name);
    default:
      return hasVar(e.l, name) || hasVar(e.r, name);
  }
}

/** A constant subtree: no variables (pi and e allowed). */
export function isConstant(e: Expr): boolean {
  return freeVars(e).length === 0;
}

/** The rational q when `e` is q·π exactly; null otherwise. */
export function piMultiple(e: Expr): Rat | null {
  if (!isConstant(e) || !hasVar(e, "pi")) return null;
  try {
    const p = polyInVar(e, "pi");
    if (p && p.length === 2 && ratIsZero(p[0])) return p[1];
  } catch {
    /* no */
  }
  return null;
}

const SQRT2_2: Expr = DIV(FN("sqrt", N(2)), N(2));
const SQRT3_2: Expr = DIV(FN("sqrt", N(3)), N(2));
const HALF: Expr = DIV(N(1), N(2));

/** sin/cos of q·π exactly where the table reaches, else null. Units: q·π. */
export function trigPiExact(fn: "sin" | "cos" | "tan", q: Rat): Expr | null {
  // Work in 24ths of π so that 1/6 (4/24), 1/4 (6/24), 1/3 (8/24), 1/2 (12/24) are all integers.
  let v = ratToNumber(q) % 2;
  if (v < 0) v += 2;
  const u = Math.round(v * 24);
  if (Math.abs(v * 24 - u) > 1e-12) return null;
  // sin at multiples of π/24 that we know: 0,4,6,8,12,16,18,20,24,…
  const sinTable: Record<number, Expr> = {
    0: N(0),
    4: HALF,
    6: SQRT2_2,
    8: SQRT3_2,
    12: N(1),
    16: SQRT3_2,
    18: SQRT2_2,
    20: HALF,
    24: N(0),
    28: NEG(HALF),
    30: NEG(SQRT2_2),
    32: NEG(SQRT3_2),
    36: NEG(N(1)),
    40: NEG(SQRT3_2),
    42: NEG(SQRT2_2),
    44: NEG(HALF),
  };
  const s = sinTable[u];
  const c = sinTable[(u + 12) % 48]; // cos x = sin(x + π/2)
  if (fn === "sin") return s ?? null;
  if (fn === "cos") return c ?? null;
  // tan, written in its reduced form rather than as a quotient of surds.
  const SQRT3: Expr = FN("sqrt", N(3));
  const SQRT3_3: Expr = DIV(SQRT3, N(3));
  const tanTable: Record<number, Expr> = {
    0: N(0),
    4: SQRT3_3,
    6: N(1),
    8: SQRT3,
    16: NEG(SQRT3),
    18: NEG(N(1)),
    20: NEG(SQRT3_3),
    24: N(0),
    28: SQRT3_3,
    30: N(1),
    32: SQRT3,
    40: NEG(SQRT3),
    42: NEG(N(1)),
    44: NEG(SQRT3_3),
  };
  return tanTable[u] ?? null;
}

/** Folds sin/cos/tan of rational multiples of π throughout. */
export function foldTrigPi(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg":
      return NEG(foldTrigPi(e.e));
    case "fn": {
      const arg = foldTrigPi(e.arg);
      if (e.name === "sin" || e.name === "cos" || e.name === "tan") {
        const q = piMultiple(arg);
        if (q) {
          const v = trigPiExact(e.name, q);
          if (v) return v;
        }
        if (arg.t === "num" && arg.v === 0) return e.name === "cos" ? N(1) : N(0);
      }
      return FN(e.name, arg);
    }
    default:
      return { ...e, l: foldTrigPi(e.l), r: foldTrigPi(e.r) } as Expr;
  }
}

const FOLDABLE = new Set(["sqrt", "cbrt", "exp", "ln", "log", "log10", "log2", "sin", "cos", "tan", "sinh", "cosh", "tanh", "asin", "acos", "atan", "abs"]);

/**
 * Simplifies with every function-of-a-constant kept symbolic and π kept as
 * π. Falls back to the peephole simplifier when the CAS bails.
 */
/** A perfect-square rational's root, else null. */
function perfectSqrt(e: Expr): Expr | null {
  if (e.t === "num" && Number.isInteger(e.v) && e.v >= 0) {
    const r = Math.round(Math.sqrt(e.v));
    return r * r === e.v ? N(r) : null;
  }
  if (e.t === "div" && e.l.t === "num" && e.r.t === "num") {
    const a = perfectSqrt(e.l);
    const b = perfectSqrt(e.r);
    return a && b ? DIV(a, b) : null;
  }
  return null;
}

/** The trivial folds the masking would otherwise freeze: exp(0), ln(1), sqrt of a
 *  perfect square, sqrt(x)^2, exp(a)·exp(b), e^x. */
function foldTrivial(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg":
      return NEG(foldTrivial(e.e));
    case "fn": {
      const arg = foldTrivial(e.arg);
      if (e.name === "exp" && arg.t === "num" && arg.v === 0) return N(1);
      if (e.name === "ln" && arg.t === "num" && arg.v === 1) return N(0);
      if (e.name === "sqrt") {
        const r = perfectSqrt(arg);
        if (r) return r;
      }
      return FN(e.name, arg);
    }
    case "pow": {
      const l = foldTrivial(e.l);
      const r = foldTrivial(e.r);
      if (l.t === "var" && l.name === "e") return FN("exp", r);
      if (l.t === "fn" && l.name === "sqrt" && r.t === "num" && Number.isInteger(r.v) && r.v % 2 === 0) {
        return r.v === 2 ? l.arg : { t: "pow", l: l.arg, r: N(r.v / 2) };
      }
      return { t: "pow", l, r };
    }
    case "mul": {
      // exp(a)·exp(b) → exp(a + b), across the whole product
      const fs: Expr[] = [];
      const flat = (x: Expr): void => {
        if (x.t === "mul") {
          flat(x.l);
          flat(x.r);
        } else fs.push(foldTrivial(x));
      };
      flat(e);
      const exps = fs.filter((g) => g.t === "fn" && g.name === "exp") as { t: "fn"; name: string; arg: Expr }[];
      if (exps.length >= 2) {
        const rest = fs.filter((g) => !(g.t === "fn" && g.name === "exp"));
        const arg = exps.map((g) => g.arg).reduce((a, b) => ({ t: "add", l: a, r: b }) as Expr);
        const merged = foldTrivial(FN("exp", arg));
        return [...rest, merged].reduce((a, b) => ({ t: "mul", l: a, r: b }) as Expr);
      }
      return fs.reduce((a, b) => ({ t: "mul", l: a, r: b }) as Expr);
    }
    default:
      return { ...e, l: foldTrivial(e.l), r: foldTrivial(e.r) } as Expr;
  }
}

/** Every variable name in the tree. */
function varNames(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case "num":
      return out;
    case "var":
      out.add(e.name);
      return out;
    case "neg":
      return varNames(e.e, out);
    case "fn":
      return varNames(e.arg, out);
    default:
      varNames(e.l, out);
      return varNames(e.r, out);
  }
}

export function exactSimplify(e0: Expr): Expr {
  const e = foldTrivial(foldTrigPi(e0));
  // A mask prefix no user variable shares, so a stray "kc_0" in the input
  // can never be unmasked into somebody else's constant.
  const names = varNames(e);
  let prefix = "kc_";
  while ([...names].some((n) => n.startsWith(prefix))) prefix = "k" + prefix;
  const masks: Expr[] = [];
  const byText = new Map<string, string>();
  const atomFor = (x: Expr): Expr => {
    // The same constant everywhere gets the same atom, so sqrt(2)·sqrt(2)
    // becomes an atom squared, which the sqrt(x)^2 fold then reduces.
    const key = JSON.stringify(x);
    let name = byText.get(key);
    if (!name) {
      masks.push(x);
      name = `${prefix}${masks.length - 1}`;
      byText.set(key, name);
    }
    return V(name);
  };
  const mask = (x: Expr): Expr => {
    switch (x.t) {
      case "num":
      case "var":
        return x;
      case "neg":
        return NEG(mask(x.e));
      case "fn": {
        if (FOLDABLE.has(x.name) && isConstant(x.arg)) {
          // The argument itself is simplified first (exp(2·1) → exp(2)).
          return atomFor(FN(x.name, exactSimplify(x.arg)));
        }
        return FN(x.name, mask(x.arg));
      }
      case "pow": {
        // 2^(1/2) and friends: a constant power with a non-integer exponent
        if (isConstant(x) && !(x.r.t === "num" && Number.isInteger(x.r.v))) return atomFor(x);
        return { t: "pow", l: mask(x.l), r: mask(x.r) };
      }
      default:
        return { ...x, l: mask(x.l), r: mask(x.r) } as Expr;
    }
  };
  const masked = mask(e);
  let out: Expr;
  try {
    out = casSimplify(masked);
  } catch (err) {
    if (err instanceof CasBail) out = simplify(masked);
    else throw err;
  }
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const unmask = (x: Expr): Expr => {
    switch (x.t) {
      case "num":
        return x;
      case "var": {
        const m = re.exec(x.name);
        return m ? masks[Number(m[1])] : x;
      }
      case "neg":
        return NEG(unmask(x.e));
      case "fn":
        return FN(x.name, unmask(x.arg));
      default:
        return { ...x, l: unmask(x.l), r: unmask(x.r) } as Expr;
    }
  };
  // One more trivial pass: an atom squared is now sqrt(2)^2, which folds to 2 —
  // and when that pass changed anything, the numbers it exposed (2/2) need
  // the simplifier once more. Bounded: a second round only.
  const first = foldTrivial(unmask(out));
  if (JSON.stringify(first) === JSON.stringify(unmask(out))) return first;
  const again = mask(first);
  let out2: Expr;
  try {
    out2 = casSimplify(again);
  } catch (err) {
    if (err instanceof CasBail) out2 = simplify(again);
    else throw err;
  }
  return foldTrivial(unmask(out2));
}

/** True when a function of a constant (sqrt(2), exp(1), cos(1)) occurs. */
export function hasFoldableConstant(e: Expr): boolean {
  switch (e.t) {
    case "num":
    case "var":
      return false;
    case "neg":
      return hasFoldableConstant(e.e);
    case "fn":
      return (FOLDABLE.has(e.name) && isConstant(e.arg)) || hasFoldableConstant(e.arg);
    case "pow":
      return (isConstant(e) && !(e.r.t === "num" && Number.isInteger(e.r.v))) || hasFoldableConstant(e.l) || hasFoldableConstant(e.r);
    default:
      return hasFoldableConstant(e.l) || hasFoldableConstant(e.r);
  }
}

/** Exact rational of a constant expression, or null (sqrt(2) has none). */
export function constantRat(e: Expr): Rat | null {
  if (!isConstant(e) || hasVar(e, "pi") || hasVar(e, "e") || hasFoldableConstant(e)) return null;
  try {
    const s = exactSimplify(e);
    if (s.t === "num" && Number.isInteger(s.v)) return ratInt(s.v);
    const p = polyInVar(s, "__none__");
    if (p && p.length === 1) return p[0];
  } catch {
    /* no */
  }
  return null;
}

