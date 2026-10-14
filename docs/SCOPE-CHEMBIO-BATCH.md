# Scope — Chemistry / molecular-biology batch: reaction balancing + stoichiometry, NCBI genetic codes, modified and cyclic peptides

_Written 2026-10-14 against the v2.135.0 working tree, while v2.136.0 (symbolic batch) is still uncommitted in `cas.ts`/`solve.ts`. Planned as **v2.137.0**. Line numbers are from that working tree. They will drift, so each one is given with its function name._

_**Sources.** A read-only audit of:_
- _chemistry: `reactions.ts`, `chemParser.ts`, `chemValidate.ts`, `structures.ts`, `compounds.ts`, `massspec.ts`, `energy.ts` (`formatFormula`);_
- _molecular biology: `dna.ts`, `sequence.ts`, `peptide.ts`, `assay.ts` (`extinctionCoefficient`);_
- _the pane handlers `updateChemValidation`, `updateReactionPreview`, `updateDnaPreview`, `findOrfsHandler`, `updatePeptide`, `updateMassSpec` and `updateSolve`;_
- _the ratchets `scripts/pane-audit.js` and `scripts/check-figures.js`._

_I probed about 150 calls through the lib entry points those handlers call, from scratchpad Node scripts loaded through `scripts/ts-require.js`. The Solve chain was driven through the `sym/chain.js` mirror of `updateSolve` built for the symbolic brief. **Nothing in the tree was created or modified**, apart from this file._

_**Oracles,** run this session under `python -I` from the scratchpad venv on Python 3.14:_
- _chempy 0.10.2 `balance_stoichiometry`, with pulp pinned to 2.7.0 (pulp 4.x breaks it), and SymPy 1.14.0 `Matrix.nullspace` on an independently built composition matrix;_
- _Biopython 1.88 `Bio.Data.CodonTable`, cross-checked codon by codon against NCBI `gc.prt` **version 4.6**, downloaded today (sha256 `2aecbdd0…6051a04`): 27 tables, 0 mismatches;_
- _pyteomics 5.0.1 and RDKit 2026.09.1 (`MolFromSequence`, `MolFromHELM`, periodic-table masses)._

_Wrong answers come first. §D is the exit test._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each read):**
- **`chemValidate.ts`.**
  - `validateFormula` returns counts, charge, Hill formula and mass from IUPAC conventional weights (`PERIODIC`).
  - It handles nested groups, `^2-`, a trailing `±`, monatomic `Fe2+`, and the hydrate dot `·`/`.`.
  - `normalizeFormulaText` folds the typeset forms back to ASCII (`MnO₄⁻` → `MnO4^-`).
  - **This is the balancer's composition source.** It is not OCL: OCL's formula is charge-blind, and it cannot even draw `Fe2O3`.
- **`chemParser.ts` `parseChemical`.** The Chemical-mode typesetter used for both preview AND insert (`insertFormattedText` → `parse` → `parseChemical`, taskpane 2672/4557).
- **`reactions.ts`.**
  - `parseReaction` splits on `>>`, `->`, `→`, `<=>`, `⇌`, `<-`, `←`, with components separated by a whitespace-padded `+` (so the `+` in SMILES charges survives).
  - `composeReactionScheme` draws structures.
  - Components are **SMILES or names**. Nothing is balanced.
- **`structures.ts` `lookupSmiles`** and **`compounds.json`** (the dictionary, PubChem-gated; name → SMILES and formula → SMILES).
- **`massspec.ts`.** `computeMassSpec` (via OCL), `parseFormula`, `isotopePattern`, `ADDUCTS`.
- **`energy.ts`.** `formatFormula` (typesets counts and hydrate coefficients; **charge-blind**, see §E3). Combustion stoichiometry exists only for CₓHᵧO_z fuels.
- **`units.ts`.** `mol`/`mmol`/`M`/`mM` dimensions; `convert`, `parseQuantity`, `significantFigures`, `formatSig`.
- **`dna.ts`.**
  - One `CODON_TABLE` (88), the standard code.
  - `resolveCodon` (112) resolves IUPAC-degenerate codons against that one table.
  - `translate` (136) takes `{frame, stopAtStop}`. **There is no table selector.**
  - `findOrfs` (224): `codon === "ATG"` is hard-coded at 238.
  - `proteinProperties` (839) uses `RESIDUE_MASS`/`WATER_MASS` (764/769, Expasy averages) and the EMBOSS pKa `netCharge` (814), which assumes free termini.
- **`sequence.ts`.** `translateCds` (236) and the ST.26 CDS auto-`/translation` in `featureInner` (268–288) both call `resolveCodon`. They honour `/codon_start` but **ignore `/transl_table`**.
- **`peptide.ts`.** `parseSequence` (one-letter or three-letter codes, Sec/Pyl), `peptideSmiles` (free termini, no stereo — "constitution only", kept), `buildPeptide`.
- **`assay.ts`.** `extinctionCoefficient` (1104) already counts `cystinePairs`. Reuse it; do not reimplement.
- **Pane registries/ratchets.**
  - `BASELINES.assay = {figures: 16, total: 16}`.
  - `CORPUS_FLOOR = 194` (check-figures.js 77; other builders are moving it).

**Missing (verified absent by grep 2026-10-14):**
- No balancer, null space, limiting reagent or yield in any chemistry path.
- No `transl_table`/genetic-code selector anywhere.
- No disulfide, cyclic or modified-residue support.

**Probe results, ranked WRONG > SILENT > RIGHT > MISSING, with the exact output.**

*WRONG — a confident answer to a different question (19):*

1. **ST.26 wrong protein of record (`/transl_table` ignored).**
   - Input: CDS `ATGAGATGATGGAAACCCTAA`, organism *Homo sapiens*, qualifier `/transl_table=2`.
   - Emitted: `/translation=MR`, from the standard code.
   - Under table 2, AGA is a stop, so the translation is `M`.
   - The listing contradicts its own qualifier. This is the `/codon_start` defect class again (sequence.ts 229–234), in a filed document.
2. **Alternative start codons.**
   - Input: `/transl_table=11` CDS `GTGAAACCCGGGTTTAAATAA`. Emitted: `/translation=VKPGFK`.
   - INSDC/NCBI (Biopython `cds=True`): **`MKPGFK`**. An initiator alternative start codon is read as Met.
   - A routine minority of bacterial genes start GTG/TTG, so this is not exotic.
3. **The DNA-mode translation has no table.**
   - Vertebrate mito `ATGAGATGATGGTAA` → `MR*W*` (table 2: `M*WW*`).
   - Mycoplasma/mold mito `ATGAAATGGTGAAAACCCGGGTTTTAA` → `MKW*KPGF*` (table 4: `MKWWKPGF*`).
   - The "internal stop codon: this frame is not a single ORF" readout then fires on a correct gene.
