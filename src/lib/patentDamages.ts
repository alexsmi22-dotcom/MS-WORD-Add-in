/**
 * Patent damages arithmetic (Release E1, v2.195.0): reasonable royalty, lost profits, price erosion, the remainder
 * of the infringer's units at a reasonable royalty, a combined summary by period, and the Georgia-Pacific and Panduit
 * worksheets. Pure: no Office.js, so jest imports it; the pane only wires fields to these functions.
 *
 * WORDING. Every result is arithmetic on the user's inputs. Nothing here says what anyone is entitled to, and no
 * rate is bundled as law: every rate, share, price and multiplier is a field the user filled in.
 *
 * CONVENTIONS (printed in each result's notes, pinned by the jest oracle cases):
 *  - Money is rounded to the cent per period (half away from zero) and totals are the sum of the rounded periods, so
 *    the table foots. Units are not rounded.
 *  - Every input amount and every per-period amount is at most one trillion (MAX_DAMAGES_AMOUNT) and every total at
 *    most ten trillion (MAX_DAMAGES_TOTAL), so whole cents are exact integers in a double; past them a result is
 *    refused by name. At most 10,000 periods.
 *  - A totals line (Total, Subtotal, Total damages, Grand total, Sum …) as the last row is skipped; anywhere else it
 *    is refused. A row's first cell is its period: a bare number there must be a year (1900–2100) or a date form.
 *  - Lump-sum comparison: each period's royalty is paid at the END of its period and discounted to the START of the
 *    first period at the annual effective rate d: PV = Σ R_k (1 + d)^(−k/m), m = periods per year.
 *  - Market-share method: the patentee's captured share of the infringer's units is p / (100 − i), the patentee's
 *    share renormalised with the infringer's share removed (p and i are market shares in %).
 *  - Capacity: SPARE capacity per period, the most extra units the patentee could have made and sold that period.
 *  - Price erosion: (but-for price − actual price) × the patentee's actual units. With an elasticity ε, the but-for
 *    volume is Q_bf = Q (1 − ε (P_bf − P) / P) and the erosion is Q_bf (P_bf − P) − (Q − Q_bf) × m_u, the price gain
 *    on the units still sold less the margin m_u lost on the units the higher price would have shed (m_u = actual
 *    price − incremental cost, or the incremental margin when the margin is entered directly).
 */
import { readFinanceField } from "./finance";
import { finPct, finPlotSvg, currentFinFig } from "./financeFigures";
import { buildChartPreviewSvg, type TableChart } from "./tablechart";
import { proseDashes } from "./proseDashes";
import { hasBrokenNumber } from "./insertGate";
import { foreignCurrencyRefusal, stripUsd, usd } from "./damagesUsd";
import { MAX_AMOUNT, MAX_ROWS, MAX_TOTAL, isTotalsLabel, toCents } from "./damagesInterest";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Input amounts, units and per-period amounts above one trillion are refused (whole cents stay exact). */
export const MAX_DAMAGES_AMOUNT = MAX_AMOUNT;
/** Totals above ten trillion are refused (still far below 2⁵³ cents, about 9 × 10¹³ dollars). */
export const MAX_DAMAGES_TOTAL = MAX_TOTAL;
/** Rows beyond this are refused (10,000 stays well inside the keystroke budget). */
export const MAX_DAMAGES_ROWS = MAX_ROWS;

/**
 * Rounds to the cent, half away from zero, treating a binary near-half (1.005 → 100.4999…) as the half it is, within
 * the value's own float precision only (toCents): 100,000,000,000.0048 is 0.48 of a cent, not a half.
 */
export function roundCents(x: number): number {
  const c = toCents(x);
  return Number.isNaN(c) ? NaN : c / 100;
}

// One formatter per shape, built once: toLocaleString with options builds a formatter per call, and a 10,000-period
// table has ~70,000 cells (3.6 s that way; the pane recomputes on every keystroke).
const NF_MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF_QTY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NF_UNIT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const NF_NUM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
const NF_PCT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** A formatted number with a true minus, and a negative zero printed as zero. */
function signed(nf: Intl.NumberFormat, x: number, zeroBelow: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = nf.format(Math.abs(x) < zeroBelow ? 0 : x);
  return s.startsWith("-") ? (/[1-9]/.test(s) ? "−" + s.slice(1) : s.slice(1)) : s;
}

/** US-dollar money: finMoney's grouping and two decimals, true minus, and "$" ("−$1,234.50"). */
export const dmgMoney = (x: number): string => usd(signed(NF_MONEY, roundCents(x), 0.005));

/** A unit count: grouped, at most two decimals, no trailing zeros. */
export const dmgQty = (x: number): string => signed(NF_QTY, x, 0.005);

/** A per-unit price or margin in US dollars: two decimals, up to four when the input has them; grouped, true minus, "$". */
export const dmgUnitMoney = (x: number): string => usd(signed(NF_UNIT, x, 5e-5));

/** A plain input number (an elasticity, a multiplier): grouped, at most six decimals, never e-notation. */
export const dmgNum = (x: number): string => signed(NF_NUM, x, 5e-7);

/** A percentage typed as a percent (5 → "5.00%"): two decimals as finPct prints them, up to four when entered. */
export function dmgPct(pct: number): string {
  if (!Number.isFinite(pct)) return finPct(NaN);
  return signed(NF_PCT, pct, 5e-5) + "%";
}

// ---------------------------------------------------------------------------
// The per-period table parser
// ---------------------------------------------------------------------------

export interface PeriodRow {
  label: string;
  values: number[];
}
export type PeriodTable = { rows: PeriodRow[]; notes: string[] };

/** A money or count cell: its US-dollar marking is dropped (parsePeriodTable refuses every other currency), then the product's cell reader. */
function readCell(raw: string): number {
  return readFinanceField(stripUsd(raw));
}

