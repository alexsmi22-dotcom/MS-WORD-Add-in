# Formula Inserter — Architecture Paper

**Project:** `word-chem-formula` (product name: *Formula Inserter*)
**Type:** Microsoft Word task-pane add-in (Office.js)
**Version:** 0.1.0
**Date of this document:** 2026-06-19
**Add-in Id:** `5674364b-9410-41a5-a938-12c1155aeb7e`
**Hosted at:** `https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Context & Design Goals](#2-system-context--design-goals)
3. [Technology Stack](#3-technology-stack)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Build System](#5-build-system)
6. [Office Integration Layer (Manifest & Entry Points)](#6-office-integration-layer-manifest--entry-points)
7. [The Engine: `src/lib` Module Reference](#7-the-engine-srclib-module-reference)
   - 7.1 [Shared Primitives](#71-shared-primitives)
   - 7.2 [Chemistry Pipeline](#72-chemistry-pipeline)
   - 7.3 [Math Pipeline](#73-math-pipeline)
   - 7.4 [Patent-Drafting Feature Modules](#74-patent-drafting-feature-modules)
   - 7.5 [State, Data & Palettes](#75-state-data--palettes)
8. [The UI Layer: Task Pane](#8-the-ui-layer-task-pane)
9. [Document Insertion Mechanisms](#9-document-insertion-mechanisms)
10. [Data Flow Walkthroughs](#10-data-flow-walkthroughs)
11. [Testing Architecture](#11-testing-architecture)
12. [Packaging & Deployment](#12-packaging--deployment)
13. [Cross-Cutting Concerns & Design Principles](#13-cross-cutting-concerns--design-principles)
14. [What Was Built — Complete Capability Inventory](#14-what-was-built--complete-capability-inventory)
15. [Novelty & Prior-Art Landscape](#15-novelty--prior-art-landscape)
16. [Patentability Assessment](#16-patentability-assessment)
17. [Module Dependency Map](#17-module-dependency-map)
18. [Appendix: File Inventory](#18-appendix-file-inventory)

---

## 1. Executive Summary

Formula Inserter is a **client-side Word add-in** that helps authors — chemists and patent drafters in particular — insert correctly typeset content into Word documents: chemical formulas (with subscripts/superscripts), native Word math equations (OMML), rasterized 2D chemical structures, Markush/R-group legends, WIPO ST.26 biological sequence listings, botanical (plant) nomenclature, and formatted code/algorithm blocks.

The application is **100% browser/JavaScript** — there is no server backend and no document content ever leaves the user's machine. The chemistry intelligence is provided by the bundled **OpenChemLib** library; everything else is hand-written TypeScript. The codebase is organized around a strict separation between a **pure, unit-testable engine** (`src/lib/*`, no Office.js) and a **thin UI/Office glue layer** (`src/taskpane/taskpane.ts`).

Distribution is the standard Office model: webpack builds static files to `dist/`, GitHub Pages hosts them over HTTPS, and a tiny `manifest.xml` is registered per-user on each Windows desktop Word installation (no admin rights required) via the `HKCU\...\WEF\Developer` registry key.

---

## 2. System Context & Design Goals

### Audience and use case
The add-in targets **desktop Word on Windows** (the team does not use Word for the web). Its features skew heavily toward **patent drafting** in chemistry and life sciences: Markush claim language, R-group legends, query/generic structures, ST.26 sequence listings, and botanical naming all map directly to patent-specification needs.

### Explicit design goals (evidenced throughout the code)
- **Privacy by construction.** All parsing, rendering, and chemistry computation run locally in the Office webview. The task pane states: *"Runs entirely on your machine; no document content is sent anywhere."* The only network dependency is loading the static UI code over HTTPS on first open.
- **No-admin installation.** Recipients install with a per-user registry write, not an MSI/EXE.
- **Drafting aid, not validator.** Parsers are deliberately pragmatic (the chem parser does not verify element symbols; ST.26 and SMILES outputs are meant to be validated downstream in authoritative tools). This is a stated philosophy, not an omission.
- **WYSIWYG insertion.** A core invariant: *the HTML shown in the live preview is the exact HTML/structure inserted into the document.* One renderer feeds both preview and insertion so they cannot diverge.
- **Testability.** The engine is split into small pure modules with no Office.js or (mostly) no `Date`/`localStorage` dependencies, enabling a fast Node-based Jest suite.

---

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript 5.4 (`strict`) | Compiled to ES2017 for Office webview compatibility |
| Host API | Office.js (`@types/office-js`), **WordApi 1.3** | Task pane + ribbon button |
| Chemistry | **OpenChemLib 8** (BSD-3) | SMILES/molfile parsing, 2D coordinate layout, SVG rendering |
| Polyfills | core-js 3 | For the ES2017 target on older webviews |
| Bundler | webpack 5 (+ ts-loader, html-loader, copy-webpack-plugin, html-webpack-plugin) | Two entry points → `dist/` |
| Dev server | webpack-dev-server + office-addin-dev-certs | HTTPS on `localhost:3000` |
| Office tooling | office-addin-debugging, office-addin-manifest | Sideload + manifest validation |
| Testing | Jest 29 + ts-jest | Node environment, `src/lib` only |
| Type-check / "lint" | `tsc --noEmit` | No ESLint is configured |
| CI/CD | GitHub Actions | `ci.yml` (gate) + `pages.yml` (deploy) |
| Hosting | GitHub Pages | Free static HTTPS hosting |

**Notably absent:** no Babel, no ESLint, no CSS framework, no runtime HTTP client, no state-management library. The dependency surface is intentionally minimal — only `core-js` and `openchemlib` are runtime dependencies.

---

## 4. High-Level Architecture

The system has four tiers:

[[DIAGRAM:fig1-system-architecture]]

*Figure 1. System architecture — the ribbon button opens the task pane inside the Office WebView2 runtime; the task pane orchestrates the pure engine and writes to the document via Office.js. Only static UI code is fetched from GitHub Pages; document content never leaves the machine.*

```
┌──────────────────────────────────────────────────────────────────────┐
│  Microsoft Word (desktop, Windows)                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Office Add-in Runtime (Edge WebView2)                          │  │
│  │                                                                  │  │
│  │   Ribbon button "Insert Formula" ──► ShowTaskpane               │  │
│  │                                                                  │  │
│  │   ┌──────────────────────────────────────────────────────────┐ │  │
│  │   │  TASK PANE  (taskpane.html / taskpane.ts / taskpane.css)   │ │  │
│  │   │  ── UI controller, 6 modes, live preview, Office.js glue  │ │  │
│  │   │            │ imports & orchestrates                        │ │  │
│  │   │            ▼                                                │ │  │
│  │   │  ┌──────────────────────────────────────────────────────┐ │ │  │
│  │   │  │  ENGINE  (src/lib/*)  — pure, no Office.js             │ │ │  │
│  │   │  │  chem parser • math parser→OMML/HTML • OpenChemLib     │ │ │  │
│  │   │  │  structures • markush • botanical • sequence • code    │ │ │  │
│  │   │  │  history • palettes • formula library • numbering      │ │ │  │
│  │   │  └──────────────────────────────────────────────────────┘ │ │  │
│  │   └──────────────────────────────────────────────────────────┘ │  │
│  │            │ Word.run() — insertHtml / insertOoxml / insertImage │  │
│  │            ▼                                                      │  │
│  │      The user's Word document                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘

   Static UI code (taskpane.html/.js, commands.html/.js, assets) is served
   over HTTPS from GitHub Pages. Document content never leaves the machine.
```

**Two web surfaces** are defined by the manifest:
- **Task pane** (`taskpane.html`) — the entire application UI and logic.
- **Commands** (`commands.html` / `commands.ts`) — a required-but-currently-empty function-command runtime. The ribbon button uses a `ShowTaskpane` action, so no command code is needed yet; the file exists only so the manifest's `FunctionFile` reference resolves.

---

## 5. Build System

### 5.1 Entry points and output

`webpack.config.js` exports an async `(env, options) => config` function with two entries:

```js
entry: {
  taskpane: ["./src/taskpane/taskpane.ts"],
  commands: ["./src/commands/commands.ts"],
},
output: { clean: true, path: path.resolve(__dirname, "dist"), filename: "[name].js" },
devtool: "source-map",
```

`clean: true` wipes `dist/` on each build. Output is `taskpane.js` and `commands.js`, each with a full `.map`.

### 5.2 Loaders & plugins

| Rule / Plugin | Role |
|---|---|
| `*.ts` → `ts-loader` (excl. node_modules) | TypeScript → JS, bundling `src/lib` + OpenChemLib + core-js |
| `*.html` → `html-loader` | Templates; also resolves `<link href="taskpane.css">` so the CSS is emitted as a content-hashed asset |
| `*.{png,jpg,jpeg,gif,ico}` → `asset/resource` | Emitted to `assets/[name][ext]` |
| `HtmlWebpackPlugin` ×2 | Generates `taskpane.html` (chunk `taskpane`) and `commands.html` (chunk `commands`), injecting the bundle scripts |
| `CopyWebpackPlugin` | Copies `assets/*` → `dist/assets/` and **both** `manifest.xml` + `manifest.prod.xml` → `dist/` |

**CSS handling is implicit:** there is no css-loader/style-loader and no CSS `import` in TypeScript. The single stylesheet is referenced only from `taskpane.html` via `<link>`, which `html-loader` treats as a dependency and emits as a hashed `*.css` (e.g. `ab49414a02a64144460c.css`). `commands.html` has no stylesheet.

### 5.3 Dev vs. production

- **Mode** is the only structural difference: `build` = `webpack --mode production` (minified), `build:dev` / `dev-server` = development (unminified).
- The **dev server** serves `https://localhost:3000` using trusted certs from `office-addin-dev-certs` (`getHttpsOptions()`), with wide-open CORS (`Access-Control-Allow-Origin: *`) for the host webview. HTTPS is mandatory for Office add-ins.
- **Crucially, webpack never rewrites URLs.** The dev-vs-prod host difference lives entirely in the **two manifest files**: `manifest.xml` hard-codes `https://localhost:3000`; `manifest.prod.xml` uses the placeholder `https://ADDIN-HOST.example.com`, stamped at packaging time.
- `performance.hints: false` suppresses the bundle-size warning — OpenChemLib is large but served locally.

### 5.4 TypeScript configuration (`tsconfig.json`)

```json
"target": "ES2017", "module": "ESNext", "moduleResolution": "node",
"lib": ["ES2017", "DOM", "DOM.Iterable"], "types": ["office-js"],
"strict": true, "esModuleInterop": true, "resolveJsonModule": true,
"sourceMap": true, "outDir": "./dist"
```

`include: ["src/**/*"]`, `exclude: ["node_modules", "dist", "**/*.test.ts"]`. Key consequences:
- `target ES2017` (plus core-js) for webview compatibility.
- `module: ESNext` lets webpack do tree-shaking.
- `types: ["office-js"]` restricts ambient types to Office.js — which is *why* the Jest config has to re-add `["jest"]` in its own inline tsconfig.
- `resolveJsonModule` enables importing `compounds.json` directly.

### 5.5 npm scripts

| Script | Command | Purpose |
|---|---|---|
| `build` | `webpack --mode production` | Production bundle → `dist/` |
| `build:dev` | `webpack --mode development` | Unminified build |
| `dev-server` | `webpack serve --mode development` | HTTPS dev server :3000 |
| `start` | `office-addin-debugging start manifest.xml` | Sideload into Word + debug |
| `stop` | `office-addin-debugging stop manifest.xml` | Tear down sideload/debug flag |
| `validate` | `office-addin-manifest validate manifest.xml` | Schema-validate manifest |
| `validate:compounds` | `node src/lib/__tests__/validate-compounds.mjs` | Verify every dictionary SMILES renders |
| `review-sheet` | `node scripts/review-sheet.js` | Chemist review HTML of all compounds |
| `lint` | `tsc --noEmit` | Type-check (there is no ESLint) |
| `test` | `jest` | Unit tests of `src/lib` |

---

## 6. Office Integration Layer (Manifest & Entry Points)

### 6.1 Manifest (`manifest.xml` / `manifest.prod.xml`)

A TaskPaneApp manifest (schema 1.1 + TaskPane VersionOverrides). Key values:

- **Id:** `5674364b-9410-41a5-a938-12c1155aeb7e` (identical across dev/prod — same logical add-in).
- **Version:** `1.0.0.0`; **ProviderName:** `AlexanderSmith`; **DefaultLocale:** `en-US`; **DisplayName:** "Formula Inserter".
- **Host:** `<Host Name="Document" />` → Word.
- **Requirement set:** `WordApi` `DefaultMinVersion="1.3"`.
- **Permissions:** `ReadWriteDocument`.
- **Source locations:** task pane `…/taskpane.html`; commands/`FunctionFile` `…/commands.html`; icons `…/assets/icon-{16,32,80}.png` (`icon-64.png` exists but is unused).

**Ribbon (VersionOverrides V1_0):** a single group `FormulaGroup` ("Formulas") on `TabHome`, containing one button `OpenTaskpaneButton` ("Insert Formula") whose `Action xsi:type="ShowTaskpane"` opens the task pane. There are **no execute-function commands** yet.

The dev manifest points all URLs at `https://localhost:3000`; the prod template uses `https://ADDIN-HOST.example.com`; the shipped release manifest is stamped to `https://alexsmi22-dotcom.github.io/MS-WORD-Add-in`.

### 6.2 Entry points

Both HTML pages load Office.js from the Microsoft CDN before the bundle:

```html
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
```

- **`commands.ts`** — a deliberate no-op:
  ```js
  Office.onReady(() => { /* ribbon button shows the task pane directly */ });
  ```
- **`taskpane.ts`** — the real application. Bootstraps with a host guard, resolves all DOM nodes, wires events, populates UI, then renders the first preview:
  ```js
  Office.onReady((info) => {
    if (info.host !== Office.HostType.Word) return;
    inputEl = document.getElementById("formula-input") as HTMLInputElement;
    /* … resolve ~60 elements, bind handlers, populate library/palette/history … */
  });
  ```

---

## 7. The Engine: `src/lib` Module Reference

The engine is a set of **pure modules** (no Office.js). The task pane imports them and applies their string/SVG outputs to the document. There are two rendering philosophies that recur: a **`Segment[]` model** for inline sub/superscript text, and an **AST model** for math.

### 7.1 Shared Primitives

#### `segments.ts` — the formatted-run data model
The universal model for "formatted text": an ordered `Segment[]`, each a text chunk plus a render type.

```ts
type SegmentType = "normal" | "sub" | "sup";
interface Segment { text: string; type: SegmentType }
pushSegment(segments, text, type)   // appends, MERGING with previous if same type
escapeHtml(s)
segmentsToHtml(segments)            // → HTML using <sub>/<sup>
```

The merge in `pushSegment` minimizes the number of Word runs. `segmentsToHtml` is the **single source of truth** shared by preview and insertion. (`escapeHtml` is, for historical reasons, re-defined locally in markush/botanical/sequence rather than imported.)

### 7.2 Chemistry Pipeline

There are two distinct chemistry pipelines: **text formatting** and **2D structure rendering**.

[[DIAGRAM:fig4-chem-pipeline]]

*Figure 2. Offline structure pipeline. An input is resolved name → formula → raw SMILES against curated dictionaries, rendered to SVG by OpenChemLib, rasterized to PNG, and inserted with machine-readable provenance in the image alt-text — all without any network call.*

#### `chemParser.ts` — formula text → `Segment[]`
`parseChemical(input): Segment[]`. A single left-to-right scan with four rules:
1. `^` → superscript charge (consumes digits then optional `+`/`-`): `SO4^2-` → SO₄²⁻.
2. Digit run → **subscript** count *unless* it is a leading stoichiometric coefficient, detected by the heuristic "at start or right after a space":
   ```ts
   const isCoefficient = !prev || prev.text.endsWith(" ");
   pushSegment(segments, num, isCoefficient ? "normal" : "sub");
   ```
3. Trailing `+`/`-` → superscript charge (`Na+`, `Cl-`).
4. Everything else (letters, parens, brackets, hydrate dots) → normal.

Pragmatic by design — it does **not** validate that element symbols are real.

#### `compounds.ts` + `compounds.json` — name/formula → SMILES dictionary
Curated offline lookup so a 2D structure can be derived without a network call. A bare formula (e.g. `C2H6O`) is structurally ambiguous, so the dictionary maps known inputs to canonical SMILES.
- `NAME_TO_SMILES` — **259** lowercased common names (case-insensitive match).
- `FORMULA_TO_SMILES` — **101** formulas (case-sensitive, whitespace stripped by caller).
- Integrity is enforced out-of-band by `validate-compounds.mjs` (every SMILES must render under OpenChemLib).

#### `structures.ts` — input → 2D SVG (the only OpenChemLib consumer in the text path)
`renderStructure(input, width=280, height=220): StructureResult | null`. Resolution order: **name → formula → raw SMILES**. Uses OpenChemLib `Molecule`:
- `fromSmiles` (wrapped in `safeFromSmiles`, which rejects empty molecules and swallows exceptions),
- `inventCoordinates()` (2D layout),
- `toSVG(w, h)` (render),
- `toIsomericSmiles()`, `getIDCode()`, `getMolecularFormula()` for provenance (canonical SMILES, OCL ID-code, formula, MW rounded to 2 dp).

Every OCL call is individually try/caught so partial provenance failures don't abort the render.

#### `builder.ts` — programmatic molecule construction (OpenChemLib)
Turns a pasted **MDL molfile** or a typed **atom/bond DSL** into a `BuildResult` (SVG, SMILES, formula, MW, ID-code, R-group labels, generic flag). Supports **generic/Markush query structures** for patents.

The atom/bond DSL:
- `atoms: C C O` — 1-indexed element symbols; charges `N+`, `Fe2+`, `O2-`; implicit H by valence.
- `bonds: 1-2 2=3` — `-`/`=`/`#` single/double/triple, `~` any, `>` wedge, `<` hash.
- Query atoms: `[C,N]` atom list, `X` halogen, `A` any, `Q` heteroatom, `R`/`R1…` attachment.
- Query features in trailing `{…}` (mapped to OCL constants): `ar`, `!ar`, `ring`, `chain`, `sub`, `nosub`, `r3..r7`, etc.

