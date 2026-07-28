# JurisLab — What it can do

A Microsoft Word add-in fusing **STEM authoring** and **patent & legal drafting**. It
runs **entirely on your machine** — nothing you type is sent anywhere — and inserts
cleanly formatted chemistry, math, structures, figures, sequences, citations, and more
directly at the cursor.

Opening the pane shows a **Home** page with the tools grouped by category — click a card
(or a tab at the top) to open a tool: **Chemical · Mass Spec · Spectra · Bio/Assay ·
Peptide · Stats · Analyze · Math · Units · Plot · Table → Chart · Finance · Build ·
Code · Sequence · Botanical · Numerals · Refs · Citations · DNA · Reaction · Audit.**
Everything shows a live preview that matches exactly what gets inserted, and the
**Examples & syntax** panel updates to match the selected tool.

> Drafting aid — always verify structures, formulas, and listings before filing.

---

## Across all modes
- **Search** formulas and compounds by name (e.g. "quadratic", "benzene").
- **Recents & favorites**, with a one-click **Clear** for confidentiality.
- **Live preview** = the exact output that's inserted.
- Runs offline after first load; no document content leaves the machine.

## 🧪 Chemical
- Format formulas with correct sub/superscripts: `H2O` → H₂O, `SO4^2-` → SO₄²⁻, `Na+` → Na⁺, `Ca(OH)2` → Ca(OH)₂.
- Charge, lone-pair, and common group/ion palette (OH, NH₄, SO₄, CH₃, …).
- **2D structures**, offline, from a **name** (`aspirin`), **formula** (`C6H6`), or **SMILES** (`CC(=O)O`).
- **Name lookup** — recognized compounds show their name (dictionary-based), which you can insert.
- **Formula validator** — checks every element symbol against the real 118-element periodic table (flags typos like `Xy`), balances parentheses/hydrates, and reports **molecular weight** and **net charge** (polyatomic ions handled, e.g. `NH4+`, `Ca(OH)2`).
- **Stereochemistry** — isomeric SMILES (`C[C@@H](N)C(=O)O`) drawn with wedges.
- Each inserted structure carries provenance (formula / MW / canonical SMILES / OCL ID) in its alt-text.
- **Physicochemical properties & druglikeness** — for any resolved structure, a readout of **cLogP**, **logS**, **topological PSA**, **H-bond donors/acceptors**, **rotatable bonds**, and **heavy-atom count**, plus the **Lipinski Rule of Five** and **Veber** oral-druglikeness screens (with the specific criteria that pass/fail). Insert the summary at the cursor. Estimated offline (OpenChemLib) — no server, no license tier.
- **Online name resolution (opt-in)** — for a full **systematic IUPAC name** the offline dictionary doesn't know (e.g. *2-amino-3-(1H-indol-3-yl)propanoic acid*), a **“Resolve name online”** button parses it via the EMBL-EBI **OPSIN** service and draws the result (also reporting its **InChIKey**). This is the **only** feature that leaves your machine: it's off until you click it, shows a **consent prompt** naming the service before the name is sent over the internet, and warns against use for confidential names. Everything else stays fully offline.

## ⚛️ Mass Spec — exact mass, isotope pattern, adducts
- From a **name, formula, or SMILES**, an offline mass-spectrometry readout for proteomics / metabolomics / small-molecule MS.
- **Exact masses** — **monoisotopic** (for high-resolution MS) and **average** molecular weight.
- **Isotope pattern** — the theoretical M, M+1, M+2… peaks with relative intensities, drawn as bars (e.g. the tell-tale **~32% M+2** of a chlorine, elevated M+2 for sulfur). Uses standard NIST isotope abundances across the common organic/bio elements (C, H, N, O, S, P, halogens, Si, Se, B, Na, K); any element outside that set is reported, not silently dropped.
- **Adduct m/z** — the common ESI ions computed exactly: **[M+H]⁺, [M+Na]⁺, [M+K]⁺, [M+NH₄]⁺, [M+2H]²⁺, [M−H]⁻, [M+Cl]⁻, [M+HCOO]⁻, [M−2H]²⁻**.
- Insert the full readout as a text summary. Computed entirely on your machine — verify before relying.

## 📡 Spectra — predicted NMR, IR, UV-Vis & fragmentation
- From a **name, formula, or SMILES**, predicted spectra computed entirely offline. **These are estimates from published additivity rules — not acquired spectra, and not quantum-chemical calculations.** Structure recognition is exact (an ester is never mistaken for a ketone); the numbers are empirical and every prediction states its own accuracy.
- **¹H NMR** — chemical shift, **integration**, **n+1 multiplicity** (s/d/t/q/quint…), and an assignment per signal. Symmetry-aware, so benzene is one 6H singlet, not six signals. Exchangeable **OH/NH/COOH** protons are reported as nominal ranges and flagged *variable*, because they genuinely depend on solvent and concentration. Typical accuracy **±0.2–0.4 ppm**.
- **¹³C NMR** — proton-decoupled shifts by Grant–Paul additivity (sp³) and benzene substituent increments (aromatic), with carbonyl classes properly distinguished (ketone ≈ 205, aldehyde ≈ 199, acid ≈ 178, ester ≈ 171, amide ≈ 172). Typical accuracy **±2–4 ppm**.
- **IR** — characteristic **group frequencies** with published ranges and qualitative intensities, plus a simulated **transmittance trace**. Carbonyl classes separate correctly (ester ≈ 1740 > ketone ≈ 1715 > amide ≈ 1660) and conjugation lowers C=O ~25 cm⁻¹ (acetophenone vs acetone). The **fingerprint region below ~1500 cm⁻¹ is not predicted** — it is compound-specific, and no additivity scheme reproduces it.
- **UV-Vis** — **λmax** by the **Woodward–Fieser rules** for conjugated dienes and α,β-unsaturated carbonyls, showing **every increment** so the arithmetic is auditable. Within its domain, ~±5 nm. Outside it the tool says so rather than inventing a number: an unconjugated molecule is reported **transparent** (absorbs below ~200 nm), and benzenoid/isolated-carbonyl bands come from tabulated values, explicitly not Woodward–Fieser.
- **MS fragmentation (EI)** — principal fragments with **exact** m/z, via the classical pathways: **α-cleavage** (acylium, oxocarbenium/iminium), **benzylic → tropylium**, allylic, **McLafferty rearrangement** (only when a γ-hydrogen actually exists), and neutral losses (H₂O, CO₂, CO, NH₃, HCl) gated on the group that enables them. Correctly ranks the real base peak for toluene (m/z 91), ethanol (31), butylamine (30) and 2-pentanone (43/58). **Likelihood is a rule-based ranking, never a predicted intensity.**
- Insert either a **data table** or a **spectrum chart** (NMR/IR/MS; δ and wavenumber axes run in the conventional direction). Every insert carries the caveat with it.
- Known limits, disclosed in-pane: fused aromatics (naphthalene-type) and heteroaromatic rings are approximate; carbons bearing 3+ electron-withdrawing groups over-count; ring fragmentation needs two cleavages and is covered only via the listed rearrangements.

