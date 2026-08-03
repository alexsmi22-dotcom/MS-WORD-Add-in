// Reliability — an entire discipline the bench did not have, and the one closest
// to what the client base actually files.
//
// Everything here is arithmetic over rates and lives the USER supplies. There
// is no built-in failure-rate handbook and there will not be one: a failure
// rate is a property of a part, a duty cycle and an environment, and a table of
// them would be wrong for every application except the one it was measured in.
// That is the same refusal this bench already makes for Cd, emissivity and
// Thiele-Small parameters.
//
// TWO DEFINITIONS THAT ARE CONSTANTLY CONFLATED, and which this module keeps
// apart in its own naming:
//
//   MTTF — mean time TO failure. A non-repairable item. It is the mean of the
//          life distribution, and for a Weibull it is eta*gamma(1 + 1/beta),
//          which equals 1/lambda ONLY when beta = 1.
//   MTBF — mean time BETWEEN failures. A repairable item that is restored and
//          put back in service. It pairs with MTTR, and only this one belongs
//          in an availability calculation.
//
// Writing "MTBF = 1/lambda" is right for a constant hazard and wrong the moment
// anything wears out, which is the whole reason the Weibull shape parameter is
// worth fitting.

import { gammaln } from "./stats";
import { probit } from "./regression";

/** The 95 % point of chi-square with one degree of freedom, DERIVED rather than
 * typed: it is the square of the standard normal 0.975 quantile. */
const CHI2_1_95 = probit(0.975) ** 2;

/** ln(1/0.9) — the B10 life is the time by which a tenth of the population has
 * failed, so F = 0.1 and (-ln(1 - F)) is this. Computed, not quoted. */
const NEG_LOG_0_9 = -Math.log(0.9);

const finite = (x: number): boolean => Number.isFinite(x);

/**
 * log(sum(exp(v))) without overflowing. Reliability arithmetic runs over
 * t^beta with beta up to hundreds and t up to millions of hours, where the
 * direct product overflows long before the answer does.
 */
