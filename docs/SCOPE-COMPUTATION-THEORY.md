# Scope — Solve domain: computation theory (grammars, PDA, Turing machines, first-order logic, SAT, Hindley–Milner)

_Written 2026-10-14 at v2.132.0, from a read-only audit of the Discrete-math kind (`discrete.ts`
router, `automata.ts`, `proplogic.ts`, `logic.ts`, `graphs.ts`), the λ-calculus kind (`lambda.ts`),
the figure builders, and an 85-input probe driven through the three real entry points the pane
calls — `solveDiscrete`, `solveLambda`, and the equation-kind chain mirrored from taskpane.ts
27664–28010 (fold → prose switches → stats intent → sum → verb chain → word switch → inequality →
units/system → solver). Every probe answered in ≤ 50 ms. The probe files were deleted; findings
are in §A. Audit-first: wrong answers first. §D is the release's exit test. Planned as v2.133.0._

## A. What exists, what is missing

**Stand on (all `src/lib/`, each verified by reading):**
- `discrete.ts` — `DiscreteResult {title, display, steps, caveats, svg?, alt?}`, `DiscreteError`,
  `foldSuperscripts`, and `ENGINES` (59–68): number theory → combinatorics → recurrence → automata →
  propositional logic → graph, each a CLOSURE (import-cycle rule, 52–58). Order is the tie-break,
  pinned in `discrete.test.ts` 30–39 ("a single line p -> q is logic, not a graph"; `A->B ⏎ B->C`
  is NOT a truth table). The "Not recognised" result (76–85) lists every form by name. The pane's
  discrete block (taskpane 28655–28690) renders `dr.svg` already — new engines draw for free.
- `automata.ts` — THE block grammar to share: `KEYWORD` (548) `dfa|nfa|regex|to dfa|minimi[sz]e|
  equivalent`; `parseBlock` (609) reads `states:|alphabet:|sigma:|start:|initial:|accept:|final:|
  test:|run:|name:` heads with `:` or `=`, infers undeclared states/alphabet in order of first
  appearance, refuses by name (unknown state, non-total DFA, ε in a DFA); `parseTransition` (582)
  reads `from sym to`, `from --sym--> to`, `from, sym -> to`, comma-lists `q0 a,b q1`; `normSymbol`
  (566) folds `eps|epsilon|lambda|λ|ε|""|''` → `EPS = "ε"`; `AUTOMATA_CAPS` (19–39) names every
  cap (40 states, 10 symbols, 50 tests of 200 chars, 5,000 cross-check strings). `Machine` (43)
  is `trans: from → sym → targets` — ONE symbol per edge, so a PDA/TM edge does not fit it.
  `machineSvg` (870) draws states on a circle with merged per-(from,to) labels taken from
  `m.alphabet` — the drawing half must be split out and generalised to an edge list, not copied.
- `proplogic.ts` — `tokenize` (48–87): `->|=>|→|⊃` imp, `<->|<=>|↔` iff, `|`/`∨`/`+` or, `&`/`∧`/`·`
  and, `~|¬|!` not, `⊢|⊨|∴|therefore|entails` turnstile; `^` refused by name; `∀ ∃` → "Unexpected
  character". `parseFormula` (92) is RECURSIVE DESCENT and overflows the JS stack at 2,000 nested
  parentheses (probe: `RangeError` escapes `solveDiscrete` — the pane catches only
  `DiscreteError`). `truthRows`, `evaluate`, `show`, `variablesOf`, `MAX_VARS = 10`; `VERB_RE`
  (298) already claims `sat|satisfiable|cnf|dnf|simplify|tautology|valid|contradiction`.
  `STRONG` (38) makes any `|` or `->` line a formula: this is what steals grammars (below).
- `logic.ts` — Quine–McCluskey `minimise` and `truthTable` (digital-logic kind); nothing to reuse
  beyond the truth table already reached through proplogic.
- `graphs.ts` — `EDGE_RE` (87) `NAME (->|-->|→|--|-|−|–) NAME [weight]`, `parseGraph` (133),
  `strongComponents` (260, Tarjan — the 2-SAT engine), `topologicalOrder`, `bfs`, `graphSvg`
  (1081, circular layout, directed arrows, `edgeLabels`, `highlightVerts/Edges`). The `Graph`
  record (48) has no constructor: `markov.ts` 194/262 builds one by PRINTING edge lines and
  re-parsing them — export the build half of `parseGraph` instead of repeating that.
- `lambda.ts` — iterative `parseTerm` (425) with `MAX_PARSE_DEPTH = 400`, `termDepth` checked
  right after the parse (1551–1556; the house pattern for depth), `substitute`, `freeVars`,
  `alphaEquivalent`, `reduce`, `nbe`; `principalType` (1288): unification with occurs check,
  `Ty = var | arrow` ONLY (no base types, no schemes, no `let` rule), names type variables
  α β γ … in order of first appearance, `MAX_TYPE_WORK`/`MAX_TYPE_TEXT`; `parseLambdaRequest`
  (1535): `DEF_RE` (1510) `let [rec] NAME (:=|=) term` on every line but the last, verbs at
  1611–1616 (`type|typecheck|infer`, `free`, `alpha`, `eta`, `ski`, `cl`), `let rec` = Y inlined
  (1583). Definitions EXPAND by substitution before typing — so `let id = λx.x ⏎ type PAIR (id 1)
  (id TRUE)` is already typed correctly (accidental let-polymorphism, no scheme, no ∀, no trace).
  `LambdaResult` (1482) has NO `svg` field and the pane's λ block (28626–28653) renders none.
- Figures: `graphSvg`; `machineSvg`; `tablediagram.buildHierarchySvg` (646) — a hierarchy from
  root-to-leaf PATHS that MERGES equal prefixes, so a parse tree with two `S` children collapses:
  unusable for trees; `probability.ts bayesTreeSvg` (996) is private and fixed at two levels.
  **No general tree/DAG SVG builder exists in `src/lib`.** `check-figures.js CORPUS_FLOOR = 183`;
  `figure-layout-run.ts` registers the DFA figure at 1604.
- Pane: `SolveKind` (27085) has `lambda` and `discrete`; both bypass `foldPastedMath` (27672);
  palettes `SOLVE_LAMBDA` (629), `SOLVE_DISCRETE` (668, Automata group 720); `examples.ts` 425;
  the kind-switch pattern (geometry → equation, 28385–28398: switch ONLY when the target engine
  answers).

**Missing (everything below is new):** no grammar reader of any kind; no CNF/CYK/derivation/
ambiguity/FIRST-FOLLOW/useless/left-recursion; no PDA; no Turing machine; no quantifier anywhere
(`∀`, `∃`, `forall`, `exists` all "Unexpected character"); no term unification, Skolemisation,
clausal form, resolution, finite-model check; no DPLL/2-SAT/Horn/DIMACS/unsat core (SAT is answered
by the 2ⁿ truth table up to 10 variables — correct, but no tree, no proof, and a wall at 11);
no let-polymorphism, type schemes, Algorithm W trace; no tree/DAG figure builder.

