// Successive-share problems: a quantity handed out in order, where each
// recipient takes a percentage of what is left when they arrive.
//
//   "A pie is divided among 100 guests. Guest 1 gets 1%, guest 2 gets 2% of
//    what's left, and so on. Who gets the largest piece?"
//
// This is a recurrence, not an equation, which is why the equation solver could
// not touch it. The answer is not the obvious one — pieces grow for a while
// because k rises faster than the remainder falls, then shrink once the
// remainder collapses — so a user cannot eyeball it either, and the derivation
// is the part worth showing.
//
// Kept separate from wordproblem.ts because it needs a model (a sequence and a
// ratio test) rather than a pattern-to-equation translation.

export type ShareQuestion = "largest" | "smallest" | "share" | "remaining";

export interface ShareProblem {
  /** How many recipients, in order. */
  n: number;
  /** Percentage recipient k takes, as a fraction of the base. Default k/100. */
  ofRemainder: boolean;
  question: ShareQuestion;
  /** For "share": which recipient the question asks about. */
  which?: number;
  /** What is being divided, for readable output ("pie", "cake", "estate"). */
  subject: string;
  /** What the recipients are called ("guest", "person"). */
  recipient: string;
}

/** One line of working: prose, a formula in the pane's math DSL, or both. */
export interface ShareWorkStep {
  text?: string;
  math?: string;
}

export interface ShareSolution {
  answer: string;
  value: number;
  /** Fraction of the whole received by each recipient, index 0 = recipient 1. */
  pieces: number[];
  largest: { k: number; fraction: number };
  smallest: { k: number; fraction: number };
  /** Fraction of the whole still undistributed after everyone has taken theirs. */
  remaining: number;
  steps: string[];
  /** The same working with formulae kept as DSL, for typeset rendering. */
  work: ShareWorkStep[];
  caveats: string[];
}

const pct = (x: number, dp = 4): string => `${(x * 100).toFixed(dp)}%`;

/**
 * Computes every share exactly, then explains the turning point with a ratio
 * test rather than just reporting the argmax of a loop — "guest 10" on its own
 * is an assertion; the ratio test is a reason.
 */
export function solveShares(p: ShareProblem): ShareSolution {
  const n = p.n;
  const pieces: number[] = [];
  let remaining = 1;

  for (let k = 1; k <= n; k++) {
    const rate = k / 100;
    const piece = p.ofRemainder ? remaining * rate : rate;
    pieces.push(piece);
    remaining -= piece;
  }
  if (remaining < 0) remaining = 0;

  let largest = { k: 1, fraction: pieces[0] ?? 0 };
  let smallest = { k: 1, fraction: pieces[0] ?? 0 };
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i] > largest.fraction) largest = { k: i + 1, fraction: pieces[i] };
    if (pieces[i] < smallest.fraction) smallest = { k: i + 1, fraction: pieces[i] };
  }

  const R = p.recipient;
  const steps: string[] = [];
  const work: ShareWorkStep[] = [];
  const caveats: string[] = [];

  // One source for both renderings so they cannot drift: `math` is the pane's
  // formula DSL (typeset in the pane), `plain` is the same thing as text (what
  // gets inserted into the document).
  const add = (text?: string, math?: string, plain?: string): void => {
    work.push({ text, math });
    steps.push([text, plain ?? math].filter(Boolean).join(" ").trim());
  };

  if (p.ofRemainder) {
    add(`Take the whole ${p.subject} as 1. ${cap(R)} k takes k% of whatever is still undivided when they arrive.`);
    add(
      `Left before ${R} k:`,
      "R(k) = prod(i=1, k-1, (1 - i/100))",
      "R(k) = (1 - 1/100)(1 - 2/100)...(1 - (k-1)/100)",
    );
    add(`${cap(R)} k's share:`, "P(k) = (k/100)*R(k)", "P(k) = (k/100) x R(k)");
    add("Compare neighbours:", "P(k+1)/P(k) = ((k+1)/k)*(1 - k/100)", "P(k+1)/P(k) = ((k+1)/k) x (1 - k/100)");
    add("That ratio equals 1 when", "k^2 + k - 100 = 0", "k^2 + k - 100 = 0");
    add("Positive root:", `k = (-1 + sqrt(401))/2 = ${KSTAR.toFixed(4)}`, `k = (-1 + sqrt(401))/2 = ${KSTAR.toFixed(4)}`);
    add(
      `So each share is bigger than the last while k < ${KSTAR.toFixed(2)}, and smaller after — the shares rise to a single peak, then fall.`,
    );
    add(`The peak is the whole number just above that root: k = ${Math.ceil(KSTAR)}.`);
    const k = largest.k;
    const near = [k - 1, k, k + 1].filter((j) => j >= 1 && j <= n);
    add(`Check either side: ${near.map((j) => `${R} ${j} = ${pct(pieces[j - 1])}`).join(", ")}.`);
    caveats.push(
      "Each share is computed exactly from the recurrence, not estimated — the percentages are the real values, rounded only for display.",
    );
    if (n > 100) {
      caveats.push(
        "Beyond the 100th recipient the stated rule would take more than 100% of the remainder; shares are reported only up to that point.",
      );
    }
  } else {
    add(`Take the whole ${p.subject} as 1. ${cap(R)} k takes k% of the ORIGINAL amount, not of the remainder.`);
    add(`${cap(R)} k's share:`, "P(k) = k/100", "P(k) = k/100");
    add("That rises with every recipient, so the last one gets the most.");
    add(`Total handed out: ${pct(1 - remaining, 2)} of the ${p.subject}.`);
    if (remaining <= 0) {
      caveats.push(
        `The shares add up to more than the whole ${p.subject} — with this rule the ${p.subject} runs out before everyone is served.`,
      );
    }
  }

  let answer: string;
  let value: number;
  switch (p.question) {
    case "largest":
      answer = `${cap(R)} ${largest.k} gets the largest share — ${pct(largest.fraction)} of the ${p.subject}.`;
      value = largest.k;
      break;
    case "smallest":
      answer = `${cap(R)} ${smallest.k} gets the smallest share — ${pct(smallest.fraction)} of the ${p.subject}.`;
      value = smallest.k;
      break;
    case "share": {
      const w = Math.min(Math.max(p.which ?? 1, 1), n);
      answer = `${cap(R)} ${w} gets ${pct(pieces[w - 1])} of the ${p.subject}.`;
      value = pieces[w - 1];
      break;
    }
    case "remaining":
    default:
      answer = `${pct(remaining)} of the ${p.subject} is left undivided.`;
      value = remaining;
      break;
  }

  return { answer, value, pieces, largest, smallest, remaining, steps, work, caveats };
}

