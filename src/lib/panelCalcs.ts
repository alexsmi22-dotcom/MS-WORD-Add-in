/**
 * Release E4b calculators, pure functions of the field reader (taskpane.ts declares the fields and calls these):
 *  - panel-fe   panel fixed effects, entity or entity + time (panel.ts, pinned to linearmodels PanelOLS);
 *  - panel-re   panel random effects with the Hausman test (linearmodels RandomEffects; Hausman by formula);
 *  - panel-did  difference-in-differences: two-way FE on the treatment dummy, the 2×2 table, the DiD event study.
 *
 * The worked defaults are synthetic panels from a fixed-seed generator, so nothing copyrighted ships.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { parseRegData, parseSpec, findColumn } from "./regData";
import { readPanel, panelShape, panelTextTooLong, type PanelColumns } from "./panelData";
import {
  fitFixedEffects,
  fitRandomEffects,
  hausman,
  thetaText,
  PanelRefusal,
  PanelTimeout,
  type PanelSe,
  type FeResult,
  type PanelFitResult,
  type HausmanForm,
} from "./panel";
import { analyseTreatment, twoByTwo, buildEventDummies, relLabel, EVENT_MAX_WINDOW, type EventDating } from "./did";
import { readIntField } from "./eventStudy";
import { fmtFixed, fmtP, intText, P_BELOW } from "./regTable";
import type { FittedModel, ModelTerm } from "./regModel";
import { tCritical } from "./stats";
import { buildPlotSvg, type Series } from "./plot";
import { fitOls, type SeType } from "./olsInference";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

export interface PanelField {
  key: string;
  label: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Worked defaults: a seeded LCG + Box–Muller, rounded to three decimals.

function rng(seed0: number): { u: () => number; g: () => number } {
  let seed = seed0;
  const u = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed + 0.5) / 2147483648;
  };
  const g = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return { u, g };
}
const r3 = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);

/** 30 firms × 8 years (2016–2023), a few rows missing: investment on sales and capital with firm effects. */
function feDefaultTable(): string {
  const { u, g } = rng(20261025);
  const lines = ["firm\tyear\tinvest\tsales\tcapital"];
  for (let i = 1; i <= 30; i++) {
    const a = 2 * g();
    const b = g();
    const c = g();
    for (let t = 0; t < 8; t++) {
      if (u() < 0.08) continue;
      const sales = 50 + 6 * b + 1.5 * a + 4 * g() + t;
      const capital = 20 + 4 * c + 3 * g();
      const invest = 4 + 0.6 * a + 0.12 * sales + 0.35 * capital + 1.5 * g();
      lines.push([`Firm ${String(i).padStart(2, "0")}`, 2016 + t, r3(invest), r3(sales), r3(capital)].join("\t"));
    }
  }
  return lines.join("\n");
}

/** 40 counties × 10 years (2014–2023); 16 adopt a policy in 2019 (common timing). */
function didDefaultTable(): string {
  const { g } = rng(19620814);
  const lines = ["county\tyear\temployment\tpolicy\tpopulation"];
  for (let i = 1; i <= 40; i++) {
    const a = 3 * g();
    const treated = i <= 16;
    const pop = 50 + 10 * g();
    for (let t = 0; t < 10; t++) {
      const d = treated && t >= 5 ? 1 : 0;
      const popT = pop + 0.5 * t + g();
      const y = 60 + a + 0.4 * t + 2.5 * d + 0.2 * popT + 1.2 * g();
      lines.push([`County ${String(i).padStart(2, "0")}`, 2014 + t, r3(y), d, r3(popT)].join("\t"));
    }
  }
  return lines.join("\n");
}

const SE_FIELD: PanelField = {
  key: "se",
  label: "Standard errors",
  kind: "select",
  options: [
    { value: "cluster-entity", label: "Clustered by entity" },
    { value: "robust", label: "Robust (White, effects counted)" },
    { value: "classical", label: "Classical" },
    { value: "cluster-column", label: "Clustered by a named column" },
  ],
};

export const PANEL_FE_FIELDS: PanelField[] = [
  { key: "data", label: "Panel table, one row per entity and period (header row of names)", kind: "block" },
  { key: "spec", label: "Model (y ~ x1 + x2)", kind: "text" },
  { key: "entity", label: "Entity column", kind: "text" },
  { key: "time", label: "Time column (whole numbers, dates or periods such as 2024 Q1)", kind: "text" },
  {
    key: "effects",
    label: "Fixed effects",
    kind: "select",
    options: [
      { value: "entity", label: "Entity" },
      { value: "twoway", label: "Entity and time" },
    ],
  },
  SE_FIELD,
  { key: "cluster", label: "Cluster column (for clustered by a named column)", kind: "text" },
];

