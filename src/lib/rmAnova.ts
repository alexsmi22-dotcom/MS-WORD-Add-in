// Parametric repeated-measures ANOVA: one within-subject factor, optionally one
// between-subjects group factor (the two-way mixed design). Pure; no Office.js.
//
// Brief: docs/SCOPE-STATS-BATCH.md §B3 (interface frozen there), §C, §D3, §E12/§E15.
//
// CONVENTIONS (each one is stated in the result so the pane can print it):
//  - Sums of squares: one-way is the classical subjects × conditions partition.
//    The mixed design uses SEQUENTIAL (Type I) sums of squares with WEIGHTED
//    means, as R `aov`/`anova.mlm` and pingouin `mixed_anova`. With equal group
//    sizes this equals SPSS's Type III; with unequal group sizes the within and
//    interaction SS can differ from SPSS.
//  - Mauchly's test: R `mauchly.test` second-order Box approximation, including
//    R's quirk of k (the number of conditions), not k − 1, in the "3p" term of w₂.
//    Refused by name when the contrast covariance is singular (fewer subjects
//    than conditions, or a rank-deficient covariance) — pingouin prints a
//    plausible wrong p (0.001) there.
//  - ε: Greenhouse–Geisser from the (pooled-within-group) contrast covariance.
//    Huynh–Feldt: the Lecoutre (1991) correction, as R `car`/`stats`:
//        ε̃ = ((N − g + 1)(k − 1)ε̂ − 2) / ((k − 1)(N − g − (k − 1)ε̂))
//    With one group (g = 1) this IS the original Huynh–Feldt (1976) formula.
//    The original (SPSS) mixed-design form, (N(k−1)ε̂ − 2)/((k−1)(N − g − (k−1)ε̂)),
//    is returned beside it as `hfOriginalRaw` for comparison. HF is reported RAW
//    and capped at 1 for the corrected df.
//  - Which p leads: Greenhouse–Geisser when ε_GG < 0.75, otherwise Huynh–Feldt
//    (Girden 1992). Mauchly's p never picks the correction. When the contrast
//    covariance is singular (n < k, or a constant contrast) ε is unreliable and
//    the lower bound 1/(k − 1) leads instead.
//  - Post-hoc: paired t-tests between every pair of conditions, Holm-adjusted.
//    In the mixed design the comparisons pool all subjects (marginal over groups).
//  - Profile-plot error bars: Cousineau–Morey within-subject 95% CIs (Cousineau
//    2005 normalisation y − subject mean + grand mean, with Morey's 2008
//    √(k/(k−1)) correction and t(n − 1)); in the mixed design, normalised within
//    each group with t(n_g − 1).
//  - Missing cells are refused by subject (no listwise deletion).

import { mean, stdev, fTestP, tTestP, tCritical } from "./stats";
import { chiSquareP, adjustPValues } from "./stats2";
import { eigenSymmetric } from "./linalg";

export const RM_MAX_SUBJECTS = 500;
export const RM_MAX_CONDITIONS = 20;
export const RM_MAX_PROFILE_LINES = 40;

export interface RmAnovaOptions {
  posthoc: "holm" | "none";
}

export interface RmAnovaTableRow {
  source: string;
  ss: number;
  df: number;
  ms: number;
  /** null for rows that are error terms (or an F refused — see notes). */
  f: number | null;
  p: number | null;
}

export interface RmCorrectedTest {
  epsilon: number;
  df1: number;
  df2: number;
  p: number;
}

/**
 * Which p leads: "uncorrected" (k = 2), "gg" / "hf" by the Girden rule, or
 * "lowerBound" when the contrast covariance is singular (ε unreliable).
 */
export type RmLead = "uncorrected" | "gg" | "hf" | "lowerBound";

export interface RmWithinTest {
  /** "conditions" or "group × conditions". */
  effect: string;
  f: number;
  df1: number;
  df2: number;
  /** Uncorrected (sphericity-assumed) p. */
  p: number;
  /** Partial η² = SS_effect / (SS_effect + SS_error). */
  partialEta2: number;
  gg: RmCorrectedTest;
  /** Huynh–Feldt with ε capped at 1; null when HF is undefined at this n. */
  hf: RmCorrectedTest | null;
  lowerBound: RmCorrectedTest;
  /** Which p the output leads with, and that p. */
  lead: RmLead;
  leadP: number;
}

