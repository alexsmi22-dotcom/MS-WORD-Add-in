// Pharmacokinetics — dosing simulation, steady state, and non-compartmental
// analysis of real concentration-time data.
//
// THE TWO PARAMETERS THAT MATTER ARE CLEARANCE AND VOLUME, and everything else
// is derived from them. That is not a stylistic choice: CL and Vd are the
// physiologically independent quantities — clearance is how fast the organs
// remove drug, volume is how widely it distributes — while the half-life people
// quote is a CONSEQUENCE of both, t½ = ln2·Vd/CL. A patient in renal failure has
// a longer half-life because clearance fell; an obese patient may have a longer
// half-life at completely normal clearance because volume rose. Building on
// half-life hides that, so this module takes CL and Vd (or lets you enter t½ and
// derives k) and always reports which came from which.
//
// EVERY MODEL HERE IS LINEAR — first-order elimination, where clearance does not
// depend on concentration. That is true of most drugs at therapeutic doses and
// spectacularly false for some important ones: phenytoin, ethanol and high-dose
// salicylate saturate their eliminating enzymes, so clearance FALLS as
// concentration rises and a dose increase produces a more-than-proportional
// rise in exposure. Nothing here detects that, and a linear model applied to a
// saturable drug under-predicts steady state badly, so it is stated rather than
// assumed.
//
// THE FLIP-FLOP TRAP, which this module exists partly to catch. For an orally
// dosed drug the concentration curve is a difference of two exponentials, one
// governed by absorption (ka) and one by elimination (k). Everyone reads the
// terminal slope as elimination — and that is only true when ka > k. When
// absorption is the SLOWER process (depot injections, modified-release tablets,
// poorly soluble drugs) the terminal slope is the ABSORPTION rate constant, the
// "half-life" read off it is the absorption half-life, and every parameter
// derived from it is wrong. The curve looks completely normal either way. This
// module compares ka against k and says so.
//
// UNITS ARE THE CALLER'S, used consistently: dose in mg with volume in L gives
// concentration in mg/L (= µg/mL), and time is whatever the rate constants are
// per. Nothing is converted here.

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type Route = "iv-bolus" | "infusion" | "oral";

export interface PkParams {
  /** Dose per administration. */
  dose: number;
  /** Volume of distribution. */
  vd: number;
  /** Clearance. */
  cl: number;
  /** Bioavailable fraction, 0-1. Applies to the oral route. */
  f: number;
  /** First-order absorption rate constant, for the oral route. */
  ka?: number;
  /** Infusion duration, for the infusion route. */
  tInf?: number;
}

export interface PkError {
  ok: false;
  error: string;
}

export interface ConcentrationCurve {
  ok: true;
  t: number[];
  c: number[];
  /** Elimination rate constant, CL/Vd. */
  k: number;
  halfLife: number;
  cmax: number;
  tmax: number;
  /** Total exposure of a single dose, AUC 0 to infinity. */
  auc: number;
  notes: string[];
}

/** A pane recomputes on every keystroke; nothing here may grow without bound. */
const MAX_POINTS = 2000;
const MAX_DOSES = 200;

function checkCore(p: PkParams): string | null {
  const entries: [string, number][] = [
    ["dose", p.dose],
    ["volume of distribution", p.vd],
    ["clearance", p.cl],
    ["bioavailability", p.f],
  ];
  for (const [name, v] of entries) {
    if (!Number.isFinite(v)) return `The ${name} must be a finite number.`;
  }
  if (p.dose <= 0) return "The dose must be greater than zero.";
  if (p.vd <= 0) return "The volume of distribution must be greater than zero.";
  if (p.cl <= 0) return "The clearance must be greater than zero.";
  if (p.f <= 0 || p.f > 1) return "Bioavailability must be greater than 0 and at most 1.";
  return null;
}

/**
 * Concentration against time after a single dose.
 *
 * The three routes are genuinely different functions rather than one function
 * with a switch, because their shapes differ in kind: an IV bolus starts at its
 * maximum and only falls, an infusion rises towards a plateau and then falls,
 * and an oral dose rises to an interior peak. Reporting "Cmax at t = 0" for an
 * oral dose would be the giveaway that they had been conflated.
 */
