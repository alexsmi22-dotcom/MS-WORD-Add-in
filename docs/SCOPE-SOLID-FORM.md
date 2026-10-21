# Solid form (XRPD, DSC, TGA) — scope

Gap item 2 of the 2026-10-21 "five gaps" directive. Polymorph, salt and co-crystal patents rest on three
measurements, and their claims cite them in fixed phrases. JurisLab reads the user's own instrument exports and writes
the peak table, the claim text and the figure. **Nothing is predicted**: every number comes from the pasted data.

## What it does

| Kind | Input | Out |
| --- | --- | --- |
| XRPD | A measured pattern (two columns, 2θ and counts, fine steady step) **or** a typed peak list (2θ, optionally an intensity; one per line or comma-separated) | Peak table (2θ, d, relative intensity), the "characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about … ± 0.2° 2θ" text citing the N strongest by angle, the diffractogram (or a stick plot for a list) |
| DSC | Temperature (°C), heat flow | Events table (endotherm/exotherm, onset, peak), the Example sentence, the thermogram labelled exo up / endo up |
| TGA | Temperature (°C), weight (% or mg) | Steps table (range, % loss of the starting weight, fastest-loss temperature), the Example sentence, the thermogram |

## Methods (lib/solidform.ts)

- **Reading**: one table reader for every kind. Headers and metadata lines are skipped (and counted); the separator
  (semicolon, tab, comma or spaces) and decimal commas are decided once for the whole input, not line by line
  (`3,02<tab>202`, `3,02 202`, `5,2;10,4`). A thermal export with more than two columns (time, temperature, signal) has its
  temperature and signal columns chosen by header name, else by shape; the choice is always stated, and the pane offers
  column pickers to change it.
- **Bragg**: d = λ / (2 sin θ), first order. Cu Kα1 1.540598 Å, Cu Kα2 1.544426 Å, Cu Kα weighted 1.541874 Å, Co Kα1
  1.788965 Å, Mo Kα1 0.709300 Å (Hölzer et al. 1997; International Tables C 4.2.2).
- **Pattern or list**: about 30 or more points on a steady step (the steps vary little) is a measured pattern (steps up
  to 0.5°); anything else is a list. A list may be 2θ alone, 2θ and intensity, or a `2θ d I` table — the d column is
  recognised by agreeing with Bragg's law, in whichever position; °, % and ± marks are ignored; peaks within 0.05° merge,
  and the note says so.
- **Peak picking**: Savitzky–Golay smoothing over about ±0.05° when the step allows two points each side (coarser
  patterns are used as measured); background by SNIP
  clipping over about 1° (log–log–square-root transform, decreasing windows, mirrored at the ends), so broad features —
  an amorphous halo, a steep low-angle rise — stay in the background; the clipping's low bias is removed degree by degree.
  The **noise floor is measured from the pattern itself** (the robust spread of its second difference, per degree), so
  counts, cps, normalised and background-subtracted data all work; a peak must stand 5 noise widths above the background
  and 4 above the dip to its taller neighbour, and above the chosen % of the strongest. Peaks are refined by a parabola,
  neighbours within 0.15° merge, and for unstripped Cu Kα data (the weighted wavelength) a **Kα2 shoulder** (0.3–0.7 of a
  stronger peak where Kα2 falls) is left out and named; with Cu Kα1 chosen the data are taken as stripped. A pattern with no peaks but a broad hump is said to **look amorphous**, and no claim text is written.
- **DSC**: smoothing over about 1 °C (by temperature, so the result does not depend on the sampling); events where the
  derivative leaves its quiet level, gaps under 0.3 °C bridged, and two halves of one peak (split where the derivative
  passes zero at its apex) joined; local baselines before and after each. An event is split into its lobes where its
  excursion changes sign (a melt then a recrystallisation) or dips below half the smaller of two maxima (a desolvation
  overlapping a melt). When the two baselines are offset by more than the excursion between them it is a **step** (a glass
  transition), reported at its half-height midpoint (ASTM E1356) — never as an endotherm or exotherm. Otherwise a peak:
  its onset is where the tangent at the leading edge's inflection meets the baseline before it (ASTM E794 /
  ISO 11357-1), the slope taken by a local fit so noise does not move it; an onset that would fall outside the event is
  not printed, and the note says why. A Gaussian endotherm's onset lands at μ − 2σ, which the tests check, with and
  without noise.
- **TGA**: % of the starting weight (mg converted, the figure drawn in "% of initial"); smoothing over about 2 °C and the
  derivative (DTG); a steady drift is measured as the DTG's half-sample mode and taken out only when it shows at both
  ends of the scan; each DTG peak clear of the noise (and of 0.5 % of the largest rate, so a small hydrate loss beside a decomposition
  counts) is a step, a step still under way at either end of the scan said; neighbouring steps split at the DTG minimum between them
  when it dips below half the smaller peak; each step's loss is measured across its whole tail (to the split, or the
  data's end), its stated range where the rate stands clear of the noise. A weight gain is said, never counted as a loss.
- **Decimals**: 2θ to 0.1° for a ±0.1° or ±0.2° claim, 0.01° below ±0.1°; d to 0.01 Å; relative intensity whole %.

## Figures (lib/solidformChart.ts)

Black line art through plot.ts, so the pane's figure styles (USPTO, Nature, ACS …) refit it and the panel tray takes
it. Patterns are thinned by decimateTrace, which keeps each bucket's highest and lowest point — a reflection one step
wide is never dropped. The x label names the radiation; the DSC y label says which way the exotherm points.

## Out of scope (stated, not attempted)

- Rietveld refinement, indexing, unit cells, phase identification against a database.
- Peak areas, enthalpy integration (ΔH) — onset and peak only.
- Full Kα2 stripping (only clear Kα2 shoulders are recognised and left out, and named).
- Raw binary instrument formats (.raw, .brml, .xrdml, .tri): export to text (two columns) first.
- Predicting a pattern from a crystal structure.

## Tests

src/lib/__tests__/solidform.test.ts (NIST Si (111), pseudo-Voigt patterns, Gaussian DSC, logistic TGA) and
solidformAnalyze.test.ts (examples read back, list vs pattern, wavelengths, mg TGA, figures, refusals);
solidformReview.test.ts (the review round inputs: export shapes, noise, halos, glass transitions, drift);
solidformPane.dom.test.ts over the real markup.
