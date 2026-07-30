// Optics and photonics — Gaussian beams, ray matrices, resonators, pulses,
// diffraction, refraction and fibres.
//
// WHAT IS AND IS NOT HERE, AND WHY
//
// Everything in this file is COMPUTED from first principles and from the four
// exact SI defining constants below. There is no refractive-index database and
// there are no Sellmeier coefficients, deliberately: n is dispersive, and a table
// of it reconstructed from recollection would be unverifiable in exactly the way
// the steam tables were judged to be (see thermo.ts, which takes enthalpies from
// the user's own tables for the same reason). Every function that needs an index
// takes it as an argument and says so.
//
// THE FACTOR-OF-TWO FAMILY is the thing that makes optics formulas go quietly
// wrong, so each one is named explicitly at the point it is used rather than left
// to the caller's assumption:
//   - divergence is reported as a HALF-angle, and the full angle is given too;
//   - beam radius w is the 1/e^2 IRRADIANCE radius, not the 1/e field radius and
//     not a diameter;
//   - peak fluence of a Gaussian is 2E/(pi w^2), twice the energy-over-area value
//     a reader is likely to compute by hand;
//   - peak power of a Gaussian pulse is 0.94 E/tau_FWHM, not E/tau.
// A wrong choice in any of these produces a plausible number and no error, which
// is the failure mode that survives a green test suite.

/** Speed of light in vacuum, m/s — exact by SI definition. */
export const C_LIGHT = 299792458;
/** Planck constant, J*s — exact by SI definition. */
export const H_PLANCK = 6.62607015e-34;
/** Elementary charge, C — exact by SI definition. */
export const E_CHARGE = 1.602176634e-19;

/** Every quantity a photon's energy can be expressed as. */
export type PhotonUnit = "nm" | "um" | "THz" | "eV" | "cm-1" | "J";

export interface PhotonResult {
  wavelengthNm: number;
  frequencyTHz: number;
  energyEv: number;
  energyJ: number;
  wavenumberCm: number;
  notes: string[];
}

/**
 * The photon relations, from one known quantity.
 *
 * This is NOT a unit conversion and is deliberately not in units.ts: nm and eV
 * measure different quantities and are related by E = hc/lambda, which is not a
 * scale factor. The converter's contract is that a unit of the wrong quantity is
 * refused, and teaching it a nonlinear special case would break that guarantee
 * for every other pair.
 *
 * `n` is the refractive index of the medium the WAVELENGTH is measured in;
 * frequency and energy are properties of the photon and do not change with it.
 * Returns null for a non-finite or non-positive input, which every one of these
 * quantities must be.
 */
