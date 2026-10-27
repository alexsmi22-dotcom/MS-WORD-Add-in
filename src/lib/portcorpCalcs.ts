/**
 * Portfolio and risk (gap item #4) and corporate finance (gap item #5, defect D6) calculators, release F1, spread
 * into the pane's FIN_CALCS. Engines: portfolioRisk.ts (performance, drawdown, CAPM by the econometrics OLS engine,
 * VaR/CVaR, Markowitz), qpActiveSet.ts (the long-only QP), corpFinance.ts (every IRR, MIRR, payback, PI, EAA, WACC
 * with Hamada, multi-stage DCF). Every result prints a "Conventions:" line.
 *
 * Pasted series: a one-line list goes through readCalcList, a pasted column or table through readDataBlock (the
 * field is a "block", so it gets the "Use table at cursor" / "Open CSV…" bar).
 */
import type { FinCalcDef, FinResult, FinTable } from "./finCalc";
import { finRefusal as finRefusalRaw } from "./finCalc";
/** A refusal starts with a capital (a lower-case first word raised; a symbol such as "q" or "σ" is left alone). */
const finRefusal = (s: string): FinResult => finRefusalRaw(/^[a-z][a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
import { readFinanceField } from "./finance";
import { currentFinFig, finPlotSvg } from "./financeFigures";
import type { Point, Series } from "./plot";
import { readDataBlock } from "./dataBlock";
import { readCalcList, ListTokenError } from "./calcList";
import { buildHeatmapSvg } from "./heatmap";
import type { TableChart } from "./tablechart";
import type { SeType } from "./olsInference";
import { capmRegression, Frontier, markowitz, performance, valueAtRisk, VarLine, Drawdown, MC_MAX_SIMS, MC_MIN_SIMS } from "./portfolioRisk";
import { dcfValue, DcfInput, DcfResult, eaa, irrAll, IrrRoots, mirr, npvAt, payback, profitabilityIndex, relever, wacc, WaccInput, MAX_FLOWS, DCF_MAX_YEARS } from "./corpFinance";

// ------------------------------------------------------------------------------------------------------------------
// Formatting (true minus, grouped thousands; every value is checked finite before it reaches these)
// ------------------------------------------------------------------------------------------------------------------

/** A whole number as subscript digits: FCF₁₀, not FCF_10 (display contract). */
const subDigits = (n: number): string => String(n).replace(/[0-9]/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d]);

const NF = new Map<number, Intl.NumberFormat>();
function fx(x: number, dp: number): string {
  // Beyond 10²¹ a grouped figure is dozens of digits of float noise: treated like a non-finite value (refused).
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return "—";
  let f = NF.get(dp);
  if (!f) NF.set(dp, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })));
  const s = f.format(x);
  if (/^-0(?:\.0*)?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
const pct = (x: number, dp = 4): string => fx(x * 100, dp) + "%";
/** An operand inside a printed formula: a negative one in parentheses ("4.2% + (−2.0000) × 5.5%"). */
const op = (s: string): string => (s.startsWith("−") ? `(${s})` : s);
const pText = (p: number): string => (p < 0.0001 ? "p < 0.0001" : `p = ${fx(p, 4)}`);
const plural = (n: number, w: string): string => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

type Read = (k: string) => string;

/** A non-finite value anywhere in an ok result is refused (the em dash is the pane's non-finite sentinel). */
function finish(res: { text: string; svg?: string; tables?: FinTable[] }): FinResult {
  const cells = (res.tables ?? []).flatMap((t) => t.rows.flat());
  if (res.text.includes("—") || cells.some((c) => c.includes("—"))) {
    return finRefusal("A value came out non-finite or above 10²¹ (an overflow on these inputs), so there is nothing to insert. Check the inputs' magnitudes (a tiny share count, an explosive growth rate, returns that compound past the number range).");
  }
  return res;
}

/** A number field (already through readFinanceField in the pane; read again here so a direct call is held to it). */
function num(r: Read, key: string, label: string, o: { min?: number; max?: number; minOpen?: boolean; maxOpen?: boolean; int?: boolean } = {}): number | string {
  const raw = (r(key) ?? "").trim();
  if (!raw) return `Enter the ${label}.`;
  const v = readFinanceField(raw);
  // a refusal starts with a capital: the label as written, its first letter raised
  const Label = label[0].toUpperCase() + label.slice(1);
  if (!Number.isFinite(v)) return `${Label}: “${raw}” is not a finite number.`;
  if (o.int && !Number.isInteger(v)) return `${Label} must be a whole number (got ${raw}).`;
  if (o.min !== undefined && (o.minOpen ? !(v > o.min) : v < o.min)) return `${Label} must be ${o.minOpen ? "above" : "at least"} ${fx(o.min, o.min % 1 ? 2 : 0)}.`;
  if (o.max !== undefined && (o.maxOpen ? !(v < o.max) : v > o.max)) return `${Label} must be ${o.maxOpen ? "below" : "at most"} ${fx(o.max, o.max % 1 ? 2 : 0)}.`;
  return v;
}
/** An optional number field: blank → null. */
function optNum(r: Read, key: string, label: string, o: Parameters<typeof num>[3] = {}): number | null | string {
  if (!(r(key) ?? "").trim()) return null;
  return num(r, key, label, o);
}

const MONEY_MAX = 1e15;
const RET_MAX_PCT = 10000;

/** One series of numbers: a one-line list (readCalcList) or a pasted column (readDataBlock). */
function readSeries(text: string, what: string, maxRows: number): { values: number[]; notes: string[] } | string {
  const t = (text ?? "").trim();
  if (!t) return `${what}: nothing to read.`;
  let values: number[];
  const notes: string[] = [];
  if (!/\n/.test(t)) {
    // readCalcList refuses a space-grouped number ("−1 000; 300") by name.
    try {
      const l = readCalcList(t);
      values = l.values;
      if (l.note) notes.push(l.note);
    } catch (e) {
      if (e instanceof ListTokenError) return `${what}: ${e.message}`;
      throw e;
    }
  } else {
    const b = readDataBlock(t, what, { maxRows, singleColumn: true });
    if (!b.ok) return b.error;
    values = [];
    for (let i = 0; i < b.rows.length; i++) {
      const row = b.rows[i];
      if (row.length !== 1) return `${what}, line ${b.lines[i]}: one number per line expected (got ${row.length}).`;
      if (row[0] === null) return `${what}, line ${b.lines[i]}: a value is missing.`;
      values.push(row[0]);
    }
    notes.push(...b.notes);
  }
  if (!values.length) return `${what}: nothing to read.`;
  if (values.length > maxRows) return `${what}: more than ${maxRows.toLocaleString("en-US")} values.`;
  const bad = values.findIndex((v) => !Number.isFinite(v));
  if (bad >= 0) return `${what}: value ${bad + 1} is not a finite number.`;
  return { values, notes };
}

/** A pasted table of numbers, columns minCols…maxCols, no missing cells. */
function readTable(text: string, what: string, minCols: number, maxCols: number, maxRows: number): { cols: number[][]; header: string[] | null; notes: string[] } | string {
  const b = readDataBlock(text, what, { maxRows });
  if (!b.ok) return b.error;
  const w = b.rows[0].length;
  if (w < minCols || w > maxCols) return `${what}, line ${b.lines[0]}: ${w} column${w === 1 ? "" : "s"}; expected ${minCols === maxCols ? minCols : `${minCols} to ${maxCols}`}.`;
  const cols: number[][] = Array.from({ length: w }, () => []);
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    if (row.length !== w) return `${what}, line ${b.lines[i]}: has ${row.length} numbers; the first row has ${w}.`;
    for (let j = 0; j < w; j++) {
      const v = row[j];
      if (v === null) return `${what}, line ${b.lines[i]}: a value is missing (column ${j + 1}).`;
      if (!Number.isFinite(v)) return `${what}, line ${b.lines[i]}: a value is not a finite number.`;
      cols[j].push(v);
    }
  }
  return { cols, header: b.header, notes: b.notes };
}

/** Returns in % → decimals, each above −100% and at most 10,000%. */
function returnsCheck(xs: number[], what: string): number[] | string {
  for (let i = 0; i < xs.length; i++) {
    if (!(xs[i] > -100)) return `${what}: value ${i + 1} (${fx(xs[i], 2)}%) is −100% or below; a simple return cannot lose more than everything.`;
    if (xs[i] > RET_MAX_PCT) return `${what}: value ${i + 1} (${fx(xs[i], 2)}%) is above ${fx(RET_MAX_PCT, 0)}% for one period.`;
  }
  return xs.map((x) => x / 100);
}

type SeriesKind = "returns" | "prices";
const INPUT_FIELD = {
  key: "input",
  label: "Pasted values are",
  default: "returns",
  kind: "select" as const,
  options: [
    { value: "returns", label: "Returns (% per period)" },
    { value: "prices", label: "Prices or index levels, oldest first" },
  ],
};
const kindOf = (r: Read): SeriesKind => (r("input") === "prices" ? "prices" : "returns");

/** A pasted series as decimal returns: returns in % checked, or prices turned into simple returns pₜ/pₜ₋₁ − 1. */
function toReturns(xs: number[], kind: SeriesKind, what: string): number[] | string {
  if (kind === "returns") return returnsCheck(xs, what);
  if (xs.length < 2) return `${what}: at least 2 prices are needed for one return.`;
  for (let i = 0; i < xs.length; i++) if (!(xs[i] > 0)) return `${what}: price ${i + 1} (${fx(xs[i], 4)}) must be above 0 (returns are pₜ/pₜ₋₁ − 1).`;
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const r = xs[i] / xs[i - 1] - 1;
    if (r * 100 > RET_MAX_PCT) return `${what}: prices ${i} to ${i + 1} make a return above ${fx(RET_MAX_PCT, 0)}% for one period.`;
    out.push(r);
  }
  return out;
}
const PRICE_CONVENTION = "returns computed from the pasted prices as simple returns pₜ/pₜ₋₁ − 1 (n prices give n − 1 returns)";

