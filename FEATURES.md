# Formula Inserter — What it can do

A Microsoft Word add-in for patent drafting. It runs **entirely on your machine** —
nothing you type is sent anywhere — and inserts cleanly formatted chemistry, math,
structures, code, sequences, and botanical names directly at the cursor.

Pick a **mode** at the top of the pane: **Chemical · Math · Units · Plot · Table → Chart · Finance · Build · Code · Sequence · Botanical · Numerals · Refs · DNA · Reaction · Audit.**
Everything shows a live preview that matches exactly what gets inserted, and the
**Examples & syntax** panel updates to match the selected mode.

> Drafting aid — always verify structures, formulas, and listings before filing.

---

## Across all modes
- **Search** formulas and compounds by name (e.g. "quadratic", "benzene").
- **Recents & favorites**, with a one-click **Clear** for confidentiality.
- **Live preview** = the exact output that's inserted.
- Runs offline after first load; no document content leaves the machine.

## 🧪 Chemical
- Format formulas with correct sub/superscripts: `H2O` → H₂O, `SO4^2-` → SO₄²⁻, `Na+` → Na⁺, `Ca(OH)2` → Ca(OH)₂.
- Charge, lone-pair, and common group/ion palette (OH, NH₄, SO₄, CH₃, …).
- **2D structures**, offline, from a **name** (`aspirin`), **formula** (`C6H6`), or **SMILES** (`CC(=O)O`).
- **Name lookup** — recognized compounds show their name (dictionary-based), which you can insert.
- **Stereochemistry** — isomeric SMILES (`C[C@@H](N)C(=O)O`) drawn with wedges.
- Each inserted structure carries provenance (formula / MW / canonical SMILES / OCL ID) in its alt-text.

## ∑ Math (native Word equations)
- Fractions, super/subscripts, roots (`sqrt`, n-th `root`), `Σ`/`∫`/`∏`, limits, `|x|`, accents (`bar`/`hat`/`vec`), factorials, implicit multiplication, full Greek.
- **Matrices** — `matrix(a,b; c,d)`, plus `pmatrix`/`bmatrix`/`vmatrix`; **piecewise** `cases(…)`.
- **Logic & set theory** — ∀ ∃ ∈ ∉ ⊆ ∪ ∩ ∅ ∧ ∨ ¬ ⊕ ⇒ ⇔.
- **Number sets** — ℤ ℝ ℕ ℚ ℂ 𝔽 𝔼; `floor`/`ceil`/`norm`, `∂`, `∇`, `mod`, `°`, bracket grouping `[S]`.
- **Engineering & physics** — Dirac bra-ket (`bra`/`ket`/`braket`), contour/multiple integrals `∮ ∬ ∭`, phasor `∠`, `ℏ`, `Ω`, Laplace `ℒ` / Fourier `ℱ`, `Re`/`Im`.
- **Function families** (palette + library) — trig, inverse-trig, hyperbolic, log/exp, special (`Γ`, `ζ`, `erf`, `sgn`), discrete (`C(n,k)`, `P(n,k)`, …).
- **Equation numbering** — optional right-aligned (I), (II), … with a counter and reset.
- **Import / export LaTeX** — paste LaTeX (`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`) to turn it into a native Word equation, or copy the current formula out as LaTeX.
- **Multi-line aligned equations** — `align(a = b; c = d)` (or paste a LaTeX `align`/`aligned` block) → a stacked Word equation array.
- **Formula library** grouped into *Mathematics* (statistics, geometry, algebra, trig, calculus), *Functions*, and *Science & engineering* (**Cryptography, Computer science/ML, Mechanical engineering, Electrical engineering, Physics, Biology/assays**).
- Symbol palette is collapsible; its open/closed state is remembered.

## 📏 Units — quantities & conversion
- **Typeset quantities** with SI conventions: `9.81 m/s^2` → 9.81 m/s², `5.0 +- 0.2 kg` → 5.0 ± 0.2 kg, `1.2e-3 mol/L` → 1.2 × 10⁻³ mol/L (thin space, superscripts, ±, ×10ⁿ).
- **Symbol fixes** — `ohm` → Ω, `degC` → °C, `umol` → µmol, `*`/spaces → ·.
- **Convert** across length, mass, time, temperature (affine), volume, pressure, energy, amount, and angle — e.g. `1 km → mi`, `100 °C → °F` — including **compound units** (`km/h → m/s`, `g/mol → kg/mol`), with significant-figure rounding. Insert the typeset quantity or conversion result.

## 📈 Plot — function & data charts
- Plot a **function** `y = f(x)` (`sin(x)/x`, `x^2`, `exp(-x^2)`; sin/cos/tan/exp/log/sqrt/abs…, constants pi/e) over an x-range.
- Plot **data** points (`x y` per line, optional `err` for error bars) as scatter — combine with a function on the same axes.
- **Multiple functions** at once (separate with `;`) with a labeled **legend**.
- Axes, ticks, gridlines, optional title and axis labels. Rendered offline as an image; nothing leaves your machine.

