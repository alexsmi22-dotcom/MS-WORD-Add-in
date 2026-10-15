# Scope — Spectroscopy batch: measured-vs-predicted overlay, every stable isotope, diastereotopic protons, cross-conjugated enones

_Written 2026-10-14 against `main` at 48995d9 (v2.137.0). Planned as **v2.138.0**. Line numbers are from that tree. They will drift, so each one is given with its function name._

_**Sources.** A read-only audit of:_
- _engines: `jcamp.ts`, `spectraChart.ts`, `massspec.ts`, `structures.ts` (`resolveChemInput`, `looksWrittenAsFormula`), `nmr.ts`, `nmr2d.ts`, `molgraph.ts`, `ir.ts`, `uvvis.ts`, `fragment.ts`;_
- _the pane handlers `renderJcamp`, `updateSpectra`, `buildSpectrumSvg`, `updateMassSpec`;_
- _the ratchets `scripts/check-figures.js` (`CORPUS_FLOOR = 205`) and `scripts/pane-audit.js` (`BASELINES`: there is no spectra registry)._

_I probed ≈ 110 calls through the lib entry points those handlers call (`parseJcamp`, `resolveMassSpec`, `predictNmr`, `predictCoupling`, `predictIr`, `predictUvVis`, `predictFragments`), from scratchpad Node scripts loaded through `scripts/ts-require.js`. **Nothing in the tree was created or modified**, apart from this file. The two reader fixes in §B1 were tried on a scratchpad COPY of `jcamp.ts`, never on the tree._

_**Oracles,** run this session under `python -I` from the scratchpad venv (Python 3.14):_
- _`jcamp` 1.3.2 (nzhagen), an independent JCAMP-DX decoder;_
- _IsoSpecPy 2.5.0 and molmass 2026.8.15 (two independent isotope tables and convolutions), plus a hand convolution over the CIAAW table below;_
- _RDKit 2026.09.1 (SMILES validity; a substitution-test diastereotopicity classifier);_
- _the CIAAW "Isotopic Compositions of the Elements" table (ciaaw.org/isotopic-abundances.htm), downloaded today (sha256 `1ab770a4…`). **Its heading says 2024, not 2021**; the base reference it cites is Meija et al., *Pure Appl. Chem.* 88, 293 (2016). It lists 92 elements: 84 have a representative composition, and 14 of those are given as intervals (H, Li, B, C, N, O, Mg, Si, S, Cl, Ar, Br, Tl, Pb). §B3 says what that means for single numbers._

_**Measured spectra.** 31 JCAMP-DX files:_
- _the jcamp-dx.org official test set and the R. J. Lancashire compression test set (both via github.com/nzhagen/jcamp, MIT);_
- _NIST WebBook IR + EI-MS for ethanol and acetone (4 files; the WebBook rate-limited further downloads)._

_Wrong answers come first. §D is the exit test._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each read):**
- **`jcamp.ts` `parseJcamp`:** XYDATA `(X++(Y..Y))` with AFFN/PAC/SQZ/DIF/DUP, XYPOINTS, PEAK TABLE `(XY..XY)`; LINK split on `##TITLE=`; DIF y-check and NPOINTS checks; transmittance flag. `meta` keeps every header (`.OBSERVEFREQUENCY`, `$OFFSET`, `STATE`, `MOLFORM`).
- **`spectraChart.ts`:** `jcampChartSvg` (measured trace; IR/NMR/Raman flipped, `FLIP_X` un-negates labels), `decimateTrace` (keeps extrema), `nmrChartSvg`/`irChartSvg`/`msChartSvg`. `MeasuredTrace` keeps the chart independent of `jcamp.ts`.
- **Predictors:** `predictNmr` (additivity; signals = `symmetryClasses`); `predictCoupling` (signals align BY INDEX with `predictNmr`); `predictIr` (bands with a `range`; `irTransmittanceCurve` → %T); `predictUvVis` (Woodward–Fieser λmax only; the figure is the increment ladder); `predictFragments` (EI m/z with a likelihood RANK, not an intensity).
- **`massspec.ts`:** `resolveMassSpec` (v2.137.0 formula-vs-SMILES rule); `isotopePattern`, `ISOTOPES` (15 elements: H C N O F Na Si P S Cl K Br I B Se), `ADDUCTS`; `elementMasses` from OpenChemLib.
- **OpenChemLib 8.21.0** (installed; `^8.0.0`) ships `Molecule.getDiastereotopicAtomIDs()`. **No file in `src/` calls it** (grep). On an H-explicit copy it matches the textbook classification on every §D4 case, meso- vs (R,R)-2,4-dichloropentane included.
- **Pane:** Spectra mode (predicted table + chart); the JCAMP panel (`renderJcamp`, 27504) is a SEPARATE standalone viewer showing block 0 only (27517); Mass Spec mode shows the isotope pattern as HTML bars (26750–26760) and has **no figure**.

**Missing (verified absent by grep 2026-10-14):**
- **Overlay:** no overlay, peak picking, unit conversion (Hz→ppm, %T→A, µm→cm⁻¹), peak-matching table, MOLFORM cross-check or phase check.
- **JCAMP:** no NTUPLES or `(XYW..XYW)` reading, and no block chooser.
- **Isotopes:** no data for 69 of the 84 elements that have a stable composition.
- **NMR:** no diastereotopic split, and no geminal ²J.
- **UV:** only one enone arm is ever scored.

**Probe results, ranked WRONG > SILENT > RIGHT > MISSING, with the exact output.**

*WRONG — a confident answer to a different question (17, plus the 2 scope items N1–N2):*

1. **DUP after DIF repeats the VALUE, not the DIFFERENCE** (`jcamp.ts` 228–237). This is the DIFDUP form, which instruments use for every flat baseline.
   - Synthetic `1 AJT` decodes to y = 1, 2, **2**. The spec gives 1, 2, **3**. There is no caveat, because no y-check follows on the same line.
   - Real files against the oracle:
     - `compound.jdx` block 1: **1,083 of 1,976 points wrong**, by up to 2.4 % of full scale;
     - `brukdif.jdx`: 28 points, 0.45 % FS;
     - `IMSDEMO.DX`: 12 points, 1.7 % FS.
   - The y-check does fire: 34 caveat lines for `compound.jdx` block 1 and 18 for `TESTSPEC.DX`. Even so, the trace is drawn and offered for insertion.
2. **X slips one sample after every DIF y-check** (253–262).
   - The check value occupies the line's first abscissa, but `emitted` stays 0. The first NEW ordinate therefore lands at the line's X instead of X + ΔX.
   - `compound.jdx` x runs 452–4400 (oracle 450–4400). `brukdif.jdx` x runs 1.467 Hz–24 038.5 (oracle 0–24 038.5).
3. **AFFN with an exponent is read as ASDF** (70–84: "NO EXPONENT PARSING").
   - `1 1.0E+00 2.5E-01` → six points (1, 5, 0, 2.5, 5, −1) instead of two.
   - `scientific_notation_example.jdx` (JCAMP 5.01) gives 1,873 points with y from −5 to 4.6. The oracle gives 1,867 points with y from 0 to 1. Only the count caveat appears.
   - JCAMP 5.01 permits E-notation in AFFN.
