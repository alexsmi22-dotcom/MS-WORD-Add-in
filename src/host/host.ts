/**
 * The document host, as the task pane sees it.
 *
 * Every read or write of the user's document goes through this interface
 * (docs/SCOPE-HOST-ADAPTER.md). It speaks plain data (strings, numbers and
 * records), never a Word.Range, so the pane holds no Office.js types and
 * the choreography behind each method can be tested on its own.
 *
 * ONE METHOD = ONE TRANSACTION. Each method is one Word.run today, and Word
 * makes one Word.run one Ctrl+Z. A method must never be split into two
 * batches, and two must never be merged, without that being the point of the
 * change. The host-trace gate (scripts/host-trace.js) reports either.
 *
 * WHAT STAYS IN THE PANE. Status text, busy flags, button state, every
 * message. The host returns what the document reported; the pane decides
 * what to say about it.
 */

/** Where content goes relative to the selection. */
export type InsertAt = "replace" | "after";

/**
 * Where the cursor ends up after an insert: at the end of the INSERTED
 * content, at the end of the ORIGINAL selection range, or left alone. Sites
 * differ, and the difference is visible (an "after" insert that selects the
 * selection leaves the caret at the end of the new content in Word, but by a
 * different route), so it is stated per call rather than defaulted.
 */
export type SelectAfter = "inserted" | "selection" | null;

/** One piece of content put at the selection. */
export interface SelectionInsert {
  kind: "html" | "text" | "ooxml";
  content: string;
  at: InsertAt;
  select: SelectAfter;
  /** Wraps the inserted range in a hidden tagged content control (`formula-inserter:*`), after the content syncs. */
  tag?: string;
}

/** The table the cursor or selection sits in: its raw cell values, or null when there is none. */
export type TableUnderCursor = { values: string[][] } | null;

export interface Host {
  // ---- insert at the selection ----------------------------------------------

  /** Insert HTML, text or OOXML at the selection; optionally move the caret and tag the result. */
  insertAtSelection(o: SelectionInsert): Promise<void>;

  /**
   * The List of Reference Numerals: a Heading 2 paragraph and the table HTML,
   * both BEFORE the selection, the table range tagged.
   */
  insertHeadedBlockBefore(o: { heading: string; html: string; tag: string }): Promise<void>;

  /** A caption paragraph after the selection, in the Caption style, caret at its end, tagged. */
  insertCaptionParagraph(o: { text: string; tag: string }): Promise<void>;

  // ---- read ------------------------------------------------------------------

  /** The main body's text (not footnotes or endnotes). */
  readBodyText(): Promise<string>;

  /** The text of each body paragraph, in order. */
  readParagraphTexts(): Promise<string[]>;

  /**
   * The table under the cursor. A collapsed cursor inside a table reports no
   * tables in its range but does have a parent table; a dragged selection
   * reports the former.
   */
  readTableUnderCursor(): Promise<TableUnderCursor>;
}
