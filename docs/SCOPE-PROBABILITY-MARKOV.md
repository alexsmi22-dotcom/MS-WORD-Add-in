# Scope — Solve domain: probability (named distributions, Bayes, Markov chains)

_Written 2026-10-14 at v2.130.0, from a read-only audit of the stats numerics, the
discrete-math engines, linear algebra and the equation-kind routing, plus a 73-input
probe driven through the lib-level entry points the pane calls (the probe file was
deleted; its findings are in §A). Audit-first, per the house method: build against this,
wrong answers first. The acceptance inputs in §D are the release's exit test. Planned
as v2.131.0._

## A. What exists, what is missing

**Stand on (all `src/lib/`):**
- `stats2.ts` — `erf` (exported), `normalCdf(z)`; `gammp`/`gammq` (regularised incomplete
  gamma, series + continued fraction, **not exported** — only `chiSquareP` is). `gammq(k+1, λ)`
  IS the Poisson CDF and `gammp(k, x/θ)` IS the gamma CDF: export them. `fisherExact2x2`
  carries a private hypergeometric log-pmf (line ~400).
- `stats.ts` — `gammaln` (Lanczos), `incompleteBeta(x,a,b)` (the beta CDF, hence binomial
  CDF and t/F); `describe()` reports sample AND population SD; `tCritical(alpha, df)`.
- `power.ts` — `tCdf`, `fCdf`, `tUpper`, `fUpper`, `nctCdf`, `ncfCdf`, and a private
  `quantile(cdf, p)` bisection (interval 1e-12, hi doubles to 1e6): the generic numeric
  inverse. Export it.
- `regression.ts` — `probit(p)` (Acklam, |rel err| ≈ 1.2e-9; one Newton step with
  `normalCdf` makes it 1e-15): the normal quantile / invNorm / z-score for p.
- `combinatorics.ts` — exact BigInt `binomial(n,k)`, `factorial`, `permutations`,
  `multisetPermutations`; `tryCombinatorics` already parses `10 choose 3`, `C(10,3)`,
  `P(10,3)`, prose "how many ways…", and `findUnmodelledCondition` is the pattern for
  refusing a word problem with a clause the model did not read.
- `cas.ts` — `Rat` (BigInt) with `ratAdd/Sub/Mul/Div`, `parseRatLiteral("0.4")` → 2/5,
  `fmtRat`. **Second, unrelated `class Rat` in `recurrence.ts`** — never import that one.
- `systems.ts` — `rref(m: Rat[][])` exact: the stationary-distribution solver (πP = π,
  Σπ = 1) and (I − Q)⁻¹ for absorbing chains, with no float.
