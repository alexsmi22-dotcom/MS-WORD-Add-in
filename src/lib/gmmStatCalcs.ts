/**
 * Release F3 gap #19, GMM and dynamic panels — Stats calculators (spread into the pane's STAT_CALCS):
 *  - econ-gmm        linear GMM: one-step (2SLS weight) or two-step efficient GMM for y = Xβ + u with instruments,
 *                    heteroskedasticity-robust or clustered weight, Hansen J, the 2SLS first step beside it
 *                    (pinned to linearmodels 7.1 IVGMM);
 *  - panel-dyn-gmm   Arellano–Bond difference GMM and Blundell–Bond system GMM for y_it = ρ·y_i,t−1 + x_itᵀβ + η_i
 *                    + ε_it: one- or two-step (Windmeijer-corrected), AR(1)/AR(2), Sargan and Hansen, instrument
 *                    count against groups, lag range and collapse, time dummies, and the OLS / fixed-effects bracket
 *                    on ρ (pinned to Roodman's published xtabond2 abdata tables, pydynpd 0.2.2 and scripts/gmm_np.py).
 * Engines in gmm.ts. Data read with regData.parseRegData and panelData.readPanel (one variable at a time, so a missing
 * cell in one column does not remove another column's history from the instruments, as xtabond2's "missing = 0").
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { StatCalcDef } from "./statCalc";
import { findColumn, parseRegData, selectColumns, type RegDataset } from "./regData";
import { readPanel, panelTextTooLong } from "./panelData";
import { readDateToken, civilFromDay } from "./damagesInterest";
import { fmtFixed, fmtP, intText, numText, P_BELOW } from "./regTable";
import { buildPlotSvg, type Series } from "./plot";
import { chiSquareP } from "./stats2";
import { ivDefaultTable } from "./ivCalcs";
import {
  buildDynamic,
  fitDynamic,
  fitLinearGmm,
  olsFeOnLevels,
  GmmRefusal,
  GMM_Z975,
  DPD_MAX_GROUPS,
  DPD_MAX_PERIODS,
  DPD_MAX_ROWS,
  LGMM_MAX_ROWS,
  type DynData,
  type DynDesign,
  type DynFit,
  type DynSpec,
  type DynTerm,
  type LinearGmmResult,
} from "./gmm";

type Read = (key: string) => string;
type Align = ("left" | "right")[];
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

const D = 4;
const ALIGN6: Align = ["left", "right", "right", "right", "right", "right"];

function pText(p: number): string {
  if (!Number.isFinite(p)) return "p not computed";
  return p < 0.001 ? `p ${P_BELOW}` : `p = ${p.toFixed(3)}`;
}
/** "a to b" (the word, never a dash that could read as a minus). */
function ci(lo: number, hi: number): string {
  return `${fmtFixed(lo, D)} to ${fmtFixed(hi, D)}`;
}
function coefRow(name: string, b: number, se: number): string[] {
  const z = b / se;
  // Two-sided normal p as P(χ²₁ > z²): the upper tail keeps its precision far out (1 − Φ would cancel).
  const p = chiSquareP(z * z, 1);
  return [name, fmtFixed(b, D), fmtFixed(se, D), Number.isFinite(z) ? fmtFixed(z, 2) : "not computed", Number.isFinite(z) ? fmtP(p) : "not computed", ci(b - GMM_Z975 * se, b + GMM_Z975 * se)];
}
/**
 * A value outside 10⁻¹⁰⁰…10¹⁰⁰ (or 0) makes the cross-products overflow or vanish, which would surface as a false
 * "collinear" refusal: refuse it by column and data row instead (olsInference.magnitudeReason's bounds).
 */