/**
 * A pasted per-period table: one period per line, the period label first, then the numbers.
 *
 * Cells are split on tabs (a Word or Excel table), else semicolons, else vertical bars, else runs of spaces (a label
 * may then hold spaces: "Q1 2024 1,000 50"). The FIRST cell is the period label whenever the row holds more cells than
 * the required numbers; a row of exactly the required numbers gets "Period n". A first line that does not read as
 * numbers is a header and is skipped (said in the notes). Every other problem is refused by line and by name.
 *
 * `names` are the numeric columns in order; the first `required` of them must be present, the rest are optional.
 */
/** A bare-number period label that IS a period: a year 1900–2100, or a date / month form a cell reader might accept. */
const PLAUSIBLE_PERIOD_RE = /^(?:19\d\d|20\d\d|2100)$|^(?:[1-9]\d?|1\d\d|200)$|^(?:19|20)\d\d(?:0[1-9]|1[0-2])$|^\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|^\d{1,2}\/\d{4}$/;

/** The first number after a totals line's label (tabs, semicolons, bars or spaces), NaN when there is none. */
function firstNumberAfterLabel(line: string): number {
  const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : line.includes("|") ? "|" : "";
  const cells = delim ? line.split(delim).slice(1) : line.split(/\s+/);
  for (const c of cells) {
    const v = readCell(c);
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

/** A line quoted in a note or refusal: tabs as spaces, at most 40 characters. */
const clip = (s0: string): string => {
  const s = s0.replace(/\t+/g, " ");
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
};

export interface PeriodTableOptions {
  /** Column indices (into `names`) that may hold a negative number (the summary's price-erosion offset). */
  allowNegative?: number[];
  /**
   * Column titles of this calculator's own RESULT tables (lower case) that are not input columns: a header line naming
   * one is a result table pasted back and is refused by name (the summary's "damages", "total", "cumulative").
   */
  resultColumns?: string[];
}

/** The damages summary's result columns that are not its inputs (its two tables since v2.201.1). */
export const SUMMARY_RESULT_COLUMNS = ["damages", "total", "cumulative"];

export function parsePeriodTable(text: string, names: string[], required: number, opts: PeriodTableOptions = {}): PeriodTable | { error: string } {
  const foreign = foreignCurrencyRefusal(text ?? "", "The table");
  if (foreign) return { error: foreign };
  const lines = (text ?? "").split(/\r?\n/);
  const rows: PeriodRow[] = [];
  const notes: string[] = [];
  const seen = new Map<string, number>();
  const max = names.length;
  const negOk = new Set(opts.allowNegative ?? []);
  let firstContent = true;
  let totalsLine: { li: number; text: string; first: number } | null = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/[   ]/g, " ").trim();
    if (!line) continue;
    // A totals line (an inserted result read back, an expert's table) is never a period: counting it would double the
    // damages. As the last row it is skipped and said; with rows after it, it is refused (which rows does it sum?).
    if (totalsLine) {
      return {
        error: `Line ${totalsLine.li + 1} (“${totalsLine.text}”) is a totals line with rows after it; a subtotal between periods is ambiguous. Remove it (totals are computed here, not read).`,
      };
    }
    if (isTotalsLabel(line)) {
      totalsLine = { li, text: clip(line), first: firstNumberAfterLabel(line) };
      firstContent = false;
      continue;
    }
    const isFirst = firstContent;
    firstContent = false;
    let label = "";
    let nums: string[];
    const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : line.includes("|") ? "|" : "";
    if (delim) {
      const cells = line.split(delim).map((c) => c.trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      // More cells than the required numbers: the first is the period label.
      if (cells.length > required || (cells.length && !Number.isFinite(readCell(cells[0])))) {
        label = cells[0];
        nums = cells.slice(1);
      } else nums = cells;
    } else {
      // Spaces: a leading run of words is the label, plus a year straight after them ("Q1 2024", "FY 2023"); a line
      // that starts with a number and holds more than the required numbers has that number as its label ("2021").
      const toks = line.split(/\s+/);
      let k = 0;
      while (k < toks.length && !Number.isFinite(readCell(toks[k]))) k++;
      if (k > 0 && k < toks.length && /^(19|20|21)\d\d$/.test(toks[k]) && toks.length - k - 1 >= required) k++;
      if (k === 0 && toks.length > required) k = 1;
      label = toks.slice(0, k).join(" ");
      nums = toks.slice(k);
      // "300 000" is one number with a space between its thousands, or two numbers: refused by name, never guessed
      // ("2022 300 000 280 000" read as 300 and 280 otherwise). Tab, semicolon and bar rows are unambiguous.
      // Accepted as separate numbers only when that reading fits the table and the thousands reading does not ("2023 500
      // 120" in a two-number table); a lone 0 never starts a thousands group.
      const fits = (c: number): boolean => c >= required && c <= max;
      for (let j = 1; j < nums.length; j++) {
        if (/^\d{3}(?:[.,]\d+)?$/.test(nums[j]) && /^[−–-]?[1-9]\d{0,2}$/.test(nums[j - 1]) && !(fits(nums.length) && !fits(nums.length - 1))) {
          return {
            error: `Line ${li + 1}: “${nums[j - 1]} ${nums[j]}” could be one number with a space between its thousands (${nums[j - 1]},${nums[j]}) or two numbers. Write thousands with commas, or separate the columns with tabs, semicolons or vertical bars.`,
          };
        }
      }
    }
    // The first cell is the period. A bare number there is a period only as a year or a date: "12,000 30,000 5,000"
    // would otherwise read 12,000 as the label and shift every column left.
    if (label && Number.isFinite(readCell(label)) && !PLAUSIBLE_PERIOD_RE.test(label.trim())) {
      return { error: `Line ${li + 1} has no period label (“${clip(label)}” is a number, not a year or a date); start each row with its period, e.g. 2023 or 2023-Q1.` };
    }
    const values: number[] = [];
    let badCell = "";
    for (const c of nums) {
      if (c === "") {
        badCell = "(empty cell)";
        break;
      }
      const v = readCell(c);
      if (!Number.isFinite(v)) {
        badCell = `“${c}”`;
        break;
      }
      values.push(v);
    }
    if (badCell || values.length < required) {
      // A header: the first line, and not one of its cells reads as a number.
      if (isFirst && nums.every((c) => !Number.isFinite(readCell(c)))) {
        // A header naming one of this calculator's RESULT columns is its own output pasted back (the summary's
        // "Damages" column would otherwise be read as interest and the damages counted twice).
        const own = [label, ...nums].map((c) => c.trim().toLowerCase()).find((c) => opts.resultColumns?.includes(c));
        if (own) {
          return {
            error: `The first line names a “${own}” column: that is a result table pasted back. Enter the columns this table takes (${names.join(", ")}), one row per period.`,
          };
        }
        notes.push(`The first line (“${line}”) was read as a header and skipped.`);
        continue;
      }
      if (badCell) return { error: `Line ${li + 1}${label ? ` (“${label}”)` : ""}: ${badCell} is not a number.` };
      return { error: `Line ${li + 1}${label ? ` (“${label}”)` : ""}: needs ${required} number${required === 1 ? "" : "s"} (${names.slice(0, required).join(", ")}), found ${values.length}.` };
    }
    if (values.length > max) {
      return { error: `Line ${li + 1}${label ? ` (“${label}”)` : ""}: ${values.length} numbers after the period, but this table takes at most ${max} (${names.join(", ")}).` };
    }
    for (let j = 0; j < values.length; j++) {
      if (values[j] < 0 && !negOk.has(j)) return { error: `Line ${li + 1}${label ? ` (“${label}”)` : ""}: ${names[j]} cannot be negative.` };
      if (Math.abs(values[j]) > MAX_DAMAGES_AMOUNT) return { error: `Line ${li + 1}${label ? ` (“${label}”)` : ""}: ${names[j]} is above one trillion, outside this calculator.` };
    }
    if (!label) label = `Period ${rows.length + 1}`;
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `The period “${label}” appears twice (lines ${seen.get(key)} and ${li + 1}).` };
    seen.set(key, li + 1);
    rows.push({ label, values });
    if (rows.length > MAX_DAMAGES_ROWS) return { error: `More than ${MAX_DAMAGES_ROWS.toLocaleString("en-US")} periods is outside this calculator.` };
  }
  if (totalsLine && !rows.length) {
    return { error: `Line ${totalsLine.li + 1} (“${totalsLine.text}”) reads as a totals line and there are no periods; start each row with its period, e.g. 2023 or 2023-Q1.` };
  }
  if (totalsLine) {
    // Skipped only when it IS the column total; a last period that merely starts with "Total" or "Sum" ("Total Q1")
    // is refused by name rather than dropped.
    const colSum = rows.reduce((t, r) => t + r.values[0], 0);
    if (!(Number.isFinite(totalsLine.first) && Math.abs(totalsLine.first - colSum) <= 0.005 + 1e-12 * Math.abs(colSum))) {
      return {
        error: `Line ${totalsLine.li + 1} (“${totalsLine.text}”) starts like a totals line, but its first number is not the column total; if it is a period, rename it (e.g. 2023-Q1), otherwise remove it.`,
      };
    }
    notes.push(`Line ${totalsLine.li + 1} (“${totalsLine.text}”) is a totals line and was skipped: totals are computed here, not read.`);
  }
  if (!rows.length) return { error: `Enter at least one period: a label, then ${names.slice(0, required).join(", ")}.` };
  return { rows, notes };
}