4. **`findOrfs` truncates at TGA under table 4.** It returns `+1 1..12 MKW` for the gene above, which is a full-length 8-aa ORF under table 4. It also never finds a GTG- or TTG-initiated ORF (`GTGAAACCCGGGTAA` → `[]`).
5. **`cyclo(GRGDSP)` → `CYCLOGRGDSP`.**
   - `cyclo` is read as Cys-Tyr-Cys-Leu-**Pyl**, and the structure is drawn: C₅₅H₈₆N₁₆O₁₇S₂, MW 1307.51.
   - Only `(` and `)` are reported as ignored.
   - Truth: C₂₂H₃₅N₉O₉, 569.2558 mono.
6. **`cyclo-GRGDSP`:** the same 1307.51, with **no warning at all**.
7. **`Ac-SYSMEHFRWGKPV-NH2`** (α-MSH) → `ACSYSMEHFRWGKPVNH`. `Ac` becomes Ala-Cys and `NH2` becomes Asn-His; only `2` is reported. Truth: C₇₇H₁₀₉N₂₁O₁₉S, 1663.7929 mono.
8. **`CYIQNCPLG-NH2`** (oxytocin) → `CYIQNCPLGNH`, 1261.45. The three-letter spelling drops `NH2` as invalid and builds the reduced free acid, 1010.2 avg; the truth is 1007.19 (amide + cystine).
9. **`AKpSPR`** → `AKPSPR`. The lowercase `p` silently becomes **Pro**, with nothing reported: C₂₈H₅₀N₁₀O₈, 654.77. Truth: C₂₃H₄₄N₉O₁₀P, 637.2949.
10. **`M(ox)AK`** → `MOAK` (O = pyrrolysine), 585.77. Truth: 364.1780.
11. **`pE-HP-NH2`** → `PEHPNH`, 729.75. Truth (TRH): C₁₆H₂₂N₆O₄, 362.1703.
12. **Fractional hydrates: `CaSO4·0.5H2O`** (plaster of Paris) → "✓ Valid, M = 226.209" (CaH₁₀O₉S). The `.` hydrate split reads `0.5` as `0` then `5`. Truth: 145.142.
13. **`0.5H2O`** → "✓ Valid — H₁₀O₅, M = 90.075" (truth 9.008). **`1.5O2`** → "O₁₀, 159.990". These are the masses the stoichiometry engine would reuse. See §E1.
14. **The hydrate coefficient is typeset as a subscript in Chemical mode (preview AND insert).** `CuSO4·5H2O` → CuSO₄·₅H₂O and `Na2CO3·10H2O` → Na₂CO₃·₁₀H₂O. `parseChemical` only treats a digit after a SPACE as a coefficient (chemParser.ts 62). `CuSO4 · 5H2O` (spaced) is right. The display contract is broken in the flagship tool.
15. **A reaction typed in Chemical mode** (`Fe + O2 -> Fe2O3`) typesets `+` and `-` as superscript charges (Fe ⁺ O₂ ⁻> Fe₂O₃) and inserts that.
16. **Solve, `=` reactions.**
    - `Fe + O2 = Fe2O3` → "more than one unknown (Fe, O2, **Fe2O**)". The paste fold rewrote `Fe2O3` as `Fe2O³`.
    - `2H2 + O2 = 2H2O` → unknowns "H, O2, H2O" (`2H2` read as 2·H²).
    - The algebra engine reports on chemistry it has mangled.
17. **Solve, `->` reactions.** All six probed (`balance Fe + O2 -> Fe2O3`, the KMnO₄, MnO₄⁻/Fe²⁺ and Cr₂O₇²⁻/e⁻ forms) → the **generic inequality refusal**: `->` contains `>`. The refusal names the wrong subject.
18. **Mass Spec mode reads formulas as SMILES when the dictionary misses.**
    - `Co` (cobalt) → CH₃O, 31.034. `CN` → CH₅N (methylamine). `NO` → H₃NO. `CS` → CH₄S.
    - The same holds in Structure mode via `renderStructure`.
    - `CO` is right only because the dictionary catches it first.
19. **Reaction mode** draws `N2 + 3H2 ⇌ 2NH3` as "Couldn't draw: 3H2, 2NH3": coefficients are unsupported. `Fe + O2 = Fe2O3` becomes ONE stage with the component "O2 = Fe2O3" (`=` is not an arrow). Both refusals name the wrong problem.

*SILENT (6):*
- `pGlu-His-Pro-NH2` and `Glp-His-Pro-NH2` build **HP** (free acid, 252.27). They say "Ignored unrecognized: pGlu, NH2" but still offer the wrong structure for insertion.
- `H-Gly-Gly-OH` (standard termini notation) warns "ignored H, OH". The answer is right, but the warning is a false alarm.
- `copper sulfate` → anhydrous (159.61), with no hint that the pentahydrate (249.68) exists: a ~90 g/mol stoichiometry trap. `copper(II) sulfate`, `copper sulfate pentahydrate` → null.
- `CuSO4*5H2O`: `formatFormula` typesets it as CuSO₄·5H₂O, but `validateFormula` refuses the same string ("Misplaced number 5"). `•` (bullet) is refused.
- Peptide-mode MW is OCL **average** only; there is no monoisotopic mass beside it.
- `proteinProperties` pI assumes free N/C termini (dna.ts 814), so it is wrong for any amidated, acetylated or cyclic peptide once those exist.

*RIGHT (keep and pin) (15):*
- `validateFormula`: `Fe₂O₃`, `MnO₄⁻`/`MnO4^-`/`MnO4-` (q −1), `Fe²⁺`/`Fe^2+`/`Fe2+` (q +2), `[Fe(CN)6]4-` (q −4), `Hg2^2+`, `Cr₂O₇²⁻`, `K4Fe(CN)6`, `KAl(SO4)2·12H2O` 474.372, `CuSO4·5H2O` 249.677.
- Isotope refusal (`¹⁴C`); `D2O` refused by name.
- `parseReaction` arrow set and its `->>` warning.
- Sec/Pyl three-letter precedence.
- `resolveCodon` degeneracy (TRA → `*` under table 1).
- `/codon_start` honoured.
- `extinctionCoefficient` reports both cysteine states.

*MISSING (≈20):*
- **Solve:** balancing, half-reactions, limiting reagent, theoretical and percent yield, "moles in 10 g NaCl", "molar mass of …" (all → "more than one unknown (how, many, grams…)").
- **DNA / ST.26:** any table selector, alternative-start ORFs.
- **Peptides:** disulfide, cyclic, phospho, acetyl, amide, pyroGlu, Met-ox.
- **Formulas:** electrons (`e-`/`e⁻` → "Unexpected character e"), state symbols (`NaCl(aq)`, `Fe2O3(s)`, `H2O(l)`, `CO2(g)` → refused).

