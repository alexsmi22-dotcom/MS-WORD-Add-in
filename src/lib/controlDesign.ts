// Control design: root locus, Nyquist, lead/lag compensation and discrete time.
//
// EVERYTHING HERE IS BUILT ON control.ts AND REUSES IT. The plant is parsed by
// parseTf, poles come from polyRoots (one root finder, one answer), closed loops
// from feedback(), stability verdicts from analyzeStability (exact Routh-Hurwitz
// cross-checked against the poles), margins from margins() and step responses
// from timeResponse(). Nothing in this file is a second implementation of any of
// those; where it needs a new number it computes it from them.
//
// COEFFICIENTS RUN HIGHEST POWER FIRST, exactly as in control.ts. The CAS helpers
// imported below (ratPolyMul, ratPolyEval ...) run the OTHER way (index =
// degree) and are used only on the auxiliary polynomials in u = omega^2 that this
// file builds itself, which are kept ascending throughout and never mixed with a
// transfer-function array. Every crossing between the two conventions goes
// through `asc()` / `desc()` so the reversal is written once.
//
// THE HOUSE RULE ON CROSS-CHECKS. Where a question is answered twice, by two
// methods that share no arithmetic, both answers are compared and a disagreement
// is REPORTED, never resolved by picking one:
//   - Nyquist: Z = N + P from the winding number of the contour, against the
//     right-half-plane pole count of the closed loop from analyzeStability.
//   - Root locus jw crossings: exact elimination in omega^2, confirmed by the exact
//     Routh array at that gain (a row of zeros, auxiliary roots at +/-j*omega).
//   - Discrete stability: an exact Schur-Cohn (Jury) recursion over the
//     rationals, against |z| of the computed poles.
//
// EVERY LOOP HAS A HARD CAP and non-finite input is refused up front: this runs
// in a task pane on every keystroke, where a loop that does not return is a
// frozen Word rather than an error.

import {
  Rat,
  ratAdd,
  ratSub,
  ratMul,
  ratDiv,
  ratInt,
  ratIsZero,
  ratNeg,
  ratSign,
  ratToNumber,
  ratFromNumber,
  ratEq,
  ratPolyMul,
  ratPolyAdd,
  ratPolyScale,
  ratPolyTrim,
  ratPolyEval,
  ratPolyRoots,
  ratMake,
} from "./cas";
import { Complex } from "./linalg";
import { fmtSig } from "./axis";
import {
  TransferFunction,
  ControlError,
  trimPoly,
  polyMul,
  polyAdd,
  polyDegree,
  polyEvalComplex,
  polyDeriv,
  polyRemainder,
  polyRoots,
  polyRootsNumeric,
  routhHurwitz,
  analyzeStability,
  routhWork,
  repeatedPart,
  expm,
  StabilityResult,
  feedback,
  series,
  frequencyResponse,
  margins,
  Margins,
  timeResponse,
  numericClosedLoopStable,
} from "./control";

const MAX_ORDER = 20;
/** RK4 step budget for each step response simulated inside a design or c2d (round 3: freeze). */
export const STEP_BUDGET = 20000;
/** routhWork() above which the design tools skip the exact Routh array (about 30 ms per call). */
export const ROUTH_WORK_LIMIT = 2000;
const RW = { routhWorkLimit: ROUTH_WORK_LIMIT };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Highest-first -> ascending (a copy). */
const asc = (p: Rat[]): Rat[] => p.slice().reverse();
/** Ascending -> highest-first (a copy), trimmed. */
const desc = (p: Rat[]): Rat[] => (p.length ? trimPoly(p.slice().reverse()) : [ratInt(0)]);

/**
 * RULE F (Release D): exact evaluation WITHOUT a gcd per step. ratPolyEval reduces after
 * every multiply and add (two BigInt gcds per coefficient, on numbers that grow with the
 * degree); on an order-20 decimal plant that was two thirds of a 0.85 s root locus. Here
 * the polynomial is scaled once to integers (L·P, L > 0 the lcm of its denominators,
 * memoised per array) and evaluated at q = a/b homogeneously,
 *   H = Σ L·pᵢ · aⁱ · bⁿ⁻ⁱ   so   P(q) = H / (L · bⁿ),
 * with ONE reduction at the end. The value is the same reduced fraction ratPolyEval
 * returns (a rational has one reduced form), and its sign is sign(H) with no reduction.
 */
const scaledIntsCache = new WeakMap<Rat[], { a: bigint[]; L: bigint }>();
function scaledInts(pAsc: Rat[]): { a: bigint[]; L: bigint } {
  const hit = scaledIntsCache.get(pAsc);
  if (hit) return hit;
  const ab = (x: bigint): bigint => (x < 0n ? -x : x);
  const gcd = (x: bigint, y: bigint): bigint => {
    x = ab(x);
    y = ab(y);
    for (let k = 0; y && k < 100000; k++) [x, y] = [y, x % y];
    return x;
  };
  let L = 1n;
  for (const c of pAsc) L = (L / gcd(L, c.d)) * c.d;
  const out = { a: pAsc.map((c) => (c.n * L) / c.d), L };
  scaledIntsCache.set(pAsc, out);
  return out;
}
/** H for pAsc at q (see scaledInts); P(q) = H / (L·q.dⁿ). */
function homogeneousHorner(pAsc: Rat[], q: Rat): { h: bigint; den: bigint } {
  const { a, L } = scaledInts(pAsc);
  const n = a.length - 1;
  if (n < 0) return { h: 0n, den: 1n };
  let h = a[n];
  let bp = 1n;
  for (let i = n - 1; i >= 0; i--) {
    bp *= q.d;
    h = h * q.n + a[i] * bp;
  }
  return { h, den: L * bp };
}
/** Exactly ratPolyEval(pAsc, q), with one reduction instead of one per coefficient. */
function ratPolyEvalFast(pAsc: Rat[], q: Rat): Rat {
  if (!(q.d > 0n)) return ratPolyEval(pAsc, q);
  const { h, den } = homogeneousHorner(pAsc, q);
  return h === 0n ? ratInt(0) : ratMake(h, den);
}
/** The exact sign of P(q) (−1, 0, 1), with no reduction at all. */
function ratPolySignAt(pAsc: Rat[], q: Rat): number {
  if (!(q.d > 0n)) return ratSign(ratPolyEval(pAsc, q));
  const { h } = homogeneousHorner(pAsc, q);
  return h > 0n ? 1 : h < 0n ? -1 : 0;
}

const cAbs = (z: Complex): number => Math.hypot(z.re, z.im);
const cSub = (a: Complex, b: Complex): Complex => ({
  re: a.re - b.re,
  im: a.im - b.im,
});
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / d,
    im: (a.im * b.re - a.re * b.im) / d,
  };
};
const cExp = (z: Complex): Complex => {
  const m = Math.exp(z.re);
  return { re: m * Math.cos(z.im), im: m * Math.sin(z.im) };
};

/** Evaluates a highest-first DOUBLE polynomial at a complex point. */
function evalNum(p: number[], s: Complex): Complex {
  let re = 0;
  let im = 0;
  for (const c of p) {
    const nr = re * s.re - im * s.im + c;
    const ni = re * s.im + im * s.re;
    re = nr;
    im = ni;
  }
  return { re, im };
}

/** L(s) = num/den at a complex point; Infinity when den vanishes. */
function tfAt(tf: TransferFunction, s: Complex): Complex {
  const n = polyEvalComplex(tf.num, s.re, s.im);
  const d = polyEvalComplex(tf.den, s.re, s.im);
  if (d.re === 0 && d.im === 0) return { re: Infinity, im: Infinity };
  return cDiv(n, d);
}

/** Integer with a true minus. */
export function intText(k: number): string {
  return k < 0 ? `−${-k}` : String(k);
}

/**
 * Exact rational roots (with multiplicity) of an ASCENDING rational polynomial, under a
 * WORK budget.
 *
 * ratPolyRoots (the rational-root theorem) is exact and, when its search completes,
 * PROVES there are no further rational roots, but its cost is set by the divisors of the
 * integer-scaled end coefficients: for an expanded 6th–7th order decimal plant
 * ("810.887217 1327.423748 ...") the breakaway polynomial has degree 10–12 and 40–67-bit
 * end coefficients, and a root locus froze the pane for 10 to 17 seconds. So:
 *
 *   1. the numeric roots propose candidates (each real root and the MEAN of each cluster,
 *      since a root of multiplicity m is found only to about eps^(1/m) while the cluster
 *      mean is accurate). A rational root p/q has q dividing the integer-scaled leading
 *      coefficient a_n, so each candidate x is tried as round(x·a_n)/a_n (and its
 *      neighbours) as well as by continued fractions; a candidate is accepted only if the
 *      polynomial vanishes there EXACTLY, and is then divided out;
 *   2. a linear remainder's root is exact by construction;
 *   3. whatever remains goes to ratPolyRoots WHEN THAT IS CHEAP (degree <= 8 and end
 *      coefficients of at most 48 bits; measured: a 58-bit end coefficient cost 0.7 s), which also makes the answer COMPLETE.
 *
 * `incomplete` is true when nothing proves the remainder free of rational roots — the
 * caller must then say "not verified exactly", never "irrational".
 */
function rationalRoots(
  pAsc: Rat[],
  needProof = false,
): { roots: { root: Rat; mult: number }[]; rest: Rat[]; incomplete: boolean } {
  let p = ratPolyTrim(pAsc);
  const roots: { root: Rat; mult: number }[] = [];
  const add = (q: Rat, m = 1): void => {
    const e = roots.find((r) => ratEq(r.root, q));
    if (e) e.mult += m;
    else roots.push({ root: q, mult: m });
  };
  const absB = (x: bigint): bigint => (x < 0n ? -x : x);
  const bits = (q: Rat): number => absB(q.n).toString(2).length + q.d.toString(2).length;
  /** Integer-scaled coefficients (ascending). */
  const ints = (pp: Rat[]): bigint[] => {
    let l = 1n;
    const g = (a: bigint, b: bigint): bigint => {
      a = absB(a);
      b = absB(b);
      for (let k = 0; b && k < 10000; k++) [a, b] = [b, a % b];
      return a;
    };
    for (const c of pp) l = (l / g(l, c.d)) * c.d;
    return pp.map((c) => (c.n * l) / c.d);
  };
  let tooBig = false;
  for (let guard = 0; guard <= 2 * MAX_ORDER + 2 && p.length >= 3; guard++) {
    if (p.some((c) => bits(c) > 4000)) {
      tooBig = true;
      break;
    }
    if (ratIsZero(p[0])) {
      add(ratInt(0));
      p = ratPolyTrim(p.slice(1));
      continue;
    }
    const descN = p.map((c) => ratToNumber(c)).reverse();
    if (descN.some((v) => !Number.isFinite(v))) {
      tooBig = true;
      break;
    }
    const nr = polyRootsNumeric(descN) ?? [];
    const cands: number[] = [];
    // cluster means first (repeated roots), then the individual real roots
    const used = new Array(nr.length).fill(false);
    for (let i = 0; i < nr.length; i++) {
      if (used[i]) continue;
      const grp = [i];
      for (let j = i + 1; j < nr.length; j++) {
        if (!used[j] && cAbs(cSub(nr[i], nr[j])) <= 2e-2 * Math.max(1, cAbs(nr[i]))) grp.push(j);
      }
      if (grp.length > 1) {
        grp.forEach((k) => (used[k] = true));
        const mre = grp.reduce((s2, k) => s2 + nr[k].re, 0) / grp.length;
        const mim = grp.reduce((s2, k) => s2 + nr[k].im, 0) / grp.length;
        if (Math.abs(mim) <= 1e-6 * Math.max(1, Math.abs(mre))) cands.push(mre);
      }
    }
    for (const z of nr) if (Math.abs(z.im) <= 1e-6 * Math.max(1, cAbs(z))) cands.push(z.re);
    // Two passes: small denominators first (cheap), and only if none hits, candidates
    // scaled by the integer leading coefficient (whose lcm computation costs BigInt gcds).
    let hit: Rat | null = null;
    let an = 0n;
    let anNum = 0;
    for (let pass = 0; pass < 2 && !hit; pass++) {
      if (pass === 1) {
        const iv = ints(p);
        an = absB(iv[iv.length - 1]);
        anNum = Number(an);
      }
      for (const x of cands) {
        const tries: Array<Rat | null> = [];
        // smallest denominators first: a root of multiplicity m is only found to about
        // eps^(1/m) (−0.9999 for a 4-fold −1), and the continued fraction must stop at the
        // simple rational before it chases that error into a large denominator
        if (pass === 0) for (const md of [10, 100, 1000, 10000, 100000, 1000000]) tries.push(bestRational(x, md));
        else {
          if (an > 0n && Number.isFinite(anNum) && Math.abs(x) * anNum < 2 ** 52) {
            const k = Math.round(x * anNum);
            for (const dk of [0, -1, 1]) tries.push(ratMake(BigInt(k + dk), an));
          }
          if (anNum > 1000000 && anNum <= 1e15) tries.push(bestRational(x, anNum));
        }
        for (const q of tries) {
          if (!q) continue;
          // floating-point screen first: an exact BigInt evaluation only for a near-root
          const qv = ratToNumber(q);
          let val = 0;
          let scale = 0;
          for (const cN of descN) {
            val = val * qv + cN;
            scale = scale * Math.abs(qv) + Math.abs(cN);
          }
          if (!(Math.abs(val) <= 1e-7 * scale)) continue;
          if (ratPolySignAt(p, q) === 0) {
            hit = q;
            break;
          }
        }
        if (hit) break;
      }
    }
    if (!hit) break;
    add(hit);
    p = deflateAsc(p, hit);
  }
  if (!tooBig && p.length === 2) {
    // linear remainder c0 + c1 x: its root is exact
    add(ratNeg(ratDiv(p[0], p[1])));
    p = [p[1]];
  }
  let complete = p.length < 2;
  // Step 3 only PROVES there are no more rational roots; callers that do not state such a
  // proof (snapping, breakaways) skip it, which is most of the cost on ordinary plants.
  if (needProof && !complete && !tooBig && p.length - 1 <= 8) {
    const iv = ints(p);
    const nz = iv.filter((v) => v !== 0n);
    // THE GATE IS ON THE WORK, measured before the call (round 3: gating on the end
    // coefficients alone let 7th-order decimal plants take 5 s). ratPolyRoots trial-divides
    // the end coefficients up to 200 000 (complete only below ~2^35) and then evaluates every
    // candidate p/q exactly; so: every coefficient small, ends below 2^35, and
    // (candidates × degree) bounded. A call that would come back incomplete is not made.
    const bitsOf = (v: bigint): number => absB(v).toString(2).length;
    const small = nz.length > 0 && iv.every((v) => bitsOf(v) <= 64);
    const endsOk = nz.length > 0 && bitsOf(nz[0]) <= 35 && bitsOf(nz[nz.length - 1]) <= 35;
    let cheap = small && endsOk;
    if (cheap) {
      const cand = 2 * divisorCount(Number(absB(nz[0]))) * divisorCount(Number(absB(nz[nz.length - 1])));
      cheap = cand <= 4000 && cand * p.length <= 8000;
    }
    if (cheap) {
      try {
        const rr = ratPolyRoots(p);
        for (const r of rr.roots) add(r.root, r.mult);
        p = ratPolyTrim(rr.rest);
        complete = !rr.incomplete || p.length < 2;
      } catch {
        complete = false;
      }
    }
  }
  return { roots, rest: p, incomplete: !complete };
}