## 🏗️ Engineering — statics, mechanics of materials, circuits, thermofluids, control & PK
- Eighteen calculators over your own numbers, offline. **Exact where exactness is real, floating point where it is not, and it always says which.**
- **Beam analysis** — reactions, shear force and bending moment diagrams, and deflection, from a span, its supports (pin/roller/fixed) and its loads (point, uniform, linearly varying, applied couple). **Statically indeterminate beams are the same code path** — a propped cantilever needs no force method and no superposition table — and the reactions come out as exact rationals, so a propped cantilever under a UDL reports **3/8 wL**, not 0.37499999996. Deflection needs EI; nothing else does, because for a prismatic beam the flexural rigidity divides out.
- **Cross-section properties & stress** — area, second moment, section modulus, radius of gyration and the first moment Q, plus peak bending and transverse shear stress. A non-symmetric section reports **both** section moduli, because quoting one number for a tee understates the fibre that yields first.
- **Stress state** — principal stresses, principal angle, Mohr's circle centre and radius, von Mises and Tresca, and the factor of safety against a yield strength. Reports the **absolute** maximum shear alongside the in-plane one and flags when they differ: for a biaxial state the zero out-of-plane principal lies outside the in-plane pair, so the in-plane circle understates the real shear (σ1 = 100, σ2 = 60 → 20 in-plane, **50 in truth**). Full 3D states are solved in closed form from the tensor invariants.
- **Truss analysis (method of joints), solved exactly.** Solving for force *per unit length* instead of axial force keeps every matrix entry rational, so the equilibrium solve is exact and the only square root happens once per member at reporting time — **reactions are exact always**, and zero-force members are exact zeros rather than values under a tolerance. A **mechanism**, a **statically indeterminate** truss, and a **critical form** (member count balances, structure still collapses — what counting members cannot catch) are each named instead of answered.
- **Column buckling** — Euler **with the Johnson parabola** for short columns, so a stocky column is never quoted a critical load that would need a stress above yield. Reports effective length, slenderness, the transition slenderness, the squash load, and which curve governs.
- **Shaft torsion** — polar second moment, peak and bore shear stress, angle of twist. **Circular sections only, on purpose:** τ = Tr/J is a theorem for a circle and false for a rectangle, which warps.
- **Circuits** — modified nodal analysis from a SPICE-style netlist. The **DC operating point is exact** over rationals (a divider reports 10/3 V), values may be written as a schematic prints them (`2k2`, `4R7`), and AC gives phasors at a frequency or sweeps a node into a **Bode magnitude plot**. Refusals are circuit errors, not matrix errors: a node with no DC path to ground is named, as are two ideal sources fighting.
- **Pipe flow & head loss** — Reynolds number, **Colebrook-White solved rather than approximated** (bounded, convergence-checked iteration), Darcy-Weisbach head loss, minor losses, wall shear, pressure drop and pump power, with built-in roughness and water-property tables. Laminar flow uses f = 64/Re and says the roughness was ignored. The **transition band (2300 < Re < 4000) returns a figure and states that it is unreliable**, because no correlation there is trustworthy.
- **Composite wall / pipe insulation** — a thermal resistance chain with every interface temperature, each layer's share, and the controlling layer. For a cylinder it reports the **critical radius**: below k/h, adding insulation makes the heat loss *worse*, and it says so.
- **Heat exchanger (LMTD sizing)** — counter or parallel flow, area from duty or duty from area. Equal terminal differences are handled as the removable singularity they are (the naive formula gives NaN for a perfectly ordinary balanced exchanger), and a temperature cross is reported as normal in counterflow and refused as impossible in parallel flow.
- **Control systems** — **transfer functions** entered as coefficients highest power first (`1 3 2`) or written out (`s^2+3*s+2`).
  - **Poles, zeros & stability** with the **exact** Routh-Hurwitz array. Routh is a tabulation of differences of products, so a coefficient that is 1e-17 instead of 0 flips the verdict — and floating point is least reliable exactly at the stability boundary, the only place anyone runs it. Over rationals it is exact.
  - **Stability is decided twice and cross-checked.** The right-half-plane pole count comes once from the exact tabulation and once from the poles as eigenvalues of the companion matrix; they share no arithmetic, so agreement is evidence rather than the same mistake twice. **When they disagree, both are reported and neither is chosen** — that means a pole is close enough to the axis that its computed real part cannot be trusted, which is the case a single method answers confidently and wrongly.
  - **Step & impulse response** — damping ratio, natural frequency, overshoot, rise, peak and settling time, with a plot. Exact identities for a genuine second-order system; above that they come from the dominant pole pair and the result **says so**, more loudly when the next pole is under five times faster. A zero near the dominant poles is flagged, because the standard formulas know nothing about zeros.
  - **Frequency response & margins** — Bode magnitude and phase, gain and phase margin. **A margin that does not exist is reported as not existing:** a first-order lag never reaches −180°, so its gain margin is infinite and any finite number — including the value at the edge of the swept range — is wrong.
  - **PID & closed loop** — controller in series, loop closed, with closed-loop poles, stability, margins and transient. A **right-half-plane zero** is named as non-minimum-phase: the step response goes the *wrong way* first and more gain makes it worse.
  - Refused rather than faked: an **improper** transfer function has no state-space realisation and is not simulated as something else; a factored input (`(s+1)(s+2)`) is refused rather than mis-parsed into a different plant.