const PPY_FIELD = { key: "ppy", label: "Periods per year (12 monthly, 52 weekly, 252 trading days)", default: "12" };
function ppyOf(r: Read): number | string {
  return num(r, "ppy", "periods per year", { min: 1, max: 366, int: true });
}

// ------------------------------------------------------------------------------------------------------------------
// Figures (new SVG builders; each is in scripts/figure-layout-run.ts through the calculators' defaults)
// ------------------------------------------------------------------------------------------------------------------

/** Excess returns, asset against market, with the fitted security characteristic line α + βx. */
export function capmScatterSvg(exM: number[], exA: number[], alpha: number, beta: number): string | undefined {
  if (exM.length < 2) return undefined;
  const lo = Math.min(...exM);
  const hi = Math.max(...exM);
  return finPlotSvg(
    [
      { points: exM.map((x, i) => ({ x: x * 100, y: exA[i] * 100 })), type: "scatter", color: "#2563eb", label: "periods" },
      { points: [lo, hi].map((x) => ({ x: x * 100, y: (alpha + beta * x) * 100 })), type: "line", color: "#b91c1c", label: `fit: β = ${fx(beta, 3)}` },
    ],
    { width: 380, height: 270, title: "Security characteristic line (excess returns)", xlabel: "market excess return (%)", ylabel: "asset excess return (%)" },
  );
}

/** The underwater curve: drawdown from the running peak by period, with the deepest point marked. */
export function drawdownSvg(dd: Drawdown): string | undefined {
  if (dd.dd.length < 2) return undefined;
  const series: Series[] = [{ points: dd.dd.map((d, t) => ({ x: t, y: d * 100 })), type: "line", color: "#2563eb", label: "drawdown" }];
  if (dd.max < 0) series.push({ points: [{ x: dd.trough, y: dd.max * 100 }], type: "scatter", color: "#b91c1c", label: `maximum ${fx(dd.max * 100, 2)}%` });
  return finPlotSvg(series, { width: 380, height: 250, title: "Drawdown from the running peak", xlabel: "period", ylabel: "drawdown (%)" });
}

/** Histogram of the returns (as a step outline) with the historical and normal VaR marked. */
export function varHistogramSvg(r: number[], lines: VarLine[]): string | undefined {
  const n = r.length;
  if (n < 2) return undefined;
  const lo = Math.min(...r);
  const hi = Math.max(...r);
  if (!(hi > lo)) return undefined;
  const bins = Math.max(5, Math.min(40, Math.ceil(Math.sqrt(n))));
  const w = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const x of r) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  const step: Point[] = [{ x: lo * 100, y: 0 }];
  counts.forEach((c, i) => {
    step.push({ x: (lo + i * w) * 100, y: c });
    step.push({ x: (lo + (i + 1) * w) * 100, y: c });
  });
  step.push({ x: hi * 100, y: 0 });
  const top = Math.max(...counts);
  const vline = (x: number): Point[] => [
    { x: x * 100, y: 0 },
    { x: x * 100, y: top },
  ];
  const h = lines.find((l) => l.method === "historical")!;
  const nm = lines.find((l) => l.method === "normal")!;
  return finPlotSvg(
    [
      { points: step, type: "line", color: "#6b7280", label: "returns" },
      { points: vline(-h.var), type: "line", color: "#b91c1c", label: "historical VaR" },
      { points: vline(-nm.var), type: "line", color: "#2563eb", label: "normal VaR" },
    ],
    { width: 380, height: 260, title: "Return distribution and value at risk", xlabel: "return (%)", ylabel: "periods" },
  );
}

/** The long-only efficient frontier, the assets, the minimum-variance and tangency portfolios and the CML. */
export function frontierSvg(f: Frontier, rf: number): string | undefined {
  if (f.curve.length < 2) return undefined;
  const vols = f.mu.map((_, i) => Math.sqrt(f.S[i][i]));
  const xMax = Math.max(...vols, ...f.curve.map((p) => p.vol)) * 1.1;
  const cmlEnd = rf + f.tangency.sharpe * xMax;
  return finPlotSvg(
    [
      { points: f.curve.map((p) => ({ x: p.vol * 100, y: p.ret * 100 })), type: "line", color: "#2563eb", label: "efficient frontier" },
      { points: [{ x: 0, y: rf * 100 }, { x: xMax * 100, y: cmlEnd * 100 }], type: "line", color: "#ea580c", label: "capital market line" },
      { points: vols.map((v, i) => ({ x: v * 100, y: f.mu[i] * 100 })), type: "scatter", color: "#111827", label: "assets" },
      { points: [{ x: f.minVol.vol * 100, y: f.minVol.ret * 100 }], type: "scatter", color: "#16a34a", label: "minimum variance" },
      { points: [{ x: f.tangency.vol * 100, y: f.tangency.ret * 100 }], type: "scatter", color: "#b91c1c", label: "tangency" },
    ],
    { width: 400, height: 280, title: "Efficient frontier (long-only) and capital market line", xlabel: "volatility (% a year)", ylabel: "expected return (% a year)" },
  );
}

/** WACC, cost of equity and after-tax cost of debt against the debt ratio D/V, beta relevered by Hamada. */
export function waccLeverageSvg(w: WaccInput, betaU: number, atDV: number): string | undefined {
  const we: Point[] = [];
  const re: Point[] = [];
  const rd: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const dv = (0.8 * i) / 40;
    const de = dv / (1 - dv);
    const bl = relever(betaU, de, w.tax);
    const ce = w.rf + bl * w.mrp;
    const cd = w.rd * (1 - w.tax);
    re.push({ x: dv * 100, y: ce * 100 });
    rd.push({ x: dv * 100, y: cd * 100 });
    we.push({ x: dv * 100, y: ((1 - dv) * ce + dv * cd) * 100 });
  }
  const de0 = atDV / (1 - atDV);
  const w0 = (1 - atDV) * (w.rf + relever(betaU, de0, w.tax) * w.mrp) + atDV * w.rd * (1 - w.tax);
  if (![...we, ...re].every((p) => Number.isFinite(p.y)) || !Number.isFinite(w0)) return undefined;
  return finPlotSvg(
    [
      { points: re, type: "line", color: "#b91c1c", label: "cost of equity" },
      { points: we, type: "line", color: "#2563eb", label: "WACC" },
      { points: rd, type: "line", color: "#6b7280", label: "after-tax cost of debt" },
      { points: [{ x: atDV * 100, y: w0 * 100 }], type: "scatter", color: "#111827", label: "this capital structure" },
    ],
    { width: 380, height: 260, title: "WACC against leverage (Hamada relevering)", xlabel: "debt / value D/V (%)", ylabel: "rate (%)" },
  );
}

/** The NPV profile's rate axis: covers the marked rates and the discount rate, capped to −50% … 100% so a far root does not flatten the curve. */
function profileRange(marked: number[], rate: number): [number, number] {
  const all = [...marked, rate];
  return [Math.max(-0.5, Math.min(0, ...all.map((x) => x - 0.05))), Math.min(1, Math.max(0.2, rate * 2, ...all.map((x) => x + 0.05)))];
}

/** NPV against the discount rate for one or two projects, each IRR and the crossover marked. */
export function npvProfileSvg(projects: { name: string; cfs: number[]; roots: number[] }[], crossover: number[], rate: number): string | undefined {
  const [lo, hi] = profileRange([...projects.flatMap((p) => p.roots), ...crossover], rate);
  const colors = ["#2563eb", "#ea580c"];
  const series: Series[] = [];
  projects.forEach((p, k) => {
    const pts: Point[] = [];
    for (let i = 0; i <= 120; i++) {
      const r = lo + ((hi - lo) * i) / 120;
      const v = npvAt(r, p.cfs);
      if (Number.isFinite(v)) pts.push({ x: r * 100, y: v });
    }
    series.push({ points: pts, type: "line", color: colors[k], label: `NPV, ${p.name}` });
  });
  const marks = projects.flatMap((p) => p.roots.filter((x) => x >= lo && x <= hi).map((x) => ({ x: x * 100, y: 0 })));
  if (marks.length) series.push({ points: marks, type: "scatter", color: "#b91c1c", label: "IRR" });
  const cross = crossover.filter((x) => x >= lo && x <= hi).map((x) => ({ x: x * 100, y: npvAt(x, projects[0].cfs) }));
  if (cross.length) series.push({ points: cross, type: "scatter", color: "#16a34a", label: "crossover" });
  series.push({ points: [{ x: lo * 100, y: 0 }, { x: hi * 100, y: 0 }], type: "line", color: "#9ca3af", label: "NPV = 0" });
  if (!series.slice(0, projects.length).every((s) => s.points.length > 1)) return undefined;
  return finPlotSvg(series, { width: 400, height: 270, title: projects.length > 1 ? "NPV profiles and crossover rate" : "NPV profile", xlabel: "discount rate (% per period)", ylabel: "NPV" });
}

/** The DCF sensitivity grid as a heat map (rows: discount rate; columns: terminal growth or exit multiple). */
export function dcfSensitivityHeatmapSvg(rowLabels: string[], colLabels: string[], grid: (number | null)[][], title: string, rowAxis: string): string {
  const chart: TableChart = {
    categories: rowLabels,
    series: colLabels.map((c, j) => ({ name: c, values: grid.map((row) => row[j]) })),
    categoryLabel: rowAxis,
    hasHeader: true,
    rows: [],
    warnings: [],
  };
  // The Finance figure style (journal width, USPTO black and white) reaches this builder through currentFinFig, as
  // finPlotSvg's figures get it: plot.ts never sees a heat map.
  const fig = currentFinFig();
  const W = fig ? fig.width : 520;
  const H = Math.round((320 * W) / 520);
  return buildHeatmapSvg(chart, title, { scale: "sequential", grey: fig?.bw === true }, W, H).svg;
}

// ------------------------------------------------------------------------------------------------------------------
// Portfolio & risk calculators
// ------------------------------------------------------------------------------------------------------------------

const SE_LABEL: Record<string, string> = { classical: "classical (homoskedastic)", hc1: "HC1 (heteroskedasticity-robust, Stata robust)", hac: "Newey–West HAC" };

