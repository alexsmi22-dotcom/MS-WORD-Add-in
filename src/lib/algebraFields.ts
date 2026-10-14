// 𝔽p[x] and GF(pᵏ) (v2.134.0, SCOPE-ABSTRACT-ALGEBRA §C.3–4), plus the small
// exact expression reader the ring, polynomial and field verbs share.
//
// The reader is our own (not solve.ts parseExpr): there `e` is Euler's
// number, `x(x+1)` is a function call and `F_2` a variable. Here an
// expression is integers, ONE-letter variables, + − * × · ^ and parentheses,
// with implicit multiplication (2x, (x+1)(x+2), 2(a+1)). Everything printed
// as a polynomial is re-read by this reader and compared before it is shown.
//
// 𝔽p[x] arithmetic is on number[] (low → high) with p ≤ 10⁶, so every
// product of two residues stays below 2⁵³ and exact. Irreducibility: trial
// division while p^⌊d/2⌋ ≤ 20 000 candidates, Rabin's test for d ≤ 30 —
// both when both are in range, and a disagreement is a refusal. Factoring:
// roots by evaluation (each divided out with its multiplicity), then trial
// division of the cofactor within the same cap — Berlekamp / Cantor–
// Zassenhaus are NOT here; beyond the cap irreducibility is still decided and
// factoring is refused by name.

import { DiscreteError } from "./discrete";

export const MAX_P = 1_000_000;
export const TRIAL_CAP = 20_000;
export const RABIN_MAX_DEGREE = 30;
export const MAX_POLY_DEGREE = 4096;
export const MAX_FIELD = 1024;
export const FULL_FIELD_CHECK = 64;
export const MAX_FACTOR_DEGREE = 2048;
export const ROOT_SCAN_BUDGET = 30_000_000;

// ---------------------------------------------------------------------------
// The expression reader

export type Ast =
  | { t: "num"; v: bigint }
  | { t: "var"; name: string }
  | { t: "neg"; a: Ast }
  | { t: "add" | "sub" | "mul" | "div"; a: Ast; b: Ast }
  | { t: "pow"; a: Ast; e: bigint };

type Tok = { k: "num"; v: bigint } | { k: "var"; v: string } | { k: "op"; v: string };

const MAX_EXPR_LEN = 2000;
/** Re-reading a PRINTED result (the display contract) may be longer than anything typed. */
export const MAX_PRINTED_LEN = 200_000;
const MAX_DEPTH = 100;

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j])) j++;
      if (j - i > 400) return null;
      out.push({ k: "num", v: BigInt(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-zα]/.test(c)) {
      if (i + 1 < s.length && /[A-Za-z0-9_]/.test(s[i + 1])) return null; // multi-letter names are not variables here
      out.push({ k: "var", v: c === "α" ? "a" : c });
      i++;
      continue;
    }
    if (c === "*" && s[i + 1] === "*") { out.push({ k: "op", v: "^" }); i += 2; continue; }
    if ("+-*^()/".includes(c)) { out.push({ k: "op", v: c }); i++; continue; }
    if (c === "÷") { out.push({ k: "op", v: "/" }); i++; continue; }
    if (c === "×" || c === "·" || c === "⋅") { out.push({ k: "op", v: "*" }); i++; continue; }
    if (c === "−" || c === "–") { out.push({ k: "op", v: "-" }); i++; continue; }
    return null;
  }
  return out;
}