// ---------------------------------------------------------------------------
// Shared output shape
// ---------------------------------------------------------------------------

export interface DamagesTable {
  label: string;
  rows: string[][];
}
export interface DamagesOutput {
  text: string;
  tables: DamagesTable[];
  svg?: string;
}
export type DamagesResult = DamagesOutput | { error: string };

const refuse = (error: string): { error: string } => ({ error });

/** Above this many periods the figure is a cumulative line instead of one column per period. */
const MAX_COLUMNS = 40;

/**
 * One stacked column per period (series with all-zero values dropped), or, for a long table, the cumulative total as a
 * line sampled at most ~200 points. Drawn under the current Finance figure style (width; black and white for USPTO).
 */
export function damagesFigure(labels: string[], series: { name: string; values: number[] }[], title: string): string | undefined {
  const used = series.filter((s) => s.values.some((v) => v !== 0));
  if (!labels.length || !used.length) return undefined;
  const fig = currentFinFig();
  if (labels.length <= MAX_COLUMNS) {
    const chart: TableChart = {
      categories: labels,
      series: used.map((s) => ({ name: s.name, values: s.values })),
      categoryLabel: "Period",
      hasHeader: false,
      rows: [],
      warnings: [],
    };
    // The column chart has no axis label: the title carries the unit.
    return buildChartPreviewSvg(chart, "stacked-column", `${title} ($)`,{ patent: fig?.bw === true, grouping: "comma" }, fig?.width ?? 380).svg;
  }
  const n = labels.length;
  const stride = Math.max(1, Math.ceil(n / 200));
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let cum = 0;
  for (let k = 0; k < n; k++) {
    for (const s of used) cum += s.values[k];
    if ((k + 1) % stride === 0 || k === n - 1) pts.push({ x: k + 1, y: cum });
  }
  return finPlotSvg([{ points: pts, type: "line", color: "#2563eb", label: "cumulative" }], {
    width: 380,
    height: 250,
    title: `${title} (cumulative)`,
    xlabel: "period number",
    ylabel: "cumulative amount ($)",
    yGrouping: "comma",
  });
}

/** Sum of cent-rounded values in integer cents (exact: every total is held under MAX_DAMAGES_TOTAL). */
function sumCents(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += Math.round(x * 100);
  return s / 100;
}

