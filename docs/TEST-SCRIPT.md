# JurisLab — Manual Test Script (v2.61.0)

A step-by-step smoke test to verify the add-in works end-to-end **inside Word**.
The engine is covered by 3,200+ automated unit tests, and `npm run qc` now also
boots the pane in headless Chromium to check every tool renders. This script
covers what neither can reach: insertion into a real document, undo, document
scanning, and layout. Budget ~30 minutes for the full pass.

Mark each box: ☐ pass · ✗ fail (note what happened).

---

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
(8 tools) and **Quantum optics** (4), and the mode must state **78 calculators**.

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
state **78 calculators** across **sixteen disciplines**.

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
**78 calculators** across **sixteen disciplines**.

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
**78 calculators** across **sixteen disciplines**.

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
domains. The mode must state **78 calculators** across **sixteen disciplines**.

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
**78 calculators** across **sixteen disciplines**.

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
