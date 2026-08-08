# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

> Note: this file was not maintained between v1.96.0 and v2.23.0, nor between
> v2.52.0 and v2.59.0. Those releases are recorded in the git history rather
> than here.

## [2.100.0] — 2026-08-08 — Fraction equations, from paste to worked answer

Driven by a real paste that failed: a rendered 3/(x+3) = 8 copied from a
web page arrives as its LAYOUT — numerator line, denominator line, "=8" —
and Solve read the lines as a system.

### Added
- **Stacked-fraction paste reassembly**: the unambiguous three-line
  clipboard shape (two =-free lines, then a bare "= rhs") rebuilds as
  (num)/(den) = rhs, with a note saying exactly how it was read. A real
  system (every line carries =), a topology point cloud, and two-line
  graph entries are never touched — an ambiguous paste is left alone
  rather than guessed.
- **Worked fraction equations**: 3/(x+3) = 8 now shows the student's
  move — "Multiply both sides by (x + 3) — allowed because a solution
  must keep it nonzero" → the cleared polynomial → collect → divide →
  x = −21/8. Two denominators clear into their quadratic (with factoring
  when the roots are rational: 6/x = 5 − x → (x − 2)(x − 3)); when
  clearing changes the root count, the work stops at a neutral caution
  instead of presenting an excluded or complex candidate as a solution.
- The canvas graphs a reassembled fraction paste as its two sides — the
  crossing IS the solution on screen.

