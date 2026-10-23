// Transmission lines, impedance matching and two-port S-parameters (Release E3-e, gap #15). Pure functions, no pane.
//
// Every line here is LOSSLESS with a REAL characteristic impedance Z₀ (TEM, a single propagating mode). Positions on a
// line are measured from the load toward the generator, in wavelengths. The reflection coefficient is
// Γ = (Z_L − Z₀)/(Z_L + Z₀), and moving a distance d toward the generator rotates it clockwise: Γ(d) = Γ_L e^(−j4πd/λ).
// Input impedances are computed from that rotated Γ rather than from the tan form, so an open load or a line at a pole
// of tan βℓ is ordinary arithmetic rather than a division by zero.
//
// Z₀ from geometry, both checked against the scikit-rf 2.2.0 source (skrf/media), which is also the test oracle:
//   - coaxial (skrf/media/coaxial.py): L′ = μ/(2π) ln(b/a) and C′ = 2πε/ln(b/a), so the lossless
//     Z₀ = √(L′/C′) = (η₀/(2π√εᵣ)) ln(D/d) for inner diameter d, outer (shield inner) diameter D, μᵣ = 1;
//   - microstrip (skrf/media/mline.py, model "hammerstadjensen", t = None, disp "none"): the quasi-static
//     Hammerstad–Jensen equations (E. Hammerstad and Ø. Jensen, "Accurate Models for Microstrip Computer-Aided
//     Design", IEEE MTT-S Symposium, pp. 407–409, 1980) with ZERO strip thickness and no frequency dispersion:
//       u = w/h, f(u) = 6 + (2π − 6) exp(−(30.666/u)^0.7528),
//       Z_air = (η₀/2π) ln(f(u)/u + √(1 + (2/u)²)),
//       a = 1 + ln((u⁴ + (u/52)²)/(u⁴ + 0.432))/49 + ln(1 + (u/18.1)³)/18.7, b = 0.564((εᵣ − 0.9)/(εᵣ + 3))^0.053,
//       ε_eff = (εᵣ + 1)/2 + ((εᵣ − 1)/2)(1 + 10/u)^(−ab), Z₀ = Z_air/√ε_eff.
//     The quasi-static value is the zero-frequency one (skrf's own docstring); dispersion raises ε_eff with frequency.

/** A complex number. */
export interface Cx {
  re: number;
  im: number;
}

export const C_LIGHT = 299792458;
/** CODATA 2022 (the values scipy.constants carries in the oracle venv): μ₀ and ε₀. */
export const MU0 = 1.25663706127e-6;
export const EPS0 = 8.8541878188e-12;
/** The impedance of free space √(μ₀/ε₀), Ω. */
export const ETA0 = Math.sqrt(MU0 / EPS0);

/** The longest line accepted, in wavelengths (the rotation is reduced modulo λ/2 first; this bounds the turn count). */
export const MAX_TURNS = 1e6;
/** |Γ| below this is a matched load (Γ = 0). */
const MATCH_EPS = 1e-12;
/** |Γ| above 1 − this is total reflection (a lossless reactance, an open or a short). */
const TOTAL_EPS = 1e-12;

export type Fail = { ok: false; error: string };

// ---------------------------------------------------------------------------------------------------------------
// Complex helpers
// ---------------------------------------------------------------------------------------------------------------

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cAdd = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
export const cSub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
export const cMul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
/** Smith's algorithm: no overflow for large |b|. */
export function cDiv(a: Cx, b: Cx): Cx {
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re, d = b.re + b.im * r;
    return cx((a.re + a.im * r) / d, (a.im - a.re * r) / d);
  }
  const r = b.re / b.im, d = b.re * r + b.im;
  return cx((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}
export const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);
export const cArgDeg = (a: Cx): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
export const cPolar = (mag: number, deg: number): Cx => cx(mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180));
export const cConj = (a: Cx): Cx => cx(a.re, -a.im);
const cExpJ = (theta: number): Cx => cx(Math.cos(theta), Math.sin(theta));

const finite = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

// ---------------------------------------------------------------------------------------------------------------
// Characteristic impedance from geometry
// ---------------------------------------------------------------------------------------------------------------

export interface Z0Geometry {
  ok: true;
  z0: number;
  /** The relative permittivity a wave sees: εᵣ for coax, ε_eff for microstrip. */
  epsEff: number;
  /** The velocity factor 1/√ε_eff. */
  vf: number;
}

