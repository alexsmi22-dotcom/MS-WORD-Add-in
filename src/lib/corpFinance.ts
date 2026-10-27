/**
 * Corporate finance engines (release F1, gap item #5, defect D6). Rates are decimals per period; cash flows are
 * cfs[0] at t = 0, cfs[t] at the end of period t.
 *
 *   every IRR   NPV scanned over the existing IRR range (−99% to 10,000% per period) on 6,000 steps even in ln(1 + r),
 *               each sign change bisected to full precision; a local minimum of |NPV| that touches zero without a
 *               sign change (a double root) is refined and reported separately. NPV is evaluated by Horner in
 *               1/(1 + r) above r = 0 and as NPV·(1 + r)ⁿ (a polynomial in 1 + r) below it, so neither form
 *               overflows at −99% with hundreds of flows; the two have the same sign and the same roots.
 *   MIRR        Excel MIRR: (FV of the positive flows at the reinvestment rate ÷ −PV of the negative flows at the
 *               finance rate)^(1/(n − 1)) − 1, n = number of flows.
 *   payback     first period the cumulative flow reaches zero, interpolated linearly within the period.
 *   PI          PV of the flows after t = 0 ÷ −CF₀ (later outflows are netted in the numerator).
 *   EAA         NPV × r/(1 − (1 + r)^−N), N = periods after t = 0 (NPV/N at r = 0).
 *   WACC        E/V·r_e + D/V·r_d(1 − T), r_e = r_f + β_L·MRP, Hamada β_L = β_U(1 + (1 − T)D/E).
 *   DCF         explicit years, a linear growth fade, a Gordon or exit-multiple terminal value, end-year or mid-year
 *               discounting, EV → equity → per share.
 */
import { IRR_SEARCH_MIN, IRR_SEARCH_MAX } from "./finance";

export type Err = { error: string };

export function npvAt(rate: number, cfs: number[]): number {
  if (rate === 0) return cfs.reduce((s, c) => s + c, 0);
  const x = 1 / (1 + rate);
  let s = 0;
  for (let t = cfs.length - 1; t >= 0; t--) s = s * x + cfs[t];
  return s;
}

/** NPV up to a positive factor (no overflow anywhere in the scanned range), and the same sum on |cᵗ| for a scale. */
const exp = Math.exp;
/** Writes [scaled NPV, scale] into `out`; `c` the flows, `a` their absolute values (hot loop: no allocation, no Math lookups). */
function npvScaledInto(u: number, c: Float64Array, a: Float64Array, out: Float64Array): void {
  const n = c.length - 1;
  let v = 0;
  let s = 0;
  if (u >= 0) {
    const x = exp(-u);
    for (let t = n; t >= 0; t--) {
      v = v * x + c[t];
      s = s * x + a[t];
    }
  } else {
    const y = exp(u);
    for (let t = 0; t <= n; t++) {
      v = v * y + c[t];
      s = s * y + a[t];
    }
  }
  out[0] = v;
  out[1] = s;
}

export const IRR_SCAN_STEPS = 6000;
export const MAX_FLOWS = 1000;

export interface IrrRoots {
  /** Sign-change roots, ascending (per period). */
  roots: number[];
  /** Touching (double) roots without a sign change. */
  touches: number[];
  /** Sign changes in the flow sequence (Descartes' bound on the number of positive-v roots). */
  signChanges: number;
}

export function signChanges(cfs: number[]): number {
  let k = 0;
  let prev = 0;
  for (const c of cfs) {
    if (c === 0) continue;
    if (prev !== 0 && Math.sign(c) !== Math.sign(prev)) k++;
    prev = c;
  }
  return k;
}

