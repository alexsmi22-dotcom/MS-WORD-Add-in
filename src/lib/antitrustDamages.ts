/**
 * Antitrust overcharge damages (Release F2, gap item #20): before/during/after by the dummy-variable regression
 * method and by the forecast method, the overcharge, the pass-through rate (entered or estimated) and the damages
 * table (overcharge × purchases by period). A guided wrapper over the product's OLS (olsInference.fitOls) and its
 * regression reader (regData: parseRegData, findColumn, selectColumns); the purchases table goes through the damages
 * period reader (parsePeriodTable). Money prints in US dollars; a pasted table naming another currency is refused.
 *
 * Arithmetic on the user's inputs only: the prices, period labels, controls, purchases and pass-through are the
 * user's. Nothing here says what anyone is entitled to.
 *
 * CONVENTIONS (printed in every result):
 *  - Period labels: before / during / after (also pre, post, conspiracy, cartel), any case.
 *  - Dummy-variable method: one regression on every row, price (or ln price) on the controls and a dummy that is 1 in
 *    the during period; the before and after rows together are the benchmark. The but-for price of a during row is
 *    its price less the dummy's effect: P − δ (level) or P·exp(−δ) (log).
 *  - Forecast method: the regression on the before rows only, projected into the during rows: but-for = the fitted
 *    value (level) or exp(fitted ln price) (log; no retransformation correction). The after rows are not used.
 *  - Over the during rows: overcharge per unit = mean(P − but-for); overcharge % of the but-for price =
 *    Σ(P − but-for) / Σ but-for (= exp(δ) − 1 for the log dummy); share of the actual price = Σ(P − but-for) / ΣP
 *    (= 1 − exp(−δ) for the log dummy). One rate per method applies to every purchases row.
 *  - Damages per purchases row: purchases in dollars × the share of the actual price, or purchases in units × the
 *    overcharge per unit; rounded to the cent, totals summed from the rounded rows.
 *  - Pass-through: entered, or the OLS slope of the resale price on the cost (with a constant) from a pasted table;
 *    the amount passed on = rate × damages.
 */
import { foreignCurrencyRefusal } from "./damagesUsd";
import { whitespaceTable, thinIndices } from "./securitiesDamages";
import { dmgMoney, dmgUnitMoney, dmgQty, parsePeriodTable, roundCents } from "./patentDamages";
import { finPlotSvg } from "./financeFigures";
import { readFinanceField } from "./finance";
import { parseRegData, findColumn, selectColumns, type RegDataset } from "./regData";
import { fitOls, type OlsFit, type SeType } from "./olsInference";
import { fmtFixed, fmtP } from "./regTable";
import type { ModelTerm } from "./regModel";
import { finRefusal, type FinResult, type FinTable } from "./finCalc";

type Read = (k: string) => string;

const MINUS = "−";
const q = (s: string): string => `“${s}”`;
/** Most rows in the price table. */
export const MAX_AT_ROWS = 5000;
/** Most control columns. */
export const MAX_CONTROLS = 10;
const MAX_DOLLARS = 1e13;

export type PeriodKind = "before" | "during" | "after";

/** A period label read as before / during / after, or null. */
export function periodKind(cell: string): PeriodKind | null {
  const t = cell.trim().toLowerCase();
  if (/^(before|pre|pre-conspiracy|benchmark before)$/.test(t)) return "before";
  if (/^(during|conspiracy|cartel|damages period)$/.test(t)) return "during";
  if (/^(after|post|post-conspiracy|benchmark after)$/.test(t)) return "after";
  return null;
}

function stripDollarMarks(text: string): string {
  return text.replace(/(?:U\.?S\.?\s?|USD\s?)?\$/gi, "");
}

function pctText(x: number, dp = 2): string {
  const s = (x * 100).toFixed(dp);
  if (/^-0(\.0+)?$/.test(s)) return s.slice(1) + "%";
  return (s.startsWith("-") ? MINUS + s.slice(1) : s) + "%";
}

export interface OverchargeData {
  y: Float64Array;
  /** The price as read (level). */
  price: Float64Array;
  X: Float64Array[];
  controls: string[];
  kinds: PeriodKind[];
  /** The row's label (the first column when it is not a model column), for the tables. */
  labels: string[];
  notes: string[];
  priceName: string;
}

