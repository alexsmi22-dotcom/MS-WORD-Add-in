/**
 * Which kind owns a computation-theory line typed into the DEFAULT Equation
 * kind (v2.133.0). One decision function, called by the pane AND by the
 * tests, so the tests cannot drift from what the pane does (the review found
 * 25 steals in a first version whose condition was copied by hand).
 *
 * The rules, each one a lesson from the independent review:
 *  - A line containing "=" is an EQUATION unless it is a Turing rule written
 *    δ(q, s) = (…): `tm = 5`, `horn = 2`, `2-sat x = 4`, `Q = 5 ⏎ P -> 2`
 *    were all switched away from the solver.
 *  - Keyword-led requests switch even when the engine REFUSES (the refusal
 *    names the fix) — but only when the keyword OPENS the input as a word
 *    (`pda …`, `tm …`, `dpll …`, `horn a, …`, `p cnf …`), never as a variable
 *    (`tm(x)`, `pda + 1`).
 *  - A grammar switches only on an ANSWER and only when it is unmistakably a
 *    grammar: a `cfg`/`grammar` head, an alternation `|`, an ε, two or more
 *    productions, or a question line (`test:`, `is it ambiguous`, …). A single
 *    arrow line is ordinary maths: `X -> 0`, `N -> infinity`, `E -> mc^2`,
 *    `T -> 2T + 1`, `F -> 0 as x -> infinity`.
 *  - First-order logic (its guard includes the words resolve, unify, exists)
 *    switches only on an ANSWER.
 *  - Hindley–Milner switches when the line OPENS with `hm` (a "not typable"
 *    verdict is still the answer to an hm request), or with a `let … in`
 *    that actually types; a bare `w x` never switches.
 */
import { solveDiscrete, DiscreteError } from "./discrete";
import { GRAMMAR_RE } from "./grammar";
import { PDA_RE } from "./pda";
import { TM_RE } from "./turing";
import { FOL_RE } from "./fol";
import { SAT_RE } from "./sat";
import { solveLambda } from "./lambda";

/** A machine / SAT / grammar keyword OPENING the input as a word — not a variable in an expression. */
// The keyword must not be followed by an operator (`pda + 1`) or glued to a
// parenthesis (`tm(x)`); `dpll (p ∨ q) …` — a space, then the formula — is fine.
// The halting question opens with "does/will … turing machine" (a bare
// "machine" only when the line asks about halting, as TM_RE does).
const KEYWORD_OPEN =
  /^\s*(?:(?:pda|pushdown(?:\s+automaton)?|npda|dpda|tm|turing(?:\s+machine)?|dtm|ntm|busy\s+beaver|dpll|2[-\s]?sat|horn(?:[-\s]sat)?|unsat\s+core|resolution\s+proof|p\s+cnf|dimacs|cfg|grammar|context[-\s]free(?:\s+grammar)?)\b(?!\s*[=+\-*/^]|\()|(?:does|will|would|can)\s+(?:(?:this|the|that|a|an|my|it)\s+)?(?:turing(?:\s+machine)?|tm|machine(?=[^\n]*\bhalt))\b)/i;

const QUESTION_LINE =
  /^\s*(?:test\s*:|member\b|cnf\b|cyk\b|derivation\b|parse\s+tree\b|(?:is\s+(?:it|the\s+grammar)\s+)?ambiguous\b|first\b|follow\b|nullable\b|useless\b|remove\s+left\s+recursion\b|left\s+recursion\b|equivalent\b|cfg\s+to\s+pda\b)/im;

const PRODUCTION_LINE = /^\s*(?:<[^>\n]+>|[A-Z][A-Za-z0-9_']*)\s*(?:->|→|::=)/;

const HM_OPEN = /^\s*(?:hm|hindley[-\s]milner|algorithm\s+w|type\s+scheme(?:\s+of)?|principal\s+type\s+scheme|infer\s+scheme)\b/i;
const LET_IN = /^\s*let\s+(?:rec\s+)?[A-Za-z_]\w*\s*=[\s\S]*\bin\s/;
const TYPE_OPEN = /^\s*(?:type(?:\s+of)?|typeof|infer(?:\s+the)?\s+type(?:\s+of)?|principal\s+type(?:\s+of)?)\s/i;
const LAMBDA_LEAD = /^\s*(?:λ|\\)\s*[A-Za-z_]\w*\s*\./;
const LAMBDA_ABS = /(?:λ|\\)\s*[A-Za-z_]\w*\s*\./;

export function computationKindFor(raw0: string): "discrete" | "lambda" | null {
  const raw = raw0.replace(/\r/g, "").trim();
  if (!raw) return null;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const hasEquation = lines.some((l) => /=/.test(l) && !/^δ\s*\(/.test(l) && !/^\s*(?:let|hm)\b/.test(l) && !/=[<>]|[<>]=/.test(l));

  const keywordLed = !hasEquation && KEYWORD_OPEN.test(raw) && (PDA_RE.test(raw) || TM_RE.test(raw) || SAT_RE.test(raw) || GRAMMAR_RE.test(raw));
  const productions = lines.filter((l) => PRODUCTION_LINE.test(l)).length;
  const grammarShape =
    !hasEquation &&
    GRAMMAR_RE.test(raw) &&
    (/^\s*(?:cfg|grammar|context[-\s]free)\b/i.test(raw) || /\|/.test(raw) || /ε|\beps(?:ilon)?\b/i.test(raw) || productions >= 2 || QUESTION_LINE.test(raw));
  const wordLed = FOL_RE.test(raw);

  if (keywordLed || grammarShape || wordLed) {
    let answered = false;
    let refused = false;
    try {
      const dr = solveDiscrete(raw);
      answered = !!dr && dr.title !== "Not recognised";
    } catch (err) {
      refused = err instanceof DiscreteError;
    }
    if (answered || (keywordLed && refused)) return "discrete";
  }

  // "type λx.λy.x" and a bare λ-abstraction typed into the default kind were
  // "Couldn't parse that equation" (review 2026-10-24). Only the abstraction
  // shape λx. … (or \x. …) claims a line — "λ = 1e6" is a Poisson rate.
  if (!hasEquation && (TYPE_OPEN.test(raw) || LAMBDA_LEAD.test(raw)) && LAMBDA_ABS.test(raw)) {
    let lr = null;
    try {
      lr = solveLambda(raw);
    } catch {
      lr = null;
    }
    if (lr && lr.title !== "Not recognised") return "lambda";
  }
  const hmOpen = HM_OPEN.test(raw);
  if (hmOpen || LET_IN.test(raw)) {
    let lr = null;
    try {
      lr = solveLambda(raw);
    } catch {
      lr = null;
    }
    if (lr && lr.title === "Hindley–Milner type") {
      const typed = lr.display.some((l) => /^Type: /.test(l));
      if (hmOpen || typed) return "lambda";
    }
  }
  return null;
}
