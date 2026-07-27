# JurisLab — Product Roadmap

_Last updated: 2026-07-26 · Current release: **v2.17.0** (production)_

> The release number above is gated by `phase6.adversarial.test.ts` against
> `package.json`. If they disagree, the suite fails — this file drifted five
> versions once and nothing caught it.

This is the forward-looking plan. For what already ships, see [FEATURES.md](FEATURES.md);
for the historical build log, see [CHANGELOG.md](CHANGELOG.md).

---

## Vision

JurisLab turns what a technical author types into correctly formatted, computed, and
publication-ready content — inserted directly into Word, entirely on the user's machine.

Two north stars guide the roadmap:

1. **The unicorn for STEM writers + patent attorneys** — one add-in that spans chemistry,
   life science, math, and legal drafting.
2. **A no-code, in-Word analytical workbench that competes with MATLAB** — _for data
   analysis and reporting_, the everyday work most people actually open MATLAB to do.

### How we compete with MATLAB (the winnable framing)

We do **not** reimplement MATLAB the programming environment (its language, REPL, IDE,
Simulink, or general toolboxes). We compete on the wedge MATLAB is worst at:

| MATLAB | JurisLab |
|---|---|
| Expensive license | Free / bundled |
| Requires scripting | No code — paste data, get results |
| Output lives outside your document | Results & figures land in Word, formatted |

**Honest limit (state it plainly in marketing):** JurisLab competes with MATLAB for
data analysis, fitting, statistics, and reporting — not for general scientific
programming. Building a Kalman filter or a Simulink model still needs MATLAB. Analyzing
an assay, a survey, or an instrument dump and writing it up does not.

### Non-negotiable constraints (every item below inherits these)

- **Fully offline / client-side.** No document content leaves the machine. The single
  existing exception is the strictly opt-in OPSIN name lookup.
- **All data must be real.** Every number is computed from the user's input or a
  verified source — never invented.
- **Honest about accuracy.** Predicted/estimated outputs (spectra, cLogP, pKa) say so.

---

## Where we are (v1.96.0)

The analytical **quantitation** engine is genuinely strong and honest about its limits:

- **Mass Spec** — exact monoisotopic/average mass, isotope patterns, adduct m/z.
- **Bio/Assay** — Levenberg–Marquardt curve fitting with covariance-based standard
  errors; Michaelis–Menten, Hill, dose–response (IC50/EC50/4PL), binding (Kd).
- **Stats** — t-tests (Welch/Student/paired), one-way ANOVA, regression with p-values,
  uncertainty propagation (real incomplete-beta distribution math).
- **Physicochemical** — cLogP, logS, tPSA, HBD/HBA, Lipinski/Veber.
- **DNA/protein, Units, Plot** — ORF/Tm/translation; sig-figs & conversions; offline charts.
- Plus the full legal/patent drafting suite (Citations, TOA/TOC, Sequence, Numerals…).

**That gap is now closed.** The three things this section used to list as missing —
analytical spectroscopy prediction, thin general-purpose stats, and no core numerical
primitives — all shipped: Spectra (v1.54.0), the expanded stats suite, and the
linear-algebra/ODE/FFT core (v1.51.0–v1.52.0). Since then: the molecular-biology
suite (Sequence Map, plasmid maps, SnapGene import, restriction digestion, Align,
primer Tm), **Solve** (v1.84.0), NMR J-coupling and 2D COSY/HSQC (v1.83.0), and a
reliability pass (v1.87.0) that made polynomial roots complete, integration exactly
symbolic where possible, and pKa compound-specific via Hammett.

---

## Roadmap

Priority order reflects **leverage per unit effort** toward the MATLAB north star.
Nothing here is scheduled yet; sequence is a recommendation to confirm on build.

### Phase 1 — Foundations & the everyday win  _(highest leverage)_ ✅ COMPLETE (v1.49.0–v1.50.0)

Delivered as the new **Analyze** mode (`src/lib/linalg.ts`, `src/lib/insights.ts`,
`src/lib/matrixExpr.ts`):

- **Linear-algebra core** ✅ — `solve` A·x=b, `inverse`, `determinant`, `rank`, `trace`,
  `transpose`, `multiply`, symmetric-matrix eigenvalues/eigenvectors (Jacobi), **general
  (non-symmetric) eigenvalues incl. complex pairs (Francis double-shift QR)**, **QR**
  (Householder), **SVD** (one-sided Jacobi), and a **matrix-expression evaluator**
  (`A*inv(B)+2*C'`). Partial pivoting throughout; singular/complex cases handled honestly.
- **Raw data → insights engine** ✅ — paste a table; per-column summaries,
  outlier (Tukey 1.5×IQR) / missing-data flags, correlation matrix (Pearson r + p-value,
  Spearman rho), trend/slope detection over row order, and plain-language insights
  inserted into Word. Built on `stats.ts`.

### Phase 2 — Numerical breadth  _(makes the MATLAB claim land)_ ✅ COMPLETE (v1.51.0)

Added as Analyze tools (`src/lib/ode.ts`, `src/lib/optimize.ts`, `src/lib/fft.ts`):

- **ODE solvers (RK45)** ✅ — adaptive Dormand–Prince for `y' = f(t, y)` and systems;
  sampled table + trajectory plot.
- **General optimization** ✅ — Nelder–Mead simplex minimization of a typed objective.
- **FFT / signal processing** ✅ — radix-2 Cooley–Tukey, amplitude spectrum + dominant
  frequencies + chart. Filtering ✅ added (low/high/band-pass in the frequency domain,
  with a caveat about the artefacts a naive brick-wall filter introduces).

### Phase 3 — Fill the thin spots ✅ COMPLETE (v1.52.0)

