/**
 * The one p-value rule (calcReading.pVerdict) applied to the p TEXT a Statistics calculator prints, whatever its
 * format: formatP (".050", "< .001"), regTable fmtP ("0.050", "< 0.001"), sig6 ("0.0500000", "1.23456 × 10⁻⁵"),
 * assaySig ("0.05", "1×10⁻⁷"), cox/rm ("p < 0.0001"), "p < 1 × 10⁻¹⁵". A reading decides on what the reader sees:
 * one printed number always gets one verdict, and a p printed exactly at the level is borderline, never
 * "significant" and never "could be chance" (bug test 2026-10-28, R4 #9 / R5 MAJOR 9).
 *
 * pVerdict itself throws on text it cannot read; this wrapper turns "×10⁻ⁿ" into e-notation first and returns null
 * for a p that is not a number ("p = n/a", the em dash sentinel), so a caller leaves the reading out instead.
 */
import { BOUNDARY_CLAUSE, pVerdict, type PVerdict } from "./calcReading";

export type { PVerdict };

const SUP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
  "⁺": "",
  "−": "-",
};

/** A printed number (true minus, "×10ⁿ" with or without spaces, grouped thousands) as a JS number; NaN if unreadable. */
export function printedNumber(printed: string): number {
  let t = printed.replace(/[\s ]/g, "").replace(/,/g, "");
  t = t.replace(/×10([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/, (_m, e: string) => "e" + e.split("").map((c) => SUP[c] ?? c).join(""));
  t = t.replace(/^[−]/, "-");
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/**
 * The verdict for a printed p ("p = .050", "p < .001", "0.0500000", "1.2 × 10⁻⁵", "p < 0.001"), or null when the
 * text is not a p-value (n/a, em dash, NaN): a reading then says nothing about significance.
 */
export function printedPVerdict(printed: string, alpha = 0.05): PVerdict | null {
  if (/n\/a|—|NaN|Infinity/i.test(printed)) return null;
  let t = printed.replace(/[\s ]/g, "").replace(/^p/i, "").replace(/^=/, "");
  const below = /^[<≤]/.test(t);
  if (below) t = t.slice(1);
  const v = printedNumber(t);
  if (!Number.isFinite(v)) return null;
  // Hand pVerdict the value as a string it reads (String(v) is a decimal or e-notation, both valid for Number()).
  try {
    return pVerdict(`${below ? "<" : ""}${String(v)}`, alpha);
  } catch {
    return null;
  }
}

/** The borderline words for a level: BOUNDARY_CLAUSE at 5%, the same sentence naming the level otherwise. */
export function boundaryClause(alpha = 0.05): string {
  if (alpha === 0.05) return BOUNDARY_CLAUSE;
  const pct = String(Number((alpha * 100).toPrecision(6)));
  return `right at the ${pct}% threshold, so the evidence is borderline`;
}

export { BOUNDARY_CLAUSE };