- **Pharmacokinetics** — built on **clearance and volume**, the physiologically independent parameters; half-life is a consequence of both (t½ = ln2·Vd/CL), which is why a renal-failure patient and an obese patient get a long half-life for completely different reasons.
  - **Dose & concentration curve** — IV bolus, infusion or oral, with Cmax, Tmax, AUC and a plot. **AUC = Dose/CL**, so total exposure is set by clearance alone and *not* by volume; the infusion plateau is rate/CL, and volume only sets how fast you reach it.
  - **Steady state & loading dose** — accumulation ratio, peak, trough, average and fluctuation. The average depends **only** on dose rate and clearance, so halving both dose and interval leaves it unchanged and only narrows the swing. Time to steady state depends **only** on half-life and a bigger maintenance dose does not shorten it — which is exactly what a loading dose is for, and why the loading dose comes from the volume while the maintenance dose comes from the clearance.
  - **Non-compartmental analysis** of measured data — paste `time concentration` pairs for λz, half-life, AUC, CL, Vz and MRT. The terminal window is **chosen** by trying every window of ≥3 points and keeping the best *adjusted* R², and the **percentage of AUC that came from extrapolation** is reported: above ~20% the study did not follow the drug long enough and every derived parameter rests on an assumed tail.
  - **Flip-flop kinetics are detected.** When absorption is slower than elimination the terminal slope is *absorption*, so a half-life read off the tail is the absorption half-life and every parameter from it is wrong — and the curve looks entirely normal either way. Common in depot injections and modified-release formulations.
  - Oral data reports **CL/F and Vz/F**, never "clearance": without an IV reference, bioavailability cannot be separated, and a drug with 50% F would look as though it clears twice as fast as it does. Every model here is **linear** — saturable elimination (phenytoin) breaks all of it, and that is stated rather than assumed.
- **One unit contract, stated in every result.** A tool converts units unless it is dimensionally homogeneous or computes over exact rationals — and it tells you which. Cross-sections, column buckling, torsion, pipe flow and both heat tools read every field through the unit layer: a bare number is read in the unit the field names, `200 GPa` / `1e6 mm^4` / `50 ksi` / `68 °F` / `15.7 L/s` are converted **and the conversion is reported back**, and a unit of the **wrong quantity is refused by name** rather than silently dropped. Parenthesised units (`W/(m^2*K)`, `kJ/(kg*K)`) work; a nested division inside a group is refused rather than guessed, because the two readings differ by a squared factor. Beam and truss deliberately do **not** convert — a conversion is a floating-point multiply that would destroy the exact rationals that are the point of those two engines — and they say so.
- Honest limits, disclosed in-pane: beams are prismatic, linearly elastic, small-deflection Euler-Bernoulli (no shear deformation); circuits are linear and lumped, with no transient analysis; trusses are pin-jointed and statically determinate only. This computes the mechanics — it does not tell you whether a member passes a design code.

## 🧮 Analyze — no-code numerical workbench
- Paste numbers, get real computed results and publication-ready figures straight into Word. No scripting, no licence, fully offline.
- **Linear algebra** — solve **A·x = b**, inverse, determinant, rank, trace, transpose, multiply; **eigenvalues** (symmetric via Jacobi, general via Francis double-shift QR **including complex pairs**), **QR** (Householder) and **SVD** (one-sided Jacobi). Results insert as Word tables.
- **Matrix expressions** — one line, e.g. `A*inv(B)+2*C'`.
- **Optimization** — unconstrained minimization (Nelder–Mead).
- **FFT** — radix-2 FFT with zero-padding, frequency spectrum and dominant-peak detection, inserted as a chart.
- **ODE / system solving** — type the equation you actually have; two integrators with **automatic stiffness detection** pick themselves.
  - **Higher order is reduced for you.** `y'' = -0.1*y' - y` with `y = 1, y' = 0` just works — no hand-reduction to a first-order system. Third order and above too, several higher-order equations at once, and mixed orders in one system. The result names the states it created.
  - **Explicit RK45** (adaptive Dormand–Prince). Fast and highly accurate on well-behaved problems — ~8 significant figures on y′ = −y in ~23 steps.
  - **Implicit RODAS4** (4th-order Rosenbrock, L-stable and stiffly accurate; one LU factorization per step, no Newton iteration). This is what makes **stiff** systems solvable — *stiffness is the normal case in chemical kinetics whenever rate constants differ by orders of magnitude*. Van der Pol at μ=1000 (~1,500 steps) and **Robertson kinetics** (rate constants spanning 0.04 → 3×10⁷; ~570 steps, mass conserved to 12 digits) both solve; the explicit solver cannot finish either.
  - **Auto** starts explicit and switches to implicit mid-integration if the problem stiffens (so Van der Pol, which *starts* non-stiff, is still solved). The result states which solver ran.
  - **Rich right-hand sides** — `t`, the state names, and a full function library: trig, inverse trig, hyperbolics (`tanh`), logs to any base, `sqrt`/`cbrt`, rounding, `min`/`max`/`clamp`, true `mod`, `hypot`, a Heaviside `step`, comparisons (`<`, `>=`, `==` …) and **`if(cond, a, b)`** for piecewise/switching inputs.
  - **Report at the times you choose** — a list (`0, 1, 2.5`) or a range (`0:0.5:10`). The solver is forced to *land* on each one, so those values are **computed, not interpolated** — there is no interpolation error to discount. The plot still uses every step, so the curve stays smooth.
  - **Stop on a condition** — answer "when does it…?" rather than reading it off a chart. Give an expression that crosses zero: `z` for "when it hits the ground", `y - 100` for a threshold, `y'` for "at the turning point". The crossing is located by bisection to solver tolerance and the solution **ends at the event** — e.g. a projectile `z'' = -9.81` from `z' = 20` stops at t = 4.077472 with z = 0 and z′ = −20, matching the closed form exactly.
  - Honest limits: numerical only — no symbolic/closed-form solutions, no boundary-value problems, no PDEs. Ultimate accuracy is capped near 1×10⁻¹² by the finite-difference Jacobian (no analytical Jacobian is supplied).
- **Raw data → insights** — per-column summaries, Tukey outlier & missing-data flags, **Pearson + Spearman** correlations with p-values, trend/slope detection, and a plain-language "what this means" write-up. Computed from your numbers — never invented.

