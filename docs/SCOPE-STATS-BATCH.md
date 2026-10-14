# Scope — Stats mode batch: Cox regression, exact rank tests, repeated-measures ANOVA

_Written 2026-10-14 at v2.133.0 for v2.135.0. Sources: a read-only audit of `survival.ts`,
`stats2.ts`, `stats.ts`, `nonparametric.ts`, `regression.ts`, `linalg.ts`, `statchart.ts`,
`tableFeed.ts`, the `STAT_CALCS` registry (taskpane.ts 8508–9810, 22 calculators) and the
ratchet scripts; plus a 56-call probe of the lib entry points the pane calls. The probe
scripts lived in the session scratchpad and touched no file in the tree; their findings
are in §A. Audit-first, per the house method: wrong answers come first. §D is the
release's exit test. Every value in §D comes from an INDEPENDENT oracle, run this session
on Python 3.14: SciPy 1.18.1, statsmodels 0.15.0, lifelines 0.30.3 and pingouin 0.7.0.
Coefficients, SEs, the three global tests, F/ε/Mauchly and the exact p are each confirmed by
TWO independent routes (two libraries, or a library plus brute force). Rows marked
**(single oracle)** — concordance, the Schoenfeld PH tests, the Cousineau–Morey CIs — have
one route only and need R before they are quoted in user docs. R was not available; where
R would differ, the variant is named beside the value._

## A. What exists, what is missing

**What we build on (all `src/lib/`, each one read):**
- `survival.ts` — `kaplanMeier(times, events)` (Greenwood SE, CI, median that can be "not
  reached"); `logRankTest(groups)` (two groups: exact hypergeometric variance, Freireich χ² =
  16.79 as `survdiff`, plus Peto's HR; k > 2: Pearson approximation, said); `survivalCurvePoints`;
  `zToP`. Its 0/1 validation refuses 1/2 coding by name — Cox must reuse that exact message.
- `stats2.ts` — `normalCdf`, `chiSquareP`, `gammp`/`gammq`; private `rankWithTies(xs)` →
  `{ranks, tieSum}` (midranks); `mannWhitneyU` / `wilcoxonSignedRank` → `RankTestResult
  {statistic, z, p, n1, n2}`, **normal approximation only** (tie + continuity corrected; zeros
  dropped, as R); `adjustPValues(p, "holm")` (verified: reproduces pingouin's Holm values for
  the bushtucker pairs to 5 s.f.).
- `stats.ts` — `fTestP(F, df1, df2)` (verified: FRACTIONAL df work; GG F(1.5985, 11.1898) →
  p = 0.0625841, as SciPy), `tTestP`, `pairedTTest`, `oneWayAnova` (η²/ω²), `incompleteBeta`,
  `gammaln`, `formatP`.
- `nonparametric.ts` — `friedman(blocks)` (one row per subject, ragged refused, Conover tie
  correction; = SciPy `friedmanchisquare` 11.5263, p = 0.0091952), `kruskalWallis`.
- `regression.ts` — `leastSquares` (QR, column-equilibrated), `multipleRegression`, `probit`.
  **No IRLS, no Newton, no logistic regression anywhere** (grep). `linalg.ts` — `inverse`,
  `solve`, `determinant`, `eigenSymmetric`, `qrDecompose`, `multiply`/`transpose`: all that
  Newton–Raphson (a p×p solve) and Mauchly (a det and traces) need.
- `statchart.ts` — `forestPlotSvg(rows, {zero})` (**no log axis**), `boxPlotSvg`,
  `groupedBarSvg`; `plot.ts` — `buildPlotSvg` (has `xScale/yScale: "log"`), `combineSvgs`.
- `tableFeed.ts` — seven shapes incl. `subjects` (WIDE only) and `survival`/`survival-groups`
  (time, event, one group); `dataimport.ts` — `parseCellNumber`, `isDecimalComma`, `hasHeaderRow`.
- Pane — `statList` (taskpane 8324) splits on `/[\s,]+/`; `statDroppedTokens` warns when
  non-numeric tokens are < 50% of a field; `plainDashes` maps only the em dash to "-";
  `assaySig`, `formatP`.

**Missing (verified absent 2026-10-14; there is no hit for cox/coxph/mauchly/greenhouse/
sphericity/"exact p" in src):**
- No Cox model, partial likelihood, Schoenfeld residuals, concordance or adjusted curves.
- No exact null distribution for U or W.
- No parametric repeated-measures ANOVA, sphericity test or ε correction, and no long-format
  subjects reader.

**Probe: 56 calls through the engines and table feeds, in the layouts a life-science user
types or pastes.** They are ranked WRONG > SILENT > RIGHT > MISSING, with the exact output.

*WRONG — a confident number for a different question (12):*
1. **Long-format repeated measures read as wide.** `Subject|Time|Score`, conditions coded
   1/2/3, 3 subjects × 3 times → `feedSubjects` "Read **9 subject rows × 3 conditions: Subject,
   Time, Score**" → Friedman **χ²(2) = 14.7273, p = 0.000634** (true wide data: χ²(2) = 6,
   p = 0.0498). Long is how R, SPSS (restructured), GraphPad "stacked" and LIMS exports write it.
2. **The same table with the subject label merged** is forward-filled nowhere: the note says
   "6 subject rows × 2 conditions: Time, Score. The first column (Subject) was dropped." The
   result is Friedman χ²(1) = 6, p = 0.0143, on a 2-condition design that does not exist.
3. **A mixed design with a group column**, `Subject|Group|T1|T2|T3` with arms coded 1/2, gives
   "4 subject rows × **4 conditions: Group, T1, T2, T3**". The result is χ²(3) = 12,
   p = 0.00738; the truth is χ²(2) = 8, p = 0.0183.