/** Parses an expression; null when the text is not one (never throws for shape). */
export function parseAlgExpr(text: string, maxLen = MAX_EXPR_LEN): Ast | null {
  if (text.length > maxLen) return null;
  const toks = tokenize(text);
  if (!toks || !toks.length) return null;
  let i = 0;
  let depth = 0;
  const peek = (): Tok | undefined => toks[i];
  const isOp = (v: string): boolean => { const t = toks[i]; return !!t && t.k === "op" && t.v === v; };
  const fail = (): never => { throw new SyntaxError("parse"); };
  const expr = (): Ast => {
    if (++depth > MAX_DEPTH) fail();
    let a = term();
    while (isOp("+") || isOp("-")) {
      const o = (toks[i++] as { v: string }).v;
      const b = term();
      a = { t: o === "+" ? "add" : "sub", a, b };
    }
    depth--;
    return a;
  };
  const startsFactor = (): boolean => { const t = peek(); return !!t && (t.k === "num" || t.k === "var" || (t.k === "op" && t.v === "(")); };
  const term = (): Ast => {
    let a = unary();
    for (;;) {
      if (isOp("*")) { i++; a = { t: "mul", a, b: unary() }; continue; }
      if (isOp("/")) { i++; a = { t: "div", a, b: unary() }; continue; }
      // implicit multiplication: 2x, x(…), (…)(…), 2(…); never "x 2" (a number after a factor)
      const t = peek();
      if (t && startsFactor() && t.k !== "num") { a = { t: "mul", a, b: power() }; continue; }
      break;
    }
    return a;
  };
  const unary = (): Ast => {
    if (isOp("-")) { i++; return { t: "neg", a: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    return power();
  };
  const power = (): Ast => {
    const base = atom();
    if (isOp("^")) {
      i++;
      let neg = false;
      let paren = false;
      if (isOp("(")) { paren = true; i++; }
      if (isOp("-")) { neg = true; i++; }
      const t = peek();
      if (!t || t.k !== "num") fail();
      i++;
      if (paren) { if (!isOp(")")) fail(); i++; }
      const e = (t as { v: bigint }).v;
      return { t: "pow", a: base, e: neg ? -e : e };
    }
    return base;
  };
  const atom = (): Ast => {
    const t = peek();
    if (!t) return fail();
    if (t.k === "num") { i++; return { t: "num", v: t.v }; }
    if (t.k === "var") { i++; return { t: "var", name: t.v }; }
    if (t.v === "(") {
      i++;
      const a = expr();
      if (!isOp(")")) fail();
      i++;
      return a;
    }
    return fail();
  };
  try {
    const a = expr();
    if (i !== toks.length) return null;
    return a;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

export function freeVars(a: Ast, out = new Set<string>()): Set<string> {
  if (a.t === "var") out.add(a.name);
  else if (a.t === "neg") freeVars(a.a, out);
  else if (a.t === "pow") freeVars(a.a, out);
  else if (a.t !== "num") { freeVars(a.a, out); freeVars(a.b, out); }
  return out;
}

export function hasOperator(a: Ast): boolean {
  return a.t !== "num" && a.t !== "var";
}

const modB = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

export function egcdB(a: bigint, b: bigint): { g: bigint; s: bigint; t: bigint } {
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1n, 0n, 0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 < 0n) { r0 = -r0; s0 = -s0; t0 = -t0; }
  return { g: r0, s: s0, t: t0 };
}

export function invModB(a: bigint, m: bigint): bigint | null {
  const { g, s } = egcdB(modB(a, m), m);
  return g === 1n ? modB(s, m) : null;
}

/** Integer expression evaluated in ℤ/nℤ; a negative exponent is an inverse (DiscreteError when it does not exist). */
export function evalIntMod(a: Ast, n: bigint): bigint {
  switch (a.t) {
    case "num": return modB(a.v, n);
    case "var": throw new DiscreteError(`"${a.name}" is a variable — ring arithmetic in ℤ/${n}ℤ reads numbers only.`);
    case "neg": return modB(-evalIntMod(a.a, n), n);
    case "add": return modB(evalIntMod(a.a, n) + evalIntMod(a.b, n), n);
    case "sub": return modB(evalIntMod(a.a, n) - evalIntMod(a.b, n), n);
    case "mul": return modB(evalIntMod(a.a, n) * evalIntMod(a.b, n), n);
    case "div": {
      // a / b in ℤ/n is a · b⁻¹ (said by the callers).
      const b = evalIntMod(a.b, n);
      const iv = invModB(b, n);
      if (iv === null) throw new DiscreteError(`Division by ${b} is undefined in ℤ/${n}ℤ: gcd(${b}, ${n}) = ${egcdB(b, n).g} ≠ 1, so ${b} has no inverse.`);
      return modB(evalIntMod(a.a, n) * iv, n);
    }
    case "pow": {
      let b = evalIntMod(a.a, n);
      let e = a.e;
      if (e < 0n) {
        const iv = invModB(b, n);
        if (iv === null) throw new DiscreteError(`${b} has no inverse in ℤ/${n}ℤ: gcd(${b}, ${n}) = ${egcdB(b, n).g} ≠ 1, so ${b}^${e} is undefined there.`);
        b = iv;
        e = -e;
      }
      let r = modB(1n, n);
      while (e > 0n) { if (e & 1n) r = (r * b) % n; b = (b * b) % n; e >>= 1n; }
      return r;
    }
  }
}

/** The exact integer value, or null when it would be huge (more than ~2000 digits) or needs an inverse. */
export function evalIntExact(a: Ast): bigint | null {
  const LIM = 10n ** 2000n;
  const go = (x: Ast): bigint | null => {
    switch (x.t) {
      case "num": return x.v;
      case "var": return null;
      case "neg": { const v = go(x.a); return v === null ? null : -v; }
      case "add": case "sub": case "mul": {
        const u = go(x.a), v = go(x.b);
        if (u === null || v === null) return null;
        const r = x.t === "add" ? u + v : x.t === "sub" ? u - v : u * v;
        return r > LIM || r < -LIM ? null : r;
      }
      case "div": {
        const u = go(x.a), v = go(x.b);
        if (u === null || v === null || v === 0n || u % v !== 0n) return null;
        return u / v;
      }
      case "pow": {
        if (x.e < 0n) return null;
        const b = go(x.a);
        if (b === null) return null;
        const bits = b === 0n || b === 1n || b === -1n ? 1 : b.toString(2).length;
        if (x.e > 7000n || Number(x.e) * bits > 6700) return null;
        const r = b ** x.e;
        return r > LIM || r < -LIM ? null : r;
      }
    }
  };
  return go(a);
}

export type BPoly = bigint[];

/** A polynomial in v with coefficients reduced mod m (m ≥ 1; m = 0 keeps exact integers). Throws DiscreteError on a second variable or a degree above the cap. */
export function evalPolyMod(a: Ast, v: string, m: bigint): BPoly {
  const modB = (x: bigint, mm: bigint): bigint => (mm === 0n ? x : ((x % mm) + mm) % mm);
  const trim = (p: BPoly): BPoly => { while (p.length && p[p.length - 1] === 0n) p.pop(); return p; };
  const add = (p: BPoly, q: BPoly, s = 1n): BPoly => {
    const out: BPoly = [];
    for (let i = 0; i < Math.max(p.length, q.length); i++) out.push(modB((p[i] ?? 0n) + s * (q[i] ?? 0n), m));
    return trim(out);
  };
  const mul = (p: BPoly, q: BPoly): BPoly => {
    if (!p.length || !q.length) return [];
    if (p.length + q.length - 2 > MAX_POLY_DEGREE) throw new DiscreteError(`A polynomial of degree above ${MAX_POLY_DEGREE} is beyond the cap here.`);
    const out: BPoly = new Array(p.length + q.length - 1).fill(0n);
    const nzq: number[] = [];
    for (let j = 0; j < q.length; j++) if (q[j]) nzq.push(j);
    for (let i = 0; i < p.length; i++) if (p[i]) for (const j of nzq) out[i + j] = modB(out[i + j] + p[i] * q[j], m);
    return trim(out);
  };
  const go = (x: Ast): BPoly => {
    switch (x.t) {
      case "num": return trim([modB(x.v, m)]);
      case "var":
        if (x.name !== v) throw new DiscreteError(`The polynomial mixes the variables ${v} and ${x.name} — one variable is read.`);
        return trim([0n, modB(1n, m)]);
      case "neg": return add([], go(x.a), -1n);
      case "add": return add(go(x.a), go(x.b));
      case "sub": return add(go(x.a), go(x.b), -1n);
      case "mul": return mul(go(x.a), go(x.b));
      case "div": {
        const num = go(x.a), den = go(x.b);
        if (den.length !== 1) throw new DiscreteError(den.length ? "Dividing by a non-constant polynomial does not give a polynomial — use `f divided by g over F_p` for quotient and remainder." : "Division by zero.");
        const c = den[0];
        if (m === 0n) {
          if (!num.every((k) => k % c === 0n)) throw new DiscreteError("Over ℤ this division is not exact.");
          return trim(num.map((k) => k / c));
        }
        const iv = invModB(c, m);
        if (iv === null) throw new DiscreteError(`Division by ${c} is undefined mod ${m}: ${c} has no inverse.`);
        return trim(num.map((k) => modB(k * iv, m)));
      }
      case "pow": {
        if (x.e < 0n) throw new DiscreteError("A negative power is not a polynomial.");
        const base = go(x.a);
        const deg = base.length - 1;
        if (deg > 0 && x.e * BigInt(deg) > BigInt(MAX_POLY_DEGREE)) throw new DiscreteError(`(…)^${x.e} has degree above ${MAX_POLY_DEGREE} — beyond the cap here.`);
        let e = x.e;
        const powConst = (b0: bigint, e0: bigint): bigint => {
          let b = b0, ee = e0, r = modB(1n, m);
          if (m === 0n && ee > 4096n && b !== 0n && b !== 1n && b !== -1n) throw new DiscreteError(`A constant raised to ${ee} is beyond the exact cap here.`);
          while (ee > 0n) { if (ee & 1n) r = modB(r * b, m); b = modB(b * b, m); ee >>= 1n; }
          return r;
        };
        if (deg <= 0) return trim([powConst(base[0] ?? 0n, e)]);
        const nz = base.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
        if (nz.length === 1) {
          // A monomial c·x^d: (c x^d)^e = c^e x^(de) directly.
          const d = nz[0];
          const out: BPoly = new Array(Number(e) * d + 1).fill(0n);
          out[Number(e) * d] = powConst(base[d], e);
          return trim(out);
        }
        let r: BPoly = trim([modB(1n, m)]);
        let b = base;
        while (e > 0n) { if (e & 1n) r = mul(r, b); e >>= 1n; if (e > 0n) b = mul(b, b); }
        return r;
      }
    }
  };
  return go(a);
}

// ---------------------------------------------------------------------------
// Printing (the display contract: re-read before it is shown)

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number): string => String(n).split("").map((d) => SUP[Number(d)]).join("");

/** "x^3 + 2x^2 + x + 2" (ASCII) or with superscripts; coefficients are residues 0…m−1. The zero polynomial is "0". */
export function polyString(c: (number | bigint)[], v = "x", superscripts = false): string {
  let out = "";
  for (let i = c.length - 1; i >= 0; i--) {
    const a0 = BigInt(c[i]);
    if (a0 === 0n) continue;
    const neg = a0 < 0n;
    const a = neg ? -a0 : a0;
    const pw = i === 0 ? "" : i === 1 ? v : superscripts ? v + sup(i) : `${v}^${i}`;
    const co = a === 1n && i > 0 ? "" : String(a);
    out += out ? (neg ? " − " : " + ") : neg ? "−" : "";
    out += co + pw;
  }
  return out || "0";
}

/** A refusal never echoes a huge string: ~200 characters, then how long it was. */
export function clip(s: string, n = 200): string {
  return s.length <= n ? s : `${s.slice(0, n)}… (${s.length.toLocaleString("en-US")} characters)`;
}

/** Re-reads a printed polynomial (superscripts folded) and compares coefficients mod m; throws on a mismatch. */
export function assertPolyRoundTrip(printed: string, c: (number | bigint)[], m: bigint, v = "x"): void {
  const folded = printed.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (r) => "^" + [...r].map((ch) => SUP.indexOf(ch)).join(""));
  const ast = parseAlgExpr(folded, MAX_PRINTED_LEN);
  let ok = false;
  if (ast) {
    try {
      const back = evalPolyMod(ast, v, m);
      const want = c.map((x) => (m === 0n ? BigInt(x) : modB(BigInt(x), m)));
      while (want.length && want[want.length - 1] === 0n) want.pop();
      ok = back.length === want.length && back.every((x, i) => x === want[i]);
    } catch (err) {
      if (!(err instanceof DiscreteError)) throw err;
    }
  }
  if (!ok) throw new DiscreteError(`Display check failed: "${clip(printed)}" does not read back as the polynomial computed — a defect in this tool, so nothing is printed.`);
}

/** Prints and verifies in one step. */
export function showPoly(c: (number | bigint)[], m: bigint | number, v = "x", superscripts = false): string {
  const s = polyString(c, v, superscripts);
  assertPolyRoundTrip(s, c, BigInt(m), v);
  return s;
}

// ---------------------------------------------------------------------------
// 𝔽p[x] on number[]

export type P = number[];

export const ptrim = (a: P): P => { const b = a.slice(); while (b.length && b[b.length - 1] === 0) b.pop(); return b; };
export const pdeg = (a: P): number => ptrim(a).length - 1;

export function invModN(a: number, p: number): number {
  let [r0, r1, s0, s1] = [((a % p) + p) % p, p, 1, 0];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1) throw new DiscreteError(`${a} has no inverse mod ${p}.`);
  return ((s0 % p) + p) % p;
}

