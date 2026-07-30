# Known defects — found, verified, NOT yet fixed

Opened 2026-07-29. Every entry below was **reproduced with a concrete input** during
an independent adversarial review, and every entry is **still present** in the
shipped code. This file exists because the findings were sitting in a
session-scoped scratchpad that would have evaporated, and because at least one of
them is a wrong number presented as exact — shipping that undocumented is worse
than shipping it documented.

Ordering is by severity, not by module. The scale:

- **A — a wrong number presented as correct.** Reaches the document, looks
  authoritative, nobody can eyeball it.
- **B — a lost capability or a false message.** Refuses something it can do, or
  says something untrue about what it did.
- **C — cosmetic or unreachable today.**

When one is fixed, delete the entry and put the reproduction in a test. An entry
removed without a test is an entry that will come back.

## Fixed since this file was opened

Each was closed with its reproduction moved into a named test, not merely patched.

| was | now | proof |
|---|---|---|
| **A10** a pole reported as a root — `1/(x-2.25) = 0` gave the root 2.25 where the LHS is −1.1e12; `tan(x) = 2` gave 1176 "roots" alternating solutions and asymptotes | every returned root is substituted back and must have a small residual; 588 real solutions to `tan(x) = 2` retained, all asymptotes gone | `rootsAreRoots.test.ts` |
| **A11** two absolute tolerance BANDS — `1e-10·x² − 1e-4 = 0` returned one root where there are two; `1e-13·x² − 1 = 0` returned "no solution" for roots ±3162277.66 | the discriminant test is relative to the coefficients; `trimPoly` removes only EXACT zeros | `rootsAreRoots.test.ts` |
| **A12** `(x-1)/(x-1) = 1` returned 4000 roots in 2.9 s | reported as an identity, in under a millisecond | `rootsAreRoots.test.ts` |
| **B10** the printed antiderivative was rounded to 6 decimal places, so `1.154701*atan(...)` did not re-parse to the function integrated | 12 significant figures; the printed expression is re-parsed and must reproduce the reported value | `divergentIntegral.test.ts` |
| **B14** two beam-height tests parsed the height out of the SVG they generated, so they could not fail | both assert against `BEAM_CHART_SIZE`, and a negative control confirms they now catch a ±10/50/200/1000 perturbation | `beamChartGeometry.test.ts` |
| **A12 (second pass)** the identity check tested `f === 0` exactly, so it caught only the three examples in the report — `sin(x)^2+cos(x)^2 = 1` still gave 3620 roots and `exp(ln(x)) = x` gave 852 | compared relative to the two sides, evaluated separately; 8 further identities close, and near-identities asserted NOT to close | `rootsAreRoots.test.ts` |
| **A12 (third pass)** `exp(x) = 0` returned 510 fabricated roots from the underflow region with a warning attached | withheld entirely — a caveated number is still a number in the document | `rootsAreRoots.test.ts` |
| **A1** settling time used the underdamped envelope for ζ ≥ 1 and ran BACKWARDS — more damping gave a shorter time. ζ=20, ωₙ=1 reported 0.2 s against a true 156 s, flagged `exact` | solved for the 2% crossing of the actual overdamped/critically-damped step response; verified against a simulated response to 4 significant figures at nine (ζ, ωₙ) pairs | `controlMargins.test.ts` |
| **A2** `margins` reported the FIRST gain crossover, giving 32.5° for a loop whose three crossings are 33.0°, 148.8° and 23.1° | every crossing collected, the minimum reported, and the full list disclosed in a note; the same for gain margin at multiple phase crossovers | `controlMargins.test.ts` |
| **A3** the sweep came from pole/zero magnitudes, which do not move with gain, so `1e12/(s+1)³` — crossover at ω = 10005, sweep ending at 100 — was reported as having NO phase margin | the range is extended until \|L\| brackets 1, bounded to 12 decades each way; asserted across seven gains from 1e3 to 1e15 | `controlMargins.test.ts` |
| **A4** `(s²+1)³` — three double poles at ±i, marginally stable — was reported UNSTABLE with 2 poles in the right half plane | repeated roots detected EXACTLY via gcd(p, p′) over the rationals, and the verdict withheld as UNDETERMINED only when Routh also cannot answer AND a pole is near the axis; the refusal itself is asserted | `controlMargins.test.ts` |
| **A5** the NCA area ran from the FIRST SAMPLE, so dosing-to-first-sample was missing; clearance error grew from 1% (first sample 0.25 h) to **98%** (4 h), unflagged | IV back-extrapolates C0 log-linearly and integrates the fitted exponential; oral uses C(0) = 0, which is exact. Error is now independent of when sampling started, and converges to 0.00% as sampling densifies — proving the remainder is trapezoidal discretisation | `pkNca.test.ts` |
| **A6** an oral terminal slope may be ABSORPTION; `ka=1.0/ke=0.1` and `ka=0.1/ke=1.0` both reported t½ = 6.93 when the second one's true elimination t½ is 0.693 | every oral result carries a flip-flop warning naming the ten-fold case, saying an IV reference is needed, and to read it as the slower of the two rate constants | `pkNca.test.ts` |
| **A7** the steady-state peak used F·Dose/Vd — instantaneous input — and silently ignored a supplied absorption rate, overstating the peak by **21% to 97%** | the standard multiple-dose oral solution at its own tmax, verified to 1e-6 against a superposition simulation at five (ka, ke) pairs; without ka the assumption is stated and the peak called an upper bound; a `ka` field added to the pane so the corrected path is reachable | `pkNca.test.ts` |
| **A8** `limit x^2 as x -> 0.0001` printed `= 0` for an answer of 1e-8, and one case printed a headline contradicting the step line beneath it | **already fixed** by the `fmtNum` change in v2.40.0 — the symptom was 6-decimal-place rounding, not a limit error. All three reported cases pinned so it stays fixed | `limitsAndCas.test.ts` |
| **A9** the convergence test `spread <= 1e-4*(1 + \|last\|)` had an absolute floor, so any tail below ~1e-4 passed however wildly it swung: `1e-5*sin(1/x)` returned −6.11e-6 where `sin(1/x)` was correctly undetermined | judged against the tail's OWN magnitude, which is scale-invariant, with the envelope trend separating a decaying oscillation (limit 0) from a steady one (no limit). Eight scale factors from 1 to 1e-30 asserted | `limitsAndCas.test.ts` |
| **B7** partial fractions divided by the denominator's leading coefficient, which the basis polynomials already carry, so the verification gate rejected every result and a dozen textbook integrals were refused | the erroneous division removed. **Broader than reported**: it also affected every DECIMAL coefficient, since those become non-monic under exact-rational rescaling. Values confirmed identical to 10 significant figures against the numeric path that was picking up the slack | `limitsAndCas.test.ts` |
| **B9** the rational-root cap bounded the divisor SEARCH but not the CROSS PRODUCT, reaching 1.6M exact BigInt evaluations per degree — **20.6 s** of synchronous work per keystroke | the product itself is capped, and a truncated search now reports `incomplete` rather than implying no rational roots exist. 1710 ms → 34 ms; the degree-8 integral 20639 ms → 286 ms | `limitsAndCas.test.ts` |

