/**
 * Release E3's one reader for dated series (time series, event studies, index numbers): a table whose first column
 * may be dates or periods, then one or more value columns.
 *
 * Every number goes through the regression reader (regData.ts: decimal commas, U+2212, ×10ⁿ, thousands
 * separators, the same refusals), and every date through the damages calculators' date reader
 * (damagesInterest.ts readDateToken: 2024-01-05, 1/5/2024, January 5, 2024, and the periods 2019, 2019-07,
 * 2019-Q3). One reader, so a series pasted into any E3 calculator reads the same way.
 *
 * Time series need every period: a missing cell is refused by row (never dropped, which would close a gap
 * silently). Dates must run strictly forward. A date with spaces in it ("January 5, 2024", "2019 Q3") needs a
 * tab- or comma-separated table, which is what a Word or Excel table gives.
 */
import { readDateToken, type DateToken } from "./damagesInterest";
import { isMissingCell, parseRegData, selectColumns, type RegDataset } from "./regData";

export type Frequency = "year" | "quarter" | "month" | "day" | "irregular";

export interface SeriesDates {
  /** The date column's header ("Date"), or "Date" when the table has none. */
  name: string;
  tokens: DateToken[];
  /**
   * year / quarter / month when every row is that period and each follows the last with no gap; day when every row
   * is a single day (trading days skip weekends and holidays, so gaps are expected); otherwise irregular.
   */
  frequency: Frequency;
  /** For a periodic table with a gap, the first one ("2019 Q2 is followed by 2019 Q4"). */
  gap?: string;
}

export interface SeriesData {
  /** Value-column names as given, or "Series 1", "Series 2"… (just "Value" for one unnamed column). */
  names: string[];
  cols: Float64Array[];
  n: number;
  dates?: SeriesDates;
  /** Reader notes to print with the result (decimal commas read, and the like). */
  notes: string[];
  /**
   * Per value column: every cell carries a % sign ("0.12%"). The number reader drops the sign, so the value is in
   * percent units; a calculator that cares (returns) reads that column as percent. A column mixing the two is refused.
   */
  percent: boolean[];
}

export type SeriesResult = { ok: true; data: SeriesData } | { ok: false; reason: string };

/** Past this many rows a series is refused by name. */
export const MAX_SERIES_ROWS = 100000;

const q = (s: string): string => `“${s}”`;

/** The whole cell as one date or period, a named error for a bad one, or null for "not a date". */
function wholeDate(cell: string): DateToken | { error: string } | null {
  // Spreadsheet exports: "2024-01-02 00:00:00" (a midnight time) and "2024/01/02" are the ISO day.
  const s = cell
    .trim()
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?=$|\s)/, "$1-$2-$3")
    .replace(/^(\d{4}-\d{1,2}-\d{1,2})[ T]00:00(:00(\.0+)?)?$/, "$1");
  if (!s) return null;
  const t = readDateToken(s, true);
  if (t && "error" in t) return t;
  return t && t.len === s.length ? t : null;
}

function frequencyOf(tokens: DateToken[]): { frequency: Frequency; gap?: string } {
  const kind = tokens[0].period;
  if (!tokens.every((t) => t.period === kind)) return { frequency: "irregular" };
  if (kind === "day") return { frequency: "day" };
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].from !== tokens[i - 1].to + 1) {
      return { frequency: "irregular", gap: `${tokens[i - 1].label} is followed by ${tokens[i].label}` };
    }
  }
  return { frequency: kind };
}

/**
 * Reads a series table. `minRows` (default 3) is the fewest observations accepted; `requireDates` refuses a table
 * without a date column.
 */