function magnitude(col: ArrayLike<number>, rows: number[], name: string): string | null {
  for (let i = 0; i < col.length; i++) {
    const a = Math.abs(col[i]);
    if (a !== 0 && (a < 1e-100 || a > 1e100)) {
      return `${q(name)}, row ${rows[i]}: ${numText(col[i])} is outside the magnitudes GMM here accepts (10⁻¹⁰⁰ to 10¹⁰⁰, or 0). Rescale the column and fit again.`;
    }
  }
  return null;
}
function nameList(text: string): string[] | null {
  const t = (text ?? "").trim();
  if (!t) return [];
  const parts = t.split(/[+,]/).map((s) => s.trim());
  return parts.some((s) => s === "") ? null : parts;
}
function getter(read: Read): (k: string) => string {
  return (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
}
function fail(e: unknown, what: string): StatOutput {
  if (e instanceof GmmRefusal) return refuse(e.message);
  return refuse(`The ${what} could not be computed for these data (${(e as Error).message}). Check the columns for extreme values.`);
}

// ---------------------------------------------------------------------------------------------------- econ-gmm

export const GMM_STEPS_OPTIONS = [
  { value: "two", label: "Two-step efficient GMM" },
  { value: "one", label: "One-step (2SLS weight, robust covariance)" },
];

const err = (error: string): { error: string } => ({ error });

export interface GmmFitted {
  r: LinearGmmResult;
  names: string[];
  endog: string[];
  exog: string[];
  instr: string[];
  constant: boolean;
  steps: "one" | "two";
  cluster?: string;
  clusterName?: string;
  G: number;
  depName: string;
  named: boolean;
  notes: string[];
}

/** The fit behind econ-gmm (tests read it), or the refusal. */
export function econGmmFitFromRead(read: Read): GmmFitted | { error: string } {
  const get = getter(read);
  const steps = (get("steps").trim() || "two") as string;
  if (steps !== "one" && steps !== "two") return err(`Steps: ${q(steps)} is not one or two.`);
  const weight = get("weight").trim() || "robust";
  if (weight !== "robust" && weight !== "cluster") return err(`Weight matrix: ${q(weight)} is not robust or cluster.`);
  const constRaw = get("constant").trim() || "yes";
  if (constRaw !== "yes" && constRaw !== "no") return err(`Constant: ${q(constRaw)} is not yes or no.`);
  const constant = constRaw === "yes";
  const parsed = parseRegData(get("data"));
  if (!parsed.ok) return err(parsed.reason);
  const data = parsed.data;
  const specText = get("spec").trim();
  if (!specText) return err("Write the model as “y ~ x1 + x2” (the response, then the exogenous regressors; nothing after ~ for the constant only).");
  const parts = specText.split("~");
  if (parts.length > 2) return err(`Write the model as “y ~ x1 + x2” (one ~): ${q(specText)}.`);
  const dep = parts[0].trim();
  if (!dep) return err(`The model ${q(specText)} has no response before the ~.`);
  const exog = nameList(parts[1] ?? "");
  if (!exog) return err(`The model ${q(specText)} has an empty term (two + in a row?).`);
  if (exog.includes(".")) return err("List the exogenous regressors by name: “.” would also take the endogenous regressors and the instruments.");
  const endog = nameList(get("endog"));
  if (!endog) return err("Endogenous regressors: an empty name (two + in a row?).");
  const instr = nameList(get("instruments"));
  if (!instr) return err("Excluded instruments: an empty name (two + in a row?).");
  if (instr.length < endog.length) {
    return err(
      `Under-identified: ${endog.length} endogenous regressor${endog.length === 1 ? "" : "s"} but ${instr.length} excluded instrument${instr.length === 1 ? "" : "s"}. ` +
        "GMM needs at least as many excluded instruments as endogenous regressors (the order condition).",
    );
  }
  // Each name once, in one role.
  const roles = new Map<number, string>();
  const dj = findColumn(data.names, dep);
  if (typeof dj !== "number") return err(`Response: ${dj.error}`);
  roles.set(dj, "the response");
  for (const [list, what, field] of [
    [exog, "an exogenous regressor", "Exogenous regressor"],
    [endog, "an endogenous regressor", "Endogenous regressor"],
    [instr, "an excluded instrument", "Excluded instrument"],
  ] as [string[], string, string][]) {
    for (const nm of list) {
      const j = findColumn(data.names, nm);
      if (typeof j !== "number") return err(`${field}: ${j.error}`);
      const prev = roles.get(j);
      if (prev) return err(prev === what ? `${q(data.names[j])} is listed twice as ${what}.` : `${q(data.names[j])} cannot be both ${prev} and ${what}.`);
      roles.set(j, what);
    }
  }
  let cluster: string | undefined;
  if (weight === "cluster") {
    cluster = get("cluster").trim();
    if (!cluster) return err("Name the cluster column (clustered weight matrix).");
    const cj = findColumn(data.names, cluster);
    if (typeof cj !== "number") return err(`Cluster column: ${cj.error}`);
    const prev = roles.get(cj);
    if (prev) return err(`${q(data.names[cj])} is ${prev}; it cannot also be the cluster column.`);
  }
  if (data.rows.length > LGMM_MAX_ROWS) return err(`The table has ${intText(data.rows.length)} rows; GMM here is limited to ${intText(LGMM_MAX_ROWS)} rows.`);
  const sel = selectColumns(data, { dep, preds: [...endog, ...exog, ...instr], text: specText }, { cluster });
  if (!sel.ok) return err(sel.reason);
  const c = sel.cols;
  const k1 = endog.length;
  const k2 = exog.length;
  const n = c.y.length;
  const ones = new Float64Array(n).fill(1);
  const X = [...c.X.slice(0, k1 + k2), ...(constant ? [ones] : [])];
  const names = [...c.names.slice(0, k1 + k2), ...(constant ? ["Constant"] : [])];
  const Z = [...c.X.slice(k1 + k2), ...c.X.slice(k1, k1 + k2), ...(constant ? [ones] : [])];
  if (!X.length) return err("The model has no regressor (no endogenous regressor, no exogenous regressor and no constant).");
  let clusters: Int32Array | undefined;
  let G = 0;
  if (cluster && c.clusters) {
    const m = new Map<string, number>();
    clusters = Int32Array.from(c.clusters, (s) => {
      let v = m.get(s);
      if (v === undefined) {
        v = m.size;
        m.set(s, v);
      }
      return v;
    });
    G = m.size;
    if (G < 2) return err(`The cluster column ${q(c.clusterName ?? cluster)} has one cluster; clustering needs at least 2.`);
    if (G <= Z.length) return err(`${G} clusters for ${Z.length} instruments: the clustered moment covariance has rank at most ${G}, so the efficient weight matrix is not defined. Use more clusters, fewer instruments, or the robust weight.`);
  }
  for (const [col, nm] of [[c.y, c.depName], ...c.X.map((x, j) => [x, c.names[j]] as const)] as [Float64Array, string][]) {
    const big = magnitude(col, c.rowNumbers, nm);
    if (big) return err(big);
  }
  // The response must vary.
  if (c.y.every((v) => v === c.y[0])) return err(`The response ${q(c.depName)} is constant in every row used; there is nothing to explain.`);
  let r: LinearGmmResult;
  try {
    r = fitLinearGmm({ y: c.y, X, names, Z, clusters, G, steps: steps === "two" ? 2 : 1 });
  } catch (e) {
    const f = fail(e, "GMM estimate");
    return err(f.text);
  }
  return { r, names, endog, exog, instr, constant, steps: steps as "one" | "two", cluster, clusterName: c.clusterName, G, depName: c.depName, named: data.named, notes: c.notes };
}

export function econGmmCalc(read: Read): StatOutput {
  const fitted = econGmmFitFromRead(read);
  if ("error" in fitted) return refuse(fitted.error);
  const { r, names, endog, exog, instr, constant, steps, cluster, G } = fitted;
  const k1 = endog.length;
  const k2 = exog.length;
  const c = { depName: fitted.depName, clusterName: fitted.clusterName, notes: fitted.notes };
  const data = { named: fitted.named };
  const lines: string[] = [];
  const title = steps === "two" ? "Linear GMM, two-step efficient" : "Linear GMM, one-step (2SLS weight)";
  lines.push(
    `${title}: ${c.depName} on ` +
      [...(k1 ? [`${endog.join(", ")} (instrumented)`] : []), ...(k2 ? [exog.join(", ")] : []), ...(k1 + k2 === 0 ? ["the constant only"] : [])].join(" and ") +
      (k1 ? "" : " (no endogenous regressor)") +
      ` (n = ${intText(r.n)}, ${r.k} coefficient${r.k === 1 ? "" : "s"}, ${r.L} instruments)`,
  );
  lines.push(`Excluded instruments: ${instr.length ? instr.join(", ") : "none"}; the exogenous regressors${constant ? " and the constant" : ""} instrument themselves.`);
  lines.push(`Weight matrix: ${cluster ? `clustered by ${c.clusterName ?? cluster} (${intText(G)} clusters)` : "heteroskedasticity-robust"}; standard errors from the same sandwich, z statistics.`);
  if (r.jdf > 0) {
    lines.push(`Hansen J test of the ${r.jdf} overidentifying restriction${r.jdf === 1 ? "" : "s"} (two-step): J = ${fmtFixed(r.j, 3)}, χ²(${r.jdf}), ${pText(r.jp)}. H₀: every instrument is valid.`);
  } else {
    lines.push("Exactly identified (as many instruments as coefficients): GMM equals 2SLS whatever the weight, and the Hansen J test is not computed (no overidentifying restriction).");
  }
  if (r.singularS) lines.push("The moment covariance S is singular, so its Moore–Penrose inverse was used for the weight matrix; the two-step estimate and J are then fragile.");
  lines.push(
    "Conventions (linearmodels 7.1 IVGMM): step 1 is 2SLS, W₀ = (ZᵀZ/n)⁻¹; step 2 uses W = Ŝ⁻¹ with Ŝ = (1/n) Σ zᵢzᵢᵀûᵢ² from the 2SLS residuals" +
      (cluster ? " (clustered: (1/n) times the sum over clusters of (Σ zᵢûᵢ)(Σ zᵢûᵢ)ᵀ, each sum within a cluster)" : "") +
      "; the covariance is the sandwich (GᵀWG)⁻¹GᵀWŜWG(GᵀWG)⁻¹/n, G = ZᵀX/n, with Ŝ re-estimated at the final residuals and no small-sample factor (debiased = False); " +
      "J = n·ḡᵀWḡ, uncentered, with W from the 2SLS residuals, computed whichever step is reported. One-step GMM with the 2SLS weight is 2SLS with a robust covariance.",
  );
  if (!data.named) lines.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  lines.push("Rows with an empty or NA cell in any column the model uses are dropped (listwise deletion).", ...c.notes);
  const tables: StatTable[] = [
    {
      label: `${title}: ${c.depName}`,
      rows: [["Term", "Coef.", "SE", "z", "p", "95% CI"], ...names.map((nm, j) => coefRow(nm, r.gmm.b[j], r.gmm.se[j]))],
      align: ALIGN6,
    },
    {
      label: "Step 1 (2SLS, robust SEs) beside the reported GMM estimate",
      rows: [["Term", "2SLS", "SE", "GMM", "SE"], ...names.map((nm, j) => [nm, fmtFixed(r.tsls.b[j], D), fmtFixed(r.tsls.se[j], D), fmtFixed(r.gmm.b[j], D), fmtFixed(r.gmm.se[j], D)])],
      align: ["left", "right", "right", "right", "right"],
    },
  ];
  const svg = k1 ? gmmCoefFigure(names.slice(0, k1), r) : undefined;
  return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
}

/** Each endogenous coefficient, 2SLS against GMM, with 95% intervals (plot.buildPlotSvg; no new SVG builder). */
export function gmmCoefFigure(endog: string[], r: LinearGmmResult): string {
  const k = endog.length;
  const a: { x: number; y: number; err: number }[] = [];
  const b: { x: number; y: number; err: number }[] = [];
  endog.forEach((_, j) => {
    a.push({ x: j + 1 - 0.15, y: r.tsls.b[j], err: GMM_Z975 * r.tsls.se[j] });
    b.push({ x: j + 1 + 0.15, y: r.gmm.b[j], err: GMM_Z975 * r.gmm.se[j] });
  });
  const series: Series[] = [
    { type: "scatter", points: a, color: "#64748b", label: "2SLS (step 1)" },
    { type: "scatter", points: b, color: "#0369a1", label: "GMM" },
    { type: "line", points: [{ x: 0.4, y: 0 }, { x: k + 0.6, y: 0 }], color: "#94a3b8" },
  ];
  return buildPlotSvg(series, {
    width: 380,
    height: 250,
    title: "2SLS vs GMM",
    ylabel: "Coefficient",
    errorBars: "ci95",
    xLimits: { min: 0.4, max: k + 0.6 },
    xTickLabel: (v: number) => {
      const j = Math.round(v);
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? endog[j - 1] : "";
    },
    notes: ["Both with robust (sandwich) standard errors and normal intervals, on the same rows."],
  });
}

// ---------------------------------------------------------------------------------------------------- panel-dyn-gmm

/**
 * The default panel: 60 synthetic firms over 2012–2021, y = 0.6·y₋₁ + 0.3·x + η + ε with x an AR(1) independent of η (so it is a valid instrument in levels too), a few
 * rows missing (gaps). A 32-bit LCG (Numerical Recipes constants), normal draws as the sum of 12 uniforms minus 6,
 * values rounded in integers, so scripts/gmm-oracle.py reproduces it bit for bit.
 */
export function dynDefaultTable(): string {
  let state = 19910415;
  const u = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  const gauss = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += u();
    return s - 6;
  };
  const fmt3 = (v: number): string => {
    const kq = Math.floor(v * 1000 + 0.5);
    const sign = kq < 0 ? "-" : "";
    const a = Math.abs(kq);
    return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, "0")}`;
  };
  const lines = ["firm\tyear\tsales\tprice"];
  for (let i = 1; i <= 60; i++) {
    const eta = gauss();
    let x = gauss();
    let y = (eta + 0.3 * x) / (1 - 0.6) + gauss();
    // Burn-in of 5 periods so the start is close to the stationary path.
    for (let t = -5; t < 10; t++) {
      x = 0.5 * x + gauss();
      y = 0.6 * y + 0.3 * x + eta + gauss();
      if (t < 0) continue;
      const xr = fmt3(x);
      const yr = fmt3(y);
      if (t > 0 && u() < 0.04) continue;
      lines.push([`F${String(i).padStart(2, "0")}`, String(2012 + t), yr, xr].join("\t"));
    }
  }
  return lines.join("\n");
}

export const DYN_DEFAULT_TABLE = dynDefaultTable();

interface DynRead {
  data: DynData;
  spec: DynSpec;
  depName: string;
  endog: string[];
  notes: string[];
  entityName: string;
}

const LAG_TERM = /^L(\d*)\.(.+)$/;
const LAG_RANGE = /^L\((\d+)\/(\d+)\)\.(.+)$/;
const MAX_LAG = 3;

/** Reads the fields, the panel (one variable at a time) and the model; a refusal names the field. */
function readDyn(read: Read): DynRead | { error: string } {
  const get = getter(read);
  const est = get("estimator").trim() || "system";
  if (est !== "system" && est !== "difference") return { error: `Estimator: ${q(est)} is not system or difference.` };
  const collapseRaw = get("collapse").trim() || "no";
  if (collapseRaw !== "no" && collapseRaw !== "yes") return { error: `Collapse: ${q(collapseRaw)} is not yes or no.` };
  const tdRaw = get("timeDummies").trim() || "yes";
  if (tdRaw !== "no" && tdRaw !== "yes") return { error: `Time dummies: ${q(tdRaw)} is not yes or no.` };
  const firstRaw = get("lagFirst").trim() || "2";
  if (!/^\d{1,2}$/.test(firstRaw) || Number(firstRaw) < 2 || Number(firstRaw) > 10) {
    return { error: `First instrument lag: ${q(firstRaw)} is not a whole number from 2 to 10 (lag 1 of a level is correlated with the differenced error).` };
  }
  const lagFirst = Number(firstRaw);
  const lastRaw = get("lagLast").trim();
  let lagLast: number | null = null;
  if (lastRaw) {
    if (!/^\d{1,2}$/.test(lastRaw) || Number(lastRaw) < lagFirst || Number(lastRaw) > 40) {
      return { error: `Last instrument lag: ${q(lastRaw)} is not a whole number from the first lag (${lagFirst}) to 40 (blank = every available lag).` };
    }
    lagLast = Number(lastRaw);
  }
  const text = get("data");
  const tooLong = panelTextTooLong(text);
  if (tooLong) return { error: tooLong };
  const parsed = parseRegData(text);
  if (!parsed.ok) return { error: parsed.reason };
  const ds: RegDataset = parsed.data;
  if (ds.rows.length > DPD_MAX_ROWS) return { error: `The table has ${intText(ds.rows.length)} rows; a dynamic panel here is limited to ${intText(DPD_MAX_ROWS)} rows (entity-periods).` };
  const specText = get("spec").trim();
  if (!specText) return { error: "Write the model as “y ~ L.y + x1 + x2” (L.y is the lagged response; L2.x, L(0/2).x for lags)." };
  const parts = specText.split("~");
  if (parts.length !== 2) return { error: `Write the model as “y ~ L.y + x1 + x2” (one ~): ${q(specText)}.` };
  const dj = findColumn(ds.names, parts[0].trim());
  if (typeof dj !== "number") return { error: `Response: ${dj.error}` };
  const depName = ds.names[dj];
  const rawTerms = nameList(parts[1]);
  if (!rawTerms || !rawTerms.length) return { error: `The model ${q(specText)} has an empty term (write at least L.${depName} after the ~).` };
  const terms: DynTerm[] = [];
  const seen = new Set<string>();
  const vars: string[] = [depName];
  const addTerm = (v: string, lag: number, raw: string): string | null => {
    if (lag > MAX_LAG) return `Term ${q(raw)}: lags up to ${MAX_LAG} are allowed.`;
    const j = findColumn(ds.names, v);
    if (typeof j !== "number") return `Term ${q(raw)}: ${j.error}`;
    const name = ds.names[j];
    if (j === dj && lag === 0) return `${q(name)} is the response; on the right of ~ it can only appear lagged (L.${name}).`;
    const key = `${name}|${lag}`;
    if (seen.has(key)) return `Term ${q(raw)} appears twice.`;
    seen.add(key);
    if (!vars.includes(name)) vars.push(name);
    const label = lag === 0 ? name : lag === 1 ? `L.${name}` : `L${lag}.${name}`;
    terms.push({ v: name, lag, kind: j === dj ? "ylag" : "exog", label });
    return null;
  };
  for (const raw of rawTerms) {
    // A column whose name is exactly the term wins over the lag syntax.
    if (typeof findColumn(ds.names, raw) === "number" && ds.names.includes(raw)) {
      const err = addTerm(raw, 0, raw);
      if (err) return { error: err };
      continue;
    }
    let m = LAG_RANGE.exec(raw);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (lo > hi) return { error: `Term ${q(raw)}: write the lag range low to high, as L(0/2).x.` };
      for (let l = lo; l <= hi; l++) {
        const err = addTerm(m[3].trim(), l, raw);
        if (err) return { error: err };
      }
      continue;
    }
    m = LAG_TERM.exec(raw);
    if (m) {
      const err = addTerm(m[2].trim(), m[1] === "" ? 1 : Number(m[1]), raw);
      if (err) return { error: err };
      continue;
    }
    const err = addTerm(raw, 0, raw);
    if (err) return { error: err };
  }
  if (!terms.some((t) => t.kind === "ylag" && t.lag === 1)) {
    return { error: `The model needs the lagged response L.${depName} (that is what makes the panel dynamic); add it after the ~.` };
  }
  // Order: lags of y, then the other terms as typed.
  terms.sort((a, b) => (a.kind === "ylag" ? 0 : 1) - (b.kind === "ylag" ? 0 : 1) || (a.kind === "ylag" ? a.lag - b.lag : 0));
  const endogList = nameList(get("endog"));
  if (!endogList) return { error: "Endogenous regressors: an empty name (two + in a row?)." };
  const endog: string[] = [];
  for (const nm of endogList) {
    const j = findColumn(ds.names, nm);
    if (typeof j !== "number") return { error: `Endogenous regressor: ${j.error}` };
    const name = ds.names[j];
    if (j === dj) return { error: `${q(name)} is the response; its lags get GMM-style instruments already.` };
    if (!terms.some((t) => t.v === name)) return { error: `Endogenous regressor ${q(name)} is not in the model.` };
    if (endog.includes(name)) return { error: `${q(name)} is listed twice as an endogenous regressor.` };
    endog.push(name);
  }
  for (const t of terms) if (endog.includes(t.v)) t.kind = "endog";
  // The panel, one variable at a time.
  const entity = get("entity");
  const time = get("time");
  const notes: string[] = [];
  const entIndex = new Map<string, number>();
  const entNames: string[] = [];
  const perVar = new Map<string, { ent: number; per: number; v: number }[]>();
  let kind = "";
  let entityName = "";
  let timeName = "";
  const labelOfPer = new Map<number, string>();
  for (const v of vars) {
    const pr = readPanel(ds, { spec: { dep: v, preds: [], text: v }, entity, time });
    if (!pr.ok) return { error: pr.reason };
    const p = pr.panel;
    entityName = p.entityName;
    timeName = p.timeName;
    // Period numbers from the time labels: whole numbers as they are; quarters and months counted consecutively.
    const perOf: number[] = [];
    for (const lab of p.timeLabels) {
      let per: number;
      let k: string;
      if (/^[-−]?\d{1,9}$/.test(lab)) {
        per = Number(lab.replace("−", "-"));
        k = "whole";
      } else {
        const tok = readDateToken(lab, true);
        if (!tok || "error" in tok) return { error: `Time column: ${q(lab)} is not a period.` };
        const c = civilFromDay(tok.from);
        if (tok.period === "quarter") {
          per = c.y * 4 + Math.floor((c.m - 1) / 3);
          k = "quarter";
        } else if (tok.period === "month") {
          per = c.y * 12 + c.m - 1;
          k = "month";
        } else if (tok.period === "year") {
          per = c.y;
          k = "whole";
        } else {
          return { error: `Time column ${q(p.timeName)} holds dates (${q(lab)}); a dynamic panel needs periods: years, quarters (2024 Q1), months (2024-03) or period numbers.` };
        }
      }
      if (kind && k !== kind) return { error: `Time column ${q(p.timeName)} mixes kinds of period.` };
      kind = k;
      perOf.push(per);
      if (!labelOfPer.has(per)) labelOfPer.set(per, lab.replace(/^-/, "−"));
    }
    const obs: { ent: number; per: number; v: number }[] = [];
    for (let i = 0; i < p.n; i++) {
      const nm = p.entityNames[p.entity[i]];
      let e = entIndex.get(nm);
      if (e === undefined) {
        e = entNames.length;
        entIndex.set(nm, e);
        entNames.push(nm);
      }
      obs.push({ ent: e, per: perOf[p.time[i]], v: p.y[i] });
    }
    const big = magnitude(p.y, p.rowNumbers, v);
    if (big) return { error: big };
    perVar.set(v, obs);
    const missing = ds.rows.length - p.n;
    if (missing > 0) notes.push(`${q(v)}: ${intText(missing)} row${missing === 1 ? "" : "s"} with no value (or no entity or time) left out of its series.`);
  }
  let pmin = Infinity;
  let pmax = -Infinity;
  for (const obs of perVar.values())
    for (const o of obs) {
      if (o.per < pmin) pmin = o.per;
      if (o.per > pmax) pmax = o.per;
    }
  const T = pmax - pmin + 1;
  if (!(T >= 1) || T > DPD_MAX_PERIODS) {
    return { error: `The time column spans ${Number.isFinite(T) ? intText(T) : "too many"} periods from first to last (gaps included); this calculator allows ${DPD_MAX_PERIODS}.` };
  }
  const N = entNames.length;
  if (N > DPD_MAX_GROUPS) return { error: `The panel has ${intText(N)} entities; this calculator allows ${intText(DPD_MAX_GROUPS)}.` };
  const series = new Map<string, Float64Array[]>();
  for (const [v, obs] of perVar) {
    const arr = Array.from({ length: N }, () => new Float64Array(T).fill(NaN));
    for (const o of obs) arr[o.ent][o.per - pmin] = o.v;
    series.set(v, arr);
  }
  // A constant response is refused here (its differences are all zero).
  {
    let first = NaN;
    let varies = false;
    for (const arr of series.get(depName)!)
      for (const v of arr) {
        if (Number.isNaN(v)) continue;
        if (Number.isNaN(first)) first = v;
        else if (v !== first) varies = true;
      }
    if (!varies) return { error: `The response ${q(depName)} is constant; there is nothing to explain.` };
  }
  const periodLabels = Array.from({ length: T }, (_, i) => labelOfPer.get(pmin + i) ?? (kind === "whole" ? String(pmin + i).replace(/^-/, "−") : `period ${i + 1}`));
  return {
    data: { series, N, T, periodLabels, timeName },
    spec: {
      y: depName,
      terms,
      gmmVars: [depName, ...endog],
      lagFirst,
      lagLast,
      system: est === "system",
      timeDummies: tdRaw === "yes",
      collapse: collapseRaw === "yes",
    },
    depName,
    endog,
    notes,
    entityName,
  };
}

export interface DynResult {
  r: DynRead;
  des: DynDesign;
  fit: DynFit;
  twoStep: boolean;
}

/** The fit behind panel-dyn-gmm (tests read it). */
export function dynFitFromRead(read: Read): DynResult | { error: string } {
  const r = readDyn(read);
  if ("error" in r) return r;
  const stepsRaw = getter(read)("steps").trim() || "two";
  if (stepsRaw !== "one" && stepsRaw !== "two") return { error: `Steps: ${q(stepsRaw)} is not one or two.` };
  try {
    const des = buildDynamic(r.data, r.spec);
    const fit = fitDynamic(des);
    if (stepsRaw === "two" && !fit.two) return { error: `Two-step GMM: ${fit.twoWhy}.` };
    return { r, des, fit, twoStep: stepsRaw === "two" };
  } catch (e) {
    if (e instanceof GmmRefusal) return { error: e.message };
    return { error: `The dynamic panel could not be estimated for these data (${(e as Error).message}).` };
  }
}

export function panelDynGmmCalc(read: Read): StatOutput {
  const res = dynFitFromRead(read);
  if ("error" in res) return refuse(res.error);
  const { r, des, fit, twoStep } = res;
  const st = twoStep && fit.two ? fit.two : fit.one;
  const sys = r.spec.system;
  const estName = sys ? "System GMM (Blundell–Bond)" : "Difference GMM (Arellano–Bond)";
  const lines: string[] = [];
  const pg = des.perGroup;
  lines.push(
    `${estName}, ${twoStep ? "two-step" : "one-step"}: ${r.depName} on ${des.names.filter((_, j) => des.kinds[j] !== "dummy" && des.kinds[j] !== "constant").join(", ")}` +
      `${r.spec.timeDummies ? " and time dummies" : ""}${sys ? " with a constant" : ""}.`,
  );
  lines.push(
    `${intText(fit.nObs)} observations (${sys ? "level rows; " + intText(des.nDiff) + " differenced rows are stacked with them" : "differenced rows"}), ${intText(fit.N)} groups ` +
      `(${r.entityName}), observations per group: min ${pg.min}, mean ${fmtFixed(pg.avg, 2)}, max ${pg.max}. Instruments: ${intText(fit.L)}.`,
  );
  const lagText = r.spec.lagLast === null ? `lags ${r.spec.lagFirst} and earlier` : r.spec.lagFirst === r.spec.lagLast ? `lag ${r.spec.lagFirst}` : `lags ${r.spec.lagFirst} to ${r.spec.lagLast}`;
  lines.push(
    `GMM-style instruments (${r.spec.collapse ? "collapsed, one column per lag" : "one column per period and lag"}): ${lagText} of ${r.spec.gmmVars.join(", ")} for the differenced equation` +
      (sys ? `; the difference dated ${r.spec.lagFirst - 1} ${r.spec.lagFirst - 1 === 1 ? "period" : "periods"} back for the level equation` : "") +
      `. Exogenous regressors instrument themselves${sys ? " (difference in the differenced rows, level in the level rows)" : " in differences"}.`,
  );
  if (fit.L > fit.N) {
    lines.push(
      `Warning: ${intText(fit.L)} instruments exceed the ${intText(fit.N)} groups. Too many instruments overfit the endogenous variables (biasing GMM toward OLS or fixed effects) and weaken the Hansen test, ` +
        "whose p-value can then be implausibly close to 1 (Roodman 2009). Choose “collapse” or a last lag.",
    );
  }
  // Tests.
  const arText = (a: { order: number; z: number; p: number; why?: string }): string =>
    a.why ? `AR(${a.order}) not computed (${a.why})` : `AR(${a.order}) z = ${fmtFixed(a.z, 2)}, ${pText(a.p)}`;
  lines.push(`Arellano–Bond tests on the differenced residuals: ${st.ar.map(arText).join("; ")}. ` +
      (r.spec.lagFirst === 2
        ? "AR(1) is expected; AR(2) rejecting means the errors in levels are serially correlated, so lag 2 instruments are invalid (start the instruments at lag 3)."
        : `AR(1) is expected; with the instruments starting at lag ${r.spec.lagFirst}, AR(2) is tolerated (MA(1) errors in levels), but AR(${r.spec.lagFirst}) would invalidate them, and only AR(1) and AR(2) are computed here.`));
  if (fit.df > 0) {
    lines.push(
      `Sargan χ²(${fit.df}) = ${fmtFixed(fit.sargan, 2)}, ${pText(fit.sarganP)} (not robust, not weakened by many instruments); ` +
        (fit.two
          ? `Hansen χ²(${fit.df}) = ${fmtFixed(fit.hansen, 2)}, ${pText(fit.hansenP)} (robust, from the two-step estimate, weakened by many instruments). H₀: the instruments are valid.`
          : `Hansen J not computed: ${fit.twoWhy}. H₀: the instruments are valid.`),
    );
  } else lines.push("Exactly identified (as many instruments as coefficients): the Sargan and Hansen tests are not computed.");
  // The Nickell bracket on ρ.
  const ylag = des.names.indexOf(r.spec.terms.find((t) => t.kind === "ylag" && t.lag === 1)!.label);
  const cmp = comparison(r, fit, twoStep, ylag);
  const rhoLabel = des.names[ylag];
  const ols = cmp.find((c) => c.key === "ols");
  const fe = cmp.find((c) => c.key === "fe");
  const mine = cmp.find((c) => c.key === (sys ? "sys" : "diff"))!;
  if (ols?.b !== undefined && fe?.b !== undefined) {
    const inside = fe.b < mine.b! && mine.b! < ols.b;
    lines.push(
      `Bracket check on the coefficient of ${rhoLabel}: fixed effects ${fmtFixed(fe.b, 3)} (biased down, Nickell 1981) and pooled OLS ${fmtFixed(ols.b, 3)} (biased up by the fixed effect) ` +
        (inside ? `bracket the GMM estimate ${fmtFixed(mine.b!, 3)}, as a consistent estimate should.` : `do not bracket the GMM estimate ${fmtFixed(mine.b!, 3)}: suspect weak or invalid instruments (or a misspecified model).`),
    );
  }
  if (des.droppedDummies.length) lines.push(`Time dummies dropped (no rows, or collinear with the others${sys ? " and the constant" : ""}): ${des.droppedDummies.join(", ")}.`);
  if (des.emptyGroups) lines.push(`${intText(des.emptyGroups)} entit${des.emptyGroups === 1 ? "y has" : "ies have"} no usable row (too few consecutive periods for the lags) and ${des.emptyGroups === 1 ? "is" : "are"} left out.`);
  if (fit.singularS) lines.push("The two-step moment covariance is singular (common when instruments approach the number of groups); its Moore–Penrose inverse was used, as xtabond2 does. The two-step estimates, their SEs and Hansen J then depend on how that inverse is taken (different software can disagree widely) and should not be relied on: collapse the instruments or set a last lag.");
  lines.push(
    "Conventions (Roodman's xtabond2): " +
      (sys
        ? "one-step weight (Σ ZᵢᵀHᵢZᵢ)⁺ with H = M⁺M⁺ᵀ, M⁺ = [first-difference matrix; identity] (xtabond2's default h(3)); time dummies and the constant instrument the level equation only (ivstyle(…, equation(level))); "
        : "one-step weight (Σ ZᵢᵀHᵢZᵢ)⁺ with H = 2 on the diagonal and −1 between consecutive periods; time dummies enter differenced, as regressors and instruments; ") +
      "GMM-style instruments are “missing = 0”; collinear time dummies are dropped from the last; " +
      (twoStep
        ? "two-step weight (Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ)⁺ and Windmeijer (2005) corrected standard errors; "
        : "one-step standard errors are the Arellano–Bond cluster-robust sandwich (xtabond2's robust); ") +
      `z statistics and normal intervals, no small-sample factor (Stata's “small” would multiply the SEs by √((n − 1)/(n − k)·G/(G − 1)) and use t, n the observations). ` +
      `Sargan = g₁ᵀA₁g₁/σ̂² from the one-step residuals with σ̂² = ΣΔû²/(2n); Hansen J is the two-step criterion, printed after one-step too; AR tests use the reported step's residuals and covariance. ` +
      `The observation count is ${sys ? "the level rows (xtabond2's convention for system GMM; pydynpd prints the differenced rows)" : "the differenced rows"}. ` +
      "Instruments are counted after dropping linearly dependent columns; a singular weight is inverted by Moore–Penrose. " +
      "pydynpd 0.2.2 agrees on coefficients, two-step SEs, Hansen J and two-step AR tests, but parameterizes time dummies by dropping the first (other coefficients are the same), instruments system-GMM time dummies in both equations, and its one-step AR statistic uses the two-step moment vector (Roodman's formula, used here, reproduces the published one-step values)" +
      (sys && r.spec.lagFirst > 2
        ? `; with a first lag of ${r.spec.lagFirst}, pydynpd also starts the level equation at the first period whose level instrument (dated ${r.spec.lagFirst - 1} back) exists, while xtabond2 and this calculator keep those rows with the instrument set to 0, so the samples differ.`
        : "."),
  );
  lines.push(...r.notes);
  const seLab = twoStep ? "Windmeijer SE" : "Robust SE";
  const tables: StatTable[] = [
    {
      label: `${estName}, ${twoStep ? "two-step" : "one-step"}: ${r.depName}`,
      rows: [["Term", "Coef.", seLab, "z", "p", "95% CI"], ...des.names.map((nm, j) => coefRow(nm, st.b[j], st.se[j]))],
      align: ALIGN6,
      note: `${intText(fit.nObs)} observations, ${intText(fit.N)} groups, ${intText(fit.L)} instruments.`,
    },
  ];
  const testRows: string[][] = [["Test", "Statistic", "df", "p", "Note"]];
  for (const a of st.ar) testRows.push([`Arellano–Bond AR(${a.order})`, a.why ? "not computed" : `z = ${fmtFixed(a.z, 2)}`, "", a.why ? "not computed" : fmtP(a.p), a.why ?? (a.order === 1 ? "expected to reject" : r.spec.lagFirst === 2 ? "should not reject" : `tolerated: instruments start at lag ${r.spec.lagFirst}`)]);
  if (fit.df > 0) {
    testRows.push(["Sargan", `χ² = ${fmtFixed(fit.sargan, 2)}`, String(fit.df), fmtP(fit.sarganP), "one-step, not robust"]);
    testRows.push(
      fit.two
        ? ["Hansen J", `χ² = ${fmtFixed(fit.hansen, 2)}`, String(fit.df), fmtP(fit.hansenP), "two-step, robust"]
        : ["Hansen J", "not computed", String(fit.df), "not computed", "two-step not identified"],
    );
  }
  tables.push({ label: "Specification tests", rows: testRows, align: ["left", "right", "right", "right", "left"] });
  const cmpRows: string[][] = [["Estimator", `${rhoLabel}`, "SE", "95% CI", "Note"]];
  for (const c of cmp) {
    if (c.b === undefined || c.se === undefined) cmpRows.push([c.name, "not computed", "", "", c.note]);
    else cmpRows.push([c.name, fmtFixed(c.b, D), fmtFixed(c.se, D), ci(c.b - GMM_Z975 * c.se, c.b + GMM_Z975 * c.se), c.note]);
  }
  tables.push({ label: `The coefficient of ${rhoLabel} by estimator (the Nickell bracket)`, rows: cmpRows, align: ["left", "right", "right", "right", "left"] });
  const svg = rhoFigure(cmp, rhoLabel);
  return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
}

