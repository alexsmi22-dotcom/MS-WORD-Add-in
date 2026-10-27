/**
 * Securities damages beyond the event study (Release F2, gap item #6). Arithmetic on the user's inputs only: the
 * prices, abnormal returns, inflation drops, trades, float, volume and trader parameters are all typed or pasted by
 * the user. Nothing here says what anyone is entitled to. Money prints in US dollars (usd), like the other damages
 * calculators; a pasted table naming another currency is refused by name (foreignCurrencyRefusal).
 *
 *  - secRibbonCalc     inflation ribbon from a daily close table and the corrective disclosures
 *  - secOutOfPocketCalc per-share out-of-pocket loss by purchase/sale window, FIFO or LIFO matching of a trade blotter
 *  - pslraLookbackCalc  the 90-day lookback cap of 15 U.S.C. § 78u-4(e)
 *  - secAggregateCalc   aggregate damages by a proportional trading model (one-trader, two-trader), labelled a model
 *
 * READERS. Date-and-value tables go through parseSeriesTable (tsData.ts, the event study's reader: dates oldest first,
 * each once); the blotter through parseRegData + selectColumns (regData.ts); dates in fields through parseDateField.
 * A "$" (or "US$") in a cell is dropped after the foreign-currency check, as the other damages tables do.
 *
 * WINDOWS. Disclosure dates D₁ < … < Dₖ split time into windows: window 1 runs from the class-period start to the day
 * before D₁, window j from Dⱼ₋₁ to the day before Dⱼ, and the last from Dₖ on. A disclosure day belongs to the window
 * it opens: its close already reflects the correction. The class period ends the day before Dₖ.
 */
import { foreignCurrencyRefusal, usd } from "./damagesUsd";
import { civilDay, civilFromDay, decimalYear, longDate, parseDateField } from "./damagesInterest";
import { dmgMoney, dmgQty, dmgUnitMoney, damagesFigure, roundCents } from "./patentDamages";
import { finPlotSvg } from "./financeFigures";
import { readFinanceField } from "./finance";
import { parseSeriesTable } from "./tsData";
import { parseRegData, selectColumns, isMissingCell, type RegDataset } from "./regData";
import { finRefusal, type FinResult, type FinTable } from "./finCalc";

type Read = (k: string) => string;

/** Most daily rows in a price or volume table. */
export const MAX_SEC_DAYS = 10000;
/** Most corrective disclosures. */
export const MAX_DISCLOSURES = 50;
/** Most trades in a blotter. */
export const MAX_TRADES = 5000;
/** Largest share count, volume or float accepted. */
export const MAX_SHARES = 1e12;
/** Largest per-share price or inflation accepted. */
export const MAX_PRICE = 1e6;
/** Largest dollar amount printed (whole cents stay exact). */
const MAX_DOLLARS = 1e13;

const MINUS = "−";
const q = (s: string): string => `“${s}”`;

// ---------------------------------------------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------------------------------------------

/** A cell's US-dollar marks ("$", "US$", "USD$") removed; run only after foreignCurrencyRefusal passed. */
function stripDollarMarks(text: string): string {
  return text.replace(/(?:U\.?S\.?\s?|USD\s?)?\$/gi, "");
}

/**
 * A whitespace-separated table (no tab, no semicolon) with the same number of cells on every line, re-joined with
 * tabs. The regression reader takes a first line holding a comma as a CSV header, so a typed "2025-03-03 2,401,000"
 * or "3/5/2025 Buy 1,000 41.20" would be split at its thousands commas; tab-joined, the commas stay inside their
 * cells. A cell ending in a comma ("January 5, 2025", a ", "-separated CSV) leaves the text as it is.
 */
export function whitespaceTable(text: string): string {
  if (/[\t;]/.test(text)) return text;
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return text;
  const cells = lines.map((l) => l.trim().split(/\s+/));
  const w = cells[0].length;
  if (w < 2 || cells.some((c) => c.length !== w || c.some((x) => x.endsWith(",")))) return text;
  return cells.map((c) => c.join("\t")).join("\n");
}

/** Grouped count ("3,654"). */
const count = (n: number): string => n.toLocaleString("en-US");

/** A number field the pane already read (a plain decimal string), or the raw text when its read failed. */
function numberField(r: Read, key: string, label: string, optional = false): number | null | { error: string } {
  const s = (r(key) ?? "").trim();
  if (!s) return optional ? null : { error: `Enter the ${label}.` };
  const v = readFinanceField(s);
  if (!Number.isFinite(v)) return { error: `${cap(label)}: ${q(s)} is not a number.` };
  return v;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface DaySeries {
  days: number[];
  names: string[];
  cols: Float64Array[];
  percent: boolean[];
  notes: string[];
}

/** A pasted table of single trading days (oldest first) and one or more value columns. */
function readDaySeries(text: string, what: string, minRows: number): DaySeries | { error: string } {
  const raw = text ?? "";
  if (!raw.trim()) return { error: `${what} is empty: paste one row per trading day, the date first.` };
  const foreign = foreignCurrencyRefusal(raw, what);
  if (foreign) return { error: foreign };
  const s = parseSeriesTable(whitespaceTable(stripDollarMarks(raw)), { minRows, requireDates: true });
  if (!s.ok) return { error: `${what}: ${s.reason}` };
  const d = s.data.dates!;
  const bad = d.tokens.find((t) => t.period !== "day");
  if (bad) return { error: `${what}: ${q(bad.label)} is a period, not a single day; give one row per trading day (2024-01-05).` };
  if (s.data.n > MAX_SEC_DAYS) return { error: `${what} has ${s.data.n.toLocaleString("en-US")} rows; the most is ${MAX_SEC_DAYS.toLocaleString("en-US")}.` };
  return { days: d.tokens.map((t) => t.from), names: s.data.names, cols: s.data.cols, percent: s.data.percent, notes: s.data.notes };
}

/** Per-share money: "$1.2345" (two to four decimals). */
const ps = (x: number): string => dmgUnitMoney(Math.abs(x) < 5e-5 ? 0 : x);
/** A percentage from a decimal: −0.085 → "−8.50%". */
function pctText(x: number, dp = 2): string {
  const s = (x * 100).toFixed(dp);
  if (/^-0(\.0+)?$/.test(s)) return s.slice(1) + "%";
  return (s.startsWith("-") ? MINUS + s.slice(1) : s) + "%";
}

/** The window holding `day` (0 … k): how many disclosures fall on or before it. */
function windowOf(day: number, disc: number[]): number {
  let w = 0;
  while (w < disc.length && disc[w] <= day) w++;
  return w;
}

/** Constant-dollar inflation in each window 0 … k: the drops at every later disclosure. */
function windowInflation(drops: number[]): number[] {
  const k = drops.length;
  const out = new Array<number>(k + 1).fill(0);
  for (let w = k - 1; w >= 0; w--) out[w] = out[w + 1] + drops[w];
  return out;
}

/** "Window 2" and its date range. */
function windowRange(w: number, start: number, disc: number[]): string {
  const k = disc.length;
  const from = w === 0 ? start : disc[w - 1];
  if (w === k) return `from ${longDate(from)}`;
  return `${longDate(from)} to ${longDate(disc[w] - 1)}`;
}

/**
 * The constant-dollar ribbon's input: one row per disclosure, the date and the inflation removed per share (dollars).
 * Several value columns (the ribbon's own disclosure table pasted back): the LAST is the drop.
 */
function readDropTable(text: string, start: number | null): { disc: number[]; drops: number[]; notes: string[] } | { error: string } {
  const what = "The disclosure table";
  const s = readDaySeries(text, what, 1);
  if ("error" in s) return s;
  if (s.days.length > MAX_DISCLOSURES) return { error: `${what} has ${s.days.length} disclosures; the most is ${MAX_DISCLOSURES}.` };
  const j = s.cols.length - 1;
  const notes = [...s.notes];
  if (s.cols.length > 1) notes.push(`The disclosure table has ${s.cols.length} value columns; the last, ${q(s.names[j])}, was read as the inflation removed per share.`);
  if (s.percent[j]) {
    return {
      error: `${what}: ${q(s.names[j])} is in percent; this calculator takes the inflation removed per share in dollars (the ribbon's constant-dollar disclosure table gives it).`,
    };
  }
  const drops = Array.from(s.cols[j]);
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (!(d > 0)) return { error: `${what}, ${longDate(s.days[i])}: the inflation removed (${ps(d)}) must be positive (a price decline).` };
    if (d > MAX_PRICE) return { error: `${what}, ${longDate(s.days[i])}: the inflation removed is above ${usd("1,000,000")} per share, outside this calculator.` };
  }
  if (start !== null && s.days[0] <= start) {
    return { error: `The first disclosure (${longDate(s.days[0])}) must come after the class-period start (${longDate(start)}).` };
  }
  return { disc: s.days, drops, notes };
}