/** CAPM beta and alpha by regression, with Treynor, information ratio and the risk split. */
export function capmCalc(r: Read): FinResult {
  const ppy = ppyOf(r);
  if (typeof ppy === "string") return finRefusal(ppy);
  const seRaw = r("se");
  const se: SeType = seRaw === "hc1" || seRaw === "hac" ? seRaw : "classical";
  const kind = kindOf(r);
  const t = readTable(r("data"), kind === "prices" ? "Prices" : "Returns (%)", 2, 3, 5000);
  if (typeof t === "string") return finRefusal(t);
  const ra = toReturns(t.cols[0], kind, kind === "prices" ? "Asset prices" : "Asset returns");
  if (typeof ra === "string") return finRefusal(ra);
  const rm = toReturns(t.cols[1], kind, kind === "prices" ? "Market prices" : "Market returns");
  if (typeof rm === "string") return finRefusal(rm);
  let rf: number[];
  let rfNote: string;
  if (t.cols.length === 3) {
    // The third column is a risk-free RATE in % per period in both modes (with prices, the rate on each row from the
    // second on, the period each return covers).
    const c = returnsCheck(kind === "prices" ? t.cols[2].slice(1) : t.cols[2], "Risk-free rate column (%)");
    if (typeof c === "string") return finRefusal(c);
    rf = c;
    rfNote = "the risk-free rate from the third column, period by period";
  } else {
    const f = num(r, "rf", "risk-free rate (% per period)", { min: -100, max: 100, minOpen: true });
    if (typeof f === "string") return finRefusal(f);
    rf = ra.map(() => f / 100);
    rfNote = `a constant risk-free rate of ${fx(f, 4)}% per period`;
  }
  const c = capmRegression(ra, rm, rf, ppy, se);
  if ("error" in c) return finRefusal(c.error);
  const names = t.header ? t.header.slice(0, 2) : ["asset", "market"];
  const sysShare = c.varSys / (c.varSys + c.varIdio);
  const lines = [
    `CAPM regression of ${names[0]}'s excess return on ${names[1]}'s, ${plural(c.n, "period")}, ${ppy} a year`,
    `β = ${fx(c.beta.coef, 4)} (SE ${fx(c.beta.se, 4)}, t = ${fx(c.beta.t, 2)}, ${pText(c.beta.p)}; 95% CI ${fx(c.beta.lo, 4)} to ${fx(c.beta.hi, 4)})`,
    `α = ${pct(c.alpha.coef, 4)} per period (SE ${pct(c.alpha.se, 4)}, t = ${fx(c.alpha.t, 2)}, ${pText(c.alpha.p)}); Jensen's alpha annualized α × ${ppy} = ${pct(c.alpha.coef * ppy, 3)}`,
    `R² = ${fx(c.r2, 4)}; residual standard deviation σ_ε = ${pct(c.residSd, 4)} per period`,
    Number.isFinite(c.treynor) ? `Treynor ratio = annualized mean excess return ÷ β = ${pct(c.treynor, 3)}` : "Treynor ratio: not defined (β = 0)",
    c.infoRatio !== null
      ? `Information ratio against ${names[1]} = ${fx(c.infoRatio, 4)} (annualized mean active return ÷ tracking error ${pct(c.trackingError, 3)})`
      : `Information ratio: not defined (the asset tracks ${names[1]} exactly: zero tracking error)`,
    `Sharpe ratio: ${names[0]} ${c.sharpeAsset !== null ? fx(c.sharpeAsset, 4) : "not defined (no variation)"}; ${names[1]} ${c.sharpeMarket !== null ? fx(c.sharpeMarket, 4) : "not defined"}`,
    `Risk split (annualized variance of excess return): systematic β²σ²_m = ${fx(c.varSys * 1e4, 2)} %², idiosyncratic σ²_ε = ${fx(c.varIdio * 1e4, 2)} %² (${fx(sysShare * 100, 1)}% systematic)`,
    ...t.notes,
    `Conventions: ${kind === "prices" ? PRICE_CONVENTION : "returns are simple per-period returns in %"}; excess returns over ${rfNote}; OLS of r − rf on rₘ − rf with a constant (α); ` +
      `standard errors ${SE_LABEL[se]}${c.hacLag !== undefined ? ` with lag ${c.hacLag} (floor(4·(n/100) to the power 2/9))` : ""}, t with ${c.df} degrees of freedom; ` +
      `annualized: means × ${ppy}, standard deviations × √${ppy} (sample, n − 1); information ratio on active return r − rₘ; idiosyncratic variance SSE/(n − 2).`,
  ];
  const table: FinTable = {
    label: "CAPM regression",
    rows: [
      ["Term", "Estimate", "Std. error", "t", "p", "95% CI"],
      ["β (market)", fx(c.beta.coef, 4), fx(c.beta.se, 4), fx(c.beta.t, 2), c.beta.p < 0.0001 ? "< 0.0001" : fx(c.beta.p, 4), `${fx(c.beta.lo, 4)} to ${fx(c.beta.hi, 4)}`],
      ["α (% per period)", fx(c.alpha.coef * 100, 4), fx(c.alpha.se * 100, 4), fx(c.alpha.t, 2), c.alpha.p < 0.0001 ? "< 0.0001" : fx(c.alpha.p, 4), `${fx(c.alpha.lo * 100, 4)} to ${fx(c.alpha.hi * 100, 4)}`],
    ],
    align: ["left", "right", "right", "right", "right", "right"],
    note: `n = ${c.n}; R² = ${fx(c.r2, 4)}; standard errors ${SE_LABEL[se]}.`,
  };
  return finish({ text: lines.join("\n"), svg: capmScatterSvg(c.exMarket, c.exAsset, c.alpha.coef, c.beta.coef), tables: [table] });
}

/** Annualized return, volatility, Sharpe, Sortino, Treynor, maximum drawdown and Calmar. */
export function perfCalc(r: Read): FinResult {
  const ppy = ppyOf(r);
  if (typeof ppy === "string") return finRefusal(ppy);
  const kind = kindOf(r);
  const what = kind === "prices" ? "Prices" : "Returns (%)";
  const s = readSeries(r("rets"), what, 5000);
  if (typeof s === "string") return finRefusal(s);
  const rets = toReturns(s.values, kind, what);
  if (typeof rets === "string") return finRefusal(rets);
  const rf = num(r, "rf", "risk-free rate (% per period)", { min: -100, max: 100, minOpen: true });
  if (typeof rf === "string") return finRefusal(rf);
  const mar = num(r, "mar", "minimum acceptable return (% per period)", { min: -100, max: 100, minOpen: true });
  if (typeof mar === "string") return finRefusal(mar);
  const beta = optNum(r, "beta", "beta (for Treynor)", { min: -100, max: 100 });
  if (typeof beta === "string") return finRefusal(beta);
  const p = performance(rets, ppy, rf / 100, mar / 100, beta);
  if ("error" in p) return finRefusal(p.error);
  const d = p.dd;
  const lines = [
    `${plural(p.n, "period")} at ${ppy} a year; total return ${pct(p.totalReturn, 2)}`,
    `Mean return ${pct(p.meanPer, 4)} per period; annualized arithmetic ${pct(p.meanAnnual, 3)}; annualized geometric (compound) ${pct(p.geoAnnual, 3)}`,
    `Volatility ${pct(p.sdPer, 4)} per period; annualized ${pct(p.volAnnual, 3)}`,
    p.sharpe !== null ? `Sharpe ratio = ${fx(p.sharpe, 4)}` : "Sharpe ratio: not defined (the excess return does not vary: zero volatility)",
    p.sortino !== null
      ? `Sortino ratio = ${fx(p.sortino, 4)} (downside deviation ${pct(p.downsideDev, 4)} per period below a MAR of ${fx(mar, 4)}%)`
      : `Sortino ratio: not defined (no period fell below the MAR of ${fx(mar, 4)}%, so the downside deviation is zero)`,
    beta === null ? "Treynor ratio: enter a beta to compute it (the CAPM regression calculator estimates one)" : p.treynor !== null ? `Treynor ratio = ${pct(p.treynor, 3)} (β = ${fx(beta, 4)})` : "Treynor ratio: not defined (β = 0)",
    d.max < 0
      ? `Maximum drawdown = ${pct(d.max, 2)}: from the peak after period ${d.peak} to the trough after period ${d.trough}; ${d.recovery !== null ? `recovered after period ${d.recovery}` : "not recovered by the last period"}; longest time below a peak ${plural(d.longest, "period")}`
      : "Maximum drawdown = 0% (the wealth index never fell below a previous peak)",
    p.calmar !== null ? `Calmar ratio = ${fx(p.calmar, 4)} (annualized geometric return ÷ |maximum drawdown|, over the whole sample)` : "Calmar ratio: not defined (no drawdown)",
    ...s.notes,
    `Conventions: ${kind === "prices" ? PRICE_CONVENTION : "simple per-period returns in %"}; sample standard deviation (n − 1); annualized: arithmetic mean × ${ppy}, standard deviation × √${ppy}, geometric (∏(1 + r)) to the power ${ppy}/n − 1; ` +
      `Sharpe = mean(r − rf)/sd(r − rf) × √${ppy} with rf = ${fx(rf, 4)}% per period; Sortino = (mean(r) − MAR) × ${ppy} ÷ (downside deviation × √${ppy}), downside deviation √(Σ min(r − MAR, 0)²/n) over all n periods; ` +
      `Treynor = mean(r − rf) × ${ppy} ÷ β; drawdown on a wealth index starting at 1 before the first return (period 0).`,
  ];
  const table: FinTable = {
    label: "Performance and risk",
    rows: [
      ["Measure", "Per period", "Annualized"],
      ["Mean return (arithmetic)", pct(p.meanPer, 4), pct(p.meanAnnual, 3)],
      ["Geometric return", "", pct(p.geoAnnual, 3)],
      ["Volatility", pct(p.sdPer, 4), pct(p.volAnnual, 3)],
      ["Downside deviation", pct(p.downsideDev, 4), pct(p.downsideDev * Math.sqrt(ppy), 3)],
      ["Sharpe ratio", "", p.sharpe !== null ? fx(p.sharpe, 4) : "not defined"],
      ["Sortino ratio", "", p.sortino !== null ? fx(p.sortino, 4) : "not defined"],
      ["Maximum drawdown", pct(d.max, 2), ""],
    ],
    align: ["left", "right", "right"],
  };
  return finish({ text: lines.join("\n"), svg: drawdownSvg(d), tables: [table] });
}