/** Reads the price table: the price column, the period column and the control columns (listwise deletion). */
export function readOverchargeData(text: string, priceCol: string, periodCol: string, controlsText: string, log: boolean): OverchargeData | { error: string } {
  const raw = text ?? "";
  if (!raw.trim()) return { error: "The price table is empty: a header row naming the columns, then one row per observation." };
  const foreign = foreignCurrencyRefusal(raw, "The price table");
  if (foreign) return { error: foreign };
  const parsed = parseRegData(whitespaceTable(stripDollarMarks(raw)));
  if (!parsed.ok) return { error: `The price table: ${parsed.reason}` };
  const data: RegDataset = parsed.data;
  if (!data.named) return { error: "The price table needs a header row naming its columns (the price, the period and any controls)." };
  if (data.rows.length > MAX_AT_ROWS) return { error: `The price table has ${data.rows.length.toLocaleString("en-US")} rows; the most is ${MAX_AT_ROWS.toLocaleString("en-US")}.` };
  const pj = findColumn(data.names, priceCol);
  if (typeof pj !== "number") return { error: `Price column: ${pj.error}` };
  const kj = findColumn(data.names, periodCol);
  if (typeof kj !== "number") return { error: `Period column: ${kj.error}` };
  if (pj === kj) return { error: "The price column and the period column must be different columns." };
  const controls = controlsText
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (controls.length > MAX_CONTROLS) return { error: `At most ${MAX_CONTROLS} control columns.` };
  for (const c of controls) {
    const cj = findColumn(data.names, c);
    if (typeof cj !== "number") return { error: `Controls: ${cj.error}` };
    if (cj === pj) return { error: `Controls: ${q(data.names[cj])} is the price column.` };
    if (cj === kj) return { error: `Controls: ${q(data.names[cj])} is the period column.` };
  }
  const sel = selectColumns(data, { dep: data.names[pj], preds: controls.map((c) => data.names[findColumn(data.names, c) as number]), text: "" }, { cluster: data.names[kj], timeOrdered: true });
  if (!sel.ok) return { error: `The price table: ${sel.reason}` };
  const cols = sel.cols;
  const kinds: PeriodKind[] = [];
  for (let i = 0; i < cols.clusters!.length; i++) {
    const k = periodKind(cols.clusters![i]);
    if (!k) return { error: `The price table, row ${cols.rowNumbers[i]}: the period ${q(cols.clusters![i])} is not before, during or after.` };
    kinds.push(k);
  }
  // The row label: the first column, when it is neither the price, the period nor a control.
  const used = new Set([pj, kj, ...controls.map((c) => findColumn(data.names, c) as number)]);
  const labelCol = used.has(0) ? -1 : 0;
  const labels = cols.rowNumbers.map((rn) => (labelCol === 0 ? (data.rows[rn - 1][0] ?? "").trim() || `Row ${rn}` : `Row ${rn}`));
  const price = cols.y;
  for (let i = 0; i < price.length; i++) {
    if (!(price[i] > 0)) return { error: `The price table, row ${cols.rowNumbers[i]}: the price (${fmtFixed(price[i], 4)}) must be positive.` };
    if (price[i] > 1e9) return { error: `The price table, row ${cols.rowNumbers[i]}: a price above one billion is outside this calculator.` };
  }
  const y = log ? Float64Array.from(price, (p) => Math.log(p)) : price;
  return { y, price, X: cols.X, controls: cols.names, kinds, labels, notes: cols.notes, priceName: cols.depName };
}

export interface OverchargeEstimate {
  method: "dummy" | "forecast";
  fit: OlsFit;
  /** But-for price of each during row (level). */
  butFor: number[];
  /** Indices (into the data) of the during rows. */
  during: number[];
  perUnit: number;
  pctOfButFor: number;
  shareOfActual: number;
  /** The dummy's term (dummy method). */
  dummy?: ModelTerm;
}

function overchargeRates(price: Float64Array, during: number[], butFor: number[]): { perUnit: number; pctOfButFor: number; shareOfActual: number } {
  let sp = 0;
  let sb = 0;
  for (let m = 0; m < during.length; m++) {
    sp += price[during[m]];
    sb += butFor[m];
  }
  const diff = sp - sb;
  return { perUnit: diff / during.length, pctOfButFor: diff / sb, shareOfActual: diff / sp };
}

