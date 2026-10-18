# One chemistry canvas (scope)

User direction (2026-10-18): "anything chemical builder should be in the chemical build canvas", then "go with
the rebuild". The Structure ▸ Draw canvas becomes JurisLab's own: a page that holds structures, brackets,
arrows and text, opens ChemDraw files and pictures exactly as ChemDraw draws them, and keeps everything the
OpenChemLib editor does today. The separate "Open ChemDraw file" panel (v2.152–v2.154) folds into it.

## The seam

The pane talks to the OCL `CanvasEditor` through five calls only (taskpane.ts, 27 references):
`getMolecule()`, `setMolecule(mol)`, `clearAll()`, `moleculeChanged()`, `setOnChangeListener(cb)`. The large
canvas (src/drawdialog) makes its own `CanvasEditor` with the same five. The new canvas implements those five
over its page, so everything downstream stays as it is:

| Downstream | Uses | Stays |
|---|---|---|
| `updateDrawPreview` (formula, SMILES, compliance note, preview) | `getMolecule()` | yes — the page's structures as one OCL Molecule |
| `insertBuild` (picture, alt text with idcode, tag `formula-inserter:structure`, R-group legend) | `getMolecule()` | yes; a page with brackets / arrows / text inserts the page drawing instead, alt text says so |
| `openInDraw` (Edit in Draw from Chemical mode; re-open from idcode / SMILES) | `setMolecule()` | yes |
| Markush box (`setFragment`), Clean (`cleanedCopy`), Reset | get/set/clearAll | yes |
| Large canvas `?mol=<idcode coords>` seed and `{mol}` / `{mol3d}` return | idcode | yes (and the page, for brackets/arrows/text) |
| Reaction mode "Draw a component" | `getMolecule()` → SMILES | yes |

## The converters (stage 1 — the risk)

Every number the pane shows passes through them, so they come first, pinned against outside data:

- **Page → Molecule** (CDXML fragments → one OCL Molecule with coordinates): elements, charges, isotopes,
  radicals, explicit H, bond orders (1, 2, 3, aromatic), wedge / hash with direction (begin/end ↔ OCL up/down
  from the narrow end), generic atoms (R1… ↔ OCL 129–144; X, Q, A …), the Markush (fragment) flag.
  Refused BY NAME, never converted silently: nicknames and abbreviations (Ph, OMe — unless expanded from the
  file's own fragment), query bonds, element lists, anything else ChemDraw draws that a Molecule cannot hold.
- **Molecule → Page**: the same mapping back, laid out at ChemDraw's bond length.
- Oracles: the 359-compound dictionary round-trips Molecule → page → Molecule with the SAME idcode; the 117
  USPTO .cdx files read page → Molecule → page with atoms, orders, charges and stereo unchanged; wedge direction
  pinned both ways (a flipped wedge is a plausible wrong answer).

## Parity with today's editor (must hold before the OCL editor is retired; each row pinned by a DOM test)

| Today (OCL toolbar) | New canvas |
|---|---|
| Atom: element palette (C N O S P F Cl Br I H …), any element by symbol | Atom tool + palette + typed symbol |
| Generic / query atom (custom label → R1, X …) | Atom tool: R1, X, Q, A … (generic) |
| Single / double / triple bond, click to cycle | Bond tool |
| Wedge / hash (up / down) | Bond style: wedge, hashed wedge, wavy, bold, dashed |
| Chain | Chain (drag) |
| Rings 3–7, benzene | Ring tool |
| Charge + / − | Charge + / − |
| Select / lasso, move | Select, box select, move |
| Delete | Erase |
| Undo / redo | Undo / redo |
| Clear | Reset canvas |
| Clean | Clean structure (cleanedCopy, same idcode) |
| Markush flag | Markush box |
| 3D (large canvas) | unchanged, seeded by idcode |

New beyond today: polymer brackets (ChemDraw's SRU form), reaction and equilibrium arrows, text / captions,
a blank page by default, several structures laid out on one page, ChemDraw files and pictures opened in place.

## Stages

1. Converters + oracles (no UI change).
2. The canvas as a DOM-only controller (like cadPane): mounted in the pane and in the large canvas, the five
   calls, every tool above, DOM tests per parity row; behind the existing Draw tab, OCL editor still default.
3. Switch: the new canvas becomes the Draw tab; ChemDraw files and pictures open in it; the separate panel
   goes; OCL editor retired. Host trace golden identical for structure inserts; re-open of structures already
   in documents verified (idcode in alt text).
