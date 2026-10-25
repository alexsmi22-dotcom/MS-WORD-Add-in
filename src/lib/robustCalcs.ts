/**
 * Release E4c calculators, pure functions of the field reader (taskpane.ts declares the fields and calls these):
 *  - boot-ci  bootstrap confidence interval: percentile, basic, normal and BCa (bootstrap.ts, PCG32 from prng.ts);
 *  - qreg     quantile regression by an exact LP, statsmodels' standard errors (quantReg.ts).
 *
 * The worked defaults are synthetic, generated here from PCG32 with fixed seeds, so nothing copyrighted ships.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { FittedModel, ModelTerm } from "./regModel";
import { BOOT_STATS, BOOT_MAX_B, BOOT_MIN_B, BOOT_MIN_N, runBootstrap, type BootMethod, type BootStat, type BootResult } from "./bootstrap";
import { fitQuantileLp, qrCovariance, interceptOnlyObjective, QR_MAX_ROWS, QR_MAX_ROW_QUANTILES, QR_WALL_MS, type QrVcov } from "./quantReg";
import { Pcg32, PCG_MAX_SEED } from "./prng";
import { parseRegData, parseSpec, selectColumns, findColumn, type RegSpec } from "./regData";
import { fitOls, magnitudeReason } from "./olsInference";
import { fmtFixed, fmtP, intText } from "./regTable";
import { tTestP, tCritical } from "./stats";
import { buildPlotSvg, type Series } from "./plot";
import { composePanels } from "./panels";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

export interface E4Field {
  key: string;
  label: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

function gaussFrom(rng: Pcg32): () => number {
  const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** 40 households: monthly income and spending in dollars (synthetic, PCG32 seed 2026). */
function bootDefaultTable(): string {
  const g = gaussFrom(new Pcg32(2026));
  const lines = ["income\tspend"];
  for (let i = 0; i < 40; i++) {
    const income = Math.round(Math.exp(8.4 + 0.45 * g()));
    const spend = Math.round(income * (0.55 + 0.12 * g()) + 300 * Math.abs(g()));
    lines.push(`${income}\t${spend}`);
  }
  return lines.join("\n");
}

