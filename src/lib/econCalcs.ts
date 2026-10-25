/**
 * The two Release E2 Stats calculators, as pure functions of the field reader so jest can run them:
 *  - econ-ols       one OLS model: summary, coefficient table, diagnostics table, residual-vs-fitted figure;
 *  - econ-regtable  several OLS models side by side in the publication table (regTable.ts);
 *  - econ-logit     a logit or probit model: coefficients, average marginal effects, fit statistics.
 * taskpane.ts only declares the fields and calls these.
 *
 * Worked default: Longley (1967), the US macro series statsmodels bundles as `longley` (public domain), the classic
 * test of a regression program's numerical accuracy.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { fitOls, olsDiagnostics, type OlsFit, type SeType, type OlsDiagnostics } from "./olsInference";
import { parseRegData, parseSpec, parseSpecList, selectColumns, type RegDataset, type RegSpec } from "./regData";
import { buildRegTable, fmtFixed, fmtP, starsFor, starLegend, intText, P_BELOW, type StarScheme } from "./regTable";
import { buildPlotSvg } from "./plot";
import { fitLogit, fitProbit, logitProbitReport, LogitProbitRefusal } from "./logitProbit";

/** Longley (1967): total employment and six macro series, US 1947–1962 (statsmodels `longley`, public domain). */
export const LONGLEY_DEFAULT = [
  "TOTEMP GNPDEFL GNP UNEMP ARMED POP YEAR",
  "60323 83 234289 2356 1590 107608 1947",
  "61122 88.5 259426 2325 1456 108632 1948",
  "60171 88.2 258054 3682 1616 109773 1949",
  "61187 89.5 284599 3351 1650 110929 1950",
  "63221 96.2 328975 2099 3099 112075 1951",
  "63639 98.1 346999 1932 3594 113270 1952",
  "64989 99 365385 1870 3547 115094 1953",
  "63761 100 363112 3578 3350 116219 1954",
  "66019 101.2 397469 2904 3048 117388 1955",
  "67857 104.6 419180 2822 2857 118734 1956",
  "68169 108.4 442769 2936 2798 120445 1957",
  "66513 110.8 444546 4681 2637 121950 1958",
  "68655 112.6 482704 3813 2552 123366 1959",
  "69564 114.2 502601 3931 2514 125368 1960",
  "69331 115.7 518173 4806 2572 127852 1961",
  "70551 116.9 554894 4007 2827 130081 1962",
].join("\n");

export const ECON_SPEC_DEFAULT = "TOTEMP ~ GNPDEFL + GNP + UNEMP + ARMED + POP + YEAR";
export const ECON_SPECS_DEFAULT = ["TOTEMP ~ GNP + POP", "TOTEMP ~ GNP + POP + UNEMP + ARMED", ECON_SPEC_DEFAULT].join("\n");

/**
 * A synthetic teaching-method study (60 rows, seed 1980; the same data as the logit oracle's simS fixture): grade
 * (1 = improved) on GPA, a test score (TUCE) and a treatment dummy (PSI). Synthetic so it can ship.
 */
export const LOGIT_DEFAULT = [
  "grade GPA TUCE PSI",
  "0 2.56 20 0",
  "0 2.22 14 1",
  "0 2.54 25 0",
  "1 2.26 20 1",
  "0 2.25 25 0",
  "0 2.26 18 1",
  "1 2.91 34 1",
  "0 3.58 13 0",
  "1 3.59 25 1",
  "0 2.62 18 1",
  "0 3.31 31 0",
  "1 3.87 23 0",
  "1 2.64 16 0",
  "1 2.32 18 1",
  "0 2.67 22 0",
  "1 3.03 20 1",
  "0 3.2 19 0",
  "0 2.4 17 1",
  "0 2.95 24 1",
  "0 2.02 19 0",
  "1 3.42 27 1",
  "1 3.74 17 0",
  "1 3.8 16 1",
  "0 2.05 20 0",
  "0 2.5 29 0",
  "1 3.19 25 1",
  "0 2.66 21 0",
  "1 3.95 25 0",
  "0 3.76 22 0",
  "0 2.16 22 1",
  "0 2.45 21 0",
  "0 2.99 16 1",
  "0 2.1 19 1",
  "0 3.37 20 0",
  "0 2.04 27 0",
  "0 2.06 20 0",
  "0 3.02 17 0",
  "0 3.16 22 0",
  "0 2.99 23 0",
  "0 3.89 21 0",
  "0 2.1 13 1",
  "0 3.06 21 0",
  "1 3.89 18 1",
  "1 2.95 24 1",
  "0 2.05 17 0",
  "1 3.82 31 0",
  "0 2.92 31 1",
  "0 2.05 16 1",
  "0 2.22 23 0",
  "1 3.58 17 0",
  "0 2.81 25 0",
  "0 2.39 20 1",
  "1 2.53 25 0",
  "0 2.08 20 0",
  "0 2.79 23 0",
  "0 3.17 18 0",
  "1 3.83 27 0",
  "1 2.75 18 1",
  "0 2.95 24 0",
  "1 3.52 21 1",
].join("\n");

