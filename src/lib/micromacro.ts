/**
 * Release F2 items #14 (Micro II) and #15 (Macro II): the pure engines behind micromacroStatCalcs.ts. No DOM, no
 * Office. Exact rationals (cas.ts Rat) wherever the closed form is rational (Marshallian demands of Cobb–Douglas,
 * perfect complements and substitutes; price discrimination; uniform-value auctions; Mundell–Fleming; multipliers);
 * doubles where it is not (CES, Hicksian demands of Cobb–Douglas, logs in growth accounting), and the caller says so.
 */
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratSign, ratIsZero, ratToNumber, ratInt, ratEq, RAT_ZERO, RAT_ONE, ratPolyRoots } from "./cas";

export const rcmp = (x: Rat, y: Rat): number => ratSign(ratSub(x, y));
const rmax = (x: Rat, y: Rat): Rat => (rcmp(x, y) >= 0 ? x : y);
const rmin = (x: Rat, y: Rat): Rat => (rcmp(x, y) <= 0 ? x : y);
const R = (n: number): Rat => ratInt(n);
const HALF: Rat = { n: 1n, d: 2n };

/** r to a whole power n ≥ 0 by repeated squaring (exact). */
export function ratPow(r: Rat, n: number): Rat {
  let out = RAT_ONE;
  let base = r;
  let k = n;
  while (k > 0) {
    if (k & 1) out = ratMul(out, base);
    base = ratMul(base, base);
    k >>= 1;
  }
  return out;
}

// =================================================================================================================
// Consumer choice

export type UtilityKind = "cd" | "ces" | "leontief" | "linear";
export interface Utility {
  kind: UtilityKind;
  a: number;
  b: number;
  /** CES exponent ρ (ρ < 1, ρ ≠ 0); σ = 1/(1 − ρ). */
  rho?: number;
}
/** A demanded bundle, or the whole budget line (perfect substitutes at the tie price ratio). */
export type Bundle = { x: number; y: number; tie?: false } | { tie: true };

export function utilityValue(u: Utility, x: number, y: number): number {
  switch (u.kind) {
    case "cd":
      return x <= 0 || y <= 0 ? 0 : Math.exp(u.a * Math.log(x) + u.b * Math.log(y));
    case "ces": {
      const r = u.rho!;
      if (r < 0 && (x <= 0 || y <= 0)) return 0;
      return Math.pow(u.a * Math.pow(x, r) + u.b * Math.pow(y, r), 1 / r);
    }
    case "leontief":
      return Math.min(u.a * x, u.b * y);
    case "linear":
      return u.a * x + u.b * y;
  }
}

/** The degree of homogeneity k of U: U(tx, ty) = tᵏ U(x, y). */
export const homDegree = (u: Utility): number => (u.kind === "cd" ? u.a + u.b : 1);

/** Marshallian (uncompensated) demand x(p, m). */
export function marshall(u: Utility, px: number, py: number, m: number): Bundle {
  switch (u.kind) {
    case "cd": {
      const s = u.a + u.b;
      return { x: ((u.a / s) * m) / px, y: ((u.b / s) * m) / py };
    }
    case "ces": {
      const sigma = 1 / (1 - u.rho!);
      // ln k = σ ln(a·py / (b·px)): x/y = k at the tangency.
      const lk = sigma * (Math.log(u.a) + Math.log(py) - Math.log(u.b) - Math.log(px));
      if (lk > 0) {
        const ik = Math.exp(-lk);
        const x = m / (px + py * ik);
        return { x, y: x * ik };
      }
      const k = Math.exp(lk);
      const y = m / (px * k + py);
      return { x: y * k, y };
    }
    case "leontief": {
      const t = m / (px / u.a + py / u.b);
      return { x: t / u.a, y: t / u.b };
    }
    case "linear": {
      const d = u.a * py - u.b * px;
      if (d > 0) return { x: m / px, y: 0 };
      if (d < 0) return { x: 0, y: m / py };
      return { tie: true };
    }
  }
}

/** Indirect utility v(p, m) (defined at a tie too). */
export function indirect(u: Utility, px: number, py: number, m: number): number {
  if (u.kind === "linear") return m * Math.max(u.a / px, u.b / py);
  const d = marshall(u, px, py, m);
  if (d.tie) throw new Error("unreachable");
  return utilityValue(u, d.x, d.y);
}