## ∑ Math (native Word equations)
- Fractions, super/subscripts, roots (`sqrt`, n-th `root`), `Σ`/`∫`/`∏`, limits, `|x|`, accents (`bar`/`hat`/`vec`), factorials, implicit multiplication, full Greek.
- **Matrices** — `matrix(a,b; c,d)`, plus `pmatrix`/`bmatrix`/`vmatrix`; **piecewise** `cases(…)`.
- **Logic & set theory** — ∀ ∃ ∈ ∉ ⊆ ∪ ∩ ∅ ∧ ∨ ¬ ⊕ ⇒ ⇔.
- **Number sets** — ℤ ℝ ℕ ℚ ℂ 𝔽 𝔼; `floor`/`ceil`/`norm`, `∂`, `∇`, `mod`, `°`, bracket grouping `[S]`.
- **Engineering & physics** — Dirac bra-ket (`bra`/`ket`/`braket`), contour/multiple integrals `∮ ∬ ∭`, phasor `∠`, `ℏ`, `Ω`, Laplace `ℒ` / Fourier `ℱ`, `Re`/`Im`.
- **Function families** (palette + library) — trig, inverse-trig, hyperbolic, log/exp, special (`Γ`, `ζ`, `erf`, `sgn`), discrete (`C(n,k)`, `P(n,k)`, …).
- **Equation numbering** — optional right-aligned (I), (II), … with a counter and reset.
- **Import / export LaTeX** — paste LaTeX (`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`) to turn it into a native Word equation, or copy the current formula out as LaTeX.
- **Multi-line aligned equations** — `align(a = b; c = d)` (or paste a LaTeX `align`/`aligned` block) → a stacked Word equation array.
- **Formula library** grouped into *Mathematics* (statistics, geometry, algebra, trig, calculus), *Functions*, and *Science & engineering* (**Cryptography, Computer science/ML, Mechanical engineering, Electrical engineering, Physics, Biology/assays**).
- Symbol palette is collapsible; its open/closed state is remembered.