export function photonRelations(value: number, unit: PhotonUnit, n = 1): PhotonResult | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(n) || n <= 0) return null;

  const notes: string[] = [];
  // Resolve everything through the vacuum wavelength.
  let lambdaVacM: number;
  switch (unit) {
    case "nm":
      lambdaVacM = value * 1e-9 * n;
      break;
    case "um":
      lambdaVacM = value * 1e-6 * n;
      break;
    case "THz":
      lambdaVacM = C_LIGHT / (value * 1e12);
      break;
    case "eV":
      lambdaVacM = (H_PLANCK * C_LIGHT) / (value * E_CHARGE);
      break;
    case "J":
      lambdaVacM = (H_PLANCK * C_LIGHT) / value;
      break;
    case "cm-1":
      // A wavenumber is defined in vacuum: 1 cm^-1 = 100 m^-1.
      lambdaVacM = 1 / (value * 100);
      break;
    default:
      return null;
  }
  if (!Number.isFinite(lambdaVacM) || lambdaVacM <= 0) return null;

  if (n !== 1) {
    notes.push(
      "The wavelength shown is the VACUUM wavelength. In a medium of index " +
        `${n} the wavelength is ${(((lambdaVacM / n) * 1e9)).toPrecision(6)} nm, while the ` +
        "frequency and the photon energy are unchanged — they are properties of the photon, " +
        "not of the medium.",
    );
  }

  const energyJ = (H_PLANCK * C_LIGHT) / lambdaVacM;
  return {
    wavelengthNm: lambdaVacM * 1e9,
    frequencyTHz: C_LIGHT / lambdaVacM / 1e12,
    energyEv: energyJ / E_CHARGE,
    energyJ,
    wavenumberCm: 1 / (lambdaVacM * 100),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Gaussian beams
// ---------------------------------------------------------------------------

export interface GaussianInput {
  /** Waist RADIUS at 1/e^2 of peak irradiance, in metres. */
  w0: number;
  /** Vacuum wavelength, metres. */
  lambda: number;
  /** Beam quality. 1 is the diffraction limit; a real beam is >= 1. */
  m2?: number;
  /** Distance from the waist, metres, at which w and R are reported. */
  z?: number;
  /** Refractive index of the propagation medium. */
  n?: number;
}

export interface GaussianResult {
  rayleighM: number;
  /** Far-field divergence HALF-angle, radians. */
  thetaHalfRad: number;
  /** Radius at z, metres. */
  wAtZ: number;
  /** Wavefront radius of curvature at z, metres; Infinity at the waist. */
  rAtZ: number;
  /** Beam parameter product w0 * theta_half, m*rad. */
  bpp: number;
  /** Gouy phase at z, radians. */
  gouyRad: number;
  /** Depth of focus, 2 * z_R. */
  confocalM: number;
  notes: string[];
}

/**
 * Gaussian beam propagation.
 *
 * Sign and factor conventions, stated because they are the whole difficulty:
 *   w0 and w are 1/e^2 IRRADIANCE RADII (not diameters, not 1/e field radii);
 *   theta is the far-field HALF-angle;
 *   z_R = pi w0^2 / (M^2 lambda), so an M^2 > 1 beam has a SHORTER Rayleigh range
 *   and diverges faster for the same waist — which is the physical content of M^2.
 */
export function gaussianBeam(inp: GaussianInput): GaussianResult | null {
  const { w0, lambda } = inp;
  const m2 = inp.m2 ?? 1;
  const z = inp.z ?? 0;
  const n = inp.n ?? 1;
  if (![w0, lambda, m2, z, n].every((v) => Number.isFinite(v))) return null;
  if (w0 <= 0 || lambda <= 0 || n <= 0) return null;
  if (m2 < 1) return null; // M^2 < 1 is unphysical: nothing beats the diffraction limit.

  const notes: string[] = [];
  // The wavelength in the medium is what sets the diffraction.
  const lam = lambda / n;
  const zR = (Math.PI * w0 * w0) / (m2 * lam);
  const thetaHalf = (m2 * lam) / (Math.PI * w0);
  const wAtZ = w0 * Math.sqrt(1 + (z / zR) ** 2);
  // R -> Infinity at the waist: the wavefront is flat there, and 1/R = 0 is the
  // value the q-parameter actually needs, so Infinity is correct rather than a
  // division-by-zero to be guarded away.
  const rAtZ = z === 0 ? Infinity : z * (1 + (zR / z) ** 2);

  if (m2 > 1) {
    notes.push(
      `M^2 = ${m2}: the Rayleigh range is ${m2} times shorter and the divergence ${m2} times ` +
        "larger than a diffraction-limited beam of the same waist. M^2 is a measured property " +
        "of a real beam and is not derivable from the waist and wavelength alone.",
    );
  }
  notes.push(
    "w is the 1/e^2 irradiance RADIUS and theta is the far-field HALF-angle. Doubling either " +
      "for a diameter or a full angle is the most common error in these numbers.",
  );

  return {
    rayleighM: zR,
    thetaHalfRad: thetaHalf,
    wAtZ,
    rAtZ,
    bpp: w0 * thetaHalf,
    gouyRad: Math.atan(z / zR),
    confocalM: 2 * zR,
    notes,
  };
}

/** Waist radius that produces a given far-field half-angle — the inverse problem. */
export function waistForDivergence(thetaHalfRad: number, lambda: number, m2 = 1): number | null {
  if (![thetaHalfRad, lambda, m2].every(Number.isFinite)) return null;
  if (thetaHalfRad <= 0 || lambda <= 0 || m2 < 1) return null;
  return (m2 * lambda) / (Math.PI * thetaHalfRad);
}

// ---------------------------------------------------------------------------
// ABCD ray matrices
// ---------------------------------------------------------------------------

export type Abcd = [number, number, number, number]; // A, B, C, D

export type OpticElement =
  | { kind: "space"; d: number; n?: number }
  | { kind: "lens"; f: number }
  | { kind: "mirror"; R: number }
  | { kind: "flat"; n1: number; n2: number }
  | { kind: "curved"; n1: number; n2: number; R: number };

/** The matrix of a single element. Returns null on an unphysical parameter. */
export function elementMatrix(e: OpticElement): Abcd | null {
  switch (e.kind) {
    case "space": {
      const n = e.n ?? 1;
      if (!Number.isFinite(e.d) || !Number.isFinite(n) || n <= 0) return null;
      // Reduced distance d/n: a slab of glass shortens the optical path in the
      // ray-matrix sense, which is why a thick window shifts a focus.
      return [1, e.d / n, 0, 1];
    }
    case "lens":
      if (!Number.isFinite(e.f) || e.f === 0) return null;
      return [1, 0, -1 / e.f, 1];
    case "mirror":
      if (!Number.isFinite(e.R) || e.R === 0) return null;
      return [1, 0, -2 / e.R, 1];
    case "flat":
      if (!Number.isFinite(e.n1) || !Number.isFinite(e.n2) || e.n1 <= 0 || e.n2 <= 0) return null;
      return [1, 0, 0, e.n1 / e.n2];
    case "curved":
      if (!Number.isFinite(e.n1) || !Number.isFinite(e.n2) || e.n1 <= 0 || e.n2 <= 0) return null;
      if (!Number.isFinite(e.R) || e.R === 0) return null;
      return [1, 0, (e.n1 - e.n2) / (e.R * e.n2), e.n1 / e.n2];
    default:
      return null;
  }
}

/** Matrix product a*b, in the usual row-by-column order. */
export function abcdMultiply(a: Abcd, b: Abcd): Abcd {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
  ];
}

