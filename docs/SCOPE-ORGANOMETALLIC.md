# Organometallic drawing: metallocenes (scope)

User request (2026-10-19): draw organometallic structures — metallocenes (a metal bound η⁵ to cyclopentadienyl rings,
ansa bridges, half-sandwich complexes) and polymer-bound metallocenes — in Build ▸ Draw. Today such ChemDraw drawings
display faithfully, but they open on the page canvas only, and NO tool can create them. User choice: **switch in place**
— organometallic tools always under the Build canvas; using one switches the canvas to the page canvas in place,
carrying over what was drawn. All fixtures are built from scratch.

## What is needed (ChemDraw's own encoding)

| Feature | ChemDraw CDXML | Today |
|---|---|---|
| Cp ring, delocalised | 5 `n` + 5 `b Order="1.5"` (dashed inner ring) | ring tool has no aromatic 5-ring |
| Ring in perspective | front edge `Display="WedgeBegin"` / `"Bold"` / `"WedgeEnd"` on the 1.5 bonds | setBond allows it; no tool sets it; pageToMolecule refuses "wedge on a double bond" |
| η⁵ ring–metal bond | `n NodeType="MultiAttachment" Attachments="a b c d e"` at the ring centroid + a plain `b` to the metal | renders; no tool; refused by name in the editor converter |
| Metal | `Element="40"` (Zr) / 72 (Hf), `NumHydrogens="0"` | setAtomLabel does this |
| BH₄ ligand | `Element="5" NumHydrogens="4"` | **drawn as free text** (no formula) — fix |
| Generic atoms Z, A, M, PG | `NodeType="GenericNickname" GenericNickname="Z"` | setAtomLabel does this |
| M(R¹)₂ | `NodeType="Fragment"` holding a GenericNickname M + R¹ nodes | out of scope for v1 (typed as a generic label) |
| "Z = Si, C" | a caption `t` | caption tool does this |
| Polymer –[ ]ₙ– | `graphic Bracket` ×2 + `bracketedgroup` with `crossingbond`s, SRU label n | bracket tool does this |

## Stages (one release; templates first — a demo places a whole structure, then edits it)

1. **Lib (cdxmlEdit / new lib/organometal.ts):** `addCpRing(doc, at, {perspective})`; `addHapto(doc, ringAtomIds, metal)`
   (centroid node + bond; refuses by name: not a closed ring of 3–8 atoms, atoms already in another hapto set, metal
   not a labelled atom); `BH4`-style "element + H count" labels (BH₄, AlH₄, …) as ChemDraw writes them.
2. **Keep Attachments valid through every edit:** delete atom/bond (deleteObjects, deleteInStructure), relabel a ring
   atom, fuse a ring onto a Cp bond, move part of a ring (centroid follows), Clean in place, subsetPage / gallery ids,
   select/hit-test (the centroid node has no label). Each pinned by a test.
3. **Templates** (one click places them; then swap metal / ligand / bridge by relabelling): Cp₂ZrCl₂, Me₂Si-bridged
   ansa-zirconocene dichloride, half-sandwich CpZrCl₃, polymer-bound (vinyl backbone, pendant Cp, –[ ]ₙ–), and
   Cp₂Zr(BH₄)₂. Built through the stage-1 functions, never hand-written XML.
4. **Entry point:** Build ▸ Draw gets "Metallocene / polymer page" (opens the page canvas blank with the templates);
   the large canvas takes the same page (`?page=`).
5. **Formula / readout:** a page with η-bonds has no single OCL molecule — the pane says so in plain words ("a
   metallocene: drawn as ChemDraw draws it; no single formula is computed"), never a wrong formula (no cyclopentane
   H count, the centroid node never counted). A computed formula (e.g. C₁₀H₁₀Cl₂Zr for Cp₂ZrCl₂, PubChem-checked) is
   a follow-up, only if it can be exact.

## Acceptance

- writeCdxml → readCdxml → pageStructures of every template classifies like ChemDraw's own files (page canvas,
  η-bond named), and renders.
- Side-by-side visual comparison with real ChemDraw pictures of such structures (looked at, never stored).
- Hands-on in the harness: place each template, relabel metal / ligand / bridge, delete a ring atom (η-bond goes
  with it), move, undo, Insert (ChemDraw size), Save as .cdxml, large canvas round trip; plus the old page-canvas
  complaints re-checked (stray clicks, no blocking).
- The user has no ChemDraw: ChemDraw structures reach them as pictures in Word documents. So acceptance is in Word —
  a placed template, inserted, looks like the document's own ChemDraw pictures, and those pictures open editable with
  "Open ChemDraw picture" (η-bonds, Cp rings and brackets kept through an edit). .cdxml output follows ChemDraw's
  encoding as read from the files; nobody is asked to check it in ChemDraw.
