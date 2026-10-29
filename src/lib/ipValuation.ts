/**
 * IP valuation (Release F1, v2.202.0, gap item #1): relief-from-royalty with an optional tax amortization benefit, a
 * simplified income approach (multi-period excess earnings) with an obsolescence curve, and a Monte Carlo patent NPV.
 * Pure: no Office.js, no DOM, so jest imports it; ipValuationCalcs.ts wires the pane's fields to these functions.
 *
 * CURRENCY. Currency-neutral like the rest of Finance: amounts are bare grouped numbers unless the optional ISO 4217
 * "Currency" field names a code, which is checked against the bundled ISO 4217 list (currency.ts) and then printed with
 * currencyAmount() in the text and in the table headers. Decimals follow the code's ISO minor units (JPY 0, BHD 3;
 * 2 when blank or when the list gives none).
 *
 * CONVENTIONS (printed in every result's "Conventions:" line; mirrored by scripts/ipval-oracle.py):
 *  - Remaining life L years (0 < L ≤ 50): year k (k = 1 … ⌈L⌉) covers w_k = min(1, L − (k − 1)) of a year; a final
 *    partial year's revenue is taken pro rata (× w_k).
 *  - Discount time τ_k: mid-year τ_k = (k − 1) + w_k/2, end-of-year τ_k = (k − 1) + w_k; discount factor 1/(1 + d)^τ_k at
 *    the annual effective rate d. Valuation date = start of year 1.
 *  - Attrition / obsolescence survival s_k, evaluated at the middle of each year's segment m_k = (k − 1) + w_k/2:
 *    none s_k = 1; straight-line to zero at the end of the remaining life s_k = 1 − m_k/L; % decay a a year
 *    s_k = (1 − a)^m_k.
 *  - Relief-from-royalty: royalty saved = revenue × w_k × s_k × royalty rate; tax = royalty saved × tax rate; PV of the
 *    after-tax royalty saved. TAB factor = 1/(1 − t × A/n), A = Σ_{j=1…n} 1/(1 + d)^τ_j over the n-year amortization
 *    period with the same timing convention (the convention used in valuation practice; no authority is cited).
 *  - Monte Carlo: PCG32 (prng.ts, stream 54) seeded by the Seed field; uniforms u = (r + 0.5)/2³² from successive
 *    32-bit outputs r; triangular by inverse CDF (one u); lognormal from P10/P90 (median √(P10 × P90), σ of ln =
 *    ln(P90/P10)/(2 × 1.2815515655446004)) with a Box–Muller normal √(−2 ln u₁) cos(2πu₂) (two u); a fixed input uses no
 *    u. Draw order per sample: revenue, royalty rate, life, discount rate. Quantiles by linear interpolation between
 *    order statistics (Hyndman–Fan type 7, numpy's default); SD with divisor n − 1.
 */
import { readFinanceField } from "./finance";
import { readDataBlock } from "./dataBlock";
import { oneGroupedNumber, readNumberList } from "./numberList";
import { currentFinFig, finPlotSvg } from "./financeFigures";
import { buildChartPreviewSvg, type TableChart } from "./tablechart";
import { ISO4217, ISO4217_DATE, ISO4217_SOURCE, NOT_A_CURRENCY, currencyAmount } from "./currency";
import { Pcg32, PCG_MAX_SEED, PCG_STREAM } from "./prng";
import type { FinResult, FinTable } from "./finCalc";

type Read = (k: string) => string;
type Align = "left" | "center" | "right";

/** The longest remaining life / forecast handled, in years. */
export const IPV_MAX_YEARS = 50;
/** Every input amount and every computed amount is at most one trillion. */
export const IPV_MAX_AMOUNT = 1e12;
/** Most Monte Carlo samples. */
export const IPV_MAX_SAMPLES = 100000;
/** Fewest Monte Carlo samples. */
export const IPV_MIN_SAMPLES = 1000;
/** Monte Carlo work budget: samples × years of the longest possible life (100,000 × 40 or 80,000 × 50; ≤ 300 ms at the cap). */
export const IPV_WORK_BUDGET = 4_000_000;
/** Φ⁻¹(0.9), for the lognormal from P10 and P90. */
export const Z90 = 1.2815515655446004;

// ---------------------------------------------------------------------------
// Reading and formatting
// ---------------------------------------------------------------------------

/** A refusal carried through the engine. */
export interface Refusal {
  error: string;
}
export const isRefusal = (x: unknown): x is Refusal => typeof x === "object" && x !== null && "error" in x;

const q = (s: string): string => `“${s.length > 40 ? s.slice(0, 40) + "…" : s}”`;

export interface NumOpts {
  min?: number;
  max?: number;
  /** The minimum itself is refused. */
  minExclusive?: boolean;
  maxExclusive?: boolean;
  integer?: boolean;
  /** How the range reads in a refusal ("more than 0% and at most 100%"). */
  range?: string;
}

/**
 * One number field. The pane hands compute plain decimal text for a field it could read and the raw text otherwise,
 * so the value is read again here through the product's one reader and every non-number (blank, "abc", 1e400) is
 * refused by the field's label.
 */
export function readNum(raw: string, label: string, o: NumOpts = {}): number | Refusal {
  const t = (raw ?? "").trim();
  if (!t) return { error: `${label}: enter a number.` };
  const v = readFinanceField(t);
  if (!Number.isFinite(v)) return { error: `${label}: ${q(t)} is not a number this calculator can use.` };
  const range = o.range ? ` (${o.range})` : "";
  if (o.integer && !Number.isInteger(v)) return { error: `${label} must be a whole number${range}; ${q(t)} is not.` };
  if (o.min !== undefined && (o.minExclusive ? !(v > o.min) : !(v >= o.min))) return { error: `${label} is out of range${range}: ${q(t)}.` };
  if (o.max !== undefined && (o.maxExclusive ? !(v < o.max) : !(v <= o.max))) return { error: `${label} is out of range${range}: ${q(t)}.` };
  return v;
}

/** The optional ISO 4217 code: blank → none; anything else must be a current ISO 4217 currency code. */
export interface Currency {
  code: string | null;
  minor: number;
}
export function readCurrency(raw: string): Currency | Refusal {
  const t = (raw ?? "").trim();
  if (!t) return { code: null, minor: 2 };
  const c = t.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return { error: `Currency: ${q(t)} is not a three-letter ISO 4217 code (EUR, USD, JPY …); leave it blank for bare numbers.` };
  if (!ISO4217.has(c)) return { error: `Currency: ${c} is not in ISO 4217 (${ISO4217_SOURCE}, the list dated ${ISO4217_DATE}), so it is refused; leave it blank for bare numbers.` };
  if (NOT_A_CURRENCY[c]) return { error: `Currency: ${c} is ${NOT_A_CURRENCY[c]}; it names no currency.` };
  const m = ISO4217.get(c)!.minor;
  return { code: c, minor: m === null ? 2 : m };
}

const NF_CACHE = new Map<number, Intl.NumberFormat>();
function nf(dp: number): Intl.NumberFormat {
  let f = NF_CACHE.get(dp);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    NF_CACHE.set(dp, f);
  }
  return f;
}

/** Grouped fixed decimals, true minus, no negative zero; "—" (the non-finite sentinel) for a non-finite value. */
export function fixedText(x: number, dp: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = nf(dp).format(x);
  if (!s.startsWith("-")) return s;
  return /[1-9]/.test(s) ? "−" + s.slice(1) : s.slice(1);
}

