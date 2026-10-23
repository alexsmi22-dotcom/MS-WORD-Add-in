// RULE N: the ONE reader for pasted blocks of numbers (titration, materials, two-y-axes data). Release B round 3
// settled it after three rounds of per-tool heuristics each produced a confident wrong number somewhere:
//
//   N1  The field separator is decided once per block: tab if any tab; else semicolon if any; else ", " (comma
//       followed by whitespace) and whitespace both separate; else (none of those) bare commas separate.
//   N2  After splitting, a field that still contains a comma is a COMMA-NUMBER. A block holding any dot-decimal
//       field (2.88, but not the European 1.234,5) AND any comma-number is REFUSED, naming one of each.
//   N3  Otherwise comma-numbers are read by the existing per-block rule (assayQuant.commaReading / readNum): decimal
//       or thousands from the block's own evidence, an undecidable "1,250" refused by name; 1.234,5 is 1234.5.
//   N4  The first row is a header only if NONE of its fields is numeric or number-like. Any other row holding a
//       word field is refused with its line number (missing-value tokens -, NA, N/A, nan, ., and empty fields are
//       allowed and come back as null). A number is never silently dropped.
//   N5  A comma can no longer create an "extra column", so callers' extra-column notes are about real fields.
//   N6  A one-line list follows N1 like any block: "25,50" is [25, 50]; "1,000, 2,000" sends "1,000" and "2,000"
//       to N3.
// Tiebreak (the integrator's): a NAMED refusal of genuinely ambiguous input is acceptable; a confident wrong number
// is not. CRLF line endings and blank lines are ignored; U+2212 and the en dash read as minus. Pure: no Office.js.

import { commaReading, commaNotes, readNum } from "./assayQuant";
import { parseCellNumber } from "./dataimport";

export interface DataBlock {
  ok: true;
  /** One entry per data row; a missing-value token is null. Rows may differ in length. */
  rows: (number | null)[][];
  /** 1-based line numbers of the rows in the pasted text (blank lines counted), for messages. */
  lines: number[];
  /** The header fields, when the first row was one. */
  header: string[] | null;
  /** Notes to show with the result (a header read, decimal commas read). */
  notes: string[];
  /** The separator N1 chose. */
  separator: "tab" | "semicolon" | "space" | "comma" | "line";
}
export interface DataBlockRefusal {
  ok: false;
  error: string;
}

export interface DataBlockOptions {
  /** Most data rows a caller accepts (default 2000). */
  maxRows?: number;
  /**
   * For a field where ONE value is the common case (a pKa): a lone single-line "d,dd" with no other separator could
   * be one decimal-comma value or two values, so it is refused by name instead of read as two (the round-3 "4,76"
   * decision). Without it, N1 reads "25,50" as [25, 50].
   */
  loneCommaPairAmbiguous?: boolean;
  /**
   * R1, for single-value list fields (scan rates, pKa values, strengths, measurements): a MULTI-line block in which
   * no line has a tab, semicolon, whitespace or ", " is one value per line, and a comma inside a line is a
   * comma-number read by N3 ("1234,5\n1302,7" is [1234.5, 1302.7]). A single line keeps N1/N6 (and
   * loneCommaPairAmbiguous). Multi-column tools never pass it.
   */
  singleColumn?: boolean;
  /**
   * Release D. A reader whose rows also hold tokens of its OWN grammar (a dilution "1:10", a Ct "Undetermined")
   * maps each split row here, after N1 and the grouping rules and before the header and word checks: it returns the
   * row's fields (such tokens replaced by a missing-value token "-", which it remembers) or null to drop the row
   * (its own header). `line` is the row's 1-based line in the pasted text. The fields every number comes from are
   * still split and read here, by RULE N; the hook never reads a number.
   */
  mapRow?: (fields: string[], line: number) => string[] | null;
  /** N3 evidence: the fields from column `fromColumn` on cannot exceed `max` (a Ct ≤ 60), so "18,123" there is a decimal comma. */
  commaBounded?: { fromColumn: number; max: number; why: string };
  /** The caller has already taken its own header off (mapRow returned null for it): no row is a header here (N4). */
  noHeader?: boolean;
}

