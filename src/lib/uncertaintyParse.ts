// Parses the `name = value +/- uncertainty` lines the uncertainty-propagation
// calculator takes.
//
// THIS LIVED INSIDE taskpane.ts, WHICH IS WHY ITS BUG SURVIVED. Nothing in the
// repo can import taskpane.ts in a test -- it pulls in the Office.js `Word`
// namespace, which does not exist under jest -- so every parser buried in that
// file is structurally unreachable by the test suite. The defect here was a
// character class `[\d.eE+]+` that allowed `+` but not `-`: `a = 1e-3 +/- 1e-4`
// failed the anchored match, the line was silently discarded, and the pane then
// printed `Unknown variable "a"` about a variable defined two lines above on the
// user's own screen. It is a one-character omission that no amount of engine
// testing could have found from outside.
//
// Moving it here is the fix that matters more than the character: it is now
// testable. See __tests__/numGrammar.test.ts.

import { NUM_DECIMAL } from "./numgrammar";

export interface StatVar {
  value: number;
  uncertainty: number;
}

const STAT_VAR_LINE = new RegExp(
  String.raw`^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(` +
    NUM_DECIMAL +
    String.raw`)\s*(?:±|\+\/-|\+-)\s*(` +
    NUM_DECIMAL +
    String.raw`)\s*$`,
);

/** Reason a `name = value ± uncertainty` line could not be used, or null. */
export function statVarLineProblem(line: string): string | null {
  if (line.trim() === "") return null;
  const m = STAT_VAR_LINE.exec(line);
  if (!m) {
    return `Could not read “${line.trim()}”. Expected a line like “a = 1e-3 ± 1e-4”.`;
  }
  const value = parseFloat(m[2]);
  const unc = parseFloat(m[3]);
  if (!Number.isFinite(value) || !Number.isFinite(unc)) {
    return `“${m[1]}” has a value or uncertainty that is not a finite number.`;
  }
  // Widening the grammar to admit a leading minus fixed the reported bug and
  // opened a new one: `a = 5 ± -0.1` now MATCHES, and propagation squares the
  // uncertainty, so a negative sigma disappears into a plausible-looking answer.
  // The old character class rejected it only by accident. Refuse it on purpose.
  if (unc < 0) {
    return `“${m[1]}” has a negative uncertainty (${m[3]}). An uncertainty is a magnitude — write ${Math.abs(unc)}.`;
  }
  return null;
}

export function statVars(s: string): Record<string, { value: number; uncertainty: number }> {
  const out: Record<string, { value: number; uncertainty: number }> = {};
  for (const line of s.split(/[\n;]+/)) {
    const m = STAT_VAR_LINE.exec(line);
    if (!m) continue;
    const value = parseFloat(m[2]);
    const unc = parseFloat(m[3]);
    if (!Number.isFinite(value) || !Number.isFinite(unc) || unc < 0) continue;
    out[m[1]] = { value, uncertainty: unc };
  }
  return out;
}
