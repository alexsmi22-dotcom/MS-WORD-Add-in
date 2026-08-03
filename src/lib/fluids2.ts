// Fluids, second module — flow measurement, pump and system curves, the
// affinity laws, and drag on a body. `fluids.ts` holds pipe friction, open
// channels, NPSH and compressible flow.
//
// A DIFFERENTIAL METER MEASURES A PRESSURE DROP, NOT A FLOW. It infers one from
// the other through a discharge coefficient that accounts for the vena
// contracta — the jet keeps contracting past the hole, so the smallest flow
// area is not the hole's area — and for the friction the ideal derivation
// leaves out. Cd is close to 0.6 for a sharp-edged orifice and close to 0.98
// for a venturi, and it is a MEASURED input here for the same reason drag
// coefficients are: it depends on the exact geometry, the Reynolds number and
// the tappings, and a built-in number would be wrong for every installation
// except the one it was calibrated on.
//
// THE PERMANENT LOSS IS NOT THE MEASURED DIFFERENTIAL. Most of the pressure a
// venturi takes to accelerate the flow is recovered in its diffuser, so its
// permanent loss is a small fraction of the differential it reads. An orifice
// recovers almost nothing. That difference is the entire argument for a
// venturi, and it is invisible if you only look at the flow both of them
// report.
//
// THROTTLING MOVES THE OPERATING POINT UP THE PUMP CURVE. Closing a valve does
// not slow the pump; it steepens the system curve, and the intersection slides
// to a lower flow at a HIGHER head. The extra head is burned across the valve
// and does nothing. That is why a variable-speed drive saves what it does, and
// the affinity laws say how much: flow scales with speed, head with its square,
// and POWER WITH ITS CUBE, so a 20% speed reduction roughly halves the power.
//
// Units are strict SI throughout: metres, seconds, kilograms, pascals, watts.

import { G } from "./fluids";

export interface Fluids2Error {
  ok: false;
  error: string;
}

const finite = (pairs: [string, number][]): Fluids2Error | null => {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  return null;
};

