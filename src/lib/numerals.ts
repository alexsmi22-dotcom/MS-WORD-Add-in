// Reference-numeral management for patent drafting. Every utility application
// with figures uses element callouts — a widget (10), a housing (12), a fastener
// (14) — and drafters must keep them consistent: each numeral maps to exactly one
// element, no numbers are skipped or reused, and every numeral called out in the
// document is defined (and vice versa).
//
// This module is the pure, unit-testable engine for that bookkeeping. It owns the
// numeral↔element table model, the reconciliation checks, and the rendered
// "List of Reference Numerals" table. It has NO Office.js dependency — the task
// pane extracts the document text and hands it in, and inserts what comes back.
// Like the rest of the engine, the checks are an advisory drafting aid: callout
// detection relies on the parenthesized convention, so verify before filing.

/** One numeral-to-element assignment, e.g. { numeral: 12, element: "housing" }. */
export interface NumeralEntry {
  numeral: number;
  element: string;
}

/** Findings from reconciling the numeral table against the document text. */
export interface NumeralFindings {
  /** A numeral assigned to more than one distinct element in the table. */
  collisions: { numeral: number; elements: string[] }[];
  /**
   * The INVERSE of a collision: one element name carrying more than one numeral —
   * "housing (12)" here and "housing (14)" there.
   *
   * This check did not exist. Only elementsByNumeral was built, so the direction
   * that a drafter actually gets wrong most often passed clean: renumbering a
   * figure, or copying a paragraph from a sibling application, leaves the same
   * part called out under two numbers, and every downstream cross-reference then
   * points at whichever one the reader happens to hit first.
   *
   * Advisory like the rest of this module: two genuinely different parts SHOULD be
   * named apart ("first housing" / "second housing"), which is exactly what this
   * asks the drafter to do.
   */
  duplicates: { element: string; numerals: number[] }[];
  /** Expected numbers missing from the numbering grid (skipped numerals). */
  gaps: number[];
  /** Numerals called out in the document but not defined in the table. */
  orphans: number[];
  /** Table entries whose numeral never appears in the document. */
  unused: NumeralEntry[];
  /** True when there are no collisions, duplicates, gaps, orphans, or unused entries. */
  ok: boolean;
}

/**
 * Parenthesized reference callout, the figure/spec convention: "(12)". An
 * optional trailing sub-part letter or prime — "(12a)", "(12')" — is captured
 * as the base numeral 12, so sub-part callouts aren't reported as orphans.
 */