/** The first of `checks` whose value is not a finite amount within `cap`, as a refusal naming it; else null. */
function overCap(checks: [string, number][], cap: number, capText: string): { error: string } | null {
  for (const [what, v] of checks) {
    if (!Number.isFinite(v) || Math.abs(v) > cap) return refuse(`${what} is above ${capText}, outside this calculator.`);
  }
  return null;
}
const ONE_TRILLION = "one trillion";
const TEN_TRILLION = "ten trillion";

// ---------------------------------------------------------------------------
// Reasonable royalty
// ---------------------------------------------------------------------------

export interface RoyaltyInput {
  rows: PeriodRow[];
  /** "revenue": the base is revenue and `rate` a percent of it; "unit": the base is units and `rate` money per unit. */
  basis: "revenue" | "unit";
  rate: number;
  /** Share of the base's value attributable to the patented feature, in percent (100 = no apportionment). */
  apportionPct: number;
  /** A lump sum to compare against the running royalty; 0 = no comparison. */
  lumpSum: number;
  /** Annual effective discount rate, percent. */
  discountPct: number;
  periodsPerYear: number;
}
export interface RoyaltyPeriod {
  label: string;
  base: number;
  royalty: number;
  cumulative: number;
  pv: number;
}
export interface RoyaltyComputed {
  periods: RoyaltyPeriod[];
  totalBase: number;
  total: number;
  pvTotal: number | null;
}

export function computeRoyalty(inp: RoyaltyInput): RoyaltyComputed | { error: string } {
  if (!(inp.rate >= 0) || !Number.isFinite(inp.rate)) return refuse("The royalty rate cannot be negative.");
  if (inp.basis === "revenue" && inp.rate > 100) return refuse("A royalty rate on revenue above 100% is outside this calculator.");
  if (!(inp.apportionPct > 0 && inp.apportionPct <= 100)) return refuse("Apportionment must be more than 0% and at most 100% (100% = none).");
  if (!(inp.lumpSum >= 0)) return refuse("The lump sum cannot be negative (0 = no comparison).");
  if (inp.lumpSum > MAX_DAMAGES_AMOUNT) return refuse("The lump sum is above one trillion, outside this calculator.");
  if (inp.lumpSum > 0) {
    if (!(inp.discountPct > -100) || inp.discountPct > 1000) return refuse("The discount rate must be above −100% and at most 1,000% a year.");
    if (!(inp.periodsPerYear > 0) || inp.periodsPerYear > 366) return refuse("Periods per year must be more than 0 and at most 366.");
  }
  const mult = (inp.basis === "revenue" ? inp.rate / 100 : inp.rate) * (inp.apportionPct / 100);
  const periods: RoyaltyPeriod[] = [];
  let cum = 0;
  let totalBase = 0;
  const d = inp.discountPct / 100;
  for (let k = 0; k < inp.rows.length; k++) {
    const r = inp.rows[k];
    const base = r.values[0];
    const royalty = roundCents(base * mult);
    const big = overCap([[`${r.label}: the royalty`, royalty]], MAX_DAMAGES_AMOUNT, ONE_TRILLION);
    if (big) return big;
    cum = roundCents(cum + royalty);
    totalBase += base;
    // Rounded per period like every other money column, so the Present value column foots.
    const pvk = inp.lumpSum > 0 ? roundCents(royalty * Math.pow(1 + d, -(k + 1) / inp.periodsPerYear)) : 0;
    periods.push({ label: r.label, base, royalty, cumulative: cum, pv: pvk });
  }
  const big = overCap(
    [
      ["The total royalty base", totalBase],
      ["The total royalty", cum],
    ],
    MAX_DAMAGES_TOTAL,
    TEN_TRILLION,
  );
  if (big) return big;
  return { periods, totalBase, total: sumCents(periods.map((p) => p.royalty)), pvTotal: inp.lumpSum > 0 ? sumCents(periods.map((p) => p.pv)) : null };
}

export function reasonableRoyalty(inp: RoyaltyInput): DamagesResult {
  const c = computeRoyalty(inp);
  if ("error" in c) return c;
  const unit = inp.basis === "unit";
  const rateText = unit ? `${usd(dmgNum(inp.rate))} per unit` : `${dmgPct(inp.rate)} of revenue`;
  const lines = [
    "Reasonable royalty, computed from the inputs given",
    `Rate: ${rateText}; apportionment ${dmgPct(inp.apportionPct)}`,
    `Periods: ${c.periods.length.toLocaleString("en-US")}`,
    `Total royalty base: ${unit ? `${dmgQty(c.totalBase)} units` : dmgMoney(c.totalBase)}`,
    `Total running royalty: ${dmgMoney(c.total)}`,
  ];
  if (c.pvTotal !== null) {
    const diff = roundCents(inp.lumpSum - c.pvTotal);
    lines.push(`Present value of the running royalty at ${dmgPct(inp.discountPct)} a year: ${dmgMoney(c.pvTotal)}`);
    lines.push(
      `Lump sum entered: ${dmgMoney(inp.lumpSum)}; ` +
        (diff === 0 ? "equal to that present value." : `${dmgMoney(Math.abs(diff))} ${diff > 0 ? "above" : "below"} that present value.`),
    );
  }
  lines.push(
    `Note: royalty per period = base × ${unit ? "rate per unit" : "rate"} × apportionment, rounded to the cent; the total is the sum of the rounded periods.`,
  );
  if (c.pvTotal !== null) {
    lines.push(
      `Note: each period's royalty is discounted from the end of its period to the start of the first period at the annual effective rate entered, ${inp.periodsPerYear} period${inp.periodsPerYear === 1 ? "" : "s"} a year; each present value is rounded to the cent and the total is their sum.`,
    );
  }
  const head = ["Period", unit ? "Units" : "Revenue", "Royalty", "Cumulative"];
  if (c.pvTotal !== null) head.push("Present value");
  const rows: string[][] = [head];
  for (const p of c.periods) {
    const row = [p.label, unit ? dmgQty(p.base) : dmgMoney(p.base), dmgMoney(p.royalty), dmgMoney(p.cumulative)];
    if (c.pvTotal !== null) row.push(dmgMoney(p.pv));
    rows.push(row);
  }
  const tot = ["Total", unit ? dmgQty(c.totalBase) : dmgMoney(c.totalBase), dmgMoney(c.total), ""];
  if (c.pvTotal !== null) tot.push(dmgMoney(c.pvTotal));
  rows.push(tot);
  return {
    text: lines.join("\n"),
    tables: [{ label: "Reasonable royalty by period", rows }],
    svg: damagesFigure(
      c.periods.map((p) => p.label),
      [{ name: "Royalty", values: c.periods.map((p) => p.royalty) }],
      "Reasonable royalty by period",
    ),
  };
}

