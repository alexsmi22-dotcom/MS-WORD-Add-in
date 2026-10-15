# Scope — Numerics + topology batch: DAE index reduction, real K-theory KO, oriented cobordism, persistence over 𝔽p

_Written 2026-10-14 against the committed v2.137.0 tree (`48995d9`). Planned as **v2.139.0**; v2.138.0 is in flight and owns `taskpane.ts`, `scripts/check-figures.js`, `scripts/figure-layout-run.ts` and `docs/TEST-SCRIPT.md`. Line numbers come from `48995d9` and each one is given with its function or anchor name, because they will drift._

_**Sources.** I read these files in full: `dae.ts` (306 lines), `persistence.ts` (417), `homology.ts` (778; `solveTopology`, `advancedQuery`), `alexander.ts` `kTheory` (273–342) and `topology2.ts` (`realProjectiveCobordism`, `BEYOND`). I also read the pane handlers: the `ANALYZE_CALCS` entry `id: "dae"` (taskpane 11790–11880), `parseAssignments` (10534) and the `kind === "topology"` branch of `updateSolve` (~29234). `ode.ts`, `odeParse.ts`, and the `solve.ts` exports `parseExpr`/`evalAst`/`freeVars`/`derivative` were surveyed for reuse._

_**Probe.** About 60 calls through the real entry points: `solveTopology` (the Solve topology kind), `persistentHomology`, and `solveDae` driven by a VERBATIM mirror of the pane's DAE `compute` and `parseAssignments`, using `evalFormula` from `stats.ts` exactly as the pane does. All of it ran from scratchpad Node scripts through `scripts/ts-require.js`. **Nothing in the tree was created or modified** apart from this file._

_**Oracles,** run this session under `python -I` from the scratchpad venv (Python 3.14.6):_
- _SciPy 1.18.1 `solve_ivp`: DOP853 at rtol 1e-13 on the pendulum's angle ODE (a different coordinate system from the DAE), and Radau on the Cartesian index-1 reduction as a second route. The period comes from `scipy.special.ellipk`._
- _**GUDHI 3.13.0** (`RipsComplex`, `homology_coeff_field=p`) and **Ripser 0.6.15** (`coeff=p`), installed today. The two agree to 6 dp on every set pinned below._
- _SymPy 1.14.0 for Pontryagin numbers, cross-checked by the Hirzebruch signature theorem (L-genus = σ)._
- _Published tables:_
  - _Ω^SO_0–8 = ℤ, 0, 0, 0, ℤ, ℤ/2, 0, 0, ℤ⊕ℤ. Fetched today from the nLab "bordism ring" table, which cites the Manifold Atlas "Oriented bordism" page; Wikipedia "Cobordism" agrees for n ≤ 5._
  - _KO~(ℝPⁿ) cyclic of order 2^φ(n): Adams, Ann. Math. 75 (1962) 603–632, Thm 7.4. A Bott–Shapiro lecture summary (Duke, "L17 Vector field application") gives the same order as the count of nonzero Atiyah–Hirzebruch E₂ entries; §D gives that count, which is the second route._

_Wrong answers come first. §D is the exit test._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each read):**
- **`dae.ts`** `solveDae(f, g, t0, t1, y0, z0, {steps})`:
  - semi-explicit index 1 only;
  - ∂g/∂z by central differences (`dgdz`, 112) and an `isNearlySingular` test (93) at t₀ only;
  - inconsistent z₀ is projected by Newton with y₀ held (honest, reported);
  - implicit Euler with g imposed at the new level, `MAX_STEPS = 20000`;
  - `guardVec` from `numguard.ts`.
  - It takes **opaque closures**, so no structural analysis is possible on its inputs.
- **`ode.ts`**: `integrate` (Dormand–Prince RK45, adaptive), `integrateStiff` (Rosenbrock, ode23s-style), `solveOde` (auto-switch) and `OdeEvent`. **`odeParse.ts` `parseOdeSystem`** binds every RHS to the NAME on its left-hand side, reduces higher order, and reads `y = 1, y' = 0`.
- **`solve.ts`**: `parseExpr` (560), `evalAst` (588), `freeVars` (675; a recursive walker, and it omits CONSTANTS), and the symbolic `derivative(e, x)` (739; throws "No derivative rule" for unknown functions). `pi`, `e` and `lambda` are reserved.
- **`persistence.ts`**:
  - `ripsComplex` (90) is the Vietoris–Rips construction to `topDim = maxDim + 1`;
  - `reduce` (144) is the standard column reduction over 𝔽₂, with columns as `Set<number>`, NO SIGNS (156), and addition by symmetric difference (176);
  - `MAX_POINTS = 150`, `MAX_SIMPLICES = 60000`, `MAX_DIM = 2`;
  - `barcodeSvg` (345) and `parsePointCloud` (404).
  - **At a finite scale this engine is RIGHT**: it matches Ripser and GUDHI over 𝔽₂ to 6 dp on all three §D sets (pin these as twins).
- **`homology.ts`**:
  - integral simplicial homology by SMITH NORMAL FORM over bigint (`smithNormalForm`, 143), with the Euler self-check;
  - `allFaces` projects the face count BEFORE enumerating (62–80), which is the house pattern;
  - `BUILTIN` includes `klein` (gridSurface 4×4 twisted) and `rp2` (6-vertex), giving ℤ, ℤ⊕ℤ/2, 0 and ℤ, ℤ/2, 0. Both are correct.
  - `solveTopology` (426) routes in this order: cloud → knot → stable stem → Serre → K-theory (497) → `advancedQuery` (521; SW class, Chern class, cobordism, cellular, `BEYOND`) → named space → explicit complex.
- **`alexander.ts` `kTheory`** (273): complex K of Sⁿ (n ≤ 64), ℂPⁿ (n ≤ 64), and the exact strings `point`/`pt` and `torus`/`t^2`.
- **`topology2.ts`**: `swRealProjectiveTangent`, `chernComplexProjectiveTangent`, `partitions` (`MAX_PARTITION_N = 40`), `realProjectiveCobordism` (402; SW numbers of ℝPⁿ only) and `cellularHomology`.

