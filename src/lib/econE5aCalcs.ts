/**
 * Release E5a calculators, pure functions of the field reader (taskpane.ts declares the fields and calls these):
 *  - ineq-gini     Inequality: Gini, Lorenz, Theil, Atkinson, Palma, P90/P10 (Stats; engine inequality.ts);
 *  - conc-hhi      Market concentration: HHI, CR4 and a merger's ΔHHI against the 2023 Merger Guidelines (Stats);
 *  - io-leontief   Input–output (Leontief): inverse, output, multipliers, linkages (Stats; engine leontief.ts);
 *  - fin-currency  Currency conversion with the user's own rates, ISO 4217 checked (Finance; data currency.ts).
 *
 * The worked defaults are invented numbers (no textbook table, no official data).
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { parseRegData, readRegCell, isMissingCell, selectColumns, findColumn, type RegDataset } from "./regData";
import { fmtFixed, intText, numText, groupThousands } from "./regTable";
import { semicolonCommaRefusal } from "./numberList";
import { groupedBarSvg } from "./statchart";
import { linearAxis } from "./axis";
import { ctxCanvas } from "./figContext";
import { ratAdd, ratSub, ratMul, ratDiv, ratSign, ratToNumber, parseRatLiteral, RAT_ZERO, type Rat } from "./cas";
import { inequality, lorenzAt, lorenzSvg, exactOf, shortFraction, type IneqResult } from "./inequality";
import {
  leontiefInverse,
  spectralRadiusBracket,
  matVec,
  ratMatVec,
  colSums,
  rowSums,
  rasmussen,
  IO_MAX_N,
  IO_EXACT_MAX,
  IO_EXACT_DIGITS,
  IO_WALL_MS,
  type Mat,
} from "./leontief";
import {
  ISO4217,
  ISO4217_DATE,
  ISO4217_SOURCE,
  NOT_A_CURRENCY,
  roundUnits,
  unitsText,
  currencyAmount,
  exactText,
  sigText,
  convert,
  cross,
  ratOf,
  terminatingDecimals,
} from "./currency";

type Read = (k: string) => string;
type Align = "left" | "center" | "right";
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

export interface E5Field {
  key: string;
  label: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

function getter(read: Read): (k: string) => string {
  return (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
}

/** A scalar text field: a finite number (U+2212, decimal comma), or an error naming the field. */
function readScalar(raw: string, label: string): number | { error: string } {
  const t = raw.trim();
  const v = readRegCell(t, false).value;
  if (!Number.isFinite(v)) return { error: `${label}: ${q(t)} is not a finite number.` };
  return v;
}

/**
 * A header cell shaped like a number ("1e400", "−0") means the first row was data whose number overflowed, not a
 * header of names: refused, never read as a column name.
 */
const NUMBER_SHAPE = /^[-−+]?(\d[\d.,]*|\.\d+)([eE][-+−]?\d+)?%?$/;
function numberShapedHeader(names: string[], named: boolean): string | undefined {
  if (!named) return undefined;
  const bad = names.find((nm) => NUMBER_SHAPE.test(nm.trim()));
  return bad === undefined ? undefined : `Row 1: ${q(bad)} is not a finite number.`;
}

function decimalCommaNote(any: boolean): string[] {
  return any ? ["Commas inside numbers were read as decimal commas (“0,5” is 0.5)."] : [];
}

// -----------------------------------------------------------------------------------------------------------------
// Number reading under the table rules of regData.ts (E5 fix round: these calculators had readers of their own).
// Table cells go through parseRegData + selectColumns; numbers typed one per line or in a list field go through
// readRegCell with the SAME whole-input rules selectColumns applies to a table: a decimal comma anywhere makes a
// thousands-shaped "1,105" ambiguous, and a point followed by three digits ("1.250") ambiguous, and both are refused
// naming the two readings. The patterns below are regData's own.

/** "1,500", "12,345,678": the shape of a thousands comma (regData THOUSANDS_SHAPE). */
const THOUSANDS_SHAPE = /^[-−+]?[1-9]\d{0,2}(,\d{3})+$/;
/** "1,250.00": thousands commas before a decimal point. */
const ENGLISH_FORM = /^[-−+]?[1-9]\d{0,2}(,\d{3})+\.\d+$/;
/** "2.345": one point and exactly three digits after it, so it may be a thousands group (regData ONE_DOT_GROUP). */
const ONE_DOT_GROUP = /^[1-9]\d{0,2}\.\d{3}$/;
const MULTI_DOT_GROUPS = /^[1-9]\d{0,2}(\.\d{3}){2,}$/;
/** "1.234,5": points grouping thousands before a decimal comma (regData GERMAN_FORM). */
const GERMAN_FORM = /^[-−+]?\d{1,3}(\.\d{3})+,\d+/;
/** "12 500", "1 000 000,5": digit groups separated by single spaces (the cell reader joins them into one number). */
const SPACE_GROUPED = /^[-−+]?\d{1,3}( \d{3})+([.,]\d+)?$/;

/** A cell's digits without its sign, ×10ⁿ tail or % sign. */
function mantissaOf(cell: string): string {
  return cell.trim().replace(/^[-−+]/, "").split(/[×xX·%]/)[0].trim();
}
function isOneDotGroup(cell: string): boolean {
  return cell.includes(".") && ONE_DOT_GROUP.test(mantissaOf(cell));
}
/** "1.250" read with a decimal point, trailing zeros dropped: "1.25", "40". */
function decimalReading(digits: string): string {
  return digits.includes(".") ? digits.replace(/0+$/, "").replace(/\.$/, "") : digits;
}

interface CellItem {
  cell: string;
  /** Where the cell is, for messages: "Row 3", "Rate line 2 (CHF)". */
  where: string;
}

/**
 * Beyond regData (which refuses "1.250" only beside a decimal comma): a column in which every number with a point
 * has exactly three digits after it ("12.500", "15.000"; or "1.250" beside plain integers) gives no sign of what the
 * point means, so it is refused naming both readings. A cell such as "3.25" or "0.500" proves a decimal point.
 */
function dotGroupAmbiguity(items: CellItem[], scope: string): string | undefined {
  let first: CellItem | undefined;
  for (const it of items) {
    const t = it.cell.trim();
    if (!t.includes(".")) continue;
    if (isOneDotGroup(t)) {
      if (!first) first = it;
      continue;
    }
    if (GERMAN_FORM.test(t) || MULTI_DOT_GROUPS.test(mantissaOf(t))) continue;
    if (/\.\d/.test(t)) return undefined;
  }
  if (!first) return undefined;
  const d = mantissaOf(first.cell);
  const whole = d.replace(".", "");
  const dec = decimalReading(d);
  return (
    `${first.where}: ${q(first.cell)} could be ${whole} (a point grouping thousands) or ${dec} (a decimal point). ` +
    `Every point in ${scope} is followed by exactly three digits, so nothing shows which. Write ${q(whole)} if it is a whole number, or ${q(dec)} if the point is a decimal point.`
  );
}

type Consistent =
  | { ok: true; values: number[]; decimalComma: boolean[]; decimalCommas: number; thousands: CellItem[] }
  | { ok: false; reason: string };

/**
 * Reads numbers typed outside a table (rate lines, amount lines, list fields) with regData's cell reader under ONE
 * convention for the whole input, as selectColumns does for a table: a decimal comma ("0,92") beside a
 * thousands-shaped comma ("1,105") or beside a point group ("1.250") is refused naming both readings; a lone
 * "151,250" with no decimal comma anywhere is the thousands reading (reported in `thousands` so the caller says so).
 */
function readConsistent(items: CellItem[], scope: string): Consistent {
  const values: number[] = [];
  const dcs: boolean[] = [];
  let dec: CellItem | undefined;
  let kSeen: CellItem | undefined;
  let dot: CellItem | undefined;
  const thousands: CellItem[] = [];
  for (const it of items) {
    const r = readRegCell(it.cell, false);
    if (!Number.isFinite(r.value)) return { ok: false, reason: `${it.where}: ${q(it.cell.trim())} is not a finite number.` };
    values.push(r.value);
    dcs.push(r.decimalComma);
    if (r.decimalComma) {
      if (!dec) dec = it;
    } else {
      const m = it.cell.trim().split(/[×xX·%]/)[0].trim();
      // "1,250.00" (English form) shows a thousands comma as surely as "1,250" does.
      if (THOUSANDS_SHAPE.test(m) || ENGLISH_FORM.test(m)) {
        if (!kSeen) kSeen = it;
        thousands.push(it);
      }
      if (isOneDotGroup(it.cell) && !dot) dot = it;
    }
  }
  if (dec && kSeen) {
    const d = mantissaOf(kSeen.cell);
    const whole = d.replace(/,/g, "");
    const commas = (d.match(/,/g) ?? []).length;
    const asDec = commas === 1 && !d.includes(".") ? decimalReading(d.replace(",", ".")) : undefined;
    return {
      ok: false,
      reason:
        `${kSeen.where}: ${q(kSeen.cell.trim())} could be ${asDec !== undefined ? `${asDec} (a decimal comma) or ` : ""}${whole} (a thousands comma). ` +
        `${dec.where} writes a decimal comma (${q(dec.cell.trim())}), and ${scope} must use one convention, so which one this comma means is ambiguous. ` +
        `Type ${asDec !== undefined ? `${q(asDec)} or ` : ""}${q(whole)}.`,
    };
  }
  if (dec && dot) {
    const d = mantissaOf(dot.cell);
    const whole = d.replace(".", "");
    const asDec = decimalReading(d);
    return {
      ok: false,
      reason:
        `${dot.where}: ${q(dot.cell.trim())} could be ${whole} (a point grouping thousands) or ${asDec} (a decimal point). ` +
        `${dec.where} writes a decimal comma (${q(dec.cell.trim())}), so in ${scope} a point may group thousands. Type ${q(whole)} or ${q(asDec.replace(".", ","))}.`,
    };
  }
  return { ok: true, values, decimalComma: dcs, decimalCommas: dcs.filter(Boolean).length, thousands };
}

/**
 * A typed number as an exact fraction straight from its text (never through a double): U+2212 to "-", a decimal
 * comma to a point, thousands commas and space groups removed, then the decimal text read as digits over a power of
 * ten. null when the text is not a plain decimal (or e-notation) after that.
 */
function exactFromCell(cell: string, decimalComma: boolean): Rat | null {
  let t = cell.trim().replace(/^\+/, "").replace(/^[−–]/, "-");
  if (SPACE_GROUPED.test(t)) t = t.replace(/ /g, "");
  if (decimalComma) t = GERMAN_FORM.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  return parseRatLiteral(t);
}

