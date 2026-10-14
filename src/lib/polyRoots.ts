// EXACT ROOTS OF A RATIONAL POLYNOMIAL — every degree that factors, and the
// closed forms through the quartic, each one CERTIFIED before it is printed.
//
// Why this exists (docs/SCOPE-SYMBOLIC-BATCH.md §A finding 1, §B1). Above the
// quadratic, Solve handed every polynomial to Durand–Kerner, and Durand–Kerner
// cannot resolve a repeated root: `(x-1)^4 = 0` came back as four DIFFERENT
// complex numbers near 1 — "1.000040832 + 0.000007296i …" — under the method
// line "Complete: every root is shown". More iterations do not help (mpmath's
// polyroots fails the same inputs). A repeated root is an ALGEBRAIC fact, and the
// cure is algebraic: the square-free factorisation gcd(p, p′) over ℚ gives every
// multiplicity exactly, so the numerical stage only ever sees simple roots.
//
// The pipeline:
//   1. caps (degree, coefficient size) BEFORE any work;
//   2. Yun's square-free factorisation over ℚ — exact multiplicities;
//   3. the rational-root test on each square-free factor;
//   4. what is left, piece by piece:
//        degree 2  — the quadratic formula;
//        degree 3  — a binomial t³ = c, Cardano with REAL radicals when there is
//                    one real root, the TRIGONOMETRIC form when there are three
//                    (never a complex-radical expression for a real root);
//        degree 4  — a split into two rational quadratics if one exists, then a
//                    binomial, a biquadratic (with denesting), or Ferrari when the
//                    resolvent cubic has a rational root; otherwise numerical,
//                    with the reason said;
//        degree ≥ 5 — numerical, with Abel–Ruffini stated GENERALLY (this
//                    polynomial was not tested for solvability by radicals).
//   5. every exact form is CERTIFIED exactly (the identities below are checked in
//      ℚ or in ℚ(√s), never in floating point), then its DISPLAY string is
//      re-parsed through the Solve grammar and must agree with the
//      Newton-polished numerical root to 1e-9. Any failure withholds the form.
//
// The certificates are this module's own small ℚ(√s) arithmetic over cas.ts's
// exact Rat. They deliberately do NOT run the displayed expression through
// casSimplify/exprEqual: cas.ts folds sqrt(2) and cbrt(2) of constants into
// 53-bit rationals (§A finding 2, §E.5), so it can neither prove nor refute a
// radical identity. An exact identity in ℚ(√s) is a proof; a double-precision
// agreement is only the cross-check, and is never called exact on its own.
//
// `re`/`im` on every root come from the Newton-polished numerical root of the
// square-free factor, never from evaluating the closed form: the small root of
// x³ − 1234567x + 1 is 2·√(1234567/3)·cos(φ) with cos φ ≈ 6e-10, and evaluating
// that in double precision loses seven digits. The closed form is what is SHOWN;
// the polished root is what is PLOTTED and compared.

import {
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratSign, ratToNumber, ratEq,
  ratPolyTrim, ratPolyMul, ratPolyDivMod, ratPolyAdd, ratPolyScale,
  RAT_ZERO, RAT_ONE,
} from "./cas";
// A runtime import cycle with solve.ts (which imports this module). It is used
// only INSIDE function bodies, at call time, when both modules have finished
// loading — the same arrangement cas.ts ↔ solve.ts already relies on.
import { parseExpr, evalAst } from "./solve";

// ---------------------------------------------------------------------------
// Public API (frozen, §C day 0)
// ---------------------------------------------------------------------------

export interface PolyRoot {
  /** The root in Solve grammar, WITHOUT a multiplicity suffix (see `mult`). */
  display: string;
  /** Full double precision, from the Newton-polished root — not the closed form. */
  re: number;
  im: number;
  /** True only when `display` is an exact form that passed its certificate. */
  exact: boolean;
  mult: number;
  /** What proved it ("rational-root test", "Cardano identities in ℚ(√s)", …). */
  certificate: string;
}

export interface ExactPolyRootsResult {
  roots: PolyRoot[];
  method: string;
  steps: string[];
  caveats: string[];
  /**
   * True when the rational-root search was capped, so no claim of
   * irreducibility over ℚ is made for what remained.
   */
  incomplete: boolean;
}

// ---------------------------------------------------------------------------
// Caps — checked BEFORE any work, each one a named outcome
// ---------------------------------------------------------------------------

/** Above this degree the square-free step is not attempted (null → caller's path). */
const MAX_DEGREE = 64;
/** Integer-scaled coefficient size above which nothing exact is attempted. */
const MAX_COEFF_BITS = 1024;
/** Cardano / trigonometric / Ferrari / biquadratic operands (§E.18). */
const FORMULA_BITS = 64;
/** Display cap for one root (§E.9). Never truncated — a decimal is shown instead. */
const POLY_EXACT_DISPLAY_MAX = 120;
/** Real-root counting by Sturm sequence is exact; above this degree it is skipped. */
const STURM_MAX_DEGREE = 24;
/** Backstop: a clamp that bounds memory does not bound time. */
const TIME_BUDGET_MS = 1500;
/** The numerical cross-check (§B1 b). */
const AGREE_TOL = 1e-9;

class PolyBail extends Error {}

// ---------------------------------------------------------------------------
// BigInt and Rat helpers
// ---------------------------------------------------------------------------

type P = Rat[]; // ascending coefficients

const babs = (v: bigint): bigint => (v < 0n ? -v : v);
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}
const bitLen = (v: bigint): number => (v === 0n ? 0 : babs(v).toString(2).length);
const R = (n: number | bigint, d: number | bigint = 1): Rat => ratMake(BigInt(n), BigInt(d));
const ratAbs = (r: Rat): Rat => (ratSign(r) < 0 ? ratNeg(r) : r);
const fmtRat = (r: Rat): string => (r.d === 1n ? `${r.n}` : `${r.n}/${r.d}`);

/** floor(v^(1/k)) for v ≥ 0, by bisection on bit length (exact). */
function iroot(v: bigint, k: number): bigint {
  if (v < 2n) return v;
  const K = BigInt(k);
  let lo = 0n;
  let hi = 1n << BigInt(Math.ceil(bitLen(v) / k) + 1);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid ** K <= v) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** v = out^k · rest, pulling k-th powers out by trial division (bounded) and a final exact check. */
function splitPow(v: bigint, k: number): { out: bigint; rest: bigint } {
  let rest = babs(v);
  let out = 1n;
  if (rest === 0n) return { out: 0n, rest: 1n };
  const K = BigInt(k);
  for (let p = 2n; p ** K <= rest && p < 20000n; p += p === 2n ? 1n : 2n) {
    const pk = p ** K;
    while (rest % pk === 0n) { rest /= pk; out *= p; }
  }
  const r = iroot(rest, k);
  if (r ** K === rest) { out *= r; rest = 1n; }
  if (out ** K * rest !== babs(v)) throw new PolyBail("power split failed its own check");
  return { out, rest };
}

/** Exact rational square root, or null. */
function ratSqrtExact(r: Rat): Rat | null {
  if (ratSign(r) < 0) return null;
  const a = iroot(r.n, 2), b = iroot(r.d, 2);
  return a * a === r.n && b * b === r.d ? ratMake(a, b) : null;
}

// ---------------------------------------------------------------------------
// Polynomial helpers over ℚ
// ---------------------------------------------------------------------------

const pdeg = (p: P): number => p.length - 1;
function monic(p: P): P {
  const t = ratPolyTrim(p);
  const lead = t[t.length - 1];
  return t.map((c) => ratDiv(c, lead));
}
function pderiv(p: P): P {
  const out: P = [];
  for (let k = 1; k < p.length; k++) out.push(ratMul(p[k], ratInt(k)));
  return ratPolyTrim(out);
}
const psub = (a: P, b: P): P => ratPolyAdd(a, ratPolyScale(b, ratInt(-1)));
function pEq(a: P, b: P): boolean {
  const x = ratPolyTrim(a), y = ratPolyTrim(b);
  return x.length === y.length && x.every((c, k) => ratEq(c, y[k]));
}

interface Clock { deadline: number }
function tick(clock: Clock): void {
  if (Date.now() > clock.deadline) throw new PolyBail("time budget");
}

/** Monic gcd over ℚ by Euclid, remainders made monic each step to bound growth. */
function pgcd(a: P, b: P, clock: Clock): P {
  let x = ratPolyTrim(a), y = ratPolyTrim(b);
  if (!y.length) return x.length ? monic(x) : [];
  if (!x.length) return monic(y);
  // PRIMITIVE remainders (coprime integers), not monic ones: a monic remainder
  // carries its leading coefficient into every denominator and the next step
  // multiplies them up — the classic coefficient explosion of Euclid over ℚ.
  // Pure BigInt pseudo-remainders: Rat arithmetic normalises every product by a
  // gcd, and that alone was ~95% of a dense degree-60 gcd's time.
  const toInts = (q: P): bigint[] => primitive(q).map((c) => c.n);
  const primInts = (v: bigint[]): bigint[] => {
    let g = 0n;
    for (const c of v) g = bgcd(g, c);
    if (g === 0n) return [];
    if (v[v.length - 1] < 0n) g = -g;
    return v.map((c) => c / g);
  };
  let xi = toInts(x), yi = toInts(y);
  while (yi.length) {
    tick(clock);
    // prem(xi, yi): r ← lc(y)·r − lc(r)·x^k·y until deg r < deg y.
    let r = xi.slice();
    const ly = yi[yi.length - 1];
    while (r.length >= yi.length) {
      const lr = r[r.length - 1];
      const k = r.length - yi.length;
      const next = r.map((c) => c * ly);
      for (let j = 0; j < yi.length; j++) next[k + j] -= lr * yi[j];
      next.pop(); // the leading term cancels exactly
      while (next.length && next[next.length - 1] === 0n) next.pop();
      r = next;
    }
    xi = yi;
    yi = primInts(r);
  }
  return monic(xi.map((c) => ratInt(c)));
}

function pdivExact(a: P, b: P): P {
  const { q, r } = ratPolyDivMod(a, b);
  if (r.length) throw new PolyBail("inexact division");
  return q;
}

/**
 * A SOUND fast test that f is square-free: gcd(f, f′) computed mod a prime p
 * that does not divide f's leading coefficient. Any common factor g over ℚ
 * (taken primitive over ℤ) divides both mod p with its degree intact, because
 * lc(g) | lc(f); so a constant gcd mod p PROVES gcd over ℚ is constant. A
 * non-constant gcd mod p proves nothing (p may be unlucky) — then Yun runs.
 *
 * Why: the exact Euclid over ℚ on a dense degree-60 polynomial with 30-bit
 * coefficients took ~1.4 s, and almost every polynomial anyone types is
 * square-free. p < 2²⁶, so every product fits a double exactly.
 */
