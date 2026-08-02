// Two-body orbital mechanics: circular and elliptical orbits, Hohmann
// transfers, the rocket equation, and escape.
//
// PROVENANCE OF THE GRAVITATIONAL PARAMETERS. μ and the body radii below were
// taken MECHANICALLY from the poliastro project's constants module (repository
// poliastro/poliastro, file src/poliastro/constants/general.py, main branch,
// fetched 2026-08-02), which cites the IAU 2009 system of astronomical
// constants. They were extracted by a script; no value was typed by hand, and
// `orbital.crosscheck.test.ts` validates them against facts known independently
// of that file — μ_Earth must reproduce the geostationary radius (42164 km), the
// ISS orbital period (~92 min), and surface gravity (9.80 m/s²). Wrong numbers
// fail those immediately. Same treatment as the NASA polynomials in flame.ts.
//
// TWO-BODY ONLY, AND THAT IS A REAL LIMIT. No J2 oblateness, no atmospheric
// decay, no third-body perturbation, no solar radiation pressure. A real orbit
// determination needs ephemerides and a propagator, which is a different
// product; two-body is what a specification quotes and what a feasibility
// calculation uses, and every result says so.

export interface OrbitalError {
  ok: false;
  error: string;
}

export interface Body {
  id: string;
  label: string;
  /** Standard gravitational parameter, m³/s². */
  mu: number;
  /** Equatorial radius, m. */
  radius: number;
  source: string;
}

/** Script-extracted; see the provenance note above. */
export const BODIES: Body[] = [
  { id: "earth", label: "Earth", mu: 3.986004418e14, radius: 6.3781366e6, source: "IAU 2009" },
  { id: "moon", label: "Moon", mu: 4.90279981e12, radius: 1.7374e6, source: "IAU 2009" },
  { id: "mars", label: "Mars", mu: 4.28283744e13, radius: 3.39619e6, source: "IAU 2009" },
  { id: "sun", label: "Sun", mu: 1.32712442099e20, radius: 6.957e8, source: "IAU 2009" },
  { id: "jupiter", label: "Jupiter", mu: 1.2671276253e17, radius: 7.1492e7, source: "IAU 2009" },
];

export function bodyById(id: string): Body | undefined {
  return BODIES.find((b) => b.id === id);
}

/**
 * Guards the OUTPUTS, not the inputs.
 *
 * Every input can be finite and legal and the arithmetic still overflow: past a
 * radius of about 5.6e102, r³ is infinity and the period comes back infinite
 * while the mean motion silently becomes zero. Returning that as a success is
 * worse than refusing, because the pane prints an em-dash for a non-finite
 * number and the em-dash then blocks insertion with nothing to explain why.
 */
function finiteResult(values: number[]): OrbitalError | null {
  return values.every((v) => Number.isFinite(v))
    ? null
    : {
        ok: false,
        error:
          "Those inputs overflow the arithmetic and produce a result that is not a finite number. " +
          "Check the magnitudes you entered.",
      };
}

function finitePositive(pairs: [string, number][]): OrbitalError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

export interface CircularOrbitResult {
  ok: true;
  body: string;
  altitudeM: number;
  radiusM: number;
  speedMs: number;
  periodS: number;
  /** Angular rate, rad/s. */
  meanMotion: number;
  /** Speed needed to escape from this radius, m/s. */
  escapeSpeedMs: number;
  notes: string[];
}

/**
 * Circular orbit speed and period at an altitude.
 *
 * A LOWER ORBIT IS A FASTER ORBIT — v = √(μ/r), so speed rises as radius falls.
 * That is the root of most orbital-mechanics confusion: adding energy raises
 * the orbit and SLOWS you down, because the potential energy gained exceeds the
 * kinetic energy spent.
 */