## B. Inputs, outputs, figures

### B1. `balance.ts` — the balancer (pure engine, no OCL)

**Species parsing** (one function, `parseSpecies`). The steps run in this order:
1. **Split the sides.** Split on one arrow from `->`, `→`, `⟶`, `=`, `⇌`, `<=>`, `<->`, `⇋`. A chemistry-only parser may take `=`; **`reactions.ts`'s `ARROW_SPLIT` must not**, because in SMILES `=` is a double bond.
2. **Split the species.** Split each side on a `+` that has whitespace on both sides.
   - An unspaced `H2+O2` is **refused by name**: "is `H2+O2` H₂ plus O₂, or the ion H₂⁺ next to O₂? Put spaces around a `+` that separates species".
   - `Fe^2+ + e-` and `H⁺ + OH⁻` are fine: a charge sign is never whitespace-padded on both sides.
3. **Strip each species.** Remove the leading integer coefficient (`2H2O`, `2 H2O`; a fractional coefficient `½O2`/`0.5 O2` is accepted as a coefficient and REPORTED, never balanced through). Remove a trailing state symbol `(s)`, `(l)`, `(g)`, `(aq)`, `(cr)`, keeping it for display.
4. **Electrons.** `e`, `e-`, `e⁻`, `e^-` become the electron: no atoms, charge −1. `e+` and `e` with a count are refused.
5. **Composition.** Only then call `validateFormula`.
6. **Hydrate dot.** `·` and the bullet `•` are accepted as hydrate dots. `.` is accepted **only** between a formula and an integer (`CuSO4.5H2O`). A decimal hydrate needs `·` and is parsed by the §E1 fix.
7. **Dictionary names** (`water`, `glucose`) resolve through `lookupSmiles` → OCL composition, with the charge summed from `getAtomCharge`.
   - The resolved formula is SAID: "copper sulfate read as anhydrous CuSO₄; the pentahydrate is CuSO₄·5H₂O".
   - A dictionary hit whose formula string is ALSO a different valid formula is refused as ambiguous (the §A-18 class).

**Method.** Build the matrix A with one row per element plus a **charge row** (always present; it is load-bearing, see §D1). Column j is +species j on the left and −species j on the right.
- Exact rational rref written inside `balance.ts` (**BigInt** fractions: the K₄Fe(CN)₆ case reaches 299 and intermediates exceed 2⁵³ sooner than expected).
- Null space N. Then:
  - **dim N = 1:** scale to the smallest positive integers. Then:
    - all entries > 0 → the balance;
    - some entry = 0 → refuse naming the species ("N₂ takes no part — coefficient 0; remove it or check the products"; never print "0 N₂");
    - mixed signs → refuse naming the side ("balances only with Cl₂ on the other side").
  - **dim N = 0:** refuse, naming the conserved quantity that fails. Two cases:
    - an element (or charge) present on one side only → "Na appears only on the left";
    - otherwise → "no positive coefficients conserve H and O together: H₂O has H:O = 2:1, H₂O₂ has 1:1". Name the smallest set of rows found infeasible by dropping rows one at a time.
  - **dim N ≥ 2:** **refuse the unique answer by name.** Output: "This reaction has 2 independent balancings, so no single set of coefficients is THE answer — every positive combination of the reactions below balances it:", then a basis of **non-negative primitive integer reactions** where one exists (search small non-negative combinations of the rref basis, capped), else the rref basis with a note.
  - **Never** do what chempy does by default (§D1): pick one "minimal" solution and print it.
- **Caps before work:** ≤ 20 species, ≤ 20 rows, coefficients ≤ 10⁶, input ≤ 2,000 chars, basis search ≤ 10⁴ combinations. Each sets a stated refusal.

**Half-reactions.**
- Verb `half-reaction` / `balance in acid` / `balance in base`, given an unbalanced skeleton such as `MnO4- -> Mn2+`.
- Add H₂O, H⁺ (acid) or OH⁻ (base), and e⁻ as free species. Balance as above.
- Present in textbook form: electrons on the correct side, "reduction (gains 5 e⁻)".
- Base: the result is the OH⁻-form balance computed directly. It is not an acid result with H⁺ "neutralised" after the fact, because that route cancels water inconsistently.
- Redox pair: two half-reactions → the electron-cancelling combination. That is just the full balance with e⁻ eliminated; check that it agrees with balancing the full equation directly (cross-check, refuse on disagreement).

**Output (display contract).**
- Example: "2 KMnO₄ + 16 HCl → 2 KCl + 2 MnCl₂ + 5 Cl₂ + 8 H₂O".
  - Coefficients are spaced and full size; counts are subscripts; charges are superscripts (MnO₄⁻, Fe²⁺, e⁻).
  - The arrow is `→`, or `⇌` when typed.
  - State symbols are kept as typed.
- A conservation table follows, one row per element plus charge: left total, right total, ✓.
- **The output must re-parse:** `balance(display(balance(x)))` equals `balance(x)`, with coefficients unchanged. Pin it.
- The typesetter is a NEW `formatSpecies` in `balance.ts`. It is **not** `formatFormula`, which is charge-blind (§E3).

**Figure:** an element-conservation bar chart, with paired bars (left vs right) per element and per charge, all equal by construction. For a dim N ≥ 2 refusal it is the basis reactions as a small table figure. Built with `plot.ts`/`statchart.ts` `groupedBarSvg`.

### B2. `stoich.ts` — limiting reagent, theoretical and percent yield

- **Input:** a balanced or unbalanced reaction (balanced first via B1), plus an amount per reactant in g, mg, kg, mol, mmol, L of gas, or mL of liquid with a density; optionally an actual yield of one product.
- **Gas volumes:**
  - default **V_m = 22.711 L/mol (IUPAC STP: 273.15 K, 100 kPa)**, named in the output;
  - option 22.414 (273.15 K, 1 atm), or "at T, P" through PV = nRT with R = 8.314462618.
  - The two defaults differ by 1.3 % (§D2), and a silent choice is a wrong answer for half the textbooks.
- **Liquids:** mL requires a density. Refuse without one ("5.0 mL of acetic anhydride — give its density in g/mL"); never assume 1 g/mL.
- **Output:**
  - moles of each reactant;
  - the extent ξ each would allow, with **the limiting reagent named, and ties named** ("H₂ and O₂ are both exhausted");
  - the theoretical mass of every product;
  - the excess left of each other reactant;
  - percent yield = actual / theoretical.
    - Above 100 % → a caveat ("above 100 % — wet or impure product, or the wrong limiting reagent"), not a refusal.
    - Below 0 % is refused.
