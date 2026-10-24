/// <reference types="office-js" />
/**
 * Word transactions that put pictures and tables in the document
 * (docs/SCOPE-HOST-ADAPTER.md, Kind 3). Each function is ONE Word.run, moved
 * from taskpane.ts unchanged in the calls it makes and the order it makes them;
 * the pane rasterises, sizes (in points) and words everything beforehand.
 */
import type {
  EditableTableInsert,
  PictureTableInsert,
  FigureInsertWord,
  FigureVectorResult,
  GalleryItem,
  HostCaps,
  LegendedPictureInsert,
  PictureInsert,
  ResultLayoutItem,
} from "./host";
import { tagInserted } from "./wordShared";
import { findInsertedPicture, PictureSignature } from "../lib/insertCapability";
import { prepareEditableTable } from "../lib/tablefigure";

/** One picture after the selection: size, alt text, optional caret move and tag. */
export async function insertPictureAtSelection(o: PictureInsert): Promise<void> {
  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const picture = range.insertInlinePictureFromBase64(o.base64, Word.InsertLocation.after);
    picture.width = o.widthPt;
    picture.height = o.heightPt;
    picture.altTextDescription = o.alt;
    if (o.selectAfter) range.select(Word.SelectionMode.end);
    await context.sync();
    if (o.tag) await tagInserted(context, picture.getRange(), o.tag);
  });
}

/**
 * The first selected in-line picture replaced, in place, by a new one: sized, alt text set, then
 * tagged. False (nothing changed) when no in-line picture is selected.
 */
export async function replaceSelectedPicture(o: PictureInsert): Promise<boolean> {
  let replaced = false;
  await Word.run(async (context) => {
    const pics = context.document.getSelection().inlinePictures;
    pics.load("items");
    await context.sync();
    if (!pics.items.length) return;
    const picture = pics.items[0].insertInlinePictureFromBase64(o.base64, Word.InsertLocation.replace);
    picture.width = o.widthPt;
    picture.height = o.heightPt;
    picture.altTextDescription = o.alt;
    await context.sync();
    replaced = true;
    if (!o.tag) return;
    // A picture JurisLab tagged before sits in its hidden content control already: the new one
    // takes its place inside it, so tagging again would nest a second control each time.
    let tagged = false;
    try {
      const cc = picture.parentContentControlOrNullObject;
      cc.load("tag");
      await context.sync();
      tagged = !cc.isNullObject && cc.tag === o.tag;
    } catch {
      // Older Word: no way to ask; tag as for a new picture.
    }
    if (!tagged) await tagInserted(context, picture.getRange(), o.tag);
  });
  return replaced;
}

/** A structure picture followed by its R-group legend (a table, or one line), then tagged. */
export async function insertPictureWithLegend(o: LegendedPictureInsert): Promise<void> {
  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const picture = range.insertInlinePictureFromBase64(o.base64, Word.InsertLocation.after);
    picture.width = o.widthPt;
    picture.height = o.heightPt;
    picture.altTextDescription = o.alt;
    const tail = picture.getRange(Word.RangeLocation.end);
    if (o.legend && o.legend.kind === "table") {
      const para = tail.insertParagraph("", Word.InsertLocation.after);
      para.getRange().insertHtml(o.legend.html, Word.InsertLocation.replace);
    } else if (o.legend && o.legend.kind === "line") {
      tail.insertParagraph(o.legend.text, Word.InsertLocation.after).getRange().select(Word.SelectionMode.end);
    } else {
      tail.select(Word.SelectionMode.end);
    }
    await context.sync();
    await tagInserted(context, picture.getRange(), o.tag);
  });
}

