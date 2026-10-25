/**
 * Litigation damages: prejudgment and post-judgment interest (Release E1a).
 *
 * Arithmetic on the user's inputs only. No rate is bundled as law: every rate is typed by the user, and every
 * result says it was computed from the inputs given.
 *
 * DATES are integer civil days (days since 1970-01-01), computed with pure integer arithmetic (days_from_civil),
 * never with local-time Date objects, so a daylight-saving change cannot make a 23-hour day.
 *
 * CONVENTIONS (printed in every result's notes):
 *  - A tranche accrues interest for each day from its accrual date up to, not including, the end date: days
 *    [accrual, end). A day takes the annual rate in force that day, divided by the day-count basis (365, 360, or for
 *    actual/actual the length of that day's calendar year).
 *  - Compounding (annual / quarterly / monthly) adds interest to the balance on each anniversary of the tranche's
 *    OWN accrual date (k months after it, clamped to the month's end: Jan 31 + 1 month is Feb 28 or 29); a final
 *    partial period accrues simply at the day-count rate. Daily compounding multiplies by (1 + daily rate) each day.
 *  - Each tranche's interest is rounded to the cent; totals are the sums of the rounded rows, so the table adds up.
 *  - Post-judgment: interest computed daily and compounded annually on each anniversary of the judgment date; each
 *    year's interest is rounded to the cent and added to the balance (a ledger); a partial final year is simple.
 */
import { parseCellNumber } from "./dataimport";
import { finMoney, finPlotSvg } from "./financeFigures";
import { insertableResultText } from "./insertGate";
import type { Point, Series } from "./plot";

export type DayCount = "act365" | "act360" | "actact";
export type InterestMethod = "simple" | "annual" | "quarterly" | "monthly" | "daily";

// ---------------------------------------------------------------------------------------------------------------
// Civil dates
// ---------------------------------------------------------------------------------------------------------------

