# Scope — Solve symbolic batch: exact cubics/quartics, multivariate GCD, radius of convergence, v2.130/v2.131 leftovers

_Written 2026-10-14 against the v2.134.0 working tree, with v2.135.0 (abstract algebra) still in flight. Planned as v2.136.0. Sources: a read-only audit of `solve.ts`, `cas.ts`, `casint.ts`, `exact.ts`, `analysis.ts`, `multivar.ts`, `lp.ts`, `markov.ts`, `probability.ts`, `solveTypeset.ts` and `mathParse.ts`. Also a probe of 129 calls through the equation-kind chain, plus 30 checks of the primitives underneath it._

_The chain is mirrored from taskpane `updateSolve`: foldPastedMath → `transformVerb` → ctSwitch → derivative/integral/limit switches → tryStatsIntent → trySum → verb chain (`tryLp … tryAlgebraVerb`) → word switch → solveInequality → units/system → solveEquation/extractEquation. The Derivative and Integral kinds were called directly._

_**Method note:** instead of the requested throwaway jest file, I used a scratchpad Node script through `scripts/ts-require.js`. Nothing was created in the tree, and the parallel builders' jest runs were left alone._

_**Oracle:**_
- _SymPy 1.14.0, installed into the scratchpad venv this session, with mpmath._
- _For the intervals: statsmodels 0.15.0 and SciPy 1.18.1 on Python 3.14.6 (`python -I`), plus a hand-coded second route: Wilson in closed form, Clopper–Pearson from `scipy.stats.beta`._
- _Markov: exact `Matrix.inv()` over ℚ._

_Wrong answers come first. §D is the exit test._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each read):**
- `cas.ts`: `Rat` and `ratPoly*`. · `ratPolyRoots` (1077): the rational-root theorem with multiplicities, `rest`, and an `incomplete` flag (20 000-candidate cap). · `polyInVar` (1016) and `ratFunctionInVar` (998). · Private `uniGcd/uniRem/uniDivExact` (376–431). · `rfNorm` (433) cancels monomial content, and runs a full GCD ONLY when both sides are univariate in ONE atom (446). That is the multivariate gap. · `exprEqual` (755) is subtraction-to-zero; `canonicalKey` (745) is structural.
- `casint.ts`: `quadraticFactorsOverQ` (176), `partialFractionDecompose` (240), and `integrateRational` (348, with its atan branch at 487). There is no rule for c/√(a − b·x²).
- `solve.ts`: `polyCoeffsRat` (1077). · `exactRootsFromRat` (1336): degree ≤ 2, the complex convention `-1/2 + sqrt(3)/2*i`, no `2/3i`. · `EXACT_DISPLAY_MAX = 48` (1327) and `Root {display, re, im, exact}` (1220). · `allPolyRoots` (1506, Durand–Kerner) with `snap` (1495) and its grouping. · The degree ≥ 3 hand-off (2181–2186).
- `exact.ts`: `exactSimplify`, `perfectSqrt` (165), `trigPiExact`/`piMultiple` (`acos(-1/2)` → `2*pi/3`), `constantRat`.
- `analysis.ts`: `taylorSeries` (478). Its coefficients are FLOATS (`at()/k!`); `MAX_ORDER = 12`. The caveat at 523 says "Its radius of convergence is not computed here".
- `markov.ts`: Exact `rref`. · Absorbing N = (I − Q)⁻¹ (357–390). A hitting time is the same system with the target made absorbing. · Return time `1/π_i` (406–413), but only for "return time to <state>". · `MAX_STATES = 12` (27).
- `probability.ts`: the CI verb (1321–1393), proportion by Wald only. `probdist.ts` `betaDist` (729) has a bisection quantile, which is enough for Clopper–Pearson.
- `multivar.ts`: `tryLagrange` (946): `solveSystem`, refusing at 1010. · The Hessian symmetry check (398–411), which trusts `exprEqual === false`. · The midpoint referee for iterated integrals (1300–1334). · `realRootsOne` (624–660): `parseExpr(root.display)` into its `S` wrapper when `root.exact`.
- `mathParse.ts` typesets `root(n, x)`. Neither it nor `solveTypeset.ts` knows `cbrt`.

**Missing (verified by grep and probe):**
- No exact roots above degree 2.
- No square-free step before Durand–Kerner.
- No multivariate GCD and no resultant.
- No radius or interval of convergence.
- No asin antiderivative rule.
- No Wilson or Clopper–Pearson interval.
- No Markov hitting/first-passage time or hitting probability (refused by design, markov.ts:298).

**Probe: 129 chain calls, 92 of them curriculum inputs. Ranked WRONG > refused-for-the-wrong- reason > SILENT > MISSING, with the exact text.**

*WRONG — confident and false, or an answer to another question (10 classes):*

1. **Repeated roots shatter into fake complex roots, under "Complete".** · `(x-1)^4 = 0` and `x^4 - 4x^3 + 6x^2 - 4x + 1 = 0` → "x = 1.000040832 + 0.000007296i ; x = 1.000004587 + 0.000003957i ; x = 1 ; x = 0.999957094 - 0.000070041i · Method: complete (all roots) · Complete: every root is shown, real and complex." · `(x-2)^3*(x+1) = 0` → three complex values near 2. · `x^6 - 3x^4 + 3x^2 - 1 = 0` → "1 (×3) ; -0.99999952 - 0.000003928i ; -1 + 0.000002247i ; -1.000000529 + 5.94e-7i". · Truth (SymPy `sqf_list`): 1 (×4); 2 (×3) and −1; ±1 (×3). Multiplicity 2 survives only by luck of `snap`. · mpmath's `polyroots` ALSO fails to converge on all three. The cure is gcd(p, p′), not more iterations.
2. **`simplify` prints float residue for an exact 0.** · `simplify cbrt(2)^3 - 2` → "1.67785700837e-16". · `simplify (sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1` → "-2.60975788663e-15". · Cause: cas.ts:629–637 folds every function of a constant into a float-derived rational, so `exprEqual(cbrt(2)^3, 2)` is **false**. `exactSimplify` leaves `cbrt(2)^3` and `sqrt(3)^3` unreduced. · **Neither simplifier can verify a radical root.** §B1 depends on this.
3. **Markov answers another question.** · `markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] probability of reaching 3 before 1 starting from 2` → the stationary block "π = (1/4, 1/2, 1/4)". The answer is 1/2. · `… expected return time` (no state named) → π only; the return times 4, 2, 4 never appear.
4. **Proportion CI.** · `confidence interval 95% proportion p = 0 n = 20` → "[0, 0]", a zero-width 95% interval. Wilson gives [0, 0.161125]. · `p = 0.02 n = 50` → "[0, 0.0588053]". `Math.max(0, lo)` silently clamps −0.018805, while the printed math line `0.02 - 1.95996*sqrt(…)` still evaluates to −0.0188.
5. **LP steals a Lagrange problem** (a v2.132 guard regression). · `maximize x y subject to x^2 + y^2 = pi` → "Linear program … “pi” (the constant π) cannot appear in an exact linear program". · lp.ts:559–562 refuses on `pi` before the linearity test (563–567) can return null. With `= 2` the problem reaches Lagrange correctly.
6. **Hessian withheld as asymmetric.** · `hessian x^y at (1, 1)` → "f_xy and f_yx did not agree — withheld". · `exprEqual(x^y/x, x^(y-1))` is false because symbolic-exponent powers are opaque atoms (cas.ts:619–622). · Truth: H(1,1) = [[0, 1], [1, 0]].
7. **Task words become unknowns.** · `solve x^2 - 5x + 6 = 0` and `solve x^3 + 3x^2 - 4 = 0` → "This has more than one unknown (solve, x)". · `find the roots of x^3 - 7x + 6` → "(find, the, roots, of, x)". `normalizeTaskProse` leaves "roots of …". · Likewise `exact roots of …` and `x^3 - 2 = 0 exactly`. · solveEquation returns a non-null "unsolved", so the pane never extracts (taskpane ~28210). Without a fix, the new engine is unreachable by its most natural phrasing.
8. **Taylor/radius in the default kind.** · `taylor 1/(1-x)`, `series 1/(1-x)`, `taylor series of 1/(1+x^2)`, `radius of convergence of 1/(1-x)` and `interval of convergence of sum x^n/n^2` → "more than one unknown (taylor, x)", and similar. · Limits are switched to the Derivative kind (~28000); series are not.
9. **Small roots lose their digits.** · `x^3 - 1234567x + 1 = 0` → "x = 8.1e-7". The true root is 8.10000591300e-7. · `snap` rounds to 1e-9 ABSOLUTE (solve.ts:1495–1499), and grouping merges roots closer than 1e-6 absolute.
10. **Unreduced 0/0 shapes.** · Derivative kind `(x^2 - y^2)/(x - y)` → "f'=(2*x*y - x^2 - y^2)/(2*x*y - x^2 - y^2)"; the true derivative is 1. · `simplify (x^2 - y^2)/(x^2 - 2*x*y + y^2)` → "(-x^2 + y^2)/(2*x*y - x^2 - y^2)".

