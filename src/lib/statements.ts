/**
 * Financial-statement analysis (release F1, gap item #13): a pasted statement read into named line items, then the
 * ratio suite, DuPont 3- and 5-step, the cash conversion cycle, common-size and trend statements, the Altman Z-score
 * variants, and break-even / cost-volume-profit. Pure: no Office.js, no DOM.
 *
 * Line items are recognized by EXACT name after normalizing case, punctuation and "&" (a fixed list of synonyms per
 * item, LINE_ITEMS below); nothing is matched fuzzily. Lines whose names are not on the list are reported back by name
 * as not used, never guessed at; two lines naming the same item are refused.
 */
import { readDataBlock } from "./dataBlock";

// ---------------------------------------------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------------------------------------------

export type ItemKey =
  | "revenue"
  | "cogs"
  | "grossProfit"
  | "opex"
  | "ebit"
  | "interest"
  | "ebt"
  | "tax"
  | "netIncome"
  | "depreciation"
  | "cash"
  | "securities"
  | "receivables"
  | "inventory"
  | "currentAssets"
  | "totalAssets"
  | "payables"
  | "currentLiabilities"
  | "longTermDebt"
  | "totalLiabilities"
  | "equity"
  | "retainedEarnings"
  | "marketEquity";

export type Section = "income" | "balance" | "market";

/** Display name, statement section, and the accepted names (normalized: lower case, letters/digits and single spaces). */
export const LINE_ITEMS: { key: ItemKey; name: string; section: Section; names: string[] }[] = [
  { key: "revenue", name: "Revenue", section: "income", names: ["revenue", "revenues", "sales", "net sales", "total revenue", "total revenues", "net revenue", "net revenues", "turnover"] },
  { key: "cogs", name: "Cost of goods sold", section: "income", names: ["cost of goods sold", "cogs", "cost of sales", "cost of revenue", "cost of revenues"] },
  { key: "grossProfit", name: "Gross profit", section: "income", names: ["gross profit", "gross margin", "gross loss", "gross profit loss"] },
  { key: "opex", name: "Operating expenses", section: "income", names: ["operating expenses", "total operating expenses", "sga", "sg and a", "selling general and administrative", "selling general and administrative expenses"] },
  {
    key: "ebit",
    name: "Operating income (EBIT)",
    section: "income",
    names: ["operating income", "operating profit", "ebit", "income from operations", "operating income ebit", "operating loss", "loss from operations", "operating income loss", "income loss from operations", "operating profit loss"],
  },
  { key: "interest", name: "Interest expense", section: "income", names: ["interest expense", "interest", "finance costs", "interest expense net"] },
  {
    key: "ebt",
    name: "Income before tax",
    section: "income",
    names: [
      "income before tax",
      "income before taxes",
      "income before income taxes",
      "pretax income",
      "pre tax income",
      "earnings before tax",
      "ebt",
      "profit before tax",
      "loss before tax",
      "loss before taxes",
      "loss before income taxes",
      "pretax loss",
      "pre tax loss",
      "income loss before income taxes",
      "income loss before taxes",
      "profit loss before tax",
    ],
  },
  { key: "tax", name: "Income tax expense", section: "income", names: ["income tax expense", "income taxes", "income tax", "tax expense", "provision for income taxes", "taxes"] },
  {
    key: "netIncome",
    name: "Net income",
    section: "income",
    names: ["net income", "net profit", "net earnings", "profit for the year", "net income loss", "net loss", "net loss for the year", "loss for the year", "net profit loss", "profit loss for the year", "net earnings loss"],
  },
  { key: "depreciation", name: "Depreciation and amortization", section: "income", names: ["depreciation", "depreciation and amortization", "depreciation and amortization", "d and a"] },
  { key: "cash", name: "Cash and equivalents", section: "balance", names: ["cash", "cash and equivalents", "cash and cash equivalents"] },
  { key: "securities", name: "Marketable securities", section: "balance", names: ["marketable securities", "short term investments", "short term investment"] },
  { key: "receivables", name: "Accounts receivable", section: "balance", names: ["accounts receivable", "receivables", "accounts receivable net", "trade receivables", "trade and other receivables"] },
  { key: "inventory", name: "Inventory", section: "balance", names: ["inventory", "inventories"] },
  { key: "currentAssets", name: "Total current assets", section: "balance", names: ["current assets", "total current assets"] },
  { key: "totalAssets", name: "Total assets", section: "balance", names: ["total assets", "assets"] },
  { key: "payables", name: "Accounts payable", section: "balance", names: ["accounts payable", "payables", "trade payables", "trade and other payables"] },
  { key: "currentLiabilities", name: "Total current liabilities", section: "balance", names: ["current liabilities", "total current liabilities"] },
  { key: "longTermDebt", name: "Long-term debt", section: "balance", names: ["long term debt", "long term borrowings", "long term debt net"] },
  { key: "totalLiabilities", name: "Total liabilities", section: "balance", names: ["total liabilities", "liabilities"] },
  { key: "equity", name: "Shareholders’ equity", section: "balance", names: ["equity", "total equity", "shareholders equity", "stockholders equity", "total shareholders equity", "total stockholders equity", "owners equity"] },
  { key: "retainedEarnings", name: "Retained earnings", section: "balance", names: ["retained earnings", "accumulated deficit", "retained earnings accumulated deficit"] },
  { key: "marketEquity", name: "Market value of equity", section: "market", names: ["market value of equity", "market capitalization", "market capitalization", "market cap"] },
];

