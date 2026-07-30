// Offline math solver: equations and basic calculus.
//
// Scope (all deterministic, all on-device — no network, nothing leaves the
// machine, in keeping with the JurisLab mandate):
//   * solveEquation — solve "LHS = RHS" for one unknown. Linear and quadratic
//     are solved EXACTLY (closed form, including complex roots); higher-degree
//     polynomials and transcendental equations fall back to numeric root-finding
//     over a scanned range, which is honest about the roots it may miss.
//   * differentiate — symbolic derivative via a self-contained differentiable
//     AST, then a simplify pass. Exact.
//   * integrate — definite integral by adaptive Simpson quadrature. Numeric.
//
// HONESTY (the project standard): exact results are labelled exact; numeric
// results say so and state their limits (root-finding only reports real roots it
// bracketed in the scanned range; numeric integration is an approximation). A
// solver that silently drops roots or fabricates one is exactly the failure this
// project keeps guarding against, so every path reports its method and caveats.
//
// evalFormula (stats.ts) is reused only for its numeric behaviour where a value
// is genuinely needed; the symbolic work is done on the AST defined here.
//
// The heavy symbolic machinery lives in cas.ts (canonical rational functions
// over atoms, exact rational coefficients — see docs/CAS-DESIGN.md). simplify()
// delegates to it, falling back to the local peephole pass on the rare input
// the canonical form cannot represent; solveEquation() uses it for exact
// symbolic rearrangement (F = m·a solved for a gives a = F/m, with m ≠ 0
// stated), verified by substituting the solution back.

import { casSimplify, CasBail, solveRationalInVar } from "./cas";
import { symbolicIntegrate } from "./casint";

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Expr =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; e: Expr }
  | { t: "add"; l: Expr; r: Expr }
  | { t: "sub"; l: Expr; r: Expr }
  | { t: "mul"; l: Expr; r: Expr }
  | { t: "div"; l: Expr; r: Expr }
  | { t: "pow"; l: Expr; r: Expr }
  | { t: "fn"; name: string; arg: Expr };

/** Numeric implementations of the supported functions (must match DERIV_FN). */
const EVAL_FN: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

// Unicode super/subscript glyphs, so a pasted or typed x² / x₁ parses like the
// ASCII forms x^2 / x_1. Superscript runs become an exponent ^(…); subscript runs
// fold into the variable name with an underscore.
const SUP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")", "ⁿ": "n",
};
const SUB: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

/** Rewrites Unicode super/subscripts to the ASCII grammar (x² → x^(2), x₁ → x_1). */
export function normalizeUnicodeMath(input: string): string {
  return input
    .replace(/[⁰¹²³⁴-⁹⁺⁻⁽⁾ⁿ]+/g, (run) => {
      const decoded = [...run].map((c) => SUP[c] ?? "").join("");
      return decoded ? `^(${decoded})` : "";
    })
    .replace(/[₀-₉]+/g, (run) => {
      const decoded = [...run].map((c) => SUB[c] ?? "").join("");
      return decoded ? `_${decoded}` : "";
    });
}

// ---------------------------------------------------------------------------
// Parser — recursive descent over the same grammar evalFormula accepts.
// ---------------------------------------------------------------------------

class Parser {
  private i = 0;
  constructor(private s: string) {
    this.s = normalizeUnicodeMath(s).replace(/\s+/g, "");
  }
  parse(): Expr {
    const e = this.additive();
    if (this.i !== this.s.length) throw new Error(`Unexpected character "${this.s[this.i]}".`);
    return e;
  }
  private additive(): Expr {
    let e = this.term();
    while (this.s[this.i] === "+" || this.s[this.i] === "-") {
      const op = this.s[this.i++];
      const r = this.term();
      e = op === "+" ? { t: "add", l: e, r } : { t: "sub", l: e, r };
    }
    return e;
  }
  private term(): Expr {
    let e = this.unary();
    while (this.s[this.i] === "*" || this.s[this.i] === "/") {
      const op = this.s[this.i++];
      const r = this.unary();
      e = op === "*" ? { t: "mul", l: e, r } : { t: "div", l: e, r };
    }
    return e;
  }
  private unary(): Expr {
    if (this.s[this.i] === "-") { this.i++; return { t: "neg", e: this.unary() }; }
    if (this.s[this.i] === "+") { this.i++; return this.unary(); }
    return this.power();
  }
  private power(): Expr {
    const base = this.atom();
    if (this.s[this.i] === "^") { this.i++; return { t: "pow", l: base, r: this.unary() }; }
    return base;
  }
  private atom(): Expr {
    if (this.s[this.i] === "(") {
      this.i++;
      const e = this.additive();
      if (this.s[this.i] !== ")") throw new Error("Unbalanced parentheses.");
      this.i++;
      return e;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (id) {
      const name = id[0];
      this.i += name.length;
      if (this.s[this.i] === "(") {
        this.i++;
        const arg = this.additive();
        if (this.s[this.i] !== ")") throw new Error("Unbalanced parentheses.");
        this.i++;
        if (!(name in EVAL_FN)) throw new Error(`Unknown function "${name}".`);
        return { t: "fn", name, arg };
      }
      // "NaN" and "Infinity" parse as perfectly ordinary identifiers, so typing
      // either one produced an equation in a variable called NaN and working
      // that read "1·NaN^1 + 0·NaN^0 = 0". Whatever the user meant, they did
      // not mean that. Refuse by name.
      if (/^(nan|infinity|inf|undefined)$/i.test(name)) {
        throw new Error(`"${name}" is not a value this can solve for.`);
      }
      // Implicit multiplication like "2x" is handled by the tokenizer only for a
      // number immediately followed by an identifier (see number branch).
      return { t: "var", name };
    }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      const v = parseFloat(num[0]);
      // A literal past the range of a double becomes Infinity silently, and the
      // working then read "Reduced to -Infinity = 0" — an answer about a number
      // the user never wrote. Blocking the IDENTIFIERS "NaN"/"Infinity" above
      // does not cover this: 1e999 is neither.
      if (!Number.isFinite(v)) {
        throw new Error(`"${num[0]}" is too large to represent — the limit is about 1e308.`);
      }
      const n: Expr = { t: "num", v };
      // Implicit multiplication: "2x", "3sin(x)", "2(x+1)".
      if (/[A-Za-z(]/.test(this.s[this.i] ?? "")) return { t: "mul", l: n, r: this.power() };
      return n;
    }
    throw new Error("Could not parse the expression.");
  }
}

export function parseExpr(s: string): Expr {
  return new Parser(s).parse();
}

// ---------------------------------------------------------------------------
// Numeric evaluation of the AST.
// ---------------------------------------------------------------------------

export function evalAst(e: Expr, vars: Record<string, number>): number {
  switch (e.t) {
    case "num": return e.v;
    case "var":
      if (e.name in vars) return vars[e.name];
      if (e.name in CONSTANTS) return CONSTANTS[e.name];
      throw new Error(`Unknown variable "${e.name}".`);
    case "neg": return -evalAst(e.e, vars);
    case "add": return evalAst(e.l, vars) + evalAst(e.r, vars);
    case "sub": return evalAst(e.l, vars) - evalAst(e.r, vars);
    case "mul": return evalAst(e.l, vars) * evalAst(e.r, vars);
    case "div": return evalAst(e.l, vars) / evalAst(e.r, vars);
    case "pow": return Math.pow(evalAst(e.l, vars), evalAst(e.r, vars));
    case "fn": return EVAL_FN[e.name](evalAst(e.arg, vars));
  }
}

/** Free variable names in `e` (excludes the constants pi and e). */
export function freeVars(e: Expr): string[] {
  const out = new Set<string>();
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (!(n.name in CONSTANTS)) out.add(n.name); break;
      case "num": break;
      case "neg": walk(n.e); break;
      case "fn": walk(n.arg); break;
      default: walk(n.l); walk(n.r);
    }
  })(e);
  return [...out];
}

function containsVar(e: Expr, name: string): boolean {
  return freeVars(e).includes(name);
}

// ---------------------------------------------------------------------------
// Symbolic differentiation.
// ---------------------------------------------------------------------------

const N = (v: number): Expr => ({ t: "num", v });

/** Derivative of function `name` applied to `u` (before the chain-rule factor). */
function derivFn(name: string, u: Expr): Expr {
  switch (name) {
    case "sin": return { t: "fn", name: "cos", arg: u };
    case "cos": return { t: "neg", e: { t: "fn", name: "sin", arg: u } };
    case "tan": return { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "cos", arg: u }, r: N(2) } };
    case "exp": return { t: "fn", name: "exp", arg: u };
    case "ln": return { t: "div", l: N(1), r: u };
    // log and log10 are the same function here -- EVAL_FN and the parser both
        // accept log10, but derivFn had no case for it, so differentiate("log10(x)")
        // threw "No derivative rule" straight out of the pane (derivative() is not
        // inside solve.ts's try), and integrate("log10(x)", 1, 2) threw the same
        // from casint's by-parts branch. It was the only such gap.
    case "log":
    case "log10": return { t: "div", l: N(1), r: { t: "mul", l: u, r: N(Math.LN10) } };
    case "log2": return { t: "div", l: N(1), r: { t: "mul", l: u, r: N(Math.LN2) } };
    case "sqrt": return { t: "div", l: N(1), r: { t: "mul", l: N(2), r: { t: "fn", name: "sqrt", arg: u } } };
    case "cbrt": return { t: "div", l: N(1), r: { t: "mul", l: N(3), r: { t: "pow", l: { t: "fn", name: "cbrt", arg: u }, r: N(2) } } };
    case "asin": return { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } };
    case "acos": return { t: "neg", e: { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } } };
    case "atan": return { t: "div", l: N(1), r: { t: "add", l: N(1), r: { t: "pow", l: u, r: N(2) } } };
    case "sinh": return { t: "fn", name: "cosh", arg: u };
    case "cosh": return { t: "fn", name: "sinh", arg: u };
    case "tanh": return { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "cosh", arg: u }, r: N(2) } };
    case "abs": return { t: "div", l: u, r: { t: "fn", name: "abs", arg: u } }; // sign(u); undefined at 0
    default: throw new Error(`No derivative rule for "${name}".`);
  }
}

