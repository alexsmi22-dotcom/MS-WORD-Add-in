/// <reference types="office-js" />
/**
 * Word transactions that edit the document as a whole: paragraph numbering,
 * Id./supra detection, the Table of Contents, both Tables of Authorities, field
 * clean-up, and citation markers with the bibliography
 * (docs/SCOPE-HOST-ADAPTER.md, Kind 4).
 *
 * Each function is ONE Word.run, moved from taskpane.ts unchanged in the calls
 * it makes and the order it makes them — these are the batches whose single
 * Ctrl+Z matters most (a TOA build marks every citation, a renumber rewrites
 * every marker). The decisions inside them were already pure library calls
 * (toa.ts, toaScope.ts, bibPane.ts); they run here, between the reads and the
 * writes, exactly where they ran before. What used to be pane text is returned
 * as a REPORT, and the pane words it.
 */
import type {
  BibInsertPlan,
  BibUpdateOpts,
  BibUpdateReport,
  NativeToaReport,
  ParagraphMark,
  StaticToaReport,
} from "./host";
import { tagInserted, wordApiSupported } from "./wordShared";
import { stripParagraphNumber } from "../lib/paragraphs";
import {
  authoritiesForToa,
  buildTableOfAuthorities,
  isTaFieldCode,
  isTableFieldCode,
  parseToaPages,
  taFieldOoxml,
  taSearchPlan,
  TaSearchStep,
  toaFieldsOoxml,
  toaOccurrenceReport,
  ToaRefusal,
  toaStaticOoxml,
  toaToHtml,
  tocFieldOoxml,
} from "../lib/toa";
import { blankSpans, hasVisibleText, isTableOfAuthoritiesFieldCode, locateBlock, typedToaSpans } from "../lib/toaScope";
import { collectCitations, CiteControl, MarkerRun, planUpdate } from "../lib/bibPane";
import { getStyle } from "../lib/bibStyles";
import { BibStoreData, BIBLIOGRAPHY_TAG } from "../lib/bibStore";

/** Tag on the content control that wraps the field-based TOA, so the formatted
 *  list can find it, copy its F9'd page numbers, and replace it in one step.
 *  Documents already carry it: never change the string. */
export const TOA_FIELD_CC_TAG = "jurislab:toafield";

/**
 * Best-effort: set the given built-in style names to Times New Roman 12 pt so
 * Word's generated TOC/TOA entries match the court-brief template. Word builds
 * field entries with these styles, so direct formatting on the field alone
 * won't reach them — the style font must be set. Isolated + guarded: if styles
 * aren't accessible on this build, the tables are left in the default font.
 */
async function setTableStylesToTimesNewRoman(context: Word.RequestContext, styleNames: string[]): Promise<void> {
  if (!wordApiSupported("1.5")) return;
  try {
    const styles = context.document.getStyles();
    styles.load("items/nameLocal");
    await context.sync();
    let changed = false;
    for (const name of styleNames) {
      const style = styles.items.find((s) => s.nameLocal === name);
      if (!style) continue;
      style.font.name = "Times New Roman";
      style.font.size = 12;
      changed = true;
    }
    if (changed) await context.sync();
  } catch {
    // Styles not accessible here — leave the tables in the default font.
  }
}

// ---- paragraph numbering ------------------------------------------------------

/** Writes the previewed paragraph marks: one insertText per marked paragraph, one closing sync. */
export async function applyParagraphMarks(items: ParagraphMark[]): Promise<void> {
  await Word.run(async (context) => {
    const paras = context.document.body.paragraphs;
    paras.load("items/text");
    await context.sync();

    for (const item of items) {
      if (!item.mark) continue;
      const p = paras.items[item.index];
      if (!p) continue;
      if (item.removeExisting) {
        // Renumbering: rewrite the paragraph without its old mark rather than
        // stacking a second one in front of it.
        p.insertText(item.mark + " " + stripParagraphNumber(p.text), Word.InsertLocation.replace);
      } else {
        p.insertText(item.mark + " ", Word.InsertLocation.start);
      }
    }
    await context.sync();
  });
}

// ---- short forms: Id. and supra ------------------------------------------------

