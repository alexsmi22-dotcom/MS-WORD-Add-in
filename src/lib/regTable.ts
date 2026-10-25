/**
 * The publication regression table (Release E2): several fitted models side by side, the layout economics journals
 * print (Stata's esttab, R's stargazer):
 *
 *               (1)         (2)
 *              TOTEMP      TOTEMP
 *   GNP        0.036***    0.040**
 *             (0.011)     (0.015)
 *   …
 *   Constant   52.1***     …
 *   N           16          16
 *   R²          0.995       0.987
 *   SE type     Classical   HC1 (Stata robust)
 *   Standard errors in parentheses. * p < 0.10, ** p < 0.05, *** p < 0.01.
 *
 * One column per model, a row per term with the coefficient and its stars and the standard error in parentheses on
 * the row below, terms absent from a model blank, the constant last, then N, R² (pseudo R² for logit/probit) and the
 * standard-error type. It takes any FittedModel (regModel.ts), so OLS, logit and probit sit in one table.
 *
 * Numbers follow the display contract: a true minus (U+2212), no e-notation (×10ⁿ for a value that would round to
 * zero at the chosen decimals or is a million or more), never "−0.000", no NaN/Infinity.
 */
import type { FittedModel } from "./regModel";
import { timesTen } from "./axis";

export type StarScheme = "econ" | "sci" | "none";

export const STAR_SCHEMES: { value: StarScheme; label: string }[] = [
  { value: "econ", label: "* 0.10  ** 0.05  *** 0.01 (economics)" },
  { value: "sci", label: "* 0.05  ** 0.01  *** 0.001" },
  { value: "none", label: "No stars" },
];

export interface RegTableOptions {
  stars?: StarScheme;
  /** 2, 3 (default) or 4. */
  decimals?: number;
}

export interface RegTable {
  label: string;
  /** Header row first; cells are display text ("" is blank). */
  rows: string[][];
  /** The legend line printed under the table. */
  legend: string;
}

const MINUS = "−";

/** A number at fixed decimals under the display contract ("" for a non-finite value). */
export function fmtFixed(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return "";
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  const a = Math.abs(v);
  if (v !== 0 && (a < 0.5 * Math.pow(10, -d) || a >= 1e6)) return fmtSci(v, 3);
  let s = v.toFixed(d);
  if (/^-0(?:\.0*)?$/.test(s)) s = s.slice(1);
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

/** m×10ⁿ with `sig` significant digits and a true minus. */
export function fmtSci(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const m = /^(-?)(\d(?:\.\d+)?)e([+-]\d+)$/.exec(v.toExponential(Math.max(0, sig - 1)));
  if (!m) return String(v);
  return `${m[1] ? MINUS : ""}${m[2]}${timesTen(Number(m[3]))}`;
}

/** A p-value: "< 0.001" below 0.001, else three decimals. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

/** The stars for a p-value under a scheme. */
export function starsFor(p: number, scheme: StarScheme = "econ"): string {
  if (scheme === "none" || !Number.isFinite(p)) return "";
  const [a, b, c] = scheme === "econ" ? [0.1, 0.05, 0.01] : [0.05, 0.01, 0.001];
  return p < c ? "***" : p < b ? "**" : p < a ? "*" : "";
}

/** The legend line for a scheme. */
export function starLegend(scheme: StarScheme = "econ", statLabels: ("t" | "z")[] = ["t"]): string {
  const se = "Standard errors in parentheses.";
  const stars = scheme === "none" ? "" : scheme === "econ" ? " * p < 0.10, ** p < 0.05, *** p < 0.01." : " * p < 0.05, ** p < 0.01, *** p < 0.001.";
  const ref = new Set(statLabels);
  const refText = ref.size === 2 ? " p-values from t (OLS) or z (logit, probit) statistics." : "";
  return se + stars + refText;
}

function r2Of(m: FittedModel): { label: string; value: number } | null {
  const want = m.kind === "ols" ? "R²" : "Pseudo R²";
  const s = m.stats.find((x) => x.label === want);
  return s ? { label: want, value: s.value } : null;
}

/** Builds the side-by-side table from fitted models of any kind. */
export function buildRegTable(models: FittedModel[], opts: RegTableOptions = {}): RegTable {
  const scheme = opts.stars ?? "econ";
  const dec = [2, 3, 4].includes(opts.decimals ?? 3) ? (opts.decimals ?? 3) : 3;
  // Terms in order of first appearance, the constant last.
  const order: string[] = [];
  for (const m of models) for (const t of m.terms) if (!order.includes(t.name) && t.name !== "Constant") order.push(t.name);
  if (models.some((m) => m.terms.some((t) => t.name === "Constant"))) order.push("Constant");

  const rows: string[][] = [];
  rows.push(["", ...models.map((_, i) => `(${i + 1})`)]);
  rows.push(["", ...models.map((m) => m.depName)]);
  for (const name of order) {
    const coef: string[] = [name];
    const se: string[] = [""];
    for (const m of models) {
      const t = m.terms.find((x) => x.name === name);
      if (!t) {
        coef.push("");
        se.push("");
        continue;
      }
      coef.push(fmtFixed(t.coef, dec) + starsFor(t.p, scheme));
      se.push(`(${fmtFixed(t.se, dec)})`);
    }
    rows.push(coef, se);
  }
  rows.push(["N", ...models.map((m) => String(m.n))]);
  const r2s = models.map(r2Of);
  const kinds = new Set(models.map((m) => (m.kind === "ols" ? "ols" : "ml")));
  const r2Label = kinds.size === 2 ? "R² / pseudo R²" : kinds.has("ols") ? "R²" : "Pseudo R²";
  if (r2s.some(Boolean)) rows.push([r2Label, ...r2s.map((r) => (r ? fmtFixed(r.value, dec) : ""))]);
  rows.push(["SE type", ...models.map((m) => m.seLabel)]);
  const legend = starLegend(scheme, models.map((m) => m.statLabel));
  return { label: `Regression table: ${models.length} model${models.length === 1 ? "" : "s"}`, rows, legend };
}
