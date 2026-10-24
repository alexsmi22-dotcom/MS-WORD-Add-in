// Limits and Taylor series — the CAS brief's "later" list.
//
// LIMITS. Direct substitution first; where that gives 0/0 or ∞/∞, L'Hôpital,
// differentiating top and bottom until the indeterminacy clears. Limits at ±∞
// are handled by the substitution x = 1/t with t → 0 from the right, which
// turns every question about infinity into one the same machinery can answer.
//
// EVERY SYMBOLIC ANSWER IS CROSS-CHECKED NUMERICALLY, by evaluating the
// original expression at a sequence of points approaching the target from the
// correct side. If the two disagree the answer is WITHDRAWN rather than
// reported — the same discipline as the integrator differentiating its
// antiderivatives back. A limit that cannot be established is said to be
// undetermined, which is a real answer; guessing one is not.
//
// TAYLOR SERIES are repeated differentiation with exact coefficients f⁽ᵏ⁾(a)/k!
// through the CAS, so the Maclaurin series of eˣ comes back with 1, 1, 1/2,
// 1/6, 1/24 rather than decimals. A truncated series is always stated as
// truncated: the remainder is real and is not silently dropped.

import { parseExpr, evalAst, format, simplify, derivative, Expr } from "./solve";
import { casSimplify, CasBail, exprEqual } from "./cas";
import { minOf, maxOf } from "./minmax";
import { radiusOfFunction, RadiusResult } from "./radius";

const N = (v: number): Expr => ({ t: "num", v });
const V = (name: string): Expr => ({ t: "var", name });

