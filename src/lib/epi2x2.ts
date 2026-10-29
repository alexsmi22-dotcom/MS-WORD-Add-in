/**
 * 2×2 epidemiology (v2.206.0): risk ratio, odds ratio, risk difference, NNT with Altman's notation, and the
 * incidence-rate ratio for person-time. Pure functions; the pane glue is clinicalStatCalcs.ts. The chi-square and
 * Fisher p-values come from stats2.ts chiSquareIndependence (the Stats chi-square tool's own engine).
 *
 * Table layout: row 1 exposed / treated, row 2 unexposed / control; column 1 with the event (or case), column 2
 * without (or control):  a b / c d.
 *
 * Conventions (printed with the result):
 *  - Risk ratio: log (Katz et al. 1978) interval, SE ln RR = √(1/a − 1/(a+b) + 1/c − 1/(c+d)).
 *  - Odds ratio: Woolf (1955) log interval, SE ln OR = √(1/a + 1/b + 1/c + 1/d).
 *  - A zero cell: 0.5 added to every cell (Haldane–Anscombe) for the RR and OR only, and said.
 *  - Risk difference p₁ − p₀: Wald, or Newcombe's (1998, Stat Med 17:873, method 10) hybrid score interval built from
 *    the two Wilson intervals.
 *  - ARR = p₀ − p₁ (control minus treated: positive when the treatment lowers the risk of an adverse event);
 *    RRR = 1 − RR with the interval 1 − the RR interval.
 *  - NNT = 1/|ARR| with Altman's (1998, BMJ 317:1309) notation: NNTB for benefit, NNTH for harm, and when the ARR
 *    interval includes 0 the NNT interval passes through infinity ("NNTH 20 to ∞ to NNTB 4").
 *  - Incidence-rate ratio: Wald on the log scale (SE √(1/a + 1/c)), and exact from the conditional binomial
 *    distribution of a given a + c (Clopper–Pearson on π = a/(a + c), IRR = π/(1 − π) · T₀/T₁), with the exact
 *    two-sided binomial test of IRR = 1.
 */
import { propCi, Z975, binomTwoSided, betaQuantile } from "./clinicalCore";

export interface Ci {
  est: number;
  lo: number;
  hi: number;
}

export interface Epi2x2 {
  a: number;
  b: number;
  c: number;
  d: number;
  p1: number;
  p0: number;
  rr: Ci;
  or: Ci;
  rd: Ci;
  rdMethod: "newcombe" | "wald";
  arr: Ci;
  rrr: Ci;
  /** True when either ratio was computed with 0.5 added to every cell. */
  haldane: boolean;
  /** Which ratio was corrected: the RR only when a or c is 0 (it is then 0 or infinite), the OR when any cell is 0. */
  rrCorrected: boolean;
  orCorrected: boolean;
}

const logCi = (est: number, se: number): Ci => ({ est, lo: Math.exp(Math.log(est) - Z975 * se), hi: Math.exp(Math.log(est) + Z975 * se) });

/** The ratio and difference measures of a cohort/trial 2×2 (the OR is valid for case-control too). */
export function epi2x2(a: number, b: number, c: number, d: number, rdMethod: "newcombe" | "wald"): Epi2x2 | { error: string } {
  const n1 = a + b;
  const n0 = c + d;
  if (n1 === 0) return { error: "Row 1 (exposed / treated) has no subjects." };
  if (n0 === 0) return { error: "Row 2 (unexposed / control) has no subjects." };
  if (a + c === 0) return { error: "No one had the event in either group (a = c = 0), so every ratio is 0/0: there is nothing to compare." };
  if (b + d === 0) return { error: "Everyone had the event in both groups (b = d = 0), so the odds are infinite in both: there is nothing to compare." };
  const p1 = a / n1;
  const p0 = c / n0;
  // Haldane–Anscombe only where a ratio is truly 0, infinite or 0/0 (review B4: "10, 0 / 5, 5" has RR = 2 exactly, and
  // correcting every cell printed 1.91). The RR needs a > 0 and c > 0; the OR needs every cell > 0.
  const rrCorrected = a === 0 || c === 0;
  const orCorrected = a === 0 || b === 0 || c === 0 || d === 0;
  const kr = rrCorrected ? 0.5 : 0;
  const ko = orCorrected ? 0.5 : 0;
  const [Ar, Br, Cr, Dr] = [a + kr, b + kr, c + kr, d + kr];
  const [Ao, Bo, Co, Do] = [a + ko, b + ko, c + ko, d + ko];
  const rr = logCi(Ar / (Ar + Br) / (Cr / (Cr + Dr)), Math.sqrt(Math.max(0, 1 / Ar - 1 / (Ar + Br) + 1 / Cr - 1 / (Cr + Dr))));
  const or = logCi((Ao * Do) / (Bo * Co), Math.sqrt(1 / Ao + 1 / Bo + 1 / Co + 1 / Do));
  const haldane = rrCorrected || orCorrected;
  const diff = p1 - p0;
  let rd: Ci;
  if (rdMethod === "wald") {
    const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p0 * (1 - p0)) / n0);
    rd = { est: diff, lo: Math.max(-1, diff - Z975 * se), hi: Math.min(1, diff + Z975 * se) };
  } else {
    const w1 = propCi(a, n1, "wilson");
    const w0 = propCi(c, n0, "wilson");
    rd = {
      est: diff,
      lo: diff - Math.sqrt((p1 - w1.lo) ** 2 + (w0.hi - p0) ** 2),
      hi: diff + Math.sqrt((w1.hi - p1) ** 2 + (p0 - w0.lo) ** 2),
    };
  }
  const arr = { est: -rd.est, lo: -rd.hi, hi: -rd.lo };
  const rrr = { est: 1 - rr.est, lo: 1 - rr.hi, hi: 1 - rr.lo };
  return { a, b, c, d, p1, p0, rr, or, rd, rdMethod, arr, rrr, haldane, rrCorrected, orCorrected };
}