/** The text from the start of the document to the selection. */
export async function readTextBeforeCursor(): Promise<string> {
  let text = "";
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const before = context.document.body.getRange(Word.RangeLocation.start).expandTo(selection);
    before.load("text");
    await context.sync();
    text = before.text;
  });
  return text;
}

/**
 * Reads the text before the cursor and, in the SAME batch, replaces the
 * selection with what `decide` returns for it (caret at its end, then tagged),
 * or inserts nothing when it returns null. Returns whether anything went in.
 */
export async function replaceSelectionFromTextBefore(
  decide: (textBefore: string) => { html: string; tag: string } | null,
): Promise<boolean> {
  let inserted = false;
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const before = context.document.body.getRange(Word.RangeLocation.start).expandTo(selection);
    before.load("text");
    await context.sync();
    const what = decide(before.text);
    if (!what) return;
    const range = selection.insertHtml(what.html, Word.InsertLocation.replace);
    range.select(Word.SelectionMode.end);
    await context.sync();
    await tagInserted(context, range, what.tag);
    inserted = true;
  });
  return inserted;
}

// ---- fields: TOC, and clean-up --------------------------------------------------

/** A Table of Contents field (Heading 1–3) at the cursor, then the TOC styles set to Times New Roman 12. */
export async function insertTocField(): Promise<void> {
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.insertOoxml(tocFieldOoxml(3), Word.InsertLocation.replace);
    await context.sync();
    // Make Word's generated TOC entries Times New Roman 12 (court-brief template).
    await setTableStylesToTimesNewRoman(context, ["TOC 1", "TOC 2", "TOC 3"]);
  });
}

/**
 * Deletes the body's TA (citation) fields, or its TOC/TOA table fields.
 * Returns how many were deleted; 0 means none were found and nothing changed.
 */
export async function deleteBodyFields(kind: "citationMarks" | "tables"): Promise<number> {
  let count = 0;
  await Word.run(async (context) => {
    const fields = context.document.body.fields;
    fields.load("items/code");
    await context.sync();
    const doomed = fields.items.filter((f) => (kind === "citationMarks" ? isTaFieldCode(f.code) : isTableFieldCode(f.code)));
    if (!doomed.length) return;
    for (const f of doomed) f.delete();
    await context.sync();
    count = doomed.length;
  });
  return count;
}

// ---- the field-based Table of Authorities ----------------------------------------

/**
 * Builds a native Word Table of Authorities: marks each citation with a hidden
 * TA field, then inserts TOA fields at the cursor. ONE batch, so one Ctrl+Z
 * takes the whole build back. The report says what was and was not marked.
 */
