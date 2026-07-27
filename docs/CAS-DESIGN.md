# Solve: a CAS core — design and build order

_Written 2026-07-26, at v2.4.1. This is the brief for the next session; it exists
so that work can start on the first line of code rather than re-deriving what is
already known._

> **STATUS (2026-07-26, v2.5.0): Release 1 SHIPPED** — `src/lib/cas.ts` (canonical
> rational functions over atoms, exact BigInt rationals), `simplify()` switched
> over with the peephole as totality fallback, symbolic rearrangement with ≠ 0
> conditions and back-substitution verification, pane "solve for …" chips,
> readable derivatives. §1's table rows all pass (pinned in
> `src/lib/__tests__/cas.test.ts`). Release 2 (symbolic integration) is NOT
> started; §5.1 (typeset insertion) remains open.

**Decision (user, 2026-07-26):** make Solve dramatically more capable, starting
with a **CAS core plus symbolic rearrangement** — chosen over three alternatives
(Word-native typeset output, breadth of problem types, natural-language word
problems) because it is the bottleneck the others sit behind.

---

## 1. Where the ceiling actually is

Measured, not assumed. Probed against the shipping `src/lib/solve.ts` (912 lines):

| Input | What it does today | What it should do |
|---|---|---|
| `2*x + 3*x` | `2*x + 3*x` (unchanged) | `5x` |
| `x + x` | `x + x` (unchanged) | `2x` |
| `x/x` | `x/x` (unchanged) | `1` |
| `(x+1)*(x+1)` | unchanged | `x² + 2x + 1` |
| `F = m*a`, solve for `a` | **empty root list** | `a = F/m` |
| `d/dx sin(x)cos(x)` | `cos(x)*cos(x) + -sin(x)*sin(x)` | `cos²(x) − sin²(x)` |
| `∫x·eˣ dx` | numeric only (definite) | `eˣ(x − 1) + C` |
| `2x + y = 5` | `method: "unsolved"` | a system, or solve for one var |

Three conclusions:

1. **`simplify()` is a local peephole.** It folds constants and strips `+0`/`*1`
   but has no canonical form, so it cannot collect like terms, cancel, expand or
   factor. Everything else is blocked behind this.
2. **Symbolic rearrangement does not exist**, even when the variable is named
   explicitly. `solveEquation("F = m*a", "a")` returns `[]`. This is the single
   most common thing an engineer asks a solver for.
3. Derivatives are **correct but unreadable**, and the `+ -` is the tell.

## 2. The design

### 2.1 Canonical form

Normalise every expression to a **rational function over atoms**.

- An **atom** is a variable (`x`, `m`, `F`) or an opaque non-polynomial
  subexpression (`sin(x)`, `e^x`, `x^y`, `x^0.5`). Atoms are keyed by the
  canonical string of their own normalised form, so `sin(x+0)` and `sin(x)` are
  the same atom. Keep `Map<atomKey, Expr>` to rebuild readable output.
- A **monomial** is a rational coefficient (`{n, d}`, `d > 0`, reduced) times a
  `Map<atomKey, integer exponent>`.
- A **polynomial** is a list of monomials: canonically sorted, like terms merged,
  zero coefficients dropped.
- An **expression** is `{ num: Poly, den: Poly }` with common factors cancelled.

Rational coefficients rather than floats: `1/3 + 1/3 + 1/3` must be exactly `1`,
and float coefficients make canonical equality unreliable — two equal expressions
would compare unequal at the 15th digit.

Non-integer and symbolic exponents are **atoms**, not polynomial powers. That
keeps the representation total: anything that does not fit becomes opaque rather
than throwing.

### 2.2 Operations it unlocks

- `expand`, `collect`, `cancel` — fall out of normalisation directly.
- **Structural equality** — two expressions are equal iff their canonical forms
  match. This is what lets the solver **verify its own answers**, which nothing
  in Solve currently does.
