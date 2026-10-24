/// <reference types="office-js" />
/**
 * Word helpers shared by the host transactions (docs/SCOPE-HOST-ADAPTER.md).
 * Office.js types are allowed here and in the other src/host/word*.ts files;
 * nowhere else should need them.
 */
import type { InsertAt } from "./host";

/**
 * The Word insert location for a plain-data one. Resolved at call time, never
 * at module load: the Word namespace exists by the time anything inserts, but
 * a module-scope read would bind whatever stood there when the bundle ran.
 */
export function wordLocation(at: InsertAt): Word.InsertLocation {
  return at === "replace" ? Word.InsertLocation.replace : Word.InsertLocation.after;
}

/**
 * Wraps an already-inserted, already-synced range in a hidden, tagged content
 * control so the artifact can be re-found and updated later (e.g. renumbering
 * callouts, refreshing a list). Best-effort and isolated in its own sync: if
 * content controls aren't supported on this build, the inserted content is left
 * exactly as-is. The "hidden" appearance keeps the document visually unchanged.
 */
export async function tagInserted(context: Word.RequestContext, range: Word.Range, tag: string): Promise<void> {
  try {
    const cc = range.insertContentControl();
    cc.tag = tag;
    cc.title = "JurisLab";
    cc.appearance = Word.ContentControlAppearance.hidden;
    await context.sync();
  } catch {
    // Content controls unsupported here — the inserted content remains in place.
  }
}

/**
 * True when an OOXML package carries more than one block (paragraphs, or any table): content that is a block of its
 * own, never part of the sentence the cursor is in. A single-paragraph package (an equation typed mid-sentence, a
 * formula) stays inline.
 */
export function isMultiBlockOoxml(ooxml: string): boolean {
  const body = /<w:body>([\s\S]*?)<\/w:body>/.exec(ooxml)?.[1] ?? ooxml;
  if (/<w:tbl[\s>]/.test(body)) return true;
  return (body.match(/<w:p[\s>/]/g) ?? []).length > 1;
}

/**
 * Where a block of its own goes at the cursor (fix2-plat). Inserted at a collapsed cursor, a multi-paragraph package
 * JOINED its first paragraph to the user's: at the end of a Heading 1 the result line became part of the heading
 * (and of the TOC); in a list item it became a list item (measured via COM).
 *
 * - The cursor's paragraph is empty and plain: the package goes where the cursor is (no blank line is added).
 * - Empty, but a heading or a list item: that paragraph is made Normal and taken out of the list first.
 * - Not empty: a NEW empty paragraph after it, Normal and out of any list, and the package goes in at its start.
 *
 * Returns the range and location to insert at. The paragraph is read in its own sync. On a host without WordApi 1.3
 * (paragraphs.getLast, styleBuiltIn, isListItem) nothing is read and the insert goes after the cursor as before.
 */
export async function blockTarget(context: Word.RequestContext, sel: Word.Range): Promise<{ range: Word.Range; at: Word.InsertLocation }> {
  if (!wordApiSupported("1.3")) return { range: sel.getRange(Word.RangeLocation.end), at: Word.InsertLocation.after };
  const para = sel.paragraphs.getLast();
  para.load("text,isListItem,styleBuiltIn");
  await context.sync();
  const text = typeof para.text === "string" ? para.text : "";
  const list = para.isListItem === true;
  const style = typeof para.styleBuiltIn === "string" ? para.styleBuiltIn : "";
  const special = list || /^(Heading|Title|Subtitle)/i.test(style);
  const plain = (p: Word.Paragraph, wasList: boolean): void => {
    p.styleBuiltIn = Word.BuiltInStyleName.normal;
    if (wasList) p.detachFromList();
  };
  if (!text.trim()) {
    if (special) plain(para, list);
    return { range: sel.getRange(Word.RangeLocation.end), at: Word.InsertLocation.after };
  }
  const fresh = para.insertParagraph("", Word.InsertLocation.after);
  plain(fresh, list);
  // INTO the new paragraph at its start, as into an empty paragraph — never replacing the whole paragraph: without
  // its mark the package's last line merged into the user's next paragraph (measured via COM).
  return { range: fresh.getRange(Word.RangeLocation.start), at: Word.InsertLocation.after };
}

/**
 * True if a WordApi requirement-set version is available on this host. Used to
 * gate the OOXML/OMML inserts that older Word (or some web/Mac hosts) lack, so
 * they degrade gracefully instead of throwing a raw exception. Optimistic if the
 * capability can't be determined.
 */
export function wordApiSupported(version: string): boolean {
  try {
    return Office.context.requirements.isSetSupported("WordApi", version);
  } catch {
    return true;
  }
}