const FE_DATA = feDefaultTable();
export const PANEL_FE_DEFAULTS: Record<string, string> = {
  data: FE_DATA,
  spec: "invest ~ sales + capital",
  entity: "firm",
  time: "year",
  effects: "entity",
  se: "cluster-entity",
  cluster: "",
};

export const PANEL_RE_FIELDS: PanelField[] = PANEL_FE_FIELDS.filter((f) => f.key !== "effects");
export const PANEL_RE_DEFAULTS: Record<string, string> = {
  data: FE_DATA,
  spec: "invest ~ sales + capital",
  entity: "firm",
  time: "year",
  se: "cluster-entity",
  cluster: "",
};

export const PANEL_DID_FIELDS: PanelField[] = [
  { key: "data", label: "Panel table, one row per entity and period (header row of names)", kind: "block" },
  { key: "outcome", label: "Outcome column", kind: "text" },
  { key: "entity", label: "Entity column", kind: "text" },
  { key: "time", label: "Time column (whole numbers, dates or periods such as 2024 Q1)", kind: "text" },
  { key: "treat", label: "Treatment column (1 = treated in this period, else 0)", kind: "text" },
  { key: "controls", label: "Controls (optional, separated by +)", kind: "text" },
  {
    key: "se",
    label: "Standard errors",
    kind: "select",
    options: [
      { value: "cluster-entity", label: "Clustered by entity" },
      { value: "robust", label: "Robust (White, effects counted)" },
    ],
  },
  { key: "leads", label: "Event study: periods before treatment (leads)", kind: "text" },
  { key: "lags", label: "Event study: periods after treatment (lags)", kind: "text" },
];

export const PANEL_DID_DEFAULTS: Record<string, string> = {
  data: didDefaultTable(),
  outcome: "employment",
  entity: "county",
  time: "year",
  treat: "policy",
  controls: "",
  se: "cluster-entity",
  leads: "4",
  lags: "4",
};

// ---------------------------------------------------------------------------------------------------------------
// Shared formatting

const BLANK_TAKES_DEFAULT = ["effects", "se", "leads", "lags"];

function getter(read: Read, defaults: Record<string, string>): (k: string) => string {
  return (k: string): string => {
    const v = read(k);
    const s = v === undefined || v === null ? "" : String(v);
    // A blank choice or window field takes its default; a blank table, model or column name is refused by name.
    return s.trim() === "" && BLANK_TAKES_DEFAULT.includes(k) ? (defaults[k] ?? "") : s;
  };
}

function readSe(raw: string, allowed: PanelSe[]): PanelSe | { error: string } {
  const s = (raw || "cluster-entity").trim();
  if (!allowed.includes(s as PanelSe)) return { error: `Unknown standard-error type ${q(s)}.` };
  return s as PanelSe;
}

function pText(p: number): string {
  return p < 0.001 ? P_BELOW : `= ${fmtP(p)}`;
}

function coefTable(m: FittedModel, label: string): StatTable {
  const rows: string[][] = [["Term", "Coef.", "SE", "t", "p", "95% CI"]];
  for (const t of m.terms) rows.push(termRow(t.name, t));
  return {
    label,
    rows,
    align: ["left", "right", "right", "right", "right", "right"],
    note: `p-values and intervals from the t distribution with ${intText(m.df ?? 0)} df.`,
  };
}

function termRow(name: string, t: ModelTerm): string[] {
  return [name, fmtFixed(t.coef, 3), fmtFixed(t.se, 3), fmtFixed(t.stat, 3), fmtP(t.p), `[${fmtFixed(t.ciLo, 3)}; ${fmtFixed(t.ciHi, 3)}]`];
}

function shapeLine(p: PanelColumns): string {
  const s = panelShape(p);
  const bal = s.balanced
    ? "balanced"
    : s.minT === s.maxT
      ? `unbalanced: every entity has ${intText(s.minT)} row${s.minT === 1 ? "" : "s"}, but not all in the same periods`
      : `unbalanced, ${intText(s.minT)} to ${intText(s.maxT)} rows per entity`;
  return `n = ${intText(p.n)} rows, ${intText(p.N)} entities (${p.entityName}), ${intText(p.T)} periods (${p.timeName}); ${bal}.`;
}

/** At most this many adoption periods are listed inline; more are summarised by the first and last. */
const COHORTS_INLINE = 8;

function cohortLine(ev: EventDating): string {
  const c = ev.cohortLabels;
  const list = c.length <= COHORTS_INLINE ? c.join(", ") : `from ${c[0]} to ${c[c.length - 1]}`;
  return (
    `${intText(ev.nTreated)} treated entit${ev.nTreated === 1 ? "y" : "ies"}, ${intText(ev.nNever)} never treated; ` +
    `treatment starts in ${intText(c.length)} period${c.length === 1 ? "" : "s"} (${list}).`
  );
}