/** Expenditure e(p, ū) = (ū / v(p, 1))^(1/k) for U homogeneous of degree k. */
export function expenditure(u: Utility, px: number, py: number, util: number): number {
  const k = homDegree(u);
  if (u.kind === "cd") {
    const s = u.a + u.b;
    const lv1 = u.a * Math.log(u.a / (s * px)) + u.b * Math.log(u.b / (s * py));
    return Math.exp((Math.log(util) - lv1) / k);
  }
  return util / indirect(u, px, py, 1);
}

/** Hicksian (compensated) demand h(p, ū) = x(p, e(p, ū)). */
export function hicks(u: Utility, px: number, py: number, util: number): Bundle {
  return marshall(u, px, py, expenditure(u, px, py, util));
}

export interface ChoiceResult {
  /** Old optimum (prices px0, py, income m). */
  A: Bundle;
  /** Hicks-compensated bundle h(px1, py, u0): same utility as A at the new prices. */
  B: Bundle;
  /** New optimum (px1, py, m). */
  C: Bundle;
  /** Slutsky-compensated bundle x(px1, py, m′), m′ = m + (px1 − px0)·xA (the old bundle just affordable). */
  S: Bundle | null;
  mSlutsky: number | null;
  u0: number;
  u1: number;
  /** Compensating variation e(p1, u0) − m and equivalent variation m − e(p0, u1). */
  cv: number;
  ev: number;
  /** e(p1, u0): the income that keeps the consumer on u0 at the new prices. */
  eHicks: number;
}

export function consumerChoice(u: Utility, px0: number, px1: number, py: number, m: number): ChoiceResult {
  const A = marshall(u, px0, py, m);
  const C = marshall(u, px1, py, m);
  const u0 = indirect(u, px0, py, m);
  const u1 = indirect(u, px1, py, m);
  const eHicks = expenditure(u, px1, py, u0);
  const B = marshall(u, px1, py, eHicks);
  let S: Bundle | null = null;
  let mS: number | null = null;
  if (!A.tie) {
    mS = m + (px1 - px0) * A.x;
    S = marshall(u, px1, py, mS);
  }
  return { A, B, C, S, mSlutsky: mS, u0, u1, cv: eHicks - m, ev: m - expenditure(u, px0, py, u1), eHicks };
}

/** Exact Marshallian demand for the rational cases (Cobb–Douglas, complements, substitutes) with rational inputs. */
export function marshallRat(kind: Exclude<UtilityKind, "ces">, a: Rat, b: Rat, px: Rat, py: Rat, m: Rat): { x: Rat; y: Rat } | null {
  switch (kind) {
    case "cd": {
      const s = ratAdd(a, b);
      return { x: ratDiv(ratMul(ratDiv(a, s), m), px), y: ratDiv(ratMul(ratDiv(b, s), m), py) };
    }
    case "leontief": {
      const t = ratDiv(m, ratAdd(ratDiv(px, a), ratDiv(py, b)));
      return { x: ratDiv(t, a), y: ratDiv(t, b) };
    }
    case "linear": {
      const d = ratSign(ratSub(ratMul(a, py), ratMul(b, px)));
      if (d > 0) return { x: ratDiv(m, px), y: RAT_ZERO };
      if (d < 0) return { x: RAT_ZERO, y: ratDiv(m, py) };
      return null;
    }
  }
}

/** Exact expenditure for complements and substitutes: e = ū·(px/a + py/b) and ū / max(a/px, b/py). */
export function expenditureRat(kind: "leontief" | "linear", a: Rat, b: Rat, px: Rat, py: Rat, util: Rat): Rat {
  if (kind === "leontief") return ratMul(util, ratAdd(ratDiv(px, a), ratDiv(py, b)));
  return ratDiv(util, rmax(ratDiv(a, px), ratDiv(b, py)));
}
export function indirectRat(kind: "leontief" | "linear", a: Rat, b: Rat, px: Rat, py: Rat, m: Rat): Rat {
  if (kind === "leontief") return ratDiv(m, ratAdd(ratDiv(px, a), ratDiv(py, b)));
  return ratMul(m, rmax(ratDiv(a, px), ratDiv(b, py)));
}

// =================================================================================================================
// Cost curves from a polynomial total cost TC(q) = c₀ + c₁q + … + cₙqⁿ