Notable care: bracket/brace-aware token splitting; Markush shorthands only trigger when the token is *exactly* the shorthand (so real elements `Ar`, `Al`, `Rb`, `Ru` are safe); fragments are marked (`setFragment(true)`) when any query feature is present; generic structures report `formula = "generic structure"`, `mw = 0`. `qfFlag` resolves OCL constants by name and throws if the build lacks them.

#### `gallery.ts` — substituent list parser
`parseSubstituents(text): { label, input }[]` — one R-group alternative per line, `label = value` or `label: value`. The regex requires whitespace around the `=`/`:` so a label-less SMILES with double bonds (`O=C=O`, `CC(=O)O`) is never mis-parsed as `label = value`. Unmatched lines become `{ label: "", input: line }`.

### 7.3 Math Pipeline

The math engine has **two generations** that coexist: a legacy inline formatter and the primary AST pipeline.

[[DIAGRAM:fig3-math-pipeline]]

*Figure 3. The math pipeline. A single parser produces one AST that feeds two emitters — OMML for the inserted Word equation and HTML for the live preview — with a legacy formatter as a preview-only fallback so the preview never blanks on partially-typed input.*

```
input ─┬─ parseMathAst() ─► Node AST ─┬─ emit()      ─► OMML ─► buildMathOoxml() ─► insertOoxml()
       │   (mathParse)                └─ astToHtml() ─► HTML  ─► live preview
       │                                 (mathHtml)
       └─ parseMath() ─► Segment[] ─► segmentsToHtml()   (FALLBACK when AST parse throws)
           (mathFormat)
```

