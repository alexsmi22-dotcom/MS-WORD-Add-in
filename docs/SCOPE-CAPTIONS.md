# Captions, equation numbers and cross-references with Word's fields — scope

_Release A of the STEM gaps (2026-10-21, "proceed with all 15" — gap #1)._ Every thesis, paper and patent author
numbers figures, tables and equations and refers to them; until now JurisLab wrote those numbers as static text from
its own counters, so inserting a figure in the middle left every later number and reference wrong.

## What it does

- **Captions** (Captions & cross-refs ▸ Numbering: **Word fields**, the default): a paragraph in Word's Caption style
  — "Figure ", a `SEQ Figure \* ARABIC` field, ". " and the text — as Insert ▸ Caption writes it. Labels: Figure,
  Table, Scheme. **With chapter numbers**: `STYLEREF 1 \s` "." `SEQ … \s 1` — Figure 2.3, restarting at each
  Heading 1 (Heading 1 must use numbered headings, as in Word).
- **Equation numbers** (Math ▸ Equation numbers): (I), (II) … as before for patent formulas, or **(1)** / **(2.1)**
  as a `SEQ Equation` field at the right tab stop of the equation's paragraph.
- **Cross-references**: the list of what JurisLab numbered in this document, each with its CURRENT number (the
  bookmark's text in the document, Word's own); Insert writes the label ("Fig. ", "Table ", "Scheme ", "Eq. (") and a
  `REF _Ref… \h` field to a hidden bookmark around the number — it follows the figure when numbers change.
- **Update numbers**: updates the body's fields, SEQ first, then REF and TOC (Field.updateResult, WordApi 1.5). A Word
  without it is told to select all and press F9.
- **Table of figures / tables / schemes**: Word's `TOC \h \z \c "Figure"` field, updated after it goes in.
- **Plain text** numbering stays as it was (counters in the document's settings, typed numbers) for documents that
  use it.

## How

- `src/lib/captionFields.ts` — pure OOXML (fldSimple fields, `_Ref` + nine digits bookmarks with ids from their own
  digits, the flat-OPC package from `mathOmml.flatOpcPackage`), the registry parser (read field by field), the
  cross-reference choices (a deleted caption — its bookmark gone, or no longer holding a number — is not offered).
- `src/host/wordDocument.ts` `updateBodyFields`, `readBookmarkTexts` (WordApi 1.4); `src/host/wordInsert.ts`
  `insertParagraphOoxmlAfter`.
- `src/taskpane/captionsPane.ts` — the Word-fields half of the section and the equation-number hook; the registry in
  the document's settings (`formula-inserter.captionFields`) names what to offer, never the numbers.

## Limits

- Jest cannot run Word: the OOXML, the host calls (against a mock) and the pane are tested; renumbering itself is
  checked in Word (docs/TEST-SCRIPT.md).
- Captions made with Word's own Insert ▸ Caption are not in JurisLab's list (they have no `_Ref` bookmark until Word
  makes a cross-reference); Word's own Insert ▸ Cross-reference reaches them.
- Fields in headers, footers, footnotes and text boxes are not updated by Update numbers (body only); F9 there.