export const COST_MAX_DEGREE = 6;

export const polyN = (c: number[], q: number): number => {
  let s = 0;
  for (let k = c.length - 1; k >= 0; k--) s = s * q + c[k];
  return s;
};
const derivR = (c: Rat[]): Rat[] => c.slice(1).map((v, i) => ratMul(v, R(i + 1)));

/**
 * The positive real roots of a polynomial (coefficients lowest first) up to `hi`: exact rational roots by the
 * rational-root theorem, the rest by a sign-change scan (8,000 even and 8,000 geometric steps) and bisection. A root of even multiplicity
 * that is irrational (it touches zero without crossing) can be missed: the callers only need the crossings.
 */
export function positiveRoots(coeffs: Rat[], hi: number): { exact: Rat[]; approx: number[] } {
  const exact: Rat[] = [];
  const approx: number[] = [];
  let c = coeffs.slice();
  while (c.length && ratIsZero(c[c.length - 1])) c.pop();
  if (c.length < 2) return { exact, approx };
  const rr = ratPolyRoots(c);
  for (const r of rr.roots) if (ratSign(r.root) > 0 && ratToNumber(r.root) <= hi * (1 + 1e-12)) exact.push(r.root);
  // The remaining factor (no rational roots, unless the candidate search was capped): scanned numerically.
  const rest = rr.incomplete ? c : rr.rest;
  const rn = rest.map(ratToNumber);
  if (rn.length >= 2) {
    // The scan grid: 8,000 even steps on (0, hi] merged with 8,000 geometric steps over fifteen decades below hi, so a
    // root near zero is separated from a far one even when hi is huge (a Cauchy bound for a high price).
    const N = 8000;
    const grid: number[] = [];
    for (let i = 1; i <= N; i++) grid.push((hi * i) / N);
    for (let i = 0; i < N; i++) grid.push(hi * Math.pow(10, -15 + (15 * i) / N));
    grid.sort((u, v) => u - v);
    let x0 = 0;
    let f0 = polyN(rn, 0);
    for (const x1 of grid) {
      if (!(x1 > x0)) continue;
      const f1 = polyN(rn, x1);
      if (f1 === 0) approx.push(x1);
      else if (f0 !== 0 && Math.sign(f0) !== Math.sign(f1)) {
        let lo = x0;
        let up = x1;
        for (let k = 0; k < 200; k++) {
          const mid = (lo + up) / 2;
          if (!(mid > lo && mid < up)) break;
          const fm = polyN(rn, mid);
          if (fm === 0) {
            lo = up = mid;
            break;
          }
          if (Math.sign(fm) === Math.sign(f0)) lo = mid;
          else up = mid;
        }
        if (up > 0) approx.push((lo + up) / 2);
      }
      x0 = x1;
      f0 = f1;
    }
  }
  // An approximate root that equals an exact one (an incomplete search) is dropped.
  const ex = exact.map(ratToNumber);
  const ap = approx.filter((x) => !ex.some((e) => Math.abs(e - x) <= 1e-9 * Math.max(1, e)));
  return { exact, approx: ap };
}

/** One point on a cost curve: exact when the abscissa is rational. */
export interface CostPoint {
  q: number;
  qExact: Rat | null;
  value: number;
  valueExact: Rat | null;
  /** True when the minimum is the limit as q → 0⁺ (AVC with no interior minimum). */
  atZero?: boolean;
}

export interface CostAnalysis {
  c: Rat[];
  cn: number[];
  degree: number;
  /** Minimum of AVC over q > 0: the shutdown point. */
  shutdown: CostPoint;
  /** Minimum of AC (q > 0) when there is a fixed cost: the break-even point; null when AC has no minimum (degree 1). */
  breakEven: CostPoint | null;
  /** Upper end of the search / plot range. */
  qHi: number;
}

const evalR = (c: Rat[], q: Rat): Rat => {
  let s = RAT_ZERO;
  for (let k = c.length - 1; k >= 0; k--) s = ratAdd(ratMul(s, q), c[k]);
  return s;
};