export async function buildNativeToa(): Promise<NativeToaReport> {
  let result: NativeToaReport = { kind: "noCitations", notesScanned: false, footnoteCount: 0, endnoteCount: 0 };
  await Word.run(async (context) => {
    const body = context.document.body;

    // THE STORIES TO SCAN. document.body is the MAIN text only: footnotes and
    // endnotes are separate bodies (WordApi 1.5), and body.text / body.search
    // never see them. Patent briefs cite heavily in footnotes, so read them
    // when Word can, and SAY so when it cannot. Headers and footers are never
    // scanned (a TOA does not list them), and the message says that too.
    const stories: Array<{ kind: "main" | "footnote" | "endnote"; body: Word.Body }> = [{ kind: "main", body }];
    let notesScanned = false;
    if (wordApiSupported("1.5")) {
      try {
        const footnotes = body.footnotes;
        const endnotes = body.endnotes;
        footnotes.load("items");
        endnotes.load("items");
        await context.sync();
        for (const n of footnotes.items) stories.push({ kind: "footnote", body: n.body });
        for (const n of endnotes.items) stories.push({ kind: "endnote", body: n.body });
        notesScanned = true;
      } catch {
        notesScanned = false; // the API set is claimed but the call failed: disclose, below
      }
    }
    const footnoteCount = stories.filter((s) => s.kind === "footnote").length;
    const endnoteCount = stories.filter((s) => s.kind === "endnote").length;
    const scope = { notesScanned, footnoteCount, endnoteCount };

    for (const s of stories) s.body.load("text");
    await context.sync();
    if (!authoritiesForToa(stories.map((s) => s.body.text).join("\n\n")).length) {
      result = { kind: "noCitations", ...scope };
      return;
    }

    // Clear any existing TA marks first (main text AND notes), so stale or
    // malformed marks (e.g. a corrupted "CONCLUSION…" entry) can't survive
    // into the rebuilt table. Word's OWN Table of Authorities (a TOA field,
    // References ▸ Insert Table of Authorities) is read in the same pass: its
    // result text is a list of every authority and must not be scanned.
    const wordToaTexts: string[] = [];
    if (wordApiSupported("1.4")) {
      const fieldSets = stories.map((s) => {
        const f = s.body.fields;
        f.load("items/code");
        return f;
      });
      await context.sync();
      for (const set of fieldSets) for (const f of set.items) if (isTaFieldCode(f.code)) f.delete();
      const wordToas = fieldSets[0].items.filter((f) => isTableOfAuthoritiesFieldCode(f.code));
      const results = wordToas.map((f) => {
        const r = f.result;
        r.load("text");
        return r;
      });
      await context.sync();
      for (const r of results) wordToaTexts.push(r.text);
    }

    // Re-read every story AFTER the delete, and derive the marks and the
    // occurrences from that same text: the search plan below counts Word's
    // hits against it, so it must be the text Word will now search.
    for (const s of stories) s.body.load("text");
    const oldTables = [TOA_FIELD_CC_TAG, "formula-inserter:toa"].map((tag) => {
      const ccs = body.contentControls.getByTag(tag);
      ccs.load("items/text");
      return ccs;
    });
    await context.sync();
    const bodyText = body.text;

    // Blank every earlier table out of the SCANNED main text, keeping every
    // offset (blankSpans): this pane's tables (tagged content controls),
    // Word's TOA field result, and a table typed under a "TABLE OF
    // AUTHORITIES" heading. Their entries must not become marks, nor the
    // antecedent of the argument's first "Id.". The search plan still counts
    // Word's hits against the REAL text, table included (those hits get null).
    // A table that cannot be located is COUNTED and reported, never ignored.
    const tableSpans: Array<[number, number]> = [];
    let tablesNotLocated = 0;
    const tableTexts = [...oldTables.flatMap((ccs) => ccs.items.map((cc) => cc.text)), ...wordToaTexts];
    for (const t of tableTexts) {
      if (!hasVisibleText(t)) continue;
      const span = locateBlock(bodyText, t);
      if (span) tableSpans.push(span);
      else tablesNotLocated++;
    }
    let scanText = blankSpans(bodyText, tableSpans);
    const typed = typedToaSpans(scanText);
    scanText = blankSpans(scanText, typed.spans);

    const scanTexts = stories.map((s, i) => (i === 0 ? scanText : s.body.text));
    const marks = authoritiesForToa(scanTexts.join("\n\n"));
    if (!marks.length) {
      result = { kind: "noCitationsOutsideTable", ...scope };
      return;
    }

    // Word searches by STRING and returns hits in document order, not
    // offsets. taSearchPlan turns the offsets into an ORDINAL plan: for each
    // needle, the k-th Word hit belongs to mark assign[k], or is skipped
    // (null) — the "10 F.3d 5" inside "110 F.3d 512", or a hit another needle
    // owns. Ownership is per HIT, so an "Id." meaning Alice on one page and
    // Mayo on another goes under both. Searches are case-sensitive
    // (TA_SEARCH_OPTIONS), so "Id." never hits the "id." in "said.".
    // Each story gets its OWN plan and its own searches: an Id. is resolved
    // only inside its story, so one that opens a footnote has no antecedent
    // and is refused by the engine ("no citation precedes it") — reported,
    // not guessed.
    let unattributed = 0;
    const refused: ToaRefusal[] = [];
    const searches: Array<{ step: TaSearchStep; results: Word.RangeCollection }> = [];
    stories.forEach((story, i) => {
      // Full forms AND short forms AND Id. — resolved against the text by
      // offset, which is the only way "Id. at 79" can be attributed at all.
      // The engine also returns, by name, what it deliberately did NOT place
      // (an Id. after a record cite or opening a note, a "§§" member that may
      // be a claim count); every one of those is reported.
      const report = toaOccurrenceReport(scanTexts[i], marks);
      const occ = report.occurrences;
      refused.push(...report.refused);
      const plan = taSearchPlan(story.body.text, occ);
      unattributed += plan.unplaced.length;
      // Run EVERY search and load its hits BEFORE the first insert: an
      // inserted TA field's \l text contains the needle, and a search run
      // after it would count the field as an extra hit.
      for (const step of plan.steps) {
        const results = story.body.search(step.needle, step.options);
        results.load("items/text");
        searches.push({ step, results });
      }
    });
    await context.sync();

    // Mark every occurrence of each authority with a hidden TA field, so the
    // table shows the full page range (Word aggregates pages by the \l text).
    // Citations that cannot be placed are COUNTED and declared, never guessed:
    // a needle too long for Word's search, or one whose hit count in Word
    // disagrees with the text it was planned from.
    let occurrences = 0;
    const categoryNums = new Set<number>();
    const markedAuthorities = new Set<number>();
    for (const { step, results } of searches) {
      if (results.items.length !== step.expectedHits) {
        unattributed += step.assign.filter((m) => m !== null).length;
        continue;
      }
      results.items.forEach((hit, k) => {
        const markIndex = step.assign[k];
        if (markIndex === null) return;
        const mark = marks[markIndex];
        hit.insertOoxml(taFieldOoxml(mark.name, mark.rest, mark.categoryNum, mark.html), Word.InsertLocation.before);
        categoryNums.add(mark.categoryNum);
        markedAuthorities.add(markIndex);
        occurrences++;
      });
    }
    const authoritiesMarked = markedAuthorities.size;
    await context.sync();
    // Insert the TOA fields (one per marked category) at the cursor, wrapped in
    // a tagged content control so the "formatted list" button can find this
    // exact block, copy its F9'd page numbers, and replace it cleanly.
    const selection = context.document.getSelection();
    const toaRange = selection.insertOoxml(toaFieldsOoxml([...categoryNums]), Word.InsertLocation.replace);
    await context.sync();
    try {
      const cc = toaRange.insertContentControl();
      cc.tag = TOA_FIELD_CC_TAG;
      cc.title = "JurisLab TOA (field — will be replaced)";
      await context.sync();
    } catch {
      // Content controls unsupported here — the field table is still usable.
    }
    // Make Word's generated entries Times New Roman 12 (court-brief template).
    await setTableStylesToTimesNewRoman(context, ["Table of Authorities"]);
    result = {
      kind: "built",
      ...scope,
      authoritiesMarked,
      marksFound: marks.length,
      occurrences,
      unattributed,
      refused,
      tablesNotLocated,
      typedEndedBy: typed.endedBy,
      typedUnbounded: typed.unbounded,
    };
  });
  return result;
}