/**
 * The system matrix for elements given IN THE ORDER LIGHT MEETS THEM.
 *
 * THE ORDERING IS THE TRAP. The matrix product runs in the REVERSE of the
 * propagation order — the last element the light meets is the leftmost factor —
 * because each matrix acts on the ray vector to its right. Taking the list in
 * written order instead produces a valid matrix for a different system, so it
 * returns plausible numbers and never an error. The caller passes propagation
 * order and this function does the reversal, so the trap is sprung once here
 * rather than at every call site.
 */
export function systemMatrix(elements: OpticElement[]): Abcd | null {
  let m: Abcd = [1, 0, 0, 1];
  for (const e of elements) {
    const em = elementMatrix(e);
    if (!em) return null;
    m = abcdMultiply(em, m); // new element on the LEFT
  }
  return m;
}

/** Complex beam parameter q = z + i*z_R, carried as real and imaginary parts. */
export interface QParam {
  re: number;
  im: number;
}

/** q from a beam radius and wavefront curvature: 1/q = 1/R - i*lambda/(pi w^2). */
export function qFromBeam(w: number, R: number, lambda: number, m2 = 1, n = 1): QParam | null {
  if (![w, lambda, m2, n].every(Number.isFinite) || w <= 0 || lambda <= 0 || n <= 0 || m2 < 1) return null;
  const invR = Number.isFinite(R) && R !== 0 ? 1 / R : 0;
  const invIm = -(m2 * lambda) / (n * Math.PI * w * w);
  const denom = invR * invR + invIm * invIm;
  if (denom === 0) return null;
  return { re: invR / denom, im: -invIm / denom };
}

/** Beam radius and curvature back out of q. */
export function beamFromQ(q: QParam, lambda: number, m2 = 1, n = 1): { w: number; R: number } | null {
  const denom = q.re * q.re + q.im * q.im;
  if (denom === 0 || !Number.isFinite(denom)) return null;
  const invR = q.re / denom;
  // 1/q = conj(q)/|q|^2, so Im(1/q) = -Im(q)/|q|^2.
  const invIm = -q.im / denom;
  // A physical beam has Im(1/q) STRICTLY NEGATIVE — 1/q = 1/R - i*lambda/(pi w^2),
  // and the imaginary part carries the (positive) beam size through a minus sign.
  // Guarding the wrong way round rejected every real beam, starting with a waist.
  if (invIm >= 0) return null;
  const w = Math.sqrt((m2 * lambda) / (n * Math.PI * -invIm));
  return { w, R: invR === 0 ? Infinity : 1 / invR };
}

