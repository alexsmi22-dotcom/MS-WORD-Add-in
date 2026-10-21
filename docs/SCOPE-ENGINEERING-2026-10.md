# Engineering additions, 2026-10 — scope

Gap item 5 of the 2026-10-21 "five gaps" directive: the structural and chemical-engineering calculations inventors in
mechanical, pharmaceutical and electrochemical fields ask for most, each drawing a figure like every Engineering tool.

| Calculator | Group | What it does | Checked against |
| --- | --- | --- | --- |
| Plane frame | Structural & solids | Direct stiffness, Euler–Bernoulli members (axial + bending), hinges by static condensation, nodal and member loads (UDL, point); displacements, reactions, member forces, moment diagrams; mechanisms refused | Closed forms (cantilever, fixed–fixed and simply supported UDL, propped cantilever, inclined bar); a fixed-base portal against anastruct 1.6 (beam in 64 elements, 1e-8); a hinged portal by statics and slope-deflection |
| Plate in plane stress | Structural & solids | Constant-strain triangles on a structured rectangular mesh, edge supports, tractions, pressure, point loads; von Mises field, reactions | Patch test (uniform stress exact), Poisson contraction, a cantilever converging on Timoshenko beam theory (0.42 → 0.99 as the mesh goes 10×2 → 160×16) |
| Stability and shelf life | Pharmacokinetics | Arrhenius fit of k(T) — given, or fitted from assay series at first or zero order; Ea with its 95 % interval; k at storage with its upper 95 % bound; t90 at both | Exact data return their own Ea and A; a noisy set against scipy (linregress, Student t) to 1e-6 |
| Nernst potential | Energy & power | E = E° − (RT/nF) ln Q with activities and coefficients | 59.16 mV per decade at 25 °C; Cu²⁺/Cu |
| Butler–Volmer | Energy & power | j(η) with αa, αc, j₀; Tafel slopes; charge-transfer resistance | Zero current at η = 0; the linear limit |
| Tafel analysis | Energy & power | Branch fits of η against log₁₀|j| beyond a window; slopes, α, j₀ | Recovers α and j₀ from Butler–Volmer data |

Constants: R = 8.314462618 J mol⁻¹ K⁻¹, F = 96485.33212 C mol⁻¹ (CODATA 2018, exact).

## Out of scope (stated)

- Frames: second-order (P-Δ) effects, member self-weight unless entered as a UDL, inclined UDLs in global directions,
  shear deformation (Timoshenko members), 3D frames.
- Plates: shapes other than rectangles, holes, plane strain and axisymmetry, higher-order elements.
- Shelf life: humidity (the moisture-modified Arrhenius model), non-linear Arrhenius behaviour.
- Electrochemistry: mass-transport limits, Frumkin corrections, impedance.