/** Symbolic derivative of `e` with respect to `x` (unsimplified). */
export function derivative(e: Expr, x: string): Expr {
  switch (e.t) {
    case "num": return N(0);
    case "var": return N(e.name === x ? 1 : 0);
    case "neg": return { t: "neg", e: derivative(e.e, x) };
    case "add": return { t: "add", l: derivative(e.l, x), r: derivative(e.r, x) };
    case "sub": return { t: "sub", l: derivative(e.l, x), r: derivative(e.r, x) };
    case "mul": // (uv)' = u'v + uv'
      return { t: "add", l: { t: "mul", l: derivative(e.l, x), r: e.r }, r: { t: "mul", l: e.l, r: derivative(e.r, x) } };
    case "div": // (u/v)' = (u'v - uv')/v^2
      return {
        t: "div",
        l: { t: "sub", l: { t: "mul", l: derivative(e.l, x), r: e.r }, r: { t: "mul", l: e.l, r: derivative(e.r, x) } },
        r: { t: "pow", l: e.r, r: N(2) },
      };
    case "pow": {
      const uConst = !containsVar(e.l, x);
      const vConst = !containsVar(e.r, x);
      if (vConst) {
        // u^c: c*u^(c-1)*u'  (c a constant expression)
        return {
          t: "mul",
          l: { t: "mul", l: e.r, r: { t: "pow", l: e.l, r: { t: "sub", l: e.r, r: N(1) } } },
          r: derivative(e.l, x),
        };
      }
      if (uConst) {
        // a^v: a^v*ln(a)*v'
        return {
          t: "mul",
          l: { t: "mul", l: e, r: { t: "fn", name: "ln", arg: e.l } },
          r: derivative(e.r, x),
        };
      }
      // general u^v = exp(v ln u): u^v (v' ln u + v u'/u)
      return {
        t: "mul",
        l: e,
        r: {
          t: "add",
          l: { t: "mul", l: derivative(e.r, x), r: { t: "fn", name: "ln", arg: e.l } },
          r: { t: "div", l: { t: "mul", l: e.r, r: derivative(e.l, x) }, r: e.l },
        },
      };
    }
    case "fn": // chain rule
      return { t: "mul", l: derivFn(e.name, e.arg), r: derivative(e.arg, x) };
  }
}

// ---------------------------------------------------------------------------
// Simplification — enough to make output readable, never changing the value.
// ---------------------------------------------------------------------------

const isNum = (e: Expr, v?: number): boolean => e.t === "num" && (v === undefined || e.v === v);

/** Flattens a left/right-nested product into its factor list. */
function flattenMul(e: Expr): Expr[] {
  return e.t === "mul" ? [...flattenMul(e.l), ...flattenMul(e.r)] : [e];
}

/**
 * Display order for a factor within a product: numbers, then variables/powers,
 * then everything else, with functions last. This is what turns the chain-rule
 * result cos(x^2)·2·x into the conventional 2·x·cos(x^2).
 */
function factorRank(e: Expr): number {
  switch (e.t) {
    case "num": return 0;
    case "neg": return 1;
    case "var": return 1;
    case "pow": return 2;
    case "div": return 3;
    case "fn": return 5;
    default: return 4;
  }
}

/**
 * Canonical simplification via the CAS core: collects like terms, cancels,
 * expands, and orders factors readably (2*x + 3*x → 5*x, x/x → 1). The
 * peephole pass below remains as the fallback for anything the canonical
 * form cannot represent (e.g. a literal division by zero), so simplify()
 * stays total.
 */
export function simplify(e: Expr): Expr {
  try {
    return casSimplify(e);
  } catch (err) {
    if (err instanceof CasBail) return peepholeSimplify(e);
    throw err;
  }
}

function peepholeSimplify(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg": {
      const x = peepholeSimplify(e.e);
      if (x.t === "num") return N(-x.v);
      if (x.t === "neg") return x.e;
      return { t: "neg", e: x };
    }
    case "fn": {
      const a = peepholeSimplify(e.arg);
      if (a.t === "num") return N(EVAL_FN[e.name](a.v));
      return { t: "fn", name: e.name, arg: a };
    }
    case "add": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(l.v + r.v);
      if (isNum(l, 0)) return r;
      if (isNum(r, 0)) return l;
      return { t: "add", l, r };
    }
    case "sub": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(l.v - r.v);
      if (isNum(r, 0)) return l;
      if (isNum(l, 0)) return peepholeSimplify({ t: "neg", e: r });
      return { t: "sub", l, r };
    }
    case "mul": {
      // Flatten the whole product, fold the numeric constants into one coefficient,
      // then order the remaining factors so the printed form reads conventionally
      // (coefficient first, functions last).
      const factors = [...flattenMul(peepholeSimplify(e.l)), ...flattenMul(peepholeSimplify(e.r))];
      let coeff = 1;
      const rest: Expr[] = [];
      for (const f of factors) {
        if (f.t === "num") coeff *= f.v;
        else rest.push(f);
      }
      if (coeff === 0) return N(0);
      // Stable sort (V8's is stable) keeps same-rank factors in their original order.
      rest.sort((a, b) => factorRank(a) - factorRank(b));
      const ordered: Expr[] = coeff !== 1 || rest.length === 0 ? [N(coeff), ...rest] : rest;
      return ordered.reduce((acc, f) => ({ t: "mul", l: acc, r: f }));
    }
    case "div": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num" && r.v !== 0) return N(l.v / r.v);
      // 0/r is 0 only when r is DEMONSTRABLY non-zero. casSimplify correctly
      // bails on a zero denominator, which handed 0/0 to this peephole, and the
      // unconditional fold answered "0" -- so differentiate("x/0"),
      // differentiate("0/0") and differentiate("(x+1)/0") all reported the
      // derivative as 0. A symbolic denominator is not known to be non-zero
      // either, so it is left alone rather than folded.
      if (isNum(l, 0) && r.t === "num" && r.v !== 0) return N(0);
      if (isNum(r, 1)) return l;
      return { t: "div", l, r };
    }
    case "pow": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(Math.pow(l.v, r.v));
      if (isNum(r, 1)) return l;
      if (isNum(r, 0)) return N(1);
      if (isNum(l, 1)) return N(1);
      return { t: "pow", l, r };
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting AST -> string, with minimal parentheses.
// ---------------------------------------------------------------------------

const PREC: Record<Expr["t"], number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 2, pow: 3, fn: 4, num: 5, var: 5 };

/**
 * SIGNIFICANT FIGURES, NOT DECIMAL PLACES.
 *
 * This rounded to 6 decimal places, which silently destroys any quantity smaller
 * than 1e-6 and any coefficient that needs more precision than that:
 *
 *   - `x^2 - 1e-20 = 0` has roots ±1e-10, and both printed as "0" — so the answer
 *     read "[0, 0]", two identical roots, for an equation with two distinct ones.
 *   - `integrate("1/(x^2+x+1)", 0, 1).antiderivative` printed
 *     `1.154701*atan(1.154701*x + 0.57735)` where the coefficient is
 *     2/sqrt(3) = 1.1547005383792515. The `value` was exact; the closed form
 *     shown was not, and did not re-parse. Anyone copying that expression out of
 *     their document got a different function from the one integrated.
 *   - The working for a quadratic with tiny coefficients read
 *     `Polynomial form: 0·x^2 + 0·x^1 + 0·x^0 = 0` beside a claimed exact root.
 *
 * 12 significant figures keeps every digit a double can be trusted for while
 * still suppressing the 0.30000000000000004 noise that made a fixed rounding
 * attractive in the first place. Integers are unchanged.
 */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  return String(Number(v.toPrecision(12)));
}

export function format(e: Expr): string {
  const wrap = (child: Expr, parentPrec: number): string => {
    const s = format(child);
    return PREC[child.t] < parentPrec ? `(${s})` : s;
  };
  switch (e.t) {
    case "num": return fmtNum(e.v);
    case "var": return e.name;
    case "neg": return `-${wrap(e.e, PREC.neg)}`;
    case "add": return `${wrap(e.l, PREC.add)} + ${wrap(e.r, PREC.add)}`;
    case "sub": return `${wrap(e.l, PREC.sub)} - ${wrap(e.r, PREC.sub)}`;
    case "mul": return `${wrap(e.l, PREC.mul)}*${wrap(e.r, PREC.mul)}`;
    case "div": return `${wrap(e.l, PREC.div)}/${wrap(e.r, PREC.div + 1)}`;
    case "pow": return `${wrap(e.l, PREC.pow + 1)}^${wrap(e.r, PREC.pow)}`;
    case "fn": return `${e.name}(${format(e.arg)})`;
  }
}

// ---------------------------------------------------------------------------
// Polynomial extraction (for exact linear/quadratic solving).
// ---------------------------------------------------------------------------

