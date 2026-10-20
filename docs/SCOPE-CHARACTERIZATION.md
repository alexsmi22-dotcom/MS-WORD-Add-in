# Characterization text (Example sections) — scope

Organic-chem arc item 2 (after CIP, v2.164.0). A new tool, **Characterization**, under
Chemistry & structures: the chemist types or pastes their data, the pane writes it in
journal form with the checks a referee or examiner would make, and inserts it into Word as
formatted runs (italic *J*, *m*/*z*, DMSO-*d*₆; real superscripts and subscripts).

## Source of the format

J. Org. Chem. Author Guidelines (ACS Researcher Resources, read 2026-10-20):

- ¹H shifts to 0.01 ppm with a multiplicity abbreviation; ¹³C shifts rounded to 0.1 ppm;
  broadband decoupling shown with braces, ¹³C{¹H}.
- Example: `1H NMR (C6D6, 400 MHz): δ 6.00 (t, 1H, J = 4.0 Hz), …`
- HRMS: `HRMS (ESI/Q-TOF) m/z: [M + Na]+ Calcd for C13H17NO3Na 258.1101; Found 258.1074.`
  The formula and Calcd include the added atoms. Found within 0.003 m/z of Calcd.
- Elemental analysis: `Anal. Calcd for C13H17NO3: C, 66.36; H, 7.28; N, 5.95. Found: C, 66.55; H, 7.01; N, 6.22.`
  C, H, N within 0.4 %.

Two styles: **JOC** (the guideline above: solvent before frequency, integration before J,
¹H 0.01 / ¹³C 0.1 ppm) and **Common** (MestReNova's order — `(400 MHz, CDCl₃) δ 7.26 (d,
J = 8.0 Hz, 2H)` — values exactly as typed, lowercase calcd/found).

## In

- Compound: name / formula / SMILES (the Mass Spec resolver), or the Build drawing.
- ¹H and ¹³C lists: pasted MestReNova text or one signal per line; header (frequency,
  solvent, MestReNova solvent names such as "Chloroform-d") read when present; ranges,
  several J values, J labels (J_HF), "br s", "app t", trailing assignments.
- HRMS: source, analyzer, ion ([M + H]⁺ … the ESI adduct table, [M]⁺, [M]⁺•), Found.
- Elemental analysis Found values; yield (mg, mmol of limiting reagent), state, mp, R_f.

## Checks (warn, never block the insert — it is the chemist's data)

- Every pasted segment is read or named as unread — a signal is never dropped silently.
- ¹H integration total vs the formula's ¹H count (D is not ¹H). Fewer: says how many
  exchangeable OH/NH/SH protons the structure has (expected absent in D₂O / CD₃OD). More: warning.
- Multiplicity vs the number of J values (dd needs two); J outside 0–25 Hz for ¹H–¹H.
- ¹³C signal count vs symmetry-distinct carbons (from the ¹³C predictor's grouping, which
  keeps diastereotopic carbons apart) and vs the carbon count.
- HRMS Found within 0.003 m/z (ppm shown); when it is not, which other ion it matches.
- EA within 0.4 %. Yield over 100 %.

## Refused by name

HRMS for a hydrate or salt formula (·0.5H₂O, ·HCl — enter the parent), for a salt drawn as
two ions (enter the ion), adduct ions for a charged structure (only [M], with its own charge), [M − H]⁻
with no hydrogen. Structure checks for a formula-only compound are skipped, and the readout says so.

## Out of scope

IR line, optical rotation, HPLC purity, ¹⁹F/³¹P lists (later, same parser), predicted shifts
filled in as data (never: an Example must carry measured values).
