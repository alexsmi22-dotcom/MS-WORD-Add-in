# Scope — Solve domains: Laplace / Fourier, and multivariable calculus

_Written 2026-10-13 at v2.128.0, from a read-only audit of the CAS, integration,
ODE and routing code. Audit-first, per the house method: build against this,
wrong answers first. The acceptance inputs in §D are the release's exit test._

## A. What exists, what is missing

**Stand on (all `src/lib/`):**
- `solve.ts` — `Expr` AST (`num|var|neg|add|sub|mul|div|pow|fn(name,arg)`); `parseExpr`,
  `derivative(e, x)` (per-variable, so partials are already free), `simplify`, `format`,
  `freeVars`, `evalAst`, `readFnDefinition`.
- `cas.ts` — exact `Rat` BigInt rationals, `casSimplify`, `exprEqual` (boolean|null),
  `substituteVar`, `ratFunctionInVar(e,x)→{num,den}`, `ratPolyRoots` (with `incomplete`
  flag), `ratPolyDivMod/Mul/Add`, `solveRationalInVar`.
- `casint.ts` — `partialFractionDecompose(num,den)` (linear `{root,power,A}` + quadratic
  `{b,c,power,B,C}` terms, refuses irreducible cubic+ by name), `quadraticFactorsOverQ`,
  `symbolicIntegrate` with substitution / by-parts / `tryExpTrig` (∫e^{at}sin/cos closed
  form — the forward-Laplace building block) and `tryTrigPower`; every antiderivative is
  differentiated back; `numericallyEqual` fallback.
- `odeSymbolic.ts` — `foldPrimes`, F = LHS−RHS, `verifySecondOrder(solution, F)` against
  the ORIGINAL F. Refuses non-homogeneous 2nd order and has no initial conditions — the
  hole Laplace IVPs fill.
- `control.ts` — `TransferFunction` over `Rat`, `polyRoots`, `timeResponse` (RK4
  impulse/step): an independent numeric cross-check for inverse Laplace of rational F(s).
  Coefficients run highest-power-first, opposite to the CAS.
- `systems.ts` — exact rref for linear; nonlinear → multi-start Newton labelled incomplete.
- `linalg.ts` — `determinant`, `eigenSymmetric`, `eigenvaluesGeneral` (floats).
- `analysis.ts` — `parseLimitRequest/parseSeriesRequest` are the template for prefix-verb
  request parsers; `taylorSeries` shows the exact-coefficient series display shape.
- `algebraTools.ts` — `VerbResult {title, lines[{text, math?}], caveats}`; `tryAlgebraVerb`
  is the routing model (prefix verb; a body containing `=` falls through to the solver).
- Display: `mathParse.ts` already typesets `cases/piecewise`, `iint/iiint`, `partial`→∂,
  `nabla`→∇, `laplace`→ℒ, `fourier`→ℱ, `matrix/bmatrix`; `solveDisplayContract.test.ts`
  pins "every displayed expression re-parses via `parseExpr`".

**Missing:**
- AST has no piecewise, no Heaviside/Dirac, no multi-argument function, no tuple/vector,
  no matrix. `u(t)` and `y(0)=1` both throw `Unknown function`.
- `pasteMath.ts` refuses `∂` and `∇` with a note pointing at the Differentiate kind — the
  note becomes wrong the day partials ship.
- `integrate()` takes numeric bounds only and returns null with other free vars; its
  "exact" value is the double `F(b)−F(a)`. Iterated integrals need an exact definite path:
  `casSimplify(substituteVar(F,x,hi) − substituteVar(F,x,lo))` with `hi/lo` as `Expr`.
- `cas.ts` folds functions of constants NUMERICALLY: `sin(pi)` → `1.22e-16`. Fourier
  coefficients and ∫ with π bounds leak float garbage unless trig at rational multiples
  of π is exact (precedent: `complexAlgebra.ts` closed-form `arg` at π/6, π/4 multiples).
- `e^(a t)` and `exp(a*t)` are different atoms to `exprEqual`; trig identities are
  unprovable canonically. Verification must fold `e^x→exp(x)` and fall back to sampling.
- `freeVars` returns insertion order — gradient component order must be explicit.

## B. Syntax and output

Prefix verbs in the equation kind's verb slot (`tryAlgebraVerb` pattern, no `=` in the
body), except the IVP, which lives in the ODE kind.

