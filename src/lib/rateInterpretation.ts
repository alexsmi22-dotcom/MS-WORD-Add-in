// SAT-style rate-interpretation problems: an equation relating two
// quantities, prose asking what a 1-unit increase in one does to the other,
// and (often) answer-choice statements to judge.
//
//   C = (5/9)(F − 32) … "A temperature increase of 1 degree Fahrenheit is
//   equivalent to a temperature increase of 5/9 degree Celsius."
//
// What is computable EXACTLY here: for a linear relation, the exchange rate
// each way (dC/dF = 5/9, dF/dC = 9/5), and the truth of any statement of the
// form "an increase/decrease of a in X is an increase/decrease of b in Y" —
// checked with SIGNED deltas, (±a)·(dY/dX) = ±b, so mixed-direction claims
// and negative slopes judge correctly. Statements that don't match that shape
// are listed as not judged, never guessed at. Nonlinear relations are refused
// by name: their
// exchange rate depends on where you are, so no single number answers the
// question.
//
// THE VERDICTS FOLLOW FROM THE EQUATION AS PASTED, AND SAY SO. A rendered
// fraction that collapsed in the clipboard (5/9 arriving as 59) yields
// verdicts about the pasted equation — the caveat names this exact trap so
// the premise is checkable at a glance.

import { parseExpr, evalAst, derivative, simplify, format, freeVars, Expr } from "./solve";
import type { WordProblemResult, WorkStep } from "./wordproblem";

const TOL = 1e-9;

/** First line that reads as a two-sided equation both of whose sides parse. */
function findEquation(lines: string[]): { line: string; expr: Expr } | null {
  for (const line of lines) {
    const parts = line.split("=");
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) continue;
    try {
      const expr = parseExpr(`(${parts[0]}) - (${parts[1]})`);
      return { line: line.trim(), expr };
    } catch {
      continue;
    }
  }
  return null;
}

/** unit word (lowercased) → variable letter, from prose like
 *  "temperature F, measured in degrees Fahrenheit". The variable's own letter
 *  always resolves; a full unit word ("fahrenheit") resolves ONLY when the
 *  prose names the pairing — there is deliberately no first-letter guessing,
 *  so an unnamed unit word makes its statement unjudgeable (and disclosed as
 *  such), never misattributed. */
