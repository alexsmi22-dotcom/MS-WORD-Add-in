/**
 * Release F1 (v2.202.0) schedules and statement analysis (gap items #9 and #13, defects D7 and D11, quick wins 5, 6
 * and the break-even half of 12), spread into the pane's FIN_CALCS:
 *  - loan-schedule    Amortization schedule with extra payments, balloon and rate changes   engine loanSchedule.ts
 *  - depr-schedule    Depreciation schedule: SL, DB, DB → SL, SYD, units of production      engine depreciation.ts
 *  - macrs            MACRS from IRS Publication 946 Appendix A (GDS and straight line)       engine macrs.ts + macrsTables.ts
 *  - fin-ratios       Ratio suite, DuPont 3- and 5-step, cash conversion cycle                engine statements.ts
 *  - fin-common-size  Common-size and trend statement                                         engine statements.ts
 *  - altman-z         Altman Z, Z′ and Z″                                                     engine statements.ts
 *  - cvp-breakeven    Break-even and cost-volume-profit with the margin of safety              engine statements.ts
 *
 * Schedules are Word tables (≤ 6 columns); long schedules are summarised by year and capped by name. The worked
 * defaults are invented numbers (no client data). The bond cash-flow schedule is bond-dates (bondCalcs.ts).
 */
import type { FinCalcDef, FinResult, FinTable } from "./finCalc";
import { finRefusal as finRefusalRaw } from "./finCalc";

/**
 * The em dash is the pane's non-finite sentinel and never belongs in a result; the shared readers (readDataBlock and
 * the comma readers behind it, readCalcList) write some messages with one, and they reach the user through here.
 */
const noEmDash = (s: string): string => s.replace(/\s*—\s*/g, ": ");
const finRefusal = (s: string): FinResult => finRefusalRaw(noEmDash(s));
import { readFinanceField } from "./finance";
import { finPlotSvg } from "./financeFigures";
import type { Point, Series } from "./plot";
import { hBarSvg } from "./mechchart";
import { readDataBlock } from "./dataBlock";
import { readCalcList, ListTokenError } from "./calcList";
import { loanSchedule, LoanInput, LoanResult } from "./loanSchedule";
import { depreciationSchedule, DeprMethod, DeprRow, MAX_DEPR_LIFE } from "./depreciation";
import { macrsRates, macrsSchedule, MacrsConvention, MacrsMethod, MACRS_SL_PERIODS, PUB946_SOURCE, MacrsRow } from "./macrs";
import {
  readStatement,
  ratioSuite,
  duPont,
  altmanZ,
  cvp,
  Statement,
  Figure,
  RatioOptions,
  LINE_ITEMS,
  ITEM_NAME,
  AltmanVariant,
  CvpInput,
  CvpResult,
  normaliseItemName,
} from "./statements";

// ------------------------------------------------------------------------------------------------------------------
// Formatting (true minus, grouped thousands; non-finite values are refused before they reach these)
// ------------------------------------------------------------------------------------------------------------------