export function padd(a: P, b: P, p: number): P {
  const out: P = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(((a[i] ?? 0) + (b[i] ?? 0)) % p);
  return ptrim(out);
}
export function psub(a: P, b: P, p: number): P {
  const out: P = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push((((a[i] ?? 0) - (b[i] ?? 0)) % p + p) % p);
  return ptrim(out);
}
export function pmul(a: P, b: P, p: number): P {
  if (!a.length || !b.length) return [];
  const out: P = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    if (!ai) continue;
    for (let j = 0; j < b.length; j++) out[i + j] = (out[i + j] + ai * b[j]) % p;
  }
  return ptrim(out);
}
export function pscale(a: P, c: number, p: number): P {
  return ptrim(a.map((x) => (x * c) % p));
}
export function pdivmod(a: P, b: P, p: number): { q: P; r: P } {
  const B = ptrim(b);
  if (!B.length) throw new DiscreteError("Division by the zero polynomial.");
  let r = ptrim(a);
  const db = B.length - 1;
  const li = invModN(B[db], p);
  const q: P = new Array(Math.max(0, r.length - db)).fill(0);
  while (r.length - 1 >= db && r.length) {
    const shift = r.length - 1 - db;
    const c = (r[r.length - 1] * li) % p;
    q[shift] = c;
    for (let j = 0; j <= db; j++) r[shift + j] = ((r[shift + j] - c * B[j]) % p + p) % p;
    r = ptrim(r);
  }
  return { q: ptrim(q), r };
}
export function pmod(a: P, b: P, p: number): P { return pdivmod(a, b, p).r; }
export function pmonic(a: P, p: number): P {
  const A = ptrim(a);
  if (!A.length) return A;
  return pscale(A, invModN(A[A.length - 1], p), p);
}
export function pgcd(a: P, b: P, p: number): P {
  let [x, y] = [ptrim(a), ptrim(b)];
  while (y.length) [x, y] = [y, pmod(x, y, p)];
  return pmonic(x, p);
}
export const peq = (a: P, b: P): boolean => { const A = ptrim(a), B = ptrim(b); return A.length === B.length && A.every((x, i) => x === B[i]); };
export function peval(a: P, x: number, p: number): number {
  let r = 0;
  for (let i = a.length - 1; i >= 0; i--) r = (r * x + a[i]) % p;
  return r;
}
/** base^e mod f, e a bigint. */
export function ppowmod(base: P, e: bigint, f: P, p: number): P {
  let r: P = [1 % p];
  let b = pmod(base, f, p);
  while (e > 0n) {
    if (e & 1n) r = pmod(pmul(r, b, p), f, p);
    e >>= 1n;
    if (e > 0n) b = pmod(pmul(b, b, p), f, p);
  }
  return ptrim(r);
}

