/**
 * Release F2 item #18 (cost–benefit analysis / public economics) and quick win 12 (interest and purchasing-power
 * parity): Finance calculators spread into the pane's FIN_CALCS.
 *  - cba-scenarios  NPV, benefit–cost ratio and economic IRR per scenario at a USER-ENTERED social discount rate,
 *                   shadow-price conversion factors per line, switching values, NPV against the discount rate;
 *  - cba-pigou      Pigouvian tax on a linear externality: market vs social optimum, deadweight loss, figure;
 *  - fx-cip         covered interest parity: forward from spot and two money-market rates (simple, per-currency day
 *                   count; or continuous), covered-arbitrage check against a quoted forward;
 *  - fx-uip         uncovered interest parity: expected depreciation and expected future spot, carry excess return;
 *  - fx-ppp         purchasing-power parity, absolute (price levels) and relative (inflation differential).
 * No discount rate, exchange rate or price level is bundled: every number is the user's. Amounts are currency-neutral
 * (bare grouped numbers) unless an ISO 4217 code is typed, then they are written with currencyAmount().
 * IRRs come from corpFinance.irrAll (every root in −99% to 10,000%), NPVs from corpFinance.npvAt.
 */
import type { FinCalcDef, FinResult, FinTable } from "./finCalc";
import { finRefusal as finRefusalRaw } from "./finCalc";
import { readFinanceField } from "./finance";
import { aAn } from "./finPaneReadings";
import { finPlotSvg } from "./financeFigures";
import { cipParitySvg, uipPathSvg, pppPathSvg, pppBasketSvg } from "./finLibFigures";
import type { Point, Series } from "./plot";
import { readDataBlock } from "./dataBlock";
import { readCalcList, ListTokenError } from "./calcList";
import { irrAll, npvAt, type IrrRoots } from "./corpFinance";
import { ISO4217, NOT_A_CURRENCY, currencyAmount } from "./currency";

