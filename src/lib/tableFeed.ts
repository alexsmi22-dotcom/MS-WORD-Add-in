/**
 * A Word table → the text each GROUP-syntax statistics calculator expects.
 *
 * WHY THIS EXISTS. "Use table at cursor" reached every `list`, `matrix` and
 * `block` field, and stopped at the eleven calculators whose field kind is
 * `groups` — ANOVA, Tukey, Dunnett, Kruskal–Wallis, the assumption check,
 * Friedman, survival, log-rank, multiple regression, the contingency table and
 * two-way ANOVA — on the reasoning that "a group definition takes syntax, not
 * a grid". That is false for all of them: each has an obvious grid form, and
 * for most of them the grid IS how the data sits in the user's document. So
 * half of the product's own stated wedge — paste nothing, point at the table —
 * was missing from exactly the tests a reviewer asks for.
 *
 * Pure string logic, no Office.js: every mapping is unit-tested here and the
 * host half in taskpane.ts is a few lines. Each shape returns either the text
 * for the field plus a NOTE saying how the table was read (which column became
 * what — the user must be able to check the reading), or an error naming what
 * the table lacks. Nothing is guessed silently: an ambiguous table is refused
 * with the layout that would work, and nothing is dropped without being said.
 *
 * The emitted text carries NUMBERS ONLY. The group parsers split on whitespace
 * and commas and keep every numeric token, so a label such as "Dose 10" in the
 * text would inject a value; names are reported in the note instead.
 *
 * THE LAYOUTS THAT BROKE THE FIRST VERSION (an independent pass, all class A):
 * a European decimal comma read as a thousands separator; a group label
 * merged vertically across its rows, so every row but the first was dropped;
 * numeric ids, arms and years read as values because "a label is a word"; an
 * "Age (years)" column taken as survival time because it mentions a unit; a
 * "Censored" column read with 1 = event; and survival rows with an unexpected
 * status code quietly skipped. Each is a named rule below with its own test.
 */
import { tidyGrid, hasHeaderRow, isNumericCell, parseCellNumber, cellNumberText, isDecimalComma } from "./dataimport";

export type TableShape =
  /** Independent groups: one column per group, or a label column + a value column. */
  | "groups"
  /** Repeated measures: one row per subject, one column per condition. */
  | "subjects"
  /** One subject per row: a time column and an event (1/0) column. */
  | "survival"
  /** As survival, plus a group column; blocks per group. */
  | "survival-groups"
  /** A rectangular numeric block, one row per line: regression rows (response first). */
  | "rows"
  /** A rectangular block of counts: a contingency table. */
  | "counts"
  /** Factor A, factor B, value — one observation per row, or a crosstab. */
  | "factorial";

export interface TableFeed {
  text: string;
  /** How the table was read, in words the user can check against it. */
  note: string;
}
export interface TableFeedError {
  error: string;
}
export type TableFeedResult = TableFeed | TableFeedError;