const noteLines = (notes: string[]): string[] => notes.map((n) => `Note: ${n}`);

// ---------------------------------------------------------------------------------------------------------------
// (a) Inflation ribbon
// ---------------------------------------------------------------------------------------------------------------

export type RibbonMode = "ar-dollar" | "ar-pct" | "dollar";

export interface RibbonResult {
  days: number[];
  close: number[];
  inflation: number[];
  disc: number[];
  /** Per disclosure: the prior close, the close, the abnormal return (decimal; NaN in dollar mode), the drop in dollars. */
  prior: number[];
  discClose: number[];
  ar: number[];
  drops: number[];
  notes: string[];
}

/** The ribbon engine on already-read numbers. */
export function inflationRibbon(
  days: number[],
  close: number[],
  disc: number[],
  values: number[],
  mode: RibbonMode,
): Omit<RibbonResult, "notes"> | { error: string } {
  const index = new Map<number, number>();
  days.forEach((d, i) => index.set(d, i));
  const k = disc.length;
  const prior: number[] = [];
  const discClose: number[] = [];
  const ar: number[] = [];
  const drops: number[] = [];
  for (let j = 0; j < k; j++) {
    const i = index.get(disc[j]);
    if (i === undefined) return { error: `The disclosure on ${longDate(disc[j])} is not a row of the price table; each disclosure date must be a trading day listed there.` };
    if (i === 0) return { error: `The disclosure on ${longDate(disc[j])} is the first row of the price table; the table must start at least one trading day before the first disclosure.` };
    prior.push(close[i - 1]);
    discClose.push(close[i]);
    const v = values[j];
    if (mode === "dollar") {
      if (!(v > 0)) return { error: `Disclosure ${longDate(disc[j])}: the inflation removed (${ps(v)}) must be positive.` };
      ar.push(NaN);
      drops.push(v);
    } else {
      if (!(v < 0)) return { error: `Disclosure ${longDate(disc[j])}: the abnormal return ${pctText(v)} is not a price decline; a corrective disclosure's abnormal return must be negative.` };
      if (!(v > -1)) return { error: `Disclosure ${longDate(disc[j])}: an abnormal return of ${pctText(v)} is −100% or below.` };
      ar.push(v);
      drops.push(-v * close[i - 1]);
    }
  }
  const n = days.length;
  const inflation = new Array<number>(n).fill(0);
  if (mode === "ar-pct") {
    let factor = 1;
    let j = k - 1;
    for (let i = n - 1; i >= 0; i--) {
      // A disclosure later than this day multiplies the value-without-inflation by (1 + AR).
      while (j >= 0 && disc[j] > days[i]) factor *= 1 + ar[j--];
      inflation[i] = close[i] * (1 - factor);
    }
  } else {
    let sum = 0;
    let j = k - 1;
    for (let i = n - 1; i >= 0; i--) {
      while (j >= 0 && disc[j] > days[i]) sum += drops[j--];
      inflation[i] = sum;
      if (!(sum < close[i])) {
        return {
          error: `On ${longDate(days[i])} the inflation (${ps(sum)} per share) is not below the close (${ps(close[i])}); the drops entered remove more than the price. Check the disclosures.`,
        };
      }
    }
  }
  return { days, close, inflation, disc, prior, discClose, ar, drops };
}

const RIBBON_CONVENTIONS: Record<RibbonMode, string> = {
  "ar-dollar":
    "Conventions: constant-dollar ribbon. The inflation removed at a disclosure = −(its abnormal return) × the close on the trading day before it; the inflation on a day = the sum removed at every LATER disclosure (a disclosure day's close is already corrected), zero from the final disclosure on.",
  "ar-pct":
    "Conventions: constant-percentage ribbon. The value without inflation on a day = the close × Π(1 + abnormal return) over every LATER disclosure (a disclosure day's close is already corrected); inflation = the close − that value, zero from the final disclosure on.",
  dollar:
    "Conventions: constant-dollar ribbon from the inflation removed per share as entered; the inflation on a day = the sum removed at every LATER disclosure (a disclosure day's close is already corrected), zero from the final disclosure on.",
};