/** A refusal starts with a capital. */
const finRefusal = (s: string): FinResult => finRefusalRaw(/^[a-z][a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
type Read = (k: string) => string;

// ------------------------------------------------------------------------------------------------------------------
// Formatting (true minus, grouped thousands)

const NF = new Map<number, Intl.NumberFormat>();
/** Grouped fixed decimals with a true minus; a non-finite value (or one past 10²¹) prints the sentinel "—" and is refused by finish(). */
export function fx(x: number, dp: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return "—";
  let f = NF.get(dp);
  if (!f) NF.set(dp, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })));
  const s = f.format(x);
  if (/^-0(?:\.0*)?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
const pct = (x: number, dp = 2): string => fx(x * 100, dp) + "%";

function finish(res: { text: string; reading?: string; svg?: string; tables?: FinTable[] }): FinResult {
  const cells = (res.tables ?? []).flatMap((t) => t.rows.flat());
  if (res.text.includes("—") || cells.some((c) => c.includes("—"))) {
    return finRefusal("A value came out non-finite or above 10²¹ (an overflow on these inputs), so there is nothing to insert. Check the inputs' magnitudes.");
  }
  return res;
}

type NumOpts = { min?: number; max?: number; minOpen?: boolean; maxOpen?: boolean; int?: boolean };
/** A number field (already through readFinanceField in the pane; read again so a direct call is held to it). */
function num(r: Read, key: string, label: string, o: NumOpts = {}): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `Enter the ${label}.`;
  const v = readFinanceField(raw);
  const Label = label[0].toUpperCase() + label.slice(1);
  if (!Number.isFinite(v)) return `${Label}: “${raw}” is not a finite number.`;
  if (Math.abs(v) > 1e15) return `${Label}: “${raw}” is larger than 10¹⁵ in magnitude.`;
  if (o.int && !Number.isInteger(v)) return `${Label} must be a whole number (got ${raw}).`;
  const lim = (x: number): string => fx(x, x % 1 ? 2 : 0);
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${Label} must be ${o.minOpen ? "above" : "at least"} ${lim(o.min)}.`;
  if (o.max !== undefined && (o.maxOpen ? !(v < o.max) : v > o.max)) return `${Label} must be ${o.maxOpen ? "below" : "at most"} ${lim(o.max)}.`;
  return v;
}
function optNum(r: Read, key: string, label: string, o: NumOpts = {}): number | null | string {
  if (!(r(key) ?? "").trim()) return null;
  return num(r, key, label, o);
}
/** An optional ISO 4217 code: blank → null; an unknown code refused by name. */
function readCode(r: Read, key: string, label: string): string | null | { error: string } {
  const t = (r(key) ?? "").trim().toUpperCase();
  if (!t) return null;
  if (NOT_A_CURRENCY[t]) return { error: `${label}: ${t} is ${NOT_A_CURRENCY[t]}, not a currency.` };
  if (!ISO4217.has(t)) return { error: `${label}: “${(r(key) ?? "").trim()}” is not an ISO 4217 currency code (three letters, such as USD, EUR, JPY).` };
  return t;
}
/** An amount: grouped with `dp` decimals, with the currency when a code is given. */
/**
 * An amount in a currency at that currency's ISO 4217 minor units (fix-fin R2 #12: "JP¥163,138.13" printed sen that
 * the yen does not have). Without a code, or for a code with no minor unit listed, the `dp` given.
 */
const amt = (x: number, code: string | null, dp = 2): string => {
  if (!code) return fx(x, dp);
  const minor = ISO4217.get(code)?.minor;
  return currencyAmount(fx(x, typeof minor === "number" ? minor : dp), code);
};

// ------------------------------------------------------------------------------------------------------------------
// cba-scenarios

export const CBA_MAX_SCENARIOS = 4;
export const CBA_MAX_YEARS = 200;

export interface CbaScenario {
  name: string;
  /** Benefits and costs by t = 0 … T (zero-filled between listed years), after the conversion factors. */
  b: number[];
  c: number[];
  /** Before the factors (financial flows). */
  b0: number[];
  c0: number[];
}
export interface CbaMeasures {
  pvB: number;
  pvC: number;
  npv: number;
  /** PV(benefits)/PV(costs); null when PV(costs) ≤ 0. */
  bcr: number | null;
  irr: IrrRoots;
  npvFinancial: number;
}

export function cbaMeasures(s: CbaScenario, rate: number): CbaMeasures {
  const pvB = npvAt(rate, s.b);
  const pvC = npvAt(rate, s.c);
  const net = s.b.map((x, t) => x - s.c[t]);
  return { pvB, pvC, npv: pvB - pvC, bcr: pvC > 0 ? pvB / pvC : null, irr: irrAll(net), npvFinancial: npvAt(rate, s.b0) - npvAt(rate, s.c0) };
}

export const CBA_DEFAULT = [
  "Year\tBase benefits\tBase costs\tLow benefits\tLow costs\tHigh benefits\tHigh costs",
  "2026\t0\t1000\t0\t1000\t0\t1200",
  "2027\t180\t50\t130\t50\t230\t60",
  "2028\t180\t50\t130\t50\t230\t60",
  "2029\t180\t50\t130\t50\t230\t60",
  "2030\t180\t50\t130\t50\t230\t60",
  "2031\t180\t50\t130\t50\t230\t60",
  "2032\t180\t50\t130\t50\t230\t60",
  "2033\t180\t50\t130\t50\t230\t60",
  "2034\t180\t50\t130\t50\t230\t60",
  "2035\t180\t50\t130\t50\t230\t60",
  "2036\t180\t50\t130\t50\t230\t60",
].join("\n");

/** NPV against the discount rate for each scenario, the rate entered and each EIRR marked. */
export function cbaNpvRateSvg(scen: { name: string; b: number[]; c: number[]; roots: number[] }[], rate: number, lo: number, hi: number): string | undefined {
  const colors = ["#2563eb", "#ea580c", "#16a34a", "#7c3aed"];
  const series: Series[] = [];
  scen.forEach((s, k) => {
    const net = s.b.map((x, t) => x - s.c[t]);
    const pts: Point[] = [];
    for (let i = 0; i <= 120; i++) {
      const r = lo + ((hi - lo) * i) / 120;
      const v = npvAt(r, net);
      if (Number.isFinite(v)) pts.push({ x: r * 100, y: v });
    }
    series.push({ points: pts, type: "line", color: colors[k], label: `NPV, ${s.name}` });
  });
  const marks = scen.flatMap((s) => s.roots.filter((x) => x >= lo && x <= hi).map((x) => ({ x: x * 100, y: 0 })));
  if (marks.length) series.push({ points: marks, type: "scatter", color: "#b91c1c", label: "EIRR (NPV = 0)" });
  series.push({ points: [{ x: lo * 100, y: 0 }, { x: hi * 100, y: 0 }], type: "line", color: "#9ca3af", label: "NPV = 0" });
  const atRate = scen.map((s) => ({ x: rate * 100, y: npvAt(rate, s.b.map((x, t) => x - s.c[t])) }));
  series.push({ points: atRate, type: "scatter", color: "#111827", label: "at the rate entered" });
  if (!series.slice(0, scen.length).every((s) => s.points.length > 1)) return undefined;
  return finPlotSvg(series, { width: 400, height: 270, title: "Sensitivity of NPV to the discount rate", xlabel: "social discount rate (% a year)", ylabel: "NPV" });
}

const rootsText = (r: IrrRoots): string => {
  const all = [...r.roots, ...r.touches].sort((a, b) => a - b);
  if (all.length) return all.map((v) => pct(v, 2)).join("; ");
  return r.signChanges === 0 ? "none (the net flows never change sign)" : "none between −99% and 10,000%";
};
const rootsCell = (r: IrrRoots): string => {
  const all = [...r.roots, ...r.touches].sort((a, b) => a - b);
  return all.length ? all.map((v) => pct(v, 2)).join("; ") : "none";
};

export function cbaScenariosCalc(r: Read): FinResult {
  const rateP = num(r, "rate", "social discount rate (% a year)", { min: -99, max: 1000, minOpen: true });
  if (typeof rateP === "string") return finRefusal(rateP);
  const rate = rateP / 100;
  const b = readDataBlock(r("data") ?? "", "Benefits and costs table", { maxRows: CBA_MAX_YEARS + 1 });
  if (!b.ok) return finRefusal(b.error);
  const w = b.rows[0].length;
  if (w < 3 || (w - 1) % 2 !== 0 || (w - 1) / 2 > CBA_MAX_SCENARIOS) {
    return finRefusal(`Benefits and costs table: ${w} columns; expected a year column and then a benefits and a costs column for each of 1 to ${CBA_MAX_SCENARIOS} scenarios (3, 5, 7 or 9 columns).`);
  }
  const S = (w - 1) / 2;
  const years: number[] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    if (row.length !== w) return finRefusal(`Benefits and costs table, line ${b.lines[i]}: ${row.length} values; the first row has ${w}.`);
    for (let j = 0; j < w; j++) {
      if (row[j] === null) return finRefusal(`Benefits and costs table, line ${b.lines[i]}: a value is missing (column ${j + 1}); write 0 for a year with no benefit or cost.`);
      if (!Number.isFinite(row[j]!) || Math.abs(row[j]!) > 1e15) return finRefusal(`Benefits and costs table, line ${b.lines[i]}: column ${j + 1} is not a finite number of at most 10¹⁵.`);
    }
    const y = row[0]!;
    if (!Number.isInteger(y)) return finRefusal(`Benefits and costs table, line ${b.lines[i]}: the year ${fx(y, 2)} is not a whole number.`);
    if (years.length && y <= years[years.length - 1]) return finRefusal(`Benefits and costs table, line ${b.lines[i]}: years must increase down the table (${y} follows ${years[years.length - 1]}).`);
    years.push(y);
  }
  const baseRaw = optNum(r, "base", "base year", { int: true });
  if (typeof baseRaw === "string") return finRefusal(baseRaw);
  const base = baseRaw ?? years[0];
  if (base > years[0]) return finRefusal(`The base year ${base} is after the first year in the table (${years[0]}): flows before the base year are not discounted forward here.`);
  const T = years[years.length - 1] - base;
  if (T > CBA_MAX_YEARS) return finRefusal(`The table spans ${T} years from the base year; the most is ${CBA_MAX_YEARS}.`);
  // conversion factors
  let factors: number[] = Array(2 * S).fill(1);
  let factorNote = "";
  const fRaw = (r("factors") ?? "").trim();
  if (fRaw) {
    let vals: number[];
    try {
      vals = readCalcList(fRaw).values;
    } catch (e) {
      if (e instanceof ListTokenError) return finRefusal(`Shadow-price conversion factors: ${e.message}`);
      throw e;
    }
    if (vals.length === 2) factors = Array.from({ length: S }, () => vals).flat();
    else if (vals.length === 2 * S) factors = vals;
    else return finRefusal(`Shadow-price conversion factors: ${vals.length} values; enter 2 (benefits, costs: every scenario) or ${2 * S} (one per benefits and costs column, in table order).`);
    const bad = factors.findIndex((f) => !Number.isFinite(f) || f < 0 || f > 100);
    if (bad >= 0) return finRefusal(`Shadow-price conversion factors: factor ${bad + 1} must be between 0 and 100.`);
    factorNote = factors.every((f) => f === 1) ? "" : "applied";
  }
  // scenario names from the header ("Base benefits" → "Base")
  const hdr = b.header;
  const nameOf = (k: number): string => {
    if (!hdr || hdr.length < w) return `Scenario ${k + 1}`;
    const h = (hdr[1 + 2 * k] ?? "").replace(/\s*benefits?\s*$/i, "").trim();
    return h && h.length <= 40 ? h : `Scenario ${k + 1}`;
  };
  const scen: CbaScenario[] = [];
  for (let k = 0; k < S; k++) {
    const sc: CbaScenario = { name: nameOf(k), b: Array(T + 1).fill(0), c: Array(T + 1).fill(0), b0: Array(T + 1).fill(0), c0: Array(T + 1).fill(0) };
    b.rows.forEach((row, i) => {
      const t = years[i] - base;
      sc.b0[t] = row[1 + 2 * k]!;
      sc.c0[t] = row[2 + 2 * k]!;
      sc.b[t] = sc.b0[t] * factors[2 * k];
      sc.c[t] = sc.c0[t] * factors[2 * k + 1];
    });
    scen.push(sc);
  }
  const ms = scen.map((s) => cbaMeasures(s, rate));
  const rateText = `${fx(rateP, 2)}%`;
  const lines: string[] = [];
  lines.push(`Cost–benefit analysis, ${S} scenario${S === 1 ? "" : "s"}, years ${years[0]} to ${years[years.length - 1]} discounted to ${base} at a social discount rate of ${rateText} a year (the rate you entered).`);
  scen.forEach((s, k) => {
    const m = ms[k];
    lines.push(
      `${s.name}: PV of benefits ${fx(m.pvB, 2)}, PV of costs ${fx(m.pvC, 2)}, NPV ${fx(m.npv, 2)}; benefit–cost ratio ${m.bcr === null ? "not defined (the PV of costs is zero or negative)" : fx(m.bcr, 3)}; EIRR ${rootsText(m.irr)}${m.irr.roots.length + m.irr.touches.length > 1 ? " (more than one rate makes NPV zero: the EIRR does not rank this scenario; use NPV)" : ""}.`,
    );
    if (m.npv > 0 && m.pvB > 0 && m.pvC > 0) lines.push(`  Switching values: NPV reaches zero if benefits fall by ${pct(m.npv / m.pvB, 1)} or costs rise by ${pct(m.npv / m.pvC, 1)}.`);
    if (factorNote) lines.push(`  Before the conversion factors (financial flows) the NPV is ${fx(m.npvFinancial, 2)}.`);
  });
  if (S > 1) {
    const order = ms.map((m, k) => k).sort((a, b2) => ms[b2].npv - ms[a].npv);
    lines.push(`Ranking by NPV at ${rateText}: ${order.map((k) => `${scen[k].name} (${fx(ms[k].npv, 2)})`).join(", ")}.`);
  }
  lines.push(...b.notes);
  lines.push(
    `Conventions: each year's flows are discounted as end-of-year amounts, t = year − ${base} (the base year's flows undiscounted), at the single rate entered; NPV = PV(benefits) − PV(costs); BCR = PV(benefits)/PV(costs); EIRR = every rate in −99% to 10,000% at which the NPV of net benefits is zero (corpFinance.irrAll). ` +
      (factorNote ? `Shadow prices: each benefits and costs column is multiplied by its conversion factor (${factors.map((f) => fx(f, 3)).join(", ")}, in table order) before discounting. ` : "No shadow-price conversion factors were entered (all 1). ") +
      "Years missing between rows count as zero flows. Real flows need a real rate, nominal flows a nominal rate. No discount rate is bundled: if your analysis follows OMB Circular A-4, check which version of A-4 is in force for it, and the rate that version prescribes, before citing a rate.",
  );
  const metrics: FinTable = {
    label: `Scenario results at ${rateText}`,
    rows: [["Scenario", "PV benefits", "PV costs", "NPV", "BCR", "EIRR"], ...scen.map((s, k) => [s.name, fx(ms[k].pvB, 2), fx(ms[k].pvC, 2), fx(ms[k].npv, 2), ms[k].bcr === null ? "not defined" : fx(ms[k].bcr!, 3), rootsCell(ms[k].irr)])],
    align: ["left", "right", "right", "right", "right", "right"],
  };
  const grid: number[] = [];
  for (let d = -3; d <= 3; d++) {
    const g = rateP + d;
    if (g > -99) grid.push(g);
  }
  const sens: FinTable = {
    label: "NPV at nearby discount rates",
    rows: [["Discount rate", ...scen.map((s) => s.name)], ...grid.map((g) => [`${fx(g, 2)}%`, ...scen.map((s) => fx(npvAt(g / 100, s.b.map((x, t) => x - s.c[t])), 2))])],
    align: ["right", ...scen.map(() => "right" as const)],
    note: "The rate entered ±1, 2 and 3 percentage points.",
  };
  const allRoots = ms.flatMap((m) => [...m.irr.roots, ...m.irr.touches]);
  // −50% … 100% at most so a far root does not flatten the curves, but always around the rate entered.
  const lo = Math.min(rate - 0.05, Math.max(-0.5, Math.min(0, ...[rate, ...allRoots].map((x) => x - 0.05))));
  const hi = Math.max(rate + 0.05, Math.min(1, Math.max(0.15, rate * 2, ...[rate, ...allRoots].map((x) => x + 0.05))));
  const svg = cbaNpvRateSvg(scen.map((s, k) => ({ name: s.name, b: s.b, c: s.c, roots: [...ms[k].irr.roots, ...ms[k].irr.touches] })), rate, lo, hi);
  if (allRoots.some((x) => x < lo || x > hi)) lines.splice(lines.length - 1, 0, `The figure runs from ${pct(lo, 0)} to ${pct(hi, 0)}; EIRRs listed above outside that range are not marked on it.`);
  return finish({ text: lines.join("\n"), reading: cbaScenariosReading(scen.map((s) => s.name), ms, rateText), svg, tables: [metrics, sens] });
}

/** The plain-language reading of a cost–benefit run: pass or fail at the rate entered, and for several scenarios which does best. */
export function cbaScenariosReading(names: string[], ms: CbaMeasures[], rateText: string): string {
  const verdict = (npv: number): string => (npv > 0 ? "benefits outweigh costs" : npv < 0 ? "costs outweigh benefits" : "benefits and costs balance exactly");
  if (ms.length === 1) {
    const m = ms[0];
    const npvS = fx(m.npv, 2);
    // A value that prints as 0.00 reads as break-even, so the words never contradict the number shown.
    const npv = npvS === "0.00" ? 0 : m.npv;
    const bcr = m.bcr === null ? "" : ` (benefit–cost ratio ${fx(m.bcr, 3)})`;
    const test = npv > 0 ? "passes" : npv < 0 ? "fails" : "just breaks even on";
    return `At ${aAn(rateText)} ${rateText} discount rate the net present value is ${npvS}: ${verdict(npv)}${bcr}, so on these numbers the project ${test} the cost–benefit test.`;
  }
  const order = ms.map((_, k) => k).sort((a, b) => ms[b].npv - ms[a].npv);
  const best = order[0];
  const worst = order[order.length - 1];
  // fix-fin R3 M2: passing is decided on the printed NPV ("all 2 pass … NPV 0.00" read a 0.00 as a pass).
  const printedPositive = (x: number): boolean => x > 0 && /[1-9]/.test(fx(x, 2));
  const pass = ms.filter((m) => printedPositive(m.npv)).length;
  const n = ms.length;
  // R3 MINOR 1: "both", not "all 2 scenarios".
  const count =
    pass === 0
      ? n === 2 ? "neither scenario passes" : `none of the ${n} scenarios passes`
      : pass === n
        ? n === 2 ? "both scenarios pass" : `all ${n} scenarios pass`
        : `${pass} of ${n} scenarios ${pass === 1 ? "passes" : "pass"}`;
  return (
    `At ${aAn(rateText)} ${rateText} discount rate ${count} the cost–benefit test (net present value above zero). ` +
    (fx(ms[best].npv, 2) === fx(ms[worst].npv, 2)
      ? `Every scenario has the same NPV, ${fx(ms[best].npv, 2)}.`
      : `${names[best]} does best with an NPV of ${fx(ms[best].npv, 2)} and ${names[worst]} worst at ${fx(ms[worst].npv, 2)}.`)
  );
}

// ------------------------------------------------------------------------------------------------------------------
// cba-pigou

export interface PigouResult {
  qm: number;
  pm: number;
  qs: number;
  /** Buyers' price at the social optimum (demand at qs). */
  ps: number;
  /** MEC at qs: the Pigouvian tax (negative: a subsidy). */
  tax: number;
  revenue: number;
  dwl: number;
  /** External cost at the market output and at the optimum. */
  extM: number;
  extS: number;
  /** The social optimum is a corner (no output). */
  corner: boolean;
}

/**
 * Demand (marginal benefit) P = a − bQ, marginal private cost MPC = c + dQ, marginal external cost MEC = e₀ + e₁Q,
 * MSC = MPC + MEC. Market: a − bQ = MPC; optimum: a − bQ = MSC. Tax t* = MEC(Q_s); DWL of the unregulated market =
 * |∫ between Q_s and Q_m of (MSC − MB)| = ½·|Q_m − Q_s|·|MSC(Q_m) − MB(Q_m)| (all lines straight).
 */
export function pigou(a: number, b: number, c: number, d: number, e0: number, e1: number): PigouResult | { error: string } {
  if (!(a > c)) return { error: "The market does not trade: the demand intercept a must be above the marginal private cost intercept c." };
  const qm = (a - c) / (b + d);
  if (!(b + d + e1 > 0)) return { error: "The marginal social cost must cut demand from below: b + d + e₁ must be positive." };
  let qs = (a - c - e0) / (b + d + e1);
  let corner = false;
  if (qs < 0) {
    qs = 0;
    corner = true;
  }
  const mec = (q: number): number => e0 + e1 * q;
  const ps = a - b * qs;
  const tax = corner ? a - c : mec(qs);
  const msc = (q: number): number => c + d * q + mec(q);
  const mb = (q: number): number => a - b * q;
  // The area between MSC and demand from Q_s to Q_m: a trapezoid (a triangle when Q_s is interior, where they cross).
  const dwl = 0.5 * Math.abs(qm - qs) * Math.abs(msc(qm) - mb(qm) + (msc(qs) - mb(qs)));
  const ext = (q: number): number => e0 * q + 0.5 * e1 * q * q;
  return { qm, pm: a - b * qm, qs, ps, tax, revenue: tax * qs, dwl, extM: ext(qm), extS: ext(qs), corner };
}

/**
 * The market is already efficient AS PRINTED (fix-fin R3 M2): the two quantities print the same to 4 decimals.
 * Decided once, so the text, table, reading and legend agree ("over-produces (60.0000 vs 60.0000) … tax 0.0000" read
 * a float difference as over-production).
 */
export function pigouEfficient(res: PigouResult): boolean {
  if (res.corner) return false;
  return fx(res.qm, 4) === fx(res.qs, 4);
}

/** Demand, MPC and MSC with the market and optimal points and the deadweight-loss triangle outlined. */
export function pigouSvg(a: number, b: number, c: number, d: number, e0: number, e1: number, res: PigouResult): string {
  const hi = Math.max(res.qm, res.qs) * 1.4 || 1;
  const line = (i0: number, s: number): Point[] => [{ x: 0, y: i0 }, { x: hi, y: i0 + s * hi }];
  const mscAt = (q: number): number => c + e0 + (d + e1) * q;
  const series: Series[] = [
    { type: "line", points: line(a, -b), color: "#0369a1", label: "demand" },
    { type: "line", points: line(c, d), color: "#b45309", label: "marginal private cost" },
    { type: "line", points: line(c + e0, d + e1), color: "#b91c1c", label: "marginal social cost" },
    // fix-fin R3 MINOR 8: no "deadweight loss" legend entry when the printed loss is none.
    ...(pigouEfficient(res)
      ? []
      : [
          {
            type: "line" as const,
            points: [{ x: res.qs, y: a - b * res.qs }, { x: res.qs, y: mscAt(res.qs) }, { x: res.qm, y: mscAt(res.qm) }, { x: res.qm, y: res.pm }, { x: res.qs, y: a - b * res.qs }],
            color: "#6b7280",
            label: "deadweight loss",
          },
        ]),
    { type: "scatter", points: [{ x: res.qm, y: res.pm }], color: "#111827", label: "market outcome" },
    { type: "scatter", points: [{ x: res.qs, y: res.ps }], color: "#15803d", label: "social optimum" },
  ];
  return finPlotSvg(series, { width: 400, height: 280, title: "Externality and the Pigouvian tax", xlabel: "quantity Q", ylabel: "price, cost per unit" });
}

export function pigouCalc(r: Read): FinResult {
  const v: number[] = [];
  for (const [k, label, o] of [
    ["a", "demand intercept a", {}],
    ["b", "demand slope b", { min: 0, minOpen: true }],
    ["c", "marginal private cost intercept c", {}],
    ["d", "marginal private cost slope d", { min: 0 }],
    ["e0", "marginal external cost intercept e₀", {}],
    ["e1", "marginal external cost slope e₁", {}],
  ] as [string, string, NumOpts][]) {
    const x = num(r, k, label, o);
    if (typeof x === "string") return finRefusal(x);
    v.push(x);
  }
  const [a, b, c, d, e0, e1] = v;
  const res = pigou(a, b, c, d, e0, e1);
  if ("error" in res) return finRefusal(res.error);
  const efficient = pigouEfficient(res);
  const neg = !efficient && res.qm > res.qs;
  const lines: string[] = [];
  lines.push(`Demand (marginal benefit) P = ${fx(a, 2)} − ${fx(b, 4)}Q; marginal private cost MPC = ${fx(c, 2)} + ${fx(d, 4)}Q; marginal external cost MEC = ${fx(e0, 2)} ${e1 < 0 ? "−" : "+"} ${fx(Math.abs(e1), 4)}Q; marginal social cost MSC = MPC + MEC.`);
  lines.push(`Unregulated market (demand = MPC): Q = ${fx(res.qm, 4)}, price ${fx(res.pm, 4)}; external cost ${fx(res.extM, 2)}.`);
  if (res.corner) {
    lines.push(`Social optimum: no output. Marginal social cost exceeds marginal benefit at every quantity (a ≤ c + e₀), so any tax of at least a − c = ${fx(res.tax, 4)} per unit, or a ban, is efficient.`);
  } else {
    lines.push(`Social optimum (demand = MSC): Q = ${fx(res.qs, 4)}, buyers' price ${fx(res.ps, 4)}; external cost ${fx(res.extS, 2)}.`);
    lines.push(
      res.tax >= 0
        ? `Pigouvian tax = MEC at the optimum = ${fx(res.tax, 4)} per unit; it raises ${fx(res.revenue, 2)} and moves the market to the optimum (sellers receive ${fx(res.ps - res.tax, 4)}).`
        : `The externality is a benefit: the Pigouvian instrument is a subsidy of ${fx(-res.tax, 4)} per unit (MEC at the optimum is negative), costing ${fx(-res.revenue, 2)}.`,
    );
  }
  lines.push(`Deadweight loss of the unregulated market: ${fx(res.dwl, 2)} (${neg ? "over-production" : !efficient && res.qm < res.qs ? "under-production" : "none: the market is already efficient"}).`);
  lines.push(
    "Conventions: straight-line demand, marginal private cost and marginal external cost; competitive market; a per-unit tax equal to the marginal external cost AT THE SOCIAL OPTIMUM (with a sloped MEC this differs from the marginal external cost at the market output). Deadweight loss is the area between MSC and demand from the optimal to the market output. Amounts are in the units typed.",
  );
  const t: FinTable = {
    label: "Market against social optimum",
    rows: [
      ["Measure", "Unregulated market", "Social optimum"],
      ["Quantity", fx(res.qm, 4), fx(res.qs, 4)],
      ["Buyers' price", fx(res.pm, 4), fx(res.ps, 4)],
      ["Marginal external cost", fx(e0 + e1 * res.qm, 4), fx(e0 + e1 * res.qs, 4)],
      ["Total external cost", fx(res.extM, 2), fx(res.extS, 2)],
      // R3 MINOR 8: the zero cells at the column's own precision.
      ["Tax per unit", fx(0, 4), fx(res.tax, 4)],
      ["Deadweight loss", fx(res.dwl, 2), fx(0, 2)],
    ],
    align: ["left", "right", "right"],
  };
  return finish({ text: lines.join("\n"), reading: pigouReading(res), svg: pigouSvg(a, b, c, d, e0, e1, res), tables: [t] });
}

