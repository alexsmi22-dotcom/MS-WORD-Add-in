# JurisLab — Chemistry demo script (about 10 minutes)

For showing JurisLab to clients who work in chemistry and organic chemistry. Every step below was walked in the
real pane before this script was written; re-run it after each chemistry release (docs/TEST-SCRIPT.md §0cz).

**Before the demo**
- Word open on a blank document, JurisLab open in the side pane, the latest version (the pane's footer).
- Keep the pane at a comfortable width (drag its left edge): about a third of the screen.
- Have one ChemDraw file ready (.cdxml or .cdx) — a non-confidential one.
- Close other heavy programs; Word with the large canvas open needs memory.

## 1. A drug from its name (Chemical) — 2 min
1. Tool ▸ **Chemical**. Type **ibuprofen**.
2. Point out: the structure, **C₁₃H₁₈O₂**, 206.28 g/mol, SMILES — worked out on the machine, nothing sent anywhere.
3. Scroll: **Properties** (cLogP, TPSA, H-bond donors/acceptors), **Lipinski / Veber**, the estimated **pKₐ** of the
   carboxylic acid. "About these estimates" holds the method notes (open it if asked how good the estimates are).
4. **Insert 2D structure** → it lands in Word at ChemDraw's size. **Insert properties** → the table as text.

## 2. Edit it like ChemDraw (Build ▸ Draw) — 2 min
1. Back in Chemical, **Edit in Draw**: ibuprofen opens in the drawing editor.
2. Change it: pick an element on the editor's toolbar (**F**), click a ring carbon → the formula and SMILES below
   update at once.
3. **Clean structure** tidies the layout (Ctrl+Z restores the hand layout).
4. **Insert 2D structure**. Show the **Size** choice: ChemDraw size, or **USPTO drawing sheet size** for a filing figure.

## 3. A ChemDraw file — 2 min
1. **Open ChemDraw file…**, pick the file: its structures appear as a list (those marked "page" carry polymer brackets, a counter-ion or a generic atom).
2. Click one → it opens in the editor, full size, editable. Change an atom; **Insert**.
3. (If asked) **Open the whole page as a drawing** puts the whole ChemDraw page — arrows, captions — on the page canvas,
   to insert as drawn.

## 4. A reaction scheme (Reaction) — 1 min
1. Tool ▸ **Reaction**. Type: `ethanol + acetic acid >> ethyl acetate + water ; H2SO4 ; reflux`
2. The scheme draws itself, conditions over and under the arrow (H₂SO₄ typeset). **Insert reaction scheme**.

## 5. Spectra and mass (Spectra, Mass Spec) — 2 min
1. Tool ▸ **Spectra**, type **ibuprofen**: predicted ¹H NMR — shifts, multiplicities, J, assignments; the notes on
   diastereotopic protons. (These are additivity-rule estimates — say so; they help assign a real spectrum.)
2. Tool ▸ **Mass Spec**, **ibuprofen**: monoisotopic mass 206.1307, the isotope pattern (M+1 14.3 %), adducts.

## 6. Close — 1 min
- Everything ran inside Word, offline; nothing left the machine.
- What it will not do is said plainly (a structure it cannot read exactly is refused by name, never redrawn wrong).

## Avoid in a demo (known limits)
- ChemDraw objects **embedded** in Word (the kind you double-click to open ChemDraw): not yet readable. ChemDraw
  *pictures* pasted into Word do open (Open ChemDraw picture).
- **Systematic IUPAC names** cover a subset (chains, small rings, benzenes); drug-like heterocycles answer "No name".
  Use dictionary compounds (aspirin, ibuprofen, caffeine, paracetamol …) for name-based steps.
- Typing a **formula** into Build's Text tab is refused on purpose (a formula has no single structure) — type a name
  or a SMILES.