**The A tier is now empty.** Every defect that produced a wrong number presented as
correct has been closed, each with its reproduction moved into a named test.

### Closed in v2.44.0

| was | now | proof |
|---|---|---|
| **B1** exact rational elimination on a 120-node mesh took **1362 ms**, its sweep another **1102 ms** — ~2.5 s in a pane that recomputes on every keystroke | above 48 unknowns the DC solve uses doubles and **says so**; the sweep's point count is budgeted on points × nodes³. 1362 → 38 ms, 1102 → 183 ms. Small circuits keep full exactness and full resolution, asserted | `passiveAndParsers.test.ts` |
| **B2** `parseValue("1e-6")` refused while `1u` — the same number — was accepted, so anything pasted from a spreadsheet or SPICE deck failed | scientific notation accepted, with the exponent folded into the **exact rational** rather than only the float, so the notation cannot silently change the guarantee | `passiveAndParsers.test.ts` |
| **B4** the singular-matrix fallback advised checking for "a shorted or duplicated source" — a fault caught upstream, so it could never be the answer | a union-find pass finds loops of voltage sources and inductors (which the parallel-pair test cannot see), and the remaining fallback names only what has **not** been ruled out | `passiveAndParsers.test.ts` |
| **B5** a negative resistance, inductance or capacitance was accepted in silence by a module documented as linear and PASSIVE | refused, explaining that a negative resistance is a real small-signal model but needs the active-device support this tool does not have | `passiveAndParsers.test.ts` |
| **B6** member tension/compression came from the FLOAT while the zero test used the exact rational, discarding the one guarantee the exact path exists for | `ratSign` for both | `passiveAndParsers.test.ts` |
| **B8** `abs(u)^2` never reduced, so casint's advertised canonical net could not recognise d/dx ln\|x\| as 1/x and did **not run** on any `ln\|·\|` result | `abs(A)^n → A^n` for even n (exactly true), `A^(n-1)·abs(A)` for odd. `exprEqual` now recognises them | `passiveAndParsers.test.ts` |
| **B12** parse errors named internal token types: `abs x` gave "Expected lparen in math expression." | names the character and says what it found instead | `passiveAndParsers.test.ts` |
| **B13** `A ->> B` left "> B" as a component, handed to OpenChemLib as SMILES — it did not error, it drew something | stray delimiters stripped and reported; done by trimming ends rather than widening the arrow pattern, because `[O-]` and `C[N+](C)(C)C` contain the same characters | `passiveAndParsers.test.ts` |
| **C3** `isSymmetric` used an absolute floor and was wrong in BOTH directions — `[[1e-20,1e-20],[2e-20,1e-20]]` reported symmetric with 100% asymmetry, `[[1e20,1],[1.0000001,1e20]]` reported not | relative to the matrix's largest magnitude, so scaling a matrix cannot change the answer. Matters because `eigenSymmetric` is gated on it and Jacobi is only valid for symmetric input | `passiveAndParsers.test.ts` |

