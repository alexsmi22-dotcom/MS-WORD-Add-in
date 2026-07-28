// Pipe flow — Reynolds number, friction factor, and head loss.
//
// EVERYTHING HERE IS SI AND FULLY DIMENSIONAL. Head loss is one of the places
// where a unit slip is both easy and invisible: a diameter in millimetres with
// a velocity in metres per second gives a Reynolds number wrong by a thousand,
// which moves the flow from turbulent to laminar and changes the friction
// factor by an order of magnitude while still looking like a number a pipe
// might have. So this module takes strict SI and the caller converts.
//
// THE FRICTION FACTOR IS THE WHOLE PROBLEM, and it is a different physical
// regime in each of three bands:
//
//   Re < 2300      LAMINAR. f = 64/Re is exact — a closed-form consequence of
//                  the parabolic velocity profile, not a correlation. Roughness
//                  does not appear, because a laminar flow does not feel it.
//   2300 < Re < 4000  TRANSITION. There is no correlation here worth trusting.
//                  The flow intermittently bursts into turbulence and back, the
//                  friction factor is not a function of Re alone, and a given
//                  pipe can sit anywhere in a band roughly twice as wide as the
//                  answer. This module RETURNS A NUMBER AND SAYS IT IS
//                  UNRELIABLE, because refusing outright is unhelpful and
//                  quoting it silently is worse.
//   Re > 4000      TURBULENT. Colebrook-White, solved iteratively.
//
// COLEBROOK IS IMPLICIT AND IS SOLVED, NOT APPROXIMATED. The equation
//
//     1/sqrt(f) = -2 log10( eps/(3.7 D) + 2.51 / (Re sqrt(f)) )
//
// has f on both sides. Written in terms of x = 1/sqrt(f) the right-hand side is
// a contraction mapping in x, so plain fixed-point iteration converges
// monotonically and fast — five or six iterations to machine precision from any
// sane start. The iteration is nonetheless HARD-CAPPED and its convergence
// CHECKED: this runs on every keystroke inside a Word task pane, where a loop
// that fails to terminate is not an error message but a frozen Word. A capped
// loop that did not converge reports that it did not converge.
//
// Swamee-Jain is used only to seed the iteration. It is an explicit fit to
// Colebrook accurate to about 1%, which is a fine starting point and a poor
// answer when the exact one costs six iterations.

/** Standard gravity, m/s^2. */
export const G = 9.80665;

export interface PipeInput {
  /** Internal diameter, m. */
  D: number;
  /** Pipe length, m. */
  L: number;
  /** Mean velocity, m/s. Give this or Q. */
  V?: number;
  /** Volumetric flow rate, m^3/s. Give this or V. */
  Q?: number;
  /** Absolute roughness, m. */
  eps: number;
  /** Density, kg/m^3. */
  rho: number;
  /** Dynamic viscosity, Pa*s. */
  mu: number;
  /** Sum of minor-loss coefficients, dimensionless. */
  sumK?: number;
  /** Pump efficiency 0-1, for the power estimate. */
  eta?: number;
}

export type FlowRegime = "laminar" | "transition" | "turbulent";

export interface PipeResult {
  ok: true;
  V: number;
  Q: number;
  Re: number;
  regime: FlowRegime;
  /** Relative roughness, eps/D. */
  relRoughness: number;
  /** Darcy friction factor. Multiply by 4 for the Fanning factor. */
  f: number;
  /** Major (friction) head loss, m. */
  hMajor: number;
  /** Minor (fitting) head loss, m. */
  hMinor: number;
  hTotal: number;
  /** Pressure drop, Pa. */
  dp: number;
  /** Wall shear stress, Pa. */
  tauWall: number;
  /** Hydraulic power lost to friction, W. */
  powerLost: number;
  /** Shaft power a pump must supply to overcome it, W; null without an efficiency. */
  pumpPower: number | null;
  notes: string[];
}

export interface FluidError {
  ok: false;
  error: string;
}

/** Colebrook's iteration cap. Convergence is typically reached in 6. */
const COLEBROOK_MAX_ITER = 60;
const COLEBROOK_TOL = 1e-12;

/**
 * The Darcy friction factor from Colebrook-White, by fixed-point iteration on
 * x = 1/sqrt(f).
 *
 * Returns null if it did not converge inside the cap — which should not happen
 * for physical inputs, and if it ever does the caller must say so rather than
 * quote the last iterate as though it were the answer.
 */