**Missing (verified by probe and grep):**
- no DAE index > 1, no structural analysis, no stabilisation, no drift measure on ORIGINAL constraints;
- no KO at all;
- no complex K of ℝPⁿ;
- no oriented cobordism, Pontryagin number or signature;
- no cobordism of anything except a single ℝPⁿ;
- no persistence or homology with 𝔽p coefficients;
- no scale control on the pane's persistence path.

**Probe ranked WRONG > refused-for-the-wrong-reason > SILENT > MISSING, with exact output.**

*WRONG — confident and false (6 classes):*
1. **The DAE pane binds initial values by POSITION and throws away the derivative's name.**
   - `rhs.push(m[2].trim())` at taskpane 11821 discards `m[1]`.
   - The system `x' = u`, `u' = -x - z`, `0 = z`, t ∈ [0, 1]:
     - with initial values `x = 1, u = 0` → `y=[0.5401673170,-0.8412605985]`, which is right (cos 1, −sin 1);
     - the SAME system with `u = 0, x = 1` → `y=[0.000000000,0.3679713917]`.
   - The first equation is silently applied to `u`, giving u′ = u. There is no warning.
2. **"No drift" is certified while the real constraint drifts.**
   - The Cartesian pendulum, reduced by hand to index 1 (`0 = u^2 + v^2 - lam*(x^2+y^2) - 9.81*y`), from (1, 0, 0, 0) over t ∈ [0, 10] with 4000 steps → `x=-0.7336753523 y=0.05011249277`. The output says "Maximum |g| … 1.60e-14 — the constraint is satisfied at every step by construction, so there is no drift to correct" (dae.ts:284, caveat 291).
   - Truth (SciPy): x = 0.2750874626, y = −0.9614192051.
   - x² + y² = **0.5408**: the rod has lost 46% of its length. The bob sits ABOVE the pivot level, and energy has been lost.
   - A SciPy re-run of implicit Euler on the same equations reproduces −0.73367535 / 0.05011249 exactly, so the engine is doing what it says. The certificate is about the differentiated constraint, which is not the one the user meant.
   - This is precisely the failure the file's own header warns about.
3. **Products and connected sums are silently dropped, and the verdict FLIPS.**
   - `does rp^2 # rp^2 bound` → "RP^2 does NOT bound." That is the Klein bottle, which BOUNDS (w₁² = w₂ = 0).
   - `does rp^2 x rp^1 bound` and `does rp^2 x s^1 bound` → "RP^2 does NOT bound." Anything × S¹ bounds.
   - `cobordism of rp^2 x rp^2` → the numbers of ℝP² (degree 2) for a 4-manifold. The verdict is right only by luck.
   - Cause: `dimOf` (advancedQuery) takes the FIRST `rp^n` it sees.
4. **K-theory of a product answers a factor.** `k-theory of s^1 x s^1` and `k-theory s^1 x s^2` → "K^0(S^1) = Z, K^1(S^1) = Z, reduced K^0 = 0". The truth is K⁰ = ℤ², K¹ = ℤ² for both (Künneth; the torus entry already knows the T² case). The cause is the unanchored `sphere` regex (alexander.ts:277).
5. **"Real K-theory" answers complex K.** `real k-theory of s^1` → title "K-theory of S^1", `reduced K^0 = 0`. KO~(S¹) = ℤ/2. Only a caveat line says "This is COMPLEX K-theory".
6. **"over F3" is silently ignored.**
   - `over F3⏎<150 rows>` → `kind: "persistence"`, computed over 𝔽₂. `parsePointCloud` skips any line starting with a letter (persistence.ts:408).
   - The caveat names 𝔽₂, but the request that was dropped is never mentioned.

*Refused for the WRONG reason (5):*
- **Persistence on any realistic sample.** The pane passes no scale (taskpane 29256: `persistentHomology(h.cloud, { maxDim: 1 })`), so `maxScale = diameter` (249).
  - The Klein bottle and torus samples (150 points) and the ℝP² sample (120 points) of §D all build 11 175 / 7 140 edges, hit the cap in dimension 2, and **keep ZERO triangles** (`return { simplices, … }` at 124 discards the partial `next`).
  - H1 is then "NOT RELIABLE", and the headline is an H0 bar.
  - With `maxScale` 2.0 and 0.8 the same engine gets every bar right (§D).
  - Every cloud above ~70 points is affected. The cap message is honest; the scale policy is the defect.
- `x' = 1 - z; y' = z; 0 = x + y - t` → "NOT index 1 — it is index 2 or higher". Not so: g′ = x′ + y′ − 1 = (1 − z) + z − 1 ≡ 0, so z is UNDETERMINED. The system is not solvable at any index. This is the canonical case where structural analysis (Pantelides) succeeds and numerics fail.
- DAE initial values `z = 1/2`, `y = pi` or `y = −1` (U+2212) → "Give at least one initial z value" / "… y value". `parseAssignments` accepts only `-?[\d.]+` and silently drops the rest, then blames the user for omitting what they typed.
- `k-theory of a point`, `k-theory of point` and `k-theory of the torus` → "Not computed for that space". `kTheory` anchors `^(point|pt)$` and `^(torus|t\^?2)$` on a string that still carries "of a"/"of the" (`stripFiller` is never applied here). `k-theory point` works.
- `oriented cobordism of cp2`, `cobordism of cp^2` and `cobordism group omega_5` → "Name a manifold — cobordism is computed here for real projective spaces." A manifold WAS named.

*SILENT (right value, missing context):*
- **Persistence with > 150 points keeps the FIRST 150 rows** (231). For data sorted by any coordinate, that is a different shape (a strip of a torus), reported as "Only the first 150 … were used".
- **Bars alive at a user's `maxScale` get `death: Infinity`** (207) and the figure draws the "essential" arrow. "Never dies" and "not computed past s" are different statements.
- **The DAE pane is titled "(index 1)"**, but the index error suggests "reformulate in an angle". It never offers the reduction this release builds.
- `k-theory of s^65` → generic "not computed", though Bott settles it. The cap is fine, but the reason given is wrong.

*Returns null (the pane says "Couldn't read that as a space"):* `KO of S^1`, `KO(S^1)`, `ko-theory of s^1`, `KO-theory of a point`, `does cp^2 bound`, `signature of cp2`, `pontryagin numbers of cp2`, `does s^2 x s^2 bound`, `does the klein bottle bound`, `stiefel whitney numbers of cp2`, `homology of klein bottle over z/3`, `… with coefficients in F3`, `homology of rp2 mod 2`.

