# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

## [1.57.0] — 2026-07-15 — ODE: dense output & event detection

The last two gaps in the ODE tool. Both change it from "computes the right
numbers" to "answers the question you actually asked".

**Report at the times you choose** (`OdeOptions.tEval`)
- The table showed whatever steps the solver happened to take. Now you can ask
  for a list (`0, 1, 2.5`) or a range (`0:0.5:10`), and get exactly those rows.
- The values are **computed, not interpolated**: the step size is capped so the
  integrator lands exactly on each requested time, so there is no interpolation
  error to caveat. Verified against closed-form solutions to 8 decimal places,
  and confirmed to cost no accuracy versus an unconstrained run.
- The full step-by-step trajectory is still returned separately, so the plot
  stays smooth even when you ask for 6 table rows.
- Works on both solvers and survives the auto handoff between them.

**Stop on a condition** (`OdeOptions.events`)
- Answers "when does it…?" instead of making you read it off a chart. Supply an
  expression that crosses zero — `z` for "hits the ground", `y - 100` for a
  threshold, `y'` for "at the turning point".
- The crossing is located by bisection, each probe re-integrating from the step
  start, so the reported state is computed rather than interpolated. Direction
  filtering (rising/falling only), non-terminal events that record every
  crossing and keep going, and multiple independent conditions are all supported.
- Projectile check: `z'' = -9.81` from `z' = 20` stops at t = 4.077472 with
  z = 0 and z′ = −20 — the closed form is 20/4.905 = 4.0774719673.

Found and fixed a real design bug while testing: a terminal event only becomes
known AFTER the step that crossed it, and RK45 integrates a quadratic exactly in
~4 huge steps — so the overshooting step carried t all the way to t1. The run
reported `completed: true` and the trajectory continued *underground* past the
event. A terminal event now truncates the solution at the crossing, which is
what "stop when it hits the ground" has to mean. Requested output times past the
event are dropped with it.

Also: the pane treats a terminal event as success (it returns `completed: false`
by design), and tells you plainly when a stop condition never triggered instead
of silently returning a full-range solve.

Suite: **1,698 tests** (was 1,662).

## [1.56.0] — 2026-07-15 — ODE: auto-reduction, RODAS4, richer expressions

Removing the limitations that made the ODE tool feel like a homework exercise
rather than something you would reach for.

**Higher-order ODEs are reduced automatically** (`src/lib/odeParse.ts`)
- `y'' = -0.1*y' - y` with `y = 1, y' = 0` now just works. Previously you had to
  hand-reduce to `y1' = y2 / y2' = -0.1*y2 - y1` — the single biggest papercut in
  a tool whose whole premise is "no code".
- Up to 6th order, several higher-order equations at once, mixed orders in one
  system, `y(0) = 1` or `y = 1` initial-value syntax. Existing hand-reduced
  first-order systems keep working unchanged.
- Errors are specific and actionable: *"Missing an initial value for y'. A system
  of order 2 needs 2: y = …, y' = …"* and *"refers to 'k', which isn't a state of
  this system"* rather than an opaque failure deep in the evaluator.

**4th-order stiff solver — RODAS4** (`src/lib/ode.ts`)
- Hairer & Wanner's RODAS: 6-stage, L-stable, stiffly accurate, with the error
  estimate falling out as k6. Now the default stiff path; the 2nd-order ode23s
  method remains available via `order: 2`.
- Verified by **empirical convergence order**, not by trusting the tableau:
  measured 4.08 for RODAS4 and 2.00 for ode23s on the same harness. A wrong
  tableau cannot produce clean order-4 convergence *and* match analytical
  solutions *and* reproduce ROBER.
- The accuracy/speed trade-off is gone:
  - Van der Pol μ=1000: 9,072 steps / 100 ms → **1,521 steps / 22 ms**
  - Robertson kinetics: 13,286 steps / 146 ms → **570 steps / 8 ms**
  - y′ = −y to ~4e-9: ~4,069 steps → **46 steps** (~90× fewer)
- Honest limit, documented: ultimate accuracy saturates near 1e-12 because the
  Jacobian is a finite-difference approximation.

**Richer expressions everywhere** (`evalFormula`, `src/lib/stats.ts`)
- Was: `sqrt exp ln log sin cos tan abs`. Now adds inverse trig, hyperbolics
  (`tanh` etc.), `cbrt`, `log2`/`log10`/`logbase`, rounding (`floor`/`ceil`/
  `round`/`trunc`/`sign`), `min`/`max`/`clamp`/`hypot`/`pow`, a **true `mod`**
  (sign follows the divisor, unlike JS `%`), a Heaviside `step`, the comparison
  operators `< > <= >= == !=`, and **`if(cond, a, b)`** for piecewise and
  switching inputs. Multi-argument calls are parsed with arity checked.
- This lifts ODE right-hand sides, the optimizer objective, plot expressions and
  uncertainty propagation at once. Fully backward compatible.

Suite: **1,662 tests** (was 1,573) — 27 auto-reduction tests (asserting the
reduction is *physically* right, not just structurally: the damped oscillator,
projectile and stiff 2nd-order cases are each checked against their analytical
solutions) and 62 expression-library tests.

## [1.55.0] — 2026-07-15 — Stiff ODE solver (Analyze)

Closes the biggest real gap in the ODE tool. Explicit RK45 is limited by
*stability* rather than accuracy on stiff systems, so it crawls or dies — and
stiffness is the normal case in chemical kinetics whenever rate constants differ
by orders of magnitude, which is squarely JurisLab's territory.

- **New implicit solver** (`integrateStiff`, `src/lib/ode.ts`) — Shampine's
  modified Rosenbrock pair, the method behind MATLAB's `ode23s`. Linearly
  implicit and L-stable: one LU factorization per step serves all three stage
  solves, with no Newton iteration. Numerical Jacobian and ∂f/∂t by finite
  differences; 2nd order with a 3rd-order embedded error estimate.
- **Automatic stiffness detection** (`solveOde`) — RK45 runs with Hairer's
  DOPRI5 stiffness probe armed (free: it reuses stages already computed). On a
  sustained run of hits it hands the current state to the implicit solver and
  continues, so a system that *starts* benign and stiffens later (Van der Pol)
  is still solved. The result reports which method ran.
- **Solver selector in the pane** — Auto (default) / explicit RK45 / implicit
  stiff, and the result line names the solver used.

What this unlocks, measured:
- **Van der Pol μ=1000** — the standard stiff test. Was: never finished (burned
  200,000 steps). Now: completes in ~9,000 steps / ~80 ms.
- **Robertson kinetics (ROBER)** — the canonical stiff kinetics benchmark, rate
  constants 0.04 → 3×10⁷. Solves in ~205 steps / 3 ms, conserving mass to 12
  digits and converging to a solution stable across rtol 1e-8…1e-10.
- **Stiff linear** — 6,133 RK45 steps → 1,058 stiff steps, and more accurate.
- **Non-stiff is untouched**: the harmonic oscillator still runs on RK45 in 32
  steps; no false switch, no slowdown.

Honest limits, documented in the module and FEATURES.md: the Rosenbrock is 2nd
order against RK45's 5th, so on non-stiff problems it is both slower and less
accurate (y′ = −y at rtol 1e-6: RK45 8 significant figures in 23 steps, stiff ~4
in 188). That is exactly why Auto stays on RK45 unless the problem is genuinely
stiff. Both solvers converge cleanly — error falls monotonically as rtol tightens
— and both still terminate honestly on a finite-time singularity rather than
claiming to integrate past it.

Also fixes a latent UI gap: `AnalyzeField` declared a `select` kind with options,
but the renderer only handled `text` and silently fell through to a textarea for
anything else. No calculator had used `select` before, so it never surfaced.

Suite: **1,573 tests** (was 1,552), including 21 new stiff-solver tests pinned to
analytical solutions and the standard benchmarks. `integrate()` keeps its exact
prior behaviour (stiffness detection is opt-in), verified by regression tests.

## [1.54.0] — 2026-07-15 — Spectra mode (Phase 4: spectroscopy prediction)

Predicted spectra from structure — the last big white space on the analytical
roadmap. All offline. These are **estimates from published additivity rules**,
not acquired spectra and not quantum-chemical calculations; structure detection
is exact, the values are empirical, and every prediction carries its accuracy.

- **New Spectra mode** (22nd tool) — ¹H NMR, ¹³C NMR, IR, UV-Vis and EI-MS
  fragmentation from a name, formula, or SMILES. Insert as a data table or a
  spectrum chart.
- **¹H / ¹³C NMR** (`src/lib/nmr.ts`) — Grant–Paul additivity over the alkane
  skeleton, benzene substituent increments for aromatics, Shoolery-type α/β
  effects for protons. Symmetry-aware signal grouping (OpenChemLib ranks), n+1
  multiplicity with equivalent-nucleus suppression, integration, per-signal
  assignment. Exchangeable OH/NH/COOH reported as flagged nominal ranges.
- **IR** (`src/lib/ir.ts`) — characteristic group frequencies with published
  ranges + a simulated Lorentzian transmittance trace. Carbonyl classes and
  conjugation shifts resolved. Fingerprint region explicitly not predicted.
- **UV-Vis** (`src/lib/uvvis.ts`) — Woodward–Fieser for dienes and enones with
  every increment shown. Out-of-domain inputs are disclosed, never guessed:
  unconjugated → reported transparent (no fabricated λmax).