/** One paragraph per item (its text, then its picture), each anchored at the END of the last. */
export async function insertPictureParagraphs(items: GalleryItem[]): Promise<void> {
  await Word.run(async (context) => {
    let anchor: Word.Range = context.document.getSelection();
    for (const item of items) {
      const para = anchor.insertParagraph(item.text, Word.InsertLocation.after);
      const pic = para.insertInlinePictureFromBase64(item.base64, Word.InsertLocation.end);
      pic.width = item.widthPt;
      pic.height = item.heightPt;
      pic.altTextDescription = item.alt;
      anchor = para.getRange(Word.RangeLocation.end);
    }
    anchor.select(Word.SelectionMode.end);
    await context.sync();
  });
}

/**
 * Inserts a formatted, editable Word table after `anchor` (a paragraph, or the selection) and returns it, with how
 * many rows it was given — header row bolded and shaded, numeric columns right-aligned. EVERY row: the editable
 * table has its own grid (prepareEditableTable), not the table FIGURE's, which caps at 40 rows, shades section bands
 * and drops a section column (v2.193.0: a 121-row Antibody numbering table went in as 40 rows, silently). Only queues
 * operations; the caller syncs.
 */
function insertFormattedWordTable(anchor: Word.Range | Word.Paragraph, rows: string[][]): { table: Word.Table; rows: number } {
  const prepared = prepareEditableTable(rows);
  const grid = prepared.grid;
  const nRows = grid.length;
  const nCols = nRows ? grid[0].length : 0;
  if (!nRows || !nCols) throw new Error("The table is empty.");
  const table = anchor.insertTable(nRows, nCols, Word.InsertLocation.after, grid);
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const header = i === 0 && prepared.hasHeader;
      if (!header && !prepared.numericCol[j]) continue;
      const cell = table.getCell(i, j);
      if (header) {
        cell.body.font.bold = true;
        cell.shadingColor = "#E7EEF6";
      } else {
        cell.body.paragraphs.getFirst().alignment = Word.Alignment.right;
      }
    }
  }
  return { table, rows: nRows };
}

/**
 * Removes any list/auto-numbering the inserted table cells inherited from the
 * surrounding paragraph (e.g. when the cursor sat in a numbered list), which
 * otherwise shows a "1." etc. in every cell. Sets each cell paragraph to
 * Normal and detaches it from any list.
 */
async function clearTableListFormatting(context: Word.RequestContext, table: Word.Table): Promise<void> {
  const paras = table.getRange().paragraphs;
  paras.load("items");
  await context.sync();
  for (const p of paras.items) p.styleBuiltIn = Word.BuiltInStyleName.normal;
  await context.sync();
  const listFlags = paras.items.map((p) => {
    const li = p.listItemOrNullObject;
    li.load("isNullObject");
    return li;
  });
  await context.sync();
  let detached = false;
  paras.items.forEach((p, i) => {
    if (!listFlags[i].isNullObject) {
      p.detachFromList();
      detached = true;
    }
  });
  if (detached) await context.sync();
}

/**
 * The read table as a native, editable Word table at the cursor, with an optional centred label under it. Returns
 * the number of rows Word reports the table has (null when the host cannot say), so the status line states a
 * measured count.
 *
 * THE LABEL IS MADE BY THE TABLE ITSELF (Table.insertParagraph "After"), never chained from table.getRange(after):
 * the point after a table is not a location Word inserts at, and content chained there is silently lost (v2.192.0,
 * measured in Word). With no label the same call makes the empty paragraph the caret goes to.
 */
export async function insertEditableTable(o: EditableTableInsert): Promise<number | null> {
  let rowCount: number | null = null;
  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const { table } = insertFormattedWordTable(range, o.rows);
    const below = table.insertParagraph(o.label || "", Word.InsertLocation.after);
    below.styleBuiltIn = Word.BuiltInStyleName.normal;
    if (o.label) below.alignment = Word.Alignment.centered;
    below.getRange(Word.RangeLocation.end).select(Word.SelectionMode.end);
    await context.sync();
    await clearTableListFormatting(context, table);
    try {
      table.load("rowCount");
      await context.sync();
      rowCount = typeof table.rowCount === "number" ? table.rowCount : null;
    } catch {
      rowCount = null; // no count available; the table is in
    }
  });
  return rowCount;
}