4. **`##PEAK TABLE=(XYW..XYW)` is read as pairs** (285–292). `1700 80 5 1200 40 3` → (1700, 80), (5, 1200), (40, 3). Silent.
5. **NTUPLES gives a one-point "spectrum".**
   - `BRUKNTUP.DX`, `TESTNTUP.DX` and `TESTFID.DX` each return `ok: true`, kind `nmr`, one point at (0, 0), and no caveat.
   - On a synthetic two-page NTUPLES file, page 1 `(X++(R..R))` was read as XY pairs: (100, 1), (2, 3).
   - Cause: `DATATABLE` falls into the pairs branch, and the block stops at the first `##PAGE=` (192).
6. **On a LINK file the pane shows the wrong block.**
   - In `ethanol_nmr.jdx` (ACD), block 0 is a **4-point PPM peak table**, and it is drawn as a line trace. The 16,384-point spectrum is block 1 (Hz) and is only mentioned ("the first is shown").
   - Titles keep their `$$` comment: "Ethanol $$ Begin of the peaks block".
7. **An Hz NMR trace without DATA TYPE is kind `unknown`, so it is drawn un-reversed.** `1HQuinine.jdx` has `XUNITS=HZ`, 65,536 points and no observe frequency. It is plotted Hz-ascending.
8. **Se is truncated and mislabelled, though it IS in the table** (`massspec.ts` 210 `maxPeaks = 6`; 225 offsets count from the LIGHTEST isotopologue; 316–319 anchoring).
   - `C5H11NO2Se` (selenomethionine) → `M+0 196.9955 1.79 | M+2 198.9922 18.85 | M+3 199.9931 16.47 | M+4 200.9905 48.81 | M+5 201.9935 2.95`.
   - Oracle: the ⁸⁰Se base peak (100 %) is at 196.9955. The 1.79 % peak is ⁷⁴Se at **191.0015** (M−6).
   - So the base peak is cut, nothing reaches 100 %, and every label is 6 Da high.
9. **Boron is mislabelled the same way.**
   - `C6H7BO2` (phenylboronic acid) → `M+0 122.0539 24.44 | M+1 123.0504 100`.
   - Oracle: **M−1 121.0575 24.5 % | M 122.0539 100 %**. The ¹¹B mass is printed against the ¹⁰B peak.
10. **Real isotopologues are silently truncated** by `maxPeaks = 6` (231). The odd M+1/M+3/M+5 slots use up the budget.
    - `C2Cl4` loses **M+6 = 10.2 %** (oracle 10.24).
    - `CHCl3` loses M+6 = 3.3 %.
    - Insulin `C254H377N65O75S6` stops at M+5. It loses M+6 51.8 %, M+7 31.5 %, M+8 17.3 % and M+9 8.7 %, with no note.
11. **Untabulated elements give a confidently wrong shape.** The pane says "Pattern excludes Hg…; masses and adducts are still exact".
    - `HgCl2` → `M 100 | M+2 63.9 | M+4 10.2`, which is chlorine only.
    - Oracle: `M−4 22.1 | M−3 36.9 | M−2 64.6 | M−1 52.5 | M 100 | M+1 22.3 | M+2 62.1 | M+3 3.0 | M+4 16.3 | M+6 1.5`.
    - The same failure: `SnCl4`, `C12H27ClSn`, `CH3HgCl`, `C10H10Fe`, `FeCl3`, `Fe(CO)5`, `W(CO)6`, `OsO4`, `Cu(NO3)2`, `MgCl2`, `Cl2H6N2Pt`.
    - For cisplatin the true base peak is **M+1** (¹⁹⁵Pt). We print M = 100.
12. **OpenChemLib's monoisotopic masses are wrong for some elements** (`elementMasses` 372–389 trusts OCL; the SMILES path uses OCL `absoluteWeight` directly). A sweep of all 84 CIAAW elements against IsoSpec's most-abundant-isotope mass found two stable-element errors:
    - **Cu: OCL 62.93960, true ⁶³Cu 62.92960 (+10.0 mDa).** `Cu(NO3)2` → mono 186.91524; the oracle gives 186.90523. That is 54 ppm, so every Cu compound fails a high-resolution match.
    - **Pa: OCL 216.01896 (²¹⁶Pa), true ²³¹Pa 231.03588 (−15 Da).**
    - Every other element agrees to ≤ 0.5 mDa.
    - The elements with no stable isotope get invented masses: `TcO4` → mono 153.9035 (implies ⁹⁰Tc); `PoCl2` implies Po = 193.99; `RaCl2` implies Ra = 206.00.
    - The adduct table is computed from those masses. "Masses and adducts are still exact" is false here.
13. **The v2.137.0 resolver reads perhalo formulas as SMILES** (`structures.ts` 332–346 `looksWrittenAsFormula`).
    - Cause: paired digits are treated as ring closures, and OpenChemLib accepts a ring closure that duplicates an existing bond.
    - `C6Cl6` → chloromethane CH₃Cl, 49.99. `C6F6` → CH₃F. `C6Br6`, `C2Br2`, `C3Br3` → CH₃Br. `C2Cl2` → CH₃Cl.
    - The note names the formula reading, but the answer is the SMILES one.
    - RDKit rejects `C6Br6`: "ring closure 6 duplicates bond between atom 0 and atom 1".
14. **UV λmax depends on SMILES atom order** (`uvvis.ts` 531 `const e = enones[0]`). For one molecule with two separate enones:
    - `CC(=O)/C=C/CCCC1=CC(=O)CCC1` → **227**;
    - `O=C1CCCC(CCC/C=C/C(C)=O)=C1` → **239**.
    The header (37–38) promises that the answer "cannot depend on … SMILES atom ordering".
15. **Cross-conjugated dienones: the arm is picked by atom order.**
    - Prednisone → 239 (the C4=C5 arm).
    - Androsta-1,4-diene-3,17-dione (`O=C1C=CC2(C)C(=C1)CCC1C2CCC2(C)C1CCC2=O`) → **227** (the C1=C2 arm).
    - It is the same chromophore. The more substituted arm sums to 239.
16. **Quinones are scored as Woodward–Fieser enones:**
    - p-benzoquinone → 227 ("β-alkyl / ring residue ×1");
    - 2-methyl-p-benzoquinone → 239;
    - duroquinone → 249.
    A quinone is not a WF chromophore.
17. **Aryl (styryl) enones get a plausible wrong number** labelled "indicative only".
    - Benzalacetone `CC(=O)C=Cc1ccccc1`, chalcone and dibenzylideneacetone each → 227.
    - Their literature λmax values lie roughly 60–100 nm higher. Builder: pin the exact values from NIST UV or SDBS at build time.
    - Scott's rules apply to ArCOX, not to styryl systems.

