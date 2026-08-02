// Trajectories: projectile motion with and without drag, the inverse aiming
// problem, jerk-limited motion profiles, and great-circle navigation.
//
// DRAG IS NOT A CORRECTION. For anything small, fast or light it is the
// dominant term: a rifle bullet's vacuum range is several times its real range,
// and the optimum launch angle falls well below 45°. Both the vacuum closed
// form and the numerical drag solution are provided so the difference is
// visible rather than assumed away.
//
// Cd IS A USER INPUT. The drag coefficient depends on shape, Mach number and
// Reynolds number; a built-in table would be wrong for every projectile except
// the one it was measured on. Same refusal as absorption coefficients in
// audio.ts and Thiele-Small parameters.
//
// g AND THE ATMOSPHERE ARE REUSED, NOT REDEFINED — `fluids.G` and
// `aero.atmosphere` — so the trajectory bench and the aviation bench cannot
// disagree about gravity or air density.

import { G } from "./fluids";
import { atmosphere } from "./aero";
import { solveOde } from "./ode";

export interface TrajectoryError {
  ok: false;
  error: string;
}

const DEG = Math.PI / 180;

/** Top of the ISA, m. Above this `aero.atmosphere` has no model and returns null. */
export const ISA_CEILING_M = 84852;

/** A number rounded for an error message, where four figures is plenty. */
const engRound = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : "an unusable");

/**
 * Guards the OUTPUTS, not the inputs.
 *
 * Every input can be finite and legal and the arithmetic still overflow — a
 * launch speed of 1e155 squares to infinity, and an orbital radius past about
 * 5.6e102 cubes to it. Returning `ok: true` with an infinite range is worse
 * than refusing: the pane prints an em-dash for a non-finite number, and that
 * em-dash then blocks insertion with nothing to explain why.
 */
function finiteResult(values: number[]): TrajectoryError | null {
  return values.every((v) => Number.isFinite(v))
    ? null
    : {
        ok: false,
        error:
          "Those inputs overflow the arithmetic and produce a result that is not a finite number. " +
          "Check the magnitudes you entered.",
      };
}

function finitePositive(pairs: [string, number][]): TrajectoryError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

export interface VacuumShotResult {
  ok: true;
  rangeM: number;
  apexM: number;
  flightTimeS: number;
  impactSpeedMs: number;
  impactAngleDeg: number;
  /** Angle giving maximum range for these launch/landing heights, degrees. */
  optimumAngleDeg: number;
  maxRangeM: number;
  notes: string[];
}

/**
 * Projectile in a vacuum, allowing for a launch height above the landing plane.
 *
 * 45° IS OPTIMAL ONLY WHEN LAUNCH AND LANDING HEIGHTS ARE EQUAL. Throwing from
 * a height, the best angle is lower — the projectile gets extra flight time for
 * free from the drop, so trading launch elevation for horizontal speed pays.
 * The familiar 45° is a special case of
 *   θ_opt = arctan( v / √(v² + 2gh) )
 * which reduces to 45° exactly when h = 0.
 */
export function vacuumShot(
  speedMs: number,
  angleDeg: number,
  launchHeightM = 0,
): VacuumShotResult | TrajectoryError {
  const bad = finitePositive([["launch speed", speedMs]]);
  if (bad) return bad;
  if (!Number.isFinite(angleDeg) || angleDeg <= -90 || angleDeg >= 90) {
    return { ok: false, error: "The launch angle must be between -90 and 90 degrees." };
  }
  if (!Number.isFinite(launchHeightM) || launchHeightM < 0) {
    return { ok: false, error: "The launch height must be zero or more." };
  }

  const th = angleDeg * DEG;
  const vx = speedMs * Math.cos(th);
  const vy = speedMs * Math.sin(th);
  // Time to return to y = 0 from y = h: solve h + vy t - g t²/2 = 0.
  const disc = vy * vy + 2 * G * launchHeightM;
  const t = (vy + Math.sqrt(disc)) / G;
  const range = vx * t;
  const apex = launchHeightM + (vy > 0 ? (vy * vy) / (2 * G) : 0);
  const vyImpact = vy - G * t;
  const impactSpeed = Math.hypot(vx, vyImpact);
  const impactAngle = (Math.atan2(-vyImpact, vx) * 180) / Math.PI;

  const optimum = (Math.atan(speedMs / Math.sqrt(speedMs * speedMs + 2 * G * launchHeightM)) * 180) / Math.PI;
  const optTh = optimum * DEG;
  const optVy = speedMs * Math.sin(optTh);
  const optT = (optVy + Math.sqrt(optVy * optVy + 2 * G * launchHeightM)) / G;
  const maxRange = speedMs * Math.cos(optTh) * optT;

  const over = finiteResult([range, apex, t, impactSpeed, maxRange]);
  if (over) return over;

  const notes: string[] = [
    launchHeightM > 0
      ? `Launching from ${launchHeightM} m, the maximum-range angle is ${optimum.toFixed(1)}°, ` +
        "NOT 45°. The drop buys extra flight time for free, so trading elevation for horizontal " +
        "speed pays. 45° is the special case of h = 0."
      : "With equal launch and landing heights the maximum-range angle is 45°, and this is the " +
        "only case where that familiar answer holds.",
    "VACUUM. No drag at all. For anything small, fast or light this overstates the range badly — " +
      "a rifle bullet's vacuum range is several times its real one. Use the drag calculator " +
      "unless the projectile is heavy and slow.",
    `Gravity taken as ${G} m/s², the same constant the fluids and energy benches use.`,
  ];
  return {
    ok: true,
    rangeM: range,
    apexM: apex,
    flightTimeS: t,
    impactSpeedMs: impactSpeed,
    impactAngleDeg: impactAngle,
    optimumAngleDeg: optimum,
    maxRangeM: maxRange,
    notes,
  };
}

