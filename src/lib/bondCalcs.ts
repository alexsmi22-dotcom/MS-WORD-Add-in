/**
 * Fixed-income calculators on real dates and yield curves (release F1, gap items #3 and #16), spread into the pane's
 * FIN_CALCS. Engines: bondDates.ts (schedules, day counts, price/yield, durations, yield to worst, T-bills) and
 * yieldCurve.ts (bootstrap, forwards, Nelson–Siegel / Svensson). Every result prints a "Conventions:" line naming the
 * day count, compounding and schedule rules it used.
 */
import type { FinCalcDef, FinResult, FinTable } from "./finCalc";
import { finRefusal } from "./finCalc";
import { READING_MAX } from "./calcReading";
import { readFinanceField } from "./finance";
import { finPlotSvg } from "./financeFigures";
import type { Point, Series } from "./plot";
import { readDataBlock } from "./dataBlock";
import { parseDateField, longDate } from "./damagesInterest";
import {
  BASIS_NAMES,
  BASIS_RULES,
  BondBasis,
  BondResult,
  BondSpec,
  bondAtYield,
  dirtyPriceAt,
  bondPeriod,
  treasuryBill,
  yieldFromClean,
  yieldToWorst,
  BillYearBasis,
  BondPeriod,
} from "./bondDates";
import { bootstrapZeroCurve, CurveInstrument, CurveKnot, fitNelsonSiegel, NsFit, nsYield, zeroAt, NS_LAMBDA_MIN, NS_LAMBDA_MAX } from "./yieldCurve";

// ------------------------------------------------------------------------------------------------------------------
// Formatting (true minus, grouped thousands; non-finite values are refused before they reach these)
// ------------------------------------------------------------------------------------------------------------------