#### `mathParse.ts` — tokenizer + recursive-descent parser
`parseMathAst(input): Node` produces a shared tagged-union AST (`text`, `row`, `frac`, `sup`/`sub`/`subsup`, `rad`, `delim`, `nary`, `func`, `lim`, `acc`, `matrix`, `cases`). Throws on anything it can't parse (enabling fallback). Supports fractions `a/b`, scripts `x^{n+1}`, `sqrt`/`root`, `abs`/`floor`/`ceil`/`norm`, n-ary `sum`/`int`/`prod`/`oint`/`iint`/`iiint`, `lim`, named functions, accents `bar`/`hat`/`vec`, matrices (`pmatrix`/`bmatrix`/`vmatrix`), `cases`/piecewise, Dirac notation, implicit multiplication (`2x`), Greek/logic/set/blackboard symbols. Lookup tables (`GREEK`, `SYMBOLS`, `KNOWN_FUNCS`, `ATOM_GLYPHS`, …) drive tokenizing; the tokenizer is glyph-aware so palette-inserted Unicode parses back. Standard precedence ladder: `parseExpr` → `parseTerm` (handles `/` → frac and implicit mult) → `parseFactor` (scripts + factorial) → `parseBase`/`parseIdentifier`.

#### `mathOmml.ts` — OMML emitter + OOXML package builder
- `mathToOmml(input)` → `<m:oMath>…</m:oMath>` via `emit(node)` (a `switch (node.k)` mapping each AST node to OMML: `<m:f>`, `<m:sSup>`, `<m:rad>` with `degHide`, `<m:nary>` with `limLoc` differing for sums vs. integrals, `<m:d>` delimiters, `<m:m>` matrices, upright `m:sty val="p"` for function names/operators).
- `buildMathOoxml(body, {number?})` wraps the math in a minimal **flat-OPC WordprocessingML package** that `Word.Range.insertOoxml()` accepts — producing a *real* Word equation object. The optional `number` adds a right tab stop + label run for patent-style numbering.
- `mathToOoxml(input, opts)` = parse + wrap, the convenience entry used by the task pane.