- **Precision:** sig figs follow the inputs (`units.ts significantFigures`/`resultFigures`).
- **Molar masses** come from `validateFormula` (IUPAC conventional weights) and are printed per species.
- **Pane:** a new Bio/Assay calculator **"Reaction stoichiometry & yield"** (id `stoich`). `BASELINES.assay` 16 → **17**.
- **Figure:** a horizontal bar per reactant of the moles available vs the moles needed at the limiting extent, with the limiting bar marked. Optionally a second panel of product masses.
- **Solve routing:** "how many grams of water from 4 g of hydrogen" stays a stated MISSING. Prose stoichiometry is a follow-up. Do not pattern-match prose in this release.

### B3. Where balancing appears

- **Reaction mode.** A toggle: **Structures (names/SMILES)** | **Formulas (balance)**.
  - Formula mode parses with `parseSpecies`, shows the balanced equation + conservation table, and inserts it as typeset text (Word paragraph) + the figure.
  - Structure mode is unchanged; in it, a leading coefficient (`3H2`) is refused by name ("coefficients are not drawn — switch to Formulas to balance").
  - **Never auto-detect between the two:** `CO` is methanol as SMILES and carbon monoxide as a formula.
- **Solve.** New switch `chemistryKindFor(raw)`. It runs on the **raw** text **before `foldPastedMath`** (taskpane 27864) and before the inequality branch (the λ-calculus bypass precedent; the fold rewrites `Fe2O3` as a power). It fires only when ALL of these hold:
  1. Exactly one arrow from B1's set, or the verb `balance`/`half-reaction`.
  2. Every species passes `parseSpecies` (so `x`, `f(x)`, `A`, `7` disqualify).
  3. One of: an arrow other than `=`; the verb; or at least one species with a digit, charge, `·` or two-letter element.

  The §D1 negatives (`x + y = 5`, `A + B = C`, `C = 2*pi*r`, `H = 2`, `N + O = 7`, `Co + O2 = 5`, `f(x) -> 0`, `x -> x^2`, `lim x->0 sin(x)/x`) must route exactly as today. `Co + O = CoO` IS chemistry (both rules pass). Pin both directions.
- **Chemical mode.** When the input contains an arrow, the validation line says "This is a reaction — balance it in Reaction mode (Formulas)" instead of "Unexpected character >". The typeset preview stops superscripting the separating `+` and the arrow (chemParser: a `+` with whitespace on both sides is normal-size; `->` becomes `→`).

### B4. Genetic codes — `geneticCode.ts` (new) + every translating call site

- **Data.** All 27 NCBI tables from `gc.prt` v4.6: 1–6, 9–16, 21–33.
  - Store the `ncbieaa`/`sncbieaa` 64-character strings **verbatim**, with the NCBI order TCAG × TCAG × TCAG and the version and sha256 in a comment. Derive the maps at load.
  - Names come from gc.prt (with the SGC aliases). Look-up is by number, by name, or by common alias ("vertebrate mitochondrial", "mito", "bacterial", "plastid", "mycoplasma", "yeast mito").
  - **Ids 7, 8, 17–20 do not exist.** Refuse them by name, quoting gc.prt: "7 was merged into 4 (kinetoplast); 8 into 1 (plant chloroplast)".
- **Tables 27, 28 and 31** have codons that are BOTH stop and sense (context-dependent: TGA in 27; TAA/TAG/TGA in 28; TAA/TAG in 31).
  - Translate them as the sense residue, per NCBI `ncbieaa` and Biopython.
  - The output must **SAY** so ("Table 28: TAA/TAG/TGA are read as Q/Q/W; they can also terminate, depending on context — stops are not called").
  - The ORF finder refuses those three tables by name.
- **API:**
  - `resolveCodon(codon, table = 1)`: degeneracy is resolved against the chosen table (TRA → `*` in table 1, **X** in table 2, because TGA = W there).
  - `TranslateOptions.table?: number`, plus `initiator?: boolean`. Initiator mode reads the first codon as M when it is in the table's start set. That is the NCBI CDS convention, valid only for a 5′-complete CDS at codon_start 1.
  - `OrfOptions.table` and `OrfOptions.starts: "ATG" | "table"`. **The default stays `"ATG"`**, so existing results do not move; `"table"` mirrors NCBI ORFfinder's "ATG and alternative initiation codons", and the start is translated as M.
- **Every call site (grep-verified):**
  1. DNA mode `translate` (taskpane 5659): a table dropdown beside Frame. The readout line says "Translated with NCBI table 2 (Vertebrate Mitochondrial)" whenever the table ≠ 1.
  2. `findOrfsHandler` (6073): the table plus a start-codon option; the ORF table caption names both.
  3. `sequence.ts` `translateCds`/`featureInner`:
     - read `/transl_table`;
     - apply the initiator rule at codon_start 1 when `/transl_table` is explicit (§E10);
     - **refuse to auto-generate** `/translation` for an unknown or absent table id, or for tables 27/28/31, with a feature warning.
     - **Do not emit** `/transl_table=1`, because INSDC omits the default.
- **Nowhere else translates.** Sequence Map, Align, primer Tm and the Peptide tool do not call `resolveCodon` (grep). Say so in the notes; do not invent integrations.
- **Figure:** none new. The ORF table is HTML and DNA mode is not a calculator registry. A codon-table grid (64 cells, differences from table 1 highlighted) is optional; if built, insert it as an HTML table, not an SVG.

### B5. Peptides — `peptide.ts` + `peptideMods.ts` (new)

**Notation.** Accept the forms below, and nothing that guesses:
- termini `H-` and `-OH` (accepted silently, as written); `Ac-` (N-acetyl); `-NH2` (C-amide); `pGlu-`/`Pyr-`/`Glp-`, three-letter only (from Gln: −NH₃, C-terminal mass and SMILES change);
- `cyclo(…)`, `cyclo[…]` and `cyclo-(…)` for head-to-tail;
- ProForma 2.0 bracketed modifications on a one-letter residue: `S[Phospho]`, `T[Phospho]`, `Y[Phospho]`, `M[Oxidation]`, `K[Acetyl]`, `Q[Gln->pyro-Glu]` and `E[Glu->pyro-Glu]` (N-terminal only), and `[Acetyl]-` / `-[Amidated]`;
- disulfides as a trailing clause: `; disulfide 1-6` or `; ss 1-6, 3-11` (residue numbers).

