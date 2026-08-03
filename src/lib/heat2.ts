// Heat transfer, second module — the rating problem, fins, transients and
// radiation. `heat.ts` holds the resistance network and LMTD sizing.
//
// WHY ε-NTU EXISTS AT ALL, AND WHY LMTD CANNOT REPLACE IT. LMTD answers the
// DESIGN question: I know all four terminal temperatures, how much area do I
// need? The commoner question in practice is the RATING one: I have this
// exchanger and these two inlets, what comes out? LMTD cannot answer it
// directly, because the log mean it needs is built from the outlets you are
// trying to find — you have to guess, size, compare and iterate. ε-NTU answers
// it in closed form, one arrangement at a time, which is the whole reason the
// method was invented.
//
// A FIN CAN REDUCE HEAT TRANSFER. Adding metal to a surface adds area, which
// helps, and adds a conduction path with its own resistance, which does not.
// When the base coefficient is already high relative to the fin's conductance
// — a highly conductive fluid, or a short stubby fin of poor material — the
// second effect wins and the finned surface loses LESS heat than the bare one.
// The fin effectiveness is the number that says which side of that you are on,
// and a value below 1 means the fin is doing harm. Textbooks state the rule of
// thumb (do not bother below about 2); this reports the number.
//
// THE LUMPED MODEL HAS A HARD VALIDITY LIMIT. Treating a body as isothermal is
// only defensible when internal conduction is fast compared with surface
// convection, which is what the Biot number measures. Above Bi ≈ 0.1 the
// interior lags the surface, the single-exponential answer is simply wrong, and
// no amount of care with the arithmetic fixes it. This refuses rather than
// returning a plausible cooling curve.
//
// EMISSIVITY IS A MEASURED INPUT. It depends on material, finish, oxidation and
// wavelength, and a built-in table would be wrong for every surface except the
// one it was measured on — the same refusal as drag coefficients and absorption
// coefficients elsewhere in this bench.
//
// Units are strict SI: metres, watts, kelvin (or Celsius where only differences
// appear, which is stated at each entry point).

export interface Heat2Error {
  ok: false;
  error: string;
}

/** Stefan-Boltzmann constant, W/(m^2*K^4) — exact by the 2019 SI definition. */
export const SIGMA_SB = 5.670374419e-8;

const finite = (pairs: [string, number][]): Heat2Error | null => {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  return null;
};

// ---------------------------------------------------------------------------
// 1. Effectiveness-NTU: the rating problem
// ---------------------------------------------------------------------------

export type NtuFlow = "counter" | "parallel" | "crossboth" | "shell";

export interface NtuInput {
  flow: NtuFlow;
  /** Capacity rate of the hot stream, W/K — mass flow times specific heat. */
  cHot: number;
  cCold: number;
  /** Inlet temperatures, degrees C. */
  thIn: number;
  tcIn: number;
  /** Overall coefficient, W/(m^2*K). */
  U: number;
  /** Area, m^2. */
  A: number;
}

export interface NtuResult {
  ok: true;
  /** Smaller and larger capacity rates, W/K. */
  cMin: number;
  cMax: number;
  /** Capacity ratio Cmin/Cmax, 0 to 1. */
  cr: number;
  ntu: number;
  effectiveness: number;
  /** Heat actually transferred, W. */
  Q: number;
  /** The most any exchanger of infinite area could transfer, W. */
  qMax: number;
  thOut: number;
  tcOut: number;
  /** Effectiveness the same NTU would reach with infinite area. */
  effectivenessLimit: number;
  notes: string[];
}

/**
 * Outlet temperatures from an exchanger you already have.
 *
 * ONE CLOSED FORM PER ARRANGEMENT, no iteration. The relations are standard and
 * exact for the idealisations they state; the ones with removable singularities
 * at Cr = 0 or Cr = 1 take their limits explicitly rather than returning NaN
 * for a balanced exchanger, which is an entirely ordinary design.
 *
 * Cr = 0 IS NOT A DEGENERATE CASE — it is a phase change. A boiling or
 * condensing stream holds its temperature, so its capacity rate is effectively
 * infinite and Cr goes to zero, at which point every arrangement collapses to
 * the same relation. That is why a condenser's performance does not depend on
 * whether it is counterflow or parallel.
 */
