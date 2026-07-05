// Looks at a table's shape and recommends how to represent it — a chart for
// clean numeric data, a flowchart for step lists, a block diagram for short
// hierarchies, and the table figure for dense/mixed tables where the table is
// itself the exhibit. The task pane preselects the result (and shows the
// reason); the user can always override via the "Show as" dropdown.
//
// Pure logic — no Office.js — fully unit-testable.

import { parseTableData, parseNumberCell } from "./tablechart";

export type Representation =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "doughnut"
  | "flowchart"
  | "hierarchy"
  | "tablefigure";

export interface Recommendation {
  kind: Representation;
  reason: string;
}

const STEP_HEADER = /^(step|steps|stage|phase|method|operation|action|act|no\.?|#)$/i;
const STEP_ID = /^(?:[sS]-?\d{1,4}|\d{1,4}|step\s*\d{1,4})$/i;
const TEMPORAL = /\b(year|years|month|months|date|time|quarter|q[1-4]|week|day|fy|period)\b/i;

function avgCellLength(rows: string[][]): number {
  let sum = 0;
  let n = 0;
  for (const r of rows) for (const c of r) if (c) (sum += c.length), (n += 1);
  return n ? sum / n : 0;
}

function looksLikeSteps(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0].map((c) => c.replace(/[:.]$/, "").trim());
  if (STEP_HEADER.test(first[0] || "") || STEP_HEADER.test(first[1] || "")) return true;
  // A first column that is a step id on most rows (S101, 102, Step 3).
  const body = rows.slice(1);
  const ids = body.filter((r) => r[0] && STEP_ID.test(r[0])).length;
  return body.length >= 2 && ids / body.length >= 0.6;
}

function looksLikeHierarchy(rows: string[][]): boolean {
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 2 || cols > 4) return false;
  if (avgCellLength(rows) > 26) return false; // long prose → not boxes
  // All columns essentially text.
  const numericCols = Array.from({ length: cols }, (_, j) =>
    rows.filter((r) => r[j] && parseNumberCell(r[j]) !== null).length
  );
  const totalNumericCells = numericCols.reduce((a, b) => a + b, 0);
  if (totalNumericCells > rows.length * 0.3) return false;
  // A grouping first column: repeats or blanks (fewer distinct values than rows).
  const col0 = rows.map((r) => r[0]);
  const distinct = new Set(col0.filter((c) => c)).size;
  const blanks = col0.filter((c) => !c).length;
  return distinct < rows.length && (blanks > 0 || distinct <= Math.ceil(rows.length / 2));
}

/** Picks a chart subtype for a table already known to be cleanly chartable. */
function chartSubtype(
  categoryLabel: string,
  categories: string[],
  seriesNames: string[],
  values: (number | null)[]
): Representation {
  const seriesCount = seriesNames.length;
  const temporalHeader = TEMPORAL.test(categoryLabel);
  const yearLike = categories.length >= 3 && categories.every((c) => /^\d{4}$/.test(c.trim()));
  if ((temporalHeader || yearLike) && categories.length >= 3) return "line";
  // Pie only when it genuinely reads as parts of a whole: a single series of
  // 2–6 non-negative values whose header suggests a share/percentage, or whose
  // values sum to ~100 (percentages).
  const nums = values.filter((v): v is number => v !== null);
  const sum = nums.reduce((a, b) => a + b, 0);
  const shareRe = /\b(share|percent|proportion|distribution|composition|split|mix|fraction|%)\b/i;
  const shareHeader = shareRe.test(categoryLabel) || seriesNames.some((n) => shareRe.test(n));
  const partsOfWhole =
    seriesCount === 1 &&
    categories.length >= 2 &&
    categories.length <= 6 &&
    nums.length > 0 &&
    nums.every((v) => v >= 0) &&
    (shareHeader || (sum >= 95 && sum <= 100.5));
  if (partsOfWhole) return "pie";
  return "column";
}

/**
 * A grouped "characteristics" table: section-header band rows (only the first
 * cell filled) or a mostly-blank leading section column. These read best as a
 * table figure, not a chart — the columns are usually mixed scales (n and %).
 */
function isGrouped(rows: string[][]): boolean {
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 3) return false;
  const body = rows.slice(1);
  const bands = body.filter((r) => r.filter((c) => c !== "").length === 1).length;
  if (bands >= 1) return true;
  const blank0 = body.filter((r) => !r[0]).length;
  return body.length > 0 && blank0 / body.length >= 0.4;
}

/** Recommends a representation for the given cleaned table rows. */
export function classifyTable(rows: string[][]): Recommendation {
  if (!rows.length || !rows[0].length) return { kind: "tablefigure", reason: "The table is empty." };

  // Prefer a real visualization when the data charts cleanly and isn't dense.
  try {
    const chart = parseTableData(rows);
    const n = chart.categories.length;
    if (isGrouped(rows)) {
      return {
        kind: "tablefigure",
        reason: "Grouped table with sections — shown as a table figure. Pick a chart in “Show as” to plot a column.",
      };
    }
    if (n <= 16 && chart.series.length >= 1) {
      const sub = chartSubtype(chart.categoryLabel, chart.categories, chart.series.map((s) => s.name), chart.series[0].values);
      const name = sub === "line" ? "a line chart" : sub === "pie" ? "a pie chart" : "a column chart";
      return { kind: sub, reason: `Numeric data across ${n} categories — drawn as ${name}. Switch “Show as” for another view.` };
    }
    // Numeric but too many rows to chart legibly.
    return {
      kind: "tablefigure",
      reason: `${n} rows of data — too many to chart legibly, so shown as a table figure. Pick a chart in “Show as” to force one.`,
    };
  } catch {
    // Not chartable (no numeric columns).
  }

  if (looksLikeSteps(rows)) {
    return { kind: "flowchart", reason: "Looks like a list of steps — drawn as a flowchart. Switch “Show as” for another view." };
  }
  if (looksLikeHierarchy(rows)) {
    return { kind: "hierarchy", reason: "Looks like a component hierarchy — drawn as a block diagram. Switch “Show as” for another view." };
  }
  return { kind: "tablefigure", reason: "Mostly text — shown as a table figure. Pick Flowchart or Block diagram in “Show as” if it fits." };
}