function simp(e: Expr): Expr {
  try {
    return casSimplify(e);
  } catch (err) {
    if (err instanceof CasBail) return simplify(e);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type LimitPoint = number | "inf" | "-inf";
export type Side = "both" | "+" | "-";

export interface LimitResult {
  expression: string;
  variable: string;
  point: LimitPoint;
  side: Side;
  /** The value, when one was established. */
  value?: number;
  /** Exact form when the CAS could produce one. */
  exact?: string;
  /**
   * How many significant figures of `value` the numeric evidence actually supports.
   *
   * Set ONLY on the numeric-fallback branch, where the answer is the last sample of
   * a probe that was accepted because its tail agreed to within a tolerance — not a
   * derivation. `value` is already rounded to this many figures, so a caller that
   * ignores this field still prints a right answer; the field is here so a caller
   * can say how precise it is. Absent means "not tolerance-limited": direct
   * substitution and L'Hôpital produce the value exactly.
   */
  significantDigits?: number;
  kind: "finite" | "infinite" | "does-not-exist" | "undetermined";
  steps: string[];
  caveats: string[];
}

const MAX_LHOPITAL = 8;

/** Evaluates at a point, returning NaN rather than throwing. */
function at(e: Expr, x: string, v: number): number {
  try {
    const r = evalAst(e, { [x]: v });
    return Number.isFinite(r) ? r : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Numeric probe: values of `e` approaching `p` from the requested side.
 * This is what every symbolic answer is checked against.
 */
function probe(e: Expr, x: string, p: LimitPoint, side: Side): number[] {
  const out: number[] = [];
  // Deep enough that slowly-decaying limits like ln(x)/x settle: at x = 1e7 it
  // is still 1.6e-6 and falling, which a shallow probe reads as "not settled".
  const far = [10, 1e2, 1e3, 1e4, 1e6, 1e8, 1e10, 1e12];
  const near = [1e-1, 1e-2, 1e-3, 1e-4, 1e-6, 1e-8, 1e-10, 1e-12];
  if (p === "inf") {
    for (const s of far) out.push(at(e, x, s));
  } else if (p === "-inf") {
    for (const s of far) out.push(at(e, x, -s));
  } else {
    for (const d of near) {
      // "both" is asked of the CALLER via twoSided(); here it samples from
      // above, and sampling ONLY from above is exactly how abs(x)/x came back
      // as 1 instead of a limit that does not exist.
      if (side === "-") out.push(at(e, x, p - d));
      else out.push(at(e, x, p + d));
    }
  }
  return out.filter((v) => !Number.isNaN(v));
}

/**
 * The convergence tolerance the numeric branch accepts a tail under, and the way
 * it is written for the user. `String(1e-4)` is "0.0001", which reads as a
 * different, tighter number than the one in the code — so the text is spelled out
 * rather than interpolated.
 */
const SETTLE_TOL = 1e-4;
const SETTLE_TOL_TEXT = "1e-4";

/** Never claim more than this, whatever the samples happen to agree to. */
const MAX_DIGITS = 12;

/**
 * How many significant figures an uncertain value can be printed to.
 *
 * NOT "how small is the error" — how many digits are DETERMINED. A value v known
 * only to ±u may round two different ways at a given precision, and then the last
 * digit printed is a coin toss rather than information. So the largest d for which
 * v−u and v+u round to the SAME d-figure number is the answer, which is a fact
 * about the interval rather than a rule of thumb.
 *
 * Worked on the shipped defect: limit (1+1/x)^x as x→∞ settled at 2.7185234960 with
 * a tail spread of 2.43e-4. At four figures the interval [2.71828, 2.71877] rounds
 * to 2.718 at one end and 2.719 at the other — undetermined, and 2.719 is exactly
 * the wrong digit the product printed. At three, both ends give 2.72, which is what
 * e is to three figures. Rounding-error arithmetic ("u is under half an ulp, so
 * four figures are fine") gets this WRONG; only asking whether the digits are
 * determined gets it right.
 */
function justifiedDigits(value: number, uncertainty: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(uncertainty) || uncertainty <= 0) return MAX_DIGITS;
  const lo = value - uncertainty;
  const hi = value + uncertainty;
  for (let d = MAX_DIGITS; d >= 1; d--) {
    if (Number(lo.toPrecision(d)) === Number(hi.toPrecision(d))) return d;
  }
  // ZERO IS A REAL ANSWER HERE, AND FLOORING AT 1 WAS A LIE.
  //
  // Falling through means not even the FIRST figure is determined — the samples do
  // not agree on the magnitude, and where the band straddles zero they do not agree
  // on the sign. Returning 1 made the caller print a number and a caveat claiming
  // it "supports 1 significant figure". Measured: limit tan(x)*1e-6 as x → ∞ came
  // back as -8e-7 with that claim attached, for a limit that does not exist.
  return 0;
}

/** Does a probe sequence settle on a value? */
function settles(vals: number[]): { value: number; spread?: number } | { diverges: 1 | -1 } | null {
  if (vals.length < 3) return null;
  const tail = vals.slice(-4);
  const last = tail[tail.length - 1];
  if (!Number.isFinite(last)) return null;
  // Growth, not an absolute cliff: 1/x at x = 1e-7 is only 1e7, which a
  // 1e12 threshold reads as "not diverging" when it plainly is.
  const growing = tail.every((v, i) => i === 0 || Math.abs(v) > Math.abs(tail[i - 1]) * 1.5);
  if (Math.abs(last) > 1e5 && growing) return { diverges: last > 0 ? 1 : -1 };
  // A tail that is shrinking toward zero has limit ZERO. Reporting the last
  // sampled value instead — ln(x)/x came back as 2.76e-11 — presents a sampling
  // artefact as though it were the answer.
  const shrinking = tail.every((v, i) => i === 0 || Math.abs(v) < Math.abs(tail[i - 1]));
  if (shrinking && Math.abs(last) < 1e-9) return { value: 0 };
  const spread = maxOf(tail) - minOf(tail);

  // OSCILLATION IS SCALE-FREE, AND SO THIS TEST MUST BE.
  //
  // The convergence test was `spread <= 1e-4 * (1 + |last|)`. That `1 +` is an
  // absolute floor bolted onto a relative tolerance, and the floor is what does the
  // damage: any tail whose values are all smaller than about 1e-4 passes it no
  // matter how wildly it swings. So multiplying an expression by a positive
  // constant changed whether it had a limit at all:
  //
  //     limit sin(1/x)      as x -> 0   ->  undetermined   (correct)
  //     limit 1e-3*sin(1/x) as x -> 0   ->  undetermined   (correct)
  //     limit 1e-5*sin(1/x) as x -> 0   ->  -6.11e-6       WRONG
  //     limit 1e-9*sin(1/x) as x -> 0   ->  -6.11e-10      WRONG
  //
  // A constant factor cannot create or destroy a limit. The band between 1e-3 and
  // 1e-5 is why no test found this: inputs on either side behave differently and
  // sampling either side certifies the bug.
  //
  // So the tail's spread is judged against the tail's OWN magnitude, which is
  // invariant under scaling. That leaves one genuine case to separate: a tail that
  // oscillates with a DECAYING envelope really does converge to zero — x*sin(1/x)
  // is the standard example — while one with a steady envelope has no limit. The
  // discriminator is the envelope trend, comparing the first half of the tail with
  // the second, and it is scale-free for the same reason.
  // A SIGN CHANGE IS WHAT MAKES IT AN OSCILLATION.
  //
  // Requiring one is not decoration — without it this branch fired on tails ruined
  // by CANCELLATION rather than by oscillation, and broke a correct answer.
  // (1-cos(x))/x^2 tends to 1/2, but for x below about 1e-8 the double nearest
  // cos(x) is exactly 1, so 1-cos(x) evaluates to 0 and the sampled tail reads
  // [0.5, 0.5, 0, 0]. That looks exactly like a decaying envelope and the limit came
  // back as 0. The tail never changes sign, so it was never an oscillation.
  const signChanges = tail.filter(
    (v, i) => i > 0 && v !== 0 && tail[i - 1] !== 0 && v > 0 !== tail[i - 1] > 0,
  ).length;
  const amp = maxOf(tail.map(Math.abs));
  if (signChanges > 0 && amp > 0 && spread > 0.01 * amp) {
    const half = Math.floor(tail.length / 2);
    const early = maxOf(tail.slice(0, half).map(Math.abs));
    const late = maxOf(tail.slice(half).map(Math.abs));
    if (early > 0 && late < 0.1 * early) return { value: 0 };
    return null; // oscillating with a steady envelope: no limit
  }

  // THE TOLERANCE THIS PASSES UNDER IS PART OF THE ANSWER.
  //
  // Accepting here says "the last four samples agree to about 1e-4"; it does not
  // say the last sample IS the limit. The caller used to print it to eight
  // significant figures anyway, so limit (1+1/x)^x as x→∞ read 2.7185235 against
  // e = 2.7182818 — wrong from the fifth figure, shown with eight, and a student
  // checking the textbook could not tell which was wrong. The observed spread of
  // the tail travels with the value so the caller can round to what it supports.
  if (spread <= SETTLE_TOL * (1 + Math.abs(last))) return { value: last, spread };
  // A tail marching steadily toward zero IS a limit of zero, even if the last
  // few values are still spread out on an absolute scale.
  if (tail.every((v, i) => i === 0 || Math.abs(v) < Math.abs(tail[i - 1]))) {
    if (Math.abs(last) < 1e-6) return { value: 0 };
  }
  return null;
}

/** Splits a quotient into numerator and denominator, if it is one. */
function asQuotient(e: Expr): { num: Expr; den: Expr } | null {
  return e.t === "div" ? { num: e.l, den: e.r } : null;
}

const isZeroAt = (e: Expr, x: string, p: number): boolean => Math.abs(at(e, x, p)) < 1e-9;

/**
 * Do the values of `e` at MODERATE distances from the point (0.2 down to 0.0125, where a cancelling difference such as
 * cos(x) − 1 + x²/2 still has most of its digits) close in on `v`? Every step must shrink the error by at least a
 * fifth, and a Richardson extrapolation of the two closest samples (error ∝ h) must land within 1e-4 of `v`, on every
 * side asked for. A wrong v, a jump or an oscillation fails one of the two.
 */
function approachesModerately(e: Expr, x: string, p: number, side: Side, v: number): boolean {
  const hs = [0.2, 0.1, 0.05, 0.025, 0.0125];
  const sides: Array<"-" | "+"> = side === "both" ? ["-", "+"] : [side];
  for (const s of sides) {
    const f = hs.map((h) => at(e, x, s === "-" ? p - h : p + h));
    if (f.some((y) => Number.isNaN(y))) return false;
    const err = f.map((y) => Math.abs(y - v));
    const floor = 1e-12 * (1 + Math.abs(v));
    for (let i = 1; i < err.length; i++) if (!(err[i] <= 0.8 * err[i - 1] || err[i] <= floor)) return false;
    const n = f.length;
    if (Math.abs(2 * f[n - 1] - f[n - 2] - v) > 1e-4 * (1 + Math.abs(v))) return false;
  }
  return true;
}

/**
 * The limit of `input` as `variable` → `point`.
 * Returns "undetermined" rather than a guess when it cannot establish one.
 */
export function limit(input: string, variable = "x", point: LimitPoint = 0, side: Side = "both"): LimitResult | null {
  let e: Expr;
  try {
    e = simp(parseExpr(input));
  } catch {
    return null;
  }
  const steps: string[] = [];
  const caveats: string[] = [];

  // The simplifier folds constants, so an expression that is not real-valued
  // collapses to a bare NaN or Infinity before anything else runs. Carrying
  // that forward produced working that read "Limit of NaN as x → 0" for an
  // input of sqrt(-1) — honest about having no answer, but it showed the user a
  // folded artefact instead of what they typed, and never said WHY. Name the
  // reason and echo the original.
  const folded = format(e);
  if (/NaN|Infinity/.test(folded)) {
    const why = folded.includes("NaN")
      ? "That expression is not defined over the real numbers — it evaluates to NaN before the limit is even taken (sqrt of a negative, or the log of a non-positive, are the usual causes)."
      : "That expression overflows to infinity as a CONSTANT, before the limit is taken — a literal too large for double precision, or a log of zero. It is not a function of " + variable + ".";
    return {
      expression: input.trim(),
      variable, point, side,
      steps: [`Read as: ${input.trim()}`],
      caveats: [why],
      kind: "undetermined",
    };
  }

  const base: Omit<LimitResult, "kind"> = {
    expression: folded, variable, point, side, steps, caveats,
  };
  const pretty = point === "inf" ? "∞" : point === "-inf" ? "−∞" : String(point);
  steps.push(`Limit of ${format(e)} as ${variable} → ${pretty}${side !== "both" && typeof point === "number" ? (side === "+" ? " from above" : " from below") : ""}.`);

  // A limit at infinity becomes a one-sided limit at 0 under x = 1/t.
  let work = e;
  let wvar = variable;
  let wpoint: number = typeof point === "number" ? point : 0;
  let wside: Side = side;
  // The substitution variable is internal ("_t", which no typed name can collide with); the working shows it as t
  // (or u when the expression already uses t).
  const tName = /(^|[^A-Za-z_])t([^A-Za-z0-9_(]|$)/.test(format(e)) ? "u" : "t";
  const disp = (s: string): string => s.replace(/_t\b/g, tName);
  if (point === "inf" || point === "-inf") {
    const t = "_t";
    const sub = point === "inf" ? { t: "div" as const, l: N(1), r: V(t) } : { t: "neg" as const, e: { t: "div" as const, l: N(1), r: V(t) } };
    work = simp(substitute(e, variable, sub));
    wvar = t;
    wpoint = 0;
    wside = "+";
    steps.push(`Substituting ${variable} = ${point === "inf" ? `1/${tName}` : `−1/${tName}`} turns this into a limit as ${tName} → 0 from above.`);
  }

  // A TWO-SIDED limit requires both sides to agree, and this has to be checked
  // BEFORE any answer is produced rather than inside one branch. abs(x)/x is
  // the case that proves it: the two-sided limit does not exist (−1 from below,
  // +1 from above), but the indeterminate 0/0 at the origin sent it down the
  // L'Hôpital path, and the fallback probe sampled only from above and
  // confidently reported 1.
  if (side === "both" && typeof point === "number") {
    const lo = settles(probe(e, variable, point, "-"));
    const hi = settles(probe(e, variable, point, "+"));
    const val = (s: typeof lo): number | null => (s && "value" in s ? s.value : null);
    const div = (s: typeof lo): number | null => (s && "diverges" in s ? s.diverges : null);
    const a = val(lo), b = val(hi);
    if (a !== null && b !== null && Math.abs(a - b) > 1e-4 * (1 + Math.abs(b))) {
      steps.push(`Approaching from below gives ${trim(a)}; from above, ${trim(b)}.`);
      caveats.push(
        "The one-sided limits DIFFER, so the two-sided limit DOES NOT EXIST. Each one-sided limit does exist — ask for them separately with 0- or 0+."
      );
      return { ...base, kind: "does-not-exist" };
    }
    const da = div(lo), db = div(hi);
    if (da !== null && db !== null && da !== db) {
      steps.push(`The function diverges to ${da > 0 ? "+∞" : "−∞"} from below and ${db > 0 ? "+∞" : "−∞"} from above.`);
      caveats.push("The function diverges in OPPOSITE directions on the two sides, so the two-sided limit does not exist.");
      return { ...base, kind: "does-not-exist" };
    }
    if ((a !== null && db !== null) || (b !== null && da !== null)) {
      caveats.push("One side approaches a finite value while the other diverges, so the two-sided limit does not exist.");
      return { ...base, kind: "does-not-exist" };
    }
  }

  // Direct substitution.
  const direct = at(work, wvar, wpoint);
  const numeric = probe(e, variable, point, side);
  const settled = settles(numeric);

  if (Number.isFinite(direct) && !isIndeterminate(work, wvar, wpoint)) {
    // Confirm against the probe before believing it.
    if (settled && "value" in settled && Math.abs(settled.value - direct) > 1e-3 * (1 + Math.abs(direct))) {
      caveats.push("Direct substitution and a numeric approach disagree, so no value is reported. The function may be discontinuous here.");
      return { ...base, kind: "undetermined" };
    }
    steps.push(`Direct substitution gives ${trim(direct)}.`);
    const exact = exactValue(work, wvar, wpoint);
    // A two-sided limit needs BOTH sides to agree.
    if (side === "both" && typeof point === "number") {
      const l = settles(probe(e, variable, point, "-"));
      const r = settles(probe(e, variable, point, "+"));
      if (l && r && "value" in l && "value" in r && Math.abs(l.value - r.value) > 1e-4 * (1 + Math.abs(r.value))) {
        steps.push(`Approaching from below gives ${trim(l.value)} and from above ${trim(r.value)}.`);
        caveats.push("The one-sided limits DIFFER, so the two-sided limit does not exist. Each one-sided limit does.");
        return { ...base, kind: "does-not-exist" };
      }
    }
    return { ...base, kind: "finite", value: direct, exact, steps };
  }

  // Indeterminate: try L'Hôpital.
  const q = asQuotient(work);
  if (q && isIndeterminate(work, wvar, wpoint)) {
    let num = q.num, den = q.den;
    // Every stage an EXACT 0/0 (both sides evaluate to 0 itself, not merely below 1e-9) or ∞/∞.
    let exactStages = true;
    for (let i = 0; i < MAX_LHOPITAL; i++) {
      const n0 = at(num, wvar, wpoint), d0 = at(den, wvar, wpoint);
      const zeroOverZero = Math.abs(n0) < 1e-9 && Math.abs(d0) < 1e-9;
      const infOverInf = !Number.isFinite(n0) && !Number.isFinite(d0);
      if (!zeroOverZero && !infOverInf) break;
      if (zeroOverZero && (n0 !== 0 || d0 !== 0)) exactStages = false;
      num = simp(derivative(num, wvar));
      den = simp(derivative(den, wvar));
      steps.push(disp(`Indeterminate, so by L'Hôpital differentiate top and bottom: (${format(num)}) / (${format(den)}).`));
      const v = at({ t: "div", l: num, r: den }, wvar, wpoint);
      if (Number.isFinite(v)) {
        // Cross-check against the ORIGINAL expression before believing it. Close to the point a difference such as
        // e^x − 1 − x cancels to rounding noise, so the close-in probe can disagree with a correct answer
        // ((e^x − 1 − x)/x² → 1/2 was refused). When every stage was an exact 0/0, the samples taken BEFORE
        // cancellation sets in decide instead: they must close in on v steadily and extrapolate to it.
        if (
          settled && "value" in settled && Math.abs(settled.value - v) > 1e-3 * (1 + Math.abs(v)) &&
          !(exactStages && approachesModerately(work, wvar, wpoint, wside, v))
        ) {
          caveats.push("L'Hôpital's rule and a numeric approach disagree, so no value is reported.");
          return { ...base, kind: "undetermined" };
        }
        // A stage that was only NEARLY 0/0 (a top of 1e-10, not 0) is not an indeterminate form at all, and with no
        // settled numeric check there is nothing to confirm the rule's answer: (x + 1e-10)/x at 0 came back as 1.
        if (!exactStages && !(settled && "value" in settled)) {
          caveats.push("The expression is only nearly 0/0 at the point and its values near it do not settle, so L'Hôpital's rule does not apply and no value is reported.");
          return { ...base, kind: "undetermined" };
        }
        steps.push(`After ${i + 1} application${i === 0 ? "" : "s"}, the value is ${trim(v)}.`);
        caveats.push("Verified against the original expression evaluated near the limit point.");
        return { ...base, kind: "finite", value: v, exact: exactValue({ t: "div", l: num, r: den }, wvar, wpoint), steps };
      }
    }
  }

  // Fall back to what the numbers say, and be explicit that it is numeric —
  // including about HOW numeric. The existing caveat speaks to provenance
  // ("evidence, not a derivation"); the digits are a separate promise, and this is
  // the only branch where the value is a sampled number rather than a computed one.
  if (settled && "value" in settled) {
    const digits = justifiedDigits(settled.value, settled.spread ?? 0);
    // Not one figure is determined, so there is no value to report. The samples
    // were accepted by a tolerance with an absolute floor in it — `spread <= 1e-4 *
    // (1 + |last|)` — which any tail below about 1e-4 passes however wildly it
    // swings, so this branch is reachable with samples that do not even agree on
    // the sign. Reporting the last of them, to any precision, is a guess.
    if (digits === 0) {
      caveats.push(
        "The values sampled near the point do not agree even to one significant figure, so no limit is reported. Approaching from closer in does not settle them."
      );
      return { ...base, kind: "undetermined", caveats };
    }
    const rounded = digits >= MAX_DIGITS ? settled.value : Number(settled.value.toPrecision(digits));
    steps.push(`No symbolic rule applied; the value is approached numerically.`);
    caveats.push(
      "NUMERIC ONLY: this value comes from evaluating the expression closer and closer to the point, not from a proof. It is evidence, not a derivation."
    );
    if (digits < MAX_DIGITS) {
      caveats.push(
        `PRECISION: the samples were accepted as converged at a relative tolerance of ${SETTLE_TOL_TEXT}, which supports ${digits} significant figure${digits === 1 ? "" : "s"} — so the value is rounded to ${digits}. Digits beyond that are not established.`
      );
    }
    return {
      ...base,
      kind: "finite",
      value: rounded,
      steps,
      ...(digits < MAX_DIGITS ? { significantDigits: digits } : {}),
    };
  }
  if (settled && "diverges" in settled) {
    steps.push(`The value grows without bound.`);
    return { ...base, kind: "infinite", value: settled.diverges > 0 ? Infinity : -Infinity, steps };
  }
  caveats.push(
    "This limit could not be established. Direct substitution is indeterminate, no rule here applied, and the numeric approach did not settle — so nothing is reported rather than a guess."
  );
  return { ...base, kind: "undetermined" };
}

function isIndeterminate(e: Expr, x: string, p: number): boolean {
  const q = asQuotient(e);
  if (!q) return !Number.isFinite(at(e, x, p));
  const n = at(q.num, x, p), d = at(q.den, x, p);
  if (Math.abs(n) < 1e-9 && Math.abs(d) < 1e-9) return true;
  if (!Number.isFinite(n) && !Number.isFinite(d)) return true;
  return Math.abs(d) < 1e-12;
}

/** An exact form for a value the CAS can evaluate symbolically. */
function exactValue(e: Expr, x: string, p: number): string | undefined {
  try {
    const sub = simp(substitute(e, x, N(p)));
    const s = format(sub);
    return /^[-\d/.]+$/.test(s) ? s : undefined;
  } catch {
    return undefined;
  }
}

const trim = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10))));