#### `mathHtml.ts` — live-preview renderer (mirrors the OMML emitter)
`mathToHtml(text)` runs `astToHtml(parseMathAst(text))`, producing HTML spans (`.m-frac`, `.m-sqrt`, `.m-nary`, CSS-grid `.m-matrix`/`.m-cases`) styled in `taskpane.css`. It is a near-mirror of `emit()`, so the preview is structurally identical to what is inserted. **Resilience:** on a parse throw it falls back to the legacy formatter so the preview never blanks:
```js
try { return astToHtml(parseMathAst(text)); }
catch { return segmentsToHtml(parseMath(text)); }
```

#### `mathFormat.ts` — legacy inline formatter (now the preview fallback)
`parseMath(input): Segment[]` — normalizes symbols (`sqrt(`→`√(`, `<=`→`≤`, `pi`→`π`, `*`→`·`, …) then a linear scan handling only `^`/`_` with `{…}` groups. Produces inline scripts only (no stacked structures). Its sole runtime consumer today is `mathHtml`'s fallback path.

#### `codeblock.ts` — code/algorithm block formatter (independent of math)
`formatCodeBlock(input, {style, title?, lineNumbers})` → a monospace, whitespace-preserving HTML table for `insertHtml`. `"algorithm"` style bolds control-flow keywords (`KEYWORD_RE`); `"code"` is verbatim. Optional caption row and right-aligned line-number cells. Pure string logic.

### 7.4 Patent-Drafting Feature Modules

[[DIAGRAM:fig5-markush]]

*Figure 4. Markush legend automation. From a generic structure's R-group references, a bounded breadth-first traversal discovers the full nested sub-generic hierarchy (R1 → R1a → R1b …), shorthand is typeset idempotently, and the legend is emitted as either an inline phrase or a two-column table.*

#### `markush.ts` — R-group definitions / Markush legends
- `expandDefinition(input)` — ordered, idempotent regex passes converting shorthand to typeset Unicode: `C1-6`/`C1-C6` → `C₁–C₆` (subscripts + en-dash), single counts before carbon-group keywords → subscript (gated by `alk|cycloalk|aryl|heteroaryl|acyl` so real formulas like `C2H5` are untouched), `"opt sub"` → `"optionally substituted"`, variable ranges `n=1-3` → `n = 1–3`.
- `referencedRGroups(text)` — finds distinct nested R-group references (`R1`, `R1a`, `R1'`, `Ra`) in order, without false-positiving on words like "Red"/"Ring".
- `buildLegendText(entries)` → `"where R1 = …; R2 = …"`; `buildLegendTableHtml(entries)` → a two-column HTML table for `insertHtml`.

#### `botanical.ts` — plant nomenclature typesetting
- `parseBotanicalName(input): NamePart[]` — a small state machine implementing ICN/ICNCP italicization rules: genus + species epithet italic; rank connectors (`var.`, `subsp.`), authors, unranked markers (`sp.`), hybrid markers (`×`), and cultivars (quoted / `cv.`) roman. Driven by `RANK_CONNECTORS`/`UNRANKED` sets and `isEpithet` (lowercase-initial) detection; once authors/cultivar/`sp.` appear, the rest latches roman.
- `formatBotanicalNameHtml(input)` wraps italic parts in `<i>`.
- `formatTraitTableHtml(input)` builds a `Label: value` characteristics table.

#### `sequence.ts` — WIPO ST.26 sequence-listing XML
- `cleanResidues(moltype, raw)` — strips non-letters, normalizes case, validates against IUPAC alphabets (`DNA`/`RNA`/`AA`), and reports distinct dropped chars for a UI warning.
- `buildSt26Xml(meta, entries)` — assembles the INSDSeq/ST.26 structure (`dtdVersion="V1_3"`, declaration + DOCTYPE, applicant/title, `SequenceTotalQuantity`, per-sequence source feature with `mol_type`/`organism`, residues). `escapeXml` removes XML-illegal control chars and escapes entities so free text cannot break the document. **Deliberately `Date`-free** — the caller passes `productionDate` — to keep it deterministic and testable.

### 7.5 State, Data & Palettes

#### `numbering.ts` — equation numbering counter
`toRoman(n)` (greedy subtractive), `peekFormulaNumber()`, `nextFormulaNumber()` (returns current, persists +1), `resetFormulaNumbering()`. Backed by `localStorage` key `formula-inserter.formulaCounter`, fully try/catch-guarded (returns 1 if storage is unavailable). The only stateful engine module besides history.

#### `history.ts` — recents & favorites
`getRecents`/`addRecent` (MRU, `MAX_RECENTS = 8`), `getFavorites`/`isFavorite`/`toggleFavorite`, `clearHistory`. Two `localStorage` keys; identity via `kind::value`; all access best-effort (try/catch, never throws). Records only the three formatting kinds (`chemical`/`math`/`build`).

#### `formulaLibrary.ts` — categorized formula catalog
`FORMULA_LIBRARY: FormulaCategory[]` — ~17 categories (Statistics, Calculus, Physics, ML, EE, Biology, …) of `{ label, expr }` where `expr` is in the math DSL. Drives the library dropdowns and feeds the search index. Every entry is data-driven through `mathToOmml` in tests to prove it parses.

#### `palettes.ts` — clickable template data
`MATH_PALETTE` (14 groups), `CHEM_PALETTE` (2 groups), and Build palettes (`BUILD_TEMPLATES`, `BUILD_BONDS`, `BUILD_MARKUSH`). Each `PaletteItem` carries a `snippet` and an optional `caret` offset for cursor placement after insertion.

---

## 8. The UI Layer: Task Pane

### 8.1 `taskpane.ts` — the single UI controller
[[DIAGRAM:fig6-modes]]

*Figure 5. Six user-facing modes funnel into one shared pure engine and one shared insertion layer. Adding a capability means adding a pure module plus a task-pane section; the insertion layer and the WYSIWYG invariant are reused unchanged.*

~1400+ lines. It owns **no parsing/rendering logic** — it orchestrates the engine and performs all Word interaction. Six modes selected by radio buttons:

```ts
type Mode = "chemical" | "math" | "build" | "code" | "sequence" | "botanical";
```

