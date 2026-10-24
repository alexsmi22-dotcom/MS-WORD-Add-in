/// <reference types="office-js" />
/**
 * Word transactions that put content at the selection (docs/SCOPE-HOST-ADAPTER.md,
 * Kind 1). Each function is ONE Word.run, moved from taskpane.ts unchanged in
 * the calls it makes and the order it makes them.
 */
import type { SelectionInsert } from "./host";
import { blockTarget, isMultiBlockOoxml, tagInserted, wordLocation } from "./wordShared";

export async function insertAtSelection(o: SelectionInsert): Promise<void> {
  await Word.run(async (context) => {
    const range = context.document.getSelection();
    let loc = wordLocation(o.at);
    // A block of its own (a multi-paragraph package, or a caller's own paragraph) never joins the cursor's paragraph
    // (fix2-plat, wordShared blockTarget). A "replace" of a real selection still replaces what the user selected.
    let target: Word.Range = range;
    if (o.kind === "ooxml" && (o.ownParagraph || isMultiBlockOoxml(o.content))) {
      let collapsed = true;
      if (o.at === "replace") {
        range.load("isEmpty");
        await context.sync();
        collapsed = range.isEmpty === true;
      }
      if (collapsed) {
        const t = await blockTarget(context, range);
        target = t.range;
        loc = t.at;
      }
    }
    const inserted =
      o.kind === "html"
        ? range.insertHtml(o.content, loc)
        : o.kind === "ooxml"
          ? target.insertOoxml(o.content, loc)
          : range.insertText(o.content, loc);
    if (o.select === "inserted") inserted.select(Word.SelectionMode.end);
    else if (o.select === "selection") range.select(Word.SelectionMode.end);
    await context.sync();
    if (o.tag) await tagInserted(context, inserted, o.tag);
  });
}

export async function insertHeadedBlockBefore(o: { heading: string; html: string; tag: string }): Promise<void> {
  await Word.run(async (context) => {
    const sel = context.document.getSelection();
    const heading = sel.insertParagraph(o.heading, Word.InsertLocation.before);
    try {
      heading.styleBuiltIn = Word.BuiltInStyleName.heading2;
    } catch {
      // Style not available on this build — leave default paragraph styling.
    }
    const tablePara = sel.insertParagraph("", Word.InsertLocation.before);
    const tableRange = tablePara.getRange().insertHtml(o.html, Word.InsertLocation.replace);
    await context.sync();
    await tagInserted(context, tableRange, o.tag);
  });
}

export async function insertCaptionParagraph(o: { text: string; tag: string }): Promise<void> {
  await Word.run(async (context) => {
    const sel = context.document.getSelection();
    const para = sel.insertParagraph(o.text, Word.InsertLocation.after);
    try {
      para.styleBuiltIn = Word.BuiltInStyleName.caption;
    } catch {
      // Caption style unavailable on this build — leave default styling.
    }
    para.getRange().select(Word.SelectionMode.end);
    await context.sync();
    await tagInserted(context, para.getRange(), o.tag);
  });
}

/**
 * A new paragraph after the selection's, filled with a one-paragraph package (a caption with its fields, a table of
 * figures). Made as the plain caption is (insertParagraph, then the content into it) — insertOoxml "After" a whole
 * paragraph can merge the package into the next paragraph — and styled by Word's built-in name, since a localized
 * Word's Caption style id is not "Caption" (release A review).
 */
export async function insertParagraphOoxmlAfter(o: { ooxml: string; tag: string; caption?: boolean }): Promise<void> {
  await Word.run(async (context) => {
    const para = context.document.getSelection().insertParagraph("", Word.InsertLocation.after);
    para.getRange().insertOoxml(o.ooxml, Word.InsertLocation.replace);
    // After the fill, so it wins over the package's own style id; a table of figures is Normal, not whatever the
    // cursor's paragraph was (a heading).
    try {
      para.styleBuiltIn = o.caption ? Word.BuiltInStyleName.caption : Word.BuiltInStyleName.normal;
    } catch {
      // Built-in styles unavailable on this build — leave the styling as inserted.
    }
    para.getRange().select(Word.SelectionMode.end);
    await context.sync();
    await tagInserted(context, para.getRange(), o.tag);
  });
}