- `linalg.ts` — `parseMatrix` (rows on lines or `;`, cells by comma/space — NOT `[[…]]`),
  `multiply`, `inverse`, `solve`, `eigenSymmetric`, `eigenvaluesGeneral` (eigenvalues only,
  no eigenvectors — fine as the independent cross-check "1 is an eigenvalue, all others
  |λ| ≤ 1", not as the solver). No matrix power.
- `graphs.ts` — `strongComponents` (irreducibility = one SCC), `bfs` levels (period), and
  `graphSvg(g, {caption, edgeLabels})` draws DIRECTED graphs with self-loops and per-edge
  labels: the state diagram for free, once a stochastic matrix is turned into a `Graph`.
- `statchart.ts` `groupedBarSvg` (stationary / pmf bar chart), `plot.ts` `buildPlotSvg`,
  and the pane's `solveFunctionSvg` which already supports `shadeBetween` and `marks`
  (the shaded-tail figure) — but see "missing".
- `algebraTools.ts` `VerbResult` and the verb chain in `taskpane.ts` (~27742–27850);
  `multivarRouting.test.ts` is the template for asserting the wiring on the pane source.
- `wordproblem.ts` — percentage / rate / proportion templates; `pasteMath.ts`
  `normalizeTaskProse`, `hasProseWords`, `foldPastedMath` (λ→`lambda`, μ→`mu`, σ→`sigma`).
- Stats mode (`STAT_CALCS`, 22 calculators: descriptive, t-tests, ANOVA, Tukey, Dunnett,
  regression, nonparametrics, chi-square, survival, power…) — **no distribution, quantile,
  z-score or confidence-interval calculator exists anywhere.** The nearest things are
  `tCritical`, `tUpper` and `probit` used internally by the tests and by `power`.

**Missing (everything below is new):**
- No distribution object: no pmf/pdf, no binomial/Poisson/geometric/hypergeometric/
  exponential/uniform/gamma/beta/t/χ²/F front door, no quantile verb, no mgf, no CLT.
- No Bayes / conditional-probability reader; `P(A|B)` is read by `parseExpr` as absolute-
  value bars (solve.ts 284–335) and by the discrete kind as propositional OR.
- No Markov engine; nothing in the equation kind reads `[[…]]` at all.
- No combinatorial-probability prose templates (dice, coins, urns, birthday).
- `parseExpr`'s `EVAL_FN` has no `C`, `choose`, `!`, `Phi`, `erf` — `C(10,3)*0.4^3*0.6^7`
  is "Couldn't parse that equation".
- `VerbResult.svg` is DEAD on the equation-kind path: the pane renders only `verb.plot`
  (grep: no `verb.svg` in taskpane.ts; the discrete kind renders `dr.svg`). And `plot`
  carries no `shadeBetween`/`marks`, so a verb cannot shade a tail today.

**Probe (73 curriculum inputs through the equation kind's chain; discrete and word kinds
too).** Discrete kind: "Not recognised" for all 73 (or a `DiscreteError` on `=`/`>`/`∩`;
`P(A|B)` → "Two things side by side … write & for and, | for or"). Word kind: null for
all 73. Equation kind, by class:

- **Handled correctly: 0** (1 ambiguous: `variance of 1, 2, 3, 4, 5, 6` → sample variance
  3.5, a legitimate reading of that wording).
- **Handled WRONG — a confident number for a different question: 15.** The signature
  defect is `extractSingleEquation` + the solver taking the first `name = number`:
  - `poisson lambda = 2.5 P(X = 0)` → "lambda = 5/2"
  - `geometric p = 0.2 P(X = 3)` → "p = 1/5"
  - `hypergeometric N=50 K=5 n=10 P(X=1)` → "N = 50"
  - `binomial mean and variance n=20 p=0.3` → "n = 20"
  - `95% confidence interval for the mean, xbar = 50, s = 10, n = 30` → "xbar = 50"
  - `E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5` → "X = 1"
  - `lambda = 2.5, P(X = 0) = e^-lambda` → "lambda = 5/2"
  - `n = 10, p = 0.4, P(X = 3) = C(n,3) p^3 (1-p)^7` → "n = 10"
  - `10 choose 3 * 0.4^3 * 0.6^7` → "Polynomial form: 0.053747712·choose^1 + 0 = 0 … choose = 0"
  - `binomial 10 0.4` → "binomial = 0" · `normal 100 15 120` → "normal = 0"
  - the stats-intent steal (`mean|mode|variance` fire on a list of numbers):
    `uniform on (0, 10) variance` → "sample variance = 50" (answer 25/3);
    `beta(2, 5) mode` → "mode = no mode (every value occurs once) … mean = 3.5";
    `beta(2, 5) mean` → "mean = 3.5" (answer 2/7);
    `variance of [1,2,3,4,5,6] equally likely` → "sample variance = 3.5" (answer 35/12).
- **Refused / misrouted, no number: 57.** 14 reach the inequality path on `<`/`≤`/`>`
  (`binomial n=10 p=0.4 P(X <= 3)`, every `P(X > …)`, `P(-1.96 < Z < 1.96)`, CLT) and get
  the generic "outside that, so nothing is reported"; 20 are "Couldn't parse that equation"
  (`P(X = 3) for binomial …`, `invNorm(0.975)`, all five Markov inputs, `pmf of binomial(5,
  0.5)`, `normalcdf(1.96)`, `1 - (5/6)^4`, `C(10,3)*…`, every Bayes line with `|`); 16 are
  "more than one unknown (expected, value, of, a, die)" (`z-score for 0.975`, `normal
  quantile 0.95`, `chi-square 3 df p = 0.05 critical value`, `expected value of a die`,
  `birthday problem 23 people`, `probability of at least one six in four rolls`, both mgf
  lines, `cdf of normal at 1.96`); 5 are the stats-intent "I need the values as a list"
  (`exponential lambda 0.5 mean`, `gamma shape 2 rate 3 mean`, `confidence interval 95%
  mean 50 sd 10 n 30`, `mean of binomial 20 0.3`, `standard deviation of poisson 4`); 2
  Bayes lines are read by `readFnDefinition` as "P(A) = … is a function DEFINITION" and
  refused for the wrong reason.
- **Missing engine: 73 of 73.** Nothing answers any of them.

## B. Syntax and output

Prefix verbs in the equation kind's verb slot, tried FIRST in the chain (before
`tryMultivar`) and guarded in `transformVerb` so the derivative/limit/stats-intent prose
switches stand aside. The guard, `PROB_VERB_RE`, claims: a distribution name at the start
(`binomial|binom|poisson|normal|gaussian|t|student|chi-?square|chisq|f|exponential|
uniform|geometric|hypergeometric|gamma|beta|negative binomial|bernoulli`), `P(` anywhere
(also `Pr(`, `prob(`), `quantile|invNorm|z-score|critical value|percentile`,
`bayes`, `markov|transition matrix|stationary|absorbing|irreducible|steady state`,
`expected value|E[`, `mgf|moment generating`, and the prose-probability openers
(`probability (of|that)`, `odds`, `birthday`, `dice|die|coin|cards?|bag|urn|marbles?`).