### Fixed (adversarial pass: 4 findings)
- The caution line no longer claims dropped candidates were pole values
  when they may be complex roots ("discarding any value that makes a
  denominator zero" was false for 1/x + x² = 0).
- Symbolic-path roots (re = NaN, value only in `display`) are evaluated
  for the factoring verification — cleared quadratics now factor instead
  of silently falling to the formula.
- "x = pi" no longer gets a redundant collect line restating itself as a
  rounded decimal.

## [2.99.0] — 2026-08-08 — Show your work

Solve results now carry the derivation a student would be required to
write — in the pane, in the equation canvas, and in the inserted Word
equations.

### Added
- **Worked equations** (src/lib/showWork.ts): linear solves show
  collect → divide → answer; quadratics FACTOR when a student could
  ((x − 2)(x − 3) = 0, "a product is zero exactly when a factor is
  zero") and otherwise show the quadratic formula with the numbers
  substituted; a zero discriminant is named as one repeated root; cubics
  and higher factor completely when every root is rational.
- **Worked derivatives**: the rule applied at each level — term by term,
  constant factors carried through, product/quotient rule with u, v, u′,
  v′ written out, power rule, chain rule with the derivative table line —
  ending in the engine's own assembled result.
- **Worked integrals**: F(b) − F(a) with both values substituted — the
  fundamental theorem written out, using the pane's own bound labels
  (F(pi), not F(3.14159)).
- The work is DERIVED FROM the engine's answer and verified against it;
  on any mismatch the work is withheld — no work beats wrong work.

### Fixed (adversarial pass: 6 findings)
- An integral the engine says does not exist (∫1/x² across its pole) no
  longer gets fundamental-theorem work ending "= NaN" — a NaN slipped
  past a subtraction-style guard, reintroducing the exact
  NaN-into-Word-equation failure documented ten lines above it.
- d/dx (sin(3) + x) no longer fabricates a rule line about sin(x) —
  constant subtrees now differentiate to a stated 0.
- u′ lines and the assembled line are simplified like the engine's
  answer (no `2*x^(2 - 1)*1` presented as "simplified").
- Work-line superscripts render properly in the pane (the typeset bridge
  now runs on work math; previously only the "(" was raised), "term by
  term" is said once, x² = 0 shows its repeated root instead of
  (0 ± √0)/2, and factored forms never print "-1(" or "(x - 0)".

## [2.98.0] — 2026-08-08 — Paste from anywhere; the canvas becomes a workbench

"It's limiting… almost like the ability to write it or copy and paste
from another source" — so now it reads what people actually paste, and
the canvas solves and graphs while you work.

### Added
- **Paste from anywhere** (src/lib/pasteMath.ts): equations copied out of
  rendered Word equations, PDFs and web pages just work — math-italic
  letters (𝑥 → x, every Unicode style by codepoint arithmetic), Greek
  variables (θ → theta, solvable symbolically and typeset back as θ),
  **LaTeX** (\frac, \sqrt, ^{}, $-delimiters), vulgar fractions (½ and
  1⁄2, mixed numbers read as ten-AND-a-half), invisible characters and
  typographic spaces. Every transformation is REPORTED in a note under
  the input; what has no single faithful reading (±, ∂, ℝ, Σ) is named,
  never guessed.
- **The canvas solves live**: roots with solve-for chips, systems with
  their classification, inequalities as intervals, limits and Taylor
  series, derivative, antiderivative with its differentiate-back check,
  definite integrals with new bounds boxes — the same engines the pane
  inserts from.
- **The canvas graphs like a graphing calculator** (src/lib/graphCalc.ts):
  one curve per line, `y = …` entries, an equation graphs BOTH sides so
  the crossings are the solutions, window under your control, poles stay
  gaps (1/x is two branches, never a wall), every ungraphable line says
  why.
- **Searchable equation library**, tripled: mechanics, electricity &
  waves, thermo & chemistry (dilution C₁V₁ = C₂V₂, Beer's law with ε),
  growth & finance — every formula loading ready to solve for any symbol,
  Greek included. Greek palette group; calculus templates for the
  Differentiate kind.

### Fixed (adversarial pass: 7 findings, all value-pinned in tests)
- LaTeX letter runs were becoming single invented identifiers — E = mc²
  solved for a variable called "mc", \sin x read as sin·x. The converter
  now keeps letter atoms separate products and gives \sin-family commands
  their argument.
- Precomposed ½ (what Word autoformat writes) was unread; 10½ now reads
  as ten-and-a-half, not 10·½ = 5.
- Bold digamma no longer misread as Alpha/Beta (Greek run bound), x_θ
  keeps its subscript binding, adjacent Greek letters stay separate
  variables, and geometry inputs no longer receive the equation-side
  advice about ″ and ° that the geometry engine reads natively.

## [2.97.0] — 2026-08-08 — The equation canvas: pop out, draw, real symbols

The follow-up asks, delivered: a large canvas pop-out for Solve, the
equation DRAWN as real mathematics while it is composed, and symbols
instead of plain-english spellings — the √ sign itself, not "sqrt".

### Added
- **Open equation canvas ⤢** (Solve): the composer in a large Office
  dialog — the current input rides along, the equation drawn LARGE at the
  top as it is built, the full palette and equation library at working
  size, and a live "Reads as…" line validated by the SAME engines the
  pane solves with. "Use this equation" hands it back; the pane restores
  the kind the canvas was opened for. For the geometry kind the canvas
  draws the COMPOSITE FIGURE live as it is described.
- **Real symbols in the palette**: √() inserts the radical sign (the
  parser reads √(x+1), √4, √sin(x) natively), x²/x³ insert real
  superscripts, ≤ ≥ ≠ insert the glyphs — input can now look like the
  mathematics it is.
- **Live typeset preview in the pane**: the Solve input draws itself as
  real mathematics (radical bars, stacked fractions, relation glyphs)
  under the box while typing — powered by a new solve-grammar →
  typesetting bridge (src/lib/solveTypeset.ts) that the OMML insert path
  accepts too.

### Fixed (adversarial pass over this diff)
- Limit/Taylor PROSE (`limit sin(x)/x as x -> 0`) is recognised as prose:
  the canvas's validation line now reads it the way the pane does instead
  of calling valid input unreadable, and neither surface "typesets" the
  keywords as juxtaposed variables pretending to be mathematics.
- Switching the Solve kind while the canvas is open no longer pastes the
  result into the wrong kind — the return restores the kind the canvas
  was opened for (the draw canvas's own guard, applied here).
- The geometry canvas hides the empty equation strip instead of showing a
  blank band above the live figure.

## [2.96.0] — 2026-08-07 — Solve grows a composer and composite geometry

The Solve upgrade requested alongside the drawing canvas: build equations
by click the way Build draws structures, and answer real drafting-room
geometry ("a 10″ × 5″ rectangle with a triangle inside — area with and
without the triangle").

### Added
- **Composite plane figures** (Solve → Geometry): a base shape minus
  cutouts / plus additions — `rectangle 10in x 5in minus triangle b=4in
  h=3in` → area with the cutouts still counted (50 in²) AND without
  (44 in²), exactly. π and surds survive (`rectangle 8 x 6 minus circle
  r=2` → 48 − 4π; Heron triangles keep their root until it resolves).
  Units in/ft/cm/mm/m/yd, mixed units converted exactly (1 ft = 12 in as
  rationals, never floats). Prose accepted — the request above works
  verbatim, inch marks and all. Shapes: rectangle, square, circle,
  semicircle, triangle (b/h or three sides), trapezoid.
- **The figure draws**: base to scale, cutouts hatched, additions
  attached, dimension labels, area caption — and the placement
  disclaimer on its face (the areas do not depend on where cutouts sit).
  Previewed in the pane before insert; the alt text carries the exact form.
- **Equation composer** (Solve → equation/derivative/integral): a palette
  of structures (fractions, powers, roots), functions and relations that
  insert at the caret, plus an **equation library** — F = ma, PV = nRT,
  Pythagoras, kinematics, compound growth… — loading complete formulas
  the solve-for chips can rearrange for any symbol. Geometry gets shape
  and composite-figure templates.
- Honesty built in: a shape with missing dimensions is asked for them by
  name; an impossible triangle or a cutout larger than its base is
  refused; perimeter is only reported where the dimensions determine it.

### Fixed (adversarial pass over this diff — two were silent wrong numbers)
- Decimal dimensions survived sentence-punctuation stripping: `10.5` was
  becoming `10 5` and solving a different rectangle, behind green tests
  that only checked for NaN. Values are now asserted exactly.
- "with a semicircle attached / added / on top" computed a SUBTRACTION —
  the advertised addition prose now adds.
- Point-list triangles and SSA (angle-named) triangles are declined by the
  composite parser instead of being misread as side lengths — they belong
  to the classic geometry grammar and now fall through to it.
- The composite figure previews in the pane rather than being first seen
  inside the document (preview-is-not-insert, inverted).

## [2.95.0] — 2026-08-07 — Reset, Clean structure, and a compliance note

### Added
- **Reset canvas** — wipes the drawing (and the Markush flag) back to a
  fresh start. Recoverable via the editor's undo; typed R-group definitions
  deliberately survive, since undo cannot bring those back.
- **Clean structure** — re-lays the drawing out with machine-generated
  coordinates (untangles overlaps and distorted rings). Connectivity,
  charges and stereochemistry are untouched — the canonical ID code is
  identical before and after — and the hand-drawn layout is one undo away.
- **Compliance note** under the canvas, always current while drawing: an
  exceeded valence (e.g. a pentavalent carbon) or atoms drawn on top of
  each other reads **Not compliant**; a nonzero net charge is a *note*
  (an ion is real chemistry — OCL's own validate() would reject acetate).
  OCL's stereo validations are deliberately not surfaced: the same racemic
  molecule passes or fails them depending on how the object was built, and
  a verdict that flips on provenance is not one to show a user.

### Fixed (adversarial pass over this diff)
- Messages name elements, never atom indices — internal helper arrays
  re-sort hydrogens, so indices need not match the drawn order.
- Programmatic canvas refreshes (Clean, dialog return, Edit in Draw) no
  longer wipe the just-set status line one frame later — the deferred
  editor event now preserves it; user edits still clear stale status.
- Reset no longer erases typed R-group definitions (undo could not restore
  them); a compliance re-check failure cannot turn a successful clean into
  a thrown click.

## [2.94.0] — 2026-08-06 — A big canvas for real drawing

Second round of in-Word feedback: it draws, but the canvas is cramped.

### Added
- **Open large canvas** — pops the same editor into a near-full-screen
  Office dialog window. The pane's molecule rides along (full-fidelity
  idcode encoding, Markush flag included); draw at size, click **Use this
  drawing**, and it lands back in the pane ready to insert. Oversized
  structures that cannot ride the URL open a blank canvas with both windows
  saying so (never a silent replace).
- The in-pane canvas is taller (400px) and **resizable** — drag the handle
  at its bottom-right corner (the editor re-lays-out live).

### Fixed (adversarial pass over this diff)
- The dialog readout honors the R-group⇒generic display contract — no
  concrete formula counting R at mass 0 — and shows the formula immediately
  on seeding, not only after the first edit.
- The large-canvas button disarms while a dialog is open (no raw Office
  error on a double click) and re-arms when the dialog closes either way.

## [2.93.1] — 2026-08-06 — First real-Word feedback on the Draw canvas

The user's first in-Word pass read as "does not work": the Markush box
snapped back off (by design, on an empty canvas) and the toolbar would not
drag (it is select-a-tool-then-draw, and nothing said so). Verified with
real CDP input events against the production bundle at 1× and 1.5× display
scaling that drawing itself works in the WebView2 engine.

### Fixed
- The Markush checkbox now MIRRORS the molecule's fragment flag, so it can
  be ticked on an empty canvas to pre-arm a genus before drawing — instead
  of snapping back unchecked, which a real user correctly read as broken.
- A hint under the canvas explains the interaction model: pick a tool on
  the left, then click or drag on the canvas.

## [2.93.0] — 2026-08-06 — Draw structures like ChemDraw

The most-requested capability from users: Build mode now opens on a **Draw
tab** hosting OpenChemLib's interactive canvas editor — drag-and-drop atoms,
bonds, ring templates, chains, charges and wedge/hash stereo, entirely
offline. Every edit derives the insertable figure through the same
BuildResult pipeline as the typed builder, so the formula/SMILES readout,
R-group legends, Markush flagging, provenance alt-text and Insert all work
identically from a drawing. The typed atom/bond + molfile surface is intact
under a Text tab, and Chemical mode gains **Edit in Draw** (look a compound
up, then modify it on canvas).

### Fidelity (hardened by two independent adversarial review passes)
- Drawn structures record to history as `idcode: <code> <coords>` — the one
  text form that round-trips the Markush/fragment flag, query features,
  R-groups and layout (a molfile silently drops the first two). The builder
  gains an `idcode:` parser with a decode→re-encode canonicality guard,
  because OCL otherwise "decodes" junk into confident fabricated molecules.
- An R-group forces **generic** on every path — drawn, typed, `idcode:`, and
  now pasted molfiles too. No more concrete formulas counting R at mass 0.
- R-group legend definitions survive tab peeks and mid-drawing transients;
  history records are captured at Insert-click time, not after the awaits.

### Changed
- The bundle ships OpenChemLib **full** (the only build with the editor) via
  a webpack alias — one OCL copy, task pane bundle ~4.3 → 5 MB, still fully
  offline.

## [2.92.0] — 2026-08-05 — Solve reads all sixteen textbook word problems

Completes the run that started at **0 of 15**. Against the verbatim worked
examples of LibreTexts 1.20 plus the user's own train problem: **16 of 16
correct, 0 wrong, 0 refused.**

### Added — five recognisers, one per concept the translator lacks
| family | example | answer |
|---|---|---|
| proportion | 4 blocks weigh 28 oz — how many weigh 70 oz? | 10 |
| percentage change | bread up 5% from $2.40 | 2.52 |
| partition | 300 ft fence, longer 4× shorter | 60 and 240 |
| perimeter | equilateral triangle, P = 60 | 20 |
| | rectangle, length 3 more than twice the width, P = 20 | 7/3 and 23/3 |
| | gardener: $600 at $10 per linear foot, twice as long as wide | 10 × 20 |
| work at an hourly rate | 3 workers, $12/h, $180 total | 5 hours |

Each is its own recogniser rather than more vocabulary in the sentence
translator: a translator that "sort of" understands geometry produces a
confident wrong number.

### Fixed — three defects, all one family: a quantity spelled as a WORD
- **"three workers … $12 per hour" answered 15 hours where the truth is 5.**
  The head count matched no digit and silently defaulted to one. Number words
  are now converted for every recogniser, and the work-rate recogniser refuses
  without an explicit count rather than assuming one.
- That normalisation then turned "into two pieces" into "into 2 pieces" and
  broke the partition guard — a normalisation step silently invalidating a
  guard downstream of it.
- The partition total matched the first number anywhere in the sentence,
  including the multiplier. It now requires a unit.

## [2.91.0] — 2026-08-05 — Solve reads word problems

Asked for by the user, with two sources and a problem of their own (a train
with an unknown number of passengers). **Measured against the eleven verbatim
worked examples on LibreTexts 1.20 plus four of ours, driven through the
shipped bundle: 0 of 15 solved.** The module's own documented "a number …"
template was refusing its canonical example, because it translated the question
along with the statement.

**Now 8 of 15, and the other 7 refuse cleanly** — all five of the page's
translation problems (Example 18.2 a–e), two simple number sentences, and the
running-total shape.

### Added
- **Statement/question splitting.** A word problem is facts plus a question;
  only the facts are an equation.
- **The page's own vocabulary** — "an unknown number", "is equal to", "the
  difference is", "gives the same result as", "multiply … by", number words.
- **A running-total recogniser** — an unknown start, a sequence of gains and
  losses, a stated final amount. Separate from the translator because each
  event's direction comes from a verb against a container ("get off" vs "get
  on"), not from an arithmetic word.

### The failure worth recording
The first working version answered two of the five with **wrong numbers**
(−2.2 for 9, −0.75 for 8) because the inverting phrases were resolved before
the unknown was substituted. A wrong answer is the one outcome this module
exists to prevent. Every inversion is now pinned by a test asserting the
**equation**, not just the answer — a reversed subtraction solves happily to a
plausible wrong number.

### Still refused, deliberately
Percentage-increase, work-rate, partition, proportion and perimeter problems
each need a concept the translator does not have, and are pinned as refusals so
that if one ever starts answering it does so with a test written for it. Every
translated problem shows the equation it derived, which is what makes widening
the vocabulary safe.

## [2.90.1] — 2026-08-05 — Solve answers questions again, and eight figure defects

### Fixed — reported from real use
- **Solve appeared not to respond to questions.** It was not broken, it was
  REFUSING: the word-problem mode has four narrow templates and no fallback, so
  `Solve for x: 3x + 5 = 20` came back as "this isn't one of the offline
  templates" while the equation solver two dropdown positions away answers it
  instantly. Word mode now pulls any embedded equation out of the sentence and
  hands it to the real solver, and the refusal — when it is genuinely a
  refusal — says what to type instead. Reproduced by driving the shipped
  bundle before diagnosing.

### Fixed — found by a deep-dive bug hunt over v2.90.0
- **A finite result could put `NaN` in a chart, and the text gate could never
  catch it.** `hi - lo` overflows to Infinity for two finite values near the
  ends of the double range, so every scale became Infinity/Infinity. Reachable
  by an ordinary route: a RANK test is immune to magnitude, so Mann-Whitney on
  `1.7e308 -1.7e308 1 2 3` returns a perfectly finite U, z and p and enables
  Insert. `hBarSvg` had carried this guard since the Engineering campaign;
  `statchart` did not inherit it.
- **Serial dilution rendered a framed, titled, EMPTY chart.** A log axis with no
  `dropForScales` gave `d="M48,NaN L147,NaN …"` — the identical defect the
  pharmacokinetics plot fixed and documented 14,000 lines earlier.
- **Uncertainty propagation named a winner that does not exist.** On the shipped
  default all three contributions are exactly tied; finite-difference noise
  ranked one first and the pane printed "Largest contribution: c" beside three
  identical bars.
- **The dose-response curve could not show its own EC50** — a sigmoid in log
  concentration drawn on a linear axis put six of seven points in the leftmost
  tenth. Now log-scaled, sampled logarithmically, with the fitted midpoint
  marked. All five fitted assay figures also gained a title; they had none, so
  a Michaelis-Menten fit and a 4PL were indistinguishable once inserted.
- **Cheng-Prusoff labelled a Ki′ as a Ki** on the uncompetitive bar, an
  equivalence the result text explicitly denies two lines above.
- **The inhibition figure dropped [I] levels silently**, and the ladder dropped
  rows silently — so a waterfall's bars stopped short of its own total.
- Control characters in a factor level (0x07 is Word's own table-cell marker,
  so pasting a table cell as a factor level is the vector) made the whole SVG
  not-well-formed: the pane rendered it and the insert failed. Now removed.
- The `ladderSvg` row cap could be escaped entirely by a negative slice end.

### Fixed — insert path
- **Solve could insert an orphan figure and report success.** `insertDerivation`
  returned `void`, so it was the one text-plus-figure handler that could not
  tell whether its text had landed.
- **The busy guard did not span the figure phase**, in any of the four handlers
  whose comments said it did: `insertPlainText` releases the flag when the TEXT
  is done, and the rasterisation that follows ran unguarded. Two clicks gave
  `text, text, figure, figure`. A composite guard now covers the whole action
  and disables the button while it runs.
- Statistics figure alt text was the registry SLUG ("diagnostic plot for
  multiregress"), and Finance reported a failed chart as a failed result.

### Fixed — gates that could not fail
- **The em-dash guard for Finance and Bio/Assay scanned 12 characters.** Its
  body extractor counted `(` as an opener, so on `compute: (r) => {` it closed
  on the parameter list and returned `"compute: (r)"` for all 40 calculators —
  the guard holding the two defects it was extended to catch. Re-injecting the
  historical annuity defect proves the old one was blind and the new one is not.
- **The blank-figure detector could not fire on `buildPlotSvg` figures** —
  roughly half the product's figure sites. It excluded only `#ffffff` and
  `plot.ts` writes `#fff`, so marks was always non-zero. Its self-test passed
  because the payload used a spelling `plot.ts` never emits.
- Two tests keyed to a fixed byte window read past the code they named.

## [2.90.0] — 2026-08-05 — the chart campaign is COMPLETE: 84 of 84

Every calculator outside Engineering now inserts data AND a graph. With
Engineering's 130/130 that is **214 calculators**, each with its own ratchet in
`scripts/pane-audit.js` enforced by `npm run qc`, so a lost figure fails the
build and a new calculator must ship with one.

| Registry | Was | Now |
|---|---|---|
| Statistics | 5 of 21 | **21 of 21** |
| Analyze | 8 of 23 | **23 of 23** |
| Bio/Assay | 5 of 16 | **16 of 16** |
| Finance | 0 of 24 | **24 of 24** |

### Added
- **Finance can draw at all.** `FinCalc.compute` returned a bare `string`, so it
  was the one registry with nowhere to put a figure; it now returns
  `string | { text, svg? }`, and a plain string still works so the unwired
  calculators were provably unchanged. The type change landed with exactly ONE
  wired calculator so the insert path was proven before 23 more were written
  against it.
- **`src/lib/statchart.ts`** — box plot, forest plot and grouped bars, the three
  figures a statistics result needs that a continuous-axis plotter cannot draw.
- Shared Finance builders: a money-over-time curve, a discounted cash-flow
  ledger, a price-against-yield curve and an option-value curve.
- **`AssayOutput.svg`** beside `plot`, because the eleven Bio/Assay calculators
  that had no figure are not curve fits.
- `dunnett.ts` reports `ciLow`/`ciHigh`; `optimize.ts` records a convergence
  history — both so a figure can be drawn from the engine's own numbers rather
  than reconstructed.

### The rule every figure follows
Drawn from the SAME engine call that produced the printed text, so the picture
cannot disagree with the number beside it; and every sweep bound containing a
user number is clamped, because a period count of 1e9 on a pane that recomputes
per keystroke is a frozen Word, not a slow chart.

---

### v2.90.0 detail — phase 2: Statistics starts drawing

### Added
- **`src/lib/statchart.ts`** — the three figures a statistics result needs that
  `buildPlotSvg` cannot draw, because one axis is categorical: a **box plot**
  (group comparisons), a **forest plot** (pairwise intervals against a null
  line, with the null at 1 for ratio comparisons), and **grouped bars**
  (observed against expected). 29 property-based tests.
- **Six Statistics calculators now draw** (5 → 11 of 21, measured by the pane
  audit): descriptive statistics, both t-tests and one-way ANOVA get box plots;
  **Tukey HSD gets the forest plot of its own intervals** — the figure a
  post-hoc test exists for, and the one its own caveat used to send the user
  elsewhere for; chi-square goodness of fit gets observed against expected,
  which answers the "where does it differ" question χ² structurally cannot.

### Fixed — found by an independent adversarial pass over phase 1
- **A non-finite value could reach a document, caused by phase 1's own fix.**
  `describeAssumptions` prints its variance ratio with a bare `toFixed`, and the
  ratio is `Infinity` whenever one group is constant — rendered as the literal
  string "Infinity", never as the em-dash sentinel. That text had been blocked
  only by ACCIDENT, by an em dash elsewhere in the same note; making the prose
  dashes plain removed the accident. Finance had blocked NaN and Infinity by
  name for some time while Statistics, Analyze and Bio/Assay ran on the dash
  alone; **all four now share one `insertableResultText` gate.**
- **`insertPlainText` returned `void` while swallowing its own errors**, so both
  "insert the result AND its figure" handlers claimed success over a failure and
  appended the picture anyway. It returns a boolean now — which also closes a
  double-insert: a second rapid click no longer falls past the busy branch and
  adds the figure twice beside one copy of the text.
- **The audit reported every `EXCEPTION` line as `ok`** — a missing verdict
  token defaulted to the empty list, and `[].every()` is true.
- **The audit's `THREW` detector was dead for two of four registries** (it
  matched only Analyze's wording), and its DEFAULT pass downgraded a
  blocked-insert em dash unconditionally — blinding it to the very defect it was
  built to find.
- The audit could pass with a mode that no user can reach (its dropdowns are
  populated at boot, so it found them by id regardless), its self-test exercised
  a *copy* of the figure counter rather than the counter, and its per-registry
  `total` documented a "lost calculator" guarantee that nothing implemented.

---

### v2.90.0 detail — phase 1: the instrument

Opened because of user feedback — *"charts are missing from stats, solve,
analyze, spectra, finance… the landing page shows them but yet jurislab does not
seem to have them"* — and because the gap analysis had independently ranked the
same thing top: the figure ratchet that made "every Engineering calculator
draws" a fact covers **only** Engineering. See
`docs/CHART-CAMPAIGN-2026-08-05.md`.

### Added
- **`npm run audit:pane`** (`scripts/pane-audit.js` + `pane-audit-driver.js`),
  now also a `npm run qc` step. Drives Statistics, Analyze, Bio/Assay and
  Finance in the real production bundle: every calculator on its defaults, every
  non-default dropdown option, every field blanked, rubbish in every field, then
  a real insert against a recording Word mock. Carries a **per-registry figure
  ratchet** and self-tests every predicate on a known-bad payload first.

### Fixed — all found by that audit on its first run, none visible to 9,332 tests
- **Bio/Assay inserted the numbers without the curve.** Michaelis-Menten, Hill,
  dose-response, binding and substrate inhibition drew a fit in the pane and
  inserted no picture. The plot is part of the result — for a fit it is the half
  that shows whether the model describes the data.
- **The heat, wave and Laplace solvers drew charts nobody could get.** A `NaN`
  placeholder in the corner of the sampled grid rendered as the "not computable"
  sentinel and suppressed the entire result, chart included.
- **Two-sample t-test, paired t-test and one-way ANOVA were un-insertable**, from
  prose em dashes spliced in from `describeAssumptions` at run time. The
  existing guard is a source scan and cannot see punctuation that arrives from
  another module. Two more latent call sites fixed with them.
- **`insights`, `linearize` and the Cheng-Prusoff non-competitive result** were
  un-insertable for the same reason.
- **`greeks` Delta and `returns` Sharpe ratio printed a literal `NaN`** where
  every neighbouring line was already guarded.
- **`protein280` could not compute on its own defaults** — a field labelled
  optional was treated as required. `AssayField.optional` now declares it.

---

### v2.90.0 detail — the non-Engineering half, repaired (the 2026-08-05 gap analysis)

The 2026-08-05 gap analysis (`docs/GAP-ANALYSIS-2026-08-05.md`) swept everything
outside Engineering and Citations — a surface that gained **43** Engineering
calculators and **zero** statistics calculators over the preceding 26 releases.
It found 31 live defects. All are fixed, with a named regression test each.

**Wrong content that was reaching the document.** A GenBank import declared every
sequence a *synthetic construct* in the filed ST.26 listing, because the reader
skips the `source` feature the pane read the organism from — now parsed from the
`ORGANISM` header and verified end-to-end into the XML. Every predicted spectrum
drew a **negative** axis (¹H NMR ticks read −4 … −1 ppm; IR read −4000 cm⁻¹): the
data is negated so δ increases leftward, and nothing un-negated the tick labels.
A pole-crossing integral typeset `= NaN` into Word while the pane correctly said
there was no value. Finance's insert gate blocked `"—"` but not `NaN`, so a
constant return series inserted `Sharpe ratio NaN`.

**Wrong numbers on screen.** The statistical assumption checker tested the pooled
marginal instead of the within-group residuals, so it declared non-normality
*because* there was a real effect — 2.1e-5 on two clean groups separated by 4 SD.
IR assigned C–halogen bands from the element alone, so sodium chloride returned a
"C–Cl stretch". NMR invented δ 160 for any carbonyl-like carbon it could not name
and read carbon monoxide as an alkyne. UV-Vis applied Woodward–Fieser to
β-carotene (534 nm against a real 450) while claiming ±5 nm, and called caffeine
and riboflavin colourless benzene.

**Frozen Word.** Two unbounded tick loops built a **510 MB** SVG from
femtosecond-magnitude data; alignment allocated 1.81 GB on a 5 kb × 5 kb paste and
re-ran on every keystroke; `buildDiagramSvg` emitted **23 MB** for a large pasted
table; `bondPrice` never returned for a non-finite maturity.

**Honesty that existed and was thrown away.** ¹H coupling caveats, the isotope
exclusion note, heat-map and candlestick renderer warnings, the log-axis
point-drop note, and every caveat on an empty spectrum were computed and then
dropped before the screen or the document. The dose–response and saturation
binding fits — the two most-used pharmacology tools — shipped with no caveats at
all. Three catch blocks told the user the document was untouched at the moment it
was half-modified.

**Gates.** The figure ratchet was Engineering-only: nothing outside it would have
caught a Spectra, Stats or Table→Chart regression. The figure corpus goes 4 → 13
modules and 71 → 135 figures, deriving its coverage from the filesystem so a new
chart module fails the gate until it has a figure. The whole-library fuzzer that
found seven frozen-Word bugs at v2.18.0 had **never been committed**, and the
library had grown 97 → 151 modules since; it is now `npm run fuzz` (16,560 calls,
zero hangs) plus `fuzz:extreme` for valid-but-large input. A pane id-wiring audit
and the tool-page and figure gates now run on the publish path, and `ts-node` —
which was in neither `devDependencies` nor `node_modules`, so the figure gate
could not run offline at all — is replaced by a require hook built on the
TypeScript already on disk.

**Four independent adversarial passes** over the diff, none by the agents that
wrote it, found 19 further defects including 8 introduced by the fixes. Two fixes
were rejected *after measurement* and rebuilt: the first `primerTm` repair was
worse than the defect (−9 °C against −1.8 °C) and was replaced by exact
enumeration of the degenerate pool; the obvious residual-normality repair fires on
100 % of normal data at three groups of three, and was replaced by a transform
through the exact Beta distribution of a studentized residual (61–100 % → ~8 %).

The final round caught four more: a Unicode fold that routed *around* a deliberate
ambiguity refusal, so `1/2π` answered where `1/2pi` correctly refuses; an exact
root displayed rounded while still flagged `exact: true`; a bond priced at a
confident 1139.82 for a **negative** maturity, because the only quantity checked
was the product `years × freq` and two negatives cancelled; and a summary sentence
able to hijack the Brief Description section and report a correctly-described
figure as missing. Found along the way: the Inhibition (Ki) and annuity
calculators had been permanently **un-insertable** because a stray em dash
collides with the pane's "not computable" sentinel, and `StatOutput.svg`'s
"Display only" comment had outlived the "Insert chart" button — a stale comment
that made an audit report a working feature as absent.

Suite: **281 files · 9,332 tests · 0 failures**, 13/13 QC gates green.

## [2.89.0] — 2026-08-03 — EVERY calculator draws: 130 of 130

The final twenty-four, and the figure ratchet closes at **130 of 130**. Every
Engineering calculator now inserts its data AND its picture — the standing
requirement, met.

Three new equal-aspect builders finish the family: **orbitChartSvg** (conics
about a body at the shared focus — the focus offset of an ellipse is the
physics, and a circular orbit must be a circle), **vectorTriangleSvg**
(tip-to-tail vectors whose angles read truthfully), and **armSvg** (planar
linkages, reference circles, targets, ellipses). One additive engine change:
`DhResult` now exposes every intermediate joint frame, because a chain the
engine walked can be drawn only if the engine says where it went.

The figures: the Rankine and refrigeration **energy ledgers**; your arc
against the **optimum arc for your height**; the **two ways to hit one
target**; impact energy **saturating at terminal speed**; the **S-curve
against its trapezoid** (rebuilt from the engine's own phase times); every
axis's throttled profile **finishing together**; orbits, ellipse and
**Hohmann transfer to scale**; the **tyranny of the rocket equation**;
escape at **√2 × circular** on every radius; the great circle **bowing
poleward** past its chart line (split at the antimeridian); the **wind
triangle** north-up; the **climb triangle** with γ to scale; one TAS
becoming **three airspeeds** with altitude; the arm in its reach circle;
**both IK branches** (an unreachable target still draws — the annulus and
the stranded cross are the most informative picture the tool has); the
**manipulability ellipse**; the DH chain in **two orthographic views at one
shared scale**; the triangular profile **peaking below its commanded
speed**; the differential drive's **turning circles about the true ICC**;
the **r⁻⁴ stenosis curve**; the joint's **force bars**; and the biosignal
**fold diagram**, which now draws the inadequate case too — the signal's
own top folding back into its band, the unfixable failure.

The adversarial pass earned its keep one last time: **two blockers invisible
at the defaults** — the differential drive drew every clockwise turn
mirrored (the engine's turn radius is signed, and re-applying the sign of ω
flipped it), and the Hohmann burn labels swapped orbits on any descending
transfer. Plus the Rankine ledger double-counting the pump work its net-work
figure already contained, the two DH views drifting to different scales, an
orbit-builder overflow guard, and the biosignal gap. All fixed before ship.

## [2.88.0] — 2026-08-03 — Computation, chips, optics and quantum draw

Sixth figure batch of the day and the largest: twenty-two tools across four
disciplines. Ratchet **84 → 106 of 130**. A generic **ledger builder** joins
mechchart (the NPSH waterfall with the strings and number format as
parameters — a temperature ladder in °C and a timing budget in picoseconds
need the same bars and neither survives a formatter hardwired to metres of
head).

Chips: power against clock (leakage flat — the lesson), the **thermal ladder**
ambient→junction against the Tj limit, RC delay **quadratic in wire length**,
and the **setup budget** ledger ending at the slack (hold stays in the text —
it has no period term). Computation: **Amdahl against Gustafson** on log
processors, the **binary entropy curve** or per-symbol contribution bars,
**capacity against SNR**, the **birthday curve** on log items (a linear axis
is a flat-zero lie at the defaults), the **ULP staircase** on log-log
(machine epsilon holds only at 1.0), and the **fitted power law** against a
k = 1 reference. Optics: E = hc/λ as the straight line it is, the beam
**caustic** with its Rayleigh stems, **w(z) walked through the ABCD system**
carrying the running index, the **g₁g₂ stability diagram** (drawn precisely
when the cavity is unstable and the text has least to say), the three
pulse-shape peak powers, the **Snell sweep that simply stops at the critical
angle**, grating orders as stems whose caption says the height carries no
intensity, and the fibre **V-against-λ** crossing 2.405 exactly at the
reported cutoff. Quantum: the state as **probability stems** with its Schmidt
spectrum, **S against both Bell bounds** with the measured uncertainty riding
on the S stem, the Werner **two-threshold curve** (thresholds found by
watching the engine's own verdicts flip, never retyped), and the
**Shor-Preskill bound** with the threshold where the engine bisected it.

The adversarial pass found one blocker — the capacity sweep iterated once per
dB of the USER'S SNR, so a pasted 1e15 dB was a frozen Word (the brief itself
embedded the bug; the no-unbounded-loops rule outranks the brief) — plus an
em dash in a plot title that turned the audit gate red, and four
brief-fidelity gaps. All fixed; the ledger builder now guarantees its result
row survives any row cap, which is the latency-chart lesson generalised.

## [2.87.0] — 2026-08-03 — Audio and video draw

Fifth figure batch of the day: all fourteen **Audio & acoustics** and
**Video & display** tools insert figures. Ratchet **70 → 84 of 130**.

Audio: the **fold diagram** (where every input frequency lands after
sampling — the sawtooth IS aliasing); the **6.02n + 1.76 line** with this
converter on it; **both decibel conventions** on one log-ratio axis; the
**inverse-square falloff** as the straight line it is on log distance; the
Sabine and Eyring **decay slopes to −60 dB**; the **room-mode map** ranked
by audibility; and the **comb response** with its floored notches (the −30 dB
floor is load-bearing — the response is −∞ at every notch, and an unfloored
point would vanish from the very figure that exists to show it).

Video: the **chroma-scheme bars** (4:2:0 halves the data, not quarters it);
**retina distance against screen size**; the **absolute PQ curve** on log
nits; **PSNR against error**; the **buffer timeline** (fill on the surplus,
drain through an outage); the **latency budget bars** with the worst stage
in red and the refresh-quantised delivery; and both **gamut triangles on the
u′v′ chromaticity plane** — a new equal-aspect builder, u′v′ because CIE xy
over-weights greens the eye discriminates poorly, which is the tool's own
argument drawn.

The adversarial pass found no blockers and three fit-and-finish items (the
24-row cap could drop the latency chart's own point, duplicate stage names
both turned red, a far-out-of-band tone flattened the fold diagram) — all
fixed before ship.

## [2.86.0] — 2026-08-03 — All seventeen Energy tools draw

Fourth figure batch of the day and the biggest: the entire **Energy & power**
discipline now inserts figures. Ratchet **53 → 70 of 130** — past halfway.

The conventional picture for each: the wind **cube law** with the Betz bound;
solar output **rated against temperature-derated**; the PV **fill factor as
the area ratio it is** (no invented I-V curve — four datasheet points do not
define one); hydro's two straight lines through the origin; battery **runtime
against current on log-log** with the Peukert sag; the combustion **mass
balance** as bars fixed by conservation; **LCOE against the discount rate**;
capacity factor as **actual against flat-out generation**; the three-phase
**power triangle** (a new equal-aspect builder — φ must read as the angle
whose cosine is the power factor); the pf-correction **cost-of-chasing-unity
knee**; cable **drop against run length** with the acceptance-limit crossing;
the **wind-shear profile** with height vertical, both laws; the fitted
**Weibull density** with the turbine's operating band; the
**combustion-analysis chart** (dry CO₂ and O₂ against excess air); storage's
**1/DoD sizing hyperbola**; the **sun's day** with sunrise and sunset where
the curve crosses the horizon; and **flame temperature against excess air**.

Every curve is either re-asked of the engine point by point or scaled off the
computed result in closed form — nothing is re-derived, so no figure can
disagree with its own table. The adversarial pass found no blockers and four
fit-and-finish defects (a float-residue unity-power-factor branch, one-decimal
labels on small loads, a flue-gas marker that could stretch the axis five
times past the curve, an unbounded voltage-drop axis) — all fixed, plus the
layout audit caught two label collisions in the new triangle builder before
any user saw them.

## [2.85.0] — 2026-08-03 — Control, vibration and electronics draw

Third figure batch of the day; ratchet **45 → 53 of 130**. Three new reusable
builders (a pole-zero map, a generic horizontal bar chart, a logic-waveform
lane drawer) join `mechchart.ts`.

- **Poles, zeros & stability** — the **pole-zero map** on the s-plane, right
  half plane shaded: a × in the shading IS the instability the verdict names.
  Equal scale on both axes, because a pole pair's damping ratio is the cosine
  of an angle that lies on stretched axes.
- **PID & closed loop** — the **closed-loop step response** with this tuning;
  an unstable loop honestly diverges on the plot.
- **Natural frequencies & mode shapes** — the **mode shapes drawn** (first
  five), anchor point included for a grounded chain.
- **Forced response (multi-DOF)** — the **FRF of the loudest DOF** on a log
  amplitude axis, resonances as peaks, the working frequency marked; every
  sweep point re-solves the same modal problem.
- **Op-amp circuits** — **gain against frequency**: flat-then-roll-off closed
  loop meeting the open-loop GBW line, or the integrator/differentiator slope
  with its unity-gain corner.
- **Analogue filter design** — the **magnitude response with the spec drawn
  on it**: passband and stopband edge points sit on the plot, so "delivered
  vs asked for" is visible rather than asserted.
- **DC operating point** — **power per element** as horizontal bars off a
  shared zero line; delivery left, dissipation right, and the two sides
  balance because Tellegen says they must.
- **Truth table & minimisation** — the table drawn as **logic-analyser
  waveforms** (up to five variables), output lane at the bottom.

### The bug the figure caught

The adversarial pass found that an **odd-order Chebyshev filter at a band
edge past a few thousand rad/s was built one degree too high**: the
prototype's real pole carries a ~7×10⁻¹⁷ floating-point residue in its
imaginary part, the band-edge scaling grew it past the ABSOLUTE 1e-12
classification epsilon in `denominatorFromPoles`, and the "real" pole went in
as a full conjugate-pair quadratic. A near-default Chebyshev highpass
(ωp = 4000) delivered −80 dB at the edge the spec puts at −1 dB, and the
reported stopband attenuation was ~3× the truth. **The new figure drew the
spec point 79 dB off the curve — that is how it was found.** The epsilon is
now relative to the pole's own magnitude, with a regression test at the
exact failing specs.

Also fixed before ship: `buildPlotSvg` now sanitises non-finite x AND y at
the door (one overflowed sweep bound used to poison the whole plot's domain
— this ends that class for every present and future caller), the bar chart
survives a value span that overflows Infinity, and an op-amp sweep bound is
clamped.

## [2.84.0] — 2026-08-03 — Thermo and aero draw

Second figure batch of the day; ratchet **40 → 45 of 130**.

- **Ideal-gas process** — the process on the **P–v plane**, states 1 and 2
  marked; the area under the path is the boundary work the numbers report.
  Isothermal is sampled as the hyperbola it is; isochoric is the vertical
  segment it is.
- **Power cycles** — Otto, Diesel and Brayton on the **P–v plane** in ratio
  space, log pressure (r^k alone is ~18 at r = 8), all four corner states
  marked. Corner pressures verified against the engine's temperature ratios
  to machine precision.
- **Standard atmosphere** — T/T₀, p/p₀ and ρ/ρ₀ against altitude, drawn the
  way an atmosphere is always drawn (altitude vertical); the kinks in the
  temperature trace ARE the layer structure.
- **Lift, drag polar & stall speed** — the **drag polar** with the
  origin-tangent ray that IS best L/D, this flight in red, the tangency in
  green.
- **Level turn** — turn radius against bank on a log axis (34 m to 4.4 km
  between 85° and 5° at 120 kt), current bank marked.

The adversarial pass verified every figure against the engines (corner
pressures to 2×10⁻¹⁶) and found one real defect: a denormal airspeed can
underflow the turn radius to exactly zero, and log10(0) through the marker
guard would have put NaN in every coordinate. The guard now requires a
strictly positive radius.

## [2.83.0] — 2026-08-03 — Fluids, thermal and fatigue draw

Continuing the standing requirement that **every calculator inserts data and a
graph**. Six more tools draw; the figure ratchet rises **34 → 40 of 130**.

- **Endurance limit & notch factor** — the estimated **S-N curve**, uncorrected
  against corrected, so the Marin knockdown is visible as the gap between the
  two lines. A steel gets its knee at 10⁶ and runs flat; a non-ferrous alloy
  has no knee to draw, so its line honestly keeps falling to 5×10⁸.
- **Finite life & cumulative damage** — the load spectrum plotted over the
  S-N line it is consuming, each block at its stress and applied cycles.
- **Pipe flow & head loss** — the **system head curve**: the same pipe swept
  over flow with Colebrook re-solved at every point, and this flow marked.
- **Composite wall / pipe insulation** — the **temperature profile** through
  the layers, film drops as vertical steps; slope IS resistance, so the
  insulation is the steep segment.
- **Open-channel flow** — the **specific energy diagram** E(y) at this
  discharge, with the working depth, the critical depth and the E = y
  asymptote; which arm the point sits on is the regime the text names.
- **Pump NPSH & cavitation** — the **NPSH ledger**, a waterfall of where the
  suction head comes from and where it is spent, against the NPSHr line
  (drawn for BOTH loss sources — typed losses have no flow axis, and this is
  the picture that still exists); with the pipe source active, a second
  figure shows **NPSH available falling with flow** while the requirement
  stands still.

The independent adversarial pass found one blocker before ship — the S-N
coefficient (0.9·Sut)²/Se overflows to Infinity for absurd-but-accepted
strengths, and one non-finite y poisons the whole plot's domain — plus a
verdict mismatch at exactly zero margin (the engine calls that cavitation;
the figure said clear), a value label pushed off the canvas by a deep
suction lift, and a text-order regression in the wall tool's unit report.
All fixed; the layout audit's corpus grew the shapes that caught them.

## [2.82.1] — 2026-08-03 — The legend moves outside the plot

User report: "the legend/key should not be inside, it should be outside so
that it does not block the data." Correct, and now true everywhere.

### Legends no longer cover data

`buildPlotSvg` — the shared plotter behind Plot mode, Solve, Analyze, Stats
diagnostics, Engineering, Spectra and Bio/Assay figures — drew its legend as an
opaque box inside the top-right of the plot area. Opacity had been the fix for
curves striking through the labels (v2.80.0); it also meant the box hid
whatever data sat under it. The legend now lives in its own gutter **to the
right of the plot frame**, and the gutter is paid for by **widening the
canvas**, not by shrinking the plot — the data area of every figure is
pixel-identical to before, and unlabeled plots are byte-identical. (The other
chart families — table charts, heatmaps, candlesticks, the Goodman diagram —
already kept their legends outside.)

### The insert paths that would have squashed the wider figure

The independent adversarial pass over the diff found the real defects where
they usually are: not in the geometry but in its consumers. Five insert paths
rasterised the SVG into the **nominal** 380×270 (or 300×300) box instead of
the SVG's own size, which would have squashed every labeled figure
horizontally by 12–30% — Plot mode with two functions, every Bio/Assay fitted
curve, all four 2D NMR maps (a square COSY inserting 30% narrower than tall,
every scatter circle an ellipse), and the Analyze/Engineering rich-block path
including both Bode plots. All five now read the SVG's intrinsic dimensions
(the pattern the stats, PPT and solve inserts already used). The legend width
estimate also grew from 6 to 7 px per character: outside the frame there is no
plot-area slack left to absorb a capital-heavy label, and the canvas edge
would have clipped it.



Fourth release against the engineering deep dive, and the first that adds a
**discipline** rather than depth in an existing one. Engineering **125 → 130**
across **twenty** disciplines. All five new tools insert a figure; ratchet
**29 → 34 of 130**.

Everything here is arithmetic over rates and lives **you** supply. There is no
built-in failure-rate handbook and there will not be one: a failure rate is a
property of a part in a duty cycle in an environment, and a table of them would
be wrong for every application except the one it was measured in — the same
refusal this bench already makes for Cd, emissivity and Thiele-Small parameters.

### Life data: Weibull fit

Fitted by **maximum likelihood**, not by regression on a probability plot.
Median-rank regression needs a plotting-position approximation with fitted
constants in it, and the likelihood equation is exact and needs nothing but the
data. The plot is still drawn — the points use the mean plotting position
i/(n+1), which is a theorem rather than an approximation — but nothing reported
comes from it.

**Units still running are entered as suspensions and used IN the fit.** A unit
that has not failed says the life is *at least* that long, which is real
information; discarding it biases the fitted life short. Johnson rank adjustment
handles the censored ranks for the plot.

**The shape parameter is the answer, not the mean life.** Below 1 the hazard
falls with age, so the parts are dying young: burn-in helps and scheduled
replacement actively *hurts*, because it swaps a proven part for a fresh one.
Above 1 the hazard rises and replacing on a schedule buys something. At 1 the
hazard is constant and replacing on age achieves nothing at all — and that is
the only case where quoting a single failure rate is defensible.

**The regime is read from a likelihood-ratio confidence interval, not from the
point estimate.** The shipped default fits β = 1.640 with an interval of 0.827
to 2.786. That interval straddles 1, so the answer is **constant hazard** — not
wear-out, which the point estimate on its own would have claimed. Two units with
a fitted β of 2.62 come back the same way, on an interval of 0.57 to 7.07. A
fitted β above 1 from a handful of failures is a statement about the sample size,
not about the parts, and only an interval clear of 1 is evidence of anything.

**MTTF ≠ MTBF ≠ 1/λ.** MTTF is the mean of a life distribution and equals 1/λ
only when β = 1; MTBF is time *between* failures on a repairable item, and only
that reading belongs in an availability calculation. The module keeps them apart
in its own naming and says which is which in its output.

### Series and parallel systems

Failure rates add in series, so a system is always worse than its worst part —
and the **component carrying most of the rate is named**, because improving
anything else is close to wasted effort until that one moves.

In parallel the system outlives every part, but the mean life grows only as
1 + 1/2 + 1/3 + …: the second unit buys half what the first did, the tenth buys
a tenth. **The independence assumption is doing all the work**, and a shared
supply, a shared cooling loop, a common design error or one maintenance mistake
takes out every branch at once.

Where the parallel mean life cannot be computed accurately — thirteen or more
units at differing rates, where the exact expression is an alternating sum over
every subset — it is **not reported, and it says why**. The reliability at the
mission time stays exact.

### k-out-of-n, standby spares, availability

**k-out-of-n** for voting logic and pump trains, on log-gamma binomials so
n = 500 does not overflow. Requiring all n is a series system wearing redundant
clothing and is *worse* than one unit; requiring 1 of n is full parallel.

**Active against standby.** Standby beats active because of two assumptions and
not because it is better engineering: the spare is assumed not to age while it
waits, and the switch is assumed never to fail. A switch with its own failure
rate can make standby **worse** than active, because it puts a single point of
failure in front of every spare. The mean life grows **linearly** with standby
units and only **harmonically** with active ones.

**Availability**, labelled what it is: **inherent**. It counts the repair and
nothing else. Waiting for a spare, a technician, a maintenance window or
permission is real downtime and none of it is in this number, so the operational
figure is always lower. Availability also **multiplies down a series** — five
99.6% units in series is 98.0%, which is 173 h down a year against 35.

### Two product-wide plot fixes

**A tiny axis range drew half a million ticks.** Both tick walks in the shared
plotter ended at `t <= max + 1e-9` — an **absolute** epsilon, on axes whose whole
range may be far smaller than 1e-9. Femtoseconds and nanoamps are ordinary pasted
data, and at an x span of 1e-14 that slack is a billion steps wide: measured,
**500,007 tick labels and a 128 MB SVG** for a single plot, every extra tick off
the canvas. In a task pane that is not a bad-looking chart, it is a frozen Word.
The slack is now relative to the step, and both loops are counted. Pre-existing,
not introduced here, and reachable from Plot mode with any pasted column in small
units.

**The right margin of every plot in JurisLab was a flat 14 px** while the left
has been computed from its widest label since the margin work. X tick labels are
centred on their tick, so a tick on the right edge hung half its width off the
canvas — and "2.5e+4" is 36 px wide. Found on a reliability figure whose x axis
runs to a 25,000-hour mission; the defect was in the shared plotter and affected
every plot with wide numbers on the x axis. The right margin is now computed the
same way the left one is.

### Caught by the independent adversarial pass, before any of it shipped

Ten findings over the diff, behind a fully green suite and thirteen passing
gates. The three that mattered:

- **Two letters meant two things, and the parser picked.** "s" is seconds and
  also "suspended"; "d" is days and also "dead". `412 s` was read as 412 **hours,
  suspended** and `412 d` as 412 hours **failed** — a factor of 3600 and of 24,
  silently, in the one field of this discipline that does not go through the
  shared unit layer, under a unit note claiming every duration converts. Both are
  now refused by name, and the life table properly converts h/min/sec/day.
- **`Motor, 1,200, 2` became a component called "Motor 1" failing 200 times an
  hour.** Comma fields are now read positionally and a fourth field is refused
  as a thousands separator.
- **The regime claim in this changelog was wrong.** It said a fitted β of 1.3
  from eight units is reported as "not resolved". It is reported as **constant
  hazard**, because the interval straddles 1 — the right behaviour, the wrong
  word. Corrected here and on both landing pages.

Also fixed: a never-failing branch with more than twelve units was told its mean
life was unreportable "because the alternating sum loses accuracy", three lines
under a reliability of 100.0000 %; the short-mission note printed **"0 active, 0
standby"** for the two probabilities in the sentence saying that is where the
difference lives (they are 1e-31 and 1e-37, and only the subtraction destroyed
them); the redundancy figure stopped at 20 units while n may be 200; the parallel
figure compared against the *worst* part when the claim being made is that the
system outlives *every* part; `rel-koon` accepted a typed reliability and a
failure rate that disagreed and printed two confident numbers about two different
components; and Reliability was missing from the README, FEATURES.md and the
index tagline, which listed 16 names under a claim of twenty.

### Caught while building, before any of it shipped

- **`Math.max(...array)` blew the stack** at 600,000 units. In a task pane an
  uncaught throw is not an error message, it is a dead pane. Quantities are now
  multipliers rather than expanded entries, and every reduction is a loop.
- The redundancy gain ratio printed **"not finitex"** where the system failure
  probability underflowed to zero.
- The life-data parser **refused "900 +"** — a space before the suspension mark
  — in an error message that told the reader to use a trailing +.
- The Weibull fit was capped at 20,000 units, measured: 20,000 fits in 0.4 s and
  100,000 in 2 s, which is a visibly hung pane for a data set nobody types.

### Gates

`ENG_RELIABILITY_UNIT_NOTE` is a **new unit contract** — every duration converts
(h, day, min, s) and failure rates do not, because the unit layer carries no
reciprocal time and "1e-5 /h" is refused rather than misread. "Year" is
deliberately not accepted: it means 8760 h, 8766 h or 2000 operating hours
depending on who is asking. The contract gate was **widened from a two-way split
to a named set of converting contracts** rather than exempting the five tools,
so a reliability tool still cannot read hours with `Number()`. A further
assertion pins that every duration is read with hours as its target.

Every closed form is checked against an independent second path: a 2-D grid
maximisation of the likelihood, an exhaustive enumeration over every up/down
combination, and numerical integration of the survival function. 36 new tests.

## [2.81.0] — 2026-08-02 — Fluids breadth, and fracture mechanics

Third release against the engineering deep dive. **Fluids 4 → 8, Fatigue &
machine design 3 → 6**, Engineering to **125**. Every one of the seven new tools
inserts a figure. Ratchet **21 → 29 of 125**.

### Fluids

**Differential-pressure metering** — orifice, venturi and nozzle. The
**velocity-of-approach factor** is not optional: the ideal derivation assumes
the fluid arrives at rest and it does not, and at β = 0.75 the correction is
**1.2095**, so omitting it under-reads the flow by **17.3%**.

**The permanent loss is not the differential the meter reads** — but this tool
will not tell you what it is. A venturi's diffuser recovers most of the pressure
it took to accelerate the flow and an orifice recovers much less, and that
difference is the entire argument for paying for a venturi; the actual fraction
comes from the meter standard for your geometry or from the manufacturer.
Supply it and it is applied. **It is not predicted**, for the same reason Cd is
not.

**Pump and system curves.** A pump has no flow rate of its own: it has a curve,
the system has another, and the machine runs where they cross — which is why the
same pump moves different amounts in different installations and why a datasheet
flow figure alone means nothing. **Throttling moves the operating point UP the
pump curve**, not down: closing a valve steepens the system curve, so flow falls
while head *rises*, and the extra head is burned across the valve doing nothing.
On the default case that is **8.58 kW** of hydraulic power, which is the number
that justifies a variable-speed drive.

**The affinity laws**, which say how much: flow scales with speed, head with its
square, and **power with its cube** — so a 20% speed reduction leaves exactly
51.2% of the power and halving the speed leaves an eighth.

**Drag on a body**, with terminal velocity and Reynolds number. Power goes as
the **cube** of speed, so doubling it takes eight times the power to hold.

### Fracture mechanics

`fatigue.ts` was entirely S-N: the product could say when a smooth part would
*initiate* a crack and had nothing to say once one was **found**. That half is
now here.

**Stress intensity and the critical crack size.** The useful number is not K but
*"this flaw becomes critical at 15.9 mm and yours is 3 mm"* — that is an
inspection interval. **Fracture is a threshold, not a gradual degradation:** K
rises only as the square root of crack length, so quadrupling a crack merely
doubles K, and a flaw comfortably safe at one stress is catastrophic at one
modestly higher, without warning.

**Paris-law crack growth**, integrated in closed form, with the m = 2 case taken
as a logarithm rather than a division by zero. **Most of the life is spent while
the crack is small** — the first doubling alone takes 40% of it while the growth
rate rises 53-fold — so an inspection interval set from the *total* life is
worthless; it has to come from the time between detectable and critical.

**The yielding-or-fracture transition**, the single number that decides which
calculation is even relevant. Below it the section yields first and a strength
check governs; above it the part snaps while nominally elastic. A tougher
material has a *larger* transition size, which is precisely what toughness buys.

**Three validity gates refuse rather than caveat.** The plastic zone must stay
small, or LEFM does not apply at all and the case needs J-integral or CTOD. The
section must be thick enough for plane strain, and when it is not the assessment
is flagged as **conservative** — a thin plate is *tougher* than a thick one of
the same material. And a crack below the threshold ΔK **does not grow**, which
is an answer rather than a failure and is the basis of damage-tolerant design.

**A unit trap caught before release.** Paris constants are universally quoted
for ΔK in **MPa√m**, and the first draft documented strict SI. A pasted handbook
C inflated the growth rate by 10^(6m) — a factor of 10¹⁸ at m = 3 — reporting a
life of **1.8×10⁻¹³ cycles**. C is now taken exactly as published and converted
inside; the same case gives **180,100 cycles**, matching a hand-integrated
oracle.

K_IC, the geometry factor Y, and C and m are all **user inputs**. Y depends on
the crack's shape and position; C and m depend on the material, environment and
stress ratio and scatter by orders of magnitude across sources.

## [2.80.0] — 2026-08-02 — Thermal breadth, and the graphs made legible

Second release against the engineering deep dive. **Thermal goes from 5
calculators to 9**, Engineering to **118**, and every figure in the product was
measured for legibility rather than eyeballed.

### The graphs

**Reported: "text overlaps, lines going through the text."** Rather than hunt by
eye, the fix started with an instrument — `scripts/figure-layout-audit.js` now
parses every figure, gives each `<text>` a bounding box from its position,
anchor, font size and content, and reports three measurable faults: **labels
overlapping**, **a line crossing a label**, and **a label running off the
canvas**. It models paint order, so a line hidden behind an opaque legend is
correctly *not* a fault. It self-tests on known-bad payloads first, because a
checker that reports "all clear" for something it cannot see is worse than none.

It found **22 issues**, and two root causes explained most of them:

- **The legend backing was 82% transparent**, so gridlines and error bars showed
  through it and struck out the labels beside them. A legend is an annotation
  over a plot, not a tint on it. Now opaque.
- **The left margin was a fixed 48 px.** Ample for "0" and "100", far too little
  for "1.0e+8", which ran back over the rotated y-axis title. It is now computed
  from the widest tick label the data will actually produce — knowable before
  drawing, because tick values depend only on the range.

Both live in `buildPlotSvg`, so **every plot in the product** benefits, not just
the new ones. The remaining thirteen were annotations in the mechanical charts,
all fixed by giving each label an opaque backing, widening the Goodman legend to
fit its longest entry, and deferring Mohr's tick labels until after the line
that was crossing them. **All 18 sampled figures are clean, and the audit is a
QC gate**, so this cannot silently return.

*Two claims in the first draft of this entry were wrong and are corrected
above.* It said "19 test figures" where the driver runs 18, and it credited the
legend detection to the data curves — which the instrument could not see at the
time, because it did not parse `<path>`. What actually tripped the check was
the gridlines and error bars. Both were caught by the adversarial pass and are
fixed below; the sampled set is 18 hand-picked builder outputs, not "every
figure in the product".

### Thermal

**ε-NTU, the rating problem.** The exchanger tool was **LMTD-only**, and LMTD
answers the *design* question — I know all four terminal temperatures, what area
do I need? The commoner question is the *rating* one: I have this exchanger and
these two inlets, what comes out? LMTD cannot answer it directly, because the
log mean it needs is built from the outlets you are trying to find. Closed form
per arrangement, with both removable singularities taken explicitly: **Cr = 1 is
0/0 whose limit is NTU/(1+NTU)** and is an entirely ordinary balanced design,
and **Cr → 0 is a phase change** — a boiling or condensing stream holds its
temperature, which is why a condenser's performance does not depend on whether
it is counterflow or parallel.

**Fins, including the result nobody expects: a fin can REDUCE heat transfer.**
It adds area, which helps, and adds a conduction path with its own resistance,
which does not. An effectiveness below 1 means the second effect wins and the
finned surface loses *less* heat than the bare one — which is why fins appear on
the air side of a radiator and never on the water side.

**Transient cooling, which REFUSES above Biot 0.1** rather than caveating. The
lumped model assumes no internal gradient, and above that the interior genuinely
lags the surface: a single exponential is the wrong *shape* of answer, not an
imprecise one, and a caveated wrong curve is still a wrong curve in somebody's
document.

**Radiation exchange and shields.** Temperature enters as the fourth power of an
**absolute** temperature, so Celsius is not a shifted scale here — using it is
wrong by orders of magnitude, and the conversion is stated. A radiation shield
**does not insulate**: it is thin, conducts well and touches nothing, and works
purely by adding surfaces that must each re-radiate. N equal shields cut the
exchange by N+1, which is why multilayer insulation is dozens of sheets of
metallised film rather than one thick blanket. Emissivity stays a measured
input.

**A defect caught by its own limit check.** The crossflow ε-NTU correlation has
two different exponents — 0.22 outside and 0.78 inside — and the first draft
used NTU^1.22 in the inner term. That does not reduce to 1 − exp(−NTU) as Cr
goes to zero, and gave 0.934 where every other arrangement gave 0.865. The
exponents sum to 1 precisely so the Cr terms cancel in that limit, which is what
made the error visible.

**The four new tools draw, and so does the LMTD exchanger:** its temperature
profile along the length, which is what makes the LMTD visible and shows a
counterflow gap staying roughly constant where a parallel one collapses; then
effectiveness against NTU for every arrangement with this exchanger marked,
temperature along the fin, the cooling curve against its ambient asymptote, and
radiation against convection as the surface heats.

*Corrected: the first draft of this entry said all five existing Thermal tools
now draw. Only the exchanger does. `wall`, `thermo-process`, `thermo-cycle` and
`thermo-vapour` are still text-only and are named in the audit's remaining list
every run.*

**Figure ratchet 16 → 21 of 118.**

### Ten defects, caught by the independent adversarial pass before release

Two were blockers, and one of them was in the new instrument itself.

1. **The fin figure emitted `NaN` into its SVG path.** `Math.cosh` overflows
   past an argument of about 710, so `cosh(m(Lc−x))/cosh(mLc)` became
   `Infinity/Infinity` for a long, thin, poorly conducting fin — **56 `NaN`
   tokens** in the path, with the numbers above it all correct so nothing
   hinted at it. And this tool actively *invites* bad fins, since a bad fin is
   the result it exists to demonstrate. Now evaluated as
   `e^(A−B)·(1+e^−2A)/(1+e^−2B)`, where every exponent is non-positive.
2. **"Radiation carries NaN% of the total"** appeared in a user-facing note
   whenever both surfaces were at the same temperature — 0/0, reachable by
   typing one temperature twice, because the tool's own default convection
   coefficient is non-zero.
3. **The layout instrument could not see `<path>`**, which is every data curve
   `buildPlotSvg` draws. It reported a *gridline* crossing a legend entry and
   missed the *curve* that entry names. A gate blind to the thing it was built
   for is worse than no gate, because it is believed. It now parses paths, and
   its self-test carries a path payload so it can catch that blind spot again.
4. **The margin calculation ignored error bars**, which the drawing code
   includes unconditionally. Pasting a third column into the Plot tab produced
   exactly the collision this release claims to have fixed.
5. **And it walked a different range than the drawing code** — no 6% padding,
   a different degenerate expansion — under-sizing **2.6%** of margins over
   20,000 random plots and pushing 36 labels off the canvas.
6. **The y-title reserve was 16 px for a title that reaches 18.3 px.** The two
   now share their constants so they cannot drift apart again.
7. **Axis labels read `-2.8e-17` where `0` belongs**, in about 2% of ranges
   straddling the origin — meaningless, and wide enough to cause (5).
8. **Fin effectiveness returned `NaN` for a base at ambient**, an ordinary
   input, and silently dropped all three effectiveness notes with it.
   Effectiveness is η·A_fin/A_c and does not depend on the driving temperature
   at all.
9. **The audit's own thresholds were too lax** — up to 2.2 characters of
   overlap went unreported, and the glyph-width estimate was 7% *under*, when a
   collision detector must over-estimate. Tightened; every figure still passes.
10. `lumpedCapacitance` could return an infinite time constant and a `NaN`
    energy at extreme magnitudes. It refuses now.

The sweep that found (5) and (7) is now a test: **400 random ranges and 300
zero-crossing ones, with no clipping, no collision and no spurious label.**

## [2.79.0] — 2026-08-02 — Structural & solids: every tool draws, and two hand-carries close

First release against `docs/ENGINEERING-DEEP-DIVE-2026-08-02.md`. **Every one of
the six Structural & solids calculators now inserts a figure**, and the two
worst composition gaps in the bench are closed.

**The minor axis was missing, and it is the axis that buckles.** The
cross-section tool computed the second moment about the bending axis only.
A column bends about whichever axis is *weakest*, and for an I-beam that is
emphatically not the one it was designed to bend about — the default section
here has an **Ix 12.6 times its Iy**. Quoting the bending I to a buckling check
overstates the critical load by that whole factor, and the answer looks
entirely reasonable. `Iy`, `ry` and `Imin` are now computed for all six shapes,
exactly: every strip decomposition is symmetric about the vertical centreline,
so the parallel-axis terms vanish and the sum is closed-form.

**`section` → `column`, the worst trap in the bench.** The column tool needs I
in m⁴ and A in m²; the section tool reports them in mm⁴ and mm², because that
is what every section table in the world prints. Pasting the bare number across
is wrong by **10¹²**. The unit contract only half closed it — `1e6 mm^4`
converts, a bare `1e6` is assumed to already be in m⁴. The column tool can now
compute the section itself, taking the **minor** axis automatically, which
removes the paste and the wrong-axis mistake in one move.

**`fatigue-endurance` → `fatigue-safety`, the half nobody had noticed.** The Kf
hazard on this pair was closed in v2.66.0; the deep dive found a **second**
hand-carry on the same pair that no sweep had flagged. `Se` — the entire output
of the endurance tool, six Marin factors multiplied together — was still typed
in by hand. Nobody re-derives that chain, so it gets pasted, and too *high* an
Se makes the part look safer than it is. It can now be computed in place.

**Mohr's circle.** The stress tool has always computed the circle's centre and
radius and named the construction in its own output without ever drawing the
most recognisable diagram in mechanics of materials. It draws it now, with both
principal stresses marked, the applied state and its conjugate joined through
the centre, and the radius shown as what it is — the maximum in-plane shear.

**The Goodman diagram.** The whole reason to show four mean-stress criteria is
that they *disagree*, and the disagreement is a picture: four loci and one
operating point. Modified Goodman, Soderberg, Gerber, the ASME ellipse and the
Langer yield line are drawn together at n = 1, with the load line from the
origin — because the factor of safety is measured **along** that line, not
vertically.

**And the rest of the discipline.** The cross-section drawn to scale with its
neutral axis and both extreme-fibre distances, which is where an unsymmetric
tee's two different section moduli come from. The Euler hyperbola and Johnson
parabola against slenderness with this column marked, which makes the reason
the parabola exists impossible to miss — Euler runs off to infinity as the
column gets stumpy. The truss in its own geometry with members coloured by
tension, compression and **zero force**, because a zero-force member looks
structurally essential on a sketch. And torsional shear against radius, linear
from zero at the axis, which is the entire argument for a hollow shaft.

**Both new chart families use an equal aspect ratio deliberately**, which is why
they do not go through `buildPlotSvg`: that plotter scales x and y
independently, and a Mohr's *circle* drawn as an ellipse is not a Mohr's circle.

**A figure ratchet.** The audit now counts how many tools insert a figure and
fails if the number drops. **16 of 114** today. The goal is all of them, and the
audit prints the remaining 98 by name each run.

**Ten defects, caught by the independent adversarial pass before release.** Two
would have frozen Word:

1. **`niceStep` had no postcondition and five tick loops trusted it.** It could
   return `Infinity` (from an infinite span) or exactly `0` (from a subnormal
   one, where `10^floor(log10 x)` underflows), and every caller was an open
   `for (t = lo; t <= hi; t += step)`. `t += Infinity` sticks; `t += 0` never
   advances. `analyzeColumn` returns `transition = Infinity` for a vanishing
   yield strength and the chart fed it straight into its axis limit — **4 GB of
   heap before the process died**. In a task pane that is a frozen Word, not an
   error. The helper now has a finite-positive postcondition, and every tick
   walk is a **bounded array** rather than an open loop, because
   `Number.isFinite` on the inputs is not a bound.
2. **Four of the six builders returned a blank white box** on a degenerate
   input — 118 bytes, no message — which inserts into the document as artwork
   and renders as nothing. **Zero torque is a perfectly legal input** that
   produced one. All six now say why they are empty.
3. **The column tool's section note quoted a number it had not converted:** it
   printed `Iy` while converting `Imin`, internally inconsistent by a factor of
   62 on a wide tee, in a note whose entire job is to show the conversion. The
   value handed to the engine was right throughout.
4. **The Goodman diagram contradicted its own factor of safety** for a
   compressive mean stress. The four fatigue criteria clamp a compressive mean
   to zero; the Langer yield line uses its *magnitude*. One marker served both,
   so a case the text reported as **failing** was plotted comfortably inside
   the yield line. The two families now get their own markers.
5. **"`Iy` is the minor axis" was false in four places.** It holds for a tall
   section and fails for any section wider than it is deep — a 200×50 plate on
   edge has `Iy` well *above* `I` — and the first draft told the user such a
   plate had **no weak axis at all**. Which axis is weaker is a fact about the
   dimensions, so `minorAxis` is now computed and reported by name.
6. **The Marin shortcut dropped every warning the endurance engine returns**,
   including *"this material has NO true endurance limit"* for a non-ferrous
   alloy. It printed an infinite-life factor of safety, for a material that has
   no infinite life, with no caveat.
7. The torsion figure's radius axis was passed metres and formatted to one
   decimal, so a 20 mm shaft's outer surface read **"0.0"** on an axis with no
   unit.
8. The material-class option value was `nonferrous` where the type is
   `non-ferrous` — harmless today only because the engine branches on `steel`,
   and hidden by a cast.
9. An em-dash error message in `section.ts` became reachable from a second tool.
10. The figure ratchet would have counted a blank white box as a figure. Fixed
    at the source by (2), and pinned by a test asserting every degenerate output
    carries text.

**Two defects fixed on the way, both found by the new work rather than shipped.**
A non-finite operating stress put `NaN` into three coordinate attributes of the
Goodman SVG — artwork that goes into a document and renders as nothing; every
coordinate is now checked. And a figure's **caption** was not passing through
`plainDashes`, so a single em dash in a caption disabled Insert for a tool whose
numbers were all fine. Captions and alt text are now cleaned like every other
line, which matters more with ~100 figures still to come than it did with ten.

## [2.78.0] — 2026-08-02 — Tier 1 closed

The last six items of the 2026-08-01 gap analysis, shipped together. **Tier 1 is
now complete.** Dead-export ratchet **17 → 10**.

**Two composition handoffs, removing a transcription step each.** The product
was telling users to read a number off one calculator and type it into the next,
which is where a digit goes missing. **`chips-thermal`** can now compute its
dissipated power from the switching parameters (C, V, f, activity, leakage) via
the same `switchingPower` engine the power tool uses, instead of having the
answer re-typed. **`pump-npsh`** can take its density from the shipped water
table and its **suction-line loss from the pipe engine** — diameter, length,
flow, roughness and fitting K in, Colebrook friction factor and head loss out —
rather than requiring a separate run of the pipe tool and a hand-carry. Both
copy the remedy the fatigue Kf field already shipped: put the upstream quantity
where the downstream tool can produce it.

**Vapour pressure is still yours, and now says why.** It is the one number on the
NPSH panel the product will not fill in. Density and viscosity come from a table
that ships with a source; a saturation-pressure correlation would have to be
reconstructed from memory, which is exactly the class of unverifiable constant
this product refuses — the same reason no steam tables are built in. It matters
more than the others, too, because NPSH available collapses as the liquid warms
almost entirely through that term.

**The reverse leg of the electrothermal loop is stated, not modelled.** Leakage
is exponential in temperature, so a junction running far above wherever the
leakage was measured draws more than was entered, which heats it further.
Predicting that needs a process model this product deliberately does not have,
so the feedback is named rather than guessed at.

**Every beam report now carries an equilibrium check.** The reactions must carry
exactly the applied load — that is an identity, not an approximation. The check
sums the **parsed loads**, independently of the solved system, so a load line the
parser could not read shows up as a residual instead of silently vanishing from
a report that otherwise looks complete. Applied couples contribute no vertical
force, which is why they are absent from the total.

**The FFT filter's edge can now be DESIGNED rather than chosen.** The raised
cosine was smooth — so it did not ring — but it was an ad-hoc shape: you could
not say what attenuation it achieved anywhere. Picking **Butterworth** or
**Chebyshev** hands the specification to `filter.ts`, which computes the minimum
order from your transition width and stopband target, and the magnitude response
of that design is applied bin by bin. The order and the attenuation **actually
achieved** are reported. Chebyshev reaches the same specification at a lower
order and pays for it in passband ripple, which is the entire reason both
families exist. **The raised cosine remains the default, so no result anyone has
already produced changes.** A zero transition band cannot be designed to — that
is the brick wall — and the tool falls back and says the filter is not the one
you asked for.

**The 3-D transform toolkit is reachable at last.** `mat3Apply`, `mat3Mul`,
`scaleMatrix`, `reflectionMatrix`, `rotationMatrix` and `transformEffect` were
complete, tested, and uninvokable — an import edge from `geometryParse.ts` kept
the module-orphan check happy while every function in it stayed unreachable,
which is precisely the trap a module-level check cannot catch. Solve's geometry
input now takes `rotate 90 z then scale 2 (1,0,0)`, composing operations left to
right and **saying that order matters**. The determinant is reported as the
volume scale factor, a **negative** one is named as flipping orientation — a
reflection preserves every length and angle yet no rotation can reproduce it —
and a **zero** one is named as collapsing space rather than returned as an
ordinary answer. Rotation entries are cosines, so those results are shown as
decimals: the rational layer exists so rotations *compose* with the exact
transforms, not so cos 90° gets printed as a sixty-digit fraction.

**Indefinite integrals.** Leaving both limit boxes blank in Solve's integral mode
returns F(x) + C. The engine already computed F on the way to every definite
answer and discarded it after subtracting; this is the entry point that hands it
back. **The check is shown, not claimed:** the answer is differentiated again and
the derivative printed beside it, with the status stated — `symbolic` when the
CAS proved d/dx F − f identically zero, `numeric` when a rule-table answer agreed
with the integrand at every sampled point. The distinction is reported rather
than flattened because the printed derivative often does not *look* like the
integrand even when it equals it: d/dx ln|x| simplifies to x/|x|², which is 1/x
for every real x ≠ 0 and does not resemble it on the page. No closed form is
reported as such rather than as a failure — exp(−x²) and sin(x)/x genuinely have
none.

**A fourth claim from the original sweeps was wrong.** The gap analysis listed
`regression.ts probit` as dead. It is not: `qqPoints` calls it, and the pane
calls `qqPoints` to draw the Q-Q diagnostic plot for every regression. Nothing
to surface and nothing to delete — the entry was mistaken, and the document now
says so rather than quietly dropping it.

**Ten defects, caught by the independent adversarial pass before release.** The
61-check suite was green when it ran. What it found, all fixed and all now
pinned as tests:

1. **`antiderivative` printed `NaN` and would have inserted it into a document.**
   `sqrt(-1)`, `ln(-1)`, `asin(2)` and `1/0` are constants that evaluate to NaN
   or Infinity, and the constant rule ∫c dx = c·x accepted them, producing
   `NaN*x + C`. `NaN` is not the em-dash the insert guard scans for, so nothing
   blocked it. The **definite** branch of the same module already refuses these
   by name — the new one was more permissive than its own sibling.
2. **The designed band-stop was structurally broken and ~20 dB *worse* than the
   ad-hoc ramp it replaced.** Built as `1 − |HP|·|LP|`, its notch depth is
   bounded by the *passband ripple*, not by the requested attenuation: at 1 dB
   of ripple it can never beat about −19 dB however much is asked for. Measured,
   it delivered 40 dB across 1% of the band where the cosine managed 83%. It is
   now the two sections **in parallel**, `LP(lo) + HP(hi)`, where each section's
   own stopband attenuation governs the notch — 56 dB at mid-band where the
   complement gave 18.
3. **A stopband edge at or below zero was clamped to 1e−9 and its attenuation
   quoted anyway.** A high-pass at 2 Hz with a 10 Hz transition implies a
   stopband edge at −8 Hz; the clamp reported "order 1, 191 dB" for a filter
   passing 14% of the amplitude at 0.5 Hz. Two unrelated specifications both
   reported 195 dB — the number was a function of the clamp, not the design.
   Refused now.
4. **`verified: "symbolic"` claimed a proof that was never performed.**
   `symbolicIntegrate` accepts a candidate either by canonical proof *or* by
   eight float samples when the simplifier cannot settle it, and set
   `verified: true` on both paths — making the flag a constant and its own doc
   comment false. `tan(x)`, `tanh(x)` and `sqrt(x)` were all reported as "proved
   identically zero" on the strength of samples. Fixed at the source in
   `casint.ts`; the `numeric` tier, which nothing could previously report, is
   now reachable and lands on exactly those cases.
5. **The 3-D transform parser silently substituted different transformations.**
   An axis it could not read became `z` (so `rotate about x 90` rotated about
   z), `1e3` was read as 1, `1/2` as 1, a two-factor scale quietly dropped one,
   a plane written after the point was discarded, and a comma between operations
   dropped the second. Every one of those now either parses correctly or
   **refuses by name**.
6. **`volume scale factor = -1  ≈ 1`** — one row carried `|det|` as its value and
   the *signed* determinant as its exact string, and the renderer prints both
   when they differ. A volume scale factor is non-negative by definition; the
   determinant now has its own row and keeps the sign.
7. **"genuinely have none" was false for most refusals.** Of the integrands the
   engine returns nothing for, the majority — `sin(x)²`, `sec(x)`,
   `exp(x)·cos(x)` among them — have standard answers a first-year student
   produces by hand. Telling a student that sin(x)² has no antiderivative blames
   mathematics for an engine gap. The message now distinguishes what is provably
   impossible from what this integrator merely could not find, and claims
   neither when it cannot tell.
8. **The typed cutoff meant different things for a low-pass and a high-pass** —
   `t` past the edge for one, `t/2` either side for the other — so a designed
   high-pass was 12 dB down at its own stated cutoff. One convention now.
9. **A cascaded Chebyshev delivered double its ripple budget**, because two 1 dB
   sections in series give 2 dB. Each section is designed to half.
10. **The beam equilibrium check hard-coded "down" and "up"**, printing
    "-30 kN down" for a legal upward load.

**The real-bundle audit now drives every non-default dropdown option, and found
a bug on its first run.** Three of the changes above are new select options, and
the audit only ever exercised each tool on its *defaults* — so a dropdown was
only tested at whichever choice it opened on. That is a real hole, because a
select is precisely how this bench offers an alternative *model*, and every other
option is a code path nothing else in the audit entered. The sweep drives all 137
non-default options in the production bundle, one at a time. It immediately
flagged a pre-existing defect it was not written for: the cross-section tool's
"circular hollow" refusal used an **em dash**, which is the pane's non-finite
sentinel and therefore **disables Insert for the whole result**. Reworded.


## [2.77.1] — 2026-08-02 — The wind triangle's second solution

**A doctrine violation shipped in v2.77.0, found on review and fixed.** The
adversarial pass had flagged it and explicitly declined to call it a defect,
because the number returned was correct. It is a defect: the product's stated
rule is that when two solutions exist, **both** are returned rather than one
chosen silently — `aimForRange` does exactly this in the same release, and its
doc comment cites the 2R arm's inverse-kinematics branches as the precedent.

`windTriangle` kept only the arcsine root. The other, π − wca, is usually
spurious — it makes good the **reciprocal** track and shows up as a negative
ground speed, which is the test that rejects it. But when the wind exceeds the
airspeed with a component along the track, **both roots give a positive ground
speed and both genuinely close the vector triangle**. Track 090 at 50 m/s with
80 m/s from 240 can be flown on **143.1° at 99.3 m/s** or on **216.9° at
39.3 m/s** — the second pointing backwards relative to the air while the wind
carries you along the track. Real for a balloon or a very slow aircraft.

Both are now returned, fastest first, with a note. Verified by an independent
check that flies each heading, adds the wind vector, and confirms the resulting
ground track closes on the requested one to twelve figures — and that ordinary
conditions still yield exactly one.

## [2.77.0] — 2026-08-02 — Trajectory & orbits

A **nineteenth** Engineering discipline, and the whole suite scoped in
`docs/SCOPE-TRAJECTORY.md` delivered in one release rather than three.
Engineering is now **114 calculators across 19 disciplines**.

**Ballistic (4).** Projectile motion in a vacuum, where **45° is optimal only
when the launch and landing heights match** — throw from 10 m at 20 m/s and the
best angle is **39.3°**, because the drop buys flight time for free and trading
elevation for horizontal speed pays. The familiar 45° is the special case of
h = 0, and the tool reports the optimum for *your* height beside the shot you
asked for. The same shot **with air drag**, integrated numerically through
`ode.ts` with a terminal event on ground contact and ISA density from `aero.ts`,
which shows that **drag is not a correction but the dominant term**: the default
bullet-like case flies **2970 m** against a vacuum range of **56518 m**, or
5.3%. The inverse aiming problem returns **both** the flat and the lofted angle
(23.67° and 66.33° for 30 m at 20 m/s, summing to 90°) and **REFUSES** a target
beyond maximum range rather than clamping to 45° — the same doctrine as the 2R
arm returning both IK branches. And impact speed, energy and momentum, where
**the energy saturates**: a 4.5 g hailstone reaches terminal speed, so falling
5000 m delivers the same **1.099 J** as falling 1000 m while the vacuum answer
climbs from 140 m/s to 313 m/s.

**Orbital (5).** Circular orbits, where **a lower orbit is a faster one**;
elliptical orbits by vis-viva, where **the period depends only on the semi-major
axis** and not at all on eccentricity; the **Hohmann transfer**, which carries
the best result in the subject — **to catch something ahead of you in the same
orbit you must slow down**, because firing forwards raises your orbit and
lengthens your period; the Tsiolkovsky rocket equation, where Δv is
**exponential** in mass ratio so the last increment costs by far the most, which
is why staging exists rather than one bigger tank; and escape speed, which is
**independent of direction** and exactly √2 times circular, so leaving from
orbit costs 41% more rather than twice as much.

**The gravitational parameters came in the way the data doctrine requires.** μ
and the body radii for Earth, the Moon, Mars, the Sun and Jupiter were
script-extracted from the poliastro constants module (IAU 2009) — the same
treatment `flame.ts` gave the NASA-7 polynomials and `colourspace.ts` gave the
chromaticity primaries — and validated by a committed cross-check against facts
known **independently** of that file. The strongest of those: **μ_Earth
reproduces the sidereal day at geostationary altitude**, 86164.0 s from a
published 35786 km, which a transcription slip could not survive. Also checked:
surface gravity 9.80 m/s², the ISS period at 92.6 min, escape at 11.18 km/s, and
the Moon at about a sixth of Earth's gravity.

**Profiles & navigation (4).** Jerk-limited **S-curve profiles**, which are
**slower on purpose** — 2.450 s against a trapezoidal 2.250 s — because a
trapezoidal profile steps acceleration instantaneously, and infinite jerk is a
broadband impulse that excites every structural mode the machine has. Multi-axis
coordination, where **throttling the fast axes costs nothing** in cycle time (the
slowest axis sets it regardless) and is what makes the path straight instead of a
dog-leg. Great-circle distance and bearing, where **the initial bearing is not
the final bearing** — Heathrow to JFK departs on 287.9° and arrives on 231.3°.
And the wind triangle, which closes a named gap from the aviation build and
**refuses** when no heading makes the track good rather than returning an angle
that cannot fly.

**Drag coefficients remain user inputs**, deliberately: Cd depends on shape, Mach
number and Reynolds number, and a built-in table would be wrong for every
projectile except the one it was measured on. Also not built, and said so in the
scope: 6-DOF simulation, guidance laws, N-body perturbations and re-entry
heating.

**Seven defects, and the author's own suite found none of them.** The 59-check
oracle suite was green when an **independent** adversarial pass was run over the
diff — the standing rule, and the reason it exists. What it found, all fixed and
all now pinned as tests in `trajectory.adversarial.test.ts`:

1. **`dragShot` returned a mid-air position labelled as ground impact.** The
   integration horizon was a multiple of the vacuum flight time, on the stated
   assumption that the vacuum time is an upper bound once drag is on. **It is
   not.** Drag shortens the ascent but *lengthens* the descent, because the fall
   settles towards terminal speed instead of accelerating without limit — a
   ping-pong ball off a 1000 m cliff takes **118 s** against a vacuum 14 s. The
   tool reported 43.8 s with the ball **627 m in the air**, and `solveOde`
   returned `completed: true` while doing it, so a solver-success check would
   never have caught it. The horizon now grows until the ground event actually
   fires, and if it never does the tool refuses rather than reporting where the
   projectile happened to be.
2. **`dragShot` returned `NaN` and a fully subterranean path** for a level or
   downward launch from ground level: the ground event needs a strict sign
   change, so starting at y = 0 it never fired. A `NaN` reaches the pane as an
   em-dash, and the em-dash blocks insertion. Now refused by name.
3. **The apex was 15–40% low.** It was the maximum over the solver's samples,
   and RK45 integrates a near-ballistic arc so accurately that it takes only a
   handful of enormous steps — none near the vertex. A shot put's apex read
   3.48 m against a true 4.11 m. The apex is now a second, non-terminal event
   on the vertical velocity, bisected to solver tolerance.
4. **Above the ISA ceiling, drag was silently zero.** `atmosphere` returns null
   above 84,852 m and that was read as vacuum, so a high shot integrated 94 km
   of flight with no air while the notes claimed standard-atmosphere density.
   Now refused, which is what the aviation bench does at the same altitude.
5. **The Hohmann phase angle was never wrapped**, so a descending transfer
   reported **−1078.75°** for GEO to LEO. The field is documented as a lead
   angle; it now lands in (−180, 180] and reads +1.25°. Ascending transfers
   were correct throughout, which is why it went unnoticed.
6. **`multiAxisMove` asserted a dog-leg its own numbers disproved** when every
   axis already finished together, and emitted zero limits for a zero-distance
   axis — a plan this same function then refused as input.
7. **Overflow with finite, legal inputs.** A launch speed of 1e155, an orbital
   radius past 5.6e102, a mass ratio of 1e600: each returned `ok: true` with an
   Infinity or a NaN in a numeric field. All now refuse.

**And one the author's own pass did catch first.** `impactEnergy` computed fall
time by inverting v = v_t·tanh(gt/v_t) — exact on paper, useless in floating
point: past a few hundred metres v/v_t rounds to exactly 1.0 and the time
**saturated at 39.7 s for any drop height**, 5.7× below the physical floor of
h/v_t. Fixing it introduced a mirror failure at the *other* end, which the
adversarial pass then found: as x → 0 the `arccosh(e^x)` form loses all its
precision and eventually returned a flat **zero** for a fall that plainly takes
time. All three regimes are now explicit — asymptote when deep, series when
shallow, closed form between — and `fallTime ≥ h/v_t` is pinned as an invariant
across fourteen orders of magnitude of drag.

`ode.ts`, `aero.ts`, `fluids.G` and `solve.ts` are reused rather than
reimplemented, so the trajectory bench and the aviation bench cannot disagree
about gravity or the air.

## [2.76.0] — 2026-08-02 — Colour gamut coverage, on fetched primaries

Closes the one item the audio/video scope deliberately left open. Engineering
is now **101 calculators across 18 disciplines**.

**The data came in the way the scope required.** The chromaticity primaries for
sRGB, Rec.709, DCI-P3 and Rec.2020 were fetched from the colour-science
project's dataset modules — which cite IEC 61966-2-1 and ITU-R BT.709-6 /
BT.2020 — extracted by a script, and validated by a committed cross-check
against facts known independently of that file. The strongest of those: **sRGB
and Rec.709 came back with identical primaries**, which is true by construction
of the sRGB standard and would break instantly on a transcription slip. Also
checked: every primary is a physically possible chromaticity, Rec.2020's red
sits on the spectral locus as its monochromatic definition requires, and the
size ordering is Rec.2020 > DCI-P3 > sRGB.

**COVERAGE and AREA RATIO are reported separately**, because conflating them is
the standard marketing move. DCI-P3 is **126% of sRGB by area** and covers
**exactly 100%** of it — it encloses sRGB entirely, so the extra area is in
colours sRGB never had. Quoting the ratio as "coverage" would claim 126% of a
space it merely contains. Coverage is computed as a real polygon intersection
(Sutherland-Hodgman), not an area comparison.

**Two claims I wrote were disproved by the data and corrected in the code, not
just the tests.** I had asserted that DCI-P3 fails to cover parts of sRGB — it
does not, it contains it — and that CIE u'v' always gives the smaller figure
than xy. The second is simply false: sRGB covers 52.9% of Rec.2020 in xy and
58.0% in u'v'. The direction depends on where the gamuts differ. What holds is
that the two metrics disagree materially, which is why both are shown and u'v'
is the one to quote. Both corrections are recorded in the module.

## [2.75.0] — 2026-08-02 — Video & display

Third step of the audio/video bench: an **eighteenth Engineering discipline**,
6 calculators, taking the bench to **100**.

Bitrate budgets, resolution and viewing geometry, HDR luminance, PSNR, streaming
buffers, and end-to-end latency. As with audio, each is written around the thing
people get wrong:

- **4:2:0 is a 50% reduction, not 25%.** It halves chroma resolution both
  horizontally AND vertically, so the two chroma planes together carry a quarter
  of their full-resolution samples: 1 + 0.25 + 0.25 against 3. Pinned by a test.
- **The eye is the limit, not the panel.** Past a certain distance the pixel
  grid is unresolvable at normal acuity, and a finer display changes nothing
  that can be seen.
- **Contrast is a claim about BLACK.** Black level varies by orders of magnitude
  between panel technologies while peak brightness varies by a factor of a few,
  so a headline contrast figure is really a statement about the black end.
- **PSNR is comparable only within one clip.** Squared pixel error is not what
  an eye responds to; comparing across content is the standard misuse.
- **Startup delay uses the SURPLUS bandwidth**, since playback drains the buffer
  at the stream rate while it fills. And a buffer trades latency for robustness
  one-for-one, which is exactly why live content breaks on a dropout that
  recorded content rides out.
- **The display quantises the latency total.** A frame appears only at a refresh
  boundary, so shaving 5 ms off the encoder can deliver exactly nothing — there
  is a test asserting precisely that.

**On the PQ curve and its constants.** ST 2084's coefficients are written as the
exact rationals the standard defines them by (2610/16384 and the rest) rather
than as decimals, because they are definitional rather than measured — the
fractions ARE the specification. They are verified by a PROPERTY rather than by
comparing digits: PQ(1) must return exactly the 10000 nit peak the curve is
defined against, and PQ(0) must return 0. Wrong constants fail that instantly.

**Colour-gamut coverage is deliberately NOT in this release.** It needs the
chromaticity primaries of sRGB / Rec.709 / Rec.2020 / DCI-P3, and per the scope
those must be fetched from a citable source and cross-checked in a committed
test before they ship — the treatment the NASA polynomials in flame.ts got.
Typing them from recollection is the one thing that file must not do, so the
calculator waits rather than shipping on remembered numbers.

## [2.74.0] — 2026-08-02 — Audio & acoustics

Second step of the audio/video bench: a **seventeenth Engineering discipline**,
7 calculators, taking the bench to 94.

Sampling and aliasing, quantisation and dynamic range, decibels, sound level
with distance and summing, reverberation, room modes, and comb filtering. Each
is written around the result people get wrong rather than around the formula:

- **Decibels show BOTH readings, always.** 10·log₁₀ for power-like quantities
  and 20·log₁₀ for field-like ones is not a convention to memorise — power goes
  as the square of a field — and picking wrong doubles or halves every figure
  downstream while looking entirely plausible. A tool that silently chooses one
  cannot tell you it chose wrong, so the other reading sits beside it.
- **Two identical sources are +3 dB, not +6.** Incoherent sources add in power;
  the +6 figure is coherent addition. Ten machines are +10 dB, not +60.
- **Sabine and Eyring are shown together.** Sabine's formula never reaches zero
  however absorbent the surfaces are — set every surface to a perfect absorber
  and it still returns a finite reverberation time, which is impossible. Eyring
  fixes exactly that, they agree only below about ᾱ = 0.2, and the divergence is
  reported rather than hidden behind a choice made for the user.
- **Quantisation SNR keeps its 1.76 dB.** 6.02n alone understates every
  converter; the 1.76 comes from a full-scale sine against uniform quantisation
  error. And the whole figure assumes a full-scale signal, which is why 24-bit
  is for tracking rather than delivery.
- **Comb filtering cannot be equalised away.** A 1 ms delay notches at 500 Hz
  and every odd multiple; the cause is arrival time, so the cure is moving
  something, not EQ.

**The sampling tool calls the engine Biomedical already had.** `samplingCheck`
was general all along — nothing about it is biomedical — so audio reaches the
same implementation rather than forking it. One engine, two doors.

No absorption-coefficient table, no Thiele-Small library, no psychoacoustic
masking model: the first two are measured properties belonging on the datasheet
the user is reading, and the third is a fitted dataset rather than a formula.

## [2.73.0] — 2026-08-02 — Photometric units, and the ones that must not convert

First step of the audio/video bench (`docs/SCOPE-AUDIO-VIDEO.md`): units before
calculators, because a missing unit in a default value produces no output, no
error and no test failure — the trap that has caught this project four times.

Adds **luminous intensity, the 7th SI base unit**, and its derived quantities:
`cd` (with mcd/kcd), `lm`, `lx`, and `nit`. HDR brightness is quoted in nits
universally, so the display calculators depend on this landing first.
`nit ≡ cd/m²` and `lx ≡ lm/m²` both convert, as they should.

**The design decision worth recording is which conversions are REFUSED.**

- **lumen ↔ watt** — related by the wavelength-dependent luminosity function,
  not a constant: 1 W at 555 nm is 683 lm, deep red a small fraction of that.
- **candela ↔ lumen** — needs the solid angle the source emits into. A torch and
  a bare lamp of equal candela differ enormously in lumens.
- **luminance ↔ illuminance** (nit ↔ lx) — opposite ends of the light path.

In strict SI a lumen is a candela-steradian and the steradian is dimensionless,
so these could have been made to share a signature and convert one-for-one. That
would return a confident number to a question the units alone cannot answer,
which is the failure this codebase refuses everywhere else. Luminous intensity
and luminous flux are therefore kept as separate atomic dimensions — the same
reasoning that keeps `angle` atomic so a radian cannot silently become a bare
number.

Also adds **`fps`**, which converts with Hz so a 60 fps source can be checked
against a 60 Hz panel. This deliberately accepts a collision: an aviation reader
might expect feet per second. That stays available and unambiguous as `ft/s`,
the codebase already writes climb rates as `fpm`, and in video "fps" is
universal — so the video reading wins and the decision is written down.

## [2.72.0] — 2026-08-02 — HMBC and TOCSY

The last two 2D experiments, and the end of the tier-1 list from the gap
analysis.

**HMBC** correlates protons to carbons two and three bonds away, which is why
it is the most useful of the four: HSQC can only see a carbon that carries a
proton, while HMBC reaches the ones that do not — quaternary carbons, carbonyls,
the ipso carbon of a substituted ring. Those are exactly the atoms an additivity
model places least well and a chemist most needs in order to connect a structure
across a heteroatom. Methyl acetate now shows both methyls correlating to a
carbonyl that has no HSQC peak at all.

Two-bond correlations are drawn faint on purpose: a real HMBC is optimised for a
long-range coupling near 8 Hz, which favours the three-bond ones, and a two-bond
peak is often absent altogether. Correlation intensity is not predicted, and the
result says so.

**TOCSY** shows the transitive closure of the coupling graph rather than one
step of it, so a contiguous coupled fragment appears as a block instead of a
chain of hops. Propan-1-ol resolves as one three-proton spin system with the OH
separate; methyl acetate as two isolated methyls. The spin systems are exact —
they are a property of the bond graph — while the shifts positioning them are
estimates, and relayed correlations are marked weak because their intensity
depends on the mixing time.

Spectra now offers eight predictions.

**Correction to this entry as first written:** it claimed tier 1 was complete.
It is not. Five small items remain and are listed in the gap analysis — the
chips and pipe composition handoffs, `totalLoad`, the `filter.ts -> fftFilter`
ringing fix, the geometry3d transforms, and an indefinite-integral entry
point. A changelog that rounds up is the same defect class as a landing page
that overstates a count.

## [2.71.0] — 2026-08-02 — Import a sequence file into the ST.26 listing

Tier 1 release G: the sequence workflow.

**Import FASTA / GenBank.** `parseSequenceFile` has read both formats, with
tests, since the Sequence Map work — and was reachable from that one mode. So an
attorney preparing an ST.26 listing for a biotech application carrying forty
sequences was pasting them into cards one at a time, while the reader that could
have loaded the whole file sat one import away. Multiple files at once; every
record becomes its own card, because ST.26 lists sequences individually and a
multi-record file is the normal case.

Molecule type is guessed from the residues and shown in the dropdown for you to
correct: RNA when there is a U and no T, protein when letters fall outside the
nucleotide alphabet, DNA otherwise. A short peptide spelled only in GATC letters
is genuinely ambiguous — "CAT" is a valid tripeptide and a valid codon — so it
reads as DNA and the guess is visible rather than silent. GenBank's organism is
carried across from the source feature.

The blank starter card is removed after an import, but **only if it is still
blank** — never anything typed.

**SEQ ID references take a list or a range.** `formatSeqIdRefs` was written to
collapse 1, 2, 3, 7 into a single citation and had no caller, so a specification
citing a run of sequences inserted them one at a time. The field now accepts
`1-3`, `1, 2, 5` or a plain number.

One more dead export paid off; the ratchet drops to 17.

## [2.70.0] — 2026-08-02 — DEPT, and the sp3 substituents that vanished

Tier 1 release F, chemistry half.

**DEPT.** Every ¹³C signal now carries its class — C, CH, CH₂ or CH₃ — and the
result spells out what DEPT-135 and DEPT-90 would show for the classes actually
present. The distinction that makes it worth having: this classification is
**exact**, read straight off the structure's own hydrogen count, while the shift
printed beside it is an estimate with a stated error. DEPT is precisely the
experiment that resolves the assignments an additivity model is least sure of,
and the information was already in the graph.

Stated rather than assumed: a peak in the decoupled spectrum with nothing at its
shift in DEPT is the diagnostic for a **quaternary** carbon, not a missing signal.

**The sp3 path now names substituents it ignored.** A group with no tabulated
increment contributes ZERO, so the shift comes out as if it were not attached at
all. `aromaticCaveats` had named that case on a ring since it was written; the
sp3 path stayed silent about the identical failure. It now reports which
attachment was ignored and that the carbon's value is unreliable — the same
class of fix as the ¹⁹F/³¹P caveat in v2.64.0.

Caught during this work: `deptBehaviour` was initially used only by its tests
while the pane restated the phases in its own words. Two copies of one fact,
one of them dead. The reachability ratchet failed the build, the pane now
derives its text from the helper, and the ratchet holds at 18.

## [2.69.1] — 2026-08-02 — The empty plot box in Bio/Assay

Reported from real use: Bio/Assay showed a plot box with nothing in it.

`.structure-preview` carries a 120px min-height, a border and a fixed white
paper background — it previews black-on-white artwork, so it deliberately does
not follow the theme. An empty one is therefore not invisible; it is a framed
blank panel. **Eleven of the sixteen Bio/Assay calculators never return a plot**
(Cheng-Prusoff, Beer-Lambert, dilutions, A260/A280, buffer ratio and the rest),
and the code cleared the panel's contents without ever hiding the panel. So most
of the mode rendered an empty white frame under its numbers.

The panel is now hidden whenever there is nothing to draw, on both paths — the
no-plot branch and the incomplete-form branch — and the "Insert plot" button is
hidden with it rather than sitting there permanently disabled.

Pre-existing, not from the recent tier-1 work. Found by reading the render path
after the report rather than by any gate: no automated check can see that a
correctly-cleared element is still a visible box.

## [2.69.0] — 2026-08-02 — The engine had no door

Tier 1 release E: **fit any model you can type**, plus the last of the wiring.

A real Levenberg-Marquardt engine with analytic covariance has shipped since the
assay work, reachable only through five hard-coded biochemistry models. So an
exponential decay, a logistic curve, a power law or a Gaussian peak had nothing,
and that is the most-used numerical verb after "plot". Nothing here improves the
engine; it opens it. Type a model in x with named parameters, get values with
standard errors, R², RMSE and the fit drawn over your data.

The honesty is in the starting values, which are the hard part of nonlinear
fitting: a converged fit from a poor start is the classic silently-wrong result.
Supply them and it says so; leave them blank and every parameter starts at 1 and
the result says THAT, with the reason a poor fit is usually a starting-value
problem rather than a wrong model. It also flags any parameter whose standard
error exceeds its own value (that parameter is not determined by your data), and
always states that R² on a nonlinear fit is descriptive only.

**Three dead exports surfaced.** The four **Bell states** are now presets in the
two-qubit tool, which previously required typing four complex amplitudes by hand
to reach the states everyone actually wants. `rayleighDamping` is now CALLED by
the modal code that had been repeating its formula inline — two statements of one
equation, one of them dead, which is how they drift apart. And with the finance
and assay work from v2.66.0, the dead-export ratchet drops from 27 to **18**; a
ratchet is only worth having if it is tightened when the debt is actually paid.

Analyze goes 22 to 23.

## [2.68.1] — 2026-08-02 — The em-dash sentinel, one layer out

PCA and the trapezoid tool shipped with em dashes in their note and error
strings, which would have disabled "Insert result" for both — the guard is a
whole-text scan, and an em dash is also the sentinel a non-finite value prints.

The reason it got through is worth recording: the gate that catches this
(`analyzeCalcText.test.ts`) scans the REGISTRY SOURCE in taskpane.ts, and these
notes are built in `pca.ts`. A library module's prose is invisible to it. Both
tools now run library notes and errors through `plainDashes` at the point the
result text is assembled, and a test pins that they do.

Caught by checking the deployed bundle rather than by any gate.

## [2.68.0] — 2026-08-02 — PCA, and integrating data you measured

Tier 1 release D. Both additions are thin layers over engines that already
shipped and were reachable only from one place.

**Principal component analysis**, built on the SVD of the centred data rather
than an eigen-decomposition of the covariance matrix. That is the same choice
regression makes in using QR: forming XᵀX squares the condition number and
destroys precisely the small components a scree plot exists to judge. Reports
variance and cumulative variance per component, how many components reach 95%,
loadings, scores, and a scree plot drawn by the real plot engine. Standardising
is offered as an explicit choice rather than a hidden default, because on raw
covariance a variable measured in millimetres dominates the same quantity in
metres purely through its units — and the result says which basis ran. Three
things it always states: component signs are arbitrary, PCA finds variance and
not importance, and loadings are unstable when observations are scarce.

**Trapezoidal integration of measured data** — the counterpart to Solve's
adaptive Simpson, which needs an expression you can evaluate anywhere. The
trapezoid rule existed only inside the pharmacokinetics module as a private AUC
helper, so anyone integrating a chromatogram, a power trace or a stress-strain
curve had nothing. x need not be evenly spaced; a decreasing x yields a negative
area, which is the correct signed integral and is reported rather than silently
flipped; and the result flags non-monotonic x and very uneven spacing. Both the
data and the running integral are plotted.

Analyze goes 20 to 22 calculators. Both new fields carry the v2.65.0 data-source
buttons, so a measured trace can come straight from a Word table or a CSV.

## [2.67.0] — 2026-08-01 — Every spectrum had leakage in it

Tier 1 release C (first part): **FFT windowing.**

`spectrum()` zero-padded and applied no window at all, so every spectrum this
product has ever drawn carried leakage. The cause is always present rather than
an edge case: an FFT assumes the record repeats forever, and unless the signal
holds a whole number of cycles the wrap-around leaves a discontinuity whose
energy smears one real tone across every bin. The skirts look like structure.

Hann is now the default, with Hamming, Blackman and an explicit "none" offered.
Amplitudes are corrected for the window's coherent gain, so a sinusoid of
amplitude A still reads A, and an off-bin tone actually reads MORE accurately
than it did before (scalloping loss falls). The result states which window ran
and what it trades.

**Two defects the change exposed, both fixed here.** A window widens the main
lobe, so `dominantFrequencies` — which took the top N *bins* — began reporting
one tone twice from adjacent bins and dropping the second tone off the list. It
now picks local maxima and excludes anything inside the main lobe of a peak
already taken: peaks, not bins. And a windowed CONSTANT signal is no longer
constant (it becomes the shape of the window), which made a flat input report a
confident dominant frequency where the old code correctly reported none; the
mean is now removed before peak-finding, which is standard practice anyway and
also stops a large DC offset drowning a real tone.

The em-dash sentinel bit once more during this work: prose punctuation in the
new note and in a dropdown label would have silently disabled "Insert result"
for the whole tool. Caught by the gate that exists for it.

## [2.66.0] — 2026-08-01 — Wiring what was already built

Tier 1 release B: capability that existed in tested code with no way to reach
it, and the one cross-tool gap that was a correctness hazard rather than a
convenience.

**The fatigue notch factor is applied instead of delegated.** The mean-stress
tool's σa field said "already multiplied by Kf" — the product computing a factor
in one calculator and requiring you to apply it by hand before typing it into
the next. Forgetting it is NON-CONSERVATIVE: the part reads safer than it is,
the one direction a safety factor must never err in. Kf is now a field, applied
internally, with the result stating that mean-stress concentration (Kfm) is
taken as 1 and why.

**Substrate inhibition can now be fitted.** `substrateInhibitionV` shipped and
was tested with no fitter and no caller, so an enzyme inhibited by its own
substrate had only Michaelis-Menten — which does not fail on such data, it
converges on a depressed Vmax and a distorted Km. On the reference curve now in
the tests, true Vmax 100 comes back from MM as 51.6 with R² 0.60. The new fit
recovers all three parameters exactly and reports the PEAK velocity and the
substrate concentration producing it, since Vmax here is an asymptote the enzyme
never attains.

**Five finance calculators that existed only as functions.** Straight-line
depreciation — the more common method, absent while declining balance shipped —
plus level annuities (PV and FV), level and growing perpetuities, rate
conversions across nominal/effective/continuous, and CAGR. Finance goes 19 to
24; Bio/Assay 15 to 16.

## [2.65.0] — 2026-08-01 — Your document is a data source

Tier 1 of the gap analysis, first release: **getting data in, and finding what
is already there.**

**Use table at cursor.** Every field that holds a table, list or matrix — 83 of
them across Stats, Analyze and the rest — now has a button that reads the Word
table your cursor is in, straight into the field. The reader had existed since
Table -> Chart shipped and was bound to that one mode, so a user whose numbers
were already in the document they were writing had to select, copy and paste
them into a pane box to run statistics on them. That was the one workflow a Word
add-in should own outright and the one that did not exist. Both callers now
share ONE reader rather than a second copy that could drift.

**Open CSV.** The same fields take a `.csv` / `.tsv` / `.txt` file. The parser
handles quoted cells properly — a label containing a comma, an escaped quote, an
embedded newline — because a naive split shifts every column after the offending
cell and produces a table that looks plausible and is wrong. Excel writes such
files by default. Delimiter is sniffed (tab, then semicolon, then comma), and
the 8 MB ceiling matches the existing sequence reader.

**Search finds tools and calculators.** The box indexed formulas and compounds
only, so none of the 26 tools and none of the 162 calculators could be found by
name — while a comment beside the home filter claimed "every tool stays
reachable from the dropdown and the search box". Both are indexed now, from the
same registries that render them, so a new calculator is searchable the day it
ships. A hit routes THROUGH the mode's own select and fires a real change event,
so panel rendering, live compute and the discipline panels follow exactly as
they do when a user picks by hand.

## [2.64.0] — 2026-08-01 — The eight live defects from the gap analysis

A full gap analysis (`docs/GAP-ANALYSIS-2026-08-01.md`) separated things that are
MISSING from things that are WRONG. This release is the second list.

**Two were correctness defects.** ¹H NMR skipped every non-carbon neighbour under
a comment reading "ignore exchangeable OH/NH coupling" — right for O and N, wrong
for **fluorine and phosphorus**, which do not exchange and couple hard
(²J(H-C-F) ≈ 47 Hz). A fluorinated CH₂ was reported as a confident singlet with no
warning. Those environments are now named in a caveat. And **Insights** correlated
every pair of pasted columns and called them "significantly correlated" on the
UNCORRECTED p — 45 simultaneous tests on ten columns, in the surface aimed at the
least statistical reader the product has. Correlations now carry a
Benjamini-Hochberg adjusted p, the narrative reports how many pairs were tested,
and a causation caveat rides along.

**One was a silent data defect.** Align concatenated a multi-record FASTA into a
chimera and aligned it. `countFastaRecords` had been written for exactly this
("&gt;1 means the caller should warn") and had no caller; DNA and Sequence Map both
warned already.

**One was a missing safety net.** There was no `window.onerror` and no
`unhandledrejection` handler anywhere, so an uncaught error in an Office task pane
rendered *nothing* — a pane that silently stopped, with no message and no way to
report it. A crash banner now names the failure, says the document is untouched,
and shows a pasteable report with the version in it. Nothing is transmitted.

**Four were claims that had drifted.** The Engineering tile advertised "36
calculators" against 87 — it now COUNTS them from the registry, so it cannot drift
again. Finance was tagged legal-only and invisible to science users. `landing/
science.html` sold restriction sites on sequence *maps* (they live in DNA mode).
And three stale refusals were corrected in place: `toa.ts` still refused page
numbers the product ships, `linalg.ts` called general eigenvalues out of scope
after they shipped, and the ROADMAP header said v1.96.0.

Found while fixing: my own first cut of the heteronuclear detector walked the
second bond through carbon only, which misses **H-C-O-P** — the most common
phosphorus motif there is. A probe caught it; a phosphate ester test now pins it.

## [2.63.0] — 2026-08-01 — Adiabatic flame temperature, the honest way

The one energy calculator that needed real thermodynamic data, built under
the data mandate: NASA-7 polynomials for CO₂/H₂O/N₂/O₂ taken MECHANICALLY
from GRI-Mech 3.0 (Cantera's gri30.yaml, fetched and script-extracted — no
coefficient typed by hand) and validated by a committed cross-check suite
against independent JANAF/CODATA landmarks, range-junction continuity, and a
cp-integration identity that would catch any transcription slip. The heating
value stays the user's measured input; the polynomials supply only sensible
enthalpies of four pure gases.

Honest limits carried in every result: no dissociation (overstates a
stoichiometric hydrocarbon-air flame by ~100–200 K, and says so), LHV basis
forced by the physics, sulfur fuels refused rather than answered with data
the tables do not contain, and a balance that cannot close below the 3500 K
polynomial wall is refused rather than extrapolated. Optional air preheat
(recuperator) and excess-air dilution. Energy & power is 17; Engineering 87.

## [2.62.0] — 2026-08-01 — Energy depth & grid power

The gap analysis, built: Energy & power grows 8 → 16 calculators (Engineering
is now 86). New `src/lib/grid.ts` — three-phase power (P = √3·V·I·pf on line
quantities, connection-independent), power factor correction (the real power
does not change; correction relieves the wires — delta and wye capacitor
sizing, differing by exactly 3), and cable voltage drop (copper at the
definitional 100% IACS, AWG computed from the gauge's exact geometric law,
√3-vs-2 path factor stated). Extended `energy.ts` — wind shear to hub height
(power law AND log law, disagreement reported, the control.ts two-methods
doctrine), Weibull wind statistics with the energy pattern factor and a
capacity-factor estimate (via the same Lanczos gammaln that sits under every
p-value, now exported from stats.ts), flue-gas analysis (measured dry O₂
inverted to excess air in closed form, on the same 3.76 air convention as the
combustion tool so the two cannot disagree), off-grid storage sizing + LCOS
(losses compound upstream; charging energy explicitly excluded), and sun
position / day length / H₀ from pure astronomy (polar day and night are
answers, not errors; same 1361 W/m² solar constant as the PV bound).

The wind tool now fills air density from the ISA at a given altitude — the
same atmosphere the aviation tools fly on, so the two benches cannot disagree.

## [2.61.0] — 2026-08-01 — Scientifically correct formatting in the energy suite

You pointed out H2O must never display as "H2O". Every chemical species in the
combustion tool now typesets with real subscripts — the title echoes your
formula as C₈H₁₈, the product lines read O₂/CO₂/H₂O/SO₂ — and the energy
tools' units display as m², m³/s, W/m², kg/m³, matching the rest of the bench.

The display is also a CONTRACT: what we show must parse back. parseFormula now
accepts Unicode subscript digits (pasting the displayed CH₄ works), and the
unit reader accepts superscript exponents (typing m³/s converts exactly like
m^3/s). Refusing ₄ while displaying ₄ would have made the correct rendering a
round-trip trap. A hydrate coefficient stays full size — 5H₂O is five waters,
not H₅₂O.

## [2.60.0] — 2026-08-01 — Energy & power

A sixteenth Engineering discipline: **Energy & power**, 8 calculators
(Engineering is now 78). Wind turbine power with the Betz limit enforced — a
claimed Cp above 16/27 is refused as physically impossible, the same way a
claimed efficiency above Carnot is. Solar PV output with NOCT cell-temperature
derating and a fill-factor consistency check. Hydropower on the net head.
Battery pack series/parallel design with C-rate and the Peukert correction
shown beside the uncorrected runtime. Combustion stoichiometry computed exactly
from the fuel's molecular formula via the IUPAC atomic weights (methane AFR
17.1, octane 15.0), with LHV derived from a user-supplied HHV. Levelized cost
of energy — where the energy is discounted too — and capacity factor.

Deliberately absent, per the steam-table rule: insolation tables, fuel
heating-value tables, battery chemistry curves. Those are measurements of a
site, a fuel and a cell; they are inputs, and the tool does the arithmetic and
the physical-bound checks around them.

New units: kWh/MWh/GWh, BTU and therm (therm derived as exactly 100000 BTU
after a hand-typed constant was caught transposed by its own probe), Ah/mAh,
and the US gallon. Deliberately NO lowercase "mwh" alias — it would make a
typed mWh (milliwatt-hour, a real coin-cell unit) resolve to megawatt-hours,
the same trap as Nm → nautical mile.

## [2.51.0] — 2026-07-30 — Element names, fetched and cross-checked rather than typed

You pointed out the periodic table showed no element names. That was deliberate in
v2.50.0 — 118 names typed from recollection is exactly the practice this project
refuses — but "deliberate" is not the same as "right", and a reference table without
names is a poor reference table. The answer was to get them from a real source.

### What was done

`scripts/fetch-element-data.mjs` fetches PubChem's periodic-table endpoint, caches the
response in `docs/`, and generates `src/lib/elementData.ts`. The script is committed, so
the data is reproducible rather than asserted.

**It refuses to write anything unless the two sources agree about which element is
which.** All 118 symbols must match the already-verified held table IN ORDER, and the
atomic numbers must be sequential. They do, exactly — and that agreement is what
licenses attaching PubChem's names to symbols this product had already verified.

### What was taken, and what was not

PubChem is a real source and **not an infallible one** — this repo has been bitten by
trusting it before, on folate stereochemistry. So it was cross-checked rather than
copied, and one class of value was deliberately left behind:

**Not taken: the atomic weights.** PubChem differs from the held IUPAC values for
lithium — which IUPAC gives as an interval, not a point — and for seven elements with
no stable isotope, where sources pick different reference isotopes. Those are
convention differences rather than errors in either source, and switching silently
would have changed numbers this product already computes with. `Li` still reads 6.94,
labelled IUPAC.

**Taken:** names, measured electron configurations, oxidation states, electronegativity,
ionisation energy, electron affinity, atomic radius and standard state.

### The check that validated both sides at once

The measured configurations were compared against this tool's own aufbau predictions.
They agree for 88 of 118, and the 30 that differ are **exactly the classic exceptions** —
Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, La, Ce, Gd, Pt, Au, Ac, Th, Pa, U, Np, Cm and the rest —
plus four the source itself labels "(predicted)". A correct aufbau implementation must
disagree with measurement precisely there and nowhere else, so each source corroborates
the other. That comparison is now a test: if the exception list ever grows to include
neon, the filling code has broken.

Where the two disagree the summary shows **both**, and says they differ because the
element is an aufbau exception. That is more useful than either alone — it is the fact a
student is being taught.

### Still absent, and still said so

Melting and boiling points, density, crystal structure, Mohs hardness and spectral
emission lines. The source fetched does not carry them, each entry says why, and none
has been filled in from memory.

### Two guards fired on this work, both correctly

The **network-surface** test refuses any external host in the source, because the
product advertises that OPSIN is its only outbound call. The PubChem URL in the
generated file's provenance header tripped it. Rather than adding a blanket exemption,
the guard now distinguishes a URL on a **comment** line (a citation) from one in code
(an address) — so a real runtime fetch to the same host would still fail it. The fetch
itself lives in a build-time script that never ships in the pane bundle.

The **dead-export ratchet** caught `atomicNumberByName` with no caller. Rather than
widening the ratchet, the function was wired up: the pane now accepts an element **name**
as input as well as a symbol or atomic number, which is what someone wanting names would
reach for anyway.

6,754 tests across 221 files. All twelve QC gates pass.

## [2.50.0] — 2026-07-30 — Periodic table & atomic structure, built without inventing data

The third wishlist feature, shipped the incremental way: everything that can be
computed or is already held, with every measured property **reported as absent** rather
than guessed.

### Why it is shaped like this

A 118-element table with ten properties each is roughly 1,200 measured values, and they
cannot come from recollection. The standing rule here is that all data must be real, and
the precedent is the deliberate refusal to build in steam tables because a table
reconstructed from memory is unverifiable. Filling in melting points to make the feature
look finished would have been the single worst thing this release could do.

So it carries exactly two kinds of thing.

**Held.** The symbols and standard atomic weights already verified in `PERIODIC`. The
atomic number comes from the ORDER of that table rather than a second list that could
disagree with the first — H is its first key, iron its twenty-sixth.

**Computed.** Electron configuration, shell occupancy, block, group and period, all
generated from the aufbau rule. The Madelung filling order is produced from its own
statement — increasing n + l, then increasing n — rather than typed out, so a
transposition in "1s 2s 2p 3s 3p 4s 3d…" is impossible rather than merely unlikely. The
noble gases are likewise **derived**, by asking which elements complete a p subshell;
that this returns exactly 2, 10, 18, 36, 54, 86, 118 is a check on the machinery rather
than an input to it.

### What it draws

**The periodic table** — 118 cells laid out from computed period and group, with the
f-block in two rows beneath. **A Bohr model** — one dot per electron, with the rings
counted from shell occupancy. **An orbital filling diagram** with Hund's rule applied,
which is the whole reason to draw one: `2p⁴` is a pair and two singles, not two pairs,
and that is the fact the picture carries which the written configuration does not. And a
**per-element summary**.

### The three places it refuses to overclaim

**Configurations are labelled PREDICTIONS.** About twenty elements — chromium and copper
the textbook pair — are measured to differ from the aufbau prediction, and those
measurements are not carried. Every diagram and every summary says so, and the caveat
travels into the inserted figure's alt text.

**The Bohr model says it is a teaching model.** It is from 1913, it gets the shell counts
right and the shapes wrong, and drawing it without saying so would present superseded
physics as current.

**The group-3 question is not decided.** Whether lanthanum or lutetium belongs in group 3
is genuinely unsettled and IUPAC has not closed it, so the whole fifteen-element f series
sits outside the numbered groups and the figure explains why rather than taking a side.

### And the absences are reported

Melting and boiling points, density, crystal structure, Mohs hardness, spectral emission
lines, oxidation states, and the element **names** are listed in the summary as absent,
each with the reason. A reference that quietly omits a property is indistinguishable from
one that has no data for that element, and the difference matters: these are missing
because they need a citation, not because the elements lack them.

One bug caught by its own test along the way: the orbital diagram had a fixed height and
**silently cropped** the heavy elements — gold and oganesson came out the same size with
oganesson's 7p simply missing. The figure now grows to fit, and a caller who forces a
small height is told the diagram is incomplete.

6,747 tests across 221 files. All twelve QC gates pass.

## [2.49.0] — 2026-07-30 — Candlestick (OHLC) charts

Second of the three wishlist features. One candle per row from four numeric columns —
where each period opened and closed, and how far it ranged in between. No existing
chart here carried four numbers per period: a line of closes throws the range away, a
bar of closes throws away the direction too.

### The convention is stated, not assumed

Green-up/red-down is a **Western** convention. Across much of East Asia red means UP.
A chart that leans on colour alone is therefore ambiguous to a large part of its
audience before colour blindness or a photocopier enters into it.

So direction is carried FIRST by the body — **hollow for up, filled for down**, which
is the older Japanese convention and survives greyscale — with colour as reinforcement
only, and a legend that says which is which in words. The red-is-up convention is
available as an option, and the legend follows it either way, which is the point of
having the option rather than a preference buried in code.

Asserted rather than asserted-to: the black-and-white rendering is tested to contain
no green or red at all and still distinguish the two directions.

### The columns are identified, not guessed

Reading open/high/low/close in the wrong order produces candles that look entirely
ordinary and are wrong — there is nothing to notice by eye. So names come first
(`Open`, `O`, `Open Price`, `Adj Close`, `Last`, and so on), and position is a
fallback **only when the OHLC invariants then hold on every row**: high really is the
largest of the four, low the smallest. A table whose columns are in another order
fails that check and is refused, naming the row that proved it.

The name matching is exact on a normalised name with only a trailing unit word
stripped, deliberately **not** a prefix match: "Open Price" must resolve to open and
**"Open Interest" must not** — that is a real futures column and a completely
different quantity, and a prefix rule would have handed its figures to the renderer as
prices.

### What it refuses to draw

A row whose high is below its close is impossible for a real period. That is a data
error rather than a market event, so no candle is drawn for it and the count is
reported. A row missing one of its four values leaves a **gap** rather than closing up
— shifting the later candles left would silently misdate every one of them.

A refusal is drawn INTO the figure rather than returning a blank frame, because a
blank frame is indistinguishable from a bug and gives the reader nothing to act on.

### The thing deliberately left out

**Volume on a second y-axis.** It is the obvious addition and the wrong one: two
y-scales on one plot make their alignment arbitrary and invent a correlation the data
does not contain — the single most common charting error. If volume is wanted it
belongs in its own panel sharing the x-axis, which is a separate change rather than a
second scale.

PowerPoint export ships a picture and refuses the native path, as heat maps do —
PowerPoint has no candlestick type and substituting a bar chart would present
different information under the same title.

6,699 tests across 220 files. All twelve QC gates pass.

## [2.48.0] — 2026-07-30 — Heat maps

First of the three features on the wishlist. A numeric table rendered as a grid of
shaded cells, for the job no existing chart here does: comparing magnitude across two
categorical axes at once — month × region, a correlation matrix, an assay plate.

### The colour is the part that goes wrong, so it is the part that was computed

The ramps are documented steps from a validated reference palette, run through that
palette's own validator rather than eyeballed. What it reported for the sequential
ramp, recorded verbatim in `chartPalette.ts`: lightness monotone PASS, adjacent ΔL
gaps PASS, single hue (4° spread) PASS, and a light-end contrast FAIL at 1.29:1.

That last one is expected here and the distinction matters. The palette's own note
says the full range "is for sequential encoding (continuous magnitude — heatmaps,
choropleths) where the lightest step means 'near zero' and is allowed to recede toward
the surface", while an ordinal ramp must clear 2:1. A heat map is the sequential case,
and the relief required for a sub-3:1 mark is secondary encoding — which is why the
number is printed in each cell and a colour bar always accompanies the grid.

Two rules do the real work:

- **Sequential is ONE HUE, light to dark.** A rainbow ramp is the classic heat-map
  error: it implies an ordering the eye cannot recover — is green more or less than
  yellow? — and manufactures boundaries the data does not have. Asserted by measuring
  hue spread across the ramp, not by looking at it.
- **Diverging is TWO HUES ABOUT A NEUTRAL GREY.** A hue at the midpoint reads as a
  third category rather than as "nothing". The arms are symmetric about the midpoint,
  which is what stops −1 and +100 being shown as equally extreme.

### What it refuses to do

A non-numeric cell is drawn blank and counted, **never treated as zero** — that would
move the colour scale and shade a cell for a value not in the table. A diverging scale
applied to one-sided data says a sequential one would use the whole ramp instead of
half. And greyscale admits it can only show how FAR a value is from a diverging
midpoint, not which side it is on, because lightness has one dimension.

PowerPoint export always ships a **picture**. There is no native heat-map chart type,
and `buildTablePptx` throws rather than substituting a bar chart under the same title —
a silent substitution would present different information, which is worse than an error.

### A bug my own test caught

`inkOn` decides whether a cell's number is printed in black or white. I picked its
threshold by eye at luminance 0.36, and it was wrong in the middle of the ramp: the
mid-blue `#5598e7` (L = 0.302) took white text at **2.98:1** where black would have
given 7.04:1. The threshold is now derived — white overtakes black at
√(1.05 × 0.05) − 0.05 = 0.1791 — so a new ramp needs no new decision. It only surfaced
because the test sweeps every step of every ramp rather than the ends.

6,674 tests across 219 files. All twelve QC gates pass.

## [2.47.0] — 2026-07-29 — An exponent extends to one atom, and spaces mean something

`2^2x` read as 2^(2x) in one parser and (2^2)x in the other. Two releases ago I filed
that as a cosmetic inconsistency and left it, on the grounds that changing how exponents
bind would re-read every expression already sitting in a document.

**Measuring it first — the habit that has caught something in nearly every round of this
work — showed it was a wrong number.** The same fault made `r^2 h` parse as r^(2·h),
which for r = 3, h = 2 evaluates to **81** where the answer is 18. That belonged in the A
tier, not among the cosmetics.

### Two causes

**Implicit multiplication was formed in the wrong place.** It lived inside the parser's
number branch, so a number followed by a letter became a product *anywhere* — including
inside an exponent, the one place it must not. It now lives in the product rule, and the
exponent parses a single atom.

**Whitespace was deleted before anything was read.** `replace(/\s+/g, "")` — so adjacent
names were glued into one: `pi r` became a variable called "pir", `y z` became "yz",
`sin x` became "sinx". The consequence is the one that matters: `pi r^2 h`, the shipped
formula for the volume of a cylinder, parsed as "pir" raised to the power (2·h), and
nothing in the result said so. Whitespace now separates factors.

### What had to survive

An exponent binding change is easy to get half-right, so the things that must not move
are asserted rather than assumed: `2^3^2` is still 512 (right-associative), `-x^2` is
still −(x²), `x^-1` still works, `x2` and `v_max` are still single variables, and
`2^(2*x)` still means what its brackets say.

Newly correct rather than newly refused: the shipped formulas now **evaluate** in Solve
and not merely typeset — cylinder, cone and sphere volumes, `I^2 R`, Pythagoras, the
slope of a line. Those were being computed wrongly before, or as an expression in a
variable nobody had typed.

One thing is newly refused, and deliberately: `sin x` used to become a variable called
"sinx", and with whitespace now meaningful it would have become sin × x — a product with
a variable named "sin", which is the kind of nonsense that yields a plausible answer.
It now says that sin is a function and needs brackets.

### On the mis-classification

The reason given for leaving this alone was caution about re-reading expressions already
in documents. That was the wrong instinct, and worth recording as such: the old reading
was not a rival convention someone might have relied on, it was arithmetic nobody wants.
The 300-expression behavioural baseline did not move by a single line.

6,649 tests across 218 files. All twelve QC gates pass.

## [2.46.0] — 2026-07-29 — Integrals with a hole in the integrand, and a correction to the last release

### The last defect that refused work it could do

`integral of sin(x)/x over [-1, 1]` is 1.8922 and was refused. The integrand is
undefined at x = 0 but its limit there is 1, and adaptive Simpson's very first act is to
evaluate the midpoint — which for that interval is exactly 0, where sin(0)/0 is NaN. One
undefined sample aborted the whole integral.

Closed with the method named as the fix direction two releases ago: **composite
Gauss–Legendre**. Its nodes lie strictly inside each panel, so no interval endpoint and
no panel boundary is ever evaluated, and a point where the integrand merely has a hole in
it is never visited at all. A second property matters as much and is less obvious — the
nodes stay well AWAY from the singular point, so an integrand that loses precision very
close to it is never asked about that region. The value is refined until two panel counts
agree to eleven significant figures, so it carries evidence rather than a promise.

Seven integrands verified against an independent high-resolution midpoint rule, agreeing
to 5e-7 or better, with every expected value derived rather than guessed: Si(1) for
sin(x)/x, and the series expansions for (1−cos x)/x² and (exp(x)−1)/x.

### A correction to v2.45.0

That release said an earlier attempt at this — averaging two neighbours across the
singularity — "produced wrong numbers", quoting **0.9728 against a true 0.9896** for the
integral of (1−cos x)/x² over [−1, 1].

**The 0.9896 was wrong.** It was a hand figure that was never checked. The series
(1−cos x)/x² = ½ − x²/24 + x⁴/720 − … gives 2(½ − 1/72 + 1/3600 − …) = **0.9727708**,
confirmed here against an independent midpoint rule. So the reverted fix had been
producing correct answers, and it was discarded for nothing.

Using an unverified figure as the oracle to judge a fix is the mistake, and this one cost
a working fix and a release. It is the same class as everything else this file has been
recording — an unchecked reference value is exactly as dangerous as an unchecked
computation, and rather more embarrassing.

Gauss–Legendre is still the better rule and is what ships: it never visits the singular
point rather than reconstructing a value there, its nodes avoid the cancellation-prone
region rather than relying on two corrupted neighbours agreeing, and it reports its own
convergence. But it was chosen on its merits, not because the alternative was broken.

### The trap the fix walked into

Gauss–Legendre never evaluates an endpoint. That is exactly why it can rescue a removable
singularity sitting at one — and exactly why `integral of 1/x over [0, 1]`, which
diverges, came back as a confident finite number.

The structural pole search only reports poles strictly INSIDE the interval, because an
endpoint pole used to be caught by Simpson evaluating that endpoint and returning NaN.
Endpoints now get their own `isGenuinePole` check: a removable singularity is allowed
through, a pole is not. Caught by an existing test rather than by foresight, which is the
argument for keeping tests that assert refusals as carefully as answers.

The new rule is confined to the previously-refused path, so every integral that already
had an answer keeps the same one, computed the same way — asserted, not assumed.

### What is left

Two entries in `docs/KNOWN-DEFECTS.md`, neither producing a wrong number: **B3**, a blank
Bode chart at zero reference that could not be reproduced, and **C2**, a huge exact
rational converting to Infinity, which is the correct IEEE result at the boundary. Also
recorded: the two expression parsers still read `2^2x` differently, left alone because
changing how exponents bind would re-read every expression already sitting in a document.

6,616 tests across 217 files. All twelve QC gates pass.

## [2.45.0] — 2026-07-29 — An identity hidden by cancellation, notation with two meanings, and hydrates

Three closed, one attempted and removed, and two left open with reasons. What remains
in `docs/KNOWN-DEFECTS.md` after this is three entries, none of which produces a wrong
number.

### The identity that cancellation hid — properly fixed this time

`cosh(x)^2 - sinh(x)^2 = 1` is an identity and returned **33 spurious roots**. The
cause is that a tolerance derived from the size of the ANSWER cannot see catastrophic
cancellation, because cancellation is exactly the case where the answer is tiny and the
intermediates are enormous: at x = 18 both squares are about 1.1e15, so the computed
difference carries roughly 0.25 of rounding dust — two hundred million times the true
answer's own last bit. Judged against 1 that looks like wild disagreement; judged
against 1.1e15 it is precisely what double arithmetic can deliver.

v2.40.1 tried to measure that dust empirically, by perturbing x and watching how far
the difference moved, and **reverted it**: the estimate is itself a random quantity,
and the version that finally passed the cosh case also reported `tan(x) = 2` and
`exp(x) = 2` as identities — every equation in the product made vacuous.

The real fix, and the one recorded then as the direction to take: `evalAstScaled` now
evaluates an expression and reports the largest magnitude it passed through on the way,
so the tolerance reflects the precision at which the expression can actually be
evaluated. It is deterministic and has no threshold tuned to a particular example — the
answer is simply "this cannot be evaluated to better than eps times *this*". Kept
separate from `evalAst` deliberately: that function runs inside adaptive quadrature and
root-scan loops, and paying for a tracker on every one of those to serve a check that
runs 123 times would be the wrong trade.

Ten identities now close, including `cosh(2x) = cosh^2 + sinh^2` and
`tanh(x) = sinh(x)/cosh(x)`, and twelve near-identities are asserted **not** to —
including the two that the reverted approach broke.

### `1/2x` meant two different things in one product

| typed | solve.ts | mathParse.ts |
|---|---|---|
| `1/2x` | `1/(2x)` | `(1/2)x` |
| `2/2x` | `1/x` | `x` |

The two readings of `2/2x` differ by a factor of x squared, which is not a rounding
difference — it is a different function.

Neither was chosen, because neither is settled: most computer algebra systems give
implicit multiplication the same precedence as explicit multiplication, a great deal of
handwritten mathematics and physics reads it the other way, and ISO 80000-1 recommends
never writing it. Picking one would have made the other silently wrong for whoever
meant it. So it is **refused by both parsers**, with both readings offered back so the
fix is one keystroke.

**The scope of that refusal was wrong twice, and both are worth recording.** Usage was
surveyed in `examples.ts` and the manual before deciding, and came back zero — but
`formulaLibrary.ts`, the actual shipped content a user inserts, was not surveyed. And
the first version also matched `^`, which is simply not ambiguous: an exponent extends
to the atom immediately after it, so `r^2 h` is unambiguously (r^2)h. That broke four
shipped formulas — volume of a cylinder and cone, power dissipated, two-asset portfolio
variance. The full suite caught it, and there is now a test that walks the entire
formula library.

What this did **not** settle: the two parsers also disagree about `2^2x`, and that one
is left alone. Unlike division it has a settled convention, so mathParse.ts is right
and solve.ts is the odd one out — but changing how exponents bind would re-read every
expression already sitting in a document, which is more than a notation guard should do
quietly. Recorded with the correct reading named.

### A hydrate dot is not punctuation

`parseFormula("CuSO4.5H2O")` stripped every non-alphanumeric character, merging the
parts and joining the multiplier to the element before it: "O4" and the following "5"
became "O45", and the answer was **O:46** instead of O:9.

It was unreachable when found — the only caller feeds it OpenChemLib's already-clean
formula — which is why it was worth fixing rather than leaving. An exported function
that is wrong only because nobody calls it that way is a trap set for the next caller,
and the count it returns feeds monoisotopic mass.

Fixing the dot alone would have swapped one silent mis-parse for another: brackets were
stripped too, so `Cr2(SO4)3` read as `Cr2SO43` and gave O:43. Both are handled now,
with nesting — `((CH3)2CH)2O` and `K3[Fe(C2O4)3]` hydrates included — and an unclosed
bracket yields nothing rather than a partial count.

### One attempted and removed, on purpose

C0: `sin(x)/x` over [-1, 1] is 1.8922 and is refused, because adaptive Simpson's first
midpoint is exactly 0 where sin(0)/0 is NaN. The obvious repair — average two
neighbours either side of any non-finite sample — was built and measured, and it
produced wrong numbers: **0.9728 against a true 0.9896** for the integral of
(1-cos x)/x^2 over [-1, 1].

The reason defeats the approach. Cancellation corrupts these integrands over a
*neighbourhood* of the point, not just at it: below x = 1e-8 the nearest double to
cos(x) is exactly 1, so (1-cos x)/x^2 evaluates to 0 rather than 0.5 — and **both
neighbours agree on that wrong value**, so no agreement test can tell it from a genuine
limit.

A multi-scale check does separate the two cases, and was still not shipped: it converts
a refusal into a number one case at a time, and getting it wrong puts a plausible 2%
error where there is currently an honest refusal. Refusing a correct answer is a
smaller harm than reporting an incorrect one. The real fix is a quadrature rule that
never samples the point it is told to avoid, which is a change of method rather than a
patch.

6,606 tests across 217 files. All twelve QC gates pass.

## [2.44.0] — 2026-07-29 — Circuits, trusses, parsers, and messages that were false

Nine more from `docs/KNOWN-DEFECTS.md`. Nothing here produced a wrong number — the A
tier was cleared in v2.43.0 — so this round is about work the tool refused that it
could do, freezes, and messages that said something untrue.

### Two seconds of frozen Word, per keystroke

The DC path solves exactly, over rationals, which has no rounding error and pays for
it with **coefficient growth**: numerators and denominators roughly double in bit
length at each elimination step. On a 120-node interconnected mesh — the parser's own
legal limit — that was **1362 ms** for the solve and **1102 ms** for a 120-point
sweep. About two and a half seconds, in a pane that recomputes as the user types.
That is not a slow answer; it is a Word that stops accepting typing.

Above 48 unknowns the solve now uses doubles, and **says so** — a result silently no
longer exact, in a module that advertises exactness, would be a false claim rather
than a slow one. The sweep's point count is budgeted on points × nodes³, since every
point is a full complex solve, and the thinning is disclosed with the count.

| | before | now |
|---|---|---|
| DC solve, 120-node mesh | 1362 ms | **38 ms** |
| 120-point sweep, same | 1102 ms | **183 ms** |

Small circuits — every netlist anyone types by hand — keep full exactness and all 120
sweep points, and both are asserted so the cap cannot creep down onto them. Refusing
the large circuit outright was considered and rejected: trading a slow correct answer
for no answer is a worse deal than an approximate one that admits it.

### `1e-6` was refused while `1u` was accepted

The same number, written the way a spreadsheet or a SPICE deck writes it, failed. So
did `2.2e3` and `1E-9`. The exponent is folded into the **exact rational** and not
just the float, because otherwise the notation would silently change the guarantee
the DC path makes.

### A message that named a fault it had already excluded

The singular-matrix fallback advised checking for "a shorted or duplicated source" —
but a duplicated source is caught by the parallel-pair test above it, so that advice
could never be the answer. It sent the reader looking for something the tool had
already ruled out.

What actually reaches that point is a **loop** of ideal sources: three sources round
a loop over-determine the node voltages without any two being in parallel, and an
inductor is a short at DC so a source shorted through one is the same fault. A
union-find pass over the zero-impedance subgraph now names it. What remains after
that names only what has **not** been ruled out.

### A negative resistance was accepted in silence

This module is documented as linear and **passive**, and a negative resistance,
inductance or capacitance was solved as though it were a component. The equations do
not object; only physics does, so the check had to be added. A negative resistance is
a legitimate small-signal model for an active device — the refusal says so, and says
that modelling one needs the active-device support this tool does not have.

### The truss threw away its own guarantee

Member tension/compression came from the **float** while the zero test used the exact
rational. The exact path exists precisely so the sign is decidable; taking it from
the rounded value discards that for any member whose force is near zero, and tension
versus compression is the difference between specifying a cable and specifying a
strut.

### The canonical correctness net was not running

`casint` advertises a canonical check: it differentiates every candidate
antiderivative back and demands `exprEqual` with the integrand. But d/dx ln|x|
simplifies to `x/abs(x)^2`, and `abs(x)` was an opaque atom that never reduced — so
`exprEqual` was **false for every `ln|·|` result**, and those were accepted on
numeric agreement at eight fixed sample points instead.

`abs(A)^n` now reduces to `A^n` for even n, which is exactly true with no branch to
choose, and to `A^(n-1)·abs(A)` for odd n. Nothing was wrong — 67 integrands swept on
a disjoint grid found no bad antiderivative — but the advertised check was not
protecting the largest class of results it exists for. It is now.

### Messages in the reader's notation

`abs x` produced "Expected lparen in math expression." The reader did not write an
lparen and has no reason to know what one is. Errors now name the character and say
what was found instead.

### A stray delimiter that drew something

`A ->> B` split on the `->` inside `->>`, leaving `> B` as a component — which was
handed to OpenChemLib as SMILES. It did not error; it drew something. Fixed by
stripping and reporting the leftover rather than by widening the arrow pattern,
because `[O-]` and `C[N+](C)(C)C` contain the same characters and a greedier pattern
would shatter them.

### `isSymmetric` was wrong in both directions

An absolute floor made the answer depend on the units the matrix was written in:

- `[[1e-20, 1e-20], [2e-20, 1e-20]]` — off-diagonals differing by **100%** — was
  reported symmetric, because every entry fell below the floor. This one matters:
  `eigenSymmetric` is gated on it, and the Jacobi method it uses is only valid for a
  symmetric matrix.
- `[[1e20, 1], [1.0000001, 1e20]]` was reported **not** symmetric, for a difference
  of 1e-7 against a norm of 1e20.

Now relative to the matrix's largest magnitude, so scaling a matrix cannot change
whether it is symmetric — asserted across five scale factors spanning forty orders of
magnitude.

### One I could not reproduce, left open

B3 claimed a blank Bode chart when the reference is zero. A high-pass whose output is
genuinely zero at DC, swept from 1 µHz to 1 MHz, returned all twenty points finite
with a dB range of −150 to +14. It stays in `KNOWN-DEFECTS.md` rather than being
marked fixed, because "I could not reproduce it" is not "it does not happen".

6,557 tests across 216 files. All twelve QC gates pass.

## [2.43.0] — 2026-07-29 — The A tier is empty: limits, a dozen restored integrals, and a 20-second freeze

Four more from `docs/KNOWN-DEFECTS.md`, and with them **every defect that produced a
wrong number presented as correct is now closed** — A1 through A12, each with its
reproduction moved into a named test rather than merely patched.

### A8 was already fixed, and that is worth recording

`limit x^2 as x -> 0.0001` printed `= 0` for an answer of 1e-8, and one case printed
a headline contradicting the step line directly beneath it. Reproducing it first —
the habit this round of work has settled into — showed all three reported cases now
return correct values. The symptom was the **six-decimal-place rounding in `fmtNum`**
removed in v2.43.0's predecessor v2.40.0, not a fault in the limit engine at all.
Fixing the display fixed the arithmetic that was being displayed. The three cases are
pinned so it stays fixed.

### A constant factor cannot create or destroy a limit

The convergence test was `spread <= 1e-4 * (1 + |last|)`. That `1 +` is an absolute
floor bolted onto a relative tolerance, and the floor did the damage: **any** tail
whose values were below about 1e-4 passed it however wildly it swung. So:

| typed | before | now |
|---|---|---|
| `limit sin(1/x) as x -> 0` | undetermined | undetermined |
| `limit 1e-3*sin(1/x) as x -> 0` | undetermined | undetermined |
| `limit 1e-5*sin(1/x) as x -> 0` | **−6.11e-6** | undetermined |
| `limit 1e-9*sin(1/x) as x -> 0` | **−6.11e-10** | undetermined |

Multiplying by a positive constant changed whether a limit existed. The spread is now
judged against the tail's own magnitude, which is invariant under scaling, and the
envelope trend separates the one case that genuinely converges — `x*sin(1/x)`, whose
oscillation decays — from one with a steady envelope, which has no limit. Asserted
across eight scale factors from 1 down to 1e-30, in both directions.

**The fix broke a correct answer before it was right**, which is worth setting down.
`(1-cos(x))/x^2` tends to ½, but below x ≈ 1e-8 the nearest double to cos(x) is
exactly 1, so `1-cos(x)` evaluates to 0 and the sampled tail reads [0.5, 0.5, 0, 0].
That is indistinguishable from a decaying envelope, and the limit came back as 0. The
tail never changes SIGN, though — so requiring a genuine sign change before treating a
tail as an oscillation separates cancellation damage from oscillation. Caught by
putting `(1-cos(x))/x^2` in the "must be untouched" list rather than only testing the
cases that were broken.

### A dozen textbook integrals were being refused

Partial-fraction integration divided its result by the denominator's leading
coefficient — which the basis polynomials already carry, since the factors are built
monic and the coefficient-matching system absorbs it into the solved numerators. The
answer came out wrong by that factor, the self-verification gate correctly rejected
it, and the integrator returned null. Silently refused before this:

`1/(2x+3)`, `1/(4x²−1)`, `1/(3x²+5x+2)`, `x/(2x+1)`, `1/(9x²+1)`, `1/(6x²−5x+1)`,
`5/(2x²+3x+1)`, `1/(3−2x)`, `1/(4x²+4x+2)`, `(x²+1)/(2x+1)`.

Every monic sibling worked — which is every test that existed, and why nothing caught
it.

**It was broader than reported.** The behavioural baseline flagged `1/(x-0.5)`
changing too, which is monic as typed: a decimal coefficient becomes non-monic under
exact-rational rescaling, so *every* decimal denominator was affected as well.
`1/(x-0.5)` over [2, 3] is now exact and reads 0.5108256238, which is ln(2.5/1.5).

And the values are confirmed by something better than a hand check: the baseline shows
each of these moving from "adaptive Simpson" to "exact (symbolic)" with the value
**identical to ten significant figures**. The numeric path had been quietly covering
for the exact one, and the two now agree.

### Twenty seconds of frozen Word, per keystroke

The rational-root search capped how far trial division looked for divisors. It did not
cap the **cross product** of those divisors, which is what actually gets evaluated.
For a constant term of 963761198400 — 6720 divisors, 905 within the search bound —
that product reached 1,638,050 exact BigInt-rational evaluations, once per degree:

| | before | now |
|---|---|---|
| `ratPolyRoots([H, H+1, H])` | 1710 ms | **34 ms** |
| `integrate(1/(H·x²+(H+1)x+H), 0, 1)` | 2408 ms | 22 ms |
| `integrate(1/(H·x⁸+(H+1)x+H), 0, 1)` | **20639 ms** | **286 ms** |

This is the catalogued lesson once more: a clamp that bounds the search does not bound
the time. The candidate set itself is capped now, and a truncated search reports
`incomplete` rather than returning nothing — because "no rational roots found" and
"no rational roots exist" are different statements, and conflating them puts a
falsehood where a result should be. Ordinary polynomials are unaffected and marked
complete.

### One arithmetic slip, in the test rather than the code

The expected value for `∫₂³ dx/(x²−1)` was written as ½ln((1/2)/(2/4)), which is
½ln(1) = 0. The correct figure is ½[ln(2/4) − ln(1/3)] = 0.2027325541. Recorded
because a test with a wrong expectation is worse than no test: it would have failed
against correct code and invited someone to "fix" the code to match.

6,517 tests across 215 files. All twelve QC gates pass.

## [2.42.0] — 2026-07-29 — Pharmacokinetics: the missing area, flip-flop, and absorption

Batch 3 from `docs/KNOWN-DEFECTS.md`. Three defects, each quantified before being
touched and each checked against a closed form or an independent simulation.

### The AUC started at the first sample, not at dosing

The trapezoidal loop ran from the earliest supplied time to the last, so if dosing
was at t = 0 and the first sample was later, **that interval was simply missing** —
and every parameter derived from AUC carried the error, with no note of any kind.
Measured on a one-compartment IV bolus with a true clearance of 1.0 L/h:

| first sample | reported CL | error |
|---|---|---|
| 0.25 h | 0.990 | −1% |
| 1 h | 1.140 | +14% |
| 2 h | 1.373 | +37% |
| 4 h | **1.982** | **+98%** |

The two routes need **different conventions**, and getting that wrong is its own
error: naively adding a straight trapezoid from the origin to the first IV sample
overestimates the area under an exponential decline, which took the same data from
4% low to 6% high. So an IV bolus back-extrapolates C0 log-linearly through the
first two points and integrates the fitted exponential exactly, while an oral dose
uses C(0) = 0 — which is not an approximation but the definition, since the drug has
not been absorbed yet.

Verified two ways. The error is now **independent of when sampling started** — a
spread of under 5% across first samples from 0.25 h to 4 h, where it used to vary by
a factor of two. And it **converges to 0.00%** as sampling densifies (2.37% at
4-hour spacing, 0.00% at 0.1-hour), which proves the remainder is trapezoidal
discretisation rather than anything the back-extrapolation introduced. Whichever
convention was used is stated, because a reader comparing this AUC against other
software needs to know which produced it. If the first two points do not decline,
no C0 is invented — the gap is disclosed instead.

### An oral terminal slope may be absorption, not elimination

When absorption is slower than elimination the tail of the curve decays at the
**absorption** rate: the drug leaves as fast as it arrives. The terminal slope then
estimates ka, and the half-life is reported with the elimination label on it.

The two cases are **numerically identical**. Simulated with dose 500 and V = 10:

| | reported t½ | true elimination t½ |
|---|---|---|
| ka = 1.0, ke = 0.1 | 6.93 | 6.93 |
| ka = 0.1, ke = 1.0 | **6.93** | **0.693** |

Same number, ten-fold different truth. No fit to oral data can separate them,
because the one-compartment oral model is symmetric in ka and ke — which is exactly
why the standard resolution is an intravenous reference profile. Every oral result
now says so, and says to read the figure as the **slower** of the two rate constants
without one. IV results carry no such warning, because there is no absorption phase
to confuse.

### The steady-state peak assumed the dose appeared instantly

`F·Dose/Vd` is the concentration reached when the whole bioavailable dose arrives
**instantaneously** — an IV bolus. An oral dose is absorbed at a finite rate, so the
peak is lower and later and that figure is never actually reached. The parameters
carried an absorption rate constant and it was silently ignored:

| ka (ke = 0.2) | true peak | instantaneous figure | overstated by |
|---|---|---|---|
| 0.3 | 27.97 | 54.99 | **+97%** |
| 0.6 | 33.28 | 54.99 | +65% |
| 1.0 | 37.66 | 54.99 | +46% |
| 3.0 | 45.63 | 54.99 | +21% |

With an absorption rate supplied the standard multiple-dose oral solution is used at
its own tmax, verified to better than one part in a million against a superposition
simulation at five (ka, ke) pairs, with tmax agreeing to four significant figures.
Without one the bolus formula is kept — it is correct for an IV bolus and a
defensible upper bound otherwise — but it now **says** that rather than leaving the
assumption unstated. The average concentration is unchanged either way and asserted
to be, since Cavg depends only on dose rate and clearance.

`ka` equal to `CL/Vd` falls back with an explanation, because the standard solution
divides by their difference.

### The fix had to be reachable

The steady-state calculator offered bioavailability but had **no field for an
absorption rate**, so the corrected path could not be called from the product at
all. A green engine test proves nothing about whether the pane can reach the engine
— a lesson this repo has already paid for. There is now an optional `ka` field, the
peak reports when it occurs, and blank still means IV bolus. Left blank it passes
`undefined` rather than 0, because a supplied rate of zero means something else.

One more thing the figure would have got wrong: the plotted trace is a superposition
of instantaneous doses, so with an absorption rate supplied its peaks are the bolus
peaks and would silently contradict the numbers above it. That is now stated on the
page.

6,496 tests across 214 files. All twelve QC gates pass.

## [2.41.1] — 2026-07-29 — An approximate settling time printed beside the word "exact"

A follow-up on v2.41.0, from asking what the freshly-changed code claims about
itself rather than only whether its numbers moved.

`secondOrderMetrics` returns `exact: true` for any genuine second-order
denominator, and that flag means the damping ratio and natural frequency are exact
identities. It does **not** mean the settling time is — and for an underdamped
system the settling time is `4/(zeta*wn)`, the standard envelope estimate, which is
2 to 4% away from the true 2% crossing by construction. At ζ = 0.7 it gives 5.71 s
against a true 5.98 s. This release's own test asserts that gap, so the product was
printing a figure it knew to be approximate next to the word "exact".

The underdamped branch keeps the textbook formula — students expect that number,
and silently substituting a different one would be its own kind of wrong — but it
now says what kind of number it is, and that the critically damped and overdamped
cases are solved for directly instead. The overdamped branch is asserted **not** to
carry that caveat, so the two cases stay distinguishable.

Also checked, and a risk that turned out not to exist: whether a higher-order plant
could reach the new overdamped solver with a damping ratio derived from a dominant
pole pair rather than read off a real second-order denominator. It cannot — the
dominant-pole path requires a stable **complex** pair, which means ζ < 1 by
definition, and an overdamped higher-order plant is refused outright rather than
having a damping ratio invented for it. Pinned in a test so it stays that way.

6,472 tests across 213 files. All twelve QC gates pass.

## [2.41.0] — 2026-07-29 — Control: a settling time that ran backwards, and a verdict withheld

Batch 2 from `docs/KNOWN-DEFECTS.md`. Four defects, each independently reproduced
before it was touched and each checked against something outside this code — a
simulated step response, a brute-force frequency sweep, or an exactly known
factorisation.

### Settling time ran the wrong way

`4/(zeta*wn)` is the decaying envelope of an **underdamped** response. It was being
applied at every damping ratio, so as damping rose the reported settling time
*fell* — which is backwards. Measured, with ωₙ = 1:

| ζ | reported | true |
|---|---|---|
| 1 | 4 | 5.83 |
| 2 | 2 | 14.9 |
| 5 | 0.8 | 38.8 |
| 20 | **0.2** | **156** |

780 times optimistic at ζ = 20, and flagged `exact`. Anyone sizing a controller
from that figure was told the loop settles instantly when it crawls.

For ζ ≥ 1 the poles are real and the response is a sum of two exponentials
dominated by the **slower** one — the pole nearer the origin, which is exactly the
one the envelope formula ignores. The 2% crossing is now solved for directly rather
than approximated, because the second exponential matters near ζ = 1 and the
critically damped case has a t·e^(−t) term that no single-pole rule of thumb
captures. Verified against a simulated step response at nine (ζ, ωₙ) pairs, agreeing
to better than one part in a thousand.

The underdamped branch is deliberately **unchanged**: `4/(zeta*wn)` is the textbook
2% estimate, students expect that number, and it is 2–4% off the true crossing by
construction. Replacing it silently with a different figure would have been its own
kind of wrong.

### The margin reported is now the worst crossing, not the first

A loop whose magnitude is not monotonic crosses 0 dB more than once and has a phase
margin at each. The stability margin is the **smallest** — that is what the word
means. Reporting the first gave `100(s²+0.02s+1)/(s+1)⁴` a phase margin of 32.5°
when its three crossings are at 33.0°, 148.8° and **23.1°**. A number that says
"comfortable" about a loop that is not is worse than no number.

Every crossing is now collected and the minimum reported, with the same treatment
for gain margin at multiple phase crossovers. The full list is disclosed in a note
and exposed on the result, because three crossings at 33, 149 and 23 degrees is a
different engineering situation from a single crossing at 23 even though the margin
is identical.

### The sweep no longer assumes where the crossover is

The frequency range came from pole and zero magnitudes — and **those do not move
when the gain changes.** For `1e12/(s+1)³` every pole sits at 1, so the sweep stopped
at ω = 100 while the true 0 dB crossing is at ω = 10005. The result was "the
magnitude never crosses 0 dB over the swept range, so there is no phase margin",
reported for a loop that has one. A bounded sweep had silently become a wrong
answer — exactly what that function's own docstring warns about for the gain margin.

The range is now extended until |L| actually brackets 1, bounded to twelve decades
either way, and asserted across seven loop gains from 1e3 to 1e15. A loop that
genuinely has no crossover still says so: extending the sweep must not manufacture
a margin, and `0.01/(s+1)` is checked for that.

### A verdict withheld rather than guessed

`(s²+1)³` is three double poles at ±i — marginally stable — and came back
**"UNSTABLE — 2 poles in the right half plane."** The cause is not a tolerance:
Durand–Kerner resolves a root of multiplicity m only to about the m-th root of
machine precision, so a triple root lands ~1e-5 from where it belongs and carries
that error into its real part. No threshold fixes that; moving it only changes which
repeated-root system is misjudged. Routh–Hurwitz would settle it exactly, but a
polynomial with roots on the imaginary axis produces a zero row, which is precisely
the case it cannot complete.

So repeated roots are now detected **exactly**, via gcd(p, p′) over the rationals —
a theorem, not a heuristic, and free here because the coefficients are already exact
rationals. Detecting them numerically would have been circular.

The refusal is deliberately narrow. Three conditions must all hold: a repeated root,
Routh unable to answer, **and** a pole near the axis where the multiplicity error
could change the verdict. `(s+1)²` and `(s+1)³` stay STABLE, `(s−1)²` and `(s²−1)²`
stay UNSTABLE — double poles at ±1 are placed to about 1e-8, so those answers are
sound — and `s²`, a double pole exactly at the origin, stays MARGINALLY STABLE
because the factorisation makes it exactly known. Only the genuinely ambiguous case
returns UNDETERMINED, and **the refusal itself is asserted in a test** so a future
change to the root finder cannot quietly resume emitting a verdict.

### One thing worth recording about the fix

The first version of the repeated-root helper was written for **ascending**
coefficients while this module is highest-power-first. That is right for a palindrome
like `(s²+1)ⁿ` — the very case it was built for, so it passed — and wrong for `s²`,
which it reported as having no repeated root. Caught by adding `s²`,
`(s+1)²(s+2)` and `(s+1)(s+2)(s+3)` to the check. A helper that is correct only on
the example it was built from is a pattern this project keeps finding.

6,470 tests across 213 files. All twelve QC gates pass.

## [2.40.1] — 2026-07-29 — The identity fix only caught the examples it was given

A patch on v2.40.0, from reviewing the fix rather than the feature — and the
finding is the failure mode this repo already has a name for: **the fix was spelled
to the report's examples.**

The identity check tested `f === 0` **exactly**. That works for `x/x = 1`,
`(x-1)/(x-1) = 1` and `sin(x)/sin(x) = 1` — the three cases in the report — because
those cancel exactly in binary. The identities a person actually types do not:

| typed | before | now |
|---|---|---|
| `sin(x)^2 + cos(x)^2 = 1` | **3620 roots** | identity |
| `exp(ln(x)) = x` | **852 roots** | identity |
| `ln(exp(x)) = x` | 852 roots | identity |
| `sin(2*x) = 2*sin(x)*cos(x)` | thousands | identity |
| `(x+1)^2 = x^2+2*x+1` | thousands | identity |

`sin²x + cos²x − 1` evaluates to ±1.1e-16 at most doubles, not to zero. So the
question has to be asked **relative to the size of the two sides**, comparing them
separately rather than testing their difference against zero — exact equality is
merely the special case where the cancellation happens to be lucky. Probing is done
on nested ranges as well, because `cosh(x)^2` overflows past x ≈ 355 and a single
wide sweep left too few computable samples to judge on.

Eight identities are now asserted to close, and — the half that matters as much —
nine near-identities are asserted **not** to. `sin(x)^2 + cos(x)^2 = 1.0000001` has
no solution and must not be called vacuous.

### Fabricated roots are withheld, not warned about

`exp(x) = 0` has no solution, but exp underflows to zero below x ≈ −745, so the scan
returned **510 "roots"** from the underflow region. v2.40.0 attached a warning and
returned them anyway. That was the wrong call by this project's own precedent:
v2.39.0 had already upgraded `sqrt(x)^2` over [−1, 1] from a caveated number to a
refusal, on the grounds that a caveated number is still a number in the document.
510 of them is the same mistake at scale. Nothing is returned now, with an
explanation of what underflow is and why those values are artefacts.

### One attempted fix reverted on purpose

`cosh(x)^2 - sinh(x)^2 = 1` is an identity and still returns 33 spurious roots,
because the cancellation happens *inside* the expression: at x = 18 both squares are
about 1.1e15, so the computed difference carries roughly 0.25 of rounding dust while
the true answer is 1. Zero sits inside the dust.

Measuring that dust by perturbing x and watching the difference move does work in
principle. The version of it that finally passed the cosh case also reported
`tan(x) = 2` and `exp(x) = 2` as **identities** — which would have made every
equation in the product vacuous. The behavioural baseline caught it within a minute,
and it was reverted rather than tuned.

**A predicate that cannot be validated is worse than a limit that can be stated.**
So it is written down as B15 in `docs/KNOWN-DEFECTS.md`, with the real fix direction:
have `evalAst` report the largest magnitude it passed through, and scale the
tolerance by that rather than by the result. That would also fix the same blind spot
in the singularity and root-residual tests.

### Also

`docs/TEST-SCRIPT.md` gains **§0e** for v2.40.0 and this release — the manual pass is
the one gate that cannot be automated here, and the bump script only rewrites the
title version, so the section had to be written. Every item names what the old
behaviour was, so a refusal gets checked as carefully as an answer.

The v2.40.0 changelog claimed 6,421 tests; the real figure was 6,425. Corrected —
a false number in the release notes is the same defect class as a false number in
the product.

6,425 tests across 212 files. All twelve QC gates pass.

## [2.40.0] — 2026-07-29 — Poles reported as roots, two tolerance bands, and an instrument to prove nothing else moved

The first batch from `docs/KNOWN-DEFECTS.md`, taken in the order that puts the
wrong numbers a student would write into a report at the front. Five defects
closed, each with its reproduction moved into a named test rather than merely
patched.

### An instrument first, because "no regressions" has to be checkable

Before changing any behaviour: a **committed behavioural baseline** over 300-odd
inputs spanning every branch of solve, integrate and differentiate
(`solveBaseline.test.ts`). It is not an oracle and does not claim any answer is
correct — the oracle tests do that. It claims the thing that was previously
unclaimable: **nothing changed that was not meant to change.**

This was not precautionary. v2.39.0 had already proved the hazard — tightening the
singularity scan silently began refusing five correct integrals, and 6,362 tests
noticed nothing, because no test asked "does this still answer what it used to
answer?" The baseline caught this round's regression within a minute of it being
written, and every intended change had to be justified line by line against it.

### A pole is not a root

`numericRealRoots` accepted any bracketed sign change, and its bisection exited on
interval width **or** on `|f| < 1e-13` — never requiring the residual to be small.
Across a pole the function also changes sign, from −∞ to +∞, so the interval duly
narrowed onto the pole and the pole was reported as a solution:

- `solveEquation("1/(x-2.25) = 0")` → root **2.25**, where the left-hand side
  evaluates to −1.1e12
- `solveEquation("x/(x-2.25) = 1")` → the same, residual −2.5e12
- `solveEquation("tan(x) = 2")` → **1176 "roots"**, alternating genuine solutions
  and asymptotes

`1/(x-2) = 0` returned nothing only by accident: the scan grid lands exactly on 2,
so the sign test is skipped. Move the pole off the grid and it reappeared — the
signature of a sampling artefact, not a fix.

A candidate now has to survive substitution, judged against the size of the
function nearby rather than an absolute constant — because a legitimately steep
crossing can have a residual that is not tiny, and demanding `|f| < 1e-13` outright
would have discarded real answers. `tan(x) = 2` now returns **588** roots, exactly
half of 1176: every asymptote gone, every real solution kept. That count is asserted
directly, because a guard that fixes false positives by throwing away true positives
is not a fix.

### Two tolerance bands where roots went missing

Both were absolute thresholds on quantities whose size is set by the coefficients,
so each created a **band** — inputs on either side worked, which is precisely why no
test found them.

- `0.0000000001*x^2 - 0.0001 = 0` returned the single root **1000**, labelled
  `exact (quadratic)`, for an equation with roots ±1000. The discriminant was
  4e-14 against a threshold of 1e-12. Half the answer, presented as certain.
- `0.0000000000001*x^2 - 1 = 0` returned **"no solution"** with the caveat "No
  value of the variable satisfies this equation." The roots are ±3162277.66.

The discriminant test is now relative to the coefficients it is built from, which
keeps it invariant under multiplying the equation through by a constant — an
operation that cannot change its roots.

### The regression this round introduced, and what it actually taught

Making the degree test relative looked like the same obvious fix and was wrong in a
new direction. Scaling by the **largest** coefficient meant `x - 1e300 = 0` compared
its x coefficient of 1 against 1e285, deleted it, and returned "no solution" for an
equation whose root is 1e300. A large constant term does not make the x term
negligible.

The conclusion is stronger than "use a relative tolerance": **"is this coefficient
zero" is not a question about magnitude at all.** Only an exact zero is zero, and
every threshold — absolute or relative — deletes a real root somewhere. `trimPoly`
now removes only exact zeros, which still collapses `x^2 + x = x^2 + 1` to a linear
equation, because subtracting two equal doubles gives exactly zero. Rounding dust
that survives cancellation is caveated instead of deleted, and that caveat was
itself narrowed after it fired on `x - 1e15 = 0` — a warning that appears on
ordinary input is a false message that teaches people to ignore the real ones.

### An identity is an identity

`(x-1)/(x-1) = 1` was reported as `numeric (transcendental)` with **4000 roots** —
"1000, 999.5, 999, …" — taking about 2.9 seconds. Same for `x/x = 1` and
`sin(x)/sin(x) = 1`. With the numerator normalising to zero, every grid point passed
`|f| < 1e-10` and the dedupe never fired against 0.5 spacing. The transcendental
branch now asks the question the polynomial branch already asked, and answers
"identity" in under a millisecond. It probes at irrational offsets, so a function
that merely has zeros *on* the grid — `sin(x) = 0`, `x^2 = 0` — is not mistaken for
one that is zero everywhere.

Related, and honest rather than fixed: `exp(x) = 0` has no solution, but exp
underflows to zero below about x = −745, so the scan still returns candidates out in
the underflow region. They now carry a warning that hundreds of roots arriving at
the scan's own grid spacing means "no reliable root found" rather than hundreds of
answers.

### Numbers were being rounded to six decimal places

`fmtNum` rounded to 6 dp, which silently destroys anything smaller than 1e-6:

- `x^2 - 1e-20 = 0` has roots ±1e-10 and printed **"[0, 0]"** — two identical roots
  for an equation with two distinct ones.
- `integrate("1/(x^2+x+1)", 0, 1).antiderivative` printed
  `1.154701*atan(1.154701*x + 0.57735)` where the coefficient is
  2/√3 = 1.1547005383792515. The `value` was exact; the closed form shown was not,
  and did not re-parse. Copying that expression out of the document — the whole
  point of showing it — gave a different function from the one integrated.

Now 12 significant figures. The printed antiderivative is tested by **round trip**:
re-parsed, evaluated at both limits, and required to reproduce the reported value.
A string comparison would have passed on any consistent rounding. Restored precision
was checked against external constants — √2 = 1.41421356237, *e* = 2.71828182846,
1/ln10 = 0.434294481903, the Omega constant 0.56714329041, the Dottie number
0.739085133216.

### Two tests that could not fail

Both beam-height tests parsed the declared height out of the very SVG they had just
generated, so a wrong height was compared against itself. They now assert against
`BEAM_CHART_SIZE` — the number the pane uses to reserve space in the document, and
until now referenced by **zero** test files, which is what the 336→346 squashed
figure was. A negative control confirms the new assertions catch a ±10, ±50, +200
and +1000 perturbation; before, all four passed.

6,425 tests across 212 files. All twelve QC gates pass.

## [2.39.1] — 2026-07-29 — The pole detector was refusing five correct integrals

A patch on v2.39.0, found by reviewing the fix rather than the feature — which is
the habit this project now keeps, because five rounds running have turned up
defects in the previous round's repairs.

**A zero of a denominator is not necessarily a pole.** The new structural detector
reported every real root of a denominator inside the interval without asking
whether the numerator vanished there too. `integrate("(x^2-1)/(x-1)", 0, 2)` is
**4** — the integrand *is* x + 1 and the singularity at x = 1 is removable — and it
came back refused. So did `x/x`, `(x-2)/(x-2)` and `(x^2-4)/(x-2)`. Trading a wrong
number for a refused correct one is a smaller harm than the −2 it replaced, not an
acceptable one.

The discriminator is cheap precisely because the structural search has already
established *where* to look, which is what a blind grid scan never knew: evaluate
the integrand either side of the candidate point. At a genuine pole of order n ≥ 1,
|f| grows like h⁻ⁿ, so shrinking h by 1e6 multiplies |f| by at least 1e6; at a
removable singularity |f| converges to its limit and the ratio is about 1. The
threshold is 1e3 — three orders of magnitude of daylight between the two cases,
which makes it a predicate with margin rather than a tolerance standing in for one.

Two further cases came from the *sampling* backstop applying different rules from
the structural search, so both now share one predicate:

- **An endpoint the integrand misses is not a reason to refuse.** `x/x` over [0, 2]
  is 2. The integrand is undefined at x = 0, which is the endpoint, and the
  structural branch already required strict interiority while the sampled branch
  did not.
- `(x^2-4)/(x-2)` over [0, 3] was refused because 129 evenly spaced samples land
  *exactly* on x = 2, where 0/0 is NaN. The integral is 10.5. The same grid
  alignment that hid a real pole in v2.39.0 manufactured a fake one here.

Every genuine case is still refused, and that is asserted directly rather than
assumed: `1/(x-1)`, `1/((x-1)^2)`, `tan(x)`, `1/(x-0.5)`, `1/(x^2-4)`, `sqrt(x)^2`
over [−1, 1] and `ln(x)` over [−1, 2].

### A guard for the examples we publish

`engineeringDocs.test.ts` checks that every `<code>` fragment in the help panel
round-trips through its real parser — and it structurally cannot catch this class,
because a now-refused integral parses perfectly. A guard that tightens a refusal
can therefore falsify a published worked example, and the landing page goes live
the moment it is pushed. The four integrals in `examples.ts` and `landing/*.html`
are now asserted to still produce their published values, along with the sentence
in the manual promising that `ln(x)` from −1 to 2 "has no integral, and it says so
rather than returning a number."

### Filed rather than fixed

`integrate("sin(x)/x", -1, 1)` should be ≈ 1.8921 and is refused. The detector
correctly identifies x = 0 as removable, but sinc has no antiderivative rule, so it
falls to adaptive Simpson whose first midpoint is exactly 0. Checked against both
v2.39.0 and the version before the detector was rebuilt — **both refuse it**, so
this is a pre-existing limitation rather than a regression, and it is an honest
refusal rather than a wrong number. Recorded as C0 in `docs/KNOWN-DEFECTS.md` with
the fix direction: the removability is already computed, it just is not handed to
the numeric path.

### Release plumbing

`package.ps1` now copies the built zips into `install/` as part of the same step
that builds them. Building to `release/` and copying by hand meant the published
download could sit a release behind while every automated version check passed,
because those checks read `install/`. Verified that the macOS `.command` files keep
mode 0755 through the copy — without the executable bit they cannot run at all, by
any route.

6,375 tests across 210 files, all green.

## [2.39.0] — 2026-07-29 — A negative area under a positive curve, and a figure of pure NaN

Four independent reviews reported at once — truss/circuit, control/pharmacokinetics,
CAS/chemistry, and a cross-cutting sweep for defect classes rather than modules.
Between them they found more than could responsibly be fixed in one release, so this
one takes the items that are **wrong numbers or crashes**, verifies each
reproduction before touching anything, and writes the rest down instead of
pretending it isn't there. The remainder is now in **`docs/KNOWN-DEFECTS.md`** with
the exact inputs, ranked by severity, and a fix direction for each — including
eleven that produce a wrong number today.

### A divergent integral no longer returns a number

`integrate("1/((x-1)^2)", 0, 2)` returned **−2**, method `"exact (symbolic)"`,
caveats **`[]`**. The integrand is strictly positive at every point of that
interval and the integral diverges to +∞, so this was not an imprecise answer — its
**sign was impossible**, and nothing in six rounds of review noticed.

The singularity scan had two independent blind spots, and both had to be understood
before it could be fixed:

- **Grid alignment.** It sampled `a + (b−a)·i/129`, so the pole at x = 1 in [0, 2]
  needs i = 64.5 and was never visited. The control that proves it: the *same pole*
  over [0, 2.58] lands on i = 50 and was caught. A pole that is visible over one
  interval and invisible over another is not a tolerance problem, and no threshold
  fixes it.
- **Structural invisibility.** `tan` has a pole at π/2, but `tan` is *finite at
  every representable double near π/2* — `Number.isFinite` is true at all 130
  samples no matter how the grid is spaced. `integrate("tan(x)", 0, 3)` returned
  0.01005… as exact. More sampling could never have found this one.

Poles are now located from the **structure** of the expression: real roots of a
polynomial denominator, verified by residual, plus the known pole sets of
tan/cot/sec/csc. Sampling is kept only as a backstop for domain errors — a square
root or logarithm of the wrong sign, which really are non-finite — and that backstop
now runs on two grids offset by an irrational fraction of a step, so nothing can
hide in the gaps of both.

Fixing only the symbolic path left the same wrong number reachable by another road:
`integrate("1/(x-0.5)", 0, 3)` finds no antiderivative rule, falls through to
adaptive Simpson, and Simpson stepped straight over the pole without sampling it —
returning a confident **5.0355** for a divergent integral. Its stock caveat about
singularities appears on *every* numeric integral, so it said nothing about that
one. Both paths now share the guard.

There is also an exact backstop, on the principle that the two lines of defence
should not share a failure mode: **an integrand that never changes sign cannot
integrate to the opposite sign.** That is a theorem with no tolerance in it, and it
catches precisely the failure that reaches a document.

Verified in both directions. All six divergent cases refuse; all fourteen
legitimate ones still return their exact values, including `1/((x−1)²)` over [2, 3]
= 0.5, where the pole is real but outside the interval — and `sin(x)` over [0, 4π],
where the sign test must *not* fire because the integral is genuinely zero. Cost is
under 5 ms per call.

### A pharmacokinetics figure made entirely of NaN

The PK report passed `yScale: "log"` to the plot renderer without calling
`dropForScales`, which `plot.ts` documents as mandatory for any caller using a
logarithmic axis. Plot mode calls it; this one did not.

In pharmacokinetics a zero concentration is not bad data — **the pre-dose sample is
zero by definition**, and a trailing below-limit-of-quantification sample is
reported as zero too. So `log(0) = −Infinity` became `Infinity/Infinity` became
`NaN`, and all nine points were emitted as `cy="NaN"`. The figure went into the
document with a blank body, no y-axis tick labels, and a perfectly plausible x
axis — beneath a numerically correct NCA report.

The report now drops unplottable points from the figure only, **says on the page how
many and why**, states that every number above uses the full data set, and emits no
figure at all rather than an empty one if nothing is left to draw.

Why this survived six rounds: the repo's two non-finite walkers recurse into
numbers, arrays and objects, and neither looks inside a **string** — so neither can
see an SVG. Nothing here had ever grepped generated markup. There is now a harness
that does, and it proves itself against the pre-fix figure before it is trusted to
report anything clean.

### A stable plant reported as marginally stable

`analyzeStability` set one tolerance from the largest pole magnitude — `1e-9 × max
|pole|` — so a fast pole set the yardstick for a slow one. For
`1/((s+1)(s+2)(s+1e10))` the two ordinary poles at −1 and −2 were measured against
a tolerance of **10**, and a plainly stable plant came back *"MARGINALLY STABLE — 2
poles on the imaginary axis"*, printed directly above a pole list where every pole
was tagged "(stable)". `timeResponse` then refuses to quote a final value.

The cross-check could not catch it: it compares only right-half-plane counts, and
both methods said zero, so they "agreed" while the verdict was wrong. This is the
same shape as the eigenvalue threshold fixed in `vibration.ts` last release — **a
tolerance relative to the largest element cannot answer a question about an
individual one.** Each pole and zero is now measured against its own magnitude,
with an absolute floor for a pole genuinely at the origin.

### A 130,000-row paste crashed the renderer

`Math.min(...xs)` passes every element as a separate function argument, and V8
throws past roughly 125,000 of them. Every textarea that takes a column of numbers
here is uncapped, and a 130,000-row spreadsheet column is an ordinary paste.

The failure is a **cliff, not a curve** — 100,000 values worked perfectly — so the
existing "large input" tests certified the bug. Twenty-eight sites reachable from a
paste now use a shared reduction (`lib/minmax.ts`), including the plot renderer
behind about 25 call sites, the data-insights engine, the FFT filter, the assay
fits and the sequence readers. The remaining spread sites in the repo are bounded by
structure — matrix order, pole count, polynomial degree — and were deliberately left
alone.

Its own test caught a semantic gap on the first run: `Math.min(0, −0)` is `−0`, and
a naive `v < m` reduction returns `+0`. The plot renderer divides by an axis span,
where `1/+0` and `1/−0` differ in sign, so a drop-in replacement that was subtly not
a drop-in replacement would have been its own new bug. Signed zero is now handled
explicitly and checked against `Math` directly.

### "Unknown variable a" about a variable defined on screen

The uncertainty parser matched numbers with the character class `[\d.eE+]+`, which
allows `+` but not `−`. So `a = 1e-3 ± 1e-4` failed the anchored match, the line was
**silently discarded**, and the pane then reported `Unknown variable "a"` — blaming
the formula for the parser's omission. `1e+3` worked, which is what made scientific
notation look supported. The same loose class accepted `1.2.3`, which `parseFloat`
quietly read as 1.2.

Widening the grammar fixed that and opened a new hole: `a = 5 ± -0.1` now *matched*,
and propagation squares sigma, so a negative uncertainty would have disappeared into
a plausible-looking answer. The old class rejected it only by accident. It is now
refused on purpose, with a message that says an uncertainty is a magnitude.

Two structural changes matter more than the character. The number grammar now lives
in one place (`lib/numgrammar.ts`) instead of being hand-written per module, which
retires an instance of the duplicated-constant class and lets `beam.ts` share it.
And the parser moved out of `taskpane.ts` into `lib/uncertaintyParse.ts` — **nothing
in this repo can import `taskpane.ts` in a test**, because it pulls in the Office.js
`Word` namespace, so every parser buried in that file is structurally unreachable by
the suite. That is why a one-character omission survived. It is now tested, and an
unreadable line is named rather than dropped in silence.

### Smaller, all verified before and after

- **`log10` threw an uncaught exception.** `derivFn` had cases for `log` and
  `log2` but not `log10`, which the parser and evaluator both accept.
  `differentiate("log10(x)")` threw *"No derivative rule"* straight out of the pane,
  and `integrate("log10(x)", 1, 2)` threw the same from the by-parts branch. It was
  the only such gap.
- **`0/0` simplified to `0`**, so `differentiate("x/0")`, `("0/0")` and
  `("(x+1)/0")` all reported the derivative as **0**. The fold now requires a
  denominator demonstrably non-zero, and a division by literal zero anywhere in the
  expression carries a caveat saying the result shown is not a number — a
  non-answer must not be presented as an answer.
- **A NaN root labelled `exact (linear)`.** `solveEquation("x/0 = 1")` returned
  roots `["NaN"]`. `polyCoeffs` divided by a zero constant, producing `[NaN,
  Infinity]`. The parser deliberately refuses the identifiers `NaN` and `Infinity`
  and the literal `1e999` to prevent exactly this; arithmetic division by zero
  walked past both defences.
- **An impossible formula validated clean.** `validateFormula("H0")` returned
  `valid: true` with a molar mass of 0 and a Hill formula of `"H0"`; `"C0H4"`
  likewise. A subscript of zero is a typo, not chemistry, and certifying it is worse
  than refusing it.
- **Ground-node aliases were case-sensitive.** `V1 1 Gnd 5 / R1 1 0 1k` gave
  **V(1) = 0 V, V(Gnd) = −5 V** — exact, unique, and wrong, because `Gnd` was
  treated as an ordinary node. `gnd`, `GND` and `ground` worked; `Gnd`, `Ground` and
  `GROUND` did not.
- **A zero-henry inductor or zero-farad capacitor** returned `ok: true` with
  all-NaN node voltages, printed as "not finite" and still insertable. Rejected at
  parse now.
- **A capacitor counted as a DC path to ground**, defeating the flagship refusal in
  the module's own header.
- One method string for one outcome: a domain error and a pole both mean the
  integral does not exist, and having two names for that was a distinction about the
  *cause* dressed up as a distinction about the *result*. The cause is in the
  caveat, where it is stated explicitly and never guessed.

### Two tests that could not fail

- The `sqrt(x)^2` domain-widening tests asserted only that the formal value "no
  longer arrives bare" — a caveat beside a number. That is now a refusal: `sqrt(x)`
  is undefined on half of [−1, 1], so there is no integral, and a caveated number is
  still a number in the document.
- Recorded in `docs/KNOWN-DEFECTS.md` rather than fixed: both beam-chart height
  tests parse the height out of the SVG they just generated, so they cannot fail.
  Proved by rewriting the declared height by +10, +50, +200 and +1000 — the exact
  change that caused the 336→346 bug — and watching all four still pass.

6,362 tests across 210 files, all green.

## [2.38.0] — 2026-07-29 — Two wrong statistical verdicts, and eight more from the stats engines

A deep round aimed at engines never independently reviewed. Five passes launched;
four died to repeated API failures, and the one that finished — the statistics
engines — returned the best-evidenced report of the exercise, every finding
anchored to a published authority rather than to the code. Two changed
significance verdicts.

### The log-rank test used the wrong statistic

It returned the Pearson form, sum (O-E)^2/E, where the log-rank statistic is
(O1-E1)^2/V. **V was already being computed** — accumulated for the Peto hazard
ratio, then not used for the test it belongs to.

Checked against the Freireich 6-MP leukaemia trial (Klein & Moeschberger Ex 7.2;
R's `survdiff` help page): published chi-square = 16.79, p = 4.17e-05. The
observed and expected counts already matched the literature exactly — [21, 9] and
[10.749, 19.251] — while the statistic came out 15.23, p = 9.50e-05. Only the
denominator was wrong.

The Pearson form is conservative by roughly 10%, enough to cross alpha: a dataset
reported p = 0.0557 (not significant) where the correct answer is 0.0447
(significant). For k > 2 the exact statistic needs the full covariance matrix of
O - E, which this accumulation does not carry, so that case keeps the
approximation and now SAYS it is one.

### Tukey HSD was unusable above about df = 1000, and anti-conservative

The outer quadrature pinned its lower limit at 1e-6 and moved only the upper one,
while the integrand's peak narrows like 1/sqrt(2*df). At large df the whole peak
fell between two of the 72 fixed nodes, and the CDF stopped being monotone in df —
swinging 0.914 → 0.897 → 0.862 → 0.998 around a true 0.914.

Against this file's OWN anchor, the theorem q(a, 2, df) = sqrt(2)*t(a, df), which
had apparently never been swept past df ≈ 500: 9.7% error at df = 3000, 22.7% at
4999, and at df = 4000 bisection hit its ceiling and returned **30**, after which
nothing can ever be significant. At alpha = 0.01 the error ran the other way,
19% LOW, which manufactures false positives. Reachable from the pane with three
groups of ~1350, where the p-value and the significance flag — computed by
different routes — disagreed outright.

The window now follows the peak, so the step is a fixed fraction of the peak width
at every df: within 0.05% from df = 2 to 19000, and monotone.

**The first attempt at that fix is the more useful lesson.** Raising the node
count to 20 per standard deviation was correct to 1e-7 and took **3 to 4.5 seconds
per uncached call** — a frozen Word in a pane that recomputes on every keystroke.
Trading a wrong number for a hang is the worse bargain. The node count was never
the problem; the centring was.

### Eight more from the same pass

- **`logRankTest` validated nothing** while `kaplanMeier`, twenty lines above in
  the same file, validated everything — the asymmetry within one file is what makes
  it an oversight. Worst case: 1/2 event coding (the SPSS/SAS convention) was read
  as "2 is not 1, so censored", **inverting the events**. The same data gave
  p = 0.487 coded 1/2 and p = 0.810 coded 0/1, with no warning either way.
- **`chiSquareP` returned exactly 0** for small p — `1 - gammp(...)` where the
  continued-fraction branch had already formed `1 - q`, annihilating q below
  ~1e-16. chiSquareP(100, 1) gave 0 where the answer is 1.5e-23.
- **Goodness of fit accepted mismatched totals** — observed summing to 60 against
  expected summing to 6 returned chi-square = 486 without complaint. Entering
  proportions in a counts field is the obvious user error.
- **`describe()` threw `RangeError`** past ~130,000 values, from `Math.min(...xs)`
  spreading every value as an argument. 100,000 worked, so it looked fine.
- **Least squares was not scale-equivariant** — predictors scaled by 1e-12 solved
  and by 1e-13 were refused as "collinear", a refusal also factually wrong about
  the data. A relative pivot test alone cannot fix it, because the O(1) intercept
  column makes a legitimately tiny column look rank-deficient; the design matrix is
  now column-equilibrated and the coefficients scaled back.
- **The rank tests ranked NaN.** The comparator returns NaN for a NaN, leaving the
  sort order unspecified, so `mannWhitneyU([1,2,NaN,4],[5,6,7,8])` reported
  p = 0.030, "significant", out of noise. `rankWithTies` exists in TWO files, and
  guarding one left the other still doing it.
- **`twoWayAnova`'s docstring claimed it threw for unbalanced designs.** It checked
  cell size but never row length, so a ragged design returned F = NaN with a wrong
  total df and no complaint. Now it throws, as advertised.
- **`probit`'s docstring claimed a Halley refinement and 1e-15 accuracy.** No
  refinement exists in the body; measured error is 8e-10.
- **Kaplan-Meier with no events** reported S = 1 with a zero-width interval. S = 1
  is correct and Greenwood is legitimately zero, so the numbers stay — but [1, 1]
  read as certainty bought by three censored subjects, and now carries a caveat.

### Reachability

An audit of all 639 exported library functions against every use in `src/`,
counting names rather than import edges so dynamic imports are covered. **Zero
broken wiring** — no pane feature is unable to reach its engine, so the failure
recorded at v2.19 is not currently present.

It found 26 exports dead everywhere, 20 with tests: seven finance calculations, an
entire six-function 3D transform set, and a substrate-inhibition model the pane
*names* in a diagnostic while offering no way to fit it. Unsurfaced capability
rather than defects, so nothing was deleted;
`reachability.adversarial.test.ts` ratchets the count so the pile cannot grow.

### Testing

`statsAuthorities.test.ts` pins each fix to something outside the code — the
Freireich trial, the sqrt(2)*t theorem, published chi-square quantiles, and
scale-equivariance as an identity. Not one expectation recomputes the answer the
way the implementation does.

## [2.37.5] — 2026-07-29 — Round four: a squashed figure, a deleted mode, a fast path never exact

Recorded here late — this release shipped with its detail in the commit message
and no CHANGELOG entry, which is exactly the documentation rot the previous two
releases were about.

- **Every inserted beam figure was squashed 2.9% vertically.** The chart's height
  went 336 → 342 → 346 across three releases while the pane declared `h: 336` as a
  literal. Nothing was clipped, so nothing looked broken. The geometry test could
  not catch it: it parses `height=` out of the SVG it just generated, so it is
  self-consistent at any value. The size is now exported rather than re-typed.
- **A genuine vibration mode was still being deleted** at ordinary engineering
  numbers — two 10-tonne floors plus a 0.1 mg sensor die reported [0, 0, 1e8]
  against a truth of 6.3 and 17.3 rad/s, with the static case refused and both
  real resonances missed. Tightening the tolerance twice had not worked because
  lambda_min/lambda_max carries no rank information: "is K singular" is a question
  about K, now answered by a Cholesky factorisation. **When you tune a threshold
  twice, the predicate is wrong.**
- **`qToNumber`'s fast path was never correctly rounded** — 1 to 2 ULP in roughly
  a third of cases, making the exact-rational pipeline LESS accurate than the
  naive parse it exists to improve on. Now taken only where it is provably exact.
- **One idiom, six places.** Having hit "square before dividing or rooting" three
  times, a sweep found three more, including `eigenvaluesGeneral` *throwing* on a
  matrix whose entries and eigenvalues are both perfectly representable.
- And three defects in the previous round's own tests: an exact verifier
  structurally blind to both bugs it replaced, a hang detector timing a code path
  that early-exits, and a committed probe file of `console.log` with no assertions.

## [2.37.4] — 2026-07-29 — Round three: the reviews reviewed the repairs

Three more independent passes, this time over the code written the same day to
repair round two. They found defects in every area again, including two in a
release that had shipped hours earlier and one in the guard written to prevent
documentation rot.

### A genuine mode was being deleted and announced as a rigid-body mode

`modalAnalysis` decided "is this eigenvalue zero?" with a tolerance of 1e-9
relative to the LARGEST eigenvalue — about seven orders looser than the rounding
of the eigensolve itself. Any structure whose eigenvalue spread exceeded 1e9 had
its lowest genuine mode zeroed, and the zero is not a label: it replaces the
frequency.

The input is not exotic. 1000 kg on a soft mount carrying a 1 g part on a stiff
spring, stiffness matrix plainly positive definite, true frequencies 1.0 and
1e5 rad/s. The engine reported **0 and 1e5**, told the user *"that is a
RIGID-BODY MODE… a support is missing"*, **refused the static case outright**, and
was **3x wrong at a mundane 0.5 rad/s** (4.00 against 1.33). All 146 vibration
tests passed against it.

Now 1e-12 — four orders above rounding, so a genuinely singular stiffness matrix
is still caught — plus a note when the spread is wide enough that the lowest
frequency is near the limit of what double precision can separate from zero.
Verified against the exact static answer K⁻¹F and against an independent product
of eigenvalues, det(K)/det(M).

### Smith's algorithm had turned a refusal into a silent zero

The round-two repair fixed overflow in the complex division and introduced a new
way to be wrong: when `wn² - ω²` overflows, Smith's returns **-0**, so the
finiteness guard never fires. `F = 1e300` at `omega = 1e160` has the perfectly
representable answer 1e-20 and came back as **amplitude 0** with a contribution
reading `force: 1e300, amplitude: 0` — the same self-contradiction the `isNodal`
repair in that very commit was written to remove, one branch over. The
denominator is now formed in scaled units so the squares cannot overflow at all.

### The exact-to-double conversion, third time

Two findings, and the second is about method rather than code.

- It was **not correctly rounded**. Always carrying exactly 64 bits of quotient
  means the BigInt division floors and `Number()` then rounds again — two
  roundings, so up to 1 ULP off. In the subnormal range 1 ULP is a 20-100%
  relative error, and one ratio returned **0 where the answer is MIN_VALUE**. The
  shift is now chosen from the RESULT's exponent, so the division lands on the
  double grid and is rounded once, half-to-even, in the right place.
- **The "independent reference" that certified it was a line-for-line copy of the
  implementation.** It was labelled "Independent reference" and carried a comment
  claiming it had been validated first. Every assertion against it was a
  tautology — and it is what certified the version that was not correctly
  rounded. That is precisely the failure this project's own v2.37.1 commit
  message describes: *an oracle of self-consistency cannot detect a consistent
  error.* Knowing the rule did not prevent committing it.

  The replacement does not recompute the answer at all. It **verifies** one in
  exact integer arithmetic: a double is correct exactly when no neighbouring
  double is closer. That cannot drift into agreeing with the code. It also
  rejects a known-good value's neighbour, so it cannot pass vacuously.

  Also corrected: the docstring's flagship example (3^1237 / 5^233) was not in
  the band it was offered as evidence for — its gap is 1419 bits and its value
  about 1e427, genuinely infinite. Replaced with one that is real.

### The EI-dependence check was doubling every elastic beam

The twin solve added in v2.37.1 ran the FULL analysis — several hundred sampling
sweeps for the shear, moment and deflection extremes — and read exactly one thing
from it: the reactions. Measured at ×1.75 to ×2.2, up to 63 seconds at the
module's own maximum supports and loads, in a pane that recomputes on every
keystroke. The probe now stops immediately after the reactions: 8 ms against a
1758 ms solve, down from doubling it. Its stub throws rather than returning
plausible zeros, so a probe result can never be mistaken for an answer.

### The figure, again

- `NaN` still reached the SVG at `settle` between 1e295 and 1e308, **including at
  the repo's own standard test EI**. The round-two fix guarded the sample values
  but not the SCALE derived from them: a surviving sample within 12% of
  MAX_VALUE sends `lo - pad` to -Infinity and the ratio to NaN. Both `drawPanel`
  and `annotate` now guard it — fixing only the first still left `y1="NaN"`.
- **The v2.37.1 test that was supposed to catch this sampled only `settle=1e400`**,
  which passes for the wrong reason: everything overflows, so the panel bails
  cleanly. A green test certifying a band it does not sample — the same shape as
  the qToNumber band the same release's commit message was written about.
- The "cannot draw this" bail counted SAMPLES, not distinct x. The sampler emits
  the right-hand end more than once, so two coincident points satisfied it and
  the panel drew a single dot at the edge with no notice — beside a reported peak
  of 0 while the true shear was infinite.
- The settlement label still ran off the viewBox: a fixed 34 px allowance against
  labels reaching 38 px, and the previous test sampled x in {0,1,4,7,8} and
  stepped over the band where it happens.
- A lone pin was told *"Add a pin or a fixed support"*.

### The documentation guard was defeatable six ways

Written last release to prevent doc rot, and an independent pass made the
documentation wrong six different ways while it stayed green. Every hole was a
general trap: a count regex that required adjacency (so "19 financial
calculators" was invisible, and invisible *silently*); a Map keyed by name, so a
stale count ABOVE a correct one was overwritten; a HARDCODED discipline list in
the check whose own comment boasted about avoiding hardcoded lists; and a
haystack that included `taskpane.ts`, so a **code comment** satisfied a
**documentation** check.

Rewritten to four rules: documentation is prose and source files are not
searched; every occurrence is judged, never the last; an unattributable quantity
is a failure rather than a skip; nothing is hardcoded that can be derived. All
six mutations plus three controls now fail the guard, checked by replaying them.

## [2.37.3] — 2026-07-29 — A guard for the documentation, and a count it immediately caught

v2.37.2 fixed seven stale documentation surfaces by hand. This adds the gate that
would have caught them, and it found an eighth on its first run.

### Finance had been claiming 18 calculators; it ships 19

`FIN_CALCS` has nineteen entries. README.md and FEATURES.md said eighteen. Nobody
had counted them since the nineteenth was added, and nothing checked.

This was found by accident: the guard was written for Engineering, flagged the
Finance numbers as disagreeing, and chasing that down turned up a real error. So
the guard now covers **all five calculator registries** — Finance, Stats,
Analyze, Engineering and Bio/Assay — rather than the one it was written for. A
check that finds bugs in its neighbours and then gets taught to ignore them has
learned the wrong lesson.

### What the guard checks, and what it deliberately does not

Two things, both **derived from source** so they grow on their own. A hardcoded
list is exactly how `unbounded.adversarial.test.ts` came to cover none of the
exports added after it was written, and repeating that in the test built to
prevent it would have been a poor joke.

1. **Per-discipline calculator counts.** `<b>Vibration (4)</b>` on the manual and
   tool pages is checked against the number of `ENG_CALCS` entries carrying that
   group. Both sides are structured data, so this is exact rather than a prose
   match — and it is what would have caught the 37th calculator shipping while
   the manual still said three.
2. **Every syntax the parser accepts is documented somewhere.** The option names
   are read out of `parseSupports` itself, and each must appear with its equals
   sign in the in-pane examples, the pane hint, or a web page. This is the one
   that would have caught `k=` and `settle=` shipping undocumented for three
   releases: no count changed, so a count guard alone could never have seen it.
   Aliases (`spring=`, `stiffness=`, `settlement=`) are exempt — an alias helps
   someone who already knows the option exists.

Not checked: prose. A test asserting a page contains the words "modal
superposition" fails the first time someone improves a sentence, and a guard
people delete is worse than no guard.

### Watched to fail before being trusted

Each check was run against a deliberately broken payload: a wrong discipline
count on each page, a wrong total, and an option stripped from every document.
All four fired. A check nobody has seen fail is not evidence — the same reason
the Engineering audit self-tests its own predicates.

### One that bit while writing it

Building the guard through a shell heredoc turned `
` into a real newline and
`` into a literal 0x08 BACKSPACE inside a regex — the identical damage that
once shipped the Alexander polynomial unreachable for a release. It failed to
compile this time, which is luck rather than process; the repair went through a
script file instead, and `controlchars.adversarial.test.ts` confirms the byte is
gone.

## [2.37.2] — 2026-07-29 — The documentation catches up with the code

Three releases of engineering work had landed with only FEATURES.md and half the
manual describing it. An audit across every documentation surface found seven
stale ones, and — the part that matters — **two honest-limits statements that had
become false**.

### The limits statements were wrong, which is the worst kind of stale

The tool page carried "indeterminate reactions assume **rigid supports**" and
"free and forced vibration are **single-degree-of-freedom**". Both were true when
written and both stopped being true in v2.36.0. A limits section that overstates
a limit is not merely out of date: it is the page a careful user reads precisely
*because* they want to know what the tool cannot do, and it was telling them to
avoid something that works.

Now: supports may be rigid, elastic or settling, with the elastic and settling
cases needing EI and their EI-dependence **checked by re-solving rather than
asserted**; and free vibration is single-DOF while forced response covers both,
the multi-DOF case by modal superposition, which assumes classical damping — a
caveat that did not exist before and now does.

### Everything else that was behind

- **landing/index.html** — elastic and settling supports, multi-DOF forced
  response, and exact fractions in the Engineering section.
- **landing/science.html** — the Engineering card named neither new capability.
- **landing/tool.html** — the Structural entry now covers elastic/settling
  supports and fractions; Vibration went from "(3)" to "(4)" with the modal
  breakdown, the every-frequency-is-a-resonance point and the node-excitation
  lever described.
- **landing/manual.html** — a full multi-DOF forced-response paragraph, and
  fractions alongside the exactness paragraph where they belong.
- **README.md** — the Engineering row.
- **ROADMAP.md** — the status section stopped at v1.99.0; it now records
  v2.36.0–v2.37.1 including the truss proof and the three rounds of independent
  review.

### Checked and deliberately left alone

`docs/USER_GUIDE.md`, `docs/CAPABILITIES.md` and `docs/QUICK-SHEET.md` are
pointers to the web manual rather than duplicates — which is why they could not
go stale, and why they are still correct. That is the right shape for them and
they were not touched.

## [2.37.1] — 2026-07-29 — Bugs in the bug fixes

Three independent reviews, one per area, over code written EARLIER THE SAME DAY
to repair earlier bugs. None of those repairs had been independently reviewed,
and a fix is exactly as likely to be wrong as the original. They found twelve
real defects. The pattern is the finding: every round of this has caught
something, and the things caught are never in the part the author was thinking
hardest about.

### The exact-to-double conversion was still wrong, in a band

`qToNumber`'s repair shifted both sides right until the SMALLER had ~64 bits.
That preserves the ratio but leaves the LARGER side with `gap + 64` bits, so it
still overflowed once the gap exceeded ~960 — while a double does not run out
until 1024. A band, gaps 961 to 1023, returned **Infinity for values as large as
6.9e307**, and the mirrored band returned **0** for everything from 1e-289 down
through the entire subnormal range. The docstring asserted the opposite, and its
stated reasoning was precisely the mechanism of the defect.

Being wrong in a BAND is worse than being wrong everywhere: the tests sampled
gap 0 and gap ~1300 and passed, straddling it. Now it divides first with BigInt
and scales by a power of two split in two halves, so neither factor overflows or
flushes at the extremes. Verified against a reference validated independently
first; zero slow-path mismatches over a wide coprime sweep.

Worth recording: the first attempt to REPRODUCE this failed, because `ratDiv`
reduces by gcd and collapsed the test cases into the fast path. The permanent
tests use coprime `3^a / 5^b` for that reason.

### Multi-DOF forced response

- **`isNodal` overflowed its own scale.** It formed `|phi| * |F|` before
  dividing; mode shapes are mass-normalised so `|phi| ~ 1/sqrt(m)`, and a light
  degree of freedom under a large load made that product Infinity — after which
  `|f| < 1e-12 * Infinity` is true of every finite f. A mode sitting exactly on
  an undamped resonance was reported as a NODE with **amplitude 0 while its
  generalised force was 1e307**. Now divides twice instead of multiplying.
- **The complex division squared both parts first.** `F = 1e300` at
  `omega = 1e150` has the elementary answer 1, and came back NaN — then refused
  with "use units that keep the numbers in a physical range", advice that could
  not help because the answer was representable throughout. Now uses Smith's
  algorithm.
- **`den2 === 0` tested a squared quantity**, so `zeta = 1e-200` underflowed and
  a mode the user HAD damped was refused as undamped. Now tests `re` and `im`.
- **`zeta` escaped the finiteness guard** and reached the pane as
  "ζ = not finite" presented as a success — the exact symptom the guard was added
  to prevent, one field over.
- **Under Rayleigh damping a rigid-body mode reported ζ = 0**, which reads as
  undamped although its coefficient is alpha and the answer used it; feeding
  those ratios back is a 1104% amplitude error. Now explained in a note, and the
  "damping you did not supply" note keys on the coefficient rather than the ratio.

### Beam warnings, and one that could not be caught by its own oracle

- The settlement-uncertainty warning fired on **spring-only** beams, asserting a
  settlement the user never entered.
- **The determinacy note overclaimed EI-dependence.** A three-support beam on a
  spring under an antisymmetric load has v = 0 at the spring by symmetry, so
  R = 0 there for every k and every EI — the reactions are bit-identical at
  EI = 1 and EI = 1e6 while the note called them "specific to the EI you
  entered". v2.36.1's stated criterion was "the warning must not contradict the
  note", and it met that criterion by making the warning agree with a note that
  was itself wrong. **An oracle of self-consistency cannot detect a consistent
  error.** The engine now re-solves at a different EI and compares the exact
  rationals, so the claim is measured rather than asserted.
- A concatenation seam, a message quoting a constraint that is not true
  ("no spaces inside the value" — spaces around a fraction slash are fine), and
  a warning branch that was unreachable.

### The figure

- The new support artwork **broke the panel budget**: the spring reached y = 80
  and the settlement label y = 94, where the shear panel starts — so the label
  was drawn over the shear diagram's title.
- A **heave drew a downward arrow** beside a label reading "-0.01".
- On the perfectly ordinary `roller 8` the label started at x = 410 in a 420-wide
  viewBox and was **clipped**.
- `beamChart` kept its own private copy of the naive `Number(n)/Number(d)`
  conversion — the one fixed in `cas.ts` — and a non-finite sample was written
  straight into the path as `L 46.0 -Infinity`, which is invalid SVG in the
  user's document. Both fixed; a panel that cannot be drawn now says so.
- The x-axis label was clipped off the bottom on **every** beam, including a
  plain rigid one.

### Testing

Three new files, 53 tests, plus an extension of the unbounded-loop guard — which
was a hardcoded list written from a one-off sweep and had never grown, so none of
this year's exports were in it. The new tests assert on parsed SVG COORDINATES
rather than on "did the markup change", because the previous chart tests asked
only the latter and all three drawing defects passed them.

## [2.37.0] — 2026-07-29 — Fractions in every beam field

The beam engine computes over exact rationals so that a third stays a third, and
until now `1/3` was the one notation it would not accept. Every numeric field
matched a decimal-only pattern and rejected fractions before `parseRatLiteral` —
which has always handled them — was ever reached. A support at *L*/3 had to be
typed `2.6666666667`, which puts a rounding error into the input of an exact
solver.

Now `roller 8/3`, `point 30 at 8/3`, `udl 7/2 from 1/3 to 16/3`, `moment 200/3 at
4/3`, `k=1/3`, `settle=1/400`, and the span and EI fields all take fractions. On
a 9 m span with a point load at `9/3`, the reactions come back exactly 20 and 10;
typed as a decimal they cannot.

This also closes an inconsistency between two engines sharing one CAS: the TRUSS
parser has always accepted fractions, because it tokenises and hands each token
straight to the shared parser. Only the beam fields stood in the way.

**One pattern, not five.** All five support and load patterns now interpolate a
single `NUM` constant, because five copies is how the fields drifted apart to
begin with. `parseRatLiteral` remains the single authority on what the text
MEANS; the pattern only decides where a number ends. So `1.5/3` is matched and
then refused with "is not a number" rather than being silently reinterpreted —
integer over integer is what the parser accepts, and `3/6` or `0.5` is
unambiguous.

**A false claim retired.** v2.36.0 shipped a comment saying fractions came along
with the shared parser "which the position and load fields simply gain". That was
false in every field, and was corrected to say so in v2.36.1. It is now true, and
`beamFractions.test.ts` pins the claim to the behaviour so the two cannot drift
apart again.

### What the independent bug hunt caught before this shipped

Widening the fields made the option stripper unsafe, and the failure was the
worst kind — a silent wrong answer. The stripper replaced each matched
`key=value` with a SPACE, and `NUM` tolerates whitespace around its slash, so
anything the value pattern could not swallow REJOINED the position across that
space:

    "roller 8 k=1/2/3"  ->  strip "k=1/2"  ->  "roller 8  /3"  ->  x = 8/3

No error, no warning: the support silently moved to a third of where it was
asked for, and on a two-support beam that flipped a reaction into uplift — 24 kN
down becoming 24 kN of uplift, with 72 kN at a roller the user never placed. The
same mechanism let an option sit INSIDE a position (`roller 8 k=1/2 /3`).

Rather than patch the cases, the part is now CUT IN TWO at the first `key=`. The
position is whatever precedes it and cannot be assembled from fragments on either
side, and the option region must consist entirely of options or the part is
refused. That also finally enforces what the docstring always claimed: options
come after the position, so `k=5 roller 8` is now refused rather than quietly
accepted.

Ruled out in the same pass, with measurements: no catastrophic backtracking
despite `NUM` appearing four times in the varying-load pattern (linear to 100k
characters, and the pre-existing decimal path is slower than the new fraction
one), no mis-segmentation across `/`, and no input that previously worked now
fails.

**Also fixed:** the new support error carried EM DASHES. Parser errors
short-circuit before the pane's `plainDashes` pass, so unlike a result line they
reach the document unconverted — caught by the Engineering audit, not by a unit
test.

## [2.36.1] — 2026-07-29 — What the bug test found

v2.36.0 shipped with 5,987 green tests, a full QC pass, and two adversarial
files. An INDEPENDENT bug hunt on the shipped diff then found seven real
defects. Recording why, because the reason is more useful than the fixes: the
adversarial files were written by the same author as the code, alongside it, and
they tested what the author thought was hard. Six of the seven sit outside that.

### The one that was a wrong number

**Rayleigh damping was silently wrong on any structure with a rigid-body mode.**
A damping RATIO cannot represent damping on a rigid-body mode: the modal
coefficient is 2*zeta*wn, so at wn = 0 it is zero whatever ratio you give, and
`rayleighDamping` duly returned 0. But C = alpha*M + beta*K gives that mode a
real coefficient of alpha. A free-free chain at the alpha = 0.6, beta = 0.002
printed in the pane's own hint came out **56% high in amplitude and 50 degrees
wrong in phase**; at alpha = 5 it was a factor of ten.

`modalForcedResponse` now accepts the Rayleigh pair directly and carries the
modal COEFFICIENT `alpha + beta*wn^2`, which is exact at wn = 0. Given ratios on
a structure with a rigid-body mode it still treats that mode as undamped —
unavoidable in that parameterisation — but now says so instead of passing it off.

**Why the shipped suite could not see it.** The 100-random-system property test
builds K as `mk(200, 100)`, adding 100 to every diagonal. Every system it can
generate is positive definite, so NOT ONE has a rigid-body mode. `rayleighDamping`
was checked against a direct complex solve in that very file, and the single case
it gets wrong was excluded by the generator's construction. A property test is
only as good as the property its generator can reach.

### The ones that returned NaN or refused arbitrarily

- **`ratToNumber` destroyed correct answers.** `Number(n)/Number(d)` converts the
  two sides independently, so a ratio whose halves each exceed ~1.8e308 became
  Infinity/Infinity = NaN. A beam reaction of exactly 15, held as a 604-digit
  over 603-digit rational, was reported as NaN — the exact solve was perfect and
  the final conversion threw it away. **This predates elastic supports**: it was
  reachable on the plain rigid-support path with a 1e308 distributed load. Both
  sides are now shifted right by the same number of bits until the smaller has
  ~64 left, which cannot change their ratio. A genuinely enormous ratio still
  returns Infinity, because that is the correct double for it.
- **A finite omega could still produce NaN** in the MDOF response: omega = 1e200
  squares past the double range, and the pane rendered the result as
  "DOF 1: not finite" while calling it a success. Now refused, naming the
  overflow.
- **"Is this mode excited?" depended on the units the load was typed in.** The
  test was an absolute 1e-12, so the same structure and the same load direction
  was called a node at f0 = 1e-12 and an unbounded resonance at f0 = 1e-11, and a
  genuinely nodal load flipped between accepted and refused with its float
  residue. It is now relative to |phi|*|F|, the largest the generalised force
  could be. Note that `1 + |F|` is NOT a fix — it leaves an absolute floor.

### The ones in what the user reads and sees

- **The most-read instruction in the beam module did not work.** The warning on
  every indeterminate rigid-support beam said to add `"settle 0.01"` — without
  the equals sign, which the parser rejects. A general test now feeds every piece
  of syntax any message quotes back through the parser.
- **The "NOT EI-free" warning contradicted the determinacy note above it.** It
  was gated on `eiCoupled` alone, so a DETERMINATE beam on a spring was told its
  reactions "scale with EI" while the same output said the spring "changes no
  reaction" — and the reactions were provably identical at EI = 1 and EI = 1e6.
  `eiCoupled` is honest about the SOLVE; it does not license that claim about the
  RESULT. Now gated on `degree > 0 && eiCoupled`, with the true statement given
  in the determinate case.
- **A concatenation seam** rendered "on a rigid -support beam".
- **The figure inserted into the document drew a rigid support** for a spring or
  a settling one — byte-identical SVG. Springs now draw a coil on their own
  ground line and a settlement draws a dashed offset with its value written
  beside it.

### Testing

Three new files, 54 tests, aimed at what the originals structurally could not
reach: free-free structures, absurd-but-finite magnitudes, load scaling across
twelve orders of magnitude, and the rendered figure. Plus general guards — every
quoted syntax must parse, and no result may contradict itself about EI.

## [2.36.0] — 2026-07-29 — Two honest limits lifted, and one that provably cannot be

A review of the disclosed limits, and then the two that were worth acting on.
Most of that list turned out to be correct scoping rather than a to-do: no
design code, circular-only torsion and the perfect-column buckling load are the
same decision three times over — do not turn a theorem into a lookup table —
and the pharmacokinetic extrapolated-AUC fraction is a diagnostic the tool
already reports rather than a shortcoming.

### Beams: elastic and settling supports, still exact

Supports were rigid or nothing. Now `roller 8 k=5e4` sits one on a spring and
`roller 8 settle=0.01` sinks it by a known amount, downward positive.

This stays **exact over rationals**, which is the whole point of the beam
engine. A rigid support contributes the homogeneous condition v = 0, which is
why EI cancels out of every reaction. A spring contributes v = -R/k and a
settlement v = -delta; written in the EI·v the engine actually carries, those
are `EI·v + (EI/k)·R = 0` and `EI·v = -EI·delta`, so EI appears as a coefficient
on an unknown and as a right-hand-side term. Both stay affine in the unknowns
and rational, so the solve is unchanged in kind.

What changes is the CONTRACT, and it is stated rather than glossed: these beams
need EI, and their reactions are **not** EI-free. That is physics, not a
limitation — a stiffer beam really does draw more reaction out of a settling
support — but "reactions need no EI" is this module's headline property and it
is false here, so `eiCoupled` is on the result and every line that repeats the
old claim is guarded by it.

Two facts the tests pin, because they are the ones people get wrong:

- On a **determinate** beam, a spring and a settlement change **no reaction at
  all**. Equilibrium alone already fixed them; the beam simply moves. This is
  also the best available oracle for the new path, and it is checked as exact
  rational equality against the rigid-support answer.
- On an **indeterminate** beam they change everything, and the induced
  reactions scale **linearly with EI**. A propped cantilever with a settling
  prop reports exactly `3EI·delta/L^3`. That is a real load case and often the
  governing one, and it is also the least certain number in a design, since it
  scales with two estimates at once. The result says so.

`beam.ts` also stopped carrying its own decimal parser and now uses the CAS's
shared literal parser. The private one accepted plain decimals only, which was
invisible until a spring stiffness had to be written `k=5e4` — EI and support
stiffnesses are exactly the two quantities nobody types in full, so the new
option would have been unusable at the magnitudes it exists for.

### Vibration: forced response of a multi-degree-of-freedom system

The disclosed limit — free and forced vibration are single-degree-of-freedom —
was true, but it undersold what already shipped: `modalAnalysis` has been
multi-DOF for some time and returns **mass-normalised** mode shapes. That is
precisely the normalisation modal superposition needs, so the modal coordinates
decouple into n independent SDOF oscillators and the MDOF forced response is
the SDOF path run n times, not a new solver.

Reports amplitude and phase at every degree of freedom, plus the modal
breakdown, because which mode is carrying the response is the useful part:

- **Every** natural frequency is a resonance, not just the first. A run-up
  passes through all of them below the operating speed.
- A load applied at a **node** of a mode cannot excite that mode at all,
  however close the forcing sits to it. That is a real design lever, and also
  why a shaker in the wrong place can miss a mode entirely.
- Modal contributions can partially **cancel**, so the total is not the sum of
  the individual peaks, and a single-mode approximation is not always safe.

Damping is entered as **modal ratios** (or Rayleigh alpha/beta) rather than as a
damping matrix. That is deliberate: modal superposition requires the undamped
modes to diagonalise the damping too, which holds for damping proportional to M,
to K, or a combination — and does **not** hold for a single discrete damper
bolted between two floors, which is the everyday real case. Taking ratios makes
the assumption something the user states instead of something silently assumed
of a matrix they supplied, and it is repeated in the notes, because a violation
produces an answer that still looks entirely reasonable.

### The truss limit provably cannot be lifted exactly

Indeterminate trusses stay refused, and the reason is now a proof rather than a
preference. Parametrise the member unknown as `g = F·L^a`. Joint equilibrium
needs `a = -1` for rational coefficients — that is exactly the `f = F/L` change
of unknown the module already uses. Compatibility needs `2-a` even, so `a` even.
Those are incompatible, and scaling a compatibility row by L or L² only moves
the odd power of L to the right-hand side. Because joints share displacements
between members of different length, no per-member rescaling escapes it.

So a stiffness solve is exact only when **every** member length is rational, and
floating point otherwise. `truss.ts` opens with an essay on how it stays exact;
putting a silent float path inside it would change what the module is. That is a
product decision rather than an implementation detail, so it stays open.

### Also

- The Natural frequencies option labelled "Grounded at both ends" described a
  structure `chainSystem` does not build. It anchors spring 0 to ground and
  leaves the far end free — a grounded chain of n masses takes n springs — so it
  now reads "Anchored at one end, free at the other". Different stiffness
  matrix, different frequencies.

### Testing

Four new files, 92 tests, and none of them checks modal superposition against
modal superposition or the beam solve against itself:

- Beam oracles are closed forms (`3EI·delta/L^3`), plus limit checks that a
  stiffening spring converges on the rigid answer and a vanishing one on the
  unpropped cantilever.
- The beam adversarial pass attacks with **invariants** rather than more closed
  forms: equilibrium on nine support arrangements, **exact rational
  superposition** of load and settlement, the spring's own law `R = k·v` which
  the solve never asserts, and uniform settlement of a determinate beam being
  pure rigid-body motion.
- MDOF is checked against a **direct complex solve** of
  `(K - w²M + jwC)x = F` with `C = alpha·M + beta·K` built explicitly — no
  eigenvectors, no modal coordinates, no shared code — over **100 pseudo-random
  systems** from a seeded generator at six frequencies each.
- Degenerate cases that break code assuming distinct modes: repeated
  eigenvalues, non-diagonal (consistent) mass matrices, overdamped modes, and
  omega = 0 checked against the static answer K⁻¹F.

## [2.32.1] — 2026-07-28 — Hovering a calculation made it unreadable

Reported from real use: hovering a tool in the new Engineering panels turned the
text white on a near-white background.

`--hover` is defined **nowhere** in the stylesheet. `var(--hover, #f3f4f6)`
therefore used its fallback unconditionally — a hardcoded light grey — behind
text coloured by the theme. In Word's dark theme that is `--ink: #e6edf3` on
`#f3f4f6`: a contrast ratio of **1.07:1**, against 4.5:1 for readable body text.
In light mode it looked perfect, which is why it shipped.

Hover, headings and the selected row now use `--bg-soft` and `--ink`, the same
theme-aware pair the rest of the pane uses, and every colour is stated rather
than inherited through a `<details>` and a `<button>`.

The same scan found `background: var(--bg)` in two chip styles — also undefined,
also never erroring, just silently leaving those chips with no background at
all. Fixed to `--paper`.

### Two new gates, and two false starts worth recording

`cssVariables.test.ts` fails on any `var(--x)` whose `--x` is not defined
anywhere in the stylesheet — with or without a fallback, because a fallback for
a variable that does not exist is not defensive, it is a theme-blind constant.

The Engineering audit now measures **contrast in both themes** on the states a
user actually hits. Getting it honest took two attempts, both instructive:

1. The first version resolved `--bg-soft` and called that the hover colour. When
   the original bug was reintroduced as a negative control, **the check still
   passed** — it was testing an assumption about the CSS rather than the CSS.
   It now reads the real `:hover` rule out of `document.styleSheets` and
   resolves the declared value on a probe inside the panel.
2. That failed too, silently, twice over: `cssRules` throws SecurityError for a
   separate stylesheet on a `file://` page (the harness now inlines the CSS),
   and `background: var(--x)` is a shorthand containing a variable, which cannot
   be decomposed, so `style.backgroundColor` came back empty and read as "no
   such rule".

Verified by reintroducing the bug: the check reports `dark worst=1.07 at=hover
UNREADABLE` and stays quiet in light mode — the exact shape of what was
reported. A check nobody has watched fail is not evidence.

## [2.32.0] — 2026-07-28 — Engineering is panels, not a dropdown

Thirty-six calculations in one `<select>` is a scroll, not a menu. Grouping them
with `<optgroup>` in v2.31.5 made the list scannable but did not make it shorter,
and Engineering was the only mode in the add-in that asked anyone to drag through
a list taller than the pane.

Each discipline is now its own collapsible panel: Structural & solids, Fatigue &
machine design, Fluids, Thermal, Electronics, Control systems, Vibration,
Biomedical, Pharmacokinetics. Nine short headings, three to six calculations
each, and only the panel holding the current calculation starts open.

**The `<select>` is still there, hidden, as the selection's single source of
truth.** A panel button sets its value and fires `change`; it does not render
inputs itself. Input rendering, compute, insert, all the routing gates and the
headless audit therefore run through exactly the path they always did. Two
controls drift apart; a control and a state holder cannot. The highlight follows
the select rather than the click, so anything that moves the selection — a
restored session, the audit driving it directly — leaves the panels showing the
tool actually being computed.

Gated in the rendered DOM, not just the source: the audit counts nine panels
holding all 36 tools with exactly one open, then clicks the button for a tool in
the LAST panel — the one a dropdown made hardest to reach — and checks the
selection moved, the highlight moved, the panel opened and the fields rendered.

### QC could hang instead of finishing

Two QC runs stalled with no output and no verdict, which reads exactly like a
failure and was reported as one. `execFileSync` launches the headless browser
with no timeout, so a browser that never exits blocks the run forever. All four
browser-driven gates — landing layout, pane layout, render check, Engineering
audit — are now bounded at 180s with `SIGKILL`, so a hang reports as the
infrastructure error it is rather than as silence. A callback is not a bound and
neither is a subprocess; only a clock is.

## [2.31.9] — 2026-07-28 — The anchor after a figure, and a measurement that never was

> **Not yet confirmed.** No picture count has been taken with `.end` in place.
> The status line reports Word's own count, so the next frequency-response
> insert either reads "2 figures" or names what was dropped — and that result,
> when it exists, will be the first hard number in the sequence.

v2.31.8 restored the figure branch byte-for-byte to the version believed to
render both Bode plots. It still inserted one of two. That result is the useful
one, because it convicts the belief rather than the code.

**The "2 of 2" rung was never a measurement.** It was inferred from a remark
that two plots "are not aligned even though they are the same size", read as
proof both had been inserted. v2.31.0 predates the picture counter entirely, so
**the figure count at v2.31.0 is unknown** — not "was probably one". An earlier
draft of this entry guessed the remark was about the pane's preview; there is no
plot preview in the pane, and swapping one unverifiable explanation for another
is the same mistake twice. What can be said is that four releases were spent
reverting toward a state nobody had ever verified.

That leaves three measurements and one inference. Every other figure-bearing
report — beam, step response, all three pharmacokinetics tools, both vibration
tools — carries exactly ONE figure and has always worked. Frequency response is
the only report with two, and the only one that loses one. One figure never
chains an anchor; a second one does.

**The fix is one token, and it is corroborated rather than reasoned.**
`insertGallery` has shipped untouched for years, inserts N pictures in one loop
in one `Word.run`, and differs from the figure branch in exactly one place:

```
insertGallery:  anchor = para.getRange(Word.RangeLocation.end);    // N pictures
figure branch:  anchor = para.getRange(Word.RangeLocation.after);  // 2nd lost
```

It is not the only such site: the table-figure and structure inserts both take
their tail from a picture with `.end`, while the same routines chain `.after`
off ordinary text paragraphs. Three shipped sites, one rule.

The proposed reading is that chaining `.after` off a paragraph which CONTAINS an
inline picture does not yield a usable insertion point — Word accepts the next
picture against it and keeps nothing, without error — while text paragraphs
chain off `.after` perfectly well, which is why the prose in these reports always
landed and only figures went missing.

**Confirmed in real Word.** The frequency-response report now reads "2 figures"
on the status line, with both plots on the page — Word's own count, from
`document.body.inlinePictures` before and after, verified against what the user
could see. That is the first hard number in this whole sequence, and it is what
promotes the reading above from corroboration to a result.

An OOXML package upstream of the figures was the rival explanation and was set
aside, not disproven: the step-response report is a transfer-function equation
(hence `insertOoxml`) plus exactly one plot, and has never been reported to lose
it, while frequency response with the same upstream loses one of two. The
recorded OOXML failure mode is total downstream loss; what was actually seen is
the prose and the *first* figure landing. `flushRun`'s anchor is deliberately
left unchanged so that this release varies one token and stays measurable.

**Figure alignment is unchanged** — the picture still sits after caption text of
varying length, so stacked figures still start at different x. That is deferred
on purpose until the figures themselves are confirmed; bundling the cosmetic fix
with a structural one is what went wrong in v2.31.1.

Gated both ways: the figure branch must use `.end`, and a second test asserts
`insertGallery` still uses `.end` too — if the path this is modelled on ever
changes, the justification is stale and the suite should say so rather than keep
asserting a shape nothing corroborates.

Refuted and recorded, so none of it is rediscovered: that properties set on a
picture before its batch syncs are discarded with it (three shipped inserts do
exactly this); and that a sync between hops is the remedy — the cleanest single
variable in the whole episode, since beam carries one figure and no equation and
kept it until the release that added a sync per hop, which took it to none.

`InsertLocation.start` is **not** refuted, only never tested cleanly: the build
that measured 1 of 2 with it also had an OOXML package upstream, a sync in the
branch, and the `.after` chain. It remains a candidate for the alignment fix —
alone, on top of a confirmed 2 of 2, never bundled.

## [2.31.8] — 2026-07-28 — Back to the six lines that actually worked

The picture count from v2.31.7 said "Word kept 1 of 2 figures", which is the
first hard measurement in this whole sequence rather than an inference. It also
convicted the fix that release shipped.

v2.31.7 differed from the last version known to render both plots in TWO ways,
not one: the picture moved to `InsertLocation.start`, and a `context.sync()`
was left in the figure branch. The full ladder, every rung measured in real Word:

| Figure paragraph | Picture at | Sync in branch | Result |
|---|---|---|---|
| caption text — v2.31.0 | End | no | **2 of 2** |
| empty — v2.31.1 | End | no | 1 of 2 |
| empty — v2.31.4 | End | yes | 0 of 2, beam too |
| caption text — v2.31.7 | **Start** | yes | 1 of 2 |

Two independent things cost figures: creating the paragraph **empty**, and
**syncing inside the loop**. `InsertLocation.start` turned out to be a third.
Every sync added to this routine has cost figures and none has ever recovered
one, so the three added in v2.31.4 — in the figure branch, after the OOXML run
flush, and after a table — are all gone. The block loop no longer syncs at all;
what remains are the picture-count probes and the single closing sync.

The figure branch is now byte-for-byte v2.31.0, and pinned **as a whole** rather
than statement by statement, because every regression here came from adding one
more thing to a sequence that was already correct. Changing it now requires a
picture count proving the change.

**The alignment defect is deliberately back.** The picture sits after the caption
text, so two figures with captions of different lengths do not start at the same
x — the original complaint that set all of this off. Three structural attempts to
fix it have each cost figures. The next attempt must build figure and caption as
a single OOXML package, where layout is declared rather than assembled from
chained ranges, and must be proved against the picture count before shipping.
Figures that render beat figures that align.

## [2.31.7] — 2026-07-28 — The figures come back to the shape that worked

The Bode plots still did not arrive, and this time the pane said why it could
not tell: "inserted — 2 figures" beside a page containing none. That count was
the number of images successfully **rasterised**; it says nothing about what
Word kept, and from inside an add-in a stored picture and a discarded one look
identical — every call accepted, no error raised.

**Word is now the witness.** The document's inline pictures are counted before
and after the insert, and a disagreement is reported as an error naming both
numbers: "Word kept 0 of 2 figures." Nothing on the add-in side could establish
that; only the host can.

**The figure shape is reverted to v2.31.0.** What the evidence actually says:

| How the figure paragraph is made | Result |
|---|---|
| picture into the caption paragraph (has text) | 2 of 2 figures |
| picture into `insertParagraph("")` — v2.31.1 | 1 of 2 |
| ...plus a sync per hop — v2.31.4 | 0 of 2, and beam too |

The variable tracking the failure is **how the paragraph is created**, not when
it is synced. Each release moved further from the working shape and lost more.

The theory shipped in the previous draft of this release — that properties set
on a picture before its batch syncs are discarded along with the picture — is
**refuted by this codebase**: `insertSubstituentGallery`, the table-figure
insert and the structure insert all set width, height and alt-text in the same
unsynced batch, and all three have shipped and worked for many versions. It is
recorded here so it is not rediscovered.

The original complaint that began this — two Bode plots not lining up — is fixed
by **position rather than structure**: the picture goes at the *start* of the
caption paragraph, so every figure begins at the margin whatever its caption
says. A caption sharing the figure's line is worse typography than one on its
own; that is a cosmetic debt to repay once figures render again.

Measured rather than assumed: the payloads are 0.13–0.16 MB, nowhere near any
host limit, so size is **not** the cause. A byte budget was added anyway,
because the pixel budget bounds canvas memory rather than the base64 handed to
Word and the largest figures elsewhere are far bigger. It never triggers here.

Gates now pin the working shape — text-bearing paragraph, picture at start, one
sync — and deliberately pin that properties *may* be set in the same batch, so a
wrong diagnosis cannot return by imitation. Two of them were bounded by their
own syntax rather than a fixed byte window, after a comment pushed the scanned
code out of range twice; and they now strip comments, since this function is
documented with the exact code shapes it must not contain. One of these caught a
real defect in the revert itself: the caption was being inserted twice.

## [2.31.6] — 2026-07-28 — An insert that fails silently, and an update that could not arrive

Reported from real use: figures missing from inserted reports — beam diagrams
and Bode plots alike — and **nothing in the status area at all**. No error, no
success message, no way to tell whether the click had registered.

Two defects combine to produce exactly that, and the combination is what made it
undiagnosable rather than merely broken:

- `insertResultBlocks` guarded re-entry with a bare `return`. That was the only
  path through it producing no document content *and* no message. The
  plain-text path already announced this; the rich path swallowed it.
- `svgToPngBase64` settled only from `onload`/`onerror`. A host firing neither
  leaves the promise pending forever — awaited by an insert holding the
  **shared** `insertTextBusy` flag, which then never clears. Every later Insert
  anywhere in the product returns silently. A callback is not a bound; only a
  clock is, so rasterisation now times out after ten seconds and rejects with a
  message that names what happened.

Both silent guards now report. The success message names what actually went in
("Beam analysis inserted — 2 figures"), counted from the images that were really
rasterised rather than from the blocks that hoped to be, so the pane's belief is
checkable against the page at a glance. A report claiming a figure the document
does not show is Word declining the call — otherwise indistinguishable from the
outside, which is precisely how this cost a round of questions to localise.

Honest about scope: this does not prove the figures will now land. It makes the
failure *visible and unstickable*. If they are still missing, the status line
will now say what the pane believes it did.

### The update banner could not deliver an update

Separately, and found while chasing the above: GitHub Pages serves taskpane.html
with `Cache-Control: max-age=600`, and the banner's Reload button called
`window.location.reload()` — which re-serves that cached copy rather than
refetching. The cached HTML names the previous hashed bundle, so the pane
reloaded into the exact build it was already running. The banner was honest and
useless at once: correctly announcing an update it could not deliver, which is
worse than no banner because it tells the user the problem is handled.

Reload now navigates to a URL carrying the new version, which the cache has
never seen. A stale pane also self-heals once per session without waiting for
anyone to notice a green bar — guarded by a session flag, because if version.json
ever advertises a release the deployed bundle does not contain, an unguarded
auto-reload would spin forever inside a task pane with no address bar and no way
to stop it. Storage denied (private mode, a restrictive host) disables the
auto-reload rather than the guard: fail safe, never fail into a loop.

## [2.31.5] — 2026-07-28 — The Engineering menu is grouped by discipline

Thirty-six calculations in one flat dropdown is a scroll, not a menu — and they
were listed in the order they were built, which is meaningful to nobody. The
Calculation dropdown now carries nine `<optgroup>` headings: Structural &
solids, Fatigue & machine design, Fluids, Thermal, Electronics, Control systems,
Vibration, Biomedical, Pharmacokinetics.

Names lost the prefixes the headings now carry, so "Control: frequency response
& margins" is "Frequency response & margins" under "Control systems". That
matters more than it sounds in a 320px-wide task pane, where the old labels were
spending their first third repeating a word.

`<optgroup>` was the right tool over a second dropdown (doubles the clicks) or a
filter box (the right answer at 60+ tools, and useless to someone who does not
yet know what the thing is called). It costs no vertical space, keeps keyboard
type-ahead, and is announced by screen readers.

Gated on both sides, because a grouped menu can lose a tool in a way a flat one
could not — a calculation naming a heading the pane does not render is built,
routable, fully tested and invisible. Jest pins that every calc declares a group
in the rendered order, that no heading is empty, and that no two labels collide
now that they are shorter. The headless audit checks the DOM the browser
actually built: nine groups, 36 options inside them, none loose.

## [2.31.4] — 2026-07-28 — Only one of the two figures was being inserted

The frequency-response report inserted one Bode plot instead of two. Same root
cause as the missing paragraphs in v2.31.3, in a different place: **an anchor
chained off content Word has not materialised does not reliably give a usable
insertion point.**

Giving the caption its own paragraph in v2.31.1 added a second unsynced hop —
caption paragraph, then empty paragraph, then picture — and with two figures the
second one had nowhere valid to land. Every hop in the insert now syncs before
the next anchor is computed: after the OOXML run package, between a caption and
its figure, after a figure, and after a table. That costs a few round trips on a
one-shot user action and makes every anchor be computed against content that
actually exists.

Two gates added, pinning that the routine syncs between complex hops and that
the figure branch in particular syncs on both sides.

Worth recording plainly: this is the third defect in the same insert path found
by using the product, and none of the three was visible to 5,700 automated tests.
Everything here is Word API sequencing behaviour that only exists at runtime
inside Word. The gates can pin that the calls are present and ordered; they
cannot pin that Word does what the calls imply.

### An Engineering audit that drives the real pane

`scripts/engineering-audit.js` boots the production bundle in headless Chromium
and drives all 36 Engineering calculators: each one on its own defaults, then
with every field emptied, then with seven kinds of rubbish typed into every
field, then **actually clicking Insert** against a Word mock that records every
paragraph, package, picture, table and sync. It checks the recorded calls
against what the preview showed, parses every OOXML package rather than merely
counting equations in it, and clicks Insert twice to prove the busy guard
clears. It runs as part of `npm run qc`.

The audit found no defect in the 36 tools. It did find three defects in itself,
which is the part worth writing down: a missing `Word.RangeLocation` in the
Office stub made all 36 tools report inserting nothing; a missing `insertText`
on the mock made the 24 plain-text tools report the same; and reading the
recorded calls one tick after the click missed every figure, because rasterising
an SVG goes through an `Image` load and never finishes inside a microtask. Each
of those looked exactly like a product-wide catastrophe. So the audit now
self-tests every predicate against a payload built to trip it, and reports
itself broken before it reports anything about the product — a check nobody has
watched fail is not evidence.

What it still cannot do is stated in its own output: a mock always says yes. It
proves the pane attempts the right objects in the right order. It cannot prove
Word honours them, which is what actually broke all three times.

Suite 5,730 across 186 files, QC 10/10.

## [2.31.3] — 2026-07-28 — Only the formula was being inserted

v2.31.2 routed formula-only reports to the rich insert path. The equations then
appeared — and nothing else did.

`mathToOoxml` builds a COMPLETE flat-OPC document, and inserting one of those in
the middle of a sequence breaks the anchor chain: the range it returns is not a
usable insertion point for the paragraphs that follow, so every line after the
first equation silently failed to land. Because the transfer function is the
FIRST line of the poles/zeros report, the visible result was that only the
formula was inserted.

The fix is the pattern this codebase already had. `buildDerivationOoxml` exists
precisely because interleaving does not work: it puts every paragraph, prose and
equation alike, into a **single** package that is inserted once, and that is how
Solve inserts its derivations. Consecutive prose and formula lines are now
batched into one such package, and only genuinely different objects — pictures
and tables — break the run.

**The batching is deliberately narrow.** Only a run that actually contains a
typesetting formula goes in as a package; a run without one still inserts as
plain paragraphs, one at a time, exactly as before. That matters because
`insertParagraph` inherits the paragraph style at the cursor while an OOXML
package brings its own — so beam, cross-sections, stats and every other
figure-bearing tool insert byte-for-byte as they did, and only the reports that
genuinely need an equation take the different path.

Parseability is checked before building, so an expression that will not typeset
falls back to the readable text the tool wrote rather than to its own math
source — and an unparseable formula does not force the run onto the package
path either.

Five gates added: that prose and equations are batched rather than inserted per
line, that the run is flushed before every non-text block and once at the end,
and that a math block contributes to the batch rather than inserting a package
of its own, that a run with no formula still inserts as plain paragraphs, and
that only a formula which actually typesets switches the run to the package
path. One earlier gate was rewritten — it asserted the old per-line
architecture, which was the bug.

Suite 5,728 across 186 files, QC 10/10.

## [2.31.2] — 2026-07-28 — The equation insert was written but never reached

v2.31.1 added real Word equations for transfer functions. It did not work for
three of the five tools that emit them — including *Control: poles, zeros &
stability*, the one that prompted the change.

The insert path takes a rich branch (tables, pictures, equations) only when the
result contains a block that needs it, and that guard still tested for
`matrix` or `plot` only. A report made of prose and formulas but **no figure**
therefore fell straight through to the plain-text insert and put the caret form
into the document — with the equation code fully written, fully tested, and
never executed. Poles/zeros/stability, PID and filter design were all affected;
step response and Bode escaped only because they happen to contain a plot.

This is the "engine built, pane cannot reach it" failure this repo has hit
before, one layer further in: the *tool* was reachable, the *block kind* was
not. The guard is now driven by an explicit `RICH_KINDS` list, and four new
gates pin it — that the list names every non-text kind in the block union, that
the guard is driven by the list rather than a hand-written condition, that the
three formula-only tools really emit a math block, and that the math branch
builds an equation via OOXML rather than a paragraph.

Found by checking before answering a question about whether it worked, rather
than by any test. Worth recording: a source-scanning routing gate proves a tool
calls its engine; it does not prove the pane's dispatch will act on what that
engine returns.

Suite 5,723 across 186 files, QC 10/10.

## [2.31.1] — 2026-07-28 — Two fixes from the first real Word session

Both of these came from opening the add-in in Word rather than from any
automated gate, which is exactly the gap those gates cannot cover.

**Figures were not aligning with each other.** A figure's caption and its image
shared one paragraph, so the picture began *after* the caption text on the same
line — and two figures whose captions differ in length therefore started at
different horizontal positions, even at identical pixel sizes. It showed up most
obviously on the two stacked Bode plots, where the frequency axes visibly failed
to line up. The caption now gets its own paragraph and the figure its own, so a
figure always starts at the margin. This affected **every** multi-figure insert
in the product, not only the control tools.

**Inserted formulas were ASCII, not formulas.** A transfer function arrived in
the document as `G(s) = [ s^3 + 3s^2 + 2s + 1 ] / [ s^2 + 2s + 5 ]` — carets and
square brackets, not an equation. This is the same complaint that got Solve's
derivations converted from flat text to OMML, and the same machinery fixes it:
report lines can now be marked as **formulas**, which the pane typesets in the
preview and Word receives as a **real, editable equation**. Applied to every
transfer function in the control tools and the filter designer.

Two details that mattered in doing it. A fractional coefficient has to be
**parenthesised** in math syntax, because `1/2s^2` parses as 1/(2s^2) — a
different polynomial that still looks plausible — so `polyToMath` emits
`(1/2)s^2`. And the designed filter's coefficients are rationalised doubles whose
exact numerators run to sixteen digits, so those are shown as **decimals**, which
is the honest presentation of a coefficient that was never rational.

An expression that will not parse falls back to readable text rather than
failing the whole insert.

Suite 5,718 across 186 files, QC 10/10.

## [2.31.0] — 2026-07-28 — Electronics, fluids breadth and biomedical: the plan is finished

Nine new tools across five new engines, taking Engineering to **36 calculators**
and completing every item on the build-out plan.

**Electronics.** Op-amp circuits with the limits the ideal model hides — the
*noise* gain sets the bandwidth (so a unity-gain inverting stage is half as fast
as it looks), slew rate is a separate large-signal limit whose full-power
bandwidth is usually far below the small-signal one, and an ideal integrator
saturates on its own offset unless there is a DC feedback path. Analogue filter
design for Butterworth and Chebyshev, computing the minimum order from a
specification and emitting a **transfer function** the control tools consume
directly. And truth tables with **Quine-McCluskey** minimisation, which does not
run out at five variables the way a Karnaugh map does.

**Fluids breadth.** Open-channel flow by Manning, where the Froude number rather
than the discharge is the answer — it decides whether the channel is controlled
from upstream or downstream, and crossing Fr = 1 unintentionally gives a
hydraulic jump. Pump NPSH and cavitation, which is a failure mode rather than an
efficiency loss and is entirely a suction-side problem. And compressible flow
with choking.

**Biomedical.** Haemodynamics, where the fourth-power dependence of resistance on
radius means a 20% narrowing more than doubles it; joint biomechanics, where the
joint reaction force is larger than either the load or the muscle force and is
the number usually left out; and a sampling check, because aliasing is the one
failure in the module that cannot be undone afterwards.

**THE BUG THIS RELEASE FOUND, WHICH WAS NOT IN THE NEW CODE.** Cross-checking a
designed filter against the existing control analysis produced a disagreement: a
perfectly stable 8th-order Butterworth was reported as *marginally stable*. The
cause was in `control.ts`. A companion matrix built from a badly scaled
polynomial is badly conditioned, and this filter's coefficients span 10¹⁶ — so
the QR iteration returned **six of its eight roots as exactly zero**, which reads
as poles on the imaginary axis. `polyRoots` now balances the polynomial first,
substituting s = λ·u with λ the geometric mean root magnitude so the coefficients
are comparable and the roots are O(1), then scales the roots back. This was a
latent defect affecting **every** control analysis of a realistically scaled
plant, and it was only visible because two independently built tools were made to
agree with each other.

A parser bug in the new logic module was caught the same way: stripping
whitespace before tokenising turned `A AND B` into `AANDB`, which the identifier
matcher swallowed whole. The tokeniser now skips whitespace rather than removing
it.

Suite 5,714 across 186 files, QC 10/10.

## [2.30.0] — 2026-07-28 — Fatigue and machine design

Engineering gains three fatigue tools, taking it to twenty-seven calculators.
This is the natural successor to the stress engine: you compute a stress state,
and the next question is whether the part survives 10⁷ cycles.

**Every result is framed as an order of magnitude.** Fatigue life scatter is
enormous — identical specimens from the same bar, on the same machine, routinely
differ by a factor of three, and a factor of ten is not remarkable. This is the
most over-trusted calculation in mechanical engineering, so every life carries
that caveat and no result is quoted as though it were precise.

**The endurance limit does not exist for most materials**, which is the single
most useful thing this module says. Steel has a genuine knee in its S-N curve.
Aluminium, copper and magnesium do not — the curve keeps falling for ever, so
there is no stress below which the part is safe, and infinite-life design is
unavailable at any stress. Choosing a non-ferrous material class gets that
stated rather than a false infinite life.

**The Langer yield check runs alongside every fatigue criterion.** None of
Goodman, Soderberg, Gerber or the ASME ellipse knows anything about static
yield, so a state with a high mean stress can sit comfortably inside the Goodman
line and still yield on the very first application of load. The governing —
smaller — factor of safety is what gets reported, along with which of the two
governs. All four criteria are shown together, because they disagree by a lot
and that spread is the honest uncertainty in the method rather than an
invitation to pick the friendliest one.

**Compressive mean stress is treated as zero, not negative.** It closes cracks
and helps, which is the entire principle behind shot peening — but feeding a
negative mean into Goodman produces a factor of safety *above* the fully
reversed one, overstating the benefit. Zero is the standard conservative
treatment.

**Finite life and Palmgren-Miner cumulative damage** over a load spectrum, with
the caveat that matters: Miner takes no account of load ORDER, and observed
damage sums at failure scatter between roughly 0.3 and 3 rather than landing on
1. A sum of 0.9 is not a pass.

**Two things the adversarial pass surfaced.** The size factor can legitimately
exceed 1 — the fit is normalised at the 7.62 mm rotating-beam specimen the
endurance data came from, so a smaller section really does do better — which
made the corrected limit exceed the uncorrected one and looked exactly like a
bug. It is left as the method gives it rather than clamped, since clamping would
invent a conservatism the method does not have, but it is now explained where it
happens. And a state with zero alternating stress and a compressive mean gave an
infinite fatigue factor of safety, which would have printed as "not finite"; it
is now named as no fatigue loading, with the governing factor falling back to
the finite yield check.

**No material strength table**, for the same reason there are no steam tables:
Sut and Sy move by a factor of three with heat treatment for the same alloy
designation, so a table of typical values would be wrong for the specific piece
of steel in front of the reader. They are on the drawing; they are asked for.
The reliability factor, by contrast, *is* derived rather than tabulated — it is
defined as 1 − 0.08·z, so inverting the normal CDF gives any reliability
instead of forcing a choice among five.

Suite 5,470 across 183 files, QC 10/10.

## [2.29.0] — 2026-07-28 — Thermodynamics, and a property table that was quietly breaking the first law

Engineering gains three thermodynamics tools, taking it to twenty-four
calculators: ideal-gas processes, air-standard power cycles, and vapour cycles
with a Carnot check.

**Temperature is absolute everywhere, and it is enforced.** Every efficiency and
entropy in this module is a ratio of absolute temperatures. The Carnot bound
between 500 °C and 20 °C is 62% computed correctly and **96%** if the numbers go
in as they are written — a plausible, publishable, completely wrong figure, and
the single most common error in the subject. Each tool takes the temperature
unit explicitly, converts before anything is divided, and refuses a temperature
at or below absolute zero rather than dividing by it.

**All five ideal-gas processes are one polytropic family**, P·Vⁿ = constant with
n = 1, 0, ∞ and k. Deriving the work integral once means the four named
processes cannot disagree with each other, and it makes the n = 1 singularity
explicit — the isothermal case is the *limit* of the general formula, written as
its own branch rather than left to evaluate 0/0. Every result carries a first-law
check.

**Otto, Diesel and Brayton**, each compared against the Carnot bound between its
own extremes. At the *same* compression ratio Otto beats Diesel, which surprises
people — and the tool explains why Diesel wins in practice anyway: there is no
fuel in the cylinder during compression, so there is nothing to knock, so a much
higher compression ratio is available. Brayton efficiency depends only on
pressure ratio, and the pressure ratio that maximises *work per unit mass* is not
the one that maximises efficiency, which is why real turbines are sized where
they are.

**No steam tables, deliberately.** Rankine and vapour-compression cycles are
computed from enthalpies the reader looks up in their own property tables. A
saturated-water table reconstructed from memory would be plausible,
unverifiable, and wrong in the third digit somewhere nobody would check — and
this product's rule is that all data must be real. Doing the cycle arithmetic,
the back-work ratio and the energy balance on the reader's own data is honest and
is the workflow they already have.

**The bug the oracle tests found, which is the interesting one.** An isentropic
expansion was coming back with a non-zero heat — an apparent first-law violation
in the one process where Q is zero by construction. The cause was not the
algorithm: it was the **property table**. Air's usual handbook values cp = 1005,
cv = 718, R = 287, k = 1.4 are each rounded independently and are therefore
mutually inconsistent — R/(k−1) is 717.5, not 718. The work integral uses R and
k while the internal-energy change uses cv, so the two disagreed by 0.07% and the
result looked like physics. The table now stores only **cp and cv** and derives
R = cp − cv and k = cp/cv, which makes every identity exact by construction at
the cost of k reading 1.3997 for air rather than the rounded 1.4. That is the
better trade: the third decimal of k is not physically meaningful, and a
self-inconsistent property table produces errors that are indistinguishable from
real results.

The adversarial pass verifies Q = ΔU + W over 1,500 randomised combinations of
gas, process and end state, and checks that no cycle beats its own Carnot bound
across every gas and every ratio the module accepts.

Suite 5,385 across 181 files, QC 10/10.

## [2.28.0] — 2026-07-28 — Vibration, and the three results everyone gets wrong

Engineering gains three vibration tools, taking it to twenty-one calculators.
The module is built around the three results in this subject that are
counter-intuitive enough that getting them wrong is the normal outcome, and each
one is computed and stated rather than left to be remembered.

**Resonance is not at r = 1.** The magnification of a damped system peaks at
r = √(1−2ζ²), always *below* the natural frequency — and for ζ ≥ 1/√2 = 0.707
there is **no peak at all**: the response falls monotonically and no forcing
frequency can resonate the system. "Resonance at ω = ωₙ" is the undamped special
case, taught first and then never unlearned.

**Vibration isolation only begins above r = √2.** Transmissibility is exactly 1
at √2 *for every damping ratio*, and above 1 below it. So a mount that is not
soft enough does not isolate a little — it **amplifies**, and more force reaches
the foundation than if the machine had been bolted down. This is a design
failure that looks like a design.

**Damping helps below √2 and hurts above it.** More damping lowers the resonant
peak, which is why you want it while passing through resonance on run-up, and it
*raises* transmissibility in the isolation region, because the damper is itself
a path for force. "More damping is safer" is false in exactly the region
isolators are designed to work in.

**Free response and damping** — ωₙ, ζ, ωd, logarithmic decrement, and a plot.
Each damping regime uses its **own** closed form rather than one formula with a
tolerance: the critically damped solution is not the underdamped one evaluated
at ζ = 1, which divides by a damped frequency of zero. Two measured peak
amplitudes estimate ζ from a recorded trace, using the exact relation
ζ = δ/√(4π² + δ²) rather than the light-damping approximation δ/2π, which is
wrong by more than 1% above ζ ≈ 0.1. A trace whose amplitude *grows* is refused
and named: that is not a damped system, it is being driven or it is
self-excited.

**Natural frequencies and mode shapes** — from a chain of masses and springs, or
from the mass and stiffness matrices directly. Solved as a **symmetric**
generalised eigenproblem, K φ = ω²M φ, via a Cholesky transform to
L⁻¹KL⁻ᵀ. The lazy route — forming M⁻¹K and handing it to a general eigenvalue
routine — produces a matrix that is *not* symmetric even though the problem is,
discarding the guarantee that the eigenvalues are real and permitting complex
natural frequencies for a perfectly ordinary structure. Mode shapes come back
mass-normalised with a fixed sign convention. A **rigid-body mode** at zero
frequency is reported as the real feature it is, and a mass matrix that is not
positive definite is refused as unphysical — the Cholesky failure and the
modelling error are the same event.

**Testing.** The modal solver is checked against algebraic eigenvalues where
they exist — a one-end-grounded two-mass chain has eigenvalues (3∓√5)/2 · k/m —
and the adversarial pass substitutes **every** eigenpair back into K φ = ω²M φ
across five systems, so nothing about the transform, the normalisation or the
ordering can hide a wrong eigenvector. Orthogonality through the mass matrix is
verified on deliberately badly scaled systems (stiffnesses spanning six orders
of magnitude, which is a real modelling situation rather than a contrived one).

One test-side fix worth recording: an adversarial check was calling `expect()`
14,000 times inside a loop, which measured Jest rather than the engine and then
flaked against its own timing budget under parallel load. Failures are now
collected and asserted once — the same check, honest accounting.

Suite 5,291 across 179 files, QC 10/10.

## [2.27.0] — 2026-07-28 — Pharmacokinetics: where the engineering and life-science halves meet

Engineering gains three PK tools, taking it to eighteen calculators. This is the
one place the two halves of the product touch — the existing dose-response,
IC50 and enzyme-kinetics tools describe what a drug does at a concentration, and
these describe what concentration the patient actually has.

**Built on clearance and volume**, not on half-life. That is not a style choice:
CL and Vd are the physiologically independent quantities and half-life is a
consequence of both (t½ = ln2·Vd/CL). A renal-failure patient has a long
half-life because clearance fell; an obese patient can have one at completely
normal clearance because volume rose. Building on half-life hides that.

**Dose and concentration curve** — IV bolus, infusion or oral, with Cmax, Tmax,
AUC and a plot. AUC = Dose/CL, so total exposure is set by clearance alone and
not by volume; the infusion plateau is rate/CL, and volume only sets how quickly
you get there.

**Steady state and loading dose** — accumulation ratio, peak, trough, average and
fluctuation. The average depends **only** on dose rate and clearance, so halving
both the dose and the interval leaves it exactly where it was and only narrows
the swing. Time to steady state depends **only** on half-life, and a bigger
maintenance dose does not shorten it — which is what a loading dose is for, and
why the loading dose comes from the volume while the maintenance dose comes from
the clearance.

**Non-compartmental analysis** of real measured data — paste time/concentration
pairs and get λz, half-life, AUC, clearance, volume and MRT. Two things it does
that calculators usually skip: the terminal window is **chosen**, by trying every
window of at least three points and keeping the best *adjusted* R² (adjusted,
because plain R² improves automatically as points are added); and the
**percentage of AUC that came from extrapolation** is reported, because above
about 20% the study simply did not follow the drug long enough and every derived
parameter rests on an assumed exponential tail rather than on measurement.

**Flip-flop kinetics are detected**, which is the trap this module partly exists
for. Everyone reads an oral curve's terminal slope as elimination, and that is
only true when absorption is faster. When it is not — depot injections,
modified-release formulations, poorly soluble drugs — the terminal slope is the
**absorption** rate constant, the half-life read off it is the absorption
half-life, and everything derived from it is wrong. The curve looks completely
normal either way. Oral data is also reported as CL/F and Vz/F rather than
"clearance": without an IV reference bioavailability cannot be separated, and a
drug with 50% F would look as though it clears twice as fast as it does.

**What the adversarial pass found.** On an ultra-short-half-life drug —
adenosine is a real one — the trough underflows to exactly zero between doses and
the peak-to-trough ratio became `Infinity`, which would have printed as "not
finite" in a document. Infinity is not the answer there; the useful and true
statement is that the drug is completely eliminated before the next dose, so the
ratio is now reported as undefined with that explanation.

The routing gate also earned its keep: it flagged the PK fields as unread because
they went through a shared helper, so the wiring was invisible to it. Rather than
weaken the gate a second time, the reads were inlined — the gate's entire value
is that it can see each field being used.

Suite 5,192 across 177 files, QC 10/10.

## [2.26.0] — 2026-07-28 — Control systems: the course that was missing entirely

Engineering had no transfer functions at all — the one subject required across
mechanical, electrical, chemical *and* biomedical engineering. It has four new
tools, built on machinery that was already here: the exact rational arithmetic
from the CAS, the Francis QR eigenvalue solver from the linear algebra core, and
the plotting used by the Bode sweep in circuits.

**Poles, zeros and stability**, with the **exact** Routh-Hurwitz array. Routh is
a tabulation of differences of products, so it is precisely the algorithm where
a coefficient that is 1e-17 instead of 0 flips the verdict from stable to
unstable — and floating point is least reliable exactly at the stability
boundary, which is the only place anyone runs it. Over rationals it is exact.

**Stability is decided twice, and the two answers are compared.** The
right-half-plane pole count comes once from the exact tabulation and once from
the poles as eigenvalues of the companion matrix. These share no code and no
arithmetic, so agreement is real evidence rather than the same mistake twice.
**When they disagree, both are reported and neither is chosen** — a disagreement
means a pole sits so close to the imaginary axis that its computed real part is
untrustworthy, which is the most useful thing to be told and exactly the case a
single method answers confidently and wrongly.

**Step and impulse response** with damping ratio, natural frequency, overshoot,
rise, peak and settling time, plotted. For a genuine second-order system these
are exact identities; above that they come from the dominant pole pair and the
result *says so*, and says it louder when the next pole is less than five times
faster and the approximation stops holding. A zero near the dominant poles is
flagged, because the standard formulas know nothing about zeros and a nearby one
increases overshoot substantially.

**Frequency response and margins** — Bode magnitude and phase, gain and phase
margin. A margin that does not exist is reported as not existing: a first-order
lag's phase never reaches −180°, so its gain margin is infinite and any finite
number is wrong, including the value at the edge of whatever range was swept.

**PID and closed loop** — controller in series, loop closed, closed-loop poles,
stability, margins and transient. A right-half-plane zero is called out as
non-minimum-phase: the step response goes the *wrong way* first, and more gain
makes it worse rather than better.

**Three defects the tests found.** An oracle test that knew the gain margin
algebraically caught the margin bisection refining on the **unwrapped** phase —
evaluating one frequency in isolation restarts the unwrapping, so it read +179.9
where the swept value was −180.1 and walked away from the crossing; it now
refines on Im(G) = 0, which locates the same point with no phase bookkeeping to
get wrong. A P-only controller was reported *marginally stable*, because
Kp written as (Kd·s² + Kp·s)/s leaves a pole at the origin that the numerator's
own zero cancels; the cancellation is now done rather than left to produce a
wrong verdict. And the adversarial pass timed a step response at **2.4 seconds**
— the sub-step cap bounded memory but not total work, which in a pane that
recomputes per keystroke is a hang; a total-step budget now bounds the time.

Suite 5,083 across 175 files, QC 10/10.

## [2.25.0] — 2026-07-28 — One unit contract across Engineering, and the 10^12 trap it was hiding

Engineering had drifted into three different unit contracts. Beam, truss and
cross-sections said "consistent units, nothing converts". Column, torsion, pipe
flow and the heat tools said "strict SI" — **and then accepted whatever was
typed without checking**, which is the half that mattered. A declaration
enforces nothing.

**The trap that produced was inside the product.** The cross-section tool
reports I in mm⁴, because that is what every section table in the world prints.
The column tool wanted m⁴. So the single most natural workflow in the whole
section — size a section, paste its I into the buckling check — was wrong by a
factor of 10¹², and the answer looked entirely plausible. Nothing anywhere said
a word.

**The rule now, stated once and enforced by a test:** a tool converts units
unless it is dimensionally homogeneous (every input is the same kind of
quantity, so the answer comes back in whatever went in) or it computes over
exact rationals (where a conversion is a floating-point multiply that would
destroy the exactness that is the whole reason the engine exists). Either way
**every tool declares which branch it is on**, in its result.

So column, torsion, pipe flow, cross-sections and both heat tools now read every
field through the unit layer. A bare number is read in the unit the field names,
a unit you write is converted and the conversion is **reported back to you**,
and a unit of the wrong quantity is **refused by name** rather than silently
dropped. `200 GPa`, `1e6 mm^4`, `50 ksi`, `68 °F`, `15.7 L/s` and
`Mineral wool, 50 mm` all now work. Beam and truss deliberately still do not
convert, and now say why. The cross-section result additionally tells you to
carry A and I to the column tool **with their units**, which is where the trap
used to be.

**Parenthesised compound units are now accepted** — `W/(m^2*K)`, `kJ/(kg*K)` —
because that is how every engineering text writes a heat transfer coefficient
and how anyone will type it. It used to be rejected as "not a unit this
recognises", which reads as a typo rather than as unsupported notation. A
*nested* division inside a group (`a/(b/c)`) is refused rather than guessed at,
because the two readings differ by c² and picking one silently would be a wrong
answer wearing a unit.

**Why this could not regress anything.** Every one of those fields used to be
read with `Number()`. `parseMeasured` returns a bare number in the target unit
untouched, so a user who types plain numbers — the old contract — gets byte-identical
results. That invariant is now pinned directly across all 14 Engineering target
units rather than left as an argument, because if it ever broke, every
Engineering answer would change silently and no oracle test would notice: they
all pass bare numbers too.

Full suite green at 4,952 tests with no behaviour change to any existing case,
plus a 32-test adversarial pass on the parser covering half-typed input,
bracket soup, 50,000-character tokens and catastrophic-backtracking probes —
unit parsing runs on every keystroke, and a parser that hangs there is a frozen
Word, not a slow one.

## [2.24.0] — 2026-07-28 — Engineering becomes a full bench: stress, trusses, buckling, thermofluids

Engineering had four tools — beam, cross-section, DC circuit, AC circuit. It has
eleven. The new seven are the rest of an undergraduate engineering course, and
each one is built around the thing that is most often got wrong rather than
around the formula that is easiest to type.

**Stress state.** Principal stresses, principal angle, Mohr's circle, von Mises
and Tresca, and the factor of safety against a yield strength. It reports the
**absolute** maximum shear as well as the in-plane one and says when they differ:
for a biaxial state the zero out-of-plane principal stress lies outside the
in-plane pair, so the in-plane circle understates the shear the material actually
sees — σ1 = 100, σ2 = 60 gives 20 in-plane and 50 in truth. Three-dimensional
states are solved in closed form from the tensor invariants, not by iteration.

**Truss analysis** by the method of joints, **solved exactly**. The trick that
makes that possible is a change of unknown: solving for the force *per unit
length* rather than the axial force keeps every matrix coefficient rational, so
the whole equilibrium solve is exact and the single square root happens once per
member at the point of reporting. Reactions never touch it and are exact always.
Zero-force members are therefore detected as exact zeros rather than as values
below a tolerance. A mechanism, a statically indeterminate truss, and a
**critical form** — where the member count balances and the structure still
collapses, which is precisely what member counting cannot catch — are each named
rather than given a confident wrong number.

**Column buckling** with the Johnson parabola, not Euler alone. Euler's load has
no upper bound as the column gets shorter, so for a stocky column it reports a
load that would need a stress above yield and the column squashes long before it
buckles. Quoting that figure by itself is unconservative in exactly the regime
where being wrong matters. The transition slenderness is computed and the
governing curve named.

**Shaft torsion** — polar second moment, peak and bore shear stress, angle of
twist. Circular sections only, and that is a deliberate refusal: τ = Tr/J is a
theorem for a circle and simply false for a rectangle, where the section warps
and the peak shear moves.

**Pipe flow.** Reynolds number, friction factor from **Colebrook-White solved
rather than approximated** (Swamee-Jain seeds a fixed-point iteration that is
hard-capped and convergence-checked), Darcy-Weisbach head loss, minor losses,
wall shear and pump power. Laminar flow uses f = 64/Re and says the roughness was
ignored, because a laminar flow does not feel the wall. The transition band
2300 < Re < 4000 returns a number **and says it is unreliable**, which is the
honest position: there is no correlation there worth trusting.

**Composite walls and pipe insulation** as a thermal resistance chain, with every
interface temperature and the controlling layer. For a cylinder it reports the
**critical radius**: on a thin pipe, insulation below k/h increases the exposed
area faster than it adds resistance and the pipe loses *more* heat than bare.
That is the one place in the subject where doing the obvious thing makes the
problem worse, so it is computed rather than left to be discovered.

**Heat exchanger sizing** by LMTD, counter or parallel flow. Equal terminal
differences are handled as the removable singularity they are — a balanced
counterflow exchanger is an ordinary design, not a degenerate one, and the naive
formula returns NaN for it. A temperature cross is normal in counterflow and
impossible in parallel flow, and it says so either way.

**What the adversarial pass found.** Three overflow defects that all 93 oracle
tests missed, every one a finite input producing a NaN or an Infinity that would
have reached the document. The characteristic cubic formed I1³ and overflowed for
a stress state written in pascals; von Mises squared its differences and lost an
answer that fit in a double comfortably; the polar second moment is a fourth
power and underflowed to zero, making the shear stress infinite. All three are
now normalised before the arithmetic that overflows, with a final guard that
refuses rather than reports a non-number.

**Routing is now gated.** A new test asserts that every tool in the Engineering
registry is reachable from the pane and calls its engine — the failure mode that
once left three fully-tested Solve features with no way to run them.

**Inserting no longer destroys your selection.** The shared text-insert path used
`InsertLocation.replace`, so a user with a word selected who clicked "Insert MS
data" lost that word. It is the insert path for mass spec, spectra, compound
name, properties, stats, finance, assay, solve, analyze, cross-references and SEQ
ID refs — 15 call sites — and every other insert in the product appends. It now
appends too. While there: renamed from `insertDnaText` (it has not been DNA-only
for a long time), given the in-progress status every other insert path had, and
its re-entrancy guard now says something instead of dropping the second click in
silence.

**`log()` meant different things in different tools.** Three expression
evaluators had drifted: `log` was the natural log in Plot and base 10 in Stats
and Solve, so `log(100)` was 4.605 on a chart and 2 in an uncertainty
calculation. `mod` was JS's remainder in Plot and true modulo in Stats, so
`mod(-7, 3)` was -1 and 2. A user who typed one formula in Uncertainty
propagation and the same formula in Plot to visualise it got two different
answers, silently. Aligned on the majority and the spreadsheet convention: `log`
is base 10, `ln` is natural, `mod` carries the sign of the divisor. This CHANGES
Plot for anyone who typed `log` meaning natural, which is why `ln` is still there
— an inconsistency this quiet is worse than a documented change.

**Stats no longer changes n without saying so.** `statList` drops anything
non-numeric, so "N/A", "ND", "<0.01" and a pasted header row silently vanished: a
column with two bad cells gave a result on n=5 presented exactly like one on
n=7, and the two-sample output prints t(df) but never n. Dropped entries are now
counted and named, in the result text so the note travels into the document with
the number it qualifies. The check only fires on a MOSTLY numeric field, so
two-way ANOVA's labelled "lo x 12" rows do not trip it.

**A molecular formula says when it guessed the isomer.** C2H6O is ethanol or
dimethyl ether; C6H12O6 is glucose, fructose, galactose and a dozen more. The
library resolves to the most common compound and has always returned a `source`
flag SPECIFICALLY so the UI could say so — uses of that flag in the pane before
today: zero. Everything downstream, properties, pKa, NMR, mass spec and the
inserted picture, was confidently about a molecule the user may not have meant.

16 new tests pinning that the three evaluators agree. Suite 3191.

## [1.95.0] — 2026-07-26 — Four patent-tool checks that reported things that were not true

Every one of these produced confident, wrong output in a practitioner's document,
and each is the kind of thing a drafter notices once and then stops trusting the
tool over.

**Caption detection never matched in a real Word document.**
`extractCaptionNumbers` anchored on `(?:^|
)`, but Word's `body.text` delimits
paragraphs with a carriage return. So on any real document it returned nothing:
"Check captions" ALWAYS reported clean — including when captions were genuinely
duplicated or skipped — and the Audit reported every figure reference as having
no caption. The anchor now accepts CR, LF and VT, matching how toa.ts:359 already
split text. The codebase knew; this one function did not.

**Numeral gaps invented dozens of omissions.** The gap walk inferred ONE global
step and ran from the lowest numeral to the highest, so a spec numbered 10/12/14
for FIG. 1 and 100/102/104 for FIG. 2 — the commonest patent convention there is
— reported 42 skipped numerals that were never meant to exist. Gaps are now
reported only within a contiguous run; a jump from 14 to 100 is a new series.

**Citation years were read as reference numerals.** The callout pattern
`\((\d+)[A-Za-z']?\)` has no context filter, so "See Alice, 573 U.S. 208
(2014). The steps are: (1) forming, (2) etching" yielded (2014), (1) and (2) as
callouts, which the Audit then reported as "called out but undefined".
Four-digit years are excluded, and — when the numeral table is available — so is
enumeration below a scheme that starts at 10 or above. A genuinely undefined
callout is still reported, which is the tool's actual job.

**Bare "Rule N" fabricated Federal Rules entries.** Any "Rule 132" in a document
that mentioned Fed. R. Civ. P. anywhere became "Fed. R. Civ. P. 132" in the Table
of Authorities. Patent practitioners write "a Rule 132 declaration", "Rule 131
swear-behind" and "Local Rule 7.1" constantly, so a district-court patent brief
produced a table listing authorities the drafter never cited — in a document they
sign. USPTO practice rules (130-132) are excluded, and a qualifier before the
word "Rule" now blocks the civil-rule reading.

Two of my own fixes over-filtered and the tests caught both: the district
abbreviation pattern made its periods optional, so `n\.?d\.?` matched the "nd"
in "and" and silently dropped a legitimate "Rule 36"; and the callout range's
lower margin still admitted "(1)" and "(2)".

21 new tests, suite 3175.

## [1.94.0] — 2026-07-26 — FFT filtering, and two bugs a punctuation mark was causing

**FFT filter (Analyze).** `fftfilter.ts` — 181 lines of low/high/band-pass with
written caveats for Gibbs ringing, circular wraparound and Nyquist — had zero
references outside its own test. The FFT tool could show you noise and do nothing
about it, so the workflow an engineer opens MATLAB for dead-ended at the
spectrum. Low, high, band-pass and band-stop, with a raised-cosine transition
rather than a brick wall, plotted against the original signal. Verified in the
real pane: the default 4 Hz + 24 Hz signal, low-passed at 8 Hz, comes back as a
clean 4 Hz sine (0, 0.3827, 0.7071, 0.9239, 1, ...).

**Two pre-existing bugs, both caused by an em dash.** `formatNum()` renders
Infinity/NaN as "—" (linalg.ts:73), and the Analyze reader blocks insertion when
the result text contains one. That is a whole-text scan, so an em dash used as
ordinary PUNCTUATION silently disabled the Insert button *and* suppressed the
rich preview, dropping the reader to the plain-text branch so plots vanished.

  - The Nelder-Mead optimizer's non-converged note contained one, so an
    optimisation that did not converge could not be inserted — no button, no
    explanation. It is a legitimate result and is now insertable.
  - The new FFT filter tripped it twice, in its own prose and via the ten em
    dashes inside fftfilter.ts's caveats. The caveats are kept verbatim except
    for the dash, which is swapped rather than the wording changed.

The guard now documents the hazard, and `analyzeCalcText.test.ts` pins it so the
next calculator to use an em dash fails a test instead of quietly losing its
Insert button.

**A reachability gate.** `reachability.test.ts` walks the import graph from both
entry points and fails on any library module nothing can reach. It follows
DYNAMIC imports, because ppt.ts is reached only that way and a static-only walk
calls it dead — a mistake already made once during the audit. It also pins the
six exports the evaluation found orphaned INSIDE live modules, which
module-level reachability cannot see: `fitInhibition` lived in assay.ts, which
was very much alive, and was still unreachable.

`jcamp.ts` remains deliberately unwired, with the reason recorded in the gate's
allowlist: it needs a file input and a decision about overlaying a measured trace
on a predicted spectrum, which is a design question rather than plumbing.

16 new tests, suite 3154.

## [1.93.0] — 2026-07-26 — Four finished tools that no user could reach

Harvesting dead code found by the product evaluation: modules written, tested,
shipped in every bundle, and wired to nothing.

**Tukey HSD (Stats).** `tukey.ts` — 273 lines with memoised studentized-range
critical values and three written caveats — had zero references outside its own
test. So ANOVA in the pane had no post-hoc test at all, and a user comparing
three groups had to fall back on repeated t-tests: the exact error that module's
own header warns inflates the family-wise error rate to ~40% at k = 5. It now
sits beside One-way ANOVA, reports the omnibus F alongside the pairwise table so
a post-hoc is not read out of a non-significant ANOVA, and carries the module's
own family-wise warning.

**Inhibition mode fit (Bio/Assay).** `fitInhibition` was dead, and with it the
four model functions only it calls — competitive, uncompetitive, non-competitive
and mixed. The Cheng-Prusoff panel told users to "determine the mode from a
Lineweaver-Burk or a full inhibition fit before converting an IC50", advice the
product made impossible to follow. Reports Vmax, Km, Ki (and Ki-prime for mixed)
with standard errors, and states plainly that the MODE is the user's choice, not
the fit's finding.

**Linearized kinetics (Bio/Assay).** `lineweaverBurk` and `eadieHofstee` were
dead. All three transforms are now shown together as a diagnostic, with the
nonlinear fit kept authoritative — each linearization reweights the errors
differently, so their spread is the signal, not any one of them.

**Buffer ratio for a target pH (Bio/Assay).** `bufferRatioForPh` was dead. This
is the inverse of the Henderson-Hasselbalch entry and the direction a bench
scientist actually needs. Warns when the target is more than a pH unit from the
pKa, where the buffer has little capacity.

**Also fixed, found while wiring the above: the One-way ANOVA default never
worked.** `statGroups()` splits on a BLANK line or a semicolon, but the shipped
default was "1 2 3
4 5 6
7 8 9" — single newlines — so it collapsed to one
group of nine and the calculator opened showing "Enter at least two groups"
instead of a worked example. Confirmed in the real pane before changing it. Both
that default and the new Tukey one now use blank lines, and
`statCalcDefaults.test.ts` pins the property for every Stats calculator that
parses groups.

Two corrections to the evaluation's dead-code list: `hanesWoolf` is NOT dead —
`fitMichaelisMenten` uses it for its initial guess — and `substrateInhibitionV`
is left unwired on purpose, being a model equation with no fitter. Exposing it
would mean writing one or shipping a "predict v from parameters you already
know" box.

Every calculator was verified by driving the real built bundle headlessly and
checking the output against independently computed values. 5 new tests, suite
3138.

## [1.92.0] — 2026-07-26 — Truthfulness and gating

Four things the product said about itself, or relied on, that were not true.

**The online lookup now asks per NAME, not once per session.** Consent was a
single boolean: approving one name silently authorised every later lookup, so a
user who approved "benzene" could then type a confidential client compound and
have it leave the machine with no prompt — while `legal.html`, `science.html` and
the manual all promised it "asks every time". Consent is now keyed by the
normalised name. Nothing new ever leaves unasked; re-checking a name already sent
does not nag, because nothing new leaves. The three pages now describe exactly
that instead of a stronger claim the code did not honour.

**GitHub Pages no longer deploys past a red build.** `pages.yml` ran `npm ci &&
npm run build` and published. CI ran in a separate, concurrent workflow whose
result nothing consumed — so a commit failing `npm test`, the compound-dictionary
check or manifest validation still reached production, because webpack only fails
on type errors. Pages serves the installable manifest.xml and version.json, so
the site and the shipped add-in are one artefact. `deploy` now needs a `gate`
job. `ci.yml` drops to pull requests, since the same checks would otherwise race
the ones that actually block publication.

**A skipped gate is no longer reported as a pass.** `render-check.js` and
`check-landing-overlap.js` exited 0 with a SKIP message when no Chromium was
found, and `qc.ps1` recorded that as PASS and printed "ALL AUTOMATED QC PASSED" —
having checked neither the rendered pane nor the laid-out page, which are the two
bug classes that keep shipping. They now exit 2, and qc has a third state:
SKIPPED, yellow, exit 3, "QC INCOMPLETE". The same change closes a latent hazard
where a command that failed to LAUNCH inherited the previous step's exit code.

**SECURITY.md described a program that does not exist.** It claimed "no external
API calls", said office.js was the only network request, and credited a CI source
scan that was never written. It now names all three destinations, what each
carries, and what consent applies — and `networkSurface.test.ts` makes the claim
enforceable: it scans the source for fetch/XHR/WebSocket/sendBeacon/EventSource
and fails on any call site or host outside an explicit allowlist. XML namespace
URIs are excluded by name, having been verified as identifiers rather than
addresses.

6 new tests. Suite 3133.

## [1.91.0] — 2026-07-26 — Solve: typeset reasoning, and room to type a word problem

Both reported from real use of the v1.90.0 word-problem work.

**The reasoning is now typeset.** The derivation was ASCII — "P(k) = (k/100) x
R(k)", "k^2 + k - 100 = 0" — sitting in a product whose Math tool renders real
notation. Each step now carries its formula in the pane's math DSL and is
rendered through the same `mathToHtml` the Math tool uses, so the working shows
a true fraction for k/100, an n-ary product with its limits above and below, a
superscript on k squared, and sqrt(401) under a radical. The `Equation:` line is
typeset the same way rather than being the one leftover ASCII line.

Plain text and typeset formulae come from one source in `solveShares`, so they
cannot drift, and the plain form is still what gets inserted into the document —
a Word paragraph should not carry markup it cannot render.

**The input is a textarea, five rows tall for word problems.** It was a
single-line `<input>`, so a paragraph-long problem scrolled sideways and could
not be read back or edited. Equations, derivatives and integrands keep one row.

Verified by driving the real built bundle in a headless harness — selecting the
tool, choosing the word-problem kind, typing the pie problem, and reading the
rendered pane back — rather than by inspecting the markup.

3 new tests, including one that parses every emitted formula to prove the
renderer can actually typeset it: an unparseable DSL string falls back to plain
segments and would look subtly wrong rather than failing. Suite 3127.

## [1.90.0] — 2026-07-26 — Solve: successive-share word problems

Reported from real use. Typing

    "A pie is divided to 100 guest. Guest 1 gets 1%, guest 2 gets 2% of
     what's left, and so on. Who gets the largest piece of pie?"

produced nothing — no answer, no explanation, no way to insert anything. It is a
recurrence rather than a pattern that maps onto one equation, so none of the
three existing templates could touch it.

`src/lib/sharesequence.ts` models the class properly: N recipients in order,
recipient k taking k% either of what remains or of the original, answering "who
gets the most / least", "how much does recipient k get", and "how much is left".

The answer is counter-intuitive — guest 10, not guest 1 and not guest 100 —
because k rises faster than the remainder falls until it doesn't. So the tool
shows the reasoning rather than just the number:

    P(k) = (k/100) x R(k),  R(k) = prod_{i<k} (1 - i/100)
    P(k+1)/P(k) = ((k+1)/k)(1 - k/100) = 1  when  k^2 + k - 100 = 0
    k* = (-1 + sqrt(401))/2 = 9.5125, so shares rise then fall, peaking at k = 10
    guest 9 = 6.2125%, guest 10 = 6.2816%, guest 11 = 6.2187%

Answer, derivation and insert all work through the existing Solve paths.
Tried before the percentage template, which would otherwise match on the "1%"
and answer a much smaller question than the one asked.

Also fixed in Solve: an equation with more than one unknown reported "No real
roots found.", which is a false statement about the equation — `F = m*a` has
roots, the solver just cannot isolate one of three variables. It now says so and
suggests giving the other variables values.

20 new tests, with every expected share checked against an independent
simulation rather than against the implementation. Suite 3124.

## [1.89.0] — 2026-07-26 — Fix: three defects that put wrong numbers in documents

All three were found by a full product evaluation and verified by executing the
libraries, not by reading them.

**FASTA headers were folded into the sequence.** `cleanSequence()` and
`cleanDna()` stripped only NON-letters, so every letter of a FASTA header
survived into the sequence — while the pane invites exactly that paste and
promises "headers, line numbers and whitespace are stripped". A normal NCBI
header prepended 35 spurious residues, and in Align it pushed `guessKind()` over
its threshold so a NUCLEOTIDE pair was scored with BLOSUM62. Measured on two real
ACTB orthologue fragments: 96.5% identity became 86.4%. In DNA mode a 12 nt
insert became 37 nt, shifting GC% from 33.3 to 30.4 and corrupting reverse
complement, translation, ORFs, restriction sites and Tm — while the "ignored
invalid characters" line made the header look handled, because its non-IUPAC
letters were listed there. Both now drop ">" headers and legacy ";" comments
first. A multi-record paste is counted and the pane warns rather than silently
analysing a chimera.

**A supplied /codon_start was written to the ST.26 XML and then ignored.**
`translateCds` always read from base 1, so a CDS carrying /codon_start=2 was
emitted beside the frame-1 product. A listing whose translation contradicts its
own reading frame is a substantive defect in a filed application.

**Reverse-strand restriction cuts used the wrong offset.** On a reverse-
orientation site the enzyme is bound the other way round, so ITS bottom-strand
cut is the one landing on the molecule's top strand — the code used cutTop where
it needs cutBottom. Every reverse hit was out by the overhang length, inverted
for the 3'-overhang cutters (BsgI, BpmI, MmeI), and every Golden Gate enzyme was
affected: reverse BsaI at position 11 reported a cut at 9 when it is at 5.
Separately the 1-based coordinate was wrapped modulo the length regardless of
topology, so a cut past the end of a LINEAR molecule was reported as an in-range
position that does not exist — MboI at position 1 of a 24 nt linear sequence
claimed a cut at 24. `cutPosition` is now `number | null`.

31 new tests across three regression suites. Suite 3104.

## [1.88.0] — 2026-07-26 — Fix: inserted figures were sized by pixel count

Word lays an inserted PNG out at its pixel count interpreted at 96 dpi. Any
figure rasterised above 1x and inserted *without* an explicit size therefore came
out physically larger rather than sharper.

**Spectra and Sequence Map rasterised at 2x and set no size.** Every predicted
spectrum and every sequence map inserted up to and including v1.87.0 arrived at
**twice its intended width**. Table -> Chart was the only call site doing it
correctly, converting back to points with `width = px * 0.75`.

All eleven Word figure insertions now share `renderFigurePng()` and
`sizeFigure()`: supersample at 4x, then pin the picture to its natural physical
size so the extra pixels become resolution. Spectra and Sequence Map return to
their intended width; the nine sites that were rasterising at 1x keep the size
they always had and gain roughly 4x the resolution.

`figureScale()` degrades the factor for large figures to stay inside an 8 MP
budget, so a wide sequence map or a dense flowchart cannot allocate a canvas big
enough to stall the pane. It never returns 0 — an invisible figure would be worse
than an unsharp one.

The PowerPoint export path is deliberately unchanged: its 3x rasterisation never
enters a Word document and is embedded at explicit slide dimensions, where 3x is
already correct.

The arithmetic moved to `src/lib/figures.ts` so it could be tested at all —
`taskpane.ts` imports Office and cannot be reached from jest. Nine new tests
cover the conversion, the budget, monotonic degradation and the zero/NaN guards.

## [1.65.2] — 2026-07-15 — Fix: arginine's pKa net charge was wrong by 100%

Found by a full-product audit. A shipped **wrong answer**, not a missing caveat.

`pka.ts` had no guanidine case. Arginine's guanidine has three nitrogens: the
`=N` was skipped as an imine and the other two fell through to the catch-all
"aliphatic amine" branch — so arginine reported **three** amine sites at 10.6.
Wrong three ways at once: wrong group, wrong pKa (10.6 vs ~12.5), and
triple-counted into the headline number — **net charge at pH 7.4 = +2.00 against
a true +1.0.**

Guanidine is the most basic group in biochemistry and arginine is one of the
twenty amino acids; any peptide containing it got a substantially wrong charge.
Histidine was wrong too: imidazole read as pyridine (5.2 vs ~6.0) — and imidazole
is the only side chain that titrates near physiological pH.

**Fix:** a pass before the per-atom walk claims whole-group bases and marks their
nitrogens consumed, so they can't be re-counted. Guanidine → 12.5, amidine →
11.6, imidazole → 6.0 (distinguished from pyridine by ring size + N count), with
a urea/acylguanidine guard.

Verified including that it doesn't overreach — lysine unchanged, pyridine still
pyridine, urea claims no guanidine.

**Why it survived, which is the more useful finding:** `pka.test.ts` tested
*detection* thoroughly but **never asserted a single pKa value** against
literature, and tested neither arginine nor histidine. Detection tests cannot
catch a group being silently misrouted to a wrong label with a plausible number
attached. Added 7 value tests, including the net charge the user actually sees.

Suite: **2,041 tests** (was 2,034).

## [1.65.1] — 2026-07-15 — Phase 5 adversarial bug test

The standing rule: nothing deploys without a full suite plus an adversarial pass.
This is that pass for the Sequence Map work, following phase2 and phase4 — each
of which found real bugs.

34 tests: hostile input (20 malformed files, pathological locations at 200-deep
nesting, a 400 kb sequence, null bytes, emoji), biological invariants swept over
the **whole** enzyme table rather than spot-checked, cross-module consistency, and
honesty under pressure. Plus a regression class pinning the forward-only-search
bug — **every** asymmetric enzyme must find its reverse-complement site.

**Result: one failure, and it was the test, not the product.** The finiteness
check matched the `x` inside `viewBox`, the `y` inside `font-family` and the `r`
inside `text-anchor`, reporting every map as broken. Fixed, with a comment saying
why so nobody "simplifies" it back.

Then probed six things the suite doesn't cover, since phase4 also passed clean
first run and still had bugs behind it: CRLF GenBank files (parse), reverse-strand
Type IIS cut positions (**verified by hand** — forward cuts at 11, reverse at 3,
both correct), zero-span features (no NaN), full-span features, lowercase keywords
(correctly refused), and an 8 bp site in a 4 bp circular sequence (0 hits, no
crash).

**No product bugs found.** Suite: **2,034 tests** (was 2,000), 67 suites, all six
QC gates green.

## [1.65.0] — 2026-07-15 — Restriction enzymes: independent compilation, both strands, Type IIS

**First, a correction.** I reported that the add-in knew *"18 restriction
enzymes"*. That was wrong — a bad grep. It was **49**. The real gaps were never
the row count; they were structural.

**Provenance.** This table is compiled **independently** from the freely
published supplier catalogues (NEB, Thermo, Promega, Takara), cross-checked
between them. It is **not copied from REBASE**. A recognition sequence is a
*fact* — "EcoRI cuts G^AATTC" is in every catalogue and textbook, and facts carry
no copyright (*Feist v. Rural Telephone*). But a database's **selection and
arrangement** can carry thin copyright, and REBASE's file is distributed *"All
rights reserved"* — copying it wholesale would copy the compilation, not just the
facts. The selection here is our own. The module says so, so nobody bulk-imports
REBASE later.

**The real bug, which adding enzymes would have made critical.** The old matcher
was a forward-only `indexOf`. That happened to work because all 49 known enzymes
were **palindromic**. Every Type IIS enzyme is **asymmetric** — adding BsaI to the
old engine would have silently missed every reverse-strand site: a Golden Gate
assembly that fails at the bench with nothing to explain why.

| | before | after |
|---|---|---|
| enzymes | 49 | **122** |
| BsaI on the reverse strand | **0 hits** | 1 hit |
| DraIII (`CACNNNGTG`) | **0 hits** (couldn't express `N`) | 1 hit |
| EcoRI | position only | position + cut site + 4 nt 5′ overhang |

- **IUPAC ambiguity codes** — BstXI, SfiI, DraIII, AlwNI, XcmI, BglI, PflMI,
  Bsu36I, BstEII, EcoO109I, AhdI, DrdI, XmnI. None findable by string search.
- **Type IIS**, verified against NEB's Golden Gate documentation: BsaI
  `GGTCTC(1/5)`, BsmBI `CGTCTC(1/5)`, BbsI `GAAGAC(2/6)`, plus SapI/BspQI, Esp3I,
  AarI, BsmAI, BspMI, BtgZI, FokI, HgaI, MlyI, PleI, AlwI, MmeI, BsgI, BpmI,
  BpuEI, EcoP15I.
- **Cut positions and overhangs** (5′/3′/blunt with length) — what you need to
  plan a ligation, and what a name→site map cannot hold.
- **Circular search**, so a site spanning a plasmid's origin is found.
- **Unique cutters flagged** — the ones you can actually clone into.
- Isoschizomers noted where the distinction matters (Acc65I vs KpnI).

`dna.ts` delegates to the new engine and keeps its old API — the 22 existing DNA
tests pass unmodified.

50 new tests, weighted to the failure that matters: a sweep asserting **every**
asymmetric enzyme finds its own reverse-complement site.

Suite: **2,000 tests** (was 1,950).

## [1.64.0] — 2026-07-15 — SnapGene .dna import (with an honest caveat)

Opens `.dna` files directly. **But read the caveat — it is the point.**

The `.dna` format is **proprietary and undocumented by its vendor**. This reader
is written from a public reverse-engineering write-up, and its tests build
synthetic files to that same write-up. That genuinely exercises the parser —
packet framing, flags, XML reading, every failure path — but it **cannot confirm
the write-up itself is right**. Testing my code against my own understanding of
the format is circular. I tried to obtain a real `.dna` file from Addgene to
validate against and could not.

So it ships as a **convenience, not the supported path**, built to fail cleanly
rather than confidently:
- The magic cookie must match, or it refuses.
- A packet whose declared length runs past the buffer stops the walk rather than
  reinterpreting arbitrary bytes.
- An unknown tag is skipped **by its length**, never interpreted.
- A feature with no readable range is dropped, not placed at a guess.
- Every refusal names the way out: *"export it as GenBank instead"* — which every
  tool including SnapGene can do, and which **is** validated against real NCBI
  records. The in-pane help says all of this too.

**Pane:** the file handler now reads **bytes** (`readAsArrayBuffer`), not text —
decoding a binary file as text mangles it. Text formats are decoded from the same
bytes afterwards, so one input handles all three formats.

Also replaced `String.matchAll` with exec loops in the new module: the project
targets ES2017, and moving the whole build's goalposts for one convenience method
isn't a trade worth making.

Suite: **1,950 tests** (was 1,928) — 22 on this reader, most of them on the
failure paths.

## [1.63.0] — 2026-07-15 — Circular plasmid maps

The iconic figure — a ring with feature arcs and radiating labels. The single
most recognisable output of the incumbent tools, and the thing that gets
screenshotted into Word.

**`src/lib/seqmapcirc.ts`**
- **Position 1 at 12 o'clock, increasing clockwise** — the universal convention.
  Getting it backwards mirrors the whole construct: a picture that looks perfect
  and is wrong. Four geometry tests pin it (25% round lands right, 50% bottom,
  75% left).
- Annular-sector arrows with strand-aware heads, concentric rings so overlapping
  features never cover each other, ticks, and a centre caption.
- The hard part is label placement, not the polar maths: real plasmids cluster
  features (an MCS packs a dozen sites into 100 bp of a 5 kb ring), so naive
  radial labels smear into an unreadable mess. Labels pack per side and push
  along until they clear, with leader lines back to the ring.
- Features that run out of radius are **disclosed**, not silently dropped.

**Pane:** a *Map style* selector — Auto / Linear / Circular. Auto follows the
record's own topology, because a ring drawn from a linear record misrepresents
the construct; forcing it still draws, but says so.

**Two bugs caught by rendering and looking, not by assertions:**
- A colour (`#64748b`) leaked into the monochrome map's centre caption, and the
  leader lines were grey — neither is line art. A patent figure must be
  *genuinely* black and white, not mostly. Now only `#000`/`#fff`/`#1b1b1f`,
  asserted.
- The insert path **hardcoded 640px width**. A circular map is 460px square, so
  it would have been stretched out of shape in the document. Insert now reads
  both dimensions from the SVG. (The edit meant to fix this silently failed to
  match — checking rather than assuming is what caught it.)

Guarded by the render check, verified by breaking it: forcing Auto to always ring
fails with *"a LINEAR record was drawn as a ring — that misrepresents the
construct"*.

Suite: **1,928 tests** (was 1,906).

## [1.62.0] — 2026-07-15 — Sequence Map: open GenBank/FASTA, insert an annotated map

The gap a competitor comparison surfaced: JurisLab could compute plenty about a
sequence but **could not read one**, and had no sequence visualization at all —
so a scientist drew the map in SnapGene and *screenshotted* it into Word. The
screenshot was the gap; JurisLab's whole competency is figures into Word.

Deliberately scoped to import + map, not cloning simulation: SnapGene is for
designing the experiment, JurisLab is for writing it up. The overlap is the
figure — and **SnapGene exports GenBank**, so this reaches their users without
touching any proprietary binary format.

**`src/lib/seqio.ts` — FASTA and GenBank readers.**
- The GenBank **location grammar** is where a lazy parser quietly goes wrong, so
  it is tested case by case: `complement(...)`, `join(...)` (an intron is NOT
  coding), `complement(join(...))`, fuzzy `<1..>888`, `order(...)`, `102^103`,
  and remote accessions (skipped rather than mis-placed on *this* sequence).
- Tolerant by design — real files have ragged whitespace and vendor quirks, and a
  reader that throws on the first oddity is useless. Anything unparseable is
  skipped, never guessed.
- **Validated against real NCBI records, not just a hand-written fixture.** The
  hand-made one passed while pUC19 returned 0 features — which turned out to be
  correct (that record has only `source`, which we skip as noise). Lambda phage
  (NC_001416) then exercised it properly: 48,502 bp, 284 features, and
  **197 forward / 87 reverse exactly matching the 87 `complement(` in the file**.

**`src/lib/seqmap.ts` — linear maps to SVG.**
- Strand-aware arrows, per-type colours, lane packing that reserves the LABEL's
  width (a 3px feature with a 60px label needs 60px of lane, or the labels
  collide), a scale bar, and **monochrome line art** for patent figures.
- A joined CDS draws one body per exon with a dashed intron connector — one solid
  bar would claim the intron is coding, the exact error the parser avoids.
- A feature crossing the origin of a circular plasmid is **disclosed**, not
  silently dropped: a linear map cannot draw it honestly.

**Found by rendering a pUC19 map and looking at it:** labels near the right edge
were placed to the right of their feature and ran off the canvas — "AmpR
promoter" rendered as "AmpR p", "rrnB T1" as "rrn". Every assertion passed; only
the picture showed it. Labels now flip to the left when they would overflow, with
regression tests. (A suspected second bug — colour leaking into the mono map —
turned out to be font anti-aliasing; the SVG contains only #000/#fff.)

**Pane:** a new **Sequence Map** tool (23rd). The pane had never read a file, so
`<input type="file">`/FileReader are new surface — with an 8 MB guard, because a
pasted genome would wedge the pane. Tagged for **both** audiences: papers need
maps, and so do patent figures of constructs.

Guarded by the render check: a GenBank record must draw and enable Insert, and
junk must leave Insert **disabled** — a bad figure in a paper is worse than none.
Verified by breaking both.

Suite: **1,906 tests** (was 1,846).

## [1.61.0] — 2026-07-15 — Patent & legal landing page; Markush tagging fix

**Audience tagging fix — found while writing the legal page.** Build's headline
feature is Markush/R-group *genus* structures, which is a **patent claim**
construct: a bench chemist rarely draws one. It was tagged science-only, so a
chemical patent attorney selecting "⚖️ Patent & legal" would have lost the single
most patent-specific tool in the product. Chemical was wrong the same way —
structures fill chemical applications. Both are now `["science", "legal"]`.

This is exactly the failure the audience-*list* design exists to prevent, and it
still slipped through — writing the marketing page for an audience is a good way
to notice you've hidden their tools. Legal now shows 14 of 22; science 18.

**`landing/legal.html` → `/legal.html`** — the mirror of the science page:
- Leads with the work: *"Draft the application — in Word."*
- **Confidentiality first**, because for an unpublished application "offline"
  isn't a nicety, it's the reason you're allowed to use it at all.
- Pitches only the drafting tools (12 cards, every link verified): numerals with
  collision/gap/orphan checks, whole-document audit, Bluebook & TOA, Markush,
  ST.26, B&W patent figures, plant patents, algorithm listings.
- Names the competitor reality: structures in a drawing package, listings in a
  separate WIPO tool, citations in a research service, numerals checked by eye.
- Honest block: drafting aid, not a filing check. ST.26 must still be validated
  in WIPO Sequence; numeral detection is advisory; Bluebook follows the common
  rules, not every local quirk.
- Points at the ⚖️ filter so the page and the pane agree.

The index hero now offers both doors (🔬 For scientists · ⚖️ For patent & legal),
and the two pages cross-link — the biotech attorney and the chemist who files
patents can find the other half.

## [1.60.0] — 2026-07-15 — Home audience filter (focus without fragmenting)

Prompted by a real observation: *science people don't want the finance and law
stuff.* The proposed fix was splitting into four add-ins (JurisSCI / JurisMAT /
JurisLAW / Juris$$$). We didn't, because the split isn't clean and it would cost
the thing that makes JurisLab defensible:

- JurisMAT would be a strict subset of JurisSCI — every chemist needs equations,
  units and plots. Juris$$$ would be one tool. JurisLAW overlaps SCI heavily:
  ST.26 sequence listings are a *patent* format, Botanical is *plant patents*.
- The biotech patent attorney — who needs Chemical + Sequence + Citations in one
  document — is the user nobody else serves. SnapGene has no ST.26; Westlaw has
  no chemistry. Splitting would make that person install two products.
- And the complaint about competitors is precisely that their tools are separate
  software you flip-flop between. Splitting would rebuild the problem we win on.

So: the diagnosis was right, the prescription wasn't. Clutter is a presentation
problem, not a packaging one.

**Home filter chips** — *Show: All tools · 🔬 Science · ⚖️ Patent & legal*
- Tags are per TOOL, not per group, because the groups don't divide cleanly:
  "Patent drafting" holds Refs (figure captions — every paper needs them) and
  Biology holds Sequence (ST.26 exists purely for filings).
- Audience is a LIST, so genuinely dual tools show to both: **Sequence** and
  **Botanical** survive either filter. Tagging them once would have hidden a tool
  from the person who most needs it.
- Six tools are untagged and shown to everyone: Math, Units, Plot, Table→Chart,
  Refs, Code.
- Science hides 4 (18 of 22 shown); Patent & legal hides 10 (12 shown).

It is a lens, not a licence tier:
- **Defaults to "All"** — nothing is hidden until the user asks.
- **Filters the Home CARDS only.** Every tool stays in the dropdown and the
  search box, and the count line says so out loud: *"Showing 18 of 22 tools.
  Show all — the rest stay available in the dropdown and search."*
- One click to change, persisted per user, reversible.

Guarded by the render check, which now asserts the behaviour in a real browser:
default shows all 22, Science hides Citations but keeps Math/Spectra/Sequence,
Patent & legal hides Spectra but keeps Citations *and* Sequence, the dropdown
never loses an entry, and "All tools" restores everything. Verified by breaking
it — untagging Citations fails with *"the Science filter still shows Citations —
the exact clutter it exists to remove."*

Suite: **1,846 tests** (was 1,841).

## [1.59.0] — 2026-07-15 — Headless render check (the missing test layer)

There was a hole between the two things we had: 1,841 unit tests that cover the
engine but cannot see the pane, and a 30-minute manual in-Word script that sees
the pane but costs a human. Everything in between — *does each tool actually
render, and only its own section?* — was covered by nothing. That hole is exactly
where the Analyze-under-the-Home-tiles bug lived for six versions until a user
spotted it.

`npm run render-check` (`scripts/render-check.js` + `render-driver.js`) closes it:
- Boots the **real production bundle** in headless Chromium against a stubbed
  Office, then drives every mode and asserts what renders. Word's task pane runs
  on WebView2, which is Chromium — the same engine — so this exercises the real
  rendering path rather than a simulation of it.
- Asserts: the pane boots; Home shows only its tiles and leaks no tool section;
  all 22 tools have tiles; every mode renders exactly its own section (chemical
  and math correctly share format-section) and has Examples & syntax content;
  Spectra computes toluene AND keeps its caveat; the ODE tool auto-reduces
  `y'' = -y` and solves it; the chemical preview still subscripts H2O.
- **Verified by reintroducing the original bug**: excluding analyze-section from
  the Home hide fails the check with the exact diagnosis —
  `tool sections visible on Home -> HOME_LEAKS=analyze-section` — and exits 1.
- Added as step 6 of `npm run qc`. Skips cleanly (exit 0) where no Chromium-family
  browser exists, so it never blocks a machine that cannot run it.

It does NOT replace the manual pass, and the QC header says so: it cannot see
layout or styling, and cannot exercise anything needing a live Word document
(insertion, document scanning). It catches the WIRING class — which is the class
that has actually been shipping.

Live confirmation from the render (values a chemist can check):
- Spectra / toluene ¹H NMR → 7.17 (2H, m), 7.09 (2H, d), 7.08 (1H, t),
  **2.37 (3H, s, CH₃ on Ph)** — matching literature, caveat present.
- ODE → *"Solved over t ∈ [0, 6.283] in 32 steps using explicit RK45.
  Auto-reduced to a first-order system of 2 states: y, y'. Final:
  y(6.283) = 0.999999"* — the auto-reduction working in the real pane.

## [1.58.1] — 2026-07-15 — Close the remaining coverage gaps

The three modules the gap analysis named as untested. In each case the code turned
out to be CORRECT — the gap was that nothing proved it, and each new suite was
verified by reintroducing a bug and confirming it fails.

**Preview fidelity — `mathHtml.ts` (was 0 tests).**
- Its own header states the contract: *"mirrors the OMML emitter so the preview
  reflects what gets inserted."* mathOmml had a full suite and a FORMULA_LIBRARY
  sweep; the preview emitter had none. Drift would mean the preview LIES about
  what lands in the document, and only the OMML side would notice.
- 70 tests. Both emitters walk the same AST, so fidelity is proved by asserting
  each faithfully renders every leaf, in order: the OMML's `<m:t>` runs must equal
  the AST's leaves exactly, and the preview's text must contain them all in order.
  Now sweeps every FORMULA_LIBRARY entry through the PREVIEW too, not just OMML.
- Documents one intentional divergence: for an n-ary (Σ, ∫) the HTML emits sup
  before sub (it stacks the limits visually) while the OMML emits sub before sup
  (the XML order Word expects). Same rendering, different source order.
- Also pins the fallback contract (partial input like `sqrt(` must preview, not
  throw — the OMML side throws and `insertEquation` catches it and says so), and
  that HTML-special characters are escaped rather than injected into the pane.
- Verified by mutation: dropping the radical's degree fails 2 tests; dropping a
  subsup's subscript fails 4. **No drift exists today** — the emitters agree.

**`lookupSmiles` / `nameForIdcode` — `structures.ts` (was untested).**
- The front door for the whole chemistry stack: molgraph.ts (and through it
  nmr/ir/uvvis/fragment), massspec.ts and pka.ts all resolve input through it. A
  wrong SMILES here would make every predicted spectrum confidently wrong.
- 21 tests pinning names to their real formulas (aspirin → C9H8O4, caffeine →
  C8H10N4O2, glucose → C6H12O6…), case-insensitivity, formula lookup, the
  name-beats-formula precedence and its `source` reporting, name→structure→name
  round trips, and that unknown input returns null rather than a near-miss.

**`history.ts` (was untested).**
- 15 tests. Nothing here reaches the document, but it holds the only untested
  failure paths that decide whether the pane opens at all: corrupt JSON, valid
  JSON of the wrong shape, and a throwing localStorage (quota exceeded, or
  disabled by policy) must all degrade to empty rather than killing the pane.

Coverage: 60 of 61 lib modules are now imported by at least one test. The
exception is `molgraph.ts`, which has no direct test file but is exercised by
~100 adversarial tests through the four predictors built on it — a real failure
there surfaces as a confusing multi-module failure rather than a pinpointed one,
which is a diagnosability cost, not a coverage gap.

Suite: **1,841 tests** (was 1,735).

## [1.58.0] — 2026-07-15 — Gap analysis: fixes from a first real audit

Prompted by "did you perform a comprehensive bug test and gap analysis?" — the
honest answer was no. Previous passes were feature-scoped; nothing had ever swept
the whole product. The Analyze-on-Home bug (v1.57.1, found by the user) was the
evidence. This is that sweep.

**Spectra had no Examples & syntax content — user-visible, shipped in v1.54.0.**
- Opening Spectra and expanding the help panel showed an EMPTY panel. Every other
  tool has help.
- Root cause was a bug class, not a typo: the mode list existed in THREE
  hand-maintained copies — the `Mode` union (taskpane.ts), the `ExampleMode`
  union (examples.ts), and a `MODES` array inside examples.test.ts. `spectra` was
  added to the pane and to none of the others. `MODE_EXAMPLES` is
  `Record<ExampleMode, string>`, so it was "complete" against its own stale
  union; an `as ExampleMode` cast at the call site laundered the real type; and
  `?? ""` turned the miss into a silent blank. The test that claimed to check
  "every mode has help content" iterated its own copy and passed vacuously.
- Fixed properly: `src/lib/modes.ts` is now the single source of truth
  (`ALL_MODES` const → `Mode` type → `ExampleMode` = all but home). examples.ts,
  taskpane.ts and the test all derive from it, and the cast is gone. Verified:
  deleting the spectra entry is now a COMPILE ERROR, not a blank panel.
- Wrote the Spectra help content, carrying the same caveats as the pane.

**Finance formulas rendered ungrouped in the library dropdown.**
- `FORMULA_LIBRARY` has 19 categories; the grouping named 16. The three Finance
  categories were never assigned, so they appeared as bare options dangling below
  the labelled groups. A safety net appends unassigned categories ungrouped,
  which is why this degraded quietly rather than breaking.
- `LIBRARY_GROUPS` moved from taskpane.ts into formulaLibrary.ts, beside the data
  it groups, so it is testable; added the Finance group and tests that every
  category is assigned exactly once and that no group names a phantom category
  (the match is by name, so a rename on either side silently un-groups).

**palettes.ts had ZERO tests and encodes real chemistry.**
- `BUILD_TEMPLATES` holds molecules as data (`Benzene`, `Acetic acid`,
  `Acetone`…). A wrong bond order there is SYNTACTICALLY VALID — it would parse
  cleanly and silently insert incorrect chemistry into a document, which is
  exactly what "all data must be real" forbids.
- 26 new tests assert each template IS the molecule its label claims (Benzene →
  C6H6, Acetic acid → C2H4O2, …), that rings actually close, that Benzene is
  Kekulé (3 double bonds) and Cyclohexane saturated, that bond indices are in
  range, that Markush tokens really yield a generic structure, and that carets
  never point outside their snippet. **The shipped chemistry all checks out** —
  the gap was that nothing proved it.

Suite: **1,735 tests** (was 1,703).

## [1.57.1] — 2026-07-15 — Fix: Analyze controls showed under the Home tiles

Reported from a real install: on first opening JurisLab, an unexpected toolbar
sat at the bottom of the Home page.

- **Cause.** The Home branch of `onInputChanged` hid the tool sections from a
  hand-written list, and `analyze-section` was missing from it — 20 entries for
  21 sections. Nothing else hides a section, so Analyze's controls (tool picker,
  Result box, Insert button) rendered under the tile grid.
- **Why only on first open.** Opening any tool runs the per-mode branch, which
  sets every section explicitly and so hid Analyze as a side effect; it then
  stayed hidden. The bug was only ever visible on a fresh load — which is
  exactly how it survived since Analyze shipped in v1.52.0.
- **Fix.** The Home branch now reads the tool sections from the DOM
  (`main > section`) instead of a hand-maintained list, so a newly added tool
  cannot be half-registered. Nested sub-sections (structure-section, inside
  format-section) are correctly untouched.
- **Regression test.** `src/taskpane/__tests__/homeSections.test.ts` pins the
  invariant, and was verified to fail when the bug is reintroduced. Jest roots
  now include `src/taskpane` for static-asset tests (markup structure and id
  wiring) that need no Word host; Office-dependent behaviour still belongs in
  the manual pass.

Suite: **1,703 tests** (was 1,698).

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
- **LaTeX import: bare delimiter commands** (langle, 
angle, lfloor,
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
  delimiter *shape* under left
ight are approximate; the import is a
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
