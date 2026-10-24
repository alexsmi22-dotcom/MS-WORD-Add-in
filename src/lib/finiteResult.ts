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

/**
 * The refusal shown in place of a result that is not a finite number, when the text does not say which way it broke
 * (a formatter's "not finite" can be an overflow or a 0/0).
 */
export const NON_FINITE_REFUSAL =
  "A result is not a finite number at these inputs: it overflowed or underflowed double precision, or is undefined " +
  "there (a division by zero or 0/0); refused rather than shown. Check for a zero input that a formula divides by, " +
  "or give inputs of a physically realistic size.";

/** A result that printed NaN or "undefined" as a value: a 0/0 or the like, NOT an overflow (fix3c). */
const UNDEFINED_REFUSAL =
  "A result is undefined at these inputs (a 0/0 or the like, so it is not a number); refused rather than shown. " +
  "Check for a zero or missing input that a formula divides by.";

/** A result that printed Infinity: an overflow, or a division by zero. */
const INFINITE_REFUSAL =
  "A result is infinite at these inputs (it overflowed or underflowed double precision, or a formula divided by " +
  "zero), so it is not a finite number; refused rather than shown. Give inputs of a physically realistic size.";

const NAN_TOKEN = /(?<![\p{L}\p{N}_])NaN(?![\p{L}\p{N}_])/u;
const INFINITY_TOKEN = /(?<![\p{L}\p{N}_])Infinity(?![\p{L}\p{N}_])/u;

/**
 * Which way a non-finite OK result broke, read from what it prints (insertGate's rule: straight-quoted spans are the
 * user's input, not values), else from its declared outputs. fix3c: every refusal said "overflowed" — a pipe at zero
 * flow (0/0) was told its inputs were too large.
 */
function nonFiniteRefusal(o: AnalyzeOutput): string {
  const text = (o.text ?? "").replace(/"[^"\n]*"/g, '""');
  const nan = NAN_TOKEN.test(text), inf = INFINITY_TOKEN.test(text), nf = NOT_FINITE.test(text);
  // A broken number that is none of NaN, Infinity or "not finite" is "undefined" in a value position.
  if (nan || (!inf && !nf && hasBrokenNumber(o.text ?? ""))) return UNDEFINED_REFUSAL;
  if (inf && !nf) return INFINITE_REFUSAL;
  if (nf) return NON_FINITE_REFUSAL;
  const bad = (o.outputs ?? []).filter((e: EngOutput) => !Number.isFinite(e.value)).map((e) => e.value);
  if (bad.length && bad.every((v) => Number.isNaN(v))) return UNDEFINED_REFUSAL;
  if (bad.length && bad.every((v) => !Number.isNaN(v))) return INFINITE_REFUSAL;
  return NON_FINITE_REFUSAL;
}

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
  const why = nonFiniteRefusal(o);
  return { text: what ? `${what}: ${why}` : why, ok: false };
}