- **Stats breadth** ✅ (`src/lib/stats2.ts`) — Mann–Whitney U, Wilcoxon signed-rank,
  chi-square (goodness-of-fit + independence), two-way ANOVA, multiple-comparison
  correction (Bonferroni, Holm, Benjamini–Hochberg/FDR). Tukey HSD ✅ added (studentized-range
  distribution; ANOVA without a post-hoc test inflates the family-wise error rate).
- **pKa estimation from structure** ✅ (`src/lib/pka.ts`) — deterministic functional-group
  detection (OCL atom graph; ester/amide/nitrile correctly excluded) reporting typical
  literature pKa per ionizable group + net charge at pH 7.4, labeled as a group estimate.

### Phase 4 — Spectroscopy prediction ✅ COMPLETE (v1.54.0, Spectra mode)  _(most differentiating, most work)_

- **1H / 13C NMR** ✅ predicted spectra (additivity — Grant–Paul + aromatic increments, offline, honest caveat).
- **IR** ✅ predicted spectra (group frequencies + Lorentzian transmittance trace).
- **UV-Vis** ✅ predicted spectra (Woodward–Fieser).
- **MS fragmentation** ✅ (EI: α-cleavage, benzylic/tropylium, McLafferty, gated neutral losses).
- **J-coupling and 2D** ✅ SHIPPED in v1.83.0 — coupling constants and multiplet names
  (dd, td…) from the bond graph, plus COSY (¹H–¹H) and HSQC (¹H–¹³C) maps.
- **Also shipped, unplanned here:** a **JCAMP-DX reader** to open a real measured spectrum.

### Ongoing / low priority — Chemical coverage

- Curated named-compound additions on request (e.g. **heilonine** — a real *Fritillaria*
  alkaloid absent from OPSIN/PubChem/CACTUS by name; would need a verified literature
  structure). Coverage gap, not a bug.
- Optional trivial-name resolver (PubChem fallback) — a *second* network exception;
  weigh against the privacy stance, and note it wouldn't have solved heilonine anyway.

---

## Status & what's next

**Phases 1–4 are all COMPLETE** (linear-algebra/FFT/ODE core, optimization, insights
engine, expanded stats, pKa, and the full Spectra suite). Since then the build has added
a **molecular-biology suite** — Sequence Map, circular plasmid maps, SnapGene `.dna`
import, restriction-enzyme digestion (Type IIS, both-strand), pairwise Align, and
nearest-neighbour primer Tm — and a sustained **correctness-hardening sweep** (punch-list
audits fixing real numerical/biological bugs the unit tests missed).

**v1.99.0 closed the five capability gaps from the 2026-07-26 evaluation:**
- **Logarithmic axes** (Plot) — base-10 x and/or y, decade ticks with minor
  gridlines. Dose-response is defined on log₁₀[concentration], so an EC50 could
  be fitted but never drawn. A log axis discards zero and negative values, and
  says how many and on which axis rather than plotting a subset silently.
- **Effect sizes and confidence intervals** (Stats) — Cohen's *d* on the pooled
  SD for two-sample tests, *d_z* for paired (labelled separately, because they
  are not comparable), and a 95% CI on the mean difference. Journals require
  these; *p* alone confounds effect size with sample size.
- **USPTO paragraph numbering** (Numerals) — `[0001]` marks through the
  specification, skipping headings, blank paragraphs and the claims. Previews
  before it writes, and refuses to run when it would create duplicate numbers.
- **Virtual digest** (DNA) — fragment sizes, spans, ends, and the bands a gel
  would actually resolve. `cutPosition`/`overhangLength` had been computed and
  consumed nowhere. Circular topology is handled correctly: n cuts give n
  fragments, not n+1.
- **TOA short forms** (Citations) — `Alice, 573 U.S. at 217` and `Id. at 223` are
  now marked, so the page list is no longer just the full-form page. Occurrence
  texts that mean different authorities in different places are left unmarked
  and declared, because Word searches by string and a mis-attributed page is
  worse than a missing one.

**v2.0.0 — dark mode.** The pane follows Word's own theme (`Office.context.officeTheme`),
falling back to the OS `prefers-color-scheme`, with an explicit Light/Dark override that
beats both. The resolution order is deliberate: the pane lives inside Word, so a user
running Word in Black on a light desktop gets a dark pane rather than a white slab bolted
to a black application.

The load-bearing decision is `--paper-fixed`: **preview panels keep their white paper in
dark mode.** A structure, plot or spectrum is inserted into the document as black-on-white
line art, because that is what a document and a patent figure require — so a dark preview
would misrepresent its own output. Dark mode frames the paper instead of inverting it.

All 41 literal colours in the pane were replaced with semantic tokens first, and a contrast
gate (`themeContrast.test.ts`) now measures 15 text/background pairs against WCAG AA in
**both** themes. It found three real defects on the first run, two of them in the LIGHT
theme that had shipped: muted text at 4.03:1, the warning pill at 4.31:1, and the active
filter chip at 2.3:1 in dark.

**v2.1.0 — assumption diagnostics and rank tests beyond two groups.** These are one
feature, not two: warning a user that their data is not normal, in a product with no
Kruskal-Wallis, would be worse than saying nothing.
- **Check test assumptions** (new Stats calculator) — D'Agostino-Pearson K² for normality
  and Brown-Forsythe (median-centred Levene) for equal variances. Chosen over Shapiro-Wilk
  deliberately: Royston's algorithm is a long chain of fitted polynomials, easy to get
  subtly wrong, and a subtly wrong p-value is worse than none. The cost is honest — below
  n = 20 it REFUSES to report rather than returning a number with no power behind it.
- **The t-tests now carry the verdict** underneath the p-value, and every warning names the
  alternative to use rather than just complaining.
- **Kruskal-Wallis + Dunn post-hoc** (tie-corrected; post-hoc shown only when the omnibus
  test is significant) and **Friedman** for repeated measures. A ragged Friedman design is
  refused rather than padded, because padding invents measurements.