export interface EuclidResult { gcd: P; s: P; t: P; steps: { q: P; r: P }[] }

/** Extended Euclid: s·a + t·b = gcd (monic). Verified by re-evaluation. */
export function pegcd(a: P, b: P, p: number): EuclidResult {
  let [r0, r1] = [ptrim(a), ptrim(b)];
  let [s0, s1] = [[1] as P, [] as P];
  let [t0, t1] = [[] as P, [1] as P];
  const steps: { q: P; r: P }[] = [];
  while (r1.length) {
    const { q, r } = pdivmod(r0, r1, p);
    steps.push({ q, r });
    [r0, r1] = [r1, r];
    [s0, s1] = [s1, psub(s0, pmul(q, s1, p), p)];
    [t0, t1] = [t1, psub(t0, pmul(q, t1, p), p)];
  }
  if (!r0.length) return { gcd: [], s: [], t: [], steps };
  const li = invModN(r0[r0.length - 1], p);
  const out = { gcd: pscale(r0, li, p), s: pscale(s0, li, p), t: pscale(t0, li, p), steps };
  const check = padd(pmul(out.s, a, p), pmul(out.t, b, p), p);
  if (!peq(check, out.gcd)) throw new DiscreteError("Cross-check failed: the Bézout identity s·f + t·g = gcd does not hold — a defect in this tool.");
  return out;
}