/** An amount as a table cell: bare, in the currency's minor units. */
export const cell = (x: number, cur: Currency): string => fixedText(x, cur.minor);
/** An amount in the text: with the currency when a code was given. */
export const amount = (x: number, cur: Currency): string => (cur.code ? currencyAmount(fixedText(x, cur.minor), cur.code) : fixedText(x, cur.minor));
/** A table header naming the currency when one was given: "Present value (EUR)". */
export const head = (h: string, cur: Currency): string => (cur.code ? `${h} (${cur.code})` : h);
/** A percent typed as a percent (12.5 → "12.5%"), at most four decimals. */
export function pctText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const s = fixedText(p, 4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${s}%`;
}
/** A factor: six decimals. */
export const factorText = (x: number): string => fixedText(x, 6);

function currencyNote(cur: Currency): string {
  return cur.code
    ? `amounts in ${cur.code} (${ISO4217.get(cur.code)!.name}), ${cur.minor} decimal${cur.minor === 1 ? "" : "s"} (ISO 4217 minor units), code checked against the ISO 4217 list dated ${ISO4217_DATE}`
    : "no currency named: amounts are bare numbers in whatever currency the inputs are in, 2 decimals";
}

// ---------------------------------------------------------------------------
// The year grid, survival and discounting
// ---------------------------------------------------------------------------

export type Timing = "mid" | "end";
export type Attrition = "none" | "straight" | "decay";

export interface YearSeg {
  k: number;
  /** The share of year k inside the remaining life. */
  w: number;
  /** The middle of year k's segment. */
  mid: number;
  /** The discount time. */
  tau: number;
}

/** The ⌈L⌉ year segments of a remaining life L. */
export function yearGrid(life: number, timing: Timing): YearSeg[] {
  const n = Math.ceil(life - 1e-12);
  const out: YearSeg[] = [];
  for (let k = 1; k <= n; k++) {
    const w = Math.min(1, life - (k - 1));
    out.push({ k, w, mid: k - 1 + w / 2, tau: timing === "mid" ? k - 1 + w / 2 : k - 1 + w });
  }
  return out;
}

export function survival(seg: YearSeg, life: number, attr: Attrition, decayPct: number): number {
  if (attr === "none") return 1;
  if (attr === "straight") return 1 - seg.mid / life;
  return Math.pow(1 - decayPct / 100, seg.mid);
}

/** Σ_{j=1…n} 1/(1 + d)^τ_j for an n-year annuity of 1 under the timing convention. */
export function annuityFactor(n: number, dPct: number, timing: Timing): number {
  let a = 0;
  for (let j = 1; j <= n; j++) a += Math.pow(1 + dPct / 100, -(timing === "mid" ? j - 0.5 : j));
  return a;
}

/** TAB factor = 1/(1 − t × A/n); a refusal when 1 − t × A/n ≤ 0. */
export function tabFactor(taxPct: number, n: number, dPct: number, timing: Timing): number | Refusal {
  const a = annuityFactor(n, dPct, timing);
  const den = 1 - ((taxPct / 100) * a) / n;
  if (!(den > 0)) return { error: `The tax amortization benefit is undefined here: 1 − t × A/n = ${fixedText(den, 6)} is not positive (tax rate ${pctText(taxPct)}, annuity factor ${factorText(a)} over ${n} years).` };
  return 1 / den;
}

function timingText(t: Timing): string {
  return t === "mid" ? "mid-year discounting, τ = (k − 1) + w/2" : "end-of-year discounting, τ = (k − 1) + w";
}
function attritionText(a: Attrition, decayPct: number, word: string): string {
  if (a === "none") return `no ${word}`;
  if (a === "straight") return `straight-line ${word} to zero at the end of the remaining life, s = 1 − m/L at the middle m of each year`;
  return `${word} by ${pctText(decayPct)} a year, s = (1 − a)ᵐ at the middle m of each year`;
}

/** Reads the forecast block: one row per year, "year, value(s)", years consecutive. */
export interface YearRows {
  years: number[];
  values: number[][];
  notes: string[];
}
export function readYearBlock(text: string, what: string, names: string[], required: number, allowNegative: boolean[]): YearRows | Refusal {
  const b = readDataBlock(text, what, { maxRows: IPV_MAX_YEARS + 20 });
  if (!b.ok) return { error: b.error };
  if (b.rows.length > IPV_MAX_YEARS) return { error: `${what}: more than ${IPV_MAX_YEARS} years is outside this calculator.` };
  const years: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    const line = b.lines[i];
    if (row.some((v) => v === null)) return { error: `${what}, line ${line}: a cell is missing; give the year and ${names.slice(0, required).join(", ")}.` };
    const nums = row as number[];
    if (nums.length < 1 + required) return { error: `${what}, line ${line}: needs the year, then ${names.slice(0, required).join(", ")}.` };
    if (nums.length > 1 + names.length) return { error: `${what}, line ${line}: ${nums.length} numbers, but each row takes the year and at most ${names.length} (${names.join(", ")}).` };
    const y = nums[0];
    if (!Number.isInteger(y) || y < 1900 || y > 2200) return { error: `${what}, line ${line}: the first number (${fixedText(y, 2).replace(/\.00$/, "")}) must be the year, 1900–2200.` };
    if (years.length && y !== years[years.length - 1] + 1) return { error: `${what}, line ${line}: year ${y} does not follow ${years[years.length - 1]}; give one row per year, in order.` };
    const vals = nums.slice(1);
    for (let j = 0; j < vals.length; j++) {
      if (vals[j] < 0 && !allowNegative[j]) return { error: `${what}, line ${line} (${y}): ${names[j]} cannot be negative.` };
      if (Math.abs(vals[j]) > IPV_MAX_AMOUNT) return { error: `${what}, line ${line} (${y}): ${names[j]} is above one trillion, outside this calculator.` };
    }
    while (vals.length < names.length) vals.push(0);
    years.push(y);
    values.push(vals);
  }
  if (!years.length) return { error: `${what}: enter at least one year.` };
  return { years, values, notes: b.notes };
}

/** Stacked columns per year (the damages figure's chart, without its "$"), under the current Finance figure style. */
function yearColumnsSvg(labels: string[], series: { name: string; values: number[] }[], title: string): string | undefined {
  const used = series.filter((s) => s.values.some((v) => v !== 0));
  if (!labels.length || !used.length) return undefined;
  const fig = currentFinFig();
  const chart: TableChart = { categories: labels, series: used, categoryLabel: "Year", hasHeader: false, rows: [], warnings: [] };
  return buildChartPreviewSvg(chart, "stacked-column", title, { patent: fig?.bw === true, grouping: "comma" }, fig?.width ?? 380).svg;
}

const yearLabel = (base: number | null, seg: YearSeg): string => {
  const y = base === null ? `Year ${seg.k}` : String(base + seg.k - 1);
  return seg.w < 1 ? `${y} (${fixedText(seg.w, 2)} yr)` : y;
};

function overAmount(what: string, v: number): Refusal | null {
  return Number.isFinite(v) && Math.abs(v) <= IPV_MAX_AMOUNT ? null : { error: `${what} is above one trillion, outside this calculator.` };
}

// ---------------------------------------------------------------------------
// Relief-from-royalty
// ---------------------------------------------------------------------------

export interface RfrInput {
  /** Full-year revenue for each year k = 1 … (at least ⌈L⌉ entries). */
  revenue: number[];
  /** The calendar year of year 1, or null for "Year 1, Year 2 …". */
  firstYear: number | null;
  royaltyPct: number;
  taxPct: number;
  discountPct: number;
  life: number;
  attrition: Attrition;
  decayPct: number;
  timing: Timing;
  /** Amortization period in whole years for the TAB; 0 = no TAB. */
  tabYears: number;
}
export interface RfrYear {
  seg: YearSeg;
  revenue: number;
  survival: number;
  royalty: number;
  tax: number;
  afterTax: number;
  df: number;
  pv: number;
}
export interface RfrComputed {
  years: RfrYear[];
  pvSum: number;
  tabFactor: number | null;
  tabAmount: number | null;
  value: number;
}

export function computeRfr(inp: RfrInput): RfrComputed | Refusal {
  const segs = yearGrid(inp.life, inp.timing);
  if (inp.revenue.length < segs.length) {
    return { error: `The revenue forecast has ${inp.revenue.length} year${inp.revenue.length === 1 ? "" : "s"}, but the remaining life of ${fixedText(inp.life, 2)} years needs ${segs.length}; add years or shorten the life.` };
  }
  const r = inp.royaltyPct / 100;
  const t = inp.taxPct / 100;
  const years: RfrYear[] = [];
  let pvSum = 0;
  for (const seg of segs) {
    const revenue = inp.revenue[seg.k - 1] * seg.w;
    const s = survival(seg, inp.life, inp.attrition, inp.decayPct);
    const royalty = revenue * s * r;
    const tax = royalty * t;
    const afterTax = royalty - tax;
    const df = Math.pow(1 + inp.discountPct / 100, -seg.tau);
    const pv = afterTax * df;
    pvSum += pv;
    years.push({ seg, revenue, survival: s, royalty, tax, afterTax, df, pv });
  }
  let tf: number | null = null;
  let tabAmount: number | null = null;
  let value = pvSum;
  if (inp.tabYears > 0) {
    const f = tabFactor(inp.taxPct, inp.tabYears, inp.discountPct, inp.timing);
    if (isRefusal(f)) return f;
    tf = f;
    value = pvSum * f;
    tabAmount = value - pvSum;
  }
  const big = overAmount("The value", value);
  if (big) return big;
  return { years, pvSum, tabFactor: tf, tabAmount, value };
}

const ATTR_OPTS: Record<string, Attrition> = { none: "none", straight: "straight", decay: "decay" };

function readTiming(raw: string): Timing {
  return raw === "end" ? "end" : "mid";
}

/** Life, attrition and decay fields, shared by the two deterministic tools. */
function readLifeEtc(read: Read, decayLabel: string): { life: number; attrition: Attrition; decayPct: number } | Refusal {
  const life = readNum(read("life"), "Remaining life (years)", { min: 0, minExclusive: true, max: IPV_MAX_YEARS, range: `more than 0 and at most ${IPV_MAX_YEARS} years` });
  if (isRefusal(life)) return life;
  const attrition = ATTR_OPTS[read("attr")] ?? "none";
  let decayPct = 0;
  if (attrition === "decay") {
    const d = readNum(read("decay"), decayLabel, { min: 0, minExclusive: true, max: 100, maxExclusive: true, range: "more than 0% and less than 100% a year" });
    if (isRefusal(d)) return d;
    decayPct = d;
  }
  return { life, attrition, decayPct };
}

export function rfrCalc(read: Read): FinResult {
  const refuse = (e: Refusal): FinResult => ({ text: e.error, ok: false });
  const cur = readCurrency(read("currency"));
  if (isRefusal(cur)) return refuse(cur);
  const le = readLifeEtc(read, "Attrition (% a year)");
  if (isRefusal(le)) return refuse(le);
  const nYears = Math.ceil(le.life - 1e-12);
  let revenue: number[];
  let firstYear: number | null = null;
  const notes: string[] = [];
  let revenueText: string;
  if (read("mode") === "growth") {
    const base = readNum(read("base"), "First-year revenue", { min: 0, max: IPV_MAX_AMOUNT, range: "0 to one trillion" });
    if (isRefusal(base)) return refuse(base);
    const g = readNum(read("growth"), "Revenue growth (% a year)", { min: -100, minExclusive: true, max: 100, range: "above −100% and at most 100% a year" });
    if (isRefusal(g)) return refuse(g);
    revenue = [];
    for (let k = 0; k < nYears; k++) revenue.push(base * Math.pow(1 + g / 100, k));
    const big = overAmount(`Year ${nYears} revenue`, revenue[nYears - 1]);
    if (big) return refuse(big);
    revenueText = `revenue ${amount(base, cur)} in year 1, growing ${pctText(g)} a year (revenueₖ = R₁ × (1 + g)ᵏ⁻¹)`;
  } else {
    const yb = readYearBlock(read("forecast"), "Revenue forecast", ["revenue"], 1, [false]);
    if (isRefusal(yb)) return refuse(yb);
    revenue = yb.values.map((v) => v[0]);
    firstYear = yb.years[0];
    notes.push(...yb.notes);
    if (revenue.length > nYears) notes.push(`Forecast years after ${firstYear + nYears - 1} are beyond the remaining life and were not used.`);
    revenueText = `revenue as forecast, ${firstYear}–${firstYear + Math.min(revenue.length, nYears) - 1}`;
  }
  const royaltyPct = readNum(read("royalty"), "Royalty rate (%)", { min: 0, minExclusive: true, max: 100, range: "more than 0% and at most 100%" });
  if (isRefusal(royaltyPct)) return refuse(royaltyPct);
  const taxPct = readNum(read("tax"), "Tax rate (%)", { min: 0, max: 100, maxExclusive: true, range: "0% to less than 100%" });
  if (isRefusal(taxPct)) return refuse(taxPct);
  const discountPct = readNum(read("disc"), "Discount rate (%)", { min: 0, max: 100, range: "0% to 100% a year" });
  if (isRefusal(discountPct)) return refuse(discountPct);
  const timing = readTiming(read("timing"));
  let tabYears = 0;
  if (read("tab") === "yes") {
    const n = readNum(read("tabyears"), "Amortization period (years)", { min: 1, max: IPV_MAX_YEARS, integer: true, range: `1 to ${IPV_MAX_YEARS} whole years` });
    if (isRefusal(n)) return refuse(n);
    tabYears = n;
  }
  const c = computeRfr({ revenue, firstYear, royaltyPct, taxPct, discountPct, life: le.life, attrition: le.attrition, decayPct: le.decayPct, timing, tabYears });
  if (isRefusal(c)) return refuse(c);

  const lines = [
    "Relief-from-royalty valuation, computed from the inputs given",
    `Value of the patent: ${amount(c.value, cur)}`,
    `Present value of the after-tax royalty saved: ${amount(c.pvSum, cur)}`,
  ];
  if (c.tabFactor !== null) {
    lines.push(`Tax amortization benefit: ${amount(c.tabAmount!, cur)} (TAB factor ${factorText(c.tabFactor)} over ${tabYears} years)`);
    lines.push(`TAB factor = 1/(1 − t × A/n), A = the sum of the discount factors of years 1 … n (${factorText(annuityFactor(tabYears, discountPct, timing))} here); value = PV × TAB factor.`);
  }
  lines.push(
    `Inputs: ${revenueText}; royalty rate ${pctText(royaltyPct)}; tax rate ${pctText(taxPct)}; discount rate ${pctText(discountPct)} a year; remaining life ${fixedText(le.life, 2)} years.`,
  );
  lines.push("Royalty saved = revenue × w × s × royalty rate; tax = royalty saved × tax rate; PV = (royalty saved − tax) × discount factor, discount factor = 1/(1 + d) raised to the discount time τ.");
  lines.push(
    `Conventions: ${timingText(timing)}, valuation date the start of year 1, annual effective discount rate; ` +
      `a final partial year (w < 1) is taken pro rata; ${attritionText(le.attrition, le.decayPct, "attrition")}; ` +
      (c.tabFactor !== null ? "TAB factor 1/(1 − t × A/n) as used in valuation practice, A with the same timing convention; " : "no tax amortization benefit; ") +
      `${currencyNote(cur)}; amounts computed unrounded and rounded for display.`,
  );
  for (const n of notes) lines.push(`Note: ${n}`);

  const align1: Align[] = ["left", "right", "right", "right", "right", "right"];
  const t1: string[][] = [["Year", head("Revenue", cur), "Survival", head("Royalty saved", cur), head("Tax", cur), head("After tax", cur)]];
  const t2: string[][] = [["Year", "Discount time (years)", "Discount factor", head("Present value", cur), head("Cumulative PV", cur)]];
  let cum = 0;
  let sumRev = 0;
  let sumRoy = 0;
  let sumTax = 0;
  let sumAfter = 0;
  for (const y of c.years) {
    const lab = yearLabel(firstYear, y.seg);
    cum += y.pv;
    sumRev += y.revenue;
    sumRoy += y.royalty;
    sumTax += y.tax;
    sumAfter += y.afterTax;
    t1.push([lab, cell(y.revenue, cur), factorText(y.survival), cell(y.royalty, cur), cell(y.tax, cur), cell(y.afterTax, cur)]);
    t2.push([lab, fixedText(y.seg.tau, 2), factorText(y.df), cell(y.pv, cur), cell(cum, cur)]);
  }
  t1.push(["Total", cell(sumRev, cur), "", cell(sumRoy, cur), cell(sumTax, cur), cell(sumAfter, cur)]);
  t2.push(["Total", "", "", cell(c.pvSum, cur), ""]);
  if (c.tabFactor !== null) {
    t2.push(["TAB", "", factorText(c.tabFactor), cell(c.tabAmount!, cur), ""]);
    t2.push(["Value", "", "", cell(c.value, cur), ""]);
  }
  const tables: FinTable[] = [
    { label: "Royalty saved by year", rows: t1, align: align1 },
    { label: "Present value by year", rows: t2, align: ["left", "right", "right", "right", "right"] },
  ];
  const labels = c.years.map((y) => yearLabel(firstYear, y.seg));
  const svg = yearColumnsSvg(
    labels,
    [
      { name: "Present value", values: c.years.map((y) => y.pv) },
      { name: "Discounting", values: c.years.map((y) => y.afterTax - y.pv) },
      { name: "Tax", values: c.years.map((y) => y.tax) },
    ],
    `Royalty saved by year${cur.code ? ` (${cur.code})` : ""}`,
  );
  return { text: lines.join("\n"), reading: rfrReading(c, cur, le.life, discountPct), tables, svg };
}

/** The plain-language reading of the relief-from-royalty value (lib/calcReading.ts rules). */
export function rfrReading(c: RfrComputed, cur: Currency, life: number, discountPct: number): string {
  const tab = c.tabFactor !== null ? `, including ${amount(c.tabAmount!, cur)} of tax amortization benefit` : "";
  return (
    `On these inputs the patent is worth about ${amount(c.value, cur)}${tab}. ` +
    `That is today's value of the after-tax royalties its owner avoids paying over the remaining ${fixedText(life, 2)} years, discounted at ${pctText(discountPct)} a year.`
  );
}