/** |r| compared with 10^k exactly: −1, 0 or 1. */
function cmpPow10(r: Rat, k: number): number {
  const a = r.n < 0n ? -r.n : r.n;
  const lhs = k >= 0 ? a : a * 10n ** BigInt(-k);
  const rhs = k >= 0 ? r.d * 10n ** BigInt(k) : r.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

// =================================================================================================================
// ineq-gini

export const INEQ_GINI_FIELDS: E5Field[] = [
  {
    key: "data",
    label: "Incomes, one per row (a header row is optional), or a grouped table: income or group mean | count or weight",
    kind: "block",
  },
  {
    key: "layout",
    label: "The table holds",
    kind: "select",
    options: [
      { value: "individual", label: "One income per row (the first numeric column)" },
      { value: "grouped", label: "Groups: income or mean | count or weight (name the columns below if there are more than two numeric columns)" },
    ],
  },
  { key: "xcol", label: "Income column by name (blank = the first numeric column; a grouped table with exactly two numeric columns uses the first)", kind: "text" },
  { key: "wcol", label: "Count or weight column by name, grouped tables (blank = the second numeric column when there are exactly two)", kind: "text" },
  {
    key: "correction",
    label: "Gini small-sample correction",
    kind: "select",
    options: [
      { value: "none", label: "None (population formula)" },
      { value: "nn1", label: "Also show G·n/(n − 1) (individual data)" },
    ],
  },
  { key: "eps", label: "Your own Atkinson ε (blank = none; 0 < ε ≤ 20)", kind: "text" },
];

export const INEQ_GINI_DEFAULTS: Record<string, string> = {
  data: [
    "Household income",
    "8400", "12600", "15100", "17800", "19950", "22300", "24800", "26500", "29100", "31750",
    "34200", "37900", "41500", "45800", "51200", "57600", "66300", "78900", "97500", "164000",
  ].join("\n"),
  layout: "individual",
  xcol: "",
  wcol: "",
  correction: "none",
  eps: "",
};

/** Most rows accepted (fix round, R6 #3: 200,000 rows took 0.95 s, mostly the exact Gini fraction; 50,000 stay near 0.2 s). */
export const INEQ_MAX_ROWS = 50000;
/** Largest |income| and weight accepted, so Σ wᵢxᵢ·W stays far inside the double range. */
export const INEQ_MAX_ABS = 1e15;

/** Every numeric column (a column whose first non-missing cell is not a number is a label column). */
function numericColumns(rows: string[][], width: number, semicolon: boolean): number[] {
  const cols: number[] = [];
  for (let j = 0; j < width; j++) {
    const first = rows.find((r) => !isMissingCell(r[j] ?? ""));
    if (!first) continue;
    // A number-shaped cell that overflows ("1e400") still marks a numeric column; its row is then refused by name.
    if (Number.isFinite(readRegCell(first[j], semicolon).value) || NUMBER_SHAPE.test(first[j].trim())) cols.push(j);
  }
  return cols;
}

/** A column named in a field: its index, or a refusal naming the field. */
function namedColumn(names: string[], numeric: number[], raw: string, what: string): number | { error: string } {
  const c = findColumn(names, raw);
  if (typeof c !== "number") return { error: `${what}: ${c.error}` };
  if (!numeric.includes(c)) return { error: `${what}: column ${q(names[c])} does not hold numbers.` };
  return c;
}

export function ineqGiniCalc(read: Read): StatOutput {
  const get = getter(read);
  const layout = get("layout") || "individual";
  if (layout !== "individual" && layout !== "grouped") return refuse(`Unknown layout ${q(layout)}.`);
  const grouped = layout === "grouped";
  const corr = get("correction") || "none";
  if (corr !== "none" && corr !== "nn1") return refuse(`Unknown correction ${q(corr)}.`);
  const epsRaw = get("eps").trim();
  let userEps: number | undefined;
  if (epsRaw !== "") {
    const e = readScalar(epsRaw, "Atkinson ε");
    if (typeof e !== "number") return refuse(e.error);
    if (!(e > 0 && e <= 20)) return refuse(`Atkinson ε must be above 0 and at most 20; ${q(epsRaw)} was typed.`);
    userEps = e;
  }
  const text = get("data");
  if (!text.trim()) return refuse("Paste incomes, one per row, or a grouped table (income or mean | count).");
  // A single column (no tab or semicolon, one value per line) is read line by line, each line one CELL of the table
  // reader: through parseRegData a decimal comma ("0,5") would make it a comma-separated file and split every value
  // in two, and "12 500" would become two columns. Its header may be words with spaces ("Household income"). A line
  // of digit groups separated by single spaces ("12 500") is one cell, which regData's cell reader reads as 12500
  // (its space-thousands rule); that is said in a note. The cells then go through selectColumns, regData's
  // whole-column rules (a decimal comma beside "1,500" or "1.250" is refused).
  let ds: RegDataset;
  let spaceGrouped: string | undefined;
  let spaceGroupedCount = 0;
  const ls = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const oneColumn = !grouped && !/[\t;]/.test(text) && ls.slice(1).every((l) => !/\s/.test(l) || SPACE_GROUPED.test(l));
  if (oneColumn) {
    const first = ls[0] ?? "";
    const head = ls.length > 0 && !/\d/.test(first) && !isMissingCell(first) ? first : undefined;
    if (head === undefined && /\s/.test(first) && !SPACE_GROUPED.test(first)) return refuse(`Row 1, ${q(first)}: one income per row (a header row is optional).`);
    const body = head === undefined ? ls : ls.slice(1);
    if (!body.length) return refuse("The table has a header row but no incomes.");
    for (const l of body) {
      if (SPACE_GROUPED.test(l)) {
        spaceGroupedCount++;
        if (spaceGrouped === undefined) spaceGrouped = l;
      }
    }
    ds = { names: [head ?? "Income"], rows: body.map((l) => [l]), named: head !== undefined, semicolon: false };
  } else {
    const pr = parseRegData(text);
    if (!pr.ok) return refuse(pr.reason);
    const nh = numberShapedHeader(pr.data.names, pr.data.named);
    if (nh) return refuse(nh);
    ds = pr.data.named ? pr.data : { ...pr.data, names: pr.data.names.map((_, j) => `Column ${j + 1}`) };
  }
  const { names, rows } = ds;
  const semicolon = !!ds.semicolon;
  if (rows.length > INEQ_MAX_ROWS) return refuse(`The table has ${intText(rows.length)} rows; at most ${intText(INEQ_MAX_ROWS)} are accepted.`);

  // Which columns: by name from the fields, else automatic only when that is unambiguous.
  const numeric = numericColumns(rows, names.length, semicolon);
  const xRaw = get("xcol").trim();
  const wRaw = get("wcol").trim();
  const pickNotes: string[] = [];
  let xc: number | undefined;
  let wc: number | undefined;
  if (xRaw) {
    const c = namedColumn(names, numeric, xRaw, "Income column");
    if (typeof c !== "number") return refuse(c.error);
    xc = c;
  }
  const listCols = (cols: number[]): string => cols.map((j) => q(names[j])).join(", ");
  if (grouped) {
    if (wRaw) {
      const c = namedColumn(names, numeric, wRaw, "Count or weight column");
      if (typeof c !== "number") return refuse(c.error);
      wc = c;
    }
    if (xc === undefined && wc === undefined) {
      if (numeric.length < 2) return refuse(`A grouped table needs two columns of numbers (income or mean, then count or weight); found ${numeric.length}.`);
      if (numeric.length > 2) {
        return refuse(
          `The table has ${numeric.length} columns of numbers (${listCols(numeric)}), so which is the income and which the count or weight is not clear. ` +
            "Name them in the fields “Income column” and “Count or weight column”.",
        );
      }
      [xc, wc] = numeric;
    } else if (xc === undefined || wc === undefined) {
      const known = (xc ?? wc)!;
      const rest = numeric.filter((j) => j !== known);
      if (rest.length !== 1) {
        return refuse(
          `The table has ${numeric.length} columns of numbers (${listCols(numeric)}); name the ${xc === undefined ? "income column" : "count or weight column"} too.`,
        );
      }
      if (xc === undefined) xc = rest[0];
      else wc = rest[0];
    }
    if (xc === wc) return refuse(`${q(names[xc!])} cannot be both the income column and the count or weight column.`);
  } else {
    if (wRaw) pickNotes.push(`The count or weight column (${q(wRaw)}) was ignored: the table was read as one income per row.`);
    if (xc === undefined) {
      if (!numeric.length) return refuse("The table has no column of numbers.");
      xc = numeric[0];
      if (numeric.length > 1) pickNotes.push(`The table has ${numeric.length} columns of numbers; the first, ${q(names[xc])}, was read as the incomes (name another in “Income column”).`);
    }
  }
  const xi = xc!;
  const wi = grouped ? wc! : -1;
  const sub: RegDataset = {
    names: grouped ? [names[xi], names[wi]] : [names[xi]],
    rows: rows.map((r) => (grouped ? [r[xi] ?? "", r[wi] ?? ""] : [r[xi] ?? ""])),
    named: true,
    semicolon,
  };
  const sel = selectColumns(sub, { dep: "", preds: grouped ? ["."] : [], text: "" });
  if (!sel.ok) return refuse(sel.reason);
  const { y: colX, X: colW, rowNumbers } = sel.cols;
  for (let u = 0; u < sub.names.length; u++) {
    const amb = dotGroupAmbiguity(
      rowNumbers.map((rn) => ({ cell: sub.rows[rn - 1][u], where: `Row ${rn}` })),
      `column ${q(sub.names[u])}`,
    );
    if (amb) return refuse(amb);
  }
  const readNotes = sel.cols.notes.filter((t) => !/listwise deletion/.test(t));
  const dropped = sel.cols.dropped;
  const xs: number[] = [];
  const ws: number[] = [];
  const exX: Rat[] = [];
  const exW: Rat[] = [];
  let exactOk = true;
  let zeroWeight = 0;
  for (let k = 0; k < colX.length; k++) {
    const rn = rowNumbers[k];
    const cx = sub.rows[rn - 1][0];
    const xv = colX[k];
    if (Math.abs(xv) > INEQ_MAX_ABS) return refuse(`Row ${rn}: ${q(cx)} is beyond the largest income accepted (10¹⁵ in absolute value).`);
    let wv = 1;
    if (grouped) {
      const cw = sub.rows[rn - 1][1];
      wv = colW[0][k];
      if (wv < 0) return refuse(`Row ${rn}: the count or weight ${q(cw)} is negative.`);
      if (wv > INEQ_MAX_ABS) return refuse(`Row ${rn}: the count or weight ${q(cw)} is beyond 10¹⁵.`);
      if (wv === 0) {
        zeroWeight++;
        continue;
      }
    }
    xs.push(xv);
    ws.push(wv);
    if (exactOk) {
      const a = exactOf(xv);
      const b = exactOf(wv);
      if (a && b) {
        exX.push(a);
        exW.push(b);
      } else exactOk = false;
    }
  }
  const n = xs.length;
  if (n === 0) return refuse("No incomes were read (every row was missing or had a zero count).");
  let W = 0;
  let T = 0;
  for (let i = 0; i < n; i++) {
    W += ws[i];
    T += ws[i] * xs[i];
  }
  const mean = T / W;
  if (!(mean > 0)) return refuse(`The mean income is ${mean === 0 ? "zero" : "negative"}; inequality measures need a positive mean.`);
  if (corr === "nn1" && !grouped && n < 2) return refuse("The small-sample correction n/(n − 1) needs at least two incomes.");
  const epsList = [0.5, 1, 2];
  if (userEps !== undefined && !epsList.includes(userEps)) epsList.push(userEps);
  const r = inequality({ x: xs, w: ws, grouped }, epsList, exactOk ? { x: exX, w: exW } : undefined);
  const extra = [...pickNotes, ...readNotes];
  if (spaceGrouped !== undefined) {
    const joined = spaceGrouped.replace(/ /g, "");
    extra.push(
      `${spaceGroupedCount} income${spaceGroupedCount === 1 ? " was" : "s were"} written with spaces between digit groups (${q(spaceGrouped)}) and read as one number each (${joined}), as the table reader reads such a cell. Separate the values with tabs if they are different columns.`,
    );
  }
  return ineqOutput(r, { grouped, corr: corr === "nn1", dropped, zeroWeight, extra, colName: names[xi], weightName: grouped ? names[wi] : "" });
}

const f4 = (v: number): string => fmtFixed(v, 4);
const money = (v: number): string => fmtFixed(v, 2);
const pct2 = (v: number): string => fmtFixed(v * 100, 2);

function ineqOutput(
  r: IneqResult,
  o: { grouped: boolean; corr: boolean; dropped: number; zeroWeight: number; extra: string[]; colName: string; weightName: string },
): StatOutput {
  const lines: string[] = [];
  const notes: string[] = [];
  const who = o.grouped
    ? `${intText(r.n)} group${r.n === 1 ? "" : "s"} (total weight ${fmtFixed(r.W, Number.isInteger(r.W) ? 0 : 2)})`
    : `${intText(r.n)} income${r.n === 1 ? "" : "s"}`;
  lines.push(
    o.grouped
      ? `Inequality of ${who}: income column ${q(o.colName)}, count or weight column ${q(o.weightName)}`
      : `Inequality of ${who}, column ${q(o.colName)}`,
  );
  const giniText = f4(r.gini);
  const fr = r.giniExact ? shortFraction(r.giniExact) : undefined;
  // The exact fraction is added when the four decimals shown are not already the exact value.
  const td = r.giniExact ? terminatingDecimals(r.giniExact) : null;
  const exactNote = fr && !(td !== null && td <= 4) ? ` (exactly ${fr})` : "";
  lines.push(`Gini G = ${giniText}${exactNote}${o.grouped ? ", a lower bound (equal incomes assumed within each group)" : ""}`);
  if (o.corr) {
    if (r.giniCorrected !== undefined) lines.push(`Gini with the small-sample correction n/(n − 1) = ${f4(r.giniCorrected)}`);
    else notes.push("The small-sample correction n/(n − 1) is offered for individual data only (a grouped table has no sample size n), so it is not shown.");
  }
  const parts: string[] = [];
  if (r.theilT !== undefined) parts.push(`Theil T = ${f4(r.theilT)}`);
  if (r.theilL !== undefined) parts.push(`Theil L = ${f4(r.theilL)}`);
  for (const a of r.atkinson) if (a.value !== undefined) parts.push(`A(${epsText(a.eps)}) = ${f4(a.value)}`);
  if (parts.length) lines.push(parts.join(", "));
  // The bottom 40% share is compared with 0 after inequality() has snapped rounding residue to an exact 0 relative to
  // the incomes' own scale (not an absolute 1e−12, which dropped a genuine share of 1e−13).
  const palmaOk = r.bottom40 > 0;
  const ratioOk = r.p10 > 0;
  const pp: string[] = [];
  if (palmaOk) pp.push(`Palma ratio = ${fmtFixed(r.top10 / r.bottom40, 3)}`);
  if (ratioOk) pp.push(`P90/P10 = ${fmtFixed(r.p90 / r.p10, 3)}`);
  if (pp.length) lines.push(pp.join(", "));
  lines.push("");

  const rows: string[][] = [["Measure", "Value", "Definition"]];
  rows.push(["Mean income μ", money(r.mean), o.grouped ? "Σ wᵢxᵢ / Σ wᵢ" : "Σ xᵢ / n"]);
  rows.push(["Gini G", giniText, "Σᵢ Σⱼ wᵢwⱼ|xᵢ − xⱼ| / (2W²μ)"]);
  if (o.corr && r.giniCorrected !== undefined) rows.push(["Gini, small-sample", f4(r.giniCorrected), "G·n/(n − 1)"]);
  if (r.theilT !== undefined) rows.push(["Theil T, GE(1)", f4(r.theilT), "(1/W) Σ wᵢ(xᵢ/μ) ln(xᵢ/μ)"]);
  else notes.push(`Theil T is left out: ${r.theilTWhy}.`);
  if (r.theilL !== undefined) rows.push(["Theil L, GE(0)", f4(r.theilL), "(1/W) Σ wᵢ ln(μ/xᵢ)"]);
  else notes.push(`Theil L is left out: ${r.theilLWhy}.`);
  for (const a of r.atkinson) {
    if (a.value !== undefined) rows.push([`Atkinson, ε = ${epsText(a.eps)}`, f4(a.value), a.eps === 1 ? "1 − exp((1/W) Σ wᵢ ln xᵢ)/μ" : `1 − [(1/W) Σ wᵢ(xᵢ/μ)^(1−ε)]^(1/(1−ε))`]);
    else notes.push(`Atkinson for ε = ${epsText(a.eps)} is left out: ${a.why}.`);
  }
  rows.push(["Bottom 40% income share (%)", pct2(r.bottom40), "Lorenz curve at 40%"]);
  rows.push(["Top 10% income share (%)", pct2(r.top10), "100% − Lorenz curve at 90%"]);
  if (palmaOk) rows.push(["Palma ratio", fmtFixed(r.top10 / r.bottom40, 3), "top 10% share / bottom 40% share"]);
  else notes.push(`The Palma ratio is left out: the bottom 40% hold ${r.bottom40 === 0 ? "no income (their share is exactly 0)" : "a negative share of income (negative incomes)"}, so the ratio is not defined.`);
  rows.push(["P10", money(r.p10), "smallest income with cumulative population share ≥ 10%"]);
  rows.push(["P90", money(r.p90), "smallest income with cumulative population share ≥ 90%"]);
  if (ratioOk) rows.push(["P90/P10", fmtFixed(r.p90 / r.p10, 3), "P90 / P10"]);
  else notes.push(`P90/P10 is left out: P10 is ${r.p10 === 0 ? "zero" : "negative"}.`);

  const lzRows: string[][] = [["Population share (%)", "Income share (%)"]];
  for (let k = 0; k <= 10; k++) lzRows.push([String(k * 10), pct2(lorenzAt(r.lorenz, k / 10))]);

  const conv: string[] = [];
  conv.push(
    "Conventions: Gini is the mean absolute difference over twice the mean, G = Σᵢ Σⱼ wᵢwⱼ|xᵢ − xⱼ| / (2W²μ) (Sen 1973; Cowell 2011, Measuring Inequality, 3rd ed.), " +
      "with no small-sample correction unless chosen (then G·n/(n − 1), individual data only). It equals twice the area between the line of equality and the Lorenz curve drawn with straight segments.",
  );
  conv.push(
    "Theil T = GE(1) and Theil L = GE(0), the mean log deviation (Theil 1967; Shorrocks 1980), with 0·ln 0 = 0 in Theil T. Atkinson (1970): A(ε) = 1 − [(1/W) Σ wᵢ(xᵢ/μ)^(1−ε)]^(1/(1−ε)), A(1) = 1 − (geometric mean)/μ. " +
      "Natural logarithms throughout.",
  );
  conv.push(
    "Quantiles: Hyndman & Fan (1996) definition 1, the inverse of the weighted empirical distribution (P10 is the smallest income whose cumulative population share reaches 10%). " +
      "The Palma ratio (Palma 2011; Cobham & Sumner 2013) and the shares are read off the Lorenz curve, interpolated linearly between observations.",
  );
  conv.push(
    "Zero incomes are allowed for Gini, Theil T and Atkinson ε < 1; Theil L and Atkinson ε ≥ 1 need every income positive. A negative income leaves only Gini (which can then exceed 1).",
  );
  if (o.grouped) {
    conv.push(
      "Grouped data: every member of a group is given the group's income, so inequality inside groups is ignored. The Gini, Theil T and L, the Atkinson indices, the top 10% share and the Palma ratio are therefore LOWER BOUNDS on the true values (and the bottom 40% share an upper bound). " +
        "P10, P90 and P90/P10 are quantiles of the group incomes, not of individual incomes, and are not bounds in either direction.",
    );
  }
  if (r.giniExact && fr) conv.push("The Gini was also computed in exact fractions from the typed decimals.");
  if (r.n > 1 && r.min === r.max) conv.push("Every income is the same, so every measure is exactly 0 (set exactly, not left to rounding).");
  if (o.dropped) notes.push(`${o.dropped} row${o.dropped === 1 ? "" : "s"} with a missing cell ${o.dropped === 1 ? "was" : "were"} left out.`);
  if (o.zeroWeight) notes.push(`${o.zeroWeight} group${o.zeroWeight === 1 ? "" : "s"} with a zero count ${o.zeroWeight === 1 ? "was" : "were"} left out.`);
  if (r.n === 1) notes.push("With a single income or group every inequality measure is 0.");
  if (r.negatives) notes.push(`${r.negatives} income${r.negatives === 1 ? " is" : "s are"} negative.`);
  notes.push(...o.extra);
  lines.push(...conv, ...notes);

  const tables: StatTable[] = [
    { label: "Inequality measures", rows, align: ["left", "right", "left"] },
    { label: "Lorenz curve at deciles of population", rows: lzRows, align: ["right", "right"], note: "Linear between observations (between group points for grouped data)." },
  ];
  const svg = lorenzSvg(r.lorenz, giniText, o.grouped);
  return { text: lines.join("\n"), reading: ineqReading(r, o.grouped), tables, svg };
}

/**
 * ineq-gini's reading: the Gini on its 0-to-1 scale and the top 10% against the bottom 40%, in the table's digits
 * (f4, pct2). Grouped data give lower bounds, and negative incomes take the Gini off its 0-to-1 scale.
 */
export function ineqReading(r: IneqResult, grouped: boolean): string {
  const g = f4(r.gini);
  if (r.min === r.max) return `${r.n === 1 ? "With a single income there is nothing to compare" : "Every income is the same"}, so the Gini coefficient is ${g}: no inequality at all.`;
  const scale = r.negatives ? "" : " on a scale from 0 (everyone has the same income) to 1 (one person has it all)";
  const first = `The Gini coefficient is ${grouped ? "at least " : ""}${g}${scale}.`;
  const top = pct2(r.top10);
  const bottom = pct2(r.bottom40);
  const cmpWord = top === bottom ? "the same as" : r.top10 > r.bottom40 ? "more than" : "less than";
  const second = `The richest 10% receive ${top}% of all income, ${cmpWord} the ${bottom}% that goes to the poorest 40%.`;
  return `${first} ${second}`.length <= 320 ? `${first} ${second}` : first;
}

/** Two sentences of a reading, or the first alone when both would pass the reading's 320-character limit. */
function joinTwo(first: string, second: string): string {
  return `${first} ${second}`.length <= 320 ? `${first} ${second}` : first;
}

function epsText(e: number): string {
  return numText(e);
}

// =================================================================================================================
// conc-hhi

export const CONC_HHI_FIELDS: E5Field[] = [
  { key: "data", label: "Firms: name | share (or sales), one firm per row; separate with tabs if names have spaces", kind: "block" },
  {
    key: "units",
    label: "The numbers are",
    kind: "select",
    options: [
      { value: "percent", label: "Shares in percent (28 = 28%)" },
      { value: "fraction", label: "Shares as fractions (0.28 = 28%)" },
      { value: "sales", label: "Sales or output (converted to shares of their total)" },
    ],
  },
  { key: "merging", label: "Merging firms, one name per line (blank = no merger)", kind: "block" },
  {
    key: "show2010",
    label: "Also show the 2010 Horizontal Merger Guidelines bands",
    kind: "select",
    options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes (superseded, for comparison)" },
    ],
  },
];