export function singleDoseCurve(
  route: Route,
  p: PkParams,
  tEnd: number,
  points = 400,
): ConcentrationCurve | PkError {
  const bad = checkCore(p);
  if (bad) return { ok: false, error: bad };
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { ok: false, error: "The end time must be greater than zero." };

  const n = Math.max(2, Math.min(Math.floor(points) || 400, MAX_POINTS));
  const k = p.cl / p.vd;
  const halfLife = Math.LN2 / k;
  const notes: string[] = [];

  const t: number[] = [];
  const c: number[] = [];
  const dt = tEnd / (n - 1);

  let cmax = 0;
  let tmax = 0;
  let auc = 0;

  if (route === "iv-bolus") {
    const c0 = p.dose / p.vd;
    for (let i = 0; i < n; i++) {
      const ti = i * dt;
      t.push(ti);
      c.push(c0 * Math.exp(-k * ti));
    }
    cmax = c0;
    tmax = 0;
    auc = p.dose / p.cl;
    notes.push(
      "An IV bolus is at its maximum the instant it is given, so Cmax is C0 = Dose/Vd and Tmax " +
        "is zero. A real injection takes a minute or two and mixes, so the earliest measured " +
        "concentration is always below this idealised C0.",
    );
  } else if (route === "infusion") {
    const tInf = p.tInf ?? 0;
    if (!Number.isFinite(tInf) || tInf <= 0)
      return { ok: false, error: "The infusion duration must be greater than zero." };
    const rate = p.dose / tInf;
    const cSteady = rate / p.cl;
    const cEnd = cSteady * (1 - Math.exp(-k * tInf));
    for (let i = 0; i < n; i++) {
      const ti = i * dt;
      t.push(ti);
      c.push(ti <= tInf ? cSteady * (1 - Math.exp(-k * ti)) : cEnd * Math.exp(-k * (ti - tInf)));
    }
    cmax = cEnd;
    tmax = tInf;
    auc = p.dose / p.cl;
    notes.push(
      `The plateau this infusion approaches is rate/CL = ${cSteady.toPrecision(4)}, and it is ` +
        "approached asymptotically — 50% of it after one half-life, 90% after 3.3, 95% after 4.3. " +
        "The plateau depends ONLY on rate and clearance; the volume of distribution sets how fast " +
        "you get there and has no effect on where you end up.",
    );
    if (tInf < halfLife) {
      notes.push(
        "This infusion is shorter than one half-life, so it behaves much like a bolus and reaches " +
          "only a small fraction of the plateau.",
      );
    }
  } else {
    const ka = p.ka ?? 0;
    if (!Number.isFinite(ka) || ka <= 0)
      return { ok: false, error: "The absorption rate constant must be greater than zero." };

    const fd = p.f * p.dose;
    if (Math.abs(ka - k) < 1e-12 * Math.max(ka, k)) {
      // ka = k makes the standard formula 0/0. The limit is the well-known
      // special case, and returning NaN here for a perfectly ordinary drug
      // would be a division by zero dressed up as a result.
      for (let i = 0; i < n; i++) {
        const ti = i * dt;
        t.push(ti);
        c.push((fd / p.vd) * k * ti * Math.exp(-k * ti));
      }
      tmax = 1 / k;
      cmax = (fd / p.vd) * k * tmax * Math.exp(-k * tmax);
      notes.push(
        "The absorption and elimination rate constants are equal, which makes the usual " +
          "two-exponential formula 0/0. The limiting form has been used instead.",
      );
    } else {
      const coeff = (fd * ka) / (p.vd * (ka - k));
      for (let i = 0; i < n; i++) {
        const ti = i * dt;
        t.push(ti);
        c.push(coeff * (Math.exp(-k * ti) - Math.exp(-ka * ti)));
      }
      tmax = Math.log(ka / k) / (ka - k);
      cmax = (fd / p.vd) * Math.exp(-k * tmax);
    }
    auc = (p.f * p.dose) / p.cl;

    if (ka < k) {
      notes.push(
        "FLIP-FLOP KINETICS: the absorption rate constant is SMALLER than the elimination rate " +
          "constant, so absorption is the slower process and the TERMINAL SLOPE OF THIS CURVE IS " +
          "ABSORPTION, NOT ELIMINATION. A half-life read off the tail is the absorption half-life, " +
          "and any clearance or volume derived from it is wrong. The curve looks entirely normal " +
          "either way, which is what makes this worth stating: it is common in depot injections " +
          "and modified-release formulations.",
      );
    } else if (ka < 3 * k) {
      notes.push(
        "Absorption is less than three times faster than elimination, so the terminal phase is " +
          "not cleanly elimination-only and a half-life read from it will be biased long.",
      );
    }
    notes.push(
      `Only CL/F and Vd/F are identifiable from oral data alone. The figures here use the F = ` +
        `${p.f} you supplied; if that is a guess, so is every clearance and volume derived with it.`,
    );
  }

  return { ok: true, t, c, k, halfLife, cmax, tmax, auc, notes };
}

