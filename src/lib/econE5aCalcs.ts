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
import { parseRegData, readRegCell, isMissingCell } from "./regData";
import { fmtFixed, intText } from "./regTable";
import { readCalcList } from "./calcList";
import { groupedBarSvg } from "./statchart";
import { linearAxis } from "./axis";
import { ratAdd, ratSub, ratMul, ratDiv, ratSign, ratToNumber, RAT_ZERO, type Rat } from "./cas";
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
function numberShapedHeader(names: string[], named: boolean): string | undefined {
  if (!named) return undefined;
  const bad = names.find((nm) => /^[-−+]?(\d[\d.,]*|\.\d+)([eE][-+−]?\d+)?%?$/.test(nm.trim()));
  return bad === undefined ? undefined : `Row 1: ${q(bad)} is not a finite number.`;
}

function decimalCommaNote(any: boolean): string[] {
  return any ? ["Commas inside numbers were read as decimal commas (“0,5” is 0.5)."] : [];
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
      { value: "grouped", label: "Groups: income or mean | count or weight (the first two numeric columns)" },
    ],
  },
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
  correction: "none",
  eps: "",
};

/** Most rows accepted (measured: 200,000 rows run in well under a second; see the jest bound). */
export const INEQ_MAX_ROWS = 200000;
/** Largest |income| and weight accepted, so Σ wᵢxᵢ·W stays far inside the double range. */
export const INEQ_MAX_ABS = 1e15;

interface ColumnPick {
  cols: number[];
  label: number | null;
}