- **Dunnett's test** — each treatment against ONE control. Tukey's own caveat had pointed
  here for a long time while the product had no Dunnett, the same defect as the
  "use Games-Howell instead" line beside it. It matters beyond tidiness: Tukey corrects for
  all k(k−1)/2 pairs, so a 4-dose study vs vehicle pays a 6-comparison penalty for
  comparisons nobody wanted, which is routinely the difference between a significant result
  and none.
  The p-value needs the multivariate t, which has no closed form — but the correlation has
  a factor structure (rho_ij = lambda_i·lambda_j, lambda_i = sqrt(n_i/(n_i+n_0))), collapsing
  it to nested 1-D integrals computed by 48-node Gauss-Legendre. Verified two ways that do
  not depend on trusting the integrator: with ONE treatment it reduces exactly to the
  two-sided t-test (to 1e-6), and every adjusted p is bracketed between unadjusted and
  Bonferroni. The critical value for k=3, v=16 comes out at 2.592 against a published 2.59.
  First cut took 2.6 s per call — unusable in a pane that recomputes on every keystroke —
  so Simpson was replaced with Gauss-Legendre (identical results to 6 dp, 15x faster) and
  the critical value is cached on group SIZES, which do not change while values are typed.
  23 ms per keystroke now.
- Fixed two caveats that named tests the product does not have: "use Games-Howell instead",
  and the Dunnett reference. **A test asserted the Games-Howell wording, so the suite was
  pinning the defect in place.**

**v2.2.0 — regression that is actually usable, and the plots that check it.**
- **Multiple regression** (any number of predictors) and **polynomial regression** (to
  degree 6). Regression had stopped at one predictor, and `linalg.ts` had QR but no
  least-squares on top of it, so a user with dose AND time could not assemble one either.
- Solved by **QR, not the normal equations**: forming XᵀX squares the condition number, and
  a polynomial design is exactly where that bites. Polynomial x is **centred** first — a
  cubic on x ≈ 1000 otherwise spans 10⁰–10⁹ across its columns and degenerates into noise.
- **Rank-deficient designs are refused**, not silently resolved: two collinear predictors,
  a constant predictor, or as many parameters as observations each return a reason.
- **Residual-vs-fitted and normal Q-Q plots** shown under the result. This is the half that
  matters: a quadratic relationship fitted with a straight line posts a respectable R²
  while being systematically wrong at both ends, and NO summary number reveals it.
  `StatOutput` gained an optional `svg` for display only — the inserted text is unchanged,
  so no existing calculator's output could shift.
- **Adjusted R² beside R²**, because plain R² can only ever rise when a predictor is added,
  even a column of random numbers. A test asserts exactly that.
- Verified against closed forms rather than against the solver: one predictor reproduces
  the existing simple-linear fit's slope, intercept, SE and p to 1e-10; an exactly
  determined plane and a perfect quadratic are recovered exactly.

**Found by widening a guard, not by looking for it: Tukey HSD's result could never be
inserted.** The Stats/Analyze readers block insertion when the result text contains an em
dash, because that is `formatNum`'s non-finite sentinel — a whole-text scan, so an em dash
used as ordinary PROSE disables the button. tukey.ts's caveats are full of them. The
existing guard test covered `ANALYZE_CALCS` only; extending it to `STAT_CALCS` (after my own
regression caveats tripped the same wire) surfaced Tukey immediately, plus the assumptions
and Dunnett prose. All normalised at the point the text is built, wording untouched.
**A trap that is documented rather than enforced will catch the next person — it caught me.**

**v2.3.0 — survival analysis.** The largest named category absent for a life-science
audience. Time-to-event data was not analysable by anything else here: a t-test on survival
times throws away every censored subject, which is usually most of the ones who did best.
Kaplan-Meier with Greenwood confidence intervals, the log-rank test, and a Peto hazard ratio
with its interval; both curves drawn on one chart.
Censoring is the whole design: a subject censored at 10 months is not one who died at 10
months and not one who survived forever — they count toward the risk set up to that moment
and not after. The tests check it by comparing against the uncensored case, where the answer
is known exactly. **Median survival reports NOT REACHED** when the curve never falls to 50%,
rather than substituting the longest observed time, which is the common spreadsheet error and
understates survival.

**v2.4.0 — one calculator-field renderer instead of four.**

**The evaluation's framing needed correcting first.** It listed "four near-identical
calculator registries, ~1,935 lines, 24% of taskpane.ts" as wanting consolidation. Measured:
STAT_CALCS 692, ANALYZE_CALCS 485, ASSAY_CALCS 379, FIN_CALCS 331 = 1,887 lines — but those
lines are 60+ DISTINCT calculator definitions (Black-Scholes, Kaplan-Meier,
Michaelis-Menten, eigenvalues). That is data with different maths in every entry. Merging the
arrays would delete none of it, only concatenate them while forcing each entry to carry a
"which tool am I" tag it does not need.

The REAL duplication was the four renderers: 166 lines building the same input rows from the
same field shapes, differing only in registry, id prefix, container and callback. **They had
already drifted** — Finance and Assay had no branch for a `text` field or a textarea, so a
field kind that renders correctly in Stats produced a plain numeric input there. Four copies
guarantee that eventually.

Now one `renderCalcFields()`; the four callers are three lines each, and taskpane.ts is 78
lines shorter. `kind` is optional in the shared signature because Finance and Assay omit it
on numeric fields — TypeScript caught that rather than my papering over it with a cast.
Verified by driving all four tools in the real bundle (19/21/15/15 calculators, fields
rendered and results computed, including on a differently-shaped last calculator in each),
plus the id-wiring audit which is what would catch an id-prefix collision.