/** Earliest and latest calendar years a date may name (keeps the per-day tables bounded: about 110,000 days). */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil). */
export function civilDay(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date of a civil day (civil_from_days). */
export function civilFromDay(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** `k` months after `day`, from the ORIGINAL day of month, clamped to the month's end (Jan 31 + 1 → Feb 28/29). */
export function addMonthsClamped(day: number, k: number): number {
  const { y, m, d } = civilFromDay(day);
  const t = m - 1 + k;
  const ny = y + Math.floor(t / 12);
  const nm = (((t % 12) + 12) % 12) + 1;
  return civilDay(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "January 5, 2024". */
export function longDate(day: number): string {
  const { y, m, d } = civilFromDay(day);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** The year as a decimal (2024.5 is about July 2, 2024), for a time axis. */
export function decimalYear(day: number): number {
  const { y } = civilFromDay(day);
  const start = civilDay(y, 1, 1);
  return y + (day - start) / (isLeapYear(y) ? 366 : 365);
}

/** A parsed date at the start of a cell or line: a single day, or a period (a year, quarter, month, or from–to). */
export interface DateToken {
  from: number;
  to: number;
  period: "day" | "year" | "quarter" | "month";
  label: string;
  /** Characters consumed. */
  len: number;
}

const END = "(?=$|[\\s,;])";
const MONTH_WORD =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ISO_RE = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${END}`);
const US_RE = new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${END}`);
const LONG_RE = new RegExp(`^${MONTH_WORD}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${END}`, "i");
const QUARTER_RE = new RegExp(`^(\\d{4})[- ]?Q([1-4])${END}`, "i");
const MONTH_RE = new RegExp(`^(\\d{4})-(\\d{1,2})${END}`);
const YEAR_RE = new RegExp(`^(\\d{4})${END}`);

function monthIndex(word: string): number {
  return MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(word.toLowerCase().slice(0, 3))) + 1;
}

function checkYear(y: number, text: string): string | null {
  return y < MIN_YEAR || y > MAX_YEAR ? `“${text}” names the year ${y}; dates must fall between ${MIN_YEAR} and ${MAX_YEAR}.` : null;
}

function dayToken(y: number, m: number, d: number, text: string): DateToken | { error: string } {
  const bad = checkYear(y, text);
  if (bad) return { error: bad };
  if (m < 1 || m > 12) return { error: `“${text}” is not a calendar date (there is no month ${m}).` };
  if (d < 1 || d > daysInMonth(y, m)) {
    const why = m === 2 && d === 29 ? ` (${y} is not a leap year)` : "";
    return { error: `“${text}” is not a calendar date${why}.` };
  }
  const day = civilDay(y, m, d);
  return { from: day, to: day, period: "day", label: longDate(day), len: text.length };
}

/**
 * The date at the start of `s` (already trimmed at the start), or null when `s` does not start with one, or a named
 * error for something that looks like a date but is not one (February 29 of a common year, month 13).
 * With `periods`, a bare year ("2019"), a quarter ("2019-Q3", "2019 Q3") or a month ("2019-07") is a period.
 */
export function readDateToken(s: string, periods: boolean): DateToken | { error: string } | null {
  let m: RegExpExecArray | null;
  if ((m = ISO_RE.exec(s))) return dayToken(+m[1], +m[2], +m[3], m[0]);
  if ((m = US_RE.exec(s))) return dayToken(+m[3], +m[1], +m[2], m[0]);
  if ((m = LONG_RE.exec(s))) return dayToken(+m[3], monthIndex(m[1]), +m[2], m[0]);
  if (!periods) return null;
  if ((m = QUARTER_RE.exec(s))) {
    const y = +m[1];
    const q = +m[2];
    const bad = checkYear(y, m[0]);
    if (bad) return { error: bad };
    const from = civilDay(y, 3 * q - 2, 1);
    const to = civilDay(y, 3 * q, daysInMonth(y, 3 * q));
    return { from, to, period: "quarter", label: `${y} Q${q}`, len: m[0].length };
  }
  if ((m = MONTH_RE.exec(s))) {
    const y = +m[1];
    const mo = +m[2];
    const bad = checkYear(y, m[0]);
    if (bad) return { error: bad };
    if (mo < 1 || mo > 12) return { error: `“${m[0]}” is not a month (there is no month ${mo}).` };
    return { from: civilDay(y, mo, 1), to: civilDay(y, mo, daysInMonth(y, mo)), period: "month", label: `${MONTH_NAMES[mo - 1]} ${y}`, len: m[0].length };
  }
  if ((m = YEAR_RE.exec(s))) {
    const y = +m[1];
    const bad = checkYear(y, m[0]);
    if (bad) return { error: bad };
    return { from: civilDay(y, 1, 1), to: civilDay(y, 12, 31), period: "year", label: String(y), len: m[0].length };
  }
  return null;
}

/** One whole field holding one date (YYYY-MM-DD, M/D/YYYY or "January 5, 2024"). */
export function parseDateField(raw: string, what: string): number | { error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { error: `Enter the ${what}.` };
  const t = readDateToken(s, false);
  if (t && "error" in t) return { error: `${capital(what)}: ${t.error}` };
  if (!t || t.len !== s.length) return { error: `${capital(what)}: “${s}” is not a date. Use YYYY-MM-DD, M/D/YYYY or January 5, 2024.` };
  return t.from;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Parsers: the tranche list and the rate table (typed, pasted, or a Word/Excel table read as tab-joined lines)
// ---------------------------------------------------------------------------------------------------------------

/** Past this many rows a list is refused by name (10,000 rows compute in well under a second). */
export const MAX_ROWS = 50000;
/** Amounts beyond this are refused: arithmetic to the cent is not meaningful past it in double precision. */
export const MAX_AMOUNT = 1e15;

export interface Tranche {
  /** 1-based row of the field. */
  row: number;
  label: string;
  amount: number;
  /** The day interest starts accruing. */
  accrual: number;
  /** For a period row: the period it covers. */
  period?: { from: number; to: number };
}

export interface RateRow {
  row: number;
  from: number;
  /** Last day in force, or Infinity for the last open-ended row. */
  to: number;
  /** Annual rate as a decimal (0.05 for 5%). */
  rate: number;
  /** The same rate in whole millionths (0.05 is 50,000), for exact day sums. */
  units: number;
  /** Whether the row gave its own end date. */
  closed: boolean;
}

type Parsed<T> = { ok: true; value: T; notes: string[] } | { ok: false; error: string };

interface LineRead {
  row: number;
  first: DateToken;
  second: DateToken | null;
  rest: string;
}

/** No-break spaces (U+00A0, U+2007, U+202F) as Word and Excel write them, read as spaces. */
const NBSP_RE = new RegExp("[" + String.fromCharCode(0xa0, 0x2007, 0x202f) + "]", "g");

/** Splits the field into rows: (date [second date] rest). A first row with no date and a letter is a header. */
function readRows(text: string, periods: boolean, what: string, valueName: string): Parsed<LineRead[]> {
  const lines = (text ?? "").split(/\r\n?|\n/);
  const out: LineRead[] = [];
  const notes: string[] = [];
  let seenData = false;
  for (let i = 0; i < lines.length; i++) {
    const row = i + 1;
    const line = lines[i].replace(NBSP_RE, " ").trim();
    if (!line) continue;
    if (out.length >= MAX_ROWS) return { ok: false, error: `${capital(what)}: more than ${MAX_ROWS.toLocaleString("en-US")} rows is outside this calculator.` };
    const first = readDateToken(line, periods);
    if (first && "error" in first) return { ok: false, error: `${capital(what)}, row ${row}: ${first.error}` };
    if (!first) {
      if (!seenData && /[A-Za-z]/.test(line)) {
        seenData = true;
        notes.push(`${capital(what)}: row ${row} (“${line.length > 40 ? line.slice(0, 40) + "…" : line}”) read as a header and skipped.`);
        continue;
      }
      const serial = /^\d{5}(?:[.,]\d+)?(?=$|[\s,;])/.test(line)
        ? " It looks like an Excel date serial number: format the date column as dates (for example 2024-01-05) and copy it again."
        : "";
      return {
        ok: false,
        error: `${capital(what)}, row ${row}: “${line.length > 40 ? line.slice(0, 40) + "…" : line}” does not start with a date. Each row is a date (YYYY-MM-DD, M/D/YYYY or January 5, 2024) then ${valueName}.${serial}`,
      };
    }
    seenData = true;
    let rest = line.slice(first.len).replace(/^[\s,;]+/, "");
    let second: DateToken | null = null;
    const t2 = readDateToken(rest, false);
    if (t2 && "error" in t2) return { ok: false, error: `${capital(what)}, row ${row}: ${t2.error}` };
    if (t2) {
      if (first.period !== "day") {
        return { ok: false, error: `${capital(what)}, row ${row}: a period (${first.label}) cannot also have an end date; give two dates, or the period alone.` };
      }
      if (t2.from < first.from) {
        return { ok: false, error: `${capital(what)}, row ${row}: the period ends (${t2.label}) before it starts (${first.label}).` };
      }
      second = t2;
      rest = rest.slice(t2.len).replace(/^[\s,;]+/, "");
    }
    out.push({ row, first, second, rest });
  }
  return { ok: true, value: out, notes };
}

/** The number in a cell's text: a leading currency sign and the product's cell reader (grouping, decimal comma, U+2212). */
function readValue(rest: string): { text: string; value: number } {
  // Tab-separated (a Word or Excel table): the first cell after the date(s); further cells (a label) are ignored.
  const cell = (rest.includes("\t") ? rest.split("\t")[0] : rest).trim();
  const t = cell.replace(/^([−–-]?)\s*[$€£]\s*/, "$1");
  return { text: cell, value: parseCellNumber(t) };
}

/**
 * The tranche list: one row per damages amount, "date amount" (an accrual date), or "from-date to-date amount" /
 * "2019 amount" / "2019-Q3 amount" / "2019-07 amount" (a period). A period accrues from its last day, or from its
 * midpoint with `midPeriod`. A first row of column titles is skipped.
 */
export function parseTranches(text: string, midPeriod: boolean): Parsed<Tranche[]> {
  const rows = readRows(text, true, "damages list", "an amount");
  if (!rows.ok) return rows;
  const out: Tranche[] = [];
  for (const r of rows.value) {
    if (!r.rest) return { ok: false, error: `Damages list, row ${r.row}: no amount after the date.` };
    const { text: amtText, value } = readValue(r.rest);
    if (!Number.isFinite(value)) return { ok: false, error: `Damages list, row ${r.row}: “${amtText}” is not an amount.` };
    if (value < 0) {
      return {
        ok: false,
        error: `Damages list, row ${r.row}: the amount is negative (${finMoney(value)}). Enter damages as positive amounts; credits and offsets are outside this calculator.`,
      };
    }
    if (value > MAX_AMOUNT) return { ok: false, error: `Damages list, row ${r.row}: amounts above ${finMoney(MAX_AMOUNT)} are outside this calculator.` };
    const isPeriod = r.second !== null || r.first.period !== "day";
    if (!isPeriod) {
      out.push({ row: r.row, label: r.first.label, amount: value, accrual: r.first.from });
      continue;
    }
    const from = r.first.from;
    const to = r.second ? r.second.to : r.first.to;
    const label = r.second ? `${r.first.label} to ${r.second.label}` : r.first.label;
    // The midpoint: the first day plus half the period's length in days, rounded down (2019 → July 2, 2020 → July 2).
    const accrual = midPeriod ? from + Math.floor((to - from + 1) / 2) : to;
    out.push({ row: r.row, label, amount: value, accrual, period: { from, to } });
  }
  if (!out.length) return { ok: false, error: "Enter at least one damages row: a date, then an amount." };
  return { ok: true, value: out, notes: rows.notes };
}

/**
 * The rate table: one row per rate, "from-date rate%" (in force until the next row starts), "from-date to-date rate%",
 * or a period ("2019 6.5"). Rows are put in date order. Duplicate start dates, overlaps and gaps between rows are
 * refused by name.
 */
export function parseRateTable(text: string): Parsed<RateRow[]> {
  const rows = readRows(text, true, "rate table", "an annual rate in percent");
  if (!rows.ok) return rows;
  const notes = [...rows.notes];
  const raw: { row: number; from: number; to: number | null; rate: number; units: number }[] = [];
  for (const r of rows.value) {
    if (!r.rest) return { ok: false, error: `Rate table, row ${r.row}: no rate after the date.` };
    const { text: rText, value } = readValue(r.rest);
    if (!Number.isFinite(value)) return { ok: false, error: `Rate table, row ${r.row}: “${rText}” is not a rate.` };
    if (value < 0) return { ok: false, error: `Rate table, row ${r.row}: the rate is negative (${rText}); negative rates are outside this calculator.` };
    if (value > 100) return { ok: false, error: `Rate table, row ${r.row}: ${rText} is above 100%. Enter the annual rate in percent (5.25 for 5.25%).` };
    const units = Math.round(value * 1e4);
    if (Math.abs(value * 1e4 - units) > 1e-6) {
      return { ok: false, error: `Rate table, row ${r.row}: ${rText} has more than four decimals; enter the percent to at most four decimals (5.1234).` };
    }
    const to = r.second ? r.second.to : r.first.period !== "day" ? r.first.to : null;
    raw.push({ row: r.row, from: r.first.from, to, rate: units / 1e6, units });
  }
  if (!raw.length) return { ok: false, error: "Enter at least one rate row: a start date, then an annual rate in percent." };
  const sorted = [...raw].sort((a, b) => a.from - b.from || a.row - b.row);
  if (sorted.some((r, i) => r !== raw[i])) notes.push("Rate table rows were put in date order.");
  const out: RateRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const next = sorted[i + 1];
    if (next && next.from === r.from) {
      return { ok: false, error: `Rate table: rows ${r.row} and ${next.row} both start on ${longDate(r.from)}; keep one.` };
    }
    let to: number;
    if (r.to !== null) {
      to = r.to;
      if (next && to >= next.from) {
        return { ok: false, error: `Rate table: row ${r.row} runs to ${longDate(to)}, overlapping row ${next.row}, which starts on ${longDate(next.from)}.` };
      }
      if (next && to + 1 < next.from) {
        return {
          ok: false,
          error: `Rate table: there is no rate from ${longDate(to + 1)} to ${longDate(next.from - 1)} (a gap between rows ${r.row} and ${next.row}).`,
        };
      }
    } else to = next ? next.from - 1 : Infinity;
    out.push({ row: r.row, from: r.from, to, rate: r.rate, units: r.units, closed: r.to !== null });
  }
  return { ok: true, value: out, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// The daily-rate timeline
// ---------------------------------------------------------------------------------------------------------------

/**
 * Prefix sums over the days [base, end), EXACT: each day's annual rate is an integer number of millionths (a rate is
 * entered to at most four decimals of a percent), so A[i] (days in common years, or every day for actual/365 and
 * actual/360) and B[i] (days in leap years, actual/actual only) are integer sums well inside 2^53. The year fraction
 * of [a, b) is then (ΔA/365 + ΔB/366)/10^6 (or ΔA/360 or ΔA/365), computed once: a damages amount of 10^15 still
 * comes out to the cent on simple interest. L[i] sums log(1 + daily rate) for daily compounding.
 */
interface Timeline {
  base: number;
  end: number;
  dayCount: DayCount;
  A: Float64Array;
  B: Float64Array;
  L: Float64Array;
  /** Month index (year × 12 + month − 1) of the first month in the month table. */
  month0: number;
  /** First civil day and length of each month from the base date's month to the month after the end date. */
  monthStart: Int32Array;
  monthLen: Int32Array;
}

function buildTimeline(rates: RateRow[], base: number, end: number, dayCount: DayCount): Timeline | { error: string } {
  if (base < end && base < rates[0].from) {
    return {
      error: `The rate table starts on ${longDate(rates[0].from)}, but interest accrues from ${longDate(base)}: there is no rate for ${longDate(base)}${
        rates[0].from - 1 > base ? ` to ${longDate(rates[0].from - 1)}` : ""
      }. Add a rate row starting on ${longDate(base)} or earlier.`,
    };
  }
  const last = rates[rates.length - 1];
  if (end - 1 > last.to && end > base) {
    return { error: `The rate table ends on ${longDate(last.to)}, before the last day of interest (${longDate(end - 1)}). Extend the last rate row.` };
  }
  const span = end - base;
  const A = new Float64Array(span + 1);
  const B = new Float64Array(span + 1);
  const L = new Float64Array(span + 1);
  let k = 0;
  let { y } = civilFromDay(base);
  let nextYear = civilDay(y + 1, 1, 1);
  let leap = isLeapYear(y);
  for (let i = 0; i < span; i++) {
    const day = base + i;
    if (day >= nextYear) {
      y++;
      nextYear = civilDay(y + 1, 1, 1);
      leap = isLeapYear(y);
    }
    while (rates[k].to < day) k++;
    const units = rates[k].units;
    const inB = dayCount === "actact" && leap;
    A[i + 1] = A[i] + (inB ? 0 : units);
    B[i + 1] = B[i] + (inB ? units : 0);
    const basis = dayCount === "act360" ? 360 : inB ? 366 : 365;
    L[i + 1] = L[i] + Math.log1p(units / 1e6 / basis);
  }
  const b0 = civilFromDay(base);
  const e0 = civilFromDay(end);
  const month0 = b0.y * 12 + b0.m - 1;
  const months = e0.y * 12 + e0.m - 1 - month0 + 2;
  const monthStart = new Int32Array(months);
  const monthLen = new Int32Array(months);
  for (let i = 0; i < months; i++) {
    const yy = Math.floor((month0 + i) / 12);
    const mm = ((month0 + i) % 12) + 1;
    monthStart[i] = civilDay(yy, mm, 1);
    monthLen[i] = daysInMonth(yy, mm);
  }
  return { base, end, dayCount, A, B, L, month0, monthStart, monthLen };
}

/** Rate × time over the days [from, to): the sum of the daily rates. */
function rateTime(tl: Timeline, from: number, to: number): number {
  const i = from - tl.base;
  const j = to - tl.base;
  const dA = tl.A[j] - tl.A[i];
  if (tl.dayCount === "act360") return dA / 360e6;
  if (tl.dayCount === "act365") return dA / 365e6;
  return (dA * 366 + (tl.B[j] - tl.B[i]) * 365) / (365 * 366 * 1e6);
}

const MONTHS_PER_PERIOD: Record<InterestMethod, number> = { simple: 0, annual: 12, quarterly: 3, monthly: 1, daily: 0 };

/**
 * Interest on `amount` accruing from `accrual` to each day in `days` (ascending, each ≥ accrual and ≤ the timeline's
 * end), by `method`. One sweep over the compounding points, so a figure's samples cost no more than the result.
 */
function interestPath(tl: Timeline, amount: number, accrual: number, method: InterestMethod, days: number[]): number[] {
  const out: number[] = [];
  if (method === "simple") {
    for (const d of days) out.push(amount * rateTime(tl, accrual, d));
    return out;
  }
  if (method === "daily") {
    const a = accrual - tl.base;
    for (const d of days) out.push(amount * Math.expm1(tl.L[d - tl.base] - tl.L[a]));
    return out;
  }
  const step = MONTHS_PER_PERIOD[method];
  // addMonthsClamped, unrolled: the accrual date is decomposed once (10,000 rows compounded monthly over a decade is
  // over a million anniversaries).
  const ad = civilFromDay(accrual);
  const m0 = ad.y * 12 + ad.m - 1 - tl.month0;
  const { monthStart, monthLen } = tl;
  const anniversary = (k: number): number => {
    const i = m0 + step * k;
    // Past the table (an anniversary after the end date): any day after the end stops the sweep.
    if (i >= monthStart.length) return tl.end + 1;
    return monthStart[i] + Math.min(ad.d, monthLen[i]) - 1;
  };
  let balance = amount;
  let p0 = accrual;
  let k = 1;
  let p1 = anniversary(1);
  for (const d of days) {
    while (p1 <= d) {
      balance += balance * rateTime(tl, p0, p1);
      p0 = p1;
      k++;
      p1 = anniversary(k);
    }
    out.push(balance - amount + balance * rateTime(tl, p0, d));
  }
  return out;
}

/** Rounds to the cent, half away from zero, through integer cents. */
export function toCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7);
}

// ---------------------------------------------------------------------------------------------------------------
// Prejudgment interest
// ---------------------------------------------------------------------------------------------------------------

export interface PrejudgmentInput {
  tranches: Tranche[];
  rates: RateRow[];
  /** Interest runs up to, not including, this day. */
  end: number;
  method: InterestMethod;
  dayCount: DayCount;
}

export interface PrejudgmentRow {
  tranche: Tranche;
  days: number;
  /** Interest in whole cents. */
  interestCents: number;
}

export interface PrejudgmentResult {
  rows: PrejudgmentRow[];
  totalAmount: number;
  totalAmountCents: number;
  totalInterestCents: number;
  timeline: Timeline;
  input: PrejudgmentInput;
}

/** Prejudgment interest per tranche, or a named refusal. */
export function prejudgmentInterest(input: PrejudgmentInput): PrejudgmentResult | { error: string } {
  const { tranches, rates, end, method, dayCount } = input;
  if (!tranches.length) return { error: "Enter at least one damages row." };
  if (!rates.length) return { error: "Enter at least one rate row." };
  let base = end;
  for (const t of tranches) {
    if (t.accrual > end) {
      return {
        error: `Damages list, row ${t.row}: ${t.label} accrues from ${longDate(t.accrual)}, after the end date (${longDate(end)}). Remove the row or move the end date.`,
      };
    }
    if (t.accrual < base) base = t.accrual;
  }
  const tl = buildTimeline(rates, base, end, dayCount);
  if ("error" in tl) return tl;
  const rows: PrejudgmentRow[] = [];
  let totalAmount = 0;
  let totalAmountCents = 0;
  let totalInterestCents = 0;
  for (const t of tranches) {
    const interest = interestPath(tl, t.amount, t.accrual, method, [end])[0];
    const cents = toCents(interest);
    rows.push({ tranche: t, days: end - t.accrual, interestCents: cents });
    totalAmount += t.amount;
    totalAmountCents += toCents(t.amount);
    totalInterestCents += cents;
  }
  return { rows, totalAmount, totalAmountCents, totalInterestCents, timeline: tl, input };
}

export const METHOD_WORDS: Record<InterestMethod, string> = {
  simple: "simple interest",
  annual: "compounded annually",
  quarterly: "compounded quarterly",
  monthly: "compounded monthly",
  daily: "compounded daily",
};
export const DAYCOUNT_WORDS: Record<DayCount, string> = {
  act365: "actual/365",
  act360: "actual/360",
  actact: "actual/actual (each day against its own year's length)",
};

/**
 * Whole cents as money, exactly as finMoney prints it ("1,234,567.89", true minus), without toLocaleString: a
 * 10,000-row table formats 30,000 amounts, and toLocaleString took a second for them.
 */
export function moneyCents(cents: number): string {
  if (!Number.isFinite(cents)) return finMoney(NaN);
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs - whole * 100;
  const grouped = (whole >= 1e21 ? whole.toLocaleString("en-US", { useGrouping: false }) : String(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg && abs > 0 ? "−" : ""}${grouped}.${frac < 10 ? "0" : ""}${frac}`;
}
const money = moneyCents;
/** A whole count grouped ("1,812"). */
const count = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A rate as a percent with up to four decimals ("5.25%", "7%"), true minus never needed (rates are ≥ 0). */
export function ratePct(r: number): string {
  const s = (r * 100).toFixed(4).replace(/\.?0+$/, "");
  return `${s}%`;
}

/**
 * Every cell of a results table passes the product's insert gate (no "—", no broken number); an empty cell is a
 * blank, not a broken number. A table goes into Word from its cells, so the text gate never sees them.
 */
export function tableCellsInsertable(rows: string[][]): boolean {
  return rows.every((r) => r.every((c) => c === "" || insertableResultText(c)));
}

/** What the pane shows and inserts. */
export interface DamagesReport {
  ok: boolean;
  text: string;
  table?: { label: string; rows: string[][] };
  svg?: string;
}

/** The figure: damages accrued and damages plus interest accrued, over time (at most ~200 sample days). */
function prejudgmentFigure(res: PrejudgmentResult): string | undefined {
  const { timeline: tl, input } = res;
  const { base, end } = tl;
  if (end <= base) return undefined;
  const samples = new Set<number>();
  const N = Math.min(160, end - base);
  for (let i = 0; i <= N; i++) samples.add(base + Math.round(((end - base) * i) / N));
  const accruals = [...new Set(input.tranches.map((t) => t.accrual))];
  const steps = accruals.length <= 60;
  if (steps) for (const a of accruals) samples.add(a);
  const days = [...samples].sort((a, b) => a - b);
  const principalAfter = new Float64Array(days.length);
  const withInterest = new Float64Array(days.length);
  const atDay = new Float64Array(days.length); // principal of tranches accruing exactly that day
  const index = new Map(days.map((d, i) => [d, i] as [number, number]));
  for (const t of input.tranches) {
    // first sample ≥ accrual
    let lo = 0;
    let hi = days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid] < t.accrual) lo = mid + 1;
      else hi = mid;
    }
    const sub = days.slice(lo);
    const path = interestPath(tl, t.amount, t.accrual, input.method, sub);
    for (let j = 0; j < sub.length; j++) {
      principalAfter[lo + j] += t.amount;
      withInterest[lo + j] += t.amount + path[j];
    }
    const at = index.get(t.accrual);
    if (at !== undefined) atDay[at] += t.amount;
  }
  const damages: Point[] = [];
  const total: Point[] = [];
  for (let i = 0; i < days.length; i++) {
    const x = decimalYear(days[i]);
    if (steps && atDay[i] > 0) {
      damages.push({ x, y: principalAfter[i] - atDay[i] });
      total.push({ x, y: withInterest[i] - atDay[i] });
    }
    damages.push({ x, y: principalAfter[i] });
    total.push({ x, y: withInterest[i] });
  }
  const series: Series[] = [
    { points: total, type: "line", color: "#b45309", label: "damages + interest" },
    { points: damages, type: "line", color: "#2563eb", label: "damages" },
  ];
  return finPlotSvg(series, {
    width: 380,
    height: 260,
    title: "Cumulative damages and interest (from the inputs given)",
    xlabel: "year",
    ylabel: "amount",
  });
}

/** The tranche table rows: header, one row per tranche, totals. */
function prejudgmentRows(res: PrejudgmentResult): string[][] {
  const rows: string[][] = [["Damages period / date", "Accrues from", "Days", "Amount", "Interest", "Total"]];
  for (const r of res.rows) {
    const amtCents = toCents(r.tranche.amount);
    rows.push([
      r.tranche.label,
      longDate(r.tranche.accrual),
      count(r.days),
      money(amtCents),
      money(r.interestCents),
      money(amtCents + r.interestCents),
    ]);
  }
  rows.push(["Total", "", "", money(res.totalAmountCents), money(res.totalInterestCents), money(res.totalAmountCents + res.totalInterestCents)]);
  return rows;
}

/** The whole prejudgment calculation from the pane's field text. */
export function prejudgmentReport(f: {
  tranches: string;
  rates: string;
  end: string;
  method: string;
  dayCount: string;
  midPeriod: string;
}): DamagesReport {
  const refuse = (text: string): DamagesReport => ({ ok: false, text });
  const method = (["simple", "annual", "quarterly", "monthly", "daily"] as const).find((m) => m === f.method);
  const dayCount = (["act365", "act360", "actact"] as const).find((m) => m === f.dayCount);
  if (!method || !dayCount) return refuse("Choose a method and a day count.");
  const mid = f.midPeriod === "on";
  const end = parseDateField(f.end, "end date");
  if (typeof end !== "number") return refuse(end.error);
  const tr = parseTranches(f.tranches, mid);
  if (!tr.ok) return refuse(tr.error);
  if (mid && !tr.value.some((t) => t.period)) {
    return refuse(
      "Mid-period is on, but no damages row names a period. Give a period (2019, 2019-Q3, 2019-07, or a from-date and a to-date) before the amount, or turn mid-period off.",
    );
  }
  const rt = parseRateTable(f.rates);
  if (!rt.ok) return refuse(rt.error);
  const res = prejudgmentInterest({ tranches: tr.value, rates: rt.value, end, method, dayCount });
  if ("error" in res) return refuse(res.error);
  const rateList =
    rt.value.length <= 4
      ? rt.value.map((r) => `${ratePct(r.rate)} from ${longDate(r.from)}${r.closed ? ` to ${longDate(r.to)}` : ""}`).join("; ")
      : `${rt.value.length} rate rows, ${longDate(rt.value[0].from)} onward`;
  const n = res.rows.length;
  const text = [
    "Prejudgment interest, computed from the inputs given",
    `Damages ${money(res.totalAmountCents)} + interest ${money(res.totalInterestCents)} = ${money(res.totalAmountCents + res.totalInterestCents)}`,
    `${n.toLocaleString("en-US")} damages row${n === 1 ? "" : "s"}; interest to ${longDate(end)}, ${METHOD_WORDS[method]}, day count ${DAYCOUNT_WORDS[dayCount]}.`,
    `Rates (as entered): ${rateList}.`,
    "Note: each row accrues for the days from its accrual date up to, not including, the end date; a day takes the rate in force that day.",
    ...(method === "annual" || method === "quarterly" || method === "monthly"
      ? ["Note: compounding falls on anniversaries of each row's own accrual date (month ends clamped); a final partial period accrues simply."]
      : []),
    ...(tr.value.some((t) => t.period)
      ? [mid ? "Note: a period row accrues from the period's midpoint (mid-period convention)." : "Note: a period row accrues from the last day of its period."]
      : []),
    "Note: each row's interest is rounded to the cent; totals are sums of the rounded rows.",
    ...tr.notes.map((s) => `Note: ${s}`),
    ...rt.notes.map((s) => `Note: ${s}`),
  ].join("\n");
  return { ok: true, text, table: { label: "Prejudgment interest by damages row", rows: prejudgmentRows(res) }, svg: prejudgmentFigure(res) };
}

// ---------------------------------------------------------------------------------------------------------------
// Post-judgment interest (28 U.S.C. § 1961)
// ---------------------------------------------------------------------------------------------------------------

export interface PostjudgmentYear {
  from: number;
  /** Exclusive end (the next anniversary, or the payment date). */
  to: number;
  days: number;
  openingCents: number;
  interestCents: number;
  closingCents: number;
}

export interface PostjudgmentResult {
  years: PostjudgmentYear[];
  amountCents: number;
  totalInterestCents: number;
}

/** Days of [from, to) counted against the basis: days/365, or for actual/actual each day against its year's length. */
function yearFraction(from: number, to: number, dayCount: "act365" | "actact"): number {
  if (dayCount === "act365") return (to - from) / 365;
  let f = 0;
  let d = from;
  while (d < to) {
    const { y } = civilFromDay(d);
    const next = Math.min(to, civilDay(y + 1, 1, 1));
    f += (next - d) / (isLeapYear(y) ? 366 : 365);
    d = next;
  }
  return f;
}

/** Post-judgment interest: daily accrual, compounded on each anniversary of the judgment date. */
export function postjudgmentInterest(o: {
  amount: number;
  /** Annual rate as a decimal. */
  rate: number;
  judgment: number;
  payment: number;
  dayCount: "act365" | "actact";
}): PostjudgmentResult | { error: string } {
  if (!Number.isFinite(o.amount) || o.amount < 0) return { error: "The judgment amount must be zero or positive." };
  if (o.amount > MAX_AMOUNT) return { error: `Judgment amounts above ${finMoney(MAX_AMOUNT)} are outside this calculator.` };
  if (!Number.isFinite(o.rate) || o.rate < 0) return { error: "The rate must be zero or positive." };
  if (o.rate > 1) return { error: "The rate is above 100%. Enter the annual rate in percent (4.12 for 4.12%)." };
  if (o.payment < o.judgment) {
    return { error: `The payment date (${longDate(o.payment)}) is before the judgment date (${longDate(o.judgment)}).` };
  }
  const years: PostjudgmentYear[] = [];
  let balance = toCents(o.amount);
  const amountCents = balance;
  let total = 0;
  for (let k = 0; ; k++) {
    const from = addMonthsClamped(o.judgment, 12 * k);
    if (from >= o.payment && k > 0) break;
    const to = Math.min(addMonthsClamped(o.judgment, 12 * (k + 1)), o.payment);
    const interest = toCents((balance / 100) * o.rate * yearFraction(from, to, o.dayCount));
    years.push({ from, to, days: to - from, openingCents: balance, interestCents: interest, closingCents: balance + interest });
    balance += interest;
    total += interest;
    if (to >= o.payment) break;
  }
  return { years, amountCents, totalInterestCents: total };
}

function postjudgmentFigure(res: PostjudgmentResult): string | undefined {
  if (res.years.length === 0 || res.years[res.years.length - 1].to === res.years[0].from) return undefined;
  const pts: Point[] = [{ x: decimalYear(res.years[0].from), y: res.amountCents / 100 }];
  for (const y of res.years) pts.push({ x: decimalYear(y.to), y: y.closingCents / 100 });
  return finPlotSvg([{ points: pts, type: "line", color: "#2563eb", label: "judgment + interest" }], {
    width: 380,
    height: 250,
    title: "Balance with post-judgment interest (from the inputs given)",
    xlabel: "year",
    ylabel: "amount",
  });
}

/** The whole post-judgment calculation from the pane's field text. */
export function postjudgmentReport(f: { amount: number; ratePct: number; judgment: string; payment: string; dayCount: string }): DamagesReport {
  const refuse = (text: string): DamagesReport => ({ ok: false, text });
  const dayCount = (["act365", "actact"] as const).find((m) => m === f.dayCount);
  if (!dayCount) return refuse("Choose a day count.");
  const j = parseDateField(f.judgment, "judgment date");
  if (typeof j !== "number") return refuse(j.error);
  const p = parseDateField(f.payment, "payment date");
  if (typeof p !== "number") return refuse(p.error);
  if (!Number.isFinite(f.amount)) return refuse("Enter the judgment amount.");
  if (!Number.isFinite(f.ratePct)) return refuse("Enter the rate.");
  if (f.ratePct < 0) return refuse("The rate must be zero or positive.");
  const res = postjudgmentInterest({ amount: f.amount, rate: f.ratePct / 100, judgment: j, payment: p, dayCount });
  if ("error" in res) return refuse(res.error);
  const final = res.amountCents + res.totalInterestCents;
  const rows: string[][] = [["Year", "From", "To (day before)", "Days", "Opening balance", "Interest", "Closing balance"]];
  res.years.forEach((y, i) => {
    rows.push([
      String(i + 1),
      longDate(y.from),
      y.days > 0 ? longDate(y.to - 1) : longDate(y.from),
      y.days.toLocaleString("en-US"),
      money(y.openingCents),
      money(y.interestCents),
      money(y.closingCents),
    ]);
  });
  const days = p - j;
  rows.push(["Total", "", "", days.toLocaleString("en-US"), money(res.amountCents), money(res.totalInterestCents), money(final)]);
  const text = [
    "Post-judgment interest, computed from the inputs given",
    `Judgment ${money(res.amountCents)} + interest ${money(res.totalInterestCents)} = ${money(final)} on ${longDate(p)}`,
    `Rate ${ratePct(f.ratePct / 100)} a year (as entered), from ${longDate(j)} to ${longDate(p)} (${days.toLocaleString("en-US")} days), day count ${
      dayCount === "act365" ? "actual/365" : "actual/actual (a day in a leap year counts 1/366)"
    }.`,
    "Note: 28 U.S.C. § 1961(b): “Interest shall be computed daily to the date of payment … and shall be compounded annually.”",
    "Note: § 1961(a) sets the rate as “the weekly average 1-year constant maturity Treasury yield … for the calendar week preceding the date of the judgment”; the rate here is the one entered.",
    "Note: interest is compounded on each anniversary of the judgment date; each year's interest is rounded to the cent and added to the balance; a partial final year is simple.",
  ].join("\n");
  return { ok: true, text, table: { label: "Post-judgment interest by year", rows }, svg: postjudgmentFigure(res) };
}