| Verb | Examples | Output / verification |
|---|---|---|
| `<dist> <params> <query>` | `binomial n=10 p=0.4 P(X <= 3)` · `binomial(10, 0.4) P(X = 3)` · `poisson λ = 2.5 P(X ≤ 2)` · `normal(100, 15) P(X > 120)` · `normal mean 100 sd 15 P(85 < X < 115)` · `t 12 df P(T > 2.1)` · `exponential rate 0.5 P(X > 3)` · `hypergeometric N=50 K=5 n=10 P(X=1)` | Value line: exact fraction when the distribution is discrete and the parameters are rational (`419904/1953125 ≈ 0.214991`), else 6 s.f. with "≈". Formula line in Solve grammar that re-parses: `120*(2/5)^3*(3/5)^7` (the `C(10,3) = 120` step is text, because `parseExpr` has no `C`). For continuous: the z-line `(120 - 100)/15 = 4/3` as math, `P = 1 − Φ(4/3)` as text. Verified two ways: exact vs float (discrete), and CDF vs Simpson of the pdf (continuous), complement identity `P(X>k) = 1 − P(X≤k)`. Figure: pmf bars with the queried bars filled / pdf curve with the tail shaded (`shadeBetween`). |
| `<dist> <params> mean/variance/sd/mode/median/mgf/pmf/cdf at k` | `binomial n=20 p=0.3 mean and variance` · `uniform(0, 10) variance` · `beta(2, 5) mode` · `gamma shape 2 rate 3 mean` · `exponential rate 2 mgf` · `pmf of binomial(5, 0.5)` | Exact where the formula is rational (`6`, `21/5`, `25/3`, `1/5`, `2/3`); `mgf` as a Solve-grammar line in `t` (`2/(2 - t)`, with `t < 2` as text). `pmf` tabulates every k with exact fractions and draws the bars. |
| `quantile <dist> p` · `z 0.975` · `invNorm(0.975)` · `critical value <dist> alpha` | `quantile normal 0.975` · `z-score for 0.975` · `critical value chi-square 3 df alpha 0.05` · `quantile t 12 0.975` | `1.95996`; closed-form for uniform/exponential (exact), `probit`+Newton for normal, bisection (`power.quantile`) elsewhere, tolerance stated ("to 1e-9"). Verified by CDF(quantile) = p. Figure: pdf with the quantile marked and the lower p shaded. |
| `bayes P(A)=…, P(B|A)=…, P(B|¬A)=…` · `P(A and B) = 0.2, P(B) = 0.5, P(A|B)` | `bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05` | `P(A|B) = 2/13 ≈ 0.153846`; the total-probability line `P(B) = 0.01*0.9 + 0.99*0.05 = 117/2000`; exact rationals. Accepts `¬A`, `not A`, `A'`, `A^c`. k hypotheses `P(H1)=…, P(E|H1)=…` supported. Refuse: probabilities outside [0,1], priors not summing to 1, `P(A|B)` asked with only `P(A)` and `P(B)` (independence must be stated, never assumed). Figure: probability tree (4 leaves) with the two B-branches highlighted. |
| `expected value of …` / `E[X] for X = …, p = …` | `expected value of a fair die` · `E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5` · `variance of 1..6 equally likely` | `7/2`, `35/12` (POPULATION moments — the verb claims "equally likely", "fair", "die" before the stats intent); refuse when weights do not sum to 1. |
| prose probability (templates, by name) | `probability of at least one six in four rolls` · `roll two dice, probability the sum is 7` · `flip a fair coin 10 times, exactly 7 heads` · `a bag has 3 red and 5 blue; two drawn without replacement; P(both red)` · `birthday problem 23 people` | Exact fractions (`671/1296`, `1/6`, `15/128`, `3/28`), decimal `0.507297` for the birthday product; the counting line uses `combinatorics.binomial`. Outside the templates: refuse naming the clause (`findUnmodelledCondition` pattern) — never guess. |
| `markov [[…]] stationary` · `markov [[…]] from (1,0) steps 3` · `markov [[…]] classify` · `markov [[…]] absorbing` | `markov chain [[0.9, 0.1], [0.5, 0.5]] stationary distribution` · `transition matrix [[0.5,0.5],[0.2,0.8]] after 3 steps from (1,0)` · `absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps` · `is the chain [[0,1],[1,0]] irreducible` | π as exact fractions `(5/6, 1/6)` via `rref` over `Rat`; n-step by exact repeated squaring `(61/200, 139/200)`; classification: irreducible (one SCC), period (gcd of cycle lengths), absorbing states, transient classes; limit distribution reported only when irreducible AND aperiodic, else "stationary exists; no limit (period 2)" by name; absorbing: `N = (I−Q)⁻¹`, `t = N·1`, `B = N·R` exact. Verified: πP = π exactly; `eigenvaluesGeneral` shows eigenvalue 1 and all |λ| ≤ 1; row sums of Pⁿ = 1. Figures: state diagram (`graphSvg`, directed, self-loops, edge labels = probabilities) and the stationary bar chart. |
| `clt n=30 mean 50 sd 10 P(xbar > 52)` · `confidence interval 95% mean 50 sd 10 n 30` | | `z = 1.09545`, `P = 0.136661`; CI: both the z-interval (σ known, `46.4216 .. 53.5784`) and the t-interval (`t(29) = 2.04523`, `46.2659 .. 53.7341`), stating which the user's wording implies (`sd`/`σ` → z, `s`/`sample sd` → t) rather than picking silently. Not in Stats mode today — this is the first CI calculator; the t-test calculators' own intervals stay where they are. |

