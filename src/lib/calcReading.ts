/**
 * The plain-language reading of a Finance or Statistics result: one or two sentences that say what the numbers MEAN,
 * shown first in the pane (bold) and inserted as the first paragraph (FinResult.reading, StatOutput.reading).
 *
 * WHY. The newer calculators opened with their method — likelihoods, conventions, the reference package — and the
 * user read them as "nothing but a table". The numbers stay as they are; the reading is added in front of them.
 *
 * THE RULES (checked by readingProblems for every calculator on its defaults, and by the pane audit):
 *  - Built from the computed values of THIS run, never hard-coded: a different input gives a different sentence, and
 *    the wording follows the result (significant or not, above or below parity, profitable or not).
 *  - The headline number with its unit, then what it means for the decision a reader faces. Plain words: a patent
 *    lawyer, a student or a client reads it without the method.
 *  - One or two sentences, at most READING_MAX characters, ending in a full stop.
 *  - No method notes (those stay in the text below): no package names, no "Conventions".
 *  - The display contract holds: Unicode typesetting (R², χ², 10⁻⁴, ×), no em dash (the no-value sentinel), no
 *    NaN/Infinity, no ASCII exponents.
 *  - Hedged where the method is: a test "finds no evidence", it does not "prove" equality; an estimate is "about".
 *  - A refusal carries no reading.
 */
import { insertableResultText } from "./insertGate";

export const READING_MAX = 320;

const METHOD_WORDS = /\b(Conventions?|statsmodels|linearmodels|QuantLib|scipy|SciPy|PyPortfolioOpt|arch package|R package)\b/;

/** What is wrong with a reading, as sentences; empty when it keeps the rules above. */
export function readingProblems(reading: string | undefined): string[] {
  const out: string[] = [];
  const r = (reading ?? "").trim();
  if (!r) return ["no reading"];
  if (r.length > READING_MAX) out.push(`longer than ${READING_MAX} characters (${r.length})`);
  // Sentences end at . ! ? followed by a space and a capital; decimals (0.05) and initials (U.S.) do not split.
  const sentences = r.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > 2) out.push(`more than two sentences (${sentences.length})`);
  if (!/[.!?]$/.test(r)) out.push("does not end with a full stop");
  if (r.includes("—")) out.push("contains an em dash (the no-value sentinel)");
  if (/\b(NaN|Infinity|undefined|null)\b/.test(r)) out.push("contains a non-number word");
  if (/\^/.test(r)) out.push("contains an ASCII exponent (^)");
  if (/\d[eE][+-]?\d/.test(r)) out.push("contains computer scientific notation (1e-5)");
  if (METHOD_WORDS.test(r)) out.push("contains a method note");
  if (!insertableResultText(r)) out.push("fails the insert gate");
  return out;
}