function logSumExp(values: number[]): number {
  const max = maxOf(values);
  if (!finite(max)) return max;
  let sum = 0;
  for (const v of values) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

/**
 * Math.max over an array, by LOOP rather than by spread.
 *
 * `Math.max(...xs)` pushes every element onto the call stack and throws
 * "Maximum call stack size exceeded" somewhere past sixty-odd thousand
 * arguments. In a task pane an uncaught throw is not an error message, it is a
 * dead pane - the same failure mode as the unbounded loops that froze Word.
 * Every reduction in this module goes through here.
 */
function maxOf(values: number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  return max;
}

function minOf(values: number[]): number {
  let min = Infinity;
  for (const v of values) if (v < min) min = v;
  return min;
}

// ---------------------------------------------------------------------------
// 1. Weibull life
// ---------------------------------------------------------------------------

export interface WeibullInput {
  /** Times to failure or to censoring, in hours. All strictly positive. */
  times: number[];
  /** 1 where the unit failed at that time, 0 where it was still running. */
  events: number[];
}

export interface WeibullResult {
  ok: true;
  /** Shape. Below 1 the hazard falls, at 1 it is constant, above 1 it rises. */
  beta: number;
  /** Scale, hours — the 63.2 % life, whatever the shape. */
  eta: number;
  /** Likelihood-ratio 95 % interval on beta; null if the profile is too flat. */
  betaLow: number | null;
  betaHigh: number | null;
  /** Mean time to failure, hours. Null when 1/beta overflows the gamma. */
  mttf: number | null;
  /** The time by which a tenth have failed, hours. */
  b10: number;
  /** The time by which half have failed, hours. */
  medianLife: number;
  failures: number;
  censored: number;
  /** "infant mortality" | "constant hazard" | "wear-out" | "not resolved". */
  regime: string;
  /** Probability-plot points: x = ln t, y = ln(-ln(1 - F)). */
  points: { x: number; y: number }[];
  /** The fitted straight line on those same axes. */
  fitLine: { x: number; y: number }[];
  notes: string[];
}

export type WeibullOut = WeibullResult | { ok: false; error: string };

/**
 * Fits a two-parameter Weibull by MAXIMUM LIKELIHOOD, handling right-censored
 * units.
 *
 * Not by regression on a probability plot. Median-rank regression needs a
 * plotting-position approximation, and this bench has already been bitten once
 * by numbers that looked standard and were fitted. The likelihood equation
 *
 *     sum(t^b ln t) / sum(t^b)  -  1/b  -  mean of ln t over the FAILURES  =  0
 *
 * is exact, is monotone increasing in b, and needs nothing but the data.
 */
export function weibullFit(inp: WeibullInput): WeibullOut {
  const { times, events } = inp;
  if (times.length !== events.length) {
    return { ok: false, error: "Every time needs a matching failed/running flag." };
  }
  if (times.length < 2) return { ok: false, error: "Fitting a life distribution needs at least two units." };
  // 20,000 measured at 0.4 s and 100,000 at 2 s, which is a visibly hung pane
  // for a data set nobody types. The cap is set from that measurement.
  if (times.length > 20000) {
    return { ok: false, error: "That is more than 20,000 units. Trim the data set - the fit does not need that many." };
  }
  for (const t of times) {
    if (!finite(t) || t <= 0) return { ok: false, error: "Every time must be a positive number of hours." };
  }
  for (const e of events) {
    if (e !== 0 && e !== 1) return { ok: false, error: "Each unit is either failed (1) or still running (0)." };
  }

  const n = times.length;
  const logs = times.map(Math.log);
  const failIdx: number[] = [];
  for (let i = 0; i < n; i++) if (events[i] === 1) failIdx.push(i);
  const r = failIdx.length;
  if (r === 0) return { ok: false, error: "Nothing has failed yet, so there is no life distribution to fit." };
  if (r === 1) {
    return {
      ok: false,
      error:
        "One failure cannot fix both a shape and a scale. A single failure tells you a life is at least " +
        "that long and nothing about the spread.",
    };
  }
  const failLogs = failIdx.map((i) => logs[i]);
  const distinctFailures = new Set(failIdx.map((i) => times[i])).size;
  if (distinctFailures < 2) {
    return {
      ok: false,
      error:
        "Every failure happened at the same time, which drives the shape parameter to infinity. " +
        "A Weibull fit needs at least two different failure times.",
    };
  }
  const sumFailLogs = failLogs.reduce((a, b) => a + b, 0);
  const meanFailLog = sumFailLogs / r;

  /** The likelihood equation, evaluated without forming t^beta directly. */
  const g = (b: number): number => {
    const scaled = logs.map((L) => b * L);
    const max = maxOf(scaled);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.exp(scaled[i] - max);
      num += w * logs[i];
      den += w;
    }
    return num / den - 1 / b - meanFailLog;
  };

  // Bracket, then bisect. Both loops are COUNTED, not conditioned on a
  // tolerance: a bound that depends on the arithmetic converging is not a bound.
  let lo = 1;
  let hi = 1;
  let guard = 0;
  while (g(lo) > 0 && guard++ < 200) lo /= 2;
  if (guard >= 200 || !finite(g(lo))) {
    return { ok: false, error: "The shape parameter could not be bracketed from this data." };
  }
  guard = 0;
  while (g(hi) < 0 && guard++ < 200) hi *= 2;
  if (guard >= 200 || !finite(g(hi))) {
    return { ok: false, error: "The shape parameter could not be bracketed from this data." };
  }
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) hi = mid;
    else lo = mid;
  }
  const beta = (lo + hi) / 2;
  if (!finite(beta) || beta <= 0) {
    return { ok: false, error: "The shape parameter did not converge to a usable value." };
  }

  /** ln(sum over ALL units of t^b) — censored units contribute here too. */
  const logSumTb = (b: number): number => logSumExp(logs.map((L) => b * L));

  const logEta = (logSumTb(beta) - Math.log(r)) / beta;
  const eta = Math.exp(logEta);
  if (!finite(eta) || eta <= 0) {
    return { ok: false, error: "The scale parameter overflowed. Check the units on the times." };
  }

  // Profile log-likelihood, eta having been substituted out.
  const profile = (b: number): number =>
    r * Math.log(b) + (b - 1) * sumFailLogs - r * (logSumTb(b) - Math.log(r)) - r;
  const best = profile(beta);
  const target = best - CHI2_1_95 / 2;

  /** Walk out from the peak, then bisect for where the profile drops to target. */
  const edge = (dir: -1 | 1): number | null => {
    let step = beta * 0.5;
    let outer = beta;
    for (let i = 0; i < 200; i++) {
      const next = dir === 1 ? outer + step : outer / 2;
      if (!finite(next) || next <= 0) return null;
      if (!finite(profile(next))) return null;
      if (profile(next) < target) {
        let a = outer;
        let b2 = next;
        for (let k = 0; k < 200; k++) {
          const m = (a + b2) / 2;
          if (profile(m) < target) b2 = m;
          else a = m;
        }
        return (a + b2) / 2;
      }
      outer = next;
      step *= 2;
    }
    return null;
  };
  const betaLow = edge(-1);
  const betaHigh = edge(1);

  // MTTF = eta * gamma(1 + 1/beta). For a very small beta, 1/beta is large and
  // the gamma overflows a double long before the arithmetic is meaningless -
  // report nothing rather than "Infinity h", which the em-dash rule would then
  // block from being inserted at all.
  const lnMttf = logEta + gammaln(1 + 1 / beta);
  const mttf = lnMttf < 709 ? Math.exp(lnMttf) : null;

  const b10 = eta * Math.pow(NEG_LOG_0_9, 1 / beta);
  const medianLife = eta * Math.pow(Math.LN2, 1 / beta);

  // The regime is read from the INTERVAL, not the point estimate. A fitted
  // beta of 1.3 from eight units is not evidence of wear-out, and saying so is
  // the difference between a conclusion and a coincidence.
  let regime: string;
  if (betaLow !== null && betaLow > 1) regime = "wear-out";
  else if (betaHigh !== null && betaHigh < 1) regime = "infant mortality";
  else if (betaLow !== null && betaHigh !== null && betaLow <= 1 && betaHigh >= 1) regime = "constant hazard";
  else regime = "not resolved";

  // Plotting positions. The FIT above used none of this - the points are drawn
  // so the reader can judge whether a Weibull was the right shape at all.
  //
  // Ranks are Johnson-adjusted for the censored units, which is exact integer-
  // and-fraction arithmetic with no fitted constant, and F = A/(n+1) is the
  // MEAN plotting position, which is a theorem: the i-th of n order statistics
  // has E[F] = i/(n+1) exactly. Median ranks would need Bernard's approximation
  // and this module does not need it.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a] - times[b]);
  const points: { x: number; y: number }[] = [];
  let prevAdj = 0;
  for (let j = 0; j < n; j++) {
    const idx = order[j];
    if (events[idx] !== 1) continue;
    const increment = (n + 1 - prevAdj) / (n + 2 - (j + 1));
    const adj = prevAdj + increment;
    prevAdj = adj;
    const F = adj / (n + 1);
    if (!(F > 0 && F < 1)) continue;
    const y = Math.log(-Math.log(1 - F));
    if (finite(y)) points.push({ x: logs[idx], y });
  }

  const xs = points.map((p) => p.x);
  const xLo = xs.length ? minOf(xs) : logEta - 1;
  const xHi = xs.length ? maxOf(xs) : logEta + 1;
  const line = (x: number): number => beta * (x - logEta);
  const fitLine = [
    { x: xLo, y: line(xLo) },
    { x: xHi, y: line(xHi) },
  ].filter((p) => finite(p.x) && finite(p.y));

  const notes: string[] = [];
  notes.push(
    `eta is the 63.2 % life, not the average one: ${pct(1 - Math.exp(-1))} of the population has failed by ` +
      `${sig(eta, 4)} h whatever the shape parameter is.`,
  );
  if (regime === "wear-out") {
    notes.push(
      "The hazard rate RISES with age, so these parts wear out. Replacing them on a schedule before " +
        "that age buys something. Note that this is the one case where scheduled replacement helps at all.",
    );
  } else if (regime === "infant mortality") {
    notes.push(
      "The hazard rate FALLS with age, so the survivors are the good ones - this is infant mortality. " +
        "Burn-in helps and scheduled replacement actively hurts, because it swaps a proven part for a fresh one.",
    );
  } else if (regime === "constant hazard") {
    notes.push(
      "The interval on beta straddles 1, so the data is consistent with a constant hazard: an old part " +
        "is no more likely to fail in the next hour than a new one. Replacing on age achieves nothing here, " +
        "and this is the only case where quoting a single failure rate 1/eta is defensible.",
    );
  } else {
    notes.push(
      "The interval on beta could not be resolved from this data, so no statement about infant mortality " +
        "or wear-out is supported. That is a statement about the sample size, not about the parts.",
    );
  }
  if (mttf === null) {
    notes.push(
      "The mean life overflows at this shape parameter - with beta that small the distribution has a " +
        "very heavy tail and the mean is dominated by lives longer than anything observed. The B10 and " +
        "median lives above are unaffected and are the numbers to use.",
    );
  } else if (beta < 1) {
    notes.push(
      `The mean life (${sig(mttf, 4)} h) is longer than the median (${sig(medianLife, 4)} h) because the ` +
        "tail is heavy. Half the population is gone by the median; the mean is not the typical life.",
    );
  }
  const censored = n - r;
  if (censored > 0) {
    notes.push(
      `${censored} of the ${n} units had not failed when the data ended. They are right-censored and ` +
        "carry real information - each one says the life is AT LEAST that long - so they are in the " +
        "likelihood. Discarding them would bias the fitted life short.",
    );
  }
  if (r < 10) {
    notes.push(
      `Only ${r} failures. Both parameters are being fitted from that, so treat the interval on beta as ` +
        "the honest width of the answer rather than the point estimate as the answer.",
    );
  }

  return {
    ok: true,
    beta,
    eta,
    betaLow,
    betaHigh,
    mttf,
    b10,
    medianLife,
    failures: r,
    censored,
    regime,
    points,
    fitLine,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 2. Reliability block diagram — series and parallel
// ---------------------------------------------------------------------------

export interface RbdComponent {
  name: string;
  /** Failure rate, per hour. Zero is allowed and means "assume this never fails". */
  lambda: number;
  /** How many of this component are in the system. */
  quantity: number;
}

export interface RbdInput {
  components: RbdComponent[];
  configuration: "series" | "parallel";
  /** Mission time, hours. */
  timeH: number;
}

export interface RbdResult {
  ok: true;
  configuration: "series" | "parallel";
  /** System reliability at the mission time. */
  reliability: number;
  /** System unreliability. Computed directly, so it stays accurate when R ~ 1. */
  unreliability: number;
  /** System failure rate, per hour — SERIES ONLY; a parallel system has no constant rate. */
  systemLambda: number | null;
  /** Mean time to failure, hours. Null when it cannot be computed accurately. */
  mttf: number | null;
  /** Share of the system failure rate carried by each component — series only. */
  contributions: { name: string; lambda: number; share: number }[];
  /** R against time for the figure. */
  curve: { t: number; R: number }[];
  /**
   * One component's curve, for comparison — and WHICH ONE DEPENDS ON THE CLAIM
   * BEING MADE. In series the point is that the system is worse than its worst
   * part, so the worst part is the comparison. In parallel the point is that
   * the system outlives EVERY part, and the only part that demonstrates is the
   * BEST one; drawing the worst there proves the easy half.
   */
  unitCurve: { t: number; R: number }[];
  /** What unitCurve is, so the caller can label it without guessing. */
  unitCurveLabel: string;
  totalUnits: number;
  notes: string[];
}

export type RbdOut = RbdResult | { ok: false; error: string };

/** Harmonic number, exactly summed. */
function harmonic(n: number): number {
  let s = 0;
  for (let i = 1; i <= n; i++) s += 1 / i;
  return s;
}

/** Unreliability of one unit. expm1 rather than 1 - exp, which loses every
 * significant figure when lambda*t is small - and small is the normal case. */
const unitF = (lam: number, t: number): number => -Math.expm1(-lam * t);

/**
 * System unreliability for units in parallel: the product of the individual
 * unreliabilities, accumulated in logs so a hundred branches do not underflow
 * the product to zero before the exponent is taken.
 */
function parallelF(rates: { lambda: number; quantity: number }[], t: number): number {
  let logF = 0;
  for (const c of rates) {
    const F = unitF(c.lambda, t);
    if (F <= 0) return 0; // one branch that cannot have failed yet keeps the system up
    logF += c.quantity * Math.log(F);
  }
  const F = Math.exp(logF);
  return finite(F) ? Math.min(1, Math.max(0, F)) : 0;
}

export function reliabilityBlock(inp: RbdInput): RbdOut {
  const { components, configuration, timeH } = inp;
  if (!components.length) return { ok: false, error: "Add at least one component." };
  if (components.length > 60) return { ok: false, error: "That is more than 60 component types; group them." };
  if (!finite(timeH) || timeH < 0) return { ok: false, error: "The mission time must be zero or more hours." };
  if (timeH > 1e12) return { ok: false, error: "That mission time is longer than the age of the universe in hours." };

  // The quantities are carried as MULTIPLIERS, not expanded into one entry per
  // unit. Sixty types at ten thousand each is six hundred thousand entries, and
  // every reduction over that array is a way to run out of something. A rate
  // repeated q times contributes q*lambda in series and q*ln F in parallel, so
  // there is nothing to gain by writing it out.
  const rates: { lambda: number; quantity: number }[] = [];
  let totalUnits = 0;
  let sumLambda = 0;
  for (const c of components) {
    if (!finite(c.lambda) || c.lambda < 0) {
      return { ok: false, error: `The failure rate for ${c.name || "a component"} must be zero or more per hour.` };
    }
    if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 10000) {
      return { ok: false, error: `The quantity for ${c.name || "a component"} must be a whole number from 1 to 10,000.` };
    }
    rates.push({ lambda: c.lambda, quantity: c.quantity });
    totalUnits += c.quantity;
    sumLambda += c.lambda * c.quantity;
  }
  if (!finite(sumLambda)) return { ok: false, error: "Those failure rates overflow when summed." };

  const notes: string[] = [];
  let reliability: number;
  let unreliability: number;
  let systemLambda: number | null = null;
  let mttf: number | null = null;

  if (configuration === "series") {
    // Exact and stable: ln R = -sum(lambda) * t, no product of near-one numbers.
    systemLambda = sumLambda;
    reliability = Math.exp(-sumLambda * timeH);
    unreliability = -Math.expm1(-sumLambda * timeH);
    mttf = sumLambda > 0 ? 1 / sumLambda : null;
    notes.push(
      "IN SERIES EVERY COMPONENT MUST SURVIVE, so the failure rates simply add and the system is always " +
        "less reliable than its worst part. Adding a component can only make this number worse.",
    );
    if (mttf === null) {
      notes.push("Every failure rate is zero, so the system never fails and there is no mean time to failure.");
    }
  } else {
    // Parallel: the system fails only when all units have failed.
    unreliability = parallelF(rates, timeH);
    reliability = 1 - unreliability;

    const allSame = rates.every((c) => Math.abs(c.lambda - rates[0].lambda) <= 1e-15 * Math.max(1, rates[0].lambda));
    if (allSame && rates[0].lambda > 0) {
      mttf = harmonic(totalUnits) / rates[0].lambda;
    } else if (rates.every((c) => c.lambda > 0) && totalUnits <= 12) {
      // Inclusion-exclusion over the subsets. Exact, and capped at 12 units
      // (4096 terms) because the alternating sum loses accuracy as it grows.
      const expanded: number[] = [];
      for (const c of rates) for (let i = 0; i < c.quantity; i++) expanded.push(c.lambda);
      let sum = 0;
      for (let mask = 1; mask < 1 << totalUnits; mask++) {
        let s = 0;
        let bits = 0;
        for (let i = 0; i < totalUnits; i++) {
          if (mask & (1 << i)) {
            s += expanded[i];
            bits++;
          }
        }
        sum += (bits % 2 === 1 ? 1 : -1) / s;
      }
      mttf = finite(sum) && sum > 0 ? sum : null;
    }
    notes.push(
      "IN PARALLEL ONE SURVIVOR IS ENOUGH, so the system outlives every part in it. The mean time to " +
        "failure grows only as 1 + 1/2 + 1/3 + ... though: the second unit buys you half as much as the " +
        "first, and the tenth buys a tenth.",
    );
    notes.push(
      "THIS ASSUMES THE FAILURES ARE INDEPENDENT, which is the assumption redundancy most often fails on. " +
        "A shared power supply, a shared cooling loop, a common design error or one maintenance mistake " +
        "takes out every branch at once, and against a common cause a parallel system is no better than " +
        "a single unit.",
    );
    // THE ZERO-RATE CASE IS TESTED FIRST. The other way round, a system with a
    // never-failing branch AND more than twelve units was told its mean life
    // was unreportable because "the alternating sum loses accuracy" - three
    // lines under a reliability of 100.0000 %. Both halves false together.
    if (mttf === null && rates.some((c) => c.lambda === 0)) {
      notes.push(
        "At least one branch is entered as never failing (a rate of zero), so the system never fails and " +
          "the mean time to failure is infinite. That is the arithmetic answering what was typed.",
      );
    } else if (mttf === null && totalUnits > 12 && !allSame) {
      notes.push(
        `The mean time to failure is not reported: with ${totalUnits} units of differing rates the exact ` +
          "expression is an alternating sum over every subset, and it loses more accuracy than the answer " +
          "is worth. The reliability at the mission time above is exact.",
      );
    }
  }

  if (!finite(reliability) || reliability < 0 || reliability > 1) {
    return { ok: false, error: "Those inputs put the system reliability outside 0 to 1. Check the failure rates." };
  }

  const contributions = configuration === "series" && sumLambda > 0
    ? components
        .map((c) => ({ name: c.name, lambda: c.lambda * c.quantity, share: (c.lambda * c.quantity) / sumLambda }))
        .sort((a, b) => b.lambda - a.lambda)
    : [];
  if (contributions.length > 1 && contributions[0].share > 0.5) {
    notes.push(
      `${contributions[0].name || "One component"} carries ${pct(contributions[0].share)} of the whole ` +
        "system failure rate. Improving anything else is close to wasted effort until that one moves.",
    );
  }

  // The curve. Its horizon is chosen from the arithmetic, never from a mission
  // time of zero, which would collapse the plot to a point.
  const worst = maxOf(rates.map((c) => c.lambda));
  const best = minOf(rates.map((c) => c.lambda));
  const compare = configuration === "series" ? worst : best;
  const unitCurveLabel = configuration === "series" ? "worst single unit" : "best single unit";
  const scale = worst > 0 ? 1 / worst : 1;
  const horizon = Math.min(1e12, Math.max(timeH > 0 ? timeH : 0, scale * (configuration === "parallel" ? 4 : 3)));
  const span = horizon > 0 && finite(horizon) ? horizon : 1;
  const curve: { t: number; R: number }[] = [];
  const unitCurve: { t: number; R: number }[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = (span * i) / 80;
    const R = configuration === "series" ? Math.exp(-sumLambda * t) : 1 - parallelF(rates, t);
    const Ru = Math.exp(-compare * t);
    if (finite(t) && finite(R)) curve.push({ t, R });
    if (finite(t) && finite(Ru)) unitCurve.push({ t, R: Ru });
  }

  return {
    ok: true,
    configuration,
    reliability,
    unreliability,
    systemLambda,
    mttf,
    contributions,
    curve,
    unitCurve,
    unitCurveLabel,
    totalUnits,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 3. k-out-of-n
// ---------------------------------------------------------------------------

export interface KooNInput {
  /** Units installed. */
  n: number;
  /** How many must work for the system to work. */
  k: number;
  /** Reliability of ONE unit over the mission. */
  unitReliability: number;
  /** Optional: the unit failure rate per hour and the mission time, for MTTF. */
  lambda?: number;
}

export interface KooNResult {
  ok: true;
  systemReliability: number;
  systemUnreliability: number;
  /** Mean time to failure in units of 1/lambda; multiply by 1/lambda for hours. */
  mttfFactor: number;
  mttf: number | null;
  /** How the answer moves as k varies, for the figure. */
  sweep: { k: number; R: number }[];
  /** System R against unit R at the chosen k. */
  curve: { unitR: number; R: number }[];
  notes: string[];
}

export type KooNOut = KooNResult | { ok: false; error: string };

/** ln C(n, i), via log-gamma so it does not overflow at n = 170. */
function lnChoose(n: number, i: number): number {
  return gammaln(n + 1) - gammaln(i + 1) - gammaln(n - i + 1);
}

/** P(at least k of n work), each independently working with probability p. */
function atLeastK(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p >= 1) return 1;
  if (p <= 0) return 0;
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  const terms: number[] = [];
  for (let i = k; i <= n; i++) terms.push(lnChoose(n, i) + i * lp + (n - i) * lq);
  const total = Math.exp(logSumExp(terms));
  return Math.min(1, Math.max(0, total));
}

export function kOutOfN(inp: KooNInput): KooNOut {
  const { n, k, unitReliability: p } = inp;
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    return { ok: false, error: "The number of units must be a whole number from 1 to 500." };
  }
  if (!Number.isInteger(k) || k < 1) return { ok: false, error: "The number required must be a whole number of at least 1." };
  if (k > n) return { ok: false, error: `Requiring ${k} of ${n} is impossible - you cannot need more units than you have.` };
  if (!finite(p) || p < 0 || p > 1) return { ok: false, error: "The unit reliability is a probability, so it is between 0 and 1." };

  const systemReliability = atLeastK(n, k, p);
  const systemUnreliability = 1 - systemReliability;

  // For identical exponential units the mean time to failure is a harmonic
  // tail: the system dies on the (n-k+1)-th failure.
  let mttfFactor = 0;
  for (let i = k; i <= n; i++) mttfFactor += 1 / i;
  let mttf: number | null = null;
  if (inp.lambda !== undefined) {
    if (!finite(inp.lambda) || inp.lambda < 0) return { ok: false, error: "The unit failure rate must be zero or more per hour." };
    mttf = inp.lambda > 0 ? mttfFactor / inp.lambda : null;
  }

  const sweep: { k: number; R: number }[] = [];
  for (let kk = 1; kk <= n; kk++) sweep.push({ k: kk, R: atLeastK(n, kk, p) });

  const curve: { unitR: number; R: number }[] = [];
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    curve.push({ unitR: u, R: atLeastK(n, k, u) });
  }

  const notes: string[] = [];
  notes.push(
    `EVERY UNIT IS ASSUMED IDENTICAL AND INDEPENDENT. This is a binomial sum, so it needs one reliability ` +
      "for all of them; a mixed set is a different calculation entirely and this tool will not stand in for it.",
  );
  if (k === n) {
    notes.push(
      `Requiring all ${n} is a SERIES system wearing redundant clothing - there is no redundancy here at ` +
        "all, and the system is worse than one unit alone.",
    );
  } else if (k === 1) {
    notes.push(`Requiring 1 of ${n} is FULL parallel redundancy, the most any n units can give you.`);
  }
  if (n === 1) {
    notes.push("With one unit there is nothing redundant about this; the system is the unit.");
  }
  // The gain is quoted as a RATIO OF FAILURE PROBABILITIES, because that is
  // where redundancy shows: 0.99 to 0.9999 reads as a rounding error on the
  // reliability and as a hundredfold improvement on the failure rate. It is
  // only printed when both sides are representable - at p = 0.999999999999 the
  // system unreliability underflows to zero and the ratio was printing
  // "not finitex", which is worse than saying nothing.
  if (systemReliability > p && k < n) {
    const gain = systemUnreliability > 0 ? (1 - p) / systemUnreliability : Infinity;
    if (finite(gain) && gain > 1) {
      notes.push(
        `The redundancy is worth ${sig(gain, 4)}x on the failure probability - that ratio, not the ` +
          "reliability itself, is where the improvement shows.",
      );
    } else {
      notes.push(
        "The system failure probability is below what a double can represent, so no ratio is quoted. " +
          "Read that as 'the arithmetic ran out', not as 'this system cannot fail' - at this level the " +
          "common-cause failures below dominate completely and the binomial is no longer the real answer.",
      );
    }
  }
  if (mttf === null && inp.lambda !== undefined) {
    notes.push("With a zero failure rate the units never fail, so there is no mean time to failure.");
  }
  notes.push(
    "A COMMON CAUSE DEFEATS THIS. The independence assumption is doing all the work above, and shared " +
      "power, shared cooling, a common design fault or one wrong maintenance action ignores how many " +
      "units you installed.",
  );

  return { ok: true, systemReliability, systemUnreliability, mttfFactor, mttf, sweep, curve, notes };
}