interface CmpRow {
  key: "ols" | "fe" | "diff" | "sys";
  name: string;
  b?: number;
  se?: number;
  note: string;
}

function comparison(r: DynRead, fit: DynFit, twoStep: boolean, ylag: number): CmpRow[] {
  const out: CmpRow[] = [];
  const ols = olsFeOnLevels(r.data, r.spec, false);
  out.push({ key: "ols", name: "Pooled OLS", b: ols?.b, se: ols?.se, note: ols ? "biased up" : "not estimable" });
  const fe = olsFeOnLevels(r.data, r.spec, true);
  out.push({ key: "fe", name: "Fixed effects", b: fe?.b, se: fe?.se, note: fe ? "biased down" : "not estimable" });
  const step = twoStep ? "two-step" : "one-step";
  const mineKey = r.spec.system ? "sys" : "diff";
  const st = twoStep && fit.two ? fit.two : fit.one;
  const mine: CmpRow = { key: mineKey, name: r.spec.system ? "System GMM" : "Difference GMM", b: st.b[ylag], se: st.se[ylag], note: `${step}, reported` };
  let other: CmpRow;
  try {
    const spec2: DynSpec = { ...r.spec, system: !r.spec.system };
    const des2 = buildDynamic(r.data, spec2);
    const f2 = fitDynamic(des2);
    const j = des2.names.indexOf(r.spec.terms.find((t) => t.kind === "ylag" && t.lag === 1)!.label);
    const s2 = twoStep ? f2.two : f2.one;
    if (!s2) throw new GmmRefusal("two-step not identified");
    other = { key: spec2.system ? "sys" : "diff", name: spec2.system ? "System GMM" : "Difference GMM", b: s2.b[j], se: s2.se[j], note: `${step}, same options` };
  } catch (e) {
    other = { key: r.spec.system ? "diff" : "sys", name: r.spec.system ? "Difference GMM" : "System GMM", note: e instanceof GmmRefusal ? "not estimable with these options" : "not computed" };
  }
  out.push(...(r.spec.system ? [other, mine] : [mine, other]));
  return out;
}