*The diastereotopicity scope items, also WRONG:*
- **N1. Diastereotopic methyls collapse into one class.**
  - Cause: `molgraph.ts` 549 `symmetryClasses` uses `cHelperSymmetrySimple`. `cHelperSymmetryStereoHeterotopicity` gives the same ranks (probed).
  - `CC(C)C(O)C` ¹³C → 4 signals, one of them `18.1/2`. There are 5 carbon environments: the two iPr methyls are diastereotopic.
  - Valine ¹H → `0.87/6d`, where two 3H doublets are expected. Leucine fails the same way.
- **N2. A diastereotopic CH₂ is reported as a clean n+1 multiplet.**
  - Acetaldehyde diethyl acetal OCH₂ → `q(7)`. This is the textbook ABX₃ case.
  - 2-butanol C3H₂ → `quint(7)`. Glycerol CH₂ → `d(7)`.
  - Only the generic caveat at `nmr2d.ts` 285–288 appears.

*SILENT (8):*
1. **Corrupt traces stay insertable.** The JCAMP y-check failures are listed one per line (34 for one block; 253 across the corpus), and **Insert chart** stays enabled on the known-corrupt trace.
2. **Phase is ignored.** NIST IR files say `##STATE=gas`, and the predicted IR assumes the condensed phase. The metadata is read and never used.
   - Ethanol: predicted O–H 3350 [3200–3600] br; measured 3674 (free O–H, gas).
   - Acetone: predicted C=O 1715 [1705–1725]; measured 1738.
3. **Referencing.** `BRUKPAC.DX` is ethylbenzene ¹³C at 100.4 MHz, in Hz.
   - Hz ÷ SF puts the CDCl₃ triplet centre at 86.25 ppm, against 77.16.
   - `##$OFFSET=239.4273` agrees with that axis, so a naive conversion puts **every peak +9.09 ppm high**.
4. **MOLFORM is never compared.** Every NIST file has `MOLFORM` (`C 2 H 6 O`, with spaces), and nothing checks it against the predicted structure. `parseFormula` would mis-read the spaced form.
5. **Mass Spec labels count from the wrong peak.** `M+${offset}` (taskpane 26758/26814) counts from the lightest isotopologue, not from M.
6. **The abundances are IUPAC-1997-era values.** S is 0.9493/0.0076/0.0429/0.0002, against 0.9499/0.0075/0.0425/0.0001 in 2016. The shape error is ≤ 0.3 percentage points on every §D3 formula.
7. **The enone branch has no exocyclic-C=C increment and no caveat.**
   - Testosterone → 239. The textbook worked example is 215 + 12 + 12 + 5 = 244 (observed 241).
   - The diene branch's caveat (688) says the increment "requires 3D ring context". It does not: exocyclicity is a graph property.
8. **Out of scope, but the overlay will expose it** (recorded for a follow-up):
   - ¹³C additivity is far off for a carbon bearing two O/N: acetal CH 122.8 (acetal carbons sit near 100), valine Cα 75.6 (≈ 61 measured), glycerol CH 83.9 (≈ 72 measured).
   - The IR rules predict no C–O stretch for an alcohol. Ethanol's strongest measured band is at 1066 cm⁻¹.

*RIGHT (keep and pin):*
- **The decoder is exact against the oracle** (0 points differ) for `BRUKPAC.DX`, `BRUKSQZ.DX` (16,384), `PE1800.DX`, `LABCALC.DX`, `fixdec1.jdx`, NIST ethanol IR (880) and `2Methyl1Propanol.jdx`; XYPOINTS (`toluene.jdx` UV, log ε); PEAK TABLE `(XY..XY)` MS (NIST ethanol and acetone, `Tetrachloroethylene_ms.jdx`, `ISAS_MS1.DX`, `pktab1.jdx`).
- **Cl, Br and S patterns** agree with the oracles to ≤ 0.1 point while the peaks fit inside the 6-peak window: `C6H4Br2` 51.35/100/48.77; `CHCl3` 100/95.88/30.65; `C6H5Cl` 100/6.55/32.14.
- **Resolver:** `Co` → cobalt; `Fe2O3` → formula masses; `[13CH4]` → 17.0347.
- **UV inside its domain:** mesityl oxide 239 (= 215 + 2×12), isophorone 239, cyclohexenone 227, 3-methylcyclopent-2-enone 226. Prednisone and dexamethasone are within 5 nm and flagged.
- **IR/NMR axis flips,** with the labels un-negated.

*MISSING:* the overlay and everything under it (block chooser, Hz→ppm with referencing, %T↔A, µm/nm→cm⁻¹, peak picking, match table, MOLFORM and phase checks, an MS stick or head-to-tail figure); the diastereotopic split and geminal ²J; isotopes for 69 elements and a Mass Spec figure; a per-arm enone ledger and the quinone and aryl-enone refusals.

**Reuse inventory:** `decimateTrace`, `buildPlotSvg` + `FLIP_X`, `irTransmittanceCurve` (%T, 400–4000 step 4), `nmrSticks`, `ladderSvg`; the insert path `readSvgDims`/`renderFigurePng`/`sizeFigure` (taskpane); `parseFormula` (strip the spaces in `MOLFORM` first), `resolveMassSpec`, `assemble`, `ADDUCTS`; `getDiastereotopicAtomIDs` (OCL); `findEnones`, `alkylSubstituentCount` (uvvis).

## B. Inputs, outputs, figures

### B1. `jcamp.ts` — reader fixes (pure, landed before any overlay)

1. **DIFDUP.** A DUP token repeats the previous TOKEN, so after a DIF it repeats the difference (y advances by Δ each time). On a scratch copy, `compound.jdx`, `brukdif.jdx` and `IMSDEMO.DX` then match the oracle exactly, and **every y-check in the 31-file corpus passes** (0 caveats, down from 253).
2. **The y-check occupies an abscissa.** After adopting the check value, count it as emitted (no point pushed), so the next ordinate lands at X + ΔX. Scratch copy: |Δx| = 0 for `compound.jdx`, ≤ 1e-11 for `brukdif.jdx`.
3. **AFFN exponents.** A line is AFFN-with-exponent only if every whitespace/comma-separated token is a plain number or matches `^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$`, and no other ASDF character appears. Decode both readings and keep the one that matches `NPOINTS`; if both or neither match, **refuse the block by name** ("ambiguous E: an exponent, or SQZ +5").
4. **Tuple forms come from the declared variable list** (`(XY..XY)`, `(XYW..XYW)`, `(XYM..XYM)`, `(XYA)`). Read the whole n-tuple; keep W and M in `peakExtras`. An undeclared form is refused by name.
5. **NTUPLES.** For `##NTUPLES=NMR SPECTRUM` (1D), parse `VAR_NAME/SYMBOL/UNITS/FIRST/LAST/FACTOR/VAR_DIM` and every `##PAGE=` with its `##DATA TABLE=(X++(R..R)), XYDATA`. Return the **real** page; report the imaginary page as present but unused.
   - **Refused by name:** `NMR FID` ("needs Fourier transform and phasing; export the processed spectrum"); `nD NMR SPECTRUM`; an NTUPLES whose real page cannot be identified; GC-MS NTUPLES ("N scans — export one spectrum").
   - **A one-point result is never `ok`.**