**Probe (85 inputs: 18 grammar, 8 PDA, 8 TM, 17 FOL, 13 SAT, 12 HM, 9 traps), each through all
three kinds. Ranked wrong > wrong-reason > honest-refusal > missing; exact text.**

- **Handled correctly: 7 of 85** — all SAT-by-table in the discrete kind: `(a ∨ ¬b) ∧ (b ∨ c)` →
  "CONTINGENT — true in 4 of 8 rows (satisfiable, not valid). Satisfying assignments: a=T b=T c=T;
  …"; `sat (a | ~b) & (b | c) & (~a | ~c)` → "Yes: it is satisfiable. … a=T b=T c=F; a=F b=F
  c=T"; `(x1 ∨ x2 ∨ x3) ∧ (¬x1 ∨ ¬x2) ∧ …` → 3 rows; `satisfiable? (p -> q) & p & ~q` →
  "CONTRADICTION — false in all 4 rows (unsatisfiable)"; `a ∨ ¬b`, `a | b` (OR), `regex …`.
  Plus 5 HM inputs typed RIGHT in the λ kind but without what was asked: `type (λid. id id)
  (λx.x)` and `type λf.PAIR (f 1) (f TRUE)` → "not simply typable (the occurs check fails …)"
  (also the HM verdict: λ-bound = monomorphic); `let id = λx.x ⏎ type id id` → "α → α";
  `let id = λx.x ⏎ type PAIR (id 1) (id TRUE)` → "(((α → β) → α → β) → (γ → δ → γ) → ε) → ε"
  (correct simple type of the expansion; no scheme, no ∀, no W steps); `type λx.x x` → occurs.