function fitStatsRows(r: PanelFitResult, extra: [string, string][] = []): string[][] {
  const rows: string[][] = [["Statistic", "Value"]];
  const add = (k: string, v: number, d = 3): void => {
    if (Number.isFinite(v)) rows.push([k, fmtFixed(v, d)]);
  };
  add("R² within", r.r2Within);
  if (r.model.kind === "re") add("R² (quasi-demeaned)", r.r2);
  else if (Math.abs(r.r2 - r.r2Within) > 1e-12) add("R² (two-way transformed)", r.r2);
  add("R² between", r.r2Between);
  add("R² overall", r.r2Overall);
  if (r.f) rows.push([`F(${r.f.df1}, ${intText(r.f.df2)}), slopes`, `${fmtFixed(r.f.value, 3)} (p ${pText(r.f.p)})`]);
  else if (r.fWhy) rows.push(["F, slopes", r.fWhy.replace(/^F is not reported: /, "not reported: ")]);
  rows.push(["Observations", intText(r.n)], ["Entities", intText(r.N)], ["Periods", intText(r.T)]);
  rows.push(...extra);
  return rows;
}

function catchRefusal(f: () => StatOutput, what: string): StatOutput {
  try {
    return f();
  } catch (e) {
    if (e instanceof PanelRefusal) return refuse(e.message);
    return refuse(`The ${what} could not be computed for these data (${(e as Error).message}). Check the columns for extreme values.`);
  }
}

function readCommon(get: (k: string) => string, needCluster: boolean, spec: { dep: string; preds: string[]; text: string }): { ok: true; p: PanelColumns } | { ok: false; reason: string } {
  const long = panelTextTooLong(get("data"));
  if (long) return { ok: false, reason: long };
  const d = parseRegData(get("data"));
  if (!d.ok) return d;
  const r = readPanel(d.data, { spec, entity: get("entity"), time: get("time"), cluster: needCluster ? get("cluster") : undefined });
  if (!r.ok) return r;
  return { ok: true, p: r.panel };
}

