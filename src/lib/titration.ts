// Acid–base equilibria, exactly: the pH of a solution and of a titration from the CHARGE BALANCE, solved for [H⁺]
// by bisection in pH — not the Henderson–Hasselbalch approximation, which fails at the start of a titration, at
// equivalence, at low concentration and wherever two pKa values are close. Pure: no Office.js.
//
// THE MODEL. One weak acid–base system (a monoprotic or polyprotic acid HₙA, or a base B accepting up to n protons,
// described by the pKa values of its fully protonated form), plus strong acid and strong base. Every species H_kX is
// counted by its number of protons k = 0…n; its fraction is
//   f_k ∝ h^k · Ka₁·Ka₂·…·Ka_(n−k)          (h = [H⁺])
// computed in logarithms so pKa values from −2 to 16 neither overflow nor underflow. If the system was ADDED as the
// form carrying m protons (acetic acid: m = 1; sodium acetate: m = 0 with Na⁺ counted as strong base; ammonia: m = 0),
// the charge balance reduces to
//   F(h) = h − Kw/h + C_b − C_a + C·(n̄(h) − m) = 0,      n̄ = Σ k·f_k   (mean protons per molecule),
// independent of the species' charges (the spectator ions cancel them). F rises strictly with h, so the root is
// unique and bisection on pH ∈ [−4, 18] finds it to 10⁻¹² in a capped number of steps.
//
// THE DERIVATIVE IS EXACT TOO. Differentiating the charge balance gives the buffer capacity
//   β = −dC_a/dpH = dC_b/dpH = ln 10 · (h + Kw/h + C·Var(k))
// (Var(k) = Σ (k − n̄)²·f_k, the variance of the number of protons) and, along a titration,
//   dpH/dV = (V₀/(V₀+V)²)·(±C_t − P₀)/β,   P₀ = (C_b,0 − C_a,0) + C₀(n̄ − m),
// so the dpH/dV panel is not a finite difference of sampled points.
//
// ACTIVITIES ARE NOT MODELLED: concentrations stand in for activities (ideal solution). Kw defaults to 1.0×10⁻¹⁴
// (pKw 14.00, 25 °C); a user who has pKw at another temperature types it. pKa values are user inputs (the pKa
// block of Chemistry's structure properties, pka.ts, gives group-typical values from a structure).
//
// Oracle: scipy.optimize.brentq on the same charge balance written independently (see titration.test.ts).

export const KW_25C = 1.0e-14;
export const TITRATION_SOURCE =
  "Exact charge balance [H⁺] + C_b = [OH⁻] + C_a + C·(m − n̄), solved for [H⁺]; concentrations used as activities; Kw = 1.0×10⁻¹⁴ at 25 °C unless another pKw is given.";

/** A weak acid–base system: pKa values of its fully protonated form, ascending (Ka₁ is the first proton lost). */
export interface WeakSystem {
  pKa: number[];
  /** Total concentration of the system (all forms), M. */
  C: number;
  /** Protons on the form that was added (acid HₙA: n; free base B: 0). */
  m: number;
}

export interface SolutionSpec {
  weak?: WeakSystem | null;
  /** Strong acid (e.g. HCl) concentration, M: its anion is a spectator. */
  Ca: number;
  /** Strong base (e.g. NaOH) concentration, M; also every spectator cation (Na⁺ of a sodium salt). */
  Cb: number;
  Kw: number;
}

const LN10 = Math.LN10;
const PH_LO = -4;
const PH_HI = 18;
const MAX_BISECT = 200;

/** Fractions f_k (k = protons, 0…n) at a pH. */
export function fractions(pKa: number[], pH: number): number[] {
  const n = pKa.length;
  // O(n²): a caller handing over thousands of "pKa values" is refused rather than served slowly.
  if (n > 8) throw new Error("at most eight pKa values");
  // log10 of each term: k·(−pH) − Σ_{i < n−k} pKa_i
  const logs: number[] = [];
  for (let k = 0; k <= n; k++) {
    let s = -k * pH;
    for (let i = 0; i < n - k; i++) s -= pKa[i];
    logs.push(s);
  }
  const mx = Math.max(...logs);
  const t = logs.map((l) => Math.pow(10, l - mx));
  const sum = t.reduce((a, b) => a + b, 0);
  return t.map((x) => x / sum);
}

