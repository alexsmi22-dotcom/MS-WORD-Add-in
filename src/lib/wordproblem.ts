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
//     "5 less than a number is 12", "five times an unknown number is equal to
//     60" — translated to an equation and solved.
//   * Running totals — an unknown start, a sequence of gains and losses, and a
//     stated final amount ("19 get off, 17 get on, now there are 63").
//
// EVERY TRANSLATED PROBLEM SHOWS THE EQUATION IT DERIVED. That is what makes
// widening the vocabulary safe: a misreading produces a visibly wrong equation
// beside the answer, rather than a confident wrong number on its own.

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


/**
 * The clause that carries the equation, with the question stripped off.
 *
 * WHY THIS EXISTS. `tryNumberSentence` translated the WHOLE input, so
 * "A number increased by 7 is 22. What is the number?" became
 * `n + 7 = 22. n?` and `solveEquation` refused it. The template was documented
 * as supported, was measured refusing its own canonical example, and the user
 * saw that as "Solve does not respond".
 *
 * A word problem is a statement plus a question. Only the statement is an
 * equation. Sentences are split on terminal punctuation and newlines, the
 * interrogative ones are dropped, and what remains is joined back — a problem
 * can state its facts across several sentences.
 */
function statementClauses(text: string): string {
  return text
    .split(/[.!?\n]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .filter((c) => !/^(?:how|what|find|determine|calculate|solve)\b/i.test(c))
    .join(" ");
}

/** Number words the examples actually use, so "five times" reads as "5 times". */
const NUMBER_WORDS: [RegExp, string][] = [
  [/\bzero\b/g, "0"],
  [/\bone\b/g, "1"],
  [/\btwo\b/g, "2"],
  [/\bthree\b/g, "3"],
  [/\bfour\b/g, "4"],
  [/\bfive\b/g, "5"],
  [/\bsix\b/g, "6"],
  [/\bseven\b/g, "7"],
  [/\beight\b/g, "8"],
  [/\bnine\b/g, "9"],
  [/\bten\b/g, "10"],
  [/\beleven\b/g, "11"],
  [/\btwelve\b/g, "12"],
];

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

  // How many of each quantity the text actually contains.
  //
  // The one-body template can hold exactly one of each, and `exec` silently
  // takes the first of several — which is how a two-train problem came to be
  // answered with one train's speed and authoritative-looking working.
  //
  // A distance must NOT be followed by "/" or "per": "90 km/h" contains "km",
  // so without that guard every speed also counted as a distance and ordinary
  // one-body questions were refused.
  const countAll = (src: string): number => (t.match(new RegExp(src, "g")) ?? []).length;
  const DIST_ONLY = `${NUM} ${DIST_UNITS}\\b(?!\\s*/|\\s*per)`;
  const nTimes = countAll(`${NUM} ${TIME_UNITS}\\b`);
  const nDists = countAll(DIST_ONLY);

  // Rates, including the elided form "60 and 90 km/h", where two numbers share
  // one unit. Counting explicit "N unit" matches finds only the second.
  const rates: number[] = [];
  const elided = new RegExp(`${NUM}\\s*(?:and|,)\\s*${NUM}\\s*${SPEED_UNITS}`).exec(t);
  if (elided) {
    rates.push(+elided[1], +elided[2]);
  } else {
    const rateRe = new RegExp(`${NUM} ${SPEED_UNITS}`, "g");
    let rm: RegExpExecArray | null;
    while ((rm = rateRe.exec(t)) !== null) rates.push(+rm[1]);
  }
  const nRates = rates.length;

  // Two bodies approaching or separating: their speeds ADD. Claimed only when
  // the wording is explicit, so this does not become a new way to guess.
  const towardEachOther = /\b(toward each other|towards each other|approach each other)\b/.test(t);
  const oppositeWays = /\b(opposite directions|away from each other)\b/.test(t);
  if ((towardEachOther || oppositeWays) && nRates === 2 && nDists === 1) {
    const d = +new RegExp(DIST_ONLY).exec(t)![1];
    const combined = rates[0] + rates[1];
    if (combined > 0) {
      const v = d / combined;
      return {
        template: "distance = combined rate × time",
        value: v,
        answer: fmt(v),
        steps: [
          `combined rate = ${fmt(rates[0])} + ${fmt(rates[1])} = ${fmt(combined)}`,
          `time = distance ÷ combined rate = ${fmt(d)} ÷ ${fmt(combined)} = ${fmt(v)}`,
        ],
        caveats: [
          towardEachOther
            ? "Two bodies approaching: their speeds add, so the gap closes at the combined rate."
            : "Two bodies separating: their speeds add, so the gap opens at the combined rate.",
          "Assumes both start at the same moment, constant speed, and consistent units.",
        ],
      };
    }
  }

  // More of any quantity than the one-body template can hold: refuse. Picking
  // one and answering is precisely the failure this guard exists to stop.
  if (nRates > 1 || nTimes > 1 || nDists > 1) return null;

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
  // The STATEMENT only — see statementClauses. Translating the question too is
  // what made this template refuse its own documented example.
  const stated = statementClauses(t);
  if (!/\bnumber\b/.test(stated)) return null;
  if (!/\b(is|are|equals?|gives?|difference)\b/.test(stated)) return null;

  let s = ` ${stated} `;
  for (const [re, digit] of NUMBER_WORDS) s = s.replace(re, digit);

  // Comparison phrases, before the bare verbs.
  s = s.replace(/\bthe difference is\b/g, " = ");
  s = s.replace(/\bgives the same result as\b/g, " = ");
  s = s.replace(/\bis the same as\b/g, " = ");
  s = s.replace(/\bis equal to\b/g, " = ");
  s = s.replace(/\b(if|then|so|the value of|the result)\b/g, " ");

  // THE UNKNOWN IS RESOLVED BEFORE ANY INVERSION, and this order is the whole
  // correctness argument of this function.
  //
  // The first version inverted first, so "5 is subtracted from twice an
  // unknown number" reached the inversion as raw words, the operand regex
  // grabbed the wrong span, and it produced `2 - 5*n = 13` — answer -2.2 where
  // the truth is 9. A WRONG ANSWER, not a refusal, which is the one outcome
  // this module exists to prevent. Resolving the unknown first means every
  // inversion operates on a single token: a number, `n`, or a parenthesised
  // multiple of n.
  const ART = String.raw`(?:(?:an?|the|some) )?`;
  const UNK = String.raw`(?:unknown )?number`;
  s = s.replace(new RegExp(`\\btwice ${ART}${UNK}\\b`, "g"), "(2*n)");
  s = s.replace(new RegExp(`\\bdouble ${ART}${UNK}\\b`, "g"), "(2*n)");
  s = s.replace(new RegExp(`\\bthrice ${ART}${UNK}\\b`, "g"), "(3*n)");
  s = s.replace(new RegExp(`\\bhalf (?:of )?${ART}${UNK}\\b`, "g"), "(n/2)");
  s = s.replace(new RegExp(`([\\d.]+) times ${ART}${UNK}\\b`, "g"), "($1*n)");
  s = s.replace(new RegExp(`\\bmultiply ${ART}${UNK} by ([\\d.]+)`, "g"), "($1*n)");
  s = s.replace(new RegExp(`\\bdivide ${ART}${UNK} by ([\\d.]+)`, "g"), "(n/$1)");
  s = s.replace(new RegExp(`\\b${ART}${UNK}\\b`, "g"), "n");

  // INVERTING PHRASES, now that both operands are single tokens. "5 less than
  // x" is x - 5, not 5 - x; getting this backwards yields a plausible wrong
  // answer rather than a refusal, which is why it is pinned by test.
  const TOK = String.raw`(\([^()]*\)|n|[\d.]+)`;
  s = s.replace(new RegExp(`${TOK} less than ${TOK}`, "g"), "$2 - $1");
  s = s.replace(new RegExp(`${TOK} more than ${TOK}`, "g"), "$2 + $1");
  s = s.replace(new RegExp(`${TOK} (?:is |are )?subtracted from ${TOK}`, "g"), "$2 - $1");
  s = s.replace(new RegExp(`${TOK} (?:is |are )?added to ${TOK}`, "g"), "$2 + $1");
  s = s.replace(new RegExp(`\\bsubtracting ${TOK} from ${TOK}`, "g"), "$2 - $1");
  s = s.replace(new RegExp(`\\badding ${TOK} to ${TOK}`, "g"), "$2 + $1");

  // Remaining operators.
  s = s.replace(/\b(plus|increased by|and)\b/g, "+");
  s = s.replace(/\b(minus|decreased by|reduced by)\b/g, "-");
  s = s.replace(/\b(times|multiplied by|of)\b/g, "*");
  s = s.replace(/\b(divided by|over)\b/g, "/");
  s = s.replace(/\b(is|are|equals?|gives?)\b/g, "=");
  s = s.replace(/\ban?\b|\bthe\b/g, " ");
  s = s.replace(/,/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // WHAT REMAINS MUST BE A CLEAN EQUATION. A leftover word means the sentence
  // said something this translator does not model, and the honest answer is no
  // answer — a half-understood problem produces a confident wrong number.
  if (!/=/.test(s)) return null;
  if (!/n/.test(s)) return null;
  if (/[a-z]/.test(s.replace(/n/g, ""))) return null;
  if ((s.match(/=/g) ?? []).length !== 1) return null;
  // A stray inversion keyword left behind means the operands were not what the
  // patterns above expected; refuse rather than solve a mangled expression.
  if (/(?:less|more|subtract|add)/.test(s)) return null;

  const r = solveEquation(s, "n");
  if (!r || !r.roots.length || r.method === "unsolved") return null;
  const real = r.roots.filter((x) => x.im === 0);
  if (!real.length) return null;
  const v = real[0].re;
  return {
    template: "linear number sentence",
    answer: fmt(v),
    value: v,
    equation: s,
    equationMath: s.replace(/\*/g, " \\cdot "),
    steps: [`Translated to: ${s}`, `Solving gives n = ${fmt(v)}`],
    caveats: [
      "The equation above is this parser's reading of your sentence. Check it says what you meant — " +
        "a mis-read sentence produces a confident wrong answer.",
    ],
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


/**
 * The RUNNING-TOTAL shape: an unknown starting amount, a sequence of gains and
 * losses, and a stated final amount.
 *
 *   "There were some people on a train. 19 people get off at the first stop.
 *    17 people get on. Now there are 63 people on the train.
 *    How many were on the train to begin with?"
 *
 * This is the shape a real user brought, and it is not a number sentence: the
 * unknown is never named ("some people"), the operations arrive as separate
 * sentences, and the comparison is "now there are N".
 *
 * WHY IT IS A SEPARATE RECOGNISER rather than more vocabulary in the
 * translator: the direction of each event is carried by a VERB against a
 * container ("get off the train" is a loss, "get on" is a gain), not by an
 * arithmetic word. Folding that into the phrase-substitution pass would make
 * "off" mean minus everywhere, which is wrong the moment a problem says
 * "10% off".
 *
 * It refuses unless it finds an unknown start, at least one event, and exactly
 * one final total — and it shows the equation it built, so a misread is
 * visible next to the answer rather than hidden behind it.
 */
function tryRunningTotal(text: string): WordProblemResult | null {
  const t = normalize(text).replace(/\n/g, " ");
  // An unknown start must be stated, not assumed. Without this a problem that
  // merely ends in "now there are 63" would be "solved" from nothing.
  if (!/\b(some|a number of|an unknown number of)\b/.test(t)) return null;
  const finalMatch = /\b(?:now|finally|at the end)\b[^.]*?\bthere (?:are|were)\s+(\d+(?:\.\d+)?)/.exec(t);
  if (!finalMatch) return null;
  const finalValue = Number(finalMatch[1]);
  if (!Number.isFinite(finalValue)) return null;

  // Events, in the order written. "get off / leave / exit" lose; "get on /
  // board / join / arrive" gain.
  const LOSS = /(\d+(?:\.\d+)?)\s+[a-z ]*?\b(?:get off|got off|gets off|leave|left|leaves|exit|exits|exited|step off)\b/g;
  const GAIN = /(\d+(?:\.\d+)?)\s+[a-z ]*?\b(?:get on|got on|gets on|board|boards|boarded|join|joins|joined|step on)\b/g;
  const events: { at: number; delta: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = LOSS.exec(t)) !== null) events.push({ at: m.index, delta: -Number(m[1]) });
  while ((m = GAIN.exec(t)) !== null) events.push({ at: m.index, delta: Number(m[1]) });
  if (!events.length) return null;
  if (events.some((e) => !Number.isFinite(e.delta))) return null;
  events.sort((a, b) => a.at - b.at);

  // start + sum(deltas) = final
  const net = events.reduce((a, e) => a + e.delta, 0);
  const start = finalValue - net;
  const eqn =
    "x " + events.map((e) => (e.delta < 0 ? `- ${Math.abs(e.delta)}` : `+ ${e.delta}`)).join(" ") + ` = ${finalValue}`;
  return {
    template: "running total",
    answer: fmt(start),
    value: start,
    equation: eqn,
    equationMath: eqn,
    steps: [
      `Let x be the amount at the start.`,
      `Translated to: ${eqn}`,
      `Net change = ${fmt(net)}, so x = ${fmt(finalValue)} - (${fmt(net)}) = ${fmt(start)}`,
    ],
    caveats: [
      "The equation above is this parser's reading of your problem, taken from the order the " +
        "events are written in. Check it before relying on the number.",
    ],
  };
}

export function solveWordProblem(text: string): WordProblemResult | null {
  const t = normalize(text);
  if (!t) return null;
  // ORDER MATTERS: the most specific grammar first. A running-total problem
  // contains numbers that a percentage or rate-time pattern could latch onto,
  // and the first recogniser to claim a problem wins.
  return (
    tryShareSequence(text) ??
    tryRunningTotal(text) ??
    tryPercentage(t) ??
    tryDistanceRateTime(t) ??
    tryNumberSentence(t)
  );
}