/** Number of divisors of a positive integer below 2^35 (trial division, bounded). */
function divisorCount(v: number): number {
  if (!(v >= 1) || !Number.isSafeInteger(v)) return Infinity;
  let c = 0;
  for (let i = 1; i * i <= v && i <= 200000; i++) if (v % i === 0) c += i * i === v ? 1 : 2;
  return c;
}

/** The best rational approximation to x with denominator <= maxDen (continued fractions). */
function bestRational(x: number, maxDen: number): Rat | null {
  if (!Number.isFinite(x) || Math.abs(x) > 1e12) return null;
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  let r = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(r);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const frac = r - a;
    if (Math.abs(frac) < 1e-12 || Math.abs(h1 / k1 - x) <= 1e-15 * Math.max(1, Math.abs(x))) break;
    r = 1 / frac;
    if (!Number.isFinite(r)) break;
  }
  if (k1 === 0 || !Number.isSafeInteger(h1) || !Number.isSafeInteger(k1)) return null;
  return ratMake(BigInt(h1), BigInt(k1));
}

/** p(x)/(x − q) for an ASCENDING p with p(q) = 0 (synthetic division, exact). */
function deflateAsc(pAsc: Rat[], q: Rat): Rat[] {
  const d = pAsc.slice().reverse();
  const out: Rat[] = [];
  let acc = ratInt(0);
  for (let i = 0; i < d.length - 1; i++) {
    acc = ratAdd(ratMul(acc, q), d[i]);
    out.push(acc);
  }
  return ratPolyTrim(out.reverse());
}

/**
 * Replaces computed roots by the exact rational roots of the polynomial where they
 * agree, so a pole at −2 prints and segments as −2, not −1.9999999999999996, and a
 * root of multiplicity m (found only to about eps^(1/m), so (s+1)^5 came back as
 * −0.9993 ± 5.27×10⁻⁴j ...) is snapped m times: the m computed roots nearest it.
 */
function snapRational(p: Rat[], roots: Complex[]): Complex[] {
  let exact: { root: Rat; mult: number }[] = [];
  try {
    exact = rationalRoots(asc(trimPoly(p))).roots;
  } catch {
    exact = [];
  }
  const out = roots.slice();
  const taken = new Array(out.length).fill(false);
  for (const e of exact) {
    const x = ratToNumber(e.root);
    // tolerance scales with multiplicity: eps^(1/m), with headroom
    const tol = Math.max(1e-6, 10 * Math.pow(2.2e-16, 1 / e.mult)) * Math.max(1, Math.abs(x));
    const order = out
      .map((z, i) => ({ i, d: cAbs(cSub(z, { re: x, im: 0 })) }))
      .filter((c) => !taken[c.i] && c.d <= tol)
      .sort((a, b) => a.d - b.d)
      .slice(0, e.mult);
    for (const c of order) {
      out[c.i] = { re: x, im: 0 };
      taken[c.i] = true;
    }
  }
  return out;
}

/**
 * Roots with the exact rational ones EXTRACTED first: they are listed exactly (with their
 * multiplicity) and divided out, and the remainder, now free of the clusters that wreck
 * a numeric root finder near a repeated root, is solved numerically. Round 4: the all-real
 * poles of (s+1)⁴(s² + 2.002s + 1.001999) printed as complex pairs (−0.9966 ± 0.002061j)
 * and the real-axis segments built from them were wrong. A remaining conjugate pair whose
 * imaginary part is below the cluster error (about eps^(1/m) for m clustered roots) is real.
 */
function exactAwareRoots(pDesc: Rat[]): Complex[] | null {
  const t = trimPoly(pDesc);
  if (polyDegree(t) < 1) return [];
  let exact: { root: Rat; mult: number }[] = [];
  let rest = asc(t);
  try {
    const rr = rationalRoots(asc(t));
    exact = rr.roots;
    rest = rr.rest;
  } catch {
    exact = [];
  }
  const out: Complex[] = [];
  for (const e of exact) for (let k = 0; k < e.mult; k++) out.push({ re: ratToNumber(e.root), im: 0 });
  if (rest.length === 3) {
    // a quadratic remainder: the numerically stable closed form (discriminant exact)
    const [c0, c1, c2] = rest;
    const disc = ratToNumber(ratSub(ratMul(c1, c1), ratMul(ratInt(4), ratMul(c2, c0))));
    const A = ratToNumber(c2);
    const B = ratToNumber(c1);
    const C = ratToNumber(c0);
    if (disc >= 0) {
      const qv = -0.5 * (B + Math.sign(B || 1) * Math.sqrt(disc));
      const r1 = qv / A;
      const r2 = qv !== 0 ? C / qv : 0;
      out.push({ re: r1, im: 0 }, { re: r2, im: 0 });
    } else {
      const re = -B / (2 * A);
      const im = Math.sqrt(-disc) / (2 * Math.abs(A));
      out.push({ re, im }, { re, im: -im });
    }
    return out;
  }
  if (rest.length >= 2) {
    const nr = polyRoots(desc(rest));
    if (!nr) return null;
    for (const z of nr) {
      const m = nr.filter((w) => cAbs(cSub(w, z)) <= 1e-3 * Math.max(1, cAbs(z))).length;
      const tol = Math.max(1e-12, 10 * Math.pow(2.2e-16, 1 / Math.max(1, m))) * Math.max(1, cAbs(z));
      out.push(Math.abs(z.im) <= tol && m > 1 ? { re: z.re, im: 0 } : z);
    }
  }
  return out;
}

/** Number of trailing zero coefficients = multiplicity of the root at s = 0. */
function originMultiplicity(p: Rat[]): number {
  const t = trimPoly(p);
  let k = 0;
  for (let i = t.length - 1; i > 0 && ratIsZero(t[i]); i--) k++;
  return k;
}

/** Real polynomial (highest first) with the given roots, conjugates assumed paired. */
function polyFromRoots(roots: Complex[]): number[] {
  let re: number[] = [1];
  let im: number[] = [0];
  for (const r of roots) {
    const nr = new Array(re.length + 1).fill(0);
    const ni = new Array(re.length + 1).fill(0);
    for (let i = 0; i < re.length; i++) {
      nr[i] += re[i];
      ni[i] += im[i];
      // - r * (re + j im)
      nr[i + 1] -= r.re * re[i] - r.im * im[i];
      ni[i + 1] -= r.re * im[i] + r.im * re[i];
    }
    re = nr;
    im = ni;
  }
  return re;
}

/** A double as an exact rational, or null when it is not finite. */
function toRat(v: number): Rat | null {
  if (!Number.isFinite(v)) return null;
  try {
    return ratFromNumber(v);
  } catch {
    return null;
  }
}

/** Rounds to `sig` significant figures and returns it as an exact rational. */
export function roundRat(v: number, sig = 4): Rat | null {
  if (!Number.isFinite(v)) return null;
  if (v === 0) return ratInt(0);
  return toRat(Number(v.toPrecision(sig)));
}