/** 150 workers: hourly wage, years of schooling, years of experience; the spread grows with schooling (seed 1978). */
function qregDefaultTable(): string {
  const rng = new Pcg32(1978);
  const g = gaussFrom(rng);
  const lines = ["wage\teduc\texper"];
  for (let i = 0; i < 150; i++) {
    const educ = 10 + rng.bounded(11);
    const exper = rng.bounded(31);
    const wage = 4 + 1.1 * educ + 0.25 * exper - 0.004 * exper * exper + (0.25 * educ) * g();
    lines.push(`${(Math.round(wage * 100) / 100).toFixed(2)}\t${educ}\t${exper}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Field readers.

/** A whole number field: "2000", "2,000", "2 000". Blank → the default. Anything else → an error naming the field. */
export function readCount(raw: string | undefined, label: string, dflt: number, min: number, max: number): number | { error: string } {
  const t = (raw ?? "").trim();
  if (t === "") return dflt;
  const compact = t.replace(/\s/g, "");
  let digits: string | null = null;
  if (/^\d+$/.test(compact)) digits = compact;
  else if (/^\d{1,3}(,\d{3})+$/.test(compact)) digits = compact.replace(/,/g, "");
  const v = digits === null ? NaN : Number(digits);
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    return { error: `${label}: ${q(t)} is not a whole number from ${intText(min)} to ${intText(max)}.` };
  }
  return v;
}

/** Confidence: "95", "95%", "0.95" (a number above 1 is a percentage). Accepted from 50% to 99.9%. */
export function readConfidence(raw: string | undefined): number | { error: string } {
  const t = (raw ?? "").trim();
  if (t === "") return 0.95;
  const m = /^(\d+(?:\.\d+)?)\s*(%?)$/.exec(t);
  let c = NaN;
  if (m) {
    const v = Number(m[1]);
    c = m[2] === "%" || v > 1 ? v / 100 : v;
  }
  if (!(c >= 0.5 && c <= 0.999)) return { error: `Confidence: ${q(t)} is not a level from 50% to 99.9% (write 95, 95% or 0.95).` };
  return c;
}

/** Quantiles: "0.25, 0.5, 0.75" (commas, semicolons or spaces between). A semicolon present means "0,25; 0,5" decimals. */
export function readQuantiles(raw: string | undefined): number[] | { error: string } {
  const t = (raw ?? "").trim();
  if (t === "") return [0.25, 0.5, 0.75];
  const semi = t.includes(";");
  const parts = (semi ? t.split(";") : t.split(/[,\s]+/)).map((s) => s.trim()).filter((s) => s !== "");
  if (!parts.length) return { error: "Quantiles: enter one or more numbers between 0 and 1, such as 0.25, 0.5, 0.75." };
  const out: number[] = [];
  for (const p0 of parts) {
    const p = semi ? p0.replace(",", ".") : p0;
    const v = /^0?\.\d+$/.test(p) ? Number(p) : NaN;
    if (!(v > 0 && v < 1)) return { error: `Quantiles: ${q(p0)} is not a number strictly between 0 and 1 (write 0.25, not 25%).` };
    if (out.includes(v)) return { error: `Quantiles: ${q(p0)} is listed twice.` };
    out.push(v);
  }
  if (out.length > 19) return { error: "Quantiles: at most 19 at once." };
  return out.sort((a, b) => a - b);
}

/** Decimals for values whose bootstrap SE is `se`: two significant digits of the SE, 0 to 6. */
function decimalsFor(se: number, v: number): number {
  const ref = se > 0 ? se : Math.abs(v);
  if (!(ref > 0) || !Number.isFinite(ref)) return 3;
  return Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(ref))));
}

function intervalText(lo: number, hi: number, d: number): string {
  return `[${fmtFixed(lo, d)}; ${fmtFixed(hi, d)}]`;
}

// ---------------------------------------------------------------------------------------------------------------
// boot-ci

export const BOOT_CI_FIELDS: E4Field[] = [
  { key: "data", label: "Data table (header row of column names)", kind: "block" },
  { key: "stat", label: "Statistic", kind: "select", options: BOOT_STATS.map((s) => ({ value: s.value, label: s.label })) },
  { key: "vars", label: "Column (one-column statistics) or y ~ x (two-column); blank = the first column(s)", kind: "text" },
  { key: "B", label: `Replicates B (${intText(BOOT_MIN_B)} to ${intText(BOOT_MAX_B)}; blank = 2,000)`, kind: "text" },
  { key: "conf", label: "Confidence (blank = 95%)", kind: "text" },
  { key: "seed", label: "Seed (blank = 12345)", kind: "text" },
  {
    key: "method",
    label: "Headline interval (all four are tabulated)",
    kind: "select",
    options: [
      { value: "bca", label: "BCa (bias-corrected and accelerated)" },
      { value: "percentile", label: "Percentile" },
      { value: "basic", label: "Basic (reverse percentile)" },
      { value: "normal", label: "Normal (bias-corrected)" },
    ],
  },
];

export const BOOT_CI_DEFAULTS: Record<string, string> = {
  data: bootDefaultTable(),
  stat: "median",
  vars: "spend",
  B: "2,000",
  conf: "95",
  seed: "12345",
  method: "bca",
};

const METHOD_NAMES: Record<BootMethod, string> = { bca: "BCa", percentile: "Percentile", basic: "Basic", normal: "Normal" };

/** boot-ci: bootstrap confidence interval. */
export function bootCiCalc(read: Read): StatOutput {
  const get = (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
  const statRaw = get("stat") || "median";
  const statDef = BOOT_STATS.find((s) => s.value === statRaw);
  if (!statDef) return refuse(`Unknown statistic ${q(statRaw)}.`);
  const stat = statDef.value as BootStat;
  const methodRaw = (get("method") || "bca") as BootMethod;
  if (!(methodRaw in METHOD_NAMES)) return refuse(`Unknown interval method ${q(get("method"))}.`);
  const B = readCount(get("B"), "Replicates B", 2000, BOOT_MIN_B, BOOT_MAX_B);
  if (typeof B !== "number") return refuse(B.error);
  const conf = readConfidence(get("conf"));
  if (typeof conf !== "number") return refuse(conf.error);
  const seed = readCount(get("seed"), "Seed", 12345, 0, PCG_MAX_SEED);
  if (typeof seed !== "number") return refuse(seed.error);

  const parsed = parseRegData(get("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const names = parsed.data.names;
  const vars = get("vars").trim();
  let spec: RegSpec;
  if (statDef.twoColumn) {
    if (vars === "") {
      if (names.length < 2) return refuse(`${statDef.label} needs two columns; the table has one.`);
      spec = { dep: names[0], preds: [names[1]], text: `${names[0]} ~ ${names[1]}` };
    } else {
      const s = parseSpec(vars);
      if ("error" in s) return refuse(s.error);
      if (s.preds.length !== 1 || s.preds[0] === ".") return refuse(`${statDef.label} takes exactly one column on each side: “y ~ x”.`);
      spec = s;
    }
  } else {
    if (vars.includes("~")) return refuse(`${statDef.label} uses one column: name it (such as ${q(names[0])}), not a model.`);
    const name = vars === "" ? names[0] : vars;
    const j = findColumn(names, name);
    if (typeof j !== "number") return refuse(j.error);
    spec = { dep: names[j], preds: [], text: names[j] };
  }
  const sel = selectColumns(parsed.data, spec);
  if (!sel.ok) return refuse(sel.reason);
  const c = sel.cols;
  const y = c.y;
  const x = statDef.twoColumn ? c.X[0] : undefined;
  const n = y.length;
  if (n < BOOT_MIN_N) return refuse(`The bootstrap needs at least ${BOOT_MIN_N} complete rows; there ${n === 1 ? "is" : "are"} ${n}.`);
  for (const [col, nm] of [[y, c.depName], ...(x ? [[x, c.names[0]]] : [])] as [Float64Array, string][]) {
    const mag = magnitudeReason(col, nm);
    if (mag) return refuse(mag);
    if (col.every((v) => v === col[0])) return refuse(`Column ${q(nm)} is constant (every value ${fmtFixed(col[0], 6)}), so its bootstrap distribution is a single point.`);
  }
  if (stat === "ratio") {
    let sx = 0;
    for (const v of x!) sx += v;
    if (sx === 0) return refuse(`The mean of ${q(c.names[0])} is 0, so the ratio of means is undefined.`);
  }
  const r = runBootstrap({ stat, y, x, B, confidence: conf, seed });
  if (!r.ok) return refuse(r.reason);
  return bootReport(r, { stat, label: statDef.label, depName: c.depName, xName: x ? c.names[0] : undefined, B, conf, seed, method: methodRaw, notes: c.notes, named: parsed.data.named });
}

interface BootCtx {
  stat: BootStat;
  label: string;
  depName: string;
  xName?: string;
  B: number;
  conf: number;
  seed: number;
  method: BootMethod;
  notes: string[];
  named: boolean;
}

function bootReport(r: BootResult, k: BootCtx): StatOutput {
  const what =
    k.stat === "corr"
      ? `the correlation of ${k.depName} and ${k.xName}`
      : k.stat === "ratio"
        ? `the ratio of means ${k.depName}/${k.xName}`
        : k.stat === "slope"
          ? `the slope of ${k.depName} on ${k.xName}`
          : `the ${k.label.toLowerCase()} of ${k.depName}`;
  const confPct = `${fmtFixed(k.conf * 100, Number.isInteger(Math.round(k.conf * 1000) / 10) ? 0 : 1)}%`;
  const vals = [r.thetaHat, r.se, r.bias, r.percentile.lo, r.percentile.hi, r.basic.lo, r.basic.hi, r.normal.lo, r.normal.hi];
  if ("lo" in r.bca) vals.push(r.bca.lo, r.bca.hi);
  if (vals.some((v) => !Number.isFinite(v))) return refuse("The bootstrap produced a value that is not a finite number (an extreme scale); the result is not reported.");
  const d = decimalsFor(r.se, r.thetaHat);
  const bcaOk = "lo" in r.bca;
  let headline = k.method;
  const lines: string[] = [];
  lines.push(`Bootstrap ${confPct} confidence interval for ${what} (n = ${intText(r.n)}, B = ${intText(k.B)}, seed ${k.seed})`);
  const iv: Record<BootMethod, [number, number] | null> = {
    percentile: [r.percentile.lo, r.percentile.hi],
    basic: [r.basic.lo, r.basic.hi],
    normal: [r.normal.lo, r.normal.hi],
    bca: "lo" in r.bca ? [r.bca.lo, r.bca.hi] : null,
  };
  if (headline === "bca" && !bcaOk) headline = "percentile";
  const h = iv[headline]!;
  lines.push(`${METHOD_NAMES[headline]} interval: ${intervalText(h[0], h[1], d)}`);
  if (k.method === "bca" && !bcaOk) lines.push(`BCa is not available: ${(r.bca as { refused: string }).refused}. The percentile interval is shown instead.`);
  lines.push(`Estimate θ̂ = ${fmtFixed(r.thetaHat, d)}, bootstrap SE = ${fmtFixed(r.se, d)}, bias = ${fmtFixed(r.bias, d)}`);
  if (r.dropped) {
    lines.push(
      `${intText(r.dropped)} of ${intText(k.B)} resamples left the statistic undefined and were dropped (Stata's policy for a failed replicate); the intervals use the other ${intText(r.reps.length)}.`,
    );
  }
  lines.push("");
  lines.push(
    `Random numbers: PCG32 (O'Neill 2014; state initializer = the seed, stream 54), checked against the reference implementation's published output; resample indices by its unbiased bounded-integer method (rejection below 2³² mod n). The same inputs and seed give the same interval every run.`,
  );
  lines.push(
    k.xName
      ? "Resampling: rows (pairs) are drawn with replacement, n per resample; the jackknife for BCa leaves out one row at a time (scipy.stats.bootstrap with paired=True)."
      : "Resampling: n values drawn with replacement per resample; the jackknife for BCa leaves out one value at a time.",
  );
  lines.push(
    "Intervals (scipy.stats.bootstrap conventions): quantiles of the replicates by linear interpolation (Hyndman–Fan type 7); percentile [q(α), q(1 − α)]; basic [2θ̂ − q(1 − α), 2θ̂ − q(α)]; " +
      "BCa with z₀ = Φ⁻¹ of the share of replicates below θ̂ (ties count one half) and the acceleration from the jackknife; normal (θ̂ − bias) ± z·SE, as R's boot.ci type \"norm\" (scipy has no normal interval). " +
      "SE is the standard deviation of the replicates (divisor B − 1); bias = mean of the replicates − θ̂.",
  );
  if (k.stat === "sd" || k.stat === "var") lines.push("The standard deviation and variance use the divisor n − 1.");
  if (k.stat === "trim10") lines.push("The 10% trimmed mean cuts floor(0.1·n) values from each end, as scipy.stats.trim_mean(x, 0.1).");
  if (k.stat === "median") lines.push("The median of an even count is the mean of the two middle values.");
  if (k.stat === "slope") lines.push(`The slope is the least-squares slope of ${k.depName} on ${k.xName} with a constant (pairs bootstrap, so it allows heteroskedasticity).`);
  if (!k.named) lines.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  lines.push(...k.notes);

  const rows: string[][] = [["Method", "Lower", "Upper"]];
  rows.push(["Percentile", fmtFixed(r.percentile.lo, d), fmtFixed(r.percentile.hi, d)]);
  rows.push(["Basic", fmtFixed(r.basic.lo, d), fmtFixed(r.basic.hi, d)]);
  rows.push(["Normal (bias-corrected)", fmtFixed(r.normal.lo, d), fmtFixed(r.normal.hi, d)]);
  if ("lo" in r.bca) rows.push(["BCa", fmtFixed(r.bca.lo, d), fmtFixed(r.bca.hi, d)]);
  else rows.push(["BCa", `not available: ${r.bca.refused}`, ""]);
  const sumRows: string[][] = [["Quantity", "Value"]];
  sumRows.push(["θ̂ (full sample)", fmtFixed(r.thetaHat, d)]);
  sumRows.push(["Bootstrap SE", fmtFixed(r.se, d)]);
  sumRows.push(["Bias (mean of replicates − θ̂)", fmtFixed(r.bias, d)]);
  if ("lo" in r.bca) {
    sumRows.push(["Bias correction z₀", fmtFixed(r.bca.z0, 4)]);
    sumRows.push(["Acceleration â", fmtFixed(r.bca.a, 4)]);
    sumRows.push(["BCa levels α₁, α₂", `${fmtFixed(r.bca.alpha1, 4)}, ${fmtFixed(r.bca.alpha2, 4)}`]);
  }
  sumRows.push(["Replicates used", intText(r.reps.length)]);
  sumRows.push(["Seed", String(k.seed)]);
  const tables: StatTable[] = [
    { label: `${confPct} bootstrap confidence intervals`, rows, align: ["left", "right", "right"] },
    { label: "Bootstrap summary", rows: sumRows, align: ["left", "right"] },
  ];
  return { text: lines.join("\n"), tables, svg: bootFigure(r, d, k) };
}

function bootFigure(r: BootResult, d: number, k: BootCtx): string {
  const sorted = Float64Array.from(r.reps).sort();
  const B = sorted.length;
  const lo = sorted[0];
  const hi = sorted[B - 1];
  const bins = Math.max(10, Math.min(60, Math.ceil(Math.sqrt(B))));
  const series: Series[] = [];
  if (hi > lo) {
    const w = (hi - lo) / bins;
    const counts = new Array<number>(bins).fill(0);
    for (const v of sorted) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
    const pts: { x: number; y: number }[] = [{ x: lo, y: 0 }];
    for (let b = 0; b < bins; b++) {
      pts.push({ x: lo + b * w, y: counts[b] }, { x: lo + (b + 1) * w, y: counts[b] });
    }
    pts.push({ x: hi, y: 0 });
    series.push({ type: "line", points: pts, color: "#64748b", label: "Replicates" });
    const top = Math.max(...counts);
    series.push({ type: "line", points: [{ x: r.thetaHat, y: 0 }, { x: r.thetaHat, y: top }], color: "#0369a1", label: "θ̂" });
    if ("lo" in r.bca) {
      const b = r.bca;
      series.push({
        type: "line",
        points: [{ x: b.lo, y: 0 }, { x: b.lo, y: top }, { x: b.hi, y: 0, gap: true }, { x: b.hi, y: top }],
        color: "#b91c1c",
        label: "BCa bounds",
      });
    }
  } else {
    series.push({ type: "scatter", points: [{ x: lo, y: B }], color: "#64748b", label: "Replicates" });
  }
  void d;
  return buildPlotSvg(series, {
    width: 420,
    height: 260,
    title: `Bootstrap distribution (B = ${intText(B)})`,
    xlabel: k.stat === "corr" ? "Correlation" : k.stat === "slope" ? "Slope" : k.label,
    ylabel: "Replicates per bin",
  });
}

// ---------------------------------------------------------------------------------------------------------------
// qreg

export const QREG_FIELDS: E4Field[] = [
  { key: "data", label: "Data table (header row of column names)", kind: "block" },
  { key: "spec", label: "Model (y ~ x1 + x2)", kind: "text" },
  { key: "quantiles", label: "Quantiles τ, each between 0 and 1 (blank = 0.25, 0.5, 0.75)", kind: "text" },
  {
    key: "se",
    label: "Standard errors",
    kind: "select",
    options: [
      { value: "robust", label: "Kernel sandwich (statsmodels default: Epanechnikov, Hall–Sheather)" },
      { value: "iid", label: "iid errors" },
    ],
  },
  {
    key: "constant",
    label: "Constant",
    kind: "select",
    options: [
      { value: "yes", label: "Include a constant" },
      { value: "no", label: "No constant" },
    ],
  },
];

export const QREG_DEFAULTS: Record<string, string> = {
  data: qregDefaultTable(),
  spec: "wage ~ educ + exper",
  quantiles: "0.25, 0.5, 0.75",
  se: "robust",
  constant: "yes",
};

export interface QregQuantile {
  tau: number;
  model: FittedModel;
  r1: number;
  objective: number;
  pivots: number;
  bandwidth: number;
  sparsity: number;
  maybeNonUnique: boolean;
  beta: Float64Array;
  resid: Float64Array;
}

export interface QregRun {
  ok: true;
  depName: string;
  names: string[];
  n: number;
  fits: QregQuantile[];
  ols: { coef: number[]; ciLo: number[]; ciHi: number[] };
  vcov: QrVcov;
  constant: boolean;
  notes: string[];
  named: boolean;
  x1?: Float64Array;
  y: Float64Array;
  ms: number;
}

/** Fits every requested quantile; the calculator and qregModels both use it. */
export function runQreg(read: Read): QregRun | { ok: false; reason: string } {
  const get = (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
  const t0 = Date.now();
  const seRaw = get("se") || "robust";
  if (seRaw !== "robust" && seRaw !== "iid") return { ok: false, reason: `Unknown standard-error type ${q(seRaw)}.` };
  const vcov = seRaw as QrVcov;
  const consRaw = get("constant") || "yes";
  if (consRaw !== "yes" && consRaw !== "no") return { ok: false, reason: `Constant: ${q(consRaw)} is not yes or no.` };
  const constant = consRaw === "yes";
  const taus = readQuantiles(get("quantiles"));
  if (!Array.isArray(taus)) return { ok: false, reason: taus.error };
  const parsed = parseRegData(get("data"));
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const spec = parseSpec(get("spec"));
  if ("error" in spec) return { ok: false, reason: spec.error };
  // Count the rows before reading every cell: the cap is refused up front.
  if (parsed.data.rows.length > QR_MAX_ROWS) {
    return {
      ok: false,
      reason: `Quantile regression accepts at most ${intText(QR_MAX_ROWS)} rows (this table has ${intText(parsed.data.rows.length)}), so that each exact LP fit stays well inside its ${QR_WALL_MS / 1000} s limit. Fit a random sample of the rows.`,
    };
  }
  const sel = selectColumns(parsed.data, spec);
  if (!sel.ok) return { ok: false, reason: sel.reason };
  const c = sel.cols;
  if (!c.X.length && !constant) return { ok: false, reason: "The model has no regressors: add a predictor, or include the constant." };
  for (const nm of c.names) if (nm.trim().toLowerCase() === "constant") return { ok: false, reason: `A predictor is named ${q(nm)}, the name the tables give the constant term. Rename the column.` };
  const n = c.y.length;
  const p = c.X.length + (constant ? 1 : 0);
  if (n < p + 5) return { ok: false, reason: `Quantile regression with ${p} term${p === 1 ? "" : "s"} needs at least ${p + 5} complete rows; there ${n === 1 ? "is" : "are"} ${n}.` };
  for (const [col, nm] of [[c.y, c.depName], ...c.X.map((x, j) => [x, c.names[j]])] as [Float64Array, string][]) {
    const mag = magnitudeReason(col, nm);
    if (mag) return { ok: false, reason: mag };
  }
  if (c.y.every((v) => v === c.y[0])) return { ok: false, reason: `The response ${q(c.depName)} is constant, so every quantile fits it exactly and there is nothing to estimate.` };
  // fitOls on the same design: the collinearity refusal by name, the OLS line for the figure, and the start.
  const ols = fitOls({ y: c.y, depName: c.depName, X: c.X, names: c.names, constant, se: "classical" });
  if (!ols.ok) return { ok: false, reason: ols.reason };
  const cols = [...c.X, ...(constant ? [new Float64Array(n).fill(1)] : [])];
  const termNames = [...c.names, ...(constant ? ["Constant"] : [])];
  if (n * taus.length > QR_MAX_ROW_QUANTILES) {
    return {
      ok: false,
      reason: `${intText(n)} rows × ${taus.length} quantiles is more than one run fits exactly within its ${QR_WALL_MS / 1000} s limit (at most ${intText(QR_MAX_ROW_QUANTILES)} row-quantiles). Ask for fewer quantiles, or fit a random sample of the rows.`,
    };
  }
  const res = ols.resid;
  const sortedRes = Float64Array.from(res).sort();
  const deadline = t0 + QR_WALL_MS;
  const df = n - p;
  const tcrit = tCritical(0.05, df);
  const fits: QregQuantile[] = [];
  const nonUniqueTaus: number[] = [];
  for (const tau of taus) {
    // Start: the rows nearest the OLS fit shifted to the τ-quantile of its residuals (measured: 7–43 simplex steps at
    // n = 100,000 for τ = 0.05, 0.5, 0.9 on heteroskedastic, outlier-contaminated and Cauchy data).
    const shift = sortedRes[Math.floor(tau * (n - 1))];
    const dist = Float64Array.from(res, (v) => Math.abs(v - shift));
    const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => dist[a] - dist[b] || a - b);
    const lp = fitQuantileLp({ y: c.y, cols, tau, startOrder: order, deadline });
    if (!lp.ok) return { ok: false, reason: lp.reason };
    const cov = qrCovariance(c.y, cols, lp.resid, tau, vcov);
    if (!cov.ok) return { ok: false, reason: `τ = ${tau}: ${cov.reason}` };
    const v0 = interceptOnlyObjective(c.y, tau);
    const r1 = v0 > 0 ? 1 - lp.objective / v0 : NaN;
    const terms: ModelTerm[] = termNames.map((name, k) => {
      const coef = lp.beta[k];
      const se = Math.sqrt(cov.cov[k][k]);
      const stat = coef / se;
      return { name, coef, se, stat, p: tTestP(stat, df), ciLo: coef - tcrit * se, ciHi: coef + tcrit * se };
    });
    const bad = terms.find((t) => ![t.coef, t.se, t.stat, t.p, t.ciLo, t.ciHi].every(Number.isFinite) || !(t.se > 0));
    if (bad) return { ok: false, reason: `τ = ${tau}: the standard error of ${q(bad.name)} is not a positive finite number (an extreme scale or a degenerate fit); the result is not reported.` };
    if (!Number.isFinite(r1)) return { ok: false, reason: `τ = ${tau}: the pseudo R¹ is undefined (the intercept-only fit is exact).` };
    const integerNtau = Math.abs(n * tau - Math.round(n * tau)) < 1e-9;
    const maybeNonUnique = lp.maybeNonUnique || integerNtau;
    if (maybeNonUnique) nonUniqueTaus.push(tau);
    const model: FittedModel = {
      kind: "quantile",
      depName: c.depName,
      n,
      terms,
      statLabel: "t",
      df,
      seLabel: vcov === "robust" ? "Kernel sandwich (Epanechnikov, Hall–Sheather)" : "iid",
      stats: [
        { label: "Quantile τ", value: tau, decimals: 2 },
        { label: "Pseudo R¹", value: r1 },
        { label: "N", value: n, decimals: 0 },
      ],
      notes: [`Quantile regression at τ = ${tau}, solved exactly by linear programming; t on ${df} df.`],
    };
    fits.push({ tau, model, r1, objective: lp.objective, pivots: lp.pivots, bandwidth: cov.bandwidth, sparsity: cov.sparsity, maybeNonUnique, beta: lp.beta, resid: lp.resid });
  }
  const notes = [...c.notes];
  if (nonUniqueTaus.length) {
    notes.push(
      `At τ = ${nonUniqueTaus.join(", ")} the minimiser may not be unique (n·τ is a whole number, or there are ties at the optimum, as with integer or repeated values): another set of coefficients can reach the same minimum, and the one shown is a vertex of that set.`,
    );
  }
  return {
    ok: true,
    depName: c.depName,
    names: termNames,
    n,
    fits,
    ols: { coef: ols.model.terms.map((t) => t.coef), ciLo: ols.model.terms.map((t) => t.ciLo), ciHi: ols.model.terms.map((t) => t.ciHi) },
    vcov,
    constant,
    notes,
    named: parsed.data.named,
    x1: c.X.length === 1 ? c.X[0] : undefined,
    y: c.y,
    ms: Date.now() - t0,
  };
}

/** The fitted quantile models (kind "quantile"), one per τ, for the publication table. */
export function qregModels(read: Read): FittedModel[] | { error: string } {
  const r = runQreg(read);
  if (!r.ok) return { error: r.reason };
  return r.fits.map((f) => f.model);
}

const tauText = (t: number): string => String(t);

/** qreg: quantile regression. */
export function qregCalc(read: Read): StatOutput {
  const r = runQreg(read);
  if (!r.ok) return refuse(r.reason);
  const d = 3;
  const k = r.names.filter((nm) => nm !== "Constant").length;
  const lines: string[] = [];
  lines.push(`Quantile regression of ${r.depName} on ${k} predictor${k === 1 ? "" : "s"} at τ = ${r.fits.map((f) => tauText(f.tau)).join(", ")} (n = ${intText(r.n)})`);
  lines.push(`Standard errors: ${r.vcov === "robust" ? "kernel sandwich (statsmodels QuantReg default)" : "iid"}`);
  lines.push(`Pseudo R¹ (Koenker–Machado): ${r.fits.map((f) => `${fmtFixed(f.r1, 3)} at τ = ${tauText(f.tau)}`).join("; ")}`);
  lines.push("");
  lines.push(
    "Conventions: each quantile is fitted by an exact linear program (the simplex method of Barrodale and Roberts on min Σ τu⁺ + (1 − τ)u⁻, with lexicographic tie-breaking), not by statsmodels' iteratively reweighted least squares, which only approximates the minimiser.",
  );
  lines.push(
    r.vcov === "robust"
      ? "Standard errors as statsmodels QuantReg.fit(vcov=\"robust\", kernel=\"epa\", bandwidth=\"hsheather\"), evaluated at the exact solution: the sandwich (XᵀX)⁻¹XᵀDX(XᵀX)⁻¹ with D = (τ/f̂)² for positive residuals and ((1 − τ)/f̂)² otherwise; f̂ is an Epanechnikov kernel density of the residuals at 0, bandwidth min(sd(y), IQR(residuals)/1.34)·(Φ⁻¹(τ + h) − Φ⁻¹(τ − h)) with Hall and Sheather's h."
      : "Standard errors as statsmodels QuantReg.fit(vcov=\"iid\"), evaluated at the exact solution: τ(1 − τ)/f̂²·(XᵀX)⁻¹, f̂ an Epanechnikov kernel density of the residuals at 0 with Hall and Sheather's bandwidth.",
  );
  lines.push(`t statistics, p-values and 95% intervals on n − p = ${intText(r.n - r.names.length)} degrees of freedom (statsmodels' use_t).`);
  lines.push(
    "Pseudo R¹ = 1 − V(τ)/V₀(τ), V the minimised check-function sum and V₀ that of the intercept-only model, at its exact minimiser (the sample τ-quantile order statistic)" +
      (r.constant ? "." : "; without a constant the model can fit worse than the intercept-only one, so R¹ can be negative."),
  );
  lines.push(r.constant ? "A constant is included (shown last, as Stata prints it)." : "No constant (regression through the origin).");
  lines.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion).");
  if (!r.named) lines.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  lines.push(...r.notes);

  const tables: StatTable[] = [];
  for (const f of r.fits) {
    const m = f.model;
    const rows: string[][] = [["Term", "Coef.", "SE", "t", "p", "95% CI"]];
    for (const t of m.terms) rows.push([t.name, fmtFixed(t.coef, d), fmtFixed(t.se, d), fmtFixed(t.stat, d), fmtP(t.p), `[${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}]`]);
    tables.push({
      label: `Coefficients: ${r.depName}, τ = ${tauText(f.tau)}`,
      rows,
      align: ["left", "right", "right", "right", "right", "right"],
      note: `Pseudo R¹ = ${fmtFixed(f.r1, 3)}; t on ${m.df} df.`,
    });
  }
  const sum: string[][] = [["τ", "Pseudo R¹", "Check-function sum", "Simplex steps", "Bandwidth h", "Sparsity 1/f̂"]];
  for (const f of r.fits) sum.push([tauText(f.tau), fmtFixed(f.r1, 3), fmtFixed(f.objective, d), intText(f.pivots), fmtFixed(f.bandwidth, 4), fmtFixed(f.sparsity, 4)]);
  tables.push({ label: "Fit by quantile", rows: sum, align: ["left", "right", "right", "right", "right", "right"] });

  let svg: string | undefined;
  try {
    svg = qregFigure(r);
  } catch {
    svg = undefined;
  }
  if (!svg && r.fits.length < 3 && !r.x1) lines.push("No figure: with fewer than three quantiles the figure is the fitted lines over a scatter, which needs a single predictor.");
  return { text: lines.join("\n"), tables, svg };
}