// ---------------------------------------------------------------------------
// Income approach (multi-period excess earnings, simplified)
// ---------------------------------------------------------------------------

export interface IncomeInput {
  /** Per year k: [incremental cash flow, contributory asset charges]. */
  flows: number[][];
  firstYear: number;
  /** Cash flows are before tax (taxed here) or after tax (not taxed again). */
  preTax: boolean;
  taxPct: number;
  discountPct: number;
  life: number;
  attrition: Attrition;
  decayPct: number;
  timing: Timing;
}
export interface IncomeYear {
  seg: YearSeg;
  excess: number;
  afterTax: number;
  survival: number;
  df: number;
  pv: number;
}
export interface IncomeComputed {
  years: IncomeYear[];
  value: number;
}

export function computeIncome(inp: IncomeInput): IncomeComputed | Refusal {
  const segs = yearGrid(inp.life, inp.timing);
  if (inp.flows.length < segs.length) {
    return { error: `The cash flows cover ${inp.flows.length} year${inp.flows.length === 1 ? "" : "s"}, but the remaining life of ${fixedText(inp.life, 2)} years needs ${segs.length}; add years or shorten the life.` };
  }
  const t = inp.preTax ? inp.taxPct / 100 : 0;
  const years: IncomeYear[] = [];
  let value = 0;
  for (const seg of segs) {
    const [cf, cac] = inp.flows[seg.k - 1];
    const excess = (cf - cac) * seg.w;
    const afterTax = excess - excess * t;
    const s = survival(seg, inp.life, inp.attrition, inp.decayPct);
    const df = Math.pow(1 + inp.discountPct / 100, -seg.tau);
    const pv = afterTax * s * df;
    value += pv;
    years.push({ seg, excess, afterTax, survival: s, df, pv });
  }
  const big = overAmount("The value", value);
  if (big) return big;
  return { years, value };
}