/** ρ by estimator with 95% intervals (plot.buildPlotSvg; no new SVG builder), or null when fewer than two are estimable. */
export function rhoFigure(cmp: { name: string; b?: number; se?: number }[], rhoLabel: string): string | null {
  const pts = cmp.map((c, i) => ({ c, x: i + 1 })).filter((o) => o.c.b !== undefined && o.c.se !== undefined);
  if (pts.length < 2) return null;
  const short: Record<string, string> = { "Pooled OLS": "OLS", "Fixed effects": "FE", "Difference GMM": "Diff. GMM", "System GMM": "Sys. GMM" };
  const k = cmp.length;
  const series: Series[] = [
    { type: "scatter", points: pts.filter((o) => o.c.name.includes("GMM")).map((o) => ({ x: o.x, y: o.c.b!, err: GMM_Z975 * o.c.se! })), color: "#0369a1", label: "GMM" },
    { type: "scatter", points: pts.filter((o) => !o.c.name.includes("GMM")).map((o) => ({ x: o.x, y: o.c.b!, err: GMM_Z975 * o.c.se! })), color: "#64748b", label: "OLS and FE (bounds)" },
  ];
  return buildPlotSvg(series, {
    width: 400,
    height: 260,
    title: `Coefficient of ${rhoLabel} by estimator`,
    ylabel: "Coefficient",
    errorBars: "ci95",
    xLimits: { min: 0.4, max: k + 0.6 },
    xTickLabel: (v: number) => {
      const j = Math.round(v);
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? short[cmp[j - 1].name] ?? cmp[j - 1].name : "";
    },
    notes: ["A consistent GMM estimate should lie between fixed effects (biased down) and pooled OLS (biased up). OLS and FE: cluster-robust by entity."],
  });
}