**Refused by name** (each is a §A WRONG today):
- `cyclo` read as residues;
- **mixed-case one-letter strings** (`AKpSPR`: "lowercase p inside an uppercase sequence — write S[Phospho] for phosphoserine"). All-lowercase stays accepted;
- `(ox)` and other parenthesised modifiers ("write M[Oxidation]");
- `pE`/`pS` prefixes;
- digits in a one-letter string (`C1YIQNC1`);
- an unknown bracket name (list the supported ones);
- a modification on the wrong residue (`A[Phospho]`);
- `cyclo` combined with `Ac-`/`-NH2` (no termini exist);
- a disulfide naming a non-Cys or reusing a Cys.

**Disulfide rules:**
- **Pairing given:** −H₂ per bond (mono −2.015650, avg −2.0159). The SMILES uses ring-closure bonds between the S atoms (`%nn`), so the drawn structure is right.
- **"all cysteines paired"** (`; disulfide all`):
  - **odd** Cys count → refuse ("5 cysteines — one is unpaired; give the pairing");
  - 2 Cys → unambiguous;
  - ≥ 4 Cys → the mass is pairing-independent and is reported, but **the structure is NOT drawn** until a pairing is given ("4 cysteines admit 3 pairings; the mass is the same, the structure is not").

**Output.**
- Monoisotopic AND average mass (now both), and the formula, typeset.
- Every applied modification is listed with its Unimod accession and delta.
- A caveat when stereo is unspecified (existing).
- pI/GRAVY: `proteinProperties` is not called by Peptide mode today, so nothing changes there. If the integrator surfaces pI for modified peptides, `netCharge` must drop the N-terminal term (Ac, pyroGlu, cyclic) and the C-terminal term (amide, cyclic), and pS/pT/pY add phosphate pKa values. Otherwise refuse pI for modified peptides by name.
- `extinctionCoefficient`: when disulfides are given, the "cystine" ε is exact (pairs = bonds), not ⌊C/2⌋.

**Masses** are computed by `peptideMods.ts` from composition (residue compositions + deltas) with monoisotopic element masses (its own NIST table, same values as `massspec.ts` `ISOTOPES`, which is unexported) and IUPAC conventional weights (`PERIODIC`). **The OCL formula of the generated SMILES must equal the composition formula.** That is the in-product cross-check; refuse on disagreement.

**Figure:** the existing structure depiction (with S–S bonds and the macrocycle). No registry change.

## C. Build order, honest limits, disjoint split

**Order:**
1. **Engines in parallel**, each pure with its own test file meeting §D: A `balance.ts` + `stoich.ts`; B `geneticCode.ts` and its wiring in `dna.ts`/`sequence.ts`; C `peptideMods.ts` + `peptide.ts`.
2. **D integrates:** pane, HTML, `chemParser`/`chemValidate` fixes, the Solve switch, ratchets, examples, TEST-SCRIPT.
3. **An INDEPENDENT adversarial pass** over the whole diff (house rule), aimed at:
   - the steal surface of `chemistryKindFor`;
   - the fractional and decimal hydrate;
   - redox with no charge row;
   - dim N = 2;
   - mixed-case peptides;
   - tables 27/28/31;
   - `/transl_table` with junk values;
   - the round-trip of every displayed equation.
4. **§D is the exit test,** then full QC.