/** Mean and variance of the number of protons at a pH. */
export function protonStats(pKa: number[], pH: number): { nbar: number; variance: number } {
  const f = fractions(pKa, pH);
  const nbar = f.reduce((s, fk, k) => s + k * fk, 0);
  const variance = f.reduce((s, fk, k) => s + (k - nbar) ** 2 * fk, 0);
  return { nbar, variance };
}

/** The charge-balance residual at a pH (positive: too much H⁺, the true pH is higher). */
export function chargeResidual(s: SolutionSpec, pH: number): number {
  const h = Math.pow(10, -pH);
  let r = h - s.Kw / h + (s.Cb - s.Ca);
  if (s.weak && s.weak.pKa.length) r += s.weak.C * (protonStats(s.weak.pKa, pH).nbar - s.weak.m);
  return r;
}

/** Buffer capacity β = dC_b/dpH (mol L⁻¹ per pH unit). */
export function bufferCapacity(s: SolutionSpec, pH: number): number {
  const h = Math.pow(10, -pH);
  let b = h + s.Kw / h;
  if (s.weak && s.weak.pKa.length) b += s.weak.C * protonStats(s.weak.pKa, pH).variance;
  return LN10 * b;
}

/** Checks a solution's numbers; a message, or null when they are usable. */
export function checkSolution(s: SolutionSpec): string | null {
  if (!(s.Kw > 0 && Number.isFinite(s.Kw))) return "Kw must be a positive number";
  for (const [v, name] of [[s.Ca, "the strong-acid concentration"], [s.Cb, "the strong-base concentration"]] as const) {
    if (!(Number.isFinite(v) && v >= 0)) return `${name} must be a finite number, zero or above`;
    if (v > 20) return `${name} is above 20 M, beyond any real solution (and far beyond where concentrations stand in for activities)`;
  }
  if (s.weak) {
    const w = s.weak;
    if (!(Number.isFinite(w.C) && w.C >= 0)) return "the weak acid/base concentration must be a finite number, zero or above";
    if (w.C > 20) return "the weak acid/base concentration is above 20 M";
    if (w.pKa.length < 1 || w.pKa.length > 4) return "give one to four pKa values";
    for (const p of w.pKa) if (!(Number.isFinite(p) && p >= -2 && p <= 16)) return "each pKa must be a number from −2 to 16";
    for (let i = 1; i < w.pKa.length; i++) if (w.pKa[i] < w.pKa[i - 1]) return "list the pKa values in ascending order (pKa₁ ≤ pKa₂ ≤ …): each proton is harder to remove than the last";
    if (!(Number.isInteger(w.m) && w.m >= 0 && w.m <= w.pKa.length)) return "the added form's proton count must be a whole number from 0 to n";
  }
  return null;
}