Labels (`P(X ≤ 3) =`, `π =`) live in the text layer; every mathematical string stays Solve
grammar so `solveDisplayContract.test.ts` applies unchanged. Geometric distribution:
"trials" convention by default and SAID (`P(X = 3) = (4/5)^2 * (1/5) = 16/125, X = number of
trials`); `failures` in the input switches it. Refusals by name: unknown distribution;
parameters out of range (`p = 1.2`, `n` not an integer, `λ ≤ 0`, `df ≤ 0`); a continuous
`P(X = 3)` ("is 0 for a continuous X — did you mean P(X ≤ 3)?"); a non-stochastic matrix
(a row summing to 0.999 is refused with the sum shown, not rounded); periodic chain asked
for a limit; `P(A|B)` without the joint; normal approximation to a binomial is a separate
explicit verb (`normal approximation binomial n=100 p=0.3 P(X <= 25)`) that STATES the
continuity correction it applied — never applied implicitly.

## C. Build order and honest limits

1. **Kernel `src/lib/probdist.ts`** — one `Distribution` record per name: support, params
   validation, `pmf/pdf`, `cdf`, `quantile`, `mean/var/mode/median/mgf`. Reuse: `erf`/
   `normalCdf` (stats2), export `gammp`/`gammq` (Poisson, gamma, χ²), `incompleteBeta`
   (binomial CDF cross-check, beta, t via `power.tCdf`, F via `fCdf`), `probit`+Newton,
   exported `power.quantile`, `combinatorics.binomial`/`factorial` + `cas.Rat` for the
   exact discrete path (binomial, geometric, hypergeometric, discrete uniform, negative
   binomial). Limits, stated in output: exact fractions only while the fraction prints in
   ≤ 40 characters (else 6 s.f. with "exact value available on request" dropped — just the
   decimal, labelled "≈"); numeric CDFs to 1e-12 absolute (continued fractions capped at
   300 terms — past that, refuse rather than return the partial sum); numeric quantiles to
   1e-9; `n ≤ 10 000` for exact binomial (the `CAPS.BINOMIAL_N` cap already in place).