| Verb | Examples | Output / verification |
|---|---|---|
| `laplace f(t)` | `laplace t^2 exp(3t)` · `laplace exp(-t) sin(2t)` | `F(s) = 2/(s-3)^3`, region `s > 3`; rule steps. Verified by inverse round-trip AND numerically: ∫₀^T e^{−st}f dt vs F(s) at 3 sample s. |
| `inverse laplace F(s)` | `inverse laplace 1/(s(s+1))` · `inverse laplace (s+1)/(s^2+2s+5)` | `f(t) = 1 - exp(-t)`; partial-fraction steps. Verified by forward transform (canonical after exp-fold, else sampled) and, for rational F, by `control.timeResponse` impulse samples. |
| ODE kind: `y'' + 4y = sin(t), y(0)=0, y'(0)=0` | `y' + 2y = 1, y(0)=0` | Y(s) algebra, then `y = sin(t)/3 - sin(2t)/6`. Verified by `verifySecondOrder` against the ORIGINAL F plus ICs at t=0; the single solution curve drawn. |
| `fourier series f on (a, b)` | `fourier series t on (-pi, pi)` · `fourier series t^2 on (-pi, pi)` | `a0/2 + Σ` with exact a_n, b_n closed forms, first 5 terms written out, period stated. Verified by quadrature of a₁..a₅ and sampling S₅ vs f away from jumps (Gibbs noted). Drawn: f and S₅. |
| `gradient f` / `gradient f at (1,2)` | `gradient x^2 y + y^3` | `∇f = (2*x*y, x^2 + 3*y^2)`; variable order stated. Verified by central differences. |
| `hessian f` | `hessian x^3 + x y^2` | `bmatrix` display; verified symmetric + finite differences. |
| `jacobian (f1, f2)` | `jacobian (r cos(theta), r sin(theta))` | matrix + `det = r` exact. |
| `directional derivative f at (p) in direction (v)` | `… x^2 y at (1,2) in direction (3,4)` | unit vector stated, `16/5`. |
| `critical points f` | `critical points x^3 - 3x + y^2` | each point with D, f_xx and verdict; `D = 0` → "inconclusive" by name. Verified: ∇f = 0 exactly at each point. |
| `lagrange f subject to g = c` | `lagrange x y subject to x^2 + y^2 = 1` | candidates with f values; max/min only when the constraint set is bounded (stated). Verified by substitution into ∇f = λ∇g and g. |
| `double integral f over y from c(x) to d(x), x from a to b` · `triple integral …` | `double integral x^2 + y^2 over y from 0 to x, x from 0 to 1` | iterated steps, exact `1/3`; verified by nested Simpson. |
| `divergence (P,Q,R)` · `curl (P,Q,R)` · `line integral (P,Q) from (0,0) to (1,2)` · `potential (P,Q)` | `curl (y, -x, 0)` | curl exact; line integral only when curl = 0 is PROVEN canonically → potential, value `2`; otherwise refuse "path-dependent; give the path". |

Labels (`∇f =`, `ℒ{f} =`) live in the text layer; every mathematical string stays Solve
grammar so the display contract applies unchanged.

## C. Build order and honest limits

**Laplace domain (v2.129.0)**
1. Exact trig at rational multiples of π (unlocks Fourier and π bounds).
2. Forward table: polynomial, exp, sin/cos/sinh/cosh, linearity, first shift `e^{at}f`,
   `t^n f` by `−d/ds`, `sin²` via `tryTrigPower`. Refuse by name: uncovered products
   (convolution), `f(t)/t`, non-exponential order (`exp(t^2)`), `u(t−a)`/`δ` until step 5.
3. Inverse: `partialFractionDecompose` → table; completed-square quadratics. Refuse by
   name: repeated irreducible quadratics unless the `t·sin` pair is added, degree ≥3
   irreducible factors (`1/(s^4+1)`), improper F.
4. IVP solver (split ICs before `parseExpr`; accept `t` as the independent variable).
   Constant coefficients, order ≤ 2, forcing in the table.
