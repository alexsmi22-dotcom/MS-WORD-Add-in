# Numbered reaction schemes — scope

Organic-chem arc item 3 (after CIP v2.164.0 and Characterization v2.165.0). It upgrades the
existing **Reaction** tool (Structures reading); the Formulas reading (balancing) is unchanged.

## What a chemist's scheme needs that the tool lacks today

1. Compound numbers: bold **1**, **2a** centered under each structure. The same numbers are
   used in the Examples ("to give **3** (120 mg, 85%)"), so they live in the document, not
   in the figure alone.
2. Reagents and conditions on every arrow. Today only the first arrow carries text.
3. Multi-step schemes as one figure that wraps onto further rows at the column width.
4. ChemDraw-quality drawing. Today each structure is fitted into its own 130 × 110 box, so
   bond lengths differ from compound to compound. A journal scheme uses one bond length.
5. A caption, "**Scheme 1.** Synthesis of **5**", numbered by Word.

## Input (backward compatible)

The one-line form keeps working: `CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux`.

New, one item per line:

    CCO (1) + CC(=O)O (2)
    >> H2SO4 ; reflux, 3 h
    CC(=O)OCC (3)
    -> LiAlH4, THF ; 0 °C to rt
    CCO

- A line starting with an arrow token (`>>`, `->`, `→`, `<=>`, `⇌`, `<-`) is an arrow;
  text after it is "above ; below".
- A compound number is a trailing ` (label)` after a space: `(1)`, `(2a)`, `(S3)`, `(10b)`.
  SMILES never contain a space, and names keep their own parentheses without one
  ("copper(II) sulfate", "(S)-alanine"), so the reading is unambiguous. A label that is
  not number-like (`(crude)`) is refused by name, not drawn as a label.
- **Number new compounds** (v2.167.0, with the register): off by default. When on, unlabelled compounds get the next
  free numbers in the document, in scheme order.

## Drawing

The scheme is built as one CDXML page in the ACS Document 1996 style already used by the
Build canvas (bond 14.4 pt, line 0.6 pt, Arial 10 pt). Structures are placed with
`moleculeToPage` and drawn by `renderCdx`, so every compound has the same bond length and
looks as it does in Build ▸ Draw.

- Structures are vertically centred on the arrow line in each row, with labels on one
  common baseline under the row.
- Arrows are at least 3 bond lengths and grow to fit their condition text. Text sits
  above and below the arrow, centred, and reagent formulas are typeset (H₂SO₄, Et₃N).
- Wrapping: width is Page (6.5 in), ACS single column (3.25 in) or ACS double column
  (7 in). A row breaks before an arrow, and the next row starts with that arrow.
  One compound wider than the width is drawn on its own row and named in a note,
  never scaled below the house bond length.
- Conditions style: **On the arrows** (default), or **Lettered**: (a), (b) on the arrows
  and a "Reagents and conditions: (a) …; (b) …" paragraph inserted under the scheme.
- **Open in Build canvas**: the same page goes to the page canvas for hand edits.

## Caption

Optional title. Inserted ABOVE the picture, as ACS journals set scheme titles (figure
captions go below; a scheme's "Reagents and conditions" footnote goes below the scheme):
**Scheme N.** title, where N is a Word SEQ Scheme field. Its displayed value is the count
of earlier Scheme captions plus one, and Word renumbers it on field update.

## Release split

v2.166.0: drawing, numbers, per-arrow conditions, wrapping, lettered footnote, caption,
Open in Build canvas. v2.167.0: the document compound register and the Characterization
link below (the larger correctness surface, reviewed on its own).

## Compound register (in the document) — v2.167.0 (built)

A document setting (as the reference numerals are) maps each label to the structure
(OCL idcode, canonical SMILES, formula). It is written on insert, not on preview.

Checks (warn, never block):

- A label already registered for a different structure.
- A structure already registered under another label ("this is **3** already").
- Two different structures with the same label in one scheme. This one is an error:
  the scheme is not drawn until it is fixed.
- A new number that skips (register has 1–4; the new scheme uses 7).

Pane list "Compounds in this document": label, formula, name when known.
**Insert number** (bold label at the cursor) and **Forget** per row.

**Characterization integration:** the Compound field accepts a registered label
(`3`, `compound 3`, `2a`) and uses that structure. The readout says which.

## Refused by name

- A component that is not a structure (formula, coefficient, unknown name). This is the
  existing message.
- A label that is not number-like.
- Reagents written as structures on the arrow (only text there).

## Out of scope (later)

- Re-editing a scheme already in the document from its picture. The source is kept in
  the alt text, so a later release can reload it.
- Curved or branching (divergent) schemes, retrosynthesis "⇒" open arrows, and
  mechanisms with curly arrows.
- Reading compound numbers back out of the document's prose.

## Tests

Engine (`src/lib/scheme.ts`): parsing, labels, the register checks, layout geometry
(uniform bond length, wrapping, arrow sizes), lettered footnotes. DOM test for the pane.
Host-trace seed for Insert. An independent adversarial review before release.