/** The dummy-variable regression on every row; before and after pooled as the benchmark. */
export function dummyMethod(d: OverchargeData, log: boolean, se: SeType): OverchargeEstimate | { error: string } {
  const n = d.y.length;
  const during: number[] = [];
  for (let i = 0; i < n; i++) if (d.kinds[i] === "during") during.push(i);
  if (!during.length) return { error: "The price table has no during-period row." };
  if (during.length === n) return { error: "The price table has no before- or after-period row: the dummy-variable method needs a benchmark." };
  let dname = "During";
  if (d.controls.some((c) => c.toLowerCase() === "during")) dname = "During (dummy)";
  const D = Float64Array.from(d.kinds, (k) => (k === "during" ? 1 : 0));
  const fit = fitOls({ y: d.y, depName: log ? `ln ${d.priceName}` : d.priceName, X: [...d.X, D], names: [...d.controls, dname], constant: true, se });
  if (!fit.ok) return { error: `Dummy-variable regression: ${fit.reason}` };
  const term = fit.model.terms.find((t) => t.name === dname)!;
  const delta = term.coef;
  const butFor = during.map((i) => (log ? d.price[i] * Math.exp(-delta) : d.price[i] - delta));
  return { method: "dummy", fit, butFor, during, dummy: term, ...overchargeRates(d.price, during, butFor) };
}

/** The before-period regression projected into the during rows. */
export function forecastMethod(d: OverchargeData, log: boolean, se: SeType): OverchargeEstimate | { error: string } {
  const n = d.y.length;
  const before: number[] = [];
  const during: number[] = [];
  for (let i = 0; i < n; i++) {
    if (d.kinds[i] === "before") before.push(i);
    else if (d.kinds[i] === "during") during.push(i);
  }
  if (!during.length) return { error: "The price table has no during-period row." };
  const k = d.X.length + 1;
  if (before.length <= k) return { error: `The forecast method needs more before-period rows (${before.length}) than coefficients (${k}: the controls and a constant).` };
  const pick = (col: Float64Array, idx: number[]): Float64Array => Float64Array.from(idx, (i) => col[i]);
  const fit = fitOls({ y: pick(d.y, before), depName: log ? `ln ${d.priceName}` : d.priceName, X: d.X.map((c) => pick(c, before)), names: d.controls, constant: true, se });
  if (!fit.ok) return { error: `Forecast (before-period) regression: ${fit.reason}` };
  const coef = new Map(fit.model.terms.map((t) => [t.name, t.coef]));
  const c0 = coef.get("Constant") ?? 0;
  const butFor = during.map((i) => {
    let yh = c0;
    d.controls.forEach((nm, j) => (yh += (coef.get(nm) ?? 0) * d.X[j][i]));
    return log ? Math.exp(yh) : yh;
  });
  for (let m = 0; m < during.length; m++) {
    if (!(butFor[m] > 0) || !Number.isFinite(butFor[m])) {
      return { error: `The forecast but-for price for ${q(d.labels[during[m]])} is ${fmtFixed(butFor[m], 4)}, not a positive price: the before-period model does not project into the during period. Try the log form or other controls.` };
    }
  }
  return { method: "forecast", fit, butFor, during, ...overchargeRates(d.price, during, butFor) };
}

/** Pass-through rate: OLS slope of the resale price (last column) on the cost (the column before it). */
export function estimatePassThrough(text: string): { rate: number; se: number; n: number; costName: string; priceName: string; notes: string[] } | { error: string } {
  const raw = text ?? "";
  if (!raw.trim()) return { error: "Paste the pass-through table: the cost and the resale price, one row per period (the last two columns)." };
  const foreign = foreignCurrencyRefusal(raw, "The pass-through table");
  if (foreign) return { error: foreign };
  const parsed = parseRegData(whitespaceTable(stripDollarMarks(raw)));
  if (!parsed.ok) return { error: `The pass-through table: ${parsed.reason}` };
  const data = parsed.data;
  const w = data.names.length;
  if (w < 2 || w > 3) return { error: `The pass-through table has ${w} column${w === 1 ? "" : "s"}; it takes the cost and the resale price (and an optional period label first).` };
  let ds = data;
  if (w === 3) ds = { ...data, names: data.names.slice(1), rows: data.rows.map((r) => r.slice(1)) };
  if (ds.names[0] === ds.names[1]) return { error: "The pass-through table's cost and resale-price columns have the same name." };
  const sel = selectColumns(ds, { dep: ds.names[1], preds: [ds.names[0]], text: "" });
  if (!sel.ok) return { error: `The pass-through table: ${sel.reason}` };
  if (sel.cols.y.length < 3) return { error: "The pass-through table needs at least 3 rows." };
  const fit = fitOls({ y: sel.cols.y, depName: sel.cols.depName, X: sel.cols.X, names: sel.cols.names, constant: true, se: "classical" });
  if (!fit.ok) return { error: `Pass-through regression: ${fit.reason}` };
  const t = fit.model.terms.find((x) => x.name === sel.cols.names[0])!;
  return { rate: t.coef, se: t.se, n: fit.model.n, costName: sel.cols.names[0], priceName: sel.cols.depName, notes: sel.cols.notes };
}