export interface DragShotResult {
  ok: true;
  rangeM: number;
  apexM: number;
  flightTimeS: number;
  impactSpeedMs: number;
  /** The same shot with no drag, for comparison. Null when there is none to quote. */
  vacuumRangeM: number | null;
  /** Fraction of the vacuum range actually achieved. Null when undefined. */
  rangeFraction: number | null;
  /** Sampled path, for plotting. */
  path: { x: number; y: number }[];
  notes: string[];
}

/**
 * Projectile with quadratic drag, integrated numerically.
 *
 * Uses `solveOde` with a TERMINAL EVENT on ground contact — the same mechanism
 * and the same hard-won fix that stopped trajectories continuing underground
 * after the crossing step. Air density comes from `aero.atmosphere`, so it
 * thins with altitude exactly as the aviation bench says it does.
 *
 * The vacuum range is computed alongside and reported as a ratio, because the
 * point of this calculator is the size of the difference.
 */
export function dragShot(
  speedMs: number,
  angleDeg: number,
  massKg: number,
  areaM2: number,
  dragCoefficient: number,
  launchHeightM = 0,
): DragShotResult | TrajectoryError {
  const bad = finitePositive([
    ["launch speed", speedMs],
    ["mass", massKg],
    ["reference area", areaM2],
    ["drag coefficient", dragCoefficient],
  ]);
  if (bad) return bad;
  if (!Number.isFinite(angleDeg) || angleDeg <= -90 || angleDeg >= 90) {
    return { ok: false, error: "The launch angle must be between -90 and 90 degrees." };
  }
  if (!Number.isFinite(launchHeightM) || launchHeightM < 0) {
    return { ok: false, error: "The launch height must be zero or more." };
  }
  if (dragCoefficient > 5) {
    return { ok: false, error: `A drag coefficient of ${dragCoefficient} is beyond any real shape (a flat plate is about 1.3).` };
  }
  // A level or downward launch from ground level has no flight to integrate:
  // the projectile is already at the ground and moving into it. Refused rather
  // than integrated, because the ground event needs a strict sign change and
  // would never fire — leaving an entirely subterranean "trajectory".
  if (launchHeightM === 0 && angleDeg <= 0) {
    return {
      ok: false,
      error:
        "A level or downward launch from ground level has no flight. Give a launch height above " +
        "the landing plane, or an upward angle.",
    };
  }

  const th = angleDeg * DEG;
  // State: [x, y, vx, vy].
  const y0 = [0, launchHeightM, speedMs * Math.cos(th), speedMs * Math.sin(th)];
  const k = (dragCoefficient * areaM2) / (2 * massKg);

  const deriv = (_t: number, s: number[]): number[] => {
    const [, y, vx, vy] = s;
    const atm = atmosphere(Math.max(0, y));
    const rho = atm ? atm.densityKgM3 : 0;
    const v = Math.hypot(vx, vy);
    const a = k * rho * v;
    return [vx, vy, -a * vx, -a * vy - G];
  };

  const groundEvent = { g: (_t: number, st: number[]) => st[1], direction: -1, terminal: true, name: "ground" };
  // A SECOND, NON-TERMINAL event on the vertical velocity, purely to locate the
  // apex. RK45 integrates a near-ballistic arc so accurately that it takes only
  // a handful of enormous steps, and none of them lands near the vertex — so
  // the maximum over the samples UNDER-reports the apex, by 15% on a shot put
  // and 40% on a dense low-drag shot. The event is bisected to solver tolerance,
  // which the samples never are.
  const apexEvent = { g: (_t: number, st: number[]) => st[3], direction: -1, terminal: false, name: "apex" };

  // THE VACUUM FLIGHT TIME IS NOT AN UPPER BOUND. Drag shortens the ascent but
  // lengthens the descent, because the fall settles towards terminal speed
  // instead of accelerating without limit — a ping-pong ball off a 1000 m cliff
  // takes 118 s against a vacuum 14 s. Integrating to a fixed multiple of the
  // vacuum time therefore returns a MID-AIR state labelled as ground impact,
  // and the solver reports success while doing it. So the horizon is grown
  // until the ground event actually fires, and if it never does the tool
  // refuses rather than reporting where the projectile happened to be.
  const vy0 = speedMs * Math.sin(th);
  let horizon = 3 * ((vy0 + Math.sqrt(vy0 * vy0 + 2 * G * launchHeightM)) / G) + 1;
  let sol = null as ReturnType<typeof solveOde> | null;
  let hit: { t: number; y: number[] } | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    sol = solveOde(deriv, y0, 0, horizon, { events: [groundEvent, apexEvent], maxSteps: 200000 });
    hit = (sol.events ?? []).find((e) => e.name === "ground");
    if (hit) break;
    horizon *= 4;
  }
  if (!sol || !sol.t.length) {
    return { ok: false, error: "The trajectory could not be integrated for those inputs." };
  }
  if (!hit) {
    return {
      ok: false,
      error:
        `The projectile had not reached the ground after ${engRound(horizon)} s of flight, so there ` +
        "is no impact to report. That usually means the drag is so high relative to the mass that " +
        "the descent is extremely slow. Refused rather than reporting a mid-air position as a landing.",
    };
  }

  const path = sol.y.map((st) => ({ x: st[0], y: st[1] }));
  // The path ends where the solver stopped; append the located impact so the
  // plotted curve genuinely reaches the ground.
  path.push({ x: hit.y[0], y: hit.y[1] });
  const apexHit = (sol.events ?? []).find((e) => e.name === "apex");
  // No apex event means the projectile never stopped climbing before impact,
  // i.e. it was falling from the start — then the launch point IS the apex.
  const apex = apexHit ? apexHit.y[1] : Math.max(...sol.y.map((st) => st[1]), launchHeightM);
  const impactSpeed = Math.hypot(hit.y[2], hit.y[3]);
  const range = hit.y[0];
  const flightTime = hit.t;

  // ABOVE THE ISA CEILING THERE IS NO MODEL, and `atmosphere` returns null.
  // Treating that as vacuum would silently integrate a hundred kilometres of
  // flight with no drag at all while the notes claim standard-atmosphere
  // density — and with constant g and a flat Earth besides. Refused, which is
  // what the aviation bench does at the same altitude.
  if (apex > ISA_CEILING_M) {
    return {
      ok: false,
      error:
        `The trajectory reaches ${engRound(apex)} m, above the ${ISA_CEILING_M} m ceiling of the ` +
        "standard atmosphere. There is no air model above that, and constant gravity over a flat " +
        "Earth stops being a fair approximation too. Refused rather than integrated as a vacuum.",
    };
  }

  const vac = vacuumShot(speedMs, angleDeg, launchHeightM);
  const vacuumRange = vac.ok ? vac.rangeM : null;
  const fraction = vacuumRange !== null && vacuumRange > 0 ? range / vacuumRange : null;

  const nonFinite = [range, apex, flightTime, impactSpeed].some((x) => !Number.isFinite(x));
  if (nonFinite) {
    return {
      ok: false,
      error:
        "Those inputs overflow the arithmetic and produce a result that is not a finite number. " +
        "Check the magnitudes of the speed, mass and area.",
    };
  }

  const notes: string[] = [
    `Drag reduces the range to ${fraction !== null ? (fraction * 100).toFixed(1) + "%" : "an unknown fraction"} ` +
      "of the vacuum figure. Drag is not a correction — for anything small, fast or light it is " +
      "the dominant term.",
    "Quadratic drag, F = ½ρv²CdA, with density from the standard atmosphere so it thins with " +
      "height exactly as the aviation tools say. No wind, no lift, no spin, no Magnus effect.",
    "Cd is YOUR input and is not constant in reality: it varies with Mach number and Reynolds " +
      "number, and rises sharply near Mach 1. A single value is an approximation over the " +
      "whole flight.",
    "The flight time, range and apex are located by bisected events rather than read off the " +
      "integration samples, so the shot stops exactly at the ground and the apex is the real " +
      "vertex rather than the highest step the solver happened to take.",
  ];
  if (speedMs > 250) {
    notes.push(
      "Above about Mach 0.7 the drag coefficient changes rapidly with speed, so a single Cd " +
        "becomes a poor model. Treat transonic and supersonic results as indicative only.",
    );
  }
  return {
    ok: true,
    rangeM: range,
    apexM: apex,
    flightTimeS: flightTime,
    impactSpeedMs: impactSpeed,
    vacuumRangeM: vacuumRange,
    rangeFraction: fraction,
    path,
    notes,
  };
}