function fx(x: number, dp: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (/^-0(?:\.0*)?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
const pct = (x: number, dp = 6): string => fx(x * 100, dp) + "%";
const times = (f: number): string => (f === 1 ? "once a year" : `${f} times a year`);

type Read = (k: string) => string;

/** A number field (already through readFinanceField in the pane; read again here so a direct call is held to it). */
function num(r: Read, key: string, label: string, o: { min?: number; max?: number; minOpen?: boolean } = {}): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `Enter the ${label}.`;
  const v = readFinanceField(raw);
  if (!Number.isFinite(v)) return `${label}: “${raw}” is not a finite number.`;
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${label} must be ${o.minOpen ? "above" : "at least"} ${fx(o.min, 0)}.`;
  if (o.max !== undefined && v > o.max) return `${label} must be at most ${fx(o.max, 0)}.`;
  return v;
}

function date(r: Read, key: string, what: string): number | string {
  const d = parseDateField(r(key), what);
  return typeof d === "number" ? d : d.error;
}

function basisOf(r: Read): BondBasis | string {
  const b = r("basis");
  return b in BASIS_NAMES ? (b as BondBasis) : "Choose a day-count basis.";
}

function freqOf(r: Read, allowed: number[]): number | string {
  const f = Number(r("freq"));
  return allowed.includes(f) ? f : `Coupons per year must be ${allowed.join(", ").replace(/, (\d+)$/, " or $1")} (got ${r("freq") || "nothing"}).`;
}

const FREQ_FIELD = {
  key: "freq",
  label: "Coupons per year",
  default: "2",
  kind: "select" as const,
  options: [
    { value: "1", label: "1 (annual)" },
    { value: "2", label: "2 (semiannual)" },
    { value: "4", label: "4 (quarterly)" },
    { value: "12", label: "12 (monthly)" },
  ],
};
const BASIS_FIELD = {
  key: "basis",
  label: "Day-count basis",
  default: "30360us",
  kind: "select" as const,
  options: [
    { value: "30360us", label: "30/360 US (NASD), Excel basis 0" },
    { value: "actact", label: "ACT/ACT ICMA, Excel basis 1" },
    { value: "act360", label: "ACT/360, Excel basis 2" },
    { value: "act365", label: "ACT/365 Fixed, Excel basis 3" },
    { value: "30e360", label: "30E/360 (Eurobond), Excel basis 4" },
  ],
};

function bondConventions(spec: BondSpec, p: BondPeriod): string {
  return (
    `Conventions: day count ${BASIS_NAMES[spec.basis]} (${BASIS_RULES[spec.basis]}); coupon = 100 × rate/f each period; ` +
    `regular schedule dated backward from maturity` +
    `${p.schedule.eom ? ", end-of-month rule in force (maturity is a month's last day, so every coupon is)" : " on the maturity's day of month (clamped in shorter months; the end-of-month rule applies only when maturity is a month's last day)"}; ` +
    `no issue date, so no odd first or last coupon; yield compounded ${times(spec.freq)} with discount exponent (k − 1 + DSC/E) ` +
    `(Excel PRICE/YIELD), simple interest when one coupon period remains (Excel's one-period formula; there modified duration is t/(1 + y·t), where Excel's MDURATION divides by 1 + y/f); ` +
    `duration and convexity on the dirty price; prices per 100 of face.`
  );
}

/** Up to 80 schedule rows in the table: past that, the first 60, an ellipsis row and the last 20. */
function flowsTable(res: BondResult, face: number, label: string): FinTable {
  const k = face / 100;
  const row = (fl: BondResult["flows"][number]): string[] => [longDate(fl.date), fx(fl.days, 0), fx(fl.t, 6), fx(fl.cf * k, 2), fx(fl.df, 8), fx(fl.pv * k, 2)];
  const all = res.flows;
  const body = all.length <= 80 ? all.map(row) : [...all.slice(0, 60).map(row), ["…", "…", "…", "…", "…", "…"], ...all.slice(-20).map(row)];
  return {
    label,
    rows: [["Date", "Days", "Time (years)", "Cash flow", "Discount factor", "PV"], ...body, ["Total (dirty price)", "", "", "", "", fx(res.dirty * k, 2)]],
    align: ["left", "right", "right", "right", "right", "right"],
    note:
      `On a face of ${fx(face, 2)}. Days are actual days from settlement; time is (k − 1 + DSC/E)/f years, the exponent the price uses.` +
      (all.length > 80 ? ` ${all.length.toLocaleString("en-US")} payments: rows 61 to ${all.length - 20} are omitted from the table (the total includes them).` : ""),
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Figures
// ------------------------------------------------------------------------------------------------------------------

/** Clean and dirty price against yield on the bond's dates, with the solved point marked. */
export function bondDatesPriceYieldSvg(spec: BondSpec, y0: number): string | undefined {
  const p = bondPeriod(spec);
  if ("error" in p) return undefined;
  const accrued = (p.c * p.A) / p.E;
  const lo = Math.max(y0 - 0.04, -0.5 * spec.freq);
  const hi = y0 + 0.04;
  const clean: Point[] = [];
  const dirty: Point[] = [];
  for (let i = 0; i <= 80; i++) {
    const y = lo + ((hi - lo) * i) / 80;
    const d = dirtyPriceAt(p, spec, y);
    if (!Number.isFinite(d) || d <= 0) continue;
    clean.push({ x: y * 100, y: d - accrued });
    dirty.push({ x: y * 100, y: d });
  }
  const d0 = dirtyPriceAt(p, spec, y0);
  if (clean.length < 2 || !Number.isFinite(d0)) return undefined;
  const series: Series[] = [
    { points: dirty, type: "line", color: "#9333ea", label: "dirty price" },
    { points: clean, type: "line", color: "#2563eb", label: "clean price" },
    { points: [{ x: y0 * 100, y: d0 - accrued }], type: "scatter", color: "#b91c1c", label: "this bond" },
  ];
  return finPlotSvg(series, { width: 380, height: 260, title: `Price against yield, settling ${longDate(spec.settle)}`, xlabel: "yield (%)", ylabel: "price per 100" });
}

/** Clean price against yield, to maturity and to the call, with both yields at the quoted price marked. */
export function bondCallPriceYieldSvg(spec: BondSpec, callDate: number, callPrice: number, clean0: number, ytm: number, ytc: number): string | undefined {
  const mp = bondPeriod(spec);
  const cs: BondSpec = { ...spec, redeemOn: callDate, redemption: callPrice };
  const cp = bondPeriod(cs);
  if ("error" in mp || "error" in cp) return undefined;
  const acc = (mp.c * mp.A) / mp.E;
  const lo = Math.max(Math.min(ytm, ytc) - 0.03, -0.5 * spec.freq);
  const hi = Math.max(ytm, ytc) + 0.03;
  const toM: Point[] = [];
  const toC: Point[] = [];
  for (let i = 0; i <= 80; i++) {
    const y = lo + ((hi - lo) * i) / 80;
    const a = dirtyPriceAt(mp, spec, y) - acc;
    const b = dirtyPriceAt(cp, cs, y) - acc;
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      toM.push({ x: y * 100, y: a });
      toC.push({ x: y * 100, y: b });
    }
  }
  if (toM.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: toM, type: "line", color: "#2563eb", label: "to maturity" },
      { points: toC, type: "line", color: "#ea580c", label: "to call" },
      { points: [{ x: ytm * 100, y: clean0 }, { x: ytc * 100, y: clean0 }], type: "scatter", color: "#b91c1c", label: "quoted price" },
    ],
    { width: 380, height: 260, title: "Clean price against yield: to maturity and to call", xlabel: "yield (%)", ylabel: "clean price per 100" },
  );
}

/** Discount, money-market and bond-equivalent yields against days to maturity at one bank discount rate. */
export function billYieldsSvg(discount: number, yearBasis: BillYearBasis, settle: number, maxDays: number): string | undefined {
  const d: Point[] = [];
  const mm: Point[] = [];
  const be: Point[] = [];
  for (let t = 7; t <= maxDays; t += 7) {
    const r = treasuryBill({ settle, maturity: settle + t, discount, yearBasis });
    if ("error" in r) continue;
    d.push({ x: t, y: r.discount * 100 });
    mm.push({ x: t, y: r.moneyMarket * 100 });
    be.push({ x: t, y: r.bey * 100 });
  }
  if (d.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: d, type: "line", color: "#6b7280", label: "discount yield" },
      { points: mm, type: "line", color: "#2563eb", label: "money-market yield" },
      { points: be, type: "line", color: "#b91c1c", label: "bond-equivalent yield" },
    ],
    { width: 380, height: 260, title: `Bill yields at a ${fx(discount * 100, 3)}% discount rate`, xlabel: "days to maturity", ylabel: "yield (%)" },
  );
}

/** Zero curve (continuous), forward rates between knots (periodic, as steps) and the input par yields. */
export function zeroCurveSvg(knots: CurveKnot[], parPoints: Point[] | null, f: number): string | undefined {
  if (knots.length < 1) return undefined;
  const ts = knots.map((k) => k.t);
  const zs = knots.map((k) => k.z);
  const tMax = ts[ts.length - 1];
  const zero: Point[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = (tMax * i) / 120;
    zero.push({ x: t, y: zeroAt(ts, zs, t) * 100 });
  }
  const fwd: Point[] = [];
  knots.forEach((k, i) => {
    const t0 = i ? knots[i - 1].t : 0;
    fwd.push({ x: t0, y: k.fwdPeriodic * 100, gap: i > 0 });
    fwd.push({ x: k.t, y: k.fwdPeriodic * 100 });
  });
  const series: Series[] = [
    { points: zero, type: "line", color: "#2563eb", label: "zero rate (continuous)" },
    { points: fwd, type: "line", color: "#ea580c", label: `forward (compounded ${f}×/yr)` },
  ];
  if (parPoints && parPoints.length) series.push({ points: parPoints, type: "scatter", color: "#111827", label: "par yield (input)" });
  return finPlotSvg(series, { width: 380, height: 260, title: "Bootstrapped zero curve and forward rates", xlabel: "maturity (years)", ylabel: "rate (%)" });
}

/** The fitted Nelson–Siegel (or Svensson) curve through the pasted points. */
export function nelsonSiegelSvg(fit: NsFit, ts: number[], ys: number[]): string | undefined {
  const tMax = Math.max(...ts);
  const curve: Point[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = Math.max(0.01, (tMax * i) / 160);
    curve.push({ x: t, y: nsYield(fit.beta, fit.lambda, t) });
  }
  if (!curve.every((p) => Number.isFinite(p.y))) return undefined;
  return finPlotSvg(
    [
      { points: curve, type: "line", color: "#2563eb", label: fit.model === "ns" ? "Nelson–Siegel fit" : "Svensson fit" },
      { points: ts.map((t, i) => ({ x: t, y: ys[i] })), type: "scatter", color: "#111827", label: "observed" },
    ],
    { width: 380, height: 260, title: fit.model === "ns" ? "Nelson–Siegel yield curve fit" : "Svensson yield curve fit", xlabel: "maturity (years)", ylabel: "yield (%)" },
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Calculators
// ------------------------------------------------------------------------------------------------------------------

function readSpec(r: Read, redemptionKey = "red"): BondSpec | string {
  const settle = date(r, "settle", "settlement date");
  if (typeof settle === "string") return settle;
  const maturity = date(r, "maturity", "maturity date");
  if (typeof maturity === "string") return maturity;
  if (!(maturity > settle)) return "Maturity date must be after the settlement date.";
  const rate = num(r, "coupon", "coupon rate (%)", { min: 0, max: 100 });
  if (typeof rate === "string") return rate;
  const red = num(r, redemptionKey, "redemption (per 100)", { min: 0, minOpen: true, max: 10000 });
  if (typeof red === "string") return red;
  const freq = freqOf(r, [1, 2, 4, 12]);
  if (typeof freq === "string") return freq;
  const basis = basisOf(r);
  if (!(basis in BASIS_NAMES)) return basis;
  return { settle, maturity, rate: rate / 100, redemption: red, freq, basis: basis as BondBasis };
}

/** Bond price, yield, accrued interest, durations and the cash-flow schedule on real dates. */
export function bondDatesCalc(r: Read): FinResult {
  const spec = readSpec(r);
  if (typeof spec === "string") return finRefusal(spec);
  const face = num(r, "face", "face value", { min: 0, minOpen: true, max: 1e12 });
  if (typeof face === "string") return finRefusal(face);
  const solve = r("solve") === "yield" ? "yield" : "price";
  let y: number;
  if (solve === "price") {
    const yp = num(r, "yld", "yield to maturity (%)", { min: -10000, max: 10000 });
    if (typeof yp === "string") return finRefusal(yp);
    y = yp / 100;
  } else {
    const cp = num(r, "price", "clean price (per 100)", { min: 0, minOpen: true, max: 10000 });
    if (typeof cp === "string") return finRefusal(cp);
    const s = yieldFromClean(spec, cp);
    if ("error" in s) return finRefusal(s.error);
    y = s.yield;
  }
  const res = bondAtYield(spec, y);
  if ("error" in res) return finRefusal(res.error);
  // fix-fin R1 #10: at a yield of 10,000% the clean price came out −0.591564 per 100 (the accrued interest exceeds the
  // dirty price) and printed as a valid result. Decided on the printed six decimals.
  if (!(res.clean > 0) || !/[1-9]/.test(fx(res.clean, 6))) {
    return finRefusal("At this yield the clean price is zero or below, which no bond trades at: the yield to maturity (%) is too high for this bond. Check the yield.");
  }
  const p = res.period;
  const k = face / 100;
  const text = [
    `Bond settling ${longDate(spec.settle)}, maturing ${longDate(spec.maturity)}: ${fx(spec.rate * 100, 4)}% coupon paid ${times(spec.freq)}, redemption ${fx(spec.redemption, 4)} per 100`,
    `Previous coupon ${longDate(p.schedule.prev)}; next coupon ${longDate(p.schedule.next)}; ${p.N.toLocaleString("en-US")} coupon${p.N === 1 ? "" : "s"} to maturity`,
    `Accrued days A = ${fx(p.A, 0)}; days in the coupon period E = ${fx(p.E, 4).replace(/\.?0+$/, "")}; days to the next coupon DSC = ${fx(p.DSC, 4).replace(/\.?0+$/, "")}`,
    `Accrued interest = ${fx(res.accrued, 6)} per 100 (${fx(res.accrued * k, 2)} on a face of ${fx(face, 2)})`,
    `Clean price = ${fx(res.clean, 6)} per 100 (${fx(res.clean * k, 2)})`,
    `Dirty price = ${fx(res.dirty, 6)} per 100 (${fx(res.dirty * k, 2)}, the settlement amount)`,
    `Yield to maturity = ${pct(y)}${solve === "yield" ? " (solved from the clean price)" : ""}, compounded ${times(spec.freq)}`,
    `Macaulay duration = ${fx(res.macaulay, 6)} years; modified duration = ${fx(res.modified, 6)}; convexity = ${fx(res.convexity, 6)}`,
    bondConventions(spec, p),
  ].join("\n");
  return {
    text,
    reading: bondDatesReading(spec, y, res, face),
    svg: bondDatesPriceYieldSvg(spec, y),
    tables: [flowsTable(res, face, "Cash-flow schedule")],
  };
}

/** What the bond's price and yield mean for a buyer: the cost, premium or discount, and the rate sensitivity. */
export function bondDatesReading(spec: BondSpec, y: number, res: { clean: number; dirty: number; accrued: number; modified: number }, face: number): string {
  const k = face / 100;
  const cleanStr = fx(res.clean, 6);
  const redStr = fx(spec.redemption, 4);
  // Premium or discount on the printed clean price against the printed redemption (both to 4 decimals at least).
  const rel = fx(res.clean, 4) === redStr ? "equal to" : res.clean < spec.redemption ? "below" : "above";
  const first = `At a ${pct(y)} yield the clean price is ${cleanStr} per 100, ${rel} the ${redStr} redemption; a face of ${fx(face, 2)} costs ${fx(res.dirty * k, 2)} including ${fx(res.accrued * k, 2)} of accrued interest.`;
  const mod = fx(res.modified, 6);
  if (!(res.modified > 0) || mod === "—") return first;
  // fix-fin R1 #13: "roughly 7.858336 percent" claimed six decimals for an estimate; name it as the duration instead.
  const second = ` With a modified duration of ${mod}, a one-point rise in the yield would cut the price by about that many percent.`;
  return (first + second).length <= READING_MAX ? first + second : first;
}

/** Yield to maturity, yield to call and yield to worst from a clean price. */
export function bondWorstCalc(r: Read): FinResult {
  const spec = readSpec(r);
  if (typeof spec === "string") return finRefusal(spec);
  const clean = num(r, "price", "clean price (per 100)", { min: 0, minOpen: true, max: 10000 });
  if (typeof clean === "string") return finRefusal(clean);
  const callDate = date(r, "calldate", "call date");
  if (typeof callDate === "string") return finRefusal(callDate);
  const callPrice = num(r, "callprice", "call price (per 100)", { min: 0, minOpen: true, max: 10000 });
  if (typeof callPrice === "string") return finRefusal(callPrice);
  const w = yieldToWorst(spec, clean, callDate, callPrice);
  if ("error" in w) return finRefusal(w.error);
  const acc = (w.maturityPeriod.c * w.maturityPeriod.A) / w.maturityPeriod.E;
  const text = [
    `Clean price ${fx(clean, 6)} per 100 (accrued interest ${fx(acc, 6)}; dirty price ${fx(clean + acc, 6)})`,
    `Yield to maturity (${longDate(spec.maturity)}, redeemed at ${fx(spec.redemption, 4)}) = ${pct(w.ytm)}`,
    `Yield to call (${longDate(callDate)}, redeemed at ${fx(callPrice, 4)}) = ${pct(w.ytc)}`,
    `Yield to worst = ${pct(w.ytw)} (to ${w.worst === "call" ? "the call" : "maturity"})`,
    bondConventions(spec, w.maturityPeriod) +
      ` Yield to call: the bond redeemed at the call price on the call date, which must be one of its coupon dates, on the same schedule; yield to worst is the lower of the two (one call date; a call schedule is not modelled).`,
  ].join("\n");
  const table: FinTable = {
    label: "Yield to worst",
    rows: [
      ["Redemption", "Date", "Price (per 100)", "Coupons", "Yield"],
      ["Maturity", longDate(spec.maturity), fx(spec.redemption, 4), fx(w.maturityPeriod.N, 0), pct(w.ytm)],
      ["Call", longDate(callDate), fx(callPrice, 4), fx(w.callPeriod.N, 0), pct(w.ytc)],
    ],
    align: ["left", "left", "right", "right", "right"],
    note: `Yield to worst ${pct(w.ytw)}: to ${w.worst === "call" ? "the call" : "maturity"}.`,
  };
  return { text, reading: bondWorstReading(clean, callDate, callPrice, w), svg: bondCallPriceYieldSvg(spec, callDate, callPrice, clean, w.ytm, w.ytc), tables: [table] };
}

/** The yield a buyer at this price should plan on (the worse of maturity and call), and why. */
export function bondWorstReading(clean: number, callDate: number, callPrice: number, w: { ytm: number; ytc: number; ytw: number; worst: "call" | "maturity" }): string {
  const ytm = pct(w.ytm);
  const ytc = pct(w.ytc);
  const head = `At a clean price of ${fx(clean, 6)}, the yield to worst is ${pct(w.ytw)}`;
  if (ytm === ytc) return `${head}: called on ${longDate(callDate)} at ${fx(callPrice, 4)} or held to maturity, the bond yields the same, so the call does not change what a buyer earns.`;
  if (w.worst === "call")
    return `${head}, earned if the issuer calls the bond on ${longDate(callDate)} at ${fx(callPrice, 4)}, below the ${ytm} yield to maturity. A buyer should plan on the lower figure, since the issuer decides whether to call.`;
  return `${head}, earned if the bond runs to maturity, below the ${ytc} yield to call. A call on ${longDate(callDate)} would only raise the buyer's yield, so the yield to maturity is the one to plan on.`;
}

/** Treasury bill: price, discount yield, money-market yield and bond-equivalent yield. */
export function billCalc(r: Read): FinResult {
  const settle = date(r, "settle", "settlement date");
  if (typeof settle === "string") return finRefusal(settle);
  const maturity = date(r, "maturity", "maturity date");
  if (typeof maturity === "string") return finRefusal(maturity);
  const given = r("given") === "price" ? "price" : "discount";
  const yb: BillYearBasis = r("year") === "treasury" ? "treasury" : "365";
  const label = given === "price" ? "price (per 100)" : "discount rate (%)";
  const v = num(r, "value", label, given === "price" ? { min: 0, minOpen: true, max: 200 } : { min: -100, max: 100 });
  if (typeof v === "string") return finRefusal(v);
  const b = treasuryBill(given === "price" ? { settle, maturity, price: v, yearBasis: yb } : { settle, maturity, discount: v / 100, yearBasis: yb });
  if ("error" in b) return finRefusal(b.error);
  // fix-fin R1 #6: switching "given" to price leaves the discount rate (4.2) in the field, which then priced the bill at
  // 4.2 per 100 and printed a 9,148.874935% yield. A price whose discount rate lies outside the ±100% the discount mode
  // accepts is refused, with the likely cause named.
  // A price under 50 per 100 is refused at any tenor (a bill runs at most about a year: 4.2 a year out still implies
  // a discount near 95% and a bond-equivalent yield over 2,000%).
  if (given === "price" && (Math.abs(b.discount) > 1 || v < 50)) {
    return finRefusal(
      "The price (per 100) is far from 100: below 50, or a discount rate beyond 100% a year, is outside this calculator. " +
        "A bill's price is quoted per 100 of face and is close to 100 (for example 98.75); if you typed a discount rate, choose “discount rate” instead.",
    );
  }
  const text = [
    `Treasury bill settling ${longDate(settle)}, maturing ${longDate(maturity)}: ${b.days} days`,
    `Price = ${fx(b.price, 6)} per 100${given === "discount" ? " (Excel TBILLPRICE)" : ""}`,
    `Discount yield = ${pct(b.discount)}`,
    `Money-market yield = ${pct(b.moneyMarket)} (Excel TBILLYIELD)`,
    `Bond-equivalent yield = ${pct(b.bey)} (${b.longForm ? "Treasury quadratic, more than half a year to maturity" : `simple, ${b.yearDays}-day year${yb === "365" ? ", Excel TBILLEQ" : ""}`})`,
    `Conventions: days are actual days from settlement to maturity; discount yield (100 − P)/100 × 360/t and money-market yield (100 − P)/P × 360/t on ACT/360; ` +
      `bond-equivalent yield on a ${yb === "365" ? "365-day year (Excel TBILLEQ)" : "365-day year, or 366 when a February 29 falls in the year after settlement (Treasury)"}` +
      `${yb === "treasury" ? ` (${b.yearDays} here)` : ""}: (100 − P)/P × B/t up to half a year, beyond that the Treasury's quadratic P(1 + r/2)(1 + r(t − B/2)/B) = 100 ` +
      `(Excel's own TBILLEQ formula past 182 days is not reproduced); prices per 100 of face.`,
  ].join("\n");
  const table: FinTable = {
    label: "Treasury bill yields",
    rows: [
      ["Measure", "Basis", "Value"],
      ["Price (per 100)", "", fx(b.price, 6)],
      ["Discount yield", "ACT/360 on face", pct(b.discount)],
      ["Money-market yield", "ACT/360 on price", pct(b.moneyMarket)],
      ["Bond-equivalent yield", `${b.yearDays}-day year${b.longForm ? ", quadratic" : ""}`, pct(b.bey)],
    ],
    align: ["left", "left", "right"],
  };
  return { text, reading: billReading(b, given), svg: billYieldsSvg(b.discount, yb, settle, 364), tables: [table] };
}

/**
 * What a bill's price returns, on the basis that compares with a coupon bond, against the discount rate. The rate is
 * "the quoted" one only when it was typed; in price mode it is "the equivalent" one (fix-fin R1 #6).
 */
export function billReading(b: { price: number; days: number; discount: number; moneyMarket: number; bey: number }, given: "price" | "discount" = "discount"): string {
  const bey = pct(b.bey);
  const disc = pct(b.discount);
  const which = given === "price" ? "equivalent" : "quoted";
  const head = `Paying ${fx(b.price, 6)} per 100 for ${b.days} ${b.days === 1 ? "day" : "days"} returns ${bey} a year on a bond-equivalent basis (${pct(b.moneyMarket)} money-market)`;
  if (bey === disc) return `${head}, the same as the ${disc} discount rate.`;
  if (b.bey > b.discount) return `${head}. The ${which} ${disc} discount rate understates the return, because it is figured on the face value rather than the price paid.`;
  return `${head}. The ${which} ${disc} discount rate overstates the return here, so compare bills and bonds on the bond-equivalent yield.`;
}

/** Reads the pasted (maturity, yield) or (maturity, coupon, price) rows. */
function readRows(text: string, what: string, cols: number, maxRows: number): number[][] | string {
  const b = readDataBlock(text, what, { maxRows });
  if (!b.ok) return b.error;
  const out: number[][] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    if (row.length < cols) return `${what}, line ${b.lines[i]}: needs ${cols} numbers (${cols === 2 ? "maturity in years, then yield %" : "maturity in years, coupon %, clean price per 100"}).`;
    if (row.length > cols) return `${what}, line ${b.lines[i]}: has ${row.length} numbers; expected ${cols} (${cols === 2 ? "maturity, yield %" : "maturity, coupon %, price"}).`;
    if (row.some((v) => v === null || !Number.isFinite(v))) return `${what}, line ${b.lines[i]}: a value is missing or not a finite number.`;
    out.push(row as number[]);
  }
  return out;
}