**v2.4.1 — Solve gave a confidently wrong answer to a two-body problem.**
"Two trains 300 km apart travelling toward each other at 60 and 90 km/h, when do they meet?"
is 2 hours. It answered **3.33 hours**, with the working "time = distance / rate = 300 / 90"
attached. Reworded it said 5 hours instead: `exec` returns the FIRST match and which speed
appears first is arbitrary. Found while probing Solve's ceiling, not by looking for it.
Now the closing/separating case is actually solved (the speeds add, and the working shows the
combined rate), and anything the one-body template cannot represent — two distances, two
times, two speeds with no stated geometry — is REFUSED rather than approximated. Also fixed:
"90 km/h" was counting as a distance in km, because DIST_UNITS contains "km".

**v2.5.0 — the CAS core (docs/CAS-DESIGN.md Release 1).**
Solve's ceiling was `simplify()` being a local peephole: `2*x + 3*x` came back unchanged,
`x/x` did not cancel, and `solveEquation("F = m*a", "a")` returned an **empty root list** —
the single most common thing an engineer asks a solver for. Now there is a real canonical
form (`src/lib/cas.ts`): every expression normalises to a rational function over atoms with
**exact BigInt rational coefficients** (1/3 + 1/3 + 1/3 is exactly 1; a JS float enters via
its decimal string, so nothing is invented). Collect/expand/cancel and **canonical equality**
fall out; cancellation covers common monomials plus full univariate GCD, so (x²−1)/(x−1) is
x+1. `simplify()` switched over with the old peephole kept as the totality fallback, and the
whole existing suite stayed green **unedited**. Symbolic rearrangement ships on top: linear
targets isolate exactly (F = m·a for a → F/m), quadratic targets get the quadratic formula
symbolically, every introduced divisor states its ≠ 0 condition, and every answer is
**verified by back-substitution** (canonical 0 for linear; sampled residuals for quadratic,
where the sqrt atom blocks the exact route — stated, not hidden). The pane offers
"Solve for F / m / a" chips on any multi-unknown equation. Derivatives got readable for free:
d/dx sin(x)cos(x) is now cos(x)² − sin(x)², and the `+ -` artifacts are gone.
Deliberately NOT done yet (Release 2, per the design): symbolic integration (needs the
factoring/partial-fraction machinery), multivariate GCD, systems of equations.

**v2.6.0 — symbolic integration + typeset insertion (CAS-DESIGN Release 2 and §5.1).**
Release 2 was deliberately second because it stands entirely on Release 1: `src/lib/casint.ts`
does **substitution** (canonical equality recognises that a factor IS g′(x), then replaces every
occurrence of g by a fresh symbol), **integration by parts** (recursive, so ∫x²eˣ resolves through
two rounds), and **partial fractions** over exact rationals — polynomial division, rational-root
factoring with multiplicity, and an exact Gaussian solve for the decomposition coefficients.
∫x·eˣ dx = eˣ(x−1), ∫dx/(x(x+1)), ∫dx/(x²+4) = ½atan(x/2), ∫ln x dx = x ln x − x, ∫tan x dx all
now come back exactly, where every one of them used to fall back to Simpson.
**The correctness net is the design's own:** every antiderivative is DIFFERENTIATED BACK and
compared canonically (numerically where canonical comparison is inconclusive); a candidate that
fails is discarded, not returned. That is what makes aggressive heuristics safe — the worst case
is a fallback to quadrature, never a wrong closed form dressed up as exact. What it cannot do it
refuses: ∫eˣ² , ∫sin(x)/x, and cyclic by-parts like ∫eˣ sin x return null and go numeric.
Also shipped: **§5.1 — Solve inserts real Word equations.** It called `insertPlainText` while the
pane typeset the same derivation on screen and the OMML engine sat there driving Math mode, so
`a = F/m` landed in the document as literal characters. `buildDerivationOoxml` now emits a
multi-paragraph package mixing prose and genuine `<m:oMath>` — fractions as fractions, ∫ with real
limits — and degrades one un-parseable line to text rather than failing the whole insertion.
One regression test was renamed rather than accommodated: `x*exp(x)` was pinned as a case the
integrator "can't integrate", which the improvement falsified; the value assertion is unchanged.

**v2.7.0 — geometry in Solve (GEOMETRY-TOPOLOGY-DESIGN Release G1).**
New direction, agreed 2026-07-27: geometry from basic to expert, then algebraic topology.
The brief is `docs/GEOMETRY-TOPOLOGY-DESIGN.md`; **G1 (Tiers 1–2) is what shipped here.**
`src/lib/geometry.ts` runs coordinate geometry on the CAS's exact rationals, because for
rational vertices the interesting answers are themselves rational — shoelace area, centroid,
circumcentre and the conic invariants all come out exact, with a decimal offered alongside
rather than instead. Lengths keep their surds (√2, 2√3); angles are genuinely
transcendental and are reported numerically, which is honest rather than a shortcut.
What it does: mensuration exact in π; **triangle solving** for SSS/SAS/ASA/AAS and the
**ambiguous SSA case**, which returns **two triangles, one, or none** and says which — a
solver that quietly returns the acute answer is wrong about half the time it matters;
analytic geometry (lines, intersections, point–line distance, circle through three points);
polygons (shoelace, centroid, convexity, point-in-polygon by **winding number**, which is
unambiguous on the boundary where ray casting is not; convex hull); **triangle centres**
with the **Euler line verified exactly on every call** as a free self-check; and
**conic classification** from a bare `x`/`y` equation — no keyword needed — by the
invariants δ = B²−4AC and the 3×3 determinant, rotating to kill the xy term and translating
to the centre, reporting canonical form, foci, vertices, eccentricity and asymptotes.
**Degenerate conics are named** (a point, a crossed line pair, parallel lines, empty) rather
than forced into an ellipse with imaginary axes.
`src/lib/geometryParse.ts` is the typed grammar, deliberately strict where a reading would
be ambiguous: a bare three-number triangle is SSS, and any angle must be named (`A=30`).
Also fixed here: the Solve section blurb and the Examples panel both still claimed
"definite integrals are numeric", which v2.6.0 had falsified.
**NOT yet built** (next): geometry Tiers 3–4 (3D vectors, planes, skew lines,
transformations), then the topology releases — simplicial homology over ℤ via Smith Normal
Form, then persistent homology. See the brief's §3 for the order and §0 for the
decidability limits that scope π₁ deliberately hard.