export function incomeCalc(read: Read): FinResult {
  const refuse = (e: Refusal): FinResult => ({ text: e.error, ok: false });
  const cur = readCurrency(read("currency"));
  if (isRefusal(cur)) return refuse(cur);
  const yb = readYearBlock(read("flows"), "Cash flows", ["incremental cash flow", "contributory asset charges"], 1, [true, false]);
  if (isRefusal(yb)) return refuse(yb);
  const le = readLifeEtc(read, "Obsolescence (% a year)");
  if (isRefusal(le)) return refuse(le);
  const preTax = read("basis") !== "after";
  let taxPct = 0;
  if (preTax) {
    const t = readNum(read("tax"), "Tax rate (%)", { min: 0, max: 100, maxExclusive: true, range: "0% to less than 100%" });
    if (isRefusal(t)) return refuse(t);
    taxPct = t;
  }
  const discountPct = readNum(read("disc"), "Discount rate (%)", { min: 0, max: 100, range: "0% to 100% a year" });
  if (isRefusal(discountPct)) return refuse(discountPct);
  const timing = readTiming(read("timing"));
  const c = computeIncome({ flows: yb.values, firstYear: yb.years[0], preTax, taxPct, discountPct, life: le.life, attrition: le.attrition, decayPct: le.decayPct, timing });
  if (isRefusal(c)) return refuse(c);
  const nYears = c.years.length;
  const lines = [
    "Income approach (multi-period excess earnings, simplified), computed from the inputs given",
    `Value of the patent: ${amount(c.value, cur)}`,
    `Inputs: incremental cash flows ${yb.years[0]}–${yb.years[0] + nYears - 1} ${preTax ? `before tax, taxed at ${pctText(taxPct)}` : "after tax (not taxed again)"}; discount rate ${pctText(discountPct)} a year; remaining life ${fixedText(le.life, 2)} years.`,
    `Excess earnings = (incremental cash flow − contributory asset charges) × w; PV = excess earnings${preTax ? " × (1 − t)" : ""} × s × discount factor, discount factor = 1/(1 + d) raised to the discount time τ.`,
    `Conventions: ${timingText(timing)}, valuation date the start of the first year, annual effective discount rate; a final partial year is taken pro rata; ` +
      `${attritionText(le.attrition, le.decayPct, "obsolescence")}; ` +
      (preTax ? "tax applied to negative excess earnings as a credit (symmetrically); " : "") +
      `${currencyNote(cur)}; amounts computed unrounded and rounded for display.`,
  ];
  for (const n of yb.notes) lines.push(`Note: ${n}`);
  if (yb.years.length > nYears) lines.push(`Note: cash-flow years after ${yb.years[0] + nYears - 1} are beyond the remaining life and were not used.`);
  const rows: string[][] = [["Year", head("Excess earnings", cur), head("After tax", cur), "Obsolescence factor", "Discount factor", head("Present value", cur)]];
  let sumEx = 0;
  let sumAt = 0;
  for (const y of c.years) {
    sumEx += y.excess;
    sumAt += y.afterTax;
    rows.push([yearLabel(yb.years[0], y.seg), cell(y.excess, cur), cell(y.afterTax, cur), factorText(y.survival), factorText(y.df), cell(y.pv, cur)]);
  }
  rows.push(["Total", cell(sumEx, cur), cell(sumAt, cur), "", "", cell(c.value, cur)]);
  const labels = c.years.map((y) => yearLabel(yb.years[0], y.seg));
  const allPos = c.years.every((y) => y.afterTax >= 0);
  // Stacked columns when every year is positive; with a negative year, a line of the present values (the column
  // chart's tick labels clip below zero).
  const svg = allPos
    ? yearColumnsSvg(
        labels,
        [
          { name: "Present value", values: c.years.map((y) => y.pv) },
          { name: "Obsolescence", values: c.years.map((y) => y.afterTax * (1 - y.survival)) },
          { name: "Discounting", values: c.years.map((y) => y.afterTax * y.survival - y.pv) },
        ],
        `Excess earnings by year${cur.code ? ` (${cur.code})` : ""}`,
      )
    : finPlotSvg(
        [
          { points: c.years.map((y) => ({ x: yb.years[0] + y.seg.k - 1, y: y.pv })), type: "line", color: "#2563eb", label: "present value" },
          { points: c.years.map((y) => ({ x: yb.years[0] + y.seg.k - 1, y: y.pv })), type: "scatter", color: "#2563eb" },
        ],
        {
          width: 380,
          height: 260,
          title: "Present value of excess earnings by year",
          xlabel: "year",
          ylabel: cur.code ? `present value (${cur.code})` : "present value",
          xTickLabel: (v) => (Number.isInteger(v) ? String(v) : ""),
          yGrouping: "comma",
        },
      );
  return {
    text: lines.join("\n"),
    reading: incomeReading(c, cur, le.life, discountPct),
    tables: [{ label: "Excess earnings by year", rows, align: ["left", "right", "right", "right", "right", "right"] }],
    svg,
  };
}