6. **Hygiene.** Strip `$$…` from header values. The kind is `nmr` when `.OBSERVE NUCLEUS` is present (`^1H` → `"1H"`, `^13C` → `"13C"`), or when x is Hz and DATA TYPE says NMR. Any y-check that still fails sets `corrupt: true`: the block is **not offered for overlay or insert**, and its caveat is one summary line ("12 DIF checks failed; first near x = …").
7. **Block chooser (pane).** List every block with its title, kind, x units and point count. The default is the first block of a supported kind with ≥ 32 points: a full trace beats a peak table.

### B2. `spectrumOverlay.ts` (new) — measured vs predicted

**Inputs:** the current Spectra-mode prediction (`1H`, `13C`, `ir`, `uvvis`, `ms`) or the Mass Spec isotope pattern, and one non-corrupt JCAMP block.

**Refused by name (compatibility):**
- the kinds differ: "this file is an IR spectrum; the prediction is ¹H NMR";
- the NMR nucleus differs (`.OBSERVE NUCLEUS` ≠ the predicted nucleus);
- Raman, IMS or unknown kinds: "no prediction exists for Raman";
- 2D overlays (COSY/HSQC/HMBC/TOCSY): the reader refuses 2D files.

**Axis normalisation.** One table drives every conversion, and the output names each conversion it made.

| technique | file x | display x | needs |
|---|---|---|---|
| NMR | PPM | δ (ppm), reversed | — |
| NMR | HZ | δ = OFFSET − (FIRSTX − x)/SF when `$OFFSET` and `$SF` are given; else `.SHIFT REFERENCE`; else x / `.OBSERVE FREQUENCY`, marked **unreferenced** | the observe frequency; without it, refuse: "x is in Hz and the file gives no observe frequency" |
| IR | 1/CM, CM-1 | cm⁻¹, reversed | — |
| IR | MICROMETERS, NANOMETERS | 10⁴/x or 10⁷/x cm⁻¹ | — |
| UV-Vis | NANOMETERS, "Wavelength (nm)" | nm | — |
| UV-Vis | 1/CM | 10⁷/x nm | — |
| MS | M/Z | m/z (sticks) | — |

**Y conventions.**
- **IR:** TRANSMITTANCE (0–1, or % when max > 1.5) → A = −log₁₀T for peak picking; T ≤ 0 points are dropped and counted. REFLECTANCE and KUBELKA-MUNK are refused by name. The display keeps the **file's** convention and converts the predicted curve to it: measured data is never transformed for display.
- **NMR, UV:** both series normalised to their own maximum; the axis says "normalised intensity".
- **MS:** acquired sticks up, predicted **down** (head-to-tail). Predicted fragment heights are a ranking (the caption says so); isotope-pattern heights are real intensities.

**Peak picking (acquired),** deterministic: local maxima (minima for %T) ≥ 5 % of range; minimum separations 0.02 ppm (¹H), 0.5 ppm (¹³C), 10 cm⁻¹, 2 nm, and for MS 0.5 m/z (unit-mass data, every x integral) or 10 ppm (high-resolution). At most 200 peaks, cap stated.

**Matching.** Each predicted line, strongest first, takes the nearest unused acquired peak inside its window: ¹H ±0.5 ppm, ¹³C ±8 ppm, IR the band's own `range`, UV ±20 nm, MS ±0.5 (unit) or ±10 ppm. Output:
1. a table: predicted · assignment · nearest acquired · Δ (pred − acq, true minus) · within window ✓/—;
2. "Measured peaks with no prediction" (the strongest 10);
3. **"A prediction is not an assignment: a nearest peak is proximity, not identity."**

**Checks — each a caveat, never a silent correction:**
1. **Referencing offset:** ≥ 3 matches, |median Δ| > ½ window and MAD < ¼ window → "the measured axis looks offset by +9.09 ppm. Check the referencing." An optional **"reference at"** input (solvent peak: measured δ → true δ) shifts the MEASURED axis. Nothing is shifted automatically.
2. **Phase:** `##STATE=gas` with an IR prediction → "gas-phase spectrum: O–H and C=O sit higher than the condensed-phase values predicted".
3. **Identity:** `##MOLFORM` (spaces stripped) ≠ the predicted formula → "this file is C₂H₆O; the prediction is for C₃H₆O". The overlay is still drawn: the comparison may be deliberate.

**Figure** (`overlayChart.ts`, new): measured series (decimated, blue, "measured — ‹title›") and predicted series (second colour, "predicted (estimate)"); sticks for NMR, a curve for IR, a dashed λmax marker for UV, head-to-tail for MS; x reversed for NMR and IR; legend. **The title is measured and truncated**, so the existing CLIPPED waiver does not spread (§E8).

**Pane:** Spectra mode gains **Overlay a measured file…**; Insert places the chart plus the match table as text. Mass Spec mode gains an isotope-pattern stick figure and the same overlay against an MS file.

### B3. `isotopes.ts` (new) + `massspec.ts` — every stable isotope

**Data.**
- Every element with a CIAAW representative composition: 84 elements, H…U minus Tc, Pm, Po, At, Rn, Fr, Ra and Ac.
- Store the table **verbatim**, as strings, with the edition and sha256. Derive the numbers at load (the gc.prt lesson).
- Masses come from AME2020 (Wang et al., *Chin. Phys. C* 45, 030003, 2021).
- **The 14 interval elements need one number each.** Use the NIST "Atomic Weights and Isotopic Compositions" representative value. The test asserts that the stored value lies **inside** the CIAAW interval.
- **The brief asked for IUPAC 2021; the live table says 2024.** The builder records which edition shipped and never mixes editions quietly.

**Refused by name:**
- An element with no representative composition: "Tc has no stable isotope; its pattern depends on the source — write the isotope, e.g. ⁹⁹Tc".
  - The refusal covers the pattern AND the monoisotopic mass (§A-12).
  - Builder: test whether OCL accepts `[99Tc]`, and route an explicit isotope to an exact single-isotope mass.
- Z > 92.

**Algorithm.**
- **M is the monoisotopic peak: the most abundant isotope of every element** (IUPAC usage). Peaks are labelled relative to M (`M−6 … M+n`, with a true minus).
- Peak masses come from the convolution itself. The anchoring trick at 316–319 is deleted.
- **The mass reference is AME2020, not OpenChemLib** (§A-12: OCL is 10 mDa off for Cu and 15 Da off for Pa). Every monoisotopic and adduct mass, on the formula path AND the SMILES path, is recomputed from the element counts with `isotopes.ts` masses. An OCL `absoluteWeight` that disagrees by > 1 mDa is reported in a test log and never used. It must not trigger a refusal: that would refuse every Cu compound.
- Keep **every** peak ≥ 0.1 % of base (cap 60), and say "k further peaks below 0.1 %". `maxPeaks: 6` goes: it is the §A-10 defect.