export function circularOrbit(bodyId: string, altitudeM: number): CircularOrbitResult | OrbitalError {
  const body = bodyById(bodyId);
  if (!body) return { ok: false, error: `Unknown body "${bodyId}".` };
  if (!Number.isFinite(altitudeM)) return { ok: false, error: "The altitude must be a finite number." };
  const r = body.radius + altitudeM;
  if (r <= 0) return { ok: false, error: "That altitude puts the orbit inside the body's centre." };
  if (altitudeM < 0) {
    return {
      ok: false,
      error: `An altitude below zero is inside ${body.label}. Enter the height above the surface.`,
    };
  }

  const speed = Math.sqrt(body.mu / r);
  const period = 2 * Math.PI * Math.sqrt((r * r * r) / body.mu);
  const over = finiteResult([speed, period, r]);
  if (over) return over;
  const notes: string[] = [
    "A LOWER orbit is a FASTER orbit: v = √(μ/r). Adding energy raises the orbit and slows you " +
      "down, because the potential energy gained exceeds the kinetic energy spent — the single " +
      "most counter-intuitive fact in the subject.",
    "Two-body only: no oblateness (J2), no atmospheric drag, no third-body effects. A real " +
      "low orbit decays and precesses; this is the idealised figure a specification quotes.",
    `μ and the radius for ${body.label} are from the ${body.source} constants, cross-checked in ` +
      "the test suite rather than transcribed.",
  ];
  if (altitudeM < 200e3 && bodyId === "earth") {
    notes.push(
      "Below about 200 km the atmosphere is thick enough that an orbit decays in days to weeks. " +
        "This calculation does not model that at all.",
    );
  }
  return {
    ok: true,
    body: body.label,
    altitudeM,
    radiusM: r,
    speedMs: speed,
    periodS: period,
    meanMotion: (2 * Math.PI) / period,
    escapeSpeedMs: Math.sqrt((2 * body.mu) / r),
    notes,
  };
}

export interface EllipticalOrbitResult {
  ok: true;
  body: string;
  semiMajorAxisM: number;
  eccentricity: number;
  periapsisRadiusM: number;
  apoapsisRadiusM: number;
  periapsisAltitudeM: number;
  apoapsisAltitudeM: number;
  periapsisSpeedMs: number;
  apoapsisSpeedMs: number;
  periodS: number;
  notes: string[];
}

/**
 * An elliptical orbit from its two apsis altitudes, by vis-viva.
 *
 * THE PERIOD DEPENDS ONLY ON THE SEMI-MAJOR AXIS. A near-circular orbit and a
 * wildly eccentric one with the same *a* take exactly the same time to go
 * round — eccentricity does not enter Kepler's third law at all. That is why a
 * transfer orbit's duration is fixed the moment its two ends are chosen.
 */
export function ellipticalOrbit(
  bodyId: string,
  periapsisAltM: number,
  apoapsisAltM: number,
): EllipticalOrbitResult | OrbitalError {
  const body = bodyById(bodyId);
  if (!body) return { ok: false, error: `Unknown body "${bodyId}".` };
  if (!Number.isFinite(periapsisAltM) || !Number.isFinite(apoapsisAltM)) {
    return { ok: false, error: "Both altitudes must be finite numbers." };
  }
  if (periapsisAltM < 0 || apoapsisAltM < 0) {
    return { ok: false, error: `An altitude below zero is inside ${body.label}.` };
  }
  if (apoapsisAltM < periapsisAltM) {
    return {
      ok: false,
      error: "The apoapsis must be at or above the periapsis — those two look swapped.",
    };
  }

  const rp = body.radius + periapsisAltM;
  const ra = body.radius + apoapsisAltM;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const vp = Math.sqrt(body.mu * (2 / rp - 1 / a));
  const va = Math.sqrt(body.mu * (2 / ra - 1 / a));
  const period = 2 * Math.PI * Math.sqrt((a * a * a) / body.mu);
  const over = finiteResult([a, e, rp, ra, vp, va, period]);
  if (over) return over;

  const notes: string[] = [
    "The period depends ONLY on the semi-major axis: a near-circular orbit and a highly " +
      "eccentric one with the same a take exactly the same time. Eccentricity does not appear " +
      "in Kepler's third law.",
    "Speeds are from vis-viva, v² = μ(2/r − 1/a). The craft is slowest at apoapsis and fastest " +
      "at periapsis, which is why orbit changes are cheapest where you are already moving fastest.",
    "Two-body only — no J2, no drag, no third body.",
  ];
  if (e < 1e-9) notes.push("This orbit is circular to within rounding.");
  return {
    ok: true,
    body: body.label,
    semiMajorAxisM: a,
    eccentricity: e,
    periapsisRadiusM: rp,
    apoapsisRadiusM: ra,
    periapsisAltitudeM: periapsisAltM,
    apoapsisAltitudeM: apoapsisAltM,
    periapsisSpeedMs: vp,
    apoapsisSpeedMs: va,
    periodS: period,
    notes,
  };
}

export interface HohmannResult {
  ok: true;
  body: string;
  fromAltitudeM: number;
  toAltitudeM: number;
  /** First burn, at the departure orbit, m/s. */
  burn1Ms: number;
  /** Second burn, at arrival, m/s. */
  burn2Ms: number;
  totalDeltaVMs: number;
  transferTimeS: number;
  /** Phase angle the target must lead by at departure, degrees. */
  phaseAngleDeg: number;
  notes: string[];
}