const METHOD_NAME: Record<VarLine["method"], string> = {
  historical: "Historical",
  normal: "Parametric normal",
  t: "Parametric Student t",
  mc: "Monte Carlo (normal)",
};

/** Value at risk and expected shortfall by four methods. */
export function varCalc(r: Read): FinResult {
  const kind = kindOf(r);
  const what = kind === "prices" ? "Prices" : "Returns (%)";
  const s = readSeries(r("rets"), what, 10000);
  if (typeof s === "string") return finRefusal(s);
  const rets = toReturns(s.values, kind, what);
  if (typeof rets === "string") return finRefusal(rets);
  const conf = num(r, "conf", "confidence level (%)", { min: 50, max: 100, minOpen: true, maxOpen: true });
  if (typeof conf === "string") return finRefusal(conf);
  const h = num(r, "horizon", "horizon (periods)", { min: 1, max: 1000, int: true });
  if (typeof h === "string") return finRefusal(h);
  const value = num(r, "value", "portfolio value", { min: 0, minOpen: true, max: MONEY_MAX });
  if (typeof value === "string") return finRefusal(value);
  const nu = num(r, "nu", "Student t degrees of freedom ν", { min: 2, minOpen: true, max: 1000 });
  if (typeof nu === "string") return finRefusal(nu);
  const sims = num(r, "sims", "Monte Carlo draws", { min: MC_MIN_SIMS, max: MC_MAX_SIMS, int: true });
  if (typeof sims === "string") return finRefusal(sims);
  const seed = num(r, "seed", "seed", { min: 0, max: Number.MAX_SAFE_INTEGER, int: true });
  if (typeof seed === "string") return finRefusal(seed);
  const v = valueAtRisk({ r: rets, conf, horizon: h, nu, sims, seed });
  if ("error" in v) return finRefusal(v.error);
  if (!(v.sd > 0)) return finRefusal("Returns (%): every return is the same, so the volatility is zero and the parametric and Monte Carlo VaR are not informative. Paste a varying series.");
  const hTxt = h === 1 ? "one period" : `${h} periods`;
  const lines = [
    `Value at risk at ${fx(conf, 2)}% confidence over ${hTxt}, from ${plural(rets.length, "return")} (mean ${pct(v.mu, 4)}, standard deviation ${pct(v.sd, 4)} per period), on a portfolio of ${fx(value, 2)}`,
    ...v.lines.map((l) => `${METHOD_NAME[l.method]}: VaR ${pct(l.var, 3)} (${fx(l.var * value, 2)}); CVaR (expected shortfall) ${pct(l.cvar, 3)} (${fx(l.cvar * value, 2)})`),
    ...(v.lines.some((l) => l.var < 0) ? ["A negative VaR means the return at that tail quantile is still a gain."] : []),
    ...(v.lines.some((l) => l.var > 1 || l.cvar > 1)
      ? ["A loss above 100% is an artifact of the model (the normal or t tail, or square-root-of-time scaling): a long position without leverage cannot lose more than its value."]
      : []),
    ...((rets.length - 1) * v.alpha < 1
      ? [`Only ${plural(rets.length, "return")} for a ${fx(v.alpha * 100, 2)}% tail: the historical VaR is interpolated between the two smallest returns and the historical CVaR is the worst return alone; more data is needed for a historical tail estimate.`]
      : []),
    ...s.notes,
    `Conventions: VaR and CVaR are reported as positive losses (fractions of the portfolio's value) at confidence ${fx(conf, 2)}% (tail α = ${fx(v.alpha * 100, 2)}%); ` +
      `historical VaR = −(α percentile of the returns, linear interpolation: numpy's default, Excel PERCENTILE.INC), historical CVaR = −mean of the returns at or below that percentile; ` +
      `normal VaR = −(μ + σ z_α), CVaR = −(μ − σ φ(z_α)/α); Student t with ν = ${fx(nu, 2)} scaled to the sample variance (scale σ√((ν − 2)/ν)), CVaR by the closed form; ` +
      `Monte Carlo: ${sims.toLocaleString("en-US")} normal draws from PCG32 (stream 54) seeded with ${seed}, Box–Muller √(−2 ln u₁) cos(2πu₂), uᵢ = (r + 0.5)/2³², then the historical rule; ` +
      (h === 1
        ? "one period, no time scaling; "
        : `horizon ${h} periods: the normal, t and Monte Carlo methods use mean × ${h} and σ × √${h}; the historical VaR and CVaR are the one-period values × √${h} (square-root-of-time, i.i.d. returns assumed); `) +
      `μ and σ are the sample mean and sample standard deviation (n − 1)${kind === "prices" ? `; ${PRICE_CONVENTION}` : ""}.`,
  ];
  const table: FinTable = {
    label: "Value at risk",
    rows: [["Method", "VaR (%)", "VaR (amount)", "CVaR (%)", "CVaR (amount)"], ...v.lines.map((l) => [METHOD_NAME[l.method], pct(l.var, 3), fx(l.var * value, 2), pct(l.cvar, 3), fx(l.cvar * value, 2)])],
    align: ["left", "right", "right", "right", "right"],
    note: `${fx(conf, 2)}% confidence, ${hTxt}; losses positive.`,
  };
  return finish({ text: lines.join("\n"), svg: varHistogramSvg(rets, v.lines), tables: [table] });
}

/** Long-only Markowitz frontier with the minimum-variance and tangency portfolios and the capital market line. */
export function frontierCalc(r: Read): FinResult {
  const ppy = ppyOf(r);
  if (typeof ppy === "string") return finRefusal(ppy);
  const rf = num(r, "rf", "risk-free rate (% a year)", { min: -100, max: 100, minOpen: true });
  if (typeof rf === "string") return finRefusal(rf);
  const kind = kindOf(r);
  const what = kind === "prices" ? "Asset prices" : "Asset returns (%)";
  const t = readTable(r("data"), what, 2, 20, 2000);
  if (typeof t === "string") return finRefusal(t);
  const k = t.cols.length;
  const n = t.cols[0].length - (kind === "prices" ? 1 : 0);
  if (n <= k) return finRefusal(`${what}: ${n} ${kind === "prices" ? "returns" : "periods"} for ${k} assets; the covariance matrix needs more periods than assets (n > ${k}).`);
  const cols: number[][] = [];
  for (let j = 0; j < k; j++) {
    const c = toReturns(t.cols[j], kind, `${what}, column ${j + 1}`);
    if (typeof c === "string") return finRefusal(c);
    cols.push(c);
  }
  const names = t.header && t.header.length === k ? t.header.map((h, i) => h.trim() || `Asset ${i + 1}`) : cols.map((_, i) => `Asset ${i + 1}`);
  const f = markowitz(cols, ppy, rf / 100);
  if ("error" in f) return finRefusal(f.error.replace(/asset (\d+)/, (_m, d: string) => `asset ${d} (${names[+d - 1]})`));
  const w = (ws: number[]): string =>
    ws
      .map((x, i) => [x, i] as const)
      .filter(([x]) => x > 5e-7)
      .map(([x, i]) => `${names[i]} ${fx(x * 100, 2)}%`)
      .join(", ");
  const tg = f.tangency;
  const lines = [
    `Markowitz frontier for ${plural(k, "asset")} from ${plural(n, "period")} (${ppy} a year), long-only, fully invested`,
    `Minimum-variance portfolio: ${w(f.minVol.w)}; expected return ${pct(f.minVol.ret, 3)}, volatility ${pct(f.minVol.vol, 3)} a year`,
    `Tangency (maximum Sharpe) portfolio at rf = ${fx(rf, 3)}%: ${w(tg.w)}; expected return ${pct(tg.ret, 3)}, volatility ${pct(tg.vol, 3)}, Sharpe ratio ${fx(tg.sharpe, 4)}`,
    `Capital market line: E[r] = ${fx(rf, 3)}% + ${fx(tg.sharpe, 4)} × σ`,
    `Highest-return portfolio (end of the frontier): ${pct(f.maxRet, 3)} a year`,
    ...t.notes,
    `Conventions: ${kind === "prices" ? PRICE_CONVENTION : "simple per-period returns in %"}; expected returns = arithmetic mean × ${ppy}; covariance = sample covariance (n − 1) × ${ppy}; weights ≥ 0 summing to 1 (no short sales, no leverage); ` +
      `each frontier point minimizes wᵀΣw at a target return (${FRONTIER_TEXT}); tangency by min yᵀΣy subject to (μ − rf)ᵀy = 1, y ≥ 0, w = y/Σy (PyPortfolioOpt's max_sharpe); ` +
      `solved exactly by a primal active-set quadratic program; the CML lends and borrows at rf, which a long-only, unlevered investor can do only to the left of the tangency point.`,
  ];
  const assetTable: FinTable = {
    label: "Assets and optimal weights",
    rows: [
      ["Asset", "Mean (a year)", "Volatility (a year)", "Minimum-variance weight", "Tangency weight"],
      ...names.map((nm, i) => [nm, pct(f.mu[i], 3), pct(Math.sqrt(f.S[i][i]), 3), fx(f.minVol.w[i] * 100, 2) + "%", fx(tg.w[i] * 100, 2) + "%"]),
      ["Portfolio", "", "", `${pct(f.minVol.ret, 3)} at σ ${pct(f.minVol.vol, 3)}`, `${pct(tg.ret, 3)} at σ ${pct(tg.vol, 3)}`],
    ],
    align: ["left", "right", "right", "right", "right"],
  };
  const pts = f.curve.filter((_, i) => i % 5 === 0 || i === f.curve.length - 1);
  const curveTable: FinTable = {
    label: "Efficient frontier",
    rows: [["Expected return (a year)", "Volatility (a year)", "Sharpe ratio"], ...pts.map((p) => [pct(p.ret, 3), pct(p.vol, 3), fx((p.ret - rf / 100) / p.vol, 4)])],
    align: ["right", "right", "right"],
  };
  return finish({ text: lines.join("\n"), svg: frontierSvg(f, rf / 100), tables: [assetTable, curveTable] });
}
const FRONTIER_TEXT = "41 targets evenly spaced from the minimum-variance return to the highest asset mean";