4. **A covariate column becomes a condition**, in `Patient|Age|Day 1|Day 7|Day 14`. The
   result is "3 × 4 conditions: Age, Day 1, …" and χ²(3) = 9, p = 0.0293.
5. **Unheaded subject ids that are not 1..n** (101, 205, 309) become "condition 1".
6. **A transposed table**, `Condition|S1|S2|S3|S4` with conditions as rows, gives "3 subject
   rows × 4 conditions: S1, …". The result is χ²(3) = 8.2, p = 0.0421, which tests SUBJECTS
   (truth: χ²(2) = 8, p = 0.0183). The header word "Condition" in col 0 is the tell.
7. **A start/stop (counting-process) table**, `ID|Start|Stop|Event|Age`, gives "time = **ID**,
   event = Event. The ID column was ignored." Kaplan–Meier then runs on the patient numbers.
   This is a live KM/log-rank defect, independent of Cox.
8. **A typed decimal comma in a list field.** `1,5 2,3 3,1` vs `4,2 5,0 6,6` in Mann–Whitney
   is read as n = 6 + 6 (U = 11, p = 0.294). The intended data is 3 + 3, U = 0, exact
   p = 0.1. `statDroppedTokens` cannot see this because every token is numeric. Wilcoxon
   `1,5 2,5 3,5` vs `1,0 2,0 3,0` is read as 6 pairs, 3 of them zero, so n = 3 of the WRONG
   numbers. The table feed applies the comma rule and a typed field does not. Whether `1,5`
   typed in a list is a decimal or the list [1, 5] is a **product decision**: name it in
   release notes and do not settle it inside a calculator (§E4).
9. **What a Cox user does today: "Multiple regression" on `Time|Status|Age|Dose`.** It gives
   "response = Time; predictors = Status, Age, Dose" and OLS on censored times with the
   event flag as a predictor (coefficient on status −14.9, R² = 0.730). That is a confident
   regression that answers nothing.
10. **Mann–Whitney 3 v 3, `1,2,3` | `4,5,6`.** The product shows p = 0.0809 (normal + CC).
    Exact p = 0.1, the smallest p attainable at 3 v 3. The product reports an impossible p.
11. **Mann–Whitney 6 v 7, U = 1.** Shown p = 0.00534; exact p = 0.00233.
12. **Wilcoxon n = 3, all positive.** Shown p = 0.149; exact p = 0.25 (= 2/2³, the floor).

*SILENT — the answer may be right, but something was dropped without saying so (3):*
- The Cox-shaped table `Patient|Time (months)|Status|Age|Treatment|Sex` through `survival`
  gives a note that names Treatment as ignored. **Age and Sex vanish unmentioned.**
- Wilcoxon on the default with a tied pair prints W = min(W+, W−) = 9 with no W+ or W−. That
  is fine, but the two-sided rule is never stated.
- The approximation is anti-conservative in some cells (3 v 3: 0.081 < 0.1) and conservative
  in others (5 v 5: 0.0122 > 0.00794). The pane always prints "(normal approximation…)"
  but never says that the exact value differs, or by how much.