/**
 * A native table with pictures in some cells (a compound table's structures). Its own grid, exactly as given — the
 * text-table heuristics (row cap, section bands, a dropped first column) do not apply to it. The caption goes above,
 * as patent tables carry it; the header row is bold and shaded; each picture sits centred in its (empty) cell at its
 * size in points; the other cells are left-aligned except numbers, right-aligned.
 */
export async function insertPictureTable(o: PictureTableInsert): Promise<void> {
  const nRows = o.rows.length, nCols = nRows ? o.rows[0].length : 0;
  if (nRows < 2 || !nCols) throw new Error("The table is empty.");
  if (o.rows.some((r) => r.length !== nCols)) throw new Error("The table's rows are not all the same length.");
  const text = o.rows.map((r) => r.map((c) => (typeof c === "string" ? c : "")));
  // A column of numbers ("—" allowed among them, but not a column of nothing else) is right-aligned, header included.
  const numeric = text[0].map((_, j) => j > 0 && text.slice(1).every((r) => /^(—|[-+−]?\d+(\.\d+)?)$/.test(r[j])) && text.slice(1).some((r) => r[j] !== "—"));
  await Word.run(async (context) => {
    let anchor = context.document.getSelection().getRange(Word.RangeLocation.end);
    if (o.label) {
      const cap = anchor.insertParagraph(o.label, Word.InsertLocation.after);
      cap.styleBuiltIn = Word.BuiltInStyleName.normal;
      cap.alignment = Word.Alignment.left;
      anchor = cap.getRange(Word.RangeLocation.end);
    }
    const table = anchor.insertTable(nRows, nCols, Word.InsertLocation.after, text);
    await context.sync();
    await clearTableListFormatting(context, table);
    o.rows.forEach((r, i) =>
      r.forEach((c, j) => {
        const cell = table.getCell(i, j);
        const para = cell.body.paragraphs.getFirst();
        if (i === 0) {
          cell.body.font.bold = true;
          cell.shadingColor = "#E7EEF6";
        }
        if (typeof c !== "string") {
          const pic = para.insertInlinePictureFromBase64(c.base64, Word.InsertLocation.start);
          pic.width = c.widthPt;
          pic.height = c.heightPt;
          pic.altTextDescription = c.alt;
          para.alignment = Word.Alignment.centered;
        } else para.alignment = numeric[j] ? Word.Alignment.right : Word.Alignment.left;
      }),
    );
    table.getRange(Word.RangeLocation.after).select(Word.SelectionMode.end);
    await context.sync();
  });
}

/**
 * A result report laid out by the pane: OOXML packages, plain paragraphs,
 * captioned pictures, labels and right-aligned tables, chained in ONE batch.
 * Returns how many pictures Word actually KEPT (body pictures after minus
 * before), or null when the host cannot say. The pane compares it with the
 * number it sent: a shortfall is Word discarding pictures it accepted.
 *
 * The anchor after a picture paragraph is RangeLocation.end, never .after:
 * chaining .after off a paragraph that contains an inline picture is not a
 * usable insertion point (measured in Word, v2.31.9; the full history is in
 * the pane's insertResultBlocks).
 */