/** Replaces every free occurrence of `x` with `r`. */
export function substitute(e: Expr, x: string, r: Expr): Expr {
  switch (e.t) {
    case "num": return e;
    case "var": return e.name === x ? r : e;
    case "neg": return { t: "neg", e: substitute(e.e, x, r) };
    case "fn": return { t: "fn", name: e.name, arg: substitute(e.arg, x, r) };
    default: return { t: e.t, l: substitute(e.l, x, r), r: substitute(e.r, x, r) } as Expr;
  }
}

// ---------------------------------------------------------------------------
// Taylor / Maclaurin series
// ---------------------------------------------------------------------------

export interface SeriesResult {
  expression: string;
  variable: string;
  centre: number;
  order: number;
  /** Terms as printable strings, lowest order first. */
  terms: string[];
  /** The whole truncated series. */
  display: string;
  /** Coefficients f⁽ᵏ⁾(a)/k!, numerically. */
  coefficients: number[];
  steps: string[];
  caveats: string[];
  /**
   * The radius of convergence, from the function's singularities in ℂ (a
   * theorem) or refused by name — never read from `coefficients`.
   */
  radius?: RadiusResult;
  /** "R = 1 — the nearest singularity …", or the named refusal. */
  radiusLine?: string;
}

const MAX_ORDER = 12;