/** The first `want` numeric columns (a column whose first non-missing cell is not a number is a label column). */
function pickNumericColumns(rows: string[][], width: number, want: number): ColumnPick | { error: string } {
  const cols: number[] = [];
  let label: number | null = null;
  for (let j = 0; j < width && cols.length < want; j++) {
    const first = rows.find((r) => !isMissingCell(r[j] ?? ""));
    if (!first) continue;
    if (Number.isFinite(readRegCell(first[j], false).value)) cols.push(j);
    else if (label === null) label = j;
  }
  if (cols.length < want) return { error: want === 1 ? "The table has no column of numbers." : `A grouped table needs two columns of numbers (income or mean, then count or weight); found ${cols.length}.` };
  return { cols, label };
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
  // A bare column of numbers has no header, and parseRegData reads its first number as data: good. A one-column
  // paste headed by words with spaces ("Household income") would split the header into columns: read it whole.
  let src = text;
  let headerName: string | undefined;
  if (!grouped && !text.includes("\t")) {
    const ls = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (ls.length > 1 && /\s/.test(ls[0].trim()) && !/\d/.test(ls[0]) && ls.slice(1).every((l) => !/\s/.test(l.trim()))) {
      headerName = ls[0].trim();
      src = ["Income", ...ls.slice(1)].join("\n");
    }
  }
  const pr = parseRegData(src);
  if (!pr.ok) return refuse(pr.reason);
  const { rows } = pr.data;
  const names = headerName ? [headerName, ...pr.data.names.slice(1)] : pr.data.names;
  const nh = numberShapedHeader(names, pr.data.named);
  if (nh) return refuse(nh);
  const semicolon = !!pr.data.semicolon;
  if (rows.length > INEQ_MAX_ROWS) return refuse(`The table has ${intText(rows.length)} rows; at most ${intText(INEQ_MAX_ROWS)} are accepted.`);
  const pick = pickNumericColumns(rows, names.length, grouped ? 2 : 1);
  if ("error" in pick) return refuse(pick.error);
  const [xc, wc] = pick.cols;
  const xs: number[] = [];
  const ws: number[] = [];
  const exX: Rat[] = [];
  const exW: Rat[] = [];
  let exactOk = true;
  let dropped = 0;
  let zeroWeight = 0;
  let decComma = false;
  for (let i = 0; i < rows.length; i++) {
    const cx = rows[i][xc] ?? "";
    const cw = grouped ? rows[i][wc] ?? "" : "1";
    if (isMissingCell(cx) || isMissingCell(cw)) {
      dropped++;
      continue;
    }
    const rx = readRegCell(cx, semicolon);
    if (!Number.isFinite(rx.value)) return refuse(`Row ${i + 1}: ${q(cx)} is not a finite number (column ${q(names[xc])}).`);
    if (Math.abs(rx.value) > INEQ_MAX_ABS) return refuse(`Row ${i + 1}: ${q(cx)} is beyond the largest income accepted (10¹⁵ in absolute value).`);
    let wv = 1;
    if (grouped) {
      const rw = readRegCell(cw, semicolon);
      if (!Number.isFinite(rw.value)) return refuse(`Row ${i + 1}: ${q(cw)} is not a finite number (column ${q(names[wc])}).`);
      if (rw.value < 0) return refuse(`Row ${i + 1}: the count or weight ${q(cw)} is negative.`);
      if (rw.value > INEQ_MAX_ABS) return refuse(`Row ${i + 1}: the count or weight ${q(cw)} is beyond 10¹⁵.`);
      if (rw.decimalComma) decComma = true;
      wv = rw.value;
      if (wv === 0) {
        zeroWeight++;
        continue;
      }
    }
    if (rx.decimalComma) decComma = true;
    xs.push(rx.value);
    ws.push(wv);
    if (exactOk) {
      const a = exactOf(rx.value);
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
  return ineqOutput(r, { grouped, corr: corr === "nn1", dropped, zeroWeight, decComma, colName: names[xc], weightName: grouped ? names[wc] : "" });
}

const f4 = (v: number): string => fmtFixed(v, 4);
const money = (v: number): string => fmtFixed(v, 2);
const pct2 = (v: number): string => fmtFixed(v * 100, 2);

function ineqOutput(
  r: IneqResult,
  o: { grouped: boolean; corr: boolean; dropped: number; zeroWeight: number; decComma: boolean; colName: string; weightName: string },
): StatOutput {
  const lines: string[] = [];
  const notes: string[] = [];
  const who = o.grouped
    ? `${intText(r.n)} group${r.n === 1 ? "" : "s"} (total weight ${fmtFixed(r.W, Number.isInteger(r.W) ? 0 : 2)})`
    : `${intText(r.n)} income${r.n === 1 ? "" : "s"}`;
  lines.push(`Inequality of ${who}, column ${q(o.colName)}${o.grouped ? ` weighted by ${q(o.weightName)}` : ""}`);
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
  else notes.push("The Palma ratio is left out: the bottom 40% hold no positive share of income.");
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
      "Grouped data: every member of a group is given the group's income, so inequality inside groups is ignored and the Gini (and every other measure here) is a LOWER BOUND on the true value.",
    );
  }
  if (r.giniExact && fr) conv.push("The Gini was also computed in exact fractions from the typed decimals.");
  if (o.dropped) notes.push(`${o.dropped} row${o.dropped === 1 ? "" : "s"} with a missing cell ${o.dropped === 1 ? "was" : "were"} left out.`);
  if (o.zeroWeight) notes.push(`${o.zeroWeight} group${o.zeroWeight === 1 ? "" : "s"} with a zero count ${o.zeroWeight === 1 ? "was" : "were"} left out.`);
  if (r.n === 1) notes.push("With a single income or group every inequality measure is 0.");
  if (r.negatives) notes.push(`${r.negatives} income${r.negatives === 1 ? " is" : "s are"} negative.`);
  notes.push(...decimalCommaNote(o.decComma));
  lines.push(...conv, ...notes);

  const tables: StatTable[] = [
    { label: "Inequality measures", rows, align: ["left", "right", "left"] },
    { label: "Lorenz curve at deciles of population", rows: lzRows, align: ["right", "right"], note: "Linear between observations (between group points for grouped data)." },
  ];
  const svg = lorenzSvg(r.lorenz, giniText, o.grouped);
  return { text: lines.join("\n"), tables, svg };
}

