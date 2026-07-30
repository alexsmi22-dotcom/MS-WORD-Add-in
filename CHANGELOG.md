# Changelog

All notable changes to JurisLab. Dates are release/pilot dates.

> Note: this file was not maintained between v1.96.0 and v2.23.0. Those releases
> are recorded in the git history rather than here.

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