**v2.8.0 — simplicial homology over ℤ (Release T1).**
`src/lib/homology.ts`: boundary matrices over ℤ, reduced by **Smith Normal Form** in bigint,
giving Betti numbers AND torsion. `linalg.ts` is deliberately not reused — it is IEEE double
with a 1e-9 pivot cutoff, which is the wrong regime for a ±1 boundary matrix and cannot see
torsion at all. **Torsion is the entire point of working over ℤ:** H₁(ℝP²) = ℤ/2 and
H₁(Klein) = ℤ ⊕ ℤ/2 both vanish into a bare Betti number over a field, and it is exactly the
part that distinguishes a projective plane from a disk. SNF pivots on the SMALLEST nonzero
entry each round, because naive pivoting causes integer coefficient explosion.
**Self-check on every result:** the Euler characteristic is computed twice — the alternating
sum of cell counts and the alternating sum of Betti numbers — and disagreement is reported as
untrustworthy rather than quietly returned. Same discipline as the CAS differentiating its
antiderivatives back.
Built-in spaces are CONSTRUCTED from quotients where possible (the torus and Klein bottle come
from a grid identification with an optional twist) rather than transcribed as face lists — a
construction can be reasoned about, a copied list of 16 triangles cannot. Tests assert the
textbook oracle (β(T²) = 1,2,1; H(S²) = Z,0,Z; H₁(ℝP²) = Z/2) plus ∂∘∂ = 0 on every complex.
**NOT built:** persistent homology (T2), and the advanced list (Release A) — cellular homology,
characteristic classes, cobordism, spectral sequences — which the brief splits by
computability regime before any of it is attempted.

**v2.8.1 — the adversarial pass v2.7.0 and v2.8.0 should have had.**
The deploy rule here is full suite PLUS an adversarial pass. The CAS releases got both; the
geometry and homology releases went out with the suite and QC only. Running the missing pass
found four real defects, one of them severe:
- **Smith Normal Form DIVERGED.** Reducing against a fixed pivot let off-pivot entries grow
  without bound; a random 7×7 integer matrix blew past BigInt maximum size after ~14 seconds.
  Boundary matrices start at ±1, so homology never tripped it and all 25 oracle tests passed —
  the algorithm was simply unsound outside that regime. Now one reduction pass then RE-PIVOT,
  which makes the pivot magnitude strictly decrease and therefore terminate, plus a guard.
  Cross-checked by prod(divisors) = |det| on nonsingular input.
- **The homology size cap fired too late** — checked after allFaces() had already built
  1,048,572 faces, 8.8 SECONDS, in a pane that recomputes on every keystroke. Now projected
  up front: 8787ms → 13ms.
- **Float noise corrupted exact forms**: circle r=0.1 reported its area as
  5000000000000001/500000000000000000·π instead of π/100. The rational conversion was
  faithful; the double product handed to it was not. Mensuration now multiplies as rationals.
- **A degenerate triangle was reported as valid**: SSA with a = b = altitude returned a
  triangle with third side 0 and area 0, when two right angles leave nothing for the third.
Both modules now carry permanent adversarial suites
(`geometry.adversarial.test.ts`, `homology.adversarial.test.ts`), and the lesson is the
process one: a full green suite is not an adversarial pass, and shipping without the second
half is how an unsound reduction reached production behind 25 passing oracle tests.

**v2.8.2 — the adversarial pass on the CAS releases (v2.5.0/v2.6.0).**
Same sweep as v2.8.1, now applied to the CAS. The two structures that looked most likely to
be unsound outside their tested regime — Euclidean GCD over the rationals (the classic
coefficient-explosion algorithm) and the atom-key scheme (a non-injective key would merge
distinct atoms and make equality return WRONG answers) — both held up: no blowup, zero key
collisions, zero false positives in equality, no stack overflow at nesting depth 800, and 880
random-point antiderivative checks plus 246 random-parameter rearrangement back-substitutions
all clean. The defects were elsewhere, and the worse one was not in the CAS at all.

- **NUMERIC QUADRATURE COULD HANG THE PANE — the worst bug of either sweep.**
  `adaptiveSimpson`'s convergence test is `|left + right − whole| < 15·tol`, and ANY
  comparison against NaN is false. So a single non-finite sample defeated the short-circuit
  and drove the full binary recursion to depth 50: roughly 2^51 evaluations.
  `integrate("ln(x)", -1, 2)` reached it by way of the symbolic path returning NaN at an
  endpoint and falling through to quadrature. In the pane that is an unrecoverable freeze —
  a synchronous loop cannot be interrupted, and the test runner's own timeout could not stop
  it either (the process burned 605 CPU-seconds before being killed by hand). Non-finite
  samples now abort immediately: ∞ → 3ms.
- **CANONICALISATION CAN WIDEN A DOMAIN.** `sqrt(x)^2` normalises to `x`, which is finite at
  x = −4 where the original is NaN — deliberate, since it is what lets a quadratic solution
  verify to exactly 0, but undisclosed. `∫sqrt(x)²` over [−1,1] therefore came back as
  "0, exact (symbolic)" with NO caveat, for an integral that does not exist. Fixed generally
  rather than by special-casing sqrt: the ORIGINAL integrand is now scanned across the
  interval, which also catches logs of non-positive numbers and division poles. The valid
  [0,2] range over the same integrand stays warning-free.
- An undefined integrand now reports **no value** and the method `"undefined on this
  interval"`, instead of handing back a NaN dressed as a result; the pane prints that in
  words rather than the literal "NaN".