// ---------------------------------------------------------------------------
// Lost profits, price erosion, remainder at a reasonable royalty
// ---------------------------------------------------------------------------

export interface LostProfitsInput {
  /** values: [infringer's units, patentee's actual units, spare capacity (optional)]. */
  rows: PeriodRow[];
  method: "share" | "market";
  /** Capture share in percent (method "share"). */
  captureSharePct: number;
  /** Market shares in percent (method "market"). */
  patenteeSharePct: number;
  infringerSharePct: number;
  /** Spare capacity per period applied when a row has no capacity column; 0 = no limit. */
  capacity: number;
  marginMode: "price-cost" | "margin";
  price: number;
  cost: number;
  margin: number;
  erosion: boolean;
  butForPrice: number;
  actualPrice: number;
  /** |%Δ quantity| per %Δ price; 0 = the patentee's volume is unchanged. */
  elasticity: number;
  remainder: "none" | "unit" | "revenue";
  /** Money per unit ("unit") or percent of the infringer's price ("revenue"). */
  remainderRate: number;
  infringerPrice: number;
}
export interface LostProfitsPeriod {
  label: string;
  infringerUnits: number;
  captured: number;
  uncaptured: number;
  lostProfits: number;
  erosion: number;
  remainder: number;
  total: number;
}
export interface LostProfitsComputed {
  periods: LostProfitsPeriod[];
  capture: number;
  unitMargin: number;
  capped: number;
  totals: { infringerUnits: number; captured: number; lostProfits: number; erosion: number; remainder: number; total: number };
}

export function computeLostProfits(inp: LostProfitsInput): LostProfitsComputed | { error: string } {
  let capture: number;
  if (inp.method === "share") {
    if (!(inp.captureSharePct >= 0 && inp.captureSharePct <= 100)) return refuse("The capture share must be from 0% to 100%.");
    capture = inp.captureSharePct / 100;
  } else {
    const p = inp.patenteeSharePct;
    const i = inp.infringerSharePct;
    if (!(p >= 0 && p <= 100) || !(i >= 0 && i < 100)) return refuse("Market shares must be from 0% to 100%, and the infringer's share below 100%.");
    if (p + i > 100 + 1e-9) return refuse(`The patentee's and the infringer's market shares add to ${dmgPct(p + i)}, more than 100%.`);
    capture = p / (100 - i);
  }
  if (!(inp.capacity >= 0)) return refuse("Spare capacity cannot be negative (0 = no limit).");
  let unitMargin: number;
  if (inp.marginMode === "price-cost") {
    if (!(inp.price >= 0) || !(inp.cost >= 0)) return refuse("The incremental price and cost cannot be negative.");
    unitMargin = inp.price - inp.cost;
  } else {
    unitMargin = inp.margin;
  }
  if (!Number.isFinite(unitMargin)) return refuse("The incremental margin is not a number.");
  if (unitMargin < 0) return refuse(`The incremental margin per unit is negative (${dmgMoney(unitMargin)}); lost profits need a positive margin.`);
  if (inp.erosion) {
    if (!(inp.actualPrice > 0)) return refuse("Price erosion needs an actual price above zero.");
    if (!(inp.butForPrice >= inp.actualPrice)) return refuse("Price erosion needs a but-for price at or above the actual price.");
    if (!(inp.elasticity >= 0)) return refuse("The elasticity cannot be negative (0 = the patentee's volume is unchanged).");
    // Every row: a row without the column would otherwise erode by zero without a word.
    const short = inp.rows.find((r) => r.values.length < 2);
    if (short) {
      return refuse(`${short.label}: price erosion needs the patentee's actual units, the second number on each line (enter 0 for a period with none).`);
    }
  }
  if (inp.remainder !== "none") {
    if (!(inp.remainderRate >= 0)) return refuse("The royalty on uncaptured units cannot be negative.");
    if (inp.remainder === "revenue" && inp.remainderRate > 100) return refuse("A royalty above 100% of the infringer's price is outside this calculator.");
    if (inp.remainder === "revenue" && !(inp.infringerPrice >= 0)) return refuse("The infringer's price per unit cannot be negative.");
  }
  // The unit margin the higher price would cost on shed units: actual price − cost, or the margin as entered.
  const shedMargin = inp.marginMode === "price-cost" ? inp.actualPrice - inp.cost : inp.margin;
  const remPerUnit = inp.remainder === "unit" ? inp.remainderRate : inp.remainder === "revenue" ? (inp.infringerPrice * inp.remainderRate) / 100 : 0;
  const periods: LostProfitsPeriod[] = [];
  let capped = 0;
  for (const r of inp.rows) {
    const units = r.values[0];
    const own = r.values[1] ?? 0;
    const capCol = r.values.length >= 3 ? r.values[2] : null;
    const demanded = units * capture;
    let captured = demanded;
    if (capCol !== null) captured = Math.min(demanded, capCol);
    else if (inp.capacity > 0) captured = Math.min(demanded, inp.capacity);
    if (captured < demanded) capped++;
    const uncaptured = units - captured;
    const lost = roundCents(captured * unitMargin);
    let erosion = 0;
    if (inp.erosion && own > 0) {
      const dp = inp.butForPrice - inp.actualPrice;
      if (inp.elasticity > 0) {
        const qbf = own * (1 - (inp.elasticity * dp) / inp.actualPrice);
        if (qbf < 0) {
          return refuse(`${r.label}: at elasticity ${dmgNum(inp.elasticity)} the but-for price leaves a negative but-for volume; lower the elasticity or the but-for price.`);
        }
        erosion = roundCents(qbf * dp - (own - qbf) * shedMargin);
      } else erosion = roundCents(own * dp);
    }
    const rem = inp.remainder === "none" ? 0 : roundCents(uncaptured * remPerUnit);
    const total = roundCents(lost + erosion + rem);
    const big = overCap(
      [
        [`${r.label}: the lost profits`, lost],
        [`${r.label}: the price erosion`, erosion],
        [`${r.label}: the royalty on uncaptured units`, rem],
        [`${r.label}: the total`, total],
      ],
      MAX_DAMAGES_AMOUNT,
      ONE_TRILLION,
    );
    if (big) return big;
    periods.push({ label: r.label, infringerUnits: units, captured, uncaptured, lostProfits: lost, erosion, remainder: rem, total });
  }
  const sum = (f: (p: LostProfitsPeriod) => number): number => periods.reduce((s, p) => s + f(p), 0);
  const totals = {
    infringerUnits: sum((p) => p.infringerUnits),
    captured: sum((p) => p.captured),
    lostProfits: sumCents(periods.map((p) => p.lostProfits)),
    erosion: sumCents(periods.map((p) => p.erosion)),
    remainder: sumCents(periods.map((p) => p.remainder)),
    total: sumCents(periods.map((p) => p.total)),
  };
  const big = overCap(
    [
      ["The total lost profits", totals.lostProfits],
      ["The total price erosion", totals.erosion],
      ["The total royalty on uncaptured units", totals.remainder],
      ["The total", totals.total],
    ],
    MAX_DAMAGES_TOTAL,
    TEN_TRILLION,
  );
  if (big) return big;
  return { periods, capture, unitMargin, capped, totals };
}