/** One side of an NNT: "NNTB 10" or "NNTH 12.5". */
export interface NntSide {
  kind: "NNTB" | "NNTH";
  value: number;
}

export interface Nnt {
  /** Null when the ARR is exactly 0 (no difference: NNT is infinite). */
  point: NntSide | null;
  /** The interval: either two finite ends on the same side, or `crossesZero` with both ends named. */
  lo: NntSide | null;
  hi: NntSide | null;
  crossesZero: boolean;
  /** Altman's text: "NNTB 10 (95% CI 6.7 to 20)" or "NNTB 10 (NNTH 20 to ∞ to NNTB 4)". */
  text: string;
}

function side(arr: number): NntSide | null {
  if (arr === 0) return null;
  return arr > 0 ? { kind: "NNTB", value: 1 / arr } : { kind: "NNTH", value: -1 / arr };
}

/**
 * The NNT and its interval from an ARR (positive = benefit) and its interval, by Altman (1998). `fmt` formats a
 * finite NNT. The point is "no difference (NNT infinite)" when ARR = 0.
 */
export function altmanNnt(arr: number, lo: number, hi: number, fmt: (v: number) => string): Nnt {
  const p = side(arr);
  const pText = p ? `${p.kind} ${fmt(p.value)}` : "no difference (the NNT is infinite)";
  const crosses = lo <= 0 && hi >= 0;
  if (!crosses) {
    // Both ends on one side: the reciprocals reverse their order.
    const a = side(hi)!;
    const b = side(lo)!;
    const [near, far] = arr > 0 ? [a, b] : [b, a];
    return { point: p, lo: near, hi: far, crossesZero: false, text: `${pText} (95% CI ${fmt(near.value)} to ${fmt(far.value)})` };
  }
  const harm = side(lo);
  const ben = side(hi);
  const harmText = harm ? `${harm.kind} ${fmt(harm.value)}` : "";
  const benText = ben ? `${ben.kind} ${fmt(ben.value)}` : "";
  const inner = [harmText, "∞", benText].filter(Boolean).join(" to ");
  return { point: p, lo: harm, hi: ben, crossesZero: true, text: `${pText} (${inner})` };
}

export interface RateRatio {
  a: number;
  t1: number;
  c: number;
  t0: number;
  r1: number;
  r0: number;
  irr: number;
  wald: { lo: number; hi: number } | null;
  exact: { lo: number; hi: number };
  pExact: number;
  rd: Ci;
}

/** Incidence-rate ratio of a events in person-time t1 against c events in t0. */
export function rateRatio(a: number, t1: number, c: number, t0: number): RateRatio | { error: string } {
  if (!(t1 > 0) || !(t0 > 0)) return { error: "Person-time must be positive in both groups." };
  if (a + c === 0) return { error: "There are no events in either group, so the rate ratio is 0/0: there is nothing to compare." };
  if (c === 0) {
    return { error: "The reference group (row 2) has no events, so its rate is 0 and the rate ratio is infinite. Swap the rows to estimate the inverse ratio, or report the two rates." };
  }
  const r1 = a / t1;
  const r0 = c / t0;
  const irr = r1 / r0;
  const wald = a > 0 ? { lo: Math.exp(Math.log(irr) - Z975 * Math.sqrt(1 / a + 1 / c)), hi: Math.exp(Math.log(irr) + Z975 * Math.sqrt(1 / a + 1 / c)) } : null;
  const N = a + c;
  const piLo = a === 0 ? 0 : betaQuantile(0.025, a, N - a + 1);
  const piHi = a === N ? 1 : betaQuantile(0.975, a + 1, N - a);
  const conv = (pi: number): number => (pi / (1 - pi)) * (t0 / t1);
  const exact = { lo: conv(piLo), hi: conv(piHi) };
  const pExact = binomTwoSided(a, N, t1 / (t1 + t0));
  const rdSe = Math.sqrt(a / (t1 * t1) + c / (t0 * t0));
  const rdv = r1 - r0;
  return { a, t1, c, t0, r1, r0, irr, wald, exact, pExact, rd: { est: rdv, lo: rdv - Z975 * rdSe, hi: rdv + Z975 * rdSe } };
}
