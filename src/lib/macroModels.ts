/**
 * Small textbook macro models (Release E5c): the Solow growth model in discrete time (macro-solow), linear IS–LM with
 * an AD–AS closure (macro-islm), and the Taylor (1993) rule (macro-taylor). Pure functions; gameMacroCalcs.ts reads the
 * fields and formats the results.
 *
 * SOLOW, per effective worker, DISCRETE time (the map the simulation runs):
 *   k₍ₜ₊₁₎ = (s·kₜ^α + (1 − δ)kₜ) / ((1 + n)(1 + g)),   y = k^α,  c = (1 − s)y.
 * Its steady state solves s·k^α = D·k with D = (1 + n)(1 + g) − (1 − δ) = n + g + ng + δ (NOT n + g + δ, which is the
 * continuous-time break-even rate), so k* = (s/D)^(1/(1 − α)). Golden rule: max c = k^α − Dk gives s = α and
 * k_gold = (α/D)^(1/(1 − α)). Local convergence: φ′(k*) = (αD + 1 − δ)/((1 + n)(1 + g)), the gap kₜ − k* shrinks by
 * φ′ a period near k*, λ = −ln φ′ and half-life ln 2/λ periods. The continuous-time (1 − α)(n + g + δ) is offered
 * labelled as an approximation.
 *
 * IS–LM, linear, interest rate r in percentage points:
 *   IS: Y = C₀ + c(Y − T) + I₀ − b·r + G      LM: M/P = kY − h·r
 * With A = C₀ − cT + I₀ + G and D = h(1 − c) + b·k: Y* = (hA + bM/P)/D, r* = (kA − (1 − c)M/P)/D. Exact rationals.
 *
 * TAYLOR (1993): i = rⁿ + π + a_π(π − π*) + a_y·(output gap), Taylor's a_π = a_y = 0.5 and rⁿ = π* = 2.
 */
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratSign, ratIsZero, RAT_ONE } from "./cas";

// ---------------------------------------------------------------------------------------------------------------
// Solow

export interface SolowParams {
  alpha: number;
  s: number;
  n: number;
  g: number;
  delta: number;
}

export interface SolowSteady {
  /** (1 + n)(1 + g). */
  G: number;
  /** (1 + n)(1 + g) − (1 − δ) = n + g + ng + δ, the discrete break-even rate. */
  D: number;
  kStar: number;
  yStar: number;
  cStar: number;
  sGold: number;
  kGold: number;
  yGold: number;
  cGold: number;
  /** φ′(k*), the slope of the map at the steady state. */
  phi: number;
  /** −ln φ′ per period. */
  lambda: number;
  halfLife: number;
  /** (1 − α)(n + g + δ), the continuous-time approximation. */
  lambdaC: number;
  halfLifeC: number;
}

export const SOLOW_T_MAX = 100_000;