// ---------------------------------------------------------------------------
// 4. Active versus standby redundancy
// ---------------------------------------------------------------------------

export interface RedundancyInput {
  /** Failure rate of one unit, per hour. */
  lambda: number;
  /** Units in total, including the one carrying the load. */
  n: number;
  /** Mission time, hours. */
  timeH: number;
}

export interface RedundancyResult {
  ok: true;
  singleR: number;
  activeR: number;
  standbyR: number;
  singleMttf: number | null;
  activeMttf: number | null;
  standbyMttf: number | null;
  /** MTTF against number of units, both schemes, for the figure. */
  activeSweep: { n: number; mttf: number }[];
  standbySweep: { n: number; mttf: number }[];
  notes: string[];
}

export type RedundancyOut = RedundancyResult | { ok: false; error: string };

/**
 * R(t) for n units in cold standby with a perfect switch:
 * exp(-x) * sum(x^i / i!) for i < n, computed in logs so a long mission does
 * not overflow the Poisson terms.
 */
function standbyReliability(x: number, n: number): number {
  if (x <= 0) return 1;
  const lx = Math.log(x);
  const terms: number[] = [];
  for (let i = 0; i < n; i++) terms.push(i * lx - gammaln(i + 1));
  const total = Math.exp(-x + logSumExp(terms));
  return Math.min(1, Math.max(0, total));
}