function readModelSpec(text: string): { dep: string; preds: string[]; text: string } | { error: string } {
  if (!text.trim()) return { error: "Write the model as “y ~ x1 + x2”." };
  const s = parseSpec(text);
  if ("error" in s) return s;
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// panel-fe

/** The FE fit for the regression table (FittedModel kind "fe"). */
export function panelFeModel(read: Read): FittedModel | { error: string } {
  const r = runFe(read);
  return "error" in r ? r : r.fit.model;
}

function runFe(read: Read): { fit: FeResult; p: PanelColumns; se: PanelSe } | { error: string } {
  const get = getter(read, PANEL_FE_DEFAULTS);
  const se = readSe(get("se"), ["cluster-entity", "robust", "classical", "cluster-column"]);
  if (typeof se !== "string") return se;
  const eff = get("effects").trim();
  if (eff !== "entity" && eff !== "twoway") return { error: `Unknown effects ${q(eff)}: choose entity, or entity and time.` };
  const spec = readModelSpec(get("spec"));
  if ("error" in spec) return spec;
  const rd = readCommon(get, se === "cluster-column", spec);
  if (!rd.ok) return { error: rd.reason };
  try {
    return { fit: fitFixedEffects(rd.p, { effects: eff, se }), p: rd.p, se };
  } catch (e) {
    if (e instanceof PanelRefusal) return { error: e.message };
    return { error: `The fixed-effects model could not be computed for these data (${(e as Error).message}).` };
  }
}

/**
 * v2.200.0: two estimates of each common slope side by side with 95% intervals (pooled OLS vs FE; FE vs RE), so the
 * figure shows what absorbing the effects changes. Null when the models share no slope.
 */
function compareFigure(a: FittedModel, aLabel: string, b: FittedModel, bLabel: string, title: string, note: string): string | null {
  const crit = (m: FittedModel): number => (m.statLabel === "z" ? 1.959963984540054 : tCritical(0.05, m.df ?? 1));
  const names = b.terms.filter((t) => t.name !== "Constant" && a.terms.some((u) => u.name === t.name)).map((t) => t.name);
  if (!names.length) return null;
  const aPts: { x: number; y: number; err: number }[] = [];
  const bPts: { x: number; y: number; err: number }[] = [];
  names.forEach((nm, j) => {
    const ta = a.terms.find((t) => t.name === nm)!;
    const tb = b.terms.find((t) => t.name === nm)!;
    aPts.push({ x: j + 1 - 0.15, y: ta.coef, err: crit(a) * ta.se });
    bPts.push({ x: j + 1 + 0.15, y: tb.coef, err: crit(b) * tb.se });
  });
  if ([...aPts, ...bPts].some((q) => !Number.isFinite(q.y) || !Number.isFinite(q.err))) return null;
  const k = names.length;
  const series: Series[] = [
    { type: "scatter", points: aPts, color: "#64748b", label: aLabel },
    { type: "scatter", points: bPts, color: "#0369a1", label: bLabel },
    { type: "line", points: [{ x: 0.4, y: 0 }, { x: k + 0.6, y: 0 }], color: "#94a3b8" },
  ];
  return buildPlotSvg(series, {
    width: 380,
    height: 250,
    title,
    ylabel: "Coefficient",
    errorBars: "ci95",
    xLimits: { min: 0.4, max: k + 0.6 },
    xTickLabel: (v: number) => {
      const j = Math.round(v);
      return Math.abs(v - j) < 1e-9 && j >= 1 && j <= k ? names[j - 1] : "";
    },
    notes: [note],
  });
}

/** Pooled OLS on the FE rows, with the standard errors closest to the FE choice (for the comparison figure only). */
function pooledOls(p: PanelColumns, se: PanelSe): FittedModel | null {
  const map: Record<PanelSe, SeType> = { classical: "classical", robust: "hc1", "cluster-entity": "cluster", "cluster-column": "cluster" };
  const clusters =
    se === "cluster-entity" ? Array.from(p.entity, (e) => String(e)) : se === "cluster-column" && p.cluster ? Array.from(p.cluster.codes, (c) => String(c)) : undefined;
  if (map[se] === "cluster" && !clusters) return null;
  const r = fitOls({ y: p.y, depName: p.depName, X: p.X, names: p.names, constant: true, se: map[se], clusters, clusterName: se === "cluster-entity" ? p.entityName : p.cluster?.name });
  return r.ok ? r.model : null;
}

/** panel-fe: panel fixed effects. */
export function panelFeCalc(read: Read): StatOutput {
  return catchRefusal(() => {
    const r = runFe(read);
    if ("error" in r) return refuse(r.error);
    const { fit, p, se } = r;
    const m = fit.model;
    const k = m.terms.length - 1;
    const lines: string[] = [];
    lines.push(`Panel fixed effects (${fit.effects === "twoway" ? "entity and time effects" : "entity effects"}): ${m.depName} on ${k} regressor${k === 1 ? "" : "s"}`);
    lines.push(shapeLine(p));
    lines.push(`Standard errors: ${m.seLabel}`);
    lines.push(
      fit.effects === "twoway"
        ? `R² within = ${fmtFixed(fit.r2Within, 3)}, between ${fmtFixed(fit.r2Between, 3)}, overall ${fmtFixed(fit.r2Overall, 3)}; two-way transformed ${fmtFixed(fit.r2, 3)}`
        : `R² within = ${fmtFixed(fit.r2Within, 3)}, between ${fmtFixed(fit.r2Between, 3)}, overall ${fmtFixed(fit.r2Overall, 3)}`,
    );
    if (fit.f) lines.push(`F(${fit.f.df1}, ${intText(fit.f.df2)}) = ${fmtFixed(fit.f.value, 3)}, p ${pText(fit.f.p)} (slopes, under the chosen standard errors)`);
    else if (fit.fWhy) lines.push(fit.fWhy);
    if ("skipped" in fit.pooledF) lines.push(`Pooled F not computed: ${fit.pooledF.skipped}.`);
    else lines.push(`Pooled F(${intText(fit.pooledF.df1)}, ${intText(fit.pooledF.df2)}) = ${fmtFixed(fit.pooledF.value, 3)}, p ${pText(fit.pooledF.p)}: all effects zero`);
    lines.push("");
    lines.push(...p.notes, ...m.notes);
    lines.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion). Entity ids are compared as text.");
    const extra: [string, string][] = [["Effects counted", intText(fit.neffects)]];
    if (!("skipped" in fit.pooledF)) extra.push([`Pooled F(${intText(fit.pooledF.df1)}, ${intText(fit.pooledF.df2)}), effects`, `${fmtFixed(fit.pooledF.value, 3)} (p ${pText(fit.pooledF.p)})`]);
    const tables: StatTable[] = [
      coefTable(m, `Fixed effects: ${m.depName}, ${m.seLabel}`),
      { label: "Fit", rows: fitStatsRows(fit, extra), align: ["left", "right"] },
    ];
    const ols = pooledOls(p, se);
    const svg = ols
      ? compareFigure(ols, "Pooled OLS", m, "Fixed effects", "Pooled OLS vs fixed effects", "Pooled OLS on the same rows, with the matching standard-error type (HC1 for robust, clustered alike); the gap is what absorbing the effects changes.")
      : null;
    return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
  }, "fixed-effects model");
}

// ---------------------------------------------------------------------------------------------------------------
// panel-re

/** The RE fit for the regression table (FittedModel kind "re"). */
export function panelReModel(read: Read): FittedModel | { error: string } {
  const get = getter(read, PANEL_RE_DEFAULTS);
  const se = readSe(get("se"), ["cluster-entity", "robust", "classical", "cluster-column"]);
  if (typeof se !== "string") return se;
  const spec = readModelSpec(get("spec"));
  if ("error" in spec) return spec;
  const rd = readCommon(get, se === "cluster-column", spec);
  if (!rd.ok) return { error: rd.reason };
  try {
    return fitRandomEffects(rd.p, { se }).model;
  } catch (e) {
    if (e instanceof PanelRefusal) return { error: e.message };
    return { error: `The random-effects model could not be computed for these data (${(e as Error).message}).` };
  }
}

