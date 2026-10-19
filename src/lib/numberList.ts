/**
 * A TYPED list of numbers ("1,5 2,3 3,1", "1, 2, 3", "4;5;6") → numbers, under
 * the SAME comma rule the table feed applies to a cell (parseCellNumber in
 * dataimport.ts). One rule, one function: the typed fields must not invent a
 * second parser.
 *
 * WHY THIS EXISTS. The Stats fields split on /[\s,]+/, so "1,5 2,3 3,1" typed
 * into Mann–Whitney became SIX values (1, 5, 2, 3, 3, 1) and a confident U on
 * data nobody had — while the same numbers pasted as a Word table were read as
 * 1.5, 2.3, 3.1. statDroppedTokens could not see it, because every token was a
 * number. (Audit, docs/SCOPE-STATS-BATCH.md §A WRONG 8.)
 *
 * THE RULE — the comma's role is decided for the WHOLE field, from how the
 * user separated the values:
 *   - A comma followed by whitespace is a separator, always ("1, 5" is a list).
 *   - Whitespace and semicolons are separators.
 *   - If the field is ONE run with no whitespace/semicolon separator at all
 *     ("1,2,3", "12,15"), the commas ARE the separators — that is how a typed
 *     comma list looks, and it is the shape of the calculators' defaults.
 *   - If any run holds two or more commas ("1,2,3 4,5,6"), the user is
 *     comma-listing: commas are separators everywhere in the field.
 *   - Otherwise (values separated by spaces/semicolons, at most one comma
 *     each) each value is read as a table CELL: "1,5" → 1.5 (decimal comma),
 *     "1,200" → 1200 (three digits after the comma: thousands), "1.000,5" →
 *     1000.5 — exactly as parseCellNumber reads it.
 * The reading reports how many decimal commas it read, so the caller can SAY
 * so ("1,5 read as 1.5") — a typed comma is never read silently.
 */
import { parseCellNumber, isDecimalComma, SCI_TAIL } from "./dataimport";

export interface NumberListReading {
  values: number[];
  /** Tokens that are not numbers, in order (a caller warns about these). */
  dropped: string[];
  /** "separator": commas split values; "cell": each value read by the cell rule. */
  commaMode: "separator" | "cell";
  /** How many values were decimal-comma numbers read as decimals. */
  decimalCommas: number;
  /** The first such value as typed, for the note ("1,5"). */
  example?: string;
  /** Three-digit comma values ("1,250") read as DECIMALS because the field elsewhere proves a decimal comma. */
  reread?: string[];
}

/** Whitespace (not the no-break spaces parseCellNumber reads as digit grouping), semicolons, and ", ". */
const SEP = /,?[ \t\r\n\f\v;]+,?|,(?=[ \t\r\n\f\v])/;

/**
 * "1.5 × 10⁻⁵" → "1.5×10⁻⁵" before the field is split on whitespace: spaced, the
 * one number was THREE tokens, and the list silently held 1.5. Joined only
 * when "10" is followed by an exponent (^ or a superscript), so "2 × 3" and
 * "2 x 10" stay apart.
 */
const SPACED_SCI = /(\d)[ \t]*([×xX·])[ \t]*10[ \t]*(?=\^|[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹])/g;

/**
 * `cells`: the comma's role was already decided for a larger field (one group or row of a Stats field read
 * as decimal commas), so this text is read as cells even when it is one run — "3,5" alone is 3.5, not 3
 * and 5. (A lone group or a one-column table in a decimal-comma field split in two: v2.160.0.)
 */