const BY_NAME = new Map<string, (typeof LINE_ITEMS)[number]>();
for (const it of LINE_ITEMS) for (const n of it.names) BY_NAME.set(n, it);

/**
 * Names that themselves denote a loss or deficit (matched on the EXACT normalized name, never a substring): the amount
 * on such a line is a loss, stored as −|amount| whatever its typed sign, and the result says so. A combined name
 * ("Net income (loss)" → "net income loss", "Retained earnings (accumulated deficit)") keeps the signed amount as typed.
 */
export const LOSS_NAMES = new Set([
  "gross loss",
  "operating loss",
  "loss from operations",
  "loss before tax",
  "loss before taxes",
  "loss before income taxes",
  "pretax loss",
  "pre tax loss",
  "net loss",
  "net loss for the year",
  "loss for the year",
  "accumulated deficit",
]);
for (const n of LOSS_NAMES) if (!BY_NAME.has(n)) throw new Error(`loss name not in LINE_ITEMS: ${n}`);
export const ITEM_NAME: Record<ItemKey, string> = Object.fromEntries(LINE_ITEMS.map((x) => [x.key, x.name])) as Record<ItemKey, string>;

/** Lower case; "&" → "and"; apostrophes dropped; any other non-letter/digit run → one space. */
export function normaliseItemName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface StatementLine {
  label: string;
  line: number;
  key: ItemKey | null;
  current: number | null;
  prior: number | null;
}

export interface Statement {
  lines: StatementLine[];
  /** Recognized items by key. */
  items: Map<ItemKey, StatementLine>;
  unknown: StatementLine[];
  hasPrior: boolean;
  /** The header's column names, when the first line was one. */
  header: string[] | null;
  notes: string[];
}

/** An amount as typed: signs, a currency symbol and parentheses in either order around digits with , and . (and %). */
const NUMERIC_TOKEN = /^[-+−–]?[$€£¥]?[-+−–]?\(?[-+−–]?[$€£¥]?[-+−–]?[\d.,]*\d[\d.,]*([eE][-+−]?\d+)?%?\)?$/;
/** A missing amount: blank, a dash of any kind alone (hyphen, minus, en dash, em dash), NA, N/A. */
const MISSING_TOKEN = /^(|-|−|–|—|na|n\/a)$/i;
/** A year column heading: 2023, (2023), FY2023, FY 2023, CY2023, 2023A/E/P, FY23, FY’23. */
const isYear = (t: string): boolean => /^\(?(?:(?:FY|CY)\s?['’]?)?(?:19|20)\d\d[AEP]?\)?$/i.test(t) || /^\(?(?:FY|CY)['’]?\d\d\)?$/i.test(t);
/** A number with a unit suffix the reader does not scale: 50k, 1.2m, 3bn, 4 million. */
const UNIT_SUFFIX = /^\(?[-+−–]?[$€£¥]?\d[\d.,]*(k|m|mm|mn|bn|b|thousand|thousands|million|millions|billion|billions)\)?$/i;
const MAX_STATEMENT_LINES = 200;

/** An amount for a note: grouped, true minus. */
function amountText(x: number): string {
  const s = x.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
/** An item name inside a sentence: "Net income" → "net income", "Operating income (EBIT)" keeps its acronym. */
const inSentence = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * One amount token, read in the US style: comma = thousands separator (groups of exactly three digits), point =
 * decimal; parentheses or a minus for a negative; one leading currency symbol. Returns a plain decimal string for the
 * shared reader, or why the token is refused (the caller quotes the token as typed).
 */
export function usAmount(tok: string): { value: string; paren: boolean; symbol: boolean } | { why: string } {
  if (tok.includes("%")) return { why: "is a percentage; a statement line takes amounts, not percentages" };
  let s = tok;
  let neg = false;
  let sign = false;
  let paren = false;
  let symbol = false;
  const takeSigns = (): boolean => {
    for (let guard = 0; guard < 4; guard++) {
      if (/^[-+−–]/.test(s)) {
        if (sign) return false;
        sign = true;
        neg = s[0] !== "+";
        s = s.slice(1);
      } else if (/^[$€£¥]/.test(s)) {
        if (symbol) return false;
        symbol = true;
        s = s.slice(1);
      } else break;
    }
    return true;
  };
  const garbled = { why: "is not an amount (more than one sign or currency symbol)" };
  if (!takeSigns()) return garbled;
  if (s.startsWith("(") || s.endsWith(")")) {
    if (!(s.startsWith("(") && s.endsWith(")"))) return { why: "has an unmatched parenthesis" };
    paren = true;
    s = s.slice(1, -1);
    if (!takeSigns()) return garbled;
  }
  if (paren && sign) return { why: "has both parentheses and a sign; write a negative amount one way, (1,000) or −1,000" };
  let plain: string;
  if (/^(\d+(\.\d*)?|\.\d+)([eE][-+−]?\d+)?$/.test(s)) plain = s.replace("−", "-");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) plain = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s))
    return { why: `is in the European style (point = thousands, comma = decimal); a statement is read in the US style (comma = thousands, point = decimal): write ${s.replace(/\./g, "#").replace(",", ".").replace(/#/g, ",")}` };
  else if (/^\d+,\d+$/.test(s)) return { why: "has a comma that is not a thousands separator (the US style groups digits in threes, 1,234.5); for a decimal write it with a point" };
  else return { why: "is not an amount" };
  const value = (paren || neg ? "-" : "") + plain;
  if (!Number.isFinite(Number(value))) return { why: "is not a finite number" };
  return { value, paren, symbol };
}

