# Changelog

All notable changes to Formula Inserter. Dates are release/pilot dates.

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