export async function insertResultLayout(items: ResultLayoutItem[]): Promise<number | null> {
  let picturesConfirmed: number | null = null;
  await Word.run(async (context) => {
    // WRAPPED, BECAUSE INSTRUMENTATION MAY NEVER BREAK WHAT IT MEASURES. A host
    // that does not expose body.inlinePictures would otherwise throw here and
    // take the whole insert down.
    let picturesBefore: number | null = null;
    try {
      const before = context.document.body.inlinePictures;
      before.load("items");
      await context.sync();
      picturesBefore = before.items.length;
    } catch {
      picturesBefore = null; // no confirmation available; the insert proceeds
    }

    let anchor = context.document.getSelection().getRange(Word.RangeLocation.end);
    const captions: Array<{ para: Word.Paragraph; prefix: string }> = [];
    for (const item of items) {
      if (item.kind === "ooxml") {
        const inserted = anchor.insertOoxml(item.ooxml, Word.InsertLocation.after);
        if (item.captionPrefix) {
          const first = inserted.paragraphs.getFirst();
          first.load("text");
          captions.push({ para: first, prefix: item.captionPrefix });
        }
        anchor = inserted.getRange(Word.RangeLocation.after);
      } else if (item.kind === "paragraph") {
        const para = anchor.insertParagraph(item.text, Word.InsertLocation.after);
        anchor = para.getRange(Word.RangeLocation.after);
      } else if (item.kind === "picture") {
        const para = anchor.insertParagraph(item.caption, Word.InsertLocation.after);
        const pic = para.insertInlinePictureFromBase64(item.base64, Word.InsertLocation.end);
        pic.width = item.widthPt;
        pic.height = item.heightPt;
        pic.altTextDescription = item.alt;
        anchor = para.getRange(Word.RangeLocation.end);
      } else {
        // A matrix: its label paragraph (if any), then the table, numbers right-aligned.
        if (item.label) {
          const labelPara = anchor.insertParagraph(item.label, Word.InsertLocation.after);
          anchor = labelPara.getRange(Word.RangeLocation.after);
        }
        const values = item.values;
        const table = anchor.insertTable(values.length, values[0].length, Word.InsertLocation.after, values);
        for (let i2 = 0; i2 < values.length; i2++)
          for (let j = 0; j < values[0].length; j++)
            table.getCell(i2, j).body.paragraphs.getFirst().alignment = Word.Alignment.right;
        // THE TABLE ITSELF MAKES THE PARAGRAPH THAT FOLLOWS IT.
        //
        // v2.191.0 inserts results tables before most figures, and chaining off table.getRange(after) lost them:
        // "Engineering result inserted, but Word kept 0 of 1 figures" on Combined loading and the quantum tools
        // (user, Word on Mac and PC, 2026-10-23), every one a table immediately followed by a figure, while tools
        // with no table there kept theirs. The point after a table is not a paragraph Word can insert after;
        // Table.insertParagraph(after) is the supported way to continue below a table, and the empty paragraph it
        // makes is also the gap Word needs between a table and what follows.
        const below = table.insertParagraph("", Word.InsertLocation.after);
        anchor = below.getRange(Word.RangeLocation.end);
      }
    }
    anchor.select(Word.SelectionMode.end);
    await context.sync();

    // A caption paragraph in Word's built-in Caption style, by name (a localized Word's style id is not "Caption"),
    // so the document's OWN Caption style applies. Its own batch, after the content is in: a property set fails at
    // sync, and a failure here must never roll back the insert. Only a paragraph that really starts with the caption
    // text — an insert at the end of a non-empty paragraph merges into it (measured via COM), and the user's
    // paragraph is never restyled.
    const toStyle = captions.filter((c) => c.para.text.trimStart().startsWith(c.prefix));
    if (toStyle.length) {
      try {
        for (const c of toStyle) c.para.styleBuiltIn = Word.BuiltInStyleName.caption;
        await context.sync();
      } catch {
        // Built-in styles unavailable on this build — the caption stays as inserted.
      }
    }

    if (picturesBefore !== null) {
      try {
        const after = context.document.body.inlinePictures;
        after.load("items");
        await context.sync();
        picturesConfirmed = after.items.length - picturesBefore;
      } catch {
        picturesConfirmed = null; // stay quiet rather than report a wrong count
      }
    }
  });
  return picturesConfirmed;
}

