# Formula Inserter — Capabilities Overview

**Formula Inserter** is a Microsoft Word add-in that turns what you type into
correctly formatted, ready-to-insert content across science, math, and technical
writing. One task pane, **14 modes**, **one shared engine** — and it runs
**entirely on your machine**: nothing you type ever leaves your computer.

- **Platforms:** Word on **Windows** and **macOS** (Microsoft 365 / 2019+), and Word on the web.
- **Privacy by construction:** all parsing, chemistry, and rendering happen locally; only the UI code loads once over HTTPS, after which it works offline.
- **Quality:** ~**793 automated tests**; v1.0.0 production release.

---

## At a glance

| Mode | What it produces |
|---|---|
| 🧪 **Chemical** | Formatted formulas, 2D structures, compound-name lookup |
| ∑ **Math** | Native Word equations, LaTeX import/export, aligned equations |
| 📏 **Units** | SI quantity typesetting + unit conversion |
| 📈 **Plot** | Function & data charts |
| 💵 **Finance** | Financial calculators + equation library |
| 🔬 **Build** | Structures from atom/bond lists or molfiles; Markush genus |
| 💻 **Code** | Algorithm & code listings |
| 🧬 **Sequence** | WIPO ST.26 biological sequence listings |
| 🌿 **Botanical** | Plant-nomenclature typesetting |
| 🔢 **Numerals** | Reference-numeral management |
| 🔖 **Refs** | Figure/table captions & cross-references |
| 🧬 **DNA** | DNA/RNA analysis toolkit |
| ⚗️ **Reaction** | Reaction schemes |
| ✅ **Audit** | Whole-document consistency check |

Every mode shows a **live preview that matches exactly what gets inserted**, and a
**mode-aware "Examples & syntax"** panel guides you as you go.

---

## What each mode does

### 🧪 Chemical
- Format formulas with correct subscripts/superscripts/charges: `H2O` → H₂O, `Ca(OH)2` → Ca(OH)₂, `SO4^2-` → SO₄²⁻, `Na+` → Na⁺.
- Insert **2D chemical structures**, offline, from a **common name** (`aspirin`), a **formula** (`C6H6`), or any **SMILES** (`CC(=O)O`).
- **Stereochemistry** — isomeric SMILES (`C[C@@H](N)C(=O)O`) drawn with wedges.
- **Structure → name** lookup for recognized compounds, with one-click insert.
- Each structure carries machine-readable provenance (formula / MW / canonical SMILES / OCL ID) in its alt-text.

### ∑ Math (native Word equations)
- Real Word equation objects: fractions, super/subscripts, roots (`sqrt`, n-th `root`), Σ/∫/∏/∮/∬/∭, limits, `|x|`, floor/ceil/norm, accents (`bar`/`hat`/`vec`), factorials, implicit multiplication, full Greek.
- **Matrices** (`pmatrix`/`bmatrix`/`vmatrix`), **piecewise** `cases`, and **multi-line aligned equations** (`align(a = b; c = d)`).
- Logic & set theory, number sets (ℤ ℝ ℕ ℚ ℂ), Dirac bra-ket, and engineering/physics symbols.
- **Import / export LaTeX** — paste `\frac{-b\pm\sqrt{b^2-4ac}}{2a}` to get a native equation, or copy the current formula out as LaTeX.
- **Equation numbering** — optional right-aligned (I), (II), … with a counter and reset.
- A categorized **formula library** (statistics, calculus, physics, ML, EE, biology, **finance**, …) plus a searchable function set.

### 📏 Units — quantities & conversion
- Typeset quantities the SI way: `9.81 m/s^2` → 9.81 m/s², `5.0 +- 0.2 kg` → 5.0 ± 0.2 kg, `1.2e-3 mol/L` → 1.2 × 10⁻³ mol/L.
- Symbol fixes: `ohm` → Ω, `degC` → °C, `umol` → µmol.
- **Convert** across length, mass, time, temperature (affine), volume, pressure, energy, amount, and angle — including **compound units** (`km/h → m/s`, `g/mol → kg/mol`) — with significant-figure rounding.

### 📈 Plot — function & data charts
- Plot one or **several functions** (`sin(x)/x ; cos(x)`) over an x-range, with a labeled **legend**.
- Plot **data points** (`x y` per line, optional error bars) as a scatter — combine with a function on the same axes.
- Axes, ticks, gridlines, optional title and axis labels; rendered offline as an image via a safe expression evaluator (no `eval`).

