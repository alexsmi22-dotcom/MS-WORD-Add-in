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
import { readPanel } from "./panelData";
import { readDateToken, civilFromDay } from "./damagesInterest";
import { fmtFixed, fmtP, fmtSci, intText, numText, P_BELOW } from "./regTable";
import { buildPlotSvg, type Series } from "./plot";
import { chiSquareP } from "./stats2";
import { ivDefaultTable } from "./ivCalcs";
import {
  buildDynamic,
  checkPlan,
  planDynamic,
  plural,
  DPD_MAX_PAIR_WORK,
  fewGroupsReason,
  lgmmWork,
  LGMM_MAX_CELLS,
  LGMM_MAX_COLUMNS,
  LGMM_MAX_WORK,
  DPD_MAX_CELLS,
  DPD_READ_COST,
  type DynPlan,
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
/** Fixed decimals with a true minus and no "−0" (toFixed never switches to exponents below 10²¹). */
function fixedText(v: number, d: number): string {
  let s = v.toFixed(d);
  if (/^-0(?:\.0*)?$/.test(s)) s = s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
/**
 * A coefficient or standard error: four decimals from 0.01 up (at least three significant figures), three significant
 * figures below (0.000912, never "0.0009"), m×10ⁿ below 10⁻⁴.
 */
export function coefText(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a === 0 || a >= 0.01) return fmtFixed(v, D);
  if (a >= 1e-4) return fixedText(v, 2 - Math.floor(Math.log10(a)));
  return fmtSci(v, 3);
}
/**
 * "a to b" (the word, never a dash that could read as a minus), both bounds in one format: four decimals when the
 * larger bound is at least 0.01, else as many decimals as give the larger bound three significant figures, or m×10ⁿ
 * for both when it is below 10⁻⁴.
 */
export function ci(lo: number, hi: number): string {
  const m = Math.max(Math.abs(lo), Math.abs(hi));
  // One format for the pair: fmtFixed alone would print a bound below 5×10⁻⁵ (an interval ending near 0) as m×10ⁿ.
  if (m >= 1e9) return `${fmtSci(lo, 4)} to ${fmtSci(hi, 4)}`;
  if (!(m < 0.01)) return `${Math.abs(lo) < 5e-5 ? fixedText(lo, D) : fmtFixed(lo, D)} to ${Math.abs(hi) < 5e-5 ? fixedText(hi, D) : fmtFixed(hi, D)}`;
  if (m >= 1e-4) {
    const d = 2 - Math.floor(Math.log10(m));
    return `${fixedText(lo, d)} to ${fixedText(hi, d)}`;
  }
  return `${fmtSci(lo, 3)} to ${fmtSci(hi, 3)}`;
}
function coefRow(name: string, b: number, se: number): string[] {
  const z = b / se;
  // Two-sided normal p as P(χ²₁ > z²): the upper tail keeps its precision far out (1 − Φ would cancel).
  const p = chiSquareP(z * z, 1);
  return [name, coefText(b), coefText(se), Number.isFinite(z) ? fmtFixed(z, 2) : "not computed", Number.isFinite(z) ? fmtP(p) : "not computed", ci(b - GMM_Z975 * se, b + GMM_Z975 * se)];
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
/**
 * A refusal when the pasted table has more data rows than maxRows or (rows × header cells) more than maxCells, counted
 * before parsing so the refusal costs one pass over the text; else null. The header's cells are counted by the
 * delimiter parseRegData would pick (tab anywhere, else a comma or semicolon in the header, else spaces); a header
 * that fools the estimate is still bounded by the row cap and by the checks after parsing.
 */
function tableTooBig(text: string, maxRows: number, maxCells: number, what: string): string | null {
  let lines = 0;
  let inLine = false;
  let firstEnd = -1;
  let firstStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 || ch === 13) {
      if (inLine && firstEnd < 0) firstEnd = i;
      inLine = false;
    } else if (!inLine && ch !== 32 && ch !== 9) {
      inLine = true;
      if (firstStart < 0) firstStart = i;
      lines++;
      if (lines > maxRows + 1) return `The table has more than ${intText(maxRows)} rows; ${what} here is limited to ${intText(maxRows)} rows.`;
    }
  }
  if (firstStart < 0) return null;
  const header = text.slice(firstStart, firstEnd < 0 ? text.length : firstEnd).trim();
  const cells = text.includes("\t") ? header.split("\t").length : /[,;]/.test(header) ? header.split(/[,;]/).length : header.split(/\s+/).length;
  const total = (lines - 1) * cells;
  if (total > maxCells) {
    return `The table has ${intText(lines - 1)} rows × ${intText(cells)} columns = ${intText(total)} cells; ${what} here reads at most ${intText(maxCells)} cells in the task pane. Paste only the columns the model uses.`;
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
  const big0 = tableTooBig(get("data"), LGMM_MAX_ROWS, LGMM_MAX_CELLS, "GMM");
  if (big0) return err(big0);
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
  if (data.rows.length * data.names.length > LGMM_MAX_CELLS) {
    return err(`The table has ${intText(data.rows.length * data.names.length)} cells; GMM here reads at most ${intText(LGMM_MAX_CELLS)} cells in the task pane. Paste only the columns the model uses.`);
  }
  // Distinct columns: each variable counts once (an exogenous regressor is in X and in Z, but it is one column).
  const nCols = endog.length + exog.length + instr.length + (constant ? 1 : 0);
  if (nCols > LGMM_MAX_COLUMNS) {
    return err(`${endog.length} endogenous, ${exog.length} exogenous and ${instr.length} excluded ${plural(instr.length, "instrument")}${constant ? " with the constant" : ""} is ${nCols} columns; this calculator allows ${LGMM_MAX_COLUMNS}.`);
  }
  {
    const L0 = instr.length + exog.length + (constant ? 1 : 0);
    const k0 = endog.length + exog.length + (constant ? 1 : 0);
    const n0 = data.rows.length;
    if (lgmmWork(n0, k0, L0, endog.length) > LGMM_MAX_WORK) {
      return err(`${intText(n0)} rows with ${L0} ${plural(L0, "instrument")} is beyond the work this calculator allows in the task pane (about ${intText(Math.floor((n0 * LGMM_MAX_WORK) / lgmmWork(n0, k0, L0, endog.length)))} rows for this model).`);
    }
  }
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
    const few = fewGroupsReason(G, X.length, "cluster");
    if (few) return err(`The cluster column ${q(c.clusterName ?? cluster)}: ${few}`);
  }
  for (const [col, nm] of [[c.y, c.depName], ...c.X.map((x, j) => [x, c.names[j]] as const)] as [Float64Array, string][]) {
    const big = magnitude(col, c.rowNumbers, nm);
    if (big) return err(big);
  }
  // The response must vary.
  if (c.y.every((v) => v === c.y[0])) return err(`The response ${q(c.depName)} is constant in every row used; there is nothing to explain.`);
  let r: LinearGmmResult;
  try {
    const zNames = [...c.names.slice(k1 + k2), ...c.names.slice(k1, k1 + k2), ...(constant ? ["Constant"] : [])];
    r = fitLinearGmm({ y: c.y, X, names, Z, clusters, G, steps: steps === "two" ? 2 : 1, nEndog: k1, nExcluded: instr.length, yName: q(c.depName), zNames });
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
      ` (n = ${intText(r.n)}, ${r.k} ${plural(r.k, "coefficient")}, ${r.L} ${plural(r.L, "instrument")})`,
  );
  lines.push(`Excluded instruments: ${instr.length ? instr.join(", ") : "none"}; the exogenous regressors${constant ? " and the constant" : ""} instrument themselves.`);
  lines.push(`Weight matrix: ${cluster ? `clustered by ${c.clusterName ?? cluster} (${intText(G)} clusters)` : "heteroskedasticity-robust"}; standard errors from the same sandwich, z statistics.`);
  if (r.jdf > 0 && Number.isFinite(r.j)) {
    lines.push(`Hansen J test of the ${r.jdf} overidentifying restriction${r.jdf === 1 ? "" : "s"} (two-step): J = ${fmtFixed(r.j, 3)}, χ²(${r.jdf}), ${pText(r.jp)}. H₀: every instrument is valid.`);
    if (r.jp > 0.99) lines.push(`Caution: a J p-value above 0.99 is more often a sign that the test has lost power (many instruments for the ${cluster ? "clusters" : "rows"}) than of valid instruments.`);
  } else if (r.jdf > 0) {
    lines.push(`Hansen J test not computed: ${r.jWhy}.`);
  } else {
    lines.push("Exactly identified (as many instruments as coefficients): GMM equals 2SLS whatever the weight, and the Hansen J test is not computed (no overidentifying restriction).");
  }
  if (r.singularS) lines.push("The moment covariance S is singular, so the generalized inverse of its unit-diagonal scaling was used for the weight matrix; the two-step estimate and J are then fragile.");
  for (const f of r.firstStage) {
    lines.push(
      `First stage of ${f.name} on the ${f.df} excluded instrument${f.df === 1 ? "" : "s"}: partial R² = ${fmtFixed(f.partialR2, 3)}, ${cluster ? "clustered" : "robust"} Wald χ²(${f.df}) = ${fmtFixed(f.wald, 2)}, ${pText(f.p)}` +
        (f.df > 1 ? ` (its F form, Wald/${f.df}, is ${fmtFixed(f.wald / f.df, 2)})` : " (with one instrument it equals its F form)") +
        ". Rules of thumb such as F above 10 were derived for homoskedastic errors; a small partial R² means weak instruments and a GMM estimate biased toward OLS.",
    );
  }
  lines.push(
    "Conventions (linearmodels 7.1 IVGMM): step 1 is 2SLS, W₀ = (ZᵀZ/n)⁻¹; step 2 uses W = Ŝ⁻¹ with Ŝ = (1/n) Σ zᵢzᵢᵀûᵢ² from the 2SLS residuals" +
      (cluster ? " (clustered: (1/n) times the sum over clusters of (Σ zᵢûᵢ)(Σ zᵢûᵢ)ᵀ, each sum within a cluster)" : "") +
      "; the covariance is the sandwich (GᵀWG)⁻¹GᵀWŜWG(GᵀWG)⁻¹/n, G = ZᵀX/n, with Ŝ re-estimated at the final residuals and no small-sample factor (debiased = False); " +
      "J = n·ḡᵀWḡ, uncentered, with W from the 2SLS residuals, computed whichever step is reported. One-step GMM with the 2SLS weight is 2SLS with a robust covariance. " +
      (constant
        ? "Before any cross-product, the response and every column but the constant lose their means (an exact reparametrization; the constant's estimate and SE are mapped back), and every rank decision and inversion is taken on matrices scaled to a unit diagonal: no result depends on the units of a column, and none but the constant's on a column's location. "
        : "Every rank decision and inversion is taken on matrices scaled to a unit diagonal, so no result depends on the units of a column; without a constant, results do depend on each column's location (the most offset-dominated exogenous column, when there is one, anchors an exact recentering of the others for accuracy). ") +
      "Values more than 10⁸ times their remaining variation are refused by name rather than answered from rounding.",
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
      label: `Step 1 (2SLS, ${cluster ? "clustered" : "robust"} SEs) beside the reported GMM estimate`,
      rows: [["Term", "2SLS", "SE", "GMM", "SE"], ...names.map((nm, j) => [nm, coefText(r.tsls.b[j]), coefText(r.tsls.se[j]), coefText(r.gmm.b[j]), coefText(r.gmm.se[j])])],
      align: ["left", "right", "right", "right", "right"],
    },
  ];
  const svg = k1 ? gmmCoefFigure(names.slice(0, k1), r, cluster ? `clustered by ${c.clusterName ?? cluster}` : "heteroskedasticity-robust") : undefined;
  return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
}

