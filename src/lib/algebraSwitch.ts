/**
 * Which kind owns an ABSTRACT-ALGEBRA or NUMBER-THEORY line typed into the
 * DEFAULT Equation kind (v2.134.0, SCOPE-ABSTRACT-ALGEBRA §B, §E.1–2). One
 * decision function, called by the pane AND by the tests (the ctSwitch.ts
 * pattern: a condition copied by hand drifts).
 *
 * The pane must call it with the RAW input (solveInput.value) — the equation
 * fold has already turned × into * and ℤ into a note by the time `text`
 * exists — and BEFORE transformVerb is consulted, before the derivative/
 * limit switches and before the verb chain (`lagrange:` is an interpolation
 * keyword there — INTERP_VERB_RE — and `<3>` an inequality). The pane-source
 * routing test should pin `lagrange: subgroups of order 4 in Z/12` and
 * `lagrange's theorem for Z/12` reaching this switch.
 *
 * The rules:
 *  - Algebra switches on an ANSWER from tryAlgebra. The engine claims only
 *    inputs it parses completely, so `S3 = 5`, `F_2 = m*a`, `z/6 = 3`,
 *    `x^2 = e` (Euler's e) and every ordinary equation stay in the Equation kind.
 *  - Algebra also switches on a REFUSAL (DiscreteError) from tryAlgebra:
 *    the engine throws only for a recognised algebra request (a cap — S₆,
 *    GF(2048), groups of order 16; a presentation `a^2 = e, b^3 = e`;
 *    `GF(6)`; a non-group Cayley table), and the refusal names the fix,
 *    where the Equation kind would print "S6 = 0".
 *  - Number theory switches when the line ENDS in `mod n` / `(mod n)` (or
 *    holds ≡) and the number-theory engine answers or refuses it: `7^100
 *    mod 13`, `inverse 5 mod 12`, `x^2 = 2 mod 7` were "mod = 0" in the
 *    Equation kind. A line with `mod` that number theory does not read
 *    stays put.
 *
 * Integration: in taskpane, right after the fold and BEFORE transformVerb
 * and the derivative switch —
 *   const ak = algebraKindFor(solveInput.value);
 *   if (ak) { solveKind.value = ak; updateSolveUi(); updateSolve();
 *             note(algebraSwitchNote(solveInput.value)); return; }
 */
import { tryAlgebra } from "./algebra";
import { tryNumberTheory } from "./numtheory";
import { DiscreteError, foldSuperscripts } from "./discrete";

export type AlgebraSwitchReason = "algebra" | "number theory";

export const ALGEBRA_SWITCH_NOTE = "The question is ABSTRACT ALGEBRA — switched to the Discrete math kind and answered.";
export const NUMBER_THEORY_SWITCH_NOTE = "The question is NUMBER THEORY — switched to the Discrete math kind and answered.";

const MOD_TAIL = /\bmod(?:ulo)?\s*-?\d+\s*\)?\s*$|≡/i;
const HEADING = /^\s*(?:the\s+)?(?:(?:a\s+)?group\s+(?:with|given\s+by|defined\s+by)\s+(?:the\s+|this\s+)?)?(?:cayley|multiplication|operation|group)\s+table\s*:?\s*$/i;
const NAMED = /^\s*[A-Za-zα-ω]\w*\s*=\s*\(\s*\d/;

/** Why the line belongs to the Discrete math kind, or null when it stays in the Equation kind. */
export function algebraSwitchReason(raw0: string): AlgebraSwitchReason | null {
  const raw = raw0.replace(/\r/g, "").trim();
  if (!raw || raw.length > 4000) return null;
  // Multi-line input switches for algebra only with a Cayley-table heading or
  // named permutations: a bare grid "1 0 ⏎ 0 1" is a matrix in the Equation
  // kind, even though it is also a Latin square.
  const multi = raw.includes("\n");
  const algebraShaped = !multi || HEADING.test(raw.split("\n")[0]) || NAMED.test(raw);
  if (algebraShaped) {
    try {
      if (tryAlgebra(raw)) return "algebra";
    } catch (err) {
      if (err instanceof DiscreteError) return "algebra";
      if (!(err instanceof RangeError)) throw err;
    }
  }
  if (MOD_TAIL.test(raw)) {
    try {
      if (tryNumberTheory(foldSuperscripts(raw))) return "number theory";
    } catch (err) {
      if (err instanceof DiscreteError) return "number theory";
      throw err;
    }
  }
  return null;
}

/** "discrete" when the Equation kind should hand the line to the Discrete math kind; null to leave it. */
export function algebraKindFor(raw: string): "discrete" | null {
  return algebraSwitchReason(raw) ? "discrete" : null;
}

/** The note the pane inserts when it switches. */
export function algebraSwitchNote(raw: string): string | null {
  const r = algebraSwitchReason(raw);
  return r === "algebra" ? ALGEBRA_SWITCH_NOTE : r === "number theory" ? NUMBER_THEORY_SWITCH_NOTE : null;
}