Responsibilities:
- **Bootstrap** in `Office.onReady` (host guard → resolve DOM → bind events → populate library/search/palette/history → first preview).
- **Mode switching** via `onInputChanged()`, the central dispatcher that toggles section visibility and calls the right preview updater. Sections are plain `<section>`s toggled by `style.display` — there is no tab widget.
- **Search** across `FORMULA_LIBRARY` (math) and `NAME_TO_SMILES` keys (chemical), scored with prefix-priority, top 12 shown as a listbox.
- **Palette rendering** as collapsible `<details>` accordions whose open/closed state persists per-mode in `localStorage`; buttons use `mousedown`+`preventDefault` to preserve the caret, then splice the snippet at the cursor.
- **Live preview** that reuses the exact insertion HTML/SVG.
- **R-group legend logic** including a bounded BFS (`collectSubGroups`, depth < 5, cycle-guarded) to discover nested sub-generic groups, with in-place row reconciliation that preserves focus.
- **Per-feature handlers** for code, gallery, sequence cards (with live `cleanResidues` readout, download via Blob, copy via clipboard), botanical, and numbering.

### 8.2 `taskpane.html` / `taskpane.css`
The HTML lays out: title, search box, six mode radios, history strip, the chemical/math `#format-section` (with OMML + numbering + library + input + palette + preview + nested 2D-structure section), `#build-section`, `#code-section`, `#sequence-section`, `#botanical-section`, a status line, an "Examples & syntax" `<details>`, and a privacy disclaimer.

The CSS is hand-written (no framework): `:root` custom properties for an Office-like palette, a 480px narrow-pane layout, accordion styling, and a dedicated math-rendering block (`.m-frac`, `.m-sqrt`, `.m-nary`, `.m-matrix`, `.m-cases`) that mirrors `mathHtml.ts` so the preview renders correctly.

---

## 9. Document Insertion Mechanisms

All insertion goes through `Word.run(async (context) => { … await context.sync(); })` against `context.document.getSelection()`. There are **three mechanisms**, chosen by content type:

| Mechanism | API | Used for |
|---|---|---|
| **(a) Formatted text / tables** | `range.insertHtml(html, replace)` | Chemical/math inline text, code blocks, botanical names, R-group & trait tables |
| **(b) Native equation** | `range.insertOoxml(ooxml, replace)` | Math mode with the OMML option — inserts a real Word equation |
| **(c) 2D structure image** | `range.insertInlinePictureFromBase64(...)` | Chemical structures, Build results, substituent galleries |

**Why HTML over imperative run-building:** using `insertHtml` keeps run boundaries deterministic so the insert matches the preview exactly.

**SVG → PNG for images:** `svgToPngBase64(svg, w, h)` draws the SVG onto an offscreen canvas with a **white background** (avoids transparent areas rendering black), then strips the data-URL prefix (Word wants raw base64). Inserted pictures get `altTextDescription` set to machine-readable provenance (`provenanceAltText`: name, formula, MW, SMILES, OCL ID-code).

**Numbering correctness:** the equation number is only *peeked* before insert and *consumed* (`nextFormulaNumber()`) after success, so a failed insert leaves no numbering gap. `insertFormula()` is the dispatcher — in Math mode with OMML checked it tries `insertEquation` first and falls back to `insertFormattedText` on a parse failure.

---

## 10. Data Flow Walkthroughs

**Chemical formula text** (`H2O` → document):
`inputEl` → `parseChemical` → `Segment[]` → `segmentsToHtml` → (preview shows it) → `insertHtml(replace)`.

**Math equation** (`x = (-b +- sqrt(b^2-4 a c))/(2 a)` → document):
`inputEl` → `parseMathAst` → AST → `emit` → OMML → `buildMathOoxml` (+ optional `(I)` label) → `insertOoxml`. In parallel, `astToHtml` renders the live preview from the same AST. If parsing fails mid-type, the preview falls back to `parseMath`/`segmentsToHtml`.

**2D structure** (`aspirin` → image):
`renderStructure` → (name→SMILES via `compounds`) → OpenChemLib `fromSmiles`→`inventCoordinates`→`toSVG` → SVG cached in `currentStructure` → preview shows SVG → on Insert, `svgToPngBase64` → `insertInlinePictureFromBase64` with provenance alt-text.

**Markush build** (atom/bond DSL → image + legend):
`build` → OpenChemLib `Molecule` (fragment if generic) → `BuildResult` → preview → Insert image; then `currentLegendEntries` (mains + BFS-discovered subs) → `buildLegendText` or `buildLegendTableHtml` → appended via `insertParagraph`/`insertHtml`.

---

## 11. Testing Architecture

- **Framework:** Jest 29 + ts-jest, `testEnvironment: "node"`, scoped to `roots: ["<rootDir>/src/lib"]`. The Office-dependent `taskpane.ts` is intentionally **not** unit-tested (it needs the Word host). ts-jest uses an inline tsconfig (`module: commonjs`, `types: ["jest"]`) because the base config restricts types to `office-js`.
- **Approach:** pure unit tests asserting on string/object outputs (HTML fragments, OMML/OOXML, `Segment[]`, SMILES validity). No Office mocks, no DOM.
- **Coverage:** ~11 test files, ~124 cases:

| File | Focus |
|---|---|
| `chemParser.test.ts` | subscripts vs. coefficients, charges, bond glyphs |
| `segments.test.ts` | escaping, merge, HTML rendering |
| `compounds.test.ts` | every dictionary SMILES parses (>0 atoms); `renderStructure` provenance |
| `numbering.test.ts` | `toRoman`; counter degrades gracefully without `localStorage` |
| `markush.test.ts` | shorthand expansion, R-group detection, legend output |
| `codeblock.test.ts` | algorithm/code styles, line numbers, escaping |
| `gallery.test.ts` | label splitting without breaking SMILES double bonds |
| `botanical.test.ts` | italicization rules, trait table |
| `builder.test.ts` | concrete + generic/query structures, stereo bonds, error cases |
| `mathOmml.test.ts` | full OMML surface; every `FORMULA_LIBRARY` entry parses |
| `sequence.test.ts` | residue cleaning + ST.26 XML structure/escaping |

- **Standalone verification scripts:** `validate-compounds.mjs` (gates on any SMILES that fails to render), `parsers.sanity.mjs` (manual eyeballing copy), and `scripts/review-sheet.js` (renders all compounds to `review-sheet.html` for chemist sign-off).

---

## 12. Packaging & Deployment

### 12.1 The deployment model
An Office add-in = a small `manifest.xml` + HTTPS-hosted static web files. Nothing of the app is installed locally. Two independent things must happen: **host** the `dist/` files at HTTPS, and **register** the manifest per user.

[[DIAGRAM:fig2-build-deploy]]

*Figure 6. The build-and-deployment pipeline. A CI gate (type-check → tests → compound validation → build → manifest validation) precedes a webpack build to `dist/`; from there two independent paths — hosting the web files on GitHub Pages and registering a stamped manifest per user — converge when Word loads the add-in from the hosted URL.*

### 12.2 CI/CD (GitHub Actions)
- **`ci.yml`** (push/PR, Node 20): `npm ci` → `npm run lint` (tsc) → `npm test` (jest) → `npm run validate:compounds` → `npm run build` → `office-addin-manifest validate`. All three test layers gate every change.
- **`pages.yml`** (push to main + manual): `npm ci` → `npm run build` → `upload-pages-artifact path: dist` → `deploy-pages`, publishing `dist/` to `https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/`.

