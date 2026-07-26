# JurisLab — Manual Test Script (v1.96.0)

A step-by-step smoke test to verify the add-in works end-to-end **inside Word**.
The engine is covered by 2,800+ automated unit tests, and `npm run qc` now also
boots the pane in headless Chromium to check every tool renders. This script
covers what neither can reach: insertion into a real document, undo, document
scanning, and layout. Budget ~30 minutes for the full pass.

Mark each box: ☐ pass · ✗ fail (note what happened).

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
- [ ] **Differentiate** `sin(x^2)` → **`2*x*cos(x^2)`** (conventional factor order).
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