function unitMap(text: string, vars: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\b([A-Za-z])\s*,\s*measured in (?:degrees?\s+)?([A-Za-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (vars.includes(m[1])) map.set(m[2].toLowerCase(), m[1]);
  }
  for (const v of vars) {
    map.set(v.toLowerCase(), v); // the variable's own letter always works
  }
  return map;
}

/** Direction a claim's verb carries: +1 increase, −1 decrease, 0 for the
 *  direction-neutral "change". */
type Dir = 1 | -1 | 0;

function dirOf(word: string): Dir {
  const w = word.toLowerCase();
  return w === "increase" ? 1 : w === "decrease" ? -1 : 0;
}

function dirWord(d: Dir): string {
  return d === 1 ? "an increase" : d === -1 ? "a decrease" : "a change";
}

interface Claim {
  a: number;
  aShown: string;
  fromVar: string;
  fromDir: Dir;
  b: number;
  bShown: string;
  toVar: string;
  toDir: Dir;
  line: string;
}

const CLAIM_RE =
  /(increase|decrease|change)\s+of\s+([\d./]+)\s+(?:degrees?|units?)?\s*([A-Za-z]+)[^.\n]*?(increase|decrease|change)\s+of\s+([\d./]+)\s+(?:degrees?|units?)?\s*([A-Za-z]+)/i;

/** Parses one answer-choice line into a checkable claim, if it has the shape.
 *  The direction words are CAPTURED — "an increase of 1 in F is a DECREASE of
 *  5/9 in C" is a different claim from the both-increase form, and judging it
 *  as if both sides said "increase" gives wrong verdicts whenever the
 *  directions mix or the slope is negative. */
function parseClaim(line: string, units: Map<string, string>): Claim | null {
  const m = CLAIM_RE.exec(line);
  if (!m) return null;
  const fromVar = units.get(m[3].toLowerCase());
  const toVar = units.get(m[6].toLowerCase());
  if (!fromVar || !toVar || fromVar === toVar) return null;
  try {
    const a = evalAst(parseExpr(m[2]), {});
    const b = evalAst(parseExpr(m[5]), {});
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return {
      a,
      aShown: m[2],
      fromVar,
      fromDir: dirOf(m[1]),
      b,
      bShown: m[5],
      toVar,
      toDir: dirOf(m[4]),
      line: line.trim(),
    };
  } catch {
    return null;
  }
}

function fmtVal(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

/**
 * The rate-interpretation template. Returns null unless the text carries an
 * equation in exactly two variables AND prose about increases/changes — the
 * conservative-templates contract of the word-problem engine.
 */
export function tryRateInterpretation(text: string): WordProblemResult | null {
  if (!/\b(?:increase|decrease|change)\b/i.test(text)) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const eq = findEquation(lines);
  if (!eq) return null;
  const vars = freeVars(eq.expr).sort();
  if (vars.length !== 2) return null;
  const [P, Q] = vars;

  const dP = simplify(simplify(derivative(eq.expr, P)));
  const dQ = simplify(simplify(derivative(eq.expr, Q)));
  const steps: string[] = [];
  const work: WorkStep[] = [];
  const caveats: string[] = [];

  steps.push(`The equation: ${eq.line}`);
  work.push({ text: "The equation:" });
  work.push({ math: eq.line });

  // A varying exchange rate is a refusal, not a guess.
  if (freeVars(dP).length || freeVars(dQ).length) {
    const msg =
      `This relation is not linear in ${P} and ${Q}, so a 1-unit increase in one does NOT change the other by a fixed amount — ` +
      `the exchange rate depends on where you start. No single number answers an "increase of 1" question here.`;
    steps.push(msg);
    work.push({ text: msg });
    return {
      template: "rate-interpretation",
      answer: `The ${P}↔${Q} exchange rate is not constant (the relation is nonlinear).`,
      value: NaN,
      equation: eq.line,
      equationMath: eq.line,
      steps,
      work,
      caveats: ["Only linear relations have one fixed exchange rate between their variables."],
    };
  }

  let dPv: number;
  let dQv: number;
  try {
    dPv = evalAst(dP, {});
    dQv = evalAst(dQ, {});
  } catch {
    return null;
  }
  if (!Number.isFinite(dPv) || !Number.isFinite(dQv) || dPv === 0 || dQv === 0) return null;

  // Implicit differentiation of F(P,Q) = 0: dQ/dP = −F_P / F_Q — exact,
  // formatted from the AST so 5/9 prints as 5/9, not 0.5555…
  const slopeQP: Expr = { t: "div", l: { t: "neg", e: dP }, r: dQ };
  const slopePQ: Expr = { t: "div", l: { t: "neg", e: dQ }, r: dP };
  const sQP = format(simplify(simplify(slopeQP)));
  const sPQ = format(simplify(simplify(slopePQ)));
  const vQP = -dPv / dQv;
  const vPQ = -dQv / dPv;

  const rate1 = `A 1-unit increase in ${P} changes ${Q} by ${sQP}${sQP !== fmtVal(vQP) ? ` ≈ ${fmtVal(vQP)}` : ""}.`;
  const rate2 = `A 1-unit increase in ${Q} changes ${P} by ${sPQ}${sPQ !== fmtVal(vPQ) ? ` ≈ ${fmtVal(vPQ)}` : ""}.`;
  steps.push(rate1, rate2);
  work.push({ text: rate1 });
  work.push({ text: rate2 });

  // Judge the answer-choice statements that match the checkable shape.
  const units = unitMap(text, vars);
  // A line COUNTS as a statement when it talks about an increase/decrease and
  // names one of the quantities — whether or not it can be judged. Question
  // prose ("which of the following must be true?") mentions neither and is
  // passed over silently.
  const mentionsQuantity = (line: string): boolean =>
    [...units.keys()].some((u) => new RegExp(`\\b${u}\\b`, "i").test(line)) ||
    vars.some((v) => new RegExp(`\\b${v}\\b`).test(line));
  let judged = 0;
  let unreadable = 0;
  for (const line of lines) {
    if (line === eq.line) continue;
    if (!/\b(?:increase|decrease|change)/i.test(line)) continue;
    // A CLAIM_RE-shaped line whose unit words never got named in prose still
    // COUNTS — silently dropping it would break the "listed, never guessed
    // at" promise.
    if (!mentionsQuantity(line) && !CLAIM_RE.test(line)) continue;
    const claim = parseClaim(line, units);
    if (!claim) {
      unreadable++;
      continue;
    }
    const slope = claim.fromVar === P ? vQP : vPQ;
    if (claim.fromDir === 0 || claim.toDir === 0) {
      if (claim.fromDir === 0 && claim.toDir === 0) {
        // "change of a … change of b": direction-neutral both sides, so the
        // claim is about magnitude only.
        judged++;
        const expectedMag = Math.abs(claim.a * slope);
        const truth = Math.abs(expectedMag - claim.b) <= TOL * Math.max(1, expectedMag);
        const verdict = truth
          ? `TRUE — a change of ${claim.aShown} in ${claim.fromVar} is a change of ${claim.bShown} in ${claim.toVar} (in magnitude).`
          : `FALSE — a change of ${claim.aShown} in ${claim.fromVar} changes ${claim.toVar} by ${fmtVal(expectedMag)} in magnitude, not ${claim.bShown}.`;
        steps.push(`${verdict}  (statement: “${claim.line}”)`);
        work.push({ text: verdict });
      } else {
        // A neutral "change" paired with a signed increase/decrease can't be
        // judged without guessing which way the change went.
        unreadable++;
      }
      continue;
    }
    judged++;
    // Signed deltas: the claim says a move of (fromDir·a) in fromVar comes
    // with a move of (toDir·b) in toVar. What actually happens is slope·Δ.
    const expected = claim.fromDir * claim.a * slope;
    const claimed = claim.toDir * claim.b;
    const truth = Math.abs(expected - claimed) <= TOL * Math.max(1, Math.abs(expected));
    const verdict = truth
      ? `TRUE — ${dirWord(claim.fromDir)} of ${claim.aShown} in ${claim.fromVar} is ${dirWord(claim.toDir)} of ${claim.bShown} in ${claim.toVar}.`
      : `FALSE — ${dirWord(claim.fromDir)} of ${claim.aShown} in ${claim.fromVar} changes ${claim.toVar} by ${fmtVal(expected)}, not ${fmtVal(claimed)}.`;
    steps.push(`${verdict}  (statement: “${claim.line}”)`);
    work.push({ text: verdict });
  }
  if (unreadable) {
    const note = `${unreadable} statement${unreadable === 1 ? "" : "s"} mentioning an increase could not be read as a checkable a-to-b claim and ${unreadable === 1 ? "was" : "were"} NOT judged.`;
    steps.push(note);
    work.push({ text: note });
    caveats.push("Unjudged statements are listed, never guessed at.");
  }

  caveats.push(
    `Every verdict follows from the equation exactly as it was read: ${eq.line}. Check it against the original — a rendered fraction can collapse in the clipboard (5/9 pastes as 59), which changes every rate.`,
  );

  return {
    template: "rate-interpretation",
    answer: `${rate1} ${rate2}`,
    value: vQP,
    equation: eq.line,
    equationMath: eq.line,
    steps,
    work,
    caveats,
  };
}
