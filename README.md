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

## Prerequisites

1. **Node.js 18+ (LTS)** — installed and verified (built with Node 24, npm 11).
2. **Microsoft Word** — desktop (Windows or Mac) or Word on the web.

> Verified: `npm run lint` (type-check), `npm run build` (production bundle),
> and `office-addin-manifest validate` all pass.

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
  Bonds: `-` single, `=` double, `#` triple. Atoms may carry a charge
  (`N+`, `O-`, `Fe2+`). Hydrogens are filled in automatically from valence.
- **Molfile (MDL)** — paste any standard V2000/V3000 molfile (e.g. exported
  from another tool) to import and render it.

Implemented in `src/lib/builder.ts` (OpenChemLib). The structure is inserted as
an inline image, same as Chemical-mode structures.

## Native Word equations (math mode)

In **Math** mode, leave **"Insert as a native Word equation"** checked to insert
a real Word equation object (OMML) instead of inline-formatted text. This gives
true stacked fractions, radicals, and combined sub/superscripts:

| You type    | As equation        |
| ----------- | ------------------ |
| `a/b`       | stacked fraction   |
| `sqrt(x+1)` | radical over x+1   |
| `x^{n+1}`   | x raised to n+1    |
| `a_n^2`     | combined sub + sup |
| `(a+b)/2`   | (a+b) over 2       |

The converter (`src/lib/mathOmml.ts`) parses the linear expression and emits
OMML wrapped in a flat-OPC package for `Range.insertOoxml`. If an expression
can't be parsed as an equation, the add-in automatically falls back to inline
sub/superscript formatting. Uncheck the box to always use inline formatting.

## Roadmap

- [x] **Offline 2D chemical structures** (OpenChemLib) — name/formula/SMILES.
- [x] **Native Word equations for math** (OMML via `insertOoxml`).
- [x] **Build mode** — render a structure from a molfile or atom/bond list.
- [ ] More equation constructs: summation, integral, matrices, n-th roots.
- [ ] Formula history / favorites.
- [ ] Distribution beyond local sideload (org catalog or AppSource).

## Notes

- The dev manifest points at `https://localhost:3000`. For real distribution,
  host the built `dist/` somewhere and update the URLs in `manifest.xml`.
- Math mode currently produces inline formatting (superscript/subscript), not a
  native Word equation object — see the roadmap.