**Caps.** Elements with 7–10 isotopes (Sn, Xe, Hg, Cd, Te) widen the distribution faster than Se. Re-measure `MAX_ATOMS_PER_ELEMENT` inside jest for Sn and Hg, and set a per-element cap that keeps the worst case ≤ 200 ms.

**Resolver (§A-13).**
- `readAsSmiles` rejects a SMILES whose ring closure joins two atoms that are already bonded, as RDKit does.
- `C6Cl6`, `C6F6` and `C6Br6` then fall to the formula reading.
- `CN`, `Co`, `CCO`, `C1CC1` and decalin must route exactly as in v2.137.0.

**Figure:** an isotope-pattern stick chart (`isotopeChart.ts`, new). It plots m/z against relative intensity, marks M, and labels M−n/M+n. It is also the MS predicted series for B2.

### B4. NMR — diastereotopic groups and geminal coupling (`diastereotopic.ts`, new)

**Feasible and honest:**
- **Classification.** Run `getDiastereotopicAtomIDs()` on an **H-explicit copy** made with `addImplicitHydrogens` (heavy-atom indices are preserved — pin that). It yields:
  - (a) heavy-atom classes that refine `symmetryClasses`, so diastereotopic methyls become two classes;
  - (b) for each CH₂, whether its two H are diastereotopic.
  `symmetryClasses` itself is NOT changed (§E5).
- **¹H and ¹³C output.**
  - Diastereotopic methyls become **two signals at the same predicted δ**: 3H + 3H in ¹H, 1C + 1C in ¹³C. Each is labelled "diastereotopic: expected to differ; the difference is not predicted".
  - Valine ¹H then reads 0.87/3d, 0.87/3d. The `CC(C)C(O)C` ¹³C count goes from 4 to 5.
- **A CH₂ with diastereotopic H** stays ONE row with a count of 2.
  - Its multiplet becomes `m`, with the note "diastereotopic CH₂ (AB part of ABX…): ²J typically 10–15 Hz, Δδ not predicted".
  - It is never reported as `q`, `t` or `quint`.
- **Typical geminal |²J| by class** (Pretsch/Bühlmann/Badertscher tables, which nmr2d already cites). The sign is not observable to first order, so the magnitude is shown.
  - sp³ CH₂: 12–15 Hz;
  - CH₂ α to C=O or a π system: 14–18 Hz;
  - cyclopropane: 4–9 Hz;
  - terminal =CH₂: 0–3 Hz.
  Builder: transcribe these from the cited table, not from this brief.
- **Undetermined relative configuration.** Sometimes the classification depends on the relative configuration of **unspecified** stereocentres: in `CC(Cl)CC(C)Cl`, the meso form is diastereotopic and the (R,R) form is not. Say so by name. Do not pick one.
- **COSY/HSQC/HMBC/TOCSY.**
  - Rows follow the new signal list. HSQC keeps one cross-peak per carbon, with the H count unchanged.
  - The `predictCoupling`↔`predictNmr` index alignment must hold (see the taskpane comment in the 1H branch).

**Refused, or kept as a stated limit:**
- no Δδ prediction between diastereotopic partners;
- no second-order (AB/ABX) line positions;
- no ²J/³J from geometry (Karplus);
- no diastereotopicity for exchange-averaged groups (OH, NH).

### B5. UV — every enone arm, and refusals by name (`uvvis.ts`)

**Score every entry of `findEnones`,** each with its own ledger.
- λmax = **the maximum over the arms**. The ladder figure shows the winning arm, and the text lists every arm with its value.
- This removes the atom-order dependence (§A-14, §A-15), for separate enones and cross-conjugated dienones alike.
- The existing dienone flag and its wording stay.

**Refused by name:**
- **Quinones** (a ring holding two C=O conjugated through ring C=C): "quinone chromophore — not a Woodward–Fieser enone".
- **Aryl/styryl enones** (an aromatic atom conjugated to the enone β-carbon or to the C=O). Today these are "indicative only"; they become "aryl-conjugated enone — Woodward–Fieser does not apply; no value is given".
- Follow-ups, not this release: Scott's rules for ArCOX, and acetophenone's "benzene B-band 254" (acetophenone is a K-band chromophore).

**Exocyclic C=C (+5).**
- Make the caveat true in BOTH branches: delete "requires 3D ring context" and say "not applied".
- **Add the caveat to the enone branch,** which lacks it today.
- **Applying the increment is decision D-1** (§E7). It moves prednisone from 239 to 244 (measured 238), which breaks the existing ±5 pin.
- Recommendation: defer the increment and ship the honest caveat.

## C. Build order, honest limits, disjoint split

**Order:**
1. **Engines in parallel,** each pure with its own tests meeting §D: A (reader, overlay engine, overlay figure); B (isotopes, resolver fix, isotope figure); C (NMR); D (UV).
2. **E integrates:** pane, HTML, the figure corpus and its floor, examples, TEST-SCRIPT.
3. **An INDEPENDENT adversarial pass** over the whole diff, aimed at: DIF/DUP/SQZ interleavings and E-vs-SQZ lines; NTUPLES junk; Hz files whose `$OFFSET` and `.SHIFT REFERENCE` conflict; %T as 0–1 vs 0–100; the head-to-tail sign; M−n labels; Tc, Pm and `[99Tc]`; the C6Cl6 class against ring SMILES that must stay SMILES; meso/dl and unspecified stereo; enone arms under 20 random atom orders per molecule.
4. **§D is the exit test,** then full QC.

**Build split. The files are disjoint, and `taskpane.ts` has exactly one owner.**

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — JCAMP + overlay** | `src/lib/jcamp.ts`; `src/lib/spectrumOverlay.ts` (new); `src/lib/overlayChart.ts` (new); `__tests__/jcamp.test.ts` (extend), `jcampCorpus.test.ts`, `spectrumOverlay.test.ts`, `overlayChart.test.ts` (new); fixtures under `__tests__/fixtures/jcamp/` (§E10) | the `nmr.ts`, `ir.ts`, `uvvis.ts`, `fragment.ts` and `massspec.ts` types; `spectraChart.ts` (`decimateTrace`, `FLIP_X`: import, never edit — if an export is missing, E adds it in step 1) |
| **B — isotopes + MS resolver** | `src/lib/isotopes.ts` (new); `src/lib/massspec.ts`; `src/lib/structures.ts` (the `readAsSmiles` duplicate-ring-bond rule only); `src/lib/isotopeChart.ts` (new); `__tests__/massspec.test.ts` (extend, never loosen), `isotopes.test.ts` (new); `chembioRouting.test.ts`, `chembio.review.test.ts` (extend) | `chemValidate.ts` |
| **C — NMR** | `src/lib/diastereotopic.ts` (new); `src/lib/nmr.ts`; `src/lib/nmr2d.ts`; `__tests__/diastereotopic.test.ts` (new); `nmr.test.ts`, `nmr2d*.test.ts`, `dept.test.ts` (extend) | **`molgraph.ts`, read only**: six predictors share it (fragment, ir, nmr, nmr2d, pka, uvvis) |
| **D — UV** | `src/lib/uvvis.ts`; `__tests__/spectraDomainLimits.test.ts` (extend), `uvEnoneArms.test.ts` (new) | `molgraph.ts` |
| **E — integrator** | `src/taskpane/taskpane.ts` + `.html`; `src/lib/spectraChart.ts` (exports only); `scripts/figure-layout-run.ts`; `scripts/check-figures.js`; `src/lib/examples.ts`; `docs/TEST-SCRIPT.md`; `caveatWording.test.ts` | the engine APIs from A–D, frozen at the end of step 1 |