### 12.3 `scripts/package.ps1` — the emailable kit
`package.ps1 -HostUrl https://<host>/formula-inserter`:
1. Validate `HostUrl` is HTTPS; `npm run build`.
2. Stage `release\formula-inserter\`; copy `dist\*` into `web\`; strip manifests from `web\`.
3. **Stamp** the manifest: `(Get-Content manifest.prod.xml -Raw) -replace "https://ADDIN-HOST.example.com", $HostUrl`.
4. Validate the stamped manifest (`office-addin-manifest validate`).
5. Copy installer scripts + docs; `Compress-Archive` → `release\formula-inserter.zip`.

### 12.4 Per-user install (no admin) — `packaging/install.ps1`
1. Copy `manifest.xml` to `%LOCALAPPDATA%\FormulaInserter\manifest.xml`.
2. Register as a **Developer add-in** under HKCU (value name *and* data are both the manifest path):
   ```powershell
   $dev = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
   New-ItemProperty -Path $dev -Name $manifest -Value $manifest -PropertyType String -Force
   ```
   After a full Word restart the add-in appears under **Insert → Add-ins → Developer Add-ins → Formula Inserter**. `uninstall.ps1` removes the value, cleans a legacy TrustedCatalogs entry, and deletes the local folder. (`install.bat` is the double-click `reg add` equivalent.)

> **Note:** the local-folder **TrustedCatalogs** ("Shared Folder") method did *not* surface on this team's Office build and is not used. The Developer-registry method is the supported path.

### 12.5 Alternative rollout & docs
- **Centralized Deployment** (M365 admin center → Integrated apps): upload the same `manifest.xml`, assign users; the button appears on the Home tab automatically (propagation up to ~24 h).
- Packaging docs: `INSTALL.md` (end users), `GITHUB-PAGES.md` (hosting), `CENTRALIZED-DEPLOY.md` (IT admins), `HOST-SETUP.md` (any HTTPS host).

### 12.6 `release/` contents
- `release/formula-inserter/` — full staged kit (`web/` + manifest + installers + docs).
- `release/install-kit/` — trimmed **email-to-users** kit (manifest + installers + INSTALL.md, no `web/`).
- `release/FormulaInserter-Install.zip` (~4.7 KB) — zipped install kit.
- `release/formula-inserter.zip` (~2 MB) — zipped full kit.
- `release/Formula-Inserter-Features.docx` — feature list for distribution.

### 12.7 Update story
- **Web-only change:** push to `main` → Action republishes → clients get it on next pane open (manifest unchanged, no re-send).
- **Manifest change:** bump `<Version>` (keep the `<Id>` GUID), re-send/re-upload.

---

## 13. Cross-Cutting Concerns & Design Principles

1. **Pure engine / thin shell.** Every `src/lib` module is Office-free; all Word interaction is confined to `taskpane.ts`. This is what makes the Node Jest suite possible.
2. **WYSIWYG invariant.** One renderer per content type feeds both preview and insertion (`segmentsToHtml` for text; `astToHtml`/`emit` from one AST for math; one cached SVG for structures).
3. **Single parser, two emitters (math).** `mathParse` → `mathOmml` (Word) and `mathHtml` (preview), guaranteeing the equation and its preview stay structurally identical.
4. **Graceful degradation.** Math preview falls back to the legacy formatter on parse error; `localStorage` access is universally try/catch-guarded; every OpenChemLib call is defensive.
5. **Determinism for testability.** `sequence.ts` avoids `Date`; numbering is peeked-then-consumed; HTML/XML escaping is consistent.
6. **Drafting aid, not authority.** Pragmatic parsers; ST.26/SMILES outputs are designed for downstream validation. Chemist sign-off is supported via `review-sheet`.
7. **Privacy.** No backend, no telemetry, no document content transmitted — only static UI code is fetched over HTTPS.
8. **Minimal dependencies.** Two runtime deps (core-js, OpenChemLib); no framework, no ESLint, no Babel.

---

## 14. What Was Built — Complete Capability Inventory

This section is an exhaustive, claim-oriented inventory of delivered functionality, grouped by capability. It is intended to support a patentability assessment, so each item states *what it does* and, where relevant, *the specific mechanism*.

### 14.1 Chemical formula text formatting
- Parses a linear chemical-formula string into formatted runs with correct **subscripts** (atom counts) and **superscripts** (charges), inserted as real Word character formatting.
- **Context-sensitive disambiguation** of digits: a leading number is a stoichiometric coefficient (full size, e.g. `2 H₂O`); a number following an atom/group is a subscript count — decided by a position/space heuristic rather than a chemistry model.
- Handles charge notation (`^2-`, trailing `+`/`-`), bracketed groups `Ca(OH)₂`, and hydrate dots, while remaining a deliberately permissive (non-validating) parser.

### 14.2 Mathematical equations (native Word OMML)
- A **linear math DSL** (fractions `a/b`, scripts `x^{n+1}`, `sqrt`/`root`, `sum`/`int`/`prod`/`oint`/`iint`/`iiint`, `lim`, `abs`/`floor`/`ceil`/`norm`, matrices `pmatrix`/`bmatrix`/`vmatrix`, `cases`/piecewise, accents, Dirac notation, implicit multiplication, Greek/logic/set symbols).
- A hand-written **tokenizer + recursive-descent parser → AST → OMML emitter**, wrapped in a minimal **flat-OPC WordprocessingML package** so insertion produces a *native, editable Word equation object* (not an image).
- **Dual rendering from one AST**: the same AST also renders to HTML/CSS for the live preview, guaranteeing preview/insertion fidelity.
- **Graceful degradation**: on a parse error the preview falls back to a legacy inline formatter so it never blanks mid-typing.
- **Patent-style equation numbering**: persistent counter, Roman-numeral labels `(I)`, `(II)`, right-aligned via an OMML tab stop; numbers are *peeked* before insertion and only *consumed* on success (no gaps on failure).
- A **categorized formula library** (~17 domains: statistics, calculus, physics, ML, EE, biology, cryptography, etc.) of ready-to-insert expressions; every library entry is CI-verified to parse to OMML.

### 14.3 2D chemical structures (offline)
- **Offline name/formula → structure resolution**: a curated dictionary (259 names, 101 formulas → canonical SMILES) resolves human input, falling back to interpreting the input as raw SMILES; structurally ambiguous molecular formulas are mapped to the common compound.
- Renders 2D depictions via OpenChemLib (`fromSmiles` → `inventCoordinates` → `toSVG`), then **rasterizes SVG → PNG in-canvas with a white matte** and inserts as an inline picture.
- **Provenance embedded in the document**: each inserted image carries machine-readable alt-text with name, molecular formula, MW, canonical SMILES, and OpenChemLib ID-code.
- **CI-validated dictionary**: every dictionary SMILES is verified to render (no silent failures); a `review-sheet` renders all compounds for chemist sign-off.

### 14.4 Generic / Markush query structures (patent drafting)
- A **textual atom/bond DSL** (`atoms: C C O`, `bonds: 1-2 2=3`) with charges, implicit-hydrogen valence filling, and stereo wedge/hash bonds — building structures without a graphical editor.
- **Query/Markush atoms**: atom lists `[C,N]`, halogen `X`, any-atom `A`, heteroatom `Q`, and R-group attachments `R`/`R1…`, mapped to OpenChemLib **query constants**; structures are marked as fragments when generic.
- **Query feature blocks** `{ar, ring, !ar, chain, sub, nosub, r3..r7}` mapped to OpenChemLib atom/bond query flags, enabling generic patent claim structures from plain text.
- Molfile (MDL V2000/V3000) paste path as an alternative input.

### 14.5 Markush legend automation
- **Auto-discovery of nested R-group hierarchies** via a bounded, cycle-guarded breadth-first traversal of cross-references in R-group definitions (R1 references R1a, which references R1b, …).
- **Idempotent shorthand typesetting** of claim language: `C1-6 alkyl` → `C₁–C₆ alkyl`, `opt sub` → `optionally substituted`, variable ranges → en-dashed forms — keyword-gated so ordinary formulas (`C2H5`, `CO2H`) are left untouched.
- Emits the legend as either an **inline phrase** ("where R1 = …; R2 = …") or a **two-column table**.
- **Substituent gallery**: parses a list of R-group alternatives (label = structure) and inserts a gallery of depictions, with a parser tuned so label-less SMILES containing `=` bonds are never misread as `label = value`.

### 14.6 Biological sequence listings (WIPO ST.26)
- Generates **WIPO Standard ST.26 sequence-listing XML** (the mandatory patent format) for DNA/RNA/protein entries directly inside Word.
- **Residue cleaning/validation** against IUPAC alphabets (including ambiguity codes), with reporting of dropped characters for a UI warning.
- XML hardening (control-char stripping + entity escaping) so free-text fields cannot produce ill-formed output; **deterministic (`Date`-free) generation** for testability; download and clipboard export.

### 14.7 Botanical / plant nomenclature (plant patents)
- A **state-machine typesetter** applying ICN/ICNCP italicization rules: genus + species epithet italic; rank connectors (`var.`, `subsp.`), authors, unranked markers (`sp.`), hybrid markers (`×`), and cultivar names roman; cultivar quotes normalized.
- A varietal **characteristics table** generator (`Label: value` → styled table).

### 14.8 Code / algorithm blocks
- Formats pseudocode/algorithm listings or verbatim code into a monospace, whitespace-preserving Word table, with optional caption, optional line numbers, and **control-flow keyword bolding** in "algorithm" style.

### 14.9 Cross-cutting product capabilities
- **Six unified modes** (chemical, math, build, code, sequence, botanical) in one task pane over one shared pure engine and one shared insertion layer.
- **WYSIWYG invariant**: the exact HTML/SVG shown in the preview is what is inserted.
- **Unified search** across the formula library and the compound dictionary with prefix-priority scoring.
- **Clickable palettes** with cursor-aware snippet insertion and persisted accordion state; **recents & favorites** history.
- **Privacy by construction**: no backend, no telemetry, no transmission of document content; only static UI code is fetched over HTTPS.
- **No-admin, per-user deployment** via the `HKCU\…\WEF\Developer` registry mechanism, plus an org-wide Centralized Deployment path.

---

## 15. Novelty & Prior-Art Landscape

> **Disclaimer.** This section is an engineering self-assessment to inform a *go/no-go* decision on engaging patent counsel. It is **not** a legal opinion, not a freedom-to-operate analysis, and not a substitute for a professional prior-art search. Patentability turns on claim drafting and on prior art not visible from within this project.

### 15.1 Relevant prior art (known categories)

| Prior art | What it does | Overlap with this project |
|---|---|---|
| **Native Word Equation Editor** (OMML, UnicodeMath/LaTeX-like linear input) | Insert/edit native equations | Overlaps math OMML insertion and linear input; it is the baseline to beat |
| **MathType / WIRIS** (Word add-in) | Rich equation editor, OMML output, handwriting | Strong overlap on equations; mature commercial product |
| **Chem4Word** (open-source Office add-in) | Insert/edit 2D chemical structures in Word (CML), navigator | Closest prior art for structures-in-Word; uses an editor + CML rather than offline name/SMILES resolution |
| **ChemDraw / ChemOffice "for Word"** | Insert structures, name↔structure, some Markush | Overlaps structures and Markush; desktop-heavy, licensed, not a zero-backend web add-in |
| **WIPO Sequence (desktop tool)** | Author/validate ST.26 XML | Overlaps ST.26 generation; standalone app, **not** a Word add-in; authoritative validator |
| **PerkinElmer/other cheminformatics toolkits** | SMILES/molfile parsing, depiction, query structures | Underlying capabilities (OpenChemLib here) are well-known building blocks |
| **General code-formatting / syntax-highlight tools** | Format code listings | Overlaps the code-block feature; commodity |

**Honest read:** every *individual* capability has meaningful prior art. The native equation editor and MathType cover equations; Chem4Word and ChemDraw cover structures-in-Word; WIPO Sequence covers ST.26; OpenChemLib (and peers) cover the cheminformatics primitives. None of the headline features is, by itself, plausibly novel.

### 15.2 Where the genuine differentiation lies

The defensible differentiation is in **specific mechanisms and their integration**, not in the broad feature categories:

1. **Unified, zero-backend, patent-drafting-oriented suite in a single Word task pane** spanning chemistry text, native math, offline 2D structures, Markush query structures *with automated legend generation*, ST.26 sequences, and botanical nomenclature — a combination not known to exist in one add-in, and notable for running entirely client-side with no document data leaving the machine.
2. **Automated Markush legend generation via bounded BFS over R-group cross-references**, reconciling a nested sub-generic hierarchy and emitting inline-or-table legends with idempotent, keyword-gated claim-shorthand typesetting. This is a specific, non-trivial workflow mechanism.
3. **Atom/bond textual DSL with query/Markush semantics mapped to cheminformatics query constants**, producing generic patent structures from plain text without a graphical editor — inside a word processor.
4. **Single-AST dual-emitter with graceful degradation** guaranteeing preview/insertion fidelity for math (one parser → OMML *and* preview HTML, plus a fallback formatter). A clean invariant, though arguably an application of known patterns.
5. **Provenance-embedded structure images** carrying canonical SMILES/ID-code/MW/formula in document alt-text, making inserted depictions machine-recoverable from the `.docx`.
6. **Offline human-input → structure resolution** combining a curated name/formula dictionary with canonicalization to resolve ambiguity, entirely client-side within Office.

### 15.3 Novelty triage

| Candidate concept | Likely novelty | Notes |
|---|---|---|
| Headline features individually (equations, structures, ST.26, code) | **Low** | Covered by prior art above |
| Single-AST dual-emitter + fallback (math fidelity) | **Low–Medium** | Sound, but a known software pattern; hard to claim non-obvious |
| Offline name/formula→structure resolution in Word | **Medium** | Dictionaries are known; the offline-in-Office combination is less common |
| Provenance-embedded depictions for round-tripping | **Medium** | Specific and useful; check prior art on metadata-in-alt-text |
| Atom/bond DSL → query/Markush structures in a word processor | **Medium–High** | Text-driven generic-structure authoring inside Word is unusual |
| **Automated Markush legend generation (BFS hierarchy + idempotent claim typesetting + inline/table emission)** | **Medium–High** | The most concrete, workflow-specific candidate |
| Unified privacy-preserving patent-drafting suite (the integration) | **Medium** | Integration claims are weaker alone but strengthen a system claim |

---

## 16. Patentability Assessment

> **Not legal advice.** The following is a structured engineering view to decide whether to consult a patent attorney. A qualified practitioner and a formal prior-art/FTO search are required before any filing decision.

### 16.1 The four gates

1. **Subject-matter eligibility — the main hurdle.** This is software operating on text/markup. In the US (*Alice*/§101) and at the EPO (technical-character requirement), abstract data manipulation and "automating a manual drafting task" are weak. The path to eligibility is to frame and claim a **technical effect / improvement in the operation of the tool**, e.g.:
   - guaranteed preview/insertion fidelity via a single-AST dual-emitter (a concrete rendering-correctness mechanism);
   - offline, deterministic resolution + depiction that avoids any server round-trip (a specific computer-implemented process with a technical character);
   - generation of machine-recoverable structured provenance within an opaque document format.
   Pure "format this claim language nicely" framings are likely ineligible.
2. **Novelty (§102 / Art. 54).** Headline features fail here against the prior art in §15.1. Novelty must be sought in the **specific combined mechanisms** (Markush legend BFS + idempotent typesetting; text-DSL query structures in Word; provenance round-tripping) — and only a real search can confirm it.
3. **Non-obviousness (§103 / inventive step).** The bar is the realistic killer: a skilled person aware of Chem4Word/ChemDraw, MathType, OpenChemLib, and WIPO Sequence might be held to find combining them obvious. The strongest non-obviousness argument is a **specific mechanism that produces an unexpected benefit** (e.g., the BFS-discovered legend hierarchy with cycle-guarding and idempotent re-runs, or the no-backend offline resolution achieving an outcome others get only via a service).
4. **Enablement / written description.** Strong. The implementation exists, is tested (~124 tests), and is fully documented here.

### 16.2 Strongest candidate claims (for counsel to evaluate)

In rough order of promise:

1. **A computer-implemented method of generating a Markush legend within a word-processing document**, comprising: detecting R-group references in a generic structure; performing a bounded, cycle-guarded breadth-first traversal of R-group definition cross-references to assemble a nested sub-generic hierarchy; applying idempotent, keyword-gated typesetting transforms to claim-shorthand; and inserting the resulting legend as a selectable inline phrase or table. *(Most concrete and differentiated.)*
2. **A method of authoring generic/query chemical structures from a textual atom/bond specification inside a word processor**, mapping query tokens and feature blocks to cheminformatics query constants and inserting a depiction. *(Text-driven generic-structure authoring in Office.)*
3. **A method of inserting a chemical depiction with embedded machine-recoverable provenance** (canonical identifiers + properties in document metadata/alt-text) enabling later extraction from the document. *(Round-trip provenance.)*
4. **A rendering-fidelity method** in which one parsed representation drives both an inserted native-equation markup and an on-screen preview, with automatic fallback rendering on parse failure. *(Weaker; known-pattern risk.)*
5. **A system claim** tying the above into a single offline, no-backend Office add-in spanning chemistry/math/biology/botany. *(Integration; strengthens but rarely stands alone.)*

### 16.3 Recommendation

- **Worth a conversation with patent counsel — selectively.** Do **not** file on the headline features (equations, structures-in-Word, ST.26) — prior art is strong. **Do** ask counsel to assess claims 1–3 above, which are the most specific and least anticipated.
- **Commission a professional prior-art search** focused narrowly on: automated Markush/R-group legend generation; text-driven generic-structure authoring in document editors; and embedding chemical provenance in document metadata. The outcome of this search should gate any spend.
- **Mind the eligibility framing early.** Whether these survive §101/EPO technical-character review depends heavily on claim drafting toward a technical effect; raise this in the first counsel meeting.
- **Consider the business calculus.** Much of the value here is in the *integrated workflow and privacy posture*, which may be better protected by **trade-secret + speed-to-market + copyright** than by patents — especially given non-obviousness risk and the cost/time of prosecution. A narrow patent on claim 1 (Markush legend automation), if it survives search, could still be worthwhile as a defensive/marketing asset.
- **Preserve options now (low cost):** keep dated records of conception and reduction-to-practice (the git history and this document help); avoid public disclosure / distribution of the add-in until counsel advises, because public use or a published GitHub repo can start or bar filing windows in some jurisdictions (notably absolute novelty at the EPO).

> **Bottom line:** No single feature looks patentable on its own, but **two or three specific mechanisms — chiefly the automated Markush legend generation, and secondarily the text-DSL query-structure authoring and provenance round-tripping — are concrete and unusual enough to justify a paid prior-art search and a short consultation with a patent attorney before deciding.** Treat the eligibility (§101) and non-obviousness (§103) bars as the gating risks.

---

## 17. Module Dependency Map

```
segments.ts ──────────────► chemParser.ts ──────────────┐
   ▲  ▲                                                   │
   │  └──────────────── mathFormat.ts ◄── (fallback) ─────┤
   │                          ▲                            │
   │                          │                            ▼
