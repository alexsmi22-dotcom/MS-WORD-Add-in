/**
 * The Word implementation of the document host (docs/SCOPE-HOST-ADAPTER.md).
 * The pane imports this one object; nothing in the pane names Word.run.
 */
import type { Host } from "./host";
import { insertAtSelection, insertCaptionParagraph, insertHeadedBlockBefore } from "./wordInsert";
import { readBodyText, readParagraphTexts, readTableUnderCursor } from "./wordRead";
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

export const wordHost: Host = {
  insertAtSelection,
  insertHeadedBlockBefore,
  insertCaptionParagraph,
  readBodyText,
  readParagraphTexts,
  readTableUnderCursor,
  insertPictureAtSelection,
  insertPictureWithLegend,
  insertPictureParagraphs,
  insertEditableTable,
  insertResultLayout,
  insertFigurePng,
  insertFigureVector,
  capability,
};
