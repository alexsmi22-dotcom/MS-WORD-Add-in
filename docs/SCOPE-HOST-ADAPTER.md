# Scope: the host-adapter refactor (hit-list item 13)

_Written 2026-10-17 against `main` at 5e546e6 (v2.143.0). Line numbers drift; each is given with its function name._

## Why

Every document operation in JurisLab lives in `src/taskpane/taskpane.ts` (34,672 lines). There are 52 `Word.run` batches spread over about 50 handlers, and 204 `Word.` and 41 `Office.` references. That file cannot be imported by any test, because it touches the Office.js globals and the DOM at module scope. As a result:

- **The choreography is untested.** That covers the order of an insert, its size, its alt text, its tag and its selection. The engines have about 10,000 tests; the code that puts their output into a document has none, apart from four hand-made Word mocks in the audit drivers.
- **There is no seam for a second host or a workspace.** Hit-list #10 (workspace) and the Excel host (on hold) would both have to thread through 52 hand-written batches.
- **Parsers buried in the pane cannot be tested.** This is the [taskpane-parsers-are-untestable] lesson.

## The goal, as a measurable end state

1. **No `Word.run` in `taskpane.ts`.** Every document batch lives in `src/host/`, behind one `Host` interface that takes and returns plain data (strings, numbers, records) and never a `Word.Range`.
2. **No `Office.` calls in `taskpane.ts`** except the boot handshake (`Office.onReady`, `Office.HostType`). That means settings, dialogs, `setSelectedDataAsync` and capability probes all move.
3. **A ratchet test pins the counts.** `Word.` and `Office.` references in `taskpane.ts` may only go down, and the target is the allowlisted boot lines.
4. **Pure parsers and formatters move out of `taskpane.ts` into `src/lib`** with tests (inventory in §E).
5. **Behaviour stays byte-identical.** This is a MOVE, never a rewrite. Every batch boundary stays where it is, because one `Word.run` is one Ctrl+Z: the citations renumber, the TOA build and the composite inserts all depend on that. The same goes for the order of each call and each property set, every insert location, every content-control tag (`formula-inserter:*` must not change; existing documents carry them), every `document.settings` key, and every alt-text format.

## A. The instrument comes first: `scripts/host-trace.js`

jest cannot run Office.js and the in-Word passes are the user's, so a site moved wrongly would otherwise be found first in a user's document. The gate (built before any code moved) works like this:

- **Recorder.** `host-trace-recorder.js` is a Proxy-based Office/Word stub. It records every method call with its arguments (strings over 48 chars as length + FNV hash, so one changed byte shows), every property set, every load and sync, every `Word.run` boundary, every `Office` settings, dialog and coercion call, and every network attempt (all fail, as offline).
- **Document fixture.** `host-trace-fixtures.js` supplies a populated document: brief text with authorities, captions, numerals and paragraphs; TA/TOA/TOC fields; a table under the cursor; footnotes; and a dialog that returns a 3D model. Body pictures count up with each insert, like Word's. Without these the data-reading sites would only ever reach their "nothing found" branch.
- **Driver.** `host-trace-driver.js` clicks every Word-facing button in every tool. The button list is derived from the source, not remembered. Seeds (`host-trace-seeds.js`) fill the fields whose buttons refuse on empty input, with `#2`/`#3` variants for second branches.
- **Coverage.** The whole synchronous stack of each `Word.run` is mapped back through the bundle's source map. A site is a `Word.run` line, in the pane or the host, or a pane call into the host (`docHost.method(`). That keeps coverage per CALLER once many callers share one host transaction, which a review of release (a) showed was otherwise lost. **52 of 52 before the move; 58 of 58 after (a)**: 29 pane batches, 6 host batches and 23 pane calls into the host. A green diff over a site the drive never entered would prove nothing.
- **Golden.** The output is `scripts/host-trace.golden.txt`: 73 segments, 1,020 lines.

**Proved before trusting it:**
- **Deterministic.** Three runs in parallel under load were byte-identical to the golden trace.
- **Negative control.** With `replace`→`after` in `insertCodeBlock`, and the gallery's size/alt-text order swapped, both were reported at their exact lines.

**Three harness defects the instrument found in itself, all fixed:**
- Virtual time raced ahead of PNG rasterisation. Segments were cut off mid-insert, so the drive now runs in real time and settles on "button re-enabled and no '…' status".
- A status line cleared by a timer made the trace timing-dependent. The trace now records the last non-empty status per segment.
- `--dump-dom` waits for the virtual-time budget, which a busy page never drains. Results now leave through console chunks and the browser is killed at the end marker.