## 🟰 Solve — equations, rearrangement, calculus & word problems (offline, CAS core)
- **Solve an equation** `LHS = RHS` for one unknown — linear/quadratic **exact** (complex pairs reported, never faked real); any higher-degree polynomial returns **every root, real and complex**, repeated roots marked; transcendental equations solved numerically for real roots in a stated range.
- **Inequalities** — `x^2 - 4 > 0` → (−∞, −2) ∪ (2, ∞), solved **exactly** by sign analysis on the critical points. Nothing is ever multiplied through by an expression whose sign is unknown, which is how this usually goes wrong: `1/x < 1` correctly keeps the whole negative branch that a naive multiply silently loses, and a **pole is excluded even from a non-strict comparison**, because the expression is undefined there. Irrational critical points are located numerically and declared approximate; transcendental inequalities are refused rather than approximated.
- **Systems of equations** — type several equations, one per line. Linear systems are solved **exactly** by row reduction over rationals, and — the part that matters — **classified**: exactly one solution, none at all, or **infinitely many**, in which case you get the *general* solution with the free variables named rather than one arbitrary point dressed up as the answer. An inconsistent system says which row proved it. Nonlinear systems go to Newton from many starting points, with every root substituted back, and say plainly that other solutions may exist.
- **Rearrange a formula (v2.5.0)** — several symbols? Pick which to solve for: `F = m*a` for `a` → **`a = F/m`**, exactly, other symbols carried through; quadratic targets use the quadratic formula symbolically. Every introduced divisor states its **≠ 0 condition**, and every answer is **verified by substituting it back**.
- Built on a **CAS core** with exact rational arithmetic: `1/3 + 1/3 + 1/3` is exactly 1, like terms collect, `x/x` cancels, `(x+1)^2` expands.
- **Limits** — `limit sin(x)/x as x -> 0` → 1, by direct substitution or L'Hôpital, with **every symbolic answer cross-checked numerically** and withdrawn if the two disagree. One-sided limits (`x -> 0+`) and limits at infinity are supported, and — the part that matters — a two-sided limit that **does not exist** is reported as not existing: `abs(x)/x` at 0 gives −1 from below and +1 from above, so there is no two-sided limit, and saying  would be wrong. A limit that cannot be established is admitted rather than guessed.
- **Taylor & Maclaurin series** — `taylor exp(x) order 5` → 1 + x + x²/2 + x³/6 + x⁴/24, with **exact rational coefficients** rather than decimals, about any centre. The truncation is always shown as an O(...) term, and the radius of convergence is explicitly *not* claimed.
- **Differentiate** — symbolic, canonically simplified (`d/dx sin(x)cos(x)` → `cos(x)² − sin(x)²`).
- **Symbolic integration** — substitution, integration by parts, and partial fractions over exact rationals: ∫x·eˣ dx = eˣ(x−1), ∫dx/(x(x+1)), ∫dx/(x²+4) = ½·atan(x/2), ∫ln x dx = x·ln x − x, ∫tan x dx. **Every antiderivative is verified by differentiating it back**; anything that fails is discarded rather than returned, so a wrong closed form cannot reach you. What has no elementary form (∫eˣ², ∫sin(x)/x) is refused and integrated numerically instead, and says so.
- **Definite integrals** — exact with the antiderivative shown where a closed form exists; adaptive Simpson (and it says so) where none does; and **no value at all**, stated plainly, when the integrand is undefined somewhere in the interval (∫ln(x) from −1 to 2 does not exist, so no number is reported).
- **Inserts as real Word equations** — the derivation lands as editable OMML (fractions as fractions, ∫ with its limits), not as flat text.
- **Geometry** — mensuration exact in π (circle area 9π, not 28.274); **triangle solving** SSS/SAS/ASA/AAS and the **ambiguous SSA case**, which returns **two triangles, one, or none** and says which; analytic geometry on exact rational coordinates (lines, intersections, circle through three points, polygon area by shoelace, centroid, convexity, point-in-polygon, convex hull); **triangle centres** with the Euler line verified exactly; and **conic classification** — type any equation in x and y and it classifies by the invariants, rotates out the xy term, and reports canonical form, centre, foci, vertices, eccentricity and asymptotes. **Degenerate conics are named** (a point, two crossed lines, empty) rather than presented as ellipses.
- **3D geometry** — vectors (dot, cross, scalar triple product, projection and the perpendicular part), planes from three points with their normal, point-to-plane distance, line-plane intersection (meets it, parallel to it, or lying in it), tetrahedron and parallelepiped volumes, the sphere through four points, and transformation matrices reporting their **volume scale factor**, whether they **flip orientation**, and whether they are singular. **Two lines are classified exactly** as identical, parallel, intersecting or **skew** — the distance formula divides by a quantity that vanishes precisely when the lines are parallel, so the four cases are genuinely different answers rather than one formula applied blindly. Degenerate input is refused by name: three collinear points define no plane, four coplanar points bound no volume and lie on no unique sphere.
- **Algebraic topology** — integral **simplicial homology**: Betti numbers, **torsion**, and the Euler characteristic, for a built-in space (torus, Klein bottle, ℝP², spheres, Möbius band, annulus, figure eight) or a complex you type as maximal simplices. Computed over **ℤ** by Smith Normal Form, so H₁(ℝP²) comes back as **ℤ/2** rather than a bare Betti number that has thrown the torsion away. The Euler characteristic is cross-checked two independent ways on every result, and says so if they ever disagree.
- **Persistent homology** — paste a **point cloud** (one point per line, any dimension) and get a **persistence barcode**: which holes in your data are real features and which are sampling noise. A ring of measurements and a filled blob have the same mean, the same spread and similar correlations, and differ in H₁ — this is the tool that sees that. Vietoris–Rips filtration over 𝔽₂, with the most persistent feature in each dimension called out and the barcode inserted as a figure. Honest throughout: coefficients are 𝔽₂ (holes, not orientation or torsion), the Rips complex is a **proxy** for the shape the points came from, a long bar is **evidence** of a feature rather than proof, and every cap that bites is **reported** — including the important case where the cap lands below the dimension that would kill a feature, which makes those bars unreliable rather than merely incomplete.
- **Advanced topology** — **cellular homology** (ℝP² from three cells rather than thirty-one simplices, with the same ℤ/2 torsion), **characteristic classes** (Stiefel–Whitney and Chern via the splitting principle — exact symmetric-polynomial algebra, so w(T ℝPⁿ) is trivial exactly when n+1 is a power of two, and c(T ℂPⁿ) has top class χ), and **unoriented cobordism**: Stiefel–Whitney numbers are a *complete* invariant, which makes "does this manifold bound?" one of the few equivalence questions in topology that is genuinely **decidable** — and it is computed, not looked up. Ask about **spectral sequences, stable homotopy, the fundamental group or homeomorphism** and it tells you what is computable, what is not, and why (the E₂ page yes, the differentials no; π₁ can be presented and abelianised but never identified — the word problem is undecidable). Stating the limit is the point.
- **Knot theory** — the **Jones polynomial** of a knot or link from a braid word (`1 1 1` is the trefoil, `1 -2 1 -2` the figure-eight), computed **exactly** by the Kauffman bracket state sum over all 2ⁿ smoothings — every coefficient an exact integer. The two trefoils come back with different polynomials, which is the invariant detecting **chirality** where homology cannot; the figure-eight comes back palindromic, as an amphichiral knot must. Also **π₁ of the complement** as a Wirtinger presentation with its abelianisation. Honest on both counts: the Jones polynomial is **not a complete invariant** (distinct knots share it, and whether it detects the unknot is an open problem), so a match is evidence and never proof; and π₁ is **presented and abelianised, never identified**, because simplifying a group presentation is undecidable.
- **Alexander polynomial & K-theory** — Δ(t) from a braid via the reduced **Burau representation**, exact over ℤ[t,t⁻¹], with the knot determinant |Δ(−1)| and the Δ(t) = Δ(1/t) symmetry **verified on every result** as a built-in check. It also shows you its own limits: the two trefoils have the *same* Alexander polynomial where their Jones polynomials differ, so the tool offers both and says why. Plus **K-theory** for the spaces where **Bott periodicity** settles it outright — spheres, ℂPⁿ, a point, the torus — reported as a computation from the dimension rather than a table.
- **Serre spectral sequences & stable homotopy** — the **E₂ page** of a fibration is built as a grid (q upward, as you'd draw it), and every possible differential is **marked UNDETERMINED rather than guessed**: S¹ → E → S² has one d₂ that is an isomorphism for the Hopf fibration and zero for the trivial bundle — *same page, different answer*, so no H\*(E) is claimed. When the sequence **collapses** that is **proved** first, and what you get is the associated graded with the extension problem named. **Stable homotopy groups of spheres** are a **cited table** (Hatcher, Toda), labelled as a lookup on every result, and outside the tabulated range it says "not tabulated here" instead of continuing the pattern.
- **Boundary value problems, PDEs and DAEs** — y'' = f(x, y, y') with y fixed at **both** ends (finite differences or shooting); the **heat**, **wave** and **Laplace/Poisson** equations by finite differences; and semi-explicit **index-1 DAEs**. Each is honest about the thing that actually bites: a BVP may have **no solution, one, or infinitely many** and this says it reports one and cannot tell which; explicit heat stepping is stable only for r ≤ 1/2, so Δt is **reduced to satisfy it and the result says so** rather than returning the 1e300 garbage an unstable run produces; and an **index ≥ 2** DAE (the Cartesian pendulum) is **refused by name** instead of being solved into a slow drift off its own constraint. BVP solutions are computed on three grids and report the **observed convergence order** as a self-check.
- **Word problems** — percentages, distance = rate × time (including two bodies approaching/separating), successive shares; templates it cannot represent are **refused, not guessed**.

## 📏 Units — quantities & conversion
- **Typeset quantities** with SI conventions: `9.81 m/s^2` → 9.81 m/s², `5.0 +- 0.2 kg` → 5.0 ± 0.2 kg, `1.2e-3 mol/L` → 1.2 × 10⁻³ mol/L (thin space, superscripts, ±, ×10ⁿ).
- **Symbol fixes** — `ohm` → Ω, `degC` → °C, `umol` → µmol, `*`/spaces → ·.
- **Convert** across length, mass, time, temperature (affine), volume, pressure, energy, amount, and angle — e.g. `1 km → mi`, `100 °C → °F` — including **compound units** (`km/h → m/s`, `g/mol → kg/mol`), with significant-figure rounding. Insert the typeset quantity or conversion result.

## 📈 Plot — function & data charts
- Plot a **function** `y = f(x)` (`sin(x)/x`, `x^2`, `exp(-x^2)`; sin/cos/tan/exp/log/sqrt/abs…, constants pi/e) over an x-range.
- Plot **data** points (`x y` per line, optional `err` for error bars) as scatter — combine with a function on the same axes.
- **Multiple functions** at once (separate with `;`) with a labeled **legend**.
- Axes, ticks, gridlines, optional title and axis labels. Rendered offline as an image; nothing leaves your machine.

## 📐 Stats — statistics & uncertainty
- Turn experimental data into a paper-ready result, offline. Pick a test, paste numbers (separated by spaces, commas, or new lines), and it computes live.
- **Descriptive statistics** — n, mean, SD, **SEM**, variance, median, min/max, **95% CI** (t-based), CV.
- **t-tests** — two-sample (**Welch** or **Student** pooled) and **paired**, each with a real **p-value** and an APA-style report (*t*(18) = 2.41, *p* = .027).
- **One-way ANOVA** (F, df, p) and **linear regression** (slope, intercept, R², slope SE, slope p).
- **Uncertainty propagation** — enter a formula and `name = value ± uncertainty` lines; get the result with its **combined 1σ uncertainty** (first-order quadrature) and the dominant contributor.
- p-values use the regularized incomplete beta (Student-t and F distributions). Insert any result at the cursor. Analysis aid — verify before publishing.

## 📊 Table → Chart — patent figures & PowerPoint from a Word table
- Click anywhere **inside a table** in your document, press **Read selected table** — the add-in **auto-picks** the representation that fits its shape (chart, flowchart, block diagram, or table figure) and tells you why. Change it any time in **Show as**.
- **Charts** (numeric tables) — column, bar (horizontal), line, area, **scatter**, **stacked column / bar / area**, pie, doughnut. First column = category labels, first row = series names (when it's text); numbers may include `$`/`€`/`£`, `%`, thousands commas, units (`12 kg`), and accountant-style `(1,200)` negatives. Cells that aren't numbers are reported, not silently charted.
- **Flowchart** (text tables) — each row is a step, drawn top-to-bottom with arrows: a first column like `S101` becomes the step's **reference numeral** (with a lead line, patent-style); a step ending in `?` is drawn as a **decision diamond**; Start/End rows get rounded terminators; a `Step | Description` header row is skipped automatically. Ideal for **method-claim figures**.
- **Block diagram** (hierarchy) — each row is a path, e.g. `System 10 | Controller 20 | CPU 22`; shared parents merge into one **connected box tree** with orthogonal connectors. Leave a cell blank to repeat the value above (merged cells work). Ideal for **apparatus figures**.
- **Table figure** — draw the **table itself** as a clean figure, for characteristics/reference tables where the table *is* the exhibit. Preserves **section grouping** (a group-header row becomes a band; a blank "section" column merges down and is dropped if redundant), bolds/rules the header, **right-aligns numeric columns**, word-wraps cells, and scales wide tables to fit. Handles the dense clinical-style tables (`Section | Characteristic | n (%)`) common in specs.
- **Reference numerals** — number figure elements for callouts, drawn with **lead lines** to each element (37 CFR 1.84(q) style — free-standing numbers, not a column): block-diagram boxes get **hierarchical** numbers (100, 110, 112…) with a lead line to the box, flowchart steps get 102, 104… on alternating sides, and the table figure gets margin numerals with lead lines to each row/section. Auto-placed as a **starting point** — the drafter repositions them as needed.
- **Insert as a figure** at the cursor — the graphic goes into your document as an image; optionally **also insert the data as an editable table** beneath it, so the text stays editable.
- **Insert as an editable Word table** — for the table figure, insert a native, fully **editable** Word table instead of a picture (bold/shaded header, shaded section rows, right-aligned numbers). Edit the text like any Word table.
- **Smart column detection for charts** — a leading **row-index** column (1, 2, 3…) or a mostly-blank **section** column is recognized and skipped, so the real text column is used for labels (and the section groups them); `8,408 (75.0%)` reads as the count and a lone `(75.0%)` as +75% (not −75).
- **Patent figure style** — pure **black-&-white line art** for patent drawings (37 CFR 1.84-friendly): hatched bars/slices, dash patterns + marker shapes for line charts, white boxes with black outlines for diagrams, all-black ink, plus an optional **“FIG. N” label** beneath the graphic.
- **PowerPoint export** — download a .pptx that stays **editable**: a color chart exports as a native chart, a **table figure** as a native editable **table**, and a **flowchart / block diagram** as native editable **shapes** (boxes, diamonds, connectors — labels editable). Big diagrams **paginate across slides** — flowcharts continue via off-page connector circles (A, B, …) with numerals continuing, block diagrams split by branch with the parent repeated — so nothing gets crushed onto one slide. Only patent-hatched charts ship as a picture. Optional **source table on a second slide**.
- Generated entirely on your machine — the document never leaves Word.

## ⚖️ Citations — Bluebook legal citations
- Format citations from labeled fields, with the correct **italics** applied on insert (case names, article/book titles, signals).
- **Cases** — full (`Alice Corp. v. CLS Bank Int'l, 573 U.S. 208, 216 (2014)`) and short form (`Alice, 573 U.S. at 217`); court omitted for the U.S. Supreme Court, included for lower courts. Optional **parallel citations** (Rule 10.3.1) sit after the primary reporter (`… 573 U.S. 208, 134 S. Ct. 2347, 189 L. Ed. 2d 296 (2014)`). **T6/T10 abbreviation** of case names on request; an **unrecognized reporter is flagged** so a typo isn't inserted unnoticed.
- **Statutes & regulations** — `35 U.S.C. § 101`, `37 C.F.R. § 1.84`; multiple sections auto-switch to `§§`; optional subsection and year.
- **Patents** — `U.S. Patent No. 10,123,456` (digits auto-grouped, `D`/`RE` prefixes kept) with optional pincite and issue date; **application publications** `U.S. Patent Application Publication No. 2020/0123456 A1`.
- **Agency & secondary** — Federal Register (`85 Fed. Reg. 12,345 (Mar. 1, 2020)`), **MPEP** sections, **law-review articles**, and **treatises** (e.g. Chisum on Patents).
- **Practitioner / academic style** — a toggle for the two Bluebook typeface systems: *Practitioner* (briefs & office actions) italicizes case names and book titles; *Academic* (law-review footnotes) sets case names roman and authors/journals in large-and-small caps.
- **Reporter & court auto-correct** — messy input is normalized to canonical Bluebook forms (`f3d` → F.3d, `f supp 2d` → F. Supp. 2d, `fed cir` → Fed. Cir., `9th cir`/`ninth circuit` → 9th Cir., `cafc` → Fed. Cir., `sdny` → S.D.N.Y.).
- **Signals** — optional italicized *See*, *See also*, *Cf.*, *But see*, *Contra*, … prepended. Dates like `2014-06-19` or `3/1/2020` become `June 19, 2014` / `Mar. 1, 2020`.
- **Paste & fix** — paste a messy citation (`35 usc 101`, `alice corp v cls bank, 573 us 208 (2014)`, `US Pat No 10123456`) and it detects the type and fills the fields for you to review, then reformats it. Best-effort — verify the result.
- **Id. / supra short forms** — `Id.` / `Id. at 217` for the immediately preceding authority; `<name>, supra note 15, at 912` for an earlier source; plus a one-click "→ Short form of this case".
- **Find all citations (register)** — scan the document for a running record of every authority with a **usage count**, flagging any cited more than once, so you can see repeats before building the table. Once the field-based table has been built and updated (F9), Find again and each authority also shows its **page numbers** (read back from the table). Copyable; nothing is written to the document. (Short forms — *Id.*, *supra*, "…, 925 F.3d at 1237" — aren't counted, same as Word's own citation marking.)
- **Table of Contents** — insert a native Word Table of Contents built from your Heading 1–3 styles, with page references (FRAP 28(a)(2)). Select all and press F9 to populate; it updates with the document.
- **Table of Authorities** — scan the whole document for citations and build a grouped, alphabetized, de-duplicated authorities list (Cases · Statutes · **Rules** · Regulations · Patents · Other Authorities), **case names italicized** and each cite carrying its **(court year)** parenthetical (OSG/Bluebook form) — the FRAP 28(a)(3) order. The field-based table italicizes case names too (via Word's "keep original formatting"), and the button **clears any existing citation marks first** so a stale/corrupt entry can't survive the rebuild. Now also captures **unpublished decisions** (`… 2017 WL 11546716`, `… 2013 U.S. Dist. LEXIS 169661`), the **F.R.D.** reporter, **Fed. R. Civ. P.** rules (bare `Rule 12(b)(7)` and qualified `Fed. R. Civ. P. 19(a)`), and party names with **diacritics** (`Suárez`), **en-dashes** (`Roussel–UCLAF`), or **comma-separated firm names** (`Hamilton, Brook, Smith & Reynolds, P.C.`). The **formatted list** writes a clean **static** table (no Word fields) — Times New Roman, italic case names, each entry on **two lines** (name, then the reporter + (court year) indented with a dot leader), matching a standard court-brief template. To fill page numbers, a simple 3-step flow: click **“Insert with live page numbers”** (a temporary Word field table), select all and press **F9** (Word computes the pages), then click **“Insert formatted list”** — it copies those pages into the static table and removes the temporary one for you. One-click removal of citation marks / TOC-TOA tables is available for a clean rebuild. (Under FRAP 32(f) the TOC and TOA are excluded from the brief's word count.)
- **Copy** the plain text or **insert** the formatted citation. Drafting aid — verify against the current Bluebook.

## 🔖 Refs — captions & cross-references
- **Auto-numbered captions** — "Figure 1.", "Table 2." with per-document running counters (saved in the file).
- **Cross-references** — insert "Fig. 3", "Table 2", or "Eq. (1)".
- **Check captions** — flags skipped or duplicated figure/table numbers. (For live auto-renumbering, Word's own cross-reference fields remain the authority.)

## 💵 Finance — calculators & formulas
- **18 calculators** (compute & insert the result) spanning: **time value of money** (future/present value, annuities, growing annuities), compound interest & **effective annual rate**, **loan payment** and **amortization schedule**, **NPV/IRR** and date-aware **XNPV/XIRR** from a cash-flow list, **DCF valuation** with a Gordon-growth terminal value, **bond analytics** (price, **YTM**, **Macaulay/modified duration**, **convexity**), **Black–Scholes** option price with **Greeks** (Δ Γ Θ ν ρ) and **implied volatility**, **depreciation** (straight-line/declining-balance), and **return statistics**. Pick a calculator, fill the inputs, and the result computes live (robust root-finding under the hood).
- **Finance formula library** — typeset equations in **Math** mode's *Formula library*: time-value-of-money, valuation & options (NPV, Gordon growth, WACC, Black–Scholes, put–call parity), and portfolio & bonds (CAPM, Sharpe ratio, portfolio variance, beta, bond price, duration).
- Rates entered as percentages; values are currency-neutral. Runs entirely offline.

## 🧫 Bio/Assay — quantitative life-science tools
- **Curve fitting, offline.** Paste your data and the fit runs entirely on your machine (Levenberg–Marquardt nonlinear least squares) — no server, no GraphPad round-trip. Each fit reports the parameters with **standard errors** and **R²**, and draws the **fitted curve over your data points** as a plot you can insert.
- **Enzyme kinetics** — **Michaelis–Menten** (V_max, K_m) and **Hill** (V_max, K, cooperativity coefficient *n*) fits; **catalytic efficiency** (k_cat, k_cat/K_m). The classic Lineweaver–Burk / Eadie–Hofstee / Hanes–Woolf linearizations seed the fit so no starting guess is needed.
- **Dose–response** — a **4-parameter logistic** returns **IC50 / EC50**, Hill slope, plateaus, and **pEC50** (agonist and inhibition curves both fit the same model); **Cheng–Prusoff** converts an IC50 to the true K_i.
- **Receptor binding** — one-site **saturation binding** (B_max, K_d).
- **Everyday lab math** — **Henderson–Hasselbalch** buffer pH, **Beer–Lambert** concentration from absorbance, **dilution** (C₁V₁ = C₂V₂) and **serial-dilution** planning, and **A260 / A280** nucleic-acid and protein quantitation.
- Insert the result as text and, for the fits, the fitted-curve figure. Analysis aid — verify before publishing.

## 🔬 Build — structures & Markush genus
- Build a 2D structure from a typed **atom/bond list** or a pasted **MDL molfile**.
- Bonds: single `-`, double `=`, triple `#`, undefined `~`, stereo wedge `>` / hash `<`; atom charges; hydrogens filled automatically.
- **Markush / generic** atoms: `[C,N]` lists, `X` halogen, `A` any atom, `Q` heteroatom, `R`/`R1`/`R2` R-groups.
- **R-group legends** — insert "where R1 = …" as a line *or* a structured **R-group | Definition table**.
- **Sub-generic (nested) R-groups** — `R1 = C1-6 alkyl substituted with R1a`, and `R1a` gets its own input automatically.
- **Definition shorthands** — `C1-6 alkyl` → C₁–C₆ alkyl, "optionally substituted", variable counts (`n=1-3`).
- **Query features** for a rigorous genus — `{ar}` aromatic, `{ring}` in-ring, `{r5}`/`{r6}` ring size, `{sub}`/`{nosub}` open/closed substitution; bonds `{ring}`/`{ar}`.
- **Substituent gallery** — depict R-group alternatives as drawn 2D structures (`R1a = c1ccccc1`, `R1b = c1ccncc1`).

## 💻 Code
- **Algorithm / pseudocode blocks** — bold control-flow keywords, line numbers, optional caption ("Algorithm 1: KeyGen"). Ideal for crypto & CS claims.
- **Code listings** — verbatim monospace, whitespace-preserving, optional line numbers.

## 🧬 Sequence — WIPO ST.26
- Generate a **draft ST.26 sequence-listing XML** from DNA/RNA/protein sequences.
- Per-sequence molecule type and organism; the source **mol_type** picks from the full ST.26 controlled vocabulary (genomic DNA/RNA, **mRNA, tRNA, rRNA**, other/transcribed/viral RNA, …). Residues are cleaned (whitespace/numbering stripped, case normalized, IUPAC ambiguity codes accepted, invalid residues flagged).
- **Feature annotation** — add **CDS / gene / mRNA / misc_feature** features with a location (`1..300`) and the common qualifiers (`/gene`, `/product`, `/note`). A **CDS auto-generates `/translation`** from the coding region using the verified genetic code (plus `/codon_start`), and flags a reading-frame warning if the length isn't a multiple of 3.
- Applicant / invention-title / application metadata; **download `.xml`** or **copy**.
- *Always validate the output in the WIPO Sequence tool before filing.*

## 🔗 Peptide — structure from a sequence
- Draw a **peptide's 2D structure** from its amino-acid **sequence** and insert it.
- **One-letter** codes (`ACDEFG`, spaces optional) or **three-letter** codes with separators (`Ala-Gly-Ser`, `Met Lys`).
- Free N- and C-termini; reports **residue count, molecular formula, and molecular weight**. Unrecognized residues are flagged, not silently dropped.
- Shows **connectivity** (stereochemistry isn't drawn — so it never asserts a wrong configuration). Best for short peptides; long chains render densely. Verify before relying.

## 🌿 Botanical — plant patents
- **Scientific-name typesetting** with correct nomenclature italics — genus, species, and infraspecific epithets italic; rank connectors (`subsp.`/`var.`/`f.`), author citations, hybrid `×`, and cultivars (`'Peace'`) roman; quotes normalized, genus capitalized.
- **Varietal characteristics table** from `Label: value` lines (plant height, flower color/RHS, habit, …).

## 🧬 DNA — sequence analysis
- **Reverse complement** / complementary strand (IUPAC ambiguity codes accepted).
- **Transcription** — coding strand → mRNA (T → U).
- **Translation** — to protein in any reading frame (**+1/+2/+3** and reverse **−1/−2/−3**); stop codons shown as `*`; degenerate codons resolved when unambiguous (e.g. `GCN` → Ala); optional "stop at first stop".
- **GC content & base composition** — length, A/C/G/T counts, GC%.
- **Six-frame ORF finder** — ATG → in-frame stop across all six frames, with a minimum-length (aa) filter; results as a Strand/Frame/Location/Length/Protein table you can insert.
- **Bench tools** — primer **Tm** (Wallace / GC%), **protein properties** (MW, pI, GRAVY) of the translation, and a **restriction-site** scan (common type-II enzymes).
- Live as you type; insert any result (strand, mRNA, protein, ORF table) at the cursor. Companion to **Sequence** mode (which produces the ST.26 listing). Drafting aid — verify downstream.

## 🔢 Numerals — reference-numeral management
- Maintain a **numeral → element table** (widget 10, housing 12, fastener 14, …) **saved inside the document**, so each case keeps its own list.
- **One-click callout insertion** at the cursor — `housing (12)` (or no-parens `housing 12`); next numeral is auto-suggested (10, 12, 14 …).
- **Scan document** to flag **collisions** (one numeral reused for two elements), **gaps** (skipped numbers), **orphans** (a callout with no table entry), and **unused** entries (defined but never called out).
- **Insert the "List of Reference Numerals"** section — a heading plus a sorted Numeral | Element table.
- Advisory, in the house style: the scan detects both the parenthesized callout form `(12)` and the non-parenthesized `element 12` form (matched to your table's element names) — verify before filing.

## ⚗️ Reaction — reaction schemes
- Compose `reactants + reactants >> products` with optional conditions over/under the arrow (`; over ; under`).
- **Multi-step** schemes too — `A -> B -> C` draws an arrow between each stage.
- Each component is a name or SMILES (formal charges like `[N+]` are kept intact), drawn with OpenChemLib; the scheme inserts as one image with provenance alt-text.

## ✅ Audit — check this application
- One pass over the whole document runs every consistency check at once: **reference numerals** (uses your Numerals table), **SEQ ID NO** references vs. the listing, **figure-number** continuity, and **cross-reference validity** (every "Fig. N"/"Table N" has a matching caption).
- Grouped report with a ✓ per clean area. Advisory — every check is heuristic; verify before filing.

## Preferences & polish
- Your **callout-parenthesis** and **default DNA frame** choices are remembered between sessions.
- In **Sequence** mode, insert a canonical **SEQ ID NO: N** in-text reference.

---

*Questions or requests? Contact the maintainer. Each release is tagged in source control.*