/** (a) The inflation ribbon from the pane's fields. */
export function secRibbonCalc(r: Read): FinResult {
  const mode = r("mode") as RibbonMode;
  if (mode !== "ar-dollar" && mode !== "ar-pct" && mode !== "dollar") return finRefusal(`Unknown ribbon method ${q(r("mode"))}.`);
  const units = r("units");
  if (units !== "percent" && units !== "decimal") return finRefusal(`Unknown abnormal-return units ${q(units)}.`);
  const p = readDaySeries(r("prices"), "The price table", 2);
  if ("error" in p) return finRefusal(p.error);
  const notes = [...p.notes];
  if (p.cols.length > 1) notes.push(`The price table has ${p.cols.length} value columns; the first, ${q(p.names[0])}, was read as the close.`);
  const close = Array.from(p.cols[0]);
  for (let i = 0; i < close.length; i++) {
    if (!(close[i] > 0)) return finRefusal(`The price table, ${longDate(p.days[i])}: the close (${ps(close[i])}) must be positive.`);
    if (close[i] > MAX_PRICE) return finRefusal(`The price table, ${longDate(p.days[i])}: a close above ${usd("1,000,000")} is outside this calculator.`);
  }
  const d = readDaySeries(r("disclosures"), "The disclosure table", 1);
  if ("error" in d) return finRefusal(d.error);
  if (d.days.length > MAX_DISCLOSURES) return finRefusal(`The disclosure table has ${d.days.length} disclosures; the most is ${MAX_DISCLOSURES}.`);
  notes.push(...d.notes.filter((n) => !notes.includes(n)));
  const j = d.cols.length - 1;
  if (d.cols.length > 1) notes.push(`The disclosure table has ${d.cols.length} value columns; the last, ${q(d.names[j])}, was read.`);
  let values = Array.from(d.cols[j]);
  let percentIn = units === "percent";
  if (mode === "dollar") {
    if (d.percent[j]) return finRefusal(`The disclosure table: ${q(d.names[j])} is in percent, but the method takes the inflation removed per share in dollars.`);
  } else {
    if (d.percent[j] && !percentIn) {
      percentIn = true;
      notes.push("The abnormal returns carry % signs, so they were read as percent (as if Percent had been chosen).");
    }
    if (percentIn) values = values.map((v) => v / 100);
  }
  if (d.days[0] <= p.days[0]) {
    return finRefusal(`The first disclosure (${longDate(d.days[0])}) must come after the first day of the price table (${longDate(p.days[0])}), the class-period start.`);
  }
  const res = inflationRibbon(p.days, close, d.days, values, mode);
  if ("error" in res) return finRefusal(res.error);
  const k = res.disc.length;
  const start = p.days[0];

  // Disclosure table.
  const discRows: string[][] =
    mode === "ar-pct"
      ? [["Disclosure date", "Prior close", "Close", "Abnormal return", "Inflation before (% of price)"]]
      : [["Disclosure date", "Prior close", "Close", "Abnormal return", "Inflation removed per share"]];
  const rowOf = new Map<number, number>();
  p.days.forEach((x, i) => rowOf.set(x, i));
  for (let m = 0; m < k; m++) {
    const i = rowOf.get(res.disc[m])!;
    const arCell = Number.isNaN(res.ar[m]) ? "(entered in dollars)" : pctText(res.ar[m]);
    const last = mode === "ar-pct" ? pctText(res.inflation[i - 1] / close[i - 1]) : ps(res.drops[m]);
    discRows.push([longDate(res.disc[m]), ps(res.prior[m]), ps(res.discClose[m]), arCell, last]);
  }
  // Window table.
  const winHead = mode === "ar-pct" ? ["Window", "From", "To", "Trading days", "Inflation (% of price)", "Inflation per share"] : ["Window", "From", "To", "Trading days", "Inflation per share"];
  const winRows: string[][] = [winHead];
  // Each row's window once (O(n + k)): the days and the disclosures are both in date order.
  const byWin: number[][] = Array.from({ length: k + 1 }, () => []);
  for (let i = 0, w = 0; i < p.days.length; i++) {
    while (w < k && res.disc[w] <= p.days[i]) w++;
    byWin[w].push(i);
  }
  for (let w = 0; w <= k; w++) {
    const idx = byWin[w];
    if (!idx.length) continue;
    const label = w === k ? "After the final disclosure" : `Window ${w + 1}`;
    const from = longDate(p.days[idx[0]]);
    const to = longDate(p.days[idx[idx.length - 1]]);
    if (mode === "ar-pct") {
      const fr = idx.map((i) => res.inflation[i] / close[i]);
      const dl = idx.map((i) => res.inflation[i]);
      const range = (xs: number[], f: (x: number) => string): string => {
        const lo = xs.reduce((a, b) => (b < a ? b : a), Infinity);
        const hi = xs.reduce((a, b) => (b > a ? b : a), -Infinity);
        return f(lo) === f(hi) ? f(lo) : `${f(lo)} to ${f(hi)}`;
      };
      winRows.push([label, from, to, String(idx.length), range(fr, (x) => pctText(x)), range(dl, ps)]);
    } else winRows.push([label, from, to, String(idx.length), ps(res.inflation[idx[0]])]);
  }
  const totalDrop = res.drops.reduce((s, x) => s + x, 0);
  const lines = [
    `Securities inflation ribbon (${mode === "ar-pct" ? "constant percentage" : "constant dollar"}), computed from the inputs given`,
    mode === "ar-pct"
      ? `Inflation on ${longDate(start)} (the class-period start, the price table's first day): ${pctText(res.inflation[0] / close[0])} of the close, ${ps(res.inflation[0])} per share; ${k} corrective disclosure${k === 1 ? "" : "s"}.`
      : `Inflation per share on ${longDate(start)} (the class-period start, the price table's first day): ${ps(res.inflation[0])}; ${k} corrective disclosure${k === 1 ? "" : "s"} removing ${ps(totalDrop)} per share in all.`,
    `The class period runs ${longDate(start)} to ${longDate(res.disc[k - 1] - 1)}, the day before the final disclosure.`,
    RIBBON_CONVENTIONS[mode],
    mode === "dollar" ? "" : `Abnormal returns read in ${percentIn ? "percent (−8.5 is −8.5%)" : "decimals (−0.085 is −8.5%)"}; for example, the CAR of each disclosure from Stats ▸ “Securities event study (market model)”, which prints them in percent.`,
    "Per-share amounts are not rounded (shown to at most four decimals). The abnormal returns are the user's inputs: this ribbon does not estimate them.",
    mode !== "ar-pct" ? "The disclosure table (date and inflation removed per share) is the input of “Securities: out-of-pocket loss (FIFO/LIFO)” and “Securities: aggregate damages (trading model)”." : "",
    ...noteLines(notes),
  ].filter(Boolean);
  const xs = p.days.map(decimalYear);
  const svg = finPlotSvg(
    [
      { points: xs.map((x, i) => ({ x, y: close[i] })), type: "line", color: "#2563eb", label: "close" },
      { points: xs.map((x, i) => ({ x, y: close[i] - res.inflation[i] })), type: "line", color: "#b45309", label: "close less inflation" },
    ],
    { width: 380, height: 250, title: "Inflation ribbon (from the inputs given)", xlabel: "date (year)", ylabel: "price per share ($)" },
  );
  const tables: FinTable[] = [
    { label: "Corrective disclosures", rows: discRows, align: ["left", "right", "right", "right", "right"] },
    { label: "Inflation by window", rows: winRows, align: ["left", "left", "left", "right", "right", "right"].slice(0, winHead.length) as FinTable["align"] },
  ];
  return { text: lines.join("\n"), svg, tables };
}

// ---------------------------------------------------------------------------------------------------------------
// (b) Out-of-pocket loss from a trade blotter, FIFO or LIFO
// ---------------------------------------------------------------------------------------------------------------

export interface Trade {
  day: number;
  buy: boolean;
  shares: number;
  price: number;
  /** 1-based data row in the blotter. */
  row: number;
}

export interface Lot {
  /** Purchase day (null: held before the class period, from the opening-holdings field). */
  day: number | null;
  price: number;
  row: number;
  left: number;
}

