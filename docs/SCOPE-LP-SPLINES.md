# Scope — Solve domains: linear programming, interpolation, splines

_Written 2026-10-14 at v2.131.0, from a read-only audit of the equation-kind routing, the
multivariable verbs, the exact-rational CAS, the inequality kind, the sketch-fit and
regression engines, and a 104-input probe driven through the lib-level chain the pane
calls (foldPastedMath → prose switches → tryStatsIntent → trySum → the verb chain →
word-problem switch → solveInequality → solveWithUnits/solveSystem → solveEquation/
extractEquation, mirrored from taskpane.ts 27660–28120; the probe file was deleted, its
findings are in §A). Audit-first, per the house method: wrong answers first. The
acceptance inputs in §D are the release's exit test. Planned as v2.132.0._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each verified by reading):**
- `cas.ts` — `Rat` (BigInt) with `ratAdd/Sub/Mul/Div/Neg/Sign/Eq`, `parseRatLiteral("0.35")`
  → 7/20, `ratPolyAdd/Scale/Mul/Trim/Eval/DivMod`, `ratPolyToExpr(coeffs, x)` (low→high):
  the whole Lagrange/Newton/Vandermonde toolkit and the spline-piece printer already exist.
  **Second, unrelated `class Rat` in `recurrence.ts`** — never import that one.
- `systems.ts` — `rref(m: Rat[][]) → {rows, pivots}` exact (the tridiagonal spline system and
  the Vandermonde cross-check); `linearCoeffs(expr, vars) → {coeff: Map, constant} | null`
  (null when not linear — exactly the "this constraint is not linear" refusal); `splitEquations`.
- `solve.ts` — `parseExpr`, `format`, `evalAst`, `freeVars`; identifiers are
  `[A-Za-z_][A-Za-z0-9_]*`, so `x1`, `x_1`, `x2` all parse as names (but see fold trap E2).
- `inequalities.ts` — `parseInequality` accepts `<= >= != ≤ ≥ ≠ < >` — NOT `=<`, `=>`,
  `≦`, `≧`; `solveInequality` is ONE variable only; multi-relation lines reach `solveChained`.
- `multivar.ts` — `tryLagrange` (line 946) and `MULTIVAR_VERB_RE` (1539) claim
  `maximi[sz]e|minimi[sz]e|optimi[sz]e|extremi[sz]e … subject to|s.t.|given|under|with the
  constraint|on`. This is the LP audit's main defect (below).
- `algebraTools.ts` — `VerbResult {title, lines[{text, math?}], caveats, svg?, alt?, plot?}`;
  private `fmtCoefTerm`/`polyString(coeffs: Rat[], varName)` print exact polynomials in Solve
  grammar — export rather than copy. `geometry.ts` `fmtRat` ("7/2"). `exact.ts` `constantRat`.
- `pasteMath.ts` — `foldPastedMath(text, {stackedFractions, bareStackedPairs, extractFromProse,
  geometry, ode})`: the fold runs BEFORE the verb chain (taskpane 27668) and (a) rewrites
  `3x1 → 3x^1` under `stackedFractions`, (b) drops lines without a comparator as "prose"
  under `extractFromProse`. Both fire on LPs (E2, E3). `normalizeTaskProse`, `hasProseWords`.
- `plot.ts` — `buildPlotSvg(series: {points, type: "line"|"scatter", color?, label?}[],
  options)`: a sampled curve plus a scatter series IS the interpolant figure. `mechchart.ts`
  `hBarSvg(rows, {title, unit})` for an n-variable solution bar chart. The pane renders
  `verb.svg` (since v2.131.0) and `verb.plot` with `shadeBetween`/`marks` — but `plot` draws
  every expression across the WHOLE window: a spline piece cannot go through it (E13).
