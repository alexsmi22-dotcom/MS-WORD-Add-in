# Scope: Journal-grade figures (hit-list item 12)

Audit first, 2026-10-14. Read-only investigation. Every claim in Part B was **measured**:
the whole figure corpus was dumped through `scripts/ts-require.js` and its `<text>` labels
were analysed, and `buildPlotSvg` was driven with edge-case data. Nothing here comes from
reading code alone. The probe scripts lived in the session scratchpad. Nothing was added to
the repo except this file.

The hit-list wording was "vector SVG insert, axis limits and ticks, significance brackets,
serif fonts, A/B/C panels". **Two of those premises are contradicted by the journals' own
guides** (see C.2). This brief says so instead of building to them.

---

## A. What exists

### A.1 Chart builders

28 modules in `src/lib` emit `<svg`. The corpus gate counts every module that exports a
`…Svg` function (`scripts/check-figures.js`, which derives the list from disk).

| Family | Modules | Axis/tick code used |
|---|---|---|
| Generic XY plot | `plot.ts` (`buildPlotSvg`, `combineSvgs`). It is reused by `avFigures`, `interpolate`, `spline`, `isotopeChart`, `overlayChart`, `spectraChart` and `statsBatchCalcs` | `plot.niceStep`, `plot.fmtTick`, `plot.logTicks`, `plot.fmtLogTick` |
| Table→Chart | `tablechart.ts`, `tablefigure.ts`, `tablediagram.ts` | `plot.niceStep` and `plot.fmtTick` (imported) |
| Engineering | `mechchart.ts` (Mohr, Goodman, column, truss, NPSH, pole-zero, hBar…), `beamChart.ts` | its **own** `mechchart.niceStep` and `ticks`, plus a local `n1 = v.toFixed(1)` formatter |
| Statistics | `statchart.ts` (box, forest, grouped bar) | `mechchart.niceStep` and `ticks` plus `plot.logTicks` (forest) |
| Finance | `candlestick.ts` | `plot.niceStep` and `fmtTick` |
| Heat map | `heatmap.ts` | `plot.fmtTick` |
| Audio/video | `audio.ts`, `avFigures.ts` | its **own** `linearTicks` and `decadeTicks` (audio.ts:1204, :1214) |
| No numeric axes | `periodicChart`, `seqmap`, `seqmapcirc`, `mol3d`, `automata`, `treeSvg`, `cayleyTableSvg`, `geometryChart`, `geometryDraw`, `sketchChart`, `lpFigure`, `graphs`, `persistence`, `reactions`, `radius`, `probability`, `chembioCalcs`, `statsBatchCalcs` | ad hoc, per figure |

**There is no shared axis engine.** There are at least three tick algorithms, and they
disagree:

- `plot.niceStep` rounds norm with thresholds `<1.5 / <3 / <7` to 1, 2, 5 or 10. It does not
  guard non-finite input.
- `mechchart.niceStep` uses `≤1 / ≤2 / ≤5`. It is hardened against Inf/0 and bounds its
  `ticks()` array.
- `audio.ts` has its own linear and decade ticks.

Neither `niceStep` supports 2.5. Neither considers label width, the number of ticks that fit,
or coverage. There are **no user-set axis limits.** `PlotOptions` (plot.ts:216–266) has
`xScale`/`yScale`, `xTickLabel`/`yTickLabel` formatters and `notes`, but no
`xmin`/`xmax`/`ymin`/`ymax`.

Shared style assets that exist:

- `chartPalette.ts` holds sequential and diverging ramps, already run through the dataviz
  validator. This is the precedent for doing palettes properly.
- `tablechart.ts` has a **patent mode**: `PATENT_FILLS` (black, white, diagonal, crossed and
  horizontal hatches) and black lines.
- Series colours are **Tableau-10**, used twice in different orders:
  - plot.ts:882 orders blue, orange, green, red…
  - tablechart.ts:60 orders blue, **red, green**…, which puts red and green next to each
    other as series 2 and 3.

  Neither ordering has been validated for colour vision deficiency (CVD).

Multi-panel composition: `combineSvgs` (plot.ts:448) stacks figures **vertically and
centred**. It nests each child as `<svg x= y=>`. It has no grid, no shared axes and no panel
letters.

### A.2 Insert pipeline

Every figure is raster. The path, in `taskpane.ts`, runs:

1. `readSvgDims(svg, fallbackW, fallbackH)` at 33399 reads the SVG's own `width=`/`height=`.
   The fallback applies only when they are absent. This is the "size from the actual SVG"
   lesson, and there are 20+ call sites.
2. `renderFigurePng(svg, w, h)` at 33408 calls `figureScale()` (`lib/figures.ts`):
   4× supersampling (FIGURE_SCALE) under an 8 MP pixel budget. It then **re-renders at a
   lower factor while the base64 is over 1,400,000 chars**, because Word silently drops
   over-size pictures. The worst case is 1× (96 dpi).
3. `svgToPngBase64` at 33445: `<img src=data:image/svg+xml>` → canvas on a white background →
   `toDataURL("image/png")`. It has a 10 s settle timer.
4. `range.insertInlinePictureFromBase64(png, after)`, then
   `sizeFigure(pic, w, h)` = `figurePoints(px) = px × 0.75 pt`. That pins the picture to its
   natural size so the extra pixels become resolution, not size.

**Resolution today:** 4× at natural size is about **384 dpi**. A 380 px figure is 285 pt,
about 100.5 mm. That is adequate for halftone (300 dpi). It is **below line-art
requirements**: Elsevier and Cell ask for 1000 dpi for line art (sources in C.2). A PNG at
1000 dpi and 183 mm is 7205 px wide. That breaks both the 8 MP budget and the 1.4 MB payload
cap. **For line art, vector insert is the only compliant route, not a nicety.**

**Natural width vs journal columns (measured):** 250 of 259 corpus figures insert **wider than
89 mm**. Natural widths run from 26 to 169 mm. So every user shrinks the figure in Word, and
the text shrinks with it (see B.5).

**Theme:** inserted figures are fixed light-on-white. `svgToPngBase64` paints `#fff` first.
They ignore the pane theme by design, and this must stay true.

### A.3 What Word supports for inserting SVG

Sources: Microsoft Learn, fetched 2026-10-14.