// Minus signs are kept AS TYPED in the fields (U+2212, the en dash or a hyphen) so a note echoes the user's text;
// every reader below (commaReading, readNum, parseCellNumber) accepts all three.
const MISSING = /^(|[-−–]|\.|na|n\/a|nan)$/i;
/** Looks like a number (digits with signs, separators, an exponent or a percent), readable or not. */
const NUMBER_LIKE = /^[-+−–]?(\d[\d.,]*|[.,]\d[\d.,]*)([eE][-+−]?\d+)?%?$/;
/** The European thousands-dot, decimal-comma form 1.234,5 (a comma-number, not dot evidence). */
const EUROPEAN = /^[-+−–]?\d{1,3}(\.\d{3})+,\d+%?$/;
/** A dot-decimal field: a dot and no comma (the European 1.234,5 has a comma, so it is a comma-number). */
const DOT_DECIMAL = /^[-+−–]?(\d*\.\d+|\d+\.)([eE][-+−]?\d+)?%?$/;

/**
 * R3″ (the STRICT final rule; the integrator's stop rule after R3 and R3′ each produced a confident wrong number):
 *   (a) A no-break, narrow no-break or thin space BETWEEN TWO DIGITS is digit grouping only when its token is already
 *       one field by other means — inside a tab- or semicolon-separated field, or a whole line in singleColumn mode —
 *       AND the token is fully SI-shaped: a first group of 1–3 digits not starting with 0 (or exactly "0" followed by
 *       the decimal mark, "0,123 4"), then groups of exactly three, and a decimal part undivided or
 *       ddd(␣ddd)*(␣d{1,3}). Otherwise it is refused by name.
 *   (b) In a whitespace-, ", "- or comma-separated block, ANY such space between two digits is refused by name: it
 *       could group digits or separate values. Never a separator, never grouping, never block evidence.
 *   (c) Such a space NOT between two digits (before a unit, at a line end) is ordinary whitespace.
 */
const GROUP_CLASS = "[\\u00A0\\u202F\\u2009]";
const GROUP_ANY = new RegExp(GROUP_CLASS, "g");
const GROUP_NOT_BETWEEN_DIGITS = new RegExp(`(?<!\\d)${GROUP_CLASS}|${GROUP_CLASS}(?!\\d)`, "g");
const GROUP_BETWEEN_DIGITS = new RegExp(`\\d${GROUP_CLASS}\\d`);
const GROUPED_TOKEN = new RegExp(`[^ \\t,;]*\\d${GROUP_CLASS}\\d[^ \\t,;]*`);
const SI_GROUPED = new RegExp(
  `^[-+−–]?(?:[1-9]\\d{0,2}(?:${GROUP_CLASS}\\d{3})*|0(?=[.,]))(?:[.,](?:\\d+|\\d{3}(?:${GROUP_CLASS}\\d{3})*(?:${GROUP_CLASS}\\d{1,3})?))?%?$`,
);
const showGrouped = (t: string): string => t.replace(GROUP_ANY, " ");
const groupRefusal = (what: string, token: string): DataBlockRefusal => ({
  ok: false,
  error: `${what}: “${showGrouped(token)}” has a no-break/thin space between digits; it could group digits or separate values. Separate columns with tabs, or remove the space.`,
});

/** A block label as the noun after "the": a leading article dropped, a capitalised first word lower-cased (not "pKa", "ΔEp" or an acronym). */
export function noteNoun(what: string): string {
  const t = (what ?? "").trim().replace(/^(the|a|an)\s+/i, "");
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t || "data";
}