export const CONC_HHI_DEFAULTS: Record<string, string> = {
  data: ["Firm\tShare", "Alder\t28", "Birch\t22", "Cedar\t18", "Dogwood\t14", "Elm\t10", "Fir\t8"].join("\n"),
  units: "percent",
  merging: "Cedar\nElm",
  show2010: "no",
};

export const HHI_MAX_FIRMS = 2000;
/** Bars the share figure draws (statchart groupedBarSvg draws at most 16 categories). */
export const HHI_FIG_CAP = 16;
/** Percent shares (or fractions ×100) may sum to 100 ± this before the remainder counts as a fringe or is refused. */
export const HHI_TOLERANCE = 0.5;

const R100: Rat = { n: 100n, d: 1n };
const R1800: Rat = { n: 1800n, d: 1n };
const R30: Rat = { n: 30n, d: 1n };
const R1500: Rat = { n: 1500n, d: 1n };
const R2500: Rat = { n: 2500n, d: 1n };
const R200: Rat = { n: 200n, d: 1n };
const cmp = (a: Rat, b: Rat): number => ratSign(ratSub(a, b));
const sq = (a: Rat): Rat => ratMul(a, a);

/** HHI / share text: exact when it terminates within 2 decimals, else rounded to 2 (half away from zero). */
function ptsText(r: Rat): string {
  const t = terminatingDecimals(r);
  if (t !== null && t <= 2) return exactText(r, 0);
  return unitsText(roundUnits(r, 2), 2);
}

export const MG2023_CITATION =
  "U.S. Department of Justice & Federal Trade Commission, Merger Guidelines § 2.1 (Guideline 1), pp. 5–6 & nn. 13–16 (issued December 18, 2023)";
export const HMG2010_CITATION = "U.S. Department of Justice & Federal Trade Commission, Horizontal Merger Guidelines § 5.3 (August 19, 2010), withdrawn December 2023";

