# Engineering gap analysis — 2026-10-23 (v2.190.0)

The Engineering tool after the August deep dive (`ENGINEERING-DEEP-DIVE-2026-08-02.md`, v2.78.0, 114 calculators) and
the three STEM releases since. Today: **179 calculators in 23 disciplines**, counted from source (153 literal entries
in `ENG_CALCS`, `src/taskpane/taskpane.ts`, plus 26 from the spread registries `filmCalcs`, `materialsCalcs`,
`controlCalcs`, `titrationCalcs`, `circuitCalcs`, `chromCalcs`, `tlcCalcs`, `cloningCalcs`, `lcCalcs`).

**Method.** Three read-only passes (mechanical/thermal/chemical; electrical/optics/aero/computing; cross-cutting + CAD),
each required to cite the module export list read and a grep over both `src/lib` and `taskpane.ts` for every absence.
The top absences were then re-checked by hand (grep counts recorded in §9). Gaps are weighted by the client domains on
record — optics and lasers, AI, computer chips, thermal, avionics and aviation, robotics, computation, aviation fuel,
ceramics, metals — and classed **computable** (pure maths from user inputs), **constant** (one sourced constant set, the
`flame.ts`/`orbital.ts` treatment) or **data-blocked** (needs a property table; listed, not proposed).

| Discipline | n | Discipline | n | Discipline | n |
| --- | --- | --- | --- | --- | --- |
| Energy & power | 17 | Chemistry & electrochemistry | 10 | Robotics & kinematics | 6 |
| Audio & acoustics | 16 | Thermal | 9 | Computation & information | 6 |
| Optics & photonics | 13 | Fluids | 8 | Electronics | 6 |
| Trajectory & orbits | 13 | Control systems | 8 | Aviation & avionics | 5 |
| Video & display | 12 | Fatigue & machine design | 7 | Chips & semiconductors | 4 |
| Structural & solids | 11 | Reliability | 6 | Vibration, Quantum optics, Pharmacokinetics, Molecular cloning | 4 each |
| | | | | Biomedical, Light & camera | 3 each |

---

## 1. Defects found on the way (fix first — each S)

- **Fracture toughness reads as plain pascals.** `taskpane.ts:17373, 17461, 17548` call `u.req("kic", "Pa", …)` while the
  field is labelled Pa·√m: "50 MPa*m^0.5" is refused as the wrong quantity and "50 MPa" is accepted. The units parser
  already reads `m^0.5`, so the fix is the target unit.
- **The rocket equation's "t converts" is false.** The label at `taskpane.ts:28017` says "(t, lb convert)"; `units.ts`
  has no `t`/`tonne` in UNITS or ALIASES — "50 t" is refused.
- **°C and °F cannot appear in a compound unit** (`units.ts:598` refuses any offset unit in a compound; there is no Δ°C,
  Δ°F or °R). "W/(m²·°C)" and "Btu/(h·ft²·°F)" — the usual ways h and k are written — are refused.
- **Uncited data.** `fluids.ts` WATER (ρ, μ 0–100 °C), ROUGHNESS and MANNING_N and `thermo.ts` RAW_GASES (9 gases,
  constant cp/cv) carry no source — against the "all data must be real" rule. Source them or label them.
- **The 26 spread-registry tools sit outside the routing and unit-contract gates** (`engineeringRouting.test.ts` covers
  the 153 literal entries only); they have per-registry case tests but no contract test.

## 2. Shipped since August

From the deep dive's §4 ordering, now present (evidence: module and export):

- **Thermal:** ε-NTU (`heat2.ts:effectivenessNtu`, counter/parallel/cross/shell), lumped capacitance with the Bi < 0.1
  refusal (`heat2.ts:lumpedCapacitance`). *Partial:* fins — one straight rectangular fin only (`finPerformance`);
  radiation — large/parallel/shields geometries, no view factors (`radiationExchange`).