2. **Verb `tryProbability` in `src/lib/probability.ts`** + `PROB_VERB_RE`; parameter
   grammar (named `n=10 p=0.4`, positional `(10, 0.4)`, prose `mean 100 sd 15`, Greek
   folded by `foldPastedMath`); query grammar `P(X op k)`, `P(a < X < b)`, `P(X = k)`,
   `≤ ≥ ≠`, `at least/at most/more than/fewer than k`. The fold note "Greek letters read as
   variables: λ → lambda" must be suppressed for this verb (it is the distribution's own
   parameter, not a variable).
3. **Figures** — extend `VerbResult.plot` with `shadeBetween` and `marks` (pass-through to
   `solveFunctionSvg`), and make the pane render `verb.svg` (bars, tree, state diagram)
   the way the discrete kind renders `dr.svg`. Add every new figure kind to
   `scripts/figure-layout-run.ts` and raise `CORPUS_FLOOR` in `check-figures.js` (175 now).
4. **Bayes / conditional** — exact `Rat`; the `|` must be split BEFORE `parseExpr` (which
   turns bars into `abs(`). Tree figure.
5. **Prose probability `src/lib/probWords.ts`** — templates: k-of-n Bernoulli (coins,
   dice "at least one"), two-dice sums, urn with/without replacement (`binomial`-based
   hypergeometric), birthday, "and/or" of independent stated events. Refuse by name
   outside the templates (reuse `findUnmodelledCondition`).
6. **Markov `src/lib/markov.ts`** — parse `[[…]]`, `;`-rows or line-rows (convert to
   `parseMatrix` form; decimals via `parseRatLiteral` so 0.1 is 1/10 exactly); stochastic
   check; classification via `graphs.strongComponents` + period by gcd; stationary via
   `systems.rref`; n-step by exact squaring (`steps ≤ 1000`); absorbing analysis; limit
   `n ≤ 12` states (rref over `Rat` is O(n³) BigInt — 12 keeps denominators printable;
   above that, refuse by name, or offer floats labelled as such). Float entries that are
   not short decimals (e.g. 1/3 typed as 0.3333) are refused with the row sum shown.
7. **CLT / CI verbs** — `tCdf`, `tUpper`, `probit`; both intervals, wording-driven.
8. **Normal approximation to binomial** with the correction stated — last, and only
   because textbooks ask for it; the exact binomial is always printed beside it.
9. Routing test `probabilityRouting.test.ts` (on the pane source, as `multivarRouting`),
   display-contract additions, `examples.ts`/kind hints, an independent adversarial pass
   over the diff (house rule), then the §D list as the exit test.

## D. Acceptance audit

Every expected value below was computed independently (own BigInt rationals and own
Simpson quadrature; standard tables for the two χ²/F critical values), 6 s.f.

