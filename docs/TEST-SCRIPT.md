# Formula Inserter — Manual Test Script (v1.0.0)

A step-by-step smoke test to verify the add-in works end-to-end **inside Word**.
The engine is covered by 793 automated unit tests; this script verifies the parts
that only run in the Office host: insertion, document scanning, settings, and the
live UI. Budget ~20 minutes for the full pass.

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
- [ ] The pane loads with the mode row showing 14 modes:
  **Chemical · Math · Units · Plot · Finance · Build · Code · Sequence · Botanical · Numerals · Refs · DNA · Reaction · Audit.**
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

## 13. Reaction
- [ ] `CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux` → preview shows reactants `+`
  reactants, an arrow with **H2SO4** above / **reflux** below, then the product →
  **Insert reaction scheme** (image).
- [ ] Multi-step `A -> B -> C` (use real names/SMILES) → arrow between each stage.
- [ ] Charged SMILES `C[N+](C)(C)C >> X` → not split on the `+` inside brackets.

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
- [ ] **Examples panel:** the "Examples & syntax" content changes with the mode.
- [ ] **Preferences persist:** toggle Numerals "Parenthesize callouts" and the DNA
  frame, reopen Word → choices remembered.
- [ ] **No network calls** during inserts (privacy-by-construction).

## Sign-off
- Tester: ____________________  Date: __________  Build/commit: __________
- Result: ☐ All pass ☐ Pass with notes ☐ Blockers (list below)
