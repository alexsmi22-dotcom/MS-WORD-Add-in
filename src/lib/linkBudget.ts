// Link budget and noise cascade (Release E, gap #6): the Friis free-space link, the Friis noise-figure cascade with
// the receiver sensitivity it implies, and Eb/N0 ↔ bit error rate in AWGN. Pure functions; every input is in SI or
// in dB as named, every refusal is a sentence (a confident wrong number is the worst outcome).
//
// Sources and constants:
//   c = 299 792 458 m/s and k = 1.380649×10⁻²³ J/K are exact in the 2019 SI.
//   T₀ = 290 K is the reference temperature in the IEEE definition of noise figure; Te = T₀(F − 1) uses it whatever the
//   source temperature, which is why it is a constant here, not an input.
//   Friis transmission: Pr = Pt + Gt + Gr − FSPL − losses, FSPL = 20 log₁₀(4πd/λ) (far field, free space).
//   Friis noise: F = F₁ + (F₂ − 1)/G₁ + (F₃ − 1)/(G₁G₂) + …
//   BPSK, and Gray-coded QPSK per bit: Pb = ½ erfc(√(Eb/N₀)) (Wikipedia "Phase-shift keying", citing Xiong 2000;
//   MathWorks "Analytical Expressions Used in berawgn Function", eqs. 5.2-57 and 5.2-62 of its reference [1]).
//   DBPSK (differentially coherent detection): Pb = ½ exp(−Eb/N₀) (Wikipedia, citing Stüber 1988; MathWorks, eq. 8.85
//   of its reference [2]) — the two sources agree.
//   M-PSK, M = 8 and 16, Gray coded: Ps ≈ 2Q(√(2Es/N₀) sin(π/M)), Pb ≈ Ps/log₂M (Wikipedia, "approximated for high M
//   and high Eb/N₀"). Checked against a Gray-coded Monte Carlo simulation (oracle script in linkBudgetCases.test.ts):
//   within 4 % for 8-PSK from Pb 4.6×10⁻² down to 9.5×10⁻⁶ and for 16-PSK from 10⁻¹ down to 1.25×10⁻⁴; this tool
//   uses it only for Pb ≤ 10⁻¹ and says it is an approximation.
//   M-QAM is NOT offered: no source read for this release rendered its formula legibly enough to check.

import { erfPrecise, erfcPrecise } from "./probdist";
import { fmtSig } from "./axis";

/** Speed of light in vacuum, m/s (exact, SI 2019). */
export const C_LIGHT = 299792458;
/** Boltzmann constant, J/K (exact, SI 2019). */
const K_BOLTZMANN = 1.380649e-23;
/** Noise-figure reference temperature, K (IEEE definition). */
export const T0_NOISE = 290;
/** kT₀ in dBm/Hz (≈ −173.975). */
export const KT0_DBM_HZ = 10 * Math.log10((K_BOLTZMANN * T0_NOISE) / 1e-3);
/** Most cascade stages accepted. */
export const MAX_STAGES = 50;
/** Largest free-space path loss accepted, dB (a probe at Neptune at 32 GHz is about 330 dB). */
const FSPL_MAX_DB = 400;
/** Largest |cumulative gain| along a cascade, dB (beyond it the linear product leaves double precision's useful range). */
const CUM_GAIN_LIMIT_DB = 300;
/** Largest |dB| accepted for a gain, loss or level (beyond it a typo is likelier than a link). */
const DB_LIMIT = 400;

export type Err = { ok: false; error: string };
const err = (error: string): Err => ({ ok: false, error });
const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));
/** An echoed number for a refusal: plain digits in 10⁻³…10⁶, ×10ⁿ outside, U+2212 (never "1e+301"). */
const nv = (v: number): string => {
  const a = Math.abs(v);
  return v === 0 || (a >= 1e-3 && a < 1e6) ? String(Number(v.toPrecision(6))).replace(/^-/, "−") : fmtSig(v, 6).replace(/(\.\d*?)0+(?=×)/, "$1").replace(/\.(?=×)/, "");
};

/** 10 log₁₀ and its inverse (power ratios). Module-private: audio.ts toDb(ratio, quantity) is the app's exported dB
 *  helper, but it wraps each result for its level calculators; here only the bare power ratio is ever needed. */
