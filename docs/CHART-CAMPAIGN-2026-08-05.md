# The chart campaign — every calculator draws, outside Engineering

_Opened 2026-08-05 at v2.89.0. The counterpart to the Engineering figure campaign
(v2.82.1 → v2.89.0), which closed at 130 of 130._

## Why

Two independent signals, and they agree.

**The user's, 2026-08-05:** *"charts are missing from stats, solve (needs to be
more), analyze, spectra, finance, etc. feedback i have been getting from users is
a large lack of charts. the landing page shows them but yet jurislab does not seem
to have them."*

**The audit's**, `GAP-ANALYSIS-2026-08-05.md` §1.1: the figure ratchet
(`FIGURE_BASELINE = 130`) and the driver behind it iterate `#engineering-calc`
**only**. Every other registry ships with no figure gate at all.

The landing page promises "editable Word tables and charts" at
`landing/index.html:956,1053` for exactly the sections that do not draw. That is
not a marketing overreach to be walked back — it is the correct product and the
code has not caught up.

## The measured baseline

Counted from source at v2.89.0, then re-counted after a first pass undercounted
(`survival` returns `{ text, svg }` by shorthand and a naive `svg:` scan missed
it — **the detector was wrong before the product was**).

| Registry | Draws | Total | Missing |
|---|---|---|---|
| Engineering | 130 | 130 | 0 |
| Statistics | 5 | 21 | **16** |
| Analyze | 9 (source) / **8 measured** | 23 | **14** |
| Assay | 5 | 16 | **11** |
| Finance | 0 | 24 | **24** |
| **Total (calculators)** | **149** | **214** | **65** |

Plus two whole surfaces:

- **Solve** — no chart path of any kind. `taskpane.html:850-883` has a result div
  and one "Insert result" button; there is no SVG, no preview, no insert.
- **Spectra / UV-Vis** — `buildSpectrumSvg()` (`taskpane.ts:23732`) returns `null`
  for `uvvis`, reasoning that "a single λmax is a number, not a spectrum". Correct
  about the band shape; wrong that there is nothing to draw. See §5.

## Phase 1 result — the instrument found nine defects before a single figure was wired

`scripts/pane-audit.js` and `scripts/pane-audit-driver.js` now drive all four
registries in the real production bundle, on `npm run qc` and as
`npm run audit:pane`. On its **first run**, against code that 9,332 unit tests
and 13 QC gates called clean, it found:

**Charts that existed and never reached the document (the user's exact report):**

1. **Five Bio/Assay fit plots** — Michaelis-Menten, Hill, dose-response,
   binding, substrate inhibition — drew a curve in the pane and inserted
   `pic=0`. "Insert result" wrote the text only; the curve needed a second
   button. Stats had already fixed exactly this and recorded why: *the plot is
   part of the result, not decoration.* Now `insertAssayResult()` inserts both.
2. **Three PDE charts suppressed before they could be drawn.** The heat, wave
   and Laplace solvers each built a perfectly good figure, then put `NaN` in the
   top-left corner of the sampled grid as a blank-cell placeholder. `formatNum`
   renders any non-finite value as the em dash the pane uses for "not
   computable", and the insertability scan reads the whole result — so the text,
   the grid **and the chart** were all blocked. A `Matrix` is `number[][]`, so
   there is no blank to put there; `fieldBlocks()` removes the fake corner
   instead. Analyze's measured figure count went 8 → 11.

**Results that could not be inserted at all:**

3. **Two-sample t-test, paired t-test, one-way ANOVA** — `describeAssumptions`
   writes prose em dashes, which are concatenated into the result at run time.
   The ANOVA site carries a comment saying "NO EM DASH … analyzeCalcText.test.ts
   guards this", and the call that broke it was added directly beneath that
   comment. **A source scan cannot see an em dash that arrives from another
   module.** Two further call sites (the assumptions calculator and Tukey) were
   latent — they do not trip on their default data — and were found by the new
   test, not by the audit.
4. **`insights`** — the exploratory-analytics tool whose entire output is a
   narrative, un-insertable because that narrative is punctuated.
5. **`linearize`** and the **Cheng-Prusoff** non-competitive result — literal em
   dashes in their own titles. The existing guard covers the Analyze and Stats
   registries and does not reach Bio/Assay.

**Wrong numbers on screen:**

6. **`greeks` Delta** and **`returns` Sharpe ratio** rendered a literal `NaN`
   while every sibling line used a guarded formatter. Insertion happened to be
   blocked by unrelated punctuation beside them — a NaN kept out of a document
   by accident rather than by the guard that exists for it. This is the same
   "Sharpe ratio NaN" the repo fixed once in `finPct` and left unfixed on the
   line that prints it.
7. **`protein280`** could never compute on its own defaults: its sequence field
   is labelled "optional" and defaults to empty, and the preview refuses while
   any non-select field is blank. `AssayField.optional` now says so in the type
   rather than in the label, because a hint string is not a guard.

**And the harness reported itself first, twice**, which is why it self-tests:

- The first draft of the driver had **twelve literal control characters** in it
  — the recorded `eaten-backslash` failure, reproduced while writing the check
  that looks for control characters. It now uses a code-point loop with no
  escapes at all.
- The figure counter first read `combineSvgs` multi-panel figures as three
  separate figures and reported the regression diagnostics as a broken insert
  path. Only top-level `<svg>` roots count, and the nested case is now a
  negative control in the self-test.

**Deliberately NOT treated as findings**, because a gate that cries wolf gets
switched off: an em dash that leaves Insert enabled (Finance appends its
`assumes:` disclosure after the insertability decision, so five Finance tools
carry one harmlessly), and a clean refusal of deliberate rubbish input.

## Phase 2 (in progress) — Statistics 5 → 11 of 21

`src/lib/statchart.ts` carries the three figures the 16 missing Statistics
calculators need. They are not sixteen different pictures; they are three, used
repeatedly — which is what makes the rest of this batch mechanical.

Wired so far: `descriptive`, `twosample`, `paired`, `anova` (box plots),
`tukey` (forest), `chigof` (grouped bars). Remaining in Statistics:
`kruskal`, `friedman`, `mannwhitney`, `wilcoxon`, `assumptions`, `dunnett`,
`multcomp`, `chiind`, `twoway`, `uncertainty`.

**Two things the layout gate caught that no reviewer would have:**

- Twelve groups with long labels produced **22 overlapping label pairs**. The
  first fix rotated labels 45° and made it **worse (34)** — a 45° label still
  advances by most of its own width, *and* the layout auditor models only
  `rotate(-90`, so it was being measured as though horizontal. Fighting the
  instrument instead of the layout would have produced a figure that scores well
  and reads badly.
- With `-90` the collisions went to zero and the auditor then reported the axis
  line striking through every label — because it models a rotated label as
  **centred on its anchor** while `text-anchor="end"` draws the glyphs downward
  from it. Two different rectangles. Centring the label makes what the gate
  measures and what a reader sees the same thing.

**And the independent adversarial pass over phase 1 found that phase 1's own fix
had opened a hole** — see the CHANGELOG entry. Making the prose em dashes plain
was right, and it removed an *accidental* guard that had been keeping a literal
`Infinity` out of documents. That is this repo's recurring shape, now recorded
twice in one campaign: **a fix can be worse than the defect, and only
measurement tells you.**

## The rule this campaign is enforcing

From [[every-calculator-draws]], the user's words on 2026-08-02, which were scoped
to Engineering then and are being applied to the rest of the product now:

> **every calculator should have data that is inserted and a graph. Visual
> representation is imperative.**

## Plumbing status per registry — this decides the order

The registries are **not** equally ready, and the cheapest are not the ones with
the most missing figures.

- **Statistics — fully plumbed.** `StatOutput.svg?` renders into the pane
  (`:7671`) and `insertStatsResult()` (`:7700`) inserts text and figure together.
  A calculator draws by returning one more property. **Zero plumbing work.**
- **Analyze — fully plumbed.** `AnalyzeBlock` has a `plot` kind carrying its own
  `svg/caption/alt/w/h`, and the rich insert path already handles it.
- **Assay — partly plumbed, and the shape is too narrow.** `AssayPlot` is
  `{ data, predict, xlabel, ylabel }` — a *fit curve*. That fits the five that
  already draw and none of the eleven that do not: Beer's law and a dilution are
  not curve fits. Needs a raw-SVG escape hatch alongside the fitted shape.
- **Finance — structurally cannot draw.** `FinCalc.compute` returns a bare
  `string` (`:5792`). There is no output object, no preview slot, no chart state,
  no insert path and no button. This is a type change plus four new pieces of
  plumbing before a single figure can reach anything.
- **Solve — structurally cannot draw**, same as Finance.

## Order of work

**Phase 0 — commit the baseline.** The tree carries 60 modified and 21 new files
(the Tier 0/1 gap-analysis fixes, 5,457 insertions) uncommitted. Committing that
first is what keeps the campaign diff revertible on its own. No version bump —
bumping breaks `installPacks`/`manifestVersion` until the packs are regenerated,
which is a release step. `tsc --noEmit` clean; full suite must be green.

**Phase 1 — the instrument, before any wiring.** Generalise
`engineering-audit-driver.js` past `sel.value = "engineering"` into a driver that
takes a per-registry descriptor (mode, calc select, result element, insert button,
inputs container) and runs the existing loop — compute on defaults, empty every
field, type rubbish into every field, then **actually run the insert against the
recording Word mock** — for all five registries. Per-registry figure baselines,
starting at the measured numbers above so they ratchet upward.

Doing this first is the whole lesson of the Engineering campaign: `FIGURE_BASELINE`
is what made 130/130 a fact rather than a claim. Wiring 65 figures behind no gate
would reproduce the defect this campaign exists to fix.

**Phases 2-6 — wiring, cheapest plumbing first**, each its own release with an
independent adversarial pass over the diff:

2. **Statistics (16)** — no plumbing, highest value per hour.
3. **Analyze (14)** — no plumbing.
4. **Assay (11)** — widen `AssayOutput` first.
5. **Finance (24)** — the type change plus one wired calculator plus the driver
   proving the insert fires, as its own commit, *before* the other 23. Otherwise
   24 SVGs get written that nothing can reach — this repo's recorded
   [[routing-vs-engine-tests]] failure, one layer deeper.
6. **Solve + UV-Vis** — new surfaces.

## What each calculator draws

The governing constraint is the product's oldest mandate: **all data must be
real**. Nothing here invents a shape. A scalar result draws the *computation that
produced it* — the ladder and bar builders in `mechchart.ts` exist for exactly
this and were built during the Engineering campaign for the same problem.

**Do not write new builders where these fit:** `ladderSvg` (generic waterfall,
parameterised format, result row survives the row cap), `hBarSvg` (named
quantities, magnitude-aware labels), `buildPlotSvg` (curves; drops non-finite x
and y at the door), `buildHeatmapSvg` (a matrix is natively a heat map).

### Statistics (16)

| Calculator | Figure | Source of the data |
|---|---|---|
| `descriptive` | box plot + strip of the values | the user's numbers |
| `twosample`, `paired` | per-group dot plot, means and CI on the difference | computed |
| `mannwhitney`, `wilcoxon` | same dot plot, ranks marked | computed |
| `anova`, `kruskal`, `friedman` | dot plot per group with group means | computed |
| `tukey`, `dunnett`, `multcomp` | forest plot of the pairwise CIs against zero | the post-hoc's own intervals |
| `assumptions` | Q-Q plot | the residuals it already tests |
| `chigof`, `chiind` | observed vs expected grouped bars | both tables are computed |
| `twoway` | interaction plot, one line per level of A | cell means |
| `uncertainty` | contribution ladder | each term's share of the combined uncertainty |

The forest plot is the point of a post-hoc test — a table of intervals is the
same information a reader cannot see. `tukey`'s caveat currently tells the user to
go and run a different calculator by hand.

### Analyze (14)

| Calculator | Figure |
|---|---|
| `inverse`, `multiply`, `transpose`, `expr`, `determinant` | heat map of the result matrix |
| `qr` | heat maps of Q and R side by side |
| `svd` | scree plot of the singular values (the decay is the answer) |
| `eigen`, `eigen-general` | eigenvalues in the complex plane (`poleZeroSvg` shape) |
| `solve` | solution vector as bars, plus the residual |
| `insights` | correlation matrix heat map — it already computes the matrix |
| `optimize` | objective vs iteration, the convergence curve |
| `pdeheat`, `pdewave` | field heat map over x and t |

`insights` is the strongest single item in this table: an exploratory-analytics
tool whose whole output is correlations, presented as text.

### Assay (11)

| Calculator | Figure |
|---|---|
| `linearize` | the linearised plot itself — this is what "linearize" *means* |
| `inhibition` | dose-response with and without inhibitor |
| `bufferratio`, `hh` | ratio (or fraction protonated) against pH, with the point marked |
| `serial` | concentration against dilution step, log axis |
| `beer`, `na260`, `protein280`, `dilution`, `efficiency`, `chengprusoff` | ladder of the computation |

### Finance (24)

| Calculator | Figure |
|---|---|
| `fv`, `pv`, `compound` | balance per period |
| `loan`, `amort` | principal against interest per period, stacked |
| `npv`, `dcf`, `irr`, `xirr` | discounted cash-flow waterfall (`ladderSvg`) |
| `bs`, `greeks`, `iv` | option value against spot |
| `bond`, `ytm`, `bondrisk` | price against yield |
| `depr`, `depr-sl` | book value over the asset's life |
| `annuity`, `perpetuity` | the payment stream |
| `returns`, `cagr`, `gann`, `ear`, `rate-forms` | bar or ladder of the terms |

### Solve

- equation → f(x) over a sensible window with every root marked
- derivative → f and f′ overlaid
- integral → the curve with the integrated area shaded

The window is the trap: it contains user numbers, so **every sweep bound gets
clamped**. An unclamped bound is not a bad chart, it is a frozen Word
([[unbounded-loops-freeze-word]]).

### Spectra — UV-Vis (§5)

`buildSpectrumSvg` is right that a Gaussian band would be invented. What is real
is the **Woodward-Fieser increment ledger** — the base value and each substituent
contribution that sum to λmax, which `uvvis.ts` already computes and already
displays as text. That is a `ladderSvg`, and it ends on the wavelength axis at the
predicted λmax.

## Non-negotiables, per batch

Carried from the Engineering campaign, where each was paid for:

- **An independent adversarial pass over the diff**, not one written by whoever
  wrote the batch ([[self-written-adversarial-tests]]).
- **Clamp every sweep bound containing a user number.**
- **Size from `readSvgDims` on the actual SVG**, never from the asked-for size —
  a legend outside the frame widens the canvas ([[nominal-size-vs-intrinsic-size]]).
- **Rasterise the real SVG before believing it inserts.** A figure that displays
  in the pane is not one that lands in Word ([[preview-is-not-insert]]).
- **Add a stress entry to `figure-layout-run.ts`** for every new builder — and
  `check:figures` derives its module list from the filesystem, so a new chart
  module fails the gate until a figure from it lands in the corpus.
- **Raise the baselines.** A ratchet that trails what it ratchets is most of the
  way to not being one.
- **Never `git stash` on this repo** — autocrlf re-smudges line endings, which
  breaks the source-slicing guards and can corrupt the committed install packs.

## What this campaign does not do

It does not make figures vector (`OPEN-ITEMS.md` §9 — every insert goes through
`svgToPngBase64`), add sub-panel assembly (§11), or add significance brackets and
typed error bars (§10). Those are figure *quality* items and are separate work.
This campaign is about figures that do not exist at all.
