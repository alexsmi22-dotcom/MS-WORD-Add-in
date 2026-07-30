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

### A8. Limits: the reported answer contradicts its own working
`src/lib/analysis.ts:296`, surfaced at `src/taskpane/taskpane.ts:12246`, which
prefers the symbolic `exact` string over the numeric `value`. There is a
cross-check against direct substitution at line 219 for the numeric probe, and
none for the symbolic one. Reproduced end to end:

| typed | printed | true |
|---|---|---|
| `limit x^2 as x -> 0.0001` | `= 0` | `1e-8` |
| `limit 0.5e-6 + x as x -> 0` | `= 0.000001` | `5e-7` |
| `limit 1e-7 + x as x -> 0` | `= 0`, then "Direct substitution gives 1e-7" | `1e-7` |

The third prints a headline that contradicts the step line directly beneath it,
misquotes the expression as `x + 0`, and carries no caveat. No tiny constant needs
to be typed — a small limit POINT is enough. Suspected root cause is the
decimal→rational conversion inside the CAS.
**Fix direction:** apply the same `direct` cross-check to the symbolic branch that
line 219 already applies to the numeric one, and disagree loudly rather than
picking one.

### A9. Limits: an absolute floor invents a limit that does not exist
`src/lib/analysis.ts:113`. The convergence test is `1e-4 * (1 + |last|)`.
`limit sin(1/x) as x -> 0` correctly returns "undetermined";
`limit 1e-5*sin(1/x) as x -> 0` returns **-6.112e-6** with only the generic
"numeric only" caveat. Multiplying by a positive constant cannot change whether a
limit exists. This is the `1 + |x|` absolute-floor shape this project has already
been bitten by: it is not a relative tolerance, it is a relative tolerance with an
absolute floor bolted on, and the floor is what does the damage.
**Fix direction:** a purely relative criterion plus a separate oscillation test
scale-invariant under multiplication.

---

## B — lost capability, or a message that is false

### B1. Circuits: a 2.08 s recompute at the legal-maximum netlist
`src/lib/circuit.ts`. The pane recomputes on every keystroke, so this is two
seconds of frozen typing per character at a netlist size the parser explicitly
allows.

### B2. Circuits: `parseValue` rejects scientific notation
`src/lib/circuit.ts`. `1e-6` is refused where `1u` is accepted. Anyone pasting
from a spreadsheet or a SPICE deck hits this.

### B3. Circuits: the Bode chart is blank when the reference is zero
`src/lib/circuit.ts`. Same shape as the pharmacokinetics figure fixed in this
release: a log axis with a zero reference. Worth checking against the new
`svgMarkupFinite` harness.

### B4. Circuits: the fallback message names cases that cannot occur
`src/lib/circuit.ts`. The message offered when the solve fails lists causes that
the code has already excluded upstream, so it sends the user looking for a problem
they do not have.

### B5. Circuits: no passivity check
`src/lib/circuit.ts`. A negative resistance is accepted silently.

### B6. Trusses: member state is read from the float, not from `ratSign`
`src/lib/truss.ts`. The whole point of the exact path is that the sign is
decidable; taking tension/compression from the rounded double throws that away
for a member whose force is near zero. One line. Non-finite member forces are also
reported rather than refused.

### B7. CAS: `scale()` by the leading coefficient makes every non-monic rational integral unreachable
`src/lib/casint.ts:274`. The coefficient-matching system already solves
`num = Σ Aᵢ·(den/fᵢ)`, so the extra `1/lead` is wrong; the self-verification gate
then rejects the candidate and the integrator returns null. Refused, all
textbook-elementary: `1/(2x+3)`, `1/(4x²−1)`, `1/(3x²+5x+2)`, `x/(2x+1)`,
`1/(9x²+1)` and more. **Every monic sibling succeeds — which is every existing
test.** `polyPart` on line 272 is not scaled, so improper fractions are scaled
inconsistently as well.
This is degradation, not wrongness: all the victims route into the unverified
`symbolicAntideriv` table, and 21 of them were checked against a 200001-point
Simpson with a maximum relative error of 1.4e-14. No wrong values — just a CAS
refusing work it can do.

### B8. CAS: the canonical correctness net does not apply to any `ln|·|` antiderivative
`src/lib/casint.ts:14-19, 514` with `src/lib/solve.ts:245`.
`simplify(d/dx ln|x|)` produces `x/abs(x)^2`, which never reduces to `1/x` because
`abs(u)` is an opaque atom. So `exprEqual` is false for every partial-fraction and
`g'/g` result, and those are accepted on the strength of `numericallyEqual` at 8
fixed sample points with a `checked >= 3` floor. A guarantee gap, not a wrongness
one: 67 integrands swept on a grid deliberately disjoint from those samples
produced zero wrong antiderivatives.
**Fix direction:** give `abs` enough algebra for `abs(u)^2 → u^2`.

### B9. CAS: 20 seconds of synchronous work from rational root finding
`src/lib/cas.ts:1023-1037`. `ratPolyRoots` builds `divisors(a0) × divisors(an) × 2`
as its candidate set. The `i <= 10000n` bound limits the divisor **search**, not
the **cross product**. With a highly composite constant term the candidate set
reaches 1.6 million BigInt-rational Horner evaluations *per degree*:

| input | measured |
|---|---|
| `ratPolyRoots([H, H+1, H])` | 1710 ms |
| `integrate("1/(H*x^2+(H+1)*x+H)", 0, 1)` | 2408 ms |
| `integrate("1/(H*x^6+(H+1)*x+H)", 0, 1)` | 10881 ms |
| `integrate("1/(H*x^8+(H+1)*x+H)", 0, 1)` | **20639 ms** |

where H = 963761198400 (6720 divisors). Linear in degree with no cap. The comment
on line 1027 — "a user-typed polynomial has small coefficients" — is the failing
assumption. This is the catalogued lesson again: **a clamp that bounds the search
does not bound the time.**
**Fix direction:** cap the candidate set itself, and when the cap is hit say the
rational-root search was incomplete rather than reporting "no rational roots".

### B11. Two parsers read the same text differently
`src/lib/solve.ts:170` versus `src/lib/mathParse.ts:231-249`:

| typed | solve.ts | mathParse.ts |
|---|---|---|
| `1/2x` | `1/(2*x)` | `(1/2)*x` |
| `2/2x` | `1/x` | `x` |
| `2^2x` | `2^(2*x)` | `(2^2)*x` |

Both are defensible readings; having both in one product is not.
`mathParse.ts:12` also documents `ab` as implicit multiplication, and it
tokenizes as a single identifier.

### B12. Error messages name internal token types
`src/lib/mathParse.ts`. `abs x` produces *"Expected lparen in math expression."*;
`|x` produces *"Expected bar…"*; `{x` produces *"Expected rbrace…"*. The user did
not write an lparen and does not know what one is.

### B13. `parseReaction` glues a stray delimiter onto a component
`src/lib/reactions.ts`. `A ->> B` yields stages `[["A"], ["> B"]]`, and `"> B"` is
then handed to OpenChemLib as SMILES.

---

## C — cosmetic, or unreachable today

### B15. An identity hidden by catastrophic cancellation is still reported as roots
`src/lib/solve.ts`. `solveEquation("cosh(x)^2 - sinh(x)^2 = 1")` is an identity and
returns **33 numeric "roots"** at irregular positions between −18 and 18.

The identity check compares the two sides relative to their own magnitudes, which
catches every ordinary case — `sin(x)^2 + cos(x)^2 = 1`, `exp(ln(x)) = x`,
`sin(2*x) = 2*sin(x)*cos(x)` and the rest. It cannot catch this one, because the
cancellation happens *inside* the expression: at x = 18 both squares are about
1.1e15, so the computed difference carries roughly 0.25 of rounding dust while the
true answer is 1. Zero sits inside that dust, and no tolerance derived from the
final magnitudes can tell the two apart. The irregular spacing of the results also
defeats the grid-signature test that catches the underflow case.

**Attempted and abandoned, deliberately.** Measuring the dust by perturbing x and
watching how far the computed difference moves does work in principle, but the
estimate is itself a random quantity: the version that finally passed the cosh case
also reported `tan(x) = 2` and `exp(x) = 2` as identities — turning every equation
in the product into a vacuous one. That was caught by the behavioural baseline
within a minute, and reverted. **A predicate that cannot be validated is worse than
a limit that can be stated**, which is why this is written down rather than shipped.

**Fix direction:** the magnitudes of the cancelling intermediates are invisible from
outside `evalAst`. Have `evalAst` optionally report the largest absolute value it
passed through, and scale the tolerance by that instead of by the result. That is a
real answer rather than a tuned threshold, and it would also improve the
singularity and root-residual tests, which have the same blind spot.

### C0. A removable singularity strictly inside the interval still refuses on the numeric path
`src/lib/solve.ts`. `integrate("sin(x)/x", -1, 1)` should be ≈ **1.8921**. The
singularity at x = 0 is removable — sinc is bounded, with limit 1 — and the
structural detector correctly does *not* flag it. But sinc has no antiderivative
rule, so it falls through to adaptive Simpson, whose very first midpoint is exactly
0, where `sin(0)/0` is NaN. The quadrature aborts and the integral is refused.

**Not a regression** — verified against v2.39.0 as shipped and against the version
before the pole detector was rebuilt; both refuse it. It is an honest refusal (the
integrand genuinely is undefined at that point) rather than a wrong number, which
is why it is filed here rather than in section A.
**Fix direction:** when `isGenuinePole` has already established that a point inside
the interval is *removable*, the quadrature can evaluate a few doubles to one side
of it instead of at it. The information needed is already computed; it just is not
passed to the numeric path.

### C1. `massspec.parseFormula` mis-parses hydrates
`src/lib/massspec.ts:68` strips the `·` without splitting, so `CuSO4·5H2O` parses
as `{Cu:1, S:1, O:46, H:2}` — "SO4" and "5" merge into "O45". **Unreachable
today**: the only caller is `computeMassSpec`, which feeds it OpenChemLib's
already-clean `mf.formula`. It becomes a live bug the moment anything else calls
it.

### C2. `parseRatLiteral("1e400")` returns an exact 401-digit rational whose `ratToNumber()` is Infinity
`src/lib/cas.ts`. Correct as far as it goes, but the conversion boundary is where
the honesty is lost.

### C3. `isSymmetric` is scale-dependent
`src/lib/linalg.ts:235`. A genuine absolute-tolerance issue, recorded as
**qualified**: the reviewer could not construct an input where it produces a wrong
answer, and it is listed here rather than in section A for that reason.

---

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