- The domain-widening caveat is now documented in `cas.ts` alongside the existing x/x one.

`cas.adversarial.test.ts` pins all of it, with deliberately tight time bounds on the hang.

**v2.9.0 — geometry Tiers 3–4: vectors, planes and solids (Release G2).**
`src/lib/geometry3d.ts`, same exactness discipline as the plane module: for rational input the
dot product, cross product, scalar triple product, plane coefficients, tetrahedron volume and
transformation determinant are all themselves rational and come back exact; lengths keep their
surds; angles are transcendental and stay numeric.
The case the module exists for is **classifying two lines**. The skew-distance formula divides
by |d₁ × d₂|, which vanishes EXACTLY when the directions are parallel — so parallel has to be
split off first rather than discovered as a division by zero, and identical/parallel/
intersecting/skew are four genuinely different answers. Because the cross product is exact the
test needs no tolerance: a pair off by 1e-9 is correctly skew, and a pair that is exactly
coplanar is correctly reported as intersecting with the meeting point given.
Also: planes from three points (collinear input refused), point–plane distance, line–plane
intersection (meets / parallel / contained), triangle area in space, tetrahedron and
parallelepiped volumes, the sphere through four points (coplanar input refused — no unique
sphere exists), and Tier-4 transformation matrices reporting their volume scale, whether they
flip orientation, and whether they are singular.

**The adversarial pass ran BEFORE shipping this time**, per the rule, and found a real defect
that the v2.7.0 sweep had missed because it never tested fractional input: the parser's
`numOf()` divided as a FLOAT, so a coordinate or dimension typed `1/3` arrived as
0.3333333333333333 and the exact layer then faithfully preserved that noise — `circle r=1/3`
reported its area as a 33-digit fraction. Same class as the v2.8.1 `circle r=0.1` bug but one
layer earlier, at the parse boundary rather than in the arithmetic, and it affected all three
input paths (coordinates, named dimensions, positional dimensions). All now parse straight
into the rational layer: `box 1/2 1/3 1/4` gives volume 1/24 exactly.

**v2.10.0 — persistent homology (Release T2).**
`src/lib/persistence.ts`. This is the entry in the topology plan that earns its place for a
working scientist, because the input is a PASTED TABLE OF POINTS — the same gesture as Stats
and Analyze — and the output answers something no summary statistic can: does this data have a
HOLE in it? A ring of measurements and a filled blob have the same mean, the same spread and
similar correlations; they differ in H₁, and a barcode is what shows it.
Vietoris–Rips filtration, boundary matrix reduced over 𝔽₂, persistence pairs, and a barcode
figure that inserts into the document. Reached by pasting the cloud into the Topology kind —
several rows of equal-length coordinates is unambiguous, since a complex is typed as bracketed
vertex lists and a space is a single word.

The property test is the whole claim and is what the suite asserts: a ring shows exactly one
long H₁ bar, dominating the runner-up fivefold, and a blob shows nothing comparable.

**The adversarial pass ran before shipping** and found three things worth the trouble:
- A DESIGN error caught by the property test failing first time: a class in H_k is killed by a
  (k+1)-simplex, so the complex must be built ONE DIMENSION HIGHER than the homology asked for.
  Built only to H₁ and every loop is necessarily immortal — the barcode came back empty.
- The essential-class scan rebuilt its key list every iteration, O(n²), which would have crawled
  at the 60,000-simplex cap. `pairedBy` is keyed by the low row, so it is a direct has().
