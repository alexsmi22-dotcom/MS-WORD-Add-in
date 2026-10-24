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
import { coxDummyCode, COX_MAX_LEVELS, type CoxInput, type CoxCovariate, type CoxFactor } from "./cox";

export type TableShape =
  /** Independent groups: one column per group, or a label column + a value column. */
  | "groups"
  /** Repeated measures: one row per subject, one column per condition. */
  | "subjects"
  /** As subjects (wide or long), plus an optional between-subject group: repeated-measures ANOVA. */
  | "subjects-between"
  /** One subject per row: time, event, covariates — Cox regression (header line of names first). */
  | "cox"
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
// "ND" / "n.d." / "n/d" (not determined) are the lab spellings of a missing value.
const NA_CELL = /^(n\/?a|nan|n\.?d\.?|n\/d|-|—|–|\.|null|none|missing|\?|#n\/a|#value!|#div\/0!)$/i;
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

/**
 * A header as WORDS, for every role test: `_`, `-`, `.` and a lower→Upper case
 * change break words ("OS_MONTHS" → "OS MONTHS", "survTime" → "surv Time").
 * `\b` does not break at `_`, so R / pandas / cBioPortal headers (time_months,
 * PATIENT_ID, OS_STATUS) used to match no role at all, and the content fallback
 * then took the first numeric column — the AGE — as the survival time.
 * Display always uses the header as typed; only the tests see this form.
 */
function hn(h: string | undefined): string {
  return (h ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.\-]+/g, " ");
}

function sharesLeadingWord(header: string[] | null, j: number): boolean {
  if (!header) return false;
  const w = (h: string | undefined): string => (h ?? "").trim().split(/[\s_\-.]+/)[0]?.toLowerCase() ?? "";
  const mine = w(header[j]);
  return mine !== "" && header.some((h, k) => k !== j && w(h) === mine);
}

/** Identifier column: an id header AND id-like content (text, a row counter, or all-distinct integers). */
function isIdColumn(header: string[] | null, j: number, cells: string[]): boolean {
  const h = header?.[j];
  // A subject word (Mouse, Rat, Donor, subject_id) is an id header too: the
  // two lists diverged, and a numeric Mouse 101–104 became a condition.
  if (!h || !(ID_EXACT.test(hn(h)) || SUBJECT_EXACT.test(hn(h))) || sharesLeadingWord(header, j)) return false;
  if (isTextColumn(cells)) return true;
  const v = cells.filter((c) => !isBlank(c)).map(num);
  if (!v.length || v.some((x) => !Number.isInteger(x))) return false;
  return new Set(v).size === v.length;
}