Discrete: `binomial n=10 p=0.4 P(X = 3)` → 419904/1953125 ≈ 0.214991 · `binomial n=10
p=0.4 P(X <= 3)` → 3733209/9765625 ≈ 0.382281 · `binomial n=10 p=0.4 P(X >= 4)` →
6032416/9765625 ≈ 0.617719 · `binomial n=20 p=0.3 mean and variance` → 6, 21/5 (sd
2.04939) · `pmf of binomial(5, 0.5)` → 1/32, 5/32, 5/16, 5/16, 5/32, 1/32 (sums to 1, drawn)
· `flip a fair coin 10 times, exactly 7 heads` → 15/128 ≈ 0.117188 · `poisson λ = 2.5
P(X = 0)` → e^(−5/2) ≈ 0.0820850 · `poisson 2.5 P(X <= 2)` → 0.543813 · `poisson 2.5
P(X >= 3)` → 0.456187 · `λ = 3, P(X ≥ 2)` → 0.800852 · `standard deviation of poisson 4`
→ 2 · `geometric p = 0.2 expected value` → 5 (trials; "4 failures before the first
success" stated) · `geometric p = 0.2 P(X = 3)` → 16/125 = 0.128 (trials), 64/625 with
`failures` · `hypergeometric N=50 K=5 n=10 P(X=1)` → 45695/105938 ≈ 0.431337 · `… P(X=0)`
→ 82251/264845 ≈ 0.310563 · `expected value of a fair die` → 7/2 · `variance of
[1,2,3,4,5,6] equally likely` → 35/12 ≈ 2.91667 (NOT 3.5) · `E[X] for X = 1, 2, 3 with
p = 0.2, 0.3, 0.5` → 23/10 · `expected value 0.2*10 + 0.8*(-1)` → 6/5.

Continuous: `normal(100, 15) P(X > 120)` → 0.0912112 (z = 4/3) · `normal mean 100 sd 15
P(X < 85)` → 0.158655 · `normal(100,15) P(85 < X < 115)` → 0.682689 · `cdf of normal at
1.96` → 0.975002 · `P(-1.96 < Z < 1.96)` → 0.950004 · `z-score for 0.975` → 1.95996 ·
`quantile normal 0.95` → 1.64485 · `t 12 df P(T > 2.1)` → 0.0287725 · `quantile t 12
0.975` → 2.17881 · `critical value chi-square 3 df alpha 0.05` → 7.81473 · `chi-square 3
df P(X > 7.81)` → 0.0501051 · `critical value F 3 20 alpha 0.05` → 3.09839 · `exponential
rate 0.5 P(X > 3)` → e^(−3/2) ≈ 0.223130 · `exponential rate 0.5 mean and median` → 2,
1.38629 · `uniform(0, 10) variance` → 25/3 (NOT 50) · `gamma shape 2 rate 3 mean` → 2/3
(variance 2/9) · `gamma shape 2 rate 3 P(X < 1)` → 0.800852 · `beta(2, 5) mode` → 1/5
(mean 2/7 ≈ 0.285714, NOT 3.5) · `beta(2, 5) P(X < 0.3)` → 0.579825 · `mgf of exponential
rate 2` → 2/(2 − t), t < 2 · `normal(100,15) P(X = 120)` → refusal (continuous, suggests
≤) · `binomial n=10 p=1.2 P(X=3)` → refusal by name.

Bayes / prose: `bayes P(A)=0.01, P(B|A)=0.9, P(B|¬A)=0.05` → 2/13 ≈ 0.153846 · `P(A and
B) = 0.2, P(B) = 0.5, P(A|B)` → 2/5 · `P(A) = 0.3, P(B) = 0.5, P(A|B)` → refusal
(independence not stated) · `probability of at least one six in four rolls` → 671/1296 ≈
0.517747 · `roll two dice, probability the sum is 7` → 1/6 · `a bag has 3 red and 5 blue;
two drawn without replacement; P(both red)` → 3/28 ≈ 0.107143 · `birthday problem 23
people` → 0.507297.

Markov: `markov [[0.9, 0.1], [0.5, 0.5]] stationary` → (5/6, 1/6), irreducible, aperiodic,
limit exists · `markov [[0.5,0.5],[0.2,0.8]] from (1,0) steps 3` → (61/200, 139/200);
stationary (2/7, 5/7) · `markov [[0.5,0.3,0.2],[0.2,0.6,0.2],[0.1,0.2,0.7]] stationary` →
(8/35, 13/35, 2/5) · `is the chain [[0,1],[1,0]] irreducible` → yes, period 2, stationary
(1/2, 1/2), "no limit distribution" by name · `absorbing markov chain
[[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps` → N = 5/3 from state 2, absorbed in state
1 / state 3 with probability 1/2 each · gambler's ruin `[[1,0,0,0],[0.5,0,0.5,0],
[0,0.5,0,0.5],[0,0,0,1]]` → expected steps 2 and 2 from states 2,3; P(absorb at 4) 1/3,
2/3 · `markov [[0.6, 0.5], [0.5, 0.5]]` → refusal: row 1 sums to 11/10 · `markov
[[1,0],[0,1]] stationary` → "every distribution is stationary — reducible (2 closed
classes)", not a single π.

CLT / CI: `clt n = 30 mean 50 sd 10 P(xbar > 52)` → z = 1.09545, P = 0.136661 ·
`confidence interval 95% mean 50 sd 10 n 30` → z: 46.4216 .. 53.5784; t(29): 46.2659 ..
53.7341, the choice stated.

## E. Codebase-specific risks

1. **The solver steals `name = number`.** `extractSingleEquation` + `solveEquation` produced
   10 of the 15 wrong answers ("lambda = 5/2", "n = 20", "xbar = 50"). The probability verb
   must sit BEFORE the inequality block and the solver (it does, in the verb slot) and
   `PROB_VERB_RE` must claim any line naming a distribution or containing `P(`; the
   routing test must pin that `P(X = 3) for binomial n = 10, p = 0.4` never reaches
   `extractEquation`.
2. **`P(X = 3)` contains `=`** — `tryComplex` and `tryAlgebraVerb` fall through on `=`;
   `readFnDefinition` reads `P(A) = 0.01` as a FUNCTION DEFINITION of P. Split queries and
   `P(·)=value` assignments on the verb's own grammar before anything calls `parseExpr`.
3. **`≤ ≥ < >` go to the inequality path** (`/[<>≤≥≠]|!=/`) which produced 14 generic
   refusals; `pasteMath.extractEquationsFromProse` also splits on `≤|≥`. The verb slot is
   earlier, so this is only a routing-test item — but `foldPastedMath` is applied before
   the chain, so test with the FOLDED text (`λ` already `lambda`).
4. **`|` is an absolute-value bar** in `parseExpr` (solve.ts 284–335) and OR in
   `proplogic` (`STRONG` regex) — `P(B|A)` must never be handed to either. `¬` is not
   folded by `pasteMath` (`GREEK_NAMES` has no entry) and `~` ("X ~ N(100,15)") is unknown to
   `parseExpr` — the verb grammar reads both itself.
5. **Stats-intent steal.** `tryStatsIntent` fires on `mean|average|median|mode|variance|
   range|standard deviation` before the verb chain and gave 4 wrong numbers (sample
   variance of the PARAMETERS). Add `PROB_VERB_RE` to the `transformVerb` guard; the
   stats-intent must also stand aside for `equally likely|fair|die|dice|distribution`.
6. **`[[…]]` is read nowhere** in the equation kind; `linalg.parseMatrix` wants rows on
   lines or `;`. Convert, and keep exactness: `Number("0.1")` is not 1/10 — go through
   `parseRatLiteral`. Two `Rat` classes exist (`cas.ts` and `recurrence.ts`); only `cas.ts`'s
   works with `systems.rref`.
7. **Display contract.** `parseExpr` has no `C(n,k)`, `!`, `Φ`, `erf`, `E[X]`, `π` as a
   vector: every math line must be written with the coefficient expanded
   (`120*(2/5)^3*(3/5)^7`) and vectors/matrices as text or `bmatrix` through the typeset
   layer only (`mathParse.ts` handles `matrix/bmatrix` for display, not for re-parse).
   `pi` is reserved for π — do NOT name the stationary vector `pi` in any math line (use
   the label in the text layer).
8. **`VerbResult.svg` is dead on this path** and `plot` has no `shadeBetween` — a verb
   that "draws" today draws nothing. Wire both, then add the new figures to the corpus and
   raise `CORPUS_FLOOR` (check-figures.js, 175); `pane-audit.js` BASELINES cover registries
   only, so the Solve figures are guarded by the corpus floor and the display-contract test.
9. **Greek fold notes**: `foldPastedMath` appends "Greek letters read as variables: λ →
   lambda" — true for the solver, misleading under a Poisson verb; suppress for this verb.
10. **Sample vs population** (`describe()` reports both; `statsIntent` prints sample first):
    the verb must say which moment it computed, every time.
11. **Private numerics**: `gammp/gammq` (stats2), `quantile` (power), `betacf` (stats) are
    unexported; export rather than copy ("check for an existing engine before building a
    parallel one"). `probit` alone is 1e-9 — add the Newton polish before claiming 6 s.f.
12. **Unbounded loops freeze Word**: `steps` for n-step powers, Simpson cross-checks and
    continued fractions all need hard caps that set an "incomplete" flag, never a silent
    partial result (house lesson from the fuzzing and unbounded-loop entries).