// ---- the static (formatted) Table of Authorities ----------------------------------

/**
 * Scans the document and inserts a grouped Table of Authorities: OOXML (with
 * page numbers read from an F9'd field TOA) where Word supports it, HTML where
 * not. A field table built earlier is REPLACED in place; otherwise the table
 * goes at the cursor and is tagged.
 */
export async function buildStaticToa(): Promise<StaticToaReport> {
  let report: StaticToaReport = { total: 0 };
  await Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    const toa = buildTableOfAuthorities(body.text);
    if (!toa.total) return;
    // Pull page numbers from an existing built field-TOA, if present.
    const pages = parseToaPages(body.text);
    const ooxml = wordApiSupported("1.3") ? toaStaticOoxml(toa, pages) : null;

    // If a field table from "Insert with live page numbers" is present, replace
    // that exact block (its title, headings, and fields) with the formatted
    // list — so nothing is left behind to clean up.
    let replacedField = false;
    const ccs = context.document.contentControls.getByTag(TOA_FIELD_CC_TAG);
    ccs.load("items");
    await context.sync();
    const fieldCc = ccs.items[0];

    let inserted: Word.Range;
    if (fieldCc && ooxml) {
      inserted = fieldCc.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
      try {
        fieldCc.delete(true); // remove the wrapper, keep the new formatted content
        await context.sync();
      } catch {
        /* wrapper removal best-effort */
      }
      replacedField = true;
    } else {
      const range = context.document.getSelection();
      inserted = ooxml
        ? range.insertOoxml(ooxml, Word.InsertLocation.replace)
        : range.insertHtml(toaToHtml(toa), Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:toa");
    }
    report = {
      total: toa.total,
      groups: toa.groups.map((g) => ({ heading: g.heading, count: g.entries.length })),
      pagesFilled: pages.size,
      replacedField,
    };
  });
  return report;
}

