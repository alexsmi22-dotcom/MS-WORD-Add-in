# JurisLab — Word Add-in (formerly Formula Inserter)

A Microsoft Word add-in (Office.js / TypeScript) for **STEM authoring and patent &
legal drafting**, with a strong **life-science** toolset. It turns what you type
into correctly formatted content — formulas, structures, mass spectra, kinetics
fits, peptides, statistics, a no-code numerical workbench (matrix math,
optimization, FFT, ODE solving, data insights), equations, plots, sequences,
citations, and more — and inserts it at the cursor. Everything runs **entirely on your machine; no document
content is sent anywhere** (the one exception is the strictly opt-in online
name→structure lookup, which prompts before sending).

Pick a tool from the home screen — **22 tools** (grouped STEM + legal):

| Mode | What it does |
|---|---|
| **Chemical** | formulas (`H2O`→H₂O, `SO4^2-`→SO₄²⁻), 2D structures from name/formula/SMILES, structure→name lookup, **physicochemical properties & druglikeness** (cLogP, tPSA, Lipinski/Veber), **pKa group estimation** + net charge at pH 7.4, opt-in **online IUPAC name→structure** (OPSIN) |
| **Mass Spec** | monoisotopic & average mass, theoretical **isotope pattern**, and common **adduct m/z** ([M+H]⁺, [M+Na]⁺, [M+2H]²⁺, [M−H]⁻…) |
| **Spectra** | **NEW** — predicted spectra from structure, offline: **¹H / ¹³C NMR** (shift, integration, n+1 multiplicity, assignment), **IR** group frequencies + simulated transmittance trace, **UV-Vis λmax** (Woodward–Fieser, with the arithmetic shown), and **EI-MS fragmentation** (α-cleavage, benzylic/tropylium, McLafferty, neutral losses). Estimates from published additivity rules — labelled as such, never presented as acquired spectra |
| **Bio/Assay** | offline curve fitting: **enzyme kinetics** (Michaelis–Menten, Hill), **dose–response** (IC50/EC50, 4PL), **binding** (Kd/Bmax), plus lab calculators (Cheng–Prusoff, Henderson–Hasselbalch, Beer–Lambert, dilutions, A260/A280) |
| **Peptide** | 2D structure from a one- or three-letter amino-acid sequence, with formula & MW |
| **Stats** | descriptive stats, **t-tests** (Welch/Student/paired), one- & **two-way ANOVA**, regression, **non-parametric** (Mann–Whitney, Wilcoxon), **chi-square** (fit & independence), **multiple-comparison correction** (Bonferroni/Holm/BH), and **uncertainty propagation** |
| **Analyze** | **NEW** — no-code numerical workbench: **matrix math** (solve A·x=b, inverse, determinant/rank/trace, eigenvalues incl. complex, **QR**, **SVD**, one-line **matrix expressions** like `A*inv(B)+2*C'`), **optimization** (Nelder–Mead), **FFT** spectra, **ODE/system solving** — type the equation you have (**higher order auto-reduces**: `y'' = -0.1*y' - y` just works), with explicit **RK45** plus a 4th-order implicit **stiff solver** (RODAS4) and **automatic stiffness detection**, so kinetics with widely separated rate constants actually solve; **report at the times you choose** (computed, not interpolated) and **stop on a condition** (“when does it hit zero?”) — and **raw data → trends, correlations & plain-language insights**, all offline |
| **Math** | native Word equations, matrices/cases, **LaTeX import/export**, multi-line aligned equations, a formula library |
| **Units** | SI typesetting (±, ×10ⁿ, µ/Ω/°), significant figures, unit conversion incl. compound units (`km/h → m/s`) |
| **Plot** | offline function & data charts (multiple series + legend, error bars) |
| **Table → Chart** | charts (column/bar/line/area/scatter/stacked), flowcharts, block diagrams, table figures; B&W patent figures or editable PowerPoint |
| **Finance** | 18 calculators — TVM / loan / NPV / IRR / DCF / Black–Scholes + Greeks / bond analytics, plus a finance equation library |
| **Build** | molecules from atom/bond lists or molfiles; Markush/R-group genus + substituent gallery |
| **Code** | algorithm (bold-keyword) and verbatim code listings |
| **Sequence** | WIPO **ST.26** biological sequence listings (DNA/RNA/protein) with CDS/gene annotation |
| **Botanical** | plant-patent scientific-name typesetting + varietal trait tables |
| **Numerals** | reference-numeral management (callouts, collision/gap/orphan checks, list) |
| **Refs** | auto-numbered figure/table captions and cross-references |
| **DNA** | reverse complement (RNA-aware), transcription, six-frame translation, ORF finder, primer Tm, protein MW/pI/GRAVY, restriction sites |
| **Reaction** | multi-step reaction schemes with conditions over the arrow |
| **Citations** | Bluebook citations (cases/statutes/patents/Fed. Reg./MPEP), practitioner/academic styles, T6/T10 abbreviation, **Table of Contents**, **Table of Authorities**, citation register |
| **Audit** | one-pass whole-document consistency check (numerals, SEQ ID NO, figures, cross-references) |