/** Each endogenous coefficient, 2SLS against GMM, with 95% intervals (plot.buildPlotSvg; no new SVG builder). */
export function gmmCoefFigure(endog: string[], r: LinearGmmResult, weight = "heteroskedasticity-robust"): string {
  const k = endog.length;
  // Tick labels must fit their slot (about 6.5 px a character at the tick font over a 300 px plot): longer names are
  // shortened with an ellipsis, and the note lists them in full.
  const maxChars = Math.max(4, Math.floor(300 / (k + 0.2) / 6.5) - 1);
  let tick = endog.map((nm) => (nm.length > maxChars ? `${nm.slice(0, maxChars - 1)}…` : nm));
  // Shortened names that coincide (a shared prefix) fall back to numbers, keyed in the note.
  const numbered = new Set(tick).size < tick.length;
  if (numbered) tick = endog.map((_, j) => String(j + 1));
  const shortened = tick.some((t, j) => t !== endog[j]);
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
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? tick[j - 1] : "";
    },
    notes: [
      `Both with ${weight} (sandwich) standard errors and normal intervals, on the same rows.`,
      ...(numbered ? [`Ticks: ${endog.map((nm, j) => `${j + 1} = ${nm}`).join(", ")}.`] : shortened ? [`Ticks, in order: ${endog.join(", ")}.`] : []),
    ],
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
  /** Cells of the pasted table (rows × columns). */
  nCells: number;
}