/**
 * Shutdown and break-even points of TC(q) = Σ cₖqᵏ (c₀ the fixed cost, cₙ > 0). AVC(q) = Σₖ≥₁ cₖqᵏ⁻¹ has its minimum
 * where q·VC′ − VC = Σₖ≥₂ (k − 1)cₖqᵏ = 0, i.e. at a positive root of Σₖ≥₂ (k − 1)cₖqᵏ⁻² (else as q → 0⁺, AVC → c₁);
 * AC has its minimum where q·TC′ − TC = Σₖ≥₂ (k − 1)cₖqᵏ − c₀ = 0.
 */
export function costAnalysis(c: Rat[], qHiUser: number | null): CostAnalysis | { error: string } {
  const n = c.length - 1;
  const cn = c.map(ratToNumber);
  // The search range: the Cauchy bound of the break-even polynomial, at least 1.
  const lead = Math.abs(cn[n]);
  let bound = 1;
  for (let k = 0; k < n; k++) bound = Math.max(bound, 1 + Math.abs(cn[k]) / lead);
  const searchHi = Math.max(bound * 2, 10);
  // shutdown: min AVC
  let shutdown: CostPoint = { q: 0, qExact: RAT_ZERO, value: cn[1] ?? 0, valueExact: c[1] ?? RAT_ZERO, atZero: true };
  if (n >= 2) {
    const g = c.slice(2).map((v, i) => ratMul(v, R(i + 1))); // Σ (k−1)cₖ q^(k−2)
    const roots = positiveRoots(g, searchHi);
    const avcR = (q: Rat): Rat => evalR(c.slice(1), q);
    const avcN = (q: number): number => polyN(cn.slice(1), q);
    for (const r of roots.exact) {
      const v = avcR(r);
      if (rcmp(v, shutdown.valueExact ?? R(0)) < 0) shutdown = { q: ratToNumber(r), qExact: r, value: ratToNumber(v), valueExact: v };
    }
    for (const r of roots.approx) {
      const v = avcN(r);
      if (v < shutdown.value - 1e-12 * Math.max(1, Math.abs(v))) shutdown = { q: r, qExact: null, value: v, valueExact: null };
    }
  }
  // break-even: min AC
  let breakEven: CostPoint | null = null;
  if (ratIsZero(c[0])) {
    breakEven = { ...shutdown };
  } else if (n >= 2) {
    const h: Rat[] = c.map((v, k) => (k === 0 ? ratNeg(v) : ratMul(v, R(k - 1))));
    const roots = positiveRoots(h, searchHi);
    const acN = (q: number): number => polyN(cn, q) / q;
    let best: CostPoint | null = null;
    for (const r of roots.exact) {
      const v = ratDiv(evalR(c, r), r);
      if (!best || ratToNumber(v) < best.value) best = { q: ratToNumber(r), qExact: r, value: ratToNumber(v), valueExact: v };
    }
    for (const r of roots.approx) {
      const v = acN(r);
      if (!best || v < best.value - 1e-12 * Math.max(1, Math.abs(v))) best = { q: r, qExact: null, value: v, valueExact: null };
    }
    breakEven = best;
  }
  const marks = [shutdown.q, breakEven?.q ?? 0].filter((x) => x > 0);
  const qHi = qHiUser ?? Math.max(...marks.map((x) => x * 1.8), 1);
  return { c, cn, degree: n, shutdown, breakEven, qHi };
}

/** MC(q) = TC′(q) as doubles. */
export const mcN = (cn: number[], q: number): number => {
  let s = 0;
  for (let k = cn.length - 1; k >= 1; k--) s = s * q + k * cn[k];
  return s;
};

/** The smallest MC over [0, hi] (sampled at 2,001 points plus the interior critical points of MC). */
export function minMc(c: Rat[], hi: number): { q: number; v: number } {
  const cn = c.map(ratToNumber);
  let best = { q: 0, v: mcN(cn, 0) };
  for (let i = 1; i <= 2000; i++) {
    const q = (hi * i) / 2000;
    const v = mcN(cn, q);
    if (v < best.v) best = { q, v };
  }
  const mcP = derivR(c);
  if (mcP.length >= 2) {
    const crit = positiveRoots(derivR(mcP), hi);
    for (const r of [...crit.exact.map(ratToNumber), ...crit.approx]) {
      const v = mcN(cn, r);
      if (r <= hi && v < best.v) best = { q: r, v };
    }
  }
  return best;
}