export function effectivenessNtu(inp: NtuInput): NtuResult | Heat2Error {
  const bad = finite([
    ["hot capacity rate", inp.cHot],
    ["cold capacity rate", inp.cCold],
    ["hot inlet", inp.thIn],
    ["cold inlet", inp.tcIn],
    ["overall coefficient", inp.U],
    ["area", inp.A],
  ]);
  if (bad) return bad;
  if (inp.cHot <= 0 || inp.cCold <= 0) {
    return { ok: false, error: "Both capacity rates must be greater than zero (mass flow times specific heat)." };
  }
  if (inp.U <= 0 || inp.A <= 0) return { ok: false, error: "The coefficient and the area must both be greater than zero." };
  if (inp.thIn <= inp.tcIn) {
    return {
      ok: false,
      error:
        "The hot inlet is not above the cold inlet, so there is no heat to transfer in the " +
        "direction assumed. Check which stream is which.",
    };
  }

  const cMin = Math.min(inp.cHot, inp.cCold);
  const cMax = Math.max(inp.cHot, inp.cCold);
  const cr = cMin / cMax;
  const ntu = (inp.U * inp.A) / cMin;
  if (!Number.isFinite(ntu) || ntu <= 0) {
    return { ok: false, error: "Those inputs give a non-finite NTU. Check the magnitudes." };
  }

  const eps = ntuEffectiveness(inp.flow, ntu, cr);
  if (eps === null) return { ok: false, error: "That flow arrangement is not supported." };

  const qMax = cMin * (inp.thIn - inp.tcIn);
  const Q = eps * qMax;
  const thOut = inp.thIn - Q / inp.cHot;
  const tcOut = inp.tcIn + Q / inp.cCold;
  const limit = ntuEffectiveness(inp.flow, 1e6, cr) ?? 1;

  const notes: string[] = [
    "This is the RATING problem: the exchanger and both inlets are known and the outlets follow. " +
      "LMTD cannot answer it directly, because the log mean it needs is built from the outlets " +
      "you are trying to find - that is the whole reason this method exists.",
    `Cmin is the ${inp.cHot <= inp.cCold ? "HOT" : "COLD"} stream, and it is the one that sets the ` +
      "limit: the most any exchanger can do is bring THAT stream to the other's inlet " +
      `temperature, which is ${qMax.toPrecision(4)} W here.`,
    "Effectiveness is what fraction of that limit this exchanger achieves. It is a property of " +
      "the exchanger and the flows, not of the temperatures, so it does not change when the " +
      "inlets do.",
  ];
  if (ntu > 5) {
    notes.push(
      `At NTU ${ntu.toFixed(1)} the effectiveness is ${(eps * 100).toFixed(1)}% against a ceiling ` +
        `of ${(limit * 100).toFixed(1)}%. DOUBLING THE AREA FROM HERE BUYS ALMOST NOTHING - the ` +
        "return on area collapses past about NTU 3, which is why very large exchangers are rarely " +
        "worth their cost.",
    );
  }
  if (cr < 0.02) {
    notes.push(
      "The capacity ratio is nearly zero, which is what a BOILING OR CONDENSING stream looks " +
        "like: it holds its temperature, so its capacity rate is effectively infinite. Every " +
        "arrangement gives the same answer in that limit, which is why a condenser's performance " +
        "does not depend on whether it is counterflow or parallel.",
    );
  }
  if (inp.flow === "parallel") {
    notes.push(
      `Parallel flow cannot exceed ${(limit * 100).toFixed(1)}% effectiveness however large it is, ` +
        "because both streams approach a common temperature from opposite sides. Counterflow has " +
        "no such ceiling, and that is the entire argument for it.",
    );
  }
  notes.push(
    "Idealised: no heat lost to surroundings, constant U along the whole exchanger, constant " +
      "specific heats, and no fouling. Real U falls as fouling builds, which is what the fouling " +
      "allowance in a design is for.",
  );

  return {
    ok: true,
    cMin,
    cMax,
    cr,
    ntu,
    effectiveness: eps,
    Q,
    qMax,
    thOut,
    tcOut,
    effectivenessLimit: limit,
    notes,
  };
}