/** Coefficients [c0, c1, ...] if `e` is a polynomial in `x`, else null. */
export function polyCoeffs(e: Expr, x: string): number[] | null {
  if (!containsVar(e, x)) {
    // A subtree with no x is a constant — evaluate it (functions of constants,
    // pi, e, arithmetic all collapse to a number).
    try { return [evalAst(e, {})]; } catch { return null; }
  }
  switch (e.t) {
    case "var": return e.name === x ? [0, 1] : null;
    case "neg": {
      const c = polyCoeffs(e.e, x);
      return c ? c.map((v) => -v) : null;
    }
    case "add": case "sub": {
      const a = polyCoeffs(e.l, x), b = polyCoeffs(e.r, x);
      if (!a || !b) return null;
      const out = new Array(Math.max(a.length, b.length)).fill(0);
      a.forEach((v, k) => (out[k] += v));
      b.forEach((v, k) => (out[k] += e.t === "add" ? v : -v));
      return out;
    }
    case "mul": {
      const a = polyCoeffs(e.l, x), b = polyCoeffs(e.r, x);
      if (!a || !b) return null;
      const out = new Array(a.length + b.length - 1).fill(0);
      a.forEach((av, i) => b.forEach((bv, j) => (out[i + j] += av * bv)));
      return out;
    }
    case "div": {
      // Only division by a constant keeps it polynomial.
      const denom = polyCoeffs(e.r, x);
      if (!denom || denom.length !== 1) return null;
      // Division by a zero constant is not a polynomial. Without this guard
      // "x/0 = 1" produced coefficients [NaN, Infinity], sailed through the
      // linear branch, and was reported as roots ["NaN"] with the method
      // "exact (linear)". The parser deliberately refuses the identifiers NaN
      // and Infinity and the literal 1e999 to prevent exactly this outcome;
      // arithmetic division by zero walked past both of those defences.
      if (!Number.isFinite(denom[0]) || denom[0] === 0) return null;
      const num = polyCoeffs(e.l, x);
      return num ? num.map((v) => v / denom[0]) : null;
    }
    case "pow": {
      // x-containing base to a non-negative integer constant power.
      if (containsVar(e.r, x)) return null;
      let p: number;
      try { p = evalAst(e.r, {}); } catch { return null; }
      if (!Number.isInteger(p) || p < 0 || p > 64) return null;
      const base = polyCoeffs(e.l, x);
      if (!base) return null;
      let acc = [1];
      for (let k = 0; k < p; k++) {
        const out = new Array(acc.length + base.length - 1).fill(0);
        acc.forEach((av, i) => base.forEach((bv, j) => (out[i + j] += av * bv)));
        acc = out;
      }
      return acc;
    }
    default:
      return null; // fn(x): not polynomial
  }
}

// ---------------------------------------------------------------------------
// Root finding.
// ---------------------------------------------------------------------------

export interface Root {
  display: string;
  re: number;
  im: number;
  exact: boolean;
  /** True for a symbolic (rearranged) solution like a = F/m; re/im are NaN then. */
  symbolic?: boolean;
}

/**
 * Trims leading coefficients that are zero RELATIVE TO THE REST of the polynomial.
 *
 * The threshold was absolute — `< 1e-12` — which is not a question about the
 * polynomial, it is a question about the units someone happened to type in.
 * `0.0000000000001*x^2 - 1 = 0` had its x² term deleted, became `-1 = 0`, and was
 * reported as **"no-solution"** with the caveat "No value of the variable
 * satisfies this equation." The true roots are ±3162277.66.
 *
 * It was a BAND, which is why no test found it: a 1e-8 coefficient works and a
 * 1e-12 one works, so sampling either side of 1e-13 certifies the bug. Scaling by
 * the largest coefficient asks the right question — is this term negligible in
 * THIS polynomial? — and is invariant under multiplying the whole equation by a
 * constant, which cannot change its roots.
 */
function trimPoly(c: number[]): number[] {
  const out = c.slice();
  // ONLY EXACT ZEROS. A non-zero leading coefficient, however small, means the
  // polynomial genuinely has that degree and genuinely has that many roots —
  // `1e-13*x^2 - 1 = 0` really does have roots at ±3162277.66, and deleting the
  // x² term reported "no solution" for an equation any student can solve.
  //
  // A relative threshold does not fix this, and my first attempt at one made it
  // worse in the opposite direction: scaling by the LARGEST coefficient meant
  // `x - 1e300 = 0` compared its x coefficient of 1 against 1e285 and deleted it,
  // so an equation with the root 1e300 came back "no solution". A big constant
  // term does not make the x term negligible. There is no threshold that is right
  // here, because the question "is this coefficient zero" is not a question about
  // magnitude at all.
  //
  // Cancellation produces EXACT zeros in floating point — subtracting two equal
  // doubles gives exactly 0 — so this still collapses `x^2 + x = x^2 + 1` to
  // degree 1, which is what the trim is for. The residual risk is a coefficient
  // left as rounding dust by something like 0.1*10 - 1, which would show up as a
  // spurious enormous root; solveEquation caveats that case rather than trimming
  // it away silently.
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

function fmtRoot(re: number, im: number): string {
  const r = Math.abs(re) < 1e-10 ? 0 : re;
  const i = Math.abs(im) < 1e-10 ? 0 : im;
  if (i === 0) return fmtNum(r);
  const sign = i < 0 ? "−" : "+";
  return `${fmtNum(r)} ${sign} ${fmtNum(Math.abs(i))}i`;
}

/** Exact roots of a linear or quadratic; null if degree is not 1 or 2. */
function solvePolyExact(coeffs: number[]): Root[] | null {
  const c = trimPoly(coeffs);
  const deg = c.length - 1;
  if (deg === 1) {
    const root = -c[0] / c[1];
    return [{ display: fmtNum(root), re: root, im: 0, exact: true }];
  }
  if (deg === 2) {
    const [cc, b, a] = c;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const r1 = (-b + s) / (2 * a);
      const r2 = (-b - s) / (2 * a);
      // "IS THE DISCRIMINANT ZERO" IS A RELATIVE QUESTION.
      //
      // The test was `|disc| < 1e-12`, an absolute threshold on a quantity whose
      // size is set by the coefficients. `0.0000000001*x^2 - 0.0001 = 0` has
      // disc = 4e-14, so the two roots ±1000 were collapsed into the single root
      // **1000** and labelled `exact (quadratic)`. Half the answer, presented as
      // certain. Another band — 1e-7 coefficients fail the same way, 1e-6 ones do
      // not.
      //
      // The discriminant scales as coefficient², so the yardstick must too.
      // Comparing against b² and 4ac keeps this invariant under multiplying the
      // whole equation through by a constant, which cannot change its roots.
      const discScale = Math.max(Math.abs(b * b), Math.abs(4 * a * cc));
      const discIsZero = discScale > 0
        ? Math.abs(disc) <= discScale * Number.EPSILON * 8
        : Math.abs(disc) < 1e-12;
      if (discIsZero) return [{ display: fmtNum(r1), re: r1, im: 0, exact: true }];
      return [
        { display: fmtNum(r1), re: r1, im: 0, exact: true },
        { display: fmtNum(r2), re: r2, im: 0, exact: true },
      ].sort((x, y) => y.re - x.re);
    }
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    return [
      { display: fmtRoot(re, im), re, im, exact: true },
      { display: fmtRoot(re, -im), re, im: -im, exact: true },
    ];
  }
  return null;
}

// ---------------------------------------------------------------------------
// All roots of a polynomial (real AND complex) via Durand–Kerner. This is what
// makes degree-≥3 solving COMPLETE — a scan for real roots in a range could only
// ever find some of them. Self-contained complex arithmetic; no external deps.
// ---------------------------------------------------------------------------

interface Cx { re: number; im: number }
const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);

/** Evaluates a polynomial (ascending coeffs) at a complex point via Horner. */
function polyEvalCx(coeffs: number[], z: Cx): Cx {
  let acc: Cx = { re: 0, im: 0 };
  for (let i = coeffs.length - 1; i >= 0; i--) acc = cAdd(cMul(acc, z), { re: coeffs[i], im: 0 });
  return acc;
}

/** Snaps a value to the nearest integer when it is within tol, else rounds for display. */
function snap(v: number): number {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-7) return r;
  return Math.round(v * 1e9) / 1e9;
}

/**
 * All roots of a polynomial of degree ≥ 1 (ascending coeffs), real and complex,
 * by Durand–Kerner iteration. Equal roots are collapsed and their multiplicity
 * reported. Roots are numerical but complete — every one is returned.
 */
function allPolyRoots(coeffs: number[]): Root[] {
  const c = trimPoly(coeffs);
  const n = c.length - 1;
  const lead = c[n];
  const monic = c.map((v) => v / lead);

  // Seed with distinct points off the real axis to avoid symmetric stalls.
  const seed: Cx = { re: 0.4, im: 0.9 };
  const roots: Cx[] = [];
  let p: Cx = { re: 1, im: 0 };
  for (let k = 0; k < n; k++) {
    roots.push({ ...p });
    p = cMul(p, seed);
  }

  for (let iter = 0; iter < 1000; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < n; k++) {
      let denom: Cx = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) if (j !== k) denom = cMul(denom, cSub(roots[k], roots[j]));
      if (cAbs(denom) < 1e-300) continue; // coincident guesses; nudge next round
      const delta = cDiv(polyEvalCx(monic, roots[k]), denom);
      roots[k] = cSub(roots[k], delta);
      maxDelta = Math.max(maxDelta, cAbs(delta));
    }
    if (maxDelta < 1e-14) break;
  }

  // Snap, split real/complex, collapse equal roots into multiplicities.
  const cleaned = roots.map((z) => {
    const re = snap(z.re);
    const im = Math.abs(z.im) < 1e-7 ? 0 : snap(z.im);
    return { re, im };
  });
  const groups: { re: number; im: number; mult: number }[] = [];
  for (const z of cleaned) {
    const g = groups.find((h) => Math.abs(h.re - z.re) < 1e-6 && Math.abs(h.im - z.im) < 1e-6);
    if (g) g.mult++;
    else groups.push({ ...z, mult: 1 });
  }
  return groups
    .sort((a, b) => b.re - a.re || a.im - b.im)
    .map((g) => ({
      display: fmtRoot(g.re, g.im) + (g.mult > 1 ? ` (×${g.mult})` : ""),
      re: g.re,
      im: g.im,
      exact: false,
    }));
}

