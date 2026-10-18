# ChemDraw files in JurisLab

**Goal (user, 2026-10-18):** "open chemdraw files in jurislab with the ability to be able to edit those files
and not have to use chemdraw" — "cut as many limitations as possible between jurislab and chemdraw".

## Stages

| Stage | What | Status |
|---|---|---|
| C1 | Open a .cdxml file and see it exactly as ChemDraw draws it; pick structures; insert into Word | **v2.152.0** |
| C2 | Edit the file: atoms, bonds, charges, text; move, delete; undo; Save as .cdxml | **v2.152.0** (first tools) |
| C3 | Binary .cdx; ring tools; ChemDraw pictures in documents (the CDX in their EMF) | **v2.153.0** |
| C4 | Chain, bracket and arrow tools; replacing the picture in place | planned |

## Design

- **The XML tree is the document.** `cdxml.ts` keeps the parsed tree; every edit (`cdxmlEdit.ts`) changes the
  tree and the model is read again from it. What is drawn is what Save writes, and everything this release
  does not understand survives an edit.
- **Faithful, not re-laid-out.** Coordinates are ChemDraw's points (y down); labels and captions keep their own
  absolute positions; the document's own BondLength, LineWidth, BoldWidth, HashSpacing, MarginWidth, BondSpacing
  and fonts are used. Rules the format leaves unstated are calibrated on real ChemDraw 23 files and named in
  `cdxmlRender.ts`: arrowhead sizes are hundredths of the line width; a double bond with no DoublePosition goes
  inside its ring, else toward its neighbours, centred on a terminal labelled atom; a bracket's depth is 10 % of
  its length, its lips toward the atoms it brackets (from the bracketed group).
- **Picking with companions** (`cdxmlSelect.ts`): a structure's brackets, "n"/"x" labels, ⊕/⊖ symbols and
  counter-ions are separate objects in a ChemDraw file; a click picks them together. Text a reaction step names
  as its arrow's conditions is not a companion.
- **Names ChemDraw computed** (chemicalproperty) are outlined as out of date once their structure changes, and an
  insert names them by their words.
- **Refusals by name**: binary .cdx ("Save As ▸ ChemDraw XML"), malformed XML (with the line), a DOCTYPE that
  declares entities, more than 40 MB, a selection too large to read on a page.

## Census of the first real files (two ChemDraw 23 patent figure files)

98 structures; 41 could go through the OpenChemLib canvas losslessly — the rest carry polymer brackets (33),
labels other than R1–R16 (13), abbreviations (11) or wavy bonds (4). So the ChemDraw model is its own, and
editing happens on it; OCL is not the editor for these files.

## Confidentiality

Client files are never committed and no test is derived from them. Every test document is written by hand.
