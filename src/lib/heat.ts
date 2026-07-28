// Heat transfer — composite wall conduction and heat-exchanger sizing.
//
// THE THERMAL RESISTANCE NETWORK IS THE WHOLE IDEA. Steady one-dimensional
// conduction through a series of layers is exactly Ohm's law with temperature
// for voltage and heat rate for current, so a wall is a chain of resistances
//
//     plane      R = t / (k A)
//     cylinder   R = ln(r2/r1) / (2 pi k L)
//     convection R = 1 / (h A)
//
// added in series. That is not an analogy applied loosely; it is the same
// differential equation, and it means the interface temperatures fall out of
// the same solve rather than needing a second pass — each one is the previous
// temperature minus Q times the resistance crossed to reach it.
//
// WHY THE CYLINDER IS NOT THE PLANE WITH A CORRECTION. The area through which
// heat flows GROWS with radius, so the resistance of a radial layer is
// logarithmic rather than linear in thickness. Doubling the thickness of pipe
// insulation does not double its resistance, and the difference is not small
// for a small pipe. The consequence is the CRITICAL RADIUS: on a thin pipe,
// adding insulation increases the outer surface area faster than it adds
// conductive resistance, and the pipe LOSES MORE HEAT than it did bare, up to
// r = k/h. This is the single most counter-intuitive result in the subject and
// the one place where doing the obvious thing makes the problem worse, so it is
// computed and reported rather than left for the reader to discover.
//
// UNITS ARE STRICT SI THROUGHOUT: metres, watts, kelvin (or Celsius —
// temperature DIFFERENCES are identical in both, and only differences appear).

export interface Layer {
  name: string;
  /** Thermal conductivity, W/(m*K). */
  k: number;
  /** Thickness, m. For a cylinder this is the radial thickness of the layer. */
  t: number;
}

export interface WallInput {
  geometry: "plane" | "cylinder";
  layers: Layer[];
  /** Area, m^2. Plane geometry only. */
  A?: number;
  /** Inner radius, m. Cylinder only. */
  r1?: number;
  /** Length, m. Cylinder only. */
  L?: number;
  /** Inside convection coefficient, W/(m^2*K). 0 to omit. */
  hIn: number;
  /** Outside convection coefficient, W/(m^2*K). 0 to omit. */
  hOut: number;
  /** Inside fluid temperature, degrees C. */
  tIn: number;
  /** Outside fluid temperature, degrees C. */
  tOut: number;
}

export interface ResistanceStep {
  name: string;
  /** Thermal resistance, K/W. */
  R: number;
  /** Fraction of the total resistance. */
  share: number;
  /** Temperature at the FAR side of this step, degrees C. */
  tAfter: number;
}

export interface WallResult {
  ok: true;
  steps: ResistanceStep[];
  /** Total thermal resistance, K/W. */
  Rtotal: number;
  /** Heat rate, W. Positive flows from inside to outside. */
  Q: number;
  /** Heat flux per unit outer area, W/m^2. */
  flux: number;
  /** Overall coefficient based on the outer area, W/(m^2*K). */
  U: number;
  /** Outer surface area, m^2. */
  areaOuter: number;
  /** The layer or film contributing the most resistance. */
  controlling: string;
  /** Critical radius of insulation, m; cylinder with an outside film only. */
  criticalRadius: number | null;
  notes: string[];
}

export interface HeatError {
  ok: false;
  error: string;
}

/** A pane recomputes per keystroke; a wall with hundreds of layers is a typo. */
const MAX_LAYERS = 20;