function squareFreeModP(f: P): boolean {
  let lcm = 1n;
  for (const c of f) lcm = (lcm / bgcd(lcm, c.d)) * c.d;
  const ints = f.map((c) => (c.n * lcm) / c.d);
  for (const p of [67108859, 67108837, 67108819]) {
    const P_ = BigInt(p);
    const fm = ints.map((v) => Number(((v % P_) + P_) % P_));
    if (fm[fm.length - 1] === 0) continue;
    const dm: number[] = [];
    for (let k = 1; k < fm.length; k++) dm.push((fm[k] * (k % p)) % p);
    const g = gcdModP(fm, dm, p);
    if (g === null) continue;
    return g === 0;
  }
  return false;
}

/** Degree of gcd(a, b) over 𝔽_p (null when b ≡ 0, which proves nothing). */
function gcdModP(a0: number[], b0: number[], p: number): number | null {
  const trim = (v: number[]): number[] => { const o = v.slice(); while (o.length && o[o.length - 1] === 0) o.pop(); return o; };
  const inv = (x: number): number => {
    let [r0, r1, s0, s1] = [p, x % p, 0, 1];
    while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return ((s0 % p) + p) % p;
  };
  const mulmod = (x: number, y: number): number => Number((BigInt(x) * BigInt(y)) % BigInt(p));
  let a = trim(a0), b = trim(b0);
  if (!b.length) return null;
  while (b.length) {
    // a mod b
    const ib = inv(b[b.length - 1]);
    while (a.length >= b.length) {
      const f = mulmod(a[a.length - 1], ib);
      const shift = a.length - b.length;
      for (let k = 0; k < b.length; k++) a[shift + k] = ((a[shift + k] - mulmod(f, b[k])) % p + p) % p;
      a = trim(a);
      if (!a.length) break;
    }
    [a, b] = [b, a];
  }
  return a.length - 1;
}

/** Yun's square-free factorisation of a monic polynomial: Π factorᵢ^multᵢ. */
function yun(f: P, clock: Clock): { factor: P; mult: number }[] {
  if (squareFreeModP(f)) return [{ factor: f, mult: 1 }];
  const out: { factor: P; mult: number }[] = [];
  const fp = pderiv(f);
  const a = pgcd(f, fp, clock);
  let b = pdivExact(f, a);
  let c = pdivExact(fp, a);
  let d = psub(c, pderiv(b));
  let i = 1;
  while (pdeg(b) > 0) {
    tick(clock);
    const g = d.length ? pgcd(b, d, clock) : monic(b);
    if (pdeg(g) > 0) out.push({ factor: g, mult: i });
    b = pdivExact(b, g);
    c = pdivExact(d, g);
    d = psub(c, pderiv(b));
    i++;
    if (i > MAX_DEGREE + 2) throw new PolyBail("Yun did not terminate");
  }
  return out;
}

/** Number of distinct real roots of a square-free polynomial (Sturm), or null if too large. */
function sturmRealCount(p: P, clock: Clock): number | null {
  if (pdeg(p) > STURM_MAX_DEGREE) return null;
  // BigInt pseudo-remainders with the SIGN kept: rem(a, b) over ℚ equals
  // prem(a, b) / lc(b)^(δ+1), so prem's sign flips when lc(b) < 0 and δ+1 is odd.
  // Each member is divided by its POSITIVE content (signs are what Sturm counts).
  const posContent = (v: bigint[]): bigint[] => {
    let g = 0n;
    for (const c of v) g = bgcd(g, c);
    return g === 0n ? [] : v.map((c) => c / g);
  };
  const trimB = (v: bigint[]): bigint[] => { const o = v.slice(); while (o.length && o[o.length - 1] === 0n) o.pop(); return o; };
  const ints = primitive(p).map((c) => c.n);
  const der = trimB(ints.slice(1).map((c, k) => c * BigInt(k + 1)));
  const seq: bigint[][] = [ints];
  if (der.length) seq.push(posContent(der));
  while (seq.length >= 2 && seq[seq.length - 1].length > 1) {
    tick(clock);
    const a = seq[seq.length - 2], b = seq[seq.length - 1];
    const lb = b[b.length - 1];
    let r = a.slice();
    let mults = 0; // r = lb^mults · (a mod b), so the sign flips when lb < 0 and mults is odd
    while (r.length >= b.length) {
      const lr = r[r.length - 1];
      const k = r.length - b.length;
      const next = r.map((c) => c * lb);
      mults++;
      for (let j = 0; j < b.length; j++) next[k + j] -= lr * b[j];
      next.pop();
      r = trimB(next);
    }
    if (!r.length) break;
    const flip = lb < 0n && mults % 2 === 1;
    // next Sturm member = −rem(a, b)
    seq.push(posContent(r.map((c) => (flip ? c : -c))));
  }
  const changes = (signs: number[]): number => {
    let n = 0, prev = 0;
    for (const s of signs) if (s !== 0) { if (prev !== 0 && s !== prev) n++; prev = s; }
    return n;
  };
  const sg = (v: bigint): number => (v > 0n ? 1 : v < 0n ? -1 : 0);
  const atPlus = seq.map((q) => sg(q[q.length - 1]));
  const atMinus = seq.map((q) => sg(q[q.length - 1]) * ((q.length - 1) % 2 === 0 ? 1 : -1));
  return changes(atMinus) - changes(atPlus);
}

/**
 * Rational roots of a polynomial (the rational-root theorem), with what is left.
 *
 * Its own, rather than cas.ts's ratPolyRoots, for one reason: COST. That one
 * evaluates every candidate p/q by exact BigInt-rational Horner, and on a dense
 * degree-60 polynomial with 30-bit coefficients it took 1–6 s, uninterruptibly —
 * a frozen Word. Here each candidate is first screened by evaluating the
 * homogenised polynomial Σ aₖ pᵏ q^(n−k) modulo two primes in double arithmetic
 * (exact: every product is below 2⁵³); only a candidate that vanishes mod both is
 * evaluated exactly. The screen can only REJECT a candidate that is not a root
 * (a true root vanishes mod every prime), so nothing is lost. Same caps as
 * cas.ts: trial division to 200000 and 20000 candidates, `incomplete` when hit.
 */
function rationalRoots(poly: P, clock: Clock): { roots: Rat[]; rest: P; incomplete: boolean } {
  let p = primitive(poly);
  const roots: Rat[] = [];
  let incomplete = false;
  if (pdeg(p) < 1) return { roots, rest: p, incomplete };
  while (pdeg(p) >= 1 && ratIsZero(p[0])) { roots.push(RAT_ZERO); p = p.slice(1); }
  if (pdeg(p) < 1) return { roots, rest: p, incomplete };
  const divisors = (v0: bigint): bigint[] => {
    const v = babs(v0);
    const out = new Set<bigint>();
    let i = 1n;
    for (; i * i <= v && i <= 200000n; i++) if (v % i === 0n) { out.add(i); out.add(v / i); }
    if (i * i <= v) incomplete = true;
    return [...out];
  };
  const ints = () => p.map((c) => c.n);
  const dp = divisors(ints()[0]);
  const dq = divisors(ints()[p.length - 1]);
  // Out of time: the search is INCOMPLETE (said), not a reason to drop the
  // square-free result already in hand.
  const late = (): boolean => Date.now() > clock.deadline;
  if (late()) return { roots, rest: p, incomplete: true };
  const PRIMES = [67108859, 67108837];
  const cands: Rat[] = [];
  outer: for (const a of dp) {
    for (const b of dq) {
      if (bgcd(a, b) !== 1n) continue;
      cands.push(ratMake(a, b), ratMake(-a, b));
      if (cands.length > 20000) { incomplete = true; break outer; }
    }
  }
  let residues: number[][] = [];
  const refreshResidues = (): void => {
    residues = PRIMES.map((pr) => { const P_ = BigInt(pr); return ints().map((v) => Number(((v % P_) + P_) % P_)); });
  };
  refreshResidues();
  const modScreen = (r: Rat): boolean => {
    for (let w = 0; w < PRIMES.length; w++) {
      const pr = PRIMES[w];
      const P_ = BigInt(pr);
      const num = Number(((r.n % P_) + P_) % P_);
      const den = Number(((r.d % P_) + P_) % P_);
      if (den === 0) continue;
      // Σ cₖ numᵏ den^(n−k), by homogeneous Horner.
      const cm = residues[w];
      const n = cm.length - 1;
      let denPow = 1;
      let acc = cm[n];
      for (let k = n - 1; k >= 0; k--) {
        denPow = (denPow * den) % pr;
        acc = ((acc * num) % pr + (cm[k] * denPow) % pr) % pr;
      }
      if (acc !== 0) return false;
    }
    return true;
  };
  for (let k = 0; k < cands.length && pdeg(p) >= 1; k++) {
    if (k % 500 === 0 && late()) { incomplete = true; break; }
    const r = cands[k];
    if (!modScreen(r)) continue;
    // Exact: divide by (q x − p) and require a zero remainder.
    const { q, r: rem } = ratPolyDivMod(p, [ratNeg(ratInt(r.n)), ratInt(r.d)]);
    if (rem.length) continue;
    roots.push(r);
    p = primitive(q);
    refreshResidues();
    k--; // the same candidate again (only relevant if the input was not square-free)
  }
  return { roots, rest: p, incomplete };
}

/** The same polynomial with coprime integer coefficients (same roots). */
function primitive(p: P): P {
  let lcm = 1n;
  for (const c of p) lcm = (lcm / bgcd(lcm, c.d)) * c.d;
  const ints = p.map((c) => (c.n * lcm) / c.d);
  let g = 0n;
  for (const v of ints) g = bgcd(g, v);
  if (g === 0n) g = 1n;
  return ints.map((v) => ratInt(v / g));
}

/** Integer-scaled primitive coefficients' largest bit length. */
function coeffBits(p: P): number {
  let lcm = 1n;
  for (const c of p) lcm = (lcm / bgcd(lcm, c.d)) * c.d;
  const ints = p.map((c) => (c.n * lcm) / c.d);
  let g = 0n;
  for (const v of ints) g = bgcd(g, v);
  if (g === 0n) g = 1n;
  return Math.max(...ints.map((v) => bitLen(v / g)));
}

/** p(x + h) — exact composition, used to certify a depression shift. */
function shiftPoly(p: P, h: Rat): P {
  let acc: P = [];
  const lin: P = [h, RAT_ONE];
  for (let k = p.length - 1; k >= 0; k--) acc = ratPolyAdd(ratPolyMul(acc, lin), [p[k]]);
  return ratPolyTrim(acc);
}