/**
 * Taylor series of `input` about `centre`, to `order` terms.
 * Coefficients come from repeated CAS differentiation, so they are exact where
 * the CAS can keep them exact.
 */
export function taylorSeries(input: string, variable = "x", centre = 0, order = 6): SeriesResult | null {
  let e: Expr;
  try {
    e = simp(parseExpr(input));
  } catch {
    return null;
  }
  const n = Math.max(1, Math.min(order, MAX_ORDER));
  const steps: string[] = [];
  const caveats: string[] = [];
  const coefficients: number[] = [];
  const terms: string[] = [];

  // THE RADIUS COMES FROM STRUCTURE, NEVER FROM THE COEFFICIENTS BELOW (which
  // are floats, and which mislead even when exact: the root test on 40 exact
  // coefficients of ln(1+x) reads 1.097). It is computed from the ORIGINAL text,
  // as a theorem about the function's singularities, or refused by name.
  const radius = radiusOfFunction(input, variable, centre);

  // A REMOVABLE centre (x/(eˣ − 1), sin(x)/x at 0) is 0/0 there, so the
  // derivative loop below cannot start. When the radius engine has PROVED the
  // centre removable (exactly — see radius.ts), the coefficients come from
  // power-series division of numerator by denominator instead.
  const removed = !Number.isFinite(at(e, variable, centre))
    ? removableCentreSeries(input, variable, centre, n, radius)
    : null;
  if (removed) {
    steps.push(`${variable} = ${centre} is removable (proved exactly), so the coefficients come from dividing the numerator's series by the denominator's.`);
  }

  let d: Expr = e;
  let factorial = 1;
  for (let k = 0; k <= n; k++) {
    let c: number;
    if (removed) {
      c = removed[k];
    } else {
      if (k > 0) {
        d = simp(derivative(d, variable));
        factorial *= k;
      }
      const value = at(d, variable, centre);
      if (!Number.isFinite(value)) {
        caveats.push(
          `The ${k}-th derivative is not defined at ${variable} = ${centre}, so the series stops at order ${k - 1}. A Taylor series needs the function to be differentiable at its centre.`
        );
        break;
      }
      c = value / factorial;
    }
    coefficients.push(c);
    if (Math.abs(c) < 1e-14) continue; // a genuinely zero term
    const cs = fmtCoeff(c);
    const varPart =
      k === 0 ? "" : centre === 0 ? (k === 1 ? variable : `${variable}^${k}`)
        : k === 1 ? `(${variable} - ${centre})` : `(${variable} - ${centre})^${k}`;
    terms.push(k === 0 ? cs : `${cs === "1" ? "" : cs === "-1" ? "-" : `${cs}*`}${varPart}`);
  }

  if (!terms.length) return null;
  const display = terms
    .map((t, i) => (i === 0 ? t : t.startsWith("-") ? ` - ${t.slice(1)}` : ` + ${t}`))
    .join("") + ` + O(${centre === 0 ? variable : `(${variable} - ${centre})`}^${coefficients.length})`;

  steps.push(`${centre === 0 ? "Maclaurin" : "Taylor"} series of ${format(e)} about ${variable} = ${centre}, to order ${coefficients.length - 1}.`);
  if (!removed) steps.push(`Coefficients are f⁽ᵏ⁾(${centre})/k!, from repeated differentiation.`);

  let radiusLine: string;
  if (radius.kind === "refused") {
    radiusLine = `Radius of convergence not determined: ${radius.reason ?? ""} The series is shown truncated.`.replace(/\s+/g, " ");
    caveats.push(
      `This is a TRUNCATED series: the O(...) term is real and is not negligible far from the centre. No general term is available and the function is outside the singularity rules, so the radius of convergence is not determined here — do not assume the series represents the function everywhere.`
    );
  } else {
    radiusLine = radius.line;
    caveats.push(
      "This is a TRUNCATED series: the O(...) term is real and is not negligible far from the centre, even inside the radius of convergence."
    );
    caveats.push(...radius.caveats);
  }
  steps.push(radiusLine);

  return { expression: format(e), variable, centre, order: coefficients.length - 1, terms, display, coefficients, steps, caveats, radius, radiusLine };
}