export function concHhiCalc(read: Read): StatOutput {
  const get = getter(read);
  const units = get("units") || "percent";
  if (!["percent", "fraction", "sales"].includes(units)) return refuse(`Unknown units ${q(units)}.`);
  const show2010 = (get("show2010") || "no") === "yes";
  const text = get("data");
  if (!text.trim()) return refuse("Paste the firms: one per row, the firm's name then its share (or sales).");
  // Space-separated rows ("Alder 28,5", "Acme Corp 28") are split at the LAST space: the name may hold spaces and
  // the number may hold a decimal comma (through the table reader that comma would make a CSV and split the row).
  // "A 28 %": a space before the % sign belongs to the number ("28 %" is 28 percent, as the cell reader reads it),
  // so it is joined before the row is split; otherwise "%" was the share and the row was eaten as a header.
  const ls = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim().replace(/(\d)[ \t]+%$/, (_m, d: string) => `${d}%`))
    .filter((l) => l !== "");
  const splitLast = (l: string): RegExpExecArray | null => /^(.*\S)\s+(\S+)$/.exec(l);
  // Not when a name part ends in a comma ("Alder, 28" is a CSV row).
  const spaced = !/[\t;]/.test(text) && ls.length > 0 && ls.every((l) => {
    const m = splitLast(l);
    return m !== null && !m[1].endsWith(",");
  });
  let rows: string[][];
  let semicolon = false;
  if (spaced) {
    rows = ls.map((l) => {
      const m = splitLast(l)!;
      return [m[1], m[2]];
    });
    for (let i = 0; i < rows.length; i++) {
      const lastWord = rows[i][0].split(/\s+/).pop() ?? "";
      if (Number.isFinite(readRegCell(lastWord, false).value) && Number.isFinite(readRegCell(rows[i][1], false).value)) {
        return refuse(`Row ${i + 1}, ${q(ls[i])}: two numbers at the end of the row. Each row is a firm's name and ONE share; separate the cells with tabs if the name ends in a number.`);
      }
    }
    // A header row: its last cell is not a number, holds no digit and is not a missing marker ("Firm Share"). A first
    // row "Alder n/a" is a firm with a missing share (refused by row below), never a header.
    if (rows.length && !Number.isFinite(readRegCell(rows[0][1], false).value) && !/\d/.test(rows[0][1]) && !isMissingCell(rows[0][1])) rows = rows.slice(1);
  } else {
    const pr = parseRegData(text);
    if (!pr.ok) return refuse(pr.reason);
    rows = pr.data.rows;
    semicolon = !!pr.data.semicolon;
    if (pr.data.names.length < 2) return refuse("Each row needs the firm's name and its share (or sales): two columns.");
    const nh = numberShapedHeader(pr.data.names, pr.data.named);
    if (nh) return refuse(nh);
  }
  if (rows.length > HHI_MAX_FIRMS) return refuse(`At most ${intText(HHI_MAX_FIRMS)} firms are accepted; the table has ${intText(rows.length)}.`);
  const firms: { name: string; v: Rat }[] = [];
  const seen = new Map<string, number>();
  let pctSign = false;
  for (let i = 0; i < rows.length; i++) {
    const nm = (rows[i][0] ?? "").trim();
    const cell = (rows[i][1] ?? "").trim();
    if (nm === "" && cell === "") continue;
    if (nm === "") return refuse(`Row ${i + 1} has no firm name.`);
    if (Number.isFinite(readRegCell(nm, semicolon).value)) return refuse(`Row ${i + 1}: the first column should name the firm; ${q(nm)} is a number.`);
    for (let j = 2; j < rows[i].length; j++) if ((rows[i][j] ?? "").trim() !== "") return refuse(`Row ${i + 1} has more than two cells (name, share). Separate the cells with tabs if a name contains spaces.`);
    if (isMissingCell(cell)) return refuse(`Row ${i + 1} (${q(nm)}) has no share${cell ? ` (${q(cell)})` : ""}: every firm needs a number. Leave the firm out to count it in the unnamed fringe.`);
    if (cell.includes("%")) pctSign = true;
    const rv = readRegCell(cell, semicolon);
    if (!Number.isFinite(rv.value)) return refuse(`Row ${i + 1} (${q(nm)}): ${q(cell)} is not a finite number.`);
    if (rv.value < 0) return refuse(`Row ${i + 1} (${q(nm)}): a share or sales figure cannot be negative (${q(cell)}).`);
    const key = nm.toLowerCase();
    if (seen.has(key)) return refuse(`${q(nm)} is listed twice (rows ${seen.get(key)! + 1} and ${i + 1}).`);
    seen.set(key, i);
    const ex = ratOf(rv.value);
    if (!ex) return refuse(`Row ${i + 1} (${q(nm)}): ${q(cell)} cannot be held exactly.`);
    firms.push({ name: nm, v: ex });
  }
  if (!firms.length) return refuse("No firms were read.");
  if (pctSign && units !== "percent") return refuse("The numbers carry % signs, but the units say otherwise: choose “Shares in percent”.");
  // The share column under regData's whole-column rules (a decimal comma beside "1,500" or "1.250" is refused).
  const shareCol: RegDataset = { names: ["Share"], rows: rows.map((r) => [(r[1] ?? "").trim()]), named: true, semicolon };
  const sel = selectColumns(shareCol, { dep: "", preds: [], text: "" });
  if (!sel.ok) return refuse(sel.reason);
  const readNotes = sel.cols.notes.filter((t) => !/listwise deletion/.test(t));
  if (units === "sales") {
    // Sales typed with point groups ("1.250", "2.000") beside plain integers ("980"): 1,250 or 1.25 is not shown.
    const amb = dotGroupAmbiguity(
      rows.map((r, i) => ({ cell: (r[1] ?? "").trim(), where: `Row ${i + 1} (${q((r[0] ?? "").trim())})` })).filter((it) => it.cell !== ""),
      "the sales column",
    );
    if (amb) return refuse(amb);
  }

  // Shares in percent, exactly.
  let shares: Rat[];
  let total: Rat = RAT_ZERO;
  for (const f of firms) total = ratAdd(total, f.v);
  const notes: string[] = [];
  let fringe: Rat = RAT_ZERO;
  if (units === "sales") {
    if (ratSign(total) <= 0) return refuse("The sales add to zero, so no shares can be formed.");
    shares = firms.map((f) => ratDiv(ratMul(f.v, R100), total));
    notes.push(`Read as sales: each firm's share is its sales over the total of the listed firms (${exactText(total, 0)}), so the listed firms are the whole market.`);
  } else {
    shares = units === "fraction" ? firms.map((f) => ratMul(f.v, R100)) : firms.map((f) => f.v);
    let sum: Rat = RAT_ZERO;
    for (const s of shares) sum = ratAdd(sum, s);
    const sumNum = ratToNumber(sum);
    const word = units === "fraction" ? "Read as fractions of the market (0.28 = 28%)." : "Read as percentage shares.";
    notes.push(word);
    if (units === "percent" && !pctSign && sumNum > 0 && sumNum <= 1 + 1e-9) {
      return refuse(`The shares add to ${ptsText(sum)}% of the market, which looks like fractions (0.28 = 28%). Choose “Shares as fractions”, or type percentages.`);
    }
    if (sumNum > 100 + HHI_TOLERANCE) {
      return refuse(
        `The shares add to ${ptsText(sum)}%, more than 100% (beyond the ${HHI_TOLERANCE} point rounding allowance). Check the shares${units === "percent" ? ", or choose “Sales or output” if they are sales" : ""}.`,
      );
    }
    if (sumNum < 100 - HHI_TOLERANCE) {
      fringe = ratSub(R100, sum);
      notes.push(
        `The shares add to ${ptsText(sum)}%; the remaining ${ptsText(fringe)}% is treated as an unnamed fringe (“Other”). Its HHI contribution is unknown unless it is split into firms: ` +
          `it lies between 0 (an infinitely fragmented fringe) and ${ptsText(sq(fringe))} (the fringe as one firm), so the HHI is printed as that range.`,
      );
    } else if (cmp(sum, R100) !== 0) {
      notes.push(`The shares add to ${ptsText(sum)}%, within ${HHI_TOLERANCE} point of 100%: read as rounding and used as typed (not rescaled).`);
    }
  }
  const hasFringe = ratSign(fringe) > 0;
  let hhi: Rat = RAT_ZERO;
  for (const s of shares) hhi = ratAdd(hhi, sq(s));
  const hhiHi = hasFringe ? ratAdd(hhi, sq(fringe)) : hhi;

  // The merger.
  const mergeNames = get("merging")
    .split(/[\n;]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const idx = new Map(firms.map((f, i) => [f.name.toLowerCase(), i]));
  const mIdx: number[] = [];
  for (const m of mergeNames) {
    const k = idx.get(m.toLowerCase());
    if (k === undefined) return refuse(`The merging firm ${q(m)} is not in the table. Use the names exactly as listed.`);
    if (mIdx.includes(k)) return refuse(`The merging firm ${q(m)} is named twice.`);
    mIdx.push(k);
  }
  if (mIdx.length === 1) return refuse("A merger needs at least two of the listed firms; one was named.");
  const merger = mIdx.length >= 2;
  let mShare: Rat = RAT_ZERO;
  let mSq: Rat = RAT_ZERO;
  for (const k of mIdx) {
    mShare = ratAdd(mShare, shares[k]);
    mSq = ratAdd(mSq, sq(shares[k]));
  }
  const delta = ratSub(sq(mShare), mSq);
  const post = ratAdd(hhi, delta);
  const postHi = ratAdd(hhiHi, delta);

  // CR4 (with the fringe as one firm for the upper bound).
  const cr4 = (vals: Rat[]): Rat => [...vals].sort((a, b) => cmp(b, a)).slice(0, 4).reduce((s: Rat, v) => ratAdd(s, v), RAT_ZERO);
  const postShares = merger ? [mShare, ...shares.filter((_, i) => !mIdx.includes(i))] : shares;
  const cr4Pre = cr4(shares);
  const cr4PreHi = hasFringe ? cr4([...shares, fringe]) : cr4Pre;
  const cr4Post = cr4(postShares);
  const cr4PostHi = hasFringe ? cr4([...postShares, fringe]) : cr4Post;
  const range = (lo: Rat, hi: Rat): string => (cmp(lo, hi) === 0 ? ptsText(lo) : `${ptsText(lo)} to ${ptsText(hi)}`);

  // 2023 Guideline 1, evaluated at both ends of the fringe range.
  type Tri = "yes" | "no" | "depends";
  const tri = (lo: boolean, hi: boolean): Tri => (lo && hi ? "yes" : !lo && !hi ? "no" : "depends");
  const highLo = cmp(merger ? post : hhi, R1800) > 0;
  const highHi = cmp(merger ? postHi : hhiHi, R1800) > 0;
  const highly = tri(highLo, highHi);
  const sigInc = cmp(delta, R100) > 0;
  const presHhi = merger ? tri(highLo && sigInc, highHi && sigInc) : "no";
  const presShare = merger && cmp(mShare, R30) > 0 && sigInc;
  const triText = (t: Tri): string => (t === "yes" ? "Yes" : t === "no" ? "No" : "Depends on how the fringe splits");

  const lines: string[] = [];
  const mergedName = mIdx.map((k) => firms[k].name).join(" + ");
  lines.push(`Market concentration: ${firms.length} firm${firms.length === 1 ? "" : "s"}${hasFringe ? " and an unnamed fringe" : ""}`);
  lines.push(`HHI = ${range(hhi, hhiHi)}, CR4 = ${range(cr4Pre, cr4PreHi)}%`);
  if (merger) {
    lines.push(`Merger of ${mergedName}: merged share ${ptsText(mShare)}%, ΔHHI = ${ptsText(delta)}, post-merger HHI = ${range(post, postHi)}`);
    if (presHhi === "yes" || presShare) {
      const which = [presHhi === "yes" ? "post-merger HHI above 1,800 with ΔHHI above 100" : "", presShare ? "merged share above 30% with ΔHHI above 100" : ""].filter(Boolean).join("; and ");
      lines.push(`2023 Merger Guidelines, Guideline 1: the structural presumption threshold is met (${which}).`);
    } else if (presHhi === "depends") {
      lines.push("2023 Merger Guidelines, Guideline 1: whether the HHI threshold is met depends on how the fringe splits (the HHI range straddles 1,800); it cannot be classified without that split.");
    } else {
      lines.push("2023 Merger Guidelines, Guideline 1: neither structural presumption threshold is met.");
    }
  } else {
    lines.push(
      `2023 Merger Guidelines: ${highly === "yes" ? "a highly concentrated market (HHI above 1,800)" : highly === "no" ? "not a highly concentrated market (HHI 1,800 or below)" : "whether the market is highly concentrated (HHI above 1,800) depends on how the fringe splits"}. Name two or more merging firms to screen a merger.`,
    );
  }
  lines.push("");
  lines.push(
    `Conventions: shares in percent, HHI = Σ sᵢ² on the 0–10,000 scale, computed exactly from the typed numbers; CR4 = the four largest shares added. ` +
      (merger ? "ΔHHI = (Σ sₘ)² − Σ sₘ² over the merging firms (2·s₁·s₂ for two firms, the 2ab of the 2023 Guidelines' n. 14). " : "") +
      "The merged firm's share is the sum of the merging firms' shares (no diversion or share loss assumed).",
  );
  lines.push(
    "2023 Merger Guidelines, Guideline 1: “Markets with an HHI greater than 1,800 are highly concentrated, and a change of more than 100 points is a significant increase.” A merger that creates or further consolidates a highly concentrated market with an HHI increase of more than 100 points is presumed to substantially lessen competition or tend to create a monopoly, " +
      "as is a merger creating a firm with a share over thirty percent that also involves an HHI increase of more than 100 points. The thresholds are strict: exactly 1,800, 100 or 30% does not exceed them. The 2023 text defines no other concentration tier.",
  );
  lines.push(
    `Source: ${MG2023_CITATION}. This is the Guidelines' structural screen, not a legal conclusion: the presumption can be rebutted or disproved, and the other guidelines can apply when it is not met. ` +
      "The 2023 edition is applied as issued; whether it is the current enforcement standard is not asserted here.",
  );
  lines.push(...notes, ...readNotes);

  // Tables.
  const order = firms.map((_, i) => i).sort((a, b) => cmp(shares[b], shares[a]));
  const shareRows: string[][] = [merger ? ["Firm", "Share (%)", "sᵢ² (HHI points)", "Post-merger share (%)"] : ["Firm", "Share (%)", "sᵢ² (HHI points)"]];
  for (const i of order) {
    const row = [firms[i].name, ptsText(shares[i]), ptsText(sq(shares[i]))];
    if (merger) row.push(mIdx.includes(i) ? `${ptsText(mShare)} (merged)` : ptsText(shares[i]));
    shareRows.push(row);
  }
  if (hasFringe) {
    const row = ["Other (unnamed fringe)", ptsText(fringe), `0 to ${ptsText(sq(fringe))}`];
    if (merger) row.push(ptsText(fringe));
    shareRows.push(row);
  }
  const totRow = ["Total", hasFringe ? "100" : ptsText(shares.reduce((s: Rat, v) => ratAdd(s, v), RAT_ZERO)), range(hhi, hhiHi)];
  if (merger) totRow.push(hasFringe ? "100" : totRow[1]);
  shareRows.push(totRow);

  const concRows: string[][] = [merger ? ["Measure", "Pre-merger", "Post-merger"] : ["Measure", "Value"]];
  if (merger) {
    concRows.push(["HHI", range(hhi, hhiHi), range(post, postHi)]);
    concRows.push(["ΔHHI", "0", ptsText(delta)]);
    concRows.push(["CR4 (%)", range(cr4Pre, cr4PreHi), range(cr4Post, cr4PostHi)]);
    concRows.push(["Largest merging firm / merged firm share (%)", ptsText(mIdx.map((k) => shares[k]).reduce((a, b) => (cmp(a, b) >= 0 ? a : b))), ptsText(mShare)]);
  } else {
    concRows.push(["HHI", range(hhi, hhiHi)]);
    concRows.push(["CR4 (%)", range(cr4Pre, cr4PreHi)]);
  }

  const tables: StatTable[] = [
    { label: "Market shares", rows: shareRows, align: merger ? ["left", "right", "right", "right"] : ["left", "right", "right"] },
    { label: "Concentration", rows: concRows, align: merger ? ["left", "right", "right"] : ["left", "right"] },
  ];
  const gRows: string[][] = [["Indicator", "2023 threshold", "This market", "Met"]];
  if (merger) {
    gRows.push(["Post-merger HHI", "greater than 1,800", range(post, postHi), triText(highly)]);
    gRows.push(["Change in HHI", "greater than 100", ptsText(delta), sigInc ? "Yes" : "No"]);
    // The presumption rows restate their two inputs (no empty computed cell).
    gRows.push(["Presumption: HHI", "both rows above", `${range(post, postHi)}; Δ ${ptsText(delta)}`, triText(presHhi as Tri)]);
    gRows.push(["Merged firm's share", "greater than 30%", `${ptsText(mShare)}%`, cmp(mShare, R30) > 0 ? "Yes" : "No"]);
    gRows.push(["Presumption: share", "share and ΔHHI rows", `${ptsText(mShare)}%; Δ ${ptsText(delta)}`, presShare ? "Yes" : "No"]);
  } else {
    gRows.push(["Market HHI", "greater than 1,800 (highly concentrated)", range(hhi, hhiHi), triText(highly)]);
  }
  tables.push({ label: "2023 Merger Guidelines, Guideline 1 screen", rows: gRows, align: ["left", "left", "right", "left"], note: `${MG2023_CITATION}. A screen, not a legal conclusion.` });

  if (show2010) {
    const band = (h: Rat): string => (cmp(h, R1500) < 0 ? "Unconcentrated (below 1,500)" : cmp(h, R2500) <= 0 ? "Moderately concentrated (1,500 to 2,500)" : "Highly concentrated (above 2,500)");
    const lo = merger ? post : hhi;
    const hi = merger ? postHi : hhiHi;
    const bandText = band(lo) === band(hi) ? band(lo) : `${band(lo)} to ${band(hi)} (depends on the fringe)`;
    const r10: string[][] = [["Item", "2010 band (superseded)"], [merger ? "Post-merger HHI" : "Market HHI", `${range(lo, hi)}: ${bandText}`]];
    if (merger) {
      const statement = (h: Rat): string => {
        const b = band(h);
        if (cmp(delta, R100) < 0) return "Small change (below 100): ordinarily no further analysis";
        if (b.startsWith("Unconcentrated")) return "Unconcentrated: ordinarily no further analysis";
        if (b.startsWith("Moderately")) return cmp(delta, R100) > 0 ? "Potentially raises significant competitive concerns; often warrants scrutiny" : "Exactly 100 points in a moderately concentrated market: the 2010 text gives no statement";
        return cmp(delta, R200) > 0 ? "Presumed likely to enhance market power (rebuttable)" : "Potentially raises significant competitive concerns; often warrants scrutiny";
      };
      const s1 = statement(lo);
      const s2 = statement(hi);
      r10.push(["Change in HHI", `${ptsText(delta)}: ${s1 === s2 ? s1 : `${s1} / ${s2} (depends on the fringe)`}`]);
    }
    tables.push({
      label: "2010 Horizontal Merger Guidelines bands (superseded, for comparison only)",
      rows: r10,
      align: ["left", "left"],
      note: `${HMG2010_CITATION}. Endpoints as in the 2010 text: below 1,500; 1,500 to 2,500 inclusive; above 2,500; ΔHHI below 100, 100 to 200 inclusive, above 200.`,
    });
  }

  // Figure: share bars, pre vs post.
  // The chart draws at most HHI_FIG_CAP categories: the merged firm, the merging firms and "Other" always have a
  // place; the largest other firms fill the rest and the smallest are combined into "Other" (said in a note).
  const cats: string[] = [];
  const pre: number[] = [];
  const postV: number[] = [];
  const mergingOrd = order.filter((i) => mIdx.includes(i));
  const othersOrd = order.filter((i) => !mIdx.includes(i));
  const fits = (merger ? 1 : 0) + mergingOrd.length + othersOrd.length + (hasFringe ? 1 : 0) <= HHI_FIG_CAP;
  const lumpMerging = !fits && mergingOrd.length > HHI_FIG_CAP - 4;
  const room = fits ? othersOrd.length : HHI_FIG_CAP - (merger ? 1 : 0) - (lumpMerging ? 1 : mergingOrd.length) - 1;
  const shownOthers = othersOrd.slice(0, room);
  const lumped = othersOrd.slice(room);
  if (merger) {
    cats.push("Merged");
    pre.push(0);
    postV.push(ratToNumber(mShare));
    if (lumpMerging) {
      cats.push(`Merging firms (${mergingOrd.length})`);
      pre.push(ratToNumber(mShare));
      postV.push(0);
    } else {
      for (const i of mergingOrd) {
        cats.push(firms[i].name);
        pre.push(ratToNumber(shares[i]));
        postV.push(0);
      }
    }
  }
  for (const i of shownOthers) {
    cats.push(firms[i].name);
    pre.push(ratToNumber(shares[i]));
    postV.push(ratToNumber(shares[i]));
  }
  if (hasFringe || lumped.length) {
    let rest: Rat = fringe;
    for (const i of lumped) rest = ratAdd(rest, shares[i]);
    // (The chart cuts category labels at 10 characters: the bar is "Other" and the note says what it holds.)
    cats.push("Other");
    pre.push(ratToNumber(rest));
    postV.push(ratToNumber(rest));
  }
  if (lumped.length || lumpMerging) {
    lines.push(
      `The figure shows ${lumpMerging ? "the merging firms combined" : "every merging firm"}${lumped.length ? ` and the ${shownOthers.length} largest other firms; the remaining ${lumped.length} firm${lumped.length === 1 ? " is" : "s are"} combined as “Other”${hasFringe ? " with the unnamed fringe" : ""}` : ""} (the chart has room for ${HHI_FIG_CAP} bars). The tables list every firm.`,
    );
  }
  const svg = groupedBarSvg(
    cats,
    merger ? [{ label: "Pre-merger", values: pre }, { label: "Post-merger", values: postV }] : [{ label: "Share", values: pre }],
    { title: merger ? `Market shares before and after ${mergedName}`.slice(0, 60) : "Market shares", ylabel: "Market share (%)" },
  );
  // The reading: the HHI (or the merger's change) against the 2023 Guideline 1 screen, in the text's exact digits.
  let reading: string;
  if (merger) {
    const who = mIdx.map((k) => firms[k].name);
    const pair = who.length === 2 ? `${who[0]} and ${who[1]}` : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
    // A change that rounds to 0.00 is said as such, not as "raises the HHI by 0.00" (R6 #15).
    const roundsToZero = (s: string): boolean => /^0(\.0+)?$/.test(s);
    const tiny = roundsToZero(ptsText(delta)) && ratSign(delta) > 0;
    const shareText = roundsToZero(ptsText(mShare)) && ratSign(mShare) > 0 ? "a combined share below a hundredth of a percent" : `a combined share of ${ptsText(mShare)}%`;
    const build = (names: string): string => {
      const head = tiny
        ? `The merger of ${names} raises the HHI only negligibly (by less than a hundredth of a point), leaving it at ${range(post, postHi)}, with ${shareText}`
        : `The merger of ${names} raises the HHI by ${ptsText(delta)} to ${range(post, postHi)}, with ${shareText}`;
      return presHhi === "yes" || presShare
        ? `${head}, so it meets the 2023 Merger Guidelines' structural presumption against the merger. That presumption is a screen the parties can rebut, not a legal conclusion.`
        : presHhi === "depends"
          ? `${head}; whether it meets the 2023 Merger Guidelines' structural presumption depends on how the unnamed fringe splits.`
          : `${head}, which does not meet either structural presumption of the 2023 Merger Guidelines' screen. Other parts of the guidelines can still apply.`;
    };
    // Long firm names: name the firms generically before ever dropping the legal caveat (R6 #7).
    const numWord = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"][who.length];
    const generic = numWord ? `the ${numWord} firms` : `the ${who.length} firms`;
    reading = [build(pair), build(generic)].find((s) => s.length <= 320) ?? build(generic);
  } else {
    const level =
      highly === "yes"
        ? "above the 1,800 that the 2023 Merger Guidelines treat as highly concentrated"
        : highly === "no"
          ? "not above the 1,800 that the 2023 Merger Guidelines treat as highly concentrated"
          : "and whether it is above the 2023 Merger Guidelines' 1,800 line depends on how the unnamed fringe splits";
    reading = `The market's HHI is ${range(hhi, hhiHi)}, ${level}; the four largest firms hold ${range(cr4Pre, cr4PreHi)}% of the market.`;
  }
  return { text: lines.join("\n"), reading, tables, svg };
}