### 💵 Finance — calculators & formulas
- **Calculators** (compute & insert the result): future/present value, compound interest, **loan payment**, **NPV**, **IRR**, **Black–Scholes** option price, **bond pricing**.
- A **finance equation library**: time-value-of-money, valuation & options (NPV, Gordon growth, WACC, Black–Scholes, put–call parity), portfolio & bonds (CAPM, Sharpe, variance, beta, duration).

### 🔬 Build — structures & Markush genus
- Build a 2D structure from a typed **atom/bond list** or a pasted **MDL molfile**.
- Bonds (single/double/triple/undefined, stereo wedge/hash), atom charges, automatic hydrogens.
- **Markush / generic** atoms (`[C,N]`, `X`, `A`, `Q`, `R1`…) and **query features** (`{ar}`, `{ring}`, `{r5}`/`{r6}`, `{sub}`/`{nosub}`) for rigorous genus structures.
- **R-group legends** (inline line or structured table), **nested sub-generic** R-groups, and a **substituent gallery** that draws each alternative.

### 💻 Code
- **Algorithm/pseudocode** blocks with bold control-flow keywords, line numbers, and an optional caption.
- **Code listings** — verbatim, whitespace-preserving monospace.

### 🧬 Sequence — WIPO ST.26
- Generate a **draft ST.26 sequence-listing XML** from DNA/RNA/protein sequences, with per-sequence molecule type and organism, automatic residue cleaning, and applicant/application metadata.
- Download `.xml` or copy; insert a canonical **SEQ ID NO** in-text reference.

### 🌿 Botanical — plant patents
- **Scientific-name typesetting** per ICN/ICNCP (genus, species, and infraspecific epithets italic; rank connectors, authors, hybrid `×`, and cultivars roman).
- **Varietal characteristics** table from `Label: value` lines.

### 🔢 Numerals — reference-numeral management
- Maintain a **numeral → element table** saved inside the document.
- One-click **callout insertion** (`housing (12)`), auto-suggested numbering.
- **Scan the document** for collisions, gaps, orphans, and unused numerals; insert a sorted **List of Reference Numerals**.

### 🔖 Refs — captions & cross-references
- **Auto-numbered captions** ("Figure 1.", "Table 2.") with per-document counters.
- **Cross-references** ("Fig. 3", "Table 2", "Eq. (1)").
- **Check captions** for skipped or duplicated numbers.

### 🧬 DNA — sequence analysis
- **Reverse complement** / complement (IUPAC-aware), **transcription** (mRNA), and **translation** in any of the six reading frames (degenerate codons resolved).
- **GC content** & base composition; a **six-frame ORF finder** with a results table.
- **Bench tools:** primer **Tm**, **protein** MW/pI/GRAVY (of the translation), and a **restriction-site** scan.

### ⚗️ Reaction — reaction schemes
- Compose **reactants + reactants → products**, with conditions over/under the arrow, and **multi-step** schemes (`A → B → C`).
- Each component is a name or SMILES (formal charges like `[N+]` preserved); inserts as one image with provenance.

### ✅ Audit — check this application
- One pass over the whole document flags: **reference-numeral** issues, **SEQ ID NO** references vs. the listing, **figure-number** continuity, and **cross-reference validity** (every "Fig. N"/"Table N" has a caption).

---

## Capabilities that span every mode
- **WYSIWYG** — the live preview is the exact content inserted.
- **Native Word output** — equations are real equation objects; structures, plots, and schemes are images with machine-readable alt-text.
- **Search, recents & favorites** — find formulas/compounds by name; reuse recent inserts.
- **Document-aware** — Numerals, Refs, and Audit *read* the document to reconcile and check it.
- **Saved with the document** — the numeral table and caption counters live in the `.docx`; per-user preferences persist between sessions.
- **Re-findable inserts** — key items are wrapped in tagged content controls.
- **Clean undo** — each insert is a single Ctrl-Z.
- **Offline & private** — after first load, no network; document content never leaves the machine.

## Honest limits (by design)
- **Word only** — not PowerPoint/Outlook (the document-aware features rely on Word's API).
- **Structure → name** recognizes *known* compounds (dictionary-based); it is not a general algorithmic IUPAC namer.
- The consistency checks (Audit, Numerals, Refs, Sequence drafts) are **advisory aids** — verify before filing or publishing.

---

*Install: see [`install/`](../install/). Full feature list: [`FEATURES.md`](../FEATURES.md).
Built with TypeScript + Office.js + OpenChemLib, 100% client-side.*