*Refused for the WRONG reason (6):*
- `lagrange x*y subject to x^2 - y^2 = 1` → "The system ∇f = λ∇g, g = c could not be solved here." · SymPy finds only complex solutions. · The tangency condition f_x·g_y − f_y·g_x = −2(x² + y²) = 0 forces (0, 0), which is off the curve. ∇g ≠ 0 on the curve, so no extremum exists (Lagrange's theorem).
- `lagrange x*y subject to x^2 + y^2 = pi` → the same refusal. True answer: max π/2, min −π/2, λ = ±1/2.
- `double integral 1/((x-0.3)^2 + 1e-8) over x from 0 to 1, y from 0 to 1` → "The exact value 31411.1646313 did not agree with numerical quadrature (3922.43) — withheld". · The exact value is right: 10000·atan(3000) + 10000·atan(7000), and the 1-D Integral kind already returns it. · The midpoint referee misses a peak 1e-4 wide.
- `markov … expected steps from state 1 to state 3` → "No absorbing state …". The answer is 8; the `wantsAbsorb` regex (358) grabs "expected steps".
- `95% confidence interval for a proportion with 12 successes out of 40` and `… x = 12 n = 40` → "Give the sample proportion and n".
- `expected hitting time from 1 to 3` and `mean first passage time` → the by-design refusal at 298.

*SILENT (right value, wrong form or understated; about 40 inputs):*
- **Every cubic and quartic prints a decimal.** · `x^3 = 2` → "1.25992105". `x^3 - 15x - 4` → "-0.267949192" (that is −2 + √3). `x^4 - 10x^2 + 1` → "3.14626437" (√3 + √2). · `x^3 - 3x + 1` never shows 2·cos(2π/9). · Rational roots 3, 2, 1 print under "Values are numerical (refined to ~1e-10); an exact closed form is not attempted above the quadratic". · Show-your-work factors `x^3 - 6x^2 + 11x - 6` but gives NO work for `x^3 + 3x^2 - 4` (a double root).
- **11 of 13 multivariate fractions stay unreduced.** · `(x^2 - y^2)/(x - y)`, `(a^3 - b^3)/(a - b)`, `(x^4 - y^4)/(x^2 + y^2)`, `(x*y + x)/(y + 1)`, `(x^2 - 4*y^2)/(x + 2*y)`, `(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))`, … · Each carries "Cancelling a factor can remove points…" though nothing was cancelled. · Only `(x^2*y - y)/(x*y + y)` → `x - 1` works: monomial content first, then univariate.
- **Cosmetic multivariable forms.** · `jacobian (r*cos(t), r*sin(t))` → "det J = r*cos(t)^2 + r*sin(t)^2". · `gradient x^y at (1, 1)` → "(1^(1 - 1), 0) | |∇f| = sqrt((1^(1 - 1))^2)". · `critical points x^y` → "D = -1^(0 - 1) < 0". · `exactSimplify` does not fold 1^0; `casSimplify` does.
- **asin-type integrals stay numeric.** `∫₀^½ 1/sqrt(1-x^2)` (Integral kind) → "0.5235987755987446 … adaptive Simpson — an approximation", where the answer is π/6. The double-integral twin → "≈ 0.5235988 (numeric)".
- All 13 Taylor requests carry "Its radius of convergence is not computed here".
- Wald is the only interval: "(a Wilson interval would be better; not provided)".
- `factor x^3 - 2` → "Irrational or complex factorisations are not attempted". This is honest; keep it.

*MISSING:* exact roots (38 inputs) · radius (13) · asin antiderivatives (3) · Wilson/CP (4) · hitting times and probabilities (5).

*RIGHT (pin as twins):* `x^2 - 2` → `sqrt(2)` exact · `x^2 + x + 1` → `-1/2 + sqrt(3)/2*i` · `cbrt(x) = 2` → 8 · 1-D `∫₀¹ 1/((x-0.3)^2+1e-8)` → 31411.1646312692 exact · `maximize x y subject to x^2 + y^2 = 2` → max 1, min −1 · `simplify (x^2 - 1)/(x - 1)` → `x + 1` · Wald `p = 0.4 n = 100` → [0.303982, 0.496018] (= statsmodels) · `x^5 - x - 1` numeric and complete · `x^100 = 2` real-only, said.

## B. Syntax, output, figures

B1 and B2 add no new verb: `x^3 = 2` and `simplify …` simply get better answers. B3–B5 extend existing grammars. Every printed root or expression is Solve grammar and re-parses through `parseExpr`.

### B1. Exact roots in `solveEquation` (degree 3–4, and any degree that factors)

The pipeline runs on Rat coefficients from `polyCoeffsRat`. Anything else stays on today's float path.

1. **Square-free (Yun) over ℚ.** Repeated gcd(p, p′) gives exact multiplicities, so Durand–Kerner only ever sees square-free factors. This alone fixes WRONG #1 at every degree.
2. **Rational roots** of each factor via `ratPolyRoots`. When `incomplete` is set, NO irreducibility claim is made downstream.
3. **Shortcuts before any formula:**
   - quadratic factors (`exactRootsFromRat`);
   - biquadratics, with Borodin denesting: √(a ± √b) = √((a+d)/2) ± √((a−d)/2) when d = √(a² − b) ∈ ℚ, so `x^4 - 10x^2 + 1` → `sqrt(3) + sqrt(2)`;
   - binomials `x^n = c` (n = 3, 4);
   - `quadraticFactorsOverQ` for quartics that split over ℚ.
   - A biquadratic with a negative discriminant and c a rational square splits over ℚ(√(2√c − b)):
     `x^4 + 1 = (x^2 + sqrt(2)*x + 1)(x^2 - sqrt(2)*x + 1)`. Never take the square root of `±i`.
4. **Irreducible cubic.** Depress with x = t − b/(3a) to t³ + pt + q, and let Δ = −4p³ − 27q².
   - **Δ < 0 → Cardano with REAL radicals.** u = cbrt(−q/2 + sqrt(−Δ/108)) and v = cbrt(−q/2 − sqrt(−Δ/108)). The real root is u + v; the complex pair is −(u+v)/2 ± (√3/2)(u−v)·i.
   - **Δ > 0 (three real roots, the casus irreducibilis) → the trigonometric form ONLY:** t_k = 2·sqrt(−p/3)·cos((θ + 2πk)/3), θ = acos((3q/(2p))·sqrt(−3/p)) ∈ [0, π].
     - Fold θ to a rational multiple of π when its cosine is 0, ±1/2, ±√2/2 or ±√3/2.
     - Normalise each angle into [0, π] with cos(2π − a) = cos a.
     - **Never print a complex-radical expression for a real root.**
   - Δ = 0 is impossible for an irreducible cubic; a repeated root was already rational at step 1.
5. **Irreducible quartic.** Use Ferrari via the resolvent cubic, but show an exact form ONLY when the resolvent has a RATIONAL root, so every radical is a nested square root in ℚ(√m).
   - Example: `x^4 + 4x - 1 = (x^2 - sqrt(2)*x + 1 + sqrt(2))(x^2 + sqrt(2)*x + 1 - sqrt(2))`.
   - Otherwise print the roots numerically, with this reason by name: "a closed form exists (Ferrari) but needs the cube root of a complex number from its resolvent cubic and runs to hundreds of characters". SymPy's form for `x^4 + x + 1` is 600+ characters of nested complex radicals.
6. **Degree ≥ 5 after factoring.** Run Durand–Kerner on the square-free factor, with the caveat: "Degree 5: no general formula in radicals exists (Abel–Ruffini); this quintic was not tested for solvability by radicals, so its roots are numerical." Never claim that the particular quintic is unsolvable. Roots found by steps 2–3 stay exact, so `exact` is set per root.

**Display:**
- Examples: `x = cbrt(2)` · `x = -1/2*cbrt(2) + sqrt(3)/2*cbrt(2)*i` · `x = 2*cos(2*pi/9)` · `x = cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)` · `x = -sqrt(2)/2 + sqrt(sqrt(2) - 1/2)` · `x = 2^(1/4)` (positive base only) · `x = 1 (×4)`.
- `cbrt` of a negative is the REAL cube root (`Math.cbrt`). Never print `(neg)^(1/3)`, which is NaN. Rationalise `cbrt(1/2)` → `cbrt(4)/2`.
- `∛`, `∜` and `arccos` do NOT parse (verified). Print `cbrt`/`acos`; add the glyphs to `normalizeUnicodeMath` as INPUT aliases only.
- **Method strings (decided).** Pick the method of the HARDEST irreducible piece:
  - every factor after Yun has degree ≤ 2 over ℚ (rational roots, quadratics, or both) →
    `exact (factored over ℚ)`;
  - otherwise `exact (binomial x^n = c)`, `exact (cubic — Cardano, one real root)`,
    `exact (cubic — trigonometric form, three real roots)`, `exact (quartic — biquadratic)` or
    `exact (quartic — Ferrari)`;
  - `complete (all roots)` stays for numeric results, including mixed results where any root is
    numeric.
- Cap `POLY_EXACT_DISPLAY_MAX = 120`. Beyond it, show the decimal with `exact: false` and a line naming the method and the length.
- Every exact root also gets `≈` to 12 s.f.

**Work lines:**
- "Rational-root test: ±1, ±2, ±4 → 1 is a root; divide out (x − 1)".
- "Depressed (x = t + 1): t³ − 3t + 1 = 0, p = −3, q = 1; Δ = 81 > 0: three real roots".
- "Cardano would take cube roots of complex numbers here (casus irreducibilis); the trigonometric form gives the same roots as real numbers: cos θ = −1/2, θ = 2π/3".
- The double-root factorisation `(x - 1)*(x + 2)^2 = 0`.

**Verification: an exact certificate first, then a numeric cross-check.**
- **(a) Exact:**
  - rational roots by `ratPolyEval = 0`, and every factor by exact `ratPolyDivMod`;
  - **Cardano:** u³ + v³ = −q and u³v³ = −p³/27, exactly in ℚ(√(−Δ/108)) (elements are pairs of Rat). The sign of uv = −p/3 is checked numerically;
  - **trig:** cos θ exactly in ℚ(√·), then the identity 4cos³φ − 3cos φ = cos 3φ (the caveat says so);
  - **Ferrari:** the two quadratic factors multiplied out in ℚ(√m) must equal p;
  - **binomials:** (c^(1/n))ⁿ = c.
- **(b) Numeric:**
  - re-parse the DISPLAY string and evaluate it (using the `i` convention of `solveDisplayContract.test.ts`);
  - compare with the Durand–Kerner root of the square-free factor after 3 Newton steps: |Δ| ≤ 1e-9·max(1, |r|), and |p(r)| ≤ 1e-12·Σ|aₖ||r|ᵏ;
  - any disagreement drops `exact` and falls back to the decimal.
- **Caveat text:** "Exact: certified by <certificate>; the displayed form re-parses and agrees with the numerical root to 1e-9." The double-precision check is never called exact.
- **Never pass a displayed root through `simplify()`/`casSimplify`** (WRONG #2).
- **Figure:** unchanged ("Where the function crosses zero"). It needs `re` at full double precision on every exact root, not the `snap`ped value.

### B2. Multivariate GCD (the `simplify` verb, the Derivative kind, every casSimplify output)

**Algorithm.** Recursive primitive Euclid over ℤ[x₂…xₖ][x₁], built on the existing sparse `Poly`/`Mono`:
1. Choose as main atom the one with the lowest max degree.
2. Take contents recursively, one atom down, and the primitive parts.
3. Pseudo-divide.
4. The result is gcd(contents) × the primitive gcd.

**Caps BEFORE work.** ≤ 4 atoms, degree ≤ 12 per atom, ≤ 200 terms per side, and a pseudo-remainder bit-length ≤ 4096. Past a cap, the result stays unreduced and the verb says so by name.

**Placement.** Run it ONCE at the output boundary: `cancelCommon(n, d)` before `rfToExpr` in `casSimplify`. **Not** inside `rfNorm` (§E.6).

**Cross-check.**
- g must divide both n and d EXACTLY.
- The cofactors must be coprime at a fixed rational specialisation of all non-main atoms (univariate gcd = 1).
- Otherwise refuse; never print an unchecked result.

**Atoms are independent indeterminates.** This is sound: a common factor there is a true factor.
- `(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))` → `sin(x) + cos(x)`.
- sin² + cos² = 1 is NOT used.

**Verb text.** "Cancelled the common factor x - y; equal to the original except where x - y = 0 (there the original is 0/0)." When nothing was cancelled, the cancellation caveat is dropped.

**Also exported:**
- **`polyResultant(a, b, x)`.** A Sylvester determinant by fraction-free Bareiss over Rat, size ≤ 12. Used only by Lagrange (§B4).
- **`exprEqual` false negatives.** In the `normalize` pow case (cas.ts:619–622), split an exponent with an integer constant part: `x^(y-1)` → atom(`x^y`)·x⁻¹. This fixes WRONG #6.
- **The float residue (WRONG #2).** Add an opt-in `exactRadicals` context flag. Under it, `sqrt(q)`/`cbrt(q)` of a non-perfect rational become algebraic atoms with atom² = q / atom³ = q, following the existing sqrt/abs power-rule pattern (585–606).
  - Only the simplify verb and the new verifiers set the flag. Flipping it globally would reprint every `sqrt(2)` in the product ("a fix can be worse than the defect").
  - Result: `simplify cbrt(2)^3 - 2` → `0`.

### B3. Radius (and interval) of convergence

**Grammar.**
- `taylor f [about c] [order n]` now also prints R.
- New phrasings:
  - `radius of convergence of f [about c]`
  - `radius of convergence sum a_n` (or `Σ a_n`)
  - `interval of convergence of sum (x - 3)^n/(n*2^n)`
  - `taylor series of f`
- In the default kind, all of these switch to the Derivative kind, the way limits do.

**Method — a theorem, never a reading of coefficients:**
1. **Rational f.** Cancel with the univariate GCD, then find the exact denominator roots in ℂ with the §B1 engine. That is exact up to degree 8; above it, numeric with the tolerance stated.
   - R = min |z₀ − c|. `1/(x^2+4)` about 1 → `sqrt(5)`; `(x^2-1)/(x-1)` → ∞ (removable).
2. **Known functions** (composition table):
   - entire: exp, sin, cos, sinh, cosh, polynomials;
   - ln(u), sqrt(u), non-integer u^(p/q): branch points at the zeros of u;
   - tan(u), sec(u): zeros of cos u;
   - atan(u): u = ±i;
   - asin(u), acos(u): u = ±1;
   - `x/(exp(x)-1)`: zeros of eˣ − 1 except the removable 0, so R = 2π.
   - For sums and products, the minimum is a LOWER bound unless the nearest singularity is shown to survive cancellation. Otherwise print "R ≥ …".
3. **Explicit general term** (`sum x^n/n`). Exact ratio test, lim |aₙ/aₙ₊₁|, for aₙ rational in n times a geometric or factorial factor.
   - Endpoints are decided only by a named test: p-series, alternating series, or divergence (terms not → 0).
   - Otherwise print "endpoints not decided".

**Output.**
- Example: "R = 1 — the nearest singularity of 1/(1 + x^2) to x = 0 is the pole at x = ±i (distance 1); the series converges for |x| < 1 and diverges for |x| > 1."
- The theorem is named once.
- `1/(1+x^2)` gets the teaching line: "smooth on the whole real line; the radius is set by complex poles".

**Refuse by name** abs, floor, piecewise, gamma and anything outside the table, with "R not determined — reading it from the computed coefficients would be sampling". Even with 40 EXACT coefficients, the root test reads 1.097 for ln(1+x) and 0.911 for 1/(1−x)².

**Figure.** `radiusSvg`: the complex plane with the centre, the disc of radius R, every singularity within 2R labelled (pole / branch point), and the real interval with open or closed ends.

### B4. Multivariable and integration leftovers

**∫ c/√(a − b·x²)** (casint; a, b > 0 rational) → `c/sqrt(b)*asin(sqrt(b/a)*x)`.
- Verified by the existing differentiate-back net, with the caveat "valid for |x| < sqrt(a/b)".
- `-1/sqrt(1-x^2)` → `-asin(x)`, noting that acos(x) differs from it by a constant.
- The definite integrals become exact: π/6, and π/2 on [0, 1] (an integrable endpoint singularity). So does the double-integral twin.

**Near-pole referee.** When every denominator factor is CERTIFIED positive on the region, the midpoint rule no longer vetoes a verified antiderivative.
- Certified positive means: a square plus a positive constant, or an irreducible quadratic with a positive lead (`quadraticFactorsOverQ`, disc < 0).
- Replace the referee with adaptive Simpson split at each quadratic's vertex, agreeing to 1e-6 relative.
- No tolerance is loosened anywhere else. `1/x over (−1, 1)` must still refuse.

**Lagrange in 2 variables.**
- Before `solveSystem`, solve {T = 0, g = c}, where T = f_x·g_y − f_y·g_x, by `polyResultant`. Then find exact roots with §B1.
- No real candidate, and ∇g ≠ 0 on the curve → "No constrained critical point: T = −2(x^2 + y^2) vanishes only at (0, 0), which is not on x^2 − y^2 = 1, and ∇g ≠ 0 there, so f has no extremum on the curve."
- A `pi` right-hand side is carried as a parameter and substituted last: max `pi/2`.

**Cosmetics, in multivar's own `S` wrapper (not shared `exact.ts`).**
- Fold `1^k` and `k^0` → 1.
- Rewrite `a*cos(u)^2 + a*sin(u)^2` → `a`, but only when `exprEqual` confirms it and the result is shorter.
- Results: `det J = r`; `∇f(1, 1) = (1, 0)`; `|∇f| = 1`; `D = -1`.

### B5. Probability leftovers

**Proportion interval.**
- **Grammar:**
  - today's `p = 0.4 n = 100`;
  - counts: `12 successes out of 40`, `12 of 40`, `x = 12 n = 40`, `k = 12, n = 40`, `12/40`;
  - named methods: `wilson interval …`, `clopper pearson …`, `exact binomial confidence interval …`;
  - `p̂ = …`.
  - A count and a proportion that disagree are refused, with both values named.
- **Order of results:**
  1. **Wilson leads** (Brown, Cai & DasGupta 2001, *Statist. Sci.* 16:101).
  2. **Clopper–Pearson** next: "exact (conservative: coverage ≥ 95% guaranteed)".
  3. **Wald** last, labelled "textbook (Wald)", with its failure stated when np̂ < 10 or n(1 − p̂) < 10.
- **Truncation is said, never silent.** "[−0.0188, 0.0588] — runs below 0; reported as [0, 0.0588]". At p̂ = 0 or 1: "zero width — the Wald interval fails here".
- **Two routes each, agreeing to 1e-9 or nothing is shown.**
  - Wilson: the closed form, and also the score equation |p̂ − p| = z√(p(1−p)/n) solved as a quadratic.
  - Clopper–Pearson: the beta quantile, and also bisection on the exact binomial tail P(X ≥ k | p_L) = α/2.
- **Figure:** three interval bars on [0, 1] with p̂ marked (`hBarSvg` pattern).

**Markov hitting.**
- **Grammar** (states by name or 1-based index):
  - `expected hitting time from 1 to 3`
  - `expected steps from state 1 to state 3`
  - `expected time to reach C from A`
  - `mean first passage time [from i to j]` (with no states named, the full matrix M; its diagonal holds the return times)
  - `probability of reaching 3 before 1 starting from 2`
  - `hitting probability of C from A`
  - `expected return time` (all 1/πᵢ)
- **Exact computation:** h = (I − Q)⁻¹·1 by `rref`, with Q restricted to the non-target states. Probabilities solve h = Qh + R·1_A.
- **Unreachable target:** "∞ — S3 cannot be reached from S1 (S1's class {S1, S2} is closed)". Never invert a singular matrix.
- **Cross-checks:**
  - M's diagonal from the first-step equation must equal 1/π_j exactly (Kac).
  - Every hᵢ is re-substituted exactly.
- **Routing:**
  - Remove hitting and first passage from the 298 refusal. Mixing, continuous time and entropy rate stay refused.
  - The hitting branch runs BEFORE `wantsAbsorb` (358), which stops claiming "expected steps from … to …".
  - "probability of reaching … before …" never falls through to the stationary block.
- **Figure:** the existing state diagram, with the target ringed.

**LP guard order.** Move lp.ts's `pi`/`lambda` refusals (559–562) after the `objLin` null-return (563–567). Twin pin: `maximize 3x + 2y subject to x + y <= pi` still refuses by name.

## C. Build order, honest limits, disjoint split

**In flight for v2.135.0, modified or untracked right now:**
- `algebraTools.ts`, `taskpane.ts`, `palettes.ts`, `examples.ts`, `discrete.ts`, the `algebra*.ts` family
- `scripts/check-figures.js` (`CORPUS_FLOOR` 194 in the tree), `scripts/figure-layout-run.ts`
- `FEATURES.md`, `docs/TEST-SCRIPT.md`

Builders A–E touch none of these. F starts only after v2.135.0 is committed, and rebases onto it.

**Cite taskpane by anchor string**, since the line numbers will move:
- `const verb =\n        tryLp(text) ??`
- `const wantsDerivative = !transformVerb`
- `if (/[i×]/.test(root.display)) say(plain)`

`algebraKindFor(solveInput.value)` will run before `transformVerb`. `x^3 = 2`, `factor x^3 - 2` and `simplify (x^2-y^2)/(x-y)` must stay in the equation kind; F adds all three to the stay-put list in `algebraSwitch.test.ts`.

**Order:**
1. **Day 0 — freeze two APIs:**
   - A: `exactPolyRoots(coeffs: Rat[]) → {roots: {display, re, im, exact, mult, certificate}[], method, steps, caveats, incomplete}`.
   - B: `polyResultant(a: Expr, b: Expr, x): Expr | null` and `cancelCommon`.
2. **Build A, B, D and E in parallel.** C starts on rational functions against a stub of A.
3. **F integrates** after v2.135.0 lands.
4. **An INDEPENDENT adversarial pass** (house rule). Aim it at:
   - multiplicities 2–6;
   - roots 1e-9 apart;
   - 30-digit coefficients;
   - casus irreducibilis with a non-special acos argument;
   - each GCD cap edge;
   - a sum whose singularities cancel;
   - an unreachable Markov target;
   - k = 0 and k = n.
5. **§D is the exit test**, then full QC.

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — exact roots** | `src/lib/polyRoots.ts` (new: Yun, rational roots, shortcuts, Cardano/trig/Ferrari, certificates in its own tiny ℚ(√d)/ℚ(∛c) types, its own Rat Euclid over exported `ratPolyDivMod`); `src/lib/solve.ts` (hand-off 2181–2186; `snap`/grouping RELATIVE; full-precision `re`/`im`; `normalizeUnicodeMath` input aliases ∛ ∜ arccos arcsin arctan); `src/lib/showWork.ts` (factorisation line); tests `polyRoots.test.ts`, `polyRoots.adversarial.test.ts`, `solveCallers.test.ts` (new — pins the six internal callers, §E.4), `showWork.test.ts`, and `__snapshots__/solveBaseline.test.ts.snap` (its 7 `complete (all roots)` lines, 163–169, rewritten BY HAND to the §D "Snapshot" block — **never `jest -u`**); `algebraTools.test.ts:190–196` ONLY (the `x^3 = 8` method pin → `exact (factored over ℚ)`, 3 roots; this file is not in v2.135's change set, and F's simplify tests go to a new file so the two never meet) | `cas.ts`, `casint.ts`, `exact.ts` |
| **B — CAS** | `src/lib/cas.ts` (`cancelCommon` at the boundary, multivariate exact division, `polyResultant`, symbolic-exponent split, `exactRadicals`); `cas.test.ts`, `cas.adversarial.test.ts`, `limitsAndCas.test.ts` (each changed pin with a written reason); `casGcd.test.ts` (new). **Gate:** time the full suite before and after; if more than 10% slower, the GCD moves behind the flag as well | — |
| **C — radius** | `src/lib/radius.ts` (new: singularity table, rational path, ratio test, endpoint tests, `radiusSvg`); `src/lib/analysis.ts` (`taylorSeries.radius`; `parseSeriesRequest` reads the new phrasings); `radius.test.ts` (new), `analysis.test.ts` | A and B APIs (frozen) |
| **D — multivariable + integration** | `src/lib/multivar.ts` (Lagrange tangency/resultant, near-pole certificate, `S` cosmetics, `realRootsOne` adapted to exact cubic roots); `src/lib/casint.ts` (asin rule); `multivar.test.ts`, `multivar.adversarial.test.ts`, `casint.test.ts`, `casintGaps.test.ts` | B `polyResultant`, A API |
| **E — probability, Markov, LP order** | `src/lib/probability.ts` (incl. `PROB_VERB_RE` gaining `wilson`, `clopper[-\s]pearson`, `exact binomial confidence`, `\d+ (?:successes )?(?:out )?of \d+` — or `transformVerb` won't stand aside), `src/lib/markov.ts` (`MARKOV_VERB_RE` already claims a leading `markov`), `src/lib/lp.ts` (guard order only); `probabilityRouting.test.ts` (the new openers); `probability.test.ts`, `probability.adversarial.test.ts`, `markovHitting.test.ts` (new), `lp.test.ts`, `lpRouting.test.ts` (Lagrange twin) | `probdist.ts`, `combinatorics.ts`, `systems.ts` |
| **F — integrator (after v2.135.0)** | `src/taskpane/taskpane.ts` (series/radius switch beside the limit switch; root typesetting §E.8; new figures via `verb.svg`; the task-verb RE-SOLVE of §E.13 — the pane calls `solveEquation(text)`, never `taskText`, so a `normalizeTaskProse` change alone does NOT reach the solver); `src/lib/pasteMath.ts` (`normalizeTaskProse` strips `solve`, `find (all) (the) roots/zeros of`, `exact roots of`, a trailing `exactly`) + `pasteMath.test.ts`; `src/lib/solveTypeset.ts` (`cbrt(u)` → `root(3, u)`, `c^(1/4)` → `root(4, c)`; `isProseRequest` learns the radius phrasings); `src/lib/algebraTools.ts` (simplify uses `exactRadicals`, names the cancelled factor, drops the false caveat) + `simplifyVerb.test.ts` (new — NOT `algebraTools.test.ts`, which A owns); `solveDisplayContract.test.ts`; `symbolicRouting.test.ts` (new, asserts on the pane source); `algebraSwitch.test.ts` stay-put entries; `palettes.ts`, `examples.ts`; `figure-layout-run.ts` + `check-figures.js` (+3: radius disc, CI bars, Cardano root plot — raise the floor by 3 from whatever v2.135.0 leaves); `docs/TEST-SCRIPT.md`, `FEATURES.md` | all of the above |

`cas.ts` belongs to B alone; A, C and D ask B for any change there. A deliberately duplicates a
10-line Rat Euclid rather than reaching into B's private `uniGcd`.

**Honest limits (said in the UI):**
- **Roots:**
  - exact only with RATIONAL coefficients, for degree ≤ 4 or anything that factors over ℚ into pieces of degree ≤ 4;
  - Ferrari only when the resolvent has a rational root;
  - symbolic coefficients (`x^3 = a`) keep today's chips and rearrangement;
  - degree ≥ 5 is numeric, with Abel–Ruffini stated generally;
  - coefficients over 64 bits per numerator/denominator → numeric, said.
- **GCD:**
  - ≤ 4 atoms, degree ≤ 12, ≤ 200 terms;
  - no trigonometric identities;
  - the original's 0/0 points are named, not kept.
- **Radius:**
  - only the table, rational functions and explicit terms;
  - endpoints only by a named test;
  - for sums, a lower bound unless the singularity is shown to survive.
- **Lagrange:** the resultant path covers 2 variables, 1 constraint, polynomial f and g. Everything else keeps today's solver.
- **CI:**
  - one proportion only;
  - no difference of proportions;
  - no Jeffreys or Agresti–Coull (refused by name, pointing to Wilson).
- **Markov:**
  - finite, discrete time;
  - `MAX_STATES = 12` (existing);
  - no mixing times, no continuous time.

## D. Acceptance audit (SymPy 1.14.0 / statsmodels 0.15.0 / SciPy 1.18.1 unless stated)

### Roots
Format: exact display, then SymPy's 15-digit value.

**Binomials, rational roots, factoring:**
- `x^3 = 2`, `x³ = 2`, `x^3 - 2 = 0` (and `t^3 - 2 = 0` in t) · `cbrt(2)` ≈ 1.25992104989487 · `-1/2*cbrt(2) ± sqrt(3)/2*cbrt(2)*i` ≈ −0.629960524947437 ± 1.09112363597172i
- `x^3 = 27` → `3`, `-3/2 ± 3*sqrt(3)/2*i`
- `x^3 = 1/2` · `cbrt(4)/2` ≈ 0.793700526 · `-cbrt(4)/4 ± sqrt(3)/4*cbrt(4)*i` ≈ −0.396850263 ± 0.687364818i
- `x^3 - 6x^2 + 11x - 6` → 3, 2, 1
- `2x^3 - 3x^2 - 3x + 2` → 2, 1/2, −1
- `x^3 - x^2 - x + 1` → 1 (×2), −1
- `x^3 + 3x^2 - 4` and `solve x^3 + 3x^2 - 4 = 0` → 1, −2 (×2); work `(x - 1)*(x + 2)^2 = 0`
- `find the roots of x^3 - 7x + 6` → 2, 1, −3
- `x^3 - 3x^2 + 3x - 1` → 1 (×3)
- `x^3 + 1` → −1, `1/2 ± sqrt(3)/2*i`
- `x^3 - 15x - 4` — rational root FIRST; Bombelli's complex radicals never appear · 4 · `-2 + sqrt(3)` ≈ −0.267949192431123 · `-2 - sqrt(3)` ≈ −3.73205080756888
- `x^3 = 2x` → `sqrt(2)`, 0, `-sqrt(2)`
- `(x - 1)^3 = 8` → 3, `±sqrt(3)*i`

**Three real roots (trigonometric form):**
- `x^3 - 3x + 1` and `exact roots of x^3 - 3x + 1` (cos θ = −1/2) · `2*cos(2*pi/9)` ≈ 1.53208888623796 · `2*cos(4*pi/9)` ≈ 0.347296355333861 · `2*cos(8*pi/9)` ≈ −1.87938524157182 (SymPy writes it −2·cos(π/9))
- `x^3 - 3*x - 1` · `2*cos(pi/9)` ≈ 1.87938524157182 · `2*cos(5*pi/9)` ≈ −0.347296355333861 · `2*cos(7*pi/9)` ≈ −1.53208888623796
- `8x^3 - 6x - 1` · `cos(pi/9)` ≈ 0.939692620785908 · `cos(5*pi/9)` ≈ −0.173648177666930 · `cos(7*pi/9)` ≈ −0.766044443118978
- `x^3 - 1234567x + 1` — trig form with a non-special argument, `2*sqrt(1234567/3)*cos(acos(-3/2469134*sqrt(3/1234567))/3)`; values to 1e-9 relative · 1111.11070515 · 8.10000591300e-7 (not "8.1e-7") · −1111.11070596

**One real root (Cardano):**
- `x^3 - 2x - 5` · `cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)` ≈ 2.09455148154233 · pair ≈ −1.04727574077116 ± 1.13593988908893i
- `x^3 + x + 1` · `cbrt(-1/2 + sqrt(93)/18) + cbrt(-1/2 - sqrt(93)/18)` ≈ −0.682327803828019 · pair ≈ 0.34116390191401 ± 1.16154139999725i
- `x^3 + 0.5x - 1` → `cbrt(1/2 + sqrt(330)/36) + cbrt(1/2 - sqrt(330)/36)` ≈ 0.835122348481367

**Quartics:**
- `x^4 - 5x^2 + 4` → ±1, ±2
- `x^4 = 16` → ±2, ±2i
- `x^4 - 2` → `±2^(1/4)` ≈ ±1.18920711500272, and `±2^(1/4)*i`
- `x^4 + 1` → `±sqrt(2)/2 ± sqrt(2)/2*i`
- `x^4 - 10x^2 + 1` → `±(sqrt(3) + sqrt(2))` ≈ ±3.14626436994197, `±(sqrt(3) - sqrt(2))` ≈ ±0.317837245195782 (denested; SymPy writes ±sqrt(5 ± 2*sqrt(6)))
- `x^4 - 3x^2 + 1` → `±(1/2 + sqrt(5)/2)`, `±(-1/2 + sqrt(5)/2)` (= (x² − x − 1)(x² + x − 1))
- `x^4 + 4x - 1` (Ferrari; the certificate is the ℚ(√2) factorisation) · `-sqrt(2)/2 + sqrt(sqrt(2) - 1/2)` ≈ 0.249038376398374 · `-sqrt(2)/2 - sqrt(sqrt(2) - 1/2)` ≈ −1.66325193877147 · `sqrt(2)/2 ± sqrt(sqrt(2) + 1/2)*i` ≈ 0.707106781186548 ± 1.3835510696657i
- `x^4 + x + 1` → numeric, Ferrari refused by name: −0.727136084491197 ± 0.430014288329716i and 0.727136084491197 ± 0.934099289460529i

**Repeated roots:** `(x-1)^4` and its expansion → `1 (×4)`, with NO complex values · `(x-2)^3*(x+1)` → 2 (×3), −1 · `x^6 - 3x^4 + 3x^2 - 1` → ±1 (×3) · `x^4 - 2x^2 + 1` → ±1 (×2) · `(x^2 + 1)^2` → ±i (×2).

**Degree ≥ 5:**
- `x^6 - 9x^3 + 8` → 2, 1, `-1/2 ± sqrt(3)/2*i`, `-1 ± sqrt(3)*i` (exact, factored)
- `x^5 - x - 1` → numeric 1.16730397826, −0.764884433601 ± 0.352471546032i, 0.18123244447 ± 1.08395410132i, with the §B1 Abel–Ruffini caveat
- `x^5 = 32` → `2` exact; the other four numeric

**Unchanged twins:** `x^2 - 2`, `x^2 + x + 1`, `cbrt(x) = 2` → 8, `x^100 = 2`.

**Snapshot.** The 7 lines in `solveBaseline.test.ts.snap` 163–169 are rewritten by hand to these.
Root order follows today's convention: real roots descending, then complex. The caveat count
becomes the certificate caveat.

| Input | Roots | Method |
|---|---|---|
| `x^3 - 1 = 0` | n=3 [1, -1/2 - sqrt(3)/2*i, -1/2 + sqrt(3)/2*i] | `exact (factored over ℚ)` |
| `x^3 - 6*x^2 + 11*x - 6 = 0` | n=3 [3, 2, 1] | `exact (factored over ℚ)` |
| `x^4 - 1 = 0` | n=4 [1, -i, i, -1] | `exact (factored over ℚ)` |
| `x^3 + x = 0` | n=3 [-i, 0, i] | `exact (factored over ℚ)` |
| `x^4 + 1 = 0` | n=4 [sqrt(2)/2 - sqrt(2)/2*i, sqrt(2)/2 + sqrt(2)/2*i, -sqrt(2)/2 - sqrt(2)/2*i, -sqrt(2)/2 + sqrt(2)/2*i] | `exact (quartic — biquadratic)` |
| `x^5 - x = 0` | n=5 [1, -i, 0, i, -1] | `exact (factored over ℚ)` |
| `x^3 - 3*x + 2 = 0` | n=2 [1 (×2), -2] | `exact (factored over ℚ)` |

`algebraTools.test.ts:195`: for `x^3 = 8`, the expectation becomes 3 roots [2, -1 - sqrt(3)*i,
-1 + sqrt(3)*i] via `exact (factored over ℚ)`. The test's intent survives: all 3 roots are kept,
with no downgrade to the symbolic path.

### GCD (SymPy `cancel`)
| Input | Result |
|---|---|
| `simplify (x^2 - y^2)/(x - y)` | `x + y` |
| `(x^2 + 2*x*y + y^2)/(x + y)` | `x + y` |
| `(x^2 - y^2)/(x^2 - 2*x*y + y^2)` | `(x + y)/(x - y)` |
| `(a^3 - b^3)/(a - b)` | `a^2 + a*b + b^2` |
| `(x*y + x)/(y + 1)` | `x` |
| `(x^4 - y^4)/(x^2 + y^2)` | `x^2 - y^2` |
| `(x^2 - y^2)/(x + y) + y` | `x` |
| `(x^2 - 4*y^2)/(x + 2*y)` | `x - 2*y` |
| `(x^3 + y^3)/(x^2 - x*y + y^2)` | `x + y` |
| `(x^2*y + x*y^2)/(x^2 - y^2)` | `x*y/(x - y)` |
| `(x^2 + x*y - 2*y^2)/(x^2 - y^2)` | `(x + 2*y)/(x + y)` |
| `(x^3*y - x*y^3)/(x^2*y + x*y^2)` | `x - y` |
| `(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))` | `sin(x) + cos(x)` |
| Derivative kind `(x^2 - y^2)/(x - y)` | `f' = 1` |
| `simplify cbrt(2)^3 - 2`; `simplify (sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1` | `0` |
| `exprEqual(x^y/x, x^(y-1))`; `exprEqual(x^(y+1), x*x^y)` | true |
| `(x^2*y - y)/(x*y + y)`; `(x^2 - 1)/(x - 1)` | unchanged: `x - 1`; `x + 1` |

### Radius
Hand-derived as the distance to the nearest singularity. The second route is the SymPy series to order 40 with the root test, showing the trend.

| R | Inputs |
|---|---|
| 1 | `taylor 1/(1-x)` · `1/(1+x^2)` (±i) · `ln(1+x)` · `sqrt(1+x)` · `atan(x)` · `1/(1+x+x^2)` (e^{±2πi/3}) · `1/x about 1` · `1/(1-x)^2` |
| ∞ | `exp(x)` · `sin(x)` · `(x^2-1)/(x-1)` (removable) |
| `pi/2` | `tan(x)` · `1/cos(x)` |
| 2 | `1/(2-x)` · `1/(x^2 - 5x + 6)` · `ln(x) about 2` |
| `sqrt(5)` | `1/(x^2+4) about 1` |
| `2*pi` | `x/(exp(x)-1)` |

**Explicit terms:**
| Input | R | Interval | Endpoint reasoning |
|---|---|---|---|
| `radius of convergence sum x^n/n` | 1 | `[-1, 1)` | harmonic at 1; alternating at −1 |
| `sum x^n/n^2` | 1 | `[-1, 1]` | p-series |
| `sum n*x^n` | 1 | `(-1, 1)` | divergence test |
| `sum x^n/factorial(n)` | ∞ | — | — |
| `sum factorial(n)*x^n` | 0 | — | "converges only at x = 0" |
| `sum (x-3)^n/(n*2^n)` | 2 | `[1, 5)` | — |
| `sum x^n/3^n` | 3 | `(-3, 3)` | — |

**Must refuse:** `taylor abs(x)` and `radius of convergence gamma(x)`.

### Integration and multivariable (SymPy)
**Antiderivatives:**
| Integrand | Result |
|---|---|
| `1/sqrt(1-x^2)` | `asin(x)` |
| `-1/sqrt(1-x^2)` | `-asin(x)` |
| `1/sqrt(4-x^2)` | `asin(x/2)` |
| `1/sqrt(9-4x^2)` | `asin(2*x/3)/2` |

**Definite and double integrals:**
- ∫₀^½ of `1/sqrt(1-x^2)` → `pi/6`; ∫₀¹ → `pi/2`.
- The double twin over [0, 0.5]×[0, 1] → `pi/6`.
- The near-pole double integral → 31411.1646312692 (`10000*atan(3000) + 10000*atan(7000)`).
- `1/x` over (−1, 1) is still refused.

**Lagrange:**
- `lagrange x*y subject to x^2 - y^2 = 1` → "no constrained critical point". SymPy finds only complex solutions, with λ = ±i/2.
- `lagrange x*y subject to x^2 + y^2 = pi` and `maximize x y subject to x^2 + y^2 = pi` · max `pi/2` at ±(`sqrt(2*pi)/2`, `sqrt(2*pi)/2`) · min `-pi/2` · λ = ±1/2
- Twins: `maximize x*y subject to x^2 + y^2 = 2` → ±1; `maximize 3x + 2y subject to x + y <= pi` → the LP refusal naming pi.

**Gradient, Jacobian, Hessian:**
- `jacobian (r*cos(t), r*sin(t))` → `det J = r`.
- `gradient x^y at (1, 1)` → `(1, 0)`, |∇f| = 1.
- `hessian x^y at (1, 1)` → `[[0, 1], [1, 0]]`.
- `critical points x^y` → (1, 0) saddle, D = −1.

### Proportion CI
statsmodels `proportion_confint`; the independent closed form and `scipy.stats.beta` agree to 6 dp.

| Input | Wilson (leads) | Clopper–Pearson | Wald |
|---|---|---|---|
| p = 0.4, n = 100 | [0.309401, 0.497997] | [0.303295, 0.502791] | [0.303982, 0.496018] |
| 1 of 50 (p = 0.02) | [0.003539, 0.104954] | [0.000506, 0.106470] | [−0.018805, 0.058805], truncation SAID |
| 0 of 20 (p = 0) | [0, 0.161125] | [0, 0.168433] | zero width — "fails here" |
| 20 of 20 | [0.838875, 1] | [0.831567, 1] | zero width |
| 12 successes out of 40; x = 12 n = 40; 12/40 | [0.180748, 0.454300] | [0.165627, 0.465316] | [0.157987, 0.442013] |
| 12 of 40, 99% | [0.153277, 0.503632] | [0.134357, 0.514308] | [0.113363, 0.486637] |
| 7 of 30, 90% | [0.131760, 0.379026] | [0.114987, 0.393947] | [0.106317, 0.360349] |
| 3 of 10 | [0.107791, 0.603222] | [0.066740, 0.652453] | [0.015974, 0.584026] |

### Markov (exact `Matrix.inv` over ℚ)
**P₁ = `[[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]]`:**
- `expected hitting time from 1 to 3` and `expected steps from state 1 to state 3` → 8; from S2 → 6.
- `mean first passage time` → M = [[4, 2, 8], [6, 2, 6], [8, 2, 4]]. The diagonal is 1/π, with π = (1/4, 1/2, 1/4).
- `probability of reaching 3 before 1 starting from 2` → 1/2.
- `expected return time` → 4, 2, 4.

**P₂ = `[[1/2,1/3,1/6],[3/4,0,1/4],[0,1,0]]` (A, B, C):**
- π = (1/2, 1/3, 1/6).
- Reach C: from A → 16/3; from B → 5.
- Reach A: from B → 5/3; from C → 8/3.
- Return time to A → 2.

**Weather `[[0.9,0.1],[0.5,0.5]]`:**
- S1 → S2: 10. S2 → S1: 2.
- Return times: 6/5 and 6.

**Gambler's ruin 0…4** (fair, absorbing). This is the EXISTING path and must not change:
- expected steps 3, 4, 3;
- P(reach 4 first) = 1/4, 1/2, 3/4.

**Unreachable:** `markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2` → "∞ — S2 cannot be reached from S1".

## E. Codebase-specific risks

1. **The Durand–Kerner hand-off is pinned.**
   - solve.ts:2181–2186 and its caveat ("not attempted above the quadratic") are pinned in `solveBaseline.test.ts.snap` (7 lines, 163–169) and in `algebraTools.test.ts`.
   - Rewrite each pin by hand to §D and give the reason. A `-u` run blesses the replacement unseen.
2. **`snap` and the grouping are absolute** (solve.ts:1495–1499, ~1525).
   - That loses digits of small roots and merges distinct roots closer than 1e-6. Make both relative.
   - Once Yun has run, grouping is never needed for multiplicity.
3. **Multiple roots are an algebraic problem.** Run Yun at EVERY degree, including the numeric ≥ 5 path. mpmath fails the same inputs.
4. **Six internal callers of `solveEquation`.** Pin them in `solveCallers.test.ts` before and after.
   - **`multivar.ts:626` `realRootsOne`** trusts `exact` and pushes `parseExpr(root.display)` through `S` → `casSimplify`. That folds `cbrt(2)` and `cos(acos(…)/3)` to float rationals, so its `isNum(…, 0)` checks fail.
     - D adapts it: for degree ≥ 3, use `N(root.re)` and keep `exact` as a label or certificate flag.
   - **`recurrence.ts:421`** Newton-polishes from `re`/`im`, so keep them at full double precision.
   - **`odeSymbolic.ts:264`** handles quadratics only.
   - **`wordproblem.ts:362`, `unitSolve.ts:290`, `pasteMath.ts:555`** accept on `roots.length > 0`.
5. **cas.ts:629–637 folds constant functions to float-derived rationals.**
   - `sqrt(2)` becomes a 53-bit rational, and `exprEqual(cbrt(2)^3, 2)` is false.
   - So the CAS can neither certify nor recognise a radical identity. Verify roots by certificate only.
   - `exactRadicals` is opt-in on purpose.
6. **GCD placement.**
   - `rfNorm` (433) runs on EVERY `rfAdd/Mul/Div`, so all 9 CAS-consuming modules pay for anything there (`simplify` → `casSimplify`, solve.ts:812).
   - Put it at the output boundary. The reason is COST, not uniqueness.
   - `canonicalKey` (745) is `keyFmt(casSimplify(e))`, so a capped GCD at the boundary changes
     keys exactly as it would inside `rfNorm`. Keys were already equal only "up to the module's
     cancellation power". Builder B must therefore grep every `canonicalKey` consumer and must not
     treat keys as safe. Pin a below-cap/above-cap pair.
   - `exprEqual` is subtraction-to-zero and remains cap-independent.
   - `MAX_TERMS = 4000` (243) still bounds expansion. Time the suite before and after.
7. **The symbolic-exponent split** (cas.ts:619–622) must not reshape `x^(y/2)` or `x^(-y)`. Pin `exprEqual(x^(y+1), x*x^y)`. Today's false negative is what refuses the symmetric Hessian at multivar.ts:409.
8. **The pane typesets a root only when its display has no `i` or `×`.**
   - The test `if (/[i×]/.test(root.display)) say(plain)` (taskpane ~28287) matches the `i` in `pi`, so `2*cos(2*pi/9)` would silently lose typesetting.
     - Use a lookbehind-free form: `/(^|[^A-Za-z_])i(?![A-Za-z_(])|×/`.
     - Lookbehind already ships in `complexAlgebra.ts:373`, live since v2.126, but `taskpane.ts`
       has none (0 hits). A regex SyntaxError there blanks the whole pane on WKWebView before
       Safari 16.4, the renderer-contract class, and the Mac WebView is still an open question.
   - `solveTypeset`/`mathParse` know `root(n, x)` but not `cbrt`. F adds that mapping.
9. **`EXACT_DISPLAY_MAX = 48`** (solve.ts:1327) rejects most Cardano pairs. Give polyRoots its own cap of 120, with the decimal fallback and `exact: false`. Never truncate an expression.
10. **The display contract.**
    - `∛`, `∜` and `arccos` don't parse; `cbrt` and `acos` do.
    - `(-2)^(1/3)` is NaN; `cbrt(-2)` is −1.2599.
    - Write `sqrt(3)/2*cbrt(2)*i`, never `…cbrt(2)i`. A juxtaposed `i` after a fraction trips the `1/2x` refusal (solve.ts ~1380).
    - `pi`, `lambda` and `e` are reserved.
    - `solveDisplayContract.test.ts` must cover the trig, Cardano, nested-sqrt and `(×4)` forms.
11. **analysis.ts:490–497 coefficients are floats.** R comes from structure only. Even exact coefficients mislead at k = 40.
12. **The equation kind has a limit switch (`parseLimitRequest(taskText)`, ~28000) but no series switch.**
    - Add `parseSeriesRequest` and the radius phrasings, guarded by `!transformVerb`.
    - `isProseRequest` must learn them, or the preview typesets "radiusofconvergence" as variables.
13. **The task-verb steal (WRONG #7) predates this release but blocks it.**
    - `normalizeTaskProse` learns the phrasings, but that alone does nothing. The pane calls
      `solveEquation(text)`, and `extractEquation` runs only when `r` is null; "unsolved" is
      non-null.
    - F adds this pane step: when `r.method === "unsolved"` and every extra unknown is a stripped
      task word, re-solve on `normalizeTaskProse(text)` and print "Read the equation out of the
      sentence: …".
    - This is pinned in `symbolicRouting.test.ts`.
    - Twins `solve = 5` and `roots = 3` (variables named solve or roots) still solve for those names.
    - `algebraSwitch.test.ts:31` (`solve x^2 = 4` stays put) still passes.
14. **lp.ts:559–562 before the null-return at 566.**
    - Any Lagrange problem with a `pi` constant or a `lambda` variable is stolen.
    - Move the check, and pin the twin in `lpRouting.test.ts`.
15. **markov.ts has three separate routing bugs:**
    - the 298 refusal list;
    - the `wantsAbsorb` regex at 358;
    - the return-time regex at 406, which requires "to <state>".
    - Separately, "probability of reaching …" has no guard at all and falls through to the stationary block.
16. **probability.ts:1330–1347.**
    - The `prop` test needs "proportion" or `p = 0.x`, so the count forms miss.
    - `Math.max(0, lo2)` clamps silently. `okN` changes only the caveat.
    - The exact binomial route honours `CAPS.BINOMIAL_N` (10 000). Above it, the beta route stands alone, and the output says so.
17. **The near-pole fix is a positivity CERTIFICATE (multivar.ts:1325–1334), not a looser tolerance.** The referee is what stops `1/x over (−1, 1) = 0, exact` (the v2.130 lesson).
18. **Caps BEFORE work, each one a named refusal:**
    - rational-root candidates 20 000 (existing; propagate `incomplete`);
    - Cardano/Ferrari operands ≤ 64 bits;
    - GCD ≤ 4 atoms, degree ≤ 12, ≤ 200 terms, ≤ 4096 bits;
    - Sylvester ≤ 12;
    - radius denominator degree ≤ 8;
    - Markov ≤ 12 states.
    - A clamp that bounds memory does not bound time.
19. **recurrence.ts has its own `Rat` and `QN` (ℚ(√D)).** Never import them: wrong class, and a DiscreteError coupling.
20. **v2.135.0 owns `algebraTools.ts` (the simplify/factor verbs) right now.**
    - F rebases onto it.
    - Its `algebraKindFor` runs on the RAW input before `transformVerb`, and must not claim the three stay-put inputs named in §C.
