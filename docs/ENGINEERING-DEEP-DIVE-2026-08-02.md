# Engineering bench — deep dive, 2026-08-02 (v2.78.0)

What is missing, and what could be better. Written against the shipped registry,
not against prose: every count below was extracted from `ENG_CALCS` and every
"absent" claim was checked against a module's **export list**, not by grepping
for a word that might be spelled differently.

**Verified baseline:** 114 calculators across 19 disciplines · 10 of them insert
a figure · 5 insert a real Word equation · dead-export ratchet at 10 · suite
8,553 across 258 files · QC 12/12.

---

## 1. The shape of the bench is the first finding

| Discipline | Calcs | | Discipline | Calcs |
|---|---:|---|---|---:|
| Energy & power | **17** | | Aviation & avionics | 5 |
| Trajectory & orbits | **13** | | Thermal | **5** |
| Optics & photonics | 8 | | Control systems | 4 |
| Audio & acoustics | 7 | | Vibration | 4 |
| Video & display | 7 | | Chips & semiconductors | 4 |
| Structural & solids | **6** | | Quantum optics | 4 |
| Robotics & kinematics | 6 | | **Fluids** | **4** |
| Computation & information | 6 | | **Fatigue & machine design** | **3** |
| Electronics | 5 | | Biomedical | 3 |
| | | | Pharmacokinetics | 3 |

**The distribution tracks build order, not engineering.** Energy & power and
Trajectory & orbits — the two most recent builds — hold 26% of the bench between
them. Meanwhile **Structural & solids has 6, Fluids 4, Thermal 5 and Fatigue 3**.
Those four are the load-bearing core of a mechanical or civil degree, and three
of them are among the five thinnest disciplines here.

That is not an argument for cutting anything. It is an argument that the next
work should go where a working engineer's hours actually go, rather than where
the last interesting problem happened to be.

---

## 2. Composition — the highest value per line of code in the whole bench

Two handoffs shipped in v2.78.0 and the cost of building each was under an hour.
Every one below is a number **this product computes in one tool and requires the
user to re-type into another**. That is a transcription step, and transcription
is where digits go missing.

### 2.1 `section` → `column` — the highest-consequence gap in the bench

`column` requires *"Second moment of area (minor axis), m^4"* and
*"Cross-sectional area, m^2"*. `section` computes both — and **reports them in
mm⁴ by default**, because that is what every section table in the world prints.

This is the exact trap the unit contract was written for, and the contract only
half closes it: a user who types `1e6 mm^4` is converted correctly, but a user
who pastes the bare number `1e6` has it **assumed to be m⁴**, which is off by a
factor of 10¹² and produces a completely plausible buckling load. The most
natural workflow in the discipline — size a section, check it for buckling — is
still one paste away from a silent twelve-order-of-magnitude error.

**Fix:** let `column` take its I and A from a section spec, the way
`chips-thermal` now takes its power from switching parameters.

### 2.2 `fatigue-endurance` → `fatigue-safety` — a second hand-carry nobody noticed

The gap analysis identified the `Kf` hazard on this pair and that half shipped
in v2.66.0; the entry was never broader than `Kf`. But the pair carries a
**second** number that no sweep has flagged: the *corrected endurance limit*
`Se` — the entire output of `fatigue-endurance`, the product of six Marin
factors — is still typed into `fatigue-safety` by hand as a bare number.

The Marin chain is exactly the kind of multi-factor computation nobody
re-derives, and getting it wrong is **non-conservative**: too high an `Se` makes
the part look safer than it is. Same failure direction as the `Kf` omission that
motivated the first half.

### 2.3 The rest, in order of consequence

| From | To | The number carried by hand |
|---|---|---|
| `beam` | `section` | max bending moment and shear |
| `section` | `stress` | the bending/shear stress → σx, τxy |
| `stress` | `fatigue-safety` | σa and σm |
| `section` | `beam` | I, for the EI that deflection needs |
| `filter-design` | `control-bode` / `control-step` | the designed transfer function — `toTransferFunction` **already exists and is exported** |
| `control-tf` | `control-step`, `control-bode`, `control-pid` | the same numerator and denominator typed four times |

The `beam → section → stress → fatigue-safety` chain is worth calling out as a
chain: it is *the* standard undergraduate workflow — load a beam, size the
section, check the stress state, check it for fatigue — and today it is four
tools with three hand-carries between them.

---

## 3. Presentation — the bench computes diagrams and draws almost none of them

**10 of 114 tools insert a figure. 5 insert a real Word equation.** 109 insert
plain text only.

`plot.ts` and `buildPlotSvg` already ship and are already used by beam, the Bode
plot, the step response, the vibration responses and the PK curves. The cost of
the rest is low. Two are close to indefensible:

- **`stress` computes Mohr's circle centre and radius and does not draw Mohr's
  circle.** The construction is named in the output. It is the single most
  recognisable diagram in mechanics of materials.
