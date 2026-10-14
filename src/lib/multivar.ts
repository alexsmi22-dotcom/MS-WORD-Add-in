/**
 * Multivariable calculus — gradient, Hessian, Jacobian, directional
 * derivative, critical points, Lagrange multipliers, iterated integrals,
 * divergence, curl, potentials and line integrals of gradient fields.
 *
 * WHY THIS EXISTS. Single-variable calculus here is deep; the moment a
 * problem had two variables Solve stopped. Every piece below stands on the
 * one-variable engines — `derivative` is already per-variable, so partials
 * are free; `symbolicIntegrate` does one variable at a time, so an iterated
 * integral is a sequence of them with the bounds substituted exactly.
 *
 * Verbs (equation kind, prefix, no `=` except in a constraint):
 *   gradient f [at (p)] [in x, y]        hessian f [at (p)]
 *   jacobian (f1, f2, …) [in u, v]       directional derivative f at (p) in direction (v)
 *   critical points f                    lagrange f subject to g = c
 *   double integral f over y from c to d, x from a to b   (innermost first)
 *   triple integral f over z from …, y from …, x from …
 *   divergence (P, Q, R)   curl (P, Q, R)   potential (P, Q)   line integral (P, Q) from (a, b) to (c, d)
 *
 * EVERY RESULT IS CROSS-CHECKED by a route that shares no code with the
 * computation: partials against central differences, a critical point by
 * substitution into ∇f, a Lagrange candidate by substitution into ∇f = λ∇g
 * and the constraint, an exact iterated integral against nested numerical
 * quadrature, a potential by taking its gradient back. What cannot be done
 * exactly is said: a critical-point system the eliminator cannot solve is
 * handed to the multi-start solver and reported as numeric and possibly
 * incomplete; a second-derivative test with D = 0 is "inconclusive", never
 * a guess; a constraint set whose boundedness is not established yields
 * candidates, not a declared maximum.
 */
import { Expr, parseExpr, format, evalAst, freeVars, derivative, solveEquation } from "./solve";
import { substituteVar, exprEqual, CasBail } from "./cas";
import { symbolicIntegrate } from "./casint";
import { solveSystem } from "./systems";
import { eigenSymmetric } from "./linalg";
import type { VerbResult } from "./algebraTools";
import { exactSimplify, hasVar, hasFoldableConstant } from "./exact";

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
/** exactSimplify, then ln(e) → 1 (e^x differentiates to ln(e)·e^x and the simplifier leaves ln(e) alone). */
const S = (e: Expr): Expr => {
  const a = exactSimplify(e);
  const b = foldLnE(a);
  return format(b) === format(a) ? a : exactSimplify(b);
};
function foldLnE(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg":
      return { t: "neg", e: foldLnE(e.e) };
    case "fn": {
      if ((e.name === "ln" || e.name === "log") && e.arg.t === "var" && e.arg.name === "e") return N(1);
      const arg = foldLnE(e.arg);
      if (e.name === "abs" && arg.t === "num") return N(Math.abs(arg.v));
      if (e.name === "abs" && arg.t === "neg" && arg.e.t === "num") return N(Math.abs(arg.e.v));
      if ((e.name === "ln" || e.name === "log") && arg.t === "num" && arg.v === 1) return N(0);
      return { t: "fn", name: e.name, arg };
    }
    case "pow": {
      const l = foldLnE(e.l);
      const r = foldLnE(e.r);
      if (r.t === "num" && Number.isInteger(r.v) && r.v >= 2 && l.t === "fn") {
        // sqrt(2)^3 → 2*sqrt(2); exp(a)^2 → exp(2a) — the simplifier leaves both alone, and
        // an exact cancellation at (√2/2, √2/2) then fails.
        if (l.name === "sqrt" && l.arg.t === "num" && Number.isInteger(l.arg.v) && l.arg.v >= 0 && l.arg.v < 1e6) {
          const k = r.v;
          const wholeV = Math.pow(l.arg.v, Math.floor(k / 2));
          const whole = N(wholeV);
          return k % 2 === 0 ? whole : wholeV === 1 ? l : { t: "mul", l: whole, r: l };
        }
        if (l.name === "exp") return FN("exp", { t: "mul", l: N(r.v), r: l.arg });
      }
      return { t: "pow", l, r };
    }
    default:
      return { t: e.t, l: foldLnE(e.l), r: foldLnE(e.r) } as Expr;
  }
}

/** True when the expression carries a decimal (a folded float, not an exact rational). */
function hasDecimal(e: Expr): boolean {
  switch (e.t) {
    case "num":
      return !Number.isInteger(e.v);
    case "var":
      return false;
    case "neg":
      return hasDecimal(e.e);
    case "fn":
      return hasDecimal(e.arg);
    default:
      return hasDecimal(e.l) || hasDecimal(e.r);
  }
}

const GREEK = new Set(["pi", "theta", "phi", "psi", "rho", "tau", "eta", "chi", "mu", "nu", "xi", "alpha", "beta", "gamma", "delta", "omega", "sigma", "lambda", "lam", "kappa", "zeta", "iota", "epsilon", "eps", "upsilon"]);
/** "grad school applications": a multi-letter name that is not Greek is prose, not a variable. */
function looksLikeProse(vars: string[]): boolean {
  return vars.some((v) => v.length >= 3 && !GREEK.has(v.toLowerCase()) && !/^[a-zA-Z](?:_\w+|\d+)$/.test(v));
}
const COORD_LETTERS = new Set("xyzuvw".split(""));
/** Letters that are not coordinates, in an expression that HAS coordinates, are parameters. */
function parameterLetters(vars: string[]): string[] {
  return vars.some((v) => COORD_LETTERS.has(v)) ? vars.filter((v) => !COORD_LETTERS.has(v) && !GREEK.has(v.toLowerCase()) && v !== "e") : [];
}
/** A numeric stand-in for each parameter, for the finiteness and quadrature checks. */
function paramEnvFor(names: string[]): Record<string, number> {
  const env: Record<string, number> = {};
  names.forEach((v, i) => (env[v] = 0.73 + 0.64 * i));
  return env;
}
/** "f(x, y) = " before an expression is a label, not an equation. */
function stripFnLabel(body: string): string {
  return body.replace(/^\s*[a-zA-Z]\w?\s*\([^()=]*\)\s*=\s*/, "");
}

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
  const p = parts.length ? parts.reduce((a, b) => MUL(a, b)) : N(1);
  return neg ? NEG(p) : p;
}
function add(...fs: Expr[]): Expr {
  const parts = fs.filter((f) => !isNum(f, 0));
  if (!parts.length) return N(0);
  return parts.reduce((a, f) => (f.t === "neg" ? SUB(a, f.e) : ADD(a, f)));
}

/** Variables of an expression set, alphabetical, constants excluded. */
function varsOf(es: Expr[]): string[] {
  const set = new Set<string>();
  for (const e of es) for (const v of freeVars(e)) set.add(v);
  return [...set].sort();
}

/** Top-level comma split, honouring brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** "(a, b, c)" → the three parsed expressions; null if not a tuple. */
function parseTuple(s: string): Expr[] | null {
  const t = s.trim();
  const inner = /^\((.*)\)$/s.exec(t);
  const body = inner ? inner[1] : t;
  const parts = splitTop(body);
  if (parts.length < 1) return null;
  try {
    return parts.map((p) => parseExpr(p));
  } catch {
    return null;
  }
}

