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

// ---- pictures (Kind 3) -------------------------------------------------------
//
// Sizes are POINTS, already converted by the pane (figurePoints): the pane
// rasterises at a supersampled size and pins the picture to its natural
// physical size, and that pairing is the pane's decision (lib/figures.ts).

/** One picture after the selection. */
export interface PictureInsert {
  base64: string;
  widthPt: number;
  heightPt: number;
  alt: string;
  /** Move the caret to the end of the ORIGINAL selection range afterwards. */
  selectAfter: boolean;
  /** Tag the picture's range, after the picture syncs. */
  tag?: string;
}

/** A structure picture with its R-group legend under it. */
export interface LegendedPictureInsert {
  base64: string;
  widthPt: number;
  heightPt: number;
  alt: string;
  legend: { kind: "table"; html: string } | { kind: "line"; text: string } | null;
  tag: string;
}

/** One substituent: a "label = " paragraph with its picture. */
export interface GalleryItem {
  text: string;
  base64: string;
  widthPt: number;
  heightPt: number;
  alt: string;
}

/** A read table, inserted back as an editable Word table, optionally labelled. */
export interface EditableTableInsert {
  rows: string[][];
  label: string;
}

/** One piece of a result report, in document order. */
export type ResultLayoutItem =
  | { kind: "ooxml"; ooxml: string }
  | { kind: "paragraph"; text: string }
  | { kind: "picture"; caption: string; base64: string; widthPt: number; heightPt: number; alt: string }
  | { kind: "matrix"; label: string; values: string[][] };

/**
 * What follows a figure inside its batch: a caption line (the cursor after it),
 * or Table → Chart's optional editable data table and its tag.
 *
 * `rows` is a FUNCTION, called inside the batch after the picture syncs, at
 * the exact moment the old in-batch hook read the pane's table. Capturing the
 * rows when the insert started would see a different table if the user
 * re-read one during the seconds the figure takes to rasterise (independent
 * review of v2.145.0). null = no data table.
 */
export type FigureTail =
  | { kind: "caption"; text: string }
  | { kind: "tableChart"; rows: (() => string[][]) | null; tag: string };

/** The figure insert path's document half (the pane prepares, styles and rasterises). */
export interface FigureInsertWord {
  widthPt: number;
  heightPt: number;
  alt: string;
  tag?: string;
  tail?: FigureTail;
}

/** The vector route's answer: a reason to fall back to PNG (nothing landed), and the format Word reports storing. */
export interface FigureVectorResult {
  fallback: string | null;
  format: string | null;
}

// ---- document-wide edits (Kind 4) -------------------------------------------

/** One paragraph's numbering mark (lib/paragraphs.ts ParagraphPlanItem, the fields the write needs). */
export interface ParagraphMark {
  index: number;
  mark: string;
  removeExisting: boolean;
}

/** Where the field-based TOA scan looked: the pane says so in every outcome. */
interface ToaScope {
  notesScanned: boolean;
  footnoteCount: number;
  endnoteCount: number;
}

/** What the field-based TOA build did, for the pane to report. */
export type NativeToaReport =
  | ({ kind: "noCitations" } & ToaScope)
  | ({ kind: "noCitationsOutsideTable" } & ToaScope)
  | ({
      kind: "built";
      authoritiesMarked: number;
      marksFound: number;
      occurrences: number;
      unattributed: number;
      refused: Array<{ index: number; text: string; reason: string }>;
      tablesNotLocated: number;
      typedEndedBy: string[];
      typedUnbounded: number;
    } & ToaScope);

/** What the formatted TOA insert did; total 0 = no citations, nothing inserted. */
export type StaticToaReport =
  | { total: 0 }
  | { total: number; groups: Array<{ heading: string; count: number }>; pagesFilled: number; replacedField: boolean };

export interface BibUpdateOpts {
  rewriteAll: boolean;
  bibliography: "always" | "if-present";
}

/** What renumbering did (lib/bibPane.ts planUpdate), or why it refused. */
export type BibUpdateReport =
  | { ok: false; reason: string }
  | {
      ok: true;
      rewrites: number;
      occurrences: number;
      bibliography: { kind: "replaced"; references: number; blocks: number } | { kind: "inserted"; references: number } | null;
      report: string[];
    };