/** Non-negative integer square root of a bigint, or null when not a perfect square. */
function bigSqrtExact(v: bigint): bigint | null {
  if (v < 0n) return null;
  if (v < 2n) return v;
  // INTEGER NEWTON FROM AN OVER-ESTIMATE: x0 = 2^ceil(bits/2) >= sqrt(v), and the iterate
  // x <- (x + v/x)/2 then decreases monotonically to floor(sqrt v) in O(log bits) steps.
  // (Round 4: a float seed that came out LOW made the old correction loop count up by one,
  // 5 s for a 12-digit plant and over a minute for 20-digit ones.)
  let x = 1n << BigInt(Math.ceil(v.toString(2).length / 2));
  for (let i = 0; i < 4096; i++) {
    const y = (x + v / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x * x === v ? x : null;
}

/** sqrt of a positive rational, exactly, when it is rational. */
export function ratSqrtExact(q: Rat): Rat | null {
  if (ratSign(q) < 0) return null;
  const a = bigSqrtExact(q.n);
  const b = bigSqrtExact(q.d);
  return a !== null && b !== null ? ratMake(a, b) : null;
}

// ---------------------------------------------------------------------------
// Optimal matching (Hungarian algorithm), for following roots between steps
// ---------------------------------------------------------------------------

/**
 * Minimum-total-cost assignment of rows to columns of a square cost matrix.
 * O(n^3); n <= 20 here. Greedy nearest-neighbour matching swaps branches at a
 * breakaway point, where two roots meet and leave at right angles; the optimal
 * assignment does not.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = Number.MAX_VALUE;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    for (let guard = 0; guard <= n + 1; guard++) {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
      if (p[j0] === 0) break;
    }
    for (let guard = 0; guard <= n + 1 && j0; guard++) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    }
  }
  // assignment[row] = column
  const out = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) if (p[j] > 0) out[p[j] - 1] = j - 1;
  return out;
}

// ---------------------------------------------------------------------------
// Real/imaginary split of P(j*omega) as polynomials in u = omega^2
// ---------------------------------------------------------------------------

/**
 * For p(s) highest-first, p(j*omega) = R(u) + j*omega*I(u) with u = omega^2.
 * Both returned ASCENDING in u, exact.
 */
function jwSplit(p: Rat[]): { R: Rat[]; I: Rat[] } {
  const t = trimPoly(p);
  const n = t.length - 1;
  const R: Rat[] = [];
  const I: Rat[] = [];
  for (let i = 0; i <= n; i++) {
    const k = n - i;
    const c = t[i];
    if (k % 2 === 0) {
      const idx = k / 2;
      while (R.length <= idx) R.push(ratInt(0));
      R[idx] = ratAdd(R[idx], idx % 2 === 0 ? c : ratNeg(c));
    } else {
      const idx = (k - 1) / 2;
      while (I.length <= idx) I.push(ratInt(0));
      I[idx] = ratAdd(I[idx], idx % 2 === 0 ? c : ratNeg(c));
    }
  }
  return { R: ratPolyTrim(R), I: ratPolyTrim(I) };
}

/** Real, strictly positive roots of an ascending rational polynomial: exact where rational. */
interface PositiveRoot {
  u: number;
  exact: Rat | null;
  /** Closed form text for a quadratic surd, e.g. "(−7 + √145)/2"; null otherwise. */
  surd: string | null;
  /** u is PROVEN irrational (complete exact search, or a non-square discriminant). */
  irrational: boolean;
}

function positiveRootsAsc(pAsc: Rat[]): PositiveRoot[] {
  const p = ratPolyTrim(pAsc);
  if (p.length < 2) return [];
  const out: PositiveRoot[] = [];
  let rest = p;
  let complete = false;
  try {
    const rr = rationalRoots(p, true);
    for (const r of rr.roots) {
      if (ratSign(r.root) > 0)
        out.push({
          u: ratToNumber(r.root),
          exact: r.root,
          surd: null,
          irrational: false,
        });
    }
    rest = ratPolyTrim(rr.rest);
    complete = !rr.incomplete;
  } catch {
    rest = p;
  }
  if (rest.length >= 2) {
    const restDesc = desc(rest);
    const roots = polyRoots(restDesc) ?? [];
    // A quadratic remainder has a closed form, written as a surd.
    const surds: Array<{ value: number; text: string }> = [];
    if (rest.length === 3) {
      const [c, b, a] = rest; // ascending: c + b u + a u^2
      const disc = ratSub(ratMul(b, b), ratMul(ratInt(4), ratMul(a, c)));
      if (ratSign(disc) > 0 && !ratSqrtExact(disc)) {
        // u = (-b ± √disc)/(2a), rewritten over the positive denominator |2a|.
        const sa = ratSign(a);
        const top = sa > 0 ? ratNeg(b) : b;
        const bottom = ratMul(ratInt(2), sa > 0 ? a : ratNeg(a));
        const sq = Math.sqrt(ratToNumber(disc));
        for (const sgn of [1, -1]) {
          const value = (ratToNumber(top) + sgn * sq) / ratToNumber(bottom);
          surds.push({ value, text: surdText(top, sgn, disc, bottom) });
        }
      }
    }
    for (const z of roots) {
      if (Math.abs(z.im) > 1e-9 * Math.max(1, cAbs(z))) continue;
      if (!(z.re > 0)) continue;
      const s = surds.find((q) => Math.abs(q.value - z.re) <= 1e-7 * Math.max(1, Math.abs(z.re)));
      out.push({
        u: s ? s.value : z.re,
        exact: null,
        surd: s ? s.text : null,
        irrational: !!s || complete,
      });
    }
  }
  out.sort((a, b) => a.u - b.u);
  // Repeated numeric roots collapse to one.
  return out.filter((r, i) => i === 0 || Math.abs(r.u - out[i - 1].u) > 1e-9 * Math.max(1, r.u));
}

/** "(−b ± √disc)/(2a)" written with a positive denominator. */
function surdText(negB: Rat, sign: number, disc: Rat, twoAbsA: Rat): string {
  const rt = (q: Rat): string => (q.d === 1n ? String(q.n) : `${q.n}/${q.d}`).replace(/^-/, "−");
  // Pull square factors out of the discriminant only when it is an integer.
  let rad = rt(disc);
  let coef = "";
  if (disc.d === 1n && disc.n > 0n) {
    let k = 1n;
    let rem = disc.n;
    for (let f = 2n; f * f <= rem && f < 10000n; f++) {
      while (rem % (f * f) === 0n) {
        rem /= f * f;
        k *= f;
      }
    }
    rad = String(rem);
    coef = k === 1n ? "" : String(k);
  }
  const root = disc.d === 1n ? `${coef}√${rad}` : `√(${rad})`;
  const head = ratIsZero(negB) ? (sign > 0 ? root : `−${root}`) : `${rt(negB)} ${sign > 0 ? "+" : "−"} ${root}`;
  if (twoAbsA.n === 1n && twoAbsA.d === 1n) return head;
  return `(${head})/${twoAbsA.d === 1n ? rt(twoAbsA) : `(${rt(twoAbsA)})`}`;
}

// ---------------------------------------------------------------------------
// 1. Root locus
// ---------------------------------------------------------------------------

export interface JwCrossing {
  /** Crossing frequency, rad/s (> 0). */
  w: number;
  /** Gain at which the branch crosses. */
  K: number;
  /** Exact gain when it is rational. */
  kExact: Rat | null;
  /** omega^2 exactly, when rational. */
  w2Exact: Rat | null;
  /** omega exactly, when omega itself is rational. */
  wExact: Rat | null;
  /** Closed form of omega^2 when it is a quadratic surd. */
  w2Surd: string | null;
  /** omega^2 is PROVEN irrational (so no exact Routh array can be formed at this K); false = not verified. */
  w2Irrational: boolean;
  /**
   * The exact Routh array at this K has a row of zeros whose auxiliary
   * polynomial has roots at +/-j*omega: true / false; null when K is irrational
   * and the exact array cannot be formed at it.
   */
  routhConfirmed: boolean | null;
}

export interface Breakaway {
  s: Complex;
  K: number;
  kExact: Rat | null;
  sExact: Rat | null;
}

export interface RootLocusResult {
  ok: true;
  n: number;
  m: number;
  poles: Complex[];
  zeros: Complex[];
  /** Leading coefficients of opposite sign: for K >= 0 this is the 0-degree locus. */
  complementary: boolean;
  centroid: Rat | null;
  asymptoteAnglesDeg: number[];
  /** Real-axis segments on the locus; -Infinity / Infinity for the open ends. */
  realSegments: Array<{ from: number; to: number }>;
  breakaways: Breakaway[];
  /** Real roots of dK/ds where K = −den/num is below round-off: neither confirmed nor excluded. */
  unresolvedBreakaways: number[];
  /** Roots of dK/ds that are REPEATED open-loop poles: branches leave there at K = 0. */
  repeatedPoleBreaks: Complex[];
  crossings: JwCrossing[];
  /** A real branch passes through s = 0 at this gain. */
  originCrossingK: Rat | null;
  /** The loci, one array of points per branch, K ascending. */
  branches: Complex[][];
  gains: number[];
  sweepCapped: boolean;
  /** Gain intervals over which the closed loop is stable (hi = null: unbounded). */
  stableRanges: Array<{
    lo: number;
    hi: number | null;
    loExact: Rat | null;
    hiExact: Rat | null;
  }>;
  stableRangeDoubt: boolean;
  /** The "whole locus is on the imaginary axis" degenerate case. */
  jwAxisLocus: boolean;
  atK: null | { K: Rat; poles: Complex[]; stability: StabilityResult };
  notes: string[];
}

/** Hard caps for the gain sweep. */
const RL_MAX_STEPS = 1500;
const RL_MAX_SOLVES = 6000;

export function rootLocus(g: TransferFunction, kAt: Rat | null = null): RootLocusResult | ControlError {
  const num = trimPoly(g.num);
  const den = trimPoly(g.den);
  const n = polyDegree(den);
  const m = polyDegree(num);
  if (m < 0)
    return {
      ok: false,
      error: "The numerator is zero, so the loop gain is zero for every K and there is no locus.",
    };
  if (n < 1)
    return {
      ok: false,
      error: "The denominator has no s in it, so there are no open-loop poles to start a locus from.",
    };
  if (m > n) {
    return {
      ok: false,
      error:
        "This open loop is IMPROPER (the numerator has the higher degree). Its root locus has branches " +
        "arriving from infinity at K = 0, which is not a physical loop; enter a proper G(s)H(s).",
    };
  }
  if (n > MAX_ORDER)
    return {
      ok: false,
      error: `Order ${n} is above the limit of ${MAX_ORDER}.`,
    };
  if ([...num, ...den].some((c) => !Number.isFinite(ratToNumber(c)))) {
    return {
      ok: false,
      error: "These coefficients overflow double precision.",
    };
  }
  const notes: string[] = [];

  const poles = exactAwareRoots(den);
  const zeros = m > 0 ? exactAwareRoots(num) : [];
  if (!poles || !zeros)
    return {
      ok: false,
      error: "The open-loop poles or zeros could not be computed.",
    };
  // Ascending copies made ONCE, so ratPolyEvalFast scales each to integers once.
  const denAsc = asc(den);
  const numAsc = asc(num);

  const complementary = ratSign(num[0]) * ratSign(den[0]) < 0;
  if (complementary) {
    notes.push(
      "The numerator and denominator lead with opposite signs (a negative high-frequency loop gain), so " +
        "for K ≥ 0 this is the COMPLEMENTARY (0°) locus: asymptotes at multiples of 360°/(n − m) and the " +
        "real-axis rule reversed. That is what 1 + K·G(s)H(s) = 0 with K ≥ 0 actually gives here.",
    );
  }

  // Asymptotes and centroid, exact from the coefficients.
  const q = n - m;
  let centroid: Rat | null = null;
  const asymptoteAnglesDeg: number[] = [];
  if (q > 0) {
    const sumP = n >= 1 ? ratNeg(ratDiv(den[1] ?? ratInt(0), den[0])) : ratInt(0);
    const sumZ = m >= 1 ? ratNeg(ratDiv(num[1] ?? ratInt(0), num[0])) : ratInt(0);
    centroid = ratDiv(ratSub(sumP, sumZ), ratInt(q));
    for (let l = 0; l < q; l++) {
      let a = complementary ? (360 * l) / q : (180 * (2 * l + 1)) / q;
      if (a > 180) a -= 360;
      asymptoteAnglesDeg.push(a);
    }
    asymptoteAnglesDeg.sort((a, b) => a - b);
  }

  // K(sigma) = -den/num on the real axis.
  // EXACT SIGN of K(σ) = −den(σ)/num(σ) at a rational test point: next to a repeated pole
  // den(σ) is of order 10⁻¹⁸ and its double-precision value has the wrong sign (round 4: the
  // segments of (s+1)⁴(s² + 2.002s + 1.001999) vanished).
  const Kreal = (x: number): number => {
    const q = toRat(x);
    if (q) {
      const dq = ratPolyEvalFast(denAsc, q);
      const nq = ratPolyEvalFast(numAsc, q);
      if (!ratIsZero(nq)) return -ratSign(dq) * ratSign(nq);
    }
    const d = polyEvalComplex(den, x, 0).re;
    const nn = polyEvalComplex(num, x, 0).re;
    return -d / nn;
  };

  // Real-axis segments.
  const tolRe = (z: Complex): boolean => Math.abs(z.im) <= 1e-9 * Math.max(1, cAbs(z));
  const crit = [...poles, ...zeros]
    .filter(tolRe)
    .map((z) => z.re)
    .sort((a, b) => a - b);
  const featScale = Math.max(1, ...[...poles, ...zeros].map(cAbs).filter(Number.isFinite));
  const realSegments: Array<{ from: number; to: number }> = [];
  const bounds = [-Infinity, ...crit, Infinity];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (a === b) continue;
    // With no real pole or zero the whole axis is one interval (−∞, ∞); its test point
    // is 0 (num(0) ≠ 0 there, since num has no real roots). K(σ) = −den/num > 0 is the
    // rule for either sign of the gain, so a negative numerator needs no special case.
    const mid =
      !Number.isFinite(a) && !Number.isFinite(b)
        ? 0
        : !Number.isFinite(a)
          ? b - featScale
          : !Number.isFinite(b)
            ? a + featScale
            : (a + b) / 2;
    if (!Number.isFinite(mid)) continue;
    const K = Kreal(mid);
    if (K > 0 && Number.isFinite(K)) {
      const last = realSegments[realSegments.length - 1];
      if (last && last.to === a) last.to = b;
      else realSegments.push({ from: a, to: b });
    }
  }
  if (!crit.length && realSegments.length) {
    // No real poles or zeros: the whole axis cannot be one segment unless K(x) > 0 everywhere.
    // Kept as computed; the midpoint test above already decided it.
  }

  // Breakaway / break-in: N'D - ND' = 0 with real K > 0.
  const breakaways: Breakaway[] = [];
  const denAbs = den.map((c) => Math.abs(ratToNumber(c)));
  const unresolvedBreakaways: number[] = [];
  const repeatedPoleBreaks: Complex[] = [];
  const repPart = repeatedPart(den);
  // the repeated poles themselves: the roots of gcd(den, den′)
  const repRoots = repPart.length > 1 ? (polyRootsNumeric(repPart.map((c) => Number(c))) ?? []) : [];
  const qPoly = polyAdd(polyMul(polyDeriv(num), den), polyMul(ratNeg1(num), polyDeriv(den)));
  if (polyDegree(qPoly) >= 1) {
    const exactRoots: Rat[] = [];
    let restDesc = qPoly;
    try {
      const rr = rationalRoots(asc(qPoly));
      for (const r of rr.roots) exactRoots.push(r.root);
      restDesc = desc(rr.rest);
    } catch {
      restDesc = qPoly;
    }
    for (const r of exactRoots) {
      const nv = ratPolyEvalFast(numAsc, r);
      if (ratIsZero(nv)) continue;
      const K = ratNeg(ratDiv(ratPolyEvalFast(denAsc, r), nv));
      if (ratSign(K) > 0)
        breakaways.push({
          s: { re: ratToNumber(r), im: 0 },
          K: ratToNumber(K),
          kExact: K,
          sExact: r,
        });
    }
    const numericRoots = polyDegree(restDesc) >= 1 ? (polyRoots(restDesc) ?? []) : [];
    const restAsc = asc(restDesc);
    const restNum = restDesc.map((c) => ratToNumber(c));
    for (const s of numericRoots) {
      // A REAL root that is in fact rational is confirmed EXACTLY (qPoly vanishes there) and
      // its K computed exactly, before any noise floor: K = 7.6×10⁻⁹ at s = −271/100 is a
      // genuine break-in that the floor alone would hide (round 4 verification).
      if (Math.abs(s.im) <= 1e-6 * Math.max(1, cAbs(s))) {
        let exactHit: Rat | null = null;
        for (const md of [10, 100, 1000, 10000, 100000, 1000000]) {
          const q = bestRational(s.re, md);
          // a root of the REMAINDER (the extracted exact roots are already listed above)
          if (!q || !(Math.abs(ratToNumber(q) - s.re) <= 1e-6 * Math.max(1, Math.abs(s.re)))) continue;
          // floating screen before the exact BigInt evaluation
          const qv = ratToNumber(q);
          let fv = 0;
          let fs = 0;
          for (const c of restNum) {
            fv = fv * qv + c;
            fs = fs * Math.abs(qv) + Math.abs(c);
          }
          if (!(Math.abs(fv) <= 1e-7 * fs)) continue;
          if (ratPolySignAt(restAsc, q) === 0) {
            exactHit = q;
            break;
          }
        }
        if (exactHit) {
          if (breakaways.some((b) => b.sExact && ratEq(b.sExact, exactHit as Rat))) continue;
          const nq = ratPolyEvalFast(numAsc, exactHit);
          if (!ratIsZero(nq)) {
            const Kq = ratNeg(ratDiv(ratPolyEvalFast(denAsc, exactHit), nq));
            if (ratSign(Kq) > 0) breakaways.push({ s: { re: ratToNumber(exactHit), im: 0 }, K: ratToNumber(Kq), kExact: Kq, sExact: exactHit });
          }
          continue;
        }
      }
      // A REAL numeric root: K = −den/num is evaluated EXACTLY at the rational value of the
      // double s and at s ± δ (δ = the root's own uncertainty: 10⁻¹² relative, 10⁻⁶ inside a
      // cluster of roots). At a breakaway dK/ds = 0, so K is insensitive to that uncertainty;
      // three positive values confirm a point of the locus however small K is (round 4
      // verification: s ≈ −2.71 at K = 7.635×10⁻⁹ is genuine), mixed signs leave it
      // unresolved, three negative values exclude it. No floating cancellation is involved.
      // (Only when floating point cannot settle it: |den(s)| within 10⁻¹⁰ of its own scale.)
      const sAbs = cAbs(s);
      let denScaleHere = 0;
      for (const dA of denAbs) denScaleHere = denScaleHere * sAbs + dA;
      const ambiguous = cAbs(polyEvalComplex(den, s.re, s.im)) <= 1e-10 * denScaleHere;
      // AT A REPEATED OPEN-LOOP POLE, dK/ds = 0 with K = 0 EXACTLY: the branches leave a double
      // pole at K = 0, they do not meet there at a positive gain. A tiny computed K (1.8×10⁻²⁷)
      // is round-off and is never listed as a breakaway (round 5).
      // "Repeated" is decided EXACTLY: s must be a root of gcd(den, den′), the repeated part of
      // the denominator. Two DISTINCT poles 10⁻⁴ apart have a genuine break-in between them at a
      // tiny positive K (s ≈ −2.71 at K = 7.6×10⁻⁹), and that one is kept.
      if (ambiguous && repRoots.length) {
        if (repRoots.some((z) => cAbs(cSub(z, s)) <= 1e-6 * Math.max(1, cAbs(s)))) {
          if (!repeatedPoleBreaks.some((z) => cAbs(cSub(z, s)) <= 1e-5 * Math.max(1, cAbs(s))))
            repeatedPoleBreaks.push({ re: s.re, im: Math.abs(s.im) <= 1e-9 * Math.max(1, cAbs(s)) ? 0 : s.im });
          continue;
        }
      }
      if (ambiguous && Math.abs(s.im) <= 1e-6 * Math.max(1, cAbs(s))) {
        const clustered = numericRoots.some((w) => w !== s && cAbs(cSub(w, s)) <= 1e-3 * Math.max(1, cAbs(s)));
        const delta = (clustered ? 1e-6 : 1e-12) * Math.max(1, Math.abs(s.re));
        const kAt = (x: number): Rat | null => {
          const q = toRat(x);
          if (!q) return null;
          const nq = ratPolyEvalFast(numAsc, q);
          return ratIsZero(nq) ? null : ratNeg(ratDiv(ratPolyEvalFast(denAsc, q), nq));
        };
        const ks = [kAt(s.re), kAt(s.re - delta), kAt(s.re + delta)];
        if (ks.some((k) => k === null)) continue;
        const sg = ks.map((k) => ratSign(k as Rat));
        if (sg.every((v) => v > 0)) breakaways.push({ s: { re: s.re, im: 0 }, K: ratToNumber(ks[0] as Rat), kExact: null, sExact: null });
        else if (!sg.every((v) => v < 0)) unresolvedBreakaways.push(s.re);
        continue;
      }
      const nv = polyEvalComplex(num, s.re, s.im);
      if (cAbs(nv) === 0) continue;
      const K = cDiv(polyEvalComplex(den, s.re, s.im), nv);
      const Kc = { re: -K.re, im: -K.im };
      if (!(Kc.re > 0) || Math.abs(Kc.im) > 1e-6 * Math.max(1e-12, cAbs(Kc))) continue;
      // NOISE FLOOR for a NUMERIC breakaway: when den(s) is zero to within its own round-off
      // (|den(s)| <= 1e-12 · sum |d_i||s|^i), K = −den/num is noise and s is in effect a
      // repeated pole, not a point where branches meet at a positive gain (round 4:
      // "s = −0.9998 at K = 2.22×10⁻¹⁶"). Exact rational breakaways are kept.
      const sMag = cAbs(s);
      let dScale = 0;
      for (const a of denAbs) dScale = dScale * sMag + a;
      if (cAbs(polyEvalComplex(den, s.re, s.im)) <= 1e-12 * dScale) {
        if (Math.abs(s.im) <= 1e-6 * Math.max(1, sMag)) unresolvedBreakaways.push(s.re);
        continue;
      }
      const sClean = tolRe(s) ? { re: s.re, im: 0 } : s;
      breakaways.push({ s: sClean, K: Kc.re, kExact: null, sExact: null });
    }
    // tidy: a real part that is round-off next to a large imaginary part is zero, and the
    // same point found twice (a double root of dK/ds) is listed once
    for (const b of breakaways) if (!b.sExact && Math.abs(b.s.re) <= 1e-9 * cAbs(b.s)) b.s = { re: 0, im: b.s.im };
    for (let i = breakaways.length - 1; i > 0; i--) {
      for (let j = 0; j < i; j++) {
        const a = breakaways[i];
        const c = breakaways[j];
        if (cAbs(cSub(a.s, c.s)) <= 1e-7 * Math.max(1, cAbs(a.s)) && Math.abs(a.K - c.K) <= 1e-7 * Math.max(1e-300, Math.abs(c.K))) {
          breakaways.splice(i, 1);
          break;
        }
      }
    }
    breakaways.sort((a, b) => a.s.re - b.s.re || a.s.im - b.s.im);
  }

  // jw-axis crossings, by exact elimination in u = omega^2.
  const D = jwSplit(den);
  const N = jwSplit(num);
  const E = ratPolyAdd(ratPolyMul(D.R, N.I), ratPolyScale(ratPolyMul(D.I, N.R), ratInt(-1)));
  const crossings: JwCrossing[] = [];
  let jwAxisLocus = false;
  // E ≡ 0 means the real and imaginary equations are dependent: for every ω there is a
  // K = −Re den/Re num (or the imaginary ratio). The locus lies ON the axis only if that
  // K is positive for some ω > 0; for s⁴ + K it is −ω⁴ < 0 and the roots sit at ±45°.
  const axisK = (u: number): number => {
    const ev = (pa: Rat[]): number => {
      let acc = 0;
      for (let i = pa.length - 1; i >= 0; i--) acc = acc * u + ratToNumber(pa[i]);
      return acc;
    };
    const nr = ev(N.R);
    const ni = ev(N.I);
    return Math.abs(nr) >= Math.abs(ni) ? -ev(D.R) / nr : -ev(D.I) / ni;
  };
  let onAxisForSomeK = false;
  if (E.length === 0) {
    const sc = Math.max(1, ...[...poles, ...zeros].map(cAbs).filter(Number.isFinite));
    for (let i = 0; i <= 240 && !onAxisForSomeK; i++) {
      const u = sc * sc * Math.pow(10, -6 + (12 * i) / 240);
      const k = axisK(u);
      if (Number.isFinite(k) && k > 0) onAxisForSomeK = true;
    }
  }
  if (E.length === 0 && onAxisForSomeK) {
    jwAxisLocus = true;
    notes.push(
      "The real and imaginary parts of the characteristic equation are proportional for every ω, which " +
        "means the closed-loop roots lie ON the imaginary axis over a whole range of K (an undamped " +
        "plant with no damping anywhere in the loop). There is no single crossing gain to report.",
    );
  } else if (E.length > 0) {
    for (const r of positiveRootsAsc(E)) {
      const w = Math.sqrt(r.u);
      let K: number;
      let kExact: Rat | null = null;
      if (r.exact) {
        const nr = ratPolyEval(N.R, r.exact);
        const ni = ratPolyEval(N.I, r.exact);
        if (!ratIsZero(nr)) kExact = ratNeg(ratDiv(ratPolyEval(D.R, r.exact), nr));
        else if (!ratIsZero(ni)) kExact = ratNeg(ratDiv(ratPolyEval(D.I, r.exact), ni));
        if (!kExact) continue; // a zero of N on the axis: K undefined there
        K = ratToNumber(kExact);
      } else {
        const ev = (pa: Rat[]): number => {
          let acc = 0;
          for (let i = pa.length - 1; i >= 0; i--) acc = acc * r.u + ratToNumber(pa[i]);
          return acc;
        };
        const nr = ev(N.R);
        const ni = ev(N.I);
        K = Math.abs(nr) >= Math.abs(ni) ? -ev(D.R) / nr : -ev(D.I) / ni;
      }
      if (!(K > 0) || !Number.isFinite(K)) continue;

      // Exact confirmation from the Routh array of den + K*num at a rational K.
      let routhConfirmed: boolean | null = null;
      if (kExact) {
        const cl = polyAdd(den, polyMul([kExact], num));
        // beyond the work budget the confirmation is not attempted (null: not verified)
        const ra = routhWork(cl) <= ROUTH_WORK_LIMIT ? routhHurwitz(cl) : null;
        if (ra === null) routhConfirmed = null;
        else if (ra.ok && ra.zeroRowAt !== null && ra.zeroRowAt >= 1) {
          const above = ra.rows[ra.zeroRowAt - 1];
          const ord = polyDegree(cl) - (ra.zeroRowAt - 1);
          // Auxiliary polynomial A(s) = sum above[i] s^(ord-2i); its jw roots are where
          // A(j omega) = sum above[i] (-1)^((ord-2i)/2) u^((ord-2i)/2) = 0 (ord even).
          if (ord % 2 === 0) {
            const auxU: Rat[] = [];
            for (let i = 0; i < above.length && ord - 2 * i >= 0; i++) {
              const pw = (ord - 2 * i) / 2;
              while (auxU.length <= pw) auxU.push(ratInt(0));
              auxU[pw] = pw % 2 === 0 ? above[i] : ratNeg(above[i]);
            }
            routhConfirmed = r.exact ? ratIsZero(ratPolyEval(ratPolyTrim(auxU), r.exact)) : false;
          } else routhConfirmed = false;
        } else routhConfirmed = false;
      }
      crossings.push({
        w,
        K,
        kExact,
        w2Exact: r.exact,
        wExact: r.exact ? ratSqrtExact(r.exact) : null,
        w2Surd: r.surd,
        w2Irrational: r.irrational,
        routhConfirmed,
      });
    }
  }

  // A real branch through the origin: den(0) + K num(0) = 0.
  let originCrossingK: Rat | null = null;
  const d0 = den[den.length - 1];
  const n0 = num[num.length - 1];
  if (!ratIsZero(n0) && !ratIsZero(d0)) {
    const k0 = ratNeg(ratDiv(d0, n0));
    if (ratSign(k0) > 0) originCrossingK = k0;
  }
  // Biproper: the closed-loop degree drops where den[0] + K num[0] = 0.
  let degreeDropK: Rat | null = null;
  if (m === n) {
    const kd = ratNeg(ratDiv(den[0], num[0]));
    if (ratSign(kd) > 0) {
      degreeDropK = kd;
      notes.push(
        `At K = ${ratPlain(kd)} the leading coefficient of the closed-loop polynomial vanishes and one ` +
          "closed-loop pole leaves through infinity (G(s)H(s) has as many zeros as poles, with a negative " +
          "high-frequency gain).",
      );
    }
  }

  // Stable gain ranges, tested by the exact Routh/pole analysis between critical gains.
  const critK: number[] = [
    ...crossings.map((c) => c.K),
    ...(originCrossingK ? [ratToNumber(originCrossingK)] : []),
    ...(degreeDropK ? [ratToNumber(degreeDropK)] : []),
  ]
    .filter((k) => k > 0 && Number.isFinite(k))
    .sort((a, b) => a - b)
    .filter((k, i, arr) => i === 0 || Math.abs(k - arr[i - 1]) > 1e-12 * k);
  const exactFor = (k: number): Rat | null => {
    const c = crossings.find((x) => x.K === k);
    if (c) return c.kExact;
    if (originCrossingK && ratToNumber(originCrossingK) === k) return originCrossingK;
    if (degreeDropK && ratToNumber(degreeDropK) === k) return degreeDropK;
    return null;
  };
  const edges = [0, ...critK];
  const stableRanges: RootLocusResult["stableRanges"] = [];
  let stableRangeDoubt = false;
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = i + 1 < edges.length ? edges[i + 1] : null;
    const probe = hi === null ? (lo > 0 ? lo * 2 : 1) : lo === 0 ? hi / 2 : Math.sqrt(lo * hi);
    const kp = roundRat(probe, 6);
    if (!kp || ratSign(kp) <= 0) continue;
    const st = analyzeStability({ num: polyMul([kp], num), den: polyAdd(den, polyMul([kp], num)) }, RW);
    if (!st.ok) {
      stableRangeDoubt = true;
      continue;
    }
    if (st.disagreement || /^UNDETERMINED/.test(st.verdict)) stableRangeDoubt = true;
    if (st.stable) {
      const last = stableRanges[stableRanges.length - 1];
      if (last && last.hi === lo) {
        last.hi = hi;
        last.hiExact = hi === null ? null : exactFor(hi);
      } else
        stableRanges.push({
          lo,
          hi,
          loExact: lo === 0 ? ratInt(0) : exactFor(lo),
          hiExact: hi === null ? null : exactFor(hi),
        });
    }
  }

  // ---- the sweep ----
  const L = den.length;
  const denN = den.map(ratToNumber);
  const numN = new Array(L - num.length).fill(0).concat(num.map(ratToNumber));
  const charAt = (K: number): number[] => denN.map((d, i) => d + K * numN[i]);

  const featurePts: Complex[] = [
    ...poles,
    ...zeros,
    ...(centroid ? [{ re: ratToNumber(centroid), im: 0 }] : []),
    ...breakaways.map((b) => b.s),
    ...crossings.flatMap((c) => [
      { re: 0, im: c.w },
      { re: 0, im: -c.w },
    ]),
  ].filter((z) => Number.isFinite(z.re) && Number.isFinite(z.im));
  const S = Math.max(1e-9, ...featurePts.map(cAbs));
  const viewR = S * 1.6;
  const jS = { re: 0, im: S };
  const Kref = Math.max(1e-300, cAbs(evalNum(denN, jS)) / Math.max(1e-300, cAbs(evalNum(numN, jS))));

  const branches: Complex[][] = poles.map((p) => [p]);
  const gains: number[] = [0];
  let current = poles.slice();
  let K = Kref * 1e-7;
  let ratio = 1.15;
  let solves = 0;
  let steps = 0;
  let sweepCapped = false;
  let finished = false;
  const nearZero = (z: Complex): boolean => zeros.some((zz) => cAbs(cSub(z, zz)) < 2e-3 * S);
  const farOut = (z: Complex): boolean => cAbs(z) > 4 * viewR;
  const Kmax = Kref * 1e9;

  while (!finished) {
    if (steps >= RL_MAX_STEPS || solves >= RL_MAX_SOLVES) {
      sweepCapped = true;
      break;
    }
    const Kn = gains.length === 1 ? K : gains[gains.length - 1] * ratio;
    const roots = polyRootsNumeric(charAt(Kn));
    solves++;
    if (!roots || roots.length !== current.length) {
      // Degree drop (biproper) or a failed solve: stop the sweep rather than mis-pair.
      if (roots && roots.length < current.length && degreeDropK) {
        notes.push("The sweep stops where a closed-loop pole leaves through infinity.");
      }
      break;
    }
    const nn = roots.length;
    const cost = current.map((a) => roots.map((b) => cAbs(cSub(a, b))));
    const assign = hungarian(cost);
    let worst = 0;
    for (let i = 0; i < nn; i++) {
      const d = cAbs(cSub(current[i], roots[assign[i]]));
      const allow = 0.04 * Math.max(S, cAbs(current[i]));
      worst = Math.max(worst, d / allow);
    }
    if (worst > 1 && ratio > 1.0002 && gains.length > 1) {
      ratio = 1 + (ratio - 1) / 2;
      continue;
    }
    if (gains.length === 1 && worst > 1 && K > Kref * 1e-14) {
      K /= 10;
      continue;
    }
    // Accept.
    const next = current.map((_, i) => roots[assign[i]]);
    for (let i = 0; i < nn; i++) branches[i].push(next[i]);
    gains.push(Kn);
    current = next;
    steps++;
    if (worst < 0.3) ratio = Math.min(2, 1 + (ratio - 1) * 1.6);
    const done = current.every((z) => nearZero(z) || farOut(z));
    if (done || Kn > Kmax) finished = true;
  }
  if (sweepCapped) {
    notes.push(
      `The gain sweep reached its step limit (${RL_MAX_STEPS} steps) before every branch had arrived at a ` +
        "zero or left the frame, so the drawn branches stop short. The rules above (asymptotes, crossings, " +
        "breakaways) are computed independently of the sweep and are complete.",
    );
  }

  // Closed-loop poles at the user's gain.
  let atK: RootLocusResult["atK"] = null;
  if (kAt) {
    const cl: TransferFunction = {
      num: polyMul([kAt], num),
      den: polyAdd(den, polyMul([kAt], num)),
    };
    if (polyDegree(cl.den) < 1) {
      notes.push("At this K the closed-loop polynomial has no s left in it, so there are no poles to mark.");
    } else {
      const st = analyzeStability(cl, RW);
      if (st.ok) atK = { K: kAt, poles: st.poles, stability: st };
    }
  }

  return {
    ok: true,
    n,
    m,
    poles,
    zeros,
    complementary,
    centroid,
    asymptoteAnglesDeg,
    realSegments,
    breakaways,
    unresolvedBreakaways,
    repeatedPoleBreaks,
    crossings,
    originCrossingK,
    branches,
    gains,
    sweepCapped,
    stableRanges,
    stableRangeDoubt,
    jwAxisLocus,
    atK,
    notes,
  };
}