- **Handled WRONG — a confident answer to a different question: 13 (+ the fold rewrites).**
  - Grammars read as logic or graphs (discrete kind): `S -> aSb` → "Truth table · S → aSb ·
    CONTINGENT — true in 3 of 4 rows · Satisfying assignments: S=T aSb=T; S=F aSb=T; S=F
    aSb=F" (`aSb` is one propositional variable); `S -> aS | b` → "S → aS ∨ b · CONTINGENT —
    true in 7 of 8 rows"; `S -> aSb ⏎ S -> ab` → "Graph · 3 vertices, 2 edges — directed,
    unweighted · Bipartite: yes — parts {ab, aSb} and {S} · Eulerian: neither …" with a DRAWN
    graph; `A -> B ⏎ B -> C` → the same graph answer (legitimate for an edge list; the
    tie-break must be stated for grammars).
  - Prose read as free λ-variables (λ kind): `hm λf.λx.f (f x)` → "β-reduction · Normal form:
    hm (λf.λx.f (f x)) · 0 β-steps · Free variable: hm · Simple type of the term as written:
    α"; `algorithm w λx.λy.x` → "Normal form: algorithm w (λx.λy.x) … type α"; `type scheme
    of λx.λy.x` → "Term: scheme of (λx.λy.x) · Type: α"; `busy beaver 3` → "Normal form: busy
    beaver (λf.λx.f (f (f x)))" (3 read as a Church numeral); `pigeonhole 3 pigeons 2 holes` →
    "Normal form: pigeonhole (λf.λx.f (f (f x))) pigeons (λf.λx.f (f x)) holes"; `unify f(x)
    with g(x)` → "Normal form: unify f x with g x · Free variables: unify, f, x, with, g".
  - Words read as unknowns (equation kind): `pda for a^n b^n` → "Solve for pda · This has more
    than one unknown (pda, for, a, n, b) — choose which one to solve for:"; `turing machine
    binary increment 1011` → "(turing, machine, binary, increment)"; `tm unary add 111+11` →
    "(tm, unary, add)"; `p cnf 3 2 ⏎ 1 -2 0 ⏎ 2 3 0` (DIMACS) → "(p, cnf)"; `busy beaver 3`,
    `pigeonhole …` likewise.
  - The paste fold REWRITES the problem before anything reads it (equation kind, 23 inputs):
    "Read the pasted stacked fraction as (E -> T E')/(T -> F T')" (FIRST/FOLLOW grammar; also
    `<expr> -> …`, the two-rule TM, `A -> B ⏎ B -> C`, `regex … ⏎ test: …`); "Read a power that
    lost its superscript in the paste (3x2 → 3x²)" on `S -> 0S1 | 01` (so the preview shows
    S¹); "Found the equation S -> aSb | epsilon in the pasted text; 1 line of prose around it
    ignored" — the QUESTION line (`is aabb in the language`, `cyk aabb`, `parse tree for
    aabb`, `test: aabb ab aab`, `tape: 1011`, every `states:`/`start:` line) is the prose
    dropped; "Greek letters read as variables: ε → epsilon" / "λ → lambda" / "δ → delta".
- **Refused for the WRONG reason: 38.** Discrete kind, 30: every `ε`/`λ`/`∀`/`∃` input →
  `DiscreteError: Unexpected character "ε" at position 12` (`S -> aSb | ε`, `cfg to pda …`,
  `chomsky normal form of …`, `nullable …`, `is the grammar … equivalent to …`), "Unexpected
  character "∀" at position 1" (11 FOL inputs), `forall x. P(x) -> …` → 'Unexpected character
  "." at position 9', `resolution: P(a), …` → '":" at position 11'; multi-rule grammars →
  'Line 1 ("S -> A B | a") is neither an edge (A-B, A->B, A-B 5) nor a question.' (the graph
  engine claims the block); `dpll (p ∨ q) ∧ …`, `unsat core (a) ∧ …`, `is (a ∨ b) ∧ … satisfiable`,
  `P(x) -> Q(x)`, `S -> a S b` → "Two things side by side at position 6 with no connective
  between them — write & for and, | for or."; `2sat …` → '"2sat" is not a propositional
  variable'; `2-sat …` → '"2" is not a propositional variable'; `horn a, a -> b, b -> c, ~c` →
  "Commas separate premises — add ⊢ (or |=) and a conclusion to make an argument."; DIMACS →
  "neither an edge nor a question". λ kind, 8: `let id = λx.x in (id 1, id true)`, `type let
  id = λx.x in id id`, `let twice = … in twice twice`, `let compose = … in compose`, `let id =
  λx.x in id 1` → "That line is a definition. Put the term to reduce on the line after it (for
  example a second line reading TWICE SUCC 0)." (`in` is unknown; `DEF_RE` swallows the line);
  `S => aSb | ε` → the same message (`=>` matched as `=`); `let rec f = λx.f x ⏎ type f` →
  "not simply typable" (true of the Y-expansion; HM says ∀α β. α → β); `type scheme of …` above.
  Equation kind: every `->` line is routed to the INEQUALITY path (`-` then `>`), 28 inputs →
  "Inequalities are solved exactly for POLYNOMIAL and RATIONAL expressions in one variable …
  nothing is reported rather than guessed."; `tm ⏎ δ(q0, 0) = (q1, 1, R) ⏎ …` → "Couldn't parse
  that system."; the rest "Couldn't parse that equation. Try e.g. x^2 - 5x + 6 = 0."
- **Honest "Not recognised" (lists the six forms): 32 in the discrete kind** — every keyword-led
  input (`grammar …`, `cfg …`, `pda …`, `tm …`, `turing machine …`, `simulate pda on …`,
  `first and follow ⏎ …`, `remove left recursion`, `skolemize …`, `unify …`, `mgu of …`, `check
  … in domain …`, all 12 HM lines) and `pda for palindromes over {a,b}`.
- **Missing engine: 78 of 85.** Nothing answers them (the 7 table-SAT lines are the exception).

## B. Syntax and output

Five new engines in the DISCRETE kind's `ENGINES` list and one new verb in the λ kind. The
discrete engines share `automata.ts`'s block grammar (`keyword` line, `head: values` lines,
transition lines, `test:` lines; `tokens`, `normSymbol`, `parseTests` EXPORTED, not copied) and
are inserted BEFORE automata (so `pda`/`tm` are not "Expected dfa, nfa or regex"), BEFORE
propositional logic (so `S -> aSb` is a grammar) and BEFORE graph (so `S -> aSb ⏎ S -> ab` is
not a digraph). New order, pinned in `discrete.test.ts`: number theory → combinatorics →
recurrence → **grammar → pushdown → turing → first-order logic → sat** → automata →
propositional logic → graph. `solveDiscrete` wraps every engine in a `RangeError` → "nests too
deeply" refusal (the λ pattern at 1686), which also covers proplogic's 2,000-paren overflow.

**Guards (sketches; the routing test pins every §D input and every §A trap against them):**
- `GRAMMAR_RE = /^\s*(?:(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)\b[\s:]*)?(?:<[^>\n]+>|[A-Z][A-Za-z0-9_']*)\s*(?:->|→|::=)/m` AND
  the block has a terminal somewhere (lowercase letter, digit, quoted `"+"`, `ε`/`eps`/`epsilon`/
  `λ`/`lambda`, or a `|`). `A -> B ⏎ B -> C` (no terminal) stays a GRAPH and `p -> q` (lowercase
  LHS) stays LOGIC — both said in the tie-break test. Prose heads: `cnf|chomsky|cyk|member|
  derivation|parse tree|ambiguous|first|follow|nullable|useless|left recursion|to pda|equivalent`
  on their own line (first or last), or `test:` lines.
- `PDA_RE = /^\s*(?:pda|pushdown(?:\s+automaton)?|npda|dpda)\b/i`, `TM_RE = /^\s*(?:tm|turing(?:\s+machine)?|dtm)\b/i`
  — keyword-led like dfa/nfa; template names after the keyword (`tm binary increment 1011`).
- `FOL_RE = /[∀∃]|\b(?:forall|exists|prenex|skolemi[sz]e|clausal|clause\s+form|unify|mgu|most\s+general\s+unifier|resol(?:ve|ution)|model\s+check|in\s+(?:the\s+)?(?:model|domain|structure))\b/i`
  — claims before proplogic; a quantifier-free line without a FOL verb stays propositional.
- `SAT_RE = /^\s*(?:dpll|2[-\s]?sat|horn(?:[-\s]sat)?|unsat\s+core|resolution\s+proof|p\s+cnf\b|dimacs)\b/i`
  — or a bare CNF with MORE than `MAX_VARS` variables (proplogic refuses at 11; DPLL takes it).
  Bare `sat …`/`satisfiable …` ≤ 10 variables stay with proplogic's table (unchanged behaviour),
  and gain a line "DPLL: write dpll … for the search tree".
- λ kind: `HM_RE = /^\s*(?:hm|hindley[-\s]milner|algorithm\s+w|w\b|type\s+scheme(?:\s+of)?|principal\s+type\s+scheme|infer\s+scheme)\b/i`
  as a verb at lambda.ts 1611, AND the one-line `let NAME = term in term` form (balanced, `in`
  at depth 0 followed by whitespace) read BEFORE `DEF_RE` can call it a definition (1510/1600).
  Plain `type` on a `let … in …` line also routes to hm.

| Verb | Examples | Output / verification |
|---|---|---|
| Grammar: `S -> aSb \| ε` (one production per line or `,`-separated; `cfg`/`grammar` head optional; `->`/`→`/`::=`; `ε`/`eps`/`epsilon`/`λ`/`lambda`; UPPERCASE = nonterminal, everything else terminal, `<expr>` and quoted `"id"` are multi-character symbols; start = first LHS) · questions on a line: `test: aabb ab aab` · `member aabb` · `cnf` · `cyk aabb` · `derivation of aabb` · `parse tree for aabb` · `ambiguous?` · `first and follow` · `nullable` · `useless symbols` · `remove left recursion` | `S -> aSb \| ε ⏎ test: aabb ab aab` · `S -> S S \| a ⏎ is it ambiguous` · `E -> E + T \| T ⏎ T -> T * F \| F ⏎ F -> ( E ) \| id ⏎ remove left recursion` · `first and follow ⏎ E -> T E' ⏎ …` | Title "Context-free grammar — 1 nonterminal, 2 productions over {a, b}". Grammar echoed in the printer's form (`S → aSb \| ε`, re-parses). Membership: CNF listed (`S₀ → ε \| A X \| A B`, `S → A X \| A B`, `X → S B`, `A → a`, `B → b`; new names said), the CYK triangle as a text grid (row per length), verdict per test string with a leftmost derivation `S ⇒ aSb ⇒ aaSbb ⇒ aabb` and the parse tree DRAWN (`treeSvg`). Verified: CYK verdict vs BRUTE-FORCE derivation enumeration (BFS on sentential forms, terminal-prefix pruning, 20,000-form budget) on every test string ≤ 12 symbols — refuse on disagreement. Ambiguity: bounded search for one string with two distinct leftmost derivations, strings up to length 8 in length order, 20,000 forms; found → "AMBIGUOUS: aaa has 2 parse trees" with both trees drawn; not found → "no ambiguous string of length ≤ 8 found — ambiguity is UNDECIDABLE in general, so this is evidence, not a proof" by name. FIRST/FOLLOW/nullable as sets (fixpoint; `$` as end marker), useless symbols (unreachable ∪ non-generating, the reduced grammar printed), left recursion removed (immediate + indirect, Paull's ordering, new `E'` names said), ε-removal with the start-nullable note. `equivalent` → refused by name ("CFG equivalence is undecidable; the two grammars agree on all 62 strings of length ≤ 5 over {a,b}" — the sample comparison IS reported). |
| PDA block: `pda ⏎ states: … ⏎ alphabet: … ⏎ stack: Z A (first = bottom marker) ⏎ start: q0 ⏎ accept: q2` or `accept: empty stack` ⏎ transitions `q0 a Z -> q0 AZ` · `q0, a, Z -> q0, AZ` · `(q0, a, Z) -> (q0, AZ)` · `q0 a Z / AZ -> q0` (push string written top-first, `ε` = pop) ⏎ `test: aabb ab aab ""` | the aⁿbⁿ machine in §D · `cfg to pda S -> aSb \| ε ⏎ test: aabb` · `pda for a^n b^n` (template, ONE: aⁿbⁿ by final state) | "PDA, 3 states, stack alphabet {Z, A} — acceptance by FINAL STATE" (or "by EMPTY STACK", or "by final state AND empty stack" when both are declared — always said, because the two differ on the same machine). Per test string the run as a configuration table `(q0, aabb, Z) ⊢ (q0, abb, AZ) ⊢ …` with the stack drawn top-first; nondeterminism: BFS over configurations (cap 20,000, stack depth 200, ε-cycles cut by a visited set) — "accepted (one of 3 branches)" / "rejected: every branch died" / "search cap reached: UNKNOWN" by name. State diagram (`stateDiagramSvg`, edge labels `a, Z/AZ`) + configuration strip (`configStripSvg`). `cfg to pda`: the standard one-state construction (push S; `ε, A → α` per rule; `a, a → ε` per terminal; accept by empty stack), the 7-move run for aabb printed. Verified: for a PDA built FROM a grammar, acceptance of every test string equals the grammar's CYK membership — refuse on disagreement; for a typed PDA, the deterministic re-simulation of the accepting branch must reach the same configuration. Refuse by name: `pda for palindromes` and every other prose language except aⁿbⁿ ("design is not computed — type the machine"), a push string naming an undeclared stack symbol, DPDA claimed with two moves on one (state, input, top). |
| TM block: `tm ⏎ states: … ⏎ start: q0 ⏎ accept: halt ⏎ blank: _ ⏎` rules `q0 1 -> q0 1 R` · `q0, 1 -> q1, 0, L` · `δ(q0, 1) = (q1, 0, L)` ⏎ `tape: 1011` (head at cell 0 unless `head: n`) · templates `tm binary increment 1011` · `tm unary add 111+11` · `tm busy beaver 3` | the increment machine in §D · `tm ⏎ q0 1 -> q0 1 L ⏎ q0 _ -> q0 _ R ⏎ tape: 1` · `does this turing machine halt on every input ⏎ …` | "Turing machine, 3 states over tape alphabet {0, 1, _}"; the run as one line per step `3. (q0) 101[1] → write 1, R` with the tape strip DRAWN for the first 12 and last 3 steps (head cell boxed, state above); final tape, head position, step count. Halting status is a VERDICT with its reason: "halted in the accept state after 8 steps" / "halted: no rule for (q0, _) after 3 steps — not accepting" / "LOOPS: the configuration (q0, head 0, tape 1) recurred at step 2 — proven non-termination" (full-configuration repetition is a proof, since the tape content is finite) / "step cap 10,000 reached — UNKNOWN; a cap is not a proof of looping" by name. Templates print the machine they used, then run it. Verified: increment result = n + 1 in BigInt from the input bits; unary add = count of 1s; the trace re-simulated by an independent second stepper must agree on every (state, head, tape). Refuse by name: "halt on every input" / "does it halt" without a tape (the halting problem, undecidable — "I can run it on a tape you give me and report what happened within the cap"); `busy beaver n` → the known values table, stated as CITED facts (Σ(1..4) = 1, 4, 6, 13; S(1..4) = 1, 6, 21, 107; S(5) = 47,176,870, Σ(5) = 4,098 — proven 2024), nothing computed; multi-tape, 2-D, probabilistic. |
| FOL: `∀x (P(x) → Q(x))` with `∀ ∃ ¬ ∧ ∨ → ↔`, `forall x.`/`exists y.`, `->`/`<->`, `~`/`&`/`\|`, predicates `P(x, f(y))`, constants lowercase a–e / quoted, variables u–z (said; `var x y` overrides) · `prenex …` · `skolemize …` · `clausal form …` · `unify t₁ and t₂` / `mgu of t₁, t₂` / `unify t₁ with t₂` · `resolve Γ ⊢ φ` / `resolution: clauses` · `free variables of …` · `check φ in domain {1, 2}, R = {(1, 2), (2, 1)}` · `is φ valid` | `prenex ∀x P(x) → ∃y Q(y)` · `skolemize ∀x ∃y P(x, y)` · `unify f(x, x) and f(y, g(y))` · `resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)` · `∀x ∃y P(x, y) ⊢ ∃y ∀x P(x, y)` | Formula echoed in the printer's form (re-parses); free/bound variables; prenex (rectified first, renames said, ∀ in an antecedent flips to ∃ — the step shown); Skolem functions named `f₁, f₂` of the governing ∀-variables (said); clausal form as a set of clauses. MGU: Robinson with the occurs check, each binding printed `{x ↦ a, y ↦ b}`, both terms after the substitution shown EQUAL (that is the verification), failure by name ("occurs check: y would contain g(y)" / "clash f ≠ g" / "arity 1 ≠ 2"). Resolution: negate the goal, clausify, saturate with factoring (clause cap 500, 20,000 unifications); derivation as numbered lines `4. Q(a) from 1, 2 [x ↦ a]` and the refutation DAG DRAWN (`treeSvg`, DAG mode); verdicts: "REFUTED in 2 resolvents — the argument is VALID" / "SATURATED after 2 clauses, no refutation — the argument is INVALID (resolution is refutation-complete)" / "no refutation found within 500 clauses — UNKNOWN (FOL validity is only semi-decidable)" by name. Each resolvent re-verified by re-unifying its parents' complementary literals. Finite model check: domain ≤ 6, relations as tuple sets, functions as tables, every quantifier evaluated by enumeration (≤ 6⁶ = 46,656 cells), the witness/counter-witness printed ("false: x = 2 has no y"). `is φ valid` → resolution on ¬φ. Refuse by name: equality `=` (no paramodulation), arithmetic (`x > 0`, `x^2`) — "first-order logic without arithmetic; the Equation kind solves inequalities", second-order, infinite domains for `check`. |
| SAT: a CNF `(a ∨ ¬b) ∧ (b ∨ c)` (also `&`/`\|`/`~`, implications `a -> b` as Horn clauses, DIMACS `p cnf n m` + `1 -2 0` lines), verbs `dpll`, `2sat`/`2-sat`, `horn`, `unsat core`, `resolution proof` | `dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)` · `2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)` · `horn a, a -> b, b -> c, ~c` · `p cnf 3 2 ⏎ 1 -2 0 ⏎ 2 3 0` | "CNF, 3 variables, 2 clauses". DPLL: unit propagation, pure-literal rule, decisions in variable order (said), each step a line (`decide p = T · unit q = T from (¬p ∨ q) · conflict (¬p ∨ ¬q)`), the decision tree DRAWN (`treeSvg`, conflicts as ⊥ leaves, the model leaf highlighted); SAT → the model with EVERY clause re-evaluated (printed as a checklist) and "4 models in all" when ≤ 20 variables (brute force, 2·10⁶ clause-evaluation budget, else "count not computed"); UNSAT → a resolution refutation extracted from the conflict analysis, each resolvent verified, and the unsat core (the clauses the refutation used); brute-force agreement required when ≤ 20 variables. 2-SAT: implication graph (`graphSvg` with vertices `a`, `¬a`), `strongComponents`, "x and ¬x share an SCC" verdict, the model from the topological order — exact, polynomial, no DPLL. Horn: unit propagation only — "forced true: a, b, c; clause ¬c violated → UNSAT" or the minimal model. Caps said: 60 variables, 400 clauses, 200,000 DPLL decisions ("UNKNOWN: search budget" by name — never a guess), 2-SAT/Horn 2,000 clauses. Refuse by name: non-CNF under `dpll` ("convert first: write cnf … in the logic engine"), `pigeonhole n m` prose (the clauses are shown; type them). |
| HM (λ kind): `hm TERM` · `let NAME = TERM in TERM` (one line, nested lets allowed) · `let rec f = … in …` · `type` on a `let … in …` line · literals `0 1 2 … : int`, `true false : bool`, pairs `(e, e) : τ × τ` with `fst`/`snd`, `if c then a else b` — UNDER hm ONLY (the `type` verb keeps reading `1` as the Church numeral `λf.λx.f x : (α → β) → α → β`, said in a caveat) · the library names keep their λ-types | `hm let id = λx.x in (id 1, id true)` · `hm let id = λx.x in id id` · `hm λf.λx.f (f x)` · `hm (λid. id id) (λx.x)` · `hm λx.x x` · `hm let rec f = λx.f x in f` | "Hindley–Milner type · Term: … · Type: int × bool · Scheme: ∀α. α → α for id". Algorithm W as numbered steps: fresh variables, each unification with its substitution (`unify α → α with int → β ⇒ {α ↦ int, β ↦ int}`), GENERALISE at `let` (`id : ∀α. α → α — α is not free in Γ`), INSTANTIATE at each use (`id ↦ β → β`, `id ↦ γ → γ`), `let rec` by the monomorphic-recursion rule (said). Derivation tree DRAWN for ≤ 20 nodes (`treeSvg`; `LambdaResult.svg` added and rendered by the pane's λ block like `dr.svg`). Failures by name: "occurs check: α = α → β (λx.x x)", "clash int ≠ bool at f true — f is λ-bound, hence MONOMORPHIC; write let f = … in … for polymorphism", "unbound variable". Verified: pure-λ terms (no literals) — expand every `let` by substitution and run the EXISTING `principalType` on the result; the HM type must be α-equal to it (theorem: let-polymorphic typing = simple typing of the expansion, when the bound name is used; unused → one-way, said); terms with literals — the final substitution is applied to every node and each application node re-checked `f : τ₁ → τ₂, a : τ₁` syntactically. The printed scheme re-parses through `parseScheme` and unifies with the inferred type (display contract). |

Labels (`Type:`, `Scheme:`, `CNF:`, `⊢`) live in the text layer; every grammar, formula, clause
set, machine table and type scheme is printed by the engine's own printer and re-read by its own
reader in `computationDisplayContract.test.ts`. Glyphs: `→` for productions and implication in
OUTPUT (input accepts `->`, `=>` only in the logic reader, `::=` only in the grammar reader), `⇒`
for derivation steps, `ε` for the empty string, `∀ ∃ ¬ ∧ ∨ ↔ ⊢ ⊥ □`, `Γ` for the typing
environment, `×` for pairs, `α β γ δ` then `τ₁ τ₂` for type variables (lambda.ts's convention,
reused). Every cap is stated in the result's caveats by number.

## C. Build order and honest limits

1. **`src/lib/treeSvg.ts`** — the one missing figure builder: a layered top-down tree/DAG
   (Reingold–Tilford for trees; longest-path ranks for a DAG), nodes keyed by id (labels may
   repeat), box labels, highlighted path, ⊥/□ leaves, caption; 460 × (depth-scaled) px, ≤ 200
   nodes drawn, "… 37 more nodes not drawn" by name. Used by parse trees, derivations, DPLL
   trees, resolution DAGs, W derivations. `configStripSvg` (tape cells / stack columns per
   step) and `stateDiagramSvg` (the drawing half of `machineSvg` extracted, taking an edge list
   with free-text labels — `machineSvg` becomes a caller of it) go in `automata.ts`/`machines.ts`.
2. **`src/lib/grammar.ts`** — reader (symbol conventions above, `<expr>`/quoted multi-char
   symbols, `|` alternation at depth 0, `ε` spellings via the exported `normSymbol`), printer,
   ε-removal, unit-removal, CNF, CYK (exact, with the table), leftmost derivation + tree from
   the CYK back-pointers, brute-force derivation enumerator (the cross-check — a SEPARATE
   algorithm), ambiguity witness search, FIRST/FOLLOW/nullable, useless symbols, left
   recursion. Caps: 30 nonterminals, 100 productions, test strings ≤ 40 symbols, cross-check
   ≤ 12, ambiguity length ≤ 8 / 20,000 forms.
3. **`src/lib/pda.ts`** — block reader on the shared grammar (`stack:` head; `accept: empty
   stack`), configuration-BFS simulator with caps, CFG→PDA construction, `pda for a^n b^n`
   template, acceptance-mode statement. Cross-check against `grammar.ts` membership.
4. **`src/lib/turing.ts`** — block reader (three rule spellings incl. `δ(q, s) = (q', s', D)`,
   `blank:`, `head:`), stepper with configuration-repeat detection (proof of looping) and the
   10,000-step cap, independent second stepper for the trace check, templates (binary
   increment, unary add) with BigInt oracles, busy-beaver citation table.
5. **`src/lib/fol.ts`** — ITERATIVE formula parser (shunting-yard with explicit stacks; depth
   cap 400 checked before any walker, the λ pattern), printer, free/bound, rectification,
   prenex, Skolem, clausal form, Robinson unification (occurs check), resolution with
   factoring and the clause/unification caps, finite-model evaluator (domain ≤ 6). Everything
   here is exact; the only non-verdict is "UNKNOWN within the cap", by name.
6. **`src/lib/sat.ts`** — CNF reader (symbolic, `->` Horn clauses, DIMACS), DPLL with trace +
   tree, resolution-proof extraction + unsat core, brute-force model counter (≤ 20 vars,
   budgeted), 2-SAT via `strongComponents` (export a `buildGraph` from `graphs.ts` — no
   print-and-reparse), Horn unit propagation. Proplogic keeps `sat`/`cnf`/`dnf` ≤ 10 vars.
7. **HM in `lambda.ts`** — `Ty` gains `con` (int, bool) and `pair`; `Scheme {vars, ty}`;
   `Term` gains `let`/`letrec`/`lit`/`pair`/`if` under the hm reader ONLY (the reducer never
   sees them: hm is a typing verb); Algorithm W with a step log; `principalType` untouched and
   used as the cross-check. `LambdaResult.svg` + pane wiring (28626–28653, as 28676–28683).
8. **Routing** — `ENGINES` order (discrete.ts 59–68) + the "Not recognised" list (76–85) + the
   pane hint (28667) + `SOLVE_DISCRETE` groups "Grammars", "Machines", "First-order logic",
   "SAT" and `SOLVE_LAMBDA` "Hindley–Milner" + `examples.ts` 425; `discrete.test.ts` tie-break
   pins updated (grammar vs graph vs logic, by terminal presence and LHS case); an equation-kind
   switch to the discrete kind when `GRAMMAR_RE|PDA_RE|TM_RE|FOL_RE|SAT_RE` matches AND
   `solveDiscrete` answers (the 28385 pattern, fired BEFORE the `->`-is-an-inequality path at
   27902); `computationRouting.test.ts` on the pane source; `figure-layout-run.ts` entries
   (parse tree, DPLL tree, resolution DAG, TM strip, PDA diagram, W derivation) and
   `CORPUS_FLOOR` 183 → 189; display-contract test; an independent adversarial pass over the
   diff (house rule); then §D as the exit test.

Honest limits, stated in output every time they bind: ambiguity and CFG/PDA/TM equivalence
are undecidable (bounded evidence only, said); FOL validity is semi-decidable (a refutation is
a proof, "not found" is not); a TM step cap is not a loop verdict (only configuration repetition
is); DPLL is exponential (budget by name); HM is rank-1 (λ-bound names are monomorphic — the
refusal names the fix); no equality/arithmetic in FOL; one prose template per machine family.

## D. Acceptance audit

Every expected value below was computed by an independent throwaway oracle (own TM stepper
with configuration-repeat detection, own CYK over a hand-built CNF, own BFS derivation
enumerator, own brute-force SAT counter, own Kosaraju 2-SAT, own Robinson unifier) and, for
the λ types, by hand and against `principalType` on the expansion.

Grammars: `S -> aSb | ε ⏎ test: aabb ab aab ba ""` → CNF `S₀ → ε | A X | A B`, `S → A X | A B`,
`X → S B`, `A → a`, `B → b`; CYK for aabb: len 1 `{A} {A} {B} {B}`, len 2 `∅ {S₀,S} ∅`, len 3
`∅ {X}`, len 4 `{S₀,S}` → accepted; `S ⇒ aSb ⇒ aaSbb ⇒ aabb`, tree drawn (7 nodes); ab
accepted; aab rejected; ba rejected; "" accepted ("the start symbol is nullable") · `S → aSb |
λ`, `S -> aSb | eps`, `S ::= aSb | epsilon`, `cfg S -> aSb | ε` → identical · `S -> S S | a ⏎ is
it ambiguous` → "AMBIGUOUS: aaa has 2 parse trees" (aaaa has 5), both trees drawn; `S -> aSb |
ε ⏎ ambiguous?` → "no ambiguous string of length ≤ 8 found — not a proof" · `E -> E + T | T ⏎ T
-> T * F | F ⏎ F -> ( E ) | id ⏎ remove left recursion` → `E → T E'`, `E' → + T E' | ε`, `T → F
T'`, `T' → * F T' | ε`, `F → ( E ) | id` · `first and follow ⏎ E -> T E' ⏎ E' -> + T E' | ε ⏎ T ->
F T' ⏎ T' -> * F T' | ε ⏎ F -> ( E ) | id` → FIRST(E) = FIRST(T) = FIRST(F) = {(, id}; FIRST(E') =
{+, ε}; FIRST(T') = {*, ε}; FOLLOW(E) = FOLLOW(E') = {), $}; FOLLOW(T) = FOLLOW(T') = {+, ), $};
FOLLOW(F) = {*, +, ), $} · `nullable S -> AB, A -> a | ε, B -> b | ε` → nullable = {A, B, S} ·
`S -> A | a ⏎ A -> a ⏎ B -> b ⏎ useless symbols` → "B is unreachable; reduced: S → A | a, A → a"
· `S -> 0S1 | 01 ⏎ derivation of 0011` → `S ⇒ 0S1 ⇒ 0011` (NEVER the fold note "3x2 → 3x²") ·
`<expr> -> <expr> + <term> | <term> ⏎ <term> -> id ⏎ test: id+id` → accepted, tree drawn with
`<expr>` nodes · `is the grammar S -> aSb | ε equivalent to S -> ab | aSb` → refusal by name +
"they differ on "" (length 0): the first accepts it, the second does not" · `S -> aSb` (one
line, discrete kind) → a grammar, "no test string — add test: …", NEVER "Truth table · S → aSb"
· `S -> aSb ⏎ S -> ab` → grammar, never "Graph · 3 vertices" · `A -> B ⏎ B -> C` → graph
(unchanged, said: "no terminal symbol, read as an edge list") · `p -> q` → truth table
(unchanged).

PDA: `pda ⏎ states: q0 q1 q2 ⏎ alphabet: a b ⏎ stack: Z A ⏎ start: q0 ⏎ accept: q2 ⏎ q0 a Z ->
q0 AZ ⏎ q0 a A -> q0 AA ⏎ q0 b A -> q1 ε ⏎ q1 b A -> q1 ε ⏎ q1 ε Z -> q2 Z ⏎ test: aabb ab aab ""`
→ "acceptance by final state"; aabb: `(q0, aabb, Z) ⊢ (q0, abb, AZ) ⊢ (q0, bb, AAZ) ⊢ (q1, b,
AZ) ⊢ (q1, ε, Z) ⊢ (q2, ε, Z)` accepted in 5 moves; ab accepted (3 moves); aab rejected ("stuck
at (q1, ε, AZ): no move"); "" REJECTED with the note "q0 has no ε-move: this machine does not
accept the empty string although aⁿbⁿ includes it" · the `(q0, a, Z) -> (q0, AZ)` and `q0, a, Z
-> q0, AZ` and `q0 a Z / AZ -> q0` spellings → identical · `… accept: empty stack ⏎ … q1 ε Z ->
q1 ε` → "acceptance by empty stack", aabb accepted · `cfg to pda S -> aSb | ε ⏎ test: aabb` →
one-state PDA, 7 moves `(q, aabb, S) ⊢ (q, aabb, aSb) ⊢ (q, abb, Sb) ⊢ (q, abb, aSbb) ⊢ (q, bb,
Sbb) ⊢ (q, bb, bb) ⊢ (q, b, b) ⊢ (q, ε, ε)`, "agrees with CYK on 4 of 4 test strings" · `pda for
a^n b^n` → the template above, printed, then run on `test:` if given, NEVER "more than one
unknown (pda, for, a, n, b)" · `pda for palindromes over {a,b}` → refusal by name · `pda ⏎ …
⏎ q0 a Z -> q0 BZ` (B undeclared) → refusal naming B.

Turing machines: `tm ⏎ states: q0 q1 halt ⏎ start: q0 ⏎ accept: halt ⏎ blank: _ ⏎ q0 0 -> q0 0 R
⏎ q0 1 -> q0 1 R ⏎ q0 _ -> q1 _ L ⏎ q1 1 -> q1 0 L ⏎ q1 0 -> halt 1 R ⏎ q1 _ -> halt 1 R ⏎ tape:
1011` → halted in `halt` after 8 steps, tape `1100`, strip drawn, "1011₂ + 1 = 1100₂ = 12,
verified" · same machine `tape: 111` → 8 steps, `1000` · `tm binary increment 1011` → the same
machine printed, same result · `tm unary add 111+11` → template `q0 1→1R; q0 +→1R→q1; q1 1→1R;
q1 _→_L→q2; q2 1→_L→halt`, 8 steps, tape `11111` (3 + 2 = 5, verified) · `turing machine ⏎ q0 a
-> q0 a R ⏎ tape: aaa` → "halted: no rule for (q0, _) after 3 steps — not accepting (no accept
state declared)", NOT "loops" · `tm ⏎ start: q0 ⏎ q0 1 -> q0 1 L ⏎ q0 _ -> q0 _ R ⏎ tape: 1` →
"LOOPS: configuration (q0, head 0, tape 1) recurred at step 2 — proven" · `tm ⏎ δ(q0, 0) = (q1,
1, R) ⏎ δ(q1, 0) = (q0, 1, L) ⏎ tape: 00` → 2 steps, tape `11`, "no rule for (q0, 1)", never
"Couldn't parse that system" · `does this turing machine halt on every input ⏎ …` → refusal by
name (halting problem) + "give me a tape: and I will run it" · `busy beaver 3` → the citation
table, "Σ(3) = 6, S(3) = 21", nothing computed, NEVER "Normal form: busy beaver (λf.λx.f (f (f
x)))" · any machine without `tape:` → "needs a tape: line".

First-order logic: `∀x (P(x) → Q(x))` → echoed, "closed (no free variables); prenex already;
clauses: {¬P(x), Q(x)}" · `forall x. P(x) -> exists y. Q(x, y)` → `∀x (P(x) → ∃y Q(x, y))` ·
`free variables of ∀x P(x, y) ∧ Q(z)` → free {y, z}, bound {x} · `prenex ∀x P(x) → ∃y Q(y)` →
`∃x ∃y (P(x) → Q(y))` with the flip step named · `skolemize ∀x ∃y P(x, y)` → `∀x P(x, f₁(x))` ·
`clausal form ∀x (P(x) → ∃y Q(x, y))` → `{¬P(x), Q(x, f₁(x))}` · `unify P(x, f(y)) and P(a,
f(b))` → `{x ↦ a, y ↦ b}`, both → `P(a, f(b))` · `unify f(x, x) and f(y, g(y))` → "no unifier:
occurs check — y would have to contain g(y)" · `mgu of P(x, g(x)), P(f(y), z)` → `{x ↦ f(y), z ↦
g(f(y))}`, both → `P(f(y), g(f(y)))` · `unify f(x) with g(x)` → "clash: f ≠ g", NEVER "Normal
form: unify f x with g x" · `resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)` → clauses 1 `{¬P(x), Q(x)}`,
2 `{P(a)}`, 3 `{¬Q(a)}` (negated goal); 4 `{Q(a)}` from 1, 2 [x ↦ a]; 5 `□` from 3, 4; "VALID
(refuted in 2 resolvents)", DAG drawn · `resolution: P(a), ∀x (P(x) → Q(x)), ¬Q(a)` → "UNSATISFIABLE"
with the same derivation · `is ∀x P(x) → P(a) valid` → VALID, 1 resolvent `{P(x)}, {¬P(a)} → □
[x ↦ a]` · `∀x ∃y P(x, y) ⊢ ∃y ∀x P(x, y)` → clauses `{P(x, f₁(x))}`, `{¬P(g₁(y), y)}`;
"SATURATED: the only pair fails the occurs check (y in f₁(g₁(y))) — INVALID"; countermodel
offered: domain {1, 2}, P = {(1, 2), (2, 1)} · `∃x ∀y (P(x) ∧ ¬P(y))` → unsatisfiable: `{P(c₁)},
{¬P(y)} → □ [y ↦ c₁]` · `check ∀x ∃y R(x, y) in domain {1, 2}, R = {(1, 2), (2, 1)}` → TRUE (x=1:
y=2; x=2: y=1); `check ∃y ∀x R(x, y) in …` → FALSE ("y = 1 fails at x = 1; y = 2 fails at x =
2") · `∀x (x > 0 → x^2 > 0)` → refusal by name (arithmetic), never the inequality text.

SAT: `(a ∨ ¬b) ∧ (b ∨ c)` ≤ 10 vars → unchanged table answer + the DPLL pointer · `dpll (a ∨
¬b) ∧ (b ∨ c)` → pure a = T, pure b = T, c = F; model a=T b=T c=F, every clause ✓, "4 models" ·
`dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)` → decide p=T: unit q=T, conflict (¬p ∨ ¬q);
p=F: unit q=T, conflict (p ∨ ¬q) → UNSAT; refutation `(p ∨ q),(¬p ∨ q) ⇒ q; (p ∨ ¬q),(¬p ∨ ¬q)
⇒ ¬q; q, ¬q ⇒ □`; core = all 4; tree drawn (2 branches) · `p cnf 3 2 ⏎ 1 -2 0 ⏎ 2 3 0` → `(x₁ ∨
¬x₂) ∧ (x₂ ∨ x₃)`, SAT, model x₁=T x₂=T x₃=F (or any of the 4), "4 models", NEVER "more than one
unknown (p, cnf)" · `2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)` → implication edges `¬x1→x2, ¬x2→x1,
x1→x2, ¬x2→¬x1, x2→x1, ¬x1→¬x2`; SCCs {x1, x2}, {¬x1, ¬x2}; SAT; model x1=T x2=T ("the only
model"); graph drawn · `2-sat (a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) ∧ (¬a ∨ ¬b)` → one SCC {a, ¬a, b,
¬b} → UNSAT ("a and ¬a in the same component") · `horn a, a -> b, b -> c, ~c` → forced a, b, c;
`¬c` violated → UNSAT · `is (a ∨ b) ∧ (¬a ∨ ¬b) satisfiable` → yes, a=T b=F (table path, unchanged
semantics, the leading "is" and trailing "satisfiable" stripped) · `unsat core (a) ∧ (¬a) ∧ (b ∨
c)` → core {a, ¬a} · `dpll (a ∨ b ∨ c) ∧ (¬a ∨ b) ∧ (¬b ∨ c) ∧ (¬c ∨ a) ∧ (¬a ∨ ¬b ∨ ¬c)` → a=T ⇒
b ⇒ c ⇒ conflict; a=F ⇒ ¬c ⇒ ¬b ⇒ conflict → UNSAT in 2 branches · `pigeonhole 3 pigeons 2 holes`
→ refusal by name showing the 9 clauses over p₁₁…p₃₂ (UNSAT when typed, 0 models) · an 11-variable
CNF → DPLL, never "above the 10-variable cap".

Hindley–Milner: `hm let id = λx.x in (id 1, id true)` → `int × bool`; `id : ∀α. α → α`;
instantiations α ↦ int, α ↦ bool; W steps listed; NEVER "That line is a definition" · `hm let id
= λx.x in id id` → `α → α` (scheme `∀α. α → α`; the two instances `(β → β) → β → β` and `β → β`
shown) · `type let id = λx.x in id id` → same · `hm λf.λx.f (f x)` → `(α → α) → α → α`, NEVER
"Normal form: hm (…)" · `hm (λid. id id) (λx.x)` → "not typable: id is λ-bound (monomorphic):
α = α → β fails the occurs check — write let id = λx.x in id id" · `hm let twice = λf.λx.f (f x)
in twice twice` → `(α → α) → α → α`, cross-checked equal to `principalType` of the expansion ·
`hm λx.x x` → occurs check `α = α → β` · `hm λx.λy.x` / `algorithm w λx.λy.x` / `type scheme of
λx.λy.x` → `α → β → α`, scheme `∀α β. α → β → α`, NEVER "Type: α" for `scheme of (…)` · `hm let
compose = λf.λg.λx.f (g x) in compose` → `(α → β) → (γ → α) → γ → β`, scheme ∀α β γ · `hm let rec
f = λx.f x in f` → `α → β`, scheme `∀α β. α → β` (NOT "not simply typable") · `hm λf.(f 1, f
true)` → "not typable: f is λ-bound, int ≠ bool at f true" · `hm if true then 1 else 2` → `int`
· `hm λx. if x then 1 else 0` → `bool → int` · `type 1` → unchanged `(α → β) → α → β` with the
caveat "under hm, 1 : int" · `let id = λx.x ⏎ type PAIR (id 1) (id TRUE)` → unchanged.

## E. Codebase-specific risks

1. **Grammars are logic or graphs today.** `STRONG` (proplogic 38) claims any `|` or `->`
   line, so `S -> aSb` is a truth table over the variable `aSb`; two such lines are a digraph
   (`EDGE_RE` 87 accepts `aSb` as a NAME). The grammar engine must precede both in `ENGINES`,
   and the tie-break (uppercase LHS + a terminal or `|` ⇒ grammar; `A -> B ⏎ B -> C` stays a
   graph; `p -> q` stays logic) must be pinned in `discrete.test.ts` beside lines 30–39.
2. **`ε` kills the neighbours.** `tokenize` throws `Unexpected character "ε"`; the automata
   reader's `normSymbol` (566) already folds `eps|epsilon|lambda|λ|ε` — export and reuse it in
   the grammar and PDA readers, and accept `λ` as ε ONLY there (in the λ kind `λ` is a binder).
3. **The λ kind's `DEF_RE` (1510) swallows `let … in …`.** One-line let-expressions are refused
   as "That line is a definition"; `S => aSb` matched `=` too. The hm reader runs BEFORE the
   definition loop (1565) on any line whose top-level `in` follows a balanced `let NAME = …`.
4. **Prose in the λ kind becomes free variables** ("Normal form: hm (λf…)", "busy beaver (λf…)",
   "unify f x with g x" — six probe inputs, each with "0 β-steps" and "type α"). The hm verb
   regex joins the verb table at 1611; unknown leading words followed by a λ-term should be
   refused by name ("hm, type, free, … are the verbs; "scheme of" is not a term"), never
   reduced — pin in `lambda.test.ts`.
5. **`->` is an inequality in the equation kind** (`/[<>≤≥≠]|!=/` at 27902 sees the `>`): 28
   probe inputs got the rational-inequality refusal. The equation→discrete switch (§C.8) runs
   before that test and only when `solveDiscrete` answers; the fold's stacked-fraction and
   degraded-superscript rewrites ("(E -> T E')/(T -> F T')", "3x2 → 3x²" on `0S1`) and the
   prose-line drop ("1 line of prose around it ignored" — the QUESTION) never run on text the
   guard claims (decide on the RAW input, as `lp:` does at 27679).
6. **Recursive descent overflows.** `parseFormula` dies at 2,000 parens with a `RangeError` the
   pane does not catch (28660 rethrows non-`DiscreteError`s). The FOL/grammar/CNF readers are
   iterative with a depth cap checked right after the parse (lambda.ts 1551–1556); `solveDiscrete`
   gains the `RangeError` → refusal wrapper (lambda.ts 1686) so proplogic is covered too.
7. **`Machine.trans` is one symbol per edge** and `parseBlock` enforces single-character
   alphabet symbols (656): a PDA edge `a, Z/AZ` and a TM edge `1/0, L` do not fit. Share the
   block grammar (heads, `tokens`, `parseTests`, caps), not the `Machine` record; extract the
   drawing half of `machineSvg` into `stateDiagramSvg(edges)` rather than copying 150 lines.
8. **No tree builder exists.** `buildHierarchySvg` merges equal path prefixes (two `S`
   children collapse into one); `bayesTreeSvg` is private and two-level. Six verbs need a
   tree/DAG: build `treeSvg` once, first.
9. **`LambdaResult` has no `svg`** and the pane's λ block renders none (28626–28653): the W
   derivation figure needs the field AND the pane wiring (copy the `dr.svg` block, 28676–28683)
   — "preview is not insert": add it to `figure-layout-run.ts` and the corpus floor.
10. **Unbounded loops freeze Word.** Every simulation and search here is potentially infinite
    (PDA ε-cycles, TM runs, resolution, DPLL, derivation enumeration, ambiguity search,
    unification on cyclic bindings). Every cap in §C is checked BEFORE the work with an
    `incomplete`/`unknown` verdict by name; configuration-repeat detection makes "loops" a
    proof and the cap an honest "unknown" — the two must never share a sentence.
11. **`sat`/`cnf`/`satisfiable` are already proplogic's verbs** (`VERB_RE` 298). The SAT engine
    claims only `dpll|2sat|horn|unsat core|p cnf|dimacs` and >10-variable CNFs; the table path
    keeps its exact answers — pinned both ways so neither engine steals the other.
12. **Display contract.** The discrete and λ kinds are not typeset (`renderSolveTypeset` 27432
    returns for them) — glyphs go straight into text lines and into Word via `say()`. Each
    printer/reader pair (grammar, formula, clause set, machine table, type scheme) is pinned
    round-trip in `computationDisplayContract.test.ts`; `⇒` (derivation) is never accepted as
    a production arrow, `=>` never as one either (logic implication), and `→` is both the
    production arrow and implication — disambiguated by engine, never by guessing.
13. **`let`-expansion already types polymorphically** (two-line `let id = … ⏎ type …`). The hm
    verb must agree with `principalType` on every pure-λ §D input — that agreement IS the
    cross-check, and a disagreement is a defect in the new code, not a different convention.
14. **Literals change meaning between verbs** (`1` is a Church numeral under `type`, `int`
    under `hm`): both results carry the one-line caveat naming the other reading.
15. **`graphs.ts` has no constructor** — `markov.ts` prints edge lines and re-parses them
    (194, 262), which would turn `¬a` into whatever `NAME` admits. Export `buildGraph(names,
    edges, directed)` from the parse half of `parseGraph` and use it for the implication graph.
