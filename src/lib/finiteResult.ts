// A calculator's last line of defence against a broken number in an OK result (fix round eng-9).
//
// The per-module number formatters print a non-finite value as the words "not finite" (gasDynamicsCalcs, laserCalcs,
// ...) and a raw template literal prints "NaN", "Infinity" or "−Infinity dBm". Either way an OK result then carries a
// number that is not a number, and "not finite" is not something the insert gate (insertGate.ts) blocks. Each
// calculator's finish/report step runs its result through refuseNonFinite: if the text (prose, tables, captions) or a
// declared output is non-finite, the whole result becomes a NAMED refusal instead. Calculators should still refuse
// the specific cause up front; this catches overflow/underflow at extreme magnitudes that slips past them.
//
// Pure: no Office.js, no DOM.

import type { AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { hasBrokenNumber } from "./insertGate";

const NOT_FINITE = /\bnot finite\b/i;

/** Does this OK result carry a non-finite number (in its text or its declared outputs)? */
export function hasNonFinite(o: AnalyzeOutput): boolean {
  if (o.ok === false) return false;
  const text = o.text ?? "";
  if (NOT_FINITE.test(text) || hasBrokenNumber(text)) return true;
  return (o.outputs ?? []).some((e: EngOutput) => !Number.isFinite(e.value));
}

/** The refusal shown in place of a result that overflowed or underflowed. */
export const NON_FINITE_REFUSAL =
  "A result overflowed or underflowed double precision (it is not a finite number) at these input magnitudes; " +
  "refused rather than shown. Give inputs of a physically realistic size.";

/**
 * THE CENTRAL GUARD every Engineering calculator's compute runs through (taskpane.ts wraps ENG_CALCS once, beside the
 * display pass), fix2-eng2: typing 1e300 reached 31 tools whose OK results printed "Setup not finite … PASS",
 * "zR not finite" or "order Infinity". A declared output that is not finite is DROPPED — NaN is the tools' own
 * "not applicable" marker (withOutputs drops it the same way), so it never reaches a sweep — and an OK result whose
 * text still prints a non-finite number (insertGate's rule, or the formatters' "not finite") becomes the named
 * refusal. A refusal passes unchanged, keeping its wording.
 */
export function guardEngResult(o: AnalyzeOutput, what?: string): AnalyzeOutput {
  if (o.ok === false) return o;
  const outputs = o.outputs ? o.outputs.filter((e) => Number.isFinite(e.value)) : o.outputs;
  return refuseNonFinite(outputs === o.outputs ? o : { ...o, outputs }, what);
}

/** Returns `o` unchanged, or a named refusal when an OK result carries a non-finite number. */
export function refuseNonFinite(o: AnalyzeOutput, what?: string): AnalyzeOutput {
  if (!hasNonFinite(o)) return o;
  return { text: what ? `${what}: ${NON_FINITE_REFUSAL}` : NON_FINITE_REFUSAL, ok: false };
}