/** "= 0.032" or "< 0.001" after a "p". */
const pText = (p: number): string => (p < 0.001 ? fmtP(p) : `= ${fmtP(p)}`);

/** A coefficient table, at most six columns. */
function coefTable(label: string, fit: OlsFit): FinTable {
  const rows: string[][] = [["Term", "Coefficient", "SE", "t", "p", "95% CI"]];
  for (const t of fit.model.terms) rows.push([t.name, fmtFixed(t.coef, 4), fmtFixed(t.se, 4), fmtFixed(t.stat, 3), fmtP(t.p), `${fmtFixed(t.ciLo, 4)} to ${fmtFixed(t.ciHi, 4)}`]);
  return { label, rows, align: ["left", "right", "right", "right", "right", "right"], note: `${fit.model.seLabel} standard errors; n = ${fit.model.n}; R² = ${fmtFixed(fit.r2, 4)}.` };
}

/** #20 from the pane's fields. */
export function antitrustCalc(r: Read): FinResult {
  const form = r("form");
  if (form !== "log" && form !== "level") return finRefusal(`Unknown price form ${q(form)}.`);
  const log = form === "log";
  const method = r("method");
  if (method !== "both" && method !== "dummy" && method !== "forecast") return finRefusal(`Unknown method ${q(method)}.`);
  const se = r("se") as SeType;
  if (se !== "classical" && se !== "hc1" && se !== "hac") return finRefusal(`Unknown standard errors ${q(r("se"))}.`);
  const basis = r("basis");
  if (basis !== "dollars" && basis !== "units") return finRefusal(`Unknown purchases basis ${q(basis)}.`);
  const pt = r("pt");
  if (pt !== "none" && pt !== "entered" && pt !== "estimated") return finRefusal(`Unknown pass-through option ${q(pt)}.`);
  const d = readOverchargeData(r("data"), r("priceCol"), r("periodCol"), r("controls") ?? "", log);
  if ("error" in d) return finRefusal(d.error);
  const ests: OverchargeEstimate[] = [];
  if (method !== "forecast") {
    const e = dummyMethod(d, log, se);
    if ("error" in e) return finRefusal(e.error);
    ests.push(e);
  }
  if (method !== "dummy") {
    const e = forecastMethod(d, log, se);
    if ("error" in e) return finRefusal(e.error);
    ests.push(e);
  }
  const pur = parsePeriodTable(r("purchases"), [basis === "dollars" ? "purchases ($)" : "purchases (units)"], 1);
  if ("error" in pur) return finRefusal(`Purchases: ${pur.error}`);
  let rate: number | null = null;
  let rateText = "";
  const ptNotes: string[] = [];
  if (pt === "entered") {
    const s = (r("ptRate") ?? "").trim();
    const v = readFinanceField(s);
    if (!s) return finRefusal("Enter the pass-through rate %.");
    if (!Number.isFinite(v)) return finRefusal(`Pass-through rate %: ${q(s)} is not a number.`);
    if (v < 0 || v > 500) return finRefusal("The pass-through rate must be between 0% and 500%.");
    rate = v / 100;
    rateText = `Pass-through rate ${pctText(rate)} (entered).`;
  } else if (pt === "estimated") {
    const e = estimatePassThrough(r("ptData"));
    if ("error" in e) return finRefusal(e.error);
    rate = e.rate;
    rateText = `Pass-through rate ${pctText(rate)} (estimated: OLS slope of ${q(e.priceName)} on ${q(e.costName)} with a constant, SE ${fmtFixed(e.se * 100, 2)} percentage points, n = ${e.n}).`;
    if (rate < 0) ptNotes.push("The estimated pass-through is negative: the resale price fell as the cost rose in these data.");
    if (rate > 1) ptNotes.push("The estimated pass-through is above 100%: the resale price rose by more than the cost in these data.");
    ptNotes.push(...e.notes);
  }

  const methodName = (m: OverchargeEstimate["method"]): string => (m === "dummy" ? "Dummy-variable" : "Forecast");
  const rateOf = (e: OverchargeEstimate): number => (basis === "dollars" ? e.shareOfActual : e.perUnit);
  const head = ["Period", basis === "dollars" ? "Purchases" : "Units purchased"];
  for (const e of ests) head.push(`${methodName(e.method)} ${basis === "dollars" ? "share" : "per unit"}`, `${methodName(e.method)} damages`);
  const dmgRows: string[][] = [head];
  const totals = ests.map(() => 0);
  let totalPurchases = 0;
  const figSeries = ests.map((e) => ({ name: methodName(e.method).toLowerCase(), values: [] as number[] }));
  for (const row of pur.rows) {
    const v = row.values[0];
    totalPurchases += v;
    const cells = [row.label, basis === "dollars" ? dmgMoney(v) : dmgQty(v)];
    ests.forEach((e, m) => {
      const amt = roundCents(v * rateOf(e));
      totals[m] += Math.round(amt * 100);
      figSeries[m].values.push(amt);
      cells.push(basis === "dollars" ? pctText(e.shareOfActual, 2) : dmgUnitMoney(e.perUnit), dmgMoney(amt));
    });
    dmgRows.push(cells);
  }
  if (totals.some((c) => !(Math.abs(c / 100) <= MAX_DOLLARS)) || totalPurchases > MAX_DOLLARS) return finRefusal("The damages are above ten trillion dollars, outside this calculator.");
  const totRow = ["Total", basis === "dollars" ? dmgMoney(totalPurchases) : dmgQty(totalPurchases)];
  ests.forEach((_, m) => totRow.push("", dmgMoney(totals[m] / 100)));
  dmgRows.push(totRow);

  const nB = d.kinds.filter((k) => k === "before").length;
  const nD = d.kinds.filter((k) => k === "during").length;
  const nA = d.kinds.filter((k) => k === "after").length;
  const lines: string[] = ["Antitrust overcharge damages, computed from the inputs given"];
  for (const [m, e] of ests.entries()) {
    const label = methodName(e.method);
    let s = `${label} method: overcharge ${pctText(e.pctOfButFor)} of the but-for price (${pctText(e.shareOfActual)} of the actual price; ${dmgUnitMoney(e.perUnit)} per unit on average); damages ${dmgMoney(totals[m] / 100)}.`;
    if (e.dummy) {
      const t = e.dummy;
      s += log
        ? ` During-period coefficient ${fmtFixed(t.coef, 4)} (SE ${fmtFixed(t.se, 4)}, p ${pText(t.p)}); overcharge exp(δ) − 1 = ${pctText(Math.expm1(t.coef))}, 95% CI ${pctText(Math.expm1(t.ciLo))} to ${pctText(Math.expm1(t.ciHi))}.`
        : ` During-period coefficient ${fmtFixed(t.coef, 4)} per unit (SE ${fmtFixed(t.se, 4)}, p ${pText(t.p)}; 95% CI ${fmtFixed(t.ciLo, 4)} to ${fmtFixed(t.ciHi, 4)}).`;
    }
    lines.push(s);
  }
  if (rate !== null) {
    lines.push(rateText);
    for (const [m, e] of ests.entries()) {
      const tot = totals[m] / 100;
      const passed = roundCents(tot * rate);
      lines.push(`${methodName(e.method)}: passed on at the pass-through rate ${dmgMoney(passed)}; not passed on ${dmgMoney(roundCents(tot - passed))}.`);
    }
  }
  const ctl = d.controls.length ? d.controls.map(q).join(", ") : "none";
  lines.push(
    `Data: ${d.y.length} rows (${nB} before, ${nD} during, ${nA} after); price ${q(d.priceName)} in ${log ? "logs" : "levels"}; controls ${ctl}; ${se === "classical" ? "classical" : se === "hc1" ? "HC1" : "Newey–West HAC"} standard errors.`,
    "Conventions: " +
      (method !== "forecast" ? `dummy-variable method: one OLS on every row with a during-period dummy, the before and after rows pooled as the benchmark; but-for price = ${log ? "P × exp(−δ)" : "P − δ"}. ` : "") +
      (method !== "dummy" ? `Forecast method: OLS on the before rows only, projected into the during rows; but-for price = ${log ? "exp(fitted ln price), with no retransformation correction" : "the fitted price"}; the after rows are not used. ` : "") +
      "Over the during rows: overcharge % of the but-for price = Σ(P − but-for) ÷ Σ but-for; share of the actual price = Σ(P − but-for) ÷ ΣP; overcharge per unit = the mean of P − but-for. One rate per method applies to every purchases row. " +
      (basis === "dollars" ? "Damages = purchases in dollars (at the prices paid) × the share of the actual price. " : "Damages = units purchased × the overcharge per unit. ") +
      (rate !== null ? "Passed on = pass-through rate × damages. " : "") +
      "Each row is rounded to the cent; totals are sums of the rounded rows.",
    ...[...d.notes, ...pur.notes, ...ptNotes].map((n) => `Note: ${n}`),
  );

  const tables: FinTable[] = [];
  for (const e of ests) tables.push(coefTable(e.method === "dummy" ? "Dummy-variable regression (all rows)" : "Forecast regression (before rows)", e.fit));
  const ocRows: string[][] = [["Period", "Actual price", ...ests.map((e) => `${methodName(e.method)} but-for`), ...ests.map((e) => `${methodName(e.method)} overcharge`)]];
  const during = ests[0].during;
  for (let m = 0; m < during.length; m++) {
    const i = during[m];
    ocRows.push([d.labels[i], dmgUnitMoney(d.price[i]), ...ests.map((e) => dmgUnitMoney(e.butFor[m])), ...ests.map((e) => pctText(d.price[i] / e.butFor[m] - 1))]);
  }
  tables.push({ label: "During-period prices and but-for prices", rows: ocRows, align: ocRows[0].map((_, j) => (j === 0 ? "left" : "right")) });
  tables.push({ label: "Damages by period (overcharge × purchases)", rows: dmgRows, align: head.map((_, j) => (j === 0 ? "left" : "right")) });

  // Figure: the actual price by row, with each method's but-for price over the during rows.
  const colors = ["#b45309", "#16a34a"];
  const svg = finPlotSvg(
    [
      { points: thinIndices(d.price.length).map((i) => ({ x: i + 1, y: d.price[i] })), type: "line", color: "#2563eb", label: "actual price" },
      ...ests.map((e, m) => ({
        points: thinIndices(e.during.length).map((j) => ({ x: e.during[j] + 1, y: e.butFor[j] })),
        type: "line" as const,
        color: colors[m],
        label: `${methodName(e.method).toLowerCase()} but-for`,
      })),
    ],
    { width: 380, height: 250, title: "Actual and but-for prices (from the inputs given)", xlabel: "observation (row order)", ylabel: "price ($)" },
  );
  return { text: lines.join("\n"), reading: antitrustReading(ests, totals.map((c) => dmgMoney(c / 100))), svg, tables };
}

