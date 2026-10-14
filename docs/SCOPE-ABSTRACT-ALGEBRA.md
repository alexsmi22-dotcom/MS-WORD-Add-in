# Scope — Solve domain: abstract algebra (finite groups, ℤ/n, 𝔽p[x], GF(pᵏ))

_Written 2026-10-14 at v2.132.0, from a read-only audit of the discrete-math kind (its six
engines and their tie-breaks), the number-theory engine, the exact-rational CAS, the graph
figure builder, and the equation-kind routing, plus a 110-input probe driven through BOTH
pipelines the pane calls — the equation kind's lib-level chain (foldPastedMath → transform-
verb guard → derivative/limit switches → tryStatsIntent → trySum → the verb chain →
word-problem switch → solveInequality → solveWithUnits/solveSystem → solveEquation/
extractSingleEquation, mirrored from taskpane.ts 27672–28010) and `solveDiscrete` (the
Discrete math kind, taskpane 28655). The probe file was deleted; its findings are in §A.
Audit-first, per the house method: wrong answers first. The acceptance inputs in §D are the
release's exit test. Planned as v2.134.0._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each verified by reading):**
- `numtheory.ts` — `gcd`, `egcd`, `mod`, `modPow`, `modInverse`, `isPrime` (deterministic
  Miller–Rabin below `MR_DETERMINISTIC_BOUND`), `factorize`, `totientFrom`, `divisorsFrom`,
  `multiplicativeOrder(a, m)` (256), `sqrtMod`, `jacobi`: every integer primitive the ring
  verbs need, BigInt, exported. `tryNumberTheory` (694) lower-cases and STRIPS PARENTHESES
  (703: `.replace(/[()]/g, " ")`) before matching — `U(8)` becomes `u 8`, `(1 2 3)(4 5)`
  becomes `1 2 3 4 5`; nothing matches, so today they fall through harmlessly, but any
  algebra engine placed AFTER it inherits nothing and must parse the raw text itself. It
  owns, correctly: `order of 3 mod 7` (761), `primitive roots mod 10` (763), `inverse 5 mod
  12` (730), `7^100 mod 13` (726), `3^-1 mod 7`, `x^2 = 2 mod 7` (767), `5 ≡ 2 (mod 3)`
  statements (710), bare `a mod m` (749). It does NOT claim an expression with an operator
  before `mod` (`7 * 9 mod 12`, `7 + 9 mod 12`, `3 * 5 = 1 mod 7`) — that is the boundary.
- `discrete.ts` — `DiscreteResult {title, display, steps, caveats, svg?, alt?}` (the pane
  renders `dr.svg` at 28677 and prints a `DiscreteError` message as the answer at 28661);
  `ENGINES` (59–66) is the tie-break order, pinned verbatim in `discrete.test.ts:36`;
  `foldSuperscripts` (43) folds ⁰–⁹ and ⁻ on input — there is NO subscript fold (ℤ₆, 𝔽₉);
  `lambda.ts:115` has the only `SUBSCRIPT_DIGITS` table in the product. The discrete kind
  receives the input UNFOLDED (taskpane 27672: no `foldPastedMath` for `discrete`/`lambda`),
  so cycle notation, `×`, `≅`, `⟨3⟩` and `ℤ/6ℤ` arrive as typed — the right home.
- `combinatorics.ts:783` — `d\s*\(?\s*(\d+)\s*\)?` on the LOWER-CASED text claims `D4` as the
  derangement number: "D(4) = !4 = 9" (probe, below). `permutations(n, k)` is P(n, k) only;
  there is no permutation OBJECT, no cycle notation, no composition anywhere in the product.
