// The student pack's ONE decision for the Solve pane (release A): significant
// figures and Monte Carlo uncertainty, both word-led, both reading the RAW
// input (solveInput.value) — the paste fold drops the "." of "1200." and
// notes that "± means two expressions", neither of which is true here.
//
// The pane calls studentPackVerb once, near the top of updateSolve for the
// Equation kind, sets transformVerb when it answered (so no prose switch can
// take the line), and offers the result at the END of the verb chain. The
// routing test (studentPackRouting.test.ts) proves that no earlier switch or
// verb claims these inputs and that these verbs claim nothing the others own.

import type { VerbResult } from "./algebraTools";
import { isSigFigRequest, trySigFigs } from "./sigFigVerb";
import { isMonteCarloRequest, tryMonteCarlo } from "./monteCarlo";

/** True when the RAW input names significant figures or Monte Carlo. */
export function isStudentPackRequest(raw: string): boolean {
  return isMonteCarloRequest(raw) || isSigFigRequest(raw);
}

/** The answer (or a by-name refusal), or null when the line is not the pack's. */
export function studentPackVerb(raw: string): VerbResult | null {
  if (!isStudentPackRequest(raw)) return null;
  return tryMonteCarlo(raw) ?? trySigFigs(raw);
}
