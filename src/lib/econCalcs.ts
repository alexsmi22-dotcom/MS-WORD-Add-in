/**
 * The two Release E2 Stats calculators, as pure functions of the field reader so jest can run them:
 *  - econ-ols       one OLS model: summary, coefficient table, diagnostics table, residual-vs-fitted figure;
 *  - econ-regtable  several OLS models side by side in the publication table (regTable.ts).
 * taskpane.ts only declares the fields and calls these.
 *
 * Worked default: Longley (1967), the US macro series statsmodels bundles as `longley` (public domain), the classic
 * test of a regression program's numerical accuracy.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { fitOls, olsDiagnostics, type OlsFit, type SeType, type OlsDiagnostics } from "./olsInference";
import { parseRegData, parseSpec, parseSpecList, selectColumns, type RegDataset, type RegSpec } from "./regData";
import { buildRegTable, fmtFixed, fmtP, starsFor, starLegend, type StarScheme } from "./regTable";
import { buildPlotSvg } from "./plot";

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
  const k = m.terms.filter((t) => t.name !== "Constant").length;

  const lines: string[] = [];
  lines.push(`OLS regression of ${m.depName} on ${k} predictor${k === 1 ? "" : "s"} (n = ${m.n})`);
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
      "RESET adds the squared and cubed fitted values (F form); Jarque–Bera uses the residuals' moments.",
  );

  const coefRows: string[][] = [["Term", "Coef.", "SE", m.statLabel, "p", "95% CI"]];
  for (const t of m.terms) {
    coefRows.push([
      t.name,
      fmtFixed(t.coef, d) + starsFor(t.p, o.stars),
      fmtFixed(t.se, d),
      fmtFixed(t.stat, d),
      fmtP(t.p),
      `[${fmtFixed(t.ciLo, d)}, ${fmtFixed(t.ciHi, d)}]`,
    ]);
  }
  const tables: StatTable[] = [
    {
      label: `Coefficients: ${m.depName}, ${m.seLabel}`,
      rows: coefRows,
      note: [
        o.stars === "none" ? "" : starLegend(o.stars).replace("Standard errors in parentheses. ", ""),
        `p-values and intervals from the t distribution with ${m.df} df.`,
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
  return p < 0.001 ? "< 0.001" : `= ${fmtP(p)}`;
}

/** The diagnostics as table rows: Test, Statistic, df, p. */
export function diagnosticsRows(diag: OlsDiagnostics, d: number): string[][] {
  const rows: string[][] = [["Test", "Statistic", "df", "p"]];
  rows.push(["Durbin–Watson", fmtFixed(diag.durbinWatson, d), "", ""]);
  const chi = (name: string, t: OlsDiagnostics["white"]): void => {
    if ("skipped" in t) rows.push([name, `not computed: ${t.skipped}`, "", ""]);
    else rows.push([name, `χ² = ${fmtFixed(t.stat, d)}`, String(t.df), fmtP(t.p)]);
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
  return { text: lines.join("\n"), tables: [{ label: table.label, rows: table.rows, note: table.legend }] };
}