export interface AimResult {
  ok: true;
  /** The low (direct) trajectory angle, degrees. */
  lowAngleDeg: number;
  /** The high (lofted) trajectory angle, degrees. */
  highAngleDeg: number;
  lowFlightTimeS: number;
  highFlightTimeS: number;
  /** Maximum range at this speed, m. */
  maxRangeM: number;
  notes: string[];
}

/**
 * The launch angle needed to hit a target at a given range, in a vacuum.
 *
 * THERE ARE TWO ANSWERS, ALWAYS — a low, direct shot and a high, lofted one,
 * and both are returned rather than one being chosen. The same doctrine as the
 * 2R arm returning both inverse-kinematics branches: picking one silently would
 * hide a solution the user may specifically want (a lofted shot clears an
 * obstacle; a flat one arrives sooner). They coincide exactly at maximum range,
 * which is where the target becomes unreachable — and beyond it the tool
 * REFUSES rather than clamping.
 */
export function aimForRange(speedMs: number, rangeM: number): AimResult | TrajectoryError {
  const bad = finitePositive([["launch speed", speedMs], ["range", rangeM]]);
  if (bad) return bad;

  const maxRange = (speedMs * speedMs) / G;
  const over = finiteResult([maxRange]);
  if (over) return over;
  const s = (G * rangeM) / (speedMs * speedMs);
  if (s > 1) {
    return {
      ok: false,
      error:
        `A target at ${rangeM} m is beyond the maximum range of ${maxRange.toFixed(1)} m at this ` +
        "speed — no launch angle reaches it. Refused rather than clamped to 45°, because a " +
        "clamped answer looks like a solution and is not one.",
    };
  }
  // sin(2θ) = gR/v² has two roots in (0, 90).
  const twoTheta = Math.asin(Math.min(1, s));
  const low = (twoTheta / 2 / DEG);
  const high = 90 - low;
  const tOf = (deg: number): number => (2 * speedMs * Math.sin(deg * DEG)) / G;

  const notes: string[] = [
    "TWO angles reach the same target: a low direct shot and a high lofted one. Both are given " +
      "rather than one chosen — the lofted trajectory clears obstacles, the flat one arrives " +
      "sooner and is less affected by wind.",
    "They coincide at 45°, which is the maximum-range case; beyond that range no angle works and " +
      "this refuses rather than returning the closest miss.",
    "VACUUM, flat ground. With drag the required angles are higher and the maximum range much " +
      "shorter — use the drag calculator to check any real shot.",
  ];
  if (Math.abs(low - 45) < 0.5) {
    notes.push("This target is essentially at maximum range, so the two solutions have merged.");
  }
  return {
    ok: true,
    lowAngleDeg: low,
    highAngleDeg: high,
    lowFlightTimeS: tOf(low),
    highFlightTimeS: tOf(high),
    maxRangeM: maxRange,
    notes,
  };
}