const toDb = (x: number): number => 10 * Math.log10(x);
const fromDb = (db: number): number => Math.pow(10, db / 10);

// ---------------------------------------------------------------------------------------------------------------
// Free-space path loss and the Friis link
// ---------------------------------------------------------------------------------------------------------------

/** FSPL = 20 log₁₀(4πd/λ) dB. Refuses d below 2λ: the far-field Friis form is meaningless there (it even turns
 *  into a gain below λ/4π). */
export function fspl(fHz: number, dM: number): { ok: true; db: number; lambda: number } | Err {
  if (!fin(fHz, dM)) return err("Frequency and distance must be finite numbers.");
  if (!(fHz > 0)) return err("The frequency must be greater than zero.");
  if (!(dM > 0)) return err("The distance must be greater than zero.");
  const lambda = C_LIGHT / fHz;
  const db = 20 * Math.log10((4 * Math.PI * dM) / lambda);
  if (!Number.isFinite(db) || db > FSPL_MAX_DB)
    return err(`The path loss would exceed ${FSPL_MAX_DB} dB (beyond any real link, deep-space ones included): check the frequency and distance.`);
  if (dM < 2 * lambda)
    return err(
      `The distance is less than two wavelengths (λ = ${fmtSig(lambda, 4)} m): the Friis free-space formula assumes the far field, ` +
        "and so close to the antenna it does not hold (below λ/4π it would even give a negative loss).",
    );
  return { ok: true, db, lambda };
}

export interface LinkInput {
  ptDbm: number;
  gtDbi: number;
  grDbi: number;
  fHz: number;
  dM: number;
  /** Transmit feeder (cable, connector) loss, dB ≥ 0. */
  txLossDb: number;
  /** Receive feeder loss, dB ≥ 0. */
  rxLossDb: number;
  /** Other losses (atmospheric, polarisation, pointing, fade allowance), dB ≥ 0. */
  otherLossDb: number;
  /** Receiver sensitivity, dBm (optional). */
  sensDbm: number | null;
}

export interface LinkResult {
  ok: true;
  lambda: number;
  fsplDb: number;
  eirpDbm: number;
  prDbm: number;
  prW: number;
  /** Pr − sensitivity, dB (null without a sensitivity). */
  marginDb: number | null;
  /**
   * Distance at which Pr falls to the sensitivity, free space (null without a sensitivity, and null when that
   * distance is inside the near field — below 2λ — where the Friis form does not hold; see rangeInNearField).
   */
  maxRangeM: number | null;
  /** True when the Friis range at the sensitivity would be under 2λ: not a far-field distance, so not stated. */
  rangeInNearField: boolean;
  /** Each line of the budget: label and dB (gains positive, losses negative). */
  items: Array<{ label: string; db: number; unit: string }>;
}

/** Pr at distance d for the same link (dBm), the curve the figure draws. */
export function prAt(inp: LinkInput, dM: number): number {
  const lambda = C_LIGHT / inp.fHz;
  return inp.ptDbm - inp.txLossDb + inp.gtDbi - 20 * Math.log10((4 * Math.PI * dM) / lambda) - inp.otherLossDb + inp.grDbi - inp.rxLossDb;
}