*MISSING:* DAE index ≥ 2 (pendulum, index-2 and index-3 chains) · KO · K(ℝPⁿ) · Ω^SO and Pontryagin/σ · cobordism of products and sums · 𝔽p persistence · 𝔽p simplicial homology.

*RIGHT (pin as twins):*
- `klein bottle` → ℤ, ℤ + ℤ/2, 0.
- `rp2` → ℤ, ℤ/2, 0.
- `does rp^4 bound` → NO; w(ℝP⁴) = 1 + a + a⁴, with w4 = w1⁴ = 1.
- `does rp^5 bound` → YES.
- `k-theory S^2` and `k-theory CP^3`.
- The DAE default `y' = -z; 0 = z - y` → 0.1358762635 at t = 2.
- The pendulum refused by name (dae.test.ts:82–101).
- `persistentHomology(klein150, {maxDim: 1, maxScale: 2})` → (0.590549, 1.828497), (0.82902, 1.865224), (0.745408, 1.025236), equal to Ripser over 𝔽₂.

## B. Inputs, outputs, figures

### B1. DAE index reduction (Analyze → "Differential-algebraic system")

**Input.** The fields are unchanged, but parsing moves to `src/lib/daeParse.ts`, which can be tested (the "taskpane parsers are untestable" lesson):
- `name' = expr` lines are bound BY NAME (reuse `parseOdeSystem`'s rules). `x'' = …` is allowed and reduced to first order.
- Constraints are `0 = …`, `… = 0` or bare.
- Initial values: `name = <expr>`, where `<expr>` is any constant `evalAst` can evaluate (`1/2`, `pi`, `−1`).
- An unknown name, a duplicate, or a value with no equation is a named error. Never silently drop one.
- `λ` and the word `lambda` are rewritten to `lam` before `parseExpr`; the output says so.
- Every variable that has no `'` equation is algebraic. There is no separate "z" list; the old z field becomes "Initial guesses for algebraic variables (optional)".

**Engine** (`src/lib/daeIndex.ts`, new; pure; works on ASTs from `parseExpr`, evaluated with `evalAst`, never `evalFormula`):
1. **Incidence.** For each equation (differential residual `x' − f` and each constraint), record which unknowns appear and at which derivative order (`freeVars`).
2. **Pantelides** (1988, SIAM J. Sci. Stat. Comput. 9:213). Run augmenting-path matching of equations to highest-order derivatives. An unmatched equation set is differentiated (`derivative` along t, using the chain rule over the state); repeat until the matching is complete.
   - The **structural index** is the maximum number of differentiations of any constraint, plus 1 when algebraic variables remain to be solved from the last level. Report the equations that were differentiated and how many times.
3. **Numerical confirmation.** At the consistent initial point, the Jacobian of the final level with respect to the matched highest derivatives must be nonsingular, by the existing `luSolve` pivot test with a scaled threshold.
   - If structure says nonsingular but the numbers say singular → **refuse by name**: "Structural analysis (Pantelides) reports index k, but the differentiated system is numerically singular at t₀: ⟨equation⟩ loses ⟨variable⟩ by cancellation. The structural index is not the true index here, and the system may not determine ⟨variable⟩ at all."
   - The canonical case is `x' = 1 - z; y' = z; 0 = x + y - t`.
4. **Hidden constraints and consistent initialisation.** Every differentiated constraint is a hidden constraint (for the pendulum: x·u + y·v = 0).
   - The initial point is projected onto ALL of them by Gauss–Newton. Today's rule stands: hold the differential states when the user fixed them, and move the algebraic ones. When a hidden constraint forces a differential state to move, it moves and is reported: "u₀ = 1 violates the velocity-level constraint x·u + y·v = 0 (residual 1); moved to u₀ = 0."
5. **Integration.** The reduced system is an ODE in the differential states, with the algebraic ones solved from the last level by Newton at each evaluation. Integrate it with `solveOde` from `ode.ts` (RK45, auto-switching to Rosenbrock), not implicit Euler.
   - **Stabilisation is coordinate PROJECTION by default:** after each accepted step, project onto the original constraint and every hidden one (Gauss–Newton, at most 3 iterations, minimum-norm correction).
   - Baumgarte (`stabilise: baumgarte α β`) is an option. Its α and β are always printed, because they change the answer.
   - SciPy measurement (`ieproj.py`): implicit Euler is unusable for this. Even with projection at 20 000 steps it gives x(10) = −0.035, against the truth 0.2751.
6. **Drift report, always.** For each ORIGINAL and hidden constraint, print max |g| over the run, both before projection (the drift the method would have had) and after. Name the worst one.
   - Example: "Position constraint x² + y² − 1: drift before projection 2.5e-06, after 1.1e-16."
   - Delete the "by construction … no drift" sentence (dae.ts:284, 291) from every path.
7. **Index-1 inputs** keep today's result shape, but go through the same parser and the ode.ts integrator. The implicit-Euler path stays only for stiff index-1 systems whose ODE solve fails. Pin the default example's value as a twin with a new tolerance.

**Output.** Show the index and how it was found. Then the reduced equations, typeset, e.g. `0 = u^2 + v^2 - lam*(x^2 + y^2) - 9.81*y`. Then the hidden constraints, the projection of the initial point, the table, the plot (unchanged builder) and the drift lines.

**Refusals by name:**
- structural index > 5;
- more than 12 unknowns;
- a function `derivative` cannot differentiate (name it);
- the numerically singular case of step 3;
- an inconsistent start that will not project (state the residual).

### B2. Real K-theory KO (Solve topology kind)

**Routing (in `solveTopology`, before the complex branch):** `KO`, `ko-theory`, `real k-theory`, `KO(…)` and `KO^0(…)`. `stripFiller` is applied to the space text for BOTH branches, which fixes the point/torus refusals.

**Computed by Bott periodicity (proved; the table is the theorem):**
- KO^{−q}(pt) for q mod 8 = 0…7 is ℤ, ℤ/2, ℤ/2, 0, ℤ, 0, 0, 0.
- KO~⁰(Sⁿ) = KO^{−n}(pt). The convention is stated in the output.
- KO⁰(Sⁿ) = ℤ ⊕ KO~⁰(Sⁿ).
- No cap on n beyond a display limit of 10⁶ (n mod 8 is all that matters). The complex branch's `n > 64` cap is removed for the same reason.

**Cited, never computed beyond the theorem:**
- KO~⁰(ℝPⁿ) = ℤ/2^φ(n), where φ(n) = #{s : 0 < s ≤ n, s ≡ 0, 1, 2, 4 (mod 8)}; generator L − 1 (Adams 1962, Thm 7.4).
- The complex K~⁰(ℝPⁿ) = ℤ/2^⌊n/2⌋ (Adams 1962). This is added to the complex branch.
- Only KO~⁰ is given for ℝPⁿ. A graded request (`KO^1(RP^3)`, `KO^-2(…)`) is refused by name: "KO^{-q} of ℝPⁿ for q ≠ 0 needs the full Atiyah–Hirzebruch computation; only KO~⁰ is a published closed form."
- KO of ℂPⁿ (Sanderson 1964) is refused, pointing to the citation. It is not built this release.

**Products:** `X x Y` with X, Y spheres goes through Künneth for complex K (torsion-free, so it is exact) and yields K⁰(Sᵃ×Sᵇ). For KO, products are refused by name: "KO Künneth has Tor terms; not computed". A product is NEVER silently reduced to a factor; that is the fix for WRONG #4.

### B3. Oriented cobordism, Pontryagin numbers, signature

**Model the cobordism ring, not one manifold at a time.** In new `src/lib/cobordism.ts`, a manifold expression is parsed to an element:
- **Generators:** `RP^n`, `CP^n`, `HP^n` (n ≤ 4), `S^n`, `T^n`, `klein`, `wu` (SU(3)/SO(3)), `K3` and `pt`.
- **Operations:**
  - `×` multiplies total classes, w(M×N) = w(M)·w(N) and p(M×N) = p(M)·p(N) up to 2-torsion; dimension adds.
  - `#` adds: M#N is cobordant to M ⊔ N, so numbers add. This needs equal dimension, otherwise it is a named error.
  - A leading `-` or the conjugate `CP^2bar` reverses orientation: Pontryagin numbers and σ negate.
- `RP^2 # RP^2` is accepted as the Klein bottle. The output says so.

**Outputs:**
- **Unoriented** (all elements): every SW number (existing `partitions` with `MAX_PARTITION_N = 40`) and the verdict "bounds / does not bound" (Thom: complete).
- **Oriented** (only for orientable inputs, i.e. w₁ = 0; otherwise the output says "not orientable — only unoriented cobordism applies"):
  - Pontryagin numbers for dim ≡ 0 mod 4;
  - the signature by Hirzebruch, σ = ⟨L, [M]⟩, with L₁ = p₁/3, L₂ = (7p₂ − p₁²)/45, L₃ = (62p₃ − 13p₂p₁ + 2p₁³)/945;
  - whether the class is ZERO in Ω^SO_n. It is decided only where Pontryagin and SW numbers are known to be complete (Wall) AND every group in that degree is in the cited table:
    - dims 0–8, where Ω is torsion-free except Ω₅ = ℤ/2, which is detected by the de Rham invariant w₂w₃;
    - beyond that the verdict is refused by name, while the numbers are still printed.
- **Groups:** `oriented cobordism group dimension n` / `Omega^SO_n` → the cited table for n ≤ 8, with generators: ℂP² (n = 4), the Wu manifold (n = 5), ℂP⁴ and ℂP²×ℂP² (n = 8).
  - The rank for any n ≤ 40 is p(n/4) (Thom: Ω⊗ℚ = ℚ[ℂP², ℂP⁴, …]). That is proved and stated as a rank only.
  - For n ≥ 9 the torsion is refused by name UNLESS the builder obtains Wall (1960, Ann. Math. 72:292) or Milnor–Stasheff and confirms the count. My independent derivation (§D) gives ℤ/2², ℤ/2, ℤ/2 for n = 9, 10, 11 (all torsion order 2, Wall).
- **Pontryagin class of `HP^n`** is p = (1 + u)^{2n+2}(1 + 4u)^{−1} (Hirzebruch; Milnor–Stasheff). It is cited, and checked here: for ℍP² it gives p = 1 + 2u + 7u², so p₁² = 4, p₂ = 7 and L₂ = (49 − 4)/45 = 1 = σ. The builder confirms the citation before shipping. Otherwise ℍPⁿ is dropped from the generator list.
- **K3** is cited (p₁ = −48, σ = −16), not computed.

### B4. Persistence over 𝔽p (and 𝔽p simplicial homology)

**Header lines read by a new `parsePersistenceRequest(raw)` in `persistence.ts`.** These are lines starting with a letter that are no longer silently skipped:
- `over F3`, `mod 3`, `coefficients Z/3` and `field 5` set p. `p` must be prime and ≤ 46 337 (so that (p−1)² < 2³¹ keeps exact integer arithmetic in doubles). `Z/4` is refused: "not a field — a barcode needs field coefficients".
- `over Z` is refused by name, with a pointer to comparing 𝔽₂ against 𝔽₃ (§B4 torsion line).
- `scale 2` / `max scale 2` set maxScale. `H2` / `dimension 2` set maxDim = 2.
- `compare` runs p = 2 and p = 3 side by side.
- Any other letter-led line that is not a recognised header is REPORTED ("ignored line: …"), never dropped silently.

**Engine:**
1. **Signed boundary columns**: entry (−1)^i mod p, stored as `Map<row, coeff>`.
2. **Reduction** by c = −a_j/a_{j2} using the modular inverse (Fermat, square-and-multiply on number; no bigint needed under the p cap). For p = 2, today's Set path stays bit-for-bit (pinned).
3. **Scale policy (projected BEFORE building; the "caps before work" lesson):**
   - compute the **enclosing radius** r_enc = minᵢ maxⱼ d(i, j). Above it the Rips complex is a cone and contractible, so no finite bar dies later. Default maxScale = r_enc, not the diameter;
   - project the count of simplices to `topDim` as a function of scale, without allocating (counting triangles from sorted edge lists is O(n³) arithmetic: 3.4 M operations at n = 150), and choose s* = the largest edge length whose count is ≤ 60 000;
   - build exactly that filtration. The cap can then never bite mid-dimension, so the "NOT RELIABLE" path becomes unreachable on this route (it stays as a guard);
   - a bar alive at s* < r_enc is **censored**: `death: null, censoredAt: s*`, drawn with a dashed end labelled "≥ s*", never the essential arrow. Essential (∞) only when s* ≥ r_enc.
4. **More than 150 points → deterministic farthest-point (maxmin) subsample from point 0**, not the first 150 rows. Report the covering radius it achieves, which bounds the bottleneck error. Never `slice(0, 150)`.
5. **The torsion line.** With `compare`, or when p ≠ 2, any H_k bar of persistence > 25% of s* that is present over 𝔽₂ and absent over 𝔽₃ is reported as: "evidence of 2-torsion at this scale (universal coefficients: H_k(𝔽p) = H_k ⊗ 𝔽p ⊕ Tor(H_{k−1}, 𝔽p)) — evidence, not proof; the Rips complex is a proxy."

**𝔽p simplicial homology** (`homology of klein bottle over z/3`, `… mod 2`, `… with coefficients in F3`) is computed by the UNIVERSAL COEFFICIENT THEOREM from the existing integral SNF result: β_k(𝔽p) = β_k + #{torsion of H_k divisible by p} + #{torsion of H_{k−1} divisible by p}. That is the second route for B4's reduction (§D).

**Figure:** `barcodeSvg` gains the censored-bar glyph and an optional second panel (𝔽₂ | 𝔽₃) for `compare`. That is +1 figure-corpus entry (integrator).

## C. Build order, honest limits, disjoint split

**v2.138.0 owns** `taskpane.ts`, `scripts/check-figures.js`, `scripts/figure-layout-run.ts`, `scripts/pane-audit.js` and `docs/TEST-SCRIPT.md`. Builders A–C touch none of them. D starts only after v2.138.0 is committed, and rebases onto it. Cite the pane by anchor: `id: "dae",` and `pr = persistentHomology(h.cloud, { maxDim: 1 });`.

**Day 0 — freeze three APIs:**
- **A:** `parseDaeSystem(eqs: string, init: string, guesses?: string) → {ok, system:{diff:{name, order, rhs: Expr}[], alg: string[], cons: Expr[], init: Record<string, number>}} | {ok:false, error}` and `solveDaeAuto(system, t0, t1, opts) → DaeAutoResult {index, structural: string[], reduced: string[], hidden: string[], projectedInit: string[], t, states: Record<string, number[]>, drift: {constraint, before, after}[], method, steps, caveats, completed}`.
- **B:** `koTheory(space: string) → KTheoryResult | null`, `parseManifold(expr) → CobordismElement | {error}` and `cobordismReport(el) → {title, display, steps, caveats}`.
- **C:** `parsePersistenceRequest(raw) → {cloud, p, maxScale?, maxDim, compare, ignored: string[]} | null`, `persistentHomology(points, {maxDim, maxScale, p})` (with `censoredAt` on pairs and `scaleUsed`, `enclosingRadius`, `subsample?` on the result), and `homologyOverField(h: HomologyResult, p) → {betti: number[], steps}`.

**Order:** A, B and C in parallel → D integrates → an INDEPENDENT adversarial pass (house rule) → §D as the exit test → full QC.

Aim the adversarial pass at:
- name-order permutations;
- `lambda`/`λ`/`e` as variable names;
- index 2 vs 3 with the same incidence;
- a constraint that is singular only along the trajectory;
- p = 46 337 and p = 46 349;
- a cloud of exactly 150 or 151 points;
- ties in the filtration;
- `RP^2 # CP^2` (dimension mismatch);
- `CP^2 # CP^2bar`;
- `KO(RP^0)`;
- `S^0 x S^0`.

| Builder | Owns (creates or edits) | Reads only |
|---|---|---|
| **A — DAE** | `src/lib/dae.ts` (keeps `solveDae` for index 1; delete the false "no drift" text at 284/291 and replace it with the measured drift), `src/lib/daeIndex.ts` (new: incidence, Pantelides, symbolic differentiation via `solve.ts` `derivative`, hidden constraints, consistent init, projection/Baumgarte, drift), `src/lib/daeParse.ts` (new: by-name binding, constant initial values via `evalAst`, `λ`/`lambda` → `lam`); tests `dae.test.ts` (82–101 rewritten BY HAND: the pendulum is now SOLVED; the refusal pins move to the structural-failure and index > 5 cases, with written reasons), `daeIndex.test.ts`, `daeIndex.adversarial.test.ts`, `daeParse.test.ts` (new) | `ode.ts`, `odeParse.ts`, `solve.ts`, `numguard.ts` |
| **B — KO + cobordism + topology routing** | `src/lib/alexander.ts` (`kTheory`: anchored product parse, `stripFiller`, the 64 cap removed, K(ℝPⁿ)), `src/lib/kReal.ts` (new: Bott table, Adams φ(n)), `src/lib/cobordism.ts` (new: manifold expressions, SW and Pontryagin numbers, L-genus, the cited Ω^SO table), `src/lib/topology2.ts` (`realProjectiveCobordism` becomes a thin call into `cobordism.ts`; caveat 435 rewritten), **`src/lib/homology.ts` (sole owner of `solveTopology` routing: the KO branch, the cobordism branch using `parseManifold` instead of `dimOf`, `homologyOverField` queries, and the call to C's `parsePersistenceRequest` in place of `parsePointCloud` at the cloud branch; `TopologyOutcome.persistence` gains `p`, `maxScale`, `maxDim`, `compare`, `ignored`)**; tests `alexander.test.ts` (141 rewritten: "KO is not computed" → the KO pins), `routing.adversarial.test.ts` (118, plus the new phrasings), `topology2.test.ts`, `kReal.test.ts`, `cobordism.test.ts`, `cobordism.adversarial.test.ts` (new) | C's frozen API |
| **C — persistence over 𝔽p** | `src/lib/persistence.ts` (signed 𝔽p reduction, enclosing radius, projected scale, censored bars, maxmin subsample, `parsePersistenceRequest`, `homologyOverField` (it lives here so B only calls it), the `barcodeSvg` censored glyph and compare panel); `persistence.test.ts` (124 rewritten: "𝔽₂" → names the field used), `persistence.adversarial.test.ts` (the 30–45 cap pins kept; add the projected-scale and censoring pins), `persistenceFp.test.ts` (new; builds the §D clouds in TS from the generator formulas) | `homology.ts` types |
| **D — integrator (after v2.138.0)** | `src/taskpane/taskpane.ts` (DAE entry: renamed, calls `parseDaeSystem`/`solveDaeAuto`, prints index, reduced system, hidden constraints and drift; the topology branch passes `p`/`maxScale`/`maxDim`, prints `ignored` and censoring, and runs `compare`); `src/lib/examples.ts`, `src/lib/palettes.ts`; `scripts/figure-layout-run.ts` + `scripts/check-figures.js` (+2: the pendulum DAE plot and the 𝔽₂/𝔽₃ compare barcode; raise the floor by 2 from whatever v2.138.0 leaves); `scripts/pane-audit.js` ratchet if the DAE calculator's field list changes; `docs/TEST-SCRIPT.md`, `FEATURES.md` | all of the above |

`homology.ts` belongs to B alone. C exposes pure functions and never edits routing. `solve.ts` and `ode.ts` are read-only for everyone; any change there goes through a separate request.

**Honest limits (said in the UI):**
- **DAE:**
  - structural index ≤ 5, ≤ 12 unknowns;
  - Pantelides can be fooled by cancellation; the numerical confirmation catches singularity at t₀ only, and a loss of rank later is a Newton failure, reported with t;
  - projection is not energy-conserving, so the drift report is the only accuracy statement besides rtol;
  - no events on algebraic variables;
  - no fully-implicit F(t, y, y′) = 0 except through the `name' = …` plus constraint form.
- **KO:**
  - spheres, the point, and ℝPⁿ in degree 0 only;
  - no products, no ℂPⁿ, no ring structure.
- **Cobordism:**
  - the generator list above;
  - the oriented verdict only for n ≤ 8, with torsion beyond that refused until a published table is confirmed;
  - no spin or complex cobordism;
  - the homeomorphism question remains undecidable and is never claimed.
- **Persistence:**
  - Rips only, Euclidean metric, p prime ≤ 46 337;
  - H0–H2;
  - ≤ 150 points after maxmin subsampling;
  - a bar is evidence at a scale, torsion is evidence by UCT, and neither is proof.

## D. Acceptance audit (independent oracle beside every value)

### D1. DAE (SciPy 1.18.1; L = 1, g = 9.81, start x = 1, y = 0, u = v = 0, λ₀ = 0)
**Reference:** DOP853 at rtol 1e-13 on θ″ = −g sin θ with x = sin θ, y = −cos θ, λ = u² + v² − g·y. The second route is Radau on the Cartesian index-1 reduction; it agrees to ≤ 3e-8 at t = 1 and 10.

| t | x | y | u | v | λ |
|---|---|---|---|---|---|
| 0.5 | 0.3910487916 | −0.9203699488 | −3.9110480040 | −1.6617346075 | 27.0864875927 |
| 1 | −0.9862917511 | −0.1650108531 | −0.2969055159 | 1.7746436411 | 4.8562694075 |
| 2 | 0.7935661953 | −0.6084839304 | 2.1024378744 | 2.7419353930 | 17.9076820730 |
| 10 | 0.2750874626 | −0.9614192051 | −4.1755981010 | −1.1947490546 | 28.2945672061 |

**Pendulum, Cartesian, as typed:**
- `x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = x^2 + y^2 - 1`, initial `x = 1, y = 0, u = 0, v = 0`, t ∈ [0, 10] → **index 3 (structural), constraint differentiated twice**.
- Hidden constraints: `x*u + y*v = 0` and `u^2 + v^2 - lam*(x^2 + y^2) - 9.81*y = 0`.
- Accept: every value in the table within **1e-5 absolute** at rtol 1e-8 (Radau at rtol 1e-6 is already 3e-6 off at t = 10, so 1e-5 is reachable only with a tightened rtol, which must be printed).
- Accept: the period from the first downward zero crossings of u equals 4K(1/2)/√g = **2.3678419476** to 1e-6.
- Drift after projection ≤ 1e-12 for both the position and the velocity constraint.
- The drift BEFORE projection is printed and nonzero.
- **The same system with the initial lines in a different order, or with `λ` for `lam`, gives the identical table** (WRONG #1 twin).

**Inconsistent hidden constraint:** the same system with `u = 1` → "u₀ = 1 violates x·u + y·v = 0 (residual 1)", with u projected to 0 and v kept at 0. The solution then equals the table.

**User-reduced index-1 form** (the WRONG #2 input): it may be solved, but it MUST print "the original constraint x² + y² − 1 is not among the equations; its drift cannot be checked" when the user's constraint is the differentiated one. The "by construction … no drift" text must be gone (grep gate).

**Index 2:** `x' = z; 0 = x - sin(t)`, x = 0 → index 2, z = cos t: z(1) = **0.5403023059**, z(0.5) = 0.8775825619 (closed form), to 1e-8.

**Index 3, linear chain:** `x1' = x2; x2' = z; 0 = x1 - t^3` → index 3, z = 6t: z(1) = **6** to 1e-8, x2(1) = 3.

**Structural failure (must REFUSE by name):** `x' = 1 - z; y' = z; 0 = x + y - t` → the "structurally index 2 but numerically singular" message, naming the cancellation of z. It must not say "index 2 or higher".

**Index-1 twins:**
- `y' = -z; 0 = z - y`, y(1) = e⁻¹ = **0.3678794412** to 1e-8 (today's implicit Euler gives 0.3682470142; the method change is the reason, and is written in the pin);
- y(2) = e⁻² = 0.1353352832.

**Parse twins:** `z = 1/2`, `y = pi`, `y = −1` are accepted. `x = 1, q = 2` with no `q'` equation and no constraint using q → "q has an initial value but no equation".

### D2. KO (Bott; Adams 1962)

| Input | Output |
|---|---|
| `KO of S^1` · `real k-theory of s^1` · `KO(S^1)` | KO~⁰(S¹) = ℤ/2, KO⁰ = ℤ ⊕ ℤ/2 |
| S² · S³ · S⁴ · S⁵ · S⁶ · S⁷ · S⁸ · S⁹ | ℤ/2 · 0 · ℤ · 0 · 0 · 0 · ℤ · ℤ/2 (reduced) |
| `KO of S^1000001` | ℤ/2 (1000001 ≡ 1 mod 8) |
| `KO-theory of a point` | KO⁰ = ℤ; KO^{−q}(pt) for q = 0…7 listed |

KO~⁰(ℝPⁿ) = ℤ/2^φ(n), with φ(n) = 1, 2, 2, 3, 3, 3, 3, 4, 5, 6, 6, 7, 7, 7, 7, 8 for n = 1…16. So:
- ℝP¹ → ℤ/2 (equals S¹, a consistency check);
- ℝP² → ℤ/4; ℝP³ → ℤ/4; ℝP⁴ → ℤ/8; ℝP⁸ → ℤ/16; ℝP⁹ → ℤ/32.
- **Second route:** count the nonzero Atiyah–Hirzebruch E₂ entries H̃^q(ℝPⁿ; KO^{−q}(pt)). The entry is ℤ/2 for q ≡ 1, 2 (mod 8) and for even q ≡ 0, 4 (mod 8) with 0 < q ≤ n, and 0 otherwise.

**Complex:**
- K~⁰(ℝPⁿ) = ℤ/2^⌊n/2⌋: ℝP² → ℤ/2, ℝP⁵ → ℤ/4.
- `k-theory of s^1 x s^1` and `k-theory s^1 x s^2` → K⁰ = ℤ², K¹ = ℤ².
- `k-theory of a point`, `of point` → ℤ, 0. `k-theory of the torus` → ℤ², ℤ².
- `k-theory of s^65` → K~⁰ = 0, K¹ = ℤ.

**Must refuse by name:** `KO^1(RP^3)`, `KO of CP^2`, `KO of s^1 x s^1`.

### D3. Cobordism (nLab/Manifold Atlas table for n ≤ 8; SymPy + signature theorem)
**Ω^SO_n, n = 0…8:** ℤ, 0, 0, 0, ℤ, ℤ/2, 0, 0, ℤ⊕ℤ. Generators: ℂP² for n = 4, the Wu manifold for n = 5, ℂP⁴ and ℂP²×ℂP² for n = 8.
- Rank p(n/4) for n ≡ 0 (mod 4): n = 12 → 3, n = 16 → 5, n = 40 → 42.
- **Held:** for n = 9, 10, 11 my derivation is ℤ/2², ℤ/2, ℤ/2. It counts degree-n monomials in Wall's image Z₂[x_{2k}², x_{2k−1} (2k ≠ 2^j)] minus p(n/4).
- **Disagreement flagged:** the same count gives ℤ/2⁴ at n = 13, against my recollection of ℤ/2³. That is why n ≥ 9 ships only after the builder confirms against a published table.

**Pontryagin numbers and signature.** SymPy from p(ℂPⁿ) = (1 + a²)^{n+1}. Every σ re-derived by L-genus = 1, and ℂP²/ℂP⁴ match Milnor–Stasheff §19.

| Manifold | Pontryagin numbers | σ | Oriented verdict |
|---|---|---|---|
| `CP^2` | p₁ = 3 | 1 | does not bound; generates Ω₄ |
| `CP^2 # CP^2` | p₁ = 6 | 2 | 2·[ℂP²] |
| `CP^2 # CP^2bar` | p₁ = 0 | 0 | BOUNDS (oriented) |
| `S^2 x S^2` | p₁ = 0 | 0 | BOUNDS |
| `CP^4` | p₁² = 25, p₂ = 10 | 1 | — |
| `CP^2 x CP^2` | p₁² = 18, p₂ = 9 | 1 | not cobordant to ℂP⁴ (numbers differ) |
| `HP^2` (cited; ship only if confirmed) | p₁² = 4, p₂ = 7 | 1 | — |
| `CP^6` | p₃ = 35, p₂p₁ = 147, p₁³ = 343 | 1 | numbers only (n = 12) |
| `CP^2 x CP^4` | p₃ = 30, p₂p₁ = 105, p₁³ = 225 | 1 | numbers only |
| `K3` (cited) | p₁ = −48 | −16 | does not bound |
| `wu` | none (n = 5); w₂w₃ = 1 | — | does NOT bound; the generator of Ω₅ = ℤ/2 |

**Unoriented (Thom; hand-checked via w(M×N) = w(M)w(N) and additivity under #):**
- `does rp^2 # rp^2 bound` / `does the klein bottle bound` → **BOUNDS**.
- `does rp^2 x s^1 bound`, `rp^2 x rp^1` → **BOUNDS**.
- `rp^2 x rp^2` → does NOT (w₄ = w₂² = 1, w₁⁴ = 0).
- `does rp^3 x rp^2 bound` → BOUNDS.
- Twins: ℝPⁿ bounds ⇔ n odd, for n = 1…12. `cobordism of cp^2` (unoriented) → does NOT bound (w₂² = 1).
- `RP^2 # CP^2` → "dimension 2 vs 4 — connected sum needs equal dimensions".

### D4. Persistence over 𝔽p (GUDHI 3.13.0 and Ripser 0.6.15, agreeing to 6 dp)
**Clouds** (builders regenerate them in TS; compare to 1e-6). With φ = (1 + √5)/2, uₖ = 2πk/N and vₖ = 2π·frac(kφ), for k = 0…N−1:
- **klein150** (N = 150, a = 2, b = 1): ((a + b cos v) cos u, (a + b cos v) sin u, b sin v cos(u/2), b sin v sin(u/2)).
- **torus150** (N = 150): ((a + b cos v) cos u, (a + b cos v) sin u, b sin v, 0).
- **rp2_120** (n = 120): z = 1 − (k + ½)/n, r = √(1 − z²), θ = 2πk/φ, x = r cos θ, y = r sin θ, point (x² − y², xy, xz, yz).

**Projected scale** (vertices + edges + triangles ≤ 60 000, counted before building):

| Cloud | Diameter | Enclosing radius | s* | Cells at s* |
|---|---|---|---|---|
| klein150 | 5.991464 | 3.994141 | **2.400447** | 59 990 |
| torus150 | 5.992899 | 3.994141 | **2.408707** | 59 981 |
| rp2_120 | 1.973097 | 1.006884 | **0.924311** | 59 988 |

**H1 bars with persistence > 0.25, at s*** (identical at thresholds 2.0 and 0.8, so the today-engine twin holds there):

| Cloud | 𝔽₂ | 𝔽₃ = 𝔽₅ = 𝔽₇ |
|---|---|---|
| klein150 | (0.590549, 1.828497), **(0.82902, 1.865224)**, (0.745408, 1.025236) | (0.590549, 1.828497), (0.745408, 1.025236) |
| torus150 | (0.58951, 1.828628), (0.827, 1.865291), (0.730548, 1.005034) | the same three |
| rp2_120 | **(0.25193, 0.533457)** | none |

- **Total H1 bar counts** (all lengths): 121, 119 and 76, the same for every p. Pin them.
- **The distinction:** the Klein bottle loses exactly one long H1 bar from 𝔽₂ to 𝔽₃ (2-torsion: H₁ = ℤ⊕ℤ/2); the torus loses none; ℝP² loses its only one.
- The torsion line fires for klein150 and rp2_120 and is silent for torus150.
- Today's pane path on these clouds ("NOT RELIABLE", H0 headline) is the before-pin. After the change, the same pasted text with no header must give the 𝔽₂ column above.
- **Do not pin** a 60-point ℝP² set at threshold 1.0: GUDHI and Ripser listed H0 and H1 differently there, and I did not investigate why.

**𝔽p simplicial homology** (UCT on the existing SNF; a second route for the reduction is a test of `reduce` with every simplex at birth 0, whose essential bars must equal these Betti numbers):
- Klein bottle over 𝔽₂: 1, 2, 1; over 𝔽₃: 1, 1, 0.
- ℝP² over 𝔽₂: 1, 1, 1; over 𝔽₃: 1, 0, 0.
- Torus over any p: 1, 2, 1.
- Twin: over ℤ, unchanged.

**Must refuse by name:** `mod 4` (not a field), `over Z` (no barcode), `over F46349` (cap), `over F9` (not prime: "𝔽₉ is a field but not ℤ/9; only prime fields here").

## E. Codebase-specific risks

1. **dae.ts:284 and :291 assert "no drift by construction"** on every run. A grep gate must keep that sentence out of every path, because a reduced system's constraint is not the user's constraint (WRONG #2).
2. **Two expression grammars.** The pane's DAE uses `evalFormula` (stats.ts); Pantelides needs `parseExpr` ASTs (solve.ts:560).
   - Evaluate with `evalAst` from the SAME AST, never one grammar for structure and another for numbers.
   - `pi`, `e` and `lambda` are reserved. `e` as a state name must be refused by name, and `λ`/`lambda` rewritten.
   - Pin today's default example as a twin across the grammar switch.
3. **`freeVars` (solve.ts:675) and `derivative` (739) are recursive.** Repeated differentiation of a long constraint grows the AST quickly: cap AST node count (e.g. 20 000) BEFORE each differentiation and refuse by name (stack-depth lesson: cap depth right after parsing). Simplify with `simplify` (829) between levels.
4. **The `derivative` "No derivative rule" throw** must become a named refusal, not a crash in the pane.
5. **Never import `luSolve`/`isNearlySingular` across files by copy-drift.** A exports them from dae.ts and uses them in daeIndex.ts.
6. **Unbounded loops freeze Word.** The Gauss–Newton projection (≤ 3 iterations per step, ≤ 50 at init), Pantelides (≤ 5 passes and ≤ n augmenting paths per pass), the ODE step budget (`solveOde`'s own) and the farthest-point loop (≤ 150 picks) are each capped BEFORE they start.
7. **persistence.ts:124 discards the partial dimension on truncation.** With the projected scale it should never trigger. Keep it as a guard and keep the adversarial pins 30–45.
8. **The signed boundary.** The 𝔽₂ path never needed signs (156). Over 𝔽p a wrong sign silently gives wrong bars for p ≠ 2. Assert ∂∘∂ = 0 mod p on the built matrix in the test suite (cheap at test sizes).
9. **Modular arithmetic in doubles:** p ≤ 46 337 keeps every product < 2³¹, so `%` is exact even under 32-bit coercion. Fermat inverse by square-and-multiply. A test at p = 46 337 must pass, and p = 46 349 is refused.
10. **`death: Infinity` (207) has two meanings today.** Add `censoredAt` and keep Infinity for essential only. `barcodeSvg` and the pane's "Most persistent" filter (taskpane, `pr.notable`) must treat censored bars as neither finite nor essential.
11. **SNF re-pivot lesson.** `homologyOverField` reads `HomologyResult.torsion` only; it never re-runs a reduction. If any builder needs SNF again, reuse `smithNormalForm` (homology.ts:143), which re-pivots every pass. Never write a second one.
12. **Routing order in `solveTopology`.**
    - The KO test must come BEFORE `/k[- ]?theory/` (497); "real k-theory" contains it.
    - The cobordism branch (`/\b(cobord|bound)/` in `advancedQuery`) must also catch `signature`, `pontryagin` and `omega`.
    - The `BEYOND` loop's `probe = key.split(" ")[0]` matches any query containing "stable" or "spectral". New phrasings must not contain those words.
    - The cloud branch runs FIRST (`/[\n;]/` without `[`), so header lines must be parsed there, by C's function.
13. **`sphere` regex (alexander.ts:277) is unanchored.** A product must be detected (`x`, `×`, `*` between spaces) before any single-space regex runs. The same applies to `dimOf` in `advancedQuery`.
14. **Test pins that flip, each rewritten BY HAND with its reason (never `jest -u`):**
    - dae.test.ts:82–101 (the pendulum is now solved);
    - alexander.test.ts:141 ("KO is not computed");
    - persistence.test.ts:124 (/𝔽₂|F2/ → the field used);
    - topology2.ts:435 (the caveat) and its tests;
    - routing.adversarial.test.ts:118 (bare cobordism text).
15. **The pane's DAE field set changes.** The z list becomes optional guesses. `scripts/pane-audit.js` and the figure corpus must be updated by D in the same commit as the pane, or the ratchet fails.
16. **Mac WKWebView.** No regex lookbehind in `taskpane.ts` (0 hits today). New header parsing lives in `persistence.ts`/`daeParse.ts`, but the rule applies there too, because they are bundled into the pane.
17. **Citations are part of the output.** Each cited value (Adams φ(n), the Ω^SO table, K3, ℍP²) carries its reference in `caveats`, the same standard as `stableStem`. A value the builder cannot source is refused, not shipped.
