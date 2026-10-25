/**
 * The data reader for the regression calculators (Release E2): a pasted, Word or CSV table whose first row names
 * the columns (or unnamed rows: y, x1, x2…), a model spec "y ~ x1 + x2" that picks the columns, listwise deletion
 * with a note, and the cluster column picked by name.
 *
 * Separators: a tab anywhere means tab-separated (what "Use table at cursor" and a spreadsheet paste produce);
 * otherwise a header line holding a comma or semicolon means comma- or semicolon-separated (a CSV file); otherwise
 * whitespace. Only the tab and delimited forms can leave a cell empty; in whitespace form every row needs every
 * value. Missing cells ("", NA, N/A, ., -, NaN, null…) drop their row from a model that uses that column.
 *
 * DECIMAL COMMAS (E2 fix round: "0,125" was silently read as 125). A semicolon-separated table is the European CSV
 * convention, so every comma in its cells is a decimal comma ("1.234,5" with a point grouping thousands). In any other
 * table a cell with a leading zero before the comma ("0,125", "−0,5") is a decimal, as is any comma not followed by
 * exactly three digits ("1,5"), while "1,500" groups thousands; a column holding both an unambiguous decimal comma
 * and a thousands-shaped cell is refused by name. The notes say when commas were read as decimals. The shared
 * parseCellNumber is unchanged for every other mode of the product.
 */
import { parseCellNumber, parseDelimited } from "./dataimport";

export interface RegDataset {
  /** Column names as given (or y, x1, x2… for unnamed rows). */
  names: string[];
  /** Data cells, trimmed; rows[i][j] is row i, column j. */
  rows: string[][];
  /** True when the first line was a header of names. */
  named: boolean;
  /** True for a semicolon-separated table: its commas are decimal commas. */
  semicolon?: boolean;
}

/** "1,500", "12,345,678" (not "0,125"): the shape of a thousands separator. */
const THOUSANDS_SHAPE = /^[-−+]?[1-9]\d{0,2}(,\d{3})+$/;
/** A comma that can only be a decimal comma: a leading zero ("0,125", "−0,5") or not exactly three digits after it. */
function unambiguousDecimalComma(t: string): boolean {
  return /^[-−+]?0,\d+$/.test(t) || (/^[-−+]?\d+,\d+$/.test(t) && !/^[-−+]?\d+,\d{3}$/.test(t));
}

/**
 * Reads one cell as a number under the table's comma convention: { value, decimalComma } with value NaN when the
 * cell is not a number.
 */
