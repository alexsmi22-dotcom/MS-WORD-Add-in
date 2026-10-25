/**
 * Release E4a calculator, a pure function of the field reader (taskpane.ts declares the fields and calls it):
 *  - iv-2sls  instrumental variables, two-stage least squares (iv.ts): coefficient table, first stage, endogeneity
 *             and overidentification tests, and a figure of the endogenous coefficients, OLS against 2SLS.
 *
 * The worked default is synthetic (a returns-to-schooling design from a fixed-seed 32-bit LCG, exactly reproducible
 * in scripts/econ-iv-oracle.py), so nothing copyrighted ships.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { FittedModel } from "./regModel";
import { fitIv, ivWorkRefusal, type IvFit, type IvSe } from "./iv";
import { fitOls, type SeType } from "./olsInference";
import { parseRegData, findColumn, selectColumns, type RegDataset } from "./regData";
import { fmtFixed, fmtP, intText, P_BELOW, NBSP } from "./regTable";
import { buildPlotSvg, type Series } from "./plot";
import { tCritical } from "./stats";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

export interface IvField {
  key: string;
  label: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

/**
 * The default table: 200 synthetic workers. lwage = 0.8 + 0.09·educ + 0.025·exper + 0.25·ability + noise, with
 * ability unobserved and in educ too (so OLS is biased upward); distance to college (dist, km) and siblings (sibs)
 * shift educ and are excluded from the wage equation. 32-bit LCG (Numerical Recipes constants), normal draws as the
 * sum of 12 uniforms minus 6, every value rounded in integers, so the Python oracle reproduces it bit for bit.
 */
export function ivDefaultTable(): string {
  let state = 20261025;
  const u = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  const gauss = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += u();
    return s - 6;
  };
  const fmt = (k: number, d: number): string => {
    const sign = k < 0 ? "-" : "";
    const a = Math.abs(k);
    if (d === 0) return sign + String(a);
    const p = Math.pow(10, d);
    return `${sign}${Math.floor(a / p)}.${String(a % p).padStart(d, "0")}`;
  };
  const lines = ["lwage\teduc\texper\tdist\tsibs"];
  for (let i = 0; i < 200; i++) {
    const exper = 1 + Math.floor(u() * 25);
    const distT = Math.floor(u() * 500);
    const sibs = Math.floor(u() * 7);
    const ability = gauss();
    const v = gauss();
    const w = gauss();
    const educX = 13.0 - 0.008 * distT - 0.4 * sibs + 0.8 * ability + 0.8 * v;
    const educK = Math.floor(educX * 10 + 0.5);
    const lwX = 0.8 + 0.009 * educK + 0.025 * exper + 0.25 * ability + 0.3 * w;
    const lwK = Math.floor(lwX * 1000 + 0.5);
    lines.push([fmt(lwK, 3), fmt(educK, 1), String(exper), fmt(distT, 1), String(sibs)].join("\t"));
  }
  return lines.join("\n");
}

export const IV_SE_OPTIONS: { value: IvSe; label: string }[] = [
  { value: "classical", label: "Classical (homoskedastic)" },
  { value: "hc0", label: "Robust HC0 (linearmodels' default)" },
  { value: "hc1", label: "Robust HC1 (× n/(n − k))" },
  { value: "cluster", label: "Clustered (name the column below)" },
];