// ---------------------------------------------------------------------------
// Multiple dosing and steady state
// ---------------------------------------------------------------------------

export interface SteadyState {
  ok: true;
  k: number;
  halfLife: number;
  /** Accumulation ratio, Cmax,ss / Cmax after the first dose. */
  accumulation: number;
  cMaxSs: number;
  cMinSs: number;
  cAvgSs: number;
  /**
   * Peak-to-trough swing as a fraction of the trough, or null when the trough
   * has fallen to zero and the ratio has no meaning.
   */
  fluctuation: number | null;
  /** Time to reach 95% of steady state. */
  timeTo95: number;
  /** A loading dose that puts the first peak at the steady-state peak. */
  loadingDose: number;
  notes: string[];
}

/**
 * Steady state on repeated dosing at a fixed interval.
 *
 * THE AVERAGE STEADY-STATE CONCENTRATION DEPENDS ONLY ON DOSE RATE AND
 * CLEARANCE — Cavg = F·D/(CL·τ) — and not on the volume of distribution or the
 * half-life at all. Halving the dose and halving the interval leaves the average
 * exactly where it was and only narrows the peaks and troughs. That is the
 * single most useful fact in dosing and it falls straight out of the algebra, so
 * it is reported rather than left implicit.
 *
 * TIME TO STEADY STATE DEPENDS ONLY ON HALF-LIFE, and specifically NOT on the
 * dose: giving more drug does not get you there sooner, it just raises the
 * plateau you are approaching at the same rate. That is what a loading dose is
 * for, and it is why the loading dose is computed from the volume of
 * distribution while the maintenance dose is computed from clearance.
 */