- `factor` — polynomial factoring over the rationals (rational-root search plus
  quadratic factoring covers almost everything a user types).

### 2.3 Symbolic rearrangement

Normalise `lhs − rhs` as a rational function in the target variable `x`:

- **Linear in x**: `a·x + b = 0` → `x = −b/a`, where `a` and `b` are expressions
  in the remaining symbols. Covers `F = ma`, `V = IR`, `PV = nRT`, `C = 5/9(F−32)`.
- **Quadratic in x**: the quadratic formula symbolically, with `sqrt` of an
  expression.
- **Higher / transcendental**: fall back to the existing numeric path, unchanged.

Every division introduces an assumption. `a = F/m` **requires `m ≠ 0`** and the
caveat must say so — consistent with how the rest of the product states its
conditions rather than hiding them.

## 3. Build order

**Release 1 — the core.** `cas.ts` as a NEW module, `simplify` switched over,
readable derivatives, symbolic rearrangement. Testable against exact answers:
an expression either normalises to the expected canonical form or it does not.

**Release 2 — symbolic integration.** Substitution, by parts, partial fractions.
Deliberately second: partial fractions needs polynomial division and factoring,
which do not exist until Release 1 lands. Correctness net is different too —
**every antiderivative must be checked by differentiating it back** and comparing
canonical forms, which is only possible once equality works.

**Later, in no fixed order** — these were the other three directions and remain
open: systems of equations (linear exactly via `linalg.ts`, nonlinear by Newton),
inequalities, limits, series/Taylor, symbolic ODEs; Word-native typeset
derivations (see §5); units-aware solving.

## 4. Constraints and risks

- **`solve.ts` backs four live operations** (solve, differentiate, integrate,
  word problems) and is reachable from the pane. Build `cas.ts` standalone with
  its own tests, and switch `simplify()` over **only once it reproduces every
  existing result**. The existing `solve.test.ts` suite is the regression net —
  it must stay green without being edited to accommodate the new engine. If a
  test needs changing, that is a behaviour change and needs justifying, not
  accommodating.
- **Do not float-normalise.** Use exact rationals throughout the coefficient
  arithmetic.
- **Canonical form must be total.** Anything unrepresentable becomes an opaque
  atom; nothing throws.
- **Performance**: Solve recomputes on every keystroke. Normalisation is cheap,
  but factoring is not — do not factor on the live path unless asked.

## 5. Two cheap wins noticed while probing, not yet done

1. **Solve inserts PLAIN TEXT.** `solveInsertBtn` calls `insertPlainText`, even
   though the pane already renders typeset reasoning (`WorkStep.math`) and the
   product has a complete OMML engine driving Math mode. The derivation is
   typeset on screen and arrives in the document as flat ASCII. Inserting it as
   real, editable Word equations is a small change with a large effect, and it is
   the thing no competitor outside Word can copy.
2. **`solve-input` is a 1-row textarea.** Fine for `x^2-4=0`, cramped for a word
   problem. (Partially addressed earlier — confirm current state before redoing.)

## 6. Test strategy

- **Canonical form**: equal expressions must produce identical canonical forms;
  unequal ones must not. Property-style checks over generated expressions are
  worth more here than a handful of examples.
- **Rearrangement**: substitute the answer back into the original equation and
  require it to normalise to `0`. That is a real verification, not a restatement
  of the algebra.
- **Derivatives**: unchanged values, improved readability — compare numerically
  against the existing implementation at sample points so the refactor cannot
  silently change a result.
- **Regression**: `solve.test.ts` green, unedited.

## 7. Known state at handoff

v2.4.1 live. 119 test files, 3,490 tests, QC 9/9 (`npm run qc`).
The 2026-07-26 evaluation is fully closed; this is new work.

**Still outstanding and not code:** the in-Word manual pass
(`docs/TEST-SCRIPT.md`, §0a) has not been run for any release since v1.89.0.