/** Reads a pasted block under RULE N. `what` names the block in messages ("Measured volume, pH"). */
export function readDataBlock(text: string, what: string, opts: DataBlockOptions = {}): DataBlock | DataBlockRefusal {
  const refuse = (error: string): DataBlockRefusal => ({ ok: false, error });
  const maxRows = opts.maxRows ?? 2000;
  // R3″ (c): a grouping space that is not between two digits is ordinary whitespace.
  const all = (text ?? "").replace(/\r\n?/g, "\n").replace(GROUP_NOT_BETWEEN_DIGITS, " ").split("\n");
  let src: Array<{ text: string; line: number }> = [];
  all.forEach((l, i) => {
    const t = l.trim();
    if (t) src.push({ text: t, line: i + 1 });
  });
  if (!src.length) return refuse(`${what}: nothing to read.`);
  if (src.length > maxRows + 1) return refuse(`${what}: more than ${maxRows} rows.`);

  // N1 (and R1: a multi-line single-value list with no separator but commas is one value per line)
  const separator: DataBlock["separator"] = all.some((l) => l.includes("\t"))
    ? "tab"
    : src.some((r) => r.text.includes(";"))
      ? "semicolon"
      : // ASCII whitespace only: a grouping space between digits is not a separator (R3″).
        src.some((r) => /[ \t\f\v]/.test(r.text))
        ? "space"
        : opts.singleColumn && src.length > 1
          ? "line"
          : "comma";
  let fieldsOf = src.map((r): string[] => {
    // Tab and semicolon fields keep their empty cells (a missing value must not shift the columns after it), so a
    // tab row is re-split from the untrimmed line.
    if (separator === "tab") return all[r.line - 1].split("\t").map((f) => f.trim());
    if (separator === "semicolon") return r.text.split(";").map((f) => f.trim());
    if (separator === "space") return r.text.split(/,[ \t\f\v]+|[ \t\f\v]+/).filter((f) => f !== "");
    if (separator === "line") return [r.text];
    return r.text.split(",").map((f) => f.trim());
  });
  // R3″ (b): in a whitespace- or comma-separated block a grouping space between digits is refused outright.
  if (separator === "space" || separator === "comma") {
    const hit = src.find((r) => GROUP_BETWEEN_DIGITS.test(r.text));
    if (hit) return groupRefusal(what, GROUPED_TOKEN.exec(hit.text)?.[0] ?? hit.text);
  }
  // R3″ (a): inside a tab/semicolon field or a singleColumn line, grouping only in the full SI shape.
  for (const fields of fieldsOf)
    for (let k = 0; k < fields.length; k++) {
      if (!GROUP_BETWEEN_DIGITS.test(fields[k])) continue;
      if (!SI_GROUPED.test(fields[k])) return groupRefusal(what, fields[k]);
      // A singleColumn line is delimited only by itself: two strengths copied from Word with a no-break space look
      // exactly like one two-group integer, so "312 334" (two groups, no decimal part) is refused there.
      if (separator === "line" && new RegExp(`^[-+−–]?\\d{1,3}${GROUP_CLASS}\\d{3}%?$`).test(fields[k])) return groupRefusal(what, fields[k]);
      fields[k] = fields[k].replace(GROUP_ANY, "");
    }

  // The caller's own tokens (opts.mapRow): rows it maps keep their place; rows it drops are gone before N4.
  if (opts.mapRow) {
    const kept: number[] = [];
    for (let i = 0; i < fieldsOf.length; i++) {
      const mapped = opts.mapRow(fieldsOf[i].slice(), src[i].line);
      if (mapped) {
        fieldsOf[i] = mapped;
        kept.push(i);
      }
    }
    if (kept.length < fieldsOf.length) {
      src = kept.map((i) => src[i]);
      fieldsOf = kept.map((i) => fieldsOf[i]);
    }
    if (!src.length) return refuse(`${what}: nothing to read.`);
  }

  // R2: inside a tab- or semicolon-separated field an ASCII space is not digit grouping: "362 371 380" is three
  // numbers or one, and either guess is a confident wrong number.
  const spacedNumber = (f: string): boolean => / /.test(f) && f.split(/ +/).every((p) => NUMBER_LIKE.test(p));
  // N4, header: the first row is one only if, ignoring empty cells and missing-value tokens (R4), it has at least one
  // field and none of them is numeric or number-like.
  const isNumeric = (f: string): boolean => !/ /.test(f) && (NUMBER_LIKE.test(f) || Number.isFinite(parseCellNumber(f)));
  let header: string[] | null = null;
  let start = 0;
  const firstWords = fieldsOf[0].filter((f) => !MISSING.test(f));
  if (!opts.noHeader && firstWords.length && !firstWords.some((f) => isNumeric(f) || spacedNumber(f))) {
    header = fieldsOf[0];
    start = 1;
  }
  if (start >= fieldsOf.length) return refuse(`${what}: only a header line.`);
  if (fieldsOf.length - start > maxRows) return refuse(`${what}: more than ${maxRows} rows.`);
  if (opts.loneCommaPairAmbiguous && separator === "comma" && fieldsOf.length === 1 && fieldsOf[0].length === 2 && fieldsOf[0].every((f) => /^[-−–]?\d+$/.test(f))) {
    const [a, b] = fieldsOf[0];
    return refuse(`${what}: "${src[0].text}" could be one number with a decimal comma (${a}.${b}) or two values (${a} and ${b}). Write ${a}.${b}, or ${a}, ${b}.`);
  }

  // N4, every data field is a number or a missing-value token; a word field is refused by line.
  const data = fieldsOf.slice(start);
  for (let i = 0; i < data.length; i++) {
    const spaced = data[i].find(spacedNumber);
    if (spaced !== undefined)
      return refuse(
        `${what}: line ${src[start + i].line}: "${spaced}" has spaces inside one ${separator === "tab" ? "tab" : "semicolon"}-separated field. Separate the values with ${separator === "tab" ? "tabs" : "semicolons"}, or remove the spaces (digit groups are written without them).`,
      );
    const word = data[i].find((f) => !MISSING.test(f) && !isNumeric(f));
    if (word !== undefined)
      return refuse(
        data[i].some((f) => isNumeric(f))
          ? `${what}: line ${src[start + i].line} ("${src[start + i].text}") mixes words and numbers ("${word}"). Remove the text, or put a header on its own first line.`
          : `${what}: line ${src[start + i].line} ("${src[start + i].text}") has no numbers. Only the first line may be a header.`,
      );
  }

  // N2
  const fields = data.flat().filter((f) => !MISSING.test(f));
  const commaNum = fields.find((f) => f.includes(","));
  // A comma-number with a dot that is not the European 1.234,5 form ("2.5,3.5") is dot evidence too.
  const dotted = fields.find((f) => f.includes(",") && f.includes(".") && !EUROPEAN.test(f));
  if (dotted !== undefined) return refuse(`${what}: "${dotted}" has both a decimal point and a comma; use one decimal mark throughout (2.88 or 2,88), and separate values with a space or a tab.`);
  const dotDec = fields.find((f) => DOT_DECIMAL.test(f));
  if (commaNum !== undefined && dotDec !== undefined)
    return refuse(`${what}: this block mixes ${dotDec} and ${commaNum}; use one decimal mark throughout (2.88 or 2,88).`);

  // N3
  const notes: string[] = [];
  if (header) notes.push(`${what}: the first line was read as a header (${header.filter(Boolean).join(", ")}).`);
  let mode: "comma" | "point" = "point";
  if (commaNum !== undefined) {
    const b = opts.commaBounded;
    const reading = commaReading(
      fields,
      what,
      b ? { bounded: { cells: data.flatMap((r) => r.slice(b.fromColumn)).filter((f) => !MISSING.test(f)), max: b.max, why: b.why } } : {},
    );
    if ("ok" in reading) return refuse(reading.error);
    mode = reading.mode;
    // commaNotes writes "Commas in the <noun> …": the caller's label ("The data", "Scan rates") becomes a bare
    // lower-case noun so the sentence reads for any label (no "the The data").
    notes.push(...commaNotes(noteNoun(what), reading));
  }
  const rows: (number | null)[][] = [];
  for (let i = 0; i < data.length; i++) {
    const row: (number | null)[] = [];
    for (const f of data[i]) {
      if (MISSING.test(f)) {
        row.push(null);
        continue;
      }
      const v = f.includes(",") ? readNum(f, mode) : parseCellNumber(f);
      if (!Number.isFinite(v)) return refuse(`${what}: line ${src[start + i].line}: "${f}" is not a number.`);
      row.push(v);
    }
    rows.push(row);
  }
  return { ok: true, rows, lines: src.slice(start).map((r) => r.line), header, notes, separator };
}