const num = (s: string): number => parseCellNumber(s);
const fmt = (n: number): string => String(n);
/** A value cell as field text: the user's own spelling where it is already a plain number. */
const numText = (s: string): string => cellNumberText(s);
/** Missing-value placeholders count as blank cells everywhere. */
const NA_CELL = /^(n\/?a|nan|-|—|–|\.|null|none|missing|\?|#n\/a|#value!|#div\/0!)$/i;
const isBlank = (s: string): boolean => s.trim() === "" || NA_CELL.test(s.trim());

/**
 * A header that IS an identifier or category word — the whole header, give or
 * take a trailing "id/no./name/code" — as opposed to one that merely starts
 * with such a word ("Run time", "Case fatality", "Sample A"). The second pass
 * found that a prefix match silently dropped or relabelled real measurement
 * columns, which is the same class of defect the header rule was added to fix.
 * A header word is also never enough on its own: the column's CONTENT must
 * look like ids or levels too (see isIdColumn / isCategoryColumn), and sibling
 * headers sharing the word ("Trial 1 | Trial 2") are groups, not identifiers.
 */
const ID_EXACT =
  /^\s*(id|ids|no\.?|#|n°|row|subject|subj|patient|participant|sample|specimen|rep|replicate|run|trial|case|animal|plot|site|unit)\s*(id|ids|no\.?|number|#|name|code)?\s*$/i;
const CATEGORY_EXACT =
  /^\s*(group|arm|treatment|treat|cohort|condition|cond|strat\w*|level|factor|class|category|cat|year|dose|batch|lot|sex|gender|type|block)\s*(id|no\.?|name|code)?\s*$/i;

function sharesLeadingWord(header: string[] | null, j: number): boolean {
  if (!header) return false;
  const w = (h: string | undefined): string => (h ?? "").trim().split(/[\s_\-.]+/)[0]?.toLowerCase() ?? "";
  const mine = w(header[j]);
  return mine !== "" && header.some((h, k) => k !== j && w(h) === mine);
}

/** Identifier column: an id header AND id-like content (text, a row counter, or all-distinct integers). */
function isIdColumn(header: string[] | null, j: number, cells: string[]): boolean {
  const h = header?.[j];
  if (!h || !ID_EXACT.test(h) || sharesLeadingWord(header, j)) return false;
  if (isTextColumn(cells)) return true;
  const v = cells.filter((c) => !isBlank(c)).map(num);
  if (!v.length || v.some((x) => !Number.isInteger(x))) return false;
  return new Set(v).size === v.length;
}

/** Category column: a category/id header AND level-like content (text, or integers that repeat — arms 1/1/2/2). */
function isCategoryColumn(header: string[] | null, j: number, cells: string[]): boolean {
  const h = header?.[j];
  if (!h || !(CATEGORY_EXACT.test(h) || ID_EXACT.test(h)) || sharesLeadingWord(header, j)) return false;
  if (isTextColumn(cells)) return true;
  const v = cells.filter((c) => !isBlank(c)).map(num);
  if (v.length < 2 || v.some((x) => !Number.isInteger(x))) return false;
  return new Set(v).size < v.length;
}

/** The grid with its header row (if any) split off. */
function split(rows: string[][]): { header: string[] | null; body: string[][] } {
  const grid = tidyGrid(rows);
  if (!grid.length) return { header: null, body: [] };
  return hasHeaderRow(grid) ? { header: grid[0], body: grid.slice(1) } : { header: null, body: grid };
}

/** Column `j` of `body`, trimmed. */
const column = (body: string[][], j: number): string[] => body.map((r) => r[j] ?? "");

/** Fills blank cells in a label column from the row above — a label MERGED
 *  vertically across its rows reaches the API as the label on the first row
 *  and blanks below it. Returns how many were filled, so the note can say so. */
function forwardFill(body: string[][], j: number): number {
  let last = "";
  let filled = 0;
  for (const r of body) {
    if (isBlank(r[j] ?? "")) {
      if (last !== "") {
        r[j] = last;
        filled++;
      }
    } else {
      last = r[j];
    }
  }
  return filled;
}

/** All-text column: at least two filled cells, none numeric. */
function isTextColumn(cells: string[]): boolean {
  const filled = cells.filter((c) => !isBlank(c));
  return filled.length >= 2 && !filled.some(isNumericCell);
}

/** Mixed words and numbers in one column — the signature of a merged label
 *  column whose rows came back ragged, or of a column that is neither. */
function isMixedColumn(cells: string[]): boolean {
  const filled = cells.filter((c) => !isBlank(c));
  const n = filled.filter(isNumericCell).length;
  return n > 0 && n < filled.length;
}

/** The integers 1..n (or 0..n−1) in order: a row counter, not a measurement. */
function isRowCounter(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const v = cells.map(num);
  if (v.some((x) => !Number.isInteger(x))) return false;
  const start = v[0];
  if (start !== 1 && start !== 0) return false;
  return v.every((x, i) => x === start + i);
}

/** Numeric cells of a column, blanks skipped. */
const numbers = (cells: string[]): number[] => cells.filter(isNumericCell).map(num);

const name = (header: string[] | null, j: number, fallback: string): string => {
  const h = header?.[j]?.trim();
  return h ? h : fallback;
};

/** "…; 2 decimal-comma cells read as decimals (1,5 → 1.5)" when any were. */
function commaNote(body: string[][]): string {
  const ex = body.flat().find(isDecimalComma);
  if (!ex) return "";
  const n = body.flat().filter(isDecimalComma).length;
  return ` ${n} decimal-comma cell${n === 1 ? "" : "s"} read as decimals (${ex.trim()} → ${numText(ex)}).`;
}

/** The refusal for a column that mixes words and numbers. */
const MIXED_ERROR =
  "The first column mixes words and numbers. If the group labels were merged cells, type the label into every row " +
  "(or add a header row naming the columns) and try again.";

/**
 * Independent groups. Two layouts are read:
 *   LONG — two columns, a label and a value; rows are grouped by label in
 *          order of first appearance. A merged label is forward-filled. The
 *          label column may be NUMERIC (arms coded 1/2) when its header says
 *          it is a category.
 *   WIDE — one column per group (a header row names them); ragged columns
 *          are fine, blank cells are skipped. A leading id/label column is
 *          dropped and said so.
 */
export function feedGroups(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const width = body[0].length;
  const col0 = column(body, 0);

  const longByHeader = width === 2 && isCategoryColumn(header, 0, col0) && !isCategoryColumn(header, 1, column(body, 1));
  const longByContent = width === 2 && (isTextColumn(col0) || (isMixedColumn(col0) && forwardFillWouldFix(body, 0)));
  if (longByHeader || longByContent) {
    const filled = forwardFill(body, 0);
    if (isMixedColumn(column(body, 0)) && !longByHeader) return { error: MIXED_ERROR };
    const order: string[] = [];
    const groups = new Map<string, string[]>();
    let skipped = 0;
    for (const r of body) {
      const label = (r[0] ?? "").trim();
      const v = r[1] ?? "";
      if (isBlank(label) && isBlank(v)) continue;
      if (isBlank(label) || !isNumericCell(v)) {
        skipped++;
        continue;
      }
      if (!groups.has(label)) {
        groups.set(label, []);
        order.push(label);
      }
      groups.get(label)!.push(numText(v));
    }
    if (skipped) {
      return {
        error: `${skipped} row${skipped === 1 ? "" : "s"} had no usable label + value pair. Every row needs a group label and a number.`,
      };
    }
    if (order.length < 2) {
      return { error: `Only one group label ("${order[0]}") — a groups test needs at least two.` };
    }
    return {
      text: order.map((g) => groups.get(g)!.join(", ")).join("\n\n"),
      note:
        `Read as label + value rows: groups ${order.map((g, i) => `${i + 1} = ${g} (n ${groups.get(g)!.length})`).join(", ")}.` +
        (filled ? ` ${filled} merged label cell${filled === 1 ? "" : "s"} filled from the row above.` : "") +
        commaNote(body),
    };
  }
  if (width === 2 && isMixedColumn(col0)) return { error: MIXED_ERROR };

  // WIDE: one column per group, dropping a leading id/label column.
  let start = 0;
  let dropped = "";
  if (width >= 2 && (isTextColumn(col0) || isIdColumn(header, 0, col0) || (isRowCounter(col0) && numbers(col0).length === body.length))) {
    start = 1;
    dropped = ` The first column (${name(header, 0, isTextColumn(col0) ? "row labels" : "a row counter")}) was dropped.`;
  }
  const cols: { name: string; values: string[] }[] = [];
  for (let j = start; j < width; j++) {
    const vals = column(body, j).filter(isNumericCell).map(numText);
    if (vals.length) cols.push({ name: name(header, j, `column ${j + 1}`), values: vals });
  }
  if (cols.length < 2) {
    return {
      error:
        "Could not find two groups. Lay the table out with one column per group (a header row names them), " +
        "or two columns: a group label and a value.",
    };
  }
  return {
    text: cols.map((c) => c.values.join(", ")).join("\n\n"),
    note:
      `Read one group per column: ${cols.map((c, i) => `${i + 1} = ${c.name} (n ${c.values.length})`).join(", ")}.` +
      dropped +
      (header ? "" : " No header row found, so the first row was read as data; if it holds the group names, make it a header.") +
      commaNote(body),
  };
}

/** True when forward-filling column j turns it into an all-text column. */
function forwardFillWouldFix(body: string[][], j: number): boolean {
  const copy = body.map((r) => [...r]);
  forwardFill(copy, j);
  return isTextColumn(column(copy, j));
}

/** Repeated measures: one row per subject, one column per condition (same order every row). */
export function feedSubjects(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const width = body[0].length;
  const col0 = column(body, 0);
  let start = 0;
  let dropped = "";
  if (width >= 2 && (isTextColumn(col0) || isIdColumn(header, 0, col0) || (isRowCounter(col0) && numbers(col0).length === body.length))) {
    start = 1;
    dropped = ` The first column (${name(header, 0, "subject ids")}) was dropped.`;
  }
  const lines: string[] = [];
  for (const r of body) {
    const vals = r.slice(start);
    if (vals.every(isBlank)) continue;
    if (!vals.every(isNumericCell)) {
      return { error: "Every subject row needs a number in every condition column — a blank or a word was found." };
    }
    lines.push(vals.map(numText).join(" "));
  }
  if (lines.length < 2 || width - start < 2) {
    return { error: "Need at least two subject rows and two condition columns." };
  }
  const conds = Array.from({ length: width - start }, (_, k) => name(header, start + k, `condition ${k + 1}`));
  return {
    text: lines.join("\n"),
    note: `Read ${lines.length} subject rows × ${conds.length} conditions: ${conds.join(", ")}.` + dropped + commaNote(body),
  };
}

// --- survival -------------------------------------------------------------

/**
 * What a survival header is FOR, decided by the words it contains, in an
 * order the second adversarial pass forced: a header NAMING time ("Time",
 * "Time to event", "Treatment duration", "Days to death") is time before any
 * word in it can make it an event; "status"/"censored" make an event column
 * even beside "survival" ("Survival status"); "survival"/"OS"/"PFS" alone are
 * time ("Progression-free survival (months)"); event words after that; a bare
 * unit ("Months") is a weak time; "age" is never time.
 */
type HeaderRole = "time" | "timeWeak" | "event" | "none";
const TIME_NAMED = /\b(time|duration|follow[- ]?up)\b|\b(days?|weeks?|months?|years?|hours?)\s+(to|until|since)\b/i;
const STATUS_WORDS = /\b(status|censor\w*)\b/i;
const TIME_SURV = /\b(survival|os|pfs|dfs|efs|rfs|ttp|ttf)\b/i;
const EVENT_WORDS = /\b(event|events|dead|death|died|deceased|outcome|relapse|relapsed|recurrence|recurred|failure|failed|progression|progressed)\b/i;
const UNIT_WORDS = /\b(days?|weeks?|months?|years?|hours?)\b/i;
const AGE_LIKE = /\bage\b/i;
const GROUP_NAMED = /^\s*(group|arm|cohort|strat\w*|condition|treatment\s+(group|arm))\b/i;

function headerRole(h: string): HeaderRole {
  if (TIME_NAMED.test(h) && !AGE_LIKE.test(h)) return "time";
  if (STATUS_WORDS.test(h)) return "event";
  if (TIME_SURV.test(h)) return "time";
  if (EVENT_WORDS.test(h)) return "event";
  if (UNIT_WORDS.test(h) && !AGE_LIKE.test(h)) return "timeWeak";
  return "none";
}
/** Among time headers, one that starts with the word wins ("Time" over "Treatment duration"). */
const timeRank = (h: string): number => (/^\s*(time|survival|follow)/i.test(h) ? 2 : 1);

/** 1 / 0 from the ways people write an event flag; null when unrecognised. */
function eventFlag(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (["1", "1.0", "true", "yes", "y", "event", "dead", "died", "death", "deceased", "failed", "failure", "relapse"].includes(t)) return 1;
  if (["0", "0.0", "false", "no", "n", "censored", "censor", "alive", "living", "lost", "withdrawn", "none"].includes(t)) return 0;
  return null;
}

interface SurvivalColumns {
  time: number;
  event: number;
  /** The event column is a CENSORED flag: 1 means censored, so invert. */
  inverted: boolean;
  group: number | null;
}

function pickSurvivalColumns(header: string[] | null, body: string[][]): SurvivalColumns | TableFeedError {
  const width = body[0].length;
  const idx = Array.from({ length: width }, (_, j) => j);
  let time = -1;
  let event = -1;
  let inverted = false;
  let group: number | null = null;
  if (header) {
    const h = header.map((x) => x ?? "");
    const roles = h.map(headerRole);
    const times = idx.filter((j) => roles[j] === "time").sort((a, b) => timeRank(h[b]) - timeRank(h[a]));
    time = times[0] ?? idx.find((j) => roles[j] === "timeWeak") ?? -1;
    event = idx.find((j) => roles[j] === "event" && j !== time) ?? -1;
    // "Censored" is an inverted flag; "Status"/"Event" beside it are not.
    inverted = event >= 0 && /censor/i.test(h[event]) && !/\b(status|event)\b/i.test(h[event]);
    const rest = idx.filter((j) => j !== time && j !== event);
    group =
      rest.find((j) => GROUP_NAMED.test(h[j])) ??
      rest.find((j) => isTextColumn(column(body, j))) ??
      rest.find((j) => isCategoryColumn(header, j, column(body, j))) ??
      null;
  } else if (width > 2) {
    // Three or more unnamed columns: which is time and which is an id is a
    // guess, and a guess here is a wrong curve. Ask for names.
    return {
      error:
        "With more than two columns the time and event columns must be named in a header row " +
        "(e.g. Time, Event, Group).",
    };
  }
  const eventLike = (j: number): boolean => column(body, j).every((c) => isBlank(c) || eventFlag(c) !== null);
  if (time < 0 || event < 0) {
    // By content: the first numeric column that is not all 0/1 is time; the
    // first all-0/1 column other than it is the event flag.
    const numericCols = idx.filter((j) => numbers(column(body, j)).length >= 2);
    if (time < 0) time = numericCols.find((j) => j !== event && !eventLike(j)) ?? -1;
    if (event < 0) event = idx.find((j) => j !== time && eventLike(j)) ?? -1;
  }
  if (time < 0 || event < 0) {
    return {
      error:
        "Need a time column and an event column (1 = event, 0 = censored). Name them in a header row, " +
        "or put time first and the 1/0 flag second.",
    };
  }
  if (group === null) {
    for (const j of idx) {
      if (j !== time && j !== event && (isTextColumn(column(body, j)) || isCategoryColumn(header, j, column(body, j)))) {
        group = j;
        break;
      }
    }
  }
  return { time, event, inverted, group };
}

/** One (time, 1/0) line per row, or an error naming the first row that could not be read. */
function survivalLines(
  body: string[][],
  cols: SurvivalColumns,
): { lines: { line: string; group: string }[] } | TableFeedError {
  const lines: { line: string; group: string }[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    const t = r[cols.time] ?? "";
    const e = r[cols.event] ?? "";
    if (isBlank(t) && isBlank(e)) continue;
    if (!isNumericCell(t)) return { error: `Row ${i + 1}: the time "${t}" is not a number.` };
    let flag = eventFlag(e);
    if (flag === null) {
      return {
        error:
          `Row ${i + 1}: the event value "${e}" is not recognised. Use 1/0, yes/no, TRUE/FALSE or event/censored. ` +
          "A code with more than two values (competing risks) cannot be read as a single event.",
      };
    }
    if (cols.inverted) flag = 1 - flag;
    lines.push({ line: `${numText(t)} ${flag}`, group: (r[cols.group ?? -1] ?? "").trim() });
  }
  return { lines };
}

function survivalNote(header: string[] | null, cols: SurvivalColumns): string {
  const ev = name(header, cols.event, `column ${cols.event + 1}`);
  return (
    `time = ${name(header, cols.time, `column ${cols.time + 1}`)}, event = ${ev}` +
    (cols.inverted ? ` (a censored flag: its 1 was read as censored, 0 as event)` : "")
  );
}

/** One subject per row: time then 1/0. A group column, if any, is reported as ignored. */
export function feedSurvival(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const cols = pickSurvivalColumns(header, body);
  if ("error" in cols) return cols;
  const got = survivalLines(body, cols);
  if ("error" in got) return got;
  if (got.lines.length < 2) return { error: "Fewer than two usable rows (time + 1/0 event)." };
  let note = `Read ${got.lines.length} subjects: ${survivalNote(header, cols)}.`;
  if (cols.group !== null) {
    note += ` The ${name(header, cols.group, `column ${cols.group + 1}`)} column was ignored — use Log-rank to compare groups.`;
  }
  return { text: got.lines.map((l) => l.line).join("\n"), note: note + commaNote(body) };
}

/** As survival, grouped into blocks by the group column (merged labels forward-filled). */
export function feedSurvivalGroups(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const cols = pickSurvivalColumns(header, body);
  if ("error" in cols) return cols;
  if (cols.group === null) {
    return { error: "Need a group column (a label per row, e.g. the treatment arm) beside time and event." };
  }
  const filled = forwardFill(body, cols.group);
  const got = survivalLines(body, cols);
  if ("error" in got) return got;
  const order: string[] = [];
  const blocks = new Map<string, string[]>();
  for (const l of got.lines) {
    if (l.group === "") return { error: "A row has no group label. Every row needs one (merged labels are filled from above)." };
    if (!blocks.has(l.group)) {
      blocks.set(l.group, []);
      order.push(l.group);
    }
    blocks.get(l.group)!.push(l.line);
  }
  if (order.length < 2) return { error: `Only one group ("${order[0] ?? ""}") — log-rank compares at least two.` };
  return {
    text: order.map((g) => blocks.get(g)!.join("\n")).join("\n\n"),
    note:
      `Read groups ${order.map((g, i) => `${i + 1} = ${g} (n ${blocks.get(g)!.length})`).join(", ")}; ${survivalNote(header, cols)}.` +
      (filled ? ` ${filled} merged group cell${filled === 1 ? "" : "s"} filled from the row above.` : "") +
      commaNote(body),
  };
}

/** A rectangular numeric block, one row per line. A leading id/label column is dropped. */
export function feedRows(rows: string[][], what: "regression" | "counts"): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const width = body[0].length;
  const col0 = column(body, 0);
  let start = 0;
  let dropped = "";
  // Counts never lose a column on a header word alone: "Case | Control" over
  // two rows of counts IS the table.
  if (
    width >= 2 &&
    (isTextColumn(col0) ||
      (what === "regression" && (isIdColumn(header, 0, col0) || (isRowCounter(col0) && numbers(col0).length === body.length))))
  ) {
    start = 1;
    dropped = ` The first column (${name(header, 0, isTextColumn(col0) ? "row labels" : "a row counter")}) was dropped.`;
  }
  const lines: string[] = [];
  for (const r of body) {
    const vals = r.slice(start);
    if (vals.every(isBlank)) continue;
    if (!vals.every(isNumericCell)) {
      return { error: "Every cell must be a number (blank cells and words are not allowed here)." };
    }
    lines.push(vals.map(numText).join(" "));
  }
  const cols = width - start;
  if (lines.length < 2 || cols < 2) return { error: "Need at least two rows and two numeric columns." };
  if (what === "regression") {
    const names = Array.from({ length: cols }, (_, k) => name(header, start + k, `column ${start + k + 1}`));
    return {
      text: lines.join("\n"),
      note: `Read ${lines.length} observations: response = ${names[0]}; predictors = ${names.slice(1).join(", ")}.` + dropped + commaNote(body),
    };
  }
  return {
    text: lines.join("\n"),
    note:
      `Read a ${lines.length} × ${cols} table of counts${header ? " (header row dropped)" : ""}.` +
      dropped +
      (header ? "" : " No header row found, so the first row was read as counts; if it holds category names, make it a header.") +
      commaNote(body),
  };
}

// --- two factors ----------------------------------------------------------

/** Factor level names must survive a whitespace/comma split downstream. */
const level = (s: string): string => s.trim().replace(/[\s,;]+/g, "_");

/**
 * Replicates in one crosstab cell: "10, 11", "10;11" or "10 11". In a
 * crosstab cell a COMMA IS A SEPARATOR, always — the note says so and tells
 * the user to write decimals with a dot here. The first version applied the
 * decimal-comma rule inside cells, so "10,11" was one value and "10, 11,12"
 * was two, one of them 11.12. A no-break space is not a separator: "1 200"
 * (NBSP) stays the one number it is everywhere else.
 */
function replicates(cell: string): string[] {
  const t = cell.trim();
  if (t === "") return [];
  return t.split(/\s*[;,]\s*|[ \t]+/).filter(Boolean);
}

/** A level NAME: filled, not a number, not a list of numbers. */
function isLabelCell(c: string): boolean {
  if (isBlank(c) || isNumericCell(c)) return false;
  const reps = replicates(c);
  return !(reps.length > 0 && reps.every(isNumericCell));
}

/** A crosstab's first row is its header: an empty corner cell, or all words
 *  over rows whose cells are numbers or replicate lists. */
function crosstabHeader(grid: string[][]): boolean {
  if (grid.length < 2 || grid[0].length < 3) return false;
  const first = grid[0];
  if (first.slice(1).some(isBlank)) return false;
  if (first.slice(1).some(isNumericCell)) return false;
  if (!isBlank(first[0]) && isNumericCell(first[0])) return false;
  return grid.slice(1).some((r) => r.slice(1).some((c) => replicates(c).length > 0 && replicates(c).every(isNumericCell)));
}

/**
 * Two factors. LONG — three columns A, B, value, with a header row or with
 * labels in the first two columns (numeric levels such as doses need the
 * header). Merged labels are forward-filled. CROSSTAB — row labels are A
 * levels, the header row names B levels, and each cell holds one value or a
 * list of replicates.
 */
export function feedFactorial(rows: string[][]): TableFeedResult {
  const grid = tidyGrid(rows);
  if (!grid.length) return { error: "The table is empty." };

  // CROSSTAB first: it has its own header rule, because a first data row made
  // of replicate lists has no "numeric cell" for the generic rule to see.
  if (crosstabHeader(grid)) {
    const header = grid[0];
    const body = grid.slice(1);
    const width = header.length;
    // Three columns can be either layout. A BLANK corner cell is a crosstab,
    // full stop. Otherwise it is the LONG one (A, B, value) when the second
    // column holds level NAMES, or when BOTH the first and second columns
    // repeat their values — factor levels recur, while a crosstab with
    // replicates on separate rows repeats its row label but not its values.
    const col1 = column(body, 1);
    const col1IsLabels = width === 3 && col1.every((c) => isBlank(c) || isLabelCell(c)) && col1.some((c) => !isBlank(c));
    const col0f = column(body, 0).filter((c) => !isBlank(c));
    const col1f = col1.filter((c) => !isBlank(c));
    const repeats = (xs: string[]): boolean => new Set(xs).size < xs.length;
    const bothRepeat = width === 3 && !isBlank(header[0]) && repeats(col0f) && repeats(col1f);
    if (!col1IsLabels && !bothRepeat) {
      const lines: string[] = [];
      for (const r of body) {
        const a = (r[0] ?? "").trim();
        if (isBlank(a)) return { error: "A crosstab row has no label in the first column." };
        for (let j = 1; j < width; j++) {
          const b = header[j].trim();
          for (const v of replicates(r[j] ?? "")) {
            if (!isNumericCell(v)) return { error: `Cell "${r[j]}" (row ${a}, ${b}) is not a number or list of numbers.` };
            lines.push(`${level(a)} ${level(b)} ${numText(v)}`);
          }
        }
      }
      if (lines.length < 4) return { error: "The crosstab holds fewer than four observations." };
      return {
        text: lines.join("\n"),
        note:
          `Read a crosstab: rows = levels of factor A (${name(header, 0, "first column")}), columns = levels of factor B ` +
          `(${header.slice(1).join(", ")}). Commas, semicolons or spaces inside a cell separate replicates, ` +
          "so decimals in a crosstab must use a dot.",
      };
    }
  }

  const { header, body } = split(grid);
  const width = body[0]?.length ?? 0;
  const longByHeader = width === 3 && header !== null;
  const longByContent = width === 3 && isTextColumn(column(body, 0)) && isTextColumn(column(body, 1));
  if (longByHeader || longByContent) {
    const fa = forwardFill(body, 0);
    const fb = forwardFill(body, 1);
    const lines: string[] = [];
    for (let i = 0; i < body.length; i++) {
      const r = body[i];
      if (r.every(isBlank)) continue;
      if (isBlank(r[0]) || isBlank(r[1]) || !isNumericCell(r[2] ?? "")) {
        return { error: `Row ${i + 1} is not "factor A, factor B, value" (a label is missing or the value is not a number).` };
      }
      lines.push(`${level(r[0])} ${level(r[1])} ${numText(r[2])}`);
    }
    if (lines.length < 4) return { error: "Need at least four rows of factor A, factor B, value." };
    return {
      text: lines.join("\n"),
      note:
        `Read ${lines.length} observations as ${name(header, 0, "factor A")} × ${name(header, 1, "factor B")} → ${name(header, 2, "value")}.` +
        (fa + fb ? ` ${fa + fb} merged label cell${fa + fb === 1 ? "" : "s"} filled from the row above.` : "") +
        commaNote(body),
    };
  }

  return {
    error:
      "Lay the table out as three columns — factor A, factor B, value — with a header row, or as a crosstab with " +
      "factor A levels down the first column and factor B levels across the header row.",
  };
}

/** Dispatch by shape, for the field renderer. */
export function feedTable(shape: TableShape, rows: string[][]): TableFeedResult {
  switch (shape) {
    case "groups":
      return feedGroups(rows);
    case "subjects":
      return feedSubjects(rows);
    case "survival":
      return feedSurvival(rows);
    case "survival-groups":
      return feedSurvivalGroups(rows);
    case "rows":
      return feedRows(rows, "regression");
    case "counts":
      return feedRows(rows, "counts");
    case "factorial":
      return feedFactorial(rows);
  }
}