### Closed in v2.46.0

| was | now | proof |
|---|---|---|
| **C0** `integral of sin(x)/x over [-1,1]` is 1.8922 and was REFUSED, because adaptive Simpson's first midpoint is exactly 0 where sin(0)/0 is NaN | composite **Gauss–Legendre**, whose nodes lie strictly inside each panel, so no endpoint or panel boundary is ever evaluated and the undefined point is never visited. Refined until two panel counts agree to eleven significant figures. Seven integrands verified against an independent high-resolution midpoint rule to 5e-7 or better | `divergentIntegral.test.ts` |

**A correction to the v2.45.0 record.** That release said an earlier averaging repair
"produced wrong numbers", quoting 0.9728 for the integral of (1−cos x)/x² over [−1, 1]
"against a true 0.9896". **The 0.9896 was wrong** — a hand figure that was never
checked. The series (1−cos x)/x² = ½ − x²/24 + x⁴/720 − … gives
2(½ − 1/72 + 1/3600 − …) = **0.9727708**, confirmed against an independent midpoint
rule. So the reverted fix had been correct all along and was discarded for nothing.

Using an unverified figure as the oracle to judge a fix is the mistake, and this one
cost a working fix and a release. Gauss–Legendre is still the better rule and is what
ships — it never visits the singular point rather than reconstructing a value there,
its nodes stay clear of the region where an integrand like (1−cos x)/x² loses precision
to cancellation, and it carries its own convergence evidence — but it was chosen on its
merits, not because the alternative was broken.

**The trap this fix walked into, caught by an existing test rather than by foresight.**
Gauss–Legendre never evaluates an endpoint, which is exactly why it can rescue a
removable singularity there — and exactly why `integral of 1/x over [0,1]`, which
diverges, came back as a confident finite number. The structural pole search only
reports poles strictly INSIDE the interval, because an endpoint pole used to be caught
by Simpson evaluating that endpoint. Endpoints now get their own `isGenuinePole` check:
removable is allowed through, a pole is not.

### Closed in v2.45.0

