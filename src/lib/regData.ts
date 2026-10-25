/**
 * The data reader for the regression calculators (Release E2): a pasted, Word or CSV table whose first row names
 * the columns (or unnamed rows: y, x1, x2…), a model spec "y ~ x1 + x2" that picks the columns, listwise deletion
 * with a note, and the cluster column picked by name.
 *
 * Separators: a tab anywhere means tab-separated (what "Use table at cursor" and a spreadsheet paste produce);
 * otherwise a header line holding a comma or semicolon means comma- or semicolon-separated (a CSV file); otherwise
 * whitespace. Only the tab and delimited forms can leave a cell empty; in whitespace form every row needs every
 * value. Missing cells ("", NA, N/A, ., -, NaN, null…) drop their row from a model that uses that column.
 */
import { parseCellNumber, parseDelimited } from "./dataimport";

export interface RegDataset {
  /** Column names as given (or y, x1, x2… for unnamed rows). */
  names: string[];
  /** Data cells, trimmed; rows[i][j] is row i, column j. */
  rows: string[][];
  /** True when the first line was a header of names. */
  named: boolean;
}

export type RegDataResult = { ok: true; data: RegDataset } | { ok: false; reason: string };

const NA_CELL = /^(n\/?a|nan|n\.?d\.?|-|—|–|\.|null|none|missing|\?|#n\/a|#value!|#div\/0!)$/i;
/** A cell that counts as missing. */
export function isMissingCell(s: string): boolean {
  const t = s.trim();
  return t === "" || NA_CELL.test(t);
}

const q = (s: string): string => `“${s}”`;

/** Reads the table text into names and cells. */
export function parseRegData(text: string): RegDataResult {
  const src = text.replace(/\r\n?/g, "\n");
  const lines = src.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, reason: "Paste a table: a header row of column names, then one row per observation." };
  let grid: string[][];
  let delimited = true;
  if (src.includes("\t")) grid = parseDelimited(lines.join("\n"), "\t");
  else if (/[,;]/.test(lines[0]) && !/^\s*[-+−]?[\d.,]+(\s+[-+−]?[\d.,]+)+\s*$/.test(lines[0])) {
    // A delimited header (a CSV file). A first line of space-separated decimal-comma numbers ("1,5 2,3") is not.
    grid = parseDelimited(lines.join("\n"), lines[0].includes(";") ? ";" : ",");
  } else {
    grid = lines.map((l) => l.trim().split(/\s+/));
    delimited = false;
  }
  grid = grid.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  if (!grid.length) return { ok: false, reason: "The table is empty." };
  const first = grid[0];
  const nonEmpty = first.filter((c) => c !== "");
  const named = nonEmpty.length > 0 && nonEmpty.every((c) => !Number.isFinite(parseCellNumber(c)) && !isMissingCell(c));
  const width = Math.max(...grid.map((r) => r.length));
  let names: string[];
  let body: string[][];
  if (named) {
    names = Array.from({ length: width }, (_, j) => (first[j] ?? "").trim());
    body = grid.slice(1);
    const blank = names.findIndex((nm) => nm === "");
    if (blank >= 0) return { ok: false, reason: `Column ${blank + 1} has no name in the header row.` };
  } else {
    names = Array.from({ length: width }, (_, j) => (j === 0 ? "y" : `x${j}`));
    body = grid;
  }
  if (!body.length) return { ok: false, reason: "The table has a header row but no data rows." };
  for (let i = 0; i < body.length; i++) {
    if (body[i].length > width) return { ok: false, reason: `Row ${i + 1} has more cells than there are columns.` };
    if (body[i].length < width) {
      // Whitespace rows cannot mark a blank: a short row is ambiguous, so it is refused rather than guessed.
      if (!delimited) {
        return {
          ok: false,
          reason:
            `Row ${i + 1} has ${body[i].length} values but there are ${width} columns. Separate the cells with tabs ` +
            "or commas to leave a cell empty, or type NA for a missing value.",
        };
      }
      body[i] = [...body[i], ...new Array<string>(width - body[i].length).fill("")];
    }
  }
  return { ok: true, data: { names, rows: body, named } };
}

export interface RegSpec {
  dep: string;
  /** Predictors as named; "." expands to every other column. */
  preds: string[];
  /** The spec as typed, for messages. */
  text: string;
}

/** Finds a column by name: exactly, then ignoring case. */
export function findColumn(names: string[], want: string): number | { error: string } {
  const w = want.trim();
  const exact = names.filter((nm) => nm === w);
  if (exact.length === 1) return names.indexOf(w);
  if (exact.length > 1) return { error: `Two columns are named ${q(w)}; rename one of them.` };
  const ci = names.map((nm, j) => [nm, j] as const).filter(([nm]) => nm.toLowerCase() === w.toLowerCase());
  if (ci.length === 1) return ci[0][1];
  if (ci.length > 1) return { error: `More than one column is named ${q(w)} (ignoring case); rename one of them.` };
  return { error: `No column is named ${q(w)}. The columns are ${names.map(q).join(", ")}.` };
}

/**
 * Reads "y ~ x1 + x2" (also "y ~ ." for every other column). An empty spec means the first column on all the others.
 * Names may contain spaces; they are separated by "+".
 */
