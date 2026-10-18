/// <reference types="office-js" />
/**
 * Word transactions that put pictures and tables in the document
 * (docs/SCOPE-HOST-ADAPTER.md, Kind 3). Each function is ONE Word.run, moved
 * from taskpane.ts unchanged in the calls it makes and the order it makes them;
 * the pane rasterises, sizes (in points) and words everything beforehand.
 */
import type {
  EditableTableInsert,
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
import { prepareTableFigure } from "../lib/tablefigure";

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
 * Inserts a formatted, editable Word table after `anchor` and returns it —
 * header row and section-band rows bolded and shaded, numeric columns
 * right-aligned. Only queues operations; the caller syncs.
 */
function insertFormattedWordTable(anchor: Word.Range, rows: string[][]): Word.Table {
  const prepared = prepareTableFigure(rows);
  const grid = prepared.grid;
  const nRows = grid.length;
  const nCols = nRows ? grid[0].length : 0;
  if (!nRows || !nCols) throw new Error("The table is empty.");
  // Band rows are all-empty in the prepared grid (the section text lives in
  // bandText) — put the section text back into the first cell for insertion.
  const insertGrid = grid.map((r, i) => (prepared.kinds[i] === "band" ? [prepared.bandText[i], ...r.slice(1)] : r));
  const table = anchor.insertTable(nRows, nCols, Word.InsertLocation.after, insertGrid);
  for (let i = 0; i < nRows; i++) {
    const kind = prepared.kinds[i];
    for (let j = 0; j < nCols; j++) {
      const cell = table.getCell(i, j);
      if (kind === "header") {
        cell.body.font.bold = true;
        cell.shadingColor = "#E7EEF6";
      } else if (kind === "band") {
        cell.body.font.bold = true;
        cell.shadingColor = "#DBE6F2";
      } else if (prepared.numericCol[j]) {
        cell.body.paragraphs.getFirst().alignment = Word.Alignment.right;
      }
    }
  }
  return table;
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

/** The read table as a native, editable Word table at the cursor, with an optional centred label. */
export async function insertEditableTable(o: EditableTableInsert): Promise<void> {
  await Word.run(async (context) => {
    const range = context.document.getSelection();
    const table = insertFormattedWordTable(range, o.rows);
    let tail = table.getRange(Word.RangeLocation.after);
    if (o.label) {
      const cap = tail.insertParagraph(o.label, Word.InsertLocation.after);
      cap.alignment = Word.Alignment.centered;
      cap.styleBuiltIn = Word.BuiltInStyleName.normal;
      tail = cap.getRange(Word.RangeLocation.after);
    }
    tail.select(Word.SelectionMode.end);
    await context.sync();
    await clearTableListFormatting(context, table);
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
    for (const item of items) {
      if (item.kind === "ooxml") {
        const inserted = anchor.insertOoxml(item.ooxml, Word.InsertLocation.after);
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
        anchor = table.getRange(Word.RangeLocation.after);
      }
    }
    anchor.select(Word.SelectionMode.end);
    await context.sync();

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
  let tail = picture.getRange(Word.RangeLocation.end);
  let dataTable: Word.Table | null = null;
  if (spec.rows) {
    const para = tail.insertParagraph("", Word.InsertLocation.after);
    dataTable = insertFormattedWordTable(para.getRange(Word.RangeLocation.after), spec.rows());
    tail = dataTable.getRange(Word.RangeLocation.after);
  }
  tail.select(Word.SelectionMode.end);
  await context.sync();
  if (dataTable) await clearTableListFormatting(context, dataTable);
  await tagInserted(context, picture.getRange(), spec.tag);
}

/** The PNG route of the one figure insert path: picture, size in points, alt, tag, tail. */
export async function insertFigurePng(o: FigureInsertWord & { base64: string }): Promise<void> {
  await Word.run(async (context) => {
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
  });
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