/**
 * Coefficients 0…n of N/D about a centre the radius engine PROVED removable:
 * the series of N and D from their own derivatives, the common zero of order m
 * divided out, then series division. Cross-checked against f near the centre;
 * any disagreement returns null (the caller then reports no series, as before).
 */
function removableCentreSeries(input: string, x: string, c: number, n: number, radius: RadiusResult): number[] | null {
  if (radius.kind === "refused" || radius.kind === "centreSingular") return null;
  if (!radius.removable.includes(`${x} = ${radius.centreDisplay}`)) return null;
  let raw: Expr;
  try {
    raw = parseExpr(input);
  } catch {
    return null;
  }
  if (raw.t !== "div") return null;
  const MAX_M = 6;
  const series = (f: Expr, count: number): number[] | null => {
    const out: number[] = [];
    let d = f;
    let fact = 1;
    for (let k = 0; k < count; k++) {
      if (k > 0) {
        d = simp(derivative(d, x));
        fact *= k;
      }
      const v = at(d, x, c);
      if (!Number.isFinite(v)) return null;
      out.push(v / fact);
    }
    return out;
  };
  const b = series(raw.r, n + MAX_M + 1);
  if (!b) return null;
  let m = 0;
  while (m < b.length && Math.abs(b[m]) < 1e-13) m++;
  if (m === 0 || m > MAX_M) return null;
  const a = series(raw.l, n + m + 1);
  if (!a) return null;
  for (let k = 0; k < m; k++) if (Math.abs(a[k]) > 1e-12) return null;
  const q: number[] = [];
  for (let j = 0; j <= n; j++) {
    let s = a[j + m];
    for (let i = 1; i <= j; i++) s -= b[i + m] * q[j - i];
    q.push(s / b[m]);
  }
  // Cross-check against the function itself, close to the centre.
  const R = radius.value !== undefined && Number.isFinite(radius.value) ? radius.value : 1;
  const h = 0.02 * Math.min(1, R);
  for (const t of [h, -h]) {
    const f = at(raw, x, c + t);
    let s = 0;
    for (let j = q.length - 1; j >= 0; j--) s = s * t + q[j];
    if (!Number.isFinite(f) || Math.abs(s - f) > 1e-7 * (1 + Math.abs(f))) return null;
  }
  return q;
}