export const LOGIT_SPEC_DEFAULT = "grade ~ GPA + TUCE + PSI";

/** At most this many points in the residual figure (every m-th row beyond it, said in the text). */
export const RESID_FIGURE_MAX_POINTS = 2000;

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });

interface Options {
  se: SeType;
  constant: boolean;
  cluster?: string;
  hacLag?: number;
  decimals: number;
  stars: StarScheme;
}

function readOptions(read: Read): Options | { error: string } {
  const seRaw = read("se") || "classical";
  const allowed: SeType[] = ["classical", "hc0", "hc1", "hc2", "hc3", "cluster", "hac"];
  if (!allowed.includes(seRaw as SeType)) return { error: `Unknown standard-error type ${seRaw}.` };
  const se = seRaw as SeType;
  const lagText = (read("lag") ?? "").trim();
  let hacLag: number | undefined;
  if (se === "hac" && lagText !== "") {
    const v = Number(lagText);
    if (!Number.isInteger(v) || v < 0) return { error: `Newey–West lag: “${lagText}” is not a whole number 0 or more (leave it blank for the default).` };
    hacLag = v;
  }
  const decimals = Number(read("decimals") || "3");
  const starsRaw = read("stars") || "econ";
  const stars: StarScheme = starsRaw === "sci" || starsRaw === "none" ? starsRaw : "econ";
  return {
    se,
    constant: (read("constant") || "yes") !== "no",
    cluster: se === "cluster" ? read("cluster") ?? "" : undefined,
    hacLag,
    decimals: [2, 3, 4].includes(decimals) ? decimals : 3,
    stars,
  };
}

/** Reads the data and fits one spec. */
function fitSpec(data: RegDataset, spec: RegSpec, o: Options, showsDw = false): { fit: OlsFit; notes: string[] } | { error: string } {
  const sel = selectColumns(data, spec, { cluster: o.cluster, timeOrdered: showsDw || o.se === "hac" });
  if (!sel.ok) return { error: sel.reason };
  const c = sel.cols;
  if (!c.X.length && !o.constant) return { error: "The model has no regressors: add a predictor, or include the constant." };
  const fit = fitOls({
    y: c.y,
    depName: c.depName,
    X: c.X,
    names: c.names,
    constant: o.constant,
    se: o.se,
    clusters: c.clusters,
    clusterName: c.clusterName,
    hacLag: o.hacLag,
  });
  if (!fit.ok) return { error: fit.reason };
  return { fit, notes: c.notes };
}

function conventionNotes(o: Options, named: boolean): string[] {
  const out: string[] = [];
  out.push(
    o.constant ? "Conventions: a constant is included (shown last, as Stata and esttab print it)." : "Conventions: no constant (regression through the origin).",
  );
  if (!named) out.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  out.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion).");
  return out;
}