function ratNeg1(p: Rat[]): Rat[] {
  return p.map((c) => ratNeg(c));
}

/** A rational as plain text with a true minus: "6", "1/2", "−3/4". */
export function ratPlain(q: Rat): string {
  const t = q.d === 1n ? String(q.n) : `${q.n}/${q.d}`;
  return t.replace(/^-/, "−");
}

// ---------------------------------------------------------------------------
// 2. Nyquist
// ---------------------------------------------------------------------------

export interface NyquistResult {
  ok: true;
  /** Open-loop poles strictly in the right half plane. */
  P: number;
  /** Clockwise encirclements of −1; null when they could not be counted. */
  N: number | null;
  /** Z = N + P; null when N is unknown. */
  Z: number | null;
  /** Right-half-plane closed-loop poles from analyzeStability(feedback(L)). */
  closedRhp: number | null;
  /** True: the two agree. False: they disagree (reported, nothing decided). Null: no comparison. */
  agree: boolean | null;
  /** Open-loop poles on the imaginary axis (omega >= 0) the contour is indented around. */
  axisPoles: Array<{ w: number; mult: number }>;
  /** min |1 + L| along the contour relative to the curve's scale: ~0 means it passes through −1. */
  throughMinusOne: boolean;
  /** L(j omega) for omega > 0, ascending. */
  curve: Array<{ w: number; re: number; im: number }>;
  margins: Margins | null;
  closed: StabilityResult | null;
  open: StabilityResult;
  /** Total contour evaluations (for the record). */
  evaluations: number;
  verdict: string;
  stable: boolean | null;
  notes: string[];
}

const NY_MAX_EVALS = 250000;