/** Real roots of f in [lo, hi] by scanning for sign changes, then bisecting. */
function numericRealRoots(f: (x: number) => number, lo: number, hi: number, steps = 4000): Root[] {
  const roots: Root[] = [];

  // A SIGN CHANGE IS NOT A ROOT. IT IS A SIGN CHANGE.
  //
  // Bisection used to stop on `|f(m)| < 1e-13` OR on the interval getting narrow,
  // and accept the midpoint either way. Across a POLE the function also changes
  // sign — from -infinity to +infinity — so the interval duly narrowed onto the
  // pole and the pole was reported as a root:
  //
  //   solveEquation("1/(x-2.25) = 0")     -> root 2.25, where f = -1.1e12
  //   solveEquation("x/(x-2.25) = 1")     -> root 2.25, residual -2.5e12
  //   solveEquation("tan(x) = 2")         -> 1176 "roots" ALTERNATING real
  //                                          solutions and asymptotes
  //
  // `1/(x-2) = 0` looked correct only by accident: the scan grid lands exactly on
  // 2, so evalAst gives Infinity and the sign test is skipped. Move the pole off
  // the grid and it reappears — the hallmark of a sampling artefact, not a fix.
  //
  // So a candidate is now accepted only if the residual is actually small, judged
  // against the size of f nearby rather than against an absolute constant: a
  // legitimately steep function can have a real root whose residual is not tiny,
  // and demanding |f| < 1e-13 outright would silently discard real answers. The
  // local scale comes from f a little to each side of the candidate, so a pole —
  // where those values are astronomically large — cannot pass, while a steep but
  // finite crossing can.
  const residualIsSmall = (m: number, fm: number): boolean => {
    if (!Number.isFinite(fm)) return false;
    if (fm === 0) return true;
    const step = Math.max(Math.abs(m), 1) * 1e-6;
    let near = 0;
    for (const d of [-step, step]) {
      const v = f(m + d);
      if (Number.isFinite(v)) near = Math.max(near, Math.abs(v));
    }
    // At a genuine root, |f| just off the root is of order |f'|*step, and |f(m)|
    // is far smaller still. At a pole, |f(m)| is comparable to or larger than the
    // neighbourhood and both are enormous. The 1e-6 factor is the margin.
    if (near > 0 && Math.abs(fm) > near * 1e-6) return false;
    // CANCELLATION NOISE IS NOT A ROOT EITHER.
    //
    // `cosh(x)^2 - sinh(x)^2 = 1` is an identity, but the two squares are ~1e86 at
    // x = 100, so the computed difference is rounding dust of order 1e70 — the true
    // answer of 1 is far below the noise. Wherever that dust happens to land on
    // zero, the scan called it a root: 33 of them. A genuine root of a typed
    // equation has |f| just off the root of order |f'|*h, which is modest; a
    // function that swings by 1e15 within a hair's breadth of its "root" is not
    // being evaluated accurately enough for the answer to mean anything.
    if (near > 1e15) return false;
    return Math.abs(fm) < 1e-6 * Math.max(1, near);
  };

  const push = (x: number, fx: number) => {
    if (!Number.isFinite(x)) return;
    if (!residualIsSmall(x, fx)) return;
    if (roots.some((r) => Math.abs(r.re - x) < 1e-6)) return;
    roots.push({ display: fmtNum(x), re: x, im: 0, exact: false });
  };

  const h = (hi - lo) / steps;
  let prevX = lo;
  let prevY = f(lo);
  if (Math.abs(prevY) < 1e-10) push(lo, prevY);
  for (let k = 1; k <= steps; k++) {
    const cx = lo + k * h;
    const cy = f(cx);
    if (Number.isFinite(prevY) && Number.isFinite(cy) && prevY * cy < 0) {
      // Bisection on [prevX, cx].
      let a = prevX, b = cx, fa = prevY;
      let done = false;
      for (let it = 0; it < 80; it++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (Math.abs(fm) < 1e-13 || (b - a) / 2 < 1e-12) { push(m, fm); done = true; break; }
        if (fa * fm < 0) b = m;
        else { a = m; fa = fm; }
      }
      if (!done) {
        const m = (a + b) / 2;
        push(m, f(m));
      }
    } else if (Math.abs(cy) < 1e-10) {
      push(cx, cy);
    }
    prevX = cx; prevY = cy;
  }
  return roots.sort((x, y) => y.re - x.re);
}

// ---------------------------------------------------------------------------
// Public: equation solving
// ---------------------------------------------------------------------------

export interface EquationResult {
  variable: string;
  roots: Root[];
  method: string;
  steps: string[];
  caveats: string[];
  /** Every unknown in the equation — lets a caller offer "solve for …" choices. */
  unknowns?: string[];
}

/**
 * Numeric back-substitution check for symbolic solutions whose exact
 * verification is blocked by an opaque sqrt atom (the quadratic branches):
 * assign fixed sample values to the other symbols, evaluate the root, and
 * require f(root) ≈ 0 at every sample where the root is real and finite.
 * Deterministic — a fixed sample table, no RNG.
 */
const VERIFY_SAMPLES = [1, 2, 0.7, -1.3, 3.1, -0.6, 1.9, -2.4];

function verifySymbolicRoots(f: Expr, x: string, roots: Expr[], others: string[]): boolean {
  let checked = 0;
  for (let s = 0; s < VERIFY_SAMPLES.length; s++) {
    const vars: Record<string, number> = {};
    others.forEach((v, i) => {
      vars[v] = VERIFY_SAMPLES[(s + i * 3) % VERIFY_SAMPLES.length] + s * 0.17;
    });
    for (const root of roots) {
      let rv: number;
      let resid: number;
      try {
        rv = evalAst(root, vars);
        if (!Number.isFinite(rv)) continue; // complex branch at this sample
        resid = evalAst(f, { ...vars, [x]: rv });
      } catch {
        continue;
      }
      if (!Number.isFinite(resid)) continue; // sample hit a pole
      checked++;
      if (Math.abs(resid) > 1e-6 * (1 + Math.abs(rv))) return false;
    }
  }
  return checked > 0;
}

/**
 * Solves an equation for one unknown. Accepts "LHS = RHS" (an expression alone
 * is treated as "= 0"). Linear/quadratic are exact; anything else is solved
 * numerically over a real interval. Returns null if the input cannot be parsed.
 */
