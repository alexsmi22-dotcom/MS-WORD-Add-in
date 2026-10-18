/**
 * The Word implementation of the document host (docs/SCOPE-HOST-ADAPTER.md).
 * The pane imports this one object; nothing in the pane names Word.run.
 */
import type { Host } from "./host";
import { insertAtSelection, insertCaptionParagraph, insertHeadedBlockBefore } from "./wordInsert";
import { readBodyText, readParagraphTexts, readSelectedPictureAlt, readSelectionOoxml, readTableUnderCursor } from "./wordRead";
import {
  capability,
  insertEditableTable,
  insertFigurePng,
  insertFigureVector,
  insertPictureAtSelection,
  insertPictureParagraphs,
  insertPictureWithLegend,
  insertResultLayout,
} from "./wordFigures";
import {
  applyParagraphMarks,
  buildNativeToa,
  buildStaticToa,
  deleteBodyFields,
  insertBibCitation,
  insertTocField,
  readTextBeforeCursor,
  replaceSelectionFromTextBefore,
  updateBibliography,
} from "./wordDocument";
import { wordApiSupported } from "./wordShared";
import { dialogsSupported, getSetting, openDialog, saveSettings, setSetting } from "./officeHost";

export const wordHost: Host = {
  insertAtSelection,
  insertHeadedBlockBefore,
  insertCaptionParagraph,
  readBodyText,
  readParagraphTexts,
  readTableUnderCursor,
  readSelectedPictureAlt,
  readSelectionOoxml,
  insertPictureAtSelection,
  insertPictureWithLegend,
  insertPictureParagraphs,
  insertEditableTable,
  insertResultLayout,
  insertFigurePng,
  insertFigureVector,
  capability,
  applyParagraphMarks,
  readTextBeforeCursor,
  replaceSelectionFromTextBefore,
  insertTocField,
  deleteBodyFields,
  buildNativeToa,
  buildStaticToa,
  updateBibliography,
  insertBibCitation,
  wordApiSupported,
  getSetting,
  setSetting,
  saveSettings,
  dialogsSupported,
  openDialog,
};