- **Fluids:** flow meters (`fluids2.ts:flowMeter`), pump–system curve (`pumpSystemCurve`), affinity laws, body drag.
- **Fracture:** K and critical crack (`fracture.ts:stressIntensity`), Paris law (`parisGrowth`), transition crack size.
- **Reliability** (a whole discipline): Weibull fit, block diagrams, k-out-of-n, redundancy, availability
  (`reliability.ts`).
- **Tolerance & quality:** stack-up worst-case/RSS/Monte Carlo, Cp/Cpk (`materialsTesting.ts`).
- **Structures:** plane frame, plate in plane stress (CST), tensile test, Weibull modulus.
- **Circuits:** DC, AC and transient (`circuitTransient.ts:solveTransient`).
- **Optics:** thin-film stacks, Fresnel s/p, Jones/Stokes, liquid-crystal retarders and the Fréedericksz transition.
- **Control:** root locus, Nyquist, lead/lag, discrete (c2d).
- **Handoffs:** section → column, endurance → fatigue-safety, water table and pipe engine → pump NPSH, switching power →
  chip thermal (5 of the deep dive's handoffs).

Still absent from that list: pressure vessels, combined loading, shear flow, plastic modulus, Hertz contact, Castigliano,
Hardy Cross networks, MIMO control, fits and clearances, laminate theory (§4).

## 3. Limits already written down (in SCOPE docs and code)

Recorded so they are not rediscovered as new:

- **Frames** (`SCOPE-ENGINEERING-2026-10.md`): no P-Δ, no Timoshenko members, no 3D frames, no inclined global UDLs.
  **Plates:** rectangles only, no holes, no plane strain/axisymmetry, CST only.
- **Fluids:** isentropic only — no normal shock, Fanno or Rayleigh flow (`fluids.ts:700, 757`); h, Cd and C_D are
  measured inputs (`heat2.ts:365`, `fluids2.ts:70, 541`).
- **Thermo:** Brayton ideal only, no component efficiencies, regeneration or intercooling (`thermo.ts:braytonCycle`).
- **Fatigue:** creep refused (needs creep data, `fatigue.ts:218`); Y held constant through crack growth
  (`fracture.ts:458`).
- **Electrochemistry:** no mass transport, Frumkin, double layer, iR drop or impedance (`electrochem.ts:207`).
- **PK:** one-compartment only (`pk.ts:298`). **Shelf life:** no humidity term.
- **Circuits:** R, L, C, V, I only (`circuit.ts` `ElementKind`); devices, dependent sources (E/F/G/H), coupled inductors
  (K), transmission lines, switches and subcircuits refused by name; transient has no nonlinear devices or adaptive steps.
- **Chips:** leakage and θsa (heat sink) are user inputs; no process or heat sink modelled.
- **Trajectory** (`SCOPE-TRAJECTORY.md` §5, declined): 6-DOF, guidance/proportional navigation (dual-use), N-body/J2,
  re-entry heating.
- **Audio/video** (`SCOPE-AUDIO-VIDEO*.md`): codecs, VMAF, psychoacoustic masking declined; Thiele–Small, LR4 crossovers,
  Zobel, L-pad and ISO 9613-1 air absorption deferred but computable; CRI/TM-30 and Planckian Duv blocked on the CIE
  colour-matching functions.

## 4. New gaps — mechanical, thermal, materials, chemical

| Gap | Class | Size | Client fit |
| --- | --- | --- | --- |
| **Thermal stress / CTE mismatch** — σ = EαΔT restrained, Timoshenko bimetal and layered-stack curvature, thermal-shock resistance R | computable | M | chips (die attach), ceramics-to-metal joints, thermal management |
| **Pressure vessels** — thin-wall, Lamé thick-wall, shrink fits; rotating disks/flywheels | computable | S–M | metals, fuel systems |
| **Compressible flow beyond isentropic** — normal and oblique shock, Prandtl–Meyer, Fanno, Rayleigh | computable (γ only) | M | aviation inlets/nozzles, fuel systems |
| **Random vibration** — Miles' equation, PSD → g_rms, base excitation/transmissibility of a mounted box, shaft critical speed (Dunkerley) | computable | M | avionics hardware qualification |
| **Combined loading + Hertz contact** — axial + bending + torsion on a section, beam-column magnification; sphere/cylinder contact | computable | S each | robotics hardware, mechanical claims |
| **Heat-sink fin arrays** — pin/annular fins, overall surface efficiency; standard view factors | computable | S | chips (closes the θsa input), thermal |
| **Transient conduction beyond lumped** — semi-infinite erfc, one-term series for slab/cylinder/sphere | computable | M | thermal (hands off when Bi > 0.1) |
| **Materials processes** — Fick diffusion/case depth (erf), JMAK, Larson–Miller with user constants, Hall–Petch | computable | M | metals, ceramics (no process calculation exists) |
| **Brittle failure** — Coulomb–Mohr, modified Mohr | computable | S | ceramics |
| **Laminate theory** — ABD matrix, rule of mixtures (ply library stays data-blocked) | computable | M | composites, aviation |
| **Non-ideal gas turbine** — component efficiencies, regeneration, reheat, intercooling | computable | S | aviation, energy |
| **Reactors and Faraday** — CSTR/PFR, integrated rate laws beyond first order; electroplating/electrolysis/corrosion rate | computable | M | chemical, metals, electrochemistry |
| **Fuel-cell polarisation curve** — Nernst + Butler–Volmer + ohmic + mass transport | computable | S–M | energy |
| **Control: dead time and state space** — Padé dead time; pole placement and observers | computable | L | robotics, avionics |
| **Convection correlations** (Nu internal/external/natural) | constant (published fits) + air/water properties | M | every heat tool currently needs a hand-typed h |
| Smaller: water hammer, journal bearings (Petroff/Sommerfeld), helical springs (Wahl), Peltier, two-compartment PK, shear flow, Castigliano, Hardy Cross | computable | S each | |

## 5. New gaps — electrical, optics, aero, robotics, computing

| Gap | Class | Size | Client fit |
| --- | --- | --- | --- |
| **Dependent sources (E/F/G/H) and coupled inductors (K) in the circuit solver** — transistor small-signal models, op-amp macromodels, transformers, in DC/AC/transient | computable | M | chips, avionics, every amplifier/transformer circuit |
| **Link budget + noise cascade** — Friis, FSPL, EIRP, noise figure/temperature cascade, kTB, Eb/N0 → BER | computable | M | avionics datalinks, lidar, free-space optics, satellite |
| **Laser physics** — rate equations and threshold, slope efficiency, Fabry–Pérot FSR/finesse/linewidth, coherence length; SHG phase matching and QPM period | computable | M (+S) | the laser-designing engineer; lasers |
| **Kalman filter / sensor fusion** — steady-state gain and covariance run, complementary filter | computable | M | avionics, robotics (IMU/GPS fusion) |
| **Attitude kinematics** — quaternion ↔ DCM ↔ Euler (12 sequences), composition, slerp | computable | S | drones, spacecraft, robotics |
| **AI compute** — FLOPs/MACs per layer, roofline, memory footprint, int8/fp16/bf16/fp8 quantisation error | computable | M | AI hardware/software clients (today: Amdahl + float64 only) |
| **Semiconductor devices** — pn junction (Vbi, depletion width, Shockley diode), MOSFET square law, nᵢ | constant (Si/GaAs Eg, Nc, Nv) | M | chips (no device level exists) |
| **Transmission lines and S-parameters** — Z₀, Γ, VSWR, return loss, quarter-wave match, Smith chart | computable | M | high-speed chip I/O, RF, antennas |
| **Fibre link** — dB/km budget, dispersion, bandwidth–length, mode-field diameter, splice/offset loss | computable | S–M | optical interconnects, sensors |
| **Photodetector SNR** — responsivity ↔ QE, shot/thermal/dark noise, NEP, D* | computable | S | lidar, imaging |
| **Spatial IK + dynamics** — 3R/spherical wrist closed form, damped-least-squares IK on a DH chain, Newton–Euler joint torques | computable | M | robot arms, actuator sizing |
| **Power converters** — buck/boost duty, ripple, CCM/DCM | computable | S | chip power delivery, avionics power |
| **Filter synthesis** — band-pass/stop, Bessel/elliptic, Sallen–Key/LC ladder values | computable | M | analogue front ends |
| **ADC/DAC + PLL** — ENOB from SINAD, SFDR, jitter limit, PLL bandwidth/margin | computable | S | mixed-signal chips |
| **Aviation performance** — Breguet range/endurance, take-off/landing roll, propeller, weight-and-balance, density altitude | computable | M | aviation, aviation fuel |
| **Error-correcting codes** — Hamming, CRC, RS capability, bounds | computable | S–M | memory/storage chips, comms |
| **Chip reliability and yield** — electromigration (Black), Poisson/Murphy yield, logical effort | computable | S | chips |
| Smaller: antenna gain/aperture/beamwidth, orbital plane change and bi-elliptic Δv, rocket staging, path planning (grid A*) | computable | S each | |

## 6. Cross-cutting gaps

- **Hand-carried values.** The same transfer function is typed separately in 8 control tools (control-tf, step, Bode,
  PID; rlocus, Nyquist, lead/lag, c2d); filter-design does not pass its H(s) on. The mechanics chain still retypes
  4–5 values: beam → section (M, V), section → stress → fatigue-safety (σ, τ, σa, σm), section → beam/frame/plate (EI,
  A, I), tensile → E/Fy/Sut. Also: wall U → exchangers, cavity w₀ → Gaussian beam and pulse, Hohmann Δv → rocket,
  energy tools → LCOE, Weibull β/η → reliability blocks, three-phase P/PF → PF correction → voltage drop.
- **Parameter sweep / design-space plot** — absent: no tool can vary one input and plot an output.
- **Uncertainty on an engineering result** — the engines exist (`propagateUncertainty` in Stats, Monte Carlo in Solve)
  but nothing reaches them from Engineering.
- **Units in fields** — 101 of 179 tools take units; the rest are declared non-converting (vibration, PK, thermo,
  biomedical), so "3 lb" there is refused. Missing units: tonne, °R, slug, lbm, kgf, mil/thou, µin, ton of refrigeration,
  gpm/cfm, arcsec/arcmin/µrad, oersted, bbl; `√` is not parsed.
- **Formula as a Word equation** — only 5 of 153 literal tools insert the governing equation; inserting it for every
  tool is directly usable specification text.
- **Tables as Word tables** — results tables (truss, frame, reliability, NCA) insert as padded text although
  `insertResultBlocks` already turns a matrix block into a Word table.
- **Save / recall and a worksheet chain** — absent (fields reset on every switch; nothing carries variables between
  calculations).

## 7. Data-blocked — list, do not build

IF97 steam and refrigerant properties; Antoine/VLE constants and ΔHf/S° tables; fuel property tables (LHV, flash
point); Peterson Kt charts; creep master curves; composite ply libraries; emissivity tables; Sellmeier glass
catalogues; semiconductor mobility–doping and Eg(T) tables beyond the Si/GaAs constants; CIE colour-matching functions;
Thiele–Small driver data; airfoil polars; detector and fibre datasheets; air/water transport properties for convection
correlations (beyond the existing uncited water table).

## 8. Deliberate — do not re-propose (carried forward)

No design code (bolted joints per VDI 2230, gears per AGMA, bearings per ISO 281, Perry–Robertson column curves);
torsion circular-only; buckling as the perfect-column critical load; indeterminate trusses not solved exactly (provably
impossible in exact arithmetic); claim-set hygiene (declined). Trajectory's declined items (6-DOF, guidance laws,
N-body, re-entry heating) and the audio/video declines (§3) stand.