export function steadyState(p: PkParams, tau: number): SteadyState | PkError {
  const bad = checkCore(p);
  if (bad) return { ok: false, error: bad };
  if (!Number.isFinite(tau) || tau <= 0) return { ok: false, error: "The dosing interval must be greater than zero." };

  const k = p.cl / p.vd;
  const halfLife = Math.LN2 / k;
  const decay = Math.exp(-k * tau);
  if (decay >= 1) return { ok: false, error: "The dosing interval is too small to resolve at this half-life." };

  const accumulation = 1 / (1 - decay);
  const c0 = (p.f * p.dose) / p.vd;
  const cMaxSs = c0 * accumulation;
  const cMinSs = cMaxSs * decay;
  const cAvgSs = (p.f * p.dose) / (p.cl * tau);
  // A TROUGH OF ZERO HAS NO FLUCTUATION RATIO, and Infinity is not the answer.
  // When the interval is many half-lives the trough underflows to exactly zero
  // and (peak - trough)/trough is a division by zero. Reporting Infinity would
  // put "not finite" into someone's document where the true statement is much
  // more useful: the drug is completely gone before the next dose. Caught by the
  // adversarial pass on an ultra-short-half-life drug, which is a real category
  // (adenosine), not a contrived one.
  const fluctuation = cMinSs > 0 ? (cMaxSs - cMinSs) / cMinSs : null;
  const timeTo95 = 4.32 * halfLife;
  const loadingDose = p.dose * accumulation;

  const notes: string[] = [];
  notes.push(
    "The average steady-state concentration is F·Dose/(CL·τ) — it depends ONLY on the dose RATE " +
      "and clearance, not on the volume of distribution and not on the half-life. Halving both " +
      "the dose and the interval leaves the average unchanged and only narrows the swing.",
  );
  notes.push(
    `Steady state is reached after about ${timeTo95.toPrecision(3)} (4.3 half-lives for 95%), and ` +
      "that time depends only on the half-life. A larger maintenance dose does NOT get there " +
      "sooner — it raises the plateau being approached at the same rate. A loading dose does.",
  );

  if (tau > 3 * halfLife) {
    notes.push(
      `The interval is more than three half-lives, so there is almost no accumulation ` +
        `(ratio ${accumulation.toFixed(2)}) and the concentration falls close to zero between doses. ` +
        "That is fine for a drug that works on peak exposure and poor for one that needs a " +
        "sustained level.",
    );
  }
  if (fluctuation === null) {
    notes.push(
      "The trough falls to zero before the next dose, so there is no meaningful peak-to-trough " +
        "ratio: the drug is completely eliminated between doses and each dose acts alone. That is " +
        "intended for some drugs and a dosing failure for others — it means there is no sustained " +
        "concentration at all between administrations.",
    );
  } else if (fluctuation > 3) {
    notes.push(
      `Peak-to-trough fluctuation is large (${(fluctuation * 100).toFixed(0)}% of the trough). If ` +
        "the therapeutic window is narrow, a shorter interval at a proportionally smaller dose " +
        "keeps the same average with a much smaller swing.",
    );
  }
  notes.push(
    "All of this assumes FIRST-ORDER (linear) elimination. For a drug with saturable metabolism — " +
      "phenytoin is the classic — clearance falls as concentration rises, and these figures " +
      "under-predict steady state badly.",
  );

  return {
    ok: true,
    k,
    halfLife,
    accumulation,
    cMaxSs,
    cMinSs,
    cAvgSs,
    fluctuation,
    timeTo95,
    loadingDose,
    notes,
  };
}

/** Concentration-time trace over repeated IV bolus doses. */
export function multipleDoseCurve(
  p: PkParams,
  tau: number,
  doses: number,
  points = 600,
): { ok: true; t: number[]; c: number[] } | PkError {
  const bad = checkCore(p);
  if (bad) return { ok: false, error: bad };
  if (!Number.isFinite(tau) || tau <= 0) return { ok: false, error: "The dosing interval must be greater than zero." };
  if (!Number.isFinite(doses) || doses < 1) return { ok: false, error: "The number of doses must be at least one." };
  const nDoses = Math.min(Math.floor(doses), MAX_DOSES);
  const n = Math.max(2, Math.min(Math.floor(points) || 600, MAX_POINTS));

  const k = p.cl / p.vd;
  const c0 = (p.f * p.dose) / p.vd;
  const tEnd = tau * nDoses;
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = (tEnd * i) / (n - 1);
    // Superposition: a linear system's response to repeated doses is the sum of
    // the individual responses, which is exact here rather than a simulation.
    let conc = 0;
    for (let d = 0; d < nDoses; d++) {
      const start = d * tau;
      if (ti >= start) conc += c0 * Math.exp(-k * (ti - start));
    }
    t.push(ti);
    c.push(conc);
  }
  return { ok: true, t, c };
}

// ---------------------------------------------------------------------------
// Non-compartmental analysis
// ---------------------------------------------------------------------------

export interface NcaResult {
  ok: true;
  cmax: number;
  tmax: number;
  /** Terminal elimination rate constant. */
  lambdaZ: number;
  halfLife: number;
  /** Points used for the terminal regression. */
  lambdaPoints: number;
  lambdaR2: number;
  /** AUC to the last measured point, by the trapezoidal rule. */
  aucLast: number;
  /** AUC extrapolated to infinity. */
  aucInf: number;
  /** Percentage of the total AUC that came from extrapolation. */
  percentExtrapolated: number;
  /** Apparent clearance — CL for IV, CL/F for oral. */
  clearance: number;
  /** Apparent terminal volume. */
  volume: number;
  /** Mean residence time. */
  mrt: number;
  notes: string[];
}