/** One OLS model. */
export function econOlsCalc(read: Read): StatOutput {
  const o = readOptions(read);
  if ("error" in o) return refuse(o.error);
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const spec = parseSpec(read("spec"));
  if ("error" in spec) return refuse(spec.error);
  const r = fitSpec(parsed.data, spec, o, true);
  if ("error" in r) return refuse(r.error);
  const { fit } = r;
  const m = fit.model;
  const d = o.decimals;
  const diag = olsDiagnostics(fit);
  // An ok result never carries a blank computed cell (fmtFixed writes "" for a value that is not a number).
  const bad = nonFiniteDiagnostic(diag);
  if (bad) return refuse(`${bad} is not a finite number for these data (an extreme scale or a degenerate residual pattern), so the result is not reported.`);
  const k = m.terms.filter((t) => t.name !== "Constant").length;

  const lines: string[] = [];
  lines.push(`OLS regression of ${m.depName} on ${k} predictor${k === 1 ? "" : "s"} (n = ${intText(m.n)})`);
  lines.push(`Standard errors: ${m.seLabel}`);
  lines.push(`R² = ${fmtFixed(fit.r2, 3)}, adjusted R² = ${fmtFixed(fit.adjR2, 3)}`);
  if (fit.f) lines.push(`F(${fit.f.df1}, ${fit.f.df2}) = ${fmtFixed(fit.f.value, d)}, p ${pText(fit.f.p)}`);
  else if (fit.fWhy) lines.push(fit.fWhy);
  const stat = (label: string): number => m.stats.find((s) => s.label === label)?.value ?? NaN;
  lines.push(
    `Root MSE = ${fmtFixed(stat("Root MSE"), d)} · log likelihood = ${fmtFixed(stat("Log likelihood"), d)} · ` +
      `AIC = ${fmtFixed(stat("AIC"), d)} · BIC = ${fmtFixed(stat("BIC"), d)}`,
  );
  lines.push("");
  lines.push(...conventionNotes(o, parsed.data.named), ...r.notes, ...m.notes, ...diag.notes);
  lines.push(
    "Diagnostics use the OLS residuals whatever the standard errors: Breusch–Pagan is Koenker's studentized form; " +
      "RESET adds the squared and cubed fitted values, standardised before they are raised to powers (the same F as " +
      "statsmodels' linear_reset(power=3, use_f=True) whenever its augmented design keeps full rank, and exact when " +
      "large fitted values make that design numerically singular); Jarque–Bera uses the residuals' moments.",
  );

  const coefRows: string[][] = [["Term", "Coef.", "SE", m.statLabel, "p", "95% CI"]];
  for (const t of m.terms) {
    coefRows.push([
      t.name,
      fmtFixed(t.coef, d) + starsFor(t.p, o.stars),
      fmtFixed(t.se, d),
      fmtFixed(t.stat, d),
      fmtP(t.p),
      // "; " between the bounds: a comma would be read as one more thousands separator ("[−5,657.181; 13,996.001]").
      `[${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}]`,
    ]);
  }
  const tables: StatTable[] = [
    {
      label: `Coefficients: ${m.depName}, ${m.seLabel}`,
      rows: coefRows,
      note: [
        o.stars === "none" ? "" : starLegend(o.stars).replace("Standard errors in parentheses. ", ""),
        `p-values and intervals from the t distribution with ${intText(m.df ?? 0)} df.`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    { label: "Diagnostics", rows: diagnosticsRows(diag, d) },
  ];

  // Residuals against fitted values: curvature or a funnel is what the summary numbers cannot show.
  const n = fit.fitted.length;
  const step = n > RESID_FIGURE_MAX_POINTS ? Math.ceil(n / RESID_FIGURE_MAX_POINTS) : 1;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ x: fit.fitted[i], y: fit.resid[i] });
  let fmin = Infinity;
  let fmax = -Infinity;
  for (const p of pts) {
    if (p.x < fmin) fmin = p.x;
    if (p.x > fmax) fmax = p.x;
  }
  const svg = buildPlotSvg(
    [
      { type: "scatter", points: pts, color: "#0369a1" },
      { type: "line", points: [{ x: fmin, y: 0 }, { x: fmax, y: 0 }], color: "#94a3b8" },
    ],
    { width: 380, height: 250, title: "Residuals vs fitted", xlabel: `Fitted ${m.depName}`, ylabel: "Residual" },
  );
  if (step > 1) lines.push(`The figure shows every ${step}th row (${pts.length.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} points).`);
  return { text: lines.join("\n"), svg, tables };
}

function pText(p: number): string {
  return p < 0.001 ? P_BELOW : `= ${fmtP(p)}`;
}

/** The first diagnostic that is not a finite number, by name, or null. */
export function nonFiniteDiagnostic(diag: OlsDiagnostics): string | null {
  const checks: [string, number][] = [["Durbin–Watson", diag.durbinWatson]];
  const test = (name: string, t: OlsDiagnostics["white"]): void => {
    if (!("skipped" in t)) checks.push([name, t.stat], [`${name} p-value`, t.p]);
  };
  test("Breusch–Pagan", diag.breuschPagan);
  test("White's test", diag.white);
  if (!("skipped" in diag.reset)) checks.push(["Ramsey RESET", diag.reset.f], ["Ramsey RESET p-value", diag.reset.p]);
  checks.push(["Jarque–Bera", diag.jarqueBera.jb], ["Jarque–Bera p-value", diag.jarqueBera.p]);
  for (const v of diag.vif) checks.push([`The VIF of “${v.name}”`, v.vif]);
  const hit = checks.find(([, v]) => !Number.isFinite(v));
  return hit ? hit[0] : null;
}