## 9. CAD and patent drawings (status only)

Present: parts from primitives and sketches (extrude, revolve; sketcher with solver, fillet, chamfer, offset, trim,
mirror, pattern); sheets, title blocks, ISO/ASME line types; DXF, STL, OBJ and STEP/IGES import (none yet checked on a
real Solid Edge export); freehand pencil, arrows, text and numerals anywhere; flat-face mates; exploded views with
§1.84(h) trails; detail views; full sections with one hatch; two-point perspective; mesh booleans.

Missing against the Solid Edge target, in order: **break lines / broken views** (no code); **§1.84(m) surface shading
lines** (scoped for v2.162, never shipped); **mates on curved faces** (concentric/axis/insert — pins and shafts, the
most common assembly case; refused in `cadMate.ts`); **partial sections** (half, broken-out, offset, revolved);
**dimensions on views** (R2c, not started); material-specific hatch patterns; three-point perspective. The patent
12,766,288 figure arc stays on hold pending real Solid Edge files.

## 10. Ranked — what I would do, in order

1. **The defects (§1)** — K_IC unit, tonne, °C/°F inside compound units plus the missing units, sources for the uncited
   tables. Correctness first; each is small.
2. **Dependent sources + coupled inductors in the circuit solver** — one stamp each, unlocks transistors, op-amps and
   transformers across DC, AC and transient; removes the most-cited documented limit.