const CALLOUT_RE = /\((\d+)[A-Za-z']?\)/g;

/**
 * A parenthesized four-digit year. A patent spec or brief is full of these
 * ("(2014)" in a citation), and the callout pattern cannot tell them apart from
 * a reference numeral by shape alone.
 */
function looksLikeYear(n: number, raw: string): boolean {
  return raw.length === 4 && n >= 1800 && n <= 2199;
}

/**
 * Distinct reference numerals called out in a block of document text, ascending.
 *
 * Detection relies on the parenthesized convention "(12)"/"(12a)"; bare numerals
 * are not matched, as they collide with quantities, dates and claim numbers.
 * Parenthesized ones collide too, which is what `known` is for: given the numeral
 * table, anything far outside its range is enumeration or a citation year rather
 * than a callout. Measured before this filter, on one sentence of ordinary legal
 * prose, the extractor returned (10), (2014), (1) and (2) — and the Audit
 * reported three of them as "called out but undefined".
 *
 * `known` is optional so the function still works with no table; without it only
 * the year filter applies, which is the conservative direction (it under-filters
 * rather than dropping a real callout).
 */
export function extractNumerals(documentText: string, known?: number[]): number[] {
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  CALLOUT_RE.lastIndex = 0;

  // A callout well outside the table's span is not a callout. The margin is
  // generous on purpose: a drafter adding (150) to a 10-140 table should still
  // see it flagged as undefined, which is the tool working.
  let lo = -Infinity;
  let hi = Infinity;
  if (known && known.length) {
    const sorted = [...known].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    // Enumeration markers "(1)", "(2)", "(3)" are small integers BELOW any real
    // numbering scheme, which conventionally starts at 10 or 100. Only applied
    // when the table itself starts at 10 or above, so a spec that genuinely
    // numbers from 1 keeps its low callouts.
    if (min >= 10) lo = 10;
    // Upward, stay generous: a drafter adding (150) to a 10-140 table should
    // still see it flagged as undefined. That is the tool working, not noise.
    hi = max + Math.max(100, max - min);
  }

  while ((m = CALLOUT_RE.exec(documentText)) !== null) {
    const raw = m[1];
    const n = parseInt(raw, 10);
    if (looksLikeYear(n, raw)) continue;
    if (n < lo || n > hi) continue;
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function normalize(element: string): string {
  return element.trim().toLowerCase();
}

/** Distinct numerals in the table, ascending. */
function tableNumerals(entries: NumeralEntry[]): number[] {
  return Array.from(new Set(entries.map((e) => e.numeral))).sort((a, b) => a - b);
}

/**
 * Reconciles the numeral table against the numerals found in the document.
 * - collisions: one numeral assigned two different element names.
 * - duplicates: one element name assigned two different numerals (the inverse).
 * - gaps: missing numbers on the inferred grid. The step is 2 when every numeral
 *   is even (the common 10/12/14 patent convention), otherwise 1.
 * - orphans: numerals called out in the document with no table entry.
 * - unused: table entries never called out in the document.
 *
 * `documentText` is optional: when provided, a table numeral also counts as used
 * if it appears in the non-parenthesized "element 12" / "element (12)" house
 * style near ITS OWN element name — matched against known element words only, so
 * it never turns arbitrary prose numbers into false orphans.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function reconcileNumerals(entries: NumeralEntry[], documentNumerals: number[], documentText = ""): NumeralFindings {
  // A numeral with a blank element name is an incomplete row — treat it as "not
  // defined" everywhere (consistent with buildNumeralListHtml, which drops it),
  // so gaps/unused don't disagree with the rendered list.
  const defined = entries.filter((e) => e.element.trim() !== "");

  // Collisions: group distinct (normalized) element names per numeral.
  const elementsByNumeral = new Map<number, { norm: Set<string>; display: string[] }>();
  for (const e of defined) {
    const el = e.element.trim();
    if (!el) continue;
    const bucket = elementsByNumeral.get(e.numeral) ?? { norm: new Set<string>(), display: [] };
    if (!bucket.norm.has(normalize(el))) {
      bucket.norm.add(normalize(el));
      bucket.display.push(el);
    }
    elementsByNumeral.set(e.numeral, bucket);
  }
  const collisions: { numeral: number; elements: string[] }[] = [];
  for (const [numeral, bucket] of elementsByNumeral) {
    if (bucket.norm.size > 1) collisions.push({ numeral, elements: bucket.display });
  }
  collisions.sort((a, b) => a.numeral - b.numeral);

  // Duplicates: the same element name under two numerals. Keyed on normalize(), so
  // "Housing" and " housing " are the same part — the whole point of the check is
  // that the drafter believes they are naming one thing.
  const numeralsByElement = new Map<string, { display: string; numerals: Set<number> }>();
  for (const e of defined) {
    const el = e.element.trim();
    const key = normalize(el);
    const bucket = numeralsByElement.get(key) ?? { display: el, numerals: new Set<number>() };
    bucket.numerals.add(e.numeral);
    numeralsByElement.set(key, bucket);
  }
  const duplicates: { element: string; numerals: number[] }[] = [];
  for (const bucket of numeralsByElement.values()) {
    if (bucket.numerals.size > 1) {
      duplicates.push({ element: bucket.display, numerals: [...bucket.numerals].sort((a, b) => a - b) });
    }
  }
  duplicates.sort((a, b) => a.numerals[0] - b.numerals[0]);

  // Gaps, reported only WITHIN a contiguous run.
  //
  // This used to infer one global step and walk min -> max, which is wrong for
  // the commonest patent convention there is: numbering each figure in its own
  // hundreds band. A spec with 10/12/14 for FIG. 1 and 100/102/104 for FIG. 2
  // reported 42 "skipped numerals" (16, 18 ... 98) that were never intended to
  // exist. One run like that and the drafter stops trusting the tool.
  //
  // A run ends where the next numeral is further away than a few steps — a jump
  // from 14 to 100 starts a new series rather than omitting 42 numerals.
  const nums = tableNumerals(defined);
  const gaps: number[] = [];
  if (nums.length >= 2) {
    const allEven = nums.every((n) => n % 2 === 0);
    const step = allEven ? 2 : 1;
    // Tolerate a few missing numerals inside a run; beyond that it is a new band.
    const runBreak = step * 10;
    const present = new Set(nums);
    let runStart = 0;
    for (let i = 1; i <= nums.length; i++) {
      const endOfRun = i === nums.length || nums[i] - nums[i - 1] > runBreak;
      if (!endOfRun) continue;
      for (let n = nums[runStart]; n <= nums[i - 1]; n += step) {
        if (!present.has(n)) gaps.push(n);
      }
      runStart = i;
    }
  }

  // Document parity.
  const docSet = new Set(documentNumerals);
  const tableSet = new Set(nums);
  const orphans = Array.from(docSet)
    .filter((n) => !tableSet.has(n))
    .sort((a, b) => a - b);
  const firstByNumeral = new Map<number, NumeralEntry>();
  for (const e of defined) if (!firstByNumeral.has(e.numeral)) firstByNumeral.set(e.numeral, e);
  // A numeral is "used" if it's a parenthesized callout, or (when text is given)
  // its own element name is followed by the number: "housing 12" / "housing (12)".
  const usedInText = (numeral: number, element: string): boolean => {
    if (docSet.has(numeral)) return true;
    if (!documentText || !element) return false;
    return new RegExp("\\b" + escapeRegExp(element) + "\\s*\\(?\\s*" + numeral + "\\b", "i").test(documentText);
  };
  const unused = nums
    .filter((n) => {
      const e = firstByNumeral.get(n);
      return e ? !usedInText(n, e.element) : !docSet.has(n);
    })
    .map((n) => firstByNumeral.get(n)!)
    .filter(Boolean);

  return {
    collisions,
    duplicates,
    gaps,
    orphans,
    unused,
    ok:
      collisions.length === 0 &&
      duplicates.length === 0 &&
      gaps.length === 0 &&
      orphans.length === 0 &&
      unused.length === 0,
  };
}

/**
 * Suggests the next reference numeral. Empty table → 10 (the conventional first
 * numeral). Otherwise max + 2 when every existing numeral is even, else max + 1.
 */
export function suggestNextNumeral(entries: NumeralEntry[]): number {
  // Ignore incomplete (blank-element) rows, consistent with reconcileNumerals.
  const nums = tableNumerals(entries.filter((e) => e.element.trim() !== ""));
  if (!nums.length) return 10;
  const max = nums[nums.length - 1];
  const allEven = nums.every((n) => n % 2 === 0);
  return max + (allEven ? 2 : 1);
}

/**
 * Formats a callout for insertion: "housing (12)" (or "(12)" with no element).
 * With parens=false: "housing 12" / "12" for drafters who don't parenthesize.
 */
export function formatCallout(element: string, numeral: number, parens = true): string {
  const el = element.trim();
  const n = String(numeral);
  const num = parens ? `(${n})` : n;
  return el ? `${el} ${num}` : num;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CELL = 'style="border:1px solid #000;padding:2px 8px;"';
const HEAD = 'style="border:1px solid #000;padding:2px 8px;font-weight:bold;"';

/** Heading for the inserted reference-numeral section. */
export const NUMERAL_LIST_HEADING = "List of Reference Numerals";

/**
 * The "List of Reference Numerals" as an HTML table (Numeral | Element), sorted
 * by numeral ascending, for Word.Range.insertHtml(). Blank-element rows are
 * dropped; duplicate numerals are collapsed to their first definition. Returns
 * "" when nothing is defined.
 */
export function buildNumeralListHtml(entries: NumeralEntry[]): string {
  const firstByNumeral = new Map<number, string>();
  for (const e of entries) {
    const el = e.element.trim();
    if (el && !firstByNumeral.has(e.numeral)) firstByNumeral.set(e.numeral, el);
  }
  const sorted = Array.from(firstByNumeral.entries()).sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return "";
  const rows = sorted
    .map(([numeral, el]) => `<tr><td ${CELL}>${numeral}</td><td ${CELL}>${escapeHtml(el)}</td></tr>`)
    .join("");
  return (
    '<table style="border-collapse:collapse;">' +
    `<tr><td ${HEAD}>Reference numeral</td><td ${HEAD}>Element</td></tr>` +
    rows +
    "</table>"
  );
}