function polyStr(p: P, x: string): string {
  const terms: { c: Rat; k: number }[] = [];
  for (let k = p.length - 1; k >= 0; k--) if (!ratIsZero(p[k])) terms.push({ c: p[k], k });
  if (!terms.length) return "0";
  return terms.map(({ c, k }, idx) => {
    const neg = ratSign(c) < 0;
    const a = ratAbs(c);
    const mono = k === 0 ? "" : k === 1 ? x : `${x}^${k}`;
    const body = !mono ? fmtRat(a) : ratEq(a, RAT_ONE) ? mono : `${fmtRat(a)}*${mono}`;
    return idx === 0 ? (neg ? `-${body}` : body) : `${neg ? " - " : " + "}${body}`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Complex doubles and the numerical reference roots
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

function evalCx(c: number[], z: Cx): { v: Cx; dv: Cx; scale: number } {
  let v: Cx = { re: 0, im: 0 }, dv: Cx = { re: 0, im: 0 };
  let scale = 0;
  const az = cAbs(z);
  for (let k = c.length - 1; k >= 0; k--) {
    dv = cAdd(cMul(dv, z), v);
    v = cAdd(cMul(v, z), { re: c[k], im: 0 });
    scale = scale * az + Math.abs(c[k]);
  }
  return { v, dv, scale };
}

/** A double of x / y for BigInts of any size (Number(big) alone overflows to Infinity). */
function bigRatio(x: bigint, y: bigint): number {
  if (y === 0n) return NaN;
  if (x === 0n) return 0;
  const sx = Math.max(0, bitLen(x) - 62), sy = Math.max(0, bitLen(y) - 62);
  return (Number(x >> BigInt(sx)) / Number(y >> BigInt(sy))) * Math.pow(2, sx - sy);
}

/**
 * One Newton correction p(z)/p′(z) computed EXACTLY on the integer coefficients
 * (z rounded to a dyadic complex with ~60-bit parts; the polynomial evaluated in
 * BigInt, homogenised), then rounded once to a double.
 *
 * Why exact: Wilkinson's ∏(x − k) has coefficients past 2⁵³, and evaluating it on
 * coefficients ROUNDED to doubles moved the root 20 to 20.0000522986 — a root of a
 * different polynomial, printed beside a "1e-12 relative" claim. Newton on the
 * exact coefficients converges to the true roots of the polynomial typed.
 */
function exactNewtonStep(a: bigint[], z: Cx): Cx | null {
  const mag = Math.max(Math.abs(z.re), Math.abs(z.im));
  if (!Number.isFinite(mag)) return null;
  const E = Math.min(1060, mag === 0 ? 60 : Math.max(0, 60 - Math.ceil(Math.log2(mag))));
  const scale = (v: number): bigint => {
    let t = v;
    for (let e = E; e > 0; e -= 500) t *= Math.pow(2, Math.min(e, 500));
    return BigInt(Math.round(t));
  };
  const X = scale(z.re), Y = scale(z.im), D = 1n << BigInt(E);
  // H = Σ cₖ Zᵏ D^(m−k), so p(z) = H / D^m.
  const horner = (c: bigint[]): [bigint, bigint] => {
    const m = c.length - 1;
    let hr = c[m], hi = 0n, Dp = 1n;
    for (let k = m - 1; k >= 0; k--) {
      Dp *= D;
      const nr = hr * X - hi * Y + c[k] * Dp;
      hi = hr * Y + hi * X;
      hr = nr;
    }
    return [hr, hi];
  };
  const [pr, pi] = horner(a);
  const [dr, di] = horner(a.slice(1).map((c, k) => c * BigInt(k + 1)));
  const den = dr * dr + di * di;
  if (den === 0n) return null;
  // p/p′ = (H / H′) / D, and H/H′ = H·conj(H′)/|H′|².
  const dd = den * D;
  return { re: bigRatio(pr * dr + pi * di, dd), im: bigRatio(pi * dr - pr * di, dd) };
}

/** p(z)/p′(z) in doubles without overflow: reversed evaluation at 1/z when |z| > 1. */
function ratioDouble(c: number[], z: Cx): Cx {
  if (cAbs(z) <= 1) {
    const { v, dv } = evalCx(c, z);
    return cDiv(v, dv);
  }
  const n = c.length - 1;
  const y = cDiv({ re: 1, im: 0 }, z);
  const { v: q, dv: dq } = evalCx(c.slice().reverse(), y);
  // p(z) = zⁿ q(y), p′(z) = z^(n−1) (n q(y) − y q′(y))
  return cMul(z, cDiv(q, cSub({ re: n * q.re, im: n * q.im }, cMul(y, dq))));
}

/**
 * All roots of a SQUARE-FREE rational polynomial, numerically, with the
 * accuracy MEASURED rather than asserted:
 *   1. Aberth–Ehrlich iteration from Bini's starting circles (radii from the
 *      upper convex hull of log|cₖ| — the Newton polygon), evaluating p/p′ at
 *      1/z beyond the unit circle, so widely spread magnitudes (x²⁰ + 10⁸x¹⁹ − 1,
 *      roots −10⁸ and 0.38) neither overflow nor start on the wrong scale;
 *   2. Newton polishing on the EXACT integer coefficients (exactNewtonStep);
 *   3. real/complex classification by the exact Sturm count where available;
 *   4. `relErr`: the largest final exact Newton correction relative to its root —
 *      the number any precision claim must quote.
 * Never returns a non-finite root: that is a PolyBail, which the caller refuses.
 */
function numericRoots(p: P, clock: Clock): Cx[] & { relErr?: number } {
  const ints = primitive(p).map((c) => c.n);
  const n = ints.length - 1;
  if (n === 1) {
    const out: Cx[] & { relErr?: number } = [{ re: bigRatio(-ints[0], ints[1]), im: 0 }];
    out.relErr = 0;
    return out;
  }
  // Doubles for the iteration only, scaled by a common power of two so that a
  // 1000-bit coefficient does not become Infinity (the exact polish fixes the rest).
  const maxBits = Math.max(...ints.map(bitLen));
  const S = BigInt(Math.max(0, maxBits - 900));
  const c = ints.map((v) => Number(v >> S));
  if (c[n] === 0 || c.some((v) => !Number.isFinite(v))) throw new PolyBail("coefficient out of double range");
  // Bini's starting points from the upper convex hull of (k, log|cₖ|).
  const lg = c.map((v) => (v === 0 ? -Infinity : Math.log(Math.abs(v))));
  const hull: number[] = [];
  for (let k = 0; k <= n; k++) {
    if (lg[k] === -Infinity) continue;
    while (hull.length >= 2) {
      const i = hull[hull.length - 2], j = hull[hull.length - 1];
      if ((lg[j] - lg[i]) * (k - i) <= (lg[k] - lg[i]) * (j - i)) hull.pop();
      else break;
    }
    hull.push(k);
  }
  const z: Cx[] = [];
  for (let h = 0; h + 1 < hull.length; h++) {
    const i = hull[h], j = hull[h + 1];
    const r = Math.exp((lg[i] - lg[j]) / (j - i));
    for (let t = 0; t < j - i; t++) {
      const ang = (2 * Math.PI * t) / (j - i) + (2 * Math.PI * i) / n + 0.4;
      z.push({ re: r * Math.cos(ang), im: r * Math.sin(ang) });
    }
  }
  // A zero constant term cannot occur (rational roots removed x), so hull[0] = 0
  // and the circles hold exactly n points; guard anyway.
  while (z.length < n) z.push({ re: 0.5 + z.length, im: 0.3 });
  // Aberth–Ehrlich. Bounded: 400 sweeps of n² work, no clock (this is the path
  // every bailed exact stage lands on, so it must always finish).
  const done = new Array<boolean>(n).fill(false);
  for (let iter = 0; iter < 400 && done.some((d) => !d); iter++) {
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const w = ratioDouble(c, z[k]);
      if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) continue;
      let s: Cx = { re: 0, im: 0 };
      for (let j = 0; j < n; j++) if (j !== k) s = cAdd(s, cDiv({ re: 1, im: 0 }, cSub(z[k], z[j])));
      const corr = cDiv(w, cSub({ re: 1, im: 0 }, cMul(w, s)));
      if (!Number.isFinite(corr.re) || !Number.isFinite(corr.im)) continue;
      z[k] = cSub(z[k], corr);
      if (cAbs(corr) <= 1e-15 * cAbs(z[k])) done[k] = true;
    }
  }
  // Exact Newton polish (bounded: 8 steps each, skipped once the budget is gone).
  const exactPolish = (w: Cx): Cx => {
    let cur = w;
    for (let it = 0; it < 8; it++) {
      if (Date.now() > clock.deadline) break;
      const d = exactNewtonStep(ints, cur);
      if (!d || !Number.isFinite(d.re) || !Number.isFinite(d.im)) break;
      const next = cSub(cur, d);
      if (cAbs(d) > 0.5 * Math.max(cAbs(cur), 1e-300) && it > 2) break; // diverging: keep what we had
      cur = next;
      if (cAbs(d) <= 2 ** -56 * cAbs(cur)) break;
    }
    return cur;
  };
  let roots = z.map(exactPolish);
  // Classification. Sturm gives the exact number of real roots; the ones with
  // the smallest relative imaginary part are the real ones.
  let nReal: number | null;
  try {
    nReal = sturmRealCount(p, clock);
  } catch (err) {
    if (!(err instanceof PolyBail)) throw err;
    nReal = null; // out of time: the relative-imaginary-part heuristic below
  }
  if (nReal !== null) {
    const order = roots
      .map((w, k) => ({ k, rel: Math.abs(w.im) / Math.max(cAbs(w), 1e-300) }))
      .sort((a, b) => a.rel - b.rel);
    const realIdx = new Set(order.slice(0, nReal).map((o) => o.k));
    // A forced-real root must CONVERGE on the real axis (its last exact Newton
    // correction tiny); otherwise the classification is not trusted for it.
    const realOk = (w: Cx): boolean => {
      const d = exactNewtonStep(ints, w);
      return !!d && cAbs(d) <= 1e-9 * Math.max(cAbs(w), 1e-300);
    };
    roots = roots.map((w, k) => {
      if (!realIdx.has(k)) return w;
      const r = exactPolish({ re: w.re, im: 0 });
      return realOk(r) ? r : w;
    });
  } else {
    roots = roots.map((w) => (Math.abs(w.im) <= 1e-10 * Math.max(cAbs(w), 1e-300) ? exactPolish({ re: w.re, im: 0 }) : w));
  }
  // Conjugate pairs: real coefficients, so force exact symmetry.
  const used = new Set<number>();
  for (let k = 0; k < roots.length; k++) {
    if (used.has(k) || roots[k].im <= 0) continue;
    let best = -1, bestD = Infinity;
    for (let j = 0; j < roots.length; j++) {
      if (j === k || used.has(j) || roots[j].im >= 0) continue;
      const d = cAbs(cSub(roots[j], { re: roots[k].re, im: -roots[k].im }));
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best >= 0) {
      const re = (roots[k].re + roots[best].re) / 2;
      const im = (roots[k].im - roots[best].im) / 2;
      roots[k] = { re, im };
      roots[best] = { re, im: -im };
      used.add(k);
      used.add(best);
    }
  }
  // A real part that is rounding dust RELATIVE TO THE ROOT is zero (±2i, not 1e-17 ± 2i).
  const out: Cx[] & { relErr?: number } = roots.map((w) => (w.im !== 0 && Math.abs(w.re) <= 1e-14 * cAbs(w) ? { re: 0, im: w.im } : w));
  if (out.some((w) => !Number.isFinite(w.re) || !Number.isFinite(w.im))) throw new PolyBail("numerical root finder produced a non-finite value");
  // The MEASURED accuracy: one more exact Newton correction per root.
  let relErr = 0;
  for (const w of out) {
    const d = Date.now() > clock.deadline ? null : exactNewtonStep(ints, w);
    if (!d || !Number.isFinite(d.re) || !Number.isFinite(d.im)) { relErr = NaN; break; }
    relErr = Math.max(relErr, cAbs(d) / Math.max(cAbs(w), 1e-300));
  }
  out.relErr = relErr;
  return out;
}

// ---------------------------------------------------------------------------
// Display terms — every string re-parses through the Solve grammar
// ---------------------------------------------------------------------------

/** c · atom [· tail]. An empty atom means a rational term. */
interface Term { c: Rat; atom: string; tail?: string; prefix?: boolean }

function termBody(t: Term, a: Rat): string {
  if (!t.atom) return t.tail ? `${fmtRat(a)}*${t.tail}` : fmtRat(a);
  let core: string;
  if (t.prefix && a.d !== 1n) core = `${fmtRat(a)}*${t.atom}`;
  else {
    const head = a.n === 1n ? t.atom : `${a.n}*${t.atom}`;
    core = a.d === 1n ? head : `${head}/${a.d}`;
  }
  return t.tail ? `${core}*${t.tail}` : core;
}

function fmtSum(terms: Term[]): string {
  const ts = terms.filter((t) => !ratIsZero(t.c));
  if (!ts.length) return "0";
  return ts.map((t, k) => {
    const neg = ratSign(t.c) < 0;
    const body = termBody(t, ratAbs(t.c));
    return k === 0 ? (neg ? `-${body}` : body) : `${neg ? " - " : " + "}${body}`;
  }).join("");
}

/** re + (sign)·im·i in the product's complex convention (bare i, ASCII hyphen, `*i` after a fraction). */
function fmtComplex(re: Term[], im: Term[], imSign: 1 | -1): string {
  const reT = re.filter((t) => !ratIsZero(t.c));
  const imT = im.filter((t) => !ratIsZero(t.c));
  if (!imT.length) return fmtSum(reT);
  let neg: boolean;
  let imStr: string;
  if (imT.length === 1) {
    const t = imT[0];
    neg = (ratSign(t.c) < 0) !== (imSign < 0);
    const a = ratAbs(t.c);
    if (!t.atom && !t.tail) imStr = ratEq(a, RAT_ONE) ? "i" : a.d === 1n ? `${a.n}i` : `${fmtRat(a)}*i`;
    else imStr = `${termBody(t, a)}*i`;
  } else {
    neg = imSign < 0;
    imStr = `(${fmtSum(imT)})*i`;
  }
  if (!reT.length) return neg ? `-${imStr}` : imStr;
  return `${fmtSum(reT)} ${neg ? "-" : "+"} ${imStr}`;
}

/** coef·√r as a Term, rationalised: √(n/d) = √(n·d)/d, squares pulled out. */
function sqrtTerm(r: Rat, coef: Rat = RAT_ONE): Term {
  if (ratIsZero(r)) return { c: RAT_ZERO, atom: "" };
  const { out, rest } = splitPow(r.n * r.d, 2);
  const c = ratMul(coef, ratMake(out, r.d));
  return { c, atom: rest === 1n ? "" : `sqrt(${rest})` };
}

/** coef·∛r (any sign; the REAL cube root), rationalised: ∛(n/d) = ∛(n·d²)/d. */
function cbrtTerm(r: Rat, coef: Rat = RAT_ONE): Term {
  if (ratIsZero(r)) return { c: RAT_ZERO, atom: "" };
  const sign = ratSign(r) < 0 ? -1n : 1n;
  const { out, rest } = splitPow(babs(r.n) * r.d * r.d, 3);
  return { c: ratMul(coef, ratMake(sign * out, r.d)), atom: rest === 1n ? "" : `cbrt(${rest})` };
}

/**
 * r^(1/4) for r > 0, rationalised: (n/d)^(1/4) = (n·d³)^(1/4)/d — with its
 * CERTIFICATE: the displayed term raised to the fourth power is r, exactly.
 */
function fourthRootTerm(r: Rat): Term {
  const { out, rest } = splitPow(r.n * r.d * r.d * r.d, 4);
  const c = ratMake(out, r.d);
  const c4 = ratMul(ratMul(c, c), ratMul(c, c));
  let t: Term;
  let fourth: Rat; // (atom)⁴
  if (rest === 1n) { t = { c, atom: "" }; fourth = RAT_ONE; }
  else {
    const sq = iroot(rest, 2);
    if (sq * sq === rest) { t = { c, atom: `sqrt(${sq})` }; fourth = ratInt(sq * sq); }
    else { t = { c, atom: `${rest}^(1/4)` }; fourth = ratInt(rest); }
  }
  if (!ratEq(ratMul(c4, fourth), r)) throw new PolyBail("fourth-root certificate failed");
  return t;
}

/** √r = c·√(n′/d′) WITHOUT rationalising (squares pulled from n and d separately). */
function plainSqrt(r: Rat): { c: Rat; inner: Rat } {
  const a = splitPow(r.n, 2), b = splitPow(r.d, 2);
  return { c: ratMake(a.out, b.out), inner: ratMake(a.rest, b.rest) };
}

/** A rational coefficient times an optional atom, prefix style ("-3/5*sqrt(2)"). */
function prefixProduct(c: Rat, atom: string): string {
  if (!atom) return fmtRat(c);
  if (ratEq(c, RAT_ONE)) return atom;
  if (ratEq(c, ratInt(-1))) return `-${atom}`;
  return `${fmtRat(c)}*${atom}`;
}

function piAngle(phi: Rat): string {
  if (ratEq(phi, RAT_ONE)) return "pi";
  if (phi.n === 1n) return `pi/${phi.d}`;
  if (phi.d === 1n) return `${phi.n}*pi`;
  return `${phi.n}*pi/${phi.d}`;
}

/** Adds a rational to a term list (merging into an existing rational term). */
function withRational(terms: Term[], r: Rat): Term[] {
  if (ratIsZero(r)) return terms;
  const k = terms.findIndex((t) => !t.atom && !t.tail);
  if (k >= 0) {
    const out = terms.slice();
    out[k] = { ...out[k], c: ratAdd(out[k].c, r) };
    return out;
  }
  return [{ c: r, atom: "" }, ...terms];
}

const neg = (terms: Term[]): Term[] => terms.map((t) => ({ ...t, c: ratNeg(t.c) }));

// ---------------------------------------------------------------------------
// ℚ(√s) — the certificate field
// ---------------------------------------------------------------------------

interface QS { a: Rat; b: Rat }
const qs = (a: Rat, b: Rat = RAT_ZERO): QS => ({ a, b });
const qsAdd = (x: QS, y: QS): QS => qs(ratAdd(x.a, y.a), ratAdd(x.b, y.b));
const qsMul = (x: QS, y: QS, s: Rat): QS =>
  qs(ratAdd(ratMul(x.a, y.a), ratMul(ratMul(x.b, y.b), s)), ratAdd(ratMul(x.a, y.b), ratMul(x.b, y.a)));
/** Exact sign of a + b√s (s > 0). */
function qsSign(x: QS, s: Rat): number {
  const sa = ratSign(x.a), sb = ratSign(x.b);
  if (sb === 0) return sa;
  if (sa === 0 || sa === sb) return sb || sa;
  const cmp = ratSign(ratSub(ratMul(x.a, x.a), ratMul(ratMul(x.b, x.b), s)));
  return cmp > 0 ? sa : cmp < 0 ? sb : 0;
}
function qsPolyMul(a: QS[], b: QS[], s: Rat): QS[] {
  const out: QS[] = new Array(a.length + b.length - 1).fill(null).map(() => qs(RAT_ZERO));
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] = qsAdd(out[i + j], qsMul(x, y, s)))));
  return out;
}