/** Coaxial line: inner conductor diameter d, outer (shield inner) diameter D, dielectric εᵣ (μᵣ = 1). */
export function coaxZ0(dInner: number, dOuter: number, epsR: number): Z0Geometry | Fail {
  if (!finite(dInner, dOuter, epsR)) return { ok: false, error: "Coax geometry: every value must be a finite number." };
  if (!(dInner > 0)) return { ok: false, error: "Coax: the inner conductor diameter must be greater than zero." };
  if (!(dOuter > dInner)) return { ok: false, error: "Coax: the outer diameter (the shield's inner diameter) must be larger than the inner conductor's diameter." };
  if (!(epsR >= 1) || epsR > 1000) return { ok: false, error: "Coax: the dielectric's relative permittivity εᵣ must be between 1 (air) and 1000." };
  const z0 = (ETA0 / (2 * Math.PI * Math.sqrt(epsR))) * Math.log(dOuter / dInner);
  return { ok: true, z0, epsEff: epsR, vf: 1 / Math.sqrt(epsR) };
}

/** The accepted w/h range for the microstrip equations (a refusal range, not an accuracy claim). */
export const MS_U_MIN = 0.01;
export const MS_U_MAX = 100;
export const MS_ER_MAX = 128;

/** Microstrip, quasi-static Hammerstad–Jensen with zero strip thickness: strip width w over a substrate of height h. */
export function microstripZ0(w: number, h: number, epsR: number): Z0Geometry | Fail {
  if (!finite(w, h, epsR)) return { ok: false, error: "Microstrip geometry: every value must be a finite number." };
  if (!(w > 0) || !(h > 0)) return { ok: false, error: "Microstrip: the strip width and the substrate height must both be greater than zero." };
  if (!(epsR >= 1) || epsR > MS_ER_MAX) return { ok: false, error: `Microstrip: the substrate's relative permittivity εᵣ must be between 1 and ${MS_ER_MAX}.` };
  const u = w / h;
  if (u < MS_U_MIN || u > MS_U_MAX)
    return { ok: false, error: `Microstrip: w/h = ${u.toPrecision(3)} is outside the range this tool accepts for the Hammerstad–Jensen equations (0.01 to 100).` };
  const fu = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528));
  const zAir = (ETA0 / (2 * Math.PI)) * Math.log(fu / u + Math.sqrt(1 + (2 / u) ** 2));
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7;
  const b = 0.564 * Math.pow((epsR - 0.9) / (epsR + 3), 0.053);
  const epsEff = (epsR + 1) / 2 + ((epsR - 1) / 2) * Math.pow(1 + 10 / u, -a * b);
  return { ok: true, z0: zAir / Math.sqrt(epsEff), epsEff, vf: 1 / Math.sqrt(epsEff) };
}

// ---------------------------------------------------------------------------------------------------------------
// Reflection at a termination
// ---------------------------------------------------------------------------------------------------------------

export type Load = { kind: "z"; z: Cx } | { kind: "open" } | { kind: "short" };

export interface Reflection {
  ok: true;
  gamma: Cx;
  mag: number;
  angleDeg: number;
  /** null when |Γ| = 1 (unbounded). */
  vswr: number | null;
  /** Return loss −20 log₁₀|Γ| (dB); null for a matched load (unbounded). */
  rlDb: number | null;
  /** Mismatch loss −10 log₁₀(1 − |Γ|²) (dB); null at total reflection (unbounded). */
  mlDb: number | null;
  /** Fraction of the incident power delivered to the load, 1 − |Γ|². */
  delivered: number;
  matched: boolean;
  total: boolean;
}

/** Checks Z₀ (real, positive, finite). */
function checkZ0(z0: number): Fail | null {
  if (!Number.isFinite(z0) || !(z0 > 0)) return { ok: false, error: "Z₀ must be a finite characteristic impedance greater than zero (a lossless line has a real Z₀)." };
  if (z0 > 1e9 || z0 < 1e-9) return { ok: false, error: "Z₀ must lie between 10⁻⁹ Ω and 10⁹ Ω." };
  return null;
}