export interface Match {
  buyDay: number | null;
  buyRow: number;
  /** Sale day, or null when still held at the end of the blotter. */
  sellDay: number | null;
  shares: number;
}

/**
 * FIFO or LIFO matching of a blotter (already in date order, same-day trades in the pasted order). Opening holdings
 * form the oldest lot. A sale draws on the lots bought on or before its row; a sale beyond the holdings is refused.
 */
export function matchTrades(trades: Trade[], opening: number, method: "fifo" | "lifo"): { matches: Match[] } | { error: string } {
  const lots: Lot[] = [];
  if (opening > 0) lots.push({ day: null, price: NaN, row: 0, left: opening });
  const matches: Match[] = [];
  for (const t of trades) {
    if (t.buy) {
      lots.push({ day: t.day, price: t.price, row: t.row, left: t.shares });
      continue;
    }
    let need = t.shares;
    while (need > 0) {
      // Skip exhausted lots at the end being drawn from.
      while (lots.length && lots[method === "fifo" ? 0 : lots.length - 1].left <= 0) {
        if (method === "fifo") lots.shift();
        else lots.pop();
      }
      if (!lots.length) {
        return { error: `Blotter row ${t.row} (${longDate(t.day)}): the sale of ${dmgQty(t.shares)} shares is more than the shares held then (short sales are outside this calculator).` };
      }
      const lot = lots[method === "fifo" ? 0 : lots.length - 1];
      const take = Math.min(need, lot.left);
      matches.push({ buyDay: lot.day, buyRow: lot.row, sellDay: t.day, shares: take });
      lot.left -= take;
      need -= take;
      // Fractional shares: a residue below a millionth of a share is rounding, not a holding.
      if (need < 1e-9) need = 0;
      if (lot.left < 1e-9) lot.left = 0;
    }
  }
  for (const lot of lots) if (lot.left > 0) matches.push({ buyDay: lot.day, buyRow: lot.row, sellDay: null, shares: lot.left });
  return { matches };
}

const BUY_WORDS = /^(buy|bought|purchase|purchased|p|b)$/i;
const SELL_WORDS = /^(sell|sold|sale|s)$/i;

/** The blotter: date, buy/sell, shares, price per share; in date order (same-day rows keep their order). */
function readBlotter(text: string): { trades: Trade[]; notes: string[] } | { error: string } {
  const what = "The trade blotter";
  const raw = text ?? "";
  if (!raw.trim()) return { error: `${what} is empty: one trade per row, date, Buy or Sell, shares, price per share.` };
  const foreign = foreignCurrencyRefusal(raw, what);
  if (foreign) return { error: foreign };
  const parsed = parseRegData(whitespaceTable(stripDollarMarks(raw)));
  if (!parsed.ok) return { error: `${what}: ${parsed.reason}` };
  const data = parsed.data;
  // A first row of four dates/words (a header) is skipped by parseRegData; a headerless table's first row is data.
  let rows = data.rows;
  if (data.named) {
    const first = data.names;
    // parseRegData reads a row with no number as a header; a trade row always has numbers, so this IS a header,
    // unless its first cell is a date (a sale of a word count?) – checked below as a trade if so.
    if (typeof parseDateField(first[0], "date") === "number") rows = [first, ...rows];
  }
  if (data.names.length !== 4) {
    return { error: `${what} has ${data.names.length} columns; it takes exactly four: date, Buy or Sell, shares, price per share.` };
  }
  if (rows.length > MAX_TRADES) return { error: `${what} has ${rows.length.toLocaleString("en-US")} trades; the most is ${MAX_TRADES.toLocaleString("en-US")}.` };
  if (!rows.length) return { error: `${what} has no trades.` };
  const days: number[] = [];
  const sides: boolean[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = parseDateField(r[0] ?? "", `date on blotter row ${i + 1}`);
    if (typeof d !== "number") return { error: d.error };
    days.push(d);
    const side = (r[1] ?? "").trim();
    if (BUY_WORDS.test(side)) sides.push(true);
    else if (SELL_WORDS.test(side)) sides.push(false);
    else return { error: `Blotter row ${i + 1}: ${q(side || "(empty)")} is not Buy or Sell.` };
    for (const [j, nm] of [[2, "shares"], [3, "price"]] as const) {
      if (isMissingCell(r[j] ?? "")) return { error: `Blotter row ${i + 1} has no ${nm}.` };
    }
  }
  const ds: RegDataset = { names: ["shares", "price"], rows: rows.map((r) => [r[2], r[3]]), named: true, semicolon: data.semicolon };
  const sel = selectColumns(ds, { dep: "shares", preds: ["price"], text: "" });
  if (!sel.ok) return { error: `${what}: ${sel.reason.replace(/^Column “shares”, row (\d+)/, "Row $1, shares").replace(/^Column “price”, row (\d+)/, "Row $1, price")}` };
  const sh = sel.cols.y;
  const pr = sel.cols.X[0];
  const trades: Trade[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!(sh[i] > 0)) return { error: `Blotter row ${i + 1}: the shares (${dmgQty(sh[i])}) must be positive.` };
    if (sh[i] > MAX_SHARES) return { error: `Blotter row ${i + 1}: more than one trillion shares is outside this calculator.` };
    if (!(pr[i] > 0)) return { error: `Blotter row ${i + 1}: the price (${ps(pr[i])}) must be positive.` };
    if (pr[i] > MAX_PRICE) return { error: `Blotter row ${i + 1}: a price above ${usd("1,000,000")} is outside this calculator.` };
    trades.push({ day: days[i], buy: sides[i], shares: sh[i], price: pr[i], row: i + 1 });
  }
  const notes = sel.cols.notes.filter((n) => !/% sign/.test(n));
  const sorted = trades.map((t, i) => ({ t, i })).sort((a, b) => a.t.day - b.t.day || a.i - b.i).map((x) => x.t);
  if (sorted.some((t, i) => t !== trades[i])) notes.push("The blotter was put in date order; trades on the same day keep their pasted order.");
  return { trades: sorted, notes };
}