export function lostProfits(inp: LostProfitsInput): DamagesResult {
  const c = computeLostProfits(inp);
  if ("error" in c) return c;
  const t = c.totals;
  const lines = [
    "Lost profits, computed from the inputs given",
    inp.method === "share"
      ? `Capture share: ${dmgPct(inp.captureSharePct)} of the infringer's units`
      : `Market-share method: patentee ${dmgPct(inp.patenteeSharePct)}, infringer ${dmgPct(inp.infringerSharePct)}; capture share ${dmgPct(c.capture * 100)}`,
    `Incremental margin per unit: ${dmgUnitMoney(c.unitMargin)}`,
    `Infringer's units: ${dmgQty(t.infringerUnits)}; captured by the patentee: ${dmgQty(t.captured)}`,
    `Lost profits on captured sales: ${dmgMoney(t.lostProfits)}`,
  ];
  if (inp.erosion) lines.push(`Price erosion: ${dmgMoney(t.erosion)}`);
  if (inp.remainder !== "none") lines.push(`Uncaptured units at a reasonable royalty: ${dmgMoney(t.remainder)}`);
  lines.push(`Total: ${dmgMoney(t.total)}`);
  if (c.capped) lines.push(`Spare capacity limited the captured units in ${c.capped} of ${c.periods.length} periods.`);
  lines.push("Note: captured units = infringer's units × capture share, limited by the spare capacity; lost profits = captured units × incremental margin.");
  if (inp.method === "market") lines.push("Note: market-share capture = patentee's share ÷ (100% − infringer's share).");
  if (inp.erosion) {
    lines.push(
      inp.elasticity > 0
        ? `Note: price erosion = but-for units × (but-for − actual price) − (actual units − but-for units) × ${dmgUnitMoney(inp.marginMode === "price-cost" ? inp.actualPrice - inp.cost : inp.margin)} margin per unit shed; but-for units = the patentee's actual units × (1 − ${dmgNum(inp.elasticity)} × price rise ÷ actual price).`
        : "Note: price erosion = (but-for price − actual price) × the patentee's actual units.",
    );
    lines.push("Note: captured units are valued at the incremental price entered; enter the but-for price there to value them at it.");
    if (c.periods.some((p) => p.erosion < 0)) {
      lines.push(
        "Note: a negative price erosion (the margin lost on units the higher price would have shed exceeds the price gain) is shown as computed and subtracted in the total, as an offset; the summary tool accepts it in its price-erosion column.",
      );
    }
  }
  lines.push("Note: each amount is rounded to the cent per period; totals are the sums of the rounded periods.");
  const head = ["Period", "Infringer's units", "Captured units", "Lost profits"];
  if (inp.erosion) head.push("Price erosion");
  if (inp.remainder !== "none") head.push("Royalty on uncaptured units");
  head.push("Total");
  const rows: string[][] = [head];
  for (const p of c.periods) {
    const row = [p.label, dmgQty(p.infringerUnits), dmgQty(p.captured), dmgMoney(p.lostProfits)];
    if (inp.erosion) row.push(dmgMoney(p.erosion));
    if (inp.remainder !== "none") row.push(dmgMoney(p.remainder));
    row.push(dmgMoney(p.total));
    rows.push(row);
  }
  const tot = ["Total", dmgQty(t.infringerUnits), dmgQty(t.captured), dmgMoney(t.lostProfits)];
  if (inp.erosion) tot.push(dmgMoney(t.erosion));
  if (inp.remainder !== "none") tot.push(dmgMoney(t.remainder));
  tot.push(dmgMoney(t.total));
  rows.push(tot);
  // More than six columns (erosion and the uncaptured-units royalty both on): units and money as two tables, since
  // Word breaks long amounts mid-number in wider tables (v2.201.1).
  let tables: DamagesTable[] = [{ label: "Lost profits by period", rows }];
  if (head.length > 6) {
    tables = [
      { label: "Units by period", rows: rows.map((r) => r.slice(0, 3)) },
      { label: "Lost profits by period", rows: rows.map((r) => [r[0], ...r.slice(3)]) },
    ];
  }
  const series = [{ name: "Lost profits", values: c.periods.map((p) => p.lostProfits) }];
  if (inp.erosion) series.push({ name: "Price erosion", values: c.periods.map((p) => p.erosion) });
  if (inp.remainder !== "none") series.push({ name: "Royalty", values: c.periods.map((p) => p.remainder) });
  return {
    text: lines.join("\n"),
    tables,
    svg: damagesFigure(c.periods.map((p) => p.label), series, "Lost profits by period"),
  };
}