/** What follows a figure, inside its batch: a caption line, or Table → Chart's data table and tag. */
async function figureTail(context: Word.RequestContext, picture: Word.InlinePicture, o: FigureInsertWord): Promise<void> {
  const spec = o.tail;
  if (!spec) return;
  if (spec.kind === "caption") {
    picture
      .getRange(Word.RangeLocation.end)
      .insertParagraph(spec.text, Word.InsertLocation.after)
      .getRange(Word.RangeLocation.end)
      .select(Word.SelectionMode.end);
    return;
  }
  // Optionally follow the image with an editable Word table of the data,
  // so the text is editable even though the figure itself is an image.
  //
  // ONLY SUPPORTED INSERTION POINTS (v2.193.0): a fresh paragraph made at the picture's END (never its "after"
  // range), the table inserted by THAT PARAGRAPH, and the caret on a paragraph the TABLE makes below itself. The old
  // chain — para.getRange(after) for the table, table.getRange(after) for the caret — anchored on locations Word does
  // not insert at.
  const tail = picture.getRange(Word.RangeLocation.end);
  let dataTable: Word.Table | null = null;
  if (spec.rows) {
    const para = tail.insertParagraph("", Word.InsertLocation.after);
    dataTable = insertFormattedWordTable(para, spec.rows()).table;
    const below = dataTable.insertParagraph("", Word.InsertLocation.after);
    below.getRange(Word.RangeLocation.end).select(Word.SelectionMode.end);
  } else {
    tail.select(Word.SelectionMode.end);
  }
  await context.sync();
  if (dataTable) await clearTableListFormatting(context, dataTable);
  await tagInserted(context, picture.getRange(), spec.tag);
}

/** The body's in-line picture count, or null when the host cannot say (instrumentation never breaks an insert). */
async function bodyPictureCount(context: Word.RequestContext): Promise<number | null> {
  try {
    const pics = context.document.body.inlinePictures;
    pics.load("items");
    await context.sync();
    return pics.items.length;
  } catch {
    return null;
  }
}

/**
 * The PNG route of the one figure insert path: picture, size in points, alt, tag, tail. Returns how many pictures
 * Word KEPT (body count after minus before; null when the host cannot say): a PNG that stayed over the payload size
 * at 1× is still sent, and Word may accept it and keep nothing, so the pane checks this instead of assuming.
 */
export async function insertFigurePng(o: FigureInsertWord & { base64: string }): Promise<number | null> {
  let kept: number | null = null;
  await Word.run(async (context) => {
    const before = await bodyPictureCount(context);
    const range = context.document.getSelection();
    const picture = range.insertInlinePictureFromBase64(o.base64, Word.InsertLocation.after);
    picture.width = o.widthPt;
    picture.height = o.heightPt;
    picture.altTextDescription = o.alt;
    range.select(Word.SelectionMode.end);
    await context.sync();
    if (o.tag) await tagInserted(context, picture.getRange(), o.tag);
    await figureTail(context, picture, o);
    await context.sync();
    if (before !== null) {
      const after = await bodyPictureCount(context);
      kept = after === null ? null : after - before;
    }
  });
  return kept;
}

/** setSelectedDataAsync as a promise that always settles (10 s bound on the callback API). */
function setSelectedSvg(svg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // A CALLBACK IS NOT A BOUND (svgToPngBase64 has the same timer, for the same
    // reason): a host that never calls back would hold the insert open forever.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Word did not answer the vector insert within 10 seconds."));
    }, 10000);
    try {
      // No imageWidth/imageHeight: whether Word reads them as px or pt is not
      // documented (TEST-SCRIPT §0cj measures it). The picture is found again and
      // sized in points from the SVG that was sent, which needs neither.
      Office.context.document.setSelectedDataAsync(svg, { coercionType: Office.CoercionType.XmlSvg }, (res: Office.AsyncResult<void>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (res.status === Office.AsyncResultStatus.Succeeded) resolve();
        else reject(new Error(res.error?.message || "the vector insert failed"));
      });
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e as Error);
      }
    }
  });
}

