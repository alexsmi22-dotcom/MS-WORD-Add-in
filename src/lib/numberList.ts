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
/** A no-break or narrow no-break space before % (built from char codes: an invisible literal is unreviewable). */
const NBSP_PERCENT = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]+%`, "g");

const SPACED_SCI =/(\d)[ \t]*([×xX·])[ \t]*10[ \t]*(?=\^|[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹])/g;

/**
 * `cells`: the comma's role was already decided for a larger field (one group or row of a Stats field read
 * as decimal commas), so this text is read as cells even when it is one run — "3,5" alone is 3.5, not 3
 * and 5. (A lone group in a decimal-comma field split in two: v2.160.0.) `decimalField`: that larger field
 * proved a decimal comma, so a three-digit "1,250" here is 1.25 as it would be in the field — read alone it
 * was 1250, silently (v2.160.0 review).
 */
export function readNumberList(text: string, opts: { cells?: boolean; decimalField?: boolean } = {}): NumberListReading {
  const runs = text
    // "1,5 %" with a no-break (or narrow no-break) space is the value 1,5%: joined first, so the comma decision sees
    // the same token the cell reader reads ("9,350 2,5 %" was 9350, with the plain % 9.35: v2.176.1 review 4).
    .replace(NBSP_PERCENT, "%")
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
  const decimalField = !commaListing && (!!opts.decimalField || tokens.some((t) => isDecimalComma(mantissa(t))));
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
  // Plain digits, never String()'s exponent ("0,0000001 → 1e-7"), and a true minus (the note goes into documents).
  const plain = (v: number): string => trueMinus(v.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 15 }));
  const shown = SCI_TAIL.test(ex) && !ex.replace(SCI_TAIL, "").includes(".") ? trueMinus(r.example.trim().replace(",", ".")) : plain(parseCellNumber(first));
  return (
    `${n} decimal comma${n === 1 ? "" : "s"} read as decimal${n === 1 ? "" : "s"} (${r.example} → ${shown}).` +
    (reread.length
      ? ` ${reread.join(", ")} read as ${reread.map((t) => plain(parseCellNumber(t.trim().replace(",", ".")))).join(", ")}, not thousands, ` +
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

/**
 * A number in plain digits: the shortest form that reads back to it (String's), with any exponent written out,
 * and a true minus (the refusal below shows numbers the user is told to type).
 */
function plainDigits(v: number): string {
  let s = String(Math.abs(v));
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m) {
    const digits = m[1] + (m[2] ?? "");
    const e = Number(m[3]);
    s = e < 0 ? `0.${"0".repeat(-e - 1)}${digits}` : digits + "0".repeat(Math.max(0, e - (m[2]?.length ?? 0)));
  }
  return (v < 0 || Object.is(v, -0) ? "−" : "") + s;
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺",
};

/** A typed tail as the display contract writes it: "x10^-3", " × 10 ^ 3" → "×10⁻³", "×10³"; " %" → "%". */
function tidyTail(t: string): string {
  const s = t.replace(/\s+/g, "");
  const m = /^[×xX·]10(?:\^([-+−–]?\d+)|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/.exec(s);
  if (!m) return s;
  // A plus on an exponent is not written: ×10⁴, not ×10⁺⁴.
  if (m[2]) return `×10${m[2].replace(/^⁺/, "")}`;
  return `×10${[...m[1].replace(/^[−–]/, "-").replace(/^\+/, "")].map((c) => SUPERSCRIPT[c] ?? c).join("")}`;
}

/** A typed sign as the display contract's: "-0,5", "–0,5" → "−0,5". */
const signed = (s: string): string => s.replace(/^[-–]/, "−");

/**
 * A field of semicolon-separated values with one comma each ("0,5;1,5;2,5") can be read two ways: as the
 * decimal-comma numbers 0.5; 1.5; 2.5, or as values the commas separate (0 and 5; 1 and 5; 2 and 5). The readers
 * disagreed in silence: a Stats group field took the pairs, a list field the decimals. The user chose to be asked
 * (2026-10-21), so this returns the refusal that names both readings and how to type each, or "" when the field is
 * not of that shape. `as`: "numbers" for a list field (the separated reading is one list), "groups" for a field of
 * groups, split as its reader (statGroups) splits: at semicolons and blank lines. Fields whose rows need two or more
 * values (survival time,event rows, regression rows, subjects, counts) are NOT asked: the pairs are their only
 * reading (the caller does not call this for them).
 * Not asked: values separated by spaces or single line breaks ("1,5 2,5" proves decimal commas), a comma then a space
 * ("0, 5; 1, 5" is a separator), two commas in a piece ("1,2,3;4,5,6" is comma-listing), a dot before the comma
 * ("1.000,5" proves it decimal), and a LIST of thousands ("-10,000; 2,500": semicolons are how such a list is typed,
 * and "000" is no value anyone types; v2.176.0 review 2).
 * Every number in the message is shown as typed (the comma turned into a point), so no digit is lost or rounded;
 * a ×10ⁿ or % tail is written as the display contract writes it (v2.176.1 review 3).
 */
export function semicolonCommaRefusal(text: string, as: "numbers" | "groups"): string {
  const between = as === "groups" ? /\n\s*\n|;/ : /;/;
  if (!between.test(text)) return "";
  const pieces = text
    .split(between)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  // The comma is judged on the MANTISSA: "1,5%" and "1,5×10⁻³" are the same question as "1,5" (\s covers the
  // no-break space the reader accepts before %).
  const mant = (p: string): string => p.replace(SCI_TAIL, "").replace(/\s*%$/, "");
  const tail = (p: string): string => tidyTail(p.slice(mant(p).length));
  const ONE_COMMA = /^[-−–]?\d+,\d+$/;
  // "1.000,5" proves a decimal comma to the LIST reader (1000.5), but the group reader reads a one-value group as a
  // comma list (1.000 and 5): in a group field it is the same question (v2.176.1 review 4).
  const DOT_COMMA = /^[-−–]?\d{1,3}(\.\d{3})+,\d+$/;
  const oneComma = (p: string): boolean => ONE_COMMA.test(mant(p)) || (as === "groups" && DOT_COMMA.test(mant(p)));
  // Any other piece is a plain number in any shape the reader accepts (1e5, 10³, +2), with no comma and no space.
  const plain = (p: string): boolean => !p.includes(",") && !/\s/.test(p) && Number.isFinite(parseCellNumber(p));
  if (pieces.length < 2 || !pieces.every((p) => oneComma(p) || plain(p)) || !pieces.some(oneComma)) return "";
  const cells = readNumberList(pieces.join(";"));
  if (cells.dropped.length || cells.values.length !== pieces.length) return "";
  // The mantissas under the WHOLE field's comma ruling (a field that proves a decimal comma reads 1,250 as 1.25).
  const mantissas = readNumberList(pieces.map(mant).join(";"));
  if (mantissas.dropped.length || mantissas.values.length !== pieces.length) return "";
  if (as === "numbers" && mantissas.decimalCommas === 0) return "";
  // The decimal reading of piece i, as typed: "0,10" → 0.10, "1,250" in a decimal field → 1.250; thousands
  // ("1,250" → 1250) and plain pieces in their plain digits.
  const asCell = (i: number): string => {
    const m = mant(pieces[i]);
    const dotted = m.replace(",", ".");
    const v = mantissas.values[i];
    const shownM = m.includes(",") && Number(dotted.replace(/^[−–]/, "-")) === v ? signed(dotted) : plainDigits(v);
    return `${shownM}${tail(pieces[i])}`;
  };
  // A piece split at its comma, each part as the reader reads it ("0,05" → 0 and 5, "1,5%" → 1 and 5%), in the
  // digits typed (leading zeros dropped).
  const split = (p: string): string[] => {
    const i = p.indexOf(",");
    if (i < 0) {
      const m = mant(p);
      return [`${/^[-−–]?\d+(\.\d+)?$/.test(m) ? signed(m) : plainDigits(parseCellNumber(m))}${tail(p)}`];
    }
    // Integer parts in the digits typed (leading zeros dropped); a dotted part ("1.000" of "1.000,5") as read.
    const int = (x: string): string =>
      /^[-−–]?\d+$/.test(x) ? signed(x.replace(/^([-−–]?)0+(?=\d)/, "$1")) : plainDigits(parseCellNumber(x));
    const rest = p.slice(i + 1);
    return [int(p.slice(0, i)), `${int(mant(rest))}${tail(rest)}`];
  };
  const shown = (s: string[], sep: string): string => (s.length > 4 ? `${s.slice(0, 3).join(sep)}${sep}…` : s.join(sep));
  const asCells = shown(pieces.map((_p, i) => asCell(i)), "; ");
  const n = pieces.length;
  // A blank line between groups is shown, not flattened into the space that would read as one group.
  const flat = text.trim().replace(/\n\s*\n/g, " ⏎ ").replace(/\s+/g, " ");
  const typed = flat.length > 40 ? `${flat.slice(0, 37)}…` : flat;
  const at = pieces.findIndex(oneComma);
  const pairs = `a comma then a space (${split(pieces[at]).join(", ")})`;
  if (as === "groups") {
    // Read as decimals, every group here holds ONE value — not what ANOVA, Tukey or Dunnett can be given — so the
    // advice shows how decimals are typed in a group field, not a lone value (v2.176.1 reviews).
    return (
      `“${typed}” can be read two ways: as the numbers ${asCells}, or as ${n} groups ` +
      `(${shown(pieces.map((p) => split(p).join(", ")), "; ")}). For the numbers, write them with points, spaces ` +
      `between the values of a group and ; or a blank line between groups (for example 0.5 1.5 2.5; 3.5 4.5 5.5); ` +
      `for the groups, write ${pairs}.`
    );
  }
  const parts = pieces.flatMap(split);
  return (
    `“${typed}” can be read two ways: as the numbers ${asCells}, or as ${parts.length} separate values ` +
    `(${shown(parts, ", ")}). For the numbers, write every one with a point (${asCells}); for the separate ` +
    `values, write ${pairs}.`
  );
}