export interface ImpactResult {
  ok: true;
  impactSpeedMs: number;
  terminalSpeedMs: number;
  /** What the impact speed would be with no air at all, m/s. */
  vacuumSpeedMs: number;
  energyJ: number;
  momentumNs: number;
  /** Energy if the object were at terminal speed — the ceiling no drop can exceed, J. */
  ceilingEnergyJ: number;
  /** Fraction of the terminal-speed energy actually delivered, 0-1. */
  energyFraction: number;
  fallTimeS: number;
  notes: string[];
}

/**
 * Impact speed, energy and momentum for a free fall through air.
 *
 * IMPACT ENERGY SATURATES. In a vacuum energy grows without limit with drop
 * height, but in air the object approaches terminal speed and the energy tends
 * to a ceiling of ½ m v_t² — beyond a few hundred metres a hailstone or a
 * dropped tool hits no harder for having fallen further. The vacuum answer is
 * reported alongside so the gap is visible.
 *
 * Quadratic drag in a uniform density gives the exact closed form
 *   v(h) = v_t √(1 − e^(−2gh/v_t²))
 * which is used here rather than a numerical integration.
 */
export function impactEnergy(
  massKg: number,
  dropHeightM: number,
  areaM2: number,
  cd: number,
  altitudeM = 0,
): ImpactResult | TrajectoryError {
  const bad = finitePositive([
    ["mass", massKg],
    ["drop height", dropHeightM],
    ["frontal area", areaM2],
    ["drag coefficient", cd],
  ]);
  if (bad) return bad;
  if (cd > 5) {
    return {
      ok: false,
      error:
        `A drag coefficient of ${cd} is outside any physical range — a flat plate is about 1.3 ` +
        "and a sphere about 0.47. Check the value.",
    };
  }
  if (!Number.isFinite(altitudeM) || altitudeM < 0) {
    return { ok: false, error: "The altitude must be zero or more." };
  }

  const air = atmosphere(altitudeM);
  if (!air) return { ok: false, error: `The ISA model does not cover an altitude of ${altitudeM} m.` };
  const rho = air.densityKgM3;

  const terminal = Math.sqrt((2 * massKg * G) / (rho * cd * areaM2));
  if (!Number.isFinite(terminal) || terminal <= 0) {
    return {
      ok: false,
      error:
        "Those inputs overflow the arithmetic — the terminal speed is not a finite number. Check " +
        "the magnitudes of the mass and the frontal area.",
    };
  }
  const vacuum = Math.sqrt(2 * G * dropHeightM);
  // v(h) = vt * sqrt(1 - exp(-2 g h / vt^2)); expm1 keeps small drops accurate.
  const ratio = -Math.expm1((-2 * G * dropHeightM) / (terminal * terminal));
  const v = terminal * Math.sqrt(ratio);
  // FALL TIME COMES FROM THE HEIGHT, NOT FROM v. Inverting v = vt tanh(gt/vt)
  // is exact on paper and useless in float: past a few hundred metres v/vt
  // rounds to exactly 1 and the time saturates instead of growing.
  //   h = (vt²/g) ln cosh(gt/vt)  =>  t = (vt/g) arccosh(e^x),  x = gh/vt²
  // That form has a bad end of its own. As x → 0, e^x rounds towards 1 and
  // arccosh near 1 behaves like √(2ε), so the relative error blows up like
  // 1/x and eventually returns a flat zero for a fall that plainly takes time.
  // So all three regimes are handled explicitly:
  //   deep  (x > 20): the exponential would overflow — fall at terminal speed
  //                   plus a fixed startup offset.
  //   shallow (x < 1e-4): the series arccosh(e^x) = √(2x)(1 − x/12 + 3x²/160 …),
  //                   whose leading term is exactly the vacuum time √(2h/g).
  //   otherwise: the closed form directly.
  const x = (G * dropHeightM) / (terminal * terminal);
  let fallTime: number;
  if (x > 20) {
    fallTime = dropHeightM / terminal + (terminal / G) * Math.LN2;
  } else if (x < 1e-4) {
    fallTime = Math.sqrt((2 * dropHeightM) / G) * (1 - x / 12 + (3 * x * x) / 160);
  } else {
    fallTime = (terminal / G) * Math.acosh(Math.exp(x));
  }
  const energy = 0.5 * massKg * v * v;
  const ceiling = 0.5 * massKg * terminal * terminal;
  if (![v, vacuum, energy, ceiling, fallTime].every(Number.isFinite)) {
    return {
      ok: false,
      error:
        "Those inputs overflow the arithmetic and produce a result that is not a finite number. " +
        "Check the magnitudes of the mass, drop height and frontal area.",
    };
  }

  const pct = (100 * v) / vacuum;
  const notes: string[] = [
    `Terminal speed is ${terminal.toFixed(1)} m/s, so impact energy can never exceed ` +
      `${ceiling.toFixed(0)} J no matter how far this object falls. IMPACT ENERGY SATURATES — ` +
      "in a vacuum it would grow without limit, but in air the object stops accelerating.",
    `This drop reaches ${v.toFixed(1)} m/s, which is ${pct.toFixed(0)}% of the ${vacuum.toFixed(1)} ` +
      "m/s a vacuum would give.",
    "Cd is YOUR input and varies with shape, Mach number and Reynolds number. A built-in table " +
      "would be wrong for every object except the one it was measured on.",
    `Air density taken at ${altitudeM} m from the ISA (${rho.toFixed(4)} kg/m³) and held constant ` +
      "over the fall, so a drop spanning many kilometres of altitude is approximate.",
    "Energy and momentum are what the object CARRIES, not what the target feels. The force on " +
      "impact depends on the stopping distance, which this does not model.",
  ];
  return {
    ok: true,
    impactSpeedMs: v,
    terminalSpeedMs: terminal,
    vacuumSpeedMs: vacuum,
    energyJ: energy,
    momentumNs: massKg * v,
    ceilingEnergyJ: ceiling,
    energyFraction: energy / ceiling,
    fallTimeS: fallTime,
    notes,
  };
}