/**
 * Non-compartmental analysis of measured concentration-time data — what a PK
 * scientist actually does with a study, as opposed to fitting a model.
 *
 * THE TERMINAL SLOPE IS CHOSEN, NOT ASSUMED. λz comes from a log-linear
 * regression over the last few points, and WHICH points is the entire question:
 * take too few and the estimate is noise, take too many and you drag in the
 * distribution phase and bias the half-life short. The standard rule — and the
 * one used here — is to try every window of at least three points ending at the
 * last measurement and keep the one with the best ADJUSTED R², because adjusted
 * R² is the version that does not automatically improve as points are added.
 *
 * THE EXTRAPOLATED FRACTION IS THE QUALITY CHECK NOBODY REPORTS. AUC to
 * infinity is AUC to the last sample plus Clast/λz, and if that tail is a large
 * share of the total then the study simply did not follow the drug long enough
 * and every parameter derived from AUC∞ is mostly extrapolation. Over 20% is
 * conventionally unacceptable; it is computed and flagged here rather than
 * buried.
 *
 * CLEARANCE FROM ORAL DATA IS CL/F AND NOT CL. Dose/AUC gives apparent
 * clearance, and without knowing the bioavailable fraction there is no way to
 * separate the two. Calling it "clearance" is a real error — a drug with 50%
 * bioavailability looks like it has twice the clearance it has — so the caller
 * says which route the data came from and the label follows.
 */
