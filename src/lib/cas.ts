// CAS core: canonical forms for the Solve engine (docs/CAS-DESIGN.md).
//
// Every expression is normalised to a RATIONAL FUNCTION OVER ATOMS:
//   * an ATOM is a variable (x, m, F) or an opaque non-polynomial subexpression
//     (sin(x), e^x, x^y, x^0.5), keyed by the canonical string of its own
//     normalised form — so sin(x+0) and sin(x) are the same atom;
//   * a MONOMIAL is an exact rational coefficient times atom^positive-integer
//     factors;
//   * a POLYNOMIAL is a sorted, merged list of monomials;
//   * an EXPRESSION is num/den with common factors cancelled.
//
// Coefficients are EXACT RATIONALS over BigInt, never floats: 1/3 + 1/3 + 1/3
// is exactly 1, and canonical equality would be unreliable at the 15th digit
// with float coefficients. A JS number entering the CAS is converted through
// its decimal string form, which round-trips the double exactly.
//
// TOTALITY: anything that does not fit the representation becomes an opaque
// atom rather than throwing; where even that fails (division by an expression
// that normalises to zero, a non-finite number) normalisation aborts with
// CasBail and the caller falls back to the old peephole simplifier, so no
// input can crash and no value can silently change.
//
// KNOWN VALUE CAVEATS (standard CAS behaviour, stated rather than hidden).
// Both are cases where the canonical form has a WIDER DOMAIN than the input:
//
//   * cancellation removes removable singularities — x/x normalises to 1,
//     which differs from the original at x = 0;
//   * the sqrt rule takes the principal branch, so sqrt(x)^2 normalises to x,
//     which is finite at x = −4 where the original is NaN. (This is what lets
//     a quadratic solution verify to exactly 0 on substitution, so it is
//     deliberate rather than incidental.)
//
// Equality and simplification are therefore of the RATIONAL FUNCTIONS, not of
// the pointwise partial functions. Callers that integrate or evaluate over an
// interval must check the ORIGINAL expression's domain — solve.ts's integrate()
// does exactly that, because otherwise ∫sqrt(x)² over [−1,1] comes back as a
// confident "exact 0" for an integral that does not exist.
//
// Cancellation implemented: rational-coefficient content, common monomial
// factors (covers x/x, x²y/xy), and full polynomial GCD when numerator and
// denominator are univariate in the SAME single atom (covers (x²−1)/(x−1),
// sin²/sin) — all inside every arithmetic step. Since v2.136.0 a MULTIVARIATE
// GCD runs once at the output boundary of casSimplify ((x²−y²)/(x−y) → x + y),
// within named caps (≤ 4 symbols, degree ≤ 12, ≤ 200 terms); past a cap the
// fraction stays unreduced, which is correct, just not minimal.

// Structurally identical to solve.ts's Expr; type-only import avoids a
// runtime cycle (solve.ts imports this module's functions).
import type { Expr } from "./solve";

/** Internal signal: this expression cannot be represented; fall back. */
export class CasBail extends Error {}

// ---------------------------------------------------------------------------
// Exact rationals over BigInt. d > 0 always; gcd-reduced always.
// ---------------------------------------------------------------------------

interface Q {
  n: bigint;
  d: bigint;
}

const bAbs = (a: bigint): bigint => (a < 0n ? -a : a);

function bGcd(a: bigint, b: bigint): bigint {
  a = bAbs(a);
  b = bAbs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function qMake(n: bigint, d: bigint): Q {
  if (d === 0n) throw new CasBail("division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bGcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

const Q_ZERO: Q = { n: 0n, d: 1n };
const Q_ONE: Q = { n: 1n, d: 1n };

const qAdd = (a: Q, b: Q): Q => qMake(a.n * b.d + b.n * a.d, a.d * b.d);
const qMul = (a: Q, b: Q): Q => qMake(a.n * b.n, a.d * b.d);
const qDiv = (a: Q, b: Q): Q => qMake(a.n * b.d, a.d * b.n);
const qNeg = (a: Q): Q => ({ n: -a.n, d: a.d });
const qIsZero = (a: Q): boolean => a.n === 0n;
const qIsOne = (a: Q): boolean => a.n === 1n && a.d === 1n;
const qIsInt = (a: Q): boolean => a.d === 1n;

/**
 * Exact rational from a JS number, via its decimal string form. String(v)
 * round-trips the double exactly, so the rational's value IS the float's
 * value — nothing is invented and nothing is lost.
 */
function qFromNumber(v: number): Q {
  if (!Number.isFinite(v)) throw new CasBail("non-finite number");
  if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return qMake(BigInt(v), 1n);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(v));
  if (!m) throw new CasBail(`unrepresentable number ${v}`);
  const [, sign, int, frac = "", expStr] = m;
  const exp = (expStr ? parseInt(expStr, 10) : 0) - frac.length;
  let n = BigInt(int + frac);
  if (sign === "-") n = -n;
  return exp >= 0 ? qMake(n * 10n ** BigInt(exp), 1n) : qMake(n, 10n ** BigInt(-exp));
}

/**
 * Exact rational to the nearest double.
 *
 * The obvious `Number(a.n) / Number(a.d)` is right almost always and WRONG in
 * the one case this library exists to handle. Numerator and denominator are
 * converted to doubles INDEPENDENTLY, so a ratio whose two sides are each above
 * ~1.8e308 becomes Infinity/Infinity = NaN even when the ratio itself is an
 * ordinary small number. That is not hypothetical: a beam on a very soft spring
 * with a very small EI produces a reaction of exactly 15 as a 604-digit over
 * 603-digit rational, and this function reported it as NaN. The exact answer was
 * perfect; only the last step — the one that hands the number to the user — threw
 * it away. It was reachable on the plain rigid-support path too (a distributed
 * load of 1e308 on an 8 m span), so it predates elastic supports.
 *
 * The fast path stays first, because this is called on every coefficient of
 * every result and is byte-identical to the old expression whenever both sides
 * convert finitely.
 *
 * THE SLOW PATH IS CORRECTLY ROUNDED, and getting there took two attempts that
 * were each wrong in an instructive way.
 *
 * The first shifted both sides right until the SMALLER had ~64 bits left. That
 * preserves the ratio but leaves the LARGER side with `gap + 64` bits, so it
 * still overflowed once the gap exceeded ~960 even though a double does not run
 * out until 1024 — a band, gaps 961 to 1023, where a representable number came
 * back as Infinity, mirrored by a band returning 0 across the whole subnormal
 * range. 3^807 / 5^120 is about 1e301 with a gap of 1001 bits, and came back
 * as Infinity. Being wrong in a BAND is worse than being wrong everywhere: the tests
 * sampled either side and passed.
 *
 * The second divided first and scaled afterwards, always carrying exactly 64
 * bits of quotient. That fixed the band but rounded TWICE — the BigInt division
 * floors, and `Number()` then rounds again — so it was off by 1 ULP at a small
 * but real rate. In the subnormal range 1 ULP is a 20-100% relative error, and
 * one constructed ratio came back as 0 where the answer is MIN_VALUE.
 *
 * This version picks the shift from the RESULT'S exponent rather than using a
 * fixed 64, so the division lands exactly on the double grid — 53 significant
 * bits for a normal result, or the 2^-1074 subnormal grid — and rounds that one
 * division half-to-even itself. One rounding, in the right place, so the answer
 * is the nearest double rather than within one of it. The scale is applied as
 * TWO half-powers, because a single `2**-s` would overflow or flush to zero at
 * the extremes and reintroduce the first bug.
 *
 * A genuinely out-of-range ratio still returns Infinity or 0. The early exits
 * also bound the work: without them a ratio with a millions-of-bits gap would
 * shift a BigInt by that many bits to discover an answer the bit lengths already
 * gave. `bitLen` goes through base 16 rather than base 2 for the same reason —
 * both are linear, but base 2 builds a string four times longer, and at a
 * million digits that alone cost more than everything it was protecting.
 *
 * Verified by an EXACT verifier in ratToNumberOverflow.test.ts, which does not
 * recompute the answer but checks in integer arithmetic that no neighbouring
 * double is closer. The previous test compared against a "reference" that was a
 * line-for-line copy of this function, which is no check at all.
 */
const qToNumber = (a: Q): number => {
  // THE FAST PATH IS ONLY TAKEN WHERE IT IS PROVABLY EXACT: both sides at most
  // 2^53, so `Number()` loses nothing and the single division is correctly
  // rounded by IEEE-754.
  //
  // It used to be taken whenever both sides merely converted FINITELY, which is
  // true up to ~1.8e308 — and above 2^53 `Number()` rounds, so the result was
  // rounded twice and came out 1 to 2 ULP wrong in roughly a third of cases.
  // That made this library's exact-rational pipeline LESS accurate than the
  // naive parse it exists to improve on: `parseRatLiteral("6.721856781630347414583")`
  // returned 6.721856781630347 where `Number()` of the same text gives the
  // correct 6.721856781630348.
  //
  // The exact path costs 0.3-0.9 microseconds against about 0.06, which is worth
  // it for a function whose whole purpose is to hand over the right number.
  const SAFE = 9007199254740992n; // 2^53
  const an = a.n < 0n ? -a.n : a.n;
  const ad = a.d < 0n ? -a.d : a.d;
  if (an <= SAFE && ad <= SAFE) return Number(a.n) / Number(a.d);

  const neg = a.n < 0n !== a.d < 0n;
  const N = a.n < 0n ? -a.n : a.n;
  const D = a.d < 0n ? -a.d : a.d;
  if (N === 0n) return neg ? -0 : 0;
  if (D === 0n) return neg ? -Infinity : Infinity;

  // Base 16, not base 2: same linear cost, a quarter of the string.
  const bitLen = (v: bigint): number => {
    const hex = v.toString(16);
    return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0], 16)));
  };
  // log2 of the result, to within one bit.
  const e = bitLen(N) - bitLen(D);
  if (e > 1100) return neg ? -Infinity : Infinity;
  if (e < -1200) return neg ? -0 : 0;

  /** round(N * 2^s / D) with ties to even — the single rounding. */
  const scaled = (s: number): bigint => {
    const num = s >= 0 ? N << BigInt(s) : N;
    const den = s >= 0 ? D : D << BigInt(-s);
    const q = num / den;
    const twice = (num % den) * 2n;
    return twice > den || (twice === den && (q & 1n) === 1n) ? q + 1n : q;
  };

  let E = e - 1;
  let s = E >= -1022 ? 52 - E : 1074;
  let m = scaled(s);
  // Rounding can carry into the next binary exponent; redo once at the new one.
  if (m >= 1n << 53n) {
    E += 1;
    s = E >= -1022 ? 52 - E : 1074;
    m = scaled(s);
  }

  const s1 = Math.trunc(s / 2);
  const s2 = s - s1;
  const v = Number(m) * Math.pow(2, -s1) * Math.pow(2, -s2);
  return neg ? -v : v;
};

// ---------------------------------------------------------------------------
// Monomials and polynomials.
// ---------------------------------------------------------------------------

/** Coefficient times a product of atom^exp with exp ≥ 1 integer. */
interface Mono {
  c: Q;
  a: Map<string, number>;
}

/** Canonical: like terms merged, zero coefficients dropped, sorted. */
type Poly = Mono[];

/** Guards against exponential blowup expanding e.g. (a+b+c)^40. */
const MAX_TERMS = 4000;
/** Integer exponents beyond this are kept opaque rather than expanded. */
const MAX_EXPAND_POW = 64;

function monoKey(m: Mono): string {
  return [...m.a.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, e]) => `${k}^${e}`)
    .join("*");
}

const monoDeg = (m: Mono): number => {
  let d = 0;
  for (const e of m.a.values()) d += e;
  return d;
};

/** Graded order: total degree first, then the deterministic key. */
function monoCmp(x: Mono, y: Mono): number {
  const dx = monoDeg(x), dy = monoDeg(y);
  if (dx !== dy) return dy - dx;
  const kx = monoKey(x), ky = monoKey(y);
  return kx < ky ? -1 : kx > ky ? 1 : 0;
}

/** Merges like terms, drops zeros, sorts — the canonical form of a sum. */
function pNorm(terms: Mono[]): Poly {
  const byKey = new Map<string, Mono>();
  for (const t of terms) {
    if (qIsZero(t.c)) continue;
    const k = monoKey(t);
    const prev = byKey.get(k);
    if (prev) prev.c = qAdd(prev.c, t.c);
    else byKey.set(k, { c: t.c, a: new Map(t.a) });
  }
  const out = [...byKey.values()].filter((t) => !qIsZero(t.c));
  out.sort(monoCmp);
  if (out.length > MAX_TERMS) throw new CasBail("too many terms");
  return out;
}

