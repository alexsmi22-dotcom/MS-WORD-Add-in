// Complex numbers on INPUT: i as the imaginary unit.
//
// Until now `i` was an ordinary variable to the Solve grammar, which made
// (2+3i)(1−i) an EQUATION in i with two "roots" and (1+i)^8 a degree-8
// polynomial with eight numeric roots — confident wrong answers for the most
// ordinary complex-number exercise there is. The parser is deliberately NOT
// changed (the display-contract tests evaluate exact complex displays by
// setting i = 0 and i = 1); instead this layer claims an input BEFORE the
// solver when i is used as the unit: an expression whose only symbol is i,
// or an equation in ONE unknown with complex coefficients.
//
// Exact where the mathematics is exact: Gaussian rationals a + b·i with a, b
// in ℚ for + − × ÷ and integer powers; |z|, conj, Re, Im; the argument in
// closed form at the multiples of π/6 and π/4 where it has one, and the
// polar form. A square root that is not a Gaussian rational, and anything
// with π, e or a transcendental function, is NUMERIC and labelled so. Every
// exact result is verified by evaluating the original expression in
// floating complex arithmetic; disagreement is reported, not hidden.

import { Expr, parseExpr, freeVars, evalAst } from "./solve";
import {
  Rat, RAT_ZERO, RAT_ONE, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratInt, ratMake, ratEq, ratToNumber, ratFromNumber, ratSign,
} from "./cas";
import { VerbResult } from "./algebraTools";

/** A Gaussian rational. */
export interface G { re: Rat; im: Rat }
const g = (re: Rat, im: Rat = RAT_ZERO): G => ({ re, im });
const G_ZERO = g(RAT_ZERO), G_ONE = g(RAT_ONE), G_I = g(RAT_ZERO, RAT_ONE);
export const gAdd = (a: G, b: G): G => g(ratAdd(a.re, b.re), ratAdd(a.im, b.im));
export const gSub = (a: G, b: G): G => g(ratSub(a.re, b.re), ratSub(a.im, b.im));
const BIG_CAP = 1n << 20000n;
const bigAbs = (n: bigint): bigint => (n < 0n ? -n : n);
function sizeChecked(z: G): G {
  if (bigAbs(z.re.n) > BIG_CAP || z.re.d > BIG_CAP || bigAbs(z.im.n) > BIG_CAP || z.im.d > BIG_CAP) {
    throw new ComplexRefusal("The exact numbers have grown past 20,000 bits — beyond this tool's size cap for exact arithmetic.");
  }
  return z;
}
export const gMul = (a: G, b: G): G => sizeChecked(g(ratSub(ratMul(a.re, b.re), ratMul(a.im, b.im)), ratAdd(ratMul(a.re, b.im), ratMul(a.im, b.re))));
export const gNeg = (a: G): G => g(ratNeg(a.re), ratNeg(a.im));
export const gIsZero = (a: G): boolean => ratIsZero(a.re) && ratIsZero(a.im);
export const gEq = (a: G, b: G): boolean => ratEq(a.re, b.re) && ratEq(a.im, b.im);
export const gConj = (a: G): G => g(a.re, ratNeg(a.im));
/** |z|² exactly. */
export const gNorm = (a: G): Rat => ratAdd(ratMul(a.re, a.re), ratMul(a.im, a.im));
export function gDiv(a: G, b: G): G {
  const n = gNorm(b);
  if (ratIsZero(n)) throw new ComplexRefusal("Division by zero.");
  const p = gMul(a, gConj(b));
  return g(ratDiv(p.re, n), ratDiv(p.im, n));
}
export function gPow(a: G, k: number): G {
  if (k < 0) return gDiv(G_ONE, gPow(a, -k));
  let r = G_ONE, b = a, e = k;
  while (e > 0) { if (e & 1) r = gMul(r, b); b = gMul(b, b); e >>= 1; }
  return r;
}
export const gToC = (a: G): C => ({ re: ratToNumber(a.re), im: ratToNumber(a.im) });

export class ComplexRefusal extends Error {}

// ---------------------------------------------------------------------------
// Exact rational square roots (null when not a perfect square).

function bigSqrt(n: bigint): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) break; x = y; }
  return x * x === n ? x : null;
}
export function ratSqrt(r: Rat): Rat | null {
  if (ratSign(r) < 0) return null;
  const n = bigSqrt(r.n), d = bigSqrt(r.d);
  return n !== null && d !== null ? ratMake(n, d) : null;
}

/** Exact Gaussian-rational square root, or null. w² = z needs |z| rational
 *  and (|z| ± Re z)/2 both perfect squares. */