/** The price-taking firm's output at price P: the largest q with MC(q) = P on the rising branch, when P ≥ min AVC. */
export function supplyAt(an: CostAnalysis, P: Rat): { q: number; qExact: Rat | null; profit: number; profitExact: Rat | null; shut: boolean } {
  const fc = an.c[0];
  if (rcmp(P, an.shutdown.valueExact ?? P) < 0 || (!an.shutdown.valueExact && ratToNumber(P) < an.shutdown.value)) {
    return { q: 0, qExact: RAT_ZERO, profit: -ratToNumber(fc), profitExact: ratNeg(fc), shut: true };
  }
  const mc = derivR(an.c);
  const eq = mc.map((v, i) => (i === 0 ? ratSub(v, P) : v));
  // The Cauchy bound 1 + max|aᵢ/aₙ| holds every root of MC(q) − P, however high the price.
  const en = eq.map(ratToNumber);
  let cauchy = 1;
  for (let k = 0; k < en.length - 1; k++) cauchy = Math.max(cauchy, 1 + Math.abs(en[k] / en[en.length - 1]));
  const roots = positiveRoots(eq, Math.max(an.qHi * 4, 10, cauchy));
  const all = [...roots.exact.map((r) => ({ q: ratToNumber(r), e: r as Rat | null })), ...roots.approx.map((q) => ({ q, e: null as Rat | null }))];
  if (!all.length) return { q: 0, qExact: RAT_ZERO, profit: -ratToNumber(fc), profitExact: ratNeg(fc), shut: true };
  all.sort((u, v) => v.q - u.q);
  const top = all[0];
  if (top.e) {
    const pr = ratSub(ratMul(P, top.e), evalR(an.c, top.e));
    return { q: top.q, qExact: top.e, profit: ratToNumber(pr), profitExact: pr, shut: false };
  }
  const pr = ratToNumber(P) * top.q - polyN(an.cn, top.q);
  return { q: top.q, qExact: null, profit: pr, profitExact: null, shut: false };
}

// =================================================================================================================
// Price discrimination: two markets with linear inverse demands Pᵢ = aᵢ − bᵢQᵢ and a constant marginal cost c

export interface PdMarket {
  a: Rat;
  b: Rat;
}
export interface PdScheme {
  /** Price in each market (null: the market is not served; first degree: each buyer pays their value). */
  p: (Rat | null)[];
  q: Rat[];
  profit: Rat;
  cs: Rat;
  ts: Rat;
  dwl: Rat;
}
export interface PdResult {
  uniform: PdScheme;
  third: PdScheme;
  first: PdScheme;
  tsMax: Rat;
  /** Uniform price serves both markets (both on the lower segment of the kinked demand). */
  uniformServesBoth: boolean;
  /** The two segment maxima of the uniform profit tie. */
  uniformTie: boolean;
  /** The uniform price and each segment's candidate, for the text. */
  uniformPrice: Rat;
}