/** Zero curve bootstrap, discount factors and forward rates. */
export function curveBootstrapCalc(r: Read): FinResult {
  const f = freqOf(r, [1, 2]);
  if (typeof f === "string") return finRefusal(f);
  const mode = r("mode") === "prices" ? "prices" : "par";
  const rows = readRows(r("rows"), "Instruments", mode === "par" ? 2 : 3, 100);
  if (typeof rows === "string") return finRefusal(rows);
  const ins: CurveInstrument[] = rows.map((row) => (mode === "par" ? { t: row[0], coupon: row[1] / 100, price: 100 } : { t: row[0], coupon: row[1] / 100, price: row[2] }));
  const c = bootstrapZeroCurve(ins, f);
  if ("error" in c) return finRefusal(c.error);
  const sorted = [...ins].sort((a, b) => a.t - b.t);
  const lines = [
    `Zero curve from ${c.knots.length} ${mode === "par" ? "par yield" : "coupon bond price"}${c.knots.length === 1 ? "" : "s"}, coupons ${times(f)}`,
    ...c.knots.map((k) => `${fx(k.t, 2)} years: zero ${pct(k.z, 4)} continuous, ${pct(k.zPeriodic, 4)} compounded ${times(f)}; discount factor ${fx(k.df, 8)}`),
    `Conventions: instruments on a grid of whole coupon periods (${f === 2 ? "half-years" : "years"}), priced on a coupon date (no accrued interest); ` +
      `${mode === "par" ? "a par yield is a bond priced at 100 with that coupon; " : ""}time in years on the grid; linear interpolation on continuously compounded zero rates between knots, flat before the first knot; ` +
      `discount factor exp(−z·t); periodic zero f·(D to the power −1/(f·t), minus 1); forwards between consecutive maturities, continuous (z₂t₂ − z₁t₁)/(t₂ − t₁) and compounded ${times(f)}.`,
  ];
  const table: FinTable = {
    label: "Zero curve and forward rates",
    rows: [
      ["Maturity (years)", mode === "par" ? "Par yield" : "Price (per 100)", "Zero (continuous)", `Zero (${f}×/yr)`, "Discount factor", `Forward (${f}×/yr)`],
      ...c.knots.map((k, i) => [fx(k.t, 2), mode === "par" ? pct(sorted[i].coupon, 4) : fx(sorted[i].price, 4), pct(k.z, 4), pct(k.zPeriodic, 4), fx(k.df, 8), pct(k.fwdPeriodic, 4)]),
    ],
    align: ["right", "right", "right", "right", "right", "right"],
    note: "Each forward runs from the previous maturity (from today for the first) to this one.",
  };
  const par = mode === "par" ? sorted.map((x) => ({ x: x.t, y: x.coupon * 100 })) : null;
  return { text: lines.join("\n"), reading: curveBootstrapReading(c.knots), svg: zeroCurveSvg(c.knots, par, f), tables: [table] };
}