3. **Thermal stress / CTE mismatch** — zero hits today and central to chips, ceramics and thermal-management claims.
4. **The handoffs (§6)** — one shared transfer function across the 8 control tools; the mechanics chain; tensile → E/Fy/Sut.
   Removes retyping errors rather than adding features (the August deep dive's top item, half done).
5. **Laser physics + SHG** — the numbers laser patents state (threshold, slope efficiency, linewidth, FSR/finesse,
   phase matching); the laser engineer is the client on record.
6. **Link budget + noise cascade** — avionics, lidar and free-space optics in one pure-maths tool.
7. **Kalman filter + attitude quaternions** — in nearly every avionics and robotics specification; reuses the matrix code.
8. **AI compute (roofline, FLOPs, low-precision formats)** — the AI clients have nothing beyond Amdahl and float64.
9. **Semiconductor device physics** — the chips discipline has no device level; one sourced Si/GaAs constant set.
10. **Pressure vessels + combined loading + Hertz contact** — the commonest structural calculations still missing.
11. **Compressible flow (shocks, Fanno, Rayleigh)** — aviation stops at the first shock today.
12. **Random vibration (Miles, base excitation, critical speed)** — how avionics hardware is qualified.
13. **Parameter sweep + uncertainty from any Engineering result** — the engines exist; a design-space plot is the most
    common figure in a specification.
14. **Formula as a Word equation + tables as Word tables** — directly usable specification text.
15. **Transmission lines, S-parameters, Smith chart** — high-speed chip I/O and RF, a strong figure.

Next tier: heat-sink fin arrays and view factors; materials processes (diffusion, JMAK, Larson–Miller); aviation
performance (Breguet); power converters; fibre link and photodetector SNR; spatial IK and dynamics; filter synthesis;
ECC; convection correlations once air/water properties are sourced. CAD (§9) is its own track.

**Hand checks of the top absences** (grep, case-insensitive, `src/lib` excluding tests / `taskpane.ts`): thermal
stress|bimetal|CTE 0/0; pressure vessel|hoop|thick-wall 0/0 (only "flame" substring hits); normal shock|Fanno|Rayleigh
flow|Prandtl–Meyer: only the isentropic disclaimer at `fluids.ts:700, 757`; Miles'|random vibration|base excitation
0/0; Hertz(ian) contact 0/0; Nusselt|Dittus|Grashof 0/0; Kalman 0/0; VSWR|Smith chart|characteristic impedance 0/0;
roofline|arithmetic intensity|FLOPs 0/0; Breguet|ground roll 0/0; Friis|EIRP|noise figure 0/0; depletion width|built-in
potential 0/0; slope efficiency|free spectral range|finesse 0/0; `circuit.ts` `ElementKind = "R"|"V"|"I"|"C"|"L"`.