/**
 * The UNRELIABILITY of the same standby system, summed from the tail rather
 * than found by subtracting the reliability from one.
 *
 * On a short mission the reliability is 1 to double precision and 1 - R is
 * exactly 0, so the note that says "compare the FAILURE probabilities, that is
 * where the difference lives" was printing "0 active, 0 standby" - the two
 * numbers whose difference it was pointing at. The true values are around
 * 1e-30, which a double holds perfectly well; only the subtraction destroyed
 * them.
 *
 * The tail is summed only where the subtraction has actually failed, which is
 * the regime x << n, where it converges in a handful of terms. The loop is
 * counted regardless.
 */
function standbyUnreliability(x: number, n: number): number {
  if (x <= 0) return 0;
  const direct = 1 - standbyReliability(x, n);
  if (direct > 1e-10) return direct;
  const lx = Math.log(x);
  const terms: number[] = [];
  for (let i = n; i < n + 400; i++) {
    const term = i * lx - gammaln(i + 1);
    terms.push(term);
    // Past the peak, and forty nats below the largest term, nothing left
    // changes the sum in double precision.
    if (i > x && term < maxOf(terms) - 40) break;
  }
  const F = Math.exp(-x + logSumExp(terms));
  return finite(F) ? Math.min(1, Math.max(0, F)) : direct;
}