- **MS fragmentation** (`src/lib/fragment.ts`) — exact fragment m/z via real
  graph cleavage; α-cleavage, benzylic/tropylium, allylic, McLafferty (γ-H
  gated), and feature-gated neutral losses. Likelihood is a ranking, not an
  intensity. Shares the exact-mass scale with `massspec.ts`.
- **Shared graph layer** (`src/lib/molgraph.ts`) — one exact structure detector
  (carbonyl class, substituent classification, ring topology) behind all four
  predictors, so an ester is an ester in every module.
- **Chart builder** (`src/lib/spectraChart.ts`) — δ and wavenumber axes run in
  the conventional (reversed) direction; kept in `lib/` so the convention is
  testable.

Bug-tested per the standing rule — `phase4.adversarial.test.ts` (hostile corpus:
charged, isotopic, radical, macrocyclic, exotic-element, zero-proton, garbage
inputs) plus literature-pinned assertions. The pass **found and fixed 6 real
bugs** before release:

1. sp³ shifts double-counted aromatic/carbonyl groups (toluene CH₃ read 57.9 ppm
   vs 21.4 literature) — Grant–Paul now counts only the alkane skeleton.
2. The same double-count in the ¹H β-term (toluene CH₃ 2.8 vs 2.34).
3. Benzene predicted as a triplet — equivalent nuclei do not split each other.
4. Toluene's tropylium base peak (m/z 91) was missing entirely, and the m/z 77
   phenyl cation was mislabelled "tropylium/benzyl".
5. A bogus high-ranked HO⁺ (m/z 17) for ethanol; α-cleavage was keeping the
   heteroatom rather than the carbon it stabilises (ethanol's real base peak,
   m/z 31, was misclassified).
6. The aromatic ring-walk filtered on atom aromaticity and so crossed biphenyl's
   non-aromatic inter-ring bond, leaking the far ring's increments; and fused
   aromatics (naphthalene) returned a flat 128.5 with no caveat at all.

Full suite: **1,552 tests** (was 1,430), build clean.

## [1.53.0] — 2026-07-15 — In-pane update check (self-update awareness)

For users who installed via the per-user pack (no admin/centralized deployment),
the add-in now surfaces new releases itself instead of relying solely on the
browser cache expiring.

- The build bakes its version in (`__APP_VERSION__`) and emits a `version.json`
  at the site root. On open, the pane fetches `version.json` **cache-busted**
  (`?t=…`, `no-store`) and, if the hosted version is newer, shows a dismissible
  **"Update available — Reload"** banner (`src/lib/version.ts`, unit-tested).
- Fails silently when offline — a failed fetch never nags the user.
- This works around WebView2's stubborn same-origin caching: a pending update is
  now visible and one-click-applyable (and, if a reload is still cached, a Word
  restart forces it). Existing content-hashing of the JS bundle is unchanged.
- Tests: +5 (version comparison); full suite **1430 passing**.

## [1.52.0] — 2026-07-14 — Phase 3: stats breadth + pKa estimation

Fills the thin spots identified on the roadmap.

- **Stats mode — non-parametric & categorical tests** (`stats2.ts`): Mann–Whitney U
  (independent), Wilcoxon signed-rank (paired), chi-square goodness-of-fit and test
  of independence, **two-way ANOVA** (balanced, with interaction), and
  **multiple-comparison correction** (Bonferroni, Holm, Benjamini–Hochberg/FDR).
  P-values come from real distribution functions (normal via erf, chi-square via the
  incomplete gamma). _Tukey HSD deferred — it needs the studentized-range
  distribution; Bonferroni/Holm/BH cover the common correction needs meanwhile._
- **Chemical mode — pKa estimation from structure** (`pka.ts`): a deterministic
  functional-group detector (walks the OpenChemLib atom graph, so an ester is never
  read as a carboxylic acid nor an amide as an amine) that reports the typical
  literature pKa for each ionizable group and an estimated net charge at pH 7.4.
  Clearly labeled as a **group estimate, not a compound-specific prediction** —
  consistent with the "all data must be real" mandate.
- **Bug test:** invariant + adversarial suites for both (known critical values,
  ties, zero cells, false-positive guards for ester/amide/nitrile/pyrrole,
  glycine-zwitterion net charge). No bugs found this round.
- Tests: +57; full suite **1425 passing**.

## [1.51.0] — 2026-07-14 — Analyze mode: Phase 2 numerical breadth (ODE, FFT, optimization)

Adds the three Phase-2 tools that round out the MATLAB-style workbench, all
offline and computed from the user's own numbers:

- **Minimize a function** — Nelder–Mead simplex optimization of a typed objective
  over named variables (`optimize.ts`). Derivative-free; reports the optimum,
  minimum value, and convergence.
- **FFT / frequency spectrum** — radix-2 Cooley–Tukey (`fft.ts`), zero-padding
  non-power-of-two lengths. Returns a one-sided amplitude spectrum, dominant
  frequencies, and a spectrum chart inserted into the document.
- **ODE / system (RK45)** — adaptive Dormand–Prince integrator (`ode.ts`) for
  `y' = f(t, y)` and coupled systems, evaluated via the shared `evalFormula`.
  Inserts a sampled (t, y) table plus a trajectory plot.
- Analyze insertion now also handles **plots** (SVG → PNG) alongside tables/text.
- **Bug test (adversarial):** the pass caught and fixed **two real bugs** —
  (1) the ODE integrator looped forever on a finite-time blow-up (`y'=y²`) because
  a non-finite error made the step size NaN and only accepted steps counted toward
  the cap; termination is now guaranteed. (2) `dominantFrequencies` reported
  zero-amplitude "peaks" for a constant signal; negligible bins are now dropped.
- Tests: +45 (Phase 2 invariant + adversarial suites); full suite **1383 passing**.

## [1.50.0] — 2026-07-14 — Analyze mode: completes the linear-algebra core

Closes Phase 1 of the "compete with MATLAB" roadmap to the letter, adding the
four remaining linear-algebra capabilities as new Analyze tools:

- **Eigenvalues (any square matrix)** — the Francis double-shift QR algorithm
  (Hessenberg reduction + `hqr`) for general non-symmetric matrices, including
  complex-conjugate pairs rendered as `a ± bi`. Complements the existing
  symmetric-matrix path (which also returns eigenvectors).
- **QR decomposition** — A = Q·R by Householder reflections (Q orthogonal,
  R upper-triangular).
- **Singular value decomposition (SVD)** — A = U·diag(S)·Vᵀ by one-sided Jacobi;
  works for any shape, economy form.
- **Matrix expression** — define named matrices and evaluate an expression in one
  line: `A*inv(B) + 2*C'`, `det(A)`, `(A - B)^T`, with +, −, *, /-by-scalar,
  transpose (`'` or `^T`), and inv/det/trace/rank. Dimension mismatches and
  singular inverses surface as clear messages.
- New module `src/lib/matrixExpr.ts`; `src/lib/linalg.ts` gains `qrDecompose`,
  `svd`, `eigenvaluesGeneral`, `formatComplex`.
- **Bug test:** added an adversarial/invariant stress suite
  (`analyze.adversarial.test.ts`) — ~800 random matrices checked against
  Σλ = trace, Πλ = det, A·inv(A) = I, QR/SVD reconstruction, and symmetric-vs-general
  agreement, plus degenerate cases (zero/singular/1×1/complex-spectrum matrices,
  constant/all-missing data columns, malformed expressions). All pass.
- **Fix (found by the bug test):** the Analyze insert button no longer offers to
  insert a non-finite result — a matrix expression that divides by zero renders as
  the "—" sentinel, which is now blocked from insertion (matches the Stats guard).
- **Production polish:** Analyze now inserts matrices as real, right-aligned **Word
  tables** (inverse, solve, QR, SVD, transpose, multiply, eigenvectors, matrix
  expressions) instead of space-padded text that only aligned in a monospace font —
  columns now line up in any document font, and the result is editable. Scalars and
  the data-insights report still insert as text.
- Tests: +69 across the two releases; full suite **1354 passing**.

## [1.49.0] — 2026-07-14 — Analyze mode: no-code numerical workbench (matrix math + data insights)

First milestone of the "compete with MATLAB" roadmap — a new **Analyze** mode
that brings a no-code numerical workbench into Word, computed entirely offline
from the user's own numbers.

- **Linear-algebra core** (`src/lib/linalg.ts`) — solve A·x = b, matrix inverse,
  determinant, rank & trace, transpose, multiply, and eigenvalues/eigenvectors of
  a symmetric matrix (cyclic Jacobi). Gaussian elimination / Gauss-Jordan with
  partial pivoting for stability; singular systems are reported, never faked.
  Non-symmetric eigenvalues are intentionally out of scope (they can be complex).
- **Data → insights engine** (`src/lib/insights.ts`) — paste a data table (tab/
  comma/space-delimited, header auto-detected) and get per-column summaries
  (mean/sd/min/median/max, missing-cell and Tukey-1.5×IQR outlier flags), a ranked
  correlation matrix (Pearson r with p-value + Spearman rho), per-column trend
  detection over row order, and plain-language actionable insights. Reuses the
  tested `stats.ts` p-value machinery.
- **Analyze mode UI** — a tool picker over the above, wired to the existing
  live-compute/insert pattern; nothing leaves the machine.
- Tests: +30 (linalg, insights); full suite 1315 passing.

## [1.48.5] — 2026-07-14 — Edge-case-honesty audit: Stats + legal citations