/** Inner display of a + b√s for a radicand: surd first unless its coefficient is negative. */
function fmtQSInner(x: QS, s: Rat): string {
  const surd = sqrtTerm(s, x.b);
  const rat: Term = { c: x.a, atom: "" };
  return ratSign(x.b) < 0 ? fmtSum([rat, surd]) : fmtSum([surd, rat]);
}

/**
 * √(a + b√s) for a POSITIVE element: denested to √((a+d)/2) ± √((a−d)/2) when
 * d = √(a² − b²s) is rational (Borodin), else the nested atom.
 */
function sqrtQS(x: QS, s: Rat): Term[] {
  if (ratIsZero(x.b)) return [sqrtTerm(x.a)];
  const d = ratSqrtExact(ratSub(ratMul(x.a, x.a), ratMul(ratMul(x.b, x.b), s)));
  if (d) {
    const hi = ratDiv(ratAdd(x.a, d), ratInt(2));
    const lo = ratDiv(ratSub(x.a, d), ratInt(2));
    if (ratSign(hi) >= 0 && ratSign(lo) >= 0) {
      const t1 = sqrtTerm(hi);
      const t2 = sqrtTerm(lo, ratInt(ratSign(x.b)));
      return [t1, t2];
    }
  }
  return [{ c: RAT_ONE, atom: `sqrt(${fmtQSInner(x, s)})` }];
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

type MethodKey = "factored" | "binomial" | "biquadratic" | "cardano" | "trig" | "ferrari" | "numeric";
const METHOD_RANK: Record<MethodKey, number> = { factored: 0, binomial: 1, biquadratic: 2, cardano: 3, trig: 3, ferrari: 4, numeric: 9 };
const METHOD_TEXT: Record<Exclude<MethodKey, "numeric">, string> = {
  factored: "exact (factored over ℚ)",
  binomial: "exact (binomial x^n = c)",
  biquadratic: "exact (quartic — biquadratic)",
  cardano: "exact (cubic — Cardano, one real root)",
  trig: "exact (cubic — trigonometric form, three real roots)",
  ferrari: "exact (quartic — Ferrari)",
};

/** A candidate exact root: its display and whether it is real / purely imaginary. */
interface Cand { display: string; real: boolean; pureIm: boolean }

interface PieceOut {
  /** Exact candidates (one per root of the piece), or null → numerical. */
  cands: Cand[] | null;
  method: MethodKey;
  certificate: string;
  steps: string[];
  /** Why the piece is numerical, when it is. */
  reason?: string;
  /** For a Q-split: the sub-pieces, solved separately. */
  split?: P[];
}

function cand(re: Term[], im: Term[], imSign: 1 | -1 = 1): Cand {
  const reT = re.filter((t) => !ratIsZero(t.c));
  const imT = im.filter((t) => !ratIsZero(t.c));
  return { display: fmtComplex(reT, imT, imSign), real: imT.length === 0, pureIm: reT.length === 0 && imT.length > 0 };
}

/** Monic quadratic x² + b x + c, exact. */
function quadraticPiece(p: P): PieceOut {
  const [c, b] = p;
  const re = ratDiv(ratNeg(b), ratInt(2));
  const delta = ratSub(ratDiv(ratMul(b, b), ratInt(4)), c); // (b² − 4c)/4
  const reT: Term[] = [{ c: re, atom: "" }];
  let cands: Cand[];
  if (ratSign(delta) >= 0) {
    const s = sqrtTerm(delta);
    if (!s.atom) {
      cands = [cand([{ c: ratAdd(re, s.c), atom: "" }], []), cand([{ c: ratSub(re, s.c), atom: "" }], [])];
    } else {
      cands = [cand([...reT, s], []), cand([...reT, ...neg([s])], [])];
    }
  } else {
    const s = sqrtTerm(ratNeg(delta));
    cands = [cand(reT, [s], 1), cand(reT, [s], -1)];
  }
  return { cands, method: "factored", certificate: "the quadratic formula", steps: [] };
}

/** Monic cubic with no rational root (or an incomplete search). */
function cubicPiece(p: P, x: string): PieceOut {
  const [a0, a1, a2] = p;
  const s0 = ratDiv(ratNeg(a2), ratInt(3));
  const pp = ratSub(a1, ratDiv(ratMul(a2, a2), ratInt(3)));
  const q = ratAdd(ratSub(ratDiv(ratMul(ratInt(2), ratMul(a2, ratMul(a2, a2))), ratInt(27)), ratDiv(ratMul(a2, a1), ratInt(3))), a0);
  // Certificate for the shift: t³ + p t + q composed with t = x − s0 is the cubic.
  const dep: P = [q, pp, RAT_ZERO, RAT_ONE];
  if (!pEq(shiftPoly(dep, ratNeg(s0)), p)) throw new PolyBail("depression shift failed its certificate");
  const shiftTxt = ratIsZero(s0) ? "" : ` (${x} = t ${ratSign(s0) < 0 ? "-" : "+"} ${fmtRat(ratAbs(s0))})`;
  const depTxt = `t³${ratIsZero(pp) ? "" : ` ${ratSign(pp) < 0 ? "−" : "+"} ${ratEq(ratAbs(pp), RAT_ONE) ? "" : fmtRat(ratAbs(pp))}t`} ${ratSign(q) < 0 ? "−" : "+"} ${fmtRat(ratAbs(q))} = 0`;
  const s0T: Term[] = ratIsZero(s0) ? [] : [{ c: s0, atom: "" }];

  if (ratIsZero(pp)) {
    // Binomial t³ = −q.
    const cval = ratNeg(q);
    const rt = cbrtTerm(cval);
    const k = rt.c;
    if (!rt.atom) throw new PolyBail("rational cube root left in an irreducible cubic");
    // Certificate: k³·m = c.
    const m = BigInt(rt.atom.slice(5, -1));
    if (!ratEq(ratMul(ratMul(k, ratMul(k, k)), ratInt(m)), cval)) throw new PolyBail("binomial certificate failed");
    const half = ratDiv(k, ratInt(-2));
    const reCx: Term = ratEq(k, RAT_ONE) ? { c: half, atom: rt.atom, prefix: true } : { c: half, atom: rt.atom };
    const imCx: Term = { c: ratDiv(ratAbs(k), ratInt(2)), atom: "sqrt(3)", tail: rt.atom };
    return {
      cands: [
        cand([...s0T, rt], []),
        cand([...s0T, reCx], [imCx], 1),
        cand([...s0T, reCx], [imCx], -1),
      ],
      method: "binomial",
      certificate: `(${fmtSum([rt])})³ = ${fmtRat(cval)} exactly`,
      steps: [`Depressed${shiftTxt}: ${depTxt}, a pure cube: t = ∛(${fmtRat(cval)}) and its two complex companions.`],
    };
  }

  const disc = ratSub(ratMul(ratInt(-4), ratMul(pp, ratMul(pp, pp))), ratMul(ratInt(27), ratMul(q, q)));
  const head = `Depressed${shiftTxt}: ${depTxt}, p = ${fmtRat(pp)}, q = ${fmtRat(q)}; Δ = −4p³ − 27q² = ${fmtRat(disc)}`;
  if (ratSign(disc) < 0) {
    // Cardano, real radicals: u³, v³ = −q/2 ± √D, D = q²/4 + p³/27 = −Δ/108 > 0.
    const A = ratDiv(ratNeg(q), ratInt(2));
    const D = ratAdd(ratDiv(ratMul(q, q), ratInt(4)), ratDiv(ratMul(pp, ratMul(pp, pp)), ratInt(27)));
    // Certificate: u³ + v³ = 2A = −q and u³·v³ = A² − D = −p³/27, exactly.
    if (!ratEq(ratMul(ratInt(2), A), ratNeg(q))) throw new PolyBail("Cardano sum");
    if (!ratEq(ratSub(ratMul(A, A), D), ratDiv(ratNeg(ratMul(pp, ratMul(pp, pp))), ratInt(27)))) throw new PolyBail("Cardano product");
    const sD = sqrtTerm(D);
    let realTerms: Term[];
    let U: string, V: string;
    if (!sD.atom) {
      // √D rational: both radicands rational.
      const r1 = ratAdd(A, sD.c), r2 = ratSub(A, sD.c);
      const u = cbrtTerm(r1), v = cbrtTerm(r2);
      realTerms = [u, v];
      U = fmtSum([u]);
      V = fmtSum([v]);
    } else {
      U = `cbrt(${fmtSum([{ c: A, atom: "" }, sD])})`;
      V = `cbrt(${fmtSum([{ c: A, atom: "" }, ...neg([sD])])})`;
      realTerms = [{ c: RAT_ONE, atom: U }, { c: RAT_ONE, atom: V }];
    }
    // The sign of u·v = −p/3 (real cube roots) — numerical, and said so.
    const un = Math.cbrt(ratToNumber(A) + Math.sqrt(ratToNumber(D)));
    const vn = Math.cbrt(ratToNumber(A) - Math.sqrt(ratToNumber(D)));
    const want = -ratToNumber(pp) / 3;
    if (!(Math.abs(un * vn - want) <= 1e-9 * Math.max(1, Math.abs(want)))) throw new PolyBail("Cardano uv sign");
    // The complex pair as ω·u + ω̄·v (ω = −1/2 + √3/2·i): the textbook form, and
    // about 25 characters shorter than re + im·i, which ran past the cap for
    // every Cardano pair. Still linear in i, so it re-parses to its own value.
    const wrap = (s: string): string => (/^cbrt\([^()]*\)$|^cbrt\([^()]*\([^()]*\)[^()]*\)$/.test(s) ? s : `(${s})`);
    const Uw = wrap(U), Vw = wrap(V);
    const shift = ratIsZero(s0) ? "" : `${fmtRat(s0)} + `;
    const pairCand = (sgn: 1 | -1): Cand => ({
      display: `${shift}(-1/2 ${sgn > 0 ? "+" : "-"} sqrt(3)/2*i)*${Uw} + (-1/2 ${sgn > 0 ? "-" : "+"} sqrt(3)/2*i)*${Vw}`,
      real: false,
      pureIm: false,
    });
    return {
      cands: [cand([...s0T, ...realTerms], []), pairCand(1), pairCand(-1)],
      method: "cardano",
      certificate: "Cardano's identities u³ + v³ = −q and u³v³ = −p³/27 in ℚ(√D), with u·v = −p/3 checked numerically",
      steps: [`${head} < 0: one real root (Cardano, real radicals).`],
    };
  }
  // Δ > 0: casus irreducibilis — the trigonometric form, real throughout.
  // cos θ = (3q/(2p))·√(−3/p); cos²θ = −27q²/(4p³), rational and < 1.
  const cos2 = ratDiv(ratMul(ratInt(-27), ratMul(q, q)), ratMul(ratInt(4), ratMul(pp, ratMul(pp, pp))));
  if (!(ratSign(pp) < 0 && ratSign(ratSub(RAT_ONE, cos2)) > 0)) throw new PolyBail("trig certificate: cos²θ not < 1");
  const L = ratDiv(ratMul(ratInt(3), q), ratMul(ratInt(2), pp));
  const ps = plainSqrt(ratDiv(ratInt(-3), pp));
  if (!ratEq(ratMul(ratMul(L, L), ratMul(ratMul(ps.c, ps.c), ps.inner)), cos2)) throw new PolyBail("trig certificate: cos θ");
  const cosSign = ratSign(L); // √ is positive
  // cos θ = −q / (2(−p/3)^(3/2)): its sign must be −sign(q).
  if (cosSign !== -ratSign(q)) throw new PolyBail("trig certificate: sign of cos θ");
  // Special angles: cos²θ ∈ {0, 1/4, 1/2, 3/4}.
  const SPECIAL: [Rat, Rat, Rat][] = [
    // [cos², θ/π when cos ≥ 0, θ/π when cos < 0]
    [RAT_ZERO, R(1, 2), R(1, 2)],
    [R(1, 4), R(1, 3), R(2, 3)],
    [R(1, 2), R(1, 4), R(3, 4)],
    [R(3, 4), R(1, 6), R(5, 6)],
  ];
  const special = SPECIAL.find(([c2]) => ratEq(c2, cos2));
  const Kroot = plainSqrt(ratDiv(ratNeg(pp), ratInt(3)));
  const Kc = ratMul(ratInt(2), Kroot.c);
  const Katom = ratEq(Kroot.inner, RAT_ONE) ? "" : `sqrt(${fmtRat(Kroot.inner)})`;
  const cosArgCoef = ratMul(L, ps.c);
  const cosArg = prefixProduct(cosArgCoef, ratEq(ps.inner, RAT_ONE) ? "" : `sqrt(${fmtRat(ps.inner)})`);
  const angles: string[] = [];
  let thetaTxt: string;
  if (special) {
    const a = cosSign >= 0 ? special[1] : special[2];
    thetaTxt = `cos θ = ${cosSign < 0 ? "−" : ""}${ratEq(cos2, R(1, 4)) ? "1/2" : ratEq(cos2, R(1, 2)) ? "√2/2" : ratEq(cos2, R(3, 4)) ? "√3/2" : "0"}, θ = ${piAngle(a).replace("*pi", "π").replace("pi", "π")}`;
    for (let k = 0; k < 3; k++) {
      let phi = ratDiv(ratAdd(a, ratInt(2 * k)), ratInt(3));
      while (ratSign(ratSub(phi, ratInt(2))) >= 0) phi = ratSub(phi, ratInt(2));
      if (ratSign(ratSub(phi, RAT_ONE)) > 0) phi = ratSub(ratInt(2), phi);
      angles.push(piAngle(phi));
    }
  } else {
    thetaTxt = `cos θ = ${cosArg} (not a special angle)`;
    angles.push(`acos(${cosArg})/3`, `(acos(${cosArg}) + 2*pi)/3`, `(2*pi - acos(${cosArg}))/3`);
  }
  const cands = angles.map((ang) => cand([...s0T, { c: Kc, atom: `${Katom ? `${Katom}*` : ""}cos(${ang})` }], []));
  return {
    cands,
    method: "trig",
    certificate: `cos θ checked exactly (cos²θ = ${fmtRat(cos2)} < 1) and the identity 4cos³φ − 3cos φ = cos 3φ`,
    steps: [
      `${head} > 0: three real roots.`,
      `Cardano would take cube roots of complex numbers here (casus irreducibilis); the trigonometric form gives the same roots as real numbers: ${thetaTxt}.`,
    ],
  };
}

/** Monic quartic with no rational root (or an incomplete search). */
function quarticPiece(p: P, clock: Clock): PieceOut {
  const [a0, a1, a2, a3] = p;
  const s0 = ratDiv(ratNeg(a3), ratInt(4));
  // Depressed y⁴ + p y² + q y + r with x = y + s0; the coefficients are READ OFF
  // the exact composition rather than typed in, so they cannot be mistyped.
  const dep = shiftPoly(p, s0);
  if (dep.length !== 5 || !ratIsZero(dep[3] ?? RAT_ZERO)) throw new PolyBail("depression failed");
  const [r, q, pp] = dep;
  const toX = (yPoly: P): P => shiftPoly(yPoly, ratNeg(s0)); // y = x − s0
  const s0T = (terms: Term[]): Term[] => withRational(terms, s0);

  if (ratIsZero(q)) {
    // Split over ℚ? (i) p² − 4r a rational square; (ii) r = k², 2k − p = w².
    const disc = ratSub(ratMul(pp, pp), ratMul(ratInt(4), r));
    const sd = ratSqrtExact(disc);
    if (sd) {
      const y1 = ratDiv(ratAdd(ratNeg(pp), sd), ratInt(2));
      const y2 = ratDiv(ratSub(ratNeg(pp), sd), ratInt(2));
      return splitOut([toX([ratNeg(y1), RAT_ZERO, RAT_ONE]), toX([ratNeg(y2), RAT_ZERO, RAT_ONE])], p);
    }
    const kk = ratSqrtExact(r);
    if (kk) {
      for (const k of [kk, ratNeg(kk)]) {
        const w = ratSqrtExact(ratSub(ratMul(ratInt(2), k), pp));
        if (w && !ratIsZero(w)) {
          return splitOut([toX([k, ratNeg(w), RAT_ONE]), toX([k, w, RAT_ONE])], p);
        }
      }
    }
    // Binomial y⁴ = c.
    if (ratIsZero(pp)) {
      const c = ratNeg(r);
      if (ratSign(c) > 0) {
        const t = fourthRootTerm(c);
        if (!t.atom) throw new PolyBail("rational fourth root left");
        return {
          cands: [cand(s0T([t]), []), cand(s0T(neg([t])), []), cand(s0T([]), [t], 1), cand(s0T([]), [t], -1)],
          method: "binomial",
          certificate: `(${fmtSum([t])})⁴ = ${fmtRat(c)} exactly`,
          steps: [`A pure fourth power: y⁴ = ${fmtRat(c)}${ratIsZero(s0) ? "" : ` with x = y + ${fmtRat(s0)}`}.`],
        };
      }
      // y⁴ = −|c|: y = (|c|/4)^(1/4)·(±1 ± i), unless √r is rational (the biquadratic form is cleaner then).
      if (!ratSqrtExact(r)) {
        const t = fourthRootTerm(ratDiv(r, ratInt(4)));
        if (t.atom) {
          return {
            cands: [
              cand(s0T([t]), [t], 1), cand(s0T([t]), [t], -1),
              cand(s0T(neg([t])), [t], 1), cand(s0T(neg([t])), [t], -1),
            ],
            method: "binomial",
            certificate: `(${fmtSum([t])}·(1 ± i))⁴ = ${fmtRat(ratNeg(r))} exactly`,
            steps: [`A pure fourth power: y⁴ = ${fmtRat(ratNeg(r))}${ratIsZero(s0) ? "" : ` with x = y + ${fmtRat(s0)}`}; y = (${fmtRat(ratDiv(r, ratInt(4)))})^(1/4)·(±1 ± i).`],
          };
        }
      }
    }
    return biquadratic(pp, r, s0, s0T);
  }

  // q ≠ 0: the resolvent cubic 8m³ + 8p m² + (2p² − 8r) m − q² = 0.
  const resolvent: P = [
    ratNeg(ratMul(q, q)),
    ratSub(ratMul(ratInt(2), ratMul(pp, pp)), ratMul(ratInt(8), r)),
    ratMul(ratInt(8), pp),
    ratInt(8),
  ];
  tick(clock);
  const rr = rationalRoots(resolvent, clock);
  const ms = rr.roots.filter((m) => ratSign(m) > 0);
  // Prefer a root that makes 2m a square: then the quartic splits over ℚ.
  for (const m of ms) {
    const w = ratSqrtExact(ratMul(ratInt(2), m));
    if (w) {
      const alpha = ratAdd(ratDiv(pp, ratInt(2)), m);
      const beta = ratDiv(q, ratMul(ratInt(2), w)); // q/(4m)·w = q/(2w)
      return splitOut([toX([ratAdd(alpha, beta), ratNeg(w), RAT_ONE]), toX([ratSub(alpha, beta), w, RAT_ONE])], p);
    }
  }
  if (!ms.length && rr.incomplete) {
    return {
      cands: null, method: "numeric", certificate: "", steps: [],
      reason: "the rational-root search on its resolvent cubic was capped, so the Ferrari form was not attempted",
    };
  }
  if (!ms.length) {
    const rdisc = cubicDisc(resolvent);
    return {
      cands: null,
      method: "numeric",
      certificate: "",
      steps: [],
      reason:
        ratSign(rdisc) > 0
          ? "a closed form exists (Ferrari) but needs the cube root of a complex number from its resolvent cubic and runs to hundreds of characters"
          : "a closed form exists (Ferrari) but its resolvent cubic has no rational root, so the radicals nest cube roots inside square roots and run to hundreds of characters",
    };
  }
  // Ferrari over ℚ(√s), s = 2m.
  const m = ms[0];
  const s = ratMul(ratInt(2), m);
  const alpha = ratAdd(ratDiv(pp, ratInt(2)), m);
  const beta = ratDiv(q, ratMul(ratInt(4), m));
  // f1 = y² − w y + (α + βw), f2 = y² + w y + (α − βw); certificate: f1·f2 = depressed.
  const f1: QS[] = [qs(alpha, beta), qs(RAT_ZERO, ratInt(-1)), qs(RAT_ONE)];
  const f2: QS[] = [qs(alpha, ratNeg(beta)), qs(RAT_ZERO, RAT_ONE), qs(RAT_ONE)];
  const prod = qsPolyMul(f1, f2, s);
  const ok = prod.length === 5 && prod.every((c, k) => ratIsZero(c.b) && ratEq(c.a, dep[k] ?? RAT_ZERO));
  if (!ok) throw new PolyBail("Ferrari certificate failed");
  const quarter = ratDiv(s, ratInt(4));
  const wHalf = sqrtTerm(s, R(1, 2));
  const pieces: { centre: Term[]; delta: QS }[] = [
    { centre: [wHalf], delta: qs(ratSub(quarter, alpha), ratNeg(beta)) },
    { centre: neg([wHalf]), delta: qs(ratSub(quarter, alpha), beta) },
  ];
  const cands: Cand[] = [];
  for (const { centre, delta } of pieces) {
    const sg = qsSign(delta, s);
    if (sg === 0) throw new PolyBail("Ferrari: repeated root in a square-free factor");
    if (sg > 0) {
      const rt = sqrtQS(delta, s);
      cands.push(cand(s0T([...centre, ...rt]), []), cand(s0T([...centre, ...neg(rt)]), []));
    } else {
      const rt = sqrtQS(qs(ratNeg(delta.a), ratNeg(delta.b)), s);
      cands.push(cand(s0T(centre), rt, 1), cand(s0T(centre), rt, -1));
    }
  }
  return {
    cands,
    method: "ferrari",
    certificate: `the factorisation over ℚ(√${fmtRat(s)}) multiplying back to the quartic exactly (resolvent root m = ${fmtRat(m)})`,
    steps: [
      `Depressed${ratIsZero(s0) ? "" : ` (x = y ${ratSign(s0) < 0 ? "-" : "+"} ${fmtRat(ratAbs(s0))})`}: y⁴ + (${fmtRat(pp)})y² + (${fmtRat(q)})y + (${fmtRat(r)}) = 0.`,
      `Ferrari: the resolvent cubic 8m³ + 8pm² + (2p² − 8r)m − q² = 0 has the rational root m = ${fmtRat(m)}, so the quartic splits over ℚ(√${fmtRat(s)}) into two quadratics.`,
    ],
  };
}

function cubicDisc(c: P): Rat {
  const [d, cc, b, a] = c;
  const t1 = ratMul(ratMul(ratMul(ratMul(ratInt(18), a), b), cc), d);
  const t2 = ratMul(ratMul(ratInt(4), ratMul(b, ratMul(b, b))), d);
  const t3 = ratMul(ratMul(b, b), ratMul(cc, cc));
  const t4 = ratMul(ratMul(ratInt(4), a), ratMul(cc, ratMul(cc, cc)));
  const t5 = ratMul(ratMul(ratInt(27), ratMul(a, a)), ratMul(d, d));
  return ratSub(ratAdd(ratSub(t1, t2), t3), ratAdd(t4, t5));
}

/** A quartic that splits into two rational quadratics: certify and hand back. */
function splitOut(factors: P[], p: P): PieceOut {
  if (!pEq(ratPolyMul(factors[0], factors[1]), p)) throw new PolyBail("quadratic split failed its certificate");
  return { cands: null, method: "factored", certificate: "", steps: [], split: factors };
}

/** y⁴ + p y² + r, not split over ℚ, not a pure power. */
function biquadratic(pp: Rat, r: Rat, s0: Rat, s0T: (t: Term[]) => Term[]): PieceOut {
  const disc = ratSub(ratMul(pp, pp), ratMul(ratInt(4), r));
  const yTxt = `y⁴ + (${fmtRat(pp)})y² + (${fmtRat(r)}) = 0${ratIsZero(s0) ? "" : ` with x = y + ${fmtRat(s0)}`}`;
  if (ratSign(disc) > 0) {
    // Y = −p/2 ± √disc/2 = α ± β√m.
    const half = sqrtTerm(ratDiv(disc, ratInt(4)));
    if (!half.atom) throw new PolyBail("rational Y left in a non-split biquadratic");
    const m = ratInt(BigInt(half.atom.slice(5, -1)));
    const alpha = ratDiv(ratNeg(pp), ratInt(2));
    const cands: Cand[] = [];
    for (const sgn of [1, -1]) {
      const Y = qs(alpha, ratMul(half.c, ratInt(sgn)));
      const sg = qsSign(Y, m);
      if (sg === 0) throw new PolyBail("zero Y");
      if (sg > 0) {
        const rt = sqrtQS(Y, m);
        cands.push(cand(s0T(rt), []), cand(s0T(neg(rt)), []));
      } else {
        const rt = sqrtQS(qs(ratNeg(Y.a), ratNeg(Y.b)), m);
        cands.push(cand(s0T([]), rt, 1), cand(s0T([]), rt, -1));
      }
    }
    // Certificate: Y± are the roots of Y² + pY + r, i.e. Y+ + Y− = −p and Y+·Y− = r exactly.
    const Yp = qs(alpha, half.c), Ym = qs(alpha, ratNeg(half.c));
    const sum = qsAdd(Yp, Ym), prod = qsMul(Yp, Ym, m);
    if (!(ratEq(sum.a, ratNeg(pp)) && ratIsZero(sum.b) && ratEq(prod.a, r) && ratIsZero(prod.b))) throw new PolyBail("biquadratic certificate");
    return {
      cands,
      method: "biquadratic",
      certificate: `y² = ${fmtQSInner(Yp, m)} and ${fmtQSInner(Ym, m)} solving Y² + pY + r = 0 exactly (sum −p, product r)`,
      steps: [`Biquadratic: ${yTxt}; y² = ${fmtQSInner(Yp, m)} or ${fmtQSInner(Ym, m)}.`],
    };
  }
  // disc < 0: y⁴ + p y² + r = (y² + k)² − s y², k = √r, s = 2k − p > 0.
  const kr = ratSqrtExact(r);
  if (kr) {
    const k = kr;
    const s = ratSub(ratMul(ratInt(2), k), pp);
    const t = ratAdd(ratMul(ratInt(2), k), pp);
    if (!(ratSign(s) > 0 && ratSign(t) > 0)) throw new PolyBail("biquadratic sign");
    // Certificate: (y² + k)² − s y² = y⁴ + (2k − s)y² + k² with 2k − s = p, k² = r.
    if (!(ratEq(ratSub(ratMul(ratInt(2), k), s), pp) && ratEq(ratMul(k, k), r))) throw new PolyBail("biquadratic certificate");
    const reT = sqrtTerm(s, R(1, 2));
    const imT = sqrtTerm(t, R(1, 2));
    return {
      cands: [
        cand(s0T([reT]), [imT], 1), cand(s0T([reT]), [imT], -1),
        cand(s0T(neg([reT])), [imT], 1), cand(s0T(neg([reT])), [imT], -1),
      ],
      method: "biquadratic",
      certificate: `(y² + ${fmtRat(k)})² − ${fmtRat(s)}·y² = y⁴ + (${fmtRat(pp)})y² + ${fmtRat(r)} exactly`,
      steps: [`Biquadratic with complex y²: ${yTxt}; y⁴ + py² + r = (y² + ${fmtRat(k)})² − ${fmtRat(s)}y², a difference of squares over ℚ(√${fmtRat(s)}).`],
    };
  }
  // k = √r irrational: s = 2k − p and t = 2k + p live in ℚ(√r).
  const kT = sqrtTerm(r); // k = kT.c·√kM
  const kM = ratInt(BigInt(kT.atom.slice(5, -1)));
  const sQ = qs(ratNeg(pp), ratMul(ratInt(2), kT.c));
  const tQ = qs(pp, ratMul(ratInt(2), kT.c));
  if (!(qsSign(sQ, kM) > 0 && qsSign(tQ, kM) > 0)) throw new PolyBail("biquadratic sign (irrational k)");
  const sAtom = `sqrt(${fmtQSInner(sQ, kM)})`;
  const tAtom = `sqrt(${fmtQSInner(tQ, kM)})`;
  const reT: Term = { c: R(1, 2), atom: sAtom };
  const imT: Term = { c: R(1, 2), atom: tAtom };
  return {
    cands: [
      cand(s0T([reT]), [imT], 1), cand(s0T([reT]), [imT], -1),
      cand(s0T(neg([reT])), [imT], 1), cand(s0T(neg([reT])), [imT], -1),
    ],
    method: "biquadratic",
    certificate: `(y² + √${fmtRat(r)})² − s·y² = y⁴ + (${fmtRat(pp)})y² + ${fmtRat(r)} with s = 2√${fmtRat(r)} − (${fmtRat(pp)}), exactly in ℚ(√${fmtRat(r)})`,
    steps: [`Biquadratic with complex y²: ${yTxt}; y⁴ + py² + r = (y² + √r)² − (2√r − p)y².`],
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface Built { root: PolyRoot; key: MethodKey }

function fmtDec(z: Cx): string {
  const f = (v: number): string => String(Number(v.toPrecision(12)));
  if (z.im === 0) return f(z.re);
  const mag = f(Math.abs(z.im));
  const imPart = mag === "1" ? "i" : `${mag}i`;
  if (z.re === 0) return z.im < 0 ? `-${imPart}` : imPart;
  return `${f(z.re)} ${z.im < 0 ? "-" : "+"} ${imPart}`;
}

/** Evaluates a displayed root through the Solve grammar: re + im·i, linear in i. */
function evalDisplay(s: string): Cx | null {
  try {
    const ast = parseExpr(s);
    const re = evalAst(ast, { i: 0 });
    const im = evalAst(ast, { i: 1 }) - re;
    return Number.isFinite(re) && Number.isFinite(im) ? { re, im } : null;
  } catch {
    return null;
  }
}

/**
 * Necessary condition for b | a over ℤ (b primitive): b mod p divides a mod p,
 * for primes not dividing lc(b). False → certainly not a factor.
 */
function modDivider(a: bigint[]): (b: number[]) => boolean {
  const PR = [67108859, 67108837];
  const residues = PR.map((pr) => { const P_ = BigInt(pr); return a.map((v) => Number(((v % P_) + P_) % P_)); });
  return (b: number[]) => divisibleModP(residues, PR, b);
}

/** b holds safe integers (|v| < 2⁵³); every product below is < 2⁵², so doubles are exact. */
function divisibleModP(residues: number[][], PR: number[], b: number[]): boolean {
  for (let w = 0; w < PR.length; w++) {
    const pr = PR[w];
    const am = residues[w].slice();
    const bm = b.map((v) => ((v % pr) + pr) % pr);
    const lb = bm[bm.length - 1];
    if (lb === 0) continue;
    let [r0, r1, s0, s1] = [pr, lb, 0, 1];
    while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    const inv = ((s0 % pr) + pr) % pr;
    const mul = (x: number, y: number): number => (x * y) % pr;
    for (let top = am.length - 1; top >= bm.length - 1; top--) {
      const f = mul(am[top], inv);
      if (f === 0) continue;
      const shift = top - (bm.length - 1);
      for (let j = 0; j < bm.length; j++) am[shift + j] = ((am[shift + j] - mul(f, bm[j])) % pr + pr) % pr;
    }
    for (let k = 0; k < bm.length - 1; k++) if (am[k] !== 0) return false;
  }
  return true;
}

/**
 * A factor over ℚ of degree 2–4, PROPOSED by a conjugation-closed subset of the
 * numerical roots (its elementary symmetric functions, times a divisor of the
 * leading coefficient, must be integers) and PROVED by exact division. Sound by
 * construction; not complete (it says nothing when it finds nothing). Bounded:
 * degree ≤ 24, ≤ 64 leading-coefficient divisors, ≤ 6000 subsets.
 */
function splitByRoots(poly: P, roots: Cx[], clock: Clock): [P, P] | null {
  const n = pdeg(poly);
  if (n > 24 || roots.length !== n) return null;
  const prim = primitive(poly);
  const screen = modDivider(prim.map((c) => c.n));
  const lead = babs(prim[n].n);
  const leads: bigint[] = [];
  for (let a = 1n; a * a <= lead && a <= 100000n; a++) {
    if (lead % a === 0n) { leads.push(a); if (a * a !== lead) leads.push(lead / a); }
  }
  leads.sort((u, v) => (u < v ? -1 : u > v ? 1 : 0));
  if (leads.length > 64) leads.length = 64;
  const units: Cx[][] = [];
  for (const z of roots) {
    if (z.im === 0) units.push([z]);
    else if (z.im > 0) units.push([z, { re: z.re, im: -z.im }]);
  }
  let tried = 0;
  for (let size = 2; size <= Math.min(4, n - 1); size++) {
    const pick: number[] = [];
    let found: [P, P] | null = null;
    const rec = (start: number, left: number): void => {
      if (found || tried > 6000) return;
      if (left === 0) {
        tried++;
        if (tried % 200 === 0 && Date.now() > clock.deadline) { tried = Infinity; return; }
        // Monic polynomial with these roots (complex arithmetic, real parts kept).
        let coef: Cx[] = [{ re: 1, im: 0 }];
        for (const u of pick) for (const z of units[u]) {
          const next: Cx[] = new Array(coef.length + 1).fill(null).map(() => ({ re: 0, im: 0 }));
          coef.forEach((c, k) => {
            next[k + 1] = cAdd(next[k + 1], c);
            next[k] = cSub(next[k], cMul(c, z));
          });
          coef = next;
        }
        for (const a of leads) {
          const an = Number(a);
          const ints: bigint[] = [];
          let ok = true;
          for (const c of coef) {
            const v = c.re * an;
            const r = Math.round(v);
            if (!(Math.abs(v - r) <= 1e-6 * Math.max(1, Math.abs(v))) || Math.abs(v) > 2 ** 50) { ok = false; break; }
            ints.push(BigInt(r));
          }
          if (!ok) continue;
          // The SMALLEST a that makes every coefficient an integer is the only one
          // worth testing: a larger working a gives a non-primitive multiple of it.
          // Screen mod two primes before the exact division (Wilkinson-type inputs
          // propose hundreds of near-integer subsets that are not factors).
          if (!screen(ints.map((v) => Number(v)))) break;
          const cand = ints.map((v) => ratInt(v));
          const { q, r } = ratPolyDivMod(prim, cand);
          if (!r.length && pdeg(q) >= 1) { found = [monic(cand), monic(q)]; return; }
          break;
        }
        return;
      }
      for (let u = start; u < units.length; u++) {
        if (units[u].length > left) continue;
        pick.push(u);
        rec(u + 1, left - units[u].length);
        pick.pop();
        if (found) return;
      }
    };
    rec(0, size);
    if (found) {
      // Certificate: the two factors multiply back to the piece exactly.
      const [f1, f2] = found as [P, P];
      if (!pEq(ratPolyMul(f1, f2), monic(poly))) return null;
      return found;
    }
  }
  return null;
}

const ABEL: Record<number, string> ={ 5: "quintic", 6: "sextic", 7: "septic", 8: "octic" };

/**
 * Exact roots of a polynomial with RATIONAL coefficients (ascending), with
 * multiplicities. Null when a cap is exceeded before work starts or the time
 * budget runs out — the caller keeps its own numerical path then.
 */
export function exactPolyRoots(coeffs: Rat[], variable = "x"): ExactPolyRootsResult | null {
  const f0 = ratPolyTrim(coeffs);
  const n = pdeg(f0);
  if (n < 1 || n > MAX_DEGREE) return null;
  if (coeffBits(f0) > MAX_COEFF_BITS) return null;
  const clock: Clock = { deadline: Date.now() + TIME_BUDGET_MS };
  try {
    return run(f0, variable, clock);
  } catch (err) {
    if (err instanceof PolyBail) return null;
    throw err;
  }
}

function run(f0: P, x: string, clock: Clock): ExactPolyRootsResult {
  const lead = f0[f0.length - 1];
  const f = monic(f0);
  const steps: string[] = [];
  const caveats: string[] = [];
  const certs: string[] = [];
  const reasons: string[] = [];
  let incomplete = false;
  let worstErr = 0; // the largest MEASURED relative correction among numerical roots shown

  // 2. Square-free factorisation.
  const sqf = yun(f, clock);
  // Certificate: Π factorᵢ^multᵢ = the monic polynomial.
  let prod: P = [RAT_ONE];
  for (const { factor, mult } of sqf) for (let k = 0; k < mult; k++) prod = ratPolyMul(prod, factor);
  if (!pEq(prod, f)) throw new PolyBail("square-free certificate failed");
  if (sqf.some((s) => s.mult > 1)) {
    steps.push(
      `Square-free factorisation (Yun: repeated gcd(p, p′) over ℚ): ` +
        sqf.map((s) => `(${polyStr(s.factor, x)})${s.mult > 1 ? `^${s.mult}` : ""}`).join("·") +
        ` — every multiplicity is exact.`,
    );
  }

  const built: Built[] = [];
  const factorText: { root?: Rat; poly?: P; mult: number }[] = [];

  // 3. Rational roots of each square-free factor, then the pieces left over.
  const pending: { poly: P; mult: number }[] = [];
  for (const { factor, mult } of sqf) {
    // (No tick: rationalRoots reports lateness as `incomplete` rather than bailing.)
    // The rational-root test runs on the PRIMITIVE INTEGER form: a monic factor
    // carries lc(f) into every denominator, and the candidate search then works
    // on numbers that are powers of it (a dense degree-60 input took 8 s).
    const rr = rationalRoots(factor, clock);
    if (rr.incomplete) incomplete = true;
    for (const root of rr.roots) {
      built.push({
        root: { display: fmtRat(root), re: ratToNumber(root), im: 0, exact: true, mult, certificate: "rational-root test" },
        key: "factored",
      });
      factorText.push({ root, mult });
      steps.push(`Rational-root test: ${fmtRat(root)} is a root; divide out (${linFactor(root, x)}).`);
    }
    const rest = rr.rest.length ? monic(rr.rest) : [];
    if (pdeg(rest) >= 1) pending.push({ poly: rest, mult });
  }
  if (built.length) certs.push("the rational-root test (p(r) = 0 exactly)");

  // 4. Pieces.
  while (pending.length) {
    const { poly, mult } = pending.shift()!;
    const d = pdeg(poly);
    let out: PieceOut;
    if (d === 1) {
      const root = ratNeg(poly[0]);
      built.push({ root: { display: fmtRat(root), re: ratToNumber(root), im: 0, exact: true, mult, certificate: "linear factor" }, key: "factored" });
      factorText.push({ root, mult });
      continue;
    }
    const refs = numericRoots(poly, clock);
    // Degree ≥ 5: look for a factor over ℚ of degree ≤ 4 among products of the
    // numerical roots (conjugation-closed subsets), confirmed by EXACT division —
    // the numerics only propose; the division proves. x⁸ − 1, x⁶ + 1 and
    // (x² + 3x − 3)(x³ + 4x + 1) then reach the exact solvers piece by piece.
    if (d >= 5) {
      const split = splitByRoots(poly, refs, clock);
      if (split) {
        steps.push(`${polyStr(poly, x)} = (${polyStr(split[0], x)})(${polyStr(split[1], x)}) over ℚ — a factor read off the numerical roots and confirmed by exact division.`);
        pending.unshift({ poly: split[0], mult }, { poly: split[1], mult });
        if (!certs.includes("the factorisation over ℚ multiplying back exactly")) certs.push("the factorisation over ℚ multiplying back exactly");
        continue;
      }
    }
    const bits = coeffBits(poly);
    const formula = (): PieceOut => {
      if (d >= 3 && d <= 4 && bits > FORMULA_BITS) {
        return { cands: null, method: "numeric", certificate: "", steps: [], reason: `its coefficients run past ${FORMULA_BITS} bits, so the ${d === 3 ? "Cardano" : "Ferrari"} form is not attempted` };
      }
      if (d === 2) return quadraticPiece(poly);
      if (d === 3) return cubicPiece(poly, x);
      if (d === 4) return quarticPiece(poly, clock);
      return {
        cands: null, method: "numeric", certificate: "", steps: [],
        reason:
          `Degree ${d}: no general formula in radicals exists (Abel–Ruffini); this ${ABEL[d] ?? "polynomial factor"} ` +
          `was not tested for solvability by radicals, so its roots are numerical.`,
      };
    };
    // A failed certificate or the time budget withholds THIS piece's closed form
    // only. Bailing out of the whole engine would hand the polynomial back to the
    // multiplicity-blind Durand–Kerner path — §A finding 1 again.
    try {
      out = formula();
    } catch (err) {
      if (!(err instanceof PolyBail)) throw err;
      out = {
        cands: null, method: "numeric", certificate: "", steps: [],
        reason: err.message === "time budget"
          ? "the closed form was not attempted (time budget)"
          : "the closed form was withheld because its exact certificate failed",
      };
    }
    if (out.split) {
      steps.push(`${polyStr(poly, x)} = (${polyStr(out.split[0], x)})(${polyStr(out.split[1], x)}) over ℚ.`);
      for (const s of out.split) pending.push({ poly: s, mult });
      if (!certs.includes("the factorisation over ℚ multiplying back exactly")) certs.push("the factorisation over ℚ multiplying back exactly");
      continue;
    }
    factorText.push({ poly, mult });
    steps.push(...out.steps);
    const noteErr = (): void => {
      const e = refs.relErr ?? NaN;
      worstErr = Number.isFinite(e) && Number.isFinite(worstErr) ? Math.max(worstErr, e) : NaN;
    };
    if (!out.cands) {
      if (out.reason) {
        if (/Abel/.test(out.reason)) caveats.push(out.reason);
        else reasons.push(`${polyStr(poly, x)}: ${out.reason}.`);
      }
      steps.push(`${polyStr(poly, x)}: all ${d} roots by Aberth–Ehrlich iteration, polished by Newton's method on the exact coefficients.`);
      for (const z of refs) built.push({ root: { display: fmtDec(z), re: z.re, im: z.im, exact: false, mult, certificate: "" }, key: "numeric" });
      noteErr();
      continue;
    }
    // 5. The numerical cross-check of every displayed form.
    const matched = matchCands(out.cands, refs, poly);
    if (!matched) {
      reasons.push(`${polyStr(poly, x)}: the closed form did not agree with the numerical roots, so it is withheld.`);
      for (const z of refs) built.push({ root: { display: fmtDec(z), re: z.re, im: z.im, exact: false, mult, certificate: "" }, key: "numeric" });
      noteErr();
      continue;
    }
    if (matched.some(({ c }) => c.display.length > POLY_EXACT_DISPLAY_MAX)) noteErr();
    if (out.certificate && !certs.includes(out.certificate)) certs.push(out.certificate);
    for (const { c, z } of matched) {
      const z2: Cx = { re: c.pureIm ? 0 : z.re, im: c.real ? 0 : z.im };
      if (c.display.length > POLY_EXACT_DISPLAY_MAX) {
        steps.push(
          `${METHOD_TEXT[out.method as Exclude<MethodKey, "numeric">].replace(/^exact \(|\)$/g, "")}: the closed form of ${fmtDec(z2)} runs to ` +
            `${c.display.length} characters (cap ${POLY_EXACT_DISPLAY_MAX}), so it is shown as a decimal.`,
        );
        built.push({ root: { display: fmtDec(z2), re: z2.re, im: z2.im, exact: false, mult, certificate: "" }, key: "numeric" });
      } else {
        built.push({ root: { display: c.display, re: z2.re, im: z2.im, exact: true, mult, certificate: out.certificate }, key: out.method });
      }
    }
  }

  // The whole factorisation.
  if (factorText.length > 1 || factorText.some((t) => t.mult > 1)) {
    const parts = factorText
      .slice()
      .sort((a, b) => (a.root && b.root ? ratSign(ratSub(b.root, a.root)) : a.root ? -1 : b.root ? 1 : 0))
      .map((t) => {
        const body = t.root ? (ratIsZero(t.root) ? x : `(${linFactor(t.root, x)})`) : `(${polyStr(t.poly!, x)})`;
        return t.mult > 1 ? `${body}^${t.mult}` : body;
      });
    steps.push(`Factored: ${ratEq(lead, RAT_ONE) ? "" : `${fmtRat(lead)}*`}${parts.join("*")} = 0.`);
  }

  built.sort((a, b) => b.root.re - a.root.re || a.root.im - b.root.im);
  for (const b of built) if (b.root.exact && /[a-z]/.test(b.root.display)) steps.push(`${x} = ${b.root.display} ≈ ${fmtDec({ re: b.root.re, im: b.root.im })}`);

  const allExact = built.every((b) => b.root.exact);
  let method: string;
  if (allExact) {
    const key = built.reduce<MethodKey>((acc, b) => (METHOD_RANK[b.key] > METHOD_RANK[acc] ? b.key : acc), "factored");
    method = METHOD_TEXT[key as Exclude<MethodKey, "numeric">];
    caveats.unshift(
      `Exact: certified by ${certs.join("; ")}; the displayed form re-parses and agrees with the numerical root to 1e-9.`,
    );
  } else {
    method = "complete (all roots)";
    caveats.unshift(
      `Complete: every root is shown, real and complex, with exact multiplicities (square-free factorisation over ℚ). ` +
        (Number.isFinite(worstErr)
          ? `Numerical roots: Newton's method on the exact coefficients; the last correction measured was below ${Math.max(worstErr, 1e-16).toExponential(0)} relative.`
          : `Numerical roots: no precision is claimed (the final exact Newton check did not complete).`) +
        (reasons.length ? ` Not in closed form: ${reasons.join(" ")}` : ""),
    );
    if (built.some((b) => b.root.exact)) {
      caveats.push(`The roots shown in closed form are exact: certified by ${certs.join("; ")}.`);
    }
  }
  if (incomplete) {
    caveats.push("The rational-root search was capped (very large constant or leading coefficient), so no claim is made that what remained has no rational root.");
  }
  return { roots: built.map((b) => b.root), method, steps, caveats, incomplete };
}

function linFactor(r: Rat, x: string): string {
  if (ratIsZero(r)) return x;
  return ratSign(r) > 0 ? `${x} - ${fmtRat(r)}` : `${x} + ${fmtRat(ratNeg(r))}`;
}

/**
 * Pairs each candidate with a distinct numerical root: it must re-parse, agree
 * to 1e-9 relative, be real exactly when its root is real, and the root must
 * pass the residual test |p(r)| ≤ 1e-12·Σ|aₖ||r|ᵏ. Null on any failure.
 */
function matchCands(cands: Cand[], refs: Cx[], poly: P): { c: Cand; z: Cx }[] | null {
  if (cands.length !== refs.length) return null;
  const c = monic(poly).map(ratToNumber);
  for (const z of refs) {
    const { v, scale } = evalCx(c, z);
    if (!(cAbs(v) <= 1e-12 * Math.max(scale, 1e-300) + 1e-300)) return null;
  }
  const used = new Set<number>();
  const out: { c: Cand; z: Cx }[] = [];
  for (const cd of cands) {
    const v = evalDisplay(cd.display);
    if (!v) return null;
    let best = -1, bestD = Infinity;
    refs.forEach((z, k) => {
      if (used.has(k)) return;
      const dd = cAbs(cSub(v, z));
      if (dd < bestD) { bestD = dd; best = k; }
    });
    if (best < 0) return null;
    const z = refs[best];
    if (!(bestD <= AGREE_TOL * Math.max(1, cAbs(z)))) return null;
    if (cd.real !== (z.im === 0)) return null;
    used.add(best);
    out.push({ c: cd, z });
  }
  return out;
}