/** panel-re: random effects with the Hausman test against fixed effects. */
export function panelReCalc(read: Read): StatOutput {
  return catchRefusal(() => {
    const get = getter(read, PANEL_RE_DEFAULTS);
    const se = readSe(get("se"), ["cluster-entity", "robust", "classical", "cluster-column"]);
    if (typeof se !== "string") return refuse(se.error);
    const spec = readModelSpec(get("spec"));
    if ("error" in spec) return refuse(spec.error);
    const rd = readCommon(get, se === "cluster-column", spec);
    if (!rd.ok) return refuse(rd.reason);
    const p = rd.p;
    const started = Date.now();
    const re = fitRandomEffects(p, { se, started });
    const m = re.model;
    // Hausman: FE on the regressors that vary within entities, classical covariances.
    let haus: ReturnType<typeof hausman>;
    const tvIdx = re.timeVarying.map((nm) => p.names.indexOf(nm));
    if (!tvIdx.length) haus = { skipped: "no regressor varies within entities, so fixed effects estimate nothing to compare" };
    else {
      try {
        const pf: PanelColumns = { ...p, X: tvIdx.map((j) => p.X[j]), names: tvIdx.map((j) => p.names[j]) };
        const fe = fitFixedEffects(pf, { effects: "entity", se: "classical", started, skipPooled: true });
        haus = hausman(fe, re, started);
      } catch (e) {
        if (!(e instanceof PanelRefusal) || e instanceof PanelTimeout) throw e;
        haus = { skipped: `the fixed-effects fit failed (${e.message.replace(/\.$/, "")})` };
      }
    }
    const k = m.terms.length - 1;
    const lines: string[] = [];
    lines.push(`Panel random effects: ${m.depName} on ${k} regressor${k === 1 ? "" : "s"}`);
    lines.push(shapeLine(p));
    lines.push(`Standard errors: ${m.seLabel}`);
    lines.push(`σ²ᵤ = ${fmtFixed(re.sigma2u, 3)}, σ²ε = ${fmtFixed(re.sigma2e, 3)}, ρ = ${fmtFixed(re.rho, 3)}; θ = ${thetaText(re)}`);
    lines.push(`R² = ${fmtFixed(re.r2, 3)} (quasi-demeaned), within ${fmtFixed(re.r2Within, 3)}, between ${fmtFixed(re.r2Between, 3)}, overall ${fmtFixed(re.r2Overall, 3)}`);
    const formName = (f: HausmanForm): string => (f === "classic" ? "classic form" : f === "sigmamore" ? "sigmamore form" : "sigmamore form, generalised inverse");
    if ("skipped" in haus) lines.push(`Hausman test not computed: ${haus.skipped}.`);
    else {
      lines.push(
        `Hausman χ²(${haus.df}) = ${fmtFixed(haus.stat, 3)}, p ${pText(haus.p)} (${formName(haus.form)}): ` +
          (haus.p < 0.05 ? "the FE and RE estimates differ systematically at the 5% level, so the random-effects assumption is rejected (prefer fixed effects)." : "no systematic difference at the 5% level (random effects not rejected)."),
      );
      if (haus.form === "pinv") lines.push(`WARNING: Hausman test by a generalised inverse. ${haus.why}. The test then has ${haus.df} df instead of ${haus.names.length}.`);
    }
    lines.push("");
    lines.push(...p.notes, ...m.notes);
    lines.push(
      "Hausman test: (b_FE − b_RE)ᵀ(V_FE − V_RE)⁻¹(b_FE − b_RE) against χ² with one df per regressor that varies within entities, from the CONVENTIONAL (classical) covariances of both models whatever standard errors are displayed above; the FE fit has entity effects. " +
        "When V_FE − V_RE is not positive definite, both covariances are put on the efficient (RE) estimator's disturbance variance, as Stata's hausman, sigmamore (whose documented σ² for xtreg, re is e(rmse)², the s² = SSE/(n − k) of the quasi-demeaned regression): V_FE is multiplied by s²_RE/s²_FE. " +
        "If that difference is singular, the Moore–Penrose inverse is used with df = its rank, as Stata does. linearmodels has no Hausman test; the formulas are checked against numpy on linearmodels' covariances.",
    );
    if (!("skipped" in haus) && haus.form !== "pinv") lines.push(`Hausman form used: ${haus.why}.`);
    if (re.timeVarying.length < k) {
      const tinv = p.names.filter((nm) => !re.timeVarying.includes(nm));
      lines.push(`${tinv.map(q).join(", ")} ${tinv.length === 1 ? "does" : "do"} not vary within entities: estimated by random effects, absorbed by fixed effects, so left out of the Hausman test.`);
    }
    lines.push("The components follow linearmodels; no match with another package is claimed.");
    lines.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion). Entity ids are compared as text.");
    const hausRows: string[][] = [["Test", "Statistic", "df", "p"]];
    if ("skipped" in haus) hausRows.push(["Hausman (FE vs RE)", `not computed: ${haus.skipped}`, "", ""]);
    else hausRows.push([`Hausman (FE vs RE), ${formName(haus.form)}`, `χ² = ${fmtFixed(haus.stat, 3)}`, String(haus.df), fmtP(haus.p)]);
    const tables: StatTable[] = [
      coefTable(m, `Random effects: ${m.depName}, ${m.seLabel}`),
      {
        label: "Variance components",
        rows: [
          ["Component", "Value"],
          ["σ²ᵤ (entity effect)", fmtFixed(re.sigma2u, 3)],
          ["σ²ε (idiosyncratic)", fmtFixed(re.sigma2e, 3)],
          ["ρ = σ²ᵤ/(σ²ᵤ + σ²ε)", fmtFixed(re.rho, 3)],
          ["θ", thetaText(re)],
        ],
        align: ["left", "right"],
      },
      { label: "Fit", rows: fitStatsRows(re), align: ["left", "right"] },
      { label: "Hausman test", rows: hausRows, align: ["left", "left", "right", "right"] },
    ];
    // v2.200.0: FE beside RE on the regressors that vary within entities, both under the standard errors chosen above.
    let svg: string | null = null;
    if (tvIdx.length) {
      try {
        const pf: PanelColumns = { ...p, X: tvIdx.map((j) => p.X[j]), names: tvIdx.map((j) => p.names[j]) };
        const feShown = fitFixedEffects(pf, { effects: "entity", se, started, skipPooled: true });
        svg = compareFigure(feShown.model, "Fixed effects", m, "Random effects", "Fixed vs random effects", "Both under the standard errors chosen above, on the regressors that vary within entities; the Hausman test asks whether the gap is systematic.");
      } catch (e) {
        if (!(e instanceof PanelRefusal) || e instanceof PanelTimeout) throw e;
      }
    }
    return { text: lines.join("\n"), tables, ...(svg ? { svg } : {}) };
  }, "random-effects model");
}