**Build split. Files are disjoint; `taskpane.ts` has exactly one owner.**

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — balance + stoich** | `src/lib/balance.ts` (incl. its OWN small BigInt-fraction rref: `markov.ts`'s rref is not exported and `cas.ts` is in flight for v2.136), `src/lib/stoich.ts` (new); `__tests__/balance.test.ts`, `balance.adversarial.test.ts`, `stoich.test.ts` (new) | `chemValidate.ts`, `structures.ts`, `units.ts` |
| **B — genetic codes** | `src/lib/geneticCode.ts` (new; the gc.prt strings verbatim); `src/lib/dna.ts` (`resolveCodon`/`translate`/`findOrfs` gain `table`, `initiator`, `starts`; defaults unchanged); `src/lib/sequence.ts` (`/transl_table`); `__tests__/geneticCode.test.ts` (new); `dna.test.ts`, `codonStart.test.ts`, `sequence.test.ts`, `st26Compliance.test.ts` (extend, never loosen) | — |
| **C — peptides** | `src/lib/peptide.ts`; `src/lib/peptideMods.ts` (new); `__tests__/peptide.test.ts`, `peptideMods.test.ts` (new) | `assay.ts`, `structures.ts`. **C must not edit dna.ts or massspec.ts**: `RESIDUE_MASS` and `ISOTOPES` are unexported, so C keeps its own residue compositions and a 7-element (C H N O S P Se) NIST monoisotopic table in `peptideMods.ts` |
| **D — integrator** | `src/taskpane/taskpane.ts` + `.html`; `src/lib/chemParser.ts` + its test (hydrate coefficient, spaced `+`, arrow); `src/lib/chemValidate.ts` + its test (decimal hydrate, `•`, `*`); `src/lib/massspec.ts` (formula-vs-SMILES ambiguity, §A-18); `src/lib/examples.ts`; `scripts/pane-audit.js`; `scripts/check-figures.js` / `figure-layout-run.ts`; `docs/TEST-SCRIPT.md` | engine APIs from A–C, frozen at the end of step 1 |

`chemValidate.ts` belongs to D, but A depends on its decimal-hydrate fix. **D lands that fix first, in step 1**, so that A's tests run against the fixed `validateFormula`; until then A pins only integer hydrates. `energy.ts` `formatFormula` is out of scope (§E3).

**Honest limits (say them in the UI):**
- **Balancing:**
  - Mass and charge conservation only. It says nothing about whether the reaction happens, its thermodynamics, or which products form.
  - Organic structures are balanced by formula; constitution is ignored.
  - No oxidation-state assignment in the output (a follow-up).
  - Fractional coefficients are not output: the smallest integers are.
- **Stoichiometry:**
  - Ideal-gas volumes only; no solution molarity × volume in v1 (a follow-up — it is one line once B2 exists, but it needs a units UI).
  - No prose word problems.
- **Genetic codes:**
  - NCBI gc.prt 4.6 only.
  - No context-dependent stop calling (27/28/31).
  - No selenocysteine/pyrrolysine recoding: UGA → U and UAG → O need a SECIS element or context and are not expressible as a table. Say so when a user asks.
  - No RNA editing (the reason table 8 was retired).
- **Peptides:**
  - The listed modifications only (7 + disulfide + cyclic).
  - No side-chain-to-side-chain lactams, no D-amino acids (the stereo limit in `peptide.ts` stays: constitution only), no non-proteinogenic residues, no cross-links between chains (insulin's A/B chains are refused: "two chains").

## D. Acceptance audit (independent oracle beside every value)

### D1. Balancing

Routes: chempy `balance_stoichiometry`, and the SymPy null space of a composition matrix built from chempy's own parser. Both routes agree on every unique case.

| input | expected (route 1 = route 2) |
|---|---|
| `Fe + O2 -> Fe2O3` | 4, 3, 2 |
| `KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O` | 2, 16, 2, 2, 5, 8 |
| `C3H8 + O2 → CO2 + H2O` | 1, 5, 3, 4 |
| `C6H12O6 + O2 = CO2 + H2O` | 1, 6, 6, 6 |
| `K4Fe(CN)6 + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O` | **10, 122, 299, 162, 5, 122, 60, 60, 188** (rank 8 of 9) |
| `MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O` | 1, 5, 8, 1, 5, 4 |
| `Cr2O7^2- + H+ + e- -> Cr^3+ + H2O` | 1, 14, 6, 2, 7 |
| `MnO4- + H2O + e- -> MnO2 + OH-` (base half) | 1, 2, 3, 1, 4 |
| `Cu + HNO3 -> Cu(NO3)2 + NO + H2O` | 3, 8, 3, 2, 4 |
| `NH3 + O2 -> NO + H2O` | 4, 5, 4, 6 |
| `Ca3(PO4)2 + SiO2 + C -> CaSiO3 + P4 + CO` | 2, 6, 10, 6, 1, 10 |
| `Al + Cu^2+ -> Al^3+ + Cu` | 2, 3, 2, 3 (charge row needed) |
| `Ag+ + Cl- -> AgCl` | 1, 1, 1 |
| `NaCl -> Na + Cl2` | 2, 2, 1 |
| `CuSO4·5H2O -> CuSO4 + H2O` | 1, 1, 5 |

**Must REFUSE:**
- **`C + O2 -> CO + CO2`:** nullity 2. Basis (SymPy): 2 C + O₂ → 2 CO and C + O₂ → CO₂. **chempy prints 3, 2, 2, 1.** That is exactly the plausible single answer we must not give. Test: "no unique balancing", 2 reactions shown.
- **`Cu + HNO3 -> Cu(NO3)2 + NO + NO2 + H2O`:** nullity 2. chempy picks 2, 6, 2, 1, 1, 3. We refuse and show 3 Cu + 8 HNO₃ → 3 Cu(NO₃)₂ + 2 NO + 4 H₂O and Cu + 4 HNO₃ → Cu(NO₃)₂ + 2 NO₂ + 2 H₂O.
- **`KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O`:** nullity 2. A non-negative basis: 2, 5, 3, 1, 2, 5, 8 (the textbook form) plus 2 H₂O₂ → O₂ + 2 H₂O. chempy picks 2, 1, 3, 1, 2, 3, 4. Refuse and explain that H₂O₂ disproportionation is independent.
- **`H2O -> H2O2`:** nullity 0. Name H and O.
- **`H2 + O2 + N2 -> H2O`:** the only solution is 2, 1, **0**, 2. Refuse naming N₂ (chempy errors with "Component '7' not among products").
- **Without the charge row,** `MnO4-/Fe2+` has nullity 2 (SymPy: [0, 1, 0, 0, 1, 0] and [¼, 0, 2, ¼, 0, 1]). A test builds the matrix without the charge row, asserts nullity 2, then asserts the engine gives 1, 5, 8, 1, 5, 4. This proves the row is present and load-bearing.
- **`H2+O2->H2O`:** the unspaced-`+` refusal.
- **`2 H2 + O2 -> 2 H2O`:** already balanced; say so and return 2, 1, 2 (not 4, 2, 4).

**Round trip:** for every row above, `parseSpecies(formatSpecies(result))` balances to the same vector, with `→`, ⁺, ⁻, ²⁺ and state symbols.

**Solve negatives** (today's routing via `chain.js`, which must stay identical):
- `x + y = 5`, `A + B = C`, `C = 2*pi*r`, `N + O = 7`, `Co + O2 = 5`, `2x + 3y = 7` → "more than one unknown";
- `H = 2` → H = 2;
- `f(x) -> 0`, `x -> x^2`, `lim x->0 sin(x)/x` → (mirror) inequality refusal. The integrator re-measures these in the real pane: the mirror may not match the limit switch exactly.

**Hydrate fix** (D, step 1):
- `CaSO4·0.5H2O` → 145.142 (= 136.134 + 9.0075);
- `CuSO4·5H2O` → 249.677;
- a bare `0.5H2O` → refused, or 9.008 with the coefficient said, **never 90.075**;
- typeset `CuSO₄·5H₂O` (5 full size) in preview AND insert.

### D2. Stoichiometry

Masses use the product's `PERIODIC` weights. Route 2 is RDKit atomic weights; it agrees to ≤ 0.0002 g on every line.

| problem | limiting | theoretical | excess left | % yield |
|---|---|---|---|---|
| 2 H₂ + O₂ → 2 H₂O; 10.0 g H₂ + 10.0 g O₂ | O₂ (ξ = 0.31252 mol) | H₂O 11.26 g | H₂ 8.740 g | — |
| Fe₂O₃ + 3 CO → 2 Fe + 3 CO₂; 100 g + 50 g; 55 g Fe | CO (ξ = 0.59503) | Fe 66.458 g, CO₂ 78.559 g | Fe₂O₃ 4.982 g | **82.76 %** |
| aspirin: 2.00 g C₇H₆O₃ + 5.0 mL Ac₂O at 1.082 g/mL; 2.10 g | C₇H₆O₃ (0.014480 mol) | C₉H₈O₄ 2.6087 g | Ac₂O 3.932 g | **80.50 %** |
| 2 KMnO₄ + 16 HCl …; 5.00 g + 10.0 g | KMnO₄ | Cl₂ 5.608 g | HCl 0.772 g | — |
| 4 Fe + 3 O₂ → 2 Fe₂O₃; 10.0 L O₂ | O₂ | Fe₂O₃ **46.875 g** at 22.711 L/mol; **47.496 g** at 22.414 | — | — |

**Refusals:**
- mL without a density;
- a reaction that fails B1;
- an amount given for a product;
- zero or negative amounts.

### D3. Genetic codes

Routes: Biopython 1.88 and gc.prt 4.6 parsed independently; 27 tables, 0 codon/start/stop mismatches.

**Tables:**

| id | name (gc.prt) | starts | stops | differs from table 1 |
|---|---|---|---|---|
| 1 | Standard | TTG CTG ATG | TAA TAG TGA | — |
| 2 | Vertebrate Mitochondrial | ATT ATC ATA ATG GTG | TAA TAG AGA AGG | AGA/AGG→*, ATA→M, TGA→W |
| 3 | Yeast Mitochondrial | ATA ATG GTG | TAA TAG | ATA→M, CTN→T, TGA→W |
| 4 | Mold, Protozoan, Coelenterate Mito; Mycoplasma/Spiroplasma | TTA TTG CTG ATT ATC ATA ATG GTG | TAA TAG | TGA→W |
| 5 | Invertebrate Mitochondrial | TTG ATT ATC ATA ATG GTG | TAA TAG | AGA/AGG→S, ATA→M, TGA→W |
| 11 | Bacterial, Archaeal and Plant Plastid | TTG CTG ATT ATC ATA ATG GTG | TAA TAG TGA | — (starts only) |

The other 21 come from the same file: 6, 9, 10, 12–16, 21–33. Pin one changed codon for each (e.g. 6 TAA/TAG→Q; 12 CTG→S; 22 TCA→*; 23 TTA→*; 25 TGA→G; 26 CTG→A; 32 TAG→W; 33 TAA→Y).

**Translations** (Biopython `translate(table=t)`):

| input | t1 | t2 | t3 | t4 | t5 | t11 |
|---|---|---|---|---|---|---|
| `ATGAGATGATGGTAA` | MR\*W\* | M\*WW\* | MRWW\* | MRWW\* | MSWW\* | MR\*W\* |
| `ATGATAAGGTGATAA` | MIR\*\* | MM\*W\* | MMRW\* | MIRW\* | MMSW\* | MIR\*\* |
| `ATGAAATGGTGAAAACCCGGGTTTTAA` | MKW\*KPGF\* | MKWWKPGF\* | MKWWKPGF\* | MKWWKPGF\* | MKWWKPGF\* | MKW\*KPGF\* |

Tables 27/28/31 on `ATGAGATGATGGTAA` give MRWWQ / MRWWQ / MRWWE (sense reading), and **the output says so**.

**Initiator rule** (Biopython `cds=True`):
- `GTGAAACCCGGGTTTAAATAA` t11 → **MKPGFK** (today: VKPGFK);
- `TTGAAACCCTAA` t11 → MKP;
- `ATTAAACCCTAA` t2 → MKP;
- `CTGAAACCCTAA` t12 → MKP;
- `GTGAAACCCTAA` t1 is plain VKP. Biopython refuses `cds=True` there because GTG is not a table-1 start; with `initiator` the engine must not make it M.

**ST.26:**
- the §A-1 entry with `/transl_table=2` → `/translation=M`;
- the §A-2 entry → `MKPGFK`;
- `/transl_table=7` → no auto-translation, plus the warning "merged into 4";
- `/transl_table=28` → no auto-translation, plus the context-stop warning;
- no qualifier → table 1, unchanged (pin the existing `codonStart.test` values).

**ORFs:**
- table 4 on the gene above → `+1 1..27 MKWWKPGF` (Biopython `cds=True`, 27 nt);
- `starts: "table"`, t11, `GTGAAACCCGGGTAA` → one ORF `1..15 MKPG` (Biopython `cds=True`);
- `starts: "ATG"` (default) → `[]`, as today.

**Degenerate codons** (Biopython ambiguous tables; a raise = mixed stop/sense = our X): `resolveCodon("TRA", 2)` → X (raises); `("TRA", 1)` → `*`; `("AGR", 2)` → `*`; `("AGR", 1)` → R; `("TGR", 1)` → X (raises); `("TGR", 2)` → W.

### D4. Peptides

**Modification deltas.** Unimod values (as recalled; confirm against unimod.org before quoting in user docs). Each is matched to 6 d.p. mono / 4 d.p. avg by composition × pyteomics masses AND composition × RDKit masses:

| modification | composition Δ | mono | avg |
|---|---|---|---|
| Phospho (UNIMOD:21) | +HPO₃ | +79.966331 | +79.9799 |
| Acetyl (UNIMOD:1) | +C₂H₂O | +42.010565 | +42.0367 |
| Amidated (UNIMOD:2) | +HN −O | −0.984016 | −0.9848 |
| Gln→pyro-Glu (UNIMOD:28) | −NH₃ | −17.026549 | −17.0305 |
| Glu→pyro-Glu (UNIMOD:27) | −H₂O | −18.010565 | −18.0153 |
| Oxidation (UNIMOD:35) | +O | +15.994915 | +15.9994 |
| Disulfide (2 × Dehydro, UNIMOD:374) | −H₂ per bond | −2.015650 | −2.0159 |
| Head-to-tail cyclisation | −H₂O | −18.010565 | −18.0153 |

The "−2.016" in the task statement is the AVERAGE value. Print both.

**Whole peptides** (pyteomics composition, with RDKit `MolFromSequence` + Δ as route 2; mono agrees to 4 d.p. and avg within 0.03 Da, because the weight tables differ):

| input | formula | mono | avg (pyteomics) |
|---|---|---|---|
| `GRGDSP` | C₂₂H₃₇N₉O₁₀ | 587.2663 | 587.584 |
| `cyclo(GRGDSP)` | C₂₂H₃₅N₉O₉ | 569.2558 | 569.569 |
| `CYIQNCPLG-NH2; disulfide 1-6` (oxytocin) | C₄₃H₆₆N₁₂O₁₂S₂ | 1006.4365 | 1007.189 |
| same, no disulfide | C₄₃H₆₈N₁₂O₁₂S₂ | 1008.4521 | 1009.204 |
| `CYFQNCPRG-NH2; disulfide 1-6` (AVP) | C₄₆H₆₅N₁₅O₁₂S₂ | 1083.4379 | 1084.233 |
| `Ac-SYSMEHFRWGKPV-NH2` (α-MSH) | C₇₇H₁₀₉N₂₁O₁₉S | 1663.7929 | 1664.886 |
| `pGlu-His-Pro-NH2` (TRH) | C₁₆H₂₂N₆O₄ | 362.1703 | 362.384 |
| `AKS[Phospho]PR` | C₂₃H₄₄N₉O₁₀P | 637.2949 | 637.624 |
| `M[Oxidation]AK` | C₁₄H₂₈N₄O₅S | 364.1780 | 364.461 |
| `CAACGGCAAC; disulfide all` | C₂₈H₄₄N₁₀O₁₁S₄ | 824.2074 | 824.970 — mass shown, structure refused (4 Cys, 3 pairings) |

**Third route (RDKit HELM, topology-level):**
- `PEPTIDE1{C.Y.I.Q.N.C.P.L.G}$…1:R3-6:R3` → C₄₃H₆₅N₁₁O₁₃S₂, 1007.4205. This is oxytocin's free acid with the S–S bond: consistent with −H₂ and with −0.984016 for the amide.
- The cyclo-GRGDSP HELM gives C₂₂H₃₅N₉O₉, 569.2558, equal to the table.
- The product's OCL formula of the generated SMILES must equal every formula above (§B5 cross-check).

**Refusals:** `AKpSPR`, `M(ox)AK`, `cyclo-GRGDSP` written as one-letter `cycloGRGDSP`, `pE-HP-NH2`, `CYIQNCPLGC; disulfide all` (3 Cys → odd), `A[Phospho]K`, `cyclo(Ac-GRG)`, `; disulfide 1-4` on a non-Cys. Each gives its named message; none gives a mass.

**Pinned as today:** `H-Gly-Gly-OH` → GG with no warning (the fix); `ACDEFGHIKLMNPQRSTVWY` → C₁₀₇H₁₅₉N₂₉O₃₀S₂, 2394.1249 mono; `SEC` → U.

## E. Codebase-specific risks

1. **`chemValidate.ts` 264, `src.split(/[.·]/)`, is the decimal trap.** `0.5H2O` → H₁₀O₅. The fix is local:
   - split on `·` and `•` always;
   - split on `.` only when followed by an integer coefficient and an uppercase letter;
   - parse a leading decimal coefficient (`0.5`, `½`, `1.5`) as a rational multiplier.

   Note that chempy reads the same string differently: it took `CuSO4.5H2O` as a decimal subscript (O₄.₅, giving O = 5.5, H = 2), so pasted data from Python users is ambiguous. Refuse `.` followed by a decimal digit run that is itself followed by `.`.
2. **`chemParser.ts` 62**, `isCoefficient = !prev || prev.text.endsWith(" ")`. Add "or prev ends with `·`/`•`/`.`". Pin `Na2CO3·10H2O`. Change only that rule: `parseChemical` is the insert path for every Chemical-mode user.
3. **`energy.ts` 752 `formatFormula` is charge-blind**: `Fe2+` → Fe₂+, `[Fe(CN)6]4-` → [Fe(CN)₆]₄-, `MnO4^-` → MnO₄^-. Today only uncharged inputs reach it (Hill strings at taskpane 2941, OCL formulas in MS/Spectra, Engineering fuels), so it is not a live defect. **Do not reuse it** for species or equations. A uses its own `formatSpecies`, and an adversarial test feeds every §D1 ion through it.
4. **Solve routing.**
   - `foldPastedMath` (taskpane 27864) rewrites `Fe2O3` → `Fe2O³` and `2H2` → `2·H²`. `chemistryKindFor` must run on `solveInput.value` before the fold, beside `algebraKindFor` (~27953) and `computationKindFor` (~27981). It must stay out of `transformVerb`.
   - The inequality branch (`/[<>≤≥≠]/` on folded text) catches every `->` today. A `->` reaction that FAILS `parseSpecies` should get a chemistry-specific refusal only when the verb `balance` is present. Otherwise leave today's behaviour, because `f(x) -> 0` must not get a chemistry message.
5. **`reactions.ts` `ARROW_SPLIT`** must not gain `=`: in SMILES `=` is a double bond (`O=C=O`). The formula toggle uses B1's own parser, and the two parsers never share an arrow table.
6. **The formula/SMILES ambiguity** (`CO`, `Co`, `CN`, `NO`, `CS`, `CCO` = C₂O as a formula).
   - Mass Spec (`computeMassSpec` → `Molecule.fromSmiles` fallback) and Structure mode silently pick SMILES.
   - D adds this rule: when a dictionary miss parses BOTH as a valid formula and as SMILES with a different formula, refuse with both readings.
   - Pin `Co` (cobalt 58.933 vs methanol-like CH₃O) and `CN`.
7. **The compound dictionary is not an oracle** (memory: the folate trap).
   - Names resolve to ONE form (`copper sulfate` → anhydrous) and OCL formulas are charge-blind, so B1 sums `getAtomCharge`.
   - Any dictionary-resolved species in a balance prints its resolved formula, so the user can see "anhydrous".
   - No new dictionary entries in this release; adding hydrates goes through the PubChem gate.
8. **Overflow.** Use BigInt in rref. Coefficients reach 299 (§D1). rref fractions grow quickly with 9 species, and the `Number` path gives wrong integers silently past 2⁵³. Test with the K₄Fe(CN)₆ case AND a 20-species stress case under the cap.
9. **Unbounded loops freeze Word.** Set every cap before any work: species, rows, input length, the basis search, the coefficient bound and the disulfide pairing enumeration (≤ 6 Cys for enumeration; mass only above). Each sets a refusal, never a partial result.
10. **Default behaviour must not move.**
    - `translate`, `findOrfs` and `resolveCodon` keep table 1 and ATG-only starts when the options are absent. `codonStart.test`, `dna.test` and `st26Compliance.test` stay green unmodified.
    - The initiator rule is opt-in in `translate`. In ST.26 auto-translation it applies **only when `/transl_table` is given explicitly** (no current fixture starts TTG/CTG/GTG — grep — so those tests stay unmodified). Applying it to table-1 CDSs without the qualifier (TTG/CTG are table-1 starts) changes emitted XML product-wide: raise it as its own decision in the release notes, as the stats brief did with the comma rule; do not settle it inside `sequence.ts`.
11. **The gc.prt data must be verbatim.**
    - Store the 64-character `ncbieaa`/`sncbieaa` strings, not hand-typed maps. The test re-derives every table from the strings and checks it against an inline copy of Biopython's start/stop lists.
    - "Hand-transcribed tables" is how a single wrong codon ships; memory has the compound-dictionary version of that lesson.
12. **Peptide parsing rules move existing results.**
    - Mixed-case refusal and `cyclo`/`Ac-`/`-NH2` recognition change what `buildPeptide` returns for inputs that "worked". Every such input was wrong (§A 5–11), so the change is the fix.
    - The pinned three-letter precedence (`SEC`, `ALA`, `CYS`) and all-lowercase acceptance must not move. Re-run `peptide.test.ts` unmodified.
13. **Ratchets.**
    - `BASELINES.assay` 16 → 17 IN THE SAME COMMIT as `stoich`, which must DRAW from its shipped default (the 10 g H₂ + 10 g O₂ problem).
    - `CORPUS_FLOOR` (194 today; other builders are moving it): D reads the live value at integration and adds +2 (conservation chart, stoich bars).
    - `searchIndex.test` counts the registries; the examples for `reaction`, `dna` and `peptide` (examples.ts) get the new syntax. `statCalcDefaults`-style replays apply to `stoich`'s default.
14. **Display contract everywhere new text appears.**
    - e⁻, H⁺, MnO₄⁻, Fe₂O₃ and → in outputs and errors.
    - "Table 2 (Vertebrate Mitochondrial)", never "transl_table=2", in pane prose.
    - Delta masses with a true minus (−0.984016) and "to" in ranges.
    - Rasterise the INSERTED figures, not the pane preview (memory: "preview is not insert").