export function priceDiscrimination(mk: [PdMarket, PdMarket], c: Rat): PdResult | { error: string } {
  if (mk.every((m) => rcmp(m.a, c) <= 0)) return { error: "Neither market can be served profitably: both demand intercepts a₁ and a₂ are at or below the marginal cost c." };
  const csOf = (m: PdMarket, q: Rat): Rat => ratMul(ratMul(HALF, m.b), ratMul(q, q));
  const tsMax = mk.reduce((s, m) => (rcmp(m.a, c) > 0 ? ratAdd(s, ratDiv(ratMul(ratSub(m.a, c), ratSub(m.a, c)), ratMul(R(2), m.b))) : s), RAT_ZERO);
  const finish = (p: (Rat | null)[], q: Rat[], profit: Rat, cs: Rat): PdScheme => {
    const ts = ratAdd(profit, cs);
    return { p, q, profit, cs, ts, dwl: ratSub(tsMax, ts) };
  };
  // third degree
  const q3 = mk.map((m) => (rcmp(m.a, c) > 0 ? ratDiv(ratSub(m.a, c), ratMul(R(2), m.b)) : RAT_ZERO));
  const p3 = mk.map((m, i) => (ratSign(q3[i]) > 0 ? ratSub(m.a, ratMul(m.b, q3[i])) : null));
  const pr3 = mk.reduce((s, m, i) => (p3[i] ? ratAdd(s, ratMul(ratSub(p3[i]!, c), q3[i])) : s), RAT_ZERO);
  const cs3 = mk.reduce((s, m, i) => ratAdd(s, csOf(m, q3[i])), RAT_ZERO);
  const third = finish(p3, q3, pr3, cs3);
  // first degree
  const q1 = mk.map((m) => (rcmp(m.a, c) > 0 ? ratDiv(ratSub(m.a, c), m.b) : RAT_ZERO));
  const pr1 = mk.reduce((s, m, i) => ratAdd(s, ratMul(ratMul(HALF, rmax(ratSub(m.a, c), RAT_ZERO)), q1[i])), RAT_ZERO);
  const first = finish([null, null], q1, pr1, RAT_ZERO);
  // uniform: the kinked aggregate demand; the profit maximum on each segment, clamped, then the better one
  const hiIdx = rcmp(mk[0].a, mk[1].a) >= 0 ? 0 : 1;
  const H = mk[hiIdx];
  const L = mk[1 - hiIdx];
  const qAt = (P: Rat): Rat[] => mk.map((m) => (rcmp(P, m.a) < 0 ? ratDiv(ratSub(m.a, P), m.b) : RAT_ZERO));
  const profitAt = (P: Rat): Rat => qAt(P).reduce((s, q) => ratAdd(s, ratMul(ratSub(P, c), q)), RAT_ZERO);
  const seg1Lo = rmax(L.a, c);
  const p1 = rmin(rmax(ratDiv(ratAdd(H.a, c), R(2)), seg1Lo), H.a);
  let best = p1;
  let both = false;
  let tie = false;
  if (rcmp(L.a, c) > 0) {
    const A = ratAdd(ratDiv(H.a, H.b), ratDiv(L.a, L.b));
    const B = ratAdd(ratDiv(RAT_ONE, H.b), ratDiv(RAT_ONE, L.b));
    const p2 = rmin(rmax(ratDiv(ratAdd(A, ratMul(B, c)), ratMul(R(2), B)), c), L.a);
    const d = rcmp(profitAt(p2), profitAt(p1));
    if (d >= 0) {
      tie = d === 0 && !ratEq(p1, p2);
      best = p2;
      both = rcmp(p2, L.a) < 0;
    }
  }
  const qu = qAt(best);
  const pu = mk.map((m, i) => (ratSign(qu[i]) > 0 ? best : null));
  const csu = mk.reduce((s, m, i) => ratAdd(s, csOf(m, qu[i])), RAT_ZERO);
  const uniform = finish(pu, qu, profitAt(best), csu);
  return { uniform, third, first, tsMax, uniformServesBoth: both, uniformTie: tie, uniformPrice: best };
}

// =================================================================================================================
// Auctions: n bidders with values i.i.d. uniform on [lo, hi], a reserve price r, risk-neutral symmetric equilibrium

export const AUCTION_MAX_N = 200;

export interface AuctionResult {
  /** The reserve on the unit scale, s = (r − lo)/(hi − lo) (0 when r ≤ lo). */
  s: Rat;
  /** The binding reserve in value units (lo when there is none). */
  r: Rat;
  pSale: Rat;
  /** Expected revenue, first-price and second-price, each from its own formula. */
  revFirst: Rat;
  revSecond: Rat;
  /** E[highest value] and E[second-highest value] (no reserve). */
  eMax: Rat;
  eSecond: Rat;
  /** Each bidder's expected surplus (ex ante). */
  bidderSurplus: Rat;
}

/**
 * Unit-scale formulas (values u = (v − lo)/(hi − lo) ~ U[0, 1], reserve s):
 *  first price  E = ∫ₛ¹ b(u)·n uⁿ⁻¹ du,  b(u) = u − (uⁿ − sⁿ)/(n uⁿ⁻¹)  →  (n − 1)(1 − sⁿ⁺¹)/(n + 1) + sⁿ(1 − s);
 *  second price E = s·P(exactly one u ≥ s) + E[u₍₂₎; u₍₂₎ ≥ s]       →  s·n(1 − s)sⁿ⁻¹ + (n − 1)(1 − sⁿ) − n(n − 1)(1 − sⁿ⁺¹)/(n + 1).
 * In value units every payment is lo + (hi − lo)·(unit payment), paid only on a sale (probability 1 − sⁿ).
 */
