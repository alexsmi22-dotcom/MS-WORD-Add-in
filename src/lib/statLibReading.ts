/**
 * Small helpers for the plain-language readings of the Statistics library registries (causal, GMM, limited dependent,
 * micro/macro, time series): "fully inclusive" (2026-10-28). The rules are lib/calcReading.ts; each reading is built
 * next to its calculator from the same formatted strings its text and tables print.
 */
import { READING_MAX } from "./calcReading";

/**
 * The first candidate that fits the reading's length limit. Candidates go from the fullest to the barest: a reading
 * that names user columns can run long when the names do, and then a shorter wording (fewer names) is used. When none
 * fits, the last (barest) one is returned, so a reading is never silently dropped.
 */
export function fitReading(...cands: (string | null | undefined | false)[]): string | undefined {
  const list = cands.filter((c): c is string => typeof c === "string" && c.trim() !== "");
  for (const c of list) if (c.length <= READING_MAX) return c;
  return list.length ? list[list.length - 1] : undefined;
}

/** A formatted signed number without its sign (true minus or ASCII), for "lowers … by 2.18". */
export function unsigned(s: string): string {
  return s.replace(/^[−-]/, "");
}

/** "raises" / "lowers" / "does not change" from the sign of a value. */
export function moveWord(v: number, up = "raises", down = "lowers", none = "does not change"): string {
  return v > 0 ? up : v < 0 ? down : none;
}