// =================================================================================================================
// io-leontief

export const IO_LEONTIEF_FIELDS: E5Field[] = [
  {
    key: "mode",
    label: "The table is",
    kind: "select",
    options: [
      { value: "A", label: "Technical coefficients A (input from row sector per unit of column sector's output)" },
      { value: "Z", label: "Transactions Z (row sector's sales to column sector), with total output x" },
    ],
  },
  { key: "matrix", label: "n × n table with sector names: the first row names the sectors, the first column the same names in the same order", kind: "block" },
  { key: "xout", label: "Total output x, one value per sector in table order (transactions table only)", kind: "text" },
  { key: "fd", label: "Final demand f, one value per sector (blank = none; with a transactions table, blank = x − Z·1)", kind: "text" },
  { key: "emp", label: "Employment per unit of output, one value per sector (blank = none)", kind: "text" },
];

export const IO_LEONTIEF_DEFAULTS: Record<string, string> = {
  mode: "A",
  matrix: ["Sector\tFarming\tManufacturing\tServices", "Farming\t0.15\t0.25\t0.05", "Manufacturing\t0.20\t0.05\t0.40", "Services\t0.30\t0.25\t0.05"].join("\n"),
  xout: "",
  fd: "100, 200, 300",
  emp: "0.8, 0.5, 1.2",
};

/**
 * A list field of n numbers. Separators, as the product's list fields decide them: a comma followed by a space, or
 * a semicolon, separates values (and then a space inside a value groups digits, "1 000, 2 000"); a field that is one
 * run with commas ("100,200,300") is comma-separated; otherwise spaces separate. Spaces are refused when they may
 * be grouping digits instead: "1 000 2 000" is 1000 and 2000, or 1, 0, 2 and 0 — a three-digit value with a leading
 * zero after a short one, or a count that matches n only when the space groups are joined, names both readings.
 * The values then go through regData's cell reader under one convention (readConsistent).
 */
function readListField(raw: string, label: string, n: number): { values: number[]; note: string } | { error: string } | null {
  const text = raw.trim();
  if (!text) return null;
  let tokens: string[];
  if (text.includes(";")) {
    const amb = semicolonCommaRefusal(text, "numbers");
    if (amb) return { error: `${label}: ${amb}` };
    tokens = text.split(/\s*;\s*/);
  } else if (/,\s/.test(text)) {
    tokens = text.split(/\s*,\s+/);
  } else if (!/\s/.test(text) && text.includes(",") && !(n === 1 && THOUSANDS_SHAPE.test(text))) {
    tokens = text.split(",");
  } else {
    tokens = text.split(/\s+/);
    // The space-grouped reading: maximal runs "d{1,3}( ddd)+" joined, as the cell reader would read each run.
    const grouped = text.match(/[-−+]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?(?=\s|$)|\S+/g) ?? [];
    let leadingZero: string | undefined;
    for (let k = 1; k < tokens.length; k++) {
      if (/^0\d{2}$/.test(tokens[k]) && /^[-−+]?\d{1,3}$/.test(tokens[k - 1])) {
        leadingZero = `${tokens[k - 1]} ${tokens[k]}`;
        break;
      }
    }
    const joinMatches = grouped.length !== tokens.length && tokens.length !== n && grouped.length === n;
    if (leadingZero !== undefined || joinMatches) {
      const run = leadingZero ?? grouped.find((g) => / /.test(g))!;
      return {
        error:
          `${label}: ${q(run)} may be one number with a space grouping its digits (${run.replace(/ /g, "")}) or separate values (${run.split(" ").join(", ")}). ` +
          `Separate the values with a comma and a space (“1000, 2000”), and write each number without spaces.`,
      };
    }
  }
  tokens = tokens.map((t) => t.trim()).filter((t) => t !== "");
  for (const [k, t] of tokens.entries()) if (isMissingCell(t)) return { error: `${label}: value ${k + 1} (${q(t)}) is missing; every sector needs a number.` };
  const rc = readConsistent(tokens.map((t, k) => ({ cell: t, where: `${label}, value ${k + 1}` })), label.toLowerCase());
  if (!rc.ok) return { error: rc.reason };
  if (rc.values.length !== n) return { error: `${label} has ${rc.values.length} value${rc.values.length === 1 ? "" : "s"}; the table has ${n} sectors.` };
  const notes: string[] = [];
  if (rc.decimalCommas) notes.push(`${label}: ${rc.decimalCommas} decimal comma${rc.decimalCommas === 1 ? "" : "s"} read as decimal${rc.decimalCommas === 1 ? "" : "s"} (“0,5” is 0.5).`);
  if (rc.thousands.length) notes.push(`${label}: ${rc.thousands.map((t) => q(t.cell)).join(", ")} read with a thousands comma (${rc.thousands.map((t) => t.cell.replace(/,/g, "")).join(", ")}).`);
  return { values: rc.values, note: notes.join(" ") };
}