/**
 * Hohmann transfer between two circular orbits.
 *
 * TO CATCH SOMETHING AHEAD OF YOU IN THE SAME ORBIT, YOU MUST SLOW DOWN. This
 * is the best result in orbital mechanics and the one that breaks intuition
 * hardest: firing your engine forwards raises your orbit, which lengthens your
 * period, so you fall further behind. Dropping to a lower orbit makes you
 * faster in angle and lets you catch up.
 */
export function hohmannTransfer(
  bodyId: string,
  fromAltitudeM: number,
  toAltitudeM: number,
): HohmannResult | OrbitalError {
  const body = bodyById(bodyId);
  if (!body) return { ok: false, error: `Unknown body "${bodyId}".` };
  if (!Number.isFinite(fromAltitudeM) || !Number.isFinite(toAltitudeM)) {
    return { ok: false, error: "Both altitudes must be finite numbers." };
  }
  if (fromAltitudeM < 0 || toAltitudeM < 0) {
    return { ok: false, error: `An altitude below zero is inside ${body.label}.` };
  }
  const r1 = body.radius + fromAltitudeM;
  const r2 = body.radius + toAltitudeM;
  if (Math.abs(r1 - r2) < 1e-6) {
    return { ok: false, error: "The two orbits are the same, so there is no transfer to compute." };
  }

  const aT = (r1 + r2) / 2;
  const v1 = Math.sqrt(body.mu / r1);
  const v2 = Math.sqrt(body.mu / r2);
  const vp = Math.sqrt(body.mu * (2 / r1 - 1 / aT));
  const va = Math.sqrt(body.mu * (2 / r2 - 1 / aT));
  const burn1 = vp - v1;
  const burn2 = v2 - va;
  const transferTime = Math.PI * Math.sqrt((aT * aT * aT) / body.mu);
  // How far ahead the target must be when you leave: it moves through
  // n2 * t_transfer while you sweep exactly pi.
  const n2 = Math.sqrt(body.mu / (r2 * r2 * r2));
  // WRAPPED INTO (-180, 180]. On a descending transfer the target sweeps
  // through several whole turns while you cross, so the raw quantity runs to
  // -1078 degrees for GEO to LEO — which is not a lead angle anyone can set a
  // clock by. Whole revolutions do not change where the target must be.
  const rawPhaseDeg = ((Math.PI - n2 * transferTime) * 180) / Math.PI;
  const phaseDeg = rawPhaseDeg - 360 * Math.ceil(rawPhaseDeg / 360 - 0.5);

  const raising = r2 > r1;
  const notes: string[] = [
    raising
      ? "Raising an orbit: both burns are prograde (positive), and the craft ends up SLOWER than " +
        "it started despite adding energy twice — the higher orbit is the slower one."
      : "Lowering an orbit: both burns are retrograde (negative here), and the craft ends up " +
        "FASTER than it started. Slowing down to speed up is not a paradox, it is the shape of " +
        "the gravitational potential.",
    "TO CATCH SOMETHING AHEAD OF YOU IN THE SAME ORBIT, SLOW DOWN. Firing forwards raises your " +
      "orbit and lengthens your period, so you fall further behind; dropping lower makes you " +
      "faster in angle. This is the result that breaks intuition hardest.",
    "The Hohmann transfer is the cheapest two-burn transfer between coplanar circular orbits, " +
      "and also the SLOWEST. A bi-elliptic transfer beats it on Δv for very large radius ratios " +
      "(above about 11.94), at the cost of far more time.",
    "Impulsive burns assumed — instantaneous velocity changes. A real finite burn loses to " +
      "gravity losses, and a low-thrust spiral is a different problem entirely.",
  ];
  const ratio = Math.max(r1, r2) / Math.min(r1, r2);
  if (ratio > 11.94) {
    notes.push(
      `The radius ratio here is ${ratio.toFixed(1)}, above the 11.94 threshold where a ` +
        "bi-elliptic transfer needs less Δv than this Hohmann — worth checking if time is cheap.",
    );
  }
  return {
    ok: true,
    body: body.label,
    fromAltitudeM,
    toAltitudeM,
    burn1Ms: burn1,
    burn2Ms: burn2,
    totalDeltaVMs: Math.abs(burn1) + Math.abs(burn2),
    transferTimeS: transferTime,
    phaseAngleDeg: phaseDeg,
    notes,
  };
}

export interface RocketResult {
  ok: true;
  deltaVMs: number;
  massRatio: number;
  /** Effective exhaust velocity, m/s. */
  exhaustVelocityMs: number;
  propellantMassKg: number | null;
  /** Fraction of the initial mass that must be propellant. */
  propellantFraction: number;
  notes: string[];
}