// ---------------------------------------------------------------------------------------------------------------
// panel-did

interface DidRun {
  p: PanelColumns;
  fit: FeResult;
  treatName: string;
  controls: string[];
  /** Start of the calculator's wall clock (one deadline for every fit it runs). */
  started: number;
  /** The standard-error type as read and checked for the main fit (the event study uses the same). */
  se: PanelSe;
}

function runDid(read: Read): DidRun | { error: string } {
  const get = getter(read, PANEL_DID_DEFAULTS);
  const se = readSe(get("se"), ["cluster-entity", "robust"]);
  if (typeof se !== "string") return se;
  const outcome = get("outcome").trim();
  const treat = get("treat").trim();
  if (!outcome) return { error: "Name the outcome column." };
  if (!treat) return { error: "Name the treatment column (1 = treated in this period, else 0)." };
  const ctext = get("controls").trim();
  const controls = ctext ? ctext.split("+").map((s) => s.trim()) : [];
  if (controls.some((s) => s === "")) return { error: `The controls ${q(ctext)} have an empty term (two + in a row?).` };
  const long = panelTextTooLong(get("data"));
  if (long) return { error: long };
  const d = parseRegData(get("data"));
  if (!d.ok) return { error: d.reason };
  const ti = findColumn(d.data.names, treat);
  if (typeof ti !== "number") return { error: `Treatment column: ${ti.error}` };
  const spec = { dep: outcome, preds: [treat, ...controls], text: `${outcome} ~ ${[treat, ...controls].join(" + ")}` };
  const r = readPanel(d.data, { spec, entity: get("entity"), time: get("time"), treatment: treat });
  if (!r.ok) return { error: r.reason };
  const p = r.panel;
  const t = analyseTreatment(p, 0);
  if (!t.ok) return { error: t.reason };
  if (t.info.nTreated === 0) return { error: `No row has ${q(p.names[0])} = 1, so nothing is treated.` };
  const noControl =
    `has no comparison group: the treatment dummy is then a function of the period alone, which the time effects absorb. ` +
    "Difference-in-differences needs entities that are never treated, or treated later, in the same periods.";
  if (t.info.nNever === 0 && t.info.cohorts.length === 1) {
    return { error: `Every entity is treated, all from ${q(p.timeLabels[t.info.cohorts[0]])}, so the design ${noControl}` };
  }
  if (t.info.alwaysTreated === t.info.nTreated) {
    return {
      error:
        `No treated entity is observed before its treatment starts (each is treated in every row it has), so ${q(p.names[0])} is constant within each entity ` +
        "and the entity effects absorb it. Difference-in-differences needs treated entities observed both before and after treatment.",
    };
  }
  const started = Date.now();
  try {
    const fit = fitFixedEffects(p, { effects: "twoway", se, started });
    return { p, fit, treatName: p.names[0], controls: p.names.slice(1), started, se };
  } catch (e) {
    if (e instanceof PanelRefusal && e.message.startsWith(q(p.names[0])) && /absorb/.test(e.message)) {
      return {
        error:
          `The treatment ${q(p.names[0])} is absorbed by the entity and time effects (it is, to rounding, a sum of an entity part and a period part), so its effect cannot be estimated. ` +
          "Difference-in-differences needs treated entities observed before and after treatment, and comparison entities untreated in the same periods.",
      };
    }
    if (e instanceof PanelRefusal) return { error: e.message };
    return { error: `The difference-in-differences regression could not be computed (${(e as Error).message}).` };
  }
}