function fmtCoeff(c: number): string {
  if (Number.isInteger(c)) return String(c);
  // Recognise small rationals so 1/6 does not print as 0.16666666666666666.
  for (let d = 2; d <= 5040; d++) {
    const n = c * d;
    if (Math.abs(n - Math.round(n)) < 1e-12) {
      const num = Math.round(n);
      if (Math.abs(num) < 1e9) return d === 1 ? String(num) : `${num}/${d}`;
    }
  }
  return String(Number(c.toPrecision(10)));
}

/** Parses "limit sin(x)/x as x -> 0" style requests. Returns null if it is not one. */
export function parseLimitRequest(text: string): { expr: string; variable: string; point: LimitPoint; side: Side } | null {
  const m = /^\s*(?:lim(?:it)?)\s+(.+?)\s+(?:as\s+)?([A-Za-z]\w*)\s*(?:->|→|to)\s*(\S+)\s*$/i.exec(text);
  if (!m) return null;
  const [, expr, variable, rawPoint] = m;
  let side: Side = "both";
  let p = rawPoint.trim().replace(/[),]$/, "");
  if (p.endsWith("+")) { side = "+"; p = p.slice(0, -1); }
  else if (p.endsWith("-") && p.length > 1 && !/^-?\d/.test(p)) { side = "-"; p = p.slice(0, -1); }
  let point: LimitPoint;
  if (/^(inf|infinity|∞|\+inf)$/i.test(p)) point = "inf";
  else if (/^(-inf|-infinity|−∞|-∞)$/i.test(p)) point = "-inf";
  else {
    const v = Number(p);
    if (!Number.isFinite(v)) return null;
    point = v;
  }
  return { expr: expr.trim(), variable, point, side };
}