5. Heaviside/Dirac as `u`, `delta` (parse + numeric meaning), second shift theorem.
6. Fourier: real trig series, piecewise polynomial/trig on a stated interval; the n=k
   resonance (`cos(t)` on (−π,π)) computed with n substituted before integrating. No
   complex form (collides with `tryComplex`'s claim on `i`).

**Multivariable domain (v2.130.0)**
1. Tuple splitter + `gradient`/`divergence`/`curl`.
2. `hessian`, `jacobian`, `directional derivative`.
3. Exact iterated integrals over rectangles and type-I/II regions with polynomial bounds.
   Refuse: non-elementary inner integrals, polar/non-rectangular without the user's bounds.
4. Critical points: exact when elimination works, else Newton labelled incomplete.
   Classification exact in 2D via D; n-D via leading principal minors; semidefinite →
   "inconclusive".
5. Lagrange: eliminate λ exactly where possible; boundedness stated, never inferred.
6. Line integrals of gradient fields only.

## D. Acceptance audit

Laplace: `laplace 1`→1/s · `laplace t^3`→6/s⁴ · `laplace exp(2t)`→1/(s−2), s>2 ·
`laplace sin(3t)`→3/(s²+9) · `laplace t exp(-t)`→1/(s+1)² · `laplace exp(-t) sin(2t)`→
2/(s²+2s+5) · `laplace t sin(t)`→2s/(s²+1)² · `laplace sinh(2t)`→2/(s²−4) ·
`laplace sin(t)^2`→2/(s(s²+4)) · `laplace exp(t^2)`→refusal by name · `laplace sin(t)/t`→
refusal (or arctan(1/s) only if built) · `laplace u(t-2)`→e^{−2s}/s.

Inverse: `1/(s^2+1)`→sin t · `1/(s(s+1))`→1−e^{−t} · `(s+1)/(s^2+2s+5)`→e^{−t}cos 2t ·
`1/(s-2)^2`→t e^{2t} · `1/(s^2-1)`→sinh t · `1/(s^3+1)`→e^{−t}/3 − e^{t/2}cos(√3t/2)/3 +
e^{t/2}sin(√3t/2)/√3 · `s/(s^2+4)^2`→t sin(2t)/4 or named refusal · `1/(s^4+1)`→named
refusal · `s`→refusal (not a function).

IVP: `y''+y=0, y(0)=0, y'(0)=1`→sin t · `y'+2y=1, y(0)=0`→(1−e^{−2t})/2 ·
`y''+3y'+2y=0, y(0)=1, y'(0)=0`→2e^{−t}−e^{−2t} · `y''+4y=sin(t), y(0)=0, y'(0)=0`→
sin t/3 − sin 2t/6 · `y''−y=t, y(0)=0, y'(0)=1`→e^t−e^{−t}−t · `y''+y=cos(t), y(0)=y'(0)=0`
→t sin t/2 (resonance).

Fourier: `t on (-pi,pi)`→2Σ(−1)^{n+1}sin(nt)/n · `t^2 on (-pi,pi)`→π²/3+4Σ(−1)ⁿcos(nt)/n² ·
`abs(t) on (-pi,pi)`→π/2−(4/π)Σ_{odd}cos(nt)/n² · square wave→(4/π)Σ_{odd}sin(nt)/n ·
`t on (0,2)`→1−(2/π)Σsin(nπt)/n · `sin(t)^2`→1/2−cos(2t)/2, terminating ·
`cos(t) on (-pi,pi)`→cos t (a₁=1, no 0/0).

Multivariable: `gradient x^2 y + y^3`→(2xy, x²+3y²) · `gradient x^2+y^2+z^2 at (1,2,3)`→
(2,4,6) · `hessian x^3 + x y^2`→[[6x,2y],[2y,2x]] · `jacobian (r cos(theta), r sin(theta))`
det→r · `directional derivative x^2 y at (1,2) in direction (3,4)`→16/5 ·
`critical points x^2+y^2-2x-4y`→(1,2) min · `critical points x^3-3x+y^2`→(1,0) min,
(−1,0) saddle · `critical points x^3+y^3-3xy`→(0,0) saddle, (1,1) min ·
`critical points x^4+y^4`→(0,0) inconclusive · `lagrange x y subject to x^2+y^2=1`→±1/2 ·
`lagrange x+y subject to x^2+y^2=2`→max 2 at (1,1), min −2 at (−1,−1) ·
`lagrange x^2+y^2 subject to x+y=1`→min 1/2, no max (unbounded, stated) ·
`double integral x y over x 0..1, y 0..2`→1 · `double integral x^2+y^2 over y from 0 to x,
x from 0 to 1`→1/3 · `triple integral x y z over [0,1]^3`→1/8 · `double integral exp(-x^2)`
→named refusal/numeric · `divergence (x^2,y^2,z^2)`→2x+2y+2z · `curl (y,-x,0)`→(0,0,−2) ·
`curl (yz,xz,xy)`→(0,0,0), potential xyz · `line integral (2xy, x^2) from (0,0) to (1,2)`→2
· `line integral (y,-x) from (0,0) to (1,1)`→refused, path-dependent ·
`potential (2x+y, x+2y)`→x²+xy+y²+C.

## E. Codebase-specific risks

1. Routing steal in the equation kind: `/\b(derivative|differentiate)\b/` fires before
   verbs, so "directional derivative of …" would switch to the Derivative kind; the stats
   intent's `mean|average` and `range` fire before verbs too. New verbs must be tested in
   that slot; the prose switches must exclude `directional|partial`.
2. `=` is the solver's fence. Keep Fourier `=`-free; put IVPs behind `foldPrimes` in the
   ODE kind, splitting `y(0)=` before `parseExpr`.
3. Float folding of constants (`cas.ts`): without exact trig at π multiples every Fourier
   coefficient carries 1e-16 noise and "exact" lies.
4. Atom identity: `e^(2t)` vs `exp(2t)` never compare equal; fold on input.
5. Coefficient order: `control.ts` highest-first, `cas.ts` index=degree — reverse once.
6. `exprEqual` returns null on `CasBail`; null is never "verified".
7. Ratchets: pane-audit and check-figures expect every result to draw; update
   `pasteMath.ts`'s ∂/∇ notes, `palettes.ts`, `examples.ts` and the kind hints.
