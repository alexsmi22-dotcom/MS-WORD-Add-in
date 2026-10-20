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

## 2b. A metallocene (Build ▸ Draw) — 1 min
1. Under the canvas, **Organometallic: Metallocene template… ▸ ansa-Metallocene (Me₂Si-bridged)**: the canvas switches
   in place and the complex appears — Cp rings in perspective, η⁵-bonds to Zr, the Me₂Si bridge.
2. Atom tool, type **Hf**, click the Zr label → hafnocene. Type **Z**, click Si → a generic bridge for a claim
   ("Z = Si, C" as a caption with the Text tool).
3. Erase one η-bond (Erase tool, click its line), then **η-bond**: click inside that ring, then Zr — the bond drawn by hand.
4. **Insert 2D structure** (ChemDraw size). The readout says plainly why there is no single formula.

## 2c. Stereo in the name (Build ▸ Draw) — 30 s
1. With L-alanine or (R)-butan-2-ol drawn, the readout's **Stereo** line gives the claim-ready name: (2S)-2-aminopropanoic
   acid / (2R)-butan-2-ol. Flip a wedge → the descriptor flips.
2. (If asked) a centre JurisLab cannot decide is refused by name, never guessed — checked against the CIP Validation
   Suite with zero wrong labels.

## 2d. The Example paragraph (Characterization) — 1 min
1. Tool ▸ **Characterization**, compound `caffeine`. Paste a MestReNova ¹H line (`1H NMR (400 MHz, Chloroform-d) δ 7.51
   (s, 1H), 3.99 (s, 3H), 3.57 (s, 3H), 3.40 (s, 3H).`) → the journal form appears, with "integrations add up to 10H,
   matching the formula".
2. Tick HRMS, Found `195.0874` → "[M + H]⁺ Calcd for C₈H₁₁N₄O₂ 195.0877; Found 195.0874", −1.3 ppm.
3. **Insert characterization text** → formatted text in Word (italic *J* and *m*/*z*, subscripts). Point out: nothing
   is predicted — only the Calcd values are computed; the checks are what a referee or examiner would ask.
   (Keep to SMILES or dictionary names for the compound — a name like "benzyl acetate" that is not in the dictionary
   is refused by name.)

## 3. A ChemDraw file — 2 min
1. **Open ChemDraw file…**, pick the file: its structures appear as a list (those marked "page" carry polymer brackets, a counter-ion or a generic atom).
2. Click one → it opens in the editor, full size, editable. Change an atom; **Insert**.
3. (If asked) **Open the whole page as a drawing** puts the whole ChemDraw page — arrows, captions — on the page canvas,
   to insert as drawn.

## 4. A numbered scheme (Reaction) — 1 min
1. Tool ▸ **Reaction**. Type, one per line:
   `aspirin (1)` / `-> NaOH, H2O ; 100 °C, 2 h` / `salicylic acid (2)` / `-> MeOH, H2SO4 ; reflux` / `COC(=O)c1ccccc1O (3)` (methyl salicylate — not in the dictionary, so typed as SMILES)
2. The scheme draws itself as ChemDraw would: every structure at one bond length, **1**, **2**, **3** bold under them,
   reagents above and conditions below each arrow (H₂O, H₂SO₄ typeset).
3. Tick **Scheme caption above**, title `Synthesis of 3` → **Insert reaction scheme**: "**Scheme 1.** Synthesis of **3**"
   above the picture. Optional: Conditions ▸ **Lettered** → (a), (b) and a Reagents and conditions footnote.
4. Open **Compounds in this document** → 1, 2, 3 with their formulas. Type `phenol (2)` → the warning that 2 is
   already salicylic acid. In **Characterization**, Compound `compound 3` → methyl salicylate's formula.

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