export function nca(
  times: number[],
  concentrations: number[],
  dose: number,
  route: "iv" | "oral",
): NcaResult | PkError {
  if (times.length !== concentrations.length)
    return { ok: false, error: "There must be exactly one concentration for each time." };
  if (times.length < 3) return { ok: false, error: "Non-compartmental analysis needs at least three points." };
  if (times.length > MAX_POINTS) return { ok: false, error: `Too many points; the limit is ${MAX_POINTS}.` };
  if (!Number.isFinite(dose) || dose <= 0) return { ok: false, error: "The dose must be greater than zero." };

  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) return { ok: false, error: `Time ${i + 1} is not a finite number.` };
    if (!Number.isFinite(concentrations[i]))
      return { ok: false, error: `Concentration ${i + 1} is not a finite number.` };
    if (concentrations[i] < 0) return { ok: false, error: "Concentrations cannot be negative." };
    if (i > 0 && times[i] <= times[i - 1])
      return { ok: false, error: "Times must be strictly increasing." };
  }

  const notes: string[] = [];
  const n = times.length;

  let cmax = -Infinity;
  let tmax = times[0];
  for (let i = 0; i < n; i++) {
    if (concentrations[i] > cmax) {
      cmax = concentrations[i];
      tmax = times[i];
    }
  }
  if (cmax <= 0) return { ok: false, error: "Every concentration is zero; there is nothing to analyse." };

  // AUC by the linear trapezoidal rule, and AUMC for the mean residence time.
  let aucLast = 0;
  let aumcLast = 0;
  for (let i = 1; i < n; i++) {
    const dt = times[i] - times[i - 1];
    aucLast += ((concentrations[i] + concentrations[i - 1]) / 2) * dt;
    aumcLast += ((times[i] * concentrations[i] + times[i - 1] * concentrations[i - 1]) / 2) * dt;
  }

  // Terminal slope: try every window of >= 3 points ending at the last, keep
  // the best adjusted R^2.
  let best: { lambda: number; r2: number; points: number; intercept: number } | null = null;
  const startFrom = times.findIndex((t) => t > tmax);
  const earliest = startFrom < 0 ? n - 3 : startFrom;
  for (let s = Math.max(0, earliest); s <= n - 3; s++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = s; i < n; i++) {
      if (concentrations[i] > 0) {
        xs.push(times[i]);
        ys.push(Math.log(concentrations[i]));
      }
    }
    if (xs.length < 3) continue;
    const m = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / m;
    const my = ys.reduce((a, b) => a + b, 0) / m;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < m; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (sxx <= 0 || syy <= 0) continue;
    const slope = sxy / sxx;
    if (slope >= 0) continue; // not a decline; not a terminal phase
    const r2 = (sxy * sxy) / (sxx * syy);
    const adj = 1 - ((1 - r2) * (m - 1)) / (m - 2);
    if (!best || adj > best.r2) {
      best = { lambda: -slope, r2: adj, points: m, intercept: my - slope * mx };
    }
  }

  if (!best) {
    return {
      ok: false,
      error:
        "No terminal decline could be identified: a log-linear regression over the points after " +
        "Cmax never came out with a negative slope on at least three positive concentrations. " +
        "Either the profile has not started falling yet, or the tail is below the assay limit.",
    };
  }

  const lambdaZ = best.lambda;
  const halfLife = Math.LN2 / lambdaZ;
  const clast = concentrations[n - 1];
  const aucInf = aucLast + clast / lambdaZ;
  const percentExtrapolated = (100 * (clast / lambdaZ)) / aucInf;
  const aumcInf =
    aumcLast + (times[n - 1] * clast) / lambdaZ + clast / (lambdaZ * lambdaZ);
  const clearance = dose / aucInf;
  const volume = dose / (lambdaZ * aucInf);
  const mrt = aumcInf / aucInf;

  if (percentExtrapolated > 20) {
    notes.push(
      `${percentExtrapolated.toFixed(1)}% of the total AUC comes from EXTRAPOLATION beyond the last ` +
        "sample, which is above the 20% normally considered acceptable. The study did not follow " +
        "the drug long enough, so the clearance, volume and half-life reported here rest mostly on " +
        "an assumed exponential tail rather than on measurement.",
    );
  }
  if (best.points < 3) {
    notes.push("The terminal slope rests on fewer than three points and should not be relied on.");
  }
  if (best.r2 < 0.9) {
    notes.push(
      `The terminal regression fits poorly (adjusted R² = ${best.r2.toFixed(3)}). The tail may still ` +
        "contain a distribution phase, or the points may be near the assay's limit of quantitation " +
        "where scatter is largest.",
    );
  }
  if (times[n - 1] < 3 * halfLife) {
    notes.push(
      `Sampling stopped at ${times[n - 1]}, which is less than three estimated half-lives ` +
        `(${halfLife.toPrecision(3)} each). A terminal half-life estimated over less than that is ` +
        "routinely too short, because a slower phase further out has not been observed yet.",
    );
  }

  if (route === "oral") {
    notes.push(
      "These data are oral, so Dose/AUC is APPARENT clearance CL/F and Dose/(λz·AUC) is apparent " +
        "volume Vz/F — not CL and Vz. Bioavailability cannot be separated from them without an " +
        "intravenous reference, and calling CL/F 'clearance' makes a drug with 50% bioavailability " +
        "look as though it clears twice as fast as it does.",
    );
  } else {
    notes.push(
      "Vss = CL x MRT is the steady-state volume and is the more meaningful volume for an IV " +
        "drug; Vz reported here is the terminal-phase volume and is generally larger.",
    );
  }

  notes.push(
    "AUC uses the linear trapezoidal rule, which slightly OVER-estimates on a falling curve " +
      "because a chord lies above a convex exponential. With dense sampling the error is small; " +
      "with sparse late samples it is not.",
  );

  return {
    ok: true,
    cmax,
    tmax,
    lambdaZ,
    halfLife,
    lambdaPoints: best.points,
    lambdaR2: best.r2,
    aucLast,
    aucInf,
    percentExtrapolated,
    clearance,
    volume,
    mrt,
    notes,
  };
}

/** Parses "time concentration" pairs, one per line or comma separated. */
export function parseConcentrationData(
  text: string,
): { times: number[]; concentrations: number[]; errors: string[] } {
  const times: number[] = [];
  const concentrations: number[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].split(/[#;]/)[0].trim();
    if (!raw) continue;
    const parts = raw.split(/[\s,\t]+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`Line ${i + 1}: expected a time and a concentration, got ${parts.length} value(s).`);
      continue;
    }
    const t = Number(parts[0]);
    const c = Number(parts[1]);
    if (!Number.isFinite(t) || !Number.isFinite(c)) {
      errors.push(`Line ${i + 1}: "${raw}" is not a pair of numbers.`);
      continue;
    }
    times.push(t);
    concentrations.push(c);
  }
  if (!times.length && !errors.length) errors.push("No data points were given.");
  return { times, concentrations, errors };
}