export function solveEquation(input: string, variable?: string, range = 1000): EquationResult | null {
  let lhs: Expr, rhs: Expr;
  try {
    const parts = input.split("=");
    if (parts.length > 2) return null;
    lhs = parseExpr(parts[0]);
    rhs = parts.length === 2 ? parseExpr(parts[1]) : N(0);
  } catch {
    return null;
  }
  // f = LHS - RHS, solve f = 0.
  const f: Expr = { t: "sub", l: lhs, r: rhs };
  const vars = freeVars(f);
  const x = variable ?? (vars.length === 1 ? vars[0] : vars.includes("x") ? "x" : vars[0]);
  if (!x) return null; // no unknown at all
  if (!variable && vars.length > 1) {
    return {
      variable: x,
      roots: [],
      method: "unsolved",
      steps: [],
      caveats: [`This equation has more than one unknown (${vars.join(", ")}). Solve for one variable at a time.`],
      unknowns: vars,
    };
  }

  const caveats: string[] = [];
  const steps: string[] = [];

  const coeffs = polyCoeffs(f, x);
  if (coeffs) {
    const trimmed = trimPoly(coeffs);
    const deg = trimmed.length - 1;
    if (deg <= 0) {
      // 0 = 0 (identity) or c = 0 (no solution).
      const identity = Math.abs(trimmed[0]) < 1e-12;
      return {
        variable: x,
        roots: [],
        method: identity ? "identity" : "no-solution",
        steps: [`Reduced to ${fmtNum(trimmed[0])} = 0.`],
        caveats: [identity ? "Every value of the variable satisfies this equation (an identity)." : "No value of the variable satisfies this equation."],
      };
    }
    const exact = solvePolyExact(trimmed);
    if (exact) {
      const terms = trimmed.map((c, k) => `${fmtNum(c)}·${x}^${k}`).reverse().join(" + ");
      steps.push(`Polynomial form: ${terms} = 0.`);
      // A leading coefficient dwarfed by the next one produces a genuine but
      // enormous root — and if that coefficient is rounding dust from cancellation
      // rather than something the user typed, the root is an artefact. Since
      // trimPoly can no longer tell the two apart (and should not guess), say so.
      const lead = Math.abs(trimmed[trimmed.length - 1]);
      const next = Math.abs(trimmed[trimmed.length - 2] ?? 0);
      // BOTH conditions, deliberately. The ratio alone fires on `x - 1e15 = 0`,
      // an entirely ordinary equation whose x coefficient is exactly 1 — and a
      // warning that appears on normal input is a false message that teaches
      // people to ignore the real ones. Rounding dust from cancellation is tiny in
      // ABSOLUTE terms as well (0.1*10 - 1 leaves 2.2e-16), so requiring both
      // separates it from a legitimately large constant term.
      if (lead > 0 && next > 0 && lead < 1e-8 && next / lead > 1e14) {
        caveats.push(
          `The ${x}^${trimmed.length - 1} coefficient (${fmtNum(trimmed[trimmed.length - 1])}) is more than ` +
            `1e14 times smaller than the next one, which makes one root correspondingly enormous. ` +
            `That root is mathematically correct for the coefficients as given, but if the small ` +
            `coefficient came from subtracting two nearly equal quantities it is rounding noise and ` +
            `the root is an artefact. Check it against the equation you meant to write.`,
        );
      }
      if (deg === 2) {
        const [cc, b, a] = trimmed;
        const disc = b * b - 4 * a * cc;
        steps.push(`Quadratic a=${fmtNum(a)}, b=${fmtNum(b)}, c=${fmtNum(cc)}; discriminant b²−4ac = ${fmtNum(disc)}.`);
        if (disc < 0) caveats.push("The discriminant is negative, so the two roots are a complex-conjugate pair.");
      }
      return { variable: x, roots: exact, method: `exact (${deg === 1 ? "linear" : "quadratic"})`, steps, caveats };
    }
    // Degree >= 3 polynomial: ALL roots (real and complex) via Durand–Kerner.
    const roots = allPolyRoots(trimmed);
    steps.push(`Degree-${deg} polynomial; all ${deg} root${deg === 1 ? "" : "s"} found (Durand–Kerner), counting multiplicity.`);
    caveats.push(
      `Complete: every root is shown, real and complex. Values are numerical (refined to ~1e-10); an exact closed form is not attempted above the quadratic.`
    );
    return { variable: x, roots, method: "complete (all roots)", steps, caveats };
  }

  // Not numerically polynomial in x — try EXACT symbolic rearrangement before
  // any numeric scan: it covers every rational equation whose numerator is
  // linear or quadratic in x, with other symbols carried through (F = m·a
  // solved for a → a = F/m; PV = nRT solved for T → T = P·V/(n·R)).
  const others = vars.filter((v) => v !== x);
  const sym = solveRationalInVar(f, x);
  if (sym) {
    const verified = sym.verified || verifySymbolicRoots(f, x, sym.roots, others);
    if (verified) {
      const roots: Root[] = sym.roots.map((r) => ({
        display: format(r),
        re: NaN,
        im: NaN,
        exact: true,
        symbolic: true,
      }));
      steps.push(
        `${sym.kind === "linear" ? "Linear" : "Quadratic"} in ${x} once rearranged; solved in closed form` +
          (others.length ? ` with ${others.join(", ")} carried through symbolically.` : ".")
      );
      steps.push(
        sym.verified
          ? "Verified: substituting the solution back reduces the equation to exactly 0."
          : "Verified by substituting back at sample values of the other symbols."
      );
      for (const c of sym.nonzeroConditions) {
        caveats.push(`Requires ${format(c)} ≠ 0 — the rearrangement divides by it.`);
      }
      if (sym.discriminant) {
        caveats.push(`The two roots are the ± branches of the quadratic formula; they are real when ${format(sym.discriminant)} ≥ 0.`);
      }
      return { variable: x, roots, method: "exact (symbolic rearrangement)", steps, caveats, unknowns: vars };
    }
  }
  if (others.length) {
    // Other unknowns present and no closed form found — scanning a numeric
    // range with unbound symbols would be meaningless, so say what is missing
    // rather than reporting an empty scan as if it had searched something.
    return {
      variable: x,
      roots: [],
      method: "unsolved",
      steps,
      caveats: [
        `Could not isolate ${x} in closed form — this needs more than a linear/quadratic rearrangement, so the other symbol${others.length > 1 ? "s" : ""} (${others.join(", ")}) would need values first.`,
      ],
      unknowns: vars,
    };
  }

  const fNum = (xv: number): number => {
    try { return evalAst(f, { [x]: xv }); } catch { return NaN; }
  };

  // IS IT AN IDENTITY? ASK BEFORE SCANNING, AND ASK RELATIVE TO THE TWO SIDES.
  //
  // `(x-1)/(x-1) = 1` was reported as method "numeric (transcendental)" with FOUR
  // THOUSAND roots — "1000, 999.5, 999, …" — taking about 2.9 seconds. polyCoeffs
  // returns null for a non-constant denominator, the rational solver bails because
  // the numerator normalises to zero, so f is identically 0 when it reaches the
  // scanner, every grid point passes |f| < 1e-10, and the 1e-6 dedupe never fires
  // against 0.5 spacing.
  //
  // THE FIRST VERSION OF THIS CHECK TESTED f === 0 EXACTLY, and that was a fix
  // spelled to the three examples in the bug report. Those three cancel exactly in
  // binary. The identities a person actually types do not:
  //
  //   sin(x)^2 + cos(x)^2 = 1        evaluates to ±1.1e-16, not 0  -> 3620 "roots"
  //   cosh(x)^2 - sinh(x)^2 = 1      likewise                      ->   33 "roots"
  //   exp(ln(x)) = x                 likewise                      ->  852 "roots"
  //
  // So the question has to be asked relative to the SIZE OF THE TWO SIDES, not
  // against zero. |lhs − rhs| below a few epsilon of |lhs| + |rhs| is as equal as
  // double arithmetic can report, and exact equality is merely the special case
  // where the cancellation happened to be lucky. Evaluating the sides separately
  // is what makes that possible, and both are already to hand.
  //
  // NESTED SCALES, because a wide sweep alone cannot see these functions at all.
  // `cosh(x)^2 - sinh(x)^2 = 1` is an identity, but cosh(x)^2 overflows to
  // Infinity beyond x ~ 355, so only about 14 of 41 samples over [-1000, 1000] are
  // even computable — below any sensible quorum, so the check abstained and 33
  // fabricated roots came back. Sampling [-1, 1] and [-10, 10] as well puts plenty
  // of points where the functions are finite, without narrowing the wide sweep that
  // catches identities only true over a large range.
  const sideAt = (t: number): { diff: number; scale: number } | null => {
    let l: number, r: number;
    try {
      l = evalAst(lhs, { [x]: t });
      r = evalAst(rhs, { [x]: t });
    } catch {
      return null;
    }
    if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
    return { diff: Math.abs(l - r), scale: Math.abs(l) + Math.abs(r) };
  };
  /**
   * True when the two sides agree to within double precision at `t`, relative to
   * their own magnitudes.
   *
   * Relative to the SIDES, not to zero — that is the whole point. Testing
   * `f === 0` exactly only worked for the three examples in the original bug
   * report, because those cancel exactly in binary; the identities a person
   * actually types do not. `sin(x)^2 + cos(x)^2 - 1` evaluates to +/-1.1e-16 at
   * most doubles, and that produced 3620 "roots".
   *
   * KNOWN LIMIT, recorded in docs/KNOWN-DEFECTS.md rather than papered over: this
   * cannot see an identity whose evaluation is dominated by CATASTROPHIC
   * CANCELLATION. `cosh(x)^2 - sinh(x)^2 = 1` is the example — at x = 18 both
   * squares are about 1.1e15, so the computed difference carries roughly 0.25 of
   * rounding dust while the true answer is 1, and no tolerance derived from the
   * final magnitudes can distinguish that from a root. Measuring the dust by
   * perturbing x was tried and abandoned: the estimate is itself a random quantity,
   * and the version of it that finally passed the cosh case also reported
   * `tan(x) = 2` and `exp(x) = 2` as identities. A predicate I cannot validate is
   * worse than a limit I can state.
   */
  const sidesAgreeAt = (t: number): boolean | null => {
    const p = sideAt(t);
    if (p === null) return null;
    return p.diff <= Math.max(p.scale, 1) * Number.EPSILON * 64;
  };
  const sideProbe: Array<{ agrees: boolean }> = [];
  for (const span of [range, 10, 1]) {
    for (let i = 0; i < 41; i++) {
      // Irrational offsets, so a function that merely has zeros ON the grid — like
      // sin(x) = 0 — is never mistaken for one that is zero everywhere.
      const t = -span + ((2 * span) * (i + 0.381966011250105)) / 41;
      const v = sidesAgreeAt(t);
      if (v !== null) sideProbe.push({ agrees: v });
    }
  }
  const agreesEverywhere =
    sideProbe.length >= 30 &&
    sideProbe.every((p) => p.agrees);
  if (agreesEverywhere) {
    return {
      variable: x,
      roots: [],
      method: "identity",
      steps: [
        `Both sides agree to within double precision at ${sideProbe.length} sample points ` +
          `across [−${range}, ${range}].`,
      ],
      caveats: [
        `Every value of ${x} satisfies this equation (an identity), so there is no ` +
          `particular root to report.` +
          (sideProbe.length < 41
            ? ` The expression is undefined at some points — where a denominator vanishes, ` +
              `for example — and those are excluded.`
            : ""),
      ],
      unknowns: vars,
    };
  }

  // Transcendental: numeric root-finding.
  steps.push(`Not a polynomial in ${x}; solving numerically for real roots in [−${range}, ${range}].`);
  const roots = numericRealRoots(fNum, -range, range);
  caveats.push(`Numeric solution: only real roots this method could bracket in [−${range}, ${range}] are reported; it can miss roots that are complex, tangential, or outside the range.`);
  // A RUN of grid points that are all numerically zero is not a set of isolated
  // roots, and it must be WITHHELD rather than warned about.
  //
  // `exp(x) = 0` has no solution at all, but exp underflows to zero below about
  // x = -745, so the scan came back with 510 "roots" spaced 0.5 apart out in the
  // underflow region. The first attempt at this attached a warning and returned
  // the list anyway — but v2.39.0 already settled that argument in the other
  // direction, when `sqrt(x)^2` over [-1, 1] was upgraded from a caveated number
  // to a refusal on the grounds that a caveated number is still a number in the
  // document. 510 of them is the same mistake at scale.
  //
  // The signature is unmistakable: candidates arriving at the scan's own grid
  // spacing means the expression is numerically zero across an interval, not at
  // isolated points. No real equation has roots at exactly the resolution of the
  // instrument looking for them.
  if (roots.length > 20) {
    const spread = Math.abs(roots[0].re - roots[roots.length - 1].re);
    const gap = spread / Math.max(1, roots.length - 1);
    if (gap < ((2 * range) / 4000) * 1.5) {
      // A dense run has two possible causes and they deserve different answers.
      // `ln(exp(x)) = x` IS an identity; it failed the probe above only because
      // exp(x) goes denormal near x = -740, where ln loses enough precision that
      // one sample disagrees. Checking agreement across the span where the run was
      // actually found separates that from `exp(x) = 0`, where the two sides do not
      // agree anywhere except in the underflow region itself.
      const lo2 = Math.min(roots[0].re, roots[roots.length - 1].re);
      const hi2 = Math.max(roots[0].re, roots[roots.length - 1].re);
      let agree = 0;
      let disagree = 0;
      for (let i = 0; i < 25; i++) {
        const t = lo2 + ((hi2 - lo2) * (i + 0.381966011250105)) / 25;
        const v = sidesAgreeAt(t);
        if (v === true) agree++;
        else if (v === false) disagree++;
      }
      // Also ask away from the run: an identity holds everywhere, underflow does not.
      let outsideAgree = 0;
      for (const t of [0.5, 1.5, -1.5, 3.25, -3.25, 7.5, -7.5]) {
        if (sidesAgreeAt(t) === true) outsideAgree++;
      }
      if (disagree === 0 && agree >= 10 && outsideAgree >= 5) {
        return {
          variable: x,
          roots: [],
          method: "identity",
          steps,
          caveats: [
            `Every value of ${x} satisfies this equation (an identity), so there is no ` +
              `particular root to report. The two sides agree to within double precision ` +
              `everywhere they can both be evaluated, though at the extremes of the range ` +
              `one of them overflows or falls below the smallest representable number.`,
          ],
          unknowns: vars,
        };
      }
      return {
        variable: x,
        roots: [],
        method: "no reliable root found",
        steps,
        caveats: [
          `${roots.length} candidate roots came back at essentially the scan's own grid ` +
            `spacing, which means this expression is numerically zero across a whole ` +
            `interval rather than at isolated points — underflow is the usual cause, as in ` +
            `exp(x) = 0, where exp falls below the smallest representable double near ` +
            `${x} ≈ −745 without ever actually reaching zero. None of those values is ` +
            `reported, because they are artefacts of double precision rather than ` +
            `solutions. If you expected a root here, the equation may have no real ` +
            `solution at all.`,
        ],
        unknowns: vars,
      };
    }
  }
  return { variable: x, roots, method: "numeric (transcendental)", steps, caveats };
}

