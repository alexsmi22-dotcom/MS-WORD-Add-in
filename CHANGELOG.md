# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

> Note: this file was not maintained between v1.96.0 and v2.23.0. Those releases
> are recorded in the git history rather than here.

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