export function auction(n: number, lo: Rat, hi: Rat, reserve: Rat): AuctionResult {
  const span = ratSub(hi, lo);
  const s = rcmp(reserve, lo) <= 0 ? RAT_ZERO : ratDiv(ratSub(reserve, lo), span);
  const N = R(n);
  const sn = ratPow(s, n);
  const sn1 = ratMul(sn, s);
  const snm1 = n >= 1 ? ratPow(s, n - 1) : RAT_ONE;
  const pSale = ratSub(RAT_ONE, sn);
  const unitFirst = ratAdd(ratDiv(ratMul(R(n - 1), ratSub(RAT_ONE, sn1)), R(n + 1)), ratMul(sn, ratSub(RAT_ONE, s)));
  const unitSecond = ratAdd(
    ratAdd(ratMul(ratMul(s, N), ratMul(ratSub(RAT_ONE, s), snm1)), ratMul(R(n - 1), ratSub(RAT_ONE, sn))),
    ratNeg(ratDiv(ratMul(ratMul(N, R(n - 1)), ratSub(RAT_ONE, sn1)), R(n + 1))),
  );
  const toValue = (unit: Rat): Rat => ratAdd(ratMul(lo, pSale), ratMul(span, unit));
  const revFirst = toValue(unitFirst);
  const revSecond = toValue(unitSecond);
  const eMax = ratAdd(lo, ratMul(span, ratDiv(N, R(n + 1))));
  const eSecond = ratAdd(lo, ratMul(span, ratDiv(R(n - 1), R(n + 1))));
  // Each bidder's surplus: E[(value − payment); win] = (E[highest value; sale] − revenue)/n.
  const eMaxSale = ratAdd(ratMul(lo, pSale), ratMul(span, ratDiv(ratMul(N, ratSub(RAT_ONE, sn1)), R(n + 1))));
  const bidderSurplus = ratDiv(ratSub(eMaxSale, revFirst), N);
  return { s, r: rcmp(reserve, lo) <= 0 ? lo : reserve, pSale, revFirst, revSecond, eMax, eSecond, bidderSurplus };
}

/** The symmetric first-price equilibrium bid at value v (v ≥ r); b(v) = v below the reserve is not a bid. */
export function firstPriceBid(n: number, lo: Rat, hi: Rat, s: Rat, v: Rat): Rat {
  const span = ratSub(hi, lo);
  const u = ratDiv(ratSub(v, lo), span);
  if (ratIsZero(u)) return lo;
  const un1 = ratPow(u, n - 1);
  const bu = ratSub(u, ratDiv(ratSub(ratMul(un1, u), ratPow(s, n)), ratMul(R(n), un1)));
  return ratAdd(lo, ratMul(span, bu));
}

/** Myerson's optimal reserve for uniform values and seller value v₀: r* = (hi + v₀)/2, at least lo. */
export function optimalReserve(lo: Rat, hi: Rat, v0: Rat): Rat {
  return rmax(lo, ratDiv(ratAdd(hi, v0), R(2)));
}

// =================================================================================================================
// Mundell–Fleming (small open economy, linear)

export interface MfParams {
  C0: Rat;
  c: Rat;
  T: Rat;
  I0: Rat;
  b: Rat;
  G: Rat;
  NX0: Rat;
  n: Rat;
  m: Rat;
  M: Rat;
  P: Rat;
  k: Rat;
  h: Rat;
  rw: Rat;
  /** Capital-flow sensitivity (imperfect mobility); null = perfect mobility (BP flat at r*). */
  f: Rat | null;
  /** The pegged exchange rate (fixed regime). */
  e0: Rat;
}
export type MfRegime = "floating" | "fixed";
export interface MfSolution {
  Y: Rat;
  r: Rat;
  e: Rat;
  M: Rat;
  NX: Rat;
  /** Net capital inflow f·(r − r*) (imperfect mobility; with perfect mobility it is whatever finances NX). */
  CF: Rat;
}

/** Solves a 3×3 rational system by Gaussian elimination; null when singular. */
export function solve3(A: Rat[][], rhs: Rat[]): Rat[] | null {
  const M = A.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = -1;
    for (let r = col; r < 3; r++) if (!ratIsZero(M[r][col])) { piv = r; break; }
    if (piv < 0) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col || ratIsZero(M[r][col])) continue;
      const f = ratDiv(M[r][col], M[col][col]);
      for (let k = col; k < 4; k++) M[r][k] = ratSub(M[r][k], ratMul(f, M[col][k]));
    }
  }
  return [0, 1, 2].map((i) => ratDiv(M[i][3], M[i][i]));
}