- `proplogic.ts` ~309–314 — claims any line with `->` or `^` (`kernel of x -> 2x …` → '"2x"
  is not a propositional variable'; `minimal polynomial of a^3 in GF(8)` → '"^" is
  ambiguous (AND in some books, XOR in others)').
- `cas.ts` — `Rat` (926–944), `parseRatLiteral`, `polyInVar(expr, x) → Rat[]` (1016: an
  `Expr` to a coefficient list — the 𝔽p[x] reader is this plus a reduction mod p),
  `ratPolyAdd/Scale/Mul/Trim/Eval/DivMod` (1030–1077), `ratPolyToExpr`. **Second, unrelated
  `class Rat` in `recurrence.ts`** — never import that one. `exact.ts` `constantRat`.
  `solve.ts` `parseExpr` (`ID_RE` 145: `[A-Za-z_][A-Za-z0-9_]*`, so `Z_6`, `S3`, `F_2`,
  `D4` are all plain variable names; `U(8)` is 'Unknown function "U"' → "Couldn't parse").
- `systems.ts` `rref(Rat[][])` (161) — exact; not needed by the groups engine, but the CRT
  isomorphism and homomorphism-image checks can be stated through it.
- `algebraTools.ts` — `tryAlgebraVerb` (421) claims `^(factor|expand|simplify)\b` and, when
  the body has prose words, runs `extractExpression(body)` — on `factor x^2 + 1 over F_2`
  that extracts **`F_2`** and the verb prints `F_2` as the factorisation (probe). Private
  `polyString(coeffs, x)`: export it for 𝔽p[x] printing rather than copy it.
- `graphs.ts` — `Graph` (48), `parseGraph` (133; `EDGE_RE` 87 needs `-`/`->`, so no algebra
  input is an edge list), `graphSvg(g, {caption, highlightEdges, highlightVerts, hollowVerts,
  edgeLabels})` (1081): a DETERMINISTIC CIRCULAR layout (1085–1100), directed arrows, self-
  loops, per-edge labels. The cycle diagram of a permutation is this for free (vertex i →
  σ(i), fixed points as self-loops). A Hasse diagram is NOT: it needs layers by subgroup
  order — a `layers?: number[]` option on `FigureOptions` that replaces the ring with rows
  is the smallest change (the label/edge code is reused as is).
- `heatmap.ts` `buildHeatmapSvg(chart: TableChart, …)` (81) — numeric cells only (`cellLabel`
  formats numbers); a Cayley table of `(1 2 3)` entries cannot go through it. `chartPalette.ts`
  `SEQUENTIAL_BLUE`, `SEQUENTIAL_GREY`, `inkOn(hex)` (contrast ink) are the right fills for an
  own grid builder. `statchart.ts` has bars/box/forest only.
- Routing tests on the pane source: `lpRouting.test.ts` (reads `taskpane.ts`, asserts the
  import, the chain order and that the guard is decided on the RAW input) is the template;
  `discrete.test.ts:30–36` pins the engine tie-breaks; `scripts/figure-layout-run.ts`
  verb/discrete figures block ~1615–1645 and `check-figures.js` `CORPUS_FLOOR = 183` (74).
- `pasteMath.ts:126` — the equation-kind fold turns `ℤ` into the note "ℤ is a number set, not
  a variable" and `×` into multiplication (`Z/2 × Z/4` solved as a quadratic in Z).

**Missing (everything below is new):**
- No group object of any kind: no ℤ/n, U(n), Sₙ, Dₙ, products, Cayley-table reader; no
  element order, subgroup, coset, normality, quotient, centre, conjugacy, isomorphism verb.
- No permutation object: no cycle-notation parser/printer, composition, inverse, sign.
- No ring verbs: `7 * 9 mod 12`, units, zero divisors, "is ℤ/7 a field", linear/quadratic
  congruences typed `in Z/7` (number theory has them only in its own `3x = 2 mod 7` form).
- No 𝔽p[x]: no reduction, product, Euclid, irreducibility, factoring; no GF(pᵏ), primitive
  element, minimal polynomial. `factor` is rational-root factoring over ℚ only (540–575).
- No grid (table) SVG builder with text cells; no layered (Hasse) graph layout; no subscript
  fold in the discrete kind.

**Probe (110 inputs: 60 groups/permutations/homomorphisms, 50 rings/polynomials/fields,
each through BOTH kinds). Ranked wrong > silent > missing; exact text.**

- **Handled correctly: 6 of 110 — all number theory in the Discrete kind, none algebra:**
  `order of 3 mod 7` → "ord_7(3) = 6 · 3 is a primitive root mod 7"; `primitive roots mod
  10` → "3 … All primitive roots: 3, 7"; `inverse 5 mod 12` → "5⁻¹ ≡ 5 (mod 12)"; `7^100 mod
  13` → "7¹⁰⁰ ≡ 9 (mod 13)"; `3^-1 mod 7` → "3⁻¹ ≡ 5 (mod 7)"; `x^2 = 2 mod 7` → "x ≡ 3 or 4
  (mod 7)". The same six typed in the EQUATION kind (the default) are all WRONG: "mod = 0".
- **Handled WRONG — a confident answer to a different question: 24.**
  - `mod` read as a variable (6): `7 * 9 mod 12` and `7*9 mod 12` → "Solve for mod · mod = 0
    · Polynomial form: 756·mod^1 + 0·mod^0 = 0" (answer 3); `7 + 9 mod 12` → "mod = −7/108";
    `3 * 5 = 1 mod 7` → "mod = 15/7"; `7^100 mod 13` → "mod = 0 · 4.20481946251e+85·mod^1";
    `3^-1 mod 7` → "mod = 0".
  - Group names solved as unknowns (8): `Z/6` → "Z = 0 · 0.166666666667·Z^1 + 0·Z^0 = 0";
    `Z_6` → "Z_6 = 0"; `Z6` → "Z6 = 0"; `S3` → "S3 = 0"; `S_3` → "S_3 = 0"; `D4` → "D4 = 0";
    `D_8` → "D_8 = 0"; `Z/2 × Z/4` → "Z = 0 · Method: exact (quadratic) · 0.125·Z^2 … = 0".
  - `factor x^2 + 1 over F_2` → heading "factor x^2 + 1 over F_2", answer line **"F_2"** (the
    factorisation of x² + 1 over 𝔽₂ is (x + 1)²); identical for `x^4 + x + 1` (irreducible),
    `x^3 + x + 1` (irreducible), `x^4 + x^2 + 1` ((x² + x + 1)²) — 4.
  - The `name = number` steal (3): `sigma = (1 2 3), tau = (1 2), sigma * tau` → "Read the
    equation out of the sentence: sigma = (1 2 3) · sigma = 6" (1·2·3); `a^2 = e, b^3 = e` →
    "a = 1.6487212707; a = −1.6487212707 · Quadratic a=1, b=0, c=−2.71828182846" (e read
    as Euler's number); `is f(x) = 2x a homomorphism from Z/4 to Z/8` → "x = y/2/
    (a*homomorphism) · Read “f(x) = …” as a function DEFINITION".
  - `permutation 2 3 1` → "permutation = 0 · 6·permutation^1 + 0·permutation^0 = 0".
  - Discrete kind (1): `D4` → "Combinatorics · D(4) = !4 = 9" (derangements, not the dihedral
    group); the equation kind's "D4 = 0" for the same input is counted above.
  - Not counted as wrong but worth knowing: `factor x^2 + 1` → "x^2 + 1 · No RATIONAL roots
    exist" — right over ℚ, and the only reading the product has.
- **Refused for the WRONG reason, no number: 9.** `cosets of <3> in Z/12` → "A chained
  inequality must run one way (a < f < b or a > f > b) — "<" then ">" mixes directions"
  (the ⟨3⟩ brackets); `<4> in Z/12`, `quotient Z/12 / <4>`, `Z/12 / <4>`, `kernel of x -> 2x
  from Z/6 to Z/6` → "Inequalities are solved exactly for POLYNOMIAL and RATIONAL expressions
  in one variable … nothing is reported rather than guessed" (4); `lagrange: subgroups of
  order 4 in Z/12` → the INTERPOLATION usage refusal "Give the points to interpolate:
  `interpolate (1, 2), (2, 3), (4, 7)` …" (`INTERP_VERB_RE` matches `lagrange`); Discrete
  kind: `kernel of x -> 2x …` → '"2x" is not a propositional variable (only the constants 0
  and 1 are read as truth values)'; `minimal polynomial of a^3 in GF(8)` → '"^" is ambiguous
  (AND in some books, XOR in others) — write & for and, xor for exclusive or'.
- **Words read as unknowns ("This has more than one unknown (…) — choose which one to solve
  for:"): 41.** `cayley table of Z/6` → "(cayley, table, of, Z)"; `order of 2 in Z/6` →
  "(order, of, in, Z)"; `orders of all elements of Z/12`; `subgroups of Z/12` → "(subgroups,
  of, Z)"; `subgroup lattice of Z/12`; `all subgroups of S3`; `generators of Z/12`; `center of
  D4` → "(center, of, D4)"; `conjugacy classes of S3`/`S4`; `is A3 normal in S3` → "(is, A3,
  normal, in, S3)"; `is D4 abelian`; `compose (1 2 3) and (1 2)` → "(compose, and)"; `inverse
  of (1 2 3 4)` → "(inverse, of)"; `sign of (1 2 3)(4 5)`; `parity of (1 2)(3 4)`; `cycle type
  of …`; `cycle diagram of (1 2 3 4 5 6)`; `order of (1 2 3)(4 5)` → "(order, of)"; `a * b =
  e` → "(a, b)"; the 3-line Cayley table → "(group, with, cayley, table, a, b)"; `7 * 9 in
  Z/12` → "(in, Z)"; `inverse of 5 in Z/12`; `inverse of 3 in Z/7`; `5^-1 in Z/12`; `units of
  Z/12`; `zero divisors of Z/12`; `is 5 a unit in Z/12`; `solve 3x = 2 in Z/7` → "(solve, x,
  in, Z)"; `x^2 + 1 = 0 in Z/5` → "(x, in, Z)"; `x^2 + 1 = 0 mod 3`, `x^2 + 1 mod 3`, `(x^2 +
  1)(x + 2) mod 3` → "(x, mod)"; `(x^2 + 1)(x + 2) over F_3` → "(x, over, F_3)"; `is x^2 + 1
  irreducible over F_3`/`F_2` → "(is, x, irreducible, over, F_3)"; `x^2 + x + 1 = 0 in F_2`;
  `gcd of x^3 + 1 and x^2 + 1 over F_2`; `irreducible polynomials of degree 2 over F_2`;
  `F_4 multiplication table`; `elements of order 2 in D4`; `find all groups of order 6`;
  `S_3 x Z/2` → "(S_3, x, Z)"; `multiplication table of Z/5`; `integers mod 6`; `group Z/6`;
  `klein four group`; `primitive roots mod 10` (equation kind).
- **"Couldn't parse that equation. Try e.g. x^2 - 5x + 6 = 0.": 30** — `ℤ/6ℤ` (with the fold
  note "ℤ is a number set, not a variable"), `Z/6Z`, `Sym(3)`, `U(8)`, `U(10)`, `U(12)`,
  `aut(Z/8)`, `GF(9)`, `GF(4)`, `Z/2 x Z/3`, `Z/6 x Z/4`, `cayley table of U(8)`, `is Z/6
  cyclic`, `is U(8) cyclic?` ("Trailing sentence punctuation was ignored"), `is U(10) cyclic`,
  `generators of U(10)`, `is 3 a generator of U(10)`, `order of 5 in U(12)`, `left cosets of
  {e, (1 2)} in S3`, `is {e, (1 2)} normal in S3`, `is Z/8 isomorphic to Z/2 x Z/4`, `is (Z/8,
  +) ≅ (Z/2 × Z/4, +)?`, `is Z/2 x Z/3 isomorphic to Z/6`, `Z/6 ≅ Z/2 × Z/3`, `isomorphism
  type of U(8)`, `is Z/2 x Z/2 abelian`, `(1 2 3)(4 5)`, `(1 2 3) * (1 2)`, `(1 2 3)(1 2)`,
  `[2 3 1]`, `in Z/12: 7 + 9`, `is Z/7 a field`, `is Z/6 a field`, `extended euclid x^3 + x +
  1, x^2 + 1 over F_2`, `F_9 = F_3[x]/(x^2 + 1)`, `primitive element of GF(9)`, `elements of
  GF(8)`, `chinese remainder Z/6 ≅ Z/2 × Z/3`. Discrete kind: "Not recognised" for 101 of 110.
- **Missing engine: 110 of 110.** Nothing in the product answers any algebra question.

## B. Syntax and output

**Home: the Discrete math kind**, as a seventh engine `tryAlgebra` (`src/lib/algebra.ts`)
registered FIRST in `ENGINES` (discrete.ts 59) — first because combinatorics would take
`D4` and proplogic would take every `->`/`^` line, and because the number-theory boundary
is cleanest as a stand-aside list inside the algebra guard rather than the other way round.
The discrete kind is the right home: no paste fold (cycle notation, `×`, `≅`, `⟨⟩`, `ℤ/6ℤ`
arrive intact), `DiscreteResult.svg` already renders, `DiscreteError` already prints
refusals, and the number-theory neighbour lives there. **Plus an equation-kind switch**:
the default kind is `equation`, and every probe line typed there is wrong or silent today.
At taskpane ~27764 (before the derivative switch, after `transformVerb`), when
`ALGEBRA_RE.test(solveInput.value)` (RAW input — the fold has already turned `×` into `*`
and `ℤ` into a note) and `tryAlgebra(solveInput.value.trim())` is non-null: set
`solveKind.value = "discrete"`, `updateSolveUi()`, `updateSolve()`, insert "The question is
ABSTRACT ALGEBRA — switched to the Discrete math kind and answered." (the derivative/limit/
word-problem switch pattern, 27770–27779). The same switch should cover number theory
(`7^100 mod 13` is "mod = 0" in the equation kind today): fire when `/\bmod\s+\d+\s*$/`
matches and `solveDiscrete` returns a recognised result. Pinned in `algebraRouting.test.ts`
against the pane source and `discrete.test.ts:36` (new expected order).

**Readers (all in `src/lib/algebra.ts`, shared by every verb):**
- Group names: `(?:ℤ|Z)\s*/\s*(\d+)\s*(?:ℤ|Z)?` (`Z/6`, `Z/6Z`, `ℤ/6ℤ`), `(?:ℤ|Z)_?(\d+)`
  (`Z_6`, `Z6`, `ℤ₆` after a subscript fold), `integers\s+mod(?:ulo)?\s+(\d+)`, `U\s*\(\s*(\d+)
  \s*\)` (also `(Z/n)^*`, `(Z/n)*`, `units of Z/n` as a group), `(?:S|Sym)_?\s*\(?\s*(\d+)\s*\)?`,
  `A_?(\d+)`, `D_?(\d+)`, `Q_?8`, `V_?4|klein(?:\s+four)?(?:[-\s]group)?`, products joined by
  `\s*(?:x|×|⊕|\*)\s*` (`Z/2 x Z/3`, `S_3 × Z/2`), `GF\((\d+)\)` / `F_(\d+)` / `𝔽_?(\d+)` as
  the additive or multiplicative group when a group verb asks. **Dₙ convention:** `D4` and
  `D_4` are the dihedral group of the SQUARE (order 8, the Gallian/Dummit & Foote index =
  n-gon); `D_8` is read the same way ONLY when the verb mentions "order 8"/"of the square";
  otherwise `D_8` is the dihedral group of the octagon (order 16) and the output says
  "D_8 read as the symmetries of the octagon (order 16); for the square write D4 or D_4 — the
  two conventions differ". Uppercase `D4` is dihedral; `d4`, `D(4)`, `derangements 4` stay
  derangements — said in a caveat when `D4` is answered. A Cayley-table block (first line
  `group with cayley table` / `cayley table:` / a bare square grid of ≥ 2 rows whose header
  row and column agree) is read as the group it defines after the axioms are checked.
- Permutations: cycle notation `(1 2 3)(4 5)`, `(1,2,3)(4,5)`, `(1 2 3) * (1 2)`, `(1 2 3) ∘
  (1 2)`; digits with no separator inside a cycle (`(12)(34)`) are read ONE DIGIT PER POINT
  and the output says so ("(12) read as the transposition of 1 and 2; for points ≥ 10 write
  spaces or commas"); one-line `permutation 2 3 1`, `[2 3 1]`, two-row `1 2 3 / 2 3 1`; `e`,
  `id`, `()` the identity. Composition RIGHT-TO-LEFT (functions: `(1 2 3)(1 2)` applies
  `(1 2)` first = (1 3)), stated in every composition's text, with `left to right` in the
  input switching it — and when the two readings differ, the other is printed as a note.
- Subgroups: `<g>`, `⟨g⟩`, `<g, h>`, `{e, (1 2)}`, `{0, 3, 6, 9}`, `A3`/`A_n` inside S_n,
  `the rotations` in D_n, `center`, `<r^2>` in D_n (`r`, `s`, `r^k s` names), `(a, b)` pairs in
  products.
- Polynomials over 𝔽p: `… mod p`, `… over F_p|𝔽_p|𝔽p|GF(p)|Z/p|Z_p|F p`, `in F_p[x]`; coefficients
  through `parseExpr` → `polyInVar` (cas.ts 1016) then reduced mod p; variable x (or the single
  free symbol); `(x^2 + 1)(x + 2) mod 3` is a POLYNOMIAL product because a free symbol is
  present — integer `mod` lines (no symbol) stay with number theory.
- Finite fields: `GF(9)`, `F_9`, `𝔽₉`, `GF(3^2)`, `F_9 = F_3[x]/(x^2 + 1)`, `GF(8) with a^3 =
  a + 1`, `GF(2^3) modulo x^3 + x + 1`; without a modulus the engine picks the first
  irreducible monic in degree order (Conway-free: lexicographic, SAID: "constructed as
  𝔽₃[x]/(x² + 1) — the first irreducible monic of degree 2; say `F_9 = F_3[x]/(x^2 + x + 2)`
  to choose another; the field is unique up to isomorphism, the element names are not").
- Subscript fold (new `foldSubscripts` next to `foldSuperscripts` in discrete.ts): ₀–₉ → `_d`
  so `ℤ₁₂`, `𝔽₉`, `S₃` read back — the display contract for the discrete kind.

**Guards (sketches; the routing test pins every §D input and every stand-aside):**
- `GROUP_RE = /(?:ℤ|\bZ)\s*\/\s*\d+|(?:ℤ|\bZ)_?\d+\b|\bintegers\s+mod(?:ulo)?\s+\d+|\bU\s*\(\s*\d+\s*\)|\b(?:S|Sym|A|D)_?\s*\(?\s*\d+\s*\)?(?![.\d])|\bQ_?8\b|\bV_?4\b|\bklein\b|\bGF\s*\(|\b(?:F|𝔽)_?\d+\b/`
- `ALGEBRA_RE = new RegExp(String.raw`^(?!\s*(?:(?:order|ord|inverse|inv|modular inverse|primitive roots?|generators?)\s+(?:of\s+)?\d+\s+mod\b|\d+\s*(?:\^|\*\*)\s*-?\d+\s*mod\b|\d+\s+mod\s+\d+\s*$|x\s*\^\s*2\s*=\s*-?\d+\s*mod\b|\d+\s*=\s*\d+\s*mod\b))(?:[\s\S]*(?:${GROUP_RE.source})|\s*(?:cayley|multiplication\s+table|subgroups?|cosets?|normal\b|quotient|cent(?:er|re)|conjugacy|isomorphi|≅|homomorphism|kernel|image\s+of|generators?\s+of|cyclic|abelian|orders?\s+of|elements\s+of\s+order|permutation|cycle\s+(?:type|diagram|structure)|sign\s+of|parity\s+of|compose|inverse\s+of\s+\(|units\s+of|zero\s+divisors|field\b|irreducible|minimal\s+polynomial|primitive\s+element|extended\s+euclid|gcd\s+of\s+[^\n]*[a-z]\s*\^)|\s*\(\s*\d+(?:[\s,]+\d+)*\s*\)(?:\s*[*∘]?\s*\(\s*\d+(?:[\s,]+\d+)*\s*\))*\s*(?:\^\s*-?\d+)?\s*$|[^=\n]*[-+*^][^=\n]*\bmod\s+\d+\s*$|^\s*\[\s*\d+(?:[\s,]+\d+)+\s*\]\s*$)`, "i")`
  — the negative lookahead IS the number-theory boundary: everything on that list keeps
  going to `tryNumberTheory` unchanged (pinned: `order of 3 mod 7`, `inverse 5 mod 12`,
  `primitive roots mod 10`, `7^100 mod 13`, `3^-1 mod 7`, `x^2 = 2 mod 7`, `5 = 2 mod 3`,
  `17 mod 5`). An expression with an OPERATOR before `mod` (`7 * 9 mod 12`, `7 + 9 mod 12`,
  `3 * 5 = 1 mod 7`, `(x^2 + 1)(x + 2) mod 3`) is algebra. `D4` matches only with uppercase D
  (the guard is case-sensitive on that alternative; the rest is `i`).
- Presentations are refused by name, never solved: `PRESENTATION_RE = /\b[a-z]\s*\^\s*\d+\s*=\s*e\b|<\s*[a-z](?:\s*,\s*[a-z])*\s*\|/i` → "Group presentations ⟨a, b | a² = b³ = e, …⟩ are not read: give the group concretely (Z/6, S3, D4, U(8), Z/2 x Z/4, or a Cayley table)" — so `a^2 = e, b^3 = e` never again returns a = ±1.6487 and `a * b = e` gets the same refusal from the switch (not "more than one unknown (a, b)").
- `tryAlgebraVerb` stands aside when its body matches `/\b(?:over|in|mod)\s+(?:F|𝔽|GF|Z|ℤ)[\s_(\d]/i` (the `F_2` answer dies there); `INTERP_VERB_RE` must not match `lagrange:` when `ALGEBRA_RE` does (order the switch before the verb chain — it is).

| Verb | Examples | Output / verification |
|---|---|---|
| Group description (a name alone) | `Z/6` · `ℤ/6ℤ` · `U(8)` · `S3` · `Sym(3)` · `D4` · `Z/2 x Z/4` · `klein four group` · a Cayley-table block | Title "Group ℤ/6ℤ (order 6, cyclic, abelian)"; elements listed in the display line (`0, 1, 2, 3, 4, 5`; `U(8) = {1, 3, 5, 7}` under ×; S₃ as `e, (1 2), (1 3), (2 3), (1 2 3), (1 3 2)`; D₄ as `e, r, r², r³, s, rs, r²s, r³s` with `r⁴ = s² = e, srs = r⁻¹`); the element-order table; "cyclic: yes — generators 1, 5" / "cyclic: NO — no element has order 8 (every element has order ≤ 2)"; abelian verdict; `Z(G)`; the isomorphism type line (below); Lagrange line "orders of elements divide 8: 1, 2, 4 occur". Verified: the Cayley table is built and checked by brute force for closure, associativity (n³ products), identity and inverses — a given table that fails prints WHICH axiom and WHERE ("(a·b)·c = e but a·(b·c) = b at a = …, so this table is not a group"). Figure: the Cayley table grid (own `cayleyTableSvg`: header row/column in bold ink, each cell tinted by the element's index on `SEQUENTIAL_BLUE` with `inkOn` text, identity cells outlined — the diagonal-symmetry of an abelian group is VISIBLE) for ≤ 20 elements; above that, "table of 576 entries not drawn" and no table text either. |
| `cayley table of G` · `multiplication table of Z/5` · `addition table of Z/4` | `cayley table of S3` · `cayley table of U(8)` | The table as text (one row per line, `·` separated, header row) for ≤ 12 elements and ALWAYS the figure for ≤ 20; `multiplication table of Z/5` is the ring's × table including 0 (a monoid, said: "0 has no inverse — the GROUP of units is U(5) = {1, 2, 3, 4}"). |
| `order of g in G` · `orders of all elements of G` · `elements of order k in G` | `order of 2 in Z/6` · `order of 5 in U(12)` · `order of (1 2 3)(4 5)` · `orders of all elements of Z/12` · `elements of order 2 in D4` | "order of 2 in ℤ/6ℤ = 3 (2, 4, 0)"; a permutation's order = lcm of its cycle lengths, SAID (`lcm(3, 2) = 6`), cross-checked by iterating the composition; the all-orders line groups by order (`order 1: 0 · order 2: 6 · order 3: 4, 8 · order 4: 3, 9 · order 6: 2, 10 · order 12: 1, 5, 7, 11`) and the Lagrange line "every order divides 12". |
| `subgroup generated by g[, h] in G` · `<g> in G` · `⟨g, h⟩` | `subgroup generated by 4 in Z/12` · `<4> in Z/12` · `<(1 2), (1 2 3)> in S3` | "⟨4⟩ = {0, 4, 8}, order 3, index 4"; generated by closure (bounded by |G|); "⟨(1 2), (1 2 3)⟩ = S₃ (the whole group)". |
| `subgroups of G` · `all subgroups of G` · `subgroup lattice of G` · `subgroups of order k in G` | `subgroups of Z/12` · `all subgroups of S3` · `subgroup lattice of Z/12` · `lagrange: subgroups of order 4 in Z/12` · `subgroups of order 5 in Z/12` | Every subgroup, grouped by order, generators named (`{0, 4, 8} = ⟨4⟩`); count line "6 subgroups — one for each divisor of 12 (cyclic)"; `of order k`: the list, or "none — 5 does not divide 12 (Lagrange)" by name, or "none of order 6 in A₄ even though 6 | 12: Lagrange's converse fails" when it does. Cap |G| ≤ 24 (S₄: 30 subgroups, D₁₂: 34) — beyond: "all subgroups of S₅ (156 of them) are above the cap |G| ≤ 24; ask for `subgroup generated by …`, `cosets of …`, or `is … normal`" BEFORE any work. Verified: each subgroup re-checked for closure; the count against the divisor count when cyclic. Figure: the Hasse diagram (`graphSvg` with `layers` = subgroup order, covering edges only, each node labelled by its generator form), ≤ 40 subgroups. |
| `is G cyclic` · `is G abelian` · `generators of G` · `is g a generator of G` | `is U(8) cyclic?` · `is U(10) cyclic` · `generators of U(10)` · `is 3 a generator of U(10)` · `is D4 abelian` · `is Z/2 x Z/2 abelian` | "U(8) is NOT cyclic: its elements 1, 3, 5, 7 have orders 1, 2, 2, 2 — none has order 4. U(8) ≅ ℤ/2ℤ × ℤ/2ℤ (the Klein four-group)." / "U(10) is cyclic: generators 3 and 7 (3¹ = 3, 3² = 9, 3³ = 7, 3⁴ = 1). U(10) ≅ ℤ/4ℤ." `generators of G` prints the φ(n) count for cyclic G and "not cyclic — no single generator; a generating SET is {r, s}" otherwise. Abelian: the first non-commuting pair named (`rs ≠ sr: rs = r s, sr = r³s`). |
| `cosets of H in G` · `left/right cosets of H in G` | `cosets of <3> in Z/12` · `left cosets of {e, (1 2)} in S3` · `right cosets of {e, (1 2)} in S3` | Each coset on its own line with a representative (`1 + ⟨3⟩ = {1, 4, 7, 10}`; `(1 3)H = {(1 3), (1 2 3)}`); the Lagrange line "|G| = |H| · [G : H]: 12 = 4 · 3"; in a non-abelian group BOTH left and right are printed and compared ("left and right cosets differ: (1 3)H = {(1 3), (1 2 3)} but H(1 3) = {(1 3), (1 3 2)} — H is not normal"). Verified: the cosets partition G (union = G, pairwise disjoint, all of size |H|). |
| `is H normal in G` | `is {e, (1 2)} normal in S3` · `is A3 normal in S3` · `is <r^2> normal in D4` | "NOT normal: (1 3)(1 2)(1 3)⁻¹ = (2 3) ∉ H" (the witness conjugate) / "normal: index 2 — every subgroup of index 2 is normal" + the full conjugation check anyway. |
| `quotient G / H` · `G / H` · `G mod H` | `quotient Z/12 / <4>` · `Z/12 / <4>` · `S3 / A3` · `D4 / <r^2>` | Refuses by name when H is not normal (the witness above). Otherwise the coset list as elements, the quotient's Cayley table (drawn), its isomorphism type ("ℤ/12ℤ / ⟨4⟩ ≅ ℤ/4ℤ (order 4, cyclic: generated by 1 + ⟨4⟩)"; "D₄ / ⟨r²⟩ ≅ ℤ/2ℤ × ℤ/2ℤ"). Verified: the quotient table is checked as a group by brute force (well-definedness is exactly the coset-product test). |
| `center of G` · `conjugacy classes of G` · `class equation of G` | `center of D4` · `center of S3` · `conjugacy classes of S3` · `conjugacy classes of S4` | "Z(D₄) = {e, r²}"; "Z(S₃) = {e} (trivial)"; the classes with sizes and a representative's cycle type for Sₙ (`S₄: 1 + 6 + 3 + 8 + 6 = 24 — classes by cycle type: e · (a b) · (a b)(c d) · (a b c) · (a b c d)`); the class equation line. Verified: class sizes divide |G|; sizes sum to |G|; the classes of size 1 are exactly the centre. |
| `is G isomorphic to K` · `G ≅ K` · `isomorphism type of G` · `find all groups of order n` | `is Z/8 isomorphic to Z/2 x Z/4` · `is (Z/8, +) ≅ (Z/2 × Z/4, +)?` · `is Z/2 x Z/3 isomorphic to Z/6` · `Z/6 ≅ Z/2 x Z/3?` · `isomorphism type of U(8)` · `find all groups of order 6` | Two independent invariant sets, both printed: (i) element-order statistics (`ℤ/8ℤ: orders 1, 2, 4, 8 occur 1, 1, 2, 4 times; ℤ/2ℤ × ℤ/4ℤ: orders 1, 2, 4 occur 1, 3, 4 times`) and (ii) abelian flag + |Z(G)| + class count + subgroup count (when ≤ 24). Any disagreement → "NOT isomorphic: ℤ/8ℤ has an element of order 8 and ℤ/2ℤ × ℤ/4ℤ has none" (the smallest distinguishing invariant named). Agreement → "isomorphic" is CLAIMED only where the invariants are complete: abelian G (invariant factors from the order statistics — the classification), or |G| ≤ 15 (the order statistics separate every pair of groups of each order ≤ 15; the first failure is order 16: ℤ/8ℤ × ℤ/2ℤ and M₁₆ share them — said by name), or an explicit isomorphism is constructed (cyclic ↔ cyclic: generator ↦ generator; CRT below). Otherwise: "the invariants agree with D₈; whether the groups are isomorphic cannot be decided here (|G| = 16)". `find all groups of order 6` → "two: ℤ/6ℤ and S₃ — order statistics 1,1,2,2 vs 1,3,2" for n ≤ 15 from the built-in list, refused by name above. |
| Permutations: `σ τ` · `σ * τ` · `compose σ and τ` · `inverse of σ` · `σ^-1` · `σ^k` · `sign of σ` · `parity of σ` · `cycle type of σ` · `order of σ` · `permutation 2 3 1` · `[2 3 1]` · `cycle diagram of σ` · `σ as transpositions` | `(1 2 3)(4 5)` · `(1 2 3)(1 2)` · `(1 2 3) * (1 2)` · `compose (1 2 3) and (1 2)` · `inverse of (1 2 3 4)` · `sign of (1 2 3)(4 5)` · `parity of (1 2)(3 4)` · `cycle type of (1 2 3)(4 5)` · `permutation 2 3 1` · `cycle diagram of (1 2 3 4 5 6)` | A bare product is SIMPLIFIED to disjoint cycles with the two-row form, the point-by-point trace in the steps (`1 → 2 → 3`), the convention line "composed right to left: (1 2) is applied first — left to right would give (2 3)"; `(1 2 3)(4 5)` is already disjoint: "order 6 = lcm(3, 2), odd (3 transpositions: (1 3)(1 2)(4 5)), sign −1, cycle type [3, 2], in S₅ (or S₆, S₇ … with the remaining points fixed — degree taken as the largest point named)". `inverse of (1 2 3 4)` → `(1 4 3 2)`, verified by composing to e. One-line `2 3 1` → `(1 2 3)`. Verified: the printed cycle notation is re-parsed and compared point by point; sign by transposition count AND by inversion count of the one-line form (must agree). Figure: the cycle diagram through `graphSvg` (directed, i → σ(i), fixed points as self-loops, caption `σ = (1 2 3)(4 5)`). Degree cap 30. |
| Homomorphisms: `is f(x) = … a homomorphism from G to K` · `kernel of x -> … from G to K` · `image of …` | `is f(x) = 2x a homomorphism from Z/4 to Z/8` · `kernel of x -> 2x from Z/6 to Z/6` · `is x -> 3x a homomorphism from Z/4 to Z/6` | Well-definedness first ("2·4 = 8 ≡ 0 in ℤ/8ℤ, so f is well defined on ℤ/4ℤ"; `x ↦ 3x` from ℤ/4 to ℤ/6: "NOT well defined: 0 ≡ 4 in ℤ/4ℤ but 3·0 = 0 ≠ 3·4 = 12 ≡ 0 … " — checked on the generators and on every pair); then f(a + b) = f(a) + f(b) on ALL pairs; kernel `{0}`, image `{0, 2, 4, 6} ≅ ℤ/4ℤ`; the first-isomorphism line "G / ker f ≅ im f: ℤ/4ℤ / {0} ≅ {0, 2, 4, 6}" with |G| = |ker| · |im| verified. Maps are read as `x -> expr`, `f(x) = expr`, `x ↦ expr` with `expr` linear or a power (`x^2`, `3x`, `x + 1` — the last is refused: "f(0) = 1 ≠ 0, not a homomorphism"); for permutation groups only `sign` and `conjugation by g` are named maps. |
| Ring arithmetic in ℤ/n: `a op b mod n` · `in Z/n: expr` · `expr in Z/n` · `inverse of a in Z/n` · `a^-1 in Z/n` · `units of Z/n` · `zero divisors of Z/n` · `is a a unit in Z/n` · `is Z/n a field` · `solve ax = b in Z/n` · `x^2 + c = 0 in Z/n` | `7 * 9 mod 12` · `7 + 9 mod 12` · `in Z/12: 7 + 9` · `3 * 5 = 1 mod 7` · `inverse of 5 in Z/12` · `5^-1 in Z/12` · `units of Z/12` · `zero divisors of Z/12` · `is 5 a unit in Z/12` · `is Z/7 a field` · `is Z/6 a field` · `solve 3x = 2 in Z/7` · `x^2 + 1 = 0 in Z/5` · `x^2 + 1 = 0 mod 3` | "7 · 9 = 63 = 5 · 12 + 3, so 7 · 9 ≡ 3 (mod 12)"; the `= c mod n` statement form is a TRUE/FALSE verdict ("3 · 5 = 15 ≡ 1 (mod 7): TRUE"); inverses through `modInverse` with the Euclid steps (reuse `doInverse`'s text by calling `tryNumberTheory` on the rewritten `inverse 5 mod 12` — one implementation); `units of Z/12 = {1, 5, 7, 11}` (φ(12) = 4, "U(12) ≅ ℤ/2ℤ × ℤ/2ℤ"); `zero divisors = {2, 3, 4, 6, 8, 9, 10}` with a witness each (`2 · 6 = 12 ≡ 0`); "ℤ/7ℤ is a field (7 is prime: every nonzero element has an inverse — 1, 4, 5, 2, 3, 6)" / "ℤ/6ℤ is NOT a field: 2 · 3 ≡ 0, a zero divisor, so 2 has no inverse"; `3x = 2 in Z/7` → `x = 3` (via `doLinearCongruence` — reuse); `x^2 + 1 = 0 in Z/5` → `x = 2, 3` by exhaustive evaluation for n ≤ 10⁶ then `sqrtMod` for prime n beyond; `x^2 + 1 = 0 mod 3` → "no solution: x² takes only the values 0, 1 mod 3". |
| 𝔽p[x]: `poly mod p` · `poly over F_p` · `(f)(g) over F_p` · `f divided by g over F_p` · `gcd of f and g over F_p` · `extended euclid f, g over F_p` · `is f irreducible over F_p` · `factor f over F_p` · `irreducible polynomials of degree d over F_p` · `roots of f over F_p` | `(x^2 + 1)(x + 2) mod 3` · `(x^2 + 1)(x + 2) over F_3` · `x^2 + 1 mod 3` · `is x^2 + 1 irreducible over F_3` · `is x^2 + 1 irreducible over F_2` · `factor x^2 + 1 over F_2` · `factor x^4 + x + 1 over F_2` · `factor x^4 + x^2 + 1 over F_2` · `gcd of x^3 + 1 and x^2 + 1 over F_2` · `extended euclid x^3 + x + 1, x^2 + 1 over F_2` · `irreducible polynomials of degree 2 over F_2` · `x^2 + x + 1 = 0 in F_2` | Products reduced coefficient-wise (`x³ + 2x² + x + 2` over 𝔽₃, with the unreduced product `x³ + 2x² + x + 2` shown when it differs); `x^2 + 1 mod 3` alone → "x² + 1 is already reduced over 𝔽₃ — it has no roots (0² + 1 = 1, 1² + 1 = 2, 2² + 1 = 2), so it is irreducible of degree 2"; irreducibility by trial division by every monic of degree ≤ d/2 when p^⌊d/2⌋ ≤ 20 000 candidates (the step says how many were tried), else Rabin's test (x^(p^d) ≡ x mod f and gcd(x^(p^(d/q)) − x, f) = 1 for each prime q | d — exact BigInt, d ≤ 30, p < 10⁶), the method named; factoring by the same trial division (the cap stated: "factoring over 𝔽₉₇ in degree 10 needs 97⁵ trial divisors — above the cap; irreducibility is still decided"), result as a product of monic irreducibles with multiplicity (`(x + 1)²`, `(x² + x + 1)²`), a leading-coefficient factor when not monic; `gcd` with the Euclid remainders and Bézout `s·f + t·g = gcd`; `roots of` by evaluation. Composite modulus: `mod 6` products are fine (ring, said), but `irreducible`/`factor`/`gcd` over ℤ/6 are refused by name ("ℤ/6ℤ is not a field — unique factorisation fails there (x² = x·x = (x + 3)(x + 3)…)"). Verified: factors multiplied back and reduced EQUAL the input; the number of linear factors (with multiplicity) equals the root count by evaluation; irreducible verdicts cross-checked by the two methods whenever both are within caps; Bézout identity re-evaluated. Printed in Solve grammar (`polyString`, exported), `x^2` ASCII in the math line, superscripts in the text layer only. |
| GF(pᵏ): `GF(q)` · `F_q` · `𝔽₉` · `F_9 = F_3[x]/(f)` · `GF(8) with a^3 = a + 1` · `elements of GF(8)` · `F_4 multiplication table` · `addition table of GF(4)` · `primitive element of GF(9)` · `minimal polynomial of a^k in GF(q)` · `order of a^k in GF(q)` · `(a + 1)(2a + 2) in GF(9)` | `GF(9)` · `GF(4)` · `F_9 = F_3[x]/(x^2 + 1)` · `F_4 multiplication table` · `elements of GF(8)` · `primitive element of GF(9)` · `minimal polynomial of a^3 in GF(8)` | "𝔽₉ = 𝔽₃[x]/(x² + 1), a = the class of x, a² = −1 = 2": the 9 elements `0, 1, 2, a, a + 1, a + 2, 2a, 2a + 1, 2a + 2` with their multiplicative orders (`a: 4, a + 1: 8, …`); "primitive elements (order 8): a + 1, a + 2, 2a + 1, 2a + 2 — a itself is NOT primitive (order 4)"; the × table drawn for q ≤ 16 (the same grid builder, 0 row/column greyed) and the + table on request; `minimal polynomial of a^3 in GF(8)` (a³ = a + 1): conjugates `a³, a⁶, a¹²=a⁵` → `x³ + x² + 1`, verified by evaluating at a³ in the field and by dividing x⁸ − x; element arithmetic in the field as a verb (`(a + 1)(2a + 2) in GF(9)` → `2a² + 4a + 2 = 2·2 + a + 2 = a + 3 ≡ a`). `GF(6)` → "6 is not a prime power — there is no field with 6 elements" by name. Verified: the field is brute-force checked (every nonzero element has an inverse; distributivity on every triple for q ≤ 64, sampled 10⁴ triples beyond — said); the modulus is re-checked irreducible; the primitive element's order equals q − 1 by the cycle. Caps: q ≤ 1024 for element lists/orders (k ≤ 10), q ≤ 16 for a drawn table, q ≤ 64 for the text table. |
| CRT isomorphism: `chinese remainder Z/6 ≅ Z/2 × Z/3` · `Z/mn ≅ Z/m × Z/n` · `is Z/4 isomorphic to Z/2 x Z/2` | `chinese remainder Z/6 ≅ Z/2 × Z/3` · `Z/6 ≅ Z/2 x Z/3?` · `Z/4 ≅ Z/2 x Z/2?` | "gcd(2, 3) = 1, so ℤ/6ℤ ≅ ℤ/2ℤ × ℤ/3ℤ by x ↦ (x mod 2, x mod 3)" with the explicit table `0 ↦ (0, 0), 1 ↦ (1, 1), 2 ↦ (0, 2), 3 ↦ (1, 0), 4 ↦ (0, 1), 5 ↦ (1, 2)` and the inverse by `doCrt` (reuse: `(1, 2) ↦ 5`); verified bijective and additive on all pairs. `Z/4 vs Z/2 × Z/2`: "NOT isomorphic: gcd(2, 2) = 2 — ℤ/4ℤ has an element of order 4, ℤ/2ℤ × ℤ/2ℤ has none". |

Labels (`|G| =`, `order of 2 in ℤ/6ℤ =`, `Z(D₄) =`) live in the text layer; the display
contract for this kind: everything printed as a group/element/polynomial re-parses through
the SAME reader (`ℤ/12ℤ`, `⟨4⟩ = {0, 4, 8}`, `(1 3)`, `U(10) ≅ ℤ/4ℤ`, `𝔽₉ = 𝔽₃[x]/(x² + 1)`,
`x³ + x² + 1` with superscripts — `foldSuperscripts` already folds them; `foldSubscripts` is
new; `×` and `≅` are accepted on input). Pinned by a round-trip test over every §D output
line that names a group, an element or a polynomial.

## C. Build order and honest limits

1. **`src/lib/permutation.ts`** — the permutation object (array form, degree ≤ 30),
   parse/print cycle notation (digit-per-point rule for unseparated runs, said), compose
   (right-to-left; the `left to right` switch), inverse, power, order (lcm of cycle lengths
   AND iteration — must agree), sign (transposition count AND inversion count — must agree),
   cycle type, two-row form, transposition decomposition. Unit tests on every spelling.
2. **`src/lib/groups.ts`** — `FiniteGroup {names, mul(i, j), e}` built as an index table
   with the axiom check up front (closure, associativity n³, identity, inverses — `|G| ≤ 120`,
   so ≤ 1.73 M triple products, decided BEFORE building: `S_6` (720) is refused by name at the
   reader, never enumerated). Constructors: ℤ/n, U(n) (through `gcd`), Sₙ (n ≤ 5), Aₙ (n ≤ 5),
   Dₙ (n ≤ 30, 2n ≤ 120 — `r`, `s` names), Q₈, V₄, direct products (|G| ≤ 120), Cayley-table
   blocks. Verbs: orders (and the Lagrange line), generated subgroup (closure), all subgroups
   (|G| ≤ 24, join-closure enumeration, ≤ 200 subgroups), cyclic/abelian/generators, cosets
   (both sides, partition check), normality (witness), quotient (table rebuilt and re-checked
   as a group), centre, conjugacy classes (class equation checks), homomorphism check
   (well-definedness on every pair first), isomorphism invariants (two sets; decidability as
   stated in §B — the |G| ≤ 15 completeness claim is pinned by a test that builds every group
   of order ≤ 15 from the constructors above and confirms the statistics are pairwise
   distinct; the order-16 counterexample M₁₆ is built once to prove the limit is real).
3. **`src/lib/polyModP.ts`** — 𝔽p[x] on `bigint[]` (low → high) using `numtheory.mod/
   modInverse/modPow`: add/mul/divmod/gcd/egcd/eval/derivative, `polyInVar` + reduction as
   the reader, `polyString` (exported from `algebraTools`) as the printer. Irreducibility:
   trial division while p^⌊d/2⌋ ≤ 20 000, else Rabin (d ≤ 30, p < 10⁶, deterministic, exact).
   Factoring: trial division only (same cap) — Berlekamp/Cantor–Zassenhaus NOT shipped
   (randomised or needs a null-space over 𝔽p; the brief's honest limit is "beyond the trial-
   division cap, irreducibility is decided and factoring is refused by name"). Cross-checks:
   multiply back; linear-factor count = root count by evaluation; both irreducibility methods
   when both are in range (refuse on disagreement — the house pattern).
4. **`src/lib/finiteField.ts`** — GF(pᵏ) as 𝔽p[x]/(f): element enumeration (q ≤ 1024),
   `mul/add/inv/pow`, orders, primitive elements, minimal polynomials by Frobenius conjugates
   (product expanded IN the field, coefficients asserted to lie in 𝔽p, then verified by
   evaluation and by dividing x^q − x), the brute-force field check (q ≤ 64 full, else
   sampled and said), the default-modulus choice stated by name.
5. **Figures `src/lib/algebraChart.ts`** — `cayleyTableSvg(labels, table, {caption, identity,
   highlight})` (460 wide, cells ≥ 20 px — hence the 20-element cap; `SEQUENTIAL_BLUE` tints
   by element index, `inkOn` for legible text, bold header row/column, identity cells
   outlined); `layers` option on `graphSvg` (graphs.ts 1085–1100: when `opts.layers` is given,
   place vertices on rows by layer, evenly spaced, instead of the ring — ≤ 40 vertices) used
   for the Hasse diagram (vertices = subgroups named by generators, edges = covering relation,
   the trivial subgroup at the bottom, G at the top); the cycle diagram through `graphSvg`
   directed as it is. Three entries in `figure-layout-run.ts` (the S₃ Cayley table, the ℤ/12ℤ
   lattice, `(1 2 3)(4 5)` cycle diagram — plus the GF(4) table, four) and `CORPUS_FLOOR`
   183 → 187.
6. **`src/lib/algebra.ts`** — the front door `tryAlgebra(input): DiscreteResult | null`,
   `ALGEBRA_RE`, `GROUP_RE`, `PRESENTATION_RE`, the readers, the number-theory stand-aside
   list (rewrites `inverse of 5 in Z/12` → `inverse 5 mod 12` and `solve 3x = 2 in Z/7` →
   `3x = 2 mod 7` and CALLS `tryNumberTheory` so there is one Euclid, one congruence solver);
   registered first in `ENGINES`; `foldSubscripts` in discrete.ts beside `foldSuperscripts`.
7. **Routing** — the equation-kind switch (RAW input, before the derivative switch, the note
   "switched to the Discrete math kind"); `tryAlgebraVerb` stands aside for `over/in/mod F_p`;
   `INTERP_VERB_RE` ordering checked; `algebraRouting.test.ts` on the pane source (import,
   switch position, raw-input decision, every §D input reaches `tryAlgebra`, every stand-aside
   still reaches number theory, `D4` is dihedral in the discrete kind and derangements only as
   `d4`/`derangements 4`); `discrete.test.ts:36` updated; `palettes.ts` `SOLVE_DISCRETE` group
   "Abstract algebra" (668) and the `examples.ts` bullet (425); display-contract round-trip
   test; an independent adversarial pass over the diff (house rule); then §D as the exit test.

**Honest limits (each stated in the output when hit):** |G| ≤ 120 for any concrete group
(S₅, A₅ in; S₆ out by name); all-subgroups |G| ≤ 24; drawn tables ≤ 20 elements, text tables
≤ 12; Hasse ≤ 40 subgroups; permutation degree ≤ 30; isomorphism DECIDED only for abelian
groups, |G| ≤ 15, or a constructed isomorphism — otherwise "cannot be decided here" with the
invariants printed; no presentations, no semidirect products typed as such (⋊ is printed in
an isomorphism-type line like "D₄ ≅ ℤ/4ℤ ⋊ ℤ/2ℤ" only as a NAME, never read), no Sylow
enumeration, no automorphism groups (`aut(Z/8)` → "Aut(ℤ/8ℤ) ≅ U(8) by the classification of
automorphisms of cyclic groups — stated, not computed; other automorphism groups are not
computed here"), no infinite groups, no character tables; 𝔽p[x] factoring only within the
trial-division cap; GF(q) with q ≤ 1024; no GF(q) with q not a prime power (by name).

## D. Acceptance audit

Every expected value below was computed independently (own brute-force group builder with
closure/associativity checks, own permutation composer, own 𝔽p[x] trial-division factoriser
and own GF(pᵏ) element enumerator in a throwaway script, deleted).

Groups: `Z/6` → elements 0–5, cyclic (generators 1, 5), abelian, orders 1, 6, 3, 2, 3, 6; table
drawn · `ℤ/6ℤ`, `Z_6`, `Z6`, `Z/6Z`, `integers mod 6`, `group Z/6` → identical · `U(8)` → {1, 3,
5, 7}, orders 1, 2, 2, 2, NOT cyclic, ≅ ℤ/2ℤ × ℤ/2ℤ · `is U(8) cyclic?` → NO, "no element of order
4" · `U(10)` / `is U(10) cyclic` → {1, 3, 7, 9}, orders 1, 4, 4, 2, cyclic, generators 3, 7, ≅
ℤ/4ℤ · `is 3 a generator of U(10)` → yes (3, 9, 7, 1) · `U(12)` → {1, 5, 7, 11}, all order ≤ 2,
not cyclic · `order of 5 in U(12)` → 2 · `S3` / `S_3` / `Sym(3)` → 6 elements, non-abelian
(witness (1 2)(1 3) = (1 3 2) ≠ (1 3)(1 2) = (1 2 3)), orders 1, 2, 2, 2, 3, 3 · `D4` → order 8,
orders 1, 4, 2, 4, 2, 2, 2, 2 (r, r³ of order 4), non-abelian, Z = {e, r²}; caveat "D4 read as
the symmetries of the square; derangements: write derangements 4" · `D_8` → order 16 with the
convention note · `Z/2 x Z/4` / `Z/2 × Z/4` → order 8, abelian, not cyclic (orders 1; 2 ×3;
4 ×4) · `klein four group` → V₄ ≅ ℤ/2ℤ × ℤ/2ℤ · `cayley table of S3` → 6 × 6 grid drawn, text
table printed · `cayley table of U(8)` → 4 × 4, symmetric (abelian visible) · `multiplication
table of Z/5` → 5 × 5 including the 0 row, note on U(5) · `group with cayley table ⏎ e a b ⏎ a
b e ⏎ b e a` → "a group of order 3 ≅ ℤ/3ℤ" (axioms checked) · a table with `a·a = a, a ≠ e` →
refused naming the failing axiom (no inverse for a) · `order of 2 in Z/6` → 3 · `orders of all
elements of Z/12` → order 1: 0 · 2: 6 · 3: 4, 8 · 4: 3, 9 · 6: 2, 10 · 12: 1, 5, 7, 11 · `elements
of order 2 in D4` → s, rs, r², r²s, r³s (five) · `subgroup generated by 4 in Z/12` / `<4> in
Z/12` → ⟨4⟩ = {0, 4, 8}, order 3, index 4 · `subgroups of Z/12` → {0}, {0, 6}, {0, 4, 8}, {0, 3,
6, 9}, {0, 2, 4, 6, 8, 10}, ℤ/12ℤ — 6, one per divisor; `subgroup lattice of Z/12` → the Hasse
diagram with edges 1–2, 1–3, 2–4, 2–6, 3–6, 4–12, 6–12 (by order) · `all subgroups of S3` →
{e}; {e, (1 2)}; {e, (1 3)}; {e, (2 3)}; A₃ = {e, (1 2 3), (1 3 2)}; S₃ — 6 · `subgroups of D4` →
10 · `lagrange: subgroups of order 4 in Z/12` → {0, 3, 6, 9} only, never the interpolation
refusal · `subgroups of order 5 in Z/12` → none, 5 ∤ 12 · `subgroups of S6` → refused by name
(720 > 120) BEFORE any work · `generators of Z/12` → 1, 5, 7, 11 (φ(12) = 4) · `cosets of <3>
in Z/12` → {0, 3, 6, 9}, {1, 4, 7, 10}, {2, 5, 8, 11}; 12 = 4 · 3 · `left cosets of {e, (1 2)}
in S3` → H, {(1 3), (1 2 3)}, {(2 3), (1 3 2)}; `right cosets …` → H, {(1 3), (1 3 2)}, {(2 3),
(1 2 3)}; "differ, so H is not normal" · `is {e, (1 2)} normal in S3` → NOT normal, witness
(1 3)(1 2)(1 3) = (2 3) ∉ H · `is A3 normal in S3` → normal (index 2) · `quotient Z/12 / <4>`
/ `Z/12 / <4>` → cosets {0, 4, 8}, {1, 5, 9}, {2, 6, 10}, {3, 7, 11}; ≅ ℤ/4ℤ, table drawn ·
`S3 / A3` → ≅ ℤ/2ℤ · `S3 / {e, (1 2)}` → refused: not normal · `center of D4` → {e, r²} ·
`center of S3` → {e} · `conjugacy classes of S3` → {e}, {(1 2), (1 3), (2 3)}, {(1 2 3), (1 3
2)}; 6 = 1 + 3 + 2 · `conjugacy classes of S4` → sizes 1, 6, 3, 8, 6 by cycle type · `is Z/8
isomorphic to Z/2 x Z/4` / `is (Z/8, +) ≅ (Z/2 × Z/4, +)?` → NOT isomorphic: ℤ/8ℤ has 4 elements
of order 8, ℤ/2ℤ × ℤ/4ℤ none (statistics 1,1,2,4 vs 1,3,4) · `is Z/2 x Z/3 isomorphic to
Z/6` / `Z/6 ≅ Z/2 × Z/3` / `Z/6 ≅ Z/2 x Z/3?` → isomorphic (gcd(2, 3) = 1; CRT map printed) ·
`chinese remainder Z/6 ≅ Z/2 × Z/3` → the explicit table 0 ↦ (0, 0), 1 ↦ (1, 1), 2 ↦ (0, 2),
3 ↦ (1, 0), 4 ↦ (0, 1), 5 ↦ (1, 2) and the inverse (1, 2) ↦ 5 · `Z/4 ≅ Z/2 x Z/2?` → NOT ·
`isomorphism type of U(8)` → ℤ/2ℤ × ℤ/2ℤ (abelian: invariant factors 2, 2) · `isomorphism type
of D4` → "D₄ (order 8, non-abelian, 5 elements of order 2 — Q₈ has 1): decided, |G| ≤ 15" ·
`is Z/6 x Z/4 isomorphic to Z/2 x Z/12` → isomorphic (both abelian with invariant factors 2,
12; statistics equal) · `find all groups of order 6` → ℤ/6ℤ, S₃ · `find all groups of order
16` → refused by name (14 groups; beyond the built-in list) · `is D4 abelian` → no, rs ≠ sr ·
`is Z/2 x Z/2 abelian` → yes · `a^2 = e, b^3 = e` and `a * b = e` → the presentation refusal
by name, never a = ±1.6487.

Permutations: `(1 2 3)(4 5)` → disjoint already; order 6, odd, sign −1, cycle type [3, 2],
two-row form 2 3 1 5 4, diagram drawn · `(1 2 3)(1 2)` / `(1 2 3) * (1 2)` / `compose (1 2 3)
and (1 2)` → (1 3), "right to left ((1 2) first); left to right gives (2 3)" · `(1 2 3)(1 2)
left to right` → (2 3) · `inverse of (1 2 3 4)` → (1 4 3 2) · `(1 2 3 4)^2` → (1 3)(2 4) ·
`sign of (1 2 3)(4 5)` → −1 (3 transpositions) · `parity of (1 2)(3 4)` → even, +1 · `cycle
type of (1 2 3)(4 5)` → [3, 2] · `order of (1 2 3)(4 5)` → 6 = lcm(3, 2) · `permutation 2 3
1` / `[2 3 1]` → (1 2 3) · `(12)(34)` → (1 2)(3 4) with the digit-per-point note · `cycle
diagram of (1 2 3 4 5 6)` → one 6-cycle drawn, order 6 · `sigma = (1 2 3), tau = (1 2), sigma
* tau` → (1 3), never "sigma = 6" · `(1 2 3)(4 5) in S4` → refused: 5 is not a point of S₄.

Rings: `7 * 9 mod 12` / `7*9 mod 12` → 3 · `7 + 9 mod 12` / `in Z/12: 7 + 9` → 4 · `3 * 5 =
1 mod 7` → TRUE (15 ≡ 1) · `inverse of 5 in Z/12` / `5^-1 in Z/12` → 5 (5 · 5 = 25 ≡ 1) ·
`inverse of 3 in Z/7` → 5 · `inverse of 4 in Z/12` → none: gcd(4, 12) = 4 · `units of Z/12` →
{1, 5, 7, 11}, φ(12) = 4 · `zero divisors of Z/12` → {2, 3, 4, 6, 8, 9, 10} · `is 5 a unit in
Z/12` → yes · `is Z/7 a field` → yes (prime) · `is Z/6 a field` → no (2 · 3 ≡ 0) · `solve 3x =
2 in Z/7` → x = 3 · `x^2 + 1 = 0 in Z/5` → x = 2, 3 · `x^2 + 1 = 0 mod 3` → no solution ·
unchanged number theory: `order of 3 mod 7` → 6, `primitive roots mod 10` → 3, 7, `inverse 5
mod 12` → 5, `7^100 mod 13` → 9, `3^-1 mod 7` → 5, `x^2 = 2 mod 7` → 3, 4, `17 mod 5` → 2 —
and the same six typed in the EQUATION kind switch to the Discrete kind with the note, never
"mod = 0".

𝔽p[x] and GF(q): `(x^2 + 1)(x + 2) mod 3` / `… over F_3` → x³ + 2x² + x + 2 · `x^2 + 1 mod 3`
→ already reduced, irreducible, no roots · `is x^2 + 1 irreducible over F_3` → yes · `is x^2 +
1 irreducible over F_2` → no: x² + 1 = (x + 1)² · `factor x^2 + 1 over F_2` → (x + 1)², never
"F_2" · `factor x^4 + x + 1 over F_2` → irreducible · `factor x^3 + x + 1 over F_2` →
irreducible · `factor x^4 + x^2 + 1 over F_2` → (x² + x + 1)² · `factor x^2 + 2 over F_3` →
(x + 1)(x + 2) · `factor x^3 + x^2 + 1 over F_3` → (x + 2)(x² + 2x + 2) · `factor x^8 + x^4 +
x^3 + x + 1 over F_2` → irreducible (the AES polynomial; trial division 2⁴ candidates) ·
`irreducible polynomials of degree 2 over F_2` → x² + x + 1 (one) · `… over F_3` → x² + 1, x²
+ x + 2, x² + 2x + 2 · `gcd of x^3 + 1 and x^2 + 1 over F_2` → x + 1 (= 1·(x³ + 1) + x·(x² +
1)) · `extended euclid x^3 + x + 1, x^2 + 1 over F_2` → gcd 1; 1 = 1·(x³ + x + 1) + x·(x² + 1)
· `x^2 + x + 1 = 0 in F_2` → no roots in 𝔽₂ (roots live in 𝔽₄) · `factor x^2 + 1 over Z/6` →
refused by name (not a field) · `factor x^2 + 1` (no field) → unchanged ℚ behaviour · `GF(9)`
→ 𝔽₃[x]/(x² + 1) said; elements and orders (a: 4; a + 1, a + 2, 2a + 1, 2a + 2: 8; 2: 2; 2a:
4); primitive: a + 1, a + 2, 2a + 1, 2a + 2; table drawn (9 × 9) · `F_9 = F_3[x]/(x^2 + 1)` →
identical · `primitive element of GF(9)` → a + 1 (order 8), "a is not (order 4)" · `GF(4)` /
`F_4 multiplication table` → 𝔽₂[x]/(x² + x + 1); rows 0 | 0 | 0 | 0 // 0 | 1 | a | a + 1 // 0 |
a | a + 1 | 1 // 0 | a + 1 | 1 | a · `elements of GF(8)` → 𝔽₂[x]/(x³ + x + 1), 8 elements, every
nonzero element of order 7 (primitive) · `minimal polynomial of a^3 in GF(8)` → x³ + x² + 1
(conjugates a³ = a + 1, a⁶ = a² + 1, a⁵ = a² + a + 1), never the "^ is ambiguous" refusal ·
`(a + 1)(2a + 2) in GF(9)` → a · `GF(6)` → refused: not a prime power · `GF(2^11)` → refused
by name (2048 > 1024).

## E. Codebase-specific risks

1. **Two kinds, one default.** The default kind is `equation`, where every probe line is
   wrong or silent. Without the equation-kind switch (§B) a student never reaches the engine
   unless they know to pick "Discrete math". The switch decides on `solveInput.value` (RAW):
   the fold (27672) has already rewritten `×` into `*` and `ℤ` into a note before `text`
   exists — the LP flag at 27677 is the precedent. Pin the switch's position (before the
   derivative switch) and its raw-input condition in `algebraRouting.test.ts`.
2. **`mod` is a variable in the equation kind** — `7 * 9 mod 12` → "mod = 0", `7^100 mod 13`
   → "mod = 0", `3 * 5 = 1 mod 7` → "mod = 15/7". Six correct number-theory answers exist one
   dropdown away. The switch must cover `/\bmod\s+\d+\s*$/` lines (recognised by
   `solveDiscrete`) as well as `ALGEBRA_RE` — the cheapest fix of a real wrong-answer class.
3. **The number-theory boundary is a stand-aside LIST, not a feeling.** `tryNumberTheory`
   (694) must keep `order of 3 mod 7`, `inverse 5 mod 12`, `primitive roots mod 10`, `7^100 mod
   13`, `3^-1 mod 7`, `x^2 = 2 mod 7`, `5 = 2 mod 3`, `17 mod 5`: the algebra guard's negative
   lookahead names each shape and the routing test pins all eight in BOTH directions (number
   theory still answers; algebra returns null). The algebra engine REWRITES its own `inverse
   of 5 in Z/12` / `solve 3x = 2 in Z/7` into number-theory syntax and calls it — one Euclid.
4. **`tryNumberTheory` strips parentheses (703) and lower-cases.** Anything the algebra
   engine does not claim and that contains `U(8)` or a cycle becomes `u 8` / `1 2 3 4 5` for
   the next engines — harmless today, but a FUTURE number-theory form like `^(\d+)\s+(\d+)`
   would start claiming cycles. The algebra engine goes FIRST in `ENGINES` so cycle notation
   never reaches that stripping; `discrete.test.ts:36` is updated deliberately.
5. **`D4` is a derangement count** (combinatorics 783, on lower-cased text: `d4` → "D(4) = !4
   = 9"). Algebra first, uppercase-D only, and a caveat on every Dₙ answer naming the other
   reading; `d4`, `D(4)`, `derangements 4` are left to combinatorics — pinned.
6. **`factor … over F_2` prints "F_2".** `tryAlgebraVerb` (421) extracts an expression from
   a prose-bearing body (`extractExpression` picks `F_2`) and factors the CONSTANT. The
   stand-aside in §B is a one-line regex; the routing test feeds all four probe lines.
7. **`lagrange:` is an interpolation keyword** (`INTERP_VERB_RE`, interpolate.ts 40) and
   `transformVerb` (27753) is decided before the algebra switch would run — so the switch
   must come BEFORE `transformVerb` is consulted for the derivative/limit decisions, or the
   guard must exclude `lagrange` followed by `subgroups|cosets|order|theorem`. Pin
   `lagrange: subgroups of order 4 in Z/12` and `lagrange's theorem for Z/12`.
8. **`⟨⟩` typed as `<>` is an inequality** — `cosets of <3> in Z/12` reached `solveChained`
   ("mixes directions"), `<4> in Z/12` the generic refusal. The switch runs first; inside the
   discrete kind nothing reads `<` as a comparator. Both `<3>` and `⟨3⟩` are read; `⟨3⟩` is
   printed (display contract: the reader accepts both — pinned).
9. **`e` is Euler's number to the solver.** `a^2 = e, b^3 = e` → a = ±√e. The presentation
   refusal must fire from the switch (RAW input) before `extractSingleEquation` sees it, and
   `e` inside a Cayley-table block or a coset `{e, (1 2)}` is the identity — the discrete kind
   never consults `parseExpr` for group elements.
10. **`->` and `^` belong to propositional logic in the discrete kind** (proplogic ~309–314):
    `kernel of x -> 2x …` and `minimal polynomial of a^3 in GF(8)` were refused with logic
    messages. Algebra first in `ENGINES` closes both; the tie-break test gets the two lines.
11. **Unbounded enumeration freezes Word.** `subgroups of S_6`, `conjugacy classes of S_8`,
    `cayley table of Z/1000`, `GF(2^20)`, `factor x^40 + … over F_97`, `(1 2 … 100)`: every cap
    (|G| ≤ 120, subgroups |G| ≤ 24, drawn ≤ 20, degree ≤ 30, q ≤ 1024, p^⌊d/2⌋ ≤ 20 000,
    Rabin d ≤ 30) is checked at the READER from the typed numbers, before any table, closure
    or candidate list is built ([[unbounded-loops-freeze-word]]: the cap is on the number
    typed, not on an iteration count discovered later). The associativity check is n³: at
    |G| = 120 it is 1.7 M index lookups — measured inside jest, under 100 ms; `timed()` in
    the acceptance test as in `lp.test.ts`.
12. **A correct-looking Cayley table can be a non-group.** A typed table is checked for all
    four axioms before any verb runs on it, and the failing axiom is named with the triple;
    a Latin square that is not associative (order-5 quasigroups exist) must not be called a
    group — the test includes one.
13. **Isomorphism "yes" is a claim, "no" is a certificate.** A "no" always carries the
    distinguishing invariant; a "yes" is printed only under §B's three conditions. The
    |G| ≤ 15 completeness is PROVEN inside the test suite (every group of each order ≤ 15
    built from the constructors; statistics pairwise distinct) and the order-16 failure
    (ℤ/8ℤ × ℤ/2ℤ vs M₁₆ — M₁₆ built as a Cayley table in the test) is pinned so nobody later
    "extends" the claim to 16 behind green tests.
14. **Composition order is a convention, not a fact.** Right-to-left by default and SAID on
    every product; `left to right` switches; when the two readings differ the other is
    printed. A test pins `(1 2 3)(1 2)` → (1 3) and the left-to-right (2 3), and that the
    note appears exactly when they differ.
15. **`(12)(34)` and `(1 12)`.** Unseparated digits are one point each, said; a cycle with a
    repeated point (`(1 2 1)`) or two cycles sharing a point in a "disjoint" product are read
    as a PRODUCT (composed), never silently deduplicated; a point ≥ 10 requires a separator.
16. **Dₙ naming.** `D4` = square (order 8); `D_8` = octagon (order 16) with the note; a verb
    that says "of order 8" or "of the square" resolves `D_8` to the square. Pinned both ways.
17. **Display contract for a kind without a fold.** The discrete kind gets no `foldPastedMath`,
    so `𝔽₉`, `ℤ₁₂`, `S₃` need `foldSubscripts` (new) and `×`, `≅`, `⟨⟩`, `ℤ`, `𝔽` need the
    reader's own aliases; every printed group/element/polynomial name in §D is fed back
    through `tryAlgebra` in a round-trip test. Polynomials print `x^2` in math lines and
    `x²` in text only after `foldSuperscripts` is confirmed to fold them back (it does).
18. **The graph figure's ring layout is not a lattice.** A Hasse diagram through `graphSvg`
    as it stands puts {0} and G on the same circle — a wrong figure that looks tidy. The
    `layers` option (graphs.ts 1085–1100) is the smallest correct change; the corpus entry for
    the ℤ/12ℤ lattice is checked by `check-figures.js` for overlaps and the test asserts the
    trivial subgroup's y is strictly below G's.
19. **`buildHeatmapSvg` is numeric.** A Cayley table of permutations cannot be drawn through
    it; the new grid builder draws TEXT cells. Do not route ℤ/n tables through the heatmap
    "because the entries are numbers" — one builder, one look.
20. **`recurrence.ts` has its own `class Rat`** — the 𝔽p[x] module imports `numtheory` and
    `cas` only; nothing from `recurrence`.