mathHtml.ts ──► mathParse.ts ◄── mathOmml.ts        taskpane.ts
   │                                  │              (UI / Office.js)
   │                                  │                  ▲  ▲  ▲
compounds.json ─► compounds.ts ─► structures.ts ─────────┘  │  │
                                   (OpenChemLib)             │  │
                       builder.ts (OpenChemLib) ────────────┘  │
                                                               │
   markush.ts • botanical.ts • sequence.ts • codeblock.ts •    │
   gallery.ts • palettes.ts • formulaLibrary.ts •              │
   history.ts • numbering.ts  ─────────────────────────────────┘

OpenChemLib is consumed ONLY by structures.ts and builder.ts.
```

---

## 18. Appendix: File Inventory

**Engine (`src/lib/`)**
`segments.ts`, `chemParser.ts`, `compounds.ts` (+`compounds.json`), `structures.ts`, `builder.ts`, `gallery.ts`, `markush.ts`, `botanical.ts`, `sequence.ts`, `mathParse.ts`, `mathOmml.ts`, `mathHtml.ts`, `mathFormat.ts`, `codeblock.ts`, `palettes.ts`, `formulaLibrary.ts`, `history.ts`, `numbering.ts`.

**Tests (`src/lib/__tests__/`)**
11 `*.test.ts` files + `validate-compounds.mjs` + `parsers.sanity.mjs`.

**UI (`src/taskpane/`, `src/commands/`)**
`taskpane.html`, `taskpane.ts`, `taskpane.css`; `commands.html`, `commands.ts`.

**Build & config**
`webpack.config.js`, `tsconfig.json`, `jest.config.js`, `package.json`, `manifest.xml`, `manifest.prod.xml`.

**Scripts (`scripts/`)**
`package.ps1`, `review-sheet.js`.

**Packaging (`packaging/`)**
`install.ps1`/`.bat`, `uninstall.ps1`/`.bat`, `INSTALL.md`, `GITHUB-PAGES.md`, `CENTRALIZED-DEPLOY.md`, `HOST-SETUP.md`.

**CI (`.github/workflows/`)**
`ci.yml`, `pages.yml`.

**Release (`release/`)**
`formula-inserter/` (full kit), `install-kit/` (email kit), `formula-inserter.zip`, `FormulaInserter-Install.zip`, `Formula-Inserter-Features.docx`.
</content>
</invoke>