// ------------------------------------------------------------------------------------------------------------------
// Corporate finance calculators
// ------------------------------------------------------------------------------------------------------------------

/** WACC with CAPM cost of equity and Hamada unlevering/relevering. */
export function waccCalc(r: Read): FinResult {
  const E = num(r, "e", "market value of equity", { min: 0, minOpen: true, max: MONEY_MAX });
  if (typeof E === "string") return finRefusal(E);
  const D = num(r, "d", "market value of debt", { min: 0, max: MONEY_MAX });
  if (typeof D === "string") return finRefusal(D);
  const rd = num(r, "rd", "pre-tax cost of debt (%)", { min: -100, max: 100 });
  if (typeof rd === "string") return finRefusal(rd);
  const tax = num(r, "tax", "tax rate (%)", { min: 0, max: 100, maxOpen: true });
  if (typeof tax === "string") return finRefusal(tax);
  const rf = num(r, "rf", "risk-free rate (%)", { min: -100, max: 100 });
  if (typeof rf === "string") return finRefusal(rf);
  const mrp = num(r, "mrp", "market risk premium (%)", { min: -100, max: 100 });
  if (typeof mrp === "string") return finRefusal(mrp);
  const beta = num(r, "beta", "beta", { min: -100, max: 100 });
  if (typeof beta === "string") return finRefusal(beta);
  const kindRaw = r("betakind");
  const betaKind = kindRaw === "unlevered" || kindRaw === "peer" ? kindRaw : "levered";
  let peerDE = 0;
  let peerTax = tax;
  if (betaKind === "peer") {
    const pd = num(r, "peerde", "peer debt-to-equity D/E", { min: 0, max: 1000 });
    if (typeof pd === "string") return finRefusal(pd);
    peerDE = pd;
    const pt = optNum(r, "peertax", "peer tax rate (%)", { min: 0, max: 100, maxOpen: true });
    if (typeof pt === "string") return finRefusal(pt);
    if (pt !== null) peerTax = pt;
  }
  const input: WaccInput = { E, D, rd: rd / 100, tax: tax / 100, rf: rf / 100, mrp: mrp / 100, beta, betaKind, peerDE, peerTax: peerTax / 100 };
  const w = wacc(input);
  if ("error" in w) return finRefusal(w.error);
  const betaLine =
    betaKind === "levered"
      ? `Levered beta β(L) = ${fx(w.betaL, 4)} (as entered); unlevered (asset) beta β(U) = β(L)/(1 + (1 − T)D/E) = ${fx(w.betaU, 4)}`
      : betaKind === "unlevered"
        ? `Unlevered (asset) beta β(U) = ${fx(w.betaU, 4)} (as entered); relevered at D/E ${fx(w.de, 4)}: β(L) = β(U)(1 + (1 − T)D/E) = ${fx(w.betaL, 4)}`
        : `Peer levered beta ${fx(beta, 4)} unlevered at the peer's D/E ${fx(peerDE, 4)} and tax ${fx(peerTax, 2)}%: β(U) = ${fx(w.betaU, 4)}; relevered at this company's D/E ${fx(w.de, 4)}: β(L) = ${fx(w.betaL, 4)}`;
  const lines = [
    `Capital structure: equity ${fx(E, 2)}, debt ${fx(D, 2)}, value V = ${fx(w.V, 2)}; E/V = ${pct(w.wE, 2)}, D/V = ${pct(w.wD, 2)}, D/E = ${fx(w.de, 4)}`,
    betaLine,
    `Cost of equity (CAPM) rₑ = rf + β(L) × MRP = ${fx(rf, 3)}% + ${op(fx(w.betaL, 4))} × ${op(fx(mrp, 3) + "%")} = ${pct(w.re, 4)}`,
    `After-tax cost of debt rd(1 − T) = ${op(fx(rd, 3) + "%")} × (1 − ${fx(tax, 2)}%) = ${pct(w.rdAfter, 4)}`,
    `WACC = E/V × rₑ + D/V × rd(1 − T) = ${pct(w.wE, 2)} × ${op(pct(w.re, 4))} + ${pct(w.wD, 2)} × ${op(pct(w.rdAfter, 4))} = ${pct(w.wacc, 4)}`,
    `Conventions: market values for the weights; CAPM cost of equity; Hamada (1972) relevering β(L) = β(U)(1 + (1 − T)D/E), which assumes riskless debt (debt beta 0) and a constant amount of debt; ` +
      `the tax shield at the marginal rate T; the leverage figure holds the pre-tax cost of debt fixed at ${fx(rd, 3)}% (in practice it rises with leverage).`,
  ];
  const comp: FinTable = {
    label: "WACC components",
    rows: [
      ["Component", "Value", "Weight", "Cost", "Weighted cost"],
      ["Equity", fx(E, 2), pct(w.wE, 2), pct(w.re, 4), pct(w.wE * w.re, 4)],
      ["Debt (after tax)", fx(D, 2), pct(w.wD, 2), pct(w.rdAfter, 4), pct(w.wD * w.rdAfter, 4)],
      ["Total", fx(w.V, 2), "100.00%", "", pct(w.wacc, 4)],
    ],
    align: ["left", "right", "right", "right", "right"],
  };
  const lev: FinTable = {
    label: "WACC at other debt ratios (Hamada, cost of debt held fixed)",
    rows: [
      ["D/V", "D/E", "Levered beta", "Cost of equity", "WACC"],
      ...[0, 0.2, 0.4, 0.6].map((dv) => {
        const de = dv / (1 - dv);
        const bl = relever(w.betaU, de, input.tax);
        const re = input.rf + bl * input.mrp;
        return [pct(dv, 0), fx(de, 4), fx(bl, 4), pct(re, 3), pct((1 - dv) * re + dv * w.rdAfter, 3)];
      }),
    ],
    align: ["right", "right", "right", "right", "right"],
  };
  return finish({ text: lines.join("\n"), svg: waccLeverageSvg(input, w.betaU, w.wD), tables: [comp, lev] });
}

function rootsText(x: IrrRoots): string {
  const parts: string[] = [];
  if (x.roots.length) parts.push(x.roots.map((v) => pct(v, 4)).join(", "));
  if (x.touches.length) parts.push(`${x.touches.map((v) => pct(v, 4)).join(", ")} (NPV touches zero without changing sign: a double root)`);
  return parts.join("; ");
}

function irrSentence(name: string, cfs: number[], x: IrrRoots): string {
  const k = x.roots.length + x.touches.length;
  if (x.signChanges === 0) return `IRR (${name}): none (the cash flows never change sign, so NPV is never zero)`;
  if (k === 0) return `IRR (${name}): none found between −99% and 10,000% per period (${plural(x.signChanges, "sign change")} in the flows allow${x.signChanges === 1 ? "s" : ""} up to ${x.signChanges})`;
  return `IRR (${name}): ${k === 1 ? "" : `${k} roots: `}${rootsText(x)}` + (x.signChanges > 1 ? ` (${plural(x.signChanges, "sign change")}: Descartes' rule allows up to ${x.signChanges} roots; every root found between −99% and 10,000% is listed)` : "");
}

/** Every measure for one project. */
function projectMeasures(cfs: number[], rate: number, fr: number, rr: number) {
  const v = npvAt(rate, cfs);
  const roots = irrAll(cfs);
  const m = mirr(cfs, fr, rr);
  const pb = payback(cfs);
  const disc = cfs.map((c, t) => c / Math.pow(1 + rate, t));
  const dpb = payback(disc);
  const pi = profitabilityIndex(rate, cfs);
  const a = eaa(rate, v, cfs.length - 1);
  return { v, roots, m, pb, dpb, pi, a, disc };
}

function paybackText(p: ReturnType<typeof payback>): string {
  if (p.at === "start") return "not applicable (the first flow is not an outflow)";
  if (p.at === null) return "not reached within the cash flows";
  return `${fx(p.at, 2)} periods` + (p.dipsAgain !== null ? ` (the cumulative flow is negative again in period ${p.dipsAgain})` : "");
}