/** The shape of the bootstrapped zero curve (ends, any dip or hump between) and what its far discount factor means. */
export function curveBootstrapReading(knots: CurveKnot[]): string {
  const at = (k: CurveKnot): string => `${pct(k.z, 4)} at ${fx(k.t, 2)} years`;
  const first = knots[0];
  const last = knots[knots.length - 1];
  const df = `so 1 due in ${fx(last.t, 2)} years is worth ${fx(last.df, 8)} today`;
  if (knots.length === 1) return `The zero rate is ${at(first)} (continuously compounded), ${df}.`;
  // Compare on the printed values, so "level" means the two ends print the same.
  const a = pct(first.z, 4);
  const b = pct(last.z, 4);
  const slope = a === b ? "level from end to end" : last.z > first.z ? "upward overall" : "downward overall";
  let lo = 0;
  let hi = 0;
  knots.forEach((k, i) => {
    if (k.z < knots[lo].z) lo = i;
    if (k.z > knots[hi].z) hi = i;
  });
  const inner = (i: number): boolean => i > 0 && i < knots.length - 1;
  const bends: string[] = [];
  if (inner(lo) && knots[lo].z < Math.min(first.z, last.z) && pct(knots[lo].z, 4) !== a && pct(knots[lo].z, 4) !== b) bends.push(`dipping to ${at(knots[lo])}`);
  if (inner(hi) && knots[hi].z > Math.max(first.z, last.z) && pct(knots[hi].z, 4) !== a && pct(knots[hi].z, 4) !== b) bends.push(`peaking at ${at(knots[hi])}`);
  return `Zero rates (continuously compounded) run from ${at(first)} to ${at(last)}${bends.length ? ", " + bends.join(" and ") + " in between" : ""}, so the curve slopes ${slope}. Discounting on it, ${df.slice(3)}.`;
}

