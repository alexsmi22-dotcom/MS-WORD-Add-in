// Offline word-problem parser (deterministic, on-device).
//
// This is the FULLY PRIVATE half of the "both, offline first" design: it
// recognises a fixed set of common, unambiguous templates and solves them with
// solve.ts. It is deliberately CONSERVATIVE — the honesty mandate makes a
// mis-translated word problem worse than an unsolved one, so anything it cannot
// map cleanly returns null, and the caller offers the (opt-in, online) AI path
// instead. It never guesses an interpretation.
//
// Templates covered:
//   * Percentage — "what is 15% of 200", "12 is what percent of 48",
//     "9 is 30% of what".
//   * Distance = rate × time — any two of the three given.
//   * Simple linear number sentences — "twice a number plus 7 is 15",
//     "5 less than a number is 12" — translated to an equation and solved.

import { solveEquation } from "./solve";

import { parseShareProblem, solveShares } from "./sharesequence";

/**
 * One line of shown work. `text` is prose; `math` is the pane's formula DSL, so
 * the reasoning renders as real notation — fractions, superscripts, radicals and
 * n-ary products — instead of ASCII. Templates that have no formulae simply
 * leave `work` unset and their plain `steps` are shown as before.
 */
export interface WorkStep {
  text?: string;
  math?: string;
}