- `regression.ts` `polynomialRegression(x, y, degree ≤ 6)` (centred, float, least squares)
  and `sketchFit.ts` `fitSketch` (linear/quadratic/cubic/exp/log/power, ranked by adjusted
  R², caveat "As many parameters as points — this is interpolation, not evidence of the
  model"): these are FITS. Nothing in the product passes through every point exactly.
- `optimize.ts` — `nelderMead` is the Nelder–Mead SIMPLEX (unconstrained, float, derivative-
  free). It is not Dantzig's simplex and must not be presented as an LP solver; the only
  reuse is as a float sanity check on a bounded LP (minimise with a penalty — not worth it).
- `odeSymbolic.ts` `foldPrimes` (for `S'(0) = 1`); `mathParse.ts` typesets `cases/piecewise`
  for DISPLAY only (not re-parseable — the display contract keeps pieces as separate lines).
- Routing tests on the pane source: `probabilityRouting.test.ts` is the template;
  `solveDisplayContract.test.ts` pins "whatever is shown re-parses via `parseExpr`";
  `scripts/figure-layout-run.ts` (verb figures block at ~1605) and `check-figures.js`
  `CORPUS_FLOOR = 179`.

**Missing (everything below is new):**
- No LP engine: no simplex, no tableau, no duals, no sensitivity, no feasible-region figure.
- No interpolation engine: no Lagrange, Newton divided differences, Neville, error bound.
- No spline engine of any kind (grep `spline` in src: only a colour-ramp "interpolation" in
  `chartPalette.ts` and prose in `computation.ts`).
- No point-list grammar in the equation kind: `(1, 2), (2, 3)` parses nowhere; the GEOMETRY
  kind reads every point list as a polygon (`solveGeometry` → "Polygon from 3 points").

**Probe (104 inputs: 79 curriculum — 37 LP, 24 interpolation, 18 spline — plus 4 re-runs in
the Geometry kind and 21 trap variants). Ranked wrong > silent > missing; exact text.**

- **Handled correctly: 1 of 104**, and it is not LP: `minimize x^2 + y^2 subject to x + y = 1`
  → Lagrange candidates `(1/2, 1/2): f = 1/2, λ = 1` (correct, "boundedness not established").
- **Handled WRONG — a confident answer to a different question: 16.**
  - The `name = number` steal (7): `interpolate (0, 1), (1, 3), (2, 2) at x = 1.5` → "Solve
    for x · x = 3/2 · Method: exact (linear) · Polynomial form: 1·x^1 + -1.5·x^0 = 0" (answer
    23/8). Same for `linear interpolation between (1, 10) and (3, 20) at x = 2` → "x = 2"
    (answer 15); `linearly interpolate at x = 2.5 from (2, 4) and (3, 9)` → "x = 5/2" (13/2);
    `neville's method (0,1), (1,3), (2,2) at x = 1.5` → "x = 3/2"; `error bound for
    interpolating sin(x) at x = 0, 0.5, 1 with a quadratic` → "x = 0"; `interpolate (1, 2),
    (2, 3), (4, 7) at x = 3 using lagrange` → "x = 3" (14/3); `natural cubic spline through
    (0, 0), (1, 1), (2, 0) evaluate at x = 0.5` → "x = 1/2" (11/16).
  - Words read as unknowns (3): `maximize 3x + 2y` → "This has more than one unknown
    (maximize, x, y) — choose which one to solve for:"; `spline` → "spline = 0 · Polynomial
    form: 1·spline^1 + 0·spline^0 = 0"; `interpolation table x 1 2 4 y 2 3 7` → "more than
    one unknown (interpolation, table, x, y)".
  - `interpolating polynomial for f(x) = 1/x at x = 1, 2, 4` → "Read “f(x) = …” as a function
    DEFINITION: y stands for the output f(x) … more than one unknown (y, x, at)".
  - `standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2` → heading "Solve
    standard form of maximize …", answer line **"x ∈ refused"** (solveChained read `<= … >=`
    as a mixed-direction chain; the pane prints the internal `display: "refused"` sentinel).
  - The paste fold rewrites the problem (1, also counted among the steals): `maximize 3x1 +
    2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, …` is folded to `3x^1 + 2x^2 + 5x^3 … 2x^2 …
    3x^1 + 2x^3 … 4x^2` with the note "Read 7 powers that lost their superscripts in the
    paste (3x2 → 3x²). If a variable named x2 was meant, write x_2." — the typeset preview
    shows powers, and `x1` and `x^1` now coexist in one problem.
  - Geometry kind (4): `polynomial through the points (0, 1), (1, 3), (2, 2)` → "Polygon from
    3 points: area 3/2, perimeter 5.886, centroid (1, 2), circumradius (5*sqrt(2))/6"; `smooth
    curve through the points (0, 0), (1, 2), (2, 1), (3, 3)` → "Polygon from 4 points … SIGNED
    area is zero — the boundary crosses itself"; `natural cubic spline through …` and
    `interpolate (1, 2), (2, 3), (4, 7)` → polygon areas 1 and 1.
- **Refused for the WRONG reason, no number: 32.** Every line opening `maximize|minimize|
  max|min|Minimise` with `subject to|s.t.|on|with the constraint|given` is taken by
  `tryLagrange` (28 inputs): the pane shows the eyebrow "Lagrange multipliers: 3x + 2y subject
  to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0", an EMPTY result body, and the caveat "The
  constraint must be an equation g(x, y) = c." (`with the constraint x + y <= 4` → "Couldn't
  read the constraint: Unexpected character "<""; `maximize 3x + 2y given x + y = 4` → "The
  system ∇f = λ∇g, g = c could not be solved here." — the LP answer is "unbounded as
  stated; 12 at (4, 0) with x, y ≥ 0"). Multi-line LPs (2): `max 3x + 2y ⏎ x + y <= 4 ⏎
  x + 3y <= 6 ⏎ x, y >= 0` → "Couldn't parse that system." with the fold note "Found 3
  equations in the pasted text; 1 prose line ignored." — the OBJECTIVE was the prose line;
  with a `subject to` line, "2 prose lines ignored". Two more: see "standard form" above.
- **Generic inequality refusal: 14** — `shadow prices for …`, `dual of …`, `sensitivity
  analysis …`, `reduced costs for …`, `simplex tableau for …`, `two phase simplex minimize …`,
  `graphically solve maximize …`, `LP: max 3x+2y st x+y<=4, …`, `diet problem: minimize cost
  0.6x + 0.35y subject to …`, `max z = 3x + 2y, x + y <= 4, …`, `x + y <= 4`, `x + y =< 4`,
  `x + y <= 4, x >= 0, y >= 0`, `x1 + x2 <= 4` → "Inequalities are solved exactly for
  POLYNOMIAL and RATIONAL expressions in one variable — e.g. x^2 - 4 > 0, or 1/(x-2) >= 0.
  This one is outside that, so nothing is reported rather than guessed."
- **"Couldn't parse that equation. Try e.g. x^2 - 5x + 6 = 0.": 39** — every point-list
  input without an `=` (all Lagrange/Newton/divided-difference/polynomial-through/spline/
  pchip/smooth-curve/linear-spline/polyfit/parabola-through/line-through/least-squares
  lines, the coincident-x case, `estimate f(2.5) given f(2) = 4, f(3) = 9 by linear
  interpolation`, the chairs-and-tables word problem, the transportation line).
  "Couldn't parse that system.": 2 (`x = 1, 2, 3, 4; y = 1, 4, 9, 16 interpolating polynomial`,
  `newton forward difference table for x = 0, 1, 2, 3; y = 1, 2, 5, 10`).
- **Missing engine: 104 of 104.** Nothing answers any of them.

## B. Syntax and output

Three verb families in the equation kind's verb slot, tried FIRST (before `tryMarkov`), each
guarded in `transformVerb` so the prose switches and `tryStatsIntent` stand aside. All three
share one point-list reader (`src/lib/pointList.ts`): `(1, 2), (2, 3)` · `(1,2) (2,3)` ·
`x: 0, 1, 2; y: 1, 3, 2` · `x = 0, 1, 2; y = …` · `x 1 2 4 y 2 3 7` · `f(2) = 4, f(3) = 9` ·
`f(x) = 1/x at x = 1, 2, 4` (sample the function at the nodes, exactly where
`constantRat` can, else refuse). Decimals through `parseRatLiteral` — never `Number()`.

**Guards (sketches; the routing test pins every §D input against them):**
- `LP_VERB_RE = /^\s*(?:lp\s*:\s*)?(?:max(?:imi[sz]e)?|min(?:imi[sz]e)?)\b(?=[\s\S]*(?:\bsubject\s+to\b|\bs\.?\s?t\.?(?=\s)|\bsuch\s+that\b|\bgiven\b|\bwith\b|\bwhere\b|[\n,;][^\n]*[<>≤≥≦≧]|=[<>]))|^\s*(?:shadow\s+prices?|dual(?:\s+(?:problem|values?|of))?|sensitivity(?:\s+analysis)?|reduced\s+costs?|simplex(?:\s+tableau)?|two[-\s]phase|big[-\s]?M|standard\s+form|graphical(?:ly)?\s+solve)\b/i`
  — any `maximize/minimize` whose line (or a later line) carries a comparator; the LP noun
  openers; NOT `maximize f(x) = x^2 - 4x` (no comparator: single-variable calculus stays).
- `INTERP_VERB_RE = /^\s*(?:lagrange|newton(?:'s)?\s+(?:divided|forward|interpolat)|neville(?:'s)?|divided[-\s]differences?|(?:linear(?:ly)?\s+)?interpolat(?:e|ing|ion)|(?:find\s+)?(?:the\s+)?(?:polynomial|quadratic|cubic|parabola|line)(?:\s+of\s+degree\s+\d+)?\s+through|degree\s+\d+\s+polynomial\s+through|error\s+bound|estimate\s+f\()/i`
- `SPLINE_VERB_RE = /\b(?:natural|clamped|not-a-knot|cubic|linear|quadratic|monotone|complete)?\s*splines?\b|^\s*(?:smooth\s+curve\s+through|pchip|monotone\s+cubic)/i`
- A line matching `\b(?:fit|least\s+squares|regression|best[-\s]fit)\b` AND NOT `through` is
  NOT an interpolant: refuse by name ("A FIT is least squares and need not pass through any
  point — Sketch data → function on the canvas, or Stats mode regression. An INTERPOLANT
  passes through every point: write `interpolate …` or `polynomial through …`."). `fit a
  polynomial through …` (both words): interpolate, and say in a caveat which one was done.

| Verb | Examples | Output / verification |
|---|---|---|
| LP: `maximize c·x subject to …` | `maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0` · `max 3x + 2y s.t. …` · `… x, y >= 0` · one constraint per line · `maximize z = 3x + 2y …` · `Maximize P = 40x + 30y …` · `minimize 2x + 3y subject to x + y >= 4, …` · `maximize 3x1 + 2x2 + 5x3 subject to …` · `x_1` · `=<`, `≤`, `≦` · `; `-separated · `with x, y nonnegative` | Title "Linear program — maximize 3x + 2y (2 variables, 2 constraints + non-negativity)". Lines: the standard form (slacks named `s1, s2`); the optimum as math `x = 4`, `y = 0`, `z = 12`; status "unique optimum" / "alternative optima along the edge from (1, 3) to (3, 1) — every point on it gives z = 8" / "UNBOUNDED: along x = 1 + t, y = t the objective 1 + 2t grows without bound" / "INFEASIBLE: x + y ≤ 1 and x + y ≥ 2 cannot both hold" / "degenerate vertex (3 constraints meet at (0, 2))"; constraint table at x* (LHS, bound, slack, binding?); shadow prices (dual values) per constraint; reduced costs per variable; sensitivity: objective-coefficient ranges and RHS ranges for the optimal basis (only when nondegenerate — else "shadow prices are not unique here" by name). Exact `Rat` simplex (Bland's rule; two-phase for `≥`/`=`); artificial variables named in the steps when phase 1 ran. Verified: every constraint re-evaluated at x* exactly; dual feasibility `Aᵀy ≥ c, y ≥ 0` exactly; complementary slackness; strong duality `cᵀx* = bᵀy*` exactly; for 2 variables an INDEPENDENT vertex enumeration (all pairs of constraints, exact) must return the same optimum — refuse on disagreement. Figure (2 vars): feasible polygon shaded, each constraint line labelled, objective contour through x* dashed with its direction arrow, x* marked "(4, 0), z = 12"; alternative optima: the edge highlighted; unbounded: the ray drawn; infeasible: half-planes drawn, nothing shaded, caption "empty". n ≥ 3: `hBarSvg` of x* and a second bar group of slacks. |
| LP nouns | `shadow prices for maximize …` · `dual of maximize …` · `sensitivity analysis …` · `reduced costs for …` · `standard form of …` · `simplex tableau for …` · `graphically solve …` | Same engine; the noun selects what leads: `dual of` prints the dual LP (`minimize 4u + 6v subject to u + v >= 3, u + 3v >= 2, u, v >= 0`) AND solves both, showing `z* = w* = 12`; `standard form of` prints the conversion (slack/surplus, free variables as `x = x' - x''`, min → −max) and STOPS; `simplex tableau` prints the initial and final tableaux (`bmatrix` in the typeset layer, numbers exact); `graphically` forces the 2-variable figure and refuses with 3+ variables by name. |
| LP word problem (ONE template) | `A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available. How many of each maximize profit?` | Products × resources template only (`findUnmodelledCondition` pattern for any clause the template did not read — "at least 10 chairs", "demand", "setup cost" → refuse naming the clause). Prints the LP it built, then solves: `(30, 20)`, profit 1900. Transportation, assignment, diet-in-prose, blending: REFUSED BY NAME ("Transportation problems are not read from prose — type the LP: minimize 2x11 + 3x12 + …, with the supply and demand rows as constraints"), typed as an LP they work. |
| Integer note | `… x, y >= 0, x and y integer` · `… integer` · `… x in Z` | LP relaxation always printed first and labelled "LP relaxation"; branch-and-bound when ≤ 4 variables and ≤ 50 nodes (exact), the tree summarised ("branch x ≤ 3: z = 21 (still fractional) …; x ≥ 4: (4, 0), z = 20 — integer optimum"); beyond the cap: "LP relaxation only; the integer optimum was not searched" by name. |
| Interpolation: `interpolate pts [at x = v] [using lagrange/newton/neville]` · `lagrange polynomial through pts` · `newton divided differences pts` · `polynomial through pts` · `linear interpolation between (a, b) and (c, d) at x = v` · `estimate f(v) given f(a) = …, f(b) = …` · `error bound for interpolating f at nodes [with a degree-n polynomial]` | `interpolate (1, 2), (2, 3), (4, 7)` · `lagrange polynomial through (0, 1), (1, 3), (2, 2)` · `newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)` · `x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial` · `interpolating polynomial for f(x) = 1/x at x = 1, 2, 4` | Math line `p(x) = 1/3*x^2 + 5/3` (exact rationals, Solve grammar, re-parses); "degree 2 through 3 points" — and when the leading coefficient vanishes, "degree 2, not 3: the 4 points lie on a parabola" by name; Lagrange basis lines `L0(x) = (x - 2)*(x - 4)/3` on request (`using lagrange`); Newton table (every divided difference as a fraction, the nested form `2 + 1*(x - 1) + 1/3*(x - 1)*(x - 2)`); Neville tableau at the query point; `p(v)` exact and ≈ 6 s.f.; linear interpolation prints the proportion line `(x - 1)/(3 - 1) = (y - 10)/(20 - 10)`. Error bound: `|f(x) - p(x)| ≤ M/(n+1)! · max|Π(x - x_i)|` with M = max|f⁽ⁿ⁺¹⁾| on the node interval (symbolic derivative via `derivative`, M by dense sampling + stated as "≤ 1 for sin" only when provable), the product's max exact when its critical points are rational, else 6 s.f. Verified: Lagrange and Newton coefficient arrays identical as `Rat`; `p(x_i) = y_i` exactly for every i; Neville value = `p(v)` exactly. Refuse by name: two points with the same x and different y ("x = 1 appears twice (y = 2 and y = 3): no function passes through both"); same x same y → drop the duplicate and say so; > 12 points ("Runge: an interpolant through 13 equally spaced points oscillates — use a spline"); non-numeric coordinates. Figure: the curve on [x_min − pad, x_max + pad] (`buildPlotSvg` line series sampled 200×) with the points as a scatter series and the query point marked. |
| Splines: `natural cubic spline through pts [at x = v]` · `clamped cubic spline through pts with S'(a) = m0, S'(b) = m1` · `… with end slopes m0 and m1` · `not-a-knot spline through pts` · `linear spline through pts` · `smooth curve through the points pts` · `spline pts at v` · `S(x) natural cubic spline pts find S(v)` · `pchip pts` / `monotone cubic interpolation of pts` | `natural cubic spline through (0, 0), (1, 1), (2, 0)` · `cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends` · `cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0` | "Natural cubic spline, 3 knots, 2 pieces" (bare `cubic spline` / `spline` / `smooth curve` = natural, SAID: "end condition: natural (S'' = 0 at both ends) — say clamped … or not-a-knot to change it"); the second derivatives at the knots `M = (0, -3, 0)` as text; one math line per piece in Solve grammar with its interval in the text layer: `S(x) = 3/2*x - 1/2*x^3` on [0, 1]; `S(x) = 1 - 3/2*(x - 1)^2 + 1/2*(x - 1)^3` on [1, 2]; `S(v)` exact + ≈. Linear spline: the two line pieces. Not-a-knot through 4 points: the single cubic, said ("not-a-knot with 4 points IS the interpolating cubic"). Two points: "the line y = x (a spline through two knots is the chord)". PCHIP: Fritsch–Carlson slopes with the MATLAB end formula, the convention stated by name, each piece as a Hermite cubic. Verified: at every interior knot S, S', S'' agree from both sides EXACTLY (Rat); end conditions exact (`M0 = Mn = 0`; `S'(x0) = m0`; third derivatives equal across knots 1 and n−1); `S(x_i) = y_i`; not-a-knot with 4 points equals the interpolation engine's cubic; natural spline with 2 points equals the chord. Refuse by name: quadratic splines ("need an extra condition nobody states the same way"), repeated x, unsorted x (sort and say so — never silently), > 50 knots, 2-D/parametric splines, "smooth curve" with a single point. Figure: OWN svg — each piece sampled on ITS interval only, knots marked, clamped end tangents drawn as short segments, the query point marked. |

Labels (`z* =`, `M =`, `on [0, 1]`) live in the text layer; every mathematical string is Solve
grammar so `solveDisplayContract.test.ts` applies unchanged. Units in an LP objective
(`$30`) are stripped and reported ("profit in $"). The fold note "Read 7 powers that lost
their superscripts" must never appear under an LP verb (E2).

## C. Build order and honest limits

1. **`src/lib/pointList.ts`** — the shared reader (shapes above), exact `Rat` coordinates,
   duplicate/coincident detection, sort-with-note. Unit tests on every shape a human TYPES
   (the stats table-feed lesson: layouts humans type, not layouts the author imagines).
2. **`src/lib/interpolate.ts`** — Vandermonde via `rref` (the solver), Lagrange basis products
   via `ratPolyMul` and Newton divided differences as the two independent constructions
   (coefficient arrays compared as `Rat`; refuse on disagreement), Neville at a point, error
   bound. Export `polyString` from `algebraTools`. Limit: ≤ 12 points (BigInt Vandermonde
   denominators grow as Π(x_i − x_j); 12 keeps every coefficient printable); `f(x) = … at
   x = …` samples only where the value is an exact rational or a `constantRat` fold, else
   6 s.f. with the polynomial labelled "≈" and the exactness claim dropped.
3. **`src/lib/spline.ts`** — M-form tridiagonal system over `Rat` by `rref` (n ≤ 50), natural /
   clamped / not-a-knot / linear / PCHIP; continuity and end-condition checks symbolic; own
   figure (pieces on their intervals). Caveat line on every natural spline: "natural" is a
   choice, not a property of the data.
4. **`src/lib/lp.ts`** — constraint grammar (`,`/`;`/newline separated; `x, y >= 0` expands;
   `with x, y nonnegative`; `x and y integer`; `=<`/`=>`/`≦`/`≧` normalised BEFORE
   `parseInequality`), `linearCoeffs` per side (null → "not linear: x*y" by name), exact
   two-phase tableau simplex with Bland's rule (terminates on degenerate problems; pivot cap
   500 → `incomplete` flag and a refusal, never a partial answer), duals read from the final
   tableau, reduced costs, ranging, alternative-optima detection (zero reduced cost on a
   nonbasic variable → second vertex by one pivot → the edge), unbounded ray from the
   entering column, infeasibility from phase-1 optimum > 0 (the contradicting constraints
   named when ≤ 3 constraints, else "phase 1 ended at w = 1 > 0"). Non-negativity NOT stated:
   solve as typed; if that is unbounded, ALSO solve with `x ≥ 0` and print both, labelled
   ("as stated: unbounded; with x, y ≥ 0 (the textbook convention, which you did not
   state): z = 12 at (4, 0)"). Limits: ≤ 12 variables, ≤ 20 constraints (exact BigInt
   tableau); B&B ≤ 4 variables / 50 nodes; sensitivity only for nondegenerate bases.
5. **Word-problem template `src/lib/lpWords.ts`** — products × resources only;
   `findUnmodelledCondition` refusal for every clause not consumed; transportation/
   assignment/diet prose refused by name with the typed-LP form shown.
6. **Figures** — `lpRegionSvg` (polygon from the exact vertex list, lines, contour, arrow,
   marks; unbounded ray; infeasible empty), `interpolantSvg` via `buildPlotSvg`, `splineSvg`
   (own). Add four entries to `figure-layout-run.ts` (region with 5 constraints — the Taha
   problem; an unbounded ray; a 12-point interpolant; a 4-knot clamped spline with tangents)
   and raise `CORPUS_FLOOR` 179 → 183.
7. **Routing** — verbs first in the chain (`tryLp(raw) ?? tryInterpolate(text) ??
   trySpline(text) ?? tryMarkov(text) ?? …`); `LP_VERB_RE`/`INTERP_VERB_RE`/`SPLINE_VERB_RE`
   added to the `transformVerb` guard; a `lp: true` fold option that disables the
   degraded-superscript rewrite and prose extraction; `tryLagrange` returns null when its
   constraint text carries `<>≤≥` or more than one relation; the Geometry kind's point-list
   path switches to the equation kind when the line names an interpolant/spline (the
   derivative/limit/word switch pattern, taskpane ~27754); `lpRouting.test.ts` on the pane
   source; `palettes.ts` group "Optimisation & interpolation" in `SOLVE_TRANSFORMS`;
   `examples.ts` bullet; display-contract additions; an independent adversarial pass over
   the diff (house rule); then §D as the exit test.

## D. Acceptance audit

Every expected value below was computed independently (own BigInt rational vertex
enumeration, Vandermonde solve and M-form spline solve; the probe oracle was a throwaway).

LP: `maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0` → x = 4, y = 0,
z = 12; unique; binding: x + y ≤ 4; slacks 0, 2; shadow prices (3, 0); reduced cost of y
= −1; objective ranges c_x ∈ [2, ∞), c_y ∈ (−∞, 3]; RHS range of 4: [0, 6] · `maximize 3x +
2y s.t. …, x, y >= 0`, `max 3x + 2y ⏎ x + y <= 4 ⏎ x + 3y <= 6 ⏎ x, y >= 0`, `maximize z =
3x + 2y subject to x + y ≤ 4, …`, `… =< 4 …`, `… ; …`, `LP: max 3x+2y st x+y<=4, x+3y<=6,
x>=0, y>=0` → identical · `shadow prices for maximize 3x + 2y …` → (3, 0) led · `dual of
maximize 3x + 2y …` → `minimize 4u + 6v subject to u + v >= 3, u + 3v >= 2, u, v >= 0`, w* =
12 at (3, 0) · `minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0` → (3, 1),
z = 9, duals (3/2, 1/2), phase 1 stated · `two phase simplex minimize 2x + 3y …` → same with
the phase-1 tableau · `maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3
<= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0` → (0, 100, 230), z = 1350, duals (1, 2, 0), reduced
cost of x1 = −4 (and the `x_1` spelling identical) · `maximize x + y subject to x - y <= 1,
x >= 0, y >= 0` → UNBOUNDED, ray (1 + t, t) · `maximize x + y subject to x + y <= 1, x + y >=
2, x, y >= 0` → INFEASIBLE, the two constraints named · `maximize 2x + 2y subject to x + y
<= 4, x <= 3, y <= 3, x, y >= 0` → z = 8, alternative optima on the edge (1, 3)–(3, 1) ·
`maximize 3x + 9y subject to x + 4y <= 8, x + 2y <= 4, x, y >= 0` → (0, 2), z = 18,
degenerate (3 constraints meet), "shadow prices not unique" · `maximize 3x + 2y subject to
x + y = 4, x + 3y <= 6, x, y >= 0` → (4, 0), z = 12, artificial variable in phase 1 ·
`maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6` → "as stated: unbounded along (4 − t,
t), t → −∞; with x, y ≥ 0 (not stated): (4, 0), z = 12" · `maximize 3x + 2y given x + y = 4`
→ same two-part answer · `maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <=
1, y <= 2, x, y >= 0` → (3, 3/2), z = 21, duals (3/4, 1/2, 0, 0) · same `… x and y integer`
→ LP relaxation (3, 3/2), z = 21; branch-and-bound: x ≤ 3 → (3, 1) z = 19 / (2, 2) z = 18;
x ≥ 4 → (4, 0) z = 20 — integer optimum (4, 0), z = 20 · `Maximize P = 40x + 30y subject to
x + y ≤ 12, 2x + y ≤ 16, x ≥ 0, y ≥ 0` → (4, 8), P = 400, duals (20, 10) · `diet problem:
minimize cost 0.6x + 0.35y subject to 5x + 7y >= 8, 4x + 2y >= 15, x, y >= 0` → (15/4, 0),
z = 9/4, duals (0, 3/20) · `maximize 3x + 2y + z subject to x + y + z <= 10, x - y >= 2, z <=
4, x, y, z >= 0` → (10, 0, 0), z = 30 · `maximize a + 2b + 3c + d + e + f subject to a + b +
c + d + e + f <= 10, a + b <= 3, c + d <= 4, e + f <= 5, …` → z = 21, alternative optima
((0,3,4,0,0,3) and (0,3,4,0,3,0)) · `… x >= 0, y >= 0, x <= 5` → (4, 0), 12, "x ≤ 5 is
redundant (slack 1, shadow price 0)" · `standard form of maximize 3x + 2y subject to x + y
<= 4, x - y >= -2` → the conversion only, free variables split, NEVER "x ∈ refused" · chairs
and tables prose → `maximize 30x + 50y subject to 2x + 3y <= 120, x + 2y <= 70, x, y >= 0`
→ (30, 20), 1900 · `transportation problem: supplies 20, 30; …` → refusal by name ·
`maximize 3x + 2y` → usage refusal ("no constraints — an LP needs `subject to …`"), never
"more than one unknown (maximize, x, y)" · `minimize x^2 + y^2 subject to x + y = 1` → still
Lagrange (nonlinear objective: the LP verb stands aside by name) · `maximize x*y subject to
x + y <= 4` → "not linear: x*y" by name.

Interpolation: `interpolate (1, 2), (2, 3), (4, 7)` → `p(x) = 1/3*x^2 + 5/3`, Newton `2 +
1*(x - 1) + 1/3*(x - 1)*(x - 2)`; `… at x = 3` → 14/3 ≈ 4.66667 (NOT "x = 3") · `lagrange
polynomial through (0, 1), (1, 3), (2, 2)` → `-3/2*x^2 + 7/2*x + 1`; `… at x = 1.5` → 23/8
= 2.875; `neville's method … at x = 1.5` → 23/8 with the tableau · `lagrange interpolation
(1, 1), (2, 8), (3, 27), (4, 64)` and `newton divided differences …` → `x^3`; table 1 · 7,
19, 37 · 6, 9 · 1 · `x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial` → `x^2 + 1`,
"degree 2, not 3" · `polynomial through (0, 0), (1, 1), (2, 4), (3, 9)` and `x = 1, 2, 3, 4;
y = 1, 4, 9, 16 interpolating polynomial` → `x^2` · `degree 3 polynomial through (-1, 0),
(0, 1), (1, 0), (2, 5)` → `4/3*x^3 - x^2 - 4/3*x + 1` · `interpolate points (1, 2.5), (2,
3.75), (3, 1.2)` → `-19/10*x^2 + 139/20*x - 51/20` (exact — the decimals are rationals) ·
`interpolating polynomial for f(x) = 1/x at x = 1, 2, 4` → `1/8*x^2 - 7/8*x + 7/4` ·
`linear interpolation between (1, 10) and (3, 20) at x = 2` → 15 · `linearly interpolate at
x = 2.5 from (2, 4) and (3, 9)` → 13/2 · `estimate f(2.5) given f(2) = 4, f(3) = 9 by linear
interpolation` → 13/2 · `error bound for interpolating sin(x) at x = 0, 0.5, 1 with a
quadratic` → `|E| ≤ 1/6 · max|x(x - 1/2)(x - 1)| = √3/216 ≈ 0.00801875` (M = 1 for sin
stated) · `interpolate (1, 2), (1, 3), (2, 4)` → refusal naming x = 1 · `fit a polynomial
through (0,1), (1,3), (2,2)` → the interpolant + "through every point exactly; a least-
squares FIT is a different thing" · `least squares line through (1,2), (2,3), (3,5)` →
refusal by name pointing at Sketch data / Stats regression · `line through (1, 2) and (3,
8)` (equation kind) → `3*x - 1`.

Splines: `natural cubic spline through (0, 0), (1, 1), (2, 0)` → M = (0, −3, 0); `3/2*x -
1/2*x^3` on [0, 1]; `1 - 3/2*(x - 1)^2 + 1/2*(x - 1)^3` on [1, 2]; `… evaluate at x = 0.5` →
11/16 = 0.6875 (NOT "x = 1/2"); `spline (0,0), (1,1), (2,0) at 1.5` → 11/16, "natural
assumed, said" · `natural cubic spline through (0, 1), (1, 3), (2, 2), (3, 4)` → M = (0, −6,
6, 0); `1 + 3*x - x^3`; `3 - 3*(x - 1)^2 + 2*(x - 1)^3`; `2 + 3*(x - 2)^2 - (x - 2)^3`; S(1.5)
= 5/2 · `clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1` →
M = (2, −4, 2); `x + x^2 - x^3`; `1 - 2*(x - 1)^2 + (x - 1)^3`; S(0.5) = 5/8; end slopes
verified 1 and −1 · `cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0` → M =
(21/2, −9, 15/2); `1 + 21/4*x^2 - 13/4*x^3`; `3 + 3/4*(x - 1) - 9/2*(x - 1)^2 + 11/4*(x -
1)^3`; S(1.5) = 83/32 · `not-a-knot spline through (0,1), (1,3), (2,2), (3,4)` → the single
cubic `x^3 - 9/2*x^2 + 11/2*x + 1`, said; S(1.5) = 5/2; cross-checked against the
interpolation engine · `cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the
ends` → M = (0, 1, 0); `2 + 5/6*(x - 1) + 1/6*(x - 1)^3` on [1, 2]; `3 + 4/3*(x - 2) + 1/2*(x -
2)^2 - 1/12*(x - 2)^3` on [2, 4]; S(3) = 19/4 (the parabola through the same points gives
14/3 — a spline is not the polynomial) · `cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0`
→ M = (0, −9/2, 0); `1 + 7/4*x - 3/4*x^3`; `2 - 1/2*(x - 1) - 9/4*(x - 1)^2 + 3/4*(x - 1)^3`
· `S(x) natural cubic spline (0,1), (1,2), (2,0) find S(1.5)` → 41/32 · `smooth curve through
the points (0, 0), (1, 2), (2, 1), (3, 3)` → natural, said; `3*x - x^3`; `2 - 3*(x - 1)^2 +
2*(x - 1)^3`; `1 + 3*(x - 2)^2 - (x - 2)^3` · `linear spline through (0, 0), (1, 2), (3, 1)`
→ `2*x` on [0, 1]; `5/2 - 1/2*x` on [1, 3] · `cubic spline through (0, 0), (1, 1)` → "the
chord y = x" · `natural spline through (0, 0), (0, 1), (1, 2)` → refusal naming x = 0 ·
`quadratic spline through (0,0), (1,1), (2,0)` → refusal by name · `pchip (0, 0), (1, 1),
(2, 1), (3, 2)` / `monotone cubic interpolation of …` → slopes (3/2, 0, 0, 3/2) under the
stated MATLAB end formula; `3/2*x - 1/2*x^3` on [0, 1]; `1` on [1, 2]; `1 + 3/2*(x - 2)^2 -
1/2*(x - 2)^3` on [2, 3]; monotone on each piece (verified by S' ≥ 0 sampling + the
Fritsch–Carlson condition) · `spline` → usage refusal, never "spline = 0".

## E. Codebase-specific risks

1. **`tryLagrange` owns every `maximize/minimize … subject to`.** 28 of the LP inputs ended
   as an EMPTY Lagrange result with "The constraint must be an equation g(x, y) = c." The LP
   verb must precede `tryMultivar`, and `tryLagrange` must return null (not refuse) when its
   constraint text contains `<>≤≥≦≧` or `=<`/`=>` or more than one relation — pinned in
   `lpRouting.test.ts` against both `text` and `taskText`.
2. **The paste fold rewrites `3x1` to `3x^1`** (`stackedFractions`, pasteMath ~414) before any
   verb sees the text; the typeset preview shows 3x¹ + 2x² + 5x³ and `x1`/`x^1` coexist.
   Run `LP_VERB_RE` on the RAW input and pass `lp: true` to `foldPastedMath` (a new
   `FoldOptions` flag alongside `geometry`/`ode`) that disables the degraded-superscript
   rewrite and the prose extraction. The `x_1` spelling needs no fold change (`ID_RE` takes
   `_`), but `x_1` and `x1` in one problem are two names — say so if both appear.
3. **`extractFromProse` drops the objective line.** "Found 3 equations in the pasted text; 1
   prose line ignored" — `max 3x + 2y` has no comparator, so `equationLine` returns null.
   Same flag; the routing test pins the one-constraint-per-line shape.
4. **`parseInequality` does not know `=<`, `=>`, `≦`, `≧`**, and `solveChained` reads any
   line with two comparators as a chain — `standard form of … <= 4, … >= -2` printed
   **"x ∈ refused"** (the `display: "refused"` sentinel reaches the pane verbatim). The LP
   grammar normalises comparators itself; separately, the pane should never print
   `iq.display === "refused"` as an answer (one-line fix in the inequality block).
5. **The solver steals `at x = 1.5`.** `extractSingleEquation` found `x = 1.5` inside seven
   interpolation/spline inputs and answered "x = 3/2". The point-list verbs claim `at x =`,
   `at v`, `find S(v)`, `estimate f(v)`, `evaluate at` before anything calls
   `extractEquation`; bare `spline`, `maximize 3x + 2y`, `interpolation table …` must hit a
   usage refusal, never "more than one unknown (maximize, x, y)".
6. **`readFnDefinition` claims `f(x) = 1/x at x = 1, 2, 4`** as a function definition; the
   interpolation grammar reads `f(x) = expr at x = list` itself and samples the function
   (exact via `constantRat`/`exactSimplify`, else "≈").
7. **The Geometry kind reads every point list as a polygon** ("Polygon from 3 points, area
   3/2"). `solveGeometry`'s point-list path must stand aside and the pane must switch kinds
   when the line names an interpolant/spline — the same switch pattern as derivative/limit.
8. **FIT ≠ INTERPOLANT.** `sketchFit`/`polynomialRegression` are least squares (float,
   centred, R²); `fit`/`least squares`/`regression` without `through` refuse by name with the
   pointer; `through` wins and the caveat says which was done. The Sketch canvas's own
   "As many parameters as points — this is interpolation" caveat stays as it is.
9. **Commas mean three things**: point separators `(1, 2), (2, 3)`, constraint separators,
   and variable lists `x, y >= 0`. Split constraints only at depth 0 (outside parentheses),
   expand a comma-list of bare names sharing one relation, and read the prose tails (`with
   x, y nonnegative`, `x and y integer`) before `linearCoeffs` sees `nonnegative` as a
   variable.
10. **`s.t.` / `st` / trailing periods.** `foldPastedMath` strips a trailing sentence period
    ("x, y >= 0." → fine); `s.t.` survives; bare `st` (`LP: max 3x+2y st x+y<=4`) reached the
    inequality refusal — the guard's `\bs\.?\s?t\.?(?=\s)` covers all four spellings. `on` as
    a separator (`maximize f on x + y <= 4`) is Lagrange's keyword; LP accepts it too.
11. **Display contract.** Pieces are separate math lines (`cases` typesets but does not
    re-parse); `M = (0, -3, 0)`, tableaux and the dual vector are text/`bmatrix` only; `pi` and
    `lambda` are reserved names (never call the dual vector `lambda` in a math line); exact
    coefficients print via the exported `polyString` with ONE minus convention.
12. **`VerbResult.plot` cannot draw a region or a piece on its own interval** — `solveFunctionSvg`
    samples every expression across the full window, so a spline piece drawn through it would
    extend outside its knots (a wrong figure that LOOKS smooth). LP region, spline and the
    interpolant+points all go through `verb.svg` (wired since v2.131.0); the interpolant may
    use `buildPlotSvg` with a line series + scatter series. Add the four corpus entries; raise
    `CORPUS_FLOOR` to 183.
13. **Unbounded loops freeze Word.** Simplex pivots capped (500, Bland's rule makes the cap a
    formality on honest input) with an `incomplete` refusal; B&B node cap; Vandermonde /
    tridiagonal sizes capped by the point limits BEFORE any BigInt work (BigInt denominators,
    not iteration count, are the cost — a 13-point Vandermonde is already 10⁵-digit-free but a
    40-point one is not).
14. **Degeneracy and alternative optima are verdicts, not noise.** Shadow prices are not
    unique at a degenerate vertex and the tableau's duals are one of several — say so by
    name rather than printing one set as "the" shadow prices; a zero reduced cost on a
    nonbasic variable is the alternative-optima signal and must produce the second vertex,
    not a silent "unique".
15. **Non-negativity is the textbook's assumption, not the user's statement.** Solving the
    LP as typed gives "unbounded" for the commonest 2-variable homework when `x, y ≥ 0` is
    omitted — print both answers labelled (§C.4), never silently add the constraint, never
    silently drop it.
16. **`nelderMead` is "simplex" in name only.** Nothing from `optimize.ts` is reused; a reader
    grepping `simplex` must not be misled into a float LP path.