- An HONESTY defect: when the cap bites BELOW the killing dimension the answer changes
  qualitatively rather than losing detail — no triangles means every loop looks immortal. The
  message said only that "bars near the largest scales may be missing". It now names exactly
  which dimensions are unreliable and why ("H1, H2 are NOT RELIABLE here … features will appear
  to live forever whether or not they really do"), and stays quiet when the killing dimension
  really was completed.

**v2.11.0 — advanced algebraic topology, tier A1 (Release A).**
`src/lib/topology2.ts`. The user's advanced list was cellular homology, spectral sequences,
stable homotopy, generalised cohomology, characteristic classes and cobordism. The brief split
that list by COMPUTABILITY REGIME before any of it was built, and this ships only the part that
is exactly computable — which is the whole point of having written the split down.

- **Cellular homology.** ℝP² needs 6 vertices, 15 edges and 10 triangles simplicially; as a CW
  complex it is ONE cell in each of dimensions 0, 1 and 2, and the boundary map is the matrix of
  DEGREES of the attaching maps. Same Smith Normal Form, same ℤ, same torsion — on a matrix
  small enough to read. The suite checks it against the simplicial route, so the ℤ/2 of ℝP² is
  now reached two independent ways.
- **Characteristic classes** via the splitting principle, which turns this into
  symmetric-polynomial algebra: exact integer arithmetic on coefficients, nothing estimated.
  w(T ℝPⁿ) = (1+a)^{n+1} mod 2 is trivial EXACTLY when n+1 is a power of two (verified n ≤ 16),
  and c(T ℂPⁿ) has top class n+1 = χ(ℂPⁿ). The parallelisability deduction is stated AND
  qualified: a trivial w removes the obstruction this invariant can see, it does not prove
  parallelisability, and only n = 1, 3, 7 actually are.
- **Unoriented cobordism**, and this is the most interesting entry in the module. Thom: the
  Stiefel–Whitney numbers are a COMPLETE invariant of unoriented cobordism class, so "are these
  cobordant?" is genuinely DECIDABLE — one of the very few equivalence questions in this area
  that is, unlike homeomorphism or homotopy equivalence. The tool COMPUTES that ℝPⁿ bounds
  exactly when n is odd, from the numbers, rather than asserting the classical result.

**What is deliberately NOT built, and is now answered rather than silently missing:** ask about
spectral sequences, stable homotopy, the fundamental group or homeomorphism and Solve explains
what IS computable (the E₂ page; a π₁ presentation and its abelianisation), what is NOT (the
differentials and extensions; the word problem, Novikov–Boone; homeomorphism in dim ≥ 4, Markov),
and why. Reporting the limit is the feature — a tool that appeared to answer there would be
inventing mathematics nobody can compute.

The adversarial pass ran before shipping and found two input-validation gaps: a NEGATIVE cell
count produced a negative Betti number that formatted as the trivial group "0", and a
non-integer attaching degree of 2.7 was silently truncated to 2 — each answering confidently
for a complex the user never described. Both are refused now.

**v2.12.0 — knot polynomials and π₁ presentations (Releases T3 and T4).**
`src/lib/knots.ts`. Both were scoped in the brief's §2 and never reached until now.
Input is a BRAID WORD, because it is the one knot notation a person can type without drawing a
diagram: `1 1 1` closes to the trefoil, `1 -2 1 -2` to the figure-eight.

The **Jones polynomial** is computed exactly by the Kauffman bracket state sum — every one of
the 2ⁿ smoothings, loops counted by union-find, then f = (−A³)^(−writhe)·⟨D⟩ evaluated at
A = t^(−1/4). Coefficients are exact integers and exponents are kept as quarter-powers, so a
link's t^(1/2) survives without a float ever appearing.

**Two real bugs, both invisible to a naive test, and worth recording:**
- The A- and B-smoothings SWAP for a negative crossing. Treating every crossing alike is
  correct only when all crossings share a sign — so the all-positive trefoil looked nearly
  right while the mixed-sign figure-eight came back missing terms.
- The writhe factor was raised to +writhe instead of −writhe, which gave a ONE-COMPONENT knot
  half-integer powers of t. That is impossible, and is how the error announced itself.
Both were caught by comparing against literature values rather than by the code agreeing with
itself. The figure-eight is the sharpest oracle available here: it is amphichiral, so its
polynomial must be PALINDROMIC, and it is (t⁻² − t⁻¹ + 1 − t + t²).

The adversarial pass added the strongest check in the module: **Markov stabilisation**. Adding
a strand with a single crossing gives a DIFFERENT braid whose closure is the SAME knot, so the
polynomial must not move — it exercises the bracket, the writhe factor and the substitution
together against a fact none of them knows. It also found that 20 crossings took 13.2 SECONDS
in a pane that recomputes per keystroke, so the cap is now 16 (measured at ~460ms), and that
`1.5` was being split into the generators 1 and 5 rather than refused.

**π₁** is the T4 entry and is scoped hard on purpose: a Wirtinger presentation plus its
abelianisation, which is H₁ and is fully computable. Simplifying a presentation or deciding
triviality is UNDECIDABLE (the word problem, Novikov–Boone), so the tool never claims to have
recognised the group it just wrote down. It also states why H₁ alone distinguishes no knots:
it is Z for every one of them.

Honesty carried on every result: the Jones polynomial is NOT a complete invariant — distinct
knots share it, and whether it detects the unknot is an open problem — so a match is evidence,
never proof.

**v2.13.0 — systems of equations (CAS brief's 'later' list).**
`src/lib/systems.ts`. The most-requested thing a solver can lack, and the highest-value item
left anywhere on the list. Type several equations, one per line.

**Linear systems are solved EXACTLY** by reduced row echelon form over the CAS's rationals, so
`x/3 + y/7 = 1` comes out with no rounding anywhere. But the arithmetic is not the valuable
part — the CLASSIFICATION is. A linear system has exactly one solution, none, or infinitely
many, and which one falls straight out of the rank. Reporting `x = 2.0000, y = 1.0000` for a
system that actually has a whole LINE of solutions is precisely the confident wrong answer this
project keeps designing out, so an underdetermined system returns its **general solution with
the free variables named**, and an inconsistent one says which row proved it.

**Nonlinear systems** go to Newton from many starting points, each root substituted back before
it is reported, and the result states plainly that other solutions may exist.

**The adversarial pass found two defects, one of them serious:**
- **SPURIOUS DUPLICATE ROOTS.** Where the Jacobian is singular at a root the equations are FLAT
  there, so a residual under 1e-9 is satisfied by points ~1e-4 away. Merging only at 1e-6 meant
  `sin(x) = x` — which has exactly ONE real root — was reported as **twenty-eight distinct
  solutions**, and `x² = y² = 0` reported the origin three times. Telling someone there are 28
  solutions when there is one is worse than finding none. Roots now merge at the accuracy the
  method can actually achieve, the tolerance is disclosed, and genuinely distinct roots like
  (3,4) and (4,3) are still kept apart.
- `e` and `pi` are CONSTANTS in this grammar, so `e = 4` quietly vanished from the unknowns and
  the failure was then blamed on Newton needing as many equations as unknowns. It now names the
  real problem and suggests renaming the variable.

Newton's starting points are also deliberately ASYMMETRIC across coordinates now: giving every
coordinate the same value made symmetric systems degenerate, so `x² + y² = 25` with `x + y = 7`
found only one of (3,4) and (4,3).

**v2.14.0 — limits and Taylor series (CAS "later" list).**
`src/lib/analysis.ts`. Limits by direct substitution, then L'Hôpital for 0/0 and ∞/∞; limits at
±∞ are handled by substituting x = 1/t, which turns every question about infinity into one the
same machinery answers. **Every symbolic answer is cross-checked numerically** and withdrawn if
the two disagree — the same discipline as the integrator differentiating its antiderivatives back.
Taylor/Maclaurin series come from repeated CAS differentiation with **exact rational coefficients**,
so eˣ gives 1, 1, 1/2, 1/6, 1/24 rather than decimals, and the truncation is always shown.

**Four defects found by the probe, one serious:**
- **A TWO-SIDED LIMIT WAS REPORTED WHERE NONE EXISTS.** `abs(x)/x` at 0 is −1 from below and +1
  from above, so there is no two-sided limit — but the indeterminate 0/0 sent it down the
  L'Hôpital path, and the fallback probe sampled only from ABOVE and confidently returned 1.
  Both sides are now checked BEFORE any answer is produced.
- Divergence was tested against an absolute threshold of 1e12, so `1/x` at 1e-7 — only 1e7 —
  read as "undetermined" instead of +∞. It now tests for GROWTH.
- The probe was too shallow for slowly-decaying limits: ln(x)/x is still 1.6e-6 at x = 1e7.
- A tail shrinking to zero reported its last sample (2.76e-11) rather than 0 — presenting a
  sampling artefact as the answer.

**v2.15.0 — inequalities (CAS "later" list).**
`src/lib/inequalities.ts`. Move everything to one side and analyse the SIGN on the intervals
between critical points — the roots of the numerator AND of the denominator.
**The poles are the whole difficulty.** Multiplying `1/(x−2) > 0` through by (x−2) is invalid,
because the direction depends on a sign you do not know, and a pole is a point where the
expression is UNDEFINED so it can never be in the solution set even for ≤ or ≥. Both fall out by
construction here: nothing is multiplied through, and a denominator root is always excluded.
`1/x < 1` correctly returns (−∞, 0) ∪ (1, ∞) — the naive multiply gives "x > 1" and silently
loses the entire negative branch.

**The probe caught a wrong answer:** `x³ + x + 1 > 0` returned the whole real line, because only
RATIONAL roots were being found and that cubic's single real root is irrational — so no critical
point existed and the sign was never tested. Sign changes are now located numerically as well,
and any endpoint that came from that is declared approximate. Touching intervals are also merged,
so `x² ≥ 0` reads (−∞, ∞) rather than two pieces meeting at zero.

**v2.17.0 — advanced algebraic topology, tiers A2 and A3 (Release A, completed).**
`src/lib/spectral.ts`. These are the two entries the A1 brief deliberately held back, and what
ships is defined by what must NOT be claimed.

- **Serre spectral sequences.** The E₂ page is genuinely computable — it is
  H_p(B; H_q(F)), a tensor product of two known homologies — and it is computed, laid out as a
  grid with q increasing upward the way it is drawn by hand. **The differentials are not
  computed, and that is the feature.** The fibration S¹ → E → S² has exactly one possible d₂,
  and that differential is not determined by the page: for the Hopf fibration it is an
  isomorphism (E = S³) and for the trivial bundle it is zero (E = S¹ × S²). Same E₂ page,
  different answer. So each possible differential is MARKED as undetermined and no H\*(E) is
  reported. Collapse is the one case where an abutment is safe, and it is PROVED before it is
  used — every possible differential has a zero end — and even then what is reported is the
  associated graded, with the extension problem named (ℤ/4 and ℤ/2 ⊕ ℤ/2 have the same one).
- **Stable homotopy groups of spheres** are a CITED TABLE, never a computation, and every result
  says so and names Hatcher and Toda. Outside the tabulated range it reports "not tabulated
  here" rather than continuing a pattern — πₙˢ has no formula, and extrapolating from 0, ℤ/2,
  ℤ/2, ℤ/24 is exactly the mistake the module exists to refuse.

**The bug test found three routing failures, one of them shipped.** Every engine had passing
unit tests while three of them could not be reached from the pane, because routing is the one
thing a unit test of an engine cannot check:

- **`/\balexander\b/` contained literal BACKSPACE characters** where the two word-boundaries
  should have been — a shell had eaten the backslashes on the way into the file. It compiles, it
  lints clean, it looks right in an editor, and it can never match. So the Alexander polynomial
  shipped in v2.16.0 unreachable, and every question about it was quietly answered with the
  JONES polynomial instead. A repo-wide scan for this class of damage is now a permanent test
  (`controlchars.adversarial.test.ts`); it also cleared a stray vertical tab in `toa.ts` and
  confirmed the 0x07 bells in the table tests are the real Word cell terminators they claim.
- **`pi1 trefoil` was answered with the stable homotopy group π₁ˢ**, because the new stem branch
  was placed ahead of the knot branch and its `pi_?\d` pattern was greedier. Knot questions are
  the more specific reading and now go first.
- **`homology of torus` returned nothing**, because named spaces were looked up by exact string
  and the framing words were never stripped.

`routing.adversarial.test.ts` now checks that thirty-odd phrasings arrive at the right door,
asserting on the ANSWER'S IDENTITY rather than its content. Separately, the PowerPoint export
suite was found failing on a clean checkout: PptxGenJS 4.x changed its environment sniff from
`typeof window` to `process.release.name`, so under jsdom it took its Node path and tried a
dynamic `import("node:fs")` that Jest cannot evaluate. The add-in is unaffected — there is no
`process` in a browser — and the test environment now masks those two markers, which makes it
more like production rather than less.

**The comprehensive sweep** then fed about forty hostile strings — empty, whitespace, NUL, an
emoji, 400 characters of "x", unbalanced brackets, `1e999`, `0/0` — through every engine in
Solve. Nothing hung, nothing threw, and nothing returned a wrong answer; the topology surface
took 39 hostile inputs in 6 ms. Two results were confusing in the same way, and both are fixed:
the limit of `sqrt(-1)` reported "Limit of NaN as x → 0", showing a folded artefact rather than
what was typed and never saying why, and `NaN` parsed as a perfectly ordinary IDENTIFIER, so
solving it produced an equation in a variable called NaN. Neither was a wrong answer, which is
precisely why neither had been noticed.

**Genuinely open candidates:** deeper BVP/PDE/DAE
support on the ODE side (out of scope today — state honestly). Confirm priority before building.
The evaluation's own list is now closed. Remaining ideas are new work rather than
outstanding findings.