function fx(x: number, dp: number): string {
  const s = x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (/^-0(?:\.0*)?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
const money = (x: number): string => fx(x, 2);
const pct = (x: number, dp = 2): string => fx(x * 100, dp) + "%";
const count = (n: number): string => n.toLocaleString("en-US");

type Read = (k: string) => string;

/** A number field (already through readFinanceField in the pane; read again here so a direct call is held to it). */
function num(r: Read, key: string, label: string, o: { min?: number; max?: number; minOpen?: boolean; int?: boolean } = {}): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `Enter the ${label}.`;
  const v = readFinanceField(raw);
  if (!Number.isFinite(v)) return `${label}: “${raw}” is not a finite number.`;
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${label} must be ${o.minOpen ? "above" : "at least"} ${fx(o.min, 0)}.`;
  if (o.max !== undefined && v > o.max) return `${label} must be at most ${fx(o.max, 0)}.`;
  if (o.int && !Number.isInteger(v)) return `${label} must be a whole number (got ${raw}).`;
  return v;
}
/** An optional number field: blank → undefined. */
function optNum(r: Read, key: string, label: string, o: Parameters<typeof num>[3] = {}): number | undefined | string {
  if (!(r(key) ?? "").trim()) return undefined;
  return num(r, key, label, o);
}

/** A long table body: up to 80 rows; past that the first 60, an ellipsis row and the last 20 (the note says so). */
function capRows(body: string[][], width: number): { rows: string[][]; omitted: string } {
  if (body.length <= 80) return { rows: body, omitted: "" };
  return {
    rows: [...body.slice(0, 60), Array(width).fill("…"), ...body.slice(-20)],
    omitted: ` ${count(body.length)} rows: rows 61 to ${count(body.length - 20)} are omitted from the table (the totals include them).`,
  };
}

/** Pasted "number, number" rows (payment number, amount or rate). */
function readPairs(text: string, what: string, second: string, maxRows: number): { a: number; b: number; line: number }[] | string {
  if (!(text ?? "").trim()) return [];
  const blk = readDataBlock(text, what, { maxRows });
  if (!blk.ok) return blk.error;
  const out: { a: number; b: number; line: number }[] = [];
  for (let i = 0; i < blk.rows.length; i++) {
    const row = blk.rows[i];
    if (row.length !== 2 || row.some((v) => v === null || !Number.isFinite(v)))
      return `${what}, line ${blk.lines[i]}: needs two numbers, the payment number and the ${second}.`;
    out.push({ a: row[0] as number, b: row[1] as number, line: blk.lines[i] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// Figures (all through finPlotSvg / hBarSvg)
// ------------------------------------------------------------------------------------------------------------------

/** Loan balance over time, with the extra payments and for the plain loan. */
export function loanBalanceSvg(res: LoanResult, plain: LoanResult | null, principal: number, m: number): string | undefined {
  const pts = (x: LoanResult): Point[] => {
    const stride = Math.max(1, Math.ceil(x.rows.length / 400));
    const p: Point[] = [{ x: 0, y: principal }];
    x.rows.forEach((r, i) => {
      if (i % stride === 0 || i === x.rows.length - 1) p.push({ x: r.k / m, y: r.balance });
    });
    return p;
  };
  const series: Series[] = [];
  if (plain) series.push({ points: pts(plain), type: "line", color: "#6b7280", label: "without extra payments" });
  series.push({ points: pts(res), type: "line", color: "#2563eb", label: plain ? "with extra payments" : "balance" });
  if (series[series.length - 1].points.length < 2) return undefined;
  return finPlotSvg(series, { width: 380, height: 260, title: "Loan balance over time", xlabel: "years", ylabel: "balance" });
}

/** Book value by year (depreciation and MACRS), starting at the cost/basis. */
export function bookValueSvg(cost: number, closing: number[], salvage: number, title: string): string | undefined {
  if (closing.length < 1) return undefined;
  const pts: Point[] = [{ x: 0, y: cost }, ...closing.map((v, i) => ({ x: i + 1, y: v }))];
  const series: Series[] = [{ points: pts, type: "line", color: "#2563eb", label: "book value" }];
  if (salvage > 0) series.push({ points: [{ x: 0, y: salvage }, { x: closing.length, y: salvage }], type: "line", color: "#6b7280", label: "salvage value" });
  return finPlotSvg(series, { width: 380, height: 250, title, xlabel: "year", ylabel: "book value" });
}

/** Cost-volume-profit chart: revenue, total cost and fixed cost against units, with break-even and the sales level. */
export function cvpChartSvg(inp: CvpInput, res: CvpResult): string | undefined {
  const xMax = Math.max(inp.units, res.breakEvenUnits, res.targetUnits ?? 0) * 1.3 || 1;
  const line = (f: (u: number) => number): Point[] => [0, xMax].map((u) => ({ x: u, y: f(u) }));
  const series: Series[] = [
    { points: line((u) => inp.price * u), type: "line", color: "#2563eb", label: "revenue" },
    { points: line((u) => inp.fixedCosts + inp.variableCost * u), type: "line", color: "#b91c1c", label: "total cost" },
    { points: line(() => inp.fixedCosts), type: "line", color: "#6b7280", label: "fixed cost" },
    { points: [{ x: res.breakEvenUnits, y: res.breakEvenRevenue }], type: "scatter", color: "#111827", label: "break-even" },
  ];
  if (inp.units > 0) series.push({ points: [{ x: inp.units, y: 0 }, { x: inp.units, y: res.revenue }], type: "line", color: "#16a34a", label: "sales (margin of safety: from break-even to here)" });
  return finPlotSvg(series, { width: 380, height: 270, title: "Cost-volume-profit: break-even and margin of safety", xlabel: "units sold", ylabel: "amount" });
}

// ------------------------------------------------------------------------------------------------------------------
// Loan schedule
// ------------------------------------------------------------------------------------------------------------------

const EVERY_PAYMENT_MAX = 360;

function monthsText(payments: number, m: number): string {
  if (m === 12) return `${count(payments)} month${payments === 1 ? "" : "s"}`;
  const months = (payments * 12) / m;
  return `${count(payments)} payment${payments === 1 ? "" : "s"} (${fx(months, Number.isInteger(months) ? 0 : 1)} months)`;
}
function yearsMonths(k: number, m: number): string {
  const months = Math.round((k * 12) / m);
  const y = Math.floor(months / 12);
  const mo = months % 12;
  return [y ? `${y} year${y === 1 ? "" : "s"}` : "", mo ? `${mo} month${mo === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "0 months";
}

export function loanScheduleCalc(r: Read): FinResult {
  const P = num(r, "p", "loan amount", { min: 0, minOpen: true, max: 1e13 });
  if (typeof P === "string") return finRefusal(P);
  const ratePct = num(r, "rate", "annual interest rate (%)", { min: 0, max: 100 });
  if (typeof ratePct === "string") return finRefusal(ratePct);
  const years = num(r, "years", "loan term (years)", { min: 0, minOpen: true, max: 1000 });
  if (typeof years === "string") return finRefusal(years);
  const m = Number(r("m"));
  if (![1, 2, 4, 12, 24, 26, 52].includes(m)) return finRefusal("Payments per year must be 1, 2, 4, 12, 24, 26 or 52.");
  const nRaw = years * m;
  const n = Math.round(nRaw);
  if (Math.abs(nRaw - n) > 1e-9 || n < 1) return finRefusal(`Loan term × payments per year must be a whole number of payments (${fx(years, 4)} × ${m} = ${fx(nRaw, 4)}).`);
  const amortYears = optNum(r, "amort", "amortise-over term (years)", { min: 0, minOpen: true, max: 1000 });
  if (typeof amortYears === "string") return finRefusal(amortYears);
  const balloon = optNum(r, "balloon", "balloon", { min: 0, max: 1e13 });
  if (typeof balloon === "string") return finRefusal(balloon);
  if (amortYears !== undefined && balloon !== undefined && balloon > 0) return finRefusal("Give either a balloon amount or an amortise-over term, not both (a longer amortization term already sets the balloon).");
  if (balloon !== undefined && balloon > P) return finRefusal(`The balloon (${money(balloon)}) cannot exceed the loan amount (${money(P)}): that is negative amortization, which is not modelled.`);
  let amortN: number | undefined;
  if (amortYears !== undefined) {
    const a = amortYears * m;
    amortN = Math.round(a);
    if (Math.abs(a - amortN) > 1e-9) return finRefusal(`Amortise-over term × payments per year must be a whole number of payments (got ${fx(a, 4)}).`);
    if (amortN < n) return finRefusal("The amortise-over term cannot be shorter than the loan term.");
    if (amortN === n) amortN = undefined;
  }
  const extra = optNum(r, "extra", "extra principal each payment", { min: 0, max: 1e13 });
  if (typeof extra === "string") return finRefusal(extra.startsWith("extra principal each payment must be at least") ? "Extra principal each payment cannot be negative." : extra);
  const extraFrom = optNum(r, "extrafrom", "first payment with the extra principal", { min: 1, int: true });
  if (typeof extraFrom === "string") return finRefusal(extraFrom);
  const lumpRows = readPairs(r("lumps"), "One-off extra payments", "amount", 600);
  if (typeof lumpRows === "string") return finRefusal(lumpRows);
  const lumps = new Map<number, number>();
  for (const x of lumpRows) {
    if (!Number.isInteger(x.a) || x.a < 1 || x.a > n) return finRefusal(`One-off extra payments, line ${x.line}: the payment number must be a whole number from 1 to ${count(n)} (got ${fx(x.a, 2)}).`);
    if (x.b < 0) return finRefusal(`One-off extra payments, line ${x.line}: an extra payment cannot be negative (borrowing more is not modelled).`);
    if (lumps.has(x.a)) return finRefusal(`One-off extra payments: payment ${count(x.a)} is listed twice; put the total on one line.`);
    lumps.set(x.a, x.b);
  }
  const changeRows = readPairs(r("changes"), "Rate changes", "new annual rate (%)", 120);
  if (typeof changeRows === "string") return finRefusal(changeRows);
  const changes: { k: number; rate: number }[] = [];
  for (const x of changeRows) {
    if (!Number.isInteger(x.a) || x.a < 2 || x.a > n) return finRefusal(`Rate changes, line ${x.line}: the payment number must be a whole number from 2 to ${count(n)} (the rate for payment 1 is the annual interest rate).`);
    if (x.b < 0 || x.b > 100) return finRefusal(`Rate changes, line ${x.line}: the new rate must be from 0% to 100%.`);
    if (changes.some((c) => c.k === x.a)) return finRefusal(`Rate changes: payment ${count(x.a)} is listed twice.`);
    changes.push({ k: x.a, rate: x.b / 100 });
  }
  changes.sort((a, b) => a.k - b.k);
  const base: LoanInput = { principal: P, annualRate: ratePct / 100, n, m, amortN, balloon, rateChanges: changes };
  const hasExtra = (extra ?? 0) > 0 || [...lumps.values()].some((v) => v > 0);
  const res = loanSchedule({ ...base, extra, extraFrom: extraFrom ?? 1, lumps });
  if ("error" in res) return finRefusal(res.error);
  const plain = hasExtra ? loanSchedule(base) : null;
  if (plain && "error" in plain) return finRefusal(plain.error);
  for (const x of [res, plain]) if (x && ![x.totalInterest, x.totalPaid, x.payment0].every(Number.isFinite)) return finRefusal("The amounts are too large to schedule.");

  const per = m === 12 ? "monthly" : m === 1 ? "annually" : `${m} times a year`;
  const lines = [
    `Loan ${money(P)} at ${fx(ratePct, 4).replace(/\.?0+$/, "")}% a year, paid ${per} for ${fx(years, 4).replace(/\.?0+$/, "")} years (${count(n)} payments)`,
    `Scheduled payment = ${money(res.payment0)}` + (amortN ? ` (amortised over ${count(amortN)} payments)` : ""),
  ];
  for (const c of res.recasts) lines.push(`From payment ${count(c.k)}: ${fx(c.rate * 100, 4).replace(/\.?0+$/, "")}% a year, payment re-amortised to ${money(c.payment)}`);
  const ignoredChanges = changes.filter((c) => c.k > res.payoffK);
  if (ignoredChanges.length) lines.push(`Rate changes after the loan is paid off (payment ${ignoredChanges.map((c) => count(c.k)).join(", ")}) do not apply.`);
  if (res.balloonPaid > 0) lines.push(`Balloon paid with payment ${count(res.payoffK)} = ${money(res.balloonPaid)} (on top of that payment’s ${money(res.rows[res.rows.length - 1].interest + (res.rows[res.rows.length - 1].principal - res.balloonPaid))} of scheduled interest and principal)`);
  if (hasExtra && plain && !("error" in plain)) {
    const parts: string[] = [];
    if ((extra ?? 0) > 0) parts.push(`${money(extra!)} each payment from payment ${count(extraFrom ?? 1)}`);
    const lumpList = [...lumps.entries()].filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
    if (lumpList.length) parts.push(`one-off ${lumpList.slice(0, 6).map(([k, v]) => `${money(v)} at payment ${count(k)}`).join(", ")}${lumpList.length > 6 ? ` and ${lumpList.length - 6} more` : ""}`);
    lines.push(`Extra principal: ${parts.join("; ")}; ${money(res.totalExtra)} extra paid in all`);
    const late = lumpList.filter(([k]) => k > res.payoffK);
    if (late.length) lines.push(`One-off payments listed after the payoff (payment ${late.map(([k]) => count(k)).join(", ")}) were not needed.`);
    const saved = plain.payoffK - res.payoffK;
    lines.push(
      res.payoffK < n
        ? `Paid off with payment ${count(res.payoffK)} (${yearsMonths(res.payoffK, m)}) instead of payment ${count(plain.payoffK)} (${yearsMonths(plain.payoffK, m)})`
        : `Paid off with the last scheduled payment (payment ${count(n)})${res.balloonPaid > 0 ? "; the extra payments reduce the balloon instead" : ""}`,
    );
    lines.push(`Total interest = ${money(res.totalInterest)} against ${money(plain.totalInterest)} without the extra payments: interest saved = ${money(plain.totalInterest - res.totalInterest)}`);
    lines.push(`Time saved = ${monthsText(saved, m)}`);
    if (changes.length) lines.push("With rate changes, extra payments made before a change lower the re-amortised payment, so the time saved can be small while the interest saved is not.");
  } else {
    lines.push(`Total interest = ${money(res.totalInterest)}`);
  }
  lines.push(`Total paid = ${money(res.totalPaid)}`);
  lines.push(
    `Conventions: periodic rate = annual rate ÷ ${m} (nominal, compounded with each payment); interest = balance × periodic rate; payment P·i/(1 − (1 + i)⁻ⁿ)` +
      `${balloon ? ", less the balloon’s present value (numpy-financial pmt with fv)" : ""}${amortN ? ", computed over the amortise-over term, the balance at the loan term due as a balloon" : ""}; ` +
      `extra payments go to principal and the scheduled payment stays level (the loan ends sooner); an extra payment larger than the balance is cut to the balance; ` +
      `${changes.length ? "at each rate change the payment is re-amortised over the scheduled payments left (an adjustable-rate recast); " : ""}` +
      `amounts are not rounded to cents (a lender’s cent-rounded schedule differs by cents).`,
  );

  // tables
  const tables: FinTable[] = [];
  const every = r("view") === "every";
  const tooLong = every && res.rows.length > EVERY_PAYMENT_MAX;
  if (every && !tooLong) {
    tables.push({
      label: "Amortization schedule, every payment",
      rows: [
        ["Payment", "Scheduled payment", "Extra principal", "Interest", "Principal", "Balance"],
        ...res.rows.map((x) => [count(x.k), money(x.payment), money(x.extra), money(x.interest), money(x.principal), money(x.balance)]),
        ["Total", money(res.totalPaid - res.totalExtra), money(res.totalExtra), money(res.totalInterest), money(P), ""],
      ],
      align: ["right", "right", "right", "right", "right", "right"],
      note: "Principal includes the extra principal.",
    });
  } else {
    const body: string[][] = [];
    for (let y = 1; (y - 1) * m < res.rows.length; y++) {
      const rs = res.rows.slice((y - 1) * m, y * m);
      const interest = rs.reduce((a, x) => a + x.interest, 0);
      const principal = rs.reduce((a, x) => a + x.principal, 0);
      const ex = rs.reduce((a, x) => a + x.extra, 0);
      body.push([count(y), money(interest), money(principal), money(ex), money(interest + principal), money(rs[rs.length - 1].balance)]);
    }
    const c = capRows(body, 6);
    tables.push({
      label: "Amortization schedule by year",
      rows: [["Year", "Interest", "Principal", "Of which extra", "Total paid", "Ending balance"], ...c.rows, ["Total", money(res.totalInterest), money(P), money(res.totalExtra), money(res.totalPaid), ""]],
      align: ["right", "right", "right", "right", "right", "right"],
      note:
        `Year y is payments ${m === 1 ? "y" : `${m}(y − 1) + 1 to ${m}y`}. Principal includes the extra principal.` +
        (tooLong ? ` The every-payment table holds at most ${EVERY_PAYMENT_MAX} rows and this schedule has ${count(res.rows.length)}, so it is summarised by year.` : "") +
        c.omitted,
    });
  }
  return { text: lines.join("\n"), svg: loanBalanceSvg(res, plain as LoanResult | null, P, m), tables };
}

// ------------------------------------------------------------------------------------------------------------------
// Depreciation
// ------------------------------------------------------------------------------------------------------------------

const METHOD_NAME: Record<DeprMethod, string> = {
  sl: "straight line",
  db: "declining balance",
  dbsl: "declining balance switching to straight line",
  syd: "sum-of-the-years’-digits",
  uop: "units of production",
};

const SHORT_METHOD: Record<DeprMethod, string> = { sl: "straight line", db: "declining balance", dbsl: "DB → SL", syd: "SYD", uop: "units of production" };

export function deprScheduleCalc(r: Read): FinResult {
  const method = r("method") as DeprMethod;
  if (!(method in METHOD_NAME)) return finRefusal("Choose a depreciation method.");
  const cost = num(r, "cost", "cost", { min: 0, minOpen: true, max: 1e13 });
  if (typeof cost === "string") return finRefusal(cost);
  const salvage = num(r, "salvage", "salvage value", { min: 0, max: 1e13 });
  if (typeof salvage === "string") return finRefusal(salvage);
  if (salvage > cost) return finRefusal("Salvage value cannot exceed the cost (the asset would appreciate, not depreciate).");
  let life = 0;
  let factor: number | undefined;
  let units: number[] | undefined;
  let totalUnits: number | undefined;
  const notes: string[] = [];
  if (method === "uop") {
    try {
      const l = readCalcList(r("units") ?? "");
      units = l.values;
      if (l.note) notes.push(l.note);
    } catch (e) {
      // the list reader's message uses an em dash, the pane's non-finite sentinel: never in a result
      if (e instanceof ListTokenError) return finRefusal(`Units produced each year: ${e.message.replace(/\s*—\s*/g, ": ")}`);
      throw e;
    }
    if (!units.length) return finRefusal("Units produced each year: enter one number per year.");
    const t = optNum(r, "totalunits", "total units over the asset’s life", { min: 0, minOpen: true, max: 1e15 });
    if (typeof t === "string") return finRefusal(t);
    totalUnits = t;
  } else {
    const L = num(r, "life", "useful life (years)", { min: 1, max: MAX_DEPR_LIFE, int: true });
    if (typeof L === "string") return finRefusal(L);
    life = L;
    if (method === "db" || method === "dbsl") {
      const f = num(r, "factor", "declining-balance factor", { min: 0, minOpen: true, max: 10 });
      if (typeof f === "string") return finRefusal(f);
      factor = f;
    }
  }
  const s = depreciationSchedule({ method, cost, salvage, life, factor, units, totalUnits });
  if ("error" in s) return finRefusal(s.error);
  const total = s.rows.reduce((a, x) => a + x.depreciation, 0);
  const lines = [
    `${METHOD_NAME[method][0].toUpperCase() + METHOD_NAME[method].slice(1)}: cost ${money(cost)}, salvage ${money(salvage)}, ${method === "uop" ? `${count(s.rows.length)} years of production` : `useful life ${count(life)} years`}` +
      (factor !== undefined ? `, factor ${fx(factor, 4).replace(/\.?0+$/, "")} (rate ${pct(factor / life, 4)} of book value a year)` : ""),
    `Depreciable amount = ${money(cost - salvage)}; depreciated over the schedule = ${money(total)}; closing book value = ${money(s.rows[s.rows.length - 1].closing)}`,
  ];
  if (method === "sl") lines.push(`Annual charge = (cost − salvage) ÷ life = ${money((cost - salvage) / life)}`);
  if (method === "syd") lines.push(`Sum of the years’ digits = ${count((life * (life + 1)) / 2)}; year k charge = (cost − salvage) × (${life} − k + 1) ÷ ${count((life * (life + 1)) / 2)}`);
  if (method === "dbsl") lines.push(s.switchYear ? `Switches to straight line in year ${s.switchYear}, the first year (book − salvage) ÷ years left exceeds the declining-balance charge` : "Declining balance reaches salvage without a switch (straight line never gives the larger charge).");
  if (method === "db" && s.shortfall > 1e-9 * cost)
    lines.push(`Book value ends ${money(s.shortfall)} above salvage: declining balance alone does not reach salvage at this factor and life. Choose “declining balance switching to straight line” to depreciate the whole amount.`);
  if (method === "uop") {
    lines.push(`Rate = (cost − salvage) ÷ ${count(s.totalUnits!)} total units = ${fx((cost - salvage) / s.totalUnits!, 6)} per unit${totalUnits === undefined ? " (total units = the sum of the years listed)" : ""}`);
    if (s.unitsCapped) lines.push("The units listed exceed the total-units estimate: depreciation stops at salvage.");
    else if (s.shortfall > 1e-9 * cost) lines.push(`Book value ends ${money(s.shortfall)} above salvage: the years listed use fewer units than the estimate.`);
  }
  lines.push(...notes);
  lines.push(
    `Conventions: whole years, the asset placed in service at the start of year 1 (no part-year convention); ` +
      (method === "sl" ? "equal charges (Excel SLN)." : "") +
      (method === "db" ? "charge = book value × factor ÷ life, never taking book value below salvage (Excel DDB); no switch to straight line." : "") +
      (method === "dbsl" ? "charge = the larger of book value × factor ÷ life and (book − salvage) ÷ years left, never below salvage (Excel VDB with no_switch FALSE)." : "") +
      (method === "syd" ? "charges in proportion to the years left (Excel SYD)." : "") +
      (method === "uop" ? "charge in proportion to units produced, never below salvage." : "") +
      " A book (financial-reporting) method; US tax depreciation is MACRS.",
  );
  const sw = method === "dbsl";
  const head = method === "uop" ? ["Year", "Units", "Depreciation", "Accumulated", "Closing book value"] : ["Year", "Opening book value", "Depreciation", "Accumulated", "Closing book value", ...(sw ? ["Charge"] : [])];
  const row = (x: DeprRow): string[] =>
    method === "uop" ? [count(x.year), fx(x.units ?? 0, 2).replace(/\.00$/, ""), money(x.depreciation), money(x.accumulated), money(x.closing)] : [count(x.year), money(x.opening), money(x.depreciation), money(x.accumulated), money(x.closing), ...(sw ? [x.basis === "SL" ? "straight line" : "declining balance"] : [])];
  const c = capRows(s.rows.map(row), head.length);
  const table: FinTable = {
    label: `Depreciation schedule (${METHOD_NAME[method]})`,
    rows: [head, ...c.rows, method === "uop" ? ["Total", fx(s.rows.reduce((a, x) => a + (x.units ?? 0), 0), 2).replace(/\.00$/, ""), money(total), "", ""] : ["Total", "", money(total), "", "", ...(sw ? [""] : [])]],
    align: head.map((_, i) => (i === 5 ? "left" : "right")),
    note: c.omitted.trim() || undefined,
  };
  return {
    text: lines.join("\n"),
    svg: bookValueSvg(cost, s.rows.map((x) => x.closing), salvage, `Book value by year (${SHORT_METHOD[method]})`),
    tables: [table],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// MACRS
// ------------------------------------------------------------------------------------------------------------------

const CONV_NAME: Record<MacrsConvention, string> = {
  hy: "half-year convention",
  q1: "mid-quarter convention, placed in service in the first quarter",
  q2: "mid-quarter convention, placed in service in the second quarter",
  q3: "mid-quarter convention, placed in service in the third quarter",
  q4: "mid-quarter convention, placed in service in the fourth quarter",
};

export function macrsCalc(r: Read): FinResult {
  const basis = num(r, "basis", "depreciable basis", { min: 0, minOpen: true, max: 1e13 });
  if (typeof basis === "string") return finRefusal(basis);
  const system = r("system") as MacrsMethod;
  if (system !== "gds" && system !== "sl") return finRefusal("Choose GDS (declining balance) or straight line (ADS or the GDS election).");
  const conv = r("conv") as MacrsConvention;
  if (!(conv in CONV_NAME)) return finRefusal("Choose the half-year or a mid-quarter convention.");
  const period = (system === "gds" ? r("class") : r("slperiod")).trim();
  const rates = macrsRates(system, period, conv);
  if ("error" in rates) return finRefusal(rates.error);
  const rows = macrsSchedule(basis, rates.published);
  const sysName = system === "gds" ? `GDS, ${rates.methodName} switching to straight line` : "straight line (ADS, or the GDS straight-line election)";
  const lines = [
    `MACRS ${sysName}, ${period}-year recovery period, ${CONV_NAME[conv]}: basis ${money(basis)}`,
    `Recovered over ${rows.length} tax years: ${rows.map((x) => `${fx(x.rate, rates.published[0].split(".")[1]?.length ?? 2)}%`).join(", ")}`,
    `Depreciation in year 1 = ${money(rows[0].depreciation)}; total = ${money(rows[rows.length - 1].accumulated)}`,
    rates.differ.length === 0
      ? `Method check: every rate in this column re-derives exactly from the method (${rates.methodName}${system === "gds" ? " switching to straight line" : ""}, ${conv === "hy" ? "half-year" : "mid-quarter"} first year, rounded as printed).`
      : `Method check: the printed table differs from the method in recovery year${rates.differ.length === 1 ? "" : "s"} ${rates.differ.join(", ")}: ${rates.deviation?.why ?? "unexplained (please report this)"}. The published rates are used.`,
    `Source: ${PUB946_SOURCE}, Table ${rates.table} (the 2025 edition, for 2025 returns).`,
    `Not tax advice. Not modelled: bonus (special) depreciation, the section 179 deduction, the disposal-year convention, short tax years, ` +
      `and the mid-month convention for real property (Tables A-6, A-7). The mid-quarter convention applies when more than 40% of the year’s depreciable basis ` +
      `is placed in service in the last three months of the tax year: check which applies (Pub 946, chapter 4).`,
    `Conventions: depreciation = unadjusted basis × the table rate for the recovery year (Pub 946’s table method); amounts are not rounded to whole dollars.`,
  ];
  const dp = Math.max(...rates.published.map((s) => (s.split(".")[1] ?? "").length));
  const row = (x: MacrsRow): string[] => [count(x.year), `${fx(x.rate, dp)}%`, money(x.depreciation), money(x.accumulated), money(x.remaining)];
  const table: FinTable = {
    label: `MACRS schedule (Pub 946 Table ${rates.table}, ${period}-year)`,
    rows: [["Recovery year", "Rate", "Depreciation", "Accumulated", "Remaining basis"], ...rows.map(row), ["Total", "100.00%", money(rows[rows.length - 1].accumulated), "", ""]],
    align: ["right", "right", "right", "right", "right"],
    note: `Rates from ${PUB946_SOURCE}, Table ${rates.table}. Not tax advice.`,
  };
  return {
    text: lines.join("\n"),
    svg: bookValueSvg(basis, rows.map((x) => x.remaining), 0, `Remaining basis by recovery year (MACRS ${period}-year)`),
    tables: [table],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Statements
// ------------------------------------------------------------------------------------------------------------------

function statementOf(r: Read, key = "stmt"): Statement | string {
  const st = readStatement(r(key) ?? "");
  if ("error" in st) return st.error;
  if (!st.items.size) {
    return (
      `None of the line items is one this calculator recognises (${st.unknown.slice(0, 5).map((l) => `“${l.label}”`).join(", ")}${st.unknown.length > 5 ? " …" : ""}). ` +
      `Recognised names: ${LINE_ITEMS.map((x) => x.names[0]).join("; ")} (and common synonyms).`
    );
  }
  return st;
}

function recognitionLines(st: Statement): string[] {
  const out: string[] = [];
  const mapped = st.lines.filter((l) => l.key && normaliseItemName(l.label) !== normaliseItemName(ITEM_NAME[l.key]));
  if (mapped.length) out.push(`Read as: ${mapped.map((l) => `“${l.label}” → ${ITEM_NAME[l.key!]}`).join("; ")}.`);
  if (st.unknown.length)
    out.push(
      `Not used (names not recognised): ${st.unknown.slice(0, 12).map((l) => `“${l.label}” (line ${l.line})`).join(", ")}${st.unknown.length > 12 ? ` and ${st.unknown.length - 12} more` : ""}. ` +
        `Recognised names include: ${LINE_ITEMS.map((x) => x.names[0]).join("; ")}.`,
    );
  out.push(...st.notes.map(noEmDash));
  return out;
}

function figText(f: Figure, unit: "times" | "%" | "days"): string {
  if (!f.ok) return "not computed";
  return unit === "%" ? pct(f.value) : unit === "days" ? `${fx(f.value, 1)} days` : `${fx(f.value, 2)}×`;
}

function ratioOptions(r: Read): RatioOptions | string {
  const days = Number(r("days"));
  if (days !== 365 && days !== 360) return "Days in the year must be 365 or 360.";
  return { days, balances: r("balances") === "average" ? "average" : "end" };
}

export function finRatiosCalc(r: Read): FinResult {
  const st = statementOf(r);
  if (typeof st === "string") return finRefusal(st);
  const opts = ratioOptions(r);
  if (typeof opts === "string") return finRefusal(opts);
  if (opts.balances === "average" && !st.hasPrior) return finRefusal("Average balances need a prior-year column (line item, this year, prior year); choose year-end balances or add the prior year.");
  const rows = ratioSuite(st, opts);
  const dp = duPont(st, opts);
  const computed = rows.filter((x) => x.current.ok);
  if (!computed.length) return finRefusal(`No ratio can be computed from these lines: ${rows.slice(0, 4).map((x) => `${x.name} ${(x.current as { why: string }).why}`).join("; ")}.`);
  const why = new Map<string, string>();
  for (const x of rows) {
    if (!x.current.ok) why.set(x.name, x.current.why);
    else if (x.prior && !x.prior.ok) why.set(`${x.name} (prior year)`, x.prior.why);
  }
  const lines = [
    `Financial ratios from ${st.lines.length} statement lines${st.hasPrior ? " (this year and the prior year)" : ""}`,
    ...rows.filter((x) => x.current.ok).map((x) => `${x.name} = ${x.formula} = ${figText(x.current, x.unit)}${x.prior && x.prior.ok ? ` (prior year ${figText(x.prior, x.unit)})` : ""}`),
  ];
  const three = dp.three.every((x) => x.value.ok);
  const five = dp.five.every((x) => x.value.ok);
  if (three) lines.push(`DuPont 3-step: ROE = net margin × asset turnover × equity multiplier = ${dp.three.map((x) => figText(x.value, x.label === "Net margin" ? "%" : "times")).join(" × ")} = ${figText(dp.roe, "%")}`);
  if (five)
    lines.push(
      `DuPont 5-step: ROE = tax burden × interest burden × EBIT margin × asset turnover × equity multiplier = ${dp.five.map((x) => (x.label === "EBIT margin" ? figText(x.value, "%") : fx((x.value as { value: number }).value, 4))).join(" × ")} = ${figText(dp.roe, "%")}`,
    );
  if (why.size) lines.push(`Not computed: ${[...why.entries()].map(([k, v]) => `${k} (${v})`).join("; ")}.`);
  lines.push(...recognitionLines(st));
  lines.push(
    `Conventions: day counts on a ${opts.days}-day year; ${opts.balances === "average" ? "balance-sheet denominators are the average of this and the prior year-end (prior-year ratios use year-end balances)" : "balance-sheet denominators are year-end balances"}; ` +
      `debt means total liabilities; quick assets are cash + marketable securities + receivables; EBIT is operating income as given, else income before tax + interest; ` +
      `income before tax is as given, else net income + income tax; gross profit is as given, else revenue − cost of goods sold; total liabilities as given, else total assets − equity.`,
  );
  const ratioTable: FinTable = {
    label: "Financial ratios",
    rows: [
      ["Category", "Ratio", "Formula", "This year", ...(st.hasPrior ? ["Prior year"] : [])],
      ...rows.map((x) => [x.category, x.name, x.formula, figText(x.current, x.unit), ...(st.hasPrior ? [figText(x.prior!, x.unit)] : [])]),
    ],
    align: ["left", "left", "left", "right", "right"],
    note: why.size ? `Not computed: ${[...why.entries()].map(([k, v]) => `${k} (${v})`).join("; ")}.` : undefined,
  };
  const dupTable: FinTable = {
    label: "DuPont analysis of return on equity",
    rows: [
      ["Step", "Component", "Formula", "Value"],
      ...dp.three.map((x) => ["3-step", x.label, x.formula, x.value.ok ? (x.label === "Net margin" ? pct(x.value.value) : fx(x.value.value, 4)) : "not computed"]),
      ...dp.five.map((x) => ["5-step", x.label, x.formula, x.value.ok ? (x.label === "EBIT margin" ? pct(x.value.value) : fx(x.value.value, 4)) : "not computed"]),
      ["", "Return on equity", `net income ÷ ${opts.balances === "average" ? "average equity" : "equity"}`, figText(dp.roe, "%")],
    ],
    align: ["left", "left", "left", "right"],
    note: "Each step’s components multiply to the return on equity (the same denominators throughout).",
  };
  return { text: lines.join("\n"), tables: [ratioTable, dupTable] };
}

export function commonSizeCalc(r: Read): FinResult {
  const st = statementOf(r);
  if (typeof st === "string") return finRefusal(st);
  const rev = st.items.get("revenue");
  const ta = st.items.get("totalAssets");
  const lines = [`Common-size${st.hasPrior ? " and trend" : ""} statement from ${st.lines.length} lines`];
  const body: string[][] = [];
  const why: string[] = [];
  const base = (sec: string, period: "current" | "prior"): number | null => {
    const l = sec === "income" ? rev : sec === "balance" ? ta : null;
    const v = l ? l[period] : null;
    return v === null || v === undefined || v === 0 ? null : v;
  };
  const order = LINE_ITEMS.filter((x) => st.items.has(x.key));
  for (const it of order) {
    const l = st.items.get(it.key)!;
    const cs = (period: "current" | "prior"): string => {
      const v = l[period];
      if (v === null) return "";
      const b = base(it.section, period);
      if (it.section === "market") return "";
      if (b === null) {
        why.push(`${it.name} ${period === "prior" ? "(prior year) " : ""}needs ${it.section === "income" ? "Revenue" : "Total assets"} (non-zero)`);
        return "not computed";
      }
      return pct(v / b);
    };
    let change = "";
    if (st.hasPrior && l.current !== null && l.prior !== null) {
      if (l.prior === 0) change = "not computed";
      else change = pct((l.current - l.prior) / Math.abs(l.prior));
    }
    body.push([it.name, l.current === null ? "" : money(l.current), cs("current"), ...(st.hasPrior ? [l.prior === null ? "" : money(l.prior), cs("prior"), change] : [])]);
  }
  if (!rev) why.push("income-statement lines need Revenue as the base");
  if (!ta) why.push("balance-sheet lines need Total assets as the base");
  lines.push(`Base: income-statement lines as a percentage of revenue${rev && rev.current !== null ? ` (${money(rev.current)})` : " (not given)"}; balance-sheet lines as a percentage of total assets${ta && ta.current !== null ? ` (${money(ta.current)})` : " (not given)"}.`);
  if (st.hasPrior) lines.push("Trend: change = (this year − prior year) ÷ |prior year|; a prior-year 0 has no percentage change.");
  if (why.length) lines.push(`Not computed: ${[...new Set(why)].join("; ")}.`);
  lines.push(...recognitionLines(st));
  lines.push("Conventions: lines appear in a fixed statement order (income statement, then balance sheet); amounts as entered; recognised lines only.");
  const head = ["Line item", "This year", "% of base", ...(st.hasPrior ? ["Prior year", "% of base", "Change"] : [])];
  return {
    text: lines.join("\n"),
    tables: [{ label: st.hasPrior ? "Common-size and trend statement" : "Common-size statement", rows: [head, ...body], align: head.map((_, i) => (i === 0 ? "left" : "right")) }],
    svg:
      rev && rev.current
        ? hBarSvg(
            order.filter((x) => x.section === "income" && st.items.get(x.key)!.current !== null).map((x) => ({ name: x.name, value: (100 * st.items.get(x.key)!.current!) / rev.current! })),
            { title: "Income statement as % of revenue", unit: "%" },
          )
        : undefined,
  };
}

const ALTMAN_NAME: Record<AltmanVariant, string> = {
  z: "original Z (1968, public manufacturing firms, market value of equity)",
  zprime: "Z′ (private firms, book value of equity)",
  zdouble: "Z″ (non-manufacturing firms, book value of equity, no sales term)",
};

export function altmanCalc(r: Read): FinResult {
  const st = statementOf(r);
  if (typeof st === "string") return finRefusal(st);
  const variant = r("variant") as AltmanVariant;
  if (!(variant in ALTMAN_NAME)) return finRefusal("Choose the Altman Z variant.");
  const a = altmanZ(st, variant);
  if ("error" in a) return finRefusal(a.error);
  const zoneName = a.zone === "safe" ? "safe zone" : a.zone === "grey" ? "grey zone" : "distress zone";
  const formula = a.x.map((x) => `${Number.isInteger(x.coef) ? fx(x.coef, 1) : fx(x.coef, 3).replace(/0+$/, "")}${x.name}`).join(" + ");
  const lines = [
    `Altman ${ALTMAN_NAME[variant]}`,
    `Z = ${formula}`,
    ...a.x.map((x) => `${x.name} = ${x.formula} = ${fx(x.value, 4)}`),
    `Z = ${fx(a.z, 4)}: ${zoneName} (above ${fx(a.cutoffs[1], 2)} safe; ${fx(a.cutoffs[0], 2)} to ${fx(a.cutoffs[1], 2)} grey; below ${fx(a.cutoffs[0], 2)} distress)`,
    variant === "z"
      ? "Source: E. I. Altman (1968), “Financial Ratios, Discriminant Analysis and the Prediction of Corporate Bankruptcy,” Journal of Finance; as Altman (2000) restates it, the function is 0.012X₁ + 0.014X₂ + 0.033X₃ + 0.006X₄ + 0.999X₅ with X₁ to X₄ entered in percent, and 1.2X₁ + 1.4X₂ + 3.3X₃ + 0.6X₄ + 1.0X₅ is the same function on ratios (X₅’s 0.999 rounded to 1.0). Cut-offs: 1.81 is the paper’s lower bound of the zone of ignorance; 2.99 is the conventional upper bound."
      : `Source: E. I. Altman (2000), “Predicting Financial Distress of Companies: Revisiting the Z-Score and ZETA® Models”.${variant === "zprime" ? " Cut-offs: its gray area, 1.23 to 2.90." : " The emerging-market constant (+3.25) in that paper is not added; the cut-offs 1.10 and 2.60 are the conventional ones for Z″ (not stated in that paper)."}`,
    ...recognitionLines(st),
    "Conventions: working capital = current assets − current liabilities; EBIT is operating income as given, else income before tax + interest; total liabilities as given, else total assets − equity; year-end balances. A screening score from the samples it was estimated on, not a prediction for any one company.",
  ];
  const table: FinTable = {
    label: `Altman ${variant === "z" ? "Z" : variant === "zprime" ? "Z′" : "Z″"}-score`,
    rows: [["Ratio", "Formula", "Value", "Coefficient", "Contribution"], ...a.x.map((x) => [x.name, x.formula, fx(x.value, 4), fx(x.coef, 3), fx(x.coef * x.value, 4)]), ["Z", "", "", "", fx(a.z, 4)]],
    align: ["left", "left", "right", "right", "right"],
    note: `${zoneName[0].toUpperCase() + zoneName.slice(1)}: cut-offs ${fx(a.cutoffs[0], 2)} and ${fx(a.cutoffs[1], 2)}.`,
  };
  const short = ["working capital", "retained earnings", "EBIT", `${variant === "z" ? "market" : "book"} equity`, "sales"];
  return { text: lines.join("\n"), tables: [table], svg: hBarSvg(a.x.map((x, i) => ({ name: `${x.name} ${short[i]}`, value: x.coef * x.value })), { title: `Contributions to Z = ${fx(a.z, 2)}`, unit: "" }) };
}

export function cvpCalc(r: Read): FinResult {
  const price = num(r, "price", "selling price per unit", { min: 0, minOpen: true, max: 1e12 });
  if (typeof price === "string") return finRefusal(price);
  const v = num(r, "vc", "variable cost per unit", { min: 0, max: 1e12 });
  if (typeof v === "string") return finRefusal(v);
  const F = num(r, "fixed", "fixed costs", { min: 0, max: 1e15 });
  if (typeof F === "string") return finRefusal(F);
  const units = num(r, "units", "units sold (expected or actual)", { min: 0, max: 1e15 });
  if (typeof units === "string") return finRefusal(units);
  const target = optNum(r, "target", "target operating profit", { min: -1e15, max: 1e15 });
  if (typeof target === "string") return finRefusal(target);
  const inp: CvpInput = { price, variableCost: v, fixedCosts: F, units, targetProfit: target };
  const c = cvp(inp);
  if ("error" in c) return finRefusal(c.error);
  const lines = [
    `Contribution margin = price − variable cost = ${money(price)} − ${money(v)} = ${money(c.cmUnit)} per unit; contribution margin ratio = ${pct(c.cmRatio)}`,
    `Break-even = fixed costs ÷ contribution margin = ${money(F)} ÷ ${money(c.cmUnit)} = ${fx(c.breakEvenUnits, 2)} units = ${money(c.breakEvenRevenue)} of revenue`,
    `At ${fx(units, 2).replace(/\.00$/, "")} units: revenue ${money(c.revenue)}, total cost ${money(c.totalCost)}, operating income ${money(c.operatingIncome)}`,
    units > 0
      ? `Margin of safety = ${fx(c.marginOfSafetyUnits, 2)} units = ${money(c.marginOfSafetyRevenue)} = ${pct(c.marginOfSafetyPct)} of sales${c.marginOfSafetyUnits < 0 ? " (negative: sales are below break-even)" : ""}`
      : "Margin of safety: no sales entered.",
    c.dol !== null ? `Degree of operating leverage = contribution ÷ operating income = ${fx(c.dol, 4)} (a 1% change in sales moves operating income ${fx(c.dol, 2)}%)` : "Degree of operating leverage: operating income is 0 (at break-even), so it has no value.",
    ...(c.targetUnits !== null ? [`Units for a target operating profit of ${money(target!)} = (fixed costs + target) ÷ contribution margin = ${fx(c.targetUnits, 2)} units (${money(c.targetUnits * price)} of revenue)`] : []),
    "Conventions: one product (or a fixed sales mix at these averages); price, variable cost per unit and fixed costs constant over the range shown; operating income before interest and tax; units need not be whole.",
  ];
  const table: FinTable = {
    label: "Cost-volume-profit",
    rows: [
      ["Measure", "Formula", "Value"],
      ["Contribution margin per unit", "price − variable cost", money(c.cmUnit)],
      ["Contribution margin ratio", "contribution margin ÷ price", pct(c.cmRatio)],
      ["Break-even units", "fixed costs ÷ contribution margin", fx(c.breakEvenUnits, 2)],
      ["Break-even revenue", "break-even units × price", money(c.breakEvenRevenue)],
      ["Operating income", "revenue − variable costs − fixed costs", money(c.operatingIncome)],
      ...(units > 0 ? [["Margin of safety", "(sales − break-even) ÷ sales", pct(c.marginOfSafetyPct)]] : []),
      ...(c.dol !== null ? [["Degree of operating leverage", "contribution ÷ operating income", fx(c.dol, 4)]] : []),
      ...(c.targetUnits !== null ? [["Units for target profit", "(fixed costs + target) ÷ contribution margin", fx(c.targetUnits, 2)]] : []),
    ],
    align: ["left", "left", "right"],
  };
  return { text: lines.join("\n"), svg: cvpChartSvg(inp, c), tables: [table] };
}

// ------------------------------------------------------------------------------------------------------------------
// Registry
// ------------------------------------------------------------------------------------------------------------------

const STATEMENT_DEFAULT = [
  "Line item\tThis year\tPrior year",
  "Net sales\t1,200,000\t1,050,000",
  "Cost of goods sold\t720,000\t651,000",
  "Operating expenses\t300,000\t270,000",
  "Operating income\t180,000\t129,000",
  "Interest expense\t30,000\t29,000",
  "Income before tax\t150,000\t100,000",
  "Income tax expense\t37,500\t25,000",
  "Net income\t112,500\t75,000",
  "Cash and equivalents\t60,000\t45,000",
  "Accounts receivable\t150,000\t140,000",
  "Inventory\t180,000\t170,000",
  "Total current assets\t400,000\t365,000",
  "Total assets\t1,000,000\t920,000",
  "Accounts payable\t90,000\t85,000",
  "Total current liabilities\t200,000\t190,000",
  "Long-term debt\t300,000\t310,000",
  "Total liabilities\t500,000\t500,000",
  "Retained earnings\t350,000\t270,000",
  "Shareholders’ equity\t500,000\t420,000",
].join("\n");

const STATEMENT_FIELD = {
  key: "stmt",
  label: "Statement: line item, amount, prior-year amount (optional), one line each (invented numbers by default)",
  default: STATEMENT_DEFAULT,
  kind: "block" as const,
};

const ALTMAN_DEFAULT = [
  "Total current assets\t400,000",
  "Total current liabilities\t200,000",
  "Total assets\t1,000,000",
  "Retained earnings\t350,000",
  "Operating income\t180,000",
  "Net sales\t1,200,000",
  "Total liabilities\t500,000",
  "Shareholders’ equity\t500,000",
  "Market value of equity\t900,000",
].join("\n");

export const SCHED_CALCS: FinCalcDef[] = [
  {
    id: "loan-schedule",
    group: "Time value & loans",
    name: "Amortization schedule (extra payments, balloon, rate changes)",
    fields: [
      { key: "p", label: "Loan amount", default: "250000" },
      { key: "rate", label: "Annual interest rate (%)", default: "6" },
      { key: "years", label: "Loan term (years)", default: "30" },
      {
        key: "m",
        label: "Payments per year",
        default: "12",
        kind: "select",
        options: [
          { value: "12", label: "12 (monthly)" },
          { value: "26", label: "26 (every two weeks)" },
          { value: "52", label: "52 (weekly)" },
          { value: "24", label: "24 (twice a month)" },
          { value: "4", label: "4 (quarterly)" },
          { value: "2", label: "2 (semiannual)" },
          { value: "1", label: "1 (annual)" },
        ],
      },
      { key: "extra", label: "Extra principal each payment (blank = none)", default: "200", optional: true },
      { key: "extrafrom", label: "Extra principal starts at payment number", default: "1", optional: true },
      { key: "lumps", label: "One-off extra payments: payment number, amount (one per line; blank = none)", default: "60\t10000", kind: "block", optional: true },
      { key: "balloon", label: "Balloon due with the last payment (blank = none)", default: "", optional: true },
      { key: "amort", label: "Amortise over (years; blank = the loan term)", default: "", optional: true },
      { key: "changes", label: "Rate changes: payment number, new annual rate (%) (blank = fixed rate)", default: "", kind: "block", optional: true },
      {
        key: "view",
        label: "Schedule table",
        default: "annual",
        kind: "select",
        options: [
          { value: "annual", label: "Summary by year" },
          { value: "every", label: `Every payment (up to ${EVERY_PAYMENT_MAX} payments)` },
        ],
      },
    ],
    assumes:
      "A fixed-payment loan with interest on the balance each period at the annual rate ÷ payments per year; no fees, escrow, insurance or prepayment penalties; " +
      "payments on schedule. Interest saved and time saved compare with the same loan (same rate changes and balloon) without the extra payments.",
    compute: (r) => {
      // the loan's schedule with extra payments, balloon and rate changes, and what the extras save
      return loanScheduleCalc(r);
    },
  },
  {
    id: "depr-schedule",
    group: "Accounting & statements",
    name: "Depreciation schedule (SL, DB, DB to SL, SYD, units of production)",
    fields: [
      {
        key: "method",
        label: "Method",
        default: "dbsl",
        kind: "select",
        options: [
          { value: "dbsl", label: "Declining balance switching to straight line (DDB → SL at factor 2)" },
          { value: "db", label: "Declining balance, no switch (Excel DDB)" },
          { value: "sl", label: "Straight line" },
          { value: "syd", label: "Sum-of-the-years’-digits" },
          { value: "uop", label: "Units of production" },
        ],
      },
      { key: "cost", label: "Cost", default: "10000" },
      { key: "salvage", label: "Salvage value", default: "0" },
      { key: "life", label: "Useful life (whole years)", default: "5" },
      { key: "factor", label: "Declining-balance factor (2 = double declining)", default: "2" },
      { key: "units", label: "Units produced each year (units of production)", default: "1200, 1500, 1000, 800, 500", kind: "list" },
      { key: "totalunits", label: "Total units over the asset’s life (blank = the sum of the years)", default: "", optional: true },
    ],
    assumes: "Book depreciation over whole years from the start of year 1; not MACRS (use the MACRS calculator for US tax).",
    compute: (r) => {
      // a year-by-year depreciation table by the chosen book method
      return deprScheduleCalc(r);
    },
  },
  {
    id: "macrs",
    group: "Accounting & statements",
    name: "MACRS tax depreciation (IRS Publication 946)",
    fields: [
      { key: "basis", label: "Depreciable basis", default: "50000" },
      {
        key: "system",
        label: "Method",
        default: "gds",
        kind: "select",
        options: [
          { value: "gds", label: "GDS declining balance (Tables A-1 to A-5)" },
          { value: "sl", label: "Straight line: ADS or the GDS election (Tables A-8 to A-12)" },
        ],
      },
      {
        key: "class",
        label: "GDS property class",
        default: "7",
        kind: "select",
        options: [
          { value: "3", label: "3-year (200% DB)" },
          { value: "5", label: "5-year (200% DB)" },
          { value: "7", label: "7-year (200% DB)" },
          { value: "10", label: "10-year (200% DB)" },
          { value: "15", label: "15-year (150% DB)" },
          { value: "20", label: "20-year (150% DB)" },
        ],
      },
      { key: "slperiod", label: "Straight-line recovery period (years)", default: "10", kind: "select", options: MACRS_SL_PERIODS.map((p) => ({ value: p, label: `${p} years` })) },
      {
        key: "conv",
        label: "Convention",
        default: "hy",
        kind: "select",
        options: [
          { value: "hy", label: "Half-year" },
          { value: "q1", label: "Mid-quarter, placed in service in quarter 1" },
          { value: "q2", label: "Mid-quarter, quarter 2" },
          { value: "q3", label: "Mid-quarter, quarter 3" },
          { value: "q4", label: "Mid-quarter, quarter 4" },
        ],
      },
    ],
    assumes:
      "Not tax advice. Pub 946 percentage tables (2025 edition) applied to the unadjusted basis; no bonus depreciation, section 179, disposal-year convention, " +
      "short tax year or real-property mid-month convention. Choosing the property class and convention is the filer’s call.",
    compute: (r) => {
      // basis × the published Pub 946 rates for each recovery year, with the method's own check of the column
      return macrsCalc(r);
    },
  },
  {
    id: "fin-ratios",
    group: "Accounting & statements",
    name: "Financial ratios and DuPont analysis",
    fields: [
      STATEMENT_FIELD,
      {
        key: "days",
        label: "Days in the year (day counts)",
        default: "365",
        kind: "select",
        options: [
          { value: "365", label: "365" },
          { value: "360", label: "360" },
        ],
      },
      {
        key: "balances",
        label: "Balance-sheet denominators",
        default: "end",
        kind: "select",
        options: [
          { value: "end", label: "Year-end balances" },
          { value: "average", label: "Average of this and the prior year-end" },
        ],
      },
    ],
    assumes: "Line items recognised by exact name (synonyms listed in the result); figures as reported, with no adjustments for leases, one-off items or off-balance-sheet debt.",
    compute: (r) => {
      // liquidity, leverage, efficiency and profitability ratios, the cash conversion cycle and DuPont
      return finRatiosCalc(r);
    },
  },
  {
    id: "fin-common-size",
    group: "Accounting & statements",
    name: "Common-size and trend statement",
    fields: [STATEMENT_FIELD],
    assumes: "Income-statement lines over revenue and balance-sheet lines over total assets; recognised line items only, in a fixed statement order.",
    compute: (r) => {
      // each line as a share of revenue or total assets, and its change on the prior year
      return commonSizeCalc(r);
    },
  },
  {
    id: "altman-z",
    group: "Accounting & statements",
    name: "Altman Z-score (Z, Z′, Z″)",
    fields: [
      { ...STATEMENT_FIELD, default: ALTMAN_DEFAULT, label: "Statement: line item, amount, one per line (invented numbers by default)" },
      {
        key: "variant",
        label: "Variant",
        default: "z",
        kind: "select",
        options: [
          { value: "z", label: "Z (1968): public manufacturing, market value of equity" },
          { value: "zprime", label: "Z′: private firms, book equity" },
          { value: "zdouble", label: "Z″: non-manufacturing, book equity" },
        ],
      },
    ],
    assumes: "A discriminant score estimated on historical US samples; a screen, not a probability of default. The variant must suit the company.",
    compute: (r) => {
      // the chosen Altman Z variant, its five (or four) ratios and the zone
      return altmanCalc(r);
    },
  },
  {
    id: "cvp-breakeven",
    group: "Accounting & statements",
    name: "Break-even and cost-volume-profit",
    fields: [
      { key: "price", label: "Selling price per unit", default: "50" },
      { key: "vc", label: "Variable cost per unit", default: "30" },
      { key: "fixed", label: "Fixed costs (for the period)", default: "40000" },
      { key: "units", label: "Units sold (expected or actual)", default: "3000" },
      { key: "target", label: "Target operating profit (blank = none)", default: "20000", optional: true },
    ],
    assumes: "Linear revenue and cost over the range: constant price, variable cost per unit and fixed costs; one product or a constant sales mix.",
    compute: (r) => {
      // contribution margin, break-even, margin of safety, operating leverage and units for a target profit
      return cvpCalc(r);
    },
  },
];