/** All monic polynomials of degree k, in index order (lower coefficients as base-p digits, c₀ least significant). */
function* monicOfDegree(k: number, p: number): Generator<P> {
  const total = p ** k;
  for (let idx = 0; idx < total; idx++) {
    const c: P = new Array(k + 1).fill(0);
    let v = idx;
    for (let i = 0; i < k; i++) { c[i] = v % p; v = Math.floor(v / p); }
    c[k] = 1;
    yield c;
  }
}

export const trialCandidates = (d: number, p: number): number => p ** Math.floor(d / 2);

/** Trial division by every monic of degree 1…⌊d/2⌋. Caller checks the cap. */
export function trialIrreducible(f: P, p: number): { irreducible: boolean; divisor?: P; tried: number } {
  const d = pdeg(f);
  let tried = 0;
  for (let k = 1; 2 * k <= d; k++) {
    for (const g of monicOfDegree(k, p)) {
      tried++;
      if (!pmod(f, g, p).length) return { irreducible: false, divisor: g, tried };
    }
  }
  return { irreducible: true, tried };
}

function primeDivisors(n: number): number[] {
  const out: number[] = [];
  for (let q = 2; q * q <= n; q++) if (n % q === 0) { out.push(q); while (n % q === 0) n /= q; }
  if (n > 1) out.push(n);
  return out;
}

/** Rabin's test (d ≤ 30): x^(p^d) ≡ x mod f and gcd(x^(p^(d/q)) − x, f) = 1 for every prime q | d. */
export function rabinIrreducible(f0: P, p: number): boolean {
  const f = pmonic(f0, p);
  const d = pdeg(f);
  if (d < 1) return false;
  if (d === 1) return true;
  const X: P = [0, 1];
  const frob: P[] = [pmod(X, f, p)];
  for (let k = 1; k <= d; k++) frob.push(ppowmod(frob[k - 1], BigInt(p), f, p));
  if (!peq(frob[d], pmod(X, f, p))) return false;
  for (const q of primeDivisors(d)) {
    const g = pgcd(psub(frob[d / q], X, p), f, p);
    if (g.length !== 1) return false;
  }
  return true;
}

export interface IrreducibleVerdict {
  irreducible: boolean;
  methods: string[];
  divisor?: P;
}

/** Decides irreducibility of f over 𝔽p by every method in range; refuses when none is, or when two disagree. */
export function decideIrreducible(f0: P, p: number): IrreducibleVerdict {
  const f = ptrim(f0);
  const d = f.length - 1;
  if (d < 1) return { irreducible: false, methods: [d === 0 ? "a nonzero constant is a unit, not irreducible" : "the zero polynomial is not irreducible"] };
  if (d === 1) return { irreducible: true, methods: ["degree 1 — every linear polynomial is irreducible"] };
  const trialOk = trialCandidates(d, p) <= TRIAL_CAP;
  const rabinOk = d <= RABIN_MAX_DEGREE && p < MAX_P;
  if (!trialOk && !rabinOk) {
    throw new DiscreteError(`Irreducibility of a degree-${d} polynomial over 𝔽${sub(p)} is beyond both methods here: trial division needs ${p}^${Math.floor(d / 2)} candidates (cap ${TRIAL_CAP.toLocaleString("en-US")}) and Rabin's test is capped at degree ${RABIN_MAX_DEGREE}.`);
  }
  const methods: string[] = [];
  let verdict: boolean | null = null;
  let divisor: P | undefined;
  if (trialOk) {
    const t = trialIrreducible(f, p);
    verdict = t.irreducible;
    divisor = t.divisor;
    methods.push(`trial division by every monic polynomial of degree 1 to ${Math.floor(d / 2)} (${t.tried} tried${t.divisor ? ", stopped at the first divisor" : ""})`);
  }
  if (rabinOk) {
    const r = rabinIrreducible(f, p);
    methods.push(`Rabin's test (x^(p^${d}) ≡ x mod f, and gcd(x^(p^(${d}/q)) − x, f) = 1 for each prime q | ${d})`);
    if (verdict !== null && verdict !== r) throw new DiscreteError("Cross-check failed: trial division and Rabin's test disagree about irreducibility — a defect in this tool, so no verdict is printed.");
    verdict = r;
  }
  return { irreducible: verdict as boolean, methods, divisor };
}

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
export const sub = (n: number | string): string => String(n).split("").map((d) => SUBS[Number(d)] ?? d).join("");

export interface Factorisation {
  lead: number;
  factors: { f: P; e: number }[];
  method: string[];
}