export function redundancy(inp: RedundancyInput): RedundancyOut {
  const { lambda, n, timeH } = inp;
  if (!finite(lambda) || lambda < 0) return { ok: false, error: "The failure rate must be zero or more per hour." };
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    return { ok: false, error: "The number of units must be a whole number from 1 to 200." };
  }
  if (!finite(timeH) || timeH < 0) return { ok: false, error: "The mission time must be zero or more hours." };
  const x = lambda * timeH;
  if (!finite(x)) return { ok: false, error: "That failure rate and mission time overflow when multiplied." };

  const singleR = Math.exp(-x);
  const unitF = -Math.expm1(-x);
  const activeR = 1 - Math.pow(unitF, n);
  const standbyR = standbyReliability(x, n);
  const singleMttf = lambda > 0 ? 1 / lambda : null;
  const activeMttf = lambda > 0 ? harmonic(n) / lambda : null;
  const standbyMttf = lambda > 0 ? n / lambda : null;

  if (![singleR, activeR, standbyR].every((v) => finite(v) && v >= 0 && v <= 1 + 1e-12)) {
    return { ok: false, error: "Those inputs put a reliability outside 0 to 1. Check the failure rate." };
  }

  const activeSweep: { n: number; mttf: number }[] = [];
  const standbySweep: { n: number; mttf: number }[] = [];
  if (lambda > 0) {
    // AT LEAST AS FAR AS THE USER'S OWN n. The cap was 20 while n may be 200,
    // so a 200-unit answer was reported in the text and then left off the
    // figure whose caption claims to show mean life against the number of
    // units. 200 points is a perfectly drawable line.
    const top = Math.min(Math.max(n, 8), 200);
    for (let i = 1; i <= top; i++) {
      activeSweep.push({ n: i, mttf: harmonic(i) / lambda });
      standbySweep.push({ n: i, mttf: i / lambda });
    }
  }

  const notes: string[] = [];
  notes.push(
    "STANDBY BEATS ACTIVE BECAUSE OF TWO ASSUMPTIONS, NOT BECAUSE IT IS BETTER ENGINEERING. The spare " +
      "is assumed not to age while it waits, and the switch that brings it in is assumed never to fail. " +
      "Relax either one and the gap closes; a switch with its own failure rate can make standby WORSE " +
      "than active, because it puts a single point of failure in front of every spare.",
  );
  notes.push(
    `The mean life grows LINEARLY with standby units (n/lambda) and only HARMONICALLY with active ones ` +
      `(1 + 1/2 + ... + 1/n over lambda). At n = ${n} that is ${sig(n, 4)}x against ` +
      `${sig(harmonic(n), 4)}x the life of a single unit.`,
  );
  if (n === 1) {
    notes.push("With one unit there is no spare, so all three numbers are the same by construction.");
  }
  if (lambda === 0) {
    notes.push("A zero failure rate means nothing ever fails, so every scheme survives and there is no mean life.");
  }
  if (x > 0 && x < 0.01) {
    // Each failure probability is formed DIRECTLY - the unit's from expm1, the
    // active one as a power, the standby one from its own tail - because at
    // this end of the scale 1 - R is exactly zero and the sentence would be
    // pointing at two numbers it had just destroyed.
    notes.push(
      `The mission is short next to the life (lambda*t = ${sig(x, 3)}), so all three reliabilities round to ` +
        "nearly 1. Compare the FAILURE probabilities instead - that is where the difference lives: " +
        `${sig(unitF, 3)} single, ${sig(Math.pow(unitF, n), 3)} active, ${sig(standbyUnreliability(x, n), 3)} standby.`,
    );
  }

  return { ok: true, singleR, activeR, standbyR, singleMttf, activeMttf, standbyMttf, activeSweep, standbySweep, notes };
}