/** NPV, every IRR, MIRR, paybacks, PI, EAA, and the crossover rate between two projects. */
export function capBudgetCalc(r: Read): FinResult {
  const rate = num(r, "rate", "discount rate (% per period)", { min: -99, max: 10000, minOpen: true });
  if (typeof rate === "string") return finRefusal(rate);
  const fr = num(r, "frate", "finance rate (% per period)", { min: -99, max: 10000, minOpen: true });
  if (typeof fr === "string") return finRefusal(fr);
  const rr = num(r, "rrate", "reinvestment rate (% per period)", { min: -99, max: 10000, minOpen: true });
  if (typeof rr === "string") return finRefusal(rr);
  const a = readSeries(r("cfa"), "Project A cash flows", MAX_FLOWS);
  if (typeof a === "string") return finRefusal(a);
  if (a.values.length < 2) return finRefusal("Project A cash flows: enter at least 2 flows (t = 0 first).");
  const tooBig = (xs: number[], what: string): string | null => {
    const i = xs.findIndex((x) => Math.abs(x) > MONEY_MAX);
    return i >= 0 ? `${what}: flow ${i + 1} is larger than ${fx(MONEY_MAX, 0)} in magnitude.` : null;
  };
  const ta = tooBig(a.values, "Project A cash flows");
  if (ta) return finRefusal(ta);
  let b: { values: number[]; notes: string[] } | null = null;
  if ((r("cfb") ?? "").trim()) {
    const bb = readSeries(r("cfb"), "Project B cash flows", MAX_FLOWS);
    if (typeof bb === "string") return finRefusal(bb);
    if (bb.values.length < 2) return finRefusal("Project B cash flows: enter at least 2 flows (t = 0 first), or leave it blank.");
    const tb = tooBig(bb.values, "Project B cash flows");
    if (tb) return finRefusal(tb);
    b = bb;
  }
  const rd = rate / 100;
  const A = projectMeasures(a.values, rd, fr / 100, rr / 100);
  const B = b ? projectMeasures(b.values, rd, fr / 100, rr / 100) : null;
  let cross: IrrRoots | null = null;
  let padNote = "";
  let identical = false;
  if (b) {
    const n = Math.max(a.values.length, b.values.length);
    if (a.values.length !== b.values.length) padNote = ` The shorter project is padded with zero flows to ${n} flows for the crossover.`;
    const diff = Array.from({ length: n }, (_, t) => (a.values[t] ?? 0) - (b!.values[t] ?? 0));
    identical = diff.every((d) => d === 0);
    cross = irrAll(diff);
  }
  // which project has the higher NPV, judged at the precision printed (equal to the cent says equal)
  const higher = (): string =>
    B && fx(A.v, 2) === fx(B.v, 2) ? `The NPVs are equal at ${fx(rate, 3)}% (to the cent shown).` : `${A.v >= B!.v ? "A" : "B"} has the higher NPV at ${fx(rate, 3)}%.`;
  const one = (name: string, P: ReturnType<typeof projectMeasures>, cfs: number[]): string[] => [
    `${name}: ${plural(cfs.length, "flow")} (t = 0 to ${cfs.length - 1}); NPV at ${fx(rate, 3)}% = ${fx(P.v, 2)}`,
    irrSentence(name, cfs, P.roots),
    P.m !== null ? `MIRR (${name}) = ${pct(P.m, 4)}` : `MIRR (${name}): not defined (it needs at least one negative and one positive flow; Excel returns #DIV/0!)`,
    `Payback (${name}) ${paybackText(P.pb)}; discounted payback ${paybackText(P.dpb)}`,
    `Profitability index (${name}) = ${P.pi !== null ? fx(P.pi, 4) : "not defined (the first flow is not an outflow)"}; equivalent annual annuity = ${P.a !== null ? fx(P.a, 2) : "not defined"} per period over ${plural(cfs.length - 1, "period")}`,
  ];
  const lines = [
    ...one("Project A", A, a.values),
    ...(B && b ? one("Project B", B, b.values) : []),
    ...(cross
      ? [
          identical
            ? `Crossover rate: none; the two projects' cash flows are identical, so their NPVs coincide at every rate. The NPVs are equal at ${fx(rate, 3)}%.`
            : cross.roots.length + cross.touches.length
              ? `Crossover rate (NPV A = NPV B; the IRR of A − B): ${rootsText(cross)}. ${higher()}`
              : `Crossover rate: none between −99% and 10,000% (one project's NPV is above the other's at every rate searched). ${higher()}`,
        ]
      : []),
    ...a.notes,
    ...(b ? b.notes : []),
    `Conventions: CF₀ at t = 0 and each later flow at the end of its period; NPV and the paybacks at ${fx(rate, 3)}% per period; every IRR is a rate in −99% to 10,000% per period where NPV = 0 ` +
      `(6,000 steps even in ln(1 + r), each sign change bisected; a root that only touches zero is found by minimizing |NPV|; two roots closer than about 0.15% of (1 + r) can be missed); ` +
      `MIRR on Excel's semantics: negative flows discounted to t = 0 at the finance rate ${fx(fr, 3)}%, positive flows compounded to the last period at the reinvestment rate ${fx(rr, 3)}%, (FV/−PV) to the power 1/(n − 1), minus 1; ` +
      `payback is the first period the cumulative flow reaches zero, interpolated linearly within the period; profitability index = PV of the flows after t = 0 ÷ −CF₀ (later outflows netted in the numerator); ` +
      `equivalent annual annuity = NPV × r/(1 − (1 + r)⁻ᴺ) over the N periods after t = 0.${padNote}`,
  ];
  const rowOf = (label: string, f: (P: ReturnType<typeof projectMeasures>, cfs: number[]) => string): string[] => [label, f(A, a.values), ...(B && b ? [f(B, b.values)] : [])];
  const irrCell = (P: ReturnType<typeof projectMeasures>): string => {
    const all = [...P.roots.roots, ...P.roots.touches].sort((x, y) => x - y);
    return all.length ? all.map((v) => pct(v, 3)).join("; ") : "none";
  };
  const shortPb = (p: ReturnType<typeof payback>): string => (p.at === "start" ? "not applicable" : p.at === null ? "not reached" : fx(p.at, 2));
  const metrics: FinTable = {
    label: "Capital budgeting measures",
    rows: [
      ["Measure", "Project A", ...(B ? ["Project B"] : [])],
      rowOf(`NPV at ${fx(rate, 2)}%`, (P) => fx(P.v, 2)),
      rowOf("IRR (every root)", (P) => irrCell(P)),
      rowOf("MIRR", (P) => (P.m !== null ? pct(P.m, 3) : "not defined")),
      rowOf("Payback (periods)", (P) => shortPb(P.pb)),
      rowOf("Discounted payback (periods)", (P) => shortPb(P.dpb)),
      rowOf("Profitability index", (P) => (P.pi !== null ? fx(P.pi, 4) : "not defined")),
      rowOf("Equivalent annual annuity", (P) => (P.a !== null ? fx(P.a, 2) : "not defined")),
    ],
    align: ["left", "right", ...(B ? (["right"] as const) : [])],
  };
  const flowRows = (cfs: number[], P: ReturnType<typeof projectMeasures>): string[][] => {
    const row = (t: number): string[] => [String(t), fx(cfs[t], 2), fx(P.disc[t], 2), fx(P.pb.cumulative[t], 2), fx(P.dpb.cumulative[t], 2)];
    const n = cfs.length;
    const idx = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
    return n <= 80 ? idx(0, n).map(row) : [...idx(0, 60).map(row), ["…", "…", "…", "…", "…"], ...idx(n - 20, n).map(row)];
  };
  const flows: FinTable = {
    label: "Project A cash flows",
    rows: [["Period", "Cash flow", "Discounted", "Cumulative", "Cumulative discounted"], ...flowRows(a.values, A)],
    align: ["right", "right", "right", "right", "right"],
    note: `Discounted at ${fx(rate, 3)}% per period.`,
  };
  const svg = npvProfileSvg(
    [{ name: "A", cfs: a.values, roots: [...A.roots.roots, ...A.roots.touches] }, ...(B && b ? [{ name: "B", cfs: b.values, roots: [...B.roots.roots, ...B.roots.touches] }] : [])],
    cross ? [...cross.roots, ...cross.touches] : [],
    rd,
  );
  const marked = [...A.roots.roots, ...A.roots.touches, ...(B ? [...B.roots.roots, ...B.roots.touches] : []), ...(cross ? [...cross.roots, ...cross.touches] : [])];
  const [plo, phi] = profileRange(marked, rd);
  if (marked.some((x) => x < plo || x > phi)) lines.splice(lines.length - 1, 0, `The NPV profile is drawn from ${pct(plo, 0)} to ${pct(phi, 0)} per period; the rates listed above outside that range are not marked on it.`);
  return finish({ text: lines.join("\n"), svg, tables: [metrics, flows] });
}

