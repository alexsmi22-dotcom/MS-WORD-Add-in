// SAT-style rate-interpretation problems: an equation relating two
// quantities, prose asking what a 1-unit increase in one does to the other,
// and (often) answer-choice statements to judge.
//
//   C = (5/9)(F − 32) … "A temperature increase of 1 degree Fahrenheit is
//   equivalent to a temperature increase of 5/9 degree Celsius."
//
// What is computable EXACTLY here: for a linear relation, the exchange rate
// each way (dC/dF = 5/9, dF/dC = 9/5), and the truth of any statement of the
// form "an increase of a in X is an increase of b in Y" — checked as
// a·(dY/dX) = b. Statements that don't match that shape are listed as not
// judged, never guessed at. Nonlinear relations are refused by name: their
// exchange rate depends on where you are, so no single number answers the
// question.
//
// THE VERDICTS FOLLOW FROM THE EQUATION AS PASTED, AND SAY SO. A rendered
// fraction that collapsed in the clipboard (5/9 arriving as 59) yields
// verdicts about the pasted equation — the caveat names this exact trap so
// the premise is checkable at a glance.

import { parseExpr, evalAst, derivative, simplify, format, freeVars, Expr } from "./solve";
import { WordProblemResult, WorkStep } from "./wordproblem";

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
 *  "temperature F, measured in degrees Fahrenheit" plus a first-letter
 *  fallback (fahrenheit → F) so unnamed pairings still resolve. */
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

interface Claim {
  a: number;
  aShown: string;
  fromVar: string;
  b: number;
  bShown: string;
  toVar: string;
  line: string;
}

const CLAIM_RE =
  /(?:increase|decrease|change)\s+of\s+([\d./]+)\s+(?:degrees?|units?)?\s*([A-Za-z]+)[^.\n]*?(?:increase|decrease|change)\s+of\s+([\d./]+)\s+(?:degrees?|units?)?\s*([A-Za-z]+)/i;

/** Parses one answer-choice line into a checkable claim, if it has the shape. */
function parseClaim(line: string, units: Map<string, string>): Claim | null {
  const m = CLAIM_RE.exec(line);
  if (!m) return null;
  const fromVar = units.get(m[2].toLowerCase());
  const toVar = units.get(m[4].toLowerCase());
  if (!fromVar || !toVar || fromVar === toVar) return null;
  try {
    const a = evalAst(parseExpr(m[1]), {});
    const b = evalAst(parseExpr(m[3]), {});
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { a, aShown: m[1], fromVar, b, bShown: m[3], toVar, line: line.trim() };
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
  let judged = 0;
  let unreadable = 0;
  for (const line of lines) {
    if (line === eq.line) continue;
    if (!CLAIM_RE.test(line)) continue;
    const claim = parseClaim(line, units);
    if (!claim) {
      unreadable++;
      continue;
    }
    judged++;
    const slope = claim.fromVar === P ? vQP : vPQ;
    const expected = claim.a * slope;
    const truth = Math.abs(expected - claim.b) <= TOL * Math.max(1, Math.abs(expected));
    const verdict = truth
      ? `TRUE — an increase of ${claim.aShown} in ${claim.fromVar} is an increase of ${claim.bShown} in ${claim.toVar}.`
      : `FALSE — an increase of ${claim.aShown} in ${claim.fromVar} changes ${claim.toVar} by ${fmtVal(expected)}, not ${claim.bShown}.`;
    steps.push(`${verdict}  (statement: “${claim.line}”)`);
    work.push({ text: verdict });
  }
  if (unreadable) {
    const note = `${unreadable} statement${unreadable === 1 ? "" : "s"} mentioning an increase could not be read in the a-to-b shape and ${unreadable === 1 ? "was" : "were"} NOT judged.`;
    steps.push(note);
    work.push({ text: note });
    caveats.push("Unjudged statements are listed, never guessed at.");
  }

  caveats.push(
    `Every verdict follows from the equation exactly as it was read: ${eq.line}. Check it against the original — a rendered fraction can collapse in the clipboard (5/9 pastes as 59), which changes every rate.`,
  );

  return {
    template: "rate-interpretation",
    answer: judged
      ? `${rate1} ${rate2}`
      : `${rate1} ${rate2}`,
    value: vQP,
    equation: eq.line,
    equationMath: eq.line,
    steps,
    work,
    caveats,
  };
}