/** Nelson–Siegel or Svensson fit to pasted (maturity, yield) points. */
export function nelsonSiegelCalc(r: Read): FinResult {
  const model = r("model") === "svensson" ? "svensson" : "ns";
  const rows = readRows(r("rows"), "Curve points", 2, 200);
  if (typeof rows === "string") return finRefusal(rows);
  const ts = rows.map((x) => x[0]);
  const ys = rows.map((x) => x[1]);
  const fit = fitNelsonSiegel(ts, ys, model);
  if ("error" in fit) return finRefusal(fit.error);
  const b = fit.beta;
  const name = model === "ns" ? "Nelson–Siegel" : "Svensson";
  const lines = [
    `${name} fit to ${ts.length} points`,
    `β₀ = ${fx(b[0], 6)}% (long-run level); β₁ = ${fx(b[1], 6)}% (slope; short end β₀ + β₁ = ${fx(b[0] + b[1], 6)}%); β₂ = ${fx(b[2], 6)}% (curvature)` +
      (model === "svensson" ? `; β₃ = ${fx(b[3], 6)}% (second hump)` : ""),
    `λ${model === "svensson" ? "₁" : ""} = ${fx(fit.lambda[0], 6)} years` + (model === "svensson" ? `; λ₂ = ${fx(fit.lambda[1], 6)} years` : ""),
    `Residual sum of squares = ${fx(fit.sse, 8)} (%²); RMSE = ${fx(fit.rmse * 100, 3)} basis points; R² = ${fx(fit.r2, 6)}`,
    ...(fit.atBound ? [`λ ended on its search bound (${fx(NS_LAMBDA_MIN, 2)} to ${fx(NS_LAMBDA_MAX, 0)} years): the data may want a decay outside that range; read β₁ and β₂ with care.`] : []),
    `Conventions: y(τ) = β₀ + β₁(1 − exp(−τ/λ))/(τ/λ) + β₂[(1 − exp(−τ/λ))/(τ/λ) − exp(−τ/λ)]${model === "svensson" ? " + β₃[(1 − exp(−τ/λ₂))/(τ/λ₂) − exp(−τ/λ₂)]" : ""}, τ in years; ` +
      `yields fitted as entered (no compounding conversion), unweighted least squares in yield; β solved exactly for each λ, λ bounded to ${fx(NS_LAMBDA_MIN, 2)}–${fx(NS_LAMBDA_MAX, 0)} years ` +
      `(log grid, then golden-section refinement${model === "svensson" ? "; λ₂ ≥ 2·λ₁ keeps the two humps apart" : ""}).`,
  ];
  const table: FinTable = {
    label: `${name} fit`,
    rows: [["Maturity (years)", "Observed (%)", "Fitted (%)", "Residual (bp)"], ...ts.map((t, i) => [fx(t, 2), fx(ys[i], 4), fx(fit.fitted[i], 4), fx((ys[i] - fit.fitted[i]) * 100, 2)])],
    align: ["right", "right", "right", "right"],
  };
  return { text: lines.join("\n"), reading: nelsonSiegelReading(fit, ts), svg: nelsonSiegelSvg(fit, ts, ys), tables: [table] };
}