/** Parses "taylor exp(x) about 0 order 5" / "series sin(x)". */
export function parseSeriesRequest(text: string): { expr: string; variable: string; centre: number; order: number } | null {
  // "taylor f", "series f", and the sentence forms "taylor series of f",
  // "maclaurin series for f", "taylor expansion of f", "power series of f" —
  // without the first alternative, "taylor series of 1/(1+x^2)" read the
  // expression as "series of 1/(1+x^2)". A bare "expansion of …" is NOT
  // claimed: "expansion of (x+1)^3" is algebra, not a series.
  const m =
    /^\s*(?:find\s+|compute\s+)?(?:the\s+)?(?:taylor|maclaurin|power)\s+(?:series|expansion|polynomial)\s+(?:of|for)\s+(.+?)\s*$/i.exec(text) ??
    /^\s*(?:taylor|maclaurin|series)\s+(?:(?:of|for)\s+)?(.+?)\s*$/i.exec(text);
  if (!m) return null;
  let rest = m[1];
  let centre = 0, order = 6, variable = "x";
  const about = /\b(?:about|at|around)\s+([A-Za-z]\w*\s*=\s*)?(-?\d+(?:\.\d+)?)/i.exec(rest);
  if (about) {
    centre = Number(about[2]);
    if (about[1]) variable = about[1].split("=")[0].trim();
    rest = rest.replace(about[0], " ");
  }
  const ord = /\b(?:order|terms?|to)\s+(\d+)/i.exec(rest);
  if (ord) { order = Number(ord[1]); rest = rest.replace(ord[0], " "); }
  const expr = rest.trim().replace(/[,;]+$/, "");
  if (!expr) return null;
  return { expr, variable, centre, order };
}