*RIGHT (keep and pin) (11):* 1/2 status coding refused by row and value · "Censored" inverted
with a note · table-cell decimal commas (12,5 → 12.5) · missing cell / Mean row / text group
in a wide subjects table refused · Wilcoxon unequal lengths refused · "n/a" warned via
`statDroppedTokens` · two-way ANOVA on long `Subject|Time|Score` refused ("needs ≥ 2
replicates" — right, but should point to repeated-measures ANOVA) · log-rank on Gehan χ²
16.79, Peto HR 5.146 [2.351, 11.266], labelled Peto (Cox gives 4.817 [2.147, 10.809]; they
differ by design and the caveat says so) · Friedman on bushtucker 11.5263.

*MISSING (30):* `tryStatsIntent` returns null for "cox regression of time on age and
treatment", "repeated measures anova …", "exact p value mann whitney …", "hazard ratio for
age" and "mauchly test". No Stats calculator offers Cox, repeated-measures ANOVA,
sphericity, ε, an exact rank p, adjusted curves or a Schoenfeld test. That accounts for
every remaining probe row.

## B. Inputs, outputs, figures — per calculator

Registry growth is 22 → **24** (`cox`, `rmanova`). Exact rank p goes INTO the existing
`mannwhitney` and `wilcoxon` entries, not into new calculators: a second Mann–Whitney in
the dropdown would be a trap.

### B1. `cox` — Cox proportional-hazards regression

**Field** (kind `groups`, `table: "cox"`, a new shape). The first line is a HEADER of names.
After that there is one row per subject: time, event (1/0), then one column per covariate.
The default is the Gehan 6-MP table with a `placebo` 0/1 column, chosen so the default
reproduces §D1. Options:
- **ties:** `Efron` (default, as R `coxph`) or `Breslow` (as SAS/Stata default).
- **reference level** for categorical columns: first in order of appearance, or alphabetical
  (as R). The default is alphabetical, so §D values match R without a note.

**The parser does not use `statList`.** A line with any non-numeric token is the header. The
emitted names are sanitised (spaces → `_`). The field is exempt from `statDroppedTokens`,
which would otherwise warn "non-numeric entries ignored (age, dose)" on every run.

**Table feed `cox`** (new). It reuses `pickSurvivalColumns` for time/event (with the
inverted-Censored and 1/2-refusal rules). Every other column is either:
- dropped as an id (`isIdColumn`) and SAID; or
- a numeric covariate; or
- a text/category covariate, dummy-coded k−1 with the reference named. Its note looks
  like: "Stage: reference I; II, III, IV as indicators".

A text column with more than 10 levels is refused ("Patient name has 90 levels — an id, not
a covariate"). A blank covariate cell refuses the row by number: complete-case analysis
done silently is the "silent drop" class. The note lists EVERY column and its role.

**Refusals by name** are the main deliverable:
- **EPV.** Refuse when events / parameters < 10, where parameters means after dummy coding.
  The rule is Peduzzi et al. 1995, J Clin Epidemiol 48:1503 (proportional hazards; the 1996 paper is the logistic one). Output: "3 events for 3
  parameters (1.0 per parameter); Cox estimates need about 10 events per parameter — drop
  covariates or collect more events." Probe evidence: lifelines happily fits the 6-row
  toy (3 events, age/dose/sex), giving sex β = 0.741 with SE 2.84. That is exactly the
  plausible wrong number this rule exists to stop.
- **Separation / monotone likelihood.** Refuse naming the covariate when, at the cap or at
  convergence, |β_j|·SD(x_j) > 10 or SE_j·SD(x_j) > 25; a pre-check on binary/categorical
  columns first finds a level holding every event, or none, in every risk set. Output:
  "every event occurred with x = 1, so the hazard ratio is infinite — no finite estimate
  exists". Oracle evidence: on the separated 10-row table statsmodels returns β = 26.47
  (SE 165747) and lifelines β = 18.06 (SE 2468) — two "answers" to a question with none.
- **Non-convergence.** Newton–Raphson starts at β = 0. Step-halving is used whenever ℓ
  decreases (at most 10 halvings). The iteration cap is 30, **checked before each
  iteration's work** (R `iter.max` = 20). Convergence is |Δℓ| ≤ 1e-9·|ℓ| (R's `eps`). When
  the cap is hit: refuse, never "last iterate". Size caps come BEFORE any work: ≤ 5,000
  subjects and ≤ 20 parameters, because each iteration is O(n·p²).
- **Other named refusals:** start/stop (counting-process) columns ("time-varying covariates
  are not supported; give one row per subject"); strata; a zero-variance covariate;
  collinear covariates, naming the pair (QR rank test via `leastSquares`'s pivot rule);
  fewer than 2 events.

**Output** (text; every math string obeys the display contract):
- A header line: "Cox regression (Efron ties): n = 42, 30 events, 1 covariate (30 events per
  parameter)".
- Per covariate: "placebo: β = 1.5721 (SE 0.4124), HR = 4.817 (95% CI 2.147 to 10.81),
  z = 3.81, p = 0.00014". Write **"to"** inside CIs. Never use "–": `plainDashes` only maps
  the em dash, and an en dash or hyphen between two positive numbers reads as a minus sign
  in a Word paragraph.
- The three global tests on one line each: likelihood ratio, Wald and score, each with χ²,
  df and p.
- Harrell's concordance C.
- The PH check, under its own heading:
  - The scaled-Schoenfeld test per covariate and GLOBAL (the classic Grambsch–Therneau
    approximation, KM time transform, §D1).
  - A line like "age: χ²(1) = 11.03, p = 0.0009 — the effect of age changes over time; its
    single HR is an average".
  - A violated PH assumption is a caveat, not a refusal.
- HR direction is spelled out: "HR > 1: a one-unit increase in age multiplies the hazard by
  1.019".
- Caveats: ties method used; the CI is a Wald CI; concordance is not calibration; Peto's
  log-rank HR differs by design.

**Figure** (`combineSvgs`, one document):
1. **Forest plot of HR on a LOG axis**, with the reference line at 1. `forestPlotSvg` needs
   a `log: true` option. On a linear axis, HR 0.5 and HR 2 are not equidistant from 1 and
   every protective effect looks small.
2. **Adjusted survival curves**, S(t | x) = S₀(t)^exp(x′β) with the Breslow baseline:
   - one curve per level of the FIRST categorical covariate, other covariates at their mean
     (continuous) or reference level (categorical), with the reference values printed in
     the legend;
   - if the first covariate is continuous, curves at its mean and at mean ± 1 SD;
   - never "all covariates at the mean": a mean of a 0/1 column is a patient who does not
     exist. Cap the curves at 6.

### B2. Exact rank p in `mannwhitney` and `wilcoxon`

**Method.** This is the exact CONDITIONAL permutation distribution given the observed ties
(the coin/StatXact method), by dynamic programming on DOUBLED midranks (integers):
- Mann–Whitney: the distribution of the rank sum over all C(N, n₁) subsets.
- Wilcoxon: the distribution of W⁺ over all 2ⁿ sign vectors, with zeros dropped first
  (Wilcoxon's convention, as R).

The DP carries **probabilities, not counts**: C(60, 30) ≈ 1.18e17 > 2⁵³, so float counts
lose exactness. Without ties this reproduces the classical tables and R's
`wilcox.test(exact = TRUE)`. With ties R refuses ("cannot compute exact p-value with ties")
and falls back to the normal approximation. **We do not refuse:** the conditional exact p is
well defined, and we label it "exact (conditional on the ties)".

**Two-sided rule:** p = min(1, 2·min(P(T ≤ t), P(T ≥ t))). This is R's convention and
SciPy's `permutation_test`. For an asymmetric tied distribution it differs from coin's
P(|T − μ| ≥ |t − μ|); see §D2 (0.0433 vs 0.0281). State the rule in the output.

**Switch rule** (state it in every output):
- Exact when n₁ + n₂ ≤ 60 (Mann–Whitney) or n ≤ 60 non-zero differences (Wilcoxon). The DP
  cost is n₁·N·N(N+1) ≈ 6.6 M steps at the cap, so it is instant.
- The normal approximation with tie and continuity correction is ALWAYS shown beside the
  exact p, labelled. The reported p is the exact one.
- Above the cap only the normal approximation is shown, with "n above 60: the normal
  approximation is accurate here".

Output adds W⁺ and W− (Wilcoxon), U₁ and U₂ (Mann–Whitney), and the attainable minimum p,
e.g. "with 3 v 3 no p below 0.1 is possible". `RankTestResult` gains
`{pExact?: number, exactConditional: boolean, pNormal: number}`. `p` stays the reported
value, so existing callers stay right.

**Figure:** keep the box plots. Optional: a bar chart of the exact null distribution with
the observed statistic and both tails marked, as a second panel via `combineSvgs`.

### B3. `rmanova` — repeated-measures ANOVA (one within factor; two-way mixed)

**Field** (kind `groups`, `table: "subjects-between"`, a NEW shape — `feedTable(shape, rows)`
cannot know its caller, so Friedman keeps plain `subjects`). Typed: one row per subject, one
value per condition; an optional between-subject label is the FIRST token and must be
non-numeric (`Drug 10 12 14`). The feed emits a sanitised word (numeric arm codes 1/2 become
`arm_1`/`arm_2`, `Dose 10` becomes `Dose_10`) so `statList` can never read a level as a value;
the `rmanova` parser reads its own label token and is exempt from `statDroppedTokens`. The
C↔D interface, frozen at step 1: `rmAnova(rows: number[][], groups?: string[], opts?:
{posthoc: "holm" | "none"}) → RmAnovaResult | {ok: false, reason}`. Option **post-hoc**:
Holm-adjusted paired t (default) or none.

**Table feed `subjects` gets the long reader and the guards (§A WRONG 1–6), as named rules:**
- **(a) LONG detection.** A column whose values repeat in runs or blocks, with an id/subject
  header or repeating integers, PLUS a condition column whose levels repeat once per subject.
  Pivot to wide. The note says "Read long format: Subject × Time → Score, 3 subjects ×
  3 times". A subject missing a condition is refused by subject id. Merged subject labels
  are forward-filled and said so.
- **(b) A group column** (`CATEGORY_EXACT` header, or text, or repeating integers) becomes
  the BETWEEN factor in `subjects-between`. Plain `subjects` (Friedman) refuses it by name ("Friedman has no between-subject
  factor — use Repeated-measures ANOVA"). It is never a condition.
- **(c) A covariate column** (Age, Weight, Sex, or BMI by header) is dropped and SAID. It is
  never a condition.
- **(d) Unheaded first columns** of distinct integers outside 1..n are refused as "an id or
  a measurement — add a header row". That is a question, not a guess.
- **(e) Transposed tables.** If the col-0 header matches condition/time/visit/week/day, or
  the header row reads S1…Sn / Subject 1…, refuse with "subjects are in COLUMNS — transpose
  the table (one row per subject)". Same rule for Friedman.

**Output:** condition means ± SD and n; the ANOVA table (condition, subjects, error: SS, df,
MS, F, p); **Mauchly's W** with χ², df and p (R `mauchly.test`'s second-order Box term, with
R's quirk of k, not k−1, in w₂); **ε for Greenhouse–Geisser and Huynh–Feldt** plus the lower
bound 1/(k−1), HF printed RAW and capped at 1 for the df; corrected df and p one line each
("GG: F(1.60, 11.19) = 3.79, p = 0.0626"); partial η² = SS_cond/(SS_cond + SS_error);
Holm-adjusted paired comparisons.

**Which p leads.** The output SAYS which p it leads with. Rule: GG when ε_GG < 0.75,
otherwise HF (the Girden 1992 convention). Mauchly's p must never pick the correction.
State that Mauchly has low power at small n and that the ε rule does not depend on it.

**Mixed design.**
- Between-group F, plus within and interaction F with ε from the **pooled within-group**
  covariance (df N − g). This is R `anova.mlm` / SPSS, and verified equal to pingouin
  `mixed_anova`.
- Unbalanced groups are allowed for the F tests of a one-within / one-between design.
- **HF for g > 1 has two formulas:** the original (N, as SPSS) and Lecoutre 1991
  (N − g + 1, as R `car`/`stats`). Print the one built, NAMED. The recommendation is
  Lecoutre, matching R.

**Figure:** a profile plot (`buildPlotSvg`):
- condition means with **within-subject** 95% CIs (Cousineau–Morey, with Morey's 2008
  √(k/(k−1)) correction and t(n−1)) and a line for each
  subject in light grey (cap at 40 subjects, stated on the figure);
- one mean line per group in the mixed design;
- a caption naming the CI type, because between-subject CIs on a repeated design
  overlap and mislead.

## C. Build order, honest limits, and the parallel split

**Order:**
1. Engines in parallel: A `cox.ts`, B `exactRank.ts`, C `rmAnova.ts`. Each is pure, each has
   its own `__tests__` file, and each meets §D before integration.
2. Then D integrates: table feeds, figures, pane, ratchets and TEST-SCRIPT.
3. Then an INDEPENDENT adversarial pass over the whole diff (house rule), aimed at the
   layouts humans type: long, merged, mixed, transposed, start/stop, decimal comma, a
   categorical covariate with a rare level, a separated covariate, EPV at exactly 10.
4. §D is the exit test. The full QC runs before deploy.

**Build split. Files are disjoint; `taskpane.ts` has exactly one owner.**

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — Cox** | `src/lib/cox.ts` (new); `src/lib/__tests__/cox.test.ts` (new); `src/lib/__tests__/fixtures/larynx.json`, `rossi.json` (new — exported from lifelines' `datasets/larynx.csv` and `rossi.csv`; Klein & Moeschberger §1.8 / Rossi et al. 1980) | `survival.ts`, `linalg.ts`, `stats2.ts`, `regression.ts` |
| **B — exact rank** | `src/lib/exactRank.ts` (new); `src/lib/stats2.ts` (`mannWhitneyU`/`wilcoxonSignedRank` gain the exact fields; export `rankWithTies`); `src/lib/__tests__/exactRank.test.ts` (new); `stats2.test.ts`, `stats2.adversarial.test.ts`, `statsAuthorities.test.ts`, `chartOverflow.test.ts` (every direct caller outside the pane — grep `mannWhitneyU\|wilcoxonSignedRank`; `p` now comes from the exact path, so any pinned normal-approx value WILL change: update it to the exact value, never loosen it) | `stats.ts` |
| **C — RM ANOVA** | `src/lib/rmAnova.ts` (new, signature in §B3); `src/lib/__tests__/rmAnova.test.ts` (new) | `stats.ts` (`fTestP`, `pairedTTest`), `stats2.ts` (`adjustPValues`, `chiSquareP`), `linalg.ts` |
| **D — integrator** | `src/lib/tableFeed.ts` + `tableFeed.test.ts` + `tableFeed.adversarial.test.ts` (long/mixed/covariate/transposed/start-stop rules, new `cox` shape); `src/lib/statchart.ts` (forest `log` option) + its test; `src/taskpane/taskpane.ts` (STAT_CALCS `cox`, `rmanova`, MW/WX text, `statDroppedTokens` exemption); `scripts/pane-audit.js`; `scripts/figure-layout-run.ts`; `scripts/check-figures.js`; `statCalcDefaults`/`statsFigureFidelity` tests; `docs/TEST-SCRIPT.md`; search/examples entries | engine APIs from A–C, frozen at the end of step 1 |

B owns `stats2.ts`; C must not touch it. If A needs a log-axis forest plot for its own
tests, it asks D; it does not edit `statchart.ts`.

**Honest limits (say them in the UI):**
- **Cox:** no time-varying covariates, strata, frailty, interactions, splines or competing
  risks; Wald CI only (no profile likelihood); ties Efron or Breslow, no "exact" (discrete)
  method — so with tied event times the score test does NOT equal survdiff's log-rank
  (Gehan: Efron 17.25, Breslow 15.93, log-rank 16.79; never write a test claiming it does;
  pin the equality on an UNTIED dataset). The PH test is the Grambsch–Therneau
  APPROXIMATION (R `survival` < 3.0, lifelines); R ≥ 3.0 `cox.zph` computes a different
  statistic and will not match to 3 s.f. Concordance is Harrell's C (check the 0.690042
  Gehan value against R before claiming agreement). Adjusted curves use the Breslow
  baseline; R `survfit.coxph` after an Efron fit uses Efron increments and differs slightly
  at tied times.
- **Exact rank:** n ≤ 60; no Hodges–Lehmann estimate or exact CI; no one-sample Wilcoxon
  against a median (MISSING today; follow-ups).
- **RM ANOVA:** one within factor, optionally one between; no two within factors, no
  ANCOVA. Missing cells refused by subject ("a linear mixed model handles missing visits;
  this calculator does not"). Mauchly needs n ≥ k: refused by name below that (§D3).

## D. Acceptance audit (independent oracle beside every value)

### D1. Cox
Oracles: lifelines 0.30.3 (`CoxPHFitter`, Efron) and statsmodels 0.15.0 (`PHReg`,
`ties="efron"` and `"breslow"`). The two agree to 6 s.f. on every coefficient and SE below.

**Gehan / Freireich 6-MP**, the arrays already used in `survival.test.ts`. Covariate:
placebo = 1, 6-MP = 0.
- **Efron:** β = 1.572125, SE 0.412397, HR 4.81687, 95% CI 2.14651 to 10.80931,
  z = 3.8122, p = 0.000137754.
  - ℓ = −85.008425; LR 16.3517 (df 1, p 5.26092e-05); Wald 14.5326; score 17.2465.
  - Concordance 0.690042 **(single oracle)**.
  - Consistent with the commonly printed R output for the MASS `gehan` example,
    `coxph(Surv(time, cens) ~ treat, gehan)`: coef 1.57, se 0.412, LR 16.35, Wald 14.53,
    score (log-rank) 17.25. These R figures are RECALLED, not re-run. The oracle is
    lifelines + statsmodels; check the R print before quoting it in user docs.
- **Breslow:** β = 1.509191, SE 0.409564; ℓ = −86.379622; LR 15.2109; Wald 13.5783; score
  15.9305.
- **PH test** (single oracle; lifelines + the same formula hand-applied) (KM transform): χ²(1) = 0.0043, p = 0.9476. The rank transform gives 0.0127
  (p 0.9103). The test must state which transform it used.
- **Adjusted S(t)** (Breslow baseline), (6-MP, placebo): t = 5 (0.91679, 0.65805); 10
  (0.80962, 0.36158); 15 (0.69495, 0.17326); 22 (0.56873, 0.06598). Two routes: lifelines and
  a hand-written H₀(t) = Σ d/Σ_R exp(xβ) agree to 5 d.p. (statsmodels' `baseline_cumulative_hazard`
  does NOT match either; do not use it as an oracle). The Efron-increment baseline (the R
  `survfit.coxph` variant) gives t = 5 (0.91504, 0.65202); 10 (0.80262, 0.34676); 15 (0.68532,
  0.16200); 22 (0.55375, 0.05802). Pin whichever is built, named.

**Larynx cancer** (Klein & Moeschberger §1.8, 90 patients, 50 events; 16 tied event times
are what exercise Efron). Covariates: Stage II/III/IV indicators (reference I) and age.
Efron fit:

| covariate | β | SE | HR | 95% CI | p |
|---|---|---|---|---|---|
| Stage II | 0.140040 | 0.462486 | 1.15032 | 0.46468 to 2.84766 | 0.762043 |
| Stage III | 0.642382 | 0.356111 | 1.90100 | 0.94593 to 3.82036 | 0.0712496 |
| Stage IV | 1.705980 | 0.421913 | 5.50678 | 2.40860 to 12.59015 | 5.26732e-05 |
| age | 0.019031 | 0.014258 | 1.01921 | 0.99112 to 1.04810 | 0.181966 |

- ℓ = −187.707365; LR 18.3122 (df 4, p 0.0010722); Wald 21.1490; score 24.7789;
  C = 0.681882.
- Breslow: Stage IV β = 1.693056, age β = 0.018902, LR 18.0670.
- **PH test** (single oracle; lifelines + the same formula hand-applied) (KM transform): Stage II 0.0166 (p 0.8974), Stage III 3.1518 (p 0.0758),
  Stage IV 0.5665 (p 0.4516), age 0.7768 (p 0.3781). **GLOBAL χ²(4) = 4.4670, p = 0.3465.**
  - The global value is self-computed from lifelines' scaled Schoenfeld residuals and
    variance matrix; the same formula reproduces lifelines' per-covariate values exactly.
  - EPV = 50/4 = 12.5, so the model is fitted.
- **Adjusted S(t)**, age at its mean 64.6111, Stage (I, II, III, IV): t = 1 (0.91580, 0.90377,
  0.84602, 0.61608); t = 3 (0.82183, 0.79794, 0.68865, 0.33940); t = 5 (0.68210, 0.64398,
  0.48322, 0.12163).

**Rossi recidivism** (432 subjects, 114 events, 7 covariates), Efron: fin β = −0.379422 (SE
0.191379, HR 0.68426, CI 0.47024 to 0.99568, p 0.0474161); age −0.057438 (SE 0.021999); race
0.313900; wexp −0.149796; mar −0.433704; paro −0.084871; prio 0.091497 (SE 0.028649).
- LR 33.2659 (df 7), Wald 32.1126, score 33.5287, C = 0.640329. These agree with Fox &
  Weisberg's appendix "Cox Proportional-Hazards Regression for Survival Data in R" as
  recalled (fin −0.379, LR 33.27, Wald 32.11, score 33.53). Confirm against the PDF before
  citing it.
- **PH test** (single oracle; lifelines + the same formula hand-applied) (KM): age χ² 11.0303 (p 0.0009), wexp 7.4755 (p 0.0063); global χ²(7) =
  17.6584, p = 0.0136. The two flagged covariates must produce the "effect changes over
  time" caveat.

**Refusals:**
- The 6-row `Time|Status|Age|Dose|Sex` table (3 events, 3 parameters) → the EPV refusal,
  quoting "3 events for 3 parameters".
- Separation: `time 2..11, event 1,1,1,1,1,0,0,0,0,0, x = event` → the separation refusal
  naming x (oracles disagree: 26.47 vs 18.06).
- The Larynx table with "Stage" as text I/II/III/IV → identical to the indicator version,
  with the note "Stage: reference I".
- The start/stop table → the counting-process refusal.
- A 1/2 status column → the existing refusal text.
- **Must FIT (guards against over-eager refusal):** near-separation, `time 2..11, x =
  1,0,1,1,1,0,0,0,0,0, event = 1,1,1,1,0,0,0,0,0,0` → β = 1.739384 (SE 1.158889), and with
  `event = 1,1,1,1,1,1,0,1,0,0` → β = 2.267651 (SE 1.138015); lifelines and statsmodels agree to
  6 s.f. Note these have EPV < 10, so the test calls the engine with the EPV gate OFF; it
  pins the separation detector, not the gate. **EPV boundary:** events/parameters = 10.0 fits
  (Larynx + one extra numeric column: 50 events / 5 parameters); 9.x refuses.
- The Cox-shaped table in **multiple regression** → refuse naming the event/status column:
  "a censored time is not a response — use Cox regression".

### D2. Exact rank tests
Oracles: SciPy `mannwhitneyu(method="exact")` and `wilcoxon(method="exact")` without ties.
With ties: `permutation_test(n_resamples=inf)`, which is exhaustive. Both are confirmed by
a brute-force enumeration over all subsets and sign vectors in Fractions.

| input | statistic | exact p | normal+CC (shown beside) |
|---|---|---|---|
| MW `1,2,3` / `4,5,6` | U = 0 | **0.1** (min attainable) | 0.0808556 |
| MW `1..5` / `6..10` (the shipped default) | U = 0 | **0.00793651** (= 2/252) | 0.0121858 |
| MW `0.8 1.1 1.3 1.9` / `2.1 2.4 2.6 3.0` | U = 0 | **0.0285714** | 0.0303828 |
| MW `12 15 11 18 14 13` / `22 19 25 17 21 24 20` | U = 1 | **0.00233100** | 0.00534099 |
| MW `1 2 2 3` / `2 3 4 5` (ties) | U = 2.5 | **0.2** conditional | 0.136658 |
| MW `1 1 2 2 3` / `2 3 3 4 4 5` (ties, asymmetric) | U = 3 | **0.0432900** (2·min); coin's \|T−μ\| form gives 0.0281385 — say which | 0.0316334 |
| WSR default `125 115 …` / `110 122 …` (1 zero dropped, 1 tie) | n = 7, W⁺ = 19, W− = 9 | **0.46875** | 0.446873 |
| WSR `10 12 14 16 18` / `9 10 11 12 13` | n = 5, W⁺ = 15 | **0.0625** | 0.0590582 |
| WSR `8.2 7.1 6.5 9.0 5.4 7.7` / `7.0 7.3 5.1 8.2 5.0 6.1` | n = 6, W⁺ = 20 | **0.0625** | 0.0591721 |
| WSR `11..20` / `1..10` (all \|d\| = 10, tied) | n = 10, W⁺ = 55 | **0.00195313** (= 2/1024) | 0.00190420 |
| WSR `1.5 2.5 3.5` / `1.0 2.0 3.0` (tied) | n = 3, W⁺ = 6 | **0.25** | 0.148915 |
| WSR `1 2 3 4 5 6` / `0 0 1 2 4 5` (all tied) | n = 6, W⁺ = 21 | **0.03125** | 0.0320149 |

Two more acceptance items:
- A 31 v 30 Mann–Whitney (N = 61) → the normal approximation only, and the switch line is
  printed.
- A DP self-check: the null probabilities sum to 1 within 1e-12, and the exact p is pinned
  against brute force on 200 random tied small-n cases. That brute force is an
  independent route; keep it in the test.

### D3. Repeated-measures ANOVA
Oracles: pingouin 0.7.0 (`rm_anova(correction=True)`, `sphericity`, `epsilon`,
`pairwise_tests(padjust="holm")`, `mixed_anova`) and SciPy (`f.sf`), corroborated by a
direct NumPy computation.

**Bushtucker data** (Field, *Discovering Statistics Using SPSS*, 3rd ed., ch. 13: 8
participants × 4 animals; the rows are `8 7 1 6 / 9 5 2 5 / 6 2 3 8 / 5 3 1 9 / 8 4 5 8 /
7 5 6 7 / 10 2 7 2 / 12 6 8 1`). Field's printed values, as recalled (W = .136,
p = .047, ε_GG = .533, ε_HF = .666, F(3, 21) = 3.79, p = .026, GG p = .063, HF p = .048),
all match the oracle to the digits given. Confirm the page and output number before citing.
- SS: condition 83.125, subjects 17.375, error 153.375.
- F(3, 21) = 3.793806, p = 0.0255703; partial η² = 0.351480.
- **Mauchly:** W = 0.136248, χ²(5) = 11.405981, **p = 0.0468458**. This is the R/pingouin
  second-order form. Plain χ² gives 0.0438990; Anderson's w₂ (using k−1) gives 0.0467733.
  Pin the R form.
- **ε:** GG 0.532846, **HF 0.665764** (original formula; one group, so it equals
  Lecoutre), lower bound 1/3.
- **GG:** F(1.598537, 11.189757), p = 0.0625841. **HF:** F(1.997291, 13.981036),
  p = 0.0483306. Lead with GG (ε < 0.75).
- **Holm paired t** (df 7), raw → adjusted: 1–2 0.002023 → 0.010116; 1–3 0.000941 →
  0.005645; 1–4 0.226730 → 0.906918; 2–3 0.920075 → 0.920075; 2–4 0.298672 → 0.906918;
  3–4 0.402042 → 0.906918.
- Friedman on the same data is unchanged: 11.526316, p = 0.00919516 (SciPy).
- Cousineau–Morey 95% half-widths **(single oracle)** around the means 8.125, 4.25, 4.125,
  5.75: 1.76288, 1.46375, 2.18446, 3.22438.

**Well-conditioned set** (`10 12 14 / 9 11 15 / 12 13 16 / 8 10 13 / 11 14 15 / 10 11 14`):
F(2, 10) = 79.0, p = 7.47229e-07, partial η² = 0.940476; W = 0.852245, p = 0.726321; ε_GG =
0.871266; **HF raw > 1 → capped 1.000** (print both); Holm 1–2 0.002913, 1–3 0.000135, 2–3
0.002913.

**n < k** (3 subjects × 4 conditions, `1 2 4 3 / 2 3 5 5 / 1 4 4 6`) → **refuse Mauchly by
name** ("needs at least as many subjects as conditions: 3 < 4 — the covariance of the
contrasts is singular"). F(3, 6) = 10.7826, p = 0.00787 is still reported, with ε_GG =
0.366597 only as the lower-bound-like caveat, or refuse ε as well. Builder's choice; it
must be stated. Oracle evidence for the trap: pingouin prints W = 2.9e-17, χ² = 27.50,
p = 0.00105, which is a plausible wrong number from a singular matrix.

**Mixed design** (groups Drug × 4 and Placebo × 4, 3 times; rows `10 12 14 / 9 11 15 /
12 13 16 / 8 10 13 | 11 11 12 / 10 12 11 / 12 12 13 / 9 10 10`):
Group F(1, 6) = 0.898204, p = 0.379855; time F(2, 12) = 54.409091, p = 9.6005e-07, partial η²
0.900677; interaction F(2, 12) = 24.681818, p = 5.59269e-05; pooled-within W = 0.898760
(p 0.76579), ε_GG = 0.908068 (pingouin and the direct pooled-within computation agree). HF raw:
original 1.4973, Lecoutre 1.2803 — both cap to 1, so this set does NOT discriminate the HF
formulas: add an R- or SPSS-checked set before claiming which HF a mixed design prints; until
then label it "Lecoutre (as R)" and keep it out of the acceptance claim.

**Table-feed acceptance** (§A WRONG 1–7 must flip):

| input | expected |
|---|---|
| long `Subject\|Time\|Score` (numeric codes) | 3 × 3 wide, Friedman χ²(2) = 6 |
| merged-subject long | same, with the forward-fill noted |
| `Subject\|Group\|T1\|T2\|T3` | Group is the between factor (`rmanova`); Friedman refuses by name |
| `Patient\|Age\|Day 1…` | Age dropped and said |
| unheaded 101/205/309 | refused, asking for a header |
| transposed `Condition\|S1…` | the transpose refusal |
| `ID\|Start\|Stop\|Event\|Age` in Survival and Log-rank | refused as counting-process data; never "time = ID" |
| Cox-shaped table in Survival | the note names EVERY ignored column (Age, Sex, Treatment) |

## E. Codebase-specific risks

1. **Ratchets.** `scripts/pane-audit.js` `BASELINES.stats = {figures: 22, total: 22}` → 24/24
   IN THE SAME COMMIT as the two calculators, both of which must DRAW. `check-figures.js`
   `CORPUS_FLOOR = 183` is being moved by other builders (LP/splines): D reads the live value
   at integration and adds +3 (HR forest on log axis, adjusted curves, RM profile; +1 if the
   exact-null panel ships). `statCalcDefaults.test` replays `statGroups` on every default, so
   the `cox` default (header + rows, no blank lines) and the `rmanova` default must compute;
   `searchIndex.test` counts STAT_CALCS.
2. **The table feed's "numbers only" text** (`statList` keeps every numeric token) is
   incompatible with named covariates. `cox` parses its own header and is exempt from
   `statDroppedTokens`, or every run warns about its own column names. A covariate NAME
   with a digit ("Dose 10") is sanitised to `Dose_10` and must never become a value.
3. **The subject-shape heuristics are a mapping surface** (memory: "a heuristic added to fix
   a mapping defect is itself a mapping surface"). Each of the new rules (long, group,
   covariate, unheaded-id, transposed) gets its own test AND the second adversarial pass
   on the fix. Friedman shares `subjects`, so every rule changes Friedman too. Pin
   Friedman's existing behaviour on the tidy wide layouts in the same commit.
4. **The typed comma rule** (§A 8) is product-wide and unresolved for typed list fields.
   Do not fix it ad hoc in `statList` inside this release. Raise it as its own decision;
   the new calculators' notes must state how a typed comma was read.
5. **Newton safety.** Cap iterations BEFORE work, step-halve, refuse at the cap. Centre
   covariates (as R) and accumulate risk sets in log-sum-exp, or exp overflows at β·x ≈ 710
   (Rossi's age is harmless; a user's raw dose in µg is not). `solve` returning null on a
   singular information matrix must become the collinearity refusal, never "NaN".
6. **Ties bookkeeping.** Efron needs the tied-death sets processed in one block per distinct
   time. Sorting by time with deaths BEFORE censorings at equal times is the R convention
   (a subject censored at t is in the risk set at t). The Gehan 6-MP arm has deaths AND a
   censoring at both t = 6 and t = 10, so a wrong order changes the fit: pin β = 1.572125.
7. **Display contract.** Typeset β, χ², ε_GG/ε_HF, W⁺, η²_p and HR in result text (never
   `chi2`, `eta^2`, `HR=4.8(2.1-10.8)`); fractional df to 2 decimals ("F(1.60, 11.19)");
   CIs say "to" — `plainDashes` does not cover the en dash and a hyphen reads as minus.
   `formatP` floors tiny p ("p < 0.001"); acceptance compares engine values, not strings.
8. **The forest plot on a linear axis is a wrong figure that looks right.** Add
   `forestPlotSvg(..., {log: true})`: ticks at 0.25/0.5/1/2/4, the reference at 1, and
   refusal of non-positive bounds. Rasterise the INSERTED SVG, not the pane preview
   (memory: "preview is not insert").
9. **Adjusted curves at the covariate mean** describe a non-existent patient for 0/1 columns.
   Use per-level curves and print the reference values (§B1). Cap at 6 curves.
10. **The two-sided rule changes values by up to 1.5×** on tied asymmetric data (§D2). It
    must be stated in the output and pinned in a test. Do not "fix" it toward coin later
    without a note.
11. **Exact DP precision.** Use probabilities, not counts: C(60, 30) > 2⁵³. Doubled midranks
    make the tied DP integer-indexed. Check that Σ = 1 to 1e-12.
12. **Mauchly at n ≤ k−1 is singular.** pingouin's W ≈ 0 and p = 0.001 are plausible and wrong.
    Use `determinant` with a relative tolerance, or a rank check, BEFORE the log. Refuse by
    name. GG/HF ε must be ≤ 1 by construction (GG) or capped (HF, raw shown).
13. **Peto vs Cox HR.** The log-rank calculator's HR (5.146) and Cox's HR (4.817) will sit
    next to each other in user documents. The Cox output names Peto in a caveat and the
    log-rank caveat already names Cox, so leave both as they are and pin them.
14. **The `multiregress` steal** (§A 9). The rows feed must refuse a header naming status,
    censor or event (reuse `headerRole`) with the pointer to Cox. Typed data without a
    header cannot be caught: note that as the residual risk.
15. **Unbounded loops freeze Word.** Fix all caps before any work: the Newton iteration
    cap, the step-halving cap, n ≤ 5,000 and p ≤ 20 for Cox; N ≤ 60 for the exact DP;
    subjects ≤ 500 and conditions ≤ 20 for RM ANOVA; 40 profile lines and 6 survival curves
    in the figures. Each cap sets a stated refusal, never a partial result.