// --- Motion profiles ---------------------------------------------------------

export interface SCurveResult {
  ok: true;
  totalTimeS: number;
  /** Time spent in each phase: jerk-up, constant accel, jerk-down, cruise, and the mirror. */
  accelTimeS: number;
  cruiseTimeS: number;
  peakSpeedMs: number;
  reachesCruise: boolean;
  /** The equivalent trapezoidal profile's total time, for comparison. */
  trapezoidalTimeS: number;
  notes: string[];
}

/**
 * Jerk-limited (S-curve) motion profile.
 *
 * THE S-CURVE IS SLOWER, AND THAT IS THE POINT. A trapezoidal profile steps
 * acceleration instantaneously, which is an infinite jerk — a broadband impulse
 * that excites every structural mode the machine has. Limiting jerk rounds those
 * corners, costs time, and is why precision equipment uses it. The trapezoidal
 * time is reported alongside so the price is explicit.
 */
export function sCurveProfile(
  distanceM: number,
  vmax: number,
  amax: number,
  jmax: number,
): SCurveResult | TrajectoryError {
  const bad = finitePositive([
    ["distance", distanceM],
    ["maximum speed", vmax],
    ["maximum acceleration", amax],
    ["maximum jerk", jmax],
  ]);
  if (bad) return bad;

  // Time to ramp acceleration from 0 to amax.
  const tj = amax / jmax;
  // Speed gained during a full jerk-up + jerk-down pair with no constant phase.
  const vAtTj = amax * tj;
  let tAccel: number;
  if (vmax <= vAtTj) {
    // Triangular acceleration: never reaches amax.
    tAccel = 2 * Math.sqrt(vmax / jmax);
  } else {
    tAccel = tj + vmax / amax;
  }
  const distAccel = (vmax * tAccel) / 2;
  let cruise = 0;
  let peak = vmax;
  let reaches = true;
  if (2 * distAccel > distanceM) {
    // Never reaches vmax: solve for the peak speed that just fits.
    reaches = false;
    // Approximate by scaling: for the jerk-limited case a closed form is messy,
    // so bisect on peak speed, which is monotone in distance.
    let lo = 0;
    let hi = vmax;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const tjm = amax / jmax;
      const vAt = amax * tjm;
      const ta = mid <= vAt ? 2 * Math.sqrt(mid / jmax) : tjm + mid / amax;
      const d = mid * ta; // accelerate + decelerate
      if (d < distanceM) lo = mid;
      else hi = mid;
    }
    peak = (lo + hi) / 2;
    tAccel = peak <= amax * tj ? 2 * Math.sqrt(peak / jmax) : tj + peak / amax;
  } else {
    cruise = (distanceM - 2 * distAccel) / vmax;
  }
  const total = 2 * tAccel + cruise;

  // Trapezoidal equivalent (infinite jerk) for comparison.
  const tAccelTrap = vmax / amax;
  const dAccelTrap = (vmax * tAccelTrap) / 2;
  const trapTotal =
    2 * dAccelTrap > distanceM
      ? 2 * Math.sqrt(distanceM / amax)
      : 2 * tAccelTrap + (distanceM - 2 * dAccelTrap) / vmax;

  return {
    ok: true,
    totalTimeS: total,
    accelTimeS: tAccel,
    cruiseTimeS: cruise,
    peakSpeedMs: peak,
    reachesCruise: reaches,
    trapezoidalTimeS: trapTotal,
    notes: [
      `The S-curve takes ${total.toFixed(3)} s against the trapezoidal profile's ` +
        `${trapTotal.toFixed(3)} s. It is SLOWER on purpose: a trapezoidal profile steps ` +
        "acceleration instantaneously, which is infinite jerk — a broadband impulse that excites " +
        "every structural mode the machine has.",
      "Limiting jerk rounds those corners, so the move settles without ringing. On a precision " +
        "machine the settling time saved usually exceeds the move time paid.",
      reaches
        ? "The move is long enough to reach the commanded speed."
        : `The move is too short to reach ${vmax} m/s; peak speed is ${peak.toFixed(3)} m/s.`,
      "Symmetric profile, and no allowance for actuator torque limits varying with speed.",
    ],
  };
}

