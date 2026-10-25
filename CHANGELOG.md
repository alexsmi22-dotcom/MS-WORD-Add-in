# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

> Note: this file was not maintained between v1.96.0 and v2.23.0, nor between
> v2.52.0 and v2.59.0. Those releases are recorded in the git history rather
> than here.

## [2.196.0] — 2026-10-25 — Publishable regression

The second release of the quantitative-economics plan. Three new Statistics calculators, each inserting its summary
and real Word tables (and a figure where one means something) as one package. Every number is checked against
statsmodels; each result prints the conventions it used.

### New
- **OLS regression with robust standard errors:** classical, HC0–HC3 (HC1 is Stata's `robust`), clustered (Stata's
  finite-sample factor, t with G − 1 df) and Newey–West (Bartlett kernel; your lag or the Newey–West rule of thumb).
  R², adjusted R², the Wald F under the chosen errors, root MSE, AIC and BIC; diagnostics: Durbin–Watson,
  Breusch–Pagan (Koenker), White, VIF, Ramsey RESET and Jarque–Bera; a residuals-versus-fitted figure. Models are
  written "y ~ x1 + x2" against a table with a header row, pasted or read from the table at the cursor.
- **Regression table:** several models side by side in the journal layout — coefficients with stars, standard errors
  in parentheses below, N and R² at the foot, a legend under the table (* 0.10, ** 0.05, *** 0.01, or the
  0.05/0.01/0.001 scheme, or none).
- **Logit and probit:** maximum likelihood with classical or robust standard errors, average marginal effects with
  delta-method errors, the likelihood-ratio test, McFadden's pseudo R² and the share correctly predicted; perfect and
  quasi-complete separation are refused by name.
- RESET is computed exactly where statsmodels' own version loses precision (on the classic Longley data it reports
  p = 0.018 where the exact value is 0.174).
- Fits stay accurate on nearly collinear data (checked against an 80-digit exact oracle up to condition number
  10¹⁰); only a numerically rank-deficient design is refused, naming its columns.
- Decimal commas are understood: a semicolon-separated table reads every comma as a decimal comma, and "0,125" or
  "1,5" anywhere reads as a decimal. A table that mixes decimal commas with thousands-shaped commas, or that groups
  thousands with points beside a bare "2.345", is refused rather than guessed.
- Large numbers are grouped (3,482,258.635); interval bounds are separated by "; "; the model columns of the
  publication table are centred so each standard error sits under its coefficient.

## [2.195.0] — 2026-10-24 — Litigation damages

The first release of the quantitative-economics plan (docs/GAP-ANALYSIS-ECONOMICS-2026-10-24.md). Eight new Finance
calculators for a damages report, each inserting its summary, a Word table and a figure as one package. Every rate,
share and multiplier is yours: none is supplied as law. Finance now has 32 calculators.

### New
- **Prejudgment interest:** dated damages rows (or periods: 2019, 2019-Q3, 2019-07) against a step-wise rate table;
  simple, or compounded annually, quarterly, monthly or daily; actual/365, actual/360 or actual/actual; optional
  mid-period accrual. Each row's interest, days and total in a table that adds up to the cent.
- **Post-judgment interest under 28 U.S.C. § 1961:** computed daily and compounded annually on each anniversary of
  the judgment, at the rate you enter for the calendar week preceding the judgment; a year-by-year ledger.
- **Reasonable royalty:** per-period base (revenue or units) × rate, apportionment to the patented feature, and a
  lump sum compared with the present value of the running royalty.
- **Lost profits:** captured sales (all, or by the market-share method), spare capacity, incremental margin, price
  erosion (optionally with a demand elasticity), and the remainder at a reasonable royalty.
- **Damages summary** by period, with a multiplier from 1 to 3 (35 U.S.C. § 284) applied to damages, never interest.
- **Lost earnings:** present value year by year (growth, discount, fringe, personal consumption, mid-year option).
- **Georgia-Pacific and Panduit worksheets:** Word tables to fill in, with the fifteen factors and the four Panduit
  factors as the courts state them, and the citations.
- Every result prints the conventions it used (day count, compounding points, rounding), and the inserted tables
  carry every row; pasted Word and Excel tables, headers and totals rows are read with a note.

## [2.194.0] — 2026-10-24 — A second, exhaustive bug test

Twelve testers each listed every feature in one area from the source (every calculator, dropdown, input mode, output
and file format) and checked each against an outside reference (RDKit, OPSIN, Biopython, scipy, sympy, mpmath,
CoolProp, citeproc-js, published tables) and real Word; a regression review then re-ran the fixes against v2.193.0.

### Fixed: wrong answers
- **Table of Authorities:** sentence boundaries after abbreviations, signals and *Id.* (Rule 4.1), constitutional
  provisions, PTAB decisions and other new categories, state codes (Ga. Code Ann. § 9-11-12 stays one section),
  parallel citations keep the year, chapter captions; RIS patents and APA in-text order in Citations.
- **Chemistry:** isotopic, charged and lone carbons labelled (H₃¹³C–OH); SMILES that cannot be kekulised are refused
  while porphyrins, heme and chlorophyll still draw; charge carried into the formula; sugars drawn as pyranoses with
  correct stereo; IUPAC chain seniority (2013 rules), vowel elision and prefixes; balancing in acid/base names only
  the H⁺, OH⁻ or H₂O actually added; NMR shifts for heteroaromatics, amides, formyl and Si with out-of-domain flags;
  MS adducts and fragments; botanical × names; stoichiometry significant figures.
- **Biology:** SnapGene primers off by one and on the wrong strand; Dam/Dcm methylation; IGLV6 numbering; alignment
  gaps; circular-map labels.
- **Statistics:** χ² validation and Total rows (a real "Overall" group is kept as data); exact k-group log-rank;
  Kaplan–Meier log-log confidence intervals and censoring ticks; inhibition fits in molar units.
- **Solve and maths:** conic centres; singular integrals detected before integrating; underflowing roots; exact
  forms; Taylor series exact; LaTeX import overhaul; units upright after numbers (45°, 25 °C); Z_in, P_in read as
  labels, not ∈; 19 new units; temperatures below absolute zero refused.
- **Plots, Analyze, Finance:** FFT scaling and periodic windows; Black–Scholes at σ = 0; closed-form loans; declining
  balance; decimal commas in tables; header detection; plots break at poles; USPTO black-and-white figures.
- **Engineering:** NCA, Scherrer, tolerance and peak tables; affinity laws; frame scaling; differentiator and
  root-locus tags; repeated roots; AC −3 dB points; great circles across the antimeridian; valid inputs no longer
  refused (kets, ζ ≥ 1, netlists, 90° launch, minterms); a result that is undefined says so (pipe at zero flow).
- **CAD:** PowerPoint chart gaps; USPTO view numbers at heading size and never over another label or the part;
  concave OBJ faces; DXF units; numerals cap; reference numerals in a range like "claims (1-20)" are not callouts.

### Fixed: inserting
- Results with text and a figure go in as one package, in a new Normal paragraph below the cursor's paragraph, so
  nothing merges into a heading or list; captions stay with their figure.
- Chapter-numbered captions work in a thesis with an unnumbered "Abstract" heading.

### Display
- Every Engineering result passes one guard: no NaN or Infinity is ever shown, and the reason is named.

## [2.193.0] — 2026-10-24 — A comprehensive bug test of all of JurisLab

Six independent testers went through every mode against outside references (RDKit, OPSIN, Biopython, REBASE, scipy,
sympy, CoolProp, citeproc-js with the official CSL styles, published Bluebook tables) and real Word. What they found:

### Fixed: wrong answers
- **ST.26 sequence listings:** an RNA sequence lost every "t" (ST.26 writes uracil as t); a CDS with an internal stop
  got a truncated /translation with no warning; a synthetic construct defaulted to "genomic DNA" (now "other DNA/RNA").
- **Table of Authorities:** case names were cut short after abbreviations ("Co. v. Mee Indus." for Dow Chem. Co.);
  missing Table T6 words gave duplicate rows; Fed. R. Evid. was missed and bare "Rule 403" filed as Fed. R. Civ. P.;
  Federal Register cites duplicated; Restatements, treatises, articles and court rules left out — now listed under
  Other Authorities. Short forms follow Rule 10.9 ("Gen. Elec.", not "Gen"); 2d/3d Cir.; T6/T10 checked against the
  21st edition (Env't, Lab'y, Telecomms., Haw.).
- **Chemistry:** "*" attachment points were counted as carbon; invalid SMILES (pentavalent carbon, unclosed
  branches) were drawn; esters and acids were predicted at 280 nm in UV; an alkyl C–H band appeared for aldehydes;
  charged species now show m/z with the electron mass, agreeing across modes; Hg₂²⁺ and O₂²⁻ read correctly.
- **Assays:** fits on molar concentrations (EC50 or Kd below 10⁻⁷) returned wrong parameters reported as converged.
- **Plasmids:** features crossing the origin covered the whole map; minus-strand joins were drawn on the plus strand;
  two enzymes had wrong cut positions (PleI, BciVI); EcoP15I (Type III) removed. Alignment now scores as EMBOSS does.
- **Engineering:** the fatigue temperature factor (Shigley Eq. 6-27); pump NPSH with hot water used the 20 °C vapour
  pressure; multi-axis moves were not straight; repeated oral dosing with ka = k; finite life above ultimate strength;
  step metrics labelled exact for systems with a zero; the AC 3 dB corner.
- **Maths:** limits refused by cancellation now solved; derivatives of log and 2ˣ exact; ln(e) folded.

### Fixed: freezes
- A long SMILES froze the pane (27 s for 800 carbons); a long sentence with many commas froze citation parsing.

### Fixed: inserts and display
- Editable Word tables were cut to 40 rows (antibody numbering, XRPD peak lists); reaction-scheme captions, Solve and
  reaction-balance figures now go in as one piece; Stats, Finance and Assay figures land below their text.
- Equations: e^sin(x), ∂u/∂t, 2(½), 90 deg, dot products, binomials, LaTeX export and import.
- True minus signs, ×10ⁿ instead of e-notation and superscript units across Engineering, Stats, Analyze, Finance and
  Assay results and figure labels; rounding noise (3.5×10⁻¹⁵) printed as 0.

### Changed
- The landing page: new highlights for the quantum section and the engineering release; claims corrected.

## [2.192.1] — 2026-10-23 — Inserted results read cleanly on Mac and PC

### Fixed (from a 62-page demo document inserted in Word)
- **No more "?" in tables and text on the Mac:** subscripts and superscripts in inserted text (sₖ, Sₐ, 10⁻⁴) go in
  as Word's own subscript and superscript formatting rather than special characters the Mac fonts lack, and symbols
  such as ⟨ ⟩, ⊗ and ‖ are set in Cambria Math.
- **Equations:** sin², cos², log₂ and other function names with a power or subscript are upright; tr_B(ρ) and
  r_i(S) keep their argument outside the subscript; a fraction is no longer wrapped in brackets, as in ħ/2(…) and ½(…);
  overline/tilde/dot accents (the Bell-state formula showed "overline(y)"); k_{2ω}, n_{2ω} and U_{BS2} subscripted whole.
- **Tables:** words are left-aligned and numbers right-aligned (every cell was right-aligned).
- **Figures:** every result with a figure now goes in as one package — the caption on its own line above the figure
  (a long caption used to wrap around it), and the next insert starts on a new line, never beside a figure.
- The Schmidt-coefficient caption described the chart wrongly ("one bar: a product state" over two bars).

## [2.192.0] — 2026-10-23 — Results with equations and tables insert completely

### Fixed
- **Inserting a result that has equations or tables** now puts the WHOLE result into Word. Since v2.191.0 most
  Engineering reports carry their governing equations and results tables, and Word was keeping only the first lines:
  the tables, the figures ("Word kept 0 of 1 figures") and everything after the first equation were lost — Kalman
  filter, Combined loading and most of the quantum tools among them, on Mac and PC. The result now goes in as one
  Word package (text, real equations, real tables and the figures together) instead of a chain of separate inserts.
  Results with no equation or table insert exactly as before.
- **Equations as typeset in Word:** brackets that only group a numerator or denominator are no longer drawn
  (σ = P/A + Mc/I, not (Mc)/I); a space before a bracket is a product, not a function call (the Kalman gain
  K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹ had the whole bracket inside the superscript T); and the Engineering equations that meant a
  grouped exponent now show it without brackets (… + R)⁻¹, e^(−2κa) → e⁻²ᵏᵃ). Checked in Word itself.
- **Prose subscripts:** names like η_geo, D_t and S_a in result text are typeset (η(geo), Dₜ, Sₐ); two quantum-link
  equations that went in as plain text are now real equations.
- **Quantum states with tiny amplitudes:** a state typed with amplitudes of 10⁻²⁰⁰ now reports ‖ψ‖² = 2×10⁻⁴⁰⁰ (it said 0,
  and "divided by 0").
- **Equations:** a stray space in an exponent no longer changes the formula (`x^- 1` is x⁻¹, as `x^-1` is); the
  preview shows a true minus sign (−) rather than a hyphen.
- **Uncertainty of an angle:** angles that wrap at ±180° (Euler angles, joint angles) spread about the value as typed:
  179° ± 2° gives 177° to 181°, not a mixture of 177° and −179°.

## [2.191.0] — 2026-10-23 — Engineering gap release and a quantum mathematics section

Everything from the 2026-10-23 engineering gap analysis (docs/GAP-ANALYSIS-ENGINEERING-2026-10-23.md, all fifteen
items) and a new quantum mathematics section (docs/SCOPE-QUANTUM-2026-10.md), in one release. Engineering now has
241 calculators in 25 disciplines (was 179 in 23).

### Fixed
- **Units:** °C and °F inside a compound unit are temperature differences, so W/(m²·°C) and Btu/(h·ft²·°F) convert (a
  lone 20 °C still means 293.15 K). New: °R, Δ°C/Δ°F, tonne (t), slug, lbm, kgf, mil/thou, µin, ton of refrigeration
  (TR), gpm, cfm, oil barrel (bbl), arcmin, arcsec, µrad, oersted, mHz; "ppm/K" and "%/°C"; a spaced reciprocal
  ("12e-6 /K"); a root sign (MPa·√m). The "Units read" note is typeset (×10ⁿ, never e-notation).
- **Fracture toughness** fields read Pa·√m: 50 MPa·√m and ksi·√in convert; plain MPa is refused as the wrong quantity.
- **The rocket equation** accepts tonnes, as its label always said.
- **Data checked against references:** liquid water density and viscosity (IAPWS-95 / IAPWS 2008 via CoolProp 8.0.0 —
  the old 0 °C viscosity was 0.57 % low) and ideal-gas cp for the nine gases (methane was 1.1 % high). Pipe roughness
  and Manning's n are now stated as typical values, with your own value preferred.
- **True minus signs** throughout Engineering result text (a negative force read "-7.5 kN").

### New: the Engineering workbench
- **Send a result to another tool:** buttons under a result ("Use the peak moment in Cross-section") fill the next
  tool's field with the value and its unit — beam → cross-section → stress state / column, wall U → both heat
  exchangers, laser cavity w₀ → Gaussian beam, energy tools → LCOE, three-phase → power-factor correction → cable drop,
  endurance limit → the fatigue tools, and more (31 links).
- **The control tools share one plant:** a transfer function typed in one of the eight control tools carries to the
  others.
- **Explore this result:** sweep any numeric input over a range and plot a chosen result, or give inputs a ± uncertainty
  and get a Monte Carlo distribution with its 95 % interval beside the first-order estimate.
- **Named results, governing equations and Word tables:** of the 153 calculators that were already here, 152 now report
  their headline numbers by name (which the sweep and uncertainty runs read), 142 insert their governing equations as
  real Word equations, and 85 insert their results tables as Word tables.

### New engineering tools
- Thermal stress (restrained), bimetal/bilayer curvature, Stoney thin-film stress, thermal shock resistance.
- Thin-walled pressure vessels, Lamé thick-walled cylinders, shrink fits, rotating disks, combined loading with
  Mohr's circle and the beam-column factor, Hertz contact.
- Normal shock, oblique shock and Prandtl–Meyer expansion, Fanno and Rayleigh flow.
- Random vibration (PSD profiles, Grms, Miles' equation), base excitation, shaft critical speeds.
- Kalman filter (steady state; run on measured data), attitude conversions (quaternions, rotation matrices, all twelve
  Euler sequences, slerp).
- Circuit simulator: controlled sources (E, G, H, F) and coupled inductors (K) in DC, AC and transient — transistor
  small-signal models, op-amps, transformers.
- Laser physics: Fabry–Pérot cavity, threshold and slope efficiency, coherence and Schawlow–Townes linewidth,
  second-harmonic generation and quasi-phase matching.
- RF link budget, noise-figure cascade, Eb/N0 ↔ BER.
- Semiconductor devices: pn junction, MOSFET square law, carrier statistics (Si nᵢ 9.65×10⁹ cm⁻³, Altermatt et al.
  2003).
- Transmission lines with the Smith chart, quarter-wave and single-stub matching, two-port S-parameters.
- AI compute: roofline, transformer size and FLOPs, low-precision number formats (fp16, bf16, fp8 E4M3/E5M2, int8/int4).

### New: quantum mathematics
- **Quantum computing** (new panel): Dirac states and inner products, operators (Hermitian/unitary checks, spectra,
  commutators, the uncertainty relation), the Born rule; single-qubit gates on the Bloch sphere; a circuit simulator
  up to 10 qubits with the circuit diagram; interference, Bell states, teleportation, superdense coding,
  Deutsch–Jozsa, Grover, the quantum Fourier transform; density matrices (purity, entropy, fidelity) and two-party
  entanglement (Schmidt decomposition, concurrence, negativity).
- **Quantum optics** extended: beam splitters and Mach–Zehnder fringes, Hong–Ou–Mandel interference, multiphoton
  (boson-sampling) probabilities, dual-rail qubits and the linear-optics CZ gates; space quantum links — a free-space single-photon link to LEO, GEO or the
  Moon (exact Airy coupling into the receiver), entanglement distribution with coincidences, accidentals and Bell
  visibility, and the BB84 key rate (single photon or decoy state) over that link.
- **Quantum mechanics** (new panel): particle in a box (infinite and finite wells), the harmonic oscillator, the
  hydrogen-like atom (levels, transitions, radial probability), tunnelling through a rectangular barrier, and two-level
  dynamics (Rabi oscillation, spin precession); CODATA 2018 constants. New unit: meV.
- Word equations now typeset |+⟩, |−⟩, |Φ⁺⟩, U† and ⊗.

### Changed
- The Stress tool's Mohr's circle places its labels outside the circle.

## [2.190.0] — 2026-10-23 — Curved mechanism arrows and fishhooks

- **Curved arrows and fishhooks on the Draw page.** Draw the structure, then **Mechanism: Curved arrow** or
  **Fishhook** under the canvas: the canvas switches to the page view in place (what you drew comes along) with that
  arrow picked. Drag from a lone pair's atom or a bond to the atom or bond the electrons go to; the ends attach to
  them and move with the structure. Shift while dragging, or a click on the arrow, bows it the other way. An arrow
  with no clean path (it would cross a bond, a label or another arrow) is refused with the reason, never drawn
  through something.
- **Homolysis fishhooks drawn as published figures draw them.** Each hook starts at the middle of the visible bond and
  comes down over its own atom — measured on published homolysis figures. On a peroxide whose O–C bonds point
  opposite ways the two hooks sit on opposite sides, as in the published figure; otherwise both on one side, mirror
  images.
- **A press on the short dash between two labels (Br–Br at an angle) now picks the bond**, not the nearer Br.
- Arrows plan faster when the mouse is released (about a third less time on a crowded page).
- Four timing tests now scale with the machine they run on (a fixed millisecond limit blocked one deploy).

## [2.189.0] — 2026-10-23 — Cleanup: every known open defect fixed

No new tools: the defects and rough edges left open by the last three releases, fixed.

- **Draw page labels and charges.** Labels are measured with Arial's real glyph widths, so a Br–Br bond no longer
  runs into the second Br and bonds stop a consistent gap from the letters. Charge signs sit close to their letters
  and move off any bond (O⁻ no longer reads "O="); a carbocation's + sits just beside its carbon. Hydrogens go on
  the side away from the bonds (H₂N– when the bond leaves to the right; stacked under the N in a chain), written the
  way ChemDraw stores them so files round-trip.
- **Names such as NaN₃ insert.** Sodium azide, NaNO₃ and similar names no longer make a result uninsertable; one
  rule now decides what counts as a broken number, shared by the pane and the audits.
- **Stats and Solve update a moment after you stop typing**, and Insert always uses what you typed.
- **Plot data reads European decimal commas** (2,5 is 2.5), true minus signs, ×10³ and %; an ambiguous comma, a word
  line or a one-number line gets a message saying what to fix instead of being split or dropped.
- **Patent (USPTO) figures for the newer plot types:** parametric, polar, two y-axes, contour lines (values written
  on their lines) and wireframe surfaces insert as black line art.
- **Golden Gate destination vectors.** A backbone with two inverted BsaI/BsmBI/BbsI/SapI sites around a dropout is
  recognised: its overhangs are read, the dropout removed, the first and last parts matched to it.
- **References:** a reference the style cannot format takes no number (its citation reads "?") instead of leaving the
  text one ahead of the list; quotation marks inside a quoted title become single quotes; a journal article with no
  journal name is warned about.
- **Fixed:** the qPCR dilution series reads its numbers by the shared rules and names mixed decimal marks; Tukey HSD
  and Dunnett are limited to 20 groups (they could freeze Word at hundreds); root locus on large plants is instant;
  contour and surface refusals give the right advice.
- Curved electron-pushing arrows remain unavailable while their drawing is improved (back in 2.190.0).

## [2.188.0] — 2026-10-22 — Lab data: peak tables, NMR integration, cloning, circuit transients, liquid-crystal wave plates, more arrows

Release C of the STEM gaps (the last of three), plus liquid-crystal retarders and an Optica reference style so a
liquid-crystal optics letter can be written end to end. Engineering now has 179 calculators in twenty-three disciplines.

- **More arrows on the Draw page (Structure ▸ Draw ▸ Arrow).** Retrosynthetic ⇒ and resonance ↔ arrows join reaction
  and equilibrium; they insert into Word as drawn and save to .cdxml the way ChemDraw stores them. Older ChemDraw
  arrow forms now open as arrows, open ("angle") arrowheads in ChemDraw files are drawn open as ChemDraw draws them,
  and curved arrows already in a ChemDraw file are drawn bowing the right way. Drawing new curved electron-pushing
  arrows is not offered yet: in review, several everyday mechanisms did not draw cleanly enough to ship.
- **HPLC/GC peak table.** Paste the peak table from your chromatography software (columns read by their headers):
  plate count, resolution, retention and separation factors, symmetry factor and area % by the harmonized
  USP ⟨621⟩ / Ph. Eur. 2.2.46 half-height definitions, named in every result, with the chromatogram redrawn from the
  table (and labelled as such). Header units must match the chosen time unit; nothing is converted silently.
- **Excel import.** "Open CSV…" on any data field now opens .xlsx and .xlsm: the first visible sheet, cells placed by
  reference, cached formula values. Dates, error cells and formulas without a saved value are refused naming the cell;
  .xls, .ods, .numbers and password-protected files are refused with how to re-save. Loaded only when used.
- **Measured ¹H integration → characterization.** Characterization ▸ ¹H NMR ▸ From an integration table: paste the
  multiplet table, choose a reference row or fit to the formula, and the ¹H list is written in the journal style the
  tool already uses. A count is rounded only within ±0.15 of a whole number; otherwise it is shown and flagged.
  Solvent and water peaks (Fulmer et al. 2010) can be dropped, with a note.
- **TLC plate figure.** Lanes of Rf values (or spot distances and the solvent front) give an Rf table and a schematic
  plate with origin, front and lane labels; close co-spots are drawn as one merged spot with a note.
- **Molecular cloning (new discipline).** A schematic agarose gel against manufacturer ladders read from their own
  pages (NEB 1 kb, 100 bp, 1 kb Plus; Thermo GeneRuler 1 kb) or your own sizes, lanes from fragment sizes or a virtual
  digest; Golden Gate design (internal and junction-created sites, duplicate, palindromic and reverse-complement
  overhangs refused by name); Gibson / HiFi design by overlap length or Tm; PCR primer design for any region. Every Tm
  is the app's one nearest-neighbour model; checked against Biopython.
- **Circuit transients (Electronics).** The same netlist the DC and AC tools take, with PULSE, SIN and PWL sources:
  node voltages against time by trapezoidal integration with backward-Euler starts at every source corner, a check that
  the trace settles to the DC answer, and a named note when the step looks too coarse for the circuit's time
  constants or ringing.
- **Liquid-crystal retarders and achromatic wave plates (Optics & photonics).** Retardance of tilted nematic cells from
  Cauchy dispersion (E7 and BL036 built in, with sources), transmission spectra between crossed and parallel
  polarisers with retardation-level lines, the achromatic quarter- or half-wave band, a design mode for the tilt, and
  measured spectra overlaid. A second tool gives the Fréedericksz threshold, the full director profile at each voltage,
  retardance against voltage and the voltage for a target retardance. Both draw the cell, the index geometry and the
  device. Checked against SciPy's boundary-value solver; the published example of Abuleil & Abdulhalim (Opt. Lett. 39,
  5487, 2014) is offered as a preset, with its comparison stated honestly (our indices differ from theirs).
- **Optica reference style** (Optics Letters, Optics Express, JOSA) for journal articles, from Optica's current style
  guide: [1], [2,3], [1–4] in the text.
- **Fixed: primer Tm for self-complementary primers** was 1–2 °C high: the symmetry term of SantaLucia (1998) was
  missing. Every other primer's Tm is unchanged.

## [2.187.0] — 2026-10-22 — Thin films, materials testing, control design, titration and CV, new plot types

Release B of the STEM gaps (the second of three). Engineering now has 170 calculators in twenty-two disciplines.

- **Optics: Fresnel s/p, thin-film stacks and Jones calculus.** Fresnel gives rs, rp, ts, tp with phases and Rs, Rp,
  Ts, Tp, for metals too (N = n + ik); its Brewster and critical angles are the Refraction tool's own. A coating
  stack (`MgF2 1.38 QW`, `repeat 4 … end`) gives R, T and A at λ₀ and a spectrum by the characteristic-matrix method —
  a quarter-wave MgF₂ on glass reads 1.26 % against 4.258 % uncoated. Jones calculus takes polarisers, half- and
  quarter-wave plates, retarders and rotators and gives the output state, the ellipse and the Stokes parameters. Checked
  against the published tmm package (10⁻¹¹) and closed forms; conventions (exp(−iωt), the IEEE handedness) are stated.
- **Materials and quality.** A **tensile test** from your stress–strain or load–extension data: modulus, 0.2 % offset
  yield, UTS, elongations, toughness, and a yield drop reported as upper and lower yield; a curve with no straight
  elastic part still gets its UTS, elongations and toughness, while the modulus and everything built on it (offset
  yield, resilience, plastic strain) read "not determined" rather than a guess. **Weibull modulus** of strength by regression and by
  maximum likelihood (the Reliability tool's own fitter). **Crystallite size** by Scherrer and Williamson–Hall.
  **Process capability** Cp, Cpk, Pp, Ppk with the Bissell interval and expected ppm. **Tolerance stack-up** by worst
  case and RSS with each dimension's share.
- **Control: root locus, Nyquist, lead/lag and discrete time.** Root locus with breakaway points and the exact gain at
  each imaginary-axis crossing (1/(s(s+1)(s+2)): K = 6 at √2 rad/s, confirmed by Routh). Nyquist counts encirclements
  and checks Z = N + P against the closed-loop poles. Lead/lag designs C(s) and then verifies it by closing the loop.
  c2d by ZOH, Tustin or matched pole-zero, with the exact Jury test; matches SciPy to 10⁻¹¹.
- **Fixed: phase and gain margins** (Bode, PID). The phase margin was not wrapped, so 1/s³ read 270° where it is −90°,
  and a loop with a right-half-plane pole read 396.9° for 36.87°; a phase sitting at −180° gave a gain margin from
  the edge of the sweep. Margins now come from genuine crossings, every −180° crossing is listed, and whether the loop
  is stable is decided from the closed-loop poles, so a conditionally stable loop says so.
- **Chemistry & electrochemistry** (a new discipline; Nernst, Butler–Volmer and Tafel move into it). **Titration
  curves** solved exactly from the charge balance for up to four pKa values, with equivalence points, a dpH/dV panel
  and your measured curve overlaid; **speciation diagrams**; **pH of a solution or buffer** with its buffer capacity;
  **cyclic voltammetry**: Randles–Ševčík peak currents, a simulated reversible voltammogram (Nicholson–Shain, peak
  0.4463 at 28.5/n mV from E½), and D from a fit of ip against √v.
- **Plot types.** Plot mode has a Plot type: parametric x(t), y(t); polar r(θ) on a polar grid; two y axes;
  contour lines or filled bands of z = f(x, y) with a colour bar; and a 3D surface. y = f(x) is unchanged; its x range
  now also takes 2*pi or π/2, and text it cannot read is refused rather than cut short. θ, π and the true minus are
  accepted in formulas. A contour is never drawn across a pole or a jump, and a function that is constant to
  rounding is refused rather than drawn as noise.
- Pasted data in every new tool reads decimal commas (5,30) and European thousands (1.234,5) by the evidence in the
  block, and refuses what it cannot decide, rather than splitting a number in two.
- **Fixed: eigenvalues of badly scaled matrices** (Math ▸ Matrix, and every pole and zero in the control tools).
  The matrix is now balanced first, as LAPACK does; a matrix with entries from 10⁻²¹ to 10¹¹ read a spectral radius
  of 8.59 where it is 0.985.
- **Step response of stiff systems** (pole ratios of 10³ and more) is now stepped exactly by the matrix exponential,
  checked against the poles before it is used; where it used to overflow or flatten, it now matches SciPy.
- Also fixed: fact(x) for a huge x no longer freezes Word. Landing-page tool counts corrected (Bio/Assay has 21).

## [2.186.0] — 2026-10-22 — Captions as Word fields, Welch's ANOVA, standard curves and qPCR, significant figures

Release A of the STEM gaps (the first of three).

- **Captions, equation numbers and cross-references are Word's own fields** (Captions & cross-refs ▸ Numbering:
  Word fields, the default). A caption is Word's Caption style with a SEQ field — Figure, Table or Scheme,
  optionally with chapter numbers (Figure 2.3); an equation can be numbered (1) or (2.1) as a field (Math ▸ Equation
  numbers; (I), (II) for patent formulas as before). **Cross-reference** lists what is numbered with its current
  number and inserts “Fig. 3” as a REF field that follows the figure; **Update numbers** renumbers every caption,
  equation and reference after a figure is added, moved or deleted (on a Word without that API: select all, F9);
  **Table of figures / tables / schemes** inserts Word's own. Plain-text numbering stays for documents that use it.
- **Stats: Welch's ANOVA and the Games–Howell post-hoc** for unequal variances — what the assumption check
  recommends, and until now could not provide. Each pair has its own Welch–Satterthwaite df; F(3, 8.3) = 5.89,
  p = .019 on the shipped example, matching pingouin (10⁻¹³) and SciPy (Games–Howell p to 3×10⁻¹¹). The studentized
  range is now accurate at small and fractional df; **Tukey HSD's p at df < 3 is fixed** (two groups of two: it read
  p = 0.00032 where the true value is 0.00125). The Brown–Forsythe line no longer prints 4.63e+32.
- **Bio/Assay: read unknowns off a standard curve** (linear or 4PL) with each unknown's CV and a published
  calibration interval (Fieller for a line; the delta method for 4PL, labelled); **nothing is extrapolated** — an
  unknown outside the standards reads “below the lowest standard” or “above the highest”. **Plate reader**: a 96- or
  384-well plate and its layout from a Word table, blanks subtracted, replicates grouped, a plate heat map. **qPCR**:
  Livak ΔΔCt (Livak & Schmittgen 2001 Table 1 reproduces exactly: kidney 5.6, 5.3–6.0) and the Pfaffl ratio with
  primer efficiencies from a dilution series (80–120 % or refused); “Undetermined” Ct is dropped by name, never 40. Decimal
  commas (0,125) are read per block, and an ambiguous 1,058 is refused rather than guessed; a hook effect is refused for
  4PL; fold-change bars switch to a log₂ axis when anything is down-regulated.
- **Solve: significant figures** with the steps — count them (“1200” is ambiguous, and says so), round, arithmetic
  by the textbook rules (counts are exact), round to the uncertainty (10.0 ± 0.123 → 10.0 ± 0.1). **Monte Carlo
  uncertainty**: 10⁵ seeded draws, the 95 % interval, a histogram, and whether the first-order (GUM) answer agrees
  (JCGM 101 §8).
- **Units**: viscosity (P, cP, St, cSt), Torr and mmHg (now exactly 133.322 387 415 Pa), Bq and Ci, Gy, rd, Sv and
  rem, kat and U, Wb and Mx, sr, week and the Julian year. Refused by name: Gy → Sv, “rad” → Gy (rad is the radian;
  the dose rad is rd), Bq → Hz, cP → cSt (needs the density), a bare “year”.
- Word cannot run in the test suite: the field OOXML, the host calls and the pane are tested; renumbering itself is
  the Word check below.

## [2.185.0] — 2026-10-21 — Chemistry: η-bonded organometallics have a formula

User report: the Zirconocene dichloride template showed "Formula: —".

- **Metallocenes and other η-bonded structures now give their molecular formula, weight and monoisotopic mass** in
  Build ▸ Draw: Cp₂ZrCl₂ C₁₀H₁₀Cl₂Zr, MW 292.32 g/mol, monoisotopic 289.9207; Cp₂TiCl₂, Cp₂HfCl₂, ferrocene (186.03,
  as PubChem), the ansa, half-sandwich and bis(borohydride) templates, and any ring bound with the η-bond tool. The
  formula counts the atoms however they are bonded — every Cp carbon keeps its one H, drawn delocalized or Kekulé.
- **The SMILES is the ionic form databases use, labelled "(ionic representation)"** —
  [CH-]1C=CC=C1.[CH-]1C=CC=C1.[Cl-].[Cl-].[Zr+4] — since SMILES cannot express η bonding; its charges always balance.
  Ligands as databases write them: Cl⁻ (bridging too), H⁻, O²⁻, CO as [C-]#[O+], neutral donors (NH₃, PMe₃) uncharged.
- **The monoisotopic mass** now shows beside the average weight for every structure in Build ▸ Draw.
- **A polymer** (structure in repeat-unit brackets, as the polymer-bound metallocene) gives its formula per repeat
  unit: (C₁₃H₁₄Cl₂Zr)ₙ, with its weight per unit; it still inserts as a drawing.
- An η-bonded structure inserts with its ionic SMILES labelled in the alt text and no reopen code, and opens from a
  ChemDraw file on the page canvas, as drawn. The template is renamed **Zirconocene dichloride (Cp₂ZrCl₂)**.

## [2.184.0] — 2026-10-21 — Drawing (CAD): import STEP and IGES parts and assemblies

docs/SCOPE-STEP-IMPORT.md.

- **Import DXF / STL / OBJ / STEP…** now reads STEP (.stp, .step) and IGES (.igs, .iges) — what Solid Edge writes
  with **Save As → STEP**. Every solid body becomes a part named from the file (nut 1, nut 2…), and an assembly keeps
  its shape: each part where the file puts it.
- **Units come from the file** (inch, metre or millimetre — no units to choose), and **edges are the model's own**:
  a line where two faces meet, never across a face, so cylinders, bolts and holes have no facet lines. Tangent edges
  (where a rounded face meets a flat one) can be drawn or left out, for the whole import or per part.
- **The drawing carries only the file's record**: re-open it and import the same file again, and every part comes
  back (inside combined parts too). STEP parts can be combined, sectioned and moved like any imported part.
- **Offline**: the STEP reader (OpenCascade, LGPL-2.1, 3 MB to download) is fetched the first time a STEP file is
  opened and kept for offline use across updates — never downloaded again with each release. It reads in the
  background, so Word stays responsive; an 18-part assembly reads in under a second.
- A Solid Edge part (.par/.psm/.asm) is now pointed to **Save As → STEP** (it keeps the parts and their exact edges).

## [2.183.0] — 2026-10-21 — Drawing (CAD): combine imported parts

docs/SCOPE-MESH-BOOLEANS.md.

- **Combine two imported STL or OBJ parts**: select one, choose Join to this, Cut out of this, or Keep only the overlap
  with another, and Combine. The result is one part drawn like any imported part — a cube with a rod cut out of it
  shows the circle on top and the bore's hidden lines in front and side views, with no seam where parts met.
  Separate puts the two parts back, where the combined part is drawn now (moved or turned since, they move with it).
  Callouts and exploded-view offsets move to the combined part, and the status line says which.
- **The drawing carries the recipe, never the triangles**: a combined part re-opens like an imported one — import the
  same files again, in any order, and each is put back into the combined part and the result computed again.
  Combinations nest up to four deep.
- Refused by name: a cut that misses the part ("move one part into the other first" — a small real cut, a 1 mm pin
  hole in a 200 mm block, is a cut), a join of parts that do not make one piece, an overlap of parts that do not meet, an open surface, a result over the facet limit, catalogue and sketched
  parts (not yet). A join where one part lies wholly inside the other says so.
- The geometry engine is Manifold 3.5.4 (Apache-2.0), loaded only when parts are first combined, and available
  offline. Checked against closed-form volumes and flush contact in the engine itself, and walked end to end in the
  built pane.

## [2.182.0] — 2026-10-21 — Accessibility gate; sequence listings that pass WIPO's DTD

Hit-list #14.

### Fixed
- **ST.26 sequence listings with two or more sequences, or a sequence with a feature, failed WIPO's DTD**: every
  feature numbered its qualifier ids from q1, and the DTD declares them XML IDs, unique in the whole document
  ("ID q1 already defined"). They are now numbered q1…qN across the listing. **Regenerate any multi-sequence listing
  exported before this version.**
- **A listing with neither the applicant's file reference nor the application's office code and number** was exported
  although the DTD requires one of them; it is now refused by name until one is given (and an application
  identification needs both the office code and the number).
- **Accessibility faults in the pane**: eleven labelled containers carried a label without a role (the symbol palette,
  the drawing and page canvases, the CAD parts, callout, detail and section lists, the sketch editor and its groups); the Sequence molecule-type and References cross-reference selects had no name; the beam
  diagram had no text alternative; a disabled Insert button's text was 2.4:1 on its grey (now 5.2:1, light and dark).

### Added
- **An accessibility gate in QC** (18 gates): axe-core checks Home and every tool, light and dark, in the same headless
  Chromium as the render check — zero WCAG 2.1 A/AA violations (and no "needs review" use of a prohibited ARIA
  attribute), with a canary that proves the checker ran.
- **A DTD gate for sequence listings**: every listing the builder writes is validated against WIPO's ST.26 DTD (V1_3,
  vendored from wipo.int), by a validator whose verdicts match libxml2's on every listing the builder writes and on one
  broken listing per kind of error (39 of 39). A refused build now also clears the previous listing, so nothing stale
  can be downloaded. DTD validity is necessary, not sufficient: open the file in WIPO Sequence
  before filing, which also applies the standard's business rules.
- The structure round trip from a picture's alt text (punch list #8) was already in place: JurisLab's structure
  pictures reopen on the canvas from the OCL-ID they carry.

## [2.181.0] — 2026-10-21 — Chemistry: partly saturated rings named

IUPAC stage 3e, the last of stage 3 (docs/SCOPE-IUPAC-STAGES.md); forms from P-31.2 read verbatim.

- **Indolines, tetrahydroquinolines and the like by their 2013 names**: 2,3-dihydro-1H-indole (not indoline),
  1,2,3,4-tetrahydroquinoline, 1,2,3,4-tetrahydroisoquinoline, 2,3-dihydro-1-benzofuran, 2,3-dihydro-1-benzothiophene,
  2,3-dihydro-1H-indene (not indane), with substituents and principal groups — 5-chloro-2,3-dihydro-1H-indole,
  1,2,3,4-tetrahydroisoquinoline-3-carboxylic acid (the recommendations' own example), 2,3-dihydro-1H-inden-1-ol,
  1-phenyl-2,3-dihydro-1H-indole. The hydro prefixes stand before the indicated hydrogen and after the alphabetized
  prefixes (P-31.2.1).
- Still refused by name: a ring C=O on these rings (oxindoles, 3,4-dihydroquinolin-2(1H)-ones need added hydrogen), a
  carboxy, ester or cyano group on their ring nitrogen (a Boc-tetrahydroisoquinoline), and tetralin (its hydro locants
  follow the suffix), and two different ring skeletons that only hydrogenation tells apart (tetrahydroquinoline on
  isoquinoline). Every new name reads back through OPSIN (371 added, 0 wrong); one independent review round pinned.

### Fixed
- **OH or NH₂ on a ring nitrogen is the ring's suffix**, the 2013 form: piperidin-1-ol, piperidin-1-amine,
  morpholin-4-amine, 1H-pyrrol-1-ol, pyrrolidine-1,2-diol (P-63.1.3, P-62.2.1.3). v2.180.0 and earlier wrote
  "1-hydroxypiperidine" and "1-aminopiperidine", which read back to the right structure but are not the preferred names;
  with a senior group it stays a prefix (1-hydroxypiperidine-2-carboxylic acid).

## [2.180.0] — 2026-10-21 — Chemistry: a ring on a ring named

IUPAC stage 3d (docs/SCOPE-IUPAC-STAGES.md), seniority from the 2013 recommendations read verbatim (P-44.1.1,
P-44.2.1 (a)–(g), P-44.4.1.1).

- **A ring bonded directly to another ring is named on the senior one**: 4-phenylpyridine, 2-phenyl-1H-indole,
  2-phenylnaphthalene, 1-phenylpiperazine, 1-phenylpyrrolidin-2-one, tert-butyl 4-phenylpiperazine-1-carboxylate,
  2-(thiophen-2-yl)furan, cyclohexylbenzene, phenylcycloheptane. The ring with the principal group comes first
  (4-(pyridin-2-yl)benzoic acid, 4-(pyridin-4-yl)aniline); then heterocycles, nitrogen, O before S, more rings, more
  atoms, more heteroatoms (4-(pyridin-3-yl)morpholine), and more double bonds (benzene before cyclohexane).
- Still refused by name: ring assemblies of identical rings (biphenyls, bipyridines — the forms of their substituted
  names are not confirmed), a ring on its own hydrogenated form (2-(piperidin-2-yl)pyridine is hexahydro-2,2′-bipyridine,
  P-54.3; only one benzene with one cyclohexane is named substitutively), rings joined through a chain or an atom
  (diphenylmethane, diaryl ethers), and a senior ring carrying a substituted ring (4-(4-methylphenyl)pyridine). Every
  new name reads back through OPSIN (225 added, 0 wrong); one independent review round pinned.

### Fixed
- **A nitrogen between two rings now takes the senior ring as its parent by every criterion**: pyridin-2-yl and
  morpholin-2-yl on one NH is N-(pyridin-2-yl)morpholin-2-amine (morpholine has more heteroatoms); v2.179.0 wrote
  "N-(morpholin-2-yl)pyridin-2-amine". Pyrimidin-2-yl beside pyridin-2-yl, refused before as a tie, is
  N-(pyridin-2-yl)pyrimidin-2-amine.

## [2.179.0] — 2026-10-21 — Chemistry: Boc and other carbamates named

IUPAC stage 3c (docs/SCOPE-IUPAC-STAGES.md), forms from the 2013 recommendations (P-65.2.1, P-65.1.2.2.2).

- **A carbamate on a saturated ring nitrogen is the ester of the ring's carboxylic acid**, the 2013 form: tert-butyl
  piperidine-1-carboxylate, tert-butyl 4-oxopiperidine-1-carboxylate, tert-butyl 4-methylpiperazine-1-carboxylate,
  tert-butyl morpholine-4-carboxylate, di-tert-butyl piperazine-1,4-dicarboxylate; the acid itself
  (pyrrolidine-1-carboxylic acid).
- **On an open-chain nitrogen**: tert-butyl methylcarbamate, methyl phenylcarbamate, ethyl carbamate,
  tert-butyl (piperidin-4-yl)carbamate, dimethylcarbamic acid.
- **An N-Boc lactam is named as the ring-N carboxylate** (tert-butyl 2-oxopiperidine-1-carboxylate: the acid outranks
  the ketone).

### Fixed
- **A nitrile on a ring nitrogen has its 2013 form**: piperidine-1-carbonitrile, morpholine-4-carbonitrile,
  1H-pyrrole-1-carbonitrile (P-66.5.1.1.3). v2.178.0 and earlier wrote "(piperidin-1-yl)methanenitrile", which reads
  back to the right structure but is not the preferred form.
- Still refused by name: a Boc on an aromatic ring nitrogen (Boc-indole), Cbz (the benzyl ester's form is not yet
  checked), a Boc on a chain that carries its own group, Boc-amino acids (a junior carbamate), a Boc ring beside a free
  acid, a carbamate N with two different substituents (its N-locant form is not confirmed). Every new name reads back
  through OPSIN (136 added, 0 wrong); one independent review round pinned.

## [2.178.0] — 2026-10-21 — Chemistry: sulfonamides, sulfonic acids and sulfones named

IUPAC stage 3b (docs/SCOPE-IUPAC-STAGES.md), forms from the 2013 recommendations (P-65.3, P-66.1.1.2, P-65.4.1).

- **Sulfonic acids and sulfonamides as the principal group**, below carboxylic acids and carboxamides in seniority:
  benzenesulfonic acid, 4-methylbenzene-1-sulfonic acid, methanesulfonamide, 4-aminobenzene-1-sulfonamide,
  pyridine-3-sulfonamide, 4-chlorobenzene-1,3-disulfonamide; N-substituted: N,N-dimethylmethanesulfonamide,
  4-methyl-N-propylbenzene-1-sulfonamide.
- **Sulfones by the preferred prefix**, enclosed: (methanesulfonyl)benzene, (propane-1-sulfonyl)benzene,
  2-(methanesulfonyl)benzoic acid; junior groups as sulfo and sulfamoyl (4-sulfamoylbenzoic acid).
- Still refused by name: sulfonate esters, sulfonyl halides, sulfoxides, thioethers and thiols, a sulfonyl on a ring
  nitrogen, sulfuric acid and sulfamides, N-acyl sulfonamides, diaryl sulfones, and a carbonyl or nitrile carbon on
  a sulfonyl S. Every new name reads back through OPSIN (296 added, 0 wrong); one independent review round pinned.

## [2.177.0] — 2026-10-21 — Chemistry: lactams, lactones and imides named

IUPAC stage 3a (docs/SCOPE-IUPAC-STAGES.md).

- **Lactams, lactones and imides of the saturated rings the namer numbers are named as the ring's ketones**, the
  2013 form: pyrrolidin-2-one, 1-methylpyrrolidin-2-one, piperidin-2-one, piperazin-2-one, morpholin-3-one,
  oxolan-2-one, oxan-2-one, pyrrolidine-2,5-dione, piperidine-2,6-dione, with substituents and with a senior group
  (5-oxopyrrolidine-2-carboxylic acid); cyclic anhydrides of those parents as their diones (oxolane-2,5-dione).
- Still refused by name: 4- and 7-membered rings, cyclic carbamates and ureas, thiolactones, aromatic pyridinones,
  unsaturated lactones and maleimides, N-acyl lactams.
- Every new name reads back to its structure through OPSIN (288 added to the oracle, 0 wrong); an independent review
  checked 1,603 two-substituent structures for lowest locants and 20 against PubChem.

## [2.176.1] — 2026-10-21 — The "0,5;1,5" question, finished

### Fixed
- **A Stats group field's advice now leads to a result.** For the decimal reading it said "Write 0.5", which in One-way
  ANOVA, Tukey and Dunnett is a group of one value and the next refusal. It now says how decimals are typed in a group
  field — points, spaces between the values of a group and ; or a blank line between groups — with an example that
  computes.
- **Groups separated by blank lines are asked too** ("0,5", a blank line, "1,5" …, with or without semicolons), as the
  group reader splits them; the blank lines are shown (⏎) in the message. Pieces such as 1e5 or 10³ beside "1,5", and a
  no-break space before %, no longer let the question slip.
- **Every number in the message is shown as typed**, the comma turned into a point: no digit is rounded away (0.10 stays
  0.10, an 18-digit value keeps its digits), and a ×10ⁿ tail typed as x10^-3 is written ×10⁻³.
- **A no-break space before % no longer changes how a list is read** ("9,350 2,5 %" was 9350; it is 9.35, as with a
  plain %), and a dotted decimal comma (1.000,5) in a group field — which that reader splits — is asked too.
- Three further independent review rounds pinned (semicolonComma.test.ts).

## [2.176.0] — 2026-10-21 — "0,5;1,5;2,5" is asked, not guessed

### Changed
- **A field typed with semicolons and one comma per value ("0,5;1,5;2,5") is now refused with both readings named**
  — three decimals (0.5; 1.5; 2.5) or values the commas separate (0, 5; 1, 5; 2, 5) — and how to type each. Before,
  the readers disagreed in silence: a Stats group field read pairs, a list field read decimals. Applies to every
  Stats list field, Stats group fields split at semicolons, and the Finance and Bio/Assay list fields; the same
  question with % or ×10ⁿ ("1,5%;2,5%") is asked too. Fields whose rows need two values (Kaplan–Meier time and event,
  regression rows, subjects, contingency counts, Cox, two-way) keep the pairs, their only reading. A list of thousands
  ("-10,000; 2,500") is not asked — semicolons are how such a list is typed. Values separated
  by spaces or line breaks ("1,5 2,5"), a comma then a space ("0, 5; 1, 5") and comma lists ("1,2,3;4,5,6") read as
  before. Two independent review rounds pinned (semicolonComma.test.ts).

## [2.175.0] — 2026-10-21 — Engineering: plane frames, plate stress, shelf life, electrochemistry

Gap item 5: six calculators, each drawing its figure (Engineering now 153 calculators).

- **Plane frame** (Structural & solids): direct stiffness with Euler–Bernoulli members — nodes, members with their own E,
  A and I, pinned ends, fixed/pin/roller supports, joint loads, loads along members. Displacements, reactions, axial
  forces and the bending-moment diagram on the deflected shape, with an equilibrium check; a mechanism, or a load the
  frame cannot carry, is refused. Checked against closed forms and against anastruct.
- **Plate in plane stress** (Structural & solids): constant-strain triangles, edge supports, tractions, pressure and point
  loads; the von Mises map. Passes the patch test exactly; a plate free to move is refused.
- **Arrhenius shelf life** (Pharmacokinetics): rate constants, or assay series fitted first or zero order, at stress
  temperatures; Ea with its 95 % interval; t₉₀ at the storage temperature, also at the upper 95 % bound of k. Zero order
  counts 10 % of the starting assay in its own units; kelvin typed as °C and a negative activation energy are refused.
- **Nernst, Butler–Volmer and Tafel** (Energy & power): the potential from E° and activities, the current–overpotential
  curve with its Tafel slopes and charge-transfer resistance, and a Tafel fit to your own polarisation data.
- Every input that is not a number, or a key the line does not take ("Fz=", "v="), is refused rather than dropped.

## [2.174.0] — 2026-10-21 — Compound tables from the document's register

Gap item 4: the table a medicinal-chemistry patent's Examples end with, built in one insert from the compounds the
document's schemes have numbered.

- **Reaction ▸ Compounds in this document ▸ Compound table.** Choose the columns (Structure, Name, Formula, MW on by
  default; Exact mass, [M + H]⁺, SMILES), the compounds (all, or `1–5, 7, 2a`), your own columns (`IC50 (nM), Yield (%)`,
  left empty to fill in) and a caption.
- **One native Word table**, rows in compound-number order, each structure drawn as the schemes draw it (ACS 1996) and
  placed in its cell at 300 dpi; the caption above, as patent tables carry it.
- **Names** from the dictionary (in the case chemists write them: o-xylene, ATP) or the offline systematic namer with its
  CIP descriptors, so two enantiomers are named alike; "—" with the reason where neither has one.
- **Masses** from the stored structure itself; an ion's exact mass is its m/z; a salt's masses are left to you.

## [2.173.0] — 2026-10-21 — Antibody: numbering, CDRs, identity and claim text

Gap item 3: antibody patents claim CDRs, and a CDR means nothing without its definition.

- **New tool: Antibody** (Life science). Paste VH and VL sequences (κ or λ), a VHH, or an scFv (read as two domains);
  signal peptides and constant regions are trimmed and said.
- **Numbering** by Kabat, Chothia and IMGT for every residue, from the domain's conserved landmarks, with each scheme's
  insertion positions. Checked against an independent numbering tool (AntPack): all 23 real therapeutic chains exact, and
  157 of 161 chains overall (the rest are CDRs cut below natural lengths, where tools differ; a note says so).
- **CDRs** by the Kabat, Chothia, IMGT or AbM definition, named wherever a CDR appears.
- **% identity** between chains, aligned by IMGT position, over the V domain, the frameworks or the CDRs.
- **Claim text** (six-CDR, VH/VL and percent-identity claims) numbered from the SEQ ID NO you choose; the **SEQ ID table**;
  the sequences with their CDRs bold and underlined.
- Not attempted: germline assignment, EU constant-region numbering, T-cell receptors.

## [2.172.0] — 2026-10-21 — Solid form: XRPD, DSC and TGA for polymorph claims

Gap item 2: the data polymorph, salt and co-crystal patents rest on, from the user's own instrument exports.

### Added
- **Solid form** (a new tool, Chemistry). Nothing is predicted: every number comes from the pasted data.
  - **Reading**: any common text export — headers and metadata lines, tabs, commas, semicolons, decimal commas and
    thousands separators (decided once for the whole file), and three-column thermal exports (time, temperature, signal) with the columns
    chosen by header, stated, and changeable in the pane.
  - **XRPD**: a measured pattern (any steady step) has its peaks picked — SNIP background (an amorphous halo or a steep
    low-angle rise stays in the background), Savitzky–Golay smoothing scaled to the step, a noise floor measured from the
    pattern itself (counts, cps or normalised), a prominence test, parabolic refinement; in an unstripped Cu Kα pattern,
    Kα2 shoulders are left out and named; a pattern with only a broad halo is said to look amorphous, with no claim written. A typed list (`6.8 100`,
    `6.8,100`, `5.2, 10.4, 15.6`, `5,2;10,4;15,6`, `6.8° 100%`, `5.2 ± 0.2`, or a `2θ d I` table, the d column found by
    Bragg's law) is used as given, near-duplicates merged. Each peak gets its Bragg d-spacing (Cu Kα1, Cu Kα weighted,
    Co Kα1, Mo Kα1) and relative intensity.
  - The claim sentence: "…characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about
    … ± 0.2° 2θ, measured with Cu Kα1 radiation", citing the N strongest peaks by angle; 2θ to 0.1° (0.01° under
    ±0.1°); cited peaks closer than twice the tolerance are pointed out.
  - **DSC**: endotherms and exotherms with their onset (the baseline before the event meets the tangent at the leading
    edge's inflection, ASTM E794 / ISO 11357-1, from a local fit so noise does not move it) and peak; a glass transition
    is a step at its half-height midpoint (ASTM E1356), never an endotherm; an onset that cannot lie inside its event is
    not printed. **TGA**: weight-loss steps from the drift-corrected DTG, overlapping steps split at the DTG minimum,
    each loss in % of the starting weight across its whole tail, the fastest-loss temperature; a gain is said; the
    figure in % of initial.
  - Figures through the pane's figure styles (USPTO, Nature, ACS …) and the multi-panel tray, drawn black and white
    with no grid so the USPTO style takes them; tables as editable Word tables; the sentence as text.

## [2.171.0] — 2026-10-21 — Diagrams: patent figures from text

Gap item 1: the line figures almost every utility patent carries.

### Added
- **Diagrams** (a new tool, Data & figures): type a few lines, get a figure in USPTO style (37 CFR 1.84) — black lines,
  lettering never under 1/8 in, reference numerals, the figure's own numeral (100) with its arrow, "FIG. n".
  - **Block diagrams** (`104 Physiological sensor`, `104 -> 112`) and **flowcharts** (`start`, steps, `? 410` decisions,
    `410 yes -> 415`, `end`), laid out in layers with orthogonal arrows; loops go back up the right side.
  - **State diagrams** (`[*] -> Idle`, `Idle -> Active : start`) and **sequence diagrams** (participants, messages,
    dashed replies, self-messages).
  - **Timing diagrams**: clocks, 0/1 levels, x (unknown, hatched), z (high impedance), labelled bus values on a time grid.
  - **Schematics** on a grid: resistor, capacitor, inductor, diode, LED, battery, voltage and current sources, switch,
    fuse, ground, supply, NPN/PNP, NMOS/PMOS, op-amp, wires, net labels; junction dots where three or more ends meet.
  - Numerals in the box (underlined, as "Control circuit 112") or outside on curved lead lines.
- Inserted at its drawn size; a figure wider than the 17.0 cm sheet is said, never shrunk. Refused by name: an arrow to
  an undefined box, a numeral used twice, a decision without two exits, an unknown symbol, a figure over 3 sheets, a
  schematic point off the grid; a floating terminal, an unconnected box and an undeclared participant are noted.
- Clean lines, by construction and by test: no arrow through a box; arrows from different sources never share a line
  (each gets its own entry point and arrowhead, on a diamond's slanted side if need be); return loops leave and enter
  through a box's right side and nest without crossing; a decision's exits never cross; every arrowhead lands on its
  box's outline (rounded corners, stadium ends, circles included); labels are placed where they touch no box, line,
  numeral or other label; two self-loops on one box take opposite sides; `<->` is one line with two arrowheads.

## [2.170.0] — 2026-10-20 — Chemistry: fuller IUPAC names, stage 2 (fused rings)

Organic chemistry, item 4, stage 2: the fused ring systems drug-like structures are built on.

### Added
- **Fused bicyclic parents with their peripheral numbering** (fusion atoms 4a/8a, 3a/7a): naphthalene, quinoline,
  isoquinoline, quinazoline, quinoxaline, 1H-indole, 1H-indazole, 1H-benzimidazole, 1-benzofuran, 1-benzothiophene,
  1,3-benzoxazole, 1,3-benzothiazole — with substituents and a principal group (naphthalen-1-ol, quinolin-8-ol,
  1H-indol-5-amine, 1-benzofuran-2-carboxylic acid, 1,3-benzothiazol-2-amine, 1-methyl-1H-indole).
- **Tautomers as drawn**: 5-methyl- and 6-methyl-1H-benzimidazole are the two tautomers, each named for the hydrogen drawn.
- **As substituents**: 2-(1H-indol-3-yl)ethan-1-amine (tryptamine), 2-(naphthalen-2-yl)ethan-1-ol, naphthalen-2-yl acetate.
- Every new name passed the OPSIN round-trip oracle (now 1,900+ names, 0 wrong, 0 collisions).

### Changed
- **The parent of an N-substituted amine follows seniority**: rings before chains, then a nitrogenous ring, then (only
  when neither has nitrogen) O before S, then more rings, then more ring atoms, then aromatic; between chains, the
  longer chain (N-phenylnaphthalen-2-amine, N-(thiophen-2-yl)furan-2-amine, N-(1,3-thiazol-2-yl)pyridin-2-amine,
  N-(furan-2-yl)oxan-4-amine, N-phenylcycloheptanamine). When the senior branch's partner cannot be a plain N-prefix
  (a substituted phenyl, an undecyl, a 2,2-dimethylpropyl), the name is refused rather than built on the junior branch.

Still refused by name: partly saturated fused systems (indoline, tetralin, decalin), three or more fused rings
(phenanthrene), bridged and spiro systems, quinolinones and other ring C=O in aromatic systems, two separate ring
systems in the parent.

## [2.169.0] — 2026-10-20 — Chemistry: fuller IUPAC names, stage 1b (heterocycles)

Organic chemistry, item 4, second stage: the heterocycles drug-like structures are built from.

### Added
- **Heterocyclic parents with their fixed numbering**: pyridine, pyrimidine, pyrazine, pyridazine, furan, thiophene,
  1H-pyrrole, 1H-imidazole, 1H-pyrazole, 1,3-oxazole, 1,2-oxazole, 1,3-thiazole; piperidine, piperazine, morpholine,
  pyrrolidine, oxolane, oxane — with substituents (2-chloropyrimidine, 1-methylpiperidine, 4-methylmorpholine) and a
  principal group (pyridin-2-amine, pyridine-3-carboxylic acid, furan-2-carbaldehyde, 1,3-thiazol-2-amine,
  piperidin-4-one).
- **The hydrogen as drawn decides the number**: 4-methyl-1H-imidazole and 5-methyl-1H-imidazole are the two tautomers,
  each named for the one drawn.
- **N-substituted heteroaryl amines and amides**: 5-chloro-N-methylpyridin-2-amine, N-phenylpyridin-2-amine (one name
  however it is drawn: heterocycles rank before carbocycles), 6-chloro-N,N-dimethylpyridine-3-carboxamide.
- **Heterocycles as substituents**: 2-(pyridin-2-yl)ethan-1-ol, 2-(morpholin-4-yl)ethan-1-ol,
  3-(piperidin-1-yl)propanoic acid, 2-(1H-imidazol-1-yl)ethan-1-ol.
- Every new name passed the OPSIN round-trip oracle (now 1,190+ names, 0 wrong, 0 collisions).

### Fixed
- A group's O or N carrying a further bond (or an atom with an impossible valence, as an uncharged O with three bonds)
  is refused; before, the rest of the molecule could drop out of the name (found by the oracle while extending it).

Still refused by name: fused rings (indole, quinoline — stage 2), lactams and lactones, pyridinones, partly saturated
rings, other heterorings, sulfur outside thiophene and thiazole, an amide on a ring nitrogen, bicyclic parts cut off
as an ester's alcohol or an N-substituent, and two different ring groups of equal seniority on one nitrogen (the
parent would otherwise follow the drawing order).

## [2.168.0] — 2026-10-20 — Chemistry: fuller IUPAC names, stage 1a (carbocycles)

Organic chemistry, item 4, first stage: systematic names for what organic patents draw most, each one proved by
reading it back.

### Added
- **Benzene principal groups** with their retained parents: phenol, aniline, benzoic acid, benzaldehyde, benzonitrile,
  benzamide (4-chlorophenol, 2-hydroxybenzoic acid, 3-nitrobenzoic acid); two of a kind as benzene-1,2-diol,
  benzene-1,4-dicarboxylic acid.
- **Groups on carbocycles**: cyclohexanecarboxylic acid, cyclohexanecarbaldehyde, -carbonitrile, -carboxamide,
  2-methylcyclohexan-1-ol, cyclohexane-1,2-diol.
- **Esters**: ethyl acetate, methyl 4-nitrobenzoate, phenyl acetate, diethyl butanedioate, ethyl 3-oxobutanoate.
- **N-substituted amines and amides**: N-methylmethanamine, N,N-dimethylaniline, 4-chloro-N-methylaniline,
  N-methylcyclohexanamine, N-methylacetamide, N,N-dimethylformamide, N-phenylacetamide.
- **Cycloalkyl substituents**: cyclohexylmethanol, 1-cyclohexylethan-1-ol.
- **Proved names**: every name the namer gives for its oracle corpus (generated structures, the whole compound
  dictionary, drug-like ones and every case the review rounds raised — 700+ distinct names) was read back by OPSIN to
  exactly that structure, and no name is given to two structures; names with stereodescriptors are checked with stereo
  ("methyl (2R)-2-chloropropanoate"). A test gate, run offline from OPSIN's cached answers.
- **Stereodescriptors in the right place**: before an ester's acid part (methyl (2R)-2-chloropropanoate), and without a
  locant where the name has none ((S)-chloro(phenyl)acetic acid). Stereo in a part named as a word or N-prefix is said,
  never given a wrong descriptor.

### Changed
- Retained names where current IUPAC recommendations use them: formic acid, acetic acid (chloroacetic acid,
  phenylacetic acid), formamide, acetamide — not methanoic/ethanoic; benzoic acid, not "phenylmethanoic acid"; a lone
  group on a ring takes no locant (cyclohexanol, cyclohexanone).
- Refusals name the group in words ("An aldehyde group alongside a more senior group…", not "A al group").
- Prefixes that lose their locants are enclosed where they could fuse: chloro(methoxy)acetic acid, chloro(phenyl)methanol
  (never "chloromethoxyacetic acid", which is a different compound); di-tert-butyl, not "ditert-butyl".

Still refused by name: heterocycles (pyridine, piperidine, morpholine — stage 1b, next), fused rings, ring assemblies,
lactones, anhydrides, carbamates, esters of two different alcohols, two substituted nitrogens.

## [2.167.0] — 2026-10-20 — Chemistry: compound numbers kept by the document

Organic chemistry, item 3 (second half): the numbers in a document's schemes and Examples are one numbering.

### Added
- **The document's compound register.** Each number used in an inserted scheme is kept in the document (its
  settings, as the reference numerals are) with the structure it stands for. Reaction lists them under **Compounds in
  this document**: number, formula, what it was typed as — **Insert number** puts a bold number at the cursor;
  **Forget** takes one out (the document's text is not changed).
- **Checks before you insert** (warnings — the numbering is yours): a number the document already uses for a
  different structure ("Compound 2 is already in this document as C₇H₆O₃ (salicylic acid) — here it is C₆H₆O"); a
  structure the document already numbers otherwise; a new number that skips ("Compound 7 skips 5–6"). Stereo counts:
  (R) and (S) are different compounds. A number registered for another structure is never overwritten.
- **Number new compounds** (Reaction): unnumbered compounds take the next free numbers in the document; one the
  document already numbers keeps its number, and a compound drawn twice in one scheme gets one number.
- **Characterization reads the register**: Compound `compound 3` (or `cpd 3`, or a bare `3`) is the document's
  compound 3, said in the checks. A bare label that is also something else (`S3` is the formula S₃) is read as typed,
  and the checks say to write `compound S3` for the register's.

## [2.166.0] — 2026-10-20 — Chemistry: numbered reaction schemes

Organic chemistry, item 3: the scheme as a journal draws it.

### Added
- **Numbered compounds.** In Reaction (Structures), a compound followed by a space and its number in brackets —
  `aspirin (1)`, `CCO (2a)`, `(S3)`, `(3′)` — is drawn with its number in bold under the structure, all numbers of a
  row on one baseline. A bracket that is not a number (`(DIPEA)`, `copper (II)`) is refused by name, never drawn as one.
  One number on two different structures is an error; one structure under two numbers is said.
- **Conditions on every arrow.** One item per line: a compound line, an arrow line `-> reagents ; conditions`, the next
  compound. Reagent formulas are typeset (H₂SO₄, LiAlH₄, Pd(PPh₃)₄) and long conditions wrap at their commas; an arrow
  grows to fit its text. The one-line form `A + B >> C ; over ; under` is unchanged.
- **Lettered conditions**: (a), (b) on the arrows and a "Reagents and conditions: (a) …; (b) …." paragraph under the
  scheme.
- **Multi-step schemes wrap** at the page width (6.5 in) or an ACS column (3.25 in / 7 in); each new row starts with its
  arrow. A structure is never drawn smaller to fit — a row that cannot fit is said.
- **Scheme caption** (optional) above the scheme, as ACS sets it: bold **Scheme N.** with a Word SEQ field (Word
  renumbers on field update) and your title, with the scheme's compound numbers in it set bold.
- **Open in Build canvas**: the scheme opens on the page canvas to move or edit anything by hand.

### Changed
- **ChemDraw-quality drawing.** The scheme is one ChemDraw page in the ACS Document 1996 style (bond 14.4 pt, Arial
  10 pt), drawn by the Build canvas's own renderer, so every compound has the same bond length. Before, each structure
  was fitted into its own box and bond lengths differed from compound to compound.

### Fixed
- Text after a subscript in a ChemDraw page (canvas, ChemDraw files, schemes) could stay lowered in some renderers
  ("LiAlH₄, THF" with ", THF" below the line): the shift back to the baseline now rides on the next piece of text.

## [2.165.0] — 2026-10-20 — Chemistry: Characterization text for Example sections

Organic chemistry, item 2: the characterization paragraph every Example carries, written from the chemist's own data.

### Added
- **Characterization** (Chemistry & structures; a new tool): paste MestReNova's paragraph, a journal or RSC list
  (δH (400 MHz; CDCl₃) 7.26 (2H, d, J 8.4)), or one signal per line (7.26 d 8.0 2H), and get the ¹H and ¹³C lines in
  journal form; add HRMS, yield (mg, mmol, %), mp, R_f and elemental analysis. Inserted as formatted Word text —
  italic *J* and *m*/*z*, CDCl₃, DMSO-*d*₆, real superscripts — exactly the text the preview shows.
- **Two styles.** JOC, from the J. Org. Chem. author guidelines: ¹H NMR (CDCl₃, 400 MHz): δ 7.05 (dd, 1H, J = 8.0,
  2.1 Hz); ¹³C{¹H}; ¹H to 0.01 ppm and ¹³C to 0.1 ppm (rounded by digits, never padded, close peaks never merged);
  HRMS (ESI/TOF) m/z: [M + H]⁺ Calcd for C₈H₁₁N₄O₂ 195.0877; Found 195.0874. Common: MestReNova's order, every value as
  typed.
- **Calcd values from the formula**: HRMS for [M + H]⁺, [M + Na]⁺ (Na written last, as JOC writes it), [M + K]⁺,
  [M + NH₄]⁺, [M + 2H]²⁺, [M] for a structure drawn as an ion (its own charge: [M]⁺, [M]⁻, [M]²⁺), [M]⁺• for EI and the negative ions, electron mass included (agrees
  with Mass Spec's adduct table); elemental analysis C/H/N/S; mmol and yield. Compound by name, formula or SMILES, or
  **From Build** (the structure drawn).
- **Checks beside the text** (they warn, never block): integrations against the formula's ¹H count — OH/NH/SH named,
  expected absent in D₂O or CD₃OD, deuterium not counted as ¹H; a dd with one J; a segment that could not be read
  (named, never dropped — including a missing comma between signals, decimal commas and a second list pasted in the
  same box); header items such as TMS or 353 K kept as typed; ¹³C signals against symmetry-distinct carbons (diastereotopic carbons kept apart) and the
  carbon count; Found outside 0.003 m/z, and the ion it does match ("Found matches [M + Na]⁺"); EA outside 0.4 %; a
  yield over 100 %; ¹H data in the ¹³C box; a header for the other nucleus.
- **Refused by name**: HRMS for a hydrate written with a fraction, for a salt or solvate (·HCl, ·H₂O — enter the
  parent) or a salt drawn as two ions (enter the ion), adduct ions of an already-charged structure, [M − H]⁻ with no hydrogen; elemental analysis of a labelled compound.

### Fixed
- CHANGELOG: the 2.162.0, 2.162.1 and 2.163.0 sections had lost their headings (their notes read as part of the
  release above); restored, and a test now fails on a dated line with no version.

## [2.164.0] — 2026-10-19 — Chemistry: CIP stereodescriptors (R/S, E/Z)

Organic chemistry, item 1: patent claims name stereoisomers by their CIP descriptors.

### Added
- **R/S and E/Z, computed by the CIP rules** from the drawn wedges and double-bond geometry. The Build readout's new
  **Stereo** line and the Chemical name line give the systematic name with its descriptors — (2R)-butan-2-ol,
  (2S)-2-aminopropanoic acid, (2R,3E)-hex-3-en-2-ol, rac-(2R)-… for an AND group, rel- for an OR group — when the subset
  namer names the structure and every stereo element is given; otherwise what is given and, for each element not
  given, why.
- **Refused by name, never guessed**: pseudo-asymmetric centres (r/s), like/unlike pairs and other ties that need CIP
  rules 3–5; axial chirality (allenes, biaryls — M/P not yet); a ranking that would depend on where a ring's double
  bonds are drawn; a cumulene's cis/trans; a degenerate drawing (atoms on top of each other); a centre drawn without a wedge; a ranking too large to finish (a hard work limit — never a frozen
  Word). A descriptor is shown only when JurisLab's own ranking and OpenChemLib's agree.
- **Checked against the CIP Validation Suite** (Hanson et al., J. Chem. Inf. Model. 2018, 58, 1755; 300 structures):
  0 wrong, 0 extra — 835 descriptors given from SMILES, 834 from wedged drawings, the rest refused by name
  (`node scripts/cip-suite.js`; OpenChemLib on its own gives 117–129 wrong).

## [2.163.0] — 2026-10-19 — Chemistry: metallocenes and η-bonds in Build ▸ Draw

User request: draw metallocene catalysts and polymer-bound metallocenes in the Build canvas.

### Added
- **Organometallic row under Build ▸ Draw**: a **Metallocene template…** menu — metallocene dichloride (Cp₂ZrCl₂),
  ansa-metallocene (Me₂Si-bridged), half-sandwich (CpZrCl₃), bis(borohydride) (Cp₂Zr(BH₄)₂), polymer-bound
  (–[CH₂CH]ₙ– backbone, the whole metallocene in the repeat unit) — plus **η-bond** and **Cp ring**. Using any of them
  switches the canvas in place to the ChemDraw-style page canvas (the structure editor cannot hold a metal bound to a
  whole ring), carrying over what was drawn; a template is placed beside it. "Back to the structure editor" returns.
- **η-bond tool** (page canvas and large canvas): click inside a ring (or on a ring atom or bond), then the metal —
  or the metal first. Written as ChemDraw writes it (a MultiAttachment centre at the ring's centroid, bonded to the
  metal); η² to η⁸. Deleting a ring atom, erasing the bond or moving the ring keeps it valid; its centre is a point,
  never an atom (no label, bond or charge goes on it).
- **Cyclopentadienyl (Cp)** in the Ring tool's list: five delocalised bonds. Template rings are drawn in perspective
  (front edge bold, side edges wedged).
- **BH₄ as drawn**: "BH4" (and AlH4 …) on a metal is boron with four hydrogens, kept as drawn when its bonds change.
- The readout says plainly why a metallocene has no single formula, and Insert puts it in as drawn.

### Changed
- On the page canvas a click anywhere on an atom's label picks that atom (aiming at the atom's point in "Zr" missed).


## [2.162.1] — 2026-10-19 — Chemistry: the drawing survives the 3D tab

User report: "when I go from 2D to 3D and back, the canvas is blank."

### Fixed
- **2D → 3D → 2D in the large canvas no longer blanks the drawing** (nor does Text → Draw in Build mode). Hidden,
  the editor's page is 0 × 0 and OpenChemLib fitted the drawing to it — every atom moved to one point (measured:
  benzene's six atoms all at 0, 0). The canvas came back empty and **"Use this drawing" carried the collapsed
  coordinates**. The drawing is now kept as the editor is hidden, read from while hidden (the 3D model, Use this
  drawing), and put back when shown — wedges and stereo unchanged (same idcode), Ctrl+Z still undoes the last edit,
  quick back-and-forth included.
- **An edit in the 3D tab, then Ctrl+Z back in 2D**, returns the drawing before the edit — never the collapsed one
  (independent review: OpenChemLib stores the molecule as it is as its one undo state).
- A structure handed to the editor while it is hidden (an edit in the 3D tab, Edit in Draw) is laid out for the page
  when shown without using up the undo step.

## [2.162.0] — 2026-10-19 — Chemistry: the original drawing editor is back; ChemDraw files open structure by structure

From a live demo: a ChemDraw file opened on the canvas "very large" and could not be edited; the large canvas made
Word sputter; and drawing no longer corrected itself — "in the original editor, it behaved a lot like ChemDraw and
would self correct."

### Changed
- **The original ChemDraw-like editor draws structures again** (Structure ▸ Draw and the large canvas): the editor
  JurisLab had before v2.156, which corrects the drawing as you go. The page canvas of v2.156–v2.161 is kept only for
  what a molecule cannot hold — a ChemDraw page's brackets, arrows and captions — and appears only when one is opened.
  Insert, Insert selected, ChemDraw size / USPTO drawing sheet size and Save as .cdxml work from either; a structure
  with a query ChemDraw has no attribute for inserts with the editor's own picture, and the status says why.
- **Open ChemDraw file… shows the file's structures to pick from.** A patent ChemDraw file is a document (the demo
  file held 93 structures, 229 arrows and lines and 149 captions on a page 29 × 290 cm); putting all of it on the
  canvas made every atom a few pixels across. Now each structure is drawn small in a list; click one and it opens on
  its own, full size, in the editor. A structure that carries more than a molecule — polymer brackets and their n,
  a counter-ion, a generic atom such as X — opens on its own on the page canvas, as drawn, and the
  status says why; for a polymer, "Edit the structure in the structure editor" opens its repeat unit in the editor
  (brackets and labels left out, said so). "Open the whole page as a drawing" is still there. A structure from the
  editor inserts at ChemDraw's default (ACS) size.
- **The large canvas window is smaller** (75 % × 70 % of the screen) and holds only what is being edited.

### Fixed
- **ChemDraw R-groups keep their numbers.** ChemDraw writes every R-group as "R" and keeps the number in the label;
  R2, R3 … were read as R1 (wrong formulas and SMILES for any structure with more than one R-group). In the demo file,
  all 77 structures that are molecules now carry exactly the R-groups on the page.
- **Readable in dark mode:** outlined buttons (Insert name, Edit in Draw …) and canvas tools read as disabled (2.2:1
  contrast) — now a proper colour, contrast-tested.
- **Typing a compound name** in Chemical no longer lists every letter as an "Unexpected character" above its correct
  structure; Build's Text tab takes a name or a SMILES string (a formula is refused: it has no single structure).
- **Display:** formulas typeset (C₁₃H₁₈O₂, not C13H18O2) with g/mol; pKₐ; a true minus on net charge; reaction
  conditions typeset (H₂SO₄, Et₃N, Pd(PPh₃)₄).
- The properties panel's method notes fold under "About these estimates"; Edit in Draw scrolls to the editor; a
  status message no longer follows you into the next tool.

## [2.161.0] — 2026-10-19 — Drawing (CAD): section views, perspective views, OBJ parts

### Added
- **Section views** (37 CFR 1.84(h)(3)). **Add section view**, then two clicks on a front, top or side figure: the
  part is cut along that line, everything between the viewer and the cut taken away, and the cut faces hatched.
  - On the figure the section is taken from: the **cutting line** across the part, an **arrow at each end** showing
    the direction of sight, and its **name at each end** — the section's FIG number on a USPTO sheet, a letter on an
    ASME or ISO sheet (titled "SECTION A–A" / "A–A").
  - **Hatching** by the rule: regularly spaced oblique lines at 45°, every piece of one part hatched the same way,
    parts that touch hatched at different angles, the spacing from the area cut (never under 1.5 mm on paper, so a
    thin wall does not print black at two-thirds reduction, 1.84(k)). Holes stay clear.
  - A cut face hides what lies behind it; hidden lines behind the plane are left out unless Hidden lines asks for
    them. Flip looks the other way; Remove takes the section away. It is read after the figure it is cut from.
  - Refused by name, never drawn wrong: a part that is not a closed solid where it is cut (an STL with gaps), a line
    that misses the part, a section of a figure not on the sheet.
- **Perspective view** — "the views may be plan, elevation, section, or perspective views" (1.84(h)). Tick
  Perspective and choose its strength (Strong … Slight): the model from the isometric direction with the eye at a
  finite distance, receding edges converging, hidden lines removed by the same engine as every other view, curved
  outlines where the eye's lines of sight graze the surface. Callouts on it point at the right place.
- **OBJ parts.** Import DXF / STL / OBJ… now reads Wavefront .obj files (faces of any number of corners; texture and
  normal data, groups and materials ignored — a material file is never fetched). An OBJ goes through exactly what an
  STL does: units asked (an OBJ does not say them), closedness checked, edge angle, the drawing names the file. A line
  that cannot be read is refused with its line number.

### Not in this release (named limits)
- Offset, aligned, half, broken-out and revolved sections; hatch patterns by material (one general pattern is
  used); a cutting line's ends cannot be moved after it is taken (Remove and take it again).
- An OBJ face of more than three corners is split into triangles from its first corner, which is right for the
  convex faces CAD exporters write; a concave face would be filled wrongly.

## [2.160.0] — 2026-10-19 — Loose ends: number lists, Solve's curve, figure sizes

### Fixed
- **Solve drew no curve for an equation typed the natural way.** "x^2 - 5x + 6 = 0" inserted its roots and no
  figure: the plotter could not read an implicit product (5x, 3sin(x)) that Solve itself had read, and dropped
  the figure without a word. The curve now reads the equation as Solve read it; what the plotter always read is
  drawn exactly as before. An ambiguous product (x(x−1): a function x, or x times?) is still no figure.
- **Finance and Bio/Assay list fields follow the product's comma rule**, as Stats has since v2.134.0:
  "1,5 2,3 3,1" is 1.5, 2.3, 3.1 (and the result says so, in the pane and in the document), not six values. Anything in a list that is not a number
  ("5OO" typed with letter O's) is refused by name — it used to vanish from the list, and an NPV or a fit was
  computed on values nobody typed. Every calculator's default reads exactly as before.
- **Stats: a lone value in a decimal-comma field is one number.** In a field typed with decimal commas ("1,5 2,5
  3,5" in one group), a group or table row holding one value — "4,5" — was read as 4 and 5. It is 4.5, as the rest
  of the field decided. A field that proves nothing (every row one comma run, like a table "10,20 / 30,40") is read
  as before.
- **A figure's size is read from its own outer tag.** A figure whose outer tag has no width (only a viewBox) could
  take a line thickness from inside it as its width (stroke-width="1.5" → inserted 1.5 px wide); it now uses its
  viewBox, then the default.
- **Chemistry canvas:** "The page could not be drawn …" and "The edit left the page unreadable … it was undone" stay
  on screen; the pane's status clear wiped them the moment they appeared.

### Changed (no visible change)
- The last pure helpers moved out of the task pane into tested library modules (host-adapter scope §E): figure
  sizes, Solve's plotter, Finance/Assay lists, Analyze and Engineering report text, the Stats comma decision, and
  four single helpers. The Stats readers that keep the comma log stay in the pane (the scope doc says why).

## [2.159.0] — 2026-10-19 — Chemistry canvas: ChemDraw-size inserts, no freeze while drawing, icon toolbar

### Changed
- **Inserts go in at ChemDraw's size by default** — the drawing as drawn, reduced only to fit the page. A new
  **Size** choice beside Insert selected offers **USPTO drawing sheet size** (the v2.156.0 behaviour: enlarged
  until the smallest lettering meets 37 CFR 1.84(p)(3)'s 1/8-inch minimum). The choice is remembered. At
  ChemDraw's size, a drawing whose letters fall under the USPTO minimum is inserted and the status says so,
  naming the other choice. (A user found every structure inserted "so big, hard to use".)
- **The canvas's tools are a compact row of icons** (select, atom, bond, chain, ring, charges, brackets, arrow,
  text, erase, properties, undo/redo, zoom, fit, save) — the worded buttons took three lines of the pane. Each
  icon's name is its tooltip and is read by screen readers. The large canvas window shows the same icons.

### Fixed
- **The canvas no longer freezes while drawing on a large page.** Every click worked out the page's formula and
  SMILES and drew a picture of it that was then thrown away (half a second at 200 atoms, plus 0.3 s for the
  SMILES). The picture is no longer drawn on the Draw path (the canvas's own page is what inserts), and the
  formula, SMILES and checks are worked out once drawing pauses for a quarter-second — always up to date before
  Insert, Insert selected and the large canvas.

## [2.158.0] — 2026-10-19 — Drawing (CAD): import STL parts

### Added
- **Import DXF / STL…** in Drawing (CAD) now reads **STL** parts (binary or text — Solid Edge: Save As → STL) and
  adds each as a **part of the model**: drawn in every view with its hidden lines, its outline where curved
  surfaces turn away, and an edge wherever its facets meet at more than the **edge angle** (30° unless changed).
  An STL carries no units, so none is assumed: Add as a part waits until they are chosen. Units and edge angle stay
  editable under the part, and mates, callouts, exploded and detail views work on it as on any part.
- The drawing **names the file** (its name and a fingerprint of its bytes) and never carries the triangles, so the
  inserted picture's alt text stays small. Re-opened in a later session, the part says which file to import again,
  and only the same bytes are taken back. The pane keeps every file the drawing (or its Undo) names, and forgets
  files only looked at beyond the last two. Importing a file already in the drawing adds a second copy.

### Changed
- STEP and IGES files, and Solid Edge's own .par / .asm / .psm, are still refused — the route given is now
  Save As → STL (it pointed at STEP, which is not imported).

- **Every sheet's hidden lines now have a time limit** (15 s for the whole sheet, all views together; the
  catalogue's heaviest drawing, a plate of 200 holes, takes 3–6 s). Lines that overlap on the page — a gear's or
  a knurl's hundreds of teeth seen side on — split one another into pieces that grow as the square of their
  number, and no count of edges or of tests bounds the time (one test's cost varies 3.5× with the view); a
  sheet past the limit is refused by name ("too many lines crossing one another…") instead of holding Word for
  most of a minute (review: a 1,950-tooth prism within every other limit took 49 s). The live 3D view then
  shows the parts shaded, and says so.

### Limits (refused by name)
- Up to **100,000 facets** and **6,000 drawn edges** a part: measured, a smooth 100,000-facet part takes about
  2 s from file to a four-view sheet. Past either, the refusal says to raise the edge angle or export with a
  coarser tolerance.
- Cavities are kept as cavities: a closed piece inside another faces into the void (counted by ray parity, for
  up to 2,000 closed pieces; past that each faces out, and the notes say so).
- A part whose surface has gaps (not watertight) is drawn alone, but not where another part overlaps it: inside
  and outside are unknown there.
- The large canvas does not yet open a drawing with an imported part (its facets stay in the pane): it says so.
- Not yet checked against a real Solid Edge STL export; the oracle is the engine's own parts written out as STL
  (binary float32 and text, either winding) and drawn again — every view within 1 % of the original.

## [2.157.0] — 2026-10-19 — Atom properties, the whole page in the large canvas, Clean on any page

### Added
- **Properties tool** on the Structure ▸ Draw canvas (and the large canvas): click an atom to set its radical
  (doublet •, singlet or triplet carbene :), its enhanced-stereo group (AND n — racemic, OR n — relative;
  drawn &1 / or1 as ChemDraw does) and its query features (substituents exactly 0–3, up to 1–3 or no more
  than drawn; ring bonds none / 2 / 3 / 4 or more / as drawn; saturated or unsaturated), or a bond to set the
  orders it may be (single / double / triple / aromatic — several make a query bond, marked S/D …) and whether
  it lies in a ring or a chain. Each is written as ChemDraw's own attribute (RingBondCount, SubstituentsExactly,
  SubstituentsUpTo, FreeSites, UnsaturatedBonds, EnhancedStereoType / EnhancedStereoGroupNum, Topology, an Order
  listing several orders — the CDX SDK property reference), so a saved .cdxml opens in ChemDraw with them.
- **Atom lists**: type [N,O] (any one of) or NOT [F,Cl,Br] (any but) with the Atom tool — ChemDraw's element-list
  node.
- ChemDraw files carrying any of these now open with them, and structures inserted from the old editor with an
  AND / OR group, an atom list or a query feature reopen on the canvas with it (v2.156.0 refused them).

### Changed
- **The large canvas takes the whole page**: brackets, arrows, captions and group labels go into it and come back
  exactly as drawn (the page travels as ChemDraw XML — in the window's address when short, by message when not).
  Bringing it back is one edit in the pane: Undo returns to the page as it was. The 3D tab says why a page has no
  3D model (a reaction, a polymer) instead of asking for a molecule.
- **Clean works on any page**: each structure (the selected ones, if any) is laid out again in place — its centre
  kept, at the page's bond length, its stereo kept (wedges drawn again) — while captions, arrows and the other
  structures stay where they are. Group labels stay labels. A structure inside brackets, or one with wedges whose
  stereo cannot be read, is refused by name.

### Fixed
- A drawing with a hashed wedge was written with one attribute twice (stroke-linecap) — malformed SVG, which an
  image load refuses — so inserting it could fail (since the ChemDraw panel, v2.152.0, and on the canvas in
  v2.156.0). Every element the renderer writes is now checked well-formed (cdxmlRenderWellFormed.test.ts).

### Removed
- The old ChemDraw panel (v2.152–v2.155), which had not opened since the one canvas (v2.156.0): its code, markup
  and styles. Open ChemDraw file… and Open ChemDraw picture keep working — they open on the canvas.

### Rules
- A structure with an atom list or a query feature is a query structure: the readout says generic structure,
  never a formula, whatever the Markush box says.
- What ChemDraw has no form for (aromatic / not aromatic, hydrogen-count and charge queries, ring sizes, an
  excluded group, several ring-bond counts at once) is refused by name, never dropped: every structure put on
  the page is read back and must give the same idcode.
- A radical changes a labelled atom's hydrogens (NH₂ made a radical shows NH); the marks are lettering, so the
  USPTO sizing counts them (75 % of the label size).

### Fixed before release (adversarial review of the atom properties: 13 findings, pinned in cdxQuery.test.ts and chemCanvasProps.dom.test.ts)
- A query bond, query feature or stereo group inside an abbreviation, or on an R-group, is refused by name (it was
  read as a plain structure); an atom list keeps its charge, and an isotope or radical on one is refused.
- An OCL atom list on an O or N atom is written (it was falsely refused); an aromatic ring with an atom list reads.
- Values meaning "unspecified" set no query; Radical="None" is no radical; the listing order of a query bond's
  orders no longer changes the structure.
- The Properties panel follows Undo / Redo (it resubmitted undone values); a dative bond keeps its order; a stereo
  group number out of range is said. A connection point keeps its diamond; ChemDraw's per-atom Show settings hide
  or show that atom's marks.

### Fixed before release (review of the large canvas, Clean and the panel removal: 5 findings)
- Clean never changes a structure: each one is read again after it moves and must be what it was (an alkene
  carbon with OMe and OEt kept its E / Z only by luck — labels now lay out as distinct stand-ins); drawn H atoms
  are laid out with their structure (they were refused), placed where they read as drawn; a hashed or hollow plain
  bond keeps its style; a Clean refused part-way leaves the page and what is read exactly as before.
- The large canvas on a Word that cannot message a window: the page travels more compactly in the address
  (a benzene fits), and one plain structure still goes as its structure.

### Fixed before release (review of the Clean fixes: 7 findings)
- Clean turns a label for its new side in place, its drawn hydrogens kept (CH3 ↔ H3C, OH ↔ HO — carbon labels were
  being deleted, unusual H counts recomputed); abbreviations keep their own structure; labels meaning the same group
  (OMe, MeO) lay out as one kind, so a dimethoxy ring cleans at any angle. An atom with two bonds keeps NH as typed.
- The large canvas's compact page keeps a caption's line breaks; on a Word that cannot message a window the window
  asks the pane for the plain structure, and the button stays off until it reopens.

### Fixed before release (review of the label fixes: 2 findings + 3 small)
- Labels lay out as the group they read as on their own side (OMe = MeO, but CN ≠ NC, SCN ≠ NCS), so linkage
  isomers on one alkene carbon keep their E / Z; up to eight drawn H are placed back as drawn again (artemisinin);
  a turned label keeps its colour and other attributes; a near-vertical bond turns no label; a host without window
  messaging asks for the plain structure.

### Fixed before release (review of that round: 1 regression + 3 small)
- Clean matches labels by the converter's own reading (justification, then side), and a label whose reading
  would change without its text being turned keeps its old reading by an explicit justification — no false
  refusals, no page left unreadable; the read-back compares each label's meaning as well as the structure; a
  turned label's alignment follows its justification, and a rewritten group label keeps its colour and style.

### Fixed before release (review: 1 regression + 2)
- After Clean a side-dependent group label (SCN, OMe …) still reads as the group it did with its bonded letter on
  the atom — kept, rewritten for its side, or Clean refuses (a label was left reading across its own bond as the
  other isomer); labels that read the same either side, abbreviations, stacked and centred labels are left as they
  were. Stereo-group and query marks are placed where their box crosses no bond or label.

### Fixed before release (review: 2 false refusals, 2 more)
- Clean writes a group label for its new side by what it means (isothiocyanate SCN ↔ NCS, OMe ↔ MeO); one with
  no form for that side keeps its reading by its justification, refused only where the other reading is another
  group; stacked and unreadable labels keep their reading too. A label only re-aligned keeps its style runs
  (CO₂Me's subscript). Marks are tried nearest first and stay beside their own atom.

### Fixed before release (review: 2 + 1)
- A label that read as no group but would read as another group on its new side (SCN as thiocyanate landing
  where it reads as isothiocyanate) makes Clean refuse, never keep it drawn across its bond; stacked and centred
  labels are left exactly as drawn; a rewritten label keeps its own bold / italic.

### Fixed before release (review: 2 false refusals + 2 small)
- A label stacked above or below its atom is read by the line on the atom (as it is drawn), not the side of its
  bond, so Clean keeps a stacked Me / O methoxy without refusing; a label already drawn across its bond and left on
  the same side is not refused; a rewritten label takes only the style all its parts share.

### Fixed before release (review: 5 small)
- A stacked label's line on the atom counts as an element only if it is one (Me / O is read by its side); a label
  stacks by its alignment only when it has several lines; blank trailing lines are ignored; a label aligned
  above or below is split only where ChemDraw's own box shows it stacked; a rewritten label keeps its font and size.

## [2.156.0] — 2026-10-18 — One chemistry canvas

### Changed
- **The Structure ▸ Draw canvas is JurisLab's own** (it replaces the OpenChemLib editor, in the pane and in
  the large canvas): one page holding structures, polymer brackets, arrows and text, kept as ChemDraw keeps
  them. Everything chemistry-building is on it — atoms with an element palette (C H N O S P F Cl Br I, or any
  label typed: N, Cl, R1, OMe …), bonds (click empty paper for a bond, drag from an atom to grow it, to another
  atom to close a ring or join two structures; click a bond for double / triple; wedge, hashed wedge, wavy,
  bold, dashed), rings, chains, charges, brackets, arrows, captions, select / box-select / move / delete,
  undo / redo, zoom (buttons, Ctrl+wheel, Fit), Save as .cdxml.
- **ChemDraw files and pictures open on this canvas** (Open ChemDraw file…, Open ChemDraw picture) — no separate
  panel. Insert puts the page in as drawn (Insert selected: only what is selected; Replace selected picture:
  in place of the picture clicked in the document). A name ChemDraw computed for a structure you change is
  named on insert, to check.
- Formula, SMILES, Markush / R-groups, Clean, compliance notes, Edit in Draw, Draw a component and the large
  canvas's 3D tab work as before: the page's structures are converted to OpenChemLib's molecule exactly —
  every compound in the 359-compound dictionary round-trips to the same idcode, stereo included — or the
  readout says why there is no single formula (a generic X, a label the file does not define).
- Labels standing for groups (OMe, CO₂H, Ph, Boc, NO₂, CF₃ … 154 forms, leftward ones too) are expanded the way
  ChemDraw's Expand Label does, so a ChemDraw drawing's formula is the one drawn; every group's formula is
  pinned. A hypervalent atom keeps the hydrogens it is drawn with.
- **Inserts meet the USPTO's lettering rule** (37 CFR 1.84(p)(3): letters at least 0.32 cm, 1/8 inch, high): a
  drawing from the canvas goes into Word enlarged until its smallest lettering — subscripts and charge signs,
  which ChemDraw draws at 75 %, included — reaches 13.94 pt (3.2 mm capitals plus a 10 % margin); the status
  says by how much. A drawing larger than the page is reduced to fit only while its letters stay at the
  minimum (one with no letters is fitted as before); one too large for the page at that size is refused by
  name (insert fewer structures with Insert selected, or split it into figures) rather than shrunk below the rule.

Not yet: the large canvas takes structures only (a page with brackets, arrows, text or group labels is edited
in the pane, and it says so); Clean lays out pages of structures only. The canvas has no way yet to set a
radical, an atom list, a query feature or an AND / OR stereo group (the old editor's atom properties); a
structure carrying one is refused by name rather than redrawn without it (all three lifted in v2.157.0).
Isotopes are typed as labels (13C, D, T).

### Fixed before release (adversarial review: 15 findings, pinned in chemCanvasReview.test.ts)
- Second review of the fix round (9 findings + 1 found while checking, pinned in chemCanvasReview2.test.ts):
  H typed on an atom no longer reads HH₃; a 13C label's hydrogens follow new bonds; an abbreviation whose
  connection points all sit on one atom (Cl₂Zr, CrCl₃, VO) takes its bonds there; a typed group reads on
  either side of its bond (MeO right of a bond is written OMe; SCN left of a bond is N-bonded), and a ChemDraw
  label's justification decides which letter bonds; aromatic rings resolve by valence (2-pyridone reads,
  an N⁺ with four bonds is refused, tetrazole with no H drawn is CH₂N₄); a structure with a caption keeps its
  R-group legend and notes; drawn hydrogens stay on their own atom when the page has explicit H atoms
  (OCL reorders them — two USPTO structures read two H short); a hydrogen drawn with several bonds is refused.
- Third review (5 findings, pinned in chemCanvasReview2.test.ts and canvasUspto.dom.test.ts): an abbreviation
  with one connection point takes exactly one bond, and several points on one atom take more bonds than points
  only on a metal (a VO bonded four times at its O is refused); SCN, NC and OCN typed right of a bond are never
  rewritten as their linkage isomers; each aromatic system is resolved on its own (twenty imidazoles read);
  inserts are reduced to fit the page when their letters allow it; lettering is measured as drawn (a formula
  caption's trailing charge at 75 %, a charge drawn as a symbol not counted as text).
- Fourth review (4 findings): an insert reduced below a quarter is refused as too small to read (as before);
  each line of a formula caption is measured as drawn; only d- and f-block metals take more bonds than an
  abbreviation's connection points (Cl₂Ge, Cl₂Sn refused); a lone abbreviation is refused as having no single formula.
- Fifth review (no new defects; 2 small items): a label stacked below or above its atom is measured in the style
  it is drawn in; the too-small refusal rounds its percentage down, so it never names an allowed size.
- Sixth review (1 finding): a stacked label whose first style run is empty is measured in its first run with text.
- ChemDraw's aromatic bonds were counted as single (benzene read C₆H₁₂): they are now resolved into
  alternating single and double bonds, a ring atom that gives a lone pair instead (pyrrole NH, furan O,
  C₅H₅⁻, C₇H₇⁺) kept single; a ring that cannot alternate is refused by name.
- A wavy bond now means the geometry of the double bond it meets is unknown. A Markush structure kept its
  heteroatoms' hydrogens off the page (CCO came back C₂H₅O). Ac, Pr and Ts typed on an atom made actinium,
  praseodymium and tennessine — they are acetyl, propyl and tosyl now ([Ac] for the element). An abbreviation
  with more bonds than connection points piled them onto one (vanadyl's O with four neighbours): bonds go to
  the connection points in ChemDraw's own order, or the structure is refused. Group labels are read by the
  side of the bond they are written on (SCN right of a bond is S-bonded) and written for their side (MeO).
  AND / OR stereo groups and query features are refused, never turned absolute or dropped.
- A valence forced by drawn hydrogens is now said under the canvas; a polymer or a reaction no longer reports
  one combined formula (select one structure for its formula); erasing a bond no longer leaves invisible
  atoms that still counted; elements outside the valence table (As, Al, Te …) show the hydrogens they have;
  R and R1 together are refused (they would merge); D, T and 13C labels; Insert selected with nothing
  selected inserts nothing; the large canvas and its templates refuse a page they cannot carry back (no
  single formula, group labels, brackets, arrows, text) instead of dropping it; ChemDraw's "not shown" notes
  reach the status line; Undo restores the Markush flag; query bond orders and lone group labels are refused.

## [2.155.1] — 2026-10-18 — Drawing (CAD): drawing on the sheet in the large canvas

### Fixed (in-Word report: "not able to insert an arrow or text box", "the self draw is still acting up", "callouts … some missing")
- In the large canvas the drawing tools (Pencil, Line, Arrow, Numeral, Text, Erase) worked only on the small
  sheet at the side; dragging on the big view turned the 3D model and drew nothing. Now a drawing tool (or Add
  detail view) gives the sheet the big area, so it is drawn on at size, with the status line beside it; switching
  the tool off (click it again, or Esc) brings the 3D view back. Marks land where clicked however the sheet is
  fitted (a portrait sheet sits centred in the space); starting a sketch ends drawing on the sheet first.
- A callout placed on a spot no view on the sheet shows (the underside, with only Front and Isometric ticked) was
  left off the sheet with only a note; placing it now says so at once and what to do (turn the 3D view until the
  spot faces you and tick This view, or click a face the ticked views show).
- Update: on a PC, Reload on the "Update available" bar said "could not be downloaded — check your connection"
  although the release was live (the new offline copy never installed, or the browser had already moved on).
  When the release cannot come in through the offline copy but the server answers with it, the stale copy is
  now dropped and the pane loads the release from the server; offline, nothing is dropped. (Only on Reload;
  in the minutes right after a release, before every server has it, the offline copy may need a later session
  to be made again.)

## [2.155.0] — 2026-10-18 — Drawing (CAD): mate faces, exploded views, detail views (the table release)

### Added
- **Mate faces**: click a flat face of the part to move, then the face it goes against — the part turns so the
  faces look at each other and moves so they lie flush, the two clicked points meeting; a click near a face's
  corner or centre snaps to it (corners meet corners). Stays on for the next pair (four legs under a top) until
  Stop or Esc; **Undo mate** takes each back. A curved surface, or two faces of one part, is refused by name.
  Pinned on the table: a top mated onto four legs, corner to corner, is flush with no overlap and no crossing
  line along any joint.
- **Exploded view** (tick Exploded under Views): the parts drawn apart — **Auto explode** lifts them in levels
  (a table's top off its legs), and every part's distance can be set under the part — with phantom trail lines
  showing where each goes (to each leg a top sits on). On a USPTO sheet with another figure the exploded view is
  placed in brackets (37 CFR 1.84(h)(1)). Callouts move with their parts.
- **Detail views**: **Add detail view**, then click a spot on a figure — that part is drawn again 2×, 3×, 4×, 5×
  or 10× larger as a view of its own, its circle drawn on the figure it enlarges. Labelled as each standard asks:
  USPTO a FIG. of its own with the circle marked by that figure (1.84(h)(2)); ASME "DETAIL A SCALE 2:1"; ISO
  "A (2:1)"; letters skip I, O and Q (ASME Y14.3). Details sit below the other views, read after their figure;
  callouts inside the circle show enlarged; marks can be drawn on a detail. Size and enlargement change in the
  list; Remove takes a detail away.

### Fixed before release (adversarial review: 11 findings, pinned in cadTableReview.test.ts, cadAssemblyPane.dom.test.ts)
- A detail's scale could read 1.25:1 or 1:2.5 with a note naming the wrong sheet scale: the sheet now tries each
  standard scale, largest first, with every detail at the standard scale nearest its enlargement, and keeps the
  first that fits — every detail label is a standard scale, every note names the real one.
- An exploded view with nothing apart also said "no parts yet" (or "add a part" with five parts); ticking
  Exploded did not show the explode distances; setting the last distance to 0 exploded the parts again and
  dropped the field being typed in.
- A detail of an orthographic view lost its hidden lines; ASME balloons went into the detail instead of the
  front; a detail's marks stayed after it was removed (and moved when its enlargement changed — marks are now
  kept in the parent view's plane); a stray-mark note showed "detail:A".
- A diagonal move's trail floated off the part; the circle's FIG tag could run off the sheet; a circle larger
  than its figure shrank the sheet to dots and one over empty paper drew nothing — both refused by name; a
  detail of a view not on the sheet is left out (1.84(h)(2)); the USPTO bracket now stands beyond the callout
  column; a face's centre snap stays on the face clicked (a U's two arm tops are two faces).

### Fixed before release (second review — of the first fixes: 6 findings)
- Hand-written text on an ISO / ASME sheet with a detail could make the sheet refuse (the detail-scale search
  told the text fitting a larger scale than it drew); the search now reports the scale it drew, starts one
  standard step higher, and a refusal keeps its real reason.
- Marks on a detail of a small part landed on a coarse grid (rounded in the parent's plane); they are rounded to
  a quarter pixel of the figure as drawn. Removing a detail also takes its marks out of the mark undo history;
  ticking a view no longer refreshes the part editor (only Exploded does).

## [2.154.0] — 2026-10-18 — ChemDraw: chains, polymer brackets, arrows, replace in place

### Added
- **Chain** tool: drag from an atom (or from empty paper) and a zig-zag chain follows the mouse — one bond per
  L·cos 30° of drag (L = the document's bond length), 120° at every carbon including the one it starts from, as
  ChemDraw draws a chain; a click on an atom adds one bond. Refused by name: a carbon with no valence to spare (four
  bonds; three when charged), an abbreviation that has its bond (Ph, OMe), and a chain that would run onto atoms
  already drawn. Add bond follows the same rule now. Other elements are left to the chemist (hypervalent iodine,
  perchlorate chlorine, a nitro N drawn neutral and dative bonds all appear in ChemDraw files).
- **Brackets** tool: drag a box round a repeat unit — polymer brackets written as ChemDraw writes them (checked
  against ChemDraw files filed with USPTO patents): square brackets on the box's sides, the label (the box above;
  blank = n) in italics at the right bracket's foot, held in that bracket, and a structural repeat unit (SRU)
  naming the atoms inside, its label and the bonds each bracket crosses (an end group crosses one). Refused by
  name: no atom inside, atoms of two structures, no bond leaving the box, or a bond leaving through its top or
  bottom (no bracket would cross it). A name ChemDraw computed for the structure is outlined as out of date.
- **Arrow** tool: drag from tail to head — a reaction arrow (full solid head, ChemDraw's default size) or an
  equilibrium arrow (⇌: two shafts, each ending in a half head).
- **Replace selected picture**: click the picture in the document (for instance the ChemDraw picture you opened),
  then Replace selected picture — the edited drawing (the selection, or the whole page when nothing is selected)
  goes in its place, instead of a second copy after it. A floating (wrapped) picture is not in Word's selection of
  in-line pictures: it is said, and nothing changes. The new picture does not carry a ChemDraw drawing as the old
  one did: replacing a picture opened from the document says so until the drawing is saved as .cdxml, and Open
  ChemDraw picture on a picture JurisLab drew says to open the saved .cdxml.
- While dragging, the chain, box or arrow is drawn as a light outline; all three are written into the document
  itself, so Save as .cdxml keeps them.
- ChemDraw files whose bracket labels ("n", "m") are kept in the bracket's object tag now draw the label (it
  was left out before).

### Fixed before release (adversarial review: 10 findings, pinned in cdxmlDraw.test.ts, chemdrawPane.dom.test.ts)
- A chain from an atom met its existing bond at 180° (drawn straight); a chain could land on atoms already drawn
  (stacked, unjoined); a charged carbon skipped the valence check (C⁺ took a fourth bond); an abbreviation with its
  bond (Ph) took a chain; a refused chain from empty paper still left an atom in the document.
- Brackets: a bond leaving through the box's top was attached to a side bracket it never crosses; atoms of a
  second structure in the box joined the repeat unit; the label was a loose caption with a made-up repeat count —
  now ChemDraw's own form; bracketing did not mark the structure's computed name as out of date.
- Escape, a tool change, opening a file or Close in the middle of a drag left it live (the release still drew);
  a release with no click after it swallowed the next click; Atom-tool text became the bracket label.
- The equilibrium arrow's half heads sat between the shafts (pre-existing in the renderer; first written by C4).
- Replacing a picture JurisLab had inserted wrapped it in a second content control each time.

### Fixed before release (second review — of the first fixes: 4 findings)
- The shared valence check refused Add bond on hypervalent and cationic atoms it had always allowed (I, I⁺ even
  with no bonds, Cl=O, a neutral-drawn nitro N, an amine bonded to a metal); it now refuses only what is certain
  (carbon, abbreviations), and a generic ring atom (A, X) takes a substituent again.
- The equilibrium arrow's offset heads reached past the drawing's box (clipped with a thick line or wide spacing).
- A box whose side ran through an atom drew the bracket over it; it is refused by name.

Not yet: ChemDraw objects embedded as OLE objects are not in-line pictures, so Replace cannot reach them.

## [2.153.0] — 2026-10-18 — ChemDraw pictures in documents, .cdx files, ring tools

### Added
- **Open ChemDraw picture**: click a picture pasted from ChemDraw in the document, then Open ChemDraw picture — it
  opens as the drawing it was made from, ready to edit (no separate file). ChemDraw's clipboard picture carries the
  whole drawing as CDX in its EMF / WMF comment records (chunks starting "CDIF"); src/lib/emfCdx.ts joins them,
  whether in EMF+ comments, GDI comments or a metafile inside an EMF+ image. Verified on a real document: all 41
  ChemDraw pictures in it open (ChemDraw 23). Insert puts the edited drawing in; delete the old picture after.
- **Binary ChemDraw files (.cdx)** open in the same panel as .cdxml (known by their first bytes, whatever they are
  called): drawn, picked, edited and inserted the same way; **Save as .cdxml** gives the CDXML ChemDraw itself would
  write for them. The CDX tag, attribute and enum names are generated from Revvity's open-source ChemDraw
  file-format code (BSD 3-Clause; notice in src/lib/cdxTags.ts and THIRD_PARTY_LICENSES.md), so values carry
  ChemDraw's own names and units (points from 1/65536 pt, y then x; angles; bond spacing; 20ths-of-a-point sizes;
  text in each font's code page). Verified on ChemDraw's SDK example (matching its published CDXML) and on 117
  USPTO patent drawings (ChemDraw 7–23), all read and drawn; what is not read is named.
- **Ring tool**: benzene, cyclohexane, cyclopentane, cyclobutane, cyclopropane, cycloheptane — click a bond to fuse
  the ring onto it (on the side away from the structure; a benzene fused onto a benzene's single bond gives a
  correct Kekulé naphthalene), an atom to attach it by a new bond, or empty paper to place it.

### Fixed before release (adversarial review of .cdx and rings: 11 findings, each pinned in cdxReview.test.ts)
- 3D points (arrow ends, oval centres) were read z, y, x as the 2010 SDK pages say; ChemDraw stores them x, y, z
  (Revvity's CDXIO.h), so every arrow in a .cdx was drawn at x = 0.
- The generated types were taken from header comments by their hex, and the header numbers two properties
  "0x0011" — so SupersededBy was read as yes / no and every replaced arrow was drawn twice. Types are now keyed
  by property name; RepeatCount is an 8-byte float, as ChemDraw's reader takes it.
- ChemDraw's UTF-8 text (0x0709) is read and replaces the legacy text ("α-pinene", not "?-pinene").
- A 4-byte charge (charge × 2^24) drew as "16777216+"; bond order 0x8000 (threecenter) read as a negative number;
  "any" order is left out; RotationAngle is written as ChemDraw writes it.
- Text before the first style run was dropped; the Symbol font's Greek and signs (′, ±, →) are read as such;
  UTF-16 fonts decode; control bytes that would make a saved .cdxml unreadable are dropped.
- A damaged structure (a bond to a missing atom) crashed the drawing and left the pane stuck; it now draws, and
  any failure to draw closes the panel with the reason.
- Ring tool: a benzene that could not alternate was silently drawn as a cyclohexane, or put a double bond on a
  saturated N — both refused by name now; a ring already there is refused; a labelled CH3 re-counts (CH2).

### Fixed before release (second review — pictures and the first fixes: 12 findings, pinned in cdxReview.test.ts)
- The Ring tool closed a ring through a substituent sitting where a vertex fell (a carbonyl O, an OMe), drawing an
  over-bonded atom; it now refuses by name. Benzene fused onto an aromatic (1.5) ring bond is drawn aromatic.
- Re-counting a labelled carbon rewrote H3C as CH2 (left-justified, over the bond) and dropped isotope runs
  (13CH3); labels now keep their own form (H first, stacked) and a label with an isotope or radical is left as drawn.
- Flags ChemDraw writes with no data (Closed, Dipole, Transparent …) read "no"; a query "any" bond became single.
- A crafted picture with empty continued records threw; a continued object whose last record has no flag was
  missed; a picture carrying the drawing twice could join the two copies — now one copy is read; more data after
  a drawing's end is named; PDF / PNG / SVG pictures, bad data and over-large selections each get their own reason.
- Plasmid-map values were scaled as coordinates; the success message now says the inserted drawing is a picture
  JurisLab drew (keep the original, or Save as .cdxml, to edit it again).

Not yet: ChemDraw objects embedded as OLE objects (their drawing is in an oleObject part, not the preview picture);
floating (wrapped) pictures may not be in Word's selection. Both need a real sample.

## [2.152.0] — 2026-10-18 — Open and edit ChemDraw files

"Open chemdraw files in jurislab with the ability to be able to edit those files and not have to use chemdraw"
— "cut as many limitations as possible between jurislab and chemdraw". Plan: docs/SCOPE-CHEMDRAW.md.

### Added
- **Open ChemDraw file…** (Structure ▸ Draw): a ChemDraw XML file (.cdxml), read on this machine, drawn as
  ChemDraw draws it — the file's own bond length, line widths and fonts; wedges, hashes, wavy and bold bonds;
  double bonds on ChemDraw's side; labels with formula subscripts (R₁, CH₃, F₃C) and stacked labels (NH); polymer
  brackets with their n / x / 100−n labels; ⊕ / ⊖ charges; arrows (with ChemDraw's arrowheads), captions and
  reaction schemes. What is not drawn is named, by kind.
- **Pick and insert**: a click picks a structure with its brackets, labels, charges and counter-ion (they are
  separate objects in a ChemDraw file); Shift+click adds or removes one. **Insert selected** or **Insert whole
  page** puts it into Word at ChemDraw's size (fitted to the page when wider; refused by name when it would be
  too small to read).
- **Edit**: Select and drag to move; **Atom** (an element — implicit hydrogens shown as ChemDraw shows them, NH,
  OH — or a label: R1, X, Ar …), **Bond** (single → double → triple, or wedge / hashed wedge / wavy / bold /
  dashed; a wedge clicked again turns round), **Add bond**, **+ / −** charge, **Text**, **Erase**, Delete key,
  **Undo / Redo**. A name ChemDraw computed for a structure you change is outlined as out of date, and an insert
  names it.
- **Save as .cdxml**: the page with your edits, as a file ChemDraw opens — everything JurisLab does not edit is
  kept as it was.
- Refused by name: binary .cdx (with how to save as .cdxml), malformed files (with the line), files over 40 MB.

### Fixed before release (adversarial review: 16 findings — 15 fixed, each with a test in cdxmlReview.test.ts / chemdrawPane.dom.test.ts)
- A damaged HashSpacing (0) froze the pane drawing a hashed, hashed-wedge or wavy bond; strokes are now bounded.
- Charges: a charge set with + / − was saved but not drawn, and a ⊕ stayed when the charge went to 0 or its atom
  was erased. A charge with no symbol is now drawn by its atom; a ⊕ / ⊖ follows the charge (removed at 0, or when
  |charge| > 1, where the atom draws "2+"); erasing an atom takes its symbol.
- Hydrogens: a bond-order change left the old count (C–OH made C=O still read "OH"); charged O, S and B, P(V),
  and hydrogen / ionic bonds counted wrongly (O⁺ "O" for OH2, B⁻ "BH2" for BH4, P=O "P" for PH).
- Save dropped a style run of a single space ("Compound 1" saved as "Compound1"); a line break in an attribute was
  saved raw; a reference to a character XML forbids (&#x1;) was accepted and saved invalid.
- Delete / Backspace anywhere on the page (even in another tool) deleted the ChemDraw selection; keys now reach
  the ChemDraw page only when it has focus.
- A caption could be edited only once (its box was dropped); its box now follows its words.
- Slow edits with many brackets (7 s for 5,000); an atom with thousands of bonds; 200,000 runs in one caption threw
  instead of drawing; a bond order drawn as a single line is now named; ids past 2^53 could repeat; SymbolType
  "constructor" printed JavaScript text; a [ or > inside a DOCTYPE's quoted identifier was refused.

Not changed: "Ca2+" in a formula label is drawn Ca₂⁺. Reading the digit as part of the charge would break NH4+
(NH₄⁺), and ChemDraw's own rule has not been checked.

## [2.151.0] — 2026-10-18 — Drawing (CAD): draw on the drawing — pencil, arrows, text, numerals anywhere

From the user's first pass in Word: "the free hand drawing is frustrating to use … what i draw is what i want",
"when i try to add reference numbers, they do not all show up", "i also want the ability to add text",
"also need the ability to add arrows to point to a particular point" — for a patent on a table, "showing all
points of it, how each piece intersects and connects".

### Added
- **Draw on the drawing** — a toolbar above the sheet, in the pane and the large window: **Pencil** (a freehand
  stroke, kept as drawn), **Line**, **Arrow** (drag from the tail to the point it shows), **Numeral** (drag from
  the point it names to where the number goes, or click the point; continues the numbering), **Text** (type it,
  click where it goes), **Erase** (click a mark) and **Undo mark**. No snapping and no profile rules. Each mark
  belongs to the figure it was drawn on, in that view's own plane, so it moves and scales with the figure when the
  sheet is laid out again, and it reopens with the drawing (saved in the model; a damaged one refuses the drawing
  by its number). The sheet leaves room for marks drawn beyond a figure; front, top and side views stay aligned.
- **Blank figure** (Views on the sheet) — a figure with no parts, to draw freehand. With no parts at all the
  sheet holds only blank figures, and the message says so.

### Fixed
- **Callouts that "do not all show up".** Add callout was an on/off switch: pressing it before each numeral turned
  it OFF every other time, so the next click selected a part and no callout was made, with nothing said. It now
  stays on until **Stop placing callouts** or **Esc**, looks on, names each callout it places, and a click off the
  model says so. The canvas now shows each callout's number beside its point, not only a dot.

### Fixed before release (adversarial review: 11 findings — 9 fixed, each with a test in cadMarksReview.test.ts; the rest listed below as open)
- Text was given room from a first guess at the scale, so a long note ran over the next figure or off the
  sheet. Long text now wraps into lines (about 55 mm on a patent sheet), the layout is repeated until the room
  holds, and a mark that still does not fit its figure is refused by name.
- Marks on "This view" pointed at nothing once the model was turned: nothing can be drawn on that view now, and
  a saved one is left out with a note.
- Undo mark carried one drawing's marks into the next (after Open, the large window, Undo clear); its history
  now belongs to one drawing.
- The pane could save a drawing it would refuse to reopen (past 2,000 marks, or with a control character in
  text); both limits are now checked as marks are drawn, and strokes are capped at 100,000 points in all.
- A drag that left the preview shrank the drawing to a dot; the pointer is held on the sheet, and a saved mark
  far outside its figure is left out with a note.
- A callout placed after a drawn numeral reused its number; callouts and drawn numerals share one numbering.
- New drawing kept the hand-drawn marks (and could not clear a drawing of marks alone).
- A sheet of blank figures printed a SCALE for a figure with no model.
- Saved points are rounded to 1/1000 of a unit, so a stroke adds far less to the picture's alt text.
- Found by the figure-layout audit after the review: making room for text by repeating the layout ratcheted an
  engineering sheet down through the standard scales (1:2 → 1:20). The scale is now the largest at which the
  text's room fits, searched directly; notes that would shrink the drawing to under a third of its size are
  refused by name ("shorten the notes, put them on fewer figures, or choose a larger sheet").

Still open: a blank figure beside the isometric view can make a patent sheet with callouts refuse, and the
message blames the callouts; a damaged model that lists a view twice draws its marks on both; a second finger
on a touch screen can leave a stray preview line until the next redraw.

## [2.150.0] — 2026-10-18 — Drawing (CAD): import DXF drawings (Solid Edge, AutoCAD)

The firm uses Solid Edge for most drawings: "we would want the ability to import solid edge and cad files".
Solid Edge's own files cannot be read by anything but Solid Edge, so this release reads what it exports — DXF
(`docs/SCOPE-CAD-IMPORT.md` R3a). STEP and STL parts are next.

### Added
- **Import DXF…** in Home ▸ Drawing (CAD). ASCII DXF from R12 to 2018: Solid Edge (Save As → DXF), AutoCAD,
  and anything else that writes DXF.
  - **A preview first.** Below it: how many items were read, from model or paper space, and what was not drawn,
    by count (hatching, images, 3D solids, layers switched off).
  - **Units.** Taken from the file. A file that does not say has no size until you choose millimetres, inches
    and so on. Millimetres are never assumed.
  - **Insert imported drawing.** The drawing as a picture, at its true size, or fitted to the page when it is
    larger; the status gives the true size. Line types and weights are the file's own, and Ø, ° and ± print
    as such. The picture is not re-editable, and Edit drawing at cursor says so by name.
  - **Edit as a sketch.** Lines, arcs and circles become a new part's sketch, in the large window, for one
    outline or a flat pattern. It is moved to the origin. If the outline does not close, the status says how
    many ends are open and the largest gap. Ellipses and splines are refused by name.
- **Refused by name, with the way round:**
  - Solid Edge parts and drafts (.par, .psm, .asm, .dft): save as STEP or DXF from Solid Edge.
  - DWG: save as DXF.
  - Binary DXF: save as ASCII DXF.
  - STEP and STL parts: not imported yet.
  - Files over 30 MB.

### Verified
- The reader is checked against ezdxf's own reading of each fixture: extents, block arcs (including mirrored
  blocks), OCS mirroring, bulges, units, 200 spline and 64 ellipse samples within 0.02 mm.
- In a real browser: a 190 000-line drawing reads in 0.6 s, and is previewed and inserted in under 1 s.
- Not yet tried on a real Solid Edge export. Sample files have been requested.

### Fixed (found in the browser before release)
- A note set below its insertion point (a two-line MTEXT) was cut off at the picture's bottom edge. The picture
  now grows to hold every text.

### Fixed before release (independent review: 11 defects, each pinned by a test)
- **Small files that could freeze Word.** Three such files now return at once:
  - an ellipse or arc angle of 1e20;
  - arrays of blocks inside arrays (now under a work budget);
  - a spline with tens of thousands of fit points (now under a points budget, and the flattening tolerance
    reads every point).
- **Unreadable or degenerate numbers.** These are skipped and counted, never drawn as NaN or moved to 0:
  - comma decimals, a vertex missing its y, 1e400, a repeated vertex with a bulge, an ellipse with no axis;
  - a zero or negative size.
- **A 0°–360° arc** is a whole circle; before, it was not drawn at all.
- **In a sketch**, a tiny arc never becomes a full circle when its ends merge.
- **Aligned and Fit text** runs between its two points.
- **MTEXT wraps to its box width.** One long note no longer shrinks the whole drawing.
- **Control characters in a note** no longer make the picture invalid.
- **During an import insert**, Close and Import are locked, and the status names the file inserted.
- **Edit as a sketch** keeps its refusal when the large window is already open.
- **An imported sketch** is checked field by field before it opens.

## [2.149.0] — 2026-10-18 — Drawing (CAD): draw like Solid Edge; drawing sheets, title blocks, line types

This follows a user test of v2.148.0: "it's not user intuitive. if i want to draw a box, it's very challenging.
then the canvas for drawing is small. we use solid edge for most drawings." The sketcher was reworked around
that box, and the drawing sheet gained real formats (`docs/SCOPE-CAD-R2.md` R2b).

### Changed — the sketcher, the Solid Edge way
- **A box in five actions.** Rectangle (**R**), type the width, **Tab**, the height, click. The rectangle is
  exact, and both sizes become its driving dimensions, in one undo step. A line takes its length and angle the
  same way, and a circle its diameter. Start typing a number and it goes straight into the size box.
- **Room to draw.** A sketch opens in a large window (90 % of the screen), and **Done** brings the part back.
  Where Word cannot open that window, the sketch opens in the pane, on a much taller canvas.
- **Grid snap**, on by default. The spacing is a round number of mm that follows the zoom, and is shown.
  **Inference:** the cursor locks onto corners and line midpoints, with green guides when it lines up with
  points already drawn. A live readout shows the size under the cursor.
- **Smart Dimension (D).**
  - Click an edge, type the value, **Enter**.
  - An edge that already has a dimension is edited, not given a second, conflicting one.
  - Two parallel edges give the distance between them; two lines at an angle give the angle.
- **Solid Edge keys:** S, L, R, C, A, P, T and D pick tools; **Esc** twice returns to Select; right-click ends a
  line chain; **Ctrl+Z** undoes; the wheel zooms; middle-drag or Space + drag pans; **F** fits; **G** toggles the
  grid snap.
- **A ribbon:** Draw, Dimension, Modify and View, with the relations folded away and a prompt line saying what
  to click next. **Done**, **Cancel** and Extrude / Revolve are at the top, and the value box sits above the
  canvas.

### Added — drawing sheets (validated against ISO 5457, ISO 7200 and ISO 128-20 in their own text)
- **ISO sheets A4 to A0** (ISO 5457):
  - A0–A3 landscape, A4 portrait only;
  - a 20 mm filing margin and 10 mm borders, with a 0.7 mm frame;
  - grid references every 50 mm from the centre lines, with numbers along the top and bottom, letters down the
    sides, and no I or O;
  - centring marks, and the size designation bottom right.
- **The ISO 7200 title block:** 180 mm wide, holding each field's recommended length in capitals. Empty
  required fields are named, never filled in for you. The scale and the projection symbol sit outside the block,
  as ISO 7200 says.
- **ANSI sheets A to E:**
  - A can be vertical;
  - margins from the Y14.1 formats in DOD-STD-100D;
  - zones with A1 at the lower right;
  - a title block with SCALE filled in.

  The ASME layout dimensions are marked as product choices.
- **Patent drawings stay unframed:** 37 CFR 1.84(g) forbids frames around the sight, and the pane says so.
- **Line types as style objects:**
  - ISO 128-20 types 01, 02, 04 and 05, with their exact element lengths (dash 12d, gap 3d, long dash 24d,
    dot ≤ 0.5d) and butt caps;
  - each listed with its designation, width and pattern.
- **Layers:** frame, title block, callouts and view titles. A layer switched off is left out of the inserted
  picture, and takes no room on the sheet.
- **Save sheet (SVG, true size):** the sheet at its real printed size.

### Changed — how engineering drawings go into Word
- An ISO or ASME drawing is now inserted **fitted to the page width** (159 × 229 mm, which fits Letter and A4
  with 1-inch margins). The status and alt text say what the stated scale then means, e.g. "The A3 sheet is
  inserted at 38 % to fit the page; SCALE 1:2 holds when it is printed on A3".
- Unframed ASME drawings used to go in 254 mm wide, wider than any portrait page; they are fitted too.
- Patent, journal and plain figures go in as before.
- The PowerPoint export keeps big sheets under 4000 px.

### Fixed (found by four independent review rounds and by driving the sketcher in a real browser)
- Found in the browser, invisible to the automated tests:
  - **Done** was below the fold;
  - the prompt was unreadable on the dark theme;
  - a click moved the typing focus away from the value box;
  - Smart Dimension refused to change an existing size.
- Select and Trim act exactly where you click; the grid snap never moves them.
- A typed size is kept exactly: not rounded, never overridden by an automatic horizontal or vertical, and
  bounded to ±1 000 000 mm. A size that cannot be applied refuses the whole shape, by name.
- Panning never gets stuck, and **Enter** after the pointer leaves the canvas aims where it last was.
- If the large window cannot open, the sketch opens in the pane. Closing that window without **Done** says the
  sketch was not kept.
- Sheet formats:
  - a damaged or hostile sheet in a saved drawing is refused by name;
  - text with control characters is refused;
  - title fields from one drawing never come back in another;
  - centring marks stay clear of the title block and the symbol.

### Honest limits
- A title block field filled to its length with the widest letters (W, M, @) can exceed its cell; it is refused
  by name, never drawn over the line.
- ASME zone counts and the A-size margins come from secondary sources, and the title block layout is a product
  choice; ASME Y14.1 itself was not read.
- Hatching, and dimensions on the drawing views, come in R2c.

## [2.148.0] — 2026-10-17 — Drawing (CAD): sketch your own parts, New drawing, export to PowerPoint

From `docs/SCOPE-CAD-R2.md` (R2a). Before this release a part could only come from the preset catalogue. Now you
can **draw your own**: choose **Sketch (draw your own)**, draw with a full set of 2D drafting tools, give it
relations and dimensions as you would in Solid Edge 2D, then extrude or revolve it into a solid that drops into
the same drawing sheet as every other part.

### Added
- **A constraint sketcher.** Drawing tools: line, rectangle, centre rectangle, polygon (3–64 sides), slot,
  circle, centre-point arc, 3-point arc, point, construction geometry. Modify tools: trim, fillet, chamfer,
  offset, mirror, linear and circular patterns. Relations: horizontal, vertical, coincident, parallel,
  perpendicular, tangent, concentric, equal, midpoint, symmetric, point-on-curve, fix. Dimensions: length,
  distance, angle, radius and diameter, typed as a drafter writes them (`50`, `Ø20`, `R5`, `45°`, `2,5`). What a
  dimension shows parses back to the same value. Driven (reference) dimensions measure without constraining.
- **An honest solver.** The status line says how many degrees of freedom are left, and free geometry is drawn
  blue while fully defined geometry is drawn black. A relation that conflicts with the others is refused by name
  ("… conflicts with the sketch's other relations"). A redundant one is refused too. A change that would flip
  the shape inside out or make edges cross is refused rather than drawn. A big dimension change is reached in
  small steps, so the shape keeps its form. Points drag live.
- **Sketch → solid.** **Done** extrudes the closed outline to a depth, or revolves it about a construction line.
  Holes nested inside the outline are kept. An open outline is refused with the place it is open. **Edit
  sketch** re-opens a sketched part on its own sketch, and the sketch travels in the inserted picture's alt text.
- **New drawing.** Clears every part and callout. It asks first (a second click confirms) and offers **Undo
  clear** until the drawing changes again.
- **Export to PowerPoint.** Saves the current sheet as a slide: a high-resolution picture with the drawing's title.

### Fixed (found by four independent review rounds before release)
- Clicking a point in Select now selects it; only a real drag moves it. A drag ends exactly where the pointer
  is let go, and one Undo takes it back; a click, or a press that wanders back, leaves no undo step. Undo during
  a drag ends the drag. All four corners of a rectangle fillet.
- Clicking a dimension's label puts its value in the box as shown (`45°`, not `0.7854`).
- A fillet or chamfer no longer changes what the corner's other relations mean: a width still measures the full
  width to the virtual sharp, an equal still means the full sides, a midpoint stays at the middle of the full edge.
- Trim drops the relations that depended on the line's full length, and says which. A line trimmed through the
  middle stays one straight line in two pieces.
- An inward offset larger than the outline is refused ("an offset of −6 is larger than this outline allows")
  rather than drawn reversed. Offset circles and arcs keep their distance when the original changes size.
- Mirror no longer duplicates geometry that is its own image. A tool may draw across a line that is
  already there, as the line tool may (a trimmed piece, a mirrored diagonal, a polygon over a centre line); only
  a crossing the solver would create by moving geometry is refused. An inward offset that would make the outline cross itself is refused in plain words.
- Circular pattern takes its angle as shown: `180°`, `180 °`, `180º` or `180deg`.
- The polygon, slot, centre rectangle and 3-point arc tools snap to existing points on every click, so outlines
  really close.
- While a sketch is open, Insert, Add, New drawing, Remove, PowerPoint, **Edit drawing at cursor**, **Open
  large canvas** and **Use this drawing** wait, each refused by name. No sketch opens while the large canvas is
  out. Done always replaces the part being edited.
- Hover and drag stay responsive on large sketches.

### Honest limits
- There is no Extend tool yet. Trimming a circle or arc, and offsetting an outline that contains arcs, are
  refused by name ("trimming circles and arcs comes later"; "offset one curve at a time, or a closed outline
  made of lines").
- Word does not document a size limit for a picture's alt text. A very large sketch is untested against it;
  `TEST-SCRIPT.md` §0cl has a probe step.
- A sketch holds at most 150 points.

## [2.147.0] — 2026-10-17 — Drawing (CAD): build parts in 3D, insert engineering and patent drawing sheets

From `docs/SCOPE-CAD-CANVAS.md` (hit-list item 15, R1b). A new tool, **Drawing (CAD)**, under Home ▸ Drawing.
Build a part from a catalogue (block, cylinder, tube, cone, sphere, plate with holes, L-bracket, stepped shaft,
flange), set its dimensions as a drafter writes them (diameters, not radii), place several parts, and orbit them
in 3D like the molecule view. Below the canvas is the sheet that inserts: up to four views at one scale, arranged
for the chosen standard, with hidden lines, view titles and callouts.

### Added
- **Five drawing standards**, with values validated against sources (`docs/DRAFTING-STANDARDS-REFERENCE.md`):
  **ASME** (the default: third-angle, 0.6 / 0.3 mm lines, 3 mm text, 6 mm view titles, ISO 5455 scale stated on
  the sheet), **ISO** (first-angle, 0.5 / 0.25 mm, 2.5 / 3.5 mm text), **USPTO** (37 CFR 1.84: FIG. labels in
  reading order, numerals on lead lines continuing the document's Numerals table, no scale shown, the 170 × 244 mm
  sight), **Journal** and **Plain line art**. The ASME and ISO sheets carry the projection symbol.
- **An exact hidden-line engine.** Silhouettes of curved surfaces come from the surface normals, not the facets,
  so a cylinder draws two clean outlines at any precision. Visible lines take precedence over hidden ones (ISO 128
  / ASME Y14.2). Parts that overlap are drawn as separate parts passing through each other: the curve where their
  surfaces meet is drawn, nothing of one shows through the other, and the pane names the parts. Parts that only
  touch are not overlapping.
- **The large canvas.** "Open large canvas ⤢" pops the drawing out into its own window: controls, a large 3D view
  and the sheet side by side. **Use this drawing** brings the edit back to the pane; **Insert drawing** inserts it.
  It is the pane's own editor, so every rule is the same. A model too long for a dialog URL is handed over after
  the window opens; a host that cannot do that is told so, and the window never opens blank.
- **Shading that respects depth.** The 3D view shades through a per-pixel depth buffer, so a pin passing into a
  plate stops at its surface. While you drag, a large window shades at reduced resolution and sharpens when you
  let go.
- **Callouts anchored to the part.** Click a surface to place a balloon (ASME / ISO: once per sheet, in the view
  that shows it best) or a reference numeral (USPTO: in every figure that shows it). A callout follows its part
  when the part moves, goes with it when the part is deleted, and is not drawn, with a note, when a resize leaves
  it off the part.
- **Edit drawing at cursor.** The model travels in the inserted picture's alt text, so a drawing re-opens with its
  parts, callouts, standard, views and hidden-line choice.
- **Refusals by name.** Impossible dimensions ("the bolt holes break through the outside edge"), a model over the
  triangle bound, overlaps too detailed to resolve within the work bound, and sheets that cannot hold their callouts
  are refused in words, never drawn wrong.

### What the independent reviews changed
- Pointed cones: the outlines stopped short of the tip. A sharp apex now has its own vertices for each meridian.
- The projection symbols were mirrored. Both now draw the same frustum, narrow end left, with the circles left
  (third angle) or right (first angle); an orientation test pins it.
- Overlapping parts drew lines through solid material (see Added). Then the second review found parts that only
  touch (a pin exactly in its bore, a roller on a plate, a cone on its tip) called overlapping, and a clearance pin
  poking through a coarsely faceted hole; the next two fixes then hid real crossings (a sphere through a plate drawn
  in dashes, a boss sunk into a base lost). Six review rounds later, overlap is decided by its definition: **a
  point inside both solids** (exact ray casting on the closed meshes), probed next to each candidate crossing past
  the facets' own error. Walls that curve alike (a pin and its bore) are compared by the offset their normals
  imply, and a sliver along a hole's rim by that rim's own chord error. Arcs are faceted relative to their own
  radius. Overlaps bounded only by coincident faces (a block placed twice, cylinders stacked into each other), and
  a part sitting wholly inside another, draw no crossing line but are still named. **Resolution, stated plainly:** an interference smaller than the facets'
  error (about 0.5 % of a radius at the default precision), or a part thinner than the facet error of a part it
  crosses, is not drawn in full; anything larger is found and drawn in full.
- Insert could be re-enabled while a dimension was invalid, a second Insert could start during the first, and an
  edit during an insert re-enabled Insert on the previous sheet. Insert now inserts only the sheet of the model as
  it stands, with that model in the alt text.
- Balloons ran off the sheet and into view titles; long titles overlapped on slender parts; nine balloons
  collapsed the sheet to 1:100. Rows now hold their callout stacks and columns their titles, a view uses both sides
  for a long stack, and the scale is the largest that fits, found by bisection.
- A callout's "still on its part" check used a blanket tolerance: removing an unrelated part could orphan it, and
  halving a small pin left its leader in the air. It now uses the facets' actual error. A callout point exactly
  behind a face's edge counted as visible.
- Typing a dimension rebuilt the model on every keystroke, and a 200-hole plate took about a second to
  triangulate. Rebuilds wait for a pause, and the triangulation is about 4× faster, with its area pinned exactly.
- Saved drawings naming a shape such as "toString", with duplicate part ids, or with a view that is not a
  rotation were accepted.
- **Found by the second review, already in the engine:** a bullet nose seen from above drew its outline circle
  hidden. An exactly edge-on wall now puts its outline where the front-facing surface ends.

### Changed — internal
- A fourth add-in page, `caddialog.html`, is built, precached for offline use and opened by the offline gate.
- The host's dialog handle can send to the page (`messageChild`, DialogApi 1.2, asked only when used).
- The host-trace golden was re-recorded deliberately: the new tool adds traced pane sites (the drawing insert,
  reading the selected picture's alt text, and the large canvas round trip). The normalised diff is only those.

## [2.146.0] — 2026-10-17 — Host adapter, part 3: the task pane holds no document code (no visible change)

From `docs/SCOPE-HOST-ADAPTER.md`, completing hit-list item 13. The last ten
document batches move to `src/host/wordDocument.ts`: both Tables of Authorities,
the Table of Contents, the TA/TOC/TOA field clean-up, Id. and supra detection,
paragraph numbering, and Insert citation with Update numbering & bibliography.
The document settings, the three pop-out dialogs and the WordApi check move to
`src/host/officeHost.ts`. **Nothing a user sees or inserts changes.** Every
message is worded exactly as before, and the host-trace gate proves the
document calls are identical.

### Changed — internal
- **The pane has no Word.run left** (52 at v2.143.0), and no Word API at all.
  `Office` appears only as the boot handshake. `hostLayer.test.ts` now enforces
  this as a wall rather than a count.
- **The field-based TOA build and the bibliography renumbering moved verbatim.**
  Each is still one batch and one Ctrl+Z, with its library decisions running
  between the reads and the writes as before. The host returns a report and the
  pane words it.
- **Form values read mid-batch are still read mid-batch.** The Id. pin and the
  citation locator are read through callbacks the host calls inside its batch,
  exactly where the old code read them.
- **The trace covers Office calls too:** settings, dialogs and capability
  probes record their own stacks, so every pane call into the host is a measured
  site, 90 of 90. A new seed imports a real Crossref BibTeX export, so Insert
  citation's marker, renumbering pass and settings save are traced. The golden
  was re-recorded from released v2.145.0.
- **The import-graph and unused-export gates follow `src/host`.** A library
  module reached only through the host (`toaScope`) would otherwise read as dead.
- **What the independent review changed:**
  - Insert citation's "style changed" flag is now also read inside the batch,
    where the renumbering starts.
  - The end-state wall strips comments with TypeScript itself. A string
    containing `/*` fooled the regex stripper into deleting real code.
  - The mock document now holds a citation marker and a bibliography block, so
    marker rewriting and the bibliography replace are traced as well.

## [2.145.0] — 2026-10-17 — Host adapter, part 2: pictures and figures (no visible change)

From `docs/SCOPE-HOST-ADAPTER.md`. Every picture and figure insert now goes
through `src/host/wordFigures.ts`: structures, 3D models, reactions, peptides,
spectra, sequence maps, the substituent gallery, Engineering/Analyze reports,
editable tables, and the one figure path with its vector and PNG routes. The
task pane goes from 29 `Word.run` batches to 10. **Nothing a user sees or
inserts changes.** The host-trace gate proves it call by call.

### Changed — internal
- **19 more batches moved.** Sizes reach the host in points, as computed by the
  pane, so the rasterise-then-pin pairing is unchanged.
- **Figure tails are now plain data.** The figure path's `after` hook, which ran
  Word code inside the batch, became a declarative tail: a caption line, or
  Table → Chart's editable data table. The data table's rows are still read
  inside the batch, after the picture lands, exactly when they were read before.
- **The report insert is split into plan and play.** `insertResultBlocks` builds
  a layout; the host plays it in ONE batch and returns Word's own count of the
  pictures it kept. The anchor rules (.end after a picture paragraph, .after
  after text) and the no-sync-in-the-loop rule are unchanged and still pinned
  by their tests, which now read the host file.
- **More branches traced.** The drive now runs the vector route's success path,
  Table → Chart with its data table, a labelled editable table, and a report
  containing equations. The golden was re-recorded from the released v2.144.0
  code, and this release diffs clean against it. 65 of 65 sites are reached.
- **The unused-export gate reads `src/host`.** Code that moved there would
  otherwise read as dead.

## [2.144.0] — 2026-10-17 — Host adapter, part 1 (no visible change)

From `docs/SCOPE-HOST-ADAPTER.md`, hit-list item 13. Every read and write of the
document is moving out of the 34,000-line task-pane file into one `Host`
interface (`src/host`), so the code that puts results into Word can be tested,
and a second host or a workspace has one seam to build on. **Nothing a user sees
or inserts changes.** This release is a pure move, and the new gate below proves
that call by call.

### Added — the host-trace gate (QC gate 8c; 17 gates)
- `scripts/host-trace.js` drives every Word-facing button in every tool through the
  real production bundle, against a recording Word/Office mock. The mock document
  is populated: brief text with authorities, captions, numerals, TA/TOA fields, a
  table under the cursor, and a dialog that returns a 3D model. The gate records
  every call, argument, property set, sync and batch boundary, and diffs the
  result with a golden trace.
- **Coverage is per caller.** Each batch's stack is mapped back through the source
  map. 52 of 52 document sites were reached before the move; 58 of 58 after it,
  counting both the host batches and every pane call into them.
- **Proved before it was trusted.** Three runs under parallel load were
  byte-identical. A negative control was caught at the exact line. The golden
  was recorded from the untouched v2.143.0 code in a separate worktree.

### Changed — internal
- **23 of the 52 document batches moved to `src/host`:** every insert at the
  selection, and every whole-document read. The ratchet in `hostLayer.test.ts`
  takes `Word.run` in the pane from 52 to 29 and may only go down. The batches
  are unchanged: the same calls, in the same order, at the same insert
  locations, with the same caret placement, the same `formula-inserter:*` tags
  and the same one-batch-one-undo boundaries.
- **The finance formatters and figures** moved to `lib/financeFigures.ts`, and
  **the assay formatters and proportional-law figure** to `lib/assayFormat.ts`.
  Both are now tested by calling them, not by reading the pane's source text.
- **The audit harnesses** derive their Word-enum stubs from the pane AND the host
  layer (`scripts/host-sources.js`). A stub missing an enum that lives only in
  `src/host` would have read as "every tool broken".

### Found, not changed (a pure-move release changes no behaviour)
- Finance and Bio/Assay number lists split on commas, so "1,5" reads as two
  values, not the product's decimal comma.
- `readSvgDims` would match a `stroke-width` attribute if a root `<svg>` carried
  no width of its own.
- Solve on a quadratic such as `x^2 - 4 = 0` inserts no curve, although that
  branch's comment says equations draw one.

## [2.143.0] — 2026-10-15 — Journal-grade figures

From `docs/SCOPE-JOURNAL-FIGURES-2026-10.md`. Figures from Plot, Table → Chart,
Stats, Finance and Bio/Assay can now be inserted at a journal's own column
width and text size, carry significance brackets taken from the test that was
run, and be combined into lettered panels. **As drawn** (the default) inserts
exactly what it did before.

### Added — figure styles
- A **Figure style** picker: As drawn, Nature, Elsevier, ACS, Cell, thesis and
  **USPTO**, with single, 1.5 and double column widths. Under a style the
  figure is re-drawn and rasterised at its printed size, and checked against
  the style's minimum text size; a figure that cannot meet it is refused with
  the rule it fails, never shrunk past it.
- **USPTO** is its own style, not a journal style with the colour removed:
  black only, hatch fills, no title in the artwork, and text that clears
  37 CFR 1.84(p)(3)'s 0.32 cm minimum by at least 10 % (3.52 mm; 14 pt ticks).
  Titles are tagged in every chart and stripped in the library, so a panel
  captured earlier with a title cannot carry it into a USPTO insert.
- Journal styles use the colour-blind-safe **Okabe–Ito** palette.
- The status line states the dpi actually achieved, read from the inserted
  PNG, not the dpi asked for.
- **Insert as vector SVG (experimental)**, off by default. Capability unknown
  means PNG. A vector picture Word reports as inserted but that cannot be
  found again is refused rather than doubled with a PNG. Stays experimental
  until the in-Word probe (TEST-SCRIPT §0cj) is recorded.

### Added — significance brackets and panels
- Brackets on box plots from the **t-test, paired t-test, Mann–Whitney,
  Wilcoxon, Tukey HSD and Dunn** results — only from an engine result, never a
  typed asterisk. Each result is re-checked against itself (Tukey: p against
  the studentized range, the significant flag, q-critical and the interval),
  and an edited one is refused.
- Brackets follow the **α the test was run at**: at α = 0.01 a pair with
  p = 0.038 is “ns”, as the result text says. The legend states α, the test
  and the correction whenever there is more than one comparison. **Hide ns**
  is an explicit option, and hidden pairs are counted in the caption.
- Zero within-group variance is refused by name instead of drawing `****`.
- When brackets do not fit, only remedies that were actually tried and fit
  are offered (Taller figure, Hide ns, or both).
- **Panels:** add figures to a tray and insert them as one lettered A/B/C
  figure; each panel is clipped to its own cell and re-drawn for it under a
  style.

### Changed — one axis and tick engine for every chart
- `axis.ts` replaces the per-chart tick code. Labels obey the display
  contract everywhere: a true minus, `4.00×10⁻⁶` never `4.00e-6`, no duplicate
  or mixed-decimal labels in a row. Narrow spans at large values get distinct
  labels (4.5×10¹⁴ Hz + 500 Hz no longer collapses to one tick); constant data
  at ±1.8×10³⁰⁸ no longer hangs.
- Heat-map colour bars state the true minimum and maximum (1 … 1×10⁶, not
  0×10⁶ … 1×10⁶).
- Number lists and imported cells read `2×10³`, `2x10^3`, `10³` and `10⁻³`, so
  what an axis prints parses back. Refused instead of misread: `1×10⁻⁹⁹⁹` and
  `1e-400` (a non-zero number that would become 0), `2×10³×10²`, and `0x…`,
  `0b…`, `0o…`. `1,5` is still 1.5.
- Geometry coordinates and the radius-of-convergence interval print a true
  minus, and geometry input accepts one.

### QC
- New gate **Figure labels** (`npm run check:labels`, 16 gates): hyphen-minus
  before a digit, e-notation, duplicate and mixed-decimal labels, and text
  below a style's minimum. Self-tested on a known-bad figure; every count is
  at zero, and allowances name the exact labels they cover.
- Figure corpus 259 → 280 (styles, brackets, panels).
- Two independent adversarial passes over the diff: 11 defects found and
  fixed before release, including brackets ignoring α, a USPTO title reaching
  the artwork through panels, false refusals of genuine Tukey results on
  large-offset data, and an axis hang near the top of the double range.

## [2.142.0] — 2026-10-15 — Citation styles, BibTeX/RIS import and numbered bibliographies

From `docs/SCOPE-CITATIONS-2026-10.md` §C. Citations gains a **Bibliography**
panel below the Bluebook form, for grad students writing papers and theses
and for attorneys citing non-patent literature. Import references, pick a
style, insert citations at the cursor, and press **Update numbering &
bibliography** after any add, move or delete. Nothing is looked up online.

### Added — seven reference styles, each from its own manual
- **IEEE, ACS, Nature, Vancouver (NLM), APA 7, Chicago author-date and
  Chicago notes-bibliography** (CMOS 18; the notes go into Word footnotes).
  Each style is written by hand from its manual, and it claims an item type
  only when at least three verbatim examples from that manual are pinned in
  `bibStyles.oracle.test.ts`. Nature formats journal articles only.
  Vancouver (NLM) is the only style that formats patents. Any other type is
  refused by name, never formatted in another style:
  `“epsilon” is a book; Nature does not format books here …`.
- **Harvard and MLA are not offered.** The pane says: “Harvard (Cite Them
  Right) and MLA 9 are not offered: no official guide could be verified.”
- The Crossref export of Kwon (2022), cited at page 1842, prints end to end
  as (`bibPaneRouting.test.ts`):
  - IEEE: `[1, p. 1842]` and `H. Kwon, “Inclusion Work: Children of
    Immigrants Claiming Membership in Everyday Life,” American Journal of
    Sociology, vol. 127, no. 6, pp. 1818–1859, May 2022, doi:
    10.1086/720277.`
  - APA 7: `(Kwon, 2022, p. 1842)` and `Kwon, H. (2022). Inclusion work:
    Children of immigrants claiming membership in everyday life. American
    Journal of Sociology, 127(6), 1818–1859.
    https://doi.org/10.1086/720277`
  - Chicago author-date: `(Kwon 2022, 1842)` and `Kwon, Hyeyoung. 2022.
    “Inclusion Work: Children of Immigrants Claiming Membership in Everyday
    Life.” American Journal of Sociology 127 (6): 1818–59.
    https://doi.org/10.1086/720277.`
- **APA disambiguation.** Two different authors who share a surname are told
  apart by their initials, never by 2020a/2020b; year letters are only for
  the same authors in the same year. Undated works by one author are
  lettered n.d.-a, n.d.-b.
- Titles keep formulas through sentence case: `Splitting Of H₂O And CO₂`
  keeps H₂O and CO₂ in every style, from Unicode or `<sub>` input.

### Added — import, offline
- **BibTeX:** LaTeX accents to Unicode; `$H_2O$`, `H$_2$O` and
  `H\textsubscript{2}O` → H₂O; braces protect `{DNA}`, `{pH}` and `{NMR}`
  from case conversion; `crossref` inheritance; `@string` macros with `#`
  concatenation. A refusal names its line, and the other entries still
  import.
- **RIS** (Zotero, EndNote, Scopus), **CSL-JSON**, and **pasted DOIs**.
- **Merging never overwrites.** The pane reports `Added (4): alpha, gamma,
  delta, epsilon`, skips an identical record by name, and renames a
  different record that reuses a key: `Renamed, because a different
  reference already uses the key (1): gamma → gamma-2`.
- **A DOI is recognised, never looked up.** `DOI 10.1086/720277 →
  https://doi.org/10.1086/720277`, with the line “JurisLab works offline, so
  it can't look a DOI up. Paste the reference's BibTeX or RIS from the
  publisher page to fill everything.” No metadata is fetched.
- A PubMed .nbib file is refused by name: “This is a PubMed MEDLINE (.nbib)
  file — not supported yet; export RIS from PubMed instead.”

### Added — numbered citations that renumber themselves
- **Insert citation** places a tagged citation at the cursor, or adds the
  reference to the citation the cursor is in. In Chicago notes style it
  creates a footnote, and a repeat cite takes the short form.
- **Update numbering & bibliography** reads every citation in document
  order and rewrites the numbers and the reference list in one pass. Move the
  third IEEE citation first and `[3]`, `[1]`, `[2]` become `[1]`, `[2]`,
  `[3]`, with the list in the new order. A second Update changes nothing.
- **Problems are listed by name:** missing references, copied citations,
  uncited library entries and deleted citations. A citation whose record
  was deleted is shown as `[?]`, “so its old number cannot point at another
  reference”, never left with a number that now belongs to another
  reference.
- The library is saved inside the document.

### Independent adversarial pass (all closed)
A reviewer wrote tests against real exports (Crossref, Scopus, Web of
Science, Google Scholar, arXiv, PubMed) in `bib.review.test.ts`. Fixed
before release:
- IEEE printed the DOI twice when a Crossref or Mendeley export carried
  `url = http://dx.doi.org/…`, and printed a Scopus index page as the
  article's `[Online]` location. Neither happens now.
- A Scopus `art_number` was dropped, leaving an article with no locator.
  APA now prints `142(3), Article e123.` and IEEE `Art. no. e123`.
- The journal abbreviation supplied by Web of Science (Journal-ISO) and
  Scopus (abbrev_source_title) was ignored. `J. Am. Chem. Soc.` is used now.
- Sentence case turned “Vitamin A” into “Vitamin a”. Now `Vitamin A
  deficiency in children`.
- The Chicago short note leaked `&amp` and cut the title at its semicolon.
  It now reads `Lee, “Chemistry & Biology,” 12.`. A short note with no page
  ends `Kwon, “Inclusion Work.”`, never with a second period.
- APA year letters on two different Smiths, undated works left identical,
  and a deleted record's citation keeping a colliding number (all above).

### What the tests prove, and what they do not
The automated tests pin every style string against its manual, the import
parsers, the update plan (what each citation and the bibliography become)
and its idempotence. They cannot run Word. Word's 64-character limit on a
content-control tag (JurisLab's tags are far shorter and refuse by name past
64), the roughly 1.9 MB document-settings budget for the library, how many
Undo presses revert one Update, and footnote insertion for Chicago notes are
UNVERIFIED in Word and are checked by the in-Word pass in
`docs/TEST-SCRIPT.md` §0ci. The ACS `(1)` and Nature `1.` list labels are
conventional forms, not pinned by a quoted manual example.

## [2.141.0] — 2026-10-14 — Table of Authorities and Bluebook fixes

From `docs/SCOPE-CITATIONS-2026-10.md` §B (every row pinned with its exact
input bytes, curly apostrophes included, in `legalCiteFixes.test.ts`; the
pane's wiring in `toaPaneRouting.test.ts`). For patent briefs, the defects
were in what a filed Table of Authorities and a filed citation said.
LIVE WRONG ANSWERS fixed first:
- **Pages on the wrong authority.** The field-based TOA re-found each cite
  with Word's substring search, so `10 F.3d 5` also matched inside
  `110 F.3d 512` and Doe v. Roe was given every page that cited Smith v.
  Jones; `35 U.S.C. § 10` matched inside `§ 101`, and `§ 1` inside `§ 103`.
  The pane now plans every search from the positions the scanner found,
  searches case-sensitively, runs all searches before inserting any TA
  field, and marks only the hits it planned (Word's second hit for
  `10 F.3d 5`, inside `110 F.3d 512`, is skipped).
- **A bare Id. matched ordinary words.** The `Id.` search ignored case, so
  the `id.` in `said.` and `paid.` (and `valid.`) gave Alice those pages.
  No step searches for a lowercase `id.` now; `See id. at 217` after a
  signal is still an Id. An `Id.` is placed under the authority right
  before it, so one that means Alice in one place and Mayo in another lands
  under each. When what comes right before it is not in the table (a record
  cite such as `See Appx12.`, a column cite, a treatise, or a string cite of
  several authorities), the `Id.` is left unmarked and named in the message
  with its reason, never handed to the last case the scanner read.
- **Curly vs straight apostrophes split one case in two.** `Int’l` (Word's
  autocorrect) and `Int'l` (pasted) made two rows that shared the locator
  `573 U.S. 208`, so the pane skipped it and Alice got zero pages. Now one
  row, `Alice Corp. v. CLS Bank Int’l, 573 U.S. 208 (2014)`, with both
  pages, and the citation register counts it twice under one entry.
- **passim was dropped.** Word's `\p` switch prints `passim` for an
  authority cited on five or more pages; *Insert formatted list* did not
  read it back and left a blank page slot. `passim` is read now.
- **In re short forms were never matched.** `Wands, 858 F.2d at 740` and
  `In re Wands, 858 F.2d at 741` are both found as short cites of *In re
  Wands*; the short name is the party after *In re* / *Ex parte*.
- **Wrong text in the table or the citation.**
  - `eBay Inc. v. MercExchange` was listed as "Bay Inc." and filed under B;
    `iRobot` as "Robot"; `de Vries v. Doe` as "Vries v. Doe". Each now
    keeps its lowercase first letter, and prose before the name is not
    swallowed.
  - `35 U.S.C. §§ 102, 103` lost § 103 (the obviousness statute). Each
    listed section now gives the page to its own row, `35 U.S.C. § 102` and
    `35 U.S.C. § 103`; `§§ 102 and 103` and `§§ 102, 103, and 112` likewise.
    A list never absorbs a number that is not a section: in `§§ 102, 103,
    12 claims remain` the `12` is refused by name, never filed as § 12. `37 C.F.R. §§ 1.97–1.98` keeps `§§` before a range
    (it printed a singular §).
  - `U.S. Patent No. 7469381` and `7,469,381` were two rows; now one,
    `U.S. Patent No. 7,469,381`.
  - The Patent form turned `US10123456B2` into "U.S. Patent No.
    US10,123,456". `US10123456B2` and `US 10,123,456 B2` now give
    `U.S. Patent No. 10,123,456`; `RE45,678` and `D123,456` keep their
    letter prefixes.
  - The short-form button on *United States v. Alvarez* gave "United
    States, 567 U.S. at 715". It gives `Alvarez, 567 U.S. at 715` (R10.9),
    and the form and the TOA now share one short-name implementation.
  - T6 abbreviation printed "United States of Am. v. Microsoft Corp.". It
    gives `United States v. Microsoft Corp.` (R10.2.2).
  - The Law review article placeholders demonstrated a redundant year. A
    volume that is the year now drops the date: `Mark A. Lemley, Software
    Patents and the Return of Functional Claiming, 2013 Wis. L. Rev. 905,
    912`; a numbered volume keeps it (`99 Va. L. Rev. 1 (2013)`).
  - A Case form with no court or year printed an empty `()`; it no longer
    does.

### Added — footnotes, existing tables, and more authorities
- **Footnotes and endnotes are scanned** (Word with WordApi 1.5). Each note
  is marked on its own; an `Id.` that opens a note is never carried over
  from another note or the text. On a Word that cannot read notes, the
  message says so plainly instead of claiming every authority was marked.
  Headers and footers are not scanned, and the message says that too.
- **An existing Table of Authorities is left out of the scan:** one Word
  built (its `TOA` field) and one typed under a "TABLE OF AUTHORITIES"
  heading, which runs to the next heading. Before, its entries were read as
  citations and the first `Id.` of the argument went to them.
- **Authorities that were missing from the table:** `F. App’x` with Word's
  curly apostrophe; `10 F. 3d 5` written with a space (it was read as a
  different reporter); Westlaw spellings `F.Supp.2d`, `S.Ct.`, `Fed.Appx.`;
  `USPQ2d`; `56 U.S. (15 How.) 62`; `RE45,678`, `D789,012`, `U.S. Pat. No.`,
  and `U.S. Patent Nos. A and B` as two rows; each member of `MPEP §§ 2111,
  2111.01`; the `Myriad, 569 U.S. at 590` short form.
- **Case names stop where the sentence does.** A name no longer runs across
  a paragraph break or a sentence (`ARGUMENT` / `Alice Corp. v. …`, `…by the
  Supreme Court. Mayo …`) and drops a leading sentence word (`After Alice`).
  WL cites keep their docket number (R10.8.1(a)), pre-1900 years are kept,
  and a hyphen range and an en-dash range are one row.

### Fixed — Paste & fix
- `85 Fed. Reg. 12,345 (Mar. 1, 2020) (to be codified at 37 C.F.R. pt. 1)`
  is a Federal Register cite (it was read as a C.F.R. section `pt. 1)`),
  with `codified` = `37 C.F.R. pt. 1`.
- Parallel cites are not glued into the case name: `Alice Corp. v. CLS Bank
  Int'l, 573 U.S. 208, 134 S. Ct. 2347 (2014)` fills the name, `573 U.S.
  208` and parallel `134 S. Ct. 2347`; `In re Fisher, 421 F.3d 1365, 76
  USPQ2d 1225 (Fed. Cir. 2005)` likewise.
- `U.S. Pat. No. 7,469,381, col. 3, ll. 15-20` keeps the line range: pin
  `col. 3 ll. 15–20` (the lines were silently lost).
- Recognised now (they were "couldn't recognize"): pin `216 n.3`, two
  pincites `216, 220`, `US 10,123,456 B2`, and Westlaw cites with a docket
  number. The Case form has a new optional **Docket no.** field, and
  `Acme Corp. v. Widget Co., No. 13-cv-1, 2015 WL 123456, at *3 (D. Del.
  Mar. 1, 2015)` round-trips exactly, with only the case name italic.
- `37 C.F.R. § 1.56 and Rule 132` stops the section at `1.56`.

### Independent adversarial pass (all closed)
A reviewer wrote 40 tests against real brief text (`toa.review.test.ts`).
It caught three regressions in the first version of these fixes, all closed
before release: a `§§` list swallowed claim numbers (`§§ 102, 103, 12` made
a row for 35 U.S.C. § 12, a real and unrelated section); a combined `§§` row
took the page away from the § 102 row; and an `Id.` after `See Appx12.` was
placed under the last case read. Compared on 664 citation texts, no
authority the previous release found is lost.

### What the tests prove, and what they do not
The automated tests pin the search plan (which hits each Word search must
return and which authority owns each one) and the handler's source (one
case-sensitive search site, every search synced before the first insert,
per-hit ownership, a rebuild that blanks out the table it built before, and
an unplaced citation counted in the message as "left unmarked"). They cannot
run Word. Whether Word's Find returns exactly the planned hits, including
whether it treats curly and straight quotes alike in a short form such as
`O'Brien, 12 F.3d at 36`, how non-breaking spaces behave, and whether a
rebuild leaves the page lists unchanged, is checked by the in-Word pass in
`docs/TEST-SCRIPT.md` §0ch.

## [2.140.0] — 2026-10-14 — Audio, video and light: levels, loudness, timecode, transfer curves, photometry and exposure

From `docs/SCOPE-AUDIO-VIDEO-2026-10.md` (oracles: SMPTE ST 12-1 / 274 /
424 / 2046-1, ITU-R BS.1770 / BT.709 / BT.1886 / BT.2100 / BT.601, EBU R68
and R128, SMPTE RP 155, IEC 61672-1:2013, AES17, ISO 1683, scipy,
pyloudnorm, colour-science). Engineering gains 17 tools (130 → 147) and a
twenty-first panel, **Light & camera**. LIVE WRONG ANSWERS fixed first:
- **The bitrate tool said its rate was "what a capture interface must
  carry"**: a serial digital interface carries the full raster including
  blanking. 1080p60 4:2:2 10-bit is 2.48832 Gbit/s of active picture and
  **2.97 Gbit/s on the link** (2200 × 1125 raster, SMPTE ST 274; 3G-SDI,
  ST 424), +19.36 %. Sizing a link or a recorder from the old number
  under-provisioned it. The note now says it is the ACTIVE-PICTURE rate.
- **Latency budgets billed k frames as k + 1**: a stage list summing to
  exactly k frames in floating point was rounded up a whole frame (one
  stage of 15 × (1000/23.976) ms at 23.976 Hz was 16 frames, now 15; four
  stages of 0.1/0.2/0.3/0.4 of a frame at 24 Hz was 2, now 1). Frames are
  integers now; a real overshoot is still billed (16.67 ms at 60 Hz → 2).
- **Critical distance silently assumed an omnidirectional source** (Q = 1):
  0.98420 m for a loudspeaker that, at Q = 2, has 1.39187 m. Reverberation
  now takes a directivity Q and says which it used.
- **Quantisation SNR used the rounded 6.02n + 1.76**: 16-bit is 98.0905 dB,
  not 98.08; 24-bit 146.2553, not 146.24.
- **Units-aware Solve printed units that do not parse back**: m³ × m³ came
  out as "m6" (now m⁶, and every multi-digit superscript prints), and a
  per-second result as "1/s", which the converter refused (it is read now).
- **720×480 was reported as aspect "3:2"**: that is the storage aspect; the
  note now says so and points to pixel aspect, and 1366×768 names its
  nearest common aspect (16:9, true 1.7786) beside 683:384.
- **Input friction**: `29.97 FPS`, `48 KHz`, `5 Mbps`, `320 kbps`, `1000 NIT`
  were "not a unit this recognises"; they are read now.

### Added — Audio & acoustics (nine tools)
- **Levels & references** (`audio-levels`): +4 dBu = 1.2276530 V = +1.7815
  dBV, 11.7815 dB above consumer −10 dBV; 0 dBFS = +18 dBu under EBU R68,
  +24 dBu under SMPTE RP 155 (+4 dBu → −14 / −20 dBFS); 94 dB SPL =
  1.0023745 Pa; 10 mV/Pa = −40.000 dBV/Pa; 1 W = 120.000 dB SWL re 1 pW.
  dB SPL ↔ dBu only through a microphone sensitivity, refused by name
  without one. Drawn as a level ladder.
- **Level arithmetic & weighting** (`audio-levelmath`): 80, 80, 74 →
  83.5241 dB; 85 total − 80 background → 83.3491 dB, 82 − 80 refused
  (within 3 dB); Leq of 70, 80, 90 → 85.6820 dB; two coherent 80s → 86.0206
  dB in phase, 83.0103 dB at 90°; octave bands 63 Hz–8 kHz at 80 dB →
  86.974 dB(A) (dB(Z) 89.031), each band at its exact base-10 centre — at
  the nominal 31.5 Hz label the formula gives −39.52, not the table's
  value. Mixed references are converted and said (`0 dBu, 0 dBV` → 4.2597
  dBu); mixed weightings are refused.
- **Dither, oversampling & noise floor** (`audio-dither`): 16-bit ideal /
  RPDF / TPDF 98.0905 / 95.0802 / 93.3193 dB; 24-bit TPDF 141.4841;
  oversampling ×4 / ×64 +6.0206 / +18.0618 dB; noise shaping refused by name.
- **Audio data rate & file size** (`audio-filesize`): 48 kHz/24-bit/2 ch =
  2,304,000 bit/s, 1.0368 GB per hour; CD 74 min = 783,216,000 B; the WAV
  ceiling at 48k/24/2 is 14913.08 s (4.1425 h), beyond which RF64/BW64.
- **Loudness (LUFS) normalisation** (`audio-loudness`, `loudness.ts`):
  −16.3 → −23 LUFS = −6.7 dB of gain, with the true peak tracked; a 997 Hz
  sine at 0 dBFS = −3.0103 LUFS in one front channel and 0.0000 in two,
  through the published 48 kHz BS.1770 K-filter (other rates refused, and
  1 kHz gives −3.0036 — not interchangeable with 997); a programme's
  integrated loudness, LRA or true peak from one reading is refused by name.
- **Loudspeaker sensitivity & amplifier power** (`audio-speaker`): 88 dB/1 W,
  100 W at 4 m → 95.9588 dB SPL; 100 dB SPL at 4 m needs 253.58 W; 2.83 V
  into 4 Ω is 2.00223 W, +3.0151 dB against a 1 W rating.
- **Room absorption budget** (`audio-absorption`): per surface, A 49.2 m²
  sabins → Sabine 0.65447 s, Eyring 0.58483 s, Millington–Sette 0.46780 s;
  a 0.5 s target needs 64.4, +15.2 m².
- **Passive crossover** (`audio-crossover`): LR2 at 2.5 kHz into 8 Ω →
  3.9789 µF, 1.01859 mH, tweeter inverted for a flat sum (checked against
  scipy); LR4 and third order refused by name.
- **Speaker cable & damping factor** (`audio-damping`): 2 × 10 m of 2.5 mm²,
  8 Ω, 0.02 Ω source → 0.137931 Ω, damping factor 50.655, −0.1698 dB.

### Added — Video & display (five tools)
- **Timecode** (`video-timecode`, `timecode.ts`), integers and exact
  rationals: 00:10:00;00 at 29.97 DF is frame 17982; 01:00:00;00 DF is
  107892 frames = 3599.9964 s exactly, NDF 108000 = 3603.6 s. A label that
  does not exist is refused, never normalised: `00:01:00;00` at 29.97 DF
  (the Python `timecode` library returns 1798 for it). Drawn as the NDF
  drift line against the DF sawtooth.
- **Frame rates, pulldown & shutter** (`video-framerate`): 23.976 snapped to
  24000/1001 and said; 29.97 at 48 kHz carries 8008 samples over five frames
  (3 × 1602 + 2 × 1601); 2:3 pulldown AA BB BC CD DD; 24 → 25 is +4.1667 %,
  +70.672 cents; 180° at 24 fps = 1/48 s; 25 → 29.97 refused (standards
  conversion).
- **Aspect, pixel aspect & framing** (`video-aspect`): 720×480 at 4:3 is PAR
  8:9 (720 basis) and 10:11 (BT.601, 704 basis); 2.39 in 1920×1080 is
  803.347 lines (804 even, bars 138); safe areas 1728×972 and 1785.6×1004.4.
- **Transfer functions & code values** (`video-transfer`): BT.1886 at 0.5 →
  18.94646 cd/m², 10-bit narrow code 502; BT.709 OETF of 0.18 → 0.409008,
  labelled an OETF, not an EOTF; PQ 0.5 → 92.24571 cd/m²; HLG per BT.2100.
- **Interface bandwidth & recording time** (`video-interface`): active,
  blanking and SDI class as bars; 100 Mbit/s = 45 GB/h, a 128 GB card in
  2:50:40 (119.209 GiB).

### Added — Light & camera (new panel, three tools)
- **Illuminance, luminance & beams** (`light-photometry`, `photometry.ts`):
  1000 cd at 2 m = 250 lx (216.5064 lx at 30°); a uniform 30° cone =
  214.0943 lm, the honest route round the refused cd → lm; 5000 lm on 10 m²
  = 159.1549 cd/m² = 46.4515 ftL (never written fL).
- **Exposure, f-stops & depth of field** (`light-exposure`): f/8 at 1/125 s
  is EV 12.96578; f/4 → f/11 is exactly 3 stops (2.9189 by the markings);
  50 mm f/8 at 5 m: hyperfocal 10.4667 m, sharp from 3.38937 m to 9.52744 m;
  36×24 mm at 50 mm → 39.5978° horizontal, 46.7930° diagonal.
- **Colour temperature & mired** (`light-colourtemp`, `colourspace.ts`):
  3200 → 5600 K = −133.9286 mired (a blue correction); D65 (0.3127, 0.3290)
  → McCamy 6505.08 K beside Robertson 6503.707 K.
- **Units**: `50 fc`, `14 ftL`, `20 µPa`, `1 pW`, `5 Mbps`, `1/125 s` and
  `5 1/s` are read; a decibel in a pressure field is refused as a
  logarithmic level, not a unit. Units-aware Solve names Φ/A as lux.

### Adversarial pass — independent reviewer (all closed)
Found in the new code: the new `fc` and `fL` unit keys captured the audio
engineer's cutoff and band-edge symbols, so `f1 = 3 fc` in Solve answered
in lux, silently; `E = I/d²` with I in candela (250 lx) was named a
luminance in "nit" — cd/m² is no longer force-named; McCamy was labelled
±2 K over 2856–6504 K when it is off by up to 10.06 K there (+8.84 K at a
4000 K blackbody), and it refused a 2700 K lamp and the product's own D75
point instead of answering, labelled, with Robertson beside it; full-range
chroma code values of 1024 (10-bit) and 256 (8-bit), outside the word (now
clipped per H.273 Clip1); a level list mixing dBu with dBV, or dB(A) with
dB(C), summed silently in no reference at all; an accepted +2 dBFS
(AES17 sine) input was told it clips the converter; `2 dbar` was called a
logarithmic level (the decibar is now read, 20 kPa); `50 FC`, as lighting
schedules write it, was refused (538.2 lx); and the BT.709 formula line
printed ASCII carets.

## [2.139.0] — 2026-10-14 — Spectroscopy: JCAMP overlay, exact isotope patterns, diastereotopic NMR, and Woodward–Fieser fixes

From `docs/SCOPE-SPECTROSCOPY-BATCH.md` (oracles: the Python `jcamp` 1.3.2
decoder, IsoSpecPy 2.5.0, molmass, RDKit, the CIAAW 2024 isotopic
compositions, AME2020 masses, the Woodward–Fieser enone tables). LIVE WRONG
ANSWERS fixed first:
- **The JCAMP-DX reader corrupted DIFDUP data**: a DUP after a DIF repeated
  the value instead of the difference, so `compound.jdx` came back with
  1,083 of its 1,976 points wrong — drawn and offered for insertion with
  the failed Y-checks listed beneath it. x also slipped one sample after
  every Y-check line (`compound.jdx` started at 452 cm⁻¹, not 450). AFFN
  with an exponent was read as SQZ; `(XYW..XYW)` peak tables were read as
  pairs; every NTUPLES file (and an NMR FID) came back `ok` as a one-point
  (0, 0) "spectrum"; a LINK file showed its first block, a 4-point peak
  table drawn as a line, instead of the 16,384-point spectrum.
- **Isotope patterns were cut, mislabelled or missing elements**: a 6-peak
  cap dropped C₂Cl₄'s M+6 (10.2 %); labels counted from the lightest
  isotopologue, so selenomethionine's labels were 6 Da high with its ⁸⁰Se
  base peak cut, and phenylboronic acid printed the ¹¹B mass against the ¹⁰B
  peak; HgCl₂, ferrocene, cisplatin and nine other metal compounds were drawn
  as if the metal had no isotopes (cisplatin's true base peak is M+1, ¹⁹⁵Pt),
  under "masses and adducts are still exact".
- **OpenChemLib's masses were wrong**: Cu by +10 mDa (⁶³Cu 62.93960 against
  62.92960 — Cu(NO₃)₂ 186.9152, now 186.9052), Pa by 15 Da (²¹⁶Pa 216.01896
  for ²³¹Pa 231.03588), and Tc, Po and Ra given invented masses. Every mass
  now comes from AME2020; an element with no stable isotope is refused by
  name ("write the isotope, e.g. [99Tc]").
- **`C6Cl6` was answered as chloromethane** (CH₃Cl, 49.99) — a v2.137.0
  regression: OpenChemLib accepted a ring closure that duplicates an
  existing bond. `C6F6`, `C6Br6`, `C2Cl2`, `C2Br2`, `C3Br3` the same. They
  are formulas again (C₆Cl₆ M 281.8131); `C1CCCCC1`, decalin and cubane stay
  SMILES.
- **UV λmax depended on SMILES atom order**: one molecule with two enones
  gave 227 nm written one way and 239 nm the other; androsta-1,4-diene-3,17-
  dione gave 227 where prednisone, the same chromophore, gave 239.
  p-Benzoquinone (227), duroquinone (249) and benzalacetone, chalcone and
  dibenzylideneacetone (227 each, really ≈ 60–100 nm higher) were all given
  numbers. Extended enones were mis-scored: hexa-2,4-dienal 252 (now 258),
  cholesta-4,6-dien-3-one 269 (now 275).
- **¹H NMR merged diastereotopic groups**: valine's isopropyl methyls were
  one 6H d (now 3H d + 3H d at 0.87); `CC(C)C(O)C` had 4 ¹³C signals for 5
  environments; a diastereotopic CH₂ was a clean q (acetal OCH₂), quint
  (2-butanol) or d (glycerol). Ibuprofen's ring protons came out t for one
  atom order and s for another. Meso halves were split (meso-2,4-
  dichloropentane 5 ¹³C rows, now 3).

### Added
- **JCAMP-DX reader** (`jcamp.ts`): ASDF DIF/DUP decoded exactly against the
  independent decoder over the committed test corpus; x positions from
  FIRSTX + i·ΔX; Y-checks enforced — a block that fails its own checks is
  shown with the failing line and **cannot be inserted or overlaid**;
  1D NMR NTUPLES (the real page); peak tables drawn as sticks, never joined
  into a trace; %T converted to absorbance for peak picking; `$OFFSET`
  anchored at FIRSTX; a **block picker** for multi-block files, the default
  a full trace over a peak table, with the reason said. FID, nD NMR and
  GC-MS NTUPLES are refused by name. Units shown as cm⁻¹, Hz, m/z, with the
  file's raw string kept as provenance.
- **Compare with acquired spectrum** (`spectrumOverlay.ts`,
  `overlayChart.ts`): the prediction drawn over a loaded JCAMP file for ¹H,
  ¹³C, IR, UV-Vis and MS (sticks, a curve, a λmax marker, head-to-tail),
  with a match table of each predicted line, the nearest measured peak and
  Δ. 2-methyl-1-propanol ¹H against its measured spectrum: 4 of 4 inside
  their window. Referencing is never shifted silently: an ethylbenzene ¹³C
  file is "Not assessed: the measured axis looks offset by +9.09 ppm" until
  a **reference peak** is given (`86.25 = 77.16` → 6 of 6). Kind, nucleus,
  phase (`##STATE=gas`) and `##MOLFORM` mismatches are said. "A prediction
  is not an assignment: a nearest peak is proximity, not identity."
- **Exact isotope patterns** (`isotopes.ts`, `isotopeChart.ts`): all 84
  elements with a natural composition (289 isotopes), CIAAW 2024 abundances
  and AME2020 masses stored verbatim and hashed; M is the most abundant
  isotope of every element and labels run M−n … M+n with a true minus
  (ferrocene M−2 184.0179 for ⁵⁴Fe; C₂Cl₄ base peak M+2 165.8725); no peak
  cap below 0.1 % of base (what is left out is counted and said); chlorophyll
  a's magnesium is in its pattern (M+1 74.63, M+2 41.69). D and T are read
  as ²H and ³H (CDCl₃ = 118.92066). The **isotope stick chart** is the Mass
  Spec figure, and Mass Spec gets its own comparison against an MS file.
- **Diastereotopic groups** (`diastereotopic.ts`): from the structure's
  topology; diastereotopic methyls become two signals at the same δ, a
  diastereotopic CH₂ is one row "m" with its typical ²J by class (ibuprofen's
  ArCH₂: m (²J 14–18 Hz)), footnoted in the table and in the inserted text;
  an unspecified relative configuration is said, not picked; meso halves
  merged. No Δδ, no second-order patterns, no Karplus.
- **Woodward–Fieser** (`uvvis.ts`): every enone arm scored and the largest
  reported, so λmax no longer depends on atom order (prednisone: "2 enone
  arms were each scored (239, 227 nm)"); extended enones with +30 per
  extending C=C, γ/δ +18 and homoannular +39, under an EXTENDED caveat in
  place of ±5 nm; quinones and aryl-conjugated enones refused by name. The
  exocyclic +5 is held off (prednisone would move to 244 against 238
  measured) and said as a caveat in both branches.

### Adversarial pass — independent reviewer (all closed)
Found: XYDATA without `##NPOINTS` stacked every ordinate of a line on one x;
an NMR or IR peak table was peak-picked as if it were a trace, so listed
peaks vanished and lines were ticked against the wrong measured peak (the
1.809 ppm line of `ethanol_nmr.jdx` was discarded); a UV-Vis file in
transmittance was picked on T, not absorbance; `$OFFSET` was anchored on
the first LISTED x instead of FIRSTX (a 12,800 Hz peak landed at 200 ppm,
not 128); a caveat said a file gave no `$OFFSET` when it did; extended enone
arms counted the in-chain γ carbon as a β substituent and never applied the
+18 or +39 increments (6,6-dimethylcyclohexa-2,4-dienone 257, now 302); and
D in a typed formula was refused where the answer (CDCl₃ 118.92066) exists.

## [2.138.0] — 2026-10-14 — DAE index reduction, real K-theory, oriented cobordism, and persistence over 𝔽ₚ

From `docs/SCOPE-NUMERICS-TOPOLOGY.md` (oracles: SciPy, GUDHI 3.13,
Ripser 0.6.15, SymPy, Bott / Adams 1962 / Milnor–Stasheff). LIVE WRONG
ANSWERS fixed first:
- **The DAE tool bound initial values BY POSITION**: the same system
  started from `x = 1, u = 0` gave [0.540, −0.841] and from `u = 0, x = 1`
  gave [0, 0.368], silently. Values are now bound by name; missing,
  duplicate, extra and reserved names are refused by name; `1/2`, `pi`,
  `−1` are read (they were dropped and reported missing).
- **"No drift by construction" was claimed while the real constraint
  drifted** (a hand-reduced pendulum: x² + y² → 0.54 at t = 10). Drift is
  now MEASURED against every original and hidden constraint.
- **Cobordism verdicts flipped on products and connected sums**: the Klein
  bottle (`rp^2 # rp^2`) and `rp^2 x s^1` were "does NOT bound" — both
  bound. `does rp^42 bound` said BOUNDS (the old engine returned nothing
  above dimension 40).
- **K-theory answered a different question**: K(S¹ × S¹) was answered as
  K(S¹); "real K-theory" returned complex K; `π₃(KO)` returned the sphere's
  stable stem ℤ/24 (truth 0, Bott).
- **"over F3" on a pasted point cloud was silently answered over 𝔽₂**, and
  persistence on any cloud over ~70 points hit the cap with no triangles.

### Added
- **DAE index reduction** (`daeIndex.ts`, `daeParse.ts`): Pantelides
  structural index, hidden constraints by symbolic differentiation,
  integration of the reduced system with the existing high-order
  integrators plus projection onto every constraint, the measured drift
  before and after projection; the Cartesian pendulum (index 3) solved to
  ≈ 2e-8 of SciPy; a run stops AT a singular point (∂g/∂z singular — no
  continuous solution beyond it), even between report points; results are
  deterministic (a work budget, not the clock); an undetermined algebraic
  unknown is refused by name.
- **Real K-theory** (`kReal.ts`): KO of points and spheres by Bott
  periodicity, K̃O⁰(ℝPⁿ) = ℤ/2^φ(n) (Adams 1962), π_n(KO) and π_n(KU);
  complex K of products by Künneth.
- **Cobordism** (`cobordism.ts`): manifolds as ring elements (`#` adds, `×`
  multiplies, `−` reverses orientation); unoriented verdicts by
  Stiefel–Whitney numbers, oriented by Pontryagin numbers and the
  signature theorem, every verdict cross-checked five ways; Ω^SO_n cited
  to n = 8 (higher torsion refused by name — not verified against a
  primary source); a manifold typed alone gets its summary.
- **Persistence over 𝔽ₚ** (`persistence.ts`): any prime field, the
  Klein bottle, torus and ℝP² distinguished (the torsion the change of
  field reveals is said), matched to GUDHI/Ripser to < 6e-8; an automatic
  scale chosen BEFORE building; 𝔽₂ pinned bit for bit to the old engine.
- Topology output typeset (ℤ ⊕ ℤ/2, ℤ², ℝP⁴, ℂP², K̃O⁰, Ω₅ˢᴼ, Hₖ) and read
  back; a typed simplicial complex is no longer read as a point cloud.

### Adversarial pass — independent reviewer (all closed)
Found NOTHING wrong in the DAE numbers against SciPy (pendulum variants,
double pendulum, index 2–5 chains, 20 random systems — 1.9e-12), 800
random cobordism classes against its own SW/Pontryagin computation, KO and
K tables, or 46 persistence jobs against GUDHI. Found: π_n(KO) answered
with stable stems; a DAE claiming completion through a pole (and the
authors' own pin passing only because a grid node landed on it); a
typed complex read as a cloud; display-contract breaks (`ℂP² × −ℂP²`
refused, `16−ℂP²` re-reading as a subtraction, `𝔑₅` folded to `N₅`); and
refusals where the answer is known (KO of T¹, ℂP¹, ℍP¹, four points).

## [2.137.0] — 2026-10-14 — Reaction balancing, stoichiometry, genetic codes, peptides, and formula fixes

From `docs/SCOPE-CHEMBIO-BATCH.md` (oracles: chempy, SymPy, Biopython,
pyteomics, RDKit, NCBI gc.prt 4.6, Unimod). LIVE WRONG ANSWERS fixed first:
- **Sequence listings wrote the wrong protein**: the auto-generated
  `/translation` ignored `/transl_table` (a table-2 CDS came out `MR` for
  `M`; a table-11 CDS starting GTG came out `VKPGFK` for NCBI's `MKPGFK`)
  and `findOrfs` only ever started at ATG and cut table-4 genes at TGA.
- **The peptide reader invented residues** from tokens it did not know:
  `cyclo(GRGDSP)` became Cys-Tyr-Cys-Leu-Pyl…, 1307.5 Da (truth 569.26);
  `Ac-…-NH2` added Ala-Cys and Asn-His; `M(ox)` read O as pyrrolysine.
- **Fractional hydrates had the wrong mass**: `CaSO4·0.5H2O` was "✓ Valid,
  226.209" (truth 145.142); hydrate coefficients were typeset as subscripts
  (CuSO₄·₅H₂O) in the preview and in Word.
- **Formulas typed into Mass Spec and Structure mode were read as SMILES**:
  `Co` (cobalt) became CH₃O; polycyclic SMILES (decalin, adamantane) had
  their ring-closure digits read as counts in review.
- **The shared unit converter read mol/L as 1000 M** (`convert(0.08,
  "mol/L", "M")` = 80): found by the independent review through the new
  stoichiometry calculator; no shipped calculator default changed.

### Added
- **Reaction balancing** (`balance.ts`): the exact integer null space of
  the element + charge matrix, every element and the charge recounted;
  charges, electrons, states, hydrates; a reaction with TWO OR MORE
  independent balancings is refused with the independent reactions shown
  (chempy prints one); an impossible reaction names the conserved quantity
  that fails; half-reactions in acid or base with the electron count fixed
  by the oxidation-state change. In Solve (`balance …`) and in Reaction
  mode's new Structures | Formulas reading (never auto-detected: `CO` is
  methanol as SMILES and carbon monoxide as a formula).
- **Stoichiometry** (`stoich.ts`, a Bio/Assay calculator): limiting
  reagent, excess remaining, theoretical and percent yield from masses,
  moles, solution volumes × molarity and gases at STATED conditions — both
  STP definitions named, never assumed.
- **All 27 NCBI genetic codes** (`geneticCode.ts`, verbatim from gc.prt 4.6
  and checked cell by cell against Biopython): table and start-codon
  selectors in DNA translation and the ORF finder, `/transl_table` and
  `/transl_except` honoured in sequence listings (the initiator rule only
  with an explicit `/transl_table`; `/transl_except` always wins).
- **Peptides** (`peptide.ts`, `peptideMods.ts`): cyclic peptides,
  disulfides, terminal groups and Unimod modifications (each delta
  re-derived from composition when the module loads); every unknown token
  refused BY NAME with its position — never mapped to a residue. Peptide
  structures above 250 heavy atoms (~30 residues) are not drawn — drawing
  took 12.5 s and would freeze Word — the masses are still given.
- Formula fixes (`chemValidate.ts`, `chemParser.ts`, `structures.ts`,
  `massspec.ts`): decimal and fractional hydrate coefficients, full-size
  hydrate coefficients, reaction `+` and arrows never typeset as charges,
  and a formula-versus-SMILES resolver that picks by mode and always names
  the other reading.

### Adversarial pass — independent reviewer (13 defect classes, all closed)
Found NOTHING wrong in 600 random balancings (SymPy null space), every
§D stoichiometry row, all 27 genetic codes and 7,200 ORFs vs Biopython,
or 400 random modified peptides vs pyteomics. Found: the mol/L unit bug
above; ring-closure digits read as counts; `P1V1 = P2V2` balanced as a
reaction; I₃⁻ and H₂⁻ read as single atoms; `Cu1.8S` read as a hydrate;
the new initiator rule overriding an explicit `/transl_except` (a
regression — VKPG had become MKPG) and a `/transl_except` at a stop codon
truncating the protein; the 1000-residue peptide cap bounding residues but
not time (12.6 s); lowercase non-standard codes (`hyp`, `orn`) silently
split into residues; textbook half-reactions refused.

## [2.136.0] — 2026-10-14 — Exact cubic and quartic roots, multivariate simplification, radius of convergence, and leftovers

From `docs/SCOPE-SYMBOLIC-BATCH.md` (129 inputs through the Solve chain,
SymPy as the oracle). Live wrong answers it found and this release fixes:
repeated roots printed as fake COMPLEX roots under "Complete" (`(x-1)^4 =
0` → four 1.00004 + 0.000007i values); `simplify cbrt(2)^3 - 2` →
1.68e-16 instead of 0; "probability of reaching 3 before 1" answered with
the STATIONARY distribution (truth 1/2); a proportion interval of zero
width at p = 0 and one silently clamped at 0 while its printed formula
went negative; `maximize x y subject to x^2 + y^2 = pi` stolen by the LP
verb (a v2.132.0 regression); `hessian x^y at (1, 1)` withheld as
"asymmetric"; and "solve x^2 - 5x + 6 = 0" answered "more than one
unknown (solve, x)".

### Added
- **Exact polynomial roots** (`polyRoots.ts`): square-free factorisation
  first (repeated roots exact, with their multiplicity), rational roots,
  Cardano with the casus irreducibilis in TRIGONOMETRIC form (three real
  roots as 2√(−p/3)·cos(…), never a complex radical labelled real), Ferrari
  for quartics, binomials; degree ≥ 5 numeric with Abel–Ruffini said. Every
  closed form is PROVED by an exact identity in ℚ or ℚ(√s) (factors
  multiply back; u³ + v³ = −q and u³v³ = −p³/27; the quartic's quadratic
  factors multiply back) and then re-parsed and matched to a polished
  numeric root — an unproved form is withheld, factor by factor. `x^3 = 2`
  → ∛2. Recurrences honour multiplicities (a repeated characteristic root
  had silently lost its n·rⁿ terms).
- **Multivariate simplification** (`cas.ts`): polynomial GCD over ℚ in up
  to 4 symbols with the cancelled factor named (and the "cancelling can
  remove points" caveat only when a factor was cancelled unnamed), a
  resultant, an exact-radical mode (cbrt(2)³ = 2, denesting only when it
  squares back), and `x^y/x` equal to `x^(y−1)`. 210 random identities
  checked both ways; no existing expectation changed.
- **Radius of convergence** (`radius.ts`): the distance to the nearest
  singularity in ℂ with the theorem named (1/(1+x²) → 1 from the poles ±i
  — no real singularity), the ratio test on a general term, endpoints only
  where a named test decides, "R ≥ d" where a cancellation is possible;
  `taylor …` gains its radius line and a disc figure; removable centres
  (sin x/x, x/(eˣ−1)) are expanded by series division.
- **Integration and multivariable leftovers** (`casint.ts`, `multivar.ts`):
  ∫ 1/√(a² − x²) = asin(x/a) and its shifted/scaled forms, ∫ 1/(x² + a²)
  = atan(x/a)/a — both exact; improper endpoints said; near-pole integrals
  refereed by an adaptive rule split at the peak (no more refusing a
  correct exact value); Lagrange by tangency and RESULTANTS with every
  candidate substituted back; sin² + cos² and 1^k folded.
- **Probability** (`probability.ts`, `markov.ts`): proportion intervals —
  Wilson leads, Clopper–Pearson beside it, Wald with its truncation said —
  each computed two independent ways; Markov hitting probabilities and
  expected first-passage times exact over ℚ (∞ by name where a target is
  not reached with certainty), return times checked against 1/π.
- Solve reads "solve …", "find the roots of …", "taylor …" and "radius of
  convergence …" typed in the default kind (and in the pop-out canvas);
  cube and fourth roots typeset as real radicals in Word.

## [2.135.0] — 2026-10-14 — Abstract algebra: groups, permutations, rings and finite fields

The sixth Solve domain on the 2026-10 arc (`docs/SCOPE-ABSTRACT-ALGEBRA.md`).
The audit probed 110 inputs: 6 answered (all number theory). 24 were
answered WRONG in the default Equation kind — `7 * 9 mod 12` → "mod = 0",
`Z/6` → "Z = 0", `factor x^2 + 1 over F_2` → the answer line "F_2", `D4` in
the Discrete kind → "D(4) = !4 = 9" (a derangement count).

### Added
- **Groups** (`algebra.ts`, `algebraGroups.ts`, `algebraGroupVerbs.ts`,
  `algebraPerm.ts`): ℤ/n, U(n), Sₙ in cycle notation, Dₙ in both naming
  conventions (the one read is said), direct products, typed Cayley tables
  — every table checked for closure, associativity, identity and inverses
  by brute force, a non-group refused naming the failing triple; element
  orders, generated subgroups, all subgroups (|G| ≤ 24) with the lattice
  drawn as a Hasse diagram, cosets, normality, quotients (re-checked as
  groups), centre, conjugacy classes; isomorphism decided by TWO
  independent invariant sets where they prove it (abelian, |G| ≤ 15) or by
  a constructed, checked map — "cannot be decided here" otherwise, by name;
  permutations composed right to left by default (left to right on
  request, the other reading always shown), inverse, cycle type, sign,
  order; homomorphisms with kernel and image.
- **Rings and fields** (`algebraFields.ts`): arithmetic in ℤ/n with any
  operator before `mod` (division as multiplication by the inverse, said),
  units, zero divisors; 𝔽ₚ[x] arithmetic, extended Euclid, irreducibility
  (brute force / Rabin), factoring (multiplied back AND checked by root
  counting), roots via gcd(f, xᵖ − x); GF(pᵏ) from an irreducible
  modulus with its element list and table, primitive elements (counted
  against φ(q − 1)), minimal polynomials; the CRT isomorphism explicit.
- `cayleyTableSvg.ts` (a text-cell grid, coset bands, never text below 9 px
  — beyond that the figure is refused by name and the text table kept);
  `algebraSwitch.ts` hands algebra typed into the Equation kind to the
  Discrete kind (raw input, before every other switch). The engine is
  FIRST in the Discrete engine order (number theory strips parentheses,
  combinatorics read `D4` as a derangement). `tryAlgebraVerb` stands aside
  for `over F_p` / `mod p`. Palette group "Abstract algebra".

### Adversarial pass — independent reviewer (5 wrong, 2 hangs, refusals and cosmetics, all closed)
Oracles: its own brute-force groups (≈ 90 groups to order 72), BigInt
arithmetic, 1,200 random polynomials over 𝔽₂…𝔽₇. Found: a modulus over 40
digits SILENTLY REPLACED by a 99…9 placeholder (`Z/(2^521 − 1)`, a Mersenne
prime, was "NOT a field"); `subgroups of D4 of order 4` answered about D₂
(the order filter read as the naming convention) and `of order 2` listed
all ten; a Cayley table whose first element is `x` refused as "not a
group"; `a` meaning 0 in a prime field; root finding costing n × degree
(`x^1000 + x + 1 = 0 mod 999983`, 23 s) and `(x + 1)^4096 mod 2` expanded
over ℤ first (7 s, then a 3.5 MB refusal message). Its own brief had one
wrong example too: x ↦ 3x from ℤ/4 to ℤ/6 IS a homomorphism (3·4 ≡ 0).

### Honest limits
- |G| ≤ 120; all subgroups for |G| ≤ 24; drawn tables ≤ 20 elements;
  permutation degree ≤ 30; GF(q) tables q ≤ 1024; isomorphism decided by
  invariants only to order 15 (ℤ/8 × ℤ/2 and M₁₆ share them at 16).
- Primality of a huge modulus is probabilistic and said ("probable prime").

## [2.134.0] — 2026-10-14 — Statistics: exact rank tests, repeated-measures ANOVA, Cox regression, and table-reading fixes

From `docs/SCOPE-STATS-BATCH.md`. The audit found LIVE WRONG ANSWERS in the
shipped Stats calculators, and those are this release's first purpose:

### Fixed — wrong numbers that shipped without a warning
- **A long repeated-measures table was misread into Friedman**: `Subject |
  Time | Score` became 9 "subjects" × 3 "conditions" and gave χ² 14.73, p =
  0.0006; the truth is χ²(2) = 6, p = e⁻³ ≈ 0.0498. Long tables are now
  pivoted (text levels, any order, merged labels filled down and said);
  a group column in a Friedman request, an Age/Weight column, unheaded ids,
  summary rows (Total, Mean, SD …) and transposed tables are each named and
  either excluded or refused — never read as data.
- **Kaplan–Meier and log-rank used the patient ID as time** on start/stop
  tables (`ID | Start | Stop | Event`). Single-interval tables now use Stop
  (or Stop − Start, said); several intervals per subject are refused by
  name; an id or row counter is never time; underscored headers
  (`OS_MONTHS`, `time_months`, cBioPortal's `PATIENT_ID | AGE | OS_MONTHS |
  OS_STATUS`) are read correctly — they used to send the time to Age.
- **Mann–Whitney and Wilcoxon printed impossible p-values**: the normal
  approximation gave p = 0.081 for 3 v 3, below the smallest p that exists
  (0.1). Both tests are now EXACT (BigInt counts, the exact fraction
  printed) up to 60 observations, conditional on ties, with the normal p
  shown beside and the switch rule stated. Ties are decided at the data's
  own decimal precision — floating point had made three differences of
  0.2 three distinct ranks and printed p = 0.047 as "exact" (truth 0.0625).
- **A typed decimal comma changed n**: `1,5 2,3 3,1` was six numbers. Typed
  lists now follow the same rule as the table feed (one shared reader,
  `numberList.ts`), decided over the whole field and said in a note.
- Multiple regression no longer fits ordinary least squares to survival
  times with the event flag as a predictor (the "R² 0.73" Cox impostor).

### Added
- **Repeated-measures ANOVA** (`rmAnova.ts`): one within-subject factor and
  the mixed design; Mauchly (refused by name when it is undefined, never a
  fake p), Greenhouse–Geisser and Huynh–Feldt (Lecoutre's form, as R —
  said), partial η², Holm post-hoc, a profile plot with Cousineau–Morey
  intervals. Long or wide tables at the cursor.
- **Cox proportional-hazards regression** (`cox.ts`): Efron ties (Breslow
  on request), hazard ratios with 95% CIs, likelihood-ratio / Wald / score
  tests, Harrell's C, the Schoenfeld proportional-hazards test; refused by
  name for too few events per parameter, divergence (monotone likelihood),
  collinearity, an event-free factor level; a forest plot on a LOG axis and
  adjusted survival curves. Cross-checked: the one-binary-covariate score
  test equals the log-rank χ².
- `statchart.ts` gained a log axis (decade ticks, reference line at 1).

### Adversarial pass — independent reviewer (8 wrong/misread + 4 refusals + cosmetics, all closed)
Oracles: SciPy, statsmodels, lifelines, pingouin and brute force. Found
NOTHING wrong in the fits themselves (Cox vs statsmodels to 5e-9, RM ANOVA
vs pingouin to 1e-9, exact Mann–Whitney vs brute force on 400 cases). It
found the float-split ties above, underscored survival headers, numeric
subject ids under `Mouse`/`Rat`/`Donor` read as conditions, Total/Mean rows
read as subjects, the comma rule not decided over the whole field, the
wrong time column chosen between two, a second endpoint entered as Cox
covariates, case-split factor levels (M/m/F/f), and a separation rule that
refused strong but FINITE Cox effects.

## [2.133.0] — 2026-10-14 — Computation theory: grammars, machines, first-order logic, SAT, Hindley–Milner

The fifth Solve domain on the 2026-10 arc (`docs/SCOPE-COMPUTATION-THEORY.md`).
The audit probed 85 curriculum inputs across three kinds: 7 answered (all
SAT by truth table), the rest wrong or refused. The worst classes: `S -> aSb`
was a truth table over a variable named `aSb`; two productions were a drawn
digraph; the λ kind "reduced" `hm λf.λx.f (f x)` and `busy beaver 3` as free
variables; `->` was an inequality in the equation kind; `ε`, `∀`, `∃` threw
"Unexpected character"; 2,000 nested parentheses escaped as a RangeError.

### Added
- **Context-free grammars** (`src/lib/grammar.ts`, Discrete kind): reader
  (UPPERCASE nonterminals, `<expr>`/quoted multi-character symbols, `|` at
  depth 0, `->`/`→`/`::=`, `ε`/`eps`/`λ`), printer that re-parses, ε- and
  unit-removal, Chomsky normal form (new names said), CYK with the table, a
  leftmost derivation and the parse tree from the back-pointers — every
  verdict cross-checked by a SEPARATE brute-force derivation enumerator and
  withheld on disagreement; ambiguity witnesses (both trees drawn; "not
  found" is evidence, never proof); nullable / FIRST / FOLLOW; useless
  symbols; immediate and indirect left recursion; equivalence refused by
  name with a sample comparison. A seeded 200-grammar check (direct parse,
  CYK, brute force) found a non-generating nonterminal crashing CYK, and a
  worst-case grammar ran 29 s — both fixed before review.
- **Pushdown automata** (`src/lib/pda.ts`): four transition spellings,
  `stack:`, acceptance by final state / empty stack / both — always said;
  capped configuration-BFS ("UNKNOWN" when a cap binds, never "rejected");
  the run as a configuration chain; `cfg to pda` (one-state construction)
  checked against the grammar's CYK on every test string; one template,
  aⁿbⁿ (n ≥ 0, so ε is accepted).
- **Turing machines** (`src/lib/turing.ts`): three rule spellings incl.
  `δ(q, s) = (q', s', D)`; one line per step; an INDEPENDENT second stepper
  must agree on every configuration; LOOPS only on a full-configuration
  repeat (a proof) and a 10,000-step cap reported as UNKNOWN — the two never
  share a sentence; binary-increment and unary-add templates verified in
  BigInt; busy-beaver values cited, never computed; the halting problem
  refused by name.
- **First-order logic** (`src/lib/fol.ts`): an iterative parser (depth cap
  checked before any walk), prenex with each quantifier flip shown,
  Skolemization, clausal form, Robinson unification with the occurs check
  (both terms shown equal), resolution with factoring — REFUTED/VALID,
  SATURATED/INVALID with a countermodel, or UNKNOWN within the cap — every
  resolvent re-verified, the refutation drawn as a DAG; finite-model
  checking over domains ≤ 6. Found while building: a free variable in a
  `⊢` goal was negated before its universal closure (`P(a) ⊢ P(x)` said
  VALID), and a quantified name stayed a variable outside its scope.
- **SAT** (`src/lib/sat.ts`): DPLL with unit propagation and pure literals,
  the search tree drawn, a model re-checked clause by clause, UNSAT with a
  resolution refutation and the unsat core, brute-force agreement whenever
  ≤ 20 variables; 2-SAT by the implication graph and strongly connected
  components (`graphs.ts` gained `buildGraph`, so `¬a` is never printed and
  re-parsed); Horn-SAT; DIMACS. Found while building: DPLL undid a
  satisfiable branch's propagation and reported a model that failed a
  clause — the engine's own clause re-check caught it. `sat`/`cnf` ≤ 10
  variables stay with the truth table.
- **Hindley–Milner** (`src/lib/hm.ts`, λ kind): `hm …` and one-line `let …
  in …` (read before the definition rule could call it a definition),
  int/bool literals, pairs, `if`, `let rec`; Algorithm W with every
  unification, generalisation and instantiation logged; the derivation tree
  drawn; every pure-λ type cross-checked against the simple-type checker on
  the capture-safe let-expansion; λ-bound names monomorphic with the `let`
  fix named. Unknown leading words in the λ kind (`busy beaver 3`,
  `unify f(x) with g(x)`) are refused by name instead of "reduced" as free
  variables.
- `src/lib/treeSvg.ts`: the shared tree/DAG figure (parse trees, DPLL
  trees, resolution DAGs, W derivations); `automata.ts` exports its block
  grammar and a `stateDiagramSvg` / `configStripSvg` pair (the existing
  DFA/NFA figures byte-identical).
- Routing: the five engines sit between recurrence and automata; a
  production is a grammar only with an UPPERCASE left side and a terminal
  or `|` (`p -> q` stays logic, `A -> B ⏎ B -> C` stays a graph); a stack
  overflow in ANY discrete engine is a named refusal (2,000 nested
  parentheses used to escape as a RangeError); the Equation kind switches
  to Discrete or λ by itself — keyword-led requests (a grammar, `pda`,
  `tm`, `dpll`) even to show a refusal, word-led ones (`resolve`, `unify`,
  `exists`, `hm`) only when the engine answers; "does the machine …" is a
  Turing question only when it asks about halting. Palette groups
  "Grammars", "Machines", "First-order logic", "SAT", "Hindley–Milner".
  Figure corpus +10. The engines re-read their own printed configurations,
  step lines and type schemes at run time (display contract).

### Honest limits
- Ambiguity, CFG/PDA/TM equivalence and halting are undecidable: bounded
  evidence only, said. FOL validity is semi-decidable: a refutation is a
  proof, "not found" is not. DPLL is exponential (a decision budget, by
  name). HM is rank-1. No equality or arithmetic in FOL. One prose template
  per machine family.

## [2.132.0] — 2026-10-14 — Linear programming, interpolation and splines

The fourth Solve domain on the 2026-10 arc (`docs/SCOPE-LP-SPLINES.md`).

The audit probed 104 curriculum inputs: 0 answered. No LP, interpolation or
spline engine existed; `optimize.ts`'s "simplex" is Nelder–Mead. The worst
classes: the Lagrange-multipliers verb stole every `maximize … subject to`
line and returned an EMPTY result; the solver took `at x = 1.5` inside an
interpolation request and answered "x = 3/2"; the paste fold rewrote `3x1 +
2x2` as `3x^1 + 2x^2`; `standard form of … <= 4, … >= -2` printed "x ∈
refused". An "Optimisation & interpolation" palette group beside Multivariable.

### Added
- **Point lists** (`src/lib/pointList.ts`), one reader for every shape a
  human types: `(1, 2), (2, 3)`, `(1,2) (2,3)`, `x: 0, 1, 2; y: 1, 3, 2`,
  `x = …; y = …`, `x 1 2 4 y 2 3 7`, `f(2) = 4, f(3) = 9`, a pasted two-column
  table, and `f(x) = 1/x at x = 1, 2, 4` (sampled exactly through the CAS or
  refused). Coordinates are exact rationals (`0.1` is 1/10); a repeated x with
  two y's is refused naming both; identical duplicates are dropped and said;
  unsorted points are sorted and said.
- **Interpolation** (`src/lib/interpolate.ts`): the polynomial through the
  points by the Vandermonde solve, cross-checked coefficient by coefficient
  against the Lagrange basis products AND Newton's divided differences as
  exact rationals (refused on disagreement), p(xᵢ) = yᵢ verified; the Newton
  table and nested form; Lagrange basis lines on `using lagrange`; Neville's
  tableau at a query point (its value checked against p(v)); `at x = 3` exact
  and ≈ 6 s.f.; "degree 2, not 3" when the leading coefficient vanishes;
  linear interpolation with the proportion line; the error bound
  |f − p| ≤ M/(n+1)!·max|Π(x − xᵢ)| with M stated and the product's maximum
  exact when its critical points are rational. ≤ 12 points (Runge; splines
  suggested by name). A FIT (`least squares`, `regression`, `best fit`
  without `through`) is refused by name — it is a different thing — with the
  pointer to Sketch data → function and Stats regression; `fit … through`
  interpolates and says so. Figure: the curve through the points, the query
  point marked.
- **Splines** (`src/lib/spline.ts`): natural (the default, SAID every time:
  "natural" is a choice, not a property of the data), clamped (`with S'(0) =
  1, S'(2) = -1`, `with end slopes 0 and 0`), not-a-knot (4 points = the
  interpolating cubic, said and cross-checked against the interpolation
  engine), linear, and PCHIP (Fritsch–Carlson slopes, the MATLAB end formula
  named). The M-form tridiagonal system is solved over exact rationals; one
  math line per piece in Solve grammar with its interval; S, S′, S″ agree
  from both sides at every interior knot EXACTLY, end conditions exact,
  S(xᵢ) = yᵢ — all verified before anything prints. `at x = 0.5` exact and ≈.
  Two knots → the chord; quadratic splines, repeated x, > 50 knots, 2-D
  splines refused by name. Figure: each piece sampled on ITS interval only
  (a piece drawn across the whole window would look smooth and be wrong),
  knots marked, clamped end tangents drawn, the query point marked.
- **Linear programming** (`src/lib/lp.ts`, `lpFigure.ts`, `lpWords.ts`): an
  EXACT two-phase tableau simplex over rationals with Bland's rule (pivot cap
  500 → a refusal, never a partial answer); the standard form with slacks;
  the optimum as math lines; the constraint table (value, bound, slack,
  binding); shadow prices, reduced costs, objective and right-hand-side
  ranging for the optimal basis (withheld by name at a degenerate vertex,
  where they are not unique); alternative optima detected from a zero
  reduced cost and shown as the edge between two vertices; the unbounded ray
  from the entering column; infeasibility from the phase-1 optimum with the
  contradicting constraints named (≤ 3 rows). Verified before anything
  prints: every constraint re-evaluated at x* exactly, dual feasibility,
  complementary slackness, strong duality cᵀx* = bᵀy* — and for two
  variables an independent exact vertex enumeration that must agree.
  Grammar: `maximize/minimize … subject to | s.t. | st | such that | given |
  with`, constraints separated by `,` / `;` / newline at depth 0, `x, y >= 0`
  expanded, `with x, y nonnegative`, `x and y integer`, `=<`/`=>`/`≦`/`≧`
  normalised first, `maximize z = …` / `Maximize P = …` (the name kept),
  `$30` stripped and reported, `3x1` and `x_1` (both in one problem is
  said), `not linear: x*y` by name. Nouns: `dual of` (the dual LP written in
  Solve grammar and both solved, z* = w*), `standard form of` (conversion
  only, free variables split, min → −max, then STOP), `simplex tableau`
  (initial and final, exact), `graphically solve` (2 variables, refuses 3+
  by name), `shadow prices for` / `sensitivity analysis` / `reduced costs
  for` (the noun leads). Integer: the LP relaxation always printed and
  labelled, exact branch-and-bound when ≤ 4 variables and ≤ 50 nodes with
  the tree summarised, else "LP relaxation only" by name. Non-negativity NOT
  stated: solved as typed; if that is unbounded, ALSO solved with x ≥ 0 and
  both printed, labelled — never silently added, never silently dropped.
  Limits ≤ 12 variables / ≤ 20 constraints (a 12 × 20 exact LP runs in
  30 ms). One prose template, products × resources (every clause the
  template did not read is refused naming the clause); transportation,
  assignment, diet and blending in prose refused by name with the typed LP
  shown. Figure: the feasible region clipped from the half-planes and
  shaded, each constraint line labelled, the dashed objective contour
  through x* with its direction arrow, x* labelled; the alternative-optima
  edge; the unbounded ray; "feasible region: empty"; bars of x* and the
  slacks for 3+ variables.
- Pane: the three verbs are tried FIRST in the equation verb chain and
  guard the prose switches; a point list that names an interpolant or a
  spline switches the Geometry kind to the Equation kind instead of reading
  it as a polygon; `at x = 1.5` is a query, never an equation; a new
  `lp: true` paste-fold option keeps `3x1 + 2x2` raw and keeps the objective
  line that has no comparator; the inequality block never prints the
  internal "refused" sentinel as an answer. Figure corpus +4 (floor 183).

### Honest limits
- LP: ≤ 12 variables, ≤ 20 constraints; branch-and-bound ≤ 4 variables /
  50 nodes; sensitivity ranges only at a nondegenerate vertex (said);
  exactly one prose template; literals over 15 significant digits refused
  by name (the parser reads doubles); `pi` refused as a coefficient.
- Interpolation ≤ 12 points; the error bound's M is exact only when the
  (n+1)-th derivative is monotone on the node interval, else "by sampling,
  not a proof"; a derivative unbounded on the interval (√x at 0) refuses.
- Splines ≤ 50 knots; no quadratic, no 2-D/parametric, no B-spline bases
  (refused by name).

### Adversarial pass — independent reviewer (6 defects + cosmetics, all closed)
The reviewer's own oracles found NOTHING wrong in the numbers: 250 random
LPs against exhaustive vertex enumeration (optimum, status, unique /
alternative / degenerate labels, shadow-price signs by sense, complementary
slackness, strong duality in both senses), ranging by perturbation inside
and outside the printed ranges on 114 problems, branch-and-bound against
lattice brute force on 60, 120 random interpolants and 130 random splines
with every PRINTED piece re-parsed and checked at interior points, 6,595
math lines re-parsed. What it did find was in the presentation and the
grammar — the class a green engine suite cannot see:
- **The dual vector printed in the wrong order** whenever a right-hand side
  was 0 or an equality row appeared: `dual of maximize 3x + 2y subject to
  x - y <= 0, x + y <= 4, …` printed u = 5/2, v = 1/2 while its own
  shadow-price line said 1/2 and 5/2 — the dual text's objective omitted
  the zero term, the re-parse ordered names by first appearance, and the
  solution was printed by position. Strong duality cannot catch a
  permutation (the value is unchanged), and the mismatch also fired a
  spurious "the dual has alternative optima". 14 of 40 random `dual of`
  runs hit it. The solution is now mapped back by NAME and the dual
  objective carries every variable.
- A 3-constraint dual named its third variable `w` and its objective `w`,
  printing `w = 0` and `w = 10` as two math lines.
- **A trailing word became a free variable and flipped the verdict**:
  `… x, y >= 0 graphically` (also `please`, `using the simplex method`,
  `What is the maximum?`) read `graphically` as a third, free, zero-column
  variable and reported "optimal, not unique — the optimal set is
  unbounded" for a problem with a unique optimum. Trailing instructions
  are stripped; a bare unknown word is refused by name, never invented.
- **A symbolic query point was silently dropped**: `interpolate … at x =
  pi` printed the polynomial and no p(π); `at x = 1.5 and x = 2.5` answered
  only the first. Every query point now gets a line, exact through the CAS
  where it can, refused by name where it cannot.
- Routing steals: `standard form of x^2 + 6x + 2 = 0`, `graphically solve
  x^2 - 4 = 0`, `sensitivity 0.9, specificity 0.8, prevalence 0.01` and
  `dual numbers (1 + 2e)(3 + e)` were claimed by the LP nouns and refused;
  `line through (1,2) with slope 3` was claimed by interpolation and refused
  as "one point". A noun with no objective after it, and `through` with one
  point and a slope clause, now stand aside.
- Grammar gaps closed: `where/with/for x, y >= 0`, a parenthetical `(x and
  y are integers)`, `maximize 3x + 2y = z`, `max …: constraints`, `Use the
  simplex method to maximize …`, `z = 3x + 2y, maximize z subject to …`.
- Cosmetics: an empty list in the phase-1 caveat; `ln(e)*exp(x)` in an
  error-bound derivative; a sum without parentheses in the bound's text
  line; the bound's math line now carries the exact form (√3/216) or the ≈;
  M = e² stated exactly for exp (monotone on the interval — an endpoint is
  a proof) rather than "by sampling".

### Maintenance riding along
- **Install packs renamed** `jurislab-windows.zip` / `jurislab-mac.zip` (were
  `formula-inserter-*`; open item §14). `scripts/package.ps1`, the manual's
  download links, `DISTRIBUTION.md`, `install/README.md` and both pack tests
  follow. The `formula-inserter:*` content-control prefixes are NOT renamed —
  they identify content in documents users have already saved. Old download
  links to the previous filenames no longer resolve; installed copies are
  unaffected (the pane updates from Pages).
- **PubChem fixture refreshed** (`--refresh`, first since 2026-07-15). Four
  entries moved upstream; one is a real drift: PubChem's match for the bare
  name "vitamin E" is now d-alpha-tocopherol CALCIUM SUCCINATE (CID 69540411,
  C33H54CaO6), a salt of the vitamer. Ours stays alpha-tocopherol (C29H50O2),
  recorded as a reviewed exception pinned to our SMILES in both the gate and
  the verify script. Same lesson as folate: the refresh is never automatic.
- **`molgraph.ts` has a direct adversarial suite** (open item §3) — the
  structure-detection layer behind NMR, IR, UV-Vis, MS fragmentation, 2-D NMR
  and pKa was tested only transitively. 176 tests, every claimed atom index
  re-verified on OpenChemLib primitives. It found seven defects; five fixed:
  - **Every carboxylate was an "ester"** (acetate, benzoate, the glycine
    zwitterion in the dictionary): the acid/ester split read the O–H count
    and was charge-blind. New carbonyl kind `carboxylate`: IR gives the
    COO⁻ asymmetric 1550–1610 and symmetric 1400–1450 cm⁻¹ stretches and NO
    C=O band (Silverstein; Pretsch); ¹³C ≈ 182 ppm (BMRB acetate, TMS scale);
    MS fragmentation skips the ester rules; UV-Vis refuses the conjugated
    carboxylate by name (no base value); pKa never offers it an acid pKa.
  - **Charged substituents got the wrong SIGN**: phenoxide read as OR,
    anilinium as NH₂, trimethylanilinium as NR₂ (a withdrawing cation given
    the strongest donating increment). New keys O⁻ / NH₃⁺ / NR₃⁺ / COO⁻; where
    no Pretsch/Silverstein increment exists the predictors now NAME the group
    as omitted rather than apply the neutral one. Hammett σ added only where
    two sources agree (NR₃⁺, COO⁻); O⁻ and NH₃⁺ excluded by name.
  - An imine/amidine carbon was "alkyl"; a nitrile oxide was an isocyanide
    (partner element never checked); `distancesFrom` wrote past its array on
    an out-of-range start.
  - Documented, not changed: typing `CO` means carbon monoxide (the formula
    table runs first); diastereotopic methyls share one symmetry class.
- `docs/OPEN-ITEMS.md` re-verified against the code; shipped items struck,
  on-hold items marked.

## [2.131.0] — 2026-10-14 — Probability and Markov chains

The third Solve domain on the 2026-10 arc (`docs/SCOPE-PROBABILITY-MARKOV.md`).
The audit probed 73 curriculum inputs: 0 answered, 15 answered WRONG (the
solver took "poisson lambda = 2.5 P(X = 0)" and replied "lambda = 5/2"; the
stats intent gave "uniform on (0, 10) variance" the SAMPLE variance of the
two parameters, 50), 57 refused. A "Probability" palette group beside
Transforms.

### Added
- **Distribution kernel** (`src/lib/probdist.ts`): binomial, Bernoulli,
  Poisson, geometric (trials by default, `failures` switches — said every
  time), negative binomial, hypergeometric, discrete uniform, normal, t,
  chi-square, F, exponential (rate; `mean` accepted), uniform, gamma (shape
  and rate; `scale` accepted), beta — pmf/pdf, cdf, quantile, mean, variance,
  mode, median, mgf. Numerics REUSED, not re-derived: erf/normalCdf and the
  regularised incomplete gamma (stats2.ts, now exported), incompleteBeta
  (stats.ts), tCdf/fCdf and the bisection quantile (power.ts, exported),
  probit polished by Newton's method (≈1e-15), BigInt binomial coefficients,
  the exact rationals of cas.ts. Every discrete distribution with rational
  parameters has an EXACT path (fractions) beside the float path.
- **Probability verbs** (`src/lib/probability.ts`, tried first in the
  equation kind's verb chain): `<distribution> <parameters> P(X ≤ k)` /
  `P(a < X < b)` / `at least k` / `mean and variance` / `mgf` / `pmf` / `cdf
  at k` / `quantile p`; named, positional and prose parameters; `quantile
  normal 0.975`, `invNorm`, `z-score for`, `critical value … alpha …`
  (two-sided on request), `cdf of normal at z`, `P(-1.96 < Z < 1.96)`; the
  normal shows z and names Φ. **Every value is cross-checked by a route
  sharing no code** — the exact fraction against the float sum, the cdf
  against Simpson's rule over the pdf, a tail against its complement — and
  WITHHELD on disagreement. Figures: the pmf with the event's bars filled,
  the pdf with the tail shaded (the plotter now takes `shadeBetween` from a
  verb, and the pane renders a verb's own SVG).
- **Bayes and conditional probability**, exact: `bayes P(A)=0.01, P(B|A)=0.9,
  P(B|not A)=0.05, P(A|B)` → 2/13 with P(B) by total probability and the
  probability tree; `P(A and B) = 0.2, P(B) = 0.5, P(A|B)` → 2/5; several
  hypotheses; `¬A`, `not A`, `A'`, `A^c`. **Independence is never assumed**:
  P(A) and P(B) alone are refused by name. Inconsistent inputs (a joint
  above its marginal, priors not summing to 1) are refused with the numbers.
- **Expected values** of listed outcomes (`E[X] for X = 1, 2, 3 with p =
  0.2, 0.3, 0.5` → 23/10; `variance of [1,2,3,4,5,6] equally likely` →
  35/12; `expected value of a fair die` → 7/2), POPULATION moments and said
  so, cross-checked by E[X²] − E[X]².
- **The classic prose problems**, exactly: at least one six in n rolls, two
  dice sums and doubles, coin flips (fair or `p = …`), urns with and without
  replacement, the birthday problem. Outside the templates: refused BY NAME
  with the templates listed — nothing is guessed.
- **CLT** (`clt n = 30 mean 50 sd 10 P(xbar > 52)`) and **confidence
  intervals for the mean**: the z-interval and the t-interval are BOTH shown
  unless the wording says `sigma` or `sample sd`; the choice is explained.
- **Normal approximation to the binomial** only as an explicit verb, with the
  continuity correction written out and the exact binomial beside it.
- **Markov chains** (`src/lib/markov.ts`): `[[…]]`, `;`-rows or line rows,
  entries read as EXACT rationals (0.1 is 1/10); stationary distribution by
  rational rref on πP = π, Σπ = 1; classification by strongly connected
  components (irreducible / closed and transient classes / period by the
  gcd rule); the limit distribution declared only when irreducible AND
  aperiodic (`[[0,1],[1,0]]`: period 2, "NO limit distribution", by name); a
  reducible chain with one closed class gets its unique π with zeros on the
  transient states, with several closed classes the per-class distributions
  and "no single π"; `after k steps from (…)` by exact repeated squaring
  (k ≤ 200), cross-checked against k successive multiplications; absorbing
  chains with N = (I − Q)⁻¹, expected steps t = N·1 and absorption
  probabilities B = N·R, exact, verified by (I − Q)·N = I; the state diagram
  (self-loops, labelled edges) through the graph figure. A row that does not
  sum to 1 is refused with the sum shown, never rounded; ≤ 12 states.
- Pane: `PROB_VERB_RE`/`MARKOV_VERB_RE` make the prose switches, the stats
  intent and the solver stand aside; the "Greek letters read as variables"
  paste note is suppressed under a probability verb (λ is the parameter).

### Honest limits
- Exact fractions are shown while they print in ≤ 40 characters; otherwise
  the correctly rounded decimal, labelled "≈".
- Continuous quantiles outside the normal/uniform/exponential closed forms
  are bisection to 1e-9 and say so. No proportion confidence interval yet.
- Markov: no hitting or first-passage times between arbitrary states (expected return times are given), no continuous-time
  chains; questions outside stationary / n-step / absorbing / classification
  are refused by name.

### Adversarial pass — independent reviewer (15 defects + cosmetics, all closed)
- **Wrong as exact**: a discrete `P(X ≤ k)` over a range wider than 2,000
  points fell into the infinite-tail branch and returned `1` with a vacuous
  "verified" (`poisson λ = 10⁶ P(X ≤ 10⁶)` → 1; true 0.500266). Wide ranges
  now go by the cdf with a capped floating-point pmf sum as the independent
  check (up to 2·10⁶ terms, else refused by name) — which then exposed the
  incomplete-gamma routine of stats2.ts running out of iterations at
  a = 10⁶ (its caps were 200/300; now 200,000, loops still break on
  convergence).
- **Hangs**: the exact BigInt sum of 2,001 fractions over 5^10000 ran 90 s;
  the tail cross-check looped to a user-chosen k (`P(X > 10⁷)`, two
  minutes). Exact sums are limited to short ranges of small supports; the
  check sums are capped.
- **Wrong numbers**: a biased coin asked about TAILS used P(heads) (p = 0.3,
  "at least 2 tails" → 0.472; true 0.969); the negative binomial ignored
  `failures`; the binomial mode put 11 outside the support at p = 1 and
  missed the exact tie at (n+1)p = 7 because the float test saw
  7.000000000000001 (the tie is now tested on the rational); a confidence
  level written `0.99` was dropped for 95 %.
- **Precision claims**: the normal quantile said "≈ 1e-15" on a 1e-7
  Chebyshev erf (the median came out 3.8·10⁻⁸). A precise erf (Taylor series
  below 2.5, Lentz continued fraction beyond) now backs the normal cdf and
  the Newton polish. Simpson's rule over a singular pdf (χ²(1), gamma shape
  < 1, beta ½,½) missed by 1e-2 and the correct cdf was refused as a "failed
  cross-check": tanh-sinh quadrature replaces it (1e-12 on x^(−½)).
- **Mislabelled**: Markov vectors whose fractions were too long were shown
  as decimals in the "exact" slot; they are now "≈ (…)" with the reason
  said. `N(100, 15^2)` read 225 as the sd; `^2` is now a variance and
  `N(100, 15)` says it read an sd.
- **Different question answered**: Markov hitting times, first-passage
  times and `P(X_n = j | X_0 = i)` were answered with the stationary
  distribution — refused by name now; expected return time is answered
  (1/π). A second `P(…)` on the same line was silently dropped — both are
  answered. `clt … P(48 < xbar < 52)` returned no probability.
- **Dead or missing syntax**: `z 0.975`, rows on lines for a matrix,
  `two-sided` critical values (the stray-word guard rejected the word),
  `binomial(n=10,p=0.4)`, the question-first form `P(X = 3) for binomial
  n = 10, p = 0.4` (the brief's own routing example), the proportion
  interval, `P(not A|B)` (= 11/13), `after three steps`, `P^3`.
- **Guard steals**: `t 5`, `t(1) = 5`, `f(2) = 3`, `E[X] = 3`, `gamma(5)`,
  `beta(2)`, `P(x) = x^2 + 1`, `draw y = x^2`, `roll 2x + 3 = 7`, `steady
  state concentration` were answered or refused by the probability verbs
  and never reached the solver. A bare name followed by `=` or by prose, a
  bare number in `E[X] =`, a single-argument `gamma(…)`, an unreadable
  `P(…) = …` value and a Markov line without a matrix all return null now.
- Cosmetics: `mode = 0.303030303030303` → `≈ 0.30303`; `P(X = 0) = ≈`;
  discrete medians are exact; the uniform mgf no longer prints `exp(0*t)`;
  the exponential "write mean 2" note is dropped when the user wrote it.

## [2.130.0] — 2026-10-14 — Multivariable calculus

The second Solve domain on the 2026-10 arc (`docs/SCOPE-LAPLACE-MULTIVAR.md`
§C). Calculus III, in the equation kind, as verbs — and a "Multivariable"
palette group beside Transforms so nothing has to be remembered.

### Added
- **Multivariable calculus** (`src/lib/multivar.ts`, one `tryMultivar` entry
  tried before the transforms): `gradient f [at (p)] [in x, y]`,
  `directional derivative f at (p) in direction (v)`, `hessian f` (with det H),
  `jacobian (f1, f2, …)` (matrix and determinant; a non-square one says so),
  `critical points f`, `lagrange f subject to g = c` (also
  maximize/minimize/optimize), `double integral f over x from a to b, y from
  c to d`, `triple integral …`, `divergence (P, Q[, R])`, `curl` (2-D scalar
  or 3-D vector), `potential (P, Q[, R])`, `line integral F from (a) to (b)`.
- **Every partial derivative is checked by central differences** at three
  points before it is shown; `|∇f|` is exact with its square factors pulled
  out (`2*sqrt(14)`, never `sqrt(56)` or 7.483), which the exact simplifier
  now does for every sqrt of a rational (`sqrt(1/2)` → `sqrt(2)/2`).
- **Critical points by exact elimination**: a gradient component in ONE
  variable is solved exactly and substituted; a component linear in a
  variable is substituted the other way. Every point is verified by
  substituting it into ∇f, then classified by the second-derivative test
  (D in two variables, Hessian eigenvalues above) — saddle points named,
  INCONCLUSIVE said when D = 0 (`x^4 + y^4`). Roots the polynomial solver
  returns numerically (degree ≥ 3) are snapped to a closed form ONLY when
  substituting that form back makes the component exactly 0, so `(1, 1)` is
  `(1, 1)`, not `(1.0000000000, 0.99999999997) (numeric)`. The multi-start
  numerical solver is the fallback, and says its list may be incomplete.
- **Lagrange multipliers**: ∇f = λ∇g with g = c; candidates from the
  numerical solver are snapped to closed forms under the same exact check
  (the unit-circle maximum of xy is `1/2 at (sqrt(2)/2, sqrt(2)/2)`); a
  maximum and minimum are DECLARED only when the constraint set is provably
  bounded (a sum of positive squares equal to a positive constant), and
  otherwise the candidates are listed with "boundedness was not established".
- **Iterated integrals**: inner integral first through the symbolic
  integrator, exact where it can (`1/3`), numerical with a stated caveat
  where it cannot (`exp(-x^2)` → ≈ 0.7468); bounds may depend on OUTER
  variables only, and the order rule is explained when they do not.
- **Vector fields**: `potential` returns φ with ∇φ = F (verified) or refuses
  with the curl shown; `line integral` is evaluated as φ(b) − φ(a) for
  conservative fields and **refused by name as PATH-dependent** otherwise.
- Paste notes for `∂` and `∇` now name the verb to type instead of sending
  the user to the Differentiate kind.

### Honest limits
- `3xy` is ONE variable named xy in this grammar (as `theta` is one name) and
  is refused by name with the fix spelled out, rather than silently split.
- A whole curve of critical points (`x^2 y^2`) is not enumerated; the engine
  refuses rather than list one point of it as isolated.
- One constraint only; a constraint with no real points is refused by name.
- Nothing is optimised over a parameter: a letter in f that is not a
  coordinate (x, y, z, u, v, w) and not in the constraint is refused.

### Adversarial pass — the author's second probe (6 defects behind a green audit)
- A circle of degenerate critical points, `(x^2 + y^2 - 1)^2`, came back as
  FORTY "saddle points" with D ≈ −1e-8: the second-derivative test used an
  absolute 1e-12 zero test on a floating-point root whose coordinates carry
  the solver's localisation error. A numeric D is now zero below 1e-6 of
  the Hessian's scale squared; degenerate numerical roots are dropped and
  said so, and if nothing else remains the verb refuses rather than list a
  sample of a continuum.
- `x^2 y^2` (every point of both axes is critical) was reported as two
  "points"; a coordinate hyperplane on which ∇f vanishes identically is
  now refused by name. A dependent linear gradient (`x^2 + y^2 + z^2 -
  2xy`) refused without a reason; it now names the solution set.
- `sin(x) + cos(y)` was "solved by exact elimination" with four points and no
  caveat — a periodic function has infinitely many. Completeness is now
  claimed only when every eliminated equation is a polynomial; otherwise
  the header says the roots came from the solver's search range and a
  caveat says NOT complete. Numeric critical points are snapped to π
  multiples (`(pi/2, pi/2)`), sorted nearest the origin, with a periodicity
  caveat for trigonometric gradients, and f and D at a numeric point are
  evaluated (no more `f = sin(7.853981634)^2`).
- An empty constraint set (`x^2 + y^2 = -1`) was refused without a reason.

### Adversarial pass — independent reviewer (~290 probes, 20 items, all closed)
- **HANG**: `iterated integral … w from 0 to 1` with four bounds ran 400⁴
  midpoint evaluations. Three bounds at most, refused by name.
- **CRASH**: a parameter in an integrand (`double integral a x y …`) threw
  an uncaught "Unknown variable" from the numerical cross-check. Parameters
  are now carried symbolically (`= a/4`) and the cross-check substitutes a
  stated value for each; `dx dy` are refused as differentials.
- **Wrong answers with a "Verified" caveat**: vector-field coordinates were
  chosen by SORTING the letters, so `divergence (a x, b y)` gave `x + y`,
  `curl (0, 0, B)` printed `(curl F)_undefined`, and `potential (k x, k y)`
  was refused as "not conservative". The coordinates are x, y[, z] always;
  other letters are constants, named in a caveat.
- **Divergent integrals shown as exact finite values** — `1/x` over (−1, 1)
  "= 0, Exact", `tan(x)` over (0, π), `1/(1−x)` over (0, 2): the midpoint
  rule never samples the pole and the antisymmetric sum cancels. A
  structural check now collects every denominator, logarithm and even-root
  argument of the integrand and sweeps them along the innermost variable:
  a sign change or zero of a denominator, a non-positive log argument or a
  negative root argument inside the region refuses the integral as
  improper, by name and location. An endpoint singularity (`1/sqrt(x)` at
  0, integrable, = 2) is judged by whether the quadrature error shrinks
  with resolution; a divergent one (`1/x` over (0, 1), once "≈ 7.95") fails
  that convergence test and is refused. A non-finite antiderivative at a
  boundary says DIVERGES.
- Line integrals: `(1/x, 1/y)` from (−1,−1) to (1,1) returned 0 although
  every path crosses an axis where the field is non-integrable; now φ must
  be finite at both end points and F finite along the straight segment, or
  the verb refuses (the value then depends on how the path goes round the
  singularity).
- Values at undefined points: `gradient x/y at (1, 0)` printed `(1/0,
  −1/0)`; `gradient sqrt(x) + y at (−1, 0)` fabricated `|∇f| = sqrt(3)/2`
  from (1/(2√−1))² = −1/4; `abs(x)` at 0 folded x/|x| to 0. Any non-finite
  f, partial or Hessian entry at the point now refuses by name. An
  overflowing direction (`(1e200, 1e200)` → `2e+200/sqrt(Infinity)`, the one
  display-contract violation found) is refused.
- Decimals labelled exact: a bound of `e` folded `exp(2)/2` to
  3.69452804947 "Exact"; `e^x` differentiated to `ln(e)·exp(x)`. A folded
  decimal is now shown as "≈ … (numeric)" and ln(e) folds to 1. Numeric
  integrals are shown to five figures with a four-figure caveat (π/2 came
  back as 1.5708572 to eight).
- Lagrange: f constant on the candidates (`x^2 + y^2` on the unit circle)
  was reported as a distinct maximum 1.00000000117 and minimum
  0.999999999184; a constant f listed 40 points; a parameter in f (`a x +
  y`) was silently solved as a coordinate. Now: one value "at every
  candidate found" with no max/min, constant f refused, parameters refused
  by name, ties stated in the verdict line, list capped.
- `2xy` alone (y never standing alone) gave `∇f = (2)`: the fused-name
  guard now fires whenever every letter is a coordinate letter. `grad
  school applications` and `del key` produced gradients; multi-letter
  non-Greek names make the verb stand aside. Underflow "roots" far out
  under exp(−r²) were dropped with the wrong reason (curve); they are now
  discarded as flat regions. `x^4 + y^4 + z^4` was refused as a curve; its
  isolated minimum is reported INCONCLUSIVE.

### Adversarial pass — second independent pass (336 probes): 19 of 20 confirmed closed, 11 new items, all closed
- **A pole in the OUTER integration variable slipped through**: `1/(y − 0.3)`
  over the unit square came back "= ln(7/10) − ln(−3/10), Exact" because the
  sign tracker reset for every inner sweep. The region is connected, so one
  tracker now runs over the whole sweep (two samples anywhere with a
  denominator of opposite sign bracket a zero inside); the base of an even
  power and each factor of a product are tracked too (`1/(y − 0.3)²`).
- **`exp(−x²) + y²` reported "no critical points"** (the origin is a saddle):
  the transcendental root scan missed x = 0 in `−2x·e^{−x²} = 0`. A product's
  roots are now the union of its factors' roots, with exp dropped (never
  zero); an EMPTY non-polynomial root list no longer counts as "none" and
  falls through to the numerical solver.
- `sin(x)² + y²` took 13 s and listed x ≈ 1000π first: the eliminator's
  non-polynomial root list is capped at the twelve nearest the origin before
  any exact work, and every path sorts nearest-first.
- Regressions from the first-pass guards, reverted with care: subscripted
  names (`x_1`, `k_B`) were treated as prose; symbolic end points and
  parameters in a line integral (`from (a, b) to (c, d)`, `(a x, a y)`) and
  symbolic directions (`(a, b)`, `(cos t, sin t)`) were refused — the
  finiteness checks now give parameters stand-in values and the answers
  stay symbolic. `xyz` is a fused name, not prose.
- A field written in other coordinate letters (`divergence (u, v)`,
  `(r cos θ, r sin θ)`) answered 0; it is refused by name. Constant fields
  `(a, b)`, `(0, 0, B)` still work.
- An exact D of 4·10⁻¹⁶ was called zero (absolute 1e-12); exact points now
  use an exact zero test. Parameters in `critical points` and in a Lagrange
  CONSTRAINT are refused by name like those in f.
- Numeric integrals without a closed form are now computed at three
  resolutions, extrapolated (Aitken), and shown to the digits the estimated
  error allows — `1/√(x² + y²)` to three, `exp(−x²)` to seven; too slow a
  convergence (an integrable endpoint singularity with no antiderivative,
  `1/√(1 − x²)`) is refused with the extrapolated value and an honest
  reason. The exact path accepts an endpoint singularity when the quadrature
  error shrinks toward the exact value (`1/√x` over the unit cube = 2).
- `sqrt(2)³` and `exp(a)²` now fold, so the ±√2/2 extrema of
  `x y e^{−x²−y²}` are exact; `abs(2)` and `ln(1)` fold too.
- Still open, honestly: `1/((x − 0.3)² + 10⁻⁸)` (a near-pole) is refused for
  quadrature disagreement although the exact value is right; cosmetic
  unsimplified forms (`r cos²θ + r sin²θ`, `1^(1 − 1)`); some ordinary
  Lagrange problems (`x y` on `x² − y² = 1`, `= π`) still "could not be
  solved here".

## [2.129.0] — 2026-10-13 — Laplace transforms, initial-value problems and Fourier series

The first of the Solve domains on the 2026-10 arc (`docs/SCOPE-LAPLACE-MULTIVAR.md`).
Every second-year engineering course lives on these, and the product had none.

### Added
- **Laplace transforms** (`src/lib/laplace.ts`, verbs `laplace …` and
  `inverse laplace …` in the equation kind). Forward: a table applied honestly
  — tⁿ·e^{at}·{1, sin, cos, sinh, cosh}·u(t−d), with tⁿ handled by the rule
  tⁿf ↦ (−d/ds)ⁿF differentiated SYMBOLICALLY in s, trig squares and products
  reduced by the double-angle and product-to-sum identities, phases expanded,
  the unit step by the second shift theorem and the impulse by sifting. The
  region of convergence is stated. Anything outside the table — 1/t, ln t,
  exp(t²), sin·sinh — is refused by name. Inverse: partial fractions (the
  casint machinery), linear factors of any power, irreducible quadratics
  completed to (s−p)²+ω² with powers 1 and 2, an irrational ω kept as sqrt
  with its square factors pulled out (1/(s³+1) carries √3, never 1.732), a
  constant polynomial part as δ(t), e^{−ds} delays as g(t−d)·u(t−d).
- **Every transform is cross-checked by a route that shares no code with the
  table**: the defining integral ∫₀^T e^{−st}f dt, integrated numerically
  with the panels split at a step's jump, at three s inside the region; an
  inverse is additionally transformed forward again and compared exactly or
  at five sample s. A result that fails is withheld, not caveated.
- **Initial-value problems** (ODE kind): `y'' + 4y = sin(t), y(0) = 0,
  y'(0) = 0` is solved by transform — Y(s) assembled from a(s²Y − s·y(0) −
  y'(0)) + b(sY − y(0)) + cY = G(s), inverted, and VERIFIED by substituting
  y into the original equation at sample points plus the initial conditions
  (piecewise when the solution carries a step, since u′ = δ has no rule to
  differentiate through). The single solution is drawn. Constant rational
  coefficients, order ≤ 2, forcing in the table; conditions at t = 0 only.
- **Fourier series** (`src/lib/fourier.ts`, verb `fourier series f on (a, b)`,
  pieces separated by `;`, abs(linear) split for you). Coefficients exact and
  symbolic in n for polynomial pieces (tabular integration by parts), exp(ct)
  pieces, and sinusoids at a harmonic (orthogonality — so `cos(t)` is its own
  series with no 0/0). At the period's ends sin(nπm) = 0 and cos(nπm) =
  (−1)^{nm} are substituted BEFORE anything is simplified, and π is kept as a
  symbol throughout, so a₀/2 = π²/3 and aₙ = 4(−1)ⁿ/n², not 0.2122·π³ (the
  canonical simplifier folds a bare π to a float: the first version printed
  exactly that). Where a piece boundary is not a whole multiple of the
  half-period, the first five coefficients are given exactly one by one and
  the result says why. Verified against numerical integration for n = 0..5;
  the partial sum S₅ is drawn over f, and the caveats name every jump, the
  midpoint convergence and the Gibbs overshoot.
- `u(t−d)` / `heaviside` / `step` and `delta(t−d)` are functions now. A bare
  `u`, `delta`, `step` or `heaviside` stays a variable (`u + v = 1` still
  solves in u and v; a pasted δ is still a deflection); only the bracketed
  form is the function.

### Found by the independent adversarial pass (none by the author's own tests)
- **A frozen pane on `laplace t^10`.** tⁿ was transformed by differentiating
  F n times with no simplification between steps, so the tree doubled each
  time: t^8 took 16 s, t^10 never returned, and `t^7 exp(-t)` came back as a
  4,313-character degree-120 rational, "verified". Plain tⁿe^{at} now uses
  the closed form n!/(s−a)^{n+1}; tⁿ·trig differentiates with simplification
  between steps; powers above 12 are refused by name.
- **A dropped factor hidden by the impulse** (class A). Reducing a triple trig
  product removed EVERY sine, not the two being combined; without δ the
  numeric check withheld the result, with δ the check is skipped and
  `sin(t) sin(2t) sin(3t) delta(t-1)` showed 0.128·e^{−s} for 0.108·e^{−s}.
  Factors are now removed by identity.
- `laplace 10`, `laplace 1 + t`, `laplace 1 - exp(-t)` were read as INVERSE
  transforms (the pattern matched "laplace" + "1"). The inverse now needs its
  marker: inverse laplace, laplace^-1, L^-1, ℒ⁻¹.
- **Decimals in "exact" results.** The canonical simplifier folds every
  function of a constant to floating point, so `sin(2t+1)` carried 0.8414 for
  cos 1, `u(t-pi) sin(t)` carried 3141592653589793/10¹⁵ and 1.22e-16 for
  sin π, `inverse laplace sqrt(2)/(s^2+2)` printed 14142135623730952/10¹⁶,
  `cos(sqrt(2) t)` printed 1.5625e+30·s/(…). New `src/lib/exact.ts`:
  functions of constants are masked behind atoms around the simplifier and
  restored after, sin/cos/tan of rational multiples of π are folded to their
  exact values first, and π stays π. Fourier's exp pieces keep e too.
- Fourier refused `(0, 2π)` — the commonest textbook period — because 0 is
  not "a multiple of π"; it is now. Pieces with a π coefficient (`pi*t`,
  `t/pi`) are read through a symbolic Taylor expansion instead of the
  rational-only polynomial reader.
- Impulse forcing `y'' + y = delta(t-1)` crashed (differentiating the
  equation's coefficients ran into δ, which has no rule) — a function of
  something free of the variable now differentiates to 0 without consulting
  the rule table. A pulse forcing `u(t-1) - u(t-2)` was refused because the
  inverse split sums only at the top level; sums over a common denominator
  are distributed first. ℒ⁻¹{1} = δ(t), ℒ⁻¹{5} = 5δ(t), ℒ⁻¹{e^{−2s}} =
  δ(t−2) invert now (a constant denominator had no decomposition).
- Correct transforms were withheld by a weak numeric check: a fixed 2000-panel
  window missed `sin(377t)`, overflowed on `exp(100t)`·e^{−st} evaluated as
  ∞·0, and ended before t^8's tail. The damping is now folded into every
  exponential before evaluation, the window and panel count follow the
  function's own power and frequency, and the four sample points sit off the
  integers.
- `inverse laplace 1/(s(s+1))` — "Unknown function s" — now says to write
  s*(s+1). `delta`, `step`, `heaviside` are variables again when bare;
  `u(x) = x^2` is read as a definition. `y''(t) + y(t) = 0` is read;
  duplicate initial conditions are refused; a surplus y'(0) on a first-order
  equation is reported as unused; an impulse at t = 0 explains that y'(0) is
  the value before the jump. `laplace t^2 for s > 2.5` drops the condition;
  `L{t^2}` is a spelling; sin³/cos³/sin⁴/cos⁴ reduce; `u(t-2)u(t-3)` is
  u(t−3); `exp(a t)` with a symbolic rate transforms with the numeric check
  honestly skipped; `delta(t)` carries no "for s > −Infinity".

### Found by a SECOND independent pass, over the fixes themselves
- A symbolic frequency (`laplace sin(w*t)`) was withheld with "did not agree
  with the defining integral": the region was computed as if w were 0 and the
  numeric check then failed on the free symbol. A symbolic rate, frequency or
  coefficient now makes the region unknown and the check skipped by name.
- A first-order impulse response (`y' + y = delta(t), y(0) = 0` → e^{−t})
  was withheld because y itself jumps at the impulse: y(0) is now read as the
  value before the jump, and the caveat says so.
- The masking simplifier froze everything it masked: `sqrt(2)·sqrt(2)`,
  `sqrt(4)`, `exp(0)`, `exp(1)·exp(−1)` and `sin(π/4)² + cos(π/4)²` came back
  unreduced, so `laplace sqrt(2) sin(sqrt(2) t)` printed
  sqrt(2)·sqrt(2)/(s² + sqrt(2)²) for 2/(s² + 2). Identical constants now
  share one atom, trivial folds run before and after the simplifier, and a
  second round runs when the folds exposed numbers. tan(π/4) is 1, not
  sqrt(2)/sqrt(2). A user variable that happens to be named like a mask atom
  can no longer be unmasked into someone else's constant.
- Step lines printed `u(t - --1)`; single-term results printed `10*1/s` and
  `1/2*1/(s^2 + 1)`; a delay of π was refused by the inverse; `1/exp(t)` was
  refused as a division; `L^{-1}{…}` and an inverse with a trailing
  "for s > …" did not parse; a forward transform of a function of s now says
  to write "inverse laplace". All fixed and pinned in
  `laplace.adversarial2.test.ts`.

## [2.128.0] — 2026-10-13 — Every statistics calculator reads the table at the cursor; power & sample size

### Added
- **"Use table at cursor" on all 22 statistics calculators.** It reached the
  ten whose field is a plain list and stopped at the eleven whose field is
  group syntax — ANOVA, Tukey, Dunnett, Kruskal–Wallis, the assumption check,
  Friedman, survival, log-rank, multiple regression, the contingency table and
  two-way ANOVA — on the reasoning that "a group definition takes syntax, not
  a grid". Each of them has an obvious grid, and for most it is how the data
  sits in the document. `src/lib/tableFeed.ts` maps a Word table onto each
  syntax: independent groups one per column (a header row names them) or as
  label + value rows; repeated measures one row per subject; survival from a
  time column and an event column found by header name or by content (1/0,
  yes/no, TRUE/FALSE, event/censored all read), plus a group column for
  log-rank; regression rows with the response first; a block of counts with
  row labels and header dropped; two factors as A / B / value rows or as a
  crosstab whose cells may hold replicate lists. Every load reports in the
  status line which column became what, and an ambiguous or lossy layout is
  refused with the layout that would work. The emitted text carries numbers
  only — a label such as "Dose 10" in the text would inject a value, so names
  go in the note instead. Fisher's exact for 2 × 2 tables already shipped
  inside Chi-square independence; it is now reachable from a table too.
- **Power & sample size** (Stats): n per group for a target power, or the
  power at a given n, for the two-sample t and paired / one-sample t (Cohen's
  d), one-way ANOVA with k groups (Cohen's f) and two proportions (large-sample
  z). `src/lib/power.ts` implements the non-central t (AS 243, the algorithm R
  uses) and the non-central F (Poisson mixture of betas), each cross-checked
  in the tests against direct numerical integration of its definition by a
  different route, and the power figures are pinned to G*Power 3.1: d = 0.5
  needs n = 64 per group (power 0.8015), paired n = 34 (0.8077), ANOVA
  k = 3 / f = 0.25 needs 53 (0.805), proportions 0.50 vs 0.60 need 388. The
  result states its assumptions — equal groups, normality, the z
  approximation's small-count caveat pointing at Fisher — and draws the power
  curve with the chosen n marked, because a sample size is a point on a curve
  and the slope there says whether a few more subjects buy much. An effect of
  zero is refused as infeasible rather than answered with a huge n.

### Found by the independent adversarial pass (none by the author's own tests)
The first version read every tidy layout the author designed for and broke
on the layouts a Word user actually has. All class A, all silent, all fixed
with a named rule and a test in `tableFeed.adversarial.test.ts`:
- **A decimal comma was a ten-fold error.** Every comma was stripped as a
  thousands separator, so `1,5` became 15 — in every shape, and in the older
  list/matrix feeds too. A thousands separator always has exactly three digits
  after it; anything else with one comma is now a decimal, and the note says
  how many cells were read that way. The Unicode minus Word autocorrects to
  and a no-break-space thousands separator are numbers now rather than
  silently dropped cells.
- **A label merged across its rows dropped every row but the first.** Merged
  cells reach the API as the label on the first row and blanks below it; the
  blanks are now filled from above and counted in the note. When Word returns
  such rows ragged instead, the numbers shift into the label column — that
  table is refused by name rather than read as two nonsense groups.
- **Numeric ids, arms and years were data.** "A label is a word" made a
  Subject column of 1..n a Friedman condition, an ID column a regression
  response, arms coded 1/2 the values of groups called "Group" and "Value".
  Headers naming an id or category (id, subject, group, arm, year, dose, …)
  and a bare 1..n row counter now mark label columns whatever their cells
  hold; three unnamed numeric columns for survival are refused, since which
  one is time would be a guess; and a wide table with no header says so.
- **"Age (years)" became survival time** because it mentions a unit. A header
  that names the time column outright now wins over one that mentions a unit,
  and a unit word never beats a column named Time.
- **A "Censored" column was read with 1 = event.** It is inverted now, and
  the note says the flag was read as censored.
- **Survival rows with an unexpected status were quietly skipped** (a 0/1/2
  competing-risk code lost half the subjects). The whole table is refused,
  naming the value and the row; `1.0`/`0.0` and Deceased are read.
- A crosstab whose first data row holds only replicate lists lost its header
  and was told to "lay the table out as a crosstab"; numeric factor levels
  (dose 10/20) were refused in long form. Both read now.
- `power.ts`: the sample-size search gave up at 2^19 while claiming a cap of
  10^6, so d = 0.005 (true n ≈ 628k) came back "cannot reach 0.8 power" — the
  cap is now searched to the end and the message says "more than 1,000,000";
  the non-central t underflowed to 0 for every t past |δ| ≈ 37.6 and now
  takes the normal approximation R uses there; n is capped at 10^9, above
  which the incomplete beta loses precision and a zero effect reads power 1.

### Found by a SECOND independent pass, over the fixes themselves
The header-word heuristics added in the first round were a mapping surface of
their own — four more class-A defects of the shape "a word in a header
silently changes which column is data", all fixed and pinned:
- A header merely STARTING with an id word dropped or relabelled real
  measurement columns: "Sample A | Sample B | Sample C" lost Sample A,
  "Trial 1..3" lost a Friedman condition, "Run time" stopped being the
  regression response, "Case fatality | Survival" became label + value
  groups. A header word now has to be the whole header, the column's content
  has to agree (ids: text, a row counter or distinct integers; categories:
  text or repeating integers), sibling headers sharing the word are groups,
  and a contingency table never loses a column on a header word.
- "A crosstab's row labels are unique" was false: replicates on separate rows
  repeat the label, and a 3-column blank-corner crosstab was read as a long
  table with the first data column as factor B. A blank corner is a crosstab,
  full stop; three columns are long only when the second holds level names or
  both factor columns repeat.
- Log-rank grouped by "Treatment duration (days)" (a `treat` substring hit)
  ahead of "Arm"; "Progression-free survival (months)" was taken for an event
  and "Survival status" for a time. Survival headers now get a role by word
  order: a header naming time, then status/censored, then survival/OS/PFS,
  then event words, then a bare unit; "age" never.
- Inside a crosstab cell a comma is always a separator now (the note says to
  write decimals with a dot there); "1.000,5" reads as the German 1000.5 and
  any other dot-before-comma is refused; n/a placeholders are blanks.

## [2.127.0] — 2026-10-13 — Offline delivery

The product's stated core value — "in grad school you can't always connect to
the internet" — rested on nothing. Every calculation ran on the user's
machine, but Word fetched the pane itself from GitHub Pages on every open,
and the bundle's filename changes on every release, so the first open after
a deploy always needed the network and an evicted HTTP cache meant a blank
pane at exactly the moment the promise was being tested. This release makes
the promise true, and then makes it enforced.

### Added
- **The pane opens with no network.** A service worker (`src/sw/sw.js`,
  rendered at build time from the real emitted asset list by
  `scripts/sw-manifest.js`) precaches the four add-in pages, every JS chunk
  (lazy ones included — the PPT export must not be the one tool that breaks
  offline), the stylesheet and the icons, and answers for them cache-first.
  Matching ignores the query string, because Office appends `?_host_Info=…`
  to the task-pane URL and an exact-URL lookup misses the cached page every
  time. `version.json` and `sw.js` are never served from the cache, so the
  update trigger always reaches the server. The Office.js CDN is cached at
  runtime (stale-while-revalidate); nothing else cross-origin is touched, so
  the opt-in OPSIN lookup is never intercepted or cached.
- **An honest status line under the title.** The pane reports only what the
  worker can verify: *Preparing offline copy…*, *Offline copy incomplete
  (17 of 24 files)*, **Offline-ready · v2.127.0**, or — on a host that allows
  no service worker, which Word for Mac's WKWebView may be — *Offline use
  depends on this Word's cache*. "Ready" additionally requires Office.js to
  be in the runtime cache: a pane without it opens to nothing.
- **The update banner now delivers.** Under a cache-first worker a plain
  reload would be answered from the OLD cache — the banner would announce an
  update the reload could not deliver, the same defect the cache-busting
  query string fixed for the HTTP cache, one layer down. Reload (and the
  one-time silent self-heal) now downloads the new release, swaps the worker
  in, and only then navigates. If the download cannot complete, the pane
  stays on the current release and the banner returns next time.
- **A QC gate for it** (`npm run check:offline`, gate 15 of `npm run qc`):
  warms the real built pane online through a local server that mimics Pages'
  `max-age=600`, verifies against its OWN copy of the manifest that every
  file is cached, then relaunches on the same browser profile with the server
  stopped and every hostname unresolvable, and asserts the pane, both dialogs
  and Office.js itself arrive from the cache. It then does the same on a
  fresh profile and requires that to FAIL — a predicate that cannot fail
  proves nothing. Exits SKIPPED, never PASS, without a browser or internet.

### Found by the gate before shipping
- **First open online, then offline, did not work.** On a first visit the
  page's own `<script>` tags — Office.js and the host files it pulls in —
  are fetched before any worker exists, so nothing from the CDN reached the
  cache until a SECOND online open. The pane now replays every CDN resource
  it has loaded through the worker (from the resource-timing log), and
  "ready" waits for it.
- **Then the replayed files were unusable.** Office.js loads its locale
  strings and host script with CORS requests, and the browser refuses to
  answer a CORS request with an opaque response — which is what a no-cors
  replay stores. The offline pane crashed with "Neither the locale, en-us,
  provided by the host app nor the fallback locale en-us are supported".
  Replays are CORS first (the CDN allows it), no-cors only as a fallback, and
  the gate now rejects a runtime cache holding opaque entries.
- **`register()` rejects when offline** even though the existing worker is
  alive and serving the page (its update fetch of `sw.js` fails). A pane
  controlled by a worker is "supported" whatever `register()` said; without
  that distinction the status line would have read "depends on this Word's
  cache" in exactly the offline session it exists for.

### Found by the independent adversarial pass (none by the author's own tests)
- **A worker swap in one Word window stranded every other window.** Word
  opens one pane per document window. Window B reloading into a new release
  made the new worker activate, DELETE the old release's cache, and claim
  window A, still mid-session on the old bundle — whose lazily-loaded PPT
  chunk now existed in no cache (404 online, a throw offline), while A's
  status line went on saying "Offline-ready" for a version no longer stored.
  Old caches are now swept only when no other window is open (re-checked on
  every page load), a previous release's chunk is served from its own cache,
  and a window claimed by a newer worker reports *Newer copy stored (vX) ·
  reload to use it* instead of ready.
- **A failed first install read "Preparing offline copy…" for ever.** One
  file 404ing during a deploy window discards the registration; nothing is in
  control and no later event arrives. The pane now listens for the install
  ending redundant and says *Offline copy could not be saved — will retry
  next time*. The worker also deletes its half-filled cache on failure
  (a test claimed "a half cache is worse than none"; the code now does it).
- **The silent self-heal could fire minutes into a session.** It used to be a
  sub-second reload at open; with a worker it waited for a 10 MB install
  first and then replaced a pane the user was typing in. It now runs only
  when the new worker is already installed and waiting; otherwise the
  download starts in the background and the banner offers the reload.
- **A failed update looped the banner.** When the swap could not happen the
  fallback navigation was served from the current cache, landed on the same
  release, and the banner came straight back saying "Downloading…". The pane
  now stays put and says the update could not be downloaded.
- **Pages' edge could pin a mixed-version install.** `cache: "reload"`
  bypasses the browser's cache, not the CDN edge (max-age=600), which can
  hand the previous release's taskpane.html to the new worker. The install
  now verifies every precached page refers only to precached scripts and
  refuses otherwise; the browser retries on the next open.
- Smaller: the update check no longer races worker registration; the gate's
  manifest regex no longer stops at a `]` inside a filename; the offline
  phases run with the HTTP cache disabled, so a pass proves the WORKER served
  the page and not the renderer's cache; the unsupported wording fits 320 px.

### Changed
- `install/README.md`, `landing/manual.html`, `landing/students.html` and
  `FEATURES.md` now describe offline delivery as it is — including the Mac
  caveat — rather than "works offline after first load", which the HTTP cache
  never guaranteed. New manual pass §0bt in `docs/TEST-SCRIPT.md`; the Mac
  result decides whether that caveat stays.

## [2.126.0] — 2026-10-12 — The deferred equation-engine items

### Added
- **Complex numbers on input.** `i` is the imaginary unit. Arithmetic
  over ℂ is exact on Gaussian rationals (+ − × ÷, integer powers,
  conj/re/im/abs, sqrt where the result is a Gaussian rational, arg at
  multiples of π/6 and π/4, polar form), and every exact result is
  cross-checked against floating-point evaluation of the original —
  a disagreement withdraws the answer. Anything that cannot be exact
  (√(1+i)) is labelled NUMERIC. Equations in one unknown with complex
  coefficients are solved over ℂ: degree 1 and 2 exactly when the
  discriminant has a Gaussian-rational square root, higher degrees by
  Durand–Kerner, every root substituted back. Before this release
  `(2+3i)(1-i)` was solved *for i* and `(1+i)^8` returned eight numeric
  roots — confident wrong answers, now gone. A constant the real
  evaluator cannot value (`sqrt(-4)`) is answered as 2i; `x^2 = -1`
  without an i stays with the ordinary solver, which already gives ±i.
  New `src/lib/complexAlgebra.ts`; conj/re/im/arg added to the parser's
  function table so they parse.
- **Partial fractions as a verb.** `partial fractions 1/(x^2-1)` (or
  `decompose …`): rational roots with multiplicity, one irreducible
  quadratic with a linear numerator, the polynomial part of an improper
  fraction stated first. The decomposition is recombined exactly and
  compared with the original before it is shown; an irreducible factor
  of degree ≥ 3 is refused by name. `partialFractionDecompose` in
  casint.ts (shared with the integrator's method), the verb in
  algebraTools.ts, ASCII output like its sibling verbs.
- **Parametric linear systems.** A linear system with exactly one letter
  outside the unknowns x, y, z, w, u, v is solved by row reduction over
  rational functions of that letter, preferring parameter-free pivots.
  The output is the generic solution with its condition ("For a ∉ {−1}
  (a + 1 ≠ 0)") and every special value — rational roots of the forced
  pivots and of the answer's denominators — classified by substituting
  it into the ORIGINAL equations and running the exact rational solver:
  no solution (contradiction shown) or infinitely many (free variable
  named). Two parameters, or a parameter the unknowns multiply
  nonlinearly, fall through to the existing paths and are refused by
  name there. `SystemSolution.kind` gains `"parametric"`.

### Fixed (independent adversarial pass, 16 confirmed defects)
- Complex: a negative-zero imaginary part flipped every branch cut
  (`ln(-1)` came back −πi, `(-2)^(1/2)` as −1.414i); the floating
  cross-check blamed correct exact results ("CROSS-CHECK FAILED") after
  cancellation, overflow or a square-root branch; unsupported functions
  (`sinh(i)`) threw out of the verb; Durand–Kerner produced NaN roots
  from degree 39 and on clustered-root polynomials; repeated roots were
  shown as three wrong 10-figure values; `(1+i)^100 z = 1` hit the
  unknown's power cap; exact growth was unbounded (`((1+i)^4096)^4096`
  ran seconds then threw); `0^i` and `arg(0)` answered 0.
- Partial fractions: ℚ-factorable denominators (`(x²+1)²`, `x⁴+4`,
  `x⁶−1`) were refused with a false reason; the rational-root divisor
  search stopped silently at 10,000 (`10007x − 1` "has no rational
  root"); "of", missing powers in the factor list, "(1)/(…)".
- Parametric systems: special values were misclassified as "unsolved" or
  "nonlinear" whenever the parameter was squared (textual substitution
  left `(−2)²x`, which the linear parser rejected) or glued to a digit
  (`2a`); solving time was unbounded (6 unknowns never returned);
  `1/2a` was displayed; a parameter in a divisor had no "undefined"
  value; `a² + 1 ≠ 0` raised a false "irrational values" caveat; a
  pivot's root the generic formula already covers was called special.
- Judgment calls taken: prose-wrapped complex arithmetic ("What is
  (2+3i)(1−i)?") is claimed from the task text; `i^2 = -1` is judged
  TRUE rather than refused; `2^z = i` is refused for the right reason;
  `x + y = a; x − y = 1` is solved for every a instead of treating a as
  a third unknown; bare `decompose 12 into primes` falls through.

### Tests
- New `equationDeferred.test.ts` (324 files): exact complex arithmetic
  against hand values, display round-trip through foldPastedMath and the
  parser, the claim rules (an i-free input is never taken from the
  solver; an equation in two unknowns is not claimed), partial fractions
  re-evaluated numerically at sample points, parametric systems checked
  at several parameter values against the direct rational solve, and
  the special-value classification.

## [2.125.0] — 2026-10-12 — The two known limits, lifted honestly

### Changed
- **λ-calculus: definitions expand lazily (δ-steps).** PLUS, PRED, a
  `let` name or a `let rec` name now stays a NAME in the term until it
  stands where a function is needed, and is expanded there as a δ-step
  in the trace. The trace reads as the textbook does (`PLUS 2 3` → δ →
  β …), and the term stays small: an unfolding of Y copies a name, not
  the forty-node body of PRED.
- **Normalisation by evaluation backs the step trace.** When the
  step-by-step reducer hits its budget, the normal form is taken from
  a second normaliser — closure evaluation with sharing, read back as a
  term by applying closures to fresh neutral variables. `FACT 5` and
  `FACT 6` through Y, `FIB 10`, and `2 2 2 2` (= 65,536, read out
  against a native successor because its normal form is above the
  print cap) now answer in well under a second. When the trace does
  finish, NbE must agree with it (a cross-check line), and the
  numeral/boolean readout stays as the independent confirmation. An
  oversized read-back is NOT reported as "a normal form exists": `Y f`
  unfolds forever and says so — the numeral readout is what separates
  "large" from "infinite".
- **Hamiltonian cycles and paths above the exhaustive range.** The
  exact Held–Karp search now runs to 16 vertices. Above that, the
  answer is a certificate: a cycle or path FOUND by a bounded
  Warnsdorff search is a proof of yes; a structural obstruction —
  disconnection, a degree-1 vertex, unbalanced bipartite sides, any
  one, two or three vertices whose removal leaves more pieces than a
  cycle allows, no strong connectivity or two sources/sinks when
  directed — is a proof of no; Dirac, Ore and the Bondy–Chvátal closure
  certify existence even when the search cannot construct the cycle;
  and "not found within the budget" is stated, in those words, to be
  no proof. A random 60-vertex graph gets its cycle in ~80 ms.

### Notes
- Independent adversarial pass: 4,826 random small graphs checked every
  certificate, DP answer and search outcome against brute-force
  permutation search with zero mismatches; 1,000 random closed and
  open λ-terms agreed across the lazy trace, the eager reducer and
  NbE. It found nine real defects, all closed and pinned
  (lambda3.adversarial.test.ts): a β-invented fresh binder could
  capture a free variable brought by a LATER δ-expansion (and NbE made
  the same mistake, so the wrong answer was "Verified") — invented
  names now avoid every name any definition carries; NbE read-back
  captured a definition's free variable under a closure parameter of
  the same name; a forward reference (`let AA = λx.BB` before BB) was
  expanded while a note said BB stayed free — definitions are now
  parsed in one pass and prepared in a second, with truthful notes;
  textbook mutual recursion (`let rec EVEN … ODD`, `let rec ODD … EVEN`)
  reduced correctly and then threw from the eager type expansion — the
  type line now says why it is not computed; the numeral readout named
  the node cap when the depth cap had fired; the NbE rescue line
  repeated the step count; a phantom α-step for a bound name shaped
  like a definition; `let rec Y = …` looped because the fixed-point
  combinator was looked up by name (now inlined); and a self-loop hid
  the bipartite obstruction in the Hamiltonian certificates. Also a
  directed 2-cycle now counts as a cycle, and redefining a library
  name says which library entries it changes.

## [2.124.0] — 2026-10-12 — Discrete mathematics, six engines; the λ-calculus grows up

### Added
- **A Discrete-math kind in Solve** (`src/lib/discrete.ts`), one box
  routed by syntax to six engines, each exact, capped by name, and
  cross-checked where a second route exists:
  - **Number theory** (`numtheory.ts`): gcd/lcm with Euclid's steps and
    Bézout coefficients, modular powers (square-and-multiply shown,
    Fermat shortcut named), inverses, linear congruences with every
    solution, the Chinese remainder theorem for moduli that need not
    be coprime, factoring (trial division then Pollard's rho under a
    budget — an unsplit cofactor is NAMED as unsplit, never called
    prime), Miller–Rabin primality that is a proof below 3.3 × 10²⁴
    and says "probable prime" above, sieves, φ, divisors (σ, perfect/
    abundant/deficient), multiplicative order, primitive roots,
    Jacobi/Legendre with quadratic residues, Tonelli–Shanks roots, base
    conversion by repeated division.
  - **Combinatorics** (`combinatorics.ts`): C, P, n!, multinomials,
    multiset permutations, derangements, Catalan, Bell, Stirling (both
    kinds), integer partitions, power sets, and prose word problems
    with the model named — a sentence carrying a condition the formula
    ignores is refused, never answered with the unconditioned count.
    Every count is computed two ways.
  - **Recurrences** (`recurrence.ts`): linear, constant coefficients,
    order ≤ 4 — rational roots exactly, a quadratic exactly in ℚ(√D)
    (Fibonacci → Binet), the rest numeric and labelled; polynomial and
    exponential forcing by undetermined coefficients with resonance;
    EVERY closed form verified against direct iteration for n ≤ 15.
    The master theorem (three cases + the extended log case, regularity
    checked).
  - **Propositional logic** (`proplogic.ts`): truth tables, tautology/
    contingent/contradiction, DNF, CNF, the Quine–McCluskey minimal
    form (reusing logic.ts), equivalence, entailment with the
    counterexample row.
  - **Automata** (`automata.ts`, drawn): DFA/NFA blocks run on test
    strings with the state sequence, ε-closures, regex → Thompson →
    subset → minimal DFA, `to dfa`, `minimize` (cross-checked on every
    string to length 6), `equivalent` with the shortest distinguishing
    string.
  - **Graphs** (`graphs.ts`, drawn): degrees, components and SCCs,
    bipartite with the odd-cycle witness, Eulerian trails (Hierholzer),
    trees/cycles, topological order, shortest path (Dijkstra, or
    Bellman–Ford with negative weights; a negative cycle refused by
    name), Kruskal MST, Hamiltonian by exhaustive search to 12 vertices
    (refused above as NP-hard), diameter.
- **λ-calculus extras**: η-reduction (`eta …` for the βη-normal form;
  a β-normal form that still η-reduces is pointed out in every result,
  so POW 2 0 = λx.x is now read as Church 1 up to η), SKI translation
  by bracket abstraction with the η rule (`ski …`, verified by
  reducing both sides on fresh variables), combinatory reduction by
  the S/K/I/B/C/W rules alone (`cl …`), Church lists with a `[1, 2, 3]`
  literal and NIL/CONS/HEAD/TAIL/ISNIL/LENGTH/SUM/MAP (a list normal
  form is decoded), and `let rec NAME = …` tied with Y.
- Pane: option, hint, six palette groups (every template pinned to
  answer), the figure carried to the document for graphs and automata;
  example, landing tile, Solve card, manual, tool page, FEATURES,
  README, TEST-SCRIPT.

### Notes
- Three engines (graphs, automata, combinatorics) were built by parallel
  builders against a shared contract; an independent adversarial pass
  then probed the whole release. The algorithms held: 150 random graphs
  against Floyd–Warshall / brute-force spanning trees / 2ⁿ colourings /
  permutation Hamiltonian search with zero mismatches, Jacobi against
  Euler's criterion for 200 values, regex equivalence witnesses re-run
  on both machines, every recurrence family verified. It found eleven
  real defects, all closed and pinned (discrete.adversarial.test.ts):
  a one-line `regex (a|b)*abb` was stolen by logic (its `|`) and
  errored — automata now routes before logic; initial conditions on
  their own lines were glued onto the recurrence; combinatorics
  answered the unconditioned count for "BANANA beginning with B" and
  "choose a team of 3 and a captain" (gerund conditions and "and
  <a second requirement>" are now refused); `primes to -5` threw a
  RangeError from the sieve; the Sorenson–Webster bound itself (a
  composite that passes all thirteen Miller–Rabin bases) was called
  prime by `factor` — the deterministic range is strictly below it, and
  the headline now says "PROBABLE" at or above; NAND/NOR lost their
  right-hand brackets on display (non-associative); an ill-conditioned
  order-4 numeric recurrence printed CROSS-CHECK FAILED — it now
  withholds the closed form and says why; ten-variable logic took
  1.8 s per keystroke (Quine–McCluskey now runs unasked only to 7
  variables); `let rec FACT 3` took 0.9 s — the cycle detector was
  building a de Bruijn STRING per step with nested concatenation,
  O(size × depth), replaced by a string-free structural hash (now
  75 ms; FACT 5 still exceeds the work budget and says so, because
  every Y-unfolding copies the whole body); the displayed `3⁻¹` did
  not parse back (superscript minus now folds); and `gcd 1,234 56`
  split the thousands separator into a third argument.
- Also from the pass: congruence statements (`5 ≡ 2 (mod 3)` → TRUE),
  `gcd of 84 and 36`, `is 97 a prime number?`, `pow(7,100,13)`,
  CRT one congruence per line, Fibonacci from F(1), inconsistent or
  duplicate initial conditions refused, `a(n-1)/2` and `(1/2)a(n-1)`
  and juxtaposed factors read, `log² n` and `log^2 n` in the master
  theorem, xor binding tighter than or (as in the digital-logic tool),
  and a perfect-square discriminant past the divisor cap no longer
  prints "√1".
- The figure-layout gate caught both new renderers laying edge labels
  on the stroke (read as strikethrough) and, once moved aside, other
  chords and the start arrow crossing them: labels are now placed by
  trying candidate spots and taking the first no segment crosses, and
  self-loops point radially outward (tangentially on the start state).
  Three discrete figures joined the corpus (floor 172 → 175).
- The λ-calculus's independent evaluator is now an iterative CEK-style
  machine: the recursive one spent four JS frames per Church-numeral
  level and overflowed inside a full jest run while passing alone, with
  the overflow swallowed as "could not decide" — the same
  stack-capacity signature as the depth cap in v2.123.0.

## [2.123.0] — 2026-10-12 — The untyped λ-calculus

### Added
- **A λ-calculus kind in Solve** (`src/lib/lambda.ts`): parse (λ, \ or
  the word lambda; application by juxtaposition, left-associative;
  textbook shorthand λxy.x and xx-inside-λx. read and NOTED), then
  β-reduce step by step with every contracted redex named and every
  capture-avoiding α-rename listed as a step of its own
  ((λx.λy.x) y → λy₁.y, never λy.y; renamed variables carry a subscript
  that parses back, so the display contract holds).
- **Normal order by default, applicative order by name** — the one
  strategy with a theorem (standardisation) versus the one students
  are taught to compare it with; `applicative K I OMEGA` shows
  call-by-value provably diverging on a term normal order answers, and
  says so in the same result.
- **Three honest outcomes**: a normal form; a PROVEN divergence (the
  term returned to an earlier form up to α-equivalence — a cycle, found
  by de Bruijn hashing); or a cap (1000 β-steps, 8000 nodes, 1500 deep, or a
  work budget of one million node-steps), reported as a cap and not as
  a theorem, because normalisation is undecidable. The caps bound TIME,
  since a pane recomputes on every keystroke: `2 2 2 2` (65,536) is
  refused in milliseconds, not attempted.
- **Church encodings and a library**: integers are Church numerals;
  I K S B C W Y OMEGA, TRUE/FALSE/AND/OR/NOT/IF, ZERO/SUCC/PLUS/MULT/
  POW/PRED/SUB/ISZERO/LEQ/EQ, PAIR/FST/SND are built in, and
  `let NAME = term` lines above the term define more.
- **Results checked two independent ways**: a numeral or boolean normal
  form is decoded structurally AND the original term is re-run through
  a separate environment-based lazy evaluator (closures and thunks, no
  substitution at all) applied to native successor/zero; agreement is
  reported, disagreement is reported as a defect. Same discipline as
  the Euler-characteristic cross-check in homology.
- **Questions**: `type …` gives the principal simple type by
  unification ((α → α) → α → α for Church 2; λx.x x is not simply
  typable, by the occurs check, and it says so); `free …` lists free
  variables; `alpha A = B` decides α-equivalence by de Bruijn indices.
- Palette (λ, plus Reduction / Church encodings / Questions templates,
  every one pinned to produce an answer), hint, example, landing pages,
  FEATURES, README and the manual test script all carry it.

### Notes
- Independent adversarial pass over the first version: the reducer held
  against 4,000 random terms under both strategies (an independent de
  Bruijn normaliser compared after EVERY step, zero mismatches), 300
  random arithmetic expressions all decoded and cross-verified, 15
  hand-computed principal types matched, and no capture could be
  constructed. It found seven real defects, all closed and pinned:
  `let` expansion CAPTURED (a definition's free y substituted under the
  user's λy — `let F = λx.y ⏎ (λy.F y) z` answered z, correct is y;
  expansion is now capture-avoiding substitution and says when it
  renamed); substitution walked a captured body twice per binder,
  giving phantom α-steps and 2^d time for d nested captures (now one
  simultaneous pass — 17 nested captures went from 0.9 s to 20 ms);
  Church 0 under a shadowed binder (λx.λx.x, which POW 0 2 produces)
  was not decoded; the principal type is a DAG that prints as a tree
  and was exponential with no cap (PAIR x x nested 22 deep built a
  67 MB string — now budgeted in both unification work and printed
  size, "too large to show"); "normal form of X" was parsed as the
  term `form of X`; the step and size caps bounded time at ~2 s per
  keystroke, so a WORK budget (total nodes walked, 1,000,000) now
  bounds it at ~100 ms; and a single β-step could copy its argument
  thousands of times past the size cap (a 6-million-node term and 12 MB
  of step text) — the copy count is now checked BEFORE the step, the
  input is size-checked as written, and step lines are cut at 400
  characters while the normal-form line stays whole (it is the line
  that must parse back). Also: real line numbers in errors (blank
  lines were dropped before counting), located positions, a lone
  surrogate never shown (math-italic 𝜆 is now read as λ), Greek-letter
  variables accepted, the undocumented `^`-as-λ removed, defined names
  never split by the shorthand heuristics, and the not-split case
  (λxy.xy is ONE variable) now says so.
- Depth is capped explicitly. The size cap bounds breadth, and the
  walkers recurse on depth, so a wide application chain under the size
  cap could still overflow the stack (found when a 2,500-wide chain
  passed alone and failed inside a full jest run, whose stack is
  deeper). The cap is set from measured stack capacity with margin.

## [2.122.0] — 2026-08-09 — Cross-release hardening, and the landing pages catch up

### Fixed
- A dedicated CROSS-RELEASE adversarial sweep probed the seams between
  today's eleven releases (no single-release pass covers how the
  layers interact). Four real defects, fixed and pinned:
  "The average of 3 numbers is 12. Two of the numbers are 10 and
  11..." was answered "mean = 10.5" by the stats layer (the stray
  "10 and 11" satisfied the list rule) — the "average of N numbers"
  phrasing is now recognised as a word problem; "average speed"
  questions were claimed and refused by statistics one layer above
  the rate×time engine that answers them (now it yields — 60 mph
  comes back); "average rate of change of f(x) = x² from 1 to 3"
  produced exact-labelled roots in FABRICATED variables `from` and
  `to` (extraction candidates carrying prose words are now rejected);
  and every "sum of…" question dead-ended in sum-syntax help — now
  "sum of 3, 5, 8 and 12" simply answers 28 (decimals added exactly:
  0.1 + 0.2 shows 3/10, never 0.30000000000000004) and non-sum prose
  falls through to the layers below.
- The sweep also verified CLEAN: the full dispatch canary table, the
  reaction/dictionary triangle across all 359 compounds (methanol/CO
  is the only possible collision and the guard catches it), the
  namer against 40 pathological structures (zero throws, worst case
  645 ms), all 27 attach groups through 3D generation, and the
  drawing dialog's message protocol from both consumers.

### Changed
- Landing pages refreshed for the last eleven releases: new highlight
  tiles (3D modeling and building, reaction schemes from drawings,
  systematic IUPAC names, paste-the-whole-question), a rewritten
  Solve card, and updated students/science pages.

## [2.121.0] — 2026-08-09 — Systematic IUPAC names, for the subset that can be named safely

### Added
- **An offline systematic IUPAC namer** (structure → name) covering a
  well-defined subset completely: acyclic hydrocarbons to C12 with
  -ene/-yne unsaturation and branched alkyl substituents (incl.
  isopropyl/sec-/tert-butyl and phenyl), ONE kind of principal
  characteristic group (-oic acid, -amide, -nitrile, -al, -one, -ol,
  -amine, multiples allowed: -dioic/-diol/-dione), prefix
  substituents (halo, nitro, hydroxy, oxo, amino, methoxy/ethoxy),
  plain cycloalkanes and substituted benzenes. Current IUPAC locant
  style (pent-2-ene, propan-2-ol, hexane-2,4-dione), lowest-locant
  and alphanumbering rules applied. 27 hand-verified name pins.
- **Everything outside the subset refuses BY NAME** — esters,
  N-substituted amines/amides, hetero/fused rings, other elements,
  ions, isotopes, complex substituents, chains beyond C12 — because a
  confident wrong name in a patent document is worse than no name.
  Structures with drawn stereochemistry name constitutionally with
  "stereodescriptors omitted" stated.
- **Chemical mode wiring**: the curated dictionary still speaks first
  (retained names — aspirin, toluene, phenol); the systematic namer
  fills dictionary misses, labelled "subset namer — verify before
  filing"; refusals surface as "No name: …".

### Notes
- Independent adversarial pass (it hand-verified every emitted name
  against IUPAC rules): the locant/direction/seniority core held —
  but it found three structural escape hatches producing WRONG names,
  all closed and pinned: imines silently stripped (ethanimine named
  "ethane" — a different molecular formula), exocyclic C=C on rings
  read as saturated alkyl (methylidenecyclohexane →
  "methylcyclohexane"), and acyl halides/ketene naming as aldehydes
  ("1-chloroethanal"); urea/carbonic-type carbonyls now refuse
  instead of dropping their =O. Also fixed: multiplier overflow now
  refuses (was "7-fold-"/literal "undefined" in a name), one-carbon
  parents drop all locants cleanly (phenylmethanol,
  tetrachloromethane), locanted substituents get enclosing marks and
  bis/tris (4-(propan-2-yl)heptane), the ene/yne tie is broken for
  the double bond deterministically from either input order, and
  rings beyond OCL's 7-ring perception refuse at the honest boundary
  (cyclooctane said "no carbon chain"). Chain selection is documented
  as traditional (1979) priority — a few 2013 PINs differ, every
  emitted name is unambiguous general nomenclature. 38 name/refusal
  pins ship.

## [2.120.0] — 2026-08-09 — Drawn structures flow into reaction schemes

### Added
- **"Draw a component" in Reaction mode**: opens the large drawing
  canvas (with its templates, groups, and 3D view); the drawn
  structure comes back as SMILES at the reaction input's cursor and
  the scheme preview updates. The SMILES is VERIFIED before it lands
  — encoded with toIsomericSmiles (plain toSmiles silently drops
  E/Z, probed: Z-2-butene came back as "CC=CC") and round-tripped by
  idcode, so the scheme can never silently show a different molecule
  than was drawn; generic (R-group) drawings are refused by name — a
  Markush genus is not a reagent.

### Notes
- Independent adversarial pass, one Tier-0 caught before release: the
  bridge was faithful but the RENDERER downstream was not — drawn
  METHANOL emits SMILES "CO", and the reaction renderer's
  name→formula→SMILES precedence resolved it to the formula table's
  CO, carbon monoxide: a scheme silently showing a different molecule
  than drawn. Fixed with an explicit "smiles:" prefix the renderer
  honors (typed-input precedence unchanged — a typed formula stays a
  formula); the pane adds the prefix only when it detects the
  collision, so future dictionary growth is covered. The pass also
  verified 21 stereo/charge/isotope round-trips exact, the parser
  seam safe (bracket "+" never splits, /C=C\ survives arrows), and
  the guard correctly refusing racemic ESR groups that SMILES cannot
  carry.

## [2.119.0] — 2026-08-09 — Refined 3D, building in 3D, and template libraries

### Added
- **Rendering quality**: depth-cue fog (back atoms dim — baked into the
  shared draw list, so the live view and the inserted figure shade
  identically), specular sphere shading with a limb outline,
  cylinder-shaded bond rods, and DOUBLE/TRIPLE bonds as parallel rods
  — bond order is chemistry and is now visible. Heteroatoms wear
  their element symbol (toggleable), colored for contrast.
- **Building in 3D**: click an atom or bond in the 3D model to select
  it (drag still rotates — a click is a click). A selected atom takes
  an element change (C/N/O/P/S/F/Cl/Br/I), an attached group, or
  deletion; a selected bond takes single/double/triple or deletion.
  Every edit runs on the same molecule the 2D editor holds — the
  idcode's atom order provably matches the conformer's (pinned by
  test) — so the 2D tab, the undo stack (Ctrl+Z restores), and the
  regenerated 3D stay one chain. Edits that would create impossible
  chemistry (a fifth bond on carbon, a double bond to fluorine) are
  refused BY NAME via the same compliance engine as the pane; edits
  are verified in tests by canonical idcode (benzene + OH IS phenol,
  benzene C→N IS pyridine, benzene + nitro IS nitrobenzene).
- **Template and group libraries**: 33 templates (rings, heterocycles,
  and named scaffolds — adamantane, cubane, porphine, 18-crown-6,
  glucose) insertable in both tabs, and 27 attachable groups (methyl
  through trifluoromethyl, nitro, sulfonic acid) with the
  first-atom-bonds convention pinned by test (methoxy attaches
  through oxygen: anisole, exactly). All real published chemistry —
  formulas spot-checked (porphine C20H14N4, 18-crown-6 C12H24O6).

### Notes
- Fixed en route: OCL's SMILES parser books an unfilled bracket-atom
  valence slot as a RADICAL (nitro's N arrives with radical state 32)
  and that bookkeeping survives fragment attachment — left in place
  it fails valence checks and encodes a different idcode than the
  same molecule drawn whole. Attachment now clears it, and the
  compliance delta check runs AFTER coordinate re-layout so freshly
  added atoms are not refused for "overlapping" at the origin. The
  QC layout audit also caught stick-style rods striking through atom
  letters — rods now stop short of a labeled atom, the same
  convention as a 2D drawing.
- Independent adversarial pass: NO wrong-atom edit could be produced
  — the conformer/idcode order pin held against charged species,
  isotopes, drawn explicit hydrogens, two-fragment molecules, and
  successive edits (the pin test now covers those cases). Its
  hardenings shipped: labels center by dy (WebKit's
  dominant-baseline support is patchy — a Mac insert would have sat
  every letter high), and an ion's caption now carries its charge
  (OCL's formula string is charge-blind: phenolate read "C6H5O" —
  now C₆H₅O⁻). All 27 attach groups are now pinned idcode-exact
  against the drawn-whole molecule.

## [2.118.0] — 2026-08-09 — 3D molecular models in the drawing canvas

### Added
- **The large drawing canvas gains a "3D model" tab**: a real conformer
  of the drawn molecule — generated by OpenChemLib's ConformerGenerator
  and minimised with the MMFF94s force field (Halgren 1996), verified
  in tests against published geometry (methane C–H 1.09 Å and 109.5°,
  benzene planar at C–C 1.39 Å) — rendered ball-and-stick, stick, or
  space-filling with standard CPK element colors and Bondi/Mantina van
  der Waals radii. Drag to rotate, scroll to zoom, auto-spin,
  hydrogens on/off (the model refits), Reset view. The note under the
  canvas is honest about what it shows: ONE MMFF94s-minimised
  conformer, not the molecule's only shape.
- **"Insert 3D picture"** places the model into the document in the
  exact orientation composed on screen: the dialog sends only the
  idcode plus the view, and the pane regenerates the identical
  conformer (fixed seed, deterministic — pinned by test) and renders
  it through the SAME projection/draw-list code the live view uses.
  Alt text carries formula and OCL-ID provenance.
- **Named refusals**: generic structures (R-groups/query features)
  have no single 3D form and say so; conformer generation is capped
  at 120 heavy atoms so the dialog stays responsive; elements outside
  the published color/radius table are NAMED in the caveats and shown
  generically. MMFF94s parameterisation failures (organometallics)
  fall back to the self-organised conformer and say so.
- **2D dialog quality**: "Clean structure" now also lives in the large
  canvas (undo keeps the hand layout), and the info line adds
  molecular weight beside the formula.

### Notes
- Independent adversarial pass, four classes fixed and pinned:
  (1) WORST — OCL's ConformerGenerator sometimes builds a drawn CIS
  double bond TRANS (Z-2-butene arrives trans at the default seed);
  every conformer is now VERIFIED by re-perceiving its 3D geometry
  against the input idcode, a fixed seed ladder retries on mismatch,
  and if no seed preserves the drawn stereochemistry the engine
  refuses by name rather than show the wrong diastereomer. Undrawn
  stereocentres get specified by geometry — the caveat now says "one
  stereoisomer shown". (The verification itself had to be built on a
  coordinate-free rebuild: with 3D coordinates attached, stereo flags
  re-perceive from geometry and a strip silently undoes itself.)
  (2) The atoms-only cost gate didn't deliver its promise (a
  120-carbon chain blocked ~4 minutes): flexibility is the real cost,
  so rotatable bonds > 12 now refuse by that name, heavy cap 80.
  (3) Five transition metals sat in the radius table with an invented
  2.00 Å: colors and radii are now separate tables, elements without
  a published Bondi/Mantina radius are NAMED in the caveats (Fe, Ti,
  Cr, Mn, Co…), and In/U gained their real Bondi values.
  (4) Hardening: all-hydrogen scene with H hidden can no longer
  insert a blank white figure; rot/zoom payloads validated finite;
  pointercancel unsticks dragging; duplicate conformer computations
  are coalesced; the pane yields so its status paints before the
  synchronous generation.

## [2.117.0] — 2026-08-09 — Survey percentages, and word problems route themselves

### Added
- **Survey percentage questions** ("In a survey of 20 people, 8 people
  said they liked chocolate ice cream, and 12 liked vanilla. What is
  the percentage of people who like chocolate ice cream?") are a new
  word-problem template: the count is read from the clause that names
  the asked category and that clause is QUOTED in the working, the
  whole must be stated in the text ("a survey of 20", "out of 50",
  "30 students were asked") — a total is never inferred by summing
  categories, because a respondent may pick several options or none.
  Ambiguity (two clauses tying different counts to the category), a
  negated question ("did NOT like…" — the complement is only 100% − x
  for disjoint, exhaustive categories), and a count above the total
  each return nothing rather than a guess, per this module's charter.
- **Word problems pasted into the equation kind route themselves**: the
  pane switches to the Word problem kind with a note and answers —
  the same pattern as the derivative and limit switches — and the
  canvas answers inline. Only prose can leave: text carrying =, <, >
  or several lines is algebra and never enters, and the switch fires
  only when the word-problem engine will actually answer. This also
  unlocks the whole existing family ("what is 15% of 200", rate ×
  time, running totals, number sentences) for paste-the-question use.

### Notes
- Independent adversarial pass: the ROUTING was verified clean on both
  surfaces (nothing previously answerable is intercepted; every
  earlier claimant in the dispatch still fires first) — the defects
  were in the new recogniser, six confident wrong answers on natural
  survey prose, all fixed and pinned: a stated RATE read as a head
  count ("30% said…" in a survey of 40 → 75%, truth 30%); thousands
  commas severed by the clause split ("2,500 said…" → counted 500);
  best-partial category scoring answering a "vanilla ice cream"
  question with the CHOCOLATE ice cream count (now every word of the
  category must match); "likely" stemming to "like" (an adverb became
  a category; "-ly" extensions no longer match); the question regex
  matching a STATEMENT sentence instead of the question (now the last
  percent sentence); and multi-number clauses ("8 out of every 10
  said…", "between 5 and 8") committing to one number (now refused).

## [2.116.0] — 2026-08-09 — Statistics from prose, and the task layer widens

### Added
- **Statistics questions pasted as prose** answer from the real stats
  engines, inline in Solve and the canvas: "Find the mean of 3, 5, 8
  and 12" (asked statistic first, full summary after, the VALUES READ
  listed back — a comma is always a separator, never a thousands
  mark); "standard deviation of …" states SAMPLE (n − 1) and shows the
  population figure alongside; mode reports ties or "no mode"
  honestly; "Is A: 1,2,3,4,5 different from B: 6,7,8,9,10?" runs
  Welch's t-test (paired on request, equal lengths enforced by name);
  "correlation between x: … and y: …" gives r, r², p and the fit line.
  Refusals are named: a stats question with no numbers, mismatched
  pair lengths, or SD of one value says exactly what is missing. The
  full toolset (diagnostics, ANOVA, survival…) remains the Stats mode.
- **The task layer widens**: "Evaluate the limit of sin(x)/x as x
  approaches 0" routes to the limit engine (pane switches kind with a
  note; canvas answers inline); "Find the sum of 1 to 100" and
  "Factor the expression x² − 5x + 6" now work with their task
  verbiage attached — prose words parse as innocent-looking variables,
  so extraction runs BEFORE parsing, where a parse that cannot fail
  could never trigger it.

### Notes
- Independent adversarial pass: the engines verified numerically clean
  (54 descriptive lists, Welch/paired t against independent
  implementations, correlation signs) — the defect was the TRIGGER.
  Keyword + any stray number stole equations and word problems with
  confident wrong statistics ("x − mean = 4" → "mean = 4"; "the mean
  of 5 numbers is 12…" → "mean = 9"). Fixed and pinned: descriptive
  intents now require a CONTIGUOUS comma/and-separated list of ≥ 2
  values and never fire on text carrying =, <, > — word problems get
  a named refusal pointing at the Word-problem kind, and prose-stray
  numbers (dates, counts) can no longer join the list. Zero-variance
  correlation refuses by name instead of showing the impossible
  "r = 0 (r² = 1)".

## [2.115.0] — 2026-08-09 — The question says what to DO

"Find the derivative of f(x) = 3x² + 4x − 2" pasted into the equation
kind was answered by SOLVING the equation — technically responsive,
actually wrong (user-reported).

### Added
- Intent routing: when the pasted prose names the task (derivative /
  differentiate, integral / integrate / antiderivative), the pane
  SWITCHES to that kind, says so, and answers the question that was
  asked. The pop-out canvas (whose kind is fixed) answers inline with
  the same note. The switch happens only when the extracted content
  actually differentiates/integrates — garbage never flips the kind.

## [2.114.0] — 2026-08-09 — The trailing full stop

The REAL root cause of the user's report, found only when the probe
used their EXACT pasted text: "f(x)=|x+ 4|." — with the sentence's
full stop. One character made the pane answer NOTHING and the canvas
surface a raw parser error. Every earlier probe had quietly tested the
cleaned string; the instrument was lying about the input.

### Fixed
- Trailing sentence punctuation (. ; , ?) at the very end of pasted
  input is stripped by the paste folder, with a note saying so.
  Decimals and interior punctuation untouched (x = 4.5 stays 9/2).
- The canvas's mid-composition probe no longer surfaces a raw
  'Unknown function "f"' — it names the situation and the way out
  ("if it was pasted from a sentence, keep just the formula").
- **Prose before the equation is dug out** — "A function f is defined
  by f(x) = 3x² + 4x − 2. For what values …" pasted whole now solves,
  in the pane AND the canvas, with a step showing what was read out of
  the sentence. Deleting the prose by hand is no longer the user's
  job. The extractor also accepts function DEFINITIONS with no
  closed-form solve (f(x) = |x+4|), and it moved out of the taskpane
  into src/lib where the canvas can share it and the tests can see it.
- **The Derivative box takes pasted questions whole** — "Find the
  derivative of the function f(x) = 3x2 + 4x − 2." answers 6x + 4 with
  the read-out-of-the-sentence step. Works with or without an "=" (the
  =-less extractor rejects candidates still containing prose words,
  which otherwise parse as fake variables).
- **Degraded superscripts repaired** — many sites copy x² as plain
  "3x2", which parsed as 3·(a variable named x2), silently wrong. The
  paste folder rewrites digit·letter·digit shapes (3x2 → 3x²) and
  coefficient-less ones (1/x2) when the same letter appears standalone
  — always with a note, and never touching a system's genuine x1/x2
  variables (a mid-development regex crossed a newline and welded a
  two-line system into garbage; caught before ship and pinned).

## [2.113.0] — 2026-08-09 — The PLOT tool learns the same notation

The user's "Unknown function f" turned out to come from the PLOT tool —
which has its own parser and never got v2.112.0's notation fixes.
Found by driving the real bundle headlessly with the exact input after
every engine probe came back clean: the error's SOURCE file, not the
assumed one, was the fix site.

### Added
- Plot accepts f(x) = |x + 4| (and y = …): the definition prefix is
  stripped — this is a plotter, the definition IS the curve — and
  |·| bars fold to abs via the same lexer Solve uses. Known function
  names never count as a prefix (sin(x) = 1 stays refused: an equation
  is not a curve), and the stripped argument must be x, the plot
  variable. All pinned.

## [2.112.0] — 2026-08-09 — Textbook notation: |bars| and f(x) = …

Straight from a user hitting the wall with f(x) = |x + 4|.

### Added
- **Vertical-bar absolute value**: |x + 4| = 2 now parses everywhere —
  folded innermost-first so nested bars work (||x| − 2| = 1 answers all
  four roots), in equations, inequalities (|x − 1| < 3 reaches the
  abs machinery), and every other box. A stray single bar is refused,
  not guessed at.
- **Function-definition notation**: f(x) = x² − 4 is read as the
  DEFINITION it is — a step says "y stands for the output f(x)", it
  solves for the definition's own variable by default, the solve-for
  chips offer y, and the derivative, antiderivative and integral boxes
  all accept the pasted definition whole. sin(x) = 1/2 is still an
  equation — known function names never trigger the definition reading.

### Notes
- Independent adversarial pass found 2 defects in the first cut, fixed
  and pinned: (1) nesting only held one orientation — |5 − |x|| = 3
  mangled and refused (the fold is now a proper open/close bar lexer,
  with adjacent bars inheriting their neighbour's role); (2) Word's
  sentence-start AutoCorrect made "Sin(x) = 1/2" read as a definition
  and answer y = 1/2 with confidence — function-name matching is
  case-insensitive now, so it refuses informatively again. It also
  verified the bar fold cannot touch any other grammar (logic OR,
  matrix determinants, geometry, units all use their own tokenizers).
  Recorded limitation: NESTED-abs inequalities refuse (one case-split
  layer) while the nested equations solve.

## [2.111.0] — 2026-08-09 — Powers, sums and the algebra verbs

The rest of the equation audit's ranked list.

### Added
- **Power isolation in symbolic rearrangement**: V = (4/3)πr³ solves
  for r → cbrt(3V/(4π)); E = σT⁴ for T → the ± fourth-root pair with
  "an even power is never negative, so the pair is real only when
  E/σ ≥ 0" STATED; odd powers note their single real root. Numeric
  power equations keep the complete Durand–Kerner path (x³ = 8 still
  returns all three roots); a middle term still refuses honestly.
- **Finite sums with closed forms**: sum of 1 to 100 → 5050 (exact
  bigints, any bounds incl. negative; the empty sum says it is empty);
  sum k^2 from 1 to n → n(n+1)(2n+1)/6; k³ as the squared triangular
  number; geometric series exact for numeric bases and as the formula
  (r ≠ 1 stated) for symbolic ones. Σ 1/k is REFUSED BY NAME — the
  harmonic series has no elementary closed form, and saying so is the
  answer.
- **factor / expand / simplify verbs**, routed to machinery the CAS
  has had all along: rational-root factoring with multiplicity
  ((x−1)³ recognised, common factors pulled, x⁴−1 →
  (x−1)(x+1)(x²+1)), exact expansion, CAS canonicalisation. Factor
  claims only RATIONAL factorisation and says whether "no rational
  roots" was proven or capped. EVERY factored and expanded result is
  verified by multiplying back before it is shown — a factorisation
  that does not multiply back is discarded, not displayed.

### Notes
- Independent adversarial pass (400-case sum fuzz vs brute force clean;
  every power-isolation root verified at positive AND negative
  parameters; factor/expand outputs independently re-multiplied) found
  5 defects, fixed and pinned: (1) HIGH — negative sum bounds looped
  once per term, so a pasted "sum k from -1000000000 to 0" was a
  frozen Word; the negative prefix is now a closed form (instant);
  (2) a zero-denominator geometric base threw a raw CasBail;
  (3) equations whose VARIABLE is named sum/factor ("sum = 4") were
  stolen from the equation solver — no sum/verb grammar contains "=",
  so they now fall through; (4) a malformed base ("2.5.3") was
  silently misread as 2.5; (5) correct big expansions ((x+1)^58+) were
  refused by their own float verification — verification is exact now,
  and coefficients past 2⁵³ carry a precision caveat instead of a
  refusal. Plus: −1 leads factor as a bare minus, trivially-true
  ≠ 0 conditions (4π/3) are no longer stated, and simplify carries a
  0/0 domain caveat when it cancels a division.

## [2.110.0] — 2026-08-09 — The equation engine, comprehensive

An audit of the whole solve surface (~70 probes, all verified by
substitution) found four wrong answers and ranked the missing forms.
This release fixes every wrong answer and builds the top of the list.

### Fixed (wrong answers)
- **(x²−1)/(x−1) ≥ 0 included x = 1** — the point where the expression
  is 0/0. The canonicaliser's GCD cancellation erased the hole before
  the pole scan saw it; the UNREDUCED expression is now the authority
  (new `domainHoles`), so the answer is [−1, 1) ∪ (1, ∞), and the
  identity path names its holes too: "(x−1)/(x−1) = 1" now answers
  "every value EXCEPT x = 1".
- **Decimals wearing the [exact] tag**: x² = 2 answered
  "1.41421356237 [exact]". Rational-coefficient linear/quadratics now
  ride an exact-rational twin of the coefficient extractor and answer
  in TRUE exact forms — 1/3, ±sqrt(2), 1/2 ± sqrt(5)/2, 2/3·i —
  every display re-parsing to its own value; irrational-coefficient
  equations (2πr = 10) keep their decimal and honestly DROP the flag.
- **x^(1/3) = −2 found nothing** while cbrt(x) = −2 answered −8: a
  negative base to an odd p/q power now evaluates to its real root.
- **Provably impossible equations blamed "the range searched"**:
  abs(x) = −1, sin(x) = 2, sqrt(x) = −2, exp(x) = 0 are now refused by
  the RANGE argument itself ("|·| is never negative…"), before any scan.

### Added
- **Trig equations answer with their GENERAL solutions**: sin(x) = 1/2
  is x = π/6 + 2πn and 5π/6 + 2πn — exact at the special angles,
  numeric principal values elsewhere, linear arguments folded through
  (sin(2x) = 1 → π/4), quadratics in one trig atom solved on both
  branches, tan on its own π period. This replaces the 637-numeric-root
  wall (which was also silently missing ~8% of them near poles); any
  remaining numeric flood is capped in the pane with an honest count.
- **Exponential/log closed forms**: 2^x = 8 → exactly 3; 5^x = 3 →
  ln(3)/ln(5); exp(2x) = 5 → ln(5)/2; ln(x) = 1 → exp(1); every answer
  verified by substitution before it is returned. (The old scan MISSED
  ln(x) = −1 entirely; it now answers exp(−1).)
- **Chained inequalities**: −3 < 2x+1 ≤ 7 → (−2, 3], both directions,
  mixed directions refused by name, three-comparator chains not misread.
- **Absolute-value inequalities** by definition, not case-guessing:
  |x−1| < 3 → (−2, 4); |x| ≥ 2 → (−∞, −2] ∪ [2, ∞); negative
  right-hand sides answered immediately in both directions.
- **sec/csc/cot** parse, evaluate, differentiate, and FOLD to their
  primary functions for solving (sec(x) = 2 → the exact ±π/3 families;
  sec(x) = 0.5 → refused by range); **½-style vulgar fraction glyphs**
  (what Word's AutoFormat produces) now parse.

### Notes
- The behavioural baseline diff was reviewed line by line: 15 changes,
  every one an intended improvement, including one silently-wrong old
  result (ln(x) = −1 → no roots) now correct.
- Independent adversarial pass: the exact-display contract held over a
  440-equation sweep (729 roots re-parsed and substitution-verified,
  zero failures), the trig battery (40 shapes, families verified seven
  periods deep) and 33 brute-verified inequalities came back clean. It
  found 2 real defects, fixed and pinned: (1) the exp/log exact path
  had no display cap — 2^x = 1e300 put a 309-character "exact" line
  into the pane (now the same 48-char cap as quadratics, decimal +
  no tag past it); (2) a quadratic-in-trig root computed EXACTLY as
  1 + 1e-13 was clamped to 1 and answered ±π/2 [exact] for an
  unsolvable equation — exact out-of-range t now refuses, and only
  float-noise t within 1e-12 of ±1 clamps, with a caveat saying so.
  Also: the integer-power fold now reaches 2^x = 2^94.

## [2.109.0] — 2026-08-09 — Sketch data → function

### Added
- **Sketch data → function** (Solve → Equation → Open canvas): click data
  points on a four-quadrant snapped grid (click a point again to remove
  it), and every model that legitimately runs — linear, quadratic, cubic,
  exponential, logarithmic, power — is offered as a chip with its
  adjusted R². NOTHING is auto-picked: a model chosen by software is a
  conclusion the user did not draw. Choosing a chip shows the overlay
  (the points with exactly that curve) and writes `y = <expression>`
  into the input, so rearrange/graph/insert all run on the formula the
  user chose.
- **The honesty rules**, enforced by construction: the R² beside each
  formula is recomputed FROM the displayed (rounded) expression via the
  product's own parser — the number describes exactly the formula shown;
  models with domain requirements are SKIPPED BY NAME (exponential needs
  every y > 0 — it is fitted through log y, and says so), never
  force-fitted; two points sharing an x with different y are refused
  ("no function of x passes through both"); exact interpolation (as many
  parameters as points) is labelled "not evidence of the model"; ranking
  uses ADJUSTED R² because plain R² always flatters extra parameters;
  a hand-edited input clears the overlay (a curve the request stopped
  describing must not keep asserting itself); a log fit's curve BREAKS
  at x ≤ 0 instead of drawing through the undefined region.
- 22 new tests (generator-recovery oracles, the R²-reproducibility
  contract, named refusals, the x^(-0.5) parenthesisation trap) and
  3 figure-corpus entries (floor 164 → 167).

### Notes
- Independent adversarial pass: the core contract HELD under 11,665
  fits across 4,000 random point sets (reported R² vs an independent
  recompute — max difference zero; a good-claimed-but-wrong R² is
  impossible by construction) and no model can silently vanish. It
  found 3 defects, fixed and pinned: (1) when n ≤ params + 1 the
  "adjusted R²" chip silently showed PLAIN R² — handing the win to the
  biggest model exactly where flattery is strongest; adjusted is now
  honestly undefined (n/a), such models rank last and carry a caveat,
  and interpolation is caveated even when rounding degrades its R²;
  (2) adding/removing a point left the previous fit's overlay and
  formula asserting themselves over the new data — the overlay now
  clears when the data changes; (3) the corpus's own surface exemplar
  contained a point the surface cannot produce (y beyond its clamp).

## [2.108.0] — 2026-08-09 — The canvas measures, and the figure keeps your placement

### Added
- **Live measurements while drawing** (in the canvas's grid-free footer,
  next to the coordinates): the rectangle's w × h and area before the
  second corner lands, the circle's radius and area at the rim, the
  segment's length, the polygon's area-if-closed-now — and with Select,
  hovering an edge reads out that edge's length, a circle its radius.
- **Placement-faithful figures**: a request that came from the DRAWING
  carries its shapes back to the pane, and the figure that previews and
  INSERTS shows the user's actual construction to scale — labelled base
  and hatched cutouts at their true positions, captioned "placement as
  drawn". The generic composite figure's "placement illustrative"
  disclaimer exists because typed input has no positions; a drawn one
  does, so the disclaimer goes. Drawn rectangles, circles and segment
  pairs — which had no figure at all — now insert one too. The shapes
  travel only while they still MATCH the text (edit the request by hand
  and the pane falls back to the generic figure), and the payload is
  structurally validated on arrival.

### Notes
- Independent adversarial pass found 4 real defects, fixed and pinned:
  (1) a first-shape-only fallback (overlapping cutouts) still carried
  ALL drawn shapes into the inserted figure — shapes the answer ignores;
  the carry now requires the emitted text to describe every shape, gated
  at both ends of the channel; (2) segment labels survived only the
  symmetric X the corpus tested — any asymmetric crossing struck or
  collided them, so segment lengths moved to the caption strip, which
  nothing can cross; (3) touching tiny cutouts collided their labels —
  labels now sidestep each other; (4) the circle preview promised
  r = 9.5 where the click commits r = 8 — the preview now carries the
  same cap as the click, in the readout AND the rubber circle. The two
  breaking layouts joined the figure corpus (floor 162 → 164), and the
  hovered-rectangle readout now leads with the edge's own length.

## [2.107.0] — 2026-08-09 — Draw to solve

The geometry canvas grows a DRAWING SURFACE: click out a shape and it is
solved as you draw it.

### Added
- **Draw-to-solve** (Solve → Geometry → Open canvas): a snapped half-unit
  grid with Triangle / Rectangle / Circle / Polygon / Segment tools, a
  Select tool whose handles DRAG (every number updates live), rubber-band
  previews, a live coordinate readout, undo/clear, double-click or Close
  to finish a polygon, Esc to abandon a half-built shape.
- **The drawing is an input method, not a second engine**: every gesture
  becomes text in the existing geometry grammar, written into the input
  box — so the exact arithmetic, the figures, the insert path and the
  user's own eyes all run on ONE request, and the surface teaches the
  grammar as it goes. Snapping to halves keeps every emitted dimension
  exact (7/2, never 3.4999…).
- **Composites by drawing**: rectangle/circle shapes drawn fully inside a
  rectangle or circle base read as CUTOUTS (painted red on the surface
  exactly when the solver will read them so) and emit the composite
  grammar; two segments read as a line-intersection question. Anything
  more exotic solves the first shape and says so, rather than guessing.
- The pane hint and canvas hint both name drawing; 38 new tests including
  the anti-button-shaped-bug sweep (every emittable request — including
  every one-handle drag of every test state — must be ACCEPTED by the
  engines) and 3 new figure-corpus entries (floor 156 → 159).

### Notes
- The coordinate readout lives in a grid-free footer strip: text laid
  over a full-bleed grid always crosses a grid line, and the layout gate
  rightly refused the first cut.
- Independent adversarial pass (408-emission fuzz came back clean on the
  architecture) found 3 real picture-vs-arithmetic defects, all fixed
  and pinned: (1) OVERLAPPING or nested cutouts emitted a composite that
  subtracts the shared region twice while the surface painted them as a
  faithful reading — cutouts must now be pairwise disjoint (tangency
  fine), decided by the ONE function both the emitter and the painter
  call; (2) a self-crossing polygon was filled as an enclosed region
  while the shoelace request reported the signed area (a bowtie claimed
  area 0 "because collinear") — the request is now withheld with the
  reason, the polygon paints hollow, and the engine's zero-area caveat
  distinguishes collinear from self-crossing; (3) a circle's radius grip
  could leave the 16×10 world and become permanently unreachable — the
  grip now flips to whichever compass side fits, radii clamp at
  creation, and a stranding centre-move refuses. Plus: footer clicks no
  longer mint y=0 vertices, pointercancel clears a phantom drag, and the
  two-line slope arrives reduced (it printed 4/4).

## [2.106.0] — 2026-08-09 — The comprehensive geometry suite

The unbuilt half of docs/GEOMETRY-TOPOLOGY-DESIGN.md, shipped at once — and
plain geometry finally DRAWS.

### Added
- **Circle toolkit** (the Tier-1 half named in the brief and never built):
  `sector r=5 angle=60` · `segment r=4 angle=90` · `arc r=6 angle=120` ·
  `tangent r=3 d=5` (tangent length √(d²−r²), the two-tangent angle; a
  point INSIDE the circle refused by name) · `inscribed angle=80` (half
  the central angle, Thales named at 180°). Area/arc exact with π;
  angles in degrees; >360° refused, =360° answered as the whole circle.
- **Eight new solids**: hemisphere · square pyramid (exact surd slant) ·
  triangular prism (surface honestly refused — b and h don't determine
  the sides) · cone frustum (r1/r2, r/R alias; r1=r2 named a cylinder) ·
  spherical cap (h>2r refused, h=2r named the whole sphere) · torus
  (exact `·π²` forms; spindle R<r refused rather than double-counted) ·
  ellipsoid (exact volume, Thomsen surface labelled approximate) ·
  regular tetrahedron (volume/surface/height as exact surds).
- **Triangle radii**: every solved triangle now reports inradius and
  circumradius, exact when Heron's radicand is rational (3-4-5: r = 1,
  R = 5/2), in both SSA solutions too.
- **Conics completed**: vertices surfaced (they were computed and
  dropped), directrices reported (a/e for ellipse/hyperbola), and the
  parabola finally has its anatomy — vertex by completing the square in
  the rotated frame, focus, directrix — even with an xy term.
- **2D transformations, homogeneous** (Tier 4's missing half): rotate
  (EXACT at quarter turns — rotate 90 (1,0) answers (0,1), not
  (6.1e-17, 1)), reflect in x / y / y=x / y=-x, scale, shear, and
  TRANSLATE as a matrix — chained with `then`, `about (cx,cy)`
  conjugation, determinant reported as the area factor, orientation
  flips and collapses named, refusals by name never substitution.
- **Point-in-polygon routed**: `inside (1,1) polygon (0,0) (4,0) (4,4)
  (0,4)` (and `… contains (x,y)`), by the exact winding number that has
  sat exported-but-unreachable since Tier 2 — boundary reported as
  boundary, not rounded to a side.
- **Plain geometry draws** — the headline. Composite figures were the
  only geometry that drew; triangles (BOTH SSA solutions, side by
  side), point sets/polygons (centroid, hull, probe verdict), all four
  conic kinds, circle-through-3-points, and the circle toolkit now
  attach figure data and render to scale in the pane, the pop-out
  canvas and the inserted document, each with alt text written by the
  branch that drew it. The solve-draw ratchet is RAISED accordingly,
  and 14 new figures joined the layout corpus (floor 139 → 156).

### Fixed
- The figure-layout gate caught 9 label strikethroughs in the first cut
  of the triangle/point figures (a sliver triangle has no interior room
  for vertex labels): side labels now offset perpendicular to their own
  edge, angle readouts moved to the caption, point labels push outward.

### Notes
- 118 new tests (oracle suite, figure suite, adversarial pass) plus an
  exact-string re-parse sweep: every displayed exact form parses back in
  the product's own grammar and evaluates to its own decimal.
- Independent adversarial pass: 4 real defects behind green tests, all
  fixed and pinned — (1) a major-along-y ellipse/hyperbola DREW along x,
  putting both foci outside its own curve (values were right, the
  picture lied); (2) near-degenerate SSA leaked NaN angles, an Infinity
  circumradius and an all-NaN figure (law-of-cosines clamp + no-figure
  guard + the canvas now shows "—" for undefined); (3) "rotate 90 (2,3)
  about (1,1)" silently transformed the CENTRE and reported its own
  fixed point; (4) "rotate 90 45" silently dropped the 45, and "rotate
  1e3" tokenised as 1° — both now refuse or read correctly. Plus two
  honesty upgrades from the same pass: zero/negative dimensions get a
  named refusal instead of "couldn't read that", and a typed unit
  (sector r=5in) is flagged as dropped rather than silently ignored.

## [2.105.0] — 2026-08-08 — The two integration gaps, closed

The two refusals casint.ts has carried since v2.6.0:

### Added
- **Trig power reduction**: ∫sin²x = x/2 − sin(2x)/4 and the cos² twin,
  by applying the double-angle identity the canonical form cannot prove
  and integrating the rewrite — for any inner function the machinery can
  then handle (sin²(3x) works; sin²(x²) still refuses honestly).
- **The cyclic-by-parts family**: ∫e^(ax+b)·sin(cx+d) and the cos twin
  in closed form — e^(ax)(a·sin cx − c·cos cx)/(a²+c²) — the "apply by
  parts twice and solve for the integral" result, with signs, ordering,
  constants and phase shifts all handled. Verified CANONICALLY (a
  symbolic proof, not sample evidence). By-parts reach compounds:
  ∫x·sin²x and ∫eˣ·sin²x now also work.
- **Cross-engine win**: the ODE y' = sin(x) − y, previously refused
  because its integrating-factor integral was, now solves and verifies.
- Higher powers (sin⁴), exp of nonlinear arguments, and triple products
  still refuse by name — sec(x) and ln(x)² are now the honest exemplars
  in the engine-gap test.

### Notes
- Adversarial pass: zero defects found — every sign/order/constant
  permutation probed exact at off-sample points; near-miss forms refuse
  fast; baseline snapshots unchanged (nothing had pinned the old
  refusals); the verified-flag wording stays truthful on both paths.

## [2.104.0] — 2026-08-08 — Solve with units

The last item on the CAS roadmap's list: equations whose knowns carry
units, with the answer's unit DERIVED, never assumed.

### Added
- **Units-aware solving** (equation kind, src/lib/unitSolve.ts): formula
  on the first line, knowns below — F = m a / m = 3 kg / a = 2 m/s² →
  **F = 6 N** (kg·m/s²). Symbolic rearrangement first (same CAS path,
  conditions and all), SI conversion exactly once and REPORTED
  (3 km → 3000 m), then dimension-aware evaluation: adding quantities of
  different dimensions is refused naming the exact subtrees and units;
  sin of metres is refused with guidance (sin of an ANGLE works — the
  tool converted your degrees itself); exponents must be pure numbers;
  √ halves dimensions (pendulum period comes out in seconds). Named
  units where unambiguous (N, Pa, J, W, C, V, Ω — deliberately not Hz:
  bare s⁻¹ is also rad/s and Bq). Multiple algebraic branches are
  evaluated and the physically usual (positive) one presented, with the
  others DISCLOSED by value. Plain systems without units are untouched.

### Fixed (adversarial pass: 9 findings)
- The engine's dim key is `temp`, not `temperature` — kelvins were being
  silently DROPPED from displayed units (Q/(m·ΔT) showed m²/s², and a
  bare temperature showed no unit at all). Unknown dim keys now render
  under their own names, never dropped.
- v = −3 m/s was presented as THE speed (the −√ branch is ordered
  first), with a caveat falsely claiming the branches "differ in sign".
  The positive branch is now chosen and the alternative shown by value.
- Fraction knowns (m = 1/2 kg) were dead code (regex alternation order);
  trig of a converted angle was refused self-contradictorily; mismatch
  messages named "(…)-part" instead of the offending subtree; fractional
  dimensions rendered garbled; duplicate ≠-conditions deduped.

## [2.103.0] — 2026-08-08 — Symbolic ODEs, and three known limits closed

### Added
- **Symbolic differential equations** (Solve → Differential equation,
  src/lib/odeSymbolic.ts): exact solutions with the work shown for the
  four first-course families — y' = f(x) (direct integration),
  y' = f(x)·g(y) (separable, with y' = ky exponentiated to y = C·e^(kx)
  and lost constant solutions named), y' = q(x) − p(x)·y (integrating
  factor, worked), and a·y'' + b·y' + c·y = 0 (characteristic equation:
  real, repeated or complex roots). EVERY solution is verified by
  substituting back into the ORIGINAL equation before it is shown; the
  three-member solution family (C = −1, ½, 2) is DRAWN; anything outside
  the families — nonlinear, variable coefficients, third order — is
  refused by name with the supported list. Eight palette templates; the
  equation canvas solves and graphs the family live. (Numeric/stiff IVPs
  remain in Analyze → ODE solving, which this deliberately does not touch.)
- **Known limits closed**: two-line stacked-fraction pastes reassemble in
  the pane's expression kinds (the canvas keeps one-curve-per-line); the
  unrecoverable 5/9→59 collapse now gets a heads-up note when the input
  shows real paste artifacts (never a rewrite, never on clean typed
  input); the rate template reads inflected and verb-first phrasing
  ("When x increases by 1, y increases by 2").

### Fixed (adversarial pass: 6 findings)
- A nonhomogeneous second-order equation whose forcing term vanished at
  the classifier's two sample points was solved as homogeneous and
  CERTIFIED VERIFIED — the verifier re-derived truth from the extracted
  coefficients. It now substitutes into the original equation (the
  "sampling cannot find poles" lesson, again).
- ODE inputs no longer get the false "′ has no reading" note (the prime
  IS the reading there), and named-unreadable characters alone no longer
  arm the 5/9 nudge.
- y''' is refused by name instead of "unbalanced parentheses"; y'' = 0
  no longer displays exp(0 x); fraction amounts with decimal
  denominators (1/2.5) evaluate instead of silently misreading as 1/2.

## [2.102.0] — 2026-08-08 — SAT-style word problems: rates judged, choices checked

### Added
- **Rate-interpretation problems** (Word problem kind): paste the whole
  question — equation, prose, answer choices. For a linear relation the
  exchange rate is computed EXACTLY both ways (dC/dF = 5/9, dF/dC = 9/5,
  by implicit differentiation with CAS-exact display), and every answer
  choice matching the "increase of a in X is an increase of b in Y" shape
  is judged TRUE or FALSE with the arithmetic shown — signed: increase vs
  decrease verbs are honored, so mixed-direction claims and negative
  slopes judge correctly. Direction-neutral "change of" claims judge
  magnitude; a neutral change mixed with a signed verb is refused as
  unjudgeable. Statements that can't be read in the checkable shape are
  COUNTED and disclosed, never guessed at. Nonlinear relations are
  refused by name — their exchange rate depends on where you start.
- Every verdict restates the equation it followed from, with the caveat
  that rendered fractions can collapse in the clipboard (5/9 pastes
  as 59) — the premise is checkable at a glance.

### Fixed (adversarial pass: 3 fixed in place, 3 disclosed)
- Mixed-direction claims were judged as if both sides said "increase" —
  "an increase of 1 in x is a decrease of 2 in y" got the WRONG verdict
  on both positive and negative slopes. Verbs are now captured and the
  comparison is fully signed.
- Statements whose unit words were never named in the prose were
  silently skipped instead of counted as unjudged.
- The unit map's comment claimed a first-letter fallback that never
  existed — semantics now stated truthfully (no guessing, deliberately).
- Also wires rateInterpretation into solveWordProblem (v2.101.0 shipped
  the module a commit early, unreferenced).

## [2.101.0] — 2026-08-08 — Paste the whole problem

Driven by a real paste that failed with "unexpected character '='": a
full SAT-style problem — equation, question prose, answer choices — read
line by line as mathematics.

### Added
- **Equation extraction from problem statements** (equation kind): lines
  that read as equations are kept (textbook framing like "Let …" and
  "and …" stripped, so "Let y = 2x + 1 / and x = 3" becomes a solvable
  system), prose is dropped, and the note says exactly what was kept and
  what was ignored. A pure system passes through untouched.

### Fixed (adversarial pass: 3 findings)
- An equation the parser deliberately REFUSES (the 1/2x ambiguity gate)
  is KEPT so its named refusal reaches the user — extraction was
  silently deleting it and confidently solving the leftover equations.
- "x < 3 means x is small" is no longer certified as "the equation" —
  strict-inequality sides longer than a few tokens are prose.
- Framing words no longer become variables ("Let y" parsed as Let·y).

## [2.100.0] — 2026-08-08 — Fraction equations, from paste to worked answer

Driven by a real paste that failed: a rendered 3/(x+3) = 8 copied from a
web page arrives as its LAYOUT — numerator line, denominator line, "=8" —
and Solve read the lines as a system.

### Added
- **Stacked-fraction paste reassembly**: the unambiguous three-line
  clipboard shape (two =-free lines, then a bare "= rhs") rebuilds as
  (num)/(den) = rhs, with a note saying exactly how it was read. A real
  system (every line carries =), a topology point cloud, and two-line
  graph entries are never touched — an ambiguous paste is left alone
  rather than guessed.
- **Worked fraction equations**: 3/(x+3) = 8 now shows the student's
  move — "Multiply both sides by (x + 3) — allowed because a solution
  must keep it nonzero" → the cleared polynomial → collect → divide →
  x = −21/8. Two denominators clear into their quadratic (with factoring
  when the roots are rational: 6/x = 5 − x → (x − 2)(x − 3)); when
  clearing changes the root count, the work stops at a neutral caution
  instead of presenting an excluded or complex candidate as a solution.
- The canvas graphs a reassembled fraction paste as its two sides — the
  crossing IS the solution on screen.

### Fixed (adversarial pass: 4 findings)
- The caution line no longer claims dropped candidates were pole values
  when they may be complex roots ("discarding any value that makes a
  denominator zero" was false for 1/x + x² = 0).
- Symbolic-path roots (re = NaN, value only in `display`) are evaluated
  for the factoring verification — cleared quadratics now factor instead
  of silently falling to the formula.
- "x = pi" no longer gets a redundant collect line restating itself as a
  rounded decimal.

## [2.99.0] — 2026-08-08 — Show your work

Solve results now carry the derivation a student would be required to
write — in the pane, in the equation canvas, and in the inserted Word
equations.

### Added
- **Worked equations** (src/lib/showWork.ts): linear solves show
  collect → divide → answer; quadratics FACTOR when a student could
  ((x − 2)(x − 3) = 0, "a product is zero exactly when a factor is
  zero") and otherwise show the quadratic formula with the numbers
  substituted; a zero discriminant is named as one repeated root; cubics
  and higher factor completely when every root is rational.
- **Worked derivatives**: the rule applied at each level — term by term,
  constant factors carried through, product/quotient rule with u, v, u′,
  v′ written out, power rule, chain rule with the derivative table line —
  ending in the engine's own assembled result.
- **Worked integrals**: F(b) − F(a) with both values substituted — the
  fundamental theorem written out, using the pane's own bound labels
  (F(pi), not F(3.14159)).
- The work is DERIVED FROM the engine's answer and verified against it;
  on any mismatch the work is withheld — no work beats wrong work.

### Fixed (adversarial pass: 6 findings)
- An integral the engine says does not exist (∫1/x² across its pole) no
  longer gets fundamental-theorem work ending "= NaN" — a NaN slipped
  past a subtraction-style guard, reintroducing the exact
  NaN-into-Word-equation failure documented ten lines above it.
- d/dx (sin(3) + x) no longer fabricates a rule line about sin(x) —
  constant subtrees now differentiate to a stated 0.
- u′ lines and the assembled line are simplified like the engine's
  answer (no `2*x^(2 - 1)*1` presented as "simplified").
- Work-line superscripts render properly in the pane (the typeset bridge
  now runs on work math; previously only the "(" was raised), "term by
  term" is said once, x² = 0 shows its repeated root instead of
  (0 ± √0)/2, and factored forms never print "-1(" or "(x - 0)".

## [2.98.0] — 2026-08-08 — Paste from anywhere; the canvas becomes a workbench

"It's limiting… almost like the ability to write it or copy and paste
from another source" — so now it reads what people actually paste, and
the canvas solves and graphs while you work.

### Added
- **Paste from anywhere** (src/lib/pasteMath.ts): equations copied out of
  rendered Word equations, PDFs and web pages just work — math-italic
  letters (𝑥 → x, every Unicode style by codepoint arithmetic), Greek
  variables (θ → theta, solvable symbolically and typeset back as θ),
  **LaTeX** (\frac, \sqrt, ^{}, $-delimiters), vulgar fractions (½ and
  1⁄2, mixed numbers read as ten-AND-a-half), invisible characters and
  typographic spaces. Every transformation is REPORTED in a note under
  the input; what has no single faithful reading (±, ∂, ℝ, Σ) is named,
  never guessed.
- **The canvas solves live**: roots with solve-for chips, systems with
  their classification, inequalities as intervals, limits and Taylor
  series, derivative, antiderivative with its differentiate-back check,
  definite integrals with new bounds boxes — the same engines the pane
  inserts from.
- **The canvas graphs like a graphing calculator** (src/lib/graphCalc.ts):
  one curve per line, `y = …` entries, an equation graphs BOTH sides so
  the crossings are the solutions, window under your control, poles stay
  gaps (1/x is two branches, never a wall), every ungraphable line says
  why.
- **Searchable equation library**, tripled: mechanics, electricity &
  waves, thermo & chemistry (dilution C₁V₁ = C₂V₂, Beer's law with ε),
  growth & finance — every formula loading ready to solve for any symbol,
  Greek included. Greek palette group; calculus templates for the
  Differentiate kind.

### Fixed (adversarial pass: 7 findings, all value-pinned in tests)
- LaTeX letter runs were becoming single invented identifiers — E = mc²
  solved for a variable called "mc", \sin x read as sin·x. The converter
  now keeps letter atoms separate products and gives \sin-family commands
  their argument.
- Precomposed ½ (what Word autoformat writes) was unread; 10½ now reads
  as ten-and-a-half, not 10·½ = 5.
- Bold digamma no longer misread as Alpha/Beta (Greek run bound), x_θ
  keeps its subscript binding, adjacent Greek letters stay separate
  variables, and geometry inputs no longer receive the equation-side
  advice about ″ and ° that the geometry engine reads natively.

## [2.97.0] — 2026-08-08 — The equation canvas: pop out, draw, real symbols

The follow-up asks, delivered: a large canvas pop-out for Solve, the
equation DRAWN as real mathematics while it is composed, and symbols
instead of plain-english spellings — the √ sign itself, not "sqrt".

### Added
- **Open equation canvas ⤢** (Solve): the composer in a large Office
  dialog — the current input rides along, the equation drawn LARGE at the
  top as it is built, the full palette and equation library at working
  size, and a live "Reads as…" line validated by the SAME engines the
  pane solves with. "Use this equation" hands it back; the pane restores
  the kind the canvas was opened for. For the geometry kind the canvas
  draws the COMPOSITE FIGURE live as it is described.
- **Real symbols in the palette**: √() inserts the radical sign (the
  parser reads √(x+1), √4, √sin(x) natively), x²/x³ insert real
  superscripts, ≤ ≥ ≠ insert the glyphs — input can now look like the
  mathematics it is.
- **Live typeset preview in the pane**: the Solve input draws itself as
  real mathematics (radical bars, stacked fractions, relation glyphs)
  under the box while typing — powered by a new solve-grammar →
  typesetting bridge (src/lib/solveTypeset.ts) that the OMML insert path
  accepts too.

### Fixed (adversarial pass over this diff)
- Limit/Taylor PROSE (`limit sin(x)/x as x -> 0`) is recognised as prose:
  the canvas's validation line now reads it the way the pane does instead
  of calling valid input unreadable, and neither surface "typesets" the
  keywords as juxtaposed variables pretending to be mathematics.
- Switching the Solve kind while the canvas is open no longer pastes the
  result into the wrong kind — the return restores the kind the canvas
  was opened for (the draw canvas's own guard, applied here).
- The geometry canvas hides the empty equation strip instead of showing a
  blank band above the live figure.

## [2.96.0] — 2026-08-07 — Solve grows a composer and composite geometry

The Solve upgrade requested alongside the drawing canvas: build equations
by click the way Build draws structures, and answer real drafting-room
geometry ("a 10″ × 5″ rectangle with a triangle inside — area with and
without the triangle").

### Added
- **Composite plane figures** (Solve → Geometry): a base shape minus
  cutouts / plus additions — `rectangle 10in x 5in minus triangle b=4in
  h=3in` → area with the cutouts still counted (50 in²) AND without
  (44 in²), exactly. π and surds survive (`rectangle 8 x 6 minus circle
  r=2` → 48 − 4π; Heron triangles keep their root until it resolves).
  Units in/ft/cm/mm/m/yd, mixed units converted exactly (1 ft = 12 in as
  rationals, never floats). Prose accepted — the request above works
  verbatim, inch marks and all. Shapes: rectangle, square, circle,
  semicircle, triangle (b/h or three sides), trapezoid.
- **The figure draws**: base to scale, cutouts hatched, additions
  attached, dimension labels, area caption — and the placement
  disclaimer on its face (the areas do not depend on where cutouts sit).
  Previewed in the pane before insert; the alt text carries the exact form.
- **Equation composer** (Solve → equation/derivative/integral): a palette
  of structures (fractions, powers, roots), functions and relations that
  insert at the caret, plus an **equation library** — F = ma, PV = nRT,
  Pythagoras, kinematics, compound growth… — loading complete formulas
  the solve-for chips can rearrange for any symbol. Geometry gets shape
  and composite-figure templates.
- Honesty built in: a shape with missing dimensions is asked for them by
  name; an impossible triangle or a cutout larger than its base is
  refused; perimeter is only reported where the dimensions determine it.

### Fixed (adversarial pass over this diff — two were silent wrong numbers)
- Decimal dimensions survived sentence-punctuation stripping: `10.5` was
  becoming `10 5` and solving a different rectangle, behind green tests
  that only checked for NaN. Values are now asserted exactly.
- "with a semicircle attached / added / on top" computed a SUBTRACTION —
  the advertised addition prose now adds.
- Point-list triangles and SSA (angle-named) triangles are declined by the
  composite parser instead of being misread as side lengths — they belong
  to the classic geometry grammar and now fall through to it.
- The composite figure previews in the pane rather than being first seen
  inside the document (preview-is-not-insert, inverted).

## [2.95.0] — 2026-08-07 — Reset, Clean structure, and a compliance note

### Added
- **Reset canvas** — wipes the drawing (and the Markush flag) back to a
  fresh start. Recoverable via the editor's undo; typed R-group definitions
  deliberately survive, since undo cannot bring those back.
- **Clean structure** — re-lays the drawing out with machine-generated
  coordinates (untangles overlaps and distorted rings). Connectivity,
  charges and stereochemistry are untouched — the canonical ID code is
  identical before and after — and the hand-drawn layout is one undo away.
- **Compliance note** under the canvas, always current while drawing: an
  exceeded valence (e.g. a pentavalent carbon) or atoms drawn on top of
  each other reads **Not compliant**; a nonzero net charge is a *note*
  (an ion is real chemistry — OCL's own validate() would reject acetate).
  OCL's stereo validations are deliberately not surfaced: the same racemic
  molecule passes or fails them depending on how the object was built, and
  a verdict that flips on provenance is not one to show a user.

### Fixed (adversarial pass over this diff)
- Messages name elements, never atom indices — internal helper arrays
  re-sort hydrogens, so indices need not match the drawn order.
- Programmatic canvas refreshes (Clean, dialog return, Edit in Draw) no
  longer wipe the just-set status line one frame later — the deferred
  editor event now preserves it; user edits still clear stale status.
- Reset no longer erases typed R-group definitions (undo could not restore
  them); a compliance re-check failure cannot turn a successful clean into
  a thrown click.

## [2.94.0] — 2026-08-06 — A big canvas for real drawing

Second round of in-Word feedback: it draws, but the canvas is cramped.

### Added
- **Open large canvas** — pops the same editor into a near-full-screen
  Office dialog window. The pane's molecule rides along (full-fidelity
  idcode encoding, Markush flag included); draw at size, click **Use this
  drawing**, and it lands back in the pane ready to insert. Oversized
  structures that cannot ride the URL open a blank canvas with both windows
  saying so (never a silent replace).
- The in-pane canvas is taller (400px) and **resizable** — drag the handle
  at its bottom-right corner (the editor re-lays-out live).

### Fixed (adversarial pass over this diff)
- The dialog readout honors the R-group⇒generic display contract — no
  concrete formula counting R at mass 0 — and shows the formula immediately
  on seeding, not only after the first edit.
- The large-canvas button disarms while a dialog is open (no raw Office
  error on a double click) and re-arms when the dialog closes either way.

## [2.93.1] — 2026-08-06 — First real-Word feedback on the Draw canvas

The user's first in-Word pass read as "does not work": the Markush box
snapped back off (by design, on an empty canvas) and the toolbar would not
drag (it is select-a-tool-then-draw, and nothing said so). Verified with
real CDP input events against the production bundle at 1× and 1.5× display
scaling that drawing itself works in the WebView2 engine.

### Fixed
- The Markush checkbox now MIRRORS the molecule's fragment flag, so it can
  be ticked on an empty canvas to pre-arm a genus before drawing — instead
  of snapping back unchecked, which a real user correctly read as broken.
- A hint under the canvas explains the interaction model: pick a tool on
  the left, then click or drag on the canvas.

## [2.93.0] — 2026-08-06 — Draw structures like ChemDraw

The most-requested capability from users: Build mode now opens on a **Draw
tab** hosting OpenChemLib's interactive canvas editor — drag-and-drop atoms,
bonds, ring templates, chains, charges and wedge/hash stereo, entirely
offline. Every edit derives the insertable figure through the same
BuildResult pipeline as the typed builder, so the formula/SMILES readout,
R-group legends, Markush flagging, provenance alt-text and Insert all work
identically from a drawing. The typed atom/bond + molfile surface is intact
under a Text tab, and Chemical mode gains **Edit in Draw** (look a compound
up, then modify it on canvas).

### Fidelity (hardened by two independent adversarial review passes)
- Drawn structures record to history as `idcode: <code> <coords>` — the one
  text form that round-trips the Markush/fragment flag, query features,
  R-groups and layout (a molfile silently drops the first two). The builder
  gains an `idcode:` parser with a decode→re-encode canonicality guard,
  because OCL otherwise "decodes" junk into confident fabricated molecules.
- An R-group forces **generic** on every path — drawn, typed, `idcode:`, and
  now pasted molfiles too. No more concrete formulas counting R at mass 0.
- R-group legend definitions survive tab peeks and mid-drawing transients;
  history records are captured at Insert-click time, not after the awaits.

### Changed
- The bundle ships OpenChemLib **full** (the only build with the editor) via
  a webpack alias — one OCL copy, task pane bundle ~4.3 → 5 MB, still fully
  offline.

## [2.92.0] — 2026-08-05 — Solve reads all sixteen textbook word problems

Completes the run that started at **0 of 15**. Against the verbatim worked
examples of LibreTexts 1.20 plus the user's own train problem: **16 of 16
correct, 0 wrong, 0 refused.**

### Added — five recognisers, one per concept the translator lacks
| family | example | answer |
|---|---|---|
| proportion | 4 blocks weigh 28 oz — how many weigh 70 oz? | 10 |
| percentage change | bread up 5% from $2.40 | 2.52 |
| partition | 300 ft fence, longer 4× shorter | 60 and 240 |
| perimeter | equilateral triangle, P = 60 | 20 |
| | rectangle, length 3 more than twice the width, P = 20 | 7/3 and 23/3 |
| | gardener: $600 at $10 per linear foot, twice as long as wide | 10 × 20 |
| work at an hourly rate | 3 workers, $12/h, $180 total | 5 hours |

Each is its own recogniser rather than more vocabulary in the sentence
translator: a translator that "sort of" understands geometry produces a
confident wrong number.

### Fixed — three defects, all one family: a quantity spelled as a WORD
- **"three workers … $12 per hour" answered 15 hours where the truth is 5.**
  The head count matched no digit and silently defaulted to one. Number words
  are now converted for every recogniser, and the work-rate recogniser refuses
  without an explicit count rather than assuming one.
- That normalisation then turned "into two pieces" into "into 2 pieces" and
  broke the partition guard — a normalisation step silently invalidating a
  guard downstream of it.
- The partition total matched the first number anywhere in the sentence,
  including the multiplier. It now requires a unit.

## [2.91.0] — 2026-08-05 — Solve reads word problems

Asked for by the user, with two sources and a problem of their own (a train
with an unknown number of passengers). **Measured against the eleven verbatim
worked examples on LibreTexts 1.20 plus four of ours, driven through the
shipped bundle: 0 of 15 solved.** The module's own documented "a number …"
template was refusing its canonical example, because it translated the question
along with the statement.

**Now 8 of 15, and the other 7 refuse cleanly** — all five of the page's
translation problems (Example 18.2 a–e), two simple number sentences, and the
running-total shape.

### Added
- **Statement/question splitting.** A word problem is facts plus a question;
  only the facts are an equation.
- **The page's own vocabulary** — "an unknown number", "is equal to", "the
  difference is", "gives the same result as", "multiply … by", number words.
- **A running-total recogniser** — an unknown start, a sequence of gains and
  losses, a stated final amount. Separate from the translator because each
  event's direction comes from a verb against a container ("get off" vs "get
  on"), not from an arithmetic word.

### The failure worth recording
The first working version answered two of the five with **wrong numbers**
(−2.2 for 9, −0.75 for 8) because the inverting phrases were resolved before
the unknown was substituted. A wrong answer is the one outcome this module
exists to prevent. Every inversion is now pinned by a test asserting the
**equation**, not just the answer — a reversed subtraction solves happily to a
plausible wrong number.

### Still refused, deliberately
Percentage-increase, work-rate, partition, proportion and perimeter problems
each need a concept the translator does not have, and are pinned as refusals so
that if one ever starts answering it does so with a test written for it. Every
translated problem shows the equation it derived, which is what makes widening
the vocabulary safe.

## [2.90.1] — 2026-08-05 — Solve answers questions again, and eight figure defects

### Fixed — reported from real use
- **Solve appeared not to respond to questions.** It was not broken, it was
  REFUSING: the word-problem mode has four narrow templates and no fallback, so
  `Solve for x: 3x + 5 = 20` came back as "this isn't one of the offline
  templates" while the equation solver two dropdown positions away answers it
  instantly. Word mode now pulls any embedded equation out of the sentence and
  hands it to the real solver, and the refusal — when it is genuinely a
  refusal — says what to type instead. Reproduced by driving the shipped
  bundle before diagnosing.

### Fixed — found by a deep-dive bug hunt over v2.90.0
- **A finite result could put `NaN` in a chart, and the text gate could never
  catch it.** `hi - lo` overflows to Infinity for two finite values near the
  ends of the double range, so every scale became Infinity/Infinity. Reachable
  by an ordinary route: a RANK test is immune to magnitude, so Mann-Whitney on
  `1.7e308 -1.7e308 1 2 3` returns a perfectly finite U, z and p and enables
  Insert. `hBarSvg` had carried this guard since the Engineering campaign;
  `statchart` did not inherit it.
- **Serial dilution rendered a framed, titled, EMPTY chart.** A log axis with no
  `dropForScales` gave `d="M48,NaN L147,NaN …"` — the identical defect the
  pharmacokinetics plot fixed and documented 14,000 lines earlier.
- **Uncertainty propagation named a winner that does not exist.** On the shipped
  default all three contributions are exactly tied; finite-difference noise
  ranked one first and the pane printed "Largest contribution: c" beside three
  identical bars.
- **The dose-response curve could not show its own EC50** — a sigmoid in log
  concentration drawn on a linear axis put six of seven points in the leftmost
  tenth. Now log-scaled, sampled logarithmically, with the fitted midpoint
  marked. All five fitted assay figures also gained a title; they had none, so
  a Michaelis-Menten fit and a 4PL were indistinguishable once inserted.
- **Cheng-Prusoff labelled a Ki′ as a Ki** on the uncompetitive bar, an
  equivalence the result text explicitly denies two lines above.
- **The inhibition figure dropped [I] levels silently**, and the ladder dropped
  rows silently — so a waterfall's bars stopped short of its own total.
- Control characters in a factor level (0x07 is Word's own table-cell marker,
  so pasting a table cell as a factor level is the vector) made the whole SVG
  not-well-formed: the pane rendered it and the insert failed. Now removed.
- The `ladderSvg` row cap could be escaped entirely by a negative slice end.

### Fixed — insert path
- **Solve could insert an orphan figure and report success.** `insertDerivation`
  returned `void`, so it was the one text-plus-figure handler that could not
  tell whether its text had landed.
- **The busy guard did not span the figure phase**, in any of the four handlers
  whose comments said it did: `insertPlainText` releases the flag when the TEXT
  is done, and the rasterisation that follows ran unguarded. Two clicks gave
  `text, text, figure, figure`. A composite guard now covers the whole action
  and disables the button while it runs.
- Statistics figure alt text was the registry SLUG ("diagnostic plot for
  multiregress"), and Finance reported a failed chart as a failed result.

### Fixed — gates that could not fail
- **The em-dash guard for Finance and Bio/Assay scanned 12 characters.** Its
  body extractor counted `(` as an opener, so on `compute: (r) => {` it closed
  on the parameter list and returned `"compute: (r)"` for all 40 calculators —
  the guard holding the two defects it was extended to catch. Re-injecting the
  historical annuity defect proves the old one was blind and the new one is not.
- **The blank-figure detector could not fire on `buildPlotSvg` figures** —
  roughly half the product's figure sites. It excluded only `#ffffff` and
  `plot.ts` writes `#fff`, so marks was always non-zero. Its self-test passed
  because the payload used a spelling `plot.ts` never emits.
- Two tests keyed to a fixed byte window read past the code they named.

## [2.90.0] — 2026-08-05 — the chart campaign is COMPLETE: 84 of 84

Every calculator outside Engineering now inserts data AND a graph. With
Engineering's 130/130 that is **214 calculators**, each with its own ratchet in
`scripts/pane-audit.js` enforced by `npm run qc`, so a lost figure fails the
build and a new calculator must ship with one.

| Registry | Was | Now |
|---|---|---|
| Statistics | 5 of 21 | **21 of 21** |
| Analyze | 8 of 23 | **23 of 23** |
| Bio/Assay | 5 of 16 | **16 of 16** |
| Finance | 0 of 24 | **24 of 24** |

### Added
- **Finance can draw at all.** `FinCalc.compute` returned a bare `string`, so it
  was the one registry with nowhere to put a figure; it now returns
  `string | { text, svg? }`, and a plain string still works so the unwired
  calculators were provably unchanged. The type change landed with exactly ONE
  wired calculator so the insert path was proven before 23 more were written
  against it.
- **`src/lib/statchart.ts`** — box plot, forest plot and grouped bars, the three
  figures a statistics result needs that a continuous-axis plotter cannot draw.
- Shared Finance builders: a money-over-time curve, a discounted cash-flow
  ledger, a price-against-yield curve and an option-value curve.
- **`AssayOutput.svg`** beside `plot`, because the eleven Bio/Assay calculators
  that had no figure are not curve fits.
- `dunnett.ts` reports `ciLow`/`ciHigh`; `optimize.ts` records a convergence
  history — both so a figure can be drawn from the engine's own numbers rather
  than reconstructed.

### The rule every figure follows
Drawn from the SAME engine call that produced the printed text, so the picture
cannot disagree with the number beside it; and every sweep bound containing a
user number is clamped, because a period count of 1e9 on a pane that recomputes
per keystroke is a frozen Word, not a slow chart.

---

### v2.90.0 detail — phase 2: Statistics starts drawing

### Added
- **`src/lib/statchart.ts`** — the three figures a statistics result needs that
  `buildPlotSvg` cannot draw, because one axis is categorical: a **box plot**
  (group comparisons), a **forest plot** (pairwise intervals against a null
  line, with the null at 1 for ratio comparisons), and **grouped bars**
  (observed against expected). 29 property-based tests.
- **Six Statistics calculators now draw** (5 → 11 of 21, measured by the pane
  audit): descriptive statistics, both t-tests and one-way ANOVA get box plots;
  **Tukey HSD gets the forest plot of its own intervals** — the figure a
  post-hoc test exists for, and the one its own caveat used to send the user
  elsewhere for; chi-square goodness of fit gets observed against expected,
  which answers the "where does it differ" question χ² structurally cannot.

### Fixed — found by an independent adversarial pass over phase 1
- **A non-finite value could reach a document, caused by phase 1's own fix.**
  `describeAssumptions` prints its variance ratio with a bare `toFixed`, and the
  ratio is `Infinity` whenever one group is constant — rendered as the literal
  string "Infinity", never as the em-dash sentinel. That text had been blocked
  only by ACCIDENT, by an em dash elsewhere in the same note; making the prose
  dashes plain removed the accident. Finance had blocked NaN and Infinity by
  name for some time while Statistics, Analyze and Bio/Assay ran on the dash
  alone; **all four now share one `insertableResultText` gate.**
- **`insertPlainText` returned `void` while swallowing its own errors**, so both
  "insert the result AND its figure" handlers claimed success over a failure and
  appended the picture anyway. It returns a boolean now — which also closes a
  double-insert: a second rapid click no longer falls past the busy branch and
  adds the figure twice beside one copy of the text.
- **The audit reported every `EXCEPTION` line as `ok`** — a missing verdict
  token defaulted to the empty list, and `[].every()` is true.
- **The audit's `THREW` detector was dead for two of four registries** (it
  matched only Analyze's wording), and its DEFAULT pass downgraded a
  blocked-insert em dash unconditionally — blinding it to the very defect it was
  built to find.
- The audit could pass with a mode that no user can reach (its dropdowns are
  populated at boot, so it found them by id regardless), its self-test exercised
  a *copy* of the figure counter rather than the counter, and its per-registry
  `total` documented a "lost calculator" guarantee that nothing implemented.

---

### v2.90.0 detail — phase 1: the instrument

Opened because of user feedback — *"charts are missing from stats, solve,
analyze, spectra, finance… the landing page shows them but yet jurislab does not
seem to have them"* — and because the gap analysis had independently ranked the
same thing top: the figure ratchet that made "every Engineering calculator
draws" a fact covers **only** Engineering. See
`docs/CHART-CAMPAIGN-2026-08-05.md`.

### Added
- **`npm run audit:pane`** (`scripts/pane-audit.js` + `pane-audit-driver.js`),
  now also a `npm run qc` step. Drives Statistics, Analyze, Bio/Assay and
  Finance in the real production bundle: every calculator on its defaults, every
  non-default dropdown option, every field blanked, rubbish in every field, then
  a real insert against a recording Word mock. Carries a **per-registry figure
  ratchet** and self-tests every predicate on a known-bad payload first.

### Fixed — all found by that audit on its first run, none visible to 9,332 tests
- **Bio/Assay inserted the numbers without the curve.** Michaelis-Menten, Hill,
  dose-response, binding and substrate inhibition drew a fit in the pane and
  inserted no picture. The plot is part of the result — for a fit it is the half
  that shows whether the model describes the data.
- **The heat, wave and Laplace solvers drew charts nobody could get.** A `NaN`
  placeholder in the corner of the sampled grid rendered as the "not computable"
  sentinel and suppressed the entire result, chart included.
- **Two-sample t-test, paired t-test and one-way ANOVA were un-insertable**, from
  prose em dashes spliced in from `describeAssumptions` at run time. The
  existing guard is a source scan and cannot see punctuation that arrives from
  another module. Two more latent call sites fixed with them.
- **`insights`, `linearize` and the Cheng-Prusoff non-competitive result** were
  un-insertable for the same reason.
- **`greeks` Delta and `returns` Sharpe ratio printed a literal `NaN`** where
  every neighbouring line was already guarded.
- **`protein280` could not compute on its own defaults** — a field labelled
  optional was treated as required. `AssayField.optional` now declares it.

---

### v2.90.0 detail — the non-Engineering half, repaired (the 2026-08-05 gap analysis)

The 2026-08-05 gap analysis (`docs/GAP-ANALYSIS-2026-08-05.md`) swept everything
outside Engineering and Citations — a surface that gained **43** Engineering
calculators and **zero** statistics calculators over the preceding 26 releases.
It found 31 live defects. All are fixed, with a named regression test each.

**Wrong content that was reaching the document.** A GenBank import declared every
sequence a *synthetic construct* in the filed ST.26 listing, because the reader
skips the `source` feature the pane read the organism from — now parsed from the
`ORGANISM` header and verified end-to-end into the XML. Every predicted spectrum
drew a **negative** axis (¹H NMR ticks read −4 … −1 ppm; IR read −4000 cm⁻¹): the
data is negated so δ increases leftward, and nothing un-negated the tick labels.
A pole-crossing integral typeset `= NaN` into Word while the pane correctly said
there was no value. Finance's insert gate blocked `"—"` but not `NaN`, so a
constant return series inserted `Sharpe ratio NaN`.

**Wrong numbers on screen.** The statistical assumption checker tested the pooled
marginal instead of the within-group residuals, so it declared non-normality
*because* there was a real effect — 2.1e-5 on two clean groups separated by 4 SD.
IR assigned C–halogen bands from the element alone, so sodium chloride returned a
"C–Cl stretch". NMR invented δ 160 for any carbonyl-like carbon it could not name
and read carbon monoxide as an alkyne. UV-Vis applied Woodward–Fieser to
β-carotene (534 nm against a real 450) while claiming ±5 nm, and called caffeine
and riboflavin colourless benzene.

**Frozen Word.** Two unbounded tick loops built a **510 MB** SVG from
femtosecond-magnitude data; alignment allocated 1.81 GB on a 5 kb × 5 kb paste and
re-ran on every keystroke; `buildDiagramSvg` emitted **23 MB** for a large pasted
table; `bondPrice` never returned for a non-finite maturity.

**Honesty that existed and was thrown away.** ¹H coupling caveats, the isotope
exclusion note, heat-map and candlestick renderer warnings, the log-axis
point-drop note, and every caveat on an empty spectrum were computed and then
dropped before the screen or the document. The dose–response and saturation
binding fits — the two most-used pharmacology tools — shipped with no caveats at
all. Three catch blocks told the user the document was untouched at the moment it
was half-modified.

**Gates.** The figure ratchet was Engineering-only: nothing outside it would have
caught a Spectra, Stats or Table→Chart regression. The figure corpus goes 4 → 13
modules and 71 → 135 figures, deriving its coverage from the filesystem so a new
chart module fails the gate until it has a figure. The whole-library fuzzer that
found seven frozen-Word bugs at v2.18.0 had **never been committed**, and the
library had grown 97 → 151 modules since; it is now `npm run fuzz` (16,560 calls,
zero hangs) plus `fuzz:extreme` for valid-but-large input. A pane id-wiring audit
and the tool-page and figure gates now run on the publish path, and `ts-node` —
which was in neither `devDependencies` nor `node_modules`, so the figure gate
could not run offline at all — is replaced by a require hook built on the
TypeScript already on disk.

**Four independent adversarial passes** over the diff, none by the agents that
wrote it, found 19 further defects including 8 introduced by the fixes. Two fixes
were rejected *after measurement* and rebuilt: the first `primerTm` repair was
worse than the defect (−9 °C against −1.8 °C) and was replaced by exact
enumeration of the degenerate pool; the obvious residual-normality repair fires on
100 % of normal data at three groups of three, and was replaced by a transform
through the exact Beta distribution of a studentized residual (61–100 % → ~8 %).

The final round caught four more: a Unicode fold that routed *around* a deliberate
ambiguity refusal, so `1/2π` answered where `1/2pi` correctly refuses; an exact
root displayed rounded while still flagged `exact: true`; a bond priced at a
confident 1139.82 for a **negative** maturity, because the only quantity checked
was the product `years × freq` and two negatives cancelled; and a summary sentence
able to hijack the Brief Description section and report a correctly-described
figure as missing. Found along the way: the Inhibition (Ki) and annuity
calculators had been permanently **un-insertable** because a stray em dash
collides with the pane's "not computable" sentinel, and `StatOutput.svg`'s
"Display only" comment had outlived the "Insert chart" button — a stale comment
that made an audit report a working feature as absent.

Suite: **281 files · 9,332 tests · 0 failures**, 13/13 QC gates green.

## [2.89.0] — 2026-08-03 — EVERY calculator draws: 130 of 130

The final twenty-four, and the figure ratchet closes at **130 of 130**. Every
Engineering calculator now inserts its data AND its picture — the standing
requirement, met.

Three new equal-aspect builders finish the family: **orbitChartSvg** (conics
about a body at the shared focus — the focus offset of an ellipse is the
physics, and a circular orbit must be a circle), **vectorTriangleSvg**
(tip-to-tail vectors whose angles read truthfully), and **armSvg** (planar
linkages, reference circles, targets, ellipses). One additive engine change:
`DhResult` now exposes every intermediate joint frame, because a chain the
engine walked can be drawn only if the engine says where it went.

The figures: the Rankine and refrigeration **energy ledgers**; your arc
against the **optimum arc for your height**; the **two ways to hit one
target**; impact energy **saturating at terminal speed**; the **S-curve
against its trapezoid** (rebuilt from the engine's own phase times); every
axis's throttled profile **finishing together**; orbits, ellipse and
**Hohmann transfer to scale**; the **tyranny of the rocket equation**;
escape at **√2 × circular** on every radius; the great circle **bowing
poleward** past its chart line (split at the antimeridian); the **wind
triangle** north-up; the **climb triangle** with γ to scale; one TAS
becoming **three airspeeds** with altitude; the arm in its reach circle;
**both IK branches** (an unreachable target still draws — the annulus and
the stranded cross are the most informative picture the tool has); the
**manipulability ellipse**; the DH chain in **two orthographic views at one
shared scale**; the triangular profile **peaking below its commanded
speed**; the differential drive's **turning circles about the true ICC**;
the **r⁻⁴ stenosis curve**; the joint's **force bars**; and the biosignal
**fold diagram**, which now draws the inadequate case too — the signal's
own top folding back into its band, the unfixable failure.

The adversarial pass earned its keep one last time: **two blockers invisible
at the defaults** — the differential drive drew every clockwise turn
mirrored (the engine's turn radius is signed, and re-applying the sign of ω
flipped it), and the Hohmann burn labels swapped orbits on any descending
transfer. Plus the Rankine ledger double-counting the pump work its net-work
figure already contained, the two DH views drifting to different scales, an
orbit-builder overflow guard, and the biosignal gap. All fixed before ship.

## [2.88.0] — 2026-08-03 — Computation, chips, optics and quantum draw

Sixth figure batch of the day and the largest: twenty-two tools across four
disciplines. Ratchet **84 → 106 of 130**. A generic **ledger builder** joins
mechchart (the NPSH waterfall with the strings and number format as
parameters — a temperature ladder in °C and a timing budget in picoseconds
need the same bars and neither survives a formatter hardwired to metres of
head).

Chips: power against clock (leakage flat — the lesson), the **thermal ladder**
ambient→junction against the Tj limit, RC delay **quadratic in wire length**,
and the **setup budget** ledger ending at the slack (hold stays in the text —
it has no period term). Computation: **Amdahl against Gustafson** on log
processors, the **binary entropy curve** or per-symbol contribution bars,
**capacity against SNR**, the **birthday curve** on log items (a linear axis
is a flat-zero lie at the defaults), the **ULP staircase** on log-log
(machine epsilon holds only at 1.0), and the **fitted power law** against a
k = 1 reference. Optics: E = hc/λ as the straight line it is, the beam
**caustic** with its Rayleigh stems, **w(z) walked through the ABCD system**
carrying the running index, the **g₁g₂ stability diagram** (drawn precisely
when the cavity is unstable and the text has least to say), the three
pulse-shape peak powers, the **Snell sweep that simply stops at the critical
angle**, grating orders as stems whose caption says the height carries no
intensity, and the fibre **V-against-λ** crossing 2.405 exactly at the
reported cutoff. Quantum: the state as **probability stems** with its Schmidt
spectrum, **S against both Bell bounds** with the measured uncertainty riding
on the S stem, the Werner **two-threshold curve** (thresholds found by
watching the engine's own verdicts flip, never retyped), and the
**Shor-Preskill bound** with the threshold where the engine bisected it.

The adversarial pass found one blocker — the capacity sweep iterated once per
dB of the USER'S SNR, so a pasted 1e15 dB was a frozen Word (the brief itself
embedded the bug; the no-unbounded-loops rule outranks the brief) — plus an
em dash in a plot title that turned the audit gate red, and four
brief-fidelity gaps. All fixed; the ledger builder now guarantees its result
row survives any row cap, which is the latency-chart lesson generalised.

## [2.87.0] — 2026-08-03 — Audio and video draw

Fifth figure batch of the day: all fourteen **Audio & acoustics** and
**Video & display** tools insert figures. Ratchet **70 → 84 of 130**.

Audio: the **fold diagram** (where every input frequency lands after
sampling — the sawtooth IS aliasing); the **6.02n + 1.76 line** with this
converter on it; **both decibel conventions** on one log-ratio axis; the
**inverse-square falloff** as the straight line it is on log distance; the
Sabine and Eyring **decay slopes to −60 dB**; the **room-mode map** ranked
by audibility; and the **comb response** with its floored notches (the −30 dB
floor is load-bearing — the response is −∞ at every notch, and an unfloored
point would vanish from the very figure that exists to show it).

Video: the **chroma-scheme bars** (4:2:0 halves the data, not quarters it);
**retina distance against screen size**; the **absolute PQ curve** on log
nits; **PSNR against error**; the **buffer timeline** (fill on the surplus,
drain through an outage); the **latency budget bars** with the worst stage
in red and the refresh-quantised delivery; and both **gamut triangles on the
u′v′ chromaticity plane** — a new equal-aspect builder, u′v′ because CIE xy
over-weights greens the eye discriminates poorly, which is the tool's own
argument drawn.

The adversarial pass found no blockers and three fit-and-finish items (the
24-row cap could drop the latency chart's own point, duplicate stage names
both turned red, a far-out-of-band tone flattened the fold diagram) — all
fixed before ship.

## [2.86.0] — 2026-08-03 — All seventeen Energy tools draw

Fourth figure batch of the day and the biggest: the entire **Energy & power**
discipline now inserts figures. Ratchet **53 → 70 of 130** — past halfway.

The conventional picture for each: the wind **cube law** with the Betz bound;
solar output **rated against temperature-derated**; the PV **fill factor as
the area ratio it is** (no invented I-V curve — four datasheet points do not
define one); hydro's two straight lines through the origin; battery **runtime
against current on log-log** with the Peukert sag; the combustion **mass
balance** as bars fixed by conservation; **LCOE against the discount rate**;
capacity factor as **actual against flat-out generation**; the three-phase
**power triangle** (a new equal-aspect builder — φ must read as the angle
whose cosine is the power factor); the pf-correction **cost-of-chasing-unity
knee**; cable **drop against run length** with the acceptance-limit crossing;
the **wind-shear profile** with height vertical, both laws; the fitted
**Weibull density** with the turbine's operating band; the
**combustion-analysis chart** (dry CO₂ and O₂ against excess air); storage's
**1/DoD sizing hyperbola**; the **sun's day** with sunrise and sunset where
the curve crosses the horizon; and **flame temperature against excess air**.

Every curve is either re-asked of the engine point by point or scaled off the
computed result in closed form — nothing is re-derived, so no figure can
disagree with its own table. The adversarial pass found no blockers and four
fit-and-finish defects (a float-residue unity-power-factor branch, one-decimal
labels on small loads, a flue-gas marker that could stretch the axis five
times past the curve, an unbounded voltage-drop axis) — all fixed, plus the
layout audit caught two label collisions in the new triangle builder before
any user saw them.

## [2.85.0] — 2026-08-03 — Control, vibration and electronics draw

Third figure batch of the day; ratchet **45 → 53 of 130**. Three new reusable
builders (a pole-zero map, a generic horizontal bar chart, a logic-waveform
lane drawer) join `mechchart.ts`.

- **Poles, zeros & stability** — the **pole-zero map** on the s-plane, right
  half plane shaded: a × in the shading IS the instability the verdict names.
  Equal scale on both axes, because a pole pair's damping ratio is the cosine
  of an angle that lies on stretched axes.
- **PID & closed loop** — the **closed-loop step response** with this tuning;
  an unstable loop honestly diverges on the plot.
- **Natural frequencies & mode shapes** — the **mode shapes drawn** (first
  five), anchor point included for a grounded chain.
- **Forced response (multi-DOF)** — the **FRF of the loudest DOF** on a log
  amplitude axis, resonances as peaks, the working frequency marked; every
  sweep point re-solves the same modal problem.
- **Op-amp circuits** — **gain against frequency**: flat-then-roll-off closed
  loop meeting the open-loop GBW line, or the integrator/differentiator slope
  with its unity-gain corner.
- **Analogue filter design** — the **magnitude response with the spec drawn
  on it**: passband and stopband edge points sit on the plot, so "delivered
  vs asked for" is visible rather than asserted.
- **DC operating point** — **power per element** as horizontal bars off a
  shared zero line; delivery left, dissipation right, and the two sides
  balance because Tellegen says they must.
- **Truth table & minimisation** — the table drawn as **logic-analyser
  waveforms** (up to five variables), output lane at the bottom.

### The bug the figure caught

The adversarial pass found that an **odd-order Chebyshev filter at a band
edge past a few thousand rad/s was built one degree too high**: the
prototype's real pole carries a ~7×10⁻¹⁷ floating-point residue in its
imaginary part, the band-edge scaling grew it past the ABSOLUTE 1e-12
classification epsilon in `denominatorFromPoles`, and the "real" pole went in
as a full conjugate-pair quadratic. A near-default Chebyshev highpass
(ωp = 4000) delivered −80 dB at the edge the spec puts at −1 dB, and the
reported stopband attenuation was ~3× the truth. **The new figure drew the
spec point 79 dB off the curve — that is how it was found.** The epsilon is
now relative to the pole's own magnitude, with a regression test at the
exact failing specs.

Also fixed before ship: `buildPlotSvg` now sanitises non-finite x AND y at
the door (one overflowed sweep bound used to poison the whole plot's domain
— this ends that class for every present and future caller), the bar chart
survives a value span that overflows Infinity, and an op-amp sweep bound is
clamped.

## [2.84.0] — 2026-08-03 — Thermo and aero draw

Second figure batch of the day; ratchet **40 → 45 of 130**.

- **Ideal-gas process** — the process on the **P–v plane**, states 1 and 2
  marked; the area under the path is the boundary work the numbers report.
  Isothermal is sampled as the hyperbola it is; isochoric is the vertical
  segment it is.
- **Power cycles** — Otto, Diesel and Brayton on the **P–v plane** in ratio
  space, log pressure (r^k alone is ~18 at r = 8), all four corner states
  marked. Corner pressures verified against the engine's temperature ratios
  to machine precision.
- **Standard atmosphere** — T/T₀, p/p₀ and ρ/ρ₀ against altitude, drawn the
  way an atmosphere is always drawn (altitude vertical); the kinks in the
  temperature trace ARE the layer structure.
- **Lift, drag polar & stall speed** — the **drag polar** with the
  origin-tangent ray that IS best L/D, this flight in red, the tangency in
  green.
- **Level turn** — turn radius against bank on a log axis (34 m to 4.4 km
  between 85° and 5° at 120 kt), current bank marked.

The adversarial pass verified every figure against the engines (corner
pressures to 2×10⁻¹⁶) and found one real defect: a denormal airspeed can
underflow the turn radius to exactly zero, and log10(0) through the marker
guard would have put NaN in every coordinate. The guard now requires a
strictly positive radius.

## [2.83.0] — 2026-08-03 — Fluids, thermal and fatigue draw

Continuing the standing requirement that **every calculator inserts data and a
graph**. Six more tools draw; the figure ratchet rises **34 → 40 of 130**.

- **Endurance limit & notch factor** — the estimated **S-N curve**, uncorrected
  against corrected, so the Marin knockdown is visible as the gap between the
  two lines. A steel gets its knee at 10⁶ and runs flat; a non-ferrous alloy
  has no knee to draw, so its line honestly keeps falling to 5×10⁸.
- **Finite life & cumulative damage** — the load spectrum plotted over the
  S-N line it is consuming, each block at its stress and applied cycles.
- **Pipe flow & head loss** — the **system head curve**: the same pipe swept
  over flow with Colebrook re-solved at every point, and this flow marked.
- **Composite wall / pipe insulation** — the **temperature profile** through
  the layers, film drops as vertical steps; slope IS resistance, so the
  insulation is the steep segment.
- **Open-channel flow** — the **specific energy diagram** E(y) at this
  discharge, with the working depth, the critical depth and the E = y
  asymptote; which arm the point sits on is the regime the text names.
- **Pump NPSH & cavitation** — the **NPSH ledger**, a waterfall of where the
  suction head comes from and where it is spent, against the NPSHr line
  (drawn for BOTH loss sources — typed losses have no flow axis, and this is
  the picture that still exists); with the pipe source active, a second
  figure shows **NPSH available falling with flow** while the requirement
  stands still.

The independent adversarial pass found one blocker before ship — the S-N
coefficient (0.9·Sut)²/Se overflows to Infinity for absurd-but-accepted
strengths, and one non-finite y poisons the whole plot's domain — plus a
verdict mismatch at exactly zero margin (the engine calls that cavitation;
the figure said clear), a value label pushed off the canvas by a deep
suction lift, and a text-order regression in the wall tool's unit report.
All fixed; the layout audit's corpus grew the shapes that caught them.

## [2.82.1] — 2026-08-03 — The legend moves outside the plot

User report: "the legend/key should not be inside, it should be outside so
that it does not block the data." Correct, and now true everywhere.

### Legends no longer cover data

`buildPlotSvg` — the shared plotter behind Plot mode, Solve, Analyze, Stats
diagnostics, Engineering, Spectra and Bio/Assay figures — drew its legend as an
opaque box inside the top-right of the plot area. Opacity had been the fix for
curves striking through the labels (v2.80.0); it also meant the box hid
whatever data sat under it. The legend now lives in its own gutter **to the
right of the plot frame**, and the gutter is paid for by **widening the
canvas**, not by shrinking the plot — the data area of every figure is
pixel-identical to before, and unlabeled plots are byte-identical. (The other
chart families — table charts, heatmaps, candlesticks, the Goodman diagram —
already kept their legends outside.)

### The insert paths that would have squashed the wider figure

The independent adversarial pass over the diff found the real defects where
they usually are: not in the geometry but in its consumers. Five insert paths
rasterised the SVG into the **nominal** 380×270 (or 300×300) box instead of
the SVG's own size, which would have squashed every labeled figure
horizontally by 12–30% — Plot mode with two functions, every Bio/Assay fitted
curve, all four 2D NMR maps (a square COSY inserting 30% narrower than tall,
every scatter circle an ellipse), and the Analyze/Engineering rich-block path
including both Bode plots. All five now read the SVG's intrinsic dimensions
(the pattern the stats, PPT and solve inserts already used). The legend width
estimate also grew from 6 to 7 px per character: outside the frame there is no
plot-area slack left to absorb a capital-heavy label, and the canvas edge
would have clipped it.



Fourth release against the engineering deep dive, and the first that adds a
**discipline** rather than depth in an existing one. Engineering **125 → 130**
across **twenty** disciplines. All five new tools insert a figure; ratchet
**29 → 34 of 130**.

Everything here is arithmetic over rates and lives **you** supply. There is no
built-in failure-rate handbook and there will not be one: a failure rate is a
property of a part in a duty cycle in an environment, and a table of them would
be wrong for every application except the one it was measured in — the same
refusal this bench already makes for Cd, emissivity and Thiele-Small parameters.

### Life data: Weibull fit

Fitted by **maximum likelihood**, not by regression on a probability plot.
Median-rank regression needs a plotting-position approximation with fitted
constants in it, and the likelihood equation is exact and needs nothing but the
data. The plot is still drawn — the points use the mean plotting position
i/(n+1), which is a theorem rather than an approximation — but nothing reported
comes from it.

**Units still running are entered as suspensions and used IN the fit.** A unit
that has not failed says the life is *at least* that long, which is real
information; discarding it biases the fitted life short. Johnson rank adjustment
handles the censored ranks for the plot.

**The shape parameter is the answer, not the mean life.** Below 1 the hazard
falls with age, so the parts are dying young: burn-in helps and scheduled
replacement actively *hurts*, because it swaps a proven part for a fresh one.
Above 1 the hazard rises and replacing on a schedule buys something. At 1 the
hazard is constant and replacing on age achieves nothing at all — and that is
the only case where quoting a single failure rate is defensible.

**The regime is read from a likelihood-ratio confidence interval, not from the
point estimate.** The shipped default fits β = 1.640 with an interval of 0.827
to 2.786. That interval straddles 1, so the answer is **constant hazard** — not
wear-out, which the point estimate on its own would have claimed. Two units with
a fitted β of 2.62 come back the same way, on an interval of 0.57 to 7.07. A
fitted β above 1 from a handful of failures is a statement about the sample size,
not about the parts, and only an interval clear of 1 is evidence of anything.

**MTTF ≠ MTBF ≠ 1/λ.** MTTF is the mean of a life distribution and equals 1/λ
only when β = 1; MTBF is time *between* failures on a repairable item, and only
that reading belongs in an availability calculation. The module keeps them apart
in its own naming and says which is which in its output.

### Series and parallel systems

Failure rates add in series, so a system is always worse than its worst part —
and the **component carrying most of the rate is named**, because improving
anything else is close to wasted effort until that one moves.

In parallel the system outlives every part, but the mean life grows only as
1 + 1/2 + 1/3 + …: the second unit buys half what the first did, the tenth buys
a tenth. **The independence assumption is doing all the work**, and a shared
supply, a shared cooling loop, a common design error or one maintenance mistake
takes out every branch at once.

Where the parallel mean life cannot be computed accurately — thirteen or more
units at differing rates, where the exact expression is an alternating sum over
every subset — it is **not reported, and it says why**. The reliability at the
mission time stays exact.

### k-out-of-n, standby spares, availability

**k-out-of-n** for voting logic and pump trains, on log-gamma binomials so
n = 500 does not overflow. Requiring all n is a series system wearing redundant
clothing and is *worse* than one unit; requiring 1 of n is full parallel.

**Active against standby.** Standby beats active because of two assumptions and
not because it is better engineering: the spare is assumed not to age while it
waits, and the switch is assumed never to fail. A switch with its own failure
rate can make standby **worse** than active, because it puts a single point of
failure in front of every spare. The mean life grows **linearly** with standby
units and only **harmonically** with active ones.

**Availability**, labelled what it is: **inherent**. It counts the repair and
nothing else. Waiting for a spare, a technician, a maintenance window or
permission is real downtime and none of it is in this number, so the operational
figure is always lower. Availability also **multiplies down a series** — five
99.6% units in series is 98.0%, which is 173 h down a year against 35.

### Two product-wide plot fixes

**A tiny axis range drew half a million ticks.** Both tick walks in the shared
plotter ended at `t <= max + 1e-9` — an **absolute** epsilon, on axes whose whole
range may be far smaller than 1e-9. Femtoseconds and nanoamps are ordinary pasted
data, and at an x span of 1e-14 that slack is a billion steps wide: measured,
**500,007 tick labels and a 128 MB SVG** for a single plot, every extra tick off
the canvas. In a task pane that is not a bad-looking chart, it is a frozen Word.
The slack is now relative to the step, and both loops are counted. Pre-existing,
not introduced here, and reachable from Plot mode with any pasted column in small
units.

**The right margin of every plot in JurisLab was a flat 14 px** while the left
has been computed from its widest label since the margin work. X tick labels are
centred on their tick, so a tick on the right edge hung half its width off the
canvas — and "2.5e+4" is 36 px wide. Found on a reliability figure whose x axis
runs to a 25,000-hour mission; the defect was in the shared plotter and affected
every plot with wide numbers on the x axis. The right margin is now computed the
same way the left one is.

### Caught by the independent adversarial pass, before any of it shipped

Ten findings over the diff, behind a fully green suite and thirteen passing
gates. The three that mattered:

- **Two letters meant two things, and the parser picked.** "s" is seconds and
  also "suspended"; "d" is days and also "dead". `412 s` was read as 412 **hours,
  suspended** and `412 d` as 412 hours **failed** — a factor of 3600 and of 24,
  silently, in the one field of this discipline that does not go through the
  shared unit layer, under a unit note claiming every duration converts. Both are
  now refused by name, and the life table properly converts h/min/sec/day.
- **`Motor, 1,200, 2` became a component called "Motor 1" failing 200 times an
  hour.** Comma fields are now read positionally and a fourth field is refused
  as a thousands separator.
- **The regime claim in this changelog was wrong.** It said a fitted β of 1.3
  from eight units is reported as "not resolved". It is reported as **constant
  hazard**, because the interval straddles 1 — the right behaviour, the wrong
  word. Corrected here and on both landing pages.

Also fixed: a never-failing branch with more than twelve units was told its mean
life was unreportable "because the alternating sum loses accuracy", three lines
under a reliability of 100.0000 %; the short-mission note printed **"0 active, 0
standby"** for the two probabilities in the sentence saying that is where the
difference lives (they are 1e-31 and 1e-37, and only the subtraction destroyed
them); the redundancy figure stopped at 20 units while n may be 200; the parallel
figure compared against the *worst* part when the claim being made is that the
system outlives *every* part; `rel-koon` accepted a typed reliability and a
failure rate that disagreed and printed two confident numbers about two different
components; and Reliability was missing from the README, FEATURES.md and the
index tagline, which listed 16 names under a claim of twenty.

### Caught while building, before any of it shipped

- **`Math.max(...array)` blew the stack** at 600,000 units. In a task pane an
  uncaught throw is not an error message, it is a dead pane. Quantities are now
  multipliers rather than expanded entries, and every reduction is a loop.
- The redundancy gain ratio printed **"not finitex"** where the system failure
  probability underflowed to zero.
- The life-data parser **refused "900 +"** — a space before the suspension mark
  — in an error message that told the reader to use a trailing +.
- The Weibull fit was capped at 20,000 units, measured: 20,000 fits in 0.4 s and
  100,000 in 2 s, which is a visibly hung pane for a data set nobody types.

### Gates

`ENG_RELIABILITY_UNIT_NOTE` is a **new unit contract** — every duration converts
(h, day, min, s) and failure rates do not, because the unit layer carries no
reciprocal time and "1e-5 /h" is refused rather than misread. "Year" is
deliberately not accepted: it means 8760 h, 8766 h or 2000 operating hours
depending on who is asking. The contract gate was **widened from a two-way split
to a named set of converting contracts** rather than exempting the five tools,
so a reliability tool still cannot read hours with `Number()`. A further
assertion pins that every duration is read with hours as its target.

Every closed form is checked against an independent second path: a 2-D grid
maximisation of the likelihood, an exhaustive enumeration over every up/down
combination, and numerical integration of the survival function. 36 new tests.

## [2.81.0] — 2026-08-02 — Fluids breadth, and fracture mechanics

Third release against the engineering deep dive. **Fluids 4 → 8, Fatigue &
machine design 3 → 6**, Engineering to **125**. Every one of the seven new tools
inserts a figure. Ratchet **21 → 29 of 125**.

### Fluids

**Differential-pressure metering** — orifice, venturi and nozzle. The
**velocity-of-approach factor** is not optional: the ideal derivation assumes
the fluid arrives at rest and it does not, and at β = 0.75 the correction is
**1.2095**, so omitting it under-reads the flow by **17.3%**.

**The permanent loss is not the differential the meter reads** — but this tool
will not tell you what it is. A venturi's diffuser recovers most of the pressure
it took to accelerate the flow and an orifice recovers much less, and that
difference is the entire argument for paying for a venturi; the actual fraction
comes from the meter standard for your geometry or from the manufacturer.
Supply it and it is applied. **It is not predicted**, for the same reason Cd is
not.

**Pump and system curves.** A pump has no flow rate of its own: it has a curve,
the system has another, and the machine runs where they cross — which is why the
same pump moves different amounts in different installations and why a datasheet
flow figure alone means nothing. **Throttling moves the operating point UP the
pump curve**, not down: closing a valve steepens the system curve, so flow falls
while head *rises*, and the extra head is burned across the valve doing nothing.
On the default case that is **8.58 kW** of hydraulic power, which is the number
that justifies a variable-speed drive.

**The affinity laws**, which say how much: flow scales with speed, head with its
square, and **power with its cube** — so a 20% speed reduction leaves exactly
51.2% of the power and halving the speed leaves an eighth.

**Drag on a body**, with terminal velocity and Reynolds number. Power goes as
the **cube** of speed, so doubling it takes eight times the power to hold.

### Fracture mechanics

`fatigue.ts` was entirely S-N: the product could say when a smooth part would
*initiate* a crack and had nothing to say once one was **found**. That half is
now here.

**Stress intensity and the critical crack size.** The useful number is not K but
*"this flaw becomes critical at 15.9 mm and yours is 3 mm"* — that is an
inspection interval. **Fracture is a threshold, not a gradual degradation:** K
rises only as the square root of crack length, so quadrupling a crack merely
doubles K, and a flaw comfortably safe at one stress is catastrophic at one
modestly higher, without warning.

**Paris-law crack growth**, integrated in closed form, with the m = 2 case taken
as a logarithm rather than a division by zero. **Most of the life is spent while
the crack is small** — the first doubling alone takes 40% of it while the growth
rate rises 53-fold — so an inspection interval set from the *total* life is
worthless; it has to come from the time between detectable and critical.

**The yielding-or-fracture transition**, the single number that decides which
calculation is even relevant. Below it the section yields first and a strength
check governs; above it the part snaps while nominally elastic. A tougher
material has a *larger* transition size, which is precisely what toughness buys.

**Three validity gates refuse rather than caveat.** The plastic zone must stay
small, or LEFM does not apply at all and the case needs J-integral or CTOD. The
section must be thick enough for plane strain, and when it is not the assessment
is flagged as **conservative** — a thin plate is *tougher* than a thick one of
the same material. And a crack below the threshold ΔK **does not grow**, which
is an answer rather than a failure and is the basis of damage-tolerant design.

**A unit trap caught before release.** Paris constants are universally quoted
for ΔK in **MPa√m**, and the first draft documented strict SI. A pasted handbook
C inflated the growth rate by 10^(6m) — a factor of 10¹⁸ at m = 3 — reporting a
life of **1.8×10⁻¹³ cycles**. C is now taken exactly as published and converted
inside; the same case gives **180,100 cycles**, matching a hand-integrated
oracle.

K_IC, the geometry factor Y, and C and m are all **user inputs**. Y depends on
the crack's shape and position; C and m depend on the material, environment and
stress ratio and scatter by orders of magnitude across sources.

## [2.80.0] — 2026-08-02 — Thermal breadth, and the graphs made legible

Second release against the engineering deep dive. **Thermal goes from 5
calculators to 9**, Engineering to **118**, and every figure in the product was
measured for legibility rather than eyeballed.

### The graphs

**Reported: "text overlaps, lines going through the text."** Rather than hunt by
eye, the fix started with an instrument — `scripts/figure-layout-audit.js` now
parses every figure, gives each `<text>` a bounding box from its position,
anchor, font size and content, and reports three measurable faults: **labels
overlapping**, **a line crossing a label**, and **a label running off the
canvas**. It models paint order, so a line hidden behind an opaque legend is
correctly *not* a fault. It self-tests on known-bad payloads first, because a
checker that reports "all clear" for something it cannot see is worse than none.

It found **22 issues**, and two root causes explained most of them:

- **The legend backing was 82% transparent**, so gridlines and error bars showed
  through it and struck out the labels beside them. A legend is an annotation
  over a plot, not a tint on it. Now opaque.
- **The left margin was a fixed 48 px.** Ample for "0" and "100", far too little
  for "1.0e+8", which ran back over the rotated y-axis title. It is now computed
  from the widest tick label the data will actually produce — knowable before
  drawing, because tick values depend only on the range.

Both live in `buildPlotSvg`, so **every plot in the product** benefits, not just
the new ones. The remaining thirteen were annotations in the mechanical charts,
all fixed by giving each label an opaque backing, widening the Goodman legend to
fit its longest entry, and deferring Mohr's tick labels until after the line
that was crossing them. **All 18 sampled figures are clean, and the audit is a
QC gate**, so this cannot silently return.

*Two claims in the first draft of this entry were wrong and are corrected
above.* It said "19 test figures" where the driver runs 18, and it credited the
legend detection to the data curves — which the instrument could not see at the
time, because it did not parse `<path>`. What actually tripped the check was
the gridlines and error bars. Both were caught by the adversarial pass and are
fixed below; the sampled set is 18 hand-picked builder outputs, not "every
figure in the product".

### Thermal

**ε-NTU, the rating problem.** The exchanger tool was **LMTD-only**, and LMTD
answers the *design* question — I know all four terminal temperatures, what area
do I need? The commoner question is the *rating* one: I have this exchanger and
these two inlets, what comes out? LMTD cannot answer it directly, because the
log mean it needs is built from the outlets you are trying to find. Closed form
per arrangement, with both removable singularities taken explicitly: **Cr = 1 is
0/0 whose limit is NTU/(1+NTU)** and is an entirely ordinary balanced design,
and **Cr → 0 is a phase change** — a boiling or condensing stream holds its
temperature, which is why a condenser's performance does not depend on whether
it is counterflow or parallel.

**Fins, including the result nobody expects: a fin can REDUCE heat transfer.**
It adds area, which helps, and adds a conduction path with its own resistance,
which does not. An effectiveness below 1 means the second effect wins and the
finned surface loses *less* heat than the bare one — which is why fins appear on
the air side of a radiator and never on the water side.

**Transient cooling, which REFUSES above Biot 0.1** rather than caveating. The
lumped model assumes no internal gradient, and above that the interior genuinely
lags the surface: a single exponential is the wrong *shape* of answer, not an
imprecise one, and a caveated wrong curve is still a wrong curve in somebody's
document.

**Radiation exchange and shields.** Temperature enters as the fourth power of an
**absolute** temperature, so Celsius is not a shifted scale here — using it is
wrong by orders of magnitude, and the conversion is stated. A radiation shield
**does not insulate**: it is thin, conducts well and touches nothing, and works
purely by adding surfaces that must each re-radiate. N equal shields cut the
exchange by N+1, which is why multilayer insulation is dozens of sheets of
metallised film rather than one thick blanket. Emissivity stays a measured
input.

**A defect caught by its own limit check.** The crossflow ε-NTU correlation has
two different exponents — 0.22 outside and 0.78 inside — and the first draft
used NTU^1.22 in the inner term. That does not reduce to 1 − exp(−NTU) as Cr
goes to zero, and gave 0.934 where every other arrangement gave 0.865. The
exponents sum to 1 precisely so the Cr terms cancel in that limit, which is what
made the error visible.

**The four new tools draw, and so does the LMTD exchanger:** its temperature
profile along the length, which is what makes the LMTD visible and shows a
counterflow gap staying roughly constant where a parallel one collapses; then
effectiveness against NTU for every arrangement with this exchanger marked,
temperature along the fin, the cooling curve against its ambient asymptote, and
radiation against convection as the surface heats.

*Corrected: the first draft of this entry said all five existing Thermal tools
now draw. Only the exchanger does. `wall`, `thermo-process`, `thermo-cycle` and
`thermo-vapour` are still text-only and are named in the audit's remaining list
every run.*

**Figure ratchet 16 → 21 of 118.**

### Ten defects, caught by the independent adversarial pass before release

Two were blockers, and one of them was in the new instrument itself.

1. **The fin figure emitted `NaN` into its SVG path.** `Math.cosh` overflows
   past an argument of about 710, so `cosh(m(Lc−x))/cosh(mLc)` became
   `Infinity/Infinity` for a long, thin, poorly conducting fin — **56 `NaN`
   tokens** in the path, with the numbers above it all correct so nothing
   hinted at it. And this tool actively *invites* bad fins, since a bad fin is
   the result it exists to demonstrate. Now evaluated as
   `e^(A−B)·(1+e^−2A)/(1+e^−2B)`, where every exponent is non-positive.
2. **"Radiation carries NaN% of the total"** appeared in a user-facing note
   whenever both surfaces were at the same temperature — 0/0, reachable by
   typing one temperature twice, because the tool's own default convection
   coefficient is non-zero.
3. **The layout instrument could not see `<path>`**, which is every data curve
   `buildPlotSvg` draws. It reported a *gridline* crossing a legend entry and
   missed the *curve* that entry names. A gate blind to the thing it was built
   for is worse than no gate, because it is believed. It now parses paths, and
   its self-test carries a path payload so it can catch that blind spot again.
4. **The margin calculation ignored error bars**, which the drawing code
   includes unconditionally. Pasting a third column into the Plot tab produced
   exactly the collision this release claims to have fixed.
5. **And it walked a different range than the drawing code** — no 6% padding,
   a different degenerate expansion — under-sizing **2.6%** of margins over
   20,000 random plots and pushing 36 labels off the canvas.
6. **The y-title reserve was 16 px for a title that reaches 18.3 px.** The two
   now share their constants so they cannot drift apart again.
7. **Axis labels read `-2.8e-17` where `0` belongs**, in about 2% of ranges
   straddling the origin — meaningless, and wide enough to cause (5).
8. **Fin effectiveness returned `NaN` for a base at ambient**, an ordinary
   input, and silently dropped all three effectiveness notes with it.
   Effectiveness is η·A_fin/A_c and does not depend on the driving temperature
   at all.
9. **The audit's own thresholds were too lax** — up to 2.2 characters of
   overlap went unreported, and the glyph-width estimate was 7% *under*, when a
   collision detector must over-estimate. Tightened; every figure still passes.
10. `lumpedCapacitance` could return an infinite time constant and a `NaN`
    energy at extreme magnitudes. It refuses now.

The sweep that found (5) and (7) is now a test: **400 random ranges and 300
zero-crossing ones, with no clipping, no collision and no spurious label.**

## [2.79.0] — 2026-08-02 — Structural & solids: every tool draws, and two hand-carries close

First release against `docs/ENGINEERING-DEEP-DIVE-2026-08-02.md`. **Every one of
the six Structural & solids calculators now inserts a figure**, and the two
worst composition gaps in the bench are closed.

**The minor axis was missing, and it is the axis that buckles.** The
cross-section tool computed the second moment about the bending axis only.
A column bends about whichever axis is *weakest*, and for an I-beam that is
emphatically not the one it was designed to bend about — the default section
here has an **Ix 12.6 times its Iy**. Quoting the bending I to a buckling check
overstates the critical load by that whole factor, and the answer looks
entirely reasonable. `Iy`, `ry` and `Imin` are now computed for all six shapes,
exactly: every strip decomposition is symmetric about the vertical centreline,
so the parallel-axis terms vanish and the sum is closed-form.

**`section` → `column`, the worst trap in the bench.** The column tool needs I
in m⁴ and A in m²; the section tool reports them in mm⁴ and mm², because that
is what every section table in the world prints. Pasting the bare number across
is wrong by **10¹²**. The unit contract only half closed it — `1e6 mm^4`
converts, a bare `1e6` is assumed to already be in m⁴. The column tool can now
compute the section itself, taking the **minor** axis automatically, which
removes the paste and the wrong-axis mistake in one move.

**`fatigue-endurance` → `fatigue-safety`, the half nobody had noticed.** The Kf
hazard on this pair was closed in v2.66.0; the deep dive found a **second**
hand-carry on the same pair that no sweep had flagged. `Se` — the entire output
of the endurance tool, six Marin factors multiplied together — was still typed
in by hand. Nobody re-derives that chain, so it gets pasted, and too *high* an
Se makes the part look safer than it is. It can now be computed in place.

**Mohr's circle.** The stress tool has always computed the circle's centre and
radius and named the construction in its own output without ever drawing the
most recognisable diagram in mechanics of materials. It draws it now, with both
principal stresses marked, the applied state and its conjugate joined through
the centre, and the radius shown as what it is — the maximum in-plane shear.

**The Goodman diagram.** The whole reason to show four mean-stress criteria is
that they *disagree*, and the disagreement is a picture: four loci and one
operating point. Modified Goodman, Soderberg, Gerber, the ASME ellipse and the
Langer yield line are drawn together at n = 1, with the load line from the
origin — because the factor of safety is measured **along** that line, not
vertically.

**And the rest of the discipline.** The cross-section drawn to scale with its
neutral axis and both extreme-fibre distances, which is where an unsymmetric
tee's two different section moduli come from. The Euler hyperbola and Johnson
parabola against slenderness with this column marked, which makes the reason
the parabola exists impossible to miss — Euler runs off to infinity as the
column gets stumpy. The truss in its own geometry with members coloured by
tension, compression and **zero force**, because a zero-force member looks
structurally essential on a sketch. And torsional shear against radius, linear
from zero at the axis, which is the entire argument for a hollow shaft.

**Both new chart families use an equal aspect ratio deliberately**, which is why
they do not go through `buildPlotSvg`: that plotter scales x and y
independently, and a Mohr's *circle* drawn as an ellipse is not a Mohr's circle.

**A figure ratchet.** The audit now counts how many tools insert a figure and
fails if the number drops. **16 of 114** today. The goal is all of them, and the
audit prints the remaining 98 by name each run.

**Ten defects, caught by the independent adversarial pass before release.** Two
would have frozen Word:

1. **`niceStep` had no postcondition and five tick loops trusted it.** It could
   return `Infinity` (from an infinite span) or exactly `0` (from a subnormal
   one, where `10^floor(log10 x)` underflows), and every caller was an open
   `for (t = lo; t <= hi; t += step)`. `t += Infinity` sticks; `t += 0` never
   advances. `analyzeColumn` returns `transition = Infinity` for a vanishing
   yield strength and the chart fed it straight into its axis limit — **4 GB of
   heap before the process died**. In a task pane that is a frozen Word, not an
   error. The helper now has a finite-positive postcondition, and every tick
   walk is a **bounded array** rather than an open loop, because
   `Number.isFinite` on the inputs is not a bound.
2. **Four of the six builders returned a blank white box** on a degenerate
   input — 118 bytes, no message — which inserts into the document as artwork
   and renders as nothing. **Zero torque is a perfectly legal input** that
   produced one. All six now say why they are empty.
3. **The column tool's section note quoted a number it had not converted:** it
   printed `Iy` while converting `Imin`, internally inconsistent by a factor of
   62 on a wide tee, in a note whose entire job is to show the conversion. The
   value handed to the engine was right throughout.
4. **The Goodman diagram contradicted its own factor of safety** for a
   compressive mean stress. The four fatigue criteria clamp a compressive mean
   to zero; the Langer yield line uses its *magnitude*. One marker served both,
   so a case the text reported as **failing** was plotted comfortably inside
   the yield line. The two families now get their own markers.
5. **"`Iy` is the minor axis" was false in four places.** It holds for a tall
   section and fails for any section wider than it is deep — a 200×50 plate on
   edge has `Iy` well *above* `I` — and the first draft told the user such a
   plate had **no weak axis at all**. Which axis is weaker is a fact about the
   dimensions, so `minorAxis` is now computed and reported by name.
6. **The Marin shortcut dropped every warning the endurance engine returns**,
   including *"this material has NO true endurance limit"* for a non-ferrous
   alloy. It printed an infinite-life factor of safety, for a material that has
   no infinite life, with no caveat.
7. The torsion figure's radius axis was passed metres and formatted to one
   decimal, so a 20 mm shaft's outer surface read **"0.0"** on an axis with no
   unit.
8. The material-class option value was `nonferrous` where the type is
   `non-ferrous` — harmless today only because the engine branches on `steel`,
   and hidden by a cast.
9. An em-dash error message in `section.ts` became reachable from a second tool.
10. The figure ratchet would have counted a blank white box as a figure. Fixed
    at the source by (2), and pinned by a test asserting every degenerate output
    carries text.

**Two defects fixed on the way, both found by the new work rather than shipped.**
A non-finite operating stress put `NaN` into three coordinate attributes of the
Goodman SVG — artwork that goes into a document and renders as nothing; every
coordinate is now checked. And a figure's **caption** was not passing through
`plainDashes`, so a single em dash in a caption disabled Insert for a tool whose
numbers were all fine. Captions and alt text are now cleaned like every other
line, which matters more with ~100 figures still to come than it did with ten.

## [2.78.0] — 2026-08-02 — Tier 1 closed

The last six items of the 2026-08-01 gap analysis, shipped together. **Tier 1 is
now complete.** Dead-export ratchet **17 → 10**.

**Two composition handoffs, removing a transcription step each.** The product
was telling users to read a number off one calculator and type it into the next,
which is where a digit goes missing. **`chips-thermal`** can now compute its
dissipated power from the switching parameters (C, V, f, activity, leakage) via
the same `switchingPower` engine the power tool uses, instead of having the
answer re-typed. **`pump-npsh`** can take its density from the shipped water
table and its **suction-line loss from the pipe engine** — diameter, length,
flow, roughness and fitting K in, Colebrook friction factor and head loss out —
rather than requiring a separate run of the pipe tool and a hand-carry. Both
copy the remedy the fatigue Kf field already shipped: put the upstream quantity
where the downstream tool can produce it.

**Vapour pressure is still yours, and now says why.** It is the one number on the
NPSH panel the product will not fill in. Density and viscosity come from a table
that ships with a source; a saturation-pressure correlation would have to be
reconstructed from memory, which is exactly the class of unverifiable constant
this product refuses — the same reason no steam tables are built in. It matters
more than the others, too, because NPSH available collapses as the liquid warms
almost entirely through that term.

**The reverse leg of the electrothermal loop is stated, not modelled.** Leakage
is exponential in temperature, so a junction running far above wherever the
leakage was measured draws more than was entered, which heats it further.
Predicting that needs a process model this product deliberately does not have,
so the feedback is named rather than guessed at.

**Every beam report now carries an equilibrium check.** The reactions must carry
exactly the applied load — that is an identity, not an approximation. The check
sums the **parsed loads**, independently of the solved system, so a load line the
parser could not read shows up as a residual instead of silently vanishing from
a report that otherwise looks complete. Applied couples contribute no vertical
force, which is why they are absent from the total.

**The FFT filter's edge can now be DESIGNED rather than chosen.** The raised
cosine was smooth — so it did not ring — but it was an ad-hoc shape: you could
not say what attenuation it achieved anywhere. Picking **Butterworth** or
**Chebyshev** hands the specification to `filter.ts`, which computes the minimum
order from your transition width and stopband target, and the magnitude response
of that design is applied bin by bin. The order and the attenuation **actually
achieved** are reported. Chebyshev reaches the same specification at a lower
order and pays for it in passband ripple, which is the entire reason both
families exist. **The raised cosine remains the default, so no result anyone has
already produced changes.** A zero transition band cannot be designed to — that
is the brick wall — and the tool falls back and says the filter is not the one
you asked for.

**The 3-D transform toolkit is reachable at last.** `mat3Apply`, `mat3Mul`,
`scaleMatrix`, `reflectionMatrix`, `rotationMatrix` and `transformEffect` were
complete, tested, and uninvokable — an import edge from `geometryParse.ts` kept
the module-orphan check happy while every function in it stayed unreachable,
which is precisely the trap a module-level check cannot catch. Solve's geometry
input now takes `rotate 90 z then scale 2 (1,0,0)`, composing operations left to
right and **saying that order matters**. The determinant is reported as the
volume scale factor, a **negative** one is named as flipping orientation — a
reflection preserves every length and angle yet no rotation can reproduce it —
and a **zero** one is named as collapsing space rather than returned as an
ordinary answer. Rotation entries are cosines, so those results are shown as
decimals: the rational layer exists so rotations *compose* with the exact
transforms, not so cos 90° gets printed as a sixty-digit fraction.

**Indefinite integrals.** Leaving both limit boxes blank in Solve's integral mode
returns F(x) + C. The engine already computed F on the way to every definite
answer and discarded it after subtracting; this is the entry point that hands it
back. **The check is shown, not claimed:** the answer is differentiated again and
the derivative printed beside it, with the status stated — `symbolic` when the
CAS proved d/dx F − f identically zero, `numeric` when a rule-table answer agreed
with the integrand at every sampled point. The distinction is reported rather
than flattened because the printed derivative often does not *look* like the
integrand even when it equals it: d/dx ln|x| simplifies to x/|x|², which is 1/x
for every real x ≠ 0 and does not resemble it on the page. No closed form is
reported as such rather than as a failure — exp(−x²) and sin(x)/x genuinely have
none.

**A fourth claim from the original sweeps was wrong.** The gap analysis listed
`regression.ts probit` as dead. It is not: `qqPoints` calls it, and the pane
calls `qqPoints` to draw the Q-Q diagnostic plot for every regression. Nothing
to surface and nothing to delete — the entry was mistaken, and the document now
says so rather than quietly dropping it.

**Ten defects, caught by the independent adversarial pass before release.** The
61-check suite was green when it ran. What it found, all fixed and all now
pinned as tests:

1. **`antiderivative` printed `NaN` and would have inserted it into a document.**
   `sqrt(-1)`, `ln(-1)`, `asin(2)` and `1/0` are constants that evaluate to NaN
   or Infinity, and the constant rule ∫c dx = c·x accepted them, producing
   `NaN*x + C`. `NaN` is not the em-dash the insert guard scans for, so nothing
   blocked it. The **definite** branch of the same module already refuses these
   by name — the new one was more permissive than its own sibling.
2. **The designed band-stop was structurally broken and ~20 dB *worse* than the
   ad-hoc ramp it replaced.** Built as `1 − |HP|·|LP|`, its notch depth is
   bounded by the *passband ripple*, not by the requested attenuation: at 1 dB
   of ripple it can never beat about −19 dB however much is asked for. Measured,
   it delivered 40 dB across 1% of the band where the cosine managed 83%. It is
   now the two sections **in parallel**, `LP(lo) + HP(hi)`, where each section's
   own stopband attenuation governs the notch — 56 dB at mid-band where the
   complement gave 18.
3. **A stopband edge at or below zero was clamped to 1e−9 and its attenuation
   quoted anyway.** A high-pass at 2 Hz with a 10 Hz transition implies a
   stopband edge at −8 Hz; the clamp reported "order 1, 191 dB" for a filter
   passing 14% of the amplitude at 0.5 Hz. Two unrelated specifications both
   reported 195 dB — the number was a function of the clamp, not the design.
   Refused now.
4. **`verified: "symbolic"` claimed a proof that was never performed.**
   `symbolicIntegrate` accepts a candidate either by canonical proof *or* by
   eight float samples when the simplifier cannot settle it, and set
   `verified: true` on both paths — making the flag a constant and its own doc
   comment false. `tan(x)`, `tanh(x)` and `sqrt(x)` were all reported as "proved
   identically zero" on the strength of samples. Fixed at the source in
   `casint.ts`; the `numeric` tier, which nothing could previously report, is
   now reachable and lands on exactly those cases.
5. **The 3-D transform parser silently substituted different transformations.**
   An axis it could not read became `z` (so `rotate about x 90` rotated about
   z), `1e3` was read as 1, `1/2` as 1, a two-factor scale quietly dropped one,
   a plane written after the point was discarded, and a comma between operations
   dropped the second. Every one of those now either parses correctly or
   **refuses by name**.
6. **`volume scale factor = -1  ≈ 1`** — one row carried `|det|` as its value and
   the *signed* determinant as its exact string, and the renderer prints both
   when they differ. A volume scale factor is non-negative by definition; the
   determinant now has its own row and keeps the sign.
7. **"genuinely have none" was false for most refusals.** Of the integrands the
   engine returns nothing for, the majority — `sin(x)²`, `sec(x)`,
   `exp(x)·cos(x)` among them — have standard answers a first-year student
   produces by hand. Telling a student that sin(x)² has no antiderivative blames
   mathematics for an engine gap. The message now distinguishes what is provably
   impossible from what this integrator merely could not find, and claims
   neither when it cannot tell.
8. **The typed cutoff meant different things for a low-pass and a high-pass** —
   `t` past the edge for one, `t/2` either side for the other — so a designed
   high-pass was 12 dB down at its own stated cutoff. One convention now.
9. **A cascaded Chebyshev delivered double its ripple budget**, because two 1 dB
   sections in series give 2 dB. Each section is designed to half.
10. **The beam equilibrium check hard-coded "down" and "up"**, printing
    "-30 kN down" for a legal upward load.

**The real-bundle audit now drives every non-default dropdown option, and found
a bug on its first run.** Three of the changes above are new select options, and
the audit only ever exercised each tool on its *defaults* — so a dropdown was
only tested at whichever choice it opened on. That is a real hole, because a
select is precisely how this bench offers an alternative *model*, and every other
option is a code path nothing else in the audit entered. The sweep drives all 137
non-default options in the production bundle, one at a time. It immediately
flagged a pre-existing defect it was not written for: the cross-section tool's
"circular hollow" refusal used an **em dash**, which is the pane's non-finite
sentinel and therefore **disables Insert for the whole result**. Reworded.


## [2.77.1] — 2026-08-02 — The wind triangle's second solution

**A doctrine violation shipped in v2.77.0, found on review and fixed.** The
adversarial pass had flagged it and explicitly declined to call it a defect,
because the number returned was correct. It is a defect: the product's stated
rule is that when two solutions exist, **both** are returned rather than one
chosen silently — `aimForRange` does exactly this in the same release, and its
doc comment cites the 2R arm's inverse-kinematics branches as the precedent.

`windTriangle` kept only the arcsine root. The other, π − wca, is usually
spurious — it makes good the **reciprocal** track and shows up as a negative
ground speed, which is the test that rejects it. But when the wind exceeds the
airspeed with a component along the track, **both roots give a positive ground
speed and both genuinely close the vector triangle**. Track 090 at 50 m/s with
80 m/s from 240 can be flown on **143.1° at 99.3 m/s** or on **216.9° at
39.3 m/s** — the second pointing backwards relative to the air while the wind
carries you along the track. Real for a balloon or a very slow aircraft.

Both are now returned, fastest first, with a note. Verified by an independent
check that flies each heading, adds the wind vector, and confirms the resulting
ground track closes on the requested one to twelve figures — and that ordinary
conditions still yield exactly one.

## [2.77.0] — 2026-08-02 — Trajectory & orbits

A **nineteenth** Engineering discipline, and the whole suite scoped in
`docs/SCOPE-TRAJECTORY.md` delivered in one release rather than three.
Engineering is now **114 calculators across 19 disciplines**.

**Ballistic (4).** Projectile motion in a vacuum, where **45° is optimal only
when the launch and landing heights match** — throw from 10 m at 20 m/s and the
best angle is **39.3°**, because the drop buys flight time for free and trading
elevation for horizontal speed pays. The familiar 45° is the special case of
h = 0, and the tool reports the optimum for *your* height beside the shot you
asked for. The same shot **with air drag**, integrated numerically through
`ode.ts` with a terminal event on ground contact and ISA density from `aero.ts`,
which shows that **drag is not a correction but the dominant term**: the default
bullet-like case flies **2970 m** against a vacuum range of **56518 m**, or
5.3%. The inverse aiming problem returns **both** the flat and the lofted angle
(23.67° and 66.33° for 30 m at 20 m/s, summing to 90°) and **REFUSES** a target
beyond maximum range rather than clamping to 45° — the same doctrine as the 2R
arm returning both IK branches. And impact speed, energy and momentum, where
**the energy saturates**: a 4.5 g hailstone reaches terminal speed, so falling
5000 m delivers the same **1.099 J** as falling 1000 m while the vacuum answer
climbs from 140 m/s to 313 m/s.

**Orbital (5).** Circular orbits, where **a lower orbit is a faster one**;
elliptical orbits by vis-viva, where **the period depends only on the semi-major
axis** and not at all on eccentricity; the **Hohmann transfer**, which carries
the best result in the subject — **to catch something ahead of you in the same
orbit you must slow down**, because firing forwards raises your orbit and
lengthens your period; the Tsiolkovsky rocket equation, where Δv is
**exponential** in mass ratio so the last increment costs by far the most, which
is why staging exists rather than one bigger tank; and escape speed, which is
**independent of direction** and exactly √2 times circular, so leaving from
orbit costs 41% more rather than twice as much.

**The gravitational parameters came in the way the data doctrine requires.** μ
and the body radii for Earth, the Moon, Mars, the Sun and Jupiter were
script-extracted from the poliastro constants module (IAU 2009) — the same
treatment `flame.ts` gave the NASA-7 polynomials and `colourspace.ts` gave the
chromaticity primaries — and validated by a committed cross-check against facts
known **independently** of that file. The strongest of those: **μ_Earth
reproduces the sidereal day at geostationary altitude**, 86164.0 s from a
published 35786 km, which a transcription slip could not survive. Also checked:
surface gravity 9.80 m/s², the ISS period at 92.6 min, escape at 11.18 km/s, and
the Moon at about a sixth of Earth's gravity.

**Profiles & navigation (4).** Jerk-limited **S-curve profiles**, which are
**slower on purpose** — 2.450 s against a trapezoidal 2.250 s — because a
trapezoidal profile steps acceleration instantaneously, and infinite jerk is a
broadband impulse that excites every structural mode the machine has. Multi-axis
coordination, where **throttling the fast axes costs nothing** in cycle time (the
slowest axis sets it regardless) and is what makes the path straight instead of a
dog-leg. Great-circle distance and bearing, where **the initial bearing is not
the final bearing** — Heathrow to JFK departs on 287.9° and arrives on 231.3°.
And the wind triangle, which closes a named gap from the aviation build and
**refuses** when no heading makes the track good rather than returning an angle
that cannot fly.

**Drag coefficients remain user inputs**, deliberately: Cd depends on shape, Mach
number and Reynolds number, and a built-in table would be wrong for every
projectile except the one it was measured on. Also not built, and said so in the
scope: 6-DOF simulation, guidance laws, N-body perturbations and re-entry
heating.

**Seven defects, and the author's own suite found none of them.** The 59-check
oracle suite was green when an **independent** adversarial pass was run over the
diff — the standing rule, and the reason it exists. What it found, all fixed and
all now pinned as tests in `trajectory.adversarial.test.ts`:

1. **`dragShot` returned a mid-air position labelled as ground impact.** The
   integration horizon was a multiple of the vacuum flight time, on the stated
   assumption that the vacuum time is an upper bound once drag is on. **It is
   not.** Drag shortens the ascent but *lengthens* the descent, because the fall
   settles towards terminal speed instead of accelerating without limit — a
   ping-pong ball off a 1000 m cliff takes **118 s** against a vacuum 14 s. The
   tool reported 43.8 s with the ball **627 m in the air**, and `solveOde`
   returned `completed: true` while doing it, so a solver-success check would
   never have caught it. The horizon now grows until the ground event actually
   fires, and if it never does the tool refuses rather than reporting where the
   projectile happened to be.
2. **`dragShot` returned `NaN` and a fully subterranean path** for a level or
   downward launch from ground level: the ground event needs a strict sign
   change, so starting at y = 0 it never fired. A `NaN` reaches the pane as an
   em-dash, and the em-dash blocks insertion. Now refused by name.
3. **The apex was 15–40% low.** It was the maximum over the solver's samples,
   and RK45 integrates a near-ballistic arc so accurately that it takes only a
   handful of enormous steps — none near the vertex. A shot put's apex read
   3.48 m against a true 4.11 m. The apex is now a second, non-terminal event
   on the vertical velocity, bisected to solver tolerance.
4. **Above the ISA ceiling, drag was silently zero.** `atmosphere` returns null
   above 84,852 m and that was read as vacuum, so a high shot integrated 94 km
   of flight with no air while the notes claimed standard-atmosphere density.
   Now refused, which is what the aviation bench does at the same altitude.
5. **The Hohmann phase angle was never wrapped**, so a descending transfer
   reported **−1078.75°** for GEO to LEO. The field is documented as a lead
   angle; it now lands in (−180, 180] and reads +1.25°. Ascending transfers
   were correct throughout, which is why it went unnoticed.
6. **`multiAxisMove` asserted a dog-leg its own numbers disproved** when every
   axis already finished together, and emitted zero limits for a zero-distance
   axis — a plan this same function then refused as input.
7. **Overflow with finite, legal inputs.** A launch speed of 1e155, an orbital
   radius past 5.6e102, a mass ratio of 1e600: each returned `ok: true` with an
   Infinity or a NaN in a numeric field. All now refuse.

**And one the author's own pass did catch first.** `impactEnergy` computed fall
time by inverting v = v_t·tanh(gt/v_t) — exact on paper, useless in floating
point: past a few hundred metres v/v_t rounds to exactly 1.0 and the time
**saturated at 39.7 s for any drop height**, 5.7× below the physical floor of
h/v_t. Fixing it introduced a mirror failure at the *other* end, which the
adversarial pass then found: as x → 0 the `arccosh(e^x)` form loses all its
precision and eventually returned a flat **zero** for a fall that plainly takes
time. All three regimes are now explicit — asymptote when deep, series when
shallow, closed form between — and `fallTime ≥ h/v_t` is pinned as an invariant
across fourteen orders of magnitude of drag.

`ode.ts`, `aero.ts`, `fluids.G` and `solve.ts` are reused rather than
reimplemented, so the trajectory bench and the aviation bench cannot disagree
about gravity or the air.

## [2.76.0] — 2026-08-02 — Colour gamut coverage, on fetched primaries

Closes the one item the audio/video scope deliberately left open. Engineering
is now **101 calculators across 18 disciplines**.

**The data came in the way the scope required.** The chromaticity primaries for
sRGB, Rec.709, DCI-P3 and Rec.2020 were fetched from the colour-science
project's dataset modules — which cite IEC 61966-2-1 and ITU-R BT.709-6 /
BT.2020 — extracted by a script, and validated by a committed cross-check
against facts known independently of that file. The strongest of those: **sRGB
and Rec.709 came back with identical primaries**, which is true by construction
of the sRGB standard and would break instantly on a transcription slip. Also
checked: every primary is a physically possible chromaticity, Rec.2020's red
sits on the spectral locus as its monochromatic definition requires, and the
size ordering is Rec.2020 > DCI-P3 > sRGB.

**COVERAGE and AREA RATIO are reported separately**, because conflating them is
the standard marketing move. DCI-P3 is **126% of sRGB by area** and covers
**exactly 100%** of it — it encloses sRGB entirely, so the extra area is in
colours sRGB never had. Quoting the ratio as "coverage" would claim 126% of a
space it merely contains. Coverage is computed as a real polygon intersection
(Sutherland-Hodgman), not an area comparison.

**Two claims I wrote were disproved by the data and corrected in the code, not
just the tests.** I had asserted that DCI-P3 fails to cover parts of sRGB — it
does not, it contains it — and that CIE u'v' always gives the smaller figure
than xy. The second is simply false: sRGB covers 52.9% of Rec.2020 in xy and
58.0% in u'v'. The direction depends on where the gamuts differ. What holds is
that the two metrics disagree materially, which is why both are shown and u'v'
is the one to quote. Both corrections are recorded in the module.

## [2.75.0] — 2026-08-02 — Video & display

Third step of the audio/video bench: an **eighteenth Engineering discipline**,
6 calculators, taking the bench to **100**.

Bitrate budgets, resolution and viewing geometry, HDR luminance, PSNR, streaming
buffers, and end-to-end latency. As with audio, each is written around the thing
people get wrong:

- **4:2:0 is a 50% reduction, not 25%.** It halves chroma resolution both
  horizontally AND vertically, so the two chroma planes together carry a quarter
  of their full-resolution samples: 1 + 0.25 + 0.25 against 3. Pinned by a test.
- **The eye is the limit, not the panel.** Past a certain distance the pixel
  grid is unresolvable at normal acuity, and a finer display changes nothing
  that can be seen.
- **Contrast is a claim about BLACK.** Black level varies by orders of magnitude
  between panel technologies while peak brightness varies by a factor of a few,
  so a headline contrast figure is really a statement about the black end.
- **PSNR is comparable only within one clip.** Squared pixel error is not what
  an eye responds to; comparing across content is the standard misuse.
- **Startup delay uses the SURPLUS bandwidth**, since playback drains the buffer
  at the stream rate while it fills. And a buffer trades latency for robustness
  one-for-one, which is exactly why live content breaks on a dropout that
  recorded content rides out.
- **The display quantises the latency total.** A frame appears only at a refresh
  boundary, so shaving 5 ms off the encoder can deliver exactly nothing — there
  is a test asserting precisely that.

**On the PQ curve and its constants.** ST 2084's coefficients are written as the
exact rationals the standard defines them by (2610/16384 and the rest) rather
than as decimals, because they are definitional rather than measured — the
fractions ARE the specification. They are verified by a PROPERTY rather than by
comparing digits: PQ(1) must return exactly the 10000 nit peak the curve is
defined against, and PQ(0) must return 0. Wrong constants fail that instantly.

**Colour-gamut coverage is deliberately NOT in this release.** It needs the
chromaticity primaries of sRGB / Rec.709 / Rec.2020 / DCI-P3, and per the scope
those must be fetched from a citable source and cross-checked in a committed
test before they ship — the treatment the NASA polynomials in flame.ts got.
Typing them from recollection is the one thing that file must not do, so the
calculator waits rather than shipping on remembered numbers.

## [2.74.0] — 2026-08-02 — Audio & acoustics

Second step of the audio/video bench: a **seventeenth Engineering discipline**,
7 calculators, taking the bench to 94.

Sampling and aliasing, quantisation and dynamic range, decibels, sound level
with distance and summing, reverberation, room modes, and comb filtering. Each
is written around the result people get wrong rather than around the formula:

- **Decibels show BOTH readings, always.** 10·log₁₀ for power-like quantities
  and 20·log₁₀ for field-like ones is not a convention to memorise — power goes
  as the square of a field — and picking wrong doubles or halves every figure
  downstream while looking entirely plausible. A tool that silently chooses one
  cannot tell you it chose wrong, so the other reading sits beside it.
- **Two identical sources are +3 dB, not +6.** Incoherent sources add in power;
  the +6 figure is coherent addition. Ten machines are +10 dB, not +60.
- **Sabine and Eyring are shown together.** Sabine's formula never reaches zero
  however absorbent the surfaces are — set every surface to a perfect absorber
  and it still returns a finite reverberation time, which is impossible. Eyring
  fixes exactly that, they agree only below about ᾱ = 0.2, and the divergence is
  reported rather than hidden behind a choice made for the user.
- **Quantisation SNR keeps its 1.76 dB.** 6.02n alone understates every
  converter; the 1.76 comes from a full-scale sine against uniform quantisation
  error. And the whole figure assumes a full-scale signal, which is why 24-bit
  is for tracking rather than delivery.
- **Comb filtering cannot be equalised away.** A 1 ms delay notches at 500 Hz
  and every odd multiple; the cause is arrival time, so the cure is moving
  something, not EQ.

**The sampling tool calls the engine Biomedical already had.** `samplingCheck`
was general all along — nothing about it is biomedical — so audio reaches the
same implementation rather than forking it. One engine, two doors.

No absorption-coefficient table, no Thiele-Small library, no psychoacoustic
masking model: the first two are measured properties belonging on the datasheet
the user is reading, and the third is a fitted dataset rather than a formula.

## [2.73.0] — 2026-08-02 — Photometric units, and the ones that must not convert

First step of the audio/video bench (`docs/SCOPE-AUDIO-VIDEO.md`): units before
calculators, because a missing unit in a default value produces no output, no
error and no test failure — the trap that has caught this project four times.

Adds **luminous intensity, the 7th SI base unit**, and its derived quantities:
`cd` (with mcd/kcd), `lm`, `lx`, and `nit`. HDR brightness is quoted in nits
universally, so the display calculators depend on this landing first.
`nit ≡ cd/m²` and `lx ≡ lm/m²` both convert, as they should.

**The design decision worth recording is which conversions are REFUSED.**

- **lumen ↔ watt** — related by the wavelength-dependent luminosity function,
  not a constant: 1 W at 555 nm is 683 lm, deep red a small fraction of that.
- **candela ↔ lumen** — needs the solid angle the source emits into. A torch and
  a bare lamp of equal candela differ enormously in lumens.
- **luminance ↔ illuminance** (nit ↔ lx) — opposite ends of the light path.

In strict SI a lumen is a candela-steradian and the steradian is dimensionless,
so these could have been made to share a signature and convert one-for-one. That
would return a confident number to a question the units alone cannot answer,
which is the failure this codebase refuses everywhere else. Luminous intensity
and luminous flux are therefore kept as separate atomic dimensions — the same
reasoning that keeps `angle` atomic so a radian cannot silently become a bare
number.

Also adds **`fps`**, which converts with Hz so a 60 fps source can be checked
against a 60 Hz panel. This deliberately accepts a collision: an aviation reader
might expect feet per second. That stays available and unambiguous as `ft/s`,
the codebase already writes climb rates as `fpm`, and in video "fps" is
universal — so the video reading wins and the decision is written down.

## [2.72.0] — 2026-08-02 — HMBC and TOCSY

The last two 2D experiments, and the end of the tier-1 list from the gap
analysis.

**HMBC** correlates protons to carbons two and three bonds away, which is why
it is the most useful of the four: HSQC can only see a carbon that carries a
proton, while HMBC reaches the ones that do not — quaternary carbons, carbonyls,
the ipso carbon of a substituted ring. Those are exactly the atoms an additivity
model places least well and a chemist most needs in order to connect a structure
across a heteroatom. Methyl acetate now shows both methyls correlating to a
carbonyl that has no HSQC peak at all.

Two-bond correlations are drawn faint on purpose: a real HMBC is optimised for a
long-range coupling near 8 Hz, which favours the three-bond ones, and a two-bond
peak is often absent altogether. Correlation intensity is not predicted, and the
result says so.

**TOCSY** shows the transitive closure of the coupling graph rather than one
step of it, so a contiguous coupled fragment appears as a block instead of a
chain of hops. Propan-1-ol resolves as one three-proton spin system with the OH
separate; methyl acetate as two isolated methyls. The spin systems are exact —
they are a property of the bond graph — while the shifts positioning them are
estimates, and relayed correlations are marked weak because their intensity
depends on the mixing time.

Spectra now offers eight predictions.

**Correction to this entry as first written:** it claimed tier 1 was complete.
It is not. Five small items remain and are listed in the gap analysis — the
chips and pipe composition handoffs, `totalLoad`, the `filter.ts -> fftFilter`
ringing fix, the geometry3d transforms, and an indefinite-integral entry
point. A changelog that rounds up is the same defect class as a landing page
that overstates a count.

## [2.71.0] — 2026-08-02 — Import a sequence file into the ST.26 listing

Tier 1 release G: the sequence workflow.

**Import FASTA / GenBank.** `parseSequenceFile` has read both formats, with
tests, since the Sequence Map work — and was reachable from that one mode. So an
attorney preparing an ST.26 listing for a biotech application carrying forty
sequences was pasting them into cards one at a time, while the reader that could
have loaded the whole file sat one import away. Multiple files at once; every
record becomes its own card, because ST.26 lists sequences individually and a
multi-record file is the normal case.

Molecule type is guessed from the residues and shown in the dropdown for you to
correct: RNA when there is a U and no T, protein when letters fall outside the
nucleotide alphabet, DNA otherwise. A short peptide spelled only in GATC letters
is genuinely ambiguous — "CAT" is a valid tripeptide and a valid codon — so it
reads as DNA and the guess is visible rather than silent. GenBank's organism is
carried across from the source feature.

The blank starter card is removed after an import, but **only if it is still
blank** — never anything typed.

**SEQ ID references take a list or a range.** `formatSeqIdRefs` was written to
collapse 1, 2, 3, 7 into a single citation and had no caller, so a specification
citing a run of sequences inserted them one at a time. The field now accepts
`1-3`, `1, 2, 5` or a plain number.

One more dead export paid off; the ratchet drops to 17.

## [2.70.0] — 2026-08-02 — DEPT, and the sp3 substituents that vanished

Tier 1 release F, chemistry half.

**DEPT.** Every ¹³C signal now carries its class — C, CH, CH₂ or CH₃ — and the
result spells out what DEPT-135 and DEPT-90 would show for the classes actually
present. The distinction that makes it worth having: this classification is
**exact**, read straight off the structure's own hydrogen count, while the shift
printed beside it is an estimate with a stated error. DEPT is precisely the
experiment that resolves the assignments an additivity model is least sure of,
and the information was already in the graph.

Stated rather than assumed: a peak in the decoupled spectrum with nothing at its
shift in DEPT is the diagnostic for a **quaternary** carbon, not a missing signal.

**The sp3 path now names substituents it ignored.** A group with no tabulated
increment contributes ZERO, so the shift comes out as if it were not attached at
all. `aromaticCaveats` had named that case on a ring since it was written; the
sp3 path stayed silent about the identical failure. It now reports which
attachment was ignored and that the carbon's value is unreliable — the same
class of fix as the ¹⁹F/³¹P caveat in v2.64.0.

Caught during this work: `deptBehaviour` was initially used only by its tests
while the pane restated the phases in its own words. Two copies of one fact,
one of them dead. The reachability ratchet failed the build, the pane now
derives its text from the helper, and the ratchet holds at 18.

## [2.69.1] — 2026-08-02 — The empty plot box in Bio/Assay

Reported from real use: Bio/Assay showed a plot box with nothing in it.

`.structure-preview` carries a 120px min-height, a border and a fixed white
paper background — it previews black-on-white artwork, so it deliberately does
not follow the theme. An empty one is therefore not invisible; it is a framed
blank panel. **Eleven of the sixteen Bio/Assay calculators never return a plot**
(Cheng-Prusoff, Beer-Lambert, dilutions, A260/A280, buffer ratio and the rest),
and the code cleared the panel's contents without ever hiding the panel. So most
of the mode rendered an empty white frame under its numbers.

The panel is now hidden whenever there is nothing to draw, on both paths — the
no-plot branch and the incomplete-form branch — and the "Insert plot" button is
hidden with it rather than sitting there permanently disabled.

Pre-existing, not from the recent tier-1 work. Found by reading the render path
after the report rather than by any gate: no automated check can see that a
correctly-cleared element is still a visible box.

## [2.69.0] — 2026-08-02 — The engine had no door

Tier 1 release E: **fit any model you can type**, plus the last of the wiring.

A real Levenberg-Marquardt engine with analytic covariance has shipped since the
assay work, reachable only through five hard-coded biochemistry models. So an
exponential decay, a logistic curve, a power law or a Gaussian peak had nothing,
and that is the most-used numerical verb after "plot". Nothing here improves the
engine; it opens it. Type a model in x with named parameters, get values with
standard errors, R², RMSE and the fit drawn over your data.

The honesty is in the starting values, which are the hard part of nonlinear
fitting: a converged fit from a poor start is the classic silently-wrong result.
Supply them and it says so; leave them blank and every parameter starts at 1 and
the result says THAT, with the reason a poor fit is usually a starting-value
problem rather than a wrong model. It also flags any parameter whose standard
error exceeds its own value (that parameter is not determined by your data), and
always states that R² on a nonlinear fit is descriptive only.

**Three dead exports surfaced.** The four **Bell states** are now presets in the
two-qubit tool, which previously required typing four complex amplitudes by hand
to reach the states everyone actually wants. `rayleighDamping` is now CALLED by
the modal code that had been repeating its formula inline — two statements of one
equation, one of them dead, which is how they drift apart. And with the finance
and assay work from v2.66.0, the dead-export ratchet drops from 27 to **18**; a
ratchet is only worth having if it is tightened when the debt is actually paid.

Analyze goes 22 to 23.

## [2.68.1] — 2026-08-02 — The em-dash sentinel, one layer out

PCA and the trapezoid tool shipped with em dashes in their note and error
strings, which would have disabled "Insert result" for both — the guard is a
whole-text scan, and an em dash is also the sentinel a non-finite value prints.

The reason it got through is worth recording: the gate that catches this
(`analyzeCalcText.test.ts`) scans the REGISTRY SOURCE in taskpane.ts, and these
notes are built in `pca.ts`. A library module's prose is invisible to it. Both
tools now run library notes and errors through `plainDashes` at the point the
result text is assembled, and a test pins that they do.

Caught by checking the deployed bundle rather than by any gate.

## [2.68.0] — 2026-08-02 — PCA, and integrating data you measured

Tier 1 release D. Both additions are thin layers over engines that already
shipped and were reachable only from one place.

**Principal component analysis**, built on the SVD of the centred data rather
than an eigen-decomposition of the covariance matrix. That is the same choice
regression makes in using QR: forming XᵀX squares the condition number and
destroys precisely the small components a scree plot exists to judge. Reports
variance and cumulative variance per component, how many components reach 95%,
loadings, scores, and a scree plot drawn by the real plot engine. Standardising
is offered as an explicit choice rather than a hidden default, because on raw
covariance a variable measured in millimetres dominates the same quantity in
metres purely through its units — and the result says which basis ran. Three
things it always states: component signs are arbitrary, PCA finds variance and
not importance, and loadings are unstable when observations are scarce.

**Trapezoidal integration of measured data** — the counterpart to Solve's
adaptive Simpson, which needs an expression you can evaluate anywhere. The
trapezoid rule existed only inside the pharmacokinetics module as a private AUC
helper, so anyone integrating a chromatogram, a power trace or a stress-strain
curve had nothing. x need not be evenly spaced; a decreasing x yields a negative
area, which is the correct signed integral and is reported rather than silently
flipped; and the result flags non-monotonic x and very uneven spacing. Both the
data and the running integral are plotted.

Analyze goes 20 to 22 calculators. Both new fields carry the v2.65.0 data-source
buttons, so a measured trace can come straight from a Word table or a CSV.

## [2.67.0] — 2026-08-01 — Every spectrum had leakage in it

Tier 1 release C (first part): **FFT windowing.**

`spectrum()` zero-padded and applied no window at all, so every spectrum this
product has ever drawn carried leakage. The cause is always present rather than
an edge case: an FFT assumes the record repeats forever, and unless the signal
holds a whole number of cycles the wrap-around leaves a discontinuity whose
energy smears one real tone across every bin. The skirts look like structure.

Hann is now the default, with Hamming, Blackman and an explicit "none" offered.
Amplitudes are corrected for the window's coherent gain, so a sinusoid of
amplitude A still reads A, and an off-bin tone actually reads MORE accurately
than it did before (scalloping loss falls). The result states which window ran
and what it trades.

**Two defects the change exposed, both fixed here.** A window widens the main
lobe, so `dominantFrequencies` — which took the top N *bins* — began reporting
one tone twice from adjacent bins and dropping the second tone off the list. It
now picks local maxima and excludes anything inside the main lobe of a peak
already taken: peaks, not bins. And a windowed CONSTANT signal is no longer
constant (it becomes the shape of the window), which made a flat input report a
confident dominant frequency where the old code correctly reported none; the
mean is now removed before peak-finding, which is standard practice anyway and
also stops a large DC offset drowning a real tone.

The em-dash sentinel bit once more during this work: prose punctuation in the
new note and in a dropdown label would have silently disabled "Insert result"
for the whole tool. Caught by the gate that exists for it.

## [2.66.0] — 2026-08-01 — Wiring what was already built

Tier 1 release B: capability that existed in tested code with no way to reach
it, and the one cross-tool gap that was a correctness hazard rather than a
convenience.

**The fatigue notch factor is applied instead of delegated.** The mean-stress
tool's σa field said "already multiplied by Kf" — the product computing a factor
in one calculator and requiring you to apply it by hand before typing it into
the next. Forgetting it is NON-CONSERVATIVE: the part reads safer than it is,
the one direction a safety factor must never err in. Kf is now a field, applied
internally, with the result stating that mean-stress concentration (Kfm) is
taken as 1 and why.

**Substrate inhibition can now be fitted.** `substrateInhibitionV` shipped and
was tested with no fitter and no caller, so an enzyme inhibited by its own
substrate had only Michaelis-Menten — which does not fail on such data, it
converges on a depressed Vmax and a distorted Km. On the reference curve now in
the tests, true Vmax 100 comes back from MM as 51.6 with R² 0.60. The new fit
recovers all three parameters exactly and reports the PEAK velocity and the
substrate concentration producing it, since Vmax here is an asymptote the enzyme
never attains.

**Five finance calculators that existed only as functions.** Straight-line
depreciation — the more common method, absent while declining balance shipped —
plus level annuities (PV and FV), level and growing perpetuities, rate
conversions across nominal/effective/continuous, and CAGR. Finance goes 19 to
24; Bio/Assay 15 to 16.

## [2.65.0] — 2026-08-01 — Your document is a data source

Tier 1 of the gap analysis, first release: **getting data in, and finding what
is already there.**

**Use table at cursor.** Every field that holds a table, list or matrix — 83 of
them across Stats, Analyze and the rest — now has a button that reads the Word
table your cursor is in, straight into the field. The reader had existed since
Table -> Chart shipped and was bound to that one mode, so a user whose numbers
were already in the document they were writing had to select, copy and paste
them into a pane box to run statistics on them. That was the one workflow a Word
add-in should own outright and the one that did not exist. Both callers now
share ONE reader rather than a second copy that could drift.

**Open CSV.** The same fields take a `.csv` / `.tsv` / `.txt` file. The parser
handles quoted cells properly — a label containing a comma, an escaped quote, an
embedded newline — because a naive split shifts every column after the offending
cell and produces a table that looks plausible and is wrong. Excel writes such
files by default. Delimiter is sniffed (tab, then semicolon, then comma), and
the 8 MB ceiling matches the existing sequence reader.

**Search finds tools and calculators.** The box indexed formulas and compounds
only, so none of the 26 tools and none of the 162 calculators could be found by
name — while a comment beside the home filter claimed "every tool stays
reachable from the dropdown and the search box". Both are indexed now, from the
same registries that render them, so a new calculator is searchable the day it
ships. A hit routes THROUGH the mode's own select and fires a real change event,
so panel rendering, live compute and the discipline panels follow exactly as
they do when a user picks by hand.

## [2.64.0] — 2026-08-01 — The eight live defects from the gap analysis

A full gap analysis (`docs/GAP-ANALYSIS-2026-08-01.md`) separated things that are
MISSING from things that are WRONG. This release is the second list.

**Two were correctness defects.** ¹H NMR skipped every non-carbon neighbour under
a comment reading "ignore exchangeable OH/NH coupling" — right for O and N, wrong
for **fluorine and phosphorus**, which do not exchange and couple hard
(²J(H-C-F) ≈ 47 Hz). A fluorinated CH₂ was reported as a confident singlet with no
warning. Those environments are now named in a caveat. And **Insights** correlated
every pair of pasted columns and called them "significantly correlated" on the
UNCORRECTED p — 45 simultaneous tests on ten columns, in the surface aimed at the
least statistical reader the product has. Correlations now carry a
Benjamini-Hochberg adjusted p, the narrative reports how many pairs were tested,
and a causation caveat rides along.

**One was a silent data defect.** Align concatenated a multi-record FASTA into a
chimera and aligned it. `countFastaRecords` had been written for exactly this
("&gt;1 means the caller should warn") and had no caller; DNA and Sequence Map both
warned already.

**One was a missing safety net.** There was no `window.onerror` and no
`unhandledrejection` handler anywhere, so an uncaught error in an Office task pane
rendered *nothing* — a pane that silently stopped, with no message and no way to
report it. A crash banner now names the failure, says the document is untouched,
and shows a pasteable report with the version in it. Nothing is transmitted.

**Four were claims that had drifted.** The Engineering tile advertised "36
calculators" against 87 — it now COUNTS them from the registry, so it cannot drift
again. Finance was tagged legal-only and invisible to science users. `landing/
science.html` sold restriction sites on sequence *maps* (they live in DNA mode).
And three stale refusals were corrected in place: `toa.ts` still refused page
numbers the product ships, `linalg.ts` called general eigenvalues out of scope
after they shipped, and the ROADMAP header said v1.96.0.

Found while fixing: my own first cut of the heteronuclear detector walked the
second bond through carbon only, which misses **H-C-O-P** — the most common
phosphorus motif there is. A probe caught it; a phosphate ester test now pins it.

## [2.63.0] — 2026-08-01 — Adiabatic flame temperature, the honest way

The one energy calculator that needed real thermodynamic data, built under
the data mandate: NASA-7 polynomials for CO₂/H₂O/N₂/O₂ taken MECHANICALLY
from GRI-Mech 3.0 (Cantera's gri30.yaml, fetched and script-extracted — no
coefficient typed by hand) and validated by a committed cross-check suite
against independent JANAF/CODATA landmarks, range-junction continuity, and a
cp-integration identity that would catch any transcription slip. The heating
value stays the user's measured input; the polynomials supply only sensible
enthalpies of four pure gases.

Honest limits carried in every result: no dissociation (overstates a
stoichiometric hydrocarbon-air flame by ~100–200 K, and says so), LHV basis
forced by the physics, sulfur fuels refused rather than answered with data
the tables do not contain, and a balance that cannot close below the 3500 K
polynomial wall is refused rather than extrapolated. Optional air preheat
(recuperator) and excess-air dilution. Energy & power is 17; Engineering 87.

## [2.62.0] — 2026-08-01 — Energy depth & grid power

The gap analysis, built: Energy & power grows 8 → 16 calculators (Engineering
is now 86). New `src/lib/grid.ts` — three-phase power (P = √3·V·I·pf on line
quantities, connection-independent), power factor correction (the real power
does not change; correction relieves the wires — delta and wye capacitor
sizing, differing by exactly 3), and cable voltage drop (copper at the
definitional 100% IACS, AWG computed from the gauge's exact geometric law,
√3-vs-2 path factor stated). Extended `energy.ts` — wind shear to hub height
(power law AND log law, disagreement reported, the control.ts two-methods
doctrine), Weibull wind statistics with the energy pattern factor and a
capacity-factor estimate (via the same Lanczos gammaln that sits under every
p-value, now exported from stats.ts), flue-gas analysis (measured dry O₂
inverted to excess air in closed form, on the same 3.76 air convention as the
combustion tool so the two cannot disagree), off-grid storage sizing + LCOS
(losses compound upstream; charging energy explicitly excluded), and sun
position / day length / H₀ from pure astronomy (polar day and night are
answers, not errors; same 1361 W/m² solar constant as the PV bound).

The wind tool now fills air density from the ISA at a given altitude — the
same atmosphere the aviation tools fly on, so the two benches cannot disagree.

## [2.61.0] — 2026-08-01 — Scientifically correct formatting in the energy suite

You pointed out H2O must never display as "H2O". Every chemical species in the
combustion tool now typesets with real subscripts — the title echoes your
formula as C₈H₁₈, the product lines read O₂/CO₂/H₂O/SO₂ — and the energy
tools' units display as m², m³/s, W/m², kg/m³, matching the rest of the bench.

The display is also a CONTRACT: what we show must parse back. parseFormula now
accepts Unicode subscript digits (pasting the displayed CH₄ works), and the
unit reader accepts superscript exponents (typing m³/s converts exactly like
m^3/s). Refusing ₄ while displaying ₄ would have made the correct rendering a
round-trip trap. A hydrate coefficient stays full size — 5H₂O is five waters,
not H₅₂O.

## [2.60.0] — 2026-08-01 — Energy & power

A sixteenth Engineering discipline: **Energy & power**, 8 calculators
(Engineering is now 78). Wind turbine power with the Betz limit enforced — a
claimed Cp above 16/27 is refused as physically impossible, the same way a
claimed efficiency above Carnot is. Solar PV output with NOCT cell-temperature
derating and a fill-factor consistency check. Hydropower on the net head.
Battery pack series/parallel design with C-rate and the Peukert correction
shown beside the uncorrected runtime. Combustion stoichiometry computed exactly
from the fuel's molecular formula via the IUPAC atomic weights (methane AFR
17.1, octane 15.0), with LHV derived from a user-supplied HHV. Levelized cost
of energy — where the energy is discounted too — and capacity factor.

Deliberately absent, per the steam-table rule: insolation tables, fuel
heating-value tables, battery chemistry curves. Those are measurements of a
site, a fuel and a cell; they are inputs, and the tool does the arithmetic and
the physical-bound checks around them.

New units: kWh/MWh/GWh, BTU and therm (therm derived as exactly 100000 BTU
after a hand-typed constant was caught transposed by its own probe), Ah/mAh,
and the US gallon. Deliberately NO lowercase "mwh" alias — it would make a
typed mWh (milliwatt-hour, a real coin-cell unit) resolve to megawatt-hours,
the same trap as Nm → nautical mile.

## [2.51.0] — 2026-07-30 — Element names, fetched and cross-checked rather than typed

You pointed out the periodic table showed no element names. That was deliberate in
v2.50.0 — 118 names typed from recollection is exactly the practice this project
refuses — but "deliberate" is not the same as "right", and a reference table without
names is a poor reference table. The answer was to get them from a real source.

### What was done

`scripts/fetch-element-data.mjs` fetches PubChem's periodic-table endpoint, caches the
response in `docs/`, and generates `src/lib/elementData.ts`. The script is committed, so
the data is reproducible rather than asserted.

**It refuses to write anything unless the two sources agree about which element is
which.** All 118 symbols must match the already-verified held table IN ORDER, and the
atomic numbers must be sequential. They do, exactly — and that agreement is what
licenses attaching PubChem's names to symbols this product had already verified.

### What was taken, and what was not

PubChem is a real source and **not an infallible one** — this repo has been bitten by
trusting it before, on folate stereochemistry. So it was cross-checked rather than
copied, and one class of value was deliberately left behind:

**Not taken: the atomic weights.** PubChem differs from the held IUPAC values for
lithium — which IUPAC gives as an interval, not a point — and for seven elements with
no stable isotope, where sources pick different reference isotopes. Those are
convention differences rather than errors in either source, and switching silently
would have changed numbers this product already computes with. `Li` still reads 6.94,
labelled IUPAC.

**Taken:** names, measured electron configurations, oxidation states, electronegativity,
ionisation energy, electron affinity, atomic radius and standard state.

### The check that validated both sides at once

The measured configurations were compared against this tool's own aufbau predictions.
They agree for 88 of 118, and the 30 that differ are **exactly the classic exceptions** —
Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, La, Ce, Gd, Pt, Au, Ac, Th, Pa, U, Np, Cm and the rest —
plus four the source itself labels "(predicted)". A correct aufbau implementation must
disagree with measurement precisely there and nowhere else, so each source corroborates
the other. That comparison is now a test: if the exception list ever grows to include
neon, the filling code has broken.

Where the two disagree the summary shows **both**, and says they differ because the
element is an aufbau exception. That is more useful than either alone — it is the fact a
student is being taught.

### Still absent, and still said so

Melting and boiling points, density, crystal structure, Mohs hardness and spectral
emission lines. The source fetched does not carry them, each entry says why, and none
has been filled in from memory.

### Two guards fired on this work, both correctly

The **network-surface** test refuses any external host in the source, because the
product advertises that OPSIN is its only outbound call. The PubChem URL in the
generated file's provenance header tripped it. Rather than adding a blanket exemption,
the guard now distinguishes a URL on a **comment** line (a citation) from one in code
(an address) — so a real runtime fetch to the same host would still fail it. The fetch
itself lives in a build-time script that never ships in the pane bundle.

The **dead-export ratchet** caught `atomicNumberByName` with no caller. Rather than
widening the ratchet, the function was wired up: the pane now accepts an element **name**
as input as well as a symbol or atomic number, which is what someone wanting names would
reach for anyway.

6,754 tests across 221 files. All twelve QC gates pass.

## [2.50.0] — 2026-07-30 — Periodic table & atomic structure, built without inventing data

The third wishlist feature, shipped the incremental way: everything that can be
computed or is already held, with every measured property **reported as absent** rather
than guessed.

### Why it is shaped like this

A 118-element table with ten properties each is roughly 1,200 measured values, and they
cannot come from recollection. The standing rule here is that all data must be real, and
the precedent is the deliberate refusal to build in steam tables because a table
reconstructed from memory is unverifiable. Filling in melting points to make the feature
look finished would have been the single worst thing this release could do.

So it carries exactly two kinds of thing.

**Held.** The symbols and standard atomic weights already verified in `PERIODIC`. The
atomic number comes from the ORDER of that table rather than a second list that could
disagree with the first — H is its first key, iron its twenty-sixth.

**Computed.** Electron configuration, shell occupancy, block, group and period, all
generated from the aufbau rule. The Madelung filling order is produced from its own
statement — increasing n + l, then increasing n — rather than typed out, so a
transposition in "1s 2s 2p 3s 3p 4s 3d…" is impossible rather than merely unlikely. The
noble gases are likewise **derived**, by asking which elements complete a p subshell;
that this returns exactly 2, 10, 18, 36, 54, 86, 118 is a check on the machinery rather
than an input to it.

### What it draws

**The periodic table** — 118 cells laid out from computed period and group, with the
f-block in two rows beneath. **A Bohr model** — one dot per electron, with the rings
counted from shell occupancy. **An orbital filling diagram** with Hund's rule applied,
which is the whole reason to draw one: `2p⁴` is a pair and two singles, not two pairs,
and that is the fact the picture carries which the written configuration does not. And a
**per-element summary**.

### The three places it refuses to overclaim

**Configurations are labelled PREDICTIONS.** About twenty elements — chromium and copper
the textbook pair — are measured to differ from the aufbau prediction, and those
measurements are not carried. Every diagram and every summary says so, and the caveat
travels into the inserted figure's alt text.

**The Bohr model says it is a teaching model.** It is from 1913, it gets the shell counts
right and the shapes wrong, and drawing it without saying so would present superseded
physics as current.

**The group-3 question is not decided.** Whether lanthanum or lutetium belongs in group 3
is genuinely unsettled and IUPAC has not closed it, so the whole fifteen-element f series
sits outside the numbered groups and the figure explains why rather than taking a side.

### And the absences are reported

Melting and boiling points, density, crystal structure, Mohs hardness, spectral emission
lines, oxidation states, and the element **names** are listed in the summary as absent,
each with the reason. A reference that quietly omits a property is indistinguishable from
one that has no data for that element, and the difference matters: these are missing
because they need a citation, not because the elements lack them.

One bug caught by its own test along the way: the orbital diagram had a fixed height and
**silently cropped** the heavy elements — gold and oganesson came out the same size with
oganesson's 7p simply missing. The figure now grows to fit, and a caller who forces a
small height is told the diagram is incomplete.

6,747 tests across 221 files. All twelve QC gates pass.

## [2.49.0] — 2026-07-30 — Candlestick (OHLC) charts

Second of the three wishlist features. One candle per row from four numeric columns —
where each period opened and closed, and how far it ranged in between. No existing
chart here carried four numbers per period: a line of closes throws the range away, a
bar of closes throws away the direction too.

### The convention is stated, not assumed

Green-up/red-down is a **Western** convention. Across much of East Asia red means UP.
A chart that leans on colour alone is therefore ambiguous to a large part of its
audience before colour blindness or a photocopier enters into it.

So direction is carried FIRST by the body — **hollow for up, filled for down**, which
is the older Japanese convention and survives greyscale — with colour as reinforcement
only, and a legend that says which is which in words. The red-is-up convention is
available as an option, and the legend follows it either way, which is the point of
having the option rather than a preference buried in code.

Asserted rather than asserted-to: the black-and-white rendering is tested to contain
no green or red at all and still distinguish the two directions.

### The columns are identified, not guessed

Reading open/high/low/close in the wrong order produces candles that look entirely
ordinary and are wrong — there is nothing to notice by eye. So names come first
(`Open`, `O`, `Open Price`, `Adj Close`, `Last`, and so on), and position is a
fallback **only when the OHLC invariants then hold on every row**: high really is the
largest of the four, low the smallest. A table whose columns are in another order
fails that check and is refused, naming the row that proved it.

The name matching is exact on a normalised name with only a trailing unit word
stripped, deliberately **not** a prefix match: "Open Price" must resolve to open and
**"Open Interest" must not** — that is a real futures column and a completely
different quantity, and a prefix rule would have handed its figures to the renderer as
prices.

### What it refuses to draw

A row whose high is below its close is impossible for a real period. That is a data
error rather than a market event, so no candle is drawn for it and the count is
reported. A row missing one of its four values leaves a **gap** rather than closing up
— shifting the later candles left would silently misdate every one of them.

A refusal is drawn INTO the figure rather than returning a blank frame, because a
blank frame is indistinguishable from a bug and gives the reader nothing to act on.

### The thing deliberately left out

**Volume on a second y-axis.** It is the obvious addition and the wrong one: two
y-scales on one plot make their alignment arbitrary and invent a correlation the data
does not contain — the single most common charting error. If volume is wanted it
belongs in its own panel sharing the x-axis, which is a separate change rather than a
second scale.

PowerPoint export ships a picture and refuses the native path, as heat maps do —
PowerPoint has no candlestick type and substituting a bar chart would present
different information under the same title.

6,699 tests across 220 files. All twelve QC gates pass.

## [2.48.0] — 2026-07-30 — Heat maps

First of the three features on the wishlist. A numeric table rendered as a grid of
shaded cells, for the job no existing chart here does: comparing magnitude across two
categorical axes at once — month × region, a correlation matrix, an assay plate.

### The colour is the part that goes wrong, so it is the part that was computed

The ramps are documented steps from a validated reference palette, run through that
palette's own validator rather than eyeballed. What it reported for the sequential
ramp, recorded verbatim in `chartPalette.ts`: lightness monotone PASS, adjacent ΔL
gaps PASS, single hue (4° spread) PASS, and a light-end contrast FAIL at 1.29:1.

That last one is expected here and the distinction matters. The palette's own note
says the full range "is for sequential encoding (continuous magnitude — heatmaps,
choropleths) where the lightest step means 'near zero' and is allowed to recede toward
the surface", while an ordinal ramp must clear 2:1. A heat map is the sequential case,
and the relief required for a sub-3:1 mark is secondary encoding — which is why the
number is printed in each cell and a colour bar always accompanies the grid.

Two rules do the real work:

- **Sequential is ONE HUE, light to dark.** A rainbow ramp is the classic heat-map
  error: it implies an ordering the eye cannot recover — is green more or less than
  yellow? — and manufactures boundaries the data does not have. Asserted by measuring
  hue spread across the ramp, not by looking at it.
- **Diverging is TWO HUES ABOUT A NEUTRAL GREY.** A hue at the midpoint reads as a
  third category rather than as "nothing". The arms are symmetric about the midpoint,
  which is what stops −1 and +100 being shown as equally extreme.

### What it refuses to do

A non-numeric cell is drawn blank and counted, **never treated as zero** — that would
move the colour scale and shade a cell for a value not in the table. A diverging scale
applied to one-sided data says a sequential one would use the whole ramp instead of
half. And greyscale admits it can only show how FAR a value is from a diverging
midpoint, not which side it is on, because lightness has one dimension.

PowerPoint export always ships a **picture**. There is no native heat-map chart type,
and `buildTablePptx` throws rather than substituting a bar chart under the same title —
a silent substitution would present different information, which is worse than an error.

### A bug my own test caught

`inkOn` decides whether a cell's number is printed in black or white. I picked its
threshold by eye at luminance 0.36, and it was wrong in the middle of the ramp: the
mid-blue `#5598e7` (L = 0.302) took white text at **2.98:1** where black would have
given 7.04:1. The threshold is now derived — white overtakes black at
√(1.05 × 0.05) − 0.05 = 0.1791 — so a new ramp needs no new decision. It only surfaced
because the test sweeps every step of every ramp rather than the ends.

6,674 tests across 219 files. All twelve QC gates pass.

## [2.47.0] — 2026-07-29 — An exponent extends to one atom, and spaces mean something

`2^2x` read as 2^(2x) in one parser and (2^2)x in the other. Two releases ago I filed
that as a cosmetic inconsistency and left it, on the grounds that changing how exponents
bind would re-read every expression already sitting in a document.

**Measuring it first — the habit that has caught something in nearly every round of this
work — showed it was a wrong number.** The same fault made `r^2 h` parse as r^(2·h),
which for r = 3, h = 2 evaluates to **81** where the answer is 18. That belonged in the A
tier, not among the cosmetics.

### Two causes

**Implicit multiplication was formed in the wrong place.** It lived inside the parser's
number branch, so a number followed by a letter became a product *anywhere* — including
inside an exponent, the one place it must not. It now lives in the product rule, and the
exponent parses a single atom.

**Whitespace was deleted before anything was read.** `replace(/\s+/g, "")` — so adjacent
names were glued into one: `pi r` became a variable called "pir", `y z` became "yz",
`sin x` became "sinx". The consequence is the one that matters: `pi r^2 h`, the shipped
formula for the volume of a cylinder, parsed as "pir" raised to the power (2·h), and
nothing in the result said so. Whitespace now separates factors.

### What had to survive

An exponent binding change is easy to get half-right, so the things that must not move
are asserted rather than assumed: `2^3^2` is still 512 (right-associative), `-x^2` is
still −(x²), `x^-1` still works, `x2` and `v_max` are still single variables, and
`2^(2*x)` still means what its brackets say.

Newly correct rather than newly refused: the shipped formulas now **evaluate** in Solve
and not merely typeset — cylinder, cone and sphere volumes, `I^2 R`, Pythagoras, the
slope of a line. Those were being computed wrongly before, or as an expression in a
variable nobody had typed.

One thing is newly refused, and deliberately: `sin x` used to become a variable called
"sinx", and with whitespace now meaningful it would have become sin × x — a product with
a variable named "sin", which is the kind of nonsense that yields a plausible answer.
It now says that sin is a function and needs brackets.

### On the mis-classification

The reason given for leaving this alone was caution about re-reading expressions already
in documents. That was the wrong instinct, and worth recording as such: the old reading
was not a rival convention someone might have relied on, it was arithmetic nobody wants.
The 300-expression behavioural baseline did not move by a single line.

6,649 tests across 218 files. All twelve QC gates pass.

## [2.46.0] — 2026-07-29 — Integrals with a hole in the integrand, and a correction to the last release

### The last defect that refused work it could do

`integral of sin(x)/x over [-1, 1]` is 1.8922 and was refused. The integrand is
undefined at x = 0 but its limit there is 1, and adaptive Simpson's very first act is to
evaluate the midpoint — which for that interval is exactly 0, where sin(0)/0 is NaN. One
undefined sample aborted the whole integral.

Closed with the method named as the fix direction two releases ago: **composite
Gauss–Legendre**. Its nodes lie strictly inside each panel, so no interval endpoint and
no panel boundary is ever evaluated, and a point where the integrand merely has a hole in
it is never visited at all. A second property matters as much and is less obvious — the
nodes stay well AWAY from the singular point, so an integrand that loses precision very
close to it is never asked about that region. The value is refined until two panel counts
agree to eleven significant figures, so it carries evidence rather than a promise.

Seven integrands verified against an independent high-resolution midpoint rule, agreeing
to 5e-7 or better, with every expected value derived rather than guessed: Si(1) for
sin(x)/x, and the series expansions for (1−cos x)/x² and (exp(x)−1)/x.

### A correction to v2.45.0

That release said an earlier attempt at this — averaging two neighbours across the
singularity — "produced wrong numbers", quoting **0.9728 against a true 0.9896** for the
integral of (1−cos x)/x² over [−1, 1].

**The 0.9896 was wrong.** It was a hand figure that was never checked. The series
(1−cos x)/x² = ½ − x²/24 + x⁴/720 − … gives 2(½ − 1/72 + 1/3600 − …) = **0.9727708**,
confirmed here against an independent midpoint rule. So the reverted fix had been
producing correct answers, and it was discarded for nothing.

Using an unverified figure as the oracle to judge a fix is the mistake, and this one cost
a working fix and a release. It is the same class as everything else this file has been
recording — an unchecked reference value is exactly as dangerous as an unchecked
computation, and rather more embarrassing.

Gauss–Legendre is still the better rule and is what ships: it never visits the singular
point rather than reconstructing a value there, its nodes avoid the cancellation-prone
region rather than relying on two corrupted neighbours agreeing, and it reports its own
convergence. But it was chosen on its merits, not because the alternative was broken.

### The trap the fix walked into

Gauss–Legendre never evaluates an endpoint. That is exactly why it can rescue a removable
singularity sitting at one — and exactly why `integral of 1/x over [0, 1]`, which
diverges, came back as a confident finite number.

The structural pole search only reports poles strictly INSIDE the interval, because an
endpoint pole used to be caught by Simpson evaluating that endpoint and returning NaN.
Endpoints now get their own `isGenuinePole` check: a removable singularity is allowed
through, a pole is not. Caught by an existing test rather than by foresight, which is the
argument for keeping tests that assert refusals as carefully as answers.

The new rule is confined to the previously-refused path, so every integral that already
had an answer keeps the same one, computed the same way — asserted, not assumed.

### What is left

Two entries in `docs/KNOWN-DEFECTS.md`, neither producing a wrong number: **B3**, a blank
Bode chart at zero reference that could not be reproduced, and **C2**, a huge exact
rational converting to Infinity, which is the correct IEEE result at the boundary. Also
recorded: the two expression parsers still read `2^2x` differently, left alone because
changing how exponents bind would re-read every expression already sitting in a document.

6,616 tests across 217 files. All twelve QC gates pass.

## [2.45.0] — 2026-07-29 — An identity hidden by cancellation, notation with two meanings, and hydrates

Three closed, one attempted and removed, and two left open with reasons. What remains
in `docs/KNOWN-DEFECTS.md` after this is three entries, none of which produces a wrong
number.

### The identity that cancellation hid — properly fixed this time

`cosh(x)^2 - sinh(x)^2 = 1` is an identity and returned **33 spurious roots**. The
cause is that a tolerance derived from the size of the ANSWER cannot see catastrophic
cancellation, because cancellation is exactly the case where the answer is tiny and the
intermediates are enormous: at x = 18 both squares are about 1.1e15, so the computed
difference carries roughly 0.25 of rounding dust — two hundred million times the true
answer's own last bit. Judged against 1 that looks like wild disagreement; judged
against 1.1e15 it is precisely what double arithmetic can deliver.

v2.40.1 tried to measure that dust empirically, by perturbing x and watching how far
the difference moved, and **reverted it**: the estimate is itself a random quantity,
and the version that finally passed the cosh case also reported `tan(x) = 2` and
`exp(x) = 2` as identities — every equation in the product made vacuous.

The real fix, and the one recorded then as the direction to take: `evalAstScaled` now
evaluates an expression and reports the largest magnitude it passed through on the way,
so the tolerance reflects the precision at which the expression can actually be
evaluated. It is deterministic and has no threshold tuned to a particular example — the
answer is simply "this cannot be evaluated to better than eps times *this*". Kept
separate from `evalAst` deliberately: that function runs inside adaptive quadrature and
root-scan loops, and paying for a tracker on every one of those to serve a check that
runs 123 times would be the wrong trade.

Ten identities now close, including `cosh(2x) = cosh^2 + sinh^2` and
`tanh(x) = sinh(x)/cosh(x)`, and twelve near-identities are asserted **not** to —
including the two that the reverted approach broke.

### `1/2x` meant two different things in one product

| typed | solve.ts | mathParse.ts |
|---|---|---|
| `1/2x` | `1/(2x)` | `(1/2)x` |
| `2/2x` | `1/x` | `x` |

The two readings of `2/2x` differ by a factor of x squared, which is not a rounding
difference — it is a different function.

Neither was chosen, because neither is settled: most computer algebra systems give
implicit multiplication the same precedence as explicit multiplication, a great deal of
handwritten mathematics and physics reads it the other way, and ISO 80000-1 recommends
never writing it. Picking one would have made the other silently wrong for whoever
meant it. So it is **refused by both parsers**, with both readings offered back so the
fix is one keystroke.

**The scope of that refusal was wrong twice, and both are worth recording.** Usage was
surveyed in `examples.ts` and the manual before deciding, and came back zero — but
`formulaLibrary.ts`, the actual shipped content a user inserts, was not surveyed. And
the first version also matched `^`, which is simply not ambiguous: an exponent extends
to the atom immediately after it, so `r^2 h` is unambiguously (r^2)h. That broke four
shipped formulas — volume of a cylinder and cone, power dissipated, two-asset portfolio
variance. The full suite caught it, and there is now a test that walks the entire
formula library.

What this did **not** settle: the two parsers also disagree about `2^2x`, and that one
is left alone. Unlike division it has a settled convention, so mathParse.ts is right
and solve.ts is the odd one out — but changing how exponents bind would re-read every
expression already sitting in a document, which is more than a notation guard should do
quietly. Recorded with the correct reading named.

### A hydrate dot is not punctuation

`parseFormula("CuSO4.5H2O")` stripped every non-alphanumeric character, merging the
parts and joining the multiplier to the element before it: "O4" and the following "5"
became "O45", and the answer was **O:46** instead of O:9.

It was unreachable when found — the only caller feeds it OpenChemLib's already-clean
formula — which is why it was worth fixing rather than leaving. An exported function
that is wrong only because nobody calls it that way is a trap set for the next caller,
and the count it returns feeds monoisotopic mass.

Fixing the dot alone would have swapped one silent mis-parse for another: brackets were
stripped too, so `Cr2(SO4)3` read as `Cr2SO43` and gave O:43. Both are handled now,
with nesting — `((CH3)2CH)2O` and `K3[Fe(C2O4)3]` hydrates included — and an unclosed
bracket yields nothing rather than a partial count.

### One attempted and removed, on purpose

C0: `sin(x)/x` over [-1, 1] is 1.8922 and is refused, because adaptive Simpson's first
midpoint is exactly 0 where sin(0)/0 is NaN. The obvious repair — average two
neighbours either side of any non-finite sample — was built and measured, and it
produced wrong numbers: **0.9728 against a true 0.9896** for the integral of
(1-cos x)/x^2 over [-1, 1].

The reason defeats the approach. Cancellation corrupts these integrands over a
*neighbourhood* of the point, not just at it: below x = 1e-8 the nearest double to
cos(x) is exactly 1, so (1-cos x)/x^2 evaluates to 0 rather than 0.5 — and **both
neighbours agree on that wrong value**, so no agreement test can tell it from a genuine
limit.

A multi-scale check does separate the two cases, and was still not shipped: it converts
a refusal into a number one case at a time, and getting it wrong puts a plausible 2%
error where there is currently an honest refusal. Refusing a correct answer is a
smaller harm than reporting an incorrect one. The real fix is a quadrature rule that
never samples the point it is told to avoid, which is a change of method rather than a
patch.

6,606 tests across 217 files. All twelve QC gates pass.

## [2.44.0] — 2026-07-29 — Circuits, trusses, parsers, and messages that were false

Nine more from `docs/KNOWN-DEFECTS.md`. Nothing here produced a wrong number — the A
tier was cleared in v2.43.0 — so this round is about work the tool refused that it
could do, freezes, and messages that said something untrue.

### Two seconds of frozen Word, per keystroke

The DC path solves exactly, over rationals, which has no rounding error and pays for
it with **coefficient growth**: numerators and denominators roughly double in bit
length at each elimination step. On a 120-node interconnected mesh — the parser's own
legal limit — that was **1362 ms** for the solve and **1102 ms** for a 120-point
sweep. About two and a half seconds, in a pane that recomputes as the user types.
That is not a slow answer; it is a Word that stops accepting typing.

Above 48 unknowns the solve now uses doubles, and **says so** — a result silently no
longer exact, in a module that advertises exactness, would be a false claim rather
than a slow one. The sweep's point count is budgeted on points × nodes³, since every
point is a full complex solve, and the thinning is disclosed with the count.

| | before | now |
|---|---|---|
| DC solve, 120-node mesh | 1362 ms | **38 ms** |
| 120-point sweep, same | 1102 ms | **183 ms** |

Small circuits — every netlist anyone types by hand — keep full exactness and all 120
sweep points, and both are asserted so the cap cannot creep down onto them. Refusing
the large circuit outright was considered and rejected: trading a slow correct answer
for no answer is a worse deal than an approximate one that admits it.

### `1e-6` was refused while `1u` was accepted

The same number, written the way a spreadsheet or a SPICE deck writes it, failed. So
did `2.2e3` and `1E-9`. The exponent is folded into the **exact rational** and not
just the float, because otherwise the notation would silently change the guarantee
the DC path makes.

### A message that named a fault it had already excluded

The singular-matrix fallback advised checking for "a shorted or duplicated source" —
but a duplicated source is caught by the parallel-pair test above it, so that advice
could never be the answer. It sent the reader looking for something the tool had
already ruled out.

What actually reaches that point is a **loop** of ideal sources: three sources round
a loop over-determine the node voltages without any two being in parallel, and an
inductor is a short at DC so a source shorted through one is the same fault. A
union-find pass over the zero-impedance subgraph now names it. What remains after
that names only what has **not** been ruled out.

### A negative resistance was accepted in silence

This module is documented as linear and **passive**, and a negative resistance,
inductance or capacitance was solved as though it were a component. The equations do
not object; only physics does, so the check had to be added. A negative resistance is
a legitimate small-signal model for an active device — the refusal says so, and says
that modelling one needs the active-device support this tool does not have.

### The truss threw away its own guarantee

Member tension/compression came from the **float** while the zero test used the exact
rational. The exact path exists precisely so the sign is decidable; taking it from
the rounded value discards that for any member whose force is near zero, and tension
versus compression is the difference between specifying a cable and specifying a
strut.

### The canonical correctness net was not running

`casint` advertises a canonical check: it differentiates every candidate
antiderivative back and demands `exprEqual` with the integrand. But d/dx ln|x|
simplifies to `x/abs(x)^2`, and `abs(x)` was an opaque atom that never reduced — so
`exprEqual` was **false for every `ln|·|` result**, and those were accepted on
numeric agreement at eight fixed sample points instead.

`abs(A)^n` now reduces to `A^n` for even n, which is exactly true with no branch to
choose, and to `A^(n-1)·abs(A)` for odd n. Nothing was wrong — 67 integrands swept on
a disjoint grid found no bad antiderivative — but the advertised check was not
protecting the largest class of results it exists for. It is now.

### Messages in the reader's notation

`abs x` produced "Expected lparen in math expression." The reader did not write an
lparen and has no reason to know what one is. Errors now name the character and say
what was found instead.

### A stray delimiter that drew something

`A ->> B` split on the `->` inside `->>`, leaving `> B` as a component — which was
handed to OpenChemLib as SMILES. It did not error; it drew something. Fixed by
stripping and reporting the leftover rather than by widening the arrow pattern,
because `[O-]` and `C[N+](C)(C)C` contain the same characters and a greedier pattern
would shatter them.

### `isSymmetric` was wrong in both directions

An absolute floor made the answer depend on the units the matrix was written in:

- `[[1e-20, 1e-20], [2e-20, 1e-20]]` — off-diagonals differing by **100%** — was
  reported symmetric, because every entry fell below the floor. This one matters:
  `eigenSymmetric` is gated on it, and the Jacobi method it uses is only valid for a
  symmetric matrix.
- `[[1e20, 1], [1.0000001, 1e20]]` was reported **not** symmetric, for a difference
  of 1e-7 against a norm of 1e20.

Now relative to the matrix's largest magnitude, so scaling a matrix cannot change
whether it is symmetric — asserted across five scale factors spanning forty orders of
magnitude.

### One I could not reproduce, left open

B3 claimed a blank Bode chart when the reference is zero. A high-pass whose output is
genuinely zero at DC, swept from 1 µHz to 1 MHz, returned all twenty points finite
with a dB range of −150 to +14. It stays in `KNOWN-DEFECTS.md` rather than being
marked fixed, because "I could not reproduce it" is not "it does not happen".

6,557 tests across 216 files. All twelve QC gates pass.

## [2.43.0] — 2026-07-29 — The A tier is empty: limits, a dozen restored integrals, and a 20-second freeze

Four more from `docs/KNOWN-DEFECTS.md`, and with them **every defect that produced a
wrong number presented as correct is now closed** — A1 through A12, each with its
reproduction moved into a named test rather than merely patched.

### A8 was already fixed, and that is worth recording

`limit x^2 as x -> 0.0001` printed `= 0` for an answer of 1e-8, and one case printed
a headline contradicting the step line directly beneath it. Reproducing it first —
the habit this round of work has settled into — showed all three reported cases now
return correct values. The symptom was the **six-decimal-place rounding in `fmtNum`**
removed in v2.43.0's predecessor v2.40.0, not a fault in the limit engine at all.
Fixing the display fixed the arithmetic that was being displayed. The three cases are
pinned so it stays fixed.

### A constant factor cannot create or destroy a limit

The convergence test was `spread <= 1e-4 * (1 + |last|)`. That `1 +` is an absolute
floor bolted onto a relative tolerance, and the floor did the damage: **any** tail
whose values were below about 1e-4 passed it however wildly it swung. So:

| typed | before | now |
|---|---|---|
| `limit sin(1/x) as x -> 0` | undetermined | undetermined |
| `limit 1e-3*sin(1/x) as x -> 0` | undetermined | undetermined |
| `limit 1e-5*sin(1/x) as x -> 0` | **−6.11e-6** | undetermined |
| `limit 1e-9*sin(1/x) as x -> 0` | **−6.11e-10** | undetermined |

Multiplying by a positive constant changed whether a limit existed. The spread is now
judged against the tail's own magnitude, which is invariant under scaling, and the
envelope trend separates the one case that genuinely converges — `x*sin(1/x)`, whose
oscillation decays — from one with a steady envelope, which has no limit. Asserted
across eight scale factors from 1 down to 1e-30, in both directions.

**The fix broke a correct answer before it was right**, which is worth setting down.
`(1-cos(x))/x^2` tends to ½, but below x ≈ 1e-8 the nearest double to cos(x) is
exactly 1, so `1-cos(x)` evaluates to 0 and the sampled tail reads [0.5, 0.5, 0, 0].
That is indistinguishable from a decaying envelope, and the limit came back as 0. The
tail never changes SIGN, though — so requiring a genuine sign change before treating a
tail as an oscillation separates cancellation damage from oscillation. Caught by
putting `(1-cos(x))/x^2` in the "must be untouched" list rather than only testing the
cases that were broken.

### A dozen textbook integrals were being refused

Partial-fraction integration divided its result by the denominator's leading
coefficient — which the basis polynomials already carry, since the factors are built
monic and the coefficient-matching system absorbs it into the solved numerators. The
answer came out wrong by that factor, the self-verification gate correctly rejected
it, and the integrator returned null. Silently refused before this:

`1/(2x+3)`, `1/(4x²−1)`, `1/(3x²+5x+2)`, `x/(2x+1)`, `1/(9x²+1)`, `1/(6x²−5x+1)`,
`5/(2x²+3x+1)`, `1/(3−2x)`, `1/(4x²+4x+2)`, `(x²+1)/(2x+1)`.

Every monic sibling worked — which is every test that existed, and why nothing caught
it.

**It was broader than reported.** The behavioural baseline flagged `1/(x-0.5)`
changing too, which is monic as typed: a decimal coefficient becomes non-monic under
exact-rational rescaling, so *every* decimal denominator was affected as well.
`1/(x-0.5)` over [2, 3] is now exact and reads 0.5108256238, which is ln(2.5/1.5).

And the values are confirmed by something better than a hand check: the baseline shows
each of these moving from "adaptive Simpson" to "exact (symbolic)" with the value
**identical to ten significant figures**. The numeric path had been quietly covering
for the exact one, and the two now agree.

### Twenty seconds of frozen Word, per keystroke

The rational-root search capped how far trial division looked for divisors. It did not
cap the **cross product** of those divisors, which is what actually gets evaluated.
For a constant term of 963761198400 — 6720 divisors, 905 within the search bound —
that product reached 1,638,050 exact BigInt-rational evaluations, once per degree:

| | before | now |
|---|---|---|
| `ratPolyRoots([H, H+1, H])` | 1710 ms | **34 ms** |
| `integrate(1/(H·x²+(H+1)x+H), 0, 1)` | 2408 ms | 22 ms |
| `integrate(1/(H·x⁸+(H+1)x+H), 0, 1)` | **20639 ms** | **286 ms** |

This is the catalogued lesson once more: a clamp that bounds the search does not bound
the time. The candidate set itself is capped now, and a truncated search reports
`incomplete` rather than returning nothing — because "no rational roots found" and
"no rational roots exist" are different statements, and conflating them puts a
falsehood where a result should be. Ordinary polynomials are unaffected and marked
complete.

### One arithmetic slip, in the test rather than the code

The expected value for `∫₂³ dx/(x²−1)` was written as ½ln((1/2)/(2/4)), which is
½ln(1) = 0. The correct figure is ½[ln(2/4) − ln(1/3)] = 0.2027325541. Recorded
because a test with a wrong expectation is worse than no test: it would have failed
against correct code and invited someone to "fix" the code to match.

6,517 tests across 215 files. All twelve QC gates pass.

## [2.42.0] — 2026-07-29 — Pharmacokinetics: the missing area, flip-flop, and absorption

Batch 3 from `docs/KNOWN-DEFECTS.md`. Three defects, each quantified before being
touched and each checked against a closed form or an independent simulation.

### The AUC started at the first sample, not at dosing

The trapezoidal loop ran from the earliest supplied time to the last, so if dosing
was at t = 0 and the first sample was later, **that interval was simply missing** —
and every parameter derived from AUC carried the error, with no note of any kind.
Measured on a one-compartment IV bolus with a true clearance of 1.0 L/h:

| first sample | reported CL | error |
|---|---|---|
| 0.25 h | 0.990 | −1% |
| 1 h | 1.140 | +14% |
| 2 h | 1.373 | +37% |
| 4 h | **1.982** | **+98%** |

The two routes need **different conventions**, and getting that wrong is its own
error: naively adding a straight trapezoid from the origin to the first IV sample
overestimates the area under an exponential decline, which took the same data from
4% low to 6% high. So an IV bolus back-extrapolates C0 log-linearly through the
first two points and integrates the fitted exponential exactly, while an oral dose
uses C(0) = 0 — which is not an approximation but the definition, since the drug has
not been absorbed yet.

Verified two ways. The error is now **independent of when sampling started** — a
spread of under 5% across first samples from 0.25 h to 4 h, where it used to vary by
a factor of two. And it **converges to 0.00%** as sampling densifies (2.37% at
4-hour spacing, 0.00% at 0.1-hour), which proves the remainder is trapezoidal
discretisation rather than anything the back-extrapolation introduced. Whichever
convention was used is stated, because a reader comparing this AUC against other
software needs to know which produced it. If the first two points do not decline,
no C0 is invented — the gap is disclosed instead.

### An oral terminal slope may be absorption, not elimination

When absorption is slower than elimination the tail of the curve decays at the
**absorption** rate: the drug leaves as fast as it arrives. The terminal slope then
estimates ka, and the half-life is reported with the elimination label on it.

The two cases are **numerically identical**. Simulated with dose 500 and V = 10:

| | reported t½ | true elimination t½ |
|---|---|---|
| ka = 1.0, ke = 0.1 | 6.93 | 6.93 |
| ka = 0.1, ke = 1.0 | **6.93** | **0.693** |

Same number, ten-fold different truth. No fit to oral data can separate them,
because the one-compartment oral model is symmetric in ka and ke — which is exactly
why the standard resolution is an intravenous reference profile. Every oral result
now says so, and says to read the figure as the **slower** of the two rate constants
without one. IV results carry no such warning, because there is no absorption phase
to confuse.

### The steady-state peak assumed the dose appeared instantly

`F·Dose/Vd` is the concentration reached when the whole bioavailable dose arrives
**instantaneously** — an IV bolus. An oral dose is absorbed at a finite rate, so the
peak is lower and later and that figure is never actually reached. The parameters
carried an absorption rate constant and it was silently ignored:

| ka (ke = 0.2) | true peak | instantaneous figure | overstated by |
|---|---|---|---|
| 0.3 | 27.97 | 54.99 | **+97%** |
| 0.6 | 33.28 | 54.99 | +65% |
| 1.0 | 37.66 | 54.99 | +46% |
| 3.0 | 45.63 | 54.99 | +21% |

With an absorption rate supplied the standard multiple-dose oral solution is used at
its own tmax, verified to better than one part in a million against a superposition
simulation at five (ka, ke) pairs, with tmax agreeing to four significant figures.
Without one the bolus formula is kept — it is correct for an IV bolus and a
defensible upper bound otherwise — but it now **says** that rather than leaving the
assumption unstated. The average concentration is unchanged either way and asserted
to be, since Cavg depends only on dose rate and clearance.

`ka` equal to `CL/Vd` falls back with an explanation, because the standard solution
divides by their difference.

### The fix had to be reachable

The steady-state calculator offered bioavailability but had **no field for an
absorption rate**, so the corrected path could not be called from the product at
all. A green engine test proves nothing about whether the pane can reach the engine
— a lesson this repo has already paid for. There is now an optional `ka` field, the
peak reports when it occurs, and blank still means IV bolus. Left blank it passes
`undefined` rather than 0, because a supplied rate of zero means something else.

One more thing the figure would have got wrong: the plotted trace is a superposition
of instantaneous doses, so with an absorption rate supplied its peaks are the bolus
peaks and would silently contradict the numbers above it. That is now stated on the
page.

6,496 tests across 214 files. All twelve QC gates pass.

## [2.41.1] — 2026-07-29 — An approximate settling time printed beside the word "exact"

A follow-up on v2.41.0, from asking what the freshly-changed code claims about
itself rather than only whether its numbers moved.

`secondOrderMetrics` returns `exact: true` for any genuine second-order
denominator, and that flag means the damping ratio and natural frequency are exact
identities. It does **not** mean the settling time is — and for an underdamped
system the settling time is `4/(zeta*wn)`, the standard envelope estimate, which is
2 to 4% away from the true 2% crossing by construction. At ζ = 0.7 it gives 5.71 s
against a true 5.98 s. This release's own test asserts that gap, so the product was
printing a figure it knew to be approximate next to the word "exact".

The underdamped branch keeps the textbook formula — students expect that number,
and silently substituting a different one would be its own kind of wrong — but it
now says what kind of number it is, and that the critically damped and overdamped
cases are solved for directly instead. The overdamped branch is asserted **not** to
carry that caveat, so the two cases stay distinguishable.

Also checked, and a risk that turned out not to exist: whether a higher-order plant
could reach the new overdamped solver with a damping ratio derived from a dominant
pole pair rather than read off a real second-order denominator. It cannot — the
dominant-pole path requires a stable **complex** pair, which means ζ < 1 by
definition, and an overdamped higher-order plant is refused outright rather than
having a damping ratio invented for it. Pinned in a test so it stays that way.

6,472 tests across 213 files. All twelve QC gates pass.

## [2.41.0] — 2026-07-29 — Control: a settling time that ran backwards, and a verdict withheld

Batch 2 from `docs/KNOWN-DEFECTS.md`. Four defects, each independently reproduced
before it was touched and each checked against something outside this code — a
simulated step response, a brute-force frequency sweep, or an exactly known
factorisation.

### Settling time ran the wrong way

`4/(zeta*wn)` is the decaying envelope of an **underdamped** response. It was being
applied at every damping ratio, so as damping rose the reported settling time
*fell* — which is backwards. Measured, with ωₙ = 1:

| ζ | reported | true |
|---|---|---|
| 1 | 4 | 5.83 |
| 2 | 2 | 14.9 |
| 5 | 0.8 | 38.8 |
| 20 | **0.2** | **156** |

780 times optimistic at ζ = 20, and flagged `exact`. Anyone sizing a controller
from that figure was told the loop settles instantly when it crawls.

For ζ ≥ 1 the poles are real and the response is a sum of two exponentials
dominated by the **slower** one — the pole nearer the origin, which is exactly the
one the envelope formula ignores. The 2% crossing is now solved for directly rather
than approximated, because the second exponential matters near ζ = 1 and the
critically damped case has a t·e^(−t) term that no single-pole rule of thumb
captures. Verified against a simulated step response at nine (ζ, ωₙ) pairs, agreeing
to better than one part in a thousand.

The underdamped branch is deliberately **unchanged**: `4/(zeta*wn)` is the textbook
2% estimate, students expect that number, and it is 2–4% off the true crossing by
construction. Replacing it silently with a different figure would have been its own
kind of wrong.

### The margin reported is now the worst crossing, not the first

A loop whose magnitude is not monotonic crosses 0 dB more than once and has a phase
margin at each. The stability margin is the **smallest** — that is what the word
means. Reporting the first gave `100(s²+0.02s+1)/(s+1)⁴` a phase margin of 32.5°
when its three crossings are at 33.0°, 148.8° and **23.1°**. A number that says
"comfortable" about a loop that is not is worse than no number.

Every crossing is now collected and the minimum reported, with the same treatment
for gain margin at multiple phase crossovers. The full list is disclosed in a note
and exposed on the result, because three crossings at 33, 149 and 23 degrees is a
different engineering situation from a single crossing at 23 even though the margin
is identical.

### The sweep no longer assumes where the crossover is

The frequency range came from pole and zero magnitudes — and **those do not move
when the gain changes.** For `1e12/(s+1)³` every pole sits at 1, so the sweep stopped
at ω = 100 while the true 0 dB crossing is at ω = 10005. The result was "the
magnitude never crosses 0 dB over the swept range, so there is no phase margin",
reported for a loop that has one. A bounded sweep had silently become a wrong
answer — exactly what that function's own docstring warns about for the gain margin.

The range is now extended until |L| actually brackets 1, bounded to twelve decades
either way, and asserted across seven loop gains from 1e3 to 1e15. A loop that
genuinely has no crossover still says so: extending the sweep must not manufacture
a margin, and `0.01/(s+1)` is checked for that.

### A verdict withheld rather than guessed

`(s²+1)³` is three double poles at ±i — marginally stable — and came back
**"UNSTABLE — 2 poles in the right half plane."** The cause is not a tolerance:
Durand–Kerner resolves a root of multiplicity m only to about the m-th root of
machine precision, so a triple root lands ~1e-5 from where it belongs and carries
that error into its real part. No threshold fixes that; moving it only changes which
repeated-root system is misjudged. Routh–Hurwitz would settle it exactly, but a
polynomial with roots on the imaginary axis produces a zero row, which is precisely
the case it cannot complete.

So repeated roots are now detected **exactly**, via gcd(p, p′) over the rationals —
a theorem, not a heuristic, and free here because the coefficients are already exact
rationals. Detecting them numerically would have been circular.

The refusal is deliberately narrow. Three conditions must all hold: a repeated root,
Routh unable to answer, **and** a pole near the axis where the multiplicity error
could change the verdict. `(s+1)²` and `(s+1)³` stay STABLE, `(s−1)²` and `(s²−1)²`
stay UNSTABLE — double poles at ±1 are placed to about 1e-8, so those answers are
sound — and `s²`, a double pole exactly at the origin, stays MARGINALLY STABLE
because the factorisation makes it exactly known. Only the genuinely ambiguous case
returns UNDETERMINED, and **the refusal itself is asserted in a test** so a future
change to the root finder cannot quietly resume emitting a verdict.

### One thing worth recording about the fix

The first version of the repeated-root helper was written for **ascending**
coefficients while this module is highest-power-first. That is right for a palindrome
like `(s²+1)ⁿ` — the very case it was built for, so it passed — and wrong for `s²`,
which it reported as having no repeated root. Caught by adding `s²`,
`(s+1)²(s+2)` and `(s+1)(s+2)(s+3)` to the check. A helper that is correct only on
the example it was built from is a pattern this project keeps finding.

6,470 tests across 213 files. All twelve QC gates pass.

## [2.40.1] — 2026-07-29 — The identity fix only caught the examples it was given

A patch on v2.40.0, from reviewing the fix rather than the feature — and the
finding is the failure mode this repo already has a name for: **the fix was spelled
to the report's examples.**

The identity check tested `f === 0` **exactly**. That works for `x/x = 1`,
`(x-1)/(x-1) = 1` and `sin(x)/sin(x) = 1` — the three cases in the report — because
those cancel exactly in binary. The identities a person actually types do not:

| typed | before | now |
|---|---|---|
| `sin(x)^2 + cos(x)^2 = 1` | **3620 roots** | identity |
| `exp(ln(x)) = x` | **852 roots** | identity |
| `ln(exp(x)) = x` | 852 roots | identity |
| `sin(2*x) = 2*sin(x)*cos(x)` | thousands | identity |
| `(x+1)^2 = x^2+2*x+1` | thousands | identity |

`sin²x + cos²x − 1` evaluates to ±1.1e-16 at most doubles, not to zero. So the
question has to be asked **relative to the size of the two sides**, comparing them
separately rather than testing their difference against zero — exact equality is
merely the special case where the cancellation happens to be lucky. Probing is done
on nested ranges as well, because `cosh(x)^2` overflows past x ≈ 355 and a single
wide sweep left too few computable samples to judge on.

Eight identities are now asserted to close, and — the half that matters as much —
nine near-identities are asserted **not** to. `sin(x)^2 + cos(x)^2 = 1.0000001` has
no solution and must not be called vacuous.

### Fabricated roots are withheld, not warned about

`exp(x) = 0` has no solution, but exp underflows to zero below x ≈ −745, so the scan
returned **510 "roots"** from the underflow region. v2.40.0 attached a warning and
returned them anyway. That was the wrong call by this project's own precedent:
v2.39.0 had already upgraded `sqrt(x)^2` over [−1, 1] from a caveated number to a
refusal, on the grounds that a caveated number is still a number in the document.
510 of them is the same mistake at scale. Nothing is returned now, with an
explanation of what underflow is and why those values are artefacts.

### One attempted fix reverted on purpose

`cosh(x)^2 - sinh(x)^2 = 1` is an identity and still returns 33 spurious roots,
because the cancellation happens *inside* the expression: at x = 18 both squares are
about 1.1e15, so the computed difference carries roughly 0.25 of rounding dust while
the true answer is 1. Zero sits inside the dust.

Measuring that dust by perturbing x and watching the difference move does work in
principle. The version of it that finally passed the cosh case also reported
`tan(x) = 2` and `exp(x) = 2` as **identities** — which would have made every
equation in the product vacuous. The behavioural baseline caught it within a minute,
and it was reverted rather than tuned.

**A predicate that cannot be validated is worse than a limit that can be stated.**
So it is written down as B15 in `docs/KNOWN-DEFECTS.md`, with the real fix direction:
have `evalAst` report the largest magnitude it passed through, and scale the
tolerance by that rather than by the result. That would also fix the same blind spot
in the singularity and root-residual tests.

### Also

`docs/TEST-SCRIPT.md` gains **§0e** for v2.40.0 and this release — the manual pass is
the one gate that cannot be automated here, and the bump script only rewrites the
title version, so the section had to be written. Every item names what the old
behaviour was, so a refusal gets checked as carefully as an answer.

The v2.40.0 changelog claimed 6,421 tests; the real figure was 6,425. Corrected —
a false number in the release notes is the same defect class as a false number in
the product.

6,425 tests across 212 files. All twelve QC gates pass.

## [2.40.0] — 2026-07-29 — Poles reported as roots, two tolerance bands, and an instrument to prove nothing else moved

The first batch from `docs/KNOWN-DEFECTS.md`, taken in the order that puts the
wrong numbers a student would write into a report at the front. Five defects
closed, each with its reproduction moved into a named test rather than merely
patched.

### An instrument first, because "no regressions" has to be checkable

Before changing any behaviour: a **committed behavioural baseline** over 300-odd
inputs spanning every branch of solve, integrate and differentiate
(`solveBaseline.test.ts`). It is not an oracle and does not claim any answer is
correct — the oracle tests do that. It claims the thing that was previously
unclaimable: **nothing changed that was not meant to change.**

This was not precautionary. v2.39.0 had already proved the hazard — tightening the
singularity scan silently began refusing five correct integrals, and 6,362 tests
noticed nothing, because no test asked "does this still answer what it used to
answer?" The baseline caught this round's regression within a minute of it being
written, and every intended change had to be justified line by line against it.

### A pole is not a root

`numericRealRoots` accepted any bracketed sign change, and its bisection exited on
interval width **or** on `|f| < 1e-13` — never requiring the residual to be small.
Across a pole the function also changes sign, from −∞ to +∞, so the interval duly
narrowed onto the pole and the pole was reported as a solution:

- `solveEquation("1/(x-2.25) = 0")` → root **2.25**, where the left-hand side
  evaluates to −1.1e12
- `solveEquation("x/(x-2.25) = 1")` → the same, residual −2.5e12
- `solveEquation("tan(x) = 2")` → **1176 "roots"**, alternating genuine solutions
  and asymptotes

`1/(x-2) = 0` returned nothing only by accident: the scan grid lands exactly on 2,
so the sign test is skipped. Move the pole off the grid and it reappeared — the
signature of a sampling artefact, not a fix.

A candidate now has to survive substitution, judged against the size of the
function nearby rather than an absolute constant — because a legitimately steep
crossing can have a residual that is not tiny, and demanding `|f| < 1e-13` outright
would have discarded real answers. `tan(x) = 2` now returns **588** roots, exactly
half of 1176: every asymptote gone, every real solution kept. That count is asserted
directly, because a guard that fixes false positives by throwing away true positives
is not a fix.

### Two tolerance bands where roots went missing

Both were absolute thresholds on quantities whose size is set by the coefficients,
so each created a **band** — inputs on either side worked, which is precisely why no
test found them.

- `0.0000000001*x^2 - 0.0001 = 0` returned the single root **1000**, labelled
  `exact (quadratic)`, for an equation with roots ±1000. The discriminant was
  4e-14 against a threshold of 1e-12. Half the answer, presented as certain.
- `0.0000000000001*x^2 - 1 = 0` returned **"no solution"** with the caveat "No
  value of the variable satisfies this equation." The roots are ±3162277.66.

The discriminant test is now relative to the coefficients it is built from, which
keeps it invariant under multiplying the equation through by a constant — an
operation that cannot change its roots.

### The regression this round introduced, and what it actually taught

Making the degree test relative looked like the same obvious fix and was wrong in a
new direction. Scaling by the **largest** coefficient meant `x - 1e300 = 0` compared
its x coefficient of 1 against 1e285, deleted it, and returned "no solution" for an
equation whose root is 1e300. A large constant term does not make the x term
negligible.

The conclusion is stronger than "use a relative tolerance": **"is this coefficient
zero" is not a question about magnitude at all.** Only an exact zero is zero, and
every threshold — absolute or relative — deletes a real root somewhere. `trimPoly`
now removes only exact zeros, which still collapses `x^2 + x = x^2 + 1` to a linear
equation, because subtracting two equal doubles gives exactly zero. Rounding dust
that survives cancellation is caveated instead of deleted, and that caveat was
itself narrowed after it fired on `x - 1e15 = 0` — a warning that appears on
ordinary input is a false message that teaches people to ignore the real ones.

### An identity is an identity

`(x-1)/(x-1) = 1` was reported as `numeric (transcendental)` with **4000 roots** —
"1000, 999.5, 999, …" — taking about 2.9 seconds. Same for `x/x = 1` and
`sin(x)/sin(x) = 1`. With the numerator normalising to zero, every grid point passed
`|f| < 1e-10` and the dedupe never fired against 0.5 spacing. The transcendental
branch now asks the question the polynomial branch already asked, and answers
"identity" in under a millisecond. It probes at irrational offsets, so a function
that merely has zeros *on* the grid — `sin(x) = 0`, `x^2 = 0` — is not mistaken for
one that is zero everywhere.

Related, and honest rather than fixed: `exp(x) = 0` has no solution, but exp
underflows to zero below about x = −745, so the scan still returns candidates out in
the underflow region. They now carry a warning that hundreds of roots arriving at
the scan's own grid spacing means "no reliable root found" rather than hundreds of
answers.

### Numbers were being rounded to six decimal places

`fmtNum` rounded to 6 dp, which silently destroys anything smaller than 1e-6:

- `x^2 - 1e-20 = 0` has roots ±1e-10 and printed **"[0, 0]"** — two identical roots
  for an equation with two distinct ones.
- `integrate("1/(x^2+x+1)", 0, 1).antiderivative` printed
  `1.154701*atan(1.154701*x + 0.57735)` where the coefficient is
  2/√3 = 1.1547005383792515. The `value` was exact; the closed form shown was not,
  and did not re-parse. Copying that expression out of the document — the whole
  point of showing it — gave a different function from the one integrated.

Now 12 significant figures. The printed antiderivative is tested by **round trip**:
re-parsed, evaluated at both limits, and required to reproduce the reported value.
A string comparison would have passed on any consistent rounding. Restored precision
was checked against external constants — √2 = 1.41421356237, *e* = 2.71828182846,
1/ln10 = 0.434294481903, the Omega constant 0.56714329041, the Dottie number
0.739085133216.

### Two tests that could not fail

Both beam-height tests parsed the declared height out of the very SVG they had just
generated, so a wrong height was compared against itself. They now assert against
`BEAM_CHART_SIZE` — the number the pane uses to reserve space in the document, and
until now referenced by **zero** test files, which is what the 336→346 squashed
figure was. A negative control confirms the new assertions catch a ±10, ±50, +200
and +1000 perturbation; before, all four passed.

6,425 tests across 212 files. All twelve QC gates pass.

## [2.39.1] — 2026-07-29 — The pole detector was refusing five correct integrals

A patch on v2.39.0, found by reviewing the fix rather than the feature — which is
the habit this project now keeps, because five rounds running have turned up
defects in the previous round's repairs.

**A zero of a denominator is not necessarily a pole.** The new structural detector
reported every real root of a denominator inside the interval without asking
whether the numerator vanished there too. `integrate("(x^2-1)/(x-1)", 0, 2)` is
**4** — the integrand *is* x + 1 and the singularity at x = 1 is removable — and it
came back refused. So did `x/x`, `(x-2)/(x-2)` and `(x^2-4)/(x-2)`. Trading a wrong
number for a refused correct one is a smaller harm than the −2 it replaced, not an
acceptable one.

The discriminator is cheap precisely because the structural search has already
established *where* to look, which is what a blind grid scan never knew: evaluate
the integrand either side of the candidate point. At a genuine pole of order n ≥ 1,
|f| grows like h⁻ⁿ, so shrinking h by 1e6 multiplies |f| by at least 1e6; at a
removable singularity |f| converges to its limit and the ratio is about 1. The
threshold is 1e3 — three orders of magnitude of daylight between the two cases,
which makes it a predicate with margin rather than a tolerance standing in for one.

Two further cases came from the *sampling* backstop applying different rules from
the structural search, so both now share one predicate:

- **An endpoint the integrand misses is not a reason to refuse.** `x/x` over [0, 2]
  is 2. The integrand is undefined at x = 0, which is the endpoint, and the
  structural branch already required strict interiority while the sampled branch
  did not.
- `(x^2-4)/(x-2)` over [0, 3] was refused because 129 evenly spaced samples land
  *exactly* on x = 2, where 0/0 is NaN. The integral is 10.5. The same grid
  alignment that hid a real pole in v2.39.0 manufactured a fake one here.

Every genuine case is still refused, and that is asserted directly rather than
assumed: `1/(x-1)`, `1/((x-1)^2)`, `tan(x)`, `1/(x-0.5)`, `1/(x^2-4)`, `sqrt(x)^2`
over [−1, 1] and `ln(x)` over [−1, 2].

### A guard for the examples we publish

`engineeringDocs.test.ts` checks that every `<code>` fragment in the help panel
round-trips through its real parser — and it structurally cannot catch this class,
because a now-refused integral parses perfectly. A guard that tightens a refusal
can therefore falsify a published worked example, and the landing page goes live
the moment it is pushed. The four integrals in `examples.ts` and `landing/*.html`
are now asserted to still produce their published values, along with the sentence
in the manual promising that `ln(x)` from −1 to 2 "has no integral, and it says so
rather than returning a number."

### Filed rather than fixed

`integrate("sin(x)/x", -1, 1)` should be ≈ 1.8921 and is refused. The detector
correctly identifies x = 0 as removable, but sinc has no antiderivative rule, so it
falls to adaptive Simpson whose first midpoint is exactly 0. Checked against both
v2.39.0 and the version before the detector was rebuilt — **both refuse it**, so
this is a pre-existing limitation rather than a regression, and it is an honest
refusal rather than a wrong number. Recorded as C0 in `docs/KNOWN-DEFECTS.md` with
the fix direction: the removability is already computed, it just is not handed to
the numeric path.

### Release plumbing

`package.ps1` now copies the built zips into `install/` as part of the same step
that builds them. Building to `release/` and copying by hand meant the published
download could sit a release behind while every automated version check passed,
because those checks read `install/`. Verified that the macOS `.command` files keep
mode 0755 through the copy — without the executable bit they cannot run at all, by
any route.

6,375 tests across 210 files, all green.

## [2.39.0] — 2026-07-29 — A negative area under a positive curve, and a figure of pure NaN

Four independent reviews reported at once — truss/circuit, control/pharmacokinetics,
CAS/chemistry, and a cross-cutting sweep for defect classes rather than modules.
Between them they found more than could responsibly be fixed in one release, so this
one takes the items that are **wrong numbers or crashes**, verifies each
reproduction before touching anything, and writes the rest down instead of
pretending it isn't there. The remainder is now in **`docs/KNOWN-DEFECTS.md`** with
the exact inputs, ranked by severity, and a fix direction for each — including
eleven that produce a wrong number today.

### A divergent integral no longer returns a number

`integrate("1/((x-1)^2)", 0, 2)` returned **−2**, method `"exact (symbolic)"`,
caveats **`[]`**. The integrand is strictly positive at every point of that
interval and the integral diverges to +∞, so this was not an imprecise answer — its
**sign was impossible**, and nothing in six rounds of review noticed.

The singularity scan had two independent blind spots, and both had to be understood
before it could be fixed:

- **Grid alignment.** It sampled `a + (b−a)·i/129`, so the pole at x = 1 in [0, 2]
  needs i = 64.5 and was never visited. The control that proves it: the *same pole*
  over [0, 2.58] lands on i = 50 and was caught. A pole that is visible over one
  interval and invisible over another is not a tolerance problem, and no threshold
  fixes it.
- **Structural invisibility.** `tan` has a pole at π/2, but `tan` is *finite at
  every representable double near π/2* — `Number.isFinite` is true at all 130
  samples no matter how the grid is spaced. `integrate("tan(x)", 0, 3)` returned
  0.01005… as exact. More sampling could never have found this one.

Poles are now located from the **structure** of the expression: real roots of a
polynomial denominator, verified by residual, plus the known pole sets of
tan/cot/sec/csc. Sampling is kept only as a backstop for domain errors — a square
root or logarithm of the wrong sign, which really are non-finite — and that backstop
now runs on two grids offset by an irrational fraction of a step, so nothing can
hide in the gaps of both.

Fixing only the symbolic path left the same wrong number reachable by another road:
`integrate("1/(x-0.5)", 0, 3)` finds no antiderivative rule, falls through to
adaptive Simpson, and Simpson stepped straight over the pole without sampling it —
returning a confident **5.0355** for a divergent integral. Its stock caveat about
singularities appears on *every* numeric integral, so it said nothing about that
one. Both paths now share the guard.

There is also an exact backstop, on the principle that the two lines of defence
should not share a failure mode: **an integrand that never changes sign cannot
integrate to the opposite sign.** That is a theorem with no tolerance in it, and it
catches precisely the failure that reaches a document.

Verified in both directions. All six divergent cases refuse; all fourteen
legitimate ones still return their exact values, including `1/((x−1)²)` over [2, 3]
= 0.5, where the pole is real but outside the interval — and `sin(x)` over [0, 4π],
where the sign test must *not* fire because the integral is genuinely zero. Cost is
under 5 ms per call.

### A pharmacokinetics figure made entirely of NaN

The PK report passed `yScale: "log"` to the plot renderer without calling
`dropForScales`, which `plot.ts` documents as mandatory for any caller using a
logarithmic axis. Plot mode calls it; this one did not.

In pharmacokinetics a zero concentration is not bad data — **the pre-dose sample is
zero by definition**, and a trailing below-limit-of-quantification sample is
reported as zero too. So `log(0) = −Infinity` became `Infinity/Infinity` became
`NaN`, and all nine points were emitted as `cy="NaN"`. The figure went into the
document with a blank body, no y-axis tick labels, and a perfectly plausible x
axis — beneath a numerically correct NCA report.

The report now drops unplottable points from the figure only, **says on the page how
many and why**, states that every number above uses the full data set, and emits no
figure at all rather than an empty one if nothing is left to draw.

Why this survived six rounds: the repo's two non-finite walkers recurse into
numbers, arrays and objects, and neither looks inside a **string** — so neither can
see an SVG. Nothing here had ever grepped generated markup. There is now a harness
that does, and it proves itself against the pre-fix figure before it is trusted to
report anything clean.

### A stable plant reported as marginally stable

`analyzeStability` set one tolerance from the largest pole magnitude — `1e-9 × max
|pole|` — so a fast pole set the yardstick for a slow one. For
`1/((s+1)(s+2)(s+1e10))` the two ordinary poles at −1 and −2 were measured against
a tolerance of **10**, and a plainly stable plant came back *"MARGINALLY STABLE — 2
poles on the imaginary axis"*, printed directly above a pole list where every pole
was tagged "(stable)". `timeResponse` then refuses to quote a final value.

The cross-check could not catch it: it compares only right-half-plane counts, and
both methods said zero, so they "agreed" while the verdict was wrong. This is the
same shape as the eigenvalue threshold fixed in `vibration.ts` last release — **a
tolerance relative to the largest element cannot answer a question about an
individual one.** Each pole and zero is now measured against its own magnitude,
with an absolute floor for a pole genuinely at the origin.

### A 130,000-row paste crashed the renderer

`Math.min(...xs)` passes every element as a separate function argument, and V8
throws past roughly 125,000 of them. Every textarea that takes a column of numbers
here is uncapped, and a 130,000-row spreadsheet column is an ordinary paste.

The failure is a **cliff, not a curve** — 100,000 values worked perfectly — so the
existing "large input" tests certified the bug. Twenty-eight sites reachable from a
paste now use a shared reduction (`lib/minmax.ts`), including the plot renderer
behind about 25 call sites, the data-insights engine, the FFT filter, the assay
fits and the sequence readers. The remaining spread sites in the repo are bounded by
structure — matrix order, pole count, polynomial degree — and were deliberately left
alone.

Its own test caught a semantic gap on the first run: `Math.min(0, −0)` is `−0`, and
a naive `v < m` reduction returns `+0`. The plot renderer divides by an axis span,
where `1/+0` and `1/−0` differ in sign, so a drop-in replacement that was subtly not
a drop-in replacement would have been its own new bug. Signed zero is now handled
explicitly and checked against `Math` directly.

### "Unknown variable a" about a variable defined on screen

The uncertainty parser matched numbers with the character class `[\d.eE+]+`, which
allows `+` but not `−`. So `a = 1e-3 ± 1e-4` failed the anchored match, the line was
**silently discarded**, and the pane then reported `Unknown variable "a"` — blaming
the formula for the parser's omission. `1e+3` worked, which is what made scientific
notation look supported. The same loose class accepted `1.2.3`, which `parseFloat`
quietly read as 1.2.

Widening the grammar fixed that and opened a new hole: `a = 5 ± -0.1` now *matched*,
and propagation squares sigma, so a negative uncertainty would have disappeared into
a plausible-looking answer. The old class rejected it only by accident. It is now
refused on purpose, with a message that says an uncertainty is a magnitude.

Two structural changes matter more than the character. The number grammar now lives
in one place (`lib/numgrammar.ts`) instead of being hand-written per module, which
retires an instance of the duplicated-constant class and lets `beam.ts` share it.
And the parser moved out of `taskpane.ts` into `lib/uncertaintyParse.ts` — **nothing
in this repo can import `taskpane.ts` in a test**, because it pulls in the Office.js
`Word` namespace, so every parser buried in that file is structurally unreachable by
the suite. That is why a one-character omission survived. It is now tested, and an
unreadable line is named rather than dropped in silence.

### Smaller, all verified before and after

- **`log10` threw an uncaught exception.** `derivFn` had cases for `log` and
  `log2` but not `log10`, which the parser and evaluator both accept.
  `differentiate("log10(x)")` threw *"No derivative rule"* straight out of the pane,
  and `integrate("log10(x)", 1, 2)` threw the same from the by-parts branch. It was
  the only such gap.
- **`0/0` simplified to `0`**, so `differentiate("x/0")`, `("0/0")` and
  `("(x+1)/0")` all reported the derivative as **0**. The fold now requires a
  denominator demonstrably non-zero, and a division by literal zero anywhere in the
  expression carries a caveat saying the result shown is not a number — a
  non-answer must not be presented as an answer.
- **A NaN root labelled `exact (linear)`.** `solveEquation("x/0 = 1")` returned
  roots `["NaN"]`. `polyCoeffs` divided by a zero constant, producing `[NaN,
  Infinity]`. The parser deliberately refuses the identifiers `NaN` and `Infinity`
  and the literal `1e999` to prevent exactly this; arithmetic division by zero
  walked past both defences.
- **An impossible formula validated clean.** `validateFormula("H0")` returned
  `valid: true` with a molar mass of 0 and a Hill formula of `"H0"`; `"C0H4"`
  likewise. A subscript of zero is a typo, not chemistry, and certifying it is worse
  than refusing it.
- **Ground-node aliases were case-sensitive.** `V1 1 Gnd 5 / R1 1 0 1k` gave
  **V(1) = 0 V, V(Gnd) = −5 V** — exact, unique, and wrong, because `Gnd` was
  treated as an ordinary node. `gnd`, `GND` and `ground` worked; `Gnd`, `Ground` and
  `GROUND` did not.
- **A zero-henry inductor or zero-farad capacitor** returned `ok: true` with
  all-NaN node voltages, printed as "not finite" and still insertable. Rejected at
  parse now.
- **A capacitor counted as a DC path to ground**, defeating the flagship refusal in
  the module's own header.
- One method string for one outcome: a domain error and a pole both mean the
  integral does not exist, and having two names for that was a distinction about the
  *cause* dressed up as a distinction about the *result*. The cause is in the
  caveat, where it is stated explicitly and never guessed.

### Two tests that could not fail

- The `sqrt(x)^2` domain-widening tests asserted only that the formal value "no
  longer arrives bare" — a caveat beside a number. That is now a refusal: `sqrt(x)`
  is undefined on half of [−1, 1], so there is no integral, and a caveated number is
  still a number in the document.
- Recorded in `docs/KNOWN-DEFECTS.md` rather than fixed: both beam-chart height
  tests parse the height out of the SVG they just generated, so they cannot fail.
  Proved by rewriting the declared height by +10, +50, +200 and +1000 — the exact
  change that caused the 336→346 bug — and watching all four still pass.

6,362 tests across 210 files, all green.

## [2.38.0] — 2026-07-29 — Two wrong statistical verdicts, and eight more from the stats engines

A deep round aimed at engines never independently reviewed. Five passes launched;
four died to repeated API failures, and the one that finished — the statistics
engines — returned the best-evidenced report of the exercise, every finding
anchored to a published authority rather than to the code. Two changed
significance verdicts.

### The log-rank test used the wrong statistic

It returned the Pearson form, sum (O-E)^2/E, where the log-rank statistic is
(O1-E1)^2/V. **V was already being computed** — accumulated for the Peto hazard
ratio, then not used for the test it belongs to.

Checked against the Freireich 6-MP leukaemia trial (Klein & Moeschberger Ex 7.2;
R's `survdiff` help page): published chi-square = 16.79, p = 4.17e-05. The
observed and expected counts already matched the literature exactly — [21, 9] and
[10.749, 19.251] — while the statistic came out 15.23, p = 9.50e-05. Only the
denominator was wrong.

The Pearson form is conservative by roughly 10%, enough to cross alpha: a dataset
reported p = 0.0557 (not significant) where the correct answer is 0.0447
(significant). For k > 2 the exact statistic needs the full covariance matrix of
O - E, which this accumulation does not carry, so that case keeps the
approximation and now SAYS it is one.

### Tukey HSD was unusable above about df = 1000, and anti-conservative

The outer quadrature pinned its lower limit at 1e-6 and moved only the upper one,
while the integrand's peak narrows like 1/sqrt(2*df). At large df the whole peak
fell between two of the 72 fixed nodes, and the CDF stopped being monotone in df —
swinging 0.914 → 0.897 → 0.862 → 0.998 around a true 0.914.

Against this file's OWN anchor, the theorem q(a, 2, df) = sqrt(2)*t(a, df), which
had apparently never been swept past df ≈ 500: 9.7% error at df = 3000, 22.7% at
4999, and at df = 4000 bisection hit its ceiling and returned **30**, after which
nothing can ever be significant. At alpha = 0.01 the error ran the other way,
19% LOW, which manufactures false positives. Reachable from the pane with three
groups of ~1350, where the p-value and the significance flag — computed by
different routes — disagreed outright.

The window now follows the peak, so the step is a fixed fraction of the peak width
at every df: within 0.05% from df = 2 to 19000, and monotone.

**The first attempt at that fix is the more useful lesson.** Raising the node
count to 20 per standard deviation was correct to 1e-7 and took **3 to 4.5 seconds
per uncached call** — a frozen Word in a pane that recomputes on every keystroke.
Trading a wrong number for a hang is the worse bargain. The node count was never
the problem; the centring was.

### Eight more from the same pass

- **`logRankTest` validated nothing** while `kaplanMeier`, twenty lines above in
  the same file, validated everything — the asymmetry within one file is what makes
  it an oversight. Worst case: 1/2 event coding (the SPSS/SAS convention) was read
  as "2 is not 1, so censored", **inverting the events**. The same data gave
  p = 0.487 coded 1/2 and p = 0.810 coded 0/1, with no warning either way.
- **`chiSquareP` returned exactly 0** for small p — `1 - gammp(...)` where the
  continued-fraction branch had already formed `1 - q`, annihilating q below
  ~1e-16. chiSquareP(100, 1) gave 0 where the answer is 1.5e-23.
- **Goodness of fit accepted mismatched totals** — observed summing to 60 against
  expected summing to 6 returned chi-square = 486 without complaint. Entering
  proportions in a counts field is the obvious user error.
- **`describe()` threw `RangeError`** past ~130,000 values, from `Math.min(...xs)`
  spreading every value as an argument. 100,000 worked, so it looked fine.
- **Least squares was not scale-equivariant** — predictors scaled by 1e-12 solved
  and by 1e-13 were refused as "collinear", a refusal also factually wrong about
  the data. A relative pivot test alone cannot fix it, because the O(1) intercept
  column makes a legitimately tiny column look rank-deficient; the design matrix is
  now column-equilibrated and the coefficients scaled back.
- **The rank tests ranked NaN.** The comparator returns NaN for a NaN, leaving the
  sort order unspecified, so `mannWhitneyU([1,2,NaN,4],[5,6,7,8])` reported
  p = 0.030, "significant", out of noise. `rankWithTies` exists in TWO files, and
  guarding one left the other still doing it.
- **`twoWayAnova`'s docstring claimed it threw for unbalanced designs.** It checked
  cell size but never row length, so a ragged design returned F = NaN with a wrong
  total df and no complaint. Now it throws, as advertised.
- **`probit`'s docstring claimed a Halley refinement and 1e-15 accuracy.** No
  refinement exists in the body; measured error is 8e-10.
- **Kaplan-Meier with no events** reported S = 1 with a zero-width interval. S = 1
  is correct and Greenwood is legitimately zero, so the numbers stay — but [1, 1]
  read as certainty bought by three censored subjects, and now carries a caveat.

### Reachability

An audit of all 639 exported library functions against every use in `src/`,
counting names rather than import edges so dynamic imports are covered. **Zero
broken wiring** — no pane feature is unable to reach its engine, so the failure
recorded at v2.19 is not currently present.

It found 26 exports dead everywhere, 20 with tests: seven finance calculations, an
entire six-function 3D transform set, and a substrate-inhibition model the pane
*names* in a diagnostic while offering no way to fit it. Unsurfaced capability
rather than defects, so nothing was deleted;
`reachability.adversarial.test.ts` ratchets the count so the pile cannot grow.

### Testing

`statsAuthorities.test.ts` pins each fix to something outside the code — the
Freireich trial, the sqrt(2)*t theorem, published chi-square quantiles, and
scale-equivariance as an identity. Not one expectation recomputes the answer the
way the implementation does.

## [2.37.5] — 2026-07-29 — Round four: a squashed figure, a deleted mode, a fast path never exact

Recorded here late — this release shipped with its detail in the commit message
and no CHANGELOG entry, which is exactly the documentation rot the previous two
releases were about.

- **Every inserted beam figure was squashed 2.9% vertically.** The chart's height
  went 336 → 342 → 346 across three releases while the pane declared `h: 336` as a
  literal. Nothing was clipped, so nothing looked broken. The geometry test could
  not catch it: it parses `height=` out of the SVG it just generated, so it is
  self-consistent at any value. The size is now exported rather than re-typed.
- **A genuine vibration mode was still being deleted** at ordinary engineering
  numbers — two 10-tonne floors plus a 0.1 mg sensor die reported [0, 0, 1e8]
  against a truth of 6.3 and 17.3 rad/s, with the static case refused and both
  real resonances missed. Tightening the tolerance twice had not worked because
  lambda_min/lambda_max carries no rank information: "is K singular" is a question
  about K, now answered by a Cholesky factorisation. **When you tune a threshold
  twice, the predicate is wrong.**
- **`qToNumber`'s fast path was never correctly rounded** — 1 to 2 ULP in roughly
  a third of cases, making the exact-rational pipeline LESS accurate than the
  naive parse it exists to improve on. Now taken only where it is provably exact.
- **One idiom, six places.** Having hit "square before dividing or rooting" three
  times, a sweep found three more, including `eigenvaluesGeneral` *throwing* on a
  matrix whose entries and eigenvalues are both perfectly representable.
- And three defects in the previous round's own tests: an exact verifier
  structurally blind to both bugs it replaced, a hang detector timing a code path
  that early-exits, and a committed probe file of `console.log` with no assertions.

## [2.37.4] — 2026-07-29 — Round three: the reviews reviewed the repairs

Three more independent passes, this time over the code written the same day to
repair round two. They found defects in every area again, including two in a
release that had shipped hours earlier and one in the guard written to prevent
documentation rot.

### A genuine mode was being deleted and announced as a rigid-body mode

`modalAnalysis` decided "is this eigenvalue zero?" with a tolerance of 1e-9
relative to the LARGEST eigenvalue — about seven orders looser than the rounding
of the eigensolve itself. Any structure whose eigenvalue spread exceeded 1e9 had
its lowest genuine mode zeroed, and the zero is not a label: it replaces the
frequency.

The input is not exotic. 1000 kg on a soft mount carrying a 1 g part on a stiff
spring, stiffness matrix plainly positive definite, true frequencies 1.0 and
1e5 rad/s. The engine reported **0 and 1e5**, told the user *"that is a
RIGID-BODY MODE… a support is missing"*, **refused the static case outright**, and
was **3x wrong at a mundane 0.5 rad/s** (4.00 against 1.33). All 146 vibration
tests passed against it.

Now 1e-12 — four orders above rounding, so a genuinely singular stiffness matrix
is still caught — plus a note when the spread is wide enough that the lowest
frequency is near the limit of what double precision can separate from zero.
Verified against the exact static answer K⁻¹F and against an independent product
of eigenvalues, det(K)/det(M).

### Smith's algorithm had turned a refusal into a silent zero

The round-two repair fixed overflow in the complex division and introduced a new
way to be wrong: when `wn² - ω²` overflows, Smith's returns **-0**, so the
finiteness guard never fires. `F = 1e300` at `omega = 1e160` has the perfectly
representable answer 1e-20 and came back as **amplitude 0** with a contribution
reading `force: 1e300, amplitude: 0` — the same self-contradiction the `isNodal`
repair in that very commit was written to remove, one branch over. The
denominator is now formed in scaled units so the squares cannot overflow at all.

### The exact-to-double conversion, third time

Two findings, and the second is about method rather than code.

- It was **not correctly rounded**. Always carrying exactly 64 bits of quotient
  means the BigInt division floors and `Number()` then rounds again — two
  roundings, so up to 1 ULP off. In the subnormal range 1 ULP is a 20-100%
  relative error, and one ratio returned **0 where the answer is MIN_VALUE**. The
  shift is now chosen from the RESULT's exponent, so the division lands on the
  double grid and is rounded once, half-to-even, in the right place.
- **The "independent reference" that certified it was a line-for-line copy of the
  implementation.** It was labelled "Independent reference" and carried a comment
  claiming it had been validated first. Every assertion against it was a
  tautology — and it is what certified the version that was not correctly
  rounded. That is precisely the failure this project's own v2.37.1 commit
  message describes: *an oracle of self-consistency cannot detect a consistent
  error.* Knowing the rule did not prevent committing it.

  The replacement does not recompute the answer at all. It **verifies** one in
  exact integer arithmetic: a double is correct exactly when no neighbouring
  double is closer. That cannot drift into agreeing with the code. It also
  rejects a known-good value's neighbour, so it cannot pass vacuously.

  Also corrected: the docstring's flagship example (3^1237 / 5^233) was not in
  the band it was offered as evidence for — its gap is 1419 bits and its value
  about 1e427, genuinely infinite. Replaced with one that is real.

### The EI-dependence check was doubling every elastic beam

The twin solve added in v2.37.1 ran the FULL analysis — several hundred sampling
sweeps for the shear, moment and deflection extremes — and read exactly one thing
from it: the reactions. Measured at ×1.75 to ×2.2, up to 63 seconds at the
module's own maximum supports and loads, in a pane that recomputes on every
keystroke. The probe now stops immediately after the reactions: 8 ms against a
1758 ms solve, down from doubling it. Its stub throws rather than returning
plausible zeros, so a probe result can never be mistaken for an answer.

### The figure, again

- `NaN` still reached the SVG at `settle` between 1e295 and 1e308, **including at
  the repo's own standard test EI**. The round-two fix guarded the sample values
  but not the SCALE derived from them: a surviving sample within 12% of
  MAX_VALUE sends `lo - pad` to -Infinity and the ratio to NaN. Both `drawPanel`
  and `annotate` now guard it — fixing only the first still left `y1="NaN"`.
- **The v2.37.1 test that was supposed to catch this sampled only `settle=1e400`**,
  which passes for the wrong reason: everything overflows, so the panel bails
  cleanly. A green test certifying a band it does not sample — the same shape as
  the qToNumber band the same release's commit message was written about.
- The "cannot draw this" bail counted SAMPLES, not distinct x. The sampler emits
  the right-hand end more than once, so two coincident points satisfied it and
  the panel drew a single dot at the edge with no notice — beside a reported peak
  of 0 while the true shear was infinite.
- The settlement label still ran off the viewBox: a fixed 34 px allowance against
  labels reaching 38 px, and the previous test sampled x in {0,1,4,7,8} and
  stepped over the band where it happens.
- A lone pin was told *"Add a pin or a fixed support"*.

### The documentation guard was defeatable six ways

Written last release to prevent doc rot, and an independent pass made the
documentation wrong six different ways while it stayed green. Every hole was a
general trap: a count regex that required adjacency (so "19 financial
calculators" was invisible, and invisible *silently*); a Map keyed by name, so a
stale count ABOVE a correct one was overwritten; a HARDCODED discipline list in
the check whose own comment boasted about avoiding hardcoded lists; and a
haystack that included `taskpane.ts`, so a **code comment** satisfied a
**documentation** check.

Rewritten to four rules: documentation is prose and source files are not
searched; every occurrence is judged, never the last; an unattributable quantity
is a failure rather than a skip; nothing is hardcoded that can be derived. All
six mutations plus three controls now fail the guard, checked by replaying them.

## [2.37.3] — 2026-07-29 — A guard for the documentation, and a count it immediately caught

v2.37.2 fixed seven stale documentation surfaces by hand. This adds the gate that
would have caught them, and it found an eighth on its first run.

### Finance had been claiming 18 calculators; it ships 19

`FIN_CALCS` has nineteen entries. README.md and FEATURES.md said eighteen. Nobody
had counted them since the nineteenth was added, and nothing checked.

This was found by accident: the guard was written for Engineering, flagged the
Finance numbers as disagreeing, and chasing that down turned up a real error. So
the guard now covers **all five calculator registries** — Finance, Stats,
Analyze, Engineering and Bio/Assay — rather than the one it was written for. A
check that finds bugs in its neighbours and then gets taught to ignore them has
learned the wrong lesson.

### What the guard checks, and what it deliberately does not

Two things, both **derived from source** so they grow on their own. A hardcoded
list is exactly how `unbounded.adversarial.test.ts` came to cover none of the
exports added after it was written, and repeating that in the test built to
prevent it would have been a poor joke.

1. **Per-discipline calculator counts.** `<b>Vibration (4)</b>` on the manual and
   tool pages is checked against the number of `ENG_CALCS` entries carrying that
   group. Both sides are structured data, so this is exact rather than a prose
   match — and it is what would have caught the 37th calculator shipping while
   the manual still said three.
2. **Every syntax the parser accepts is documented somewhere.** The option names
   are read out of `parseSupports` itself, and each must appear with its equals
   sign in the in-pane examples, the pane hint, or a web page. This is the one
   that would have caught `k=` and `settle=` shipping undocumented for three
   releases: no count changed, so a count guard alone could never have seen it.
   Aliases (`spring=`, `stiffness=`, `settlement=`) are exempt — an alias helps
   someone who already knows the option exists.

Not checked: prose. A test asserting a page contains the words "modal
superposition" fails the first time someone improves a sentence, and a guard
people delete is worse than no guard.

### Watched to fail before being trusted

Each check was run against a deliberately broken payload: a wrong discipline
count on each page, a wrong total, and an option stripped from every document.
All four fired. A check nobody has seen fail is not evidence — the same reason
the Engineering audit self-tests its own predicates.

### One that bit while writing it

Building the guard through a shell heredoc turned `
` into a real newline and
`` into a literal 0x08 BACKSPACE inside a regex — the identical damage that
once shipped the Alexander polynomial unreachable for a release. It failed to
compile this time, which is luck rather than process; the repair went through a
script file instead, and `controlchars.adversarial.test.ts` confirms the byte is
gone.

## [2.37.2] — 2026-07-29 — The documentation catches up with the code

Three releases of engineering work had landed with only FEATURES.md and half the
manual describing it. An audit across every documentation surface found seven
stale ones, and — the part that matters — **two honest-limits statements that had
become false**.

### The limits statements were wrong, which is the worst kind of stale

The tool page carried "indeterminate reactions assume **rigid supports**" and
"free and forced vibration are **single-degree-of-freedom**". Both were true when
written and both stopped being true in v2.36.0. A limits section that overstates
a limit is not merely out of date: it is the page a careful user reads precisely
*because* they want to know what the tool cannot do, and it was telling them to
avoid something that works.

Now: supports may be rigid, elastic or settling, with the elastic and settling
cases needing EI and their EI-dependence **checked by re-solving rather than
asserted**; and free vibration is single-DOF while forced response covers both,
the multi-DOF case by modal superposition, which assumes classical damping — a
caveat that did not exist before and now does.

### Everything else that was behind

- **landing/index.html** — elastic and settling supports, multi-DOF forced
  response, and exact fractions in the Engineering section.
- **landing/science.html** — the Engineering card named neither new capability.
- **landing/tool.html** — the Structural entry now covers elastic/settling
  supports and fractions; Vibration went from "(3)" to "(4)" with the modal
  breakdown, the every-frequency-is-a-resonance point and the node-excitation
  lever described.
- **landing/manual.html** — a full multi-DOF forced-response paragraph, and
  fractions alongside the exactness paragraph where they belong.
- **README.md** — the Engineering row.
- **ROADMAP.md** — the status section stopped at v1.99.0; it now records
  v2.36.0–v2.37.1 including the truss proof and the three rounds of independent
  review.

### Checked and deliberately left alone

`docs/USER_GUIDE.md`, `docs/CAPABILITIES.md` and `docs/QUICK-SHEET.md` are
pointers to the web manual rather than duplicates — which is why they could not
go stale, and why they are still correct. That is the right shape for them and
they were not touched.

## [2.37.1] — 2026-07-29 — Bugs in the bug fixes

Three independent reviews, one per area, over code written EARLIER THE SAME DAY
to repair earlier bugs. None of those repairs had been independently reviewed,
and a fix is exactly as likely to be wrong as the original. They found twelve
real defects. The pattern is the finding: every round of this has caught
something, and the things caught are never in the part the author was thinking
hardest about.

### The exact-to-double conversion was still wrong, in a band

`qToNumber`'s repair shifted both sides right until the SMALLER had ~64 bits.
That preserves the ratio but leaves the LARGER side with `gap + 64` bits, so it
still overflowed once the gap exceeded ~960 — while a double does not run out
until 1024. A band, gaps 961 to 1023, returned **Infinity for values as large as
6.9e307**, and the mirrored band returned **0** for everything from 1e-289 down
through the entire subnormal range. The docstring asserted the opposite, and its
stated reasoning was precisely the mechanism of the defect.

Being wrong in a BAND is worse than being wrong everywhere: the tests sampled
gap 0 and gap ~1300 and passed, straddling it. Now it divides first with BigInt
and scales by a power of two split in two halves, so neither factor overflows or
flushes at the extremes. Verified against a reference validated independently
first; zero slow-path mismatches over a wide coprime sweep.

Worth recording: the first attempt to REPRODUCE this failed, because `ratDiv`
reduces by gcd and collapsed the test cases into the fast path. The permanent
tests use coprime `3^a / 5^b` for that reason.

### Multi-DOF forced response

- **`isNodal` overflowed its own scale.** It formed `|phi| * |F|` before
  dividing; mode shapes are mass-normalised so `|phi| ~ 1/sqrt(m)`, and a light
  degree of freedom under a large load made that product Infinity — after which
  `|f| < 1e-12 * Infinity` is true of every finite f. A mode sitting exactly on
  an undamped resonance was reported as a NODE with **amplitude 0 while its
  generalised force was 1e307**. Now divides twice instead of multiplying.
- **The complex division squared both parts first.** `F = 1e300` at
  `omega = 1e150` has the elementary answer 1, and came back NaN — then refused
  with "use units that keep the numbers in a physical range", advice that could
  not help because the answer was representable throughout. Now uses Smith's
  algorithm.
- **`den2 === 0` tested a squared quantity**, so `zeta = 1e-200` underflowed and
  a mode the user HAD damped was refused as undamped. Now tests `re` and `im`.
- **`zeta` escaped the finiteness guard** and reached the pane as
  "ζ = not finite" presented as a success — the exact symptom the guard was added
  to prevent, one field over.
- **Under Rayleigh damping a rigid-body mode reported ζ = 0**, which reads as
  undamped although its coefficient is alpha and the answer used it; feeding
  those ratios back is a 1104% amplitude error. Now explained in a note, and the
  "damping you did not supply" note keys on the coefficient rather than the ratio.

### Beam warnings, and one that could not be caught by its own oracle

- The settlement-uncertainty warning fired on **spring-only** beams, asserting a
  settlement the user never entered.
- **The determinacy note overclaimed EI-dependence.** A three-support beam on a
  spring under an antisymmetric load has v = 0 at the spring by symmetry, so
  R = 0 there for every k and every EI — the reactions are bit-identical at
  EI = 1 and EI = 1e6 while the note called them "specific to the EI you
  entered". v2.36.1's stated criterion was "the warning must not contradict the
  note", and it met that criterion by making the warning agree with a note that
  was itself wrong. **An oracle of self-consistency cannot detect a consistent
  error.** The engine now re-solves at a different EI and compares the exact
  rationals, so the claim is measured rather than asserted.
- A concatenation seam, a message quoting a constraint that is not true
  ("no spaces inside the value" — spaces around a fraction slash are fine), and
  a warning branch that was unreachable.

### The figure

- The new support artwork **broke the panel budget**: the spring reached y = 80
  and the settlement label y = 94, where the shear panel starts — so the label
  was drawn over the shear diagram's title.
- A **heave drew a downward arrow** beside a label reading "-0.01".
- On the perfectly ordinary `roller 8` the label started at x = 410 in a 420-wide
  viewBox and was **clipped**.
- `beamChart` kept its own private copy of the naive `Number(n)/Number(d)`
  conversion — the one fixed in `cas.ts` — and a non-finite sample was written
  straight into the path as `L 46.0 -Infinity`, which is invalid SVG in the
  user's document. Both fixed; a panel that cannot be drawn now says so.
- The x-axis label was clipped off the bottom on **every** beam, including a
  plain rigid one.

### Testing

Three new files, 53 tests, plus an extension of the unbounded-loop guard — which
was a hardcoded list written from a one-off sweep and had never grown, so none of
this year's exports were in it. The new tests assert on parsed SVG COORDINATES
rather than on "did the markup change", because the previous chart tests asked
only the latter and all three drawing defects passed them.

## [2.37.0] — 2026-07-29 — Fractions in every beam field

The beam engine computes over exact rationals so that a third stays a third, and
until now `1/3` was the one notation it would not accept. Every numeric field
matched a decimal-only pattern and rejected fractions before `parseRatLiteral` —
which has always handled them — was ever reached. A support at *L*/3 had to be
typed `2.6666666667`, which puts a rounding error into the input of an exact
solver.

Now `roller 8/3`, `point 30 at 8/3`, `udl 7/2 from 1/3 to 16/3`, `moment 200/3 at
4/3`, `k=1/3`, `settle=1/400`, and the span and EI fields all take fractions. On
a 9 m span with a point load at `9/3`, the reactions come back exactly 20 and 10;
typed as a decimal they cannot.

This also closes an inconsistency between two engines sharing one CAS: the TRUSS
parser has always accepted fractions, because it tokenises and hands each token
straight to the shared parser. Only the beam fields stood in the way.

**One pattern, not five.** All five support and load patterns now interpolate a
single `NUM` constant, because five copies is how the fields drifted apart to
begin with. `parseRatLiteral` remains the single authority on what the text
MEANS; the pattern only decides where a number ends. So `1.5/3` is matched and
then refused with "is not a number" rather than being silently reinterpreted —
integer over integer is what the parser accepts, and `3/6` or `0.5` is
unambiguous.

**A false claim retired.** v2.36.0 shipped a comment saying fractions came along
with the shared parser "which the position and load fields simply gain". That was
false in every field, and was corrected to say so in v2.36.1. It is now true, and
`beamFractions.test.ts` pins the claim to the behaviour so the two cannot drift
apart again.

### What the independent bug hunt caught before this shipped

Widening the fields made the option stripper unsafe, and the failure was the
worst kind — a silent wrong answer. The stripper replaced each matched
`key=value` with a SPACE, and `NUM` tolerates whitespace around its slash, so
anything the value pattern could not swallow REJOINED the position across that
space:

    "roller 8 k=1/2/3"  ->  strip "k=1/2"  ->  "roller 8  /3"  ->  x = 8/3

No error, no warning: the support silently moved to a third of where it was
asked for, and on a two-support beam that flipped a reaction into uplift — 24 kN
down becoming 24 kN of uplift, with 72 kN at a roller the user never placed. The
same mechanism let an option sit INSIDE a position (`roller 8 k=1/2 /3`).

Rather than patch the cases, the part is now CUT IN TWO at the first `key=`. The
position is whatever precedes it and cannot be assembled from fragments on either
side, and the option region must consist entirely of options or the part is
refused. That also finally enforces what the docstring always claimed: options
come after the position, so `k=5 roller 8` is now refused rather than quietly
accepted.

Ruled out in the same pass, with measurements: no catastrophic backtracking
despite `NUM` appearing four times in the varying-load pattern (linear to 100k
characters, and the pre-existing decimal path is slower than the new fraction
one), no mis-segmentation across `/`, and no input that previously worked now
fails.

**Also fixed:** the new support error carried EM DASHES. Parser errors
short-circuit before the pane's `plainDashes` pass, so unlike a result line they
reach the document unconverted — caught by the Engineering audit, not by a unit
test.

## [2.36.1] — 2026-07-29 — What the bug test found

v2.36.0 shipped with 5,987 green tests, a full QC pass, and two adversarial
files. An INDEPENDENT bug hunt on the shipped diff then found seven real
defects. Recording why, because the reason is more useful than the fixes: the
adversarial files were written by the same author as the code, alongside it, and
they tested what the author thought was hard. Six of the seven sit outside that.

### The one that was a wrong number

**Rayleigh damping was silently wrong on any structure with a rigid-body mode.**
A damping RATIO cannot represent damping on a rigid-body mode: the modal
coefficient is 2*zeta*wn, so at wn = 0 it is zero whatever ratio you give, and
`rayleighDamping` duly returned 0. But C = alpha*M + beta*K gives that mode a
real coefficient of alpha. A free-free chain at the alpha = 0.6, beta = 0.002
printed in the pane's own hint came out **56% high in amplitude and 50 degrees
wrong in phase**; at alpha = 5 it was a factor of ten.

`modalForcedResponse` now accepts the Rayleigh pair directly and carries the
modal COEFFICIENT `alpha + beta*wn^2`, which is exact at wn = 0. Given ratios on
a structure with a rigid-body mode it still treats that mode as undamped —
unavoidable in that parameterisation — but now says so instead of passing it off.

**Why the shipped suite could not see it.** The 100-random-system property test
builds K as `mk(200, 100)`, adding 100 to every diagonal. Every system it can
generate is positive definite, so NOT ONE has a rigid-body mode. `rayleighDamping`
was checked against a direct complex solve in that very file, and the single case
it gets wrong was excluded by the generator's construction. A property test is
only as good as the property its generator can reach.

### The ones that returned NaN or refused arbitrarily

- **`ratToNumber` destroyed correct answers.** `Number(n)/Number(d)` converts the
  two sides independently, so a ratio whose halves each exceed ~1.8e308 became
  Infinity/Infinity = NaN. A beam reaction of exactly 15, held as a 604-digit
  over 603-digit rational, was reported as NaN — the exact solve was perfect and
  the final conversion threw it away. **This predates elastic supports**: it was
  reachable on the plain rigid-support path with a 1e308 distributed load. Both
  sides are now shifted right by the same number of bits until the smaller has
  ~64 left, which cannot change their ratio. A genuinely enormous ratio still
  returns Infinity, because that is the correct double for it.
- **A finite omega could still produce NaN** in the MDOF response: omega = 1e200
  squares past the double range, and the pane rendered the result as
  "DOF 1: not finite" while calling it a success. Now refused, naming the
  overflow.
- **"Is this mode excited?" depended on the units the load was typed in.** The
  test was an absolute 1e-12, so the same structure and the same load direction
  was called a node at f0 = 1e-12 and an unbounded resonance at f0 = 1e-11, and a
  genuinely nodal load flipped between accepted and refused with its float
  residue. It is now relative to |phi|*|F|, the largest the generalised force
  could be. Note that `1 + |F|` is NOT a fix — it leaves an absolute floor.

### The ones in what the user reads and sees

- **The most-read instruction in the beam module did not work.** The warning on
  every indeterminate rigid-support beam said to add `"settle 0.01"` — without
  the equals sign, which the parser rejects. A general test now feeds every piece
  of syntax any message quotes back through the parser.
- **The "NOT EI-free" warning contradicted the determinacy note above it.** It
  was gated on `eiCoupled` alone, so a DETERMINATE beam on a spring was told its
  reactions "scale with EI" while the same output said the spring "changes no
  reaction" — and the reactions were provably identical at EI = 1 and EI = 1e6.
  `eiCoupled` is honest about the SOLVE; it does not license that claim about the
  RESULT. Now gated on `degree > 0 && eiCoupled`, with the true statement given
  in the determinate case.
- **A concatenation seam** rendered "on a rigid -support beam".
- **The figure inserted into the document drew a rigid support** for a spring or
  a settling one — byte-identical SVG. Springs now draw a coil on their own
  ground line and a settlement draws a dashed offset with its value written
  beside it.

### Testing

Three new files, 54 tests, aimed at what the originals structurally could not
reach: free-free structures, absurd-but-finite magnitudes, load scaling across
twelve orders of magnitude, and the rendered figure. Plus general guards — every
quoted syntax must parse, and no result may contradict itself about EI.

## [2.36.0] — 2026-07-29 — Two honest limits lifted, and one that provably cannot be

A review of the disclosed limits, and then the two that were worth acting on.
Most of that list turned out to be correct scoping rather than a to-do: no
design code, circular-only torsion and the perfect-column buckling load are the
same decision three times over — do not turn a theorem into a lookup table —
and the pharmacokinetic extrapolated-AUC fraction is a diagnostic the tool
already reports rather than a shortcoming.

### Beams: elastic and settling supports, still exact

Supports were rigid or nothing. Now `roller 8 k=5e4` sits one on a spring and
`roller 8 settle=0.01` sinks it by a known amount, downward positive.

This stays **exact over rationals**, which is the whole point of the beam
engine. A rigid support contributes the homogeneous condition v = 0, which is
why EI cancels out of every reaction. A spring contributes v = -R/k and a
settlement v = -delta; written in the EI·v the engine actually carries, those
are `EI·v + (EI/k)·R = 0` and `EI·v = -EI·delta`, so EI appears as a coefficient
on an unknown and as a right-hand-side term. Both stay affine in the unknowns
and rational, so the solve is unchanged in kind.

What changes is the CONTRACT, and it is stated rather than glossed: these beams
need EI, and their reactions are **not** EI-free. That is physics, not a
limitation — a stiffer beam really does draw more reaction out of a settling
support — but "reactions need no EI" is this module's headline property and it
is false here, so `eiCoupled` is on the result and every line that repeats the
old claim is guarded by it.

Two facts the tests pin, because they are the ones people get wrong:

- On a **determinate** beam, a spring and a settlement change **no reaction at
  all**. Equilibrium alone already fixed them; the beam simply moves. This is
  also the best available oracle for the new path, and it is checked as exact
  rational equality against the rigid-support answer.
- On an **indeterminate** beam they change everything, and the induced
  reactions scale **linearly with EI**. A propped cantilever with a settling
  prop reports exactly `3EI·delta/L^3`. That is a real load case and often the
  governing one, and it is also the least certain number in a design, since it
  scales with two estimates at once. The result says so.

`beam.ts` also stopped carrying its own decimal parser and now uses the CAS's
shared literal parser. The private one accepted plain decimals only, which was
invisible until a spring stiffness had to be written `k=5e4` — EI and support
stiffnesses are exactly the two quantities nobody types in full, so the new
option would have been unusable at the magnitudes it exists for.

### Vibration: forced response of a multi-degree-of-freedom system

The disclosed limit — free and forced vibration are single-degree-of-freedom —
was true, but it undersold what already shipped: `modalAnalysis` has been
multi-DOF for some time and returns **mass-normalised** mode shapes. That is
precisely the normalisation modal superposition needs, so the modal coordinates
decouple into n independent SDOF oscillators and the MDOF forced response is
the SDOF path run n times, not a new solver.

Reports amplitude and phase at every degree of freedom, plus the modal
breakdown, because which mode is carrying the response is the useful part:

- **Every** natural frequency is a resonance, not just the first. A run-up
  passes through all of them below the operating speed.
- A load applied at a **node** of a mode cannot excite that mode at all,
  however close the forcing sits to it. That is a real design lever, and also
  why a shaker in the wrong place can miss a mode entirely.
- Modal contributions can partially **cancel**, so the total is not the sum of
  the individual peaks, and a single-mode approximation is not always safe.

Damping is entered as **modal ratios** (or Rayleigh alpha/beta) rather than as a
damping matrix. That is deliberate: modal superposition requires the undamped
modes to diagonalise the damping too, which holds for damping proportional to M,
to K, or a combination — and does **not** hold for a single discrete damper
bolted between two floors, which is the everyday real case. Taking ratios makes
the assumption something the user states instead of something silently assumed
of a matrix they supplied, and it is repeated in the notes, because a violation
produces an answer that still looks entirely reasonable.

### The truss limit provably cannot be lifted exactly

Indeterminate trusses stay refused, and the reason is now a proof rather than a
preference. Parametrise the member unknown as `g = F·L^a`. Joint equilibrium
needs `a = -1` for rational coefficients — that is exactly the `f = F/L` change
of unknown the module already uses. Compatibility needs `2-a` even, so `a` even.
Those are incompatible, and scaling a compatibility row by L or L² only moves
the odd power of L to the right-hand side. Because joints share displacements
between members of different length, no per-member rescaling escapes it.

So a stiffness solve is exact only when **every** member length is rational, and
floating point otherwise. `truss.ts` opens with an essay on how it stays exact;
putting a silent float path inside it would change what the module is. That is a
product decision rather than an implementation detail, so it stays open.

### Also

- The Natural frequencies option labelled "Grounded at both ends" described a
  structure `chainSystem` does not build. It anchors spring 0 to ground and
  leaves the far end free — a grounded chain of n masses takes n springs — so it
  now reads "Anchored at one end, free at the other". Different stiffness
  matrix, different frequencies.

### Testing

Four new files, 92 tests, and none of them checks modal superposition against
modal superposition or the beam solve against itself:

- Beam oracles are closed forms (`3EI·delta/L^3`), plus limit checks that a
  stiffening spring converges on the rigid answer and a vanishing one on the
  unpropped cantilever.
- The beam adversarial pass attacks with **invariants** rather than more closed
  forms: equilibrium on nine support arrangements, **exact rational
  superposition** of load and settlement, the spring's own law `R = k·v` which
  the solve never asserts, and uniform settlement of a determinate beam being
  pure rigid-body motion.
- MDOF is checked against a **direct complex solve** of
  `(K - w²M + jwC)x = F` with `C = alpha·M + beta·K` built explicitly — no
  eigenvectors, no modal coordinates, no shared code — over **100 pseudo-random
  systems** from a seeded generator at six frequencies each.
- Degenerate cases that break code assuming distinct modes: repeated
  eigenvalues, non-diagonal (consistent) mass matrices, overdamped modes, and
  omega = 0 checked against the static answer K⁻¹F.

## [2.32.1] — 2026-07-28 — Hovering a calculation made it unreadable

Reported from real use: hovering a tool in the new Engineering panels turned the
text white on a near-white background.

`--hover` is defined **nowhere** in the stylesheet. `var(--hover, #f3f4f6)`
therefore used its fallback unconditionally — a hardcoded light grey — behind
text coloured by the theme. In Word's dark theme that is `--ink: #e6edf3` on
`#f3f4f6`: a contrast ratio of **1.07:1**, against 4.5:1 for readable body text.
In light mode it looked perfect, which is why it shipped.

Hover, headings and the selected row now use `--bg-soft` and `--ink`, the same
theme-aware pair the rest of the pane uses, and every colour is stated rather
than inherited through a `<details>` and a `<button>`.

The same scan found `background: var(--bg)` in two chip styles — also undefined,
also never erroring, just silently leaving those chips with no background at
all. Fixed to `--paper`.

### Two new gates, and two false starts worth recording

`cssVariables.test.ts` fails on any `var(--x)` whose `--x` is not defined
anywhere in the stylesheet — with or without a fallback, because a fallback for
a variable that does not exist is not defensive, it is a theme-blind constant.

The Engineering audit now measures **contrast in both themes** on the states a
user actually hits. Getting it honest took two attempts, both instructive:

1. The first version resolved `--bg-soft` and called that the hover colour. When
   the original bug was reintroduced as a negative control, **the check still
   passed** — it was testing an assumption about the CSS rather than the CSS.
   It now reads the real `:hover` rule out of `document.styleSheets` and
   resolves the declared value on a probe inside the panel.
2. That failed too, silently, twice over: `cssRules` throws SecurityError for a
   separate stylesheet on a `file://` page (the harness now inlines the CSS),
   and `background: var(--x)` is a shorthand containing a variable, which cannot
   be decomposed, so `style.backgroundColor` came back empty and read as "no
   such rule".

Verified by reintroducing the bug: the check reports `dark worst=1.07 at=hover
UNREADABLE` and stays quiet in light mode — the exact shape of what was
reported. A check nobody has watched fail is not evidence.

## [2.32.0] — 2026-07-28 — Engineering is panels, not a dropdown

Thirty-six calculations in one `<select>` is a scroll, not a menu. Grouping them
with `<optgroup>` in v2.31.5 made the list scannable but did not make it shorter,
and Engineering was the only mode in the add-in that asked anyone to drag through
a list taller than the pane.

Each discipline is now its own collapsible panel: Structural & solids, Fatigue &
machine design, Fluids, Thermal, Electronics, Control systems, Vibration,
Biomedical, Pharmacokinetics. Nine short headings, three to six calculations
each, and only the panel holding the current calculation starts open.

**The `<select>` is still there, hidden, as the selection's single source of
truth.** A panel button sets its value and fires `change`; it does not render
inputs itself. Input rendering, compute, insert, all the routing gates and the
headless audit therefore run through exactly the path they always did. Two
controls drift apart; a control and a state holder cannot. The highlight follows
the select rather than the click, so anything that moves the selection — a
restored session, the audit driving it directly — leaves the panels showing the
tool actually being computed.

Gated in the rendered DOM, not just the source: the audit counts nine panels
holding all 36 tools with exactly one open, then clicks the button for a tool in
the LAST panel — the one a dropdown made hardest to reach — and checks the
selection moved, the highlight moved, the panel opened and the fields rendered.

### QC could hang instead of finishing

Two QC runs stalled with no output and no verdict, which reads exactly like a
failure and was reported as one. `execFileSync` launches the headless browser
with no timeout, so a browser that never exits blocks the run forever. All four
browser-driven gates — landing layout, pane layout, render check, Engineering
audit — are now bounded at 180s with `SIGKILL`, so a hang reports as the
infrastructure error it is rather than as silence. A callback is not a bound and
neither is a subprocess; only a clock is.

## [2.31.9] — 2026-07-28 — The anchor after a figure, and a measurement that never was

> **Not yet confirmed.** No picture count has been taken with `.end` in place.
> The status line reports Word's own count, so the next frequency-response
> insert either reads "2 figures" or names what was dropped — and that result,
> when it exists, will be the first hard number in the sequence.

v2.31.8 restored the figure branch byte-for-byte to the version believed to
render both Bode plots. It still inserted one of two. That result is the useful
one, because it convicts the belief rather than the code.

**The "2 of 2" rung was never a measurement.** It was inferred from a remark
that two plots "are not aligned even though they are the same size", read as
proof both had been inserted. v2.31.0 predates the picture counter entirely, so
**the figure count at v2.31.0 is unknown** — not "was probably one". An earlier
draft of this entry guessed the remark was about the pane's preview; there is no
plot preview in the pane, and swapping one unverifiable explanation for another
is the same mistake twice. What can be said is that four releases were spent
reverting toward a state nobody had ever verified.

That leaves three measurements and one inference. Every other figure-bearing
report — beam, step response, all three pharmacokinetics tools, both vibration
tools — carries exactly ONE figure and has always worked. Frequency response is
the only report with two, and the only one that loses one. One figure never
chains an anchor; a second one does.

**The fix is one token, and it is corroborated rather than reasoned.**
`insertGallery` has shipped untouched for years, inserts N pictures in one loop
in one `Word.run`, and differs from the figure branch in exactly one place:

```
insertGallery:  anchor = para.getRange(Word.RangeLocation.end);    // N pictures
figure branch:  anchor = para.getRange(Word.RangeLocation.after);  // 2nd lost
```

It is not the only such site: the table-figure and structure inserts both take
their tail from a picture with `.end`, while the same routines chain `.after`
off ordinary text paragraphs. Three shipped sites, one rule.

The proposed reading is that chaining `.after` off a paragraph which CONTAINS an
inline picture does not yield a usable insertion point — Word accepts the next
picture against it and keeps nothing, without error — while text paragraphs
chain off `.after` perfectly well, which is why the prose in these reports always
landed and only figures went missing.

**Confirmed in real Word.** The frequency-response report now reads "2 figures"
on the status line, with both plots on the page — Word's own count, from
`document.body.inlinePictures` before and after, verified against what the user
could see. That is the first hard number in this whole sequence, and it is what
promotes the reading above from corroboration to a result.

An OOXML package upstream of the figures was the rival explanation and was set
aside, not disproven: the step-response report is a transfer-function equation
(hence `insertOoxml`) plus exactly one plot, and has never been reported to lose
it, while frequency response with the same upstream loses one of two. The
recorded OOXML failure mode is total downstream loss; what was actually seen is
the prose and the *first* figure landing. `flushRun`'s anchor is deliberately
left unchanged so that this release varies one token and stays measurable.

**Figure alignment is unchanged** — the picture still sits after caption text of
varying length, so stacked figures still start at different x. That is deferred
on purpose until the figures themselves are confirmed; bundling the cosmetic fix
with a structural one is what went wrong in v2.31.1.

Gated both ways: the figure branch must use `.end`, and a second test asserts
`insertGallery` still uses `.end` too — if the path this is modelled on ever
changes, the justification is stale and the suite should say so rather than keep
asserting a shape nothing corroborates.

Refuted and recorded, so none of it is rediscovered: that properties set on a
picture before its batch syncs are discarded with it (three shipped inserts do
exactly this); and that a sync between hops is the remedy — the cleanest single
variable in the whole episode, since beam carries one figure and no equation and
kept it until the release that added a sync per hop, which took it to none.

`InsertLocation.start` is **not** refuted, only never tested cleanly: the build
that measured 1 of 2 with it also had an OOXML package upstream, a sync in the
branch, and the `.after` chain. It remains a candidate for the alignment fix —
alone, on top of a confirmed 2 of 2, never bundled.

## [2.31.8] — 2026-07-28 — Back to the six lines that actually worked

The picture count from v2.31.7 said "Word kept 1 of 2 figures", which is the
first hard measurement in this whole sequence rather than an inference. It also
convicted the fix that release shipped.

v2.31.7 differed from the last version known to render both plots in TWO ways,
not one: the picture moved to `InsertLocation.start`, and a `context.sync()`
was left in the figure branch. The full ladder, every rung measured in real Word:

| Figure paragraph | Picture at | Sync in branch | Result |
|---|---|---|---|
| caption text — v2.31.0 | End | no | **2 of 2** |
| empty — v2.31.1 | End | no | 1 of 2 |
| empty — v2.31.4 | End | yes | 0 of 2, beam too |
| caption text — v2.31.7 | **Start** | yes | 1 of 2 |

Two independent things cost figures: creating the paragraph **empty**, and
**syncing inside the loop**. `InsertLocation.start` turned out to be a third.
Every sync added to this routine has cost figures and none has ever recovered
one, so the three added in v2.31.4 — in the figure branch, after the OOXML run
flush, and after a table — are all gone. The block loop no longer syncs at all;
what remains are the picture-count probes and the single closing sync.

The figure branch is now byte-for-byte v2.31.0, and pinned **as a whole** rather
than statement by statement, because every regression here came from adding one
more thing to a sequence that was already correct. Changing it now requires a
picture count proving the change.

**The alignment defect is deliberately back.** The picture sits after the caption
text, so two figures with captions of different lengths do not start at the same
x — the original complaint that set all of this off. Three structural attempts to
fix it have each cost figures. The next attempt must build figure and caption as
a single OOXML package, where layout is declared rather than assembled from
chained ranges, and must be proved against the picture count before shipping.
Figures that render beat figures that align.

## [2.31.7] — 2026-07-28 — The figures come back to the shape that worked

The Bode plots still did not arrive, and this time the pane said why it could
not tell: "inserted — 2 figures" beside a page containing none. That count was
the number of images successfully **rasterised**; it says nothing about what
Word kept, and from inside an add-in a stored picture and a discarded one look
identical — every call accepted, no error raised.

**Word is now the witness.** The document's inline pictures are counted before
and after the insert, and a disagreement is reported as an error naming both
numbers: "Word kept 0 of 2 figures." Nothing on the add-in side could establish
that; only the host can.

**The figure shape is reverted to v2.31.0.** What the evidence actually says:

| How the figure paragraph is made | Result |
|---|---|
| picture into the caption paragraph (has text) | 2 of 2 figures |
| picture into `insertParagraph("")` — v2.31.1 | 1 of 2 |
| ...plus a sync per hop — v2.31.4 | 0 of 2, and beam too |

The variable tracking the failure is **how the paragraph is created**, not when
it is synced. Each release moved further from the working shape and lost more.

The theory shipped in the previous draft of this release — that properties set
on a picture before its batch syncs are discarded along with the picture — is
**refuted by this codebase**: `insertSubstituentGallery`, the table-figure
insert and the structure insert all set width, height and alt-text in the same
unsynced batch, and all three have shipped and worked for many versions. It is
recorded here so it is not rediscovered.

The original complaint that began this — two Bode plots not lining up — is fixed
by **position rather than structure**: the picture goes at the *start* of the
caption paragraph, so every figure begins at the margin whatever its caption
says. A caption sharing the figure's line is worse typography than one on its
own; that is a cosmetic debt to repay once figures render again.

Measured rather than assumed: the payloads are 0.13–0.16 MB, nowhere near any
host limit, so size is **not** the cause. A byte budget was added anyway,
because the pixel budget bounds canvas memory rather than the base64 handed to
Word and the largest figures elsewhere are far bigger. It never triggers here.

Gates now pin the working shape — text-bearing paragraph, picture at start, one
sync — and deliberately pin that properties *may* be set in the same batch, so a
wrong diagnosis cannot return by imitation. Two of them were bounded by their
own syntax rather than a fixed byte window, after a comment pushed the scanned
code out of range twice; and they now strip comments, since this function is
documented with the exact code shapes it must not contain. One of these caught a
real defect in the revert itself: the caption was being inserted twice.

## [2.31.6] — 2026-07-28 — An insert that fails silently, and an update that could not arrive

Reported from real use: figures missing from inserted reports — beam diagrams
and Bode plots alike — and **nothing in the status area at all**. No error, no
success message, no way to tell whether the click had registered.

Two defects combine to produce exactly that, and the combination is what made it
undiagnosable rather than merely broken:

- `insertResultBlocks` guarded re-entry with a bare `return`. That was the only
  path through it producing no document content *and* no message. The
  plain-text path already announced this; the rich path swallowed it.
- `svgToPngBase64` settled only from `onload`/`onerror`. A host firing neither
  leaves the promise pending forever — awaited by an insert holding the
  **shared** `insertTextBusy` flag, which then never clears. Every later Insert
  anywhere in the product returns silently. A callback is not a bound; only a
  clock is, so rasterisation now times out after ten seconds and rejects with a
  message that names what happened.

Both silent guards now report. The success message names what actually went in
("Beam analysis inserted — 2 figures"), counted from the images that were really
rasterised rather than from the blocks that hoped to be, so the pane's belief is
checkable against the page at a glance. A report claiming a figure the document
does not show is Word declining the call — otherwise indistinguishable from the
outside, which is precisely how this cost a round of questions to localise.

Honest about scope: this does not prove the figures will now land. It makes the
failure *visible and unstickable*. If they are still missing, the status line
will now say what the pane believes it did.

### The update banner could not deliver an update

Separately, and found while chasing the above: GitHub Pages serves taskpane.html
with `Cache-Control: max-age=600`, and the banner's Reload button called
`window.location.reload()` — which re-serves that cached copy rather than
refetching. The cached HTML names the previous hashed bundle, so the pane
reloaded into the exact build it was already running. The banner was honest and
useless at once: correctly announcing an update it could not deliver, which is
worse than no banner because it tells the user the problem is handled.

Reload now navigates to a URL carrying the new version, which the cache has
never seen. A stale pane also self-heals once per session without waiting for
anyone to notice a green bar — guarded by a session flag, because if version.json
ever advertises a release the deployed bundle does not contain, an unguarded
auto-reload would spin forever inside a task pane with no address bar and no way
to stop it. Storage denied (private mode, a restrictive host) disables the
auto-reload rather than the guard: fail safe, never fail into a loop.

## [2.31.5] — 2026-07-28 — The Engineering menu is grouped by discipline

Thirty-six calculations in one flat dropdown is a scroll, not a menu — and they
were listed in the order they were built, which is meaningful to nobody. The
Calculation dropdown now carries nine `<optgroup>` headings: Structural &
solids, Fatigue & machine design, Fluids, Thermal, Electronics, Control systems,
Vibration, Biomedical, Pharmacokinetics.

Names lost the prefixes the headings now carry, so "Control: frequency response
& margins" is "Frequency response & margins" under "Control systems". That
matters more than it sounds in a 320px-wide task pane, where the old labels were
spending their first third repeating a word.

`<optgroup>` was the right tool over a second dropdown (doubles the clicks) or a
filter box (the right answer at 60+ tools, and useless to someone who does not
yet know what the thing is called). It costs no vertical space, keeps keyboard
type-ahead, and is announced by screen readers.

Gated on both sides, because a grouped menu can lose a tool in a way a flat one
could not — a calculation naming a heading the pane does not render is built,
routable, fully tested and invisible. Jest pins that every calc declares a group
in the rendered order, that no heading is empty, and that no two labels collide
now that they are shorter. The headless audit checks the DOM the browser
actually built: nine groups, 36 options inside them, none loose.

## [2.31.4] — 2026-07-28 — Only one of the two figures was being inserted

The frequency-response report inserted one Bode plot instead of two. Same root
cause as the missing paragraphs in v2.31.3, in a different place: **an anchor
chained off content Word has not materialised does not reliably give a usable
insertion point.**

Giving the caption its own paragraph in v2.31.1 added a second unsynced hop —
caption paragraph, then empty paragraph, then picture — and with two figures the
second one had nowhere valid to land. Every hop in the insert now syncs before
the next anchor is computed: after the OOXML run package, between a caption and
its figure, after a figure, and after a table. That costs a few round trips on a
one-shot user action and makes every anchor be computed against content that
actually exists.

Two gates added, pinning that the routine syncs between complex hops and that
the figure branch in particular syncs on both sides.

Worth recording plainly: this is the third defect in the same insert path found
by using the product, and none of the three was visible to 5,700 automated tests.
Everything here is Word API sequencing behaviour that only exists at runtime
inside Word. The gates can pin that the calls are present and ordered; they
cannot pin that Word does what the calls imply.

### An Engineering audit that drives the real pane

`scripts/engineering-audit.js` boots the production bundle in headless Chromium
and drives all 36 Engineering calculators: each one on its own defaults, then
with every field emptied, then with seven kinds of rubbish typed into every
field, then **actually clicking Insert** against a Word mock that records every
paragraph, package, picture, table and sync. It checks the recorded calls
against what the preview showed, parses every OOXML package rather than merely
counting equations in it, and clicks Insert twice to prove the busy guard
clears. It runs as part of `npm run qc`.

The audit found no defect in the 36 tools. It did find three defects in itself,
which is the part worth writing down: a missing `Word.RangeLocation` in the
Office stub made all 36 tools report inserting nothing; a missing `insertText`
on the mock made the 24 plain-text tools report the same; and reading the
recorded calls one tick after the click missed every figure, because rasterising
an SVG goes through an `Image` load and never finishes inside a microtask. Each
of those looked exactly like a product-wide catastrophe. So the audit now
self-tests every predicate against a payload built to trip it, and reports
itself broken before it reports anything about the product — a check nobody has
watched fail is not evidence.

What it still cannot do is stated in its own output: a mock always says yes. It
proves the pane attempts the right objects in the right order. It cannot prove
Word honours them, which is what actually broke all three times.

Suite 5,730 across 186 files, QC 10/10.

## [2.31.3] — 2026-07-28 — Only the formula was being inserted

v2.31.2 routed formula-only reports to the rich insert path. The equations then
appeared — and nothing else did.

`mathToOoxml` builds a COMPLETE flat-OPC document, and inserting one of those in
the middle of a sequence breaks the anchor chain: the range it returns is not a
usable insertion point for the paragraphs that follow, so every line after the
first equation silently failed to land. Because the transfer function is the
FIRST line of the poles/zeros report, the visible result was that only the
formula was inserted.

The fix is the pattern this codebase already had. `buildDerivationOoxml` exists
precisely because interleaving does not work: it puts every paragraph, prose and
equation alike, into a **single** package that is inserted once, and that is how
Solve inserts its derivations. Consecutive prose and formula lines are now
batched into one such package, and only genuinely different objects — pictures
and tables — break the run.

**The batching is deliberately narrow.** Only a run that actually contains a
typesetting formula goes in as a package; a run without one still inserts as
plain paragraphs, one at a time, exactly as before. That matters because
`insertParagraph` inherits the paragraph style at the cursor while an OOXML
package brings its own — so beam, cross-sections, stats and every other
figure-bearing tool insert byte-for-byte as they did, and only the reports that
genuinely need an equation take the different path.

Parseability is checked before building, so an expression that will not typeset
falls back to the readable text the tool wrote rather than to its own math
source — and an unparseable formula does not force the run onto the package
path either.

Five gates added: that prose and equations are batched rather than inserted per
line, that the run is flushed before every non-text block and once at the end,
and that a math block contributes to the batch rather than inserting a package
of its own, that a run with no formula still inserts as plain paragraphs, and
that only a formula which actually typesets switches the run to the package
path. One earlier gate was rewritten — it asserted the old per-line
architecture, which was the bug.

Suite 5,728 across 186 files, QC 10/10.

## [2.31.2] — 2026-07-28 — The equation insert was written but never reached

v2.31.1 added real Word equations for transfer functions. It did not work for
three of the five tools that emit them — including *Control: poles, zeros &
stability*, the one that prompted the change.

The insert path takes a rich branch (tables, pictures, equations) only when the
result contains a block that needs it, and that guard still tested for
`matrix` or `plot` only. A report made of prose and formulas but **no figure**
therefore fell straight through to the plain-text insert and put the caret form
into the document — with the equation code fully written, fully tested, and
never executed. Poles/zeros/stability, PID and filter design were all affected;
step response and Bode escaped only because they happen to contain a plot.

This is the "engine built, pane cannot reach it" failure this repo has hit
before, one layer further in: the *tool* was reachable, the *block kind* was
not. The guard is now driven by an explicit `RICH_KINDS` list, and four new
gates pin it — that the list names every non-text kind in the block union, that
the guard is driven by the list rather than a hand-written condition, that the
three formula-only tools really emit a math block, and that the math branch
builds an equation via OOXML rather than a paragraph.

Found by checking before answering a question about whether it worked, rather
than by any test. Worth recording: a source-scanning routing gate proves a tool
calls its engine; it does not prove the pane's dispatch will act on what that
engine returns.

Suite 5,723 across 186 files, QC 10/10.

## [2.31.1] — 2026-07-28 — Two fixes from the first real Word session

Both of these came from opening the add-in in Word rather than from any
automated gate, which is exactly the gap those gates cannot cover.

**Figures were not aligning with each other.** A figure's caption and its image
shared one paragraph, so the picture began *after* the caption text on the same
line — and two figures whose captions differ in length therefore started at
different horizontal positions, even at identical pixel sizes. It showed up most
obviously on the two stacked Bode plots, where the frequency axes visibly failed
to line up. The caption now gets its own paragraph and the figure its own, so a
figure always starts at the margin. This affected **every** multi-figure insert
in the product, not only the control tools.

**Inserted formulas were ASCII, not formulas.** A transfer function arrived in
the document as `G(s) = [ s^3 + 3s^2 + 2s + 1 ] / [ s^2 + 2s + 5 ]` — carets and
square brackets, not an equation. This is the same complaint that got Solve's
derivations converted from flat text to OMML, and the same machinery fixes it:
report lines can now be marked as **formulas**, which the pane typesets in the
preview and Word receives as a **real, editable equation**. Applied to every
transfer function in the control tools and the filter designer.

Two details that mattered in doing it. A fractional coefficient has to be
**parenthesised** in math syntax, because `1/2s^2` parses as 1/(2s^2) — a
different polynomial that still looks plausible — so `polyToMath` emits
`(1/2)s^2`. And the designed filter's coefficients are rationalised doubles whose
exact numerators run to sixteen digits, so those are shown as **decimals**, which
is the honest presentation of a coefficient that was never rational.

An expression that will not parse falls back to readable text rather than
failing the whole insert.

Suite 5,718 across 186 files, QC 10/10.

## [2.31.0] — 2026-07-28 — Electronics, fluids breadth and biomedical: the plan is finished

Nine new tools across five new engines, taking Engineering to **36 calculators**
and completing every item on the build-out plan.

**Electronics.** Op-amp circuits with the limits the ideal model hides — the
*noise* gain sets the bandwidth (so a unity-gain inverting stage is half as fast
as it looks), slew rate is a separate large-signal limit whose full-power
bandwidth is usually far below the small-signal one, and an ideal integrator
saturates on its own offset unless there is a DC feedback path. Analogue filter
design for Butterworth and Chebyshev, computing the minimum order from a
specification and emitting a **transfer function** the control tools consume
directly. And truth tables with **Quine-McCluskey** minimisation, which does not
run out at five variables the way a Karnaugh map does.

**Fluids breadth.** Open-channel flow by Manning, where the Froude number rather
than the discharge is the answer — it decides whether the channel is controlled
from upstream or downstream, and crossing Fr = 1 unintentionally gives a
hydraulic jump. Pump NPSH and cavitation, which is a failure mode rather than an
efficiency loss and is entirely a suction-side problem. And compressible flow
with choking.

**Biomedical.** Haemodynamics, where the fourth-power dependence of resistance on
radius means a 20% narrowing more than doubles it; joint biomechanics, where the
joint reaction force is larger than either the load or the muscle force and is
the number usually left out; and a sampling check, because aliasing is the one
failure in the module that cannot be undone afterwards.

**THE BUG THIS RELEASE FOUND, WHICH WAS NOT IN THE NEW CODE.** Cross-checking a
designed filter against the existing control analysis produced a disagreement: a
perfectly stable 8th-order Butterworth was reported as *marginally stable*. The
cause was in `control.ts`. A companion matrix built from a badly scaled
polynomial is badly conditioned, and this filter's coefficients span 10¹⁶ — so
the QR iteration returned **six of its eight roots as exactly zero**, which reads
as poles on the imaginary axis. `polyRoots` now balances the polynomial first,
substituting s = λ·u with λ the geometric mean root magnitude so the coefficients
are comparable and the roots are O(1), then scales the roots back. This was a
latent defect affecting **every** control analysis of a realistically scaled
plant, and it was only visible because two independently built tools were made to
agree with each other.

A parser bug in the new logic module was caught the same way: stripping
whitespace before tokenising turned `A AND B` into `AANDB`, which the identifier
matcher swallowed whole. The tokeniser now skips whitespace rather than removing
it.

Suite 5,714 across 186 files, QC 10/10.

## [2.30.0] — 2026-07-28 — Fatigue and machine design

Engineering gains three fatigue tools, taking it to twenty-seven calculators.
This is the natural successor to the stress engine: you compute a stress state,
and the next question is whether the part survives 10⁷ cycles.

**Every result is framed as an order of magnitude.** Fatigue life scatter is
enormous — identical specimens from the same bar, on the same machine, routinely
differ by a factor of three, and a factor of ten is not remarkable. This is the
most over-trusted calculation in mechanical engineering, so every life carries
that caveat and no result is quoted as though it were precise.

**The endurance limit does not exist for most materials**, which is the single
most useful thing this module says. Steel has a genuine knee in its S-N curve.
Aluminium, copper and magnesium do not — the curve keeps falling for ever, so
there is no stress below which the part is safe, and infinite-life design is
unavailable at any stress. Choosing a non-ferrous material class gets that
stated rather than a false infinite life.

**The Langer yield check runs alongside every fatigue criterion.** None of
Goodman, Soderberg, Gerber or the ASME ellipse knows anything about static
yield, so a state with a high mean stress can sit comfortably inside the Goodman
line and still yield on the very first application of load. The governing —
smaller — factor of safety is what gets reported, along with which of the two
governs. All four criteria are shown together, because they disagree by a lot
and that spread is the honest uncertainty in the method rather than an
invitation to pick the friendliest one.

**Compressive mean stress is treated as zero, not negative.** It closes cracks
and helps, which is the entire principle behind shot peening — but feeding a
negative mean into Goodman produces a factor of safety *above* the fully
reversed one, overstating the benefit. Zero is the standard conservative
treatment.

**Finite life and Palmgren-Miner cumulative damage** over a load spectrum, with
the caveat that matters: Miner takes no account of load ORDER, and observed
damage sums at failure scatter between roughly 0.3 and 3 rather than landing on
1. A sum of 0.9 is not a pass.

**Two things the adversarial pass surfaced.** The size factor can legitimately
exceed 1 — the fit is normalised at the 7.62 mm rotating-beam specimen the
endurance data came from, so a smaller section really does do better — which
made the corrected limit exceed the uncorrected one and looked exactly like a
bug. It is left as the method gives it rather than clamped, since clamping would
invent a conservatism the method does not have, but it is now explained where it
happens. And a state with zero alternating stress and a compressive mean gave an
infinite fatigue factor of safety, which would have printed as "not finite"; it
is now named as no fatigue loading, with the governing factor falling back to
the finite yield check.

**No material strength table**, for the same reason there are no steam tables:
Sut and Sy move by a factor of three with heat treatment for the same alloy
designation, so a table of typical values would be wrong for the specific piece
of steel in front of the reader. They are on the drawing; they are asked for.
The reliability factor, by contrast, *is* derived rather than tabulated — it is
defined as 1 − 0.08·z, so inverting the normal CDF gives any reliability
instead of forcing a choice among five.

Suite 5,470 across 183 files, QC 10/10.

## [2.29.0] — 2026-07-28 — Thermodynamics, and a property table that was quietly breaking the first law

Engineering gains three thermodynamics tools, taking it to twenty-four
calculators: ideal-gas processes, air-standard power cycles, and vapour cycles
with a Carnot check.

**Temperature is absolute everywhere, and it is enforced.** Every efficiency and
entropy in this module is a ratio of absolute temperatures. The Carnot bound
between 500 °C and 20 °C is 62% computed correctly and **96%** if the numbers go
in as they are written — a plausible, publishable, completely wrong figure, and
the single most common error in the subject. Each tool takes the temperature
unit explicitly, converts before anything is divided, and refuses a temperature
at or below absolute zero rather than dividing by it.

**All five ideal-gas processes are one polytropic family**, P·Vⁿ = constant with
n = 1, 0, ∞ and k. Deriving the work integral once means the four named
processes cannot disagree with each other, and it makes the n = 1 singularity
explicit — the isothermal case is the *limit* of the general formula, written as
its own branch rather than left to evaluate 0/0. Every result carries a first-law
check.

**Otto, Diesel and Brayton**, each compared against the Carnot bound between its
own extremes. At the *same* compression ratio Otto beats Diesel, which surprises
people — and the tool explains why Diesel wins in practice anyway: there is no
fuel in the cylinder during compression, so there is nothing to knock, so a much
higher compression ratio is available. Brayton efficiency depends only on
pressure ratio, and the pressure ratio that maximises *work per unit mass* is not
the one that maximises efficiency, which is why real turbines are sized where
they are.

**No steam tables, deliberately.** Rankine and vapour-compression cycles are
computed from enthalpies the reader looks up in their own property tables. A
saturated-water table reconstructed from memory would be plausible,
unverifiable, and wrong in the third digit somewhere nobody would check — and
this product's rule is that all data must be real. Doing the cycle arithmetic,
the back-work ratio and the energy balance on the reader's own data is honest and
is the workflow they already have.

**The bug the oracle tests found, which is the interesting one.** An isentropic
expansion was coming back with a non-zero heat — an apparent first-law violation
in the one process where Q is zero by construction. The cause was not the
algorithm: it was the **property table**. Air's usual handbook values cp = 1005,
cv = 718, R = 287, k = 1.4 are each rounded independently and are therefore
mutually inconsistent — R/(k−1) is 717.5, not 718. The work integral uses R and
k while the internal-energy change uses cv, so the two disagreed by 0.07% and the
result looked like physics. The table now stores only **cp and cv** and derives
R = cp − cv and k = cp/cv, which makes every identity exact by construction at
the cost of k reading 1.3997 for air rather than the rounded 1.4. That is the
better trade: the third decimal of k is not physically meaningful, and a
self-inconsistent property table produces errors that are indistinguishable from
real results.

The adversarial pass verifies Q = ΔU + W over 1,500 randomised combinations of
gas, process and end state, and checks that no cycle beats its own Carnot bound
across every gas and every ratio the module accepts.

Suite 5,385 across 181 files, QC 10/10.

## [2.28.0] — 2026-07-28 — Vibration, and the three results everyone gets wrong

Engineering gains three vibration tools, taking it to twenty-one calculators.
The module is built around the three results in this subject that are
counter-intuitive enough that getting them wrong is the normal outcome, and each
one is computed and stated rather than left to be remembered.

**Resonance is not at r = 1.** The magnification of a damped system peaks at
r = √(1−2ζ²), always *below* the natural frequency — and for ζ ≥ 1/√2 = 0.707
there is **no peak at all**: the response falls monotonically and no forcing
frequency can resonate the system. "Resonance at ω = ωₙ" is the undamped special
case, taught first and then never unlearned.

**Vibration isolation only begins above r = √2.** Transmissibility is exactly 1
at √2 *for every damping ratio*, and above 1 below it. So a mount that is not
soft enough does not isolate a little — it **amplifies**, and more force reaches
the foundation than if the machine had been bolted down. This is a design
failure that looks like a design.

**Damping helps below √2 and hurts above it.** More damping lowers the resonant
peak, which is why you want it while passing through resonance on run-up, and it
*raises* transmissibility in the isolation region, because the damper is itself
a path for force. "More damping is safer" is false in exactly the region
isolators are designed to work in.

**Free response and damping** — ωₙ, ζ, ωd, logarithmic decrement, and a plot.
Each damping regime uses its **own** closed form rather than one formula with a
tolerance: the critically damped solution is not the underdamped one evaluated
at ζ = 1, which divides by a damped frequency of zero. Two measured peak
amplitudes estimate ζ from a recorded trace, using the exact relation
ζ = δ/√(4π² + δ²) rather than the light-damping approximation δ/2π, which is
wrong by more than 1% above ζ ≈ 0.1. A trace whose amplitude *grows* is refused
and named: that is not a damped system, it is being driven or it is
self-excited.

**Natural frequencies and mode shapes** — from a chain of masses and springs, or
from the mass and stiffness matrices directly. Solved as a **symmetric**
generalised eigenproblem, K φ = ω²M φ, via a Cholesky transform to
L⁻¹KL⁻ᵀ. The lazy route — forming M⁻¹K and handing it to a general eigenvalue
routine — produces a matrix that is *not* symmetric even though the problem is,
discarding the guarantee that the eigenvalues are real and permitting complex
natural frequencies for a perfectly ordinary structure. Mode shapes come back
mass-normalised with a fixed sign convention. A **rigid-body mode** at zero
frequency is reported as the real feature it is, and a mass matrix that is not
positive definite is refused as unphysical — the Cholesky failure and the
modelling error are the same event.

**Testing.** The modal solver is checked against algebraic eigenvalues where
they exist — a one-end-grounded two-mass chain has eigenvalues (3∓√5)/2 · k/m —
and the adversarial pass substitutes **every** eigenpair back into K φ = ω²M φ
across five systems, so nothing about the transform, the normalisation or the
ordering can hide a wrong eigenvector. Orthogonality through the mass matrix is
verified on deliberately badly scaled systems (stiffnesses spanning six orders
of magnitude, which is a real modelling situation rather than a contrived one).

One test-side fix worth recording: an adversarial check was calling `expect()`
14,000 times inside a loop, which measured Jest rather than the engine and then
flaked against its own timing budget under parallel load. Failures are now
collected and asserted once — the same check, honest accounting.

Suite 5,291 across 179 files, QC 10/10.

## [2.27.0] — 2026-07-28 — Pharmacokinetics: where the engineering and life-science halves meet

Engineering gains three PK tools, taking it to eighteen calculators. This is the
one place the two halves of the product touch — the existing dose-response,
IC50 and enzyme-kinetics tools describe what a drug does at a concentration, and
these describe what concentration the patient actually has.

**Built on clearance and volume**, not on half-life. That is not a style choice:
CL and Vd are the physiologically independent quantities and half-life is a
consequence of both (t½ = ln2·Vd/CL). A renal-failure patient has a long
half-life because clearance fell; an obese patient can have one at completely
normal clearance because volume rose. Building on half-life hides that.

**Dose and concentration curve** — IV bolus, infusion or oral, with Cmax, Tmax,
AUC and a plot. AUC = Dose/CL, so total exposure is set by clearance alone and
not by volume; the infusion plateau is rate/CL, and volume only sets how quickly
you get there.

**Steady state and loading dose** — accumulation ratio, peak, trough, average and
fluctuation. The average depends **only** on dose rate and clearance, so halving
both the dose and the interval leaves it exactly where it was and only narrows
the swing. Time to steady state depends **only** on half-life, and a bigger
maintenance dose does not shorten it — which is what a loading dose is for, and
why the loading dose comes from the volume while the maintenance dose comes from
the clearance.

**Non-compartmental analysis** of real measured data — paste time/concentration
pairs and get λz, half-life, AUC, clearance, volume and MRT. Two things it does
that calculators usually skip: the terminal window is **chosen**, by trying every
window of at least three points and keeping the best *adjusted* R² (adjusted,
because plain R² improves automatically as points are added); and the
**percentage of AUC that came from extrapolation** is reported, because above
about 20% the study simply did not follow the drug long enough and every derived
parameter rests on an assumed exponential tail rather than on measurement.

**Flip-flop kinetics are detected**, which is the trap this module partly exists
for. Everyone reads an oral curve's terminal slope as elimination, and that is
only true when absorption is faster. When it is not — depot injections,
modified-release formulations, poorly soluble drugs — the terminal slope is the
**absorption** rate constant, the half-life read off it is the absorption
half-life, and everything derived from it is wrong. The curve looks completely
normal either way. Oral data is also reported as CL/F and Vz/F rather than
"clearance": without an IV reference bioavailability cannot be separated, and a
drug with 50% F would look as though it clears twice as fast as it does.

**What the adversarial pass found.** On an ultra-short-half-life drug —
adenosine is a real one — the trough underflows to exactly zero between doses and
the peak-to-trough ratio became `Infinity`, which would have printed as "not
finite" in a document. Infinity is not the answer there; the useful and true
statement is that the drug is completely eliminated before the next dose, so the
ratio is now reported as undefined with that explanation.

The routing gate also earned its keep: it flagged the PK fields as unread because
they went through a shared helper, so the wiring was invisible to it. Rather than
weaken the gate a second time, the reads were inlined — the gate's entire value
is that it can see each field being used.

Suite 5,192 across 177 files, QC 10/10.

## [2.26.0] — 2026-07-28 — Control systems: the course that was missing entirely

Engineering had no transfer functions at all — the one subject required across
mechanical, electrical, chemical *and* biomedical engineering. It has four new
tools, built on machinery that was already here: the exact rational arithmetic
from the CAS, the Francis QR eigenvalue solver from the linear algebra core, and
the plotting used by the Bode sweep in circuits.

**Poles, zeros and stability**, with the **exact** Routh-Hurwitz array. Routh is
a tabulation of differences of products, so it is precisely the algorithm where
a coefficient that is 1e-17 instead of 0 flips the verdict from stable to
unstable — and floating point is least reliable exactly at the stability
boundary, which is the only place anyone runs it. Over rationals it is exact.

**Stability is decided twice, and the two answers are compared.** The
right-half-plane pole count comes once from the exact tabulation and once from
the poles as eigenvalues of the companion matrix. These share no code and no
arithmetic, so agreement is real evidence rather than the same mistake twice.
**When they disagree, both are reported and neither is chosen** — a disagreement
means a pole sits so close to the imaginary axis that its computed real part is
untrustworthy, which is the most useful thing to be told and exactly the case a
single method answers confidently and wrongly.

**Step and impulse response** with damping ratio, natural frequency, overshoot,
rise, peak and settling time, plotted. For a genuine second-order system these
are exact identities; above that they come from the dominant pole pair and the
result *says so*, and says it louder when the next pole is less than five times
faster and the approximation stops holding. A zero near the dominant poles is
flagged, because the standard formulas know nothing about zeros and a nearby one
increases overshoot substantially.

**Frequency response and margins** — Bode magnitude and phase, gain and phase
margin. A margin that does not exist is reported as not existing: a first-order
lag's phase never reaches −180°, so its gain margin is infinite and any finite
number is wrong, including the value at the edge of whatever range was swept.

**PID and closed loop** — controller in series, loop closed, closed-loop poles,
stability, margins and transient. A right-half-plane zero is called out as
non-minimum-phase: the step response goes the *wrong way* first, and more gain
makes it worse rather than better.

**Three defects the tests found.** An oracle test that knew the gain margin
algebraically caught the margin bisection refining on the **unwrapped** phase —
evaluating one frequency in isolation restarts the unwrapping, so it read +179.9
where the swept value was −180.1 and walked away from the crossing; it now
refines on Im(G) = 0, which locates the same point with no phase bookkeeping to
get wrong. A P-only controller was reported *marginally stable*, because
Kp written as (Kd·s² + Kp·s)/s leaves a pole at the origin that the numerator's
own zero cancels; the cancellation is now done rather than left to produce a
wrong verdict. And the adversarial pass timed a step response at **2.4 seconds**
— the sub-step cap bounded memory but not total work, which in a pane that
recomputes per keystroke is a hang; a total-step budget now bounds the time.

Suite 5,083 across 175 files, QC 10/10.

## [2.25.0] — 2026-07-28 — One unit contract across Engineering, and the 10^12 trap it was hiding

Engineering had drifted into three different unit contracts. Beam, truss and
cross-sections said "consistent units, nothing converts". Column, torsion, pipe
flow and the heat tools said "strict SI" — **and then accepted whatever was
typed without checking**, which is the half that mattered. A declaration
enforces nothing.

**The trap that produced was inside the product.** The cross-section tool
reports I in mm⁴, because that is what every section table in the world prints.
The column tool wanted m⁴. So the single most natural workflow in the whole
section — size a section, paste its I into the buckling check — was wrong by a
factor of 10¹², and the answer looked entirely plausible. Nothing anywhere said
a word.

**The rule now, stated once and enforced by a test:** a tool converts units
unless it is dimensionally homogeneous (every input is the same kind of
quantity, so the answer comes back in whatever went in) or it computes over
exact rationals (where a conversion is a floating-point multiply that would
destroy the exactness that is the whole reason the engine exists). Either way
**every tool declares which branch it is on**, in its result.

So column, torsion, pipe flow, cross-sections and both heat tools now read every
field through the unit layer. A bare number is read in the unit the field names,
a unit you write is converted and the conversion is **reported back to you**,
and a unit of the wrong quantity is **refused by name** rather than silently
dropped. `200 GPa`, `1e6 mm^4`, `50 ksi`, `68 °F`, `15.7 L/s` and
`Mineral wool, 50 mm` all now work. Beam and truss deliberately still do not
convert, and now say why. The cross-section result additionally tells you to
carry A and I to the column tool **with their units**, which is where the trap
used to be.

**Parenthesised compound units are now accepted** — `W/(m^2*K)`, `kJ/(kg*K)` —
because that is how every engineering text writes a heat transfer coefficient
and how anyone will type it. It used to be rejected as "not a unit this
recognises", which reads as a typo rather than as unsupported notation. A
*nested* division inside a group (`a/(b/c)`) is refused rather than guessed at,
because the two readings differ by c² and picking one silently would be a wrong
answer wearing a unit.

**Why this could not regress anything.** Every one of those fields used to be
read with `Number()`. `parseMeasured` returns a bare number in the target unit
untouched, so a user who types plain numbers — the old contract — gets byte-identical
results. That invariant is now pinned directly across all 14 Engineering target
units rather than left as an argument, because if it ever broke, every
Engineering answer would change silently and no oracle test would notice: they
all pass bare numbers too.

Full suite green at 4,952 tests with no behaviour change to any existing case,
plus a 32-test adversarial pass on the parser covering half-typed input,
bracket soup, 50,000-character tokens and catastrophic-backtracking probes —
unit parsing runs on every keystroke, and a parser that hangs there is a frozen
Word, not a slow one.

## [2.24.0] — 2026-07-28 — Engineering becomes a full bench: stress, trusses, buckling, thermofluids

Engineering had four tools — beam, cross-section, DC circuit, AC circuit. It has
eleven. The new seven are the rest of an undergraduate engineering course, and
each one is built around the thing that is most often got wrong rather than
around the formula that is easiest to type.

**Stress state.** Principal stresses, principal angle, Mohr's circle, von Mises
and Tresca, and the factor of safety against a yield strength. It reports the
**absolute** maximum shear as well as the in-plane one and says when they differ:
for a biaxial state the zero out-of-plane principal stress lies outside the
in-plane pair, so the in-plane circle understates the shear the material actually
sees — σ1 = 100, σ2 = 60 gives 20 in-plane and 50 in truth. Three-dimensional
states are solved in closed form from the tensor invariants, not by iteration.

**Truss analysis** by the method of joints, **solved exactly**. The trick that
makes that possible is a change of unknown: solving for the force *per unit
length* rather than the axial force keeps every matrix coefficient rational, so
the whole equilibrium solve is exact and the single square root happens once per
member at the point of reporting. Reactions never touch it and are exact always.
Zero-force members are therefore detected as exact zeros rather than as values
below a tolerance. A mechanism, a statically indeterminate truss, and a
**critical form** — where the member count balances and the structure still
collapses, which is precisely what member counting cannot catch — are each named
rather than given a confident wrong number.

**Column buckling** with the Johnson parabola, not Euler alone. Euler's load has
no upper bound as the column gets shorter, so for a stocky column it reports a
load that would need a stress above yield and the column squashes long before it
buckles. Quoting that figure by itself is unconservative in exactly the regime
where being wrong matters. The transition slenderness is computed and the
governing curve named.

**Shaft torsion** — polar second moment, peak and bore shear stress, angle of
twist. Circular sections only, and that is a deliberate refusal: τ = Tr/J is a
theorem for a circle and simply false for a rectangle, where the section warps
and the peak shear moves.

**Pipe flow.** Reynolds number, friction factor from **Colebrook-White solved
rather than approximated** (Swamee-Jain seeds a fixed-point iteration that is
hard-capped and convergence-checked), Darcy-Weisbach head loss, minor losses,
wall shear and pump power. Laminar flow uses f = 64/Re and says the roughness was
ignored, because a laminar flow does not feel the wall. The transition band
2300 < Re < 4000 returns a number **and says it is unreliable**, which is the
honest position: there is no correlation there worth trusting.

**Composite walls and pipe insulation** as a thermal resistance chain, with every
interface temperature and the controlling layer. For a cylinder it reports the
**critical radius**: on a thin pipe, insulation below k/h increases the exposed
area faster than it adds resistance and the pipe loses *more* heat than bare.
That is the one place in the subject where doing the obvious thing makes the
problem worse, so it is computed rather than left to be discovered.

**Heat exchanger sizing** by LMTD, counter or parallel flow. Equal terminal
differences are handled as the removable singularity they are — a balanced
counterflow exchanger is an ordinary design, not a degenerate one, and the naive
formula returns NaN for it. A temperature cross is normal in counterflow and
impossible in parallel flow, and it says so either way.

**What the adversarial pass found.** Three overflow defects that all 93 oracle
tests missed, every one a finite input producing a NaN or an Infinity that would
have reached the document. The characteristic cubic formed I1³ and overflowed for
a stress state written in pascals; von Mises squared its differences and lost an
answer that fit in a double comfortably; the polar second moment is a fourth
power and underflowed to zero, making the shear stress infinite. All three are
now normalised before the arithmetic that overflows, with a final guard that
refuses rather than reports a non-number.

**Routing is now gated.** A new test asserts that every tool in the Engineering
registry is reachable from the pane and calls its engine — the failure mode that
once left three fully-tested Solve features with no way to run them.

**Inserting no longer destroys your selection.** The shared text-insert path used
`InsertLocation.replace`, so a user with a word selected who clicked "Insert MS
data" lost that word. It is the insert path for mass spec, spectra, compound
name, properties, stats, finance, assay, solve, analyze, cross-references and SEQ
ID refs — 15 call sites — and every other insert in the product appends. It now
appends too. While there: renamed from `insertDnaText` (it has not been DNA-only
for a long time), given the in-progress status every other insert path had, and
its re-entrancy guard now says something instead of dropping the second click in
silence.

**`log()` meant different things in different tools.** Three expression
evaluators had drifted: `log` was the natural log in Plot and base 10 in Stats
and Solve, so `log(100)` was 4.605 on a chart and 2 in an uncertainty
calculation. `mod` was JS's remainder in Plot and true modulo in Stats, so
`mod(-7, 3)` was -1 and 2. A user who typed one formula in Uncertainty
propagation and the same formula in Plot to visualise it got two different
answers, silently. Aligned on the majority and the spreadsheet convention: `log`
is base 10, `ln` is natural, `mod` carries the sign of the divisor. This CHANGES
Plot for anyone who typed `log` meaning natural, which is why `ln` is still there
— an inconsistency this quiet is worse than a documented change.

**Stats no longer changes n without saying so.** `statList` drops anything
non-numeric, so "N/A", "ND", "<0.01" and a pasted header row silently vanished: a
column with two bad cells gave a result on n=5 presented exactly like one on
n=7, and the two-sample output prints t(df) but never n. Dropped entries are now
counted and named, in the result text so the note travels into the document with
the number it qualifies. The check only fires on a MOSTLY numeric field, so
two-way ANOVA's labelled "lo x 12" rows do not trip it.

**A molecular formula says when it guessed the isomer.** C2H6O is ethanol or
dimethyl ether; C6H12O6 is glucose, fructose, galactose and a dozen more. The
library resolves to the most common compound and has always returned a `source`
flag SPECIFICALLY so the UI could say so — uses of that flag in the pane before
today: zero. Everything downstream, properties, pKa, NMR, mass spec and the
inserted picture, was confidently about a molecule the user may not have meant.

16 new tests pinning that the three evaluators agree. Suite 3191.

## [1.95.0] — 2026-07-26 — Four patent-tool checks that reported things that were not true

Every one of these produced confident, wrong output in a practitioner's document,
and each is the kind of thing a drafter notices once and then stops trusting the
tool over.

**Caption detection never matched in a real Word document.**
`extractCaptionNumbers` anchored on `(?:^|
)`, but Word's `body.text` delimits
paragraphs with a carriage return. So on any real document it returned nothing:
"Check captions" ALWAYS reported clean — including when captions were genuinely
duplicated or skipped — and the Audit reported every figure reference as having
no caption. The anchor now accepts CR, LF and VT, matching how toa.ts:359 already
split text. The codebase knew; this one function did not.

**Numeral gaps invented dozens of omissions.** The gap walk inferred ONE global
step and ran from the lowest numeral to the highest, so a spec numbered 10/12/14
for FIG. 1 and 100/102/104 for FIG. 2 — the commonest patent convention there is
— reported 42 skipped numerals that were never meant to exist. Gaps are now
reported only within a contiguous run; a jump from 14 to 100 is a new series.

**Citation years were read as reference numerals.** The callout pattern
`\((\d+)[A-Za-z']?\)` has no context filter, so "See Alice, 573 U.S. 208
(2014). The steps are: (1) forming, (2) etching" yielded (2014), (1) and (2) as
callouts, which the Audit then reported as "called out but undefined".
Four-digit years are excluded, and — when the numeral table is available — so is
enumeration below a scheme that starts at 10 or above. A genuinely undefined
callout is still reported, which is the tool's actual job.

**Bare "Rule N" fabricated Federal Rules entries.** Any "Rule 132" in a document
that mentioned Fed. R. Civ. P. anywhere became "Fed. R. Civ. P. 132" in the Table
of Authorities. Patent practitioners write "a Rule 132 declaration", "Rule 131
swear-behind" and "Local Rule 7.1" constantly, so a district-court patent brief
produced a table listing authorities the drafter never cited — in a document they
sign. USPTO practice rules (130-132) are excluded, and a qualifier before the
word "Rule" now blocks the civil-rule reading.

Two of my own fixes over-filtered and the tests caught both: the district
abbreviation pattern made its periods optional, so `n\.?d\.?` matched the "nd"
in "and" and silently dropped a legitimate "Rule 36"; and the callout range's
lower margin still admitted "(1)" and "(2)".

21 new tests, suite 3175.

## [1.94.0] — 2026-07-26 — FFT filtering, and two bugs a punctuation mark was causing

**FFT filter (Analyze).** `fftfilter.ts` — 181 lines of low/high/band-pass with
written caveats for Gibbs ringing, circular wraparound and Nyquist — had zero
references outside its own test. The FFT tool could show you noise and do nothing
about it, so the workflow an engineer opens MATLAB for dead-ended at the
spectrum. Low, high, band-pass and band-stop, with a raised-cosine transition
rather than a brick wall, plotted against the original signal. Verified in the
real pane: the default 4 Hz + 24 Hz signal, low-passed at 8 Hz, comes back as a
clean 4 Hz sine (0, 0.3827, 0.7071, 0.9239, 1, ...).

**Two pre-existing bugs, both caused by an em dash.** `formatNum()` renders
Infinity/NaN as "—" (linalg.ts:73), and the Analyze reader blocks insertion when
the result text contains one. That is a whole-text scan, so an em dash used as
ordinary PUNCTUATION silently disabled the Insert button *and* suppressed the
rich preview, dropping the reader to the plain-text branch so plots vanished.

  - The Nelder-Mead optimizer's non-converged note contained one, so an
    optimisation that did not converge could not be inserted — no button, no
    explanation. It is a legitimate result and is now insertable.
  - The new FFT filter tripped it twice, in its own prose and via the ten em
    dashes inside fftfilter.ts's caveats. The caveats are kept verbatim except
    for the dash, which is swapped rather than the wording changed.

The guard now documents the hazard, and `analyzeCalcText.test.ts` pins it so the
next calculator to use an em dash fails a test instead of quietly losing its
Insert button.

**A reachability gate.** `reachability.test.ts` walks the import graph from both
entry points and fails on any library module nothing can reach. It follows
DYNAMIC imports, because ppt.ts is reached only that way and a static-only walk
calls it dead — a mistake already made once during the audit. It also pins the
six exports the evaluation found orphaned INSIDE live modules, which
module-level reachability cannot see: `fitInhibition` lived in assay.ts, which
was very much alive, and was still unreachable.

`jcamp.ts` remains deliberately unwired, with the reason recorded in the gate's
allowlist: it needs a file input and a decision about overlaying a measured trace
on a predicted spectrum, which is a design question rather than plumbing.

16 new tests, suite 3154.

## [1.93.0] — 2026-07-26 — Four finished tools that no user could reach

Harvesting dead code found by the product evaluation: modules written, tested,
shipped in every bundle, and wired to nothing.

**Tukey HSD (Stats).** `tukey.ts` — 273 lines with memoised studentized-range
critical values and three written caveats — had zero references outside its own
test. So ANOVA in the pane had no post-hoc test at all, and a user comparing
three groups had to fall back on repeated t-tests: the exact error that module's
own header warns inflates the family-wise error rate to ~40% at k = 5. It now
sits beside One-way ANOVA, reports the omnibus F alongside the pairwise table so
a post-hoc is not read out of a non-significant ANOVA, and carries the module's
own family-wise warning.

**Inhibition mode fit (Bio/Assay).** `fitInhibition` was dead, and with it the
four model functions only it calls — competitive, uncompetitive, non-competitive
and mixed. The Cheng-Prusoff panel told users to "determine the mode from a
Lineweaver-Burk or a full inhibition fit before converting an IC50", advice the
product made impossible to follow. Reports Vmax, Km, Ki (and Ki-prime for mixed)
with standard errors, and states plainly that the MODE is the user's choice, not
the fit's finding.

**Linearized kinetics (Bio/Assay).** `lineweaverBurk` and `eadieHofstee` were
dead. All three transforms are now shown together as a diagnostic, with the
nonlinear fit kept authoritative — each linearization reweights the errors
differently, so their spread is the signal, not any one of them.

**Buffer ratio for a target pH (Bio/Assay).** `bufferRatioForPh` was dead. This
is the inverse of the Henderson-Hasselbalch entry and the direction a bench
scientist actually needs. Warns when the target is more than a pH unit from the
pKa, where the buffer has little capacity.

**Also fixed, found while wiring the above: the One-way ANOVA default never
worked.** `statGroups()` splits on a BLANK line or a semicolon, but the shipped
default was "1 2 3
4 5 6
7 8 9" — single newlines — so it collapsed to one
group of nine and the calculator opened showing "Enter at least two groups"
instead of a worked example. Confirmed in the real pane before changing it. Both
that default and the new Tukey one now use blank lines, and
`statCalcDefaults.test.ts` pins the property for every Stats calculator that
parses groups.

Two corrections to the evaluation's dead-code list: `hanesWoolf` is NOT dead —
`fitMichaelisMenten` uses it for its initial guess — and `substrateInhibitionV`
is left unwired on purpose, being a model equation with no fitter. Exposing it
would mean writing one or shipping a "predict v from parameters you already
know" box.

Every calculator was verified by driving the real built bundle headlessly and
checking the output against independently computed values. 5 new tests, suite
3138.

## [1.92.0] — 2026-07-26 — Truthfulness and gating

Four things the product said about itself, or relied on, that were not true.

**The online lookup now asks per NAME, not once per session.** Consent was a
single boolean: approving one name silently authorised every later lookup, so a
user who approved "benzene" could then type a confidential client compound and
have it leave the machine with no prompt — while `legal.html`, `science.html` and
the manual all promised it "asks every time". Consent is now keyed by the
normalised name. Nothing new ever leaves unasked; re-checking a name already sent
does not nag, because nothing new leaves. The three pages now describe exactly
that instead of a stronger claim the code did not honour.

**GitHub Pages no longer deploys past a red build.** `pages.yml` ran `npm ci &&
npm run build` and published. CI ran in a separate, concurrent workflow whose
result nothing consumed — so a commit failing `npm test`, the compound-dictionary
check or manifest validation still reached production, because webpack only fails
on type errors. Pages serves the installable manifest.xml and version.json, so
the site and the shipped add-in are one artefact. `deploy` now needs a `gate`
job. `ci.yml` drops to pull requests, since the same checks would otherwise race
the ones that actually block publication.

**A skipped gate is no longer reported as a pass.** `render-check.js` and
`check-landing-overlap.js` exited 0 with a SKIP message when no Chromium was
found, and `qc.ps1` recorded that as PASS and printed "ALL AUTOMATED QC PASSED" —
having checked neither the rendered pane nor the laid-out page, which are the two
bug classes that keep shipping. They now exit 2, and qc has a third state:
SKIPPED, yellow, exit 3, "QC INCOMPLETE". The same change closes a latent hazard
where a command that failed to LAUNCH inherited the previous step's exit code.

**SECURITY.md described a program that does not exist.** It claimed "no external
API calls", said office.js was the only network request, and credited a CI source
scan that was never written. It now names all three destinations, what each
carries, and what consent applies — and `networkSurface.test.ts` makes the claim
enforceable: it scans the source for fetch/XHR/WebSocket/sendBeacon/EventSource
and fails on any call site or host outside an explicit allowlist. XML namespace
URIs are excluded by name, having been verified as identifiers rather than
addresses.

6 new tests. Suite 3133.

## [1.91.0] — 2026-07-26 — Solve: typeset reasoning, and room to type a word problem

Both reported from real use of the v1.90.0 word-problem work.

**The reasoning is now typeset.** The derivation was ASCII — "P(k) = (k/100) x
R(k)", "k^2 + k - 100 = 0" — sitting in a product whose Math tool renders real
notation. Each step now carries its formula in the pane's math DSL and is
rendered through the same `mathToHtml` the Math tool uses, so the working shows
a true fraction for k/100, an n-ary product with its limits above and below, a
superscript on k squared, and sqrt(401) under a radical. The `Equation:` line is
typeset the same way rather than being the one leftover ASCII line.

Plain text and typeset formulae come from one source in `solveShares`, so they
cannot drift, and the plain form is still what gets inserted into the document —
a Word paragraph should not carry markup it cannot render.

**The input is a textarea, five rows tall for word problems.** It was a
single-line `<input>`, so a paragraph-long problem scrolled sideways and could
not be read back or edited. Equations, derivatives and integrands keep one row.

Verified by driving the real built bundle in a headless harness — selecting the
tool, choosing the word-problem kind, typing the pie problem, and reading the
rendered pane back — rather than by inspecting the markup.

3 new tests, including one that parses every emitted formula to prove the
renderer can actually typeset it: an unparseable DSL string falls back to plain
segments and would look subtly wrong rather than failing. Suite 3127.

## [1.90.0] — 2026-07-26 — Solve: successive-share word problems

Reported from real use. Typing

    "A pie is divided to 100 guest. Guest 1 gets 1%, guest 2 gets 2% of
     what's left, and so on. Who gets the largest piece of pie?"

produced nothing — no answer, no explanation, no way to insert anything. It is a
recurrence rather than a pattern that maps onto one equation, so none of the
three existing templates could touch it.

`src/lib/sharesequence.ts` models the class properly: N recipients in order,
recipient k taking k% either of what remains or of the original, answering "who
gets the most / least", "how much does recipient k get", and "how much is left".

The answer is counter-intuitive — guest 10, not guest 1 and not guest 100 —
because k rises faster than the remainder falls until it doesn't. So the tool
shows the reasoning rather than just the number:

    P(k) = (k/100) x R(k),  R(k) = prod_{i<k} (1 - i/100)
    P(k+1)/P(k) = ((k+1)/k)(1 - k/100) = 1  when  k^2 + k - 100 = 0
    k* = (-1 + sqrt(401))/2 = 9.5125, so shares rise then fall, peaking at k = 10
    guest 9 = 6.2125%, guest 10 = 6.2816%, guest 11 = 6.2187%

Answer, derivation and insert all work through the existing Solve paths.
Tried before the percentage template, which would otherwise match on the "1%"
and answer a much smaller question than the one asked.

Also fixed in Solve: an equation with more than one unknown reported "No real
roots found.", which is a false statement about the equation — `F = m*a` has
roots, the solver just cannot isolate one of three variables. It now says so and
suggests giving the other variables values.

20 new tests, with every expected share checked against an independent
simulation rather than against the implementation. Suite 3124.

## [1.89.0] — 2026-07-26 — Fix: three defects that put wrong numbers in documents

All three were found by a full product evaluation and verified by executing the
libraries, not by reading them.

**FASTA headers were folded into the sequence.** `cleanSequence()` and
`cleanDna()` stripped only NON-letters, so every letter of a FASTA header
survived into the sequence — while the pane invites exactly that paste and
promises "headers, line numbers and whitespace are stripped". A normal NCBI
header prepended 35 spurious residues, and in Align it pushed `guessKind()` over
its threshold so a NUCLEOTIDE pair was scored with BLOSUM62. Measured on two real
ACTB orthologue fragments: 96.5% identity became 86.4%. In DNA mode a 12 nt
insert became 37 nt, shifting GC% from 33.3 to 30.4 and corrupting reverse
complement, translation, ORFs, restriction sites and Tm — while the "ignored
invalid characters" line made the header look handled, because its non-IUPAC
letters were listed there. Both now drop ">" headers and legacy ";" comments
first. A multi-record paste is counted and the pane warns rather than silently
analysing a chimera.

**A supplied /codon_start was written to the ST.26 XML and then ignored.**
`translateCds` always read from base 1, so a CDS carrying /codon_start=2 was
emitted beside the frame-1 product. A listing whose translation contradicts its
own reading frame is a substantive defect in a filed application.

**Reverse-strand restriction cuts used the wrong offset.** On a reverse-
orientation site the enzyme is bound the other way round, so ITS bottom-strand
cut is the one landing on the molecule's top strand — the code used cutTop where
it needs cutBottom. Every reverse hit was out by the overhang length, inverted
for the 3'-overhang cutters (BsgI, BpmI, MmeI), and every Golden Gate enzyme was
affected: reverse BsaI at position 11 reported a cut at 9 when it is at 5.
Separately the 1-based coordinate was wrapped modulo the length regardless of
topology, so a cut past the end of a LINEAR molecule was reported as an in-range
position that does not exist — MboI at position 1 of a 24 nt linear sequence
claimed a cut at 24. `cutPosition` is now `number | null`.

31 new tests across three regression suites. Suite 3104.

## [1.88.0] — 2026-07-26 — Fix: inserted figures were sized by pixel count

Word lays an inserted PNG out at its pixel count interpreted at 96 dpi. Any
figure rasterised above 1x and inserted *without* an explicit size therefore came
out physically larger rather than sharper.

**Spectra and Sequence Map rasterised at 2x and set no size.** Every predicted
spectrum and every sequence map inserted up to and including v1.87.0 arrived at
**twice its intended width**. Table -> Chart was the only call site doing it
correctly, converting back to points with `width = px * 0.75`.

All eleven Word figure insertions now share `renderFigurePng()` and
`sizeFigure()`: supersample at 4x, then pin the picture to its natural physical
size so the extra pixels become resolution. Spectra and Sequence Map return to
their intended width; the nine sites that were rasterising at 1x keep the size
they always had and gain roughly 4x the resolution.

`figureScale()` degrades the factor for large figures to stay inside an 8 MP
budget, so a wide sequence map or a dense flowchart cannot allocate a canvas big
enough to stall the pane. It never returns 0 — an invisible figure would be worse
than an unsharp one.

The PowerPoint export path is deliberately unchanged: its 3x rasterisation never
enters a Word document and is embedded at explicit slide dimensions, where 3x is
already correct.

The arithmetic moved to `src/lib/figures.ts` so it could be tested at all —
`taskpane.ts` imports Office and cannot be reached from jest. Nine new tests
cover the conversion, the budget, monotonic degradation and the zero/NaN guards.

## [1.65.2] — 2026-07-15 — Fix: arginine's pKa net charge was wrong by 100%

Found by a full-product audit. A shipped **wrong answer**, not a missing caveat.

`pka.ts` had no guanidine case. Arginine's guanidine has three nitrogens: the
`=N` was skipped as an imine and the other two fell through to the catch-all
"aliphatic amine" branch — so arginine reported **three** amine sites at 10.6.
Wrong three ways at once: wrong group, wrong pKa (10.6 vs ~12.5), and
triple-counted into the headline number — **net charge at pH 7.4 = +2.00 against
a true +1.0.**

Guanidine is the most basic group in biochemistry and arginine is one of the
twenty amino acids; any peptide containing it got a substantially wrong charge.
Histidine was wrong too: imidazole read as pyridine (5.2 vs ~6.0) — and imidazole
is the only side chain that titrates near physiological pH.

**Fix:** a pass before the per-atom walk claims whole-group bases and marks their
nitrogens consumed, so they can't be re-counted. Guanidine → 12.5, amidine →
11.6, imidazole → 6.0 (distinguished from pyridine by ring size + N count), with
a urea/acylguanidine guard.

Verified including that it doesn't overreach — lysine unchanged, pyridine still
pyridine, urea claims no guanidine.

**Why it survived, which is the more useful finding:** `pka.test.ts` tested
*detection* thoroughly but **never asserted a single pKa value** against
literature, and tested neither arginine nor histidine. Detection tests cannot
catch a group being silently misrouted to a wrong label with a plausible number
attached. Added 7 value tests, including the net charge the user actually sees.

Suite: **2,041 tests** (was 2,034).

## [1.65.1] — 2026-07-15 — Phase 5 adversarial bug test

The standing rule: nothing deploys without a full suite plus an adversarial pass.
This is that pass for the Sequence Map work, following phase2 and phase4 — each
of which found real bugs.

34 tests: hostile input (20 malformed files, pathological locations at 200-deep
nesting, a 400 kb sequence, null bytes, emoji), biological invariants swept over
the **whole** enzyme table rather than spot-checked, cross-module consistency, and
honesty under pressure. Plus a regression class pinning the forward-only-search
bug — **every** asymmetric enzyme must find its reverse-complement site.

**Result: one failure, and it was the test, not the product.** The finiteness
check matched the `x` inside `viewBox`, the `y` inside `font-family` and the `r`
inside `text-anchor`, reporting every map as broken. Fixed, with a comment saying
why so nobody "simplifies" it back.

Then probed six things the suite doesn't cover, since phase4 also passed clean
first run and still had bugs behind it: CRLF GenBank files (parse), reverse-strand
Type IIS cut positions (**verified by hand** — forward cuts at 11, reverse at 3,
both correct), zero-span features (no NaN), full-span features, lowercase keywords
(correctly refused), and an 8 bp site in a 4 bp circular sequence (0 hits, no
crash).

**No product bugs found.** Suite: **2,034 tests** (was 2,000), 67 suites, all six
QC gates green.

## [1.65.0] — 2026-07-15 — Restriction enzymes: independent compilation, both strands, Type IIS

**First, a correction.** I reported that the add-in knew *"18 restriction
enzymes"*. That was wrong — a bad grep. It was **49**. The real gaps were never
the row count; they were structural.

**Provenance.** This table is compiled **independently** from the freely
published supplier catalogues (NEB, Thermo, Promega, Takara), cross-checked
between them. It is **not copied from REBASE**. A recognition sequence is a
*fact* — "EcoRI cuts G^AATTC" is in every catalogue and textbook, and facts carry
no copyright (*Feist v. Rural Telephone*). But a database's **selection and
arrangement** can carry thin copyright, and REBASE's file is distributed *"All
rights reserved"* — copying it wholesale would copy the compilation, not just the
facts. The selection here is our own. The module says so, so nobody bulk-imports
REBASE later.

**The real bug, which adding enzymes would have made critical.** The old matcher
was a forward-only `indexOf`. That happened to work because all 49 known enzymes
were **palindromic**. Every Type IIS enzyme is **asymmetric** — adding BsaI to the
old engine would have silently missed every reverse-strand site: a Golden Gate
assembly that fails at the bench with nothing to explain why.

| | before | after |
|---|---|---|
| enzymes | 49 | **122** |
| BsaI on the reverse strand | **0 hits** | 1 hit |
| DraIII (`CACNNNGTG`) | **0 hits** (couldn't express `N`) | 1 hit |
| EcoRI | position only | position + cut site + 4 nt 5′ overhang |

- **IUPAC ambiguity codes** — BstXI, SfiI, DraIII, AlwNI, XcmI, BglI, PflMI,
  Bsu36I, BstEII, EcoO109I, AhdI, DrdI, XmnI. None findable by string search.
- **Type IIS**, verified against NEB's Golden Gate documentation: BsaI
  `GGTCTC(1/5)`, BsmBI `CGTCTC(1/5)`, BbsI `GAAGAC(2/6)`, plus SapI/BspQI, Esp3I,
  AarI, BsmAI, BspMI, BtgZI, FokI, HgaI, MlyI, PleI, AlwI, MmeI, BsgI, BpmI,
  BpuEI, EcoP15I.
- **Cut positions and overhangs** (5′/3′/blunt with length) — what you need to
  plan a ligation, and what a name→site map cannot hold.
- **Circular search**, so a site spanning a plasmid's origin is found.
- **Unique cutters flagged** — the ones you can actually clone into.
- Isoschizomers noted where the distinction matters (Acc65I vs KpnI).

`dna.ts` delegates to the new engine and keeps its old API — the 22 existing DNA
tests pass unmodified.

50 new tests, weighted to the failure that matters: a sweep asserting **every**
asymmetric enzyme finds its own reverse-complement site.

Suite: **2,000 tests** (was 1,950).

## [1.64.0] — 2026-07-15 — SnapGene .dna import (with an honest caveat)

Opens `.dna` files directly. **But read the caveat — it is the point.**

The `.dna` format is **proprietary and undocumented by its vendor**. This reader
is written from a public reverse-engineering write-up, and its tests build
synthetic files to that same write-up. That genuinely exercises the parser —
packet framing, flags, XML reading, every failure path — but it **cannot confirm
the write-up itself is right**. Testing my code against my own understanding of
the format is circular. I tried to obtain a real `.dna` file from Addgene to
validate against and could not.

So it ships as a **convenience, not the supported path**, built to fail cleanly
rather than confidently:
- The magic cookie must match, or it refuses.
- A packet whose declared length runs past the buffer stops the walk rather than
  reinterpreting arbitrary bytes.
- An unknown tag is skipped **by its length**, never interpreted.
- A feature with no readable range is dropped, not placed at a guess.
- Every refusal names the way out: *"export it as GenBank instead"* — which every
  tool including SnapGene can do, and which **is** validated against real NCBI
  records. The in-pane help says all of this too.

**Pane:** the file handler now reads **bytes** (`readAsArrayBuffer`), not text —
decoding a binary file as text mangles it. Text formats are decoded from the same
bytes afterwards, so one input handles all three formats.

Also replaced `String.matchAll` with exec loops in the new module: the project
targets ES2017, and moving the whole build's goalposts for one convenience method
isn't a trade worth making.

Suite: **1,950 tests** (was 1,928) — 22 on this reader, most of them on the
failure paths.

## [1.63.0] — 2026-07-15 — Circular plasmid maps

The iconic figure — a ring with feature arcs and radiating labels. The single
most recognisable output of the incumbent tools, and the thing that gets
screenshotted into Word.

**`src/lib/seqmapcirc.ts`**
- **Position 1 at 12 o'clock, increasing clockwise** — the universal convention.
  Getting it backwards mirrors the whole construct: a picture that looks perfect
  and is wrong. Four geometry tests pin it (25% round lands right, 50% bottom,
  75% left).
- Annular-sector arrows with strand-aware heads, concentric rings so overlapping
  features never cover each other, ticks, and a centre caption.
- The hard part is label placement, not the polar maths: real plasmids cluster
  features (an MCS packs a dozen sites into 100 bp of a 5 kb ring), so naive
  radial labels smear into an unreadable mess. Labels pack per side and push
  along until they clear, with leader lines back to the ring.
- Features that run out of radius are **disclosed**, not silently dropped.

**Pane:** a *Map style* selector — Auto / Linear / Circular. Auto follows the
record's own topology, because a ring drawn from a linear record misrepresents
the construct; forcing it still draws, but says so.

**Two bugs caught by rendering and looking, not by assertions:**
- A colour (`#64748b`) leaked into the monochrome map's centre caption, and the
  leader lines were grey — neither is line art. A patent figure must be
  *genuinely* black and white, not mostly. Now only `#000`/`#fff`/`#1b1b1f`,
  asserted.
- The insert path **hardcoded 640px width**. A circular map is 460px square, so
  it would have been stretched out of shape in the document. Insert now reads
  both dimensions from the SVG. (The edit meant to fix this silently failed to
  match — checking rather than assuming is what caught it.)

Guarded by the render check, verified by breaking it: forcing Auto to always ring
fails with *"a LINEAR record was drawn as a ring — that misrepresents the
construct"*.

Suite: **1,928 tests** (was 1,906).

## [1.62.0] — 2026-07-15 — Sequence Map: open GenBank/FASTA, insert an annotated map

The gap a competitor comparison surfaced: JurisLab could compute plenty about a
sequence but **could not read one**, and had no sequence visualization at all —
so a scientist drew the map in SnapGene and *screenshotted* it into Word. The
screenshot was the gap; JurisLab's whole competency is figures into Word.

Deliberately scoped to import + map, not cloning simulation: SnapGene is for
designing the experiment, JurisLab is for writing it up. The overlap is the
figure — and **SnapGene exports GenBank**, so this reaches their users without
touching any proprietary binary format.

**`src/lib/seqio.ts` — FASTA and GenBank readers.**
- The GenBank **location grammar** is where a lazy parser quietly goes wrong, so
  it is tested case by case: `complement(...)`, `join(...)` (an intron is NOT
  coding), `complement(join(...))`, fuzzy `<1..>888`, `order(...)`, `102^103`,
  and remote accessions (skipped rather than mis-placed on *this* sequence).
- Tolerant by design — real files have ragged whitespace and vendor quirks, and a
  reader that throws on the first oddity is useless. Anything unparseable is
  skipped, never guessed.
- **Validated against real NCBI records, not just a hand-written fixture.** The
  hand-made one passed while pUC19 returned 0 features — which turned out to be
  correct (that record has only `source`, which we skip as noise). Lambda phage
  (NC_001416) then exercised it properly: 48,502 bp, 284 features, and
  **197 forward / 87 reverse exactly matching the 87 `complement(` in the file**.

**`src/lib/seqmap.ts` — linear maps to SVG.**
- Strand-aware arrows, per-type colours, lane packing that reserves the LABEL's
  width (a 3px feature with a 60px label needs 60px of lane, or the labels
  collide), a scale bar, and **monochrome line art** for patent figures.
- A joined CDS draws one body per exon with a dashed intron connector — one solid
  bar would claim the intron is coding, the exact error the parser avoids.
- A feature crossing the origin of a circular plasmid is **disclosed**, not
  silently dropped: a linear map cannot draw it honestly.

**Found by rendering a pUC19 map and looking at it:** labels near the right edge
were placed to the right of their feature and ran off the canvas — "AmpR
promoter" rendered as "AmpR p", "rrnB T1" as "rrn". Every assertion passed; only
the picture showed it. Labels now flip to the left when they would overflow, with
regression tests. (A suspected second bug — colour leaking into the mono map —
turned out to be font anti-aliasing; the SVG contains only #000/#fff.)

**Pane:** a new **Sequence Map** tool (23rd). The pane had never read a file, so
`<input type="file">`/FileReader are new surface — with an 8 MB guard, because a
pasted genome would wedge the pane. Tagged for **both** audiences: papers need
maps, and so do patent figures of constructs.

Guarded by the render check: a GenBank record must draw and enable Insert, and
junk must leave Insert **disabled** — a bad figure in a paper is worse than none.
Verified by breaking both.

Suite: **1,906 tests** (was 1,846).

## [1.61.0] — 2026-07-15 — Patent & legal landing page; Markush tagging fix

**Audience tagging fix — found while writing the legal page.** Build's headline
feature is Markush/R-group *genus* structures, which is a **patent claim**
construct: a bench chemist rarely draws one. It was tagged science-only, so a
chemical patent attorney selecting "⚖️ Patent & legal" would have lost the single
most patent-specific tool in the product. Chemical was wrong the same way —
structures fill chemical applications. Both are now `["science", "legal"]`.

This is exactly the failure the audience-*list* design exists to prevent, and it
still slipped through — writing the marketing page for an audience is a good way
to notice you've hidden their tools. Legal now shows 14 of 22; science 18.

**`landing/legal.html` → `/legal.html`** — the mirror of the science page:
- Leads with the work: *"Draft the application — in Word."*
- **Confidentiality first**, because for an unpublished application "offline"
  isn't a nicety, it's the reason you're allowed to use it at all.
- Pitches only the drafting tools (12 cards, every link verified): numerals with
  collision/gap/orphan checks, whole-document audit, Bluebook & TOA, Markush,
  ST.26, B&W patent figures, plant patents, algorithm listings.
- Names the competitor reality: structures in a drawing package, listings in a
  separate WIPO tool, citations in a research service, numerals checked by eye.
- Honest block: drafting aid, not a filing check. ST.26 must still be validated
  in WIPO Sequence; numeral detection is advisory; Bluebook follows the common
  rules, not every local quirk.
- Points at the ⚖️ filter so the page and the pane agree.

The index hero now offers both doors (🔬 For scientists · ⚖️ For patent & legal),
and the two pages cross-link — the biotech attorney and the chemist who files
patents can find the other half.

## [1.60.0] — 2026-07-15 — Home audience filter (focus without fragmenting)

Prompted by a real observation: *science people don't want the finance and law
stuff.* The proposed fix was splitting into four add-ins (JurisSCI / JurisMAT /
JurisLAW / Juris$$$). We didn't, because the split isn't clean and it would cost
the thing that makes JurisLab defensible:

- JurisMAT would be a strict subset of JurisSCI — every chemist needs equations,
  units and plots. Juris$$$ would be one tool. JurisLAW overlaps SCI heavily:
  ST.26 sequence listings are a *patent* format, Botanical is *plant patents*.
- The biotech patent attorney — who needs Chemical + Sequence + Citations in one
  document — is the user nobody else serves. SnapGene has no ST.26; Westlaw has
  no chemistry. Splitting would make that person install two products.
- And the complaint about competitors is precisely that their tools are separate
  software you flip-flop between. Splitting would rebuild the problem we win on.

So: the diagnosis was right, the prescription wasn't. Clutter is a presentation
problem, not a packaging one.

**Home filter chips** — *Show: All tools · 🔬 Science · ⚖️ Patent & legal*
- Tags are per TOOL, not per group, because the groups don't divide cleanly:
  "Patent drafting" holds Refs (figure captions — every paper needs them) and
  Biology holds Sequence (ST.26 exists purely for filings).
- Audience is a LIST, so genuinely dual tools show to both: **Sequence** and
  **Botanical** survive either filter. Tagging them once would have hidden a tool
  from the person who most needs it.
- Six tools are untagged and shown to everyone: Math, Units, Plot, Table→Chart,
  Refs, Code.
- Science hides 4 (18 of 22 shown); Patent & legal hides 10 (12 shown).

It is a lens, not a licence tier:
- **Defaults to "All"** — nothing is hidden until the user asks.
- **Filters the Home CARDS only.** Every tool stays in the dropdown and the
  search box, and the count line says so out loud: *"Showing 18 of 22 tools.
  Show all — the rest stay available in the dropdown and search."*
- One click to change, persisted per user, reversible.

Guarded by the render check, which now asserts the behaviour in a real browser:
default shows all 22, Science hides Citations but keeps Math/Spectra/Sequence,
Patent & legal hides Spectra but keeps Citations *and* Sequence, the dropdown
never loses an entry, and "All tools" restores everything. Verified by breaking
it — untagging Citations fails with *"the Science filter still shows Citations —
the exact clutter it exists to remove."*

Suite: **1,846 tests** (was 1,841).

## [1.59.0] — 2026-07-15 — Headless render check (the missing test layer)

There was a hole between the two things we had: 1,841 unit tests that cover the
engine but cannot see the pane, and a 30-minute manual in-Word script that sees
the pane but costs a human. Everything in between — *does each tool actually
render, and only its own section?* — was covered by nothing. That hole is exactly
where the Analyze-under-the-Home-tiles bug lived for six versions until a user
spotted it.

`npm run render-check` (`scripts/render-check.js` + `render-driver.js`) closes it:
- Boots the **real production bundle** in headless Chromium against a stubbed
  Office, then drives every mode and asserts what renders. Word's task pane runs
  on WebView2, which is Chromium — the same engine — so this exercises the real
  rendering path rather than a simulation of it.
- Asserts: the pane boots; Home shows only its tiles and leaks no tool section;
  all 22 tools have tiles; every mode renders exactly its own section (chemical
  and math correctly share format-section) and has Examples & syntax content;
  Spectra computes toluene AND keeps its caveat; the ODE tool auto-reduces
  `y'' = -y` and solves it; the chemical preview still subscripts H2O.
- **Verified by reintroducing the original bug**: excluding analyze-section from
  the Home hide fails the check with the exact diagnosis —
  `tool sections visible on Home -> HOME_LEAKS=analyze-section` — and exits 1.
- Added as step 6 of `npm run qc`. Skips cleanly (exit 0) where no Chromium-family
  browser exists, so it never blocks a machine that cannot run it.

It does NOT replace the manual pass, and the QC header says so: it cannot see
layout or styling, and cannot exercise anything needing a live Word document
(insertion, document scanning). It catches the WIRING class — which is the class
that has actually been shipping.

Live confirmation from the render (values a chemist can check):
- Spectra / toluene ¹H NMR → 7.17 (2H, m), 7.09 (2H, d), 7.08 (1H, t),
  **2.37 (3H, s, CH₃ on Ph)** — matching literature, caveat present.
- ODE → *"Solved over t ∈ [0, 6.283] in 32 steps using explicit RK45.
  Auto-reduced to a first-order system of 2 states: y, y'. Final:
  y(6.283) = 0.999999"* — the auto-reduction working in the real pane.

## [1.58.1] — 2026-07-15 — Close the remaining coverage gaps

The three modules the gap analysis named as untested. In each case the code turned
out to be CORRECT — the gap was that nothing proved it, and each new suite was
verified by reintroducing a bug and confirming it fails.

**Preview fidelity — `mathHtml.ts` (was 0 tests).**
- Its own header states the contract: *"mirrors the OMML emitter so the preview
  reflects what gets inserted."* mathOmml had a full suite and a FORMULA_LIBRARY
  sweep; the preview emitter had none. Drift would mean the preview LIES about
  what lands in the document, and only the OMML side would notice.
- 70 tests. Both emitters walk the same AST, so fidelity is proved by asserting
  each faithfully renders every leaf, in order: the OMML's `<m:t>` runs must equal
  the AST's leaves exactly, and the preview's text must contain them all in order.
  Now sweeps every FORMULA_LIBRARY entry through the PREVIEW too, not just OMML.
- Documents one intentional divergence: for an n-ary (Σ, ∫) the HTML emits sup
  before sub (it stacks the limits visually) while the OMML emits sub before sup
  (the XML order Word expects). Same rendering, different source order.
- Also pins the fallback contract (partial input like `sqrt(` must preview, not
  throw — the OMML side throws and `insertEquation` catches it and says so), and
  that HTML-special characters are escaped rather than injected into the pane.
- Verified by mutation: dropping the radical's degree fails 2 tests; dropping a
  subsup's subscript fails 4. **No drift exists today** — the emitters agree.

**`lookupSmiles` / `nameForIdcode` — `structures.ts` (was untested).**
- The front door for the whole chemistry stack: molgraph.ts (and through it
  nmr/ir/uvvis/fragment), massspec.ts and pka.ts all resolve input through it. A
  wrong SMILES here would make every predicted spectrum confidently wrong.
- 21 tests pinning names to their real formulas (aspirin → C9H8O4, caffeine →
  C8H10N4O2, glucose → C6H12O6…), case-insensitivity, formula lookup, the
  name-beats-formula precedence and its `source` reporting, name→structure→name
  round trips, and that unknown input returns null rather than a near-miss.

**`history.ts` (was untested).**
- 15 tests. Nothing here reaches the document, but it holds the only untested
  failure paths that decide whether the pane opens at all: corrupt JSON, valid
  JSON of the wrong shape, and a throwing localStorage (quota exceeded, or
  disabled by policy) must all degrade to empty rather than killing the pane.

Coverage: 60 of 61 lib modules are now imported by at least one test. The
exception is `molgraph.ts`, which has no direct test file but is exercised by
~100 adversarial tests through the four predictors built on it — a real failure
there surfaces as a confusing multi-module failure rather than a pinpointed one,
which is a diagnosability cost, not a coverage gap.

Suite: **1,841 tests** (was 1,735).

## [1.58.0] — 2026-07-15 — Gap analysis: fixes from a first real audit

Prompted by "did you perform a comprehensive bug test and gap analysis?" — the
honest answer was no. Previous passes were feature-scoped; nothing had ever swept
the whole product. The Analyze-on-Home bug (v1.57.1, found by the user) was the
evidence. This is that sweep.

**Spectra had no Examples & syntax content — user-visible, shipped in v1.54.0.**
- Opening Spectra and expanding the help panel showed an EMPTY panel. Every other
  tool has help.
- Root cause was a bug class, not a typo: the mode list existed in THREE
  hand-maintained copies — the `Mode` union (taskpane.ts), the `ExampleMode`
  union (examples.ts), and a `MODES` array inside examples.test.ts. `spectra` was
  added to the pane and to none of the others. `MODE_EXAMPLES` is
  `Record<ExampleMode, string>`, so it was "complete" against its own stale
  union; an `as ExampleMode` cast at the call site laundered the real type; and
  `?? ""` turned the miss into a silent blank. The test that claimed to check
  "every mode has help content" iterated its own copy and passed vacuously.
- Fixed properly: `src/lib/modes.ts` is now the single source of truth
  (`ALL_MODES` const → `Mode` type → `ExampleMode` = all but home). examples.ts,
  taskpane.ts and the test all derive from it, and the cast is gone. Verified:
  deleting the spectra entry is now a COMPILE ERROR, not a blank panel.
- Wrote the Spectra help content, carrying the same caveats as the pane.

**Finance formulas rendered ungrouped in the library dropdown.**
- `FORMULA_LIBRARY` has 19 categories; the grouping named 16. The three Finance
  categories were never assigned, so they appeared as bare options dangling below
  the labelled groups. A safety net appends unassigned categories ungrouped,
  which is why this degraded quietly rather than breaking.
- `LIBRARY_GROUPS` moved from taskpane.ts into formulaLibrary.ts, beside the data
  it groups, so it is testable; added the Finance group and tests that every
  category is assigned exactly once and that no group names a phantom category
  (the match is by name, so a rename on either side silently un-groups).

**palettes.ts had ZERO tests and encodes real chemistry.**
- `BUILD_TEMPLATES` holds molecules as data (`Benzene`, `Acetic acid`,
  `Acetone`…). A wrong bond order there is SYNTACTICALLY VALID — it would parse
  cleanly and silently insert incorrect chemistry into a document, which is
  exactly what "all data must be real" forbids.
- 26 new tests assert each template IS the molecule its label claims (Benzene →
  C6H6, Acetic acid → C2H4O2, …), that rings actually close, that Benzene is
  Kekulé (3 double bonds) and Cyclohexane saturated, that bond indices are in
  range, that Markush tokens really yield a generic structure, and that carets
  never point outside their snippet. **The shipped chemistry all checks out** —
  the gap was that nothing proved it.

Suite: **1,735 tests** (was 1,703).

## [1.57.1] — 2026-07-15 — Fix: Analyze controls showed under the Home tiles

Reported from a real install: on first opening JurisLab, an unexpected toolbar
sat at the bottom of the Home page.

- **Cause.** The Home branch of `onInputChanged` hid the tool sections from a
  hand-written list, and `analyze-section` was missing from it — 20 entries for
  21 sections. Nothing else hides a section, so Analyze's controls (tool picker,
  Result box, Insert button) rendered under the tile grid.
- **Why only on first open.** Opening any tool runs the per-mode branch, which
  sets every section explicitly and so hid Analyze as a side effect; it then
  stayed hidden. The bug was only ever visible on a fresh load — which is
  exactly how it survived since Analyze shipped in v1.52.0.
- **Fix.** The Home branch now reads the tool sections from the DOM
  (`main > section`) instead of a hand-maintained list, so a newly added tool
  cannot be half-registered. Nested sub-sections (structure-section, inside
  format-section) are correctly untouched.
- **Regression test.** `src/taskpane/__tests__/homeSections.test.ts` pins the
  invariant, and was verified to fail when the bug is reintroduced. Jest roots
  now include `src/taskpane` for static-asset tests (markup structure and id
  wiring) that need no Word host; Office-dependent behaviour still belongs in
  the manual pass.

Suite: **1,703 tests** (was 1,698).

## [1.57.0] — 2026-07-15 — ODE: dense output & event detection

The last two gaps in the ODE tool. Both change it from "computes the right
numbers" to "answers the question you actually asked".

**Report at the times you choose** (`OdeOptions.tEval`)
- The table showed whatever steps the solver happened to take. Now you can ask
  for a list (`0, 1, 2.5`) or a range (`0:0.5:10`), and get exactly those rows.
- The values are **computed, not interpolated**: the step size is capped so the
  integrator lands exactly on each requested time, so there is no interpolation
  error to caveat. Verified against closed-form solutions to 8 decimal places,
  and confirmed to cost no accuracy versus an unconstrained run.
- The full step-by-step trajectory is still returned separately, so the plot
  stays smooth even when you ask for 6 table rows.
- Works on both solvers and survives the auto handoff between them.

**Stop on a condition** (`OdeOptions.events`)
- Answers "when does it…?" instead of making you read it off a chart. Supply an
  expression that crosses zero — `z` for "hits the ground", `y - 100` for a
  threshold, `y'` for "at the turning point".
- The crossing is located by bisection, each probe re-integrating from the step
  start, so the reported state is computed rather than interpolated. Direction
  filtering (rising/falling only), non-terminal events that record every
  crossing and keep going, and multiple independent conditions are all supported.
- Projectile check: `z'' = -9.81` from `z' = 20` stops at t = 4.077472 with
  z = 0 and z′ = −20 — the closed form is 20/4.905 = 4.0774719673.

Found and fixed a real design bug while testing: a terminal event only becomes
known AFTER the step that crossed it, and RK45 integrates a quadratic exactly in
~4 huge steps — so the overshooting step carried t all the way to t1. The run
reported `completed: true` and the trajectory continued *underground* past the
event. A terminal event now truncates the solution at the crossing, which is
what "stop when it hits the ground" has to mean. Requested output times past the
event are dropped with it.

Also: the pane treats a terminal event as success (it returns `completed: false`
by design), and tells you plainly when a stop condition never triggered instead
of silently returning a full-range solve.

Suite: **1,698 tests** (was 1,662).

## [1.56.0] — 2026-07-15 — ODE: auto-reduction, RODAS4, richer expressions

Removing the limitations that made the ODE tool feel like a homework exercise
rather than something you would reach for.

**Higher-order ODEs are reduced automatically** (`src/lib/odeParse.ts`)
- `y'' = -0.1*y' - y` with `y = 1, y' = 0` now just works. Previously you had to
  hand-reduce to `y1' = y2 / y2' = -0.1*y2 - y1` — the single biggest papercut in
  a tool whose whole premise is "no code".
- Up to 6th order, several higher-order equations at once, mixed orders in one
  system, `y(0) = 1` or `y = 1` initial-value syntax. Existing hand-reduced
  first-order systems keep working unchanged.
- Errors are specific and actionable: *"Missing an initial value for y'. A system
  of order 2 needs 2: y = …, y' = …"* and *"refers to 'k', which isn't a state of
  this system"* rather than an opaque failure deep in the evaluator.

**4th-order stiff solver — RODAS4** (`src/lib/ode.ts`)
- Hairer & Wanner's RODAS: 6-stage, L-stable, stiffly accurate, with the error
  estimate falling out as k6. Now the default stiff path; the 2nd-order ode23s
  method remains available via `order: 2`.
- Verified by **empirical convergence order**, not by trusting the tableau:
  measured 4.08 for RODAS4 and 2.00 for ode23s on the same harness. A wrong
  tableau cannot produce clean order-4 convergence *and* match analytical
  solutions *and* reproduce ROBER.
- The accuracy/speed trade-off is gone:
  - Van der Pol μ=1000: 9,072 steps / 100 ms → **1,521 steps / 22 ms**
  - Robertson kinetics: 13,286 steps / 146 ms → **570 steps / 8 ms**
  - y′ = −y to ~4e-9: ~4,069 steps → **46 steps** (~90× fewer)
- Honest limit, documented: ultimate accuracy saturates near 1e-12 because the
  Jacobian is a finite-difference approximation.

**Richer expressions everywhere** (`evalFormula`, `src/lib/stats.ts`)
- Was: `sqrt exp ln log sin cos tan abs`. Now adds inverse trig, hyperbolics
  (`tanh` etc.), `cbrt`, `log2`/`log10`/`logbase`, rounding (`floor`/`ceil`/
  `round`/`trunc`/`sign`), `min`/`max`/`clamp`/`hypot`/`pow`, a **true `mod`**
  (sign follows the divisor, unlike JS `%`), a Heaviside `step`, the comparison
  operators `< > <= >= == !=`, and **`if(cond, a, b)`** for piecewise and
  switching inputs. Multi-argument calls are parsed with arity checked.
- This lifts ODE right-hand sides, the optimizer objective, plot expressions and
  uncertainty propagation at once. Fully backward compatible.

Suite: **1,662 tests** (was 1,573) — 27 auto-reduction tests (asserting the
reduction is *physically* right, not just structurally: the damped oscillator,
projectile and stiff 2nd-order cases are each checked against their analytical
solutions) and 62 expression-library tests.

## [1.55.0] — 2026-07-15 — Stiff ODE solver (Analyze)

Closes the biggest real gap in the ODE tool. Explicit RK45 is limited by
*stability* rather than accuracy on stiff systems, so it crawls or dies — and
stiffness is the normal case in chemical kinetics whenever rate constants differ
by orders of magnitude, which is squarely JurisLab's territory.

- **New implicit solver** (`integrateStiff`, `src/lib/ode.ts`) — Shampine's
  modified Rosenbrock pair, the method behind MATLAB's `ode23s`. Linearly
  implicit and L-stable: one LU factorization per step serves all three stage
  solves, with no Newton iteration. Numerical Jacobian and ∂f/∂t by finite
  differences; 2nd order with a 3rd-order embedded error estimate.
- **Automatic stiffness detection** (`solveOde`) — RK45 runs with Hairer's
  DOPRI5 stiffness probe armed (free: it reuses stages already computed). On a
  sustained run of hits it hands the current state to the implicit solver and
  continues, so a system that *starts* benign and stiffens later (Van der Pol)
  is still solved. The result reports which method ran.
- **Solver selector in the pane** — Auto (default) / explicit RK45 / implicit
  stiff, and the result line names the solver used.

What this unlocks, measured:
- **Van der Pol μ=1000** — the standard stiff test. Was: never finished (burned
  200,000 steps). Now: completes in ~9,000 steps / ~80 ms.
- **Robertson kinetics (ROBER)** — the canonical stiff kinetics benchmark, rate
  constants 0.04 → 3×10⁷. Solves in ~205 steps / 3 ms, conserving mass to 12
  digits and converging to a solution stable across rtol 1e-8…1e-10.
- **Stiff linear** — 6,133 RK45 steps → 1,058 stiff steps, and more accurate.
- **Non-stiff is untouched**: the harmonic oscillator still runs on RK45 in 32
  steps; no false switch, no slowdown.

Honest limits, documented in the module and FEATURES.md: the Rosenbrock is 2nd
order against RK45's 5th, so on non-stiff problems it is both slower and less
accurate (y′ = −y at rtol 1e-6: RK45 8 significant figures in 23 steps, stiff ~4
in 188). That is exactly why Auto stays on RK45 unless the problem is genuinely
stiff. Both solvers converge cleanly — error falls monotonically as rtol tightens
— and both still terminate honestly on a finite-time singularity rather than
claiming to integrate past it.

Also fixes a latent UI gap: `AnalyzeField` declared a `select` kind with options,
but the renderer only handled `text` and silently fell through to a textarea for
anything else. No calculator had used `select` before, so it never surfaced.

Suite: **1,573 tests** (was 1,552), including 21 new stiff-solver tests pinned to
analytical solutions and the standard benchmarks. `integrate()` keeps its exact
prior behaviour (stiffness detection is opt-in), verified by regression tests.

## [1.54.0] — 2026-07-15 — Spectra mode (Phase 4: spectroscopy prediction)

Predicted spectra from structure — the last big white space on the analytical
roadmap. All offline. These are **estimates from published additivity rules**,
not acquired spectra and not quantum-chemical calculations; structure detection
is exact, the values are empirical, and every prediction carries its accuracy.

- **New Spectra mode** (22nd tool) — ¹H NMR, ¹³C NMR, IR, UV-Vis and EI-MS
  fragmentation from a name, formula, or SMILES. Insert as a data table or a
  spectrum chart.
- **¹H / ¹³C NMR** (`src/lib/nmr.ts`) — Grant–Paul additivity over the alkane
  skeleton, benzene substituent increments for aromatics, Shoolery-type α/β
  effects for protons. Symmetry-aware signal grouping (OpenChemLib ranks), n+1
  multiplicity with equivalent-nucleus suppression, integration, per-signal
  assignment. Exchangeable OH/NH/COOH reported as flagged nominal ranges.
- **IR** (`src/lib/ir.ts`) — characteristic group frequencies with published
  ranges + a simulated Lorentzian transmittance trace. Carbonyl classes and
  conjugation shifts resolved. Fingerprint region explicitly not predicted.
- **UV-Vis** (`src/lib/uvvis.ts`) — Woodward–Fieser for dienes and enones with
  every increment shown. Out-of-domain inputs are disclosed, never guessed:
  unconjugated → reported transparent (no fabricated λmax).
- **MS fragmentation** (`src/lib/fragment.ts`) — exact fragment m/z via real
  graph cleavage; α-cleavage, benzylic/tropylium, allylic, McLafferty (γ-H
  gated), and feature-gated neutral losses. Likelihood is a ranking, not an
  intensity. Shares the exact-mass scale with `massspec.ts`.
- **Shared graph layer** (`src/lib/molgraph.ts`) — one exact structure detector
  (carbonyl class, substituent classification, ring topology) behind all four
  predictors, so an ester is an ester in every module.
- **Chart builder** (`src/lib/spectraChart.ts`) — δ and wavenumber axes run in
  the conventional (reversed) direction; kept in `lib/` so the convention is
  testable.

Bug-tested per the standing rule — `phase4.adversarial.test.ts` (hostile corpus:
charged, isotopic, radical, macrocyclic, exotic-element, zero-proton, garbage
inputs) plus literature-pinned assertions. The pass **found and fixed 6 real
bugs** before release:

1. sp³ shifts double-counted aromatic/carbonyl groups (toluene CH₃ read 57.9 ppm
   vs 21.4 literature) — Grant–Paul now counts only the alkane skeleton.
2. The same double-count in the ¹H β-term (toluene CH₃ 2.8 vs 2.34).
3. Benzene predicted as a triplet — equivalent nuclei do not split each other.
4. Toluene's tropylium base peak (m/z 91) was missing entirely, and the m/z 77
   phenyl cation was mislabelled "tropylium/benzyl".
5. A bogus high-ranked HO⁺ (m/z 17) for ethanol; α-cleavage was keeping the
   heteroatom rather than the carbon it stabilises (ethanol's real base peak,
   m/z 31, was misclassified).
6. The aromatic ring-walk filtered on atom aromaticity and so crossed biphenyl's
   non-aromatic inter-ring bond, leaking the far ring's increments; and fused
   aromatics (naphthalene) returned a flat 128.5 with no caveat at all.

Full suite: **1,552 tests** (was 1,430), build clean.

## [1.53.0] — 2026-07-15 — In-pane update check (self-update awareness)

For users who installed via the per-user pack (no admin/centralized deployment),
the add-in now surfaces new releases itself instead of relying solely on the
browser cache expiring.

- The build bakes its version in (`__APP_VERSION__`) and emits a `version.json`
  at the site root. On open, the pane fetches `version.json` **cache-busted**
  (`?t=…`, `no-store`) and, if the hosted version is newer, shows a dismissible
  **"Update available — Reload"** banner (`src/lib/version.ts`, unit-tested).
- Fails silently when offline — a failed fetch never nags the user.
- This works around WebView2's stubborn same-origin caching: a pending update is
  now visible and one-click-applyable (and, if a reload is still cached, a Word
  restart forces it). Existing content-hashing of the JS bundle is unchanged.
- Tests: +5 (version comparison); full suite **1430 passing**.

## [1.52.0] — 2026-07-14 — Phase 3: stats breadth + pKa estimation

Fills the thin spots identified on the roadmap.

- **Stats mode — non-parametric & categorical tests** (`stats2.ts`): Mann–Whitney U
  (independent), Wilcoxon signed-rank (paired), chi-square goodness-of-fit and test
  of independence, **two-way ANOVA** (balanced, with interaction), and
  **multiple-comparison correction** (Bonferroni, Holm, Benjamini–Hochberg/FDR).
  P-values come from real distribution functions (normal via erf, chi-square via the
  incomplete gamma). _Tukey HSD deferred — it needs the studentized-range
  distribution; Bonferroni/Holm/BH cover the common correction needs meanwhile._
- **Chemical mode — pKa estimation from structure** (`pka.ts`): a deterministic
  functional-group detector (walks the OpenChemLib atom graph, so an ester is never
  read as a carboxylic acid nor an amide as an amine) that reports the typical
  literature pKa for each ionizable group and an estimated net charge at pH 7.4.
  Clearly labeled as a **group estimate, not a compound-specific prediction** —
  consistent with the "all data must be real" mandate.
- **Bug test:** invariant + adversarial suites for both (known critical values,
  ties, zero cells, false-positive guards for ester/amide/nitrile/pyrrole,
  glycine-zwitterion net charge). No bugs found this round.
- Tests: +57; full suite **1425 passing**.

## [1.51.0] — 2026-07-14 — Analyze mode: Phase 2 numerical breadth (ODE, FFT, optimization)

Adds the three Phase-2 tools that round out the MATLAB-style workbench, all
offline and computed from the user's own numbers:

- **Minimize a function** — Nelder–Mead simplex optimization of a typed objective
  over named variables (`optimize.ts`). Derivative-free; reports the optimum,
  minimum value, and convergence.
- **FFT / frequency spectrum** — radix-2 Cooley–Tukey (`fft.ts`), zero-padding
  non-power-of-two lengths. Returns a one-sided amplitude spectrum, dominant
  frequencies, and a spectrum chart inserted into the document.
- **ODE / system (RK45)** — adaptive Dormand–Prince integrator (`ode.ts`) for
  `y' = f(t, y)` and coupled systems, evaluated via the shared `evalFormula`.
  Inserts a sampled (t, y) table plus a trajectory plot.
- Analyze insertion now also handles **plots** (SVG → PNG) alongside tables/text.
- **Bug test (adversarial):** the pass caught and fixed **two real bugs** —
  (1) the ODE integrator looped forever on a finite-time blow-up (`y'=y²`) because
  a non-finite error made the step size NaN and only accepted steps counted toward
  the cap; termination is now guaranteed. (2) `dominantFrequencies` reported
  zero-amplitude "peaks" for a constant signal; negligible bins are now dropped.
- Tests: +45 (Phase 2 invariant + adversarial suites); full suite **1383 passing**.

## [1.50.0] — 2026-07-14 — Analyze mode: completes the linear-algebra core

Closes Phase 1 of the "compete with MATLAB" roadmap to the letter, adding the
four remaining linear-algebra capabilities as new Analyze tools:

- **Eigenvalues (any square matrix)** — the Francis double-shift QR algorithm
  (Hessenberg reduction + `hqr`) for general non-symmetric matrices, including
  complex-conjugate pairs rendered as `a ± bi`. Complements the existing
  symmetric-matrix path (which also returns eigenvectors).
- **QR decomposition** — A = Q·R by Householder reflections (Q orthogonal,
  R upper-triangular).
- **Singular value decomposition (SVD)** — A = U·diag(S)·Vᵀ by one-sided Jacobi;
  works for any shape, economy form.
- **Matrix expression** — define named matrices and evaluate an expression in one
  line: `A*inv(B) + 2*C'`, `det(A)`, `(A - B)^T`, with +, −, *, /-by-scalar,
  transpose (`'` or `^T`), and inv/det/trace/rank. Dimension mismatches and
  singular inverses surface as clear messages.
- New module `src/lib/matrixExpr.ts`; `src/lib/linalg.ts` gains `qrDecompose`,
  `svd`, `eigenvaluesGeneral`, `formatComplex`.
- **Bug test:** added an adversarial/invariant stress suite
  (`analyze.adversarial.test.ts`) — ~800 random matrices checked against
  Σλ = trace, Πλ = det, A·inv(A) = I, QR/SVD reconstruction, and symmetric-vs-general
  agreement, plus degenerate cases (zero/singular/1×1/complex-spectrum matrices,
  constant/all-missing data columns, malformed expressions). All pass.
- **Fix (found by the bug test):** the Analyze insert button no longer offers to
  insert a non-finite result — a matrix expression that divides by zero renders as
  the "—" sentinel, which is now blocked from insertion (matches the Stats guard).
- **Production polish:** Analyze now inserts matrices as real, right-aligned **Word
  tables** (inverse, solve, QR, SVD, transpose, multiply, eigenvectors, matrix
  expressions) instead of space-padded text that only aligned in a monospace font —
  columns now line up in any document font, and the result is editable. Scalars and
  the data-insights report still insert as text.
- Tests: +69 across the two releases; full suite **1354 passing**.

## [1.49.0] — 2026-07-14 — Analyze mode: no-code numerical workbench (matrix math + data insights)

First milestone of the "compete with MATLAB" roadmap — a new **Analyze** mode
that brings a no-code numerical workbench into Word, computed entirely offline
from the user's own numbers.

- **Linear-algebra core** (`src/lib/linalg.ts`) — solve A·x = b, matrix inverse,
  determinant, rank & trace, transpose, multiply, and eigenvalues/eigenvectors of
  a symmetric matrix (cyclic Jacobi). Gaussian elimination / Gauss-Jordan with
  partial pivoting for stability; singular systems are reported, never faked.
  Non-symmetric eigenvalues are intentionally out of scope (they can be complex).
- **Data → insights engine** (`src/lib/insights.ts`) — paste a data table (tab/
  comma/space-delimited, header auto-detected) and get per-column summaries
  (mean/sd/min/median/max, missing-cell and Tukey-1.5×IQR outlier flags), a ranked
  correlation matrix (Pearson r with p-value + Spearman rho), per-column trend
  detection over row order, and plain-language actionable insights. Reuses the
  tested `stats.ts` p-value machinery.
- **Analyze mode UI** — a tool picker over the above, wired to the existing
  live-compute/insert pattern; nothing leaves the machine.
- Tests: +30 (linalg, insights); full suite 1315 passing.

## [1.48.5] — 2026-07-14 — Edge-case-honesty audit: Stats + legal citations

Swept the Stats, Bio/Assay, and citation/legal modules for the same class of
"confident-but-wrong output on edge inputs" as 1.48.2–1.48.4. Bio/Assay was clean
(fits already gate on convergence; closed-form calculators route non-finite
results through the "—" guard). Fixes:

- **Stats:** CV (coefficient of variation) showed **"Infinity%"** for any
  zero-mean data (e.g. `-5, 5`) because it bypassed the non-finite guard — now
  **"n/a (needs a positive mean)"**. A zero-variance t-test rendered
  **"t(NaN) = -Infinity, p = NaN"**, and constant-x regression showed
  **"slope p = NaN"** — both now return a clear "test is undefined" message.
  `formatP` can no longer emit "p = NaN" anywhere, and ANOVA now requires ≥2
  values per group.
- **Citations — dates:** `formatDate` fabricated impossible dates like
  **"Feb. 31, 2019"**; it now rejects any day beyond the month's length
  (leap-year aware, so `2020-02-29` is valid but `2019-02-29` isn't) and passes
  the raw text through instead.
- **Citations — section symbol:** a single dotted Treasury reg such as
  `1.6011-4` wrongly rendered **`§§`** (the internal hyphen read as a range).
  Compound dotted sections now keep the singular `§`; genuine integer ranges
  (`101-103`) still use `§§`.
- **Table of Authorities:** a full citation introduced by an ordinary
  capitalized word with no comma ("**In** Alice Corp. v. CLS Bank…",
  "**Applying** Mayo v. Prometheus…") glued that word onto the case name,
  producing a wrong, mis-alphabetized, and duplicated TOA entry. Such leading
  prose words are now stripped — while genuine forms are preserved: "In re" /
  "In the Matter of", and litigants like "Under Armour" ("Under" is deliberately
  never stripped). +11 regression tests.

## [1.48.4] — 2026-07-14 — Mass Spec: no ESI adducts for already-charged inputs

- **Mass Spec mode:** the ESI adduct table (`[M+H]+`, `[M+Na]+`, `[M-H]-`, …)
  assumes a *neutral* precursor. It was computed for any input, so a structure
  that already carries a net formal charge — e.g. choline (a permanent
  quaternary-ammonium cation) or an anion like acetate — got physically
  meaningless protonation/cationization m/z values. The panel now detects net
  charge and, when non-zero, omits the adducts with a note
  (*"Input carries a net charge (n+); ESI adducts assume a neutral molecule"*).
  Exact mass and isotope pattern are unaffected and still shown. +4 tests.
  (Audit of Peptide and Mass Spec for the same edge-case-honesty class as
  1.48.2/1.48.3; peptide constitution/masses verified correct, no change needed.)

## [1.48.3] — 2026-07-13 — Hide QSAR estimates for non-organic inputs

- **Chemical mode (properties):** follow-up to the druglikeness gate. cLogP and
  logS are QSAR estimates trained on organic molecules; OpenChemLib returns
  fallback constants (0 and −0.53) for out-of-domain inputs — a bare metal atom,
  a noble gas, or a simple salt — so the panel showed a fake-confident
  "cLogP 0 / logS −0.53" even for water or a gold atom. Those two rows now read
  **"n/a"** for non-organic small molecules. Exact values (MW, formula, tPSA,
  H-bond/rotatable/heavy-atom counts) are shown for every input, unchanged.

## [1.48.2] — 2026-07-13 — Don't claim bare metals/salts are "druglike"

- **Chemical mode (druglikeness):** Lipinski's Rule of Five and Veber are
  upper-bound filters — they only flag molecules that are *too* big/greasy/polar,
  so anything small and nonpolar (a bare gold atom `[Au]`, a noble gas, a simple
  inorganic salt) trivially "passed" every ceiling and showed a green
  **Druglikeness: ✓ pass**. The screens now render only for organic small
  molecules (≥ 1 carbon and ≥ 2 heavy atoms); everything else shows
  **"n/a — applies to organic small molecules"**. Carbon-bearing metallodrugs
  (e.g. auranofin) are still screened normally. Raw properties are unaffected.
  +4 regression tests.

## [1.48.1] — 2026-07-13 — Fix OPSIN "HTTP 404" on unrecognized names

- **Chemical mode (online name→structure):** OPSIN answers HTTP 404 with a
  `FAILURE` JSON body for any name it can't parse — a typo, trade name, or
  non-systematic name. The lookup treated every non-200 as a service outage and
  showed the alarming "OPSIN service error (HTTP 404)". It now reads the 404 body
  and surfaces OPSIN's own explanation (e.g. "… was uninterpretable"); genuine
  outages (5xx / non-JSON) still report an HTTP-status error. +4 regression tests.

## [1.48.0] — 2026-07-13 — Life-science release

Release milestone rolling up the life-science expansion (20 tools total):
- **New modes:** Bio/Assay (enzyme kinetics, dose-response IC50/EC50, binding, lab
  math — offline curve fitting), Mass Spec (monoisotopic/average mass, isotope
  pattern, adduct m/z), Peptide (2D structure from sequence), Stats (t-tests,
  ANOVA, regression, uncertainty propagation).
- **Chemical mode:** physicochemical properties + Lipinski/Veber druglikeness;
  opt-in online IUPAC name→structure via OPSIN.
- **Compound library:** 259 → 359 named structures (violacein &amp; other large
  natural products/steroids/alkaloids/vitamins), all PubChem-sourced.
- **Infrastructure:** content-hashed bundles so updates reach installed clients.
- **Quality:** two adversarial bug-review rounds (15 fixes), ~27 new regression
  tests; 1262 tests total, lint + build clean. Landing page + install packs
  refreshed for distribution.

## [1.47.3] — 2026-07-13

### Fixed (second bug-review round — under-covered modules)
- **LaTeX import: bare delimiter commands** (langle, 
angle, lfloor,
  lceil, ert, …) now render as their glyphs instead of the literal words
  "langle"/"rfloor" — fixes bra-ket and floor/ceil import.
- **LaTeX import: a script after a fraction** binds to the whole fraction:
  rac{a}{b}^2 → (a/b)², not a/(b²).
- **Botanical: an infraspecific epithet after an author** is now italicized
  ("Quercus robur L. subsp. *robur*") — the sticky roman flag no longer suppresses
  it.
- **Prefs: present-but-invalid stored values** fall back to defaults (type/domain
  validated) instead of propagating (e.g. a corrupt dnaFrame).
- +8 regression tests (1262 total).

### Known limitations (documented, low value / import-only best-effort)
- LaTeX import: set braces { }, a big-operator body scope (∑…+y), and
  delimiter *shape* under left
ight are approximate; the import is a
  labeled best-effort — verify the result.

## [1.47.2] — 2026-07-13

### Fixed
- **Double-click no longer inserts twice.** A shared re-entrancy guard on the
  text-insert helper (MS / Stats / Assay / DNA / Finance results) stops a fast
  double-click from queuing two insertions before the first completes.

### Note
- Re-examined the citations T10 report: abbreviating a geographic unit inside a
  company name (Washington Mutual -> Wash. Mutual) is correct Bluebook, matching
  the intended "N.Y. Times Co." behavior — not a bug. The only real defect was the
  hyphenated-compound case (Georgia-Pacific), already fixed in 1.47.1.

## [1.47.1] — 2026-07-13

### Fixed (bug sweep — 4-agent adversarial review)
- **stats: user variables named e or pi were silently shadowed** by the math
  constants in the uncertainty-propagation evaluator, giving wrong values and a
  zero error contribution. Variables now win over constants.
- **massspec: [M+NH4]+ m/z** subtracted the electron mass twice (~0.55 mDa low);
  and the isotope pattern now anchors peak masses to the true monoisotopic mass
  so molecules with an untabled element (Fe, Mg…) no longer show an m/z-0 base
  peak or masses short by that element.
- **properties: Lipinski/Veber** now test the unrounded values (a true tPSA of
  140.03 no longer rounds down to a Veber pass).
- **finance: bondAnalytics** guards maturity < 1 period (was returning NaN via 0/0).
- **assay/stats: Insert** is disabled when the result is a non-value dash, so a
  bare em-dash is never inserted; serial-dilution guards non-numeric/huge counts.
- **peptide: hyphen/space one-letter input** (AC-DE) is read as one-letter codes
  instead of being dropped as invalid three-letter tokens.
- **toa: patents + other authorities** no longer emit two consecutive
  "Other Authorities" headings (both renderers).
- **citations: hyphenated compound parties** keep their state name
  (Georgia-Pacific no longer becomes Ga.-Pacific); formatDate passes impossible
  dates through unchanged.
- **dna: reverseComplement** keeps RNA as RNA (complement of A is U, not T).
- 11 regression tests added (1257 total).

## [1.47.0] — 2026-07-13

### Added (Stats mode — roadmap #6)
- **New Stats tool.** Descriptive statistics (n, mean, SD, SEM, median, 95% CI,
  CV); **t-tests** (two-sample Welch/Student and paired) with p-values and APA
  reports; **one-way ANOVA**; **linear regression** (slope, R², slope p); and
  **uncertainty propagation** (formula + value±uncertainty lines → combined 1sigma).
  Insertable as text.
- New pure : p-values via the regularized incomplete beta
  (Student-t & F tails), plus a small multi-variable formula evaluator driving
  first-order (quadrature) error propagation. 13 tests against known statistical
  values.

## [1.46.0] — 2026-07-13

### Added (Peptide mode — roadmap #5)
- **New Peptide tool.** Draw a peptide 2D structure from its sequence — one-letter
  (ACDEFG) or three-letter (Ala-Gly-Ser) codes — and insert it. Reports residue
  count, molecular formula, and MW; flags unrecognized residues. The structure
  shows connectivity only (stereochemistry is intentionally not drawn, to avoid
  asserting a wrong configuration).
- New pure : sequence parser (one-/three-letter) + SMILES
  builder for all 20 standard residues (free termini, proline ring handled). 28
  tests, including each residue built alone matching its known free-amino-acid
  formula and dipeptides losing one water per bond.

## [1.45.0] — 2026-07-13

### Added (Mass Spec mode — roadmap #4)
- **New Mass Spec tool.** From a name / formula / SMILES: exact **monoisotopic**
  and **average** mass, the theoretical **isotope pattern** (M, M+1, M+2… bars with
  relative intensities — e.g. a chlorine’s ~32% M+2), and common **adduct m/z**
  ([M+H]+, [M+Na]+, [M+K]+, [M+NH4]+, [M+2H]2+, [M-H]-, [M+Cl]-, [M+HCOO]-, [M-2H]2-).
  Insertable as text. For proteomics / metabolomics / small-molecule MS.
- New pure : masses from OpenChemLib, isotope pattern by
  discrete convolution over NIST stable-isotope abundances (C, H, N, O, S, P,
  halogens, Si, Se, B, Na, K; other elements reported, not dropped), exact adduct
  arithmetic. 12 tests cross-check the M peak against OCL and known Cl/S patterns.

## [1.44.0] — 2026-07-13

### Added (opt-in online name→structure — roadmap #2)
- **Resolve arbitrary IUPAC names via the EMBL-EBI OPSIN service.** When the
  offline dictionary does not know a systematic name, a **Resolve name online**
  button (Chemical mode) parses it through OPSIN and draws the returned structure
  offline, reporting its InChIKey. There is no offline OPSIN build, so this is the
  ONE feature that leaves the machine — it is **strictly opt-in**: off until
  clicked, gated behind an **in-pane consent prompt** (Office add-ins can not rely
  on window.confirm) that names the service before the name is sent, consent is
  **per-session**, and it warns against use for confidential names.
- New  (pure URL builder + response parser unit-tested; only the
  fetch touches the network). Verified the service is CORS-enabled for the add-in
  origin. 5 tests (1193 total).

## [1.43.3] — 2026-07-13

### Fixed
- **2D structures no longer look cluttered for stereo-rich molecules.** Suppressed
  the OpenChemLib R/S/"abs" stereo-descriptor text tags in the depiction (Chemical
  and Build modes): on a molecule with many stereocentres (e.g. paclitaxel, 11) the
  CIP/ESR labels piled onto the bonds and overlapped. Wedge bonds still convey the
  stereochemistry; query/R-group labels are unaffected.

## [1.43.2] — 2026-07-13

### Changed
- **Redesigned the property readout for clarity.** Metrics now sit in an aligned
  label/value list (one shared right-hand value column, tabular figures) and each
  druglikeness screen is a PASS/FAIL pill with its criteria on a separate muted
  line — so a many-violation compound (paclitaxel) reads cleanly. Verified at
  task-pane width before shipping.

## [1.43.1] — 2026-07-13

### Changed
- **Tidied the property readout.** Replaced the dot-separated lines (which wrapped
  and broke mid-word for big molecules like paclitaxel) with a compact two-column
  metric grid and **color-coded pass/fail rows** for the Lipinski/Veber screens,
  so a druglikeness-failing compound reads cleanly instead of as a wall of text.

## [1.43.0] — 2026-07-13

### Added (physicochemical properties & druglikeness — Chemical mode)
- Resolving a structure (name / formula / SMILES) now also shows a **property
  readout**: **cLogP**, **logS**, **topological PSA**, **H-bond donors/acceptors**,
  **rotatable bonds**, **heavy atoms**, plus the **Lipinski Rule of Five** and
  **Veber** oral-druglikeness screens with the exact passing/failing criteria.
  Insertable as a text summary. Roadmap item #3 toward winning life-science PhDs
  from ChemDraw (which gates these behind a license tier).
- Computed offline via OpenChemLib's validated estimators (already bundled) — no
  new dependency, no network. New `src/lib/properties.ts`; 6 tests validate
  against known values (aspirin, caffeine, ibuprofen) and a druglikeness-failing
  natural product (paclitaxel). Advisory — estimates, verify before relying.

## [1.42.2] — 2026-07-13

### Fixed
- **Bio/Assay mode now opens.** The tool was added to the home cards and the mode
  switch but not to the top tool-selector `<select>`; clicking the card set an
  unknown value, so `currentMode()` came back empty and the pane showed only the
  dropdown with no calculator. Added the missing `Bio/Assay` option to the
  selector's Biology group.

## [1.42.1] — 2026-07-13

### Fixed (updates now reach installed clients)
- **Content-hashed the bundle filenames** (`taskpane.[hash].js`, dynamic chunks,
  commands) so each deploy is a URL Office/WebView2 has never cached. Previously
  the fixed `taskpane.js` name meant Word kept serving a **stale cached bundle**
  after an update (e.g. the Bio/Assay mode wouldn't appear until the Office web
  cache was manually cleared). The manifest still points at the fixed
  `taskpane.html`, whose script reference now updates every release.

## [1.42.0] — 2026-07-13

### Added (Bio/Assay mode — quantitative life-science tools)
- **New Bio/Assay task-pane mode** bringing offline curve fitting into Word — the
  first step of the chem/math push for life-science PhDs. A Levenberg–Marquardt
  nonlinear-least-squares engine (`src/lib/assay.ts`, pure/Office-free) fits data
  entirely client-side, reports parameters with **standard errors** and **R²**,
  and overlays the **fitted curve on the data** as an insertable plot.
- **Enzyme kinetics** — Michaelis–Menten and Hill fits, k_cat and catalytic
  efficiency, plus the Lineweaver–Burk / Eadie–Hofstee / Hanes–Woolf
  linearizations (which also seed the nonlinear fit).
- **Dose–response** — 4-parameter logistic → **IC50 / EC50**, Hill slope, pEC50
  (agonist and inhibition curves share one model); **Cheng–Prusoff** K_i.
- **Binding** — one-site saturation (B_max, K_d).
- **Lab calculators** — Henderson–Hasselbalch, Beer–Lambert, dilution / serial
  dilution, and A260 / A280 nucleic-acid and protein quantitation.
- 15 tests validate parameter recovery from noise-free and noisy synthetic data
  (total suite 1182). Analysis aid — verify before publishing.

## [1.41.0] — 2026-07-13

### Added (compound library — large & complex structures)
- **100 new named compounds** in the structure dictionary (259 → 359), covering
  the large/complex molecules the library previously lacked: natural-product
  pigments and metabolites (**violacein**, indigo, curcumin, resveratrol,
  quercetin, capsaicin, β-carotene, lycopene, chlorophyll a, genistein,
  catechin, tannic acid), steroids and hormones (cholesterol, testosterone,
  estradiol, progesterone, cortisol, prednisone, dexamethasone, aldosterone,
  cholic acid), alkaloids (morphine, codeine, quinine, atropine, cocaine,
  strychnine, berberine, reserpine, mescaline, psilocybin), larger drugs
  (paclitaxel, amoxicillin, penicillin V, tetracycline, warfarin, sildenafil,
  atorvastatin, omeprazole), and vitamins/cofactors (retinol, cholecalciferol,
  tocopherol, folic acid, biotin, riboflavin, thiamine, ATP/ADP/AMP/GTP, NAD,
  FAD, glutathione, heme b).
- Common **synonym aliases** so users can type the name that comes to mind
  (e.g. taxol → paclitaxel, l-dopa → levodopa, vitamin A/D/E/B-series letters,
  heme → heme b, adenosine triphosphate → ATP).
- Every SMILES is sourced from **PubChem** and validated against OpenChemLib;
  molecular formulas match PubChem exactly, including the metal-containing
  chlorophyll a (C55H72MgN4O5) and heme b (C34H32FeN4O4).

## [1.28.0] — 2026-07-05

### Added (ST.26 feature annotation)
- **Annotate CDS / gene features on sequences.** Each sequence can now carry
  features beyond the mandatory source feature — pick a key (CDS, gene, mRNA,
  misc_feature, sig_peptide, mat_peptide), a location (e.g. `1..300`), and the
  common qualifiers (`/gene`, `/product`, `/note`).
- **CDS `/translation` is auto-generated** from the coding region using the
  verified NCBI genetic code (stops at the first stop codon), with `/codon_start`
  — unless you supply your own. A CDS whose length isn't a multiple of 3, or with
  a non-simple location, is flagged with a reading-frame warning.
- The generated XML stays well-formed (verified) and everything is still labeled
  a drafting aid — **validate in the WIPO Sequence tool before filing** (the
  authoritative validator). Plain sequences without features work exactly as
  before.

## [1.27.0] — 2026-07-05

### Added
- **Numerals: non-parenthesized callouts.** The reference-numeral audit now also
  recognizes the "housing 12" / "housing (12)" house style — matched against a
  table entry's own element name, so a numeral written without parentheses is no
  longer falsely reported "unused" (and it can't turn arbitrary prose numbers
  into false orphans).
- **Citations: unknown-reporter advisory.** When a case's reporter isn't a
  recognized abbreviation, the preview shows a "not a recognized reporter — check
  the Bluebook (Table T1)" note, so a typo'd or wrong-form reporter isn't
  inserted unnoticed.

## [1.26.0] — 2026-07-05

### Added (Tier-2 features)
- **Stacked charts.** Table → Chart adds **stacked column**, **stacked bar**, and
  **stacked area** — the value axis spans the per-category total (handling mixed
  positive/negative), with matching stacked PowerPoint export.
- **Parallel citations.** The case citation type has an optional "Parallel
  cite(s)" field, placed after the primary reporter and before the year per
  Bluebook Rule 10.3.1 (e.g. *… 573 U.S. 208, 134 S. Ct. 2347, 189 L. Ed. 2d 296
  (2014)*).
- **ST.26 mol_type vocabulary.** Each sequence can now pick the correct source
  `mol_type` from the full ST.26 controlled vocabulary — genomic DNA / other DNA
  for DNA; genomic RNA / **mRNA / tRNA / rRNA** / other RNA / transcribed RNA /
  viral cRNA for RNA — instead of always "genomic". Clarified that the tool
  emits the mandatory source feature (valid for plain sequences); CDS/gene
  annotation is done in WIPO Sequence.

## [1.25.1] — 2026-07-05

### Fixed (low-severity bug-hunt cleanups)
- **Plot: one bad function no longer blanks the whole plot.** With several
  `;`-separated functions, a single un-evaluable one is now skipped with a soft
  "Skipped …" note while the valid functions and data still render (it only
  errors when nothing at all can be drawn).
- **Search: late matches aren't dropped.** The match score stays positive, so a
  keyword that appears past character 50 in a long label still shows up.

## [1.25.0] — 2026-07-05

### Added / Fixed (Tier-1 finalization)
- **Graceful capability detection.** Native-equation and field-based Table-of-
  Authorities inserts (which need Word's OOXML API, WordApi 1.3) now check
  support first: on an older Word or a host that lacks it, they fall back with a
  clear message (equations → formatted text; TOA → use the static list) instead
  of throwing a raw error.
- **Reference numerals: sub-part callouts.** `(12a)`, `(12b)`, `(12')` are now
  recognized as base numeral 12, so sub-part callouts aren't reported as
  orphans. The "next numeral" suggestion also ignores incomplete (blank-element)
  rows.
- **Figure insert echoes truncation warnings.** When a table figure/flowchart/
  block diagram exceeds its size limit, the insert confirmation now repeats the
  "only the first N …" warning so a truncated figure isn't inserted unnoticed.

## [1.24.0] — 2026-07-05

### Fixed (comprehensive bug-check pass)
- **Chemistry: polyatomic ions were mis-parsed.** `NH4+` reported N:1 H:1 charge
  +4 (mass 15); now correctly H:4, charge +1, mass 18.04. Fixed across the
  validator (molecular weight/charge) and the formula renderer: a subscript
  count before a bare sign (NH4+, NO3⁻, HCO3⁻, H2PO4⁻, H3O⁺) keeps the count and
  takes a ±1 charge, while a monatomic metal cation (Ca²⁺, Fe³⁺) still reads the
  digit as the charge.
- **Citations:** the patent pincite no longer truncates (`col. 3 ll. 15–20` was
  becoming `col. 3`); a case with an **em-dash** pincite range (`208—216`) now
  parses instead of failing; and `§` vs `§§` is smarter — `1.84(a), (b)` (one
  section, two subsections) stays `§`, while `101, 102` uses `§§`.
- **Math:** a repeated superscript/subscript (`x^2^3`) no longer silently drops
  the earlier one — it nests right-associatively.
- **Figures:** `svgToPngBase64` encodes in chunks, so large flowcharts/diagrams
  no longer risk a stack-overflow during rasterization.
- **Docs:** corrected stale README (version, tool count, test count, and the
  outdated "math is inline-only" note that contradicted the OMML feature).

## [1.23.0] — 2026-07-05

### Added (Finance — robust modeling)
- **The Finance calculator gained a full modeling toolkit** (8 → 18
  calculators), all verified against known closed-form values:
  effective annual rate; growing-annuity PV; **loan amortization** (payment,
  total interest, total paid); **DCF valuation** with a Gordon terminal value;
  **XIRR** for dated cash flows; **bond yield-to-maturity**; **bond duration &
  convexity** (Macaulay + modified); **option Greeks** (Δ Γ vega θ ρ);
  **implied volatility**; **declining-balance depreciation** schedule; and
  **annualized return / volatility / Sharpe** statistics.
- Engine additions in `finance.ts` (+17 tests): a shared robust root-finder
  (scan-for-sign-change + bisection) powers the YTM, implied-vol, and XIRR
  solvers so they don't need a good initial guess. Existing formulas
  (TVM, NPV/IRR, Black–Scholes, bond pricing) re-verified against reference
  values.

## [1.22.4] — 2026-07-05

### Verified
- **Full reference-data audit against current authoritative standards.** Every
  hardcoded scientific dataset was checked against its primary source and found
  correct (only the pKa N-term, fixed in 1.22.3, needed a change):
  periodic table → IUPAC/CIAAW; restriction sites → REBASE; unit factors →
  SI/CODATA; genetic code → NCBI table 1; residue masses → Expasy FindMod;
  hydropathy → Kyte & Doolittle; pKa → EMBOSS iep (`Epk.dat`); primer Tm →
  OligoCalc; 360 compound SMILES → all valid (OpenChemLib); WIPO ST.26 DTD →
  V1_3 (still current); botanical ranks → ICN/ICNCP. Documented the Tm source.

## [1.22.3] — 2026-07-05

### Fixed
- **pI N-terminal pKa now matches EMBOSS iep's data file** (`Epk.dat`): N-term
  8.6 → **7.5**. Verifying against the actual iep data file (not the older
  "EMBOSS scale" of 8.6 reproduced in some tools) showed the shipped value is
  7.5; the other eight values already matched. A side-chain-free peptide now
  gives pI = (7.5 + 3.6)/2 = 5.55, as iep does.

## [1.22.2] — 2026-07-05

### Changed
- **Protein residue masses aligned to Expasy.** Adopted Expasy FindMod's
  full-precision average residue masses (were 2-decimal — Thr was 101.1 vs
  Expasy 101.1051) and Expasy's average water mass (18.02 → 18.01524), so
  protein molecular weight now matches Expasy ProtParam exactly (e.g. AAAA →
  302.33). Selenocysteine recomputed from the verified periodic table
  (150.04 → 150.05, current Se).

## [1.22.1] — 2026-07-05

### Fixed
- **Protein pI now uses the EMBOSS pKa set** (as used by EMBOSS iep/pepstats),
  so the estimate matches that authoritative reference. Corrected N-term
  9.0→8.6, C-term 3.1→3.6, Cys 8.3→8.5, His 6.0→6.5, Lys 10.5→10.8 (Asp, Glu,
  Arg, Tyr already matched). A peptide with no ionizable side chains now gives
  pI = 6.10 = mean of the terminal pKa, exactly as EMBOSS does.

## [1.22.0] — 2026-07-05

### Added / Changed (STEM tools)
- **Full chemical-formula validator.** New `chemValidate.ts` with the real
  118-element periodic table (IUPAC standard atomic weights): the Chemical
  formula tool now validates live — flags **unknown element symbols** (case-
  sensitive: Co ≠ CO) and unbalanced brackets, and for a valid formula shows the
  Hill formula, **molecular weight**, and net charge. Handles nested groups
  (`K4[Fe(CN)6]`), charges (`Ca2+`, `SO4^2-`), and hydrates (`CuSO4·5H2O`).
- **Inline math symbols.** Greek letters by name (`alpha`→α … `Omega`→Ω) plus
  `sum`/`int`/`prod`/`partial`/`nabla`, more relations/arrows (`<=>`, `<->`,
  `=>`, `approx`, `times`), on top of the existing set.
- **Chemical formulas: charges after a count.** `Ca2+`→Ca²⁺ and `[Fe(CN)6]3-`
  now render the trailing sign as a charge (not a subscript).
- **Reaction schemes: reversible & retro arrows.** `<=>` / `⇌` draw an
  equilibrium arrow; `<-` / `←` draw a retrosynthetic arrow.
- **DNA: more restriction enzymes.** The type-II enzyme set grew from 19 to ~48
  (unambiguous sites), e.g. AatII, AflII, AgeI, AscI, DraI, FseI, PacI, PmeI,
  SbfI, SwaI. Also replaced deprecated `String.substr`.
- All added data (atomic weights, enzyme recognition sites, unit factors) are
  real reference values, not placeholders.

## [1.21.0] — 2026-07-05

### Added / Changed (STEM tools)
- **Units — many more units.** Added electrical & EM units (Hz/kHz/MHz/GHz,
  A/mA/µA, V/mV/kV, W/mW/kW/MW/hp, Ω/kΩ/MΩ, F/µF/nF/pF, C, H, S, T/mT), chemistry
  units (M/mM/µM/nM/pM molarity, Da/kDa/MDa, %, ppm/ppb/ppt), and more SI prefixes
  (pm, ns/ps, ng/pg, nL) — with spelled-out aliases (volt, ohm, molar, dalton…).
  The compound-unit parser now handles multiple slashes (`mol/L/s`).
- **Plots — more functions & colors.** The expression evaluator now supports
  multi-argument functions (`atan2`, `min`, `max`, `hypot`, `mod`, `pow`) plus
  `cbrt`, `factorial`/`fact`, and `trunc`, with argument-count validation. The
  series palette grew from 5 to 10 distinct colors.
- **Table → Chart — scatter + K/M/B.** New **Scatter (points)** chart type;
  cell parsing now understands magnitude suffixes (`1.2K` → 1200, `3M`, `2bn`),
  while real unit letters (`12kg`) are left alone.

## [1.20.0] — 2026-07-05

### Added
- **Supra source auto-detection.** On the Supra type, "Detect earlier source"
  scans the document above the cursor for a prior **law-review article**, and
  fills the author with its Bluebook supra short form — surname(s), e.g.
  *Lemley* or *Lemley & O'Brien* — for you to finish with the footnote number /
  pincite. New pure `findPrecedingSecondarySource()`. (Treatises/books are too
  ambiguous to detect from prose, so they remain manual; supra is limited to
  secondary sources per Rule 4.2.)

## [1.19.0] — 2026-07-05

### Changed
- **Field-based Table of Authorities now marks every occurrence** of each
  authority (not just the first), so the compiled table shows the full page
  range for each cite. The status line reports both the authority count and the
  total citations marked.

## [1.18.0] — 2026-07-05

### Added
- **Table of Authorities with real page numbers (Word fields).** A second TOA
  option, "Insert with page numbers (Word fields)", marks each citation with a
  hidden Word **TA** field and inserts **TOA** fields at the cursor; selecting
  all and pressing **F9** compiles the table with page numbers that update as
  the document changes. The original page-number-free "static list" remains.
  New pure `authoritiesForToa()`, `taFieldOoxml()`, `toaFieldsOoxml()` emitting
  flat-OPC OOXML (validated well-formed). Patents share Word's "Other
  Authorities" category (Word has no Patents category). Marks the first
  occurrence of each authority; review the result in Word.

## [1.17.0] — 2026-07-05

### Added
- **Case-name geographic abbreviation (Bluebook Table T10).** The case-name
  abbreviator now also applies U.S. state abbreviations (California → Cal.,
  Massachusetts → Mass., New York → N.Y., …), honoring the named-party
  exception (Rule 10.2.1(f)) — a bare state party (*California v. Texas*) or a
  "State of X" / "City of X" government party stays unabbreviated, while a state
  inside a larger name (*University of California* → *Univ. of Cal.*) abbreviates.
- **Id. preceding-authority detection.** On the Id. type, "Insert Id. for the
  preceding authority" scans the document above the cursor, confirms what the
  Id. refers to, and inserts it (with your pincite). New pure
  `findPrecedingAuthority()`.

### Fixed
- Repaired stray NULL bytes accidentally introduced into `abbreviateCaseName`
  in an earlier edit (output was unaffected; source is now clean).

## [1.16.0] — 2026-07-05

### Added
- **Case-name auto-abbreviation (Bluebook Table T6).** Type the full party names
  and the tool abbreviates them per Rule 10.2.2 — Corporation → Corp.,
  International → Int’l, Association → Ass’n, National → Nat’l, Manufacturing →
  Mfg., `and` → `&`, and ~90 more (with common plurals). "United States" is left
  intact as a party. A checkbox on the case / case short-form types (on by
  default) applies it live in the preview so you can review or turn it off.
  New pure `abbreviateCaseName()` (+4 tests).

## [1.15.0] — 2026-07-05

### Added
- **Table of Authorities builder.** In Citations mode, scan the whole document
  for citations and insert a grouped, alphabetized authorities list — Cases,
  Statutes, Regulations, Patents, and Other Authorities (Fed. Reg., MPEP) —
  de-duplicated, with case names italicized. The scanner recognizes case names
  (including "In re"/"Ex parte" and corporate suffixes like ", Inc."), U.S.C.,
  C.F.R., patents & publications, the Federal Register, and MPEP. Page numbers
  are not included (a text scan can't recover them) — add them, or use Word's
  native TA/TOA fields for automatic pages. New pure `toa.ts` (+11 tests).

## [1.14.0] — 2026-07-05

### Added
- **Citations: id. / supra short forms.** New `Id.` type (`Id.` or `Id. at 217`,
  italic) for the immediately preceding authority, and a `Supra` type
  (`Lemley, supra note 15, at 912`) for an earlier source. Plus a one-click
  **“→ Short form of this case”** helper that turns a full case citation into
  its short form (first party + reporter + pincite) for you to review.

## [1.13.3] — 2026-07-05

### Changed
- **Logo now fuses STEM + legal.** The balance scale's pans are hexagonal
  molecular rings — law (scale) meets STEM (chemistry) in one mark. Regenerated
  at all icon sizes; still legible at 16 px.

## [1.13.2] — 2026-07-05

### Changed
- **New JurisLab logo.** Replaced the ribbon/add-in icon with a balance-scale
  mark in the brand blue, rendered at 16/32/64/80/128 px (source in
  `assets/logo.svg`). Because the icons load from the hosted site, the new logo
  appears in Word without a reinstall (after Office refreshes its icon cache).
  The add-in name was already "JurisLab" (since 1.12.0); the ribbon name updates
  on the next manifest reinstall. Logo also added to the landing page header.

## [1.13.1] — 2026-07-04

### Changed
- **Citations cross-checked against canonical Bluebook example forms.** Each
  type's output was compared to the standard example the Bluebook publishes for
  its rule (R.10 cases, R.12 statutes, R.14 regs/patents/Fed. Reg., R.15/3.2
  treatises, R.16 articles); those canonical forms are now pinned as tests.
  Result: the formats match for the common types. One gap fixed — the
  book/treatise type gained an optional **Volume** field so multi-volume works
  cite the volume before the author (`1 Donald S. Chisum, Chisum on Patents
  § 3.02 (2023)`).
  - Known limitation (documented, not a format error): case names are not
    auto-abbreviated per Table T6 — enter the abbreviated party name. Still a
    drafting aid; verify against the current Bluebook.

## [1.13.0] — 2026-07-04

### Added
- **Citations: practitioner / academic style toggle.** The two Bluebook
  typeface systems now render correctly — *Practitioner* (briefs/office
  actions) italicizes case names and book titles; *Academic* (law-review
  footnotes) sets full-citation case names roman and authors/journals in
  large-and-small caps.
- **Citations: reporter & court auto-correct.** Reporters and courts normalize
  to canonical Bluebook abbreviations (`f3d`→F.3d, `f supp 2d`→F. Supp. 2d,
  `fed cir`→Fed. Cir., `9th cir`/`ninth circuit`→9th Cir., `cafc`→Fed. Cir.,
  `sdny`→S.D.N.Y.), applied both in the paste-parser and when formatting.

### Notes
- Still a drafting aid — it applies common Bluebook conventions (not the full
  manual). Verify against the current Bluebook before filing.

## [1.12.4] — 2026-07-04

### Changed
- **Tool navigation is now a dropdown, not a 16-tab strip.** Once you're in a
  tool, a compact "Tool" dropdown (grouped by category, with a Home option to
  return) replaces the crowded row of tabs. Home still shows only the grouped
  cards. Less clutter on every screen.

## [1.12.3] — 2026-07-04

### Changed
- **Block-diagram numbering keeps the grouped look *and* stays unique.** The
  1.12.2 fix made numbering sequential (100, 102, 104…) to guarantee
  uniqueness. This restores the familiar grouped style — roots at 100/200,
  subsystems at 110/120/130, parts at 112/114 — by computing the stride at
  each level from the actual fan-out and widening it (e.g. to twenties) only
  when a branch is dense enough that the default spacing would collide. Best
  of both: typical figures look classic, dense ones remain collision-free.

## [1.12.2] — 2026-07-04

### Fixed
Comprehensive bug-review pass (parallel subsystem reviews). Verified fixes:
- **Duplicate reference numerals** on dense block diagrams — a subsystem with
  ≥5 parts could reuse the next subsystem's number. Numbering now walks each
  root's subtree in depth-first order (100, 102, 104…), guaranteeing unique
  callouts (was 100/110/112, which collided).
- **Section band labels dropped** in the Table-figure → PowerPoint export — the
  downloaded .pptx showed empty shaded band rows; the section text is now
  carried through (Word-table and on-screen figure were already correct).
- **"See also" / "See, e.g.," mis-parsed as "See"** in Citations paste-and-fix,
  leaking the leftover word into the case name — signals now match longest-first.
- **Section ranges kept singular** — `35 U.S.C. 101-103` / `101–103` now use
  `§§`; a hyphen inside one section number (`42 U.S.C. § 2000e-2`) stays `§`.
- **Negative currency `-$300`** (sign before the symbol) parsed as blank in
  table cells — now reads −300.
- Defensive: off-page flowchart connectors continue past 26 pages (AA, AB…).

## [1.12.1] — 2026-07-04

### Changed
- **Tighter Home page** — the Home view now shows only the header and the
  grouped tool cards; the search bar and the 16-tab strip are hidden there
  (the cards are the navigation). Both reappear once a tool is open, with the
  Home tab to return.

## [1.12.0] — 2026-07-04

### Changed
- **Renamed to JurisLab** (formerly Formula Inserter) — the add-in now fuses
  STEM authoring and patent & legal drafting, so the old name no longer fit.
  Display name,
  pane title, ribbon button, landing page, and docs updated. (The GitHub repo,
  hosting URL, install paths, and content-control tags are unchanged, so
  existing installs and tagged content keep working.)

### Added
- **Home page** — opening the pane now shows a Home tab with the 16 tools
  grouped into categories (Chemistry & structures, Math & units, Data &
  figures, Biology, Patent drafting, Legal citations). Click a card to open a
  tool; the top tabs still switch directly.

## [1.11.0] — 2026-07-04

### Added
- **Paste & fix in Citations.** Paste a messy citation and the add-in detects
  its type and fills the form fields to review — covering U.S.C., C.F.R.,
  patents and application publications, the Federal Register, MPEP, cases
  (distinguished from law-review articles by the case name), and a leading
  Bluebook signal. Then it reformats via the normal formatter (auto-grouped
  patent numbers, §§ for multiple sections, Bluebook dates, correct italics).
  Best-effort/heuristic — the filled fields are shown for review before insert.
  New pure `parseCitation` (+10 parser tests).

## [1.10.0] — 2026-07-04

### Added
- **Citations mode (16th mode) — Bluebook legal citations.** Form-field driven,
  covering cases (full + short), statutes (U.S.C.) and regulations (C.F.R.),
  U.S. patents and application publications, the Federal Register, MPEP
  sections, law-review articles, and treatises. Correct italics (case names,
  titles, signals) are applied on insert; patent numbers auto-group, ISO dates
  become Bluebook month form, multiple sections use §§, and optional
  introductory signals (See, Cf., But see, …) are prepended. Insert the
  formatted citation or copy the plain text. New pure `citations.ts` engine
  (+20 tests). Drafting aid — verify against the current Bluebook.

## [1.9.0] — 2026-07-04

### Added
- **Diagrams paginate across PowerPoint slides.** Big diagrams no longer get
  crushed onto one slide:
  - **Flowcharts** split into slide-sized runs of steps joined by patent-style
    **off-page connector circles** (A, B, …); auto reference numerals continue
    across slides (S101…S105 → S106…).
  - **Block diagrams** split by branch, with the **parent box repeated** on
    each continuation slide; numbering is assigned on the full tree first so
    it stays consistent (110/120/130 on slide 1, 140/150 on slide 2).
  - Continuation slides are titled "… (cont.)"; every slide renders near
    natural size with readable text. Verified by rendering the generated
    slides in PowerPoint itself.

## [1.8.2] — 2026-07-04

### Fixed
- **PowerPoint diagrams now match the preview exactly.** The preview and the
  PPT shape export used two different layout engines, so slides came out
  scrambled. The diagram geometry (boxes, connectors, numerals, wrapped text)
  is now computed once and rendered identically to SVG (preview / Word) and
  to native PowerPoint shapes — verified by rendering the generated slides in
  PowerPoint itself. Shapes remain fully editable.

## [1.8.1] — 2026-07-04

### Fixed
- **Block-diagram (and flowchart) shape text no longer overflows in
  PowerPoint.** Long table-cell labels spilled out of the small boxes. Shape
  text now auto-shrinks to fit (PowerPoint normAutofit), paragraph-long
  labels are truncated with an ellipsis, and hierarchy boxes are sized more
  generously.

## [1.8.0] — 2026-07-04

### Added
- **Flowcharts and block diagrams export to PowerPoint as native, editable
  shapes** (rectangles, decision diamonds, rounded terminators, connector
  lines with arrowheads) instead of a flat picture — so the labels and
  reference numerals are editable in PowerPoint. Honors the patent B&W style.
  (In Word, diagrams remain images; editable movable shapes there would need
  OOXML DrawingML, still to come.)

## [1.7.1] — 2026-07-04

### Fixed
- **Inserted Word tables no longer pick up list numbering.** When the cursor
  sat in (or after) a numbered list, every inserted table cell showed a "1."
  etc. The inserted table's cell paragraphs are now reset to Normal and
  detached from any list.
- **Table figure exports to PowerPoint as a native, editable table** instead
  of a picture — the "table figure" representation now uses a real PowerPoint
  table (shaded/bold header, shaded full-width section bands via colspan,
  right-aligned numeric columns), so the text stays editable in PowerPoint too.

## [1.7.0] — 2026-07-04

### Added
- **Editable output for converted tables.** Figures insert as images (text
  baked in); now you can also get editable text:
  - **Insert as an editable Word table** — inserts the table figure as a
    native Word table (bold/shaded header, shaded section rows, right-aligned
    numeric columns) with fully editable text, instead of a picture.
  - **Also insert the data as an editable table below the figure** — a
    checkbox that follows any inserted figure image with an editable Word
    table of the underlying data, so the text is editable even for charts and
    patent line-art.
  - Shared `prepareTableFigure` logic drives both the image and the Word
    table so they stay consistent.

## [1.6.0] — 2026-07-04

### Changed
- **Reference numerals now use lead lines** (37 CFR 1.84(q)), replacing the
  columnar rail and the inside-the-box numbers:
  - Block diagram: numeral sits outside each box's top-left corner with a
    straight lead line to the box (no longer prefixed into the label).
  - Flowchart: numerals alternate left/right of the steps with angled lead
    lines, instead of stacking in a right-hand column.
  - Table figure: free-standing margin numerals, each with a lead line to its
    row/section, staggered across two lanes (rail removed).
  Placement is auto — a starting point the drafter repositions.

## [1.5.0] — 2026-07-04

### Added
- **Auto-pick representation** — reading a table now classifies its shape and
  preselects the best view (chart / flowchart / block diagram / table figure),
  showing the reason. Numeric data charts; grouped or dense tables become a
  table figure; step lists become flowcharts; short hierarchies become block
  diagrams. Fully overridable in "Show as".
- **Reference numerals** — a toggle to number figure elements as patent
  callouts: hierarchical box numbers in block diagrams (100, 110, 112…),
  auto-numbered flowchart steps (102, 104…), and a numeral rail on the table
  figure (sections 100/200, rows 102/104…).

### Changed
- **Table figure polish** — numeric columns are right-aligned, the header is
  shaded with a rule beneath it, a redundant blank section column is dropped
  (no dead left column), light zebra striping in color mode, and a crisper
  outer border.

## [1.4.0] — 2026-07-04

### Added
- **Table figure** representation in Table → Chart — draws the table *itself*
  as a clean figure (not a chart), for characteristics/reference tables where
  the table is the exhibit. Preserves section grouping (group-header rows
  become bands; a blank leading "section" column merges down), bolds the
  header, word-wraps cells, scales wide tables to the pane, and honors the
  patent B&W style + "FIG. N" label. Non-numeric tables now fall back to a
  table figure instead of erroring.

### Changed
- **Smarter chart column detection** for real-world tables: a leading numeric
  **row-index** column or a mostly-blank **section** column is detected and
  skipped so the true text column is used for labels (the section groups
  them). `8,408 (75.0%)` reads as the leading count; a bare `(75.0%)` is now
  +75, not −75 (accountant-negative parentheses no longer apply to bare
  percentages). Dense tables (>24 rows) suggest the table-figure view.

## [1.3.0] — 2026-07-04

### Added
- **Diagrams in Table → Chart** — not every table is numeric, so the "Show as"
  list now offers, besides the six chart types:
  - **Flowchart** — rows become steps drawn top-to-bottom with arrows; a
    first column like `S101` becomes the step's reference numeral, `?` steps
    render as decision diamonds, Start/End rows get rounded terminators, and
    a `Step | Description` header row is skipped automatically.
  - **Block diagram** — rows are paths (`System 10 | Controller 20 | CPU 22`)
    merged into a connected box hierarchy with orthogonal connectors; blank
    cells repeat the value above (merged cells work).
  - Both honor the patent B&W style and the "FIG. N" label, insert as
    figures, and export to PowerPoint (as pictures). Tables with no numeric
    data now auto-switch to flowchart instead of failing.

## [1.2.0] — 2026-07-04

### Added
- **Patent-figure charts** in the (renamed) **Table → Chart** mode:
  - **Insert figure at cursor** — the chart is inserted into the Word document
    as an image (rasterized at 2× for print quality).
  - **Patent figure style** — black-&-white line art for patent drawings:
    hatched bars/slices, dashed lines with distinct marker shapes, all-black
    ink (no color/gray), and an optional **"FIG. N" label** under the chart.
  - The PowerPoint export honors the style: patent mode ships the same B&W
    figure as a picture (native charts can't draw hatching); color mode keeps
    the fully editable native chart.

## [1.1.0] — 2026-07-04

### Added
- **Table → PPT** mode — export the Word table at the cursor as a **PowerPoint
  (.pptx) download** containing a native, fully editable chart (column, bar,
  line, area, pie, or doughnut) plus, optionally, the source table on a second
  slide. Live SVG preview in the pane; tolerant number parsing ($, %, commas,
  units, parenthesized negatives); powered by PptxGenJS, entirely client-side.

## [1.0.0] — 2026-06-21

First production release. The add-in is now a broad STEM authoring suite (14 modes)
on top of one shared, unit-tested engine (793 tests), entirely client-side.

### Added
- **Units** mode — SI-correct quantity typesetting (±, ×10ⁿ, µ/Ω/°), significant
  figures, and unit conversion including compound units (`km/h → m/s`).
- **Plot** mode — offline pure-SVG function & data charts (multiple series with a
  legend, error bars) via a safe expression evaluator (no `eval`).
- **Finance** mode + library — TVM, loan, NPV/IRR, Black–Scholes, and bond
  calculators, plus typeset finance equations in the Math library.
- **DNA** mode — reverse complement, transcription, six-frame translation, GC,
  ORF finder, plus primer Tm, protein MW/pI/GRAVY, and restriction-site scan.
- **Numerals**, **Refs**, and **Audit** modes — reference-numeral management,
  figure/table captions & cross-references, and a whole-document consistency audit
  (numerals, SEQ ID NO, figures, cross-reference validity).
- **Reaction** mode — multi-step reaction schemes with conditions over the arrow.
- **Math** — LaTeX import/export and multi-line aligned equations (`align(…)`).
- **Chemical** — dictionary-based structure→name lookup; tighter (cropped) 2D
  structure images.
- **macOS install pack** and split per-OS packaging.

### Notes
- All inserts run locally; no document content leaves the machine.
- Tagged content controls on key inserts (equations, structures, callouts, …) for
  later re-finding/updating.

## [Unreleased] — internal pilot prep

### Added
- **Substituent gallery** (Build mode) — depict R-group alternatives as drawn
  structures: list `label = SMILES/name` lines (e.g. `R1a = c1ccccc1`) and insert
  each rendered 2D substituent with its label beneath the genus. Closes the last
  Markush "depicted alternatives" gap.
- **Botanical mode** (plant patents) — typeset a scientific name with correct
  nomenclature italics (genus/species/infraspecific epithets italic; rank
  connectors `subsp.`/`var.`/`f.`, authors, hybrid `×`, and cultivars `'…'` roman),
  with quote normalization and genus capitalization; plus a varietal
  **characteristics table** built from "Label: value" lines. Both insert into Word.
- **Markush query features (genus rigor)** in Build mode — a trailing `{…}` block
  constrains a position for a rigorous generic structure: `{ar}` aromatic, `{!ar}`
  aliphatic, `{har}` hetero-aromatic, `{ring}` in-ring, `{!ring}`/`{chain}` chain,
  `{r3}`–`{r7}` ring size (list several for "5 or 6"), `{sub}` bears a further
  substituent, `{nosub}` no further substitution; bonds take `{ring}`/`{chain}`/
  `{ar}`. These set the corresponding OpenChemLib atom/bond query features so the
  inserted structure is a real query genus. New Markush palette buttons.
- **Sequence mode (WIPO ST.26)** — generate a draft ST.26 sequence-listing XML
  from entered nucleotide (DNA/RNA) or protein (AA) sequences: per-sequence
  molecule type and organism, residue cleanup/validation (whitespace & numbering
  stripped, IUPAC ambiguity codes accepted, invalid residues flagged), applicant/
  title/application metadata, and a generated source feature with mol_type +
  organism qualifiers. Output can be downloaded as `.xml` or copied. Marked a
  drafting aid — validate in the WIPO Sequence tool before filing.
- **Code mode** — a new mode for **pseudocode/algorithm blocks** (bold control-flow
  keywords, optional line numbers, optional caption like "Algorithm 1: KeyGen") and
  **verbatim code listings** (monospace, whitespace-preserving, optional line
  numbers). Inserts as a clean monospace block with a live preview.
- **Popular-functions section** — palette groups and matching formula-library
  categories for the most-used functions by family: **Trig** (sin/cos/tan, recip,
  inverse), **Hyperbolic** (sinh…coth), **Log & exponential** (ln/log/lg/exp/log_b),
  **Special** (Γ, ζ, erf/erfc, sgn, sigmoid), and **Discrete & combinatorics**
  (C(n,k), P(n,k), factorial, gcd/lcm, mod, floor/ceil). ~30 more function names
  now render upright (sech, csch, coth, arsinh/arcosh/artanh, erf, sgn, Var, Cov,
  Tr, rank, …).
- **Collapsible palette groups** — the Math symbol palette is now an accordion
  (groups expand/collapse, state remembered per mode), so it stays clean as the
  symbol set grows; the formula-library dropdown is grouped into "Mathematics" and
  "Science & engineering".
- **Electrical-engineering & physics support** — new formula-library categories
  (Ohm/impedance/reactance/resonance/dB/phasors; E=mc², Schrödinger, Planck,
  de Broglie, uncertainty, Coulomb, gravitation, ideal gas) plus notation:
  **Dirac bra-ket** (`bra`/`ket`/`braket`), contour/multiple integrals
  (`oint`/`iint`/`iiint`), phasor `∠`, `ℏ`, `Ω`, Laplace `ℒ` / Fourier `ℱ`
  transforms, and `Re`/`Im` parts.
- **Domain notation & formula libraries** for non-chemistry practice areas —
  logic/set-theory/quantifier symbols (∀ ∃ ∈ ∉ ⊆ ∪ ∩ ∅ ∧ ∨ ¬ ⊕ ⇒ ⇔), blackboard-
  bold number sets (ℤ ℝ ℕ ℚ ℂ 𝔽 𝔼), `floor`/`ceil`/`norm` (⌊⌋ ⌈⌉ ‖‖), `partial`
  (∂), `nabla` (∇), upright `mod`, degree (°), and square-bracket grouping (e.g.
  `[S]` concentrations) — all typeable as words or inserted from new **Logic &
  sets / Number sets / Advanced** palette groups. Added formula-library categories
  for **Cryptography**, **Computer science / ML**, **Mechanical engineering**, and
  **Biology / assays**.
- **Centralized-deployment guide** (`packaging/CENTRALIZED-DEPLOY.md`) for IT
  admins to push the add-in via the Microsoft 365 admin center (Integrated Apps)
  instead of the per-user installer. Corrected `DISTRIBUTION.md` to describe the
  actual per-user **Developer Add-ins** install (the network-share Trusted Catalog
  method, which did not work on the target build, is no longer presented as the
  flow). The package script's stamped `manifest.xml` doubles as the validated
  deploy manifest.
- **Matrices & piecewise/cases** in the math engine — `matrix(a, b; c, d)` (rows
  separated by `;`, columns by `,`), with `pmatrix` / `bmatrix` / `vmatrix` for
  `( )`, `[ ]` and `| |` (determinant) delimiters, and `cases(x, if x>0; -x,
  otherwise)` for piecewise functions. All emit real Word equation objects (OMML)
  and render in the live preview; new palette "Matrices" group.
- **Carbon-range shorthands** in R-group definitions — typing `C1-6 alkyl` or
  `C1-C6 alkyl` expands to `C₁–C₆ alkyl` (subscript counts, en-dash) on insertion;
  ordinary formulas like `C2H5` are left untouched.
- **More definition shorthands** — `opt sub` / `opt. subst.` → "optionally
  substituted …"; variable-count ranges like `n=1-3` → `n = 1–3`, and plain
  integer ranges (`4-6 membered`) get an en-dash. Substituent locants such as
  `indazol-3-yl` are left alone.
- **Sub-generic Markush definitions** — when an R-group definition references a
  nested label (e.g. `R1 = C1-6 alkyl substituted with R1a`), an input for the
  sub-group (`R1a`) appears automatically and is included in the inserted legend
  (line or table). Detection is transitive and ignores ordinary words.
- **Structured Markush tables** — R-group definitions can be inserted as a
  two-column **R-group | Definition** table (toggle "Insert as: Line / Table" in
  the Build pane) in addition to the inline "where R1 = …" line.
- **R-group legend** — when a built structure has R-groups, a definition box
  collects `R1 = …`, `R2 = …`, and insertion adds a "where R1 = …; R2 = …" line
  beneath the structure.
- **Stereochemistry**: isomeric SMILES (Chemical mode) renders wedge/hash bonds;
  Build mode adds wedge (`>`) and hash (`<`) stereo bonds.
- **Richer Markush atoms** in Build: `A` (any atom), `Q` (any heteroatom),
  `R`/`R1`/`R2`… (R-group attachment points), plus the existing `[C,N]` lists and
  `X` halogen — with a "Markush / query atoms" button row.
- **Automated test suite** (Jest + ts-jest): 445 tests over parsers, OMML
  emitter, formula library, builder, and the full compound dictionary. Run with
  `npm test`.
- **CI** (`.github/workflows/ci.yml`): type-check, tests, dictionary validation,
  production build, manifest validation.
- **Equation numbering** — optional right-aligned **(I), (II), …** with a
  persistent counter and reset.
- **Structure provenance** — inserted structures carry molecular formula, MW,
  canonical SMILES, and OpenChemLib ID code in the image alt-text; the pane shows
  formula / MW / SMILES.
- **Markush / generic structures** in Build mode — `[C,N]` atom lists, `~`
  undefined/any bonds, and the `X` halogen shorthand.
- **Clickable palettes** (math + chemical), **Build bond buttons**, and **Build
  common-structure templates**.
- **Search** across formulas and compounds; **recents & favorites** (with a
  **Clear** control for confidentiality).
- **Formula library** (Statistics / Geometry / Algebra / Trigonometry / Calculus)
  and an extended math engine (Σ, ∫, ∏, roots, functions, |x|, limits, accents,
  factorials, implicit multiplication, literal Greek).
- **Confidentiality disclaimer** in the pane.
- Distribution, security, third-party-license, and user-guide docs;
  `manifest.prod.xml` template.

### Notes / known gaps (tracked for next iterations)
- Build wedge/hash bonds are indicative; for exact, parity-defined stereo prefer
  isomeric SMILES in Chemical mode.
- "Optionally substituted" shorthands and variable counts / C1–C6 alkyl ranges
  are not yet generated automatically. R-group legends are free-text (not yet a
  structured Markush table with sub-generic definitions).
- Sequence listings (WIPO ST.26) out of scope.
- Compound dictionary SMILES are validated to **parse**; a chemist should
  spot-verify chemical correctness before claim-critical use.
- Cross-platform (Mac / Word on the web) and a Content-Security-Policy need
  validation in-host during the pilot (see `SECURITY.md`).

## [0.1.0] — initial scaffold
- Office.js Word add-in: chemical & math formatting, 2D structures, native Word
  equations, Build mode.