// ---------------------------------------------------------------------------
// Combined summary
// ---------------------------------------------------------------------------

export interface SummaryInput {
  /** values: [lost profits, price erosion, reasonable royalty, interest (optional)]. */
  rows: PeriodRow[];
  /** The user's enhancement multiplier, 1 to 3 (1 = none); applied to the damages columns, never to interest. */
  multiplier: number;
}

export function damagesSummary(inp: SummaryInput): DamagesResult {
  const m = inp.multiplier;
  if (!(m >= 1)) return refuse("The multiplier must be at least 1 (1 = no increase).");
  if (m > 3) {
    return refuse(
      "A multiplier above 3 is outside this calculator: under 35 U.S.C. § 284 the court “may increase the damages up to three times the amount found or assessed.”",
    );
  }
  const hasInterest = inp.rows.some((r) => r.values.length >= 4);
  const per = inp.rows.map((r) => {
    const lp = roundCents(r.values[0]);
    const pe = roundCents(r.values[1] ?? 0);
    const rr = roundCents(r.values[2] ?? 0);
    const it = roundCents(r.values[3] ?? 0);
    const dmg = roundCents(lp + pe + rr);
    return { label: r.label, lp, pe, rr, it, dmg, total: roundCents(dmg + it) };
  });
  const T = {
    lp: sumCents(per.map((p) => p.lp)),
    pe: sumCents(per.map((p) => p.pe)),
    rr: sumCents(per.map((p) => p.rr)),
    it: sumCents(per.map((p) => p.it)),
    dmg: sumCents(per.map((p) => p.dmg)),
    total: sumCents(per.map((p) => p.total)),
  };
  const enhanced = roundCents(T.dmg * m);
  const grand = roundCents(enhanced + T.it);
  const big =
    overCap(
      per.map((p): [string, number] => [`${p.label}: the period total`, p.total]),
      MAX_DAMAGES_AMOUNT,
      ONE_TRILLION,
    ) ??
    overCap(
      [
        ["The total lost profits", T.lp],
        ["The total price erosion", T.pe],
        ["The total reasonable royalty", T.rr],
        ["The total interest", T.it],
        ["The total damages", T.dmg],
        ["The total", T.total],
        ["The damages with the multiplier", enhanced],
        ["The total with the multiplier", grand],
      ],
      MAX_DAMAGES_TOTAL,
      TEN_TRILLION,
    );
  if (big) return big;
  const negErosion = per.some((p) => p.pe < 0);
  const lines = [
    "Damages summary, computed from the inputs given",
    `Periods: ${per.length.toLocaleString("en-US")}`,
    `Lost profits: ${dmgMoney(T.lp)}`,
    `Price erosion: ${dmgMoney(T.pe)}`,
    `Reasonable royalty: ${dmgMoney(T.rr)}`,
    `Damages: ${dmgMoney(T.dmg)}`,
  ];
  if (m !== 1) lines.push(`Damages × ${dmgNum(m)} (multiplier entered): ${dmgMoney(enhanced)}`);
  if (hasInterest) lines.push(`Interest (as entered): ${dmgMoney(T.it)}`);
  lines.push(`Total: ${dmgMoney(grand)}`);
  lines.push("Note: this summary adds the columns entered; it computes no interest (enter interest from the interest tool as the fourth column).");
  if (m !== 1) {
    lines.push(
      "Note: the multiplier is applied to the damages columns only, not to interest; the last rows of the damages table and of the interest and totals table show it.",
    );
  }
  if (negErosion) lines.push("Note: a negative price erosion (as the lost-profits tool can compute) is entered as an offset and subtracted from the damages.");
  lines.push("Note: each amount is rounded to the cent per period; totals are the sums of the rounded periods.");
  // Two tables of at most six columns (v2.201.1): Word breaks long amounts mid-number in wider tables.
  const rows: string[][] = [["Period", "Lost profits", "Price erosion", "Reasonable royalty", "Damages"]];
  const head2 = ["Period", "Damages"];
  if (hasInterest) head2.push("Interest");
  head2.push("Total", "Cumulative");
  const rows2: string[][] = [head2];
  let cum = 0;
  for (const p of per) {
    cum = roundCents(cum + p.total);
    rows.push([p.label, dmgMoney(p.lp), dmgMoney(p.pe), dmgMoney(p.rr), dmgMoney(p.dmg)]);
    const row2 = [p.label, dmgMoney(p.dmg)];
    if (hasInterest) row2.push(dmgMoney(p.it));
    row2.push(dmgMoney(p.total), dmgMoney(cum));
    rows2.push(row2);
  }
  rows.push(["Total", dmgMoney(T.lp), dmgMoney(T.pe), dmgMoney(T.rr), dmgMoney(T.dmg)]);
  const tot2 = ["Total", dmgMoney(T.dmg)];
  if (hasInterest) tot2.push(dmgMoney(T.it));
  tot2.push(dmgMoney(T.total), "");
  rows2.push(tot2);
  if (m !== 1) {
    // The text's "Damages × m" and "Total" lines, in the tables too: the inserted tables are what a reader relies on.
    rows.push(["Multiplier entered", "", "", "", `× ${dmgNum(m)}`]);
    rows.push([`Damages × ${dmgNum(m)}`, "", "", "", dmgMoney(enhanced)]);
    rows2.push([`Total with damages × ${dmgNum(m)}`, dmgMoney(enhanced), ...(hasInterest ? [dmgMoney(T.it)] : []), dmgMoney(grand), ""]);
  }
  const series = [
    { name: "Lost profits", values: per.map((p) => p.lp) },
    { name: "Price erosion", values: per.map((p) => p.pe) },
    { name: "Royalty", values: per.map((p) => p.rr) },
  ];
  if (hasInterest) series.push({ name: "Interest", values: per.map((p) => p.it) });
  return {
    text: lines.join("\n"),
    tables: [
      { label: "Damages by period", rows },
      { label: "Interest and totals by period", rows: rows2 },
    ],
    svg: damagesFigure(per.map((p) => p.label), series, "Damages by period"),
  };
}