/** The ABCD law: q' = (Aq + B) / (Cq + D). */
export function propagateQ(q: QParam, m: Abcd): QParam | null {
  const [A, B, C, D] = m;
  const nRe = A * q.re + B;
  const nIm = A * q.im;
  const dRe = C * q.re + D;
  const dIm = C * q.im;
  const den = dRe * dRe + dIm * dIm;
  if (den === 0 || !Number.isFinite(den)) return null;
  return { re: (nRe * dRe + nIm * dIm) / den, im: (nIm * dRe - nRe * dIm) / den };
}

// ---------------------------------------------------------------------------
// Two-mirror resonator
// ---------------------------------------------------------------------------

export interface ResonatorResult {
  g1: number;
  g2: number;
  product: number;
  stable: boolean;
  /** Intracavity waist radius, metres — only when stable and not at a boundary. */
  waistM: number | null;
  /** Spot radius on each mirror, metres. */
  spot1M: number | null;
  spot2M: number | null;
  /** Distance of the waist from mirror 1, metres. */
  waistFromM1: number | null;
  notes: string[];
}

/**
 * Two-mirror standing-wave resonator.
 *
 * SIGN CONVENTION: R > 0 is a concave (focusing) mirror, and g = 1 - L/R. A flat
 * mirror is R = Infinity, giving g = 1; pass Infinity rather than a large number.
 *
 * Stability is 0 <= g1*g2 <= 1. The ENDPOINTS are included in the inequality but
 * are marginally stable, not stable: plane-parallel (g1g2 = 1), confocal
 * (g1g2 = 0 with L = R) and concentric (g1g2 = 1 with L = 2R) sit exactly on the
 * boundary, where the mode size either diverges or is undetermined and any real
 * misalignment walks the cavity out of stability. Reporting them as simply
 * "stable" with a finite mode size would be the most misleading thing this
 * function could do, so they are named.
 */
export function resonator(L: number, R1: number, R2: number, lambda: number): ResonatorResult | null {
  if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(lambda) || lambda <= 0) return null;
  if (Number.isNaN(R1) || Number.isNaN(R2)) return null;

  const g1 = R1 === Infinity || R1 === -Infinity ? 1 : 1 - L / R1;
  const g2 = R2 === Infinity || R2 === -Infinity ? 1 : 1 - L / R2;
  if (!Number.isFinite(g1) || !Number.isFinite(g2)) return null;

  const product = g1 * g2;
  const notes: string[] = [];
  const EPS = 1e-12;
  const stable = product >= -EPS && product <= 1 + EPS;

  if (!stable) {
    notes.push(
      `g1*g2 = ${product.toPrecision(6)} is outside [0, 1], so this cavity is UNSTABLE: a ray ` +
        "walks out of it rather than retracing, and there is no confined Gaussian mode. No mode " +
        "size is reported because none exists. (Unstable resonators are used deliberately in " +
        "some high-gain lasers, where the output is the walk-off itself.)",
    );
    return { g1, g2, product, stable: false, waistM: null, spot1M: null, spot2M: null, waistFromM1: null, notes };
  }

  const atBoundary = Math.abs(product) < 1e-9 || Math.abs(product - 1) < 1e-9;
  if (atBoundary) {
    notes.push(
      `g1*g2 = ${product.toPrecision(6)} sits exactly ON the stability boundary — this is ` +
        "MARGINALLY stable, not stable. Plane-parallel, confocal and concentric cavities all " +
        "live here. The mode size is either undetermined or diverges, and any real misalignment " +
        "pushes the cavity out of stability, so no mode size is reported.",
    );
    return { g1, g2, product, stable: true, waistM: null, spot1M: null, spot2M: null, waistFromM1: null, notes };
  }

  const sum = g1 + g2 - 2 * product;
  if (sum === 0) {
    notes.push("g1 + g2 - 2*g1*g2 = 0, so the waist size is undetermined for this cavity.");
    return { g1, g2, product, stable: true, waistM: null, spot1M: null, spot2M: null, waistFromM1: null, notes };
  }

  const k = (lambda * L) / Math.PI;
  const w0four = k * k * ((product * (1 - product)) / (sum * sum));
  const waistM = w0four > 0 ? Math.pow(w0four, 0.25) : null;

  const s1sq = k * Math.sqrt(g2 / (g1 * (1 - product)));
  const s2sq = k * Math.sqrt(g1 / (g2 * (1 - product)));
  const spot1M = Number.isFinite(s1sq) && s1sq > 0 ? Math.sqrt(s1sq) : null;
  const spot2M = Number.isFinite(s2sq) && s2sq > 0 ? Math.sqrt(s2sq) : null;

  const waistFromM1 = (g2 * (1 - g1) * L) / sum;

  notes.push(
    "Radii use the convention R > 0 for a concave mirror, and g = 1 - L/R. Mode sizes are " +
      "1/e^2 irradiance radii of the fundamental TEM00 mode; a real multimode beam is larger.",
  );

  return { g1, g2, product, stable: true, waistM, spot1M, spot2M, waistFromM1, notes };
}