## 📊 Table → Chart — patent figures & PowerPoint from a Word table
- Click anywhere **inside a table** in your document, press **Read selected table** — the add-in **auto-picks** the representation that fits its shape (chart, flowchart, block diagram, or table figure) and tells you why. Change it any time in **Show as**.
- **Charts** (numeric tables) — column, bar (horizontal), line, area, pie, doughnut. First column = category labels, first row = series names (when it's text); numbers may include `$`/`€`/`£`, `%`, thousands commas, units (`12 kg`), and accountant-style `(1,200)` negatives. Cells that aren't numbers are reported, not silently charted.
- **Flowchart** (text tables) — each row is a step, drawn top-to-bottom with arrows: a first column like `S101` becomes the step's **reference numeral** (with a lead line, patent-style); a step ending in `?` is drawn as a **decision diamond**; Start/End rows get rounded terminators; a `Step | Description` header row is skipped automatically. Ideal for **method-claim figures**.
- **Block diagram** (hierarchy) — each row is a path, e.g. `System 10 | Controller 20 | CPU 22`; shared parents merge into one **connected box tree** with orthogonal connectors. Leave a cell blank to repeat the value above (merged cells work). Ideal for **apparatus figures**.
- **Table figure** — draw the **table itself** as a clean figure, for characteristics/reference tables where the table *is* the exhibit. Preserves **section grouping** (a group-header row becomes a band; a blank "section" column merges down and is dropped if redundant), bolds/rules the header, **right-aligns numeric columns**, word-wraps cells, and scales wide tables to fit. Handles the dense clinical-style tables (`Section | Characteristic | n (%)`) common in specs.
- **Reference numerals** — number figure elements for callouts, drawn with **lead lines** to each element (37 CFR 1.84(q) style — free-standing numbers, not a column): block-diagram boxes get **hierarchical** numbers (100, 110, 112…) with a lead line to the box, flowchart steps get 102, 104… on alternating sides, and the table figure gets margin numerals with lead lines to each row/section. Auto-placed as a **starting point** — the drafter repositions them as needed.
- **Insert as a figure** at the cursor — the graphic goes into your document as an image; optionally **also insert the data as an editable table** beneath it, so the text stays editable.
- **Insert as an editable Word table** — for the table figure, insert a native, fully **editable** Word table instead of a picture (bold/shaded header, shaded section rows, right-aligned numbers). Edit the text like any Word table.
- **Smart column detection for charts** — a leading **row-index** column (1, 2, 3…) or a mostly-blank **section** column is recognized and skipped, so the real text column is used for labels (and the section groups them); `8,408 (75.0%)` reads as the count and a lone `(75.0%)` as +75% (not −75).
- **Patent figure style** — pure **black-&-white line art** for patent drawings (37 CFR 1.84-friendly): hatched bars/slices, dash patterns + marker shapes for line charts, white boxes with black outlines for diagrams, all-black ink, plus an optional **“FIG. N” label** beneath the graphic.
- **PowerPoint export** — download a .pptx that stays **editable**: a color chart exports as a native chart, a **table figure** as a native editable **table**, and a **flowchart / block diagram** as native editable **shapes** (boxes, diamonds, connectors — labels editable). Only patent-hatched charts ship as a picture. Optional **source table on a second slide**.
- Generated entirely on your machine — the document never leaves Word.

## 🔖 Refs — captions & cross-references
- **Auto-numbered captions** — "Figure 1.", "Table 2." with per-document running counters (saved in the file).
- **Cross-references** — insert "Fig. 3", "Table 2", or "Eq. (1)".
- **Check captions** — flags skipped or duplicated figure/table numbers. (For live auto-renumbering, Word's own cross-reference fields remain the authority.)

## 💵 Finance — calculators & formulas
- **Calculators** (compute & insert the result): time value of money (future/present value), compound interest, **loan payment**, **NPV** and **IRR** from a cash-flow list, **Black–Scholes** option price, and **bond pricing**. Pick a calculator, fill the inputs, and the result computes live.
- **Finance formula library** — typeset equations in **Math** mode's *Formula library*: time-value-of-money, valuation & options (NPV, Gordon growth, WACC, Black–Scholes, put–call parity), and portfolio & bonds (CAPM, Sharpe ratio, portfolio variance, beta, bond price, duration).
- Rates entered as percentages; values are currency-neutral. Runs entirely offline.

## 🔬 Build — structures & Markush genus
- Build a 2D structure from a typed **atom/bond list** or a pasted **MDL molfile**.
- Bonds: single `-`, double `=`, triple `#`, undefined `~`, stereo wedge `>` / hash `<`; atom charges; hydrogens filled automatically.
- **Markush / generic** atoms: `[C,N]` lists, `X` halogen, `A` any atom, `Q` heteroatom, `R`/`R1`/`R2` R-groups.
- **R-group legends** — insert "where R1 = …" as a line *or* a structured **R-group | Definition table**.
- **Sub-generic (nested) R-groups** — `R1 = C1-6 alkyl substituted with R1a`, and `R1a` gets its own input automatically.
- **Definition shorthands** — `C1-6 alkyl` → C₁–C₆ alkyl, "optionally substituted", variable counts (`n=1-3`).
- **Query features** for a rigorous genus — `{ar}` aromatic, `{ring}` in-ring, `{r5}`/`{r6}` ring size, `{sub}`/`{nosub}` open/closed substitution; bonds `{ring}`/`{ar}`.
- **Substituent gallery** — depict R-group alternatives as drawn 2D structures (`R1a = c1ccccc1`, `R1b = c1ccncc1`).

## 💻 Code
- **Algorithm / pseudocode blocks** — bold control-flow keywords, line numbers, optional caption ("Algorithm 1: KeyGen"). Ideal for crypto & CS claims.
- **Code listings** — verbatim monospace, whitespace-preserving, optional line numbers.

## 🧬 Sequence — WIPO ST.26
- Generate a **draft ST.26 sequence-listing XML** from DNA/RNA/protein sequences.
- Per-sequence molecule type and organism; residues are cleaned (whitespace/numbering stripped, case normalized, IUPAC ambiguity codes accepted, invalid residues flagged).
- Applicant / invention-title / application metadata; **download `.xml`** or **copy**.
- *Always validate the output in the WIPO Sequence tool before filing.*

## 🌿 Botanical — plant patents
- **Scientific-name typesetting** with correct nomenclature italics — genus, species, and infraspecific epithets italic; rank connectors (`subsp.`/`var.`/`f.`), author citations, hybrid `×`, and cultivars (`'Peace'`) roman; quotes normalized, genus capitalized.
- **Varietal characteristics table** from `Label: value` lines (plant height, flower color/RHS, habit, …).

## 🧬 DNA — sequence analysis
- **Reverse complement** / complementary strand (IUPAC ambiguity codes accepted).
- **Transcription** — coding strand → mRNA (T → U).
- **Translation** — to protein in any reading frame (**+1/+2/+3** and reverse **−1/−2/−3**); stop codons shown as `*`; degenerate codons resolved when unambiguous (e.g. `GCN` → Ala); optional "stop at first stop".
- **GC content & base composition** — length, A/C/G/T counts, GC%.
- **Six-frame ORF finder** — ATG → in-frame stop across all six frames, with a minimum-length (aa) filter; results as a Strand/Frame/Location/Length/Protein table you can insert.
- **Bench tools** — primer **Tm** (Wallace / GC%), **protein properties** (MW, pI, GRAVY) of the translation, and a **restriction-site** scan (common type-II enzymes).
- Live as you type; insert any result (strand, mRNA, protein, ORF table) at the cursor. Companion to **Sequence** mode (which produces the ST.26 listing). Drafting aid — verify downstream.

## 🔢 Numerals — reference-numeral management
- Maintain a **numeral → element table** (widget 10, housing 12, fastener 14, …) **saved inside the document**, so each case keeps its own list.
- **One-click callout insertion** at the cursor — `housing (12)` (or no-parens `housing 12`); next numeral is auto-suggested (10, 12, 14 …).
- **Scan document** to flag **collisions** (one numeral reused for two elements), **gaps** (skipped numbers), **orphans** (a callout with no table entry), and **unused** entries (defined but never called out).
- **Insert the "List of Reference Numerals"** section — a heading plus a sorted Numeral | Element table.
- Advisory, in the house style: the scan detects the parenthesized callout form, e.g. `(12)` — verify before filing.

## ⚗️ Reaction — reaction schemes
- Compose `reactants + reactants >> products` with optional conditions over/under the arrow (`; over ; under`).
- **Multi-step** schemes too — `A -> B -> C` draws an arrow between each stage.
- Each component is a name or SMILES (formal charges like `[N+]` are kept intact), drawn with OpenChemLib; the scheme inserts as one image with provenance alt-text.

## ✅ Audit — check this application
- One pass over the whole document runs every consistency check at once: **reference numerals** (uses your Numerals table), **SEQ ID NO** references vs. the listing, **figure-number** continuity, and **cross-reference validity** (every "Fig. N"/"Table N" has a matching caption).
- Grouped report with a ✓ per clean area. Advisory — every check is heuristic; verify before filing.

## Preferences & polish
- Your **callout-parenthesis** and **default DNA frame** choices are remembered between sessions.
- In **Sequence** mode, insert a canonical **SEQ ID NO: N** in-text reference.

---

*Questions or requests? Contact the maintainer. Each release is tagged in source control.*
