# Formula Inserter — Word Add-in

A Microsoft Word add-in (Office.js / TypeScript) that turns typed chemical and
math formulas into properly formatted text — correct subscripts, superscripts,
and charges — and inserts them at the cursor.

```
H2O      ->  H₂O
Ca(OH)2  ->  Ca(OH)₂
SO4^2-   ->  SO₄²⁻
Na+      ->  Na⁺
x^2 + y^2 ->  x² + y²        (math mode)
aspirin  ->  (inserts the 2D structure as an image)
```

> **Status:** working scaffold, chemical/math formatting, and offline 2D
> structure rendering. See the [Roadmap](#roadmap) for what's next.

---

## Documentation

- [User Guide](docs/USER_GUIDE.md) — for drafters
- [Distribution & Deployment](DISTRIBUTION.md) — for IT
- [Security & Confidentiality](SECURITY.md) — data-flow, CSP, localStorage
- [Third-Party Licenses](THIRD_PARTY_LICENSES.md) · [Changelog](CHANGELOG.md)

## Prerequisites

1. **Node.js 18+ (LTS)** — installed and verified (built with Node 24, npm 11).
2. **Microsoft Word** — Microsoft 365 desktop (Windows or Mac) or Word on the web
   (modern WebView2/Edge runtime; legacy IE-based webviews are not supported).

> Verified: `npm run lint` (type-check), `npm test` (440 unit tests),
> `npm run build` (production bundle), `npm run validate:compounds`, and
> `office-addin-manifest validate` all pass.

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
   `ibuprofen`. ~250 common compounds are built in (drugs, amino acids, acids,
   salts, solvents, aromatics, sugars, nucleobases, …).
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
attachment points.

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
- [x] **Test suite** (Jest, 445 tests) + **CI**; distribution/security docs.
- [x] **Stereochemistry** — isomeric SMILES (wedges) + Build wedge/hash bonds.
- [x] **Richer Markush atoms** — `A` any, `Q` heteroatom, `R1` R-group (+ `[C,N]`, `X`).
- [ ] R-group legend/definition tables and "optionally substituted" shorthands.
- [ ] Matrices and piecewise/cases in the math engine.
- [ ] Sequence listings (WIPO ST.26) — separate workstream.
- [ ] Formula history / favorites.
- [ ] Distribution beyond local sideload (org catalog or AppSource).

## Notes

- The dev manifest points at `https://localhost:3000`. For real distribution,
  host the built `dist/` somewhere and update the URLs in `manifest.xml`.
- Math mode currently produces inline formatting (superscript/subscript), not a
  native Word equation object — see the roadmap.
