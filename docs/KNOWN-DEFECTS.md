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

---

## A — wrong numbers

### A1. Control: settling time uses the underdamped envelope for ζ ≥ 1, and calls it exact
`src/lib/control.ts`. For an overdamped or critically damped system the 2%
settling time is computed from the `exp(-ζωt)` envelope formula, which is only
valid for ζ < 1. Measured: **0.4 s reported against a true 78 s** — nearly 200×
low — and flagged `exact`. Anyone sizing a controller from that number is being
told the loop settles almost instantly when it crawls.
**Fix direction:** for ζ ≥ 1 the response is a sum of two real exponentials;
solve for the 2% crossing on the slower one, or fall back to simulating and
reporting the measured crossing with the method named honestly.

### A2. Control: `margins` reports the FIRST gain crossover, not the worst
`src/lib/control.ts`. A loop with several crossings of |L| = 1 has a phase margin
at each; the stability margin is the **minimum**. Reporting the first gives
**179° of phase margin for a loop with 94% overshoot** — a number that says
"extremely stable" about a system that rings badly.
**Fix direction:** find every crossover, report the minimum, and say how many
were found.

### A3. Control: the margin sweep ignores loop gain
`src/lib/control.ts`. The frequency range is derived from pole and zero
magnitudes, which do not move when the gain changes. A high-gain loop whose real
crossover lies outside that window is reported as having **no phase margin at
all**, and a grid artefact at the window edge has also produced a **fabricated
gain margin**.
**Fix direction:** extend the sweep until |L| brackets 1, rather than assuming
pole/zero magnitudes bound it.

### A4. Control: a triple imaginary pole is reported UNSTABLE
`src/lib/control.ts`. `(s²+1)³` has three double poles at ±i and is marginally
stable; it comes back **UNSTABLE, 2 poles in the right half plane**. The cause is
not the tolerance — that was fixed, and each pole is now measured against its own
magnitude — it is that Durand–Kerner cannot resolve a repeated root to better
than about the cube root of machine epsilon, so the computed real parts are
genuinely ~1e-5 rather than 0. Routh cannot arbitrate because a zero row makes
its result unusable, so the disagreement check stays silent.
**Fix direction:** detect repeated roots via `gcd(p, p')` and, when the
denominator has them, say that the imaginary-axis verdict cannot be resolved
numerically rather than asserting one.

### A5. Pharmacokinetics: NCA area starts at the first sample, not at t = 0
`src/lib/pk.ts`. The trapezoidal AUC begins at the earliest supplied time. If
dosing is at t = 0 and the first sample is at 0.5 h, the interval from 0 to 0.5 h
is simply missing — measured **+19% error in clearance**, unflagged.
**Fix direction:** for an IV bolus, back-extrapolate to C0 using the terminal
slope or the first two points; for oral, the concentration at t = 0 is 0. Either
way, state which convention was used.

### A6. Pharmacokinetics: `nca` never runs the flip-flop check on an oral dose
`src/lib/pk.ts`. The function knows the route is oral and still fits the terminal
slope as elimination. When absorption is slower than elimination the terminal
slope IS the absorption rate, and the reported half-life came out **10× wrong**.
**Fix direction:** the classic check — compare the terminal slope against an IV
reference or flag when ka and ke are within an order of magnitude — and refuse to
label the result "elimination half-life" when it cannot be distinguished.

### A7. Pharmacokinetics: `steadyState` is IV-bolus-only but the pane offers bioavailability
`src/lib/pk.ts`. The accumulation formula assumes instantaneous input. Entering
an F less than 1, which the pane invites, gives **+41% on Cmax**.
**Fix direction:** either apply F and a first-order absorption term, or refuse
the F field for this calculator and say why.

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

### A10. Solve: a pole is reported as a root
`src/lib/solve.ts:644-675`. `numericRealRoots` treats a sign change as a root and
its bisection exits on interval width **or** on `|f| < 1e-13`, never requiring the
residual to be small. `solveEquation("1/(x-2.25) = 0")` returns the root
`["2.25"]`, where the left-hand side evaluates to **-1.1e12**.
`solveEquation("tan(x) = 2")` returns roughly 1270 "roots" that alternate genuine
solutions and asymptotes. `1/(x-2) = 0` correctly returns none only because the
scan grid lands exactly on 2 — move the pole off the 0.5 grid and it appears.
**Fix direction:** require a verified residual before accepting any bracketed
root. The pole detector added for divergent integrals (`symbolicSingularityIn`)
is directly reusable to exclude known poles from the bracket set.

### A11. Solve: absolute tolerances create a band where quadratics silently lose roots
`src/lib/solve.ts:515, 542`. Two separate absolute thresholds:
- Discriminant: `0.0000000001*x^2 - 0.0001 = 0` returns **`["1000"]`**, one root
  where there are two (±1000), labelled `exact (quadratic)`. disc = 4e-14 < 1e-12.
- Leading coefficient: `0.0000000000001*x^2 - 1 = 0` returns **no-solution**, with
  the caveat "No value of the variable satisfies this equation." True roots
  ±3162277.66.

Both are **bands**: a 1e-12 coefficient works and so does a 1e-14 one, so a test
sampling either side of the band certifies the bug.
**Fix direction:** scale the discriminant test by the coefficient magnitudes, and
decide "is this coefficient zero" relative to the others rather than absolutely.
Related cosmetic defect: the working shown reads `Polynomial form: 0·x^2 + 0·x^1 +
0·x^0 = 0.` beside a claimed exact root, because `fmtNum` (line 416) rounds the
displayed coefficients to 6 dp.

### A12. Solve: an identity is reported as 4000 numeric roots
`src/lib/solve.ts:648, 847`. `(x-1)/(x-1) = 1` returns method
`numeric (transcendental)` with **4000 roots** `["1000","999.5","999",…]`, and
takes about 2.9 seconds doing it. `polyCoeffs` returns null for a non-constant
denominator, the rational solver bails because the numerator normalises to zero,
so `f ≡ 0` reaches the scanner and every grid point passes `|f| < 1e-10`. Same for
`x/x = 1` and `sin(x)/sin(x) = 1`.
**Fix direction:** test for `f ≡ 0` before scanning and report an identity, which
is what the exact path already does for polynomial identities.

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

### B10. The "exact (symbolic)" antiderivative STRING is rounded to 6 dp
`src/lib/solve.ts:416`. `integrate("1/(x^2+x+1)", 0, 1).antiderivative` prints
`1.154701*atan(1.154701*x + 0.57735)` where the true coefficient is
2/√3 = 1.1547005383792515. The `value` is exact; the printed closed form is not,
and does not re-parse. Anyone copying that expression out of the document gets a
different function from the one that was integrated.

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

### B14. The beam-height oracle is the implementation's own output
`src/lib/__tests__/beamChartGeometry.test.ts:136-139` and
`beamRound3.test.ts:181-185` both parse the height out of the SVG they just
generated, so the assertion cannot fail. **Proved** by rewriting the declared
height by +10, +50, +200 and +1000 — the exact class of change that caused the
336→346 bug — and watching the assertion pass all four times. Separately,
`BEAM_CHART_SIZE` is referenced by **zero** test files, so the pane/library
agreement that fix established has nothing holding it in place.
**Fix direction:** assert against `BEAM_CHART_SIZE` directly.

---

## C — cosmetic, or unreachable today

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