/** Monic irreducible factors with multiplicity; cross-checked by multiplying back and by root counting. */
export function factorFp(f0: P, p: number): Factorisation {
  const f = ptrim(f0);
  const d = f.length - 1;
  if (d < 1) throw new DiscreteError("A constant has no factorisation into irreducibles (it is a unit or zero).");
  if (d > MAX_FACTOR_DEGREE) throw new DiscreteError(`Factoring is capped at degree ${MAX_FACTOR_DEGREE}.`);
  const lead = f[d];
  let g = pmonic(f, p);
  const factors: { f: P; e: number }[] = [];
  const method: string[] = [];
  // 1. Roots by evaluation, each divided out with its multiplicity.
  const scan = p * d <= ROOT_SCAN_BUDGET;
  const roots: number[] = [];
  if (scan) {
    for (let a = 0; a < p; a++) if (peval(g, a, p) === 0) roots.push(a);
    method.push(`roots by evaluating at all ${p} elements of 𝔽${sub(p)}: ${roots.length ? roots.join(", ") : "none"}`);
    for (const a of roots) {
      const lin: P = [(p - a) % p, 1];
      let e = 0;
      for (;;) {
        const { q, r } = pdivmod(g, lin, p);
        if (r.length) break;
        g = q;
        e++;
      }
      factors.push({ f: lin, e });
    }
  }
  // 2. The cofactor: trial division within the cap, else Rabin decides irreducibility.
  const dg = pdeg(g);
  if (dg >= 1) {
    const startK = scan ? 2 : 1;
    if (trialCandidates(dg, p) <= TRIAL_CAP) {
      let tried = 0;
      for (let k = startK; 2 * k <= pdeg(g); k++) {
        for (const h of monicOfDegree(k, p)) {
          tried++;
          let e = 0;
          for (;;) {
            const { q, r } = pdivmod(g, h, p);
            if (r.length) break;
            g = q;
            e++;
          }
          if (e) factors.push({ f: h, e });
          if (2 * k > pdeg(g)) break;
        }
      }
      method.push(`trial division of the ${scan && factors.length ? "remaining " : ""}degree-${dg} part by monic polynomials of degree ${startK} to ${Math.floor(dg / 2)} (${tried} tried; cap ${TRIAL_CAP.toLocaleString("en-US")} = p^⌊d/2⌋)`);
      if (pdeg(g) >= 1) factors.push({ f: g, e: 1 });
    } else {
      const v = decideIrreducible(g, p);
      if (!v.irreducible) {
        throw new DiscreteError(`Factoring over 𝔽${sub(p)} in degree ${dg} needs ${p}^${Math.floor(dg / 2)} trial divisors — above the cap of ${TRIAL_CAP.toLocaleString("en-US")}. Irreducibility is still decided: ${showPoly(g, p)} is REDUCIBLE (${v.methods.join("; ")}), but its factors are not computed here.`);
      }
      method.push(`the degree-${dg} part has no roots and is irreducible by ${v.methods.join(" and ")}`);
      factors.push({ f: g, e: 1 });
    }
  }
  // Cross-checks: multiply back; distinct linear factors = distinct roots by a fresh evaluation of f.
  let prod: P = [lead];
  for (const { f: h, e } of factors) for (let k = 0; k < e; k++) prod = pmul(prod, h, p);
  if (!peq(prod, f)) throw new DiscreteError("Cross-check failed: the factors do not multiply back to the polynomial — a defect in this tool.");
  if (scan) {
    const fresh: number[] = [];
    for (let a = 0; a < p; a++) if (peval(f, a, p) === 0) fresh.push(a);
    const linRoots = factors.filter((x) => x.f.length === 2).map((x) => (p - x.f[0]) % p).sort((a, b) => a - b);
    if (fresh.join(",") !== linRoots.join(",")) throw new DiscreteError("Cross-check failed: the linear factors do not match the roots by evaluation — a defect in this tool.");
    for (const { f: h } of factors) if (h.length > 2 && (h.length - 1) <= 3) {
      for (let a = 0; a < p; a++) if (peval(h, a, p) === 0) throw new DiscreteError("Cross-check failed: a factor of degree 2 or 3 has a root, so it is not irreducible — a defect in this tool.");
    }
  }
  factors.sort((x, y) => x.f.length - y.f.length || (x.f.slice().reverse().join(",") < y.f.slice().reverse().join(",") ? -1 : 1));
  return { lead, factors, method };
}

/** "(x + 1)^2(x^2 + x + 1)" with an optional leading constant. */
export function factorString(fz: Factorisation, p: number, v = "x", superscripts = false): string {
  // A multi-term factor is parenthesised; the only single-term monic
  // irreducible is x itself, so juxtaposition always reads back ("2x(x + 1)^2").
  const parts = fz.factors.map(({ f, e }) => {
    const s = showPoly(f, p, v, superscripts);
    const many = f.filter((c) => c !== 0).length > 1;
    const base = many ? `(${s})` : s;
    return e > 1 ? `${base}${superscripts ? sup(e) : "^" + e}` : base;
  });
  return (fz.lead !== 1 ? String(fz.lead) : "") + parts.join("");
}

// ---------------------------------------------------------------------------
// GF(pᵏ) = 𝔽p[x]/(f)

export interface GField {
  p: number;
  k: number;
  q: number;
  /** Monic irreducible modulus of degree k (low → high). */
  mod: P;
  /** exp[i] = g^i for a primitive element g (index form); log[x] for x ≠ 0. */
  exp: Int32Array;
  log: Int32Array;
  g: number;
  /** The modulus was chosen by the engine (first irreducible monic), not given. */
  chosen: boolean;
  fullCheck: boolean;
}

export const elemPoly = (F: { p: number; k: number }, x: number): P => {
  const c: P = [];
  for (let i = 0; i < F.k; i++) { c.push(x % F.p); x = Math.floor(x / F.p); }
  return ptrim(c);
};
export const polyElem = (F: { p: number; k: number }, c: P): number => {
  let x = 0;
  for (let i = Math.min(c.length, F.k) - 1; i >= 0; i--) x = x * F.p + (c[i] ?? 0);
  return x;
};