export function readRegCell(cell: string, semicolon: boolean): { value: number; decimalComma: boolean } {
  const t = cell.trim();
  if (!t.includes(",")) return { value: parseCellNumber(t), decimalComma: false };
  if (semicolon) {
    let s = t;
    if (/^[-−+]?\d{1,3}(\.\d{3})+,\d+/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (!s.includes(".") && (s.match(/,/g) ?? []).length === 1) s = s.replace(",", ".");
    else return { value: NaN, decimalComma: false };
    return { value: parseCellNumber(s), decimalComma: true };
  }
  // A leading-zero mantissa ("0,125", "0,125×10⁻³") is a decimal whatever follows it.
  const lead = /^([-−+]?0),(\d+)/.exec(t);
  if (lead) return { value: parseCellNumber(`${lead[1]}.${lead[2]}${t.slice(lead[0].length)}`), decimalComma: true };
  const mant = t.split(/[×xX·]/)[0].trim();
  return { value: parseCellNumber(t), decimalComma: unambiguousDecimalComma(mant) };
}

export type RegDataResult = { ok: true; data: RegDataset } | { ok: false; reason: string };

const NA_CELL = /^(n\/?a|nan|n\.?d\.?|-|—|–|\.|null|none|missing|\?|#n\/a|#value!|#div\/0!)$/i;
/** A cell that counts as missing. */
export function isMissingCell(s: string): boolean {
  const t = s.trim();
  return t === "" || NA_CELL.test(t);
}

const q = (s: string): string => `“${s}”`;
/** A cell Number() reads exactly as parseCellNumber would (no comma, no exponent, at most 15 integer digits). */
const PLAIN_DECIMAL = /^-?\d{1,15}(\.\d+)?$/;

/** Reads the table text into names and cells. */
export function parseRegData(text: string): RegDataResult {
  const src = text.replace(/\r\n?/g, "\n");
  const lines = src.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { ok: false, reason: "Paste a table: a header row of column names, then one row per observation." };
  let grid: string[][];
  let delimited = true;
  let semicolon = false;
  if (src.includes("\t")) grid = parseDelimited(lines.join("\n"), "\t");
  else if (/[,;]/.test(lines[0]) && !/^\s*[-+−]?[\d.,]+(\s+[-+−]?[\d.,]+)+\s*$/.test(lines[0])) {
    // A delimited header (a CSV file). A first line of space-separated decimal-comma numbers ("1,5 2,3") is not.
    semicolon = lines[0].includes(";");
    grid = parseDelimited(lines.join("\n"), semicolon ? ";" : ",");
  } else {
    grid = lines.map((l) => l.trim().split(/\s+/));
    delimited = false;
  }
  grid = grid.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  if (!grid.length) return { ok: false, reason: "The table is empty." };
  const first = grid[0];
  const nonEmpty = first.filter((c) => c !== "");
  const named = nonEmpty.length > 0 && nonEmpty.every((c) => !Number.isFinite(readRegCell(c, semicolon).value) && !isMissingCell(c));
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
  return { ok: true, data: { names, rows: body, named, semicolon } };
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
  const semicolon = data.semicolon === true;
  let decimalCommas = 0;
  /** Per used column: the first unambiguous decimal-comma cell and the first thousands-shaped cell. */
  const decSeen: ({ cell: string; row: number } | null)[] = used.map(() => null);
  const kSeen: ({ cell: string; row: number } | null)[] = used.map(() => null);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let missing = clusterIdx >= 0 && isMissingCell(r[clusterIdx] ?? "");
    const vals: number[] = [];
    for (let u = 0; u < used.length; u++) {
      const j = used[u];
      const cell = r[j] ?? "";
      // Fast path for a plain decimal (a 50,000 × 20 paste is a million cells); everything else takes the product's
      // cell reader (decimal commas, U+2212, ×10ⁿ, thousands separators).
      if (PLAIN_DECIMAL.test(cell)) {
        vals.push(Number(cell));
        continue;
      }
      if (isMissingCell(cell)) {
        missing = true;
        continue;
      }
      const { value: v, decimalComma } = readRegCell(cell, semicolon);
      if (!Number.isFinite(v)) {
        return { ok: false, reason: `Column ${q(names[j])}, row ${i + 1}: ${q(cell)} is not a number.` };
      }
      if (decimalComma) {
        decimalCommas++;
        if (!decSeen[u]) decSeen[u] = { cell, row: i + 1 };
      } else if (!semicolon && THOUSANDS_SHAPE.test(cell.split(/[×xX·]/)[0].trim())) {
        if (!kSeen[u]) kSeen[u] = { cell, row: i + 1 };
      }
      const d = decSeen[u];
      const k = kSeen[u];
      if (d && k) {
        return {
          ok: false,
          reason:
            `Column ${q(names[j])} mixes a decimal comma (${q(d.cell)}, row ${d.row}) with a thousands separator ` +
            `(${q(k.cell)}, row ${k.row}), so which one a comma means is ambiguous. Write decimals with a point, or ` +
            "separate the table with semicolons so that every comma is a decimal comma.",
        };
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
  if (decimalCommas) {
    notes.push(
      semicolon
        ? `The table is separated by semicolons, so its commas were read as decimal commas (${decimalCommas.toLocaleString("en-US")} cell${decimalCommas === 1 ? "" : "s"}; “0,125” is 0.125).`
        : `${decimalCommas.toLocaleString("en-US")} cell${decimalCommas === 1 ? "" : "s"} with a decimal comma ${decimalCommas === 1 ? "was" : "were"} read as decimals (“0,125” is 0.125, “1,5” is 1.5).`,
    );
  }
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