export function gSqrt(z: G): G | null {
  if (gIsZero(z)) return G_ZERO;
  const r = ratSqrt(gNorm(z));
  if (r === null) return null;
  const half = ratMake(1n, 2n);
  const p = ratSqrt(ratMul(ratAdd(r, z.re), half));
  const q = ratSqrt(ratMul(ratSub(r, z.re), half));
  if (p === null || q === null) return null;
  return g(p, ratSign(z.im) < 0 ? ratNeg(q) : q);
}

// ---------------------------------------------------------------------------
// Floating complex arithmetic — the independent check, and the fallback.

export interface C { re: number; im: number }
// −0 is normalised away: atan2(−0, x < 0) is −π, so a negative zero
// imaginary part (the product of a negation) flips every branch cut and
// gave ln(−1) = −πi and (−2)^(1/2) = −1.414i.
const c = (re: number, im = 0): C => ({ re: re === 0 ? 0 : re, im: im === 0 ? 0 : im });
// The largest magnitude met while evaluating: a cancellation such as
// (1+i)^60 − (1−i)^60 = 0 leaves floating noise proportional to it, so the
// cross-check tolerance must scale with it rather than with the answer.
let scaleMax = 0;
const track = (z: C): C => { scaleMax = Math.max(scaleMax, Math.hypot(z.re, z.im)); return z; };
const cAdd = (a: C, b: C): C => track(c(a.re + b.re, a.im + b.im));
const cSub = (a: C, b: C): C => track(c(a.re - b.re, a.im - b.im));
const cMul = (a: C, b: C): C => track(c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re));
const cDiv = (a: C, b: C): C => { const d = b.re * b.re + b.im * b.im; return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cAbs = (a: C): number => Math.hypot(a.re, a.im);
const cExp = (a: C): C => c(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const cLog = (a: C): C => c(Math.log(cAbs(a)), Math.atan2(a.im, a.re));
function cPow(a: C, b: C): C {
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 1e6) {
    let n = Math.abs(b.re);
    let base = a, acc = c(1);
    while (n > 0) { if (n & 1) acc = cMul(acc, base); n = Math.floor(n / 2); if (n) base = cMul(base, base); }
    if (b.re < 0) { if (cAbs(acc) === 0) throw new ComplexRefusal("Division by zero (0 to a negative power)."); return cDiv(c(1), acc); }
    return track(acc);
  }
  if (cAbs(a) === 0) {
    if (b.im === 0 && b.re > 0) return c(0);
    throw new ComplexRefusal("0 to a negative or complex power is undefined.");
  }
  return track(cExp(cMul(b, cLog(a))));
}
const cSqrt = (a: C): C => { const r = cAbs(a); const re = Math.sqrt((r + a.re) / 2); const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2)); return c(re, im); };

