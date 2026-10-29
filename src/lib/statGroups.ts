/**
 * The headings of the grouped Stats dropdown (F2, v2.203.0) — one <optgroup> each, as Finance (F1) and Engineering do.
 * Stats had 52 calculators in one flat list and F2 adds about 25 more (time series II, limited-dependent models, causal
 * inference II, micro II, macro II).
 *
 * Kept as a map by id, not a field on each calculator, so the library registries need no change; statGroups.test.ts
 * fails if any Stats calculator (inline or spread) has no group.
 */
export const STAT_GROUP_ORDER = [
  "Describe & compare groups",
  "Regression",
  "Limited dependent & count models",
  "Survival",
  "Clinical research & epidemiology",
  "Causal inference & panels",
  "Time series",
  "Event studies & index numbers",
  "Microeconomics",
  "Macroeconomics",
  "Uncertainty & study design",
] as const;
export type StatGroup = (typeof STAT_GROUP_ORDER)[number];

const BY_ID: Record<string, StatGroup> = {
  descriptive: "Describe & compare groups",
  twosample: "Describe & compare groups",
  paired: "Describe & compare groups",
  anova: "Describe & compare groups",
  welchanova: "Describe & compare groups",
  tukey: "Describe & compare groups",
  gameshowell: "Describe & compare groups",
  dunnett: "Describe & compare groups",
  mannwhitney: "Describe & compare groups",
  wilcoxon: "Describe & compare groups",
  kruskal: "Describe & compare groups",
  friedman: "Describe & compare groups",
  rmanova: "Describe & compare groups",
  twoway: "Describe & compare groups",
  chigof: "Describe & compare groups",
  chiind: "Describe & compare groups",
  assumptions: "Describe & compare groups",
  multcomp: "Describe & compare groups",
  regression: "Regression",
  multiregress: "Regression",
  polyregress: "Regression",
  "econ-ols": "Regression",
  "econ-regtable": "Regression",
  "econ-logit": "Regression",
  qreg: "Regression",
  "econ-count": "Limited dependent & count models",
  "econ-tobit": "Limited dependent & count models",
  "econ-heckman": "Limited dependent & count models",
  "econ-ordered": "Limited dependent & count models",
  "econ-mlogit": "Limited dependent & count models",
  "boot-ci": "Regression",
  survival: "Survival",
  logrank: "Survival",
  cox: "Survival",
  "iv-2sls": "Causal inference & panels",
  "econ-gmm": "Causal inference & panels",
  "panel-fe": "Causal inference & panels",
  "panel-re": "Causal inference & panels",
  "panel-did": "Causal inference & panels",
  "panel-dyn-gmm": "Causal inference & panels",
  "es-event": "Event studies & index numbers",
  "idx-price": "Event studies & index numbers",
  "idx-deflate": "Event studies & index numbers",
  "ineq-gini": "Microeconomics",
  "conc-hhi": "Microeconomics",
  "io-leontief": "Microeconomics",
  "micro-market": "Microeconomics",
  "micro-oligopoly": "Microeconomics",
  "game-nash": "Microeconomics",
  "macro-solow": "Macroeconomics",
  "macro-islm": "Macroeconomics",
  "macro-taylor": "Macroeconomics",
  uncertainty: "Uncertainty & study design",
  power: "Uncertainty & study design",
};

/** By id prefix, for the families F2 adds (ts-*, …); an explicit id above wins. */
const BY_PREFIX: [string, StatGroup][] = [
  ["ts-", "Time series"],
  ["clin-", "Clinical research & epidemiology"],
  ["ld-", "Limited dependent & count models"],
  ["limdep-", "Limited dependent & count models"],
  ["causal-", "Causal inference & panels"],
  ["rdd-", "Causal inference & panels"],
  ["synth-", "Causal inference & panels"],
  ["psm-", "Causal inference & panels"],
  ["micro-", "Microeconomics"],
  ["macro-", "Macroeconomics"],
];

/** The dropdown heading for a Stats calculator id, or null when none is assigned (a test keeps that from shipping). */
export function statGroupOf(id: string): StatGroup | null {
  if (BY_ID[id]) return BY_ID[id];
  for (const [p, g] of BY_PREFIX) if (id.startsWith(p)) return g;
  return null;
}