- **`fatigue-safety` computes all four mean-stress criteria and does not draw
  the Goodman diagram.** The whole reason to show four criteria together is that
  they disagree, and the disagreement is a *picture* — four lines and one
  operating point.

Others where the diagram is the conventional way the result is communicated, in
rough order of value: `thermo-cycle` (P–v and T–s), `aero-polar` (the drag
polar), `truss` (members coloured by tension/compression), `column` (the
Euler–Johnson curve with the operating point), `hx` (the temperature profile —
which also makes the LMTD visible), `vib-modal` (mode shapes), `video-gamut`
(the CIE chart with both triangles — the tool already computes the polygons),
`optics-gaussian` (the beam envelope), `energy-wind` (the power curve against
the Betz limit), `comp-speedup` (Amdahl's ceiling), `filter-design` (the
magnitude response), and the whole `traj-*`/`orbit-*` family.

**Equations are the second half of this.** For a patent attorney drafting a
specification, the formula used is often more useful than the number: a real
Word equation for `σ = Mc/I` or `Tj = Ta + P·Σθ` beside the result is directly
insertable prose. The product already renders real equations elsewhere via
`mathToOmml`; the Engineering bench essentially never does.

---

## 4. Missing capability — pure mathematics from user inputs

Everything in this section is a **theorem operating on numbers the user
supplies**. No table, no fetched constant, no data question. Verified absent by
reading each module's export list.

### 4.1 Thermal — the thinnest discipline relative to its importance

`heat.ts` exports exactly two functions: `analyzeWall` and `analyzeExchanger`.

- **ε-NTU** — the exchanger tool is **LMTD only**, which cannot solve the
  commonest real question: *given this exchanger and these inlets, what outlet
  do I get?* LMTD needs both outlets, so a rating problem has to be iterated by
  hand. ε-NTU answers it directly and is closed-form per arrangement.
- **Fin efficiency and fin arrays** — `tanh(mL)/mL`, plus the result everyone
  gets wrong: **a fin can reduce heat transfer** when the ratio of fin
  conductance to base coefficient is unfavourable.
- **Transient / lumped capacitance and the Biot number** — with the honest
  gate: above Bi ≈ 0.1 the lumped model is invalid and the tool should refuse
  rather than return a plausible cooling curve.
- **Radiation exchange** — Stefan–Boltzmann, view factors for standard
  geometries, the radiation resistance network. Emissivity stays a user input.
- **Psychrometrics** — see §5; it needs one fetched correlation.

### 4.2 Fluids

`fluids.ts` exports six functions; there is no flow measurement of any kind.

- **Orifice, venturi and nozzle metering** — discharge coefficient is a user
  input, exactly as `Cd` is in the trajectory suite.
- **Pump and system curve intersection** — the operating point is where the
  curves cross. The counter-intuitive result: throttling a valve moves the
  operating point *up* the pump curve, which is why it wastes energy.
- **External drag and terminal velocity on bodies** — `trajectory.impactEnergy`
  already does the physics; a general form belongs in Fluids.
- **Affinity laws** for pumps and fans — flow ∝ N, head ∝ N², **power ∝ N³**,
  which is the whole argument for variable-speed drives.
- **Hardy Cross pipe networks** — iterative, well-defined, no data needed.

### 4.3 Structural & solids

- **Thin- and thick-walled pressure vessels** (hoop/longitudinal; Lamé) — one
  of the most common calculations in the field, entirely absent.
- **Combined loading / beam-columns** — axial plus bending on the same section,
  including the P-δ amplification. `stress` handles a stress *state* but nothing
  assembles one from a load case.
- **Shear flow and shear centre** for thin-walled open sections — the reason a
  channel twists when you load it through the centroid.
- **Plastic section modulus and the shape factor** — first yield versus full
  plastic hinge.
- **Contact stress (Hertz)** — pure elasticity, no data.
- **Castigliano / unit-load deflections** for frames, complementing the beam
  engine.

### 4.4 Fatigue & machine design

`fatigue.ts` exports six functions, all S-N based. There is **no fracture
mechanics at all**:

- **Stress-intensity factor** `K = Yσ√(πa)` and the critical crack size — the
  damage-tolerance half of the subject, and the half that governs whether a
  crack found in service is acceptable.
- **Paris-law crack growth** to failure.
- **Transition crack size** — where LEFM takes over from S-N.

`Y` (the geometry factor) and `K_IC` are user inputs, as they must be.

### 4.5 Reliability — an entire discipline absent, and the closest to the users

No module. Everything here is arithmetic over user-supplied rates:

- **MTBF, failure rate, series/parallel reliability block diagrams**
- **Weibull life** — β, η, B10 life; the shape parameter tells you whether
  failures are infant-mortality, random or wear-out, which is a qualitative
  conclusion from a fitted number
- **Availability** from MTBF and MTTR
- **Redundancy** — active, standby, k-out-of-n

`stats.ts` and `survival.ts` already carry the fitting machinery.