/** The plain-language reading of the excess-earnings value (lib/calcReading.ts rules). */
export function incomeReading(c: IncomeComputed, cur: Currency, life: number, discountPct: number): string {
  const v = amount(c.value, cur);
  if (c.value < 0)
    return `On these inputs the value comes out negative, ${v}: over the remaining ${fixedText(life, 2)} years the cash flows the patent adds do not cover the charges for the other assets they need.`;
  return (
    `On these inputs the patent is worth about ${v}. ` +
    `That is today's value of the earnings it adds beyond what the other assets need, over the remaining ${fixedText(life, 2)} years, discounted at ${pctText(discountPct)} a year.`
  );
}

// ---------------------------------------------------------------------------
// Monte Carlo patent NPV
// ---------------------------------------------------------------------------

export type DistKind = "tri" | "logn" | "fixed";
export interface Dist {
  kind: DistKind;
  /** tri: [low, mode, high]; logn: [P10, P90]; fixed: [value]. */
  p: number[];
}
export interface McNpvInput {
  revenue: Dist;
  growthPct: number;
  royaltyPct: Dist;
  life: Dist;
  discountPct: Dist;
  taxPct: number;
  cost: number;
  timing: Timing;
  straightLine: boolean;
  samples: number;
  seed: number;
  /**
   * The cap on first-year revenue draws (default one trillion): mcNpvCalc lowers it so the last year's grown revenue
   * stays within one trillion.
   */
  revenueCap?: number;
}
export interface McNpvResult {
  /** The NPV draws in sampling order. */
  draws: Float64Array;
  /** The 0.1 % and 99.9 % points (the histogram's range). */
  p001: number;
  p999: number;
  mean: number;
  sd: number;
  p10: number;
  p50: number;
  p90: number;
  probNeg: number;
  negCount: number;
  /** NPV at the central inputs (mode / median / fixed value). */
  central: number;
  /** Draws set to a cap: [revenue at one trillion, rate at 100%, life at 50 years, discount at 100%]. */
  capped: number[];
}