export function linkBudget(inp: LinkInput): LinkResult | Err {
  const { ptDbm, gtDbi, grDbi, txLossDb, rxLossDb, otherLossDb, sensDbm } = inp;
  if (!fin(ptDbm, gtDbi, grDbi, txLossDb, rxLossDb, otherLossDb) || (sensDbm !== null && !Number.isFinite(sensDbm)))
    return err("Every level, gain and loss must be a finite number.");
  for (const [v, n] of [[ptDbm, "transmit power"], [gtDbi, "transmit antenna gain"], [grDbi, "receive antenna gain"], [txLossDb, "transmit feeder loss"], [rxLossDb, "receive feeder loss"], [otherLossDb, "other losses"]] as const)
    if (Math.abs(v) > DB_LIMIT) return err(`The ${n} (${nv(v)} dB) is beyond ±${DB_LIMIT} dB: check the entry.`);
  if (sensDbm !== null && Math.abs(sensDbm) > DB_LIMIT) return err(`The sensitivity is beyond ±${DB_LIMIT} dBm: check the entry.`);
  for (const [v, n] of [[txLossDb, "transmit feeder loss"], [rxLossDb, "receive feeder loss"], [otherLossDb, "other losses"]] as const)
    if (v < 0) return err(`The ${n} must be zero or more (a loss in dB is entered as a positive number).`);
  const p = fspl(inp.fHz, inp.dM);
  if (!p.ok) return p;
  const eirp = ptDbm - txLossDb + gtDbi;
  const pr = eirp - p.db - otherLossDb + grDbi - rxLossDb;
  const margin = sensDbm === null ? null : pr - sensDbm;
  const items = [
    { label: "Transmit power", db: ptDbm, unit: "dBm" },
    { label: "Transmit feeder loss", db: -txLossDb, unit: "dB" },
    { label: "Transmit antenna gain", db: gtDbi, unit: "dBi" },
    { label: "EIRP", db: eirp, unit: "dBm" },
    { label: "Free-space path loss", db: -p.db, unit: "dB" },
    { label: "Other losses", db: -otherLossDb, unit: "dB" },
    { label: "Receive antenna gain", db: grDbi, unit: "dBi" },
    { label: "Receive feeder loss", db: -rxLossDb, unit: "dB" },
    { label: "Received power", db: pr, unit: "dBm" },
  ];
  if (sensDbm !== null) {
    items.push({ label: "Receiver sensitivity", db: sensDbm, unit: "dBm" });
    items.push({ label: "Link margin", db: margin as number, unit: "dB" });
  }
  const rawRange = margin === null ? null : inp.dM * Math.pow(10, margin / 20);
  // The far-field rule this tool applies to the design distance (fspl: d ≥ 2λ) applies to the range too; with no
  // antenna size known, 2D²/λ cannot be checked, so 2λ is the floor.
  const rangeInNearField = rawRange !== null && rawRange < 2 * p.lambda;
  return {
    ok: true,
    lambda: p.lambda,
    fsplDb: p.db,
    eirpDbm: eirp,
    prDbm: pr,
    prW: 1e-3 * fromDb(pr),
    marginDb: margin,
    maxRangeM: rangeInNearField ? null : rawRange,
    rangeInNearField,
    items,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Noise-figure cascade
// ---------------------------------------------------------------------------------------------------------------

export interface Stage {
  gainDb: number;
  nfDb: number;
}

export interface CascadeRow {
  /** Stage number from 1. */
  n: number;
  gainDb: number;
  nfDb: number;
  /** This stage's own noise temperature T₀(F − 1), K. */
  teK: number;
  /** Gain from the input up to and including this stage, dB. */
  cumGainDb: number;
  /** Noise figure of stages 1…n, dB. */
  cumNfDb: number;
  /** This stage's added term (Fₙ − 1)/(G₁…Gₙ₋₁) in the cascade factor. */
  term: number;
}

export interface CascadeResult {
  ok: true;
  rows: CascadeRow[];
  factor: number;
  nfDb: number;
  teK: number;
  gainDb: number;
}

export function noiseCascade(stages: Stage[]): CascadeResult | Err {
  if (!stages.length) return err("Give at least one stage (gain in dB, noise figure in dB).");
  if (stages.length > MAX_STAGES) return err(`At most ${MAX_STAGES} stages.`);
  const rows: CascadeRow[] = [];
  let F = 0;
  let gLin = 1;
  let gDb = 0;
  for (let i = 0; i < stages.length; i++) {
    const { gainDb, nfDb } = stages[i];
    if (!fin(gainDb, nfDb)) return err(`Stage ${i + 1}: the gain and noise figure must be finite numbers.`);
    if (nfDb < 0) return err(`Stage ${i + 1}: a noise figure below 0 dB (F < 1) is not physical: every two-port adds noise.`);
    if (nfDb > 100) return err(`Stage ${i + 1}: a noise figure of ${nv(nfDb)} dB is beyond 100 dB: check the entry.`);
    if (Math.abs(gainDb) > 200) return err(`Stage ${i + 1}: a gain of ${nv(gainDb)} dB is beyond ±200 dB: check the entry.`);
    const Fi = fromDb(nfDb);
    const term = i === 0 ? Fi : (Fi - 1) / gLin;
    F += term;
    gLin *= fromDb(gainDb);
    gDb += gainDb;
    if (Math.abs(gDb) > CUM_GAIN_LIMIT_DB || !Number.isFinite(F))
      return err(`Up to stage ${i + 1} the chain's gain is ${gDb > 0 ? "+" : ""}${nv(gDb)} dB, beyond ±${CUM_GAIN_LIMIT_DB} dB: no receive chain has that, so check the entries.`);
    rows.push({ n: i + 1, gainDb, nfDb, teK: T0_NOISE * (Fi - 1), cumGainDb: gDb, cumNfDb: toDb(F), term });
  }
  return { ok: true, rows, factor: F, nfDb: toDb(F), teK: T0_NOISE * (F - 1), gainDb: gDb };
}

/** kTB in dBm for a temperature and bandwidth. */
export function kTBdBm(tK: number, bHz: number): number {
  // In dB as a sum, so a tiny B cannot underflow kTB to 0 (10 log₁₀ 0 = −Infinity reached the result).
  return toDb((K_BOLTZMANN * tK) / 1e-3) + toDb(bHz);
}

export interface SensitivityResult {
  ok: true;
  ktbDbm: number;
  /** Noise floor referred to the input, kTB + NF, dBm. */
  floorDbm: number;
  sensDbm: number;
}

/** Sensitivity = kT₀B + NF + required SNR (dBm) = kT₀ (dBm/Hz) + 10 log₁₀B + NF + SNR. */
export function sensitivity(nfDb: number, bHz: number, snrDb: number): SensitivityResult | Err {
  if (!fin(nfDb, bHz, snrDb)) return err("The bandwidth and SNR must be finite numbers.");
  if (!(bHz > 0)) return err("The bandwidth must be greater than zero.");
  if (bHz < 1e-6) return err("A noise bandwidth below 1 µHz is outside this tool (no receiver integrates for the ~10⁶ s it implies): check the unit.");
  if (bHz > 1e13) return err("A noise bandwidth above 10 THz is outside this tool (the kTB noise model is classical; above about kT/h it does not hold).");
  if (Math.abs(snrDb) > 100) return err("The required SNR is beyond ±100 dB: check the entry.");
  const ktb = kTBdBm(T0_NOISE, bHz);
  return { ok: true, ktbDbm: ktb, floorDbm: ktb + nfDb, sensDbm: ktb + nfDb + snrDb };
}

// ---------------------------------------------------------------------------------------------------------------
// Eb/N0 ↔ BER
// ---------------------------------------------------------------------------------------------------------------

export type Modulation = "bpsk" | "qpsk" | "dbpsk" | "8psk" | "16psk";

export const MODULATIONS: Array<{ id: Modulation; label: string; bits: number; approx: boolean }> = [
  { id: "bpsk", label: "BPSK (coherent)", bits: 1, approx: false },
  { id: "qpsk", label: "QPSK (coherent, Gray coded)", bits: 2, approx: false },
  { id: "dbpsk", label: "DBPSK (differential detection)", bits: 1, approx: false },
  { id: "8psk", label: "8-PSK (Gray coded, high-SNR approximation)", bits: 3, approx: true },
  { id: "16psk", label: "16-PSK (Gray coded, high-SNR approximation)", bits: 4, approx: true },
];

/** erfc to full precision across the range (probdist.ts's continued fraction in the tail). */
export function erfc(x: number): number {
  if (x >= 2.5) return erfcPrecise(x);
  return 1 - erfPrecise(x);
}
/** Gaussian tail Q(x) = ½ erfc(x/√2). */
const qfunc = (x: number): number => 0.5 * erfc(x / Math.SQRT2);

/** The largest Pb at which an approximate curve is used (it was checked against simulation up to here). */
export const APPROX_MAX_BER = 0.1;
/** Smallest BER accepted as a target. */
const MIN_TARGET_BER = 1e-15;
/** Eb/N0 search interval, dB. */
const EBN0_LO = -10;
const EBN0_HI = 40;

/** Bit error probability at Eb/N0 given in dB (the figure's curve). */
export function berOfDb(mod: Modulation, ebn0Db: number): number {
  return berLinear(mod, fromDb(ebn0Db));
}

/** A data rate in dB (10 log₁₀ Rb, Rb in bit/s), and a power in W as dBm. */
export const rateDb = (rateBps: number): number => toDb(rateBps);
export const wattsToDbm = (w: number): number => toDb(w / 1e-3);

/** Bit error probability at Eb/N0 (linear). */
export function berLinear(mod: Modulation, g: number): number {
  switch (mod) {
    case "bpsk":
    case "qpsk":
      return 0.5 * erfc(Math.sqrt(g));
    case "dbpsk":
      return 0.5 * Math.exp(-g);
    case "8psk":
    case "16psk": {
      const M = mod === "8psk" ? 8 : 16;
      const k = Math.log2(M);
      return (2 * qfunc(Math.sqrt(2 * k * g) * Math.sin(Math.PI / M))) / k;
    }
  }
}

export interface BerResult {
  ok: true;
  ber: number;
  ebn0Db: number;
  esn0Db: number;
  /** True when the curve is an approximation and this point is outside where it was checked (Pb > 10⁻¹). */
  outsideApprox: boolean;
}

export function berAt(mod: Modulation, ebn0Db: number): BerResult | Err {
  if (!Number.isFinite(ebn0Db)) return err("Eb/N₀ must be a finite number of dB.");
  if (ebn0Db < EBN0_LO || ebn0Db > EBN0_HI) return err(`Eb/N₀ must be from ${EBN0_LO} dB to ${EBN0_HI} dB.`);
  const m = MODULATIONS.find((x) => x.id === mod);
  if (!m) return err("Choose a modulation.");
  const ber = berLinear(mod, fromDb(ebn0Db));
  return { ok: true, ber, ebn0Db, esn0Db: ebn0Db + toDb(m.bits), outsideApprox: m.approx && ber > APPROX_MAX_BER };
}

/** The Eb/N0 (dB) at which the BER equals `target`: bisection on the monotone curve, at most 200 halvings. */
export function requiredEbN0(mod: Modulation, target: number): { ok: true; ebn0Db: number; esn0Db: number; iterations: number } | Err {
  const m = MODULATIONS.find((x) => x.id === mod);
  if (!m) return err("Choose a modulation.");
  if (!Number.isFinite(target) || !(target > 0)) return err("The target BER must be a number greater than zero.");
  if (target < MIN_TARGET_BER) return err("The target BER must be at least 10⁻¹⁵ (below that the result is not meaningful in double precision).");
  const cap = m.approx ? APPROX_MAX_BER : berLinear(mod, fromDb(EBN0_LO));
  if (target >= cap)
    return m.approx
      ? err(`The target BER must be below 10⁻¹ for ${m.label}: the approximation was checked only for Pb ≤ 10⁻¹.`)
      : err(`The target BER must be below ${fmtSig(cap, 3)}, the BER of ${m.label} at ${EBN0_LO} dB.`);
  let lo = EBN0_LO;
  let hi = EBN0_HI;
  if (berLinear(mod, fromDb(hi)) > target) return err(`The target BER is not reached below ${EBN0_HI} dB.`);
  let it = 0;
  // Compare in log BER so the bracket closes evenly across decades.
  const lt = Math.log(target);
  for (; it < 200 && hi - lo > 1e-12; it++) {
    const mid = (lo + hi) / 2;
    const b = berLinear(mod, fromDb(mid));
    if (b > 0 && Math.log(b) > lt) lo = mid;
    else hi = mid;
  }
  const e = (lo + hi) / 2;
  return { ok: true, ebn0Db: e, esn0Db: e + toDb(m.bits), iterations: it };
}

/** Eb/N0 (dB) = C/N0 (dB-Hz) − 10 log₁₀ Rb. */
export function ebn0FromCn0(cn0DbHz: number, rateBps: number): number {
  return cn0DbHz - toDb(rateBps);
}
/** C/N0 (dB-Hz) = Eb/N0 (dB) + 10 log₁₀ Rb. */
export function cn0FromEbn0(ebn0Db: number, rateBps: number): number {
  return ebn0Db + toDb(rateBps);
}