/** The standard effectiveness relations, with their limits taken explicitly. */
function ntuEffectiveness(flow: NtuFlow, ntu: number, cr: number): number | null {
  // Cr -> 0 is the phase-change limit and is the SAME for every arrangement.
  if (cr < 1e-9) return 1 - Math.exp(-ntu);
  switch (flow) {
    case "counter": {
      // Cr = 1 is a removable singularity: 0/0, whose limit is NTU/(1+NTU).
      if (Math.abs(cr - 1) < 1e-9) return ntu / (1 + ntu);
      const e = Math.exp(-ntu * (1 - cr));
      return (1 - e) / (1 - cr * e);
    }
    case "parallel":
      return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
    case "crossboth": {
      // Both streams unmixed:
      //   eps = 1 - exp( (NTU^0.22 / Cr) * [exp(-Cr * NTU^0.78) - 1] )
      //
      // THE TWO EXPONENTS ARE DIFFERENT, 0.22 outside and 0.78 inside, and
      // getting that wrong is not a small error: the first draft used NTU^1.22
      // in the inner term, which does not reduce to 1 - exp(-NTU) as Cr goes to
      // zero and gave 0.934 where every other arrangement gave 0.865. The
      // limit check is what caught it — the exponents sum to 1 precisely so
      // that the Cr terms cancel there.
      const outer = Math.pow(ntu, 0.22);
      const inner = Math.pow(ntu, 0.78);
      return 1 - Math.exp((outer / cr) * (Math.expm1(-cr * inner)));
    }
    case "shell": {
      // One shell pass, 2, 4, ... tube passes.
      const g = Math.sqrt(1 + cr * cr);
      const e = Math.exp(-ntu * g);
      return 2 / (1 + cr + g * ((1 + e) / (1 - e)));
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Fins
// ---------------------------------------------------------------------------

export interface FinInput {
  /** Convection coefficient at the surface, W/(m^2*K). */
  h: number;
  /** Fin thermal conductivity, W/(m*K). */
  k: number;
  /** Fin length from the base, m. */
  L: number;
  /** Fin thickness, m (a straight rectangular fin). */
  t: number;
  /** Fin width into the page, m. */
  width: number;
  /** Base temperature above ambient, K. */
  excessK: number;
}

export interface FinResult {
  ok: true;
  /** Fin parameter m = sqrt(hP/(kA)), 1/m. */
  m: number;
  /** Corrected length, accounting for the tip, m. */
  lCorrected: number;
  /** mL_c, the dimensionless group the efficiency depends on. */
  mLc: number;
  /** Efficiency: actual heat divided by the heat an isothermal fin would move. */
  efficiency: number;
  /** Heat the fin actually removes, W. */
  qFin: number;
  /** Heat the same base area would have removed with no fin, W. */
  qBare: number;
  /**
   * Effectiveness, qFin/qBare. BELOW 1 MEANS THE FIN MAKES THINGS WORSE — it is
   * adding conduction resistance faster than it adds area.
   */
  effectiveness: number;
  notes: string[];
}

/**
 * A straight rectangular fin, with the adiabatic-tip correction.
 *
 * THE CORRECTED LENGTH IS NOT A FUDGE. An adiabatic tip is the easy boundary
 * condition and a real tip convects, so the standard treatment adds half the
 * thickness to the length — which gives the same surface area as the real fin
 * and reproduces the convecting-tip answer to well within the uncertainty of h.
 */
export function finPerformance(inp: FinInput): FinResult | Heat2Error {
  const bad = finite([
    ["convection coefficient", inp.h],
    ["conductivity", inp.k],
    ["length", inp.L],
    ["thickness", inp.t],
    ["width", inp.width],
    ["base excess temperature", inp.excessK],
  ]);
  if (bad) return bad;
  for (const [name, v] of [
    ["convection coefficient", inp.h],
    ["conductivity", inp.k],
    ["length", inp.L],
    ["thickness", inp.t],
    ["width", inp.width],
  ] as [string, number][]) {
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }

  const P = 2 * (inp.width + inp.t); // perimeter
  const Ac = inp.width * inp.t; // cross-section
  const m = Math.sqrt((inp.h * P) / (inp.k * Ac));
  const lc = inp.L + inp.t / 2;
  const mLc = m * lc;
  if (!Number.isFinite(m) || !Number.isFinite(mLc)) {
    return { ok: false, error: "Those inputs overflow the fin parameter. Check the magnitudes." };
  }
  const efficiency = mLc < 1e-12 ? 1 : Math.tanh(mLc) / mLc;
  const aFin = P * lc;
  const qFin = efficiency * inp.h * aFin * inp.excessK;
  const qBare = inp.h * Ac * inp.excessK;
  // EFFECTIVENESS DOES NOT DEPEND ON THE DRIVING TEMPERATURE. It is
  // eta * A_fin / A_c: the excess temperature appears in both heat rates and
  // cancels. Computing it as a ratio of the two returned 0/0 = NaN for a base
  // AT ambient — an ordinary input, since excess temperature is legitimately
  // allowed to be zero — and then dropped all three effectiveness notes with
  // it. This module's own header says removable singularities take their
  // limits explicitly; this is one of them.
  const effectiveness = (efficiency * aFin) / Ac;

  const notes: string[] = [
    `Efficiency ${(efficiency * 100).toFixed(1)}% is how close the fin comes to being ISOTHERMAL. ` +
      "A perfect conductor would sit at the base temperature all the way to the tip; a real one " +
      "cools along its length, so the far end works against a smaller temperature difference.",
  ];
  if (Number.isFinite(effectiveness)) {
    if (effectiveness < 1) {
      notes.push(
        `EFFECTIVENESS IS ${effectiveness.toFixed(2)}, WHICH IS BELOW 1: this fin removes LESS ` +
          "heat than the bare base area would. Adding metal adds area, which helps, and adds a " +
          "conduction path with its own resistance, which does not - and here the second effect " +
          "wins. Fins are the wrong answer for this surface.",
      );
    } else if (effectiveness < 2) {
      notes.push(
        `Effectiveness ${effectiveness.toFixed(2)} is above 1 but below the usual threshold of ` +
          "about 2, below which fins are generally not considered worth their cost and weight.",
      );
    } else {
      notes.push(
        `Effectiveness ${effectiveness.toFixed(1)} means the fin moves that many times the heat ` +
          "the bare base would. Fins pay when h is LOW - which is why they appear on the air side " +
          "of a radiator and never on the water side.",
      );
    }
  }
  if (mLc > 3) {
    notes.push(
      `mLc is ${mLc.toFixed(1)}. Past about 3 the tip is already at ambient and MAKING THE FIN ` +
        "LONGER ADDS WEIGHT AND NO HEAT TRANSFER. More, shorter fins beat fewer, longer ones.",
    );
  }
  notes.push(
    "Straight rectangular fin, one-dimensional conduction along it, uniform h over the whole " +
      "surface, adiabatic tip handled by the corrected length. h is YOUR measured or correlated " +
      "input; it is not predicted here.",
  );

  return { ok: true, m, lCorrected: lc, mLc, efficiency, qFin, qBare, effectiveness, notes };
}

// ---------------------------------------------------------------------------
// 3. Lumped capacitance
// ---------------------------------------------------------------------------

export interface LumpedInput {
  /** Convection coefficient, W/(m^2*K). */
  h: number;
  /** Conductivity of the BODY, W/(m*K) — needed only for the Biot check. */
  k: number;
  /** Density, kg/m^3. */
  rho: number;
  /** Specific heat, J/(kg*K). */
  cp: number;
  /** Volume, m^3. */
  volume: number;
  /** Surface area exposed to convection, m^2. */
  area: number;
  /** Initial and ambient temperatures, degrees C. */
  tInit: number;
  tAmbient: number;
  /** Time to report at, s. */
  timeS: number;
}

export interface LumpedResult {
  ok: true;
  /** Characteristic length V/A, m. */
  lc: number;
  biot: number;
  /** Time constant rho*V*cp/(h*A), s. */
  tau: number;
  /** Temperature at the requested time, degrees C. */
  temperature: number;
  /** Fraction of the initial excess remaining. */
  fractionRemaining: number;
  /** Time to reach 99% of the way to ambient, s. */
  timeTo99: number;
  /** Energy removed by that time, J. */
  energyJ: number;
  /** Sampled cooling curve, for plotting. */
  curve: { t: number; T: number }[];
  notes: string[];
}

/**
 * Newtonian cooling of a body treated as isothermal.
 *
 * IT REFUSES ABOVE Bi = 0.1 RATHER THAN WARNING. The lumped model assumes the
 * body has no internal temperature gradient, and the Biot number is exactly the
 * ratio of internal conduction resistance to surface convection resistance.
 * Above about 0.1 the interior genuinely lags the surface and the
 * single-exponential answer is not approximately right, it is the wrong shape —
 * a caveated wrong curve is still a wrong curve in somebody's document.
 */
export function lumpedCapacitance(inp: LumpedInput): LumpedResult | Heat2Error {
  const bad = finite([
    ["convection coefficient", inp.h],
    ["conductivity", inp.k],
    ["density", inp.rho],
    ["specific heat", inp.cp],
    ["volume", inp.volume],
    ["area", inp.area],
    ["initial temperature", inp.tInit],
    ["ambient temperature", inp.tAmbient],
    ["time", inp.timeS],
  ]);
  if (bad) return bad;
  for (const [name, v] of [
    ["convection coefficient", inp.h],
    ["conductivity", inp.k],
    ["density", inp.rho],
    ["specific heat", inp.cp],
    ["volume", inp.volume],
    ["area", inp.area],
  ] as [string, number][]) {
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  if (inp.timeS < 0) return { ok: false, error: "The time cannot be negative." };

  const lc = inp.volume / inp.area;
  const biot = (inp.h * lc) / inp.k;
  if (!Number.isFinite(biot)) return { ok: false, error: "Those inputs give a non-finite Biot number." };
  if (biot > 0.1) {
    return {
      ok: false,
      error:
        `The Biot number is ${biot.toPrecision(3)}, above the 0.1 limit where a body can be ` +
        "treated as isothermal. Internal conduction is slow compared with surface convection " +
        "here, so the middle lags the outside and a single exponential is not the right SHAPE of " +
        "answer, not merely an imprecise one. Refused rather than caveated: this needs a " +
        "one-term series or a numerical solution. A thinner body, a lower h or a more conductive " +
        "material would bring it back into range.",
    };
  }

  const tau = (inp.rho * inp.volume * inp.cp) / (inp.h * inp.area);
  if (!Number.isFinite(tau) || tau <= 0) {
    return {
      ok: false,
      error:
        "Those properties overflow the time constant, so nothing below would be a finite number. " +
        "Check the magnitudes of the density, specific heat and volume.",
    };
  }
  const theta0 = inp.tInit - inp.tAmbient;
  const frac = Math.exp(-inp.timeS / tau);
  const temperature = inp.tAmbient + theta0 * frac;
  const timeTo99 = tau * Math.log(100);
  const energy = inp.rho * inp.volume * inp.cp * (inp.tInit - temperature);
  if (![temperature, frac, timeTo99, energy].every(Number.isFinite)) {
    return {
      ok: false,
      error:
        "Those inputs overflow the arithmetic and give a result that is not a finite number. " +
        "Check the magnitudes.",
    };
  }

  // Divide BEFORE multiplying: (span * i) / 80 overflows for a span past about
  // 2.2e306 and silently fills the curve with non-finite points.
  const span = Math.max(inp.timeS, timeTo99) * 1.05;
  const curve = Array.from({ length: 81 }, (_, i) => {
    const t = (span / 80) * i;
    return { t, T: inp.tAmbient + theta0 * Math.exp(-t / tau) };
  }).filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.T));
  if (!curve.length) {
    return { ok: false, error: "Those inputs give no finite cooling curve. Check the magnitudes." };
  }

  const notes: string[] = [
    `Biot ${biot.toPrecision(3)} is below 0.1, so treating the body as isothermal is defensible. ` +
      "That check is the precondition for everything below it, not a footnote.",
    `The time constant is ${tau.toPrecision(4)} s. After one of those the body has covered 63% of ` +
      "the way to ambient, after three 95%, and after five 99.3% - which is why 'about five time " +
      "constants' is the usual rule for practical completion.",
    "Newtonian cooling: h constant over the whole surface and over the whole transient, no " +
      "radiation, no internal heat generation. Radiation matters more than people expect at high " +
      "temperature, where it can dominate convection entirely.",
  ];
  return {
    ok: true,
    lc,
    biot,
    tau,
    temperature,
    fractionRemaining: frac,
    timeTo99,
    energyJ: energy,
    curve,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 4. Radiation exchange
// ---------------------------------------------------------------------------

export type RadGeometry = "large" | "parallel" | "shields";

export interface RadiationInput {
  geometry: RadGeometry;
  /** Surface 1 temperature, degrees C. */
  t1C: number;
  /** Surface 2 (or surroundings) temperature, degrees C. */
  t2C: number;
  /** Emissivities, 0 to 1 — MEASURED inputs. */
  eps1: number;
  eps2: number;
  /** Area of surface 1, m^2. */
  area: number;
  /** Number of radiation shields, for the shields geometry. */
  shields?: number;
  /** Shield emissivity (both faces), for the shields geometry. */
  epsShield?: number;
  /** Convection coefficient for the comparison, W/(m^2*K). Zero to skip. */
  hConv?: number;
}

export interface RadiationResult {
  ok: true;
  /** Net radiant exchange, W (positive = surface 1 loses). */
  Q: number;
  /** Flux, W/m^2. */
  flux: number;
  /** The exchange factor multiplying sigma*A*(T1^4 - T2^4). */
  factor: number;
  /** An equivalent convection coefficient, W/(m^2*K), for comparison. */
  hRadiation: number;
  /** Convective heat for comparison when hConv was given, W. */
  qConvection: number | null;
  notes: string[];
}

/**
 * Net radiant exchange between two grey diffuse surfaces.
 *
 * TEMPERATURE ENTERS AS THE FOURTH POWER OF AN ABSOLUTE TEMPERATURE, which has
 * two consequences people are caught by. Celsius is not merely a shifted scale
 * here — using it gives an answer wrong by orders of magnitude, so it is
 * converted and the conversion is stated. And radiation is negligible at room
 * temperature and dominant at furnace temperature, with the crossover much
 * lower than intuition suggests; the equivalent coefficient is reported beside
 * any convection coefficient given so the comparison is direct.
 *
 * A RADIATION SHIELD WORKS BY ADDING SURFACES, not by insulating. N shields of
 * the same emissivity cut the exchange by a factor of N+1 even though they are
 * thin, conduct well and touch nothing — which is why multilayer insulation is
 * dozens of sheets of metallised film rather than a thick blanket.
 */
export function radiationExchange(inp: RadiationInput): RadiationResult | Heat2Error {
  const bad = finite([
    ["surface 1 temperature", inp.t1C],
    ["surface 2 temperature", inp.t2C],
    ["surface 1 emissivity", inp.eps1],
    ["surface 2 emissivity", inp.eps2],
    ["area", inp.area],
  ]);
  if (bad) return bad;
  for (const [name, v] of [
    ["surface 1 emissivity", inp.eps1],
    ["surface 2 emissivity", inp.eps2],
  ] as [string, number][]) {
    if (v <= 0 || v > 1) return { ok: false, error: `The ${name} must be above 0 and at most 1.` };
  }
  if (inp.area <= 0) return { ok: false, error: "The area must be greater than zero." };
  const T1 = inp.t1C + 273.15;
  const T2 = inp.t2C + 273.15;
  if (T1 <= 0 || T2 <= 0) {
    return { ok: false, error: "A temperature at or below absolute zero cannot radiate." };
  }

  const notes: string[] = [];
  let factor: number;
  switch (inp.geometry) {
    case "large":
      // A small object in large surroundings: only its own emissivity matters.
      factor = inp.eps1;
      notes.push(
        "A small object in LARGE surroundings: the surroundings absorb everything and reflect " +
          "nothing back that matters, so only the object's own emissivity appears. The " +
          "surroundings' emissivity is irrelevant here, which surprises people.",
      );
      break;
    case "parallel":
      factor = 1 / (1 / inp.eps1 + 1 / inp.eps2 - 1);
      notes.push(
        "Two large parallel surfaces: radiation bounces between them, so BOTH emissivities " +
          "appear and the combination is always smaller than either one alone.",
      );
      break;
    case "shields": {
      const n = Math.max(0, Math.floor(inp.shields ?? 0));
      const es = inp.epsShield ?? inp.eps1;
      if (es <= 0 || es > 1) return { ok: false, error: "The shield emissivity must be above 0 and at most 1." };
      if (n > 200) return { ok: false, error: "At most 200 shields." };
      const base = 1 / inp.eps1 + 1 / inp.eps2 - 1;
      const per = n * (2 / es - 1);
      factor = 1 / (base + per);
      notes.push(
        `${n} radiation shield${n === 1 ? "" : "s"} cuts the exchange by a factor of ` +
          `${(1 / (factor / (1 / base))).toFixed(2)}. A SHIELD DOES NOT INSULATE - it is thin, it ` +
          "conducts well and it touches nothing. It works by adding surfaces that must each " +
          "re-radiate, which is why multilayer insulation is dozens of sheets of metallised film " +
          "rather than one thick blanket.",
      );
      break;
    }
    default:
      return { ok: false, error: "That geometry is not supported." };
  }

  const Q = factor * SIGMA_SB * inp.area * (Math.pow(T1, 4) - Math.pow(T2, 4));
  if (!Number.isFinite(Q)) {
    return { ok: false, error: "Those temperatures overflow the fourth-power term. Check the magnitudes." };
  }
  const dT = T1 - T2;
  const hRad =
    Math.abs(dT) < 1e-12
      ? 4 * factor * SIGMA_SB * Math.pow((T1 + T2) / 2, 3)
      : Q / (inp.area * dT);
  const qConv = inp.hConv && inp.hConv > 0 ? inp.hConv * inp.area * dT : null;

  notes.push(
    `Temperatures converted to absolute: ${inp.t1C} °C = ${T1.toFixed(2)} K and ${inp.t2C} °C = ` +
      `${T2.toFixed(2)} K. The fourth power means Celsius is NOT a shifted scale here - using it ` +
      "would be wrong by orders of magnitude rather than by an offset.",
    `The equivalent coefficient is ${hRad.toPrecision(4)} W/(m²·K), which is the number to compare ` +
      "against a convection coefficient. Radiation is negligible at room temperature and " +
      "dominant in a furnace, and the crossover is lower than most people expect.",
  );
  if (qConv !== null) {
    // AT EQUAL TEMPERATURES BOTH MODES CARRY ZERO and the share is 0/0. The
    // tool's own default convection coefficient is non-zero, so simply typing
    // the same temperature twice produced "radiation carries NaN% of the
    // total" in a note that goes straight into the document.
    const total = Math.abs(Q) + Math.abs(qConv);
    if (total > 0) {
      notes.push(
        `Against the convection you gave, radiation carries ${((Math.abs(Q) / total) * 100).toFixed(1)}% of ` +
          "the total. Leaving it out entirely is the usual simplification and the usual error.",
      );
    } else {
      notes.push(
        "Both surfaces are at the same temperature, so neither radiation nor convection carries " +
          "anything and there is no split to report. Net exchange is zero by symmetry, not by " +
          "either mechanism being absent.",
      );
    }
  }
  notes.push(
    "Grey diffuse surfaces: emissivity independent of wavelength and direction. EMISSIVITY IS " +
      "YOUR MEASURED INPUT - it depends on material, finish, oxidation and wavelength, and a " +
      "built-in table would be wrong for every surface except the one it was measured on.",
  );

  return { ok: true, Q, flux: Q / inp.area, factor, hRadiation: hRad, qConvection: qConv, notes };
}