export function colebrook(Re: number, relRoughness: number): number | null {
  if (!Number.isFinite(Re) || Re <= 0) return null;
  if (!Number.isFinite(relRoughness) || relRoughness < 0) return null;

  // Swamee-Jain as the seed.
  const seed = 0.25 / Math.log10(relRoughness / 3.7 + 5.74 / Math.pow(Re, 0.9)) ** 2;
  let x = 1 / Math.sqrt(seed > 0 && Number.isFinite(seed) ? seed : 0.02);

  for (let i = 0; i < COLEBROOK_MAX_ITER; i++) {
    const next = -2 * Math.log10(relRoughness / 3.7 + (2.51 * x) / Re);
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < COLEBROOK_TOL * Math.max(1, Math.abs(x))) {
      return 1 / (next * next);
    }
    x = next;
  }
  return null;
}

/** Analyses steady flow in a full circular pipe. */
export function analyzePipe(inp: PipeInput): PipeResult | FluidError {
  const { D, L, eps, rho, mu } = inp;
  const sumK = inp.sumK ?? 0;

  for (const [name, v] of [
    ["diameter", D],
    ["length", L],
    ["roughness", eps],
    ["density", rho],
    ["viscosity", mu],
    ["sum of K", sumK],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (D <= 0) return { ok: false, error: "The diameter must be greater than zero." };
  if (L < 0) return { ok: false, error: "The length cannot be negative." };
  if (eps < 0) return { ok: false, error: "The roughness cannot be negative." };
  if (rho <= 0) return { ok: false, error: "The density must be greater than zero." };
  if (mu <= 0) return { ok: false, error: "The viscosity must be greater than zero." };
  if (sumK < 0) return { ok: false, error: "The sum of minor-loss coefficients cannot be negative." };

  const area = (Math.PI * D * D) / 4;

  let V: number;
  if (inp.V !== undefined && Number.isFinite(inp.V)) {
    V = inp.V;
  } else if (inp.Q !== undefined && Number.isFinite(inp.Q)) {
    V = inp.Q / area;
  } else {
    return { ok: false, error: "Give either a velocity or a volumetric flow rate." };
  }
  if (V < 0) return { ok: false, error: "The velocity must not be negative." };

  const Q = V * area;
  const notes: string[] = [];

  if (V === 0) {
    return {
      ok: true,
      V: 0,
      Q: 0,
      Re: 0,
      regime: "laminar",
      relRoughness: eps / D,
      f: Infinity,
      hMajor: 0,
      hMinor: 0,
      hTotal: 0,
      dp: 0,
      tauWall: 0,
      powerLost: 0,
      pumpPower: inp.eta ? 0 : null,
      notes: ["There is no flow, so there is no head loss. The friction factor is undefined at zero flow."],
    };
  }

  const Re = (rho * V * D) / mu;
  const relRoughness = eps / D;

  let regime: FlowRegime;
  let f: number;
  if (Re < 2300) {
    regime = "laminar";
    // Exact for fully developed laminar flow, and independent of roughness.
    f = 64 / Re;
    if (eps > 0) {
      notes.push(
        "The flow is laminar, so f = 64/Re exactly and the roughness has NO effect — a laminar " +
          "flow does not feel the wall texture. The roughness you entered was not used.",
      );
    }
  } else if (Re < 4000) {
    regime = "transition";
    const c = colebrook(Re, relRoughness);
    const lam = 64 / Re;
    f = c ?? lam;
    notes.push(
      `Re = ${Re.toFixed(0)} is in the TRANSITION band (2300 to 4000), where there is no reliable ` +
        "correlation. The flow flickers between laminar and turbulent and the friction factor is " +
        `not a function of Re alone. The laminar formula would give ${lam.toFixed(4)} and the ` +
        `turbulent one ${(c ?? NaN).toFixed(4)}; the true value is somewhere between and is not ` +
        "repeatable. Treat any head loss computed here as an order-of-magnitude figure, and " +
        "design the pipe to sit clearly outside this band.",
    );
  } else {
    regime = "turbulent";
    const c = colebrook(Re, relRoughness);
    if (c === null) {
      return {
        ok: false,
        error:
          "The Colebrook iteration did not converge for these values, so no friction factor is " +
          "reported. Check the roughness and diameter — a relative roughness above about 0.05 is " +
          "outside the range the correlation was fitted over.",
      };
    }
    f = c;
    if (relRoughness > 0.05) {
      notes.push(
        `The relative roughness ${relRoughness.toFixed(3)} is above 0.05, which is outside the ` +
          "range Colebrook-White was fitted over. The pipe is better modelled as a rough duct.",
      );
    }
  }

  const velHead = (V * V) / (2 * G);
  const hMajor = (f * L * velHead) / D;
  const hMinor = sumK * velHead;
  const hTotal = hMajor + hMinor;
  const dp = rho * G * hTotal;
  const tauWall = (f * rho * V * V) / 8;
  const powerLost = dp * Q;

  let pumpPower: number | null = null;
  if (inp.eta !== undefined && Number.isFinite(inp.eta)) {
    if (inp.eta <= 0 || inp.eta > 1) {
      notes.push("The pump efficiency must be between 0 and 1, so no shaft power was computed.");
    } else {
      pumpPower = powerLost / inp.eta;
    }
  }

  if (sumK > 0 && hMinor > hMajor) {
    notes.push(
      "The minor losses are LARGER than the pipe friction here, so calling them minor is " +
        "misleading — the fittings, not the pipe, set the duty of this system.",
    );
  }

  return {
    ok: true,
    V,
    Q,
    Re,
    regime,
    relRoughness,
    f,
    hMajor,
    hMinor,
    hTotal,
    dp,
    tauWall,
    powerLost,
    pumpPower,
    notes,
  };
}

/**
 * Absolute roughness of common pipe materials, in metres.
 *
 * These are DESIGN values for commercial pipe, and the spread is real: drawn
 * tubing varies by a factor of three between suppliers and cast iron roughens
 * by an order of magnitude over its life. Quoting head loss to four figures
 * from a table entry that is itself good to one is the standard way to produce
 * false precision, which is why the reporting layer says so.
 */
export const ROUGHNESS: { id: string; label: string; eps: number }[] = [
  { id: "drawn", label: "Drawn tubing (copper, brass, glass)", eps: 1.5e-6 },
  { id: "steel", label: "Commercial steel or wrought iron", eps: 4.5e-5 },
  { id: "galvanised", label: "Galvanised iron", eps: 1.5e-4 },
  { id: "castiron", label: "Cast iron, asphalted", eps: 1.2e-4 },
  { id: "castiron-bare", label: "Cast iron, bare", eps: 2.6e-4 },
  { id: "concrete", label: "Concrete, smooth to rough", eps: 1.0e-3 },
  { id: "pvc", label: "PVC or smooth plastic", eps: 1.5e-6 },
  { id: "riveted", label: "Riveted steel", eps: 3.0e-3 },
];

/**
 * Properties of water at a few temperatures, so the common case does not need
 * a handbook. Interpolation between them is linear and good to well under a
 * percent over this range.
 */
export const WATER: { tempC: number; rho: number; mu: number }[] = [
  { tempC: 0, rho: 999.8, mu: 1.781e-3 },
  { tempC: 10, rho: 999.7, mu: 1.307e-3 },
  { tempC: 20, rho: 998.2, mu: 1.002e-3 },
  { tempC: 30, rho: 995.7, mu: 7.977e-4 },
  { tempC: 40, rho: 992.2, mu: 6.531e-4 },
  { tempC: 50, rho: 988.1, mu: 5.471e-4 },
  { tempC: 60, rho: 983.2, mu: 4.658e-4 },
  { tempC: 80, rho: 971.8, mu: 3.547e-4 },
  { tempC: 100, rho: 958.4, mu: 2.818e-4 },
];

/** Density and viscosity of liquid water, linearly interpolated, 0-100 C. */
export function waterProperties(tempC: number): { rho: number; mu: number } | null {
  if (!Number.isFinite(tempC) || tempC < 0 || tempC > 100) return null;
  for (let i = 0; i < WATER.length - 1; i++) {
    const a = WATER[i];
    const b = WATER[i + 1];
    if (tempC >= a.tempC && tempC <= b.tempC) {
      const t = (tempC - a.tempC) / (b.tempC - a.tempC);
      return { rho: a.rho + t * (b.rho - a.rho), mu: a.mu + t * (b.mu - a.mu) };
    }
  }
  return null;
}