/** The plain-language reading of the Pigouvian result: over- or under-production, the waste, and the corrective tax or subsidy. */
export function pigouReading(res: PigouResult): string {
  const qm = fx(res.qm, 4);
  const qs = fx(res.qs, 4);
  const dwl = fx(res.dwl, 2);
  if (res.corner) {
    return `The efficient output is zero: every unit costs society more than it is worth, so a tax of at least ${fx(res.tax, 4)} per unit (or a ban) is efficient; left alone the market produces ${qm} units and wastes ${dwl}.`;
  }
  // The same comparison the text's deadweight-loss line makes, on the printed quantities (R3 M2).
  if (pigouEfficient(res)) {
    return `The unregulated market already produces the efficient ${qm} units: there is no deadweight loss and no corrective tax is needed.`;
  }
  if (res.qm > res.qs) {
    return `Left unregulated, the market over-produces (${qm} units against the efficient ${qs}) and wastes ${dwl} in deadweight loss; a tax of ${fx(res.tax, 4)} per unit, the external cost at the efficient output, corrects it.`;
  }
  if (res.qm < res.qs) {
    return `Left unregulated, the market under-produces (${qm} units against the efficient ${qs}) because the side effect is a benefit, losing ${dwl}; a subsidy of ${fx(-res.tax, 4)} per unit corrects it.`;
  }
  return `The unregulated market already produces the efficient ${qm} units: there is no deadweight loss and no corrective tax is needed.`;
}