**Golden provenance.** The golden was re-recorded from untouched `HEAD` (5e546e6) in a separate worktree, with the final gate scripts, and the refactored tree diffs clean against it.

**The contract for every refactor step: `npm run build && node scripts/host-trace.js` must print "trace identical".** A deliberate behaviour change (none is planned) would need `--write` and a sentence in the CHANGELOG saying why.

## B. The `Host` interface

- **`src/host/host.ts`** holds the interface: one method per document TRANSACTION (one `Word.run` today), taking plain data.
- **`src/host/word*.ts`** holds the Word implementation, grouped by domain.
- **Pane decisions that sit between a read and a write inside one batch** (for example "build the TOA from the text just read, then write it") are passed in as pure functions. That keeps the batch whole without letting a Word type cross the interface.
- **Async rasterisation stays before the batch** (the comment at `insertSolveResult` explains why).

What the pane keeps: status text, busy flags, button state, and every message. What the host returns: what Word reported, such as picture counts confirmed, the format stored, and text read.

## C. Inventory: the 52 sites, by kind

**Kind 1. Insert at the selection (HTML, text, OOXML or a table), plus tag and select.** Release (a).
- `insertCodeBlock`
- `insertPeriodic` (text branch)
- `insertBotanicalName`, `insertTraitTable`
- `insertFormattedText`, `insertEquation`
- `insertNumeralList`, `insertCallout`
- `insertAlignmentText`, `insertPlainText`, `insertDerivation`
- `insertQuantity`, `insertConversion`, `insertCaption`
- `insertOrfTable`, `insertSpectrumResult`, `insertCitation`

**Kind 2. Read the document, then decide in the pane.** Release (a).
- `readTableUnderCursor`
- `scanDocumentNumerals`, `checkCaptionsHandler`, `runAudit`
- `previewParagraphNumbers`, `findCitationsHandler`

**Kind 3. Pictures and figures.** Release (b), the riskiest group: sizing from `readSvgDims`, alt text, picture-count confirmation, the vector route.
- `insertGallery`, `insertPeriodic` (figure branch), `insertStructure`, `insertDraw3d`, `insertBuild`
- `insertSolveResult` (figure), `insertReactionBalance` (figure), `insertReaction`
- `insertResultBlocks`
- `insertPeptide`, `insertIsotopeChart`, `insertOverlayChart`, `insertSpectrumChart`, `insertJcampChart`, `insertSeqMap`
- `insertFigure`, `insertFigureVector` (×2)
- `insertEditableWordTable`
- helpers `sizeFigure`, `bodyPictureSignatures`, `setSelectedSvg`, `hostCapability`

**Kind 4. Document-wide edits (fields, content controls, renumbering).** Release (c).
- `applyParagraphNumbers`
- `insertIdForPreceding`, `detectSupraSource`
- `buildNativeToaHandler`, `buildTocHandler`, `buildToaHandler`
- `clearCitationMarksHandler`, `clearTablesHandler`
- `insertBibCitation`, `updateBibliography`
- helpers `renumberInRun`, `writeMarkerRuns`, `tagInserted`, `setTableStylesToTimesNewRoman`

**Kind 5. Office, outside `Word.run`.** Release (c).
- `document.settings`: numerals, refs, bibliography
- the three dialog openers
- the `WordApi` `isSetSupported` probe (`wordApiSupported`)
- `setSelectedDataAsync` and the `ImageCoercion`/`WordApiDesktop` probes already moved in (b), with the vector route

**As shipped in (b), v2.145.0.** 19 batches moved to `src/host/wordFigures.ts`, leaving 10 `Word.run` in the pane, all Kind 4.
- **`insertFigure`'s `after(context, picture)` hook** became a declarative `FigureTail`: a caption line, or Table → Chart's data table. The table rows are passed as a FUNCTION the host calls inside the batch, at the moment the old hook read them. The independent review caught the first version capturing them seconds earlier.
- **`insertResultBlocks`** now PLANS the report (runs, flushes, which formulas typeset, intrinsic sizes in points). The host's `insertResultLayout` PLAYS it in one batch and returns Word's own picture count.
- **The trace drive gained second branches:** the vector success path (mock pictures now have distinct signatures), Table → Chart with its data table, a labelled editable table, and an Engineering report with equations. The golden was re-recorded from the released v2.144.0 code. The legend, gallery and vector-refusal branches are pinned by unit tests in `hostLayer.test.ts`.

