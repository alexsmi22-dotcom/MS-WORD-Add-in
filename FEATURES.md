# JurisLab — What it can do

A Microsoft Word add-in fusing **STEM authoring** and **patent & legal drafting**. It
runs **entirely on your machine** — nothing you type is sent anywhere — and inserts
cleanly formatted chemistry, math, structures, figures, sequences, citations, and more
directly at the cursor.

Opening the pane shows a **Home** page with the tools grouped by category — click a card
(or a tab at the top) to open a tool: **Chemical · Math · Units · Plot · Table → Chart ·
Finance · Build · Code · Sequence · Botanical · Numerals · Refs · Citations · DNA ·
Reaction · Audit.** Everything shows a live preview that matches exactly what gets
inserted, and the **Examples & syntax** panel updates to match the selected tool.

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
- **Formula validator** — checks every element symbol against the real 118-element periodic table (flags typos like `Xy`), balances parentheses/hydrates, and reports **molecular weight** and **net charge** (polyatomic ions handled, e.g. `NH4+`, `Ca(OH)2`).
- **Stereochemistry** — isomeric SMILES (`C[C@@H](N)C(=O)O`) drawn with wedges.
- Each inserted structure carries provenance (formula / MW / canonical SMILES / OCL ID) in its alt-text.
- **Physicochemical properties & druglikeness** — for any resolved structure, a readout of **cLogP**, **logS**, **topological PSA**, **H-bond donors/acceptors**, **rotatable bonds**, and **heavy-atom count**, plus the **Lipinski Rule of Five** and **Veber** oral-druglikeness screens (with the specific criteria that pass/fail). Insert the summary at the cursor. Estimated offline (OpenChemLib) — no server, no license tier.
- **Online name resolution (opt-in)** — for a full **systematic IUPAC name** the offline dictionary doesn't know (e.g. *2-amino-3-(1H-indol-3-yl)propanoic acid*), a **“Resolve name online”** button parses it via the EMBL-EBI **OPSIN** service and draws the result (also reporting its **InChIKey**). This is the **only** feature that leaves your machine: it's off until you click it, shows a **consent prompt** naming the service before the name is sent over the internet, and warns against use for confidential names. Everything else stays fully offline.

## ⚛️ Mass Spec — exact mass, isotope pattern, adducts
- From a **name, formula, or SMILES**, an offline mass-spectrometry readout for proteomics / metabolomics / small-molecule MS.
- **Exact masses** — **monoisotopic** (for high-resolution MS) and **average** molecular weight.
- **Isotope pattern** — the theoretical M, M+1, M+2… peaks with relative intensities, drawn as bars (e.g. the tell-tale **~32% M+2** of a chlorine, elevated M+2 for sulfur). Uses standard NIST isotope abundances across the common organic/bio elements (C, H, N, O, S, P, halogens, Si, Se, B, Na, K); any element outside that set is reported, not silently dropped.
- **Adduct m/z** — the common ESI ions computed exactly: **[M+H]⁺, [M+Na]⁺, [M+K]⁺, [M+NH₄]⁺, [M+2H]²⁺, [M−H]⁻, [M+Cl]⁻, [M+HCOO]⁻, [M−2H]²⁻**.
- Insert the full readout as a text summary. Computed entirely on your machine — verify before relying.

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

## 📐 Stats — statistics & uncertainty
- Turn experimental data into a paper-ready result, offline. Pick a test, paste numbers (separated by spaces, commas, or new lines), and it computes live.
- **Descriptive statistics** — n, mean, SD, **SEM**, variance, median, min/max, **95% CI** (t-based), CV.
- **t-tests** — two-sample (**Welch** or **Student** pooled) and **paired**, each with a real **p-value** and an APA-style report (*t*(18) = 2.41, *p* = .027).
- **One-way ANOVA** (F, df, p) and **linear regression** (slope, intercept, R², slope SE, slope p).
- **Uncertainty propagation** — enter a formula and `name = value ± uncertainty` lines; get the result with its **combined 1σ uncertainty** (first-order quadrature) and the dominant contributor.
- p-values use the regularized incomplete beta (Student-t and F distributions). Insert any result at the cursor. Analysis aid — verify before publishing.