export function readNumberList(text: string, opts: { cells?: boolean } = {}): NumberListReading {
  const runs = text
    .replace(SPACED_SCI, (_m, d: string, times: string) => `${d}${times}10`)
    .replace(/\^[ \t]+/g, "^")
    .split(SEP)
    .map((t) => t.replace(/^,+|,+$/g, ""))
    .filter((t) => t !== "");
  const commaListing = !opts.cells && (runs.length <= 1 || runs.some((t) => (t.match(/,/g) ?? []).length >= 2));
  const tokens = commaListing ? runs.flatMap((t) => t.split(",")).filter((t) => t !== "") : runs;
  // WHOLE-FIELD decision (the independent review: "1,250 2,5 3,75" was read
  // as [1250, 2.5, 3.75]). Once any value PROVES the comma is decimal (2,5 —
  // not three digits after it), a three-digit "1,250" in the same field is
  // 1.25 too: a field writing decimal commas does not also write thousands
  // commas. Said through `reread`.
  // A scientific-notation token's comma is its MANTISSA's ("1,5×10⁻⁵").
  const mantissa = (t: string): string => t.trim().replace(SCI_TAIL, "");
  const decimalField = !commaListing && tokens.some((t) => isDecimalComma(mantissa(t)));
  const THOUSANDS_SHAPE = /^([-−–]?\d{1,3}),(\d{3})(%?)$/;
  const GERMAN = /^[-−–]?\d{1,3}(\.\d{3})+,\d+%?$/;
  const values: number[] = [];
  const dropped: string[] = [];
  const reread: string[] = [];
  let decimalCommas = 0;
  let example: string | undefined;
  for (const t of tokens) {
    // The shape is tested on the MANTISSA, so "1,250×10³" in a decimal-comma
    // field is 1.25×10³, not 1250×10³ (a silent 1000× error).
    const m = mantissa(t);
    const asDecimal = decimalField && THOUSANDS_SHAPE.test(m);
    const v = asDecimal ? parseCellNumber(m.replace(THOUSANDS_SHAPE, "$1.$2$3") + t.trim().slice(m.length)) : parseCellNumber(t);
    if (!Number.isFinite(v)) {
      dropped.push(t);
      continue;
    }
    values.push(v);
    if (!commaListing && (isDecimalComma(mantissa(t)) || asDecimal || GERMAN.test(t.trim()))) {
      decimalCommas++;
      if (example === undefined) example = t;
      if (asDecimal) reread.push(t);
    }
  }
  return { values, dropped, commaMode: commaListing ? "separator" : "cell", decimalCommas, example, reread };
}

/** "2 decimal commas read as decimals (1,5 → 1.5)." — or "" when none were. */
export function decimalCommaNote(r: NumberListReading): string {
  if (!r.decimalCommas || r.example === undefined) return "";
  const n = r.decimalCommas;
  const reread = r.reread ?? [];
  const first = reread.includes(r.example) ? r.example.trim().replace(",", ".") : r.example;
  // "1,5×10⁻⁵ → 1.5×10⁻⁵": String() of the value would print 1.5e-7 for a small one.
  const ex = r.example.trim();
  const shown = SCI_TAIL.test(ex) && !ex.replace(SCI_TAIL, "").includes(".") ? r.example.trim().replace(",", ".") : String(parseCellNumber(first));
  return (
    `${n} decimal comma${n === 1 ? "" : "s"} read as decimal${n === 1 ? "" : "s"} (${r.example} → ${shown}).` +
    (reread.length
      ? ` ${reread.join(", ")} read as ${reread.map((t) => parseCellNumber(t.trim().replace(",", "."))).join(", ")}, not thousands, ` +
        "because this field writes decimal commas."
      : "")
  );
}

/**
 * ONE typed number from a single-value field, under the same cell rule as a
 * list ("−16,3" → −16.3, "1,250" → 1250, "+4" → 4, U+2212 accepted). `strip`
 * removes a label a person naturally types with the value ("LUFS", "dB",
 * "ISO", "f/") before reading it. Blank or unreadable → NaN, so a caller can
 * refuse by name instead of computing on Number("") = 0.
 */
export function fieldNumber(text: string, strip?: RegExp): number {
  let t = (text ?? "").trim();
  if (strip) t = t.replace(strip, "").trim();
  t = t.replace(/^\+/, "").replace(/^−/, "-");
  if (!t) return NaN;
  const plain = Number(t);
  if (Number.isFinite(plain) && !t.includes(",")) return plain;
  return parseCellNumber(t);
}

/**
 * The display contract's minus: a hyphen-minus used as a numeric SIGN
 * (" -3.9", "(-1", "= -7.7") becomes U+2212. Hyphens inside words and ranges
 * ("0-based", "10-bit", "true-peak") are left alone. Non-strings pass through,
 * so a list of report lines (text or typeset formulas) maps in one call.
 */
export function trueMinus<T>(line: T): T {
  if (typeof line !== "string") return line;
  return line.replace(/(^|[\s(=,;:[/×])-(?=\.?\d)/g, "$1−") as unknown as T;
}