// ------------------------------------------------------------------------------------------------------------------
// fx-cip

export type DayBasis = "360" | "365";
export interface CipResult {
  F: number;
  tauD: number;
  tauF: number;
  growD: number;
  growF: number;
}
/**
 * Covered interest parity, S in domestic per unit of foreign currency:
 *  simple       F = S·(1 + i_d·τ_d)/(1 + i_f·τ_f), τ = days/360 or days/365 per currency's money-market basis;
 *  continuous   F = S·exp(i_d·τ_d − i_f·τ_f).
 */
export function cipForward(S: number, id: number, iff: number, days: number, bd: DayBasis, bf: DayBasis, comp: "simple" | "continuous"): CipResult {
  const tauD = days / Number(bd);
  const tauF = days / Number(bf);
  const growD = comp === "simple" ? 1 + id * tauD : Math.exp(id * tauD);
  const growF = comp === "simple" ? 1 + iff * tauF : Math.exp(iff * tauF);
  return { F: (S * growD) / growF, tauD, tauF, growD, growF };
}

export function cipCalc(r: Read): FinResult {
  const S = num(r, "spot", "spot rate (domestic per unit of foreign)", { min: 0, minOpen: true });
  if (typeof S === "string") return finRefusal(S);
  const id = num(r, "id", "domestic interest rate (% a year)", { min: -99, max: 1000, minOpen: true });
  if (typeof id === "string") return finRefusal(id);
  const iff = num(r, "if", "foreign interest rate (% a year)", { min: -99, max: 1000, minOpen: true });
  if (typeof iff === "string") return finRefusal(iff);
  const days = num(r, "days", "tenor (days)", { min: 1, max: 36500, int: true });
  if (typeof days === "string") return finRefusal(days);
  const bd = (r("dbasis") || "360") as DayBasis;
  const bf = (r("fbasis") || "360") as DayBasis;
  if (!["360", "365"].includes(bd) || !["360", "365"].includes(bf)) return finRefusal("Day-count basis: choose ACT/360 or ACT/365 Fixed.");
  const comp = (r("comp") || "simple") as "simple" | "continuous";
  if (comp !== "simple" && comp !== "continuous") return finRefusal(`Compounding: unknown choice “${comp}”.`);
  const fq = optNum(r, "fwd", "quoted forward rate", { min: 0, minOpen: true });
  if (typeof fq === "string") return finRefusal(fq);
  const N = optNum(r, "notional", "notional (domestic currency)", { min: 0, minOpen: true });
  if (typeof N === "string") return finRefusal(N);
  const base = readCode(r, "base", "Foreign (base) currency");
  if (base && typeof base === "object") return finRefusal(base.error);
  const quote = readCode(r, "quote", "Domestic (quote) currency");
  if (quote && typeof quote === "object") return finRefusal(quote.error);
  if (base && quote && base === quote) return finRefusal(`The two currencies are the same (${base}).`);
  const res = cipForward(S, id / 100, iff / 100, days, bd, bf, comp);
  if (!(res.growD > 0) || !(res.growF > 0)) return finRefusal("A rate this negative makes 1 + i·τ zero or negative over the tenor.");
  const pair = base && quote ? `${base}/${quote}: ${quote} per ${base}` : base ? `${base} against the domestic currency` : quote ? `foreign currency against ${quote}` : "domestic per unit of foreign currency";
  const lines: string[] = [];
  lines.push(`Spot S = ${fx(S, 6)} (${pair}); domestic rate ${fx(id, 4)}%, foreign rate ${fx(iff, 4)}%; tenor ${days.toLocaleString("en-US")} day${days === 1 ? "" : "s"}.`);
  lines.push(`Forward by covered interest parity: F = ${fx(res.F, 6)}; forward points F − S = ${fx(res.F - S, 6)}; forward premium of the foreign currency F/S − 1 = ${pct(res.F / S - 1, 4)} over the tenor.`);
  const tag = comp === "simple" ? `F = S·(1 + i·d/${bd})/(1 + i*·d/${bf})` : `F = S·exp(i·d/${bd} − i*·d/${bf})`;
  if (fq !== null) {
    const notional = N ?? 1_000_000;
    // Per unit of domestic currency borrowed: borrow domestic, buy foreign spot, deposit foreign, sell it forward.
    const edge = (fq / S) * res.growF - res.growD;
    const profit = Math.abs(edge) * notional;
    lines.push(`Quoted forward ${fx(fq, 6)} against the parity forward ${fx(res.F, 6)}: deviation ${fx(fq - res.F, 6)} (${fx(((fq - res.F) / res.F) * 10000, 2)} basis points of the forward).`);
    if (cipHoldsAsPrinted(fq, res.F, edge)) lines.push("Covered interest parity holds at the quoted forward (to the 6 decimals shown): there is no covered arbitrage.");
    else if (edge > 0)
      lines.push(
        `Covered arbitrage: the foreign currency is dear forward. Borrow ${amt(notional, quote)} domestic at ${fx(id, 4)}%, buy ${amt(notional / S, base)} foreign at spot, deposit it at ${fx(iff, 4)}%, and sell the ${amt((notional / S) * res.growF, base)} proceeds forward at ${fx(fq, 6)}: at maturity this returns ${amt(notional * (fq / S) * res.growF, quote)} against a loan repayment of ${amt(notional * res.growD, quote)}, a riskless profit of ${amt(profit, quote)}.`,
      );
    else
      lines.push(
        `Covered arbitrage: the foreign currency is cheap forward. Borrow ${amt(notional / S, base)} foreign at ${fx(iff, 4)}%, sell it spot for ${amt(notional, quote)}, deposit that at ${fx(id, 4)}%, and buy the ${amt((notional / S) * res.growF, base)} needed to repay forward at ${fx(fq, 6)}: at maturity the deposit pays ${amt(notional * res.growD, quote)} and the forward costs ${amt(notional * (fq / S) * res.growF, quote)}, a riskless profit of ${amt(profit, quote)}.`,
      );
  }
  lines.push(
    `Conventions: S and F quoted as domestic (quote) currency per unit of foreign (base) currency; ${comp === "simple" ? `simple money-market interest over the tenor, ${tag}, with i the domestic rate on ACT/${bd === "360" ? "360" : "365 Fixed"} and i* the foreign rate on ACT/${bf === "360" ? "360" : "365 Fixed"} (USD and EUR deposits use ACT/360, GBP ACT/365 Fixed)` : `continuous compounding, ${tag}, i the domestic and i* the foreign rate, d the days, each year fraction on its currency's basis (ACT/${bd} domestic, ACT/${bf} foreign)`}. ` +
      "The arbitrage check ignores bid–ask spreads, transaction costs, credit and counterparty risk, and settlement lags; real deviations from parity (the cross-currency basis) can persist because of them.",
  );
  const t: FinTable = {
    label: "Covered interest parity",
    rows: [
      ["Measure", "Value"],
      ["Spot S", fx(S, 6)],
      ["Domestic growth factor over the tenor", fx(res.growD, 8)],
      ["Foreign growth factor over the tenor", fx(res.growF, 8)],
      ["Parity forward F", fx(res.F, 6)],
      ["Forward points F − S", fx(res.F - S, 6)],
      ...(fq !== null ? [["Quoted forward", fx(fq, 6)], ["Deviation (quoted − parity)", fx(fq - res.F, 6)]] : []),
    ],
    align: ["left", "right"],
  };
  // the parity forward at each tenor is the engine's own cipForward on the same rates and day counts
  const svg = cipParitySvg((d) => cipForward(S, id / 100, iff / 100, d, bd, bf, comp).F, days, fq);
  return finish({ text: lines.join("\n"), reading: cipReading(S, res, days, fq, N ?? 1_000_000, quote), svg, tables: [t] });
}