export function nyquist(L: TransferFunction): NyquistResult | ControlError {
  const num = trimPoly(L.num);
  const den = trimPoly(L.den);
  const n = polyDegree(den);
  const m = polyDegree(num);
  if (m < 0)
    return {
      ok: false,
      error: "The numerator is zero, so L(s) = 0 and there is nothing to plot.",
    };
  if (n < 1)
    return {
      ok: false,
      error: "The denominator has no s in it, so L(s) is a constant and has no Nyquist plot.",
    };
  if (m > n) {
    return {
      ok: false,
      error:
        "This open loop is IMPROPER (numerator degree above the denominator's): |L(jω)| grows without bound " +
        "as ω → ∞, so the Nyquist contour's large arc does not map to a point and the criterion does not " +
        "apply. Enter a proper L(s).",
    };
  }
  if (n > MAX_ORDER)
    return {
      ok: false,
      error: `Order ${n} is above the limit of ${MAX_ORDER}.`,
    };
  const tf: TransferFunction = { num, den };
  const notes: string[] = [];

  const open = analyzeStability(tf, RW);
  if (!open.ok) return { ok: false, error: open.error };

  // Imaginary-axis poles, EXACTLY: den(j omega) = 0 <=> R(u) = 0 and I(u) = 0.
  const k0 = originMultiplicity(den);
  const axisPoles: Array<{ w: number; mult: number }> = [];
  if (k0 > 0) axisPoles.push({ w: 0, mult: k0 });
  {
    const reduced = den.slice(0, den.length - k0);
    const sp = jwSplit(reduced);
    const g = polyGcdAsc(sp.R, sp.I);
    if (g.length >= 2) {
      for (const r of positiveRootsAsc(g)) {
        const w = Math.sqrt(r.u);
        // Multiplicity: exactly, by repeated division by (s^2 + u) when u is rational;
        // otherwise from the gcd, whose roots are simple in u only if the poles are.
        let mult = 0;
        if (r.exact) {
          let cur = reduced;
          const fac: Rat[] = [ratInt(1), ratInt(0), r.exact];
          for (let k = 0; k < MAX_ORDER; k++) {
            const rem = polyRemainder(cur, fac);
            if (polyDegree(rem) >= 0) break;
            mult++;
            cur = polyDivExact(cur, fac);
          }
        } else {
          mult = open.poles.filter((p) => cAbs(cSub(p, { re: 0, im: w })) < 1e-4 * Math.max(1, w)).length;
        }
        axisPoles.push({ w, mult: Math.max(1, mult) });
      }
    }
  }
  const axisCount = axisPoles.reduce((a, p) => a + (p.w === 0 ? p.mult : 2 * p.mult), 0);
  // P counts the open-loop poles STRICTLY in the right half plane. The axis poles
  // were located exactly above; any computed pole within reach of one of them is that
  // pole (a repeated axis pole is only found to about eps^(1/m)) and is not counted.
  const nearAxisPole = (p: Complex): boolean =>
    axisPoles.some((a) => {
      const scale = Math.max(1e-6 * S0(open), Math.abs(a.w));
      return (
        Math.min(cAbs(cSub(p, { re: 0, im: a.w })), cAbs(cSub(p, { re: 0, im: -a.w }))) < 1e-3 * Math.max(scale, 1e-9)
      );
    });
  const P = open.poles.filter((p) => !nearAxisPole(p) && p.re > Math.max(1e-12, 1e-9 * cAbs(p))).length;
  // Doubt about P: the two methods disagree on L itself, or a repeated pole sits near
  // (not exactly on) the axis — exact axis poles are handled by the indentation.
  const openDoubt =
    open.disagreement ||
    (/^UNDETERMINED/.test(open.verdict) && axisCount === 0) ||
    (open.rhpPolesRouth !== null && axisCount === 0 && open.rhpPolesRouth !== P);

  // Scales for the contour.
  const allRoots = [...open.poles, ...open.zeros].filter((z) => Number.isFinite(z.re) && Number.isFinite(z.im));
  const S = Math.max(1e-6, ...allRoots.map(cAbs));
  const closedDen = polyAdd(den, num);
  const cd = trimPoly(closedDen);
  let cauchy = 1;
  if (polyDegree(cd) >= 1 && !ratIsZero(cd[0])) {
    const lead = Math.abs(ratToNumber(cd[0]));
    for (let i = 1; i < cd.length; i++) cauchy = Math.max(cauchy, 1 + Math.abs(ratToNumber(cd[i])) / lead);
  }
  const R = Math.max(1e4 * S, 4 * cauchy);
  // Indentation radius: well inside the gap to any other pole, zero or closed-loop root.
  const clRoots = polyRoots(closedDen) ?? [];
  const minGap = (c: Complex): number => {
    let gmin = S;
    for (const z of [...open.poles, ...open.zeros, ...clRoots]) {
      const d = cAbs(cSub(z, c));
      // roots within 1e-5 of the centre ARE the axis pole (a repeated one is found only to ~eps^(1/m))
      if (d > 1e-5 * Math.max(1, cAbs(c)) && d < gmin) gmin = d;
    }
    return gmin;
  };
  const eps = Math.max(1e-9 * S, Math.min(...axisPoles.map((p) => 1e-4 * minGap({ re: 0, im: p.w })), 1e-4 * S));

  // THE CLOCKWISE D-CONTOUR, as pieces each with its own parameter u and a list of
  // BASE samples. The base samples matter more than the refinement: refinement can
  // only split an interval whose two ends already disagree in phase, so an
  // encirclement that happens entirely BETWEEN two base samples is invisible to it.
  // (The first version sampled the axis uniformly from −R to R; with R = 10⁴·S every
  // feature of L sat inside one sample gap, N came out 0 for loops that encircle −1
  // twice, and only the closed-loop cross-check caught it.) So the axis is sampled on
  // a log grid in |ω| from far below to far above the dynamics, made dense around
  // every open-loop pole and zero and every closed-loop root frequency.
  interface Piece {
    at: (u: number) => Complex;
    us: number[];
    mid: (a: number, b: number) => number;
  }
  const pieces: Piece[] = [];
  const holes = [...axisPoles.flatMap((p) => (p.w === 0 ? [0] : [-p.w, p.w]))].sort((a, b) => a - b);
  const wLo = Math.min(eps, 1e-6 * S);
  const feats = [...open.poles, ...open.zeros, ...clRoots]
    .flatMap((z) => [cAbs(z), Math.abs(z.im)])
    .filter((w) => Number.isFinite(w) && w > wLo && w < R);
  const Wset: number[] = [];
  const NLOG = 2400;
  for (let i = 0; i <= NLOG; i++) Wset.push(wLo * Math.pow(R / wLo, i / NLOG));
  for (const fw of feats) for (let k = -20; k <= 20; k++) Wset.push(fw * (1 + 0.002 * k));
  const Wpos = Wset.filter((w) => w > 0 && w <= R).sort((a, b) => a - b);
  const Wall = [...Wpos.map((w) => -w).reverse(), 0, ...Wpos];
  const axisMid = (a: number, b: number): number => (a * b > 0 ? Math.sign(a) * Math.sqrt(a * b) : (a + b) / 2);
  const axisPiece = (a: number, b: number): Piece => ({
    at: (w) => ({ re: 0, im: w }),
    us: [a, ...Wall.filter((w) => w > a && w < b), b],
    mid: axisMid,
  });
  const arcPiece = (c: number, r: number, th0: number, th1: number, n: number): Piece => ({
    at: (th) => ({ re: r * Math.cos(th), im: c + r * Math.sin(th) }),
    us: Array.from({ length: n + 1 }, (_, i) => th0 + ((th1 - th0) * i) / n),
    mid: (a, b) => (a + b) / 2,
  });
  let w0 = -R;
  for (const h of holes) {
    pieces.push(axisPiece(w0, h - eps));
    pieces.push(arcPiece(h, eps, -Math.PI / 2, Math.PI / 2, 64));
    w0 = h + eps;
  }
  pieces.push(axisPiece(w0, R));
  pieces.push(arcPiece(0, R, Math.PI / 2, -Math.PI / 2, 256));

  const F = (s: Complex): Complex => {
    const l = tfAt(tf, s);
    return { re: 1 + l.re, im: l.im };
  };
  let evaluations = 0;
  let totalArg = 0;
  let minRel = Infinity;
  let failed = false;
  const argDiff = (a: Complex, b: Complex): number => {
    let d = Math.atan2(b.im, b.re) - Math.atan2(a.im, a.re);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const LIMIT = Math.PI / 8;
  const LOGMAG = Math.log(4);
  for (const piece of pieces) {
    let uPrev = piece.us[0];
    let fPrev = F(piece.at(uPrev));
    evaluations++;
    for (let i = 1; i < piece.us.length && !failed; i++) {
      const uNext = piece.us[i];
      const fNext = F(piece.at(uNext));
      evaluations++;
      // Adaptive refinement between neighbouring base samples: an explicit work
      // stack, depth-capped and inside a global evaluation budget. Left half first,
      // so the phase is accumulated in contour order. An interval is split when the
      // phase OR the magnitude of 1 + L changes sharply across it.
      const work: Array<{
        u0: number;
        f0: Complex;
        u1: number;
        f1: Complex;
        depth: number;
      }> = [{ u0: uPrev, f0: fPrev, u1: uNext, f1: fNext, depth: 0 }];
      while (work.length) {
        const seg = work.pop()!;
        if (
          !Number.isFinite(seg.f1.re) ||
          !Number.isFinite(seg.f1.im) ||
          !Number.isFinite(seg.f0.re) ||
          !Number.isFinite(seg.f0.im)
        ) {
          failed = true;
          break;
        }
        const d = argDiff(seg.f0, seg.f1);
        const m0 = cAbs(seg.f0);
        const m1 = cAbs(seg.f1);
        const magJump = m0 > 0 && m1 > 0 ? Math.abs(Math.log(m1 / m0)) : Infinity;
        const wantSplit = Math.abs(d) > LIMIT || magJump > LOGMAG;
        if (wantSplit && seg.depth < 48 && evaluations < NY_MAX_EVALS) {
          const um = piece.mid(seg.u0, seg.u1);
          if (um !== seg.u0 && um !== seg.u1) {
            const fm = F(piece.at(um));
            evaluations++;
            work.push({
              u0: um,
              f0: fm,
              u1: seg.u1,
              f1: seg.f1,
              depth: seg.depth + 1,
            });
            work.push({
              u0: seg.u0,
              f0: seg.f0,
              u1: um,
              f1: fm,
              depth: seg.depth + 1,
            });
            continue;
          }
        }
        if (Math.abs(d) > LIMIT) {
          failed = true; // could not resolve the phase change: refuse to count
          break;
        }
        totalArg += d;
        const lmag = cAbs({ re: seg.f1.re - 1, im: seg.f1.im });
        minRel = Math.min(minRel, m1 / Math.max(1, lmag));
      }
      uPrev = uNext;
      fPrev = fNext;
    }
    if (failed) break;
  }

  const throughMinusOne = minRel < 1e-7;
  let Nc: number | null = null;
  if (!failed && !throughMinusOne) {
    const turns = -totalArg / (2 * Math.PI);
    const rounded = Math.round(turns);
    if (Math.abs(turns - rounded) < 0.05) Nc = rounded === 0 ? 0 : rounded;
    else failed = true;
  }

  const closedTf = feedback(tf);
  const closedSt = analyzeStability(closedTf, RW);
  const closed = closedSt.ok ? closedSt : null;
  const closedDoubt = !closed || closed.disagreement || /^UNDETERMINED/.test(closed.verdict);
  const closedRhp = closed && !closedDoubt ? closed.rhpPolesNumeric : null;
  const Z = Nc === null ? null : Nc + P;
  let agree: boolean | null = null;
  if (Z !== null && closedRhp !== null && !openDoubt) agree = Z === closedRhp;

  const mg = margins(tf);
  const mgOk = mg.ok ? mg : null;

  // The curve for the figure: omega > 0 on a log grid wide enough for the margins.
  const lo = Math.max(1e-12, S * 1e-4);
  const hi = Math.max(S * 1e3, (mgOk?.gainCrossoverW ?? 0) * 100, (mgOk?.phaseCrossoverW ?? 0) * 100);
  const grid: number[] = [];
  const NG = 1200;
  for (let i = 0; i < NG; i++) grid.push(lo * Math.pow(hi / lo, i / (NG - 1)));
  // keep the grid off the axis poles themselves
  const gridOk = grid.filter((w) => axisPoles.every((p) => Math.abs(w - p.w) > 1e-9 * Math.max(1, p.w)));
  const fr = frequencyResponse(tf, gridOk);
  const curve = fr
    .map((p) => {
      const ph = (p.phaseDeg * Math.PI) / 180;
      return {
        w: p.w,
        re: p.magnitude * Math.cos(ph),
        im: p.magnitude * Math.sin(ph),
      };
    })
    .filter((p) => Number.isFinite(p.re) && Number.isFinite(p.im));

  let verdict: string;
  let stable: boolean | null = null;
  if (openDoubt) {
    verdict =
      "UNDECIDED. The open-loop pole count P could not be settled (the two stability methods disagree on " +
      "L(s) itself, or a repeated pole sits near the imaginary axis), so Z = N + P is not computed into a verdict.";
  } else if (throughMinusOne) {
    verdict =
      "MARGINAL. The Nyquist curve passes THROUGH the −1 point, so the encirclement count is not defined: the " +
      "closed loop has a pole on the imaginary axis at the frequency where L(jω) = −1.";
  } else if (Nc === null) {
    verdict =
      "UNDECIDED. The winding number could not be resolved within the evaluation budget, so N is not " +
      "reported rather than guessed.";
  } else if (closedRhp === null) {
    // THE CROSS-CHECK HAS NO ANSWER, so the Nyquist count is not turned into a verdict
    // on its own: the check is the point, and missing on one side is not agreement.
    verdict =
      `UNCONFIRMED. The Nyquist count gives Z = N + P = ${intText(Nc)} + ${P} = ${Z} closed-loop pole(s) in the right ` +
      "half plane, but solving the closed loop directly could not settle its own count (its two stability methods " +
      "disagree, or a repeated pole sits near the axis), so there is nothing to confirm Z against and no verdict is given.";
  } else if (agree === false) {
    verdict =
      `UNDECIDED. The two methods DISAGREE: the Nyquist count gives Z = N + P = ${intText(Nc)} + ${P} = ${Z} closed-loop ` +
      `poles in the right half plane, while the closed-loop pole analysis gives ${closedRhp}. A disagreement ` +
      "means the loop is too close to the stability boundary for either to be trusted, and neither is picked.";
  } else {
    stable = Z === 0;
    verdict = stable
      ? `STABLE in closed loop: N = ${intText(Nc)}, P = ${P}, so Z = N + P = 0 closed-loop poles in the right half plane.`
      : `UNSTABLE in closed loop: N = ${intText(Nc)}, P = ${P}, so Z = N + P = ${Z} closed-loop pole(s) in the right half plane.`;
    if (closed && closed.imaginaryAxisPoles > 0) {
      stable = false;
      verdict += " The closed loop also has pole(s) on the imaginary axis, so it is at best marginally stable.";
    }
  }
  if (axisPoles.length) {
    notes.push(
      "L(s) has pole(s) on the imaginary axis (" +
        axisPoles
          .map((p) =>
            p.w === 0
              ? `s = 0${p.mult > 1 ? ` ×${p.mult}` : ""}`
              : `s = ±j${fmtShort(p.w)}${p.mult > 1 ? ` ×${p.mult}` : ""}`,
          )
          .join(", ") +
        "). The contour is INDENTED around each one by a small semicircle into the right half plane, so " +
        "those poles count as outside the contour and are not included in P. Each indentation maps to a " +
        "large arc of the Nyquist curve (half a turn per pole) that is not drawn to scale in the figure.",
    );
  }
  if (failed && !throughMinusOne && !openDoubt) {
    notes.push("The contour phase changed too fast to follow within the evaluation budget.");
  }
  return {
    ok: true,
    P,
    N: Nc,
    Z,
    closedRhp,
    agree,
    axisPoles,
    throughMinusOne,
    curve,
    margins: mgOk,
    closed,
    open,
    evaluations,
    verdict,
    stable,
    notes,
  };
}

function S0(st: StabilityResult): number {
  return Math.max(1e-12, ...[...st.poles, ...st.zeros].map(cAbs).filter(Number.isFinite));
}

/** Four significant figures, display-contract clean (U+2212, ×10ⁿ, no trailing zeros). */
export function fmtShort(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  const s = fmtSig(v, sig);
  // drop trailing zeros of the mantissa ("1.500" -> "1.5", "2.000×10⁵" -> "2×10⁵")
  return s.replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
}

/** gcd of two ASCENDING rational polynomials (monic, ascending). */
function polyGcdAsc(a: Rat[], b: Rat[]): Rat[] {
  let x = desc(ratPolyTrim(a));
  let y = desc(ratPolyTrim(b));
  if (polyDegree(x) < 0) return ratPolyTrim(asc(y));
  if (polyDegree(y) < 0) return ratPolyTrim(asc(x));
  for (let guard = 0; guard <= 64; guard++) {
    if (polyDegree(y) < 0) break;
    const r = polyRemainder(x, y);
    x = y;
    y = polyDegree(r) < 0 ? [ratInt(0)] : r;
  }
  const t = trimPoly(x);
  if (polyDegree(t) < 1) return [ratInt(1)];
  const lead = t[0];
  return ratPolyTrim(asc(t.map((c) => ratDiv(c, lead))));
}

/** Exact quotient a / b (highest first), remainder discarded. */
function polyDivExact(a: Rat[], b: Rat[]): Rat[] {
  const bt = trimPoly(b);
  const db = polyDegree(bt);
  let r = trimPoly(a).slice();
  const out: Rat[] = [];
  for (let guard = 0; guard <= MAX_ORDER + 2 && polyDegree(r) >= db; guard++) {
    const c = ratDiv(r[0], bt[0]);
    out.push(c);
    for (let j = 0; j <= db; j++) r[j] = ratSub(r[j], ratMul(c, bt[j]));
    r = r.slice(1);
    if (!r.length) break;
  }
  return out.length ? trimPoly(out) : [ratInt(0)];
}

// ---------------------------------------------------------------------------
// 3. Lead / lag compensator design
// ---------------------------------------------------------------------------

export interface ErrorConstant {
  /** System type: poles at the origin minus zeros at the origin. */
  type: number;
  /** Kp (type 0), Kv (type 1), Ka (type 2) of the loop as given. */
  value: number;
  name: "Kp" | "Kv" | "Ka" | null;
}

export function errorConstant(g: TransferFunction): ErrorConstant {
  const zp = originMultiplicity(g.den);
  const zz = originMultiplicity(g.num);
  const type = zp - zz;
  const numT = trimPoly(g.num);
  const denT = trimPoly(g.den);
  const nLow = ratToNumber(numT[numT.length - 1 - zz]);
  const dLow = ratToNumber(denT[denT.length - 1 - zp]);
  const value = nLow / dLow;
  const name = type === 0 ? "Kp" : type === 1 ? "Kv" : type === 2 ? "Ka" : null;
  return { type, value, name };
}

export interface CompensatorResult {
  ok: true;
  kind: "lead" | "lag";
  /** C(s) exactly as displayed (rounded coefficients) and as verified. */
  C: TransferFunction;
  gain: number;
  /** lead: alpha < 1; lag: beta > 1. */
  ratio: number;
  T: number;
  zero: number;
  pole: number;
  phiMaxDeg: number | null;
  designW: number;
  before: Margins | null;
  after: Margins;
  closedBefore: StabilityResult | null;
  closedAfter: StabilityResult;
  errBefore: ErrorConstant;
  errAfter: ErrorConstant;
  stepBefore: StepSummary | null;
  stepAfter: StepSummary | null;
  iterations: number;
  targetMet: boolean;
  notes: string[];
}

export interface StepSummary {
  t: number[];
  y: number[];
  finalValue: number | null;
  overshootPct: number | null;
  peak: number;
  /** The simulation could not be trusted (diverged or under-resolved): no overshoot is given. */
  withheld: boolean;
}

/** Window for a closed-loop step from its slowest pole, as the step tool chooses it. */
export function stepWindow(st: StabilityResult | null): number {
  if (!st) return 10;
  const rs = st.poles.map((p) => Math.abs(p.re)).filter((v) => v > 1e-9);
  const slowest = rs.length ? Math.min(...rs) : NaN;
  const t = Number.isFinite(slowest) && slowest > 0 ? 6 / slowest : 10;
  return Math.min(Math.max(t, 1e-9), 1e9);
}

function stepSummary(tf: TransferFunction, tEnd: number, st?: StabilityResult): StepSummary | null {
  // Samples: at least 400, and at least 40 per period of the fastest oscillation that can
  // still be seen in the window (the overshoot is read off the samples), capped at 4000.
  let samples = 400;
  if (st) {
    const wMax = Math.max(0, ...st.poles.filter((pl) => -pl.re * tEnd < 50).map((pl) => Math.abs(pl.im)));
    if (wMax > 0) samples = Math.min(4000, Math.max(400, Math.ceil((tEnd * wMax * 40) / (2 * Math.PI))));
  }
  // a smaller step budget than the step tool: this runs two simulations per design
  const r = timeResponse(tf, "step", tEnd, samples, STEP_BUDGET, st);
  if (!r.ok) return null;
  let peak = -Infinity;
  for (const v of r.y) if (v > peak) peak = v;
  const fv = r.finalValue;
  // NEVER A NUMBER FROM A DIVERGED TRACE: a stable system's step cannot exceed its final
  // value by orders of magnitude; if the trace did, the simulation failed and no overshoot
  // is reported (round 4: 7.95×10²⁹⁶ % was printed beside "Target met").
  const diverged =
    r.y.some((v) => !Number.isFinite(v)) ||
    (fv !== null && Math.max(...r.y.map(Math.abs)) > 1e3 * Math.max(1, Math.abs(fv)));
  // An UNDER-RESOLVED trace is still a stable RK4 integration (timeResponse refuses the
  // unstable case), accurate to a fraction of a per cent here, so its overshoot is reported.
  let os = fv !== null && fv !== 0 && peak > fv ? ((peak - fv) / Math.abs(fv)) * 100 : fv !== null ? 0 : null;
  if (diverged) os = null;
  return { t: r.t, y: r.y, finalValue: fv, overshootPct: os, peak, withheld: diverged };
}

/** Dense log grid with the margin sweep's reach, for phase/magnitude searches. */
function designGrid(tf: TransferFunction, extra: number[] = []): number[] {
  const roots = [...(polyRoots(tf.den) ?? []), ...(polyRoots(tf.num) ?? [])];
  const mags = [...roots.map(cAbs), ...extra].filter((v) => v > 1e-12 && Number.isFinite(v));
  const lo = (mags.length ? Math.min(...mags) : 1) / 1e4;
  const hi = (mags.length ? Math.max(...mags) : 1) * 1e4;
  const out: number[] = [];
  const NG = 3000;
  for (let i = 0; i < NG; i++) out.push(lo * Math.pow(hi / lo, i / (NG - 1)));
  return out;
}

function magAt(tf: TransferFunction, w: number): number {
  return cAbs(tfAt(tf, { re: 0, im: w }));
}

/** Bisection (log axis, fixed iterations) for f(w) = 0 in [a, b]. */
function bisectLog(a: number, b: number, f: (w: number) => number): number {
  let lo = a;
  let hi = b;
  let flo = f(lo);
  for (let k = 0; k < 80; k++) {
    const mid = Math.sqrt(lo * hi);
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return Math.sqrt(lo * hi);
}

/** Unwrapped phase (degrees) of tf at w, unwrapped along a log sweep from low frequency. */
function phaseAt(tf: TransferFunction, w: number, grid: number[]): number {
  const pts = grid.filter((x) => x < w);
  pts.push(w);
  const fr = frequencyResponse(tf, pts);
  return fr[fr.length - 1].phaseDeg;
}

export interface CompensatorSpec {
  kind: "lead" | "lag";
  /** Target phase margin, degrees. */
  pm: number;
  /** Lead only: place the new gain crossover here (rad/s). */
  wc: number | null;
  /** Required error constant (Kp/Kv/Ka by system type); null: keep the loop's own gain. */
  errorConst: number | null;
}

const LEAD_MAX_PHI = 65;

/** True when the unity-feedback loop closed around L is stable (exact Routh + poles). */
function stableLoop(L: TransferFunction): boolean {
  // numeric verdict inside the design iterations (bounded cost); the design that is
  // finally reported is re-checked by analyzeStability (exact Routh + poles) once.
  return numericClosedLoopStable(L) === true;
}

export function designCompensator(g: TransferFunction, spec: CompensatorSpec): CompensatorResult | ControlError {
  const num = trimPoly(g.num);
  const den = trimPoly(g.den);
  const plant: TransferFunction = { num, den };
  const n = polyDegree(den);
  const m = polyDegree(num);
  if (m < 0) return { ok: false, error: "The plant numerator is zero." };
  if (n < 1) return { ok: false, error: "The plant denominator has no s in it." };
  if (m > n)
    return {
      ok: false,
      error: "The plant is IMPROPER (numerator degree above the denominator's) and cannot be compensated as entered.",
    };
  if (n > MAX_ORDER)
    return {
      ok: false,
      error: `Order ${n} is above the limit of ${MAX_ORDER}.`,
    };
  if (!Number.isFinite(spec.pm) || spec.pm <= 0 || spec.pm >= 90) {
    return {
      ok: false,
      error: "The target phase margin must be between 0° and 90° (45° to 60° is the usual design range).",
    };
  }
  const notes: string[] = [];
  const err0 = errorConstant(plant);

  // Static gain from the error-constant requirement.
  let K = 1;
  if (spec.errorConst !== null) {
    if (spec.kind === "lead" && spec.wc !== null) {
      notes.push(
        "With a target crossover the lead design fixes the gain itself (|C·G| = 1 at that frequency), so " +
          "the error-constant field is not used; the error constant the design achieves is reported below.",
      );
    } else {
      if (!(spec.errorConst > 0) || !Number.isFinite(spec.errorConst))
        return {
          ok: false,
          error: "The error-constant target must be a positive number.",
        };
      if (err0.type < 0)
        return {
          ok: false,
          error: "The plant has more zeros than poles at the origin, so it has no finite error constant to set.",
        };
      if (err0.type > 2)
        return {
          ok: false,
          error: `This loop is type ${err0.type}; error constants are defined here for types 0, 1 and 2 (Kp, Kv, Ka).`,
        };
      if (!(err0.value > 0) || !Number.isFinite(err0.value))
        return {
          ok: false,
          error:
            "The plant's low-frequency gain is not positive, so a positive error constant cannot be set by a positive gain.",
        };
      K = spec.errorConst / err0.value;
    }
  }

  const before = margins(plant);
  const beforeOk = before.ok ? before : null;
  const grid = designGrid(plant, spec.wc ? [spec.wc] : []);

  const build = (gain: number, Tz: number, Tp: number): TransferFunction | null => {
    // C(s) = gain * (Tz s + 1)/(Tp s + 1), every coefficient rounded to 4 significant figures.
    const a = roundRat(gain * Tz, 4);
    const b = roundRat(gain, 4);
    const c = roundRat(Tp, 4);
    if (!a || !b || !c || ratIsZero(c) || ratIsZero(a)) return null;
    return { num: [a, b], den: [c, ratInt(1)] };
  };

  let C: TransferFunction | null = null;
  let ratio = 1;
  let T = 0;
  let phiMax: number | null = null;
  let designW = NaN;
  let iterations = 0;
  let after: Margins | null = null;
  let gainUsed = K;

  if (spec.kind === "lead") {
    if (spec.wc !== null) {
      const wc = spec.wc;
      if (!(wc > 0) || !Number.isFinite(wc))
        return {
          ok: false,
          error: "The target crossover must be a positive frequency in rad/s.",
        };
      const ph = phaseAt(plant, wc, grid);
      const need = spec.pm - (180 + ph);
      if (need <= 0) {
        return {
          ok: false,
          error:
            `At ω = ${fmtShort(wc)} rad/s the plant already has ${fmtShort(180 + ph)}° of phase margin, more than the ` +
            `${fmtShort(spec.pm)}° target, so no phase lead is needed there: a gain (or a lag network) sets that crossover.`,
        };
      }
      if (need > LEAD_MAX_PHI) {
        return {
          ok: false,
          error:
            `Reaching ${fmtShort(spec.pm)}° at ω = ${fmtShort(wc)} rad/s needs ${fmtShort(need)}° of phase lead. One lead ` +
            `stage gives at most about ${LEAD_MAX_PHI}° usefully (beyond that α becomes tiny and the high-frequency ` +
            "gain enormous). Use two lead stages in series, a lower crossover, or a smaller target.",
        };
      }
      phiMax = need;
      const s = Math.sin((need * Math.PI) / 180);
      ratio = (1 - s) / (1 + s);
      T = 1 / (wc * Math.sqrt(ratio));
      gainUsed = Math.sqrt(ratio) / magAt(plant, wc);
      designW = wc;
      notes.push(
        `Design: the plant has ${fmtShort(180 + ph)}° of phase margin at ω = ${fmtShort(wc)} rad/s, so the lead supplies ` +
          `φmax = ${fmtShort(need)}° there (α = (1 − sin φmax)/(1 + sin φmax), T = 1/(ω√α)), and the gain is set so that ` +
          "|C·G| = 1 at that frequency, making it the new crossover.",
      );
      C = build(gainUsed, T, ratio * T);
      iterations = 1;
      if (!C)
        return {
          ok: false,
          error: "The compensator coefficients are not finite for this plant.",
        };
      const L = series(C, plant);
      const mg = margins(L);
      if (!mg.ok) return { ok: false, error: mg.error };
      after = mg;
    } else {
      const G1: TransferFunction = {
        num: polyMul([toRat(K) ?? ratInt(1)], num),
        den,
      };
      const m1 = margins(G1);
      if (!m1.ok) return { ok: false, error: m1.error };
      if (m1.phaseMarginDeg === null || m1.gainCrossoverW === null) {
        return {
          ok: false,
          error:
            "With this gain the loop magnitude never crosses 0 dB, so there is no crossover to add phase at. " +
            "Raise the gain (error-constant field) or give a target crossover frequency.",
        };
      }
      const pm0 = m1.phaseMarginDeg;
      if (pm0 >= spec.pm && !stableLoop(G1)) {
        return {
          ok: false,
          error:
            `At this gain the phase margin reads ${fmtShort(pm0)}°, yet the closed loop is NOT stable (open-loop ` +
            "right-half-plane poles or several crossovers make the margin an unreliable guide). Classical Bode lead " +
            "design assumes the margin describes stability, so no lead network is offered; check the root locus or " +
            "Nyquist tool for this loop.",
        };
      }
      if (pm0 >= spec.pm) {
        C = { num: [toRat(K) ?? ratInt(1)], den: [ratInt(1)] };
        after = m1;
        notes.push(
          `The loop already has ${fmtShort(pm0)}° of phase margin at this gain, which meets the ${fmtShort(spec.pm)}° ` +
            "target: no lead network is needed, and C(s) is the gain alone.",
        );
      } else {
        let extra = 5;
        let best: {
          C: TransferFunction;
          mg: Margins;
          ratio: number;
          T: number;
          phi: number;
          w: number;
        } | null = null;
        for (iterations = 1; iterations <= 12; iterations++) {
          const phi = spec.pm - pm0 + extra;
          if (phi > LEAD_MAX_PHI || phi <= 0) break;
          const sn = Math.sin((phi * Math.PI) / 180);
          const a = (1 - sn) / (1 + sn);
          const target = Math.sqrt(a);
          // |G1| = sqrt(alpha), the first such frequency above the current crossover.
          let wm = NaN;
          for (let i = 0; i + 1 < grid.length; i++) {
            if (grid[i + 1] < m1.gainCrossoverW) continue;
            const f0 = magAt(G1, grid[i]) - target;
            const f1 = magAt(G1, grid[i + 1]) - target;
            if (f0 >= 0 && f1 < 0) {
              wm = bisectLog(grid[i], grid[i + 1], (w) => magAt(G1, w) - target);
              break;
            }
          }
          if (!Number.isFinite(wm)) break;
          const Tl = 1 / (wm * Math.sqrt(a));
          const Ct = build(K, Tl, a * Tl);
          if (!Ct) break;
          const mg = margins(series(Ct, plant));
          if (!mg.ok || mg.phaseMarginDeg === null) break;
          if (
            stableLoop(series(Ct, plant)) &&
            (!best || Math.abs(mg.phaseMarginDeg - spec.pm) < Math.abs(best.mg.phaseMarginDeg! - spec.pm))
          ) {
            best = { C: Ct, mg, ratio: a, T: Tl, phi, w: wm };
          }
          if (Math.abs(mg.phaseMarginDeg - spec.pm) <= 0.5) break;
          extra += spec.pm - mg.phaseMarginDeg;
        }
        iterations = Math.min(iterations, 12);
        if (!best) {
          const phi = spec.pm - pm0 + 5;
          return {
            ok: false,
            error:
              `The loop has ${fmtShort(pm0)}° of phase margin; reaching ${fmtShort(spec.pm)}° needs about ` +
              `${fmtShort(phi)}° of lead, ${phi > LEAD_MAX_PHI ? `more than one stage gives usefully (about ${LEAD_MAX_PHI}°)` : "and no crossover could be placed for it"}. ` +
              "Use two lead stages, a lower target, or a lower gain.",
          };
        }
        C = best.C;
        after = best.mg;
        ratio = best.ratio;
        T = best.T;
        phiMax = best.phi;
        designW = best.w;
        notes.push(
          `Design: φmax = ${fmtShort(best.phi)}° (the ${fmtShort(spec.pm - pm0)}° shortfall plus an allowance for the ` +
            "crossover moving up, refined by re-checking the margin), placed where |K·G(jω)| = √α so that the lead's " +
            "peak phase sits at the new crossover.",
        );
      }
    }
  } else {
    // LAG
    const G1: TransferFunction = {
      num: polyMul([toRat(K) ?? ratInt(1)], num),
      den,
    };
    let allowance = 5;
    let best: {
      C: TransferFunction;
      mg: Margins;
      beta: number;
      T: number;
      w: number;
    } | null = null;
    const m1 = margins(G1);
    if (m1.ok && m1.phaseMarginDeg !== null && m1.phaseMarginDeg >= spec.pm && stableLoop(G1)) {
      C = { num: [toRat(K) ?? ratInt(1)], den: [ratInt(1)] };
      after = m1;
      notes.push(
        `At this gain the loop already has ${fmtShort(m1.phaseMarginDeg)}° of phase margin, meeting the target: no lag ` +
          "network is needed, and C(s) is the gain alone.",
      );
    } else {
      const fr = frequencyResponse(G1, grid);
      for (iterations = 1; iterations <= 12; iterations++) {
        const want = -180 + spec.pm + allowance;
        let wc = NaN;
        for (let i = 0; i + 1 < fr.length; i++) {
          if (fr[i].phaseDeg >= want && fr[i + 1].phaseDeg < want) {
            const w0 = grid[i];
            const w1 = grid[i + 1];
            const t = (want - fr[i].phaseDeg) / (fr[i + 1].phaseDeg - fr[i].phaseDeg);
            wc = w0 * Math.pow(w1 / w0, t);
            break;
          }
        }
        if (!Number.isFinite(wc)) break;
        const beta = magAt(G1, wc);
        if (!(beta > 1)) break;
        const Tl = 10 / wc;
        const Ct = build(K, Tl, beta * Tl);
        if (!Ct) break;
        const mg = margins(series(Ct, plant));
        if (!mg.ok || mg.phaseMarginDeg === null) break;
        if (
          stableLoop(series(Ct, plant)) &&
          (!best || Math.abs(mg.phaseMarginDeg - spec.pm) < Math.abs(best.mg.phaseMarginDeg! - spec.pm))
        ) {
          best = { C: Ct, mg, beta, T: Tl, w: wc };
        }
        if (Math.abs(mg.phaseMarginDeg - spec.pm) <= 0.5) break;
        allowance += spec.pm - mg.phaseMarginDeg;
        if (allowance < -30 || allowance > 60) break;
      }
      iterations = Math.min(iterations, 12);
      if (!best) {
        return {
          ok: false,
          error:
            `The plant's phase never rises above −180° + ${fmtShort(spec.pm)}° at a frequency where its gain exceeds 1, ` +
            "so a lag network cannot give this phase margin: it only lowers the crossover, and there is nowhere " +
            "lower with enough phase. A lead network (or a lower target) is needed.",
        };
      }
      C = best.C;
      after = best.mg;
      ratio = best.beta;
      T = best.T;
      designW = best.w;
      notes.push(
        `Design: new crossover ω = ${fmtShort(best.w)} rad/s, where the phase of K·G is −180° + target + an allowance ` +
          "for the lag's residual phase there (refined by re-checking the margin); the lag zero sits a decade below it " +
          "(T = 10/ω) and β = |K·G(jω)| there, so the lag removes exactly that much gain at the new crossover.",
      );
    }
  }

  if (!C || !after)
    return {
      ok: false,
      error: "No compensator could be designed for this plant and target.",
    };

  const L = series(C, plant);
  const closedAfterTf = feedback(L);
  const closedAfter = analyzeStability(closedAfterTf, RW);
  if (!closedAfter.ok) return { ok: false, error: closedAfter.error };
  const closedBeforeSt = analyzeStability(feedback(plant), RW);
  const closedBefore = closedBeforeSt.ok ? closedBeforeSt : null;

  // EACH LOOP IS SIMULATED OVER ITS OWN WINDOW, sampled finely enough for its own
  // oscillation (round 4 verification: one window from the slow uncompensated loop sampled
  // the compensated loop's peak too coarsely: 0.0083 % against scipy's 26.1 %).
  const stepAfter = stepSummary(closedAfterTf, stepWindow(closedAfter), closedAfter);
  const stepBefore = closedBefore
    ? stepSummary(feedback(plant), stepWindow(closedBefore), closedBefore)
    : stepSummary(feedback(plant), stepWindow(null));

  const zero = ratToNumber(C.num.length === 2 ? ratNeg(ratDiv(C.num[1], C.num[0])) : ratInt(0));
  const pole = ratToNumber(C.den.length === 2 ? ratNeg(ratDiv(C.den[1], C.den[0])) : ratInt(0));
  const noNetwork = C.den.length === 1;
  // STABILITY FIRST. A phase margin is read off the open loop and, with right-half-plane
  // poles or several crossings, does not by itself mean the closed loop is stable; the
  // target is never reported met for a closed loop that is not stable.
  const targetMet =
    closedAfter.stable &&
    after.phaseMarginDeg !== null &&
    (Math.abs(after.phaseMarginDeg - spec.pm) <= 1 || (noNetwork && after.phaseMarginDeg >= spec.pm));
  if (!closedAfter.stable) {
    notes.push(
      "The closed loop with this C(s) is NOT STABLE (see the verdict), so the target is NOT met whatever the " +
        "phase-margin figure says: a margin read off the open loop does not describe an unstable closed loop.",
    );
  } else if (!targetMet && after.phaseMarginDeg !== null) {
    notes.push(
      `The achieved phase margin is ${fmtShort(after.phaseMarginDeg)}°, not the ${fmtShort(spec.pm)}° asked for. ` +
        "That is the verified figure for the C(s) printed above, reported as it is rather than as the target.",
    );
  }
  return {
    ok: true,
    kind: spec.kind,
    C,
    gain: ratToNumber(C.num[C.num.length - 1]) / ratToNumber(C.den[C.den.length - 1]),
    ratio,
    T,
    zero,
    pole,
    phiMaxDeg: phiMax,
    designW,
    before: beforeOk,
    after,
    closedBefore,
    closedAfter,
    errBefore: err0,
    errAfter: errorConstant(L),
    stepBefore,
    stepAfter,
    iterations,
    targetMet,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 4. Discrete time
// ---------------------------------------------------------------------------

export type C2dMethod = "zoh" | "tustin" | "matched";

export interface DiscreteTf {
  /** Coefficients in z, highest power first; den monic. */
  num: number[];
  den: number[];
  /** The same exactly, when the method is exact over the rationals (Tustin with rational T). */
  numExact: Rat[] | null;
  denExact: Rat[] | null;
}

export interface C2dResult {
  ok: true;
  method: C2dMethod;
  T: number;
  prewarp: number | null;
  gd: DiscreteTf;
  poles: Complex[];
  zeros: Complex[];
  maxPoleMag: number;
  /** Exact Schur-Cohn (Jury) verdict on the coefficients: true = all |z| < 1. Null when too large to run exactly. */
  juryStable: boolean | null;
  numericStable: boolean;
  /** Poles within 1e-9 of the unit circle. */
  onCircle: number;
  outside: number;
  disagreement: boolean;
  verdict: string;
  notes: string[];
}

// expm lives in control.ts (timeResponse steps stiff plants exactly with it); re-exported here.
export { expm };

/** Characteristic polynomial det(zI - A), highest first, by the Samuelson-Berkowitz recursion. */
export function charPoly(A: number[][]): number[] {
  const n = A.length;
  if (n === 0) return [1];
  // O(n^4): bounded, because a frozen pane is worse than a refusal.
  if (n > MAX_ORDER + 2 || A.some((r) => !Array.isArray(r) || r.length !== n))
    throw new Error("charPoly: matrix too large or not square");
  let vect: number[] = [1, -A[0][0]];
  for (let r = 1; r < n; r++) {
    // M = A[0..r-1][0..r-1], R = A[r][0..r-1], Cc = A[0..r-1][r], a = A[r][r]
    const Rrow = A[r].slice(0, r);
    const Ccol = A.slice(0, r).map((row) => row[r]);
    const t: number[] = [1, -A[r][r]];
    let x = Ccol.slice();
    for (let k = 0; k < r; k++) {
      // -R * M^k * C
      let s = 0;
      for (let i = 0; i < r; i++) s += Rrow[i] * x[i];
      t.push(-s);
      const nx = new Array(r).fill(0);
      for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) nx[i] += A[i][j] * x[j];
      x = nx;
    }
    // new = Toeplitz(t) (r+2 x r+1) * vect
    const out = new Array(r + 2).fill(0);
    for (let i = 0; i < r + 2; i++) {
      for (let j = 0; j <= Math.min(i, r); j++) out[i] += t[i - j] * vect[j];
    }
    vect = out;
  }
  return vect;
}

/**
 * Exact Schur-Cohn recursion (the Jury criterion in reduction form) over Q.
 * All roots strictly inside the unit circle iff, at every stage, |a0| < |an| for the
 * current polynomial, which then reduces to (an*p(z) - a0*p*(z))/z. Returns null when
 * the rationals grow past a size an interactive pane should carry.
 */
export function schurCohnStable(p: Rat[]): boolean | null {
  let a = trimPoly(p);
  for (let guard = 0; guard <= MAX_ORDER + 1; guard++) {
    const deg = a.length - 1;
    if (deg <= 0) return true;
    const an = a[0];
    const a0 = a[deg];
    const absCmp = (x: Rat, y: Rat): number => {
      const ax = ratSign(x) < 0 ? ratNeg(x) : x;
      const ay = ratSign(y) < 0 ? ratNeg(y) : y;
      return ratSign(ratSub(ax, ay));
    };
    if (absCmp(a0, an) >= 0) return false;
    // q = an*p(z) - a0*p*(z), whose z^0 term vanishes; divide by z.
    const rev = a.slice().reverse();
    const qv: Rat[] = a.map((c, i) => ratSub(ratMul(an, c), ratMul(a0, rev[i])));
    // highest first: last entry is the constant term, zero by construction
    let next = qv.slice(0, deg);
    // normalise by the leading coefficient to keep sizes down
    const lead = next[0];
    if (ratIsZero(lead)) return false;
    next = next.map((c) => ratDiv(c, lead));
    if (next.some((c) => c.n.toString(2).length > 6000 || c.d.toString(2).length > 6000)) return null;
    a = next;
  }
  return null;
}

/** Discretises G(s) with sample time T. */
export function c2d(
  g: TransferFunction,
  T: number,
  method: C2dMethod,
  prewarp: number | null = null,
): C2dResult | ControlError {
  const num = trimPoly(g.num);
  const den = trimPoly(g.den);
  const n = polyDegree(den);
  const m = polyDegree(num);
  if (m < 0) return { ok: false, error: "The numerator is zero." };
  if (n < 1)
    return {
      ok: false,
      error: "The denominator has no s in it, so there are no dynamics to discretise.",
    };
  if (m > n)
    return {
      ok: false,
      error: "This transfer function is IMPROPER and has no discrete equivalent by these methods.",
    };
  if (n > MAX_ORDER)
    return {
      ok: false,
      error: `Order ${n} is above the limit of ${MAX_ORDER}.`,
    };
  if (!(T > 0) || !Number.isFinite(T)) return { ok: false, error: "The sample time T must be a positive number." };
  const notes: string[] = [];
  const a0 = ratToNumber(den[0]);
  const denN = den.map((c) => ratToNumber(c) / a0);
  const numN = num.map((c) => ratToNumber(c) / a0);
  if ([...denN, ...numN].some((v) => !Number.isFinite(v)))
    return {
      ok: false,
      error: "These coefficients overflow double precision.",
    };
  const contPoles = polyRoots(den) ?? [];
  const contZeros = m > 0 ? (polyRoots(num) ?? []) : [];

  const fastest = Math.max(0, ...contPoles.map((p) => Math.abs(p.im)));
  const fastestMag = Math.max(0, ...contPoles.map(cAbs).filter(Number.isFinite));
  if (fastestMag > 0 && fastestMag * T < 1e-6) {
    return {
      ok: false,
      error:
        `T = ${fmtShort(T)} s is less than a millionth of the fastest time constant (1/|p| = ${fmtShort(1 / fastestMag)} s). At that ` +
        "ratio every discrete pole crowds within 10⁻⁶ of z = 1 and the z-domain coefficients cancel in double precision, " +
        "so no trustworthy Gd(z) can be written. Lengthen T (ten to a hundred samples per time constant is usual).",
    };
  }
  if (fastest * T >= Math.PI) {
    notes.push(
      `A pole oscillates at ${fmtShort(fastest)} rad/s, at or above the Nyquist frequency π/T = ${fmtShort(Math.PI / T)} rad/s ` +
        "for this sample time. The sampled system ALIASES that mode onto a lower frequency; shorten T.",
    );
  }

  let gd: DiscreteTf;
  let tustinConst: number | null = null;
  if (method === "zoh") {
    // Controllable canonical realisation, the same one timeResponse integrates.
    const a = denN.slice(1);
    const bFull = new Array(n + 1).fill(0);
    for (let i = 0; i < numN.length; i++) bFull[n - (numN.length - 1 - i)] = numN[i];
    const d = bFull[0];
    const b = bFull.slice(1).map((v, i) => v - d * a[i]);
    const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n - 1; i++) A[i][i + 1] = 1;
    for (let i = 0; i < n; i++) A[n - 1][i] = -a[n - 1 - i];
    const Cr = Array.from({ length: n }, (_, i) => b[n - 1 - i]);
    const M: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] = A[i][j] * T;
    M[n - 1][n] = T; // B = e_n
    const E = expm(M);
    if (!E)
      return {
        ok: false,
        error: "The matrix exponential overflowed: the sample time is too long for this system's fastest mode.",
      };
    const Phi = E.slice(0, n).map((r) => r.slice(0, n));
    const Gam = E.slice(0, n).map((r) => r[n]);
    const pA = charPoly(Phi);
    const PhiMinus = Phi.map((r, i) => r.map((v, j) => v - Gam[i] * Cr[j]));
    const pB = charPoly(PhiMinus);
    const numZ = pB.map((v, i) => v + (d - 1) * pA[i]);
    // clean the round-off zero in front (strictly proper plants have numZ[0] = d = 0)
    if (Math.abs(numZ[0]) <= 1e-13 * Math.max(...numZ.map(Math.abs))) numZ[0] = 0;
    // ZOH PRESERVES THE DC GAIN exactly: Gd(1) = G(0) whenever s = 0 is not a pole.
    // A mismatch means the numerator was lost to cancellation (pB and pA agree to
    // nearly every digit when T is short) and the coefficients cannot be trusted.
    if (originMultiplicity(den) === 0) {
      const g0 = ratToNumber(num[num.length - 1]) / ratToNumber(den[den.length - 1]);
      const dc = numZ.reduce((s2, v) => s2 + v, 0) / pA.reduce((s2, v) => s2 + v, 0);
      if (Number.isFinite(g0) && g0 !== 0 && !(Math.abs(dc - g0) <= 1e-6 * Math.abs(g0))) {
        return {
          ok: false,
          error:
            `The ZOH coefficients lost precision at T = ${fmtShort(T)} s: the discrete DC gain came out ${fmtShort(dc)} where it ` +
            `must equal G(0) = ${fmtShort(g0)}. The sample time is too short (or too long) against this plant's dynamics for ` +
            "double precision; change T, or use Tustin, which is exact over the rationals.",
        };
      }
    }
    gd = { num: numZ, den: pA, numExact: null, denExact: null };
  } else if (method === "tustin") {
    let c: Rat | null;
    if (prewarp !== null) {
      if (!(prewarp > 0) || !Number.isFinite(prewarp))
        return {
          ok: false,
          error: "The prewarp frequency must be a positive number in rad/s.",
        };
      if (prewarp * T >= Math.PI) {
        return {
          ok: false,
          error: `The prewarp frequency must be below the Nyquist frequency π/T = ${fmtShort(Math.PI / T)} rad/s for this sample time.`,
        };
      }
      c = toRat(prewarp / Math.tan((prewarp * T) / 2));
    } else {
      const Tq = toRat(T);
      c = Tq ? ratDiv(ratInt(2), Tq) : null;
    }
    if (!c)
      return {
        ok: false,
        error: "The Tustin constant is not finite for this sample time.",
      };
    tustinConst = ratToNumber(c);
    // s = c (z-1)/(z+1): multiply through by (z+1)^n.
    const zm1: Rat[] = [ratInt(1), ratInt(-1)];
    const zp1: Rat[] = [ratInt(1), ratInt(1)];
    const powP = (p: Rat[], k: number): Rat[] => {
      let out: Rat[] = [ratInt(1)];
      for (let i = 0; i < k; i++) out = polyMul(out, p);
      return out;
    };
    const subst = (p: Rat[]): Rat[] => {
      const deg = p.length - 1;
      let acc: Rat[] = [ratInt(0)];
      let ck: Rat = ratInt(1);
      const cpow: Rat[] = [];
      for (let k = 0; k <= n; k++) {
        cpow.push(ck);
        ck = ratMul(ck, c as Rat);
      }
      for (let i = 0; i <= deg; i++) {
        const k = deg - i; // power of s
        if (ratIsZero(p[i])) continue;
        const term = polyMul([ratMul(p[i], cpow[k])], polyMul(powP(zm1, k), powP(zp1, n - k)));
        acc = polyAdd(acc, term);
      }
      return acc;
    };
    let nz = subst(num);
    let dz = subst(den);
    // align lengths (degree n both)
    while (nz.length < n + 1) nz = [ratInt(0), ...nz];
    while (dz.length < n + 1) dz = [ratInt(0), ...dz];
    const lead = dz[0];
    if (ratIsZero(lead))
      return {
        ok: false,
        error: "The Tustin map sends a pole to infinity here (a pole at s = −2/T); change T.",
      };
    nz = nz.map((x) => ratDiv(x, lead));
    dz = dz.map((x) => ratDiv(x, lead));
    gd = {
      num: nz.map(ratToNumber),
      den: dz.map(ratToNumber),
      numExact: prewarp === null ? nz : null,
      denExact: prewarp === null ? dz : null,
    };
    if (prewarp !== null) {
      notes.push(
        `Prewarped at ω = ${fmtShort(prewarp)} rad/s: s = (ω/tan(ωT/2))·(z − 1)/(z + 1), so the discrete response matches ` +
          "the continuous one exactly at that frequency (plain Tustin warps it).",
      );
    }
  } else {
    // Matched pole-zero.
    const zd = originMultiplicity(den);
    const zn = originMultiplicity(num);
    // Roots at the origin are taken EXACTLY (from the trailing zero coefficients), so
    // they map to z = 1 exactly rather than to 1 + round-off.
    const denRed = den.slice(0, den.length - zd);
    const numRed = num.slice(0, num.length - zn);
    const pRed = polyDegree(denRed) >= 1 ? (polyRoots(denRed) ?? []) : [];
    const zRed = polyDegree(numRed) >= 1 ? (polyRoots(numRed) ?? []) : [];
    const one: Complex = { re: 1, im: 0 };
    const zPoles = [...pRed.map((p) => cExp({ re: p.re * T, im: p.im * T })), ...new Array(zd).fill(one)];
    const zZeros = [...zRed.map((p) => cExp({ re: p.re * T, im: p.im * T })), ...new Array(zn).fill(one)];
    for (let i = 0; i < n - m; i++) zZeros.push({ re: -1, im: 0 });
    const dzp = polyFromRoots(zPoles);
    const nzp = polyFromRoots(zZeros);
    // Gain: lim s->0 s^r G(s) = lim z->1 ((z-1)/T)^r Gd(z), r = zd - zn.
    const r = zd - zn;
    const numT = trimPoly(num);
    const denT = trimPoly(den);
    const nLow = ratToNumber(numT[numT.length - 1 - zn]) / a0;
    const dLow = ratToNumber(denT[denT.length - 1 - zd]) / a0;
    const reducedAt1 = (p: number[], k: number): number => {
      // p(z)/(z-1)^k at z = 1 by synthetic division
      let q = p.slice();
      for (let i = 0; i < k; i++) {
        const out: number[] = [];
        let acc = 0;
        for (let j = 0; j < q.length - 1; j++) {
          acc = acc + q[j];
          out.push(acc);
        }
        q = out;
      }
      return q.reduce((s, v) => s + v, 0);
    };
    const D1 = reducedAt1(dzp, zd);
    const N1 = reducedAt1(nzp, zn);
    if (!Number.isFinite(D1) || !Number.isFinite(N1) || Math.abs(N1) < 1e-300 || Math.abs(D1) < 1e-300) {
      return {
        ok: false,
        error:
          "The matched gain cannot be set: a mapped zero or pole lands on z = 1 other than from s = 0 (T aliases it).",
      };
    }
    const k = (nLow / dLow) * Math.pow(T, r) * (D1 / N1);
    const numZ = new Array(dzp.length - nzp.length).fill(0).concat(nzp.map((v) => v * k));
    gd = { num: numZ, den: dzp, numExact: null, denExact: null };
    notes.push(
      "Matched pole-zero: each pole and finite zero maps as z = exp(sT); the " +
        (n - m > 0 ? `${n - m} zero(s) at infinity are placed at z = −1; ` : "") +
        (r === 0
          ? "the gain is matched at DC (z = 1 ↔ s = 0)."
          : "the gain is matched at low frequency, with (z − 1)/T standing in for s at the origin."),
    );
    if (fastest * T >= Math.PI) notes.push("Matched mapping is ambiguous for aliased poles.");
  }

  // Clean exact zeros in the leading numerator coefficients produced by round-off.
  const scaleN = Math.max(1e-300, ...gd.num.map(Math.abs));
  gd.num = gd.num.map((v) => (Math.abs(v) <= 1e-14 * scaleN ? 0 : v));

  // DISCRETE POLES FROM THE CONTINUOUS ONES, through the method's own map, rather than
  // by solving the z-polynomial. With T short against the dynamics every pole crowds
  // towards z = 1, where a root finder on the rounded coefficients loses about half its
  // digits (two poles at 1 − 10⁻⁹ come back 10⁻⁸ apart and possibly outside). The maps
  // are exact: ZOH and matched send p to e^(pT), Tustin to (c + p)/(c − p), and all
  // three send the left half plane into the unit disc, so |z| < 1 exactly when Re p < 0.
  const tustinC = method === "tustin" ? tustinConst : null;
  const mapPole = (p: Complex): Complex =>
    tustinC !== null
      ? cDiv({ re: tustinC + p.re, im: p.im }, { re: tustinC - p.re, im: -p.im })
      : cExp({ re: p.re * T, im: p.im * T });
  const mapped = contPoles.length === n && contPoles.every((p) => Number.isFinite(p.re) && Number.isFinite(p.im));
  const poles = mapped ? contPoles.map(mapPole) : (polyRootsNumeric(gd.den) ?? []);
  const zeros = polyRootsNumeric(gd.num) ?? [];
  const mags = poles.map(cAbs);
  const maxPoleMag = mags.length ? Math.max(...mags) : 0;
  let onCircle: number;
  let outside: number;
  if (mapped) {
    // The same per-pole yardstick analyzeStability uses for the imaginary axis.
    const ptol = (p: Complex): number => Math.max(1e-12, 1e-9 * cAbs(p));
    onCircle = contPoles.filter((p) => Math.abs(p.re) <= ptol(p)).length;
    outside = contPoles.filter((p) => p.re > ptol(p)).length;
  } else {
    onCircle = mags.filter((v) => Math.abs(v - 1) <= 1e-9).length;
    outside = mags.filter((v) => v > 1 + 1e-9).length;
  }
  const numericStable = onCircle === 0 && outside === 0;

  let juryStable: boolean | null = null;
  const dRat = gd.denExact ?? gd.den.map((v) => toRat(v));
  if (dRat.every((x): x is Rat => x !== null)) juryStable = schurCohnStable(dRat as Rat[]);
  const disagreement = juryStable !== null && juryStable !== numericStable && onCircle === 0;

  let verdict: string;
  if (disagreement) {
    verdict =
      `UNCERTAIN. The exact Jury (Schur–Cohn) test says the poles are ${juryStable ? "all inside" : "NOT all inside"} the unit ` +
      `circle; the computed poles say ${numericStable ? "all inside" : `${outside} outside`}. A pole this close to |z| = 1 ` +
      "cannot be placed reliably, so treat the discrete system as marginal rather than as either answer.";
  } else if (outside > 0) {
    verdict = `UNSTABLE: ${outside} discrete pole(s) outside the unit circle (|z| > 1).`;
  } else if (onCircle > 0) {
    verdict = `MARGINALLY STABLE: ${onCircle} discrete pole(s) on the unit circle (|z| = 1) and none outside it.`;
  } else {
    verdict = "STABLE: every discrete pole is strictly inside the unit circle (|z| < 1).";
  }
  return {
    ok: true,
    method,
    T,
    prewarp: method === "tustin" ? prewarp : null,
    gd,
    poles,
    zeros,
    maxPoleMag,
    juryStable,
    numericStable,
    onCircle,
    outside,
    disagreement,
    verdict,
    notes,
  };
}

/** Discrete step response by the difference equation; y[k] for k = 0..samples-1. */
export function discreteStep(gd: DiscreteTf, samples: number): number[] {
  const nS = Math.max(1, Math.min(Math.floor(samples) || 1, 4000));
  const n = gd.den.length - 1;
  if (n < 0 || n > MAX_ORDER || gd.num.length > gd.den.length) return [];
  const b = new Array(n + 1 - gd.num.length).fill(0).concat(gd.num);
  const a = gd.den;
  const y: number[] = [];
  for (let k = 0; k < nS; k++) {
    let acc = 0;
    for (let i = 0; i <= n; i++) if (k - i >= 0) acc += b[i];
    for (let i = 1; i <= n; i++) if (k - i >= 0) acc -= a[i] * y[k - i];
    acc /= a[0];
    if (!Number.isFinite(acc)) break;
    y.push(acc);
  }
  return y;
}

/** The roots of a discrete polynomial, exposed for tests. */
function discretePoles(gd: DiscreteTf): Complex[] {
  return polyRootsNumeric(gd.den) ?? [];
}