| was | now | proof |
|---|---|---|
| **B15** `cosh(x)²−sinh(x)²=1` is an identity and returned **33 spurious roots**. A tolerance built on the size of the ANSWER cannot see catastrophic cancellation, because that is exactly when the answer is tiny and the intermediates are enormous — at x = 18 both squares are ~1.1e15 and the difference carries 0.25 of dust | `evalAstScaled` reports the largest magnitude the evaluation passed through, and the identity test scales by that. Deterministic, with no threshold tuned to an example — unlike the perturbation estimate reverted in v2.40.1, which also called `tan(x)=2` an identity. Ten identities close, twelve near-identities asserted not to | `cancellationAndNotation.test.ts` |
| **B11** `1/2x` read as `1/(2x)` in solve.ts and `(1/2)x` in mathParse.ts — the same text meaning two different functions in two parts of one product, differing by a factor of (2x)² | **refused by both**, with both readings offered back. Neither convention was chosen because neither is settled: most CAS take one, much handwritten mathematics the other, and ISO 80000-1 says not to write it | `cancellationAndNotation.test.ts` |
| **C1** `parseFormula("CuSO4·5H2O")` deleted the hydrate dot, merging "O4" with the following "5" into "O45" → O:46 instead of O:9 | dot-separated parts parsed independently and multiplied by their coefficient. **And bracket groups**, found while fixing it: `(SO4)3` read as `SO43` → O:43, so the hydrate fix alone would have swapped one silent mis-parse for another. An unclosed bracket now yields nothing rather than a partial guess | `cancellationAndNotation.test.ts` |

### What B11 did NOT settle — closed in v2.47.0, and it was mis-classified

The `2^2x` disagreement was recorded here as a cosmetic inconsistency to be left alone.
**That was wrong, and the mis-classification is the interesting part.** Measuring it
before touching it — the habit that has caught something in almost every round — showed
the same fault made `r^2 h` parse as r^(2·h), which for r = 3, h = 2 evaluates to **81**
where the answer is 18. That is a wrong number, not a difference of opinion, and it
belonged in the A tier.

There were two causes and both are fixed:

- Implicit multiplication was formed inside the parser's NUMBER branch, so a number
  followed by a letter became a product **anywhere** — including inside an exponent,
  the one place it must not.
- All whitespace was **deleted** before parsing, gluing adjacent names into one: `pi r`
  became a variable called "pir" and `y z` became "yz". So `pi r^2 h`, the shipped
  formula for the volume of a cylinder, parsed as "pir" raised to the power (2·h).

Implicit multiplication now lives in the product rule, the exponent takes a single
atom, and whitespace separates factors. `2^3^2` is still 512, `x2` is still one
variable, and a bare function name — `sin x` — is now refused as a missing bracket
rather than becoming a variable called "sin".

Caution about "re-reading every expression already in a document" was the reason given
for leaving it. That was the wrong instinct: the old reading was not a different
convention that someone might have relied on, it was arithmetic nobody wants. The
300-expression behavioural baseline did not move at all.

**How the scope of the B11 refusal was found to be wrong, twice.** Usage was surveyed
in `examples.ts` and the manual before deciding to refuse, and came back zero — but
`formulaLibrary.ts`, the actual shipped content a user inserts, was not surveyed. The
first version also matched `^`, which broke four shipped formulas (`V = pi r^2 h`,
`V = (1/3) pi r^2 h`, `P = I^2 R`, and two-asset portfolio variance). The full test
suite caught it. A usage survey that misses where the usage lives is not a survey, and
there is now a test that walks the whole formula library.

### B3 could not be reproduced

`docs/KNOWN-DEFECTS.md` listed "the Bode chart is blank when the reference is zero".
Swept a high-pass whose output is genuinely zero at DC — `V1 1 0 5 / C1 1 2 1u /
R1 2 0 1k` from 1 µHz to 1 MHz — and every one of the 20 points came back finite,
with a dB range of −150 to +14 and no non-finite value anywhere. The `dB()` helper
does return −Infinity for a zero magnitude, which is the correct IEEE answer and is
guarded at every call site.

Left open rather than closed, because "I could not reproduce it" is not "it does not
happen": it may need a specific netlist, or it may live in chart rendering rather
than in the sweep. The `svgMarkupFinite` harness added in v2.39.0 greps generated
markup for non-finite values and would catch the rendering case.

A **behavioural baseline** now covers 300+ inputs across the solve, integrate and
differentiate surface (`solveBaseline.test.ts`). It is not an oracle — it does not
claim any answer is correct — it claims that nothing changed unintentionally. It is
the instrument that caught the one regression this round introduced, described
below.

### The lesson from that regression, since it is the whole risk of this file