export interface AxisSpec {
  label: string;
  distanceM: number;
  vmax: number;
  amax: number;
}

export interface AxisPlan {
  label: string;
  distanceM: number;
  /** Time this axis would take at its own full limits, s. */
  soloTimeS: number;
  /** Speed limit to command so it finishes with the others, m/s. */
  scaledVmax: number;
  scaledAmax: number;
  /** Fraction of its capability actually used, 0-1. */
  utilisation: number;
  limiting: boolean;
}

export interface MultiAxisResult {
  ok: true;
  moveTimeS: number;
  limitingAxis: string;
  axes: AxisPlan[];
  /** Time the fastest axis would have finished in, unsynchronised, s. */
  earliestFinishS: number;
  notes: string[];
}

/**
 * Coordinate several axes so they start and finish together.
 *
 * SYNCHRONISING IS WHAT MAKES THE PATH STRAIGHT. Run every axis at its own full
 * limits and each finishes at a different moment, so the tool traces a dog-leg:
 * it moves diagonally until the fast axis is done, then along the remaining one.
 * Slowing the fast axes to match the slowest costs nothing in cycle time — the
 * slowest axis sets that regardless — and buys a straight line.
 *
 * Scaling is exact: stretching an axis's move from t to T means scaling its
 * speed by t/T and its acceleration by (t/T)², which reproduces the same
 * profile shape in slowed time.
 */
