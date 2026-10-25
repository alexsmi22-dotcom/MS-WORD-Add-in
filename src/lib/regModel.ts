/**
 * The shape every fitted econometric model hands to the publication table (Release E2): OLS with any standard-error
 * type, logit and probit. One shape, so a regression table can set models of different kinds side by side.
 *
 * Numbers are raw (unformatted); the table and the report format them under the display contract.
 */

/** One estimated term: a coefficient with its standard error, test statistic, p-value and 95% interval. */
export interface ModelTerm {
  /** As the user named the column ("price", "log(income)"), or "Constant". */
  name: string;
  coef: number;
  se: number;
  /** t (OLS, and HAC/cluster with t reference) or z (logit/probit). */
  stat: number;
  p: number;
  ciLo: number;
  ciHi: number;
}

/** A model-level statistic shown under the coefficients ("R²", "Adjusted R²", "F", "Log likelihood", "Pseudo R²"). */
export interface ModelStat {
  label: string;
  value: number;
  /** Decimals to show (default 3); an integer count such as N uses 0. */
  decimals?: number;
}

export interface FittedModel {
  /** ols, iv (2SLS), fe / re (panel fixed and random effects), did (difference-in-differences, an OLS fit), logit,
   * probit, quantile. The first five are linear least-squares fits: the table prints their R². */
  kind: "ols" | "iv" | "fe" | "re" | "did" | "logit" | "probit" | "quantile";
  /** The response's name ("wage"). */
  depName: string;
  n: number;
  terms: ModelTerm[];
  /** "t" or "z": the reference distribution of `stat`. */
  statLabel: "t" | "z";
  /** Degrees of freedom of the t reference, when statLabel is "t". */
  df?: number;
  /** How the standard errors were computed, as printed ("HC1 (Stata robust)", "Clustered by firm, 40 clusters"). */
  seLabel: string;
  stats: ModelStat[];
  /** Conventions and caveats, printed under the table. */
  notes: string[];
  /** Average marginal effects (logit/probit), with delta-method standard errors. */
  marginalEffects?: ModelTerm[];
}

/** True for the least-squares kinds, whose R² the publication table prints as R² (not pseudo R²). */
export function isLinearKind(kind: FittedModel["kind"]): boolean {
  return kind === "ols" || kind === "iv" || kind === "fe" || kind === "re" || kind === "did";
}

/** The short estimator label for the publication table's Estimator row (v2.200.0). */
export function estimatorLabel(m: FittedModel): string {
  if (m.kind === "quantile") {
    const tau = m.stats.find((s) => s.label === "Quantile τ")?.value;
    return tau === undefined ? "Quantile" : `Quantile τ = ${tau}`;
  }
  return { ols: "OLS", iv: "2SLS", fe: "FE", re: "RE", did: "DiD", logit: "Logit", probit: "Probit" }[m.kind];
}