// ---------------------------------------------------------------------------
// 5. Availability
// ---------------------------------------------------------------------------

export interface AvailabilityInput {
  /** Mean time BETWEEN failures, hours — a repairable item. */
  mtbfH: number;
  /** Mean time to repair, hours. */
  mttrH: number;
  /** Calendar window over which to report downtime, hours. */
  windowH: number;
  /** Optional: how many of these run in series, all needed. */
  unitsInSeries?: number;
}

export interface AvailabilityResult {
  ok: true;
  /** Inherent availability, MTBF/(MTBF+MTTR). Repair time only. */
  availability: number;
  unavailability: number;
  downtimeH: number;
  uptimeH: number;
  failuresInWindow: number;
  /** System availability when several must all be up. */
  systemAvailability: number | null;
  /** Availability against repair time, for the figure. */
  curve: { mttr: number; A: number }[];
  notes: string[];
}

export type AvailabilityOut = AvailabilityResult | { ok: false; error: string };

export function availability(inp: AvailabilityInput): AvailabilityOut {
  const { mtbfH, mttrH, windowH } = inp;
  if (!finite(mtbfH) || mtbfH <= 0) return { ok: false, error: "The mean time between failures must be greater than zero hours." };
  if (!finite(mttrH) || mttrH < 0) return { ok: false, error: "The mean time to repair must be zero or more hours." };
  if (!finite(windowH) || windowH <= 0) return { ok: false, error: "The reporting window must be greater than zero hours." };
  const denom = mtbfH + mttrH;
  if (!finite(denom) || denom <= 0) return { ok: false, error: "Those two times overflow when added." };

  const availabilityValue = mtbfH / denom;
  const unavailability = mttrH / denom;
  const downtimeH = unavailability * windowH;
  const uptimeH = windowH - downtimeH;
  const failuresInWindow = windowH / denom;

  const units = inp.unitsInSeries;
  let systemAvailability: number | null = null;
  if (units !== undefined) {
    if (!Number.isInteger(units) || units < 1 || units > 10000) {
      return { ok: false, error: "The number in series must be a whole number from 1 to 10,000." };
    }
    systemAvailability = Math.pow(availabilityValue, units);
  }

  const curve: { mttr: number; A: number }[] = [];
  const top = Math.max(mttrH * 2, mtbfH * 0.05);
  if (finite(top) && top > 0) {
    for (let i = 0; i <= 60; i++) {
      const m = (top * i) / 60;
      curve.push({ mttr: m, A: mtbfH / (mtbfH + m) });
    }
  }

  const notes: string[] = [];
  notes.push(
    "THIS IS INHERENT AVAILABILITY - it counts the repair itself and nothing else. Waiting for a spare, " +
      "waiting for a technician, waiting for a maintenance window and waiting for permission are all real " +
      "downtime and none of them are in this number. Operational availability is always the lower figure, " +
      "and it is usually the one being asked about.",
  );
  notes.push(
    "MTBF here means time BETWEEN failures on a repairable item, which is not the same as time TO failure " +
      "on one that gets thrown away. Only the repairable reading belongs in an availability calculation.",
  );
  if (mttrH === 0) {
    notes.push(
      "A repair that takes no time gives an availability of exactly 1 by construction. That is the " +
        "arithmetic answering the question you asked, not a property of the equipment.",
    );
  }
  if (systemAvailability !== null && units !== undefined && units > 1) {
    notes.push(
      `AVAILABILITY MULTIPLIES DOWN A SERIES. ${units} of these, all needed, gives ` +
        `${(systemAvailability * 100).toFixed(4)} % - so ${sig((1 - systemAvailability) * windowH, 4)} h down ` +
        `in the same window against ${sig(downtimeH, 4)} h for one. Long chains of highly available parts ` +
        "are not highly available.",
    );
  }
  const nines = availabilityValue < 1 ? -Math.log10(1 - availabilityValue) : Infinity;
  if (finite(nines) && nines >= 1) {
    notes.push(
      `That is about ${nines.toFixed(2)} nines. Each further nine costs a tenth of the downtime, which ` +
        "means a tenth of the repair time or ten times the interval between failures.",
    );
  }

  return {
    ok: true,
    availability: availabilityValue,
    unavailability,
    downtimeH,
    uptimeH,
    failuresInWindow,
    systemAvailability,
    curve,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Parsers.
//
// THESE LIVE HERE AND NOT IN THE PANE, deliberately. Nothing can import
// taskpane.ts in a test - it reaches for the Office.js Word namespace at module
// scope - so a parser written inside it is invisible to every test in the
// project, however many of them there are. That has already cost this bench
// once.
// ---------------------------------------------------------------------------

/** Only a plain decimal or scientific number. `Number()` alone also accepts
 *  "0x10" (sixteen), "0b11" and "Infinity", none of which is a life in hours. */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The duration units this table converts, and what one of them is in hours. */
const LIFE_UNITS: Record<string, number> = {
  h: 1,
  hr: 1,
  hrs: 1,
  hour: 1,
  hours: 1,
  min: 1 / 60,
  mins: 1 / 60,
  minute: 1 / 60,
  minutes: 1 / 60,
  sec: 1 / 3600,
  secs: 1 / 3600,
  second: 1 / 3600,
  seconds: 1 / 3600,
  day: 24,
  days: 24,
};

/**
 * TWO LETTERS MEAN TWO THINGS HERE, and the parser refuses rather than picks.
 *
 * "s" is both seconds and suspended; "d" is both days and dead. Before this
 * check, "412 s" was read as 412 HOURS suspended and "412 d" as 412 hours
 * failed - a factor of 3600 and 24 respectively, silently, in the one field of
 * this discipline that does not go through the shared unit layer. Both readings
 * are defensible, which is exactly why guessing is not.
 */
const AMBIGUOUS_STATUS: Record<string, string> = {
  s: 'seconds, or "suspended"',
  d: 'days, or "dead"',
};

/**
 * Reads a pasted life table: one unit per line, a time and an optional status.
 *
 * Accepts the notations people actually paste. "450" alone is a failure in
 * hours; a trailing "+" is the standard suspension mark; F/S/C/1/0 and the
 * words are all read; and a duration unit may be written on the time, so
 * "3 day" is 72 h. Anything else is REFUSED by name rather than guessed at,
 * because reading a suspension as a failure biases the fitted life short and
 * does it silently.
 */
export function parseLifeData(text: string): { times: number[]; events: number[] } | { error: string } {
  const times: number[] = [];
  const events: number[] = [];
  const lines = text.split(/[\r\n;]+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { error: "Paste one unit per line: a time, and optionally whether it failed." };
  if (lines.length > 20000) return { error: "That is more than 20,000 units. Trim the data set." };
  for (const line of lines) {
    const parts = line.split(/[\s,\t]+/).filter(Boolean);
    let raw = parts[0];
    let rest = parts.slice(1);
    // A trailing "+" is the conventional suspension mark and binds to the number.
    let markedSuspended = false;
    if (raw.endsWith("+")) {
      raw = raw.slice(0, -1);
      markedSuspended = true;
    }
    // A unit may be written against the number, with or without a space:
    // "3day", "3 day". Peel it off before the number is read.
    let scale = 1;
    const glued = /^([+-]?[\d.eE+-]*?)([a-zA-Z]+)$/.exec(raw);
    if (glued && NUMERIC.test(glued[1]) && glued[2].toLowerCase() in LIFE_UNITS) {
      scale = LIFE_UNITS[glued[2].toLowerCase()];
      raw = glued[1];
    } else if (rest.length && rest[0].toLowerCase() in LIFE_UNITS) {
      scale = LIFE_UNITS[rest[0].toLowerCase()];
      rest = rest.slice(1);
    } else if (rest.length && rest[0].toLowerCase() in AMBIGUOUS_STATUS) {
      const tok = rest[0].toLowerCase();
      return {
        error:
          `"${rest[0]}" on the line "${line}" is ambiguous - it means ${AMBIGUOUS_STATUS[tok]}. ` +
          `Write the unit in full ("${tok === "s" ? "sec" : "day"}") or mark the status another way ` +
          `("F" for failed, "+" for still running).`,
      };
    }
    const status = rest.length ? rest.join(" ").toLowerCase() : markedSuspended ? "0" : "";

    if (!NUMERIC.test(raw)) {
      return { error: `"${parts[0]}" on the line "${line}" is not a number of hours.` };
    }
    const t = Number(raw) * scale;
    if (!finite(t)) return { error: `"${parts[0]}" on the line "${line}" is not a usable life.` };
    if (t <= 0) return { error: `A life of ${t} h is not usable - every time must be greater than zero.` };
    let e: number;
    if (!status) e = 1;
    else if (/^(1|f|fail|failed|failure|dead)$/.test(status)) e = 1;
    // "+" is here as well as on the number, because "900 +" with a space is at
    // least as common as "900+", and refusing it while the error message tells
    // the reader to use a trailing + is a parser arguing with itself.
    else if (/^(0|c|\+|susp|suspended|censor|censored|running|survived|ok)$/.test(status)) e = 0;
    else if (status in AMBIGUOUS_STATUS) {
      return {
        error:
          `"${status}" on the line "${line}" is ambiguous - it means ${AMBIGUOUS_STATUS[status]}. ` +
          `Write the unit in full or mark the status another way ("F" for failed, "+" for still running).`,
      };
    } else {
      return {
        error:
          `"${status}" on the line "${line}" is not a status this reads. Use 1 or F for a failure, ` +
          "0 or + for a unit still running, or write a duration unit (h, min, sec, day) on the time.",
      };
    }
    if (markedSuspended && e === 1) {
      return { error: `The line "${line}" is marked both suspended (+) and failed. It cannot be both.` };
    }
    times.push(t);
    events.push(e);
  }
  return { times, events };
}

/**
 * Reads a pasted component list: name, failure rate per hour, and an optional
 * quantity. "Pump, 1.2e-4, 2" or "Pump 1.2e-4 2".
 */
export function parseComponentList(text: string): RbdComponent[] | { error: string } {
  const out: RbdComponent[] = [];
  const lines = text.split(/[\r\n;]+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { error: "List one component per line: a name, a failure rate per hour, and a quantity." };
  if (lines.length > 60) return { error: "That is more than 60 component types. Group them before listing." };
  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((s) => s.trim()).filter(Boolean);
    let fields = parts;
    // MORE THAN THREE COMMA-SEPARATED FIELDS IS A THOUSANDS SEPARATOR, and
    // guessing which comma was which is how "Motor, 1,200, 2" became a
    // component called "Motor 1" failing 200 times an hour. Both readings are
    // possible from the text, so the parser says so instead of choosing.
    if (parts.length > 3) {
      return {
        error:
          `"${line}" has ${parts.length} comma-separated fields where three are expected (name, rate, ` +
          "quantity). If that is a thousands separator, remove it - 1,200 must be written 1200.",
      };
    }
    // COMMAS FIX THE FIELDS POSITIONALLY. Where the writer separated the fields
    // themselves there is nothing to infer, so name/rate/quantity are read in
    // order and a bad rate is REFUSED. Guessing from the right here let
    // "Pump, 0x10, 2" become a component called "Pump 0x10" failing twice an
    // hour, which is the thousands-separator defect wearing a different hat.
    const commaDelimited = fields.length >= 2;
    if (!commaDelimited) fields = line.split(/\s+/).filter(Boolean);
    if (fields.length < 2) {
      return { error: `"${line}" needs at least a name and a failure rate per hour.` };
    }
    let qtyRaw: string;
    let rateRaw: string;
    let name: string;
    if (commaDelimited) {
      name = fields[0];
      rateRaw = fields[1];
      qtyRaw = fields.length >= 3 ? fields[2] : "1";
    } else {
      // Space-separated, so the boundary must be inferred. Take a trailing
      // field as the quantity only when it is a whole number AND something
      // numeric precedes it — otherwise "Bearing 6205 1.5e-5", a part number in
      // the name, was refused with "1.5e-5 is not a whole quantity", which
      // sends the reader to correct the one field that was right.
      const last = fields[fields.length - 1];
      const prev = fields.length >= 3 ? fields[fields.length - 2] : "";
      const quantityTrails = fields.length >= 3 && NUMERIC.test(last) && Number.isInteger(Number(last)) && NUMERIC.test(prev);
      qtyRaw = quantityTrails ? last : "1";
      rateRaw = quantityTrails ? prev : last;
      name = fields.slice(0, fields.length - (quantityTrails ? 2 : 1)).join(" ");
    }
    if (!NUMERIC.test(rateRaw)) {
      return { error: `"${rateRaw}" on the line "${line}" is not a failure rate per hour.` };
    }
    const lambda = Number(rateRaw);
    const quantity = Number(qtyRaw);
    if (!finite(lambda)) return { error: `"${rateRaw}" on the line "${line}" is not a failure rate per hour.` };
    if (lambda < 0) return { error: `A negative failure rate on "${line}" is not a rate.` };
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: `"${qtyRaw}" on the line "${line}" is not a whole quantity of one or more.` };
    }
    out.push({ name: name || "component", lambda, quantity });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Significant figures without an exponent surprise, for note text. */
function sig(x: number, digits: number): string {
  if (!finite(x)) return "not finite";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e-4 && a < 1e7) {
    const dp = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
    return Number(x.toFixed(Math.min(20, dp))).toString();
  }
  return x.toExponential(digits - 1);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)} %`;
}