// Stata's lag operators: L.x, L2.x, L(0/2).x, in either case and with spaces inside, as Stata reads them.
const LAG_TERM = /^[Ll](\d*)\s*\.\s*(.+)$/;
const LAG_RANGE = /^[Ll]\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*\.\s*(.+)$/;
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
  const tooLong = tableTooBig(text, DPD_MAX_ROWS, DPD_MAX_CELLS, "a dynamic panel");
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
  const ejr = findColumn(ds.names, get("entity"));
  const tjr = findColumn(ds.names, get("time"));
  const ej = typeof ejr === "number" ? ejr : -1;
  const tj = typeof tjr === "number" ? tjr : -1;
  const addTerm = (v: string, lag: number, raw: string): string | null => {
    if (lag > MAX_LAG) return `Term ${q(raw)}: lags up to ${MAX_LAG} are allowed.`;
    const j = findColumn(ds.names, v);
    if (typeof j !== "number") return `Term ${q(raw)}: ${j.error}`;
    const name = ds.names[j];
    if (j === ej) return `${q(name)} is the entity column; it cannot be a regressor.`;
    if (j === tj) return `${q(name)} is the time column; it cannot be a regressor (time dummies are an option; copy the column to a new one for a trend).`;
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
  const perVar = new Map<string, { ent: Int32Array; per: Float64Array; v: Float64Array }>();
  let kind = "";
  let entityName = "";
  let timeName = "";
  const labelOfPer = new Map<number, string>();
  // One read for every variable when no row has a missing cell (the common case; the same values a read per variable
  // gives), else one read per variable, so a missing cell only removes that variable's value.
  type PanelOf = Extract<ReturnType<typeof readPanel>, { ok: true }>["panel"];
  let reads: { v: string; p: PanelOf; y: Float64Array }[] | null = null;
  if (vars.length > 1) {
    const all = readPanel(ds, { spec: { dep: vars[0], preds: vars.slice(1), text: vars.join(" + ") }, entity, time });
    if (all.ok && all.panel.n === ds.rows.length) reads = vars.map((v, j) => ({ v, p: all.panel, y: j === 0 ? all.panel.y : all.panel.X[j - 1] }));
  }
  if (!reads) {
    reads = [];
    for (const v of vars) {
      const pr = readPanel(ds, { spec: { dep: v, preds: [], text: v }, entity, time });
      if (!pr.ok) return { error: pr.reason };
      reads.push({ v, p: pr.panel, y: pr.panel.y });
    }
  }
  let perCache: { p: PanelOf; perOf: number[]; entOf: Int32Array } | null = null;
  for (const { v, p, y: vals } of reads) {
    entityName = p.entityName;
    timeName = p.timeName;
    // Period numbers from the time labels: whole numbers as they are; quarters and months counted consecutively.
    const perOf: number[] = [];
    if (perCache && perCache.p === p) perOf.push(...perCache.perOf);
    else for (const lab of p.timeLabels) {
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
    // Entity numbers by the panel's own entity codes (one Map lookup per entity, not per row).
    const entOf: Int32Array = perCache && perCache.p === p ? perCache.entOf : Int32Array.from(p.entityNames, (nm) => {
      let e = entIndex.get(nm);
      if (e === undefined) {
        e = entNames.length;
        entIndex.set(nm, e);
        entNames.push(nm);
      }
      return e;
    });
    const obs = { ent: new Int32Array(p.n), per: new Float64Array(p.n), v: new Float64Array(p.n) };
    for (let i = 0; i < p.n; i++) {
      obs.ent[i] = entOf[p.entity[i]];
      obs.per[i] = perOf[p.time[i]];
      obs.v[i] = vals[i];
    }
    perCache = { p, perOf, entOf };
    const big = magnitude(vals, p.rowNumbers, v);
    if (big) return { error: big };
    perVar.set(v, obs);
    const missing = ds.rows.length - p.n;
    if (missing > 0) notes.push(`${q(v)}: ${intText(missing)} row${missing === 1 ? "" : "s"} with no value (or no entity or time) left out of its series.`);
  }
  let pmin = Infinity;
  let pmax = -Infinity;
  for (const obs of perVar.values())
    for (let i = 0; i < obs.per.length; i++) {
      if (obs.per[i] < pmin) pmin = obs.per[i];
      if (obs.per[i] > pmax) pmax = obs.per[i];
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
    for (let i = 0; i < obs.v.length; i++) arr[obs.ent[i]][obs.per[i] - pmin] = obs.v[i];
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
    data: { series, N, T, periodLabels, timeName, entityNames: entNames },
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
    nCells: ds.rows.length * ds.names.length,
  };
}

export interface DynResult {
  r: DynRead;
  des: DynDesign;
  fit: DynFit;
  twoStep: boolean;
  /** The other estimator's plan for the ρ comparison, or null with the reason it is not fitted. */
  otherPlan: DynPlan | null;
  otherWhy?: string;
}

/** The fit behind panel-dyn-gmm (tests read it). */
export function dynFitFromRead(read: Read): DynResult | { error: string } {
  const r = readDyn(read);
  if ("error" in r) return r;
  const stepsRaw = getter(read)("steps").trim() || "two";
  if (stepsRaw !== "one" && stepsRaw !== "two") return { error: `Steps: ${q(stepsRaw)} is not one or two.` };
  try {
    // Every cap is checked on the plans, before a row is built.
    const plan = planDynamic(r.data, r.spec);
    checkPlan(plan);
    let otherPlan: DynPlan | null = null;
    let otherWhy: string | undefined;
    try {
      otherPlan = planDynamic(r.data, { ...r.spec, system: !r.spec.system });
      checkPlan(otherPlan);
      if (plan.work + otherPlan.work + DPD_READ_COST * r.nCells > DPD_MAX_PAIR_WORK) {
        otherPlan = null;
        otherWhy = "fitting it too would exceed the task pane's work budget";
      }
    } catch (e) {
      if (!(e instanceof GmmRefusal)) throw e;
      otherPlan = null;
      otherWhy = "not estimable with these options";
    }
    const des = buildDynamic(r.data, r.spec, plan);
    const fit = fitDynamic(des);
    if (stepsRaw === "two" && !fit.two) return { error: `Two-step GMM: ${fit.twoWhy}.` };
    return { r, des, fit, twoStep: stepsRaw === "two", otherPlan, otherWhy };
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
    `${intText(fit.nObs)} ${plural(fit.nObs, "observation")} (${sys ? "level rows; " + intText(des.nDiff) + " differenced rows are stacked with them" : "differenced rows"}), ${intText(fit.N)} ${plural(fit.N, "group")} ` +
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
      `Sargan χ²(${fit.df}) = ${fmtFixed(fit.sargan, 2)}, ${pText(fit.sarganP)} (not robust, not weakened by many instruments` +
        (sys ? "; in system GMM it is not χ² even under homoskedastic errors, because the one-step weight is not the efficient one there, so read its p-value loosely" : "") +
        "); " +
        (fit.two
          ? `Hansen χ²(${fit.df}) = ${fmtFixed(fit.hansen, 2)}, ${pText(fit.hansenP)} (robust, from the two-step estimate, weakened by many instruments). H₀: the instruments are valid.`
          : `Hansen J not computed: ${fit.twoWhy}. H₀: the instruments are valid.`),
    );
    if (fit.two && fit.hansenP > 0.99) {
      lines.push(`Caution: a Hansen p-value above 0.99 is a classic sign of a test weakened by too many instruments (${intText(fit.L)} for ${intText(fit.N)} ${plural(fit.N, "group")}), not evidence of valid instruments (Roodman 2009); collapse the instruments or set a last lag and look again.`);
    }
  } else lines.push("Exactly identified (as many instruments as coefficients): the Sargan and Hansen tests are not computed.");
  // The Nickell bracket on ρ.
  const ylag = des.names.indexOf(r.spec.terms.find((t) => t.kind === "ylag" && t.lag === 1)!.label);
  const cmp = comparison(r, fit, twoStep, ylag, res.otherPlan, res.otherWhy);
  const rhoLabel = des.names[ylag];
  const ols = cmp.find((c) => c.key === "ols");
  const fe = cmp.find((c) => c.key === "fe");
  const mine = cmp.find((c) => c.key === (sys ? "sys" : "diff"))!;
  const nYlags = r.spec.terms.filter((t) => t.kind === "ylag").length;
  if (ols?.b !== undefined && fe?.b !== undefined) {
    const inside = fe.b < mine.b! && mine.b! < ols.b;
    if (nYlags === 1) {
      lines.push(
        `Bracket check on the coefficient of ${rhoLabel}: fixed effects ${fmtFixed(fe.b, 3)} (biased down, Nickell 1981) and pooled OLS ${fmtFixed(ols.b, 3)} (biased up by the fixed effect) ` +
          (inside ? `bracket the GMM estimate ${fmtFixed(mine.b!, 3)}, as a consistent estimate should.` : `do not bracket the GMM estimate ${fmtFixed(mine.b!, 3)}: suspect weak or invalid instruments (or a misspecified model).`),
      );
    } else {
      lines.push(
        `For information, the coefficient of ${rhoLabel}: fixed effects ${fmtFixed(fe.b, 3)}, pooled OLS ${fmtFixed(ols.b, 3)}, GMM ${fmtFixed(mine.b!, 3)} (${inside ? "inside" : "outside"} that range). ` +
          `The bracket rule (fixed effects biased down, OLS biased up) is derived for a single lag of the response; with ${nYlags} lags the biases are shared between the lag coefficients, so a GMM estimate outside the range is not by itself a warning sign.`,
      );
    }
  }
  if (des.droppedDummies.length) lines.push(`Time dummies dropped (no rows, or collinear with the others${sys ? " and the constant" : ""}): ${des.droppedDummies.join(", ")}.`);
  if (des.emptyGroups) lines.push(`${intText(des.emptyGroups)} entit${des.emptyGroups === 1 ? "y has" : "ies have"} no usable row (too few consecutive periods for the lags) and ${des.emptyGroups === 1 ? "is" : "are"} left out.`);
  if (fit.singularA1) {
    lines.push(
      `The one-step weight matrix Σ ZᵢᵀHᵢZᵢ is singular (rank ${intText(fit.rankA1)} for ${intText(fit.L)} instruments), so a generalized inverse was used for it: the one-step estimates and the Sargan statistic then depend on how that inverse is taken. ` +
        "Usually an instrument is (nearly) a combination of the others in the rows the weight is built from (in system GMM, the differenced and level rows together); collapse the instruments or set a last lag.",
    );
  }
  if (fit.singularS) {
    const cause =
      fit.L > fit.N
        ? `there are more instruments (${intText(fit.L)}) than groups (${intText(fit.N)}), and Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ, a sum of one outer product per group, has rank at most the number of groups`
        : `its rank is ${intText(fit.rankS)} for ${intText(fit.L)} instruments although the groups (${intText(fit.N)}) outnumber the instruments: some combination of instruments is (nearly) uncorrelated with the one-step residuals in every group, for example a column that is zero in almost every row`;
    lines.push(
      `The two-step moment covariance is singular: ${cause}. A generalized inverse was used for the two-step weight; the two-step estimates, their SEs and Hansen J then depend on how that inverse is taken (different software can disagree widely) and should not be relied on: collapse the instruments or set a last lag.`,
    );
  }
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
      "Instruments are counted after dropping linearly dependent columns. Before any cross-product the columns are recentered by exact reparametrizations of the regressors and instruments (level rows against the constant; in difference GMM with time dummies, each GMM-style column period by period; otherwise later lags as differences from the first), and every matrix is scaled to a unit diagonal before it is inverted. " +
      "So no result depends on the units of a column, and adding a constant to a column changes nothing where the estimator itself does not depend on it: an exogenous regressor always; the response and the endogenous regressors only with time dummies and no gaps in their histories (otherwise their levels instrument the differenced equation, with 0 where a lag is missing, and the offset genuinely matters). " +
      "Values more than 10⁸ times their remaining variation (3×10⁴ for a level kept as an instrument in a system GMM panel with time dummies and gaps) are refused by name rather than answered from rounding. " +
      "A singular weight is inverted by the Moore–Penrose inverse of that recentered, scaled matrix (xtabond2 and pydynpd invert the raw one, which changes with the units and offsets). The Sargan and Hansen df are L − k, instruments less coefficients, even when the two-step weight is rank-deficient (as xtabond2 reports them). " +
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
      note: `${intText(fit.nObs)} ${plural(fit.nObs, "observation")}, ${intText(fit.N)} ${plural(fit.N, "group")}, ${intText(fit.L)} ${plural(fit.L, "instrument")}.`,
    },
  ];
  const testRows: string[][] = [["Test", "Statistic", "df", "p", "Note"]];
  for (const a of st.ar) testRows.push([`Arellano–Bond AR(${a.order})`, a.why ? "not computed" : `z = ${fmtFixed(a.z, 2)}`, "", a.why ? "not computed" : fmtP(a.p), a.why ?? (a.order === 1 ? "expected to reject" : r.spec.lagFirst === 2 ? "should not reject" : `tolerated: instruments start at lag ${r.spec.lagFirst}`)]);
  if (fit.df > 0) {
    testRows.push(["Sargan", `χ² = ${fmtFixed(fit.sargan, 2)}`, String(fit.df), fmtP(fit.sarganP), "one-step, not robust"]);
    testRows.push(
      fit.two
        ? ["Hansen J", `χ² = ${fmtFixed(fit.hansen, 2)}`, String(fit.df), fmtP(fit.hansenP), "two-step, robust"]
        : ["Hansen J", "not computed", String(fit.df), "not computed", "two-step not computed"],
    );
  }
  tables.push({ label: "Specification tests", rows: testRows, align: ["left", "right", "right", "right", "left"] });
  const cmpRows: string[][] = [["Estimator", `${rhoLabel}`, "SE", "95% CI", "Note"]];
  for (const c of cmp) {
    if (c.b === undefined || c.se === undefined) cmpRows.push([c.name, "not computed", "", "", c.note]);
    else cmpRows.push([c.name, coefText(c.b), coefText(c.se), ci(c.b - GMM_Z975 * c.se, c.b + GMM_Z975 * c.se), c.note]);
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

function comparison(r: DynRead, fit: DynFit, twoStep: boolean, ylag: number, otherPlan: DynPlan | null, otherWhy: string | undefined): CmpRow[] {
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
    if (!otherPlan) throw new GmmRefusal(otherWhy ?? "not estimable with these options");
    const spec2: DynSpec = { ...r.spec, system: !r.spec.system };
    const des2 = buildDynamic(r.data, spec2, otherPlan);
    const f2 = fitDynamic(des2);
    const j = des2.names.indexOf(r.spec.terms.find((t) => t.kind === "ylag" && t.lag === 1)!.label);
    const s2 = twoStep ? f2.two : f2.one;
    if (!s2) throw new GmmRefusal("two-step not identified");
    other = { key: spec2.system ? "sys" : "diff", name: spec2.system ? "System GMM" : "Difference GMM", b: s2.b[j], se: s2.se[j], note: `${step}, same options` };
  } catch (e) {
    other = { key: r.spec.system ? "diff" : "sys", name: r.spec.system ? "Difference GMM" : "System GMM", note: !otherPlan ? otherWhy ?? "not estimable with these options" : e instanceof GmmRefusal ? "not estimable with these options" : "not computed" };
  }
  out.push(...(r.spec.system ? [other, mine] : [mine, other]));
  return out;
}

/** ρ by estimator with 95% intervals (plot.buildPlotSvg; no new SVG builder), or null when fewer than two are estimable. */
export function rhoFigure(cmp: { name: string; b?: number; se?: number; note?: string }[], rhoLabel: string): string | null {
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
      // A tick only where a point is drawn; an estimator not computed is named in the note instead.
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k && cmp[j - 1].b !== undefined && cmp[j - 1].se !== undefined ? short[cmp[j - 1].name] ?? cmp[j - 1].name : "";
    },
    notes: [
      "A consistent GMM estimate should lie between fixed effects (biased down) and pooled OLS (biased up). OLS and FE: cluster-robust by entity.",
      ...cmp.filter((c) => c.b === undefined || c.se === undefined).map((c) => `${c.name}: not computed${"note" in c && c.note ? ` (${c.note})` : ""}.`),
    ],
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