```
H2O → H₂O   ·   paste \frac{-b±√(b²-4ac)}{2a} (LaTeX) → a Word equation   ·   aspirin → 2D structure
```

> **Status:** v1.61.0 — production. Word on **Windows & macOS**,
> 100% client-side. Install packs: [`install/`](install/) · feature list: [`FEATURES.md`](FEATURES.md).

## Screenshots

<!-- Capture a few shots of the pane in Word (Win+Shift+S), save them in
     docs/screenshots/, and uncomment the lines below. See docs/screenshots/README.md. -->
<!--
![Chemical mode — H₂O and a 2D structure](docs/screenshots/chemical.png)
![Math mode — LaTeX import to a Word equation](docs/screenshots/math.png)
![Plot mode — function chart with legend](docs/screenshots/plot.png)
-->

_Screenshots coming soon — see [`docs/screenshots/`](docs/screenshots/) for the shot list._

---

## Documentation

- **[User Manual](https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/manual.html)** — **start here if you're using it**: the core loop, all 22 tools with worked examples, honest limits, troubleshooting. Published from [`landing/manual.html`](landing/manual.html), so it deploys with every release and can't go stale.
- [Features](FEATURES.md) — the in-repo reference for what every mode does
- [Install (Windows & macOS)](install/README.md) — for end users
- [Manual test script](docs/TEST-SCRIPT.md) — in-Word QA checklist
- [Distribution & Deployment](DISTRIBUTION.md) — for IT
- [Architecture](ARCHITECTURE.md) · [Security & Confidentiality](SECURITY.md)
- [License (MIT)](LICENSE) · [Third-Party Licenses](THIRD_PARTY_LICENSES.md) · [Changelog](CHANGELOG.md)

## Prerequisites

1. **Node.js 18+ (LTS)** — installed and verified (built with Node 24, npm 11).
2. **Microsoft Word** — Microsoft 365 desktop (Windows or Mac) or Word on the web
   (modern WebView2/Edge runtime; legacy IE-based webviews are not supported).

> Verified by the QC gate (`npm run qc`): `npm run lint` (type-check),
> `npm test` (**1,846 unit tests**), `npm run build` (production bundle),
> `office-addin-manifest validate`, the task-pane id-wiring audit, and a
> **headless render check** (`npm run render-check`) that boots the real bundle in
> Chromium — the same engine as Word's WebView2 — and drives every tool. All pass.

## Setup

```powershell
cd C:\Users\AlexanderSmith\word-chem-formula
npm install
```

## Run it in Word

```powershell
npm start
```

This builds the project, installs a local HTTPS dev certificate (you may be
prompted to trust it the first time), starts the dev server on
`https://localhost:3000`, and sideloads the add-in into Word. Word opens with a
**Formulas** group on the **Home** tab containing an **Insert Formula** button —
click it to open the task pane.