// ---- citation markers and the bibliography ------------------------------------------

/** Writes a marker's runs into its control, formatting each run explicitly. */
function writeMarkerRuns(cc: Word.ContentControl, runs: MarkerRun[]): void {
  const list = runs.length ? runs : [{ text: "", sup: false, sub: false, italic: false, bold: false }];
  list.forEach((r, i) => {
    const range = cc.insertText(r.text, i === 0 ? Word.InsertLocation.replace : Word.InsertLocation.end);
    range.font.superscript = r.sup;
    range.font.subscript = r.sub;
    range.font.italic = r.italic;
    range.font.bold = r.bold;
  });
}

/**
 * Renumbers every citation and rewrites the bibliography inside the caller's
 * Word.run. Returns what it did, for the pane to report.
 */
async function applyBibUpdate(context: Word.RequestContext, store: BibStoreData, opts: BibUpdateOpts): Promise<BibUpdateReport> {
  const style = getStyle(store.style);
  const body = context.document.body;
  const ccs = body.contentControls;
  ccs.load("items/tag,items/text");
  await context.sync();
  // Footnotes are not in body.contentControls (§C4); WordApi 1.5 reads them.
  let noteControls: Word.ContentControl[] | null = null;
  if (wordApiSupported("1.5")) {
    try {
      const notes = body.footnotes;
      notes.load("items");
      await context.sync();
      const cols = notes.items.map((n) => {
        const c = n.body.contentControls;
        c.load("items/tag,items/text");
        return c;
      });
      await context.sync();
      noteControls = [];
      for (const c of cols) noteControls.push(...c.items);
    } catch {
      noteControls = null;
    }
  }
  const asCite = (c: Word.ContentControl): CiteControl => ({ tag: c.tag, text: c.text });
  const collected = collectCitations(
    ccs.items.map(asCite),
    noteControls ? noteControls.map(asCite) : null,
    style ? style.kind : "numeric",
  );
  const up = planUpdate(collected, store, { rewriteAll: opts.rewriteAll });
  if (!up.ok) return { ok: false, reason: up.reason };
  for (const rw of up.rewrites) {
    const w = collected.where[rw.index];
    const cc = w.in === "body" ? ccs.items[w.index] : noteControls ? noteControls[w.index] : undefined;
    if (cc) writeMarkerRuns(cc, rw.runs);
  }
  let bibliography: Extract<BibUpdateReport, { ok: true }>["bibliography"] = null;
  const bibs = ccs.items.filter((c) => c.tag === BIBLIOGRAPHY_TAG);
  if (bibs.length) {
    bibs[0].insertOoxml(up.ooxml, Word.InsertLocation.replace);
    bibliography = { kind: "replaced", references: up.plan.bibliography.length, blocks: bibs.length };
  } else if (opts.bibliography === "always" && up.plan.entries.length) {
    const inserted = body.insertOoxml(up.ooxml, Word.InsertLocation.end);
    const cc = inserted.insertContentControl();
    cc.tag = BIBLIOGRAPHY_TAG;
    cc.title = "JurisLab bibliography";
    bibliography = { kind: "inserted", references: up.plan.bibliography.length };
  }
  await context.sync();
  return {
    ok: true,
    rewrites: up.rewrites.length,
    occurrences: collected.occurrences.length,
    bibliography,
    report: up.report,
  };
}

/** Update numbering & bibliography: one pass over every citation, then the bibliography block. One batch. */
export async function updateBibliography(store: BibStoreData, opts: BibUpdateOpts): Promise<BibUpdateReport> {
  let res: BibUpdateReport = { ok: false, reason: "" };
  await Word.run(async (context) => {
    res = await applyBibUpdate(context, store, opts);
  });
  return res;
}

/**
 * Insert citation: reads the citation control the cursor is in, asks the pane's
 * plan what to do with that tag, and — in the SAME batch — writes a new tagged
 * marker (in a new footnote for a note style) and renumbers everything.
 * Returns the plan's refusal lines, or the update report.
 */