## 📊 Table → Chart — patent figures & PowerPoint from a Word table
- Click anywhere **inside a table** in your document, press **Read selected table** — the add-in **auto-picks** the representation that fits its shape (chart, flowchart, block diagram, or table figure) and tells you why. Change it any time in **Show as**.
- **Charts** (numeric tables) — column, bar (horizontal), line, area, **scatter**, **stacked column / bar / area**, pie, doughnut. First column = category labels, first row = series names (when it's text); numbers may include `$`/`€`/`£`, `%`, thousands commas, units (`12 kg`), and accountant-style `(1,200)` negatives. Cells that aren't numbers are reported, not silently charted.
- **Flowchart** (text tables) — each row is a step, drawn top-to-bottom with arrows: a first column like `S101` becomes the step's **reference numeral** (with a lead line, patent-style); a step ending in `?` is drawn as a **decision diamond**; Start/End rows get rounded terminators; a `Step | Description` header row is skipped automatically. Ideal for **method-claim figures**.
- **Block diagram** (hierarchy) — each row is a path, e.g. `System 10 | Controller 20 | CPU 22`; shared parents merge into one **connected box tree** with orthogonal connectors. Leave a cell blank to repeat the value above (merged cells work). Ideal for **apparatus figures**.
- **Table figure** — draw the **table itself** as a clean figure, for characteristics/reference tables where the table *is* the exhibit. Preserves **section grouping** (a group-header row becomes a band; a blank "section" column merges down and is dropped if redundant), bolds/rules the header, **right-aligns numeric columns**, word-wraps cells, and scales wide tables to fit. Handles the dense clinical-style tables (`Section | Characteristic | n (%)`) common in specs.
- **Reference numerals** — number figure elements for callouts, drawn with **lead lines** to each element (37 CFR 1.84(q) style — free-standing numbers, not a column): block-diagram boxes get **hierarchical** numbers (100, 110, 112…) with a lead line to the box, flowchart steps get 102, 104… on alternating sides, and the table figure gets margin numerals with lead lines to each row/section. Auto-placed as a **starting point** — the drafter repositions them as needed.
- **Insert as a figure** at the cursor — the graphic goes into your document as an image; optionally **also insert the data as an editable table** beneath it, so the text stays editable.
- **Insert as an editable Word table** — for the table figure, insert a native, fully **editable** Word table instead of a picture (bold/shaded header, shaded section rows, right-aligned numbers). Edit the text like any Word table.
- **Smart column detection for charts** — a leading **row-index** column (1, 2, 3…) or a mostly-blank **section** column is recognized and skipped, so the real text column is used for labels (and the section groups them); `8,408 (75.0%)` reads as the count and a lone `(75.0%)` as +75% (not −75).
- **Patent figure style** — pure **black-&-white line art** for patent drawings (37 CFR 1.84-friendly): hatched bars/slices, dash patterns + marker shapes for line charts, white boxes with black outlines for diagrams, all-black ink, plus an optional **“FIG. N” label** beneath the graphic.
- **PowerPoint export** — download a .pptx that stays **editable**: a color chart exports as a native chart, a **table figure** as a native editable **table**, and a **flowchart / block diagram** as native editable **shapes** (boxes, diamonds, connectors — labels editable). Big diagrams **paginate across slides** — flowcharts continue via off-page connector circles (A, B, …) with numerals continuing, block diagrams split by branch with the parent repeated — so nothing gets crushed onto one slide. Only patent-hatched charts ship as a picture. Optional **source table on a second slide**.
- Generated entirely on your machine — the document never leaves Word.

## ⚖️ Citations — Bluebook legal citations
- Format citations from labeled fields, with the correct **italics** applied on insert (case names, article/book titles, signals).
- **Cases** — full (`Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014)`) and short form (`Alice, 573 U.S. at 217`); court omitted for the U.S. Supreme Court, included for lower courts. Optional **parallel citations** (Rule 10.3.1) sit after the primary reporter (`… 573 U.S. 208, 134 S. Ct. 2347, 189 L. Ed. 2d 296 (2014)`). **T6/T10 abbreviation** of case names on request; an **unrecognized reporter is flagged** so a typo isn't inserted unnoticed.
- **Statutes & regulations** — `35 U.S.C. § 101`, `37 C.F.R. § 1.84`; multiple sections auto-switch to `§§`; optional subsection and year.
- **Patents** — `U.S. Patent No. 10,123,456` (digits auto-grouped, `D`/`RE` prefixes kept) with optional pincite and issue date; **application publications** `U.S. Patent Application Publication No. 2020/0123456 A1`.
- **Agency & secondary** — Federal Register (`85 Fed. Reg. 12,345 (Mar. 1, 2020)`), **MPEP** sections, **law-review articles**, and **treatises** (e.g. Chisum on Patents).
- **Practitioner / academic style** — a toggle for the two Bluebook typeface systems: *Practitioner* (briefs & office actions) italicizes case names and book titles; *Academic* (law-review footnotes) sets case names roman and authors/journals in large-and-small caps.
- **Reporter & court auto-correct** — messy input is normalized to canonical Bluebook forms (`f3d` → F.3d, `f supp 2d` → F. Supp. 2d, `fed cir` → Fed. Cir., `9th cir`/`ninth circuit` → 9th Cir., `cafc` → Fed. Cir., `sdny` → S.D.N.Y.).
- **Signals** — optional italicized *See*, *See also*, *Cf.*, *But see*, *Contra*, … prepended. Dates like `2014-06-19` or `3/1/2020` become `June 19, 2014` / `Mar. 1, 2020`.
- **Paste & fix** — paste a messy citation (`35 usc 101`, `alice corp v cls bank, 573 us 208 (2014)`, `US Pat No 10123456`) and it detects the type and fills the fields for you to review, then reformats it. Best-effort — verify the result.
- **Id. / supra short forms** — `Id.` / `Id. at 217` for the immediately preceding authority; `<name>, supra note 15, at 912` for an earlier source; plus a one-click "→ Short form of this case".
- **Find all citations (register)** — scan the document for a running record of every authority with a **usage count**, flagging any cited more than once, so you can see repeats before building the table. Once the field-based table has been built and updated (F9), Find again and each authority also shows its **page numbers** (read back from the table). Copyable; nothing is written to the document. (Short forms — *Id.*, *supra*, "…, 925 F.3d at 1237" — aren't counted, same as Word's own citation marking.)
- **Table of Contents** — insert a native Word Table of Contents built from your Heading 1–3 styles, with page references (FRAP 28(a)(2)). Select all and press F9 to populate; it updates with the document.
- **Table of Authorities** — scan the whole document for citations and build a grouped, alphabetized, de-duplicated authorities list (Cases · Statutes · **Rules** · Regulations · Patents · Other Authorities), **case names italicized** and each cite carrying its **(court year)** parenthetical (OSG/Bluebook form) — the FRAP 28(a)(3) order. The field-based table italicizes case names too (via Word's "keep original formatting"), and the button **clears any existing citation marks first** so a stale/corrupt entry can't survive the rebuild. Now also captures **unpublished decisions** (`… 2017 WL 11546716`, `… 2013 U.S. Dist. LEXIS 169661`), the **F.R.D.** reporter, **Fed. R. Civ. P.** rules (bare `Rule 12(b)(7)` and qualified `Fed. R. Civ. P. 19(a)`), and party names with **diacritics** (`Suárez`), **en-dashes** (`Roussel–UCLAF`), or **comma-separated firm names** (`Hamilton, Brook, Smith & Reynolds, P.C.`). The **formatted list** writes a clean **static** table (no Word fields) — Times New Roman, italic case names, each entry on **two lines** (name, then the reporter + (court year) indented with a dot leader), matching a standard court-brief template. To fill page numbers, a simple 3-step flow: click **“Insert with live page numbers”** (a temporary Word field table), select all and press **F9** (Word computes the pages), then click **“Insert formatted list”** — it copies those pages into the static table and removes the temporary one for you. One-click removal of citation marks / TOC-TOA tables is available for a clean rebuild. (Under FRAP 32(f) the TOC and TOA are excluded from the brief's word count.)
- **Copy** the plain text or **insert** the formatted citation. Drafting aid — verify against the current Bluebook.

## 🔖 Refs — captions & cross-references
- **Auto-numbered captions** — "Figure 1.", "Table 2." with per-document running counters (saved in the file).
- **Cross-references** — insert "Fig. 3", "Table 2", or "Eq. (1)".
- **Check captions** — flags skipped or duplicated figure/table numbers. (For live auto-renumbering, Word's own cross-reference fields remain the authority.)

## 💵 Finance — calculators & formulas
- **18 calculators** (compute & insert the result) spanning: **time value of money** (future/present value, annuities, growing annuities), compound interest & **effective annual rate**, **loan payment** and **amortization schedule**, **NPV/IRR** and date-aware **XNPV/XIRR** from a cash-flow list, **DCF valuation** with a Gordon-growth terminal value, **bond analytics** (price, **YTM**, **Macaulay/modified duration**, **convexity**), **Black–Scholes** option price with **Greeks** (Δ Γ Θ ν ρ) and **implied volatility**, **depreciation** (straight-line/declining-balance), and **return statistics**. Pick a calculator, fill the inputs, and the result computes live (robust root-finding under the hood).
- **Finance formula library** — typeset equations in **Math** mode's *Formula library*: time-value-of-money, valuation & options (NPV, Gordon growth, WACC, Black–Scholes, put–call parity), and portfolio & bonds (CAPM, Sharpe ratio, portfolio variance, beta, bond price, duration).
- Rates entered as percentages; values are currency-neutral. Runs entirely offline.

## 🧫 Bio/Assay — quantitative life-science tools
- **Curve fitting, offline.** Paste your data and the fit runs entirely on your machine (Levenberg–Marquardt nonlinear least squares) — no server, no GraphPad round-trip. Each fit reports the parameters with **standard errors** and **R²**, and draws the **fitted curve over your data points** as a plot you can insert.
- **Enzyme kinetics** — **Michaelis–Menten** (V_max, K_m) and **Hill** (V_max, K, cooperativity coefficient *n*) fits; **catalytic efficiency** (k_cat, k_cat/K_m). The classic Lineweaver–Burk / Eadie–Hofstee / Hanes–Woolf linearizations seed the fit so no starting guess is needed.
- **Dose–response** — a **4-parameter logistic** returns **IC50 / EC50**, Hill slope, plateaus, and **pEC50** (agonist and inhibition curves both fit the same model); **Cheng–Prusoff** converts an IC50 to the true K_i.
- **Receptor binding** — one-site **saturation binding** (B_max, K_d).
- **Everyday lab math** — **Henderson–Hasselbalch** buffer pH, **Beer–Lambert** concentration from absorbance, **dilution** (C₁V₁ = C₂V₂) and **serial-dilution** planning, and **A260 / A280** nucleic-acid and protein quantitation.
- Insert the result as text and, for the fits, the fitted-curve figure. Analysis aid — verify before publishing.

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
- Per-sequence molecule type and organism; the source **mol_type** picks from the full ST.26 controlled vocabulary (genomic DNA/RNA, **mRNA, tRNA, rRNA**, other/transcribed/viral RNA, …). Residues are cleaned (whitespace/numbering stripped, case normalized, IUPAC ambiguity codes accepted, invalid residues flagged).
- **Feature annotation** — add **CDS / gene / mRNA / misc_feature** features with a location (`1..300`) and the common qualifiers (`/gene`, `/product`, `/note`). A **CDS auto-generates `/translation`** from the coding region using the verified genetic code (plus `/codon_start`), and flags a reading-frame warning if the length isn't a multiple of 3.
- Applicant / invention-title / application metadata; **download `.xml`** or **copy**.
- *Always validate the output in the WIPO Sequence tool before filing.*

## 🔗 Peptide — structure from a sequence
- Draw a **peptide's 2D structure** from its amino-acid **sequence** and insert it.
- **One-letter** codes (`ACDEFG`, spaces optional) or **three-letter** codes with separators (`Ala-Gly-Ser`, `Met Lys`).
- Free N- and C-termini; reports **residue count, molecular formula, and molecular weight**. Unrecognized residues are flagged, not silently dropped.
- Shows **connectivity** (stereochemistry isn't drawn — so it never asserts a wrong configuration). Best for short peptides; long chains render densely. Verify before relying.

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
- Advisory, in the house style: the scan detects both the parenthesized callout form `(12)` and the non-parenthesized `element 12` form (matched to your table's element names) — verify before filing.

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