/** The positive root of k² + k − 100 = 0, where consecutive shares are equal. */
const KSTAR = (-1 + Math.sqrt(401)) / 2;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SUBJECTS = "pie|cake|pizza|estate|inheritance|fortune|prize|pot|sum|amount|money|chocolate|bar";
const RECIPIENTS = "guests?|people|persons?|friends?|children|kids|students?|heirs?|players?|winners?";

/**
 * Recognises the successive-share shape. Deliberately narrow: it must see a
 * recipient count, a k% rule, and a question it can answer. Anything else
 * returns null so the caller says it cannot parse rather than guessing.
 */
export function parseShareProblem(text: string): ShareProblem | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;

  // How many recipients?
  const nMatch =
    new RegExp(`(\\d+)\\s+(?:${RECIPIENTS})`).exec(t) ??
    new RegExp(`(?:among|between|to|across)\\s+(\\d+)`).exec(t);
  if (!nMatch) return null;
  const n = parseInt(nMatch[1], 10);
  if (!Number.isFinite(n) || n < 2 || n > 10000) return null;

  // The k% rule. Needs at least two ordinal shares to establish "and so on",
  // e.g. "guest 1 gets 1%, guest 2 gets 2%".
  const rule = /\b1\s*%[^.]*?\b2\s*%/.test(t) || /(?:k|n|i)\s*%/.test(t);
  if (!rule) return null;

  // Of the remainder, or of the original?
  const ofRemainder =
    /(?:what(?:'s| is)? (?:left|remaining)|the remainder|what remains|remaining|left over|still left)/.test(t);

  // Which question?
  let question: ShareQuestion;
  let which: number | undefined;
  const shareOf = /(?:how much does|what does)\s+(?:\w+\s+)?(\d+)\s+(?:get|receive)/.exec(t);
  if (/(?:largest|biggest|most|greatest|largest piece|biggest piece)/.test(t)) question = "largest";
  else if (/(?:smallest|least|tiniest)/.test(t)) question = "smallest";
  else if (shareOf) {
    question = "share";
    which = parseInt(shareOf[1], 10);
  } else if (/(?:left over|how much (?:is )?(?:left|remains)|undivided)/.test(t)) question = "remaining";
  else return null;

  const subject = new RegExp(`\\b(${SUBJECTS})\\b`).exec(t)?.[1] ?? "whole";
  const recipient = (new RegExp(`\\b(${RECIPIENTS})\\b`).exec(t)?.[1] ?? "recipient")
    .replace(/s$/, "")
    .replace(/^people$/, "person")
    .replace(/^childre$/, "child")
    .replace(/^kid$/, "kid");

  return { n, ofRemainder, question, which, subject, recipient };
}