**Honest limits (say them in the UI):**
- **Overlay:** a match is proximity, not an assignment. No baseline correction, phasing, deconvolution or integration of the measured trace. Referencing is the file's own unless the user gives a reference peak (no solvent-peak recognition). Predicted heights are estimates; MS fragment heights are a ranking. A block that fails its own checksum is not overlaid.
- **JCAMP:** supported — AFFN (E-notation under the §B1-3 rule), PAC, SQZ, DIF, DUP, DIFDUP; XYDATA, XYPOINTS; PEAK TABLE (XY, XYW, XYM); LINK; 1D NMR NTUPLES (real page). Refused by name — FID, nD NMR, GC-MS NTUPLES, REFLECTANCE/KUBELKA-MUNK y, undeclared tuple forms, ambiguous E lines.
- **Isotopes:** natural representative composition only (no enrichment); no fine structure (nominal-mass groups with an intensity-weighted mass); interval elements carry one value inside the IUPAC interval, and real samples vary.
- **NMR:** diastereotopic TOPOLOGY only. No Δδ, no second-order patterns, no Karplus.
- **UV:** Woodward–Fieser arms only. Quinones, aryl enones, extended or branched systems and porphyrins are refused.

## D. Acceptance audit (independent oracle beside every value)

### D1. JCAMP decode

Oracle: `jcamp` 1.3.2 (Python), compared point for point after sorting by x.

| file | n | requirement after the fix | today |
|---|---|---|---|
| `compound.jdx` block 1 (DIFDUP) | 1,976 | max \|Δy\| = 0; x 450–4400; 0 y-check failures | 1,083 points wrong, x from 452, 34 failures |
| `brukdif.jdx` | 16,384 | Δy = 0; x 0–24 038.5 (\|Δx\| ≤ 1e-9 FS) | 28 wrong, x from 1.467 |
| `IMSDEMO.DX` | 1,000 | Δy = 0; \|Δx\| ≤ 0.001 | 12 wrong |
| `scientific_notation_example.jdx` | 1,867 | y from 0 to 1; no count caveat | 1,873 points, y from −5 to 4.6 |
| `BRUKPAC.DX`, `BRUKSQZ.DX`, `PE1800.DX`, `LABCALC.DX`, `fixdec1.jdx`, NIST ethanol IR, `2Methyl1Propanol.jdx` | as file | stay exact (Δy = 0) | exact (pin) |
| `1HQuinine.jdx` | 65,536 | Δy = 0, \|Δx\| ≤ \|ΔX\| = 0.0976 Hz; kind `nmr`; overlay **refused**: no observe frequency | kind `unknown` |
| synthetic `1 AJT` | 3 | y = 1, 2, 3 | 1, 2, 2 |
| synthetic `(XYW..XYW)` `1700 80 5 1200 40 3` | 2 | (1700, 80, w 5), (1200, 40, w 3) | 3 garbage pairs |
| `BRUKNTUP.DX` (and `TESTNTUP.DX` from its own header) | `VAR_DIM` = 16,384 (real page) | the file's own header is the oracle (Python `jcamp` returns 0 points here): `FIRST`/`LAST` = x 24 038.5 → 0, R 2 254 931 → 1 513 177; `FACTOR` x = 1.46728; 2 pages; the y-check passes; the imaginary page is reported and unused | 1 point (0, 0), `ok: true` |
| `TESTFID.DX` | — | refused: "NMR FID — needs Fourier transform" | 1 point |
| `ethanol_nmr.jdx` | 2 blocks | the default block is the 16,384-point spectrum; titles have no `$$` | the 4-point peak table, drawn as a line |

### D2. Overlay engine

Measured: the files above. Predicted: today's predictors.

**¹³C ethylbenzene vs `BRUKPAC.DX`** (Hz, SF 100.4).
- **The identification is inferred.** The file's own header says `TITLE=test32` and `$SOLVENT=<MeOH>`. Its y range equals that of `TESTSPEC.DX` ("ETHYLBENZOL/CDCL3"), its 86.25 line is a 1:1:1 triplet, and its peak spacings match ethylbenzene. Do not trust the header's solvent.
- Conversion: 24 038.5 Hz → 239.43 ppm (= `$OFFSET`).
- **Unreferenced**, the match table must show a median Δ ≈ −9.1 ppm and the "+9.09 ppm" offset caveat. Nothing is auto-shifted.
- With the user reference CDCl₃ = 77.16 (the measured triplet centre is 86.25):
  - measured (Python peak pick, numpy): 144.48 · 128.53 · 128.08 · 125.80 · 28.98 · 15.70;
  - predicted: 144.2 · 128.4 · 127.9 · 125.7 · 29.8 · 15.8;
  - Δ = −0.3, −0.1, −0.2, −0.1, +0.8, +0.1. All are within ±8: **6/6 matched**. The CDCl₃ lines are listed as unmatched.

**¹H 2-methyl-1-propanol vs `2Methyl1Propanol.jdx`** (ppm, 300.15 MHz).
- Measured multiplet centres: 3.40 (d), 2.11 (OH), 1.77 (m), 0.92 (d).
- Predicted: 3.70, 2.00, 1.85, 0.87.
- Δ = +0.30, −0.11, +0.08, −0.05: **4/4 within ±0.5**.

**IR ethanol vs NIST** (gas, absorbance).
- 3350 [3200–3600] → nearest 3674, **outside**.
- 2925 [2850–2960] → nearest 2978, outside.
- 1460 [1440–1480] → nearest 1394, outside.
- **0/3 matched.** The gas-phase caveat appears, and the unmatched measured peaks lead with 1066.
- That is the honest answer. A matcher that reports 3/3 here is wrong.

**IR acetone vs NIST** (gas). 1715 [1705–1725] → nearest 1738, outside, with the phase caveat. 2925 → 2970, outside.

**MS acetone vs NIST** (unit mass).
- Predicted: 58 (M), 43 (h), 30 (m), 15 (l).
- Measured: 58 at 24.8 %, 43 at 100 %, 30 **absent**, 15 at 12.0 %.
- **3/4 matched**; 30 is listed as unmatched.
- Head-to-tail sign: measured > 0, predicted < 0.

**MS ethanol vs NIST.**
- Measured: 46 at 21.6 %, 31 at 100 %, 29 at 29.9 %, 28 at 3.5 %, 15 at 6.6 %, and 45 (M−1) at 51.5 %.
- 45 is not predicted. It must appear under "measured peaks with no prediction".