export async function insertBibCitation(
  o: { isNote: boolean; plan: (existingTag: string | null) => BibInsertPlan; update: () => BibUpdateOpts },
): Promise<{ refused: string[] } | { kind: "new" | "add"; store: BibStoreData; update: BibUpdateReport }> {
  let out: { refused: string[] } | { kind: "new" | "add"; store: BibStoreData; update: BibUpdateReport } = { refused: [] };
  await Word.run(async (context) => {
    const sel = context.document.getSelection();
    const parent = sel.parentContentControlOrNullObject;
    parent.load("tag");
    await context.sync();
    const plan = o.plan(parent.isNullObject ? null : parent.tag);
    if (!plan.ok) {
      out = { refused: plan.lines };
      return;
    }
    if (plan.kind === "new") {
      const placeholder = "…";
      const range = o.isNote
        ? sel.insertFootnote("").body.insertText(placeholder, Word.InsertLocation.end)
        : sel.insertText(placeholder, Word.InsertLocation.end);
      const cc = range.insertContentControl();
      cc.tag = plan.tag;
      cc.title = plan.title;
      await context.sync();
    }
    const update = await applyBibUpdate(context, plan.store, o.update());
    out = { kind: plan.kind, store: plan.store, update };
  });
  return out;
}

/**
 * Updates the body's numbering fields so captions, equation numbers, cross-references and tables of figures show
 * their current values — what F9 does (docs/SCOPE-CAPTIONS.md). Only SEQ and STYLEREF (the numbers), then REF and
 * TOC (what reads them): never a DATE, an ASK or FILLIN that would prompt, or a citation manager's ADDIN field
 * (release A review). Field.updateResult is WordApi 1.5; where Word lacks it, "unsupported" (the pane says to press
 * F9); a Word that refuses mid-way is "failed".
 */
export async function updateBodyFields(): Promise<"updated" | "unsupported" | "failed"> {
  if (!wordApiSupported("1.5")) return "unsupported";
  try {
    await Word.run(async (context) => {
      const fields = context.document.body.fields;
      fields.load("items/code");
      await context.sync();
      const kind = (code: string): string => (/^\s*(SEQ|STYLEREF|REF|PAGEREF|TOC)\b/i.exec(code)?.[1] ?? "").toUpperCase();
      for (const f of fields.items) if (kind(f.code) === "SEQ" || kind(f.code) === "STYLEREF") f.updateResult();
      await context.sync();
      for (const f of fields.items) if (["REF", "PAGEREF", "TOC"].includes(kind(f.code))) f.updateResult();
      await context.sync();
    });
    return "updated";
  } catch {
    return "failed";
  }
}

/**
 * The current text of each named bookmark (null for one the document no longer holds) — a caption's number as Word
 * shows it now. WordApi 1.4; where Word does not have it, null for the whole call.
 */
export async function heading1Numbering(): Promise<"numbered" | "unnumbered" | "none" | "unknown"> {
  if (!wordApiSupported("1.3")) return "unknown";
  try {
    return await Word.run(async (context) => {
      const paras = context.document.body.paragraphs;
      paras.load("items/styleBuiltIn");
      await context.sync();
      // At most 200 headings are asked about (a bounded batch); one unnumbered Heading 1 is enough to refuse.
      const h1 = paras.items.filter((p) => p.styleBuiltIn === Word.BuiltInStyleName.heading1).slice(0, 200);
      if (!h1.length) return "none";
      const lists = h1.map((p) => {
        const li = p.listItemOrNullObject;
        li.load("listString");
        return li;
      });
      await context.sync();
      // Numbered = every Heading 1 has a list string with a digit or roman numeral ("1", "Chapter 2", "IV").
      return lists.every((li) => !li.isNullObject && /[0-9IVXLivxl]/.test(li.listString ?? "")) ? "numbered" : "unnumbered";
    });
  } catch {
    return "unknown";
  }
}

export async function readBookmarkTexts(names: string[]): Promise<Record<string, string | null> | null> {
  if (!wordApiSupported("1.4")) return null;
  const out: Record<string, string | null> = {};
  await Word.run(async (context) => {
    const ranges = names.map((n) => {
      const r = context.document.getBookmarkRangeOrNullObject(n);
      r.load("text");
      return r;
    });
    await context.sync();
    names.forEach((n, i) => (out[n] = ranges[i].isNullObject ? null : ranges[i].text));
  });
  return out;
}