/** Γ of a load on a line of characteristic impedance z0. A load with negative resistance is refused (it is active). */
export function reflection(load: Load, z0: number): Reflection | Fail {
  const bad = checkZ0(z0);
  if (bad) return bad;
  let g: Cx;
  if (load.kind === "open") g = cx(1, 0);
  else if (load.kind === "short") g = cx(-1, 0);
  else {
    const { re, im } = load.z;
    if (!finite(re, im)) return { ok: false, error: "The load impedance must be finite (choose the open-circuit termination for an open end)." };
    if (re < 0) return { ok: false, error: "The load resistance is negative: that load is active (|Γ| > 1), and this tool treats passive loads only." };
    if (Math.abs(re) > 1e12 * z0 || Math.abs(im) > 1e12 * z0) return { ok: false, error: "The load impedance is more than 10¹² times Z₀: choose the open-circuit termination instead." };
    g = cDiv(cSub(load.z, cx(z0)), cAdd(load.z, cx(z0)));
  }
  let mag = cAbs(g);
  const matched = mag < MATCH_EPS;
  const total = mag > 1 - TOTAL_EPS;
  if (matched) {
    g = cx(0, 0);
    mag = 0;
  }
  if (total) {
    // A lossless reactance: |Γ| is exactly 1; the rounding residue is removed so VSWR is not a huge finite number.
    g = cx(g.re / mag, g.im / mag);
    mag = 1;
  }
  return {
    ok: true,
    gamma: g,
    mag,
    angleDeg: matched ? 0 : cArgDeg(g),
    vswr: total ? null : (1 + mag) / (1 - mag),
    rlDb: matched ? null : -20 * Math.log10(mag),
    mlDb: total ? null : -10 * Math.log10(1 - mag * mag),
    delivered: 1 - mag * mag,
    matched,
    total,
  };
}

/** Γ → Z on a line of characteristic impedance z0; null when Γ = 1 (an open circuit, |Z| unbounded). */
export function zOfGamma(g: Cx, z0: number): Cx | null {
  const den = cSub(cx(1), g);
  if (cAbs(den) < 1e-12) return null;
  return cMul(cx(z0), cDiv(cAdd(cx(1), g), den));
}

/** Γ rotated toward the generator by `turns` wavelengths: Γ e^(−j4π·turns). */
export function rotate(g: Cx, turns: number): Cx {
  const frac = turns - 0.5 * Math.floor(turns / 0.5);
  return cMul(g, cExpJ(-4 * Math.PI * frac));
}

export interface InputImpedance {
  ok: true;
  gammaIn: Cx;
  /** null for an open circuit at the input (Γ_in = 1). */
  zin: Cx | null;
  /** The length reduced modulo λ/2 (the input impedance repeats every half wavelength), in wavelengths. */
  reduced: number;
  /** Whole half-wavelengths removed by that reduction. */
  halfWaves: number;
}

/** The input impedance of a lossless line `turns` wavelengths long terminated in a load with reflection gammaL. */
export function inputImpedance(gammaL: Cx, z0: number, turns: number): InputImpedance | Fail {
  const bad = checkZ0(z0);
  if (bad) return bad;
  if (!Number.isFinite(turns) || turns < 0) return { ok: false, error: "The line length must be a finite number, zero or more." };
  if (turns > MAX_TURNS) return { ok: false, error: "The line is longer than 10⁶ wavelengths; this tool refuses it (a lossless model of a line that long is not meaningful)." };
  // A length within rounding of a whole number of half wavelengths reduces to exactly zero.
  const halfWaves = Math.floor(turns * 2 + 1e-9);
  const reduced = Math.max(0, turns - 0.5 * halfWaves);
  const gin = rotate(gammaL, reduced);
  return { ok: true, gammaIn: gin, zin: zOfGamma(gin, z0), reduced, halfWaves };
}

// ---------------------------------------------------------------------------------------------------------------
// Matching: quarter-wave transformer and single shunt stub
// ---------------------------------------------------------------------------------------------------------------

/** The load must be passive, not matched and not a pure reactance for a lossless match to exist. */
function matchable(r: Reflection): Fail | null {
  if (r.matched) return { ok: false, error: "The load is already matched (Γ = 0): no matching section is needed." };
  if (r.total) return { ok: false, error: "The load is a pure reactance (or an open or a short), |Γ| = 1: no lossless matching network can deliver power to a load that absorbs none." };
  return null;
}

export interface QuarterWaveSolution {
  /** Distance from the load to the transformer, wavelengths (0 for a resistive load at the near solution). */
  dLambda: number;
  /** The (real) impedance seen on the Z₀ line at that point: Z₀·VSWR at a voltage maximum, Z₀/VSWR at a minimum. */
  rAt: number;
  /** The quarter-wave section's characteristic impedance √(Z₀·R). */
  zt: number;
  at: "max" | "min";
}

