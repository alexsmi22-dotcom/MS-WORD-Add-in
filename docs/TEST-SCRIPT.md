# JurisLab — Manual Test Script (v2.90.1)

A step-by-step smoke test to verify the add-in works end-to-end **inside Word**.
The engine is covered by 3,200+ automated unit tests, and `npm run qc` now also
boots the pane in headless Chromium to check every tool renders. This script
covers what neither can reach: insertion into a real document, undo, document
scanning, and layout. Budget ~30 minutes for the full pass.

Mark each box: ☐ pass · ✗ fail (note what happened).

---

## 0ay. NEW — EVERY calculator draws, everywhere (84 of 84 outside Engineering)

**This is the section to run first, and the only gate that can prove any of it.**
Statistics, Analyze, Bio/Assay and Finance went from 34 figures between them to
all 84; Solve and UV-Vis were wired too. Automated gates prove the pane *asks*
Word for a picture — `npm run audit:pane` presses Insert against a recording
mock — but **a mock always says yes.** Whether the picture lands in the document
is exactly what four consecutive defects in v2.31.1–v2.31.4 got wrong, and none
of them was visible to any test.

**The insert path itself changed**, which is why this matters more than usual:
`insertPlainText` now returns whether it succeeded, and Statistics, Bio/Assay
and Finance each insert TEXT AND FIGURE from one button. `insertPlainText` is
the shared path for mass spec, spectra, properties, stats, finance, assay,
solve, analyze, cross-references and SEQ ID refs — so §0ay-4 is a regression
check on all of them, not only on the new work.

### 0ay-1. The figure reaches the document — one per registry

For each, click **Insert result** ONCE and look at the document, not the pane.

- [ ] **Stats → Descriptive statistics**, defaults → the numbers, then a box
  plot beneath them with a red median line inside a blue box and the
  observations as grey dots. Both must be in the document.
- [ ] **Stats → Tukey HSD**, defaults → the table of pairwise differences AND a
  forest plot: one horizontal interval per pair with a dashed red line at
  zero. Intervals that cross the line are grey, those that clear it blue.
- [ ] **Analyze → Data insights**, defaults → the narrative AND a correlation
  matrix, red/blue diverging, 1.0 down the diagonal.
- [ ] **Analyze → Matrix inverse**, defaults → the matrix as a Word TABLE and a
  heat map of the same numbers. Two objects, not one.
- [ ] **Bio/Assay → Michaelis–Menten**, defaults → Vmax/Km/R² AND the fitted
  curve through the data points. **This one was broken:** the curve was drawn
  in the pane and "Insert result" wrote only the text.
- [ ] **Bio/Assay → Beer–Lambert**, defaults → the concentration AND a
  calibration line with your reading marked in red on it.
- [ ] **Finance → Loan amortization (summary)**, defaults → the three totals AND
  a chart with interest falling and principal rising, crossing about two
  thirds of the way along. **Finance could not draw at all before this.**
- [ ] **Finance → NPV**, defaults → the NPV AND a waterfall whose bars end at
  the total bar. If the bars do not reach the total, stop and report it.
- [ ] **Solve → equation**, `x^2 - 5x + 6 = 0` → roots 2 and 3 AND a curve
  crossing zero at exactly those two places.
- [ ] **Solve → derivative**, `sin(x^2)` → f and f′ overlaid; f′ crosses zero
  where f turns.
- [ ] **Spectra → UV-Vis**, any enone (e.g. `CC1=C(C(CCC1)(C)C)/C=C/C(=O)C`) →
  the λmax AND an increment waterfall ending on it. It must be a LEDGER of
  base value plus substituent increments — **not** a smooth absorption band.
  A band would be invented data and is a FAIL.

### 0ay-2. The figure matches the number beside it

Every one of these was a real defect found by review; each is the figure
disagreeing with its own text.

- [ ] **Finance → DCF valuation**, defaults → `Value = 1,610.39`, and the
  ladder's bottom bar is labelled **forecast** (not "total") at ≈272.73,
  with rows starting at **t=1**. A bar labelled "total" showing 272.73 under
  a Value of 1,610.39 is the defect.
- [ ] **Finance → IRR**, paste `-1000, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200`
  → eight `t=` bars, then one row reading `t=8..10`, then the total at ≈0.
  No flow may vanish silently.
- [ ] **Finance → Loan amortization**, `p=200000, rate=5, t=1, m=1` → ONE
  payment. There must be **no chart at all** — an empty titled frame with a
  legend and nothing drawn is the defect.
- [ ] **Finance → Depreciation (straight line)**, `cost=10000, salvage=1000,
  life=7.5` → the curve must reach **1000**, matching the sentence about
  reaching salvage. Stopping at 1600 is the defect.
- [ ] **Stats → Wilcoxon signed-rank**, defaults → the text says `n = 7` and the
  "difference" box says `n=7`. Two different n values is the defect.
- [ ] **Stats → Uncertainty propagation**, defaults → `40 ± 0.693`, and the bars
  are ≈0.4 each (same units as the ±), not ≈0.16 (squared units).

### 0ay-3. Nothing wrong can be inserted

- [ ] **Stats → Two-sample t-test**, group A `7 7 7 7 7 7 7 7 7 7`, group B
  `1 3 9 14 22 31 45 60 80 110` → **Insert must be DISABLED.** The
  assumption note contains a literal `Infinity`, and it must not reach a
  document. (This one regressed once already, from an unrelated fix.)
- [ ] **Stats → Chi-square independence**, a table of all zeros → refuses with
  "Every count is zero". A confident `p = 1` is the defect.
- [ ] **Stats → any calculator whose Insert is disabled** → the **Insert chart**
  button beside it must be disabled too.

### 0ay-4. The shared insert path still behaves (regression)