/**
 * Covered interest parity holds AS PRINTED (fix-fin R2 #11): the quoted and parity forwards print the same to 6
 * decimals (or the edge is float noise). A quote equal to parity as printed used to report an arbitrage.
 */
export function cipHoldsAsPrinted(fq: number, F: number, edge: number): boolean {
  return Math.abs(edge) < 1e-12 || fx(fq, 6) === fx(F, 6);
}

/**
 * The plain-language reading of covered interest parity: the parity forward against spot, or the quoted forward
 * against parity and the covered arbitrage it opens (the same `edge` the text branches on).
 */
export function cipReading(S: number, res: CipResult, days: number, fq: number | null, notional: number, quote: string | null): string {
  const F = fx(res.F, 6);
  if (fq === null) {
    const side =
      res.F > S
        ? `above the spot ${fx(S, 6)} because a domestic deposit earns more than a foreign one over the tenor`
        : res.F < S
          ? `below the spot ${fx(S, 6)} because a foreign deposit earns more than a domestic one over the tenor`
          : `equal to the spot because the two deposits earn the same over the tenor`;
    return `The ${days.toLocaleString("en-US")}-day forward rate that leaves no riskless arbitrage is ${F}, ${side}.`;
  }
  const edge = (fq / S) * res.growF - res.growD;
  if (cipHoldsAsPrinted(fq, res.F, edge)) {
    return `The quoted forward ${fx(fq, 6)} matches the parity forward ${F} to the 6 decimals shown: covered interest parity holds and there is no riskless arbitrage.`;
  }
  const bpS = fx(Math.abs(((fq - res.F) / res.F) * 10000), 2);
  // A deviation that prints as 0.00 basis points is described, not printed as zero beside a nonzero profit.
  const bp = bpS === "0.00" ? "a fraction of a basis point" : `${bpS} basis points`;
  const profit = amt(Math.abs(edge) * notional, quote);
  const per = amt(notional, quote);
  return edge > 0
    ? `The quoted forward ${fx(fq, 6)} is ${bp} above parity (${F}), so borrowing domestic, converting and selling forward locks in about ${profit} per ${per} borrowed, before trading costs.`
    : `The quoted forward ${fx(fq, 6)} is ${bp} below parity (${F}), so borrowing foreign, converting and buying forward locks in about ${profit} per ${per} of domestic currency, before trading costs.`;
}