// ---------------------------------------------------------------------------
// Public: differentiation
// ---------------------------------------------------------------------------

export interface DerivativeResult {
  variable: string;
  expression: string;
  derivative: string;
  caveats: string[];
}

/** Symbolic derivative of `input` with respect to `variable` (default: the sole free variable, else x). */
export function differentiate(input: string, variable?: string): DerivativeResult | null {
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");
  const d = simplify(simplify(derivative(e, x)));
  const caveats: string[] = [];
  if (freeVars(e).length > 1) caveats.push(`Differentiated with respect to ${x}; other symbols were treated as constants.`);
  if (/\babs\b/.test(input)) caveats.push("The derivative of abs() is the sign function, undefined where its argument is zero.");
  // A division by literal zero anywhere in the expression means there is nothing
  // to differentiate. The peephole simplifier used to fold 0/0 to 0, so
  // differentiate("x/0") reported the derivative as "0" — a confident wrong
  // answer. That fold is gone, but the result is now a formatted "0/0", which is
  // still a non-answer and must not be presented as one without saying so.
  const out = format(d);
  if (/\/\s*0(?![.\d])/.test(out) || /\/\s*0(?![.\d])/.test(format(simplify(e)))) {
    caveats.push(
      "This expression divides by zero, so it has no value and no derivative. " +
        "Check the denominator — the result shown is not a number.",
    );
  }
  return { variable: x, expression: format(simplify(e)), derivative: out, caveats };
}

// ---------------------------------------------------------------------------
// Public: definite integration (numeric)
// ---------------------------------------------------------------------------

export interface IntegralResult {
  variable: string;
  value: number;
  method: string;
  /** The symbolic antiderivative F(x), when one was found (exact path). */
  antiderivative?: string;
  caveats: string[];
}

const V = (name: string): Expr => ({ t: "var", name });
const near = (v: number, t: number): boolean => Math.abs(v - t) < 1e-12;
const lnAbs = (u: Expr): Expr => ({ t: "fn", name: "ln", arg: { t: "fn", name: "abs", arg: u } });
function safeConst(e: Expr): number | null {
  try { return evalAst(e, {}); } catch { return null; }
}

/** {a,b} if `e` is a·x + b (degree ≤ 1 in x), else null. */
function linearInX(e: Expr, x: string): { a: number; b: number } | null {
  const cf = polyCoeffs(e, x);
  if (!cf) return null;
  const t = trimPoly(cf);
  if (t.length > 2) return null;
  return { a: t[1] ?? 0, b: t[0] ?? 0 };
}

// Elementary antiderivatives for f(u); combined with the linear-argument rule
// ∫ f(a·x+b) dx = F(a·x+b)/a.
const FN_INTEGRAL: Record<string, (u: Expr) => Expr> = {
  sin: (u) => ({ t: "neg", e: { t: "fn", name: "cos", arg: u } }),
  cos: (u) => ({ t: "fn", name: "sin", arg: u }),
  exp: (u) => ({ t: "fn", name: "exp", arg: u }),
  sinh: (u) => ({ t: "fn", name: "cosh", arg: u }),
  cosh: (u) => ({ t: "fn", name: "sinh", arg: u }),
};

/**
 * Symbolic antiderivative of `e` with respect to `x`, or null when no rule
 * applies (then the caller falls back to numeric quadrature). Covers linearity,
 * the power rule (incl. 1/x → ln|x|), 1/(x²+1) → atan, e^x, sin/cos/sinh/cosh,
 * and linear arguments a·x+b for all of the above.
 */
function symbolicAntideriv(e: Expr, x: string): Expr | null {
  if (!containsVar(e, x)) return { t: "mul", l: e, r: V(x) }; // ∫ c dx = c·x
  switch (e.t) {
    case "var":
      return { t: "div", l: { t: "pow", l: V(x), r: N(2) }, r: N(2) }; // ∫ x dx = x²/2
    case "neg": {
      const a = symbolicAntideriv(e.e, x);
      return a ? { t: "neg", e: a } : null;
    }
    case "add": {
      const l = symbolicAntideriv(e.l, x), r = symbolicAntideriv(e.r, x);
      return l && r ? { t: "add", l, r } : null;
    }
    case "sub": {
      const l = symbolicAntideriv(e.l, x), r = symbolicAntideriv(e.r, x);
      return l && r ? { t: "sub", l, r } : null;
    }
    case "mul": {
      // A constant factor pulls out; a genuine product of two x-terms has no simple rule.
      if (!containsVar(e.l, x)) { const r = symbolicAntideriv(e.r, x); return r ? { t: "mul", l: e.l, r } : null; }
      if (!containsVar(e.r, x)) { const l = symbolicAntideriv(e.l, x); return l ? { t: "mul", l: e.r, r: l } : null; }
      return null;
    }
    case "div": {
      if (!containsVar(e.r, x)) { const u = symbolicAntideriv(e.l, x); return u ? { t: "div", l: u, r: e.r } : null; } // f/c
      if (!containsVar(e.l, x)) {
        if (e.r.t === "var") return { t: "mul", l: e.l, r: lnAbs(V(x)) }; // c/x → c·ln|x|
        const dc = trimPoly(polyCoeffs(e.r, x) ?? [0]);
        if (dc.length === 3 && near(dc[0], 1) && near(dc[1], 0) && near(dc[2], 1))
          return { t: "mul", l: e.l, r: { t: "fn", name: "atan", arg: V(x) } }; // c/(x²+1) → c·atan(x)
        return null;
      }
      return null;
    }
    case "pow": {
      if (!containsVar(e.r, x)) {
        const n = safeConst(e.r);
        if (n === null) return null;
        if (e.l.t === "var") {
          return near(n, -1) ? lnAbs(V(x)) : { t: "div", l: { t: "pow", l: V(x), r: N(n + 1) }, r: N(n + 1) };
        }
        const lin = linearInX(e.l, x);
        if (lin && lin.a !== 0) {
          return near(n, -1)
            ? { t: "div", l: lnAbs(e.l), r: N(lin.a) }
            : { t: "div", l: { t: "pow", l: e.l, r: N(n + 1) }, r: N(lin.a * (n + 1)) };
        }
      }
      return null;
    }
    case "fn": {
      const F = FN_INTEGRAL[e.name];
      if (!F) return null;
      const lin = linearInX(e.arg, x);
      if (!lin || lin.a === 0) return null;
      return { t: "div", l: F(e.arg), r: N(lin.a) };
    }
    default:
      return null;
  }
}

/**
 * First sampled point in [a, b] where `e` is undefined (non-finite or throwing),
 * or null if it is finite everywhere sampled.
 *
 * This exists because SIMPLIFICATION CAN WIDEN A DOMAIN: the canonical form of
 * sqrt(x)^2 is x, which is perfectly finite at x = −4 where the original is
 * not. Reporting a value for an integral that does not exist — and calling it
 * exact — is precisely the confidently-wrong output this product keeps
 * designing out, so the ORIGINAL integrand is what gets checked.
 *
 * Sampling is a heuristic: it cannot prove a function is defined everywhere,
 * only find a witness that it is not. A missed narrow gap therefore leaves the
 * old behaviour, never a new false warning.
 */
/**
 * Does `e` actually blow up at `t`, or is the singularity removable?
 *
 * A ZERO OF A DENOMINATOR IS NOT NECESSARILY A POLE. The first version of the
 * structural detector reported every real root of a denominator inside the
 * interval without asking whether the numerator vanished there too, and it
 * refused five correct integrals: `(x^2-1)/(x-1)` over [0, 2] is **4**, not a
 * divergence — the integrand IS x + 1. Likewise `x/x`, `(x-2)/(x-2)` and
 * `(x^2-4)/(x-2)`. Trading a wrong number for a refused correct one is a smaller
 * harm, not an acceptable one.
 *
 * The test is cheap precisely because the caller has already established WHERE to
 * look — which is the thing a blind grid scan never knew. At a genuine pole of
 * order n >= 1, |f| grows like h^-n as h shrinks, so shrinking h by 1e6
 * multiplies |f| by at least 1e6. At a removable singularity |f| converges to its
 * limit and the ratio is about 1. The threshold is 1e3: three orders of magnitude
 * of daylight between the two cases, so this is a predicate with margin, not a
 * tolerance standing in for one.
 *
 * Both sides are probed. A pole of even order blows up alike on each, an odd one
 * changes sign, and a one-sided domain edge — sqrt or ln of the wrong sign —
 * misbehaves on only one, which must still count.
 */