const positive = (pairs: [string, number][]): Fluids2Error | null => {
  const bad = finite(pairs);
  if (bad) return bad;
  for (const [name, v] of pairs) {
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
};

// ---------------------------------------------------------------------------
// 1. Differential-pressure flow meters
// ---------------------------------------------------------------------------

export type MeterKind = "orifice" | "venturi" | "nozzle";

export interface MeterInput {
  kind: MeterKind;
  /** Pipe internal diameter, m. */
  pipeD: number;
  /** Throat or bore diameter, m. */
  throatD: number;
  /** Measured differential pressure, Pa. */
  deltaP: number;
  /** Density, kg/m^3. */
  rho: number;
  /** Discharge coefficient — MEASURED, not predicted. */
  cd: number;
  /** Expansibility factor for a compressible fluid; 1 for a liquid. */
  epsilon?: number;
}

export interface MeterResult {
  ok: true;
  /** Diameter ratio d/D. */
  beta: number;
  /** Velocity-of-approach factor 1/sqrt(1 - beta^4). */
  approachFactor: number;
  /** Volumetric flow, m^3/s. */
  Q: number;
  /** Mass flow, kg/s. */
  massFlow: number;
  /** Mean velocity in the throat and in the pipe, m/s. */
  throatVelocity: number;
  pipeVelocity: number;
  /** Permanent pressure loss, Pa — NOT the measured differential. */
  permanentLoss: number;
  /** Permanent loss as a fraction of the differential. */
  lossFraction: number;
  notes: string[];
}

/**
 * Flow from a measured differential across an orifice, venturi or nozzle.
 *
 * THE VELOCITY-OF-APPROACH FACTOR IS NOT OPTIONAL. The ideal derivation assumes
 * the fluid arrives at rest, and it does not — it is already moving in the
 * pipe. The correction 1/sqrt(1 − β⁴) is negligible for a small bore and
 * emphatically not for a large one: at β = 0.75 it is 1.19, so leaving it out
 * under-reads the flow by 16%.
 */
export function flowMeter(inp: MeterInput): MeterResult | Fluids2Error {
  const bad = positive([
    ["pipe diameter", inp.pipeD],
    ["throat diameter", inp.throatD],
    ["density", inp.rho],
    ["discharge coefficient", inp.cd],
  ]);
  if (bad) return bad;
  const dp = finite([["differential pressure", inp.deltaP]]);
  if (dp) return dp;
  if (inp.deltaP < 0) {
    return { ok: false, error: "The differential pressure cannot be negative; swap the tappings." };
  }
  if (inp.throatD >= inp.pipeD) {
    return {
      ok: false,
      error:
        "The throat is not smaller than the pipe, so there is nothing to accelerate the flow and " +
        "no differential to measure. Check which diameter is which.",
    };
  }
  if (inp.cd > 1.05) {
    return {
      ok: false,
      error:
        `A discharge coefficient of ${inp.cd} is above 1, which would mean more flow than the ` +
        "ideal frictionless case. Values run about 0.6 for a sharp-edged orifice and about 0.98 " +
        "for a venturi.",
    };
  }
  const eps = inp.epsilon ?? 1;
  if (!Number.isFinite(eps) || eps <= 0 || eps > 1.0001) {
    return { ok: false, error: "The expansibility factor must be above 0 and at most 1 (use 1 for a liquid)." };
  }

  const beta = inp.throatD / inp.pipeD;
  const b4 = Math.pow(beta, 4);
  const approach = 1 / Math.sqrt(1 - b4);
  const aThroat = (Math.PI * inp.throatD * inp.throatD) / 4;
  const aPipe = (Math.PI * inp.pipeD * inp.pipeD) / 4;
  const Q = inp.cd * eps * approach * aThroat * Math.sqrt((2 * inp.deltaP) / inp.rho);
  if (!Number.isFinite(Q)) {
    return { ok: false, error: "Those inputs overflow the arithmetic. Check the magnitudes." };
  }

  // Permanent loss. The orifice recovers almost nothing; the venturi's diffuser
  // recovers most of it. These are the standard fractions of the measured
  // differential, and the venturi one is why venturis exist at all.
  let lossFraction: number;
  if (inp.kind === "venturi") lossFraction = 0.1 + 0.05 * beta;
  else if (inp.kind === "nozzle") lossFraction = 1 - b4 * 0.75 - beta * 0.15;
  else lossFraction = 1 - b4 * 0.6 - beta * 0.05;
  lossFraction = Math.min(1, Math.max(0.05, lossFraction));

  const notes: string[] = [
    `β = d/D = ${beta.toFixed(3)}, and the velocity-of-approach factor is ${approach.toFixed(4)}. ` +
      "The ideal derivation assumes the fluid arrives at rest and it does not - it is already " +
      "moving in the pipe. Leaving that factor out under-reads the flow, by 16% at β = 0.75.",
    `Cd = ${inp.cd} is YOUR measured or certified value, not a prediction. It absorbs the vena ` +
      "contracta - the jet keeps contracting past the hole, so the smallest flow area is not the " +
      "hole's area - and the friction the ideal derivation omits. It depends on geometry, " +
      "Reynolds number and the tappings, so a built-in figure would be wrong for every " +
      "installation but one.",
    `PERMANENT LOSS IS ${(lossFraction * 100).toFixed(0)}% OF THE DIFFERENTIAL, not all of it. ` +
      (inp.kind === "venturi"
        ? "A venturi's diffuser recovers most of the pressure it took to accelerate the flow, " +
          "which is the entire reason to pay for one."
        : "An orifice recovers very little - the jet dissipates into the downstream turbulence. " +
          "A venturi reading the same flow would lose a small fraction of this."),
  ];
  if (beta > 0.75) {
    notes.push(
      `β = ${beta.toFixed(2)} is above the 0.75 that standards generally cap at: the coefficient ` +
        "becomes sensitive to installation and the uncertainty grows quickly.",
    );
  }
  if (beta < 0.2) {
    notes.push(
      `β = ${beta.toFixed(2)} is very small, so the differential is large and so is the permanent ` +
        "loss. That pressure is paid for continuously by the pump.",
    );
  }
  if (eps < 1) {
    notes.push(
      "An expansibility factor below 1 says the fluid is compressible and expands through the " +
        "meter. It is a measured or standard-derived value, like Cd.",
    );
  }

  return {
    ok: true,
    beta,
    approachFactor: approach,
    Q,
    massFlow: Q * inp.rho,
    throatVelocity: Q / aThroat,
    pipeVelocity: Q / aPipe,
    permanentLoss: lossFraction * inp.deltaP,
    lossFraction,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 2. Pump and system curves
// ---------------------------------------------------------------------------

export interface PumpSystemInput {
  /** Pump shut-off head (at zero flow), m. */
  shutOffHead: number;
  /** Flow at which the pump head reaches zero, m^3/s — sets the curve's width. */
  maxFlow: number;
  /** Static lift the system must overcome, m. */
  staticHead: number;
  /** System resistance coefficient K in h = hstat + K*Q^2, s^2/m^5. */
  resistanceK: number;
  /** Pump efficiency at the operating point, 0-1. */
  efficiency?: number;
  /** Density, kg/m^3. */
  rho?: number;
  /** A throttled case for comparison: multiply K by this. 1 = no throttling. */
  throttleFactor?: number;
}

export interface PumpSystemResult {
  ok: true;
  /** Operating flow and head where the curves cross. */
  flow: number;
  head: number;
  /** Hydraulic and shaft power at that point, W. */
  hydraulicPower: number;
  shaftPower: number | null;
  /** The throttled operating point, when a throttle factor was given. */
  throttled: { flow: number; head: number; shaftPower: number | null; wastedW: number | null } | null;
  /** Sampled curves for plotting. */
  pumpCurve: { q: number; h: number }[];
  systemCurve: { q: number; h: number }[];
  notes: string[];
}

/**
 * Where a pump actually runs: the intersection of its curve with the system's.
 *
 * A PUMP HAS NO FLOW RATE OF ITS OWN. It has a curve, and the system it is
 * connected to has another, and the machine runs where they cross — which is
 * why the same pump moves different amounts in different installations and why
 * a datasheet flow figure alone means nothing.
 *
 * THROTTLING MOVES THE POINT UP THE PUMP CURVE, not down. Closing a valve
 * steepens the system curve, so the intersection slides to a lower flow at a
 * HIGHER head, and the extra head is burned across the valve doing nothing.
 * That waste is quantified here, because it is the number that justifies a
 * variable-speed drive.
 */
export function pumpSystemCurve(inp: PumpSystemInput): PumpSystemResult | Fluids2Error {
  const bad = positive([
    ["shut-off head", inp.shutOffHead],
    ["maximum flow", inp.maxFlow],
  ]);
  if (bad) return bad;
  const f = finite([
    ["static head", inp.staticHead],
    ["resistance coefficient", inp.resistanceK],
  ]);
  if (f) return f;
  if (inp.resistanceK < 0) return { ok: false, error: "The resistance coefficient cannot be negative." };
  if (inp.staticHead < 0) return { ok: false, error: "The static head cannot be negative here." };
  if (inp.staticHead >= inp.shutOffHead) {
    return {
      ok: false,
      error:
        `The static lift (${inp.staticHead} m) is at or above the pump's shut-off head ` +
        `(${inp.shutOffHead} m), so this pump cannot lift the liquid at all - there is no flow at ` +
        "any valve setting. A taller pump or a lower lift is needed.",
    };
  }
  const eta = inp.efficiency ?? 0;
  if (eta < 0 || eta > 1) return { ok: false, error: "The efficiency must be between 0 and 1." };
  const rho = inp.rho ?? 998;
  if (!(rho > 0)) return { ok: false, error: "The density must be greater than zero." };

  // Pump: h = H0 * (1 - (Q/Qmax)^2). System: h = hstat + K*Q^2.
  // Setting them equal is a quadratic in Q^2, solvable in closed form.
  const H0 = inp.shutOffHead;
  const a = H0 / (inp.maxFlow * inp.maxFlow);
  const solveFor = (k: number): { q: number; h: number } | null => {
    // H0 - a Q^2 = hstat + k Q^2  =>  Q^2 = (H0 - hstat)/(a + k)
    const q2 = (H0 - inp.staticHead) / (a + k);
    if (!(q2 > 0) || !Number.isFinite(q2)) return null;
    const q = Math.sqrt(q2);
    return { q, h: inp.staticHead + k * q2 };
  };
  const op = solveFor(inp.resistanceK);
  if (!op) return { ok: false, error: "Those curves do not intersect at a positive flow." };

  const power = (q: number, h: number) => rho * G * q * h;
  const hyd = power(op.q, op.h);
  const shaft = eta > 0 ? hyd / eta : null;

  let throttled: PumpSystemResult["throttled"] = null;
  const tf = inp.throttleFactor ?? 1;
  if (Number.isFinite(tf) && tf > 1) {
    const t = solveFor(inp.resistanceK * tf);
    if (t) {
      const tHyd = power(t.q, t.h);
      const tShaft = eta > 0 ? tHyd / eta : null;
      // The head the valve destroys is the difference between where the pump
      // now sits and the head the unthrottled system needs at that same flow.
      const systemNeeds = inp.staticHead + inp.resistanceK * t.q * t.q;
      const wasted = eta > 0 ? (rho * G * t.q * (t.h - systemNeeds)) / eta : null;
      throttled = { flow: t.q, head: t.h, shaftPower: tShaft, wastedW: wasted };
    }
  }

  const N = 60;
  const qMax = Math.max(inp.maxFlow, op.q * 1.3);
  const pumpCurve = Array.from({ length: N + 1 }, (_, i) => {
    const q = (qMax * i) / N;
    return { q, h: Math.max(0, H0 - a * q * q) };
  });
  const systemCurve = Array.from({ length: N + 1 }, (_, i) => {
    const q = (qMax * i) / N;
    return { q, h: inp.staticHead + inp.resistanceK * q * q };
  });

  const notes: string[] = [
    "A PUMP HAS NO FLOW RATE OF ITS OWN. It has a curve, the system has another, and the machine " +
      "runs where they cross - which is why the same pump moves different amounts in different " +
      "installations and why a datasheet flow figure alone means nothing.",
    `The static lift of ${inp.staticHead} m is paid before any flow moves at all. Only the ` +
      `remaining ${(op.h - inp.staticHead).toPrecision(3)} m goes on friction, and that part grows ` +
      "with the square of the flow.",
  ];
  if (throttled) {
    notes.push(
      `THROTTLING MOVED THE POINT UP THE PUMP CURVE, not down: flow fell from ` +
        `${op.q.toPrecision(3)} to ${throttled.flow.toPrecision(3)} m³/s while head ROSE from ` +
        `${op.h.toPrecision(3)} to ${throttled.head.toPrecision(3)} m. Closing a valve does not ` +
        "slow the pump; it steepens the system curve.",
    );
    if (throttled.wastedW !== null) {
      notes.push(
        `${(throttled.wastedW / 1000).toPrecision(3)} kW is burned across the valve doing nothing. ` +
          "That number is the argument for a variable-speed drive - see the affinity laws, where " +
          "power scales with the CUBE of speed.",
      );
    }
  }
  notes.push(
    "The pump curve is modelled as h = H0(1 − (Q/Qmax)²), which is the usual shape for a " +
      "centrifugal machine and is NOT your pump's certified curve. Use the manufacturer's points " +
      "when the answer matters.",
  );

  return {
    ok: true,
    flow: op.q,
    head: op.h,
    hydraulicPower: hyd,
    shaftPower: shaft,
    throttled,
    pumpCurve,
    systemCurve,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 3. Affinity laws
// ---------------------------------------------------------------------------

export interface AffinityInput {
  /** Known operating point. */
  flow1: number;
  head1: number;
  power1: number;
  /** Speeds, any consistent unit. */
  speed1: number;
  speed2: number;
  /** Impeller diameters, any consistent unit. Equal when only speed changes. */
  diameter1?: number;
  diameter2?: number;
}

export interface AffinityResult {
  ok: true;
  flow2: number;
  head2: number;
  power2: number;
  speedRatio: number;
  diameterRatio: number;
  /** Fraction of the original power the new point draws. */
  powerFraction: number;
  notes: string[];
}

/**
 * Scaling a pump or fan to a new speed or impeller diameter.
 *
 * POWER SCALES WITH THE CUBE. Flow goes as N, head as N², and power as N³ — so
 * a 20% speed reduction leaves 51% of the power, and halving the speed leaves
 * an eighth. That single exponent is the whole economic case for variable-speed
 * drives, and it is the reason throttling a valve to control flow is such an
 * expensive habit.
 */
export function affinityLaws(inp: AffinityInput): AffinityResult | Fluids2Error {
  const bad = positive([
    ["first speed", inp.speed1],
    ["second speed", inp.speed2],
  ]);
  if (bad) return bad;
  const f = finite([
    ["flow", inp.flow1],
    ["head", inp.head1],
    ["power", inp.power1],
  ]);
  if (f) return f;
  const d1 = inp.diameter1 ?? 1;
  const d2 = inp.diameter2 ?? d1;
  if (!(d1 > 0) || !(d2 > 0)) return { ok: false, error: "Both impeller diameters must be greater than zero." };

  const n = inp.speed2 / inp.speed1;
  const d = d2 / d1;
  const flow2 = inp.flow1 * n * Math.pow(d, 3);
  const head2 = inp.head1 * n * n * d * d;
  const power2 = inp.power1 * Math.pow(n, 3) * Math.pow(d, 5);
  if (![flow2, head2, power2].every(Number.isFinite)) {
    return { ok: false, error: "Those ratios overflow the arithmetic. Check the magnitudes." };
  }
  const frac = inp.power1 > 0 ? power2 / inp.power1 : NaN;

  const notes: string[] = [
    `Speed ratio ${n.toFixed(4)}: flow scales with it, head with its SQUARE and power with its ` +
      `CUBE. Here that is ${n.toFixed(3)}, ${(n * n).toFixed(3)} and ${Math.pow(n, 3).toFixed(3)}.`,
  ];
  if (Number.isFinite(frac)) {
    if (n < 1) {
      notes.push(
        `Running at ${(n * 100).toFixed(0)}% speed draws ${(frac * 100).toFixed(1)}% of the power. ` +
          "THAT CUBE IS THE ENTIRE CASE FOR A VARIABLE-SPEED DRIVE: a modest speed reduction is a " +
          "large power saving, and throttling a valve to get the same flow saves none of it.",
      );
    } else if (n > 1) {
      notes.push(
        `Running at ${(n * 100).toFixed(0)}% speed draws ${(frac * 100).toFixed(1)}% of the power. ` +
          "Speeding a machine up is expensive in the same cubic way, and the motor must be able " +
          "to deliver it.",
      );
    }
  }
  if (d !== 1) {
    notes.push(
      `Diameter ratio ${d.toFixed(4)}: trimming an impeller scales flow with D³, head with D² and ` +
        "power with D⁵ on the strict laws. Real trimming departs from this because the casing " +
        "does not shrink with the impeller, so treat a large trim as indicative.",
    );
  }
  notes.push(
    "The affinity laws assume geometric similarity and constant efficiency. Efficiency does fall " +
      "away from the best point and at low speed, so a large change is an estimate rather than a " +
      "guarantee.",
  );

  return { ok: true, flow2, head2, power2, speedRatio: n, diameterRatio: d, powerFraction: frac, notes };
}

// ---------------------------------------------------------------------------
// 4. Drag on a body
// ---------------------------------------------------------------------------

export interface BodyDragInput {
  /** Relative velocity, m/s. */
  velocity: number;
  /** Fluid density, kg/m^3. */
  rho: number;
  /** Reference (frontal) area, m^2. */
  area: number;
  /** Drag coefficient — MEASURED, not predicted. */
  cd: number;
  /** Mass, kg; gives a terminal velocity when present. */
  mass?: number;
  /** Dynamic viscosity, Pa*s, and a characteristic length for the Reynolds number. */
  mu?: number;
  length?: number;
}

export interface BodyDragResult {
  ok: true;
  /** Drag force, N. */
  drag: number;
  /** Power needed to overcome it at that speed, W. */
  power: number;
  /** Dynamic pressure, Pa. */
  dynamicPressure: number;
  /** Terminal velocity in free fall, m/s; null without a mass. */
  terminalVelocity: number | null;
  /** Reynolds number; null without a viscosity and length. */
  reynolds: number | null;
  notes: string[];
}

/**
 * Drag force, the power to overcome it, and terminal velocity.
 *
 * POWER GOES AS THE CUBE OF SPEED, because drag goes as the square and power is
 * force times speed. Doubling the speed of a vehicle takes EIGHT times the
 * power to hold it, which is why top speed is so expensive and why a modest
 * speed reduction saves so much fuel.
 */
export function bodyDrag(inp: BodyDragInput): BodyDragResult | Fluids2Error {
  const bad = positive([
    ["density", inp.rho],
    ["reference area", inp.area],
    ["drag coefficient", inp.cd],
  ]);
  if (bad) return bad;
  const f = finite([["velocity", inp.velocity]]);
  if (f) return f;
  if (inp.cd > 5) {
    return {
      ok: false,
      error:
        `A drag coefficient of ${inp.cd} is outside any physical range - a flat plate is about ` +
        "1.3 and a sphere about 0.47. Check the value.",
    };
  }

  const q = 0.5 * inp.rho * inp.velocity * inp.velocity;
  const drag = q * inp.cd * inp.area;
  const power = drag * Math.abs(inp.velocity);
  if (![q, drag, power].every(Number.isFinite)) {
    return { ok: false, error: "Those inputs overflow the arithmetic. Check the magnitudes." };
  }

  let terminal: number | null = null;
  if (inp.mass !== undefined) {
    if (!Number.isFinite(inp.mass) || inp.mass <= 0) {
      return { ok: false, error: "The mass must be greater than zero." };
    }
    terminal = Math.sqrt((2 * inp.mass * G) / (inp.rho * inp.cd * inp.area));
    if (!Number.isFinite(terminal)) terminal = null;
  }

  let re: number | null = null;
  if (inp.mu !== undefined && inp.length !== undefined) {
    if (!(inp.mu > 0) || !(inp.length > 0)) {
      return { ok: false, error: "The viscosity and the characteristic length must both be greater than zero." };
    }
    re = (inp.rho * Math.abs(inp.velocity) * inp.length) / inp.mu;
  }

  const notes: string[] = [
    "POWER GOES AS THE CUBE OF SPEED: drag rises with the square and power is force times speed. " +
      "Doubling the speed takes EIGHT times the power to hold, which is why top speed costs what " +
      "it does and why easing off saves so much.",
    "Cd is YOUR measured input. It varies with shape, Reynolds number and Mach number, and a " +
      "built-in table would be wrong for every body except the one it was measured on.",
  ];
  if (terminal !== null) {
    notes.push(
      `Terminal velocity is ${terminal.toPrecision(4)} m/s, where drag balances weight. It does ` +
        "NOT depend on how far the body has fallen, and beyond a few hundred metres a falling " +
        "object gains no more speed however far it drops.",
    );
  }
  if (re !== null) {
    notes.push(
      `Reynolds number ${re.toPrecision(4)}. Cd is a function of it, so a coefficient quoted at ` +
        "one Reynolds number does not transfer to another - the drag crisis on a sphere drops Cd " +
        "from about 0.5 to about 0.1 across a narrow band near Re = 3e5.",
    );
  }

  return {
    ok: true,
    drag,
    power,
    dynamicPressure: q,
    terminalVelocity: terminal,
    reynolds: re,
    notes,
  };
}
