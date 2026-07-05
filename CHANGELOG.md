# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

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