interface IoTable {
  names: string[];
  M: Mat;
  exact?: Rat[][];
  decComma: boolean;
}

function readIoMatrix(text: string, what: string): IoTable | { error: string } {
  let src = text.replace(/\r\n?/g, "\n");
  // A blank corner cell ("\tFarming\t…" or ",Farming,…") is the usual input–output layout: name it.
  const firstLine = src.split("\n").find((l) => l.trim() !== "") ?? "";
  if (/^[ \t]*[\t,;]/.test(firstLine)) src = src.replace(firstLine, () => "Sector" + firstLine.replace(/^[ ]*/, ""));
  const pr = parseRegData(src);
  if (!pr.ok) return { error: pr.reason };
  const { rows, names: hdr, named } = pr.data;
  const semicolon = !!pr.data.semicolon;
  // Sector codes as numbers ("11", "21") make the header look like data.
  // (n + 1 rows of n + 1 cells: a header plus n sectors; a header-less labelled table has n rows of n + 1.)
  if (!named && rows.length > 1 && rows.length === hdr.length && !Number.isFinite(readRegCell(rows[0][0] ?? "", semicolon).value)) {
    const codes = rows[0].slice(1).filter((c) => Number.isFinite(readRegCell(c, semicolon).value));
    if (codes.length) return { error: `The header row names sectors with numbers (${q(codes[0])}); give each sector a name that contains a letter (S${codes[0]}).` };
  }
  const nh = numberShapedHeader(hdr, named);
  if (nh) return { error: nh };
  const labelled = rows.length > 0 && !Number.isFinite(readRegCell(rows[0][0] ?? "", semicolon).value) && !isMissingCell(rows[0][0] ?? "");
  const off = labelled ? 1 : 0;
  const n = rows.length;
  if (n > IO_MAX_N) return { error: `The table has ${n} sectors; at most ${IO_MAX_N} are accepted.` };
  const width = hdr.length - off;
  if (width !== n) return { error: `${what} must be square: ${n} row${n === 1 ? "" : "s"} of sectors but ${width} column${width === 1 ? "" : "s"} of numbers.` };
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const rowName = labelled ? (rows[i][0] ?? "").trim() : "";
    const colName = named ? hdr[i + off] : "";
    if (labelled && named && rowName.toLowerCase() !== colName.toLowerCase()) {
      return { error: `Row ${i + 1} is ${q(rowName)} but column ${i + 1} is ${q(colName)}: rows and columns must list the same sectors in the same order.` };
    }
    names.push(rowName || colName || `Sector ${i + 1}`);
  }
  const M: Mat = [];
  const ex: Rat[][] = [];
  let exactOk = true;
  let decComma = false;
  for (let i = 0; i < n; i++) {
    const r: number[] = [];
    const er: Rat[] = [];
    for (let j = 0; j < n; j++) {
      const cell = (rows[i][j + off] ?? "").trim();
      if (isMissingCell(cell)) return { error: `${what}: the cell for ${q(names[i])} → ${q(names[j])} is empty or missing; every cell needs a number (0 for none).` };
      const v = readRegCell(cell, semicolon);
      if (!Number.isFinite(v.value)) return { error: `${what}: ${q(cell)} (row ${q(names[i])}, column ${q(names[j])}) is not a finite number.` };
      if (v.value < 0) return { error: `${what} has a negative entry, ${q(cell)} at row ${q(names[i])}, column ${q(names[j])}; input–output coefficients and flows must be non-negative.` };
      if (v.decimalComma) decComma = true;
      r.push(v.value);
      const e = exactOk ? ratOf(v.value) : undefined;
      if (e) er.push(e);
      else exactOk = false;
    }
    M.push(r);
    ex.push(er);
  }
  // Every cell is a number; now regData's whole-table rules over them (a decimal comma beside "1,500" or "1.250" is
  // refused, as selectColumns refuses it in a regression table).
  if (n > 0) {
    const numSet: RegDataset = { names: names.slice(), rows: rows.map((r) => r.slice(off, off + n)), named: true, semicolon };
    const sel = selectColumns(numSet, { dep: "", preds: n > 1 ? ["."] : [], text: "" });
    if (!sel.ok) return { error: `${what}: ${sel.reason}` };
  }
  return { names, M, exact: exactOk ? ex : undefined, decComma };
}

const f4io = (v: number): string => fmtFixed(v, 4);

/**
 * "ρ(A) = 0.6123 < 1", with enough decimals that the printed value is visibly below 1 ("1.0000 < 1" was printed for
 * ρ = 0.99996); when even 6 decimals round to 1, the bracket is stated instead ("0.999999 < ρ(A) < 1").
 */
function rhoPhrase(rho: { lo: number; hi: number; converged: boolean }): string {
  if (!(rho.converged && rho.hi < 1)) return "ρ(A) < 1";
  const mid = (rho.lo + rho.hi) / 2;
  for (let d = 4; d <= 6; d++) {
    const s = fmtFixed(mid, d);
    if (Number(s) < 1) return `ρ(A) = ${s} < 1`;
  }
  return "0.999999 < ρ(A) < 1";
}

/** A value to 2 decimals, or to `sig` significant digits when 2 decimals would show digits the computation lost. */
function sigLimited(v: number, sig: number): string {
  if (v === 0) return fmtFixed(0, 2);
  const intDigits = Math.floor(Math.log10(Math.abs(v))) + 1;
  if (intDigits + 2 <= sig) return fmtFixed(v, 2);
  if (intDigits <= sig) return fmtFixed(v, Math.max(0, sig - intDigits));
  const p = Math.pow(10, intDigits - sig);
  return fmtFixed(Math.round(v / p) * p, 0);
}

export function ioLeontiefCalc(read: Read): StatOutput {
  const get = getter(read);
  const deadline = Date.now() + IO_WALL_MS;
  const mode = get("mode") || "A";
  if (mode !== "A" && mode !== "Z") return refuse(`Unknown table type ${q(mode)}.`);
  const text = get("matrix");
  if (!text.trim()) return refuse("Paste the n × n table: a header row of sector names, then one row per sector.");
  const tab = readIoMatrix(text, mode === "A" ? "A" : "Z");
  if ("error" in tab) return refuse(tab.error);
  const n = tab.names.length;
  if (n === 0) return refuse("The table has no sectors.");
  const notes: string[] = [];
  const listNotes: string[] = [];
  let A: Mat;
  let Aex: Rat[][] | undefined;
  let x: number[] | undefined;
  let xEx: Rat[] | undefined;
  if (mode === "Z") {
    const xr = readListField(get("xout"), "Total output x", n);
    if (xr === null) return refuse("A transactions table needs total output x, one value per sector (A = Z·diag(x)⁻¹).");
    if ("error" in xr) return refuse(xr.error);
    if (xr.note) listNotes.push(xr.note);
    for (let j = 0; j < n; j++) if (!(xr.values[j] > 0)) return refuse(`Total output of ${q(tab.names[j])} is ${xr.values[j] === 0 ? "zero" : "negative"}; A = Z·diag(x)⁻¹ divides by it, so every output must be positive.`);
    x = xr.values;
    A = tab.M.map((r) => r.map((v, j) => v / x![j]));
    const xe = x.map((v) => ratOf(v));
    if (tab.exact && xe.every((v) => v)) {
      xEx = xe as Rat[];
      Aex = tab.exact.map((r) => r.map((v, j) => ratDiv(v, xEx![j])));
    }
  } else {
    if (get("xout").trim()) notes.push("Total output x was ignored: it is read only with a transactions table.");
    A = tab.M;
    Aex = tab.exact;
  }
  const inv = leontiefInverse(A, Aex, "A", deadline);
  if (!inv.ok) return refuse(inv.reason);
  const L = inv.L;

  // Final demand and output.
  let f: number[] | undefined;
  let fEx: Rat[] | undefined;
  let fImplied = false;
  const fr = readListField(get("fd"), "Final demand f", n);
  if (fr && "error" in fr) return refuse(fr.error);
  if (fr) {
    f = fr.values;
    if (fr.note) listNotes.push(fr.note);
    const fe = f.map((v) => ratOf(v));
    if (fe.every((v) => v)) fEx = fe as Rat[];
  } else if (mode === "Z") {
    f = x!.map((xi, i) => xi - tab.M[i].reduce((s, v) => s + v, 0));
    fImplied = true;
    if (xEx && tab.exact) fEx = xEx.map((xi, i) => ratSub(xi, tab.exact![i].reduce((s: Rat, v) => ratAdd(s, v), RAT_ZERO)));
  }
  let out: number[] | undefined;
  if (f) {
    if (inv.exact && inv.Lexact && fEx) out = ratMatVec(inv.Lexact, fEx).map((v) => ratToNumber(v));
    else out = matVec(L, f);
  }
  const er = readListField(get("emp"), "Employment per unit of output", n);
  if (er && "error" in er) return refuse(er.error);
  let e: number[] | undefined;
  if (er) {
    e = er.values;
    if (er.note) listNotes.push(er.note);
    if (e.some((v) => v < 0)) return refuse("Employment per unit of output cannot be negative.");
  }

  const outMult = colSums(L);
  const bl = rasmussen(outMult);
  let flName: string;
  let fl: number[];
  if (mode === "Z") {
    // Ghosh: B = diag(x)⁻¹Z, G = (I − B)⁻¹, forward linkage = row sums of G (Rasmussen-normalised).
    const B = tab.M.map((r, i) => r.map((v) => v / x![i]));
    const Bex = tab.exact && xEx ? tab.exact.map((r, i) => r.map((v) => ratDiv(v, xEx![i]))) : undefined;
    const g = leontiefInverse(B, Bex, "B", deadline);
    if (!g.ok) return refuse(g.reason);
    fl = rasmussen(rowSums(g.L));
    flName = "Forward linkage (Ghosh, normalised row sums of (I − B)⁻¹)";
  } else {
    fl = rasmussen(rowSums(L));
    flName = "Forward linkage (Rasmussen, normalised row sums of L)";
  }
  const empEffect = e ? L[0].map((_, j) => L.reduce((s, row, i) => s + e![i] * row[j], 0)) : undefined;

  const rho = spectralRadiusBracket(A, deadline);
  const lines: string[] = [];
  lines.push(`Input–output (Leontief) model, ${n} sector${n === 1 ? "" : "s"}${mode === "Z" ? ", A = Z·diag(x)⁻¹ from the transactions table" : ""}`);
  lines.push(`A is productive: ${rhoPhrase(rho)}, and (I − A)⁻¹ is non-negative${inv.exact ? " (checked in exact fractions)" : ""}.`);
  // On the floating-point path κ₁(I − A) eats digits: the output is printed to the significant digits it leaves.
  const lost = inv.exact ? 0 : Math.max(0, Math.ceil(Math.log10(Math.max(inv.cond ?? 1, 1))));
  // The same count the κ sentence below prints: about `lost` of the 16 significant digits may be lost.
  const keepSig = Math.max(2, 16 - lost);
  const outText = (v: number): string => sigLimited(v, keepSig);
  if (out) {
    const top = out.map((v, i) => `${tab.names[i]} ${outText(v)}`).slice(0, 8).join(", ");
    lines.push(`Output x = (I − A)⁻¹f: ${top}${n > 8 ? ", …" : ""}`);
    if (out.some((v) => outText(v) !== fmtFixed(v, 2))) {
      notes.push(`The condition number leaves about ${keepSig} trustworthy significant digits, so the output is rounded to ${keepSig} significant digits rather than printed to 2 decimals.`);
    }
  }
  const keys = tab.names.filter((_, i) => bl[i] > 1 && fl[i] > 1);
  lines.push(keys.length ? `Key sector${keys.length === 1 ? "" : "s"} (both linkages above 1): ${keys.join(", ")}` : "No key sector (no sector has both linkages above 1).");
  lines.push("");
  lines.push(
    "Conventions: Aᵢⱼ is the input from sector i per unit of sector j's output; L = (I − A)⁻¹, x = Lf (Miller & Blair 2009, Input–Output Analysis, 2nd ed., ch. 2). " +
      "Output multiplier of j = Σᵢ Lᵢⱼ (simple, type I). Backward linkage = n·(column sum of L)/(sum of all of L), Rasmussen's normalised index; " +
      (mode === "Z"
        ? "forward linkage = the same normalisation of the row sums of the Ghosh inverse (I − B)⁻¹, B = diag(x)⁻¹Z (allocation coefficients). "
        : "forward linkage = the same normalisation of the row sums of L (Rasmussen); Ghosh forward linkages need a transactions table with total output. ") +
      "A key sector has both linkages above 1.",
  );
  lines.push(
    "Productivity: A ≥ 0 is productive exactly when its spectral radius is below 1, equivalently (Hawkins–Simon) I − A has positive leading principal minors, equivalently (I − A)⁻¹ exists and is non-negative; that last test is the one applied. " +
      "Column sums of 1 or more do not by themselves make A unproductive.",
  );
  if (e) {
    lines.push(
      "Employment: eᵢ = jobs per unit of output of i (your units). Employment effect of j = Σᵢ eᵢLᵢⱼ, the jobs created in all sectors per unit of final demand for j; type I employment multiplier = that effect / eⱼ.",
    );
  }
  if (inv.exact) lines.push("Computed in exact fractions from the typed decimals (n ≤ 8); shown to 4 decimals.");
  else {
    const c = inv.cond ?? 1;
    lines.push(
      `Computed in floating point (${n > IO_EXACT_MAX ? `n = ${n} is above the exact limit of ${IO_EXACT_MAX}` : inv.exactTimedOut ? `the exact fractions are too long: an entry of A has more than ${IO_EXACT_DIGITS} digits as a fraction, or the exact inverse did not finish within ${IO_WALL_MS / 2000} s` : "an input could not be held exactly"}); condition number κ₁(I − A) = ${fmtFixed(c, c < 1000 ? 2 : 0)}, so about ${Math.max(0, Math.ceil(Math.log10(Math.max(c, 1))))} of the 16 significant digits may be lost.`,
    );
  }
  if (fImplied) lines.push("Final demand was not typed, so f = x − Z·1 (each sector's output less its sales to other sectors); then (I − A)⁻¹f reproduces x.");
  if (out && out.some((v) => v < 0)) notes.push("Some output is negative: the final demand typed has negative entries.");
  if (!(rho.converged && rho.hi < 1)) notes.push(`The spectral radius estimate did not settle (bracket ${fmtFixed(rho.lo, 4)} to ${fmtFixed(Math.min(rho.hi, 1e6), 4)}); productivity was decided by the sign test on the inverse.`);
  lines.push(...notes, ...decimalCommaNote(tab.decComma), ...listNotes);

  const head = ["Sector", ...tab.names];
  const Lrows: string[][] = [head, ...L.map((r, i) => [tab.names[i], ...r.map(f4io)])];
  const tables: StatTable[] = [{ label: "Leontief inverse (I − A)⁻¹", rows: Lrows, align: ["left", ...tab.names.map((): Align => "right")] }];
  if (inv.exact && inv.Lexact) {
    const fracs = inv.Lexact.map((r) => r.map((v) => (v.d === 1n ? String(v.n) : shortFraction(v))));
    if (fracs.every((r) => r.every((c) => c !== undefined))) {
      tables.push({ label: "Leontief inverse, exact fractions", rows: [head, ...fracs.map((r, i) => [tab.names[i], ...(r as string[])])], align: ["left", ...tab.names.map((): Align => "right")] });
    }
  }
  if (f && out) {
    const oh = ["Sector", fImplied ? "Final demand f = x − Z·1" : "Final demand f", "Output x = Lf"];
    tables.push({ label: "Output for the final demand", rows: [oh, ...tab.names.map((nm, i) => [nm, fmtFixed(f![i], 2), outText(out![i])])], align: ["left", "right", "right"] });
  }
  // Short headers (long ones broke mid-word in a Word table: "Employmen/t effect"); defined in the table note.
  const mh = ["Sector", "Output mult.", "Backward", "Forward", "Key sector"];
  if (e) mh.splice(2, 0, "Empl. effect", "Type I mult.");
  const mrows: string[][] = [mh];
  for (let j = 0; j < n; j++) {
    const type = bl[j] > 1 && fl[j] > 1 ? "Yes" : bl[j] > 1 ? "No: backward" : fl[j] > 1 ? "No: forward" : "No: weak";
    const row = [tab.names[j], f4io(outMult[j]), f4io(bl[j]), f4io(fl[j]), type];
    if (e && empEffect) row.splice(2, 0, f4io(empEffect[j]), e[j] > 0 ? f4io(empEffect[j] / e[j]) : "not defined (eⱼ = 0)");
    mrows.push(row);
  }
  const multNote =
    "Output mult. = output multiplier of sector j, Σᵢ Lᵢⱼ (simple, type I). " +
    (e ? "Empl. effect = employment effect, Σᵢ eᵢLᵢⱼ (jobs in all sectors per unit of final demand for j); Type I mult. = type I employment multiplier, Empl. effect / eⱼ. " : "") +
    "Backward = backward linkage (Rasmussen, normalised column sums of L). " +
    `Forward = ${flName.charAt(0).toLowerCase()}${flName.slice(1)}. ` +
    "Key sector: Yes when both linkages are above 1; No: backward = only the backward linkage above 1; No: forward = only the forward linkage above 1; No: weak = neither.";
  tables.push({ label: "Multipliers and linkages", rows: mrows, align: ["left", ...mh.slice(1, -1).map((): Align => "right"), "left"], note: multNote });

  // Figure: backward vs forward linkages with the key-sector quadrant lines at 1.
  return { text: lines.join("\n"), reading: ioReading(tab.names, outMult, keys), tables, svg: linkageSvg(tab.names, bl, fl, mode === "Z" ? "Ghosh" : "Rasmussen") };
}