/**
 * The plain-language reading of the overcharge estimate (lib/calcReading.ts rules): each method's overcharge and
 * damages as the text prints them, and the dummy-variable coefficient's p-value when that method ran.
 */
export function antitrustReading(ests: OverchargeEstimate[], totals: string[]): string {
  const name = (e: OverchargeEstimate): string => (e.method === "dummy" ? "dummy-variable" : "forecast");
  if (ests.every((e) => !(e.pctOfButFor > 0)))
    return `These data show no overcharge: during-period prices were not above the but-for prices (${ests.map((e) => `${pctText(e.pctOfButFor)} by the ${name(e)} method`).join(", ")}), so the estimate supports no positive damages.`;
  // Every method positive: one overcharge sentence. The methods disagree in sign: each is worded by its own sign, so
  // a negative estimate is never called an overcharge.
  const parts = ests.map((e, m) => `${pctText(e.pctOfButFor)}${m === 0 ? " of the but-for price" : ""} (damages about ${totals[m]}) by the ${name(e)} method`);
  const first = ests.every((e) => e.pctOfButFor > 0)
    ? `The regression estimates an overcharge of ${parts.join(" and ")}.`
    : `The ${ests.map((e, m) => (e.pctOfButFor > 0 ? `${name(e)} method estimates an overcharge of ${pctText(e.pctOfButFor)} of the but-for price (damages about ${totals[m]})` : `${name(e)} method finds no overcharge (${pctText(e.pctOfButFor)})`)).join(", but the ")}.`;
  const t = ests.find((e) => e.dummy)?.dummy;
  if (!t) return `${first} The forecast method gives no test of whether the overcharge differs from zero.`;
  const which = ests.length > 1 ? "The dummy-variable estimate" : "The overcharge";
  return t.p < 0.05
    ? `${first} ${which} is statistically significant at the 5% level (p ${pText(t.p)}).`
    : `${first} The data do not clearly separate the ${ests.length > 1 ? "dummy-variable " : ""}overcharge from zero (p ${pText(t.p)}), so it could be chance.`;
}