/** The TWFE DiD fit for the regression table (FittedModel kind "did"). */
export function panelDidModel(read: Read): FittedModel | { error: string } {
  const r = runDid(read);
  return "error" in r ? r : { ...r.fit.model, kind: "did" };
}

/** panel-did: difference-in-differences. */
export function panelDidCalc(read: Read): StatOutput {
  return catchRefusal(() => {
    const get = getter(read, PANEL_DID_DEFAULTS);
    const leads = readIntField(get("leads"), "Leads", 1, EVENT_MAX_WINDOW);
    if (typeof leads !== "number") return refuse(`${leads.error} Period −1 is the reference, so at least 1 lead is needed.`);
    const lags = readIntField(get("lags"), "Lags", 0, EVENT_MAX_WINDOW);
    if (typeof lags !== "number") return refuse(lags.error);
    const r = runDid(read);
    if ("error" in r) return refuse(r.error);
    const { p, fit } = r;
    const ta = analyseTreatment(p, 0);
    if (!ta.ok) return refuse(ta.reason);
    const info = ta.info;
    const m: FittedModel = { ...fit.model, kind: "did" };
    const d = m.terms[0];
    const lines: string[] = [];
    lines.push(`Difference-in-differences (two-way fixed effects): ${m.depName} on ${q(r.treatName)}${r.controls.length ? ` with ${r.controls.length} control${r.controls.length === 1 ? "" : "s"}` : ""}`);
    lines.push(shapeLine(p));
    lines.push(cohortLine(info.event));
    lines.push(`DiD estimate = ${fmtFixed(d.coef, 3)} (SE ${fmtFixed(d.se, 3)}), t = ${fmtFixed(d.stat, 3)}, p ${pText(d.p)}, 95% CI [${fmtFixed(d.ciLo, 3)}; ${fmtFixed(d.ciHi, 3)}]`);
    lines.push(`Standard errors: ${m.seLabel}`);
    lines.push("");
    // Adoption timing is a property of the treatment column, so staggering is judged on the adoption dates read
    // from every row (a missing outcome in an adoption row must not make one cohort look like two).
    const staggered = info.event.cohortLabels.length > 1;
    if (staggered) {
      lines.push(
        "WARNING: staggered adoption. Treatment starts in different periods, and the two-way fixed-effects estimate then compares later-treated with earlier-treated units, " +
          "whose weights can be negative when effects differ across cohorts or grow over time (Goodman-Bacon 2021; Sun & Abraham 2021; de Chaisemartin & D'Haultfœuille 2020). " +
          "The estimate above is NOT robust to heterogeneous effects; treat it with caution and consider a heterogeneity-robust estimator.",
      );
    }
    if (info.nNever === 0) lines.push("No entity is never treated: the estimate is identified only from differences in timing.");
    const np = info.event.noPre;
    if (np > 0) lines.push(np === 1 ? "1 entity is treated from its first row (no pre-period of its own)." : `${intText(np)} entities are treated from their first row (no pre-period of their own).`);
    lines.push(
      "Adoption period of each unit: the first period its treatment is 1, read from the treatment column over every row that has a treatment cell, " +
        "before rows with a missing outcome or control are dropped, so a missing outcome in the adoption row does not move it.",
    );
    lines.push(
      `Conventions: the DiD coefficient is the coefficient on the treatment dummy D (= treated group × post) in a regression with entity and time fixed effects ` +
        "(linearmodels PanelOLS(entity_effects=True, time_effects=True) with the same dummy).",
    );
    lines.push(...p.notes, ...m.notes);
    const tables: StatTable[] = [coefTable(m, `Difference-in-differences (TWFE): ${m.depName}, ${m.seLabel}`)];
    // The classic 2×2 table.
    const tb = twoByTwo(p, info);
    if (tb) {
      tables.push({
        label: "2×2 table of group means",
        rows: [
          ["Group", p.timeLabels[0], p.timeLabels[1], "Change"],
          ["Treated", fmtFixed(tb.treatedPre, 3), fmtFixed(tb.treatedPost, 3), fmtFixed(tb.treatedPost - tb.treatedPre, 3)],
          ["Control", fmtFixed(tb.controlPre, 3), fmtFixed(tb.controlPost, 3), fmtFixed(tb.controlPost - tb.controlPre, 3)],
          ["Difference", fmtFixed(tb.treatedPre - tb.controlPre, 3), fmtFixed(tb.treatedPost - tb.controlPost, 3), fmtFixed(tb.did, 3)],
        ],
        align: ["left", "right", "right", "right"],
        note: "The bottom-right cell is the difference in differences of the four means.",
      });
      lines.push(
        tb.balanced && !r.controls.length
          ? `2×2 table: the difference of the four means is ${fmtFixed(tb.did, 3)}, equal to the TWFE estimate (balanced panel, no controls).`
          : `2×2 table: the difference of the four means is ${fmtFixed(tb.did, 3)}; it can differ from the TWFE estimate ${!tb.balanced ? "because the panel is unbalanced" : "because the regression has controls"}.`,
      );
    }
    // Event study.
    let svg: string | undefined;
    const ev = buildEventDummies(p, 0, { leads, lags });
    if (!ev.ok) lines.push(`DiD event study not computed: ${ev.reason}`);
    else {
      try {
        const es = fitFixedEffects(ev.panel, { effects: "twoway", se: r.se, started: r.started, skipPooled: true });
        const df = es.dfResid;
        const tc = tCritical(0.05, df);
        const rowsEs: string[][] = [["Relative period", "Coef.", "SE", "t", "p", "95% CI"]];
        const pts: { x: number; y: number; err?: number }[] = [];
        const all = [...ev.periods, -1].sort((a, b) => a - b);
        for (const rp of all) {
          if (rp === -1) {
            rowsEs.push([`${relLabel(-1, leads, lags)} (reference)`, "0", "", "", "", ""]);
            pts.push({ x: -1, y: 0 });
            continue;
          }
          const j = es.names.indexOf(ev.dummyName(rp));
          const t = es.model.terms[j];
          rowsEs.push(termRow(ev.dummyName(rp), t));
          pts.push({ x: rp, y: t.coef, err: tc * t.se });
        }
        tables.push({
          label: "DiD event study: effects by period relative to treatment",
          rows: rowsEs,
          align: ["left", "right", "right", "right", "right", "right"],
          note: `Two-way FE with relative-period dummies; ${relLabel(-1, leads, lags)} omitted (reference). ${es.model.seLabel}; t with ${intText(df)} df.`,
        });
        lines.push(
          `DiD event study: relative period = rank of the period − rank of the entity's adoption period among the periods of the rows with a treatment cell (ranks, not calendar distance), ` +
            `binned at the window ends (${relLabel(-leads, leads, lags)} and ${relLabel(lags, leads, lags)}), ${relLabel(-1, leads, lags)} omitted as the reference, never-treated entities as controls, entity and time effects, same standard errors as above.`,
        );
        if (ev.empty.length) lines.push(`No row falls in relative period${ev.empty.length === 1 ? "" : "s"} ${ev.empty.map((x) => relLabel(x, leads, lags)).join(", ")}, so ${ev.empty.length === 1 ? "it has" : "they have"} no dummy.`);
        if (staggered) lines.push("With staggered adoption the event-study coefficients can also mix effects across cohorts (Sun & Abraham 2021).");
        let ylo = 0;
        let yhi = 0;
        for (const pt of pts) {
          ylo = Math.min(ylo, pt.y - (pt.err ?? 0));
          yhi = Math.max(yhi, pt.y + (pt.err ?? 0));
        }
        const xs = pts.map((pt) => pt.x);
        const xlo = Math.min(...xs) - 0.5;
        const xhi = Math.max(...xs) + 0.5;
        svg = buildPlotSvg(
          [
            { type: "line", points: [{ x: xlo, y: 0 }, { x: xhi, y: 0 }], color: "#94a3b8" },
            { type: "line", points: [{ x: -0.5, y: ylo }, { x: -0.5, y: yhi }], color: "#94a3b8" },
            { type: "scatter", points: pts, color: "#0369a1" },
          ],
          {
            width: 420,
            height: 270,
            title: "DiD event study",
            xlabel: "Periods relative to treatment (ends binned)",
            ylabel: `Effect on ${m.depName}`,
            errorBars: "ci95",
            notes: [`${relLabel(-1, leads, lags)} is the reference (0). Vertical line: treatment starts after τ = −1.`],
          },
        );
      } catch (e) {
        if (!(e instanceof PanelRefusal)) throw e;
        lines.push(`DiD event study not computed: ${e.message}`);
      }
    }
    lines.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion). Entity ids are compared as text.");
    return { text: lines.join("\n"), tables, svg };
  }, "difference-in-differences");
}
