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
  kind: "ols" | "logit" | "probit";
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