/** A constant's value, or null. */
function constValue(e: Expr): number | null {
  if (freeVars(e).length) return null;
  try {
    const v = evalAst(e, {});
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Substitutes a point, exactly, then simplifies. */
function atPoint(e: Expr, vars: string[], p: Expr[]): Expr {
  let r = e;
  vars.forEach((v, i) => {
    r = substituteVar(r, v, p[i]);
  });
  return S(r);
}

/** "x, y" after "in", or null. Also strips it from the body. */
function takeVarList(body: string): { body: string; vars: string[] | null } {
  const m = /\s+(?:in|with\s+respect\s+to|wrt)\s+([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)\s*$/i.exec(body);
  if (!m) return { body, vars: null };
  return { body: body.slice(0, m.index), vars: m[1].split(/\s*,\s*/) };
}
/** " at (1, 2)" suffix, or null. */
function takePoint(body: string): { body: string; point: string | null } {
  const m = /\s+at\s*(\(.*\))\s*$/i.exec(body);
  if (!m) return { body, point: null };
  return { body: body.slice(0, m.index), point: m[1] };
}

const refuse = (title: string, why: string): VerbResult => ({ title, lines: [], caveats: [why] });

function parseF(src: string, title: string): { f: Expr } | VerbResult | null {
  let f: Expr;
  try {
    f = parseExpr(src);
  } catch (err) {
    return refuse(title, `Couldn't read ${src}: ${(err as Error).message}`);
  }
  const fused = fusedName(freeVars(f));
  if (!fused && looksLikeProse(freeVars(f))) return null; // not this verb: "grad school applications"
  if (fused) {
    return refuse(
      title,
      `${fused} was read as ONE variable named ${fused}. Letters run together are a single name in this grammar; for a product write ${fused.split("").join("*")} (or ${fused.split("").join(" ")} with spaces).`,
    );
  }
  return { f };
}

/**
 * A multi-letter variable whose every letter is ALSO a variable of the
 * expression — 3xy beside x³ and y³ — is almost certainly a product typed
 * without spaces, not a variable called xy. Reported, never silently split:
 * "theta" and "lam" are real names and never match (their letters aren't
 * all variables too).
 */
function fusedName(vars: string[]): string | null {
  const single = new Set(vars.filter((v) => v.length === 1));
  const COORD = new Set("xyzuvwrst".split(""));
  for (const v of vars) {
    if (v.length < 2 || v.length > 4 || !/^[a-z]+$/i.test(v) || GREEK.has(v.toLowerCase())) continue;
    const letters = [...v.toLowerCase()];
    // every letter is itself a variable here (3xy beside x³, y³) …
    if (letters.every((ch) => single.has(ch))) return v;
    // … or every letter is a coordinate letter (2xy on its own, "xyz")
    if (letters.every((ch) => COORD.has(ch))) return v;
  }
  return null;
}

/** Non-finite anywhere at the point: f itself, or a component (0/0, ln(0), sqrt(−1), 1/0). */
function undefinedAt(exprs: Expr[], vars: string[], p: Expr[], extra: Record<string, number> = {}): string | null {
  const num = (c: Expr): number | null => {
    try {
      const v = evalAst(c, { pi: Math.PI, e: Math.E, ...extra });
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  if (p.some((c) => num(c) === null)) return "a coordinate of the point is not a finite number";
  const pn = p.map((c) => N(num(c)!));
  for (const e of exprs) {
    const v = evalAt(e, vars, pn, extra);
    if (!Number.isFinite(v)) return `${format(e)} is not finite there (division by zero, log of a non-positive number, an even root of a negative number, or a corner such as |x| at 0)`;
  }
  return null;
}

/** Central-difference check of a partial derivative at random-ish points. */
function partialAgrees(f: Expr, vars: string[], v: string, df: Expr): boolean {
  const pts = [
    [0.37, 0.81, 0.29],
    [-0.73, 0.44, 1.21],
    [1.13, -0.58, 0.67],
  ];
  for (const p of pts) {
    const env: Record<string, number> = {};
    vars.forEach((x, i) => (env[x] = p[i % 3]));
    const h = 1e-5;
    let a: number;
    let b: number;
    let d: number;
    try {
      a = evalAst(f, { ...env, [v]: env[v] + h });
      b = evalAst(f, { ...env, [v]: env[v] - h });
      d = evalAst(df, env);
    } catch {
      continue;
    }
    if (![a, b, d].every(Number.isFinite)) continue;
    const fd = (a - b) / (2 * h);
    if (Math.abs(fd - d) > 1e-5 * Math.max(1, Math.abs(d))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Gradient, Hessian, Jacobian, directional derivative
// ---------------------------------------------------------------------------

function gradient(f: Expr, vars: string[]): Expr[] {
  return vars.map((v) => S(derivative(f, v)));
}

function tupleText(es: Expr[]): string {
  return `(${es.map(format).join(", ")})`;
}

function tryGradient(input: string): VerbResult | null {
  const m = /^\s*(?:gradient|grad|nabla|del)\s+(?:of\s+)?(.+)$/i.exec(input);
  if (!m || /^\s*(?:gradient|grad)\s+(?:descent|field|school|student|boost)/i.test(input)) return null;
  let body = m[1].trim();
  const pt = takePoint(body);
  body = pt.body;
  const vl = takeVarList(body);
  body = vl.body;
  body = stripFnLabel(body);
  const title = `gradient of ${body.trim()}`;
  if (body.includes("=")) return null;
  const pf = parseF(body, title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  const f = pf.f;
  const vars = vl.vars ?? varsOf([f]);
  if (!vars.length) return refuse(title, "The expression has no variables to differentiate by.");
  const g = gradient(f, vars);
  for (let i = 0; i < vars.length; i++) {
    if (!partialAgrees(f, vars, vars[i], g[i])) return refuse(title, `∂f/∂${vars[i]} did not agree with a finite-difference check — withheld rather than shown wrong.`);
  }
  const lines: VerbResult["lines"] = [];
  lines.push({ text: `∇f = ${tupleText(g)}   (components in the order ${vars.join(", ")})` });
  vars.forEach((v, i) => lines.push({ text: `f_${v} = ${format(g[i])}`, math: true }));
  const caveats = ["Verified: every partial agrees with a central-difference check at three points."];
  if (pt.point) {
    const p = parseTuple(pt.point);
    if (!p || p.length !== vars.length) return refuse(title, `The point must have ${vars.length} coordinates (${vars.join(", ")}).`);
    const bad = undefinedAt([f, ...g], vars, p, paramEnvFor(varsOf(p).filter((v) => v !== "pi" && v !== "e")));
    if (bad) return refuse(title, `∇f is not defined at ${pt.point}: ${bad}.`);
    const vals = g.map((c) => atPoint(c, vars, p));
    lines.push({ text: `∇f${pt.point} = ${tupleText(vals)}` });
    const mag = S(FN("sqrt", add(...vals.map((c) => POW(c, N(2))))));
    lines.push({ text: `|∇f| = ${format(mag)}`, math: true });
  }
  return { title, lines, caveats };
}

/** Symbolic determinant by cofactor expansion, n ≤ 4. */
function det(M: Expr[][]): Expr {
  const n = M.length;
  if (n === 1) return M[0][0];
  if (n === 2) return S(SUB(mul(M[0][0], M[1][1]), mul(M[0][1], M[1][0])));
  const parts: Expr[] = [];
  for (let j = 0; j < n; j++) {
    const minor = M.slice(1).map((row) => row.filter((_, k) => k !== j));
    const term = mul(M[0][j], det(minor));
    parts.push(j % 2 === 0 ? term : NEG(term));
  }
  return S(add(...parts));
}

function matrixText(M: Expr[][]): string {
  return `[${M.map((row) => `[${row.map(format).join(", ")}]`).join(", ")}]`;
}

function tryHessian(input: string): VerbResult | null {
  const m = /^\s*hessian\s+(?:matrix\s+)?(?:of\s+)?(.+)$/i.exec(input);
  if (!m) return null;
  let body = m[1].trim();
  const pt = takePoint(body);
  body = pt.body;
  const vl = takeVarList(body);
  body = vl.body;
  body = stripFnLabel(body);
  const title = `Hessian of ${body.trim()}`;
  if (body.includes("=")) return null;
  const pf = parseF(body, title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  const f = pf.f;
  const vars = vl.vars ?? varsOf([f]);
  if (!vars.length) return refuse(title, "The expression has no variables.");
  if (vars.length > 4) return refuse(title, "Up to four variables here.");
  const g = gradient(f, vars);
  const H: Expr[][] = vars.map((_, i) => vars.map((v) => S(derivative(g[i], v))));
  // Symmetry: a mixed partial that does not match its twin is a bug, not a result.
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      let eq: boolean | null = null;
      try {
        eq = exprEqual(H[i][j], H[j][i]);
      } catch (err) {
        if (!(err instanceof CasBail)) throw err;
      }
      if (eq === false || (eq === null && !partialAgrees(g[i], vars, vars[j], H[j][i]))) {
        return refuse(title, `f_${vars[i]}${vars[j]} and f_${vars[j]}${vars[i]} did not agree — withheld.`);
      }
      if (!partialAgrees(g[i], vars, vars[j], H[i][j])) return refuse(title, `f_${vars[i]}${vars[j]} failed a finite-difference check — withheld.`);
    }
    if (!partialAgrees(g[i], vars, vars[i], H[i][i])) return refuse(title, `f_${vars[i]}${vars[i]} failed a finite-difference check — withheld.`);
  }
  const lines: VerbResult["lines"] = [{ text: `H = ${matrixText(H)}   (rows and columns in the order ${vars.join(", ")})` }];
  vars.forEach((vi, i) => vars.forEach((vj, j) => {
    if (j >= i) lines.push({ text: `f_${vi}${vj} = ${format(H[i][j])}`, math: true });
  }));
  const D = det(H);
  lines.push({ text: `det H = ${format(D)}`, math: true });
  if (pt.point) {
    const p = parseTuple(pt.point);
    if (!p || p.length !== vars.length) return refuse(title, `The point must have ${vars.length} coordinates (${vars.join(", ")}).`);
    const bad = undefinedAt([f, ...g, ...H.flat()], vars, p, paramEnvFor(varsOf(p).filter((v) => v !== "pi" && v !== "e")));
    if (bad) return refuse(title, `H is not defined at ${pt.point}: ${bad}.`);
    const Hp = H.map((row) => row.map((c) => atPoint(c, vars, p)));
    lines.push({ text: `H${pt.point} = ${matrixText(Hp)}` });
    lines.push({ text: `det H${pt.point} = ${format(det(Hp))}`, math: true });
  }
  return { title, lines, caveats: ["Verified: symmetric (f_xy = f_yx), and every second partial agrees with a finite-difference check."] };
}

function tryJacobian(input: string): VerbResult | null {
  const m = /^\s*jacobian\s+(?:matrix\s+)?(?:of\s+)?(.+)$/i.exec(input);
  if (!m) return null;
  let body = m[1].trim();
  const vl = takeVarList(body);
  body = vl.body;
  const title = `Jacobian of ${body.trim()}`;
  const fs = parseTuple(body);
  if (!fs) return refuse(title, "Give the component functions as a tuple: jacobian (r*cos(theta), r*sin(theta)).");
  const vars = vl.vars ?? varsOf(fs);
  if (!vars.length) return refuse(title, "The functions have no variables.");
  const J: Expr[][] = fs.map((fi) => vars.map((v) => S(derivative(fi, v))));
  for (let i = 0; i < fs.length; i++) for (let j = 0; j < vars.length; j++) {
    if (!partialAgrees(fs[i], vars, vars[j], J[i][j])) return refuse(title, `∂f${i + 1}/∂${vars[j]} failed a finite-difference check — withheld.`);
  }
  const lines: VerbResult["lines"] = [{ text: `J = ${matrixText(J)}   (row i = ∂f_i; columns in the order ${vars.join(", ")})` }];
  fs.forEach((_, i) => vars.forEach((v, j) => lines.push({ text: `∂f${i + 1}/∂${v} = ${format(J[i][j])}`, math: true })));
  if (fs.length === vars.length) lines.push({ text: `det J = ${format(det(J))}`, math: true });
  else lines.push({ text: `J is ${fs.length} × ${vars.length} — not square, so no determinant.` });
  return { title, lines, caveats: ["Verified: every entry agrees with a finite-difference check."] };
}

function tryDirectional(input: string): VerbResult | null {
  const m = /^\s*directional\s+derivative\s+(?:of\s+)?(.+?)\s+at\s*(\(.+?\))\s+(?:in\s+(?:the\s+)?direction(?:\s+of)?|along|toward|towards)\s*(\(.+?\))\s*$/i.exec(input);
  if (!m) return null;
  const title = `directional derivative of ${m[1].trim()}`;
  const pf = parseF(m[1], title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  const f = pf.f;
  const vars = varsOf([f]);
  const p = parseTuple(m[2]);
  const d = parseTuple(m[3]);
  if (!p || !d || p.length !== vars.length || d.length !== vars.length) {
    return refuse(title, `The point and the direction need ${vars.length} coordinates each (${vars.join(", ")}).`);
  }
  const g = gradient(f, vars);
  const bad = undefinedAt([f, ...g], vars, p, paramEnvFor(varsOf(p).filter((v) => v !== "pi" && v !== "e")));
  if (bad) return refuse(title, `∇f is not defined at ${m[2]}: ${bad}.`);
  const gp = g.map((c) => atPoint(c, vars, p));
  const symbolicDir = d.some((c) => freeVars(c).length > 0);
  if (!symbolicDir && d.some((c) => constValue(c) === null)) return refuse(title, "Every direction component must be a finite number.");
  const norm = S(FN("sqrt", add(...d.map((c) => POW(c, N(2))))));
  const normV = constValue(norm);
  if (!symbolicDir && normV === null) return refuse(title, "The direction's length overflowed — scale the direction down (only its direction matters).");
  if (normV === 0 || isNum(norm, 0)) return refuse(title, "The direction vector is zero.");
  const unit = d.map((c) => S(DIV(c, norm)));
  const dot = S(add(...gp.map((c, i) => mul(c, unit[i]))));
  const lines: VerbResult["lines"] = [
    { text: `D_u f${m[2]} = ${format(dot)}`, math: true },
    { text: `∇f${m[2]} = ${tupleText(gp)}; unit direction u = ${tupleText(unit)} (|v| = ${format(norm)})` },
  ];
  const numeric = constValue(dot);
  if (numeric !== null && !/^-?\d+(\.\d+)?$/.test(format(dot))) lines.push({ text: `≈ ${numeric.toPrecision(6)}` });
  return { title, lines, caveats: ["Computed as ∇f(p)·v/|v|; the gradient is verified against a finite-difference check."] };
}

// ---------------------------------------------------------------------------
// Critical points
// ---------------------------------------------------------------------------

interface Point {
  coords: Expr[];
  exact: boolean;
}

/** Exact 2-variable elimination: one gradient component linear in a variable. */
type Elimination = { points: Point[]; complete: boolean };

function eliminate2(g: Expr[], vars: string[]): Elimination | null {
  if (vars.length !== 2) return null;
  let complete = true;
  // A component in ONE variable (4x³ from x⁴ + y⁴) is solved on its own, each
  // root substituted into the other component, which must then be univariate.
  for (const i of [0, 1]) {
    const fv = freeVars(g[i]);
    if (fv.length !== 1) continue;
    const v = fv[0];
    const other = vars.find((x) => x !== v)!;
    const rl = realRoots(g[i], v);
    if (!rl) continue;
    if (!rl.complete && !rl.roots.length) return null; // "found none in the search range" is not "none"
    complete = complete && rl.complete;
    const pts: Point[] = [];
    for (const root of rl.roots) {
      const rest = S(substituteVar(g[1 - i], v, root.val));
      if (freeVars(rest).includes(v)) return null;
      if (!freeVars(rest).length) {
        if (isNum(rest, 0)) return null; // a whole curve of critical points
        continue;
      }
      const inner = realRoots(rest, other);
      if (!inner) return null;
      if (!inner.complete && !inner.roots.length) return null;
      complete = complete && inner.complete;
      for (const r2 of inner.roots) {
        const coords = vars[0] === v ? [root.val, r2.val] : [r2.val, root.val];
        pts.push({ coords, exact: root.exact && r2.exact });
      }
    }
    return { points: pts, complete };
  }
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      const v = vars[j];
      const other = vars[1 - j];
      const a = S(derivative(g[i], v));
      if (freeVars(a).includes(v) || isNum(a, 0)) continue; // not linear in v, or absent
      if (freeVars(a).length) continue; // coefficient must be constant for a clean solve
      const c = S(substituteVar(g[i], v, N(0)));
      const vExpr = S(NEG(DIV(c, a))); // v = −c/a, in terms of `other`
      const uni = S(substituteVar(g[1 - i], v, vExpr));
      if (freeVars(uni).includes(v)) continue;
      if (!freeVars(uni).length) {
        return isNum(uni, 0) ? null : { points: [], complete: true }; // identically zero → a curve of critical points (unsupported); nonzero → none
      }
      const rl = realRoots(uni, other);
      if (!rl) return null;
      if (!rl.complete && !rl.roots.length) return null;
      const pts: Point[] = [];
      for (const { val, exact } of rl.roots) {
        const vv = S(substituteVar(vExpr, other, val));
        const coords = j === 0 ? [vv, val] : [val, vv];
        pts.push({ coords, exact });
      }
      return { points: pts, complete: complete && rl.complete };
    }
  }
  return null;
}

/** Real roots of a univariate expression, exact where the solver says so. */
/** True when `e` is a polynomial in `v`: no function of v, no non-integer power of v, no v in a denominator. */
function isPolyIn(e: Expr, v: string): boolean {
  switch (e.t) {
    case "num":
    case "var":
      return true;
    case "neg":
      return isPolyIn(e.e, v);
    case "add":
    case "sub":
    case "mul":
      return isPolyIn(e.l, v) && isPolyIn(e.r, v);
    case "div":
      return isPolyIn(e.l, v) && !freeVars(e.r).includes(v);
    case "pow":
      return isPolyIn(e.l, v) && e.r.t === "num" && Number.isInteger(e.r.v) && e.r.v >= 0;
    case "fn":
      return !freeVars(e.arg).includes(v);
  }
}

type RootList = { roots: { val: Expr; exact: boolean }[]; complete: boolean };

/**
 * Real roots of a univariate expression. `complete` is true only for a
 * polynomial (every root is found, counting the complex ones we drop);
 * cos(x) = 0 has infinitely many roots and the solver returns those in its
 * search range, which the caller must say.
 */
/** The factors of a product (flattened through mul and neg), or [e]. */
function factorsOf(e: Expr): Expr[] {
  if (e.t === "mul") return [...factorsOf(e.l), ...factorsOf(e.r)];
  if (e.t === "neg") return factorsOf(e.e);
  return [e];
}

/**
 * Real roots of a univariate expression. A product is split into its
 * factors first — −2x·exp(−x²) = 0 is x = 0, which the transcendental
 * root scan once MISSED (reporting "no critical points"); exp(…) and
 * positive constants never vanish and are dropped.
 */
function realRoots(e: Expr, v: string): RootList | null {
  const factors = factorsOf(e).filter((fac) => freeVars(fac).includes(v));
  if (factors.length >= 2 || (factors.length === 1 && factorsOf(e).length > 1)) {
    const out: { val: Expr; exact: boolean }[] = [];
    let complete = true;
    for (const fac of factors) {
      if (fac.t === "fn" && fac.name === "exp") continue; // never zero
      const rl = realRootsOne(fac, v);
      if (!rl) return null;
      complete = complete && rl.complete;
      for (const r of rl.roots) if (!out.some((o) => exprEqual(o.val, r.val))) out.push(r);
    }
    return { roots: out, complete };
  }
  return realRootsOne(e, v);
}

function realRootsOne(e: Expr, v: string): RootList | null {
  if (e.t === "fn" && e.name === "exp") return { roots: [], complete: true };
  const r = solveEquation(`${format(e)} = 0`, v);
  if (!r || !r.roots) return null;
  const complete = isPolyIn(e, v) && !/numeric|unsolved|no reliable/i.test(r.method);
  const out: { val: Expr; exact: boolean }[] = [];
  // cos(x) = 0 has ~1,270 roots in the solver's range; snapping and
  // verifying each exactly once took 13 s. Keep the ones nearest the origin.
  const MAX_NONPOLY_ROOTS = 12;
  const roots = complete ? r.roots : [...r.roots].filter((x) => Math.abs(x.im) <= 1e-12).sort((a, b) => Math.abs(a.re) - Math.abs(b.re)).slice(0, MAX_NONPOLY_ROOTS);
  for (const root of roots) {
    if (Math.abs(root.im) > 1e-12) continue;
    let val: Expr;
    let exact = !!root.exact;
    try {
      val = parseExpr(root.display);
      if (freeVars(val).length) throw new Error("not a value");
    } catch {
      val = N(root.re);
      exact = false;
    }
    if (!exact) {
      // Durand–Kerner gives 1.0000000000 for the root 1, and a multiple root
      // only to a few digits; a closed form is accepted ONLY when substituting
      // it back makes the expression exactly 0 — the verification is the proof.
      const cand = snapExact(root.re, 1e-4);
      if (cand && isNum(S(substituteVar(e, v, cand)), 0)) {
        val = cand;
        exact = true;
      }
    }
    if (out.some((o) => exprEqual(o.val, val))) continue;
    out.push({ val, exact });
  }
  return { roots: out, complete };
}

/**
 * A numeric coordinate recognised as a simple closed form — a fraction with
 * a small denominator, or ±sqrt of one — so the multi-start solver's
 * 0.707106781 can be re-verified EXACTLY and shown as sqrt(2)/2. Null when
 * no such form fits to 1e-9.
 */
function snapExact(x: number, tol = 1e-9): Expr | null {
  if (!Number.isFinite(x)) return null;
  const frac = (p: number, q: number): Expr => {
    const mag = q === 1 ? N(Math.abs(p)) : DIV(N(Math.abs(p)), N(q));
    return S(p < 0 ? NEG(mag) : mag);
  };
  for (let q = 1; q <= 24; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < tol) return frac(p, q);
  }
  // p·π/q (q ≤ 12): the critical points of anything trigonometric.
  const xp = x / Math.PI;
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(xp * q);
    if (p !== 0 && Math.abs(p / q - xp) < tol) {
      const mag: Expr = q === 1 ? (Math.abs(p) === 1 ? V("pi") : mul(N(Math.abs(p)), V("pi"))) : DIV(Math.abs(p) === 1 ? V("pi") : mul(N(Math.abs(p)), V("pi")), N(q));
      return S(p < 0 ? NEG(mag) : mag);
    }
  }
  const x2 = x * x;
  for (let q = 1; q <= 24; q++) {
    const p = Math.round(x2 * q);
    if (p > 0 && Math.abs(p / q - x2) < tol) {
      const root = S(FN("sqrt", q === 1 ? N(p) : DIV(N(p), N(q))));
      return x < 0 ? S(NEG(root)) : root;
    }
  }
  return null;
}

type Verdict = "minimum" | "maximum" | "saddle" | "inconclusive";

/** e evaluated at the numeric point p (NaN when a coordinate is not numeric). */
function evalAt(e: Expr, vars: string[], p: Expr[], extra: Record<string, number> = {}): number {
  const env: Record<string, number> = { pi: Math.PI, e: Math.E, ...extra };
  vars.forEach((v, i) => {
    env[v] = constValue(p[i]) ?? NaN;
  });
  try {
    return evalAst(e, env);
  } catch {
    return NaN;
  }
}
const norm2 = (p: Expr[]): number => p.reduce((acc, c) => acc + (constValue(c) ?? 0) ** 2, 0);
const round9 = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(10)) : x);

/** The second-derivative test at a point. */
/**
 * The second-derivative test at a point. `exact` says the coordinates are
 * closed forms, so D is exact and only an exact 0 is degenerate; for a
 * floating-point root the coordinates carry the solver's localisation error
 * (~1e-5 at a degenerate root), which enters D as ~‖H‖²·1e-5 — a circle of
 * minima once came back as forty "saddle points" with D ≈ −1e-8, so a numeric
 * D is called zero below 1e-6 of the Hessian's scale squared.
 */
function classify(H: Expr[][], vars: string[], p: Expr[], exact = true): { verdict: Verdict; detail: string } {
  // At a floating-point root the Hessian entries are evaluated to decimals;
  // "D = sin(7.853981634)^4 − cos(7.853981634)^4" helps nobody.
  const Hp = H.map((row) => row.map((c) => (exact ? atPoint(c, vars, p) : N(round9(evalAt(c, vars, p))))));
  const hScale = Math.max(1, ...Hp.flat().map((c) => Math.abs(constValue(c) ?? 0)));
  const zeroTol = exact ? 1e-12 : 1e-6 * hScale * hScale;
  if (vars.length === 2) {
    const D = det(Hp);
    const Dv = constValue(D);
    const fxx = constValue(Hp[0][0]);
    if (Dv === null || fxx === null) return { verdict: "inconclusive", detail: "D could not be evaluated" };
    if (exact ? isNum(S(D), 0) : Math.abs(Dv) < zeroTol) return { verdict: "inconclusive", detail: `D = ${format(D)} ${exact ? "= 0" : "≈ 0 (within the numerical solver's precision)"}: the second-derivative test is inconclusive here` };
    if (Dv < 0) return { verdict: "saddle", detail: `D = ${format(D)} < 0` };
    if (fxx > 0) return { verdict: "minimum", detail: `D = ${format(D)} > 0 and f_${vars[0]}${vars[0]} = ${format(Hp[0][0])} > 0` };
    if (fxx < 0) return { verdict: "maximum", detail: `D = ${format(D)} > 0 and f_${vars[0]}${vars[0]} = ${format(Hp[0][0])} < 0` };
    return { verdict: "inconclusive", detail: "f_xx = 0 with D > 0 cannot happen; evaluation failed" };
  }
  const M = Hp.map((row) => row.map((c) => constValue(c) ?? NaN));
  if (M.flat().some((x) => !Number.isFinite(x))) return { verdict: "inconclusive", detail: "the Hessian could not be evaluated" };
  const eig = eigenSymmetric(M);
  if (!eig) return { verdict: "inconclusive", detail: "the Hessian is not symmetric numerically" };
  const vals = eig.values;
  const scale = Math.max(1, ...vals.map(Math.abs));
  if (vals.some((x) => Math.abs(x) < (exact ? 1e-9 : 1e-6) * scale)) return { verdict: "inconclusive", detail: `a Hessian eigenvalue is 0 (eigenvalues ${vals.map((x) => x.toPrecision(4)).join(", ")})` };
  if (vals.every((x) => x > 0)) return { verdict: "minimum", detail: `Hessian eigenvalues all positive (${vals.map((x) => x.toPrecision(4)).join(", ")})` };
  if (vals.every((x) => x < 0)) return { verdict: "maximum", detail: `Hessian eigenvalues all negative (${vals.map((x) => x.toPrecision(4)).join(", ")})` };
  return { verdict: "saddle", detail: `Hessian eigenvalues of both signs (${vals.map((x) => x.toPrecision(4)).join(", ")})` };
}

/** A numeric point snapped to closed forms when every coordinate snaps AND the exact check passes. */
function snapPoint(xs: number[], exactCheck: (coords: Expr[]) => boolean, tol = 1e-6): Point {
  const snapped = xs.map((x) => snapExact(x, tol));
  if (snapped.every((c): c is Expr => c !== null) && exactCheck(snapped)) return { coords: snapped, exact: true };
  return { coords: xs.map((x) => N(x)), exact: false };
}

/** ∇f(p) = 0 exactly: every component simplifies to the number 0. */
function gradientVanishesExactly(g: Expr[], vars: string[], p: Expr[]): boolean {
  return g.every((c) => isNum(atPoint(c, vars, p), 0));
}

/** ∇f(p) = 0, exactly where possible, else numerically. */
function gradientVanishes(g: Expr[], vars: string[], p: Expr[]): boolean {
  for (const c of g) {
    const v = atPoint(c, vars, p);
    const num = constValue(v);
    if (num === null) return false;
    if (Math.abs(num) > 1e-8) return false;
  }
  return true;
}

function tryCriticalPoints(input: string): VerbResult | null {
  const m = /^\s*(?:critical\s+points?|stationary\s+points?|extrema|local\s+extrema|classify\s+(?:the\s+)?critical\s+points?)\s+(?:of\s+)?(.+)$/i.exec(input);
  if (!m) return null;
  let body = m[1].trim();
  const vl = takeVarList(body);
  body = vl.body;
  body = stripFnLabel(body);
  const title = `critical points of ${body.trim()}`;
  if (body.includes("=")) return null;
  const pf = parseF(body, title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  const f = pf.f;
  const vars = vl.vars ?? varsOf([f]);
  const cpParams = vl.vars ? [] : parameterLetters(vars);
  if (cpParams.length) {
    return refuse(
      title,
      `${cpParams.join(", ")} ${cpParams.length === 1 ? "is" : "are"} not a coordinate letter (x, y, z, u, v, w) and would be solved for as an unknown. Give ${cpParams.length === 1 ? "it" : "them"} a value, or name the variables: "critical points … in x, y".`,
    );
  }
  if (vars.length < 2) return refuse(title, "Critical points of a function of ONE variable are the equation kind's job: solve f'(x) = 0.");
  if (vars.length > 4) return refuse(title, "Up to four variables here.");
  const g = gradient(f, vars);
  const H: Expr[][] = vars.map((_, i) => vars.map((v) => S(derivative(g[i], v))));
  const caveats: string[] = [];
  // A coordinate hyperplane on which EVERY component vanishes identically
  // (x = 0 for x²y²) is a whole curve of critical points; listing a sample of
  // it as "the critical points" would be wrong, so the verb refuses by name.
  for (const v of vars) {
    if (g.every((c) => isNum(S(substituteVar(c, v, N(0))), 0))) {
      return refuse(
        title,
        `∇f = ${tupleText(g)} vanishes identically on the whole hyperplane ${v} = 0, so the critical points are not isolated — a curve (or surface) of them, which this verb does not enumerate.`,
      );
    }
  }
  const elim = eliminate2(g, vars);
  let points: Point[] | null = elim ? elim.points : null;
  let numeric = false;
  let how = "by exact elimination (one gradient component solved for a variable, substituted into the other)";
  if (elim && !elim.complete) {
    how = "by elimination, with the roots of a NON-polynomial equation taken from the solver's search range";
    caveats.push(
      "NOT a complete list: a gradient component is not a polynomial (trigonometric, exponential or logarithmic), so its roots come from the equation solver's search range only — a periodic function has infinitely many critical points, repeating with its period.",
    );
  }
  if (points === null) {
    numeric = true;
    // The multi-start solver: numeric, labelled, possibly incomplete.
    const sys = solveSystem(g.map((c) => `${format(c)} = 0`), vars);
    if (sys && sys.kind === "infinite") {
      return refuse(
        title,
        `∇f = 0 is a linear system of rank below ${vars.length}: the critical points are not isolated but form the whole set ${(sys.general ?? []).join(", ")} — a line or plane of them (every point is degenerate, so the second-derivative test cannot classify any of them). This verb lists isolated points only.`,
      );
    }
    if (!sys || !sys.numeric || !sys.numeric.length) {
      if (sys && sys.kind === "none") return { title, lines: [{ text: "No critical points: ∇f = 0 has no solution." }], caveats: [] };
      return refuse(title, "∇f = 0 could not be solved here (neither by elimination nor numerically).");
    }
    if (sys.kind === "unique" && sys.exact) {
      points = [{ coords: vars.map((v) => parseExpr(sys.exact![v])), exact: true }];
      how = "by solving the linear system ∇f = 0 exactly";
    } else {
      points = sys.numeric
        .map((sol) => snapPoint(vars.map((v) => sol[v]), (coords) => gradientVanishesExactly(g, vars, coords), 1e-4))
        // nearest the origin first: for a periodic f the solver also lands on far copies
        .sort((a, b) => norm2(a.coords) - norm2(b.coords));
      how = "by the multi-start numerical solver";
      if (g.some((c) => /\b(?:sin|cos|tan)\(/.test(format(c)))) {
        caveats.push("The gradient is trigonometric, so the critical points repeat with the period in each variable: the list shows the copies the solver landed on, nearest the origin first, and is NOT complete.");
      }
      caveats.push("∇f = 0 was solved NUMERICALLY (no exact elimination applied); the list may be incomplete and each point is a floating-point root.");
      caveats.push(...sys.caveats);
    }
  }
  if (!points.length) return { title, lines: [{ text: "No critical points: ∇f = 0 has no real solution." }], caveats: [`Found ${how}.`] };
  points.sort((a, b) => norm2(a.coords) - norm2(b.coords)); // nearest the origin first, on every path
  // Dedupe and verify.
  const seen = new Set<string>();
  const lines: VerbResult["lines"] = [{ text: `∇f = ${tupleText(g)} = 0, solved ${how}:` }];
  let shown = 0;
  let degenerate = 0;
  let flat = 0;
  let overflow = 0;
  const MAX_POINTS = 24;
  for (const p of points) {
    const key = p.coords.map((c) => (constValue(c) ?? NaN).toFixed(9)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (!gradientVanishes(g, vars, p.coords)) continue; // a candidate that is not a root is not shown
    if (numeric && !p.exact) {
      // Far out under an exponential decay ∇f is merely TINY, not zero: the
      // solver's residual test passes while the whole Hessian is ~0 too. Not
      // a critical point — a flat region.
      const hMax = Math.max(...H.flat().map((c) => Math.abs(evalAt(c, vars, p.coords))));
      const gMax = Math.max(...g.map((c) => Math.abs(evalAt(c, vars, p.coords))));
      if (!(hMax > 1e-6) && !(gMax === 0)) {
        flat++;
        continue;
      }
    }
    const cls = classify(H, vars, p.coords, p.exact);
    if (numeric && !p.exact && cls.verdict === "inconclusive") {
      // det H = 0 at a floating-point root: Newton cannot localise it, and
      // it may be one sample of a CURVE of critical points — not shown.
      degenerate++;
      continue;
    }
    if (shown >= MAX_POINTS) {
      overflow++;
      continue;
    }
    const fv = atPoint(f, vars, p.coords);
    const fText = p.exact ? format(fv) : format(N(round9(evalAt(f, vars, p.coords))));
    lines.push({
      text: `${tupleText(p.coords)}${p.exact ? "" : " (numeric)"}: ${cls.verdict === "inconclusive" ? "INCONCLUSIVE" : cls.verdict === "saddle" ? "saddle point" : `local ${cls.verdict}`}, f = ${fText}   (${cls.detail})`,
    });
    shown++;
  }
  if (overflow) caveats.push(`${overflow} further critical point${overflow === 1 ? "" : "s"} not listed (the first ${MAX_POINTS} are shown).`);
  if (flat) {
    caveats.push(
      `${flat} numerical solution${flat === 1 ? "" : "s"} where ∇f is merely tiny (the function is flat there — far out under an exponential decay, say) ${flat === 1 ? "was" : "were"} discarded: not critical points.`,
    );
  }
  if (degenerate) {
    caveats.push(
      `${degenerate} numerical solution${degenerate === 1 ? "" : "s"} with det H = 0 ${degenerate === 1 ? "was" : "were"} dropped: Newton's method cannot localise a degenerate root, and such a point may be one sample of a CURVE of critical points rather than an isolated one.`,
    );
  }
  if (!shown) {
    return refuse(
      title,
      flat && !degenerate
        ? `The numerical solver found only points where ∇f is tiny but the function is flat (not critical points); the genuine critical points, if any, were not reached from its starting points.`
        : degenerate
        ? `The numerical solver found only degenerate solutions of ∇f = 0 (det H = 0 at each), which it cannot localise — they may lie on a curve of critical points. Nothing is shown rather than a sample of a continuum.`
        : "Every candidate failed the ∇f = 0 check — nothing shown.",
    );
  }
  caveats.unshift("Each point is verified by substituting it into ∇f; the second-derivative test (D in two variables, Hessian eigenvalues above) classifies it, and says INCONCLUSIVE when it cannot.");
  return { title, lines, caveats };
}

// ---------------------------------------------------------------------------
// Lagrange multipliers
// ---------------------------------------------------------------------------

/** g = c describes a bounded set when g is a sum of positive multiples of squares and c > 0. */
function constraintBounded(g: Expr, vars: string[], c: Expr): boolean {
  const cv = constValue(c);
  if (cv === null || cv <= 0) return false;
  return sumOfPositiveSquares(g, vars);
}

/** g = Σ aᵢvᵢ² with every aᵢ > 0 and nothing else: g = c is empty for c < 0, a point for c = 0, bounded for c > 0. */
function sumOfPositiveSquares(g: Expr, vars: string[]): boolean {
  // check g − Σ a_i v_i² ≡ 0 with a_i = ½ ∂²g/∂v_i².
  let rebuilt: Expr = N(0);
  for (const v of vars) {
    const a = S(DIV(derivative(derivative(g, v), v), N(2)));
    const av = constValue(a);
    if (av === null || av <= 0) return false;
    rebuilt = add(rebuilt, mul(a, POW(V(v), N(2))));
  }
  const diff = S(SUB(g, rebuilt));
  return isNum(diff, 0);
}

function tryLagrange(input: string): VerbResult | null {
  const m = /^\s*(?:lagrange(?:\s+multipliers?)?|maximi[sz]e|minimi[sz]e|optimi[sz]e|extremi[sz]e)\s+(?:of\s+)?(.+?)\s+(?:subject\s+to|s\.t\.|given|under|with\s+(?:the\s+)?constraint|on)\s+(.+)$/i.exec(input);
  if (!m) return null;
  const title = `Lagrange multipliers: ${m[1].trim()} subject to ${m[2].trim()}`;
  const con = m[2].split("=");
  if (con.length !== 2) return refuse(title, "The constraint must be an equation g(x, y) = c.");
  const pf = parseF(stripFnLabel(m[1]), title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  let g: Expr;
  let c: Expr;
  try {
    g = parseExpr(con[0]);
    c = parseExpr(con[1]);
  } catch (err) {
    return refuse(title, `Couldn't read the constraint: ${(err as Error).message}`);
  }
  const f = pf.f;
  const vars = varsOf([f, g, c]).filter((v) => v !== "lam" && v !== "lambda");
  if (looksLikeProse(vars)) return null;
  const params = parameterLetters(vars);
  if (params.length) {
    return refuse(
      title,
      `${params.join(", ")} ${params.length === 1 ? "is" : "are"} not a coordinate letter (x, y, z, u, v, w) and would be optimised over as an unknown. Give ${params.length === 1 ? "it" : "them"} a value, or write the problem in x, y, z.`,
    );
  }
  if (!freeVars(f).length) return refuse(title, "f is a constant: every point of the constraint set is both its maximum and its minimum.");
  if (vars.length < 2) return refuse(title, "Lagrange multipliers need at least two variables.");
  if (freeVars(c).length) return refuse(title, "The right-hand side of the constraint must be a constant.");
  const gf = gradient(f, vars);
  const gg = gradient(g, vars);
  // ∇f = λ∇g, g = c
  const eqs = vars.map((_, i) => `${format(gf[i])} - lam*(${format(gg[i])}) = 0`);
  eqs.push(`${format(g)} = ${format(c)}`);
  const sys = solveSystem(eqs, [...vars, "lam"]);
  const caveats: string[] = [];
  const candidates: { coords: Expr[]; lam: Expr; exact: boolean }[] = [];
  if (sys && sys.kind === "unique" && sys.exact) {
    candidates.push({ coords: vars.map((v) => parseExpr(sys.exact![v])), lam: parseExpr(sys.exact.lam), exact: true });
  } else if (sys && sys.numeric && sys.numeric.length) {
    for (const sol of sys.numeric) {
      const lamSnap = snapExact(sol.lam, 1e-6);
      const pt = snapPoint(vars.map((v) => sol[v]), (coords) => {
        if (!lamSnap) return false;
        // exact: g(p) − c = 0 and ∇f(p) − λ∇g(p) = 0, all simplifying to 0
        if (!isNum(atPoint(SUB(g, c), vars, coords), 0)) return false;
        return gf.every((comp, i) => isNum(atPoint(SUB(comp, mul(lamSnap, gg[i])), vars, coords), 0));
      });
      candidates.push({ coords: pt.coords, lam: pt.exact && lamSnap ? lamSnap : N(sol.lam), exact: pt.exact });
    }
    caveats.push("The system ∇f = λ∇g, g = c was solved NUMERICALLY by the multi-start solver; the candidate list may be incomplete.");
    caveats.push(...sys.caveats);
  } else {
    const cv = constValue(c);
    if (cv !== null && cv < 0 && sumOfPositiveSquares(g, vars)) {
      return refuse(title, `The constraint ${format(g)} = ${format(c)} has NO real points (a sum of squares cannot be negative), so there is nothing to optimise over.`);
    }
    return refuse(title, "The system ∇f = λ∇g, g = c could not be solved here.");
  }
  // Verify each candidate by substitution, then evaluate f.
  const seen = new Set<string>();
  const rows: { coords: Expr[]; lam: Expr; value: number; fv: Expr; exact: boolean }[] = [];
  for (const cand of candidates) {
    const key = cand.coords.map((x) => (constValue(x) ?? NaN).toFixed(8)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const env: Record<string, number> = {};
    vars.forEach((v, i) => (env[v] = constValue(cand.coords[i]) ?? NaN));
    const lamV = constValue(cand.lam) ?? NaN;
    let ok = Number.isFinite(lamV);
    try {
      if (Math.abs(evalAst(g, env) - (constValue(c) ?? NaN)) > 1e-7 * Math.max(1, Math.abs(constValue(c) ?? 1))) ok = false;
      for (let i = 0; i < vars.length && ok; i++) {
        const r = evalAst(gf[i], env) - lamV * evalAst(gg[i], env);
        if (Math.abs(r) > 1e-6 * Math.max(1, Math.abs(evalAst(gf[i], env)))) ok = false;
      }
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const fv = atPoint(f, vars, cand.coords);
    const value = constValue(fv);
    if (value === null) continue;
    rows.push({ coords: cand.coords, lam: cand.lam, value, fv, exact: cand.exact });
  }
  if (!rows.length) return refuse(title, "No candidate satisfied ∇f = λ∇g and the constraint on substitution — nothing shown.");
  rows.sort((a, b) => b.value - a.value);
  const bounded = constraintBounded(g, vars, c);
  const lines: VerbResult["lines"] = [{ text: `∇f = λ∇g with ∇f = ${tupleText(gf)}, ∇g = ${tupleText(gg)}; constraint ${format(g)} = ${format(c)}.` }];
  const spanAll = rows[0].value - rows[rows.length - 1].value;
  const constantF = rows.length >= 2 && spanAll <= 1e-7 * Math.max(1, Math.abs(rows[0].value));
  const MAX_ROWS = constantF ? 4 : 24;
  rows.slice(0, MAX_ROWS).forEach((r) => {
    lines.push({ text: `${tupleText(r.coords)}${r.exact ? "" : " (numeric)"}: f = ${format(r.fv)}, λ = ${format(r.lam)}` });
  });
  if (rows.length > MAX_ROWS) caveats.push(`${rows.length - MAX_ROWS} further candidates not listed (the first ${MAX_ROWS} by value are shown).`);
  const span = rows[0].value - rows[rows.length - 1].value;
  const tieTol = 1e-7 * Math.max(1, Math.abs(rows[0].value));
  const near = (v: number) => rows.filter((r) => Math.abs(r.value - v) <= tieTol);
  const at = (rs: typeof rows) => rs.map((r) => tupleText(r.coords)).join(" and ");
  if (rows.length >= 2 && span <= tieTol) {
    lines.push({ text: `f = ${format(rows[0].fv)} at every candidate found${rows.every((r) => r.exact) ? "" : " (to numerical precision)"}: f does not vary across them, so no distinct maximum and minimum are declared.` });
    caveats.unshift("f takes one value on every candidate; it may be constant on the whole constraint set.");
  } else if (bounded) {
    const hi = rows[0];
    const lo = rows[rows.length - 1];
    lines.push({ text: `Maximum f = ${format(hi.fv)} at ${at(near(hi.value))}; minimum f = ${format(lo.fv)} at ${at(near(lo.value))}.` });
    caveats.unshift("The constraint set is bounded (a sum of positive squares equal to a positive constant), so the largest and smallest candidate values are the maximum and minimum.");
  } else {
    lines.push({ text: `Largest candidate f = ${format(rows[0].fv)}; smallest f = ${format(rows[rows.length - 1].fv)}.` });
    caveats.unshift("Candidates only: the constraint set's boundedness was not established, so an extreme value may not exist (the largest candidate need not be a maximum).");
  }
  caveats.push("Every candidate is verified by substitution into ∇f = λ∇g and into the constraint.");
  return { title, lines, caveats };
}

// ---------------------------------------------------------------------------
// Iterated integrals
// ---------------------------------------------------------------------------

interface Bound {
  v: string;
  lo: Expr;
  hi: Expr;
}

function parseBounds(spec: string): Bound[] | { error: string } {
  const parts = spec.split(/\s*,\s*|\s+and\s+|\s+then\s+/i).filter(Boolean);
  const out: Bound[] = [];
  for (const p of parts) {
    const m = /^([a-zA-Z_]\w*)\s*(?:from|=|in|:)?\s*(.+?)\s*(?:to|\.\.)\s*(.+)$/i.exec(p.trim());
    if (!m) return { error: `Each bound reads like "y from 0 to x": could not read "${p.trim()}".` };
    try {
      out.push({ v: m[1], lo: parseExpr(m[2]), hi: parseExpr(m[3]) });
    } catch (err) {
      return { error: `Couldn't read the bounds of ${m[1]}: ${(err as Error).message}` };
    }
  }
  return out;
}

/**
 * The expressions whose zero or sign makes the integrand singular:
 * denominators, arguments of ln/log (must stay > 0), of even roots (≥ 0),
 * and cos of a tan argument.
 */
function dangerExprs(e: Expr, out: Expr[] = []): Expr[] {
  switch (e.t) {
    case "num":
    case "var":
      return out;
    case "neg":
      return dangerExprs(e.e, out);
    case "fn":
      if (e.name === "ln" || e.name === "log" || e.name === "log10" || e.name === "log2") out.push({ t: "fn", name: "__pos", arg: e.arg });
      if (e.name === "sqrt") out.push({ t: "fn", name: "__nonneg", arg: e.arg });
      if (e.name === "tan" || e.name === "sec") out.push(FN("cos", e.arg));
      if (e.name === "cot" || e.name === "csc") out.push(FN("sin", e.arg));
      return dangerExprs(e.arg, out);
    case "div":
      pushDenominator(e.r, out);
      return dangerExprs(e.r, dangerExprs(e.l, out));
    case "pow":
      if (e.r.t === "num" && (e.r.v < 0 || !Number.isInteger(e.r.v))) pushDenominator(e.l, out);
      return dangerExprs(e.r, dangerExprs(e.l, out));
    default:
      return dangerExprs(e.r, dangerExprs(e.l, out));
  }
}

/** (y − 0.3)² touches zero without changing sign: track the BASE of a power and each factor of a product. */
function pushDenominator(d: Expr, out: Expr[]): void {
  if (d.t === "pow" && d.r.t === "num") return pushDenominator(d.l, out);
  if (d.t === "mul") {
    pushDenominator(d.l, out);
    pushDenominator(d.r, out);
    return;
  }
  if (d.t === "neg") return pushDenominator(d.e, out);
  if (d.t === "num") return;
  out.push(d);
}

/**
 * A singularity of the integrand INSIDE the region, by structure plus a
 * sweep: along the innermost variable each denominator is tracked for a sign
 * change or a zero (a continuous denominator crossing zero must do one of
 * those between neighbouring samples), ln arguments for ≤ 0, even-root
 * arguments for < 0, and the integrand itself for a non-finite value. The
 * region's boundary is excluded (an endpoint singularity may be integrable,
 * and is judged by the convergence of the quadrature instead).
 */
function interiorSingularity(f: Expr, bounds: Bound[], env0: Record<string, number>): string | null {
  const dangers = dangerExprs(f);
  const SAMPLES = 161;
  const env: Record<string, number> = { ...env0 };
  let found: string | null = null;
  // One sign tracker for the WHOLE region: the region is connected, so two
  // samples anywhere in it with a denominator of opposite signs bracket a
  // zero inside it (intermediate value theorem) — a pole in an OUTER
  // variable once slipped through because the tracker reset per inner sweep.
  let prev: number[] | null = null;
  const sweep = (k: number): void => {
    if (found) return;
    const b = bounds[bounds.length - 1 - k];
    const lo = evalAst(b.lo, env);
    const hi = evalAst(b.hi, env);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return;
    const inner = k === bounds.length - 1;
    const n = inner ? SAMPLES : bounds.length === 3 ? 13 : 33;
    for (let i = 0; i < n && !found; i++) {
      const t = (i + 0.5) / n;
      env[b.v] = lo + (hi - lo) * t;
      if (!inner) {
        sweep(k + 1);
        continue;
      }
      const fv = evalAst(f, env);
      const where = bounds.map((bb) => `${bb.v} ≈ ${Number((env[bb.v] ?? NaN).toPrecision(4))}`).join(", ");
      if (!Number.isFinite(fv)) {
        found = `the integrand is not finite at ${where}`;
        break;
      }
      const cur = dangers.map((d) => (d.t === "fn" && (d.name === "__pos" || d.name === "__nonneg") ? evalAst(d.arg, env) : evalAst(d, env)));
      for (let j = 0; j < dangers.length && !found; j++) {
        const d = dangers[j];
        const v = cur[j];
        if (d.t === "fn" && d.name === "__pos" && !(v > 0)) found = `a logarithm's argument ${format(d.arg)} is not positive at ${where}`;
        else if (d.t === "fn" && d.name === "__nonneg" && v < 0) found = `an even root's argument ${format(d.arg)} is negative at ${where}`;
        else if (d.t !== "fn" || (d.name !== "__pos" && d.name !== "__nonneg")) {
          if (!Number.isFinite(v) || Math.abs(v) < 1e-12) found = `the integrand is singular at ${where} (${format(d)} = 0)`;
          else if (prev && Number.isFinite(prev[j]) && Math.sign(prev[j]) !== Math.sign(v)) found = `the integrand has a pole between the samples near ${where} (${format(d)} changes sign)`;
        }
      }
      prev = cur;
    }
    delete env[b.v];
  };
  try {
    sweep(0);
  } catch {
    return "the integrand could not be evaluated over the region";
  }
  return found;
}

/** Nested midpoint quadrature over the given bounds (innermost first); NaN on any evaluation failure. */
function numericIterated(f: Expr, bounds: Bound[], panels: number, env0: Record<string, number> = {}): number {
  const vars = bounds.map((b) => b.v);
  const env: Record<string, number> = { ...env0 };
  try {
    return numericIteratedInner(f, bounds, panels, env, vars);
  } catch {
    return NaN;
  }
}
function numericIteratedInner(f: Expr, bounds: Bound[], panels: number, env: Record<string, number>, vars: string[]): number {
  const level = (k: number): number => {
    // k counts from the OUTERMOST (last) bound inward.
    const b = bounds[bounds.length - 1 - k];
    const lo = evalAst(b.lo, env);
    const hi = evalAst(b.hi, env);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN;
    const h = (hi - lo) / panels;
    let sum = 0;
    for (let i = 0; i < panels; i++) {
      env[b.v] = lo + (i + 0.5) * h;
      sum += k === bounds.length - 1 ? evalAst(f, env) : level(k + 1);
    }
    return sum * h;
  };
  const r = level(0);
  for (const v of vars) delete env[v];
  return r;
}

function tryIterated(input: string): VerbResult | null {
  const m = /^\s*(double|triple|iterated)\s+integral\s+(?:of\s+)?(.+?)\s+(?:over|with|for|where|on)\s+(.+)$/i.exec(input);
  if (!m) return null;
  const title = `${m[1].toLowerCase()} integral of ${m[2].trim()}`;
  const pf = parseF(m[2], title);
  if (pf === null) return null;
  if ("lines" in pf) return pf;
  const f = pf.f;
  const bounds = parseBounds(m[3]);
  if ("error" in bounds) return refuse(title, bounds.error);
  const want = m[1].toLowerCase() === "double" ? 2 : m[1].toLowerCase() === "triple" ? 3 : bounds.length;
  if (bounds.length !== want) return refuse(title, `A ${m[1].toLowerCase()} integral needs ${want} bound specifications; ${bounds.length} given.`);
  if (bounds.length < 2) return refuse(title, "An iterated integral needs at least two bound specifications; a single integral is the Definite integral kind's job.");
  if (bounds.length > 3) return refuse(title, "Up to three nested integrals here (the nested quadrature that verifies the result grows as the cube of its resolution).");
  const seenVars = new Set<string>();
  for (const b of bounds) {
    if (seenVars.has(b.v)) return refuse(title, `The variable ${b.v} is integrated twice; each bound specification needs its own variable.`);
    seenVars.add(b.v);
  }
  const boundVars = bounds.map((b) => b.v);
  const paramEnv: Record<string, number> = {};
  const params = varsOf([f, ...bounds.flatMap((b) => [b.lo, b.hi])]).filter((v) => !boundVars.includes(v) && v !== "pi" && v !== "e");
  if (params.some((v) => looksLikeProse([v]))) return null;
  const differentials = params.filter((v) => /^d[a-z]$/i.test(v));
  if (differentials.length) {
    return refuse(title, `${differentials.join(", ")} read as ${differentials.length === 1 ? "a variable" : "variables"} here. Leave the differentials out — the bound specifications say which variable each integral is over: "double integral x y over x from 0 to 1, y from 0 to 1".`);
  }
  // Parameters are carried symbolically; the numerical cross-check gives
  // each an arbitrary value (0.73, 1.37, …) and compares at that value.
  params.forEach((v, i) => (paramEnv[v] = 0.73 + 0.64 * i));
  // Bounds may depend only on OUTER variables.
  for (let i = 0; i < bounds.length; i++) {
    const outer = bounds.slice(i + 1).map((b) => b.v);
    for (const e of [bounds[i].lo, bounds[i].hi]) {
      const bad = freeVars(e).filter((v) => !outer.includes(v));
      if (bad.length) return refuse(title, `The bounds of ${bounds[i].v} may depend only on the outer variables (${outer.join(", ") || "none"}); found ${bad.join(", ")}. Innermost first: "y from 0 to x, x from 0 to 1".`);
    }
  }
  const lines: VerbResult["lines"] = [];
  let cur: Expr = f;
  let exact = true;
  for (const b of bounds) {
    const anti = symbolicIntegrate(cur, b.v, derivative);
    if (!anti) {
      exact = false;
      break;
    }
    const next = S(SUB(substituteVar(anti.F, b.v, b.hi), substituteVar(anti.F, b.v, b.lo)));
    lines.push({ text: `∫ (${format(cur)}) d${b.v} from ${format(b.lo)} to ${format(b.hi)} = ${format(next)}   [F = ${format(anti.F)}]` });
    cur = next;
  }
  const singular = interiorSingularity(f, bounds, paramEnv);
  if (singular) return refuse(title, `Not evaluated: ${singular}. An integral across a singularity is improper and may diverge; split the region at the singular point and treat each piece as a limit.`);
  const panels = bounds.length === 3 ? 60 : 400;
  const numeric = numericIterated(f, bounds, panels, paramEnv);
  const paramNote = params.length ? ` ${params.join(", ")} ${params.length === 1 ? "is a parameter, carried" : "are parameters, carried"} symbolically; the numerical cross-check used ${params.map((v) => `${v} = ${paramEnv[v]}`).join(", ")}.` : "";
  if (!exact) {
    if (!Number.isFinite(numeric)) return refuse(title, "No closed form was found for an inner integral, and the numerical value is not finite.");
    // Convergence from three resolutions (N/2, N, 2N): the differences must
    // shrink; the limit is estimated by Aitken extrapolation and the digits
    // shown are the digits the estimated error allows.
    const coarse = numericIterated(f, bounds, Math.round(panels / 2), paramEnv);
    const fine = numericIterated(f, bounds, panels * 2, paramEnv);
    const d1 = Math.abs(numeric - coarse);
    const d2 = Math.abs(fine - numeric);
    const scale = Math.max(1e-12, Math.abs(fine));
    if (!Number.isFinite(coarse) || !Number.isFinite(fine) || !(d2 < 0.95 * d1) && d2 > 1e-9 * scale) {
      return refuse(title, `No closed form was found, and the numerical quadrature has not converged (${coarse.toPrecision(6)}, ${numeric.toPrecision(6)}, ${fine.toPrecision(6)} at successive doublings of the resolution) — the integral may be improper or oscillatory.`);
    }
    const ratio = d1 > 0 ? d2 / d1 : 0;
    const errEst = ratio < 1 ? (d2 * ratio) / (1 - ratio) + d2 * 1e-3 : d2;
    const limit = ratio > 0 && ratio < 1 ? fine + (fine - numeric) * (ratio / (1 - ratio)) : fine;
    const digits = Math.max(1, Math.min(10, Math.floor(-Math.log10(Math.max(errEst, 1e-15) / scale))));
    if (digits < 3) {
      return refuse(title, `No closed form was found, and the numerical quadrature converges too slowly for three reliable significant figures (${coarse.toPrecision(6)}, ${numeric.toPrecision(6)}, ${fine.toPrecision(6)} at successive doublings; extrapolated ≈ ${limit.toPrecision(4)}). An endpoint singularity (integrable, like 1/√x) or an oscillation is the usual cause — not shown rather than shown to false precision.`);
    }
    return {
      title,
      lines: [{ text: `≈ ${limit.toPrecision(digits)}   (numeric)` }],
      caveats: [`No closed form was found for one of the inner integrals (the integrator refuses what it cannot verify), so the value is numerical: nested midpoint quadrature at three resolutions, extrapolated; about ${digits} significant figure${digits === 1 ? "" : "s"} (estimated error ${errEst.toExponential(1)}).${paramNote}`],
    };
  }
  // The exact result must be finite and genuinely exact.
  let value: number | null;
  try {
    const v = evalAst(cur, { pi: Math.PI, e: Math.E, ...paramEnv });
    value = Number.isFinite(v) ? v : null;
  } catch {
    value = null;
  }
  if (value === null) {
    const stillVars = freeVars(cur).filter((v) => !params.includes(v) && v !== "pi" && v !== "e");
    if (stillVars.length) return refuse(title, `The result still contains ${stillVars.join(", ")} — the bounds did not close the integral.`);
    return refuse(title, `The antiderivative is not finite at a boundary (${format(cur)}): the integral is improper there and DIVERGES, or needs a limit this does not take.`);
  }
  if (!Number.isFinite(numeric) || Math.abs(numeric - value) > 2e-3 * Math.max(1, Math.abs(value))) {
    // An integrable endpoint singularity (1/√x at 0) converges slowly: accept
    // if the error shrinks with resolution and is small at the finer one.
    const finer = numericIterated(f, bounds, bounds.length === 3 ? 120 : 1600, paramEnv);
    const e1 = Math.abs(numeric - value);
    const e2 = Math.abs(finer - value);
    // A divergent integral's midpoint sums move AWAY from any finite value;
    // an integrable endpoint singularity's move toward it (slowly: ~h^½ for
    // 1/√x). The antiderivative was verified by differentiation already.
    const converging = Number.isFinite(finer) && e2 < 0.85 * e1 && e2 <= 1e-1 * Math.max(1, Math.abs(value));
    if (!converging) return refuse(title, `The exact value ${format(cur)} did not agree with numerical quadrature (${numeric.toPrecision(6)}) — withheld rather than shown wrong.`);
  }
  if (hasDecimal(cur)) {
    // A folded float is not an exact value; say what it is.
    return {
      title,
      lines: [{ text: `≈ ${value.toPrecision(10)}   (numeric)` }, ...lines],
      caveats: [`The antiderivatives are exact but a bound or constant was folded to a decimal on substitution, so the value is shown as a decimal rather than claimed exact. It agrees with nested numerical quadrature.${paramNote}`],
    };
  }
  lines.unshift({ text: `= ${format(cur)}`, math: true });
  if (!/^-?\d+(\.\d+)?$/.test(format(cur)) && !params.length) lines.splice(1, 0, { text: `≈ ${value.toPrecision(8)}` });
  return { title, lines, caveats: [`Exact: each inner antiderivative is verified by differentiation (the integrator's own rule) and the final value agrees with nested numerical quadrature.${paramNote}`] };
}

// ---------------------------------------------------------------------------
// Vector fields
// ---------------------------------------------------------------------------

/**
 * A field's coordinates are x, y[, z] — ALWAYS. Any other letter is a
 * parameter: (a x, b y) has divergence a + b, not "x + y" (the sorted-letters
 * choice once made a, b the coordinates and printed "undefined" as a name).
 */
function fieldVars(F: Expr[]): string[] {
  return ["x", "y", "z"].slice(0, F.length);
}
function fieldParams(F: Expr[]): string[] {
  const conv = new Set(fieldVars(F));
  return varsOf(F).filter((v) => !conv.has(v) && v !== "pi" && v !== "e");
}
/** A field written without x, y, z (in u, v or r, θ) must not be answered "0". */
function fieldRefusal(F: Expr[], title: string): VerbResult | null {
  const vs = varsOf(F);
  const fused = fusedName(vs);
  if (fused) return refuse(title, `${fused} was read as ONE variable named ${fused}; for a product write ${fused.split("").join("*")}.`);
  const conv = fieldVars(F);
  // (a, b) and (0, 0, B) are constant fields; (u, v) and (r cos θ, r sin θ) are other coordinate names.
  const ALT = new Set(["u", "v", "w", "r", "theta", "phi", "rho", "s", "t"]);
  if (vs.length && !vs.some((v) => conv.includes(v)) && vs.some((v) => ALT.has(v.toLowerCase()))) {
    return refuse(title, `The field is read in the coordinates ${conv.join(", ")}, and none of them appear (only ${vs.join(", ")}). Write it in ${conv.join(", ")} — this verb does not take other coordinate names.`);
  }
  return null;
}
function paramCaveat(F: Expr[]): string[] {
  const p = fieldParams(F);
  return p.length ? [`${p.join(", ")} ${p.length === 1 ? "is" : "are"} treated as constant${p.length === 1 ? "" : "s"} (the coordinates are x, y${F.length === 3 ? ", z" : ""}).`] : [];
}

function tryDivergence(input: string): VerbResult | null {
  const m = /^\s*(?:divergence|div)\s+(?:of\s+)?(\(.+\))\s*$/i.exec(input);
  if (!m) return null;
  const title = `divergence of ${m[1]}`;
  const F = parseTuple(m[1]);
  if (!F || F.length < 2 || F.length > 3) return refuse(title, "Give the field as (P, Q) or (P, Q, R).");
  if (looksLikeProse(varsOf(F))) return null;
  const fr = fieldRefusal(F, title);
  if (fr) return fr;
  const vars = fieldVars(F);
  const d = S(add(...F.map((c, i) => derivative(c, vars[i]))));
  for (let i = 0; i < F.length; i++) if (!partialAgrees(F[i], vars, vars[i], S(derivative(F[i], vars[i])))) return refuse(title, "a partial failed its finite-difference check — withheld");
  return { title, lines: [{ text: `div F = ${format(d)}`, math: true }, { text: `= ${F.map((_, i) => `∂F${i + 1}/∂${vars[i]}`).join(" + ")}` }], caveats: ["Verified: each partial agrees with a finite-difference check.", ...paramCaveat(F)] };
}

function curlOf(F: Expr[], vars: string[]): Expr[] {
  const d = (i: number, v: string): Expr => S(derivative(F[i], v));
  if (F.length === 2) return [S(SUB(d(1, vars[0]), d(0, vars[1])))]; // scalar curl ∂Q/∂x − ∂P/∂y
  const [x, y, z] = vars;
  return [S(SUB(d(2, y), d(1, z))), S(SUB(d(0, z), d(2, x))), S(SUB(d(1, x), d(0, y)))];
}

function tryCurl(input: string): VerbResult | null {
  const m = /^\s*(?:curl|rot)\s+(?:of\s+)?(\(.+\))\s*$/i.exec(input);
  if (!m) return null;
  const title = `curl of ${m[1]}`;
  const F = parseTuple(m[1]);
  if (!F || F.length < 2 || F.length > 3) return refuse(title, "Give the field as (P, Q) or (P, Q, R).");
  if (looksLikeProse(varsOf(F))) return null;
  const fr = fieldRefusal(F, title);
  if (fr) return fr;
  const vars = fieldVars(F);
  const c = curlOf(F, vars);
  const lines: VerbResult["lines"] = F.length === 2
    ? [{ text: `curl F = ∂Q/∂${vars[0]} − ∂P/∂${vars[1]} = ${format(c[0])}`, math: false }, { text: `${format(c[0])}`, math: true }]
    : [{ text: `curl F = ${tupleText(c)}` }, ...c.map((comp, i) => ({ text: `(curl F)_${vars[i]} = ${format(comp)}`, math: true }))];
  const zero = c.every((comp) => isNum(comp, 0));
  if (zero) lines.push({ text: "curl F = 0: the field is irrotational — on a simply connected domain it is conservative (try potential (…))." });
  return { title, lines, caveats: ["Each partial agrees with a finite-difference check.", ...paramCaveat(F)] };
}

/** A scalar potential φ with ∇φ = F, verified by taking the gradient back; null when F is not conservative. */
function potentialOf(F: Expr[], vars: string[]): { phi: Expr } | { why: string } {
  const c = curlOf(F, vars);
  if (!c.every((comp) => isNum(comp, 0))) return { why: `curl F = ${F.length === 2 ? format(c[0]) : tupleText(c)} ≠ 0, so the field is not conservative and has no potential` };
  // φ = ∫P dx; then add ∫(Q − ∂φ/∂y) dy; then ∫(R − ∂φ/∂z) dz.
  let phi: Expr = N(0);
  for (let i = 0; i < F.length; i++) {
    const residual = S(SUB(F[i], derivative(phi, vars[i])));
    const anti = symbolicIntegrate(residual, vars[i], derivative);
    if (!anti) return { why: `the integral ∫(${format(residual)}) d${vars[i]} has no closed form here` };
    phi = S(add(phi, anti.F));
  }
  // Verify ∇φ = F.
  for (let i = 0; i < F.length; i++) {
    const diff = S(SUB(derivative(phi, vars[i]), F[i]));
    if (!isNum(diff, 0) && !partialAgrees(phi, vars, vars[i], F[i])) return { why: "the potential found did not reproduce the field on differentiation — withheld" };
  }
  return { phi };
}

function tryPotential(input: string): VerbResult | null {
  const m = /^\s*(?:scalar\s+)?potential\s+(?:function\s+)?(?:of|for)?\s*(\(.+\))\s*$/i.exec(input);
  if (!m) return null;
  const title = `potential of ${m[1]}`;
  const F = parseTuple(m[1]);
  if (!F || F.length < 2 || F.length > 3) return refuse(title, "Give the field as (P, Q) or (P, Q, R).");
  if (looksLikeProse(varsOf(F))) return null;
  const fr = fieldRefusal(F, title);
  if (fr) return fr;
  const vars = fieldVars(F);
  const r = potentialOf(F, vars);
  if ("why" in r) return refuse(title, r.why);
  return {
    title,
    lines: [{ text: `φ = ${format(r.phi)} + C`, math: false }, { text: format(r.phi), math: true }],
    caveats: ["Verified: ∇φ = F on differentiation. Any constant may be added.", ...paramCaveat(F)],
  };
}

function tryLineIntegral(input: string): VerbResult | null {
  const m = /^\s*line\s+integral\s+(?:of\s+)?(\(.+?\))\s+from\s*(\(.+?\))\s+to\s*(\(.+?\))\s*$/i.exec(input);
  if (!m) return null;
  const title = `line integral of ${m[1]} from ${m[2]} to ${m[3]}`;
  const F = parseTuple(m[1]);
  const A = parseTuple(m[2]);
  const B = parseTuple(m[3]);
  if (!F || F.length < 2 || F.length > 3) return refuse(title, "Give the field as (P, Q) or (P, Q, R).");
  if (!A || !B || A.length !== F.length || B.length !== F.length) return refuse(title, `The end points need ${F.length} coordinates each.`);
  if (looksLikeProse(varsOf(F))) return null;
  const fr = fieldRefusal(F, title);
  if (fr) return fr;
  const vars = fieldVars(F);
  const r = potentialOf(F, vars);
  if ("why" in r) {
    return refuse(title, `${r.why}. The integral then depends on the PATH, which was not given — supply a parametrised path to integrate along.`);
  }
  // φ(B) − φ(A) needs F defined on a simply connected region holding both
  // points: φ must be finite at both ends and F finite along the straight
  // segment between them (a field singular on every path, such as (1/x, 1/y)
  // across an axis, has no path-independent value).
  // Parameters (in the field or the end points) get stand-in values for the
  // finiteness checks; the answer itself stays symbolic.
  const symbols = varsOf([...F, ...A, ...B]).filter((v) => !vars.includes(v) && v !== "pi" && v !== "e");
  const extra = paramEnvFor(symbols);
  const numPt = (P: Expr[]): number[] | null => {
    const out: number[] = [];
    for (const c of P) {
      try {
        const v = evalAst(c, { pi: Math.PI, e: Math.E, ...extra });
        if (!Number.isFinite(v)) return null;
        out.push(v);
      } catch {
        return null;
      }
    }
    return out;
  };
  const An = numPt(A);
  const Bn = numPt(B);
  if (!An || !Bn) return refuse(title, "The end points must be finite (numbers, or symbols standing for numbers).");
  const badA = undefinedAt([r.phi, ...F], vars, A, extra);
  const badB = undefinedAt([r.phi, ...F], vars, B, extra);
  if (badA || badB) return refuse(title, `The potential or the field is not finite at an end point: ${badA ?? badB}. The integral is improper there.`);
  for (let i = 1; i < 200; i++) {
    const t = i / 200;
    const P = An.map((a, k) => N(a * (1 - t) + Bn[k] * t));
    if (undefinedAt(F, vars, P, extra)) return refuse(title, `The field is singular on the straight segment from ${m[2]} to ${m[3]} (at ${tupleText(P.map((c) => N(Number((constValue(c) ?? 0).toPrecision(4)))))}); the value then depends on which way the path goes round the singularity.`);
  }
  const phiB = atPoint(r.phi, vars, B);
  const phiA = atPoint(r.phi, vars, A);
  const val = S(SUB(phiB, phiA));
  return {
    title,
    lines: [
      { text: `= ${format(val)}`, math: true },
      { text: `F is conservative with potential φ = ${format(r.phi)}, so the integral is φ${m[3]} − φ${m[2]} = (${format(phiB)}) − (${format(phiA)}), independent of the path.` },
    ],
    caveats: ["Verified: ∇φ = F on differentiation.", ...paramCaveat(F)],
  };
}

// ---------------------------------------------------------------------------

/** All multivariable verbs; null when the input is none of them. */
export function tryMultivar(input: string): VerbResult | null {
  return (
    tryDirectional(input) ??
    tryGradient(input) ??
    tryHessian(input) ??
    tryJacobian(input) ??
    tryCriticalPoints(input) ??
    tryLagrange(input) ??
    tryIterated(input) ??
    tryDivergence(input) ??
    tryCurl(input) ??
    tryPotential(input) ??
    tryLineIntegral(input)
  );
}

/** True when the line starts with one of these verbs — the pane's prose switches must stand aside. */
export const MULTIVAR_VERB_RE =
  /^\s*(?:gradient|grad|nabla|del|hessian|jacobian|directional\s+derivative|critical\s+points?|stationary\s+points?|extrema|local\s+extrema|classify\s+(?:the\s+)?critical|lagrange|maximi[sz]e|minimi[sz]e|optimi[sz]e|extremi[sz]e|double\s+integral|triple\s+integral|iterated\s+integral|divergence|div\b|curl|rot\b|(?:scalar\s+)?potential|line\s+integral)\b/i;

export { hasVar, hasFoldableConstant };