/**
 * Reads "line item, amount[, prior-year amount]" rows. The amounts go through readDataBlock (RULE N); this function
 * only takes the words off each row first (mapRow) and reads each amount token in the US style (usAmount: thousands
 * commas, (1,234) for a negative, a leading currency symbol), handing the shared reader a plain decimal. A line whose
 * name denotes a loss (LOSS_NAMES) is stored as a negative amount, and noted.
 */
export function readStatement(text: string, what = "Statement"): Statement | { error: string } {
  const labels = new Map<number, string>();
  const typed = new Map<number, string[]>();
  const noAmountWhy = new Map<number, string>();
  let header: string[] | null = null;
  let first = true;
  let parens = false;
  let symbols = false;
  let tooMany = "";
  let refusal = "";
  const src = (text ?? "").replace(/\r\n?/g, "\n");
  const cellMode = src.includes("\t") || src.includes(";");
  const commaMode = !cellMode && !/\s/.test(src.replace(/\n/g, ""));
  const b = readDataBlock(text, what, {
    maxRows: MAX_STATEMENT_LINES,
    noHeader: true,
    mapRow: (fields, line) => {
      // trailing empty cells (a tab row with no prior year) are nothing; an empty or "-" cell BETWEEN the label and a
      // number is a missing amount ("Revenue<tab><tab>900" or "Revenue - 900": no current-year amount)
      const f = fields.slice();
      while (f.length && f[f.length - 1] === "") f.pop();
      let cut = f.length;
      while (cut > 0 && f.length - cut < 2 && (NUMERIC_TOKEN.test(f[cut - 1]) || MISSING_TOKEN.test(f[cut - 1]))) cut--;
      const words = f.slice(0, cut).filter((x) => x !== "");
      const raw = f.slice(cut);
      const nums = raw.map((x) => (MISSING_TOKEN.test(x) ? "-" : x));
      const label = words.join(" ").trim();
      if (first) {
        first = false;
        const allYears = nums.length > 0 && nums.every((x) => isYear(x));
        const known = BY_NAME.has(normaliseItemName(label));
        // a header has no amounts (or only year columns) and no digits in its words: "Revenue 1e400x" is a bad
        // data line, not a header to drop silently
        const digitsInWords = words.some((w) => /\d/.test(w) && !isYear(w));
        if (!known && !digitsInWords && (!nums.some((x) => x !== "-") || allYears)) {
          header = f;
          return null;
        }
      }
      const where = `${what}, line ${line} (“${label || f.join(" ")}”)`;
      // text after the amounts (a "Notes" column): an amount-shaped token inside the words, followed by more words
      // (between spaces only a grouped, symbol or bracketed amount counts: "Notes 5.25% due 2027" is a name)
      const amountShaped = (w: string): boolean => NUMERIC_TOKEN.test(w) && (cellMode || (/[,$€£¥()]/.test(w) && !w.includes("%")));
      const k0 = words.findIndex((w, k) => k > 0 && amountShaped(w) && words.slice(k + 1).some((x) => !NUMERIC_TOKEN.test(x) && !MISSING_TOKEN.test(x)));
      if (k0 > 0 && !refusal) {
        const k1 = words.findIndex((x, k) => k > k0 && !NUMERIC_TOKEN.test(x) && !MISSING_TOKEN.test(x));
        const extra = [...words.slice(k1), ...raw].join(" ");
        refusal = `${what}, line ${line} (“${words[0]}”): text after the amounts (“${extra}”) is an extra column; remove it (a statement line is: line item, amount, prior-year amount).`;
      }
      if (!nums.some((x) => x !== "-")) {
        const last = words[words.length - 1] ?? "";
        const unit = words.find((w, k) => k > 0 && UNIT_SUFFIX.test(w));
        if (unit) noAmountWhy.set(line, `“${unit}”: a unit suffix (k, m, bn, million) is not read; write the amount in full, or name the units in a header line`);
        else if (words.length > 1 && isYear(last)) noAmountWhy.set(line, `this looks like a header row (year columns), and only the first line may be a header`);
      }
      if (words.length && NUMERIC_TOKEN.test(words[words.length - 1]) && nums.every((x) => x !== "-")) tooMany ||= `line ${line}`;
      if (commaMode && nums.length === 2 && /^\d{3}(\.\d+)?$/.test(nums[1]) && !refusal)
        refusal = `${where}: “${raw.join(",")}” could be one amount with a thousands comma or two amounts; separate the columns with tabs or spaces.`;
      labels.set(line, label);
      typed.set(line, raw);
      return nums.map((x) => {
        if (x === "-") return x;
        const a = usAmount(x);
        if ("why" in a) {
          refusal ||= `${where}: “${x}” ${a.why}.`;
          return "-";
        }
        if (a.paren) parens = true;
        if (a.symbol) symbols = true;
        return a.value;
      });
    },
  });
  if (refusal) return { error: refusal };
  if (!b.ok) return { error: b.error };
  if (tooMany) return { error: `${what}, ${tooMany}: at most two amounts per line (this year, then the prior year), and a line-item name must not end in a number.` };
  const lines: StatementLine[] = [];
  const lossNotes: string[] = [];
  for (let r = 0; r < b.rows.length; r++) {
    const line = b.lines[r];
    const label = labels.get(line) ?? "";
    const row = b.rows[r];
    if (!label) return { error: `${what}, line ${line}: no line-item name before the amount.` };
    if (row.length === 0) return { error: `${what}, line ${line} (“${label}”): no amount${noAmountWhy.has(line) ? `: ${noAmountWhy.get(line)}` : ""}.` };
    if (row.length > 2) return { error: `${what}, line ${line} (“${label}”): at most two amounts (this year, then the prior year).` };
    for (const v of row) if (v !== null && !Number.isFinite(v)) return { error: `${what}, line ${line} (“${label}”): an amount is not a finite number.` };
    const norm = normaliseItemName(label);
    const it = BY_NAME.get(norm);
    let current = row[0] ?? null;
    let prior = row.length > 1 ? row[1] : null;
    if (it && LOSS_NAMES.has(norm) && (current || prior)) {
      // a loss line: the amount is a loss whatever its typed sign
      const neg = (v: number | null): number | null => (v === null || v === 0 ? v : -Math.abs(v));
      current = neg(current);
      prior = neg(prior);
      const t = (typed.get(line) ?? []).filter((x) => !MISSING_TOKEN.test(x));
      lossNotes.push(
        `“${label} ${t.join(" ")}” read as ${inSentence(it.name)} ${current !== null ? amountText(current) : "(blank)"}${prior !== null ? ` (prior year ${amountText(prior)})` : ""}: a line named as a loss is a negative amount`,
      );
    }
    lines.push({ label, line, key: it ? it.key : null, current, prior });
  }
  const items = new Map<ItemKey, StatementLine>();
  for (const l of lines) {
    if (!l.key) continue;
    const prev = items.get(l.key);
    if (prev) return { error: `${what}: lines ${prev.line} (“${prev.label}”) and ${l.line} (“${l.label}”) both give ${ITEM_NAME[l.key]}; keep one.` };
    items.set(l.key, l);
  }
  // a header fixes the number of amount columns: a line with more is a number inside a name, or a stray column
  const hdr = header as string[] | null;
  if (hdr && hdr.length - 1 === 1) {
    const two = lines.find((l) => l.prior !== null);
    if (two) return { error: `${what}, line ${two.line} (“${two.label}”): two amounts, but the header names one amount column. Write a number inside a line-item name in words, or add the prior-year column to the header.` };
  }
  const notes = [...b.notes, ...lossNotes.map((s) => `${what}: ${s}.`)];
  // no header to say how many columns there are, and only some lines carry a second amount: say which, not guess
  const withPrior = lines.filter((l) => l.prior !== null);
  if (!hdr && withPrior.length && withPrior.length < lines.length / 2)
    notes.push(`${what}: only line${withPrior.length === 1 ? "" : "s"} ${withPrior.map((l) => l.line).join(", ")} ha${withPrior.length === 1 ? "s" : "ve"} a second (prior-year) amount; check that no number in a line-item name was read as an amount.`);
  if (parens) notes.push(`${what}: amounts in parentheses were read as negative.`);
  if (symbols) notes.push(`${what}: currency symbols were ignored (amounts are read as plain numbers).`);
  return { lines, items, unknown: lines.filter((l) => !l.key), hasPrior: lines.some((l) => l.prior !== null), header, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// Ratios
// ---------------------------------------------------------------------------------------------------------------

export type Period = "current" | "prior";

/** One computed figure, or the reason it is not. */
export type Figure = { ok: true; value: number } | { ok: false; why: string };

export interface RatioOptions {
  /** Days in the year for the day counts (365 or 360). */
  days: number;
  /** Balance-sheet denominators: the year-end balance, or the average of this and the prior year-end. */
  balances: "end" | "average";
}

export interface RatioDef {
  category: "Liquidity" | "Leverage" | "Efficiency" | "Profitability";
  name: string;
  formula: string;
  /** "×", "%", "days" */
  unit: "times" | "%" | "days";
}

/** Statement access for one period: income items as given, balance items year-end or averaged. */
export class Book {
  constructor(
    private st: Statement,
    private period: Period,
    private opts: RatioOptions,
  ) {}
  /** Raw value of an item for this period. */
  raw(k: ItemKey): Figure {
    const l = this.st.items.get(k);
    const v = l ? (this.period === "current" ? l.current : l.prior) : null;
    if (v === null || v === undefined) return { ok: false, why: `needs ${ITEM_NAME[k]}${l && this.period === "prior" ? " for the prior year" : ""}` };
    return { ok: true, value: v };
  }
  /** An item, derived where the statement allows (gross profit, EBIT, EBT, total liabilities). */
  item(k: ItemKey): Figure {
    const r = this.raw(k);
    if (r.ok) return r;
    const d = (a: Figure, b: Figure, f: (x: number, y: number) => number): Figure => (a.ok && b.ok ? { ok: true, value: f(a.value, b.value) } : r);
    if (k === "grossProfit") return d(this.raw("revenue"), this.raw("cogs"), (x, y) => x - y);
    if (k === "ebt") return d(this.raw("netIncome"), this.raw("tax"), (x, y) => x + y);
    if (k === "ebit") {
      const ebt = this.item("ebt");
      return d(ebt, this.raw("interest"), (x, y) => x + y);
    }
    if (k === "totalLiabilities") return d(this.raw("totalAssets"), this.raw("equity"), (x, y) => x - y);
    return r;
  }
  /** A balance-sheet denominator: year-end, or the average with the prior year (current period only). */
  bal(k: ItemKey): Figure {
    const now = this.item(k);
    if (this.opts.balances === "end" || this.period === "prior" || !now.ok) return now;
    const before = new Book(this.st, "prior", this.opts).item(k);
    if (!before.ok) return { ok: false, why: `needs the prior-year ${ITEM_NAME[k]} for an average balance` };
    return { ok: true, value: (now.value + before.value) / 2 };
  }
}

const div = (a: Figure, b: Figure, bName: string): Figure => {
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (b.value === 0) return { ok: false, why: `${bName} is 0` };
  const v = a.value / b.value;
  return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, why: "the amounts are too large to divide" };
};
const sum = (...xs: Figure[]): Figure => {
  for (const x of xs) if (!x.ok) return x;
  return { ok: true, value: xs.reduce((a, x) => a + (x as { value: number }).value, 0) };
};

export interface RatioRow extends RatioDef {
  current: Figure;
  prior: Figure | null;
}

/** The ratio suite for both periods (prior only when the statement has a prior-year column). */
export function ratioSuite(st: Statement, opts: RatioOptions): RatioRow[] {
  const avg = opts.balances === "average" && st.hasPrior;
  const B = (s: string): string => (avg ? `average ${s}` : s);
  const D = opts.days;
  const defs: (RatioDef & { f: (b: Book) => Figure })[] = [
    { category: "Liquidity", name: "Current ratio", formula: "current assets ÷ current liabilities", unit: "times", f: (b) => div(b.item("currentAssets"), b.item("currentLiabilities"), "current liabilities") },
    {
      category: "Liquidity",
      name: "Quick ratio",
      formula: "(cash + marketable securities + receivables) ÷ current liabilities",
      unit: "times",
      f: (b) => {
        const sec = b.raw("securities");
        return div(sum(b.item("cash"), sec.ok ? sec : { ok: true, value: 0 }, b.item("receivables")), b.item("currentLiabilities"), "current liabilities");
      },
    },
    {
      category: "Liquidity",
      name: "Cash ratio",
      formula: "(cash + marketable securities) ÷ current liabilities",
      unit: "times",
      f: (b) => {
        const sec = b.raw("securities");
        return div(sum(b.item("cash"), sec.ok ? sec : { ok: true, value: 0 }), b.item("currentLiabilities"), "current liabilities");
      },
    },
    { category: "Leverage", name: "Debt ratio", formula: "total liabilities ÷ total assets", unit: "times", f: (b) => div(b.item("totalLiabilities"), b.item("totalAssets"), "total assets") },
    { category: "Leverage", name: "Debt-to-equity", formula: "total liabilities ÷ shareholders’ equity", unit: "times", f: (b) => div(b.item("totalLiabilities"), b.item("equity"), "equity") },
    { category: "Leverage", name: "Equity multiplier", formula: `${B("total assets")} ÷ ${B("equity")}`, unit: "times", f: (b) => div(b.bal("totalAssets"), b.bal("equity"), "equity") },
    { category: "Leverage", name: "Interest coverage", formula: "EBIT ÷ interest expense", unit: "times", f: (b) => div(b.item("ebit"), b.item("interest"), "interest expense") },
    { category: "Efficiency", name: "Asset turnover", formula: `revenue ÷ ${B("total assets")}`, unit: "times", f: (b) => div(b.item("revenue"), b.bal("totalAssets"), "total assets") },
    { category: "Efficiency", name: "Inventory turnover", formula: `cost of goods sold ÷ ${B("inventory")}`, unit: "times", f: (b) => div(b.item("cogs"), b.bal("inventory"), "inventory") },
    { category: "Efficiency", name: "Days inventory outstanding", formula: `${D} × ${B("inventory")} ÷ cost of goods sold`, unit: "days", f: (b) => mulK(div(b.bal("inventory"), b.item("cogs"), "cost of goods sold"), D) },
    { category: "Efficiency", name: "Receivables turnover", formula: `revenue ÷ ${B("receivables")}`, unit: "times", f: (b) => div(b.item("revenue"), b.bal("receivables"), "receivables") },
    { category: "Efficiency", name: "Days sales outstanding", formula: `${D} × ${B("receivables")} ÷ revenue`, unit: "days", f: (b) => mulK(div(b.bal("receivables"), b.item("revenue"), "revenue"), D) },
    { category: "Efficiency", name: "Payables turnover", formula: `cost of goods sold ÷ ${B("payables")}`, unit: "times", f: (b) => div(b.item("cogs"), b.bal("payables"), "payables") },
    { category: "Efficiency", name: "Days payables outstanding", formula: `${D} × ${B("payables")} ÷ cost of goods sold`, unit: "days", f: (b) => mulK(div(b.bal("payables"), b.item("cogs"), "cost of goods sold"), D) },
    {
      category: "Efficiency",
      name: "Cash conversion cycle",
      formula: "DIO + DSO − DPO",
      unit: "days",
      f: (b) => {
        const dio = mulK(div(b.bal("inventory"), b.item("cogs"), "cost of goods sold"), D);
        const dso = mulK(div(b.bal("receivables"), b.item("revenue"), "revenue"), D);
        const dpo = mulK(div(b.bal("payables"), b.item("cogs"), "cost of goods sold"), D);
        const s = sum(dio, dso);
        return s.ok && dpo.ok ? { ok: true, value: s.value - dpo.value } : !s.ok ? s : dpo;
      },
    },
    { category: "Profitability", name: "Gross margin", formula: "gross profit ÷ revenue", unit: "%", f: (b) => div(b.item("grossProfit"), b.item("revenue"), "revenue") },
    { category: "Profitability", name: "Operating margin", formula: "EBIT ÷ revenue", unit: "%", f: (b) => div(b.item("ebit"), b.item("revenue"), "revenue") },
    { category: "Profitability", name: "Net margin", formula: "net income ÷ revenue", unit: "%", f: (b) => div(b.item("netIncome"), b.item("revenue"), "revenue") },
    { category: "Profitability", name: "Return on assets", formula: `net income ÷ ${B("total assets")}`, unit: "%", f: (b) => div(b.item("netIncome"), b.bal("totalAssets"), "total assets") },
    { category: "Profitability", name: "Return on equity", formula: `net income ÷ ${B("equity")}`, unit: "%", f: (b) => div(b.item("netIncome"), b.bal("equity"), "equity") },
  ];
  return defs.map(({ f, ...d }) => ({
    ...d,
    current: f(new Book(st, "current", opts)),
    prior: st.hasPrior ? f(new Book(st, "prior", { ...opts, balances: "end" })) : null,
  }));
}

function mulK(x: Figure, k: number): Figure {
  return x.ok ? { ok: true, value: x.value * k } : x;
}

export interface DuPont {
  three: { label: string; formula: string; value: Figure }[];
  five: { label: string; formula: string; value: Figure }[];
  roe: Figure;
}

/** DuPont 3-step (margin × turnover × multiplier) and 5-step (tax burden × interest burden × EBIT margin × turnover × multiplier). */
export function duPont(st: Statement, opts: RatioOptions): DuPont {
  const b = new Book(st, "current", opts);
  const avg = opts.balances === "average" && st.hasPrior;
  const A = avg ? "average total assets" : "total assets";
  const E = avg ? "average equity" : "equity";
  const rev = b.item("revenue");
  const ni = b.item("netIncome");
  const ta = b.bal("totalAssets");
  const eq = b.bal("equity");
  const ebt = b.item("ebt");
  const ebit = b.item("ebit");
  return {
    three: [
      { label: "Net margin", formula: "net income ÷ revenue", value: div(ni, rev, "revenue") },
      { label: "Asset turnover", formula: `revenue ÷ ${A}`, value: div(rev, ta, "total assets") },
      { label: "Equity multiplier", formula: `${A} ÷ ${E}`, value: div(ta, eq, "equity") },
    ],
    five: [
      { label: "Tax burden", formula: "net income ÷ income before tax", value: div(ni, ebt, "income before tax") },
      { label: "Interest burden", formula: "income before tax ÷ EBIT", value: div(ebt, ebit, "EBIT") },
      { label: "EBIT margin", formula: "EBIT ÷ revenue", value: div(ebit, rev, "revenue") },
      { label: "Asset turnover", formula: `revenue ÷ ${A}`, value: div(rev, ta, "total assets") },
      { label: "Equity multiplier", formula: `${A} ÷ ${E}`, value: div(ta, eq, "equity") },
    ],
    roe: div(ni, eq, "equity"),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Altman Z
// ---------------------------------------------------------------------------------------------------------------

export type AltmanVariant = "z" | "zprime" | "zdouble";

export interface AltmanResult {
  variant: AltmanVariant;
  x: { name: string; formula: string; value: number; coef: number }[];
  z: number;
  zone: "safe" | "grey" | "distress";
  cutoffs: [number, number];
}

/**
 * Altman Z-scores, coefficients as published:
 *   z        Altman (1968), "Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy",
 *            Journal of Finance 23(4): public manufacturing firms; Z = 1.2X₁ + 1.4X₂ + 3.3X₃ + 0.6X₄ + 1.0X₅ with X₄ the
 *            MARKET value of equity ÷ total liabilities (the paper's own form, 0.012X₁ + 0.014X₂ + 0.033X₃ + 0.006X₄ +
 *            0.999X₅, takes X₁–X₄ in percent); zones above 2.99 / 1.81 to 2.99 / below 1.81.
 *   zprime   Z′ for private firms, X₄ on BOOK equity: 0.717X₁ + 0.847X₂ + 3.107X₃ + 0.420X₄ + 0.998X₅; gray area 1.23 to 2.90.
 *   zdouble  Z″ for non-manufacturers, no sales term, X₄ on book equity: 6.56X₁ + 3.26X₂ + 6.72X₃ + 1.05X₄; zones 2.60 / 1.10
 *            (the emerging-market constant +3.25 is not added).
 * Checked 2026-10-27 against Altman (2000), "Predicting Financial Distress of Companies: Revisiting the Z-Score and ZETA®
 * Models" (NYU Stern, July 2000): both forms of the 1968 function and why they differ, the 1.81 lower bound, the Z′
 * coefficients and its 1.23 to 2.90 gray area, the Z″ coefficients and the +3.25 emerging-market constant. NOT in that
 * paper (conventional values, printed as such): the 2.99 upper bound for Z and Z″'s 1.10 / 2.60 cut-offs.
 */
export function altmanZ(st: Statement, variant: AltmanVariant): AltmanResult | { error: string } {
  const b = new Book(st, "current", { days: 365, balances: "end" });
  const need = (k: ItemKey): number | string => {
    const f = b.item(k);
    return f.ok ? f.value : `Altman Z ${f.why}.`;
  };
  const ta = need("totalAssets");
  const ca = need("currentAssets");
  const cl = need("currentLiabilities");
  const re = need("retainedEarnings");
  const ebit = need("ebit");
  const tl = need("totalLiabilities");
  for (const v of [ta, ca, cl, re, ebit, tl]) if (typeof v === "string") return { error: v };
  const eqKey: ItemKey = variant === "z" ? "marketEquity" : "equity";
  const eq = need(eqKey);
  if (typeof eq === "string") return { error: variant === "z" ? "Altman Z (original) needs the Market value of equity (shares × price); for book equity choose Z′ or Z″." : eq };
  const sales = variant === "zdouble" ? 0 : need("revenue");
  if (typeof sales === "string") return { error: sales };
  if (ta === 0) return { error: "Altman Z: total assets is 0." };
  if (tl === 0) return { error: "Altman Z: total liabilities is 0, so X₄ (equity ÷ total liabilities) has no value." };
  const T = ta as number;
  const coefs = variant === "z" ? [1.2, 1.4, 3.3, 0.6, 1.0] : variant === "zprime" ? [0.717, 0.847, 3.107, 0.42, 0.998] : [6.56, 3.26, 6.72, 1.05];
  const xs = [
    { name: "X₁", formula: "working capital ÷ total assets", value: ((ca as number) - (cl as number)) / T },
    { name: "X₂", formula: "retained earnings ÷ total assets", value: (re as number) / T },
    { name: "X₃", formula: "EBIT ÷ total assets", value: (ebit as number) / T },
    { name: "X₄", formula: `${variant === "z" ? "market" : "book"} value of equity ÷ total liabilities`, value: (eq as number) / (tl as number) },
    { name: "X₅", formula: "sales ÷ total assets", value: (sales as number) / T },
  ].slice(0, coefs.length);
  const x = xs.map((v, i) => ({ ...v, coef: coefs[i] }));
  const z = x.reduce((a, v) => a + v.coef * v.value, 0);
  if (!x.every((v) => Number.isFinite(v.value)) || !Number.isFinite(z)) return { error: "Altman Z: the amounts are too large to divide." };
  const cutoffs: [number, number] = variant === "z" ? [1.81, 2.99] : variant === "zprime" ? [1.23, 2.9] : [1.1, 2.6];
  const zone = z > cutoffs[1] ? "safe" : z < cutoffs[0] ? "distress" : "grey";
  return { variant, x, z, zone, cutoffs };
}

// ---------------------------------------------------------------------------------------------------------------
// Break-even / CVP
// ---------------------------------------------------------------------------------------------------------------

export interface CvpInput {
  price: number;
  variableCost: number;
  fixedCosts: number;
  units: number;
  targetProfit?: number;
}

export interface CvpResult {
  cmUnit: number;
  cmRatio: number;
  breakEvenUnits: number;
  breakEvenRevenue: number;
  revenue: number;
  totalCost: number;
  operatingIncome: number;
  marginOfSafetyUnits: number;
  marginOfSafetyRevenue: number;
  marginOfSafetyPct: number;
  /** Degree of operating leverage, contribution ÷ operating income; null at zero operating income. */
  dol: number | null;
  targetUnits: number | null;
}

export function cvp(inp: CvpInput): CvpResult | { error: string } {
  const { price, variableCost: v, fixedCosts: F, units } = inp;
  const cmUnit = price - v;
  if (!(cmUnit > 0)) return { error: "Selling price must exceed variable cost per unit: with no positive contribution margin there is no break-even point." };
  const breakEvenUnits = F / cmUnit;
  const revenue = price * units;
  const totalCost = F + v * units;
  const operatingIncome = revenue - totalCost;
  const contribution = cmUnit * units;
  const out: CvpResult = {
    cmUnit,
    cmRatio: cmUnit / price,
    breakEvenUnits,
    breakEvenRevenue: breakEvenUnits * price,
    revenue,
    totalCost,
    operatingIncome,
    marginOfSafetyUnits: units - breakEvenUnits,
    marginOfSafetyRevenue: (units - breakEvenUnits) * price,
    marginOfSafetyPct: units > 0 ? (units - breakEvenUnits) / units : NaN,
    dol: operatingIncome !== 0 ? contribution / operatingIncome : null,
    targetUnits: inp.targetProfit !== undefined ? (F + inp.targetProfit) / cmUnit : null,
  };
  const nums = [out.cmRatio, out.breakEvenUnits, out.breakEvenRevenue, revenue, totalCost, operatingIncome, out.marginOfSafetyRevenue, out.targetUnits ?? 0, out.dol ?? 0];
  if (!nums.every(Number.isFinite)) return { error: "The amounts are too large to compute with." };
  return out;
}