- [ ] **Mass Spec**, any formula → Insert result → text lands, status says
  inserted. (`insertPlainText`'s return type changed; every caller is affected.)
- [ ] **Stats → Regression**, defaults → Insert result ONCE → text and the
  diagnostic figure, **one copy of each**. Click Insert result TWICE quickly →
  you must NOT get one text and two pictures.
- [ ] **Bio/Assay → Hill**, defaults → Insert result, then **Insert fit plot** →
  the plot appears a second time, deliberately. That button still works.
- [ ] Any calculator where insertion FAILS (e.g. with the document locked) →
  the status must say it could not insert. A green "Result and chart
  inserted" over a failure is the defect.

### 0ay-5. Sign-off

Figures are inserted as pictures at their intrinsic size; a squashed or
stretched figure means a size was pinned to the asked-for value rather than
read from the SVG. Note anything that reads badly at Word's default zoom —
"it computes correctly" is not the bar here, legibility is.

Tester: ______________  Date: __________  Build (version.json): __________


## 0a. What changed in v1.97-2.4.0 — check this first

The pane was restyled to match the landing page. Nothing about what the tools
COMPUTE changed, so this section is about appearance and reach.

- [ ] The pane header shows the **scales-of-justice logo** (benzene ring on one
  side, summation sign on the other) beside the JurisLab wordmark.
- [ ] **The ribbon button may still show the OLD icon.** That is Word's cache,
  not a build problem — Office caches add-in icons by URL and the filenames did
  not change. See the note at the end of this section to clear it. The icon in
  the PANE is the truth.
- [ ] Home tiles show **drawn line icons** — a benzene ring for Chemical, a
  sigma for Math, a double helix for DNA — not emoji and not numerals. Every
  tool has its own; no two are the same drawing.
- [ ] Colours are navy/cyan, not the old Office blue; buttons are navy with a
  cyan focus ring.
- [ ] **Drag the pane as narrow as it will go.** Nothing should be cut off at
  the right edge. Check **Align** in particular: its mode dropdown used to run
  ~21px past the edge at the narrowest width, where it could not be clicked.
  (Now gated by `npm run check:pane`, but only a human can confirm in Word.)

**New capabilities in v1.99.0 — worth a pass each.**
- [ ] **Plot → x/y scale = Log₁₀.** Enter data spanning decades including a zero
  (e.g. `0 5`, `1 12`, `10 30`, `100 61`). The zero must be dropped WITH a
  warning saying so, and the decades must be evenly spaced.
- [ ] **Stats → t-test.** The result line now carries Cohen's *d* and a 95% CI on
  the difference. A paired test must say `d_z`, not `d`.
- [ ] **Numerals → USPTO paragraph numbers.** On a spec with headings, press
  Preview: headings, blank paragraphs and the claims must be excluded from the
  count. Then Apply, and confirm Ctrl+Z reverses it.
- [ ] **DNA → Virtual digest.** Same sequence as Linear then Circular: circular
  must give exactly ONE fewer fragment, and one fragment marked "through origin".
- [ ] **Citations → native TOA.** In a brief using short forms (`Alice, 573 U.S.
  at 217`), the page list must now include those pages, not just the full cite.
  The message says how many `Id.` references it declined to attribute.

**Dark mode (v2.0.0).** The pane follows Word's own theme.
- [ ] Switch Word to **File → Account → Office Theme → Black** (or Dark Gray).
  With Appearance on **Match Word** the pane should go dark to match. Switch back
  to Colorful/White and it should return to light.
- [ ] The **Appearance** control at the bottom of the pane forces Light or Dark
  and overrides Word. The choice must survive closing and reopening the pane.
- [ ] **The 2D structure / plot / spectra preview stays WHITE in dark mode.**
  That is deliberate, not a bug: those previews show artwork that is inserted
  into the document as black-on-white line art, and a dark preview would
  misrepresent what you are about to insert. Confirm an inserted structure is
  still black-on-white with the pane in dark mode.
- [ ] Nothing is unreadable in either theme — check disabled buttons, the
  warning/error text, and the active filter chip in particular.

**Statistics in v2.1.0.**
- [ ] **Stats → Check test assumptions.** Paste two skewed groups; it must say
  the data are NOT normal and name Mann-Whitney as the alternative.
- [ ] **Stats → t-test on non-normal data.** The result must carry the same
  warning underneath the p-value, and that warning must travel into the document
  when you insert it.
- [ ] **Stats → Kruskal-Wallis.** Dunn post-hoc appears only when the overall
  test is significant; with a non-significant result it says so instead.
- [ ] **Stats → Friedman.** One row per subject. A ragged design (rows of
  different lengths) must be refused, not padded.
- [ ] **Stats → Dunnett (each treatment vs one control).** First group is the
  control. Check that it corrects for the number of TREATMENTS, not all pairs —
  the note under the result says so — and that its p-values are smaller than
  Tukey's on the same data.
- [ ] **Stats → Tukey HSD** caveats must no longer mention "Games-Howell", and
  the Dunnett they point to must now exist in the Test dropdown.

**Regression in v2.2.0.**
- [ ] **Stats → Multiple regression.** One row per observation, response first.
  Two diagnostic plots must appear under the result.
- [ ] **Stats → Polynomial regression.** Fit degree 1 to data that is obviously
  curved: the residual plot must show a clear ARC. Refit at degree 2 and the arc
  must disappear into a shapeless band. That contrast is the whole point of the
  plot — R² alone will not tell you.
- [ ] Enter two identical predictor columns: it must REFUSE with a collinearity
  message, not return coefficients.
- [ ] The diagnostic plots stay on white paper in dark mode (same reason as the
  structure preview).
- [ ] **Every Stats test's "Insert result" button is enabled** once it has a
  result. Tukey HSD's had been permanently disabled before v2.2.0 — its caveats
  contained em dashes, which the reader treats as a non-finite-value sentinel.
  Insert a Tukey result and confirm it lands in the document.

**Survival analysis in v2.3.0.**
- [ ] **Stats -> Survival (Kaplan-Meier).** One row per subject: time, then 1
  (event) or 0 (censored). Change one subject from 1 to 0 and confirm the curve
  does NOT step down at that time — it should stay flat and the subject should
  simply leave the risk set.
- [ ] Make every subject censored: median survival must read NOT REACHED, not a
  number.
- [ ] **Stats -> Log-rank.** Two groups separated by a blank line. Both curves
  must appear on one chart, and the hazard ratio direction must match which
  group is doing better.

**Refactor in v2.4.0 — no behaviour should change, which is what to check.**
Finance, Stats, Analyze and Bio/Assay now share one field renderer. Nothing
about any calculator should look or behave differently.
- [ ] In EACH of those four tools, switch between several calculators and
  confirm the input fields change correctly each time, and that typing in them
  still updates the result live.
- [ ] Multi-line fields (Stats "Groups", Analyze matrix/ODE fields) must still be
  text AREAS, not single-line boxes.

**Clearing a stale ribbon icon.** Quit Word fully, then delete the Office add-in
cache and reopen:
- **macOS:** `~/Library/Containers/com.microsoft.Word/Data/Library/Caches/` and
  `~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/`
- **Windows:** `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\`

---

## 0b. New in v2.36.0 — elastic beam supports and MDOF forced response

Engineering > Structural & solids > **Beam analysis**:

- [ ] Leave the defaults (`pin 0, roller 8`, udl 5 + point 30) and note the two
  reactions. Now change the supports to `pin 0, roller 8 settle=0.01` and put
  `2.4e5` in the EI field. **The reactions must not change at all** — a
  determinate beam does not care that a support moved. The determinacy line
  should say so in words.
- [ ] Change the supports to `fixed 0, roller 8 settle=0.01`, EI `2.4e5`, and
  DELETE every load. Reactions are now non-zero: settlement alone induces them
  in an indeterminate beam. Double EI to `4.8e5` and they should **double**.
- [ ] With any spring or settlement present, clear the EI field. It must be
  **refused with a reason** — that there is no EI-free answer to give — rather
  than silently computing something.
- [ ] `roller 8 k=0` must be refused as NO support rather than a soft one.
- [ ] Check the result says the reactions are **not EI-free**, and that the old
  "reactions ... are exact without it" line does NOT appear for these beams.

Engineering > Vibration > **Forced response of a multi-DOF system**:

- [ ] Defaults compute and insert. The modal breakdown lists one row per mode
  with its own ζ, r and share of the peak response.
- [ ] Set the mass matrix to `1 0 / 0 1` and stiffness to `200 -100 / -100 200`
  (matrix input), force `10 10`, ω `5`. Mode 2 is antisymmetric and the load is
  symmetric, so **mode 2's generalised force must be 0** and the note about a
  load at a node of a mode must appear.
- [ ] Set damping to `0` and ω to a natural frequency shown by the Natural
  frequencies tool. It must **refuse** with "no steady state", not print
  Infinity or NaN.
- [ ] Enter damping as `rayleigh 0.6 0.002` and confirm the per-mode ζ values
  differ between modes.
- [ ] The classical-damping caveat appears in the notes every time.

---

## 0c. New in v2.37.0 — fractions in every beam field

Engineering > Structural & solids > **Beam analysis**:

- [ ] Span `9`, supports `pin 0, roller 9`, one load `point 30 at 9/3`. The
  reactions must read exactly **20** and **10** — not 19.999999 — because the
  position went in as an exact third rather than a rounded decimal.
- [ ] Fractions work in the other fields too: `udl 7/2 from 1/3 to 16/3`,
  `moment 200/3 at 4/3`, `roller 8/3`, `roller 8 k=1/3 settle=1/400`, and in the
  span and EI boxes.
- [ ] `roller 1.5/3` must be **refused** ("is not a number"), not reinterpreted.
  Same for `roller 8/0`.
- [ ] **The one that mattered:** `pin 0, roller 8 k=1/2/3` must be REFUSED with a
  message naming `k=1/2/3`. Before v2.37.0 it silently moved the roller to 8/3
  and flipped a reaction into uplift. Check the support really is refused rather
  than quietly relocated — the old behaviour looked like a perfectly normal
  answer.
- [ ] `k=5 roller 8` (option before the position) must be refused.
- [ ] Uppercase still works: `UDL 0 TO 9 FROM 1/3 TO 6`.

---

## 0d. New in v2.39.0 — divergent integrals, the PK figure, and a 130k paste

Every item here is a bug that shipped and looked completely normal. Check the
refusals as carefully as the answers: in each case the old behaviour was a
plausible number, not an error message.

Math > **Solve** > definite integral:

- [ ] `1/((x-1)^2)` from `0` to `2` must be **REFUSED** — "does not exist on this
  interval", naming a POLE near x = 1. It used to report **−2** as
  "exact (symbolic)" with no caveat at all. The integrand is positive everywhere
  on that interval, so a negative area was impossible, not merely inaccurate.
- [ ] `tan(x)` from `0` to `3` must be refused (pole at π/2). It used to report
  0.01005 as exact.
- [ ] `1/(x-0.5)` from `0` to `3` must be refused. This one took the *numeric*
  path and returned a confident **5.0355** — the quadrature stepped over the pole
  without ever sampling it.
- [ ] `1/(x^2-4)` from `0` to `3` refused (pole at x = 2); from `0` to `1` it must
  still give the ordinary answer **−0.2747**.
- [ ] **The control that matters most:** `1/((x-1)^2)` from `2` to `3` must still
  return **0.5**. The pole is real but outside the interval, and refusing this
  would mean the fix went too far.
- [ ] A handful of ordinary integrals must be untouched and still say
  "exact (symbolic)": `x^2` over [0, 2] = 2.6667, `1/(x^2+1)` over [0, 1] =
  0.7854, `ln(x)` over [1, 2] = 0.3863, `sin(x)` over [0, π] = 2.
- [ ] Type into the integral fields and watch for lag. The pole search runs on
  every keystroke; it should be imperceptible.

Math > **Solve** > derivative:

- [ ] `log10(x)` must give `0.434294/x`. It used to **throw an error** into the
  pane — `log10` was the only function the parser accepted and the derivative
  table did not have.
- [ ] `x/0` must show a caveat saying the result is not a number. It used to
  report the derivative as **`0`**.

Analyze > **Pharmacokinetics (NCA)**:

- [ ] Paste concentration-time data whose **first sample is 0** — which is normal,
  the pre-dose sample is zero by definition:
  `0 0 / 0.5 12.1 / 1 10.9 / 2 9.6 / 4 7.8 / 8 4.3 / 12 2.4 / 24 1.3 / 48 0.13`,
  dose 500, IV.
- [ ] **Look at the figure.** Every point must be visible on the log axis. It used
  to insert a figure where all nine points were `cy="NaN"` — a blank plot body
  with no y-axis labels, but a normal-looking x axis, beneath a numerically
  correct report. If the figure looks empty, this has regressed.
- [ ] A note must appear saying **1 point** could not be plotted on a logarithmic
  axis, that it is omitted from the figure only, and that the numbers use the full
  data set.
- [ ] Same check with a trailing zero (a below-limit-of-quantification sample).
- [ ] With data where *every* concentration is zero, there must be **no figure at
  all** rather than an empty frame.

Stats > **Uncertainty propagation**:

- [ ] Variables `a = 1e-3 ± 1e-4`, `b = 20 ± 0.2`, `c = 5 ± 0.05`, formula
  `a*b/c`. This must work. It used to say **`Unknown variable "a"`** — about a
  variable defined on screen — because the parser accepted `1e+3` but not `1e-3`.
- [ ] `a = 5 ± -0.1` must be **refused** with a message saying an uncertainty is a
  magnitude. Do not accept a negative uncertainty: propagation squares it, so it
  would vanish into a plausible answer.
- [ ] `a = 1.2.3 ± 0.1` must be refused by name, not silently read as 1.2.
- [ ] A negative *value* is still fine: `dT = -1.5e-3 ± 2e-5`.

Anywhere that takes a pasted column of numbers — **Plot**, **Analyze → data
insights**, **FFT filter**, **Table→Chart**:

- [ ] Paste a **very large** column, at least 150,000 rows. A spreadsheet column
  that size is ordinary. Nothing may crash. The previous limit was about 125,000
  and the failure was a cliff, not a slowdown — 100,000 rows worked perfectly,
  which is why no test caught it.

Engineering > **Circuits**:

- [ ] `V1 1 Gnd 5` / `R1 1 0 1k`. Ground aliases are now case-insensitive, so this
  must give V(1) = 5 V. It used to report **V(1) = 0 V and V(Gnd) = −5 V** — an
  exact, unique, wrong answer, because `Gnd` with a capital G was treated as an
  ordinary node. Try `GND`, `Ground`, `GROUND`, `VSS` too.
- [ ] An inductor of `0` or a capacitor of `0` must be refused at parse. They used
  to return "ok" with all-NaN node voltages that were still insertable.
- [ ] A circuit whose only path to ground is through a **capacitor** must be
  refused for having no DC path. The capacitor used to count as a path, defeating
  the refusal the module's own header advertises.

Engineering > **Control**:

- [ ] Transfer function `1` over `s^3 + 10000000003 s^2 + 30000000002 s +
  20000000000` — that is `1/((s+1)(s+2)(s+1e10))`. The verdict must read
  **STABLE**. It used to read "MARGINALLY STABLE — 2 poles on the imaginary axis"
  directly above a pole list where every pole was tagged "(stable)", because one
  tolerance was scaled by the largest pole.
- [ ] `1/s` must still be MARGINALLY STABLE, and `1/(s-1)` still UNSTABLE — the
  genuine cases must not have been loosened away.

Chemical:

- [ ] Formula `H0` must be **refused**. It used to validate clean with a molar
  mass of 0 and a Hill formula of "H0". Same for `C0H4`. Ordinary formulas
  (`H2O`, `K4[Fe(CN)6]`) must be unaffected.

> **Known and NOT fixed in this release.** `docs/KNOWN-DEFECTS.md` lists eleven
> defects that still produce a wrong number, with exact reproductions — settling
> time for an overdamped system, phase margin at the wrong crossover, NCA area
> starting at the first sample instead of t = 0, oral half-life without a
> flip-flop check, small limit points, and several tolerance bands in the equation
> solver. If you are checking those areas, read that file first so you know what
> you are looking at.

---

## 0e. New in v2.40.0 — poles that were reported as roots, and lost roots recovered

Every item is a bug that shipped looking completely normal. As in section 0d, the
**refusals matter as much as the answers** — in each case the old behaviour was a
plausible number rather than an error.

Math > **Solve** > equation:

- [ ] `1/(x-2.25) = 0` must return **no roots**. It used to report **2.25**, where
  the left-hand side evaluates to −1.1e12. Same for `x/(x-2.25) = 1` and
  `(x+1)/(x-2.25) = 1`.
- [ ] `tan(x) = 2` must return **588** roots, not 1176. The old list alternated real
  solutions and asymptotes — spot-check that 1.107 (which is arctan 2) is present
  and that 1.571 (π/2, an asymptote) is **not**.
- [ ] `0.0000000000001*x^2 - 1 = 0` must give **±3162277.66**. It used to say "No
  value of the variable satisfies this equation."
- [ ] `0.0000000001*x^2 - 0.0001 = 0` must give **both** ±1000. It used to give only
  1000, labelled exact — half the answer, presented as certain.
- [ ] `x - 1e300 = 0` must give **1e300**, with no warning. This is the regression
  the first attempt at the above introduced, so it is worth checking directly.
- [ ] `x^2 - 1e-20 = 0` must give **±1e-10**, not "0, 0".
- [ ] `(x-1)/(x-1) = 1` must say **identity**, instantly. It used to return 4000
  roots and take about three seconds.
- [ ] `sin(x)^2 + cos(x)^2 = 1` must also say identity. And `exp(ln(x)) = x`.
- [ ] `sin(x)^2 + cos(x)^2 = 1.0000001` must **NOT** say identity — it has no
  solution. The check must be tight enough to tell those apart.
- [ ] `exp(x) = 0` must report **no reliable root found** and list nothing. It used
  to return 510 values from the underflow region.
- [ ] **Known and NOT fixed:** `cosh(x)^2 - sinh(x)^2 = 1` still returns 33 spurious
  roots. It is an identity. See B15 in `docs/KNOWN-DEFECTS.md` for why, and why the
  attempted fix was reverted rather than shipped.
- [ ] Ordinary equations must be untouched: `x^2 - 4 = 0` → ±2, `2*x + 4 = 0` → −2,
  `x^3 - 6*x^2 + 11*x - 6 = 0` → 1, 2, 3, `sin(x) = 0` → the multiples of π.

Math > **Solve** > definite integral — the displayed antiderivative:

- [ ] `1/(x^2+x+1)` from 0 to 1. The antiderivative shown must read
  **1.15470053838**, not 1.154701. That coefficient is 2/√3.
- [ ] **Copy the displayed antiderivative and paste it back in** as a function to
  differentiate or plot. It must parse and describe the same function. Before, it
  was rounded to six decimals and silently described a different one — which
  matters because showing it is an invitation to reuse it.

Engineering > Structural & solids > **Beam analysis**:

- [ ] Insert a beam diagram and check the figure is not squashed or clipped — the
  x-axis label must be fully visible. Two tests that were supposed to guarantee this
  could not fail, so this has been unguarded until now. Try a cantilever, a simple
  span, three supports, and a spring support.

---

## 0f. New in v2.41.0 — control: settling time, margins, and a verdict withheld

Engineering > Control systems. Every figure below was wrong in a way that looked
entirely plausible, so check the numbers, not just that something appears.

**Second-order metrics / step response:**

- [ ] `wn = 1`, `zeta = 20` (denominator `s^2 + 40s + 1`). The 2% settling time must
  read about **156 s**. It used to read **0.2 s** — 780 times optimistic — and was
  flagged exact.
- [ ] Sweep zeta upward: 1, 2, 5, 10, 20. Settling time must **INCREASE** every
  time. It used to fall (4, 2, 0.8, 0.4, 0.2), which is backwards — more damping
  means slower settling.
- [ ] `zeta = 1` (critically damped) must read about **5.83 s**, not 4.
- [ ] `zeta = 0.2` must still read **20 s** — the underdamped envelope estimate is
  the textbook convention and is deliberately unchanged.

**Margins:**

- [ ] Open loop numerator `100 s^2 + 2 s + 100`, denominator `s^4+4s^3+6s^2+4s+1`.
  The phase margin must read about **23°**, not 32.5°. A note must appear saying
  the magnitude crosses 0 dB at **3 frequencies** and that the smallest margin is
  the one reported.
- [ ] Numerator `1e12`, denominator `s^3+3s^2+3s+1`. A phase margin must be
  **reported** (about −90°). It used to say there was none, because the swept range
  stopped at ω = 100 while the crossover is at ω = 10005.
- [ ] Numerator `0.01`, denominator `s+1`. There must still be **no** phase margin —
  the magnitude never reaches 0 dB, and extending the sweep must not invent one.
- [ ] Numerator `1`, denominator `s^3+3s^2+2s` (that is `1/(s(s+1)(s+2))`). Gain
  margin must be **15.56 dB** and no multi-crossing note should appear.
- [ ] Type into the gain field and watch for lag — the sweep now extends itself, so
  this is worth a moment.

**Stability:**

- [ ] Denominator `s^6+3s^4+3s^2+1` (that is `(s^2+1)^3`). The verdict must read
  **UNDETERMINED**, explaining that a repeated pole cannot be resolved numerically
  and to treat it as marginal. It used to read "UNSTABLE — 2 poles in the right half
  plane" for a marginally stable system.
- [ ] These must keep their definite verdicts — the refusal must be narrow:
  `s^2+2s+1` → STABLE, `s^3+3s^2+3s+1` → STABLE, `s^2-2s+1` → UNSTABLE,
  `s^4-2s^2+1` → UNSTABLE, `s^2` → MARGINALLY STABLE, `s^2+3s+2` → STABLE.

---

## 0g. New in v2.42.0 — pharmacokinetics: the missing area, flip-flop, absorption

Analyze > Pharmacokinetics. Every figure below was wrong in a way that looked
entirely reasonable.

**Non-compartmental analysis (NCA):**

- [ ] Paste an IV bolus profile whose **first sample is late** — for example
  `2 67.0 / 4 44.9 / 8 20.2 / 12 9.1 / 24 0.82`, dose 500, route IV. The clearance
  must read about **1.0 L/h**. It used to read **1.37** — 37% high — because the
  area from dosing to the first sample was simply missing. With a first sample at
  4 h the old error was **98%**.
- [ ] A note must appear saying the first sample is not at time zero, giving the
  **back-extrapolated C0**, and admitting that it is an extrapolation.
- [ ] Same data with a sample added at `0 100`: the clearance must barely change.
  Before, the two answers differed by more than a third.
- [ ] Switch the route to **oral** on data starting after t = 0. The note must now
  say the concentration at time zero is **zero by definition** and must NOT mention
  back-extrapolation — the two routes need different conventions and using the
  IV one for an oral dose would invent drug that has not been absorbed.
- [ ] Any **oral** analysis must carry a **FLIP-FLOP WARNING**: the terminal slope
  may be the absorption rate rather than elimination, it cannot be told apart from
  oral data alone, and an IV reference is needed. There was no warning at all
  before, and the two cases give *identical* numbers — in a simulated pair the
  reported half-life was 6.93 h both times when one of them truly had 0.693 h.
- [ ] An **IV** analysis must NOT carry that warning.

**Steady state:**

- [ ] There is a new field, **absorption rate ka**. Leave it blank: the peak must be
  reported "at the moment of dosing" and a note must say the peak assumes the dose
  appears **instantaneously** and is an upper bound for anything swallowed.
- [ ] Now enter `ka = 0.6` with `Vd = 10`, `CL = 2`, `dose = 500`, `τ = 12`. The
  peak must fall from about **55 to about 33 mg/L**, and be reported at about
  **t = 2.5 h** after each dose. A note must state how much higher the
  instantaneous figure was. That 65% overstatement was previously silent.
- [ ] Try `ka = 3`: the peak should rise to about 45.6 mg/L and occur earlier
  (~0.93 h). Faster absorption, higher and earlier peak — that is the check that
  the model is behaving.
- [ ] The **average** concentration must not change when ka changes. Cavg depends
  only on dose rate and clearance; if it moves, something is wrong.
- [ ] Enter `ka` equal to `CL/Vd` (here 0.2). It must fall back to the
  instantaneous formula and say the two rate constants are indistinguishable —
  the standard oral solution divides by their difference.
- [ ] `ka = -1` or `ka = abc` must be refused with a message about a positive
  number, not silently ignored.
- [ ] With a ka supplied, the **plotted curve** must carry a note saying the figure
  is drawn as instantaneous doses and to read the peak from the numbers, not the
  plot. The figure must not silently contradict the text above it.

---

## 0i. New in v2.44.0 — circuits, trusses, parsers and messages

Engineering > **Circuits**:

- [ ] Component value `1e-6` must be **accepted** (it used to be refused while `1u`
  — the same number — worked, so anything pasted from a spreadsheet or a SPICE deck
  failed). Try `2.2e3`, `1E-9`, `4.7e-12`. Suffix forms must still work: `1k`,
  `1u`, `1meg`, `2k2`, `4r7`.
- [ ] `R1 1 0 -1k` must be **refused**, explaining that this tool solves linear
  passive circuits. A negative resistance used to be accepted silently and solved as
  though it were a component.
- [ ] `V1 1 0 5 / V2 2 1 3 / V3 2 0 2` — three sources round a loop. The message
  must say **loop of voltage sources**. It used to say "check for a shorted or
  duplicated source", which is advice for a fault the tool had already excluded.
- [ ] Paste a large netlist — 100+ nodes with cross-connections. It must return
  promptly (it took **1.4 seconds** for the DC solve alone), and a note must say the
  answer used **double precision** rather than exact rationals. A small circuit must
  still say nothing of the kind and stay exact: `V1 1 0 5 / R1 1 2 1k / R2 2 0 1k`
  must give exactly 2.5 V at node 2.
- [ ] A **Bode sweep** on that large netlist must also return promptly (was 1.1 s)
  and say the sweep was **thinned**, naming the point count. A small circuit's sweep
  must keep all 120 points and carry no such note.

Engineering > **Trusses**:

- [ ] Member tension/compression is now read from the exact sign rather than the
  rounded value. Ordinary trusses must be unchanged — the classic three-member truss
  with a 10 kN apex load must still report A-B as **5 kN tension**.

Math > **Solve**:

- [ ] `abs x` must produce an error naming **an opening bracket "("**, not
  "Expected lparen". Try `|x`, `{x`, `sin(x` — each must name the character it
  wanted and say what it found instead.
- [ ] Derivative of `ln(abs(x))` must read **1/x**.

Chemical > **Reactions**:

- [ ] `A ->> B` must warn that the arrow is not recognised. It used to silently
  produce a component called "> B" and hand it to the structure renderer as SMILES —
  it did not error, it drew something.
- [ ] Well-formed arrows must be unaffected and carry no warning: `A -> B`,
  `A <=> B`, `A -> B -> C`, `A >> B`.
- [ ] SMILES charges must not be mistaken for arrows:
  `C[N+](C)(C)C -> [O-]` must parse cleanly.

> **Not fixed, and deliberately so.** `docs/KNOWN-DEFECTS.md` still lists **B3**
> (a blank Bode chart at zero reference — I could not reproduce it and left it open
> rather than claiming it fixed), **B11** (`1/2x` reads as `1/(2x)` in Solve and
> `(1/2)x` in the equation parser — a product decision, not a bug to patch),
> **B15** (an identity hidden by catastrophic cancellation, where the fix I built
> would have called `tan(x) = 2` an identity, so I reverted it), and **C0–C2**.

---

## 0j. New in v2.45.0 — a hidden identity, ambiguous notation, and hydrates

Math > **Solve** > equation:

- [ ] `cosh(x)^2 - sinh(x)^2 = 1` must say **identity**. It used to return 33
  spurious roots. Same for `cosh(2x) = cosh(x)^2 + sinh(x)^2` and
  `tanh(x) = sinh(x)/cosh(x)`.
- [ ] The near-misses must **not** be identities: `cosh(x)^2 - sinh(x)^2 = 1.0000001`,
  `sin(x)^2 + cos(x)^2 = 1.0000001`. And the ordinary equations must still solve —
  `tan(x) = 2`, `exp(x) = 2`, `x^2 = 4`. An earlier attempt at this fix called all of
  those identities, which would have made every equation in the product vacuous, so
  they are worth checking.

Math — **anywhere an expression is typed** (Solve, Plot, equation insertion):

- [ ] `1/2x` must be **refused**, with a message offering both `1/(2x)` and `(1/2)x`.
  It used to mean `1/(2x)` in Solve and `(1/2)x` in the equation parser — the same
  text, two different functions, differing by a factor of (2x) squared. Try `2/2x`,
  `x/2y`, `1/2(x+1)`, and `1/2 x` with a space.
- [ ] These must all still work, unchanged: `1/2*x`, `1/(2*x)`, `(1/2)*x`, `1/2`,
  `x/2`, `sin(x)/2`, `1/2e5` (that last one is a single number, not a product).
- [ ] **Exponents are deliberately NOT refused.** `pi r^2 h` must still insert — an
  exponent extends only to the atom after it, so `r^2 h` is unambiguous. Check the
  formula library still works: volume of a cylinder, volume of a cone, power
  dissipated, two-asset portfolio variance. An earlier version of this refusal broke
  all four.

Chemical > **Mass spec** (and anywhere a formula is counted):

- [ ] `CuSO4·5H2O` must give O:9 and H:10. It used to give **O:46**, because the
  hydrate dot was deleted and "O4" merged with the following "5" into "O45".
- [ ] `Cr2(SO4)3·18H2O` must give Cr:2 S:3 O:30 H:36 — bracket groups were also being
  stripped, so `(SO4)3` read as `SO43`. Try `K4[Fe(CN)6]` and `((CH3)2CH)2O`.
- [ ] A malformed formula like `CuSO4(` must return **nothing** rather than a partial
  count, because the count feeds monoisotopic mass.

> **Still open, and each for a stated reason.** `docs/KNOWN-DEFECTS.md` lists **B3**
> (a blank Bode chart at zero reference — could not be reproduced), **C0** (a
> removable singularity still defeats the numeric quadrature; the obvious repair was
> built, measured at a 1.7% error, and removed — refusing a correct answer is a
> smaller harm than reporting an incorrect one), and **C2** (a huge exact rational
> converting to Infinity, which is the correct IEEE result at the boundary).

---

## 0k. New in v2.46.0 — integrals with a hole in the integrand

Math > **Solve** > definite integral:

- [ ] `sin(x)/x` from `-1` to `1` must now give **1.892166**. It used to be refused —
  the integrand is undefined at x = 0 but its limit there is 1, and the old quadrature
  evaluated exactly that point on its first step.
- [ ] `sin(x)/x` from `0` to `1` must give **0.9460831** (that is Si(1)), and from
  `-1` to `0` the same. The singular point at an endpoint must work too.
- [ ] `(1-cos(x))/x^2` from `-1` to `1` must give **0.9727708**, and
  `(exp(x)-1)/x` from `0` to `1` must give **1.3179022**.
- [ ] The result must SAY the integrand is undefined somewhere and that a removable
  singularity was handled — not just hand over a number.
- [ ] **The important negative.** `1/x` from `0` to `1` must still be **REFUSED**. That
  integral diverges, and the new rule deliberately never evaluates an endpoint, so this
  is exactly where it could hand back a confident wrong number. Check `1/(x-1)` from
  `1` to `2`, `1/x^2` from `0` to `1`, and `1/(2-x)` from `0` to `2` as well.
- [ ] Interior poles must still be refused: `1/(x-1)` from `0` to `2`, `tan(x)` from
  `0` to `3`, `1/x` from `-1` to `1`.
- [ ] Ordinary numeric integrals must be untouched — `sin(x)/x` from `1` to `5` should
  still read 0.6038 and say "adaptive Simpson".

> **Remaining in `docs/KNOWN-DEFECTS.md`:** two entries, neither producing a wrong
> number — **B3** (a blank Bode chart at zero reference, which could not be reproduced)
> and **C2** (a huge exact rational converting to Infinity, which is the correct IEEE
> result at the boundary). Also recorded there: the two parsers still read `2^2x`
> differently, left alone because changing how exponents bind would re-read every
> expression already sitting in a document.

---

## 0l. New in v2.47.0 — exponents, and spaces between symbols

Math > **Solve** (and anywhere an expression is typed):

- [ ] `r^2 h` with `r = 3`, `h = 2` must evaluate to **18**. It used to give **81**,
  because the exponent swallowed the `h` and it computed r^(2h). This was filed as a
  cosmetic inconsistency and was actually a wrong number.
- [ ] `2^2x` must read as (2^2)·x — so with `x = 3` it is **12**, not 64.
- [ ] `pi r^2 h` with `r = 2`, `h = 3` must be **37.699** (that is 12π). It used to be
  a single variable called "pir" raised to the power 2h, so the expression had one
  unknown with a name nobody typed. Check the variable list shows **r and h**.
- [ ] The shipped formulas must now evaluate in Solve, not just typeset: volume of a
  cylinder, cone and sphere, power dissipated `I^2 R`, Pythagoras.
- [ ] `2^3^2` must still be **512** — exponents remain right-associative. And `-x^2`
  with `x = 3` must be **−9**, not 9.
- [ ] `x2`, `Vd`, `v_max` must still each be ONE variable. The fix must not shatter
  legitimate multi-character names.
- [ ] `y z` must be y × z, and `a b c` three variables.
- [ ] `sin x` must be **refused**, saying sin is a function and needs brackets. It used
  to become a variable called "sinx"; without the refusal it would now become sin × x,
  with a variable called "sin".
- [ ] Explicit brackets must be untouched: `2^(2*x)` with `x = 3` is **64**.

> **Remaining in `docs/KNOWN-DEFECTS.md`:** two entries, neither producing a wrong
> number — **B3** (a blank Bode chart at zero reference, which could not be reproduced)
> and **C2** (a huge exact rational converting to Infinity, the correct IEEE result at
> the boundary).

---

## 0m. New in v2.48.0 — heat maps

Table&rarr;Chart. Select a numeric table with several columns, load it, and choose
**Heat map** from "Show as".

- [ ] A month &times; region table must render as a grid of shaded cells, with the row
  labels down the left and the column names across the top.
- [ ] The **value must be printed inside each cell** where it fits. That is not
  decoration — colour alone is a poor readout of a specific number, and these figures
  get printed.
- [ ] A **colour bar with numeric ticks** must always appear beneath the grid, showing
  the low and high ends. A shaded grid with no scale cannot be read.
- [ ] The shading must be **one colour, light to dark** — not a rainbow. If you see
  green and yellow and red in one sequential scale, something is wrong: a rainbow
  implies an order the eye cannot recover.
- [ ] Put a **blank or text cell** in the middle of the table. It must render as an
  empty cell with a diagonal hairline, and a note must say it is NOT counted as zero.
  Check the low end of the colour bar is still the smallest real number.
- [ ] Turn on the **patent / black-and-white** style. The grid must render in greys,
  with no blue surviving, and still be readable.
- [ ] Try a table of **changes** with negatives and positives. (The diverging scale is
  available from the library API; the pane currently offers sequential shading.) With
  diverging selected, zero must be a neutral grey — not a colour — and the bar must
  name the midpoint.
- [ ] Load a **large** table, 30 columns by 40 rows. The cells become too small for
  numbers; a note must say the colour is then the only readout.
- [ ] **Export to PowerPoint.** A heat map must export as a **picture**. It must never
  come out as a bar or line chart — PowerPoint has no heat-map chart type, and
  substituting one would present different information under the same title.

---

## 0n. New in v2.49.0 — candlestick (OHLC) charts

Table&rarr;Chart. A table with one row per period and four numeric columns, then
**Candlestick** from "Show as".

- [ ] Columns named `Open`, `High`, `Low`, `Close` (any capitalisation, any order)
  must render one candle per row, with a wick from low to high.
- [ ] **The legend must state the convention in words** — "hollow = close at or above
  open", "filled = close below open". Direction must NOT rely on colour alone:
  green-up is a Western convention and red means UP across much of East Asia.
- [ ] Turn on the **patent / black-and-white** style. The chart must still distinguish
  up from down — hollow versus filled bodies — with no green or red anywhere.
- [ ] Rename the columns to something unrecognisable (`c1`, `c2`, `c3`, `c4`) but keep
  them in open/high/low/close order. It must still draw, AND say it assumed the
  conventional order and checked that against the data.
- [ ] Now **swap two of those unnamed columns** so high is no longer the largest. The
  chart must **REFUSE**, naming the row, and say that drawing it would produce candles
  that look plausible and are wrong. This is the important one: a silent wrong reading
  here is undetectable by eye.
- [ ] Put a row where the **high is below the close**. That row must be skipped with a
  note calling it a data error rather than a market event; the other rows still draw.
- [ ] Leave one cell **blank**. That period must leave a gap rather than shifting the
  later candles left — otherwise every subsequent candle is silently misdated.
- [ ] A table with only two or three columns must be refused, saying what it found.
- [ ] Load **120 periods**. Only some x labels should show, but every candle must be
  drawn, and a note should say so.
- [ ] **Export to PowerPoint** — it must go out as a picture, never as a bar or line
  chart.

---

## 0o. New in v2.50.0 — periodic table & atomic structure

Chemical mode, the new **Periodic table &amp; atomic structure** panel.

- [ ] Type `C` and choose **Element summary**. It must show atomic number 6, the held
  atomic weight, period 2 / group 14 / p-block, the configuration `1s2 2s2 2p2`, the
  abbreviated `[He] 2s2 2p2`, shells `K 2, L 4`, and 4 valence electrons.
- [ ] Type `26` instead of `Fe` — an atomic number must work as well as a symbol.
- [ ] Type `fe` (lower case). It must be **refused** with a message about
  case-sensitivity, not silently resolved.
- [ ] **The absent list must be part of the summary**, naming melting point, density,
  crystal structure, Mohs hardness, spectral emission lines, oxidation states — each
  with a reason. This is the point of the release: those are absent because they need
  a cited source, not because the elements lack them.
- [ ] The summary must NOT show an element **name**. "Au" must read "Au — atomic
  number 79", never "Gold" — 118 names would be a data list typed from memory.
- [ ] **Bohr model diagram** for `Na`: three rings with 2, 8 and 1 electrons. Count
  the dots. A note must say the Bohr model is a 1913 teaching model, not current
  physics.
- [ ] **Orbital filling diagram** for `O`: the 2p row must show one paired box and two
  singly-occupied boxes — Hund's rule — not two pairs. That is the fact the picture
  carries which `2p4` does not.
- [ ] Orbital diagram for `Og` (118). It must show **every** subshell; the figure grows
  taller rather than cropping. Compare with `Au` — the oganesson figure must be taller.
- [ ] Every configuration shown must be labelled a **prediction**. Check `Cr`: it will
  show `[Ar] 4s2 3d4`, which is what the aufbau principle gives; the measured
  configuration differs and the tool says it does not carry it.
- [ ] **The periodic table** view: 118 cells, group numbers across the top, period
  numbers down the side, the f-block in two rows beneath. Typing an element highlights
  exactly one cell.
- [ ] A note must say the f-block sits outside the numbered groups because the group-3
  question is unsettled — the tool must not take a side.
- [ ] **Insert** each view. Diagrams go in as figures; the summary goes in as text with
  its notes. The figure's alt text must carry the prediction caveat.

---

## 0p. New in v2.51.0 — element names, and the data behind them

Chemical mode, **Periodic table &amp; atomic structure**.

- [ ] Type `Au`. The summary must now read **"Gold (Au) — atomic number 79"**. Names
  were absent in v2.50.0 and are now fetched from PubChem and cross-checked.
- [ ] Type **`Gold`** instead of `Au` — searching by name must work. So must `Iron`,
  `oganesson` (any case), and the atomic number `79`.
- [ ] `Cr` must show BOTH configurations: the measured `[Ar]3d5 4s1` and the aufbau
  prediction `[Ar] 4s2 3d4`, with a line saying they DIFFER because chromium is one of
  the exceptions. Check `Cu`, `Au`, `Pd` and `U` the same way.
- [ ] An ordinary element like `O` must show the two agreeing, with no "differ" line.
- [ ] `Ds` (110) must show its configuration marked **"the source marks this
  predicted, not observed"** — for the superheavy elements even PubChem has no
  measurement, and the hedge must survive.
- [ ] The summary must now also show **oxidation states, electronegativity, first
  ionisation energy, electron affinity, atomic radius and standard state** where the
  source has them.
- [ ] **The atomic weight must still be the IUPAC one.** `Li` must read **6.94
  (IUPAC)**, not PubChem's 7.0 — the two genuinely differ and the held value wins.
- [ ] The "NOT CARRIED" list must now be SHORTER: melting/boiling points, density,
  crystal structure, Mohs hardness and spectral emission lines. Names and oxidation
  states must have left it.

---

## 0q. New in v2.54.0 — optics, photonics and entanglement

Engineering mode. The dropdown must now show two new groups, **Optics & photonics**
(8 tools) and **Quantum optics** (4), and the mode must state **101 calculators**.

- [ ] **Photon relations.** `1064` as a wavelength in nm must give **1.16526 eV**,
  **281.76 THz** and **9398.5 cm⁻¹**. Switch the selector to eV and type `1.16526`:
  the wavelength must come back to 1064 nm. Every entry point must round-trip.
- [ ] **Gaussian beam.** Waist `1 mm`, `1064 nm`, M² 1: Rayleigh range **2.9526 m**.
  Set the distance equal to that Rayleigh range and the radius must be exactly
  **√2 × the waist** with the wavefront radius **twice** the Rayleigh range.
- [ ] Set **M² = 4**: the Rayleigh range must fall by 4× and the divergence rise by 4×.
  M² = 0.5 must be **refused**, not computed.
- [ ] The result must say w is a **1/e² radius** and the divergence a **half-angle**,
  and must print the full angle beside it. Fill in the "design backwards" field and
  check the waist it returns reproduces the divergence you asked for.
- [ ] **ABCD.** The default `space 0.15 / lens 0.1 / space 0.3` must report **B = 0**
  and say the planes are conjugate, with magnification **−2**.
- [ ] Type `space 0.01 1.5` — a third argument must be **REFUSED** with a message
  naming the three-element `flat / space / flat` stack instead. (Free space takes a
  physical distance; the index enters through the interfaces.)
- [ ] Build that stack — `flat 1 1.5 / space 0.01 / flat 1.5 1` — and B must be
  **6.667 mm** (t/n), not 4.44 mm.
- [ ] End a system in glass (last element `flat 1 1.5`). The trace must say it is
  **leaving a medium of n = 1.5** and must NOT overstate the output radius by √1.5.
- [ ] **Resonator.** L 0.5, both radii 1 m: stable, g₁ = g₂ = 0.5, waist at the
  centre, equal spots on the two mirrors. Set L = 1 with both radii 1 (confocal): it
  must report **MARGINALLY stable** and give **no mode size**. Same for two flat
  mirrors (`inf`). L = 2.5 with radii 1 must report **UNSTABLE** and no waist.
- [ ] **Pulses.** 1 mJ, 10 ns, 1 kHz, Gaussian: average **1 W**, peak **93.94 kW** —
  and the note must say this is **0.939 E/τ, not E/τ**. Switch to rectangular and the
  peak must become exactly **100 kW**.
- [ ] With a 100 µm beam radius the peak fluence must be **twice** energy-over-area,
  and the note must say damage thresholds are quoted against the peak.
- [ ] **Refraction.** n₁ 1.5 → n₂ 1.0: critical **41.81°**, Brewster **33.69°**,
  reflectance **4%**. At 60° incidence it must report **total internal reflection and
  no transmitted angle**. Reverse to 1.0 → 1.5 and it must say there is **no critical
  angle**, not print a number.
- [ ] **Diffraction.** 500 nm through a 10 mm aperture: Airy half-angle **61 µrad**,
  disc **61 µm** at f = 500 mm. A 600 line/mm grating must list orders **−3…+3** and
  no others; a 3000 line/mm grating at 633 nm must list **only order 0**.
- [ ] **Fibre.** 1.4570 / 1.4520, 4.1 µm radius, 1550 nm: NA **0.1206**, V **≈ 2.0**,
  **single mode**. Drop the wavelength to 400 nm and it must become multimode with a
  mode count. Set the core index equal to the cladding and it must be **refused**.
- [ ] **Entanglement.** The default (0.7071, 0, 0, 0.7071) is a Bell state:
  concurrence **1**, entropy **1 ebit**. Change all four to 0.5 → concurrence **0**
  and it must say **product state**. Now make the last one `-0.5` → concurrence back
  to **1**. Phase alone must flip the answer.
- [ ] **CHSH.** The defaults give **S = 2.828** and must report a **Bell violation**.
  Enter 1, −1, 1, 1 (S = 4): it must say this **exceeds Tsirelson's bound** and is an
  error rather than a stronger result. A correlation of 1.5 must be refused.
- [ ] **Werner.** p = 0.6 must say **entangled but cannot violate CHSH** — the gap is
  the point. p = 0.3 must say separable; p = 0.8 must violate.
- [ ] **BB84.** 2% must give **0.7176** bits per sifted bit; 11% must be at the
  threshold with the rate at zero; **95% must be refused**, not report a positive
  "secure" rate.
- [ ] Every one of the twelve must insert into the document and the inserted text must
  carry its unit note (or, for the quantum four, the "everything here is
  dimensionless" note).

---

## 0r. New in v2.55.0 — chips & semiconductors

Engineering mode. A new **Chips & semiconductors** group of 4, and the mode must now
state **101 calculators** across **eighteen disciplines**.

- [ ] **Power.** 500 pF, 0.9 V, 2 GHz, α = 0.1: dynamic power **81 mW**
  (0.1 × 500e-12 × 0.81 × 2e9). Energy per 0→1 transition must be **405 fJ**, and the
  note must say it is C·V² and **not ½C·V²**.
- [ ] Double the voltage and the power must **quadruple**; double the frequency or the
  activity and it must **double**.
- [ ] Leave leakage blank: the result must say leakage is **not predicted here**, not
  imply it is zero. Enter 5 mA and the static term must be 4.5 mW with its share shown.
- [ ] **Thermal.** 15 W, 25 °C, θ = 0.5 / 0.2 / 1.3 K/W: sink **44.5**, case **47.5**,
  junction **55 °C**, total **2.0 K/W**. Against a 125 °C limit the margin is **70 °C**
  and the power at the limit is **50 W** — feed that 50 W back and the junction must
  land exactly on 125.
- [ ] Raise power to 60 W: it must say **OVER THE LIMIT by 20 °C**. The parallel-path
  caveat (a datasheet θja already assumes a board) must always be present.
- [ ] Type the ambient as `298 K` instead of `25`: it must convert and report having
  done so, not read 298 as Celsius.
- [ ] **Delay.** Defaults: the wire's **Elmore** and **50%** figures must be different
  numbers (0.5·RC against 0.38·RC), with Elmore the larger and labelled an upper bound.
- [ ] Set driver 1 kΩ, wire R and C both 0, load 1 pF: the 50% delay must be exactly
  **ln2 × 1 ns ≈ 693 ps**.
- [ ] Double both the wire's R and its C (i.e. double its length): the wire delay must
  **quadruple**, not double.
- [ ] `150 fF` must be accepted as a capacitance. (It was not a unit until v2.55.0, and
  the tool silently inserted nothing.)
- [ ] **Timing.** Defaults (1 ns period, 100/700/50/80/40 ps): setup slack **120 ps**,
  hold slack **110 ps**, required period **880 ps**, both PASS.
- [ ] Set skew to **+50 ps**: setup slack must **improve** to 170 ps and hold slack must
  **worsen** to 60 ps. This is the sign convention that matters most — if hold improves
  with positive skew the check is inverted.
- [ ] Set skew to **+200 ps**: setup still passes, hold **FAILS**, and the note must say
  slowing the clock does **not** fix a hold violation.
- [ ] Drop the period to 500 ps: setup must FAIL and name the **880 ps** it needs.
- [ ] Enter a shortest path LONGER than the longest: it must be **refused**, not solved.
- [ ] **Clear the θ sink-to-ambient field entirely.** It must be REFUSED as required,
  not read as 0 K/W. (It was: clearing it took the junction from 55 °C to 35.5 °C and
  reported it as within limit — the missing rise was exactly the heatsink the user was
  unsure about.) Same for a cleared activity factor in the power tool.
- [ ] Type `0.5 K/W` into a θ field: the written unit must be accepted, because the
  tool's own note promises a unit may be written out.
- [ ] Set the ambient ABOVE the maximum junction temperature (150 °C against 125): the
  power at the limit must be **0 W**, never negative, and it must say the ambient alone
  already exceeds the limit.
- [ ] In the power tool set the frequency to 0 with a leakage current entered: energy per
  cycle must read **n/a**, not a dynamic-only figure — leakage accrues with time, not per
  cycle.
- [ ] In timing, set the skew to 1 ns (longer than the whole path): the required period
  must read **0**, never a negative time, and hold must fail.
- [ ] All four must insert, and each must carry the converting unit note.

---

## 0s. New in v2.56.0 — aviation & avionics

Engineering mode. A new **Aviation & avionics** group of 5; the mode must now state
**101 calculators** across **eighteen disciplines**.

- [ ] **Atmosphere at 0 m**: 288.15 K, 101325 Pa, 1.225 kg/m³, 340.3 m/s, σ = 1. These
  are the defining constants and must come back exactly.
- [ ] **At 11 km** (the tropopause): 216.65 K and ≈ 22632 Pa. Check 12 km and 18 km
  report the SAME temperature — that layer is isothermal — and that 30 km is *warmer*
  than 21 km, because the next layer has a positive lapse rate.
- [ ] Set ISA deviation to **+15**: temperature and density must move, pressure must
  **not**. That is the hot-and-high effect and getting it backwards would be invisible.
- [ ] Enter **90000** m: it must be **refused** as outside the model, not extrapolated.
- [ ] The result must state the geometric→geopotential conversion at high altitude.
- [ ] **Airspeeds at sea level**, 100 m/s: TAS, EAS and CAS must all read 100.
- [ ] **At 10 km**, 250 kt TAS: TAS > CAS > EAS. If CAS and EAS are equal, the
  compressibility term has been lost.
- [ ] Push the speed until Mach exceeds 1: it must say the subsonic relation is **out
  of range**, not print a confident CAS.
- [ ] Every airspeed result must say **IAS is not computed** and why.
- [ ] **Polar** at the defaults: note the best L/D and the speed for it, then enter that
  speed — the achieved L/D must equal the best L/D. No other speed may beat it.
- [ ] Fly below the stall speed: it must say CL **exceeds CLmax** and that the drag
  figure is not meaningful.
- [ ] **Turn at 60°**: load factor exactly **2**, and the stall speed in the turn up by
  **41%** (×√2), not doubled. At **0°** the radius must be *infinite* and the rate zero,
  not a division by zero. At **90°** it must be refused.
- [ ] Check rate × radius = speed at any bank angle — that is the definition of a circle
  and a good check that neither is inverted.
- [ ] **Climb** with T = 20 kN, D = 10 kN, W = 100 kN, V = 80 m/s: ROC exactly **8 m/s**
  and the angle **5.739°** (the exact arcsine, not 5.730°).
- [ ] Set thrust to **0** with drag = W/15: it must report a descent with a glide ratio
  near 15, and with a height entered, a still-air range of 15 × that height.
- [ ] Make drag exceed the weight: **refused**, because there is no real flight-path angle.
- [ ] Type an airspeed as `250 kt` and an altitude as `35000 ft`: both must be accepted
  and the conversion reported. (Knots, nmi, fpm, mbar and inHg were not units before
  v2.56.0.)
- [ ] All five must insert, each carrying the converting unit note.

---

## 0t. New in v2.57.0 — robotics & kinematics

Engineering mode. A new **Robotics & kinematics** group of 6; the mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Forward kinematics** with links `0.5, 0.4, 0.2` at `30, 45, -20`: note the tip
  position, then confirm the tip orientation is the **sum** of the angles (55°) — that is
  what makes the angles relative rather than absolute.
- [ ] Links `1, 1` at `0, 0`: tip at exactly (2, 0). At `0, 180`: tip at (0, 0).
- [ ] Mismatched counts (3 links, 2 angles) must be **refused** with both counts named.
- [ ] **Inverse kinematics**, L1 0.5, L2 0.4, target (0.6, 0.3): **two** solutions, one with
  θ₂ positive and one negative. Feed each pair back into the forward-kinematics tool — both
  must land on (0.6, 0.3). That round trip is the real test.
- [ ] Target (2, 0) with those links: **NO SOLUTION**, outside by 1.1 m, and it must say so
  rather than returning the nearest reachable pose.
- [ ] Target (0.05, 0): inside the **inner hole** of the annulus — also unreachable, and the
  note must say an arm with unequal links cannot reach near its own base.
- [ ] Target (0.9, 0) — exactly L1+L2: **one** solution, branch `coincident`, and a
  **SINGULAR** warning. Same at (0.1, 0), full fold.
- [ ] **Jacobian** at θ₂ = 60°: non-singular. Set θ₂ = 0: det J must be 0, manipulability 0,
  condition number **infinite**, and it must say rank 1. Set θ₂ = 180°: singular again.
- [ ] Change θ₁ with θ₂ fixed: det J must **not** change — it depends only on the elbow.
- [ ] With L1 = L2 = 1, θ₁ = 0, θ₂ = 90°, tip force (10, 0): torques must be **−10 and −10**.
  With force (0, 10): **10 and 0**. That is Jᵀ F, not J F.
- [ ] Fully extended (θ₂ = 0) with a transverse load: the shoulder torque must be
  (L1+L2)·F and the elbow L2·F.
- [ ] **DH** with the default 3-row table: the rotation matrix rows must each have length 1
  and be mutually perpendicular. A 2-row planar table (alpha 0) must agree with the
  forward-kinematics tool.
- [ ] DH rows `0 0 0 90` then `90 0 0 0`: **gimbal lock** must be reported and **no**
  roll/pitch/yaw printed — only the matrix.
- [ ] A row with three numbers instead of four must be **refused**, naming the row.
- [ ] **Profile** d 1.5, v 2, a 5: trapezoidal, and 2×accel-distance + cruise must equal 1.5.
- [ ] d 0.1 with the same limits: **TRIANGULAR**, cruise time exactly 0, peak speed below 2
  and equal to √(a·d). The note must say computing it as d/vmax + vmax/a would promise a
  move the machine cannot make.
- [ ] **Differential drive**, left 0.8 right 1.2 track 0.4: body 1.0 m/s, yaw **1.0 rad/s**
  (2.0 would mean the half-track was used), radius 1.0 m.
- [ ] Equal wheels: turn radius **infinite**, not zero. Equal and opposite: radius exactly 0.
- [ ] Switch to “body velocity → wheel speeds”, enter the body numbers you just got, and the
  wheel speeds must come back to 0.8 and 1.2 exactly.
- [ ] **The singular note must agree with the number beside it.** L1 0.7, L2 0.45, target
  (1.15, 0): the solution row reads θ₂ ≈ 0 and the note must say **fully extended
  (theta2 = 0°)** — it used to say 180° for more than half of all extended link pairs.
  Target (0.25, 0) must say **fully folded (theta2 = 180°)**.
- [ ] Enter link lengths **space separated** (`0.5 0.4 0.2`) in forward kinematics: it must
  work, not report that the values are not numbers.
- [ ] In the Jacobian tool enter the links in **mm** (`500`, `400` with unit `mm`): the
  conversion must be reported and the torque must still be a true **N·m**, not N·mm
  mislabelled. In differential drive, entering `1.2 m/s` in a wheel field must be accepted.

### Reported from the pane and fixed in this release

- [ ] **Spectra → aspirin → MS fragmentation (EI).** The formula column must show real
  formulas throughout — **C9H6O3** for the water loss and **C8H8O2** for the CO₂ loss —
  not the bracket placeholders `[M-H2O]` and `[M-CO2]` it used to print while every other
  row held a proper formula. Everything must be plain ASCII, so it survives a plain-text
  insert into Word.
- [ ] **Stats → Linear regression.** There must now be a **figure** (fit, residuals and a
  normal Q-Q), where before there was none at all — and an **Insert chart** button beside
  Insert result. Insert both and confirm the picture lands in the document.
- [ ] The chart button must be **disabled** for a calculator with no figure (descriptive
  statistics) and enabled for multiple regression, polynomial regression and survival.

- [ ] All six must insert; the four kinematics tools carry the same-unit note and the two
  with real dimensions carry the converting note.

---

## 0u. New in v2.58.0 — computation & information

Engineering mode. A new **Computation & information** group of 6, completing the four
domains. The mode must state **101 calculators** across **eighteen disciplines**.

- [ ] **Speedup**, p = 0.95 on 16 processors: Amdahl **9.14x**, Gustafson **15.25x**,
  ceiling **20x**. Both must be shown — reporting one alone answers half the question.
- [ ] Set p = 0.5 with 100 processors: it must say the ceiling (2x) is **BELOW** the
  processor count, i.e. more cores cannot help at all past that point.
- [ ] Set p = 1: the ceiling must read **none (perfectly parallel)**, not a number.
- [ ] Enter a measured speedup equal to the Amdahl figure: Karp-Flatt must return exactly
  the serial fraction **0.05**.
- [ ] **Entropy** of `0.5, 0.25, 0.125, 0.125`: exactly **1.75 bits**. A fair coin
  (`0.5, 0.5`) is **1**; a fair die (six equal counts) is **log₂6 = 2.585**.
- [ ] Include a zero: `0.5, 0.5, 0, 0` must still give 1 bit, **not NaN**, and must say the
  zero contributed nothing.
- [ ] Enter counts (`30, 30`) rather than probabilities: it must normalise and **say so**.
- [ ] **Channel**, 20 MHz at 25 dB: SNR linear **316.2**, and the capacity must equal
  B·log₂(1+SNR). Change 20 dB → the linear ratio must be **100**, not 10 — 10 would mean
  the amplitude form had been used.
- [ ] Set SNR to a negative dB: capacity must stay **positive** and say so (below-noise
  communication is how spread spectrum works).
- [ ] BSC at p = 0.5: capacity exactly **0**. At p = 0.9 it must equal p = 0.1 by symmetry.
- [ ] **Collisions**: 23 items in 365 values → **0.5073**, the classic birthday answer.
  57 items → about **0.99**.
- [ ] 40 items in 365: expected pairs **2.14** while the probability is **0.891** — the two
  must be clearly separate, since the expectation exceeding 1 is exactly the trap.
- [ ] 400 items in 365 values: probability exactly **1**, with the pigeonhole reason given.
- [ ] A 64-bit hash: the 50% count must be about **5.1 × 10⁹**.
- [ ] **Floating point** at 1: epsilon **2.22e-16**, decimal digits **15.95**. At 10⁶ the
  ULP must be about **1.16e-10** — a million times larger, which is the whole point.
- [ ] Subtract 1 from 1.0000001: about **7 digits lost**, and the note must say the
  subtraction itself is exact and the error was already in the inputs.
- [ ] **Scaling** from (1000, 0.12) to (4000, 1.95): exponent ≈ **2.0**, nearest class
  quadratic. Predicting at 10⁶ must warn this is **extrapolation**, not interpolation.
- [ ] Enter a larger size with a SMALLER runtime: the exponent goes negative and it must
  call that **noise**, not a complexity class.
- [ ] Equal input sizes must be **refused** — no leverage on the exponent.
- [ ] All six must insert.

### Units added with this release

- [ ] `1 kB` → 1000 B and `1 KiB` → 1024 B: the decimal/binary split must be kept.
- [ ] `1 TB` → GiB must be about **931** — the missing-disk-space number.
- [ ] **`KB` must mean kilobyte**, never kilobit. `kb`, `Mb` and `b` must be REFUSED
  rather than guessed at, because a lowercase fallback would make a typed `KB` an 8x error.
- [ ] `1 MB/s` → `Mbit/s` must be **8**. `B` → `m` must be refused.

---

## 0v. New in v2.60.0 — energy & power

Engineering mode. A new **Energy & power** group of 8. The mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Wind** at the defaults (90 m rotor, 8 m/s, Cp 0.45): swept area **6362 m²**,
  power in the wind **1995 kW**, Betz bound **1182 kW**, output **897.8 kW**. The
  Betz bound must be exactly 16/27 of the wind power.
- [ ] Set Cp = 0.7: **refused**, naming the Betz limit — not computed, not clamped.
- [ ] Set rpm = 15: tip-speed ratio **8.836** appears.
- [ ] **Solar** at the defaults (1000 W/m², 20 m², 0.21, −0.35 %/°C, 30 °C ambient,
  NOCT 45): output at 25 °C cells **4.2 kW**, cell temperature **61.25 °C**,
  derated output **3.667 kW**, thermal derating **12.69 %**.
- [ ] Efficiency entered as **21** (the percentage): refused, telling you to write 0.21.
- [ ] **Fill factor** at the defaults: Pmp **329.1 W**, FF **0.7966**. Swap Vmp and Voc:
  refused, saying they are probably swapped.
- [ ] **Hydro** at the defaults (2 m³/s, 25 m, 0.85): output **416.8 kW**. Type the flow
  as `500 gal/min`: the conversion must be REPORTED in a "Units read" block and the
  output becomes **6.574 kW**.
- [ ] Head loss = 25 (the whole gross head): refused — the penstock consumed the head.
- [ ] **Battery** at the defaults (3.6 V / 5 Ah cells, 13S4P, DoD 0.9, 10 A load):
  **46.8 V**, **20 Ah**, **0.936 kWh** (usable **0.8424**), C-rate **0.5C**, runtime
  **1.8 h**. Type the capacity as `5000 mAh`: identical results, conversion reported.
- [ ] Peukert exponent 1.1: corrected runtime **1.416 h** shown BESIDE the 1.8 h figure,
  with the 20-hour-rating caveat.
- [ ] **Combustion** of CH4: molar mass **16.043 g/mol**, O₂ **2 mol/mol**, AFR
  **17.12**, CO₂ **2.743 kg/kg**, H₂O **2.246 kg/kg**. Add HHV 55.5 MJ/kg: LHV
  **50.02 MJ/kg** — the published methane figure — and CO₂ intensity **0.1779 kg/kWh**.
- [ ] C8H18: AFR **15.03** (the gasoline number), CO₂ **3.083 kg/kg**. CO2 as the
  formula: refused — it has nothing left to oxidise.
- [ ] **Formatting (v2.61.0):** the combustion title typesets your formula — typing
  `C8H18` must display **C₈H₁₈** — and every species line reads **O₂ / CO₂ / H₂O /
  SO₂** with real subscripts, in the pane AND in the inserted text. Paste the
  displayed **C₈H₁₈** back into the field: same answer, not a refusal. Unit labels
  read **m², m³/s, W/m², kg/m³** with real superscripts, and typing `m³/s` as a
  unit converts the same as `m^3/s`.
- [ ] **LCOE** at the defaults (1.5 M capex, 30 k opex, 3500 MWh, 7%, 25 yr):
  **45.35 per MWh** (0.04535 per kWh), PV of costs **1,849,609**, PV of energy
  **40,788 MWh**. The notes must say the energy is discounted and why.
- [ ] **Capacity factor** at the defaults (2 MW, 6100 MWh): **0.3482 = 34.82 %**,
  full-load hours **3050**. Enter 20,000 MWh: refused, showing the 17,520 MWh maximum.
- [ ] All eight must insert.

### Units added with this release

- [ ] `1 kWh` → MJ must be **3.6**; `1 therm` → BTU must be exactly **100000**.
- [ ] `1000 mAh` → Ah must be **1**, and `1 Ah` → C must be **3600**.
- [ ] **`mWh` must be REFUSED** rather than read as megawatt-hours — a lowercase
  fallback would turn a coin-cell energy into a 10⁹ error. `MWh` cased correctly works.
- [ ] `1 gal` → L must be **3.785**, and a flow typed as `gal/min` converts.

---

## 0w. New in v2.62.0 — energy depth & grid power

Engineering mode. **Energy & power** grows 8 → 16; the mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Three-phase** at the defaults (400 V, 100 A, pf 0.8): S **69.28 kVA**,
  P **55.43 kW**, Q **41.57 kVAR**, wye phase voltage **230.9 V**. Enter the power
  instead of the current: the current comes back as **100 A**.
- [ ] **PF correction** at the defaults (100 kW, 0.7 → 0.95, 400 V, 50 Hz): bank
  **69.15 kVAR**, current 206.2 → **151.9 A**, loss reduction **45.7 %**, delta
  capacitance **458.6 µF** per phase (wye exactly 3× that). Target below present:
  refused with the reason.
- [ ] **Cable drop** at the defaults (Cu, DC, 20 m, 16 A, 2.5 mm², 230 V, 3% target):
  drop **4.414 V = 1.919 %**, loss **70.6 W**. The computed drop is UNDER the 3%
  target, so the minimum section reads **1.60 mm²** — smaller than the entered 2.5,
  which is the consistent answer, not a bug. Switch to AWG 12 (blank the mm²):
  section **3.309 mm²**.
- [ ] **Wind shear** at the defaults (6 m/s, 10 → 80 m, α 0.143, z₀ 0.03): power law
  **8.078 m/s**, log law **8.148 m/s**, disagreement under **1 %**, power ratio
  **2.44×**. Both models shown, neither chosen.
- [ ] **Weibull** at the defaults (k 2, c 8, turbine 3/12/25): mean **7.09 m/s**,
  energy pattern factor **1.91**, capacity factor **0.30**, hours in band **86.9 %**
  — and CF must be BELOW the hours-in-band figure.
- [ ] **Flue gas** at the defaults (CH4, 3% dry O₂): excess air **14.9 %**, dry CO₂
  **10.06 %** with ultimate **11.74 %**, and the dry percentages sum to 100.
  Enter 21%: refused — the probe is reading air.
- [ ] **Storage** at the defaults (10 kWh/day, 2 days, DoD 0.8, rt 0.9, inv 0.95,
  48 V, no capex): bank **27.74 kWh / 577.9 Ah**, daily charge **11.70 kWh**. Add
  capex 10000: LCOS appears, and its note says charging energy is EXCLUDED.
- [ ] **Sun position** at the defaults (40°, day 172): declination **23.45°**, day
  length **14.85 h**, noon elevation **73.4°**, H₀ **11.59 kWh/m²** (ceiling, before
  the atmosphere). Latitude 78, day 355: day length **0 h** as an answer, not an error.
- [ ] **Wind + altitude**: blank the density, set altitude 2000 m → the result notes
  density **1.0065 kg/m³ from the ISA** — the same atmosphere the aviation tools use.
- [ ] All eight new tools insert, subscripts and superscripts intact (O₂, m², kVAR).

---

## 0ax. New in v2.89.0 - EVERY calculator draws (130 of 130)

The final 24 tools insert figures; the ratchet closes at 130 of 130.
Spot-check the geometric ones — equal aspect is the thing to eyeball:

- [ ] **Circular orbit**, defaults (Earth, 400 km) → a grey disc with a thin
  blue ring hugging it — the ring must be a CIRCLE, and barely off the
  surface (that closeness is the point).
- [ ] **Hohmann transfer**, defaults (300 → 35 786 km) → two dashed circles,
  a blue half-ellipse tangent to both, "burn 1" on the INNER circle and
  "burn 2" on the outer. Swap the altitudes (35786 → 300) → burn 1 moves to
  the OUTER circle, because that is now the departure orbit.
- [ ] **Wind triangle**, defaults → three arrows closing exactly: blue air
  vector, red wind vector, green ground vector; drift 11.3° noted below.
- [ ] **Differential drive**, defaults (left 0.8, right 1.2) → three
  concentric circles about a red cross to the LEFT of the robot (faster
  right wheel = left turn), the faster wheel on the OUTER dashed circle.
  Swap the wheel speeds → the whole construction mirrors to the right.
- [ ] **2R inverse kinematics**, defaults → two arms (solid and dashed) from
  the base to the same target cross inside the annulus. Set the target to
  (2, 0) → NO arm, just the annulus and the stranded cross, captioned with
  the miss distance.
- [ ] **DH forward kinematics**, defaults → TWO figures, plan and elevation;
  the first link leaves the plane so it is short in plan and tall in
  elevation — and the second link must be the SAME drawn length in both
  views (shared scale).
- [ ] **Signal sampling** (Biomedical), defaults (500 Hz, 550 Hz tone) → the
  fold diagram with the orange interference dot at (550, 50): folded to
  50 Hz, dead inside an ECG's band. Set fs **150** → the red "signal max
  FOLDS" dot shows the signal's own top aliasing — the unfixable case.

## 0aw. New in v2.88.0 - Computation, chips, optics and quantum draw

Twenty-two more tools insert figures (ratchet 84 → 106 of 130). Spot-check:

- [ ] **Junction temperature**, defaults → "The thermal ladder": four blue
  bars stacking 25 → 44.5 → 47.5 → 55 °C, green junction bar, dashed red
  line at 125 °C far right, "within limit".
- [ ] **Setup/hold timing**, defaults → "The setup budget": period bar 1000
  ps, three red take-away bars, green "setup slack 120" bar ending right of
  the dashed slack = 0 line, "PASS".
- [ ] **Parallel speedup**, defaults → "The two laws diverge": Amdahl bending
  toward the grey ceiling at 20×, Gustafson climbing straight on log
  processors, red dot at 16.
- [ ] **Hash collision**, defaults (1e6 items, 64 bits) → "The birthday
  curve" on a LOG item axis: S-curve crossing the 0.5 line at ~5×10⁹, red
  dot far left at 10⁶ — visibly nowhere near a collision.
- [ ] **Laser cavity stability**, defaults (g₁ = g₂ = 0.5) → "The stability
  diagram": both hyperbola branches, axes, green dot inside the first
  quadrant's stable region. Set L **3** (g = −2) → red dot outside, labelled
  unstable.
- [ ] **CHSH Bell test**, defaults → "S against both bounds": red S stem
  reaching exactly the green Tsirelson line at 2.83, four blue contribution
  stems at 0.7071 each, orange classical lines at ±2.
- [ ] **BB84 key rate**, defaults (2%) → "The Shor-Preskill bound": rate
  curve falling from 1 to the flat zero tail, grey threshold stem at 11%,
  red dot at (2, 0.717).

## 0av. New in v2.87.0 - Audio and video draw

All 14 Audio & acoustics and Video & display tools insert figures (ratchet
70 → 84 of 130). Spot-check four:

- [ ] **Sampling & aliasing**, defaults (44.1 kHz, 20 kHz) → "The fold
  diagram": a sawtooth rising to 22 050 Hz and folding back down, twice
  more across the axis; green dot at (20k, 20k), red dot at the first peak.
- [ ] **Delay & comb filtering**, defaults (1 ms) → "The comb": a scalloped
  response on a log frequency axis, red dots on the −30 dB floor at 500,
  1500, 2500… Hz, green dots at +6 dB at 1000, 2000… Hz.
- [ ] **Colour gamut coverage**, defaults (DCI-P3 vs sRGB) → two triangles
  on u′v′ axes, the dashed sRGB triangle entirely INSIDE the solid blue
  P3 one; title says 100.0% coverage. Swap to sRGB vs BT.2020 → the solid
  triangle now sits inside the dashed one.
- [ ] **End-to-end latency budget**, defaults → bars for the four stages
  with network (30 ms) in red, then grey "sum 63 ms" and green "delivered
  66.67 ms" — the delivered bar longer than the sum, because the display
  quantises to the next refresh.

## 0au. New in v2.86.0 - All seventeen Energy tools draw

The whole Energy & power discipline inserts figures (ratchet 53 → 70 of 130).
Spot-check five; the rest follow the same pattern (figure + data, legend
outside the frame, working point marked in red).

- [ ] **Wind turbine power**, defaults → "Power goes as the cube of wind
  speed": three rising curves (grey wind, blue Betz, green Cp = 0.45) with
  the red point ON the green curve at 8 m/s.
- [ ] **Three-phase power**, defaults (400 V, 100 A, pf 0.8) → "The power
  triangle": blue base P = 55.4 kW, red vertical Q = 41.6 kVAR, green
  hypotenuse S = 69.3 kVA, arc φ = 36.9°. Set pf **1** → the triangle
  collapses to one line and SAYS so.
- [ ] **Power factor correction**, defaults → "The cost of chasing unity":
  rising curve with the knee steepening toward pf 1.0, red point at 0.95.
- [ ] **Weibull wind resource**, defaults → the density curve with three grey
  vertical lines (cut-in 3, rated 12, cut-out 25) and red mean/mode dots
  near the peak.
- [ ] **Sun position**, defaults (40°, day 172) → the elevation arc peaking
  at 73.4° at noon, blue sunrise/sunset dots where it crosses the grey
  horizon line, night below.

## 0at. New in v2.85.0 - Control, vibration and electronics draw

Eight more tools insert a figure (ratchet 45 → 53 of 130).

- [ ] **Poles, zeros & stability**, defaults (1 / s³+3s²+2s+1) → "Pole-zero
  map": three × marks LEFT of the vertical axis, pink shading to its right
  labelled "unstable", conjugate pair mirrored exactly about the horizontal
  axis. Change the denominator to `s^2-s+1` → two × in the shading, red.
- [ ] **PID & closed loop**, defaults (plant 1/(s³+3s²+2s), Kp 1) →
  "Closed-loop step response": rises and settles near 1.
- [ ] **Natural frequencies & mode shapes**, defaults (2-mass chain) → "Mode
  shapes": two curves from the anchor at DOF 0, mode 1 both masses same
  sign, mode 2 opposite signs.
- [ ] **Forced response**, defaults (ω 8) → "Frequency response, DOF …": two
  sharp peaks (the resonances) on a log amplitude axis, red point at ω = 8
  between them.
- [ ] **Op-amp circuits**, defaults (non-inverting, GBW 1 MHz) → "Gain
  against frequency": flat blue line at 40 dB meeting the grey open-loop
  roll-off, red −3 dB point at the corner (10 kHz). Switch to Integrator →
  a single falling line crossing 0 dB at the corner frequency.
- [ ] **Analogue filter design**, defaults (Butterworth low-pass) → response
  curve with the green passband point ON the curve at ω 1000 and the red
  stopband point at or ABOVE the curve at ω 4000.
- [ ] **CHEBYSHEV REGRESSION (v2.85.0).** Family Chebyshev, type High-pass,
  ωp **4000**, ωs **1000**, ripple 1, attenuation 40 → the passband-edge
  marker sits ON the curve at −1 dB (previously the curve was 79 dB below
  it: an odd-order filter was built one degree too high), and the delivered
  stopband attenuation reads ~42 dB, not ~120.
- [ ] **DC operating point**, defaults (5 V divider) → "Power per element":
  V1 bar LEFT of the zero line (green, delivering), R1 and R2 bars right
  (blue), R2's bar twice R1's length, labels in mW-range numbers.
- [ ] **Truth table & minimisation**, defaults (4 variables) → "Truth table
  as waveforms": lanes A-D counting in binary, `out` lane at the bottom
  high exactly at the listed minterms.

## 0as. New in v2.84.0 - Thermo and aero draw

Five more Engineering tools insert a figure (ratchet 40 → 45 of 130).

- [ ] **Ideal-gas process**, defaults (isentropic, air, 1 bar → 10 bar) →
  "isentropic process on the P-v plane": a steep curve from the green
  `state 1` (0.86 m³, 100 kPa) up-left to the red `state 2` (0.17 m³,
  1000 kPa). Switch to Isothermal with the same fields → a shallower
  hyperbola. Isochoric with end T 327 → a vertical segment.
- [ ] **Power cycles**, defaults (Otto, r 8, 27/1527 °C) → "Otto cycle on the
  P-v plane": a closed four-leg loop on a LOG pressure axis, red markers at
  the four corner states, top-left corner at pressure ratio ~48. Switch to
  Diesel → the top of the loop is a horizontal (isobaric) leg. Brayton → the
  loop's top AND bottom are horizontal.
- [ ] **Standard atmosphere**, defaults (10 000 m) → "Standard atmosphere
  profile": red T/T₀ with a visible kink at 11 km, blue p/p₀ and green ρ/ρ₀
  falling smoothly, black `this altitude` marker on the green curve at 10 km
  (ρ/ρ₀ ≈ 0.34).
- [ ] **Lift, drag polar & stall speed**, defaults → "Drag polar": blue
  polar, grey ray from the origin touching it at the green `best L/D` point
  (CL 0.67), red `this flight` point lower on the curve (CL 0.43).
- [ ] **Level turn**, defaults (45°, 120 kt) → "Turn radius against bank":
  falling curve on a log radius axis, red `this bank` point at 45° / ~389 m.
- [ ] Every legend in the five figures sits OUTSIDE its plot frame, covering
  no data.

## 0ar. New in v2.83.0 - Fluids, thermal and fatigue draw

Six formerly text-only Engineering tools now insert a figure with their data
(ratchet 34 → 40 of 130). Every legend sits OUTSIDE its plot frame (v2.82.1).

- [ ] **Endurance limit & notch factor**, defaults (Sut 700, machined, 25 mm,
  bending, 0.99) → inserts the text AND an "Estimated S-N curve" figure with
  TWO lines: grey `uncorrected Se'` above blue `corrected Se`, both starting
  at the same point at 10³ cycles, the blue one flattening at 10⁶. Switch the
  material class to non-ferrous → NEITHER line flattens; both keep falling to
  the right edge.
- [ ] **Finite life & cumulative damage**, defaults (three blocks) → "Load
  blocks against the S-N line": blue S-N line, three red points BELOW or ON
  it — the 280 MPa block sits essentially ON the line (and carries the
  biggest damage share in the table), the 420 one well under it.
- [ ] **Pipe flow & head loss**, defaults → "System head curve": a rising,
  steepening blue curve with the red `this flow` point ON the curve (15.7 L/s,
  ~3.8 m).
- [ ] **Composite wall / pipe insulation**, defaults → "Temperature through
  the wall": a falling profile from 20 °C to −5 °C with a vertical drop at
  x = 0 (inside film), a shallow slope across the brick, a steep one across
  the mineral wool, and a final vertical drop at the outer face.
- [ ] **Open-channel flow**, defaults → "Specific energy diagram": a C-shaped
  blue curve, grey `E = y` line, red `this flow` point on the UPPER
  (subcritical) arm above the green `critical depth` point.
- [ ] **Pump NPSH & cavitation**, defaults (typed losses) → "Where the suction
  head goes": five horizontal bars — surface pressure and static head building
  right, vapour pressure and suction losses cutting back, the green NPSH
  available bar, the dashed red NPSH-required line left of its end, and
  "clears NPSHr" in the corner.
- [ ] Same tool, losses from **Pipe geometry** → a SECOND figure, "NPSH
  available against flow": blue curve falling with flow, flat red requirement
  line, green working point between them.
- [ ] Same tool, static head **-8** (pump above the liquid), vapour pressure
  **101000** (near-boiling water) → refused or CAVITATES verdict; if a figure
  inserts, its NPSH-available bar is RED and the corner says "CAVITATES", and
  no label runs off the right edge of the image.

## 0aq. New in v2.82.0 - Reliability

Engineering: a **twentieth discipline**, **Reliability (5)**, and the mode states
**130**. All five insert a figure.

### Life data: Weibull fit
These are the strings the pane prints, not rounded versions of them. A mismatch
in the last digit is a real failure, not a tolerance.

- [ ] Defaults (8 failures, 4 units still running at 2000 h) → beta **1.64**, eta
  **1750.7 h**, B10 **443.84 h**, median **1400.1 h**, mean life **1566.3 h**,
  hazard **constant hazard**, interval on beta **0.8268 to 2.786**, failures
  **8 of 12**. The figure is a probability plot: points close to a straight line,
  with the fitted line through them.
- [ ] The "Report reliability at this age" default of 1000 h → **67.09 %**.
- [ ] That interval straddles 1, so it must NOT claim wear-out. A beta of 1.64
  from eight failures is not evidence of anything — that is the point of the
  interval.
- [ ] The output states **4 of the 12 units had not failed** and that they are in
  the likelihood rather than discarded.
- [ ] Change every `+` to `F` (pretend the survivors failed at 2000 h) → **eta
  falls from 1750.7 h to 1454.4 h**. That is the bias the suspensions exist to
  prevent.
- [ ] Type just two lines, `100 F` and `250 F` → it still fits, and reports the
  regime as **constant hazard** with an interval running from about **0.57 to
  7.07**. A fitted beta of 2.6 from two units is NOT wear-out, and it must not say
  it is.
- [ ] Type `900 maybe` on a line → refused, naming `"maybe"`, and the message
  offers 1/F, 0/+ and a duration unit.
- [ ] **The two ambiguous letters must be refused, not guessed.** `412 s` → refused,
  naming *seconds, or "suspended"*. `412 d` → refused, naming *days, or "dead"*.
  Reading either one silently is a factor of 3600 or 24.
- [ ] Units on the time DO convert here: `3 day` and `3day` are both **72 h**,
  `412 sec` is **0.1144 h**, `412 h` is 412. Write `sec` and `day` in full.
- [ ] `0x10 F` → refused. It is not a life in hours, whatever `Number()` thinks.
- [ ] Delete every `F` so nothing has failed → **"Nothing has failed yet"**.
- [ ] Leave one failure and censor the rest → **"One failure cannot fix both a
  shape and a scale."**
- [ ] Set all four times to the same number → refused, naming the shape parameter
  running to infinity.

### Series and parallel systems
- [ ] Defaults, **series**, 8760 h → **10 units**, reliability **1.0698 %**,
  chance of failure **0.9893**, system rate **5.180e-4 per hour**, MTTF
  **1930.5 h**. The **"Where the failures come from"** block reads **Pump 46.3 %,
  Control valve 29.0 %, Sensor 23.2 %, Controller 1.5 %**. Figure: system curve
  BELOW the **worst** single unit.
- [ ] Switch to **parallel** → reliability **99.9996 %**, chance of failure
  **3.645e-6**, MTTF **146190 h**. No system failure rate is quoted, because a
  parallel system has no constant one. The **common-cause** note is present.
- [ ] The parallel figure compares against the **best** single unit, not the
  worst — the claim is that the system outlives *every* part, and only the best
  part tests that. The legend and caption must both say "best single unit".
- [ ] Set a quantity to `2.5` → refused, naming the whole quantity.
- [ ] Write a line as `Pump 1.2e-4 2` with no commas → still read.
- [ ] `Bearing 6205 1.5e-5` (a part number in the name, no commas) → read as one
  bearing at 1.5e-5/h. It must NOT complain that 1.5e-5 is not a quantity.
- [ ] `Motor, 1,200, 2` → refused, naming the **four** comma fields and the
  thousands separator. Silently reading it as 200 failures an hour is the defect
  this refusal exists for.
- [ ] Set one component's rate to `0` and add enough others to exceed 12 units →
  the note must say **a branch never fails**, not that an alternating sum lost
  accuracy.
- [ ] Enter thirteen components at differing rates, parallel → the mean time to
  failure is **not reported**, and it says why. Reliability is still shown.

### k-out-of-n
- [ ] Defaults 2 of 3 → one unit **64.5326 %** (derived from the rate and the
  mission, and it says so), system **71.1850 %**, chance of failure **0.2881**,
  mean life factor **0.8333**, MTTF **16667 h**. Figure: a curve above the
  diagonal with the operating point marked in red.
- [ ] Set k = 3 (all of them) → **26.8743 %**, which is BELOW one unit's
  64.5326 %, and the note calls it **a SERIES system wearing redundant
  clothing**.
- [ ] Type a unit reliability of `0.9` while leaving the rate at 5e-5 → a note
  says **THE TWO FIELDS DISAGREE** and names both numbers. Two inconsistent
  inputs must not produce two confident numbers in silence.
- [ ] Set k = 5, n = 3 → refused: **you cannot need more units than you have**.
- [ ] Set n = 500, k = 250, unit reliability 0.6 → a real number, not `NaN`.

### Active or standby spares
- [ ] Defaults → single **60.6531 %**, active **93.9084 %**, standby **98.5612 %**;
  mean lives **10000 / 18333 / 30000 h**. The figure shows a straight standby
  line against a flattening active curve.
- [ ] Set the rate to `1e-7`, n to `10`, the mission to `10000 h` → the
  short-mission note compares FAILURE probabilities and they are **9.95e-31
  active** and **2.75e-37 standby**, not `0`. Two zeroes in the sentence that
  says "that is where the difference lives" is the failure.
- [ ] Set n to `200` → the figure's x axis reaches **200**, so the arrangement
  asked about is on the figure the caption describes.
- [ ] The notes state BOTH assumptions — the spare **does not age**, the switch
  **never fails** — and that a switch with its own rate can make standby worse.
- [ ] Set n = 1 → all three agree, and it says there is no spare.
- [ ] Set the rate to 0 → nothing overflows; it says nothing ever fails.

### Availability
- [ ] Defaults (MTBF 2000 h, MTTR 8 h, 8760 h) → **99.6016 %**, unavailability
  **0.003984**, up **8725.1 h**, down **34.9 h**, **4.363 failures expected**.
  The note says **INHERENT** and names what is not counted.
- [ ] Enter 5 in series → **98.0238 %** and **173.12 h down**, against 34.9 for
  one.
- [ ] Set MTTR to `0` → availability exactly 100 %, and the note says **by
  construction**.
- [ ] Set MTBF to `0` → refused.

### Units, on every tool in this discipline
- [ ] Enter a mission time of `3 day` → read as **72 h**, and the "Units read"
  block says so.
- [ ] Enter `5 yr` → **refused by name**. A year is 8760 h, 8766 h or 2000
  operating hours depending on who is asking, and the tool will not pick.
- [ ] Enter a failure rate as `1e-5 /h` → refused. Rates are plain numbers per
  hour, and the unit note says so.

---

## 0ap. New in v2.81.0 - Fluids breadth and fracture mechanics

Engineering: **Fluids 8**, **Fatigue & machine design 6**, mode states **125**.
All seven new tools insert a figure.

**Orifice, venturi & nozzle metering**

- [ ] Defaults (orifice, D 100 mm, d 50 mm, 20 kPa, water, Cd 0.61): flow about
  **0.00783 m³/s**, β **0.5**, approach factor **1.0328**.
- [ ] Leave the loss fraction **blank**: no permanent-loss figure is reported,
  and a note says it is not predicted and why. It must NOT invent one.
- [ ] Type **0.62** into the loss fraction: the loss is reported as 62% of the
  differential and the note says the figure is the one you supplied.
- [ ] Type **1.2**: refused - a meter cannot lose more pressure than it develops.
- [ ] Set the throat to **75 mm** (β 0.75): the approach factor rises above
  **1.19**, and a note warns that standards cap around there.
- [ ] Set the throat equal to or larger than the pipe: **REFUSED**.
- [ ] Set Cd to **1.5**: refused as above the frictionless ideal.

**Pump & system curve**

- [ ] Defaults: operating point about **0.0756 m³/s at 21.4 m**. The figure shows
  both curves crossing there.
- [ ] The throttled point must have **LESS flow at MORE head** (about 0.060 m³/s
  at 31.8 m) and report about **8.58 kW** burned at the valve.
- [ ] Change ONLY the efficiency, 0.4 to 1.0: the burned figure must NOT move.
  It is hydraulic power destroyed in the valve, and the pump's efficiency has
  nothing to do with it.
- [ ] Set the resistance **K to 0**: no throttled block at all. Multiplying zero
  by three moves nothing, and it used to announce a rise and a fall of zero.
- [ ] Set the static lift **above** the shut-off head: refused, saying no valve
  setting helps.

**Affinity laws**

- [ ] Defaults (1450 -> 1160 rpm): flow **80**, head **32**, power **10 240 W**,
  and power fraction exactly **51.2%**.
- [ ] Set the new speed to **725**: power fraction **12.5%**.
- [ ] The figure shows flow, head and power against speed, with power pulling
  away as the cube.

**Drag on a body**

- [ ] Defaults (car at 30 m/s): drag about **364 N**, power about **10.9 kW**.
- [ ] Set the velocity to **60**: power must be **eight times** the 30 m/s value.
- [ ] Clear the mass: terminal velocity is omitted rather than invented.

**Stress intensity & critical crack size**

- [ ] Defaults (200 MPa, 3 mm, Y 1.12, K_IC 50 MPa√m): K about **21.7 MPa√m**,
  critical crack about **15.9 mm**, critical stress about **460 MPa**.
- [ ] Set the crack to **12 mm** (four times): K must only **double**. That
  square root is why fracture is a threshold.
- [ ] Set the thickness to **5 mm**: it must say the assessment is CONSERVATIVE
  because a thin plate is TOUGHER.
- [ ] Set stress **800 MPa** against a **500 MPa** yield: **REFUSED** because the
  section has yielded through. It used to answer "safety on stress 2.58".
- [ ] Set Y **4**, stress 400 MPa, crack **0.2 mm**, K_IC 400e6, yield 500 MPa:
  refused because the plastic zone is not small - LEFM does not apply.

**Crack growth (Paris law)**

- [ ] Defaults: about **180 000 cycles**, final crack about **28 mm**, and the
  first doubling takes about **40%** of the whole life.
- [ ] Set the initial crack to **20 mm**: it must say the crack reaches critical
  size before it can double, NOT that the first doubling is 100% of the life.
- [ ] Set **m = 1**: the "most of the life while the crack is small" claim must
  NOT appear - it is false below m = 2, and it used to contradict its own number.
- [ ] It must NOT report something like 1.8e-13 cycles. C is quoted for ΔK in
  MPa√m, and using pascals is wrong by 10^18 at m = 3.
- [ ] Set the threshold ΔK to **5e6** with a 0.1 mm crack at 20 MPa: refused,
  saying the crack does not grow at all.
- [ ] Set the initial crack to **50 mm**: refused as already past critical.

**Yielding or fracture**

- [ ] Defaults: transition crack about **2.54 mm**, and at 3 mm **fracture**
  governs.
- [ ] Set K_IC to **150e6**: the transition size grows to about **22.8 mm** -
  what toughness actually buys.
- [ ] The figure shows the two failure-stress curves crossing at that size.

---

## 0ao. New in v2.80.0 - Thermal breadth, and legible graphs

Engineering > Thermal is now **9 calculators**; the mode must state **118**.

**The graph formatting fix - check this on ANY plot in the product**

- [ ] Any tool with a **legend** (Analyze > FFT, Plot, the new Thermal ones):
  the legend box must be **solid white**. Curves used to show straight through
  it and strike out the labels naming them.
- [ ] A plot with **large y values** (millions or more): the y-axis numbers must
  not touch or overlap the rotated y-axis title. The left margin now grows to
  fit them.

**Exchanger rating (effectiveness-NTU)** - new

- [ ] Defaults: Cr **0.75**, NTU **2**, effectiveness about **72%**, hot outlet
  about **106 °C**, cold outlet about **87 °C**. Hot and cold duties must agree.
- [ ] Set both capacity rates **equal**: effectiveness must be exactly
  **NTU/(1+NTU)** = 66.7% at NTU 2. That case is 0/0 in the textbook formula and
  must NOT come back as an error or a blank.
- [ ] Set the hot capacity rate to **1e9** (a condensing stream): every
  arrangement gives the same effectiveness, and a note explains why.
- [ ] Switch to **parallel** with a huge area: effectiveness stops at **50%**
  and the note says counterflow has no such ceiling.
- [ ] Raise the area until NTU is above 5: a note must say doubling the area
  from there buys almost nothing.
- [ ] The figure shows effectiveness against NTU for all four arrangements with
  **this exchanger marked**.

**Fin efficiency & effectiveness** - new

- [ ] Defaults (aluminium, h = 40): efficiency about **90%**, effectiveness
  about **31**. A note says fins pay when h is LOW.
- [ ] Set **h = 5000, k = 15, L = 0.01, t = 0.01**: effectiveness drops
  **below 1**, and the note must say the fin removes LESS heat than the bare
  surface. That is the result the tool exists for.
- [ ] Make the fin very long (L = 0.5): a note says a longer fin adds weight and
  no heat transfer.
- [ ] The figure shows temperature falling from the base to the tip.

**Transient cooling (lumped capacitance)** - new

- [ ] Defaults: Biot about **1.7e-4**, time constant about **203 s**,
  temperature at 600 s about **34 °C**.
- [ ] Set **h = 5000, k = 1, V = 1e-3**: **REFUSED**, with the Biot number
  quoted and the reason - a single exponential is the wrong SHAPE of answer.
- [ ] Set the initial temperature BELOW ambient: it heats instead, and the curve
  never overshoots.
- [ ] The figure shows the cooling curve against a flat ambient line.

**Radiation exchange & shields** - new

- [ ] Defaults (527 °C to 27 °C, ε = 0.8, one shield at ε = 0.05): the shield
  must cut the exchange by more than **tenfold** against no shield.
- [ ] Set the shield emissivity to **0.8** and shields to **1**: the exchange is
  cut by exactly **2**. Two shields: **3**. That is the N+1 rule.
- [ ] Switch to **small object in large surroundings**: changing emissivity 2
  must make NO difference, and a note says why.
- [ ] Set both temperatures **equal**: Q is zero and nothing is non-finite.
- [ ] A note must state the Celsius-to-kelvin conversion and say the fourth
  power makes Celsius wrong by orders of magnitude rather than by an offset.
- [ ] The figure shows radiation rising as the fourth power against a straight
  convection line.

**The five existing Thermal tools**

- [ ] **Heat exchanger (LMTD)** now inserts a temperature profile. On
  **counterflow** the gap between the curves stays roughly constant; switch to
  **parallel** and it collapses towards the outlet.
- [ ] All nine Thermal tools insert BOTH numbers and a figure.

---

## 0an. New in v2.79.0 - Structural & solids draws

Engineering > Structural & solids. All six tools now insert a figure.

**The minor axis, and the section -> column handoff**

- [ ] **Cross-section** on its defaults (I-beam 100, 10, 200, 6 mm): the report
  now includes **Iy** and **ry**, and says Iy is about **12.6x** smaller than I
  with the reason - a column buckles about the WEAKER axis.
- [ ] A **solid circle**: the report says it is axisymmetric and has no weaker
  axis. Iy must equal I.
- [ ] The **figure** shows the section drawn to scale with a dashed neutral axis
  and both c_top and c_bot. On a **Tee** the neutral axis must sit visibly ABOVE
  mid-depth, which is why its two section moduli differ.
- [ ] **Column buckling**, "Section properties from" = **A section shape**, with
  the default I-beam: it computes A and Iy itself, converts mm to m, and the
  note says the MINOR axis was used and by what factor that matters.
- [ ] Compare against typing the bare **mm⁴** number into the typed source: the
  critical load differs by about **10¹²**. That paste is what this removes.

**The two diagrams**

- [ ] **Stress state** on its defaults: a **Mohr's circle** inserts. It must be
  a CIRCLE, not an ellipse. σ₁ and σ₂ are marked where it crosses the σ axis,
  the applied state and its conjugate are joined by a dashed line through the
  centre, and τmax is labelled as the radius.
- [ ] Set τxy to **0**: the circle still draws, with the two principal points at
  σx and σy.
- [ ] Set σx = σy and τxy = 0 (hydrostatic): a zero-radius circle, no crash.
- [ ] **Mean stress & factor of safety**, "Endurance limit from" = **Marin
  factors**: Se is computed in place and the note shows the full ka x kb x kc x
  kd x ke chain. It must NOT need re-typing from the endurance tool.
- [ ] The **Goodman diagram** inserts, with five loci (Modified Goodman,
  Soderberg, Gerber, ASME elliptic, Langer yield), a legend, the operating point
  and the dashed load line from the origin. The 45° region must look like 45°.

**The rest of the discipline**

- [ ] **Truss**: the figure draws the truss in its own geometry. Members in
  tension are red, compression blue, and **zero-force members are dashed and
  grey**. Line thickness scales with force. Member angles must look right - the
  scale is equal on both axes.
- [ ] **Shaft torsion**: shear against radius, rising linearly to τmax at the
  surface. With a **bore**, the bore region is shaded and the line starts at the
  bore rather than at zero.
- [ ] **Beam** still inserts its shear/moment figure, unchanged.
- [ ] Every one of the six inserts BOTH the numbers and a figure.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Column buckling** with a yield strength of **1e-300**: it must return
  promptly. It used to consume **4 GB** and die - the transition slenderness
  came back Infinity, the tick step became Infinity, and the loop never ended.
  In a task pane that is a frozen Word.
- [ ] **Shaft torsion** with a torque of **0**: the figure must SAY there is no
  shear to plot. It used to insert a blank white 380x240 box captioned "Shear
  stress across the radius" - artwork that renders as nothing.
- [ ] **Cross-section**, rectangle **200, 50** (a plate on edge): the report
  must name the **horizontal** axis as the weaker one. It used to say the
  section was axisymmetric and had no weak axis at all.
- [ ] A **square** 100, 100: it must say both axes are equal, not name one.
- [ ] **Column buckling** from a section, using a **wide tee** (200, 20, 40,
  10): the note must quote the SAME number it converted. It used to print Iy
  while converting Imin - inconsistent by a factor of 62.
- [ ] **Mean stress**, "Endurance limit from" = **Marin**, material
  **non-ferrous**: the warning "THIS MATERIAL HAS NO TRUE ENDURANCE LIMIT" must
  appear. It used to print an infinite-life factor of safety with no caveat.
- [ ] **Mean stress** with σm = **-400** (compressive) and σa = 200: the figure
  must show BOTH a "fatigue point" and a separate "yield point (|σm|)". With one
  marker the picture said "safe" while the text said the part fails.
- [ ] The **torsion** figure's radius axis reads **mm** with real numbers, not
  "0.0" on an unlabelled axis.

**Contract**

- [ ] No em dash appears in any of the new captions - a caption is part of the
  result text, and an em dash there used to disable Insert for the whole tool.
- [ ] **Cross-section**, box with wall **60** on a 100x200: the refusal carries
  no em dash. The column tool surfaces this same message now.

---

## 0am. New in v2.78.0 - Tier 1 closed

Six separate places. Nothing here adds a calculator, so the counts do not move.

**Engineering > Chips & semiconductors > Junction temperature**

- [ ] On its defaults (power source **typed**, 15 W): junction **55 °C**,
  exactly as before. The new fields must not change the old answer.
- [ ] Switch "Dissipated power from" to **Switching parameters**: with the
  defaults (2 nF, 1.1 V, 2 GHz, activity 0.15) the power comes out **0.726 W**
  and the junction drops to about **26.5 °C**. The note must say the power was
  computed here rather than re-typed, and show the dynamic/leakage split.
- [ ] Set the leakage to **0.05 A**: the power rises, and a note must appear
  saying leakage is EXPONENTIAL in temperature and that the feedback loop is
  stated rather than modelled.

**Engineering > Fluids > Pump NPSH & cavitation**

- [ ] Defaults (both sources **typed**): unchanged from before.
- [ ] Switch "Density from" to **Water**: at 20 °C the density reads
  **998.2 kg/m³** and a note says it came from the shipped table.
- [ ] Set the temperature to **150**: refused, because the table covers 0-100 °C.
- [ ] Switch "Suction-line losses from" to **Pipe geometry**: the loss is
  computed from the defaults and the note must quote the friction and fitting
  halves, the velocity, the Reynolds number and the Colebrook friction factor.
- [ ] Change the suction pipe diameter from **0.1** to **0.15**: the head loss
  must fall STEEPLY - more than fivefold. That is why the fix for cavitation is
  a bigger suction line.
- [ ] With density **typed** and losses **from pipe**, a note must disclose that
  the viscosity was taken as water at 20 °C.
- [ ] A note must always explain that **vapour pressure is deliberately not
  filled in**, and that NPSH available collapses with temperature through it.

**Engineering > Structural & solids > Beam**

- [ ] Any beam: an **Equilibrium check** block appears, with the total applied
  load, the sum of the reactions, and **Balance exact**.
- [ ] `point 30 at 2` + `udl 10 from 0 to 4` on a 6 m beam: total applied
  **70 kN**, reactions summing to **70 kN**.
- [ ] A propped cantilever (`fixed 0`, `roller 6`, `udl 24 from 0 to 6`): total
  **144 kN**, and the balance is still exact - the check does not depend on the
  beam being determinate.
- [ ] Add an applied couple (`couple 50 at 3`): the total applied load does NOT
  change, because a couple carries no vertical force.
- [ ] Type a load line the parser cannot read, e.g. `ramp 0 12 from 0 to 4`
  (the real syntax is `udl 0 to 12 from 0 to 4`): it is reported as an error.
  This is the case the equilibrium check exists for.

**Analyze > FFT filter**

- [ ] On the defaults, with **Edge shape = Raised cosine**: the filtered samples
  must be EXACTLY what this tool produced before v2.78.0. The default changing
  would be a regression.
- [ ] Switch to **Butterworth**: a caveat appears naming the ORDER and the dB
  actually achieved at the stopband edge.
- [ ] Switch to **Chebyshev**: the order is LOWER than Butterworth's for the
  same settings, which is the trade the two families exist to offer.
- [ ] Raise the stopband attenuation from **40** to **60**: the order rises.
- [ ] Set the transition width to **0** with a designed shape selected: it falls
  back and says the filter is **not the one you asked for**.
- [ ] A caveat must say the MAGNITUDE is applied but the phase is not.

**Solve > Geometry (3-D transforms)**

- [ ] `rotate 90 z (1,0,0)` -> about **(0, 1, 0)**, determinant **1**.
- [ ] `scale 2 3 4 (1,1,1)` -> **(2, 3, 4)**, volume scale factor **24**, and
  the coordinates shown as EXACT integers.
- [ ] `reflect xy (1,2,3)` -> **(1, 2, -3)**, determinant **-1**, and the text
  must say it **FLIPS ORIENTATION**.
- [ ] `scale 0 (1,2,3)` -> the text must say the transform **COLLAPSES** space.
- [ ] `rotate 90 z then scale 2 3 4 (1,0,0)` gives y = **3**, while
  `scale 2 3 4 then rotate 90 z (1,0,0)` gives y = **2**. A caveat must say
  ORDER MATTERS.
- [ ] `rotate 30 z (1,0,0)`: a caveat says the result is NUMERIC, not exact, and
  no sixty-digit fraction appears anywhere in the output.
- [ ] `reflect xy then reflect xy (1,2,3)` returns **(1, 2, 3)**.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Solve > Integral**, both limits blank, `sqrt(-1)`: the "no closed-form
  antiderivative" message. It used to print **`NaN*x + C`** and insert it -
  `NaN` is not the em-dash the guard scans for. Same for `ln(-1)`, `asin(2)`,
  `1/0`.
- [ ] `tan(x)` indefinite: says "Checked **NUMERICALLY** ... Strong evidence,
  not a proof", NOT "Verified symbolically". Same for `sqrt(x)`. But `x^2` and
  `sin(x)` DO say symbolically.
- [ ] `sin(x)^2`: the no-answer message must NOT claim such integrands
  "genuinely have none" - it has a standard antiderivative.
- [ ] **FFT filter**, band-stop 20 to 70 Hz, transition 10, Chebyshev, stopband
  40 dB: rejection in the middle of the band must exceed **40 dB**. It used to
  cap at about **18 dB** - worse than the raised cosine.
- [ ] **FFT filter**, high-pass cutoff **2**, transition **10** (stopband would
  be at -8 Hz), Butterworth: falls back and does NOT quote an attenuation. It
  used to report **191 dB** for a filter passing 14% at 0.5 Hz.
- [ ] **Solve > Geometry**: `rotate about x 90 (1,2,3)` -> **(1, -3, 2)**. It
  used to rotate about **z**. Also `rotate x 90`, `rotate 90 x-axis`.
- [ ] `rotate 1e3 z (1,0,0)` rotates **1000 degrees**, not 1.
  `scale 1/2 (2,2,2)` -> **(1,1,1)**, not (2,2,2).
- [ ] `mirror the point (1,2,3) in the yz plane` -> **(-1, 2, 3)**. The plane
  written after the point used to be thrown away.
- [ ] `rotate 90 (1,2,3)`, `reflect (1,2,3)`, `scale 2 3 (1,1,1)` and
  `rotate 90 z, scale 2 (1,0,0)` are each **REFUSED by name** rather than
  silently given a substituted transformation.
- [ ] `reflect xy (1,2,3)` shows **determinant -1** and **volume scale factor
  1** on separate lines. It used to print "volume scale factor = -1  ~ 1".
- [ ] **Beam** with `point -30 at 3` (an upward load): the wording must match
  the sign - no "-30 kN down".

**Engineering > Structural & solids > Cross-section**

- [ ] Set the shape to **Circular hollow** with a wall thicker than half the
  diameter: the refusal must contain **no em dash**. It used to, and an em dash
  anywhere in a result is the pane's non-finite sentinel, so it disabled Insert.

**Solve > Integral (indefinite)**

- [ ] Type `x^2` and **clear both limit boxes**: the answer is
  **∫ (x^2) dx = x^3/3 + C**, with the check derivative shown and "Verified
  SYMBOLICALLY".
- [ ] `x*exp(x)` -> **x*exp(x) - exp(x)**. `1/(x^2+1)` -> **atan(x)**.
  `tan(x)` -> **-ln(abs(cos(x)))**.
- [ ] `exp(-x^2)` -> reported as having **no closed-form antiderivative**, with
  the message saying that is often the correct answer rather than a failure.
- [ ] `1/x` -> **ln(abs(x))**, and a caveat must warn that the constant is
  **NOT shared across a pole**.
- [ ] Put limits back in (0 and 1): the definite integral works exactly as
  before. The indefinite path must not have broken it.
- [ ] It inserts, with the integral sign typeset.

---

## 0al. New in v2.77.0 - trajectory & orbits

Engineering mode. A **nineteenth** discipline, **Trajectory & orbits** (13); the
mode must state **114 calculators** across **nineteen disciplines**. Every value
below is the tool's own default, so each check is a single click.

**Ballistic**

- [ ] **Projectile in a vacuum**, 20 m/s at 45°, height 0: range **40.79 m**
  (which is exactly v²/g), apex **10.20 m**, flight **2.884 s**, impact speed
  **20 m/s** - equal to the launch speed, because energy is conserved. Best
  angle **45°**.
- [ ] Change the launch height to **10**: the best angle drops to **39.32°**,
  NOT 45°, and the note must say so. Range at that angle **49.79 m**, better
  than the **49.10 m** the 45° shot gives. This is the headline result.
- [ ] **Projectile with air drag** on its defaults (800 m/s, 30°, 0.01 kg,
  5e-5 m², Cd 0.3): range **2970 m** against a vacuum range of **56518 m** -
  only **5.26%**. Drag is the dominant term, not a correction.
- [ ] A **trajectory plot** inserts, and the curve **ends at the ground** - no
  part of it dips below zero.
- [ ] Set Cd to **10**: refused as outside any physical range, not computed.
- [ ] **Launch angle for a target**, 20 m/s at 30 m: **two** answers, **23.67°**
  and **66.33°**, which sum to 90°. The lofted one takes longer (3.736 s vs
  1.638 s). Maximum range **40.79 m**.
- [ ] Ask for **1000 m** at 20 m/s: **REFUSED** as beyond maximum range, with
  the word "refused rather than clamped". It must not return 45°.
- [ ] **Impact speed, energy & momentum** on its defaults (4.5 g hailstone,
  1000 m): impact **22.10 m/s**, terminal **22.10 m/s**, but the vacuum figure
  is **140.0 m/s**. Energy **1.099 J**, at **100%** of the ceiling.
- [ ] Change the drop height to **5000**: the energy is still **1.099 J** and
  the speed still **22.10 m/s**, while the vacuum speed rises to **313.2 m/s**.
  Five times the height, no extra energy - the saturation result.
- [ ] The fall time must RISE with height (46.8 s at 1000 m, about 228 s at
  5000 m). A fall time that stops growing is the bug this check exists for.

**Orbital**

- [ ] **Circular orbit**, Earth at 400 km: speed **7669 m/s**, period **5554 s**
  (**92.56 min**), escape speed here **10845 m/s**.
- [ ] Set the altitude to **35786 km**: period **86164 s** = **23.934 h**. That
  is the **sidereal day**, which is the definition of geostationary - and it is
  the cross-check that the fetched μ is right.
- [ ] Compare 300 km with 20000 km: the **lower** orbit is the **faster** one,
  and the note must say adding energy slows you down.
- [ ] **Elliptical orbit**, 300 x 35786 km: semi-major axis **24421 km**,
  eccentricity **0.7265**, periapsis speed **10151 m/s**, apoapsis speed
  **1608 m/s**, period **37980 s**.
- [ ] Enter equal apsides (500 and 500 km): eccentricity **0**, and the period
  matches the circular-orbit tool at 500 km exactly.
- [ ] Enter the apsides **swapped** (35786 periapsis, 300 apoapsis): refused
  with the word "swapped", not silently reordered.
- [ ] **Hohmann transfer**, 300 km to 35786 km: burns **2426** and **1467** m/s,
  total **3893 m/s**, transfer **18990 s** (**5.275 h**), phase angle **100.7°**.
- [ ] Reverse it (35786 to 300 km): both burns turn **negative** and the total
  Δv is the **same**. Lowering costs what raising costs.
- [ ] Transfer 300 km to 400 km: the note must say **SLOW DOWN** to catch
  something ahead of you.
- [ ] **Rocket equation**, Isp 450 s, 100 kg to 20 kg: exhaust **4413 m/s**,
  mass ratio **5**, Δv **7102 m/s**, propellant **80 kg** (**80%**).
- [ ] Set the final mass **equal to or above** the initial: refused.
- [ ] **Escape speed**, Earth at 0 km: **11180 m/s** - the familiar 11.2 km/s.
  Circular **7905 m/s**, extra from orbit **3275 m/s**, which is **41%** more
  and not twice as much. The note must say escape is independent of direction.
- [ ] Switch the body to the **Moon**: everything rescales, and the Moon's
  surface gravity works out at about a sixth of Earth's.

**Profiles & navigation**

- [ ] **Jerk-limited (S-curve) profile**, 1 m at 0.5 m/s, 2 m/s², jerk 10:
  total **2.450 s** against a trapezoidal **2.250 s**. It is **slower**, and
  the note must explain that this is deliberate.
- [ ] Raise the jerk to **100000**: the S-curve time converges on the
  trapezoidal one. Lower it to **2**: the gap widens.
- [ ] **Multi-axis coordination** on its three default axes: move time
  **1.500 s**, limiting axis **X**, fastest axis alone **0.447 s**. Y is
  throttled to **0.4216 m/s** and **0.3556 m/s²** (**42.2%** used), Z to
  **0.0894 m/s** and **0.0889 m/s²** (**29.8%**). X stays at **100%**.
- [ ] The note must say throttling the fast axes costs **nothing** in cycle
  time and mention the **dog-leg** it avoids.
- [ ] Give a row with only three values: refused by name, with the row quoted.
- [ ] **Great-circle**, Heathrow to JFK on the defaults: **5539 km** /
  **2991 nmi**, initial bearing **287.9°**, final bearing **231.3°**. Those two
  DIFFER by more than 50° - the point of the tool.
- [ ] Enter the same point twice: distance **0**, no crash.
- [ ] **Wind triangle** on its defaults (track 090, TAS 50, wind from 180 at
  10): heading **101.5°**, ground speed **48.99 m/s**, drift **11.54°**. You
  steer INTO the wind, so the heading is south of the track.
- [ ] Set the wind to **from 090 at 10** (pure headwind): drift **0°**, ground
  speed exactly **40 m/s**. Set it to **from 270**: **60 m/s**.
- [ ] Set TAS **10** and wind **50 from 180**: **REFUSED** - no heading makes
  that track good. It must not return an angle.
- [ ] **TWO ANSWERS (v2.77.1).** Track **090**, TAS **50**, wind **from 240** at
  **80**: heading **143.1°** at **99.28 m/s**, AND a **second solution** of
  **216.9°** at **39.28 m/s**. Both genuinely make the track good - the second
  points backwards relative to the air and lets the wind carry you along. The
  note must say so.
- [ ] Track **090**, TAS **10**, wind **from 270** at **30**: ground speeds
  **40** and **20 m/s**.
- [ ] The ordinary default (wind from 180 at 10) shows **no** second solution -
  its other root makes good the reciprocal track and is correctly discarded.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Projectile with drag**, 1 m/s at 0.001°, 2.7 g, 0.00126 m², Cd 0.5,
  height **1000**: a ping-pong ball off a cliff. Flight time must be **over
  100 s** and the plotted curve must **reach the ground**. It used to stop at
  43.8 s with the ball still **627 m in the air**, because the vacuum flight
  time was used as an upper bound - and it is not one, since drag lengthens the
  descent even though it shortens the ascent.
- [ ] **Projectile with drag** at a **negative** angle from height **0**:
  refused with "no flight". It used to return a fraction of **NaN** and a
  trajectory **50 m underground**.
- [ ] The same shot from a height of **50**: accepted, lands, and the apex
  equals the launch height.
- [ ] **Projectile with drag**, 14 m/s at 40°, 7.26 kg, 0.0113 m², Cd 0.47 (a
  shot put): apex **4.11 m**. It used to report **3.48 m** - the maximum over
  the solver's samples rather than the real vertex, 15% low.
- [ ] **Projectile with drag**, 2000 m/s at 80°, 100 kg: refused for leaving the
  **standard atmosphere**. It used to integrate 94 km of flight as a vacuum
  while the notes claimed ISA density.
- [ ] **Hohmann transfer**, 35786 km **down to** 300 km: phase angle **1.25°**.
  It used to read **-1078.75°**, which is not a lead angle anyone can use.
- [ ] **Multi-axis coordination** with two **identical** axes (`X, 1, 1, 2` and
  `Y, 1, 1, 2`): both at **100%**, and the note must say they already finish
  together. It used to claim a **dog-leg** that its own numbers disproved.
- [ ] Add a zero-distance axis (`Z, 0, 0.3, 1`): Z keeps its own limits rather
  than being throttled to zero. Paste the resulting plan back in as input - it
  must be **accepted**, not refused.
- [ ] **Impact energy** with a frontal area of **1e-16**: fall time about
  **0.45 s**, not **0**. The deep-drop fix had broken the shallow end.

**Contract**

- [ ] Every one of the 13 tools inserts into Word, with **°**, **Δv**, **m/s²**,
  **N·s** and **√2** intact and no em-dash placeholder anywhere.
- [ ] Typing a unit on a converting field works: **"72 km/h"** as a launch
  speed, **"500 kt"** as an airspeed, **"35786 km"** as an altitude, **"1 lb"**
  as a mass. Each is converted and the conversion is REPORTED.
- [ ] Typing a unit of the **wrong quantity** (a length where a mass belongs)
  is refused by name rather than ignored.

---

## 0ak. New in v2.76.0 - colour gamut coverage

- [ ] **Engineering > Video & display > Colour gamut coverage.** DCI-P3 against
  sRGB: coverage **100%** in both metrics, area ratio about **126%**, and about
  **20%** of P3 outside sRGB. That pairing is the whole point - a space can be
  126% by area while covering exactly 100%.
- [ ] sRGB against Rec.2020: coverage about **58% (u'v')** and **53% (xy)** -
  the two metrics must DIFFER, and the note must say to quote u'v'.
- [ ] Any space against itself: **100%** coverage, **100%** area ratio, **0%**
  outside. That identity is what validates the polygon clipper.
- [ ] Rec.709 against sRGB: **100%** both ways, since they share primaries.
- [ ] The area table at the bottom lists every space relative to sRGB, ordered
  sRGB < DCI-P3 < Rec.2020.
- [ ] The notes cite where the primaries came from (IEC / ITU / SMPTE).
- [ ] It inserts.

---

## 0aj. New in v2.75.0 - video & display

Engineering mode. An eighteenth discipline, **Video & display** (6); the mode
must state **101 calculators** across **eighteen disciplines**.

- [ ] **Bitrate** at the defaults (1920x1080, 25 fps, 8-bit, 4:2:0, ratio 1):
  uncompressed **622.08 Mbit/s**, 12 bits per pixel. Switch chroma to 4:4:4 and
  the rate must exactly DOUBLE - confirming 4:2:0 is a 50% reduction.
- [ ] Set the compression ratio to 0.5: refused, saying it would make the file
  larger.
- [ ] **Resolution** 3840x2160 at 55 in: **16:9**, 8.29 Mpixel, about **80 PPI**,
  grid invisible past roughly **1.09 m**. Try a phone (2532x1170 at 6.1 in) -
  much higher PPI and a much SHORTER distance.
- [ ] **HDR** at 1000 nits / 0.05 black: contrast **20000 : 1**, about **14.3
  stops**, and a code-range table showing how little of PQ the bright end uses.
  Set black to 0: contrast reads **infinite** with the self-emissive note.
- [ ] Set peak to 20000: refused (above the PQ ceiling).
- [ ] **PSNR** with MSE 100 at 8-bit: **28.13 dB**. Set MSE to 0: refused,
  because identical images give infinite PSNR.
- [ ] **Streaming** at 5 Mbit/s over 8 Mbit/s with a 5 MB buffer: buffer holds
  **8 s**, startup **13.33 s**. Set bandwidth equal to the bitrate: it must say
  the buffer never fills and that this is a bitrate problem.
- [ ] **Latency** at the defaults: sum **63 ms**, delivered **66.67 ms** = 4
  frames at 60 Hz. Change encode from 20 to 15 ms: the SUM drops but the
  DELIVERED figure must stay the same - the point of the whole calculator.
- [ ] All six insert.

---

## 0ai. New in v2.74.0 - audio & acoustics

Engineering mode. A seventeenth discipline, **Audio & acoustics** (7); the mode
must state **101 calculators** across **eighteen disciplines**.

- [ ] **Sampling**: 44.1 kHz with a 20 kHz signal is adequate; Nyquist reads
  **22050 Hz**. Set the signal to 30 kHz: it must say NOT adequate and fold it.
- [ ] **Quantisation** at 16 bits: SNR **98.08 dB**, 65536 levels, and with
  44.1 kHz stereo the rate reads **1.4112 Mbit/s** (CD audio). A note must say
  the figure assumes a FULL-SCALE signal.
- [ ] **Decibels**, ratio 2 on the field basis: **6.02 dB**, with **3.01 dB**
  shown beside it as the other convention. Switch to power and they swap.
- [ ] **Sound level**: 100 dB at 1 m reads **93.98 dB at 2 m** (-6.02). With
  the summing box at `80, 80` the total is **83.01 dB** - +3, not +6.
- [ ] **Reverberation** at 200 m3 / 240 m2 / 0.2: Sabine **0.671 s**, Eyring
  **0.601 s**, both shown. Raise absorption to 0.4 and a note must say use
  Eyring. Enter 1 and it must be refused.
- [ ] **Room modes** for 5 x 4 x 2.5: the first is **34.3 Hz axial (1,0,0)**.
  Try a 4 x 4 x 4 cube - the first three modes must be identical, which is the
  point about ratios.
- [ ] **Comb filtering** at 1 ms: first notch **500 Hz**, notches at 500, 1500,
  2500, peaks at 1000, 2000, 3000. A note must say EQ cannot fix it.
- [ ] All seven insert.

---

## 0ah. New in v2.73.0 — photometric units

No new calculators; this is the units groundwork for the audio/video bench.
Check it in **Units** mode.

- [ ] Convert `1 cd` → `mcd` = **1000**; `1 klm` → `lm` = **1000**.
- [ ] `1 nit` → `cd/m^2` = **1**, and back. `1 lx` → `lm/m^2` = **1**, and back.
- [ ] **These must be REFUSED**, each with the wrong-quantity message rather
  than a number: `lm` → `W`, `cd` → `lm`, `nit` → `lx`, `cd` → `W`.
  A number appearing for any of them is the defect this release exists to avoid.
- [ ] `60 fps` → `Hz` = **60** (checking a source against a panel refresh).
- [ ] `1 ft/s` → `m/s` = **0.3048** — feet per second still works, written that way.
- [ ] Spelled-out `candela`, `lumen`, `lux`, `nits` all resolve.
- [ ] Nothing existing broke: `1 km` → `m`, `1 L` → `mL`, `1 kt` → `m/s`,
  `1 fpm` → `m/s` all still convert.

---

## 0ag. New in v2.72.0 — HMBC and TOCSY

- [ ] **Spectra** now lists **HMBC** and **TOCSY** in the dropdown (eight
  predictions in total).
- [ ] **HMBC** on methyl acetate (`CC(=O)OC`): correlations must appear to the
  **carbonyl carbon near 170 ppm** — the carbon HSQC shows nothing for, because
  it carries no proton. Switch to HSQC and confirm that carbon really is absent
  there. That contrast is the whole point of the experiment.
- [ ] In the HMBC table, every row is labelled **2J** or **3J**, and on the chart
  the 2J points are drawn faint.
- [ ] **TOCSY** on propan-1-ol (`CCCO`): exactly **one** spin system containing
  three signals, with the OH separate. On methyl acetate: two systems, neither
  with more than one signal.
- [ ] Compare TOCSY with COSY on `CCCO`: TOCSY must show **more** cross-peaks,
  because it relates the first and third protons that COSY does not.
- [ ] Both insert as text, and both insert as a chart.

---

## 0af. New in v2.71.0 — import a sequence file

- [ ] **Sequence** mode: beside "+ Add sequence" there is now
  **Import FASTA / GenBank…**. Load a multi-record FASTA — every record must
  become its own card, with residues filled and the count shown under each.
- [ ] The molecule-type dropdown must be guessed: a DNA sequence reads **DNA**,
  one containing U but no T reads **RNA**, a protein sequence reads
  **Protein (AA)**. Correct it by hand where the guess is wrong.
- [ ] Load a **GenBank** file: the organism from its source feature must appear
  in the organism box.
- [ ] Import when the only card is blank: that blank card disappears. Type
  something into a card first, then import: **your typed card must survive**.
- [ ] A file over 8 MB, and a file that is neither format, are each reported by
  name rather than failing silently.
- [ ] **In-text reference**: the SEQ ID box now takes `1-3` or `1, 2, 5` as well
  as a single number, and inserts ONE citation covering them. Nonsense input is
  refused with a message.
- [ ] Generate the ST.26 XML after an import and confirm the sequences are in it.

---

## 0ae. New in v2.70.0 — DEPT

- [ ] **Spectra → ¹³C NMR** on ethanol (`CCO`): each line now shows a **class**
  beside the shift — CH3 and CH2 here — and a **DEPT** block underneath gives the
  tally plus what DEPT-135 and DEPT-90 would show.
- [ ] Toluene (`Cc1ccccc1`): the ipso carbon must read **C** (quaternary), the
  ring carbons **CH**, the methyl **CH3**. In the DEPT-135 line, CH2 (if present)
  must read **DOWN** while CH and CH3 read up.
- [ ] tert-butanol (`CC(C)(C)O`): a **C** and **CH3**, no CH2.
- [ ] Propan-2-ol (`CC(O)C`) shows a **CH**; propan-1-ol (`CCCO`) shows a **CH2**
  — the pair DEPT-90 exists to separate.
- [ ] **¹H** spectra must NOT show a class column (DEPT is a carbon experiment).
- [ ] The ¹³C table still inserts.

---

## 0ad. New in v2.69.0 — fit any model you can type

- [ ] **Analyze → Fit a model to data.** At the defaults it fits
  `a*exp(-b*x) + c`, reports each parameter with a **± standard error**, R²,
  RMSE, whether it converged, and draws the fit through the scattered data.
- [ ] Clear the starting values: it must still fit, and a note must say they
  **defaulted to 1** and that a poor fit is usually a starting-value problem.
- [ ] Try another model on the same data, e.g. `m*x + b` — the parameter names
  in the output follow whatever you typed.
- [ ] Type `wibble(x)*a`: refused, naming the functions that DO exist.
- [ ] Type `2*x` (no parameters): refused with that reason.
- [ ] **Engineering → Quantum optics → Two-qubit state.** There is now a
  **Preset** dropdown with the four Bell states. Selecting |Φ+> must give
  concurrence **1**; |Ψ-> likewise. "Custom" still uses the typed amplitudes.
- [ ] **Insert** works on the fit (no em dash in its notes).

---

## 0ac. New in v2.68.0 — PCA and data integration

- [ ] **Analyze → Principal component analysis.** At the defaults it reports a
  variance table, the number of components reaching 95%, a **scree plot**,
  loadings and scores. The percentages must sum to 100 and the cumulative column
  must never decrease.
- [ ] Switch **Basis** to Covariance and back: the note changes to name which
  basis ran, and the numbers change with it.
- [ ] Paste data with a **constant column** and standardised basis: refused with
  the "never vary" reason, not a divide-by-zero or a silent result.
- [ ] Use **Use table at cursor** to load a numeric Word table straight into it.
- [ ] The notes must always say component **signs are arbitrary**.
- [ ] **Analyze → Integrate measured data (trapezoid).** At the defaults it gives
  an area, a mean value, and a chart showing both the data and the **running
  integral**. Enter x = 0..10 with y = x: the area must be exactly **50**.
- [ ] Reverse the x order: the area becomes **negative** and a note says so.
- [ ] Give x values that go up and down: it must flag **non-monotonic** x.
- [ ] Both insert.

---

## 0ab. New in v2.67.0 — FFT windowing

- [ ] **Analyze → FFT / frequency spectrum.** There is now a **Window** dropdown
  defaulting to **Hann**. At the defaults the tool still reports the same
  dominant frequency, and a note names the window and what it trades.
- [ ] Switch to **None (rectangular: leakage)**: the note changes to explain the
  wrap-around discontinuity. Compare the two spectra on a longer signal — the
  Hann one has visibly less energy in the skirts either side of the peak.
- [ ] Paste a two-tone signal (50 Hz and 120 Hz sampled at 1000 Hz). **Dominant
  frequencies must list TWO different tones**, not the same peak twice from
  adjacent bins. Check this under every window.
- [ ] Paste a constant signal (e.g. eight copies of 5): dominant frequencies must
  be **none** under every window, not a spurious tone.
- [ ] Add a large constant offset to a real signal: the tone must still be found.
- [ ] **Insert result** must work — the note text contains no em dash, which
  would disable it.

---

## 0aa. New in v2.66.0 — wiring what was already built

- [ ] **Engineering → Fatigue → Mean stress & factor of safety.** The σa field
  must read "**Nominal** alternating stress" — NOT "already multiplied by Kf" —
  and there must be a **Kf** field defaulting to 1. At the defaults the answer
  matches the old one. Set Kf = 2: σa doubles internally, the report shows
  "100 MPa nominal × Kf 2 = 200 MPa applied", and the factor of safety falls.
  Set Kf = 0.5: **refused** (Kf is 1 or greater).
- [ ] **Bio/Assay → Substrate inhibition (Ksi)** exists. At the defaults it fits
  and reports Vmax, Km, Ksi, and a **peak velocity at an [S]** — with a caveat
  saying Vmax is an asymptote the enzyme never reaches. The plotted curve must
  RISE then FALL.
- [ ] Paste plain saturating data into it (no descending limb): it must warn that
  inhibition cannot be established, or refuse — not report three confident parameters.
- [ ] **Finance** now lists **24** calculators. Check the five new ones:
  **Depreciation (straight line)** — 10000/1000/5 gives 1800 a year;
  **Annuity** — PV and FV of a level stream; **Perpetuity** — set growth ≥ the
  discount rate and it must refuse with the divergence explanation;
  **Rate conversions** — continuous must exceed every discrete figure;
  **CAGR** — 10000 → 18000 over 5 years.
- [ ] All five insert.

---

## 0z. New in v2.65.0 — your document is a data source

The three changes here are all about getting data in and finding tools. Have a
Word table of numbers in the document before you start.

- [ ] **Stats → Descriptive statistics.** Under the data field there must now be
  two buttons: **Use table at cursor** and **Open CSV…**. Click inside your Word
  table, then press **Use table at cursor** — the field fills and the status line
  reports "Loaded N rows × M columns from the table at your cursor". Results
  recompute immediately.
- [ ] Put the cursor OUTSIDE any table and press it: a clear message asks you to
  click inside a table — not a silent failure.
- [ ] **Analyze → Data insights**, same buttons. A table with a text header row
  and numeric columns must load with the header intact.
- [ ] **Analyze → matrix tools** (e.g. Determinant): **Use table at cursor** on a
  square numeric table fills it space-separated, one row per line, header dropped.
- [ ] **Open CSV…** with a file whose labels contain commas (e.g. `"Smith, J.",42`).
  The columns must NOT shift — the quoted cell stays one cell.
- [ ] A file over 8 MB is refused with a message rather than freezing the pane.
- [ ] **Table → Chart** still works exactly as before (it now shares the same reader).
- [ ] **Search box**: type `Betz` → the wind turbine calculator appears and
  selecting it opens Engineering with that calculator chosen. Try `ANOVA`,
  `Kaplan`, `Black-Scholes`, `flue`. Try a tool name: `Citations`, `Spectra`.
  Formulas and compounds (`quadratic`, `benzene`) must still work.
- [ ] The search placeholder mentions tools and calculators, not just formulas.

---

## 0y. New in v2.64.0 — the eight live defects

Fixes from `docs/GAP-ANALYSIS-2026-08-01.md`. Most are visible without leaving
the Home screen.

- [ ] **Home screen**: the Engineering tile reads **"101 calculators across 16
  disciplines"** — not 36, not nine. It is counted from the registry, so it
  should track any future addition automatically.
- [ ] **Home screen**: click the **science** filter chip. **Finance must still be
  visible** (it was hidden behind the legal chip).
- [ ] **Spectra → ¹H NMR** on a fluorine compound (SMILES `OCCF`): a caveat must
  say **¹⁹F coupling is NOT included in the multiplicities**. Try a phosphate
  ester (`CCOP(=O)(OCC)OCC`) — same warning for **³¹P**, reached through the
  oxygen. Then check `CCO` (ethanol): **no such warning** — it must stay specific.
- [ ] **Analyze → Data insights**, paste six or more numeric columns of junk. The
  narrative must state **how many pairs were tested**, name
  **Benjamini-Hochberg**, and report an **adjusted** p beside the raw one. Any
  correlation reported must be followed by the **causation** caveat.
- [ ] **Align**, paste a two-record FASTA (`>a` / `>b`) into either box: a caveat
  must say the records were **joined into one sequence**. A single-record FASTA
  must produce no such warning.
- [ ] **Insert** from Insights and from Spectra — the new caveat lines must land
  in the document with the rest of the report.

---

## 0x. New in v2.63.0 — adiabatic flame temperature

Engineering mode, Energy & power (now 17; the mode must state **101 calculators**).

- [ ] **Flame temperature** at the defaults (CH4, LHV 50.0, stoichiometric): between
  **2250 and 2400 K** (~2320), and the FIRST note says dissociation is NOT modelled
  and the figure overstates a real flame by ~100–200 K.
- [ ] Switch the basis to HHV with 55.5: LHV used shows **50.02 MJ/kg** and the flame
  temperature matches the LHV route.
- [ ] Excess air 0.5: the temperature drops well below the stoichiometric figure and
  a note explains the dilution.
- [ ] Air preheat 400 °C: the temperature RISES above the unpreheated run and the
  preheat contribution line appears.
- [ ] CH3SH (a sulfur fuel): **refused**, naming the missing sulfur tables and
  pointing at the combustion tool for the stoichiometry.
- [ ] LHV 129 on H2: refused at the **3500 K** polynomial wall with the dissociation
  explanation — not an extrapolated number.

---

## 0. Setup

- [ ] Build is current (`npm run build`) and the add-in is loaded:
  - **Dev:** dev server running (`npm run dev-server`), manifest sideloaded.
  - **Prod:** installed from the per-OS pack; web files hosted on GitHub Pages.
- [ ] For most modes, a **blank** Word document is fine. For **Audit** (§14) — and
  optionally **Numerals** (§10) and **Refs** (§11) — open the ready-made
  **`docs/Formula-Inserter-Test.docx`**, which already contains planted issues
  (orphan numeral `(99)`, `SEQ ID NO: 5`, figure-number gaps, and a dangling
  `Fig. 7`). Regenerate it any time with `powershell -File scripts\make-test-doc.ps1`.
- [ ] Open the task pane (**Home → Insert Formula**, or **Insert → Add-ins**).
- [ ] The pane loads on the **Home** page with tools grouped by category, and the
  mode list shows all 25:
  **Chemical · Mass Spec · Spectra · Bio/Assay · Peptide · Stats · Analyze ·
  Math · Solve · Units · Plot · Table → Chart · Finance · Build · Code · Sequence Map ·
  Align · Sequence · Botanical · Numerals · Refs · DNA · Reaction · Citations ·
  Audit.**
- [ ] **Offline check:** after first load, disconnect the network — the pane and
  all *insert* actions still work (only first load needs HTTPS).

> General checks to keep in mind for every insert: it lands at the cursor, the
> preview matches what's inserted, and a single **Ctrl-Z** removes it cleanly.

---

## 1. Chemical
- [ ] Type `H2O` → preview shows **H₂O**; **Insert formatted text** inserts H₂O.
- [ ] Type `SO4^2-` → inserts **SO₄²⁻**.
- [ ] Type `aspirin` → 2D structure appears, tight (no big empty margin);
  readout shows Formula **C9H8O4**, and **Name: Aspirin**.
- [ ] **Insert 2D structure** → image inserts, sized to the structure (not oversized).
- [ ] **Insert name** → inserts the text "Aspirin".
- [ ] Type a SMILES `CC(=O)O` → structure renders.
- [ ] **Substituent-corrected pKa (v1.87):** `Oc1ccc([N+](=O)[O-])cc1` (p-nitrophenol) →
  Phenol pKa **≈ 7.15** (not 9.99), with a note showing **parent 9.99; Hammett … NO2 para**.
  `Oc1ccccc1` (phenol) → **≈ 9.99**. `OC(=O)CCl` (chloroacetic) → **≈ 2.87** (vs acetic 4.76).

## 1b. Mass Spec
- [ ] Type `caffeine` → **Monoisotopic 194.0804**, **Average 194.19**, formula
  **C8H10N4O2**.
- [ ] Isotope pattern shows M as the base peak with a small M+1 bar.
- [ ] Adducts list shows **[M+H]+ 195.0877** and **[M+Na]+ 217.0696**.
- [ ] Type a chlorinated compound (`ClC(Cl)Cl`) → the **M+2 bar is ~98%** of M
  (the chlorine signature) — this is the check that the pattern is real.
- [ ] **Insert MS data** → text summary lands at the cursor.

## 1c. Spectra  *(v1.54 — predicted NMR / IR / UV-Vis / fragmentation; v1.83 — J-coupling + 2D COSY/HSQC)*
> These are **estimates from additivity rules**, not acquired spectra. Every
> screen must carry its caveat — if a caveat block is missing, that is a FAIL.

- [ ] Type `toluene`, spectrum **¹H NMR** → ~4 signals; the **CH₃ is ~2.4 ppm,
  3H, singlet**; aromatics ~7.1–7.2. A caveat block is visible.
- [ ] Switch to **¹³C NMR** → **137.8 / 129.2 / 128.4 / 125.6 / 20.7** (±1).
- [ ] Type `benzene`, **¹H** → exactly **one signal, 7.26, 6H, s** (a triplet here
  would be a bug).
- [ ] **J-coupling:** type `ethanol`, **¹H** → the mult. column reads **`t (7.0)`**
  for the CH₃ (3H) and **`q (7.0)`** for the CH₂ (2H); the OH is **`s (br)`**. The
  Karplus and first-order caveats are visible.
- [ ] **COSY (¹H–¹H, 2D)** with `ethanol` → one **CH₃ ↔ CH₂** correlation
  (`type = vicinal, J ≈ 7`); inserting the chart gives a **square 2D map** with a
  grey diagonal and a blue cross-peak, both axes δ increasing left/down.
- [ ] **HSQC (¹H–¹³C, 2D)** with `ethanol` → **two** cross-peaks (CH₃ and CH₂),
  OH absent; `carbon tetrachloride` → **no correlations** (no C–H). Every peak sits
  in a plausible δH/δC box.
- [ ] Switch to **IR** with `acetone` → strong **C=O ~1715**; then `ethyl acetate`
  → **~1740** (ester sits above ketone); then `acetophenone` → **~1690**, labelled
  *conjugated*.
- [ ] **UV-Vis** with `butane` → reports **no λmax / transparent** (it must NOT
  invent a number). Then `CC(=O)C=C(C)C` (mesityl oxide) → **~237 nm** with the
  increments listed and summing to the total.
- [ ] **MS fragmentation** with `toluene` → **91.0542 tropylium ranked high**
  (the real base peak); m/z 77 present but NOT high, and not called "tropylium".
- [ ] **Insert data table** → text lands with its caveat.
- [ ] **Insert spectrum chart** (¹H or IR) → image inserts; the **δ axis increases
  leftward** and the IR axis **decreases rightward** (spectroscopy convention).
- [ ] UV-Vis: the **chart button is disabled** (a single λmax is a number, not a
  spectrum) — this is intentional.

## 1d. Bio/Assay
- [ ] Pick **Michaelis–Menten**, accept the pre-filled example → Vmax/Km with
  ± standard errors and an R².
- [ ] Pick **Dose–response (4PL)** → IC50/EC50 and a fitted curve chart.
- [ ] **Insert** → results and chart land at the cursor.

## 1e. Peptide
- [ ] Type `AGCW` → 2D structure renders with formula and MW.
- [ ] Try three-letter form (`Ala-Gly-Cys`) → same behaviour.
- [ ] **Insert** → structure image lands.

## 1f. Stats
- [ ] **Descriptive** with the pre-filled data → mean/SD/median populate.
- [ ] **t-test (Welch)** → t, df, p.
- [ ] **Mann–Whitney U** → U and p (non-parametric path).
- [ ] **Uncertainty propagation** → value ± uncertainty with per-variable
  contributions.
- [ ] **Insert** → table lands at the cursor.

## 1g. Analyze  *(no-code numerical workbench)*
- [ ] **Solve A·x = b** with the pre-filled example → x is returned; insert makes
  a Word table.
- [ ] **Eigenvalues** on a non-symmetric matrix → complex pairs shown as a ± bi.
- [ ] **Minimize a function** (Rosenbrock default) → converges near (1, 1).
- [ ] **FFT / spectrum** → dominant frequency and a chart.
- [ ] **Data → insights** → paste a small table; correlations, trends and
  plain-language findings appear.
- [ ] **ODE — the default is now `y'' = -y`** with `y = 1, y' = 0`:
  - [ ] It solves **without hand-reduction** and the result line says
    *"Auto-reduced to a first-order system of 2 states: y, y'"*.
  - [ ] At t = 6.2832 (2π) the final **y ≈ 1.000000** (it is cos t).
- [ ] **ODE — stiff:** equations `A' = -1000*A + B` / `B' = 1000*A - B`, initials
  `A = 1, B = 0`, range `0, 10` → completes, and the result line says
  **auto-switched to the implicit stiff solver**.
- [ ] **ODE — report-at times:** with `y' = -y`, `y = 1`, range `0, 5`, set
  **Report at times** to `0:1:5` → the table has exactly 6 rows and
  **y(5) = 0.006738** (e⁻⁵). The plot is still a smooth curve, not 6 points.
- [ ] **ODE — stop condition:** equations `z'' = -9.81`, initials `z = 0, z' = 20`,
  range `0, 10`, **Stop when** `z` → result reports
  **"z reached zero at t = 4.077472"** with z′ = −20, and the plotted curve
  **ends at the ground** (no underground tail).
- [ ] **ODE — condition never met:** same but **Stop when** `z - 1000` → a clear
  message that it never reached zero (not a silent full-range solve).
- [ ] **ODE — bad input:** delete the `y'` initial value → the error names it:
  *"Missing an initial value for y'. A system of order 2 needs 2…"*.

## 2. Math
- [ ] Type `x^2 + y^2` with **native Word equation** ticked → **Insert** creates a
  real Word equation (click it → Equation Tools appear).
- [ ] Tick **Number this equation** → inserts with a right-aligned `(I)`.
- [ ] **Formula library** → pick *Finance — valuation & options → Black–Scholes call* →
  inserts the typeset equation.
- [ ] **Import / export LaTeX:** paste `\frac{-b \pm \sqrt{b^2-4ac}}{2a}` →
  **Convert** → preview shows the quadratic formula → **Insert**.
- [ ] **Copy current as LaTeX** with that formula in the box → clipboard has LaTeX.
- [ ] Type `align(x = 1; y = 2)` → **Insert** → a stacked two-line equation.

## 2b. Solve  *(v1.84 — equations, calculus, word problems; offline)*
> Exact where it can be, numeric where it must be; every screen states its method
> and caveats. A fabricated root or a guessed word-problem answer is a FAIL.
- [ ] **Solve an equation** with `x^2 - 5x + 6 = 0` → **x = 3** and **x = 2**, method
  *exact (quadratic)*.
- [ ] `x^2 + 1 = 0` → two **complex** roots (`0 + 1i`, `0 − 1i`) with a caveat — NOT
  "no solution", and never faked as real.
- [ ] **All roots (cubic):** `x^3 - 1 = 0` → **three** roots — `1` and `-0.5 ± 0.866i`,
  method *complete (all roots)*. `x^4 - 1 = 0` → `1, -1, i, -i`. Repeated roots show ×2/×3.
- [ ] `x + 1 = x + 2` → **No solution**; `2*(x+1) = 2*x+2` → **identity**.
- [ ] **Inequalities (v2.15.0).** In the **Solve an equation** kind, type a comparison.
  - `x^2 - 4 > 0` -> (-inf, -2) U (2, inf).
  - `1/x < 1` -> (-inf, 0) U (1, inf). If it returns only (1, inf) the negative branch has been
    lost, which is the classic error this is built to avoid.
  - `(x-1)/(x+2) >= 0` -> (-inf, -2) U [1, inf). The -2 endpoint must be OPEN (it is a pole)
    while 1 is CLOSED.
  - `x^3 + x + 1 > 0` -> starts near -0.682, NOT the whole line.
  - `sin(x) > 0` -> refused with an explanation, not a guess.
- [ ] **Limits and series (v2.14.0).** In the **Differentiate** kind.
  - `limit sin(x)/x as x -> 0` -> 1, and the working mentions L'Hopital.
  - `limit abs(x)/x as x -> 0` -> must say the limit DOES NOT EXIST. If it reports 1, that is
    a serious bug.
  - `limit abs(x)/x as x -> 0+` -> 1; `... as x -> 0-` -> -1.
  - `lim 1/x as x -> inf` -> 0. `lim 1/x as x -> 0+` -> diverges to +inf.
  - `taylor exp(x) order 5` -> 1 + x + 1/2*x^2 + 1/6*x^3 + 1/24*x^4, as FRACTIONS not decimals,
    with an O(x^6) term shown.
  - `maclaurin sin(x)` -> only odd powers, alternating signs.
- [ ] **Systems of equations (v2.13.0).** In the **Solve an equation** kind, type MORE THAN
  ONE equation, one per line.
  - `x + y = 3` / `x - y = 1` -> x = 2, y = 1, method says UNIQUE.
  - `x/3 + y/7 = 1` / `x/3 - y/7 = 0` -> x = 3/2, y = 7/2 EXACTLY (fractions, not decimals).
  - `x + y = 1` / `x + y = 2` -> No solution, and it says the equations contradict each other.
    It must NOT report numbers.
  - `x + y = 3` / `2*x + 2*y = 6` -> INFINITELY many, with `x = 3 - y` and `y is free`.
    It must NOT pick one arbitrary point.
  - `x^2 + y^2 = 25` / `x + y = 7` -> two solutions, (3,4) and (4,3), flagged numeric.
- [ ] **Rearrange (v2.5.0 CAS):** `F = m*a` → "more than one unknown" message with
  **Solve for: F · m · a** chips. Click **a** → **a = F/m**, method
  *exact (symbolic rearrangement)*, caveat **requires m ≠ 0**. Click **m** → `m = F/a`.
  Edit the equation → the chips reset.
- [ ] **Rearrange (quadratic):** `s = u*t + a*t^2/2`, chip **t** → two ± roots with the
  discriminant condition stated. Insert lands both.
- [ ] **Differentiate** `sin(x^2)` → **`2*x*cos(x^2)`** (conventional factor order).
- [ ] **Differentiate (v2.5.0 readability)** `sin(x)*cos(x)` → **`cos(x)^2 - sin(x)^2`** —
  collected, no `+ -` artifacts.
- [ ] **Symbolic integration (v2.6.0).** Integrand `x*exp(x)`, limits 0 to 1 → **1**,
  method *exact (symbolic)*, and it shows **F(x) = x·eˣ − eˣ + C**. Try `1/(x^2+4)`
  0→2 (= π/8, atan form), `ln(x)` 1→e (= 1), `1/(x*(x+1))` 1→2. Each must say EXACT.
- [ ] **Integration refuses honestly.** `exp(x^2)` 0→1 → falls back to *adaptive Simpson*
  with the approximation caveat — it must NOT claim exact.
- [ ] **Geometry (v2.7.0).** Switch the dropdown to **Geometry**.
  - `triangle 3 4 5` -> area **6**, angle C = **90 deg**, method SSS.
  - `triangle a=6 b=8 A=30` -> **TWO** solutions listed, with the ambiguous-case caveat.
  - `triangle a=2 b=8 A=30` -> refused, saying the side is shorter than the altitude.
  - `circle r=3` -> area shown as **9*pi** (exact) with the decimal beside it.
  - `triangle (0,0) (4,0) (0,3)` -> area 6 exactly, plus centroid / circumcentre /
    orthocentre, and the line **"Euler line check: ... verified exactly"**.
  - `x^2/9 + y^2/4 = 1` -> **ellipse**, a = 3, b = 2, eccentricity ~ 0.745, foci listed.
  - `x^2 + y^2 = 0` -> reported as a **point** and flagged DEGENERATE, not as a circle.
  - `x*y = 1` -> **hyperbola**, with a 45 deg rotation reported.
- [ ] **Knots (v2.12.0).** Still the **Topology (homology)** kind.
  - `knot trefoil` -> V(t) = -t^-4 + t^-3 + t^-1, 1 component.
  - `knot trefoil-mirror` -> t + t^3 - t^4. The two MUST differ — that is the polynomial
    detecting chirality, which homology cannot.
  - `braid 1 -2 1 -2` (figure-eight) -> t^-2 - t^-1 + 1 - t + t^2, and it must read the same
    forwards and backwards (amphichiral knots have palindromic Jones polynomials).
  - `knot hopf-link` -> 2 components, with HALF-integer powers of t.
  - `pi1 trefoil` -> a Wirtinger presentation, H_1 = Z, and the plain statement that the
    group is NOT identified because the word problem is undecidable.
  - A braid with 25 crossings -> refused, saying a truncated state sum would be wrong rather
    than incomplete. It must NOT hang.
- [ ] **Advanced topology (v2.11.0).** Still the **Topology (homology)** kind.
  - `w(RP^5)` -> Stiefel-Whitney class, and the working says whether it obstructs
    parallelisability. `w(RP^3)` -> trivial, with the honest note that this does NOT prove
    parallelisability.
  - `chern CP^3` -> c(T CP^3) with top class 4 = chi(CP^3).
  - `does RP^5 bound` -> BOUNDS (5 is odd). `cobordism RP^2` -> does NOT bound.
  - `cellular rp2` -> H_1 = Z/2 from only 3 cells; compare `projective plane` which gives the
    same answer from the simplicial route.
  - `fundamental group`, `homeomorphism` -> each must EXPLAIN what is and is not computable
    and why. If either ever returns a confident numeric answer, that is a serious bug.
  - `cobordism` on its own -> must ASK for a manifold, not return nothing.
- [ ] **Alexander polynomial and K-theory (v2.16.0).** Still the **Topology (homology)** kind.
  - `alexander trefoil` -> **Delta(t) = 1 - t + t^2**, knot determinant **3**, and the working
    reports the Delta(t) = Delta(1/t) symmetry check having PASSED.
    This one matters: through v2.16.0 it answered with the JONES polynomial instead.
    If you see `V(t) = ...` here, the routing has regressed.
  - `alexander figure-8` -> 1 - 3t + t^2, determinant 5.
  - `jones trefoil` -> still V(t) = -t^-4 + t^-3 + t^-1. The two commands must give
    DIFFERENT answers.
  - `k-theory S^2` -> K^0 = Z + Z, K^1 = 0, reduced K^0 = Z, and the working must name
    **Bott periodicity** rather than reading a table.
  - `k-theory CP^3` -> K^0 = Z^4, K^1 = 0, explained by the absence of odd cells.
- [ ] **Spectral sequences and stable homotopy (v2.17.0).** Still the **Topology (homology)**
  kind. The whole point of this section is what is REFUSED.
  - `serre s2 s1` -> an E_2 grid with q increasing UPWARD, and **one differential marked
    UNDETERMINED**. It must NOT report H*(E). If it ever does, that is the most serious bug
    this tool can have: the Hopf fibration and the trivial bundle share this exact page and
    have different answers.
  - `serre s2 s3` -> **COLLAPSES**, and the working must say the collapse was PROVED (no
    differential has both ends nonzero), not assumed. The abutment is labelled the
    **associated graded**, with the extension problem named.
  - `spectral sequence of s2 s1` and `fibration s2 s1` -> the same answer as `serre s2 s1`;
    the filler words must not change the reading.
  - `serre nonsense s1` -> says those spaces are not in the table and lists the ones that are.
  - `stable pi_3` -> **pi_3^s = Z/24**, labelled a **LOOKUP from a published table**, naming
    Hatcher and Toda, and warning against extrapolating.
  - `stable homotopy 7` -> Z/240. `stable pi_4` -> 0.
  - `stable homotopy 99` -> **"not tabulated here"**. It must NOT invent a group or continue
    the pattern.
  - `pi1 trefoil` -> still the **Wirtinger presentation**, NOT the stable stem pi_1^s. These
    two collided before shipping.
  - `homology of the torus` -> Z, Z^2, Z. Phrasing it as a question must work as well as
    typing `torus` alone.
- [ ] **Measured spectra — JCAMP-DX (v2.19.0).** Open **Spectra**. Below the predicted
  tools there is now a rule and an **"Open a .jdx / .dx file…"** button. This reader had
  been complete but unreachable for several releases, so it has never had a real pass.
  - Open a genuine `.jdx`/`.dx` file from an instrument. The readout must name the title
    and data type, the point count, the x range, and say **"This is your measured data —
    nothing here is predicted."**
  - The chart title must say **measured**, and must NOT say predicted or estimate.
  - **Axis direction:** an IR or Raman file must show wavenumber **decreasing** rightward;
    UV-Vis and MS increase rightward. A mirrored spectrum is the failure to look for —
    it looks perfectly plausible.
  - **Insert data table** and **Insert spectrum chart** must both work. On a large file
    the table says how many of the original points it wrote.
  - Try a text file that is not JCAMP: it must say so, not draw an empty frame.
- [ ] **BVP / PDE / DAE (v2.19.0).** Open **Analyze**; five new calculators.
  - **Boundary value problem.** Defaults are y'' = -y on [0, π/2] with y = 0, 1 — the
    answer is sin x, so y near the midpoint must be about 0.707. The result must report an
    **observed convergence order near 2** and carry the caveat that a BVP may have no
    solution, one, or infinitely many.
  - Switch Method to **Shooting**: the curve must come out the same.
  - **PDE - heat.** With the defaults the peak must **shrink** steadily and both ends stay
    at 0. Now switch the scheme to **Explicit FTCS**: it must either report that Δt was
    **REDUCED** for stability, or refuse and name Crank-Nicolson. It must NOT return huge
    oscillating values.
  - **PDE - wave.** With the defaults the amplitude must **not** decay — a wave preserves
    it, unlike heat — and at t = 2 the string should be back to its starting shape.
  - **PDE - Laplace.** The slices must be smooth, and the interior must stay within the
    boundary values (the maximum principle).
  - **DAE.** Defaults are y' = -z with 0 = z - y, so y = e^-t and z tracks y. Now set the
    initial z to **5** (inconsistent): it must say the values were **INCONSISTENT**,
    report the residual, and start from the projected point.
  - **The refusal that matters:** enter the Cartesian pendulum — equations `x' = u`,
    `y' = v`, `u' = -L*x`, `v' = -L*y - 9.81`, initial y values `x = 1, y = 0, u = 0,
    v = 0`, constraint `x^2 + y^2 - 1`, initial z `L = 0`. It must **refuse**, say the
    system is **not index 1**, and mention index reduction. If it returns a pendulum,
    that is a serious bug.
- [ ] **The numerics cannot freeze the pane (v2.20.0).** The v2.19.0 solvers shipped with
  three bugs that the adversarial pass caught only afterwards. Worth confirming in Word:
  - **Analyze -> PDE - Laplace/Poisson.** Set **Intervals each way** to a huge number
    (e.g. 999999999). It must come back within a few seconds, having clamped the grid.
    Before v2.20.0 the equivalent call ran for 91 seconds with the pane frozen solid.
  - Now set that field to nonsense (`abc`), or clear it. It must fall back to a SMALL
    default, NOT to the largest grid, and must not show an error.
  - **Any of the five new calculators**, with a formula that only fails part way along —
    for the BVP, set the right-hand side to `1/(x-0.5)`, or use a function name that does
    not exist. It must report the equation as the problem. An unhandled error, or a
    frozen pane, is a regression.
- [ ] **Nothing freezes Word (v2.18.0).** The whole-library sweep found seven loops that
  never returned on a non-finite count. A frozen pane has no error and no way back, so
  these are worth a real pass:
  - **Finance -> Loan amortization.** Set **Years** to `1e400` (or paste a very long run
    of 9s). It must come back with a message. Before v2.19.0 this hung Word outright.
    Then set Years to `30`, payments/year `12`, and confirm you still get 360 rows.
  - **Finance -> Declining balance.** Same test on **Life**.
  - **Plot** with **Log scale** on data containing a colossal value (`1 1`, `2 1e308`).
    It must draw or decline — never hang.
  - **Solve.** Type `1e999 = 0`. It must say the literal is too large to represent,
    NOT "Reduced to -Infinity = 0". `x - 1e300 = 0` must still solve normally.
- [ ] **Persistent homology (v2.10.0).** In the **Topology (homology)** kind, PASTE a point
  cloud instead of a name — one point per line. A rough circle, e.g.:
  `1 0` / `0.7 0.7` / `0 1` / `-0.7 0.7` / `-1 0` / `-0.7 -0.7` / `0 -1` / `0.7 -0.7`
  - It must report a **most persistent H1 feature** with a clear lifetime, and draw a
    **barcode** in the pane.
  - Replace it with a random blob of 8 points: the long H1 bar must DISAPPEAR. That contrast
    is the whole feature — if a blob shows the same bar as a ring, something is wrong.
  - **Insert** it: the text lands AND the barcode arrives as a picture. Ctrl/Cmd+Z undoes.
  - Paste ~150 points: it must still respond, and say plainly that a cap was hit.
- [ ] **3D geometry (v2.9.0).** Still in the **Geometry** kind — triples switch it to 3D.
  - `vector (1,0,0) (0,1,0)` -> dot 0, cross (0,0,1), angle 90 deg, and the working says
    PERPENDICULAR.
  - `lines (0,0,0) (1,0,0) (0,0,1) (1,1,2)` -> **skew**, distance `sqrt(2)/2`.
  - `lines (0,0,0) (1,0,0) (2,-1,0) (2,1,0)` -> **intersecting** at (2,0,0), not skew.
  - `lines (0,0,0) (1,0,0) (0,3,0) (1,3,0)` -> **parallel**, distance 3.
  - `(0,0,0) (1,0,0) (0,1,0) (0,0,1)` -> tetrahedron volume **1/6** plus the sphere centre.
  - `(0,0,0) (1,0,0) (0,1,0) (1,1,0)` -> refused as **COPLANAR**: no volume, no unique sphere.
  - `(0,0,0) (1,1,1) (2,2,2)` -> refused as **COLLINEAR**: no plane.
  - `circle r=1/3` -> area **1/9*pi** exactly, and `box 1/2 1/3 1/4` -> volume **1/24**.
    (Typed fractions must stay exact — no long decimals or giant fractions anywhere.)
- [ ] **Topology / homology (v2.8.0).** Switch the dropdown to **Topology (homology)**.
  - `torus` -> H_0 = Z, H_1 = Z^2, H_2 = Z; Betti 1, 2, 1; chi = 0.
  - `sphere` -> H_0 = Z, H_1 = 0, H_2 = Z; chi = 2.
  - `projective plane` -> **H_1 = Z/2** (TORSION) and a caveat saying a field
    coefficient would have discarded it. chi = 1.
  - `Klein bottle` -> H_1 = **Z + Z/2**, H_2 = 0, chi = 0.
  - `circle` -> Z, Z. `figure eight` -> beta_1 = 2. `Mobius band` -> Z, Z.
  - Type your own: `[0,1,2] [0,1,3] [0,2,3] [1,2,3]` (tetrahedron boundary) -> S^2.
  - Every result must print **both** Euler characteristic lines and the sentence
    saying the two agree. If it ever says the check FAILED, that is a real bug.
- [ ] **Geometry inserts.** Insert a geometry result — the exact forms (9*pi, 2*sqrt(3))
  must arrive as real editable equations, with the working alongside.
- [ ] **Insert is a REAL equation now (v2.6.0).** With any Solve result on screen press
  **Insert**. What lands must be an **editable Word equation** — click it and Word shows
  the equation toolbar; a fraction like F/m is drawn as a fraction, and an integral shows
  a real ∫ with its limits. It must NOT be flat text. Ctrl/⌘+Z removes it in one step.
- [ ] **Superscripts:** paste/type `x² - 5x + 6 = 0` → same result as `x^2…` (x = 3, 2). The
  hint under the box reminds you to use `^` for powers.
- [ ] **Definite integral (exact):** `x^2` from `0` to `3` → **9**, method *exact (symbolic)*,
  and it shows **F(x) = x^3/3 + C**. `exp(x^2)` → falls back to numeric (adaptive Simpson).
- [ ] **Word problem** `12 is what percent of 48?` → **25%**; `twice a number plus 7 is 15`
  → shows the equation `2*n + 7 = 15` and **n = 4**.
- [ ] **Word problem** with free-form phrasing it can't template (e.g. a two-trains
  puzzle) → it says it can't parse and points to the AI option — it does NOT invent
  an answer.
- [ ] **Insert result** → the solution text lands at the cursor.

## 3. Units
- [ ] Type `9.81 m/s^2` → preview **9.81 m/s²** → **Insert quantity**.
- [ ] Type `5.0 +- 0.2 kg` → **5.0 ± 0.2 kg**.
- [ ] Convert `36` `km/h` → `m/s` → result **10** → **Insert result**.
- [ ] Convert `100` `°C` → `°F` → **212**.
- [ ] Convert incompatible (`1 kg → m`) → shows "can't convert".

## 4. Plot
- [ ] Function `sin(x)/x ; cos(x)`, x from `-10` to `10` → preview shows **two
  curves with a legend** → **Insert plot** (image inserts).
- [ ] **LEGEND OUTSIDE (v2.82.1).** In that same preview and in the inserted
  image, the legend box sits **to the right of the plot frame**, covering no
  part of either curve — and the inserted plot is NOT squashed: the plot frame
  is wider than it is tall, and a circle marker would read as a circle.
- [ ] Data box: `0 1` / `1 2 0.1` / `2 4` (one per line) → scatter with an error bar.
- [ ] Bad function (`sin(`) → shows an error hint, insert disabled.

## 4b. Table → Chart
- [ ] Put the cursor in a Word table of numbers (or use the pre-filled example) →
  **Refresh from selection** picks it up.
- [ ] Chart type **Column** → preview renders → **Insert** places the image.
- [ ] Switch to **Line** and **Scatter** → preview follows.
- [ ] Tick the **B&W / patent figure** option → preview loses colour (patent-safe).
- [ ] **Insert as editable PowerPoint** → a .pptx is produced/downloaded.

## 5. Finance
- [ ] Calculator **Loan payment**, defaults (200000, 5%, 30y, 12/yr) →
  **Payment = 1,073.64 per period** → **Insert result**.
- [ ] **Black–Scholes option**, defaults (Call, 100, 100, 1, 5%, 20%) → **Price = 10.45**.
- [ ] **Net present value**, defaults (10%, `-1000, 500, 500, 500`) → **NPV = 243.43**.
- [ ] **Internal rate of return**, same cash flows → **IRR = 23.34%**.
- [ ] Clear a numeric field → result shows "Enter all values", insert disabled.

## 6. Build
- [ ] Input `atoms: C O O` / `bonds: 1=2 1=3` → structure of **CO₂**, Formula `CO2`.
- [ ] Add an R-group (e.g. `atoms: C N R1 …`), fill `R1 = methyl, ethyl`, choose
  **Table** → **Insert** adds the structure + an R-group legend table.
- [ ] **Substituent gallery:** `R1a = c1ccccc1` / `R1b = CC(=O)O` → **Insert** adds
  drawn substituents with labels.

## 7. Code
- [ ] Paste pseudocode (e.g. `if x then return y`), style **Algorithm** → keywords
  bold, line numbers, optional caption → **Insert block**.
- [ ] Style **Code listing** → verbatim monospace block.

## 8. Sequence (ST.26)
- [ ] Add a sequence, type **DNA**, residues `ATGCAAAGCTAA`, organism `Homo sapiens`.
- [ ] **Generate ST.26 XML** → XML appears; warnings reasonable.
- [ ] **Copy XML** / **Download .xml** work.
- [ ] **In-text reference:** SEQ ID NO `1` → **Insert reference** → inserts "SEQ ID NO: 1".

## 9. Botanical
- [ ] `Rosa × hybrida 'Peace'` → preview italicizes *Rosa* and *hybrida*, leaves
  `×` and `'Peace'` roman → **Insert name**.
- [ ] Traits: `Plant height: 1.2 m` / `Flower color: RHS 46A` → **Insert table**.

## 10. Numerals
- [ ] **+ Add numeral** → row appears with **10**; set element `housing`.
- [ ] **Insert** on the row → inserts **housing (10)** at the cursor.
- [ ] Add a couple more, then type `(12)`/`(14)` callouts into the document.
- [ ] **Scan document** → reports orphans/unused/gaps consistently with the table.
- [ ] **Insert List of Reference Numerals** → heading + sorted table.
- [ ] Close and reopen the document → the numeral table is still there (saved in the doc).

## 11. Refs
- [ ] Caption **Figure**, text `The device` → **Insert caption** → "Figure 1. The
  device"; the "next" counter advances to **Figure 2**.
- [ ] Cross-reference **Fig.** `1` → **Insert reference** → "Fig. 1".
- [ ] **Check captions** → consistent (no gaps/dupes); add a `Figure 3` caption to
  force a gap and re-check → flags missing **2**.
- [ ] Close/reopen the doc → caption counters persist.

## 12. DNA
- [ ] Input `ATGGCCAAGCTTGATTAA` → live readout: length, GC%, reverse complement,
  mRNA, and a protein translation.
- [ ] Change **Frame** (+1/+2/+3 and reverse) → protein updates.
- [ ] **Tools:** primer **Tm** and **protein MW/pI/GRAVY** readouts show.
- [ ] **Find restriction sites** on a sequence containing `GAATTC` → lists **EcoRI**
  at the correct position.
- [ ] **Find ORFs** → table of ORFs; **Insert ORF table** inserts it.
- [ ] **Insert** reverse complement / mRNA / protein each inserts text.

## 12b. Align (Needleman–Wunsch / Smith–Waterman)
New in v1.72.0. Nothing here has been seen in Word.
- [ ] Paste `MKTAYIAKQRQISFVKSHFSRQ` into **A** and `MKTAYIAKQRQVSFVKSHFARQ` into **B**
  → readout shows **Global (Needleman–Wunsch) · BLOSUM62**, a score, and
  **Identity 20/22 (90.9%)**.
- [ ] The alignment block shows both sequences with a `|` ruler between them, the
  `|` sitting **directly above** each identical residue.
- [ ] Switch **Mode** to **Local** → readout says Smith–Waterman; score is ≥ the
  global score.
- [ ] Paste two DNA sequences (`ATGCGTACGTAGCTAGCTAG` / `ATGCGTACGTTGCTAGCTAGCAT`)
  → **Sequence type** auto-detect reports **DNA +5/−4**, not BLOSUM62.
- [ ] **Insert alignment** → lands at the cursor **in a monospace font**. This is the
  thing to check hardest: if it inserts in Calibri the columns no longer line up and
  the figure is wrong, not just ugly.
- [ ] The inserted block carries the stats line and the caveats beneath it.
- [ ] **Ctrl-Z** removes the whole insert in one step.
- [ ] Align two unrelated proteins (`MKTAYIAKQRQISFVKSHFSRQ` vs
  `WWPPCCWWPPCCWWPPCCWWPP`) → a **twilight zone** caveat appears warning that below
  ~25% identity unrelated sequences still align convincingly.

## 13. Reaction
- [ ] `CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux` → preview shows reactants `+`
  reactants, an arrow with **H2SO4** above / **reflux** below, then the product →
  **Insert reaction scheme** (image).
- [ ] Multi-step `A -> B -> C` (use real names/SMILES) → arrow between each stage.
- [ ] Charged SMILES `C[N+](C)(C)C >> X` → not split on the `+` inside brackets.

## 13b. Citations  *(legal — Bluebook)*
- [ ] **Case** form: fill the pre-filled example → preview shows a correctly
  formatted Bluebook cite → **Insert**.
- [ ] Switch style **Practitioner ↔ Academic** → the formatting changes
  accordingly.
- [ ] **Statute** and **Patent** forms → each previews and inserts.
- [ ] **Table of Authorities** → builds from the document's cites, grouped by
  category (Cases / Statutes / Other).
- [ ] **Table of Contents** → builds from the document's headings.

## 14. Audit
- [ ] With the document containing numerals, a `(99)` callout, `SEQ ID NO: 5`, and a
  `Fig. 7` reference that has **no** "Figure 7" caption → **Check this application**.
- [ ] Report sections appear: **Reference numerals, Sequences, Figures,
  Cross-references** — each flags the planted issues (orphan numeral, out-of-range
  SEQ ID, figure gap, dangling Fig. 7).
- [ ] A clean document → "✓ No issues found."

---

## Cross-cutting
- [ ] **Undo:** each insert is a clean single Ctrl-Z.
- [ ] **Home page:** every tile opens its tool; the Home tile returns to the grid.
- [ ] **Examples panel:** the "Examples & syntax" content changes with the mode.
- [ ] **Preferences persist:** toggle Numerals "Parenthesize callouts" and the DNA
  frame, reopen Word → choices remembered.
- [ ] **No network calls** during inserts (privacy-by-construction). The ONLY
  exception is the opt-in IUPAC name→structure lookup, which must prompt first.
- [ ] **Honesty surfaces are present:** Spectra shows its caveats, pKa is labelled
  a group estimate, and MS fragment "likelihood" is described as a ranking rather
  than an intensity. A missing caveat is a FAIL, not a cosmetic issue.
- [ ] **Update banner** (prod installs): with a newer `version.json` published, the
  pane surfaces the update notice.

## Sign-off
- Tester: ____________________  Date: __________  Build/commit: __________
- Result: ☐ All pass ☐ Pass with notes ☐ Blockers (list below)