/** Category column: a category/id header AND level-like content (text, or integers that repeat — arms 1/1/2/2). */
function isCategoryColumn(header: string[] | null, j: number, cells: string[]): boolean {
  const h = header?.[j];
  if (!h || !(CATEGORY_EXACT.test(hn(h)) || ID_EXACT.test(hn(h))) || sharesLeadingWord(header, j)) return false;
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

  // ID | label | value (Patient | Arm | Score): the id is dropped and the rest
  // read as LONG. Read WIDE, the first version made "Arm" a group of arm codes
  // and compared it with "Score".
  // Same for Arm | Patient | Score (the id in the middle).
  for (const idCol of [0, 1]) {
    const cells = column(body, idCol);
    if (!(width === 3 && header && isIdColumn(header, idCol, cells) && !levelsRepeat(cells))) continue;
    const sub = feedGroups(tidyGrid(rows).map((r) => r.filter((_, k) => k !== idCol)));
    if ("text" in sub && sub.note.startsWith("Read as label + value")) {
      return { text: sub.text, note: sub.note + ` The ${name(header, idCol, "id")} column was dropped as an id.` };
    }
    const other = idCol === 0 ? 1 : 0;
    if ("error" in sub && isCategoryColumn(header, other, column(body, other))) return sub;
  }

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

// --- repeated measures ------------------------------------------------------

/**
 * THE SECOND LAYOUT CLASS (audit 2026-10-14, docs/SCOPE-STATS-BATCH.md §A
 * WRONG 1–6). The first subjects reader knew only WIDE, so every other way a
 * person lays out repeated measures became extra "conditions" and a confident
 * Friedman χ² on a design that does not exist:
 *   - LONG (Subject | Time | Score, as R, SPSS-restructured, GraphPad
 *     "stacked" and LIMS exports write it) read as 9 subjects × 3 conditions:
 *     χ²(2) = 14.73, p = 0.0006 where the truth is χ²(2) = 6, p = 0.0498;
 *   - the same with the subject label MERGED down its rows;
 *   - a GROUP column (Subject | Group | T1 | T2 | T3) read as a condition;
 *   - a covariate (Patient | Age | Day 1 | …) read as a condition;
 *   - unheaded subject ids that are not 1..n (101, 205, 309) read as data;
 *   - a TRANSPOSED table (Condition | S1 | S2 | …) that tested the subjects.
 * Each is a named rule below with its own test (statsLiveBugs.test.ts).
 */

/** A header naming the SUBJECT (the repeated unit). ID_EXACT plus the animals and people a lab writes. */
const SUBJECT_EXACT =
  /^\s*(id|ids|no\.?|#|subject|subj|patient|pt|participant|volunteer|respondent|person|individual|child|student|donor|animal|mouse|mice|rat|dog|pig|rabbit|monkey|case|specimen|sample|record|mrn)\s*(id|ids|no\.?|number|#|name|code)?\s*$/i;
/** A header naming the WITHIN factor of a long table: the time point / condition / visit. */
const CONDITION_EXACT =
  /^\s*(time|time ?point|timepoint|visit|week|day|month|hour|session|period|phase|occasion|condition|cond|treatment|trial|stage|dose|level|measurement|repetition|interval)s?\s*(no\.?|number|#|id|name|code|\([^)]*\))?\s*$/i;
/** A subject-level covariate: never a condition, excluded and said. */
const COVARIATE = /^\s*(age|weight|body ?weight|height|bmi|sex|gender|race|ethnicity)\b/i;
/** A between-subject factor. */
const BETWEEN_EXACT =
  /^\s*(group|arm|cohort|strat\w*|class|category|cat|batch|lot|genotype|strain|treatment\s+(group|arm)|allocation|randomi[sz]ation)\s*(id|no\.?|name|code)?\s*$/i;
/** Column headers that ARE subject labels: S1, Subject 2, Rat 3, P04… (a transposed table). */
const SUBJECT_LABEL = /^\s*(s|subj|subject|pt|patient|participant|id|rat|mouse|animal|donor|volunteer|case)\s*[-_#.]?\s*\d+\s*$/i;

const isSubjectHeader = (header: string[] | null, j: number): boolean =>
  !!header && SUBJECT_EXACT.test(hn(header[j])) && !sharesLeadingWord(header, j);
const isConditionHeader = (header: string[] | null, j: number): boolean =>
  !!header && CONDITION_EXACT.test(hn(header[j])) && !sharesLeadingWord(header, j);
const isCovariateHeader = (header: string[] | null, j: number): boolean =>
  !!header && COVARIATE.test(hn(header[j])) && !sharesLeadingWord(header, j);
const isBetweenHeader = (header: string[] | null, j: number): boolean =>
  !!header && BETWEEN_EXACT.test(hn(header[j])) && !sharesLeadingWord(header, j);

/** A repeated-measures table read into one row of numbers per subject. */
export interface SubjectsReading {
  /** One row per subject, one value per condition (as numeric text, the user's spelling where plain). */
  rows: string[][];
  subjects: string[];
  conditions: string[];
  /** A between-subject factor, when the table has one: its column name and each subject's level. */
  group: { name: string; levels: string[] } | null;
  /** How the table was read — every column accounted for. */
  note: string;
}

/** The refusal Friedman (and any within-only test) gives a table with a group column. */
const friedmanGroupError = (g: string): TableFeedError => ({
  error:
    `Friedman is within-subjects only; a group column (${g}) was found — use repeated-measures ANOVA (mixed design) ` +
    `to compare groups, or remove the ${g} column to test all subjects together.`,
});

const ordinal = (levels: string[]): string[] =>
  levels.every(isNumericCell) ? [...levels].sort((a, b) => num(a) - num(b)) : levels;

/**
 * LONG: a subject column whose ids repeat, a condition column whose levels
 * repeat once per subject, and one value column. Roles come from the HEADERS
 * (a subject word, a time/visit/condition word); content only confirms that
 * every subject × condition cell occurs exactly once. Returns null when the
 * table is not long, so the wide reader runs.
 */
function readLong(header: string[] | null, body: string[][]): SubjectsReading | TableFeedError | null {
  if (!header || body[0].length < 3) return null;
  const width = body[0].length;
  const idx = Array.from({ length: width }, (_, j) => j);
  let s = idx.find((j) => isSubjectHeader(header, j));
  const repeats = (j: number): boolean => {
    const v = column(body, j).filter((x) => !isBlank(x));
    return v.length >= 2 && new Set(v).size < v.length;
  };
  const sRepeats = (j: number): boolean => {
    const copy = body.map((r) => [...r]);
    forwardFill(copy, j);
    return repeats(j) || column(copy, j).some((x, i) => isBlank(column(body, j)[i]) && !isBlank(x));
  };
  if (s !== undefined && !sRepeats(s)) s = undefined;
  // Several condition-like headers (Subject | Treatment | Time | Score): the
  // WITHIN factor is the one that varies inside each subject — it crosses the
  // subject column. Treatment, constant per subject, is then a between label.
  // The first version took the first condition word and refused the table.
  const condCands = idx.filter((j) => j !== s && isConditionHeader(header, j) && repeats(j));
  let c: number | undefined = condCands[0];
  if (s !== undefined && condCands.length > 1) {
    const within = condCands.filter((j) => crosses(body, s!, j));
    if (within.length > 1) {
      return {
        error:
          `Two columns vary within each subject (${within.map((j) => header[j]).join(", ")}) — a two-way within design. ` +
          "Keep one within factor (one row per subject × condition).",
      };
    }
    c = within[0] ?? condCands[0];
  }
  if (s === undefined && c === undefined) return null;
  if (s === undefined || c === undefined) {
    // One role named, the other only implied: confirm by content — the other
    // column must cross the named one exactly (each pair once, same levels).
    const named = (s ?? c)!;
    const crossing = idx.filter(
      (j) => j !== named && !isCovariateHeader(header, j) && !isBetweenHeader(header, j) && repeats(j) && crosses(body, s ?? j, c ?? j),
    );
    if (crossing.length !== 1) {
      if (s !== undefined) {
        return {
          error:
            `The ${header[s]} column repeats, so this looks like LONG format (one row per subject × condition), but no ` +
            "condition column could be told apart. Name it Time, Visit or Condition — or lay the table out with one row " +
            "per subject and one column per condition.",
        };
      }
      return null;
    }
    if (s === undefined) s = crossing[0];
    else c = crossing[0];
  }
  const si = s as number;
  const ci = c as number;
  const sName = name(header, si, "Subject");
  const cName = name(header, ci, "Condition");
  const filled = forwardFill(body, si);

  // Every other column: a covariate (excluded, said), a group (between factor),
  // or the value. Nothing is dropped silently, and two value columns are a question.
  const covariates: string[] = [];
  let group: number | null = null;
  const valueCols: number[] = [];
  const constantPerSubject = (j: number): boolean => {
    const seen = new Map<string, string>();
    return body.every((r) => {
      const sid = (r[si] ?? "").trim();
      const g = (r[j] ?? "").trim();
      if (isBlank(g)) return true;
      const prev = seen.get(sid);
      seen.set(sid, g);
      return prev === undefined || prev === g;
    });
  };
  for (const j of idx) {
    if (j === si || j === ci) continue;
    const cells = column(body, j);
    const labelHeader = isConditionHeader(header, j) || CATEGORY_EXACT.test(hn(header[j]));
    if (isCovariateHeader(header, j)) covariates.push(name(header, j, `column ${j + 1}`));
    else if (
      isBetweenHeader(header, j) ||
      isTextColumn(cells) ||
      isMixedColumn(cells) ||
      (labelHeader && repeats(j) && constantPerSubject(j))
    ) {
      if (group !== null) {
        return { error: `Two group-like columns (${header[group]}, ${header[j]}) — keep the one between-subject factor.` };
      }
      group = j;
    } else valueCols.push(j);
  }
  if (valueCols.length !== 1) {
    return {
      error: valueCols.length
        ? `Long format with several value columns (${valueCols.map((j) => name(header, j, `column ${j + 1}`)).join(", ")}) — ` +
          "keep the one measurement to analyse."
        : `Long format (${sName} × ${cName}) but no value column was found.`,
    };
  }
  const vi = valueCols[0];
  const vName = name(header, vi, "value");
  // A group label MERGED down its rows (Excel) arrives on the first row only:
  // filled from above, as the subject label is, and said.
  const gFilled = group !== null && !isBlank(body[0][group] ?? "") ? forwardFill(body, group) : 0;

  const subjects: string[] = [];
  const levelsSeen: string[] = [];
  const cell = new Map<string, Map<string, string>>();
  const groupOf = new Map<string, string>();
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    if (r.every(isBlank)) continue;
    const sid = (r[si] ?? "").trim();
    const lv = (r[ci] ?? "").trim();
    const v = r[vi] ?? "";
    if (isBlank(sid) || isBlank(lv)) return { error: `Row ${i + 1} has no ${isBlank(sid) ? sName : cName}.` };
    if (!isNumericCell(v)) return { error: `${sName} ${sid}, ${cName} ${lv}: the ${vName} "${v}" is not a number.` };
    if (!cell.has(sid)) {
      cell.set(sid, new Map());
      subjects.push(sid);
    }
    if (!levelsSeen.includes(lv)) levelsSeen.push(lv);
    const m = cell.get(sid)!;
    if (m.has(lv)) return { error: `${sName} ${sid} has ${cName} ${lv} more than once — each subject needs one value per condition.` };
    m.set(lv, numText(v));
    if (group !== null) {
      const g = (r[group] ?? "").trim();
      const prev = groupOf.get(sid);
      if (prev !== undefined && g !== "" && prev !== g) {
        return { error: `${sName} ${sid} is in two ${header[group]} levels (${prev}, ${g}) — a between-subject factor is fixed per subject.` };
      }
      if (prev === undefined || prev === "") groupOf.set(sid, g);
    }
  }
  const levels = ordinal(levelsSeen);
  for (const sid of subjects) {
    const missing = levels.filter((lv) => !cell.get(sid)!.has(lv));
    if (missing.length) {
      return {
        error:
          `${sName} ${sid} has no value for ${missing.map((lv) => `${cName} ${lv}`).join(", ")}. ` +
          "Every subject needs a value under every condition (a ragged repeated-measures design is not padded).",
      };
    }
  }
  if (subjects.length < 2 || levels.length < 2) {
    return { error: "Need at least two subjects and two conditions." };
  }
  const note =
    `Read long format: ${sName} × ${cName} → ${vName}, ${subjects.length} subjects × ${levels.length} conditions ` +
    `(${cName}: ${levels.join(", ")}).` +
    (filled ? ` ${filled} merged subject cell${filled === 1 ? "" : "s"} filled from the row above.` : "") +
    (gFilled ? ` ${gFilled} merged ${header[group!]} cell${gFilled === 1 ? "" : "s"} filled from the row above.` : "") +
    (covariates.length ? ` ${covariates.join(", ")} excluded (a subject covariate, not a condition).` : "") +
    commaNote(body);
  return {
    rows: subjects.map((sid) => levels.map((lv) => cell.get(sid)!.get(lv)!)),
    subjects,
    conditions: levels.map((lv) => `${cName} ${lv}`),
    group: group === null ? null : { name: name(header, group, "group"), levels: subjects.map((sid) => groupOf.get(sid) ?? "") },
    note,
  };
}

/** Columns a (subject) and b (condition) cross exactly: every subject has every level once. */
function crosses(body: string[][], a: number, b: number): boolean {
  if (a === b) return false;
  const copy = body.map((r) => [...r]);
  forwardFill(copy, a);
  const per = new Map<string, Set<string>>();
  let rowsSeen = 0;
  for (const r of copy) {
    const x = (r[a] ?? "").trim();
    const y = (r[b] ?? "").trim();
    if (isBlank(x) || isBlank(y)) return false;
    if (!per.has(x)) per.set(x, new Set());
    const set = per.get(x)!;
    if (set.has(y)) return false;
    set.add(y);
    rowsSeen++;
  }
  const sets = [...per.values()];
  if (sets.length < 2 || sets[0].size < 2) return false;
  const first = [...sets[0]].sort().join("\u0000");
  return sets.every((st) => [...st].sort().join("\u0000") === first) && rowsSeen === sets.length * sets[0].size;
}

/** A between-subject factor's levels recur across subjects; a label distinct on every row is the subject. */
function levelsRepeat(cells: string[]): boolean {
  const v = cells.filter((c) => !isBlank(c)).map((c) => c.trim());
  return v.length >= 2 && new Set(v).size < v.length;
}

/** Distinct whole numbers in an unheaded first column that read as ids, not as condition 1 (rule d). */
function looksLikeUnheadedIds(body: string[][]): boolean {
  const col0 = column(body, 0);
  if (!col0.every(isNumericCell)) return false;
  const v = col0.map(num);
  if (v.some((x) => !Number.isInteger(x)) || new Set(v).size !== v.length || isRowCounter(col0)) return false;
  const n = v.length;
  const permutation = n >= 3 && [...v].sort((a, b) => a - b).every((x, i) => x === i + 1);
  const rest = body.flatMap((r) => r.slice(1)).filter(isNumericCell).map(num);
  if (!rest.length) return false;
  const lo = Math.min(...rest);
  const hi = Math.max(...rest);
  return permutation || v.every((x) => x > hi) || v.every((x) => x < lo);
}

/**
 * Repeated measures, read in full: LONG (pivoted), or WIDE (one row per
 * subject). A between-subject group column is RETURNED, not used — the caller
 * decides (Friedman refuses it; a mixed-design ANOVA reads it). This is the
 * reader a `subjects-between` shape should share.
 */
export function readSubjectsTable(rows: string[][]): SubjectsReading | TableFeedError {
  // TWO header rows (a merged "Time" banner over 0 h | 2 h | 4 h): neither is
  // data, and reading the second as a subject garbled the refusal. Asked by name.
  const grid = tidyGrid(rows);
  if (grid.length >= 3 && !grid[0].some(isNumericCell) && !grid[1].some(isNumericCell) && grid[2].some(isNumericCell)) {
    const show = (r: string[]): string => r.filter((c) => !isBlank(c)).join(" | ");
    return {
      error:
        `Two header rows found ("${show(grid[0])}" over "${show(grid[1])}"). Merge them into ONE header row ` +
        "(e.g. Subject | Time 0 h | Time 2 h | …) and try again.",
    };
  }
  const { header, body: all } = split(rows);
  if (!all.length) return { error: "The table is empty." };
  // Summary rows (Total, Mean, SD…) under text subject labels are not subjects:
  // dropped and said. §A had "a Mean row … refused" as RIGHT; a Total row was
  // read as one more subject.
  const SUMMARY = /^\s*(total|totals|sum|mean|means|average|avg|median|sd|s\.?d\.?|std\.?\s*dev\.?|standard deviation|sem|s\.?e\.?m?\.?|se|n|count|grand total)\s*:?\s*$/i;
  const summaryRows: string[] = [];
  const body = isTextColumn(column(all, 0))
    ? all.filter((r) => {
        if (SUMMARY.test(r[0] ?? "")) {
          summaryRows.push((r[0] ?? "").trim());
          return false;
        }
        return true;
      })
    : all;
  if (!body.length) return { error: "The table holds only summary rows." };
  const summaryNote = summaryRows.length
    ? ` Summary row${summaryRows.length === 1 ? "" : "s"} (${summaryRows.join(", ")}) dropped — not subjects.`
    : "";
  const long = readLong(header, body);
  if (long) return "error" in long ? long : { ...long, note: long.note + summaryNote };

  const width = body[0].length;
  const col0 = column(body, 0);

  // (e) TRANSPOSED: conditions down the rows, subjects across the columns.
  if (header && width >= 3) {
    const rest = header.slice(1).filter((h) => !isBlank(h));
    const subjectHeads = rest.length >= 2 && rest.length === width - 1 && rest.every((h) => SUBJECT_LABEL.test(h));
    const conditionRows = isConditionHeader(header, 0) && new Set(col0.filter((x) => !isBlank(x))).size === col0.filter((x) => !isBlank(x)).length;
    if (conditionRows || (subjectHeads && (isBlank(header[0]) || isConditionHeader(header, 0)))) {
      return {
        error:
          "The subjects are in COLUMNS — transpose the table (one row per subject), with one column per condition, and try again. " +
          `Read as it stands, the test would compare the subjects (${rest.slice(0, 3).join(", ")}${rest.length > 3 ? ", …" : ""}), not the conditions.`,
      };
    }
  }
  // Unheaded LONG (1 1 5 / 1 2 7 / … / 2 1 4 …): the first two columns cross
  // exactly, the signature of subject × condition keys. Without a header the
  // roles would be a guess, so ask.
  if (!header && width >= 3 && (crosses(body, 0, 1) || crosses(body, 1, 0))) {
    return {
      error:
        "The first two columns look like subject × condition keys (long format: one row per subject per condition). " +
        "Add a header row (e.g. Subject | Time | Score) so the table can be pivoted without guessing.",
    };
  }
  // (d) Unheaded first column of distinct whole numbers that are not 1..n in order.
  if (!header && width >= 3 && looksLikeUnheadedIds(body)) {
    const shown = col0.slice(0, 3).map((x) => x.trim()).join(", ");
    return {
      error:
        `The first column (${shown}${col0.length > 3 ? ", …" : ""}) holds distinct whole numbers — is it an id or a measurement? ` +
        "Add a header row (e.g. Subject | Pre | Post) so the table can be read without guessing.",
    };
  }

  // WIDE. Every column is classified: id (dropped), covariate (excluded),
  // group (between factor), or condition. Each non-condition is said.
  const dropped: string[] = [];
  let droppedFirst = false;
  const covariates: string[] = [];
  let group: number | null = null;
  const conds: number[] = [];
  for (let j = 0; j < width; j++) {
    const cells = column(body, j);
    const h = name(header, j, j === 0 ? "subject ids" : `column ${j + 1}`);
    if (j === 0 && (isIdColumn(header, 0, cells) || (isRowCounter(cells) && numbers(cells).length === body.length))) {
      dropped.push(h);
      droppedFirst = true;
    } else if (isSubjectHeader(header, j) && (isTextColumn(cells) || isIdColumn(header, j, cells))) {
      dropped.push(h);
    } else if (isCovariateHeader(header, j)) {
      covariates.push(h);
    } else if (
      (isBetweenHeader(header, j) || CATEGORY_EXACT.test(header?.[j] ?? "")) &&
      isCategoryColumn(header, j, cells) &&
      levelsRepeat(cells)
    ) {
      if (group !== null) return { error: `Two group-like columns (${header![group]}, ${h}) — keep the one between-subject factor.` };
      group = j;
    } else if (j === 0 && isTextColumn(cells)) {
      dropped.push(h);
      droppedFirst = true;
    } else if (isTextColumn(cells) && !levelsRepeat(cells)) {
      // A word on every row, all different: a second label column (a subject
      // name beside a code). Dropped and said — never a condition.
      dropped.push(h);
    } else if (isTextColumn(cells)) {
      if (group !== null) return { error: `Two columns of words (${header?.[group] ?? `column ${group + 1}`}, ${h}) — keep one row label column.` };
      group = j;
    } else {
      conds.push(j);
    }
  }
  const lines: string[][] = [];
  const subjects: string[] = [];
  const levels: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    const vals = conds.map((j) => r[j] ?? "");
    if (vals.every(isBlank)) continue;
    const bad = vals.findIndex((v) => !isNumericCell(v));
    if (bad >= 0) {
      const who = dropped.length && (isTextColumn(col0) || isIdColumn(header, 0, col0)) ? `Subject ${(r[0] ?? "").trim()}` : `Subject row ${i + 1}`;
      const what = name(header, conds[bad], `condition ${bad + 1}`);
      return {
        error:
          `Every subject row needs a number in every condition column — a blank or a word was found: ${who} has ` +
          `${isBlank(vals[bad]) ? "no value" : `"${vals[bad].trim()}"`} for ${what}. Missing values are not imputed.`,
      };
    }
    lines.push(vals.map(numText));
    subjects.push(dropped.length && (isTextColumn(col0) || isIdColumn(header, 0, col0)) ? (r[0] ?? "").trim() : String(lines.length));
    if (group !== null) levels.push((r[group] ?? "").trim());
  }
  if (lines.length < 2 || conds.length < 2) {
    return { error: "Need at least two subject rows and two condition columns." };
  }
  const condNames = conds.map((j, k) => name(header, j, `condition ${k + 1}`));
  const note =
    `Read ${lines.length} subject rows × ${condNames.length} conditions: ${condNames.join(", ")}.` +
    (dropped.length === 1
      ? ` The ${droppedFirst ? "first column" : "id column"} (${dropped[0]}) was dropped.`
      : dropped.length
        ? ` The id columns (${dropped.join(", ")}) were dropped.`
        : "") +
    (covariates.length ? ` ${covariates.join(", ")} excluded (a subject covariate, not a condition).` : "") +
    summaryNote +
    commaNote(body);
  return {
    rows: lines,
    subjects,
    conditions: condNames,
    group: group === null ? null : { name: name(header, group, `column ${group + 1}`), levels },
    note,
  };
}

/** Repeated measures for a WITHIN-ONLY test (Friedman): one line per subject, one value per condition. */
export function feedSubjects(rows: string[][]): TableFeedResult {
  const r = readSubjectsTable(rows);
  if ("error" in r) return r;
  if (r.group) return friedmanGroupError(r.group.name);
  return { text: r.rows.map((x) => x.join(" ")).join("\n"), note: r.note };
}

/**
 * A between-subject level as a field TOKEN that no number parser can read as a
 * value: spaces → "_", and a numeric code is prefixed with the column name
 * (arms 1/2 → "Arm_1"/"Arm_2"; "Dose 10" → "Dose_10").
 */
export function betweenLabel(groupName: string, level: string): string {
  const safe = (s: string): string => s.trim().replace(/[\s,;]+/g, "_");
  const t = safe(level);
  return isNumericCell(level) || Number.isFinite(Number(t)) ? `${safe(groupName) || "group"}_${t}` : t;
}

/** Repeated measures WITH an optional between-subject factor — what rmAnova(rows, groups) takes. */
export interface SubjectsBetweenReading {
  rows: number[][];
  /** One label per subject (sanitised by betweenLabel), or undefined for a one-way design. */
  groups?: string[];
  subjects: string[];
  conditions: string[];
  groupName: string | null;
  note: string;
}

/**
 * `subjects-between` (repeated-measures ANOVA, one within factor, optionally
 * one between factor). Same reader as Friedman — wide or long, every rule the
 * same — except that a group column is ACCEPTED as the between factor.
 */
export function readSubjectsBetween(rows: string[][]): SubjectsBetweenReading | TableFeedError {
  const r = readSubjectsTable(rows);
  if ("error" in r) return r;
  let groups: string[] | undefined;
  let groupNote = "";
  if (r.group) {
    const g = r.group;
    const blank = g.levels.findIndex((x) => isBlank(x));
    if (blank >= 0) return { error: `Subject ${r.subjects[blank]} has no ${g.name}. Every subject needs a group label.` };
    groups = g.levels.map((x) => betweenLabel(g.name, x));
    const order: string[] = [];
    for (const x of groups) if (!order.includes(x)) order.push(x);
    if (order.length < 2) {
      return { error: `Only one ${g.name} level (${order[0]}) — remove the column for a one-way repeated-measures design.` };
    }
    groupNote =
      ` Between-subject factor: ${g.name} (${order.map((x) => `${x}, n ${groups!.filter((y) => y === x).length}`).join("; ")}).`;
  }
  return {
    rows: r.rows.map((x) => x.map(num)),
    groups,
    subjects: r.subjects,
    conditions: r.conditions,
    groupName: r.group?.name ?? null,
    note: r.note + groupNote,
  };
}

/** Field text: one line per subject, the between label (if any) as the FIRST token, then the values. */
export function feedSubjectsBetween(rows: string[][]): TableFeedResult {
  const r = readSubjectsBetween(rows);
  if ("error" in r) return r;
  return {
    text: r.rows.map((x, i) => (r.groups ? `${r.groups[i]} ` : "") + x.map(fmt).join(" ")).join("\n"),
    note: r.note,
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

function headerRole(raw: string): HeaderRole {
  const h = hn(raw);
  if (TIME_NAMED.test(h) && !AGE_LIKE.test(h)) return "time";
  if (STATUS_WORDS.test(h)) return "event";
  if (TIME_SURV.test(h)) return "time";
  if (EVENT_WORDS.test(h)) return "event";
  if (UNIT_WORDS.test(h) && !AGE_LIKE.test(h)) return "timeWeak";
  return "none";
}
/**
 * Among time headers: one naming the ENDPOINT (survival, OS, PFS, follow-up,
 * "time to event", "days to death") wins; then one that starts with "time"
 * ("Time" over "Treatment duration"); a "time since / from X" header is a
 * baseline covariate ("Time since diagnosis") and loses to all of them. A tie
 * at the top is refused by name — two endpoints, or two plausible times, is a
 * question for the user, never a pick.
 */
function timeRank(raw: string): number {
  const h = hn(raw);
  if (TIME_SURV.test(h) || /\bfollow\s*up\b|\b(time|days?|weeks?|months?|years?)\s+(to|until)\b|\bevent\s+time\b/i.test(h)) return 3;
  if (/\btime\s+(since|from)\b/i.test(h)) return 0;
  return /^\s*time\b/i.test(h) ? 2 : 1;
}

/** 1 / 0 from the ways people write an event flag; null when unrecognised. */
function eventFlag(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (["1", "1.0", "true", "yes", "y", "event", "dead", "died", "death", "deceased", "failed", "failure", "relapse"].includes(t)) return 1;
  if (["0", "0.0", "false", "no", "n", "censored", "censor", "alive", "living", "lost", "withdrawn", "none"].includes(t)) return 0;
  return null;
}

interface SurvivalColumns {
  /** The time column — the STOP column in start/stop (counting-process) format. */
  time: number;
  /** Start/stop format: the START column; time = Stop − Start. */
  start: number | null;
  event: number;
  /** The event column is a CENSORED flag: 1 means censored, so invert. */
  inverted: boolean;
  group: number | null;
  /** Subject-id columns: never time, event or group. */
  ids: number[];
}

/**
 * START/STOP (counting-process) format — `ID | Start | Stop | Event`, as R's
 * Surv(start, stop, event) and every time-varying-covariate export write it.
 * Neither "Start" nor "Stop" names a time on its own, so the first version fell
 * through to "the first numeric column that is not 0/1" — the patient ID — and
 * Kaplan–Meier ran on the patient numbers (audit §A WRONG 7). The pair is now
 * recognised by name, and an ID column is never a candidate for anything.
 */
const START_HEAD = /^\s*(start|t\.?\s*start|tstart|entry|enter|begin|time\s*0|start\s*time|entry\s*time)\b/i;
const STOP_HEAD = /^\s*(stop|t\.?\s*stop|tstop|end|exit|time\s*1|stop\s*time|end\s*time|exit\s*time)\b/i;

/** Strictly increasing whole numbers: a key column (101, 102, 103…), not a measurement. */
function isIncreasingKey(cells: string[]): boolean {
  const v = cells.filter((c) => !isBlank(c));
  if (v.length < 3 || !v.every(isNumericCell)) return false;
  const x = v.map(num);
  return x.every((y, i) => Number.isInteger(y) && (i === 0 || y > x[i - 1]));
}

function pickSurvivalColumns(header: string[] | null, body: string[][]): SurvivalColumns | TableFeedError {
  const width = body[0].length;
  const idx = Array.from({ length: width }, (_, j) => j);
  let time = -1;
  let event = -1;
  let inverted = false;
  let group: number | null = null;
  let start: number | null = null;
  // An id: an id-like header AND a distinct value on every row ("Site" A/A/B/B
  // is a group, not an id). In start/stop data a SUBJECT header that repeats is
  // still the id — the repeats are what checkCountingProcess looks for.
  const distinct = (j: number): boolean => {
    const v = column(body, j).filter((c) => !isBlank(c)).map((c) => c.trim());
    return v.length > 0 && new Set(v).size === v.length;
  };
  const ids = header
    ? idx.filter(
        (j) =>
          (isSubjectHeader(header, j) || ID_EXACT.test(hn(header[j]))) &&
          (distinct(j) || /^\s*(id|subject|subj|patient|pt|participant)\b/i.test(hn(header[j]))),
      )
    : [];
  const free = (j: number): boolean => !ids.includes(j);
  if (header) {
    const h = header.map((x) => hn(x));
    const st = idx.find((j) => free(j) && START_HEAD.test(h[j]));
    const sp = idx.find((j) => free(j) && j !== st && STOP_HEAD.test(h[j]));
    if (st !== undefined && sp !== undefined) {
      start = st;
      time = sp;
    }
    const roles = h.map((x, j) => (!free(j) || j === start ? "none" : /^\s*t\s*$/i.test(x) ? "time" : headerRole(x)));
    if (time < 0) {
      const times = idx.filter((j) => roles[j] === "time").sort((a, b) => timeRank(h[b]) - timeRank(h[a]));
      if (times.length >= 2 && timeRank(h[times[0]]) === timeRank(h[times[1]])) {
        const a = name(header, times[0], "");
        const b = name(header, times[1], "");
        return {
          error:
            `Two time columns found (${a}, ${b}) — two endpoints, or a time and a covariate. Choose one: remove or rename ` +
            "the other (in Cox it would enter the model as a covariate, which is never what a second endpoint is).",
        };
      }
      time = times[0] ?? idx.find((j) => roles[j] === "timeWeak") ?? -1;
    }
    event = idx.find((j) => roles[j] === "event" && j !== time) ?? -1;
    // "Censored" is an inverted flag; "Status"/"Event" beside it are not.
    inverted = event >= 0 && /censor/i.test(h[event]) && !/\b(status|event)\b/i.test(h[event]);
    const rest = idx.filter((j) => j !== time && j !== event && j !== start && free(j));
    group =
      rest.find((j) => GROUP_NAMED.test(h[j])) ??
      rest.find((j) => isTextColumn(column(body, j)) && !COVARIATE.test(h[j])) ??
      rest.find((j) => isCategoryColumn(header, j, column(body, j))) ??
      rest.find((j) => isTextColumn(column(body, j))) ??
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
    // first all-0/1 column other than it is the event flag. An id column, a
    // row counter, a start column and (beside a header) a strictly increasing
    // key are never the time — sorted survival times in an unheaded two-column
    // table still are, because there is no id to confuse them with.
    // "Age is never time" holds here too, with weight, BMI and the rest: the
    // first version applied it only to header roles, so `age | time_months`
    // (before headers were split at "_") fell through to here and took AGE.
    const numericCols = idx.filter(
      (j) => free(j) && j !== start && numbers(column(body, j)).length >= 2 && !(header && COVARIATE.test(hn(header[j]))),
    );
    if (time < 0) {
      const cands = numericCols.filter((j) => j !== event && !eventLike(j));
      const notKey = cands.filter((j) => !(header && isIncreasingKey(column(body, j))) && !(width > 2 && isRowCounter(column(body, j))));
      if (notKey.length) time = notKey[0];
      else if (cands.length && width > 2) {
        return {
          error:
            `The only candidate for time (${name(header, cands[0], `column ${cands[0] + 1}`)}) is a run of increasing whole ` +
            "numbers, which is what an id looks like. Name the time column in the header (e.g. Time) and try again.",
        };
      } else time = cands[0] ?? -1;
    }
    if (event < 0) event = idx.find((j) => free(j) && j !== time && j !== start && eventLike(j)) ?? -1;
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
      if (j !== time && j !== event && j !== start && free(j) && (isTextColumn(column(body, j)) || isCategoryColumn(header, j, column(body, j)))) {
        group = j;
        break;
      }
    }
  }
  return { time, start, event, inverted, group, ids };
}

/** Start/stop tables: one interval per subject, or refused by name (several = time-varying data). */
function checkCountingProcess(header: string[] | null, body: string[][], cols: SurvivalColumns): TableFeedError | null {
  if (cols.start === null) return null;
  const MULTI =
    "This is counting-process data with several intervals per subject (start/stop rows) — counting-process data with " +
    "several intervals per subject is not supported by Kaplan–Meier here: the intervals of one subject would be counted " +
    "as different subjects. Use a Cox model with time-varying covariates (R: coxph(Surv(start, stop, event) ~ …)), or " +
    "reduce the table to one row per subject (first entry, last exit, final status).";
  const rows = body.filter((r) => !r.every(isBlank));
  const id = cols.ids[0];
  if (id !== undefined) {
    const v = rows.map((r) => (r[id] ?? "").trim());
    if (v.some(isBlank) || new Set(v).size < v.length) return { error: MULTI };
  } else if (rows.some((r) => isNumericCell(r[cols.start!] ?? "") && num(r[cols.start!]) !== 0)) {
    return {
      error:
        `Start/stop format without a subject ID column: whether a row with ${name(header, cols.start, "Start")} > 0 is a ` +
        "late entry or a subject's second interval cannot be told. Add the ID column (one row per subject is supported).",
    };
  }
  return null;
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
    let time = numText(t);
    if (cols.start !== null) {
      const s = r[cols.start] ?? "";
      if (!isNumericCell(s)) return { error: `Row ${i + 1}: the start "${s}" is not a number.` };
      if (!(num(t) > num(s))) return { error: `Row ${i + 1}: Stop (${t.trim()}) is not after Start (${s.trim()}).` };
      // Subtract in decimal places, not floats: 12.3 − 2.1 must print 10.2.
      const dp = Math.max(...[t, s].map((x) => (cellNumberText(x).split(".")[1] ?? "").length));
      time = num(s) === 0 ? numText(t) : fmt(Number((num(t) - num(s)).toFixed(Math.min(dp, 12))));
    }
    let flag = eventFlag(e);
    if (flag === null) {
      return {
        error:
          `Row ${i + 1}: the event value "${e}" is not recognised. Use 1/0, yes/no, TRUE/FALSE or event/censored. ` +
          "A code with more than two values (competing risks) cannot be read as a single event.",
      };
    }
    if (cols.inverted) flag = 1 - flag;
    lines.push({ line: `${time} ${flag}`, group: (r[cols.group ?? -1] ?? "").trim() });
  }
  return { lines };
}

function survivalNote(header: string[] | null, body: string[][], cols: SurvivalColumns): string {
  const ev = name(header, cols.event, `column ${cols.event + 1}`);
  const stop = name(header, cols.time, `column ${cols.time + 1}`);
  let time = `time = ${stop}`;
  if (cols.start !== null) {
    const st = name(header, cols.start, `column ${cols.start + 1}`);
    const allZero = body.every((r) => r.every(isBlank) || num(r[cols.start!] ?? "") === 0);
    time = allZero
      ? `time = ${stop} (Start/Stop format, one interval per subject; every ${st} is 0)`
      : `time = Stop − Start (${stop} − ${st}; Start/Stop format, one interval per subject: time since entry — ` +
        "a late entry is NOT treated as left truncation)";
  }
  return time + `, event = ${ev}` + (cols.inverted ? ` (a censored flag: its 1 was read as censored, 0 as event)` : "");
}

/** Every column the reading did not use, named — nothing vanishes unmentioned. */
function unusedColumns(header: string[] | null, width: number, used: (number | null)[], ids: number[]): string {
  const rest = Array.from({ length: width }, (_, j) => j).filter((j) => !used.includes(j));
  if (!rest.length) return "";
  const names = rest.map((j) => name(header, j, `column ${j + 1}`) + (ids.includes(j) ? " (id)" : ""));
  return ` Not used: ${names.join(", ")}.`;
}

/** One subject per row: time then 1/0. A group column, if any, is reported as ignored. */
export function feedSurvival(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const cols = pickSurvivalColumns(header, body);
  if ("error" in cols) return cols;
  const cp = checkCountingProcess(header, body, cols);
  if (cp) return cp;
  const got = survivalLines(body, cols);
  if ("error" in got) return got;
  if (got.lines.length < 2) return { error: "Fewer than two usable rows (time + 1/0 event)." };
  let note = `Read ${got.lines.length} subjects: ${survivalNote(header, body, cols)}.`;
  if (cols.group !== null) {
    note += ` The ${name(header, cols.group, `column ${cols.group + 1}`)} column was ignored — use Log-rank to compare groups.`;
  }
  note += unusedColumns(header, body[0].length, [cols.time, cols.start, cols.event, cols.group], cols.ids);
  return { text: got.lines.map((l) => l.line).join("\n"), note: note + commaNote(body) };
}

/** As survival, grouped into blocks by the group column (merged labels forward-filled). */
export function feedSurvivalGroups(rows: string[][]): TableFeedResult {
  const { header, body } = split(rows);
  if (!body.length) return { error: "The table is empty." };
  const cols = pickSurvivalColumns(header, body);
  if ("error" in cols) return cols;
  const cp = checkCountingProcess(header, body, cols);
  if (cp) return cp;
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
      `Read groups ${order.map((g, i) => `${i + 1} = ${g} (n ${blocks.get(g)!.length})`).join(", ")}; ${survivalNote(header, body, cols)}.` +
      (filled ? ` ${filled} merged group cell${filled === 1 ? "" : "s"} filled from the row above.` : "") +
      unusedColumns(header, body[0].length, [cols.time, cols.start, cols.event, cols.group], cols.ids) +
      commaNote(body),
  };
}

// --- Cox regression -----------------------------------------------------------

/** What readCoxTable hands coxRegression, plus the note. */
export interface CoxTableReading {
  input: CoxInput;
  /** The header line for the field text: time, event, then each covariate (indicators after dummy coding). */
  names: string[];
  note: string;
}

const coxSafe = (s: string): string => s.trim().replace(/[\s,;]+/g, "_");

/**
 * `cox`: one subject per row — time, event, covariates. Time and event come
 * from the SAME picker as Kaplan–Meier (a "Censored" column is inverted and
 * said; 1/2 coding is refused by row; an ID is never time; "Age" is never
 * time). Every other column is an id (dropped, said), a numeric covariate, or
 * a text covariate dummy-coded k−1 with the reference SAID (coxDummyCode:
 * alphabetical reference, as R; > 10 levels refused as an id). Start/stop data
 * is refused by name. A blank covariate cell refuses its row — no silent
 * complete-case drop. The note lists every column and its role.
 */
export function readCoxTable(rows: string[][]): CoxTableReading | TableFeedError {
  const { header, body: raw } = split(rows);
  if (!raw.length) return { error: "The table is empty." };
  if (!header) {
    return { error: "Cox regression needs a header row naming the columns (e.g. Time | Status | Age | Treatment)." };
  }
  const body = raw.filter((r) => !r.every(isBlank));
  const cols = pickSurvivalColumns(header, body);
  if ("error" in cols) return cols;
  if (cols.start !== null) {
    return {
      error:
        `Start/stop columns (${header[cols.start]}, ${header[cols.time]}) — time-varying covariates are not supported; ` +
        "give one row per subject (time from origin to event or censoring).",
    };
  }
  for (let i = 0; i < body.length; i++) {
    if (isBlank(body[i][cols.time] ?? "") && isBlank(body[i][cols.event] ?? "")) {
      return { error: `Row ${i + 1} has no time and no event. Fill it in or remove the row.` };
    }
  }
  const got = survivalLines(body, cols);
  if ("error" in got) return got;
  const times = got.lines.map((l) => num(l.line.split(" ")[0]));
  const events = got.lines.map((l) => num(l.line.split(" ")[1]));

  const covariates: CoxCovariate[] = [];
  const factors: CoxFactor[] = [];
  const roles: string[] = [
    `${header[cols.time]} = time`,
    `${header[cols.event]} = event${cols.inverted ? " (a censored flag: its 1 was read as censored, 0 as event)" : ""}`,
  ];
  const width = header.length;
  for (let j = 0; j < width; j++) {
    if (j === cols.time || j === cols.event) continue;
    const h = name(header, j, `column ${j + 1}`);
    const cells = column(body, j);
    if (cols.ids.includes(j) || (isIdColumn(header, j, cells) && !levelsRepeat(cells)) || (j === 0 && isRowCounter(cells))) {
      roles.push(`${h} = id (not used)`);
      continue;
    }
    if (cells.every((c) => isBlank(c))) {
      roles.push(`${h} = empty (not used)`);
      continue;
    }
    const blank = cells.findIndex(isBlank);
    if (blank >= 0) {
      return { error: `${h} is blank in row ${blank + 1}. Fill it in or remove the row — rows are not dropped silently.` };
    }
    if (cells.every(isNumericCell)) {
      const values = cells.map(num);
      covariates.push({ name: coxSafe(h), values });
      const lv = new Set(values).size;
      const codes =
        values.every(Number.isInteger) && lv >= 3 && lv <= COX_MAX_LEVELS && (CATEGORY_EXACT.test(hn(h)) || /\b(stage|grade)\b/i.test(hn(h)));
      roles.push(
        `${h} = numeric covariate` +
          (codes ? ` (read as a NUMBER — one HR per unit; type the levels as words, e.g. I, II, III, for one indicator per level)` : ""),
      );
      continue;
    }
    // Levels that differ only in case or spacing (M, m, "F ") are ONE level:
    // otherwise Sex becomes 4 levels and 3 indicators, and the EPV gate counts
    // parameters that do not exist. Folded to the first spelling seen, and said.
    const spelling = new Map<string, string>();
    const merged = new Set<string>();
    const folded = cells.map((c) => {
      const t = c.trim().replace(/\s+/g, " ");
      const k = t.toLowerCase();
      const first = spelling.get(k);
      if (first === undefined) {
        spelling.set(k, t);
        return t;
      }
      if (first !== t) merged.add(`${t} → ${first}`);
      return first;
    });
    const d = coxDummyCode(h, folded);
    if (!d.ok) return { error: d.reason };
    covariates.push(...d.covariates);
    factors.push(d.factor);
    roles.push(d.note + (merged.size ? ` (levels differing only in case merged: ${[...merged].join(", ")})` : ""));
  }
  if (!covariates.length) return { error: "No covariate columns — Cox regression needs at least one beside time and event." };
  const n = times.length;
  const ev = events.filter((e) => e === 1).length;
  return {
    input: { times, events, covariates, factors },
    names: [coxSafe(header[cols.time]), cols.inverted ? "event" : coxSafe(header[cols.event]), ...covariates.map((c) => c.name)],
    note: `Read ${n} subjects, ${ev} event${ev === 1 ? "" : "s"}: ${roles.join("; ")}.` + commaNote(body),
  };
}

/** Field text for `cox`: a header line of names, then time, event (1/0), covariates per row. */
export function feedCox(rows: string[][]): TableFeedResult {
  const r = readCoxTable(rows);
  if ("error" in r) return r;
  const { times, events, covariates } = r.input;
  const lines = times.map((t, i) => [fmt(t), fmt(events[i]), ...covariates.map((c) => fmt(c.values[i]))].join(" "));
  return { text: [r.names.join(" "), ...lines].join("\n"), note: r.note };
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
  let lines: string[] = [];
  // MARGINAL TOTALS ARE NOT DATA (counts only). A contingency table pasted from
  // a spreadsheet usually carries a Total row and a Total column; read as cells
  // they double every count and add a row and a column of degrees of freedom,
  // so a 2×2 became a 3×3 with a confident wrong p.
  const totalsDropped: string[] = [];
  const TOTAL_LABEL = /^\s*(grand\s+)?(totals?|sums?|all|overall)\s*:?\s*$/i;
  const keepCol: boolean[] = Array.from({ length: width }, (_, j) => j >= start);
  if (what === "counts" && header) {
    for (let j = start; j < width; j++) {
      if (TOTAL_LABEL.test(header[j] ?? "")) {
        keepCol[j] = false;
        totalsDropped.push(`the ${(header[j] ?? "").trim()} column`);
      }
    }
  }
  const countRows: string[][] = [];
  for (const r of body) {
    if (what === "counts" && start === 1 && TOTAL_LABEL.test(r[0] ?? "")) {
      totalsDropped.push(`the ${(r[0] ?? "").trim()} row`);
      continue;
    }
    const vals = r.filter((_, j) => keepCol[j]);
    if (vals.every(isBlank)) continue;
    if (!vals.every(isNumericCell)) {
      return { error: "Every cell must be a number (blank cells and words are not allowed here)." };
    }
    countRows.push(vals.map(numText));
    lines.push(vals.map(numText).join(" "));
  }
  let cols = keepCol.filter(Boolean).length;
  if (what === "counts" && countRows.length && cols) {
    // An UNLABELLED margin: a last row (or column) equal, cell by cell, to the
    // sum of the others. Only with at least two others — with one, "the sum of
    // the others" is just a repeated row, which real counts can be.
    const g = countRows.map((row) => row.map((c) => num(c)));
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    let rowsN = g.length;
    let colsN = cols;
    const lastRowIsSum = (): boolean =>
      rowsN >= 3 && g[rowsN - 1].slice(0, colsN).every((v, j) => near(v, g.slice(0, rowsN - 1).reduce((s, row) => s + row[j], 0)));
    const lastColIsSum = (): boolean =>
      colsN >= 3 && g.slice(0, rowsN).every((row) => near(row[colsN - 1], row.slice(0, colsN - 1).reduce((s, v) => s + v, 0)));
    if (lastRowIsSum()) {
      rowsN--;
      totalsDropped.push("the last row (it equals the sum of the rows above it)");
    }
    if (lastColIsSum()) {
      colsN--;
      totalsDropped.push("the last column (it equals the sum of the columns before it)");
    }
    if (rowsN !== g.length || colsN !== cols) {
      lines = countRows.slice(0, rowsN).map((row) => row.slice(0, colsN).join(" "));
      cols = colsN;
    }
  }
  if (lines.length < 2 || cols < 2) return { error: "Need at least two rows and two numeric columns." };
  const hasTime = !!header && header.some((h) => {
    const role = headerRole(h ?? "");
    return role === "time" || role === "timeWeak";
  });
  if (what === "regression" && header && hasTime) {
    // Time | Status | Age | Dose through ordinary least squares regresses
    // CENSORED times with the event flag as a predictor — a confident R² that
    // answers nothing (audit §A WRONG 9). A 0/1 column named status, censor or
    // event is survival data.
    for (let j = start; j < width; j++) {
      const cells = column(body, j).filter((c) => !isBlank(c));
      if (/\b(status|censor\w*|event)\b/i.test(hn(header[j])) && cells.length && cells.every((c) => eventFlag(c) !== null)) {
        return {
          error:
            `The ${header[j]} column is an event/censoring flag, so this is survival data: least squares on censored times ` +
            "answers nothing. Use Survival (Kaplan–Meier) or Log-rank, or a Cox model.",
        };
      }
    }
  }
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
      (totalsDropped.length ? ` Marginal totals are not data, so ${totalsDropped.join(" and ")} ${totalsDropped.length > 1 ? "were" : "was"} dropped.` : "") +
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
    case "subjects-between":
      return feedSubjectsBetween(rows);
    case "cox":
      return feedCox(rows);
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