export function gfAdd(F: GField, a: number, b: number): number {
  let x = 0, mult = 1;
  for (let i = 0; i < F.k; i++) { x += (((a % F.p) + (b % F.p)) % F.p) * mult; a = Math.floor(a / F.p); b = Math.floor(b / F.p); mult *= F.p; }
  return x;
}
export function gfNeg(F: GField, a: number): number {
  let x = 0, mult = 1;
  for (let i = 0; i < F.k; i++) { x += ((F.p - (a % F.p)) % F.p) * mult; a = Math.floor(a / F.p); mult *= F.p; }
  return x;
}
export function gfMul(F: GField, a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return F.exp[(F.log[a] + F.log[b]) % (F.q - 1)];
}
/** Multiplication by polynomial arithmetic, independent of the log tables (the cross-check). */
export function gfMulDirect(F: { p: number; k: number; mod: P }, a: number, b: number): number {
  return polyElem(F, pmod(pmul(elemPoly(F, a), elemPoly(F, b), F.p), F.mod, F.p));
}
export function gfInv(F: GField, a: number): number {
  if (a === 0) throw new DiscreteError("0 has no multiplicative inverse in a field.");
  return F.exp[(F.q - 1 - F.log[a]) % (F.q - 1)];
}
export function gfPow(F: GField, a: number, e: number): number {
  if (a === 0) return e === 0 ? 1 : 0;
  const m = F.q - 1;
  return F.exp[(((F.log[a] * (e % m)) % m) + m) % m];
}
export function gfOrder(F: GField, a: number): number {
  if (a === 0) throw new DiscreteError("0 has no multiplicative order.");
  const m = F.q - 1;
  const l = F.log[a];
  let g = m, x = l;
  while (x) [g, x] = [x, g % x];
  return m / g;
}

/** The first irreducible monic of degree k over 𝔽p, in index order (c₀ least significant). */
export function firstIrreducible(p: number, k: number): P {
  for (const c of monicOfDegree(k, p)) if (k === 1 ? true : rabinIrreducible(c, p)) return k === 1 ? [0, 1] : c;
  throw new DiscreteError(`No irreducible polynomial of degree ${k} over 𝔽${sub(p)} was found — a defect in this tool.`);
}

export function isPrimeN(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

/** q = p^k with p prime, or null. */
export function primePower(q: number): { p: number; k: number } | null {
  if (q < 2) return null;
  let p = 0;
  for (let d = 2; d * d <= q; d++) if (q % d === 0) { p = d; break; }
  if (!p) return { p: q, k: 1 };
  let k = 0, x = q;
  while (x % p === 0) { x /= p; k++; }
  return x === 1 ? { p, k } : null;
}

/** Builds GF(p^k) from a monic modulus (checked irreducible, refused naming a factor) or the first irreducible. */
export function buildField(p: number, k: number, given?: P): GField {
  const q = p ** k;
  if (q > MAX_FIELD) throw new DiscreteError(`GF(${q}) is above the cap q ≤ ${MAX_FIELD} (element lists and orders).`);
  let mod: P;
  let chosen = false;
  if (given) {
    mod = pmonic(given, p);
    if (pdeg(mod) !== k) throw new DiscreteError(`The modulus ${showPoly(given, p)} has degree ${pdeg(given)}, so 𝔽${sub(p)}[x]/(…) has ${p}^${pdeg(given)} elements, not ${q}.`);
    if (k > 1) {
      const v = decideIrreducible(mod, p);
      if (!v.irreducible) {
        const fz = factorFp(mod, p);
        throw new DiscreteError(`${showPoly(mod, p)} is reducible over 𝔽${sub(p)}: ${showPoly(mod, p)} = ${factorString(fz, p)} — so 𝔽${sub(p)}[x]/(${showPoly(mod, p)}) has zero divisors and is not a field. Choose an irreducible modulus.`);
      }
    }
  } else {
    mod = firstIrreducible(p, k);
    chosen = true;
  }
  const Fb = { p, k, mod };
  // A primitive element: the first g whose powers g^((q−1)/r) ≠ 1 for every prime r | q − 1.
  const m = q - 1;
  const rs = primeDivisors(m);
  const powIdx = (a: number, e: number): number => {
    let r = 1, b = a, x = e;
    while (x > 0) { if (x & 1) r = gfMulDirect(Fb, r, b); b = gfMulDirect(Fb, b, b); x = Math.floor(x / 2); }
    return r;
  };
  let g = -1;
  for (let a = 1; a < q && g < 0; a++) if (m === 1 ? a === 1 : rs.every((r) => powIdx(a, m / r) !== 1)) g = a;
  if (g < 0) throw new DiscreteError("No primitive element found — a defect in this tool.");
  const exp = new Int32Array(m);
  const log = new Int32Array(q).fill(-1);
  let x = 1;
  for (let i = 0; i < m; i++) {
    if (log[x] !== -1) throw new DiscreteError("Cross-check failed: the powers of the primitive element repeat early — a defect in this tool.");
    exp[i] = x;
    log[x] = i;
    x = gfMulDirect(Fb, x, g);
  }
  if (x !== 1) throw new DiscreteError("Cross-check failed: g^(q−1) ≠ 1 — a defect in this tool.");
  const F: GField = { p, k, q, mod, exp, log, g, chosen, fullCheck: q <= FULL_FIELD_CHECK };
  checkField(F);
  return F;
}

/** Brute-force field axioms: full for q ≤ 64 (every pair and triple), a fixed deterministic sample of 10⁴ triples beyond. */
export function checkField(F: GField): void {
  const q = F.q;
  const fail = (what: string): never => { throw new DiscreteError(`Cross-check failed: GF(${q}) ${what} — a defect in this tool.`); };
  const triples: [number, number, number][] = [];
  if (q <= FULL_FIELD_CHECK) {
    for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) {
      if (gfMul(F, a, b) !== gfMulDirect(F, a, b)) fail("log-table and polynomial products disagree");
      for (let c = 0; c < q; c++) triples.push([a, b, c]);
    }
  } else {
    let s = 12345;
    const rnd = (): number => { s = (s * 1103515245 + 12345) % 2147483648; return s % q; };
    for (let t = 0; t < 10_000; t++) {
      const a = rnd(), b = rnd(), c = rnd();
      if (gfMul(F, a, b) !== gfMulDirect(F, a, b)) fail("log-table and polynomial products disagree");
      triples.push([a, b, c]);
    }
  }
  for (const [a, b, c] of triples) {
    if (gfMul(F, a, gfAdd(F, b, c)) !== gfAdd(F, gfMul(F, a, b), gfMul(F, a, c))) fail("fails distributivity");
    if (gfMul(F, gfMul(F, a, b), c) !== gfMul(F, a, gfMul(F, b, c))) fail("fails associativity of ×");
  }
  for (let a = 1; a < q; a++) if (gfMul(F, a, gfInv(F, a)) !== 1) fail(`has no inverse for element ${a}`);
}