To stop:

```powershell
npm stop
```

### Manual sideload (alternative)

If automatic sideloading doesn't work, run `npm run dev-server` and then
[sideload `manifest.xml` manually](https://learn.microsoft.com/office/dev/add-ins/testing/test-debug-office-add-ins#sideload-an-office-add-in-for-testing).

## How to use

1. Open the **Insert Formula** task pane from the Home tab.
2. Choose **Chemical** or **Math** mode.
3. Type a formula — a live preview shows the formatted result.
4. Click **Insert into document** (or press Enter).

### Input syntax

| Mode     | You type   | You get   | Notes                                  |
| -------- | ---------- | --------- | -------------------------------------- |
| Chemical | `H2O`      | H₂O       | digits after elements → subscript      |
| Chemical | `Ca(OH)2`  | Ca(OH)₂   | digits after `)` → subscript           |
| Chemical | `2H2O`     | 2 H₂O     | a leading number is a coefficient      |
| Chemical | `SO4^2-`   | SO₄²⁻     | `^` starts a charge (superscript)      |
| Chemical | `Na+`      | Na⁺       | trailing `+`/`-` → superscript charge  |
| Math     | `x^2`      | x²        | `^` superscript                        |
| Math     | `a_n`      | aₙ        | `_` subscript                          |
| Math     | `x^{n+1}`  | x^(n+1)   | braces group multiple characters       |
| Math     | `sqrt(x)`  | √(x)      | plus `pi`→π, `*`→·, `<=`→≤, `->`→→      |

## Project structure

```
word-chem-formula/
├─ manifest.xml              # Add-in manifest (ribbon button, task pane, perms)
├─ package.json              # Scripts and dependencies
├─ webpack.config.js         # Build + HTTPS dev server on :3000
├─ tsconfig.json
├─ assets/                   # Ribbon / task-pane icons
└─ src/
   ├─ taskpane/              # The UI pane (HTML/CSS) + Office.js insert logic
   ├─ commands/              # Ribbon command runtime
   └─ lib/
      ├─ segments.ts         # Shared Segment type (normal | sub | sup)
      ├─ chemParser.ts       # Chemical formula -> segments
      ├─ mathFormat.ts       # Math expression -> segments
      ├─ compounds.ts        # name/formula -> SMILES dictionaries
      ├─ structures.ts       # SMILES -> 2D structure SVG (OpenChemLib)
      ├─ mathOmml.ts         # math expression -> OMML Word equation
      └─ __tests__/          # Standalone parser sanity check
```

Quick logic check without building (after Node is installed):

```powershell
node src/lib/__tests__/parsers.sanity.mjs
```

## 2D chemical structures

In **Chemical** mode the pane shows a live 2D structure preview and an
**Insert 2D structure** button that inserts the structure as an inline image.
Rendering is fully offline via [OpenChemLib](https://github.com/cheminfo/openchemlib-js).

Because a 2D structure needs connectivity (not just an atom count), the input is
resolved in this order:

1. **Common name** — e.g. `aspirin`, `caffeine`, `water`, `ethanol`, `glucose`,
   `ibuprofen`, `violacein`, `morphine`, `paclitaxel`. **359 compounds** are built
   in (drugs, amino acids, acids, salts, solvents, aromatics, sugars, nucleobases,
   steroids, alkaloids, vitamins, and large natural products). For a systematic
   IUPAC name the dictionary doesn't know, the opt-in **online lookup** (OPSIN)
   resolves it.
2. **Known formula** — e.g. `H2O`, `C6H6`, `CO2`, `C9H8O4`.
3. **SMILES string** — any valid SMILES, e.g. `CC(=O)O`, `c1ccccc1`.

The dictionary lives in `src/lib/compounds.json`. Every SMILES is checked
against OpenChemLib by `npm run validate:compounds`, so no entry silently fails
to render. To add a compound, add a `"name": "SMILES"` line and re-run that.

If the input isn't a known name/formula and isn't valid SMILES, the preview
shows a hint instead of a structure. Ambiguous formulas (e.g. `C2H6O`, which
could be ethanol or dimethyl ether) map to the most common compound; add or
adjust entries in `compounds.ts` to taste, or type the SMILES directly.

## Build mode (molfile / atom-bond list)

**Build** mode renders a 2D structure from a structure you specify directly —
no drawing canvas — and shows its molecular formula and SMILES before you insert
it. Two input formats (auto-detected, or pick one):

- **Atom / bond list** — list heavy atoms, then bonds between them (1-indexed):
  ```
  atoms: C O O
  bonds: 1=2 1=3
  ```
  Bonds: `-` single, `=` double, `#` triple, `~` undefined/any (→ generic),
  `>` wedge, `<` hash (stereo). Atoms may carry a charge (`N+`, `O-`, `Fe2+`).
  Hydrogens are filled in automatically from valence. Bond and Markush buttons
  under the input insert these for you.
- **Molfile (MDL)** — paste any standard V2000/V3000 molfile (e.g. exported
  from another tool) to import and render it.

**Generic / Markush structures.** A bracketed atom list marks a variable
position, producing a generic structure. For example, a six-membered aromatic
ring with one `[C,N]` atom is the *genus* that encompasses benzene (C) and
pyridine (N):

```
atoms: [C,N] C C C C C
bonds: 1=2 2-3 3=4 4-5 5=6 6-1
```

The **Genus [C,N] ring** button under "Common structures" loads exactly this.
Generic structures show "generic structure" instead of a molecular formula and
insert into Word as an image like any other.

Variable-position tokens (the "Markush / query atoms" buttons): `[C,N]` atom
list · `X` halogen · `A` any atom · `Q` any heteroatom · `R1`/`R2`… R-group
attachment points. When R-groups are present, a definition box appears; filling
in `R1 = …` inserts a **"where R1 = …"** legend line beneath the structure.

**Stereochemistry.** In Chemical mode, an isomeric SMILES
(`C[C@@H](N)C(=O)O`, or E/Z via `/`…`\`) renders with wedge/hash bonds. In Build
mode, `>` and `<` add wedge and hash stereo bonds.

Implemented in `src/lib/builder.ts` (OpenChemLib). The structure is inserted as
an inline image, same as Chemical-mode structures.

## Native Word equations (math mode)

In **Math** mode, leave **"Insert as a native Word equation"** checked to insert
a real Word equation object (OMML) instead of inline-formatted text. The live
preview uses a structured HTML renderer (`src/lib/mathHtml.ts`) that mirrors the
inserted equation, so what you see is what you get.

### Search, recents & favorites

- **Search box** (top of the pane) finds any library formula or known compound
  by name — type `quadratic`, `std dev`, `benzene`, or `aspirin` and click a
  result to load it (it switches to the right mode automatically).
- **Recent** chips show your last inserts for one-click reuse; **★ Saved** chips
  are favorites. Click a chip to reload it; click its star to (un)favorite.
  Persisted in `localStorage` (`src/lib/history.ts`).

### Build templates

Build mode shows a **Common structures** row (benzene, cyclohexane, water,
ethanol, acetic acid, acetone, carboxyl, methylamine, …). Click one to load its
atom/bond list — use it as-is or edit it. Defined in `src/lib/palettes.ts`.

### Clickable palette

Below the input is a **palette** of buttons that insert at the cursor — no
syntax to memorize. It's mode-aware:

- **Math:** fraction, root, exponent/subscript, |x|, overbar; Σ ∫ ∏ lim;
  sin/cos/tan/log/ln; Greek letters; operators (± × ≤ ≥ ≠ →). Template buttons
  drop the cursor in the first slot to fill.
- **Chemical:** parentheses, charge (`^`, ⁺, ⁻, ²⁻, ³⁺), lone pair (`:`), and
  common groups/ions (OH, H₂O, NH₄, SO₄, NO₃, CO₃, PO₄, CH₃).
- **Build:** common-structure templates and **bond buttons** (single `-`,
  double `=`, triple `#`, undefined `~`) that insert into the build input.

Defined in `src/lib/palettes.ts`.

### Formula library

The **Formula library** picker (Math mode) offers ready-made formulas across
**Statistics, Geometry, Algebra, Trigonometry, and Calculus** (mean, variance,
quadratic formula, Pythagorean theorem, law of cosines, derivative/integral,
geometric series, …). Pick a category and a formula and it loads into the input,
previews, and inserts as a native Word equation. Defined in
`src/lib/formulaLibrary.ts`.

### Typed-math syntax

The engine (`src/lib/mathParse.ts` → `mathOmml.ts`) understands:

| You type            | Renders as                  |
| ------------------- | --------------------------- |
| `a/b`               | stacked fraction            |
| `x^2`, `a_n`, `a_n^2` | super/subscripts (combined) |
| `sqrt(x+1)`, `root(3, x)` | square / n-th root      |
| `sum(i=1, n, x_i)`  | summation Σ with limits     |
| `int(a, b, f(x))`   | integral ∫ with limits      |
| `prod(i=1, n, i)`   | product ∏                   |
| `lim(x -> 0, …)`    | limit                       |
| `abs(x)` or `\|x\|`  | absolute value              |
| `bar(x)`, `hat(x)`, `vec(x)` | accents              |
| `sin(x)`, `log(x)`, `ln(x)` | upright function names |
| `sech`, `arctanh`, `erf`, `Γ`, `ζ`, `sgn`, `C(n,k)` | trig/hyperbolic/special/discrete functions (see palette groups & library "Functions") |
| `matrix(a, b; c, d)` | matrix (rows `;`, cols `,`); `pmatrix`/`vmatrix` for `( )` / `\| \|` |
| `cases(x, if x>0; -x, otherwise)` | piecewise / cases |
| `floor(x)`, `ceil(x)`, `norm(v)` | ⌊x⌋, ⌈x⌉, ‖v‖ |
| `forall`, `exists`, `in`, `subseteq`, `union`, `emptyset` | ∀ ∃ ∈ ⊆ ∪ ∅ (logic & set theory) |
| `and`, `or`, `not`, `xor`, `implies`, `iff` | ∧ ∨ ¬ ⊕ ⇒ ⇔ |
| `ZZ`, `RR`, `NN`, `QQ`, `CC`, `FF`, `EE` | ℤ ℝ ℕ ℚ ℂ 𝔽 𝔼 (blackboard-bold sets) |
| `partial`, `nabla`, `a mod n`, `[S]`, `90 degree` | ∂, ∇, upright mod, brackets, ° |
| `oint`, `iint`, `iiint` | ∮ ∬ ∭ (contour / multiple integrals) |
| `bra(ψ)`, `ket(ψ)`, `braket(φ, ψ)` | ⟨ψ\|, \|ψ⟩, ⟨φ\|ψ⟩ (Dirac notation) |
| `angle`, `hbar`, `ohm`, `laplace`, `fourier` | ∠ ℏ Ω ℒ ℱ (EE / physics); `Re(z)`, `Im(z)` |
| `2x`, `2(x+1)`, `a b` | implicit multiplication   |
| `n!`, `+-`, `pi`, `theta` | factorial, ±, Greek     |

If an expression can't be parsed as an equation, the add-in falls back to inline
sub/superscript formatting. Uncheck the box to always use inline formatting.

## Roadmap

- [x] **Offline 2D chemical structures** (OpenChemLib) — name/formula/SMILES.
- [x] **Native Word equations for math** (OMML via `insertOoxml`).
- [x] **Build mode** — render a structure from a molfile or atom/bond list.
- [x] **Formula library + extended math engine** — Σ, ∫, ∏, roots, functions,
      |x|, limits, accents, factorials; categorized presets for stats/geometry/
      algebra/trig/calculus.
- [x] **Search** (formulas + compounds), **recents & favorites**, **clickable
      palette**, and **Build templates** for an intuitive, low-typing workflow.
- [x] **Markush/generic structures** — `[C,N]` atom lists, `~` any-bonds,
      `X` halogen shorthand.
- [x] **Equation numbering** (I, II, …) and **structure provenance**
      (formula/MW/SMILES/OCL-ID in alt-text).
- [x] **Test suite** (Jest, 1,841 tests) + **CI**; distribution/security docs.
- [x] **Stereochemistry** — isomeric SMILES (wedges) + Build wedge/hash bonds.
- [x] **Richer Markush atoms** — `A` any, `Q` heteroatom, `R1` R-group (+ `[C,N]`, `X`).
- [x] **R-group legends** — define `R1 = …` and insert a "where R1 = …" line.
- [x] **C1–C6 carbon-range shorthands** (`C1-6 alkyl` → C₁–C₆ alkyl) and
      **structured Markush tables** (R-group | definition, line-or-table toggle).
- [x] **"Optionally substituted" shorthand** (`opt sub` → optionally substituted)
      and **variable-count ranges** (`n=1-3` → n = 1–3).
- [x] **Sub-generic Markush definitions** — nested R-groups (`R1a`) auto-detected
      from definitions and added to the legend (line or table).
- [x] **Matrices and piecewise/cases** in the math engine (`matrix(…)`,
      `pmatrix`/`bmatrix`/`vmatrix`, `cases(…)`).
- [x] **Code / algorithm blocks** — pseudocode (bold keywords, numbered) and
      verbatim code listings, inserted as monospace blocks.
- [x] **Sequence listings (WIPO ST.26)** — generate a draft ST.26 XML from
      entered nucleotide/protein sequences (download or copy; validate in WIPO
      Sequence before filing).
- [x] **Markush query features** — `{ar}`, `{ring}`, `{r5}`/`{r6}`, `{sub}`,
      `{nosub}` (and bond `{ring}`/`{ar}`) for rigorous genus structures.
- [x] **Substituent gallery** — depict R-group alternatives (`R1a = SMILES`) as
      drawn 2D structures inserted beneath the genus.
- [x] **Botanical mode** (plant patents) — scientific-name typesetting (italics
      per ICN/ICNCP) and varietal characteristics tables.
- [x] **Reference-numeral management** (Numerals mode) — per-document
      numeral→element table (saved in the doc), one-click callout insertion,
      collision/gap/orphan/unused checks via a document scan, and an inserted
      "List of Reference Numerals" table.
- [x] **DNA analysis** (DNA mode) — reverse complement, transcription (mRNA),
      six-frame translation (degenerate-codon aware), GC/base composition, and a
      six-frame ORF finder with an insertable results table.
- [x] **Reaction schemes** (Reaction mode) — reactants → products with conditions
      over/under the arrow, composed from OpenChemLib structures.
- [x] **Document audit** (Audit mode) — one "check this application" pass:
      numerals, SEQ ID NO references, figures.
- [x] **SEQ ID NO references** — canonical in-text references (Sequence mode).
- [x] **Persisted preferences** — callout-parens and default DNA frame.
- [x] **LaTeX import/export** — paste LaTeX → native Word equation; copy current as LaTeX.
- [x] **Units & quantities** (Units mode) — SI typesetting, ± uncertainty, ×10ⁿ, and unit conversion.
- [x] **Captions & cross-references** (Refs mode) — auto-numbered figure/table
      captions, Fig./Table/Eq. references, and a caption gap/duplicate check.
- [x] **Quick plotting** (Plot mode) — offline pure-SVG function and data charts
      (axes, error bars) with a safe expression evaluator.
- [x] **Finance** (Finance mode + library) — TVM, loan, NPV/IRR, Black–Scholes,
      bond calculators, plus typeset finance equations in the Math library.
- [x] Formula history / favorites.
- [x] **Physicochemical properties & druglikeness** (Chemical mode) — cLogP, logS,
      tPSA, H-bond donors/acceptors, rotatable bonds, Lipinski Rule of Five & Veber.
- [x] **Bio/Assay mode** — offline curve fitting (Michaelis–Menten, Hill, 4PL
      dose–response for IC50/EC50, one-site binding) with parameters ± SE and R²,
      plus lab calculators (Cheng–Prusoff, Henderson–Hasselbalch, Beer–Lambert,
      dilutions, A260/A280 quantitation).
- [x] **Mass Spec mode** — monoisotopic & average mass, theoretical isotope
      pattern, and common adduct m/z.
- [x] **Spectra mode** — predicted ¹H/¹³C NMR (Grant–Paul + benzene-increment +
      Shoolery additivity, with symmetry-aware equivalence and n+1 multiplicity),
      IR group frequencies with a simulated transmittance trace, UV-Vis λmax by
      Woodward–Fieser (showing every increment), and EI-MS fragmentation
      (α-cleavage, benzylic/tropylium, McLafferty, gated neutral losses).
      Structure detection is exact; the shift/frequency values are published
      empirical estimates and every prediction carries its own accuracy caveat.
      Out-of-domain cases (unconjugated → no λmax, fused rings, polysubstituted
      carbons) are disclosed rather than guessed.
- [x] **Peptide mode** — 2D structure from a one-/three-letter amino-acid sequence.
- [x] **Stats mode** — descriptive statistics, t-tests, one- & two-way ANOVA, linear
      regression (with p-values), non-parametric tests (Mann–Whitney U, Wilcoxon
      signed-rank), chi-square (goodness-of-fit & independence), multiple-comparison
      correction (Bonferroni/Holm/Benjamini–Hochberg), and uncertainty propagation.
- [x] **IUPAC name→structure** — opt-in online resolution via the OPSIN web
      service (consented; everything else stays offline).
- [x] **Analyze mode** — a no-code numerical workbench: linear algebra (solve A·x=b,
      inverse, determinant/rank/trace, eigenvalues incl. complex, QR, SVD, matrix
      expressions), Nelder–Mead optimization, FFT/frequency spectrum, ODE/system
      solving, and raw data → correlations, trends & plain-language insights.
- [x] **Stiff ODE solving** — an implicit Rosenbrock solver (the ode23s method)
      alongside explicit RK45, with automatic stiffness detection that switches
      mid-integration. Closes the gap that mattered most for chemical kinetics:
      Van der Pol at μ=1000 and Robertson kinetics (rate constants spanning
      0.04→3×10⁷) both solve, where the explicit solver could not finish them.
- [x] **pKa estimation** (Chemical mode) — functional-group detection from structure
      with typical literature pKa per ionizable group and net charge at pH 7.4.
- [x] **GitHub Pages deployment** — automated build & publish of the hosted add-in
      and landing page on every push to `main`.
- [x] **In-pane update check** — the pane compares its baked-in version to a
      cache-busted `version.json` and shows a one-click "reload to update" banner,
      so per-user installs pick up new releases without admin/centralized deployment.
- [x] **Centralized-deployment path documented** — validated deploy manifest +
      IT admin guide (`packaging/CENTRALIZED-DEPLOY.md`) for Microsoft 365
      Integrated Apps. (AppSource intentionally not used — internal tool.)

## Notes

- The dev manifest (`manifest.xml`) points at `https://localhost:3000` for local
  development; the production manifest (`manifest.prod.xml`) points at the hosted
  GitHub Pages site, which is built and published automatically on every push to
  `main` (see `.github/workflows/pages.yml`).
- Math mode inserts a **native Word equation** (OMML) by default — fractions,
  radicals, Σ/∫, matrices, etc. Uncheck "native equation" to fall back to inline
  superscript/subscript formatting.