export function multiAxisMove(axes: AxisSpec[]): MultiAxisResult | TrajectoryError {
  if (!Array.isArray(axes) || axes.length < 2) {
    return { ok: false, error: "Give at least two axes to coordinate." };
  }
  if (axes.length > 12) {
    return { ok: false, error: "At most 12 axes." };
  }
  for (const a of axes) {
    const bad = finitePositive([
      [`${a.label} maximum speed`, a.vmax],
      [`${a.label} maximum acceleration`, a.amax],
    ]);
    if (bad) return bad;
    if (!Number.isFinite(a.distanceM) || a.distanceM < 0) {
      return { ok: false, error: `The ${a.label} distance must be zero or more.` };
    }
  }
  if (axes.every((a) => a.distanceM === 0)) {
    return { ok: false, error: "Every axis distance is zero, so there is no move to plan." };
  }
  for (const a of axes) {
    if (!Number.isFinite(a.distanceM / a.vmax) || !Number.isFinite(a.vmax / a.amax)) {
      return {
        ok: false,
        error:
          `The ${a.label} limits overflow the arithmetic. Check the magnitudes of the distance, ` +
          "speed and acceleration.",
      };
    }
  }

  const solo = axes.map((a) => {
    if (a.distanceM === 0) return 0;
    // Trapezoidal: triangular if the move is too short to reach vmax.
    const dRamp = (a.vmax * a.vmax) / a.amax;
    return a.distanceM >= dRamp ? a.vmax / a.amax + a.distanceM / a.vmax : 2 * Math.sqrt(a.distanceM / a.amax);
  });
  const moveTime = Math.max(...solo);
  const moving = solo.filter((t) => t > 0);
  const earliest = Math.min(...moving);
  const limitingIndex = solo.indexOf(moveTime);

  const plans: AxisPlan[] = axes.map((a, i) => {
    // A ZERO-DISTANCE AXIS IS NOT THROTTLED TO ZERO. It has no move to stretch,
    // so its limits are left as they are — emitting 0 would hand back a plan
    // this very function refuses as input.
    const s = solo[i] > 0 ? solo[i] / moveTime : 1;
    return {
      label: a.label,
      distanceM: a.distanceM,
      soloTimeS: solo[i],
      scaledVmax: a.distanceM === 0 ? a.vmax : a.vmax * s,
      scaledAmax: a.distanceM === 0 ? a.amax : a.amax * s * s,
      utilisation: s,
      limiting: i === limitingIndex,
    };
  });

  // Every moving axis already finishing together means there is nothing to
  // synchronise, and claiming a dog-leg that this very result disproves would
  // be a false statement in the output.
  const alreadySynchronised = Math.abs(earliest - moveTime) <= 1e-12 * moveTime;
  const notes: string[] = [
    `${axes[limitingIndex].label} is the limiting axis at ${moveTime.toFixed(3)} s, and it sets ` +
      "the move time on its own." +
      (alreadySynchronised ? "" : " Slowing every other axis to match COSTS NOTHING in cycle time."),
    alreadySynchronised
      ? "Every moving axis already finishes at the same moment at its own full limits, so nothing " +
        "is throttled and the path is straight as it stands. There is no dog-leg to remove here."
      : `Unsynchronised, the quickest axis would finish in ${earliest.toFixed(3)} s and then sit ` +
        "still while the others caught up — which traces a dog-leg through space rather than a " +
        "straight line. Synchronising is what makes the path straight.",
    "Speed scales by the time ratio and acceleration by its square, which reproduces the same " +
      "profile shape in slowed time.",
    "Trapezoidal profiles assumed. For the jerk-limited case use the S-curve calculator; the " +
      "same scaling applies, with jerk scaling by the cube of the ratio.",
  ];
  return {
    ok: true,
    moveTimeS: moveTime,
    limitingAxis: axes[limitingIndex].label,
    axes: plans,
    earliestFinishS: earliest,
    notes,
  };
}

// --- Navigation --------------------------------------------------------------

/** Mean Earth radius used for great-circle distance, m (IUGG mean radius). */
export const EARTH_MEAN_RADIUS = 6371008.8;

export interface GreatCircleResult {
  ok: true;
  distanceM: number;
  distanceNmi: number;
  /** Bearing at the start, degrees from north. */
  initialBearingDeg: number;
  /** Bearing on arrival, degrees from north. */
  finalBearingDeg: number;
  notes: string[];
}

/**
 * Great-circle distance and bearings by the haversine formula.
 *
 * THE INITIAL BEARING IS NOT THE FINAL BEARING. A great circle continuously
 * changes its compass heading — which is why a constant-heading (rhumb line)
 * course is longer, and why long-haul routes look bent on a Mercator map while
 * actually being the shortest path.
 */