// ---------------------------------------------------------------------------
// Worksheets
// ---------------------------------------------------------------------------

export const GEORGIA_PACIFIC_CITATION = "Georgia-Pacific Corp. v. U.S. Plywood Corp., 318 F. Supp. 1116, 1120 (S.D.N.Y. 1970)";
export const PROBATTER_CITATION = "ProBatter Sports, LLC v. Sports Tutor, Inc., 586 F. Supp. 3d 80 (D. Conn. 2022)";
export const PANDUIT_CITATION =
  "Panduit Corp. v. Stahlin Bros. Fibre Works, Inc., 575 F.2d 1152, 1156 (6th Cir. 1978), as stated in Presidio Components, Inc. v. Am. Tech. Ceramics Corp., 875 F.3d 1369 (Fed. Cir. 2017)";
export const PANDUIT_QUOTE =
  "(1) demand for the patented product; (2) an absence of acceptable, noninfringing substitutes; (3) manufacturing and marketing capability to exploit the demand; and (4) the amount of profit that would have been made.";
export const PANDUIT_FACTORS = [
  "demand for the patented product",
  "an absence of acceptable, noninfringing substitutes",
  "manufacturing and marketing capability to exploit the demand",
  "the amount of profit that would have been made",
];

/**
 * The fifteen short titles as verified in the release brief. Factor 6's em dash goes through proseDashes (it becomes
 * a semicolon), because an em dash in an ok result is the pane's non-finite sentinel and blocks the insert.
 */
export const GEORGIA_PACIFIC_FACTORS = [
  "royalties received by the patentee for licensing the patent in suit (established royalty)",
  "rates paid by the licensee for comparable patents",
  "nature and scope of the license (exclusive/non-exclusive, territory, customers)",
  "licensor's established policy and marketing program (not licensing / special conditions)",
  "commercial relationship between licensor and licensee (competitors; inventor and promoter)",
  proseDashes("effect on sales of other products — derivative or convoyed sales"),
  "duration of the patent and term of the license",
  "established profitability, commercial success and current popularity of the patented product",
  "utility and advantages over old modes or devices",
  "nature of the invention, character of the commercial embodiment, benefits to users",
  "extent of the infringer's use and evidence of the value of that use",
  "portion of profit or selling price customary in the business for use of the invention or analogous inventions",
  "portion of realizable profit credited to the invention as distinguished from non-patented elements, manufacturing process, business risks or improvements added by the infringer",
  "opinion testimony of qualified experts",
  "amount a willing licensor and willing licensee would have agreed upon at the time infringement began (hypothetical negotiation)",
];

export function georgiaPacificWorksheet(): DamagesOutput {
  const rows: string[][] = [["No.", "Factor", "Evidence", "Effect on rate (↑/↓/neutral)"]];
  GEORGIA_PACIFIC_FACTORS.forEach((f, i) => rows.push([String(i + 1), f, "", ""]));
  return {
    text: [
      "Georgia-Pacific factors worksheet",
      `${GEORGIA_PACIFIC_CITATION}; the fifteen factors are set out verbatim in ${PROBATTER_CITATION}.`,
      "Factor titles are short titles; record the evidence and its effect on the rate for each.",
    ].join("\n"),
    tables: [{ label: "Georgia-Pacific factors", rows }],
  };
}

export function panduitWorksheet(): DamagesOutput {
  const rows: string[][] = [["No.", "Factor", "Evidence", "Shown?"]];
  PANDUIT_FACTORS.forEach((f, i) => rows.push([String(i + 1), f, "", ""]));
  return {
    text: ["Panduit factors worksheet", `“${PANDUIT_QUOTE}” ${PANDUIT_CITATION}.`].join("\n"),
    tables: [{ label: "Panduit factors", rows }],
  };
}

/**
 * A damages result in the Finance pane's result shape: a refusal is shown, never insertable; the table reader's notes
 * (a skipped header line) are carried as Note lines.
 */
export function damagesToFin(r: DamagesResult, notes: string[] = []): { text: string; svg?: string; ok?: boolean; tables?: DamagesTable[] } {
  if ("error" in r) return { text: r.error, ok: false };
  const text = notes.length ? `${r.text}\n${notes.map((n) => `Note: ${n}`).join("\n")}` : r.text;
  return { text, svg: r.svg, tables: r.tables };
}

/** Every cell of every table is insertable: no em dash (the non-finite sentinel) and no NaN/Infinity/undefined. */
export function damagesTablesClean(tables: DamagesTable[]): boolean {
  return tables.every((t) => t.rows.every((r) => r.every((c) => !c.includes("—") && !hasBrokenNumber(c))));
}