### 4.6 Tolerance and manufacturing

Also absent, also pure arithmetic, and directly relevant to mechanical patent
work:

- **Tolerance stack-up** — worst-case versus RSS, with the point that RSS
  assumes independence and normality and can be *optimistic* when either fails
- **Process capability** Cp/Cpk from user data
- **Fits and clearances** from typed limits

### 4.7 Smaller items inside existing disciplines

- **Circuit mutual inductance** — one more MNA stamp (previously ranked first
  among circuit gaps)
- **Circuit transient analysis** — the largest single item in the bench; a
  netlist with C and L is a DAE needing companion models rebuilt inside the
  stamp each timestep, not `integrateStiff` on a state-space form
- **MIMO control** — a representation rewrite; `control.ts` is
  transfer-function-based throughout
- **Aviation:** Breguet range and endurance, propeller thrust/efficiency,
  takeoff and landing distance, weight and balance
- **Optics:** thin-film interference, polarisation (Jones calculus)
- **Vibration:** continuous-beam natural frequencies, rotor balancing
- **Grid:** transformer equivalent circuit, symmetrical-component fault current

---

## 5. Needs a citable constant — the `flame.ts` / `orbital.ts` treatment

Buildable, but only by fetching from a citable source, extracting by script, and
cross-checking in a committed test. Not by typing coefficients from memory.

- **Psychrometrics** — needs a saturation-pressure correlation (ASHRAE or
  IAPWS-IF97 Region 4). Cross-check is unusually strong: it **must** give
  101325 Pa at 100 °C by definition, and 611.657 Pa at the triple point. This
  also closes the `pump-npsh` vapour-pressure gap, which the tool currently
  refuses to fill in *and says why*.
- **Steam properties** — the same decision, deliberately declined so far; the
  Rankine tool takes enthalpies you look up. Worth revisiting only with IF97
  fetched properly.
- **Standard fluid and gas property tables** beyond water — same treatment,
  same conditions.

---

## 6. Data-blocked — state the refusal, do not build

Consistent with how the product already refuses Cd, absorption coefficients,
Thiele-Small parameters, insolation tables and battery chemistry curves:

- **Material property tables** (moduli, strengths, conductivities) — these vary
  by heat treatment, direction and supplier; a built-in table would be wrong for
  every material except the one it was measured on
- **Gear, bearing and fastener catalogues**
- **Soil property tables** (which is most of what a geotechnical module would
  need)
- **Composite ply property libraries** — though see below

**One re-classification:** classical laminate theory (CLT) is *pure matrix
algebra* over ply properties the user supplies — the ABD matrix from E₁, E₂,
ν₁₂, G₁₂, thickness and angle per ply. Only the *library* of ply properties is
data-blocked. CLT itself belongs in §4, and it is the single most-requested
composite calculation.

---

## 7. Deliberate — do not re-propose

Recorded so a future sweep does not list these as gaps:

- **No design code.** This rules out bolted joints per VDI 2230, gears per AGMA,
  bearings per ISO 281 and Perry–Robertson column curves. Each looks like a gap
  and each is a code lookup wearing engineering clothes.
- **Torsion is circular-only**, because τ = Tr/J is a theorem for a circle and
  false for a rectangle, which warps.
- **Buckling is the perfect-column critical load**, not an imperfection curve.
- **Indeterminate trusses are not solved exactly** — and *cannot* be: the
  member unknown needs `a = -1` for rational joint equilibrium and an even `a`
  for rational compatibility. A stiffness solve is exact only when every member
  length is rational.
- **Claim-set hygiene** — declined by the user; do not re-propose.

---

## 8. What I would do, in order

1. **The four composition handoffs** (§2.1–2.3), starting with `section →
   column`. Highest consequence, lowest cost, and each one removes an error
   rather than adding a feature.
2. **Mohr's circle and the Goodman diagram** (§3). Two figures, both already
   computed, both the conventional representation of a result the bench already
   produces.
3. **Thermal breadth** (§4.1) — ε-NTU first, because it unlocks the rating
   problem LMTD structurally cannot answer.
4. **Fracture mechanics** (§4.4) — three calculators, no data, and it completes
   a discipline that currently covers only half its subject.
5. **Reliability** (§4.5) — a new discipline, entirely arithmetic, closest of
   anything here to what the client base actually files.
6. **Pressure vessels and combined loading** (§4.3) — the most common
   calculations still missing from the core.

Items 1–2 are a single release. Items 3–6 are one release each.

---

## 9. What this document does not claim

Absences in §4 were verified by reading module export lists. Where a capability
might exist under a name not exported at module level — inside a larger
function, or in the pane — it would not have been found. The items most exposed
to that are the smaller ones in §4.7; the discipline-level absences (no fracture
mechanics, no reliability module, no flow measurement, ε-NTU) were confirmed
against the full export list of `fatigue.ts`, `heat.ts` and `fluids.ts`
respectively and are solid.