/** Minimal polynomial over 𝔽p of the element β, by its Frobenius conjugates; coefficients asserted in 𝔽p, verified two ways. */
export function minimalPolynomial(F: GField, beta: number): { poly: P; conjugates: number[] } {
  const conj: number[] = [beta];
  for (;;) {
    const nx = gfPow(F, conj[conj.length - 1], F.p);
    if (nx === beta) break;
    conj.push(nx);
    if (conj.length > F.k) throw new DiscreteError("Cross-check failed: more than k conjugates — a defect in this tool.");
  }
  // ∏ (x − c) expanded in the field: coefficients as field elements (low → high).
  let poly: number[] = [1];
  for (const c of conj) {
    const nc = gfNeg(F, c);
    const out = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      out[i + 1] = gfAdd(F, out[i + 1], poly[i]);
      out[i] = gfAdd(F, out[i], gfMul(F, poly[i], nc));
    }
    poly = out;
  }
  if (poly.some((c) => c >= F.p)) throw new DiscreteError("Cross-check failed: the minimal polynomial has a coefficient outside 𝔽p — a defect in this tool.");
  const mp = ptrim(poly);
  // Verified: evaluates to 0 at β in the field, and divides x^q − x over 𝔽p.
  let v = 0;
  for (let i = mp.length - 1; i >= 0; i--) v = gfAdd(F, gfMul(F, v, beta), mp[i]);
  if (v !== 0) throw new DiscreteError("Cross-check failed: the minimal polynomial does not vanish at the element — a defect in this tool.");
  const xq: P = new Array(F.q + 1).fill(0);
  xq[F.q] = 1;
  xq[1] = (F.p - 1) % F.p;
  if (pmod(xq, mp, F.p).length) throw new DiscreteError("Cross-check failed: the minimal polynomial does not divide x^q − x — a defect in this tool.");
  return { poly: mp, conjugates: conj };
}

/** An expression evaluated IN the field (a = the class of x): inverses, division and negative powers allowed. */
export function evalField(F: GField, ast: Ast): number {
  const go = (x: Ast): number => {
    switch (x.t) {
      case "num": return Number(((x.v % BigInt(F.p)) + BigInt(F.p)) % BigInt(F.p));
      case "var":
        if (F.k === 1) throw new DiscreteError(`GF(${F.p}) = ℤ/${F.p}ℤ has no element named ${x.name}; its elements are 0…${F.p - 1}.`);
        if (x.name !== "a" && x.name !== "x") throw new DiscreteError(`Elements of GF(${F.q}) are written in a (the class of x), not ${x.name}.`);
        return F.p; // the index of the class of x
      case "neg": return gfNeg(F, go(x.a));
      case "add": return gfAdd(F, go(x.a), go(x.b));
      case "sub": return gfAdd(F, go(x.a), gfNeg(F, go(x.b)));
      case "mul": return gfMul(F, go(x.a), go(x.b));
      case "div": return gfMul(F, go(x.a), gfInv(F, go(x.b)));
      case "pow": {
        const b = go(x.a);
        const m = BigInt(F.q - 1);
        if (b === 0) { if (x.e < 0n) throw new DiscreteError("0 has no multiplicative inverse in a field."); return x.e === 0n ? 1 : 0; }
        return gfPow(F, b, Number(((x.e % m) + m) % m));
      }
    }
  };
  return go(ast);
}

/** Element name in a: "2a + 1", "a^2 + a + 1"; verified to read back. */
export function elemName(F: { p: number; k: number }, x: number, superscripts = false): string {
  const c = elemPoly(F, x);
  return showPoly(c, F.p, "a", superscripts);
}
