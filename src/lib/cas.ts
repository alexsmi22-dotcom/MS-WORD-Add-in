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
// sin²/sin). Multivariate polynomial GCD is not attempted; those fractions
// stay unreduced, which is correct, just not minimal.

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

function rfNorm(n: Poly, d: Poly): RF {
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
        return atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r: qToExpr(q) });
      }
      // Symbolic exponent (x^y, 2^x): opaque atom over canonicalised parts.
      const base = normalize(e.l, ctx);
      return atomFor(ctx, { t: "pow", l: rfToExpr(base, ctx), r: rfToExpr(exp, ctx) });
    }
    case "fn": {
      const arg = normalize(e.arg, ctx);
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
  for (const k of keys) {
    const e = m.a.get(k)!;
    const base = atomExpr(ctx, k);
    factors.push(e === 1 ? base : { t: "pow", l: base, r: N(e) });
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
export function casSimplify(e: Expr): Expr {
  const ctx: Ctx = { atoms: new Map() };
  return rfToExpr(normalize(e, ctx), ctx);
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
export function exprEqual(a: Expr, b: Expr): boolean | null {
  try {
    const ctx: Ctx = { atoms: new Map() };
    return rfIsZero(rfSub(normalize(a, ctx), normalize(b, ctx)));
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
  kind: "linear" | "quadratic";
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
  if (deg < 1 || deg > 2) return null;
  const coeff = (k: number): Poly => pNorm(byDeg.get(k) ?? []);
  const b0 = coeff(0), b1 = coeff(1);

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
      return casSimplify(raw);
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
  const divisors = (v: bigint): bigint[] => {
    v = bAbs(v);
    if (v === 0n) return [1n];
    const out: bigint[] = [];
    // Bounded trial division: a user-typed polynomial has small coefficients,
    // and giving up simply means the factor stays unfactored (honest, not wrong).
    for (let i = 1n; i <= v && i <= 10000n; i++) if (v % i === 0n) out.push(i);
    return out;
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
  return { roots, rest: p, incomplete: candidatesTruncated };
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