export interface RmBetweenTest {
  f: number;
  df1: number;
  df2: number;
  p: number;
  partialEta2: number;
}

export type RmMauchly =
  | { status: "ok"; W: number; chi2: number; df: number; p: number; method: string }
  | { status: "trivial"; reason: string }
  | { status: "refused"; reason: string };

export interface RmEpsilon {
  gg: number;
  /** Huynh–Feldt as built (Lecoutre 1991; = Huynh–Feldt 1976 when g = 1), RAW — may exceed 1. null if undefined. */
  hfRaw: number | null;
  /** min(1, hfRaw) — what the corrected df use. */
  hfCapped: number | null;
  /** Original Huynh–Feldt 1976 form (SPSS), RAW; equals hfRaw when g = 1. */
  hfOriginalRaw: number | null;
  hfFormula: string;
  /** 1 / (k − 1). */
  lowerBound: number;
  /** false when the contrast covariance is rank-deficient (n < k): ε is then a caveat, not a basis. */
  reliable: boolean;
}

export interface RmPosthocRow {
  /** 1-based condition indices. */
  a: number;
  b: number;
  meanDiff: number;
  t: number | null;
  df: number;
  p: number | null;
  pAdj: number | null;
  note?: string;
}

export interface RmProfileSeries {
  /** "" for the one-way design. */
  group: string;
  n: number;
  means: number[];
  /** Cousineau–Morey 95% half-widths, one per condition. */
  ciHalfWidths: number[];
}

export interface RmProfile {
  series: RmProfileSeries[];
  /** First RM_MAX_PROFILE_LINES subjects' raw rows (light-grey lines). */
  subjectLines: number[][];
  /** Group label of each subject line ("" one-way). */
  subjectLineGroups: string[];
  subjectLinesTotal: number;
  subjectLinesCapped: boolean;
  ciMethod: string;
}

export interface RmDescriptive {
  /** 1-based condition index. */
  condition: number;
  group: string;
  mean: number;
  sd: number;
  n: number;
}

export interface RmAnovaResult {
  ok: true;
  design: "one-way" | "mixed";
  nSubjects: number;
  nConditions: number;
  groupLabels: string[];
  groupSizes: number[];
  /** Per condition, all subjects pooled (group = ""). */
  descriptives: RmDescriptive[];
  /** Mixed design: per group × condition. Empty for one-way. */
  cellDescriptives: RmDescriptive[];
  table: RmAnovaTableRow[];
  ss: {
    total: number;
    conditions: number;
    error: number;
    /** One-way: subjects. Mixed: subjects within groups. */
    subjects: number;
    group: number | null;
    interaction: number | null;
  };
  within: RmWithinTest;
  interaction: RmWithinTest | null;
  between: RmBetweenTest | null;
  mauchly: RmMauchly;
  epsilon: RmEpsilon;
  leadRule: string;
  ssConvention: string;
  posthoc: RmPosthocRow[] | null;
  posthocMethod: string;
  profile: RmProfile;
  notes: string[];
}

export type RmAnovaOutcome = RmAnovaResult | { ok: false; reason: string };

const LEAD_RULE =
  "Leads with Greenhouse–Geisser when ε(GG) < 0.75, otherwise Huynh–Feldt (Girden 1992); with a singular contrast covariance, the lower bound ε = 1/(k − 1). Mauchly's test does not choose the correction: it has low power at small n.";
const MISSING_ADVICE = "a linear mixed model handles missing visits; this calculator does not";

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** Orthonormal Helmert contrasts: (k − 1) rows of length k. */
function helmert(k: number): number[][] {
  const c: number[][] = [];
  for (let j = 1; j < k; j++) {
    const s = Math.sqrt(j * (j + 1));
    const row = new Array(k).fill(0);
    for (let i = 0; i < j; i++) row[i] = 1 / s;
    row[j] = -j / s;
    c.push(row);
  }
  return c;
}

function fmt2(x: number): string {
  return x.toFixed(2);
}

/**
 * Repeated-measures ANOVA. `rows` holds one row per subject, one value per
 * condition. `groups` (optional) gives each subject's between-subjects group,
 * making it the two-way mixed design.
 */