export function parseSeriesTable(text: string, opts: { minRows?: number; requireDates?: boolean } = {}): SeriesResult {
  const parsed = parseRegData(text);
  if (!parsed.ok) return parsed;
  let { names, rows, named } = parsed.data;
  const semicolon = parsed.data.semicolon;
  // A headerless table whose first row starts with a period ("2019-07  4.1") looks like a header to the regression
  // reader (no cell of it is a number); a first cell that is a date is data, not a name.
  if (named) {
    const d0 = wholeDate(names[0]);
    if (d0 && !("error" in d0)) {
      rows = [names, ...rows];
      named = false;
    }
  }
  if (rows.length > MAX_SERIES_ROWS) {
    return { ok: false, reason: `The series has ${rows.length.toLocaleString("en-US")} rows; the most is ${MAX_SERIES_ROWS.toLocaleString("en-US")}.` };
  }

  // A date column: the first column, when every one of its cells is a date or period.
  let dates: SeriesDates | undefined;
  const firstCells = rows.map((r) => r[0] ?? "");
  const firstDates = firstCells.map(wholeDate);
  const datedCount = firstDates.filter((t) => t && !("error" in t)).length;
  const looksDated = datedCount > 0 && datedCount >= firstCells.filter((c) => c.trim() !== "").length / 2;
  if (looksDated) {
    const tokens: DateToken[] = [];
    for (let i = 0; i < rows.length; i++) {
      const t = firstDates[i];
      const label = named ? q(names[0]) : "the date column";
      if (!t) {
        const cell = firstCells[i].trim();
        return {
          ok: false,
          reason: cell
            ? `Row ${i + 1}: ${q(cell)} in ${label} is not a date or period. Use 2024-01-05, 1/5/2024, January 5, 2024, or a period: 2019, 2019-07, 2019-Q3.`
            : `Row ${i + 1} has no date in ${label}.`,
        };
      }
      if ("error" in t) return { ok: false, reason: `Row ${i + 1}: ${t.error}` };
      tokens.push(t);
    }
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].from <= tokens[i - 1].from) {
        const same = tokens[i].from === tokens[i - 1].from;
        return {
          ok: false,
          reason: same
            ? `Rows ${i} and ${i + 1} both date ${tokens[i].label}; each period appears once.`
            : `Row ${i + 1} (${tokens[i].label}) comes before row ${i} (${tokens[i - 1].label}); list the rows oldest first.`,
        };
      }
      // Any row starting inside the one before ("2020-01" then "2020-01-15", or "2020" then "2020-06-15") overlaps.
      if (tokens[i].from <= tokens[i - 1].to) {
        return { ok: false, reason: `Row ${i + 1} (${tokens[i].label}) overlaps row ${i} (${tokens[i - 1].label}).` };
      }
    }
    dates = { name: named ? names[0] : "Date", tokens, ...frequencyOf(tokens) };
    names = names.slice(1);
    rows = rows.map((r) => r.slice(1));
  } else if (opts.requireDates) {
    return {
      ok: false,
      reason: "Put the dates in the first column (2024-01-05, 1/5/2024, January 5, 2024, or a period: 2019, 2019-07, 2019-Q3).",
    };
  }
  if (!names.length) return { ok: false, reason: "The table has dates but no column of values." };

  const valueNames = named ? names : names.length === 1 ? ["Value"] : names.map((_, j) => `Series ${j + 1}`);
  const minRows = opts.minRows ?? 3;
  if (rows.length < minRows) {
    return { ok: false, reason: `The series has ${rows.length} row${rows.length === 1 ? "" : "s"}; at least ${minRows} are needed.` };
  }

  // Time series need every period: name the first empty cell rather than dropping its row.
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < valueNames.length; j++) {
      if (isMissingCell(rows[i][j] ?? "")) {
        const when = dates ? ` (${dates.tokens[i].label})` : "";
        return {
          ok: false,
          reason: `Row ${i + 1}${when} has no value in ${q(valueNames[j])}. A series needs a value in every row; fill or remove the row.`,
        };
      }
    }
  }

  const data: RegDataset = { names: valueNames, rows, named: true, semicolon };
  const sel = selectColumns(data, { dep: valueNames[0], preds: valueNames.slice(1), text: "" });
  if (!sel.ok) return sel;
  const cols = [sel.cols.y, ...sel.cols.X];
  const percent: boolean[] = [];
  for (let j = 0; j < valueNames.length; j++) {
    let withSign = 0;
    let firstWith = -1;
    let firstWithout = -1;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][j] ?? "").trim().endsWith("%")) {
        withSign++;
        if (firstWith < 0) firstWith = i;
      } else if (firstWithout < 0) firstWithout = i;
    }
    if (withSign && withSign < rows.length) {
      return {
        ok: false,
        reason:
          `${q(valueNames[j])} writes some values with a % sign (row ${firstWith + 1}) and some without (row ` +
          `${firstWithout + 1}), so its units are ambiguous. Write every value the same way.`,
      };
    }
    percent.push(withSign > 0);
  }
  return { ok: true, data: { names: valueNames, cols, n: rows.length, dates, notes: sel.cols.notes, percent } };
}

/** The named column (or the only one) of a series table. */
export function pickSeries(data: SeriesData, name: string): { ok: true; name: string; values: Float64Array } | { ok: false; reason: string } {
  const want = name.trim();
  if (!want) {
    if (data.cols.length === 1) return { ok: true, name: data.names[0], values: data.cols[0] };
    return { ok: false, reason: `The table has ${data.cols.length} value columns (${data.names.map(q).join(", ")}); name the one to use.` };
  }
  const j = data.names.findIndex((n) => n.toLowerCase() === want.toLowerCase());
  if (j < 0) return { ok: false, reason: `No column is named ${q(want)}; the columns are ${data.names.map(q).join(", ")}.` };
  return { ok: true, name: data.names[j], values: data.cols[j] };
}