// ------------------------------------------------------------------------------------------------------------------
// fx-uip

export function uipCalc(r: Read): FinResult {
  const S = num(r, "spot", "spot rate (domestic per unit of foreign)", { min: 0, minOpen: true });
  if (typeof S === "string") return finRefusal(S);
  const id = num(r, "id", "domestic interest rate (% a year)", { min: -99, max: 1000, minOpen: true });
  if (typeof id === "string") return finRefusal(id);
  const iff = num(r, "if", "foreign interest rate (% a year)", { min: -99, max: 1000, minOpen: true });
  if (typeof iff === "string") return finRefusal(iff);
  const T = num(r, "years", "horizon (years)", { min: 0, minOpen: true, max: 100 });
  if (typeof T === "string") return finRefusal(T);
  const sT = optNum(r, "st", "realized spot at the horizon", { min: 0, minOpen: true });
  if (typeof sT === "string") return finRefusal(sT);
  const base = readCode(r, "base", "Foreign (base) currency");
  if (base && typeof base === "object") return finRefusal(base.error);
  const quote = readCode(r, "quote", "Domestic (quote) currency");
  if (quote && typeof quote === "object") return finRefusal(quote.error);
  if (base && quote && base === quote) return finRefusal(`The two currencies are the same (${base}).`);
  const gd = 1 + id / 100;
  const gf = 1 + iff / 100;
  const ratio = Math.pow(gd / gf, T);
  const eS = S * ratio;
  const lines: string[] = [];
  lines.push(`Spot S = ${fx(S, 6)} (domestic per unit of foreign${base && quote ? `: ${quote} per ${base}` : ""}); domestic rate ${fx(id, 4)}%, foreign rate ${fx(iff, 4)}% a year; horizon ${fx(T, T % 1 ? 2 : 0)} year${T === 1 ? "" : "s"}.`);
  lines.push(`Uncovered interest parity: expected depreciation of the domestic currency (rise in S) = (1 + i)/(1 + i*) − 1 = ${pct(gd / gf - 1, 4)} a year (approximation i − i* = ${pct((id - iff) / 100, 4)}); over the horizon ${pct(ratio - 1, 4)}.`);
  lines.push(`Expected spot at the horizon E[S(T)] = S·((1 + i)/(1 + i*)) to the power T = ${fx(eS, 6)}; under UIP this equals the forward rate for the same date (annual compounding).`);
  if (sT !== null) {
    const excess = (sT / S) * Math.pow(gf, T) / Math.pow(gd, T) - 1;
    // fix-fin R2 #1: "the carry trade" is borrowing the low-rate currency to deposit the high-rate one, so it is named
    // only when the foreign rate is the higher; the sign is read on the printed excess return.
    const evenAsPrinted = pct(Math.abs(excess), 4) === "0.0000%";
    const why = evenAsPrinted
      ? " (UIP held to the precision shown)"
      : excess > 0
        ? gf > gd
          ? " (the carry trade paid: UIP failed in its favor)"
          : " (UIP failed in favor of the foreign deposit)"
        : " (UIP failed against it)";
    lines.push(`Realized spot ${fx(sT, 6)} against the UIP expectation ${fx(eS, 6)} (${pct(sT / eS - 1, 4)}): a foreign deposit funded in domestic currency earned an excess return of ${pct(excess, 4)} over the horizon${why}.`);
  }
  lines.push(
    "Conventions: i is the domestic and i* the foreign interest rate; annual compounding at the quoted yearly rates; S quoted as domestic per unit of foreign currency; risk neutrality and rational expectations (UIP), which the data often reject (the forward-premium puzzle). The expectation is a parity benchmark, not a forecast.",
  );
  const t: FinTable = {
    label: "Uncovered interest parity",
    rows: [
      ["Measure", "Value"],
      ["Expected depreciation per year", pct(gd / gf - 1, 4)],
      ["Approximation i − i* (domestic minus foreign rate)", pct((id - iff) / 100, 4)],
      ["Expected depreciation over the horizon", pct(ratio - 1, 4)],
      ["Expected spot at the horizon", fx(eS, 6)],
      ...(sT !== null ? [["Excess return of the foreign deposit", pct((sT / S) * Math.pow(gf, T) / Math.pow(gd, T) - 1, 4)]] : []),
    ],
    align: ["left", "right"],
  };
  return finish({ text: lines.join("\n"), reading: uipReading(S, gd, gf, T, sT), svg: uipPathSvg(S, gd / gf, T, sT), tables: [t] });
}