function epsText(e: number): string {
  return String(e);
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
  const pr = parseRegData(text);
  if (!pr.ok) return refuse(pr.reason);
  const { rows, names } = pr.data;
  const semicolon = !!pr.data.semicolon;
  if (names.length < 2) return refuse("Each row needs the firm's name and its share (or sales): two columns.");
  const nh = numberShapedHeader(names, pr.data.named);
  if (nh) return refuse(nh);
  if (rows.length > HHI_MAX_FIRMS) return refuse(`At most ${intText(HHI_MAX_FIRMS)} firms are accepted; the table has ${intText(rows.length)}.`);
  const firms: { name: string; v: Rat }[] = [];
  const seen = new Map<string, number>();
  let pctSign = false;
  let decComma = false;
  for (let i = 0; i < rows.length; i++) {
    const nm = (rows[i][0] ?? "").trim();
    const cell = (rows[i][1] ?? "").trim();
    if (nm === "" && cell === "") continue;
    if (nm === "") return refuse(`Row ${i + 1} has no firm name.`);
    if (Number.isFinite(readRegCell(nm, semicolon).value)) return refuse(`Row ${i + 1}: the first column should name the firm; ${q(nm)} is a number.`);
    for (let j = 2; j < rows[i].length; j++) if ((rows[i][j] ?? "").trim() !== "") return refuse(`Row ${i + 1} has more than two cells (name, share). Separate the cells with tabs if a name contains spaces.`);
    if (isMissingCell(cell)) return refuse(`Row ${i + 1} (${q(nm)}) has no share.`);
    if (cell.includes("%")) pctSign = true;
    const rv = readRegCell(cell, semicolon);
    if (!Number.isFinite(rv.value)) return refuse(`Row ${i + 1} (${q(nm)}): ${q(cell)} is not a finite number.`);
    if (rv.value < 0) return refuse(`Row ${i + 1} (${q(nm)}): a share or sales figure cannot be negative (${q(cell)}).`);
    if (rv.decimalComma) decComma = true;
    const key = nm.toLowerCase();
    if (seen.has(key)) return refuse(`${q(nm)} is listed twice (rows ${seen.get(key)! + 1} and ${i + 1}).`);
    seen.set(key, i);
    const ex = ratOf(rv.value);
    if (!ex) return refuse(`Row ${i + 1} (${q(nm)}): ${q(cell)} cannot be held exactly.`);
    firms.push({ name: nm, v: ex });
  }
  if (!firms.length) return refuse("No firms were read.");
  if (pctSign && units !== "percent") return refuse("The numbers carry % signs, but the units say otherwise: choose “Shares in percent”.");

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
  lines.push(...notes, ...decimalCommaNote(decComma));

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
  const cats: string[] = [];
  const pre: number[] = [];
  const postV: number[] = [];
  for (const i of order) {
    cats.push(firms[i].name);
    pre.push(ratToNumber(shares[i]));
    postV.push(merger && mIdx.includes(i) ? 0 : ratToNumber(shares[i]));
  }
  if (merger) {
    cats.unshift("Merged");
    pre.unshift(0);
    postV.unshift(ratToNumber(mShare));
  }
  if (hasFringe) {
    cats.push("Other");
    pre.push(ratToNumber(fringe));
    postV.push(ratToNumber(fringe));
  }
  const svg = groupedBarSvg(
    cats,
    merger ? [{ label: "Pre-merger", values: pre }, { label: "Post-merger", values: postV }] : [{ label: "Share", values: pre }],
    { title: merger ? `Market shares before and after ${mergedName}`.slice(0, 60) : "Market shares", ylabel: "Market share (%)" },
  );
  return { text: lines.join("\n"), tables, svg };
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

function readListField(raw: string, label: string, n: number): { values: number[]; note: string } | { error: string } | null {
  if (!raw.trim()) return null;
  let r: { values: number[]; note: string };
  try {
    r = readCalcList(raw);
  } catch (e) {
    return { error: `${label}: ${(e as Error).message}` };
  }
  if (r.values.length !== n) return { error: `${label} has ${r.values.length} value${r.values.length === 1 ? "" : "s"}; the table has ${n} sectors.` };
  for (const v of r.values) if (!Number.isFinite(v)) return { error: `${label} holds a value that is not a finite number.` };
  return r;
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
  if (/^[ \t]*[\t,;]/.test(firstLine)) src = src.replace(firstLine, "Sector" + firstLine.replace(/^[ ]*/, ""));
  const pr = parseRegData(src);
  if (!pr.ok) return { error: pr.reason };
  const { rows, names: hdr, named } = pr.data;
  const semicolon = !!pr.data.semicolon;
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
  return { names, M, exact: exactOk ? ex : undefined, decComma };
}

const f4io = (v: number): string => fmtFixed(v, 4);

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
    // Ghosh: B = x̂⁻¹Z, G = (I − B)⁻¹, forward linkage = row sums of G (Rasmussen-normalised).
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
  const rhoText = rho.converged && rho.hi < 1 ? `ρ(A) = ${fmtFixed((rho.lo + rho.hi) / 2, 4)} < 1` : "ρ(A) < 1";
  lines.push(`A is productive: ${rhoText}, and (I − A)⁻¹ is non-negative${inv.exact ? " (checked in exact fractions)" : ""}.`);
  if (out) {
    const top = out.map((v, i) => `${tab.names[i]} ${fmtFixed(v, 2)}`).slice(0, 8).join(", ");
    lines.push(`Output x = (I − A)⁻¹f: ${top}${n > 8 ? ", …" : ""}`);
  }
  const keys = tab.names.filter((_, i) => bl[i] > 1 && fl[i] > 1);
  lines.push(keys.length ? `Key sector${keys.length === 1 ? "" : "s"} (both linkages above 1): ${keys.join(", ")}` : "No key sector (no sector has both linkages above 1).");
  lines.push("");
  lines.push(
    "Conventions: Aᵢⱼ is the input from sector i per unit of sector j's output; L = (I − A)⁻¹, x = Lf (Miller & Blair 2009, Input–Output Analysis, 2nd ed., ch. 2). " +
      "Output multiplier of j = Σᵢ Lᵢⱼ (simple, type I). Backward linkage = n·(column sum of L)/(sum of all of L), Rasmussen's normalised index; " +
      (mode === "Z"
        ? "forward linkage = the same normalisation of the row sums of the Ghosh inverse (I − B)⁻¹, B = x̂⁻¹Z (allocation coefficients). "
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
      `Computed in floating point (${n > IO_EXACT_MAX ? `n = ${n} is above the exact limit of ${IO_EXACT_MAX}` : "an input could not be held exactly"}); condition number κ₁(I − A) = ${fmtFixed(c, c < 1000 ? 2 : 0)}, so about ${Math.max(0, Math.ceil(Math.log10(Math.max(c, 1))))} of the 16 significant digits may be lost.`,
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
    tables.push({ label: "Output for the final demand", rows: [oh, ...tab.names.map((nm, i) => [nm, fmtFixed(f![i], 2), fmtFixed(out![i], 2)])], align: ["left", "right", "right"] });
  }
  const mh = ["Sector", "Output multiplier", "Backward linkage", flName.split(" (")[0] + (mode === "Z" ? " (Ghosh)" : " (Rasmussen)"), "Type"];
  if (e) mh.splice(2, 0, "Employment effect", "Type I employment multiplier");
  const mrows: string[][] = [mh];
  for (let j = 0; j < n; j++) {
    const type = bl[j] > 1 && fl[j] > 1 ? "Key sector" : bl[j] > 1 ? "Backward-oriented" : fl[j] > 1 ? "Forward-oriented" : "Weak linkages";
    const row = [tab.names[j], f4io(outMult[j]), f4io(bl[j]), f4io(fl[j]), type];
    if (e && empEffect) row.splice(2, 0, f4io(empEffect[j]), e[j] > 0 ? f4io(empEffect[j] / e[j]) : "not defined (eⱼ = 0)");
    mrows.push(row);
  }
  tables.push({ label: "Multipliers and linkages", rows: mrows, align: ["left", ...mh.slice(1, -1).map((): Align => "right"), "left"], note: `${flName}.` });

  // Figure: backward vs forward linkages with the key-sector quadrant lines at 1.
  return { text: lines.join("\n"), tables, svg: linkageSvg(tab.names, bl, fl, mode === "Z" ? "Ghosh" : "Rasmussen") };
}

function linkageSvg(names: string[], bl: number[], fl: number[], flKind: string): string {
  const W = 400;
  const H = 320;
  const ML = 52;
  const MR = 14;
  const MT = 26;
  const MB = 62;
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
  const rates = new Map<string, Rat>([[base, { n: 1n, d: 1n }]]);
  const typed: { code: string; text: string }[] = [];
  let decComma = false;
  for (let i = 0; i < rateLines.length; i++) {
    const line = rateLines[i];
    const m = /^([A-Za-z]{3})[\s:=\t]+(.+)$/.exec(line);
    if (!m) {
      if (i === 0 && !/\d/.test(line)) continue; // a header line ("Currency  Rate")
      return finRefuse(`Rate line ${i + 1}, ${q(line)}: write the code then the rate, such as “EUR 0.92” (1 ${base} = 0.92 EUR).`);
    }
    const c = isoCode(m[1], `Rate line ${i + 1}`);
    if (typeof c !== "string") return finRefuse(c.error);
    const rv = readRegCell(m[2].trim(), false);
    if (!Number.isFinite(rv.value)) return finRefuse(`Rate line ${i + 1}: ${q(m[2].trim())} is not a finite number.`);
    if (!(rv.value > 0)) return finRefuse(`Rate line ${i + 1}: the rate for ${c} must be positive; ${q(m[2].trim())} was typed.`);
    if (rv.decimalComma) decComma = true;
    const ex = ratOf(rv.value);
    if (!ex || ratSign(ex) <= 0) return finRefuse(`Rate line ${i + 1}: the rate for ${c} cannot be held exactly.`);
    if (c === base) {
      if (!(ex.n === 1n && ex.d === 1n)) return finRefuse(`Rate line ${i + 1}: ${c} is the base currency, so its rate is 1 by definition; ${q(m[2].trim())} was typed.`);
      continue;
    }
    if (typed.some((t) => t.code === c)) return finRefuse(`${c} has two rate lines; keep one.`);
    rates.set(c, ex);
    typed.push({ code: c, text: m[2].trim() });
  }
  if (!rates.has(target)) return finRefuse(`There is no rate for the target currency ${target}. Add a line “${target} rate” (1 ${base} = rate ${target}).`);

  const amountLines = get("amounts").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (amountLines.length > FX_MAX_AMOUNTS) return finRefuse(`At most ${FX_MAX_AMOUNTS} amounts are accepted; ${amountLines.length} were typed.`);
  const amounts: { amount: Rat; code: string; line: string }[] = [];
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
    const rv = readRegCell(numText.trim(), false);
    if (!Number.isFinite(rv.value)) return finRefuse(`Amount line ${i + 1}: ${q(numText.trim())} is not a finite number.`);
    if (Math.abs(rv.value) > FX_MAX_AMOUNT) return finRefuse(`Amount line ${i + 1}: ${q(numText.trim())} is beyond the largest amount accepted (10¹⁵).`);
    if (rv.decimalComma) decComma = true;
    if (!rates.has(c)) return finRefuse(`Amount line ${i + 1}: there is no rate for ${c}. Add a line “${c} rate” (1 ${base} = rate ${c}).`);
    const ex = ratOf(rv.value);
    if (!ex) return finRefuse(`Amount line ${i + 1}: ${q(numText.trim())} cannot be held exactly.`);
    amounts.push({ amount: ex, code: c, line });
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
    const fm = minorOf(from);
    const amtText = `${exactText(a.amount, fm ?? 0)} ${from}`;
    const crossText = `1 ${from} = ${sigText(rate)} ${target}`;
    const convText = `${moneyText(conv, target)} ${target}`;
    lines.push(`${amtText} = ${convText} (${crossText})`);
    convRows.push([amtText, crossText, convText]);
    const td = terminatingDecimals(a.amount);
    if (fm !== null && td !== null && td > fm) notes.push(`${amtText} has more decimals than ${from}'s ISO 4217 minor unit (${fm}); it was used as typed.`);
  }
  if (!amounts.length) lines.push("No amounts were typed: the cross rates are shown.");
  lines.push("");
  lines.push(
    `Conventions: each rate line reads “1 ${base} = rate CODE”. The cross rate from A to B is rate(B)/rate(A), the exact quotient of the typed rates; a conversion multiplies by it exactly and rounds once, ` +
      "half away from zero, to the target currency's ISO 4217 minor unit (the damages calculators' cent rounding, generalised from 2 decimals to the currency's own minor unit). Cross rates are shown to 6 significant digits; that display rounding is not used in the conversions.",
  );
  const tm = minorOf(target);
  lines.push(
    `Codes are checked against ${ISO4217_SOURCE}, ${listDate} (minor units from the same list: ${target} has ${tm === null ? "none (N.A.)" : tm}). No live rates are used: the result is only as current as the rates typed.`,
  );
  if (tm === null) notes.push(`ISO 4217 gives no minor unit for ${target} (N.A.), so ${target} amounts are shown to ${FX_NA_DECIMALS} decimal places, not rounded to a minor unit.`);
  for (const c of new Set(amounts.map((a) => a.code))) if (minorOf(c) === null) notes.push(`ISO 4217 gives no minor unit for ${c} (N.A.).`);
  lines.push(...notes, ...decimalCommaNote(decComma));

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