/**
 * The fitted curve at the shortest and longest maturities entered (the table's Fitted column; not β₀, which is the
 * limit at infinite maturity and can sit far from the 30-year point), its slope, and how closely it fits.
 */
export function nelsonSiegelReading(fit: NsFit, ts: number[]): string {
  let i0 = 0;
  let i1 = 0;
  ts.forEach((t, i) => {
    if (t < ts[i0]) i0 = i;
    if (t > ts[i1]) i1 = i;
  });
  const short = fx(fit.fitted[i0], 4);
  const long = fx(fit.fitted[i1], 4);
  const slope = short === long ? "is level from end to end" : fit.fitted[i1] > fit.fitted[i0] ? "slopes upward overall" : "slopes downward overall (inverted)";
  const head = `The fitted curve runs from ${short} percent at ${fx(ts[i0], 2)} years to ${long} percent at ${fx(ts[i1], 2)} years, so it ${slope}`;
  const miss = `it misses the points by ${fx(fit.rmse * 100, 3)} basis points typically (RMSE)`;
  if (fit.atBound) return `${head}; ${miss}. The decay parameter ended on its search bound, so read the shape with care.`;
  return `${head}; ${miss}, with R² = ${fx(fit.r2, 6)}.`;
}

const PAR_DEFAULT = ["0.5\t4.30", "1\t4.20", "2\t4.00", "3\t3.95", "5\t3.98", "7\t4.08", "10\t4.22", "20\t4.55", "30\t4.50"].join("\n");
const NS_DEFAULT = ["0.25\t4.35", "0.5\t4.30", "1\t4.18", "2\t3.98", "3\t3.93", "5\t3.97", "7\t4.07", "10\t4.21", "20\t4.53", "30\t4.47"].join("\n");