/** Multi-stage DCF: explicit years, fade, terminal value, EV → equity → per share, and a sensitivity grid. */
export function dcfCalc(r: Read): FinResult {
  const s = readSeries(r("fcf"), "Explicit free cash flows", DCF_MAX_YEARS);
  if (typeof s === "string") return finRefusal(s);
  if (s.values.some((x) => Math.abs(x) > MONEY_MAX)) return finRefusal(`Explicit free cash flows: a flow is larger than ${fx(MONEY_MAX, 0)} in magnitude.`);
  const w = num(r, "wacc", "discount rate WACC (%)", { min: -99, max: 1000, minOpen: true });
  if (typeof w === "string") return finRefusal(w);
  const fade = num(r, "fade", "fade years", { min: 0, max: DCF_MAX_YEARS, int: true });
  if (typeof fade === "string") return finRefusal(fade);
  const terminal = r("terminal") === "exit" ? "exit" : "gordon";
  const g = num(r, "g", "terminal growth g (%)", { min: -99, max: 1000, minOpen: true });
  if (typeof g === "string") return finRefusal(g);
  let fadeStart = g;
  if (fade > 0) {
    const fs = optNum(r, "fadestart", "first fade-year growth (%)", { min: -99, max: 1000, minOpen: true });
    if (typeof fs === "string") return finRefusal(fs);
    if (fs !== null) fadeStart = fs;
    else {
      const f = s.values;
      if (f.length < 2 || f[f.length - 2] === 0) return finRefusal("First fade-year growth (%): enter it (with one explicit year, or a zero second-to-last flow, the last explicit growth cannot be read).");
      fadeStart = (f[f.length - 1] / f[f.length - 2] - 1) * 100;
    }
  }
  let multiple = 0;
  let metric: number | null = null;
  if (terminal === "exit") {
    const m = num(r, "multiple", "exit multiple (×)", { min: 0, max: 1000 });
    if (typeof m === "string") return finRefusal(m);
    multiple = m;
    const mt = optNum(r, "metric", "final-year metric for the exit multiple (e.g. EBITDA)", { min: -MONEY_MAX, max: MONEY_MAX });
    if (typeof mt === "string") return finRefusal(mt);
    metric = mt;
  }
  const midYear = r("timing") === "mid";
  const netDebt = num(r, "netdebt", "net debt", { min: -MONEY_MAX, max: MONEY_MAX });
  if (typeof netDebt === "string") return finRefusal(netDebt);
  const shares = optNum(r, "shares", "shares outstanding", { min: 0, minOpen: true, max: MONEY_MAX });
  if (typeof shares === "string") return finRefusal(shares);
  const wStep = num(r, "wstep", "sensitivity step for WACC (percentage points)", { min: 0, minOpen: true, max: 10 });
  if (typeof wStep === "string") return finRefusal(wStep);
  const tStep = num(r, "tstep", terminal === "gordon" ? "sensitivity step for g (percentage points)" : "sensitivity step for the exit multiple (×)", { min: 0, minOpen: true, max: 100 });
  if (typeof tStep === "string") return finRefusal(tStep);
  const base: DcfInput = {
    fcf: s.values,
    wacc: w / 100,
    fadeYears: fade,
    fadeStart: fadeStart / 100,
    terminal,
    g: g / 100,
    multiple,
    metric,
    midYear,
    netDebt,
    shares,
  };
  const d = dcfValue(base);
  if ("error" in d) return finRefusal(d.error);
  const N = s.values.length;
  const T = N + fade;
  const valueOf = (x: DcfResult): number => (x.perShare !== null ? x.perShare : x.equity);
  const valueName = shares !== null ? "value per share" : "equity value";
  const lines = [
    `Multi-stage DCF: ${plural(N, "explicit year")}${fade ? ` and ${plural(fade, "fade year")} (growth ${fx(fadeStart, 3)}% fading linearly to ${fx(g, 3)}%)` : ""}, discounted at ${fx(w, 3)}%, ${midYear ? "mid-year" : "end-of-year"} convention`,
    `PV of the explicit years = ${fx(d.pvExplicit, 2)}` + (fade ? `; PV of the fade years = ${fx(d.pvFade, 2)}` : ""),
    terminal === "gordon"
      ? `Terminal value at year ${T} (Gordon) = FCF${subDigits(T)} × (1 + g)/(WACC − g) = ${op(fx(d.years[d.years.length - 1].fcf, 2))} × ${fx(1 + g / 100, 4)}/(${fx(w, 3)}% − ${op(fx(g, 3) + "%")}) = ${fx(d.tv, 2)}; ` +
        (Number.isFinite(d.implied) ? `implied multiple of final-year FCF ${fx(d.implied, 2)}×` : "no implied multiple (the final-year FCF is 0)")
      : `Terminal value at year ${T} (exit multiple) = ${fx(multiple, 2)}× ${metric !== null ? `the final-year metric ${fx(metric, 2)}` : `final-year FCF ${fx(d.years[d.years.length - 1].fcf, 2)}`} = ${fx(d.tv, 2)}; implied perpetual growth of FCF ${Number.isFinite(d.implied) ? pct(d.implied, 3) : "not defined"}`,
    `PV of the terminal value = ${fx(d.pvTv, 2)} (discounted ${fx(d.tvT, 1)} years), ${Number.isFinite(d.tvShare) ? pct(d.tvShare, 1) : "not defined as a share"} of enterprise value`,
    `Enterprise value = ${fx(d.ev, 2)}; less net debt ${fx(netDebt, 2)} = equity value ${fx(d.equity, 2)}` + (d.perShare !== null ? `; ÷ ${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format(shares!)} share${shares === 1 ? "" : "s"} = ${fx(d.perShare, 4)} per share` : ""),
    ...(d.equity < 0 ? ["Equity value is negative: net debt exceeds the enterprise value."] : []),
    ...s.notes,
    `Conventions: free cash flows to the firm discounted at the WACC; ${midYear ? "mid-year: year t is discounted (t − 0.5) years" : "end-of-year: year t is discounted t years"}; ` +
      (fade ? `fade year k (1 to ${fade}) grows at g₁ + (g − g₁)(k − 1)/${fade}, g₁ = ${fx(fadeStart, 3)}%; ` : "") +
      (terminal === "gordon"
        ? `Gordon terminal value on the year ${T + 1} flow FCF${subDigits(T)}(1 + g), discounted ${midYear ? `${fx(T - 0.5, 1)} years (mid-year, as the flows it capitalizes)` : `${T} year${T === 1 ? "" : "s"}`}; `
        : `exit-multiple terminal value at the end of year ${T}, discounted ${T} year${T === 1 ? "" : "s"}${midYear ? " (a sale at year end, not mid-year)" : ""}; `) +
      `equity = EV − net debt (debt less cash; other claims such as minority interest and preferred stock, if any, belong in net debt); sensitivity: one input moved at a time on the grid, everything else as entered.`,
  ];
  const yearTable: FinTable = {
    label: "Free cash flow forecast",
    rows: [
      ["Year", "Stage", "Growth", "Free cash flow", "Discount factor", "PV"],
      ...d.years.map((y) => [String(y.year), y.stage === "explicit" ? "Explicit" : "Fade", y.growth !== null && Number.isFinite(y.growth) ? pct(y.growth, 2) : "", fx(y.fcf, 2), fx(y.df, 6), fx(y.pv, 2)]),
      ["Terminal", terminal === "gordon" ? "Gordon" : "Exit multiple", terminal === "gordon" ? pct(g / 100, 2) : `${fx(multiple, 2)}×`, fx(d.tv, 2), fx(Math.pow(1 + base.wacc, -d.tvT), 6), fx(d.pvTv, 2)],
    ],
    align: ["left", "left", "right", "right", "right", "right"],
  };
  const bridge: FinTable = {
    label: "Enterprise value to equity value",
    rows: [
      ["Item", "Amount"],
      ["PV of explicit years", fx(d.pvExplicit, 2)],
      ...(fade ? [["PV of fade years", fx(d.pvFade, 2)]] : []),
      ["PV of terminal value", fx(d.pvTv, 2)],
      ["Enterprise value", fx(d.ev, 2)],
      ["Less net debt", fx(-netDebt, 2)],
      ["Equity value", fx(d.equity, 2)],
      ...(d.perShare !== null ? [["Value per share", fx(d.perShare, 4)]] : []),
    ],
    align: ["left", "right"],
  };
  // Sensitivity: 5 × 5 around the inputs.
  const ws = [-2, -1, 0, 1, 2].map((k) => w + k * wStep);
  const ts = [-2, -1, 0, 1, 2].map((k) => (terminal === "gordon" ? g + k * tStep : multiple + k * tStep));
  let blanks = 0;
  const grid = ws.map((wv) =>
    ts.map((tv) => {
      if (!(wv > -99) || (terminal === "exit" && tv < 0)) {
        blanks++;
        return null;
      }
      const x = dcfValue({ ...base, wacc: wv / 100, ...(terminal === "gordon" ? { g: tv / 100 } : { multiple: tv }) });
      if ("error" in x || !Number.isFinite(valueOf(x))) {
        blanks++;
        return null;
      }
      return valueOf(x);
    }),
  );
  const colLabel = (tv: number): string => (terminal === "gordon" ? `g ${fx(tv, 2)}%` : `${fx(tv, 1)}×`);
  const rowLabels = ws.map((wv) => `WACC ${fx(wv, 2)}%`);
  const dp = shares !== null ? 2 : 0;
  const sens: FinTable = {
    label: `Sensitivity of the ${valueName}`,
    rows: [[terminal === "gordon" ? "WACC / growth" : "WACC / exit multiple", ...ts.map(colLabel)], ...grid.map((row, i) => [rowLabels[i].replace("WACC ", ""), ...row.map((v) => (v === null ? "n/a" : fx(v, dp)))])],
    align: ["left", "right", "right", "right", "right", "right"],
    note: blanks ? `n/a: ${plural(blanks, "cell")} where the WACC is not above g (Gordon), the WACC is −99% or below, or the multiple is negative.` : `The center cell is the base case.`,
  };
  const svg = dcfSensitivityHeatmapSvg(rowLabels, ts.map(colLabel), grid, `Sensitivity of the ${valueName}`, "discount rate");
  return finish({ text: lines.join("\n"), svg, tables: [yearTable, bridge, sens] });
}

// ------------------------------------------------------------------------------------------------------------------
// Defaults (illustrative numbers, not market data)
// ------------------------------------------------------------------------------------------------------------------

const rowsOf = (head: string, packed: string): string => [head, ...packed.split("|")].map((l) => l.trim().replace(/ +/g, "\t")).join("\n");

const CAPM_DEFAULT = rowsOf(
  "Fund Market",
  "-4.33 -2.32|2.10 -0.05|3.25 4.05|-0.28 -1.07|4.46 3.16|1.85 1.30|-0.78 -0.62|-7.23 -6.12|3.53 4.14|8.23 6.55|-5.25 -2.58|-6.60 -6.19|" +
    "-0.54 0.80|5.28 5.19|10.69 7.68|0.98 0.64|7.49 2.97|5.99 5.37|7.58 8.08|-0.90 -0.90|6.81 4.29|-8.22 -3.72|2.44 1.56|-3.23 -0.93|" +
    "-6.03 -5.59|-3.95 -0.87|1.79 0.43|9.28 2.10|0.45 1.47|5.32 3.12|7.35 6.23|1.88 0.86|-9.08 -7.51|4.22 2.83|10.18 6.73|-1.11 -2.54",
);
const RETURNS_DEFAULT =
  "1.79, 5.72, 5.66, 3.65, 6.74, 0.82, 1.83, 0.61, -4.41, -2.83, -1.20, -3.21, -3.69, 6.03, 3.33, 0.11, -1.59, -1.59, 0.64, -2.28, 0.22, 7.40, -1.16, 2.67, " +
  "7.44, -7.56, -0.65, 6.68, 0.52, 3.77, -1.49, 3.91, 7.25, 2.89, -0.56, 0.94, -2.46, 2.63, -0.11, 3.74, -0.82, 5.19, -1.61, -0.54, 1.15, -2.23, 5.18, 0.66";