/**
 * io-leontief's reading: the sector with the largest output multiplier (ties named together, compared in the
 * table's 4 decimals), and the key sectors, under the model's fixed input shares.
 */
export function ioReading(names: string[], outMult: number[], keys: string[]): string {
  const best = outMult.reduce((m, v) => (v > m ? v : m), -Infinity);
  const top = names.filter((_, j) => f4io(outMult[j]) === f4io(best));
  const who = top.length === 1 ? top[0] : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]} (tied)`;
  const first =
    names.length === 1
      ? `Under the model's fixed input shares, each extra unit of final demand for ${names[0]} calls for ${f4io(best)} units of its output in all.`
      : `Under the model's fixed input shares, each extra unit of final demand for ${who} raises output across ${names.length === 2 ? "both" : `all ${names.length}`} sectors by ${f4io(best)} units, the largest output multiplier.`;
  const second =
    names.length === 1
      ? ""
      : keys.length
        ? `${keys.length === 1 ? `${keys[0]} is a key sector,` : `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]} are key sectors, each`} strongly linked both to the sectors that supply it and to those that buy from it.`
        : "No sector is a key sector, strongly linked both to its suppliers and to its buyers.";
  return joinTwo(first, second).trim();
}

function linkageSvg(names: string[], bl: number[], fl: number[], flKind: string): string {
  const ML = 52;
  const MR = 14;
  const MT = 26;
  const MB = 62;
  // At the figure context's width under a figure-style re-render (lib/figContext.ts); 400 × 320 otherwise.
  const cv = ctxCanvas(400, 320);
  const W = cv.w;
  const H = Math.max(cv.h, Math.round(MT + MB + 0.6 * (W - ML - MR)));
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  let lo = 1;
  let hi = 1;
  for (const v of [...bl, ...fl]) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = Math.max(0.05, (hi - lo) * 0.12);
  // Loose labelling: the frame runs from the first tick to the last, so every tick is a round number.
  const ax = linearAxis(Math.max(0, lo - pad), hi + pad, { loose: true });
  lo = ax.lo;
  hi = ax.hi;
  const X = (v: number): number => ML + ((v - lo) / (hi - lo)) * pw;
  const Y = (v: number): number => MT + ph - ((v - lo) / (hi - lo)) * ph;
  const fx = (v: number): string => v.toFixed(1);
  const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const font = "Segoe UI, Arial";
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text data-figure-title="1" x="${W / 2}" y="17" text-anchor="middle" font-family="${font}" font-size="12" fill="#111111">Backward and forward linkages</text>`,
  ];
  for (let k = 0; k < ax.values.length; k++) {
    const v = ax.values[k];
    const t = ax.labels[k].replace(/^-/, "−");
    parts.push(`<line x1="${fx(X(v))}" y1="${MT}" x2="${fx(X(v))}" y2="${MT + ph}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${fx(X(v))}" y="${MT + ph + 14}" text-anchor="middle" font-family="${font}" font-size="10" fill="#6b7280">${t}</text>`);
    parts.push(`<line x1="${ML}" y1="${fx(Y(v))}" x2="${ML + pw}" y2="${fx(Y(v))}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${ML - 6}" y="${fx(Y(v) + 3.5)}" text-anchor="end" font-family="${font}" font-size="10" fill="#6b7280">${t}</text>`);
  }
  parts.push(`<rect x="${ML}" y="${MT}" width="${pw}" height="${ph}" fill="none" stroke="#888888"/>`);
  parts.push(`<line x1="${fx(X(1))}" y1="${MT}" x2="${fx(X(1))}" y2="${MT + ph}" stroke="#111111" stroke-dasharray="5 3"/>`);
  parts.push(`<line x1="${ML}" y1="${fx(Y(1))}" x2="${ML + pw}" y2="${fx(Y(1))}" stroke="#111111" stroke-dasharray="5 3"/>`);
  const shown = Math.min(names.length, 60);
  for (let i = 0; i < shown; i++) {
    const cx = X(bl[i]);
    const cy = Y(fl[i]);
    parts.push(`<circle cx="${fx(cx)}" cy="${fx(cy)}" r="3.5" fill="#1d4ed8"/>`);
    if (names.length <= 12) {
      const right = cx < ML + pw - 70;
      parts.push(`<text x="${fx(right ? cx + 6 : cx - 6)}" y="${fx(Math.max(MT + 10, Math.min(MT + ph - 4, cy - 5)))}" text-anchor="${right ? "start" : "end"}" font-family="${font}" font-size="9" fill="#111111">${esc(names[i].slice(0, 14))}</text>`);
    }
  }
  parts.push(`<text x="${ML + pw / 2}" y="${MT + ph + 30}" text-anchor="middle" font-family="${font}" font-size="10" fill="#111111">Backward linkage (Rasmussen index, 1 = average)</text>`);
  parts.push(`<text x="13" y="${MT + ph / 2}" text-anchor="middle" font-family="${font}" font-size="10" fill="#111111" transform="rotate(-90 13 ${MT + ph / 2})">${esc(`Forward linkage (${flKind}, 1 = average)`)}</text>`);
  const ly = MT + ph + 48;
  parts.push(`<circle cx="${ML + 8}" cy="${ly}" r="3.5" fill="#1d4ed8"/>`);
  parts.push(`<text x="${ML + 16}" y="${ly + 3.5}" font-family="${font}" font-size="10" fill="#111111">Sector</text>`);
  parts.push(`<line x1="${ML + 70}" y1="${ly}" x2="${ML + 92}" y2="${ly}" stroke="#111111" stroke-dasharray="5 3"/>`);
  parts.push(`<text x="${ML + 97}" y="${ly + 3.5}" font-family="${font}" font-size="10" fill="#111111">Index = 1 (key sectors: upper right)</text>`);
  parts.push("</svg>");
  return parts.join("");
}

// =================================================================================================================
// fin-currency (Finance registry)

export interface FinOutput {
  text: string;
  ok?: boolean;
  tables?: { label: string; rows: string[][]; align?: Align[]; note?: string }[];
}
const finRefuse = (text: string): FinOutput => ({ text, ok: false });

export const FIN_CURRENCY_FIELDS: E5Field[] = [
  { key: "base", label: "Base currency (ISO 4217 code)", kind: "text" },
  { key: "rates", label: "Rates, one per line: code, then how many units of it 1 base unit buys (EUR 0.92 means 1 USD = 0.92 EUR)", kind: "block" },
  { key: "asof", label: "Rates as of (printed as typed; blank = no date given)", kind: "text" },
  { key: "amounts", label: "Amounts, one per line: amount then code (1250.00 EUR)", kind: "block" },
  { key: "target", label: "Convert to (ISO 4217 code)", kind: "text" },
];

export const FIN_CURRENCY_DEFAULTS: Record<string, string> = {
  base: "USD",
  rates: ["EUR 0.9200", "GBP 0.7850", "JPY 151.25", "KWD 0.3071", "CLP 945.50"].join("\n"),
  asof: "",
  amounts: ["1250.00 EUR", "980.50 GBP", "150000 JPY", "420.125 KWD"].join("\n"),
  target: "EUR",
};

export const FX_MAX_RATES = 60;
export const FX_MAX_AMOUNTS = 500;
export const FX_MATRIX_MAX = 12;
export const FX_MAX_AMOUNT = 1e15;
/** Rates are accepted from 10⁻⁹ to 10⁹ units per base unit; a converted amount must stay below 10¹⁸. */
export const FX_MIN_RATE = 1e-9;
export const FX_MAX_RATE = 1e9;
export const FX_MAX_CONVERTED = 1e18;

const listDate = `the list dated ${ISO4217_DATE}`;

/** An ISO code check: the upper-cased code, or a refusal sentence. */
function isoCode(raw: string, what: string): string | { error: string } {
  const t = raw.trim();
  if (t === "") return { error: `${what}: type an ISO 4217 code (three letters, such as USD).` };
  const c = t.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return { error: `${what}: ${q(t)} is not a three-letter ISO 4217 code.` };
  if (!ISO4217.has(c)) return { error: `${what}: ${c} is not in ISO 4217 (${ISO4217_SOURCE}, ${listDate}), so it is refused. Only current ISO 4217 codes are accepted.` };
  if (NOT_A_CURRENCY[c]) return { error: `${what}: ${c} is ${NOT_A_CURRENCY[c]}; it cannot be converted.` };
  return c;
}

const minorOf = (c: string): number | null => ISO4217.get(c)!.minor;
/** Decimal places shown for an N.A. code (no minor unit in ISO 4217). */
export const FX_NA_DECIMALS = 6;

function moneyText(r: Rat, code: string): string {
  const m = minorOf(code);
  return unitsText(roundUnits(r, m ?? FX_NA_DECIMALS), m ?? FX_NA_DECIMALS);
}

export function finCurrencyCalc(read: Read): FinOutput {
  const get = getter(read);
  const base = isoCode(get("base"), "Base currency");
  if (typeof base !== "string") return finRefuse(base.error);
  const target = isoCode(get("target"), "Target currency");
  if (typeof target !== "string") return finRefuse(target.error);
  const rateLines = get("rates").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (!rateLines.length) return finRefuse(`Type the rates, one per line: a code and how many units of it 1 ${base} buys (EUR 0.92).`);
  if (rateLines.length > FX_MAX_RATES) return finRefuse(`At most ${FX_MAX_RATES} rates are accepted; ${rateLines.length} were typed.`);
  // 1. The lines: codes checked, number texts kept as typed.
  const rateItems: { code: string; text: string; line: number }[] = [];
  for (let i = 0; i < rateLines.length; i++) {
    const line = rateLines[i];
    const m = /^([A-Za-z]{3})[\s:=\t]+(.+)$/.exec(line);
    if (!m) {
      if (i === 0 && !/\d/.test(line)) continue; // a header line ("Currency  Rate")
      return finRefuse(`Rate line ${i + 1}, ${q(line)}: write the code then the rate, such as “EUR 0.92” (1 ${base} = 0.92 EUR).`);
    }
    const c = isoCode(m[1], `Rate line ${i + 1}`);
    if (typeof c !== "string") return finRefuse(c.error);
    if (c !== base && rateItems.some((t) => t.code === c)) return finRefuse(`${c} has two rate lines; keep one.`);
    rateItems.push({ code: c, text: m[2].trim(), line: i + 1 });
  }
  const amountLines = get("amounts").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (amountLines.length > FX_MAX_AMOUNTS) return finRefuse(`At most ${FX_MAX_AMOUNTS} amounts are accepted; ${amountLines.length} were typed.`);
  const amountItems: { code: string; text: string; line: string; at: number }[] = [];
  for (let i = 0; i < amountLines.length; i++) {
    const line = amountLines[i];
    let m = /^(.+?)\s+([A-Za-z]{3})$/.exec(line);
    let numText: string;
    let codeText: string;
    if (m) {
      numText = m[1];
      codeText = m[2];
    } else {
      m = /^([A-Za-z]{3})\s+(.+)$/.exec(line);
      if (!m) return finRefuse(`Amount line ${i + 1}, ${q(line)}: write the amount then the code, such as “1250.00 EUR”.`);
      codeText = m[1];
      numText = m[2];
    }
    const c = isoCode(codeText, `Amount line ${i + 1}`);
    if (typeof c !== "string") return finRefuse(c.error);
    amountItems.push({ code: c, text: numText.trim(), line, at: i + 1 });
  }

  // 2. Every rate and amount under ONE comma convention (regData's rules across the whole input): "CHF 1,105" beside
  //    "EUR 0,92" is 1.105 or 1105 and is refused naming both; a lone "JPY 151,250" is the thousands reading, said.
  const items: CellItem[] = [
    ...rateItems.map((r) => ({ cell: r.text, where: `Rate line ${r.line} (${r.code})` })),
    ...amountItems.map((a) => ({ cell: a.text, where: `Amount line ${a.at} (${q(a.line)})` })),
  ];
  const rc = readConsistent(items, "the rates and amounts");
  if (!rc.ok) return finRefuse(rc.reason);
  const decComma = rc.decimalCommas > 0;
  // 3. Exact fractions straight from the typed text (never through a double: "500000000000000.13" stays .13).
  const exactAt = (k: number): Rat | { error: string } => {
    const ex = exactFromCell(items[k].cell, rc.decimalComma[k]);
    // The text and regData's reading of it must agree; anything else (a fraction, ×10ⁿ) is asked for as a decimal.
    if (!ex || Math.abs(ratToNumber(ex) - rc.values[k]) > 1e-9 * Math.max(1, Math.abs(rc.values[k]))) {
      return { error: `${items[k].where}: type ${q(items[k].cell.trim())} as a plain decimal number (such as 1250.50) so that it can be read exactly.` };
    }
    return ex;
  };
  const rates = new Map<string, Rat>([[base, { n: 1n, d: 1n }]]);
  const typed: { code: string; text: string }[] = [];
  for (let k = 0; k < rateItems.length; k++) {
    const { code: c, text, line } = rateItems[k];
    if (!(rc.values[k] > 0)) return finRefuse(`Rate line ${line}: the rate for ${c} must be positive; ${q(text)} was typed.`);
    const ex = exactAt(k);
    if ("error" in ex) return finRefuse(ex.error);
    if (ratSign(ex) <= 0) return finRefuse(`Rate line ${line}: the rate for ${c} must be positive; ${q(text)} was typed.`);
    if (cmpPow10(ex, -9) < 0 || cmpPow10(ex, 9) > 0) return finRefuse(`Rate line ${line}: the rate for ${c}, ${q(text)}, is outside the range accepted (10⁻⁹ to 10⁹ units per 1 ${base}).`);
    if (c === base) {
      if (!(ex.n === 1n && ex.d === 1n)) return finRefuse(`Rate line ${line}: ${c} is the base currency, so its rate is 1 by definition; ${q(text)} was typed.`);
      continue;
    }
    rates.set(c, ex);
    typed.push({ code: c, text });
  }
  if (!rates.has(target)) return finRefuse(`There is no rate for the target currency ${target}. Add a line “${target} rate” (1 ${base} = rate ${target}).`);
  const amounts: { amount: Rat; code: string; line: string }[] = [];
  for (let a = 0; a < amountItems.length; a++) {
    const k = rateItems.length + a;
    const { code: c, text, at } = amountItems[a];
    if (!rates.has(c)) return finRefuse(`Amount line ${at}: there is no rate for ${c}. Add a line “${c} rate” (1 ${base} = rate ${c}).`);
    const ex = exactAt(k);
    if ("error" in ex) return finRefuse(ex.error);
    if (cmpPow10(ex, 15) > 0) return finRefuse(`Amount line ${at}: ${q(text)} is beyond the largest amount accepted (10¹⁵).`);
    // "1.000 JPY", "1.250 EUR": a point followed by three digits, more decimals than the currency's minor unit and
    // nothing but zeros past it: 1,000 JPY with a point grouping thousands, or 1 JPY padded with zeros. Asked, not
    // guessed. ("10.003 USD", a non-zero digit past the cent, is a deliberate sub-minor amount and is read as typed.)
    const fm = minorOf(c);
    if (!rc.decimalComma[k] && fm !== null && isOneDotGroup(text)) {
      const d = mantissaOf(text);
      const frac = d.split(".")[1];
      if (frac.length > fm && /^0*$/.test(frac.slice(fm))) {
        const whole = d.replace(".", "");
        const dec = decimalReading(d);
        return finRefuse(
          `Amount line ${at}: ${q(`${text} ${c}`)} could be ${groupThousands(whole)} ${c} (a point grouping thousands) or ${dec} ${c} (a decimal point; ${frac.length} decimals is more than ${c}'s ISO 4217 minor unit of ${fm}). ` +
            `Type ${q(`${whole} ${c}`)} or ${q(`${dec} ${c}`)}.`,
        );
      }
    }
    amounts.push({ amount: ex, code: c, line: amountItems[a].line });
  }
  const readNotes: string[] = [];
  if (rc.thousands.length) {
    readNotes.push(
      `${rc.thousands.map((t) => `${q(t.cell.trim())} (${t.where.charAt(0).toLowerCase()}${t.where.slice(1)})`).join(", ")} ${rc.thousands.length === 1 ? "was" : "were"} read with a thousands comma ` +
        `(${rc.thousands.map((t) => mantissaOf(t.cell).replace(/,/g, "")).join(", ")}), as the table reader reads a comma followed by three digits; no decimal comma appears in the rates or amounts.`,
    );
  }

  const asof = get("asof").trim();
  const lines: string[] = [];
  lines.push(`Currency conversion to ${target} at your rates (${asof ? `as of ${asof}` : "rates as typed, no date given"})`);
  const convRows: string[][] = [["Amount", "Cross rate used", `Converted (${target})`]];
  const notes: string[] = [];
  for (const a of amounts) {
    const from = a.code;
    const rate = cross(rates.get(from)!, rates.get(target)!);
    const conv = convert(a.amount, rates.get(from)!, rates.get(target)!);
    // Exact comparison with 10¹⁸ (FX_MAX_CONVERTED), not through a double.
    if (cmpPow10(conv, 18) >= 0) return finRefuse(`${a.line} converts to 10¹⁸ ${target} or more, beyond the largest converted amount accepted.`);
    const fm = minorOf(from);
    const amtText = currencyAmount(exactText(a.amount, fm ?? 0), from);
    const crossText = `1 ${from} = ${sigText(rate)} ${target}`;
    const convText = currencyAmount(moneyText(conv, target), target);
    lines.push(`${amtText} = ${convText} (${crossText})`);
    convRows.push([amtText, crossText, convText]);
    const td = terminatingDecimals(a.amount);
    if (fm !== null && td !== null && td > fm) notes.push(`${amtText} has more decimals than ${from}'s ISO 4217 minor unit (${fm}); it was used as typed.`);
  }
  if (!amounts.length) lines.push("No amounts were typed: the cross rates are shown.");
  lines.push("");
  lines.push(
    `Conventions: each rate line reads “1 ${base} = rate CODE”. The cross rate from A to B is rate(B)/rate(A), the exact quotient of the typed rates; a conversion multiplies by it exactly and rounds once, ` +
      "half away from zero, to the target currency's ISO 4217 minor unit (the damages calculators' cent rounding, generalised from 2 decimals to the currency's own minor unit). Cross rates are shown to 6 significant digits; that display rounding is not used in the conversions. " +
      "Rates are accepted from 10⁻⁹ to 10⁹ units per base unit, amounts up to 10¹⁵ and converted amounts below 10¹⁸.",
  );
  const tm = minorOf(target);
  lines.push(
    `Codes are checked against ${ISO4217_SOURCE}, ${listDate} (minor units from the same list: ${target} has ${tm === null ? "none (N.A.)" : tm}). No live rates are used: the result is only as current as the rates typed.`,
  );
  if (tm === null) notes.push(`ISO 4217 gives no minor unit for ${target} (N.A.), so ${target} amounts are shown to ${FX_NA_DECIMALS} decimal places, not rounded to a minor unit.`);
  for (const c of new Set(amounts.map((a) => a.code))) if (minorOf(c) === null) notes.push(`ISO 4217 gives no minor unit for ${c} (N.A.).`);
  lines.push(...notes, ...decimalCommaNote(decComma), ...readNotes);

  const rateRows: string[][] = [["Rate as read", "Currency (ISO 4217 name)", "Minor units"]];
  rateRows.push([`1 ${base} = 1 ${base} (base)`, ISO4217.get(base)!.name, String(minorOf(base) ?? "N.A.")]);
  for (const t of typed) rateRows.push([`1 ${base} = ${sigText(rates.get(t.code)!, 15)} ${t.code}`, ISO4217.get(t.code)!.name, String(minorOf(t.code) ?? "N.A.")]);

  const tables: NonNullable<FinOutput["tables"]> = [];
  if (amounts.length) tables.push({ label: `Conversions to ${target}`, rows: convRows, align: ["right", "left", "right"] });
  tables.push({ label: `Rates as read (${asof ? `as of ${asof}` : "no date given"})`, rows: rateRows, align: ["left", "left", "right"] });
  let codes = [...rates.keys()];
  let matrixNote = "";
  if (codes.length > FX_MATRIX_MAX) {
    const used = [base, target, ...amounts.map((a) => a.code)].filter((c, i, arr) => arr.indexOf(c) === i);
    if (used.length <= FX_MATRIX_MAX) {
      codes = used;
      matrixNote = ` The matrix shows the ${used.length} currencies in use (base, target and amounts); ${rates.size} were typed.`;
    } else codes = [];
  }
  if (codes.length) {
    const mRows: string[][] = [["1 unit of ↓ =", ...codes]];
    for (const a of codes) mRows.push([a, ...codes.map((b) => (a === b ? "1" : sigText(cross(rates.get(a)!, rates.get(b)!))))]);
    tables.push({ label: "Cross-rate matrix", rows: mRows, align: ["left", ...codes.map((): Align => "right")], note: `Row currency in units of the column currency, 6 significant digits.${matrixNote}` });
  } else {
    lines.push(`The cross-rate matrix is left out: more than ${FX_MATRIX_MAX} currencies are in use.`);
  }
  return { text: lines.join("\n"), tables, ok: true };
}