export function greatCircle(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
): GreatCircleResult | TrajectoryError {
  for (const [name, v, lim] of [
    ["first latitude", lat1Deg, 90],
    ["second latitude", lat2Deg, 90],
    ["first longitude", lon1Deg, 180],
    ["second longitude", lon2Deg, 180],
  ] as [string, number, number][]) {
    if (!Number.isFinite(v) || Math.abs(v) > lim) {
      return { ok: false, error: `The ${name} must be between -${lim} and ${lim} degrees.` };
    }
  }
  const p1 = lat1Deg * DEG;
  const p2 = lat2Deg * DEG;
  const dp = (lat2Deg - lat1Deg) * DEG;
  const dl = (lon2Deg - lon1Deg) * DEG;

  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_MEAN_RADIUS * c;

  const bearing = (from: number, to: number, dLon: number): number => {
    const y = Math.sin(dLon) * Math.cos(to);
    const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(dLon);
    return ((Math.atan2(y, x) / DEG) + 360) % 360;
  };
  const initial = bearing(p1, p2, dl);
  // Final bearing is the reverse of the bearing from the destination back.
  const final = (bearing(p2, p1, -dl) + 180) % 360;

  return {
    ok: true,
    distanceM: distance,
    distanceNmi: distance / 1852,
    initialBearingDeg: initial,
    finalBearingDeg: final,
    notes: [
      "The initial and final bearings DIFFER because a great circle continuously changes its " +
        "compass heading. A constant-heading rhumb-line course is simpler to fly and always " +
        "longer, which is why long-haul routes look bent on a Mercator map.",
      `Spherical Earth of mean radius ${(EARTH_MEAN_RADIUS / 1000).toFixed(1)} km. The real ` +
        "figure is an ellipsoid, so this is out by up to about 0.5% — fine for planning, not " +
        "for surveying, where Vincenty's formulae on WGS-84 are the right tool.",
      "Haversine is used rather than the spherical law of cosines because the latter loses " +
        "precision badly for short distances.",
    ],
  };
}

export interface WindTriangleResult {
  ok: true;
  /** Heading to steer, degrees from north. */
  headingDeg: number;
  groundSpeedMs: number;
  /** Wind correction angle applied, degrees (positive = steer right of track). */
  driftAngleDeg: number;
  notes: string[];
}

/**
 * The wind triangle: what heading to steer to make good a desired track.
 *
 * YOU STEER INTO THE WIND, AND THE CORRECTION IS NOT THE WIND DIRECTION. The
 * angle depends on the ratio of wind speed to airspeed and on the angle between
 * the wind and the track, so a strong crosswind on a slow aircraft can demand a
 * correction of tens of degrees. When the wind exceeds the airspeed and blows
 * the wrong way, no heading makes the track good at all — and that is reported
 * rather than approximated.
 */
export function windTriangle(
  trackDeg: number,
  trueAirspeedMs: number,
  windFromDeg: number,
  windSpeedMs: number,
): WindTriangleResult | TrajectoryError {
  const bad = finitePositive([["true airspeed", trueAirspeedMs]]);
  if (bad) return bad;
  if (!Number.isFinite(windSpeedMs) || windSpeedMs < 0) {
    return { ok: false, error: "The wind speed must be zero or more." };
  }
  for (const [name, v] of [["track", trackDeg], ["wind direction", windFromDeg]] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number of degrees.` };
  }

  // Angle between the wind vector's origin and the desired track.
  const windAngle = (windFromDeg - trackDeg) * DEG;
  const sinWca = (windSpeedMs * Math.sin(windAngle)) / trueAirspeedMs;
  if (Math.abs(sinWca) > 1) {
    return {
      ok: false,
      error:
        `A ${windSpeedMs} m/s wind cannot be corrected for at ${trueAirspeedMs} m/s airspeed on ` +
        "this track — no heading makes that track good. The wind is stronger than the aircraft " +
        "can crab against.",
    };
  }
  const wca = Math.asin(sinWca);
  const heading = ((trackDeg + wca / DEG) % 360 + 360) % 360;
  const groundSpeed = trueAirspeedMs * Math.cos(wca) - windSpeedMs * Math.cos(windAngle);

  if (groundSpeed <= 0) {
    return {
      ok: false,
      error:
        "The headwind component exceeds the airspeed, so the ground speed would be zero or " +
        "backwards. The track cannot be made good.",
    };
  }
  return {
    ok: true,
    headingDeg: heading,
    groundSpeedMs: groundSpeed,
    driftAngleDeg: wca / DEG,
    notes: [
      "You steer INTO the wind, and the correction angle is not the wind direction — it depends " +
        "on the ratio of wind speed to airspeed and on the angle between them, so a strong " +
        "crosswind on a slow aircraft can demand tens of degrees.",
      "Wind direction is where the wind comes FROM, the meteorological convention. Using the " +
        "direction it blows towards reverses the correction.",
      "True airspeed, not indicated: at altitude the two differ substantially, and the aviation " +
        "airspeed tool converts between them.",
    ],
  };
}