Making the `trimPoly` threshold *relative* looked like the obvious fix and was
wrong in a new direction: scaling by the LARGEST coefficient meant `x - 1e300 = 0`
compared its x coefficient of 1 against 1e285, deleted it, and returned **"no
solution"** for an equation whose root is 1e300. A big constant term does not make
the x term negligible.

The real conclusion is stronger than "use a relative tolerance": **"is this
coefficient zero" is not a question about magnitude at all.** Only an exact zero is
zero. Every threshold, absolute or relative, deletes a real root somewhere.

---

## A — wrong numbers

**Empty.** Every defect that produced a wrong number presented as correct has been
closed — A1 through A12 — each with its reproduction moved into a named test rather
than merely patched. See the table at the top for which test holds which closure.

An entry belongs here only if it makes the product state something false about a
number it computed. Anything that refuses work it could do, or says something untrue
about HOW it computed, belongs in section B.

---

## B — lost capability, or a message that is false

### B3. Circuits: the Bode chart is blank when the reference is zero
`src/lib/circuit.ts`. Same shape as the pharmacokinetics figure fixed in this
release: a log axis with a zero reference. Worth checking against the new
`svgMarkupFinite` harness.

---

## C — cosmetic, or unreachable today

### C2. `parseRatLiteral("1e400")` returns an exact 401-digit rational whose `ratToNumber()` is Infinity
`src/lib/cas.ts`. Correct as far as it goes, but the conversion boundary is where
the honesty is lost.

## Reviewed and found clean

Recorded because a negative result is worth as much as a positive one, and because
re-reviewing this ground is waste:

- **Exact rational arithmetic.** 4000 composed operations, zero violations of
  `d > 0`, `gcd(|n|,d) = 1`, canonical `0/1`. `1/3+1/3+1/3` is exactly 1.
  `parseRatLiteral("0.1")` is 1/10, not the double.
- **Removable singularities in solving.** `(x²−1)/(x−1) = 0` gives only `-1`;
  `= 2` correctly gives no roots because x = 1 is not in the domain.
- **No extraneous roots from squaring.** `sqrt(x) = -1` gives none.
- **Durand–Kerner** on 11 polynomials of degree 3–6 including triple roots, roots
  of unity, and badly scaled `1e6·x³−1` / `1e-6·x³−1`: every root correct to 6 dp
  with the right multiplicities.
- **Symbolic rearrangement**, including the conditions: `x/(x−1)=y` gives
  `y/(y−1)` with both conditions stated.
- **67 antiderivatives** verified by differentiating back on grids deliberately
  disjoint from `casint`'s own sample points. **36 definite integrals** matched an
  independent high-order Simpson to 10 significant figures or better.
  `integrate("x^x", 0, 1)` = 0.7834305109587045, which is Sophomore's dream.
- **Chemistry formula parsing**: 40 formulas including `K4[Fe(CN)6]`,
  `K3[Fe(C2O4)3]·3H2O`, group charges, `^`-charges, and both hydrate spellings.
  `Co` (58.933) is correctly distinguished from `CO` (28.010).
- **Mass spectrometry adducts**: all 9 hand-verified, including `[M+2H]2+` and
  `[M-2H]2-`; charge division and electron sign correct throughout.
- **Isotope patterns**: Cl₂ gives 100 : 63.92 : 10.22, which matches an exact hand
  convolution of the module's own abundances. Worth recording that **the brief's
  expected 100 : 65 : 10.6 was the stale value** — it derives from superseded
  75.53/24.47 abundances, and current IUPAC/NIST is 75.76/24.24. The code is right
  and the expectation was wrong.
- **Molar masses**: 9 compounds within 4.0e-5 relative of textbook. The small
  deviations are abridged versus unabridged IUPAC weights, which the module
  declares.
- **Work bounds**: `(a+b+c)^40` in 119 ms, a 2000-term sum in 37 ms, a 5000-term
  differentiate in 198 ms, 3000 nested parentheses in 1 ms. `mathParse` has no
  unbounded loop — every parse path consumes at least one token.
- **Reachability**: 639 exports checked, **zero** broken wiring.

### Scope note
There is **no chemical equation balancer** in this codebase. `reactions.ts` parses
a reaction DSL and composes SVG; it never checks element or charge conservation.
Any review brief asking about balancing has nothing to test.