Swept the Stats, Bio/Assay, and citation/legal modules for the same class of
"confident-but-wrong output on edge inputs" as 1.48.2–1.48.4. Bio/Assay was clean
(fits already gate on convergence; closed-form calculators route non-finite
results through the "—" guard). Fixes:

- **Stats:** CV (coefficient of variation) showed **"Infinity%"** for any
  zero-mean data (e.g. `-5, 5`) because it bypassed the non-finite guard — now
  **"n/a (needs a positive mean)"**. A zero-variance t-test rendered
  **"t(NaN) = -Infinity, p = NaN"**, and constant-x regression showed
  **"slope p = NaN"** — both now return a clear "test is undefined" message.
  `formatP` can no longer emit "p = NaN" anywhere, and ANOVA now requires ≥2
  values per group.
- **Citations — dates:** `formatDate` fabricated impossible dates like
  **"Feb. 31, 2019"**; it now rejects any day beyond the month's length
  (leap-year aware, so `2020-02-29` is valid but `2019-02-29` isn't) and passes
  the raw text through instead.
- **Citations — section symbol:** a single dotted Treasury reg such as
  `1.6011-4` wrongly rendered **`§§`** (the internal hyphen read as a range).
  Compound dotted sections now keep the singular `§`; genuine integer ranges
  (`101-103`) still use `§§`.
- **Table of Authorities:** a full citation introduced by an ordinary
  capitalized word with no comma ("**In** Alice Corp. v. CLS Bank…",
  "**Applying** Mayo v. Prometheus…") glued that word onto the case name,
  producing a wrong, mis-alphabetized, and duplicated TOA entry. Such leading
  prose words are now stripped — while genuine forms are preserved: "In re" /
  "In the Matter of", and litigants like "Under Armour" ("Under" is deliberately
  never stripped). +11 regression tests.

## [1.48.4] — 2026-07-14 — Mass Spec: no ESI adducts for already-charged inputs

- **Mass Spec mode:** the ESI adduct table (`[M+H]+`, `[M+Na]+`, `[M-H]-`, …)
  assumes a *neutral* precursor. It was computed for any input, so a structure
  that already carries a net formal charge — e.g. choline (a permanent
  quaternary-ammonium cation) or an anion like acetate — got physically
  meaningless protonation/cationization m/z values. The panel now detects net
  charge and, when non-zero, omits the adducts with a note
  (*"Input carries a net charge (n+); ESI adducts assume a neutral molecule"*).
  Exact mass and isotope pattern are unaffected and still shown. +4 tests.
  (Audit of Peptide and Mass Spec for the same edge-case-honesty class as
  1.48.2/1.48.3; peptide constitution/masses verified correct, no change needed.)

## [1.48.3] — 2026-07-13 — Hide QSAR estimates for non-organic inputs

- **Chemical mode (properties):** follow-up to the druglikeness gate. cLogP and
  logS are QSAR estimates trained on organic molecules; OpenChemLib returns
  fallback constants (0 and −0.53) for out-of-domain inputs — a bare metal atom,
  a noble gas, or a simple salt — so the panel showed a fake-confident
  "cLogP 0 / logS −0.53" even for water or a gold atom. Those two rows now read
  **"n/a"** for non-organic small molecules. Exact values (MW, formula, tPSA,
  H-bond/rotatable/heavy-atom counts) are shown for every input, unchanged.

## [1.48.2] — 2026-07-13 — Don't claim bare metals/salts are "druglike"

- **Chemical mode (druglikeness):** Lipinski's Rule of Five and Veber are
  upper-bound filters — they only flag molecules that are *too* big/greasy/polar,
  so anything small and nonpolar (a bare gold atom `[Au]`, a noble gas, a simple
  inorganic salt) trivially "passed" every ceiling and showed a green
  **Druglikeness: ✓ pass**. The screens now render only for organic small
  molecules (≥ 1 carbon and ≥ 2 heavy atoms); everything else shows
  **"n/a — applies to organic small molecules"**. Carbon-bearing metallodrugs
  (e.g. auranofin) are still screened normally. Raw properties are unaffected.
  +4 regression tests.

## [1.48.1] — 2026-07-13 — Fix OPSIN "HTTP 404" on unrecognized names

- **Chemical mode (online name→structure):** OPSIN answers HTTP 404 with a
  `FAILURE` JSON body for any name it can't parse — a typo, trade name, or
  non-systematic name. The lookup treated every non-200 as a service outage and
  showed the alarming "OPSIN service error (HTTP 404)". It now reads the 404 body
  and surfaces OPSIN's own explanation (e.g. "… was uninterpretable"); genuine
  outages (5xx / non-JSON) still report an HTTP-status error. +4 regression tests.

## [1.48.0] — 2026-07-13 — Life-science release

Release milestone rolling up the life-science expansion (20 tools total):
- **New modes:** Bio/Assay (enzyme kinetics, dose-response IC50/EC50, binding, lab
  math — offline curve fitting), Mass Spec (monoisotopic/average mass, isotope
  pattern, adduct m/z), Peptide (2D structure from sequence), Stats (t-tests,
  ANOVA, regression, uncertainty propagation).
- **Chemical mode:** physicochemical properties + Lipinski/Veber druglikeness;
  opt-in online IUPAC name→structure via OPSIN.
- **Compound library:** 259 → 359 named structures (violacein &amp; other large
  natural products/steroids/alkaloids/vitamins), all PubChem-sourced.
- **Infrastructure:** content-hashed bundles so updates reach installed clients.
- **Quality:** two adversarial bug-review rounds (15 fixes), ~27 new regression
  tests; 1262 tests total, lint + build clean. Landing page + install packs
  refreshed for distribution.

## [1.47.3] — 2026-07-13

### Fixed (second bug-review round — under-covered modules)
- **LaTeX import: bare delimiter commands** (langle, angle, lfloor,
  lceil, ert, …) now render as their glyphs instead of the literal words
  "langle"/"rfloor" — fixes bra-ket and floor/ceil import.
- **LaTeX import: a script after a fraction** binds to the whole fraction:
  rac{a}{b}^2 → (a/b)², not a/(b²).
- **Botanical: an infraspecific epithet after an author** is now italicized
  ("Quercus robur L. subsp. *robur*") — the sticky roman flag no longer suppresses
  it.
- **Prefs: present-but-invalid stored values** fall back to defaults (type/domain
  validated) instead of propagating (e.g. a corrupt dnaFrame).
- +8 regression tests (1262 total).

### Known limitations (documented, low value / import-only best-effort)
- LaTeX import: set braces { }, a big-operator body scope (∑…+y), and
  delimiter *shape* under leftight are approximate; the import is a
  labeled best-effort — verify the result.

## [1.47.2] — 2026-07-13

### Fixed
- **Double-click no longer inserts twice.** A shared re-entrancy guard on the
  text-insert helper (MS / Stats / Assay / DNA / Finance results) stops a fast
  double-click from queuing two insertions before the first completes.

### Note
- Re-examined the citations T10 report: abbreviating a geographic unit inside a
  company name (Washington Mutual -> Wash. Mutual) is correct Bluebook, matching
  the intended "N.Y. Times Co." behavior — not a bug. The only real defect was the
  hyphenated-compound case (Georgia-Pacific), already fixed in 1.47.1.

## [1.47.1] — 2026-07-13

### Fixed (bug sweep — 4-agent adversarial review)
- **stats: user variables named e or pi were silently shadowed** by the math
  constants in the uncertainty-propagation evaluator, giving wrong values and a
  zero error contribution. Variables now win over constants.
- **massspec: [M+NH4]+ m/z** subtracted the electron mass twice (~0.55 mDa low);
  and the isotope pattern now anchors peak masses to the true monoisotopic mass
  so molecules with an untabled element (Fe, Mg…) no longer show an m/z-0 base
  peak or masses short by that element.
- **properties: Lipinski/Veber** now test the unrounded values (a true tPSA of
  140.03 no longer rounds down to a Veber pass).
- **finance: bondAnalytics** guards maturity < 1 period (was returning NaN via 0/0).
- **assay/stats: Insert** is disabled when the result is a non-value dash, so a
  bare em-dash is never inserted; serial-dilution guards non-numeric/huge counts.
- **peptide: hyphen/space one-letter input** (AC-DE) is read as one-letter codes
  instead of being dropped as invalid three-letter tokens.
- **toa: patents + other authorities** no longer emit two consecutive
  "Other Authorities" headings (both renderers).
- **citations: hyphenated compound parties** keep their state name
  (Georgia-Pacific no longer becomes Ga.-Pacific); formatDate passes impossible
  dates through unchanged.
- **dna: reverseComplement** keeps RNA as RNA (complement of A is U, not T).
- 11 regression tests added (1257 total).

## [1.47.0] — 2026-07-13

### Added (Stats mode — roadmap #6)
- **New Stats tool.** Descriptive statistics (n, mean, SD, SEM, median, 95% CI,
  CV); **t-tests** (two-sample Welch/Student and paired) with p-values and APA
  reports; **one-way ANOVA**; **linear regression** (slope, R², slope p); and
  **uncertainty propagation** (formula + value±uncertainty lines → combined 1sigma).
  Insertable as text.
- New pure : p-values via the regularized incomplete beta
  (Student-t & F tails), plus a small multi-variable formula evaluator driving
  first-order (quadrature) error propagation. 13 tests against known statistical
  values.

## [1.46.0] — 2026-07-13

### Added (Peptide mode — roadmap #5)
- **New Peptide tool.** Draw a peptide 2D structure from its sequence — one-letter
  (ACDEFG) or three-letter (Ala-Gly-Ser) codes — and insert it. Reports residue
  count, molecular formula, and MW; flags unrecognized residues. The structure
  shows connectivity only (stereochemistry is intentionally not drawn, to avoid
  asserting a wrong configuration).
- New pure : sequence parser (one-/three-letter) + SMILES
  builder for all 20 standard residues (free termini, proline ring handled). 28
  tests, including each residue built alone matching its known free-amino-acid
  formula and dipeptides losing one water per bond.

## [1.45.0] — 2026-07-13

### Added (Mass Spec mode — roadmap #4)
- **New Mass Spec tool.** From a name / formula / SMILES: exact **monoisotopic**
  and **average** mass, the theoretical **isotope pattern** (M, M+1, M+2… bars with
  relative intensities — e.g. a chlorine’s ~32% M+2), and common **adduct m/z**
  ([M+H]+, [M+Na]+, [M+K]+, [M+NH4]+, [M+2H]2+, [M-H]-, [M+Cl]-, [M+HCOO]-, [M-2H]2-).
  Insertable as text. For proteomics / metabolomics / small-molecule MS.
- New pure : masses from OpenChemLib, isotope pattern by
  discrete convolution over NIST stable-isotope abundances (C, H, N, O, S, P,
  halogens, Si, Se, B, Na, K; other elements reported, not dropped), exact adduct
  arithmetic. 12 tests cross-check the M peak against OCL and known Cl/S patterns.

## [1.44.0] — 2026-07-13

### Added (opt-in online name→structure — roadmap #2)
- **Resolve arbitrary IUPAC names via the EMBL-EBI OPSIN service.** When the
  offline dictionary does not know a systematic name, a **Resolve name online**
  button (Chemical mode) parses it through OPSIN and draws the returned structure
  offline, reporting its InChIKey. There is no offline OPSIN build, so this is the
  ONE feature that leaves the machine — it is **strictly opt-in**: off until
  clicked, gated behind an **in-pane consent prompt** (Office add-ins can not rely
  on window.confirm) that names the service before the name is sent, consent is
  **per-session**, and it warns against use for confidential names.
- New  (pure URL builder + response parser unit-tested; only the
  fetch touches the network). Verified the service is CORS-enabled for the add-in
  origin. 5 tests (1193 total).

## [1.43.3] — 2026-07-13

### Fixed
- **2D structures no longer look cluttered for stereo-rich molecules.** Suppressed
  the OpenChemLib R/S/"abs" stereo-descriptor text tags in the depiction (Chemical
  and Build modes): on a molecule with many stereocentres (e.g. paclitaxel, 11) the
  CIP/ESR labels piled onto the bonds and overlapped. Wedge bonds still convey the
  stereochemistry; query/R-group labels are unaffected.

## [1.43.2] — 2026-07-13

### Changed
- **Redesigned the property readout for clarity.** Metrics now sit in an aligned
  label/value list (one shared right-hand value column, tabular figures) and each
  druglikeness screen is a PASS/FAIL pill with its criteria on a separate muted
  line — so a many-violation compound (paclitaxel) reads cleanly. Verified at
  task-pane width before shipping.

## [1.43.1] — 2026-07-13

### Changed
- **Tidied the property readout.** Replaced the dot-separated lines (which wrapped
  and broke mid-word for big molecules like paclitaxel) with a compact two-column
  metric grid and **color-coded pass/fail rows** for the Lipinski/Veber screens,
  so a druglikeness-failing compound reads cleanly instead of as a wall of text.

## [1.43.0] — 2026-07-13

### Added (physicochemical properties & druglikeness — Chemical mode)
- Resolving a structure (name / formula / SMILES) now also shows a **property
  readout**: **cLogP**, **logS**, **topological PSA**, **H-bond donors/acceptors**,
  **rotatable bonds**, **heavy atoms**, plus the **Lipinski Rule of Five** and
  **Veber** oral-druglikeness screens with the exact passing/failing criteria.
  Insertable as a text summary. Roadmap item #3 toward winning life-science PhDs
  from ChemDraw (which gates these behind a license tier).
- Computed offline via OpenChemLib's validated estimators (already bundled) — no
  new dependency, no network. New `src/lib/properties.ts`; 6 tests validate
  against known values (aspirin, caffeine, ibuprofen) and a druglikeness-failing
  natural product (paclitaxel). Advisory — estimates, verify before relying.

## [1.42.2] — 2026-07-13

### Fixed
- **Bio/Assay mode now opens.** The tool was added to the home cards and the mode
  switch but not to the top tool-selector `<select>`; clicking the card set an
  unknown value, so `currentMode()` came back empty and the pane showed only the
  dropdown with no calculator. Added the missing `Bio/Assay` option to the
  selector's Biology group.

## [1.42.1] — 2026-07-13

### Fixed (updates now reach installed clients)
- **Content-hashed the bundle filenames** (`taskpane.[hash].js`, dynamic chunks,
  commands) so each deploy is a URL Office/WebView2 has never cached. Previously
  the fixed `taskpane.js` name meant Word kept serving a **stale cached bundle**
  after an update (e.g. the Bio/Assay mode wouldn't appear until the Office web
  cache was manually cleared). The manifest still points at the fixed
  `taskpane.html`, whose script reference now updates every release.

## [1.42.0] — 2026-07-13

### Added (Bio/Assay mode — quantitative life-science tools)
- **New Bio/Assay task-pane mode** bringing offline curve fitting into Word — the
  first step of the chem/math push for life-science PhDs. A Levenberg–Marquardt
  nonlinear-least-squares engine (`src/lib/assay.ts`, pure/Office-free) fits data
  entirely client-side, reports parameters with **standard errors** and **R²**,
  and overlays the **fitted curve on the data** as an insertable plot.
- **Enzyme kinetics** — Michaelis–Menten and Hill fits, k_cat and catalytic
  efficiency, plus the Lineweaver–Burk / Eadie–Hofstee / Hanes–Woolf
  linearizations (which also seed the nonlinear fit).
- **Dose–response** — 4-parameter logistic → **IC50 / EC50**, Hill slope, pEC50
  (agonist and inhibition curves share one model); **Cheng–Prusoff** K_i.
- **Binding** — one-site saturation (B_max, K_d).
- **Lab calculators** — Henderson–Hasselbalch, Beer–Lambert, dilution / serial
  dilution, and A260 / A280 nucleic-acid and protein quantitation.
- 15 tests validate parameter recovery from noise-free and noisy synthetic data
  (total suite 1182). Analysis aid — verify before publishing.

## [1.41.0] — 2026-07-13

### Added (compound library — large & complex structures)
- **100 new named compounds** in the structure dictionary (259 → 359), covering
  the large/complex molecules the library previously lacked: natural-product
  pigments and metabolites (**violacein**, indigo, curcumin, resveratrol,
  quercetin, capsaicin, β-carotene, lycopene, chlorophyll a, genistein,
  catechin, tannic acid), steroids and hormones (cholesterol, testosterone,
  estradiol, progesterone, cortisol, prednisone, dexamethasone, aldosterone,
  cholic acid), alkaloids (morphine, codeine, quinine, atropine, cocaine,
  strychnine, berberine, reserpine, mescaline, psilocybin), larger drugs
  (paclitaxel, amoxicillin, penicillin V, tetracycline, warfarin, sildenafil,
  atorvastatin, omeprazole), and vitamins/cofactors (retinol, cholecalciferol,
  tocopherol, folic acid, biotin, riboflavin, thiamine, ATP/ADP/AMP/GTP, NAD,
  FAD, glutathione, heme b).
- Common **synonym aliases** so users can type the name that comes to mind
  (e.g. taxol → paclitaxel, l-dopa → levodopa, vitamin A/D/E/B-series letters,
  heme → heme b, adenosine triphosphate → ATP).
- Every SMILES is sourced from **PubChem** and validated against OpenChemLib;
  molecular formulas match PubChem exactly, including the metal-containing
  chlorophyll a (C55H72MgN4O5) and heme b (C34H32FeN4O4).

## [1.28.0] — 2026-07-05

### Added (ST.26 feature annotation)
- **Annotate CDS / gene features on sequences.** Each sequence can now carry
  features beyond the mandatory source feature — pick a key (CDS, gene, mRNA,
  misc_feature, sig_peptide, mat_peptide), a location (e.g. `1..300`), and the
  common qualifiers (`/gene`, `/product`, `/note`).
- **CDS `/translation` is auto-generated** from the coding region using the
  verified NCBI genetic code (stops at the first stop codon), with `/codon_start`
  — unless you supply your own. A CDS whose length isn't a multiple of 3, or with
  a non-simple location, is flagged with a reading-frame warning.
- The generated XML stays well-formed (verified) and everything is still labeled
  a drafting aid — **validate in the WIPO Sequence tool before filing** (the
  authoritative validator). Plain sequences without features work exactly as
  before.

## [1.27.0] — 2026-07-05

### Added
- **Numerals: non-parenthesized callouts.** The reference-numeral audit now also
  recognizes the "housing 12" / "housing (12)" house style — matched against a
  table entry's own element name, so a numeral written without parentheses is no
  longer falsely reported "unused" (and it can't turn arbitrary prose numbers
  into false orphans).
- **Citations: unknown-reporter advisory.** When a case's reporter isn't a
  recognized abbreviation, the preview shows a "not a recognized reporter — check
  the Bluebook (Table T1)" note, so a typo'd or wrong-form reporter isn't
  inserted unnoticed.

## [1.26.0] — 2026-07-05

### Added (Tier-2 features)
- **Stacked charts.** Table → Chart adds **stacked column**, **stacked bar**, and
  **stacked area** — the value axis spans the per-category total (handling mixed
  positive/negative), with matching stacked PowerPoint export.
- **Parallel citations.** The case citation type has an optional "Parallel
  cite(s)" field, placed after the primary reporter and before the year per
  Bluebook Rule 10.3.1 (e.g. *… 573 U.S. 208, 134 S. Ct. 2347, 189 L. Ed. 2d 296
  (2014)*).
- **ST.26 mol_type vocabulary.** Each sequence can now pick the correct source
  `mol_type` from the full ST.26 controlled vocabulary — genomic DNA / other DNA
  for DNA; genomic RNA / **mRNA / tRNA / rRNA** / other RNA / transcribed RNA /
  viral cRNA for RNA — instead of always "genomic". Clarified that the tool
  emits the mandatory source feature (valid for plain sequences); CDS/gene
  annotation is done in WIPO Sequence.

## [1.25.1] — 2026-07-05

### Fixed (low-severity bug-hunt cleanups)
- **Plot: one bad function no longer blanks the whole plot.** With several
  `;`-separated functions, a single un-evaluable one is now skipped with a soft
  "Skipped …" note while the valid functions and data still render (it only
  errors when nothing at all can be drawn).
- **Search: late matches aren't dropped.** The match score stays positive, so a
  keyword that appears past character 50 in a long label still shows up.

## [1.25.0] — 2026-07-05

### Added / Fixed (Tier-1 finalization)
- **Graceful capability detection.** Native-equation and field-based Table-of-
  Authorities inserts (which need Word's OOXML API, WordApi 1.3) now check
  support first: on an older Word or a host that lacks it, they fall back with a
  clear message (equations → formatted text; TOA → use the static list) instead
  of throwing a raw error.
- **Reference numerals: sub-part callouts.** `(12a)`, `(12b)`, `(12')` are now
  recognized as base numeral 12, so sub-part callouts aren't reported as
  orphans. The "next numeral" suggestion also ignores incomplete (blank-element)
  rows.
- **Figure insert echoes truncation warnings.** When a table figure/flowchart/
  block diagram exceeds its size limit, the insert confirmation now repeats the
  "only the first N …" warning so a truncated figure isn't inserted unnoticed.

## [1.24.0] — 2026-07-05

### Fixed (comprehensive bug-check pass)
- **Chemistry: polyatomic ions were mis-parsed.** `NH4+` reported N:1 H:1 charge
  +4 (mass 15); now correctly H:4, charge +1, mass 18.04. Fixed across the
  validator (molecular weight/charge) and the formula renderer: a subscript
  count before a bare sign (NH4+, NO3⁻, HCO3⁻, H2PO4⁻, H3O⁺) keeps the count and
  takes a ±1 charge, while a monatomic metal cation (Ca²⁺, Fe³⁺) still reads the
  digit as the charge.
- **Citations:** the patent pincite no longer truncates (`col. 3 ll. 15–20` was
  becoming `col. 3`); a case with an **em-dash** pincite range (`208—216`) now
  parses instead of failing; and `§` vs `§§` is smarter — `1.84(a), (b)` (one
  section, two subsections) stays `§`, while `101, 102` uses `§§`.
- **Math:** a repeated superscript/subscript (`x^2^3`) no longer silently drops
  the earlier one — it nests right-associatively.
- **Figures:** `svgToPngBase64` encodes in chunks, so large flowcharts/diagrams
  no longer risk a stack-overflow during rasterization.
- **Docs:** corrected stale README (version, tool count, test count, and the
  outdated "math is inline-only" note that contradicted the OMML feature).

## [1.23.0] — 2026-07-05

### Added (Finance — robust modeling)
- **The Finance calculator gained a full modeling toolkit** (8 → 18
  calculators), all verified against known closed-form values:
  effective annual rate; growing-annuity PV; **loan amortization** (payment,
  total interest, total paid); **DCF valuation** with a Gordon terminal value;
  **XIRR** for dated cash flows; **bond yield-to-maturity**; **bond duration &
  convexity** (Macaulay + modified); **option Greeks** (Δ Γ vega θ ρ);
  **implied volatility**; **declining-balance depreciation** schedule; and
  **annualized return / volatility / Sharpe** statistics.
- Engine additions in `finance.ts` (+17 tests): a shared robust root-finder
  (scan-for-sign-change + bisection) powers the YTM, implied-vol, and XIRR
  solvers so they don't need a good initial guess. Existing formulas
  (TVM, NPV/IRR, Black–Scholes, bond pricing) re-verified against reference
  values.

## [1.22.4] — 2026-07-05

### Verified
- **Full reference-data audit against current authoritative standards.** Every
  hardcoded scientific dataset was checked against its primary source and found
  correct (only the pKa N-term, fixed in 1.22.3, needed a change):
  periodic table → IUPAC/CIAAW; restriction sites → REBASE; unit factors →
  SI/CODATA; genetic code → NCBI table 1; residue masses → Expasy FindMod;
  hydropathy → Kyte & Doolittle; pKa → EMBOSS iep (`Epk.dat`); primer Tm →
  OligoCalc; 360 compound SMILES → all valid (OpenChemLib); WIPO ST.26 DTD →
  V1_3 (still current); botanical ranks → ICN/ICNCP. Documented the Tm source.

## [1.22.3] — 2026-07-05

### Fixed
- **pI N-terminal pKa now matches EMBOSS iep's data file** (`Epk.dat`): N-term
  8.6 → **7.5**. Verifying against the actual iep data file (not the older
  "EMBOSS scale" of 8.6 reproduced in some tools) showed the shipped value is
  7.5; the other eight values already matched. A side-chain-free peptide now
  gives pI = (7.5 + 3.6)/2 = 5.55, as iep does.

## [1.22.2] — 2026-07-05

### Changed
- **Protein residue masses aligned to Expasy.** Adopted Expasy FindMod's
  full-precision average residue masses (were 2-decimal — Thr was 101.1 vs
  Expasy 101.1051) and Expasy's average water mass (18.02 → 18.01524), so
  protein molecular weight now matches Expasy ProtParam exactly (e.g. AAAA →
  302.33). Selenocysteine recomputed from the verified periodic table
  (150.04 → 150.05, current Se).

## [1.22.1] — 2026-07-05

### Fixed
- **Protein pI now uses the EMBOSS pKa set** (as used by EMBOSS iep/pepstats),
  so the estimate matches that authoritative reference. Corrected N-term
  9.0→8.6, C-term 3.1→3.6, Cys 8.3→8.5, His 6.0→6.5, Lys 10.5→10.8 (Asp, Glu,
  Arg, Tyr already matched). A peptide with no ionizable side chains now gives
  pI = 6.10 = mean of the terminal pKa, exactly as EMBOSS does.

## [1.22.0] — 2026-07-05

### Added / Changed (STEM tools)
- **Full chemical-formula validator.** New `chemValidate.ts` with the real
  118-element periodic table (IUPAC standard atomic weights): the Chemical
  formula tool now validates live — flags **unknown element symbols** (case-
  sensitive: Co ≠ CO) and unbalanced brackets, and for a valid formula shows the
  Hill formula, **molecular weight**, and net charge. Handles nested groups
  (`K4[Fe(CN)6]`), charges (`Ca2+`, `SO4^2-`), and hydrates (`CuSO4·5H2O`).
- **Inline math symbols.** Greek letters by name (`alpha`→α … `Omega`→Ω) plus
  `sum`/`int`/`prod`/`partial`/`nabla`, more relations/arrows (`<=>`, `<->`,
  `=>`, `approx`, `times`), on top of the existing set.
- **Chemical formulas: charges after a count.** `Ca2+`→Ca²⁺ and `[Fe(CN)6]3-`
  now render the trailing sign as a charge (not a subscript).
- **Reaction schemes: reversible & retro arrows.** `<=>` / `⇌` draw an
  equilibrium arrow; `<-` / `←` draw a retrosynthetic arrow.
- **DNA: more restriction enzymes.** The type-II enzyme set grew from 19 to ~48
  (unambiguous sites), e.g. AatII, AflII, AgeI, AscI, DraI, FseI, PacI, PmeI,
  SbfI, SwaI. Also replaced deprecated `String.substr`.
- All added data (atomic weights, enzyme recognition sites, unit factors) are
  real reference values, not placeholders.

## [1.21.0] — 2026-07-05

### Added / Changed (STEM tools)
- **Units — many more units.** Added electrical & EM units (Hz/kHz/MHz/GHz,
  A/mA/µA, V/mV/kV, W/mW/kW/MW/hp, Ω/kΩ/MΩ, F/µF/nF/pF, C, H, S, T/mT), chemistry
  units (M/mM/µM/nM/pM molarity, Da/kDa/MDa, %, ppm/ppb/ppt), and more SI prefixes
  (pm, ns/ps, ng/pg, nL) — with spelled-out aliases (volt, ohm, molar, dalton…).
  The compound-unit parser now handles multiple slashes (`mol/L/s`).
- **Plots — more functions & colors.** The expression evaluator now supports
  multi-argument functions (`atan2`, `min`, `max`, `hypot`, `mod`, `pow`) plus
  `cbrt`, `factorial`/`fact`, and `trunc`, with argument-count validation. The
  series palette grew from 5 to 10 distinct colors.
- **Table → Chart — scatter + K/M/B.** New **Scatter (points)** chart type;
  cell parsing now understands magnitude suffixes (`1.2K` → 1200, `3M`, `2bn`),
  while real unit letters (`12kg`) are left alone.

## [1.20.0] — 2026-07-05

### Added
- **Supra source auto-detection.** On the Supra type, "Detect earlier source"
  scans the document above the cursor for a prior **law-review article**, and
  fills the author with its Bluebook supra short form — surname(s), e.g.
  *Lemley* or *Lemley & O'Brien* — for you to finish with the footnote number /
  pincite. New pure `findPrecedingSecondarySource()`. (Treatises/books are too
  ambiguous to detect from prose, so they remain manual; supra is limited to
  secondary sources per Rule 4.2.)

## [1.19.0] — 2026-07-05

### Changed
- **Field-based Table of Authorities now marks every occurrence** of each
  authority (not just the first), so the compiled table shows the full page
  range for each cite. The status line reports both the authority count and the
  total citations marked.

## [1.18.0] — 2026-07-05

### Added
- **Table of Authorities with real page numbers (Word fields).** A second TOA
  option, "Insert with page numbers (Word fields)", marks each citation with a
  hidden Word **TA** field and inserts **TOA** fields at the cursor; selecting
  all and pressing **F9** compiles the table with page numbers that update as
  the document changes. The original page-number-free "static list" remains.
  New pure `authoritiesForToa()`, `taFieldOoxml()`, `toaFieldsOoxml()` emitting
  flat-OPC OOXML (validated well-formed). Patents share Word's "Other
  Authorities" category (Word has no Patents category). Marks the first
  occurrence of each authority; review the result in Word.

## [1.17.0] — 2026-07-05

### Added
- **Case-name geographic abbreviation (Bluebook Table T10).** The case-name
  abbreviator now also applies U.S. state abbreviations (California → Cal.,
  Massachusetts → Mass., New York → N.Y., …), honoring the named-party
  exception (Rule 10.2.1(f)) — a bare state party (*California v. Texas*) or a
  "State of X" / "City of X" government party stays unabbreviated, while a state
  inside a larger name (*University of California* → *Univ. of Cal.*) abbreviates.
- **Id. preceding-authority detection.** On the Id. type, "Insert Id. for the
  preceding authority" scans the document above the cursor, confirms what the
  Id. refers to, and inserts it (with your pincite). New pure
  `findPrecedingAuthority()`.

### Fixed
- Repaired stray NULL bytes accidentally introduced into `abbreviateCaseName`
  in an earlier edit (output was unaffected; source is now clean).

## [1.16.0] — 2026-07-05

### Added
- **Case-name auto-abbreviation (Bluebook Table T6).** Type the full party names
  and the tool abbreviates them per Rule 10.2.2 — Corporation → Corp.,
  International → Int’l, Association → Ass’n, National → Nat’l, Manufacturing →
  Mfg., `and` → `&`, and ~90 more (with common plurals). "United States" is left
  intact as a party. A checkbox on the case / case short-form types (on by
  default) applies it live in the preview so you can review or turn it off.
  New pure `abbreviateCaseName()` (+4 tests).

## [1.15.0] — 2026-07-05

### Added
- **Table of Authorities builder.** In Citations mode, scan the whole document
  for citations and insert a grouped, alphabetized authorities list — Cases,
  Statutes, Regulations, Patents, and Other Authorities (Fed. Reg., MPEP) —
  de-duplicated, with case names italicized. The scanner recognizes case names
  (including "In re"/"Ex parte" and corporate suffixes like ", Inc."), U.S.C.,
  C.F.R., patents & publications, the Federal Register, and MPEP. Page numbers
  are not included (a text scan can't recover them) — add them, or use Word's
  native TA/TOA fields for automatic pages. New pure `toa.ts` (+11 tests).

## [1.14.0] — 2026-07-05

### Added
- **Citations: id. / supra short forms.** New `Id.` type (`Id.` or `Id. at 217`,
  italic) for the immediately preceding authority, and a `Supra` type
  (`Lemley, supra note 15, at 912`) for an earlier source. Plus a one-click
  **“→ Short form of this case”** helper that turns a full case citation into
  its short form (first party + reporter + pincite) for you to review.

## [1.13.3] — 2026-07-05

### Changed
- **Logo now fuses STEM + legal.** The balance scale's pans are hexagonal
  molecular rings — law (scale) meets STEM (chemistry) in one mark. Regenerated
  at all icon sizes; still legible at 16 px.

## [1.13.2] — 2026-07-05

### Changed
- **New JurisLab logo.** Replaced the ribbon/add-in icon with a balance-scale
  mark in the brand blue, rendered at 16/32/64/80/128 px (source in
  `assets/logo.svg`). Because the icons load from the hosted site, the new logo
  appears in Word without a reinstall (after Office refreshes its icon cache).
  The add-in name was already "JurisLab" (since 1.12.0); the ribbon name updates
  on the next manifest reinstall. Logo also added to the landing page header.

## [1.13.1] — 2026-07-04

### Changed
- **Citations cross-checked against canonical Bluebook example forms.** Each
  type's output was compared to the standard example the Bluebook publishes for
  its rule (R.10 cases, R.12 statutes, R.14 regs/patents/Fed. Reg., R.15/3.2
  treatises, R.16 articles); those canonical forms are now pinned as tests.
  Result: the formats match for the common types. One gap fixed — the
  book/treatise type gained an optional **Volume** field so multi-volume works
  cite the volume before the author (`1 Donald S. Chisum, Chisum on Patents
  § 3.02 (2023)`).
  - Known limitation (documented, not a format error): case names are not
    auto-abbreviated per Table T6 — enter the abbreviated party name. Still a
    drafting aid; verify against the current Bluebook.

## [1.13.0] — 2026-07-04

### Added
- **Citations: practitioner / academic style toggle.** The two Bluebook
  typeface systems now render correctly — *Practitioner* (briefs/office
  actions) italicizes case names and book titles; *Academic* (law-review
  footnotes) sets full-citation case names roman and authors/journals in
  large-and-small caps.
- **Citations: reporter & court auto-correct.** Reporters and courts normalize
  to canonical Bluebook abbreviations (`f3d`→F.3d, `f supp 2d`→F. Supp. 2d,
  `fed cir`→Fed. Cir., `9th cir`/`ninth circuit`→9th Cir., `cafc`→Fed. Cir.,
  `sdny`→S.D.N.Y.), applied both in the paste-parser and when formatting.

### Notes
- Still a drafting aid — it applies common Bluebook conventions (not the full
  manual). Verify against the current Bluebook before filing.

## [1.12.4] — 2026-07-04

### Changed
- **Tool navigation is now a dropdown, not a 16-tab strip.** Once you're in a
  tool, a compact "Tool" dropdown (grouped by category, with a Home option to
  return) replaces the crowded row of tabs. Home still shows only the grouped
  cards. Less clutter on every screen.

## [1.12.3] — 2026-07-04

### Changed
- **Block-diagram numbering keeps the grouped look *and* stays unique.** The
  1.12.2 fix made numbering sequential (100, 102, 104…) to guarantee
  uniqueness. This restores the familiar grouped style — roots at 100/200,
  subsystems at 110/120/130, parts at 112/114 — by computing the stride at
  each level from the actual fan-out and widening it (e.g. to twenties) only
  when a branch is dense enough that the default spacing would collide. Best
  of both: typical figures look classic, dense ones remain collision-free.

## [1.12.2] — 2026-07-04

### Fixed
Comprehensive bug-review pass (parallel subsystem reviews). Verified fixes:
- **Duplicate reference numerals** on dense block diagrams — a subsystem with
  ≥5 parts could reuse the next subsystem's number. Numbering now walks each
  root's subtree in depth-first order (100, 102, 104…), guaranteeing unique
  callouts (was 100/110/112, which collided).
- **Section band labels dropped** in the Table-figure → PowerPoint export — the
  downloaded .pptx showed empty shaded band rows; the section text is now
  carried through (Word-table and on-screen figure were already correct).
- **"See also" / "See, e.g.," mis-parsed as "See"** in Citations paste-and-fix,
  leaking the leftover word into the case name — signals now match longest-first.
- **Section ranges kept singular** — `35 U.S.C. 101-103` / `101–103` now use
  `§§`; a hyphen inside one section number (`42 U.S.C. § 2000e-2`) stays `§`.
- **Negative currency `-$300`** (sign before the symbol) parsed as blank in
  table cells — now reads −300.
- Defensive: off-page flowchart connectors continue past 26 pages (AA, AB…).

## [1.12.1] — 2026-07-04

### Changed
- **Tighter Home page** — the Home view now shows only the header and the
  grouped tool cards; the search bar and the 16-tab strip are hidden there
  (the cards are the navigation). Both reappear once a tool is open, with the
  Home tab to return.

## [1.12.0] — 2026-07-04

### Changed
- **Renamed to JurisLab** (formerly Formula Inserter) — the add-in now fuses
  STEM authoring and patent & legal drafting, so the old name no longer fit.
  Display name,
  pane title, ribbon button, landing page, and docs updated. (The GitHub repo,
  hosting URL, install paths, and content-control tags are unchanged, so
  existing installs and tagged content keep working.)

### Added
- **Home page** — opening the pane now shows a Home tab with the 16 tools
  grouped into categories (Chemistry & structures, Math & units, Data &
  figures, Biology, Patent drafting, Legal citations). Click a card to open a
  tool; the top tabs still switch directly.

## [1.11.0] — 2026-07-04

### Added
- **Paste & fix in Citations.** Paste a messy citation and the add-in detects
  its type and fills the form fields to review — covering U.S.C., C.F.R.,
  patents and application publications, the Federal Register, MPEP, cases
  (distinguished from law-review articles by the case name), and a leading
  Bluebook signal. Then it reformats via the normal formatter (auto-grouped
  patent numbers, §§ for multiple sections, Bluebook dates, correct italics).
  Best-effort/heuristic — the filled fields are shown for review before insert.
  New pure `parseCitation` (+10 parser tests).

## [1.10.0] — 2026-07-04

### Added
- **Citations mode (16th mode) — Bluebook legal citations.** Form-field driven,
  covering cases (full + short), statutes (U.S.C.) and regulations (C.F.R.),
  U.S. patents and application publications, the Federal Register, MPEP
  sections, law-review articles, and treatises. Correct italics (case names,
  titles, signals) are applied on insert; patent numbers auto-group, ISO dates
  become Bluebook month form, multiple sections use §§, and optional
  introductory signals (See, Cf., But see, …) are prepended. Insert the
  formatted citation or copy the plain text. New pure `citations.ts` engine
  (+20 tests). Drafting aid — verify against the current Bluebook.

## [1.9.0] — 2026-07-04

### Added
- **Diagrams paginate across PowerPoint slides.** Big diagrams no longer get
  crushed onto one slide:
  - **Flowcharts** split into slide-sized runs of steps joined by patent-style
    **off-page connector circles** (A, B, …); auto reference numerals continue
    across slides (S101…S105 → S106…).
  - **Block diagrams** split by branch, with the **parent box repeated** on
    each continuation slide; numbering is assigned on the full tree first so
    it stays consistent (110/120/130 on slide 1, 140/150 on slide 2).
  - Continuation slides are titled "… (cont.)"; every slide renders near
    natural size with readable text. Verified by rendering the generated
    slides in PowerPoint itself.

## [1.8.2] — 2026-07-04

### Fixed
- **PowerPoint diagrams now match the preview exactly.** The preview and the
  PPT shape export used two different layout engines, so slides came out
  scrambled. The diagram geometry (boxes, connectors, numerals, wrapped text)
  is now computed once and rendered identically to SVG (preview / Word) and
  to native PowerPoint shapes — verified by rendering the generated slides in
  PowerPoint itself. Shapes remain fully editable.

## [1.8.1] — 2026-07-04

### Fixed
- **Block-diagram (and flowchart) shape text no longer overflows in
  PowerPoint.** Long table-cell labels spilled out of the small boxes. Shape
  text now auto-shrinks to fit (PowerPoint normAutofit), paragraph-long
  labels are truncated with an ellipsis, and hierarchy boxes are sized more
  generously.

## [1.8.0] — 2026-07-04

### Added
- **Flowcharts and block diagrams export to PowerPoint as native, editable
  shapes** (rectangles, decision diamonds, rounded terminators, connector
  lines with arrowheads) instead of a flat picture — so the labels and
  reference numerals are editable in PowerPoint. Honors the patent B&W style.
  (In Word, diagrams remain images; editable movable shapes there would need
  OOXML DrawingML, still to come.)

## [1.7.1] — 2026-07-04

### Fixed
- **Inserted Word tables no longer pick up list numbering.** When the cursor
  sat in (or after) a numbered list, every inserted table cell showed a "1."
  etc. The inserted table's cell paragraphs are now reset to Normal and
  detached from any list.
- **Table figure exports to PowerPoint as a native, editable table** instead
  of a picture — the "table figure" representation now uses a real PowerPoint
  table (shaded/bold header, shaded full-width section bands via colspan,
  right-aligned numeric columns), so the text stays editable in PowerPoint too.

## [1.7.0] — 2026-07-04

### Added
- **Editable output for converted tables.** Figures insert as images (text
  baked in); now you can also get editable text:
  - **Insert as an editable Word table** — inserts the table figure as a
    native Word table (bold/shaded header, shaded section rows, right-aligned
    numeric columns) with fully editable text, instead of a picture.
  - **Also insert the data as an editable table below the figure** — a
    checkbox that follows any inserted figure image with an editable Word
    table of the underlying data, so the text is editable even for charts and
    patent line-art.
  - Shared `prepareTableFigure` logic drives both the image and the Word
    table so they stay consistent.

## [1.6.0] — 2026-07-04

### Changed
- **Reference numerals now use lead lines** (37 CFR 1.84(q)), replacing the
  columnar rail and the inside-the-box numbers:
  - Block diagram: numeral sits outside each box's top-left corner with a
    straight lead line to the box (no longer prefixed into the label).
  - Flowchart: numerals alternate left/right of the steps with angled lead
    lines, instead of stacking in a right-hand column.
  - Table figure: free-standing margin numerals, each with a lead line to its
    row/section, staggered across two lanes (rail removed).
  Placement is auto — a starting point the drafter repositions.

## [1.5.0] — 2026-07-04

### Added
- **Auto-pick representation** — reading a table now classifies its shape and
  preselects the best view (chart / flowchart / block diagram / table figure),
  showing the reason. Numeric data charts; grouped or dense tables become a
  table figure; step lists become flowcharts; short hierarchies become block
  diagrams. Fully overridable in "Show as".
- **Reference numerals** — a toggle to number figure elements as patent
  callouts: hierarchical box numbers in block diagrams (100, 110, 112…),
  auto-numbered flowchart steps (102, 104…), and a numeral rail on the table
  figure (sections 100/200, rows 102/104…).

### Changed
- **Table figure polish** — numeric columns are right-aligned, the header is
  shaded with a rule beneath it, a redundant blank section column is dropped
  (no dead left column), light zebra striping in color mode, and a crisper
  outer border.

## [1.4.0] — 2026-07-04

### Added
- **Table figure** representation in Table → Chart — draws the table *itself*
  as a clean figure (not a chart), for characteristics/reference tables where
  the table is the exhibit. Preserves section grouping (group-header rows
  become bands; a blank leading "section" column merges down), bolds the
  header, word-wraps cells, scales wide tables to the pane, and honors the
  patent B&W style + "FIG. N" label. Non-numeric tables now fall back to a
  table figure instead of erroring.

### Changed
- **Smarter chart column detection** for real-world tables: a leading numeric
  **row-index** column or a mostly-blank **section** column is detected and
  skipped so the true text column is used for labels (the section groups
  them). `8,408 (75.0%)` reads as the leading count; a bare `(75.0%)` is now
  +75, not −75 (accountant-negative parentheses no longer apply to bare
  percentages). Dense tables (>24 rows) suggest the table-figure view.

## [1.3.0] — 2026-07-04

### Added
- **Diagrams in Table → Chart** — not every table is numeric, so the "Show as"
  list now offers, besides the six chart types:
  - **Flowchart** — rows become steps drawn top-to-bottom with arrows; a
    first column like `S101` becomes the step's reference numeral, `?` steps
    render as decision diamonds, Start/End rows get rounded terminators, and
    a `Step | Description` header row is skipped automatically.
  - **Block diagram** — rows are paths (`System 10 | Controller 20 | CPU 22`)
    merged into a connected box hierarchy with orthogonal connectors; blank
    cells repeat the value above (merged cells work).
  - Both honor the patent B&W style and the "FIG. N" label, insert as
    figures, and export to PowerPoint (as pictures). Tables with no numeric
    data now auto-switch to flowchart instead of failing.

## [1.2.0] — 2026-07-04

### Added
- **Patent-figure charts** in the (renamed) **Table → Chart** mode:
  - **Insert figure at cursor** — the chart is inserted into the Word document
    as an image (rasterized at 2× for print quality).
  - **Patent figure style** — black-&-white line art for patent drawings:
    hatched bars/slices, dashed lines with distinct marker shapes, all-black
    ink (no color/gray), and an optional **"FIG. N" label** under the chart.
  - The PowerPoint export honors the style: patent mode ships the same B&W
    figure as a picture (native charts can't draw hatching); color mode keeps
    the fully editable native chart.

## [1.1.0] — 2026-07-04

### Added
- **Table → PPT** mode — export the Word table at the cursor as a **PowerPoint
  (.pptx) download** containing a native, fully editable chart (column, bar,
  line, area, pie, or doughnut) plus, optionally, the source table on a second
  slide. Live SVG preview in the pane; tolerant number parsing ($, %, commas,
  units, parenthesized negatives); powered by PptxGenJS, entirely client-side.

## [1.0.0] — 2026-06-21

First production release. The add-in is now a broad STEM authoring suite (14 modes)
on top of one shared, unit-tested engine (793 tests), entirely client-side.

### Added
- **Units** mode — SI-correct quantity typesetting (±, ×10ⁿ, µ/Ω/°), significant
  figures, and unit conversion including compound units (`km/h → m/s`).
- **Plot** mode — offline pure-SVG function & data charts (multiple series with a
  legend, error bars) via a safe expression evaluator (no `eval`).
- **Finance** mode + library — TVM, loan, NPV/IRR, Black–Scholes, and bond
  calculators, plus typeset finance equations in the Math library.
- **DNA** mode — reverse complement, transcription, six-frame translation, GC,
  ORF finder, plus primer Tm, protein MW/pI/GRAVY, and restriction-site scan.
- **Numerals**, **Refs**, and **Audit** modes — reference-numeral management,
  figure/table captions & cross-references, and a whole-document consistency audit
  (numerals, SEQ ID NO, figures, cross-reference validity).
- **Reaction** mode — multi-step reaction schemes with conditions over the arrow.
- **Math** — LaTeX import/export and multi-line aligned equations (`align(…)`).
- **Chemical** — dictionary-based structure→name lookup; tighter (cropped) 2D
  structure images.
- **macOS install pack** and split per-OS packaging.

### Notes
- All inserts run locally; no document content leaves the machine.
- Tagged content controls on key inserts (equations, structures, callouts, …) for
  later re-finding/updating.

## [Unreleased] — internal pilot prep

### Added
- **Substituent gallery** (Build mode) — depict R-group alternatives as drawn
  structures: list `label = SMILES/name` lines (e.g. `R1a = c1ccccc1`) and insert
  each rendered 2D substituent with its label beneath the genus. Closes the last
  Markush "depicted alternatives" gap.
- **Botanical mode** (plant patents) — typeset a scientific name with correct
  nomenclature italics (genus/species/infraspecific epithets italic; rank
  connectors `subsp.`/`var.`/`f.`, authors, hybrid `×`, and cultivars `'…'` roman),
  with quote normalization and genus capitalization; plus a varietal
  **characteristics table** built from "Label: value" lines. Both insert into Word.
- **Markush query features (genus rigor)** in Build mode — a trailing `{…}` block
  constrains a position for a rigorous generic structure: `{ar}` aromatic, `{!ar}`
  aliphatic, `{har}` hetero-aromatic, `{ring}` in-ring, `{!ring}`/`{chain}` chain,
  `{r3}`–`{r7}` ring size (list several for "5 or 6"), `{sub}` bears a further
  substituent, `{nosub}` no further substitution; bonds take `{ring}`/`{chain}`/
  `{ar}`. These set the corresponding OpenChemLib atom/bond query features so the
  inserted structure is a real query genus. New Markush palette buttons.
- **Sequence mode (WIPO ST.26)** — generate a draft ST.26 sequence-listing XML
  from entered nucleotide (DNA/RNA) or protein (AA) sequences: per-sequence
  molecule type and organism, residue cleanup/validation (whitespace & numbering
  stripped, IUPAC ambiguity codes accepted, invalid residues flagged), applicant/
  title/application metadata, and a generated source feature with mol_type +
  organism qualifiers. Output can be downloaded as `.xml` or copied. Marked a
  drafting aid — validate in the WIPO Sequence tool before filing.
- **Code mode** — a new mode for **pseudocode/algorithm blocks** (bold control-flow
  keywords, optional line numbers, optional caption like "Algorithm 1: KeyGen") and
  **verbatim code listings** (monospace, whitespace-preserving, optional line
  numbers). Inserts as a clean monospace block with a live preview.
- **Popular-functions section** — palette groups and matching formula-library
  categories for the most-used functions by family: **Trig** (sin/cos/tan, recip,
  inverse), **Hyperbolic** (sinh…coth), **Log & exponential** (ln/log/lg/exp/log_b),
  **Special** (Γ, ζ, erf/erfc, sgn, sigmoid), and **Discrete & combinatorics**
  (C(n,k), P(n,k), factorial, gcd/lcm, mod, floor/ceil). ~30 more function names
  now render upright (sech, csch, coth, arsinh/arcosh/artanh, erf, sgn, Var, Cov,
  Tr, rank, …).
- **Collapsible palette groups** — the Math symbol palette is now an accordion
  (groups expand/collapse, state remembered per mode), so it stays clean as the
  symbol set grows; the formula-library dropdown is grouped into "Mathematics" and
  "Science & engineering".
- **Electrical-engineering & physics support** — new formula-library categories
  (Ohm/impedance/reactance/resonance/dB/phasors; E=mc², Schrödinger, Planck,
  de Broglie, uncertainty, Coulomb, gravitation, ideal gas) plus notation:
  **Dirac bra-ket** (`bra`/`ket`/`braket`), contour/multiple integrals
  (`oint`/`iint`/`iiint`), phasor `∠`, `ℏ`, `Ω`, Laplace `ℒ` / Fourier `ℱ`
  transforms, and `Re`/`Im` parts.
- **Domain notation & formula libraries** for non-chemistry practice areas —
  logic/set-theory/quantifier symbols (∀ ∃ ∈ ∉ ⊆ ∪ ∩ ∅ ∧ ∨ ¬ ⊕ ⇒ ⇔), blackboard-
  bold number sets (ℤ ℝ ℕ ℚ ℂ 𝔽 𝔼), `floor`/`ceil`/`norm` (⌊⌋ ⌈⌉ ‖‖), `partial`
  (∂), `nabla` (∇), upright `mod`, degree (°), and square-bracket grouping (e.g.
  `[S]` concentrations) — all typeable as words or inserted from new **Logic &
  sets / Number sets / Advanced** palette groups. Added formula-library categories
  for **Cryptography**, **Computer science / ML**, **Mechanical engineering**, and
  **Biology / assays**.
- **Centralized-deployment guide** (`packaging/CENTRALIZED-DEPLOY.md`) for IT
  admins to push the add-in via the Microsoft 365 admin center (Integrated Apps)
  instead of the per-user installer. Corrected `DISTRIBUTION.md` to describe the
  actual per-user **Developer Add-ins** install (the network-share Trusted Catalog
  method, which did not work on the target build, is no longer presented as the
  flow). The package script's stamped `manifest.xml` doubles as the validated
  deploy manifest.
- **Matrices & piecewise/cases** in the math engine — `matrix(a, b; c, d)` (rows
  separated by `;`, columns by `,`), with `pmatrix` / `bmatrix` / `vmatrix` for
  `( )`, `[ ]` and `| |` (determinant) delimiters, and `cases(x, if x>0; -x,
  otherwise)` for piecewise functions. All emit real Word equation objects (OMML)
  and render in the live preview; new palette "Matrices" group.
- **Carbon-range shorthands** in R-group definitions — typing `C1-6 alkyl` or
  `C1-C6 alkyl` expands to `C₁–C₆ alkyl` (subscript counts, en-dash) on insertion;
  ordinary formulas like `C2H5` are left untouched.
- **More definition shorthands** — `opt sub` / `opt. subst.` → "optionally
  substituted …"; variable-count ranges like `n=1-3` → `n = 1–3`, and plain
  integer ranges (`4-6 membered`) get an en-dash. Substituent locants such as
  `indazol-3-yl` are left alone.
- **Sub-generic Markush definitions** — when an R-group definition references a
  nested label (e.g. `R1 = C1-6 alkyl substituted with R1a`), an input for the
  sub-group (`R1a`) appears automatically and is included in the inserted legend
  (line or table). Detection is transitive and ignores ordinary words.
- **Structured Markush tables** — R-group definitions can be inserted as a
  two-column **R-group | Definition** table (toggle "Insert as: Line / Table" in
  the Build pane) in addition to the inline "where R1 = …" line.
- **R-group legend** — when a built structure has R-groups, a definition box
  collects `R1 = …`, `R2 = …`, and insertion adds a "where R1 = …; R2 = …" line
  beneath the structure.
- **Stereochemistry**: isomeric SMILES (Chemical mode) renders wedge/hash bonds;
  Build mode adds wedge (`>`) and hash (`<`) stereo bonds.
- **Richer Markush atoms** in Build: `A` (any atom), `Q` (any heteroatom),
  `R`/`R1`/`R2`… (R-group attachment points), plus the existing `[C,N]` lists and
  `X` halogen — with a "Markush / query atoms" button row.
- **Automated test suite** (Jest + ts-jest): 445 tests over parsers, OMML
  emitter, formula library, builder, and the full compound dictionary. Run with
  `npm test`.
- **CI** (`.github/workflows/ci.yml`): type-check, tests, dictionary validation,
  production build, manifest validation.
- **Equation numbering** — optional right-aligned **(I), (II), …** with a
  persistent counter and reset.
- **Structure provenance** — inserted structures carry molecular formula, MW,
  canonical SMILES, and OpenChemLib ID code in the image alt-text; the pane shows
  formula / MW / SMILES.
- **Markush / generic structures** in Build mode — `[C,N]` atom lists, `~`
  undefined/any bonds, and the `X` halogen shorthand.
- **Clickable palettes** (math + chemical), **Build bond buttons**, and **Build
  common-structure templates**.
- **Search** across formulas and compounds; **recents & favorites** (with a
  **Clear** control for confidentiality).
- **Formula library** (Statistics / Geometry / Algebra / Trigonometry / Calculus)
  and an extended math engine (Σ, ∫, ∏, roots, functions, |x|, limits, accents,
  factorials, implicit multiplication, literal Greek).
- **Confidentiality disclaimer** in the pane.
- Distribution, security, third-party-license, and user-guide docs;
  `manifest.prod.xml` template.

### Notes / known gaps (tracked for next iterations)
- Build wedge/hash bonds are indicative; for exact, parity-defined stereo prefer
  isomeric SMILES in Chemical mode.
- "Optionally substituted" shorthands and variable counts / C1–C6 alkyl ranges
  are not yet generated automatically. R-group legends are free-text (not yet a
  structured Markush table with sub-generic definitions).
- Sequence listings (WIPO ST.26) out of scope.
- Compound dictionary SMILES are validated to **parse**; a chemist should
  spot-verify chemical correctness before claim-critical use.
- Cross-platform (Mac / Word on the web) and a Content-Security-Policy need
  validation in-host during the pilot (see `SECURITY.md`).

## [0.1.0] — initial scaffold
- Office.js Word add-in: chemical & math formatting, 2D structures, native Word
  equations, Build mode.