export const BOND_CALCS: FinCalcDef[] = [
  {
    id: "bond-dates",
    group: "Fixed income",
    name: "Bond price, yield and accrued interest on dates",
    fields: [
      { key: "settle", label: "Settlement date", default: "2026-04-20", kind: "text" },
      { key: "maturity", label: "Maturity date", default: "2036-02-15", kind: "text" },
      { key: "coupon", label: "Coupon rate (%)", default: "4.25" },
      FREQ_FIELD,
      BASIS_FIELD,
      {
        key: "solve",
        label: "Solve for",
        default: "price",
        kind: "select",
        options: [
          { value: "price", label: "Price from yield" },
          { value: "yield", label: "Yield from clean price" },
        ],
      },
      { key: "yld", label: "Yield to maturity (%) (price from yield)", default: "4.6", optional: true },
      { key: "price", label: "Clean price per 100 (yield from price)", default: "97.25", optional: true },
      { key: "red", label: "Redemption (per 100)", default: "100" },
      { key: "face", label: "Face value (for cash amounts)", default: "1000" },
    ],
    assumes:
      "A regular coupon schedule dated backward from maturity (no issue date, so odd first or last coupons are not modelled), " +
      "payment on the stated dates with no business-day adjustment, a single yield for every cash flow, no credit or call risk.",
    compute: (r) => {
      // clean and dirty price, accrued interest, yield and durations on the bond's real coupon dates
      return bondDatesCalc(r);
    },
  },
  {
    id: "bond-ytw",
    group: "Fixed income",
    name: "Yield to call and yield to worst",
    fields: [
      { key: "settle", label: "Settlement date", default: "2026-04-20", kind: "text" },
      { key: "maturity", label: "Maturity date", default: "2036-02-15", kind: "text" },
      { key: "coupon", label: "Coupon rate (%)", default: "6" },
      { key: "price", label: "Clean price (per 100)", default: "104.5" },
      { key: "calldate", label: "Call date (a coupon date)", default: "2029-02-15", kind: "text" },
      { key: "callprice", label: "Call price (per 100)", default: "101" },
      { key: "red", label: "Redemption at maturity (per 100)", default: "100" },
      FREQ_FIELD,
      BASIS_FIELD,
    ],
    assumes:
      "One call date on a coupon date, exercised in full at the call price; a call schedule, make-whole calls and puts are not modelled. " +
      "Yield to worst is the lower of the yield to maturity and the yield to that call.",
    compute: (r) => {
      // yields to maturity and to the call from the clean price, and the lower of the two
      return bondWorstCalc(r);
    },
  },
  {
    id: "tbill-yields",
    group: "Fixed income",
    name: "Treasury bill yields",
    fields: [
      { key: "settle", label: "Settlement date", default: "2026-03-31", kind: "text" },
      { key: "maturity", label: "Maturity date", default: "2026-06-30", kind: "text" },
      {
        key: "given",
        label: "Given",
        default: "discount",
        kind: "select",
        options: [
          { value: "discount", label: "Bank discount rate (%)" },
          { value: "price", label: "Price per 100" },
        ],
      },
      { key: "value", label: "Discount rate (%) or price per 100", default: "4.2" },
      {
        key: "year",
        label: "Bond-equivalent year",
        default: "365",
        kind: "select",
        options: [
          { value: "365", label: "365 days (Excel TBILLEQ)" },
          { value: "treasury", label: "365 or 366 days (Treasury, leap years)" },
        ],
      },
    ],
    assumes: "A discount bill paying 100 at maturity, held to maturity; maturity within a year of settlement.",
    compute: (r) => {
      // price, discount yield, money-market yield and bond-equivalent yield of a bill
      return billCalc(r);
    },
  },
  {
    id: "curve-bootstrap",
    group: "Fixed income",
    name: "Zero curve bootstrap and forward rates",
    fields: [
      {
        key: "mode",
        label: "Instruments",
        default: "par",
        kind: "select",
        options: [
          { value: "par", label: "Par yields: maturity (years), par yield (%)" },
          { value: "prices", label: "Coupon bonds: maturity (years), coupon (%), clean price" },
        ],
      },
      {
        key: "freq",
        label: "Coupons per year",
        default: "2",
        kind: "select",
        options: [
          { value: "1", label: "1 (annual)" },
          { value: "2", label: "2 (semiannual)" },
        ],
      },
      { key: "rows", label: "Instruments, one per line (illustrative numbers by default)", default: PAR_DEFAULT, kind: "block" },
    ],
    assumes:
      "Instruments priced on a coupon date with no credit or liquidity differences; the default rows are illustrative numbers, not market data. " +
      "Linear interpolation on continuously compounded zero rates between maturities is a modelling choice; another interpolation gives other forwards.",
    compute: (r) => {
      // bootstraps zero rates and discount factors, then the forwards between maturities
      return curveBootstrapCalc(r);
    },
  },
  {
    id: "curve-nelson-siegel",
    group: "Fixed income",
    name: "Nelson–Siegel yield curve fit",
    fields: [
      {
        key: "model",
        label: "Model",
        default: "ns",
        kind: "select",
        options: [
          { value: "ns", label: "Nelson–Siegel (4 parameters)" },
          { value: "svensson", label: "Svensson (6 parameters)" },
        ],
      },
      { key: "rows", label: "Curve points: maturity (years), yield (%), one per line (illustrative numbers by default)", default: NS_DEFAULT, kind: "block" },
    ],
    assumes:
      "A smooth parametric curve fitted by unweighted least squares; it smooths, so it does not reprice every input exactly. " +
      "The default points are illustrative, not market data.",
    compute: (r) => {
      // fits the Nelson–Siegel or Svensson curve to the points and draws it through them
      return nelsonSiegelCalc(r);
    },
  },
];