/** The exact pH of a solution, by bisection on the charge balance. */
export function solvePH(s: SolutionSpec): number | string {
  const bad = checkSolution(s);
  if (bad) return bad;
  let lo = PH_LO, hi = PH_HI;
  const rLo = chargeResidual(s, lo), rHi = chargeResidual(s, hi);
  // The residual falls as pH rises (h falls). At pH −4 it is dominated by h = 10⁴ M, at 18 by −Kw/h; no input inside
  // the checks above can escape that bracket, but a refusal costs nothing if it ever does.
  if (!(rLo > 0 && rHi < 0)) return "the charge balance has no root between pH −4 and 18 for these inputs";
  for (let i = 0; i < MAX_BISECT && hi - lo > 1e-12; i++) {
    const mid = 0.5 * (lo + hi);
    const r = chargeResidual(s, mid);
    if (r === 0) return mid;
    if (r > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ------------------------------------------------------------------ titration

export type AnalyteKind = "strong-acid" | "weak-acid" | "strong-base" | "weak-base";

export interface TitrationSpec {
  kind: AnalyteKind;
  /** pKa values of the fully protonated form, ascending (a weak base: of its conjugate acid(s)). */
  pKa: number[];
  /** Analyte concentration (M) and volume (mL). */
  C0: number;
  V0: number;
  /** Titrant (strong base for an acid analyte, strong acid for a base) concentration, M. */
  Ct: number;
  Kw: number;
}

export const isAcidAnalyte = (k: AnalyteKind): boolean => k === "strong-acid" || k === "weak-acid";
const isWeak = (k: AnalyteKind): boolean => k === "weak-acid" || k === "weak-base";

/** The solution in the flask after V mL of titrant. */
export function titrationSolution(t: TitrationSpec, V: number): SolutionSpec {
  const Vt = t.V0 + V;
  const cA = (t.C0 * t.V0) / Vt; // analyte, diluted
  const cT = (t.Ct * V) / Vt; // titrant delivered
  const acid = isAcidAnalyte(t.kind);
  const s: SolutionSpec = { Ca: 0, Cb: 0, Kw: t.Kw, weak: null };
  if (acid) s.Cb = cT;
  else s.Ca = cT;
  if (t.kind === "strong-acid") s.Ca = cA;
  else if (t.kind === "strong-base") s.Cb = cA;
  else s.weak = { pKa: t.pKa, C: cA, m: acid ? t.pKa.length : 0 };
  return s;
}

export function checkTitration(t: TitrationSpec): string | null {
  for (const [v, name] of [[t.C0, "the analyte concentration"], [t.Ct, "the titrant concentration"]] as const) {
    if (!(Number.isFinite(v) && v > 0)) return `${name} must be a number above zero`;
    if (v > 20) return `${name} is above 20 M`;
  }
  if (!(Number.isFinite(t.V0) && t.V0 > 0 && t.V0 <= 1e6)) return "the analyte volume must be a number above zero (mL)";
  if (isWeak(t.kind)) {
    const probe = checkSolution({ weak: { pKa: t.pKa, C: t.C0, m: 0 }, Ca: 0, Cb: 0, Kw: t.Kw });
    if (probe) return probe;
  } else if (!(t.Kw > 0 && Number.isFinite(t.Kw))) return "Kw must be a positive number";
  return null;
}

/** Stoichiometric equivalence volumes, mL (one per proton for a weak system, one for a strong analyte). */
export function equivalenceVolumes(t: TitrationSpec): number[] {
  const v1 = (t.C0 * t.V0) / t.Ct;
  const n = isWeak(t.kind) ? t.pKa.length : 1;
  return Array.from({ length: n }, (_, j) => (j + 1) * v1);
}

export function titrationPH(t: TitrationSpec, V: number): number | string {
  if (!(Number.isFinite(V) && V >= 0)) return "the titrant volume must be a number, zero or above";
  return solvePH(titrationSolution(t, V));
}

/** dpH/dV (per mL) at V, exact from the charge balance. */
export function titrationSlope(t: TitrationSpec, V: number, pH: number): number {
  const Vt = t.V0 + V;
  const s0 = titrationSolution(t, 0); // undiluted analyte: P₀ below
  let P0 = s0.Cb - s0.Ca;
  if (s0.weak) P0 += t.C0 * (protonStats(t.pKa, pH).nbar - s0.weak.m);
  const tSign = isAcidAnalyte(t.kind) ? 1 : -1;
  const beta = bufferCapacity(titrationSolution(t, V), pH);
  return ((t.V0 / (Vt * Vt)) * (tSign * t.Ct - P0)) / beta;
}

export interface CurvePoint {
  V: number;
  pH: number;
  slope: number;
}

export interface Break {
  /** Stoichiometric equivalence volume, mL. */
  Veq: number;
  pHeq: number;
  /** The inflection (dpH/dV maximum) near it, or null when there is no clear break. */
  inflection: { V: number; pH: number; slope: number } | null;
}

export interface TitrationResult {
  curve: CurvePoint[];
  breaks: Break[];
  /** Half-equivalence points: volume, pH, and (weak systems) the pKa the pH approximates. */
  halves: Array<{ V: number; pH: number; pKa: number | null }>;
  pHstart: number;
  Vmax: number;
}

export const CURVE_POINTS = 801;

/** The whole curve to Vmax (default: 1.5 × the last equivalence volume). */
export function titrate(t: TitrationSpec, VmaxIn?: number): TitrationResult | string {
  const bad = checkTitration(t);
  if (bad) return bad;
  const veq = equivalenceVolumes(t);
  const Vmax = VmaxIn !== undefined ? VmaxIn : 1.5 * veq[veq.length - 1];
  if (!(Number.isFinite(Vmax) && Vmax > 0)) return "the largest titrant volume must be a number above zero";
  if (Vmax > 1000 * veq[veq.length - 1]) return "the largest titrant volume is over a thousand times the last equivalence volume: check the units";
  const curve: CurvePoint[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const V = (Vmax * i) / (CURVE_POINTS - 1);
    const pH = titrationPH(t, V);
    if (typeof pH === "string") return pH;
    curve.push({ V, pH, slope: titrationSlope(t, V, pH) });
  }
  const at = (V: number): number => titrationPH(t, V) as number;
  const v1 = veq[0];
  const breaks: Break[] = veq.map((Veq) => {
    const pHeq = at(Veq);
    return { Veq, pHeq, inflection: findInflection(t, Veq, v1) };
  });
  // A break is far narrower than the grid spacing (a strong acid's dpH/dV peak is ~10⁻³ mL wide), so the curve gets
  // extra exact points around every equivalence and inflection: the panel then draws the true peak height.
  const extra: number[] = [];
  for (const b of breaks) {
    for (const c of [b.Veq, b.inflection?.V]) {
      if (c === undefined) continue;
      extra.push(c);
      for (const f of [1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2]) extra.push(c - f * v1, c + f * v1);
    }
  }
  for (const V of extra) {
    if (!(V > 0 && V < Vmax)) continue;
    const pH = at(V);
    curve.push({ V, pH, slope: titrationSlope(t, V, pH) });
  }
  curve.sort((a, b) => a.V - b.V);
  const halves: TitrationResult["halves"] = [];
  if (isWeak(t.kind)) {
    const n = t.pKa.length;
    for (let j = 1; j <= n; j++) {
      const V = (j - 0.5) * v1;
      // An acid loses its most acidic proton first (pKa₁); a base gains its most basic site first (pKa_n).
      halves.push({ V, pH: at(V), pKa: isAcidAnalyte(t.kind) ? t.pKa[j - 1] : t.pKa[n - j] });
    }
  } else halves.push({ V: 0.5 * v1, pH: at(0.5 * v1), pKa: null });
  return { curve, breaks, halves, pHstart: at(0), Vmax };
}

/**
 * The dpH/dV maximum within ±0.3·V₁ of an equivalence volume, found by a golden-section search after a coarse scan.
 * It counts as a BREAK only if it is an interior maximum at least three times the slope at both window edges: a
 * proton with pKa near pKw (the third of phosphoric acid) or two pKa values within about 3 units leave no maximum a
 * pH electrode could locate, and saying so is the honest answer.
 */
function findInflection(t: TitrationSpec, Veq: number, v1: number): Break["inflection"] {
  const lo = Math.max(0, Veq - 0.3 * v1), hi = Veq + 0.3 * v1;
  const slopeAt = (V: number): number => {
    const p = titrationPH(t, V);
    return typeof p === "string" ? NaN : Math.abs(titrationSlope(t, V, p));
  };
  const N = 240;
  let best = -1, bestV = Veq;
  for (let i = 0; i <= N; i++) {
    const V = lo + ((hi - lo) * i) / N;
    const s = slopeAt(V);
    if (s > best) {
      best = s;
      bestV = V;
    }
  }
  const step = (hi - lo) / N;
  if (bestV <= lo + step / 2 || bestV >= hi - step / 2) return null;
  // Golden-section refine in [bestV − step, bestV + step].
  let a = bestV - step, b = bestV + step;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80 && b - a > 1e-10 * Math.max(1, Veq); i++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (slopeAt(c) > slopeAt(d)) b = d;
    else a = c;
  }
  const V = 0.5 * (a + b);
  const slope = slopeAt(V);
  const edge = Math.max(slopeAt(lo), slopeAt(hi));
  if (!(slope >= 3 * edge)) return null;
  const pH = titrationPH(t, V) as number;
  return { V, pH, slope: titrationSlope(t, V, pH) };
}

// --------------------------------------------------------- measured endpoints

export interface MeasuredEndpoint {
  /** Endpoint volume from the first-derivative maximum (midpoint of the steepest interval). */
  Vfirst: number;
  /** From the second-derivative zero crossing next to it (null when the data do not cross). */
  Vsecond: number | null;
  slope: number;
}

/**
 * Endpoints of a measured curve: ΔpH/ΔV on interval midpoints, its interior local maxima (each the largest within
 * two neighbours on either side, and at least a fifth of the steepest; at most four), and for each the zero crossing of
 * the second difference between the maxima's neighbours, interpolated linearly — the classical method.
 */
export function measuredEndpoints(data: Array<[number, number]>): MeasuredEndpoint[] | string {
  if (data.length < 5) return "paste at least five (V, pH) readings";
  for (let i = 1; i < data.length; i++) if (!(data[i][0] > data[i - 1][0])) return "the titrant volumes must increase down the list (no repeats)";
  const d1: Array<[number, number]> = [];
  for (let i = 1; i < data.length; i++) d1.push([(data[i][0] + data[i - 1][0]) / 2, (data[i][1] - data[i - 1][1]) / (data[i][0] - data[i - 1][0])]);
  const d2: Array<[number, number]> = [];
  for (let i = 1; i < d1.length; i++) d2.push([(d1[i][0] + d1[i - 1][0]) / 2, (d1[i][1] - d1[i - 1][1]) / (d1[i][0] - d1[i - 1][0])]);
  const mags = d1.map(([, s]) => Math.abs(s));
  const top = Math.max(...mags);
  if (!(top > 0)) return "the pH never changes, so there is no endpoint to locate";
  const peaks: number[] = [];
  // Interior points only: the steep start of a weak-acid curve is a maximum of ΔpH/ΔV at the first interval, not an
  // endpoint, and the last interval has no right-hand side to compare against.
  for (let i = 1; i < d1.length - 1; i++) {
    let isMax = mags[i] >= 0.2 * top && mags[i] > mags[i - 1] && mags[i] >= mags[i + 1];
    for (let j = Math.max(0, i - 2); j <= Math.min(d1.length - 1, i + 2) && isMax; j++) if (j !== i && mags[j] > mags[i]) isMax = false;
    if (isMax && !(peaks.length && i - peaks[peaks.length - 1] <= 2)) peaks.push(i);
  }
  const out: MeasuredEndpoint[] = [];
  for (const i of peaks.slice(0, 4)) {
    // d2[i−1] is between d1[i−1] and d1[i]; d2[i] between d1[i] and d1[i+1]: the crossing lies between them.
    let Vsecond: number | null = null;
    if (i >= 1 && i < d2.length) {
      const [xa, ya] = d2[i - 1], [xb, yb] = d2[i];
      if (Math.sign(ya) !== Math.sign(yb) && ya !== yb) Vsecond = xa + ((xb - xa) * ya) / (ya - yb);
    }
    out.push({ Vfirst: d1[i][0], Vsecond, slope: d1[i][1] });
  }
  return out;
}

// ------------------------------------------------------------------ labels

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sub = (k: number): string => (k <= 1 ? "" : String(k).split("").map((d) => SUB[Number(d)]).join(""));
const charge = (z: number): string => (z === 0 ? "" : (Math.abs(z) === 1 ? "" : String(Math.abs(z)).split("").map((d) => SUP[Number(d)]).join("")) + (z > 0 ? "⁺" : "⁻"));

/** A species with k protons: HₖA^(k−n) for an acid system, BHₖ^(k+) for a base. */
export function speciesLabel(k: number, n: number, base: boolean): string {
  if (base) return k === 0 ? "B" : `BH${sub(k)}${charge(k)}`;
  return `${k === 0 ? "" : `H${sub(k)}`}A${charge(k - n)}`;
}

/** pKb values of a base (B + H₂O ⇌ BH⁺ + OH⁻ first) → pKa values of its conjugate acid, ascending. */
export function pKbToPKa(pKb: number[], pKw: number): number[] {
  if (!Array.isArray(pKb) || pKb.length > 8 || typeof pKw !== "number") throw new Error("at most eight pKb values and a numeric pKw");
  return pKb.map((b) => pKw - b).sort((a, b) => a - b);
}