export function solowSteady(p: SolowParams): SolowSteady | { error: string } {
  const { alpha, s, n, g, delta } = p;
  if (!(alpha > 0 && alpha < 1)) return { error: "The capital share α must be strictly between 0 and 1." };
  if (!(s > 0 && s < 1)) return { error: "The saving rate s must be strictly between 0 and 1 (with s = 0 capital decays to zero; with s = 1 nothing is consumed)." };
  if (!(delta >= 0 && delta <= 1)) return { error: "The depreciation rate δ must be between 0 and 1 (a share of the capital stock per period)." };
  if (!(n > -1)) return { error: "Population growth n must be greater than −1 (−100% a period)." };
  if (!(g > -1)) return { error: "Technology growth g must be greater than −1 (−100% a period)." };
  const G = (1 + n) * (1 + g);
  const D = G - (1 - delta);
  if (!(D > 0)) {
    return { error: `There is no positive steady state: (1 + n)(1 + g) − (1 − δ) = n + g + ng + δ is ${D === 0 ? "zero" : "negative"}, so capital per effective worker grows without bound.` };
  }
  const e = 1 / (1 - alpha);
  const kStar = Math.pow(s / D, e);
  const kGold = Math.pow(alpha / D, e);
  if (!Number.isFinite(kStar) || !Number.isFinite(kGold) || kStar <= 0 || kGold <= 0 || kStar > 1e15 || kGold > 1e15 || kStar < 1e-15 || kGold < 1e-15) {
    return { error: "The steady state k* (s/(n + g + ng + δ) raised to the power 1/(1 − α)) or the golden-rule k is outside 10⁻¹⁵ to 10¹⁵ for these parameters; it cannot be shown reliably." };
  }
  const yStar = Math.pow(kStar, alpha);
  const yGold = Math.pow(kGold, alpha);
  const phi = (alpha * D + (1 - delta)) / G;
  const lambda = -Math.log(phi);
  const lambdaC = (1 - alpha) * (n + g + delta);
  return {
    G,
    D,
    kStar,
    yStar,
    cStar: (1 - s) * yStar,
    sGold: alpha,
    kGold,
    yGold,
    cGold: (1 - alpha) * yGold,
    phi,
    lambda,
    halfLife: Math.LN2 / lambda,
    lambdaC,
    halfLifeC: lambdaC > 0 ? Math.LN2 / lambdaC : NaN,
  };
}

/** k₀ … k_T of the discrete map. */
export function solowPath(p: SolowParams, k0: number, T: number): Float64Array {
  const G = (1 + p.n) * (1 + p.g);
  const k = new Float64Array(T + 1);
  k[0] = k0;
  for (let t = 0; t < T; t++) k[t + 1] = (p.s * Math.pow(k[t], p.alpha) + (1 - p.delta) * k[t]) / G;
  return k;
}

