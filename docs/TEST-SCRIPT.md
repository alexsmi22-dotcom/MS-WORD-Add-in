# JurisLab — Manual Test Script (v2.26.0)

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
