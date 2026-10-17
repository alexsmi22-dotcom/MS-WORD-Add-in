/// <reference types="office-js" />
/**
 * Word transactions that read the document (docs/SCOPE-HOST-ADAPTER.md, Kind 2).
 * Each is ONE Word.run; the pane does all deciding and rendering afterwards.
 */
import type { TableUnderCursor } from "./host";

export async function readBodyText(): Promise<string> {
  let text = "";
  await Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    text = body.text;
  });
  return text;
}

export async function readParagraphTexts(): Promise<string[]> {
  let texts: string[] = [];
  await Word.run(async (context) => {
    const paras = context.document.body.paragraphs;
    paras.load("items/text");
    await context.sync();
    texts = paras.items.map((p) => p.text);
  });
  return texts;
}

/** The alt text of the first picture in the selection, or null when no picture is selected. */
export async function readSelectedPictureAlt(): Promise<string | null> {
  let alt: string | null = null;
  await Word.run(async (context) => {
    const pics = context.document.getSelection().inlinePictures;
    pics.load("items/altTextDescription");
    await context.sync();
    if (pics.items.length) alt = pics.items[0].altTextDescription ?? "";
  });
  return alt;
}

export async function readTableUnderCursor(): Promise<TableUnderCursor> {
  let out: TableUnderCursor = null;
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const tables = selection.tables;
    tables.load("items");
    const parent = selection.parentTableOrNullObject;
    parent.load("isNullObject");
    await context.sync();

    // A collapsed cursor inside a table reports no tables in the range but
    // does have a parent table; a dragged selection reports the former.
    let table: Word.Table | null = tables.items.length ? tables.items[0] : null;
    if (!table && !parent.isNullObject) table = parent;
    if (!table) return;

    table.load("values");
    await context.sync();
    out = { values: table.values };
  });
  return out;
}