/** Steady one-dimensional conduction through a composite wall or pipe. */
export function analyzeWall(inp: WallInput): WallResult | HeatError {
  const { geometry, layers, hIn, hOut, tIn, tOut } = inp;

  if (!layers.length) return { ok: false, error: "Give at least one layer." };
  if (layers.length > MAX_LAYERS)
    return { ok: false, error: `Too many layers (${layers.length}); the limit is ${MAX_LAYERS}.` };

  for (const [name, v] of [
    ["inside film coefficient", hIn],
    ["outside film coefficient", hOut],
    ["inside temperature", tIn],
    ["outside temperature", tOut],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (hIn < 0 || hOut < 0) return { ok: false, error: "A film coefficient cannot be negative." };

  for (const l of layers) {
    if (!Number.isFinite(l.k) || l.k <= 0)
      return { ok: false, error: `Layer "${l.name}": the conductivity must be greater than zero.` };
    if (!Number.isFinite(l.t) || l.t <= 0)
      return { ok: false, error: `Layer "${l.name}": the thickness must be greater than zero.` };
  }

  const notes: string[] = [];
  const steps: ResistanceStep[] = [];

  // Build the resistance chain, inner film first.
  const chain: { name: string; R: number }[] = [];
  let areaOuter: number;
  let areaInner: number;

  if (geometry === "plane") {
    const A = inp.A;
    if (A === undefined || !Number.isFinite(A) || A <= 0)
      return { ok: false, error: "The area must be greater than zero." };
    areaOuter = A;
    areaInner = A;
    if (hIn > 0) chain.push({ name: "Inside film", R: 1 / (hIn * A) });
    for (const l of layers) chain.push({ name: l.name, R: l.t / (l.k * A) });
    if (hOut > 0) chain.push({ name: "Outside film", R: 1 / (hOut * A) });
  } else {
    const r1 = inp.r1;
    const L = inp.L;
    if (r1 === undefined || !Number.isFinite(r1) || r1 <= 0)
      return { ok: false, error: "The inner radius must be greater than zero." };
    if (L === undefined || !Number.isFinite(L) || L <= 0)
      return { ok: false, error: "The length must be greater than zero." };
    areaInner = 2 * Math.PI * r1 * L;
    if (hIn > 0) chain.push({ name: "Inside film", R: 1 / (hIn * areaInner) });
    let r = r1;
    for (const l of layers) {
      const rNext = r + l.t;
      chain.push({ name: l.name, R: Math.log(rNext / r) / (2 * Math.PI * l.k * L) });
      r = rNext;
    }
    areaOuter = 2 * Math.PI * r * L;
    if (hOut > 0) chain.push({ name: "Outside film", R: 1 / (hOut * areaOuter) });
  }

  const Rtotal = chain.reduce((s, c) => s + c.R, 0);
  if (!(Rtotal > 0)) return { ok: false, error: "The total thermal resistance came out as zero." };

  const Q = (tIn - tOut) / Rtotal;

  let t = tIn;
  for (const c of chain) {
    t -= Q * c.R;
    steps.push({ name: c.name, R: c.R, share: c.R / Rtotal, tAfter: t });
  }

  const controlling = chain.reduce((a, b) => (b.R > a.R ? b : a)).name;
  const dominant = chain.reduce((a, b) => (b.R > a.R ? b : a));
  if (dominant.R / Rtotal > 0.6) {
    notes.push(
      `"${dominant.name}" alone is ${(100 * (dominant.R / Rtotal)).toFixed(0)}% of the total ` +
        "resistance and controls this wall. Improving any other layer will barely change the " +
        "heat rate — this is the one to change.",
    );
  }

  if (hIn === 0 || hOut === 0) {
    notes.push(
      "A film coefficient of zero means that surface was treated as being AT the fluid " +
        "temperature — an infinite film coefficient, not a perfectly insulating one. If you " +
        "meant to insulate that side, the wall has no heat flow at all.",
    );
  }

  // The critical radius, for a cylinder losing heat to an outside film.
  let criticalRadius: number | null = null;
  if (geometry === "cylinder" && hOut > 0) {
    const outer = layers[layers.length - 1];
    criticalRadius = outer.k / hOut;
    const rOuter = (inp.r1 as number) + layers.reduce((s, l) => s + l.t, 0);
    if (rOuter < criticalRadius) {
      notes.push(
        `THE INSULATION IS MAKING THIS WORSE. The outer radius ${rOuter.toFixed(4)} m is BELOW ` +
          `the critical radius k/h = ${criticalRadius.toFixed(4)} m, so adding more of the outer ` +
          "layer increases the exposed surface area faster than it adds resistance and the pipe " +
          "loses MORE heat than it would bare. Either strip it or take it past the critical " +
          "radius; anything in between is worse than nothing.",
      );
    }
  }

  if (tIn === tOut) {
    notes.push("The two fluid temperatures are equal, so there is no driving force and no heat flow.");
  }

  return {
    ok: true,
    steps,
    Rtotal,
    Q,
    flux: Q / areaOuter,
    U: 1 / (Rtotal * areaOuter),
    areaOuter,
    controlling,
    criticalRadius,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Heat exchangers
// ---------------------------------------------------------------------------

export type ExchangerFlow = "counter" | "parallel";

export interface ExchangerInput {
  flow: ExchangerFlow;
  /** Hot stream inlet and outlet, degrees C. */
  thIn: number;
  thOut: number;
  /** Cold stream inlet and outlet, degrees C. */
  tcIn: number;
  tcOut: number;
  /** Overall coefficient, W/(m^2*K). */
  U: number;
  /** Area, m^2. Give this to get Q, or leave it out and give Q to get the area. */
  A?: number;
  /** Heat duty, W. */
  Q?: number;
}

export interface ExchangerResult {
  ok: true;
  /** Log mean temperature difference, K. */
  lmtd: number;
  /** Terminal differences, K. */
  dt1: number;
  dt2: number;
  Q: number;
  A: number;
  /** True when the outlet temperatures cross — impossible in parallel flow. */
  crossed: boolean;
  notes: string[];
}

/**
 * Log mean temperature difference sizing.
 *
 * THE EQUAL-TERMINAL-DIFFERENCE CASE IS A REMOVABLE SINGULARITY, not an error.
 * When dt1 = dt2 the formula (dt1 - dt2)/ln(dt1/dt2) is 0/0, and its limit is
 * simply dt1 — a balanced counterflow exchanger with equal capacity rates has a
 * constant temperature difference along its whole length, which is a perfectly
 * ordinary design and not a degenerate one. Evaluating the formula anyway
 * returns NaN for a case a student is very likely to type, so the limit is
 * taken explicitly. It is applied on a RELATIVE tolerance, because two terminal
 * differences of 10.0000001 and 10 K produce a catastrophically cancelled
 * numerator and a meaningless ratio long before they are exactly equal.
 *
 * A TEMPERATURE CROSS IS REFUSED FOR PARALLEL FLOW. In parallel flow both
 * streams approach a common temperature from opposite sides, so the cold outlet
 * cannot exceed the hot outlet — no exchanger of any area achieves it. In
 * counterflow it is not only possible but routine, and it is the reason
 * counterflow is used at all.
 */
export function analyzeExchanger(inp: ExchangerInput): ExchangerResult | HeatError {
  const { flow, thIn, thOut, tcIn, tcOut, U } = inp;

  for (const [name, v] of [
    ["hot inlet", thIn],
    ["hot outlet", thOut],
    ["cold inlet", tcIn],
    ["cold outlet", tcOut],
    ["overall coefficient", U],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (U <= 0) return { ok: false, error: "The overall coefficient must be greater than zero." };

  const notes: string[] = [];

  if (thOut > thIn) return { ok: false, error: "The hot stream got hotter; check the hot inlet and outlet." };
  if (tcOut < tcIn) return { ok: false, error: "The cold stream got colder; check the cold inlet and outlet." };
  if (tcOut > thIn)
    return {
      ok: false,
      error:
        "The cold outlet is above the HOT INLET. No exchanger can do that — the cold stream " +
        "cannot be heated past the hottest thing available to heat it.",
    };

  const crossed = tcOut > thOut;

  let dt1: number;
  let dt2: number;
  if (flow === "counter") {
    dt1 = thIn - tcOut;
    dt2 = thOut - tcIn;
    if (crossed) {
      notes.push(
        "The outlet temperatures CROSS (the cold stream leaves hotter than the hot stream). " +
          "That is normal and desirable in counterflow, and is exactly what parallel flow " +
          "cannot do.",
      );
    }
  } else {
    dt1 = thIn - tcIn;
    dt2 = thOut - tcOut;
    if (dt2 <= 0) {
      return {
        ok: false,
        error:
          "In PARALLEL flow the cold outlet cannot reach or pass the hot outlet — both streams " +
          "approach a common temperature from opposite sides, so the terminal difference at the " +
          "far end must stay positive. No area achieves these temperatures in parallel flow. " +
          "Counterflow can; switch the arrangement.",
      };
    }
  }

  if (dt1 <= 0 || dt2 <= 0) {
    return {
      ok: false,
      error: "A terminal temperature difference is zero or negative, so no finite area transfers this duty.",
    };
  }

  // The removable singularity. Relative tolerance, not absolute.
  const lmtd =
    Math.abs(dt1 - dt2) < 1e-9 * Math.max(dt1, dt2) ? dt1 : (dt1 - dt2) / Math.log(dt1 / dt2);

  let Q: number;
  let A: number;
  if (inp.A !== undefined && Number.isFinite(inp.A)) {
    if (inp.A <= 0) return { ok: false, error: "The area must be greater than zero." };
    A = inp.A;
    Q = U * A * lmtd;
  } else if (inp.Q !== undefined && Number.isFinite(inp.Q)) {
    if (inp.Q <= 0) return { ok: false, error: "The duty must be greater than zero." };
    Q = inp.Q;
    A = Q / (U * lmtd);
  } else {
    return { ok: false, error: "Give either an area (to get the duty) or a duty (to get the area)." };
  }

  if (flow === "counter") {
    notes.push(
      "This is the LMTD for a true counterflow exchanger. A shell-and-tube or crossflow unit " +
        "needs a correction factor F (always below 1, and steeply so once F drops under about " +
        "0.8) which depends on the pass arrangement and is read from a chart. The area here is " +
        "therefore a LOWER BOUND for any real multi-pass unit.",
    );
  } else {
    notes.push(
      "Parallel flow always needs more area than counterflow for the same duty, because its " +
        "mean driving force is smaller. It is chosen for other reasons — a gentler wall " +
        "temperature at the hot inlet — not for efficiency.",
    );
  }

  return { ok: true, lmtd, dt1, dt2, Q, A, crossed, notes };
}

/**
 * Thermal conductivity of common materials, W/(m*K), at around room temperature.
 *
 * These are representative values. Real conductivity varies with density,
 * moisture and temperature — mineral wool spans a factor of two across
 * densities, and damp insulation can be several times worse than the dry figure
 * quoted anywhere. Use a supplier's number for anything that matters.
 */
export const CONDUCTIVITY: { id: string; label: string; k: number }[] = [
  { id: "copper", label: "Copper", k: 401 },
  { id: "aluminium", label: "Aluminium", k: 237 },
  { id: "steel", label: "Carbon steel", k: 50 },
  { id: "stainless", label: "Stainless steel 304", k: 16 },
  { id: "concrete", label: "Concrete", k: 1.4 },
  { id: "glass", label: "Glass", k: 1.0 },
  { id: "brick", label: "Common brick", k: 0.72 },
  { id: "water", label: "Water (still)", k: 0.6 },
  { id: "gypsum", label: "Gypsum plasterboard", k: 0.17 },
  { id: "wood", label: "Softwood", k: 0.12 },
  { id: "pvc", label: "PVC", k: 0.19 },
  { id: "mineralwool", label: "Mineral wool", k: 0.04 },
  { id: "eps", label: "Expanded polystyrene", k: 0.035 },
  { id: "pur", label: "Polyurethane foam", k: 0.026 },
  { id: "air", label: "Air (still, no convection)", k: 0.026 },
];