export function rmAnova(rows: number[][], groups?: string[], opts?: RmAnovaOptions): RmAnovaOutcome {
  const posthocMode = opts?.posthoc ?? "holm";

  // ---- caps BEFORE any work ------------------------------------------------
  if (!Array.isArray(rows)) return fail("Repeated-measures ANOVA needs one row per subject.");
  if (rows.length > RM_MAX_SUBJECTS)
    return fail(`${rows.length} subjects is above the ${RM_MAX_SUBJECTS}-subject limit of this calculator.`);
  for (let i = 0; i < rows.length; i++) {
    if (!Array.isArray(rows[i])) return fail(`Subject ${i + 1} is not a row of values.`);
    if (rows[i].length > RM_MAX_CONDITIONS)
      return fail(
        `Subject ${i + 1} has ${rows[i].length} conditions; this calculator handles at most ${RM_MAX_CONDITIONS}.`,
      );
  }

  const n = rows.length;
  if (n < 2) return fail(`Repeated-measures ANOVA needs at least 2 subjects (got ${n}).`);
  const k = rows[0].length;
  if (k < 2)
    return fail(`Repeated-measures ANOVA needs at least 2 conditions per subject (got ${k}).`);
  for (let i = 0; i < n; i++) {
    if (rows[i].length !== k)
      return fail(
        `Subject ${i + 1} has ${rows[i].length} values but subject 1 has ${k}: every subject needs one value per condition — ${MISSING_ADVICE}.`,
      );
    for (let j = 0; j < k; j++) {
      const v = rows[i][j];
      if (typeof v !== "number" || !Number.isFinite(v))
        return fail(`Subject ${i + 1} is missing condition ${j + 1}: ${MISSING_ADVICE}.`);
    }
  }

  // ---- groups ---------------------------------------------------------------
  const notes: string[] = [];
  let labels: string[] = [];
  let gIndex: number[] = new Array(n).fill(0);
  if (groups !== undefined) {
    if (!Array.isArray(groups) || groups.length !== n)
      return fail(
        `${Array.isArray(groups) ? groups.length : 0} group labels for ${n} subjects: give one group label per subject.`,
      );
    const order: string[] = [];
    const idx = new Map<string, number>();
    gIndex = groups.map((g, i) => {
      const key = String(g ?? "").trim();
      if (key === "") return -1 - i;
      if (!idx.has(key)) {
        idx.set(key, order.length);
        order.push(key);
      }
      return idx.get(key) as number;
    });
    const blank = gIndex.findIndex((g) => g < 0);
    if (blank >= 0) return fail(`Subject ${blank + 1} has no group label.`);
    if (order.length === 1) {
      notes.push(`Every subject is in group "${order[0]}": with one group this is the one-way design.`);
      gIndex = new Array(n).fill(0);
    } else {
      labels = order;
    }
  }
  const g = Math.max(1, labels.length);
  const mixed = g > 1;
  const groupSizes = new Array(g).fill(0);
  for (const gi of gIndex) groupSizes[gi]++;
  if (mixed) {
    for (let q = 0; q < g; q++)
      if (groupSizes[q] < 2)
        return fail(
          `Group "${labels[q]}" has ${groupSizes[q]} subject; each group needs at least 2 subjects.`,
        );
  }

  // ---- means ------------------------------------------------------------------
  const p = k - 1;
  const N = n;
  let grand = 0;
  for (const r of rows) for (const v of r) grand += v;
  grand /= N * k;
  const rowMean = rows.map((r) => mean(r));
  const colMean: number[] = [];
  for (let j = 0; j < k; j++) colMean.push(mean(rows.map((r) => r[j])));
  const groupMean = new Array(g).fill(0);
  const cellMean: number[][] = Array.from({ length: g }, () => new Array(k).fill(0));
  for (let i = 0; i < N; i++) {
    groupMean[gIndex[i]] += rowMean[i];
    for (let j = 0; j < k; j++) cellMean[gIndex[i]][j] += rows[i][j];
  }
  for (let q = 0; q < g; q++) {
    groupMean[q] /= groupSizes[q];
    for (let j = 0; j < k; j++) cellMean[q][j] /= groupSizes[q];
  }

  // ---- sums of squares (each computed directly, never by subtraction) --------
  let ssTotal = 0;
  for (const r of rows) for (const v of r) ssTotal += (v - grand) ** 2;
  let ssCond = 0;
  for (let j = 0; j < k; j++) ssCond += N * (colMean[j] - grand) ** 2;
  let ssSubj = 0; // one-way: subjects; mixed: subjects within groups
  for (let i = 0; i < N; i++) ssSubj += k * (rowMean[i] - groupMean[gIndex[i]]) ** 2;
  let ssGroup = 0;
  let ssInter = 0;
  if (mixed) {
    for (let q = 0; q < g; q++) {
      ssGroup += k * groupSizes[q] * (groupMean[q] - grand) ** 2;
      for (let j = 0; j < k; j++)
        ssInter += groupSizes[q] * (cellMean[q][j] - groupMean[q] - colMean[j] + grand) ** 2;
    }
  }
  let ssErr = 0;
  for (let i = 0; i < N; i++) {
    const q = gIndex[i];
    for (let j = 0; j < k; j++) {
      const fitted = mixed ? rowMean[i] + cellMean[q][j] - groupMean[q] : rowMean[i] + colMean[j] - grand;
      ssErr += (rows[i][j] - fitted) ** 2;
    }
  }

  if (!(ssTotal > 0)) return fail("Every value is identical: there is no variation to analyse.");
  // Tolerances are relative to the SS the residual lives in, not SS_total:
  // large subject baselines (e.g. 0 … 7e5) must not make tiny-but-real
  // residuals look like rounding noise.
  let ssWithinSubj = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < k; j++) ssWithinSubj += (rows[i][j] - rowMean[i]) ** 2;
  let ssBetweenSubj = 0;
  for (let i = 0; i < N; i++) ssBetweenSubj += k * (rowMean[i] - grand) ** 2;
  if (ssErr <= 1e-10 * ssWithinSubj)
    return fail(
      "The error sum of squares is 0: every subject differs from every other by a constant (perfectly additive data), so F = MS_conditions / MS_error is undefined (division by zero) and so is ε. Check the data were not copied or generated.",
    );

  const dfCond = p;
  const dfErr = (N - g) * p;
  const dfSubj = N - g;
  const msCond = ssCond / dfCond;
  const msErr = ssErr / dfErr;
  const fCond = msCond / msErr;
  const pCond = fTestP(fCond, dfCond, dfErr);

  // ---- contrast covariance (pooled within groups) ----------------------------
  const C = helmert(k);
  const z = rows.map((r) => C.map((c) => c.reduce((s, cv, j) => s + cv * r[j], 0)));
  const zMean: number[][] = Array.from({ length: g }, () => new Array(p).fill(0));
  for (let i = 0; i < N; i++) for (let a = 0; a < p; a++) zMean[gIndex[i]][a] += z[i][a];
  for (let q = 0; q < g; q++) for (let a = 0; a < p; a++) zMean[q][a] /= groupSizes[q];
  const M: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < N; i++) {
    const zm = zMean[gIndex[i]];
    for (let a = 0; a < p; a++)
      for (let b = 0; b < p; b++) M[a][b] += (z[i][a] - zm[a]) * (z[i][b] - zm[b]);
  }
  const nu = N - g; // df of the pooled covariance
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] /= nu;
  for (let a = 0; a < p; a++)
    for (let b = a + 1; b < p; b++) {
      const s = (M[a][b] + M[b][a]) / 2;
      M[a][b] = s;
      M[b][a] = s;
    }
  let trM = 0;
  let trM2 = 0;
  for (let a = 0; a < p; a++) {
    trM += M[a][a];
    for (let b = 0; b < p; b++) trM2 += M[a][b] * M[b][a];
  }

  // ---- ε ---------------------------------------------------------------------
  const lowerBound = 1 / p;
  let gg = p === 1 ? 1 : (trM * trM) / (p * trM2);
  if (gg > 1) gg = 1; // rounding only; GG ≤ 1 by Cauchy–Schwarz
  if (gg < lowerBound) gg = lowerBound;
  let hfRaw: number | null;
  let hfOriginalRaw: number | null;
  if (p === 1) {
    hfRaw = 1;
    hfOriginalRaw = 1;
  } else {
    const den = p * (N - g - p * gg);
    hfRaw = den > 0 ? ((N - g + 1) * p * gg - 2) / den : null;
    hfOriginalRaw = den > 0 ? (N * p * gg - 2) / den : null;
  }
  const hfCapped = hfRaw === null ? null : Math.max(lowerBound, Math.min(1, hfRaw));
  const hfFormula = mixed
    ? "Huynh–Feldt with the Lecoutre (1991) correction, as R car/stats; the original Huynh–Feldt (1976) form used by SPSS is given beside it"
    : "Huynh–Feldt (1976); with one group this equals the Lecoutre (1991) correction R uses";

  // ---- Mauchly ---------------------------------------------------------------
  let mauchly: RmMauchly;
  let epsReliable = true;
  if (p === 1) {
    mauchly = {
      status: "trivial",
      reason: "With 2 conditions there is one contrast, so sphericity holds trivially: ε = 1 and no Mauchly test is needed.",
    };
  } else if (nu < p) {
    epsReliable = false;
    mauchly = {
      status: "refused",
      reason: mixed
        ? `Mauchly's test needs at least as many subjects per pooled covariance as conditions: N − g = ${nu} < ${p} = k − 1 — the covariance of the contrasts is singular.`
        : `Mauchly's test needs at least as many subjects as conditions: ${N} < ${k} — the covariance of the contrasts is singular.`,
    };
  } else {
    const scaled = M.map((r) => r.map((v) => v / trM));
    const eig = eigenSymmetric(scaled);
    const vals = eig ? eig.values : null;
    const lmax = vals ? Math.max(...vals) : NaN;
    const lmin = vals ? Math.min(...vals) : NaN;
    if (!vals || !(lmax > 0) || !(lmin > 1e-10 * lmax)) {
      epsReliable = false;
      mauchly = {
        status: "refused",
        reason:
          "Mauchly's test is undefined here: the covariance of the contrasts is singular (some combination of conditions does not vary across subjects), so W = 0 and its p would be meaningless.",
      };
    } else {
      const sumL = vals.reduce((s, v) => s + v, 0);
      const logW = vals.reduce((s, v) => s + Math.log(v), 0) - p * Math.log(sumL / p);
      const rho = 1 - (2 * p * p + p + 2) / (6 * p * nu);
      // R's mauchly.test.SSD: note the 3 * k (R's `p`, the untransformed dimension), not 3 * (k − 1).
      const w2 =
        ((p + 2) * (p - 1) * (p - 2) * (2 * p ** 3 + 6 * p * p + 3 * k + 2)) / (288 * (nu * p * rho) ** 2);
      const chi2 = -nu * rho * logW;
      const df = (p * (p + 1)) / 2 - 1;
      const P1 = chiSquareP(chi2, df);
      const P2 = chiSquareP(chi2, df + 4);
      const pv = Math.min(1, Math.max(0, P1 + w2 * (P2 - P1)));
      mauchly = {
        status: "ok",
        W: Math.exp(logW),
        chi2,
        df,
        p: pv,
        method: "Mauchly's W with R's second-order χ² approximation (mauchly.test)",
      };
    }
  }
  if (!epsReliable && p > 1)
    notes.push(
      (nu < p
        ? `ε is computed from a singular contrast covariance (${mixed ? `N − g = ${nu}` : `${N} subjects`} for ${k} conditions)`
        : "ε is computed from a singular contrast covariance (some combination of conditions does not vary across subjects)") +
        ": the ε-corrected p values are a rough guide only, so the output leads with the lower-bound p (ε = 1/(k − 1)), the safe one.",
    );
  if (hfRaw === null && p > 1)
    notes.push("Huynh–Feldt ε is undefined at this sample size (its denominator is not positive); only Greenhouse–Geisser is given.");
  if (hfRaw !== null && hfRaw > 1 && p > 1)
    notes.push(`Huynh–Feldt ε = ${hfRaw.toFixed(4)} exceeds 1; it is capped at 1 for the degrees of freedom.`);

  const leadFor = (): RmLead => {
    if (p === 1) return "uncorrected";
    if (!epsReliable) return "lowerBound";
    if (gg < 0.75 || hfCapped === null) return "gg";
    return "hf";
  };

  const withinTest = (effect: string, ss: number, df1: number): RmWithinTest => {
    const f = ss / df1 / msErr;
    const pv = fTestP(f, df1, dfErr);
    const corr = (eps: number): RmCorrectedTest => ({
      epsilon: eps,
      df1: eps * df1,
      df2: eps * dfErr,
      p: fTestP(f, eps * df1, eps * dfErr),
    });
    const ggT = corr(gg);
    const hfT = hfCapped === null ? null : corr(hfCapped);
    const lead = leadFor();
    const lbT = corr(lowerBound);
    const leadP =
      lead === "uncorrected" ? pv : lead === "gg" ? ggT.p : lead === "hf" ? (hfT as RmCorrectedTest).p : lbT.p;
    return {
      effect,
      f,
      df1,
      df2: dfErr,
      p: pv,
      partialEta2: ss / (ss + ssErr),
      gg: ggT,
      hf: hfT,
      lowerBound: lbT,
      lead,
      leadP,
    };
  };

  const within = withinTest("conditions", ssCond, dfCond);
  const interaction = mixed ? withinTest("group × conditions", ssInter, (g - 1) * p) : null;
  let between: RmBetweenTest | null = null;
  if (mixed) {
    const df1 = g - 1;
    if (ssSubj <= 1e-10 * ssBetweenSubj) {
      notes.push(
        "The between-group F is undefined: subjects within each group have identical means, so the subjects-within-groups error is 0.",
      );
    } else {
      const fG = ssGroup / df1 / (ssSubj / dfSubj);
      between = { f: fG, df1, df2: dfSubj, p: fTestP(fG, df1, dfSubj), partialEta2: ssGroup / (ssGroup + ssSubj) };
    }
  }

  // ---- ANOVA table -------------------------------------------------------------
  const table: RmAnovaTableRow[] = [];
  if (mixed) {
    table.push({
      source: "Group",
      ss: ssGroup,
      df: g - 1,
      ms: ssGroup / (g - 1),
      f: between ? between.f : null,
      p: between ? between.p : null,
    });
    table.push({ source: "Subjects within groups", ss: ssSubj, df: dfSubj, ms: ssSubj / dfSubj, f: null, p: null });
    table.push({ source: "Conditions", ss: ssCond, df: dfCond, ms: msCond, f: within.f, p: within.p });
    table.push({
      source: "Group × conditions",
      ss: ssInter,
      df: (g - 1) * p,
      ms: ssInter / ((g - 1) * p),
      f: (interaction as RmWithinTest).f,
      p: (interaction as RmWithinTest).p,
    });
    table.push({ source: "Error", ss: ssErr, df: dfErr, ms: msErr, f: null, p: null });
  } else {
    table.push({ source: "Conditions", ss: ssCond, df: dfCond, ms: msCond, f: within.f, p: within.p });
    table.push({ source: "Subjects", ss: ssSubj, df: N - 1, ms: ssSubj / (N - 1), f: null, p: null });
    table.push({ source: "Error", ss: ssErr, df: dfErr, ms: msErr, f: null, p: null });
  }
  table.push({ source: "Total", ss: ssTotal, df: N * k - 1, ms: ssTotal / (N * k - 1), f: null, p: null });

  // ---- descriptives -------------------------------------------------------------
  const descriptives: RmDescriptive[] = [];
  for (let j = 0; j < k; j++) {
    const col = rows.map((r) => r[j]);
    descriptives.push({ condition: j + 1, group: "", mean: colMean[j], sd: stdev(col), n: N });
  }
  const cellDescriptives: RmDescriptive[] = [];
  if (mixed) {
    for (let q = 0; q < g; q++)
      for (let j = 0; j < k; j++) {
        const col = rows.filter((_, i) => gIndex[i] === q).map((r) => r[j]);
        cellDescriptives.push({ condition: j + 1, group: labels[q], mean: cellMean[q][j], sd: stdev(col), n: col.length });
      }
  }

  // ---- post-hoc ------------------------------------------------------------------
  let posthoc: RmPosthocRow[] | null = null;
  if (posthocMode === "holm") {
    posthoc = [];
    for (let a = 0; a < k; a++)
      for (let b = a + 1; b < k; b++) {
        const d = rows.map((r) => r[a] - r[b]);
        const md = mean(d);
        const sd = stdev(d);
        const scale = Math.max(...d.map((x) => Math.abs(x)), Math.abs(md));
        if (!(sd > 1e-12 * Math.max(scale, 1e-300)) || !Number.isFinite(sd)) {
          posthoc.push({
            a: a + 1,
            b: b + 1,
            meanDiff: md,
            t: null,
            df: N - 1,
            p: null,
            pAdj: null,
            note: `Every subject's difference between conditions ${a + 1} and ${b + 1} is the same, so the paired t is undefined (zero variance).`,
          });
          continue;
        }
        const t = md / (sd / Math.sqrt(N));
        posthoc.push({ a: a + 1, b: b + 1, meanDiff: md, t, df: N - 1, p: tTestP(Math.abs(t), N - 1), pAdj: null });
      }
    const live = posthoc.filter((r) => r.p !== null);
    const adj = adjustPValues(
      live.map((r) => r.p as number),
      "holm",
    );
    live.forEach((r, i) => {
      r.pAdj = adj[i];
    });
    if (live.length < posthoc.length)
      notes.push("Pairs with zero-variance differences have no paired t and are left out of the Holm family.");
  }
  const posthocMethod =
    posthocMode === "none"
      ? "none"
      : mixed
        ? "paired t-tests between conditions, all subjects pooled across groups, Holm-adjusted"
        : "paired t-tests between conditions, Holm-adjusted";

  // ---- profile data (Cousineau–Morey) ----------------------------------------------
  const morey = Math.sqrt(k / (k - 1));
  const series: RmProfileSeries[] = [];
  for (let q = 0; q < g; q++) {
    const members = rows.map((r, i) => ({ r, i })).filter((x) => gIndex[x.i] === q);
    const nq = members.length;
    const gm = groupMean[q];
    const tcrit = tCritical(0.05, nq - 1);
    const hw: number[] = [];
    for (let j = 0; j < k; j++) {
      const normed = members.map(({ r, i }) => r[j] - rowMean[i] + gm);
      hw.push(tcrit * (stdev(normed) / Math.sqrt(nq)) * morey);
    }
    series.push({ group: mixed ? labels[q] : "", n: nq, means: cellMean[q].slice(), ciHalfWidths: hw });
  }
  const shown = Math.min(N, RM_MAX_PROFILE_LINES);
  const profile: RmProfile = {
    series,
    subjectLines: rows.slice(0, shown).map((r) => r.slice()),
    subjectLineGroups: gIndex.slice(0, shown).map((q) => (mixed ? labels[q] : "")),
    subjectLinesTotal: N,
    subjectLinesCapped: N > RM_MAX_PROFILE_LINES,
    ciMethod:
      "within-subject 95% CI (Cousineau–Morey: Cousineau 2005 normalisation with Morey 2008 √(k/(k − 1)) correction, t(n − 1))" +
      (mixed ? ", normalised within each group" : ""),
  };
  if (profile.subjectLinesCapped)
    notes.push(`The profile plot draws the first ${RM_MAX_PROFILE_LINES} of ${N} subjects' lines.`);

  const lead = within.lead;
  if (p > 1)
    notes.push(
      lead === "lowerBound"
        ? `Leading p: lower bound (ε = 1/(k − 1) = ${lowerBound.toFixed(3)}): F(${fmt2(within.lowerBound.df1)}, ${fmt2(within.lowerBound.df2)}), because the contrast covariance is singular.`
        : lead === "gg"
          ? gg < 0.75
            ? `Leading p: Greenhouse–Geisser (ε(GG) = ${gg.toFixed(3)} < 0.75): F(${fmt2(within.gg.df1)}, ${fmt2(within.gg.df2)}).`
            : `Leading p: Greenhouse–Geisser (ε(GG) = ${gg.toFixed(3)}), because Huynh–Feldt ε is undefined at this sample size.`
          : `Leading p: Huynh–Feldt (ε(GG) = ${gg.toFixed(3)} ≥ 0.75).`,
    );

  return {
    ok: true,
    design: mixed ? "mixed" : "one-way",
    nSubjects: N,
    nConditions: k,
    groupLabels: labels,
    groupSizes: mixed ? groupSizes : [N],
    descriptives,
    cellDescriptives,
    table,
    ss: {
      total: ssTotal,
      conditions: ssCond,
      error: ssErr,
      subjects: ssSubj,
      group: mixed ? ssGroup : null,
      interaction: mixed ? ssInter : null,
    },
    within,
    interaction,
    between,
    mauchly,
    epsilon: {
      gg,
      hfRaw,
      hfCapped,
      hfOriginalRaw,
      hfFormula,
      lowerBound,
      reliable: epsReliable,
    },
    leadRule: LEAD_RULE,
    ssConvention: mixed
      ? "Sequential (Type I) sums of squares with weighted means, as R aov/anova.mlm; equals SPSS Type III when group sizes are equal."
      : "Classical subjects × conditions partition: SS(total) = SS(subjects) + SS(conditions) + SS(error).",
    posthoc,
    posthocMethod,
    profile,
    notes,
  };
}