/** The plain-language reading of uncovered interest parity: the expected move, and against a realized spot the carry's excess return. */
export function uipReading(S: number, gd: number, gf: number, T: number, sT: number | null): string {
  const ratio = Math.pow(gd / gf, T);
  const eS = fx(S * ratio, 6);
  const span = `${fx(T, T % 1 ? 2 : 0)} year${T === 1 ? "" : "s"}`;
  const moveS = pct(Math.abs(ratio - 1), 4);
  const first =
    moveS === "0.0000%"
      ? `Uncovered interest parity implies no expected change in the exchange rate over ${span} (${eS} per unit of foreign currency)`
      : `Under uncovered interest parity the domestic currency is expected to ${ratio > 1 ? "weaken" : "strengthen"} by ${moveS} over ${span}, to ${eS} per unit of foreign currency`;
  if (sT === null) return `${first}; this is a parity benchmark, not a forecast.`;
  // The same excess return, and the same sign test, as the text's realized-spot line.
  const excess = (sT / S) * Math.pow(gf, T) / Math.pow(gd, T) - 1;
  const second =
    pct(Math.abs(excess), 4) === "0.0000%"
      ? `At the realized ${fx(sT, 6)}, a foreign deposit funded at home came out even with a domestic one.`
      : excess > 0
        ? `At the realized ${fx(sT, 6)}, a foreign deposit funded at home came out ${pct(excess, 4)} ahead${gf > gd ? " (the carry trade paid)" : ""}.`
        : `At the realized ${fx(sT, 6)}, a foreign deposit funded at home came out ${pct(-excess, 4)} behind.`;
  return `${first}. ${second}`;
}

// ------------------------------------------------------------------------------------------------------------------
// fx-ppp

export function pppCalc(r: Read): FinResult {
  const mode = r("mode") || "absolute";
  if (mode !== "absolute" && mode !== "relative") return finRefusal(`PPP form: unknown choice “${mode}”.`);
  const base = readCode(r, "base", "Foreign currency");
  if (base && typeof base === "object") return finRefusal(base.error);
  const quote = readCode(r, "quote", "Domestic currency");
  if (quote && typeof quote === "object") return finRefusal(quote.error);
  if (base && quote && base === quote) return finRefusal(`The two currencies are the same (${base}).`);
  const lines: string[] = [];
  const rows: string[][] = [["Measure", "Value"]];
  let reading = "";
  let svg: string | undefined;
  if (mode === "absolute") {
    const pd = num(r, "pd", "domestic price level (cost of the basket in domestic currency)", { min: 0, minOpen: true });
    if (typeof pd === "string") return finRefusal(pd);
    const pf = num(r, "pf", "foreign price level (cost of the basket in foreign currency)", { min: 0, minOpen: true });
    if (typeof pf === "string") return finRefusal(pf);
    const S = optNum(r, "spot", "actual spot rate", { min: 0, minOpen: true });
    if (typeof S === "string") return finRefusal(S);
    const sp = pd / pf;
    lines.push(`Absolute PPP: the basket costs ${amt(pd, quote)} at home and ${amt(pf, base)} abroad, so the PPP exchange rate is S(PPP) = P/P* = ${fx(sp, 6)} domestic per unit of foreign currency.`);
    rows.push(["PPP exchange rate P/P*", fx(sp, 6)]);
    reading = pppAbsoluteReading(sp, S);
    svg = pppBasketSvg(pd, pf, S, (x) => amt(x, quote));
    if (S !== null) {
      const q = (S * pf) / pd;
      const mis = S / sp - 1;
      lines.push(`At the actual spot ${fx(S, 6)} the real exchange rate q = S·P*/P = ${fx(q, 4)}: the foreign currency is ${mis > 0 ? "overvalued" : mis < 0 ? "undervalued" : "at parity"} by ${pct(Math.abs(mis), 2)} against PPP (equivalently the domestic currency is ${mis > 0 ? "undervalued" : mis < 0 ? "overvalued" : "at parity"} by ${pct(Math.abs(sp / S - 1), 2)}).`);
      rows.push(["Actual spot", fx(S, 6)], ["Real exchange rate S·P*/P", fx(q, 4)], ["Foreign currency against PPP", `${mis >= 0 ? "+" : "−"}${pct(Math.abs(mis), 2)}`]);
    }
    lines.push("Conventions: S quoted as domestic currency per unit of foreign currency; absolute PPP compares the cost of the same basket in each currency (the law of one price for the basket); deviations persist because of non-traded goods, trade costs and different baskets.");
  } else {
    const S0 = num(r, "spot", "spot rate today", { min: 0, minOpen: true });
    if (typeof S0 === "string") return finRefusal(S0);
    const pd = num(r, "infd", "domestic inflation (% a year)", { min: -99, max: 100000, minOpen: true });
    if (typeof pd === "string") return finRefusal(pd);
    const pf = num(r, "inff", "foreign inflation (% a year)", { min: -99, max: 100000, minOpen: true });
    if (typeof pf === "string") return finRefusal(pf);
    const T = num(r, "years", "horizon (years)", { min: 0, minOpen: true, max: 100 });
    if (typeof T === "string") return finRefusal(T);
    const g = (1 + pd / 100) / (1 + pf / 100);
    const ST = S0 * Math.pow(g, T);
    lines.push(`Relative PPP: domestic inflation ${fx(pd, 4)}% and foreign inflation ${fx(pf, 4)}% a year; the exchange rate moves by (1 + π)/(1 + π*) − 1 = ${pct(g - 1, 4)} a year (approximation π − π* = ${pct((pd - pf) / 100, 4)}).`);
    lines.push(`From S₀ = ${fx(S0, 6)}, after ${fx(T, T % 1 ? 2 : 0)} year${T === 1 ? "" : "s"}: S(T) = S₀·((1 + π)/(1 + π*)) to the power T = ${fx(ST, 6)} (${pct(Math.pow(g, T) - 1, 4)}).`);
    rows.push(["Change per year", pct(g - 1, 4)], ["Approximation π − π*", pct((pd - pf) / 100, 4)], ["Spot after the horizon", fx(ST, 6)], ["Change over the horizon", pct(Math.pow(g, T) - 1, 4)]);
    reading = pppRelativeReading(S0, pd, pf, T);
    svg = pppPathSvg(S0, g, T);
    lines.push("Conventions: S quoted as domestic currency per unit of foreign currency; inflation compounded annually; relative PPP holds the real exchange rate constant, so the currency with the higher inflation depreciates by the inflation differential.");
  }
  return finish({ text: lines.join("\n"), reading, svg, tables: [{ label: mode === "absolute" ? "Absolute purchasing-power parity" : "Relative purchasing-power parity", rows, align: ["left", "right"] }] });
}

/** The plain-language reading of absolute PPP: the parity rate, and against an actual spot which currency is dear. */
export function pppAbsoluteReading(sp: number, S: number | null): string {
  const spS = fx(sp, 6);
  if (S === null) return `Purchasing-power parity puts the exchange rate at ${spS} domestic per unit of foreign currency, the rate at which the basket costs the same in both countries.`;
  // The same misvaluation, and the same sign test, as the text.
  const mis = S / sp - 1;
  if (pct(Math.abs(mis), 2) === "0.00%") return `At the actual spot ${fx(S, 6)} the exchange rate is at the purchasing-power parity rate ${spS}: the basket costs the same in both countries.`;
  return mis > 0
    ? `At the actual spot ${fx(S, 6)} the foreign currency is overvalued by ${pct(Math.abs(mis), 2)} against the purchasing-power parity rate of ${spS}: the basket costs more abroad than at home.`
    : `At the actual spot ${fx(S, 6)} the foreign currency is undervalued by ${pct(Math.abs(mis), 2)} against the purchasing-power parity rate of ${spS}: the basket costs less abroad than at home.`;
}

