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
  /** Expected numbers missing from the numbering grid (skipped numerals). */
  gaps: number[];
  /** Numerals called out in the document but not defined in the table. */
  orphans: number[];
  /** Table entries whose numeral never appears in the document. */
  unused: NumeralEntry[];
  /** True when there are no collisions, gaps, orphans, or unused entries. */
  ok: boolean;
}

/**
 * Parenthesized reference callout, the figure/spec convention: "(12)". An
 * optional trailing sub-part letter or prime — "(12a)", "(12')" — is captured
 * as the base numeral 12, so sub-part callouts aren't reported as orphans.
 */
const CALLOUT_RE = /\((\d+)[A-Za-z']?\)/g;

/** Distinct reference numerals called out in a block of document text, ascending.
 *  Detection relies on the parenthesized convention "(12)"/"(12a)"; bare numerals
 *  are not matched (they collide with quantities, dates, claim numbers, etc.). */
export function extractNumerals(documentText: string): number[] {
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  CALLOUT_RE.lastIndex = 0;
  while ((m = CALLOUT_RE.exec(documentText)) !== null) {
    seen.add(parseInt(m[1], 10));
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
 * - gaps: missing numbers on the inferred grid. The step is 2 when every numeral
 *   is even (the common 10/12/14 patent convention), otherwise 1.
 * - orphans: numerals called out in the document with no table entry.
 * - unused: table entries never called out in the document.
 */
export function reconcileNumerals(entries: NumeralEntry[], documentNumerals: number[]): NumeralFindings {
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

  // Gaps: walk the inferred grid from min to max.
  const nums = tableNumerals(defined);
  const gaps: number[] = [];
  if (nums.length >= 2) {
    const allEven = nums.every((n) => n % 2 === 0);
    const step = allEven ? 2 : 1;
    const present = new Set(nums);
    for (let n = nums[0]; n <= nums[nums.length - 1]; n += step) {
      if (!present.has(n)) gaps.push(n);
    }
  }

  // Document parity.
  const docSet = new Set(documentNumerals);
  const tableSet = new Set(nums);
  const orphans = Array.from(docSet)
    .filter((n) => !tableSet.has(n))
    .sort((a, b) => a - b);
  const unusedNumerals = nums.filter((n) => !docSet.has(n));
  const firstByNumeral = new Map<number, NumeralEntry>();
  for (const e of defined) if (!firstByNumeral.has(e.numeral)) firstByNumeral.set(e.numeral, e);
  const unused = unusedNumerals.map((n) => firstByNumeral.get(n)!).filter(Boolean);

  return {
    collisions,
    gaps,
    orphans,
    unused,
    ok: collisions.length === 0 && gaps.length === 0 && orphans.length === 0 && unused.length === 0,
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