**As shipped in (c), v2.146.0. This reaches the end state.**
- **Moves:** the last 10 batches went to `src/host/wordDocument.ts`, and settings, dialogs and the `WordApi` probe to `src/host/officeHost.ts`.
- **Moved verbatim:** the field-based TOA (one batch, one undo) and the bibliography renumbering pass. The library decisions inside them (`toa.ts`, `toaScope.ts`, `bibPane.ts`) still run between the reads and the writes.
- **Reports, not messages:** the host returns reports (`NativeToaReport`, `StaticToaReport`, `BibUpdateReport`), and the pane words every message from them, byte for byte as before.
- **Decisions that read the form mid-batch stay inside it.** Two pane decisions read the form in the middle of the batch: the Id. pin, and Insert citation's locator and plan. They are passed as callbacks that the host calls inside the batch, at the moment the old code ran them.
- **`hostLayer.test.ts` is now a wall, not a count.** In the pane's code (comments stripped) there is no `Word.*` API and no `Word.run`, and `Office` appears only as `Office.onReady` and `Office.HostType`.
- **The trace now records a stack for every Office call too** (settings, dialogs, probes), so a pane call to a synchronous host method is a measured site. The total is **90 of 90**. A seed imports a real Crossref BibTeX export, so Insert citation's marker, renumbering pass and settings save all run. The golden was re-recorded from released v2.145.0, and (c) diffs clean against it.

**Out of scope:**
- **`src/commands/commands.ts`** (10 lines, `Office.onReady` only).
- **`src/drawdialog/drawdialog.ts`** (`messageParent`). That is a dialog page talking to its parent, not document access.
- **`src/lib`.** It was checked with a strict pattern and has no Office.js use.

## D. What else must change with the move

- **The audit harnesses derive the Word enums from `taskpane.ts` alone:** `pane-audit.js`, `engineering-audit.js`, and the figure and render harnesses if they do the same. Once code moves to `src/host`, a missing enum would read as "every tool broken", which has happened before ([harness-reports-itself]). They must scan `src/host` too, in the same change as the first move.
- **46 test files read `taskpane.ts` as text**, and 21 of them assert on Word patterns (about 50 assertions). They switch to one helper that reads the pane plus `src/host/*.ts`, so an assertion follows the code it pins instead of silently passing on its absence.
- **Source-wide invariants scanned only in `taskpane.ts`** (the no-lookbehind rule for old WebKit, and the eol checks) must cover `src/host` too.

## E. Parsers out of `taskpane.ts`

A read-only audit found 345 top-level functions in `taskpane.ts`, of which 71 are pure. Only functions that are pure, and closed under their dependencies, move, and each move gets a direct test.

**Moved in (a):**
- **`lib/financeFigures.ts`:** `finMoney`, `finPct`, `finFixed` and the money-over-time, cash-flow ladder, bond and option figures.
- **`lib/assayFormat.ts`:** `assaySig`, `assayValSE`, `assayPairXY`, `assayLineSvg`.
- **Tests:** they are called directly in `paneMovedHelpers.test.ts`.

**Queued, in dependency order:**
1. `svgSize.ts` (`readSvgDims`, `svgNaturalSize`)
2. `analyzeBlocks.ts`
3. `engReport.ts`
4. `statFields.ts`. It is stateful: the comma log must be returned rather than kept in a module Map.
5. Single moves: `guessMolType`, `resolveElement`, `parseBound`, `registerToText`, `solveFunctionSvg`.

**Found during the audit, NOT changed, because each would be a behaviour change:**
- **`finList` and `assayList`** split on commas. "1,5" becomes two values, which goes against the product's comma rule, and non-numbers are dropped silently.
- **`readSvgDims` matches `\bwidth="`.** That also matches inside `stroke-width="` whenever a root `<svg>` has no width of its own.

Both go to the user.

## F. Releases

| Release | Content |
|---|---|
| v2.144.0 (a) | The instrument, `Host` skeleton, Kind 1 + Kind 2, harness enum fix, test-source helper, ratchet test, first parser batch |
| v2.145.0 (b) | Kind 3, pictures and figures (shipped; see §C) |
| v2.146.0 (c) | Kind 4 + Kind 5; the pane holds no document code (shipped; see §C) |

Each release gets the full QC, an independent adversarial pass aimed at batch boundaries, selection placement and anything the trace cannot see (Word's behaviour itself), then push and live-verify.

## G. What the trace cannot prove

- **That Word honours a call.** The trace proves the pane makes the SAME calls as before, not that they are right. That is acceptable because this refactor's only claim is "no change".
- **Branches the drive does not take inside a reached site.** Examples are the OOXML-rejected fallback in `insertDerivation` and the "Word kept 0 of N figures" message. The recorder accepts every call, so failure branches are under-covered. The adversarial pass reads those branches by hand, before and after.
- **Timing between batches**, such as two batches that must not interleave with a user edit. That is unchanged by a move.
