/**
 * The one rule for a reading that quotes a CHANGE in a probability or a share (econ-logit / probit average marginal
 * effects, econ-mlogit dP/dx, econ-tobit ∂P(uncensored)/∂x). Bug test 2026-10-28 round 2 (BLOCKER 1, MAJOR 4):
 *  - never print a probability change of 1 or more (as printed: 0.99996 at 4 decimals prints "1.0000");
 *  - quote per one unit whenever the printed change is below 1, so a 0.36 slope stays "a one-unit rise … 0.3639";
 *  - rescale the step only when the per-unit change prints at 1 or more, to the largest power of ten below 1 that
 *    brings it under 0.1 (well inside 0 to 1);
 *  - never rescale a 0/1 predictor ("a 0.1-unit rise in PSI" means nothing): when its derivative prints at 1 or more,
 *    the reading states the direction only (quotable: false);
 *  - one step per sentence: a caller that rescales quotes nothing else per one unit in the same sentence.
 * The scaled number must be on screen too: probStepNote gives the text line behind it.
 */
import { fmtFixed, fmtSci } from "./regTable";
import { printedNumber } from "./pReading";

export interface ProbStep {
  /** The step of x the change is quoted per (1 unless rescaled). */
  step: number;
  /** "1", "0.1", "0.01", …, "1×10⁻⁵". */
  stepText: string;
  /** |change|·step at the decimals asked for (fmtFixed), the number the reading and the note print. */
  scaledText: string;
  /** False when the change cannot be quoted as a number (a 0/1 predictor whose derivative prints at 1 or more). */
  quotable: boolean;
  /** "one-unit" or "0.01-unit", for "A … rise in x". */
  stepWords: string;
}

/** True when every finite value is 0 or 1 (a dummy predictor), and both occur. */
export function isBinaryColumn(values: ArrayLike<number>): boolean {
  let zero = false;
  let one = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v === 0) zero = true;
    else if (v === 1) one = true;
    else return false;
  }
  return zero && one;
}

/** The step for quoting a probability change `change` (per one unit of x), at `decimals` (default 4). */
export function probChangeStep(change: number, opts: { binary?: boolean; decimals?: number } = {}): ProbStep {
  const d = opts.decimals ?? 4;
  const abs = Math.abs(change);
  const printedAbs = (v: number): number => printedNumber(fmtFixed(v, d));
  const one: ProbStep = { step: 1, stepText: "1", scaledText: fmtFixed(abs, d), quotable: true, stepWords: "one-unit" };
  if (!Number.isFinite(abs) || printedAbs(abs) < 1) return one;
  if (opts.binary) return { ...one, quotable: false };
  let k = 1;
  while (printedAbs(abs * Math.pow(10, -k)) >= 0.1 && k < 30) k++;
  const step = Math.pow(10, -k);
  const stepText = k <= 4 ? step.toFixed(k) : fmtSci(step, 1);
  return { step, stepText, scaledText: fmtFixed(abs * step, d), quotable: true, stepWords: `${stepText}-unit` };
}

/**
 * The text line behind a rescaled change, so the reading's number is on screen: "Per 0.01 of x: the average marginal
 * effect −1.3310 × 0.01 = −0.0133 in P(y = 1). …". Empty when the step is 1.
 */
export function probStepNote(term: string, change: number, sc: ProbStep, target: string, decimals = 4): string {
  if (sc.step === 1) return "";
  return (
    `Per ${sc.stepText} of ${term}: the average marginal effect ${fmtFixed(change, decimals)} × ${sc.stepText} = ` +
    `${change < 0 ? "−" : ""}${sc.scaledText} in ${target}. A marginal effect is a slope at the data, so it is ` +
    "quoted per a step small enough that the probability change stays well inside 0 to 1."
  );
}