export function irrAll(cfs: number[]): IrrRoots {
  const sc = signChanges(cfs);
  const roots: number[] = [];
  const touches: number[] = [];
  if (cfs.length < 2 || sc === 0) return { roots, touches, signChanges: sc };
  // The scan runs one step past each end of the stated range, so a root ON a bound (−1, 101 has r = 10,000%
  // exactly) is bracketed; roots outside the range by more than rounding are dropped below.
  const lo0 = Math.log1p(IRR_SEARCH_MIN);
  const hi0 = Math.log1p(IRR_SEARCH_MAX);
  const N = IRR_SCAN_STEPS;
  const pad = (hi0 - lo0) / (N - 2);
  const u0 = lo0 - pad;
  const u1 = hi0 + pad;
  const C = Float64Array.from(cfs);
  const A = C.map(Math.abs);
  const out = new Float64Array(2);
  const scaledV = (u: number): number => {
    npvScaledInto(u, C, A, out);
    return out[0];
  };
  const us = new Float64Array(N + 1);
  const hs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const u = u0 + ((u1 - u0) * i) / N;
    npvScaledInto(u, C, A, out);
    us[i] = u;
    hs[i] = out[1] > 0 ? out[0] / out[1] : 0;
  }
  const bisect = (a: number, b: number, fa: number): number => {
    for (let k = 0; k < 200; k++) {
      const m = (a + b) / 2;
      if (m === a || m === b) break;
      const fm = scaledV(m);
      if (fm === 0) return m;
      if (Math.sign(fm) === Math.sign(fa)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  for (let i = 0; i <= N; i++) {
    if (hs[i] === 0) {
      roots.push(us[i]);
      continue;
    }
    if (i < N && hs[i + 1] !== 0 && Math.sign(hs[i]) !== Math.sign(hs[i + 1])) roots.push(bisect(us[i], us[i + 1], hs[i]));
  }
  // Touching roots: a local minimum of |h| between same-sign neighbours that comes within 1e−10 of zero.
  for (let i = 1; i < N; i++) {
    const a = Math.abs(hs[i - 1]);
    const b = Math.abs(hs[i]);
    const c = Math.abs(hs[i + 1]);
    if (!(b <= a && b <= c) || hs[i] === 0) continue;
    if (Math.sign(hs[i - 1]) !== Math.sign(hs[i]) || Math.sign(hs[i + 1]) !== Math.sign(hs[i])) continue;
    if (b > 1e-4) continue;
    let lo = us[i - 1];
    let hi = us[i + 1];
    const g = (u: number): number => {
      npvScaledInto(u, C, A, out);
      return out[1] > 0 ? Math.abs(out[0] / out[1]) : 0;
    };
    const R = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - R * (hi - lo);
    let x2 = lo + R * (hi - lo);
    let f1 = g(x1);
    let f2 = g(x2);
    for (let k = 0; k < 120 && hi - lo > 1e-15; k++) {
      if (f1 < f2) {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - R * (hi - lo);
        f1 = g(x1);
      } else {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + R * (hi - lo);
        f2 = g(x2);
      }
    }
    const um = (lo + hi) / 2;
    if (g(um) < 1e-10 && !roots.some((r) => Math.abs(r - um) < 1e-6)) touches.push(um);
  }
  // A multiple root (−100, 300, −300, 100 is −100(1 − v)³, root 0) is flat, so bisection stops wherever float noise
  // flips the sign (−0.0003% there). Snap a root to a rounder rate (whole percent, then 0.01%, then 0.0001%) when NPV
  // at that rate is at the float noise floor (|NPV| ≤ 10⁻¹⁴ of the flows' discounted magnitude): no false digits.
  const toRate = (u: number): number => {
    const r = Math.expm1(u);
    for (const q of [100, 10000, 1000000]) {
      const c = Math.round(r * q) / q;
      if (c === r || !(c > -1)) continue;
      npvScaledInto(Math.log1p(c), C, A, out);
      if (Math.abs(out[0]) <= 1e-14 * out[1]) return c;
    }
    return r;
  };
  const inRange = (u: number): boolean => u >= lo0 - 1e-12 && u <= hi0 + 1e-12;
  const uniq = (xs: number[]): number[] => xs.filter((x, k) => xs.indexOf(x) === k);
  return { roots: uniq(roots.filter(inRange).map(toRate)), touches: uniq(touches.filter(inRange).map(toRate)), signChanges: sc };
}

/** Excel MIRR; null when there is no negative or no positive flow (Excel's #DIV/0!). */
export function mirr(cfs: number[], financeRate: number, reinvestRate: number): number | null {
  const n = cfs.length;
  if (n < 2) return null;
  let fv = 0;
  let pv = 0;
  for (let t = 0; t < n; t++) {
    const c = cfs[t];
    if (c > 0) fv += c * Math.pow(1 + reinvestRate, n - 1 - t);
    else if (c < 0) pv += c / Math.pow(1 + financeRate, t);
  }
  if (!(fv > 0) || !(pv < 0)) return null;
  return Math.pow(fv / -pv, 1 / (n - 1)) - 1;
}

export interface Payback {
  /** Periods (fractional), or null when the cumulative flow never reaches zero, or "start" when CF₀ ≥ 0. */
  at: number | null | "start";
  /** A period after the payback where the cumulative flow is negative again (unconventional flows). */
  dipsAgain: number | null;
  cumulative: number[];
}

export function payback(flows: number[]): Payback {
  const cum: number[] = [];
  let s = 0;
  for (const c of flows) {
    s += c;
    cum.push(s);
  }
  if (!(flows[0] < 0)) return { at: "start", dipsAgain: null, cumulative: cum };
  let at: number | null = null;
  let k = -1;
  for (let t = 1; t < cum.length; t++) {
    if (cum[t] >= 0 && cum[t - 1] < 0) {
      at = t - 1 + -cum[t - 1] / flows[t];
      k = t;
      break;
    }
  }
  let dips: number | null = null;
  if (k > 0) for (let t = k + 1; t < cum.length; t++) if (cum[t] < 0) {
    dips = t;
    break;
  }
  return { at, dipsAgain: dips, cumulative: cum };
}

export function profitabilityIndex(rate: number, cfs: number[]): number | null {
  if (!(cfs[0] < 0)) return null;
  return (npvAt(rate, cfs) - cfs[0]) / -cfs[0];
}

export function eaa(rate: number, npvValue: number, life: number): number | null {
  if (!(life >= 1)) return null;
  if (rate === 0) return npvValue / life;
  return (npvValue * rate) / (1 - Math.pow(1 + rate, -life));
}

// ------------------------------------------------------------------------------------------------------------------
// WACC and Hamada
// ------------------------------------------------------------------------------------------------------------------

export const relever = (betaU: number, de: number, tax: number): number => betaU * (1 + (1 - tax) * de);
export const unlever = (betaL: number, de: number, tax: number): number => betaL / (1 + (1 - tax) * de);

export interface WaccInput {
  E: number;
  D: number;
  rd: number;
  tax: number;
  rf: number;
  mrp: number;
  beta: number;
  betaKind: "levered" | "unlevered" | "peer";
  peerDE: number;
  peerTax: number;
}
export interface WaccResult {
  V: number;
  wE: number;
  wD: number;
  de: number;
  betaU: number;
  betaL: number;
  re: number;
  rdAfter: number;
  wacc: number;
}

export function wacc(w: WaccInput): WaccResult | Err {
  const V = w.E + w.D;
  if (!(w.E > 0)) return { error: "Market value of equity must be above 0 (D/E is undefined at zero equity)." };
  if (!(w.D >= 0)) return { error: "Market value of debt must be 0 or more." };
  const de = w.D / w.E;
  let betaU: number;
  let betaL: number;
  if (w.betaKind === "levered") {
    betaL = w.beta;
    betaU = unlever(w.beta, de, w.tax);
  } else if (w.betaKind === "unlevered") {
    betaU = w.beta;
    betaL = relever(w.beta, de, w.tax);
  } else {
    if (!(w.peerDE >= 0)) return { error: "Peer debt-to-equity (D/E) must be 0 or more." };
    betaU = unlever(w.beta, w.peerDE, w.peerTax);
    betaL = relever(betaU, de, w.tax);
  }
  const re = w.rf + betaL * w.mrp;
  const rdAfter = w.rd * (1 - w.tax);
  return { V, wE: w.E / V, wD: w.D / V, de, betaU, betaL, re, rdAfter, wacc: (w.E / V) * re + (w.D / V) * rdAfter };
}

// ------------------------------------------------------------------------------------------------------------------
// Multi-stage DCF
// ------------------------------------------------------------------------------------------------------------------

export interface DcfInput {
  /** Explicit free cash flows, years 1 … N. */
  fcf: number[];
  wacc: number;
  fadeYears: number;
  /** Growth of the first fade year (decimal); fades linearly to g. */
  fadeStart: number;
  terminal: "gordon" | "exit";
  g: number;
  multiple: number;
  /** The final-year metric the exit multiple applies to (null: the final-year FCF). */
  metric: number | null;
  midYear: boolean;
  netDebt: number;
  shares: number | null;
}
export interface DcfYear {
  year: number;
  stage: "explicit" | "fade";
  growth: number | null;
  fcf: number;
  t: number;
  df: number;
  pv: number;
}
export interface DcfResult {
  years: DcfYear[];
  pvExplicit: number;
  pvFade: number;
  tv: number;
  tvT: number;
  pvTv: number;
  ev: number;
  equity: number;
  perShare: number | null;
  tvShare: number;
  /** Gordon: the implied multiple of final-year FCF; exit: the implied perpetual growth. */
  implied: number;
}

export const DCF_MAX_YEARS = 100;

export function dcfValue(d: DcfInput): DcfResult | Err {
  const N = d.fcf.length;
  if (N < 1) return { error: "Explicit free cash flows: enter at least one year." };
  if (N + d.fadeYears > DCF_MAX_YEARS) return { error: `Explicit and fade years together must be at most ${DCF_MAX_YEARS}.` };
  if (!(d.wacc > -1)) return { error: "Discount rate (WACC) must be above −100%." };
  if (d.terminal === "gordon" && !(d.wacc > d.g)) return { error: "Gordon terminal value: the discount rate (WACC) must be above the terminal growth rate g." };
  const years: DcfYear[] = [];
  const disc = (t: number): number => Math.pow(1 + d.wacc, -t);
  const off = d.midYear ? 0.5 : 0;
  d.fcf.forEach((c, i) => {
    const t = i + 1 - off;
    const df = disc(t);
    years.push({ year: i + 1, stage: "explicit", growth: i ? (d.fcf[i - 1] !== 0 ? c / d.fcf[i - 1] - 1 : null) : null, fcf: c, t, df, pv: c * df });
  });
  let last = d.fcf[N - 1];
  for (let k = 1; k <= d.fadeYears; k++) {
    const gk = d.fadeStart + ((d.g - d.fadeStart) * (k - 1)) / d.fadeYears;
    last = last * (1 + gk);
    const t = N + k - off;
    const df = disc(t);
    years.push({ year: N + k, stage: "fade", growth: gk, fcf: last, t, df, pv: last * df });
  }
  const T = N + d.fadeYears;
  let tv: number;
  let tvT: number;
  let implied: number;
  if (d.terminal === "gordon") {
    tv = (last * (1 + d.g)) / (d.wacc - d.g);
    tvT = T - off;
    implied = last !== 0 ? tv / last : NaN;
  } else {
    const base = d.metric ?? last;
    tv = d.multiple * base;
    tvT = T;
    implied = tv + last !== 0 ? (tv * d.wacc - last) / (tv + last) : NaN;
  }
  const pvTv = tv * disc(tvT);
  const pvExplicit = years.filter((y) => y.stage === "explicit").reduce((s, y) => s + y.pv, 0);
  const pvFade = years.filter((y) => y.stage === "fade").reduce((s, y) => s + y.pv, 0);
  const ev = pvExplicit + pvFade + pvTv;
  const equity = ev - d.netDebt;
  const perShare = d.shares !== null ? equity / d.shares : null;
  return { years, pvExplicit, pvFade, tv, tvT, pvTv, ev, equity, perShare, tvShare: ev !== 0 ? pvTv / ev : NaN, implied };
}