/** A dashed horizontal line from x0 to x1 at y, as gapped line pieces (the plotter has no dash style). */
function dashed(x0: number, x1: number, y: number): { x: number; y: number; gap?: boolean }[] {
  const pts: { x: number; y: number; gap?: boolean }[] = [];
  const steps = 12;
  const w = (x1 - x0) / (2 * steps - 1);
  for (let s = 0; s < steps; s++) {
    const a = x0 + 2 * s * w;
    pts.push({ x: a, y, gap: s > 0 }, { x: Math.min(x1, a + w), y });
  }
  return pts;
}

const MAX_PROCESS_PANELS = 6;

function qregFigure(r: QregRun): string | undefined {
  if (r.fits.length >= 3) {
    const t0 = r.fits[0].tau;
    const t1 = r.fits[r.fits.length - 1].tau;
    const panels: string[] = [];
    r.names.slice(0, MAX_PROCESS_PANELS).forEach((name, k) => {
      const est = r.fits.map((f) => ({ x: f.tau, y: f.model.terms[k].coef }));
      const lo = r.fits.map((f) => ({ x: f.tau, y: f.model.terms[k].ciLo }));
      const hi = r.fits.map((f) => ({ x: f.tau, y: f.model.terms[k].ciHi }));
      panels.push(
        buildPlotSvg(
          [
            { type: "line", points: lo, color: "#93c5fd", label: "95% band" },
            { type: "line", points: hi, color: "#93c5fd" },
            { type: "line", points: est, color: "#0369a1", label: "Quantile estimate" },
            { type: "scatter", points: est, color: "#0369a1" },
            { type: "line", points: dashed(t0, t1, r.ols.coef[k]), color: "#64748b", label: "OLS (dashed)" },
          ],
          { width: 320, height: 220, title: name, xlabel: "Quantile τ", ylabel: "Coefficient" },
        ),
      );
    });
    return composePanels(panels, { cols: Math.min(2, panels.length) }).svg;
  }
  if (!r.x1) return undefined;
  const x = r.x1;
  const n = x.length;
  const step = n > 2000 ? Math.ceil(n / 2000) : 1;
  const pts: { x: number; y: number }[] = [];
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < xmin) xmin = x[i];
    if (x[i] > xmax) xmax = x[i];
    if (i % step === 0) pts.push({ x: x[i], y: r.y[i] });
  }
  const colors = ["#b91c1c", "#0369a1"];
  const series: Series[] = [{ type: "scatter", points: pts, color: "#94a3b8", label: "Data" }];
  r.fits.forEach((f, j) => {
    const b = f.beta;
    const at = (xv: number): number => b[0] * xv + (r.constant ? b[1] : 0);
    series.push({ type: "line", points: [{ x: xmin, y: at(xmin) }, { x: xmax, y: at(xmax) }], color: colors[j % 2], label: `τ = ${tauText(f.tau)}` });
  });
  const oc = r.ols.coef;
  const atO = (xv: number): number => oc[0] * xv + (r.constant ? oc[1] : 0);
  series.push({ type: "line", points: [{ x: xmin, y: atO(xmin) }, { x: xmax, y: atO(xmax) }], color: "#64748b", label: "OLS" });
  return buildPlotSvg(series, { width: 420, height: 270, title: "Quantile regression lines", xlabel: r.names[0], ylabel: r.depName });
}