/** The first period at which |kₜ − k*| is at most half of |k₀ − k*| (null if the path never gets there). */
export function measuredHalfLife(k: ArrayLike<number>, kStar: number): number | null {
  const g0 = Math.abs(k[0] - kStar);
  if (!(g0 > 0)) return null;
  for (let t = 1; t < k.length; t++) if (Math.abs(k[t] - kStar) <= g0 / 2) return t;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// IS–LM

export interface IslmParams {
  C0: Rat;
  c: Rat;
  T: Rat;
  I0: Rat;
  b: Rat;
  G: Rat;
  M: Rat;
  P: Rat;
  k: Rat;
  h: Rat;
}

export interface IslmSolution {
  /** Autonomous spending A = C₀ − cT + I₀ + G. */
  A: Rat;
  /** D = h(1 − c) + b·k. */
  D: Rat;
  Y: Rat;
  r: Rat;
  C: Rat;
  I: Rat;
  /** Real balances M/P. */
  m: Rat;
}

export function islmCheck(p: IslmParams): string | null {
  if (ratSign(p.c) < 0 || ratSign(ratSub(p.c, RAT_ONE)) >= 0) return "The marginal propensity to consume c must be at least 0 and below 1 (the Keynesian multiplier 1/(1 − c) needs c < 1).";
  if (ratSign(p.b) < 0) return "The interest sensitivity of investment b cannot be negative.";
  if (ratSign(p.h) < 0) return "The interest sensitivity of money demand h cannot be negative.";
  if (ratSign(p.k) <= 0) return "The income sensitivity of money demand k must be greater than zero.";
  if (ratSign(p.P) <= 0) return "The price level P must be greater than zero.";
  if (ratSign(p.M) < 0) return "The money supply M cannot be negative.";
  const D = ratAdd(ratMul(p.h, ratSub(RAT_ONE, p.c)), ratMul(p.b, p.k));
  if (ratIsZero(D)) return "With h = 0 and b = 0 the IS and LM curves are both vertical: h(1 − c) + b·k = 0, so there is no unique equilibrium.";
  return null;
}

export function islmSolve(p: IslmParams): IslmSolution {
  const one_c = ratSub(RAT_ONE, p.c);
  const A = ratAdd(ratAdd(ratSub(p.C0, ratMul(p.c, p.T)), p.I0), p.G);
  const D = ratAdd(ratMul(p.h, one_c), ratMul(p.b, p.k));
  const m = ratDiv(p.M, p.P);
  const Y = ratDiv(ratAdd(ratMul(p.h, A), ratMul(p.b, m)), D);
  const r = ratDiv(ratSub(ratMul(p.k, A), ratMul(one_c, m)), D);
  return { A, D, Y, r, m, C: ratAdd(p.C0, ratMul(p.c, ratSub(Y, p.T))), I: ratSub(p.I0, ratMul(p.b, r)) };
}

export interface IslmMultipliers {
  /** With crowding out (IS–LM): ∂Y/∂G, ∂Y/∂T, ∂Y/∂M and the same for r. */
  dYdG: Rat;
  dYdT: Rat;
  dYdM: Rat;
  drdG: Rat;
  drdT: Rat;
  drdM: Rat;
  /** Without crowding out (r held fixed): 1/(1 − c) and −c/(1 − c). */
  kG: Rat;
  kT: Rat;
}

export function islmMultipliers(p: IslmParams): IslmMultipliers {
  const one_c = ratSub(RAT_ONE, p.c);
  const D = ratAdd(ratMul(p.h, one_c), ratMul(p.b, p.k));
  return {
    dYdG: ratDiv(p.h, D),
    dYdT: ratNeg(ratDiv(ratMul(p.c, p.h), D)),
    dYdM: ratDiv(p.b, ratMul(p.P, D)),
    drdG: ratDiv(p.k, D),
    drdT: ratNeg(ratDiv(ratMul(p.c, p.k), D)),
    drdM: ratNeg(ratDiv(one_c, ratMul(p.P, D))),
    kG: ratDiv(RAT_ONE, one_c),
    kT: ratNeg(ratDiv(p.c, one_c)),
  };
}

/** Output on the AD curve at price level P (IS–LM solved at that P). */
export function adOutput(p: IslmParams, P: Rat): Rat {
  return islmSolve({ ...p, P }).Y;
}

/**
 * The price level where AD meets a vertical AS at Y_f: hA + bM/P = D·Y_f, so P = bM/(D·Y_f − hA). Null when no
 * positive P exists (b = 0 or M = 0 makes AD vertical; D·Y_f ≤ hA puts Y_f beyond what any price level reaches).
 */
export function adPriceAt(p: IslmParams, Yf: Rat): Rat | null {
  const s = islmSolve(p);
  const den = ratSub(ratMul(s.D, Yf), ratMul(p.h, s.A));
  const num = ratMul(p.b, p.M);
  if (ratSign(num) <= 0 || ratSign(den) <= 0) return null;
  return ratDiv(num, den);
}

// ---------------------------------------------------------------------------------------------------------------
// Taylor rule

export interface TaylorParams {
  /** Neutral (equilibrium) real rate rⁿ, %. */
  rn: Rat;
  pi: Rat;
  piStar: Rat;
  gap: Rat;
  aPi: Rat;
  aY: Rat;
}

export interface TaylorResult {
  i: Rat;
  /** The four terms: rⁿ, π, a_π(π − π*), a_y·gap. */
  terms: [Rat, Rat, Rat, Rat];
  /** i − π. */
  real: Rat;
}

export function taylorRate(p: TaylorParams): TaylorResult {
  const t3 = ratMul(p.aPi, ratSub(p.pi, p.piStar));
  const t4 = ratMul(p.aY, p.gap);
  const i = ratAdd(ratAdd(ratAdd(p.rn, p.pi), t3), t4);
  return { i, terms: [p.rn, p.pi, t3, t4], real: ratSub(i, p.pi) };
}