/**
 * Quarter-wave transformers: the section goes where the line impedance is real — at a voltage maximum (R = Z₀·VSWR)
 * or minimum (R = Z₀/VSWR); for a resistive load one of these is at the load itself. Both, nearer first.
 */
export function quarterWave(r: Reflection, z0: number): { ok: true; solutions: QuarterWaveSolution[] } | Fail {
  const bad = checkZ0(z0) ?? matchable(r);
  if (bad) return bad;
  const s = r.vswr as number;
  let theta = Math.atan2(r.gamma.im, r.gamma.re);
  if (theta < 0) theta += 2 * Math.PI;
  // A resistive load has θ within rounding of 0 or π; snap so its solution sits exactly at the load.
  if (Math.abs(r.gamma.im) <= 1e-14 * r.mag) theta = r.gamma.re > 0 ? 0 : Math.PI;
  let dMax = theta / (4 * Math.PI);
  if (dMax >= 0.5 - 1e-15) dMax = 0;
  const dMin = (dMax + 0.25) % 0.5;
  const sols: QuarterWaveSolution[] = [
    { dLambda: dMax, rAt: z0 * s, zt: z0 * Math.sqrt(s), at: "max" },
    { dLambda: dMin, rAt: z0 / s, zt: z0 / Math.sqrt(s), at: "min" },
  ];
  sols.sort((a, b) => a.dLambda - b.dLambda);
  return { ok: true, solutions: sols };
}

export type StubKind = "open" | "short";

export interface StubSolution {
  /** Distance from the load to the stub, wavelengths, in [0, 0.5). */
  dLambda: number;
  /** Normalised susceptance of the line at d (y = 1 + jb there). */
  b: number;
  /** Stub length, wavelengths, in (0, 0.5). */
  lLambda: number;
}

/**
 * The single shunt stub: the two points within half a wavelength of the load where the line's normalised admittance
 * is 1 + jb (|Γ(d)| = ρ meets the g = 1 circle where Re Γ = −ρ²), and the stub that cancels jb. Nearer first.
 */
export function singleStub(r: Reflection, z0: number, kind: StubKind): { ok: true; solutions: StubSolution[] } | Fail {
  const bad = checkZ0(z0) ?? matchable(r);
  if (bad) return bad;
  const rho = r.mag;
  const phiL = Math.atan2(r.gamma.im, r.gamma.re);
  const phi0 = Math.acos(-rho); // Γ(d) = ρ e^(±jφ0), cos φ0 = −ρ
  const sols: StubSolution[] = [];
  for (const phi of [phi0, -phi0]) {
    let d = (phiL - phi) / (4 * Math.PI);
    d -= 0.5 * Math.floor(d / 0.5);
    if (d >= 0.5 - 1e-15) d = 0;
    const gd = rotate(r.gamma, d);
    const y = cDiv(cSub(cx(1), gd), cAdd(cx(1), gd));
    const b = y.im;
    let l: number;
    if (kind === "open") {
      // Open stub: y_stub = j tan βℓ = −jb.
      l = Math.atan(-b) / (2 * Math.PI);
      if (l < 0) l += 0.5;
    } else {
      // Shorted stub: y_stub = −j cot βℓ = −jb, so cot βℓ = b.
      l = Math.atan2(1, b) / (2 * Math.PI);
    }
    // Self-check: the line admittance plus the stub's is the matched y = 1.
    const yStub = kind === "open" ? cx(0, Math.tan(2 * Math.PI * l)) : cx(0, -1 / Math.tan(2 * Math.PI * l));
    const yT = cAdd(y, yStub);
    if (!(Math.abs(yT.re - 1) < 1e-7 * Math.max(1, Math.abs(b)) && Math.abs(yT.im) < 1e-7 * Math.max(1, Math.abs(b))))
      return { ok: false, error: "The stub solution failed its own check (the matched admittance is not 1); this load is too close to |Γ| = 1 to match reliably." };
    sols.push({ dLambda: d, b, lLambda: l });
  }
  sols.sort((a, b) => a.dLambda - b.dLambda);
  return { ok: true, solutions: sols };
}

