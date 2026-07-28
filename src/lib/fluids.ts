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

// ---------------------------------------------------------------------------
// Open-channel flow
// ---------------------------------------------------------------------------

export type ChannelShape = "rectangular" | "trapezoidal" | "triangular" | "circular";

export interface ChannelInput {
  shape: ChannelShape;
  /** Bed width, m. Rectangular and trapezoidal. */
  b?: number;
  /** Side slope, horizontal per 1 vertical. Trapezoidal and triangular. */
  z?: number;
  /** Diameter, m. Circular. */
  D?: number;
  /** Flow depth, m. */
  y: number;
  /** Manning roughness coefficient. */
  n: number;
  /** Bed slope, m/m. */
  S: number;
}

export interface ChannelResult {
  ok: true;
  area: number;
  perimeter: number;
  hydraulicRadius: number;
  velocity: number;
  discharge: number;
  froude: number;
  regime: "subcritical" | "critical" | "supercritical";
  /** Critical depth for this discharge, m. */
  criticalDepth: number | null;
  specificEnergy: number;
  notes: string[];
}

/** Geometry of a channel section at a given depth. */
function channelGeometry(inp: ChannelInput): { A: number; P: number; T: number } | FluidError {
  const y = inp.y;
  if (!Number.isFinite(y) || y <= 0) return { ok: false, error: "The flow depth must be greater than zero." };
  switch (inp.shape) {
    case "rectangular": {
      const b = inp.b ?? 0;
      if (!Number.isFinite(b) || b <= 0) return { ok: false, error: "The bed width must be greater than zero." };
      return { A: b * y, P: b + 2 * y, T: b };
    }
    case "trapezoidal": {
      const b = inp.b ?? 0;
      const z = inp.z ?? 0;
      if (!Number.isFinite(b) || b <= 0) return { ok: false, error: "The bed width must be greater than zero." };
      if (!Number.isFinite(z) || z < 0) return { ok: false, error: "The side slope cannot be negative." };
      return { A: (b + z * y) * y, P: b + 2 * y * Math.sqrt(1 + z * z), T: b + 2 * z * y };
    }
    case "triangular": {
      const z = inp.z ?? 0;
      if (!Number.isFinite(z) || z <= 0) return { ok: false, error: "The side slope must be greater than zero." };
      return { A: z * y * y, P: 2 * y * Math.sqrt(1 + z * z), T: 2 * z * y };
    }
    case "circular": {
      const D = inp.D ?? 0;
      if (!Number.isFinite(D) || D <= 0) return { ok: false, error: "The diameter must be greater than zero." };
      if (y > D) return { ok: false, error: "The depth exceeds the pipe diameter; this is no longer open-channel flow." };
      const theta = 2 * Math.acos(1 - (2 * y) / D);
      const A = ((D * D) / 8) * (theta - Math.sin(theta));
      const P = (D * theta) / 2;
      const T = D * Math.sin(theta / 2);
      return { A, P, T };
    }
  }
}

/**
 * Uniform open-channel flow by Manning's equation.
 *
 * THE FROUDE NUMBER IS THE ANSWER, NOT THE DISCHARGE. Whether flow is
 * subcritical (Fr < 1) or supercritical (Fr > 1) decides how the channel
 * behaves in every respect that matters: subcritical flow is controlled from
 * DOWNSTREAM and a disturbance travels back upstream, supercritical flow is
 * controlled from upstream and nothing propagates back. Design a transition
 * that crosses Fr = 1 without intending to and you get a HYDRAULIC JUMP —
 * abrupt, violent, energy-dissipating, and capable of destroying an unprotected
 * channel bed. Reporting a discharge without the regime is the easy half.
 *
 * MANNING'S n IS THE DOMINANT UNCERTAINTY. Published values for the same
 * material span roughly a factor of two, and discharge is inversely
 * proportional to it. Four significant figures of discharge from a table-lookup
 * n is false precision by about a factor of two.
 *
 * MANNING IS DIMENSIONAL. The 1/n coefficient carries units, so this is the SI
 * form; the US customary form has a 1.486 in it, and mixing the two is a 50%
 * error that produces an entirely plausible number.
 */