export const IV_2SLS_FIELDS: IvField[] = [
  { key: "data", label: "Data table: a header row of column names, then one row per observation", kind: "block" },
  { key: "spec", label: "Model: y ~ exogenous regressors (nothing after ~ = the constant only)", kind: "text" },
  { key: "endog", label: "Endogenous regressors (names, separated by +)", kind: "text" },
  { key: "instruments", label: "Excluded instruments (names, separated by +)", kind: "text" },
  { key: "constant", label: "Constant", kind: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
  { key: "se", label: "Standard errors", kind: "select", options: IV_SE_OPTIONS },
  { key: "cluster", label: "Cluster column (clustered standard errors)", kind: "text" },
  {
    key: "small",
    label: "Reference distribution",
    kind: "select",
    options: [
      { value: "z", label: "z, large-sample (linearmodels' default)" },
      { value: "t", label: "t, small-sample (linearmodels debiased: n − k)" },
    ],
  },
  { key: "decimals", label: "Decimals", kind: "select", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
];

export const IV_2SLS_DEFAULTS: Record<string, string> = {
  data: ivDefaultTable(),
  spec: "lwage ~ exper",
  endog: "educ",
  instruments: "dist + sibs",
  constant: "yes",
  se: "hc0",
  cluster: "",
  small: "z",
  decimals: "3",
};

/** "a + b", "a, b" → ["a", "b"]; null for an empty term. */
function nameList(text: string): string[] | null {
  const t = text.trim();
  if (!t) return [];
  const parts = t.split(/[+,]/).map((s) => s.trim());
  return parts.some((s) => s === "") ? null : parts;
}

interface Prepared {
  data: RegDataset;
  dep: string;
  exog: string[];
  endog: string[];
  instr: string[];
  se: IvSe;
  small: boolean;
  constant: boolean;
  cluster?: string;
  decimals: number;
}

function prepare(read: Read): Prepared | { error: string } {
  const get = (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
  const seRaw = get("se").trim() || IV_2SLS_DEFAULTS.se;
  if (!IV_SE_OPTIONS.some((o) => o.value === seRaw)) return { error: `Unknown standard-error type ${q(seRaw)}.` };
  const smallRaw = get("small").trim() || IV_2SLS_DEFAULTS.small;
  if (smallRaw !== "z" && smallRaw !== "t") return { error: `Unknown reference distribution ${q(smallRaw)} (choose z or t).` };
  const constRaw = get("constant").trim() || "yes";
  if (constRaw !== "yes" && constRaw !== "no") return { error: `Constant: ${q(constRaw)} is not yes or no.` };
  const decRaw = get("decimals").trim() || "3";
  const decimals = Number(decRaw);
  if (![2, 3, 4].includes(decimals)) return { error: `Decimals: ${q(decRaw)} is not 2, 3 or 4.` };
  const parsed = parseRegData(get("data"));
  if (!parsed.ok) return { error: parsed.reason };
  // The model: "y ~ x1 + x2", "y ~" or "y" (the constant only).
  const specText = get("spec").trim();
  if (!specText) return { error: "Write the model as “y ~ x1 + x2” (the response, then the exogenous regressors; nothing after ~ for the constant only)." };
  const parts = specText.split("~");
  if (parts.length > 2) return { error: `Write the model as “y ~ x1 + x2” (one ~): ${q(specText)}.` };
  const dep = parts[0].trim();
  if (!dep) return { error: `The model ${q(specText)} has no response before the ~.` };
  const exog = nameList(parts[1] ?? "");
  if (!exog) return { error: `The model ${q(specText)} has an empty term (two + in a row?).` };
  if (exog.includes(".")) return { error: "List the exogenous regressors by name: “.” (every other column) would also take the endogenous regressors and the instruments." };
  const endog = nameList(get("endog"));
  if (!endog) return { error: "Endogenous regressors: an empty name (two + in a row?)." };
  if (!endog.length) return { error: "Name at least one endogenous regressor (without one, this is OLS: use the OLS calculator)." };
  const instr = nameList(get("instruments"));
  if (!instr) return { error: "Instruments: an empty name (two + in a row?)." };
  if (!instr.length) return { error: "Name at least one excluded instrument." };
  // Resolve every name, then check the roles do not overlap (each with its own message).
  const names = parsed.data.names;
  const idx = (nm: string, what: string): number | { error: string } => {
    const j = findColumn(names, nm);
    return typeof j === "number" ? j : { error: `${what}: ${j.error}` };
  };
  const dj = idx(dep, "Response");
  if (typeof dj !== "number") return dj;
  const roles = new Map<number, string>([[dj, "the response"]]);
  const groups: [string[], string, string][] = [
    [exog, "Exogenous regressor", "an exogenous regressor"],
    [endog, "Endogenous regressor", "an endogenous regressor"],
    [instr, "Instrument", "an instrument"],
  ];
  for (const [list, what, role] of groups) {
    for (const nm of list) {
      const j = idx(nm, what);
      if (typeof j !== "number") return j;
      const prev = roles.get(j);
      if (prev) {
        const col = q(names[j]);
        if (prev === role) return { error: `${col} is listed twice as ${role}.` };
        if (role === "an instrument" && prev === "an exogenous regressor") {
          return {
            error: `${col} is both an exogenous regressor and an instrument. An exogenous regressor is already its own instrument; list it once, in the model, and name only the EXCLUDED instruments here.`,
          };
        }
        return { error: `${col} cannot be both ${prev} and ${role}.` };
      }
      roles.set(j, role);
    }
  }
  const se = seRaw as IvSe;
  let cluster: string | undefined;
  if (se === "cluster") {
    cluster = get("cluster").trim();
    if (!cluster) return { error: "Name the cluster column (clustered standard errors)." };
    const cj = findColumn(names, cluster);
    if (typeof cj !== "number") return { error: `Cluster column: ${cj.error}` };
    const prev = roles.get(cj);
    if (prev) return { error: `${q(names[cj])} is ${prev}; it cannot also be the cluster column.` };
  }
  return { data: parsed.data, dep, exog, endog, instr, se, small: smallRaw === "t", constant: constRaw === "yes", cluster, decimals };
}

export interface Fitted {
  fit: IvFit;
  p: Prepared;
  dataNotes: string[];
  cols: { X: Float64Array[]; y: Float64Array; names: string[]; clusters?: string[]; clusterName?: string };
}

/** The fit behind iv-2sls (tests and the publication table read it). */
export function ivFitFromRead(read: Read): Fitted | { error: string } {
  const p = prepare(read);
  if ("error" in p) return p;
  const preds = [...p.exog, ...p.endog, ...p.instr];
  // The work bound on the raw row count, before the columns are read (the fit checks it again on the rows used).
  {
    const nexog = p.exog.length + (p.constant ? 1 : 0);
    const tooBig = ivWorkRefusal(p.data.rows.length, nexog + p.endog.length, nexog + p.instr.length, p.endog.length);
    if (tooBig) return { error: tooBig };
  }
  const sel = selectColumns(p.data, { dep: p.dep, preds, text: "" }, { cluster: p.cluster });
  if (!sel.ok) return { error: sel.reason };
  const c = sel.cols;
  const k1 = p.exog.length;
  const k2 = p.endog.length;
  const fit = fitIv({
    y: c.y,
    depName: c.depName,
    exog: c.X.slice(0, k1),
    exogNames: c.names.slice(0, k1),
    endog: c.X.slice(k1, k1 + k2),
    endogNames: c.names.slice(k1, k1 + k2),
    instr: c.X.slice(k1 + k2),
    instrNames: c.names.slice(k1 + k2),
    constant: p.constant,
    se: p.se,
    small: p.small,
    clusters: c.clusters,
    clusterName: c.clusterName,
  });
  if (!fit.ok) return { error: fit.reason };
  return { fit, p, dataNotes: c.notes, cols: { X: c.X.slice(0, k1 + k2), y: c.y, names: c.names.slice(0, k1 + k2), clusters: c.clusters, clusterName: c.clusterName } };
}

/** The 2SLS estimates as a FittedModel (kind "iv") for the publication table, or the refusal. */
export function iv2slsModel(read: Read): FittedModel | { error: string } {
  const r = ivFitFromRead(read);
  return "error" in r ? r : r.fit.model;
}

const pText = (p: number): string => (p < 0.001 ? P_BELOW : `= ${fmtP(p)}`);

/** iv-2sls: instrumental variables, two-stage least squares. */
export function iv2slsCalc(read: Read): StatOutput {
  const r = ivFitFromRead(read);
  if ("error" in r) return refuse(r.error);
  const { fit, p } = r;
  const m = fit.model;
  const d = p.decimals;
  const sl = m.statLabel;
  const lines: string[] = [];
  const k1 = p.exog.length;
  lines.push(
    `Instrumental variables (2SLS): ${m.depName} on ${p.endog.join(", ")} (instrumented)` +
      (k1 ? ` and ${k1} exogenous regressor${k1 === 1 ? "" : "s"}` : "") +
      ` (n = ${intText(m.n)})`,
  );
  const included = [...p.exog, ...(p.constant ? ["the constant"] : [])];
  lines.push(`Excluded instruments: ${p.instr.join(", ")}${included.length ? `; included (their own instruments): ${included.join(", ")}` : ""}`);
  lines.push(`Standard errors: ${m.seLabel}; ${sl === "z" ? "z statistics (large-sample)" : `t statistics with ${intText(m.df ?? 0)} df (small-sample)`}`);
  let fitLine = `R² = ${fmtFixed(fit.r2, 3)}, adjusted R² = ${fmtFixed(fit.adjR2, 3)}`;
  if (fit.wald) {
    fitLine +=
      fit.wald.dist === "F"
        ? `; F(${fit.wald.df1}, ${intText(fit.wald.df2 ?? 0)}) = ${fmtFixed(fit.wald.stat, d)}, p ${pText(fit.wald.p)}`
        : `; Wald χ²(${fit.wald.df1}) = ${fmtFixed(fit.wald.stat, d)}, p ${pText(fit.wald.p)}`;
  }
  lines.push(fitLine);
  if (fit.waldWhy) lines.push(fit.waldWhy);
  lines.push(`Root MSE = ${fmtFixed(Math.sqrt(fit.s2), d)} (σ² = eᵀe/${p.small ? "(n − k)" : "n"})`);

  // Weak instruments.
  const robust = p.se !== "classical";
  for (const fs of fit.firstStage) {
    const tb = fs.fClassical;
    let s = `First stage for ${fs.endog}: partial R² = ${fmtFixed(fs.partialR2, 3)}, non-robust F(${tb.df1}, ${intText(tb.df2)}) = ${fmtFixed(tb.value, d)}`;
    if (fs.fRobust) s += `; ${p.se === "cluster" ? "cluster-robust" : "robust"} F = Wald/${fs.fRobust.df1} = ${fmtFixed(fs.fRobust.value, d)}`;
    else if (fs.fRobustWhy) s += `; robust F ${fs.fRobustWhy}`;
    lines.push(s);
  }
  // The rule of thumb was derived for the NON-robust F, so it is applied to that F whatever the SE type; a robust F
  // is printed beside it for context only (no threshold is applied to it).
  const weak = fit.firstStage.filter((fs) => fs.fClassical.value < 10);
  if (weak.length) {
    const ctx = robust
      ? weak.filter((w) => w.fRobust).map((w) => `${w.endog}: ${fmtFixed(w.fRobust!.value, d)}`)
      : [];
    lines.push(
      `Weak instruments: the first-stage ${robust ? "non-robust " : ""}F for ${weak.map((w) => w.endog).join(", ")} is below 10, the Staiger–Stock rule of thumb (derived for this F). ` +
        "2SLS is then biased toward OLS and its intervals can be badly wrong." +
        (ctx.length ? ` The ${p.se === "cluster" ? "cluster-robust" : "robust"} F (${ctx.join("; ")}) is shown for context only; no threshold is applied to it.` : ""),
    );
  }
  lines.push("");
  lines.push(
    robust
      ? "Which F: each first stage shows the non-robust partial F (s² = SSR/(n − k), Wald/q, F(q, n − k)) and the robust Wald/q under the chosen " +
          "standard errors, with p from χ²(q) (linearmodels' f.stat is that Wald, not divided by q). The rule of thumb F < 10 (Staiger and Stock, 1997) " +
          "and the Stock–Yogo critical values were derived for the NON-robust F, so the weak-instrument warning is given whenever the non-robust F is below 10, whatever the standard errors; " +
          "the robust F is not directly comparable to that threshold and is printed only as context. No Stock–Yogo table is applied."
      : "Which F: the first-stage F is the textbook non-robust partial F on the excluded instruments (s² = SSR/(n − k), Wald/q, F(q, n − k)); the rule of thumb " +
          "F < 10 (Staiger and Stock, 1997) applies to it. linearmodels' own f.stat in large-sample mode is n/(n − k) times this. No Stock–Yogo table is applied.",
  );
  if (p.endog.length > 1) {
    lines.push(
      "With more than one endogenous regressor, the separate first-stage F statistics can all be large while the instruments are still jointly weak; " +
        "no joint (Cragg–Donald or Kleibergen–Paap) test is computed here.",
    );
  }
  lines.push(
    p.constant ? "Conventions: a constant is included (shown last); the instrumented regressors are listed first, as Stata's ivregress prints them." : "Conventions: no constant.",
  );
  if (!p.data.named) lines.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  lines.push("Rows with an empty or NA cell in any column the model uses (response, regressors, instruments) are dropped (listwise deletion).");
  lines.push(...r.dataNotes, ...fit.notes);
  lines.push(
    "Diagnostics as linearmodels 7.1 computes them: Durbin (χ²) and Wu–Hausman (F) compare OLS and 2SLS residuals projected on the instruments, assuming " +
      "homoskedastic errors; Sargan n(1 − ûᵀM_Zû/ûᵀû) and Basmann s(n − k_Z)/(n − s) test the overidentifying restrictions, also assuming homoskedasticity" +
      (robust ? "; with robust or clustered SEs, Wooldridge's score tests (n − SSR of a regression of 1 on the score products) are added: they are robust to heteroskedasticity but not to clustering." : "."),
  );

  const coefRows: string[][] = [["Term", "Coef.", "SE", sl, "p", "95% CI"]];
  for (const t of m.terms) {
    coefRows.push([t.name, fmtFixed(t.coef, d), fmtFixed(t.se, d), fmtFixed(t.stat, d), fmtP(t.p), `[${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}]`]);
  }
  const ref = sl === "z" ? "the normal distribution (z)" : `the t distribution with ${intText(m.df ?? 0)} df`;
  const tables: StatTable[] = [
    {
      label: `Coefficients (2SLS): ${m.depName}, ${m.seLabel}`,
      rows: coefRows,
      align: ["left", "right", "right", "right", "right", "right"],
      note: `Instrumented: ${p.endog.join(", ")}. Excluded instruments: ${p.instr.join(", ")}. p-values and intervals from ${ref}.`,
    },
  ];
  // First-stage summary, one row per endogenous regressor.
  const sumHead = ["Endogenous", "R²", "Partial R²", "F (non-robust)", "df", "p"];
  if (robust) sumHead.push("Robust F (Wald/q)", "p (χ²)");
  const sumRows: string[][] = [sumHead];
  const NC = "not computed";
  const robustWhy: string[] = [];
  for (const fs of fit.firstStage) {
    const row = [fs.endog, fmtFixed(fs.r2, 3), fmtFixed(fs.partialR2, 3), fmtFixed(fs.fClassical.value, d), `${fs.fClassical.df1},${NBSP}${intText(fs.fClassical.df2)}`, fmtP(fs.fClassical.p)];
    if (fs.fRobust) row.push(fmtFixed(fs.fRobust.value, d), fmtP(fs.fRobust.p));
    else if (robust) {
      row.push(NC, NC);
      robustWhy.push(`${fs.endog}: robust F ${fs.fRobustWhy ?? NC}.`);
    }
    sumRows.push(row);
  }
  tables.push({
    label: "First stage: instrument strength",
    rows: sumRows,
    align: sumHead.map((_, i) => (i === 0 ? "left" : "right")),
    note:
      (robust
        ? "The F < 10 rule of thumb was derived for the non-robust F and is applied to it whatever the standard errors. The robust F is the Wald statistic under the chosen standard errors divided by the number of excluded instruments, shown for context."
        : "F < 10 (Staiger–Stock rule of thumb) signals weak instruments.") + (robustWhy.length ? ` ${robustWhy.join(" ")}` : ""),
  });
  for (const fs of fit.firstStage) {
    const rows: string[][] = [["Instrument", "Coef.", "SE", fs.statLabel, "p", "95% CI"]];
    for (const t of fs.terms) {
      if (!Number.isFinite(t.se)) rows.push([t.name, fmtFixed(t.coef, d), NC, NC, NC, NC]);
      else rows.push([t.name, fmtFixed(t.coef, d), fmtFixed(t.se, d), fmtFixed(t.stat, d), fmtP(t.p), `[${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}]`]);
    }
    tables.push({
      label: `First stage: ${fs.endog} on the instruments, ${m.seLabel}`,
      rows,
      align: ["left", "right", "right", "right", "right", "right"],
      note:
        `Excluded instruments only; the regression also includes ${included.length ? included.join(", ") : "nothing else"}. ${fs.statLabel === "z" ? "z" : `t with ${intText(fs.df)} df`}.` +
        (fs.termsWhy ? ` Not computed: ${fs.termsWhy}.` : ""),
    });
  }
  const diagRows: string[][] = [["Test", "Statistic", "df", "p", "Assumes"]];
  const skipped: string[] = [];
  for (const t of fit.diagnostics) {
    if ("skipped" in t) {
      diagRows.push([t.name, NC, NC, NC, NC]);
      skipped.push(`${t.name}: ${t.skipped}.`);
    } else diagRows.push([t.name, `${t.dist === "F" ? "F" : "χ²"} = ${fmtFixed(t.stat, d)}`, t.df2 !== undefined ? `${t.df},${NBSP}${intText(t.df2)}` : String(t.df), fmtP(t.p), t.note]);
  }
  tables.push({
    label: "Diagnostics",
    rows: diagRows,
    align: ["left", "left", "right", "right", "left"],
    note:
      "Endogeneity tests: H₀ the instrumented regressors are exogenous (OLS is consistent). Overidentification tests: H₀ every instrument is valid." +
      (skipped.length ? ` Not computed: ${skipped.join(" ")}` : ""),
  });

  // Figure: each endogenous coefficient, OLS against 2SLS, with 95% intervals.
  const svg = coefFigure(r);
  if (!svg) lines.push("The OLS-versus-2SLS figure is not drawn: OLS could not be fitted on these rows under the chosen standard errors.");
  return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
}

function coefFigure(r: Fitted): string | null {
  const { fit, p, cols } = r;
  const seMap: Record<IvSe, SeType> = { classical: "classical", hc0: "hc0", hc1: "hc1", cluster: "cluster" };
  const ols = fitOls({
    y: cols.y,
    depName: fit.model.depName,
    X: cols.X,
    names: cols.names,
    constant: p.constant,
    se: seMap[p.se],
    clusters: cols.clusters,
    clusterName: cols.clusterName,
  });
  if (!ols.ok) return null;
  const ivCrit = fit.model.statLabel === "z" ? 1.959963984540054 : tCritical(0.05, fit.model.df ?? 1);
  const olsCrit = tCritical(0.05, ols.model.df ?? 1);
  const olsPts: { x: number; y: number; err: number }[] = [];
  const ivPts: { x: number; y: number; err: number }[] = [];
  p.endog.forEach((nm, j) => {
    const o = ols.model.terms.find((t) => t.name === nm);
    const v = fit.model.terms.find((t) => t.name === nm);
    if (!o || !v) return;
    olsPts.push({ x: j + 1 - 0.15, y: o.coef, err: olsCrit * o.se });
    ivPts.push({ x: j + 1 + 0.15, y: v.coef, err: ivCrit * v.se });
  });
  const k = p.endog.length;
  const series: Series[] = [
    { type: "scatter", points: olsPts, color: "#64748b", label: "OLS" },
    { type: "scatter", points: ivPts, color: "#0369a1", label: "2SLS" },
    { type: "line", points: [{ x: 0.4, y: 0 }, { x: k + 0.6, y: 0 }], color: "#94a3b8" },
  ];
  const names = p.endog;
  return buildPlotSvg(series, {
    width: 380,
    height: 250,
    title: "OLS vs 2SLS",
    ylabel: "Coefficient",
    errorBars: "ci95",
    xLimits: { min: 0.4, max: k + 0.6 },
    xTickLabel: (v: number) => {
      const j = Math.round(v);
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? names[j - 1] : "";
    },
    notes: [
      `2SLS: ${fit.model.seLabel}, ${fit.model.statLabel === "z" ? "normal" : "t"} intervals. OLS: the same rows and standard-error type, t intervals as the OLS calculator${p.se === "cluster" ? " (Stata's cluster factor, G − 1 df)" : ""}.`,
    ],
  });
}