/**
 * The pane's decision for Insert citation, made INSIDE the batch from the tag
 * of the citation control the cursor is in. A refusal inserts nothing.
 */
export type BibInsertPlan<S = import("../lib/bibStore").BibStoreData> =
  | { ok: false; lines: string[] }
  | { ok: true; kind: "new"; tag: string; title: string; store: S }
  | { ok: true; kind: "add"; store: S };

// ---- Office outside Word.run (Kind 5) ------------------------------------------

/** settings.saveAsync's result, reduced to what the pane reads. */
export interface SettingsSaveResult {
  succeeded: boolean;
  error: { message: string } | null;
}

/** A pop-out dialog's events, handled by the pane. */
export interface DialogHandlers {
  /** The dialog did not open; Office's error object, as reported (may be undefined). */
  failed(error: { message?: string } | undefined): void;
  /**
   * A message from the dialog page; `dialog.close()` closes it. `dialog.messageChild(text)`
   * sends text TO the page and says whether this host could (DialogApi 1.2).
   */
  message(arg: unknown, dialog: { close(): void; messageChild(message: string): boolean }): void;
  /** The user closed the dialog window. */
  closed(): void;
}

/** What the host can do for figures. Unknown is never "yes". */
export interface HostCaps {
  platform: string | null;
  imageCoercion12: boolean | null;
  hasSetSelectedData: boolean;
}

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

  /** The alt text of the first selected picture (null = none selected): how a CAD drawing is re-opened. */
  readSelectedPictureAlt(): Promise<string | null>;

  // ---- pictures and tables -----------------------------------------------------

  insertPictureAtSelection(o: PictureInsert): Promise<void>;
  insertPictureWithLegend(o: LegendedPictureInsert): Promise<void>;
  /** Pictures one per paragraph, each anchored at the END of the previous paragraph. */
  insertPictureParagraphs(items: GalleryItem[]): Promise<void>;
  insertEditableTable(o: EditableTableInsert): Promise<void>;
  /** Returns how many pictures Word KEPT (null when it cannot say). */
  insertResultLayout(items: ResultLayoutItem[]): Promise<number | null>;
  insertFigurePng(o: FigureInsertWord & { base64: string }): Promise<void>;
  /** Vector SVG via setSelectedDataAsync, re-found and sized. Throws when Word says yes but the picture cannot be found. */
  insertFigureVector(o: FigureInsertWord & { svg: string }): Promise<FigureVectorResult>;
  capability(): HostCaps;

  // ---- document-wide edits ----------------------------------------------------

  applyParagraphMarks(items: ParagraphMark[]): Promise<void>;
  readTextBeforeCursor(): Promise<string>;
  /** Reads the text before the cursor and, in the same batch, replaces the selection with what `decide` returns (null = nothing). */
  replaceSelectionFromTextBefore(decide: (textBefore: string) => { html: string; tag: string } | null): Promise<boolean>;
  insertTocField(): Promise<void>;
  /** Deletes the body's TA fields or its TOC/TOA fields; returns how many (0 = none found). */
  deleteBodyFields(kind: "citationMarks" | "tables"): Promise<number>;
  buildNativeToa(): Promise<NativeToaReport>;
  buildStaticToa(): Promise<StaticToaReport>;
  updateBibliography(store: import("../lib/bibStore").BibStoreData, opts: BibUpdateOpts): Promise<BibUpdateReport>;
  insertBibCitation(o: {
    isNote: boolean;
    plan: (existingTag: string | null) => BibInsertPlan;
    /** Called inside the batch, where the renumbering starts, so a flag the pane may change mid-insert is read then (as before). */
    update: () => BibUpdateOpts;
  }): Promise<{ refused: string[] } | { kind: "new" | "add"; store: import("../lib/bibStore").BibStoreData; update: BibUpdateReport }>;

  // ---- Office outside Word.run ---------------------------------------------------

  /** A WordApi requirement set; optimistic (true) when the host cannot say. */
  wordApiSupported(version: string): boolean;
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
  saveSettings(done?: (r: SettingsSaveResult) => void): void;
  dialogsSupported(): boolean;
  openDialog(url: string, opts: { height: number; width: number }, h: DialogHandlers): void;
}