/** (b) Out-of-pocket loss per share by purchase/sale window, and the matched blotter. */
export function secOutOfPocketCalc(r: Read): FinResult {
  const method = r("match");
  if (method !== "fifo" && method !== "lifo") return finRefusal(`Unknown matching method ${q(method)}.`);
  const start = parseDateField(r("start"), "class-period start date");
  if (typeof start !== "number") return finRefusal(start.error);
  const dt = readDropTable(r("disclosures"), start);
  if ("error" in dt) return finRefusal(dt.error);
  const { disc, drops } = dt;
  const k = disc.length;
  const infl = windowInflation(drops);
  const opening = numberField(r, "held", "shares held before the class period");
  if (typeof opening !== "number") return finRefusal(opening ? opening.error : "Enter the shares held before the class period.");
  if (opening < 0) return finRefusal("The shares held before the class period cannot be negative.");
  if (opening > MAX_SHARES) return finRefusal("More than one trillion shares held is outside this calculator.");
  const b = readBlotter(r("blotter"));
  if ("error" in b) return finRefusal(b.error);
  const m = matchTrades(b.trades, opening, method);
  if ("error" in m) return finRefusal(m.error);
  const classEnd = disc[k - 1] - 1;

  const winOf = (day: number | null): number => (day === null || day < start ? -1 : windowOf(day, disc));
  const rows: string[][] = [["Bought", "Sold", "Shares", "Windows (bought → sold)", "Loss per share", "Loss"]];
  let totalCents = 0;
  let classShares = 0;
  const byWindow = new Array<number>(k).fill(0);
  let preShares = 0;
  let postShares = 0;
  for (const mt of m.matches) {
    const wb = winOf(mt.buyDay);
    const ws = mt.sellDay === null ? k : windowOf(mt.sellDay, disc);
    const boughtText = mt.buyDay === null ? "Before the class period (held)" : longDate(mt.buyDay);
    const soldText = mt.sellDay === null ? "Still held" : longDate(mt.sellDay);
    if (wb < 0 || wb === k) {
      if (wb < 0) preShares += mt.shares;
      else postShares += mt.shares;
      rows.push([boughtText, soldText, dmgQty(mt.shares), wb < 0 ? "Bought before the class period" : "Bought after the class period", ps(0), dmgMoney(0)]);
      continue;
    }
    const lossPs = infl[wb] - infl[ws];
    const loss = roundCents(lossPs * mt.shares);
    if (!(Math.abs(loss) <= MAX_DOLLARS)) return finRefusal("A lot's loss is above ten trillion dollars, outside this calculator.");
    totalCents += Math.round(loss * 100);
    byWindow[wb] += loss;
    classShares += mt.shares;
    const wsText = ws === k ? (mt.sellDay === null ? "held" : "after") : String(ws + 1);
    rows.push([boughtText, soldText, dmgQty(mt.shares), `${wb + 1} → ${wsText}`, ps(lossPs), dmgMoney(loss)]);
  }
  // Holdings at the end of the class period: opening + buys − sells through the day before the final disclosure.
  let held = opening;
  for (const t of b.trades) if (t.day <= classEnd) held += t.buy ? t.shares : -t.shares;
  if (held < 1e-9) held = 0;

  const winRows: string[][] = [["Bought in", "Sold in", "Inflation when bought", "Inflation when sold", "Loss per share"]];
  for (let i = 0; i < k; i++) {
    for (let j = i; j <= k; j++) {
      winRows.push([
        `Window ${i + 1}`,
        j === k ? "On or after the final disclosure, or held" : `Window ${j + 1}`,
        ps(infl[i]),
        ps(infl[j]),
        ps(infl[i] - infl[j]),
      ]);
    }
  }
  const defRows: string[][] = [["Window", "Dates", "Inflation per share"]];
  for (let w = 0; w <= k; w++) defRows.push([w === k ? "After the class period" : `Window ${w + 1}`, windowRange(w, start, disc), ps(infl[w])]);

  const total = totalCents / 100;
  if (!(total <= MAX_DOLLARS)) return finRefusal("The total loss is above ten trillion dollars, outside this calculator.");
  const lines = [
    `Securities out-of-pocket loss (${method === "fifo" ? "FIFO" : "LIFO"} matching), computed from the inputs given`,
    `Out-of-pocket loss ${dmgMoney(total)} on ${dmgQty(classShares)} share${classShares === 1 ? "" : "s"} bought in the class period (${longDate(start)} to ${longDate(classEnd)}).`,
    `Holdings at the end of the class period (${longDate(classEnd)}): ${dmgQty(held)} share${held === 1 ? "" : "s"}.`,
    `Conventions: ${method === "fifo" ? "FIFO: each sale is matched to the earliest shares still held" : "LIFO: each sale is matched to the most recent shares still held"}, the opening holdings being the oldest lot; trades on the same day in the pasted order. ` +
      "Loss per share = the inflation when bought − the inflation when sold (constant-dollar ribbon from the disclosure table); shares still held, or sold on or after the final disclosure, carry no inflation when sold. " +
      "A trade on a disclosure day falls in the window that disclosure opens. Each lot's loss is rounded to the cent; the total is the sum of the rounded lots.",
    "Not applied here: the PSLRA 90-day lookback cap (15 U.S.C. § 78u-4(e)); apply it per share with “Securities: PSLRA 90-day lookback”. No cap by the trading gain or loss, and no netting of gains, is applied.",
    preShares > 0 ? `${dmgQty(preShares)} share${preShares === 1 ? "" : "s"} bought before the class period (or held at its start) carry no class-period loss; they are matched first under FIFO.` : "",
    postShares > 0 ? `${dmgQty(postShares)} share${postShares === 1 ? "" : "s"} bought on or after the final disclosure carry no loss.` : "",
    ...noteLines([...dt.notes, ...b.notes]),
  ].filter(Boolean);
  const svg = damagesFigure(
    byWindow.map((_, w) => `Window ${w + 1}`),
    [{ name: "loss by purchase window", values: byWindow }],
    "Out-of-pocket loss by purchase window",
  );
  return {
    text: lines.join("\n"),
    svg,
    tables: [
      { label: "Windows", rows: defRows, align: ["left", "left", "right"] },
      { label: "Loss per share by purchase and sale window", rows: winRows, align: ["left", "left", "right", "right", "right"] },
      { label: `Matched lots (${method === "fifo" ? "FIFO" : "LIFO"})`, rows, align: ["left", "left", "right", "left", "right", "right"] },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// (c) PSLRA 90-day lookback, 15 U.S.C. § 78u-4(e)
// ---------------------------------------------------------------------------------------------------------------

export const PSLRA_CITATION = "15 U.S.C. § 78u-4(e)";
/** The statute as supplied verbatim in the release brief (verified text); quoted exactly, never paraphrased. */
export const PSLRA_E1 =
  "Except as provided in paragraph (2), in any private action arising under this chapter in which the plaintiff seeks to establish damages by reference to the market price of a security, the award of damages to the plaintiff shall not exceed the difference between the purchase or sale price paid or received, as appropriate, by the plaintiff for the subject security and the mean trading price of that security during the 90-day period beginning on the date on which the information correcting the misstatement or omission that is the basis for the action is disseminated to the market.";
export const PSLRA_E2 =
  "In any private action arising under this chapter in which the plaintiff seeks to establish damages by reference to the market price of a security, if the plaintiff sells or repurchases the subject security prior to the expiration of the 90-day period described in paragraph (1), the plaintiff's damages shall not exceed the difference between the purchase or sale price paid or received, as appropriate, by the plaintiff for the security and the mean trading price of the security during the period beginning immediately after dissemination of information correcting the misstatement or omission and ending on the date on which the plaintiff sells or repurchases the security.";
export const PSLRA_E3 =
  'For purposes of this subsection, the "mean trading price" of a security shall be an average of the daily trading price of that security, determined as of the close of the market each day during the 90-day period referred to in paragraph (1).';

/** A run of calendar days with no close at the end of the series still accepted as non-trading days (a weekend and a holiday). */
export const END_GAP_DAYS = 3;

export interface LookbackRow {
  day: number;
  close: number;
  /** Calendar day of the period, 1 … 90. */
  dayOfPeriod: number;
  /** Mean of the closes from the disclosure date through this day. */
  mean: number;
}

export interface LookbackResult {
  rows: LookbackRow[];
  periodEnd: number;
  /** The (e)(1) mean, or null when the closes stop short of the period's end. */
  mean90: number | null;
  notes: string[];
}

/** The 90-day lookback table: rolling means of the closes on calendar days D … D + 89. */
export function lookbackTable(days: number[], close: number[], disclosure: number): LookbackResult | { error: string } {
  const periodEnd = disclosure + 89;
  const notes: string[] = [];
  const rows: LookbackRow[] = [];
  let sum = 0;
  let before = 0;
  let after = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i] < disclosure) {
      before++;
      continue;
    }
    if (days[i] > periodEnd) {
      after++;
      continue;
    }
    sum += close[i];
    rows.push({ day: days[i], close: close[i], dayOfPeriod: days[i] - disclosure + 1, mean: sum / (rows.length + 1) });
  }
  if (!rows.length) return { error: `The price table has no close on or after the disclosure date (${longDate(disclosure)}) within the 90-day period (to ${longDate(periodEnd)}).` };
  if (before) notes.push(`${count(before)} close${before === 1 ? "" : "s"} before the disclosure date ${before === 1 ? "was" : "were"} not used.`);
  if (after) notes.push(`${count(after)} close${after === 1 ? "" : "s"} after the 90-day period ${after === 1 ? "was" : "were"} not used.`);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].day - rows[i - 1].day > 5) {
      notes.push(`No close between ${longDate(rows[i - 1].day)} and ${longDate(rows[i].day)}: check for missing trading days (the mean is over the closes given).`);
      break;
    }
  }
  const last = rows[rows.length - 1].day;
  let mean90: number | null = rows[rows.length - 1].mean;
  if (after === 0 && last < periodEnd) {
    if (periodEnd - last > END_GAP_DAYS) mean90 = null;
    else notes.push(`The last close given is ${longDate(last)}; the 90-day period ends ${longDate(periodEnd)}. The days between are taken as non-trading days.`);
  }
  if (rows[0].day > disclosure) notes.push(`No close on the disclosure date itself; the first close used is ${longDate(rows[0].day)}.`);
  return { rows, periodEnd, mean90, notes };
}