| Route | Requirement set | Hosts per the docs | Notes |
|---|---|---|---|
| `Range/Paragraph.insertInlinePictureFromBase64` | WordApi 1.2 | all WordApi 1.2 hosts | **The docs name no accepted formats.** SVG input via this method is **UNVERIFIED**. It must be probed in Word on each host (TEST-SCRIPT item). |
| `Range.insertPictureFromBase64` (floating `Shape`) | WordApiDesktop 1.2 | desktop only | Floating picture in front of text, which is wrong for inline figures. Not recommended. |
| `Office.context.document.setSelectedDataAsync(svg, {coercionType: Office.CoercionType.XmlSvg})` | **ImageCoercion 1.2** | **Word on Windows** (M365, retail and LTSC 2021+), **Word on Mac**. **Not listed: Word on the web, Word on iPad** | The **only documented vector route.** It replaces the selection and returns **no `InlinePicture` handle**, so `sizeFigure()` cannot run on the result directly. The picture must be found again afterwards (e.g. the selection's `inlinePictures`), or `imageWidth`/`imageHeight` options must be used. That has to be measured: it is the "size from readSvgDims" lesson again. |
| `insertOoxml` with a `pic:pic` carrying a PNG `a:blip` plus an `asvg:svgBlip` extension | WordApi 1.1 (manifest already requires 1.3) | all | This is how Word itself stores an SVG with a PNG fallback. It is a **candidate to probe, not a documented promise.** If Word on the web renders the PNG fallback, this route degrades honestly on every host from one payload. |
| `Word.ImageFormat.svg` | WordApiDesktop 1.1 | desktop | Read-only enum for an existing picture's format. Useful only as a post-insert check that the picture really is vector. |

Capability detection must use `Office.context.requirements.isSetSupported("ImageCoercion",
"1.2")`. The existing `wordApiSupported()` helper (taskpane.ts:4848) is **optimistic on
error**, returning true. That is wrong here: a false "vector" claim must not be possible.

Docs:
- Image Coercion requirement sets:
  https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/image-coercion-requirement-sets
- `Office.CoercionType` (XmlSvg):
  https://learn.microsoft.com/en-us/javascript/api/office/office.coerciontype
- `Word.Range` (`insertInlinePictureFromBase64` is WordApi 1.2; `insertPictureFromBase64` is
  WordApiDesktop 1.2):
  https://learn.microsoft.com/en-us/javascript/api/word/word.range

### A.4 Fonts

Measured over the corpus, as `font-family` occurrences per figure:

| Font | Figures |
|---|---|
| `sans-serif` | 202 |
| `Segoe UI, Arial, sans-serif` | 25 |
| `Segoe UI, Arial` | 12 |
| `Georgia,serif` | 12 (automata) |
| `Segoe UI, sans-serif` | 5 |
| `Segoe UI, Helvetica, Arial, sans-serif` | 3 |

Every figure resolves a family through the root or the element. The probe found 0 figures
with uninherited text.

- **No fonts are bundled** (no .woff/.ttf/.otf in the repo).
- Rasterisation uses whatever the webview resolves. An SVG loaded through `<img>` cannot
  fetch web fonts, so only system fonts or an `@font-face` data-URI embedded in the SVG work.
- **Offline serif:** Times New Roman and Georgia ship with Windows and macOS, so a
  `"Times New Roman", Times, serif` stack works offline.
- **Offline sans:** Arial ships on both. Helvetica ships on macOS. `Arial, Helvetica,
  sans-serif` is the portable journal stack.
- On the vector route, Word itself resolves the font names, which is the same system set.

Font sizes in the corpus run from 6.5 to 22 px. 10 px is the common tick and legend size,
which is 7.5 pt at natural size.

---

## B. Live defects in existing figures (measured)

Method: dump all 259 corpus SVGs, extract `<text>` content and positions, group numeric labels
by shared y (x-axis) or shared x with `text-anchor="end"` (y-axis), then check them. Corpus
**fixture** strings are excluded: `Temperature (deg C)` and `floored at -30` are typed by
`scripts/figure-layout-run.ts:398/419/962`, not produced by the product.

| # | Defect | Evidence | Where |
|---|---|---|---|
| B.1 | **Duplicate tick labels: an unreadable axis.** | `buildPlotSvg` on x and y spanning 20000–20050 gives **12 labels that all read `2.0e+4`**. On 1000.001–1000.004 it gives `1000.001, 1000.002, 1000.002, 1000.002, 1000.003, 1000.003, 1000.004`. | `plot.fmtTick`: `toExponential(1)` at abs(v) ≥ 1e4, and a fixed 3-decimal round. Precision is never derived from the step. It reaches every plot.ts consumer, Table→Chart and candlestick. |
| B.2 | **e-notation on axes** (`5.0e+5`, `1.0e+4`, `4.00e-6 kN`) | **22 figures, 97 labels**, including **every Table→Chart kind** (column, bar, line, area, scatter, stacked ×3, patent, femto, signed). These are the main student and attorney path. Journal style is ×10ⁿ or an axis multiplier. | `plot.fmtTick`, `beamChart` |
| B.3 | **Hyphen-minus instead of U+2212** on negative numbers | **115 labels in 40 figures.** Only **1** corpus figure uses U+2212 in a numeric label. The av loudness figure has `−16.3 → −23 LUFS` (U+2212) in its title over hyphenated tick labels. `fmtTick(-2.5)` returns `"-2.5"`. | `plot.fmtTick`, `mechchart.n1`, `heatmap`, `audio` ticks, `statchart` forest |
| B.4 | **Trailing `.0` and mixed decimals in one tick row** | **59 figures.** Mechchart gives `0, 200.0, 400.0, 600.0` and `-500.0, 0, 500.0`. Plot gives `0, 0.2, 0.4 … 1` (should be `0.0 … 1.0`). | `mechchart.n1 = toFixed(1)` except at zero; `plot.fmtTick` strips trailing zeros |
| B.5 | **Text below journal minimum at column width** | Scaled to an 89 mm column, the smallest text in **112/259 figures is under 5 pt** (Nature's floor) and in **208/259 under 6 pt**. Natural-size text as small as 4.9 pt: 6.5 px in truss and periodic table. | All builders: geometry is in px at an arbitrary canvas width (100–640 px) |
| B.6 | **Non-1/2/5 tick step (step 4)** | `box plot at the cap` and `balance conservation bars` give `0, 4, 8 … 20`. `forest plot pairwise` gives `−8, −4 … 12`. `pmf bars 61 wide` steps by 4. **Low severity.** | `statchart` computes the step in half-space and doubles it (statchart.ts:163–181), so 2 × 2 = 4 |
| B.7 | **Log-axis notation switches mid-axis** | Decades 1e−3…1e5 read `0.001, 0.01, 0.1, 1, 10, 100, 1000, 10⁴, 10⁵`: plain then superscript. This is deliberate (`fmtLogTick` comment) but not journal style, which uses 10⁻³ … 10⁵ throughout. A 0.5–30 log axis gets only `1, 10`. | `plot.fmtLogTick`, `logTicks` |
| B.8 | **Display contract in a figure title** | `Predicted 13C NMR (estimate)` and `Predicted 1H NMR`, while the 2D titles correctly use ¹H/¹³C. | `spectraChart.ts:68` interpolates the raw `Nucleus` enum |
| B.9 | **Legend clipping (recorded, not new)** | 9 Table→Chart figures: `"Europe, Middle…" runs outside the canvas`. The truncator cuts by character count, not measured width. Also `jcamp measured ir`, the bohr shells and `seqmap circular`. **21 recorded findings across 16 figures** in `ALLOWANCES` (check-figures.js). | `tablechart` legend truncation |
| B.10 | **Red/green adjacency** | Table→Chart series 2 and 3 are `#d62728` and `#2ca02c`. They are not validated, and the dataviz validator (the chartPalette.ts precedent) must be run before any CVD verdict. | `tablechart.CHART_PALETTE` |

Checked and **not** found: float garbage (`0.30000000000000004`, 0 labels), ticks outside the
plotted range, and uninherited font families (0 figures). `GF(16)` labels like
`a^3 + a^2 + a + 1` are the algebra engine's echo syntax ("verified to read back",
algebraFields.ts:892). They are borderline under the display contract, left to the algebra
owner, and out of scope here.

**The corpus cannot catch B.1–B.8.** `figure-layout-audit.js` measures **geometry only**
(COLLISION, STRIKETHROUGH, CLIPPED) and never reads label content. B.1's twelve identical
labels pass it whenever they don't overlap. It also flattens only `translate`, so the nested
`<svg x y>` children from `combineSvgs` are measured in local coordinates. Panel composition
needs that fixed before it can be gated.

---

## C. Scope, ranked by user value

Users: STEM grad students (figures for theses and papers) and patent attorneys (drawings and
declarations). Ranking weighs **defects visible in every figure today** above new
capabilities.

### C.1 Rank 1: one shared axis and tick engine (`src/lib/axis.ts`)
Fixes B.1–B.4, B.6 and B.7 everywhere at once. Scope:
- **Extended Wilkinson** (Talbot, Lin & Hanrahan 2010) as the default: Q = [1, 5, 2, 2.5, 4,
  3], scored for simplicity, coverage, density and legibility. Keep Heckbert's 1/2/5 as the
  documented fallback. Step 4 becomes legal only when Wilkinson picks it.
- **Label precision from the step, not from the value.** Every label in a row gets the same
  decimals, so B.1 and B.4 disappear. A duplicate label after formatting is an **engine
  error**, asserted.
- **Large and small magnitudes:** a shared ×10ⁿ axis multiplier or offset (`×10⁴` at the axis
  end), never `e+`. The minus is always U+2212, and the multiplier uses superscripts per the
  display contract.
- **Log axes:** decade majors, 2–9 minors, uniform `10ⁿ` labels when the span is ≥ 3 decades.
  When the span is under one decade, add 1-2-5 sub-decade labels so a 0.5–30 axis gets more
  than two labels.
- **User-set limits:** `{min?, max?, step?, log?}` per axis. The engine **refuses**
  min ≥ max, log with min ≤ 0, and limits that hide all data, and says why. A limit that
  clips data writes a note: "n points outside the axis limits".
- Hardened like `mechchart.ticks`: bounded arrays, finite guards, a tick cap.
- Migrate `plot`, `tablechart`, `candlestick`, `heatmap`, `mechchart`, `statchart`,
  `beamChart` and `audio` onto it. Remove both `niceStep`s and `audio.linearTicks`.

### C.2 Rank 2: journal style presets (`src/lib/figureStyle.ts`)
The hit list said "serif, 8–9 pt". **Measured against the guides, that is wrong for the major
journals.**

| Journal | Single / double width | Font | Size | Panel letters | Source |
|---|---|---|---|---|---|
| Nature | **89 / 183 mm** (1.5 col 120 or 136 mm), max height 170 mm | **sans-serif**, Helvetica/Arial; text must stay editable, not outlined | **5–7 pt**, all text ≤ 7 pt | **8 pt bold lowercase a, b, c** | Official: nature.com/documents/nature-final-artwork.pdf; research-figure-guide.nature.com |
| Elsevier | **90 / 190 mm** (1.5 col 140 mm) | (no typeface mandated; Arial/Times/Courier/Symbol accepted) | **7 pt**, sub/superscripts ≥ 6 pt | journal-specific | Official: elsevier.com/…/artwork-and-media-instructions/artwork-sizing. Also 300 dpi halftone, 500 combo, **1000 line art** |
| ACS | ≤ **3.33 in (84.6 mm)** / 4.17–**7 in (177.8 mm)**, max depth 9.17 in | Helvetica/Arial | **≥ 4.5 pt** | journal-specific | **Secondary**: a mirror of ACS "Preparing Graphics". pubs.acs.org returned 403 |
| Cell Press | **85 / 174 mm** (1.5 col 114 mm) | Arial/Helvetica | ~6–8 pt (sources conflict) | uppercase **A, B, C** | **Secondary only**. cell.com/figureguidelines returned 403. Line art 1000 dpi |

So the 85/174 figures are **Cell's**, and the 89/183 figures are **Nature's**. "Serif" is
**not** a journal requirement, and Nature, ACS and Cell want sans. Ship:
- **Per-journal presets** for Nature, Elsevier, ACS and Cell. Each carries the width, font
  stack, a size ladder (tick, label, panel letter), stroke minimum (≥ 0.5 pt) and panel-letter
  case and weight.
- **A "Thesis (serif)" preset**: `"Times New Roman", Times, serif`, sized to match a Times
  body. This is where the requested serif belongs.
- A preset **renders at final width**: the canvas is computed from mm, and fonts are set in pt
  at that width. The figure is inserted at exactly that physical size, and the user never
  scales it. That fixes B.5 by construction.
- Before the build, re-verify the ACS and Cell numbers against their official pages, which
  were unreachable from here.

### C.3 Rank 3: vector insert with honest capability detection (integrator)
- **Detect** with `isSetSupported("ImageCoercion","1.2")`. **Default to raster when unknown**,
  unlike `wordApiSupported`.
- **Vector path** (Win/Mac): `setSelectedDataAsync(svg, {coercionType: XmlSvg})`. Then find
  the inserted picture again and size it from `readSvgDims` on the SVG actually sent. If it
  cannot be found, delete it and fall back to PNG. A picture that is present but wrongly
  sized is the defect class.
- **Probe first:** whether `insertInlinePictureFromBase64` accepts SVG, and whether
  `insertOoxml` with svgBlip plus PNG fallback renders on web, Win and Mac. Run both as one
  TEST-SCRIPT item **before** choosing the route. If the OOXML route works, it beats
  `setSelectedDataAsync`: it inserts after a range, returns a Range, and carries its own
  fallback.
- **Raster path** (web, iPad, unknown): keep `renderFigurePng`. **State the DPI** in the
  status line ("inserted as a 384-dpi PNG; vector needs Word for Windows or Mac"). Under a
  journal preset, rasterise **at the preset's physical size**, so dpi means something.
- Text must stay text (Nature requires editable text). Before claiming "vector", verify that
  Word did not outline or rasterise it, using `Word.ImageFormat` on desktop.

### C.4 Rank 4: significance brackets from real p-values
- Inputs come **only** from engine results:
  - `TukeyResult.pairs[].p` (tukey.ts:212)
  - `TTestResult` (stats.ts:168)
  - `RankTestResult` (stats2.ts:165)
  - `adjustPValues` (stats2.ts:773)
  - `KruskalWallisResult` and Dunn, where present

  There is **no API that takes a free-typed asterisk.** A bracket carries its p and its test
  name.
- Labels: the exact p via `formatP` (stats.ts:370), or stars with the legend stated in the
  figure notes ("* p < 0.05 … Tukey HSD"). The correction method is printed whenever more
  than one comparison is shown.
- `ns` brackets are shown or hidden by an option, never silently dropped when the user asked
  for all pairs.
- Stacking: brackets are packed by span so none cross. The y-axis max extends to fit them,
  through the C.1 engine.
- Targets: `statchart.boxPlotSvg`, `groupedBarSvg`, and the Table→Chart column and bar with
  error bars.

### C.5 Rank 5: multi-panel A/B/C composition
- `composePanels(panels, {cols, preset})` lays panels out on a grid at preset width. Panel
  letters come from the preset (`a` or `A`, bold, at the preset's letter size, top-left of
  each panel). Optional shared x or y axis between aligned panels.
- Children are placed with `<g transform="translate()">`, **not** nested `<svg>`, so the
  layout audit measures them correctly. Alternatively, teach the audit nested `<svg x y>`.
- `combineSvgs` stays for the existing stacks and is reimplemented on top.

### C.6 Rank 6: colour-blind-safe palettes
- Replace both Tableau-10 orders with **Okabe–Ito** (8 colours) as the categorical default.
  **Run the dataviz validator** and quote its output in the file header, as `chartPalette.ts`
  does.
- Redundant encoding: marker shape and dash pattern per series, so the figure survives
  greyscale printing.

### C.7 The USPTO conflict
37 CFR 1.84(a)(1) requires black-and-white drawings; colour needs a petition under 1.84(a)(2).
**1.84(p)(3) requires characters at least 0.32 cm (1/8 in) high**, roughly a 12–13 pt font.
That is incompatible with the 5–7 pt journal sizes, and palettes do not apply. The existing
Table→Chart **patent mode** (`PATENT_FILLS` hatches, black lines) must become a **separate
"USPTO" preset**: black only, hatch fills, ≥ 0.32 cm text, no titles, and reference numerals
allowed. It must never be a journal preset with colours removed. Verify the 1.84 citations
against the current CFR text at build time.

---

## D. Builder split (3 parallel builders + 1 integrator)

Files are disjoint. **Only the integrator touches `taskpane.ts`,
`scripts/figure-layout-run.ts` and `scripts/check-figures.js`**, because other agents are
appending to the corpus concurrently.

### Builder 1: Axis engine
- **Files:**
  - new `src/lib/axis.ts`
  - edits to `plot.ts` (ticks and format only), `tablechart.ts`, `candlestick.ts`,
    `heatmap.ts`, `mechchart.ts` (`niceStep`, `ticks`, `n1`), `statchart.ts` (axis block),
    `beamChart.ts`
  - `audio.ts` tick helpers, only after the v2.140 builders have landed
- **Tests:**
  - new `src/lib/__tests__/axis.test.ts`
  - updates to the existing plot, tablechart and statchart tests where label strings change
- **Acceptance:**
  - Every B.1 repro yields distinct labels: 20000–20050 gives `20 000 … 20 050` or `×10⁴` with
    distinct mantissas.
  - No `e+`/`e-` in any label.
  - Every negative label uses U+2212.
  - Constant decimals per row.
  - Log span ≥ 3 decades gives uniform `10ⁿ`.
  - Limits are honoured; invalid limits are refused with a reason.
  - Bounded on Inf, NaN, 1e308 and span 0.
  - Wilkinson output matches published reference cases.

### Builder 2: Style presets and palettes
- **Files:**
  - new `src/lib/figureStyle.ts` (presets, `mmToPx`, pt ladders, font stacks, panel-letter
    rules)
  - new `src/lib/categoricalPalette.ts` (Okabe–Ito plus markers and dashes)
  - `tablechart.ts` patent block, extracted into the USPTO preset in coordination with
    Builder 1 by function, not by line
- **Tests:** new `figureStyle.test.ts` and `categoricalPalette.test.ts`.
- **Acceptance:**
  - Each preset's numbers match the C.2 table and cite their source in a comment.
  - At preset width, the smallest text is ≥ the preset minimum, measured on rendered SVG
    (not computed).
  - The palette passes the dataviz validator, with output quoted in the file header.
  - The USPTO preset emits no colour other than black and white, and text ≥ 0.32 cm.

### Builder 3: Brackets and panels
- **Files:**
  - new `src/lib/sigBrackets.ts`
  - new `src/lib/panels.ts` (`composePanels`)
  - `plot.combineSvgs` reimplemented as `<g translate>`
  - bracket hooks in `statchart.ts` `boxPlotSvg` and `groupedBarSvg`. This file is shared with
    Builder 1, so Builder 1 lands first, or Builder 3 touches only a new options field.
- **Tests:** new `sigBrackets.test.ts` and `panels.test.ts`.
- **Acceptance:**
  - Brackets are constructible only from `TukeyResult`, `TTestResult` and `RankTestResult`.
  - The bracket's p equals the engine's p. A test cross-checks against `tukeyHSD` on a
    published dataset.
  - No two brackets cross.
  - The y max accommodates the brackets.
  - Panel letters follow the preset's case, weight and size.
  - Composed output contains no nested `<svg>`.

### Integrator
- **Files:**
  - `src/taskpane/taskpane.ts`: capability detection, vector insert, re-find-and-size, PNG
    fallback with a stated dpi, preset picker
  - new `src/lib/insertCapability.ts`: the pure decision function, so it can be tested
    (lesson: taskpane parsers are untestable)
  - `scripts/figure-layout-run.ts`: add preset, bracket and panel figures
  - `scripts/check-figures.js`: raise `CORPUS_FLOOR` (currently **259**)
  - new `scripts/figure-label-audit.js`
  - `docs/TEST-SCRIPT.md`: the in-Word probe
- **Label-content gate** (new, from this audit's probe). It fails on:
  - hyphen-minus before a digit in a label
  - `\de[+-]\d`
  - a duplicate numeric label in one axis row
  - mixed decimals in a row
  - text below the preset minimum at preset width

  It ships with a **self-test on a known-bad SVG**, per the "harness reports itself" lesson.
  It ratchets the counts measured here (B.2 at 22 figures, B.3 at 40, B.4 at 59) downward to
  zero.
- **Acceptance:**
  - On Word for Windows and Mac, a figure inserts as a picture whose format reads SVG, at the
    `readSvgDims` size.
  - On the web, it inserts as PNG and the status line names the dpi.
  - An unknown capability falls back to raster.
  - Live in-Word pass recorded by the user.

### How the existing corpus guards the work
- The geometry gate (COLLISION, STRIKETHROUGH, CLIPPED) runs over all 259 figures after each
  builder lands. Because the tick engine changes every label, **expect the 21 recorded
  ALLOWANCES to shift**.
  - A finding that disappears prints `FIXED … delete them`.
  - A new one fails the gate.
  - Each change is reviewed, not re-baselined wholesale.
- The **`textCount === 0` blank-figure guard** and the **module-in-corpus guard** stop a
  migrated builder from silently going blank or dropping out.
- The new label gate covers what geometry cannot.
- An **independent adversarial pass over the diff** is required before shipping. The
  self-written suites have hidden 7–31 defects per release.

---

## E. Risks

1. **The vector route is half-documented.** `insertInlinePictureFromBase64` with SVG is
   undocumented. `XmlSvg` replaces the selection, returns no handle, and is absent on web and
   iPad. Any route that cannot be re-found and sized correctly is worse than PNG. Probe before
   building ("preview is not insert").
2. **Word renders SVG text itself.** Font substitution, `text-anchor`, `dominant-baseline`
   and Unicode superscripts may render differently than in the webview. Every builder's SVG
   features must be checked inside Word, not in the pane.
3. **A tick-engine change touches every figure.** Hundreds of label-string assertions in
   existing tests will change. Wholesale snapshot updates hide regressions, so update by
   reasoning, per file. "A fix can be worse than the defect."
4. **Concurrency.** `audio.ts`, `avFigures.ts` and the corpus are being edited by the v2.140
   builders right now. Builder 1 must not touch audio until they land, and the integrator
   owns the corpus files.
5. **Journal specs drift, and two of four were secondary sources.** Each preset cites its
   source and the access date. ACS and Cell must be re-verified at build time.
6. **Final-size rendering shrinks the plot area.** At 89 mm with 7 pt text, dense legends
   (Table→Chart with many series) will collide or clip more, not less. Expect new layout
   findings, and give presets a legend-below layout.
7. **USPTO vs journal.** One "journal-grade" switch must not leak colour or small text into
   patent drawings. The USPTO preset is a separate, explicit choice.
8. **Brackets as decoration.** If any code path builds a bracket from a typed string, the
   feature becomes a misrepresentation tool. The type system must make that impossible, and
   the adversarial pass must try to break it.
9. **Payload cap on raster fallback.** At preset physical size with a 1000-dpi target, PNG
   exceeds 1.4 MB and degrades. The status line must state the dpi actually achieved, not
   the dpi requested.