export interface WordProblemResult {
  template: string;
  answer: string;
  value: number;
  /** The equation the parser built, when it translated one. Plain text. */
  equation?: string;
  /** The same equation in the pane's math DSL, when it can be typeset. */
  equationMath?: string;
  /** Plain-text working — this is what gets inserted into the document. */
  steps: string[];
  /** The same working, with the formulae kept as DSL for typeset display. */
  work?: WorkStep[];
  caveats: string[];
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/** Normalises whitespace and a few spellings so the patterns below stay simple. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\bpercent\b/g, "%")
    .replace(/[?.!]+$/g, "")
    .trim();
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));

// ---------------------------------------------------------------------------
// Percentage
// ---------------------------------------------------------------------------
function tryPercentage(t: string): WordProblemResult | null {
  // "X is what percent of Y"
  let m = new RegExp(`${NUM} is what % of ${NUM}`).exec(t);
  if (m) {
    const x = +m[1], y = +m[2];
    if (y === 0) return null;
    const v = (x / y) * 100;
    return {
      template: "percentage",
      value: v,
      answer: `${fmt(v)}%`,
      steps: [`${fmt(x)} ÷ ${fmt(y)} × 100 = ${fmt(v)}%`],
      caveats: [],
    };
  }
  // "X is P% of what"
  m = new RegExp(`${NUM} is ${NUM} ?% of what`).exec(t);
  if (m) {
    const x = +m[1], p = +m[2];
    if (p === 0) return null;
    const v = x / (p / 100);
    return {
      template: "percentage",
      value: v,
      answer: fmt(v),
      steps: [`${fmt(x)} ÷ ${fmt(p)}% = ${fmt(x)} ÷ ${fmt(p / 100)} = ${fmt(v)}`],
      caveats: [],
    };
  }
  // "(what is) P% of Y"
  m = new RegExp(`${NUM} ?% of ${NUM}`).exec(t);
  if (m) {
    const p = +m[1], y = +m[2];
    const v = (p / 100) * y;
    return {
      template: "percentage",
      value: v,
      answer: fmt(v),
      steps: [`${fmt(p)}% × ${fmt(y)} = ${fmt(p / 100)} × ${fmt(y)} = ${fmt(v)}`],
      caveats: [],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Distance = rate × time
// ---------------------------------------------------------------------------
const SPEED_UNITS = String.raw`(?:mph|km\/h|kph|m\/s|miles per hour|kilometers? per hour|meters? per second)`;
const TIME_UNITS = String.raw`(?:hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s)`;
const DIST_UNITS = String.raw`(?:miles?|mi|kilometers?|km|meters?|m|feet|ft)`;

function tryDistanceRateTime(t: string): WordProblemResult | null {
  const rate = new RegExp(`${NUM} ${SPEED_UNITS}`).exec(t);
  const time = new RegExp(`${NUM} ${TIME_UNITS}\\b`).exec(t);
  const dist = new RegExp(`${NUM} ${DIST_UNITS}\\b`).exec(t);
  const asksDistance = /\b(how far|what distance|distance)\b/.test(t);
  const asksTime = /\b(how long|what time|how much time)\b/.test(t);
  const asksSpeed = /\b(how fast|what speed|average speed|what rate)\b/.test(t);

  if (rate && time && (asksDistance || !dist)) {
    const r = +rate[1], tm = +time[1];
    const v = r * tm;
    return {
      template: "distance = rate × time",
      value: v,
      answer: fmt(v),
      steps: [`distance = rate × time = ${fmt(r)} × ${fmt(tm)} = ${fmt(v)}`],
      caveats: ["Assumes constant speed and consistent units (e.g. mph with hours)."],
    };
  }
  if (dist && time && (asksSpeed || !rate)) {
    const d = +dist[1], tm = +time[1];
    if (tm === 0) return null;
    const v = d / tm;
    return {
      template: "distance = rate × time",
      value: v,
      answer: fmt(v),
      steps: [`rate = distance ÷ time = ${fmt(d)} ÷ ${fmt(tm)} = ${fmt(v)}`],
      caveats: ["Assumes constant speed and consistent units."],
    };
  }
  if (dist && rate && (asksTime || !time)) {
    const d = +dist[1], r = +rate[1];
    if (r === 0) return null;
    const v = d / r;
    return {
      template: "distance = rate × time",
      value: v,
      answer: fmt(v),
      steps: [`time = distance ÷ rate = ${fmt(d)} ÷ ${fmt(r)} = ${fmt(v)}`],
      caveats: ["Assumes constant speed and consistent units."],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Simple linear number sentences -> equation
// ---------------------------------------------------------------------------
// Strict: the sentence must be built only from the vocabulary below. If any
// non-numeric, non-keyword token survives translation, we bail rather than guess.
function tryNumberSentence(t: string): WordProblemResult | null {
  if (!/\bnumber\b/.test(t)) return null;
  // Must have exactly one comparison word to form an equation.
  if (!/\b(is|equals?|gives?)\b/.test(t)) return null;

  let s = ` ${t} `;
  // Drop question framing that carries no math.
  s = s.replace(/\b(find|what is|the value of|the result|then|so)\b/g, " ");
  // "5 less than X"  ->  "X - 5"  (order inverts); handle BEFORE plain words.
  s = s.replace(new RegExp(`${NUM} less than`, "g"), "__SUB__ $1 after ");
  s = s.replace(new RegExp(`${NUM} more than`, "g"), "__ADD__ $1 after ");
  // The unknown, and multiplier phrases.
  const ART = String.raw`(?:(?:a|the|some) )?`; // optional article, trailing space consumed
  s = s.replace(new RegExp(`\\btwice ${ART}number\\b`, "g"), "2*n");
  s = s.replace(new RegExp(`\\bdouble ${ART}number\\b`, "g"), "2*n");
  s = s.replace(new RegExp(`\\bthrice ${ART}number\\b`, "g"), "3*n");
  s = s.replace(new RegExp(`\\bhalf (?:of )?${ART}number\\b`, "g"), "n/2");
  s = s.replace(/\b(?:a|the|some) number\b/g, "n");
  s = s.replace(/\bnumber\b/g, "n");
  // Operators.
  s = s.replace(/\b(plus|added to|increased by|and)\b/g, "+");
  s = s.replace(/\b(minus|decreased by|reduced by)\b/g, "-");
  s = s.replace(/\b(times|multiplied by|of)\b/g, "*");
  s = s.replace(/\b(divided by|over)\b/g, "/");
  s = s.replace(/\b(is|equals?|gives?)\b/g, "=");
  // Resolve the inverted "less/more than N" markers: "__SUB__ 5 after n" -> "n - 5".
  s = s.replace(/__ADD__ (\S+) after\s*([^=+\-*/]+)/g, "$2 + $1");
  s = s.replace(/__SUB__ (\S+) after\s*([^=+\-*/]+)/g, "$2 - $1");
  s = s.replace(/\ba\b|\bthe\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // What remains must be a clean equation over n, digits and operators only.
  if (!/=/.test(s)) return null;
  if (!/n/.test(s)) return null;
  if (/[a-z]/.test(s.replace(/n/g, ""))) return null; // leftover words -> bail

  const r = solveEquation(s, "n");
  if (!r || !r.roots.length || r.method === "unsolved") return null;
  const real = r.roots.filter((x) => x.im === 0);
  if (!real.length) return null;
  const v = real[0].re;
  return {
    template: "linear number sentence",
    value: v,
    answer: fmt(v),
    equation: s,
    steps: [`Translated to: ${s}`, `Solved (${r.method}): n = ${fmt(v)}`],
    caveats: ["Parsed from a restricted set of phrasings; if the reading looks wrong, rephrase or use the AI option."],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Attempts to solve a word problem from a fixed set of templates. Returns null
 * when none matches — the caller should then offer the online AI path rather
 * than pretend an answer.
 */
/**
 * Successive shares: "N guests, guest k takes k% of what's left, who gets the
 * most?" Handled by its own model in sharesequence.ts because it is a recurrence
 * rather than a pattern that maps onto a single equation.
 *
 * Tried FIRST: its phrasing contains percentages, so tryPercentage would
 * otherwise match on the "1%" and answer a much smaller question than the one
 * asked.
 */
function tryShareSequence(original: string): WordProblemResult | null {
  const p = parseShareProblem(original);
  if (!p) return null;
  const sol = solveShares(p);
  return {
    template: "successive shares",
    answer: sol.answer,
    value: sol.value,
    equation: p.ofRemainder ? "P(k) = (k/100) x prod_{i<k} (1 - i/100)" : "P(k) = k/100",
    equationMath: p.ofRemainder ? "P(k) = (k/100)*prod(i=1, k-1, (1 - i/100))" : "P(k) = k/100",
    steps: sol.steps,
    work: sol.work,
    caveats: sol.caveats,
  };
}

export function solveWordProblem(text: string): WordProblemResult | null {
  const t = normalize(text);
  if (!t) return null;
  return (
    tryShareSequence(text) ?? tryPercentage(t) ?? tryDistanceRateTime(t) ?? tryNumberSentence(t)
  );
}
