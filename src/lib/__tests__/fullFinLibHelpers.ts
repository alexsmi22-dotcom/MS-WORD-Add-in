/**
 * Shared helpers for the "fully inclusive" tests of the library Finance registries (fullFinLib*.test.ts): run a
 * calculator the way the pane does (number fields through readFinanceField first), and check a reading's numbers
 * against the text and table cells of the same result.
 */
import type { FinCalcDef, FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { readingProblems } from "../calcReading";

/** The pane's read: number fields through the product's cell reader, everything else as typed. */
export function runCalc(c: FinCalcDef, over: Record<string, string> = {}): FinResult {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}

export function calcById(list: FinCalcDef[], id: string): FinCalcDef {
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
}

export type FinObj = Exclude<FinResult, string>;

export function asObj(o: FinResult): FinObj {
  if (typeof o === "string") throw new Error("a bare string result (no reading possible)");
  return o;
}

/** The text and every table cell of a result, joined (the haystack a reading's numbers must come from). */
export function haystack(o: FinObj): string {
  const tables = o.tables ?? (o.table ? [o.table] : []);
  return [o.text, ...tables.flatMap((t) => t.rows.flat())].join("\n");
}

/**
 * Every number in a reading (grouping commas, decimals and a trailing % kept). A true minus written before the number
 * (also after a currency sign, −$1.00) is kept, so a reading that prints −X must find −X in the text or tables; a
 * magnitude stated in words ("fell 10.00%", "below") carries no sign and matches either.
 */
export function readingNumbers(reading: string): string[] {
  return [...reading.matchAll(/(−\$?)?\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0].replace(/,$/, ""));
}

/** The reading's numbers that do NOT appear verbatim in the text or the table cells. */
export function strayNumbers(o: FinObj): string[] {
  const hay = haystack(o);
  return readingNumbers(o.reading ?? "").filter((n) => !hay.includes(n));
}

/**
 * The full reading check for one run: an accepted result, a reading that keeps the rules, every number traceable.
 * Returns the reading so a test can assert its wording.
 */
export function checkedReading(c: FinCalcDef, over: Record<string, string> = {}): string {
  const o = asObj(runCalc(c, over));
  if (o.ok === false) throw new Error(`${c.id} refused: ${o.text}`);
  const probs = readingProblems(o.reading);
  if (probs.length) throw new Error(`${c.id} reading “${o.reading}”: ${probs.join("; ")}`);
  const stray = strayNumbers(o);
  if (stray.length) throw new Error(`${c.id} reading “${o.reading}” has numbers not in the text or tables: ${stray.join(", ")}`);
  return o.reading as string;
}