const FRONTIER_DEFAULT = rowsOf(
  "Stocks Bonds RealEstate Gold",
  "-2.42 1.86 0.35 1.87|1.29 0.26 3.72 0.08|3.21 1.49 4.65 0.45|2.52 1.02 1.60 3.49|-2.27 0.12 -2.43 -2.32|-2.19 -0.09 -3.33 -1.62|1.45 0.69 -1.65 -1.03|" +
    "1.66 -0.52 -1.78 -2.00|1.73 -0.54 0.81 4.99|4.30 0.41 1.28 0.84|1.39 -0.53 0.94 -3.73|0.06 0.71 0.01 -0.19|-0.80 1.03 -2.24 -0.70|1.64 0.67 -0.54 2.38|" +
    "2.84 0.75 0.90 1.03|-0.62 0.96 1.29 0.88|-1.00 -0.18 3.77 2.11|3.15 0.59 0.83 -1.01|-0.51 -0.06 -2.73 0.70|0.49 0.45 0.62 1.18|2.06 -0.09 2.05 0.62|" +
    "2.53 1.75 2.87 -4.37|2.44 0.17 1.99 2.24|1.09 0.41 1.29 1.22|-2.08 -0.33 -1.90 -1.41|-0.45 1.83 0.27 1.14|-3.99 -0.40 0.29 -2.70|0.77 -0.21 0.74 3.51|" +
    "1.83 0.59 1.32 0.84|2.91 0.46 2.46 1.25|-3.90 -3.18 -4.96 -1.95|-0.62 0.68 0.61 0.62|-1.17 0.86 -2.05 -1.12|2.49 -0.57 0.18 -2.08|0.69 -0.59 -3.31 -1.52|-0.72 0.53 0.70 -0.97",
);

const SE_FIELD = {
  key: "se",
  label: "Standard errors",
  default: "classical",
  kind: "select" as const,
  options: [
    { value: "classical", label: "Classical" },
    { value: "hc1", label: "HC1 (heteroskedasticity-robust)" },
    { value: "hac", label: "Newey–West HAC (autocorrelation-robust)" },
  ],
};

export const PORTCORP_CALCS: FinCalcDef[] = [
  {
    id: "port-capm",
    group: "Portfolio & risk",
    name: "CAPM beta and alpha (regression)",
    fields: [
      { key: "data", label: "Asset, market [, risk-free rate %]: returns (%) or prices, one period per line (illustrative numbers by default)", default: CAPM_DEFAULT, kind: "block" },
      INPUT_FIELD,
      { key: "rf", label: "Risk-free rate (% per period; used without a third column)", default: "0.25", optional: true },
      PPY_FIELD,
      SE_FIELD,
    ],
    assumes:
      "The single-index (CAPM) model with constant α and β over the sample; past returns estimate future risk only if the relationship is stable. " +
      "The default rows are illustrative numbers, not market data.",
    compute: (r) => {
      // regresses the asset's excess return on the market's: beta, alpha, Treynor, information ratio
      return capmCalc(r);
    },
  },
  {
    id: "port-performance",
    group: "Portfolio & risk",
    name: "Sharpe, Sortino, Treynor and maximum drawdown",
    fields: [
      { key: "rets", label: "Returns (% per period) or prices, a list or one per line (illustrative numbers by default)", default: RETURNS_DEFAULT, kind: "block" },
      INPUT_FIELD,
      PPY_FIELD,
      { key: "rf", label: "Risk-free rate (% per period)", default: "0.25" },
      { key: "mar", label: "Minimum acceptable return for Sortino (% per period)", default: "0" },
      { key: "beta", label: "Beta for the Treynor ratio (optional)", default: "1.1", optional: true },
    ],
    assumes: "Returns are simple period returns in time order; ratios computed on the sample describe the past, not the future.",
    compute: (r) => {
      // annualized return and volatility, Sharpe, Sortino, Treynor, maximum drawdown and Calmar
      return perfCalc(r);
    },
  },
  {
    id: "port-var",
    group: "Portfolio & risk",
    name: "Value at risk and expected shortfall (CVaR)",
    fields: [
      { key: "rets", label: "Returns (% per period) or prices, a list or one per line (illustrative numbers by default)", default: RETURNS_DEFAULT, kind: "block" },
      INPUT_FIELD,
      { key: "conf", label: "Confidence level (%)", default: "95" },
      { key: "horizon", label: "Horizon (periods)", default: "1" },
      { key: "value", label: "Portfolio value", default: "1,000,000" },
      { key: "nu", label: "Student t degrees of freedom ν", default: "5" },
      { key: "sims", label: "Monte Carlo draws", default: "20000" },
      { key: "seed", label: "Seed", default: "1" },
    ],
    assumes:
      "Returns are independent and identically distributed over the sample; historical VaR assumes the sample's tail repeats, the parametric methods assume a normal or Student t shape. " +
      "VaR says nothing about how large a loss beyond it is; CVaR is the average of those losses.",
    compute: (r) => {
      // historical, normal, Student t and Monte Carlo VaR and CVaR, as positive losses
      return varCalc(r);
    },
  },
  {
    id: "port-frontier",
    group: "Portfolio & risk",
    name: "Efficient frontier and tangency portfolio (Markowitz)",
    fields: [
      { key: "data", label: "Asset returns (% per period) or prices: one column per asset, one period per line, names in a header row (illustrative numbers by default)", default: FRONTIER_DEFAULT, kind: "block" },
      INPUT_FIELD,
      PPY_FIELD,
      { key: "rf", label: "Risk-free rate (% a year)", default: "3" },
    ],
    assumes:
      "Mean-variance preferences and the sample means and covariances taken as the true ones (the optimizer is sensitive to estimation error in the means); " +
      "long-only and fully invested; no transaction costs or taxes. The default rows are illustrative numbers, not market data.",
    compute: (r) => {
      // long-only minimum-variance, tangency and frontier portfolios, with the capital market line
      return frontierCalc(r);
    },
  },
  {
    id: "corp-wacc",
    group: "Capital budgeting & valuation",
    name: "WACC with CAPM and Hamada beta relevering",
    fields: [
      { key: "e", label: "Market value of equity", default: "6,000" },
      { key: "d", label: "Market value of debt", default: "2,000" },
      { key: "rd", label: "Pre-tax cost of debt (%)", default: "6" },
      { key: "tax", label: "Tax rate (%)", default: "25" },
      { key: "rf", label: "Risk-free rate (%)", default: "4.2" },
      { key: "mrp", label: "Market risk premium (%)", default: "5.5" },
      { key: "beta", label: "Beta", default: "1.1" },
      {
        key: "betakind",
        label: "The beta entered is",
        default: "levered",
        kind: "select",
        options: [
          { value: "levered", label: "Levered (the company's own equity beta)" },
          { value: "unlevered", label: "Unlevered (asset beta): relever it" },
          { value: "peer", label: "A peer's levered beta: unlever at the peer's D/E, relever" },
        ],
      },
      { key: "peerde", label: "Peer debt-to-equity D/E (peer beta only)", default: "0.5", optional: true },
      { key: "peertax", label: "Peer tax rate (%) (peer beta only; blank = this tax rate)", default: "", optional: true },
    ],
    assumes:
      "CAPM describes the cost of equity; Hamada's relevering assumes riskless debt and a constant amount of debt; market values, not book values, weight the sources of capital; " +
      "the pre-tax cost of debt is the yield on new borrowing.",
    compute: (r) => {
      // cost of equity by CAPM with the beta un- or relevered by Hamada, then the weighted average cost of capital
      return waccCalc(r);
    },
  },
  {
    id: "corp-capbudget",
    group: "Capital budgeting & valuation",
    name: "NPV, every IRR, MIRR, payback, PI and crossover rate",
    fields: [
      { key: "cfa", label: "Project A cash flows (t = 0 first), a list or one per line", default: "-1000, 300, 400, 500, 200", kind: "block" },
      { key: "cfb", label: "Project B cash flows (optional, for the crossover rate)", default: "-1000, 600, 400, 200, 100", kind: "block", optional: true },
      { key: "rate", label: "Discount rate (% per period)", default: "10" },
      { key: "frate", label: "MIRR finance rate (% per period)", default: "10" },
      { key: "rrate", label: "MIRR reinvestment rate (% per period)", default: "12" },
    ],
    assumes:
      "Cash flows are known and arrive at the ends of periods; one discount rate for every period. IRR assumes reinvestment at the IRR itself; MIRR replaces that with the stated rates. " +
      "Flows that change sign more than once can have several IRRs (all are listed) or none: compare NPV instead.",
    compute: (r) => {
      // NPV, every IRR root with the NPV profile, MIRR, paybacks, PI, EAA and the crossover rate
      return capBudgetCalc(r);
    },
  },
  {
    id: "corp-dcf",
    group: "Capital budgeting & valuation",
    name: "Multi-stage DCF with terminal value and sensitivity grid",
    fields: [
      { key: "fcf", label: "Explicit free cash flows, years 1 … N (a list or one per line)", default: "100, 110, 120, 128, 135", kind: "block" },
      { key: "wacc", label: "Discount rate WACC (%)", default: "9" },
      { key: "fade", label: "Fade years (0 for none)", default: "5" },
      { key: "fadestart", label: "First fade-year growth (%) (blank = the last explicit year's growth)", default: "6", optional: true },
      {
        key: "terminal",
        label: "Terminal value",
        default: "gordon",
        kind: "select",
        options: [
          { value: "gordon", label: "Gordon growth" },
          { value: "exit", label: "Exit multiple" },
        ],
      },
      { key: "g", label: "Terminal growth g (%)", default: "2.5" },
      { key: "multiple", label: "Exit multiple (×) (exit multiple only)", default: "10", optional: true },
      { key: "metric", label: "Final-year metric for the multiple, e.g. EBITDA (blank = final-year FCF)", default: "", optional: true },
      {
        key: "timing",
        label: "Discounting",
        default: "end",
        kind: "select",
        options: [
          { value: "end", label: "End of year" },
          { value: "mid", label: "Mid-year convention" },
        ],
      },
      { key: "netdebt", label: "Net debt (debt − cash)", default: "300" },
      { key: "shares", label: "Shares outstanding (optional, for a per-share value)", default: "50", optional: true },
      { key: "wstep", label: "Sensitivity step for WACC (percentage points)", default: "1" },
      { key: "tstep", label: "Sensitivity step for g (points) or the multiple (×)", default: "0.5" },
    ],
    assumes:
      "Free cash flows to the firm, discounted at a constant WACC; the terminal value usually dominates the result, so read the sensitivity grid. " +
      "Net debt carries every non-equity claim you want deducted.",
    compute: (r) => {
      // explicit and fade years, Gordon or exit-multiple terminal value, EV to equity to per share, and the grid
      return dcfCalc(r);
    },
  },
];