export function openChannelFlow(inp: ChannelInput): ChannelResult | FluidError {
  const geo = channelGeometry(inp);
  if ("ok" in geo) return geo;
  const { A, P, T } = geo;
  if (!Number.isFinite(inp.n) || inp.n <= 0) return { ok: false, error: "Manning's n must be greater than zero." };
  if (!Number.isFinite(inp.S) || inp.S <= 0) {
    return {
      ok: false,
      error:
        "The bed slope must be greater than zero. Manning's equation describes UNIFORM flow driven " +
        "by gravity down a slope; a level or adverse channel has no uniform-flow solution and needs " +
        "a gradually-varied flow analysis instead.",
    };
  }
  if (P <= 0 || A <= 0) return { ok: false, error: "The section geometry came out non-physical." };

  const R = A / P;
  const velocity = (1 / inp.n) * Math.pow(R, 2 / 3) * Math.sqrt(inp.S);
  const discharge = velocity * A;
  // Froude uses the HYDRAULIC DEPTH A/T, not the flow depth. For any
  // non-rectangular section they differ, and using the flow depth gives the
  // wrong regime near the boundary.
  const hydraulicDepth = A / T;
  const froude = velocity / Math.sqrt(G * hydraulicDepth);

  const notes: string[] = [];
  const regime = froude > 1.01 ? "supercritical" : froude < 0.99 ? "subcritical" : "critical";

  // Critical depth for this discharge, by bisection on Q^2*T/(g*A^3) = 1.
  let criticalDepth: number | null = null;
  {
    const f = (y: number): number => {
      const g2 = channelGeometry({ ...inp, y });
      if ("ok" in g2) return NaN;
      return (discharge * discharge * g2.T) / (G * Math.pow(g2.A, 3)) - 1;
    };
    let lo = 1e-6;
    let hi = inp.shape === "circular" ? (inp.D as number) * 0.999 : Math.max(inp.y * 10, 1);
    let flo = f(lo);
    const fhi = f(hi);
    if (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi < 0) {
      // Fixed iteration count: this runs on every keystroke.
      for (let k = 0; k < 100; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (!Number.isFinite(fm)) break;
        if (flo * fm < 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      criticalDepth = (lo + hi) / 2;
    }
  }

  const specificEnergy = inp.y + (velocity * velocity) / (2 * G);

  if (regime === "supercritical") {
    notes.push(
      "SUPERCRITICAL flow. It is controlled from UPSTREAM and no disturbance can travel back up " +
        "the channel. Where it meets a subcritical reach it does so through a HYDRAULIC JUMP — " +
        "abrupt, violent and highly energy-dissipating — which needs a protected stilling basin " +
        "unless you want it eating the channel bed.",
    );
  } else if (regime === "subcritical") {
    notes.push(
      "SUBCRITICAL flow. It is controlled from DOWNSTREAM, so a backwater from an obstruction " +
        "propagates upstream and the depth here depends on what happens further down the channel.",
    );
  } else {
    notes.push(
      "NEAR-CRITICAL flow, which is the worst place to operate: the water surface is unstable, " +
        "small changes in discharge or roughness give large changes in depth, and the flow can " +
        "flip between regimes. Design away from Fr = 1.",
    );
  }
  notes.push(
    "The Froude number here uses the HYDRAULIC DEPTH A/T, not the flow depth. For a rectangular " +
      "channel they are the same; for a trapezoid or a part-full pipe they are not, and using the " +
      "flow depth gives the wrong regime near the boundary.",
  );
  notes.push(
    "Manning's n is the dominant uncertainty. Published values for the same material span roughly " +
      "a factor of two, and discharge is inversely proportional to n — so treat this discharge as " +
      "good to about a factor of two rather than to four figures.",
  );
  notes.push(
    "SI form of Manning's equation. The US customary form carries a 1.486 coefficient; mixing the " +
      "two is a 50% error that looks like nothing.",
  );

  return {
    ok: true,
    area: A,
    perimeter: P,
    hydraulicRadius: R,
    velocity,
    discharge,
    froude,
    regime,
    criticalDepth,
    specificEnergy,
    notes,
  };
}

/**
 * Manning roughness coefficients for common channel surfaces.
 *
 * The RANGE is given rather than one value, because the range IS the answer:
 * taking the midpoint and quoting four figures of discharge hides an
 * uncertainty of about a factor of two.
 */
export const MANNING_N: { id: string; label: string; min: number; typical: number; max: number }[] = [
  { id: "glass", label: "Glass or smooth plastic", min: 0.009, typical: 0.01, max: 0.013 },
  { id: "concrete-smooth", label: "Concrete, trowelled", min: 0.011, typical: 0.013, max: 0.015 },
  { id: "concrete-rough", label: "Concrete, unfinished", min: 0.014, typical: 0.017, max: 0.02 },
  { id: "earth-clean", label: "Earth channel, clean", min: 0.018, typical: 0.022, max: 0.025 },
  { id: "earth-gravel", label: "Earth channel, gravelly", min: 0.022, typical: 0.025, max: 0.03 },
  { id: "stream-clean", label: "Natural stream, clean and straight", min: 0.025, typical: 0.03, max: 0.033 },
  { id: "stream-weedy", label: "Natural stream, weedy with pools", min: 0.05, typical: 0.07, max: 0.1 },
];

// ---------------------------------------------------------------------------
// Pumps, NPSH and cavitation
// ---------------------------------------------------------------------------

export interface NpshInput {
  /** Absolute pressure on the liquid surface, Pa. */
  pSurface: number;
  /** Vapour pressure at the pumping temperature, Pa. */
  pVapour: number;
  rho: number;
  /** Positive when the liquid level is ABOVE the pump, m. */
  staticHead: number;
  /** Friction and fitting losses in the suction line, m. */
  suctionLosses: number;
  /** NPSH the pump requires at this flow, from its curve, m. */
  npshRequired: number;
  Q?: number;
  head?: number;
  eta?: number;
}

export interface NpshResult {
  ok: true;
  npshAvailable: number;
  margin: number;
  cavitating: boolean;
  hydraulicPower: number | null;
  shaftPower: number | null;
  notes: string[];
}

/**
 * Net positive suction head, and whether the pump will cavitate.
 *
 * CAVITATION IS A FAILURE MODE, NOT AN EFFICIENCY LOSS. When the local pressure
 * at the impeller eye reaches the vapour pressure the liquid boils, and the
 * bubbles collapse violently a few millimetres later against the impeller. It
 * sounds like gravel in the pump and it destroys the impeller in weeks. It is
 * entirely a SUCTION-side problem: nothing on the discharge side can fix it.
 *
 * NPSH AVAILABLE FALLS AS THE LIQUID GETS HOTTER, because vapour pressure rises
 * steeply with temperature. A pump that has run for years on cold water can
 * cavitate the first time the same water arrives warm — which is why the vapour
 * pressure is asked for rather than assumed.
 */
export function npshAnalysis(inp: NpshInput): NpshResult | FluidError {
  const { pSurface, pVapour, rho, staticHead, suctionLosses, npshRequired } = inp;
  for (const [name, v] of [
    ["surface pressure", pSurface],
    ["vapour pressure", pVapour],
    ["density", rho],
    ["static head", staticHead],
    ["suction losses", suctionLosses],
    ["required NPSH", npshRequired],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (rho <= 0) return { ok: false, error: "The density must be greater than zero." };
  if (pSurface <= 0) {
    return { ok: false, error: "The surface pressure must be greater than zero — it is an ABSOLUTE pressure, not gauge." };
  }
  if (pVapour < 0) return { ok: false, error: "The vapour pressure cannot be negative." };
  if (suctionLosses < 0) return { ok: false, error: "The suction losses cannot be negative." };
  if (npshRequired < 0) return { ok: false, error: "The required NPSH cannot be negative." };
  if (pVapour >= pSurface) {
    return {
      ok: false,
      error:
        "The vapour pressure is at or above the surface pressure, so the liquid is already boiling " +
        "in the tank. No suction arrangement can pump it — lower the temperature or raise the " +
        "system pressure.",
    };
  }

  const npshAvailable = (pSurface - pVapour) / (rho * G) + staticHead - suctionLosses;
  const margin = npshAvailable - npshRequired;
  const cavitating = margin <= 0;
  const notes: string[] = [];

  if (cavitating) {
    notes.push(
      "THIS PUMP WILL CAVITATE: the available NPSH is below what the pump requires. Cavitation is " +
        "not an efficiency loss — it is vapour bubbles collapsing against the impeller, and it " +
        "destroys the impeller in weeks. Nothing on the DISCHARGE side of the pump can fix it.",
    );
    notes.push(
      "Every fix is on the suction side: raise the liquid level relative to the pump, shorten or " +
        "widen the suction line to cut losses, lower the liquid temperature to drop the vapour " +
        "pressure, or choose a pump with a lower NPSH requirement.",
    );
  } else if (margin < 0.5) {
    notes.push(
      "The NPSH margin is under 0.5 m. Common practice is at least 0.5 to 1 m above the pump's " +
        "stated requirement, because the published NPSHr is measured at the point where head has " +
        "ALREADY dropped 3% — the pump is mildly cavitating at its own rated NPSHr.",
    );
  }
  notes.push(
    "NPSH available falls as the liquid gets hotter, because vapour pressure rises steeply with " +
      "temperature. A pump that has run for years on cold water can cavitate the first time the " +
      "same water arrives warm.",
  );

  let hydraulicPower: number | null = null;
  let shaftPower: number | null = null;
  if (
    inp.Q !== undefined &&
    inp.head !== undefined &&
    Number.isFinite(inp.Q) &&
    Number.isFinite(inp.head) &&
    inp.Q > 0 &&
    inp.head > 0
  ) {
    hydraulicPower = rho * G * inp.Q * inp.head;
    if (inp.eta !== undefined && Number.isFinite(inp.eta) && inp.eta > 0 && inp.eta <= 1) {
      shaftPower = hydraulicPower / inp.eta;
    }
  }

  return { ok: true, npshAvailable, margin, cavitating, hydraulicPower, shaftPower, notes };
}

// ---------------------------------------------------------------------------
// Compressible flow
// ---------------------------------------------------------------------------

export interface CompressibleResult {
  ok: true;
  mach: number;
  regime: "subsonic" | "sonic" | "supersonic";
  /** Stagnation-to-static ratios. */
  temperatureRatio: number;
  pressureRatio: number;
  densityRatio: number;
  speedOfSound: number;
  /** Area relative to the sonic throat area. */
  areaRatio: number;
  criticalPressureRatio: number;
  choked: boolean;
  notes: string[];
}

/**
 * Isentropic compressible-flow relations for an ideal gas.
 *
 * CHOKING IS THE RESULT THAT SURPRISES PEOPLE. Once the flow reaches Mach 1 at
 * the throat, lowering the downstream pressure further does NOT increase the
 * mass flow: the information that the pressure has dropped cannot travel
 * upstream against sonic flow. A valve or orifice sized on the assumption that
 * more pressure difference always means more flow is sized wrong, and the
 * critical pressure ratio — 0.528 for air — is exactly where that stops being
 * true.
 *
 * These relations assume ISENTROPIC flow: no friction, no heat transfer and no
 * shocks. A normal shock is not isentropic and none of this holds across one.
 */
export function compressibleFlow(mach: number, k = 1.4, staticTempK = 288.15): CompressibleResult | FluidError {
  if (!Number.isFinite(mach) || mach < 0) return { ok: false, error: "The Mach number must be zero or greater." };
  if (!Number.isFinite(k) || k <= 1) return { ok: false, error: "The specific-heat ratio must be greater than 1." };
  if (!Number.isFinite(staticTempK) || staticTempK <= 0) {
    return { ok: false, error: "The static temperature must be above absolute zero." };
  }

  const m2 = mach * mach;
  const temperatureRatio = 1 + ((k - 1) / 2) * m2;
  const pressureRatio = Math.pow(temperatureRatio, k / (k - 1));
  const densityRatio = Math.pow(temperatureRatio, 1 / (k - 1));
  const R = 287.0;
  const speedOfSound = Math.sqrt(k * R * staticTempK);
  const criticalPressureRatio = Math.pow(2 / (k + 1), k / (k - 1));

  let areaRatio = Infinity;
  if (mach > 0) {
    areaRatio = (1 / mach) * Math.pow((2 / (k + 1)) * temperatureRatio, (k + 1) / (2 * (k - 1)));
  }

  const regime = mach > 1.001 ? "supersonic" : mach < 0.999 ? "subsonic" : "sonic";
  const notes: string[] = [];

  if (regime === "sonic") {
    notes.push(
      "At Mach 1 the flow is CHOKED. Lowering the downstream pressure any further does not increase " +
        "the mass flow — that information cannot travel upstream against sonic flow. It is the most " +
        "useful single fact in sizing a relief valve or an orifice.",
    );
  } else if (regime === "supersonic") {
    notes.push(
      "SUPERSONIC. Area and velocity now behave BACKWARDS from intuition: a diverging duct " +
        "accelerates the flow and a converging one decelerates it, which is why a supersonic nozzle " +
        "has a throat and then widens. Note also that a supersonic flow meeting a back pressure " +
        "usually contains a shock, and none of these isentropic relations holds across one.",
    );
  } else if (mach > 0.3) {
    notes.push(
      "Above about Mach 0.3 compressibility matters: density changes by more than 5%, so an " +
        "incompressible Bernoulli analysis is beginning to be wrong.",
    );
  } else if (mach > 0) {
    notes.push(
      "Below about Mach 0.3 the flow is effectively incompressible — density varies by under 5% — " +
        "so a simple Bernoulli analysis is adequate and much easier.",
    );
  }

  notes.push(
    "A nozzle chokes once the downstream absolute pressure falls below the critical fraction of the " +
      "upstream stagnation pressure. For air that is 0.528, so any discharge to atmosphere from " +
      "above about 1.9 bar absolute is already choked.",
  );
  notes.push(
    "These are ISENTROPIC relations — no friction, no heat transfer, no shocks — and none of them " +
      "holds across a normal shock, which is not isentropic.",
  );

  return {
    ok: true,
    mach,
    regime,
    temperatureRatio,
    pressureRatio,
    densityRatio,
    speedOfSound,
    areaRatio,
    criticalPressureRatio,
    choked: mach >= 0.999,
    notes,
  };
}