/** The plain-language reading of relative PPP: where the inflation gap moves the exchange rate over the horizon. */
export function pppRelativeReading(S0: number, pd: number, pf: number, T: number): string {
  const g = (1 + pd / 100) / (1 + pf / 100);
  const ST = fx(S0 * Math.pow(g, T), 6);
  const span = `${fx(T, T % 1 ? 2 : 0)} year${T === 1 ? "" : "s"}`;
  const infl = `With inflation of ${fx(pd, 4)}% at home and ${fx(pf, 4)}% abroad`;
  const move = pct(Math.abs(Math.pow(g, T) - 1), 4);
  if (move === "0.0000%") return `${infl}, relative purchasing-power parity leaves the exchange rate at ${ST} over ${span}.`;
  return g > 1
    ? `${infl}, relative purchasing-power parity has the exchange rate rising ${move} over ${span}, from ${fx(S0, 6)} to ${ST} per unit of foreign currency: the domestic currency weakens.`
    : `${infl}, relative purchasing-power parity has the exchange rate falling ${move} over ${span}, from ${fx(S0, 6)} to ${ST} per unit of foreign currency: the domestic currency strengthens.`;
}

// ------------------------------------------------------------------------------------------------------------------
// Registry

const BASIS_OPTIONS = [
  { value: "360", label: "ACT/360 (USD, EUR money markets)" },
  { value: "365", label: "ACT/365 Fixed (GBP money market)" },
];

export const CBA_CALCS: FinCalcDef[] = [
  {
    id: "cba-scenarios",
    group: "Capital budgeting & valuation",
    name: "Cost–benefit analysis: NPV, BCR and EIRR by scenario",
    fields: [
      { key: "data", label: "Year, then benefits and costs columns for each scenario (names in a header row, such as “Base benefits”, “Base costs”; illustrative numbers by default)", default: CBA_DEFAULT, kind: "block" },
      { key: "rate", label: "Social discount rate (% a year; your choice, the default is illustrative)", default: "4" },
      { key: "base", label: "Base year discounted to (blank: the first year)", default: "", optional: true },
      { key: "factors", label: "Shadow-price conversion factors: benefits, costs (2 values) or one per column (blank: none)", default: "", kind: "list", optional: true },
    ],
    assumes:
      "One social discount rate for every year, applied to end-of-year flows; benefits and costs measured in the same (real or nominal) terms as the rate; conversion factors turn market prices into shadow prices line by line. " +
      "JurisLab bundles no discount rate: if the analysis follows OMB Circular A-4, check which version of A-4 is in force for it before citing a rate.",
    compute: (r) => {
      // NPV, benefit–cost ratio, every EIRR and switching values per scenario, the NPV sensitivity table and figure.
      return cbaScenariosCalc(r);
    },
  },
  {
    id: "cba-pigou",
    group: "Capital budgeting & valuation",
    name: "Pigouvian tax and externality (linear)",
    fields: [
      { key: "a", label: "Demand intercept a (marginal benefit P = a − bQ)", default: "100" },
      { key: "b", label: "Demand slope b", default: "1" },
      { key: "c", label: "Marginal private cost intercept c (MPC = c + dQ)", default: "10" },
      { key: "d", label: "Marginal private cost slope d", default: "0.5" },
      { key: "e0", label: "Marginal external cost intercept e₀ (MEC = e₀ + e₁Q)", default: "6" },
      { key: "e1", label: "Marginal external cost slope e₁", default: "0.2" },
    ],
    assumes: "A competitive market with straight-line demand and costs, and a marginal external cost known to the regulator; the tax is per unit of output.",
    compute: (r) => {
      // market vs social optimum, Pigouvian tax at the optimum's MEC, deadweight loss, with the externality figure
      return pigouCalc(r);
    },
  },
  {
    id: "fx-cip",
    group: "Currency",
    name: "Covered interest parity: forward rate and arbitrage check",
    fields: [
      { key: "spot", label: "Spot rate S (domestic per unit of foreign currency)", default: "1.25" },
      { key: "id", label: "Domestic interest rate (% a year)", default: "5" },
      { key: "if", label: "Foreign interest rate (% a year)", default: "3" },
      { key: "days", label: "Tenor (days)", default: "182" },
      { key: "dbasis", label: "Domestic day count", default: "360", kind: "select", options: BASIS_OPTIONS },
      { key: "fbasis", label: "Foreign day count", default: "360", kind: "select", options: BASIS_OPTIONS },
      {
        key: "comp",
        label: "Compounding",
        default: "simple",
        kind: "select",
        options: [
          { value: "simple", label: "Simple (money-market deposits)" },
          { value: "continuous", label: "Continuous" },
        ],
      },
      { key: "fwd", label: "Quoted forward rate for the arbitrage check (blank: none)", default: "1.265", optional: true },
      { key: "notional", label: "Notional in domestic currency for the arbitrage (blank: 1,000,000)", default: "1,000,000", optional: true },
      { key: "base", label: "Foreign (base) currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
      { key: "quote", label: "Domestic (quote) currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
    ],
    assumes: "The rates typed are the riskless deposit rates for the tenor in each currency; no spreads, costs, credit risk or settlement lags. JurisLab has no live rates.",
    compute: (r) => {
      // parity forward from spot and the two rates (simple per-currency day count, or continuous), covered arbitrage
      return cipCalc(r);
    },
  },
  {
    id: "fx-uip",
    group: "Currency",
    name: "Uncovered interest parity: expected depreciation",
    fields: [
      { key: "spot", label: "Spot rate S (domestic per unit of foreign currency)", default: "1.25" },
      { key: "id", label: "Domestic interest rate (% a year)", default: "5" },
      { key: "if", label: "Foreign interest rate (% a year)", default: "3" },
      { key: "years", label: "Horizon (years)", default: "1" },
      { key: "st", label: "Realized spot at the horizon, for the excess return (blank: none)", default: "1.24", optional: true },
      { key: "base", label: "Foreign (base) currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
      { key: "quote", label: "Domestic (quote) currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
    ],
    assumes: "Risk-neutral investors with rational expectations, annual compounding; a parity benchmark, not a forecast.",
    compute: (r) => {
      // expected depreciation and expected spot under UIP, the carry trade's excess return against a realized spot
      return uipCalc(r);
    },
  },
  {
    id: "fx-ppp",
    group: "Currency",
    name: "Purchasing-power parity: absolute and relative",
    fields: [
      {
        key: "mode",
        label: "PPP form",
        default: "absolute",
        kind: "select",
        options: [
          { value: "absolute", label: "Absolute: price levels" },
          { value: "relative", label: "Relative: inflation differential" },
        ],
      },
      { key: "pd", label: "Domestic price of the basket (absolute)", default: "5.50", optional: true },
      { key: "pf", label: "Foreign price of the basket (absolute)", default: "4.80", optional: true },
      { key: "spot", label: "Spot rate S, domestic per unit of foreign (absolute: optional; relative: today's)", default: "1.25", optional: true },
      { key: "infd", label: "Domestic inflation (% a year, relative)", default: "4", optional: true },
      { key: "inff", label: "Foreign inflation (% a year, relative)", default: "2", optional: true },
      { key: "years", label: "Horizon (years, relative)", default: "5", optional: true },
      { key: "base", label: "Foreign currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
      { key: "quote", label: "Domestic currency, ISO 4217 code (blank: no currency)", default: "", kind: "text", optional: true },
    ],
    assumes: "The same basket priced in both countries (absolute PPP) or a constant real exchange rate (relative PPP); prices and inflation as typed.",
    compute: (r) => {
      // PPP exchange rate, real exchange rate and misvaluation; or the inflation-differential path of the spot rate
      return pppCalc(r);
    },
  },
];
