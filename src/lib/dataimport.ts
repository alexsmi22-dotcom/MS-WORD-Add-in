// Getting data INTO the pane: delimited text from a file, and a Word table from
// the document, reduced to the text shape each calculator field already expects.
//
// WHY THIS EXISTS. Every general data path into this product was a textarea. The
// reader that pulls the table under the cursor had been written, tested, and
// wired to exactly one mode (Table -> Chart), so a user whose numbers were
// already in the document they were writing had to select, copy and paste them
// into a pane box to run statistics on them. That is the one workflow a Word
// add-in should own outright, and it was the one that did not exist.
//
// Pure string/array logic — no Office.js — so the parsing is unit-testable and
// the host-specific half stays in taskpane.ts.

/**
 * Splits delimited text into rows of cells.
 *
 * QUOTES ARE HANDLED PROPERLY, which is the whole reason this is not a
 * `split(",")`. A CSV cell may contain the delimiter, a newline, or an escaped
 * quote ("" inside a quoted field) — and a naive split silently shifts every
 * column after the offending cell, producing a table that looks plausible and
 * is wrong. Excel writes such files by default whenever a label contains a
 * comma, so this is the common case rather than an edge case.
 *
 * The delimiter is SNIFFED from the first non-empty line rather than assumed:
 * tab, then semicolon, then comma. Tab first because a spreadsheet copy-paste
 * is tab-separated and may legitimately contain commas inside numbers in some
 * locales; semicolon before comma for the same reason in decimal-comma locales.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n");
  const delim = delimiter ?? sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'; // an escaped quote inside a quoted field
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // A file with no trailing newline still has a final cell to flush.
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop wholly blank rows — a trailing newline is not a row of data.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Tab, then semicolon, then comma — see parseDelimited's note on ordering. */
export function sniffDelimiter(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  for (const d of ["\t", ";", ","]) {
    if (line.includes(d)) return d;
  }
  return ",";
}

/**
 * Trims a grid to its used rectangle and normalises ragged rows.
 *
 * A Word table read back through the API, and a spreadsheet export, both
 * routinely carry trailing empty columns. Padding rather than truncating keeps
 * every row the same length so column indexing downstream is safe.
 */
export function tidyGrid(rows: string[][]): string[][] {
  const cleaned = rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
  if (!cleaned.length) return [];
  let width = Math.max(...cleaned.map((r) => r.length));
  // Drop trailing all-empty columns.
  while (width > 1 && cleaned.every((r) => (r[width - 1] ?? "") === "")) width--;
  return cleaned.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

/**
 * The number a cell holds, or NaN.
 *
 * THE COMMA RULE, because getting it wrong is a wrong number dressed as a
 * result: "1,5" used to be read as 15 — every comma was stripped as a
 * thousands separator — so a European decimal became a ten-fold error with
 * nothing on screen to show it. A thousands separator always has exactly
 * three digits after it; anything else with a single comma is a decimal
 * comma. "1,200" is read as twelve hundred (the English reading; a user who
 * means 1.2 writes 1,2 or 1.20), "1,5" reads as a decimal, "12,345,6" is
 * neither and is not a number, "1,234.5" has a dot AFTER its comma so the
 * comma is a separator, and "1.000,5" has a dot BEFORE its comma, which is
 * never English — it is the German form and reads as 1000.5.
 * Also normalised: the Unicode minus Word autocorrects to (−, –), a
 * no-break space as a thousands separator ("1 200"), a trailing %.
 */
export function parseCellNumber(s: string): number {
  let t = s
    .replace(/[   ]/g, " ")
    .trim()
    .replace(/^[−–]/, "-")
    .replace(/%$/, "")
    .trim();
  if (t === "") return NaN;
  if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(t)) t = t.replace(/ /g, "");
  if (/\s/.test(t)) return NaN;
  if (t.includes(",")) {
    if (t.includes(".")) {
      if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); // 1.000,5
      else if (t.indexOf(".") < t.indexOf(",")) return NaN; // a dot before a comma in any other shape
      else t = t.replace(/,/g, ""); // 1,234.5
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
    else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
    else return NaN;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** True when the cell reads as a number (see parseCellNumber for the rules). */
export function isNumericCell(s: string): boolean {
  return Number.isFinite(parseCellNumber(s));
}

/**
 * The cell's number AS TEXT for a field: the user's own spelling when it is
 * already a plain number ("3.0" stays "3.0", "1e-3" stays "1e-3"), the parsed
 * value only when the spelling had to change (a comma, a no-break space, a
 * Unicode minus, a percent sign).
 */
export function cellNumberText(s: string): string {
  const t = s.trim();
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return t;
  return String(parseCellNumber(s));
}

/** True when the cell is a DECIMAL-comma number ("1,5"): the reading worth telling the user about. */
export function isDecimalComma(s: string): boolean {
  const t = s.replace(/[   ]/g, " ").trim();
  return /^[-−–]?\d+,\d+%?$/.test(t) && !/^[-−–]?\d{1,3}(,\d{3})+%?$/.test(t);
}

/**
 * Renders a grid into the text a field of this `kind` expects.
 *
 * The three data-bearing kinds want three different shapes, and handing a field
 * the wrong one produces a parse error the user cannot act on:
 *   - `block`  — a table: tab-separated, one row per line (what the insights
 *                and stats parsers already sniff).
 *   - `matrix` — rows of numbers, space-separated, one row per line.
 *   - `list`   — a single comma-separated run of numbers.
 *
 * For `list` the grid is FLATTENED to its numeric cells, in reading order, and
 * a header row is dropped if present — a one-column table is the common case
 * and a user who selects a two-column table for a one-sample test means the
 * numbers, not the labels.
 */
export function gridToFieldText(rows: string[][], kind: string): string {
  const grid = tidyGrid(rows);
  if (!grid.length) return "";

  if (kind === "list") {
    const body = hasHeaderRow(grid) ? grid.slice(1) : grid;
    const nums = body.flat().filter(isNumericCell).map(cellNumberText);
    return nums.join(", ");
  }

  if (kind === "matrix") {
    const body = hasHeaderRow(grid) ? grid.slice(1) : grid;
    return body
      .map((r) => r.filter(isNumericCell).map(cellNumberText).join(" "))
      .filter((l) => l !== "")
      .join("\n");
  }

  // block, and anything else that takes a pasted table.
  return grid.map((r) => r.join("\t")).join("\n");
}

/**
 * A first row is a header when it is non-numeric and the row under it is not.
 *
 * Deliberately conservative: a table whose first row is numeric is treated as
 * data, because silently discarding a real observation is worse than carrying a
 * label through into a column the parsers will ignore anyway.
 */
export function hasHeaderRow(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0].filter((c) => c !== "");
  const second = rows[1].filter((c) => c !== "");
  if (!first.length || !second.length) return false;
  return !first.some(isNumericCell) && second.some(isNumericCell);
}

/** A short human summary of what was loaded, for the status line. */
export function describeGrid(rows: string[][]): string {
  const grid = tidyGrid(rows);
  if (!grid.length) return "no data";
  const cols = grid[0].length;
  const dataRows = hasHeaderRow(grid) ? grid.length - 1 : grid.length;
  return `${dataRows} row${dataRows === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"}`;
}