const pConst = (q: Q): Poly => (qIsZero(q) ? [] : [{ c: q, a: new Map() }]);
const pAtom = (key: string): Poly => [{ c: Q_ONE, a: new Map([[key, 1]]) }];
const P_ONE = (): Poly => pConst(Q_ONE);

const pIsZero = (p: Poly): boolean => p.length === 0;
const pIsConst = (p: Poly): boolean => p.length === 0 || (p.length === 1 && p[0].a.size === 0);
const pGetConst = (p: Poly): Q => (p.length === 0 ? Q_ZERO : p[0].c);
const pIsOne = (p: Poly): boolean => pIsConst(p) && qIsOne(pGetConst(p));

const pAdd = (a: Poly, b: Poly): Poly => pNorm([...a, ...b]);
const pNeg = (a: Poly): Poly => a.map((t) => ({ c: qNeg(t.c), a: new Map(t.a) }));
const pScale = (a: Poly, q: Q): Poly => (qIsZero(q) ? [] : a.map((t) => ({ c: qMul(t.c, q), a: new Map(t.a) })));

function pMul(a: Poly, b: Poly): Poly {
  if (a.length * b.length > MAX_TERMS) throw new CasBail("too many terms");
  const terms: Mono[] = [];
  for (const x of a) {
    for (const y of b) {
      const m = new Map(x.a);
      for (const [k, e] of y.a) m.set(k, (m.get(k) ?? 0) + e);
      terms.push({ c: qMul(x.c, y.c), a: m });
    }
  }
  return pNorm(terms);
}

function pPow(a: Poly, k: number): Poly {
  let out = P_ONE();
  for (let i = 0; i < k; i++) out = pMul(out, a);
  return out;
}

/** Every atom key that appears anywhere in the polynomial. */
function pAtoms(p: Poly): Set<string> {
  const s = new Set<string>();
  for (const t of p) for (const k of t.a.keys()) s.add(k);
  return s;
}

/** Smallest exponent of `atom` across ALL terms (0 if any term lacks it). */
function pMinExp(p: Poly, atom: string): number {
  let min = Infinity;
  for (const t of p) min = Math.min(min, t.a.get(atom) ?? 0);
  return p.length ? min : 0;
}

/** Divides every term by atom^e (caller guarantees divisibility). */
function pShiftDown(p: Poly, atom: string, e: number): Poly {
  return p.map((t) => {
    const m = new Map(t.a);
    const cur = m.get(atom) ?? 0;
    if (cur - e > 0) m.set(atom, cur - e);
    else m.delete(atom);
    return { c: t.c, a: m };
  });
}

// ---------------------------------------------------------------------------
// Univariate view — for GCD cancellation and for solving in one atom.
// ---------------------------------------------------------------------------

/**
 * Dense ascending coefficients of `p` viewed as univariate in `atom`, where
 * every OTHER atom content of each term becomes part of the coefficient…
 * which must therefore be constant. Returns null if any coefficient would
 * involve another atom.
 */
function pAsUnivariate(p: Poly, atom: string): Q[] | null {
  const coeffs: Q[] = [];
  for (const t of p) {
    let deg = 0;
    for (const [k, e] of t.a) {
      if (k === atom) deg = e;
      else return null;
    }
    while (coeffs.length <= deg) coeffs.push(Q_ZERO);
    coeffs[deg] = qAdd(coeffs[deg], t.c);
  }
  while (coeffs.length && qIsZero(coeffs[coeffs.length - 1])) coeffs.pop();
  return coeffs;
}

function uniToPoly(coeffs: Q[], atom: string): Poly {
  const terms: Mono[] = [];
  coeffs.forEach((c, k) => {
    if (qIsZero(c)) return;
    terms.push({ c, a: k === 0 ? new Map() : new Map([[atom, k]]) });
  });
  return pNorm(terms);
}

/** Remainder of a ÷ b over exact rationals (b non-empty). */
function uniRem(a: Q[], b: Q[]): Q[] {
  const r = a.map((q) => ({ ...q }));
  const db = b.length - 1;
  const lead = b[db];
  while (r.length - 1 >= db && r.length > 0) {
    const dr = r.length - 1;
    const f = qDiv(r[dr], lead);
    for (let i = 0; i <= db; i++) {
      r[dr - db + i] = qAdd(r[dr - db + i], qNeg(qMul(f, b[i])));
    }
    while (r.length && qIsZero(r[r.length - 1])) r.pop();
    if (r.length - 1 === dr) throw new CasBail("division did not reduce degree");
  }
  return r;
}

/** Exact quotient a ÷ b when b divides a. */
function uniDivExact(a: Q[], b: Q[]): Q[] {
  const r = a.map((q) => ({ ...q }));
  const out: Q[] = new Array(Math.max(0, a.length - b.length + 1)).fill(Q_ZERO);
  const db = b.length - 1;
  const lead = b[db];
  while (r.length - 1 >= db && r.length > 0) {
    const dr = r.length - 1;
    const f = qDiv(r[dr], lead);
    out[dr - db] = f;
    for (let i = 0; i <= db; i++) {
      r[dr - db + i] = qAdd(r[dr - db + i], qNeg(qMul(f, b[i])));
    }
    while (r.length && qIsZero(r[r.length - 1])) r.pop();
  }
  if (r.length) throw new CasBail("inexact division");
  while (out.length && qIsZero(out[out.length - 1])) out.pop();
  return out;
}

/** Monic GCD by Euclid's algorithm over exact rationals. */
function uniGcd(a: Q[], b: Q[]): Q[] {
  let x = a.slice(), y = b.slice();
  while (y.length) {
    const r = uniRem(x, y);
    x = y;
    y = r;
  }
  const lead = x[x.length - 1];
  return x.map((c) => qDiv(c, lead));
}

// ---------------------------------------------------------------------------
// Rational functions num/den, normalised on construction.
// ---------------------------------------------------------------------------

interface RF {
  n: Poly;
  d: Poly;
}

// ---------------------------------------------------------------------------
// Exact radicals (opt-in, CasOptions.exactRadicals). While an exact-mode
// normalisation runs, ALG maps each ALGEBRAIC atom key to its relation
// atom^k = rad: sqrt(2)^2 = 2, cbrt(5)^3 = 5, 2^(1/4)^4 = 2, and for a radical
// of an algebraic constant, sqrt(sqrt(2) - 1/2)^2 = sqrt(2) - 1/2. Every
// polynomial is reduced modulo those relations inside rfNorm, which is where
// products land — the syntactic sqrt(A)^n rule in normalize never sees
// (sqrt(2) + sqrt(3))^4.
//
// SOUNDNESS does not depend on canonicity: every relation used is TRUE, so a
// reduction to 0 proves the value is 0. Canonicity (so that a nonzero value never
// reduces to 0 AND every zero does) holds for radicals of rationals because the
// radicands are split into primes and products of p^(1/2), p^(1/3) and p^(1/n)
// with exponents below the index are linearly independent over ℚ (Besicovitch).
// A radicand too large to factor, or a radical of an algebraic number, can only
// cost a FALSE NEGATIVE — `false` from exprEqual in exact mode is not a refutation.
//
// Module state rather than a parameter because rfNorm is reached from every
// arithmetic helper; it is set and RESTORED in a finally by withAlg, and it is
// null (zero cost) on every default-mode call.
// ---------------------------------------------------------------------------

interface AlgInfo {
  /** The index: atom^k reduces. */
  k: number;
  /** What atom^k equals — a polynomial in rationals and other algebraic atoms. */
  rad: Poly;
}

let ALG: Map<string, AlgInfo> | null = null;
function withAlg<T>(exact: boolean, fn: () => T): T {
  const prev = ALG;
  ALG = exact ? new Map() : null;
  try {
    return fn();
  } finally {
    ALG = prev;
  }
}

/** Reduces every algebraic atom's exponent below its index. */
function algReduce(p: Poly): Poly {
  const alg = ALG;
  if (!alg || alg.size === 0) return p;
  for (let round = 0; round < 64; round++) {
    let changed = false;
    const out: Mono[] = [];
    for (const t of p) {
      let hit: [string, number, AlgInfo] | null = null;
      for (const [k, e] of t.a) {
        const info = alg.get(k);
        if (info && e >= info.k) {
          hit = [k, e, info];
          break;
        }
      }
      if (!hit) {
        out.push(t);
        continue;
      }
      changed = true;
      const [key, e, info] = hit;
      const m = new Map(t.a);
      const rem = e % info.k;
      if (rem) m.set(key, rem);
      else m.delete(key);
      out.push(...pMul([{ c: t.c, a: m }], pPow(info.rad, Math.floor(e / info.k))));
    }
    p = pNorm(out);
    if (!changed) return p;
  }
  throw new CasBail("radical reduction did not settle");
}

/** Is every atom of the polynomial an algebraic atom with a RATIONAL square? */
function sqrtOnlyMono(m: Mono): Q | null {
  const alg = ALG;
  if (!alg || m.a.size === 0) return null;
  let sq = Q_ONE;
  for (const [k, e] of m.a) {
    const info = alg.get(k);
    if (!info || info.k !== 2 || e !== 1 || !pIsConst(info.rad)) return null;
    sq = qMul(sq, pGetConst(info.rad));
  }
  return sq;
}

/**
 * Exact-mode denominator clean-up: a monomial denominator of radicals is
 * rationalised (1/sqrt(2) → sqrt(2)/2), and so is r0 + r1·w with w a product of
 * square roots of rationals (1/(1 + sqrt(2)) → sqrt(2) - 1). Anything else is
 * left alone — still exact, just not rationalised.
 */
function algRationalise(n: Poly, d: Poly): [Poly, Poly] {
  const alg = ALG;
  if (!alg || alg.size === 0) return [n, d];
  if (d.length === 1) {
    let mult: Poly = P_ONE();
    let any = false;
    for (const [k, e] of d[0].a) {
      const info = alg.get(k);
      if (info && e < info.k) {
        mult = pMul(mult, [{ c: Q_ONE, a: new Map([[k, info.k - e]]) }]);
        any = true;
      }
    }
    if (any) return [algReduce(pMul(n, mult)), algReduce(pMul(d, mult))];
    return [n, d];
  }
  if (d.length === 2) {
    const c0 = d.find((t) => t.a.size === 0);
    const w = d.find((t) => t.a.size > 0);
    if (c0 && w && sqrtOnlyMono(w)) {
      const conj: Poly = pNorm([{ c: c0.c, a: new Map() }, { c: qNeg(w.c), a: new Map(w.a) }]);
      return [algReduce(pMul(n, conj)), algReduce(pMul(d, conj))];
    }
  }
  return [n, d];
}

function rfNorm(n: Poly, d: Poly): RF {
  if (ALG) {
    n = algReduce(n);
    d = algReduce(d);
    if (!pIsZero(d) && !pIsZero(n)) [n, d] = algRationalise(n, d);
  }
  if (pIsZero(d)) throw new CasBail("zero denominator");
  if (pIsZero(n)) return { n: [], d: P_ONE() };

  // 1. Cancel the common monomial factor (atoms present in every term of both).
  for (const atom of pAtoms(d)) {
    const e = Math.min(pMinExp(n, atom), pMinExp(d, atom));
    if (e > 0) {
      n = pShiftDown(n, atom, e);
      d = pShiftDown(d, atom, e);
    }
  }

  // 2. Full GCD when both sides are univariate in the same single atom.
  if (!pIsConst(d)) {
    const atoms = new Set([...pAtoms(n), ...pAtoms(d)]);
    if (atoms.size === 1) {
      const [atom] = atoms;
      const un = pAsUnivariate(n, atom);
      const ud = pAsUnivariate(d, atom);
      if (un && ud && un.length && ud.length) {
        const g = uniGcd(un, ud);
        if (g.length > 1) {
          n = uniToPoly(uniDivExact(un, g), atom);
          d = uniToPoly(uniDivExact(ud, g), atom);
        }
      }
    }
  }

  // 3. Constant denominator folds into the numerator.
  if (pIsConst(d)) return { n: pScale(n, qDiv(Q_ONE, pGetConst(d))), d: P_ONE() };

  // 4. Scale so the denominator has coprime integer coefficients with a
  //    positive leading coefficient — the unique representative.
  let lcm = 1n;
  for (const t of d) lcm = (lcm / bGcd(lcm, t.c.d)) * t.c.d;
  let gcd = 0n;
  for (const t of d) gcd = bGcd(gcd, t.c.n * (lcm / t.c.d));
  let f = qMake(lcm, gcd || 1n);
  if (d[0].c.n < 0n) f = qNeg(f); // d is sorted; d[0] is the leading term
  return { n: pScale(n, f), d: pScale(d, f) };
}