**Isotope pattern C₂Cl₄ vs `Tetrachloroethylene_ms.jdx`** (EI).
- Measured M cluster: 164 at 80.8 · 166 at 100 · 168 at 50.2.
- Predicted (oracle): 78.1 · 100 · 48.0 · M+6 10.2.
- All match within ±0.5. The M+6 line must exist: its absence is the §A-10 defect.

**UV toluene vs `toluene.jdx`** (nm, log ε). Measured global maximum 260.6 nm; predicted 254. Δ = −6.6, **within ±20**.

**Refusals and caveats:**
- a ¹H prediction against `BRUKPAC.DX` → refused: nucleus mismatch (it is a ¹³C file);
- an IR prediction against `toluene.jdx` → refused: kind mismatch;
- MOLFORM `C 2 H 6 O` against predicted acetone → an identity caveat naming both formulas.

### D3. Isotope patterns

Oracles: IsoSpecPy, molmass, and a hand convolution on the CIAAW table; all three agree to ≤ 0.4 points. Values are relative %, base = 100, and labels count from M (the most abundant isotopes).

| formula | expected |
|---|---|
| `C10H10Fe` (ferrocene) | M−2 184.0179 6.37 · M−1 0.70 · **M 186.0132 100** · M+1 13.3 · M+2 1.1 |
| `FeCl3` | M−2 6.00 · M 100 · M+1 2.18 · M+2 92.6 · M+4 29.4 · M+6 3.18 |
| `C6H4Br2` | M 233.8680 51.35 · M+1 3.37 · M+2 100 · M+3 6.55 · M+4 48.77 · M+5 3.19 (unchanged) |
| `CHCl3` | M 100 · M+2 95.99 · M+4 30.71 · **M+6 3.28** |
| `C2Cl4` | M 78.13 · M+2 100 · M+4 48.00 · **M+6 10.24** · M+8 0.82 |
| `C5H11NO2Se` | **M−6 191.0015 1.80** · M−4 18.85 · M−3 16.47 · M−2 48.81 · M−1 2.96 · **M 196.9955 100** · M+1 6.0 · M+2 18.11 · M+3 1.08 |
| `C6H7BO2` | **M−1 121.0575 24.5** · M 122.0539 100 · M+1 6.7 · M+2 0.60 |
| `C12H27ClSn` | M−8 2.31 · M−6 2.33 · M−4 35.2 · M−3 23.2 · M−2 71.4 · M−1 35.6 · M 326.082 100 · M+1 19.5 · M+2 37.5 · M+4 17.6 · M+6 4.55 |
| `SnCl4` | M−4 22.0 · M−2 59.7 · M−1 25.7 · M 259.775 100 · M+1 21.7 · M+2 86.9 · M+4 48.3 · M+6 20.4 · M+8 6.2 |
| `CH3HgCl` | M−4 26.7 · M−3 45.3 · M−2 70.7 · M−1 50.4 · M 251.962 100 · M+1 12.4 · M+2 44.0 · M+4 5.9 |
| `HgCl2` | M−4 22.1 · M−3 36.9 · M−2 64.6 · M−1 52.5 · M 100 · M+1 22.3 · M+2 62.1 · M+4 16.3 · M+6 1.54 |
| `Cl2H6N2Pt` (cisplatin) | M−3 1.70 · M−1 71.6 · M 298.9556 73.1 · **M+1 100** · M+2 47.2 · M+3 58.0 · M+5 15.7 |
| `MgCl2` | M 100 · M+1 12.7 · M+2 77.9 · M+3 8.1 · M+4 19.2 · M+6 1.43 |
| `W(CO)6` | M−2 82.9 · M−1 50.3 · M 351.9204 100 · M+2 90.3 · M+3 6.1 |
| `OsO4` | M−6 3.9 · M−5 4.8 · M−4 32.3 · M−3 39.5 · M−2 64.4 · M 255.9411 100 |
| `Cu(NO3)2` | **M 186.9052** 100 · M+2 45.85 (today: mono 186.9152, +10 mDa) |
| `[Cu]`, `Pa` | mono 62.92960 (⁶³Cu); 231.03588 (²³¹Pa) — today 62.93960 and 216.01896 |
| insulin `C254H377N65O75S6` | IsoSpec: M 15.7 · M+1 49.1 · M+2 83.2 · **M+3 100** · M+4 95.0 · M+5 75.4 · **M+6 51.8 · M+7 31.5 · M+8 17.3 · M+9 8.7** (all shown) |
| `TcO4`, `PoCl2`, `RaCl2`, `Ac`, `Np` | refused by name: no pattern and no mono mass |
| `[13CH4]` | 17.0347 (unchanged) |
| `C6Cl6`, `C6F6`, `C6Br6` | formula reading: C₆Cl₆ M 281.8131 52.0 · M+2 100 · M+4 80.1 · M+6 34.2 · M+8 8.24; C₆F₆ M 185.9904 100 · M+1 6.5; C₆Br₆ M 545.5100 5.42 · M+2 31.7 · M+4 77.05 · **M+6 100** · M+8 73.0 |
| `CN`, `Co`, `CCO`, `C1CC1`, `C1CCC2CCCCC2C1` | exactly as in v2.137.0 (pin) |

**Tolerance:**
- ±0.3 percentage points where the shipped table is the oracle's edition, and ±0.6 where an interval element is involved;
- every peak mass within 1 mDa.

### D4. Diastereotopicity

Oracle: the textbook classification (the Eliel–Wilen substitution test). An RDKit substitution-test script agrees on 12 tabled cases: the 11 classified methyl and CH₂ pairs, plus (2R,4R). It was not run on `C=CC`. For the unspecified case it answers "homotopic" where the textbook says "depends", and it mishandles the meso C3, so the textbook is the oracle there.

| input | expected | `getDiastereotopicAtomIDs` | today |
|---|---|---|---|
| `CC(C)C(O)C` iPr methyls | diastereotopic → ¹³C 5 signals; ¹H 3H d + 3H d | different | 4 signals; 6H d |
| valine, leucine methyls | diastereotopic | different | 6H d |
| `CCC(O)C` C3 H₂ | diastereotopic → `m`, with the ²J note | different | quint |
| `CCOC(C)OCC` OCH₂ | diastereotopic → `m` | different | q |
| `OCC(O)CO` C1 H₂ | diastereotopic | different | d |
| meso `C[C@@H](Cl)C[C@H](C)Cl` C3 H₂ | diastereotopic | different | — |
| (2R,4R) `C[C@@H](Cl)C[C@@H](C)Cl` C3 H₂ | homotopic → no split | same | — |
| `CC(Cl)CC(C)Cl` (unspecified) | **say "depends on relative configuration"** | same | — |
| isopentane, cumene methyls; ethanol, glycine, ethyl propanoate CH₂ | enantiotopic → **no split** (achiral solvent) | same | same |
| `C=CC` =CH₂ | diastereotopic (cis/trans to CH₃); ²J 0–3 Hz | different | — |

Every existing `nmr.test.ts` and `nmr2d*.test.ts` count assertion for a molecule WITHOUT diastereotopic groups stays green, unmodified.