/** Γ at the input of a quarter-wave match at frequency ratio F = f/f₀ (electrical lengths scale with F; load held constant). */
export function quarterWaveGammaAt(gammaL: Cx, z0: number, s: QuarterWaveSolution, F: number): Cx {
  const zd = zOfGamma(rotate(gammaL, s.dLambda * F), z0);
  if (zd === null) return cx(1, 0);
  const gt = cDiv(cSub(zd, cx(s.zt)), cAdd(zd, cx(s.zt)));
  const zin = zOfGamma(rotate(gt, 0.25 * F), s.zt);
  if (zin === null) return cx(1, 0);
  return cDiv(cSub(zin, cx(z0)), cAdd(zin, cx(z0)));
}

/** Γ at the input of a single-stub match at frequency ratio F = f/f₀ (load held constant). */
export function stubGammaAt(gammaL: Cx, kind: StubKind, s: StubSolution, F: number): Cx {
  const gd = rotate(gammaL, s.dLambda * F);
  const den = cAdd(cx(1), gd);
  if (cAbs(den) < 1e-15) return cx(-1, 0); // a short across the junction
  const y = cDiv(cSub(cx(1), gd), den);
  const t = Math.tan(2 * Math.PI * s.lLambda * F);
  let yStub: Cx;
  if (kind === "open") yStub = cx(0, t);
  else {
    if (Math.abs(t) < 1e-15) return cx(-1, 0); // the shorted stub is a short at this frequency
    yStub = cx(0, -1 / t);
  }
  const yT = cAdd(y, yStub);
  return cDiv(cSub(cx(1), yT), cAdd(cx(1), yT));
}

/**
 * The band around f₀ in which |Γ_in(F)| ≤ gmax, as F = f/f₀ edges, scanning F in [FMIN, FMAX] (step 0.0005, then
 * bisection). An edge not reached inside the scan is null.
 */