const rfConst = (q: Q): RF => ({ n: pConst(q), d: P_ONE() });
const rfAtom = (key: string): RF => ({ n: pAtom(key), d: P_ONE() });

const rfAdd = (a: RF, b: RF): RF => rfNorm(pAdd(pMul(a.n, b.d), pMul(b.n, a.d)), pMul(a.d, b.d));
const rfNeg = (a: RF): RF => ({ n: pNeg(a.n), d: a.d });
const rfSub = (a: RF, b: RF): RF => rfAdd(a, rfNeg(b));
const rfMul = (a: RF, b: RF): RF => rfNorm(pMul(a.n, b.n), pMul(a.d, b.d));
function rfDiv(a: RF, b: RF): RF {
  if (pIsZero(b.n)) throw new CasBail("division by zero");
  return rfNorm(pMul(a.n, b.d), pMul(a.d, b.n));
}
function rfPowInt(a: RF, k: number): RF {
  if (k === 0) return rfConst(Q_ONE);
  if (k < 0) return rfPowInt(rfDiv(rfConst(Q_ONE), a), -k);
  return rfNorm(pPow(a.n, k), pPow(a.d, k));
}

const rfIsConst = (a: RF): boolean => pIsConst(a.n) && pIsOne(a.d);
const rfIsZero = (a: RF): boolean => pIsZero(a.n);

// ---------------------------------------------------------------------------
// Normalisation context: atom key -> the canonical Expr it stands for.
// ---------------------------------------------------------------------------

interface Ctx {
  atoms: Map<string, Expr>;
  /** CasOptions.exactRadicals: functions of constants stay exact (see ALG). */
  exact?: boolean;
  /**
   * Equality-only: split a symbolic exponent's integer constant, so x^(y-1)
   * becomes atom(x^y)·x^-1 and compares equal to x^y/x. NOT used for display —
   * casSimplify would otherwise print e*e^x where it printed e^(x + 1).
   */
  splitExp?: boolean;
}

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Numeric function folding table. Must agree with solve.ts's EVAL_FN — it is
 * duplicated (rather than imported) to keep this module cycle-free; the
 * evaluatorAgreement suite is the drift guard for shared vocabulary.
 */
const FN_NUM: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  // The unit step folds at a constant (u(3) = 1); the impulse deliberately
  // does not appear here, so delta(constant) bails rather than folds.
  u: (v: number) => (v >= 0 ? 1 : 0),
  heaviside: (v: number) => (v >= 0 ? 1 : 0),
  step: (v: number) => (v >= 0 ? 1 : 0),
};

// ---------------------------------------------------------------------------
// Internal deterministic formatter (atom keys). Mirrors solve.ts format(),
// but only determinism matters here, not display polish.
// ---------------------------------------------------------------------------

const KPREC: Record<Expr["t"], number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 2, pow: 3, fn: 4, num: 5, var: 5 };

function keyFmt(e: Expr): string {
  const wrap = (child: Expr, parentPrec: number): string => {
    const s = keyFmt(child);
    return KPREC[child.t] < parentPrec ? `(${s})` : s;
  };
  switch (e.t) {
    case "num": return String(e.v);
    case "var": return e.name;
    case "neg": return `-${wrap(e.e, KPREC.neg)}`;
    case "add": return `${wrap(e.l, KPREC.add)} + ${wrap(e.r, KPREC.add)}`;
    case "sub": return `${wrap(e.l, KPREC.sub)} - ${wrap(e.r, KPREC.sub)}`;
    case "mul": return `${wrap(e.l, KPREC.mul)}*${wrap(e.r, KPREC.mul)}`;
    case "div": return `${wrap(e.l, KPREC.div)}/${wrap(e.r, KPREC.div + 1)}`;
    case "pow": return `${wrap(e.l, KPREC.pow + 1)}^${wrap(e.r, KPREC.pow)}`;
    case "fn": return `${e.name}(${keyFmt(e.arg)})`;
  }
}

function atomFor(ctx: Ctx, e: Expr): RF {
  const key = keyFmt(e);
  if (!ctx.atoms.has(key)) ctx.atoms.set(key, e);
  return rfAtom(key);
}

// ---------------------------------------------------------------------------
// Expr -> RF
// ---------------------------------------------------------------------------

function normalize(e: Expr, ctx: Ctx): RF {
  switch (e.t) {
    case "num":
      return rfConst(qFromNumber(e.v));
    case "var":
      // pi and e stay symbolic atoms — the old simplifier never folded them
      // either, and folding would trade exactness for digits.
      return rfAtom(e.name);
    case "neg":
      return rfNeg(normalize(e.e, ctx));
    case "add":
      return rfAdd(normalize(e.l, ctx), normalize(e.r, ctx));
    case "sub":
      return rfSub(normalize(e.l, ctx), normalize(e.r, ctx));
    case "mul":
      return rfMul(normalize(e.l, ctx), normalize(e.r, ctx));
    case "div":
      return rfDiv(normalize(e.l, ctx), normalize(e.r, ctx));
    case "pow": {
      const exp = normalize(e.r, ctx);
      if (rfIsConst(exp)) {
        const q = pGetConst(exp.n);
        if (qIsInt(q) && bAbs(q.n) <= BigInt(MAX_EXPAND_POW)) {
          const k = Number(q.n);
          // sqrt(A)^n = A^(n/2) · sqrt(A)^(n mod 2) — principal branch; this is
          // what lets a quadratic solution verify to exactly 0 on substitution.
          if (e.l.t === "fn" && e.l.name === "sqrt" && k >= 0) {
            const inner = normalize(e.l.arg, ctx);
            const half = rfPowInt(inner, Math.floor(k / 2));
            return k % 2 === 0 ? half : rfMul(half, normalize(e.l, ctx));
          }
          // abs(A)^n = A^n FOR EVEN n, exactly — |A|^2 is A^2 for every real A,
          // with no branch to choose and no sign lost. For odd n it reduces to
          // A^(n-1)*abs(A), keeping one abs and cancelling the rest.
          //
          // Without this, `abs(A)` was an opaque atom that never reduced, and the
          // consequence was a GUARANTEE GAP rather than a wrong answer. casint
          // advertises a canonical correctness net — it differentiates every
          // candidate antiderivative back and demands exprEqual with the integrand —
          // and d/dx ln|x| simplifies to x/abs(x)^2, which is not recognisably 1/x
          // while abs(x)^2 stays opaque. So exprEqual was FALSE for every
          // partial-fraction and g'/g result, and those were accepted on the strength
          // of numeric agreement at eight fixed sample points with a floor of three.
          // Sixty-seven integrands swept on a deliberately disjoint grid found no
          // wrong antiderivative, so nothing was broken — but the advertised check
          // was not running on the largest class of results it exists to protect.
          if (e.l.t === "fn" && e.l.name === "abs" && k >= 0) {
            const inner = normalize(e.l.arg, ctx);
            if (k % 2 === 0) return rfPowInt(inner, k);
            return rfMul(rfPowInt(inner, k - 1), normalize(e.l, ctx));
          }
          const base = normalize(e.l, ctx);
          try {
            return rfPowInt(base, k);
          } catch (err) {
            if (!(err instanceof CasBail)) throw err;
            // Too big to expand — keep it opaque instead of failing.
            return atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r: numExpr(q) });
          }
        }
        // Non-integer constant exponent (x^0.5, x^-1.5): opaque atom, with the
        // base still canonicalised so equal bases share the atom.
        const base = normalize(e.l, ctx);
        // Exact mode: a positive rational to a rational power p/n is (c^(1/n))^p
        // with c^(1/n) an algebraic atom — 2^(1/4) to the 4th is exactly 2.
        if (ctx.exact && rfIsConst(base) && q.d <= 12n && bAbs(q.n) <= BigInt(MAX_EXPAND_POW)) {
          const c = pGetConst(base.n);
          if (c.n > 0n) return rfPowInt(exactRoot(Number(q.d), c, ctx), Number(q.n));
        }
        if (ctx.splitExp) {
          // Equality only: x^(23/4) = x^5 · x^(3/4), so it meets x^2·x^(15/4).
          const k = qFloor(q);
          if (k !== 0n && bAbs(k) <= BigInt(MAX_EXPAND_POW)) {
            const split = splitPow(base, pConst(qAdd(q, qMake(-k, 1n))), k, ctx);
            if (split) return split;
          }
        }
        return atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r: qToExpr(q) });
      }
      // Symbolic exponent (x^y, 2^x): opaque atom over canonicalised parts.
      const base = normalize(e.l, ctx);
      if (ctx.splitExp && pIsOne(exp.d)) {
        // x^(y + k) = x^y · x^k — the identity whose absence made x^y/x and
        // x^(y-1) compare unequal, so the Hessian of x^y was withheld as
        // "asymmetric". Only the FLOOR of the constant part is split off, so the
        // atom keeps a constant in [0, 1) — canonical — and x^(y/2), x^(-y) keep
        // their shape.
        const cTerm = exp.n.find((t) => t.a.size === 0);
        const k = cTerm ? qFloor(cTerm.c) : 0n;
        if (cTerm && k !== 0n && bAbs(k) <= BigInt(MAX_EXPAND_POW)) {
          const frac = qAdd(cTerm.c, qMake(-k, 1n));
          const rest = pNorm([...exp.n.filter((t) => t !== cTerm), ...pConst(frac)]);
          const split = splitPow(base, rest, k, ctx);
          if (split) return split;
        }
      }
      return atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r: rfToExpr(exp, ctx) });
    }
    case "fn": {
      // ln(e) = 1 (a derivative of e^(−x²/2) used to print a literal *ln(e)); log10(e) = 1/ln(10), log2(e) = 1/ln(2).
      if (e.arg.t === "var" && e.arg.name === "e") {
        if (e.name === "ln") return rfConst(Q_ONE);
        if (e.name === "log" || e.name === "log10" || e.name === "log2") {
          const lnBase: Expr = { t: "fn", name: "ln", arg: { t: "num", v: e.name === "log2" ? 2 : 10 } };
          return normalize({ t: "div", l: { t: "num", v: 1 }, r: lnBase }, ctx);
        }
      }
      const arg = normalize(e.arg, ctx);
      if (ctx.exact) {
        const ex = exactFn(e.name, arg, ctx);
        if (ex) return ex;
      }
      if (rfIsConst(arg)) {
        // Fold functions of constants numerically — the behaviour the shipping
        // simplifier always had (sqrt(4) → 2, ln(2) → 0.693…).
        const f = FN_NUM[e.name];
        if (!f) throw new CasBail(`unknown function ${e.name}`);
        return rfConst(qFromNumber(f(qToNumber(pGetConst(arg.n)))));
      }
      return atomFor(ctx, { t: "fn", name: e.name, arg: rfToExpr(arg, ctx) });
    }
  }
}

/** Floor of a rational. */
function qFloor(q: Q): bigint {
  const f = q.n / q.d; // truncates toward zero
  return q.n < 0n && f * q.d !== q.n ? f - 1n : f;
}

/**
 * base^(rest + k) as atom(base^rest) · base^k (splitExp only). Null — keep the
 * whole power opaque — when base^k cannot be formed (0^-1, too large).
 */