/** (c) The PSLRA 90-day lookback from the pane's fields. */
export function pslraLookbackCalc(r: Read): FinResult {
  const disclosure = parseDateField(r("disclosure"), "corrective disclosure date");
  if (typeof disclosure !== "number") return finRefusal(disclosure.error);
  const s = readDaySeries(r("prices"), "The price table", 1);
  if ("error" in s) return finRefusal(s.error);
  const notes = [...s.notes];
  if (s.cols.length > 1) notes.push(`The price table has ${s.cols.length} value columns; the first, ${q(s.names[0])}, was read as the close.`);
  const close = Array.from(s.cols[0]);
  for (let i = 0; i < close.length; i++) {
    if (!(close[i] > 0)) return finRefusal(`The price table, ${longDate(s.days[i])}: the close (${ps(close[i])}) must be positive.`);
    if (close[i] > MAX_PRICE) return finRefusal(`The price table, ${longDate(s.days[i])}: a close above ${usd("1,000,000")} is outside this calculator.`);
  }
  const purchase = numberField(r, "purchase", "purchase price per share", true);
  if (purchase && typeof purchase === "object") return finRefusal(purchase.error);
  if (purchase !== null && !(purchase > 0 && purchase <= MAX_PRICE)) return finRefusal(`The purchase price per share must be positive and at most ${usd("1,000,000")}.`);
  const loss = numberField(r, "loss", "loss per share before the cap", true);
  if (loss && typeof loss === "object") return finRefusal(loss.error);
  if (loss !== null && !(loss >= 0 && loss <= MAX_PRICE)) return finRefusal(`The loss per share before the cap must be zero or more and at most ${usd("1,000,000")}.`);
  if (loss !== null && purchase === null) return finRefusal("Enter the purchase price per share: the cap is the purchase price less the mean trading price.");
  const saleRaw = (r("sale") ?? "").trim();
  let sale: number | null = null;
  if (saleRaw) {
    const sd = parseDateField(saleRaw, "sale date");
    if (typeof sd !== "number") return finRefusal(sd.error);
    if (sd < disclosure) return finRefusal(`The sale date (${longDate(sd)}) is before the disclosure date (${longDate(disclosure)}); the lookback measures sales on or after it. Leave the sale date blank for shares held through the 90 days.`);
    sale = sd;
  }
  const lb = lookbackTable(s.days, close, disclosure);
  if ("error" in lb) return finRefusal(lb.error);
  notes.push(...lb.notes);
  const inE2 = sale !== null && sale <= lb.periodEnd;
  let capMean: number;
  let capRule: string;
  if (inE2) {
    const used = lb.rows.filter((x) => x.day <= sale!);
    if (!used.length) return finRefusal(`No close falls between the disclosure date (${longDate(disclosure)}) and the sale date (${longDate(sale!)}).`);
    const lastClose = lb.rows[lb.rows.length - 1].day;
    if (sale! - lastClose > END_GAP_DAYS && !lb.rows.some((x) => x.day >= sale!)) {
      return finRefusal(`The price table stops on ${longDate(lastClose)}, before the sale date (${longDate(sale!)}); add the closes through the sale date.`);
    }
    capMean = used[used.length - 1].mean;
    capRule = `(e)(2): sold ${longDate(sale!)}, within the 90-day period; mean of the ${used.length} close${used.length === 1 ? "" : "s"} from ${longDate(used[0].day)} through ${longDate(used[used.length - 1].day)}`;
  } else {
    if (lb.mean90 === null) {
      return finRefusal(
        `The price table stops on ${longDate(lb.rows[lb.rows.length - 1].day)}, but the 90-day period runs to ${longDate(lb.periodEnd)}; add the closes through the end of the period (or enter a sale date within it).`,
      );
    }
    capMean = lb.mean90;
    capRule = `(e)(1): ${sale === null ? "held through the 90-day period" : `sold ${longDate(sale)}, after the 90-day period`}; mean of the ${lb.rows.length} close${lb.rows.length === 1 ? "" : "s"} from ${longDate(lb.rows[0].day)} through ${longDate(lb.rows[lb.rows.length - 1].day)}`;
  }
  const head = ["Date", "Day of period", "Close", "Mean trading price to date"];
  if (purchase !== null) head.push("Cap per share if sold that day");
  const rows: string[][] = [head];
  for (const x of lb.rows) {
    const row = [longDate(x.day), String(x.dayOfPeriod), ps(x.close), ps(x.mean)];
    if (purchase !== null) row.push(ps(Math.max(0, purchase - x.mean)));
    rows.push(row);
  }
  const lines = [
    "PSLRA 90-day lookback, computed from the inputs given",
    `The 90-day period: ${longDate(disclosure)} to ${longDate(lb.periodEnd)}.`,
    lb.mean90 !== null ? `Mean trading price over the 90-day period: ${ps(lb.mean90)} (${lb.rows.length} close${lb.rows.length === 1 ? "" : "s"}).` : `Mean trading price over the 90-day period: not available; the closes stop on ${longDate(lb.rows[lb.rows.length - 1].day)}.`,
  ];
  if (purchase !== null) {
    const capPs = purchase - capMean;
    lines.push(`Cap per share = purchase price ${ps(purchase)} − mean trading price ${ps(capMean)} = ${ps(capPs)}${capPs < 0 ? " (below zero: damages per share are capped at zero)" : ""}. Rule ${capRule}.`);
    if (loss !== null) {
      const dps = Math.max(0, Math.min(loss, capPs));
      lines.push(`Damages per share after the cap: ${ps(dps)} (the lesser of the loss per share entered, ${ps(loss)}, and the cap${capPs < 0 ? ", floored at zero" : ""}).`);
    }
  } else lines.push(`Mean trading price for the rule that applies: ${ps(capMean)}. Rule ${capRule}. Enter the purchase price to compute the cap per share.`);
  lines.push(
    "Conventions: the 90-day period is 90 calendar days beginning on the disclosure date (that date is day 1). The mean trading price is the plain average of the closes given for the trading days in it, the disclosure day's close included. " +
      "For a sale within the period, (e)(2)'s period “beginning immediately after dissemination” is read here as starting with the same disclosure-day close, through the close on the sale date. " +
      "The cap is computed for a purchaser (purchase price less the mean); the closes are the user's, and no trading calendar is checked.",
    `${PSLRA_CITATION}(1): “${PSLRA_E1}”`,
    `${PSLRA_CITATION}(2): “${PSLRA_E2}”`,
    `${PSLRA_CITATION}(3): “${PSLRA_E3}”`,
    ...noteLines(notes),
  );
  const xs = lb.rows.map((x) => x.dayOfPeriod);
  const series = [
    { points: lb.rows.map((x, i) => ({ x: xs[i], y: x.close })), type: "line" as const, color: "#2563eb", label: "close" },
    { points: lb.rows.map((x, i) => ({ x: xs[i], y: x.mean })), type: "line" as const, color: "#b45309", label: "mean trading price to date" },
  ];
  if (purchase !== null) series.push({ points: [{ x: 1, y: purchase }, { x: 90, y: purchase }], type: "line" as const, color: "#64748b", label: "purchase price" });
  const svg = lb.rows.length >= 2 ? finPlotSvg(series, { width: 380, height: 250, title: "PSLRA 90-day lookback (from the inputs given)", xlabel: "day of the 90-day period", ylabel: "price per share ($)" }) : undefined;
  return {
    text: lines.join("\n"),
    svg,
    tables: [{ label: "90-day lookback table", rows, align: ["left", "right", "right", "right", "right"].slice(0, head.length) as FinTable["align"] }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// (d) Aggregate damages by a proportional trading model
// ---------------------------------------------------------------------------------------------------------------

export interface TraderGroup {
  /** Share of the float this group holds, and share of the adjusted volume it trades (decimals). */
  floatShare: number;
  volumeShare: number;
}

export interface TradingModelResult {
  /** Damages by purchase window (dollars, unrounded), and the class-bought shares still held at the class end. */
  byWindow: number[];
  retained: number;
  bought: number[];
}

/**
 * The proportional trading model for one group: each day u (in date order) the group sells the fraction
 * t = Vᵤ / F of every block of class-bought shares it holds, then buys Vᵤ new shares, at the inflation of the day's
 * window. Damages of a purchase window = Σ purchases × inflation then − Σ later sales of those shares × inflation then.
 * Shares still held at the class end are valued at zero inflation (the final disclosure removes it).
 */
export function proportionalModel(days: number[], volume: number[], disc: number[], infl: number[], float: number, label: string): TradingModelResult | { error: string } {
  const k = disc.length;
  const H = new Array<number>(k).fill(0);
  const dmg = new Array<number>(k).fill(0);
  const bought = new Array<number>(k).fill(0);
  for (let i = 0; i < days.length; i++) {
    const c = windowOf(days[i], disc);
    if (c >= k) continue;
    const t = volume[i] / float;
    if (!(t < 1)) {
      return { error: `${longDate(days[i])}: the ${label} volume (${dmgQty(volume[i])}) is not below that float (${dmgQty(float)}); a turnover of 100% or more in a day is outside the model. Check the float, the volume reduction and the trader shares.` };
    }
    for (let w = 0; w <= c; w++) {
      const sold = H[w] * t;
      H[w] -= sold;
      dmg[w] -= sold * infl[c];
    }
    H[c] += volume[i];
    bought[c] += volume[i];
    dmg[c] += volume[i] * infl[c];
  }
  return { byWindow: dmg, retained: H.reduce((s, x) => s + x, 0), bought };
}

/** (d) Aggregate damages, one-trader and/or two-trader proportional model. */
export function secAggregateCalc(r: Read): FinResult {
  const model = r("model");
  if (model !== "both" && model !== "one" && model !== "two") return finRefusal(`Unknown trading model ${q(model)}.`);
  const start = parseDateField(r("start"), "class-period start date");
  if (typeof start !== "number") return finRefusal(start.error);
  const dt = readDropTable(r("disclosures"), start);
  if ("error" in dt) return finRefusal(dt.error);
  const { disc, drops } = dt;
  const k = disc.length;
  const infl = windowInflation(drops);
  const fl = numberField(r, "float", "float (shares)");
  if (typeof fl !== "number") return finRefusal(fl ? fl.error : "Enter the float (shares).");
  if (!(fl > 0) || fl > MAX_SHARES) return finRefusal("The float must be positive and at most one trillion shares.");
  const red = numberField(r, "reduction", "volume reduction %");
  if (typeof red !== "number") return finRefusal(red ? red.error : "Enter the volume reduction %.");
  if (!(red >= 0 && red < 100)) return finRefusal("The volume reduction must be at least 0% and below 100%.");
  let aF = NaN;
  let aV = NaN;
  if (model !== "one") {
    const a = numberField(r, "activeFloat", "active traders' share of the float %");
    if (typeof a !== "number") return finRefusal(a ? a.error : "Enter the active traders' share of the float %.");
    const v = numberField(r, "activeVolume", "active traders' share of the volume %");
    if (typeof v !== "number") return finRefusal(v ? v.error : "Enter the active traders' share of the volume %.");
    if (!(a > 0 && a < 100)) return finRefusal("The active traders' share of the float must be above 0% and below 100%.");
    if (!(v > 0 && v < 100)) return finRefusal("The active traders' share of the volume must be above 0% and below 100%.");
    aF = a / 100;
    aV = v / 100;
  }
  const vs = readDaySeries(r("volume"), "The volume table", 1);
  if ("error" in vs) return finRefusal(vs.error);
  const notes = [...vs.notes];
  if (vs.cols.length > 1) notes.push(`The volume table has ${vs.cols.length} value columns; the first, ${q(vs.names[0])}, was read as the reported volume.`);
  if (vs.percent[0]) return finRefusal(`The volume table: ${q(vs.names[0])} is in percent; enter the reported volume in shares.`);
  const classEnd = disc[k - 1] - 1;
  const days: number[] = [];
  const vol: number[] = [];
  let before = 0;
  let after = 0;
  for (let i = 0; i < vs.days.length; i++) {
    const v = vs.cols[0][i];
    if (!(v >= 0)) return finRefusal(`The volume table, ${longDate(vs.days[i])}: the volume (${dmgQty(v)}) cannot be negative.`);
    if (v > MAX_SHARES) return finRefusal(`The volume table, ${longDate(vs.days[i])}: a volume above one trillion shares is outside this calculator.`);
    if (vs.days[i] < start) before++;
    else if (vs.days[i] > classEnd) after++;
    else {
      days.push(vs.days[i]);
      vol.push(v * (1 - red / 100));
    }
  }
  if (!days.length) return finRefusal(`The volume table has no trading day in the class period (${longDate(start)} to ${longDate(classEnd)}).`);
  if (before) notes.push(`${count(before)} volume row${before === 1 ? "" : "s"} before the class period ${before === 1 ? "was" : "were"} not used.`);
  if (after) notes.push(`${count(after)} volume row${after === 1 ? "" : "s"} on or after the final disclosure ${after === 1 ? "was" : "were"} not used (shares sold then carry no inflation).`);

  let one: TradingModelResult | null = null;
  let two: TradingModelResult | null = null;
  if (model !== "two") {
    const res = proportionalModel(days, vol, disc, infl, fl, "adjusted");
    if ("error" in res) return finRefusal(res.error);
    one = res;
  }
  if (model !== "one") {
    const A = proportionalModel(days, vol.map((v) => v * aV), disc, infl, fl * aF, "active traders'");
    if ("error" in A) return finRefusal(A.error);
    const P = proportionalModel(days, vol.map((v) => v * (1 - aV)), disc, infl, fl * (1 - aF), "other traders'");
    if ("error" in P) return finRefusal(P.error);
    two = { byWindow: A.byWindow.map((x, w) => x + P.byWindow[w]), retained: A.retained + P.retained, bought: A.bought.map((x, w) => x + P.bought[w]) };
  }
  const centsOf = (xs: number[]): number => xs.reduce((s, x) => s + Math.round(roundCents(x) * 100), 0);
  for (const res of [one, two]) {
    if (res && !res.byWindow.every((x) => Math.abs(x) <= MAX_DOLLARS)) return finRefusal("A window's damages are above ten trillion dollars, outside this calculator.");
    if (res && !(Math.abs(centsOf(res.byWindow)) <= MAX_DOLLARS * 100)) return finRefusal("The total damages are above ten trillion dollars, outside this calculator.");
  }
  const bought = (one ?? two)!.bought;
  const head = ["Purchase window", "Inflation per share", "Adjusted volume bought"];
  if (one) head.push("One-trader damages");
  if (two) head.push("Two-trader damages");
  const rows: string[][] = [head];
  for (let w = 0; w < k; w++) {
    const row = [`Window ${w + 1} (${windowRange(w, start, disc)})`, ps(infl[w]), dmgQty(bought[w])];
    if (one) row.push(dmgMoney(one.byWindow[w]));
    if (two) row.push(dmgMoney(two.byWindow[w]));
    rows.push(row);
  }
  const totRow = ["Total", "", dmgQty(bought.reduce((s, x) => s + x, 0))];
  if (one) totRow.push(dmgMoney(centsOf(one.byWindow) / 100));
  if (two) totRow.push(dmgMoney(centsOf(two.byWindow) / 100));
  rows.push(totRow);
  const pct = (x: number): string => `${Number(x.toFixed(4))}%`;
  const lines = [
    "Securities aggregate damages: TRADING MODEL ESTIMATE, computed from the inputs given",
    "This is a model, not a count of claims: proportional trading models (one-trader and two-trader) assume how shares changed hands, and courts have criticised them as unreliable measures of class-wide damages. Claims data, not this model, show who actually traded.",
  ];
  if (one) lines.push(`One-trader (proportional) model: ${dmgMoney(centsOf(one.byWindow) / 100)}; class-bought shares still held at the class end: ${dmgQty(one.retained)}.`);
  if (two) lines.push(`Two-trader model: ${dmgMoney(centsOf(two.byWindow) / 100)}; class-bought shares still held at the class end: ${dmgQty(two.retained)}.`);
  lines.push(
    `Parameters: float ${dmgQty(fl)} shares; volume reduction ${pct(red)} (adjusted volume = reported × ${Number((1 - red / 100).toFixed(6))}); ` +
      (two ? `active traders hold ${pct(aF * 100)} of the float (${dmgQty(fl * aF)} shares) and make ${pct(aV * 100)} of the adjusted volume, the other traders hold ${pct((1 - aF) * 100)} and make ${pct((1 - aV) * 100)}; ` : "") +
      `class period ${longDate(start)} to ${longDate(classEnd)} (${days.length} trading days in the volume table); ${k} disclosure${k === 1 ? "" : "s"}, inflation per share by window as tabled.`,
    "Conventions: proportional model. Each trading day, a group sells the same fraction (its adjusted volume ÷ its float) of every block of class-period shares it holds, then buys its adjusted volume as new shares; every share bought in the class is a purchase at the day's window inflation, and every sale of such a share removes the inflation of the day it is sold. " +
      "Damages = Σ purchases × inflation then − Σ sales of class-bought shares × inflation then; shares held at the class end carry no inflation (the final disclosure removed it). " +
      "Two-trader: the float and adjusted volume are split between active and other traders as entered, each group follows the proportional model on its own float and volume, and the damages are the sum. " +
      "The formulas are this calculator's stated model; inflation per share is the constant-dollar ribbon from the disclosure table. Each window's damages are rounded to the cent; totals are sums of the rounded windows.",
    ...noteLines([...dt.notes, ...notes]),
  );
  const series: { name: string; values: number[] }[] = [];
  if (one) series.push({ name: "one-trader", values: one.byWindow.map((x) => roundCents(x)) });
  if (two) series.push({ name: "two-trader", values: two.byWindow.map((x) => roundCents(x)) });
  // Side by side, not stacked: the two models are alternatives, so the figure draws one model (the first chosen).
  const svg = damagesFigure(
    bought.map((_, w) => `Window ${w + 1}`),
    series.slice(0, 1),
    `Aggregate damages by purchase window, ${one ? "one-trader" : "two-trader"} model`,
  );
  return {
    text: lines.join("\n"),
    svg,
    tables: [{ label: "Aggregate damages by purchase window (trading model)", rows, align: ["left", "right", "right", "right", "right"].slice(0, head.length) as FinTable["align"] }],
  };
}

// Kept for the oracle tests: the day arithmetic the windows use.
export const _internals = { windowOf, windowInflation, civilDay, civilFromDay };