/** Standard gravity used to convert Isp in seconds, m/s² — definitional. */
export const G0 = 9.80665;

/**
 * Tsiolkovsky rocket equation: Δv = v_e · ln(m0/mf).
 *
 * Δv IS EXPONENTIAL IN MASS RATIO, which is the tyranny the equation is named
 * for. Doubling Δv does not double the propellant, it squares the mass ratio —
 * so the last increment of performance costs by far the most, and this is why
 * staging exists rather than simply building a bigger single tank.
 */
export function rocketEquation(
  ispSeconds: number,
  initialMassKg: number,
  finalMassKg: number,
): RocketResult | OrbitalError {
  const bad = finitePositive([
    ["specific impulse", ispSeconds],
    ["initial mass", initialMassKg],
    ["final mass", finalMassKg],
  ]);
  if (bad) return bad;
  if (finalMassKg >= initialMassKg) {
    return {
      ok: false,
      error: "The final mass must be below the initial mass — a rocket gets lighter as it burns.",
    };
  }
  if (ispSeconds > 10000) {
    return { ok: false, error: `An Isp of ${ispSeconds} s is beyond any real propulsion; check the unit (seconds).` };
  }

  const ve = ispSeconds * G0;
  const ratio = initialMassKg / finalMassKg;
  const dv = ve * Math.log(ratio);
  const propellant = initialMassKg - finalMassKg;
  const over = finiteResult([ve, ratio, dv, propellant]);
  if (over) return over;

  const notes: string[] = [
    "Δv is EXPONENTIAL in mass ratio: doubling Δv squares the mass ratio rather than doubling " +
      "propellant. The last increment of performance costs by far the most, which is the whole " +
      "reason staging exists.",
    `Isp is in seconds, so the exhaust velocity is Isp × g₀ = ${ve.toFixed(0)} m/s. The g₀ here ` +
      "is the definitional 9.80665, not local gravity — it is a unit conversion, not a physical " +
      "acceleration, and using local g is a common slip.",
    "Ideal Δv: no gravity losses, no drag, no steering losses. A launch to low orbit needs " +
      "roughly 9.4 km/s of Δv to achieve about 7.8 km/s of orbital speed, and the difference is " +
      "exactly those losses.",
  ];
  if (dv > 20000) {
    notes.push("That Δv is beyond any single chemical stage; a real vehicle would stage.");
  }
  return {
    ok: true,
    deltaVMs: dv,
    massRatio: ratio,
    exhaustVelocityMs: ve,
    propellantMassKg: propellant,
    propellantFraction: propellant / initialMassKg,
    notes,
  };
}

export interface EscapeResult {
  ok: true;
  body: string;
  fromRadiusM: number;
  escapeSpeedMs: number;
  circularSpeedMs: number;
  /** Extra speed needed to escape from a circular orbit there, m/s. */
  additionalFromOrbitMs: number;
  notes: string[];
}

/**
 * Escape speed from an altitude.
 *
 * ESCAPE SPEED DOES NOT DEPEND ON DIRECTION. Any direction that misses the body
 * works — straight up, sideways, at any angle — because it is an energy
 * condition, not a trajectory one. It also does not depend on the escaping
 * mass. And it is exactly √2 times the circular speed at the same radius, so
 * escaping from orbit costs about 41% more speed, not twice as much.
 */
export function escapeSpeed(bodyId: string, altitudeM: number): EscapeResult | OrbitalError {
  const body = bodyById(bodyId);
  if (!body) return { ok: false, error: `Unknown body "${bodyId}".` };
  if (!Number.isFinite(altitudeM) || altitudeM < 0) {
    return { ok: false, error: `The altitude must be zero or more; below that is inside ${body.label}.` };
  }
  const r = body.radius + altitudeM;
  const vEsc = Math.sqrt((2 * body.mu) / r);
  const vCirc = Math.sqrt(body.mu / r);
  return {
    ok: true,
    body: body.label,
    fromRadiusM: r,
    escapeSpeedMs: vEsc,
    circularSpeedMs: vCirc,
    additionalFromOrbitMs: vEsc - vCirc,
    notes: [
      "Escape speed is independent of DIRECTION — any heading that misses the body will do, " +
        "because it is an energy condition rather than a trajectory one. It is also independent " +
        "of the escaping object's mass.",
      "It is exactly √2 times the circular speed at the same radius, so leaving from orbit costs " +
        "about 41% more speed, not twice as much.",
      "Two-body: this escapes the named body only. Leaving Earth's sphere of influence still " +
        "leaves you in solar orbit, which is a separate and much larger problem.",
    ],
  };
}