function isGenuinePole(e: Expr, x: string, t: number): boolean {
  const scale = Math.max(1, Math.abs(t));
  const worstAt = (h: number): number => {
    let worst = 0;
    for (const s of [1, -1]) {
      let v: number;
      try {
        v = evalAst(e, { [x]: t + s * h });
      } catch {
        return Infinity;
      }
      if (Number.isNaN(v)) return Infinity;
      worst = Math.max(worst, Math.abs(v));
    }
    return worst;
  };
  const wide = worstAt(scale * 1e-5);
  const narrow = worstAt(scale * 1e-11);
  if (!Number.isFinite(wide) || !Number.isFinite(narrow)) return true;
  return narrow > 1e3 * (wide + 1e-300);
}

type Singularity = { at: number; kind: "pole" | "domain" };

function undefinedPointIn(e: Expr, x: string, a: number, b: number, steps = 129): Singularity | null {
  // SYMBOLIC FIRST. A sampled scan cannot find a pole reliably, and this one had
  // two independent blind spots that both produced a confident wrong number:
  //
  //   (a) GRID ALIGNMENT. The samples were a + (b-a)*i/129, so the pole at x = 1
  //       in [0, 2] needs i = 64.5 and was never visited. Proof by control:
  //       [0, 2.58] puts the same pole on i = 50 and WAS caught, [0, 2] was not.
  //       integrate("1/((x-1)^2)", 0, 2) therefore returned -2, method
  //       "exact (symbolic)", caveats [] -- a NEGATIVE value for an integrand
  //       that is strictly positive everywhere, for an integral that diverges to
  //       +infinity.
  //   (b) STRUCTURAL INVISIBILITY. tan has a pole at pi/2, but tan is FINITE at
  //       every representable double near pi/2, so Number.isFinite is true at
  //       every sample no matter how the grid is spaced. No amount of extra
  //       sampling fixes that. integrate("tan(x)", 0, 3) returned 0.01005... as
  //       "exact (symbolic)" with no caveat.
  //
  // So the poles are located by structure, and sampling is kept only as a
  // backstop for the cases structure does not cover (sqrt and ln of the wrong
  // sign, which the scan does find because those really are non-finite or NaN).
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const inside = (t: number): boolean => t > lo + 0 && t < hi - 0;

  const sym = symbolicSingularityIn(e, x, lo, hi);
  if (sym !== null) return { at: sym, kind: "pole" };

  // The sampled candidate has to pass the SAME two rules as a structural one.
  // Without the interior test, `x/x` over [0, 2] was refused because 0/0 is NaN at
  // the endpoint x = 0 — but the integral is 2, and an endpoint the integrand
  // misses is not a reason to refuse. Without the removable test,
  // `(x^2-4)/(x-2)` over [0, 3] was refused because 129 evenly spaced samples
  // land exactly on x = 2, where 0/0 is NaN; the integral is 10.5.
  const fatal = (t: number): boolean => t > lo && t < hi && isGenuinePole(e, x, t);
  for (let i = 0; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps;
    let v: number;
    try {
      v = evalAst(e, { [x]: t });
    } catch {
      if (fatal(t)) return { at: t, kind: "domain" };
      continue;
    }
    if (!Number.isFinite(v) && fatal(t)) return { at: t, kind: "domain" };
  }
  // Offset backstop: the same count of samples, shifted by an irrational
  // fraction of a step, so a pole cannot hide in the gaps of BOTH grids. This is
  // cheap insurance, not the mechanism -- the mechanism is symbolic.
  const OFFSET = 0.381966011250105; // (3 - sqrt(5)) / 2
  for (let i = 0; i < steps; i++) {
    const t = lo + ((hi - lo) * (i + OFFSET)) / steps;
    if (!inside(t)) continue;
    try {
      if (!Number.isFinite(evalAst(e, { [x]: t })) && fatal(t)) return { at: t, kind: "domain" };
    } catch {
      if (fatal(t)) return { at: t, kind: "domain" };
    }
  }
  return null;
}

/**
 * A point strictly inside (lo, hi) where `e` has a pole, found from the
 * STRUCTURE of the expression rather than by sampling. Returns null when no such
 * point is found -- which is not a proof that none exists, only that this
 * covers the two classes that reach users: a polynomial denominator, and the
 * trigonometric functions with known pole sets.
 */
function symbolicSingularityIn(e: Expr, x: string, lo: number, hi: number): number | null {
  let found: number | null = null;

  const report = (t: number): void => {
    if (found !== null) return;
    // Strictly inside, and actually a pole rather than a removable point.
    if (t > lo && t < hi && isGenuinePole(e, x, t)) found = t;
  };

  /** Real roots in (lo, hi) of a polynomial denominator, verified by residual. */
  const rootsOfDenominator = (d: Expr): void => {
    const c = polyCoeffs(d, x);
    if (!c) return;
    const deg = c.length - 1;
    if (deg < 1) return;
    if (!c.every((v) => Number.isFinite(v))) return;
    const at = (t: number): number => {
      let acc = 0;
      for (let k = deg; k >= 0; k--) acc = acc * t + c[k];
      return acc;
    };
    // Bisect on a fine grid, then REQUIRE the residual to be small relative to
    // the coefficient scale. A sign change alone is not a root -- that mistake
    // is what let this module report a pole as a root elsewhere.
    const scale = Math.max(...c.map(Math.abs), 1);
    const N = 2048;
    for (let i = 0; i < N; i++) {
      let p = lo + ((hi - lo) * i) / N;
      let q = lo + ((hi - lo) * (i + 1)) / N;
      let fp = at(p), fq = at(q);
      if (fp === 0) { report(p); continue; }
      if (fq === 0) { report(q); continue; }
      if (fp > 0 === fq > 0) continue;
      for (let k = 0; k < 80; k++) {
        const m = (p + q) / 2;
        const fm = at(m);
        if (fm === 0) { p = q = m; break; }
        if (fm > 0 === fp > 0) { p = m; fp = fm; } else { q = m; fq = fm; }
      }
      const m = (p + q) / 2;
      if (Math.abs(at(m)) <= 1e-9 * scale) report(m);
    }
  };

  /** Poles of tan/sec at cos(arg) = 0, and of cot/csc at sin(arg) = 0. */
  const trigPoles = (arg: Expr, offsetIsHalfPi: boolean): void => {
    const lin = linearInX(arg, x);
    if (!lin || lin.a === 0) return;
    // arg = lin.a*x + lin.b; poles where arg = base + k*pi.
    const base = offsetIsHalfPi ? Math.PI / 2 : 0;
    // Solve lin.a*t + lin.b = base + k*pi for t in (lo, hi).
    const kLo = (lin.a * lo + lin.b - base) / Math.PI;
    const kHi = (lin.a * hi + lin.b - base) / Math.PI;
    const from = Math.floor(Math.min(kLo, kHi)) - 1;
    const to = Math.ceil(Math.max(kLo, kHi)) + 1;
    // A bounded loop. An enormous linear coefficient could otherwise ask for
    // billions of iterations inside a task pane, which is a frozen Word.
    if (to - from > 100000) return;
    for (let k = from; k <= to; k++) {
      report((base + k * Math.PI - lin.b) / lin.a);
    }
  };

  const walk = (n: Expr): void => {
    if (found !== null) return;
    switch (n.t) {
      case "num":
      case "var":
        return;
      case "neg":
        return walk(n.e);
      case "add":
      case "sub":
      case "mul":
        walk(n.l); walk(n.r); return;
      case "div":
        walk(n.l);
        walk(n.r);
        if (containsVar(n.r, x)) rootsOfDenominator(n.r);
        return;
      case "pow": {
        walk(n.l); walk(n.r);
        // A negative constant exponent puts the base in a denominator.
        const p = safeConst(n.r);
        if (p !== null && p < 0 && containsVar(n.l, x)) rootsOfDenominator(n.l);
        return;
      }
      case "fn":
        walk(n.arg);
        if (n.name === "tan" || n.name === "sec") trigPoles(n.arg, true);
        if (n.name === "cot" || n.name === "csc") trigPoles(n.arg, false);
        return;
      default:
        return;
    }
  };

  walk(e);
  return found;
}

/** Adaptive Simpson quadrature of f over [a, b]. */
function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol = 1e-10, depth = 50): number {
  const simpson = (lo: number, hi: number, flo: number, fmid: number, fhi: number) =>
    ((hi - lo) / 6) * (flo + 4 * fmid + fhi);
  function rec(lo: number, hi: number, flo: number, fmid: number, fhi: number, whole: number, d: number): number {
    const mid = (lo + hi) / 2;
    const lmid = (lo + mid) / 2, rmid = (mid + hi) / 2;
    const flm = f(lmid), frm = f(rmid);
    // NON-FINITE SAMPLES MUST ABORT, NOT SUBDIVIDE.
    //
    // The convergence test below is `|left + right − whole| < 15·tol`, and any
    // comparison against NaN is FALSE — so a single NaN sample defeated the
    // short-circuit and drove the full binary recursion to depth 50, roughly
    // 2^51 evaluations. `integrate("ln(x)", -1, 2)` reached this by way of the
    // symbolic path returning NaN at an endpoint and falling through, and it
    // froze the pane unrecoverably: a synchronous loop cannot be interrupted,
    // so even the test runner's own timeout could not stop it.
    if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;
    const left = simpson(lo, mid, flo, flm, fmid);
    const right = simpson(mid, hi, fmid, frm, fhi);
    if (d <= 0 || Math.abs(left + right - whole) < 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(lo, mid, flo, flm, fmid, left, d - 1) + rec(mid, hi, fmid, frm, fhi, right, d - 1);
  }
  const mid = (a + b) / 2;
  const fa = f(a), fm = f(mid), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fm) || !Number.isFinite(fb)) return NaN;
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), depth);
}