// ---------------------------------------------------------------------------
// Pulses
// ---------------------------------------------------------------------------

export type PulseShape = "gaussian" | "rectangular" | "sech2";

export interface PulseResult {
  averagePowerW: number;
  peakPowerW: number;
  dutyCycle: number;
  /** Peak on-axis fluence, J/m^2 — only when a beam radius was given. */
  peakFluenceJm2: number | null;
  /** Peak on-axis irradiance, W/m^2 — only when a beam radius was given. */
  peakIrradianceWm2: number | null;
  shape: PulseShape;
  notes: string[];
}

/**
 * Pulse train metrics.
 *
 * PEAK POWER IS SHAPE-DEPENDENT and this is the number people get wrong. E/tau
 * is correct only for a rectangular pulse. For a Gaussian of FWHM tau the peak is
 * 2*sqrt(ln2/pi) * E/tau = 0.9394 E/tau; for a sech^2 it is 0.8814 E/tau. The
 * shape is therefore required rather than assumed, and it is named in the output.
 *
 * PEAK FLUENCE likewise: for a Gaussian beam of 1/e^2 radius w the ON-AXIS peak
 * fluence is 2E/(pi w^2) — TWICE the energy divided by the 1/e^2 area, because
 * the beam is not uniform. Damage thresholds are quoted against the peak, so the
 * factor of two is the difference between passing and destroying an optic.
 */