/** The diagnostics as table rows: Test, Statistic, df, p. */
export function diagnosticsRows(diag: OlsDiagnostics, d: number): string[][] {
  const rows: string[][] = [["Test", "Statistic", "df", "p"]];
  rows.push(["Durbin–Watson", fmtFixed(diag.durbinWatson, d), "", ""]);
  const chi = (name: string, t: OlsDiagnostics["white"]): void => {
    if ("skipped" in t) rows.push([name, `not computed: ${t.skipped}`, "", ""]);
    else rows.push([name, `χ² = ${fmtFixed(t.stat, d)}`, intText(t.df), fmtP(t.p)]);
  };
  chi("Breusch–Pagan (Koenker)", diag.breuschPagan);
  chi("White", diag.white);
  if ("skipped" in diag.reset) rows.push(["Ramsey RESET (ŷ², ŷ³)", `not computed: ${diag.reset.skipped}`, "", ""]);
  else rows.push(["Ramsey RESET (ŷ², ŷ³)", `F = ${fmtFixed(diag.reset.f, d)}`, `${diag.reset.df1}, ${diag.reset.df2}`, fmtP(diag.reset.p)]);
  const jb = diag.jarqueBera;
  rows.push(["Jarque–Bera", `χ² = ${fmtFixed(jb.jb, d)}`, "2", fmtP(jb.p)]);
  for (const v of diag.vif) rows.push([`VIF: ${v.name}`, fmtFixed(v.vif, 2), "", ""]);
  return rows;
}

/** Several OLS models in the publication table. */
export function econRegTableCalc(read: Read): StatOutput {
  const o = readOptions(read);
  if ("error" in o) return refuse(o.error);
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const specs = parseSpecList(read("specs"));
  if ("error" in specs) return refuse(specs.error);
  if (specs.length > 12) return refuse("At most 12 models fit side by side in one table.");
  const fits: OlsFit[] = [];
  const dataNotes = new Set<string>();
  for (const [i, s] of specs.entries()) {
    const r = fitSpec(parsed.data, s, o);
    if ("error" in r) return refuse(specs.length > 1 ? `Model ${i + 1} (${s.text}): ${r.error}` : r.error);
    fits.push(r.fit);
    r.notes.forEach((n) => dataNotes.add(specs.length > 1 ? `Model ${i + 1}: ${n}` : n));
  }
  const models = fits.map((f) => f.model);
  const table = buildRegTable(models, { stars: o.stars, decimals: o.decimals });
  const deps = [...new Set(models.map((m) => m.depName))];
  const lines: string[] = [];
  lines.push(`Regression table: ${models.length} OLS model${models.length === 1 ? "" : "s"} of ${deps.join(", ")}`);
  lines.push(`Standard errors: ${[...new Set(models.map((m) => m.seLabel))].join("; ")}`);
  lines.push("");
  lines.push(...conventionNotes(o, parsed.data.named), ...dataNotes);
  // The SE convention once (identical across models).
  const seNotes = new Set<string>();
  for (const m of models) for (const n of m.notes) seNotes.add(n);
  lines.push(...seNotes);
  lines.push(`${o.decimals} decimals; terms a model leaves out are blank.`);
  return { text: lines.join("\n"), tables: [{ label: table.label, rows: table.rows, note: table.legend, align: table.align }] };
}

/** One logit or probit model (lib/logitProbit.ts): the summary, the coefficient table and the marginal effects. */
export function econLogitCalc(read: Read): StatOutput {
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const spec = parseSpec(read("spec"));
  if ("error" in spec) return refuse(spec.error);
  const sel = selectColumns(parsed.data, spec, {});
  if (!sel.ok) return refuse(sel.reason);
  const c = sel.cols;
  const constant = (read("constant") || "yes") !== "no";
  const se = read("se") === "hc0" ? "hc0" : "classical";
  const kind = read("model") === "probit" ? "probit" : "logit";
  // The engine wants one row per observation; the reader gives columns.
  const y = Array.from(c.y);
  const X = y.map((_, i) => c.X.map((col) => col[i]));
  try {
    const fit = kind === "probit" ? fitProbit : fitLogit;
    const model = fit(y, X, c.names, { constant, se, depName: c.depName });
    const rep = logitProbitReport(model);
    // The same conventions as OLS, the constant's position included: the coefficient table lists it last.
    const notes = [...conventionNotes({ se: "classical", constant, decimals: 3, stars: "econ" }, parsed.data.named), ...c.notes];
    return { text: [rep.text, ...notes].join("\n"), tables: rep.tables };
  } catch (e) {
    if (e instanceof LogitProbitRefusal) return refuse(e.message);
    // Never an uncaught error in the pane: anything else (a RangeError from a value the report cannot print) refuses.
    return refuse(`The ${kind} model could not be reported for these data (${(e as Error).message}). Check the columns for extreme values.`);
  }
}