/**
 * A reason the reported value contradicts the sign of the integrand, or null.
 *
 * If f > 0 everywhere on the interval then the integral is > 0. That is a
 * theorem, with no tolerance in it, and it is the cheapest possible check on an
 * "exact" answer. It exists because the grid-aligned singularity scan let
 * integrate("1/((x-1)^2)", 0, 2) report -2 for a strictly positive integrand:
 * the number was not merely imprecise, its SIGN was impossible, and nothing
 * noticed. A structural fix for the pole is in undefinedPointIn; this is the
 * independent second line, on the principle that the two should not share a
 * failure mode.
 */
function signContradiction(e: Expr, x: string, a: number, b: number, value: number): string | null {
  if (!Number.isFinite(value) || value === 0) return null;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (!(hi > lo)) return null;
  // Sampled on two offset grids for the same reason as the scan above: one grid
  // can align with a zero of the integrand and miss the sign change.
  const N = 200;
  let sawPositive = false, sawNegative = false;
  for (const off of [0.5, 0.881966011250105]) {
    for (let i = 0; i < N; i++) {
      const t = lo + ((hi - lo) * (i + off)) / N;
      let v: number;
      try { v = evalAst(e, { [x]: t }); } catch { return null; }
      if (!Number.isFinite(v)) return null;
      if (v > 0) sawPositive = true;
      else if (v < 0) sawNegative = true;
      if (sawPositive && sawNegative) return null; // the integrand changes sign
    }
  }
  // `value` here is the antiderivative difference in the order the caller asked
  // for, so flip the expected sign when b < a.
  const orientation = b >= a ? 1 : -1;
  const signed = value * orientation;
  if (sawPositive && !sawNegative && signed < 0) {
    return (
      `Refused. The integrand is positive at every one of ${2 * N} sample points across ` +
      `[${fmtNum(lo)}, ${fmtNum(hi)}], so its integral cannot be negative — but the ` +
      `antiderivative's endpoint difference is ${fmtNum(value)}. That means the ` +
      `antiderivative is discontinuous inside the interval, which is a singularity of the ` +
      `integrand, and the integral is improper. No value is reported, because the one ` +
      `available is impossible.`
    );
  }
  if (sawNegative && !sawPositive && signed > 0) {
    return (
      `Refused. The integrand is negative at every one of ${2 * N} sample points across ` +
      `[${fmtNum(lo)}, ${fmtNum(hi)}], so its integral cannot be positive — but the ` +
      `antiderivative's endpoint difference is ${fmtNum(value)}. That means the ` +
      `antiderivative is discontinuous inside the interval, which is a singularity of the ` +
      `integrand, and the integral is improper. No value is reported, because the one ` +
      `available is impossible.`
    );
  }
  return null;
}

/**
 * Definite integral of `input` over [a, b] with respect to `variable`, by
 * adaptive Simpson quadrature. Numeric — reports an approximation, not a
 * closed-form antiderivative. Returns null if the input cannot be parsed.
 */
export function integrate(input: string, a: number, b: number, variable?: string): IntegralResult | null {
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");
  const others = vars.filter((v) => v !== x);
  if (others.length) return null; // cannot integrate with unresolved parameters

  // Prefer an EXACT symbolic antiderivative. The CAS integrator (Release 2:
  // substitution, by parts, partial fractions) is tried first and is
  // self-verifying — it differentiates every candidate back and discards any
  // that does not match, so a miss costs nothing but a fallback. The older
  // rule table below still runs when the CAS finds nothing.
  const F = symbolicIntegrate(simplify(e), x, derivative)?.F ?? symbolicAntideriv(simplify(e), x);
  if (F) {
    const Fs = simplify(F);
    try {
      const value = evalAst(Fs, { [x]: b }) - evalAst(Fs, { [x]: a });
      if (Number.isFinite(value)) {
        const caveats: string[] = [];
        const fs = format(Fs);
        // CANONICALISATION CAN WIDEN A DOMAIN. sqrt(x)^2 normalises to x, which
        // is defined for negative x where the original is not — so ∫sqrt(x)² over
        // [−1,1] would otherwise come back as a confident "exact 0" for an
        // integral that does not exist. Scan the ORIGINAL integrand across the
        // interval before calling any of this exact. Catches ln and division
        // poles for free, so it subsumes the old ln-only special case.
        const gap = undefinedPointIn(e, x, a, b);
        if (gap !== null) {
          // The integral does not exist over this interval. Saying so is not a
          // caveat on a number -- there is no number. Reporting one anyway is
          // how integrate("1/((x-1)^2)", 0, 2) came to return -2 as "exact
          // (symbolic)" with an empty caveat list, for a strictly positive
          // integrand whose integral diverges to +infinity. The formal
          // endpoint difference of the antiderivative is not the integral when
          // the antiderivative is discontinuous in between; the fundamental
          // theorem of calculus requires continuity, and this is exactly the
          // hypothesis that fails.
          const cause =
            gap.kind === "pole"
              ? `has a POLE — a division by zero, or a pole of tan/cot/sec/csc — at ${x} ≈ ${fmtNum(gap.at)}`
              : `is UNDEFINED at ${x} ≈ ${fmtNum(gap.at)} — for example a square root of a negative ` +
                `number, or a log of a non-positive number`;
          return {
            variable: x,
            value: NaN,
            method: "does not exist on this interval",
            antiderivative: fs,
            caveats: [
              `The integrand ${cause}, strictly inside [${fmtNum(a)}, ${fmtNum(b)}], so it is ` +
                `UNDEFINED somewhere the integral needs it. The fundamental theorem of calculus ` +
                `requires the integrand to be continuous across the whole interval, so the ` +
                `difference of the antiderivative at the endpoints is NOT the integral here. No ` +
                `value is reported, because there is none. Split the interval at that point and ` +
                `take limits if you want a principal value.`,
              `For reference, the antiderivative found was F(${x}) = ${fs}, and its formal endpoint ` +
                `difference is ${fmtNum(value)} — a number that does not answer the question asked.`,
            ],
          };
        }
        // An exact theorem as a backstop: an integrand that never changes sign
        // cannot integrate to the opposite sign. If a pole is ever missed again,
        // this catches the specific failure that reaches a document -- a
        // NEGATIVE area under a strictly positive curve.
        const signProblem = signContradiction(e, x, a, b, value);
        if (signProblem !== null) {
          return {
            variable: x,
            value: NaN,
            method: "does not exist on this interval",
            antiderivative: fs,
            caveats: [signProblem],
          };
        }
        if (/\bln\b/.test(fs) && a * b < 0) {
          caveats.push("The antiderivative has a singularity at 0, which lies inside the interval — this is the formal value; the integral may be improper.");
        }
        return { variable: x, value, method: "exact (symbolic)", antiderivative: fs, caveats };
      }
    } catch {
      /* fall through to numeric */
    }
  }

  // THE SAME CHECK BEFORE THE NUMERIC PATH, NOT ONLY BEFORE THE EXACT ONE.
  //
  // Guarding just the symbolic branch left the same wrong number reachable by
  // another road. `integrate("1/(x-0.5)", 0, 3)` finds no antiderivative rule,
  // falls through to adaptive Simpson, and Simpson happily straddles the pole at
  // 0.5 without ever sampling it: it returned **5.0355** as a confident
  // "adaptive Simpson" result for an integral that diverges. Its stock caveat —
  // "a singularity inside the interval can make the result unreliable" — is a
  // hedge, not a refusal, and it appears on every numeric integral so it carries
  // no information about this one.
  //
  // Two paths sharing one wrong answer is the shape of this bug, so they now
  // share the guard.
  const numericGap = undefinedPointIn(e, x, a, b);
  if (numericGap !== null) {
    const cause =
      numericGap.kind === "pole"
        ? `has a POLE — a division by zero, or a pole of tan/cot/sec/csc — at ${x} ≈ ${fmtNum(numericGap.at)}`
        : `is UNDEFINED at ${x} ≈ ${fmtNum(numericGap.at)}`;
    return {
      variable: x,
      value: NaN,
      method: "does not exist on this interval",
      caveats: [
        `The integrand ${cause}, strictly inside [${fmtNum(a)}, ${fmtNum(b)}]. Quadrature can step ` +
          `straight over a pole without sampling it and return a plausible finite number, so no ` +
          `value is reported here. This integral is improper: split the interval at that point and ` +
          `take limits if you want a principal value.`,
      ],
    };
  }

  const f = (xv: number) => evalAst(e, { [x]: xv });
  const value = adaptiveSimpson(f, a, b);
  if (!Number.isFinite(value)) {
    // The integrand is undefined somewhere in the interval. Say so, rather than
    // handing back a NaN dressed as a result.
    const gap = undefinedPointIn(e, x, a, b);
    return {
      variable: x,
      value: NaN,
      method: "does not exist on this interval",
      caveats: [
        `The integrand is undefined${gap === null ? "" : ` at ${x} ≈ ${fmtNum(gap.at)}`} inside [${fmtNum(a)}, ${fmtNum(b)}] ` +
        `— for example a square root of a negative number, a log of a non-positive number, or a division by zero. ` +
        `No value is reported, because there is none to report over this interval.`,
      ],
    };
  }
  const caveats = [
    "Numeric definite integral (adaptive Simpson) — an approximation, because no closed-form antiderivative rule applied here.",
    "A singularity or discontinuity of the integrand inside the interval can make the result unreliable.",
  ];
  return { variable: x, value, method: "adaptive Simpson", caveats };
}