export function parseSpec(text: string): RegSpec | { error: string } {
  const t = text.trim();
  if (!t) return { dep: "", preds: ["."], text: "" };
  const parts = t.split("~");
  if (parts.length !== 2) return { error: `Write the model as “y ~ x1 + x2” (one ~): ${q(t)}.` };
  const dep = parts[0].trim();
  if (!dep) return { error: `The model ${q(t)} has no response before the ~.` };
  const rhs = parts[1].trim();
  if (!rhs) return { error: `The model ${q(t)} has no predictors after the ~.` };
  const preds = rhs.split("+").map((s) => s.trim());
  if (preds.some((s) => s === "")) return { error: `The model ${q(t)} has an empty term (two + in a row?).` };
  return { dep, preds, text: t };
}

/** One spec per non-empty line (the multi-model table). */
export function parseSpecList(text: string): RegSpec[] | { error: string } {
  const out: RegSpec[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { error: "Enter one model per line, such as “y ~ x1 + x2”." };
  for (const [i, l] of lines.entries()) {
    const s = parseSpec(l);
    if ("error" in s) return { error: `Model ${i + 1}: ${s.error}` };
    out.push(s);
  }
  return out;
}

export interface RegColumns {
  depName: string;
  y: Float64Array;
  X: Float64Array[];
  names: string[];
  clusters?: string[];
  clusterName?: string;
  /** 1-based data-row numbers of the rows used. */
  rowNumbers: number[];
  /** Rows dropped for a missing cell. */
  dropped: number;
  notes: string[];
}

/** Picks the model's columns, reads them as numbers, and drops rows with a missing cell in any of them. */
export function selectColumns(
  data: RegDataset,
  spec: RegSpec,
  opts: { cluster?: string; timeOrdered?: boolean } = {},
): { ok: true; cols: RegColumns } | { ok: false; reason: string } {
  const { names, rows } = data;
  let clusterIdx = -1;
  if (opts.cluster !== undefined) {
    if (!opts.cluster.trim()) return { ok: false, reason: "Name the cluster column (clustered standard errors)." };
    const c = findColumn(names, opts.cluster);
    if (typeof c !== "number") return { ok: false, reason: `Cluster column: ${c.error}` };
    clusterIdx = c;
  }
  let depIdx: number;
  if (spec.dep === "") depIdx = 0;
  else {
    const d = findColumn(names, spec.dep);
    if (typeof d !== "number") return { ok: false, reason: d.error };
    depIdx = d;
  }
  if (depIdx === clusterIdx) return { ok: false, reason: `${q(names[depIdx])} cannot be both the response and the cluster column.` };
  const predIdx: number[] = [];
  for (const pname of spec.preds) {
    if (pname === ".") {
      for (let j = 0; j < names.length; j++) if (j !== depIdx && j !== clusterIdx && !predIdx.includes(j)) predIdx.push(j);
      continue;
    }
    const pj = findColumn(names, pname);
    if (typeof pj !== "number") return { ok: false, reason: pj.error };
    if (pj === depIdx) return { ok: false, reason: `${q(names[pj])} is the response; it cannot also be a predictor.` };
    if (pj === clusterIdx) return { ok: false, reason: `${q(names[pj])} is the cluster column; it cannot also be a predictor.` };
    if (predIdx.includes(pj)) return { ok: false, reason: `${q(names[pj])} is listed twice in the model.` };
    predIdx.push(pj);
  }
  const used = [depIdx, ...predIdx];
  const keep: number[] = [];
  let dropped = 0;
  const droppedAt: number[] = [];
  const values: number[][] = used.map(() => []);
  const clusters: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let missing = clusterIdx >= 0 && isMissingCell(r[clusterIdx] ?? "");
    const vals: number[] = [];
    for (const j of used) {
      const cell = r[j] ?? "";
      if (isMissingCell(cell)) {
        missing = true;
        continue;
      }
      const v = parseCellNumber(cell);
      if (!Number.isFinite(v)) {
        return { ok: false, reason: `Column ${q(names[j])}, row ${i + 1}: ${q(cell)} is not a number.` };
      }
      vals.push(v);
    }
    if (missing) {
      dropped++;
      droppedAt.push(i);
      continue;
    }
    keep.push(i + 1);
    vals.forEach((v, k) => values[k].push(v));
    if (clusterIdx >= 0) clusters.push(r[clusterIdx]);
  }
  const notes: string[] = [];
  if (dropped) {
    notes.push(
      `${dropped} row${dropped === 1 ? "" : "s"} with a missing cell in the model's columns ${dropped === 1 ? "was" : "were"} ` +
        `dropped (listwise deletion); ${keep.length} used.`,
    );
    if (opts.timeOrdered) {
      const first = keep.length ? keep[0] - 1 : -1;
      const last = keep.length ? keep[keep.length - 1] - 1 : -1;
      const interior = droppedAt.some((i) => i > first && i < last);
      if (interior) notes.push("A dropped row sat inside the series, so Durbin–Watson and Newey–West treat the rows either side of it as adjacent.");
    }
  }
  return {
    ok: true,
    cols: {
      depName: names[depIdx],
      y: Float64Array.from(values[0]),
      X: values.slice(1).map((v) => Float64Array.from(v)),
      names: predIdx.map((j) => names[j]),
      clusters: clusterIdx >= 0 ? clusters : undefined,
      clusterName: clusterIdx >= 0 ? names[clusterIdx] : undefined,
      rowNumbers: keep,
      dropped,
      notes,
    },
  };
}
