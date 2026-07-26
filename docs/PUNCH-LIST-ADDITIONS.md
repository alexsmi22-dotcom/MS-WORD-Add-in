# JurisLab — Punch List: Additions & Exploration

Companion to `docs/PUNCH-LIST.md`, which covers defects. This one covers what to
build next. **Audited against v1.87.0 on 2026-07-26, every claim checked against
the source.** Where an earlier draft of this list was wrong, the correction is
recorded rather than quietly deleted — see [Corrections](#corrections-to-the-audit).

`docs/PUNCH-LIST.md` is ordered by risk to the user. This one is ordered by a
different measure, because these are not defects:

> **How many people does this stop from closing a paid tool?**

JurisLab is free, offline and open source, installs in four steps with no admin
rights, and already displaces meaningful parts of ChemDraw, MATLAB, Prism,
SnapGene, MathType and Best Authority. Each item is scored on whether it removes
a reason someone still opens the expensive thing.

Effort: **(S)** hours · **(M)** days · **(L)** weeks
Status: `[ ]` open · `[x]` done · `[~]` partial

---

## P0 — Ship now. Bounded, no architecture change.

### [ ] 1. Fix the two figures Word inserts at double size (S)

**This is a live defect, not a quality item.** `svgToPngBase64(svg, w, h)` draws
at the dimensions passed. Word then sizes an inserted PNG by its pixel count at
96 dpi *unless* `picture.width` is set. Supersampling without resizing therefore
makes the figure physically bigger, not sharper.

Verified state of all twelve `svgToPngBase64` call sites:

| Line | Tool | Scale | Resized | Effect |
|---|---|---|---|---|
| 6460 | **Spectra** | 2× | no | **inserted at 2× intended size — defect** |
| 6772 | **Sequence Map** | 2× | no | **inserted at 2× intended size — defect** |
| 2396 | Table → Chart | 2× | **yes** | correct — the model to copy |
| 1979 | Multi-structure | 1× | no | natural size, ~96 dpi |
| 3217 | Chemical structure | 1× | no | natural size, ~96 dpi |
| 3427 | Peptide | 1× | no | natural size, ~96 dpi |
| 3963 | Reaction | 1× | no | natural size, ~96 dpi |
| 5840 | Plot block (Word insert) | 1× | no | natural size, ~96 dpi |
| 5952 | Build | 1× | no | natural size, ~96 dpi |
| 4328 | Plot | fixed 380×270 | no | natural size, ~96 dpi |
| 7236 | Assay plot | fixed 380×270 | no | natural size, ~96 dpi |
| 2579 | **PPTX export** | 3× | n/a | **not a Word insert — leave alone** |

**Do not route 2579 through the shared helper.** Its base64 feeds
`buildTablePptx` and becomes a `.pptx` download; 3× is correct there because the
image is embedded at explicit dimensions in the slide. Changing it is a
regression, not a fix.

**Where.** `src/taskpane/taskpane.ts`, helper next to `svgToPngBase64` (:7892).

```ts
const FIGURE_SCALE = 4; // 4x ≈ 384 dpi at natural size
async function insertFigure(range, svg, w, h, alt) {
  const b64 = await svgToPngBase64(svg, w * FIGURE_SCALE, h * FIGURE_SCALE);
  const pic = range.insertInlinePictureFromBase64(b64, Word.InsertLocation.after);
  pic.altTextDescription = alt;
  pic.width  = w * 0.75;   // px → points, natural size
  pic.height = h * 0.75;
  return pic;
}
```

**Done when.** The eleven Word-insertion sites call one helper, one constant
controls scale, and a spectrum inserted into a fresh document is the same
physical width as a v1.87.0 spectrum but sharp at 400% zoom.

**Risk.** Memory. A 4× canvas of a dense flowchart is 16× the pixels. Measure the
largest Table → Chart output and the widest sequence map before committing to 4×;
drop to 3× if the pane stalls. The chunked base64 encoder already anticipates
large figures.

**Ships to users.** Needs a version bump and the full bug test before deploy.

---

### [ ] 2. Retire "Formula Inserter" from everything a user sees (S)

The first thing a new user reads, and it undersells the product by twenty-two
tools. Word of mouth is the only distribution a free tool has.

**Where.** `install/formula-inserter-windows.zip`, `install/formula-inserter-mac.zip`,
`scripts/package.ps1` (generates both names), the `INSTALL.md` inside each pack,
`%LOCALAPPDATA%\FormulaInserter` in `install.ps1`, `DISTRIBUTION.md`, and
`package.json` `"name": "word-chem-formula"`.

**Careful — verified risk.** There are at least five `formula-inserter:*`
content-control tag prefixes written into users' documents:
`:tablechart` (:2418), `:equation` (:3187), `:structure` (:3232, :3448),
`:callout:*` (:3577). Changing the prefix orphans content in files people have
already filed. **Keep the internal prefix; change only what is user-visible.**
If it must change, write the new prefix while continuing to read both.

**Done when.** Nothing user-visible says "Formula Inserter", and `install.ps1`
removes the old `%LOCALAPPDATA%\FormulaInserter` registration so upgraders do not
end up with two entries under Developer Add-ins.

---

### [ ] 3. Name what JurisLab replaces, on the landing page (S)

The page says "a technical workbench inside Word" and never names a product the
reader is paying for. "Free alternative to ChemDraw" is a phrase people search
for and forward to a colleague. "Technical workbench" is not.

**Where.** `landing/index.html`, hero sub-paragraph and the stat strip.

**How.** One line under the hero, plus a compact "instead of" strip: structures
instead of ChemDraw, analysis instead of MATLAB, curve fitting instead of Prism,
maps and digests instead of SnapGene, authorities instead of Best Authority.

**Careful.** Claim only what is true and say what it does not do. The SnapGene
claim holds for maps, digests and primers, not cloning simulation. Overclaim once
and the offline-and-honest positioning is gone.

**Note.** Run `npm run check:overlap` after — it gates this page.

---

### [x] 4. Reconcile the version story (S) — **done 2026-07-26**

Was three numbers, none agreeing: `package.json` **1.87.0**, `ROADMAP.md` header
**v1.82.0**, `ROADMAP.md` status section **v1.48.5**, with NMR J-coupling and 2D
COSY/HSQC still listed as open six versions after they shipped.

`ROADMAP.md` now reads v1.87.0 throughout, the closed gap is described as closed,
and two gates in `phase6.adversarial.test.ts` hold it there: one fails when the
header release differs from `package.json`, the other fails when shipped work
reappears in the open-candidates section. Both were negative-tested — set the
header to v9.9.9 or reinstate the NMR line and the suite goes red.

---

### [~] 5. Dedicated suites for the modules that lack one (M)

**Correction to the framing.** These modules were described as "untested". None of
them are. Every one is imported and driven by between one and six existing
suites:

| Module | Lines | Dedicated suite | Driven by |
|---|---|---|---|
| `ode.ts` | 840 | **added** | 6 suites |
| `mathParse.ts` | 522 | **added** | 3 suites |
| `fragment.ts` | 451 | no | 3 suites |
| `molgraph.ts` | 404 | no | 3 suites |
| `uvvis.ts` | 340 | no | 2 suites |
| `ir.ts` | 332 | no | 4 suites |
| `formulaLibrary.ts` | 309 | no | 3 suites |
| `matrixExpr.ts` | 269 | no | 2 suites |
| `structures.ts` | 160 | no | 2 suites |
| `fft.ts` | 138 | no | 3 suites |
| `optimize.ts` | 133 | no | 2 suites |
| `modes.ts` | 57 | no | 1 suite |

So the gap is not "untested logic" — it is that the indirect suites drive the
**happy path**, because they exist to check what the emitters and calculators
produce from valid input. The error paths and edge cases are what nothing
reaches. Write dedicated suites for that, not for coverage percentage.

**Done so far.**
- `ode.test.ts` — 16 tests, every assertion against a closed-form solution
  (e^-t, the harmonic oscillator's invariant, a two-species linear system)
  rather than a recorded previous run. Also: tightening rtol must actually
  reduce error, `tEval` lands on requested points, events are located to
  tolerance and the direction filter is proved by comparing against an
  undirected control run, and Van der Pol at mu=1000 bails with
  `stopReason: "stiff"` after 42 steps rather than quietly returning junk.
- `mathParse.test.ts` — 23 tests. Nine on the shape each construct produces
  (notably that `x_1^2` collapses to one `subsup`, since sub-of-sup renders the
  indices wrongly in OMML). Fourteen on the contract in the module header:
  "anything it can't parse throws". Those assert on the *message*, not merely
  that something threw — a `TypeError` from an undefined lookup also throws, the
  caller's fallback still fires, and the user gets "Cannot read properties of
  undefined" where a sentence should be. All twelve malformed inputs produce a
  written `Error`. None leak internals.

**Next, in order.** `fragment.ts` and `molgraph.ts` — most logic, and both feed
user-visible chemistry claims.

**`solve.ts` and `nmr2d.ts` are NOT on this list** — both already have adversarial
suites. See [Corrections](#corrections-to-the-audit).

---

## P1 — The sketcher. The single biggest unlock.

Every chemistry tool requires the user to arrive with a name or a SMILES string.
Chemists arrive with a structure in their head. This is why ChemDraw gets opened.

### [ ] 6. Ketcher spike: prove it works offline in the task pane (M)

**Timebox it.** Do not commit to the integration before knowing it renders in an
Office webview, works with no network, and hands back a usable Molfile.

Ketcher is Apache-2.0 from v2, compatible with shipping inside an MIT project if
the licence and NOTICE are preserved. Imports/exports Molfile, SDF, RDF, SMILES,
SMARTS, InChI, CDXML, FASTA, HELM; exports PNG and SVG; handles stereochemistry,
R-groups, S-groups and reaction editing.

1. Take `ketcher-standalone-X.Y.Z.zip` from the EPAM releases page.
2. Put it under `vendor/` and copy it in `webpack.config.js` beside the existing
   `assets/*` pattern.
3. Hidden `<iframe>` in `taskpane.html`, load the standalone build, call
   `getMolfile()` through the Ketcher JS API.
4. Kill the network in devtools; confirm it still draws, still exports, and makes
   no outbound request.

**Done when.** Draw benzene in the pane, get a Molfile, feed it to the existing
`openchemlib` path, insert the structure — network disabled throughout.

**Answer in the spike.** Bundle size and its effect on pane first paint, which is
the one place a free tool cannot feel heavy. Whether the WASM build is
self-contained for 2D drawing and format conversion or wants the Indigo service.
Whether the iframe behaves in Mac Word's webview as well as Windows. And whether
the narrow pane is the right host at all — a pop-out dialog may be better.

**Plan B.** JSME: much smaller, also free, less capable. Keep it as the fallback
rather than abandoning the sketcher.

---

### [ ] 7. Wire the sketcher into every chemistry tool (M–L)

Once 6 proves out: a second input mode everywhere a name or SMILES box exists —
Chemical, Spectra, Mass Spec, Build, Reaction, Peptide, properties, pKa.

**Done when.** Every chemistry tool has a "draw it" affordance beside the text
input, and Build's atom-and-bond-list entry becomes the fallback, not the primary.

---

### [ ] 8. Structure round-trip from alt text (S–M) — *the sleeper*

`provenanceAltText()` already writes label, formula, MW, SMILES and idcode into
the alt text of every inserted structure. **Nothing reads it back.** Most of a
round-trip is already built and unused.

**How.** Add "edit the selected structure": read the selection, parse the
provenance out of `altTextDescription`, reopen it in the sketcher or the text
input, replace the picture on insert.

**Done when.** A user selects a structure inserted last week, changes a
substituent, reinserts — without retyping the SMILES.

This is the cheapest way to close the gap with Chem4Word, which keeps structures
editable via embedded CML. Same user-visible outcome, from data already written.

---

### [ ] 9. CDXML import (S, once Ketcher lands)

Ketcher reads CDXML, so "a colleague sent me a ChemDraw file" stops being a
reason to buy ChemDraw. Expose as a file input in the Chemical tool.

---

## P2 — Publication-grade output

If the pitch is "you don't need ChemDraw or Prism", the figure has to be
publishable. Item 1 gets resolution to adequate; these get it to good.

### [ ] 10. Vector figure insertion (L)

Word supports SVG through the OOXML `asvg` blip extension: an SVG part plus a PNG
fallback. `insertOoxml` is already used in six places, so the mechanism is
familiar to the codebase.

**Done when.** A structure inserted at 2 inches and scaled to 6 inches in Word
stays sharp.

**Risk.** `asvg` is not honoured by every Word build — the PNG fallback in the
same blip is mandatory. Test Mac Word specifically, and Word on the web if it
matters after item 14.

---

### [ ] 11. Figure controls journals require (M)

`plot.ts` is 324 lines and makes a clean chart. Prism's actual product is a graph
a reviewer accepts. In rough order of how often a reviewer asks:

- Error bars — SD, SEM, 95% CI, with the choice stated in the caption
- Log axes with correct minor ticks
- Significance brackets with asterisks, driven by p-values already computed
- Grouped and stacked categorical layouts
- Consistent typography, serif option so the figure matches the manuscript
- Explicit axis limits and tick intervals

**Where.** `src/lib/plot.ts`, `palettes.ts` (275), `tablechart.ts` (686).

**Done when.** A Bio/Assay dose-response with SEM bars, a log x-axis and an IC50
annotation goes into a manuscript without being redrawn.

---

### [ ] 12. Multi-panel figure assembly (M)

Panels A, B, C in one figure, consistent sizing and labels. This is what turns
three charts into "Figure 2". Prism, Origin and Illustrator get opened for
exactly this.

---

## P3 — Analysis breadth

### [ ] 13. Kaplan–Meier survival curves and the log-rank test (M)

A headline Prism feature with no equivalent here, and not optional for oncology,
clinical or preclinical work. Self-contained, deterministic, well documented, and
it fits the `stats2.ts` idiom exactly.

Survival function with censoring, Greenwood variance for the confidence band,
median survival with CI, log-rank across groups, number-at-risk table, step plot
with censoring ticks.

**Where.** New `src/lib/survival.ts`; plot support in `plot.ts`; tests from a
published worked example so the numbers are checkable.

**Caveat to state in the output.** Log-rank assumes proportional hazards. Say so,
in the voice used for cLogP and predicted spectra.

---

### [ ] 14. Paired and repeated-measures designs (M)

Repeated-measures ANOVA and a paired non-parametric equivalent. The most common
thing a bench scientist runs that `stats2.ts` cannot.

---

## P4 — Reach

### [ ] 15. Verify Word on the web, then decide (S to find out)

`WordApi 1.3` is declared and the web client supports it, but nothing suggests it
has been tested there. If it works: free reach and a zero-install demo to link
from the landing page. If not, you need to know before item 16.

**Check.** The canvas-to-PNG path, `localStorage` in the web webview, file input
for `.dna` and GenBank, and the `.pptx` download.

---

### [ ] 16. Microsoft Marketplace listing (M)

Installation is solved; discovery is not. This is where someone searching
"chemistry add-in for Word" looks, and it brings one-click install, auto-update
and a trust signal a downloaded zip cannot.

Already satisfied: HTTPS via Pages; four-part version `1.87.0.0` in
`manifest.prod.xml`; schema 1.1 validation gated by `npm run validate`; icons 16
through 128.

Still to do: a unique add-in ID distinct from any dev manifest; a public support
URL — **Microsoft explicitly disallows a GitHub repository here**, so point at the
landing page; and replacing the `ADDIN-HOST.example.com` placeholders in
`manifest.prod.xml` with the Pages host, or having `package.ps1` stamp a
marketplace variant.

**Open question.** Listings are reviewed against host support derived from
`<Requirements>`, and there is no manifest element to exclude a host you do not
support. Settle item 15 first or the listing will claim web support you have not
verified.

---

### [ ] 17. Excel as a second host (L)

Analyze, Stats, Finance, Solve and the plotting stack are pure functions over
arrays. Excel is where technical data lives and the audience overlaps almost
perfectly. Add `<Host Name="Workbook"/>` — only `Document` is declared today — a
second entry point, and a thin adapter that reads a range instead of a Word
table. The lib layer should need no changes, which is a good test of how clean
the separation really is.

---

## P5 — Legal completeness

### [ ] 18. USPTO paragraph numbering (S)

Insert `[0001]`-style numbering across a specification, skipping standard
headers, with a configurable header list and a bold option. Verified absent —
nothing in `src/` does this today.

Deterministic, unmissable when wrong, genuinely useful, and not a competitive
claim against anybody. The cheapest legal-side win on this list.

---

## P6 — Explore. Spike before committing.

### [ ] 19. ST.26 DTD validation (M)
Real ST.26 XML with a download already ships. What is missing is the validation
WIPO Sequence performs before filing. Ship the DTD, validate locally. Confirm
first how many users would rather validate in the official tool, since it is free.

### [ ] 20. Reaction balancing and stoichiometry (M)
`chemParser.ts` (81 lines) validates syntax and handles stoichiometric
coefficients but does not balance. Balancing, limiting reagent, theoretical and
percent yield is standard bench arithmetic and a natural fit beside Reaction.

### [ ] 21. Accessibility pass (S–M)
59 aria attributes and 56 labels across a 1,025-line pane is a good baseline.
**Zero `alt` attributes**, and no explicit focus management. Worth one pass with a
screen reader, since the audience lives in these tools all day.

### [ ] 22. BibTeX and RIS import with numbered bibliographies (M)
ACS, Nature, Vancouver, IEEE. All local parsing and formatting, which this
codebase is good at. **Lower priority than it looks** — Zotero is free, excellent
and already has a Word plugin. A completeness argument, not a cost-saving one.

### [ ] 23. Localisation (L)
English only. EPO, UKIPO and JPO practice is a real market. The blocker is that
Bluebook and US ST.26 practice are baked into the legal tools, so scope this as
translating the science side first.

### [ ] 24. Structure to name (L, probably not worth it)
Name → structure exists via the opt-in OPSIN path. The reverse is much harder
offline with no obvious permissively-licensed engine. Explore, expect to conclude
no.

---

## Explicitly not building

Recorded so the decision does not get relitigated.

1. **Claim analysis** — antecedent basis, claim word support, dependency
   validation. ClaimMaster and Patent Bots sell this with years of false-positive
   tuning. A half-good antecedent checker is worse than none, because
   practitioners stop trusting the whole product. Item 18 is the exception and is
   not a competitive claim.
2. **Cloud AI.** Both patent vendors added LLM features in 2026, which leaves the
   provably-offline position empty. It is worth more than a chat box.
3. **A second network exception.** One opt-in exception with explicit consent
   survives a security review. Two starts an argument.
4. **MATLAB depth** — BVP, PDE, DAE, Simulink. Months of work for people who
   already own MATLAB. `ROADMAP.md` already declines this and is right.
5. **SnapGene's cloning workflow** — assembly design, ligation simulation,
   construct history. A different product from document authoring.
6. **FID processing** — phasing, baseline correction, peak picking from raw
   instrument data. MestReNova's actual product.
7. **Migrating settings off `localStorage`.** Audited: the only use is the palette
   accordion's open/closed state (`taskpane.ts:1505–1518`). That is UI state and
   *should* be machine-local. `Office.context.document.settings` would be wrong
   here. No work needed.

---

## Suggested order

1. **Items 1, 2, 3, 4** — one weekend. Item 1 first: it is the only thing on this
   list that changes what already-shipped users experience, and it needs a version
   bump plus the full bug test.
2. **Item 5**, incrementally, `ode.ts` and `mathParse.ts` first.
3. **Item 6**, the Ketcher spike. Timebox it — the answer reshapes the roadmap
   either way, so get it early.
4. If 6 succeeds: **7, 8, 9**. This is the quarter that matters.
5. **Item 15**, which gates **16**.
6. **Items 11 and 13** — the Prism story.
7. **Items 10, 17** after that.

Item 8 is the sleeper: small, uses data already written, and "edit the structure
you inserted last week" is the kind of thing users tell each other about.

---

## Corrections to the audit

An earlier draft of this list contained five claims that do not survive contact
with the source. Recorded so they are not reintroduced.

1. **"Emit Word `TA` fields so the Table of Authorities updates" — already built.**
   `buildNativeToaHandler()` (`taskpane.ts:7483`) marks every citation with a
   hidden TA field via OOXML, inserts one TOA field per category at the cursor,
   wraps them in a tagged content control, and falls back to the static list with
   an explanatory message when WordApi 1.3 is unavailable. The static table is
   already retained as an option — which the draft proposed as new work. This was
   scored **P5 (M)**; it is done.

2. **"`solve.ts` — 912 lines, no test file" — false.**
   `src/lib/__tests__/solve.adversarial.test.ts` exists, 302 lines, and does cover
   the cannot-parse path. The 912-line count is correct; the conclusion was not.

3. **"`nmr2d.ts` untested" — false.** `nmr2d.adversarial.test.ts`, 220 lines. The
   untested list is twelve modules, not thirteen.

4. **The figure-sizing table had two rows swapped.** Line 2579 (3×) was described
   as an oversized Table → Chart path; it is the PPTX export, never inserted into
   Word, and 3× is correct there. Line 5840 (1×) was described as "PPT export,
   not inserted into Word"; it *is* a Word insertion. Acting on the draft would
   have regressed PowerPoint output while missing a Word one.

5. **"Migrate settings off `localStorage`" — a non-issue.** Five references, two
   functional, all storing palette accordion open/closed state. Correctly
   machine-local. Moved to *Explicitly not building*.

6. **"Thirteen untested modules" — none of them are untested.** Every module on
   that list is imported and driven by between one and six existing suites; what
   they lack is a *dedicated* suite. The distinction matters, because it changes
   what the work is for: not coverage, but the error paths the happy-path
   indirect tests never reach. Item 5 carries the corrected table.

The pattern is worth noting: every one of these was a claim about **absence** —
no test file, no field support, no resize, no coverage. Absence is the expensive
thing to assert, because a grep that finds nothing looks identical whether the
feature is missing, named something else, or reached through another module.
Four of the six corrections above are that same mistake.