### D5. UV enones

Oracles: Woodward–Fieser arithmetic (the textbook tables), plus invariance under SMILES permutation.

| input | expected | today |
|---|---|---|
| `CC(=O)/C=C/CCCC1=CC(=O)CCC1` and `O=C1CCCC(CCC/C=C/C(C)=O)=C1` | **239** for both (arms 227 and 239 listed) | 227 / 239 |
| prednisone; androsta-1,4-diene-3,17-dione | 239 for both (max arm = 215 + 2×12), dienone flag on | 239 / 227 |
| mesityl oxide, isophorone, cyclohexenone, 3-methylcyclopent-2-enone | 239, 239, 227, 226 (unchanged) | same |
| p-benzoquinone, 2-methyl-p-benzoquinone, duroquinone | refused: quinone | 227 / 239 / 249 |
| benzalacetone, chalcone, dibenzylideneacetone | refused: aryl-conjugated enone | 227 ×3 |
| testosterone | 239 **plus the exocyclic caveat** (244 only if D-1 is accepted) | 239, no caveat |
| every row above, under 20 random atom permutations | identical λmax and arm set | — |

## E. Codebase-specific risks

1. **`jcamp.ts` line map:**
   - 228–237: DUP;
   - 253–262: y-check and `emitted`;
   - 70–84: exponents;
   - 167 and 285–292: `DATATABLE` and tuple forms fall into the pairs branch;
   - 192: the block stops at `##PAGE=`;
   - 163: `$$` is kept in header values.

   Every existing `jcamp.test.ts` case (26 tests) must stay green, unmodified. The DIF/DUP tests at 79–135 encode a single-token DUP after SQZ, which does not change.
2. **`massspec.ts` line map:** 22–62 `ISOTOPES` (moves to `isotopes.ts`); 210 `maxPeaks`; 225 `baseNucleon`; 316–319 anchoring; 372–389 `elementMasses` (OCL masses for Tc/Po/Ra).
   - **Two tests pin the defect itself:** `massspec.test.ts` 50–56 ("chlorophyll a reports Mg as unsupported") and 81–88 ("`[Fe]` untabled"). REPLACE them with oracle assertions (Mg and Fe in the pattern). Do not loosen them. Say so in the commit.
   - The pane labels at 26758 and 26814 (`M+${offset}`) must print `M−n`.
3. **`structures.ts` 332–346 and 349.**
   - The paired-digit rule stays. The new duplicate-ring-bond rejection goes in `readAsSmiles`.
   - Pin both directions: `C6Cl6` → formula; `C1CCCCC1`, decalin and cubane → SMILES.
   - `resolveChemInput` is also Structure mode's resolver (483). Re-run `chembioRouting.test.ts` and `chemLiveBugs.test.ts`, unmodified.
4. **Pane: JCAMP panel and Spectra mode.**
   - `renderJcamp` (27504–27558) picks `parsed.spectra[0]` (27517).
   - `buildSpectrumSvg` (26885): the UV figure is the ladder. The overlay is a separate figure.
   - `updateSpectra` (26943) keeps `currentSpectrum`, which the overlay reads.
   - The 16 MB cap (`JCAMP_MAX_BYTES`) stays.
5. **`molgraph.ts` is shared by six predictors** (fragment, ir, nmr, nmr2d, pka, uvvis), and it carries the v2.132.0 charge-aware carbonyl fix. **No builder edits it.**
   - `symmetryClasses` (549–562) and the `getSymmetryRank` reads in `nmr.ts` 816–847 and `nmr2d.ts` 137–168/237 keep their meaning.
   - The diastereotopic refinement is applied AFTER them, in `nmr.ts` only.
   - `getDiastereotopicAtomIDs` must run on a COPY. Calling `addImplicitHydrogens` on the shared molecule would shift every later atom-index lookup.
6. **Signal-count changes move results.**
   - Every molecule with a diastereotopic methyl pair gains a ¹H/¹³C row: amino acids, terpenes, steroids with iPr side chains.
   - Grep the tests for `signals.length`/`toHaveLength` on such molecules. List each changed expectation in the commit, with the D4 oracle row that justifies it.
   - `dept.test.ts` counts carbons per class. Check it.
7. **UV pins.**
   - `spectraDomainLimits.test.ts` 217–229 (prednisone and dexamethasone within ±5) and 300–309 (dienone flag off for testosterone, progesterone and mesityl oxide) must stay green. Max-over-arms keeps prednisone at 239.
   - **Decision D-1 (the exocyclic +5)** would move prednisone to 244 (Δ = 6 vs 238) and break 217–229. Do not loosen the pin to pass it: ask the user.
   - Grep `caveatWording.test.ts` for the 688 caveat text before editing it.
8. **Figure ratchets.**
   - `CORPUS_FLOOR = 205` (check-figures.js 84). E adds 5 overlay figures (¹H, ¹³C, IR, UV, MS head-to-tail) and 1 isotope stick figure, and raises the floor in the SAME commit.
   - The existing waiver at 123 (`"jcamp measured ir": CLIPPED …`) exists because a long file title is placed unmeasured. `overlayChart` measures and truncates titles, so **no new waiver is added**.
   - No `BASELINES` entry changes: Spectra and Mass Spec are modes, not calculator registries.
   - Rasterise the INSERTED overlay, not the pane preview ("preview is not insert").
9. **Display contract.**
   - Use ¹H, ¹³C, δ (ppm), cm⁻¹, m/z, M−2 (U+2212), ⁵⁴Fe, ²J, and Δ with a true minus, in all output and errors.
   - Show file units normalised ("1/CM" → cm⁻¹, "HZ" → Hz, "M/Z" → m/z) and keep the raw string in provenance.
   - Show `MOLFORM` typeset (C₂H₆O).
10. **Fixtures and licences.**
    - The jcamp-dx.org and Lancashire test files (via nzhagen/jcamp, MIT) may be committed with attribution.
    - **NIST WebBook data are NIST SRD** (15 U.S.C. 290). Do not commit the downloaded files.
    - Pin the NIST rows of D2 with small synthetic JCAMP files carrying the same peak values. Keep the real-file check as a scratchpad oracle run, recorded in the commit.
    - Hash every committed fixture in its test.
11. **Unbounded work freezes Word.** Set every cap before any work:
    - JCAMP: the existing 16 MB, plus ≤ 2²⁰ points per block;
    - NTUPLES: ≤ 8 pages;
    - peak picking: ≤ 200 peaks; matching is O(p·q) with both ≤ 200;
    - isotopes: per-element caps re-measured for Sn and Hg (§B3);
    - `getDiastereotopicAtomIDs`: time it inside jest on the largest dictionary molecule (the vancomycin class), and refuse above a heavy-atom cap with a stated limit.
12. **Oracle hygiene.**
    - Store the isotope table verbatim, with its edition and hash.
    - The test derives the numbers from the strings, and asserts that every interval element's value lies inside its CIAAW interval.
    - Never hand-type the table of 84 elements' isotopes: the gc.prt lesson, and memory's compound-dictionary trap.