function splitPow(base: RF, rest: Poly, k: bigint, ctx: Ctx): RF | null {
  try {
    const powK = rfPowInt(base, Number(k));
    const r: Expr = pIsConst(rest) ? qToExpr(pGetConst(rest)) : polyToExpr(rest, ctx);
    const atom = atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r });
    return rfMul(atom, powK);
  } catch (err) {
    if (!(err instanceof CasBail)) throw err;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exact-mode constants (CasOptions.exactRadicals).
// ---------------------------------------------------------------------------

/** Floor of the n-th root of v ≥ 0 (Newton on BigInt). */
function bRoot(v: bigint, n: number): bigint {
  if (v < 2n) return v;
  const N = BigInt(n);
  // Start above the root: 2^ceil(bits/n).
  let x = 1n << BigInt(Math.ceil(v.toString(2).length / n));
  for (;;) {
    const y = ((N - 1n) * x + v / x ** (N - 1n)) / N;
    if (y >= x) break;
    x = y;
  }
  while (x ** N > v) x -= 1n;
  while ((x + 1n) ** N <= v) x += 1n;
  return x;
}

/** Trial division to 10^5; `rest` is whatever is left (1, a prime, or unfactored). */
function factorSmall(v: bigint): { primes: Map<bigint, number>; rest: bigint } {
  const primes = new Map<bigint, number>();
  let rest = v;
  const take = (p: bigint): void => {
    while (rest % p === 0n) {
      rest /= p;
      primes.set(p, (primes.get(p) ?? 0) + 1);
    }
  };
  take(2n);
  for (let p = 3n; p <= 100000n && p * p <= rest; p += 2n) take(p);
  // Everything left is ≥ 1; if it is below 10^10 it is prime (or 1).
  if (rest > 1n && rest <= 10000000000n) {
    primes.set(rest, (primes.get(rest) ?? 0) + 1);
    rest = 1n;
  }
  return { primes, rest };
}

/** An algebraic atom for R^(1/n), R > 1 an integer, registered with ALG. */
function radAtom(ctx: Ctx, n: number, R: bigint): RF {
  if (R > BigInt(Number.MAX_SAFE_INTEGER)) throw new CasBail("radicand too large to keep exact");
  const r = N(Number(R));
  const e: Expr =
    n === 2 ? { t: "fn", name: "sqrt", arg: r }
      : n === 3 ? { t: "fn", name: "cbrt", arg: r }
        : { t: "pow", l: r, r: { t: "div", l: N(1), r: N(n) } };
  const key = keyFmt(e);
  if (!ctx.atoms.has(key)) ctx.atoms.set(key, e);
  ALG?.set(key, { k: n, rad: pConst(qMake(R, 1n)) });
  return rfAtom(key);
}

/**
 * The real n-th root of a rational, exactly: perfect powers come out
 * (sqrt(8) = 2*sqrt(2)), the denominator is rationalised (cbrt(1/2) = cbrt(4)/2),
 * and for n = 2, 3 the radicand is split into primes so that sqrt(6) and
 * sqrt(2)*sqrt(3) are the same element (display merges them back).
 */
function exactRoot(n: number, q: Q, ctx: Ctx): RF {
  if (qIsZero(q)) return rfConst(Q_ZERO);
  if (q.n < 0n) {
    if (n % 2 === 0) throw new CasBail("even root of a negative constant");
    return rfNeg(exactRoot(n, qNeg(q), ctx));
  }
  // (a/b)^(1/n) = (a·b^(n-1))^(1/n) / b
  const radicand = q.n * q.d ** BigInt(n - 1);
  if (radicand.toString(16).length > 128) throw new CasBail("radicand too large to keep exact");
  let out: RF = rfConst(qMake(1n, q.d));
  const { primes, rest } = factorSmall(radicand);
  let combined = 1n; // n ≥ 4: one atom of the n-th-power-free part
  const push = (p: bigint, e: number): void => {
    const whole = Math.floor(e / n);
    if (whole) out = rfMul(out, rfConst(qMake(p ** BigInt(whole), 1n)));
    const rem = e % n;
    if (!rem) return;
    if (n <= 3) out = rfMul(out, rfPowInt(radAtom(ctx, n, p), rem));
    else combined *= p ** BigInt(rem);
  };
  for (const [p, e] of primes) push(p, e);
  if (rest > 1n) {
    const r = bRoot(rest, n);
    if (r ** BigInt(n) === rest) out = rfMul(out, rfConst(qMake(r, 1n)));
    else {
      // Unfactored and not a perfect power: kept as ONE radicand. Sound; at worst
      // a false negative against a differently-factored spelling.
      push(rest, 1);
    }
  }
  if (combined > 1n) out = rfMul(out, radAtom(ctx, n, combined));
  return out;
}

/** Numeric value of a variable-free Expr (pi and e known); NaN otherwise. */
function numEvalExpr(e: Expr): number {
  switch (e.t) {
    case "num": return e.v;
    case "var": return e.name === "pi" ? Math.PI : e.name === "e" ? Math.E : NaN;
    case "neg": return -numEvalExpr(e.e);
    case "add": return numEvalExpr(e.l) + numEvalExpr(e.r);
    case "sub": return numEvalExpr(e.l) - numEvalExpr(e.r);
    case "mul": return numEvalExpr(e.l) * numEvalExpr(e.r);
    case "div": return numEvalExpr(e.l) / numEvalExpr(e.r);
    case "pow": return Math.pow(numEvalExpr(e.l), numEvalExpr(e.r));
    case "fn": {
      const f = FN_NUM[e.name];
      return f ? f(numEvalExpr(e.arg)) : NaN;
    }
  }
}

function polyNum(p: Poly, ctx: Ctx): number {
  let s = 0;
  for (const t of p) {
    let v = qToNumber(t.c);
    for (const [k, e] of t.a) v *= Math.pow(numEvalExpr(atomExpr(ctx, k)), e);
    s += v;
  }
  return s;
}

const rfNum = (rf: RF, ctx: Ctx): number => polyNum(rf.n, ctx) / polyNum(rf.d, ctx);

/** Every atom of rf is an algebraic (ALG) atom, and there is at least one. */
function isAlgebraicConst(rf: RF): boolean {
  const alg = ALG;
  if (!alg) return false;
  const atoms = new Set([...pAtoms(rf.n), ...pAtoms(rf.d)]);
  if (!atoms.size) return false;
  for (const a of atoms) if (!alg.has(a)) return false;
  return true;
}

/** Exact rational square root, or null. */
function qSqrt(q: Q): Q | null {
  if (q.n < 0n) return null;
  const a = bRoot(q.n, 2), b = bRoot(q.d, 2);
  return a * a === q.n && b * b === q.d ? qMake(a, b) : null;
}

/**
 * sqrt(a + r·w), w a product of square roots of rationals with w² = m: when
 * d = sqrt(a² − r²m) is RATIONAL, sqrt((a+d)/2) ± sqrt((a−d)/2) is a candidate
 * (Borodin). It is returned ONLY if it squares back to the radicand exactly and
 * is non-negative — denesting is never assumed.
 */
function denestSqrt(arg: RF, ctx: Ctx): RF | null {
  if (!pIsOne(arg.d) || arg.n.length !== 2) return null;
  const c0 = arg.n.find((t) => t.a.size === 0);
  const w = arg.n.find((t) => t.a.size > 0);
  if (!c0 || !w) return null;
  const m = sqrtOnlyMono(w);
  if (!m) return null;
  const a = c0.c;
  if (a.n <= 0n) return null;
  const D = qAdd(qMul(a, a), qNeg(qMul(qMul(w.c, w.c), m)));
  const d = qSqrt(D);
  if (!d) return null;
  const half = qMake(1n, 2n);
  const s1 = exactRoot(2, qMul(qAdd(a, d), half), ctx);
  const s2 = exactRoot(2, qMul(qAdd(a, qNeg(d)), half), ctx);
  const cand = w.c.n > 0n ? rfAdd(s1, s2) : rfSub(s1, s2);
  if (!rfIsZero(rfSub(rfMul(cand, cand), arg))) return null;
  if (!(rfNum(cand, ctx) >= 0)) return null;
  return cand;
}

/** c·sqrt(m) for a table entry [c, m] (m = 1 means rational). */
function surd(c: Q, m: number, ctx: Ctx): RF {
  return m === 1 ? rfConst(c) : rfMul(rfConst(c), exactRoot(2, qMake(BigInt(m), 1n), ctx));
}

/**
 * cos at k·15°, k ∈ 0..23, where it is a known radical: multiples of 30° and
 * 45°. Null at the odd multiples of 15° (not tabulated).
 */
function cos15(k: number): [Q, number] | null {
  k = ((k % 24) + 24) % 24;
  if (k > 12) k = 24 - k;
  const T: Record<number, [bigint, bigint, number]> = {
    0: [1n, 1n, 1], 2: [1n, 2n, 3], 3: [1n, 2n, 2], 4: [1n, 2n, 1], 6: [0n, 1n, 1],
    8: [-1n, 2n, 1], 9: [-1n, 2n, 2], 10: [-1n, 2n, 3], 12: [-1n, 1n, 1],
  };
  const v = T[k];
  return v ? [qMake(v[0], v[1]), v[2]] : null;
}

/** sin/cos/tan of (rational)·pi, exactly, when the angle is a multiple of 30° or 45°. */
function trigAtPi(name: string, arg: RF, ctx: Ctx): RF | null {
  if (!pIsOne(arg.d) || arg.n.length !== 1) return null;
  const t = arg.n[0];
  if (t.a.size !== 1 || t.a.get("pi") !== 1) return null;
  const r = t.c; // angle = r·pi = r·12 units of 15°
  if (12n % r.d !== 0n) return null;
  const k = Number((r.n * 12n) / r.d);
  if (!Number.isSafeInteger(k)) return null;
  const cos = cos15(k), sin = cos15(6 - k);
  if (!cos || !sin) return null;
  if (name === "cos") return surd(cos[0], cos[1], ctx);
  if (name === "sin") return surd(sin[0], sin[1], ctx);
  if (name === "tan") {
    if (qIsZero(cos[0])) return null; // tan(pi/2): undefined — left as it was
    return rfDiv(surd(sin[0], sin[1], ctx), surd(cos[0], cos[1], ctx));
  }
  return null;
}

/** k·pi as an RF. */
const piTimes = (k: Q): RF => rfMul(rfConst(k), rfAtom("pi"));

/** Exact values at special rational arguments; null when none is known. */
function exactSpecial(name: string, q: Q): RF | null {
  const is = (n: bigint, d: bigint = 1n): boolean => q.n === n && q.d === d;
  if (qIsZero(q)) {
    if (["sin", "tan", "asin", "atan", "sinh", "tanh"].includes(name)) return rfConst(Q_ZERO);
    if (["cos", "cosh", "exp"].includes(name)) return rfConst(Q_ONE);
    if (name === "acos") return piTimes(qMake(1n, 2n));
  }
  if (is(1n) && ["ln", "log", "log10", "log2"].includes(name)) return rfConst(Q_ZERO);
  if (name === "acos") {
    if (is(1n)) return rfConst(Q_ZERO);
    if (is(-1n)) return piTimes(Q_ONE);
    if (is(1n, 2n)) return piTimes(qMake(1n, 3n));
    if (is(-1n, 2n)) return piTimes(qMake(2n, 3n));
  }
  if (name === "asin") {
    if (is(1n)) return piTimes(qMake(1n, 2n));
    if (is(-1n)) return piTimes(qMake(-1n, 2n));
    if (is(1n, 2n)) return piTimes(qMake(1n, 6n));
    if (is(-1n, 2n)) return piTimes(qMake(-1n, 6n));
  }
  if (name === "atan") {
    if (is(1n)) return piTimes(qMake(1n, 4n));
    if (is(-1n)) return piTimes(qMake(-1n, 4n));
  }
  if ((name === "log10" || name === "log" || name === "log2") && q.n > 0n) {
    const B = name === "log2" ? 2n : 10n;
    for (const [num, den, sign] of [[q.n, q.d, 1n], [q.d, q.n, -1n]] as [bigint, bigint, bigint][]) {
      if (den !== 1n) continue;
      let v = num, k = 0n;
      while (v > 1n && v % B === 0n && k < 400n) { v /= B; k++; }
      if (v === 1n) return rfConst(qMake(sign * k, 1n));
    }
  }
  return null;
}

/**
 * Exact-mode handling of fn(arg). Returns null to fall through to the default
 * path (opaque atom over a non-constant argument).
 */
function exactFn(name: string, arg: RF, ctx: Ctx): RF | null {
  if (rfIsConst(arg)) {
    const q = pGetConst(arg.n);
    const f = FN_NUM[name];
    if (!f) throw new CasBail(`unknown function ${name}`);
    // Same domain as the default path: a non-finite value bails there too.
    if (!Number.isFinite(f(qToNumber(q)))) throw new CasBail(`${name} undefined here`);
    if (name === "sqrt") return exactRoot(2, q, ctx);
    if (name === "cbrt") return exactRoot(3, q, ctx);
    if (name === "abs") return rfConst(q.n < 0n ? qNeg(q) : q);
    if (name === "u" || name === "heaviside" || name === "step") return null; // folds to exact 0/1 already
    const special = exactSpecial(name, q);
    if (special) return special;
    // No exact value known: keep it symbolic rather than fold to a float.
    return atomFor(ctx, { t: "fn", name, arg: rfToExpr(arg, ctx) });
  }
  if ((name === "sin" || name === "cos" || name === "tan")) return trigAtPi(name, arg, ctx);
  if ((name === "sqrt" || name === "cbrt") && isAlgebraicConst(arg)) {
    const v = rfNum(arg, ctx);
    if (!Number.isFinite(v)) throw new CasBail("non-finite radicand");
    if (name === "sqrt" && v < 0) throw new CasBail("sqrt of a negative constant");
    if (name === "sqrt") {
      const dn = denestSqrt(arg, ctx);
      if (dn) return dn;
    }
    if (!pIsConst(arg.d)) return null;
    const rad = pScale(arg.n, qDiv(Q_ONE, pGetConst(arg.d)));
    const e: Expr = { t: "fn", name, arg: rfToExpr(arg, ctx) };
    const atom = atomFor(ctx, e);
    ALG?.set(keyFmt(e), { k: name === "sqrt" ? 2 : 3, rad });
    return atom;
  }
  if (name === "sqrt" || name === "cbrt") return radicalContent(name === "sqrt" ? 2 : 3, arg, ctx);
  return null;
}

/** The largest s with s^k dividing v (trial division to 10^5; unfactored rest ignored). */
function kthPowerPart(v: bigint, k: number): bigint {
  const { primes } = factorSmall(v < 0n ? -v : v);
  let s = 1n;
  for (const [p, e] of primes) s *= p ** BigInt(Math.floor(e / k));
  return s;
}

/** Positive rational content of a polynomial: gcd of numerators / lcm of denominators. */
function qContent(p: Poly): Q {
  let g = 0n, l = 1n;
  for (const t of p) {
    g = bGcd(g, t.c.n);
    l = (l / bGcd(l, t.c.d)) * t.c.d;
  }
  return qMake(g || 1n, l);
}

/**
 * Exact mode, sqrt/cbrt of a non-constant radicand: take out what provably comes
 * out. The rational content's perfect k-th power (sqrt(4*pi) = 2*sqrt(pi),
 * sqrt(x/4) = sqrt(x)/2), and, for a monomial radicand, atom^(k·m) factors —
 * for cbrt always, for sqrt when m is even or the atom is variable-free with a
 * PROVABLE sign (sqrt(ln(2)^2) = ln(2) because ln 2 > 0; sqrt(x^2) stays, since
 * it is |x|). Null when nothing comes out.
 */
function radicalContent(k: number, arg: RF, ctx: Ctx): RF | null {
  const name = k === 2 ? "sqrt" : "cbrt";
  const cn = qContent(arg.n), cd = qContent(arg.d);
  let out: RF = rfConst(qMake(kthPowerPart(cn.n, k) * kthPowerPart(cd.d, k), kthPowerPart(cn.d, k) * kthPowerPart(cd.n, k)));
  let pulled = !rfIsConst(out) || !qIsOne(pGetConst(out.n));
  const atomSign = (key: string): number => {
    const v = numEvalExpr(atomExpr(ctx, key));
    return Number.isFinite(v) && v !== 0 ? Math.sign(v) : 0;
  };
  const pullFrom = (p: Poly, into: "n" | "d"): void => {
    if (p.length !== 1) return;
    for (const [key, e] of p[0].a) {
      const m = Math.floor(e / k);
      if (m === 0 || ALG?.has(key)) continue;
      let sign = 1;
      if (k === 2 && m % 2 === 1) {
        sign = atomSign(key);
        if (!sign) continue;
      }
      let f: RF = rfPowInt(rfAtom(key), m);
      if (sign < 0) f = rfNeg(f);
      out = into === "n" ? rfMul(out, f) : rfDiv(out, f);
      pulled = true;
    }
  };
  pullFrom(arg.n, "n");
  pullFrom(arg.d, "d");
  if (!pulled) return null;
  // The sign of out may be negative only through odd powers of negative atoms
  // (sqrt) or freely (cbrt); |out|^k = out^k for sqrt because k is even.
  // inner has nothing left to take out, so this exactFn call cannot recurse here again.
  const inner = rfDiv(arg, rfPowInt(out, k));
  const r = exactFn(name, inner, ctx);
  return rfMul(out, r ?? atomFor(ctx, { t: "fn", name, arg: rfToExpr(inner, ctx) }));
}

// ---------------------------------------------------------------------------
// RF -> Expr (readable rebuild)
// ---------------------------------------------------------------------------

const N = (v: number): Expr => ({ t: "num", v });

function numExpr(q: Q): Expr {
  return N(qToNumber(q));
}

/** Exact Expr for a rational: integer, or integer/integer division node. */
function qToExpr(q: Q): Expr {
  if (qIsInt(q)) {
    return q.n < 0n ? { t: "neg", e: N(Number(-q.n)) } : N(Number(q.n));
  }
  const abs: Expr = { t: "div", l: N(Number(bAbs(q.n))), r: N(Number(q.d)) };
  return q.n < 0n ? { t: "neg", e: abs } : abs;
}

/** Display order inside a monomial: bare variables first, then composite atoms. */
function atomDisplayCmp(a: string, b: string): number {
  const ba = BARE_NAME.test(a) ? 0 : 1;
  const bb = BARE_NAME.test(b) ? 0 : 1;
  if (ba !== bb) return ba - bb;
  // Case-insensitive first, so n·R·T prints as the conventional n*R*T rather
  // than ASCII's R*T*n; case-sensitive tie-break keeps it deterministic.
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function atomExpr(ctx: Ctx, key: string): Expr {
  return ctx.atoms.get(key) ?? { t: "var", name: key };
}

/**
 * |coefficient| · atoms as an Expr (sign handled by the caller so sums can
 * print `a - b` rather than `a + -b`). Fractional coefficients print as a
 * trailing division — x²/2, 3*x/2 — which re-parses to the same value.
 */
function monoToExpr(m: Mono, ctx: Ctx): Expr {
  const cAbs: Q = { n: bAbs(m.c.n), d: m.c.d };
  const factors: Expr[] = [];
  const keys = [...m.a.keys()].sort(atomDisplayCmp);
  // Exact mode splits radicands into primes internally; display merges them
  // back, so sqrt(2)*sqrt(3) prints as sqrt(6) and cbrt(2)^2 as cbrt(4).
  const merged: Record<string, bigint> = { sqrt: 1n, cbrt: 1n };
  const mergedAt: Record<string, number> = { sqrt: -1, cbrt: -1 };
  for (const k of keys) {
    const e = m.a.get(k)!;
    const info = ALG?.get(k);
    const mm = info && pIsConst(info.rad) ? /^(sqrt|cbrt)\((\d+)\)$/.exec(k) : null;
    if (mm) {
      const prod = merged[mm[1]] * BigInt(mm[2]) ** BigInt(e);
      if (prod <= BigInt(Number.MAX_SAFE_INTEGER)) {
        merged[mm[1]] = prod;
        if (mergedAt[mm[1]] < 0) {
          mergedAt[mm[1]] = factors.length;
          factors.push(N(0)); // placeholder, filled below
        }
        continue;
      }
    }
    const base = atomExpr(ctx, k);
    factors.push(e === 1 ? base : { t: "pow", l: base, r: N(e) });
  }
  for (const fn of ["sqrt", "cbrt"]) {
    if (mergedAt[fn] >= 0) factors[mergedAt[fn]] = { t: "fn", name: fn, arg: N(Number(merged[fn])) };
  }
  // A small fraction stays exact (x²/2, 9*C/5). A huge one is not a fraction a
  // user wrote — it is a numerically folded constant like ln(2) coming back
  // from qFromNumber — and prints as the decimal it always printed as.
  const NICE = 1000000n;
  const asDecimal = cAbs.d > NICE || bAbs(cAbs.n) > BigInt(Number.MAX_SAFE_INTEGER);
  let out: Expr;
  if (factors.length === 0) {
    out = asDecimal ? N(qToNumber(cAbs)) : N(Number(cAbs.n));
  } else {
    out = factors.reduce((acc, f) => ({ t: "mul", l: acc, r: f }));
    if (asDecimal) return { t: "mul", l: N(qToNumber(cAbs)), r: out };
    if (cAbs.n !== 1n) out = { t: "mul", l: N(Number(cAbs.n)), r: out };
  }
  if (!asDecimal && cAbs.d !== 1n) out = { t: "div", l: out, r: N(Number(cAbs.d)) };
  return out;
}

function polyToExpr(p: Poly, ctx: Ctx): Expr {
  if (p.length === 0) return N(0);
  let out: Expr | null = null;
  for (const t of p) {
    const neg = t.c.n < 0n;
    const term = monoToExpr(t, ctx);
    if (out === null) out = neg ? { t: "neg", e: term } : term;
    else out = neg ? { t: "sub", l: out, r: term } : { t: "add", l: out, r: term };
  }
  return out!;
}

function rfToExpr(rf: RF, ctx: Ctx): Expr {
  if (pIsOne(rf.d)) return polyToExpr(rf.n, ctx);
  return { t: "div", l: polyToExpr(rf.n, ctx), r: polyToExpr(rf.d, ctx) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Canonical simplification: normalise to a rational function over atoms and
 * rebuild a readable Expr. Throws CasBail on the (rare) unrepresentable
 * input — callers fall back to the peephole simplifier.
 */
export function casSimplify(e: Expr, opts?: CasOptions): Expr {
  return simplifyCore(e, opts, false).result;
}

/**
 * Canonical string of an expression — equal strings ⟺ equal rational
 * functions (up to the module's cancellation power). Null when the
 * expression cannot be canonicalised.
 */
export function canonicalKey(e: Expr): string | null {
  try {
    return keyFmt(casSimplify(e));
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }
}

/** Structural equality of canonical forms; null = could not decide. */
export function exprEqual(a: Expr, b: Expr, opts?: CasOptions): boolean | null {
  try {
    const ctx: Ctx = { atoms: new Map(), splitExp: true, exact: !!opts?.exactRadicals };
    return withAlg(!!ctx.exact, () => rfIsZero(rfSub(normalize(a, ctx), normalize(b, ctx))));
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }
}

/** Replaces every free occurrence of variable `x` with `r`. */
export function substituteVar(e: Expr, x: string, r: Expr): Expr {
  switch (e.t) {
    case "num": return e;
    case "var": return e.name === x ? r : e;
    case "neg": return { t: "neg", e: substituteVar(e.e, x, r) };
    case "fn": return { t: "fn", name: e.name, arg: substituteVar(e.arg, x, r) };
    case "add": case "sub": case "mul": case "div": case "pow":
      return { t: e.t, l: substituteVar(e.l, x, r), r: substituteVar(e.r, x, r) } as Expr;
  }
}

export interface SymbolicSolution {
  /** Solutions for the target variable, as simplified Exprs. */
  roots: Expr[];
  /** Expressions that must be nonzero for the solution to be valid. */
  nonzeroConditions: Expr[];
  /** For quadratics: the discriminant, which must be ≥ 0 for real roots. */
  discriminant?: Expr;
  kind: "linear" | "quadratic" | "power";
  /** For the power kind: the isolated exponent n in x^n = RHS. */
  power?: number;
  /** For an EVEN power: the RHS, which must be ≥ 0 for the ± pair to be real. */
  realityCondition?: Expr;
  /** True when substitution back into f gives canonical 0 (linear only —
   *  quadratics are verified numerically by the caller). */
  verified: boolean;
}

/**
 * Solves f = 0 symbolically for `x` when f is a rational function whose
 * numerator is linear or quadratic in x (x must not appear inside any
 * opaque atom such as sin(x)). This is the rearrangement engine:
 * F − m·a solved for a gives F/m, with m ≠ 0 as a stated condition.
 * Returns null when f is not of that shape — callers then use numeric paths.
 */
export function solveRationalInVar(f: Expr, x: string): SymbolicSolution | null {
  let ctx: Ctx = { atoms: new Map() };
  let rf: RF;
  try {
    rf = normalize(f, ctx);
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }

  // x inside a composite atom (sin(x), 2^x, x^0.5) is beyond this engine.
  for (const key of new Set([...pAtoms(rf.n), ...pAtoms(rf.d)])) {
    if (key !== x && atomMentionsVar(ctx, key, x)) return null;
  }

  // f = num/den = 0  ⟺  num = 0, provided den ≠ 0.
  // A ≠-0 condition is sign-invariant, so it displays with a positive leading
  // coefficient: "a + b ≠ 0", never "-a - b ≠ 0".
  const condExpr = (p: Poly): Expr => polyToExpr(p.length && p[0].c.n < 0n ? pNeg(p) : p, ctx);
  const nonzeroConditions: Expr[] = [];
  if (!pIsConst(rf.d)) nonzeroConditions.push(condExpr(rf.d));

  // Group the numerator by powers of x: num = Σ b_k · x^k.
  const byDeg = new Map<number, Mono[]>();
  for (const t of rf.n) {
    const k = t.a.get(x) ?? 0;
    const rest = new Map(t.a);
    rest.delete(x);
    const list = byDeg.get(k) ?? [];
    list.push({ c: t.c, a: rest });
    byDeg.set(k, list);
  }
  const deg = Math.max(...byDeg.keys(), 0);
  const coeff = (k: number): Poly => pNorm(byDeg.get(k) ?? []);
  const b0 = coeff(0), b1 = coeff(1);

  if (deg > 2) {
    // MONOMIAL isolation: bN·x^n + b0 = 0 with nothing in between — the shape
    // of V = (4/3)πr³ solved for r, E = σT⁴ solved for T. An odd power has ONE
    // real root; an even power a ± pair that is real only when the isolated
    // power comes out ≥ 0 — a condition that is STATED, never assumed.
    const middle = [...byDeg.keys()].some((k) => k !== 0 && k !== deg && coeff(k).length > 0);
    if (middle || deg > 64) return null;
    const bN = coeff(deg);
    if (!bN.length) return null;
    if (!pIsConst(bN)) nonzeroConditions.push(condExpr(bN));
    const rhs = rfNorm(pNeg(b0), bN); // x^n = rhs
    const rhsExpr = rfToExpr(rhs, ctx);
    const simp = (e: Expr): Expr => {
      try { return casSimplify(e); } catch (err) {
        if (err instanceof CasBail) return e;
        throw err;
      }
    };
    const root: Expr = deg === 3
      ? { t: "fn", name: "cbrt", arg: rhsExpr }
      : deg === 2
        ? { t: "fn", name: "sqrt", arg: rhsExpr }
        : { t: "pow", l: rhsExpr, r: { t: "div", l: N(1), r: N(deg) } };
    if (deg % 2 === 1) {
      return { roots: [simp(root)], nonzeroConditions, kind: "power", power: deg, verified: false };
    }
    return {
      roots: [simp(root), { t: "neg", e: simp(root) }],
      nonzeroConditions,
      kind: "power",
      power: deg,
      realityCondition: rhsExpr,
      verified: false,
    };
  }
  if (deg < 1) return null;

  if (deg === 1) {
    // b1·x + b0 = 0  →  x = −b0/b1, requiring b1 ≠ 0.
    const root = rfNorm(pNeg(b0), b1);
    if (!pIsConst(b1)) nonzeroConditions.push(condExpr(b1));
    const rootExpr = rfToExpr(root, ctx);
    // Verify by substitution: f(root) must normalise to exactly 0.
    const verified = exprEqual(substituteVar(f, x, rootExpr), N(0)) === true;
    return { roots: [rootExpr], nonzeroConditions, kind: "linear", verified };
  }

  // b2·x² + b1·x + b0 = 0 — the quadratic formula, symbolically.
  const b2 = coeff(2);
  if (!pIsConst(b2)) nonzeroConditions.push(condExpr(b2));
  const discPoly = pAdd(pMul(b1, b1), pNeg(pScale(pMul(b2, b0), qMake(4n, 1n))));
  const discExpr = polyToExpr(discPoly, ctx);
  if (pIsConst(discPoly) && discPoly.length && discPoly[0].c.n < 0n) {
    // A numeric negative discriminant means a complex pair; that belongs to
    // the numeric machinery, not the symbolic rearranger.
    return null;
  }
  const sqrtD: Expr = { t: "fn", name: "sqrt", arg: discExpr };
  const negB = polyToExpr(pNeg(b1), ctx);
  const twoA = polyToExpr(pScale(b2, qMake(2n, 1n)), ctx);
  const build = (sign: "add" | "sub"): Expr | null => {
    const numer: Expr = { t: sign, l: negB, r: sqrtD };
    const raw: Expr = { t: "div", l: numer, r: twoA };
    try {
      // exactRadicals: √8 stays 2√2. Without it the roots of 1/(x−1) + 1/(x+1) = 1
      // came back as 2.41421356237 under "exact (symbolic rearrangement)".
      return casSimplify(raw, { exactRadicals: true });
    } catch (err) {
      if (err instanceof CasBail) return raw;
      throw err;
    }
  };
  const r1 = build("add");
  const r2 = build("sub");
  if (!r1 || !r2) return null;
  return {
    roots: [r1, r2],
    nonzeroConditions,
    discriminant: discExpr,
    kind: "quadratic",
    verified: false, // caller verifies numerically (sqrt atoms are opaque here)
  };
}

// ---------------------------------------------------------------------------
// Exact-rational polynomial toolkit, exported for symbolic integration
// (casint.ts). Partial fractions needs coefficient arithmetic that cannot
// drift, which is exactly what the Q layer above provides.
// ---------------------------------------------------------------------------

/** An exact rational. `d` > 0, always reduced. */
export type Rat = Q;

export const ratMake = (n: bigint, d: bigint): Rat => qMake(n, d);
export const ratInt = (n: bigint | number): Rat => qMake(BigInt(n), 1n);
export const ratAdd = qAdd;
export const ratSub = (a: Rat, b: Rat): Rat => qAdd(a, qNeg(b));
export const ratMul = qMul;
export const ratDiv = qDiv;
export const ratNeg = qNeg;
export const ratIsZero = qIsZero;
export const ratIsOne = qIsOne;
export const ratToNumber = qToNumber;
export const ratFromNumber = qFromNumber;
export const ratToExpr = qToExpr;
export const RAT_ZERO = Q_ZERO;
export const RAT_ONE = Q_ONE;
/** Sign of a rational: -1, 0 or 1. */
export const ratSign = (a: Rat): number => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const ratEq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;

/**
 * A number the user TYPED, as an exact rational: "2.5" is 5/2, not the binary
 * double nearest 2.5.
 *
 * This is deliberately not `ratFromNumber(Number(s))`. Going through a double
 * embeds that double's error in what is supposed to be the exact half of an
 * engine — "0.1" would become 3602879701896397/36028797018963968, and every
 * "exact" answer downstream would carry it. Decimal text is exactly a fraction
 * over a power of ten, so it is read as one.
 *
 * Accepts a plain decimal, a fraction ("7/3"), and scientific notation. Returns
 * null on anything else rather than guessing; the exponent is bounded because
 * 10^(10^9) as a BigInt is not a number, it is an out-of-memory crash.
 */
export function parseRatLiteral(s: string): Rat | null {
  const t = s.trim();
  if (!t) return null;

  let m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(t);
  if (m) {
    const d = BigInt(m[2]);
    if (d === 0n) return null;
    return qDiv(qMake(BigInt(m[1]), 1n), qMake(d, 1n));
  }

  m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (m && (m[2] || m[3])) {
    const sign = m[1] === "-" ? -1n : 1n;
    const frac = m[3] || "";
    const num = BigInt((m[2] || "0") + frac) * sign;
    return qMake(num, 10n ** BigInt(frac.length));
  }

  m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[eE]([+-]?\d+)$/.exec(t);
  if (m) {
    const base = parseRatLiteral(m[1]);
    if (!base) return null;
    const exp = parseInt(m[2], 10);
    if (!Number.isFinite(exp) || Math.abs(exp) > 400) return null;
    const p = qMake(10n ** BigInt(Math.abs(exp)), 1n);
    return exp >= 0 ? qMul(base, p) : qDiv(base, p);
  }

  return null;
}

/**
 * `e` as an exact rational function of `x` alone: ascending coefficient arrays
 * for numerator and denominator, already reduced by the canonicaliser's GCD
 * cancellation. Null when `e` involves any other symbol or any non-polynomial
 * structure in x (sin(x), x^0.5, x^y …).
 */
export function ratFunctionInVar(e: Expr, x: string): { num: Rat[]; den: Rat[] } | null {
  let ctx: Ctx;
  let rf: RF;
  try {
    ctx = { atoms: new Map() };
    rf = normalize(e, ctx);
  } catch (err) {
    if (err instanceof CasBail) return null;
    throw err;
  }
  for (const k of new Set([...pAtoms(rf.n), ...pAtoms(rf.d)])) if (k !== x) return null;
  const num = pAsUnivariate(rf.n, x);
  const den = pAsUnivariate(rf.d, x);
  if (!num || !den || !den.length) return null;
  return { num, den };
}

/** `e` as an exact polynomial in `x` alone (ascending coefficients), or null. */
export function polyInVar(e: Expr, x: string): Rat[] | null {
  const rf = ratFunctionInVar(e, x);
  if (!rf) return null;
  if (rf.den.length !== 1) return null; // a genuine denominator in x
  return rf.num.map((c) => qDiv(c, rf.den[0]));
}

/** Rebuilds an ascending coefficient array into an Expr in `x`. */
export function ratPolyToExpr(coeffs: Rat[], x: string): Expr {
  const ctx: Ctx = { atoms: new Map() };
  return polyToExpr(uniToPoly(coeffs, x), ctx);
}

/** Ascending-coefficient polynomial arithmetic over exact rationals. */
export const ratPolyAdd = (a: Rat[], b: Rat[]): Rat[] => {
  const out: Rat[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(qAdd(a[i] ?? Q_ZERO, b[i] ?? Q_ZERO));
  return ratPolyTrim(out);
};
export const ratPolyScale = (a: Rat[], k: Rat): Rat[] => ratPolyTrim(a.map((c) => qMul(c, k)));
export function ratPolyMul(a: Rat[], b: Rat[]): Rat[] {
  if (!a.length || !b.length) return [];
  const out: Rat[] = new Array(a.length + b.length - 1).fill(Q_ZERO);
  a.forEach((av, i) => b.forEach((bv, j) => (out[i + j] = qAdd(out[i + j], qMul(av, bv)))));
  return ratPolyTrim(out);
}
export function ratPolyTrim(a: Rat[]): Rat[] {
  const out = a.slice();
  while (out.length && qIsZero(out[out.length - 1])) out.pop();
  return out;
}
/** Evaluates a polynomial at an exact rational point (Horner). */
export function ratPolyEval(a: Rat[], at: Rat): Rat {
  let acc = Q_ZERO;
  for (let i = a.length - 1; i >= 0; i--) acc = qAdd(qMul(acc, at), a[i]);
  return acc;
}
/** Quotient and remainder of a ÷ b over exact rationals. */
export function ratPolyDivMod(a: Rat[], b: Rat[]): { q: Rat[]; r: Rat[] } {
  const bb = ratPolyTrim(b);
  if (!bb.length) throw new CasBail("polynomial division by zero");
  let r = ratPolyTrim(a);
  const db = bb.length - 1;
  const lead = bb[db];
  const q: Rat[] = new Array(Math.max(0, r.length - db)).fill(Q_ZERO);
  while (r.length - 1 >= db && r.length) {
    const dr = r.length - 1;
    const f = qDiv(r[dr], lead);
    q[dr - db] = f;
    const shifted: Rat[] = new Array(dr - db).fill(Q_ZERO).concat(bb.map((c) => qMul(c, f)));
    r = ratPolyAdd(r, shifted.map((c) => qNeg(c)));
  }
  return { q: ratPolyTrim(q), r };
}

/**
 * Rational roots of a polynomial with their multiplicities, plus whatever
 * factor is left once they are divided out. Uses the rational-root theorem
 * over the integer-scaled coefficients — complete for rational roots, which
 * is what partial fractions needs.
 */
export function ratPolyRoots(coeffs: Rat[]): {
  roots: { root: Rat; mult: number }[];
  rest: Rat[];
  /**
   * True when the rational-root candidate set was CAPPED, so the search was not
   * exhaustive and `rest` may still contain rational roots.
   *
   * The distinction matters: without it, a truncated search returning nothing is
   * indistinguishable from a proof that no rational root exists — a false
   * statement dressed as a result. Callers that rely on completeness must check it.
   */
  incomplete: boolean;
} {
  let p = ratPolyTrim(coeffs);
  const roots: { root: Rat; mult: number }[] = [];
  if (p.length < 2) return { roots, rest: p, incomplete: false };

  // Scale to integer coefficients so the rational-root theorem applies.
  let lcm = 1n;
  for (const c of p) lcm = (lcm / bGcd(lcm, c.d)) * c.d;
  const ints = p.map((c) => (c.n * lcm) / c.d);
  const a0 = ints.find((v) => v !== 0n) ?? 0n; // lowest nonzero coefficient
  const an = ints[ints.length - 1];
  let divisorsTruncated = false;
  const divisors = (v: bigint): bigint[] => {
    v = bAbs(v);
    if (v === 0n) return [1n];
    const out = new Set<bigint>();
    // Trial division to √v (both members of each divisor pair), bounded; a
    // search that gives up is REPORTED as incomplete — the old loop stopped
    // at 10,000 silently, so 10007x − 1 was declared to have "no rational
    // root", an impossible statement about a linear factor.
    let i = 1n;
    for (; i * i <= v && i <= 200000n; i++) if (v % i === 0n) { out.add(i); out.add(v / i); }
    if (i * i <= v) divisorsTruncated = true;
    return [...out].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  };
  // CAP THE CANDIDATE SET, NOT JUST THE DIVISOR SEARCH.
  //
  // The bound inside `divisors` limits how far trial division looks; it does NOT
  // limit the CROSS PRODUCT built here, which is divisors(a0) x divisors(an) x 2.
  // With a highly composite constant term the two are wildly different: for
  // H = 963761198400 there are 6720 divisors, 905 of them at or below 10000, and
  // the product reaches 1,638,050 candidates — each one an exact BigInt-rational
  // Horner evaluation, repeated once per degree. Measured before this cap:
  //
  //     ratPolyRoots([H, H+1, H])                          1710 ms
  //     integrate("1/(H*x^2+(H+1)*x+H)", 0, 1)             2408 ms
  //     integrate("1/(H*x^6+(H+1)*x+H)", 0, 1)            10881 ms
  //     integrate("1/(H*x^8+(H+1)*x+H)", 0, 1)            20639 ms
  //
  // Twenty seconds of synchronous work in a task pane is a frozen Word, and it
  // recomputes on every keystroke. The comment on the divisor loop — "a user-typed
  // polynomial has small coefficients" — is the assumption that fails, and
  // `gcd(H, H+1) = 1` means the coprime rescaling upstream cannot shrink it either.
  //
  // This is the catalogued lesson again: A CLAMP THAT BOUNDS THE SEARCH DOES NOT
  // BOUND THE TIME. So the product itself is capped, and when the cap is hit the
  // caller is told the search was INCOMPLETE rather than being handed "no rational
  // roots" — which would be a false statement dressed as a result.
  const MAX_CANDIDATES = 20000;
  const candidates: Rat[] = [];
  let candidatesTruncated = false;
  const numDivisors = divisors(a0);
  const denDivisors = divisors(an);
  outer: for (const pnum of numDivisors) {
    for (const qden of denDivisors) {
      if (candidates.length + 2 > MAX_CANDIDATES) {
        candidatesTruncated = true;
        break outer;
      }
      candidates.push(qMake(pnum, qden), qMake(-pnum, qden));
    }
  }
  // x = 0 is a root whenever the constant term vanishes.
  if (p.length && qIsZero(p[0])) candidates.unshift(Q_ZERO);

  for (const c of candidates) {
    if (p.length < 2) break;
    let mult = 0;
    while (p.length >= 2 && qIsZero(ratPolyEval(p, c))) {
      const { q, r } = ratPolyDivMod(p, [qNeg(c), Q_ONE]); // divide by (x − c)
      if (r.length) break; // numerically impossible here, but stay total
      p = q;
      mult++;
    }
    if (mult) roots.push({ root: c, mult });
  }
  return { roots, rest: p, incomplete: candidatesTruncated || divisorsTruncated };
}

// ---------------------------------------------------------------------------
// v2.136.0 symbolic batch — public API (signatures frozen for builders A/D/F).
// ---------------------------------------------------------------------------

/** Options shared by casSimplify / exprEqual / casSimplifyReport. */
export interface CasOptions {
  /**
   * OPT-IN exact constants. Default OFF: every function of a constant folds to
   * a float-derived rational exactly as it always has. When ON, sqrt/cbrt of a
   * rational become algebraic atoms (cbrt(2)^3 = 2, sqrt(8) = 2*sqrt(2)), sin/cos/tan
   * at rational multiples of pi fold exactly where the value is a known radical,
   * other functions of constants stay symbolic, and sqrt(a + b*sqrt(m)) denests
   * only when the denested form squares back to the radicand exactly.
   */
  exactRadicals?: boolean;
}

/** casSimplify plus what the output-boundary multivariate GCD did. */
export interface SimplifyReport {
  result: Expr;
  /**
   * The non-constant common factor the BOUNDARY multivariate GCD cancelled, or
   * null. Null does NOT mean nothing was cancelled — see anyCancellation.
   */
  cancelled: Expr | null;
  /**
   * True when the result may be DEFINED where the input is not: some factor of
   * a divisor in the input (every `a/b` and every negative-power base, including
   * divisors that vanish once terms are combined, as in 1/x - 1/x → 0) does not
   * survive into the result's denominator. Decided from the input and the
   * output — not by tracking which code path cancelled — so it is conservative
   * by construction; any doubt (a cap, a bail) reports true. Use THIS to decide
   * whether the "cancelling can remove points" caveat may be dropped (only when
   * false).
   */
  anyCancellation: boolean;
  /** Why the multivariate GCD did not run (a named cap), or null. */
  refused: string | null;
}

/**
 * casSimplify, reporting the output-boundary multivariate GCD: the factor it
 * cancelled (so a verb can say "Cancelled the common factor x - y; equal to the
 * original except where x - y = 0") or the cap that stopped it, by name.
 *
 * `cancelled` reports ONLY the boundary GCD. Monomial content and single-atom
 * GCDs are cancelled earlier, inside every arithmetic step, as they always were.
 */
export function casSimplifyReport(e: Expr, opts?: CasOptions): SimplifyReport {
  return simplifyCore(e, opts, true);
}

function simplifyCore(e: Expr, opts: CasOptions | undefined, wantDomain: boolean): SimplifyReport {
  const ctx: Ctx = { atoms: new Map(), exact: !!opts?.exactRadicals };
  return withAlg(!!ctx.exact, () => {
    const rf = normalize(e, ctx);
    const c = cancelCommon(rf);
    return {
      result: rfToExpr(c.rf, ctx),
      cancelled: c.g ? polyToExpr(lexLeadPositive(c.g), ctx) : null,
      anyCancellation: wantDomain ? c.g !== null || domainWidened(e, c.rf.d, ctx) : c.g !== null,
      refused: c.refused,
    };
  });
}

/** Every divisor in the input: the right side of each `/`, and the base of each negative power. */
function collectDivisors(e: Expr, out: Expr[]): void {
  switch (e.t) {
    case "num":
    case "var":
      return;
    case "neg":
      collectDivisors(e.e, out);
      return;
    case "fn":
      collectDivisors(e.arg, out);
      return;
    case "div":
      out.push(e.r);
      break;
    case "pow": {
      const r = e.r;
      const negExp = (r.t === "num" && r.v < 0) || r.t === "neg";
      if (negExp) out.push(e.l);
      break;
    }
    default:
      break;
  }
  collectDivisors(e.l, out);
  collectDivisors(e.r, out);
}

/**
 * Does the simplified denominator `dOut` keep every factor of every input
 * divisor? For each divisor's numerator N (its zeros are where the input is
 * undefined; its own poles are inner divisors, collected separately), strip the
 * factors it shares with dOut by repeated GCD; anything left over vanishes
 * somewhere the result is defined. Any cap or bail answers TRUE.
 */
function domainWidened(input: Expr, dOut: Poly, ctx: Ctx): boolean {
  const divisors: Expr[] = [];
  collectDivisors(input, divisors);
  if (!divisors.length) return false;
  const budget: Budget = { ops: GCD_MAX_OPS, deadline: Date.now() + GCD_MAX_MS };
  const seen = new Set<string>();
  try {
    for (const dv of divisors) {
      const key = keyFmt(dv);
      if (seen.has(key)) continue;
      seen.add(key);
      let h = normalize(dv, ctx).n;
      if (pIsZero(h)) return true;
      // A variable-free divisor with a nonzero value (pi, sqrt(2), ln(2)) removes no point.
      const v = polyNum(h, ctx);
      if (Number.isFinite(v) && v !== 0) continue;
      for (let round = 0; !pIsConst(h); round++) {
        if (round > 64) return true;
        const g = mvGcd(h, dOut, budget);
        if (pIsConst(g)) return true; // a factor of h is missing from dOut
        const q = mvDivExact(h, g, budget);
        if (!q) return true;
        h = q;
      }
    }
    return false;
  } catch (err) {
    if (err instanceof GcdCap || err instanceof CasBail) return true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Multivariate polynomial GCD over ℚ — recursive primitive PRS over
// ℚ[others][main], on the sparse Poly. Atoms are independent indeterminates,
// which is sound: a common factor in that ring is a true common factor of the
// values (sin² + cos² = 1 is never used).
//
// It runs ONCE, at the output boundary (casSimplify), not inside rfNorm: rfNorm
// runs on every rfAdd/rfMul/rfDiv in nine modules, and the cost belongs where the
// answer is printed (docs/SCOPE-SYMBOLIC-BATCH.md §E.6). exprEqual is subtraction
// to zero and needs no GCD.
//
// CAPS ARE CHECKED BEFORE WORK, and a shared budget bounds TIME as well as size —
// a clamp that bounds memory does not bound time.
// ---------------------------------------------------------------------------

/** Named refusal from the GCD; the fraction is left unreduced. */
class GcdCap extends Error {}

const GCD_MAX_ATOMS = 4;
const GCD_MAX_DEG = 12;
const GCD_MAX_TERMS = 200;
const GCD_MAX_BITS = 4096;
const GCD_MAX_OPS = 20000;
// A safety net only: the deterministic ops cap is meant to bind first, so a
// refusal does not flip with machine load.
const GCD_MAX_MS = 2500;

interface Budget {
  ops: number;
  deadline: number;
}

function tick(b: Budget): void {
  if (--b.ops < 0) throw new GcdCap("work cap");
  if (Date.now() > b.deadline) throw new GcdCap("time cap");
}

function degIn(p: Poly, v: string): number {
  let d = 0;
  for (const t of p) d = Math.max(d, t.a.get(v) ?? 0);
  return d;
}

/** Coefficients of p as a polynomial in v (index = power), each free of v. */
function coeffsIn(p: Poly, v: string): Poly[] {
  const buckets: Mono[][] = [];
  for (const t of p) {
    const k = t.a.get(v) ?? 0;
    const m = new Map(t.a);
    m.delete(v);
    (buckets[k] ??= []).push({ c: t.c, a: m });
  }
  const out: Poly[] = [];
  for (let k = 0; k < buckets.length; k++) out.push(pNorm(buckets[k] ?? []));
  return out;
}

function lcIn(p: Poly, v: string): Poly {
  const cs = coeffsIn(p, v);
  return cs[cs.length - 1] ?? [];
}

function mulVarPow(p: Poly, v: string, k: number): Poly {
  if (k === 0) return p;
  return p.map((t) => {
    const m = new Map(t.a);
    m.set(v, (m.get(v) ?? 0) + k);
    return { c: t.c, a: m };
  });
}

/** Exact quotient a ÷ b in ℚ[atoms], or null when b does not divide a. */
function mvDivExact(a: Poly, b: Poly, budget: Budget): Poly | null {
  if (pIsZero(b)) throw new CasBail("polynomial division by zero");
  if (pIsZero(a)) return [];
  if (pIsConst(b)) return pScale(a, qDiv(Q_ONE, pGetConst(b)));
  const v = [...pAtoms(b)].sort()[0];
  const db = degIn(b, v);
  const lb = lcIn(b, v);
  let r = a;
  const q: Mono[] = [];
  while (!pIsZero(r)) {
    tick(budget);
    const dr = degIn(r, v);
    if (dr < db) return null;
    const t = mvDivExact(lcIn(r, v), lb, budget);
    if (!t) return null;
    const term = mulVarPow(t, v, dr - db);
    q.push(...term);
    r = pAdd(r, pNeg(pMul(term, b)));
  }
  return pNorm(q);
}

/** Integer coefficients with gcd 1 and a positive leading term — the ℚ-unit normal form. */
function numPrimitive(p: Poly): Poly {
  if (!p.length) return p;
  let lcm = 1n;
  for (const t of p) lcm = (lcm / bGcd(lcm, t.c.d)) * t.c.d;
  let g = 0n;
  for (const t of p) g = bGcd(g, t.c.n * (lcm / t.c.d));
  let f = qMake(lcm, g || 1n);
  if (p[0].c.n < 0n) f = qNeg(f);
  return pScale(p, f);
}

/**
 * A factor is defined up to sign; report it the way a person writes it — the
 * lexicographically leading term (highest power of the first symbol) positive:
 * x - y and x^2 - 2*x*y + y^2, not -x + y or 2*x*y - x^2 - y^2.
 */
function lexLeadPositive(p: Poly): Poly {
  if (!p.length) return p;
  const atoms = [...pAtoms(p)].sort(atomDisplayCmp);
  let lead = p[0];
  for (const t of p) {
    for (const v of atoms) {
      const a = t.a.get(v) ?? 0, b = lead.a.get(v) ?? 0;
      if (a !== b) {
        if (a > b) lead = t;
        break;
      }
    }
  }
  const out = lead.c.n < 0n ? pNeg(p) : p.slice();
  // Display order for this one factor: total degree, then lex (x^2, x*y, y^2).
  const lexCmp = (s: Mono, t: Mono): number => {
    const ds = monoDeg(s), dt = monoDeg(t);
    if (ds !== dt) return dt - ds;
    for (const v of atoms) {
      const a = s.a.get(v) ?? 0, b = t.a.get(v) ?? 0;
      if (a !== b) return b - a;
    }
    return 0;
  };
  return out.sort(lexCmp);
}

function checkBits(p: Poly): void {
  for (const t of p) {
    const bits = (t.c.n < 0n ? -t.c.n : t.c.n).toString(16).length * 4 + t.c.d.toString(16).length * 4;
    if (bits > GCD_MAX_BITS) throw new GcdCap("coefficient-size cap");
  }
}

/** Content of p in v: the gcd of its coefficients (each free of v). */
function mvContent(p: Poly, v: string, budget: Budget): Poly {
  let g: Poly = [];
  for (const c of coeffsIn(p, v)) {
    if (pIsZero(c)) continue;
    g = mvGcd(g, c, budget);
    if (pIsConst(g)) return P_ONE();
  }
  return g.length ? g : P_ONE();
}

/** Pseudo-remainder of a by b in v. */
function prem(a: Poly, b: Poly, v: string, budget: Budget): Poly {
  const db = degIn(b, v);
  const lb = lcIn(b, v);
  let r = a;
  while (!pIsZero(r)) {
    const dr = degIn(r, v);
    if (dr < db) break;
    tick(budget);
    const lr = lcIn(r, v);
    r = pAdd(pMul(lb, r), pNeg(pMul(mulVarPow(lr, v, dr - db), b)));
    checkBits(r);
  }
  return r;
}

/** gcd(a, b) in ℚ[atoms], normalised by numPrimitive; 1 when coprime. */
function mvGcd(a: Poly, b: Poly, budget: Budget): Poly {
  tick(budget);
  if (pIsZero(a)) return numPrimitive(b);
  if (pIsZero(b)) return numPrimitive(a);
  if (pIsConst(a) || pIsConst(b)) return P_ONE();
  const atoms = [...new Set([...pAtoms(a), ...pAtoms(b)])];
  const rank = (v: string): number => Math.max(degIn(a, v), degIn(b, v));
  atoms.sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : x > y ? 1 : 0));
  const v = atoms[0];
  if (degIn(a, v) === 0) return mvGcd(a, mvContent(b, v, budget), budget);
  if (degIn(b, v) === 0) return mvGcd(mvContent(a, v, budget), b, budget);
  const ca = mvContent(a, v, budget);
  const cb = mvContent(b, v, budget);
  const c = mvGcd(ca, cb, budget);
  let p = mvDivExact(a, ca, budget);
  let q = mvDivExact(b, cb, budget);
  if (!p || !q) throw new GcdCap("cross-check failed");
  p = numPrimitive(p);
  q = numPrimitive(q);
  if (degIn(p, v) < degIn(q, v)) [p, q] = [q, p];
  let g: Poly;
  for (;;) {
    const r = prem(p, q, v, budget);
    if (pIsZero(r)) {
      g = q;
      break;
    }
    if (degIn(r, v) === 0) {
      g = P_ONE();
      break;
    }
    p = q;
    const pp = mvDivExact(r, mvContent(r, v, budget), budget);
    if (!pp) throw new GcdCap("cross-check failed");
    q = numPrimitive(pp);
  }
  return numPrimitive(pMul(c, g));
}

/** Specialise every atom but `keep` to a rational; ascending coefficients in `keep`. */
function specialise(p: Poly, keep: string, vals: Map<string, Q>): Q[] {
  const out: Q[] = [];
  for (const t of p) {
    let c = t.c;
    let deg = 0;
    for (const [k, e] of t.a) {
      if (k === keep) deg = e;
      else for (let i = 0; i < e; i++) c = qMul(c, vals.get(k)!);
    }
    while (out.length <= deg) out.push(Q_ZERO);
    out[deg] = qAdd(out[deg], c);
  }
  while (out.length && qIsZero(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Independent cross-check that the cofactors share no factor: for EVERY atom v,
 * specialise the others at a point where neither leading coefficient in v
 * vanishes, and require a univariate gcd of 1. A shared factor involves some
 * atom w and keeps its degree in w at such a point, so it cannot hide.
 * Conservative: an unlucky point that cannot be avoided in 4 tries is a failure.
 */
function cofactorsCoprime(a: Poly, b: Poly): boolean {
  const atoms = [...new Set([...pAtoms(a), ...pAtoms(b)])].sort();
  const SEEDS: [bigint, bigint][] = [[3n, 7n], [5n, 11n], [-7n, 13n], [11n, 17n], [13n, 19n], [-17n, 23n]];
  for (const v of atoms) {
    const da = degIn(a, v), db = degIn(b, v);
    if (da === 0 || db === 0) continue;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const vals = new Map<string, Q>();
      atoms.forEach((w, i) => {
        const [n, d] = SEEDS[(i + attempt) % SEEDS.length];
        vals.set(w, qMake(n + BigInt(attempt * 2), d));
      });
      const ua = specialise(a, v, vals), ub = specialise(b, v, vals);
      if (ua.length - 1 !== da || ub.length - 1 !== db) continue;
      if (uniGcd(ua, ub).length > 1) return false;
      ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * Cancels the multivariate GCD of rf.n and rf.d. Never prints an unchecked
 * result: g must divide both EXACTLY (multiplied back) and the cofactors must
 * pass the coprimality cross-check, or the fraction is returned unchanged with
 * the reason named.
 */
function cancelCommon(rf: RF): { rf: RF; g: Poly | null; refused: string | null } {
  const none = (refused: string | null = null) => ({ rf, g: null, refused });
  if (pIsConst(rf.d) || pIsConst(rf.n)) return none();
  const atoms = new Set([...pAtoms(rf.n), ...pAtoms(rf.d)]);
  if (atoms.size <= 1) return none(); // rfNorm's univariate GCD already ran
  if (atoms.size > GCD_MAX_ATOMS) return none(`symbol cap (more than ${GCD_MAX_ATOMS} symbols)`);
  for (const v of atoms) {
    if (degIn(rf.n, v) > GCD_MAX_DEG || degIn(rf.d, v) > GCD_MAX_DEG) {
      return none(`degree cap (above ${GCD_MAX_DEG} in one symbol)`);
    }
  }
  if (rf.n.length > GCD_MAX_TERMS || rf.d.length > GCD_MAX_TERMS) {
    return none(`term cap (more than ${GCD_MAX_TERMS} terms)`);
  }
  const budget: Budget = { ops: GCD_MAX_OPS, deadline: Date.now() + GCD_MAX_MS };
  try {
    const g = mvGcd(rf.n, rf.d, budget);
    if (pIsConst(g)) return none();
    const qn = mvDivExact(rf.n, g, budget);
    const qd = mvDivExact(rf.d, g, budget);
    if (!qn || !qd) return none("cross-check failed");
    if (!pIsZero(pAdd(pMul(qn, g), pNeg(rf.n))) || !pIsZero(pAdd(pMul(qd, g), pNeg(rf.d)))) {
      return none("cross-check failed");
    }
    if (!cofactorsCoprime(qn, qd)) return none("cross-check failed");
    return { rf: rfNorm(qn, qd), g, refused: null };
  } catch (err) {
    if (err instanceof GcdCap) return none(err.message);
    if (err instanceof CasBail) return none("intermediate size cap");
    throw err;
  }
}

/**
 * Resultant of a and b with respect to variable x (Sylvester determinant by
 * fraction-free Bareiss over ℚ[other symbols]), as an Expr in the remaining
 * symbols. Res = 0 exactly when a and b share a root in x (or both leading
 * coefficients vanish). Denominators free of x are allowed:
 * Res(A/da, B/db) = Res(A, B) / (da^deg B · db^deg A).
 *
 * Null when either side is not polynomial in x, x occurs inside an opaque atom
 * (sin(x)), the Sylvester size deg a + deg b exceeds 12, or the work cap trips.
 * Res(c, B) = c^deg B for a constant c; Res(c1, c2) = 1.
 */
export function polyResultant(a: Expr, b: Expr, x: string): Expr | null {
  const ctx: Ctx = { atoms: new Map() };
  try {
    const ra = normalize(a, ctx);
    const rb = normalize(b, ctx);
    for (const k of new Set([...pAtoms(ra.n), ...pAtoms(ra.d), ...pAtoms(rb.n), ...pAtoms(rb.d)])) {
      if (k !== x && atomMentionsVar(ctx, k, x)) return null;
    }
    if (degIn(ra.d, x) > 0 || degIn(rb.d, x) > 0) return null;
    const A = ra.n, B = rb.n;
    if (pIsZero(A) || pIsZero(B)) return N(0);
    const m = degIn(A, x), n = degIn(B, x);
    if (m + n > 12) return null;
    let det: Poly;
    if (m === 0 && n === 0) det = P_ONE();
    else if (m === 0) det = pPow(A, n);
    else if (n === 0) det = pPow(B, m);
    else {
      const ca = coeffsIn(A, x), cb = coeffsIn(B, x);
      const size = m + n;
      const M: Poly[][] = [];
      for (let i = 0; i < n; i++) {
        const row: Poly[] = new Array(size).fill(null).map(() => []);
        for (let j = 0; j <= m; j++) row[i + j] = ca[m - j] ?? [];
        M.push(row);
      }
      for (let i = 0; i < m; i++) {
        const row: Poly[] = new Array(size).fill(null).map(() => []);
        for (let j = 0; j <= n; j++) row[i + j] = cb[n - j] ?? [];
        M.push(row);
      }
      det = bareiss(M, { ops: GCD_MAX_OPS * 5, deadline: Date.now() + 2 * GCD_MAX_MS });
    }
    const den = pMul(pPow(ra.d, n), pPow(rb.d, m));
    return rfToExpr(rfNorm(det, den), ctx);
  } catch (err) {
    if (err instanceof CasBail || err instanceof GcdCap) return null;
    throw err;
  }
}
export { polyResultant as resultant };

/** Determinant by fraction-free Bareiss elimination over ℚ[atoms]. */
function bareiss(M: Poly[][], budget: Budget): Poly {
  const n = M.length;
  let sign = 1;
  let prev: Poly = P_ONE();
  for (let k = 0; k < n - 1; k++) {
    if (pIsZero(M[k][k])) {
      let swap = -1;
      for (let i = k + 1; i < n; i++) if (!pIsZero(M[i][k])) { swap = i; break; }
      if (swap < 0) return [];
      [M[k], M[swap]] = [M[swap], M[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        tick(budget);
        const num = pAdd(pMul(M[k][k], M[i][j]), pNeg(pMul(M[i][k], M[k][j])));
        const q = mvDivExact(num, prev, budget);
        if (!q) throw new CasBail("Bareiss division was not exact");
        M[i][j] = q;
      }
    }
    prev = M[k][k];
  }
  const d = M[n - 1][n - 1];
  return sign < 0 ? pNeg(d) : d;
}

/** Does the (composite) atom's expression mention variable `x`? */
function atomMentionsVar(ctx: Ctx, key: string, x: string): boolean {
  const e = ctx.atoms.get(key);
  if (!e) return key === x;
  return exprMentionsVar(e, x);
}

function exprMentionsVar(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num": return false;
    case "var": return e.name === x;
    case "neg": return exprMentionsVar(e.e, x);
    case "fn": return exprMentionsVar(e.arg, x);
    default: return exprMentionsVar(e.l, x) || exprMentionsVar(e.r, x);
  }
}
