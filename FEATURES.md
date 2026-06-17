# Formula Inserter — What it can do

A Microsoft Word add-in for patent drafting. It runs **entirely on your machine** —
nothing you type is sent anywhere — and inserts cleanly formatted chemistry, math,
structures, code, sequences, and botanical names directly at the cursor.

Pick a **mode** at the top of the pane: **Chemical · Math · Build · Code · Sequence · Botanical.**
Everything shows a live preview that matches exactly what gets inserted.

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
- **Formula library** grouped into *Mathematics* (statistics, geometry, algebra, trig, calculus), *Functions*, and *Science & engineering* (**Cryptography, Computer science/ML, Mechanical engineering, Electrical engineering, Physics, Biology/assays**).
- Symbol palette is collapsible; its open/closed state is remembered.

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

---

*Questions or requests? Contact the maintainer. Each release is tagged in source control.*
