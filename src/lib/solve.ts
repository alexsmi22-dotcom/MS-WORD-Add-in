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
      // Implicit multiplication like "2x" is handled by the tokenizer only for a
      // number immediately followed by an identifier (see number branch).
      return { t: "var", name };
    }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      const n: Expr = { t: "num", v: parseFloat(num[0]) };
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
    case "log": return { t: "div", l: N(1), r: { t: "mul", l: u, r: N(Math.LN10) } };
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
      if (isNum(l, 0)) return N(0);
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

function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
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

/** Trims trailing near-zero leading coefficients and returns the true degree. */
function trimPoly(c: number[]): number[] {
  const out = c.slice();
  while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-12) out.pop();
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
      if (Math.abs(disc) < 1e-12) return [{ display: fmtNum(r1), re: r1, im: 0, exact: true }];
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
  const push = (x: number) => {
    if (!Number.isFinite(x)) return;
    if (roots.some((r) => Math.abs(r.re - x) < 1e-6)) return;
    roots.push({ display: fmtNum(x), re: x, im: 0, exact: false });
  };
  const h = (hi - lo) / steps;
  let prevX = lo;
  let prevY = f(lo);
  if (Math.abs(prevY) < 1e-10) push(lo);
  for (let k = 1; k <= steps; k++) {
    const cx = lo + k * h;
    const cy = f(cx);
    if (Number.isFinite(prevY) && Number.isFinite(cy) && prevY * cy < 0) {
      // Bisection on [prevX, cx].
      let a = prevX, b = cx, fa = prevY;
      for (let it = 0; it < 80; it++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (Math.abs(fm) < 1e-13 || (b - a) / 2 < 1e-12) { push(m); break; }
        if (fa * fm < 0) b = m;
        else { a = m; fa = fm; }
        if (it === 79) push((a + b) / 2);
      }
    } else if (Math.abs(cy) < 1e-10) {
      push(cx);
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

  // Transcendental: numeric root-finding.
  steps.push(`Not a polynomial in ${x}; solving numerically for real roots in [−${range}, ${range}].`);
  const roots = numericRealRoots((xv) => {
    try { return evalAst(f, { [x]: xv }); } catch { return NaN; }
  }, -range, range);
  caveats.push(`Numeric solution: only real roots this method could bracket in [−${range}, ${range}] are reported; it can miss roots that are complex, tangential, or outside the range.`);
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
  return { variable: x, expression: format(simplify(e)), derivative: format(d), caveats };
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

/** Adaptive Simpson quadrature of f over [a, b]. */
function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol = 1e-10, depth = 50): number {
  const simpson = (lo: number, hi: number, flo: number, fmid: number, fhi: number) =>
    ((hi - lo) / 6) * (flo + 4 * fmid + fhi);
  function rec(lo: number, hi: number, flo: number, fmid: number, fhi: number, whole: number, d: number): number {
    const mid = (lo + hi) / 2;
    const lmid = (lo + mid) / 2, rmid = (mid + hi) / 2;
    const flm = f(lmid), frm = f(rmid);
    const left = simpson(lo, mid, flo, flm, fmid);
    const right = simpson(mid, hi, fmid, frm, fhi);
    if (d <= 0 || Math.abs(left + right - whole) < 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(lo, mid, flo, flm, fmid, left, d - 1) + rec(mid, hi, fmid, frm, fhi, right, d - 1);
  }
  const mid = (a + b) / 2;
  const fa = f(a), fm = f(mid), fb = f(b);
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), depth);
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

  // Prefer an EXACT symbolic antiderivative; fall back to numeric only if none.
  const F = symbolicAntideriv(simplify(e), x);
  if (F) {
    const Fs = simplify(F);
    try {
      const value = evalAst(Fs, { [x]: b }) - evalAst(Fs, { [x]: a });
      if (Number.isFinite(value)) {
        const caveats: string[] = [];
        const fs = format(Fs);
        if (/\bln\b/.test(fs) && a * b < 0)
          caveats.push("The antiderivative has a singularity at 0, which lies inside the interval — this is the formal value; the integral may be improper.");
        return { variable: x, value, method: "exact (symbolic)", antiderivative: fs, caveats };
      }
    } catch {
      /* fall through to numeric */
    }
  }

  const f = (xv: number) => evalAst(e, { [x]: xv });
  const value = adaptiveSimpson(f, a, b);
  const caveats = [
    "Numeric definite integral (adaptive Simpson) — an approximation, because no closed-form antiderivative rule applied here.",
    "A singularity or discontinuity of the integrand inside the interval can make the result unreliable.",
  ];
  return { variable: x, value, method: "adaptive Simpson", caveats };
}
