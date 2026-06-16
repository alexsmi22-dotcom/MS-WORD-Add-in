# Formula Inserter — Quick Sheet

**A Word add-in for inserting chemical formulas, math equations, and 2D chemical
structures** — fast, consistent, and intuitive. Everything runs on your own
machine; nothing you type is ever sent anywhere.

Open it from **Insert → Add-ins → Developer Add-ins → Formula Inserter**. It has a
**Search** box at the top and three modes: **Chemical**, **Math**, **Build**.

---

## 🔎 Search (top box)
Type a name to find and insert any built-in formula or compound —
`quadratic`, `std dev`, `benzene`, `aspirin` — and it loads ready to insert.

## 🧪 Chemical mode — format formulas & draw structures
- Type a formula → it auto-formats subscripts/superscripts:
  `H2O → H₂O`, `Ca(OH)2 → Ca(OH)₂`, `SO4^2- → SO₄²⁻`, `Na+ → Na⁺`.
- The **2D structure** box draws a structure from a **name** (`aspirin`),
  **formula** (`C6H6`), or **SMILES** (`CC(=O)O`) — with formula, MW, and SMILES.
- **Insert 2D structure** drops the picture in; its alt-text stores the SMILES +
  ID code for provenance.
- **Palette** buttons insert charges, parentheses, lone pair, and common groups
  (OH, SO₄, NH₄, …). For **stereochemistry**, enter an isomeric SMILES.

## ➗ Math mode — real Word equations
- Type linear math → inserts a **native Word equation**:
  `a/b`, `x^2`, `a_n`, `sqrt(x)`, `sum(i=1, n, x_i)`, `int(a, b, f(x))`,
  `sin(x)^2 + cos(x)^2 = 1`.
- **Formula library**: ready-made formulas in **Statistics, Geometry, Algebra,
  Trigonometry, Calculus** — pick a category and a formula.
- **Palette** for fractions, roots, Σ, ∫, Greek, operators — no syntax to memorize.
- **Number this equation** adds right-aligned **(I), (II), …** automatically.

## 🔨 Build mode — make a structure from scratch
- **Common structures** buttons (benzene, cyclohexane, ethanol, …) load instantly.
- Or describe atoms + bonds:
  ```
  atoms: C C O
  bonds: 1-2 2-3        → ethanol
  ```
  Bonds: `-` single · `=` double · `#` triple · `>`/`<` wedge/hash (stereo).
- **Markush / generic (patent) structures:** `[C,N]` variable atom · `X` halogen ·
  `A` any atom · `Q` heteroatom · `R1`/`R2` R-groups · `~` any-bond. Define
  `R1 = …` and it inserts a **"where R1 = …"** legend under the structure.
- Or paste an **MDL molfile** to import a structure.

---

## Why it's better than Word's built-in tool
- **Chemistry Word can't do:** real 2D structures, Markush/generic structures,
  stereochemistry, molecule building.
- **Less typing:** clickable palettes, searchable library, recents & favorites.
- **Patent-ready:** equation numbering, structure provenance (formula/MW/SMILES/ID
  in alt-text), R-group legends.

## Privacy
Runs 100% locally in Word. No telemetry, no external calls — **document content
never leaves your machine.** (The tool's own code loads once over HTTPS, then
works offline.)

> **Drafting aid — verify all structures and formulas before filing.**

## Install (Windows desktop Word, no admin)
Download the install zip → extract → **double-click `install.bat`** → restart
Word → **Insert → Add-ins → Developer Add-ins → Formula Inserter**.