/**
 * IS:  (1 − c + m)Y + b·r − n·e = C₀ − cT + I₀ + G + NX₀
 * LM:  kY − h·r = M/P
 * BP:  r = r* (perfect mobility), or NX₀ + n·e − mY + f·(r − r*) = 0 (imperfect)
 * Floating: unknowns Y, r, e (M given). Fixed: unknowns Y, r, M (e pegged at e₀).
 */
export function mfSolve(p: MfParams, regime: MfRegime): MfSolution | null {
  const one = RAT_ONE;
  const isY = ratAdd(ratSub(one, p.c), p.m);
  const auto = ratAdd(ratAdd(ratAdd(ratSub(p.C0, ratMul(p.c, p.T)), p.I0), p.G), p.NX0);
  const A: Rat[][] = [];
  const rhs: Rat[] = [];
  if (regime === "floating") {
    A.push([isY, p.b, ratNeg(p.n)]);
    rhs.push(auto);
    A.push([p.k, ratNeg(p.h), RAT_ZERO]);
    rhs.push(ratDiv(p.M, p.P));
    if (p.f === null) {
      A.push([RAT_ZERO, one, RAT_ZERO]);
      rhs.push(p.rw);
    } else {
      A.push([ratNeg(p.m), p.f, p.n]);
      rhs.push(ratSub(ratMul(p.f, p.rw), p.NX0));
    }
  } else {
    A.push([isY, p.b, RAT_ZERO]);
    rhs.push(ratAdd(auto, ratMul(p.n, p.e0)));
    A.push([p.k, ratNeg(p.h), ratNeg(ratDiv(one, p.P))]);
    rhs.push(RAT_ZERO);
    if (p.f === null) {
      A.push([RAT_ZERO, one, RAT_ZERO]);
      rhs.push(p.rw);
    } else {
      A.push([ratNeg(p.m), p.f, RAT_ZERO]);
      rhs.push(ratSub(ratSub(ratMul(p.f, p.rw), p.NX0), ratMul(p.n, p.e0)));
    }
  }
  const x = solve3(A, rhs);
  if (!x) return null;
  const [Y, r, X] = x;
  const e = regime === "floating" ? X : p.e0;
  const M = regime === "fixed" ? X : p.M;
  const NX = ratSub(ratAdd(p.NX0, ratMul(p.n, e)), ratMul(p.m, Y));
  const CF = p.f === null ? ratNeg(NX) : ratMul(p.f, ratSub(r, p.rw));
  return { Y, r, e, M, NX, CF };
}

// =================================================================================================================
// Growth accounting

export type GrowthKind = "log" | "simple";
export interface GrowthRow {
  gY: number;
  gK: number;
  gL: number;
  capital: number;
  labour: number;
  tfp: number;
}

/** Per-period growth (log differences or simple rates) and the Solow decomposition gY = α·gK + (1 − α)·gL + gA. */
export function growthAccounting(Y: ArrayLike<number>, K: ArrayLike<number>, L: ArrayLike<number>, alpha: number, kind: GrowthKind): GrowthRow[] {
  const g = (x: ArrayLike<number>, t: number): number => (kind === "log" ? Math.log(x[t] / x[t - 1]) : x[t] / x[t - 1] - 1);
  const out: GrowthRow[] = [];
  for (let t = 1; t < Y.length; t++) {
    const gY = g(Y, t);
    const gK = g(K, t);
    const gL = g(L, t);
    const capital = alpha * gK;
    const labour = (1 - alpha) * gL;
    out.push({ gY, gK, gL, capital, labour, tfp: gY - capital - labour });
  }
  return out;
}

/** TFP level A = Y / (K^α L^(1−α)), indexed to 100 in the first period. */
export function tfpIndex(Y: ArrayLike<number>, K: ArrayLike<number>, L: ArrayLike<number>, alpha: number): number[] {
  const la = (t: number): number => Math.log(Y[t]) - alpha * Math.log(K[t]) - (1 - alpha) * Math.log(L[t]);
  const l0 = la(0);
  return Array.from({ length: Y.length }, (_, t) => 100 * Math.exp(la(t) - l0));
}
