/**
 * The list fields of the Finance and Bio/Assay calculators ("Cash flows", "[S] substrate"), read under the
 * PRODUCT comma rule (numberList.ts) like every Stats field.
 *
 * WHY THIS EXISTS. Both calculators split on /[\s,;]+/ and dropped whatever was not a number: "1,5 2,3"
 * typed as decimal commas became four values, and "1O0" (a letter O) vanished from a cash-flow list with
 * nothing on screen to say so — an NPV on flows nobody typed. (Host-adapter audit, docs/SCOPE-HOST-ADAPTER.md §E.)
 * A token that is not a number is now refused by name, and a decimal comma read as one is said.
 */
import { decimalCommaNote, readNumberList, semicolonCommaRefusal } from "./numberList";

/** A list field holds something that is not a number (the message names it). */
export class ListTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListTokenError";
  }
}

/**
 * One value between semicolons or ", " that is a number grouped in thousands with plain spaces ("−1 000",
 * "3 500 000"). The space also separates list values, so "−1 000; 300; 400" was read as −1, 0, 300, 400,
 * silently (F1 builder B, 2026-10-27). No-break spaces are not matched: parseCellNumber reads those as grouping.
 */
const SPACE_GROUPED = /^[-−–+]?\d{1,3}([ \t]\d{3})+([.,]\d+)?%?$/;

function spaceGroupedRefusal(text: string): string | null {
  if (!/;|,[ \t]/.test(text)) return null;
  const hit = text
    .split(/;|,[ \t]+/)
    .map((s) => s.trim())
    .find((s) => SPACE_GROUPED.test(s));
  if (!hit) return null;
  return `“${hit}” reads two ways: one number grouped in thousands with spaces (${hit.replace(/[ \t]/g, "")}), or the numbers ${hit.split(/[ \t]+/).join(", ")}. Write the number without spaces (${hit.replace(/[ \t]/g, "")}).`;
}

/** The numbers of one list field and the sentence about its decimal commas ("" when none were read). */
export function readCalcList(text: string): { values: number[]; note: string } {
  // "0,5;1,5;2,5" is 0.5, 1.5, 2.5 or six values: asked, not guessed (user decision 2026-10-21).
  const ambiguous = semicolonCommaRefusal(text, "numbers") || spaceGroupedRefusal(text);
  if (ambiguous) throw new ListTokenError(ambiguous);
  const r = readNumberList(text);
  if (r.ambiguous) throw new ListTokenError(r.ambiguous);
  if (r.dropped.length) {
    const shown = r.dropped.slice(0, 3).map((t) => `“${t}”`).join(", ") + (r.dropped.length > 3 ? ` and ${r.dropped.length - 3} more` : "");
    throw new ListTokenError(`${shown} ${r.dropped.length === 1 ? "is not a number" : "are not numbers"} — a list takes numbers separated by commas, spaces or semicolons.`);
  }
  return { values: r.values, note: decimalCommaNote(r) };
}