// ---------------------------------------------------------------------------------------------------- registry

const YES_NO = (yesLabel: string, noLabel: string): { value: string; label: string }[] => [
  { value: "yes", label: yesLabel },
  { value: "no", label: noLabel },
];

export const GMM_STAT_CALCS: StatCalcDef[] = [
  {
    id: "econ-gmm",
    name: "GMM: one- or two-step efficient IV (Hansen J)",
    fields: [
      { key: "data", label: "Data table: a header row of column names, then one row per observation", default: ivDefaultTable(), kind: "block" },
      { key: "spec", label: "Model: y ~ exogenous regressors (nothing after ~ = the constant only)", default: "lwage ~ exper", kind: "text" },
      { key: "endog", label: "Endogenous regressors (names, separated by +)", default: "educ", kind: "text" },
      { key: "instruments", label: "Excluded instruments (names, separated by +)", default: "dist + sibs", kind: "text" },
      { key: "constant", label: "Constant", default: "yes", kind: "select", options: YES_NO("Include a constant", "No constant") },
      { key: "steps", label: "Estimator", default: "two", kind: "select", options: GMM_STEPS_OPTIONS },
      {
        key: "weight",
        label: "Weight matrix and standard errors",
        default: "robust",
        kind: "select",
        options: [
          { value: "robust", label: "Heteroskedasticity-robust" },
          { value: "cluster", label: "Clustered (name the column below)" },
        ],
      },
      { key: "cluster", label: "Cluster column (for a clustered weight)", default: "", kind: "text" },
    ],
    compute: (r) => {
      // Linear GMM as linearmodels IVGMM: 2SLS first step, efficient second step, sandwich covariance, Hansen J.
      return econGmmCalc(r);
    },
  },
  {
    id: "panel-dyn-gmm",
    name: "Dynamic panel GMM: Arellano–Bond / Blundell–Bond",
    fields: [
      { key: "data", label: "Panel table, one row per entity and period (header row of names)", default: DYN_DEFAULT_TABLE, kind: "block" },
      { key: "spec", label: "Model: y ~ L.y + regressors (L2.x, L(0/2).x for lags)", default: "sales ~ L.sales + price", kind: "text" },
      { key: "entity", label: "Entity column", default: "firm", kind: "text" },
      { key: "time", label: "Time column (years, period numbers, quarters such as 2024 Q1, or months)", default: "year", kind: "text" },
      { key: "endog", label: "Endogenous regressors, GMM-style instruments (names, separated by +; blank = all exogenous)", default: "", kind: "text" },
      {
        key: "estimator",
        label: "Estimator",
        default: "system",
        kind: "select",
        options: [
          { value: "system", label: "System GMM (Blundell–Bond)" },
          { value: "difference", label: "Difference GMM (Arellano–Bond)" },
        ],
      },
      { key: "steps", label: "Steps", default: "two", kind: "select", options: [{ value: "two", label: "Two-step, Windmeijer-corrected SEs" }, { value: "one", label: "One-step, robust SEs" }] },
      { key: "lagFirst", label: "First lag of the GMM-style instruments (2 = standard)", default: "2", kind: "text" },
      { key: "lagLast", label: "Last lag of the GMM-style instruments (blank = all available)", default: "4", kind: "text" },
      { key: "collapse", label: "Collapse the GMM-style instruments", default: "no", kind: "select", options: YES_NO("Collapse (one column per lag)", "No (one column per period and lag)") },
      { key: "timeDummies", label: "Time dummies", default: "yes", kind: "select", options: YES_NO("Include time dummies", "No time dummies") },
    ],
    compute: (r) => {
      // Difference or system GMM for a dynamic panel: one/two-step, Windmeijer SEs, AR, Sargan, Hansen, ρ bracket.
      return panelDynGmmCalc(r);
    },
  },
];