/** Evaluates any expression in floating complex arithmetic; i is the unit. */
export function evalComplex(e: Expr, env: Record<string, C> = {}): C {
  switch (e.t) {
    case "num": return c(e.v);
    case "var":
      if (e.name === "i") return c(0, 1);
      if (e.name === "pi") return c(Math.PI);
      if (e.name === "e") return c(Math.E);
      if (env[e.name]) return env[e.name];
      throw new ComplexRefusal(`${e.name} has no value here.`);
    case "neg": return c(-evalComplex(e.e, env).re, -evalComplex(e.e, env).im);
    case "add": return cAdd(evalComplex(e.l, env), evalComplex(e.r, env));
    case "sub": return cSub(evalComplex(e.l, env), evalComplex(e.r, env));
    case "mul": return cMul(evalComplex(e.l, env), evalComplex(e.r, env));
    case "div": return cDiv(evalComplex(e.l, env), evalComplex(e.r, env));
    case "pow": return cPow(evalComplex(e.l, env), evalComplex(e.r, env));
    case "fn": {
      const a = evalComplex(e.arg, env);
      switch (e.name) {
        case "sqrt": return cSqrt(a);
        case "exp": return cExp(a);
        case "ln": case "log": return cLog(a);
        case "abs": return c(cAbs(a));
        case "conj": return c(a.re, -a.im);
        case "re": case "real": return c(a.re);
        case "im": case "imag": return c(a.im);
        case "arg": if (cAbs(a) === 0) throw new ComplexRefusal("arg(0) is undefined — zero has no direction."); return c(Math.atan2(a.im, a.re));
        case "sin": return c(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
        case "cos": return c(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
        case "tan": { const s = evalComplex({ t: "fn", name: "sin", arg: e.arg }, env), co = evalComplex({ t: "fn", name: "cos", arg: e.arg }, env); return cDiv(s, co); }
        default: throw new ComplexRefusal(`${e.name} is not defined for complex arguments here.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exact evaluation: an expression tree over Gaussian rationals, where every
// node is exact or the whole thing is declared numeric.

class NotExact extends Error {}

function exactValue(e: Expr): G {
  switch (e.t) {
    case "num": {
      if (!Number.isInteger(e.v) && String(e.v).length > 17) throw new NotExact();
      return g(ratFromNumber(e.v));
    }
    case "var":
      if (e.name === "i") return G_I;
      throw new NotExact(); // pi, e, or an unknown
    case "neg": return gNeg(exactValue(e.e));
    case "add": return gAdd(exactValue(e.l), exactValue(e.r));
    case "sub": return gSub(exactValue(e.l), exactValue(e.r));
    case "mul": return gMul(exactValue(e.l), exactValue(e.r));
    case "div": return gDiv(exactValue(e.l), exactValue(e.r));
    case "pow": {
      const base = exactValue(e.l);
      const k = exactValue(e.r);
      if (!ratIsZero(k.im) || k.re.d !== 1n) {
        // A rational power: ½ is an exact square root when one exists.
        if (ratIsZero(k.im) && ratEq(k.re, ratMake(1n, 2n))) { const s = gSqrt(base); if (s) return s; }
        throw new NotExact();
      }
      const n = Number(k.re.n);
      if (Math.abs(n) > 4096) throw new ComplexRefusal("Integer powers are handled up to ±4096.");
      if (gIsZero(base) && n < 0) throw new ComplexRefusal("Division by zero (0 to a negative power).");
      return gPow(base, n);
    }
    case "fn": {
      const a = exactValue(e.arg);
      switch (e.name) {
        case "conj": return gConj(a);
        case "re": case "real": return g(a.re);
        case "im": case "imag": return g(a.im);
        case "abs": { const r = ratSqrt(gNorm(a)); if (r === null) throw new NotExact(); return g(r); }
        case "sqrt": { const s = gSqrt(a); if (s === null) throw new NotExact(); return s; }
        default: throw new NotExact();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Display — and it parses back: a fraction times i is bracketed, "(1/5)i",
// because the grammar's deliberate 1/2x ambiguity gate refuses "1/5i".

function fmtRatPlain(r: Rat): string { return r.d === 1n ? r.n.toString() : `${r.n}/${r.d}`; }
function absRat(r: Rat): Rat { return ratSign(r) < 0 ? ratNeg(r) : r; }
export function fmtG(z: G): string {
  if (gIsZero(z)) return "0";
  const parts: string[] = [];
  if (!ratIsZero(z.re)) parts.push(fmtRatPlain(z.re).replace("-", "−"));
  if (!ratIsZero(z.im)) {
    const mag = absRat(z.im);
    const body = ratEq(mag, RAT_ONE) ? "i" : mag.d === 1n ? `${mag.n}i` : `(${fmtRatPlain(mag)})i`;
    const neg = ratSign(z.im) < 0;
    if (!parts.length) parts.push(neg ? `−${body}` : body);
    else parts.push(`${neg ? "−" : "+"} ${body}`);
  }
  return parts.join(" ");
}
const sig = (x: number, n = 10): string => {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-12) return "0";
  return Number(x.toPrecision(n)).toString();
};
export function fmtC(z: C, digits = 10): string {
  const eps = Math.max(1e-12, Math.pow(10, -digits) * Math.max(1, Math.hypot(z.re, z.im)));
  const re = Math.abs(z.re) < eps ? 0 : z.re;
  const im = Math.abs(z.im) < eps ? 0 : z.im;
  if (re === 0 && im === 0) return "0";
  const parts: string[] = [];
  if (re !== 0) parts.push(sig(re, digits).replace("-", "−"));
  if (im !== 0) {
    const magS = sig(Math.abs(im), digits);
    const body = magS === "1" ? "i" : `${magS}i`;
    if (!parts.length) parts.push(im < 0 ? `−${body}` : body);
    else parts.push(`${im < 0 ? "−" : "+"} ${body}`);
  }
  return parts.join(" ");
}

/** The argument in closed form when it is a multiple of π/6 or π/4. */
function exactArg(z: G): string | null {
  if (gIsZero(z)) return null;
  const re = z.re, im = z.im;
  const sr = ratSign(re), si = ratSign(im);
  if (si === 0) return sr > 0 ? "0" : "π";
  if (sr === 0) return si > 0 ? "π/2" : "−π/2";
  const r2 = ratMul(re, re), i2 = ratMul(im, im);
  let base: string | null = null; // the reference angle
  if (ratEq(r2, i2)) base = "π/4";
  else if (ratEq(i2, ratMul(ratInt(3), r2))) base = "π/3";
  else if (ratEq(r2, ratMul(ratInt(3), i2))) base = "π/6";
  if (!base) return null;
  const sixths: Record<string, number> = { "π/6": 1, "π/4": 1.5, "π/3": 2 };
  let k = sixths[base]; // in units of π/6
  if (sr < 0) k = 6 - k;
  if (si < 0) k = -k;
  const names: Record<string, string> = { "1": "π/6", "1.5": "π/4", "2": "π/3", "4": "2π/3", "4.5": "3π/4", "5": "5π/6", "-1": "−π/6", "-1.5": "−π/4", "-2": "−π/3", "-4": "−2π/3", "-4.5": "−3π/4", "-5": "−5π/6" };
  return names[String(k)] ?? null;
}

// ---------------------------------------------------------------------------
// Polynomials over G (for equations in one unknown).

type GPoly = G[]; // coefficient of z^k at index k
const pAdd = (a: GPoly, b: GPoly): GPoly => { const out: GPoly = []; for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(gAdd(a[i] ?? G_ZERO, b[i] ?? G_ZERO)); return pTrim(out); };
const pMul = (a: GPoly, b: GPoly): GPoly => { const out: GPoly = Array.from({ length: a.length + b.length - 1 || 1 }, () => G_ZERO); a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = gAdd(out[i + j], gMul(x, y)); })); return pTrim(out); };
const pTrim = (a: GPoly): GPoly => { const out = a.slice(); while (out.length > 1 && gIsZero(out[out.length - 1])) out.pop(); return out.length ? out : [G_ZERO]; };
const pScale = (a: GPoly, k: G): GPoly => pTrim(a.map((x) => gMul(x, k)));

function polyOver(e: Expr, z: string): GPoly {
  switch (e.t) {
    case "num": case "fn": return [exactValue(e)];
    case "var": return e.name === z ? [G_ZERO, G_ONE] : [exactValue(e)];
    case "neg": return pScale(polyOver(e.e, z), gNeg(G_ONE));
    case "add": return pAdd(polyOver(e.l, z), polyOver(e.r, z));
    case "sub": return pAdd(polyOver(e.l, z), pScale(polyOver(e.r, z), gNeg(G_ONE)));
    case "mul": return pMul(polyOver(e.l, z), polyOver(e.r, z));
    case "div": {
      const d = polyOver(e.r, z);
      if (d.length !== 1) throw new ComplexRefusal(`Dividing by an expression in ${z} is not a polynomial equation — multiply through first.`);
      return pScale(polyOver(e.l, z), gDiv(G_ONE, d[0]));
    }
    case "pow": {
      const b = polyOver(e.l, z);
      if (b.length === 1) return [exactValue(e)]; // (1+i)^100 is a coefficient, not a power of the unknown
      const k = exactValue(e.r);
      if (!ratIsZero(k.im) || k.re.d !== 1n || ratSign(k.re) < 0) throw new ComplexRefusal(`A power of ${z} must be a non-negative integer here.`);
      const n = Number(k.re.n);
      if (n > 64) throw new ComplexRefusal("Powers of the unknown are handled up to 64.");
      let r: GPoly = [G_ONE];
      for (let i = 0; i < n; i++) r = pMul(r, b);
      return r;
    }
  }
}

/** A numeric root with its multiplicity (a cluster of coincident roots is one entry). */
interface NumRoot { z: C; mult: number }

/** Durand–Kerner roots of a complex polynomial (numeric), Newton-polished;
 *  null when the iteration did not converge (never shown as an answer). */
function durandKerner(p: GPoly): NumRoot[] | null {
  const n = p.length - 1;
  const co = p.map(gToC);
  const lead = co[n];
  const a = co.map((x) => cDiv(x, lead));
  const evalAt = (z: C): C => { let r = c(0); for (let i = n; i >= 0; i--) r = cAdd(cMul(r, z), a[i]); return r; };
  const dEvalAt = (z: C): C => { let r = c(0); for (let i = n; i >= 1; i--) r = cAdd(cMul(r, z), cMul(a[i], c(i))); return r; };
  // Start on a circle of the Cauchy radius (every root lies inside it), with
  // an irrational phase offset so no start sits on a symmetry axis. The old
  // start, (0.4 + 0.9i)^k, shrinks geometrically and collapsed to NaN from
  // degree 39 on.
  const R = 2 * Math.max(...a.slice(0, n).map((ak, k) => Math.pow(cAbs(ak), 1 / (n - k)))) || 1;
  let roots: C[] = Array.from({ length: n }, (_, k) => { const th = (2 * Math.PI * k) / n + 0.4; return c(R * Math.cos(th), R * Math.sin(th)); });
  for (let it = 0; it < 1000; it++) {
    let delta = 0;
    const next = roots.map((zk, k) => {
      let denom = c(1);
      roots.forEach((zj, j) => { if (j !== k) denom = cMul(denom, cSub(zk, zj)); });
      if (cAbs(denom) === 0) return zk;
      const step = cDiv(evalAt(zk), denom);
      delta = Math.max(delta, cAbs(step));
      return cSub(zk, step);
    });
    roots = next;
    if (!Number.isFinite(delta)) return null;
    if (delta < 1e-14) break;
  }
  if (roots.some((z) => !Number.isFinite(z.re) || !Number.isFinite(z.im))) return null;
  roots = roots.map((z) => { for (let i = 0; i < 6; i++) { const d = dEvalAt(z); if (cAbs(d) === 0) break; const nz = cSub(z, cDiv(evalAt(z), d)); if (cAbs(evalAt(nz)) > cAbs(evalAt(z))) break; z = nz; } return z; });
  // Cluster coincident roots: a root of multiplicity m is found by the
  // iteration as m points on a tiny circle, each wrong from about the
  // (16/m)th figure. Their mean, polished by multiplicity-aware Newton
  // (z ← z − m·f/f′, quadratic at a multiple root), is the honest answer.
  const used = new Array<boolean>(n).fill(false);
  const out: NumRoot[] = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const cluster = [i];
    used[i] = true;
    for (let j = i + 1; j < n; j++) if (!used[j] && cAbs(cSub(roots[i], roots[j])) <= 1e-3 * Math.max(1, cAbs(roots[i]))) { cluster.push(j); used[j] = true; }
    const m = cluster.length;
    if (m === 1) { out.push({ z: roots[i], mult: 1 }); continue; }
    let z = c(cluster.reduce((s, k) => s + roots[k].re, 0) / m, cluster.reduce((s, k) => s + roots[k].im, 0) / m);
    for (let it = 0; it < 60; it++) {
      const d = dEvalAt(z);
      if (cAbs(d) === 0) break;
      const step = cMul(c(m), cDiv(evalAt(z), d));
      z = cSub(z, step);
      if (cAbs(step) < 1e-15 * Math.max(1, cAbs(z))) break;
    }
    out.push({ z, mult: m });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The front door.

/** Does the text use i as a unit? A bare word "i" next to digits, operators,
 *  parentheses or the end — never inside another identifier. */
const USES_I = /(?<![A-Za-z_])i(?![A-Za-z_(])/;

export function tryComplex(input: string): VerbResult | null {
  let text = input.trim().replace(/−/g, "-");
  if (!text || text.includes("\n")) return null;
  const vm = /^(simplify|expand|evaluate|compute|calculate|find)\s*:?\s+/i.exec(text);
  if (vm) text = text.slice(vm[0].length).trim();
  if (/[<>≤≥≠]/.test(text)) return null;
  const sides = text.split("=");
  if (sides.length > 2) return null;
  let exprs: Expr[];
  try {
    exprs = sides.map((s) => parseExpr(s.trim()));
  } catch {
    return null;
  }
  const vars = new Set<string>();
  for (const e of exprs) for (const v of freeVars(e)) vars.add(v);
  vars.delete("i");
  if (!USES_I.test(text)) {
    // Without an i, this layer claims only a constant expression the REAL
    // evaluator cannot value (sqrt(-4), (-8)^(1/3)) but complex arithmetic
    // can; everything else belongs to the solver (z² + 1 = 0 already gives
    // its complex roots there).
    if (sides.length !== 1 || vars.size) return null;
    // A real evaluator that throws (sqrt of a negative) has failed just as
    // surely as one that returns NaN.
    let realValue: number;
    try { realValue = evalAst(exprs[0], {}); } catch { realValue = NaN; }
    if (Number.isFinite(realValue)) return null;
    let cval: C;
    try { cval = evalComplex(exprs[0]); } catch { return null; }
    if (!Number.isFinite(cval.re) || !Number.isFinite(cval.im)) return null;
  }
  const refuse = (why: string): VerbResult => ({ title: `Complex: ${input.trim()}`, lines: [], caveats: [why] });
  try {
    return complexBody(input, text, sides, exprs, vars, refuse);
  } catch (err) {
    // Nothing escapes: an unsupported function, a size cap or a bigint
    // overflow is a refusal by name, never an internal error in the pane.
    if (err instanceof ComplexRefusal) return refuse(err.message);
    if (err instanceof RangeError) return refuse("The numbers outgrew what exact arithmetic can hold here.");
    return refuse(`Not evaluated: ${(err as Error).message}`);
  }
}

function complexBody(input: string, text: string, sides: string[], exprs: Expr[], vars: Set<string>, refuse: (why: string) => VerbResult): VerbResult | null {
  if (sides.length === 1) {
    if (vars.size) return null; // other symbols: not ours
    const e = exprs[0];
    scaleMax = 0;
    const numeric = evalComplex(e);
    const lines: VerbResult["lines"] = [];
    const caveats: string[] = [];
    let exact: G | null = null;
    try { exact = exactValue(e); } catch (err) { if (err instanceof ComplexRefusal) return refuse(err.message); if (!(err instanceof NotExact)) throw err; }
    // arg(w) and abs(w) of an exact w are real numbers that are usually NOT
    // Gaussian rationals (π/4, √2) — still exact, and shown as such rather
    // than falling to the numeric branch (which would also print the
    // argument OF the argument, a meaningless "arg z ≈ 0 rad").
    if (!exact && e.t === "fn" && (e.name === "arg" || e.name === "abs")) {
      let inner: G | null = null;
      try { inner = exactValue(e.arg); } catch (err) { if (err instanceof ComplexRefusal) return refuse(err.message); if (!(err instanceof NotExact)) throw err; }
      if (inner && e.name === "arg") {
        if (gIsZero(inner)) return refuse("arg(0) is undefined — zero has no direction.");
        const arg = exactArg(inner);
        if (arg) {
          lines.push({ text: `= ${arg}`, math: true });
          lines.push({ text: `Verified: floating-point evaluation of the original gives ${sig(numeric.re)}.` });
          caveats.push(`Exact: the argument of ${fmtG(inner)} is a multiple of π/6 or π/4, read from the exact ratio of imaginary to real part (principal value in (−π, π]).`);
          return { title: `Complex arithmetic: ${sides[0].trim()}`, lines, caveats };
        }
      }
      if (inner && e.name === "abs") {
        const norm = gNorm(inner);
        lines.push({ text: `= √(${fmtRatPlain(norm)})`, math: true });
        lines.push({ text: `≈ ${sig(numeric.re)}` });
        lines.push({ text: `Verified: floating-point evaluation of the original gives ${sig(numeric.re)}.` });
        caveats.push(`Exact: |a + bi| = √(a² + b²) with a² + b² = ${fmtRatPlain(norm)}, which is not a perfect square, so the surd is kept.`);
        return { title: `Complex arithmetic: ${sides[0].trim()}`, lines, caveats };
      }
    }
    if (exact) {
      lines.push({ text: `= ${fmtG(exact)}`, math: true });
      const num = gToC(exact);
      const tol = Math.max(1e-9 * Math.max(1, cAbs(num)), 1e-12 * scaleMax);
      const close = Math.hypot(num.re - numeric.re, num.im - numeric.im) <= tol;
      if (!Number.isFinite(numeric.re) || !Number.isFinite(numeric.im) || !Number.isFinite(cAbs(num))) {
        lines.push({ text: "Floating-point evaluation of the original overflows double precision, so there is no numeric cross-check; the exact arithmetic stands on its own." });
      } else if (!gIsZero(exact) && cAbs(num) < 1e-9) {
        lines.push({ text: `The value is below 1e-9 in magnitude (floating-point evaluation gives ${fmtC(numeric)}), too small for a meaningful numeric cross-check; the exact arithmetic stands on its own.` });
      } else if (close && tol > 1e-6) {
        lines.push({ text: `Floating-point evaluation of the original gives ${fmtC(numeric)}, agreeing within double precision (intermediate values reach ${sig(scaleMax, 3)}, which limits the check).` });
      } else if (close) {
        lines.push({ text: `Verified: floating-point evaluation of the original gives ${fmtC(numeric)}.` });
      } else if (Math.abs(cAbs(num) - cAbs(numeric)) <= tol && /sqrt|\^\s*\(?\s*[0-9]*\.|\^\s*\(\s*[0-9]+\s*\//.test(text)) {
        lines.push({ text: `Floating-point evaluation gives ${fmtC(numeric)}: the other branch of a square root (its branch cut lies along the negative real axis, where rounding can land on either side). The exact value is kept.` });
      } else {
        caveats.push(`CROSS-CHECK FAILED: floating evaluation gives ${fmtC(numeric)} — a defect in this tool.`);
      }
      if (!ratIsZero(exact.im) || ratSign(exact.re) < 0) {
        const norm = gNorm(exact);
        const r = ratSqrt(norm);
        lines.push({ text: `|z| = ${r ? fmtRatPlain(r) : `√(${fmtRatPlain(norm)}) ≈ ${sig(Math.sqrt(ratToNumber(norm)))}`}` });
        const arg = exactArg(exact);
        lines.push({ text: `arg z = ${arg ?? `≈ ${sig(Math.atan2(num.im, num.re), 8)} rad (${sig((Math.atan2(num.im, num.re) * 180) / Math.PI, 6)}°)`}` });
        lines.push({ text: `conj z = ${fmtG(gConj(exact))}` });
        if (r && arg) lines.push({ text: `Polar: ${fmtRatPlain(r)}·(cos(${arg}) + i·sin(${arg})) = ${fmtRatPlain(r)}·e^(i·${arg})`, math: true });
      }
      caveats.push("Exact in ℚ(i): a + b·i with rational a, b. Division multiplies by the conjugate; |z|² = a² + b².");
    } else {
      lines.push({ text: `≈ ${fmtC(numeric)}`, math: true });
      if (Math.abs(numeric.im) > 1e-12 * Math.max(1, cAbs(numeric))) lines.push({ text: `|z| ≈ ${sig(cAbs(numeric))}, arg z ≈ ${sig(Math.atan2(numeric.im, numeric.re), 8)} rad` });
      caveats.push("NUMERIC: the value involves a square root that is not a Gaussian rational, π, e, or a transcendental function, so it is evaluated in floating complex arithmetic (10 significant figures shown).");
    }
    return { title: `Complex arithmetic: ${sides[0].trim()}`, lines, caveats };
  }

  // An equation: exactly one unknown besides i.
  if (vars.size === 0) {
    // i^2 = -1, 2i = 4: a statement about constants — judged, with i as the unit.
    scaleMax = 0;
    const L = evalComplex(exprs[0]), R = evalComplex(exprs[1]);
    let le: G | null = null, re: G | null = null;
    try { le = exactValue(exprs[0]); re = exactValue(exprs[1]); } catch (err) { if (!(err instanceof NotExact)) throw err; }
    const same = le && re ? gEq(le, re) : Math.hypot(L.re - R.re, L.im - R.im) <= Math.max(1e-9 * Math.max(1, cAbs(L), cAbs(R)), 1e-12 * scaleMax);
    const show = (ex: G | null, nu: C): string => (ex ? fmtG(ex) : `≈ ${fmtC(nu)}`);
    return {
      title: `Complex: ${text}`,
      lines: [{ text: same ? `TRUE: both sides equal ${show(le, L)}.` : `FALSE: the left side is ${show(le, L)} and the right side is ${show(re, R)}.` }],
      caveats: ["There is no unknown here — i is the imaginary unit, so this is a statement about two complex numbers, judged by evaluating both sides. To solve for an unknown, use another letter (z)."],
    };
  }
  if (vars.size !== 1) return null;
  const z = [...vars][0];
  let poly: GPoly;
  try {
    poly = pAdd(polyOver(exprs[0], z), pScale(polyOver(exprs[1], z), gNeg(G_ONE)));
  } catch (err) {
    if (err instanceof ComplexRefusal) return refuse(err.message);
    if (err instanceof NotExact) return refuse(`The unknown ${z} must appear polynomially — not in an exponent, under abs/conj/sqrt or inside a function — and the coefficients must be exact complex numbers (a + b·i with rational a, b); π, e and roots that are not Gaussian rationals are not handled in equations.`);
    throw err;
  }
  const deg = poly.length - 1;
  const lines: VerbResult["lines"] = [];
  const caveats: string[] = [];
  const f: Expr = { t: "sub", l: exprs[0], r: exprs[1] };
  const verify = (roots: C[]): string => {
    let worst = 0, scale = 1;
    for (const r of roots) {
      scaleMax = 0;
      const v = evalComplex(f, { [z]: r });
      worst = Math.max(worst, cAbs(v));
      scale = Math.max(scale, scaleMax);
    }
    if (!Number.isFinite(worst)) return "The substitution check overflows double precision (the coefficients exceed 1e308 in floating point), so the roots rest on the exact arithmetic alone.";
    const tol = Math.max(1e-7, 1e-12 * scale);
    return worst <= tol ? `Verified: each root substituted back leaves |LHS − RHS| ≤ ${sig(worst, 2)}${tol > 1e-7 ? ` (against intermediate values of ${sig(scale, 3)})` : ""}.` : `CHECK: a substituted root leaves |LHS − RHS| = ${sig(worst, 3)} — treat as unverified.`;
  };
  const showNumeric = (roots: NumRoot[]): void => {
    for (const r of roots) {
      if (r.mult === 1) { lines.push({ text: `${z} ≈ ${fmtC(r.z)}`, math: true }); continue; }
      const digits = Math.max(3, Math.floor(15 / r.mult));
      lines.push({ text: `${z} ≈ ${fmtC(r.z, digits)}`, math: true });
      lines.push({ text: `  (a repeated root, multiplicity ${r.mult} — shown to ${digits} significant figures, the precision a root of that multiplicity allows in floating point; the iteration found ${r.mult} coincident roots and refined their mean by multiplicity-aware Newton steps)` });
    }
    lines.push({ text: verify(roots.map((r) => r.z)) });
  };
  const noConverge = (): VerbResult => refuse(`Degree ${deg}: the numeric root iteration did not converge for these coefficients, so no roots are shown — refused rather than guessed.`);
  const polish = (roots: NumRoot[]): NumRoot[] => roots.map((r) => {
    if (r.mult !== 1) return r;
    let zc = r.z;
    let fz = evalComplex(f, { [z]: zc });
    for (let it = 0; it < 25; it++) {
      const h = 1e-7 * Math.max(1, cAbs(zc));
      const d = cDiv(cSub(evalComplex(f, { [z]: cAdd(zc, c(h)) }), evalComplex(f, { [z]: cSub(zc, c(h)) })), c(2 * h));
      if (cAbs(d) === 0 || !Number.isFinite(d.re) || !Number.isFinite(d.im)) break;
      const nz = cSub(zc, cDiv(fz, d));
      const nf = evalComplex(f, { [z]: nz });
      if (!(cAbs(nf) < cAbs(fz))) break;
      zc = nz; fz = nf;
      if (cAbs(fz) === 0) break;
    }
    return { z: zc, mult: 1 };
  });
  if (deg === 0) {
    return { title: `Complex equation: ${text}`, lines: [{ text: gIsZero(poly[0]) ? `Every ${z} satisfies it (both sides are equal).` : "No solution: the sides differ by a non-zero constant." }], caveats };
  }
  if (deg === 1) {
    const root = gNeg(gDiv(poly[0], poly[1]));
    lines.push({ text: `${z} = ${fmtG(root)}`, math: true });
    lines.push({ text: verify([gToC(root)]) });
    caveats.push("Linear over ℂ: divide by the complex coefficient (multiply by its conjugate).");
    return { title: `Complex equation: ${text}`, lines, caveats };
  }
  if (deg === 2) {
    const [cc, b, a] = poly;
    const disc = gSub(gMul(b, b), gMul(gMul(ratToG(4), a), cc));
    const s = gSqrt(disc);
    if (s) {
      const r1 = gDiv(gAdd(gNeg(b), s), gMul(ratToG(2), a));
      const r2 = gDiv(gSub(gNeg(b), s), gMul(ratToG(2), a));
      lines.push({ text: `${z} = ${fmtG(r1)}`, math: true });
      if (!gEq(r1, r2)) lines.push({ text: `${z} = ${fmtG(r2)}`, math: true });
      else lines.push({ text: "(a repeated root)" });
      lines.push({ text: `Discriminant b² − 4ac = ${fmtG(disc)}, whose square root ${fmtG(s)} is exact in ℚ(i).` });
      lines.push({ text: verify([gToC(r1), gToC(r2)]) });
      caveats.push("Exact in ℚ(i) by the quadratic formula.");
    } else {
      const roots = durandKerner(poly);
      if (!roots) return noConverge();
      showNumeric(polish(roots));
      lines.push({ text: `Discriminant b² − 4ac = ${fmtG(disc)}: its square root is not a Gaussian rational, so the roots are numeric.` });
      caveats.push("NUMERIC roots (10 significant figures): the discriminant's square root is irrational.");
    }
    return { title: `Complex equation: ${text}`, lines, caveats };
  }
  if (deg > 64) return refuse("Degree above 64 is not handled.");
  const roots = durandKerner(poly);
  if (!roots) return noConverge();
  showNumeric(polish(roots));
  caveats.push(`Degree ${deg} over ℂ: all ${deg} roots by Durand–Kerner iteration, NUMERIC (10 significant figures), with multiplicity.`);
  return { title: `Complex equation: ${text}`, lines, caveats };
}

function ratToG(n: number): G { return g(ratInt(n)); }
