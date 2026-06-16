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
```

> **Status:** working scaffold + formatting. Offline 2D chemical structure
> rendering is the next milestone (see [Roadmap](#roadmap)).

---

## Prerequisites

1. **Node.js 18+ (LTS)** — not currently installed on this machine.
   Install from <https://nodejs.org> or via winget:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Close and reopen your terminal afterward so `node` / `npm` are on PATH.
2. **Microsoft Word** — desktop (Windows or Mac) or Word on the web.

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
      └─ __tests__/          # Standalone parser sanity check
```

Quick logic check without building (after Node is installed):

```powershell
node src/lib/__tests__/parsers.sanity.mjs
```

## Roadmap

- [ ] **Offline 2D chemical structures.** Bundle a JS chem engine
      (OpenChemLib / SmilesDrawer) and insert a generated SVG/PNG of the
      structure alongside the formula. Structures are derived from **SMILES**,
      so this will ship with a small built-in name/formula → SMILES dictionary
      for common compounds, plus direct SMILES input.
- [ ] **Native Word equations for math.** Insert real OMML equation objects via
      `insertOoxml` so stacked fractions, radicals, and matrices render as
      true Word equations rather than inline superscripts/subscripts.
- [ ] Formula history / favorites.
- [ ] Distribution beyond local sideload (org catalog or AppSource).

## Notes

- The dev manifest points at `https://localhost:3000`. For real distribution,
  host the built `dist/` somewhere and update the URLs in `manifest.xml`.
- Math mode currently produces inline formatting (superscript/subscript), not a
  native Word equation object — see the roadmap.