/** Type-7 quantile of a sorted array (linear interpolation between order statistics, numpy's default). */
export function quantile7(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * The order statistics at the indices `ks` (0-based) of `a`, by successive quickselects (Hoare partition, median of
 * three) on a copy: each selection leaves everything left of index k at most a[k] and everything right at least a[k],
 * so the next, larger index is selected in the part to the right. O(n) per index instead of an O(n log n) sort of
 * 200,000 draws (90 ms under jest).
 */
export function orderStats(a: Float64Array, ks: number[]): Map<number, number> {
  const w = a.slice();
  const out = new Map<number, number>();
  const sortedKs = [...new Set(ks)].sort((x, y) => x - y);
  let lo = 0;
  const last = w.length - 1;
  for (const k of sortedKs) {
    let l = lo;
    let r = last;
    let guard = 0;
    while (r > l) {
      if (++guard > 4 * w.length + 64) throw new Error("orderStats did not converge");
      const m = (l + r) >>> 1;
      const x = w[l];
      const y = w[m];
      const z = w[r];
      const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
      let i = l;
      let j = r;
      while (i <= j) {
        while (w[i] < pivot) i++;
        while (w[j] > pivot) j--;
        if (i <= j) {
          const t = w[i];
          w[i] = w[j];
          w[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) r = j;
      else if (k >= i) l = i;
      else break;
    }
    out.set(k, w[k]);
    lo = k + 1;
  }
  return out;
}

/** Type-7 quantiles of unsorted draws, from orderStats. */
export function quantilesOf(a: Float64Array, ps: number[]): number[] {
  const n = a.length;
  const ks: number[] = [];
  for (const p of ps) {
    const lo = Math.floor((n - 1) * p);
    ks.push(lo, Math.min(n - 1, lo + 1));
  }
  const os = orderStats(a, ks);
  return ps.map((p) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const a0 = os.get(lo)!;
    const a1 = os.get(Math.min(n - 1, lo + 1))!;
    return a0 + (h - lo) * (a1 - a0);
  });
}

const DIST_CAPS = [IPV_MAX_AMOUNT, 100, IPV_MAX_YEARS, 100];

/** The central value of an input: the mode, the median, or the fixed value. */
export function centralOf(d: Dist): number {
  return d.kind === "tri" ? d.p[1] : d.kind === "logn" ? Math.sqrt(d.p[0] * d.p[1]) : d.p[0];
}

/**
 * Bound once at module level: under jest every `Math.x` lookup costs ~100 ns (prng.ts), which at 200,000 samples is
 * most of the budget. The browser is unaffected.
 */
const M_SQRT = Math.sqrt;
const M_POW = Math.pow;
const M_LOG = Math.log;
const M_COS = Math.cos;
const M_EXP = Math.exp;
const M_CEIL = Math.ceil;
const M_FLOOR = Math.floor;
const TWO32 = 4294967296;
const TWO_PI = 2 * Math.PI;

/** NPV for one set of inputs, with the recurrences the Monte Carlo loop uses (shared so the central value matches). */
export function npvOne(rev: number, ratePct: number, life: number, dPct: number, g: number, taxPct: number, cost: number, timing: Timing, straight: boolean): number {
  const v = 1 / (1 + dPct / 100);
  const mid = timing === "mid";
  const hFull = mid ? M_SQRT(v) : v;
  const G = 1 + g / 100;
  const n = M_CEIL(life - 1e-12);
  let vb = 1;
  let gk = 1;
  let s = 0;
  for (let k = 1; k <= n; k++) {
    let w = k < n ? 1 : life - (k - 1);
    if (w > 1) w = 1;
    const df = vb * (w === 1 ? hFull : mid ? M_POW(v, w / 2) : M_POW(v, w));
    const surv = straight ? 1 - (k - 1 + w / 2) / life : 1;
    s += gk * w * surv * df;
    vb *= v;
    gk *= G;
  }
  return rev * (ratePct / 100) * (1 - taxPct / 100) * s - cost;
}

/** One draw of input i (see the file header for the transforms and the order); `cap` counts draws set to the cap. */
interface Pre {
  kind: DistKind;
  a: number;
  b: number;
  fc: number;
  ba: number;
  ca: number;
  bc: number;
  mu: number;
  sigma: number;
  cap: number;
}

function preOf(d: Dist, cap: number): Pre {
  if (d.kind === "tri") {
    const [a, c, b] = d.p;
    return { kind: "tri", a, b, fc: b > a ? (c - a) / (b - a) : 0, ba: b - a, ca: c - a, bc: b - c, mu: 0, sigma: 0, cap };
  }
  if (d.kind === "logn") return { kind: "logn", a: 0, b: 0, fc: 0, ba: 0, ca: 0, bc: 0, mu: M_LOG(M_SQRT(d.p[0] * d.p[1])), sigma: M_LOG(d.p[1] / d.p[0]) / (2 * Z90), cap };
  return { kind: "fixed", a: d.p[0], b: 0, fc: 0, ba: 0, ca: 0, bc: 0, mu: 0, sigma: 0, cap };
}

export function monteCarloNpv(inp: McNpvInput): McNpvResult {
  const rng = new Pcg32(inp.seed, PCG_STREAM);
  const pres = [preOf(inp.revenue, inp.revenueCap ?? DIST_CAPS[0]), preOf(inp.royaltyPct, DIST_CAPS[1]), preOf(inp.life, DIST_CAPS[2]), preOf(inp.discountPct, DIST_CAPS[3])];
  const capped = [0, 0, 0, 0];
  const draw = (i: number): number => {
    const p = pres[i];
    if (p.kind === "fixed") return p.a;
    let x: number;
    if (p.kind === "tri") {
      const uu = (rng.nextU32() + 0.5) / TWO32;
      x = p.ba === 0 ? p.a : uu < p.fc ? p.a + M_SQRT(uu * p.ba * p.ca) : p.b - M_SQRT((1 - uu) * p.ba * p.bc);
    } else {
      const u1 = (rng.nextU32() + 0.5) / TWO32;
      const u2 = (rng.nextU32() + 0.5) / TWO32;
      x = M_EXP(p.mu + p.sigma * (M_SQRT(-2 * M_LOG(u1)) * M_COS(TWO_PI * u2)));
    }
    if (x > p.cap) {
      capped[i]++;
      x = p.cap;
    }
    return x;
  };
  const n = inp.samples;
  const out = new Float64Array(n);
  const { growthPct, taxPct, cost, timing, straightLine } = inp;
  for (let j = 0; j < n; j++) {
    const rev = draw(0);
    const rate = draw(1);
    const life = draw(2);
    const disc = draw(3);
    out[j] = npvOne(rev, rate, life, disc, growthPct, taxPct, cost, timing, straightLine);
  }
  let sum = 0;
  let neg = 0;
  for (let j = 0; j < n; j++) {
    sum += out[j];
    if (out[j] < 0) neg++;
  }
  const mean = sum / n;
  let ss = 0;
  for (let j = 0; j < n; j++) {
    const e = out[j] - mean;
    ss += e * e;
  }
  const sd = n > 1 ? M_SQRT(ss / (n - 1)) : 0;
  const [p001, p10, p50, p90, p999] = quantilesOf(out, [0.001, 0.1, 0.5, 0.9, 0.999]);
  const central = npvOne(centralOf(inp.revenue), centralOf(inp.royaltyPct), Math.min(IPV_MAX_YEARS, centralOf(inp.life)), Math.min(100, centralOf(inp.discountPct)), growthPct, taxPct, cost, timing, straightLine);
  return { draws: out, p001, p999, mean, sd, p10, p50, p90, probNeg: neg / n, negCount: neg, central, capped };
}

/** One distribution: its select and its numbers (a one-line block read by readDataBlock, RULE N). */
export function readDist(kindRaw: string, raw: string, label: string, o: { min: number; minExclusive: boolean; max: number; unit: string }): Dist | Refusal {
  const kind: DistKind = kindRaw === "logn" ? "logn" : kindRaw === "fixed" ? "fixed" : "tri";
  const want = kind === "tri" ? 3 : kind === "logn" ? 2 : 1;
  const shape = kind === "tri" ? "low, most likely, high" : kind === "logn" ? "P10, P90" : "one value";
  const t = (raw ?? "").trim();
  if (!t) return { error: `${label}: enter ${shape}.` };
  if (t.includes("\n")) return { error: `${label}: give ${shape} on one line.` };
  // A fixed input is one value, so a lone "4,5" is asked about (decimal comma or two values), not read as two.
  // A lone number grouped in thousands ("4,000,000", "1,000") is that one number, under the shared list reader's rule
  // (numberList.ts oneGroupedNumber); a single comma without the 0 tell ("1,500") is asked with its question (fix
  // round 2 MINOR 8: "4,000,000" was refused as three values in fixed mode).
  let lone: number[] | null = null;
  // Fix round 3 N2: any valid grouping with two or more commas ("4,250,000", "1,234,567", "1,250,000.50") is the one
  // number here, since a fixed input takes one value; only "1,500" (1500 or 1.5) is still asked.
  if (kind === "fixed" && /^[-−–+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    const one = oneGroupedNumber(t);
    if (one !== null) lone = [one];
    else {
      const nl = readNumberList(t);
      if (nl.ambiguous) return { error: `${label}: ${nl.ambiguous}` };
      if (nl.values.length === 1 && !nl.dropped.length) lone = nl.values;
    }
  }
  const b = lone ? null : readDataBlock(t, label, { maxRows: 1, loneCommaPairAmbiguous: kind === "fixed" });
  if (b && !b.ok) return { error: b.error };
  const row = lone ?? (b && b.ok ? b.rows[0] : undefined) ?? [];
  const header = !!(b && b.ok && b.header);
  if (header || row.some((v) => v === null) || row.length !== want) {
    return { error: `${label}: a ${kind === "tri" ? "triangular" : kind === "logn" ? "lognormal" : "fixed"} input takes ${want} number${want === 1 ? "" : "s"} (${shape}); ${q(t)} has ${header ? "none" : row.length}.` };
  }
  const p = row as number[];
  const lowOk = (v: number): boolean => (o.minExclusive ? v > o.min : v >= o.min);
  for (const v of p) {
    if (!Number.isFinite(v) || !lowOk(v) || v > o.max) {
      return { error: `${label}: ${fixedText(v, 4).replace(/\.?0+$/, "")} is out of range (${o.minExclusive ? "more than" : "at least"} ${o.min}${o.unit} and at most ${o.max === IPV_MAX_AMOUNT ? "one trillion" : o.max + o.unit}).` };
    }
  }
  if (kind === "tri" && !(p[0] <= p[1] && p[1] <= p[2])) return { error: `${label}: triangular values must be in order, low ≤ most likely ≤ high.` };
  if (kind === "logn") {
    if (!(p[0] > 0)) return { error: `${label}: a lognormal P10 must be more than 0.` };
    if (!(p[1] > p[0])) return { error: `${label}: a lognormal P90 must be above its P10.` };
  }
  return { kind, p };
}

function distText(d: Dist, fmt: (x: number) => string): string {
  if (d.kind === "tri") return `triangular (low ${fmt(d.p[0])}, most likely ${fmt(d.p[1])}, high ${fmt(d.p[2])})`;
  if (d.kind === "logn") return `lognormal (P10 ${fmt(d.p[0])}, P90 ${fmt(d.p[1])}; median ${fmt(Math.sqrt(d.p[0] * d.p[1]))})`;
  return `fixed at ${fmt(d.p[0])}`;
}

/** Histogram of the NPV draws as a step outline (central 99.8 %), with P10, P50, P90 and NPV = 0 marked. */
function npvHistogram(r: McNpvResult, cur: Currency): string {
  const s = r.draws;
  const n = s.length;
  let a = r.p001;
  let b = r.p999;
  if (!(b > a)) {
    const pad = Math.max(1, Math.abs(a) * 0.01);
    a -= pad;
    b += pad;
  }
  const bins = 40;
  const w = (b - a) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const v = s[i];
    if (v < a || v > b) continue;
    const bi = M_FLOOR((v - a) / w);
    counts[bi < bins ? bi : bins - 1]++;
  }
  const ymax = Math.max(...counts, 1);
  const pts: { x: number; y: number }[] = [{ x: a, y: 0 }];
  for (let i = 0; i < bins; i++) {
    pts.push({ x: a + i * w, y: counts[i] });
    pts.push({ x: a + (i + 1) * w, y: counts[i] });
  }
  pts.push({ x: b, y: 0 });
  const vline = (x: number, label: string, color: string) => ({ points: [{ x, y: 0 }, { x, y: ymax }], type: "line" as const, color, label });
  const series = [{ points: pts, type: "line" as const, color: "#4B6A88", label: "draws per bin" }];
  if (r.p10 >= a && r.p10 <= b) series.push(vline(r.p10, "P10", "#B45309"));
  if (r.p50 >= a && r.p50 <= b) series.push(vline(r.p50, "P50", "#0C4A6E"));
  if (r.p90 >= a && r.p90 <= b) series.push(vline(r.p90, "P90", "#047857"));
  if (0 >= a && 0 <= b) series.push(vline(0, "NPV = 0", "#B91C1C"));
  const tick = (v: number): string => fixedText(v, 0);
  return finPlotSvg(series, {
    width: 420,
    height: 280,
    title: `Monte Carlo patent NPV (${n.toLocaleString("en-US")} draws)`,
    xlabel: cur.code ? `NPV (${cur.code})` : "NPV",
    ylabel: "draws per bin",
    xTickLabel: tick,
    yGrouping: "comma",
  });
}

export function mcNpvCalc(read: Read): FinResult {
  const refuse = (e: Refusal): FinResult => ({ text: e.error, ok: false });
  const cur = readCurrency(read("currency"));
  if (isRefusal(cur)) return refuse(cur);
  const revenue = readDist(read("revdist"), read("rev"), "First-year revenue", { min: 0, minExclusive: false, max: IPV_MAX_AMOUNT, unit: "" });
  if (isRefusal(revenue)) return refuse(revenue);
  const growthPct = readNum(read("growth"), "Revenue growth (% a year)", { min: -100, minExclusive: true, max: 100, range: "above −100% and at most 100% a year" });
  if (isRefusal(growthPct)) return refuse(growthPct);
  const royaltyPct = readDist(read("ratedist"), read("rate"), "Royalty rate (%)", { min: 0, minExclusive: true, max: 100, unit: "%" });
  if (isRefusal(royaltyPct)) return refuse(royaltyPct);
  const life = readDist(read("lifedist"), read("life"), "Remaining life (years)", { min: 0, minExclusive: true, max: IPV_MAX_YEARS, unit: " years" });
  if (isRefusal(life)) return refuse(life);
  const discountPct = readDist(read("discdist"), read("disc"), "Discount rate (%)", { min: 0, minExclusive: false, max: 100, unit: "%" });
  if (isRefusal(discountPct)) return refuse(discountPct);
  const taxPct = readNum(read("tax"), "Tax rate (%)", { min: 0, max: 100, maxExclusive: true, range: "0% to less than 100%" });
  if (isRefusal(taxPct)) return refuse(taxPct);
  const cost = readNum(read("cost"), "Price paid today", { min: 0, max: IPV_MAX_AMOUNT, range: "0 to one trillion" });
  if (isRefusal(cost)) return refuse(cost);
  const samples = readNum(read("samples"), "Samples", { min: IPV_MIN_SAMPLES, max: IPV_MAX_SAMPLES, integer: true, range: `${IPV_MIN_SAMPLES.toLocaleString("en-US")} to ${IPV_MAX_SAMPLES.toLocaleString("en-US")}` });
  if (isRefusal(samples)) return refuse(samples);
  const seedRaw = (read("seed") ?? "").trim();
  if (!/^\d+$/.test(seedRaw) || !(Number(seedRaw) <= PCG_MAX_SEED)) {
    return refuse({ error: `Seed: ${q(seedRaw || "(blank)")} must be a whole number from 0 to ${PCG_MAX_SEED.toLocaleString("en-US")}.` });
  }
  const seed = Number(seedRaw);
  // The longest life any draw can have (lognormal draws are capped at the maximum).
  const maxLife = life.kind === "logn" ? IPV_MAX_YEARS : life.p[life.p.length - 1];
  const work = samples * Math.ceil(maxLife - 1e-12);
  if (work > IPV_WORK_BUDGET) {
    return refuse({ error: `Samples: ${samples.toLocaleString("en-US")} samples × ${Math.ceil(maxLife - 1e-12)} years is ${work.toLocaleString("en-US")} year-steps, above the work budget of ${IPV_WORK_BUDGET.toLocaleString("en-US")}; use fewer samples.` });
  }
  // The grown revenue of the longest life must stay within one trillion: a typed high end beyond that is refused, and
  // lognormal draws are capped at the first-year revenue that grows to one trillion.
  const growMax = Math.max(1, Math.pow(1 + growthPct / 100, Math.ceil(maxLife - 1e-12) - 1));
  const revenueCap = IPV_MAX_AMOUNT / growMax;
  if (revenue.kind !== "logn") {
    const big = overAmount("The largest revenue in the forecast", revenue.p[revenue.p.length - 1] * growMax);
    if (big) return refuse(big);
  }
  const timing = readTiming(read("timing"));
  const straightLine = read("attr") === "straight";
  const r = monteCarloNpv({ revenue, growthPct, royaltyPct, life, discountPct, taxPct, cost, timing, straightLine, samples, seed, revenueCap });
  const pctF = (x: number): string => pctText(x);
  const amtF = (x: number): string => amount(x, cur);
  const yrF = (x: number): string => `${fixedText(x, 2)} years`;
  const se = r.sd / Math.sqrt(samples);
  // Every draw the same as printed (fixed inputs): not an estimate, so the amounts keep the currency's minor units.
  const ex = mcIsExact(r, cur);
  const st = mcStepOf(se, cur.minor);
  const shownNeg = mcShownNeg(r, cur);
  const lines = [
    "Monte Carlo patent NPV, computed from the inputs given",
    `Mean NPV: ${mcAmount(r.mean, cur, ex, st)} (simulation standard error ${mcAmount(se, cur, ex, st)}); standard deviation ${mcAmount(r.sd, cur, ex)}`,
    `P10 ${mcAmount(r.p10, cur, ex, st)}; P50 ${mcAmount(r.p50, cur, ex, st)}; P90 ${mcAmount(r.p90, cur, ex, st)}`,
    `Probability NPV < 0: ${mcProb(shownNeg.probNeg)} (${shownNeg.negCount.toLocaleString("en-US")} of ${samples.toLocaleString("en-US")} draws)${shownNeg.breakEven ? `; every draw is ${mcAmount(0, cur, true)} to the smallest unit shown, so none is a loss` : ""}`,
    `NPV at the central inputs (mode, median or fixed value): ${amount(r.central, cur)}`,
    `Inputs: first-year revenue ${distText(revenue, amtF)}, growing ${pctText(growthPct)} a year; royalty rate ${distText(royaltyPct, pctF)}; remaining life ${distText(life, yrF)}; discount rate ${distText(discountPct, pctF)}; tax rate ${pctText(taxPct)}; price paid today ${amount(cost, cur)}.`,
    `NPV = Σₖ R₁ × (1 + g)ᵏ⁻¹ × w × s × royalty rate × (1 − t) × discount factor − price paid; seed ${seed}, ${samples.toLocaleString("en-US")} samples.`,
  ];
  const capNames = [revenueCap < IPV_MAX_AMOUNT ? `first-year revenue at ${fixedText(revenueCap, 0)} (grows to one trillion)` : "first-year revenue at one trillion", "royalty rate at 100%", `remaining life at ${IPV_MAX_YEARS} years`, "discount rate at 100%"];
  const caps = r.capped.map((c, i) => (c ? `${c.toLocaleString("en-US")} draw${c === 1 ? "" : "s"} of ${capNames[i]}` : "")).filter(Boolean);
  if (caps.length) lines.push(`Note: lognormal draws above a cap were set to the cap: ${caps.join("; ")}.`);
  lines.push(
    `Conventions: PCG32 (O'Neill 2014, stream ${PCG_STREAM}) seeded with ${seed}; uniforms (r + 0.5)/2³²; triangular by inverse CDF; lognormal median √(P10 × P90), σ of ln = ln(P90/P10)/(2 × 1.28155) with a Box–Muller normal; ` +
      `draw order revenue, rate, life, discount; ${timingText(timing)}; a final partial year pro rata; ${straightLine ? "straight-line attrition to zero at the end of each drawn life" : "no attrition"}; ` +
      `quantiles by linear interpolation (type 7), SD divisor n − 1; ${currencyNote(cur)}.`,
  );
  const stats: string[][] = [
    ["Statistic", head("NPV", cur)],
    ["Mean", mcCell(r.mean, cur, ex, st)],
    ["Simulation standard error of the mean", mcCell(se, cur, ex, st)],
    ["Standard deviation", mcCell(r.sd, cur, ex)],
    ["P10", mcCell(r.p10, cur, ex, st)],
    ["P50 (median)", mcCell(r.p50, cur, ex, st)],
    ["P90", mcCell(r.p90, cur, ex, st)],
    ["Probability NPV < 0", mcProb(shownNeg.probNeg)],
    ["NPV at central inputs", cell(r.central, cur)],
  ];
  return {
    text: lines.join("\n"),
    reading: mcNpvReading(r, cur, samples),
    tables: [{ label: "Monte Carlo patent NPV", rows: stats, align: ["left", "right"] }],
    svg: npvHistogram(r, cur),
  };
}

/**
 * A simulated amount to 3 significant figures (fix-fin R2 #9: the mean, P10 and P90 printed to the cent carried
 * precision the simulation does not have), never more decimals than the currency's minor unit. A spread of exactly
 * zero (every draw the same) is not a simulation estimate and keeps the minor units.
 */
function mcDigits(x: number, minor: number): { v: number; dp: number } {
  if (!Number.isFinite(x) || x === 0) return { v: x, dp: minor };
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const dp = Math.max(0, Math.min(minor, 2 - mag));
  const step = Math.pow(10, mag - 2);
  return { v: Math.round(x / step) * step, dp };
}
/**
 * The rounding a simulated estimate earns from its simulation standard error (fix round 2 M2): the place of the SE's
 * second significant figure, never finer than the currency's minor unit. Cost "714,106" printed "Mean NPV 0.16 (SE
 * 1,020)": three significant figures of the VALUE claimed a precision of 0.01 the SE of 1,020 does not support.
 */
export interface McStep {
  step: number;
  dp: number;
}
export function mcStepOf(se: number, minor: number): McStep | undefined {
  if (!(se > 0) || !Number.isFinite(se)) return undefined;
  const mag = Math.floor(Math.log10(se));
  const dp = Math.max(0, Math.min(minor, 1 - mag));
  return { step: Math.max(Math.pow(10, mag - 1), Math.pow(10, -minor)), dp };
}
/**
 * A simulated amount as a table cell. `exact`: every draw the same, so the currency's minor units. With `st` (from
 * mcStepOf), rounded to the SE's second significant figure (the mean, its SE and the percentiles); without it, to 3
 * significant figures (the standard deviation).
 */
export function mcCell(x: number, cur: Currency, exact = false, st?: McStep): string {
  if (exact) return cell(x, cur);
  if (st) return fixedText(Math.round(x / st.step) * st.step, st.dp);
  const d = mcDigits(x, cur.minor);
  return fixedText(d.v, d.dp);
}
export function mcAmount(x: number, cur: Currency, exact = false, st?: McStep): string {
  const s = mcCell(x, cur, exact, st);
  return cur.code ? currencyAmount(s, cur.code) : s;
}
/**
 * Every draw the same, as PRINTED (fix round 2 MINOR 4): with every input fixed the draws differ only by float noise,
 * so `sd === 0` failed and "126,000" with "SE 0.00" sat beside the central 125,880.37. The standard deviation printing
 * as zero in the currency's minor units is the test.
 */
export const mcIsExact = (r: McNpvResult, cur: Currency): boolean => !/[1-9]/.test(cell(r.sd, cur));
/**
 * The losses as PRINTED (fix round 3 F1): with every input fixed and a break-even price ("682057.35"), the draws were
 * −1e−10 float noise, so the text said "Mean NPV: 0.00" beside "Probability NPV < 0: 100.0%" and the reading "every one
 * … loses money". An exact result (every draw the same as printed) whose amount prints as zero breaks even.
 */
function mcShownNeg(r: McNpvResult, cur: Currency): { negCount: number; probNeg: number; breakEven: boolean } {
  const breakEven = mcIsExact(r, cur) && !/[1-9]/.test(cell(r.mean, cur));
  return breakEven ? { negCount: 0, probNeg: 0, breakEven } : { negCount: r.negCount, probNeg: r.probNeg, breakEven };
}
/** A simulated probability to 0.1 percentage point. */
const mcProb = (p: number): string => `${fixedText(p * 100, 1)}%`;

/** The plain-language reading of the Monte Carlo NPV (lib/calcReading.ts rules). */
export function mcNpvReading(r: McNpvResult, cur: Currency, samples: number): string {
  const n = samples.toLocaleString("en-US");
  const neg = mcShownNeg(r, cur);
  const loss = neg.breakEven
    ? `every one of the ${n} simulated outcomes breaks even, neither making nor losing money`
    : neg.negCount === 0
      ? `none of the ${n} simulated outcomes loses money`
      : neg.negCount === samples
        ? `every one of the ${n} simulated outcomes loses money`
        : `${neg.negCount.toLocaleString("en-US")} of the ${n} simulated outcomes (about ${mcProb(neg.probNeg)}) lose${neg.negCount === 1 ? "s" : ""} money`;
  // The same exactness test and rounding as the text (fix round 2 M2, MINOR 4).
  const ex = mcIsExact(r, cur);
  const st = mcStepOf(r.sd / Math.sqrt(samples), cur.minor);
  if (ex) {
    // "to the cent" (the minor unit), not "nothing varies": a tight lognormal can print a zero spread and still vary.
    return `After the price paid, the patent's NPV is ${mcAmount(r.mean, cur, ex)} in every simulated outcome, to the ${cur.minor === 0 ? "unit" : "smallest unit shown"}. On these inputs ${loss}.`;
  }
  const p10 = mcAmount(r.p10, cur, ex, st);
  const p90 = mcAmount(r.p90, cur, ex, st);
  const spread = p10 === p90 ? `every simulated outcome is about ${p10}` : `the middle of the outcomes runs from about ${p10} at P10 to ${p90} at P90`;
  return `After the price paid, the patent's NPV averages about ${mcAmount(r.mean, cur, ex, st)}, and ${spread}. On these input ranges ${loss}.`;
}