export const BW_FMIN = 0.02;
export const BW_FMAX = 1.98;
export function bandEdges(gOfF: (F: number) => Cx, gmax: number): { lo: number | null; hi: number | null } {
  const over = (F: number): boolean => cAbs(gOfF(F)) > gmax;
  const edge = (dir: 1 | -1): number | null => {
    const step = 0.0005;
    let prev = 1;
    for (let i = 1; i <= 2000; i++) {
      const F = 1 + dir * step * i;
      if (F < BW_FMIN || F > BW_FMAX) return null;
      if (over(F)) {
        let a = prev, b = F;
        for (let k = 0; k < 60; k++) {
          const m = (a + b) / 2;
          if (over(m)) b = m;
          else a = m;
        }
        return (a + b) / 2;
      }
      prev = F;
    }
    return null;
  };
  return { lo: edge(-1), hi: edge(1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Two-port S-parameters
// ---------------------------------------------------------------------------------------------------------------

/** Reciprocity tolerance: |S₁₂ − S₂₁| ≤ this × max(|S₁₂|, |S₂₁|). */
export const RECIP_TOL = 0.005;
/** Losslessness tolerance: every entry of SᴴS − I within this. */
export const LOSSLESS_TOL = 0.01;
/** The largest |Sij| accepted (120 dB of gain). */
export const S_MAX = 1e6;

export interface TwoPortResult {
  ok: true;
  s11: Cx;
  s21: Cx;
  s12: Cx;
  s22: Cx;
  /** 20 log₁₀|Sij| (dB); null for a zero entry. */
  dB: { s11: number | null; s21: number | null; s12: number | null; s22: number | null };
  /** Input / output return loss −20 log₁₀|S₁₁|, −20 log₁₀|S₂₂|; null for a zero entry (unbounded). */
  rlIn: number | null;
  rlOut: number | null;
  /** Insertion loss −20 log₁₀|S₂₁| (negative = gain); null when S₂₁ = 0. */
  il: number | null;
  /** Reverse isolation −20 log₁₀|S₁₂|; null when S₁₂ = 0 (unbounded). */
  iso: number | null;
  /** VSWR at each port with the other matched; null when |Sii| ≥ 1. */
  vswrIn: number | null;
  vswrOut: number | null;
  reciprocal: boolean;
  recipDev: number;
  lossless: boolean;
  losslessDev: number;
  /** 1 − |S₁₁|² − |S₂₁|² and 1 − |S₁₂|² − |S₂₂|²: the fraction of power into each port that is dissipated (negative = gain). */
  dissipated1: number;
  dissipated2: number;
  /** The largest eigenvalue of SᴴS: ≤ 1 for a passive network. */
  maxGain: number;
  passive: boolean;
  delta: Cx;
  deltaMag: number;
  /** Rollett K; null when S₁₂S₂₁ = 0. */
  K: number | null;
  stability: "passive" | "unconditional" | "potential";
  /** G_TU,max and its factors (linear); null when |S₁₁| ≥ 1 or |S₂₂| ≥ 1. */
  gtu: null | { gs: number; g0: number; gl: number; total: number };
  /** Unilateral figure of merit and the bounds it puts on G_T/G_TU (dB); null when G_TU,max is null or U ≥ 1. */
  unilateral: null | { U: number; loDb: number; hiDb: number };
}

const db20 = (m: number): number | null => (m > 0 ? 20 * Math.log10(m) : null);

/** Analyses a two-port from its four S-parameters (all referred to the same real Z₀). */
export function twoPort(s11: Cx, s21: Cx, s12: Cx, s22: Cx): TwoPortResult | Fail {
  for (const [n, v] of [["S₁₁", s11], ["S₂₁", s21], ["S₁₂", s12], ["S₂₂", s22]] as const) {
    if (!finite(v.re, v.im)) return { ok: false, error: `${n} must be finite.` };
    if (cAbs(v) > S_MAX) return { ok: false, error: `|${n}| is larger than 10⁶ (120 dB); this tool refuses it.` };
  }
  const m11 = cAbs(s11), m21 = cAbs(s21), m12 = cAbs(s12), m22 = cAbs(s22);
  const dB = { s11: db20(m11), s21: db20(m21), s12: db20(m12), s22: db20(m22) };
  const neg = (v: number | null): number | null => (v === null ? null : -v);
  const vswr = (m: number): number | null => (m < 1 ? (1 + m) / (1 - m) : null);
  const recipScale = Math.max(m12, m21);
  const recipDev = recipScale > 0 ? cAbs(cSub(s12, s21)) / recipScale : 0;
  // SᴴS (Hermitian): diagonal |S11|²+|S21|², |S12|²+|S22|²; off-diagonal conj(S11)S12 + conj(S21)S22.
  const p11 = m11 * m11 + m21 * m21;
  const p22 = m12 * m12 + m22 * m22;
  const off = cAdd(cMul(cConj(s11), s12), cMul(cConj(s21), s22));
  const losslessDev = Math.max(Math.abs(p11 - 1), Math.abs(p22 - 1), cAbs(off));
  const tr = p11 + p22, det = p11 * p22 - cAbs(off) ** 2;
  const maxGain = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lossless = losslessDev <= LOSSLESS_TOL;
  // Passive only when no direction gains power beyond rounding: a 'lossless within 1 %' network may still be
  // slightly active, so it is not called passive and the K–Δ test decides.
  const passive = maxGain <= 1 + 1e-6;
  const delta = cSub(cMul(s11, s22), cMul(s12, s21));
  const deltaMag = cAbs(delta);
  const denom = 2 * m12 * m21;
  const K = denom > 0 ? (1 - m11 * m11 - m22 * m22 + deltaMag * deltaMag) / denom : null;
  let stability: TwoPortResult["stability"];
  if (passive) stability = "passive";
  else if (K === null) stability = m11 < 1 && m22 < 1 ? "unconditional" : "potential";
  else stability = K > 1 && deltaMag < 1 ? "unconditional" : "potential";
  let gtu: TwoPortResult["gtu"] = null;
  let unilateral: TwoPortResult["unilateral"] = null;
  if (m11 < 1 && m22 < 1) {
    const gs = 1 / (1 - m11 * m11), gl = 1 / (1 - m22 * m22), g0 = m21 * m21;
    gtu = { gs, g0, gl, total: gs * g0 * gl };
    const U = m12 * m21 * m11 * m22 * gs * gl;
    if (U < 1) unilateral = { U, loDb: -20 * Math.log10(1 + U), hiDb: -20 * Math.log10(1 - U) };
  }
  return {
    ok: true,
    s11, s21, s12, s22,
    dB,
    rlIn: neg(dB.s11),
    rlOut: neg(dB.s22),
    il: neg(dB.s21),
    iso: neg(dB.s12),
    vswrIn: vswr(m11),
    vswrOut: vswr(m22),
    reciprocal: recipDev <= RECIP_TOL,
    recipDev,
    lossless,
    losslessDev,
    dissipated1: 1 - p11,
    dissipated2: 1 - p22,
    maxGain,
    passive,
    delta,
    deltaMag,
    K,
    stability,
    gtu,
    unilateral,
  };
}
