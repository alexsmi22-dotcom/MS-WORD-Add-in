# JurisLab — Manual Test Script (v2.164.0)

A step-by-step smoke test to verify the add-in works end-to-end **inside Word**.
The engine is covered by 3,200+ automated unit tests, and `npm run qc` now also
boots the pane in headless Chromium to check every tool renders. This script
covers what neither can reach: insertion into a real document, undo, document
scanning, and layout. Budget ~30 minutes for the full pass.

Mark each box: ☐ pass · ✗ fail (note what happened).

---

## 0dc. New in v2.164.0 — Chemistry: R/S and E/Z

- [ ] ★ **Name with descriptors.** Chemical: type `CC[C@@H](C)O` → "Systematic name: (2R)-butan-2-ol". Edit in Draw →
  the Build readout's **Stereo** line says (2R)-butan-2-ol. Flip the wedge in the editor → (2S).
- [ ] **E/Z.** Build ▸ Text: `C/C=C/C` → (2E)-but-2-ene; `C/C=C\C` → (2Z).
- [ ] **Refusals in words.** Text: `CC(C)Cc1ccc(cc1)C(C)C(=O)O` (ibuprofen, no wedge) → "1 stereocentre; not given:
  unspecified — drawn without a wedge". `OC(=O)[C@H](O)[C@H](O)[C@H](O)C(=O)O` → C-3 not given (pseudo-asymmetric).
- [ ] No stereo element (ethanol): no Stereo line.

## 0db. New in v2.163.0 — Chemistry: metallocenes in Build ▸ Draw

- [ ] ★ **Template.** Build ▸ Draw, draw anything (a bond), then **Organometallic: Metallocene template… ▸ Metallocene
  dichloride**: the canvas switches in place, your bond is still there, Cp₂ZrCl₂ appears beside it (Cp rings in
  perspective, η-bonds to Zr, two Cl clearly bonded).
- [ ] **Every template**: ansa (Me₂Si bridge with two methyls), half-sandwich (three Cl), bis(borohydride) (BH₄ with
  subscript 4), polymer-bound (brackets and n on the backbone) — each clear of the others.
- [ ] **Edit.** Atom tool: **Hf** on the Zr label → Hf; **Z** on Si → Z. Erase a ring carbon → the η-bond to that ring
  goes with it; Undo brings both back.
- [ ] **η-bond by hand.** **Cp ring**, click the page; Atom tool **Fe** on empty paper; **η-bond**: click inside the
  ring, then Fe → "η⁵-bond drawn".
- [ ] **Insert 2D structure** (ChemDraw size): the metallocene goes into Word at the size of a ChemDraw picture,
  rings and labels as on screen. Compare with a ChemDraw picture already in a document.
- [ ] **Large canvas** from the page: the same tools; Use this drawing brings the metallocene back intact.
- [ ] **Back to the structure editor** returns to the ChemDraw-like editor.

## 0da. New in v2.162.1 — Chemistry: the drawing survives the 3D tab

- [ ] ★ **2D → 3D → 2D.** Build ▸ Draw a structure with a wedge (e.g. 2-butanol), Open large canvas / 3D ⤢, click
  3D model, then 2D editor: the same drawing, same place, wedge kept. Repeat quickly a few times.
- [ ] **Use this drawing** after that round trip: the pane shows the same structure (formula, wedge), and Insert
  puts it into Word at normal size — not a dot.
- [ ] **3D edit, then undo.** In 3D model add a template (Benzene), back to 2D editor: the benzene is there, drawn
  normally; Ctrl+Z (click the canvas's undo arrow) returns the drawing before the edit, not a blank canvas.
- [ ] **Text → Draw** in Build mode: the drawing is still there.

## 0cz. New in v2.162.0 — Chemistry: the original editor back; ChemDraw files structure by structure

The steps from the 2026-10-19 demo, in Word:
- [ ] ★ **Draw.** Build ▸ Draw: the ChemDraw-like editor (toolbar down its left side), behaving as it did before
  v2.156. Draw a ring and a chain, change an atom, undo: the formula and SMILES below follow each change.
- [ ] ★ **Open a ChemDraw file.** Open ChemDraw file…, pick a multi-structure .cdxml: a list of its structures appears
  (not the whole page). Click one: it opens full size in the editor. Change an atom (pick N, click a carbon): the
  formula changes. Insert: it goes into Word at ChemDraw size.
- [ ] **A generic structure** (marked "page" in the list, e.g. one with X): it opens on its own on the page canvas; the
  status says why. "Back to the structure editor" returns.
- [ ] **R-groups.** A structure with R1 and R2: the SMILES shows both ([R1] and [R2]), not R1 twice.
- [ ] **A polymer** (brackets with n, marked "page"): it opens on the page canvas with its brackets; "Edit the structure in
  the structure editor" opens the repeat unit in the editor (the status says brackets are left out). Open the whole page:
  that button is gone.
- [ ] **Save as .cdxml** under the editor: ChemDraw opens the saved file with the same structure.
- [ ] **Back and forth.** Draw something, switch to the Text tab and back, press Ctrl+Z: the last edit is undone.
- [ ] ★ **Large canvas.** Open large canvas / 3D with a structure drawn: a smaller window, the same editor; draw, Use
  this drawing: it comes back exactly. Word stays responsive while the window is open.
- [ ] **Dark mode** (Word in a dark theme): Insert name, Edit in Draw and the canvas buttons are clearly readable.

## 0cy. New in v2.161.0 — Drawing (CAD): section views, perspective, OBJ

- [ ] ★ **Section.** Drawing (CAD), USPTO standard, a part with a hole (or a tube). Add section view, then click two
  points across the front figure through the hole. A new figure appears below: the cut part, hatched at 45°, the hole
  clear. On the front figure: a broken line across the part, an arrow at each end, and at each end the new figure's
  number. Insert: the same in Word.
- [ ] **Two parts.** A shaft in a hole (two parts touching): the section hatches them at different angles.
- [ ] **Flip / Remove.** Flip: the section looks from the other side (arrows turn). Remove: it goes, with its marks.
- [ ] **ASME.** Switch the standard to ASME: the ends read A, the figure is titled "SECTION A–A".
- [ ] **Perspective.** Tick Perspective: a pictorial view with converging edges; Strong vs Slight visibly differs.
- [ ] **OBJ.** In Solid Edge (or any CAD), export a part as OBJ; Import DXF / STL / OBJ…, pick it, choose units, Add
  as a part: it draws as an STL part does.

## 0cx. New in v2.160.0 — Loose ends

- [ ] ★ **Solve's curve.** In Solve, type x^2 - 5x + 6 = 0 and Insert: the roots AND a plot with both roots marked
  go into Word.
- [ ] **Finance comma.** Net present value, cash flows "-1000 500,5 500,5": the result notes "2 decimal commas read
  as decimals (500,5 → 500.5)". Change one flow to 5OO (letter O's): the result names "5OO" as not a number.
- [ ] **Stats lone value.** Two-sample t-test (groups separated by a blank line) with group 1 "1,5 2,5 3,5" and group 2
  "4,5": whatever the test reports, group 2 is the single value 4.5 (n = 1) — never two values, 4 and 5.

## 0cw. New in v2.159.0 — Chemistry canvas: size, speed, icons

- [ ] ★ **No freeze.** In Chemical → Draw, draw a large structure (or open a ChemDraw file with several). Keep clicking
  bonds quickly: each click appears at once; the formula and SMILES below update a moment after you stop.
- [ ] ★ **ChemDraw size.** With Size on "ChemDraw size", Insert: the structure is the size ChemDraw would paste it,
  not enlarged. The status says it was inserted at ChemDraw's size and, for 10 pt labels, that the letters are
  under the USPTO minimum.
- [ ] **USPTO size.** Switch Size to "USPTO drawing sheet size" and Insert: larger, status "Enlarged … %". Close and
  reopen the pane: the choice is still USPTO.
- [ ] **Icons.** The canvas tools are one or two rows of icons; hovering each shows its name. Open large canvas:
  the same icons.
- [ ] **Insert straight after drawing.** Draw a bond and click Insert at once: the inserted picture includes it.

## 0cv. New in v2.158.0 — Drawing (CAD): import STL parts

- [ ] ★ **STL part.** In Solid Edge, open a part and Save As → STL. In Drawing (CAD), Import DXF / STL…, pick it:
  the panel asks for units (none is chosen for you). Choose millimetres: it reports the facets and edges drawn.
  Add as a part: it appears in the parts list as "Imported STL" and in every view, hidden lines dashed, holes
  and fillets outlined. Insert.
- [ ] **Edge angle.** Under the part, set the edge angle to 10°: more edges are drawn (tangent fillets may now
  show); back to 30°.
- [ ] **Re-open.** Close and reopen Word, click the inserted drawing, Edit drawing at cursor: the part says
  "import <file> again". Import the same file: "put back", and the drawing is as it was.
- [ ] **Mate.** Add a Block, Mate faces: click a flat face of the STL part, then the block's top: it sits flush.
- [ ] **Large canvas.** Open large canvas with the STL part present: it says it cannot yet, by name.

## 0cu. New in v2.157.0 — atom properties on the canvas

- [ ] ★ **Stereo group.** Draw alanine with a wedge at its centre. **Properties**, click the centre, choose
  Stereo: AND (racemic) group: "&1" appears beside it. Insert; Save as .cdxml and open it in ChemDraw (Show
  Stereochemistry on): ChemDraw shows the same AND group.
- [ ] **Query features.** Properties, click an atom, Substituents: exactly 2; Ring bonds: 2: "s2,rb2" beside it;
  the readout says generic structure. Click a bond, tick double as well: "S/D" on the bond.
- [ ] **Atom list.** Atom tool, type [N,O], click an atom: the label reads [N,O] and the status says it is a query.
- [ ] **Radical.** Make an atom N (NH₂), Properties, Radical •: the label becomes NH with a dot above.
- [ ] **Reopen.** An older document's structure that had an AND group or a query atom (inserted from the old
  editor): Edit in Draw opens it on the canvas with them, instead of refusing.
- [ ] ★ **Large canvas, whole page.** Open a ChemDraw scheme with arrows and captions (or draw one with a caption
  and an OMe), Open large canvas / 3D: all of it is there. Change something, Use this drawing: the pane shows it
  exactly; Undo once returns to the page as it was before.
- [ ] **Clean in place.** On a page with two crooked structures and a caption, select one structure, Clean: only
  it is tidied, in the same place; the caption and the other structure have not moved. Undo restores it.

## 0ct. New in v2.156.0 — one chemistry canvas

- [ ] ★ **Draw from scratch.** Structure ▸ Draw: the page is blank, Bond ready. Click: a bond. Drag from its end:
  the chain grows. Pick O, click the end atom: ethanol — Formula C₂H₆O, SMILES CCO. Click a bond twice: triple.
  Insert 2D structure: the picture is what the page shows.
- [ ] ★ **A ChemDraw file on the canvas.** Open ChemDraw file… (a .cdx or .cdxml): it opens on the same page, no
  separate panel. Change an atom; Insert; Save as .cdxml and open the file in ChemDraw.
- [ ] **Ring, chain, charge, brackets, arrow, text, select / move / delete, undo** — each on the page. Zoom + / −
  and Ctrl+wheel; Fit.
- [ ] **Markush.** Draw with an R1 (Atom: type R1): the readout says generic; the box ticks.
- [ ] **Large canvas.** Open large canvas / 3D: the same canvas, larger; Use this drawing brings it back.
- [ ] ★ **USPTO lettering.** Set Size to "USPTO drawing sheet size". Draw ethylamine (an NH₂), Insert: the status says "Enlarged 186 % so its letters meet
  the USPTO's 1/8-inch minimum"; in Word, the H's subscript 2 measures at least 0.32 cm tall when printed.
  Open a large ChemDraw scheme and Insert: it is refused as larger than the page; Insert selected inserts one part.

## 0cs. New in v2.155.0 — Drawing (CAD): the table — mates, exploded and detail views

- [ ] ★ **Mate the table.** Drawing (CAD): Add part Block, set 100 × 60 × 4 (the top); add four Blocks 5 × 5 × 70
  (legs). **Mate faces**: click a leg's top face near a corner, then the top's underside near the matching corner —
  the leg hangs flush under the corner. Repeat for the other legs (it stays on); **Undo mate** once, then again.
- [ ] ★ **Exploded view.** Tick **Exploded** under Views: a third figure with the top lifted off the legs and dashed
  trail lines down to each leg, in brackets on the patent sheet. Change the top's **Explode Z**: the gap follows.
- [ ] ★ **Detail view.** **Add detail view**, choose 3× larger, click a leg-to-top joint on the front figure: a new
  FIG. below with that joint enlarged, the circle on the front figure marked with the new FIG. number. Insert: one
  picture with all figures. Switch the standard to ASME: the detail reads "DETAIL A SCALE …".

## 0cr. New in v2.154.0 — ChemDraw chains, brackets, arrows, replace in place

- [ ] ★ **Replace in place.** Click a ChemDraw picture in the document, **Open ChemDraw picture**, change an atom, then
  (with the picture still selected in the document) **Replace selected picture**: the edited drawing is where the old
  one was — no second copy. Click in plain text instead and press it: it says to select the picture first.
- [ ] **Chain.** Choose **Chain**, drag from a chain's end atom: the chain grows along the mouse, a bond per step.
- [ ] **Brackets.** Choose **Brackets**, drag a box round one repeat unit of a chain: square brackets with an italic n.
  **Save as .cdxml** and open it in ChemDraw: ChemDraw shows the polymer brackets as its own.
- [ ] **Arrow.** Choose **Arrow**, drag left to right: a reaction arrow; choose Equilibrium arrow and drag again.

## 0cq. New in v2.153.0 — ChemDraw pictures in documents, .cdx files and ring tools

- [ ] ★ **A ChemDraw picture in Word.** In a document with structures pasted from ChemDraw, click one, then Structure
  ▸ Draw ▸ **Open ChemDraw picture**: the drawing opens in the panel (bonds, labels, brackets as in ChemDraw). Edit
  an atom, **Insert selected**: the edited drawing goes in after it. A picture not from ChemDraw: it says so.
- [ ] ★ **A .cdx file.** Structure ▸ Draw ▸ **Open ChemDraw file…**, pick a .cdx (ChemDraw's default format): it
  opens like a .cdxml. Compare with ChemDraw. **Save as .cdxml**: the saved file opens in ChemDraw.
- [ ] **Ring.** Choose **Ring**, Benzene: click empty paper — a benzene; click one of its single bonds — naphthalene
  with alternating double bonds. Choose Cyclohexane, click a chain's end atom — a ring on a new bond.

## 0cp. New in v2.152.0 — Open and edit ChemDraw files

Home ▸ **Structure** ▸ **Draw** ▸ **Open ChemDraw file…**. Use a ChemDraw file you have (File ▸ Save As ▸ ChemDraw
XML, .cdxml).

- [ ] ★ **It looks like ChemDraw.** The page appears with a line such as "… 93 structures and 339 other objects (made
  by ChemDraw 23 …)". Compare with the same file in ChemDraw: bonds, wedges, ring double bonds, labels (R₁, CH₃),
  polymer brackets with n / x, ⊕ / ⊖, arrows and captions.
- [ ] ★ **Pick and insert.** Click a polymer: it is outlined with its brackets, its n and its charges. **Insert
  selected**: it goes into the document at ChemDraw's size, crisp. **Insert whole page** on a long file is
  refused with its size in inches.
- [ ] **Edit.** **Atom**, type `N`, click a ring carbon: the ring becomes a pyridine (N, no H). Click a chain carbon:
  NH. **Bond**: click a bond — double, triple, single. Style **Wedge**, click a bond; click again — it turns round.
  **Add bond** on an end atom: a zig-zag continues. **Erase** an atom. **Undo**, **Redo**.
- [ ] **Names.** Change a structure that has a ChemDraw name under it: the name is outlined in orange; Insert says
  "Check “…”: ChemDraw computed that name before the structure changed".
- [ ] **Save as .cdxml**, open the saved file in ChemDraw: your edits are there and nothing else changed.
- [ ] **Refusals.** A .cdx file: "binary ChemDraw files (.cdx) are not read yet — … Save As ▸ ChemDraw XML".

## 0co. New in v2.151.0 — Drawing (CAD): draw on the drawing

Home ▸ **Drawing (CAD)**, **Drawing standard: Patent drawing**. Build a table: **Block** 120 × 60 × 4 moved to Z 70
(the top) and four **Blocks** 5 × 5 × 70 at the corners (the legs).

- [ ] ★ **Numerals stay on.** Press **Add callout** once: it turns solid and reads **Stop placing callouts**. Click
  the top, then each leg: every click places the next numeral (10, 12, 14 …), its number shows on the canvas, and
  the status names the part. **Esc** ends it. Every numeral is on the sheet in the views where its point is seen.
- [ ] ★ **Draw on the drawing.** Under **Draw on the drawing**: **Arrow** — drag from empty space to a leg in the
  isometric figure; **Numeral** — drag from a joint to the side (the number goes where you let go); **Text** — type
  `TABLE TOP`, click beside the figure; **Pencil** — draw a wavy line. Each appears on the sheet as drawn.
  **Erase** a mark, **Undo mark** brings it back.
- [ ] **Marks follow their figure.** Untick **Top**: the remaining figures are laid out again and every mark
  stays on its own figure. Tick it back.
- [ ] **Insert, then Edit drawing at cursor**: the marks come back with the drawing.
- [ ] **Blank figure.** **New drawing** (twice), untick every view, tick **Blank figure**: an empty FIG. 1. Draw on
  it with the Pencil and add a Numeral and Text; **Insert drawing** puts it in.
- [ ] **Large window** (Open large canvas): the same tools draw on the larger sheet.

## 0cn. New in v2.150.0 — Drawing (CAD): import DXF drawings

Home ▸ **Drawing (CAD)** ▸ **Import DXF…** (under New drawing). For a test file, open a Solid Edge draft and
**Save As → DXF**, or use any DXF you have.

- [ ] ★ **A Solid Edge draft.** Import the DXF: a preview appears with a line such as "… 412 items from its model
  space", what was not drawn (e.g. hatching), and the units. **Insert imported drawing**: the drawing goes into
  the document, fitted to the page if larger, and the status gives its true size. Compare it with the draft in
  Solid Edge: views, dimensions, notes, Ø / ° / ± symbols, dashed hidden and centre lines.
- [ ] **No units in the file.** (AutoCAD "unitless" drawings.) The status says the file does not say its units;
  Insert is off until **Units** is chosen. Choose **inches**: the true size in the status is 25.4 × larger than
  with millimetres.
- [ ] **Edit as a sketch.** Import a single flat outline (Solid Edge: a flat pattern saved as DXF, or a part
  outline). **Edit as a sketch**: the large window opens with the outline; **Done** adds it as a part (extruded
  10 mm). A full draft with splines is refused by name; an outline with a gap says how many ends are open.
- [ ] **Refusals.** Pick a .par or .dft file: "… can only be read by Solid Edge — in Solid Edge, use Save As …".
  A .dwg: "save the drawing as DXF".
- [ ] **Edit drawing at cursor** on an imported picture: it says the picture is an imported DXF drawing, not
  "not made by the Drawing tool".

## 0cm. New in v2.149.0 — Drawing (CAD): draw like Solid Edge; drawing sheets, title blocks, line types

Home ▸ **Drawing (CAD)**. In the shape list choose **Sketch (draw your own)** and press **Add part**: the sketch
now opens in a **large window** (90 % of the screen). **Done** brings the part back to the pane; **Cancel** closes
the window.

- [ ] ★ **The box in five actions.** Press **R**, type `40`, **Tab**, `20`, click on the canvas: a 40 × 20
  rectangle, both sizes shown as dimensions; the status says "Fully defined apart from position". **Ctrl+Z**
  takes it back in one step.
- [ ] **Click a corner, then type.** **R**, click a corner, type `30` **Tab** `15`, **Enter**: the rectangle goes
  toward the cursor. A **Line**: click, type the length (**Tab**: the angle), **Enter**; the chain continues; Esc
  or right-click ends it. A **Circle**: type the diameter, click the centre.
- [ ] **The grid.** A plain click-click rectangle lands on round numbers (the grid spacing shows beside **Grid
  snap**, in mm, and follows the zoom). The cursor locks onto existing corners and line midpoints; green guides
  show when it lines up with a point already drawn. **G** turns the snap off.
- [ ] ★ **Smart Dimension.** **D**, click an edge: its length is offered; type a new value, **Enter** — the edge
  changes. Click an edge that already has a dimension: it edits that one (no conflict message). Two parallel
  edges: the distance between them. Two edges at an angle: the angle.
- [ ] **Keys and view.** S, L, R, C, A, P, T, D pick tools; **Esc** twice returns to Select; the wheel zooms;
  middle-drag (or Space + drag) pans; **F** fits the sketch. Select and Trim act exactly where you click, even
  zoomed in, whatever the grid.
- [ ] **Done is at the top** (with Extrude / Revolve and the depth), the prompt line above the canvas says what to
  click next, and the value box sits above the canvas.
- [ ] ★ **A framed ISO sheet.** Standard **ISO**, **Sheet A3**: the drawing gets a frame (20 mm filing margin),
  grid references (numbers along the top and bottom, letters down the sides, no I or O), centring marks, the size
  "A3" bottom right, and the ISO 7200 title block bottom right. Open **Title block**, fill Title, Identification
  number, Created by …: they appear in the block; the readout names the required fields still empty.
- [ ] **ASME sheet.** Standard **ASME**, **Sheet B**: border with zones (A1 at the lower right), the title block
  with SCALE filled in. **Sheet A** offers **Portrait (vertical)**.
- [ ] **Patent drawings stay unframed.** Standard **USPTO**: the Sheet list is off and says why (37 CFR 1.84(g)).
- [ ] **Layers and line types.** Untick **Frame and grid**, **Title block**, **Callouts** or **View titles**: each
  leaves the preview and the inserted picture. **Line types** lists each line with its standard designation,
  width and dash pattern.
- [ ] ★ **Insert fits the page.** Insert an A3 sheet: it fits the page width, and the status says "The A3 sheet is
  inserted at 38 % to fit the page; SCALE … holds when it is printed on A3". An unframed ASME drawing is fitted
  too (it used to go in 254 mm wide). **Save sheet (SVG, true size)** downloads the sheet at its real size.
- [ ] **Re-open.** **Edit drawing at cursor** on the inserted sheet brings back the sheet, title block and layers.
- [ ] **Mac.** Repeat the box, Smart Dimension and the A3 sheet on Word for Mac (the large window included).

---

## 0cl. New in v2.148.0 — Drawing (CAD): sketch your own parts, the full toolset, New drawing, PowerPoint

Home ▸ **Drawing (CAD)**. In the shape list choose **Sketch (draw your own)** and press **Add part**: the sketch
editor opens (in the pane, or bigger in **Open large canvas ⤢**). Free geometry draws **blue**, fully defined
geometry **black**; the line under the canvas says how many degrees of freedom are left and what is still free.

- [ ] ★ **Draw and dimension a plate.** **Rectangle**: click two corners. The status says 4 degrees of freedom.
  **Select**, click the bottom edge, type `60` in the value box, **Dimension**; click the left edge, type `40`,
  **Dimension**. It reads "Fully defined apart from position"; click a corner, **Fix**: "Fully defined", and the
  lines turn black. Click the `60` label, type `80`, **Dimension**: the plate widens, the 40 stays.
- [ ] **A hole and a fillet.** **Circle**: centre, then a point on it. Select it, type `Ø10`, **Dimension** (the
  label reads Ø10). Select the bottom and right edges, type `R6`, **Fillet**: the corner rounds; the message says
  the corner is kept as a construction point. Change the 80 again: the fillet follows.
- [ ] **Make the part.** Depth `8`, **Done**: the plate with its hole and rounded corner appears in 3D and on the
  sheet. **Edit sketch** re-opens it exactly as left.
- [ ] **The rest of the toolset** — each makes what its name says, and refuses by name when it cannot:
  **Centre rect**, **Polygon** (set Sides first), **Slot** (two end centres, then the width), **3-pt arc**,
  **Chamfer** (two lines, a distance), **Offset** (a line, a circle, or every line of a closed outline; negative
  goes inward), **Mirror** (select what to mirror, then the mirror line LAST), **Pattern** (Count, and spacing in
  the value box: `20` or `0 15`), **Circular** (select the copies' source and a centre point; empty box = 360°),
  **Trim** (click the part of a line to cut away), **Clear sketch** (then **Undo** brings it back).
- [ ] **Relations.** H, V, ∥, ⊥, Tangent, =, ◎, Join, On, Mid, Sym, Fix each work on the right selection, and say
  what to select otherwise. A third dimension on a fully defined rectangle is refused as already fixed and offered
  as **Driven** (tick Driven, Dimension: it shows in parentheses).
- [ ] **Refusals.** **Done** on an open outline says where it is open. A value the shape cannot take ("turn an
  outline inside out") leaves the sketch as it was.
- [ ] **Revolve.** Draw half a shaft profile beside a construction line, select the line, choose **Revolve about
  the selected line**, **Done**: a turned part.
- [ ] ★ **New drawing.** Press **New drawing**: it asks you to click again. Click again: every part and callout is
  gone. The button now says **Undo clear**: press it and everything comes back, standard and views too.
- [ ] ★ **Export to PowerPoint.** Press **Export to PowerPoint**: a .pptx downloads with the sheet on a titled
  slide; open it in PowerPoint and check the drawing is sharp when zoomed.
- [ ] **Alt-text size probe.** Make a big sketch (a polygon of 40 sides, patterned 3 times), insert it, then
  **Edit drawing at cursor**: the sketch comes back whole. Record the drawing's model size if it fails.
- [ ] **Mac.** Repeat the plate, New drawing and Export to PowerPoint on Word for Mac.

---

## 0ck. New in v2.147.0 — Drawing (CAD): build in 3D, insert engineering and patent drawings

Home ▸ **Drawing (CAD)** (or the tool menu ▸ Drawing). It opens on a plate with two holes, shaded in the 3D view,
with an **ASME** sheet previewed below. The automated gates cannot prove what a printed page measures, so this pass
does that.

- [ ] **Orbit.** Drag on the 3D view: the part turns smoothly, without stutter. Let go: crisp black edges appear on
  the shading within a moment. The mouse wheel zooms. Front / Top / Right / Isometric snap to those views.
- [ ] **Edit.** Change Width to 120: the part and the sheet both update. Type 0 in Thickness: a red-orange message
  names the field ("Thickness (Z) must be greater than 0"), and Insert is disabled. Restore it.
- [ ] **Refusal.** Add part ▸ Flange; set Bolt circle diameter to 78: the message says "the bolt holes break through
  the outside edge", and nothing is drawn wrong.
- [ ] **Assemble.** With the flange selected, set Move Z = 8 and Move X = 40: it sits on the plate. Click the plate in
  the 3D view: the plate is selected (blue tint) and its fields show.
- [ ] **Callouts.** Press **Add callout**, click the plate's top face, then the flange's face: balloons **1** and
  **2** appear on the sheet ONCE each — in the isometric view, in columns beside it, not over the view titles (a
  balloon identifies its part once per sheet). Switch the standard to **USPTO**: the balloons become numerals on
  lead lines (10, 12, … continuing your Numerals table) in EVERY figure that shows the point, and the views are
  labelled FIG. 1–4 in reading order.
- [ ] ★ **Large canvas.** Press **Open large canvas ⤢**: a big window opens with the same parts, callouts,
  standard, views and hidden-line choice — controls on the left, a large 3D view in the middle, the sheet on the
  right. Drag to turn it: smooth, and the pin of the overlap step (below) never shows through the plate. Change a
  dimension there and press **Use this drawing**: the window closes and the pane shows the change. Open it again
  and press **Insert drawing**: the window closes and the drawing is inserted at the cursor. Open it once more and
  press **Cancel** (or close the window): the pane is unchanged. Resize the window: the 3D view follows.
- [ ] **Large canvas, big model.** Add parts until the model is large (e.g. six flanges, each with 12 bolt holes),
  then open the large canvas: it still opens on the model (a long model is handed over after the window opens). If
  it cannot be handed over, the pane says so — the window never opens blank.
- [ ] ★ **Insert ASME, then MEASURE.** Insert the ASME sheet. In Word: right-click ▸ Size and Position. The picture
  should be **254 mm** wide (the ASME drawing area). Print it, or zoom to 100 % with a ruler on screen:
  - view titles (FRONT, TOP…) are about **6 mm** tall;
  - balloon numbers about **3 mm**;
  - visible lines clearly about twice as thick as hidden (dashed) lines;
  - "SCALE 1:1" (or 1:2 …) bottom-left, and the third-angle symbol bottom-right: circles LEFT of the cone, and
    the cone's NARROW end pointing at the circles.
  Record any measurement that is off.
- [ ] ★ **USPTO sheet.** Switch to USPTO and insert. The picture fits the 170 × 244 mm sight, shows no "SCALE" text,
  and numerals measure at least **3.2 mm** (they are set at ~3.5 mm).
- [ ] **ISO.** Switch to ISO: the TOP view moves BELOW the front, RIGHT SIDE moves to its LEFT, the symbol flips
  (circles RIGHT of the cone, its narrow end still on the left, pointing AWAY from them), and the text is smaller
  (2.5 mm).
- [ ] **Callouts follow their part.** With callout 2 on the flange, set the flange's Move X to 0: the balloon's
  leader follows it. Make the flange's outside diameter much smaller so the clicked point is off it: the message says
  "Callout 2 no longer touches …, so it is not drawn — place it again". Delete the flange (×): the status line says
  its callout went with it.
- [ ] **Overlapping parts.** Add part ▸ Cylinder (Ø10 × 40) and move it so it passes through the plate. The message
  names both parts and says they are drawn as separate parts passing through each other. In the Isometric view the
  ring where the pin enters the plate is drawn, and no edge of the pin shows through the plate.
- [ ] **Pointed cone.** Add part ▸ Cone (Top diameter 0): in every view both outlines run all the way to the tip.
- [ ] **Hidden lines.** The Hidden lines list: "As the standard says" (ASME: dashed in the orthographic views
  only), "Show (dashed)" (also in the isometric), "Hide" (none). Switch back to "As the standard says": the
  ASME default returns.
- [ ] **Edit drawing at cursor.** Click an inserted drawing in the document, then press **Edit drawing at cursor**:
  the parts, callouts, standard and views come back exactly. Click a photo or a chart instead: it says the picture
  was not made by the Drawing tool. With nothing selected: it asks you to select a drawing.
- [ ] **Undo.** Ctrl/⌘+Z after an insert removes the drawing (two presses: the drawing, then its hidden tag).
- [ ] **Mac.** Repeat Orbit, Callouts, Large canvas and Insert ASME on Word for Mac.

---

## 0cj. New in v2.143.0 — Journal-grade figures: figure styles, the vector-insert probe, significance brackets, panels

A **Figure style** row now sits under **Plot, Table → Chart, Statistics, Finance and Bio/Assay** (and ONLY those:
check it is absent from Engineering, Spectra, Sequence Map, Solve and the 3D model, whose figures still insert as
drawn). It holds the style (**As drawn** / Nature / Elsevier / ACS / Cell Press / Thesis (serif) / USPTO drawing),
the width (single / 1.5 / double column), an **Insert as vector SVG (experimental)** tick box (OFF by default),
and the **Multi-panel figure** tray. Every figure insert now says HOW it went in, e.g. "Plot inserted as PNG at
384 dpi." The dpi is read from the PNG that was inserted, not from what was asked for.

**Vector insert probe — do this FIRST, on Word for Windows, Word for Mac and Word on the web.** The vector route is
half-documented (brief §A.3/§E1), so it ships OFF and this probe decides whether it can be turned on. Record every
answer; "it looked fine" is not an answer. Use **Script Lab** (Insert ▸ Add-ins ▸ Script Lab) with a new snippet.
Put this at the top of the snippet:

```js
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#fff"/>' +
  '<line x1="0" y1="90" x2="200" y2="90" stroke="#000"/><text x="10" y="50" font-family="Arial" font-size="16">−2.5 ×10⁴ H₂O</text></svg>';
const svgB64 = btoa(unescape(encodeURIComponent(svg)));
// A 1×1 PNG. If you SEE a solid little square, Word drew the PNG fallback, not the SVG.
const png1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
```

- [ ] ★ **Probe A — `insertInlinePictureFromBase64` with SVG.**
  `await Word.run(async (c) => { const p = c.document.getSelection().insertInlinePictureFromBase64(svgB64, "After"); p.load("width,height"); await c.sync(); console.log(p.width, p.height); });`
  Record: an error, nothing, or a picture. If a picture: its width × height in points (200 × 100 px should be
  **150 × 75 pt**), whether the text is sharp at 400 % zoom, and (Windows/Mac) Picture Format ▸ the picture is an
  SVG ("Convert to Shape" is offered only for SVG).
- [ ] ★ **Probe B — `insertOoxml` with an SVG plus a PNG fallback** (how Word itself stores an SVG). Paste this
  after the lines above and run it:

```js
const ooxml = `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">
<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>
<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/f.png"/><Relationship Id="rIdSvg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/f.svg"/></Relationships></pkg:xmlData></pkg:part>
<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="901" name="svg probe"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="901" name="svg probe"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPng"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip r:embed="rIdSvg"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document></pkg:xmlData></pkg:part>
<pkg:part pkg:name="/word/media/f.png" pkg:contentType="image/png" pkg:compression="store"><pkg:binaryData>${png1}</pkg:binaryData></pkg:part>
<pkg:part pkg:name="/word/media/f.svg" pkg:contentType="image/svg+xml" pkg:compression="store"><pkg:binaryData>${svgB64}</pkg:binaryData></pkg:part>
</pkg:package>`;
await Word.run(async (c) => { c.document.getSelection().insertOoxml(ooxml, "After"); await c.sync(); });
```

  Record per host: the SVG text ("−2.5 ×10⁴ H₂O", sharp at 400 %) or the solid square (the PNG fallback), or an
  error. **Word on the web showing the square is the honest-degradation result we want**; the web showing nothing
  or an error rules this route out. The picture should be 150 × 75 pt (1 905 000 × 952 500 EMU).
- [ ] ★ **Probe C — the shipped XmlSvg route (Windows and Mac).** In JurisLab, Plot, `sin(x)/x`, tick **Insert as
  vector SVG**, **Insert**. Record the status line word for word. Then:
  - It should read "Plot inserted as vector SVG." If it reads "… but Word reports it stored the picture as …",
    Word did not keep the SVG: record the format.
  - The picture is **inline** (moves with the text), not floating in front of it. If it floats, record that — the
    pane then says "no new inline picture is in the document" and inserts nothing else.
  - Its size (Picture Format ▸ Size) equals the PNG insert of the same plot with the box unticked (as drawn: the
    SVG's own px × 0.75 pt). Insert both and compare: the widths must match to 0.1 cm.
  - **imageWidth units.** In Script Lab run
    `Office.context.document.setSelectedDataAsync(svg, { coercionType: Office.CoercionType.XmlSvg, imageWidth: 150 }, (r) => console.log(r.status));`
    and record the picture's width in points: 150 means points, 112.5 means px. (JurisLab passes no imageWidth;
    it finds the picture again and sizes it in points.)
  - Right-click ▸ **Convert to Shape** (Windows/Mac 365): the tick labels become editable text, not outlines.
    Nature requires editable text. Record whether the minus signs, ×10ⁿ superscripts and subscripts survive.
  - In Script Lab: `Word.run(async (c) => { const p = c.document.body.inlinePictures; p.load("items/imageFormat"); await c.sync(); console.log(p.items.map((x) => x.imageFormat)); })`
    → the vector figure reads **Svg**, the PNG ones **Png**.
- [ ] **Web and unknown hosts stay PNG.** Word on the web, box ticked → "Plot inserted as PNG at N dpi; not vector:
  Word on the web cannot insert vector pictures (ImageCoercion 1.2 is not available there)." Box unticked on any
  host → "Plot inserted as PNG at N dpi." with no vector excuse.

**Figure styles**
- [ ] ★ **As drawn is unchanged.** Style **As drawn**: insert a Plot, a Table → Chart column chart, a Stats t-test
  chart, a Finance chart and a Bio/Assay fit. Each is the same size and sharpness as in v2.142.0 (compare against
  a v2.142.0 document if you have one). The width selector is disabled.
- [ ] ★ **Nature, single column.** Plot `sin(x)/x` → style **Nature** → Insert → status "Plot inserted as PNG at N dpi
  (Nature, 89 mm, text a–b pt)" with a and b both inside 5–7 pt. Picture Format ▸ Size: width **8.9 cm**, and the tick labels print small
  but readable (≈ 2 mm). **Double column** → 18.3 cm.
- [ ] **Table → Chart under a journal style** uses the Okabe–Ito colours with a different marker and dash per
  series (the preview changes when you pick the style). Print in greyscale: the series still separate.
- [ ] ★ **USPTO.** Table → Chart, a two-series column chart with a title → style **USPTO drawing** → the preview
  is black-and-white hatching and has **no title**; Insert → width **17.0 cm**, status says "characters at least
  3.5x mm high". Measure a tick numeral on a printout: **≥ 3.2 mm** (1/8 in), with margin. Switch the chart to
  **Heat map** → Insert is refused: "USPTO drawing (black and white) cannot draw a heat map: … 37 CFR 1.84(a)(1)
  …". **1.5 column** under USPTO → refused: "has no 1.5-column width".
- [ ] **A refusal names the rule.** Finance → any chart → style **Nature** → Insert. If the figure cannot meet
  Nature as drawn, the status names the rule it misses (e.g. "… print below 5.00 pt …") and the RESULT text still
  went in ("Result inserted, but the chart could not be: …"). Nothing is inserted under a journal's name that
  does not meet it.

**Significance brackets (Statistics)**
- [ ] ★ **Two-sample t-test.** Stats → Two-sample t-test (defaults) → the **Significance brackets** row appears →
  **Stars** → one bracket over the two boxes with the star class of the test's own p, and a caption under the
  figure: "* p < 0.05; ** p < 0.01; …; ns p ≥ 0.05. t-test." **Exact p values** → the bracket reads the same p as
  the result text above it. **Insert chart** → the caption goes in as a paragraph under the picture.
- [ ] **Paired t-test** → the caption says **paired t-test**, and the bracket joins cond. 1 and cond. 2 (not the
  difference box).
- [ ] ★ **Tukey HSD** (3+ groups) → brackets on → the figure becomes the box plot of the groups with one bracket per
  pair; the caption says "Tukey HSD, N pairwise comparisons; p values are family-wise adjusted". **Hide ns** → the
  ns brackets disappear and the caption counts them (e.g. "2 non-significant comparisons not shown"). Brackets **Off**
  → the forest plot is back.
- [ ] **Too many brackets.** Tukey with 6 groups, Exact p, Hide ns off → if they do not fit, the pane says
  "Significance brackets could not be drawn: …" and names ONLY remedies that can work: **Taller figure** only when
  the taller figure would fit; otherwise "more height does not help here" with **Hide ns** / fewer groups / a wider
  figure. The plain figure stays.
- [ ] **α is the engine's.** Tukey, groups `1 2 3 4 5` / `6 7 8 9 10` / `11 12 13 14 15` / `3 4 5 6 7`, α = 0.01,
  Stars → pair 2 vs 4 (p ≈ 0.038, no "*" in the text) is drawn **ns**, and **Hide ns** hides it; the caption reads
  "** p < 0.01; … ns p ≥ 0.01". At α = 0.10 a pair with 0.05 ≤ p < 0.10 that the text stars is drawn "†" and the
  caption says "† p < 0.1".
- [ ] **Kruskal–Wallis** with a significant result → brackets on → caption "Dunn; N comparisons, p values adjusted
  by Holm." With a NON-significant result the bracket row does not appear (no post-hoc ran, so no bracket exists).
- [ ] **Mann–Whitney** and **Wilcoxon** → the caption names the test. Other Stats tests show no bracket row.

**Multi-panel figures**
- [ ] ★ **Two panels under Nature.** Style **Nature**, width **Double**. Plot → a figure → **Add this figure to the
  panels**; Stats → t-test with Stars → **Add**. The tray reads "2 panels: 1. Plot · 2. Statistics." Columns **2** →
  **Insert the panels as one figure** → one picture 18.3 cm wide, bold lowercase **a** and **b** at the top-left
  of each panel, the bracket legend as the caption ("b: …").
- [ ] **Cell / USPTO letters.** The same under **Cell Press** → uppercase **A**, **B**; under **USPTO** (Table → Chart
  patent charts) → **FIG. 1A**, **FIG. 1B**. USPTO with Columns **1**, if the stack prints taller than 244 mm → refused: "… above the 244 mm maximum
  height; use more columns or fewer panels".
- [ ] **As drawn panels** have no letters (a letter style belongs to a figure style), each panel at its own size.
- [ ] **Clear the panels** empties the tray; Insert is disabled with fewer than two panels.

**Display contract in the figures**
- [ ] In every inserted figure above: negative tick labels use a true minus (−2.5, not -2.5), large and small
  values use ×10ⁿ (never 5.0e+5), and every tick row has the same number of decimals (0.0, 0.5, 1.0).

## 0ci. New in v2.142.0 — Citation styles, BibTeX/RIS import and numbered bibliographies

**Citations** has a new **Bibliography** panel below the Bluebook form. Import references, pick one of seven
styles, insert citations at the cursor, and press **Update numbering & bibliography** after any add, move or
delete. Nothing is looked up online. Citations stays out of the Science filter on Home (it is a legal tool); open it from the full tool list.

**Import**
- [ ] ★ **BibTeX paste.** Paste
  `@article{Kwon_2022, title={Inclusion Work: Children of Immigrants Claiming Membership in Everyday Life}, volume={127}, DOI={10.1086/720277}, number={6}, journal={American Journal of Sociology}, author={Kwon, Hyeyoung}, year={2022}, pages={1818–1859}}`
  → **Import pasted text** → "BibTeX: 1 reference read." and "Added (1): Kwon_2022". The library list shows
  **Kwon_2022 · Kwon 2022 · Inclusion Work: Children of Immigrants Claiming Membership…**.
- [ ] **Same paste again** → "Skipped as identical to the library copy (1): Kwon_2022". Change the year to 2023
  and import → "Renamed, because a different reference already uses the key (1): Kwon_2022 → Kwon_2022-2".
- [ ] **A refusal has a line number.** Paste `@article{a, title={ok}, year={2020}}` then a blank line then
  `@article{b, title={Unbalanced, year={2020}` → a line starting "Line 3:" names the problem, and record `a` is
  still added.
- [ ] **Files.** **Open .bib / .ris / .json file…** with a Zotero .bib export, a Zotero or EndNote .ris export,
  and a Zotero CSL-JSON export → each reads its references. An EndNote RIS file (one space in `TY - JOUR`) is read
  as RIS. A RIS podcast entry (`TY  - SOUND`) is refused with its line number, by type.
- [ ] ★ **DOI paste, offline.** Paste `doi:10.1086/720277.` → "DOI 10.1086/720277 → https://doi.org/10.1086/720277",
  the line "JurisLab works offline, so it can't look a DOI up. Paste the reference's BibTeX or RIS from the publisher
  page to fill everything.", and (after the Kwon import) "10.1086/720277 is already in the library as “Kwon_2022”."
  No record is created. Turn Wi-Fi off and repeat: the same result.
- [ ] **PubMed .nbib.** Open a PubMed "Citation manager" (.nbib) export, or paste one (it starts `PMID- `) →
  "This is a PubMed MEDLINE (.nbib) file — not supported yet; export RIS from PubMed instead." Nothing is added,
  and it is NOT reported as "1 DOI recognised".
- [ ] **IEEE prints the DOI once.** Choose **IEEE**, import the Crossref Kwon BibTeX with
  `url={http://dx.doi.org/10.1086/720277}` added → the reference ends `…, May 2022, doi: 10.1086/720277.` with no
  "[Online]. Available: http://dx.doi.org/…" after it.

**Styles**
- [ ] **Seven styles.** The Reference style list shows exactly IEEE, ACS, Nature, Vancouver (NLM), APA 7,
  Chicago author-date (CMOS 18) and Chicago notes-bibliography (CMOS 18). The line under it reads "Harvard (Cite
  Them Right) and MLA 9 are not offered: no official guide could be verified."
- [ ] ★ **Refused by name.** Choose **Nature**, select a book in the library → the preview says "refused" and
  **Insert citation** says "“…” is a book; Nature does not format books here (…). Choose a style that does, or
  leave it out. It was not formatted in another style." Same for a patent under IEEE; **Vancouver** formats it.
- [ ] **Converted titles.** Choose **APA 7** and select Kwon → the preview shows "Inclusion work: Children of
  immigrants claiming membership in everyday life" with "[title case changed; as imported: “Inclusion Work: …”]",
  and the note under it explains that sentence case can lowercase names such as Raman.
- [ ] **Vitamin A.** In APA 7, a title `Vitamin A Deficiency in Children` previews as **Vitamin A deficiency in
  children** and `Protein Kinase A Signaling in Neurons` as **Protein kinase A signaling in neurons**, never
  "Vitamin a" or "kinase a".
- [ ] **APA year letters.** In APA 7, cite `Smith, John` (2020) and `Smith, Anna` (2020) → Update → the two
  markers differ, and neither reads 2020a/2020b (APA tells different authors apart by their initials). Two
  undated works by the same author → the markers differ (n.d.-a, n.d.-b), and are never two identical "(Smith, n.d.)".
- [ ] **Chicago short note without a page.** In Chicago notes, cite Kwon twice with no page → the second footnote
  reads **Kwon, “Inclusion Work.”**, ending in a single period inside the quotes, never `.”.`

**Insert and update**
- [ ] ★ **IEEE numbering.** Import three references (A, B, C). Choose **IEEE**. Insert A, then B, then C in three
  paragraphs → **[1]**, **[2]**, **[3]**. Each sits in a content control titled "JurisLab citation".
- [ ] ★ **Move a citation earlier.** Cut the **[3]** control (click its tab to select the whole control) and paste
  it into the first paragraph, before [1] → **Update numbering & bibliography** → the moved one reads **[1]**, the
  others **[2]** and **[3]**, and the References list at the end is in the new order with matching labels.
  Press Update again → "Updated 0 citations", nothing changes.
- [ ] ★ **Delete a citation, then Undo.** Delete the [2] control → Update → the list drops that reference, and the
  message lists it under "Not cited" and its marker under "Deleted citations … (kept so Undo can restore them)".
  Press **Ctrl/⌘+Z** until the control is back → Update → the original numbering returns.
- [ ] ★ **One Undo per update.** After an Update that renumbered several citations and rewrote the bibliography,
  press **Ctrl/⌘+Z once** → note whether ALL of that update is reverted in one step, or how many presses it takes.
- [ ] **Add to a citation.** Put the cursor inside the [1] control, select a second reference, **Insert citation**
  → "Added to the citation at the cursor." and the control reads **[1], [2]** (later numbers shift).
- [ ] **Locator.** Select one reference, type `45` with *page* → IEEE **[n, p. 45]**; APA **(Kwon, 2022, p. 45)**.
  With two references selected and a locator → refused ("A locator … belongs to one reference").
- [ ] **ACS / Nature superscripts.** Switch to **ACS** → the message asks you to Update → Update → markers become
  superscript **¹** style numbers (not "[1]"), and the list labels read **(1)**, **(2)**. Nature: labels **1.**,
  **2.** (ACS "(1)" and Nature "1." list labels are conventional forms, not pinned by a quoted manual example:
  note whether they match your target journal.)
- [ ] **APA order.** Switch to **APA 7** → Update → markers read like **(Kwon, 2022)**, and the list is
  alphabetical and unnumbered under **References**.
- [ ] **Chicago notes.** Switch to **Chicago notes-bibliography** and **Insert citation** → a **footnote** is
  created holding the note. Cite the same source again → the second note is the short form. The list heading reads
  **Bibliography**. On a Word without WordApi 1.5 the insert is refused by name instead.
- [ ] **Copied citation.** Copy a citation control and paste the copy elsewhere → Update → "Copied citations (1) …";
  both copies show the same text.
- [ ] **Orphan citation (automated only).** The panel has no "remove from library" button, so a citation whose
  record is gone cannot be produced from the pane. bibPaneRouting.test pins the behaviour: such a citation is
  rewritten to **[?]**, with "Missing from the library … now shown as “[?]” so its old number cannot point at
  another reference". It never keeps a number that now belongs to another reference. Tick this box if no
  Update in this pass ever showed two different citations with the same number.
- [ ] **Bibliography moves with you.** Cut the inserted bibliography block and paste it mid-document → Update →
  it is replaced where it now is, not re-added at the end.

**Word limits (unverified in code; record what you see)**
- [ ] ★ **64-character tag limit.** Insert a citation, then Developer ▸ Properties on the control → the Tag reads
  `formula-inserter:cite:1` (23 characters). To probe the limit, type a 64-character tag by hand into the Tag box
  (e.g. `formula-inserter:cite:` followed by 42 `z`) and press OK, then try 65 characters. Record whether Word
  accepts 64 and refuses or truncates 65. JurisLab never writes a tag over 64 (the id is a short base-36 counter,
  and citeTag refuses by name any id that would push the tag past 64).
- [ ] ★ **Document-settings size (1.9 MB budget).** Open a large real library (a Zotero export with several
  hundred DISTINCT entries; identical entries are skipped, so one entry pasted many times does not grow the store)
  and import it several times under renamed keys until the message refuses with "The reference library is … bytes;
  a document can hold about 1,900,000." Before that refusal, save, close and reopen the document → the library is
  still there. Record the largest size that saved, in Word desktop and in Word Online.
- [ ] **Newer or damaged store.** (Optional.) A document whose library was written by a newer JurisLab shows
  "made by a newer JurisLab" and the panel's buttons are disabled; the setting is never overwritten.


The field-based Table of Authorities (**Citations → Insert with live page numbers (Word field)**) no longer re-finds citations by a
loose substring search. The pane now plans every Word search from the exact positions the scanner found: it
searches **case-sensitively**, runs every search **before** inserting any TA field, and marks only the hits it
planned. Anything it cannot place is **counted in the message** ("N citations could not be placed by Word’s
search (unattributed) and were left unmarked"), never dropped silently. For each check below, build the table,
select all, press **F9**, and read the page list.

**Which pages an authority gets**
- [ ] ★ **Doe/Smith pair.** Page 1: `Doe v. Roe, 10 F.3d 5 (9th Cir. 1993).` Page 3: `Smith v. Jones, 110 F.3d 512
  (2d Cir. 1997).` → Doe v. Roe lists **1** only, and Smith v. Jones lists **3** only. (Before this release, Doe
  also got page 3.)
- [ ] **§ 10 vs § 101.** Page 1: `35 U.S.C. § 10`. Page 2: `35 U.S.C. § 101`. → § 10 lists **1** only.
- [ ] ★ **Id. and said.** Page 1: `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014).`, then `Id. at 216.` on page
  2. Put `The examiner said.`, `The fee was paid.` and `The claim is valid.` on pages 4, 5 and 6. → Alice lists
  **1, 2** and never 4, 5 or 6. Then add `Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66
  (2012).` on page 7 and a bare `Id.` on page 8 → Mayo lists **7, 8**, Alice still lists 1, 2, and the message
  reports no unattributed citations.
- [ ] ★ **Curly and straight apostrophes.** Page 1: `Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014)` (curly,
  as Word autocorrects it). Page 4: paste `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014)` (straight;
  undo the autocorrect if needed). → **one** row, pages **1, 4**, no "unattributed" count.
- [ ] ★ **Word's Find and quotes.** (The Alice step above searches `573 U.S. 208`, which has no apostrophe, so it
  cannot show this.) Page 1: `O’Brien v. Doe, 12 F.3d 34 (1st Cir. 1994).` Page 2: `O'Brien, 12 F.3d at 36.`
  (straight). Page 3: `O’Brien, 12 F.3d at 36.` (curly). → O’Brien lists **1, 2, 3** and the message reports no
  unattributed citations. This confirms that Word's Find treats curly and straight quotes alike. If the message
  reports **2** unattributed citations instead, note it: Word's Find does NOT fold quotes on this build.
- [ ] **Non-breaking spaces.** Type `35 U.S.C.` Ctrl+Shift+Space `§` Ctrl+Shift+Space `101` (Mac: ⌥Space). → the
  statute is listed with its page, or the message names it as unattributed. It is never missing silently.
- [ ] **Passim.** Cite `35 U.S.C. § 101` on 5 or more pages → Word's table shows **passim** (the `\p` switch).
  Then **Insert formatted list** → the static list also says **passim**, not a blank page slot.
- [ ] **In re short form.** `In re Wands, 858 F.2d 731, 737 (Fed. Cir. 1988).` on page 1, `Wands, 858 F.2d at
  740.` on page 2, `In re Wands, 858 F.2d at 741.` on page 3 → In re Wands lists **1, 2, 3**.
- [ ] ★ **Building twice changes nothing.** Build, F9, note every page list. Build again (cursor in the same
  place, after deleting the first table), then F9 → identical page lists. Then build a third time *without*
  deleting the table (or after **Insert formatted list**) → the page that holds the table is **not** added to
  every authority. If the message says an existing table "could not be located in the text", note it: that
  is the fallback, and the table's page may have been marked.
- [ ] **Scope line.** Every build message ends by saying what was scanned. On current Word it reads "Scanned the
  main text, N footnotes and M endnotes; …" and "Headers and footers are not scanned." On a Word without
  WordApi 1.5 it reads "Footnotes and endnotes were NOT scanned (this version of Word cannot read them) …", and
  "Marked N of M authorities found in the main text" never claims the notes.
- [ ] ★ **Footnote-only authority.** Cite `Mayo Collaborative Servs. v. Prometheus Labs., Inc., 566 U.S. 66
  (2012).` ONLY in a footnote on page 3 (References ▸ Insert Footnote). → Mayo is in the table with page **3**.
  Alt+F9 shows the TA field inside the footnote.
- [ ] ★ **Id. in a footnote.** Footnote 1 (page 2): Alice's full cite, then `Id. at 216.` in the same footnote →
  Alice lists 2. Footnote 2 (page 4) begins with `Id. at 217.` → NOT marked for Alice, and the message says
  "1 citation was deliberately left unmarked rather than guessed (refused): “Id. at 217” — Not placed: no
  citation precedes it." An Id. is never carried from one note to another, or from the text into a note.
- [ ] ★ **Word-built TOA.** In a brief with Alice cited on page 5, insert a TOA with Word's own **References ▸
  Insert Table of Authorities** on page ii (mark Alice with Word's Mark Citation first, F9). Then use this
  pane's button → Alice lists **5** only, never page ii, and the first `Id.` of the argument is not given to the
  last entry of Word's table.
- [ ] ★ **Hand-typed TOA.** Type a paragraph `TABLE OF AUTHORITIES`, then `Cases`, then a few entries such as
  `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014) ........ 5`, then an all-capitals heading such as
  `STATEMENT OF THE ISSUES`. Cite Alice on page 5. → Alice lists **5** only, and the message says "Skipped a
  typed “TABLE OF AUTHORITIES” up to “STATEMENT OF THE ISSUES”." Change that heading to `Statement of the
  Issues` (lowercase is not recognised as a heading) and make sure the next paragraph is ordinary prose longer
  than two lines → the message says "… up to the first paragraph of text", and Alice still lists 5. Then make the typed table the LAST thing in the document → the message says "A typed
  “TABLE OF AUTHORITIES” was found, but no heading after it marks where it ends …".
- [ ] **Claim numbers after §§.** `Claims 1-10 were rejected under 35 U.S.C. §§ 102, 103, 12 claims remain.` →
  the row reads **35 U.S.C. §§ 102, 103**, never "§§ 102, 103, 12" (§ 12 is an unrelated section). If the engine
  refuses the trailing member, the message lists it under "(refused)".
- [ ] **Id. after a record cite.** `Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014). See Appx12. Id.` → the
  `Id.` is NOT marked for Alice (it cites the appendix), and the message lists it under "(refused)" with the
  reason "the citation right before it (a record cite, …) is what it refers to (Rule 4.1)".

**What the table says**
- [ ] **eBay, iRobot, de Vries.** `eBay Inc. v. MercExchange, L.L.C., 547 U.S. 388 (2006)`, `iRobot Corp. v.
  SharkNinja Operating LLC, 19 F.4th 1 (Fed. Cir. 2021)` and `de Vries v. Doe, 1 F.3d 1 (1990)` → each row keeps
  its lowercase first letter (never `Bay Inc.`, `Robot Corp.` or `Vries v. Doe`), in the table and in the TA
  field text (Alt+F9 shows the codes).
- [ ] **§§ 102, 103.** `Rejected under 35 U.S.C. §§ 102, 103.` → one row **35 U.S.C. §§ 102, 103** with that
  page (§ 103 is not dropped). `37 C.F.R. §§ 1.97–1.98` keeps **§§** before the range.
- [ ] **One row per patent.** `U.S. Patent No. 7,469,381` and `U.S. Patent No. 7469381` → one row, **U.S. Patent
  No. 7,469,381**, with both pages.

**Citation form**
- [ ] **US10123456B2.** Type *Patent* with the number `US10123456B2` (and again with `US 10,123,456 B2`) →
  **U.S. Patent No. 10,123,456**. Paste `US 10,123,456 B2` into *Paste & fix a messy citation* → detected as a
  patent.
- [ ] ★ **Alvarez short form.** Case: name `United States v. Alvarez`, vol 567, reporter U.S., pin 715 → **→
  Short form of this case** → **Alvarez, 567 U.S. at 715** (not "United States, …").
- [ ] **Docket no.** The Case form has a new **Docket no. (unreported cases) (optional)** field. Paste `Acme Corp.
  v. Widget Co., No. 13-cv-1, 2015 WL 123456, at *3 (D. Del. Mar. 1, 2015)` → it fills the docket field, and the
  preview reproduces the paste exactly with only the case name italic.
- [ ] **Article year is optional.** *Law review article* with the shipped placeholders → **Mark A. Lemley,
  Software Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905, 912** (no `(2013)`). The Year
  label reads "(omitted when the volume is the year) (optional)". Volume 99, Va. L. Rev., year 2013 → ends
  **(2013)**.
- [ ] **T6 on United States of America.** With the T6 toggle on, `United States of America v. Microsoft
  Corporation` → **United States v. Microsoft Corp.**

---

## 0cg. New in v2.140.0 — Audio, video and light: levels, loudness, timecode, transfer curves, photometry and exposure

Engineering gains **17 calculators** (130 → 147) and a new panel, **Light & camera**, after *Video & display*.
Every one inserts its data AND a figure from its shipped defaults. Decibels are never units: each level field
names its reference.

**Audio & acoustics**
- [ ] ★ **Levels & references**, defaults (+4 dBu → dBFS, EBU R68) → **−14.0000 dBFS**; the list shows dBV
  **+1.7815**, V rms **1.22765 V**, "Pro +4 dBu over consumer −10 dBV **+11.7815 dB**", "0 dBFS under this
  alignment +18.000 dBu", speed of sound **343.2 m/s** at 20 °C. Figure: a **level ladder** (dBu, dBV, dBFS
  (AES17), V rms side by side) with a red marker on every scale. Switch to SMPTE RP 155 → −20.0000 dBFS.
  Set *Its reference* to dB SPL, value 94, *Convert to* Pa → **1.00237 Pa**; *Convert to* dBu with no
  microphone sensitivity → refused ("connected only by a microphone's sensitivity").
- [ ] **Level arithmetic & weighting**: sum 80, 80, 74 → **83.5241 dB**; *Subtract a background* with levels
  `85`, background 80 → **83.349 dB**; levels `82` → **refused** ("within 3 dB of the total"). *Weight band
  levels* (63 … 8k at 80) → **86.974 dB(A)**, Z 89.031 dB, each band "evaluated at" its exact base-10 centre
  (63 → 63.10 Hz). Levels `0 dBu, 0 dBV` sum (converted, said); `80 dB(A), 80 dB(C)` → refused.
- [ ] **Dither, oversampling & noise floor** (16-bit TPDF) → ideal **98.0905 dB**, penalty −4.7712 dB, floor
  **−93.3193 dBFS**; *Noise-shaped* → refused by name.
- [ ] **Audio data rate & file size** (48 kHz/24/2, 1 h) → **2304000 bit/s**, **1.0368 GB = 0.9656 GiB**,
  "WAV ceiling 14913.08 s (4.1425 h)"; duration `5 h` → "EXCEEDED: use RF64 / BW64". Compressed `320 kbps` works.
- [ ] ★ **Loudness (LUFS) normalisation** (−16.3 → EBU R128 −23) → gain **−6.70 dB**, true peak after −8.20 dBTP,
  limiter no. *Steady sine* 0 dBFS 997 Hz, L only → **−3.0103 LUFS**; L+R → **+0.0000**; sample rate `44.1 kHz`
  → refused ("BS.1770 publishes 48 kHz coefficients"). Each *…from one reading* mode → refused by name.
- [ ] **Loudspeaker** (88 dB/1 W, 100 W, 4 m, crest 12) → **95.959 dB SPL**, peak 107.959; target `100` →
  **253.58 W**; impedance `4 Ω` → 2.83 V is 2.00223 W (**+3.0151 dB** against 1 W).
- [ ] **Room absorption budget** (defaults) → A **49.2** m² sabins, Sabine **0.65447 s**, Eyring 0.58483 s,
  Millington–Sette **0.4678 s**; target 0.5 s → needs 64.4, **add 15.2 m²**.
- [ ] **Passive crossover** (2.5 kHz, 8 Ω, LR2) → C **3.9789 µF**, L **1.0186 mH**, each section −6.021 dB,
  tweeter **inverted**, sum in phase "a null (−∞ dB)", inverted +0.000 dB.
- [ ] **Speaker cable & damping factor** (2.5 mm², 10 m, 8 Ω, 0.02 Ω) → **0.137931 Ω**, DF **50.655**, level
  −0.1698 dB.
- [ ] **Reverberation time** now has a *Directivity Q* field: Q = 2 → critical distance **1.392 m at Q = 2**;
  Q = 1 says "(Q = 1 is an omnidirectional source)". **Quantisation** hint: 16-bit is 98.09 dB exactly.

**Video & display**
- [ ] ★ **Timecode** (29.97 DF, 00:10:00;00) → frame **17982**, real time **0:09:59.9994**; the drift figure
  shows the non-drop line falling and the drop-frame sawtooth. Timecode A `00:01:00;00` → **refused**: "…The
  label before it is 00:00:59;29 and the next is 00:01:00;02." Frame count `1800` → **00:01:00;02**. B
  `01:00:00;00` from A `00:00:00;00` → 107892 frames, real 0:59:59.9964. 25 fps with `;` → refused.
- [ ] **Frame rates, pulldown & shutter** (23.976 → 29.97, 180°) → "23.976 (24000/1001)", 2002 samples per frame,
  cadence **AA BB BC CD DD** with a cadence strip; source `29.97` → 8008/5 (1601.6), "5 frames = 8008 samples
  (3 × 1602 + 2 × 1601)" and the snap note; 24 → 25 → **+4.1667%**, +70.672 cents, 100 min runs 96 min.
  Source 24 at 180° → **1/48 s**. 25 → 29.97 → "no standard cadence" note, no figure.
- [ ] **Aspect, pixel aspect & framing** (720×480, 4:3, 2.39 in 1920×1080) → storage 3:2, PAR **8:9** and
  BT.601 **10:11** both named, letterbox **803.347** lines exact / 804 even, bars 138; title safe 1728×972,
  action safe 1785.6×1004.4. The frame figure keys every rectangle below it.
- [ ] **Transfer functions & code values** (BT.1886, 0.5) → **18.94646 cd/m²**, 10-bit narrow code **502**.
  BT.709 light → signal 0.18 → **0.4090077**, with the OETF/EOTF trap in the notes; PQ 0.5 → 92.2457 cd/m² on a
  log axis. The formula line shows superscripts (L⁰·⁴⁵), never `^`.
- [ ] **Interface bandwidth & recording time** (1080p60, 2200×1125, 20 bits) → active **2.48832 Gbit/s**, link
  **2.97 Gbit/s (+19.36%)**, 3G-SDI exactly; 100 Mbit/s on 128 GB → **2:50:40**, 45 GB per hour, 119.209 GiB.
- [ ] **Bitrate** (1920×1080, 60, 10-bit, 4:2:2) now shows "On the SDI link 2.97 Gbit/s with blanking", and the
  samples-per-frame line; **Resolution** 1366×768 says "Storage aspect 683:384" and "≈ 16:9".

**Light & camera** (new panel)
- [ ] **Illuminance, luminance & beams** (1000 cd, 2 m) → **250 lx** (23.23 fc); angle `30` → 216.506 lx;
  beam 30° → Ω 0.2141 sr, **214.09 lm (uniform intensity)**; 5000 lm on 10 m² → **159.15 cd/m² (46.452 ftL)**.
  `1000 lm` in the intensity field → refused (wrong quantity).
- [ ] ★ **Exposure, f-stops & depth of field** (f/8, `1/125 s`, ISO 100) → EV **12.966**; f/8 → f/11 **1 stop on
  the exact values (0.9189 by the markings)**, f/11 is 11.3137; hyperfocal **10.467 m**, sharp from **3.3894 m
  to 9.5274 m**; angle of view **39.6°** horizontal, 27° vertical, **46.79°** diagonal.
- [ ] **Colour temperature & mired** (3200 → 5600 K) → 312.5 and 178.57 mired, shift **−133.9 mired (blue
  correction)**; 3200 K daylight "not defined (4000–25000 K)"; (0.3127, 0.3290) → McCamy **6505.1 K**,
  Robertson 6503.7 K. The figure shows the daylight locus inside a faint sRGB triangle.

**Units** (Units mode / any field): `29.97 FPS`, `48 KHz`, `5 Mbps`, `1000 NIT`, `50 fc`, `14 ftL`, `20 µPa`,
`1 pW`, `1/125 s` all read; `1/0 s` → "divides by zero"; `94 dB` in a Pa field → refused (decibels are not units).

---

## 0cf. New in v2.139.0 — Spectroscopy: JCAMP overlay, exact isotope patterns, diastereotopic NMR, and Woodward–Fieser fixes

Two modes change: **Spectra** (the JCAMP reader, a new *Compare with acquired spectrum* panel, the ¹H
table, UV-Vis) and **Mass Spec** (every stable isotope, an isotope chart, its own comparison). Everything
is offline. The measured files below are the committed test files in
`src\lib\__tests__\fixtures\jcamp\` (attributed in `ATTRIBUTION.txt`).

**Spectra → JCAMP reader**
- [ ] Open `ethanol_nmr.jdx` (two blocks): a **block picker** appears, block 2 is selected, and the readout
  says "This file holds 2 blocks; showing block 2 ("Ethanol", NMR, 16,384 points). Earlier block — block 1
  ("Ethanol", NMR, 4 points) — held fewer points (a peak table or a stub), so the full trace is shown
  instead." Pick block 1 → "Block 1: Ethanol — NMR, peak table", drawn as sticks.
- [ ] Open `compound.jdx` → a picker with **5 blocks**; the units read **"cm⁻¹ (file: 1/CM) vs
  transmittance (file: TRANSMITTANCE)"** — never a bare "1/CM".
- [ ] Open `TESTFID.DX` → refused by name: ""ETHYLBENZOL/CDCL3": NMR FID — needs Fourier transform and
  phasing; export the processed spectrum." No chart, both Insert buttons disabled.
- [ ] (A block that FAILS its own checks — e.g. a hand-edited DIF line — shows "⚠ This block FAILED the
  file's own checks — …" and both Insert buttons stay **disabled**; nothing from it is inserted or
  overlaid.)

**Spectra → Compare with acquired spectrum** (the new panel below the reader)
- [ ] ★ Type `CC(C)CO`, **¹H NMR**, open `2Methyl1Propanol.jdx`, press **Compare with acquired spectrum**:
  rows 3.70 ↔ 3.40 (+0.30 ✓), 2.00 ↔ 2.11 (−0.11 ✓), 1.85 ↔ 1.76 (+0.09 ✓), 0.87 ↔ 0.92 (−0.05 ✓);
  "4 of 4 predicted lines have a measured peak inside their window." and "A prediction is not an
  assignment: a nearest peak is proximity, not identity." The figure has measured and predicted in two
  colours, δ increasing leftward.
- [ ] ★ **Referencing is never silent.** Type `CCc1ccccc1`, **¹³C NMR**, open `BRUKPAC.DX`, Compare →
  every row says **not assessed** and "Not assessed: the measured axis looks offset by +9.09 ppm. Give a
  reference peak, then compare." Type `86.25 = 77.16` in *Reference peak* → "Measured axis shifted by
  −9.09 ppm …" and **6 of 6** (144.2 ↔ 144.5, 15.8 ↔ 15.7 …). Type `TMS` → "Reference peak: write it as
  measured = true …".
- [ ] Change the input or the spectrum kind after comparing: the overlay **re-computes** at once (never a
  stale table). With **¹H** selected and an IR file open → "This file is an IR spectrum; the prediction
  is ¹H NMR." With **COSY** selected → "2D predictions … are not overlaid".
- [ ] **MS** with `Oc1ccccc1Cl` against `ISAS_MS1.DX` → head-to-tail figure (predicted below the axis);
  M⁺• 128.002 ↔ 128.000 ✓, "3 of 5 …", "Predicted fragment heights are a likelihood RANKING, not
  intensities."
- [ ] **Insert match table** and **Insert overlay chart** both work; the chart arrives at its full size
  (not squashed), and a very long file title is cut with "…" inside the canvas.

**Spectra → ¹H NMR, diastereotopic groups**
- [ ] ★ `ibuprofen`, **¹H** → 9 rows and a **note** column: CH₂ (on Ph) is **"m (²J 14–18 Hz)"** with
  note *a*; the two CH₃ at 0.87 are two rows with note *b*; below the table "a — diastereotopic CH₂ (the AB
  part of an ABX-type system) …" and "b — diastereotopic: no symmetry operation makes this group
  equivalent to its partner …". The aromatic CH are two **d (7.8)** rows. The vicinal "m (7.0)" must NOT
  appear beside that CH₂.
- [ ] `valine` → 6 rows; both 0.87 CH₃ rows carry note *a* and the note text appears **once**. ¹³C →
  5 rows, two marked *a*.
- [ ] **Insert data table** for ibuprofen → "δ 2.70  (2H, m (²J 14–18 Hz))  CH2 (on Ph)  [a]" and a
  "Diastereotopic notes:" block in the document.
- [ ] `toluene` ¹H → no note column at all (nothing is diastereotopic); the mult. column still reads
  t (7.8), dd (7.8, 1.5), tt (7.8, 1.5), s.

**Spectra → UV-Vis (Woodward–Fieser)**
- [ ] `CC(=O)C=C(C)C` → **239 nm** (215 + 24); `prednisone` → **239 nm** with "2 enone arms were each
  scored (239, 227 nm) …" and the cross-conjugated-dienone caveat.
- [ ] `CC=CC=CC(=O)C` → **263 nm** (215 + 30 + 18) with the EXTENDED caveat ("… Treat the value as a
  region, not a figure."); `C=CC=CC=O` → 240 nm.
- [ ] Refused by name, no number: `cinnamaldehyde` and `O=C(C=Cc1ccccc1)c1ccccc1` (chalcone) → "aryl-
  conjugated enone — Woodward-Fieser does not apply"; `O=C1C=CC(=O)C=C1` → "quinone chromophore — not a
  Woodward-Fieser enone".

**Mass Spec**
- [ ] Empty input → "Isotope patterns cover all 84 elements with a natural isotopic composition (H–U);
  masses AME2020, compositions CIAAW 2024."
- [ ] ★ `C2Cl4` → base peak **M+2 165.8725 (100.0)**, M 163.8754 (78.1), M+4 (48.0); below the bars the
  pattern note "Nominal-mass peaks (no fine structure) … 2 further peaks below 0.1 % of the base not
  listed." and "Masses: AME2020 (Wang et al. 2021); compositions: CIAAW 2024 …". An **isotope stick
  chart** shows (M stick in red). **Insert isotope chart** → picture at full size.
- [ ] ★ Ferrocene `[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Fe+2]` → first bar **M−2** (6.4) with a true minus;
  **Insert MS data** → "M−2  184.0179  6.37%" in the document, never "M+-2".
- [ ] `chlorophyll a` → magnesium is IN the pattern (M+1 74.6, M+2 41.7); no "Pattern excludes" line,
  and the words "still exact" appear nowhere.
- [ ] `[13CH3]C` → a **Labelled isotopes: ¹³C × 1** row beside the formula; `C2H5D` → the hint "D read as
  deuterium, ²H (2.014102 u) — a named isotope, not natural hydrogen." and ²H × 1; `Tc` → "Tc
  (technetium) has no stable isotope … e.g. [99Tc] for ⁹⁹Tc."; `[99Tc]` → 98.9062.
- [ ] **Compare with acquired spectrum (.jdx)…** → pick `ISAS_MS1.DX` with `Oc1ccccc1Cl` typed → M, M+1,
  M+2, M+3 all ✓ (128.003 ↔ 128.000 …), "4 of 5 …". Change the input → the comparison re-runs.

---

## 0ce. New in v2.138.0 — DAE index reduction, real K-theory, oriented cobordism, and persistence over 𝔽ₚ

Two modes change: **Analyze** (the DAE tool) and **Solve → Topology (homology)**. Everything is offline.

**Analyze → Differential-algebraic system** (no longer "(index 1)")
- [ ] The fields read *Initial values, by name (x = 1, u = 0 …)* and *Initial guesses for algebraic
  variables (optional)*. The default (y' = -z, 0 = z - y, y = 1) still gives **Index 1** and y(2) = z(2)
  = 0.135335 (= e⁻²) in the last table row.
- [ ] ★ **The Cartesian pendulum, as typed.** Equations `x' = u` / `y' = v` / `u' = -lam*x` /
  `v' = -lam*y - 9.81`, constraint `x^2 + y^2 - 1`, initial values `x = 1, y = 0, u = 0, v = 0`, guesses
  empty, t `0, 10`. → **Index 3 (structural, confirmed numerically at t₀).**, "0 = x² + y² − 1:
  differentiated twice.", "Hidden constraints …: u·x + v·y = 0;  −lam·x² − lam·y² + u² + v² − 9.81·y = 0.",
  a drift line per constraint ("Original constraint x² + y² − 1 = 0: drift before projection 2.9e−12, after
  2.2e−16.") and "Worst constraint after stabilisation: …". Last table row t = 10: x ≈ 0.275087,
  y ≈ −0.961419, lam ≈ 28.2946. The plot shows five series (x, y, u, v, lam). **Insert** → lines, table
  and the plot picture. The words "by construction … no drift" must appear nowhere.
- [ ] ★ **Order cannot matter (the live bug).** Retype the initial values as `v = 0, u = 0, y = 0, x = 1`:
  the table must be **identical**. Replace `lam` by `λ` in the equations: identical again, plus the line
  "λ / lambda was read as the variable lam (the expression grammar reserves both)."
- [ ] **Inconsistent start:** initial `x = 1, y = 0, u = 1, v = 0` → "The initial values violate the hidden
  constraint u·x + v·y = 0 …: residual 1 at the values given." and "u₀ = 1 was moved to u₀ = 0."
- [ ] **Refusal by name:** equations `x' = 1 - z` / `y' = z`, constraint `x + y - t`, initial `x = 0, y = 0`
  → "Structural analysis (Pantelides) reports index 2, but the differentiated system is numerically singular
  at t₀ = 0: … loses z by cancellation …". No table. Clearing the constraint field → "There is no constraint
  (0 = …). Without one this is an ODE - use the ODE solver."

**Solve → Topology (homology)** — the palette now has **Homology · K-theory · Cobordism · Persistence**
groups; every button loads an input that answers.
- [ ] **Display contract:** `klein bottle` → `H₀ = ℤ`, `H₁ = ℤ ⊕ ℤ/2`, `H₂ = 0`; `torus` → `H₁ = ℤ²`. No
  `H_1`, `Z + Z/2` or `Z^2` anywhere in the pane or the inserted text.
- [ ] **Homology over a field:** `homology of klein bottle over z/3` → "Betti numbers over 𝔽₃: 1, 1, 0";
  `homology of projective plane mod 2` → "Betti numbers over 𝔽₂: 1, 1, 1".
- [ ] ★ **Real K-theory:** `KO of S^1` → `K̃O⁰(S¹) = ℤ/2`, `KO⁰(S¹) = ℤ ⊕ ℤ/2`; `KO of S^1000001` → ℤ/2;
  `KO of RP^9` → `K̃O⁰(ℝP⁹) = ℤ/32`; `KO-theory of a point` → eight lines `KO⁰(pt) = ℤ` … `KO⁻⁷(pt) = 0`;
  `k-theory of s^1 x s^2` → `K⁰(S¹ × S²) = ℤ²`, `K¹(S¹ × S²) = ℤ²`. Refused by name: `KO^1(RP^3)`
  (Atiyah–Hirzebruch), `KO of CP^2` (Sanderson 1964), `KO of s^1 x s^1` (Künneth has Tor terms).
- [ ] ★ **Cobordism:** `does rp^2 # rp^2 bound` → "Unoriented: ℝP² # ℝP² BOUNDS (null-cobordant) — every
  Stiefel–Whitney number vanishes."; `does rp^2 x rp^2 bound` → does NOT bound (w₄ = 1, w₂² = 1);
  `signature of CP^2 # CP^2bar` → "Pontryagin numbers: all 0; signature σ = 0." and BOUNDS in Ω₄ˢᴼ;
  `pontryagin numbers of CP^2 x CP^2` → p₂ = 9, p₁² = 18, σ = 1; `signature of K3` → p₁ = −48, σ = −16;
  `oriented cobordism group dimension 5` → `Ω₅ˢᴼ = ℤ/2` (the Wu manifold); `does RP^2 # CP^2 bound` →
  "Dimension 2 vs 4 — a connected sum needs equal dimensions …".
- [ ] ★ **Persistence over 𝔽ₚ.** Click **Persistence → ring over 𝔽₃**: the eyebrow ends "**over 𝔽₃**",
  "Read: coefficients 𝔽₃.", "Most persistent H₁ feature over 𝔽₃ …", and "Bars over 𝔽₃: … in H₀, … in H₁.
  Over 𝔽₂: …". Then **𝔽₂ vs 𝔽₃**: the barcode is **two stacked panels** (ℤ/2 above, ℤ/3 below).
  **Insert** → the picture arrives at its full **460 × 600** proportion, not squashed to 460 × 300.
- [ ] Add a line `hello` above the points → "Ignored line (not a recognised header): "hello"." Replace the
  header with `mod 4` → "ℤ/4 is not a field — a barcode needs field coefficients …". With `scale 1`
  above the ring → bars alive at 1 are drawn with a dashed end and the foot note "dashed: alive at ≥ 1
  (censored)", and a "CENSORED" line says how many.

---

## 0cd. New in v2.137.0 — Reaction balancing, stoichiometry, genetic codes, peptides, and formula fixes

Five modes change: Solve, Reaction, Bio/Assay, DNA (+ Sequence), Peptide — plus Chemical/Structure and
Mass Spec reading. Everything is offline.

**Solve (Equation kind)**
- [ ] ★ **`Fe + O2 -> Fe2O3`** → eyebrow **Balanced equation**, `4 Fe + 3 O₂ → 2 Fe₂O₃` (subscripts, full-size
  coefficients), then `Fe: 4 on the left, 4 on the right ✓`, `O: 6 …`, `Charge: 0 … ✓`, a paired-bar chart
  "Atoms and charge on each side", and the caveat "Mass and charge conservation only — …". **Insert** →
  the lines as TEXT (Fe₂O₃ must not turn into an equation object) followed by the chart picture.
- [ ] **`Fe + O2 = Fe2O3`** and **`2H2 + O2 = 2H2O`** → balanced (they were "more than one unknown").
  **`MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O`** → `MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O`.
- [ ] **`half-reaction MnO4- -> Mn2+ in acid`** → `MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O` and "Reduction (gains
  5 e⁻)."; **`half-reaction MnO4- -> MnO2 in base`** → `MnO₄⁻ + 2 H₂O + 3 e⁻ → MnO₂ + 4 OH⁻`;
  **`MnO4- -> Mn2+; Fe2+ -> Fe3+ in acid`** → `MnO₄⁻ + 8 H⁺ + 5 Fe²⁺ → Mn²⁺ + 4 H₂O + 5 Fe³⁺`.
- [ ] ★ **`C + O2 -> CO + CO2`** → **No unique balancing**: "This reaction has 2 independent balancings …",
  then `1. C + O₂ → CO₂`, `2. 2 C + O₂ → 2 CO`, and a figure listing both — never one set of numbers.
- [ ] Still routed as before (no chemistry): `x + y = 5`, `N + O = 7`, `Co + O2 = 5`, `P1V1 = P2V2`, `H = 2`
  (→ H = 2), `f(x) -> 0` and `lim x->0 sin(x)/x` (inequality refusal, as before). `S -> B` then a new line
  `B -> C` → switches to Discrete and draws a **graph** (computation theory keeps precedence).
- [ ] The palette shows a **Chemistry — balance** group; every button loads an input that balances
  (the last, `not unique`, loads the refusal).

**Reaction mode**
- [ ] New **Read components as** dropdown: *Structures* (default — unchanged schemes) | *Formulas*.
  Never guessed: `CO + O2 -> CO2` in Structures draws the dictionary structures; switch to Formulas and the
  same text balances to `2 CO + O₂ → 2 CO₂`.
- [ ] Structures: `1-propanol >> CC=C` still draws (a name may start with a digit).
- [ ] ★ Formulas: `Fe + O2 -> Fe2O3` → the balanced equation, conservation rows and chart; the button reads
  **Insert balanced equation** and inserts text + chart. `C + O2 -> CO + CO2` → the refusal with both
  reactions; Insert stays disabled.
- [ ] Structures: `N2 + 3H2 >> 2NH3` → "Coefficients are not drawn (3H2, 2NH3) — switch the reading to
  Formulas to balance the equation." (it was "Couldn't draw: 3H2, 2NH3").

**Bio/Assay → Reaction stoichiometry & yield** (the 17th calculator)
- [ ] ★ Defaults (`2 H2 + O2 -> 2 H2O`; `H2: 10.0 g` / `O2: 10.0 g`) → "Limiting reagent: O₂ (ξ = 0.313 mol).",
  "Theoretical H₂O (M = 18.015 g/mol): 0.625 mol = 11.3 g.", "H₂ left over: 4.34 mol = 8.74 g.", and the
  chart "Moles available vs needed — limiting: O₂ ★". Insert → text + chart.
- [ ] Reaction `4 Fe + 3 O2 -> 2 Fe2O3`, amounts `O2: 10.0 L, gas`: with **IUPAC STP** → Fe₂O₃ 46.9 g; switch
  the dropdown to **Older STP (1 atm)** → 47.5 g. Both STP definitions are named in the dropdown.
- [ ] Amounts `H2: 10.0 mL` → refused: "… a liquid's density is never assumed to be 1 g/mL …". Add an actual
  yield `H2O: 12 g` to the default → percent yield above 100 % carries "wet or impure product, or the wrong
  limiting reagent".

**DNA mode and Sequence**
- [ ] New **Genetic code** dropdown under Frame (27 tables, ids 7, 8, 17–20 absent). `ATGAGATGATGGTAA` with
  table 2 → protein `M*WW*`, note "Translated with NCBI table 2 (Vertebrate Mitochondrial)." and the codons
  that differ; table 1 → `MR*W*` with no note. Table 28 → `MRWWQ` and "Table 28: TAA/TAG/TGA are read as
  Q/Q/W; they can also terminate, depending on context — stops are not called." **Insert protein**
  inserts only the residues.
- [ ] ORF finder: new **Genetic code** + **Start codons** selectors. `GTGAAACCCGGGTAA`, min 1 aa: ATG only →
  "No ORFs"; table 11 + alternative starts → `+ 1 1..15 4 MKPG` with the caption "Genetic code: NCBI table 11
  (…) · starts: ATG and alternative initiation codons (…), each read as M". Choose table 28 → a hint before
  you click; Find ORFs → the refusal text, no table. Changing either selector clears shown ORFs; Insert uses
  the settings the ORFs were found with.
- [ ] Sequence mode: each feature row has a new **/transl_table** box. Sequence `ATGAGATGATGGAAACCCTAA`, a CDS
  at `1..21` with `2` in that box → `/translation=M`; the status line
  ends "Notes — SEQ 1: CDS (1..21): /translation generated with NCBI table 2 …" (a NOTE, not "Generated with
  warnings"). **Decision pinned:** the initiator rule (alternative start read as M) applies ONLY when
  `/transl_table` is given explicitly; a CDS without the qualifier is translated exactly as before (table 1,
  no initiator rule), so no existing listing changes.

**Peptide mode**
- [ ] ★ `cyclo(GRGDSP)` → "6 residues · C₂₂H₃₅N₉O₉", "Monoisotopic mass 569.2558 Da · average mass 569.576 Da",
  termini "none (head-to-tail cyclic)", the cyclisation listed with −18.010565, and the macrocycle drawn.
- [ ] `CYIQNCPLG-NH2; disulfide 1-6` → C₄₃H₆₆N₁₂O₁₂S₂, 1006.4365 Da, "Amidated (C-terminal amidation)
  (UNIMOD:2) at C-term: +HN −O, −0.984016 mono / −0.9848 avg", "Disulfides: C1–C6", "ε₂₈₀ = 1,615 M⁻¹cm⁻¹
  (1 cystine as written)"; the S–S bond drawn. Insert → the picture's alt text carries C₄₃H₆₆N₁₂O₁₂S₂ and
  MW 1007.193 (the reading's average, not a second OCL value).
- [ ] `cycloGRGDSP` → refused: "… written solid it would read as Cys-Tyr-Cys-Leu-Pyl. Write cyclo(GRGDSP)."
  `A[Phospho]K` → "Phospho on A at position 2 is not supported …". No mass, no structure.
- [ ] `CAACGGCAAC; disulfide all` → masses shown (824.2074), drawing refused "4 cysteines admit 3 pairings …".
- [ ] ★ Paste a 60-residue sequence → masses appear at once, the drawing is refused "Structure not drawn: …
  heavy atoms is above the 250-atom drawing limit …" — Word must NOT freeze while you type.

**Chemical / Structure / Mass Spec**
- [ ] Chemical: `CuSO4·5H2O` → preview AND insert CuSO₄·5H₂O (5 full size); validation "M = 249.677 g/mol".
  `CaSO4·0.5H2O` → "CaO₄S·½H₂O, M = 145.142". `Fe + O2 -> Fe2O3` → "This is a reaction — balance it in
  Reaction mode (read as Formulas), or in Solve."
- [ ] Structure: `Fe2O3` → "… is a formula — Fe₂O₃, 159.687 g/mol — and a formula has no single structure
  to draw …"; `CN` → methylamine drawn with "Read as SMILES: CH₅N. As a formula, “CN” would be CN …";
  `smiles:CO` → methanol drawn; the property panel says "Properties not shown: “CO” is also a dictionary
  entry for a different compound …" (never carbon monoxide's numbers under methanol's picture).
- [ ] Mass Spec: `Co` → monoisotopic 58.9332, formula Co (was CH₃O 31.034); `Fe2O3` → 159.8546; `CO` →
  27.9949 with "Read as the formula CO. As SMILES, “CO” would be methanol (CH₄O) — write smiles:CO for that."

---

## 0cc. New in v2.136.0 — Exact cubic and quartic roots, multivariate simplification, radius of convergence, and leftovers

Solve mode, default **Equation** kind unless stated. Every exact root shows `≈` 12 digits beside it in
the steps and a certificate caveat (`Exact: certified by …; the displayed form re-parses and agrees with
the numerical root to 1e-9.`). The palette has three new **Algebra** templates (Cubic, exact · Cube
root · Quartic), a new **Exact roots & simplify** group, two new **Probability** snippets and, in the
Derivative kind, **radius** and **interval** under Limits & series.

- [ ] ★ **`x^3 = 2`** → method `exact (binomial x^n = c)`; `x = cbrt(2)` drawn as a real **cube-root
  sign** (∛2) in the pane AND after **Insert**; the pair `x = -1/2*cbrt(2) ± sqrt(3)/2*cbrt(2)*i` stays
  text. The steps include `x = cbrt(2) ≈ 1.25992104989`.
- [ ] ★ **`x^3 - 3x + 1 = 0`** → `exact (cubic — trigonometric form, three real roots)`: `x =
  2*cos(2*pi/9)`, `2*cos(4*pi/9)`, `2*cos(8*pi/9)` — each **typeset** (the `i` in `pi` no longer turns
  them into plain text), and the step `Cardano would take cube roots of complex numbers here (casus
  irreducibilis); the trigonometric form gives the same roots as real numbers: cos θ = −1/2, θ = 2π/3.`
- [ ] **`x^3 - 2x - 5 = 0`** → real root `cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)` (two
  stacked cube roots when inserted), and the complex pair EXACT as ω·u + ω̄·v: `(-1/2 - sqrt(3)/2*i)*cbrt(5/2
  + sqrt(1929)/18) + (-1/2 + sqrt(3)/2*i)*cbrt(5/2 - sqrt(1929)/18) ≈ -1.04727574077 - 1.13593988909i` and its
  conjugate (text, not typeset). Method `exact (cubic — Cardano, one real root)`. **`x^10 - 1 = 0`** → 10 exact
  roots, e.g. `1/4 + sqrt(5)/4 + sqrt(5/8 - sqrt(5)/8)*i`.
- [ ] **`x^4 - 10x^2 + 1 = 0`** → `sqrt(3) + sqrt(2)`, `sqrt(3) - sqrt(2)`, `-sqrt(3) + sqrt(2)`,
  `-sqrt(3) - sqrt(2)` (denested), method `exact (quartic — biquadratic)`. **`x^4 + 4x - 1 = 0`** →
  `exact (quartic — Ferrari)`, real roots `-sqrt(2)/2 ± sqrt(sqrt(2) - 1/2)`. **`x^4 + x + 1 = 0`** →
  numeric, with `a closed form exists (Ferrari) but needs the cube root of a complex number from its
  resolvent cubic and runs to hundreds of characters.`
- [ ] ★ **`(x-1)^4 = 0`** → exactly one line `x = 1 (×4)` — no complex near-1 values. **`x^3 + 3x^2 - 4 =
  0`** → `1`, `-2 (×2)`, and the work `Every root is rational, so the polynomial factors completely (a
  repeated root appears as a power):` then **(x − 1)(x + 2)² = 0**.
- [ ] **`x^5 - x - 1 = 0`** → five numeric roots and `Degree 5: no general formula in radicals exists
  (Abel–Ruffini); this quintic was not tested for solvability by radicals, so its roots are numerical.`
- [ ] ★ **Task words:** `solve x^2 - 5x + 6 = 0` → the note `Read the equation out of the sentence: x^2 -
  5x + 6 = 0` then 3, 2 (no "more than one unknown (solve, x)"); `find the roots of x^3 - 7x + 6` → `Read
  the equation out of the sentence: x^3 - 7x + 6 = 0`, roots 2, 1, −3 with the factoring work and the
  curve; `exact roots of x^3 - 3x + 1` and `x^3 - 2 = 0 exactly` likewise. **Twins:** `solve = 5` →
  solve = 5 and `roots = 3` → roots = 3 (variables named solve and roots).
- [ ] ★ **`simplify (x^2 - y^2)/(x - y)`** → `x + y` and `Cancelled the common factor x - y; equal to the
  original except where x - y = 0 (there the original is 0/0).`; `simplify (a^3 - b^3)/(a - b)` → `a*b +
  a^2 + b^2`; `simplify (sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))` → `cos(x) + sin(x)`; `simplify x/y` →
  `x/y` with **no** "Cancelling a factor can remove points" caveat; `simplify (x^13 - y^13)/(x - y)` →
  unchanged, caveat `… a common factor may remain: degree cap (above 12 in one symbol)`.
- [ ] **`simplify cbrt(2)^3 - 2`** and **`simplify (sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1`** →
  `0` (was `1.67785700837e-16`). Derivative kind, `(x^2 - y^2)/(x - y)` → `f'(x) = 1`.
- [ ] ★ **`taylor 1/(1+x^2)`** typed in the Equation kind → switches with `The question asks for a SERIES or
  its RADIUS OF CONVERGENCE — switched to the Derivative kind (which owns series) and answered.`; the
  steps include `R = 1 — the nearest singularity of 1/(1 + x^2) to x = 0 is the pole at x = ±i (distance
  1); …` and the **disc of convergence** is drawn (poles marked ✕ at ±i, the real interval in green).
- [ ] ★ **`radius of convergence of 1/(x^2 + 4) about 1`** → `R = sqrt(5)`, `1/(x^2 + 4) is smooth on the
  whole real line; the radius is set by complex poles.`, the disc drawn. **`interval of convergence of
  sum (x-3)^n/(n*2^n)`** → `Interval of convergence: [1, 5)`, `At x = 1: converges conditionally —
  alternating series test …`, `At x = 5: diverges — … (the harmonic series)`; the filled/hollow end dots
  match. Paste `radius of convergence ∑ x^n/n` (U+2211) → `R = 1`, `[-1, 1)`, and **no** "Σ-sum notation"
  note above the input.
- [ ] **Refusals:** `taylor abs(x)` → `Couldn't expand abs(x) as a Taylor series about x = 0: abs(…) is not
  analytic — it has no complex-analytic extension, so no power series represents it.`; `radius of
  convergence gamma(x)` → `gamma(…) is outside the singularity table …` and `R not determined — reading
  it from the computed coefficients would be sampling, not a theorem.`
- [ ] **Integral kind, both limits blank:** `1/sqrt(4-x^2)` → `asin(x/2) + C` with the caveat `Valid where
  the square root is real: |x| < 2.`; `1/sqrt(1-100x^2)` → `asin(10*x)/10` (was refused);
  `-1/sqrt(1-x^2)` → `-asin(x)` and the acos note. **`1/sqrt(1-x^2)` from −1 to 1** → π with `Improper at
  both endpoints (x = -1 and 1): the integrand is unbounded there, but the antiderivative asin(x) is
  continuous up to both endpoints, so the integral converges to the value shown.`
- [ ] **Multivariable:** `maximize x y subject to x^2 + y^2 = pi` → `Maximum f = pi/2 at (sqrt(2*pi)/2,
  sqrt(2*pi)/2) …; minimum f = -pi/2 …` (not an LP refusal); `lagrange x*y subject to x^2 - y^2 = 1` → `No
  constrained critical point: …`; `jacobian (r*cos(t), r*sin(t))` → `det J = r`; `hessian x^y at (1, 1)` →
  `H(1, 1) = [[0, 1], [1, 0]]`. Twin: `maximize 3x + 2y subject to x + y <= pi` → still refused, naming pi.
- [ ] ★ **`95% confidence interval for a proportion with 12 successes out of 40`** → `Wilson score interval
  (recommended): [0.180748, 0.4543]`, `Clopper–Pearson exact interval (conservative: coverage ≥ 95%
  guaranteed): [0.165627, 0.465316]`, `Textbook (Wald) interval … = [0.157987, 0.442013]`, three bars
  drawn. `confidence interval 95% proportion p = 0 n = 20` → Wilson `[0, 0.161125]` and `… = [0, 0] —
  zero width: the Wald interval fails here …`.
- [ ] ★ **`markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] expected hitting time from 1 to 3`** → `Expected
  steps from S1 to S3: 8`, `From each state (S1, S2, S3): (8, 6, 0)`, the diagram with S3 **ringed**; `…
  probability of reaching 3 before 1 starting from 2` → `= 1/2`; `… mean first passage time` → `M = [[4,
  2, 8], [6, 2, 6], [8, 2, 4]]`; `markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2` → `∞ — S2
  cannot be reached from S1 (S1's class {S1} is closed)` (as text — the ∞ is never typeset).
- [ ] **Insert** `x^3 = 2`, `x^4 - 2 = 0` (`2^(1/4)` must land as a 4th-root sign) and one radius result
  with its disc: radicals are real OMML radicals with a degree, the figure lands at its shown size.

---

## 0cb. New in v2.135.0 — Abstract algebra: groups, permutations, rings and finite fields

Solve mode, **Discrete math** kind (a seventh engine, tried FIRST). Then repeat the starred lines
in the default **Equation** kind: each must switch to Discrete math with the note **`The question
is ABSTRACT ALGEBRA — switched to the Discrete math kind and answered.`** (number-theory lines such
as `7^100 mod 13` switch with `The question is NUMBER THEORY — …`, never "mod = 0"). The palette has
a new **Abstract algebra** group (10 snippets).

- [ ] ★ **`Z/6`** → title `Group ℤ/6ℤ (order 6, cyclic, abelian)`; `cyclic: yes — generators 1, 5`;
  a 6 × 6 Cayley table is **drawn** (identity cells outlined). `ℤ/6ℤ`, `Z_6`, `Z6`, `integers mod 6`
  give the same answer.
- [ ] ★ **`is U(8) cyclic?`** → `U(8) is NOT cyclic: its elements 1, 3, 5, 7 have orders 1, 2, 2, 2 —
  none has order 4, so no element of order 4. U(8) ≅ ℤ/2ℤ × ℤ/2ℤ (the Klein four-group) …`
- [ ] **`D4`** → `Group D₄ (order 8, non-abelian)`, `abelian: NO — rs ≠ sr: rs = rs, sr = r³s`,
  `Z(D₄) = {e, r²}`, and the caveat `D4 read as the symmetries of the square (order 8);
  derangements: write derangements 4.` (`D(4)` still → `D(4) = !4 = 9`.)
- [ ] **`cayley table of S3`** → the text table (`· | e | (1 2) | …`, six rows) AND the drawn grid.
- [ ] ★ **`subgroup lattice of Z/12`** → `order 3: {0, 4, 8} = ⟨4⟩` …, `6 subgroups — one for each
  divisor of 12 (cyclic)`, and a **Hasse diagram** with ℤ/12ℤ at the top and {0} at the bottom.
- [ ] ★ **`cosets of <3> in Z/12`** → `1 + ⟨3⟩ = {1, 4, 7, 10}` … `12 = 4 · 3` (the `<3>` is NOT
  read as an inequality in the Equation kind).
- [ ] **`is {e, (1 2)} normal in S3`** → `NOT normal: (1 3)(1 2)(1 3)⁻¹ = (2 3) ∉ H`;
  **`D4 / <r^2>`** → `D₄ / ⟨r²⟩ ≅ ℤ/2ℤ × ℤ/2ℤ (order 4)` with the quotient's table drawn.
- [ ] **`conjugacy classes of S4`** → `class equation: 24 = 1 + 6 + 3 + 8 + 6`.
- [ ] ★ **`Z/6 ≅ Z/2 × Z/3`** → `gcd(2, 3) = 1, so ℤ/6ℤ ≅ ℤ/2ℤ × ℤ/3ℤ by x ↦ (x mod 2, x mod 3)` and the
  table `0 ↦ (0, 0), 1 ↦ (1, 1), …, 5 ↦ (1, 2)`; **`is Z/8 isomorphic to Z/2 x Z/4`** → `NOT
  isomorphic: … ℤ/8ℤ has 4 elements of order 8 and ℤ/2ℤ × ℤ/4ℤ has none.`
- [ ] **`find all groups of order 6`** → `two: ℤ/6ℤ and S₃`; `find all groups of order 16` → refused
  `… (14 of them, up to isomorphism) are beyond the built-in list …`.
- [ ] ★ **`(1 2 3)(1 2)`** → `(1 2 3)(1 2) = (1 3)` and `composed right to left: (1 2) is applied first —
  left to right would give (2 3)`, with the **cycle diagram** drawn; `(1 2 3)(4 5)` → `already a
  product of disjoint cycles`, `order 6 = lcm(3, 2), odd (3 transpositions: (1 3)(1 2)(4 5))`.
- [ ] ★ **`7 * 9 mod 12`** → `7 · 9 ≡ 3 (mod 12)`; `3 * 5 = 1 mod 7` → `3 · 5 = 15 ≡ 1 (mod 7): TRUE`;
  `x^2 = 1 mod 8` → `x = 1, 3, 5, 7 (4 solutions in ℤ/8ℤ)`.
- [ ] ★ **`factor x^4 + x^2 + 1 over F_2`** → `x^4 + x^2 + 1 = (x^2 + x + 1)^2 over 𝔽₂` (in the Equation
  kind this used to print "F_2"); `extended euclid x^3 + x + 1, x^2 + 1 over F_2` → `gcd = 1; 1 =
  (x^3 + x + 1) + (x)·(x^2 + 1)`.
- [ ] ★ **`GF(9)`** → `𝔽₉ = 𝔽₃[x]/(x² + 1), a = the class of x, a² = 2`, `primitive elements (order 8):
  a + 1, a + 2, 2a + 1, 2a + 2 — a itself is NOT primitive (order 4)`, the × table drawn;
  `minimal polynomial of a^3 in GF(8)` → `x^3 + x^2 + 1`; `(a + 1)(2a + 2) in GF(9)` → `= a`.
- [ ] **Refusals by name:** `GF(6)` → `6 is not a prime power — there is no field with 6 elements.`;
  `subgroups of S6` → `S₆ has order 720 — above the cap |G| ≤ 120 …`; `a^2 = e, b^3 = e` → `Group
  presentations ⟨a, b | a² = b³ = e, …⟩ are not read …`; a typed table `group with cayley table ⏎ e a
  ⏎ a a` → `No inverse for a … so this table is not a group.`
- [ ] **Insert** one drawn table and one Hasse diagram into the document: the figure lands at the
  shown size with legible text (no label below ~9 px; long-label tables such as `S3 x Z/2` keep the
  text table and say why the figure was not drawn).

---

## 0ca. New in v2.134.0 — Statistics: exact rank tests, repeated-measures ANOVA, Cox regression, and table-reading fixes

Stats mode. The dropdown has 24 calculators (was 22): **Repeated-measures ANOVA (sphericity,
GG/HF)** and **Cox regression (proportional hazards)** are new; every one still draws.

- [ ] **Mann–Whitney**, Group A `1, 2, 3`, Group B `4, 5, 6` → `U₁ = 0, U₂ = 9 (U = 0), n₁ = 3,
  n₂ = 3`, **`p = 1/10 = 0.100000, two-sided, exact, over 20 equally likely group assignments`**,
  the normal approximation `z = −1.75, p = 0.0808556` shown BESIDE it (not reported), the
  two-sided rule line, and **`With 3 v 3, no two-sided p below 0.100000 is possible.`** The
  shipped default (`1..5` v `6..10`) reads `p = 1/126 = 0.00793651` (was 0.0122, normal).
- [ ] **Wilcoxon**, shipped default → `W⁺ = 19, W⁻ = 9 (W = 9), n = 7 non-zero differences`,
  `1 zero difference dropped before ranking`, **`p = 15/32 = 0.468750 … exact`**, normal
  approximation `p = 0.446873` beside it.
- [ ] **Typed decimal commas.** Mann–Whitney, Group A `1,5 2,3 3,1`, Group B `4,2 5,0 6,6` →
  n₁ = 3, n₂ = 3 (NOT 6 + 6), `p = 1/10 = 0.100000`, and the result ends with **`Note: 3 decimal
  commas read as decimals (1,5 → 1.5). 3 decimal commas read as decimals (4,2 → 4.2). Values
  separated by spaces with one comma each are read as decimal-comma numbers; type 1, 5 (comma
  then space) for a list.`** `1, 2, 3` and `1,2,3` are still lists, with no note.
- [ ] **Survival (Kaplan–Meier), typed `1 0 5 1` ⏎ `2 0 8 0`** → refused: `Row 1 ("1 0 5 1") has
  4 numbers; each row is exactly two: time, then 1 (event) or 0 (censored). An id column or
  start/stop columns must not be typed here …` (it used to read time = 1, event = 0 silently).
  Log-rank: the same refusal, prefixed `Group 1:`. Both defaults unchanged.
- [ ] **Repeated-measures ANOVA, shipped default** (Field's bushtucker data, the first line
  names the conditions) → `Repeated-measures ANOVA: 8 subjects × 4 conditions`;
  `Conditions: F(3, 21) = 3.794, p = 0.0256 (sphericity assumed); partial η² = 0.3515`;
  **`Greenhouse–Geisser: F(1.60, 11.19) = 3.794, p = 0.0626 (ε_GG = 0.5328)`**; `Huynh–Feldt:
  F(2.00, 13.98) = 3.794, p = 0.0483 (ε_HF = 0.6658)`; **`Reported p (Greenhouse–Geisser): p =
  0.0626`**; `Sphericity: W = 0.1362, χ²(5) = 11.41, p = 0.0468 (Mauchly's W with R's
  second-order χ² approximation (mauchly.test))`; the Girden lead rule; Holm pairs such as
  `Stick insect vs Kangaroo testicle: mean difference 3.875, t(7) = 4.775, p = 0.00202, Holm p =
  0.0101`. The PROFILE PLOT draws: four condition names on x, blue means with error bars, grey
  subject lines, and the caption naming Cousineau–Morey within-subject 95% CIs.
- [ ] RM ANOVA, `1 2 4 3` ⏎ `2 3 5 5` ⏎ `1 4 4 6` (3 subjects, 4 conditions) → `Mauchly's test
  needs at least as many subjects as conditions: 3 < 4 - the covariance of the contrasts is
  singular.` and **`Reported p (lower bound): p = 0.0816`** — never a W near 0.
- [ ] RM ANOVA, mixed design: `Drug 10 12 14` ⏎ `Drug 9 11 15` ⏎ `Drug 12 13 16` ⏎ `Drug 8 10 13`
  ⏎ `Placebo 11 11 12` ⏎ `Placebo 10 12 11` ⏎ `Placebo 12 12 13` ⏎ `Placebo 9 10 10` → `Between
  groups: F(1, 6) = 0.8982, p = 0.38`, `Conditions: F(2, 12) = 54.41 …`, `Group × conditions:
  F(2, 12) = 24.68 …`, `Huynh–Feldt 1.2803 (raw; capped at 1 for the df); original SPSS form
  1.4973`; the plot has one mean line per group (`Drug (n = 4)`, `Placebo (n = 4)`). Change a
  value to `n/a` → refused: `Subject … "n/a" is not a number. Missing cells are refused, not
  dropped …`.
- [ ] RM ANOVA, **Use table at cursor** on a LONG table `Subject | Time | Score` (1/2/3 codes) →
  status line `Read long format …`, the field gets a first line `Time_1 Time_2 Time_3` and one row
  per subject; the output names `Time 1`, `Time 2`, `Time 3`. On `Subject | Group | T1 | T2 | T3`
  the Group column becomes the between factor (`Group_1 …` labels). The same table in Friedman
  is refused by name, pointing to repeated-measures ANOVA.
- [ ] **Cox regression, shipped default** (Gehan 6-MP, header `time status placebo`) →
  `Cox regression (Efron ties): n = 42, 30 events, 1 parameter (30 events per parameter)`;
  **`placebo: β = 1.5721 (SE 0.4124), HR = 4.817 (95% CI 2.147 to 10.81), z = 3.81, p =
  0.00014`**; `Likelihood-ratio test: χ²(1) = 16.35, p < 0.0001`; `Wald test: χ²(1) = 14.53`;
  `Score (log-rank) test: χ²(1) = 17.25`; `Concordance (Harrell's C) = 0.69`; the PH check
  `placebo: χ²(1) = 0.004312, p = 0.948`; the caveats (Efron, Wald CI, concordance is not
  calibration, Peto's log-rank HR differs by design). No "non-numeric entries were ignored"
  warning about the header words. Ties → Breslow: `β = 1.5092 (SE 0.4096)`.
- [ ] Cox FIGURE: a hazard-ratio forest plot on a **LOG axis** (labels 0.1, 1, 10 …, minor
  ticks, a red dashed line at 1, `Hazard ratio (log scale)`), and below it the adjusted
  survival curves `placebo = 0` / `placebo = 1` with the note `Breslow baseline.` Insert →
  both panels land in Word as one picture.
- [ ] Cox, **Use table at cursor** on `Time | Status | Age | Stage` with Stage typed I/II/III/IV
  → status line `… Stage: reference I; II, III and IV as indicators.`; rows read `Stage II vs I`,
  `Stage IV vs I: … HR = 5.507 (95% CI 2.409 to 12.59)`; four adjusted curves, one per stage.
  Edit the field text by hand → the labels fall back to `Stage_IV` (the feed's factor reading
  is kept only while the text is untouched).
- [ ] Cox refusals are reasons, not crashes: `Time Status Age Dose Sex` with 6 rows → `3 events
  for 3 parameters (1.0 per parameter); Cox estimates need about 10 events per parameter - drop
  covariates or collect more events.`; numbers with no header line → `The first line names the
  columns …`; status coded 1/2 → the existing 1/0 recoding refusal; a start/stop table at the
  cursor → `… time-varying covariates are not supported; give one row per subject …`.

## 0bz. New in v2.133.0 — Computation theory: grammars, machines, first-order logic, SAT, Hindley–Milner

Solve, Discrete kind (palette groups "Grammars", "Machines", "First-order logic", "SAT") and
the λ-calculus kind ("Hindley–Milner"). Typed into the default Equation kind, each switches
kinds by itself with a one-line note.

- [ ] `S -> aSb | ε` ⏎ `test: aabb ab aab` → "Context-free grammar — 1 nonterminal, 2 productions
  over {a, b}", the grammar echoed as **S → aSb | ε**, `aabb — accepted` with **S ⇒ aSb ⇒ aaSbb ⇒
  aabb**, `ab — accepted`, `aab — rejected`, the CNF and the CYK table in the working, and the
  parse tree DRAWN. Typed into the Equation kind instead: the pane switches to Discrete (never
  "Inequalities are solved exactly…", never a truth table over a variable named aSb).
- [ ] `S -> S S | a` ⏎ `is it ambiguous` → **AMBIGUOUS: aaa has 2 parse trees**, two different
  leftmost derivations listed, both trees drawn.
- [ ] `first and follow` ⏎ the E/E'/T/T'/F grammar → Nullable: E', T'; **FIRST(E) = {(, id}**,
  **FOLLOW(E) = {), $}**, **FOLLOW(F) = {+, *, ), $}**. `remove left recursion` ⏎ `E -> E + T | T` ⏎
  `T -> T * F | F` ⏎ `F -> ( E ) | id` → E → T E', E' → + T E' | ε, T → F T', T' → * F T' | ε.
- [ ] Nothing regressed: `p -> q` is still a truth table; `A -> B` ⏎ `B -> C` is still a graph;
  `regex (a|b)*abb` still draws its automaton.
- [ ] The aⁿbⁿ `pda` block (palette "PDA") → "acceptance by final state (accept {q2})" said,
  `"aabb" → accepted in 5 moves`, `"aab" → rejected: every branch died — stuck at (q1, ε, AZ)…`,
  the state diagram with labels like `a, Z/AZ` and the stack strip DRAWN. `cfg to pda S -> aSb |
  ε` ⏎ `test: aabb ab aab ""` → "acceptance by empty stack", ε accepted, **Verified: agrees with
  CYK on 4 of 4 test strings**.
- [ ] `tm binary increment 1011` → **Final tape: 1100**, "halted in halt after 8 steps", the
  machine printed, the tape strip DRAWN step by step. The one-state machine `tm` ⏎ `q0 1 -> q0 1
  L` ⏎ `q0 _ -> q0 _ R` ⏎ `tape: 1` → **LOOPS: configuration (q0, head 0, tape 1) recurred at step
  2 — proven non-termination**. `does this turing machine halt on every input` → REFUSED by name
  (the halting problem). `tm busy beaver 3` → Σ(3) = 6, S(3) = 21, CITED, nothing computed.
- [ ] `prenex ∀x P(x) → ∃y Q(y)` → **∃x ∃y (P(x) → Q(y))** (the ∀ in the antecedent flips to ∃).
  `skolemize ∀x ∃y P(x, y)` → **∀x P(x, f₁(x))**. `unify f(x, g(x)) and f(a, y)` → **MGU: {x ↦ a,
  y ↦ g(a)}**, "Both become f(a, g(a))"; `unify f(x, x) and f(y, g(y))` → "No unifier: occurs
  check — y would have to contain g(y)".
- [ ] `resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)` → **REFUTED in 2 resolvents — the argument is
  VALID**, the numbered derivation, the refutation drawn. `resolve ∀x ∃y P(x, y) ⊢ ∃y ∀x P(x,
  y)` → **SATURATED … the argument is INVALID** with a countermodel (domain {1, 2}).
- [ ] `dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)` → **UNSATISFIABLE**, the resolution
  refutation, the unsat core 4 of 4, "0 models in all (brute force agrees)", the search tree
  drawn with ⊥ leaves. `2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)` → SATISFIABLE x1=T x2=T, the
  implication graph drawn. `horn a, a -> b, b -> c, ~c` → "Forced true: a, b, c; clause ¬c
  violated → UNSATISFIABLE". DIMACS `p cnf 3 2` ⏎ `1 -2 0` ⏎ `2 3 0` → SATISFIABLE, 4 models.
  `sat (p | q) & (~p | q)` (≤ 10 variables) still gets the truth table.
- [ ] λ kind: `hm let id = λx.x in (id 1, id true)` → **Type: int × bool**, **Scheme: ∀α. α → α
  for id**, "Instances of id: α ↦ int …; α ↦ bool …", Algorithm W step by step, the derivation
  tree DRAWN. `hm (λid. id id) (λx.x)` → "Not typable: occurs check … id is λ-bound, hence
  MONOMORPHIC; write let id = λx.x in id id for polymorphism". `busy beaver 3` in the λ kind →
  refused by name, never "reduced". `(λx.x) y`, `x y`, `PLUS 2 3` still reduce as before.
- [ ] Equation kind, nothing stolen: `does the machine do 500 J of work in 10 s`, `resolve
  1/(x^2 - 1) into partial fractions`, `x^2 - 4 > 0`, `maximize 3x + 2y subject to x + y <= 4,
  x, y >= 0` answer exactly as before.

## 0by. New in v2.132.0 — Linear programming, interpolation and splines

Solve, Equation kind. The "Optimisation & interpolation" palette group holds every verb.

- [ ] `interpolate (1, 2), (2, 3), (4, 7)` → **p(x) = 1/3*x^2 + 5/3** as a real equation,
  "Degree 2 through 3 points", the divided-difference table, the Newton form
  **2 + (x - 1) + 1/3*(x - 1)*(x - 2)**, "Verified: the Vandermonde solve, the Lagrange
  basis products and Newton's divided differences gave identical coefficients", and the
  curve drawn through the three points. `interpolate (1, 2), (2, 3), (4, 7) at x = 3` →
  **p(3) = 14/3 ≈ 4.66667** — NOT "x = 3" (the solver must not steal `at x = 3`).
- [ ] `lagrange polynomial through (0, 1), (1, 3), (2, 2) at x = 1.5` → **-3/2*x^2 + 7/2*x + 1**,
  the basis lines L0, L1, L2, p(1.5) = **23/8**. `neville's method (0, 1), (1, 3), (2, 2) at
  x = 1.5` → 23/8 with the tableau. `newton divided differences (1, 1), (2, 8), (3, 27),
  (4, 64)` → **x^3**, table 1 · 7, 19, 37 · 6, 9 · 1.
- [ ] `x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial` → **x^2 + 1**, "degree 2, not 3:
  the 4 points lie on a parabola". `interpolating polynomial for f(x) = 1/x at x = 1, 2, 4`
  → **1/8*x^2 - 7/8*x + 7/4** (the function sampled exactly, not "more than one unknown").
- [ ] `linear interpolation between (1, 10) and (3, 20) at x = 2` → **15** with the proportion
  line. `error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic` →
  **√3/216 ≈ 0.00801875**, "M = 1 for sin".
- [ ] `interpolate (1, 2), (1, 3), (2, 4)` → REFUSED naming x = 1 and both y's.
  `least squares line through (1,2), (2,3), (3,5)` → REFUSED by name ("a FIT is least
  squares … Sketch data → function or Stats regression"). `fit a polynomial through (0,1),
  (1,3), (2,2)` → the interpolant with the caveat saying which was done.
- [ ] `natural cubic spline through (0, 0), (1, 1), (2, 0)` → "Natural cubic spline, 3 knots,
  2 pieces", **M = (0, -3, 0)**, **S(x) = 3/2*x - 1/2*x^3** on [0, 1], **S(x) = 1 - 3/2*(x - 1)^2
  + 1/2*(x - 1)^3** on [1, 2], "Verified: S, S′, S″ agree at x = 1 exactly", the figure with
  each piece on its own interval and the knots marked. `… evaluate at x = 0.5` → **11/16 =
  0.6875** — NOT "x = 1/2". `spline (0,0), (1,1), (2,0) at 1.5` → 11/16, "natural assumed".
- [ ] `clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1` →
  **M = (2, -4, 2)**, **x + x^2 - x^3**, **1 - 2*(x - 1)^2 + (x - 1)^3**, S(0.5) = 5/8, "end slopes
  verified: 1 and −1", the end tangents drawn as short segments.
- [ ] `not-a-knot spline through (0,1), (1,3), (2,2), (3,4)` → the single cubic
  **x^3 - 9/2*x^2 + 11/2*x + 1**, "not-a-knot with 4 points IS the interpolating cubic".
  `cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends` → S(3) = **19/4**
  (the parabola through the same points gives 14/3 — a spline is not the polynomial).
- [ ] `pchip (0, 0), (1, 1), (2, 1), (3, 2)` → slopes (3/2, 0, 0, 3/2), the MATLAB end formula
  named, the flat piece **1** on [1, 2]. `cubic spline through (0, 0), (1, 1)` → "the chord
  y = x". `quadratic spline through (0,0), (1,1), (2,0)` → REFUSED by name. Bare `spline`
  → the usage line, never "spline = 0".
- [ ] Geometry kind: type `polynomial through (0,1), (1,3), (2,2)` with the Shape kind selected
  → the pane switches to the Equation kind and answers **-3/2*x^2 + 7/2*x + 1** (not
  "Polygon from 3 points, area 3/2").
- [ ] `maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0` → "Linear program —
  maximize 3x + 2y (2 variables, 2 constraints + non-negativity)", the standard form with
  **s1, s2**, **x = 4**, **y = 0**, **z = 12** as real equations, "unique optimum", the
  constraint table (x + y ≤ 4 binding, slack 0; x + 3y ≤ 6 slack 2), **shadow prices (3, 0)**,
  reduced cost of y = −1, ranges c_x ∈ [2, ∞), c_y ∈ (−∞, 3], RHS of 4 ∈ [0, 6], "Verified:
  dual feasibility, complementary slackness, strong duality 12 = 12; the 2-variable vertex
  enumeration agrees", and the figure: the feasible polygon shaded, both constraint lines
  labelled, the dashed objective contour through (4, 0) with its arrow. The paste note
  "Read … powers that lost their superscripts" must NOT appear.
- [ ] `maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <=
  420, x1, x2, x3 >= 0` → **(0, 100, 230), z = 1350**, duals (1, 2, 0), reduced cost of x1 = −4;
  the typeset preview shows x1, x2, x3 as NAMES (never 3x¹ + 2x² + 5x³). Bars of x* and the
  slacks instead of a region.
- [ ] `minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0` → **(3, 1), z = 9**,
  duals (3/2, 1/2), "phase 1 … artificial variables a1, a2". `dual of maximize 3x + 2y
  subject to x + y <= 4, x + 3y <= 6, x, y >= 0` → the dual **minimize 4u + 6v subject to
  u + v >= 3, u + 3v >= 2, u, v >= 0** written out, w* = 12 at (3, 0), "z* = w*".
- [ ] `maximize x + y subject to x - y <= 1, x >= 0, y >= 0` → **UNBOUNDED**, the ray
  **x = 1 + t, y = t**, the ray drawn. `maximize x + y subject to x + y <= 1, x + y >= 2, x, y
  >= 0` → **INFEASIBLE**, "x + y ≤ 1 and x + y ≥ 2 cannot both hold", the half-planes drawn
  and nothing shaded. `maximize 2x + 2y subject to x + y <= 4, x <= 3, y <= 3, x, y >= 0` →
  z = 8, "alternative optima along the edge from (1, 3) to (3, 1)", the edge highlighted.
  `maximize 3x + 9y subject to x + 4y <= 8, x + 2y <= 4, x, y >= 0` → (0, 2), z = 18,
  "degenerate", "shadow prices are not unique here".
- [ ] `maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6` (no non-negativity) → BOTH
  answers labelled: "as stated: unbounded along x = 4 + t, y = −t" AND "with x, y ≥ 0 (the
  textbook convention, which you did not state): (4, 0), z = 12".
- [ ] `maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0, x
  and y integer` → "LP relaxation: (3, 3/2), z = 21", branch-and-bound summarised with the
  nodes (3, 1) z = 19, (2, 2) z = 18, (4, 0) z = 20, **integer optimum (4, 0), z = 20**.
- [ ] `standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2` → the conversion
  only (slack, surplus, free variables as x = x' − x''), and NEVER "x ∈ refused".
  `simplex tableau for …` → initial and final tableaux, numbers exact.
- [ ] `A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood
  and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and
  70 units available. How many of each maximize profit?` → the LP it built printed
  (**maximize 30x + 50y subject to 2x + 3y <= 120, x + 2y <= 70, x, y >= 0**), then
  **(30, 20), profit 1900**. `transportation problem: supplies 20, 30; demands 25, 25; costs
  …` → REFUSED by name with the typed-LP form shown.
- [ ] `maximize 3x + 2y` → the usage line ("an LP needs subject to …"), never "more than one
  unknown (maximize, x, y)". `maximize x*y subject to x + y <= 4` → "not linear: x*y".
  `minimize x^2 + y^2 subject to x + y = 1` → still Lagrange multipliers (Multivariable).
- [ ] Nothing regressed: `lagrange x y subject to x^2 + y^2 = 1` is still Lagrange
  MULTIPLIERS (Multivariable); `line through (1, 2) and (3, 8)` still gives 3x − 1;
  `x^2 - 5x + 6 = 0`, `mean of 3, 5, 8`, `binomial n=10 p=0.4 P(X <= 3)` unchanged.

## 0bx. New in v2.131.0 — Probability and Markov chains

Solve, Equation kind. The "Probability" palette group holds every verb.

- [ ] `binomial n=10 p=0.4 P(X <= 3)` → **3733209/9765625 ≈ 0.382281** (exact fraction, no
  decimals in the fraction), "Computed as the cdf F(3)", "Verified: Σ pmf(k)…", and a bar
  chart with k = 0..3 filled dark. Insert → the fraction lands as a real equation.
  `binomial n=10 p=0.4 P(X = 3)` shows the formula line **120*(2/5)^3*(3/5)^7**.
- [ ] `normal mean 100 sd 15 P(X > 120)` → ≈ 0.0912112, **z = (120 − 100)/15 = 1.33333**,
  "P = 1 − Φ(1.33333)", the pdf drawn with the tail beyond 120 shaded.
  `normal(100,15) P(X = 120)` → REFUSED ("is 0 for a continuous distribution — did you
  mean P(X ≤ 120)…").
- [ ] `quantile normal 0.975` → 1.95996; `critical value chi-square 3 df alpha 0.05` →
  7.81473; `t 12 df P(T > 2.1)` → 0.0287725 — each with a "Verified: F(…) = …" caveat.
- [ ] `poisson lambda = 2.5 P(X = 0)` → ≈ 0.082085 with the line **exp(-5/2)*(5/2)^0/1**;
  the Greek note "λ → lambda" must NOT appear under the input.
- [ ] `uniform(0, 10) variance` → **25/3** (not 50); `beta(2, 5) mode` → **1/5**;
  `expected value of a fair die` → **7/2**; `variance of [1,2,3,4,5,6] equally likely` →
  **35/12** (not 3.5) — the stats-intent must not steal any of these.
- [ ] `bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)` → **2/13 ≈ 0.153846** with
  "P(B) = … = 117/2000" and a probability tree; `P(A) = 0.3, P(B) = 0.5, P(A|B)` → REFUSED
  ("Independence is never assumed").
- [ ] `probability of at least one six in four rolls` → **671/1296**; `a bag has 3 red and 5
  blue; two drawn without replacement; P(both red)` → **3/28**; `birthday problem 23
  people` → 0.507297; `probability of drawing two aces from a deck` → REFUSED by name
  (outside the templates).
- [ ] `confidence interval 95% mean 50 sd 10 n 30` → z-interval [46.4216, 53.5784] AND
  t-interval [46.2659, 53.7341], caveat "the wording did not say, so both are shown".
- [ ] `markov [[0.9, 0.1], [0.5, 0.5]] stationary` → **π = (5/6, 1/6)**, "Irreducible … period 1
  — aperiodic", "π is also the LIMIT distribution", the state diagram (two nodes, four
  labelled arrows incl. self-loops). `is the chain [[0,1],[1,0]] irreducible` → period 2,
  π = (1/2, 1/2), "NO limit distribution". `markov [[0.6, 0.5], [0.5, 0.5]]` → REFUSED
  "Row 1 sums to 11/10". `absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected
  steps` → N = [[5/3]], 5/3 steps, absorbed in S1 / S3 with probability 1/2 each.
- [ ] Nothing regressed: `t = 5`, `F = m a`, `beta = 2`, `f(x) = x^2` still solve as
  equations; `mean of 3, 5, 8` still answers from the stats engine.

## 0bw. New in v2.130.0 — Multivariable calculus

Solve, Equation kind. The "Multivariable" palette group under Transforms holds every verb.

- [ ] `gradient x^2 y + y^3 at (1,2)` → **∇f = (2*x*y, x^2 + 3*y^2)**, f_x and f_y on
  their own lines, **∇f(1,2) = (4, 13)**, |∇f| = sqrt(185), "every partial agrees
  with a central-difference check". `gradient x^2+y^2+z^2 at (1,2,3)` → |∇f| =
  **2*sqrt(14)** (not sqrt(56)). Insert → the ∇f line lands as a real equation.
- [ ] `directional derivative x^2 y at (1,2) in direction (3,4)` → **16/5**;
  `… in direction (0,0)` → REFUSED (zero direction).
- [ ] `hessian x^3 + x y^2` → f_xx = 6x, f_xy = 2y, f_yy = 2x, **det H = 12x² − 4y²**;
  `jacobian (r cos(theta), r sin(theta))` → **det J = r**; `jacobian (x + y, x - y, x*y)`
  → "not square", no determinant.
- [ ] `critical points x^3 - 3x + y^2` → **(1, 0): local minimum**, **(−1, 0): saddle
  point**, "solved by exact elimination", NO "(numeric)" tag. `critical points x^4+y^4`
  → (0, 0): **INCONCLUSIVE** (D = 0). `critical points x^3+y^3-3xy` → REFUSED by name
  ("xy was read as ONE variable"); `critical points x^3+y^3-3*x*y` → (1, 1) minimum,
  (0, 0) saddle point. `critical points x^3 - 3x` → sent to the equation kind.
- [ ] `lagrange x y subject to x^2 + y^2 = 1` → four candidates at **(±sqrt(2)/2,
  ±sqrt(2)/2)**, exact (no decimals), **Maximum f = 1/2**, **minimum f = −1/2**, "the
  constraint set is bounded". `lagrange x^2 + y^2 subject to x + y = 1` → (1/2, 1/2):
  f = 1/2 and NO "Maximum" line (unbounded line — boundedness not established).
- [ ] `double integral x^2 + y^2 over y from 0 to x, x from 0 to 1` → **= 1/3**, the inner
  integral shown first; `triple integral x y z over x from 0 to 1, y from 0 to 1, z from
  0 to 1` → **1/8**; `double integral exp(-x^2) over x from 0 to 1, y from 0 to 1` →
  ≈ 0.7468 with the numerical caveat; `double integral x y over x from 0 to y, y from
  0 to x` → REFUSED (bounds may depend on OUTER variables only).
- [ ] Improper integrals refuse by name: `double integral 1/x over x from -1 to 1, y from
  0 to 1` → REFUSED "not finite at x ≈ 0" (never "= 0"); `double integral 1/sqrt(x) over
  x from 0 to 1, y from 0 to 1` → **= 2** (integrable endpoint); `double integral a x y over
  x from 0 to 1, y from 0 to 1` → **= a/4** with "a is a parameter".
- [ ] `divergence (a x, b y)` → **a + b** with "a, b are treated as constants";
  `gradient x/y at (1, 0)` → REFUSED (not defined there); `gradient 2xy` → REFUSED
  ("xy was read as ONE variable").
- [ ] `curl (y z, x z, x y)` → **(0, 0, 0)**; `potential (y z, x z, x y)` → **φ = x*y*z + C**;
  `potential (y, -x)` → REFUSED with the curl shown; `line integral (2 x y, x^2) from
  (0,0) to (1,2)` → **= 2**; `line integral (y, -x) from (0,0) to (1,1)` → REFUSED as
  PATH-dependent. `curl (-y, x)` → the 2-D scalar **2**; `divergence (x^2, y^2, z^2)` →
  2x + 2y + 2z.
- [ ] Nothing regressed: `gradient descent` is NOT caught (ordinary prose handling);
  `laplace t^2 exp(3t)` and `fourier series t^2 on (-pi, pi)` unchanged; pasting
  `∂f/∂x` or `∇f` from a PDF names the verb to type instead.

## 0bv. New in v2.129.0 — Laplace transforms, initial-value problems and Fourier series

Solve. Equation kind unless stated.

- [ ] `laplace t^2 exp(3t)` → **F(s) = 2/(s − 3)³, for s > 3**, one step line per
  term naming the table rule, and "Verified against the defining integral";
  f(t) is drawn. Insert → the F line lands as a real equation.
- [ ] `laplace sin(t)^2` → 2/(s(s² + 4)); `laplace u(t-2)` → e^{−2s}/s;
  `laplace exp(t^2)` → REFUSED by name (no result line).
- [ ] `inverse laplace 1/(s*(s+1))` → f(t) = 1 − e^{−t} with the partial fractions
  shown; `inverse laplace 1/(s^3+1)` keeps **sqrt(3)** exact; `inverse laplace
  exp(-2s)/s` → u(t − 2) and the plot shows the step at 2.
- [ ] ODE kind: `y'' + 4y = sin(t), y(0) = 0, y'(0) = 0` → **y = sin(t)/3 −
  sin(2t)/6**, "initial-value problem, by Laplace transform", Y(s) shown,
  "Verified by substituting…", and ONE curve drawn (not a family).
  `y'' + y = u(t-1), y(0) = 0, y'(0) = 0` → (1 − cos(t − 1))·u(t − 1).
- [ ] `fourier series t^2 on (-pi, pi)` → a₀/2 = pi^2/3, a_n = 4(−1)^n/n^2 (exact,
  no decimals), S₅ drawn over f. `fourier series -1 on (-pi, 0); 1 on (0, pi)` →
  b_n = 4/(pi n) for odd n and the Gibbs caveat. `fourier series cos(t) on
  (-pi, pi)` → "except n = 1: a_1 = 1".
- [ ] Nothing regressed: `u + v = 1` / `u - v = 3` still solves as a system;
  `(2+3i)(1-i)` still gives 5 + i; `partial fractions 1/(x^2-1)` unchanged.

## 0bu. New in v2.128.0 — Every statistics calculator reads the table at the cursor; power & sample size

Stats mode, in a document with real tables.

- [ ] Make a 3-column table with header `Control | Low | High` and a few numbers per
  column (leave one cell blank). Click inside it. Stats → One-way ANOVA → **Use
  table at cursor** → the field shows three blank-line-separated groups; the
  status line names them in order ("1 = Control (n 3)…"); the ANOVA computes.
  Tukey, Kruskal–Wallis and the assumption check load the same table.
- [ ] A 2-column table `Group | Value` with labels A/B/A/B… → the same calculators
  read it as label + value rows (note says so).
- [ ] A table with `Subject | Before | During | After` → Friedman reads one row per
  subject; the note says "3 conditions: Before, During, After".
- [ ] A table `Months | Status` (status as 1/0 or yes/no) → Survival reads it; add
  an `Arm` column → Survival says the arm column was ignored and points at
  Log-rank; Log-rank reads it as two blocks.
- [ ] A crosstab (row labels down the first column, header across, cells like
  `10, 11`) → Two-way ANOVA expands the replicate lists; the interaction plot
  draws.
- [ ] A table with a word in a numeric cell (`n/a`) → Multiple regression REFUSES
  with "must be a number" rather than shifting the column.
- [ ] **Power & sample size**: two-sample t, d = 0.5, α 0.05 two-sided, find n →
  **n = 64 per group (128 in total)**, achieved power 0.802, and the power curve
  with the red point at 64. Switch to ANOVA, f = 0.25, 3 groups → n = 53. Two
  proportions `0.5 0.6` → n = 388. Effect 0 → refused as infeasible. "Insert
  chart" inserts the curve.

## 0bt. New in v2.127.0 — Offline delivery

Any mode. Needs a machine whose network you can switch off. This is the one
pass the automated gate cannot do: it proves the promise inside REAL Word.

- [ ] Open the pane online. Under the title a small line appears: "Preparing
  offline copy…", then within a minute **"Offline-ready · v2.127.0"** with a
  green dot. Hover it: the tooltip names how many files are stored.
- [ ] Quit Word fully. Switch the network OFF (Wi-Fi off / cable out). Reopen
  Word and open the pane → it opens, the line still reads Offline-ready, and a
  tool computes (Chemical `H2O` → H₂O preview; Insert works).
- [ ] Still offline: Build → open the large drawing canvas (a dialog) → it
  opens. Solve → pop-out canvas → it opens. (Dialogs are separate windows and
  may use a different cache; record what happens.)
- [ ] Network back on. Nothing changes and no banner appears (no new release).
- [ ] **Mac (WKWebView):** record what the line says. "Offline use depends on
  this Word's cache" with an amber dot is the honest outcome for a host that
  allows no service worker — note it here; the Mac wording in the manual and
  install README ("may") then stays as is. If it reads Offline-ready instead,
  repeat the network-off step and record whether the pane opened.
- [ ] **Update path (at the NEXT release):** with the pane open on this build,
  the banner "Update available (vX)" appears. Click Reload → the button reads
  "Downloading vX…", then the pane reloads INTO the new version (the status
  line shows the new number). No second banner, no loop.

## 0bs. New in v2.121.0 — systematic IUPAC names (subset)

Chemical mode.

- [ ] Enter SMILES `CCC(C)C(C)CC` → "Systematic name: 3,4-dimethylhexane
  (subset namer — verify before filing)"; Insert name works.
- [ ] `CC(=O)CCO` → "Systematic name: 4-hydroxybutan-2-one …".
- [ ] `aspirin` still shows its DICTIONARY name (retained names win).
- [ ] An ester (`CC(=O)OCC` — if not in dictionary) → "No name: Ester…
  outside the namer's subset." — a refusal, never a guess.
- [ ] A drawn Z-alkene → name appears with "stereodescriptors omitted".

## 0br. New in v2.119.0 — refined 3D, building in 3D, template libraries

Build → Draw → "Open large canvas / 3D ⤢".

- [ ] 3D looks refined: depth fog (back atoms dimmer), specular spheres,
  shaded rods, and DOUBLE bonds render as parallel rods (draw acetone).
  Heteroatoms wear their element symbol; "Labels" toggles them.
- [ ] CLICK an atom (no drag) → dashed halo + edit bar. Change C→N on
  benzene → 2D tab shows pyridine, 3D regenerates. Ctrl+Z in 2D restores.
- [ ] With an atom selected: "Attach group… → Carboxyl" on benzene →
  benzoic acid in both tabs. Attach a 5th group to a quaternary carbon →
  refusal NAMES the valence problem, nothing changes.
- [ ] Click a bond → Single/Double/Triple/Delete bar. Ethane bond → Double
  → ethene. Setting F–C to Double refuses by name.
- [ ] Click a hydrogen → message says hydrogens are implicit; no crash.
- [ ] Templates: 2D bar "Insert template… → Adamantane" lands beside the
  current structure; 3D "Add template…" regenerates the model. Porphine
  and 18-crown-6 both generate.
- [ ] "Insert 3D picture" carries labels + double bonds into the document
  figure, same orientation as on screen.

## 0bq. New in v2.118.0 — 3D model in the drawing canvas

Build → Draw tab → "Open large canvas / 3D ⤢".

- [ ] Draw (or carry in) ibuprofen-ish structure → "3D model" tab → conformer
  appears in ball-and-stick, colored by element (O red, N blue, C gray).
- [ ] Drag rotates smoothly; scroll zooms; "Spin" auto-rotates; "Reset view"
  recenters. Style switch to Stick and Space-filling redraws.
- [ ] Untick "Hydrogens" → H spheres and their bonds vanish, model refits.
- [ ] The note names the conformer honestly (MMFF94s-minimised, one of many).
- [ ] "Insert 3D picture" → figure lands in Word in the SAME orientation the
  canvas showed, on white, with alt text carrying formula + OCL-ID.
- [ ] Draw a structure with an R-group → 3D tab refuses BY NAME (generic
  structure), no blank canvas, no crash.
- [ ] 2D tab: "Clean structure" works in the dialog; formula + MW shown
  bottom-right; "Use this drawing" still round-trips to the pane.

## 0bp. New in v2.117.0 — survey percentages + word-problem routing

Solve → Equation kind.

- [ ] Paste: `In a survey of 20 people, 8 people said they liked chocolate ice
  cream, and 12 people said they liked vanilla. What is the percentage of
  people who like chocolate ice cream?` → switches to Word problem kind with a
  note → 40%, quoting the chocolate clause and "survey of 20".
- [ ] `What is 15% of 200?` in the equation kind → routes to Word problem → 30.
- [ ] `x^2 - 4 = 0` still solves as an equation (no word-problem theft).

## 0bo. New in v2.111.0 — powers, sums, verbs

Solve → Equation kind.

- [ ] `V = (4/3)*pi*r^3` → solve-for chips; pick r → `cbrt(3*V/4/pi)` with the
  odd-root note. `E = s*T^4` → T gives the ± pair + the ≥ 0 condition.
- [ ] `sum of 1 to 100` → 5050. `sum k^2 from 1 to n` → n(n+1)(2n+1)/6 typeset.
  `sum 1/k from 1 to n` → refused by name (harmonic).
- [ ] `factor x^2 - 5x + 6` → (x − 2)(x − 3); `factor x^2 - 2` → unchanged with
  "no RATIONAL roots" stated; `expand (x+1)^3` → x³ + 3x² + 3x + 1;
  `simplify (x^2-1)/(x-1)` → x + 1.
- [ ] Insert a factored result → lands typeset in Word.

## 0bn. New in v2.110.0 — the equation engine, comprehensive

Solve → Equation kind.

- [ ] `x^2 = 2` → **±sqrt(2)** exact (typeset), ≈ decimals alongside — not
  1.4142 wearing an [exact] tag. `3x = 1` → **1/3**. `x^2 - x - 1 = 0` →
  1/2 ± sqrt(5)/2.
- [ ] `sin(x) = 1/2` → the TWO general families x = π/6 + 2πn, 5π/6 + 2πn and
  two principal roots — not hundreds of lines. `sin(2x) = 1` → π/4;
  `sec(x) = 2` → ±π/3; `2sin(x)^2 + sin(x) - 1 = 0` → three families.
- [ ] `2^x = 8` → exactly 3; `5^x = 3` → ln(3)/ln(5); `ln(x) = 1` → exp(1).
- [ ] `abs(x) = -1` → "No real solution exists: |·| is never negative" (not
  "in the range searched"). `sin(x) = 2` similar.
- [ ] Inequalities: `-3 < 2x+1 <= 7` → (−2, 3]; `abs(x-1) < 3` → (−2, 4);
  `abs(x) >= 2` → two rays; `(x^2-1)/(x-1) >= 0` → **[−1, 1) ∪ (1, ∞)** — the
  hole at 1 excluded.
- [ ] `(x-1)/(x-1) = 1` → identity EXCEPT x = 1, named.
- [ ] Type ½ via Word AutoFormat (`sin(x) = ½`) → solves as 1/2.
- [ ] Insert a trig result → the families and principal roots land in Word,
  not a 600-line list.

## 0bm. New in v2.109.0 — sketch data → function

Solve → **Equation** kind → Open canvas → click **Sketch data → function**.

- [ ] Click ~5 points roughly on a line across the four-quadrant grid → chips
  appear: linear/quadratic/cubic (and exp/log/power only when the data allows,
  otherwise named in the skip note). Linear's adjusted R² tops the list.
- [ ] Click the linear chip → the overlay shows the points + that exact curve,
  captioned with the expression, R², adjusted R², RMSE — and the input now
  reads `y = <expression>`.
- [ ] Click a drawn point again → it disappears; fits recompute.
- [ ] Put two points at the same x, different y → refusal names it: "no
  function of x passes through both".
- [ ] Points with negative y → the skip note says exponential/power need
  positive values; nothing is force-fitted.
- [ ] Edit the input by hand → the overlay clears (the request no longer means
  that fit).
- [ ] **Use this equation** → the pane gets `y = <expr>` with solve-for chips;
  Insert works as any equation.

## 0bl. New in v2.108.0 — measurements + drawn placement

Solve → Geometry → **Open canvas**.

- [ ] Rectangle tool, first corner placed: moving the mouse shows `w × h — area`
  live in the footer next to the coordinates; circle shows `r — area`; polygon
  shows `area if closed`.
- [ ] Select tool: hover an edge → the footer reads that edge's length; hover a
  circle's rim → `circle r = …`.
- [ ] Draw rectangle + circle inside → **Use this equation** → in the PANE the
  composite figure now shows YOUR placement (hatched circle where you drew it)
  captioned "placement as drawn — to scale", NOT the generic "placement
  illustrative" figure. **Insert** → that same figure lands in Word.
- [ ] Edit the request text by hand in the pane (change a number) → the figure
  falls back to the generic illustrative one (the drawing no longer matches).
- [ ] Draw a single rectangle or circle → Use → the pane shows a to-scale drawn
  figure (these had NO figure before); segments pair inserts its crossing.

## 0bk. New in v2.107.0 — draw to solve

Solve → Geometry → **Open canvas**. The drawing surface sits above the input.

- [ ] Triangle tool: three clicks → the request `triangle (…) (…) (…)` appears
  in the input, the full solution (sides, angles, area, radii) renders below,
  and the to-scale figure draws.
- [ ] **Select** tool: drag a vertex — the text, numbers and figure all follow
  live. Drag onto another vertex or collinear → the drag refuses (shape holds).
- [ ] Rectangle (two corners) then Circle (centre + rim) fully inside it → the
  circle paints RED and the input reads `rectangle W x H minus circle r=R`;
  drag the circle out of the base → red clears, note says only the first shape
  solves.
- [ ] Segment twice → `line (…) (…) (…) (…)` with the intersection point.
- [ ] Polygon: clicks + double-click (or Close shape) to finish; Esc abandons a
  half-built shape; Undo removes last point, then last shape.
- [ ] Grid snap: click anywhere — coordinates land on halves (the readout at
  the bottom-left shows the snapped point).
- [ ] **Use this equation** carries the drawn request back to the pane; Insert
  puts derivation + figure into Word.

## 0bj. New in v2.106.0 — the comprehensive geometry suite

All in Solve → Geometry kind. The point of this pass is the FIGURES: plain
geometry now draws, and what the pane previews must be what Word receives.

- [ ] `triangle 3 4 5` → sides, angles, area, **inradius = 1, circumradius = 5/2**,
  and a triangle DRAWN to scale (side labels outside, angles in the caption).
  **Insert** → derivation AND figure land in Word; alt text describes a triangle.
- [ ] `triangle a=6 b=8 A=30` → TWO solutions, and the figure shows BOTH
  triangles side by side, labelled solution 1 / solution 2.
- [ ] `sector r=5 angle=60` → area 25/6·π exact, arc, chord, perimeter; a filled
  wedge drawn on a dashed circle. `tangent r=3 d=5` → length exactly 4, both
  tangent lines drawn. `tangent r=5 d=3` → refused: point INSIDE the circle.
- [ ] `x^2/9 + y^2/4 = 1` → ellipse with foci, **vertices, directrix distance**,
  and the curve drawn with foci marked ×. `y = x^2/8` → parabola with
  **vertex (0,0), focus (0,2)** and the curve drawn.
- [ ] Solids: `frustum r1=2 r2=5 h=4` → slant exactly 5, V = 52π;
  `torus R=3 r=1` → 6π² exact; `torus R=1 r=3` → refused by name (spindle);
  `cap r=5 h=2` → 52/3·π. No figures for solids — deliberate, stated here.
- [ ] `rotate 90 (1,0)` → **exactly (0, 1)** (not 6.1e-17); `rotate 45 (1,0)`
  → numeric AND says so. `rotate 90 then translate 1 0 (1,0)` → (1,1) with the
  order-matters caveat. `reflect y=x (2,3)` → (3,2), determinant −1,
  orientation-flip named. Before → after figure drawn.
- [ ] `inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)` → INSIDE, probe marked on
  the drawn polygon; `inside (2,0) …` → ON THE BOUNDARY (not rounded).
- [ ] The pop-out canvas (Open canvas) draws the same figures live.
- [ ] The palette groups **Circle toolkit / Solids / Transforms & point tests**
  insert working snippets.

## 0bi. New in v2.105.0 — the integration gaps closed

- [ ] Integral kind, `sin(x)^2` from 0 to pi → **π/2 exact** with F(x) shown
  (previously numeric Simpson).
- [ ] `exp(x)*sin(x)`, no bounds → F = eˣ(sin x − cos x)/2 + C, "checked by
  differentiating back (symbolic)".
- [ ] ODE kind, `y' = sin(x) - y` → now SOLVES via the integrating factor
  (previously refused naming ∫eˣ sin x).
- [ ] `sin(x)^4` still refuses honestly (numeric integration offered with bounds).

## 0bh. New in v2.104.0 — solve with units

- [ ] Solve → equation kind, three lines: `F = m a` ⏎ `m = 3 kg` ⏎ `a = 2 m/s^2`
  → rearrangement shown, **F = 6 N (kg·m/s²)** — the unit derived, not assumed.
- [ ] `v = d/t` ⏎ `d = 3 km` ⏎ `t = 0.5 h` → "Converted to SI first: 3 km → 3000 m…",
  v ≈ 1.667 m/s.
- [ ] `v = u + a*t` ⏎ `u = 3 m` ⏎ `a = 2 m/s^2` ⏎ `t = 4 s` → REFUSED naming the
  clash (u carries m where m/s is needed) — no number invented.
- [ ] `T = 2 π sqrt(L/g)` ⏎ `L = 2 m` ⏎ `g = 9.8 m/s^2` → T in seconds (√ halves dims).
- [ ] A plain two-line system without units still solves as a system.
- [ ] The equation canvas shows the same units result; Insert puts the worked
  lines into Word.

## 0bg. New in v2.103.0 — symbolic ODEs + known-limit fixes

### 0bg-1. Differential equations (Solve → Differential equation)
- [ ] `y' = 2y` → separable work (separate, integrate, exponentiate), y = C·e^(2x),
  "verified by substituting back", and THREE family curves drawn (C = −1, ½, 2).
- [ ] `y' = x - y` → integrating-factor work (μ = e^x), y = x − 1 + C·e^(−x), family drawn.
- [ ] `y'' + 3y' + 2y = 0` → characteristic equation, roots −1 and −2, C1/C2 solution, family.
- [ ] `y'' + 4y = 0` → cos(2x) and sin(2x).
- [ ] `y' = x + y^2` → refused BY NAME with the list of solved families (no fake answer).
- [ ] **Insert result** → classification, work, solution and figure land in Word.
- [ ] The palette shows eight ODE templates; the equation canvas graphs the family.

### 0bg-2. Known-limit fixes
- [ ] Two-line stacked fraction (`3` ⏎ `x+3`) pastes in the PANE as (3)/(x+3); in the
  CANVAS two lines still mean two curves.
- [ ] A pasted equation with unicode minus AND a two-digit coefficient (C=59(F−32))
  shows the "may have been 5/9" heads-up; typed `y = 12(x+1)` shows nothing.
- [ ] Word kind: "When x increases by 1, y increases by 2." with `y = 2x` → TRUE.

## 0bf. New in v2.102.0 — SAT word problems

- [ ] Solve → Word problem, paste the full Celsius/Fahrenheit SAT question (with
  a correctly-written 5/9) → both exchange rates exact (5/9 and 9/5), and the
  three choices judged TRUE / TRUE / FALSE, the false one showing 0.308642.
- [ ] The caveat restates the equation used and warns that 5/9 can paste as 59.
- [ ] `A = 3.14 r^2` + an "increase of 1" question → refused by name: the
  exchange rate is not constant for a nonlinear relation.
- [ ] Insert result → equation, rates, and verdicts land in Word.

## 0be. New in v2.101.0 — paste the whole problem

- [ ] Paste a full problem (equation + question prose + answer choices, e.g. the
  SAT Celsius/Fahrenheit question) into Solve → note "Found the equation … lines
  of prose around it ignored"; the equation solves with its chips.
- [ ] Paste `Let y = 2x + 1` ⏎ `and x = 3` ⏎ `find y.` → framing stripped, the
  system solves to y = 7.
- [ ] A pasted equation the parser refuses on purpose (`y = 1/2x`) stays visible
  with its ambiguity message — never silently dropped.

## 0bd. New in v2.100.0 — fraction equations

- [ ] Type `3/(x+3) = 8` → work shows "Multiply both sides by (x + 3)…", the
  cleared linear, collect/divide, **x = −21/8**; the x ≠ −3 condition appears.
- [ ] Paste a rendered fraction from a web page (or type the three lines
  `3` ⏎ `x+3` ⏎ `=8`) → note "Read the pasted stacked fraction as
  (3)/(x+3) =8" and the same solution.
- [ ] `6/x = 5 - x` → clears to a quadratic and FACTORS: (x − 2)(x − 3).
- [ ] `1/x + 1/(x+1) = 1` → multiply-through by both denominators, quadratic
  formula work, both roots.
- [ ] A real two-line system (`x + y = 3` ⏎ `x - y = 1`) still solves as a
  system — never reassembled into a fraction.

## 0bc. New in v2.99.0 — show your work

- [ ] Solve `3x + 7 = 22` → the pane shows the WORK: "Collect… 3x = 15",
  "Divide both sides by 3", x = 5 — then **Insert result** puts the same worked
  lines into Word as real equations.
- [ ] `x^2 - 5x + 6 = 0` → factoring work: (x − 3)(x − 2) = 0 and the
  zero-product line, then both roots.
- [ ] `x^2 - 2x - 1 = 0` → quadratic formula with numbers substituted
  (… ± sqrt(8)) — the ± line inserts as text, the rest as equations.
- [ ] Differentiate `sin(x^2)` → chain-rule work (u = x², d/du sin(u) = cos(u),
  u′ = 2x) with superscripts drawn properly, then f′.
- [ ] Integral `x^2` from 0 to 3 → F(x) = x³/3 + C and
  "F(3) − F(0) = 9 − (0) = 9".
- [ ] Integral `1/x^2` from −1 to 1 → NO fundamental-theorem work (the pole
  caveat instead) — and nothing reading "= NaN" anywhere.
- [ ] The equation canvas shows the same work above its roots.

## 0bb. New in v2.98.0 — the canvas becomes a workbench

### 0bb-1. Paste from anywhere
- [ ] Copy an equation OUT of a rendered Word equation (or paste `𝑥² − 5𝑥 + 6 = 0` with
  math-italic x) into Solve → note under the input says styled letters were read; roots 3 and 2.
- [ ] Paste LaTeX: `\frac{1}{x} + \frac{1}{x+1} = 1` → "Read as LaTeX." note; solves.
- [ ] Type `A = θ r²` (Greek θ from the palette) → chips offer A, theta, r; solve for θ → A/r².
- [ ] Paste something with ± → the note explains ± means two expressions; nothing is guessed.

### 0bb-2. The canvas solves and graphs live
- [ ] Open equation canvas → type `x^2 = 2x + 1` → the SOLUTION appears in the canvas
  (roots 1 ± √2) AND the graph shows both curves crossing at the roots.
- [ ] Graph `sin(x)` + `cos(x)` on two lines → two labelled curves; change x-window → redraw.
- [ ] Graph `1/x` → the pole at 0 is a GAP, not a wall.
- [ ] Integral kind in the canvas: bounds boxes; `x^2` from 0 to 3 → 9 exact with F(x);
  clear bounds → antiderivative + "checked by differentiating back".
- [ ] Search box: type "gas" → only PV = nRT (and matches) remain; clear → all groups return.
- [ ] Derivative kind: calculus templates (limit → 0, Taylor…) load prose that solves.

## 0ba. New in v2.97.0 — Solve: equation canvas pop-out + real symbols

### 0ba-1. Symbols, not spellings
- [ ] Solve → Solve an equation: click **√** in the palette → the input shows `√()` (the sign,
  not `sqrt`); type `x+1` inside and ` = 3` after → the box below the input DRAWS the
  equation as real mathematics (radical bar over x+1) and the result solves x = 8.
- [ ] Type `x` then click **x²** → input shows `x²`; add `= 4` → roots ±2.
- [ ] Click **≤** between `x²` and `4` (fresh input `x² ≤ 4`) → interval [−2, 2] with sign analysis.

### 0ba-2. The equation canvas
- [ ] **Open equation canvas ⤢** → a large dialog: the current input rides along, the equation
  drawn LARGE at the top, palette + equation library below, a live "Reads as…" status line.
- [ ] Click **PV = nRT** in the library → drawn at size; **Use this equation** → back in the
  pane with chips for P, V, n, R, T.
- [ ] Geometry kind → **Open equation canvas** → shape templates; click **Rect − triangle** →
  the composite FIGURE draws live in the dialog; Use → pane shows the same result + figure.
- [ ] Cancel and the ✕ close both re-arm the button (no dead "Open equation canvas").

## 0az. New in v2.96.0 — Solve: composite geometry + equation composer

### 0az-1. The motivating request, in prose
- [ ] Solve → Geometry, type: `take a rectangle that is 10" x 5" with a triangle inside, base 4" height 3"`
  → the pane shows **rectangle area (cutouts still counted) = 50 in²**, **− triangle = 6 in²**,
  **area without the cutouts = 44 in²**, the placement caveat, AND a drawn figure
  (blue rectangle, hatched red triangle, caption `base area 50 in² · removed 6 in² · net 44 in²`).
- [ ] **Insert result** → the derivation lands as real Word equations AND the figure follows it.
- [ ] `rectangle 8 x 6 minus circle r=2` → net shows **48 - 4*pi ≈ 35.43** — π survives to the document.
- [ ] `rectangle 10" x 5" with a triangle inside` (no dims) → asks for base/height, Insert stays disabled.

### 0az-2. The equation composer
- [ ] Solve → Solve an equation: a palette appears under the input (Structures / Functions /
  Relations / Algebra / Geometry formulas / Physics / Growth & finance).
- [ ] Click **F = ma** in Physics → input becomes `F = m a`, chips offer F / m / a; pick `a` → `a = F/m` with m ≠ 0.
- [ ] Click **√** with the cursor mid-expression → `sqrt()` lands at the cursor, caret inside the parens.
- [ ] Switch to Geometry kind → the palette swaps to Composite figures / Single shapes templates;
  Topology and Word problem kinds show no palette; λ-calculus shows its own
  (Symbols / Reduction / Church encodings / Questions), and Discrete math shows six template groups.

## 0ay. NEW — EVERY calculator draws, everywhere (84 of 84 outside Engineering)

**This is the section to run first, and the only gate that can prove any of it.**
Statistics, Analyze, Bio/Assay and Finance went from 34 figures between them to
all 84; Solve and UV-Vis were wired too. Automated gates prove the pane *asks*
Word for a picture — `npm run audit:pane` presses Insert against a recording
mock — but **a mock always says yes.** Whether the picture lands in the document
is exactly what four consecutive defects in v2.31.1–v2.31.4 got wrong, and none
of them was visible to any test.

**The insert path itself changed**, which is why this matters more than usual:
`insertPlainText` now returns whether it succeeded, and Statistics, Bio/Assay
and Finance each insert TEXT AND FIGURE from one button. `insertPlainText` is
the shared path for mass spec, spectra, properties, stats, finance, assay,
solve, analyze, cross-references and SEQ ID refs — so §0ay-4 is a regression
check on all of them, not only on the new work.

### 0ay-1. The figure reaches the document — one per registry

For each, click **Insert result** ONCE and look at the document, not the pane.

- [ ] **Stats → Descriptive statistics**, defaults → the numbers, then a box
  plot beneath them with a red median line inside a blue box and the
  observations as grey dots. Both must be in the document.
- [ ] **Stats → Tukey HSD**, defaults → the table of pairwise differences AND a
  forest plot: one horizontal interval per pair with a dashed red line at
  zero. Intervals that cross the line are grey, those that clear it blue.
- [ ] **Analyze → Data insights**, defaults → the narrative AND a correlation
  matrix, red/blue diverging, 1.0 down the diagonal.
- [ ] **Analyze → Matrix inverse**, defaults → the matrix as a Word TABLE and a
  heat map of the same numbers. Two objects, not one.
- [ ] **Bio/Assay → Michaelis–Menten**, defaults → Vmax/Km/R² AND the fitted
  curve through the data points. **This one was broken:** the curve was drawn
  in the pane and "Insert result" wrote only the text.
- [ ] **Bio/Assay → Beer–Lambert**, defaults → the concentration AND a
  calibration line with your reading marked in red on it.
- [ ] **Finance → Loan amortization (summary)**, defaults → the three totals AND
  a chart with interest falling and principal rising, crossing about two
  thirds of the way along. **Finance could not draw at all before this.**
- [ ] **Finance → NPV**, defaults → the NPV AND a waterfall whose bars end at
  the total bar. If the bars do not reach the total, stop and report it.
- [ ] **Solve → equation**, `x^2 - 5x + 6 = 0` → roots 2 and 3 AND a curve
  crossing zero at exactly those two places.
- [ ] **Solve → derivative**, `sin(x^2)` → f and f′ overlaid; f′ crosses zero
  where f turns.
- [ ] **Spectra → UV-Vis**, any enone (e.g. `CC1=C(C(CCC1)(C)C)/C=C/C(=O)C`) →
  the λmax AND an increment waterfall ending on it. It must be a LEDGER of
  base value plus substituent increments — **not** a smooth absorption band.
  A band would be invented data and is a FAIL.

### 0ay-2. The figure matches the number beside it

Every one of these was a real defect found by review; each is the figure
disagreeing with its own text.

- [ ] **Finance → DCF valuation**, defaults → `Value = 1,610.39`, and the
  ladder's bottom bar is labelled **forecast** (not "total") at ≈272.73,
  with rows starting at **t=1**. A bar labelled "total" showing 272.73 under
  a Value of 1,610.39 is the defect.
- [ ] **Finance → IRR**, paste `-1000, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200`
  → eight `t=` bars, then one row reading `t=8..10`, then the total at ≈0.
  No flow may vanish silently.
- [ ] **Finance → Loan amortization**, `p=200000, rate=5, t=1, m=1` → ONE
  payment. There must be **no chart at all** — an empty titled frame with a
  legend and nothing drawn is the defect.
- [ ] **Finance → Depreciation (straight line)**, `cost=10000, salvage=1000,
  life=7.5` → the curve must reach **1000**, matching the sentence about
  reaching salvage. Stopping at 1600 is the defect.
- [ ] **Stats → Wilcoxon signed-rank**, defaults → the text says `n = 7` and the
  "difference" box says `n=7`. Two different n values is the defect.
- [ ] **Stats → Uncertainty propagation**, defaults → `40 ± 0.693`, and the bars
  are ≈0.4 each (same units as the ±), not ≈0.16 (squared units).

### 0ay-3. Nothing wrong can be inserted

- [ ] **Stats → Two-sample t-test**, group A `7 7 7 7 7 7 7 7 7 7`, group B
  `1 3 9 14 22 31 45 60 80 110` → **Insert must be DISABLED.** The
  assumption note contains a literal `Infinity`, and it must not reach a
  document. (This one regressed once already, from an unrelated fix.)
- [ ] **Stats → Chi-square independence**, a table of all zeros → refuses with
  "Every count is zero". A confident `p = 1` is the defect.
- [ ] **Stats → any calculator whose Insert is disabled** → the **Insert chart**
  button beside it must be disabled too.

### 0ay-4. The shared insert path still behaves (regression)

- [ ] **Mass Spec**, any formula → Insert result → text lands, status says
  inserted. (`insertPlainText`'s return type changed; every caller is affected.)
- [ ] **Stats → Regression**, defaults → Insert result ONCE → text and the
  diagnostic figure, **one copy of each**. Click Insert result TWICE quickly →
  you must NOT get one text and two pictures.
- [ ] **Bio/Assay → Hill**, defaults → Insert result, then **Insert fit plot** →
  the plot appears a second time, deliberately. That button still works.
- [ ] Any calculator where insertion FAILS (e.g. with the document locked) →
  the status must say it could not insert. A green "Result and chart
  inserted" over a failure is the defect.

### 0ay-5. Sign-off

Figures are inserted as pictures at their intrinsic size; a squashed or
stretched figure means a size was pinned to the asked-for value rather than
read from the SVG. Note anything that reads badly at Word's default zoom —
"it computes correctly" is not the bar here, legibility is.

### RUN 2026-08-05 — figures VERIFIED IN REAL WORD at build 2.90.1

**0ay-1 PASSED.** The user generated every figure and reported them all good:
*"All the charts look great. i generated each one."* That covers the whole of
0ay-1 — one figure per registry, inserted into a real document, in the
production build. It is the only evidence that exists for the campaign's
central claim, because every automated gate proves the pane ASKS Word for a
picture and a mock always says yes.

Recorded here rather than left in a chat log because a pass that leaves no
trace is, from the repo's point of view, indistinguishable from one that never
happened — and OPEN-ITEMS.md §1 has been re-flagging exactly that for months.
The BUILD is the load-bearing part: a regression found in Word later can now be
tied to 2.90.1 rather than to "some recent version".

**Still outstanding at this build:** 0ay-2 (the six cases where a figure was
caught contradicting its own text), 0ay-3 (what must stay un-insertable) and
0ay-4 (the shared insert path, whose contract changed across ten modes).
Solve is being tested separately.

Tester: the user  ·  Date: 2026-08-05  ·  Build (version.json): 2.90.1

Tester: ______________  Date: __________  Build (version.json): __________


## 0a. What changed in v1.97-2.4.0 — check this first

The pane was restyled to match the landing page. Nothing about what the tools
COMPUTE changed, so this section is about appearance and reach.

- [ ] The pane header shows the **scales-of-justice logo** (benzene ring on one
  side, summation sign on the other) beside the JurisLab wordmark.
- [ ] **The ribbon button may still show the OLD icon.** That is Word's cache,
  not a build problem — Office caches add-in icons by URL and the filenames did
  not change. See the note at the end of this section to clear it. The icon in
  the PANE is the truth.
- [ ] Home tiles show **drawn line icons** — a benzene ring for Chemical, a
  sigma for Math, a double helix for DNA — not emoji and not numerals. Every
  tool has its own; no two are the same drawing.
- [ ] Colours are navy/cyan, not the old Office blue; buttons are navy with a
  cyan focus ring.
- [ ] **Drag the pane as narrow as it will go.** Nothing should be cut off at
  the right edge. Check **Align** in particular: its mode dropdown used to run
  ~21px past the edge at the narrowest width, where it could not be clicked.
  (Now gated by `npm run check:pane`, but only a human can confirm in Word.)

**New capabilities in v1.99.0 — worth a pass each.**
- [ ] **Plot → x/y scale = Log₁₀.** Enter data spanning decades including a zero
  (e.g. `0 5`, `1 12`, `10 30`, `100 61`). The zero must be dropped WITH a
  warning saying so, and the decades must be evenly spaced.
- [ ] **Stats → t-test.** The result line now carries Cohen's *d* and a 95% CI on
  the difference. A paired test must say `d_z`, not `d`.
- [ ] **Numerals → USPTO paragraph numbers.** On a spec with headings, press
  Preview: headings, blank paragraphs and the claims must be excluded from the
  count. Then Apply, and confirm Ctrl+Z reverses it.
- [ ] **DNA → Virtual digest.** Same sequence as Linear then Circular: circular
  must give exactly ONE fewer fragment, and one fragment marked "through origin".
- [ ] **Citations → native TOA.** In a brief using short forms (`Alice, 573 U.S.
  at 217`), the page list must now include those pages, not just the full cite.
  The message says how many `Id.` references it declined to attribute.

**Dark mode (v2.0.0).** The pane follows Word's own theme.
- [ ] Switch Word to **File → Account → Office Theme → Black** (or Dark Gray).
  With Appearance on **Match Word** the pane should go dark to match. Switch back
  to Colorful/White and it should return to light.
- [ ] The **Appearance** control at the bottom of the pane forces Light or Dark
  and overrides Word. The choice must survive closing and reopening the pane.
- [ ] **The 2D structure / plot / spectra preview stays WHITE in dark mode.**
  That is deliberate, not a bug: those previews show artwork that is inserted
  into the document as black-on-white line art, and a dark preview would
  misrepresent what you are about to insert. Confirm an inserted structure is
  still black-on-white with the pane in dark mode.
- [ ] Nothing is unreadable in either theme — check disabled buttons, the
  warning/error text, and the active filter chip in particular.

**Statistics in v2.1.0.**
- [ ] **Stats → Check test assumptions.** Paste two skewed groups; it must say
  the data are NOT normal and name Mann-Whitney as the alternative.
- [ ] **Stats → t-test on non-normal data.** The result must carry the same
  warning underneath the p-value, and that warning must travel into the document
  when you insert it.
- [ ] **Stats → Kruskal-Wallis.** Dunn post-hoc appears only when the overall
  test is significant; with a non-significant result it says so instead.
- [ ] **Stats → Friedman.** One row per subject. A ragged design (rows of
  different lengths) must be refused, not padded.
- [ ] **Stats → Dunnett (each treatment vs one control).** First group is the
  control. Check that it corrects for the number of TREATMENTS, not all pairs —
  the note under the result says so — and that its p-values are smaller than
  Tukey's on the same data.
- [ ] **Stats → Tukey HSD** caveats must no longer mention "Games-Howell", and
  the Dunnett they point to must now exist in the Test dropdown.

**Regression in v2.2.0.**
- [ ] **Stats → Multiple regression.** One row per observation, response first.
  Two diagnostic plots must appear under the result.
- [ ] **Stats → Polynomial regression.** Fit degree 1 to data that is obviously
  curved: the residual plot must show a clear ARC. Refit at degree 2 and the arc
  must disappear into a shapeless band. That contrast is the whole point of the
  plot — R² alone will not tell you.
- [ ] Enter two identical predictor columns: it must REFUSE with a collinearity
  message, not return coefficients.
- [ ] The diagnostic plots stay on white paper in dark mode (same reason as the
  structure preview).
- [ ] **Every Stats test's "Insert result" button is enabled** once it has a
  result. Tukey HSD's had been permanently disabled before v2.2.0 — its caveats
  contained em dashes, which the reader treats as a non-finite-value sentinel.
  Insert a Tukey result and confirm it lands in the document.

**Survival analysis in v2.3.0.**
- [ ] **Stats -> Survival (Kaplan-Meier).** One row per subject: time, then 1
  (event) or 0 (censored). Change one subject from 1 to 0 and confirm the curve
  does NOT step down at that time — it should stay flat and the subject should
  simply leave the risk set.
- [ ] Make every subject censored: median survival must read NOT REACHED, not a
  number.
- [ ] **Stats -> Log-rank.** Two groups separated by a blank line. Both curves
  must appear on one chart, and the hazard ratio direction must match which
  group is doing better.

**Refactor in v2.4.0 — no behaviour should change, which is what to check.**
Finance, Stats, Analyze and Bio/Assay now share one field renderer. Nothing
about any calculator should look or behave differently.
- [ ] In EACH of those four tools, switch between several calculators and
  confirm the input fields change correctly each time, and that typing in them
  still updates the result live.
- [ ] Multi-line fields (Stats "Groups", Analyze matrix/ODE fields) must still be
  text AREAS, not single-line boxes.

**Clearing a stale ribbon icon.** Quit Word fully, then delete the Office add-in
cache and reopen:
- **macOS:** `~/Library/Containers/com.microsoft.Word/Data/Library/Caches/` and
  `~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/`
- **Windows:** `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\`

---

## 0b. New in v2.36.0 — elastic beam supports and MDOF forced response

Engineering > Structural & solids > **Beam analysis**:

- [ ] Leave the defaults (`pin 0, roller 8`, udl 5 + point 30) and note the two
  reactions. Now change the supports to `pin 0, roller 8 settle=0.01` and put
  `2.4e5` in the EI field. **The reactions must not change at all** — a
  determinate beam does not care that a support moved. The determinacy line
  should say so in words.
- [ ] Change the supports to `fixed 0, roller 8 settle=0.01`, EI `2.4e5`, and
  DELETE every load. Reactions are now non-zero: settlement alone induces them
  in an indeterminate beam. Double EI to `4.8e5` and they should **double**.
- [ ] With any spring or settlement present, clear the EI field. It must be
  **refused with a reason** — that there is no EI-free answer to give — rather
  than silently computing something.
- [ ] `roller 8 k=0` must be refused as NO support rather than a soft one.
- [ ] Check the result says the reactions are **not EI-free**, and that the old
  "reactions ... are exact without it" line does NOT appear for these beams.

Engineering > Vibration > **Forced response of a multi-DOF system**:

- [ ] Defaults compute and insert. The modal breakdown lists one row per mode
  with its own ζ, r and share of the peak response.
- [ ] Set the mass matrix to `1 0 / 0 1` and stiffness to `200 -100 / -100 200`
  (matrix input), force `10 10`, ω `5`. Mode 2 is antisymmetric and the load is
  symmetric, so **mode 2's generalised force must be 0** and the note about a
  load at a node of a mode must appear.
- [ ] Set damping to `0` and ω to a natural frequency shown by the Natural
  frequencies tool. It must **refuse** with "no steady state", not print
  Infinity or NaN.
- [ ] Enter damping as `rayleigh 0.6 0.002` and confirm the per-mode ζ values
  differ between modes.
- [ ] The classical-damping caveat appears in the notes every time.

---

## 0c. New in v2.37.0 — fractions in every beam field

Engineering > Structural & solids > **Beam analysis**:

- [ ] Span `9`, supports `pin 0, roller 9`, one load `point 30 at 9/3`. The
  reactions must read exactly **20** and **10** — not 19.999999 — because the
  position went in as an exact third rather than a rounded decimal.
- [ ] Fractions work in the other fields too: `udl 7/2 from 1/3 to 16/3`,
  `moment 200/3 at 4/3`, `roller 8/3`, `roller 8 k=1/3 settle=1/400`, and in the
  span and EI boxes.
- [ ] `roller 1.5/3` must be **refused** ("is not a number"), not reinterpreted.
  Same for `roller 8/0`.
- [ ] **The one that mattered:** `pin 0, roller 8 k=1/2/3` must be REFUSED with a
  message naming `k=1/2/3`. Before v2.37.0 it silently moved the roller to 8/3
  and flipped a reaction into uplift. Check the support really is refused rather
  than quietly relocated — the old behaviour looked like a perfectly normal
  answer.
- [ ] `k=5 roller 8` (option before the position) must be refused.
- [ ] Uppercase still works: `UDL 0 TO 9 FROM 1/3 TO 6`.

---

## 0d. New in v2.39.0 — divergent integrals, the PK figure, and a 130k paste

Every item here is a bug that shipped and looked completely normal. Check the
refusals as carefully as the answers: in each case the old behaviour was a
plausible number, not an error message.

Math > **Solve** > definite integral:

- [ ] `1/((x-1)^2)` from `0` to `2` must be **REFUSED** — "does not exist on this
  interval", naming a POLE near x = 1. It used to report **−2** as
  "exact (symbolic)" with no caveat at all. The integrand is positive everywhere
  on that interval, so a negative area was impossible, not merely inaccurate.
- [ ] `tan(x)` from `0` to `3` must be refused (pole at π/2). It used to report
  0.01005 as exact.
- [ ] `1/(x-0.5)` from `0` to `3` must be refused. This one took the *numeric*
  path and returned a confident **5.0355** — the quadrature stepped over the pole
  without ever sampling it.
- [ ] `1/(x^2-4)` from `0` to `3` refused (pole at x = 2); from `0` to `1` it must
  still give the ordinary answer **−0.2747**.
- [ ] **The control that matters most:** `1/((x-1)^2)` from `2` to `3` must still
  return **0.5**. The pole is real but outside the interval, and refusing this
  would mean the fix went too far.
- [ ] A handful of ordinary integrals must be untouched and still say
  "exact (symbolic)": `x^2` over [0, 2] = 2.6667, `1/(x^2+1)` over [0, 1] =
  0.7854, `ln(x)` over [1, 2] = 0.3863, `sin(x)` over [0, π] = 2.
- [ ] Type into the integral fields and watch for lag. The pole search runs on
  every keystroke; it should be imperceptible.

Math > **Solve** > derivative:

- [ ] `log10(x)` must give `0.434294/x`. It used to **throw an error** into the
  pane — `log10` was the only function the parser accepted and the derivative
  table did not have.
- [ ] `x/0` must show a caveat saying the result is not a number. It used to
  report the derivative as **`0`**.

Analyze > **Pharmacokinetics (NCA)**:

- [ ] Paste concentration-time data whose **first sample is 0** — which is normal,
  the pre-dose sample is zero by definition:
  `0 0 / 0.5 12.1 / 1 10.9 / 2 9.6 / 4 7.8 / 8 4.3 / 12 2.4 / 24 1.3 / 48 0.13`,
  dose 500, IV.
- [ ] **Look at the figure.** Every point must be visible on the log axis. It used
  to insert a figure where all nine points were `cy="NaN"` — a blank plot body
  with no y-axis labels, but a normal-looking x axis, beneath a numerically
  correct report. If the figure looks empty, this has regressed.
- [ ] A note must appear saying **1 point** could not be plotted on a logarithmic
  axis, that it is omitted from the figure only, and that the numbers use the full
  data set.
- [ ] Same check with a trailing zero (a below-limit-of-quantification sample).
- [ ] With data where *every* concentration is zero, there must be **no figure at
  all** rather than an empty frame.

Stats > **Uncertainty propagation**:

- [ ] Variables `a = 1e-3 ± 1e-4`, `b = 20 ± 0.2`, `c = 5 ± 0.05`, formula
  `a*b/c`. This must work. It used to say **`Unknown variable "a"`** — about a
  variable defined on screen — because the parser accepted `1e+3` but not `1e-3`.
- [ ] `a = 5 ± -0.1` must be **refused** with a message saying an uncertainty is a
  magnitude. Do not accept a negative uncertainty: propagation squares it, so it
  would vanish into a plausible answer.
- [ ] `a = 1.2.3 ± 0.1` must be refused by name, not silently read as 1.2.
- [ ] A negative *value* is still fine: `dT = -1.5e-3 ± 2e-5`.

Anywhere that takes a pasted column of numbers — **Plot**, **Analyze → data
insights**, **FFT filter**, **Table→Chart**:

- [ ] Paste a **very large** column, at least 150,000 rows. A spreadsheet column
  that size is ordinary. Nothing may crash. The previous limit was about 125,000
  and the failure was a cliff, not a slowdown — 100,000 rows worked perfectly,
  which is why no test caught it.

Engineering > **Circuits**:

- [ ] `V1 1 Gnd 5` / `R1 1 0 1k`. Ground aliases are now case-insensitive, so this
  must give V(1) = 5 V. It used to report **V(1) = 0 V and V(Gnd) = −5 V** — an
  exact, unique, wrong answer, because `Gnd` with a capital G was treated as an
  ordinary node. Try `GND`, `Ground`, `GROUND`, `VSS` too.
- [ ] An inductor of `0` or a capacitor of `0` must be refused at parse. They used
  to return "ok" with all-NaN node voltages that were still insertable.
- [ ] A circuit whose only path to ground is through a **capacitor** must be
  refused for having no DC path. The capacitor used to count as a path, defeating
  the refusal the module's own header advertises.

Engineering > **Control**:

- [ ] Transfer function `1` over `s^3 + 10000000003 s^2 + 30000000002 s +
  20000000000` — that is `1/((s+1)(s+2)(s+1e10))`. The verdict must read
  **STABLE**. It used to read "MARGINALLY STABLE — 2 poles on the imaginary axis"
  directly above a pole list where every pole was tagged "(stable)", because one
  tolerance was scaled by the largest pole.
- [ ] `1/s` must still be MARGINALLY STABLE, and `1/(s-1)` still UNSTABLE — the
  genuine cases must not have been loosened away.

Chemical:

- [ ] Formula `H0` must be **refused**. It used to validate clean with a molar
  mass of 0 and a Hill formula of "H0". Same for `C0H4`. Ordinary formulas
  (`H2O`, `K4[Fe(CN)6]`) must be unaffected.

> **Known and NOT fixed in this release.** `docs/KNOWN-DEFECTS.md` lists eleven
> defects that still produce a wrong number, with exact reproductions — settling
> time for an overdamped system, phase margin at the wrong crossover, NCA area
> starting at the first sample instead of t = 0, oral half-life without a
> flip-flop check, small limit points, and several tolerance bands in the equation
> solver. If you are checking those areas, read that file first so you know what
> you are looking at.

---

## 0e. New in v2.40.0 — poles that were reported as roots, and lost roots recovered

Every item is a bug that shipped looking completely normal. As in section 0d, the
**refusals matter as much as the answers** — in each case the old behaviour was a
plausible number rather than an error.

Math > **Solve** > equation:

- [ ] `1/(x-2.25) = 0` must return **no roots**. It used to report **2.25**, where
  the left-hand side evaluates to −1.1e12. Same for `x/(x-2.25) = 1` and
  `(x+1)/(x-2.25) = 1`.
- [ ] `tan(x) = 2` must return **588** roots, not 1176. The old list alternated real
  solutions and asymptotes — spot-check that 1.107 (which is arctan 2) is present
  and that 1.571 (π/2, an asymptote) is **not**.
- [ ] `0.0000000000001*x^2 - 1 = 0` must give **±3162277.66**. It used to say "No
  value of the variable satisfies this equation."
- [ ] `0.0000000001*x^2 - 0.0001 = 0` must give **both** ±1000. It used to give only
  1000, labelled exact — half the answer, presented as certain.
- [ ] `x - 1e300 = 0` must give **1e300**, with no warning. This is the regression
  the first attempt at the above introduced, so it is worth checking directly.
- [ ] `x^2 - 1e-20 = 0` must give **±1e-10**, not "0, 0".
- [ ] `(x-1)/(x-1) = 1` must say **identity**, instantly. It used to return 4000
  roots and take about three seconds.
- [ ] `sin(x)^2 + cos(x)^2 = 1` must also say identity. And `exp(ln(x)) = x`.
- [ ] `sin(x)^2 + cos(x)^2 = 1.0000001` must **NOT** say identity — it has no
  solution. The check must be tight enough to tell those apart.
- [ ] `exp(x) = 0` must report **no reliable root found** and list nothing. It used
  to return 510 values from the underflow region.
- [ ] **Known and NOT fixed:** `cosh(x)^2 - sinh(x)^2 = 1` still returns 33 spurious
  roots. It is an identity. See B15 in `docs/KNOWN-DEFECTS.md` for why, and why the
  attempted fix was reverted rather than shipped.
- [ ] Ordinary equations must be untouched: `x^2 - 4 = 0` → ±2, `2*x + 4 = 0` → −2,
  `x^3 - 6*x^2 + 11*x - 6 = 0` → 1, 2, 3, `sin(x) = 0` → the multiples of π.

Math > **Solve** > definite integral — the displayed antiderivative:

- [ ] `1/(x^2+x+1)` from 0 to 1. The antiderivative shown must read
  **1.15470053838**, not 1.154701. That coefficient is 2/√3.
- [ ] **Copy the displayed antiderivative and paste it back in** as a function to
  differentiate or plot. It must parse and describe the same function. Before, it
  was rounded to six decimals and silently described a different one — which
  matters because showing it is an invitation to reuse it.

Engineering > Structural & solids > **Beam analysis**:

- [ ] Insert a beam diagram and check the figure is not squashed or clipped — the
  x-axis label must be fully visible. Two tests that were supposed to guarantee this
  could not fail, so this has been unguarded until now. Try a cantilever, a simple
  span, three supports, and a spring support.

---

## 0f. New in v2.41.0 — control: settling time, margins, and a verdict withheld

Engineering > Control systems. Every figure below was wrong in a way that looked
entirely plausible, so check the numbers, not just that something appears.

**Second-order metrics / step response:**

- [ ] `wn = 1`, `zeta = 20` (denominator `s^2 + 40s + 1`). The 2% settling time must
  read about **156 s**. It used to read **0.2 s** — 780 times optimistic — and was
  flagged exact.
- [ ] Sweep zeta upward: 1, 2, 5, 10, 20. Settling time must **INCREASE** every
  time. It used to fall (4, 2, 0.8, 0.4, 0.2), which is backwards — more damping
  means slower settling.
- [ ] `zeta = 1` (critically damped) must read about **5.83 s**, not 4.
- [ ] `zeta = 0.2` must still read **20 s** — the underdamped envelope estimate is
  the textbook convention and is deliberately unchanged.

**Margins:**

- [ ] Open loop numerator `100 s^2 + 2 s + 100`, denominator `s^4+4s^3+6s^2+4s+1`.
  The phase margin must read about **23°**, not 32.5°. A note must appear saying
  the magnitude crosses 0 dB at **3 frequencies** and that the smallest margin is
  the one reported.
- [ ] Numerator `1e12`, denominator `s^3+3s^2+3s+1`. A phase margin must be
  **reported** (about −90°). It used to say there was none, because the swept range
  stopped at ω = 100 while the crossover is at ω = 10005.
- [ ] Numerator `0.01`, denominator `s+1`. There must still be **no** phase margin —
  the magnitude never reaches 0 dB, and extending the sweep must not invent one.
- [ ] Numerator `1`, denominator `s^3+3s^2+2s` (that is `1/(s(s+1)(s+2))`). Gain
  margin must be **15.56 dB** and no multi-crossing note should appear.
- [ ] Type into the gain field and watch for lag — the sweep now extends itself, so
  this is worth a moment.

**Stability:**

- [ ] Denominator `s^6+3s^4+3s^2+1` (that is `(s^2+1)^3`). The verdict must read
  **UNDETERMINED**, explaining that a repeated pole cannot be resolved numerically
  and to treat it as marginal. It used to read "UNSTABLE — 2 poles in the right half
  plane" for a marginally stable system.
- [ ] These must keep their definite verdicts — the refusal must be narrow:
  `s^2+2s+1` → STABLE, `s^3+3s^2+3s+1` → STABLE, `s^2-2s+1` → UNSTABLE,
  `s^4-2s^2+1` → UNSTABLE, `s^2` → MARGINALLY STABLE, `s^2+3s+2` → STABLE.

---

## 0g. New in v2.42.0 — pharmacokinetics: the missing area, flip-flop, absorption

Analyze > Pharmacokinetics. Every figure below was wrong in a way that looked
entirely reasonable.

**Non-compartmental analysis (NCA):**

- [ ] Paste an IV bolus profile whose **first sample is late** — for example
  `2 67.0 / 4 44.9 / 8 20.2 / 12 9.1 / 24 0.82`, dose 500, route IV. The clearance
  must read about **1.0 L/h**. It used to read **1.37** — 37% high — because the
  area from dosing to the first sample was simply missing. With a first sample at
  4 h the old error was **98%**.
- [ ] A note must appear saying the first sample is not at time zero, giving the
  **back-extrapolated C0**, and admitting that it is an extrapolation.
- [ ] Same data with a sample added at `0 100`: the clearance must barely change.
  Before, the two answers differed by more than a third.
- [ ] Switch the route to **oral** on data starting after t = 0. The note must now
  say the concentration at time zero is **zero by definition** and must NOT mention
  back-extrapolation — the two routes need different conventions and using the
  IV one for an oral dose would invent drug that has not been absorbed.
- [ ] Any **oral** analysis must carry a **FLIP-FLOP WARNING**: the terminal slope
  may be the absorption rate rather than elimination, it cannot be told apart from
  oral data alone, and an IV reference is needed. There was no warning at all
  before, and the two cases give *identical* numbers — in a simulated pair the
  reported half-life was 6.93 h both times when one of them truly had 0.693 h.
- [ ] An **IV** analysis must NOT carry that warning.

**Steady state:**

- [ ] There is a new field, **absorption rate ka**. Leave it blank: the peak must be
  reported "at the moment of dosing" and a note must say the peak assumes the dose
  appears **instantaneously** and is an upper bound for anything swallowed.
- [ ] Now enter `ka = 0.6` with `Vd = 10`, `CL = 2`, `dose = 500`, `τ = 12`. The
  peak must fall from about **55 to about 33 mg/L**, and be reported at about
  **t = 2.5 h** after each dose. A note must state how much higher the
  instantaneous figure was. That 65% overstatement was previously silent.
- [ ] Try `ka = 3`: the peak should rise to about 45.6 mg/L and occur earlier
  (~0.93 h). Faster absorption, higher and earlier peak — that is the check that
  the model is behaving.
- [ ] The **average** concentration must not change when ka changes. Cavg depends
  only on dose rate and clearance; if it moves, something is wrong.
- [ ] Enter `ka` equal to `CL/Vd` (here 0.2). It must fall back to the
  instantaneous formula and say the two rate constants are indistinguishable —
  the standard oral solution divides by their difference.
- [ ] `ka = -1` or `ka = abc` must be refused with a message about a positive
  number, not silently ignored.
- [ ] With a ka supplied, the **plotted curve** must carry a note saying the figure
  is drawn as instantaneous doses and to read the peak from the numbers, not the
  plot. The figure must not silently contradict the text above it.

---

## 0i. New in v2.44.0 — circuits, trusses, parsers and messages

Engineering > **Circuits**:

- [ ] Component value `1e-6` must be **accepted** (it used to be refused while `1u`
  — the same number — worked, so anything pasted from a spreadsheet or a SPICE deck
  failed). Try `2.2e3`, `1E-9`, `4.7e-12`. Suffix forms must still work: `1k`,
  `1u`, `1meg`, `2k2`, `4r7`.
- [ ] `R1 1 0 -1k` must be **refused**, explaining that this tool solves linear
  passive circuits. A negative resistance used to be accepted silently and solved as
  though it were a component.
- [ ] `V1 1 0 5 / V2 2 1 3 / V3 2 0 2` — three sources round a loop. The message
  must say **loop of voltage sources**. It used to say "check for a shorted or
  duplicated source", which is advice for a fault the tool had already excluded.
- [ ] Paste a large netlist — 100+ nodes with cross-connections. It must return
  promptly (it took **1.4 seconds** for the DC solve alone), and a note must say the
  answer used **double precision** rather than exact rationals. A small circuit must
  still say nothing of the kind and stay exact: `V1 1 0 5 / R1 1 2 1k / R2 2 0 1k`
  must give exactly 2.5 V at node 2.
- [ ] A **Bode sweep** on that large netlist must also return promptly (was 1.1 s)
  and say the sweep was **thinned**, naming the point count. A small circuit's sweep
  must keep all 120 points and carry no such note.

Engineering > **Trusses**:

- [ ] Member tension/compression is now read from the exact sign rather than the
  rounded value. Ordinary trusses must be unchanged — the classic three-member truss
  with a 10 kN apex load must still report A-B as **5 kN tension**.

Math > **Solve**:

- [ ] `abs x` must produce an error naming **an opening bracket "("**, not
  "Expected lparen". Try `|x`, `{x`, `sin(x` — each must name the character it
  wanted and say what it found instead.
- [ ] Derivative of `ln(abs(x))` must read **1/x**.

Chemical > **Reactions**:

- [ ] `A ->> B` must warn that the arrow is not recognised. It used to silently
  produce a component called "> B" and hand it to the structure renderer as SMILES —
  it did not error, it drew something.
- [ ] Well-formed arrows must be unaffected and carry no warning: `A -> B`,
  `A <=> B`, `A -> B -> C`, `A >> B`.
- [ ] SMILES charges must not be mistaken for arrows:
  `C[N+](C)(C)C -> [O-]` must parse cleanly.

> **Not fixed, and deliberately so.** `docs/KNOWN-DEFECTS.md` still lists **B3**
> (a blank Bode chart at zero reference — I could not reproduce it and left it open
> rather than claiming it fixed), **B11** (`1/2x` reads as `1/(2x)` in Solve and
> `(1/2)x` in the equation parser — a product decision, not a bug to patch),
> **B15** (an identity hidden by catastrophic cancellation, where the fix I built
> would have called `tan(x) = 2` an identity, so I reverted it), and **C0–C2**.

---

## 0j. New in v2.45.0 — a hidden identity, ambiguous notation, and hydrates

Math > **Solve** > equation:

- [ ] `cosh(x)^2 - sinh(x)^2 = 1` must say **identity**. It used to return 33
  spurious roots. Same for `cosh(2x) = cosh(x)^2 + sinh(x)^2` and
  `tanh(x) = sinh(x)/cosh(x)`.
- [ ] The near-misses must **not** be identities: `cosh(x)^2 - sinh(x)^2 = 1.0000001`,
  `sin(x)^2 + cos(x)^2 = 1.0000001`. And the ordinary equations must still solve —
  `tan(x) = 2`, `exp(x) = 2`, `x^2 = 4`. An earlier attempt at this fix called all of
  those identities, which would have made every equation in the product vacuous, so
  they are worth checking.

Math — **anywhere an expression is typed** (Solve, Plot, equation insertion):

- [ ] `1/2x` must be **refused**, with a message offering both `1/(2x)` and `(1/2)x`.
  It used to mean `1/(2x)` in Solve and `(1/2)x` in the equation parser — the same
  text, two different functions, differing by a factor of (2x) squared. Try `2/2x`,
  `x/2y`, `1/2(x+1)`, and `1/2 x` with a space.
- [ ] These must all still work, unchanged: `1/2*x`, `1/(2*x)`, `(1/2)*x`, `1/2`,
  `x/2`, `sin(x)/2`, `1/2e5` (that last one is a single number, not a product).
- [ ] **Exponents are deliberately NOT refused.** `pi r^2 h` must still insert — an
  exponent extends only to the atom after it, so `r^2 h` is unambiguous. Check the
  formula library still works: volume of a cylinder, volume of a cone, power
  dissipated, two-asset portfolio variance. An earlier version of this refusal broke
  all four.

Chemical > **Mass spec** (and anywhere a formula is counted):

- [ ] `CuSO4·5H2O` must give O:9 and H:10. It used to give **O:46**, because the
  hydrate dot was deleted and "O4" merged with the following "5" into "O45".
- [ ] `Cr2(SO4)3·18H2O` must give Cr:2 S:3 O:30 H:36 — bracket groups were also being
  stripped, so `(SO4)3` read as `SO43`. Try `K4[Fe(CN)6]` and `((CH3)2CH)2O`.
- [ ] A malformed formula like `CuSO4(` must return **nothing** rather than a partial
  count, because the count feeds monoisotopic mass.

> **Still open, and each for a stated reason.** `docs/KNOWN-DEFECTS.md` lists **B3**
> (a blank Bode chart at zero reference — could not be reproduced), **C0** (a
> removable singularity still defeats the numeric quadrature; the obvious repair was
> built, measured at a 1.7% error, and removed — refusing a correct answer is a
> smaller harm than reporting an incorrect one), and **C2** (a huge exact rational
> converting to Infinity, which is the correct IEEE result at the boundary).

---

## 0k. New in v2.46.0 — integrals with a hole in the integrand

Math > **Solve** > definite integral:

- [ ] `sin(x)/x` from `-1` to `1` must now give **1.892166**. It used to be refused —
  the integrand is undefined at x = 0 but its limit there is 1, and the old quadrature
  evaluated exactly that point on its first step.
- [ ] `sin(x)/x` from `0` to `1` must give **0.9460831** (that is Si(1)), and from
  `-1` to `0` the same. The singular point at an endpoint must work too.
- [ ] `(1-cos(x))/x^2` from `-1` to `1` must give **0.9727708**, and
  `(exp(x)-1)/x` from `0` to `1` must give **1.3179022**.
- [ ] The result must SAY the integrand is undefined somewhere and that a removable
  singularity was handled — not just hand over a number.
- [ ] **The important negative.** `1/x` from `0` to `1` must still be **REFUSED**. That
  integral diverges, and the new rule deliberately never evaluates an endpoint, so this
  is exactly where it could hand back a confident wrong number. Check `1/(x-1)` from
  `1` to `2`, `1/x^2` from `0` to `1`, and `1/(2-x)` from `0` to `2` as well.
- [ ] Interior poles must still be refused: `1/(x-1)` from `0` to `2`, `tan(x)` from
  `0` to `3`, `1/x` from `-1` to `1`.
- [ ] Ordinary numeric integrals must be untouched — `sin(x)/x` from `1` to `5` should
  still read 0.6038 and say "adaptive Simpson".

> **Remaining in `docs/KNOWN-DEFECTS.md`:** two entries, neither producing a wrong
> number — **B3** (a blank Bode chart at zero reference, which could not be reproduced)
> and **C2** (a huge exact rational converting to Infinity, which is the correct IEEE
> result at the boundary). Also recorded there: the two parsers still read `2^2x`
> differently, left alone because changing how exponents bind would re-read every
> expression already sitting in a document.

---

## 0l. New in v2.47.0 — exponents, and spaces between symbols

Math > **Solve** (and anywhere an expression is typed):

- [ ] `r^2 h` with `r = 3`, `h = 2` must evaluate to **18**. It used to give **81**,
  because the exponent swallowed the `h` and it computed r^(2h). This was filed as a
  cosmetic inconsistency and was actually a wrong number.
- [ ] `2^2x` must read as (2^2)·x — so with `x = 3` it is **12**, not 64.
- [ ] `pi r^2 h` with `r = 2`, `h = 3` must be **37.699** (that is 12π). It used to be
  a single variable called "pir" raised to the power 2h, so the expression had one
  unknown with a name nobody typed. Check the variable list shows **r and h**.
- [ ] The shipped formulas must now evaluate in Solve, not just typeset: volume of a
  cylinder, cone and sphere, power dissipated `I^2 R`, Pythagoras.
- [ ] `2^3^2` must still be **512** — exponents remain right-associative. And `-x^2`
  with `x = 3` must be **−9**, not 9.
- [ ] `x2`, `Vd`, `v_max` must still each be ONE variable. The fix must not shatter
  legitimate multi-character names.
- [ ] `y z` must be y × z, and `a b c` three variables.
- [ ] `sin x` must be **refused**, saying sin is a function and needs brackets. It used
  to become a variable called "sinx"; without the refusal it would now become sin × x,
  with a variable called "sin".
- [ ] Explicit brackets must be untouched: `2^(2*x)` with `x = 3` is **64**.

> **Remaining in `docs/KNOWN-DEFECTS.md`:** two entries, neither producing a wrong
> number — **B3** (a blank Bode chart at zero reference, which could not be reproduced)
> and **C2** (a huge exact rational converting to Infinity, the correct IEEE result at
> the boundary).

---

## 0m. New in v2.48.0 — heat maps

Table&rarr;Chart. Select a numeric table with several columns, load it, and choose
**Heat map** from "Show as".

- [ ] A month &times; region table must render as a grid of shaded cells, with the row
  labels down the left and the column names across the top.
- [ ] The **value must be printed inside each cell** where it fits. That is not
  decoration — colour alone is a poor readout of a specific number, and these figures
  get printed.
- [ ] A **colour bar with numeric ticks** must always appear beneath the grid, showing
  the low and high ends. A shaded grid with no scale cannot be read.
- [ ] The shading must be **one colour, light to dark** — not a rainbow. If you see
  green and yellow and red in one sequential scale, something is wrong: a rainbow
  implies an order the eye cannot recover.
- [ ] Put a **blank or text cell** in the middle of the table. It must render as an
  empty cell with a diagonal hairline, and a note must say it is NOT counted as zero.
  Check the low end of the colour bar is still the smallest real number.
- [ ] Turn on the **patent / black-and-white** style. The grid must render in greys,
  with no blue surviving, and still be readable.
- [ ] Try a table of **changes** with negatives and positives. (The diverging scale is
  available from the library API; the pane currently offers sequential shading.) With
  diverging selected, zero must be a neutral grey — not a colour — and the bar must
  name the midpoint.
- [ ] Load a **large** table, 30 columns by 40 rows. The cells become too small for
  numbers; a note must say the colour is then the only readout.
- [ ] **Export to PowerPoint.** A heat map must export as a **picture**. It must never
  come out as a bar or line chart — PowerPoint has no heat-map chart type, and
  substituting one would present different information under the same title.

---

## 0n. New in v2.49.0 — candlestick (OHLC) charts

Table&rarr;Chart. A table with one row per period and four numeric columns, then
**Candlestick** from "Show as".

- [ ] Columns named `Open`, `High`, `Low`, `Close` (any capitalisation, any order)
  must render one candle per row, with a wick from low to high.
- [ ] **The legend must state the convention in words** — "hollow = close at or above
  open", "filled = close below open". Direction must NOT rely on colour alone:
  green-up is a Western convention and red means UP across much of East Asia.
- [ ] Turn on the **patent / black-and-white** style. The chart must still distinguish
  up from down — hollow versus filled bodies — with no green or red anywhere.
- [ ] Rename the columns to something unrecognisable (`c1`, `c2`, `c3`, `c4`) but keep
  them in open/high/low/close order. It must still draw, AND say it assumed the
  conventional order and checked that against the data.
- [ ] Now **swap two of those unnamed columns** so high is no longer the largest. The
  chart must **REFUSE**, naming the row, and say that drawing it would produce candles
  that look plausible and are wrong. This is the important one: a silent wrong reading
  here is undetectable by eye.
- [ ] Put a row where the **high is below the close**. That row must be skipped with a
  note calling it a data error rather than a market event; the other rows still draw.
- [ ] Leave one cell **blank**. That period must leave a gap rather than shifting the
  later candles left — otherwise every subsequent candle is silently misdated.
- [ ] A table with only two or three columns must be refused, saying what it found.
- [ ] Load **120 periods**. Only some x labels should show, but every candle must be
  drawn, and a note should say so.
- [ ] **Export to PowerPoint** — it must go out as a picture, never as a bar or line
  chart.

---

## 0o. New in v2.50.0 — periodic table & atomic structure

Chemical mode, the new **Periodic table &amp; atomic structure** panel.

- [ ] Type `C` and choose **Element summary**. It must show atomic number 6, the held
  atomic weight, period 2 / group 14 / p-block, the configuration `1s2 2s2 2p2`, the
  abbreviated `[He] 2s2 2p2`, shells `K 2, L 4`, and 4 valence electrons.
- [ ] Type `26` instead of `Fe` — an atomic number must work as well as a symbol.
- [ ] Type `fe` (lower case). It must be **refused** with a message about
  case-sensitivity, not silently resolved.
- [ ] **The absent list must be part of the summary**, naming melting point, density,
  crystal structure, Mohs hardness, spectral emission lines, oxidation states — each
  with a reason. This is the point of the release: those are absent because they need
  a cited source, not because the elements lack them.
- [ ] The summary must NOT show an element **name**. "Au" must read "Au — atomic
  number 79", never "Gold" — 118 names would be a data list typed from memory.
- [ ] **Bohr model diagram** for `Na`: three rings with 2, 8 and 1 electrons. Count
  the dots. A note must say the Bohr model is a 1913 teaching model, not current
  physics.
- [ ] **Orbital filling diagram** for `O`: the 2p row must show one paired box and two
  singly-occupied boxes — Hund's rule — not two pairs. That is the fact the picture
  carries which `2p4` does not.
- [ ] Orbital diagram for `Og` (118). It must show **every** subshell; the figure grows
  taller rather than cropping. Compare with `Au` — the oganesson figure must be taller.
- [ ] Every configuration shown must be labelled a **prediction**. Check `Cr`: it will
  show `[Ar] 4s2 3d4`, which is what the aufbau principle gives; the measured
  configuration differs and the tool says it does not carry it.
- [ ] **The periodic table** view: 118 cells, group numbers across the top, period
  numbers down the side, the f-block in two rows beneath. Typing an element highlights
  exactly one cell.
- [ ] A note must say the f-block sits outside the numbered groups because the group-3
  question is unsettled — the tool must not take a side.
- [ ] **Insert** each view. Diagrams go in as figures; the summary goes in as text with
  its notes. The figure's alt text must carry the prediction caveat.

---

## 0p. New in v2.51.0 — element names, and the data behind them

Chemical mode, **Periodic table &amp; atomic structure**.

- [ ] Type `Au`. The summary must now read **"Gold (Au) — atomic number 79"**. Names
  were absent in v2.50.0 and are now fetched from PubChem and cross-checked.
- [ ] Type **`Gold`** instead of `Au` — searching by name must work. So must `Iron`,
  `oganesson` (any case), and the atomic number `79`.
- [ ] `Cr` must show BOTH configurations: the measured `[Ar]3d5 4s1` and the aufbau
  prediction `[Ar] 4s2 3d4`, with a line saying they DIFFER because chromium is one of
  the exceptions. Check `Cu`, `Au`, `Pd` and `U` the same way.
- [ ] An ordinary element like `O` must show the two agreeing, with no "differ" line.
- [ ] `Ds` (110) must show its configuration marked **"the source marks this
  predicted, not observed"** — for the superheavy elements even PubChem has no
  measurement, and the hedge must survive.
- [ ] The summary must now also show **oxidation states, electronegativity, first
  ionisation energy, electron affinity, atomic radius and standard state** where the
  source has them.
- [ ] **The atomic weight must still be the IUPAC one.** `Li` must read **6.94
  (IUPAC)**, not PubChem's 7.0 — the two genuinely differ and the held value wins.
- [ ] The "NOT CARRIED" list must now be SHORTER: melting/boiling points, density,
  crystal structure, Mohs hardness and spectral emission lines. Names and oxidation
  states must have left it.

---

## 0q. New in v2.54.0 — optics, photonics and entanglement

Engineering mode. The dropdown must now show two new groups, **Optics & photonics**
(8 tools) and **Quantum optics** (4), and the mode must state **101 calculators**.

- [ ] **Photon relations.** `1064` as a wavelength in nm must give **1.16526 eV**,
  **281.76 THz** and **9398.5 cm⁻¹**. Switch the selector to eV and type `1.16526`:
  the wavelength must come back to 1064 nm. Every entry point must round-trip.
- [ ] **Gaussian beam.** Waist `1 mm`, `1064 nm`, M² 1: Rayleigh range **2.9526 m**.
  Set the distance equal to that Rayleigh range and the radius must be exactly
  **√2 × the waist** with the wavefront radius **twice** the Rayleigh range.
- [ ] Set **M² = 4**: the Rayleigh range must fall by 4× and the divergence rise by 4×.
  M² = 0.5 must be **refused**, not computed.
- [ ] The result must say w is a **1/e² radius** and the divergence a **half-angle**,
  and must print the full angle beside it. Fill in the "design backwards" field and
  check the waist it returns reproduces the divergence you asked for.
- [ ] **ABCD.** The default `space 0.15 / lens 0.1 / space 0.3` must report **B = 0**
  and say the planes are conjugate, with magnification **−2**.
- [ ] Type `space 0.01 1.5` — a third argument must be **REFUSED** with a message
  naming the three-element `flat / space / flat` stack instead. (Free space takes a
  physical distance; the index enters through the interfaces.)
- [ ] Build that stack — `flat 1 1.5 / space 0.01 / flat 1.5 1` — and B must be
  **6.667 mm** (t/n), not 4.44 mm.
- [ ] End a system in glass (last element `flat 1 1.5`). The trace must say it is
  **leaving a medium of n = 1.5** and must NOT overstate the output radius by √1.5.
- [ ] **Resonator.** L 0.5, both radii 1 m: stable, g₁ = g₂ = 0.5, waist at the
  centre, equal spots on the two mirrors. Set L = 1 with both radii 1 (confocal): it
  must report **MARGINALLY stable** and give **no mode size**. Same for two flat
  mirrors (`inf`). L = 2.5 with radii 1 must report **UNSTABLE** and no waist.
- [ ] **Pulses.** 1 mJ, 10 ns, 1 kHz, Gaussian: average **1 W**, peak **93.94 kW** —
  and the note must say this is **0.939 E/τ, not E/τ**. Switch to rectangular and the
  peak must become exactly **100 kW**.
- [ ] With a 100 µm beam radius the peak fluence must be **twice** energy-over-area,
  and the note must say damage thresholds are quoted against the peak.
- [ ] **Refraction.** n₁ 1.5 → n₂ 1.0: critical **41.81°**, Brewster **33.69°**,
  reflectance **4%**. At 60° incidence it must report **total internal reflection and
  no transmitted angle**. Reverse to 1.0 → 1.5 and it must say there is **no critical
  angle**, not print a number.
- [ ] **Diffraction.** 500 nm through a 10 mm aperture: Airy half-angle **61 µrad**,
  disc **61 µm** at f = 500 mm. A 600 line/mm grating must list orders **−3…+3** and
  no others; a 3000 line/mm grating at 633 nm must list **only order 0**.
- [ ] **Fibre.** 1.4570 / 1.4520, 4.1 µm radius, 1550 nm: NA **0.1206**, V **≈ 2.0**,
  **single mode**. Drop the wavelength to 400 nm and it must become multimode with a
  mode count. Set the core index equal to the cladding and it must be **refused**.
- [ ] **Entanglement.** The default (0.7071, 0, 0, 0.7071) is a Bell state:
  concurrence **1**, entropy **1 ebit**. Change all four to 0.5 → concurrence **0**
  and it must say **product state**. Now make the last one `-0.5` → concurrence back
  to **1**. Phase alone must flip the answer.
- [ ] **CHSH.** The defaults give **S = 2.828** and must report a **Bell violation**.
  Enter 1, −1, 1, 1 (S = 4): it must say this **exceeds Tsirelson's bound** and is an
  error rather than a stronger result. A correlation of 1.5 must be refused.
- [ ] **Werner.** p = 0.6 must say **entangled but cannot violate CHSH** — the gap is
  the point. p = 0.3 must say separable; p = 0.8 must violate.
- [ ] **BB84.** 2% must give **0.7176** bits per sifted bit; 11% must be at the
  threshold with the rate at zero; **95% must be refused**, not report a positive
  "secure" rate.
- [ ] Every one of the twelve must insert into the document and the inserted text must
  carry its unit note (or, for the quantum four, the "everything here is
  dimensionless" note).

---

## 0r. New in v2.55.0 — chips & semiconductors

Engineering mode. A new **Chips & semiconductors** group of 4, and the mode must now
state **101 calculators** across **eighteen disciplines**.

- [ ] **Power.** 500 pF, 0.9 V, 2 GHz, α = 0.1: dynamic power **81 mW**
  (0.1 × 500e-12 × 0.81 × 2e9). Energy per 0→1 transition must be **405 fJ**, and the
  note must say it is C·V² and **not ½C·V²**.
- [ ] Double the voltage and the power must **quadruple**; double the frequency or the
  activity and it must **double**.
- [ ] Leave leakage blank: the result must say leakage is **not predicted here**, not
  imply it is zero. Enter 5 mA and the static term must be 4.5 mW with its share shown.
- [ ] **Thermal.** 15 W, 25 °C, θ = 0.5 / 0.2 / 1.3 K/W: sink **44.5**, case **47.5**,
  junction **55 °C**, total **2.0 K/W**. Against a 125 °C limit the margin is **70 °C**
  and the power at the limit is **50 W** — feed that 50 W back and the junction must
  land exactly on 125.
- [ ] Raise power to 60 W: it must say **OVER THE LIMIT by 20 °C**. The parallel-path
  caveat (a datasheet θja already assumes a board) must always be present.
- [ ] Type the ambient as `298 K` instead of `25`: it must convert and report having
  done so, not read 298 as Celsius.
- [ ] **Delay.** Defaults: the wire's **Elmore** and **50%** figures must be different
  numbers (0.5·RC against 0.38·RC), with Elmore the larger and labelled an upper bound.
- [ ] Set driver 1 kΩ, wire R and C both 0, load 1 pF: the 50% delay must be exactly
  **ln2 × 1 ns ≈ 693 ps**.
- [ ] Double both the wire's R and its C (i.e. double its length): the wire delay must
  **quadruple**, not double.
- [ ] `150 fF` must be accepted as a capacitance. (It was not a unit until v2.55.0, and
  the tool silently inserted nothing.)
- [ ] **Timing.** Defaults (1 ns period, 100/700/50/80/40 ps): setup slack **120 ps**,
  hold slack **110 ps**, required period **880 ps**, both PASS.
- [ ] Set skew to **+50 ps**: setup slack must **improve** to 170 ps and hold slack must
  **worsen** to 60 ps. This is the sign convention that matters most — if hold improves
  with positive skew the check is inverted.
- [ ] Set skew to **+200 ps**: setup still passes, hold **FAILS**, and the note must say
  slowing the clock does **not** fix a hold violation.
- [ ] Drop the period to 500 ps: setup must FAIL and name the **880 ps** it needs.
- [ ] Enter a shortest path LONGER than the longest: it must be **refused**, not solved.
- [ ] **Clear the θ sink-to-ambient field entirely.** It must be REFUSED as required,
  not read as 0 K/W. (It was: clearing it took the junction from 55 °C to 35.5 °C and
  reported it as within limit — the missing rise was exactly the heatsink the user was
  unsure about.) Same for a cleared activity factor in the power tool.
- [ ] Type `0.5 K/W` into a θ field: the written unit must be accepted, because the
  tool's own note promises a unit may be written out.
- [ ] Set the ambient ABOVE the maximum junction temperature (150 °C against 125): the
  power at the limit must be **0 W**, never negative, and it must say the ambient alone
  already exceeds the limit.
- [ ] In the power tool set the frequency to 0 with a leakage current entered: energy per
  cycle must read **n/a**, not a dynamic-only figure — leakage accrues with time, not per
  cycle.
- [ ] In timing, set the skew to 1 ns (longer than the whole path): the required period
  must read **0**, never a negative time, and hold must fail.
- [ ] All four must insert, and each must carry the converting unit note.

---

## 0s. New in v2.56.0 — aviation & avionics

Engineering mode. A new **Aviation & avionics** group of 5; the mode must now state
**101 calculators** across **eighteen disciplines**.

- [ ] **Atmosphere at 0 m**: 288.15 K, 101325 Pa, 1.225 kg/m³, 340.3 m/s, σ = 1. These
  are the defining constants and must come back exactly.
- [ ] **At 11 km** (the tropopause): 216.65 K and ≈ 22632 Pa. Check 12 km and 18 km
  report the SAME temperature — that layer is isothermal — and that 30 km is *warmer*
  than 21 km, because the next layer has a positive lapse rate.
- [ ] Set ISA deviation to **+15**: temperature and density must move, pressure must
  **not**. That is the hot-and-high effect and getting it backwards would be invisible.
- [ ] Enter **90000** m: it must be **refused** as outside the model, not extrapolated.
- [ ] The result must state the geometric→geopotential conversion at high altitude.
- [ ] **Airspeeds at sea level**, 100 m/s: TAS, EAS and CAS must all read 100.
- [ ] **At 10 km**, 250 kt TAS: TAS > CAS > EAS. If CAS and EAS are equal, the
  compressibility term has been lost.
- [ ] Push the speed until Mach exceeds 1: it must say the subsonic relation is **out
  of range**, not print a confident CAS.
- [ ] Every airspeed result must say **IAS is not computed** and why.
- [ ] **Polar** at the defaults: note the best L/D and the speed for it, then enter that
  speed — the achieved L/D must equal the best L/D. No other speed may beat it.
- [ ] Fly below the stall speed: it must say CL **exceeds CLmax** and that the drag
  figure is not meaningful.
- [ ] **Turn at 60°**: load factor exactly **2**, and the stall speed in the turn up by
  **41%** (×√2), not doubled. At **0°** the radius must be *infinite* and the rate zero,
  not a division by zero. At **90°** it must be refused.
- [ ] Check rate × radius = speed at any bank angle — that is the definition of a circle
  and a good check that neither is inverted.
- [ ] **Climb** with T = 20 kN, D = 10 kN, W = 100 kN, V = 80 m/s: ROC exactly **8 m/s**
  and the angle **5.739°** (the exact arcsine, not 5.730°).
- [ ] Set thrust to **0** with drag = W/15: it must report a descent with a glide ratio
  near 15, and with a height entered, a still-air range of 15 × that height.
- [ ] Make drag exceed the weight: **refused**, because there is no real flight-path angle.
- [ ] Type an airspeed as `250 kt` and an altitude as `35000 ft`: both must be accepted
  and the conversion reported. (Knots, nmi, fpm, mbar and inHg were not units before
  v2.56.0.)
- [ ] All five must insert, each carrying the converting unit note.

---

## 0t. New in v2.57.0 — robotics & kinematics

Engineering mode. A new **Robotics & kinematics** group of 6; the mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Forward kinematics** with links `0.5, 0.4, 0.2` at `30, 45, -20`: note the tip
  position, then confirm the tip orientation is the **sum** of the angles (55°) — that is
  what makes the angles relative rather than absolute.
- [ ] Links `1, 1` at `0, 0`: tip at exactly (2, 0). At `0, 180`: tip at (0, 0).
- [ ] Mismatched counts (3 links, 2 angles) must be **refused** with both counts named.
- [ ] **Inverse kinematics**, L1 0.5, L2 0.4, target (0.6, 0.3): **two** solutions, one with
  θ₂ positive and one negative. Feed each pair back into the forward-kinematics tool — both
  must land on (0.6, 0.3). That round trip is the real test.
- [ ] Target (2, 0) with those links: **NO SOLUTION**, outside by 1.1 m, and it must say so
  rather than returning the nearest reachable pose.
- [ ] Target (0.05, 0): inside the **inner hole** of the annulus — also unreachable, and the
  note must say an arm with unequal links cannot reach near its own base.
- [ ] Target (0.9, 0) — exactly L1+L2: **one** solution, branch `coincident`, and a
  **SINGULAR** warning. Same at (0.1, 0), full fold.
- [ ] **Jacobian** at θ₂ = 60°: non-singular. Set θ₂ = 0: det J must be 0, manipulability 0,
  condition number **infinite**, and it must say rank 1. Set θ₂ = 180°: singular again.
- [ ] Change θ₁ with θ₂ fixed: det J must **not** change — it depends only on the elbow.
- [ ] With L1 = L2 = 1, θ₁ = 0, θ₂ = 90°, tip force (10, 0): torques must be **−10 and −10**.
  With force (0, 10): **10 and 0**. That is Jᵀ F, not J F.
- [ ] Fully extended (θ₂ = 0) with a transverse load: the shoulder torque must be
  (L1+L2)·F and the elbow L2·F.
- [ ] **DH** with the default 3-row table: the rotation matrix rows must each have length 1
  and be mutually perpendicular. A 2-row planar table (alpha 0) must agree with the
  forward-kinematics tool.
- [ ] DH rows `0 0 0 90` then `90 0 0 0`: **gimbal lock** must be reported and **no**
  roll/pitch/yaw printed — only the matrix.
- [ ] A row with three numbers instead of four must be **refused**, naming the row.
- [ ] **Profile** d 1.5, v 2, a 5: trapezoidal, and 2×accel-distance + cruise must equal 1.5.
- [ ] d 0.1 with the same limits: **TRIANGULAR**, cruise time exactly 0, peak speed below 2
  and equal to √(a·d). The note must say computing it as d/vmax + vmax/a would promise a
  move the machine cannot make.
- [ ] **Differential drive**, left 0.8 right 1.2 track 0.4: body 1.0 m/s, yaw **1.0 rad/s**
  (2.0 would mean the half-track was used), radius 1.0 m.
- [ ] Equal wheels: turn radius **infinite**, not zero. Equal and opposite: radius exactly 0.
- [ ] Switch to “body velocity → wheel speeds”, enter the body numbers you just got, and the
  wheel speeds must come back to 0.8 and 1.2 exactly.
- [ ] **The singular note must agree with the number beside it.** L1 0.7, L2 0.45, target
  (1.15, 0): the solution row reads θ₂ ≈ 0 and the note must say **fully extended
  (theta2 = 0°)** — it used to say 180° for more than half of all extended link pairs.
  Target (0.25, 0) must say **fully folded (theta2 = 180°)**.
- [ ] Enter link lengths **space separated** (`0.5 0.4 0.2`) in forward kinematics: it must
  work, not report that the values are not numbers.
- [ ] In the Jacobian tool enter the links in **mm** (`500`, `400` with unit `mm`): the
  conversion must be reported and the torque must still be a true **N·m**, not N·mm
  mislabelled. In differential drive, entering `1.2 m/s` in a wheel field must be accepted.

### Reported from the pane and fixed in this release

- [ ] **Spectra → aspirin → MS fragmentation (EI).** The formula column must show real
  formulas throughout — **C9H6O3** for the water loss and **C8H8O2** for the CO₂ loss —
  not the bracket placeholders `[M-H2O]` and `[M-CO2]` it used to print while every other
  row held a proper formula. Everything must be plain ASCII, so it survives a plain-text
  insert into Word.
- [ ] **Stats → Linear regression.** There must now be a **figure** (fit, residuals and a
  normal Q-Q), where before there was none at all — and an **Insert chart** button beside
  Insert result. Insert both and confirm the picture lands in the document.
- [ ] The chart button must be **disabled** for a calculator with no figure (descriptive
  statistics) and enabled for multiple regression, polynomial regression and survival.

- [ ] All six must insert; the four kinematics tools carry the same-unit note and the two
  with real dimensions carry the converting note.

---

## 0u. New in v2.58.0 — computation & information

Engineering mode. A new **Computation & information** group of 6, completing the four
domains. The mode must state **101 calculators** across **eighteen disciplines**.

- [ ] **Speedup**, p = 0.95 on 16 processors: Amdahl **9.14x**, Gustafson **15.25x**,
  ceiling **20x**. Both must be shown — reporting one alone answers half the question.
- [ ] Set p = 0.5 with 100 processors: it must say the ceiling (2x) is **BELOW** the
  processor count, i.e. more cores cannot help at all past that point.
- [ ] Set p = 1: the ceiling must read **none (perfectly parallel)**, not a number.
- [ ] Enter a measured speedup equal to the Amdahl figure: Karp-Flatt must return exactly
  the serial fraction **0.05**.
- [ ] **Entropy** of `0.5, 0.25, 0.125, 0.125`: exactly **1.75 bits**. A fair coin
  (`0.5, 0.5`) is **1**; a fair die (six equal counts) is **log₂6 = 2.585**.
- [ ] Include a zero: `0.5, 0.5, 0, 0` must still give 1 bit, **not NaN**, and must say the
  zero contributed nothing.
- [ ] Enter counts (`30, 30`) rather than probabilities: it must normalise and **say so**.
- [ ] **Channel**, 20 MHz at 25 dB: SNR linear **316.2**, and the capacity must equal
  B·log₂(1+SNR). Change 20 dB → the linear ratio must be **100**, not 10 — 10 would mean
  the amplitude form had been used.
- [ ] Set SNR to a negative dB: capacity must stay **positive** and say so (below-noise
  communication is how spread spectrum works).
- [ ] BSC at p = 0.5: capacity exactly **0**. At p = 0.9 it must equal p = 0.1 by symmetry.
- [ ] **Collisions**: 23 items in 365 values → **0.5073**, the classic birthday answer.
  57 items → about **0.99**.
- [ ] 40 items in 365: expected pairs **2.14** while the probability is **0.891** — the two
  must be clearly separate, since the expectation exceeding 1 is exactly the trap.
- [ ] 400 items in 365 values: probability exactly **1**, with the pigeonhole reason given.
- [ ] A 64-bit hash: the 50% count must be about **5.1 × 10⁹**.
- [ ] **Floating point** at 1: epsilon **2.22e-16**, decimal digits **15.95**. At 10⁶ the
  ULP must be about **1.16e-10** — a million times larger, which is the whole point.
- [ ] Subtract 1 from 1.0000001: about **7 digits lost**, and the note must say the
  subtraction itself is exact and the error was already in the inputs.
- [ ] **Scaling** from (1000, 0.12) to (4000, 1.95): exponent ≈ **2.0**, nearest class
  quadratic. Predicting at 10⁶ must warn this is **extrapolation**, not interpolation.
- [ ] Enter a larger size with a SMALLER runtime: the exponent goes negative and it must
  call that **noise**, not a complexity class.
- [ ] Equal input sizes must be **refused** — no leverage on the exponent.
- [ ] All six must insert.

### Units added with this release

- [ ] `1 kB` → 1000 B and `1 KiB` → 1024 B: the decimal/binary split must be kept.
- [ ] `1 TB` → GiB must be about **931** — the missing-disk-space number.
- [ ] **`KB` must mean kilobyte**, never kilobit. `kb`, `Mb` and `b` must be REFUSED
  rather than guessed at, because a lowercase fallback would make a typed `KB` an 8x error.
- [ ] `1 MB/s` → `Mbit/s` must be **8**. `B` → `m` must be refused.

---

## 0v. New in v2.60.0 — energy & power

Engineering mode. A new **Energy & power** group of 8. The mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Wind** at the defaults (90 m rotor, 8 m/s, Cp 0.45): swept area **6362 m²**,
  power in the wind **1995 kW**, Betz bound **1182 kW**, output **897.8 kW**. The
  Betz bound must be exactly 16/27 of the wind power.
- [ ] Set Cp = 0.7: **refused**, naming the Betz limit — not computed, not clamped.
- [ ] Set rpm = 15: tip-speed ratio **8.836** appears.
- [ ] **Solar** at the defaults (1000 W/m², 20 m², 0.21, −0.35 %/°C, 30 °C ambient,
  NOCT 45): output at 25 °C cells **4.2 kW**, cell temperature **61.25 °C**,
  derated output **3.667 kW**, thermal derating **12.69 %**.
- [ ] Efficiency entered as **21** (the percentage): refused, telling you to write 0.21.
- [ ] **Fill factor** at the defaults: Pmp **329.1 W**, FF **0.7966**. Swap Vmp and Voc:
  refused, saying they are probably swapped.
- [ ] **Hydro** at the defaults (2 m³/s, 25 m, 0.85): output **416.8 kW**. Type the flow
  as `500 gal/min`: the conversion must be REPORTED in a "Units read" block and the
  output becomes **6.574 kW**.
- [ ] Head loss = 25 (the whole gross head): refused — the penstock consumed the head.
- [ ] **Battery** at the defaults (3.6 V / 5 Ah cells, 13S4P, DoD 0.9, 10 A load):
  **46.8 V**, **20 Ah**, **0.936 kWh** (usable **0.8424**), C-rate **0.5C**, runtime
  **1.8 h**. Type the capacity as `5000 mAh`: identical results, conversion reported.
- [ ] Peukert exponent 1.1: corrected runtime **1.416 h** shown BESIDE the 1.8 h figure,
  with the 20-hour-rating caveat.
- [ ] **Combustion** of CH4: molar mass **16.043 g/mol**, O₂ **2 mol/mol**, AFR
  **17.12**, CO₂ **2.743 kg/kg**, H₂O **2.246 kg/kg**. Add HHV 55.5 MJ/kg: LHV
  **50.02 MJ/kg** — the published methane figure — and CO₂ intensity **0.1779 kg/kWh**.
- [ ] C8H18: AFR **15.03** (the gasoline number), CO₂ **3.083 kg/kg**. CO2 as the
  formula: refused — it has nothing left to oxidise.
- [ ] **Formatting (v2.61.0):** the combustion title typesets your formula — typing
  `C8H18` must display **C₈H₁₈** — and every species line reads **O₂ / CO₂ / H₂O /
  SO₂** with real subscripts, in the pane AND in the inserted text. Paste the
  displayed **C₈H₁₈** back into the field: same answer, not a refusal. Unit labels
  read **m², m³/s, W/m², kg/m³** with real superscripts, and typing `m³/s` as a
  unit converts the same as `m^3/s`.
- [ ] **LCOE** at the defaults (1.5 M capex, 30 k opex, 3500 MWh, 7%, 25 yr):
  **45.35 per MWh** (0.04535 per kWh), PV of costs **1,849,609**, PV of energy
  **40,788 MWh**. The notes must say the energy is discounted and why.
- [ ] **Capacity factor** at the defaults (2 MW, 6100 MWh): **0.3482 = 34.82 %**,
  full-load hours **3050**. Enter 20,000 MWh: refused, showing the 17,520 MWh maximum.
- [ ] All eight must insert.

### Units added with this release

- [ ] `1 kWh` → MJ must be **3.6**; `1 therm` → BTU must be exactly **100000**.
- [ ] `1000 mAh` → Ah must be **1**, and `1 Ah` → C must be **3600**.
- [ ] **`mWh` must be REFUSED** rather than read as megawatt-hours — a lowercase
  fallback would turn a coin-cell energy into a 10⁹ error. `MWh` cased correctly works.
- [ ] `1 gal` → L must be **3.785**, and a flow typed as `gal/min` converts.

---

## 0w. New in v2.62.0 — energy depth & grid power

Engineering mode. **Energy & power** grows 8 → 16; the mode must state
**101 calculators** across **eighteen disciplines**.

- [ ] **Three-phase** at the defaults (400 V, 100 A, pf 0.8): S **69.28 kVA**,
  P **55.43 kW**, Q **41.57 kVAR**, wye phase voltage **230.9 V**. Enter the power
  instead of the current: the current comes back as **100 A**.
- [ ] **PF correction** at the defaults (100 kW, 0.7 → 0.95, 400 V, 50 Hz): bank
  **69.15 kVAR**, current 206.2 → **151.9 A**, loss reduction **45.7 %**, delta
  capacitance **458.6 µF** per phase (wye exactly 3× that). Target below present:
  refused with the reason.
- [ ] **Cable drop** at the defaults (Cu, DC, 20 m, 16 A, 2.5 mm², 230 V, 3% target):
  drop **4.414 V = 1.919 %**, loss **70.6 W**. The computed drop is UNDER the 3%
  target, so the minimum section reads **1.60 mm²** — smaller than the entered 2.5,
  which is the consistent answer, not a bug. Switch to AWG 12 (blank the mm²):
  section **3.309 mm²**.
- [ ] **Wind shear** at the defaults (6 m/s, 10 → 80 m, α 0.143, z₀ 0.03): power law
  **8.078 m/s**, log law **8.148 m/s**, disagreement under **1 %**, power ratio
  **2.44×**. Both models shown, neither chosen.
- [ ] **Weibull** at the defaults (k 2, c 8, turbine 3/12/25): mean **7.09 m/s**,
  energy pattern factor **1.91**, capacity factor **0.30**, hours in band **86.9 %**
  — and CF must be BELOW the hours-in-band figure.
- [ ] **Flue gas** at the defaults (CH4, 3% dry O₂): excess air **14.9 %**, dry CO₂
  **10.06 %** with ultimate **11.74 %**, and the dry percentages sum to 100.
  Enter 21%: refused — the probe is reading air.
- [ ] **Storage** at the defaults (10 kWh/day, 2 days, DoD 0.8, rt 0.9, inv 0.95,
  48 V, no capex): bank **27.74 kWh / 577.9 Ah**, daily charge **11.70 kWh**. Add
  capex 10000: LCOS appears, and its note says charging energy is EXCLUDED.
- [ ] **Sun position** at the defaults (40°, day 172): declination **23.45°**, day
  length **14.85 h**, noon elevation **73.4°**, H₀ **11.59 kWh/m²** (ceiling, before
  the atmosphere). Latitude 78, day 355: day length **0 h** as an answer, not an error.
- [ ] **Wind + altitude**: blank the density, set altitude 2000 m → the result notes
  density **1.0065 kg/m³ from the ISA** — the same atmosphere the aviation tools use.
- [ ] All eight new tools insert, subscripts and superscripts intact (O₂, m², kVAR).

---

## 0ax. New in v2.89.0 - EVERY calculator draws (130 of 130)

The final 24 tools insert figures; the ratchet closes at 130 of 130.
Spot-check the geometric ones — equal aspect is the thing to eyeball:

- [ ] **Circular orbit**, defaults (Earth, 400 km) → a grey disc with a thin
  blue ring hugging it — the ring must be a CIRCLE, and barely off the
  surface (that closeness is the point).
- [ ] **Hohmann transfer**, defaults (300 → 35 786 km) → two dashed circles,
  a blue half-ellipse tangent to both, "burn 1" on the INNER circle and
  "burn 2" on the outer. Swap the altitudes (35786 → 300) → burn 1 moves to
  the OUTER circle, because that is now the departure orbit.
- [ ] **Wind triangle**, defaults → three arrows closing exactly: blue air
  vector, red wind vector, green ground vector; drift 11.3° noted below.
- [ ] **Differential drive**, defaults (left 0.8, right 1.2) → three
  concentric circles about a red cross to the LEFT of the robot (faster
  right wheel = left turn), the faster wheel on the OUTER dashed circle.
  Swap the wheel speeds → the whole construction mirrors to the right.
- [ ] **2R inverse kinematics**, defaults → two arms (solid and dashed) from
  the base to the same target cross inside the annulus. Set the target to
  (2, 0) → NO arm, just the annulus and the stranded cross, captioned with
  the miss distance.
- [ ] **DH forward kinematics**, defaults → TWO figures, plan and elevation;
  the first link leaves the plane so it is short in plan and tall in
  elevation — and the second link must be the SAME drawn length in both
  views (shared scale).
- [ ] **Signal sampling** (Biomedical), defaults (500 Hz, 550 Hz tone) → the
  fold diagram with the orange interference dot at (550, 50): folded to
  50 Hz, dead inside an ECG's band. Set fs **150** → the red "signal max
  FOLDS" dot shows the signal's own top aliasing — the unfixable case.

## 0aw. New in v2.88.0 - Computation, chips, optics and quantum draw

Twenty-two more tools insert figures (ratchet 84 → 106 of 130). Spot-check:

- [ ] **Junction temperature**, defaults → "The thermal ladder": four blue
  bars stacking 25 → 44.5 → 47.5 → 55 °C, green junction bar, dashed red
  line at 125 °C far right, "within limit".
- [ ] **Setup/hold timing**, defaults → "The setup budget": period bar 1000
  ps, three red take-away bars, green "setup slack 120" bar ending right of
  the dashed slack = 0 line, "PASS".
- [ ] **Parallel speedup**, defaults → "The two laws diverge": Amdahl bending
  toward the grey ceiling at 20×, Gustafson climbing straight on log
  processors, red dot at 16.
- [ ] **Hash collision**, defaults (1e6 items, 64 bits) → "The birthday
  curve" on a LOG item axis: S-curve crossing the 0.5 line at ~5×10⁹, red
  dot far left at 10⁶ — visibly nowhere near a collision.
- [ ] **Laser cavity stability**, defaults (g₁ = g₂ = 0.5) → "The stability
  diagram": both hyperbola branches, axes, green dot inside the first
  quadrant's stable region. Set L **3** (g = −2) → red dot outside, labelled
  unstable.
- [ ] **CHSH Bell test**, defaults → "S against both bounds": red S stem
  reaching exactly the green Tsirelson line at 2.83, four blue contribution
  stems at 0.7071 each, orange classical lines at ±2.
- [ ] **BB84 key rate**, defaults (2%) → "The Shor-Preskill bound": rate
  curve falling from 1 to the flat zero tail, grey threshold stem at 11%,
  red dot at (2, 0.717).

## 0av. New in v2.87.0 - Audio and video draw

All 14 Audio & acoustics and Video & display tools insert figures (ratchet
70 → 84 of 130). Spot-check four:

- [ ] **Sampling & aliasing**, defaults (44.1 kHz, 20 kHz) → "The fold
  diagram": a sawtooth rising to 22 050 Hz and folding back down, twice
  more across the axis; green dot at (20k, 20k), red dot at the first peak.
- [ ] **Delay & comb filtering**, defaults (1 ms) → "The comb": a scalloped
  response on a log frequency axis, red dots on the −30 dB floor at 500,
  1500, 2500… Hz, green dots at +6 dB at 1000, 2000… Hz.
- [ ] **Colour gamut coverage**, defaults (DCI-P3 vs sRGB) → two triangles
  on u′v′ axes, the dashed sRGB triangle entirely INSIDE the solid blue
  P3 one; title says 100.0% coverage. Swap to sRGB vs BT.2020 → the solid
  triangle now sits inside the dashed one.
- [ ] **End-to-end latency budget**, defaults → bars for the four stages
  with network (30 ms) in red, then grey "sum 63 ms" and green "delivered
  66.67 ms" — the delivered bar longer than the sum, because the display
  quantises to the next refresh.

## 0au. New in v2.86.0 - All seventeen Energy tools draw

The whole Energy & power discipline inserts figures (ratchet 53 → 70 of 130).
Spot-check five; the rest follow the same pattern (figure + data, legend
outside the frame, working point marked in red).

- [ ] **Wind turbine power**, defaults → "Power goes as the cube of wind
  speed": three rising curves (grey wind, blue Betz, green Cp = 0.45) with
  the red point ON the green curve at 8 m/s.
- [ ] **Three-phase power**, defaults (400 V, 100 A, pf 0.8) → "The power
  triangle": blue base P = 55.4 kW, red vertical Q = 41.6 kVAR, green
  hypotenuse S = 69.3 kVA, arc φ = 36.9°. Set pf **1** → the triangle
  collapses to one line and SAYS so.
- [ ] **Power factor correction**, defaults → "The cost of chasing unity":
  rising curve with the knee steepening toward pf 1.0, red point at 0.95.
- [ ] **Weibull wind resource**, defaults → the density curve with three grey
  vertical lines (cut-in 3, rated 12, cut-out 25) and red mean/mode dots
  near the peak.
- [ ] **Sun position**, defaults (40°, day 172) → the elevation arc peaking
  at 73.4° at noon, blue sunrise/sunset dots where it crosses the grey
  horizon line, night below.

## 0at. New in v2.85.0 - Control, vibration and electronics draw

Eight more tools insert a figure (ratchet 45 → 53 of 130).

- [ ] **Poles, zeros & stability**, defaults (1 / s³+3s²+2s+1) → "Pole-zero
  map": three × marks LEFT of the vertical axis, pink shading to its right
  labelled "unstable", conjugate pair mirrored exactly about the horizontal
  axis. Change the denominator to `s^2-s+1` → two × in the shading, red.
- [ ] **PID & closed loop**, defaults (plant 1/(s³+3s²+2s), Kp 1) →
  "Closed-loop step response": rises and settles near 1.
- [ ] **Natural frequencies & mode shapes**, defaults (2-mass chain) → "Mode
  shapes": two curves from the anchor at DOF 0, mode 1 both masses same
  sign, mode 2 opposite signs.
- [ ] **Forced response**, defaults (ω 8) → "Frequency response, DOF …": two
  sharp peaks (the resonances) on a log amplitude axis, red point at ω = 8
  between them.
- [ ] **Op-amp circuits**, defaults (non-inverting, GBW 1 MHz) → "Gain
  against frequency": flat blue line at 40 dB meeting the grey open-loop
  roll-off, red −3 dB point at the corner (10 kHz). Switch to Integrator →
  a single falling line crossing 0 dB at the corner frequency.
- [ ] **Analogue filter design**, defaults (Butterworth low-pass) → response
  curve with the green passband point ON the curve at ω 1000 and the red
  stopband point at or ABOVE the curve at ω 4000.
- [ ] **CHEBYSHEV REGRESSION (v2.85.0).** Family Chebyshev, type High-pass,
  ωp **4000**, ωs **1000**, ripple 1, attenuation 40 → the passband-edge
  marker sits ON the curve at −1 dB (previously the curve was 79 dB below
  it: an odd-order filter was built one degree too high), and the delivered
  stopband attenuation reads ~42 dB, not ~120.
- [ ] **DC operating point**, defaults (5 V divider) → "Power per element":
  V1 bar LEFT of the zero line (green, delivering), R1 and R2 bars right
  (blue), R2's bar twice R1's length, labels in mW-range numbers.
- [ ] **Truth table & minimisation**, defaults (4 variables) → "Truth table
  as waveforms": lanes A-D counting in binary, `out` lane at the bottom
  high exactly at the listed minterms.

## 0as. New in v2.84.0 - Thermo and aero draw

Five more Engineering tools insert a figure (ratchet 40 → 45 of 130).

- [ ] **Ideal-gas process**, defaults (isentropic, air, 1 bar → 10 bar) →
  "isentropic process on the P-v plane": a steep curve from the green
  `state 1` (0.86 m³, 100 kPa) up-left to the red `state 2` (0.17 m³,
  1000 kPa). Switch to Isothermal with the same fields → a shallower
  hyperbola. Isochoric with end T 327 → a vertical segment.
- [ ] **Power cycles**, defaults (Otto, r 8, 27/1527 °C) → "Otto cycle on the
  P-v plane": a closed four-leg loop on a LOG pressure axis, red markers at
  the four corner states, top-left corner at pressure ratio ~48. Switch to
  Diesel → the top of the loop is a horizontal (isobaric) leg. Brayton → the
  loop's top AND bottom are horizontal.
- [ ] **Standard atmosphere**, defaults (10 000 m) → "Standard atmosphere
  profile": red T/T₀ with a visible kink at 11 km, blue p/p₀ and green ρ/ρ₀
  falling smoothly, black `this altitude` marker on the green curve at 10 km
  (ρ/ρ₀ ≈ 0.34).
- [ ] **Lift, drag polar & stall speed**, defaults → "Drag polar": blue
  polar, grey ray from the origin touching it at the green `best L/D` point
  (CL 0.67), red `this flight` point lower on the curve (CL 0.43).
- [ ] **Level turn**, defaults (45°, 120 kt) → "Turn radius against bank":
  falling curve on a log radius axis, red `this bank` point at 45° / ~389 m.
- [ ] Every legend in the five figures sits OUTSIDE its plot frame, covering
  no data.

## 0ar. New in v2.83.0 - Fluids, thermal and fatigue draw

Six formerly text-only Engineering tools now insert a figure with their data
(ratchet 34 → 40 of 130). Every legend sits OUTSIDE its plot frame (v2.82.1).

- [ ] **Endurance limit & notch factor**, defaults (Sut 700, machined, 25 mm,
  bending, 0.99) → inserts the text AND an "Estimated S-N curve" figure with
  TWO lines: grey `uncorrected Se'` above blue `corrected Se`, both starting
  at the same point at 10³ cycles, the blue one flattening at 10⁶. Switch the
  material class to non-ferrous → NEITHER line flattens; both keep falling to
  the right edge.
- [ ] **Finite life & cumulative damage**, defaults (three blocks) → "Load
  blocks against the S-N line": blue S-N line, three red points BELOW or ON
  it — the 280 MPa block sits essentially ON the line (and carries the
  biggest damage share in the table), the 420 one well under it.
- [ ] **Pipe flow & head loss**, defaults → "System head curve": a rising,
  steepening blue curve with the red `this flow` point ON the curve (15.7 L/s,
  ~3.8 m).
- [ ] **Composite wall / pipe insulation**, defaults → "Temperature through
  the wall": a falling profile from 20 °C to −5 °C with a vertical drop at
  x = 0 (inside film), a shallow slope across the brick, a steep one across
  the mineral wool, and a final vertical drop at the outer face.
- [ ] **Open-channel flow**, defaults → "Specific energy diagram": a C-shaped
  blue curve, grey `E = y` line, red `this flow` point on the UPPER
  (subcritical) arm above the green `critical depth` point.
- [ ] **Pump NPSH & cavitation**, defaults (typed losses) → "Where the suction
  head goes": five horizontal bars — surface pressure and static head building
  right, vapour pressure and suction losses cutting back, the green NPSH
  available bar, the dashed red NPSH-required line left of its end, and
  "clears NPSHr" in the corner.
- [ ] Same tool, losses from **Pipe geometry** → a SECOND figure, "NPSH
  available against flow": blue curve falling with flow, flat red requirement
  line, green working point between them.
- [ ] Same tool, static head **-8** (pump above the liquid), vapour pressure
  **101000** (near-boiling water) → refused or CAVITATES verdict; if a figure
  inserts, its NPSH-available bar is RED and the corner says "CAVITATES", and
  no label runs off the right edge of the image.

## 0aq. New in v2.82.0 - Reliability

Engineering: a **twentieth discipline**, **Reliability (5)**, and the mode states
**130**. All five insert a figure.

### Life data: Weibull fit
These are the strings the pane prints, not rounded versions of them. A mismatch
in the last digit is a real failure, not a tolerance.

- [ ] Defaults (8 failures, 4 units still running at 2000 h) → beta **1.64**, eta
  **1750.7 h**, B10 **443.84 h**, median **1400.1 h**, mean life **1566.3 h**,
  hazard **constant hazard**, interval on beta **0.8268 to 2.786**, failures
  **8 of 12**. The figure is a probability plot: points close to a straight line,
  with the fitted line through them.
- [ ] The "Report reliability at this age" default of 1000 h → **67.09 %**.
- [ ] That interval straddles 1, so it must NOT claim wear-out. A beta of 1.64
  from eight failures is not evidence of anything — that is the point of the
  interval.
- [ ] The output states **4 of the 12 units had not failed** and that they are in
  the likelihood rather than discarded.
- [ ] Change every `+` to `F` (pretend the survivors failed at 2000 h) → **eta
  falls from 1750.7 h to 1454.4 h**. That is the bias the suspensions exist to
  prevent.
- [ ] Type just two lines, `100 F` and `250 F` → it still fits, and reports the
  regime as **constant hazard** with an interval running from about **0.57 to
  7.07**. A fitted beta of 2.6 from two units is NOT wear-out, and it must not say
  it is.
- [ ] Type `900 maybe` on a line → refused, naming `"maybe"`, and the message
  offers 1/F, 0/+ and a duration unit.
- [ ] **The two ambiguous letters must be refused, not guessed.** `412 s` → refused,
  naming *seconds, or "suspended"*. `412 d` → refused, naming *days, or "dead"*.
  Reading either one silently is a factor of 3600 or 24.
- [ ] Units on the time DO convert here: `3 day` and `3day` are both **72 h**,
  `412 sec` is **0.1144 h**, `412 h` is 412. Write `sec` and `day` in full.
- [ ] `0x10 F` → refused. It is not a life in hours, whatever `Number()` thinks.
- [ ] Delete every `F` so nothing has failed → **"Nothing has failed yet"**.
- [ ] Leave one failure and censor the rest → **"One failure cannot fix both a
  shape and a scale."**
- [ ] Set all four times to the same number → refused, naming the shape parameter
  running to infinity.

### Series and parallel systems
- [ ] Defaults, **series**, 8760 h → **10 units**, reliability **1.0698 %**,
  chance of failure **0.9893**, system rate **5.180e-4 per hour**, MTTF
  **1930.5 h**. The **"Where the failures come from"** block reads **Pump 46.3 %,
  Control valve 29.0 %, Sensor 23.2 %, Controller 1.5 %**. Figure: system curve
  BELOW the **worst** single unit.
- [ ] Switch to **parallel** → reliability **99.9996 %**, chance of failure
  **3.645e-6**, MTTF **146190 h**. No system failure rate is quoted, because a
  parallel system has no constant one. The **common-cause** note is present.
- [ ] The parallel figure compares against the **best** single unit, not the
  worst — the claim is that the system outlives *every* part, and only the best
  part tests that. The legend and caption must both say "best single unit".
- [ ] Set a quantity to `2.5` → refused, naming the whole quantity.
- [ ] Write a line as `Pump 1.2e-4 2` with no commas → still read.
- [ ] `Bearing 6205 1.5e-5` (a part number in the name, no commas) → read as one
  bearing at 1.5e-5/h. It must NOT complain that 1.5e-5 is not a quantity.
- [ ] `Motor, 1,200, 2` → refused, naming the **four** comma fields and the
  thousands separator. Silently reading it as 200 failures an hour is the defect
  this refusal exists for.
- [ ] Set one component's rate to `0` and add enough others to exceed 12 units →
  the note must say **a branch never fails**, not that an alternating sum lost
  accuracy.
- [ ] Enter thirteen components at differing rates, parallel → the mean time to
  failure is **not reported**, and it says why. Reliability is still shown.

### k-out-of-n
- [ ] Defaults 2 of 3 → one unit **64.5326 %** (derived from the rate and the
  mission, and it says so), system **71.1850 %**, chance of failure **0.2881**,
  mean life factor **0.8333**, MTTF **16667 h**. Figure: a curve above the
  diagonal with the operating point marked in red.
- [ ] Set k = 3 (all of them) → **26.8743 %**, which is BELOW one unit's
  64.5326 %, and the note calls it **a SERIES system wearing redundant
  clothing**.
- [ ] Type a unit reliability of `0.9` while leaving the rate at 5e-5 → a note
  says **THE TWO FIELDS DISAGREE** and names both numbers. Two inconsistent
  inputs must not produce two confident numbers in silence.
- [ ] Set k = 5, n = 3 → refused: **you cannot need more units than you have**.
- [ ] Set n = 500, k = 250, unit reliability 0.6 → a real number, not `NaN`.

### Active or standby spares
- [ ] Defaults → single **60.6531 %**, active **93.9084 %**, standby **98.5612 %**;
  mean lives **10000 / 18333 / 30000 h**. The figure shows a straight standby
  line against a flattening active curve.
- [ ] Set the rate to `1e-7`, n to `10`, the mission to `10000 h` → the
  short-mission note compares FAILURE probabilities and they are **9.95e-31
  active** and **2.75e-37 standby**, not `0`. Two zeroes in the sentence that
  says "that is where the difference lives" is the failure.
- [ ] Set n to `200` → the figure's x axis reaches **200**, so the arrangement
  asked about is on the figure the caption describes.
- [ ] The notes state BOTH assumptions — the spare **does not age**, the switch
  **never fails** — and that a switch with its own rate can make standby worse.
- [ ] Set n = 1 → all three agree, and it says there is no spare.
- [ ] Set the rate to 0 → nothing overflows; it says nothing ever fails.

### Availability
- [ ] Defaults (MTBF 2000 h, MTTR 8 h, 8760 h) → **99.6016 %**, unavailability
  **0.003984**, up **8725.1 h**, down **34.9 h**, **4.363 failures expected**.
  The note says **INHERENT** and names what is not counted.
- [ ] Enter 5 in series → **98.0238 %** and **173.12 h down**, against 34.9 for
  one.
- [ ] Set MTTR to `0` → availability exactly 100 %, and the note says **by
  construction**.
- [ ] Set MTBF to `0` → refused.

### Units, on every tool in this discipline
- [ ] Enter a mission time of `3 day` → read as **72 h**, and the "Units read"
  block says so.
- [ ] Enter `5 yr` → **refused by name**. A year is 8760 h, 8766 h or 2000
  operating hours depending on who is asking, and the tool will not pick.
- [ ] Enter a failure rate as `1e-5 /h` → refused. Rates are plain numbers per
  hour, and the unit note says so.

---

## 0ap. New in v2.81.0 - Fluids breadth and fracture mechanics

Engineering: **Fluids 8**, **Fatigue & machine design 6**, mode states **125**.
All seven new tools insert a figure.

**Orifice, venturi & nozzle metering**

- [ ] Defaults (orifice, D 100 mm, d 50 mm, 20 kPa, water, Cd 0.61): flow about
  **0.00783 m³/s**, β **0.5**, approach factor **1.0328**.
- [ ] Leave the loss fraction **blank**: no permanent-loss figure is reported,
  and a note says it is not predicted and why. It must NOT invent one.
- [ ] Type **0.62** into the loss fraction: the loss is reported as 62% of the
  differential and the note says the figure is the one you supplied.
- [ ] Type **1.2**: refused - a meter cannot lose more pressure than it develops.
- [ ] Set the throat to **75 mm** (β 0.75): the approach factor rises above
  **1.19**, and a note warns that standards cap around there.
- [ ] Set the throat equal to or larger than the pipe: **REFUSED**.
- [ ] Set Cd to **1.5**: refused as above the frictionless ideal.

**Pump & system curve**

- [ ] Defaults: operating point about **0.0756 m³/s at 21.4 m**. The figure shows
  both curves crossing there.
- [ ] The throttled point must have **LESS flow at MORE head** (about 0.060 m³/s
  at 31.8 m) and report about **8.58 kW** burned at the valve.
- [ ] Change ONLY the efficiency, 0.4 to 1.0: the burned figure must NOT move.
  It is hydraulic power destroyed in the valve, and the pump's efficiency has
  nothing to do with it.
- [ ] Set the resistance **K to 0**: no throttled block at all. Multiplying zero
  by three moves nothing, and it used to announce a rise and a fall of zero.
- [ ] Set the static lift **above** the shut-off head: refused, saying no valve
  setting helps.

**Affinity laws**

- [ ] Defaults (1450 -> 1160 rpm): flow **80**, head **32**, power **10 240 W**,
  and power fraction exactly **51.2%**.
- [ ] Set the new speed to **725**: power fraction **12.5%**.
- [ ] The figure shows flow, head and power against speed, with power pulling
  away as the cube.

**Drag on a body**

- [ ] Defaults (car at 30 m/s): drag about **364 N**, power about **10.9 kW**.
- [ ] Set the velocity to **60**: power must be **eight times** the 30 m/s value.
- [ ] Clear the mass: terminal velocity is omitted rather than invented.

**Stress intensity & critical crack size**

- [ ] Defaults (200 MPa, 3 mm, Y 1.12, K_IC 50 MPa√m): K about **21.7 MPa√m**,
  critical crack about **15.9 mm**, critical stress about **460 MPa**.
- [ ] Set the crack to **12 mm** (four times): K must only **double**. That
  square root is why fracture is a threshold.
- [ ] Set the thickness to **5 mm**: it must say the assessment is CONSERVATIVE
  because a thin plate is TOUGHER.
- [ ] Set stress **800 MPa** against a **500 MPa** yield: **REFUSED** because the
  section has yielded through. It used to answer "safety on stress 2.58".
- [ ] Set Y **4**, stress 400 MPa, crack **0.2 mm**, K_IC 400e6, yield 500 MPa:
  refused because the plastic zone is not small - LEFM does not apply.

**Crack growth (Paris law)**

- [ ] Defaults: about **180 000 cycles**, final crack about **28 mm**, and the
  first doubling takes about **40%** of the whole life.
- [ ] Set the initial crack to **20 mm**: it must say the crack reaches critical
  size before it can double, NOT that the first doubling is 100% of the life.
- [ ] Set **m = 1**: the "most of the life while the crack is small" claim must
  NOT appear - it is false below m = 2, and it used to contradict its own number.
- [ ] It must NOT report something like 1.8e-13 cycles. C is quoted for ΔK in
  MPa√m, and using pascals is wrong by 10^18 at m = 3.
- [ ] Set the threshold ΔK to **5e6** with a 0.1 mm crack at 20 MPa: refused,
  saying the crack does not grow at all.
- [ ] Set the initial crack to **50 mm**: refused as already past critical.

**Yielding or fracture**

- [ ] Defaults: transition crack about **2.54 mm**, and at 3 mm **fracture**
  governs.
- [ ] Set K_IC to **150e6**: the transition size grows to about **22.8 mm** -
  what toughness actually buys.
- [ ] The figure shows the two failure-stress curves crossing at that size.

---

## 0ao. New in v2.80.0 - Thermal breadth, and legible graphs

Engineering > Thermal is now **9 calculators**; the mode must state **118**.

**The graph formatting fix - check this on ANY plot in the product**

- [ ] Any tool with a **legend** (Analyze > FFT, Plot, the new Thermal ones):
  the legend box must be **solid white**. Curves used to show straight through
  it and strike out the labels naming them.
- [ ] A plot with **large y values** (millions or more): the y-axis numbers must
  not touch or overlap the rotated y-axis title. The left margin now grows to
  fit them.

**Exchanger rating (effectiveness-NTU)** - new

- [ ] Defaults: Cr **0.75**, NTU **2**, effectiveness about **72%**, hot outlet
  about **106 °C**, cold outlet about **87 °C**. Hot and cold duties must agree.
- [ ] Set both capacity rates **equal**: effectiveness must be exactly
  **NTU/(1+NTU)** = 66.7% at NTU 2. That case is 0/0 in the textbook formula and
  must NOT come back as an error or a blank.
- [ ] Set the hot capacity rate to **1e9** (a condensing stream): every
  arrangement gives the same effectiveness, and a note explains why.
- [ ] Switch to **parallel** with a huge area: effectiveness stops at **50%**
  and the note says counterflow has no such ceiling.
- [ ] Raise the area until NTU is above 5: a note must say doubling the area
  from there buys almost nothing.
- [ ] The figure shows effectiveness against NTU for all four arrangements with
  **this exchanger marked**.

**Fin efficiency & effectiveness** - new

- [ ] Defaults (aluminium, h = 40): efficiency about **90%**, effectiveness
  about **31**. A note says fins pay when h is LOW.
- [ ] Set **h = 5000, k = 15, L = 0.01, t = 0.01**: effectiveness drops
  **below 1**, and the note must say the fin removes LESS heat than the bare
  surface. That is the result the tool exists for.
- [ ] Make the fin very long (L = 0.5): a note says a longer fin adds weight and
  no heat transfer.
- [ ] The figure shows temperature falling from the base to the tip.

**Transient cooling (lumped capacitance)** - new

- [ ] Defaults: Biot about **1.7e-4**, time constant about **203 s**,
  temperature at 600 s about **34 °C**.
- [ ] Set **h = 5000, k = 1, V = 1e-3**: **REFUSED**, with the Biot number
  quoted and the reason - a single exponential is the wrong SHAPE of answer.
- [ ] Set the initial temperature BELOW ambient: it heats instead, and the curve
  never overshoots.
- [ ] The figure shows the cooling curve against a flat ambient line.

**Radiation exchange & shields** - new

- [ ] Defaults (527 °C to 27 °C, ε = 0.8, one shield at ε = 0.05): the shield
  must cut the exchange by more than **tenfold** against no shield.
- [ ] Set the shield emissivity to **0.8** and shields to **1**: the exchange is
  cut by exactly **2**. Two shields: **3**. That is the N+1 rule.
- [ ] Switch to **small object in large surroundings**: changing emissivity 2
  must make NO difference, and a note says why.
- [ ] Set both temperatures **equal**: Q is zero and nothing is non-finite.
- [ ] A note must state the Celsius-to-kelvin conversion and say the fourth
  power makes Celsius wrong by orders of magnitude rather than by an offset.
- [ ] The figure shows radiation rising as the fourth power against a straight
  convection line.

**The five existing Thermal tools**

- [ ] **Heat exchanger (LMTD)** now inserts a temperature profile. On
  **counterflow** the gap between the curves stays roughly constant; switch to
  **parallel** and it collapses towards the outlet.
- [ ] All nine Thermal tools insert BOTH numbers and a figure.

---

## 0an. New in v2.79.0 - Structural & solids draws

Engineering > Structural & solids. All six tools now insert a figure.

**The minor axis, and the section -> column handoff**

- [ ] **Cross-section** on its defaults (I-beam 100, 10, 200, 6 mm): the report
  now includes **Iy** and **ry**, and says Iy is about **12.6x** smaller than I
  with the reason - a column buckles about the WEAKER axis.
- [ ] A **solid circle**: the report says it is axisymmetric and has no weaker
  axis. Iy must equal I.
- [ ] The **figure** shows the section drawn to scale with a dashed neutral axis
  and both c_top and c_bot. On a **Tee** the neutral axis must sit visibly ABOVE
  mid-depth, which is why its two section moduli differ.
- [ ] **Column buckling**, "Section properties from" = **A section shape**, with
  the default I-beam: it computes A and Iy itself, converts mm to m, and the
  note says the MINOR axis was used and by what factor that matters.
- [ ] Compare against typing the bare **mm⁴** number into the typed source: the
  critical load differs by about **10¹²**. That paste is what this removes.

**The two diagrams**

- [ ] **Stress state** on its defaults: a **Mohr's circle** inserts. It must be
  a CIRCLE, not an ellipse. σ₁ and σ₂ are marked where it crosses the σ axis,
  the applied state and its conjugate are joined by a dashed line through the
  centre, and τmax is labelled as the radius.
- [ ] Set τxy to **0**: the circle still draws, with the two principal points at
  σx and σy.
- [ ] Set σx = σy and τxy = 0 (hydrostatic): a zero-radius circle, no crash.
- [ ] **Mean stress & factor of safety**, "Endurance limit from" = **Marin
  factors**: Se is computed in place and the note shows the full ka x kb x kc x
  kd x ke chain. It must NOT need re-typing from the endurance tool.
- [ ] The **Goodman diagram** inserts, with five loci (Modified Goodman,
  Soderberg, Gerber, ASME elliptic, Langer yield), a legend, the operating point
  and the dashed load line from the origin. The 45° region must look like 45°.

**The rest of the discipline**

- [ ] **Truss**: the figure draws the truss in its own geometry. Members in
  tension are red, compression blue, and **zero-force members are dashed and
  grey**. Line thickness scales with force. Member angles must look right - the
  scale is equal on both axes.
- [ ] **Shaft torsion**: shear against radius, rising linearly to τmax at the
  surface. With a **bore**, the bore region is shaded and the line starts at the
  bore rather than at zero.
- [ ] **Beam** still inserts its shear/moment figure, unchanged.
- [ ] Every one of the six inserts BOTH the numbers and a figure.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Column buckling** with a yield strength of **1e-300**: it must return
  promptly. It used to consume **4 GB** and die - the transition slenderness
  came back Infinity, the tick step became Infinity, and the loop never ended.
  In a task pane that is a frozen Word.
- [ ] **Shaft torsion** with a torque of **0**: the figure must SAY there is no
  shear to plot. It used to insert a blank white 380x240 box captioned "Shear
  stress across the radius" - artwork that renders as nothing.
- [ ] **Cross-section**, rectangle **200, 50** (a plate on edge): the report
  must name the **horizontal** axis as the weaker one. It used to say the
  section was axisymmetric and had no weak axis at all.
- [ ] A **square** 100, 100: it must say both axes are equal, not name one.
- [ ] **Column buckling** from a section, using a **wide tee** (200, 20, 40,
  10): the note must quote the SAME number it converted. It used to print Iy
  while converting Imin - inconsistent by a factor of 62.
- [ ] **Mean stress**, "Endurance limit from" = **Marin**, material
  **non-ferrous**: the warning "THIS MATERIAL HAS NO TRUE ENDURANCE LIMIT" must
  appear. It used to print an infinite-life factor of safety with no caveat.
- [ ] **Mean stress** with σm = **-400** (compressive) and σa = 200: the figure
  must show BOTH a "fatigue point" and a separate "yield point (|σm|)". With one
  marker the picture said "safe" while the text said the part fails.
- [ ] The **torsion** figure's radius axis reads **mm** with real numbers, not
  "0.0" on an unlabelled axis.

**Contract**

- [ ] No em dash appears in any of the new captions - a caption is part of the
  result text, and an em dash there used to disable Insert for the whole tool.
- [ ] **Cross-section**, box with wall **60** on a 100x200: the refusal carries
  no em dash. The column tool surfaces this same message now.

---

## 0am. New in v2.78.0 - Tier 1 closed

Six separate places. Nothing here adds a calculator, so the counts do not move.

**Engineering > Chips & semiconductors > Junction temperature**

- [ ] On its defaults (power source **typed**, 15 W): junction **55 °C**,
  exactly as before. The new fields must not change the old answer.
- [ ] Switch "Dissipated power from" to **Switching parameters**: with the
  defaults (2 nF, 1.1 V, 2 GHz, activity 0.15) the power comes out **0.726 W**
  and the junction drops to about **26.5 °C**. The note must say the power was
  computed here rather than re-typed, and show the dynamic/leakage split.
- [ ] Set the leakage to **0.05 A**: the power rises, and a note must appear
  saying leakage is EXPONENTIAL in temperature and that the feedback loop is
  stated rather than modelled.

**Engineering > Fluids > Pump NPSH & cavitation**

- [ ] Defaults (both sources **typed**): unchanged from before.
- [ ] Switch "Density from" to **Water**: at 20 °C the density reads
  **998.2 kg/m³** and a note says it came from the shipped table.
- [ ] Set the temperature to **150**: refused, because the table covers 0-100 °C.
- [ ] Switch "Suction-line losses from" to **Pipe geometry**: the loss is
  computed from the defaults and the note must quote the friction and fitting
  halves, the velocity, the Reynolds number and the Colebrook friction factor.
- [ ] Change the suction pipe diameter from **0.1** to **0.15**: the head loss
  must fall STEEPLY - more than fivefold. That is why the fix for cavitation is
  a bigger suction line.
- [ ] With density **typed** and losses **from pipe**, a note must disclose that
  the viscosity was taken as water at 20 °C.
- [ ] A note must always explain that **vapour pressure is deliberately not
  filled in**, and that NPSH available collapses with temperature through it.

**Engineering > Structural & solids > Beam**

- [ ] Any beam: an **Equilibrium check** block appears, with the total applied
  load, the sum of the reactions, and **Balance exact**.
- [ ] `point 30 at 2` + `udl 10 from 0 to 4` on a 6 m beam: total applied
  **70 kN**, reactions summing to **70 kN**.
- [ ] A propped cantilever (`fixed 0`, `roller 6`, `udl 24 from 0 to 6`): total
  **144 kN**, and the balance is still exact - the check does not depend on the
  beam being determinate.
- [ ] Add an applied couple (`couple 50 at 3`): the total applied load does NOT
  change, because a couple carries no vertical force.
- [ ] Type a load line the parser cannot read, e.g. `ramp 0 12 from 0 to 4`
  (the real syntax is `udl 0 to 12 from 0 to 4`): it is reported as an error.
  This is the case the equilibrium check exists for.

**Analyze > FFT filter**

- [ ] On the defaults, with **Edge shape = Raised cosine**: the filtered samples
  must be EXACTLY what this tool produced before v2.78.0. The default changing
  would be a regression.
- [ ] Switch to **Butterworth**: a caveat appears naming the ORDER and the dB
  actually achieved at the stopband edge.
- [ ] Switch to **Chebyshev**: the order is LOWER than Butterworth's for the
  same settings, which is the trade the two families exist to offer.
- [ ] Raise the stopband attenuation from **40** to **60**: the order rises.
- [ ] Set the transition width to **0** with a designed shape selected: it falls
  back and says the filter is **not the one you asked for**.
- [ ] A caveat must say the MAGNITUDE is applied but the phase is not.

**Solve > Geometry (3-D transforms)**

- [ ] `rotate 90 z (1,0,0)` -> about **(0, 1, 0)**, determinant **1**.
- [ ] `scale 2 3 4 (1,1,1)` -> **(2, 3, 4)**, volume scale factor **24**, and
  the coordinates shown as EXACT integers.
- [ ] `reflect xy (1,2,3)` -> **(1, 2, -3)**, determinant **-1**, and the text
  must say it **FLIPS ORIENTATION**.
- [ ] `scale 0 (1,2,3)` -> the text must say the transform **COLLAPSES** space.
- [ ] `rotate 90 z then scale 2 3 4 (1,0,0)` gives y = **3**, while
  `scale 2 3 4 then rotate 90 z (1,0,0)` gives y = **2**. A caveat must say
  ORDER MATTERS.
- [ ] `rotate 30 z (1,0,0)`: a caveat says the result is NUMERIC, not exact, and
  no sixty-digit fraction appears anywhere in the output.
- [ ] `reflect xy then reflect xy (1,2,3)` returns **(1, 2, 3)**.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Solve > Integral**, both limits blank, `sqrt(-1)`: the "no closed-form
  antiderivative" message. It used to print **`NaN*x + C`** and insert it -
  `NaN` is not the em-dash the guard scans for. Same for `ln(-1)`, `asin(2)`,
  `1/0`.
- [ ] `tan(x)` indefinite: says "Checked **NUMERICALLY** ... Strong evidence,
  not a proof", NOT "Verified symbolically". Same for `sqrt(x)`. But `x^2` and
  `sin(x)` DO say symbolically.
- [ ] `sin(x)^2`: the no-answer message must NOT claim such integrands
  "genuinely have none" - it has a standard antiderivative.
- [ ] **FFT filter**, band-stop 20 to 70 Hz, transition 10, Chebyshev, stopband
  40 dB: rejection in the middle of the band must exceed **40 dB**. It used to
  cap at about **18 dB** - worse than the raised cosine.
- [ ] **FFT filter**, high-pass cutoff **2**, transition **10** (stopband would
  be at -8 Hz), Butterworth: falls back and does NOT quote an attenuation. It
  used to report **191 dB** for a filter passing 14% at 0.5 Hz.
- [ ] **Solve > Geometry**: `rotate about x 90 (1,2,3)` -> **(1, -3, 2)**. It
  used to rotate about **z**. Also `rotate x 90`, `rotate 90 x-axis`.
- [ ] `rotate 1e3 z (1,0,0)` rotates **1000 degrees**, not 1.
  `scale 1/2 (2,2,2)` -> **(1,1,1)**, not (2,2,2).
- [ ] `mirror the point (1,2,3) in the yz plane` -> **(-1, 2, 3)**. The plane
  written after the point used to be thrown away.
- [ ] `rotate 90 (1,2,3)`, `reflect (1,2,3)`, `scale 2 3 (1,1,1)` and
  `rotate 90 z, scale 2 (1,0,0)` are each **REFUSED by name** rather than
  silently given a substituted transformation.
- [ ] `reflect xy (1,2,3)` shows **determinant -1** and **volume scale factor
  1** on separate lines. It used to print "volume scale factor = -1  ~ 1".
- [ ] **Beam** with `point -30 at 3` (an upward load): the wording must match
  the sign - no "-30 kN down".

**Engineering > Structural & solids > Cross-section**

- [ ] Set the shape to **Circular hollow** with a wall thicker than half the
  diameter: the refusal must contain **no em dash**. It used to, and an em dash
  anywhere in a result is the pane's non-finite sentinel, so it disabled Insert.

**Solve > Integral (indefinite)**

- [ ] Type `x^2` and **clear both limit boxes**: the answer is
  **∫ (x^2) dx = x^3/3 + C**, with the check derivative shown and "Verified
  SYMBOLICALLY".
- [ ] `x*exp(x)` -> **x*exp(x) - exp(x)**. `1/(x^2+1)` -> **atan(x)**.
  `tan(x)` -> **-ln(abs(cos(x)))**.
- [ ] `exp(-x^2)` -> reported as having **no closed-form antiderivative**, with
  the message saying that is often the correct answer rather than a failure.
- [ ] `1/x` -> **ln(abs(x))**, and a caveat must warn that the constant is
  **NOT shared across a pole**.
- [ ] Put limits back in (0 and 1): the definite integral works exactly as
  before. The indefinite path must not have broken it.
- [ ] It inserts, with the integral sign typeset.

---

## 0al. New in v2.77.0 - trajectory & orbits

Engineering mode. A **nineteenth** discipline, **Trajectory & orbits** (13); the
mode must state **114 calculators** across **nineteen disciplines**. Every value
below is the tool's own default, so each check is a single click.

**Ballistic**

- [ ] **Projectile in a vacuum**, 20 m/s at 45°, height 0: range **40.79 m**
  (which is exactly v²/g), apex **10.20 m**, flight **2.884 s**, impact speed
  **20 m/s** - equal to the launch speed, because energy is conserved. Best
  angle **45°**.
- [ ] Change the launch height to **10**: the best angle drops to **39.32°**,
  NOT 45°, and the note must say so. Range at that angle **49.79 m**, better
  than the **49.10 m** the 45° shot gives. This is the headline result.
- [ ] **Projectile with air drag** on its defaults (800 m/s, 30°, 0.01 kg,
  5e-5 m², Cd 0.3): range **2970 m** against a vacuum range of **56518 m** -
  only **5.26%**. Drag is the dominant term, not a correction.
- [ ] A **trajectory plot** inserts, and the curve **ends at the ground** - no
  part of it dips below zero.
- [ ] Set Cd to **10**: refused as outside any physical range, not computed.
- [ ] **Launch angle for a target**, 20 m/s at 30 m: **two** answers, **23.67°**
  and **66.33°**, which sum to 90°. The lofted one takes longer (3.736 s vs
  1.638 s). Maximum range **40.79 m**.
- [ ] Ask for **1000 m** at 20 m/s: **REFUSED** as beyond maximum range, with
  the word "refused rather than clamped". It must not return 45°.
- [ ] **Impact speed, energy & momentum** on its defaults (4.5 g hailstone,
  1000 m): impact **22.10 m/s**, terminal **22.10 m/s**, but the vacuum figure
  is **140.0 m/s**. Energy **1.099 J**, at **100%** of the ceiling.
- [ ] Change the drop height to **5000**: the energy is still **1.099 J** and
  the speed still **22.10 m/s**, while the vacuum speed rises to **313.2 m/s**.
  Five times the height, no extra energy - the saturation result.
- [ ] The fall time must RISE with height (46.8 s at 1000 m, about 228 s at
  5000 m). A fall time that stops growing is the bug this check exists for.

**Orbital**

- [ ] **Circular orbit**, Earth at 400 km: speed **7669 m/s**, period **5554 s**
  (**92.56 min**), escape speed here **10845 m/s**.
- [ ] Set the altitude to **35786 km**: period **86164 s** = **23.934 h**. That
  is the **sidereal day**, which is the definition of geostationary - and it is
  the cross-check that the fetched μ is right.
- [ ] Compare 300 km with 20000 km: the **lower** orbit is the **faster** one,
  and the note must say adding energy slows you down.
- [ ] **Elliptical orbit**, 300 x 35786 km: semi-major axis **24421 km**,
  eccentricity **0.7265**, periapsis speed **10151 m/s**, apoapsis speed
  **1608 m/s**, period **37980 s**.
- [ ] Enter equal apsides (500 and 500 km): eccentricity **0**, and the period
  matches the circular-orbit tool at 500 km exactly.
- [ ] Enter the apsides **swapped** (35786 periapsis, 300 apoapsis): refused
  with the word "swapped", not silently reordered.
- [ ] **Hohmann transfer**, 300 km to 35786 km: burns **2426** and **1467** m/s,
  total **3893 m/s**, transfer **18990 s** (**5.275 h**), phase angle **100.7°**.
- [ ] Reverse it (35786 to 300 km): both burns turn **negative** and the total
  Δv is the **same**. Lowering costs what raising costs.
- [ ] Transfer 300 km to 400 km: the note must say **SLOW DOWN** to catch
  something ahead of you.
- [ ] **Rocket equation**, Isp 450 s, 100 kg to 20 kg: exhaust **4413 m/s**,
  mass ratio **5**, Δv **7102 m/s**, propellant **80 kg** (**80%**).
- [ ] Set the final mass **equal to or above** the initial: refused.
- [ ] **Escape speed**, Earth at 0 km: **11180 m/s** - the familiar 11.2 km/s.
  Circular **7905 m/s**, extra from orbit **3275 m/s**, which is **41%** more
  and not twice as much. The note must say escape is independent of direction.
- [ ] Switch the body to the **Moon**: everything rescales, and the Moon's
  surface gravity works out at about a sixth of Earth's.

**Profiles & navigation**

- [ ] **Jerk-limited (S-curve) profile**, 1 m at 0.5 m/s, 2 m/s², jerk 10:
  total **2.450 s** against a trapezoidal **2.250 s**. It is **slower**, and
  the note must explain that this is deliberate.
- [ ] Raise the jerk to **100000**: the S-curve time converges on the
  trapezoidal one. Lower it to **2**: the gap widens.
- [ ] **Multi-axis coordination** on its three default axes: move time
  **1.500 s**, limiting axis **X**, fastest axis alone **0.447 s**. Y is
  throttled to **0.4216 m/s** and **0.3556 m/s²** (**42.2%** used), Z to
  **0.0894 m/s** and **0.0889 m/s²** (**29.8%**). X stays at **100%**.
- [ ] The note must say throttling the fast axes costs **nothing** in cycle
  time and mention the **dog-leg** it avoids.
- [ ] Give a row with only three values: refused by name, with the row quoted.
- [ ] **Great-circle**, Heathrow to JFK on the defaults: **5539 km** /
  **2991 nmi**, initial bearing **287.9°**, final bearing **231.3°**. Those two
  DIFFER by more than 50° - the point of the tool.
- [ ] Enter the same point twice: distance **0**, no crash.
- [ ] **Wind triangle** on its defaults (track 090, TAS 50, wind from 180 at
  10): heading **101.5°**, ground speed **48.99 m/s**, drift **11.54°**. You
  steer INTO the wind, so the heading is south of the track.
- [ ] Set the wind to **from 090 at 10** (pure headwind): drift **0°**, ground
  speed exactly **40 m/s**. Set it to **from 270**: **60 m/s**.
- [ ] Set TAS **10** and wind **50 from 180**: **REFUSED** - no heading makes
  that track good. It must not return an angle.
- [ ] **TWO ANSWERS (v2.77.1).** Track **090**, TAS **50**, wind **from 240** at
  **80**: heading **143.1°** at **99.28 m/s**, AND a **second solution** of
  **216.9°** at **39.28 m/s**. Both genuinely make the track good - the second
  points backwards relative to the air and lets the wind carry you along. The
  note must say so.
- [ ] Track **090**, TAS **10**, wind **from 270** at **30**: ground speeds
  **40** and **20 m/s**.
- [ ] The ordinary default (wind from 180 at 10) shows **no** second solution -
  its other root makes good the reciprocal track and is correctly discarded.

**What the independent adversarial pass found (all fixed - re-check these)**

- [ ] **Projectile with drag**, 1 m/s at 0.001°, 2.7 g, 0.00126 m², Cd 0.5,
  height **1000**: a ping-pong ball off a cliff. Flight time must be **over
  100 s** and the plotted curve must **reach the ground**. It used to stop at
  43.8 s with the ball still **627 m in the air**, because the vacuum flight
  time was used as an upper bound - and it is not one, since drag lengthens the
  descent even though it shortens the ascent.
- [ ] **Projectile with drag** at a **negative** angle from height **0**:
  refused with "no flight". It used to return a fraction of **NaN** and a
  trajectory **50 m underground**.
- [ ] The same shot from a height of **50**: accepted, lands, and the apex
  equals the launch height.
- [ ] **Projectile with drag**, 14 m/s at 40°, 7.26 kg, 0.0113 m², Cd 0.47 (a
  shot put): apex **4.11 m**. It used to report **3.48 m** - the maximum over
  the solver's samples rather than the real vertex, 15% low.
- [ ] **Projectile with drag**, 2000 m/s at 80°, 100 kg: refused for leaving the
  **standard atmosphere**. It used to integrate 94 km of flight as a vacuum
  while the notes claimed ISA density.
- [ ] **Hohmann transfer**, 35786 km **down to** 300 km: phase angle **1.25°**.
  It used to read **-1078.75°**, which is not a lead angle anyone can use.
- [ ] **Multi-axis coordination** with two **identical** axes (`X, 1, 1, 2` and
  `Y, 1, 1, 2`): both at **100%**, and the note must say they already finish
  together. It used to claim a **dog-leg** that its own numbers disproved.
- [ ] Add a zero-distance axis (`Z, 0, 0.3, 1`): Z keeps its own limits rather
  than being throttled to zero. Paste the resulting plan back in as input - it
  must be **accepted**, not refused.
- [ ] **Impact energy** with a frontal area of **1e-16**: fall time about
  **0.45 s**, not **0**. The deep-drop fix had broken the shallow end.

**Contract**

- [ ] Every one of the 13 tools inserts into Word, with **°**, **Δv**, **m/s²**,
  **N·s** and **√2** intact and no em-dash placeholder anywhere.
- [ ] Typing a unit on a converting field works: **"72 km/h"** as a launch
  speed, **"500 kt"** as an airspeed, **"35786 km"** as an altitude, **"1 lb"**
  as a mass. Each is converted and the conversion is REPORTED.
- [ ] Typing a unit of the **wrong quantity** (a length where a mass belongs)
  is refused by name rather than ignored.

---

## 0ak. New in v2.76.0 - colour gamut coverage

- [ ] **Engineering > Video & display > Colour gamut coverage.** DCI-P3 against
  sRGB: coverage **100%** in both metrics, area ratio about **126%**, and about
  **20%** of P3 outside sRGB. That pairing is the whole point - a space can be
  126% by area while covering exactly 100%.
- [ ] sRGB against Rec.2020: coverage about **58% (u'v')** and **53% (xy)** -
  the two metrics must DIFFER, and the note must say to quote u'v'.
- [ ] Any space against itself: **100%** coverage, **100%** area ratio, **0%**
  outside. That identity is what validates the polygon clipper.
- [ ] Rec.709 against sRGB: **100%** both ways, since they share primaries.
- [ ] The area table at the bottom lists every space relative to sRGB, ordered
  sRGB < DCI-P3 < Rec.2020.
- [ ] The notes cite where the primaries came from (IEC / ITU / SMPTE).
- [ ] It inserts.

---

## 0aj. New in v2.75.0 - video & display

Engineering mode. An eighteenth discipline, **Video & display** (6); the mode
must state **101 calculators** across **eighteen disciplines**.

- [ ] **Bitrate** at the defaults (1920x1080, 25 fps, 8-bit, 4:2:0, ratio 1):
  uncompressed **622.08 Mbit/s**, 12 bits per pixel. Switch chroma to 4:4:4 and
  the rate must exactly DOUBLE - confirming 4:2:0 is a 50% reduction.
- [ ] Set the compression ratio to 0.5: refused, saying it would make the file
  larger.
- [ ] **Resolution** 3840x2160 at 55 in: **16:9**, 8.29 Mpixel, about **80 PPI**,
  grid invisible past roughly **1.09 m**. Try a phone (2532x1170 at 6.1 in) -
  much higher PPI and a much SHORTER distance.
- [ ] **HDR** at 1000 nits / 0.05 black: contrast **20000 : 1**, about **14.3
  stops**, and a code-range table showing how little of PQ the bright end uses.
  Set black to 0: contrast reads **infinite** with the self-emissive note.
- [ ] Set peak to 20000: refused (above the PQ ceiling).
- [ ] **PSNR** with MSE 100 at 8-bit: **28.13 dB**. Set MSE to 0: refused,
  because identical images give infinite PSNR.
- [ ] **Streaming** at 5 Mbit/s over 8 Mbit/s with a 5 MB buffer: buffer holds
  **8 s**, startup **13.33 s**. Set bandwidth equal to the bitrate: it must say
  the buffer never fills and that this is a bitrate problem.
- [ ] **Latency** at the defaults: sum **63 ms**, delivered **66.67 ms** = 4
  frames at 60 Hz. Change encode from 20 to 15 ms: the SUM drops but the
  DELIVERED figure must stay the same - the point of the whole calculator.
- [ ] All six insert.

---

## 0ai. New in v2.74.0 - audio & acoustics

Engineering mode. A seventeenth discipline, **Audio & acoustics** (7); the mode
must state **101 calculators** across **eighteen disciplines**.

- [ ] **Sampling**: 44.1 kHz with a 20 kHz signal is adequate; Nyquist reads
  **22050 Hz**. Set the signal to 30 kHz: it must say NOT adequate and fold it.
- [ ] **Quantisation** at 16 bits: SNR **98.08 dB**, 65536 levels, and with
  44.1 kHz stereo the rate reads **1.4112 Mbit/s** (CD audio). A note must say
  the figure assumes a FULL-SCALE signal.
- [ ] **Decibels**, ratio 2 on the field basis: **6.02 dB**, with **3.01 dB**
  shown beside it as the other convention. Switch to power and they swap.
- [ ] **Sound level**: 100 dB at 1 m reads **93.98 dB at 2 m** (-6.02). With
  the summing box at `80, 80` the total is **83.01 dB** - +3, not +6.
- [ ] **Reverberation** at 200 m3 / 240 m2 / 0.2: Sabine **0.671 s**, Eyring
  **0.601 s**, both shown. Raise absorption to 0.4 and a note must say use
  Eyring. Enter 1 and it must be refused.
- [ ] **Room modes** for 5 x 4 x 2.5: the first is **34.3 Hz axial (1,0,0)**.
  Try a 4 x 4 x 4 cube - the first three modes must be identical, which is the
  point about ratios.
- [ ] **Comb filtering** at 1 ms: first notch **500 Hz**, notches at 500, 1500,
  2500, peaks at 1000, 2000, 3000. A note must say EQ cannot fix it.
- [ ] All seven insert.

---

## 0ah. New in v2.73.0 — photometric units

No new calculators; this is the units groundwork for the audio/video bench.
Check it in **Units** mode.

- [ ] Convert `1 cd` → `mcd` = **1000**; `1 klm` → `lm` = **1000**.
- [ ] `1 nit` → `cd/m^2` = **1**, and back. `1 lx` → `lm/m^2` = **1**, and back.
- [ ] **These must be REFUSED**, each with the wrong-quantity message rather
  than a number: `lm` → `W`, `cd` → `lm`, `nit` → `lx`, `cd` → `W`.
  A number appearing for any of them is the defect this release exists to avoid.
- [ ] `60 fps` → `Hz` = **60** (checking a source against a panel refresh).
- [ ] `1 ft/s` → `m/s` = **0.3048** — feet per second still works, written that way.
- [ ] Spelled-out `candela`, `lumen`, `lux`, `nits` all resolve.
- [ ] Nothing existing broke: `1 km` → `m`, `1 L` → `mL`, `1 kt` → `m/s`,
  `1 fpm` → `m/s` all still convert.

---

## 0ag. New in v2.72.0 — HMBC and TOCSY

- [ ] **Spectra** now lists **HMBC** and **TOCSY** in the dropdown (eight
  predictions in total).
- [ ] **HMBC** on methyl acetate (`CC(=O)OC`): correlations must appear to the
  **carbonyl carbon near 170 ppm** — the carbon HSQC shows nothing for, because
  it carries no proton. Switch to HSQC and confirm that carbon really is absent
  there. That contrast is the whole point of the experiment.
- [ ] In the HMBC table, every row is labelled **2J** or **3J**, and on the chart
  the 2J points are drawn faint.
- [ ] **TOCSY** on propan-1-ol (`CCCO`): exactly **one** spin system containing
  three signals, with the OH separate. On methyl acetate: two systems, neither
  with more than one signal.
- [ ] Compare TOCSY with COSY on `CCCO`: TOCSY must show **more** cross-peaks,
  because it relates the first and third protons that COSY does not.
- [ ] Both insert as text, and both insert as a chart.

---

## 0af. New in v2.71.0 — import a sequence file

- [ ] **Sequence** mode: beside "+ Add sequence" there is now
  **Import FASTA / GenBank…**. Load a multi-record FASTA — every record must
  become its own card, with residues filled and the count shown under each.
- [ ] The molecule-type dropdown must be guessed: a DNA sequence reads **DNA**,
  one containing U but no T reads **RNA**, a protein sequence reads
  **Protein (AA)**. Correct it by hand where the guess is wrong.
- [ ] Load a **GenBank** file: the organism from its source feature must appear
  in the organism box.
- [ ] Import when the only card is blank: that blank card disappears. Type
  something into a card first, then import: **your typed card must survive**.
- [ ] A file over 8 MB, and a file that is neither format, are each reported by
  name rather than failing silently.
- [ ] **In-text reference**: the SEQ ID box now takes `1-3` or `1, 2, 5` as well
  as a single number, and inserts ONE citation covering them. Nonsense input is
  refused with a message.
- [ ] Generate the ST.26 XML after an import and confirm the sequences are in it.

---

## 0ae. New in v2.70.0 — DEPT

- [ ] **Spectra → ¹³C NMR** on ethanol (`CCO`): each line now shows a **class**
  beside the shift — CH3 and CH2 here — and a **DEPT** block underneath gives the
  tally plus what DEPT-135 and DEPT-90 would show.
- [ ] Toluene (`Cc1ccccc1`): the ipso carbon must read **C** (quaternary), the
  ring carbons **CH**, the methyl **CH3**. In the DEPT-135 line, CH2 (if present)
  must read **DOWN** while CH and CH3 read up.
- [ ] tert-butanol (`CC(C)(C)O`): a **C** and **CH3**, no CH2.
- [ ] Propan-2-ol (`CC(O)C`) shows a **CH**; propan-1-ol (`CCCO`) shows a **CH2**
  — the pair DEPT-90 exists to separate.
- [ ] **¹H** spectra must NOT show a class column (DEPT is a carbon experiment).
- [ ] The ¹³C table still inserts.

---

## 0ad. New in v2.69.0 — fit any model you can type

- [ ] **Analyze → Fit a model to data.** At the defaults it fits
  `a*exp(-b*x) + c`, reports each parameter with a **± standard error**, R²,
  RMSE, whether it converged, and draws the fit through the scattered data.
- [ ] Clear the starting values: it must still fit, and a note must say they
  **defaulted to 1** and that a poor fit is usually a starting-value problem.
- [ ] Try another model on the same data, e.g. `m*x + b` — the parameter names
  in the output follow whatever you typed.
- [ ] Type `wibble(x)*a`: refused, naming the functions that DO exist.
- [ ] Type `2*x` (no parameters): refused with that reason.
- [ ] **Engineering → Quantum optics → Two-qubit state.** There is now a
  **Preset** dropdown with the four Bell states. Selecting |Φ+> must give
  concurrence **1**; |Ψ-> likewise. "Custom" still uses the typed amplitudes.
- [ ] **Insert** works on the fit (no em dash in its notes).

---

## 0ac. New in v2.68.0 — PCA and data integration

- [ ] **Analyze → Principal component analysis.** At the defaults it reports a
  variance table, the number of components reaching 95%, a **scree plot**,
  loadings and scores. The percentages must sum to 100 and the cumulative column
  must never decrease.
- [ ] Switch **Basis** to Covariance and back: the note changes to name which
  basis ran, and the numbers change with it.
- [ ] Paste data with a **constant column** and standardised basis: refused with
  the "never vary" reason, not a divide-by-zero or a silent result.
- [ ] Use **Use table at cursor** to load a numeric Word table straight into it.
- [ ] The notes must always say component **signs are arbitrary**.
- [ ] **Analyze → Integrate measured data (trapezoid).** At the defaults it gives
  an area, a mean value, and a chart showing both the data and the **running
  integral**. Enter x = 0..10 with y = x: the area must be exactly **50**.
- [ ] Reverse the x order: the area becomes **negative** and a note says so.
- [ ] Give x values that go up and down: it must flag **non-monotonic** x.
- [ ] Both insert.

---

## 0ab. New in v2.67.0 — FFT windowing

- [ ] **Analyze → FFT / frequency spectrum.** There is now a **Window** dropdown
  defaulting to **Hann**. At the defaults the tool still reports the same
  dominant frequency, and a note names the window and what it trades.
- [ ] Switch to **None (rectangular: leakage)**: the note changes to explain the
  wrap-around discontinuity. Compare the two spectra on a longer signal — the
  Hann one has visibly less energy in the skirts either side of the peak.
- [ ] Paste a two-tone signal (50 Hz and 120 Hz sampled at 1000 Hz). **Dominant
  frequencies must list TWO different tones**, not the same peak twice from
  adjacent bins. Check this under every window.
- [ ] Paste a constant signal (e.g. eight copies of 5): dominant frequencies must
  be **none** under every window, not a spurious tone.
- [ ] Add a large constant offset to a real signal: the tone must still be found.
- [ ] **Insert result** must work — the note text contains no em dash, which
  would disable it.

---

## 0aa. New in v2.66.0 — wiring what was already built

- [ ] **Engineering → Fatigue → Mean stress & factor of safety.** The σa field
  must read "**Nominal** alternating stress" — NOT "already multiplied by Kf" —
  and there must be a **Kf** field defaulting to 1. At the defaults the answer
  matches the old one. Set Kf = 2: σa doubles internally, the report shows
  "100 MPa nominal × Kf 2 = 200 MPa applied", and the factor of safety falls.
  Set Kf = 0.5: **refused** (Kf is 1 or greater).
- [ ] **Bio/Assay → Substrate inhibition (Ksi)** exists. At the defaults it fits
  and reports Vmax, Km, Ksi, and a **peak velocity at an [S]** — with a caveat
  saying Vmax is an asymptote the enzyme never reaches. The plotted curve must
  RISE then FALL.
- [ ] Paste plain saturating data into it (no descending limb): it must warn that
  inhibition cannot be established, or refuse — not report three confident parameters.
- [ ] **Finance** now lists **24** calculators. Check the five new ones:
  **Depreciation (straight line)** — 10000/1000/5 gives 1800 a year;
  **Annuity** — PV and FV of a level stream; **Perpetuity** — set growth ≥ the
  discount rate and it must refuse with the divergence explanation;
  **Rate conversions** — continuous must exceed every discrete figure;
  **CAGR** — 10000 → 18000 over 5 years.
- [ ] All five insert.

---

## 0z. New in v2.65.0 — your document is a data source

The three changes here are all about getting data in and finding tools. Have a
Word table of numbers in the document before you start.

- [ ] **Stats → Descriptive statistics.** Under the data field there must now be
  two buttons: **Use table at cursor** and **Open CSV…**. Click inside your Word
  table, then press **Use table at cursor** — the field fills and the status line
  reports "Loaded N rows × M columns from the table at your cursor". Results
  recompute immediately.
- [ ] Put the cursor OUTSIDE any table and press it: a clear message asks you to
  click inside a table — not a silent failure.
- [ ] **Analyze → Data insights**, same buttons. A table with a text header row
  and numeric columns must load with the header intact.
- [ ] **Analyze → matrix tools** (e.g. Determinant): **Use table at cursor** on a
  square numeric table fills it space-separated, one row per line, header dropped.
- [ ] **Open CSV…** with a file whose labels contain commas (e.g. `"Smith, J.",42`).
  The columns must NOT shift — the quoted cell stays one cell.
- [ ] A file over 8 MB is refused with a message rather than freezing the pane.
- [ ] **Table → Chart** still works exactly as before (it now shares the same reader).
- [ ] **Search box**: type `Betz` → the wind turbine calculator appears and
  selecting it opens Engineering with that calculator chosen. Try `ANOVA`,
  `Kaplan`, `Black-Scholes`, `flue`. Try a tool name: `Citations`, `Spectra`.
  Formulas and compounds (`quadratic`, `benzene`) must still work.
- [ ] The search placeholder mentions tools and calculators, not just formulas.

---

## 0y. New in v2.64.0 — the eight live defects

Fixes from `docs/GAP-ANALYSIS-2026-08-01.md`. Most are visible without leaving
the Home screen.

- [ ] **Home screen**: the Engineering tile reads **"101 calculators across 16
  disciplines"** — not 36, not nine. It is counted from the registry, so it
  should track any future addition automatically.
- [ ] **Home screen**: click the **science** filter chip. **Finance must still be
  visible** (it was hidden behind the legal chip).
- [ ] **Spectra → ¹H NMR** on a fluorine compound (SMILES `OCCF`): a caveat must
  say **¹⁹F coupling is NOT included in the multiplicities**. Try a phosphate
  ester (`CCOP(=O)(OCC)OCC`) — same warning for **³¹P**, reached through the
  oxygen. Then check `CCO` (ethanol): **no such warning** — it must stay specific.
- [ ] **Analyze → Data insights**, paste six or more numeric columns of junk. The
  narrative must state **how many pairs were tested**, name
  **Benjamini-Hochberg**, and report an **adjusted** p beside the raw one. Any
  correlation reported must be followed by the **causation** caveat.
- [ ] **Align**, paste a two-record FASTA (`>a` / `>b`) into either box: a caveat
  must say the records were **joined into one sequence**. A single-record FASTA
  must produce no such warning.
- [ ] **Insert** from Insights and from Spectra — the new caveat lines must land
  in the document with the rest of the report.

---

## 0x. New in v2.63.0 — adiabatic flame temperature

Engineering mode, Energy & power (now 17; the mode must state **101 calculators**).

- [ ] **Flame temperature** at the defaults (CH4, LHV 50.0, stoichiometric): between
  **2250 and 2400 K** (~2320), and the FIRST note says dissociation is NOT modelled
  and the figure overstates a real flame by ~100–200 K.
- [ ] Switch the basis to HHV with 55.5: LHV used shows **50.02 MJ/kg** and the flame
  temperature matches the LHV route.
- [ ] Excess air 0.5: the temperature drops well below the stoichiometric figure and
  a note explains the dilution.
- [ ] Air preheat 400 °C: the temperature RISES above the unpreheated run and the
  preheat contribution line appears.
- [ ] CH3SH (a sulfur fuel): **refused**, naming the missing sulfur tables and
  pointing at the combustion tool for the stoichiometry.
- [ ] LHV 129 on H2: refused at the **3500 K** polynomial wall with the dissociation
  explanation — not an extrapolated number.

---

## 0. Setup

- [ ] Build is current (`npm run build`) and the add-in is loaded:
  - **Dev:** dev server running (`npm run dev-server`), manifest sideloaded.
  - **Prod:** installed from the per-OS pack; web files hosted on GitHub Pages.
- [ ] For most modes, a **blank** Word document is fine. For **Audit** (§14) — and
  optionally **Numerals** (§10) and **Refs** (§11) — open the ready-made
  **`docs/Formula-Inserter-Test.docx`**, which already contains planted issues
  (orphan numeral `(99)`, `SEQ ID NO: 5`, figure-number gaps, and a dangling
  `Fig. 7`). Regenerate it any time with `powershell -File scripts\make-test-doc.ps1`.
- [ ] Open the task pane (**Home → Insert Formula**, or **Insert → Add-ins**).
- [ ] The pane loads on the **Home** page with tools grouped by category, and the
  mode list shows all 25:
  **Chemical · Mass Spec · Spectra · Bio/Assay · Peptide · Stats · Analyze ·
  Math · Solve · Units · Plot · Table → Chart · Finance · Build · Code · Sequence Map ·
  Align · Sequence · Botanical · Numerals · Refs · DNA · Reaction · Citations ·
  Audit.**
- [ ] **Offline check:** after first load, disconnect the network — the pane and
  all *insert* actions still work (only first load needs HTTPS).

> General checks to keep in mind for every insert: it lands at the cursor, the
> preview matches what's inserted, and a single **Ctrl-Z** removes it cleanly.

---

## 1. Chemical
- [ ] Type `H2O` → preview shows **H₂O**; **Insert formatted text** inserts H₂O.
- [ ] Type `SO4^2-` → inserts **SO₄²⁻**.
- [ ] Type `aspirin` → 2D structure appears, tight (no big empty margin);
  readout shows Formula **C9H8O4**, and **Name: Aspirin**.
- [ ] **Insert 2D structure** → image inserts, sized to the structure (not oversized).
- [ ] **Insert name** → inserts the text "Aspirin".
- [ ] Type a SMILES `CC(=O)O` → structure renders.
- [ ] **Substituent-corrected pKa (v1.87):** `Oc1ccc([N+](=O)[O-])cc1` (p-nitrophenol) →
  Phenol pKa **≈ 7.15** (not 9.99), with a note showing **parent 9.99; Hammett … NO2 para**.
  `Oc1ccccc1` (phenol) → **≈ 9.99**. `OC(=O)CCl` (chloroacetic) → **≈ 2.87** (vs acetic 4.76).

## 1b. Mass Spec
- [ ] Type `caffeine` → **Monoisotopic 194.0804**, **Average 194.19**, formula
  **C8H10N4O2**.
- [ ] Isotope pattern shows M as the base peak with a small M+1 bar.
- [ ] Adducts list shows **[M+H]⁺ 195.0877** and **[M+Na]⁺ 217.0696**; the negative ions read
  **[M−H]⁻** (true minus, superscript charge) and the ammonium adduct **[M+NH₄]⁺**.
- [ ] Type a chlorinated compound (`ClC(Cl)Cl`) → the **M+2 bar is ~96%** of M (96.0; M+4 30.7)
  (the chlorine signature) — this is the check that the pattern is real.
- [ ] **Insert MS data** → text summary lands at the cursor.

## 1c. Spectra  *(v1.54 — predicted NMR / IR / UV-Vis / fragmentation; v1.83 — J-coupling + 2D COSY/HSQC)*
> These are **estimates from additivity rules**, not acquired spectra. Every
> screen must carry its caveat — if a caveat block is missing, that is a FAIL.

- [ ] Type `toluene`, spectrum **¹H NMR** → ~4 signals; the **CH₃ is ~2.4 ppm,
  3H, singlet**; aromatics ~7.1–7.2. A caveat block is visible.
- [ ] Switch to **¹³C NMR** → **137.8 / 129.2 / 128.4 / 125.6 / 20.7** (±1).
- [ ] Type `benzene`, **¹H** → exactly **one signal, 7.26, 6H, s** (a triplet here
  would be a bug).
- [ ] **J-coupling:** type `ethanol`, **¹H** → the mult. column reads **`t (7.0)`**
  for the CH₃ (3H) and **`q (7.0)`** for the CH₂ (2H); the OH is **`s (br)`**. The
  Karplus and first-order caveats are visible.
- [ ] **COSY (¹H–¹H, 2D)** with `ethanol` → one **CH₃ ↔ CH₂** correlation
  (`type = vicinal, J ≈ 7`); inserting the chart gives a **square 2D map** with a
  grey diagonal and a blue cross-peak, both axes δ increasing left/down.
- [ ] **HSQC (¹H–¹³C, 2D)** with `ethanol` → **two** cross-peaks (CH₃ and CH₂),
  OH absent; `carbon tetrachloride` → **no correlations** (no C–H). Every peak sits
  in a plausible δH/δC box.
- [ ] Switch to **IR** with `acetone` → strong **C=O ~1715**; then `ethyl acetate`
  → **~1740** (ester sits above ketone); then `acetophenone` → **~1690**, labelled
  *conjugated*.
- [ ] **UV-Vis** with `butane` → reports **no λmax / transparent** (it must NOT
  invent a number). Then `CC(=O)C=C(C)C` (mesityl oxide) → **239 nm** (215 + 24) with the
  increments listed and summing to the total.
- [ ] **MS fragmentation** with `toluene` → **91.0542 tropylium ranked high**
  (the real base peak); m/z 77 present but NOT high, and not called "tropylium".
- [ ] **Insert data table** → text lands with its caveat.
- [ ] **Insert spectrum chart** (¹H or IR) → image inserts; the **δ axis increases
  leftward** and the IR axis **decreases rightward** (spectroscopy convention).
- [ ] UV-Vis: the **chart button is disabled** (a single λmax is a number, not a
  spectrum) — this is intentional.

## 1d. Bio/Assay
- [ ] Pick **Michaelis–Menten**, accept the pre-filled example → Vmax/Km with
  ± standard errors and an R².
- [ ] Pick **Dose–response (4PL)** → IC50/EC50 and a fitted curve chart.
- [ ] **Insert** → results and chart land at the cursor.

## 1e. Peptide
- [ ] Type `AGCW` → 2D structure renders with formula and MW.
- [ ] Try three-letter form (`Ala-Gly-Cys`) → same behaviour.
- [ ] **Insert** → structure image lands.

## 1f. Stats
- [ ] **Descriptive** with the pre-filled data → mean/SD/median populate.
- [ ] **t-test (Welch)** → t, df, p.
- [ ] **Mann–Whitney U** → U and p (non-parametric path).
- [ ] **Uncertainty propagation** → value ± uncertainty with per-variable
  contributions.
- [ ] **Insert** → table lands at the cursor.

## 1g. Analyze  *(no-code numerical workbench)*
- [ ] **Solve A·x = b** with the pre-filled example → x is returned; insert makes
  a Word table.
- [ ] **Eigenvalues** on a non-symmetric matrix → complex pairs shown as a ± bi.
- [ ] **Minimize a function** (Rosenbrock default) → converges near (1, 1).
- [ ] **FFT / spectrum** → dominant frequency and a chart.
- [ ] **Data → insights** → paste a small table; correlations, trends and
  plain-language findings appear.
- [ ] **ODE — the default is now `y'' = -y`** with `y = 1, y' = 0`:
  - [ ] It solves **without hand-reduction** and the result line says
    *"Auto-reduced to a first-order system of 2 states: y, y'"*.
  - [ ] At t = 6.2832 (2π) the final **y ≈ 1.000000** (it is cos t).
- [ ] **ODE — stiff:** equations `A' = -1000*A + B` / `B' = 1000*A - B`, initials
  `A = 1, B = 0`, range `0, 10` → completes, and the result line says
  **auto-switched to the implicit stiff solver**.
- [ ] **ODE — report-at times:** with `y' = -y`, `y = 1`, range `0, 5`, set
  **Report at times** to `0:1:5` → the table has exactly 6 rows and
  **y(5) = 0.006738** (e⁻⁵). The plot is still a smooth curve, not 6 points.
- [ ] **ODE — stop condition:** equations `z'' = -9.81`, initials `z = 0, z' = 20`,
  range `0, 10`, **Stop when** `z` → result reports
  **"z reached zero at t = 4.077472"** with z′ = −20, and the plotted curve
  **ends at the ground** (no underground tail).
- [ ] **ODE — condition never met:** same but **Stop when** `z - 1000` → a clear
  message that it never reached zero (not a silent full-range solve).
- [ ] **ODE — bad input:** delete the `y'` initial value → the error names it:
  *"Missing an initial value for y'. A system of order 2 needs 2…"*.

## 2. Math
- [ ] Type `x^2 + y^2` with **native Word equation** ticked → **Insert** creates a
  real Word equation (click it → Equation Tools appear).
- [ ] Tick **Number this equation** → inserts with a right-aligned `(I)`.
- [ ] **Formula library** → pick *Finance — valuation & options → Black–Scholes call* →
  inserts the typeset equation.
- [ ] **Import / export LaTeX:** paste `\frac{-b \pm \sqrt{b^2-4ac}}{2a}` →
  **Convert** → preview shows the quadratic formula → **Insert**.
- [ ] **Copy current as LaTeX** with that formula in the box → clipboard has LaTeX.
- [ ] Type `align(x = 1; y = 2)` → **Insert** → a stacked two-line equation.

## 2b. Solve  *(v1.84 — equations, calculus, word problems; offline)*
> Exact where it can be, numeric where it must be; every screen states its method
> and caveats. A fabricated root or a guessed word-problem answer is a FAIL.
- [ ] **Solve an equation** with `x^2 - 5x + 6 = 0` → **x = 3** and **x = 2**, method
  *exact (quadratic)*.
- [ ] `x^2 + 1 = 0` → two **complex** roots (`0 + 1i`, `0 − 1i`) with a caveat — NOT
  "no solution", and never faked as real.
- [ ] **All roots (cubic):** `x^3 - 1 = 0` → **three** roots — `1` and `-0.5 ± 0.866i`,
  method *complete (all roots)*. `x^4 - 1 = 0` → `1, -1, i, -i`. Repeated roots show ×2/×3.
- [ ] `x + 1 = x + 2` → **No solution**; `2*(x+1) = 2*x+2` → **identity**.
- [ ] **Inequalities (v2.15.0).** In the **Solve an equation** kind, type a comparison.
  - `x^2 - 4 > 0` -> (-inf, -2) U (2, inf).
  - `1/x < 1` -> (-inf, 0) U (1, inf). If it returns only (1, inf) the negative branch has been
    lost, which is the classic error this is built to avoid.
  - `(x-1)/(x+2) >= 0` -> (-inf, -2) U [1, inf). The -2 endpoint must be OPEN (it is a pole)
    while 1 is CLOSED.
  - `x^3 + x + 1 > 0` -> starts near -0.682, NOT the whole line.
  - `sin(x) > 0` -> refused with an explanation, not a guess.
- [ ] **Limits and series (v2.14.0).** In the **Differentiate** kind.
  - `limit sin(x)/x as x -> 0` -> 1, and the working mentions L'Hopital.
  - `limit abs(x)/x as x -> 0` -> must say the limit DOES NOT EXIST. If it reports 1, that is
    a serious bug.
  - `limit abs(x)/x as x -> 0+` -> 1; `... as x -> 0-` -> -1.
  - `lim 1/x as x -> inf` -> 0. `lim 1/x as x -> 0+` -> diverges to +inf.
  - `taylor exp(x) order 5` -> 1 + x + 1/2*x^2 + 1/6*x^3 + 1/24*x^4, as FRACTIONS not decimals,
    with an O(x^6) term shown.
  - `maclaurin sin(x)` -> only odd powers, alternating signs.
- [ ] **Systems of equations (v2.13.0).** In the **Solve an equation** kind, type MORE THAN
  ONE equation, one per line.
  - `x + y = 3` / `x - y = 1` -> x = 2, y = 1, method says UNIQUE.
  - `x/3 + y/7 = 1` / `x/3 - y/7 = 0` -> x = 3/2, y = 7/2 EXACTLY (fractions, not decimals).
  - `x + y = 1` / `x + y = 2` -> No solution, and it says the equations contradict each other.
    It must NOT report numbers.
  - `x + y = 3` / `2*x + 2*y = 6` -> INFINITELY many, with `x = 3 - y` and `y is free`.
    It must NOT pick one arbitrary point.
  - `x^2 + y^2 = 25` / `x + y = 7` -> two solutions, (3,4) and (4,3), flagged numeric.
- [ ] **Rearrange (v2.5.0 CAS):** `F = m*a` → "more than one unknown" message with
  **Solve for: F · m · a** chips. Click **a** → **a = F/m**, method
  *exact (symbolic rearrangement)*, caveat **requires m ≠ 0**. Click **m** → `m = F/a`.
  Edit the equation → the chips reset.
- [ ] **Rearrange (quadratic):** `s = u*t + a*t^2/2`, chip **t** → two ± roots with the
  discriminant condition stated. Insert lands both.
- [ ] **Differentiate** `sin(x^2)` → **`2*x*cos(x^2)`** (conventional factor order).
- [ ] **Differentiate (v2.5.0 readability)** `sin(x)*cos(x)` → **`cos(x)^2 - sin(x)^2`** —
  collected, no `+ -` artifacts.
- [ ] **Symbolic integration (v2.6.0).** Integrand `x*exp(x)`, limits 0 to 1 → **1**,
  method *exact (symbolic)*, and it shows **F(x) = x·eˣ − eˣ + C**. Try `1/(x^2+4)`
  0→2 (= π/8, atan form), `ln(x)` 1→e (= 1), `1/(x*(x+1))` 1→2. Each must say EXACT.
- [ ] **Integration refuses honestly.** `exp(x^2)` 0→1 → falls back to *adaptive Simpson*
  with the approximation caveat — it must NOT claim exact.
- [ ] **Geometry (v2.7.0).** Switch the dropdown to **Geometry**.
  - `triangle 3 4 5` -> area **6**, angle C = **90 deg**, method SSS.
  - `triangle a=6 b=8 A=30` -> **TWO** solutions listed, with the ambiguous-case caveat.
  - `triangle a=2 b=8 A=30` -> refused, saying the side is shorter than the altitude.
  - `circle r=3` -> area shown as **9*pi** (exact) with the decimal beside it.
  - `triangle (0,0) (4,0) (0,3)` -> area 6 exactly, plus centroid / circumcentre /
    orthocentre, and the line **"Euler line check: ... verified exactly"**.
  - `x^2/9 + y^2/4 = 1` -> **ellipse**, a = 3, b = 2, eccentricity ~ 0.745, foci listed.
  - `x^2 + y^2 = 0` -> reported as a **point** and flagged DEGENERATE, not as a circle.
  - `x*y = 1` -> **hyperbola**, with a 45 deg rotation reported.
- [ ] **Knots (v2.12.0).** Still the **Topology (homology)** kind.
  - `knot trefoil` -> V(t) = -t^-4 + t^-3 + t^-1, 1 component.
  - `knot trefoil-mirror` -> t + t^3 - t^4. The two MUST differ — that is the polynomial
    detecting chirality, which homology cannot.
  - `braid 1 -2 1 -2` (figure-eight) -> t^-2 - t^-1 + 1 - t + t^2, and it must read the same
    forwards and backwards (amphichiral knots have palindromic Jones polynomials).
  - `knot hopf-link` -> 2 components, with HALF-integer powers of t.
  - `pi1 trefoil` -> a Wirtinger presentation, H_1 = Z, and the plain statement that the
    group is NOT identified because the word problem is undecidable.
  - A braid with 25 crossings -> refused, saying a truncated state sum would be wrong rather
    than incomplete. It must NOT hang.
- [ ] **Advanced topology (v2.11.0).** Still the **Topology (homology)** kind.
  - `w(RP^5)` -> Stiefel-Whitney class, and the working says whether it obstructs
    parallelisability. `w(RP^3)` -> trivial, with the honest note that this does NOT prove
    parallelisability.
  - `chern CP^3` -> c(T CP^3) with top class 4 = chi(CP^3).
  - `does RP^5 bound` -> BOUNDS (5 is odd). `cobordism RP^2` -> does NOT bound.
  - `cellular rp2` -> H_1 = Z/2 from only 3 cells; compare `projective plane` which gives the
    same answer from the simplicial route.
  - `fundamental group`, `homeomorphism` -> each must EXPLAIN what is and is not computable
    and why. If either ever returns a confident numeric answer, that is a serious bug.
  - `cobordism` on its own -> must ASK for a manifold, not return nothing.
- [ ] **Alexander polynomial and K-theory (v2.16.0).** Still the **Topology (homology)** kind.
  - `alexander trefoil` -> **Delta(t) = 1 - t + t^2**, knot determinant **3**, and the working
    reports the Delta(t) = Delta(1/t) symmetry check having PASSED.
    This one matters: through v2.16.0 it answered with the JONES polynomial instead.
    If you see `V(t) = ...` here, the routing has regressed.
  - `alexander figure-8` -> 1 - 3t + t^2, determinant 5.
  - `jones trefoil` -> still V(t) = -t^-4 + t^-3 + t^-1. The two commands must give
    DIFFERENT answers.
  - `k-theory S^2` -> K^0 = Z + Z, K^1 = 0, reduced K^0 = Z, and the working must name
    **Bott periodicity** rather than reading a table.
  - `k-theory CP^3` -> K^0 = Z^4, K^1 = 0, explained by the absence of odd cells.
- [ ] **Spectral sequences and stable homotopy (v2.17.0).** Still the **Topology (homology)**
  kind. The whole point of this section is what is REFUSED.
  - `serre s2 s1` -> an E_2 grid with q increasing UPWARD, and **one differential marked
    UNDETERMINED**. It must NOT report H*(E). If it ever does, that is the most serious bug
    this tool can have: the Hopf fibration and the trivial bundle share this exact page and
    have different answers.
  - `serre s2 s3` -> **COLLAPSES**, and the working must say the collapse was PROVED (no
    differential has both ends nonzero), not assumed. The abutment is labelled the
    **associated graded**, with the extension problem named.
  - `spectral sequence of s2 s1` and `fibration s2 s1` -> the same answer as `serre s2 s1`;
    the filler words must not change the reading.
  - `serre nonsense s1` -> says those spaces are not in the table and lists the ones that are.
  - `stable pi_3` -> **pi_3^s = Z/24**, labelled a **LOOKUP from a published table**, naming
    Hatcher and Toda, and warning against extrapolating.
  - `stable homotopy 7` -> Z/240. `stable pi_4` -> 0.
  - `stable homotopy 99` -> **"not tabulated here"**. It must NOT invent a group or continue
    the pattern.
  - `pi1 trefoil` -> still the **Wirtinger presentation**, NOT the stable stem pi_1^s. These
    two collided before shipping.
  - `homology of the torus` -> Z, Z^2, Z. Phrasing it as a question must work as well as
    typing `torus` alone.
- [ ] **Measured spectra — JCAMP-DX (v2.19.0).** Open **Spectra**. Below the predicted
  tools there is now a rule and an **"Open a .jdx / .dx file…"** button. This reader had
  been complete but unreachable for several releases, so it has never had a real pass.
  - Open a genuine `.jdx`/`.dx` file from an instrument. The readout must name the title
    and data type, the point count, the x range, and say **"This is your measured data —
    nothing here is predicted."**
  - The chart title must say **measured**, and must NOT say predicted or estimate.
  - **Axis direction:** an IR or Raman file must show wavenumber **decreasing** rightward;
    UV-Vis and MS increase rightward. A mirrored spectrum is the failure to look for —
    it looks perfectly plausible.
  - **Insert data table** and **Insert spectrum chart** must both work. On a large file
    the table says how many of the original points it wrote.
  - Try a text file that is not JCAMP: it must say so, not draw an empty frame.
- [ ] **BVP / PDE / DAE (v2.19.0).** Open **Analyze**; five new calculators.
  - **Boundary value problem.** Defaults are y'' = -y on [0, π/2] with y = 0, 1 — the
    answer is sin x, so y near the midpoint must be about 0.707. The result must report an
    **observed convergence order near 2** and carry the caveat that a BVP may have no
    solution, one, or infinitely many.
  - Switch Method to **Shooting**: the curve must come out the same.
  - **PDE - heat.** With the defaults the peak must **shrink** steadily and both ends stay
    at 0. Now switch the scheme to **Explicit FTCS**: it must either report that Δt was
    **REDUCED** for stability, or refuse and name Crank-Nicolson. It must NOT return huge
    oscillating values.
  - **PDE - wave.** With the defaults the amplitude must **not** decay — a wave preserves
    it, unlike heat — and at t = 2 the string should be back to its starting shape.
  - **PDE - Laplace.** The slices must be smooth, and the interior must stay within the
    boundary values (the maximum principle).
  - **DAE.** Defaults are y' = -z with 0 = z - y, so y = e^-t and z tracks y.
    *Superseded in v2.138.0 (see §0ce):* the second field is now optional **guesses** for the
    algebraic unknowns, so `z = 5` is reported as a starting guess and the consistent z₀ is
    solved, not "INCONSISTENT"; and the Cartesian pendulum is now **solved** (index 3), not
    refused. The v2.19.0 checks below are kept as history only.
  - ~~**The refusal that matters:** enter the Cartesian pendulum … It must **refuse**, say the
    system is **not index 1**.~~ Replaced by the §0ce pendulum check.
- [ ] **The numerics cannot freeze the pane (v2.20.0).** The v2.19.0 solvers shipped with
  three bugs that the adversarial pass caught only afterwards. Worth confirming in Word:
  - **Analyze -> PDE - Laplace/Poisson.** Set **Intervals each way** to a huge number
    (e.g. 999999999). It must come back within a few seconds, having clamped the grid.
    Before v2.20.0 the equivalent call ran for 91 seconds with the pane frozen solid.
  - Now set that field to nonsense (`abc`), or clear it. It must fall back to a SMALL
    default, NOT to the largest grid, and must not show an error.
  - **Any of the five new calculators**, with a formula that only fails part way along —
    for the BVP, set the right-hand side to `1/(x-0.5)`, or use a function name that does
    not exist. It must report the equation as the problem. An unhandled error, or a
    frozen pane, is a regression.
- [ ] **Nothing freezes Word (v2.18.0).** The whole-library sweep found seven loops that
  never returned on a non-finite count. A frozen pane has no error and no way back, so
  these are worth a real pass:
  - **Finance -> Loan amortization.** Set **Years** to `1e400` (or paste a very long run
    of 9s). It must come back with a message. Before v2.19.0 this hung Word outright.
    Then set Years to `30`, payments/year `12`, and confirm you still get 360 rows.
  - **Finance -> Declining balance.** Same test on **Life**.
  - **Plot** with **Log scale** on data containing a colossal value (`1 1`, `2 1e308`).
    It must draw or decline — never hang.
  - **Solve.** Type `1e999 = 0`. It must say the literal is too large to represent,
    NOT "Reduced to -Infinity = 0". `x - 1e300 = 0` must still solve normally.
- [ ] **Persistent homology (v2.10.0).** In the **Topology (homology)** kind, PASTE a point
  cloud instead of a name — one point per line. A rough circle, e.g.:
  `1 0` / `0.7 0.7` / `0 1` / `-0.7 0.7` / `-1 0` / `-0.7 -0.7` / `0 -1` / `0.7 -0.7`
  - It must report a **most persistent H1 feature** with a clear lifetime, and draw a
    **barcode** in the pane.
  - Replace it with a random blob of 8 points: the long H1 bar must DISAPPEAR. That contrast
    is the whole feature — if a blob shows the same bar as a ring, something is wrong.
  - **Insert** it: the text lands AND the barcode arrives as a picture. Ctrl/Cmd+Z undoes.
  - Paste ~150 points: it must still respond, and say plainly that a cap was hit.
- [ ] **3D geometry (v2.9.0).** Still in the **Geometry** kind — triples switch it to 3D.
  - `vector (1,0,0) (0,1,0)` -> dot 0, cross (0,0,1), angle 90 deg, and the working says
    PERPENDICULAR.
  - `lines (0,0,0) (1,0,0) (0,0,1) (1,1,2)` -> **skew**, distance `sqrt(2)/2`.
  - `lines (0,0,0) (1,0,0) (2,-1,0) (2,1,0)` -> **intersecting** at (2,0,0), not skew.
  - `lines (0,0,0) (1,0,0) (0,3,0) (1,3,0)` -> **parallel**, distance 3.
  - `(0,0,0) (1,0,0) (0,1,0) (0,0,1)` -> tetrahedron volume **1/6** plus the sphere centre.
  - `(0,0,0) (1,0,0) (0,1,0) (1,1,0)` -> refused as **COPLANAR**: no volume, no unique sphere.
  - `(0,0,0) (1,1,1) (2,2,2)` -> refused as **COLLINEAR**: no plane.
  - `circle r=1/3` -> area **1/9*pi** exactly, and `box 1/2 1/3 1/4` -> volume **1/24**.
    (Typed fractions must stay exact — no long decimals or giant fractions anywhere.)
- [ ] **Journal-grade figures: figure styles, vector-insert probe, significance brackets, panels (v2.143.0).** Plot, Table → Chart, Statistics, Finance, Bio/Assay — see §0cj.
  - Probes A/B/C recorded on Windows, Mac and web (SVG via insertInlinePictureFromBase64; insertOoxml svgBlip + PNG fallback; XmlSvg inline, sized, imageFormat Svg, imageWidth units); As drawn unchanged; Nature 8.9 cm with 5–7 pt text; USPTO 17.0 cm, no title, ≥ 3.2 mm numerals, heat map refused; t-test/Tukey/Dunn brackets with the engine's p and the caption; Nature a/b and USPTO FIG. 1A/1B panels.
- [ ] **Citation styles, BibTeX/RIS import and numbered bibliographies (v2.142.0).** Citations (Bibliography panel) — see §0ci.
  - Kwon BibTeX → "Added (1): Kwon_2022"; DOI paste → https://doi.org/10.1086/720277 + the offline line, no record; 7 styles, Harvard/MLA one-line note; a book under Nature refused by name; move [3] first → Update → [1], [2], [3] in the new order, a second Update changes nothing; delete + Undo restores the numbering; 64-char tag and 1.9 MB store probes recorded.
- [ ] **Table of Authorities and Bluebook fixes (v2.141.0).** Citations (Table of Authorities, Bluebook form) — see §0ch.
  - Doe v. Roe lists only its own page beside 110 F.3d 512; Alice never gets the pages of `said.`/`paid.`/`valid.`; `Int’l` + `Int'l` = one row with both pages; building twice changes no page list; `35 U.S.C. §§ 102, 103` keeps § 103; `US10123456B2` → U.S. Patent No. 10,123,456; → Short form gives Alvarez, 567 U.S. at 715.
- [ ] **Audio, video and light: levels, loudness, timecode, transfer curves, photometry and exposure (v2.140.0).** Engineering (Audio & acoustics, Video & display, Light & camera) — see §0cg.
  - +4 dBu → −14.0000 dBFS (EBU R68) with a level ladder; −16.3 → −23 LUFS = −6.70 dB; 997 Hz sine → −3.0103 LUFS; `00:01:00;00` at 29.97 DF refused (next label 00:01:00;02); 1080p60 link 2.97 Gbit/s; f/8 → f/11 = 1 stop exactly; 147 of 147 tools draw.
- [ ] **Spectroscopy: JCAMP overlay, exact isotope patterns, diastereotopic NMR, and Woodward–Fieser fixes (v2.139.0).** Spectra, Mass Spec — see §0cf.
  - `CC(C)CO` ¹H vs `2Methyl1Propanol.jdx` → 4 of 4 within window; `BRUKPAC.DX` ¹³C → "Not assessed … +9.09 ppm" until `86.25 = 77.16`, then 6 of 6; `ibuprofen` ¹H → CH₂ "m (²J 14–18 Hz)" with a note; `C2Cl4` → base peak M+2 165.8725 and an isotope chart; ferrocene → M−2 (never M+-2); `cinnamaldehyde` UV → refused by name.
- [ ] **DAE index reduction, real K-theory, oriented cobordism, and persistence over 𝔽ₚ (v2.138.0).** Analyze, Solve (Topology) — see §0ce.
  - Cartesian pendulum as typed → Index 3, hidden constraint u·x + v·y = 0, drift lines, x(10) ≈ 0.275087; initial values reordered → identical table; `KO of RP^9` → ℤ/32; `does rp^2 # rp^2 bound` → BOUNDS; `klein bottle` → `H₁ = ℤ ⊕ ℤ/2`; `compare` above a ring → two stacked barcodes, inserted at 460 × 600.
- [ ] **Reaction balancing, stoichiometry, genetic codes, peptides, and formula fixes (v2.137.0).** Solve, Reaction, Bio/Assay, DNA, Sequence, Peptide, Chemical, Mass Spec — see §0cd.
  - `Fe + O2 -> Fe2O3` → `4 Fe + 3 O₂ → 2 Fe₂O₃` in Solve and in Reaction (Formulas); `C + O2 -> CO + CO2` refused with both reactions; stoichiometry default → O₂ limiting, 11.3 g H₂O; `ATGAGATGATGGTAA` table 2 → `M*WW*`; `cyclo(GRGDSP)` → 569.2558 Da; `Co` in Mass Spec → 58.9332.
- [ ] **Exact cubic and quartic roots, multivariate simplification, radius of convergence, and leftovers (v2.136.0).** Solve — see §0cc.
  - `x^3 - 3x + 1 = 0` → `2*cos(2*pi/9)`, `2*cos(4*pi/9)`, `2*cos(8*pi/9)`, typeset; `simplify (x^2 - y^2)/(x - y)` → `x + y`, the factor named; `radius of convergence of 1/(x^2 + 4) about 1` → `R = sqrt(5)` with the disc; `find the roots of x^3 - 7x + 6` → 2, 1, −3.
- [ ] **Abstract algebra: groups, permutations, rings and finite fields (v2.135.0).** Solve — see §0cb.
  - `Z/6` → cyclic, generators 1, 5, table drawn; `(1 2 3)(1 2)` → `(1 3)` (right to left); `factor x^4 + x^2 + 1 over F_2` → `(x^2 + x + 1)^2`; typed in the Equation kind each switches with the ABSTRACT ALGEBRA note.
- [ ] **Statistics: exact rank tests, repeated-measures ANOVA, Cox regression, and table-reading fixes (v2.134.0).** Stats — see §0ca.
  - Mann–Whitney `1, 2, 3` v `4, 5, 6` → `p = 1/10 = 0.100000 … exact`; RM ANOVA default → GG `F(1.60, 11.19) = 3.794, p = 0.0626`; Cox default → `HR = 4.817 (95% CI 2.147 to 10.81)` with a log-axis forest plot.
- [ ] **Computation theory: grammars, machines, first-order logic, SAT, Hindley–Milner (v2.133.0).** Solve — see §0bz.
- [ ] **Linear programming, interpolation and splines (v2.132.0).** Solve — see §0by.
- [ ] **Probability and Markov chains (v2.131.0).** Solve — see §0bx.
  - `binomial n=10 p=0.4 P(X <= 3)` → 3733209/9765625, exact, pmf drawn.
  - `markov [[0.9, 0.1], [0.5, 0.5]] stationary` → π = (5/6, 1/6), state diagram drawn.
- [ ] **Multivariable calculus (v2.130.0).** Solve — see §0bw.
  - `critical points x^3 - 3x + y^2` → (1, 0) local minimum, (−1, 0) saddle point, exact.
  - `lagrange x y subject to x^2 + y^2 = 1` → ±1/2 at (±sqrt(2)/2, ±sqrt(2)/2), max and min declared.
- [ ] **Laplace transforms, initial-value problems and Fourier series (v2.129.0).** Solve — see §0bv.
  - `laplace t^2 exp(3t)` → 2/(s − 3)³ for s > 3; `inverse laplace 1/(s*(s+1))` → 1 − e^{−t}.
  - ODE kind with y(0), y'(0) → the single solution, verified, drawn.
  - `fourier series t^2 on (-pi, pi)` → a₀/2 = π²/3, aₙ = 4(−1)ⁿ/n², exact.
- [ ] **Every statistics calculator reads the table at the cursor; power & sample size (v2.128.0).** Stats — see §0bu.
  - Any groups-style calculator fills from a Word table (one column per group, or label + value rows) and the status line says how it read it.
  - Power & sample size: d = 0.5 two-sample → n = 64 per group; the power curve inserts.
- [ ] **Offline delivery (v2.127.0).** Any mode — see §0bt for the full pass.
  - Online: the line under the title settles on **Offline-ready · v2.127.0** (green dot).
  - Network off, Word restarted: the pane opens and computes; both pop-out canvases open.
  - Mac: record whether the line reads Offline-ready or "depends on this Word's cache".
- [ ] **Complex numbers, partial fractions, parametric systems (v2.126.0).** Solve, Equation kind.
  - `(2+3i)(1-i)` -> **5 + i** with the "Verified: floating-point evaluation of the original" line (it must NOT
    solve for i). `(3+4i)/(1-2i)` -> −1 + 2i; `(1+i)^8` -> 16; `abs(3+4i)` -> 5; `arg(1+i)` -> π/4;
    `sqrt(-4)` -> 2i; `1/(2+i)` -> 2/5 − (1/5)i; `abs(1+i)` -> √(2) ≈ 1.414. Insert: the result lands as a real equation and reads back.
  - `sqrt(1+i)` -> labelled **NUMERIC** (≈ 1.0986841 + 0.4550899i), not "exact".
  - `z^2 = 2i` -> z = 1 + i and z = −1 − i, each "substituted back"; `z^3 = i` -> three numeric roots.
    `x^2 = -1` (no i typed) still goes to the ordinary solver and gives ±i as before.
  - `partial fractions 1/(x^2-1)` -> 1/2/(x - 1) - 1/2/(x + 1) with the factored denominator and the
    "recombined to confirm" step; `partial fractions 1/(x*(x+1)^2)` -> 1/x - 1/(x + 1) - 1/(x + 1)^2;
    `partial fractions x^3/(x^2+1)` -> x - x/(x^2 + 1); `partial fractions 1/(x^4+4)` -> two quadratic terms
    (x^2 - 2x + 2 and x^2 + 2x + 2); `partial fractions 1/(x^4+1)` -> REFUSED, "irreducible over ℚ".
  - `(z - i)^3 = 0` -> ONE line z ≈ i with "multiplicity 3"; `i^2 = -1` -> TRUE; `ln(-1)` -> ≈ 3.141592654i
    (positive); `sinh(i)` -> refused by name, not an error.
  - Two lines `a x + y = 1` ⏎ `x - y = 2` -> heading "Solved for every value of the parameter a",
    x = 3/(a + 1), y = (−2a + 1)/(a + 1) for a ∉ {−1}, and the line "a = −1: NO solution". Two lines
    `x + a y = 1` ⏎ `a x + y = 1` -> x = y = 1/(a + 1) generically, a = 1: infinitely many (free variable
    named), a = −1: no solution. Two extra letters (`a x + b y = 1` ⏎ `x - y = 2`) -> NOT parametric: the
    ordinary message that 2 equations in 4 unknowns cannot be solved.

- [ ] **Hamiltonian certificates and lazy λ (v2.125.0).**
  - Discrete math: `hamiltonian` over a 20-vertex PATH list (v0-v1 … v18-v19) -> cycle **NONE — proof:
    v0 has degree 1**, path **yes** with the path drawn. Over a 20-vertex star -> both NONE with proofs.
  - A 3-hub / 5-triangle list (hubs h1 h2 h3; each triangle vertex joined to every hub) -> cycle NONE,
    proof "removing h1, h2, h3 leaves 5 components". With 4 hubs and 6 triangles -> "NOT FOUND within the
    budget … NOT a proof". Both return in under a second.
  - λ-calculus: `PLUS 2 3` now shows a **δ** line first (`PLUS → λm.λn.λf.λx.…`) then the β-steps;
    `let rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))` then `FACT 5` -> **Church numeral 120**
    with the line "Found by normalisation by evaluation"; `FACT 6` -> 720; `2 2 2 2` -> "= Church numeral
    65,536 — read out …" with the print cap named; `Y f` -> "No normal form found" (it must NOT claim one
    exists). Each returns in well under a second.

- [ ] **Discrete math (v2.124.0).** Switch the dropdown to **Discrete math**. One box, six engines.
  - `gcd 84 36` -> **12**, the Euclid lines (84 = 2 × 36 + 12 …) and `Bézout: 84 × (1) + 36 × (−2) = 12`.
  - `7^100 mod 13` -> **7¹⁰⁰ ≡ 9 (mod 13)** plus the Fermat line; `inverse 6 mod 9` -> refused, naming gcd 3.
  - `x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7` -> **x ≡ 23 (mod 105)** and "Verified".
  - `factor 360` -> 2³ × 3² × 5, τ = 24, σ = 1,170, φ = 96. `is 561 prime` -> composite, 561 = 3 × 187.
  - `10 choose 3` -> 120 with the formula substituted; `arrangements of MISSISSIPPI` -> 34,650;
    `how many ways to choose 3 of 10 people` -> 120 and the sentence naming it a combination;
    `arrange 5 books so that no two are adjacent` -> REFUSED, quoting the condition word.
  - `a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1` -> Binet in ℚ(√5), first terms 0, 1, 1, 2, 3, 5, 8 …, and
    "Verified: the closed form reproduces a(0) … a(15) from direct iteration exactly".
  - `T(n) = 2T(n/2) + n` -> **Case 2 … Θ(n log n)**.
  - `(p -> q) & ~q -> ~p` -> TAUTOLOGY with the 4-row table; `p -> q, q |= p` -> INVALID,
    "Counterexample: p = F, q = T". `simplify a & b | a & ~b` -> a.
  - `regex (a|b)*abb` + a `test: abb aabb ab` line -> the DFA is DRAWN (double circle on the accept
    state), abb and aabb ACCEPT, ab REJECT. Insert: the diagram lands in the document.
  - `shortest path A to F` over the Dijkstra edge list from the palette -> length **11** (A-C-F),
    the graph DRAWN with the path highlighted. `mst` over the CLRS list -> total **37**.
  - `hamiltonian` over a 17-vertex cycle list -> the cycle is exhibited and called a proof; the
    first working line says 17 is above the exhaustive range (16). Nothing may hang.
- [ ] **λ-calculus extras (v2.124.0).** Still the **λ-calculus (reduction)** kind.
  - `eta λx.λy.g x y` -> βη-normal form **g**, two η-steps listed.
  - `ski λf.λx.f (f x)` -> **S (S (K S) K) I** and the "Verified: applied to 2 fresh variables" line.
  - `cl S K K x` -> x in 2 combinator steps, with the rule table in the caveats.
  - `SUM [1, 2, 3]` -> Church numeral 6; `MAP SUCC [1, 2]` -> = list [2, 3].
  - `let rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))` then `FACT 3` -> 6, verified.

- [ ] **λ-calculus (v2.123.0).** Switch the dropdown to **λ-calculus (reduction)**.
  - `(λx.λy.x) y` -> an **α** line (y renamed to y₁ to avoid capture) then one β-step; normal
    form **λy₁.y** — it must NOT say λy.y. Insert: the λ and the subscript arrive intact.
  - `PLUS 2 3` -> normal form λf.λx.f (f (f (f (f x)))), **= Church numeral 5**, and the line
    "Verified: an independent environment-based evaluator also gives 5". Type (α → α) → α → α.
  - `K I OMEGA` -> **λx.x**. `applicative K I OMEGA` -> **DIVERGES** (cycle of length 1) AND the
    sentence saying normal order does terminate, giving λx.x. Neither may hang.
  - `OMEGA` -> DIVERGES after 1 β-step. `Y f` -> "No normal form found: no normal form within
    1000 β-steps" with the caveat that the cap is not a theorem. Both return in under a second.
  - `2 2 2 2` -> refused by a cap ("no normal form within 1000 β-steps"), returning at once;
    `(λx.x x x x x x x x) (λx.x x x x x x x x)` -> the size cap ("grew past 8000 nodes").
  - `type λf.λx.f (f x)` -> **(α → α) → α → α**; `type λx.x x` -> not simply typable.
  - Line 1 `let TWICE = λf.λx.f (f x)`, line 2 `TWICE SUCC 0` -> Church numeral 2.
  - `λx.xx` -> a note saying "xx" was read as x x; `(λx.x` -> a syntax error naming the missing ")".
  - The palette shows Symbols (λ) and the Reduction / Church encodings / Questions templates;
    every template button produces an answer, never "Could not solve".

- [ ] **Topology / homology (v2.8.0).** Switch the dropdown to **Topology (homology)**.
  - `torus` -> H_0 = Z, H_1 = Z^2, H_2 = Z; Betti 1, 2, 1; chi = 0.
  - `sphere` -> H_0 = Z, H_1 = 0, H_2 = Z; chi = 2.
  - `projective plane` -> **H_1 = Z/2** (TORSION) and a caveat saying a field
    coefficient would have discarded it. chi = 1.
  - `Klein bottle` -> H_1 = **Z + Z/2**, H_2 = 0, chi = 0.
  - `circle` -> Z, Z. `figure eight` -> beta_1 = 2. `Mobius band` -> Z, Z.
  - Type your own: `[0,1,2] [0,1,3] [0,2,3] [1,2,3]` (tetrahedron boundary) -> S^2.
  - Every result must print **both** Euler characteristic lines and the sentence
    saying the two agree. If it ever says the check FAILED, that is a real bug.
- [ ] **Geometry inserts.** Insert a geometry result — the exact forms (9*pi, 2*sqrt(3))
  must arrive as real editable equations, with the working alongside.
- [ ] **Insert is a REAL equation now (v2.6.0).** With any Solve result on screen press
  **Insert**. What lands must be an **editable Word equation** — click it and Word shows
  the equation toolbar; a fraction like F/m is drawn as a fraction, and an integral shows
  a real ∫ with its limits. It must NOT be flat text. Ctrl/⌘+Z removes it in one step.
- [ ] **Superscripts:** paste/type `x² - 5x + 6 = 0` → same result as `x^2…` (x = 3, 2). The
  hint under the box reminds you to use `^` for powers.
- [ ] **Definite integral (exact):** `x^2` from `0` to `3` → **9**, method *exact (symbolic)*,
  and it shows **F(x) = x^3/3 + C**. `exp(x^2)` → falls back to numeric (adaptive Simpson).
- [ ] **Word problem** `12 is what percent of 48?` → **25%**; `twice a number plus 7 is 15`
  → shows the equation `2*n + 7 = 15` and **n = 4**.
- [ ] **Word problem** with free-form phrasing it can't template (e.g. a two-trains
  puzzle) → it says it can't parse and points to the AI option — it does NOT invent
  an answer.
- [ ] **Insert result** → the solution text lands at the cursor.

## 3. Units
- [ ] Type `9.81 m/s^2` → preview **9.81 m/s²** → **Insert quantity**.
- [ ] Type `5.0 +- 0.2 kg` → **5.0 ± 0.2 kg**.
- [ ] Convert `36` `km/h` → `m/s` → result **10** → **Insert result**.
- [ ] Convert `100` `°C` → `°F` → **212**.
- [ ] Convert incompatible (`1 kg → m`) → shows "can't convert".

## 4. Plot
- [ ] Function `sin(x)/x ; cos(x)`, x from `-10` to `10` → preview shows **two
  curves with a legend** → **Insert plot** (image inserts).
- [ ] **LEGEND OUTSIDE (v2.82.1).** In that same preview and in the inserted
  image, the legend box sits **to the right of the plot frame**, covering no
  part of either curve — and the inserted plot is NOT squashed: the plot frame
  is wider than it is tall, and a circle marker would read as a circle.
- [ ] Data box: `0 1` / `1 2 0.1` / `2 4` (one per line) → scatter with an error bar.
- [ ] Bad function (`sin(`) → shows an error hint, insert disabled.

## 4b. Table → Chart
- [ ] Put the cursor in a Word table of numbers (or use the pre-filled example) →
  **Refresh from selection** picks it up.
- [ ] Chart type **Column** → preview renders → **Insert** places the image.
- [ ] Switch to **Line** and **Scatter** → preview follows.
- [ ] Tick the **B&W / patent figure** option → preview loses colour (patent-safe).
- [ ] **Insert as editable PowerPoint** → a .pptx is produced/downloaded.

## 5. Finance
- [ ] Calculator **Loan payment**, defaults (200000, 5%, 30y, 12/yr) →
  **Payment = 1,073.64 per period** → **Insert result**.
- [ ] **Black–Scholes option**, defaults (Call, 100, 100, 1, 5%, 20%) → **Price = 10.45**.
- [ ] **Net present value**, defaults (10%, `-1000, 500, 500, 500`) → **NPV = 243.43**.
- [ ] **Internal rate of return**, same cash flows → **IRR = 23.34%**.
- [ ] Clear a numeric field → result shows "Enter all values", insert disabled.

## 6. Build
- [ ] **Draw tab:** draw a ring on the canvas → preview + formula update live below.
- [ ] **Clean structure** on a deliberately messy drawing (dragged-out bond angles)
  → layout straightens; formula/SMILES unchanged; one **undo** (editor toolbar)
  restores the hand-drawn layout. Status reads "Structure cleaned." and STAYS.
- [ ] Drag one atom on top of another → note under the canvas reads **Not
  compliant: Two atoms … drawn on top of each other** → **Clean structure**
  clears it.
- [ ] **Reset canvas** → canvas empties, Markush box unchecks; editor **undo**
  brings the drawing back.
- [ ] Input `atoms: C O O` / `bonds: 1=2 1=3` → structure of **CO₂**, Formula `CO2`.
- [ ] Add an R-group (e.g. `atoms: C N R1 …`), fill `R1 = methyl, ethyl`, choose
  **Table** → **Insert** adds the structure + an R-group legend table.
- [ ] **Substituent gallery:** `R1a = c1ccccc1` / `R1b = CC(=O)O` → **Insert** adds
  drawn substituents with labels.

## 7. Code
- [ ] Paste pseudocode (e.g. `if x then return y`), style **Algorithm** → keywords
  bold, line numbers, optional caption → **Insert block**.
- [ ] Style **Code listing** → verbatim monospace block.

## 8. Sequence (ST.26)
- [ ] Add a sequence, type **DNA**, residues `ATGCAAAGCTAA`, organism `Homo sapiens`.
- [ ] **Generate ST.26 XML** → XML appears; warnings reasonable.
- [ ] **Copy XML** / **Download .xml** work.
- [ ] **In-text reference:** SEQ ID NO `1` → **Insert reference** → inserts "SEQ ID NO: 1".

## 9. Botanical
- [ ] `Rosa × hybrida 'Peace'` → preview italicizes *Rosa* and *hybrida*, leaves
  `×` and `'Peace'` roman → **Insert name**.
- [ ] Traits: `Plant height: 1.2 m` / `Flower color: RHS 46A` → **Insert table**.

## 10. Numerals
- [ ] **+ Add numeral** → row appears with **10**; set element `housing`.
- [ ] **Insert** on the row → inserts **housing (10)** at the cursor.
- [ ] Add a couple more, then type `(12)`/`(14)` callouts into the document.
- [ ] **Scan document** → reports orphans/unused/gaps consistently with the table.
- [ ] **Insert List of Reference Numerals** → heading + sorted table.
- [ ] Close and reopen the document → the numeral table is still there (saved in the doc).

## 11. Refs
- [ ] Caption **Figure**, text `The device` → **Insert caption** → "Figure 1. The
  device"; the "next" counter advances to **Figure 2**.
- [ ] Cross-reference **Fig.** `1` → **Insert reference** → "Fig. 1".
- [ ] **Check captions** → consistent (no gaps/dupes); add a `Figure 3` caption to
  force a gap and re-check → flags missing **2**.
- [ ] Close/reopen the doc → caption counters persist.

## 12. DNA
- [ ] Input `ATGGCCAAGCTTGATTAA` → live readout: length, GC%, reverse complement,
  mRNA, and a protein translation.
- [ ] Change **Frame** (+1/+2/+3 and reverse) → protein updates.
- [ ] **Tools:** primer **Tm** and **protein MW/pI/GRAVY** readouts show.
- [ ] **Find restriction sites** on a sequence containing `GAATTC` → lists **EcoRI**
  at the correct position.
- [ ] **Find ORFs** → table of ORFs; **Insert ORF table** inserts it.
- [ ] **Insert** reverse complement / mRNA / protein each inserts text.

## 12b. Align (Needleman–Wunsch / Smith–Waterman)
New in v1.72.0. Nothing here has been seen in Word.
- [ ] Paste `MKTAYIAKQRQISFVKSHFSRQ` into **A** and `MKTAYIAKQRQVSFVKSHFARQ` into **B**
  → readout shows **Global (Needleman–Wunsch) · BLOSUM62**, a score, and
  **Identity 20/22 (90.9%)**.
- [ ] The alignment block shows both sequences with a `|` ruler between them, the
  `|` sitting **directly above** each identical residue.
- [ ] Switch **Mode** to **Local** → readout says Smith–Waterman; score is ≥ the
  global score.
- [ ] Paste two DNA sequences (`ATGCGTACGTAGCTAGCTAG` / `ATGCGTACGTTGCTAGCTAGCAT`)
  → **Sequence type** auto-detect reports **DNA +5/−4**, not BLOSUM62.
- [ ] **Insert alignment** → lands at the cursor **in a monospace font**. This is the
  thing to check hardest: if it inserts in Calibri the columns no longer line up and
  the figure is wrong, not just ugly.
- [ ] The inserted block carries the stats line and the caveats beneath it.
- [ ] **Ctrl-Z** removes the whole insert in one step.
- [ ] Align two unrelated proteins (`MKTAYIAKQRQISFVKSHFSRQ` vs
  `WWPPCCWWPPCCWWPPCCWWPP`) → a **twilight zone** caveat appears warning that below
  ~25% identity unrelated sequences still align convincingly.

## 13. Reaction
- [ ] `CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux` → preview shows reactants `+`
  reactants, an arrow with **H2SO4** above / **reflux** below, then the product →
  **Insert reaction scheme** (image).
- [ ] *(v2.120.0)* "Draw a component ⤢" → large canvas opens blank → draw a
  structure → "Use this drawing" → its SMILES lands AT THE CURSOR in the
  reaction box (spaces added as needed) and the preview updates. A drawn
  Z-alkene keeps its geometry in the scheme. An R-group drawing is refused
  by name (a genus is not a reagent). Draw METHANOL specifically → it lands
  as `smiles:CO` and the preview shows methanol, NOT carbon monoxide (the
  bare string "CO" is the formula table's CO — the prefix is the fix).
- [ ] Multi-step `A -> B -> C` (use real names/SMILES) → arrow between each stage.
- [ ] Charged SMILES `C[N+](C)(C)C >> X` → not split on the `+` inside brackets.

## 13b. Citations  *(legal — Bluebook)*
- [ ] **Case** form: fill the pre-filled example → preview shows a correctly
  formatted Bluebook cite → **Insert**.
- [ ] Switch style **Practitioner ↔ Academic** → the formatting changes
  accordingly.
- [ ] **Statute** and **Patent** forms → each previews and inserts.
- [ ] **Table of Authorities** → builds from the document's cites, grouped by
  category (Cases / Statutes / Other).
- [ ] **Table of Contents** → builds from the document's headings.

## 14. Audit
- [ ] With the document containing numerals, a `(99)` callout, `SEQ ID NO: 5`, and a
  `Fig. 7` reference that has **no** "Figure 7" caption → **Check this application**.
- [ ] Report sections appear: **Reference numerals, Sequences, Figures,
  Cross-references** — each flags the planted issues (orphan numeral, out-of-range
  SEQ ID, figure gap, dangling Fig. 7).
- [ ] A clean document → "✓ No issues found."

---

## Cross-cutting
- [ ] **Undo:** each insert is a clean single Ctrl-Z.
- [ ] **Home page:** every tile opens its tool; the Home tile returns to the grid.
- [ ] **Examples panel:** the "Examples & syntax" content changes with the mode.
- [ ] **Preferences persist:** toggle Numerals "Parenthesize callouts" and the DNA
  frame, reopen Word → choices remembered.
- [ ] **No network calls** during inserts (privacy-by-construction). The ONLY
  exception is the opt-in IUPAC name→structure lookup, which must prompt first.
- [ ] **Honesty surfaces are present:** Spectra shows its caveats, pKa is labelled
  a group estimate, and MS fragment "likelihood" is described as a ranking rather
  than an intensity. A missing caveat is a FAIL, not a cosmetic issue.
- [ ] **Update banner** (prod installs): with a newer `version.json` published, the
  pane surfaces the update notice.

## Sign-off
- Tester: ____________________  Date: __________  Build/commit: __________
- Result: ☐ All pass ☐ Pass with notes ☐ Blockers (list below)