async function bodyPictureSignatures(context: Word.RequestContext): Promise<{ pics: Word.InlinePictureCollection; sigs: PictureSignature[] }> {
  const pics = context.document.body.inlinePictures;
  pics.load("items/width,items/height,items/altTextDescription");
  await context.sync();
  return { pics, sigs: pics.items.map((p) => ({ width: p.width, height: p.height, alt: p.altTextDescription ?? "" })) };
}

/**
 * Vector route. setSelectedDataAsync REPLACES the selection, so the selection is
 * collapsed to its end first (or the user's selected text would be deleted). It
 * returns no picture, so the body's pictures are listed before and after and the
 * ONE new picture is found (insertCapability.findInsertedPicture) and sized from
 * the SVG actually sent.
 *
 * Returns { fallback } — the reason to insert PNG instead — ONLY when Word
 * refused the vector insert, i.e. nothing landed. When Word reported success but
 * the picture cannot be identified (none new inline — it may have landed
 * floating — or ambiguous), it THROWS and inserts nothing more: a PNG on top of a
 * vector picture that is somewhere in the document would be two figures, and
 * sizing a guess is the defect class this step exists to prevent.
 */
export async function insertFigureVector(o: FigureInsertWord & { svg: string }): Promise<FigureVectorResult> {
  let before: PictureSignature[] = [];
  await Word.run(async (context) => {
    context.document.getSelection().select(Word.SelectionMode.end);
    await context.sync();
    before = (await bodyPictureSignatures(context)).sigs;
  });
  try {
    await setSelectedSvg(o.svg);
  } catch (e) {
    return { fallback: `Word refused the vector picture (${(e as Error).message})`, format: null };
  }
  let format: string | null = null;
  await Word.run(async (context) => {
    const { pics, sigs } = await bodyPictureSignatures(context);
    const found = findInsertedPicture(before, sigs);
    if (!found.ok) {
      throw new Error(
        `Word reported the vector picture inserted, but ${found.reason}. Nothing else was inserted. ` +
          `Check the document (press Ctrl/⌘+Z if a picture landed), untick “Insert as vector SVG”, and insert again`,
      );
    }
    const pic = pics.items[found.index];
    pic.width = o.widthPt;
    pic.height = o.heightPt;
    pic.altTextDescription = o.alt;
    // Word for Windows/Mac can say what it stored (WordApiDesktop 1.1). Read, never assumed.
    let canReadFormat = false;
    try {
      canReadFormat = Office.context.requirements.isSetSupported("WordApiDesktop", "1.1") === true;
    } catch {
      canReadFormat = false;
    }
    if (canReadFormat) pic.load("imageFormat");
    pic.getRange(Word.RangeLocation.end).select(Word.SelectionMode.end);
    await context.sync();
    if (canReadFormat) format = String(pic.imageFormat);
    if (o.tag) await tagInserted(context, pic.getRange(), o.tag);
    await figureTail(context, pic, o);
    await context.sync();
  });
  return { fallback: null, format };
}

/** What this host can do, read once per insert. Unknown is never "yes" (unlike wordApiSupported). */
export function capability(): HostCaps {
  let platform: string | null = null;
  let imageCoercion12: boolean | null = null;
  let hasSetSelectedData = false;
  try {
    const p = (Office.context as unknown as { platform?: unknown }).platform;
    platform = typeof p === "string" ? p : null;
  } catch {
    platform = null;
  }
  try {
    imageCoercion12 = Office.context.requirements.isSetSupported("ImageCoercion", "1.2") === true;
  } catch {
    imageCoercion12 = null;
  }
  try {
    hasSetSelectedData = typeof Office.context.document?.setSelectedDataAsync === "function";
  } catch {
    hasSetSelectedData = false;
  }
  return { platform, imageCoercion12, hasSetSelectedData };
}