export function pulseMetrics(
  energyJ: number,
  durationS: number,
  repRateHz: number,
  shape: PulseShape = "gaussian",
  beamRadiusM?: number,
): PulseResult | null {
  if (![energyJ, durationS, repRateHz].every(Number.isFinite)) return null;
  if (energyJ <= 0 || durationS <= 0 || repRateHz < 0) return null;

  const notes: string[] = [];
  // Computed, not typed: a truncated decimal here is a silent precision error in
  // every peak power the tool reports. Gaussian: 2*sqrt(ln2/pi). sech^2: 2*ln(1+sqrt2)/pi.
  // Gaussian P(t) = P0*exp(-4ln2 t^2/tau^2) integrates to P0*tau*sqrt(pi/(4ln2)),
  // so P0 = 2*sqrt(ln2/pi) * E/tau = 0.93944 E/tau.
  const GAUSS_FACTOR = 2 * Math.sqrt(Math.LN2 / Math.PI);
  // sech^2(t/T) has FWHM = 2*arccosh(sqrt2)*T and energy 2*P0*T, so
  // P0 = arccosh(sqrt2) * E/tau, and arccosh(sqrt2) = ln(1+sqrt2) = 0.88137.
  const SECH2_FACTOR = Math.log(1 + Math.SQRT2);
  const factor = shape === "rectangular" ? 1 : shape === "sech2" ? SECH2_FACTOR : GAUSS_FACTOR;
  const peakPowerW = (factor * energyJ) / durationS;

  if (shape === "rectangular") {
    notes.push("Rectangular pulse assumed: peak power is exactly E/tau.");
  } else {
    notes.push(
      `${shape === "sech2" ? "sech^2" : "Gaussian"} pulse assumed, with tau the FWHM: peak power ` +
        `is ${factor.toPrecision(6)} x E/tau, not E/tau. Using E/tau would overstate it by ` +
        `${(((1 / factor) - 1) * 100).toFixed(1)}%.`,
    );
  }

  const dutyCycle = durationS * repRateHz;
  if (dutyCycle > 1) {
    notes.push(
      `Duty cycle is ${dutyCycle.toPrecision(4)}, i.e. greater than 1: the pulse is longer than ` +
        "the period between pulses, so this is not a pulse train as specified. Check the " +
        "duration and repetition rate.",
    );
  }

  let peakFluenceJm2: number | null = null;
  let peakIrradianceWm2: number | null = null;
  if (beamRadiusM !== undefined) {
    if (!Number.isFinite(beamRadiusM) || beamRadiusM <= 0) return null;
    const area = Math.PI * beamRadiusM * beamRadiusM;
    peakFluenceJm2 = (2 * energyJ) / area;
    peakIrradianceWm2 = (2 * peakPowerW) / area;
    notes.push(
      "Fluence and irradiance are ON-AXIS PEAK values for a Gaussian transverse profile: " +
        "2E/(pi w^2), which is twice the energy spread evenly over the 1/e^2 area. Damage " +
        "thresholds are quoted against the peak, so the factor of two matters.",
    );
  }

  return {
    averagePowerW: energyJ * repRateHz,
    peakPowerW,
    dutyCycle,
    peakFluenceJm2,
    peakIrradianceWm2,
    shape,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Refraction at an interface
// ---------------------------------------------------------------------------

export interface RefractionResult {
  /** Refraction angle in degrees, or null under total internal reflection. */
  thetaTDeg: number | null;
  /** Critical angle in degrees — only exists when n1 > n2. */
  criticalDeg: number | null;
  brewsterDeg: number;
  /** Reflectance at NORMAL incidence (not at the given angle). */
  reflectanceNormal: number;
  tir: boolean;
  notes: string[];
}

/**
 * Snell's law with the cases that have no answer reported as such.
 *
 * A CRITICAL ANGLE ONLY EXISTS GOING INTO A LOWER INDEX. Computing
 * asin(n2/n1) when n2 > n1 gives NaN, and a calculator that prints NaN — or worse,
 * silently clamps the argument to 1 and prints 90 degrees — is claiming a physical
 * phenomenon that is not there. It is reported as absent instead.
 */
export function refraction(n1: number, n2: number, thetaIDeg: number): RefractionResult | null {
  if (![n1, n2, thetaIDeg].every(Number.isFinite)) return null;
  if (n1 <= 0 || n2 <= 0) return null;
  if (thetaIDeg < 0 || thetaIDeg >= 90) return null;

  const notes: string[] = [];
  const ti = (thetaIDeg * Math.PI) / 180;
  const sinT = (n1 * Math.sin(ti)) / n2;

  let thetaTDeg: number | null = null;
  let tir = false;
  if (sinT > 1) {
    tir = true;
    notes.push(
      `sin(theta_t) would be ${sinT.toPrecision(6)} > 1, so there is NO transmitted ray: this is ` +
        "total internal reflection. The angle is not reported because it does not exist.",
    );
  } else {
    thetaTDeg = (Math.asin(sinT) * 180) / Math.PI;
  }

  let criticalDeg: number | null = null;
  if (n1 > n2) {
    criticalDeg = (Math.asin(n2 / n1) * 180) / Math.PI;
  } else {
    notes.push(
      `There is no critical angle here: n1 = ${n1} is not greater than n2 = ${n2}, and total ` +
        "internal reflection only occurs going into a LOWER index. Reported as absent rather " +
        "than as a non-number or as a clamped 90 degrees.",
    );
  }

  const r = (n1 - n2) / (n1 + n2);
  notes.push(
    "Reflectance is for NORMAL incidence and a single uncoated interface. It rises sharply " +
      "near grazing and differs for s and p polarisation away from normal; a coated optic is " +
      "not described by this at all.",
  );

  return {
    thetaTDeg,
    criticalDeg,
    brewsterDeg: (Math.atan(n2 / n1) * 180) / Math.PI,
    reflectanceNormal: r * r,
    tir,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Diffraction
// ---------------------------------------------------------------------------

export interface DiffractionResult {
  /** Airy first-zero HALF-angle, radians. */
  airyHalfAngleRad: number;
  /** Airy disc DIAMETER at the focus of a lens of the given f, metres. */
  airyDiameterM: number | null;
  notes: string[];
}

/** Airy pattern for a circular aperture of diameter D. */
export function airy(lambda: number, apertureD: number, focalM?: number): DiffractionResult | null {
  if (![lambda, apertureD].every(Number.isFinite) || lambda <= 0 || apertureD <= 0) return null;
  const half = (1.22 * lambda) / apertureD;
  let airyDiameterM: number | null = null;
  if (focalM !== undefined) {
    if (!Number.isFinite(focalM) || focalM <= 0) return null;
    airyDiameterM = (2.44 * lambda * focalM) / apertureD;
  }
  return {
    airyHalfAngleRad: half,
    airyDiameterM,
    notes: [
      "1.22 lambda/D is the HALF-angle to the first dark ring; the Airy disc diameter is twice " +
        "that, 2.44 lambda f/D at a focus. This is the uniformly illuminated circular-aperture " +
        "case — a Gaussian beam truncated by the same aperture focuses differently.",
    ],
  };
}

export interface GratingOrder {
  m: number;
  angleDeg: number;
}

export interface GratingResult {
  orders: GratingOrder[];
  /** Highest order that physically exists at this wavelength and incidence. */
  maxOrder: number;
  notes: string[];
}

/**
 * Diffraction grating: d(sin(theta_m) - sin(theta_i)) = m*lambda.
 *
 * ORDERS THAT DO NOT EXIST ARE NOT LISTED. |sin| > 1 has no solution, and an
 * order beyond that limit is not a small-angle approximation failing — it is
 * simply absent, and printing NaN beside it would suggest otherwise.
 */
export function grating(
  lambda: number,
  linesPerMm: number,
  incidenceDeg = 0,
  maxOrders = 5,
): GratingResult | null {
  if (![lambda, linesPerMm, incidenceDeg].every(Number.isFinite)) return null;
  if (lambda <= 0 || linesPerMm <= 0) return null;
  if (Math.abs(incidenceDeg) >= 90) return null;

  const d = 1 / (linesPerMm * 1000); // metres per line
  const si = Math.sin((incidenceDeg * Math.PI) / 180);
  const orders: GratingOrder[] = [];
  let maxOrder = 0;
  for (let m = -maxOrders; m <= maxOrders; m++) {
    const s = si + (m * lambda) / d;
    if (Math.abs(s) <= 1) {
      orders.push({ m, angleDeg: (Math.asin(s) * 180) / Math.PI });
      maxOrder = Math.max(maxOrder, Math.abs(m));
    }
  }
  return {
    orders,
    maxOrder,
    notes: [
      `Grating spacing d = ${(d * 1e9).toPrecision(6)} nm from ${linesPerMm} lines/mm. Orders ` +
        "with |sin(theta)| > 1 do not exist and are omitted rather than listed as non-numbers.",
      "Angles are signed from the grating normal, with the sign convention that positive " +
        "incidence and positive order are on the same side.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Step-index fibre
// ---------------------------------------------------------------------------

export interface FibreResult {
  na: number;
  acceptanceHalfDeg: number;
  vNumber: number;
  singleMode: boolean;
  /** Approximate guided-mode count; only meaningful well above cutoff. */
  approxModes: number | null;
  /** Wavelength above which this fibre is single-mode, metres. */
  cutoffWavelengthM: number;
  notes: string[];
}

/** Step-index fibre from core/cladding indices and core RADIUS. */
export function fibre(nCore: number, nClad: number, coreRadiusM: number, lambda: number): FibreResult | null {
  if (![nCore, nClad, coreRadiusM, lambda].every(Number.isFinite)) return null;
  if (nCore <= 0 || nClad <= 0 || coreRadiusM <= 0 || lambda <= 0) return null;
  if (nCore <= nClad) return null; // no guidance without a higher-index core

  const na = Math.sqrt(nCore * nCore - nClad * nClad);
  const v = (2 * Math.PI * coreRadiusM * na) / lambda;
  const singleMode = v < 2.405;
  const notes: string[] = [
    "V < 2.405 is the single-mode condition for a step-index fibre; 2.405 is the first zero of " +
      "the Bessel function J0, not a rounded rule of thumb.",
  ];
  if (!singleMode) {
    notes.push(
      `V = ${v.toPrecision(6)}, so this fibre is MULTIMODE at this wavelength. The mode count ` +
        "V^2/2 is an asymptotic estimate and is poor just above cutoff.",
    );
  }
  return {
    na,
    acceptanceHalfDeg: (Math.asin(Math.min(1, na)) * 180) / Math.PI,
    vNumber: v,
    singleMode,
    approxModes: singleMode ? null : (v * v) / 2,
    cutoffWavelengthM: (2 * Math.PI * coreRadiusM * na) / 2.405,
    notes,
  };
}
