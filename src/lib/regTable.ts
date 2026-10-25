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
 * the row below, terms absent from a model blank, the constant last, then N, R² (pseudo R² for logit/probit; "R²
 * (uncentered)" when a model has no constant) and the standard-error type. The model columns are CENTRED (journal
 * style), so a coefficient, its "(0.011)" and the "(1)" header share one axis. It takes any FittedModel
 * (regModel.ts), so OLS, logit and probit sit in one table.
 *
 * Numbers follow the display contract: a true minus (U+2212), thousands grouped with commas (−3,482,258.635), no
 * e-notation (m×10ⁿ with 4 significant digits, trailing zeros kept, for a value that would round to zero at the chosen
 * decimals or is 10⁹ or more), never "−0.000", no NaN/Infinity, and "< 0.001" with a no-break space.
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

export type CellAlign = "left" | "center" | "right";

export interface RegTable {
  label: string;
  /** Header row first; cells are display text ("" is blank). */
  rows: string[][];
  /** The legend line printed under the table. */
  legend: string;
  /** Per-column alignment: the term column left, every model column centred. */
  align: CellAlign[];
}

const MINUS = "−";
/** U+00A0: "< 0.001" must never break across a line. */
export const NBSP = String.fromCharCode(0xa0);
/** How a p-value below 0.001 is printed. */
export const P_BELOW = `<${NBSP}0.001`;
/** Significant digits of every m×10ⁿ this module prints (one rule, trailing zeros kept). */
export const SCI_SIG = 4;

/** Groups the integer digits of a plain decimal in threes with commas: "-3482258.635" → "-3,482,258.635". */
export function groupThousands(s: string): string {
  const m = /^([-−]?)(\d+)(\.\d*)?$/.exec(s);
  if (!m) return s;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m[3] ?? "");
}

/** A whole number with grouped thousands ("50,000"). */
export function intText(n: number): string {
  return groupThousands(String(Math.round(n))).replace(/^-/, MINUS);
}

/** A number at fixed decimals under the display contract ("" for a non-finite value: callers refuse first). */
export function fmtFixed(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return "";
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  const a = Math.abs(v);
  if (v !== 0 && a < 0.5 * Math.pow(10, -d)) return fmtSci(v);
  if (a >= 1e9) return fmtSci(v);
  let s = v.toFixed(d);
  if (/^-0(?:\.0*)?$/.test(s)) s = s.slice(1);
  s = groupThousands(s);
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

/** m×10ⁿ with `sig` significant digits (trailing zeros kept) and a true minus. */
export function fmtSci(v: number, sig = SCI_SIG): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const m = /^(-?)(\d(?:\.\d+)?)e([+-]\d+)$/.exec(v.toExponential(Math.max(0, sig - 1)));
  if (!m) return String(v);
  return `${m[1] ? MINUS : ""}${m[2]}${timesTen(Number(m[3]))}`;
}

/**
 * A value quoted back in a message, exactly as JavaScript holds it but under the display contract: "1e-7" → "1×10⁻⁷",
 * "-1e+21" → "−1×10²¹", "-2.5" → "−2.5".
 */
export function numText(v: number): string {
  const s = String(v);
  const m = /^(-?)(\d+(?:\.\d+)?)e([+-]\d+)$/.exec(s);
  if (!m) return s.replace(/^-/, MINUS);
  return `${m[1] ? MINUS : ""}${m[2]}${timesTen(Number(m[3]))}`;
}

/** A p-value: "< 0.001" (no-break space) below 0.001, else three decimals. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "";
  if (p < 0.001) return P_BELOW;
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

/** True when the model has no constant term (the tables find the constant by its name; a predictor may not take it). */
export function hasNoConstant(m: FittedModel): boolean {
  return !m.terms.some((t) => t.name === "Constant");
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
  rows.push(["N", ...models.map((m) => intText(m.n))]);
  const r2s = models.map(r2Of);
  const kinds = new Set(models.map((m) => (m.kind === "ols" ? "ols" : "ml")));
  // An OLS model without a constant reports the uncentered R² (1 − SSE/Σy²): the row says so.
  const olsR2 = models.some((m) => m.kind === "ols" && hasNoConstant(m)) ? "R² (uncentered)" : "R²";
  const r2Label = kinds.size === 2 ? `${olsR2} / pseudo R²` : kinds.has("ols") ? olsR2 : "Pseudo R²";
  if (r2s.some(Boolean)) rows.push([r2Label, ...r2s.map((r) => (r ? fmtFixed(r.value, dec) : ""))]);
  rows.push(["SE type", ...models.map((m) => m.seLabel)]);
  const legend = starLegend(scheme, models.map((m) => m.statLabel));
  const align: CellAlign[] = ["left", ...models.map((): CellAlign => "center")];
  return { label: `Regression table: ${models.length} model${models.length === 1 ? "" : "s"}`, rows, legend, align };
}
