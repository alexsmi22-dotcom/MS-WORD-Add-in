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
//
// fix2: Word's AutoCorrect turns the prime into a curly apostrophe "(12’)" and
// drafters type a real prime "(12′)" — both are sub-part callouts too. And one
// bracket may group several numerals, EPO-claim style: "walls (12, 14)",
// "(12 and 14)", "(12, 14, and 16)"; each is a callout (they were reported
// "never called out"). Group 1 is the whole list; at most 20 members, and the
// separators hold no digit, so the scan is linear.
// fix2-cad: a double prime "(12″)" is a sub-part callout too, and a RANGE "(30-34)" / "(30–34)" (Word's AutoCorrect
// makes the en dash) calls out its two ends — and any numeral of the table between them.
const SUB = "[A-Za-z'’′″]?";
// Each separator has ONE way to match its spaces (an optional "\s*" on both
// sides of an optional word split the same spaces two ways: 2²⁰ tries on an
// unclosed "(12, 12, …"). Every alternative starts "\s*" and then needs a
// different character, so the spaces are still read one way.
const CALLOUT_SEP = "(?:\\s*,\\s*(?:(?:and|or|&)\\s*)?|\\s*(?:and|or|&)\\s*|\\s*[-–]\\s*)";
/** One member of a callout list: a numeral, or a range "30-34" / "30–34". */
const CALLOUT_MEMBER = /(\d+)[A-Za-z'’′″]?(?:\s*[-–]\s*(\d+)[A-Za-z'’′″]?)?/g;
const CALLOUT_RE = new RegExp(`\\((\\d+${SUB}(?:${CALLOUT_SEP}\\d+${SUB}){0,20})\\)`, "g");

/**
 * A parenthesized four-digit year. A patent spec or brief is full of these
 * ("(2014)" in a citation), and the callout pattern cannot tell them apart from
 * a reference numeral by shape alone.
 */
function looksLikeYear(n: number, raw: string): boolean {
  return raw.length === 4 && n >= 1800 && n <= 2199;
}

const NUM_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const NUM_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * The value of a spelled-out CARDINAL ending right before `at` ("twenty",
 * "thirty-five", "one hundred and twenty"), or -1. Ordinals ("first") and any
 * other word give -1, so "a first housing (12)" stays a callout.
 */
function spelledNumberBefore(text: string, at: number): number {
  const before = text.slice(Math.max(0, at - 60), at);
  const m = /((?:[A-Za-z]+[ \t -]+){0,5}[A-Za-z]+)[ \t ]*$/.exec(before);
  if (!m) return -1;
  const words = m[1].toLowerCase().split(/[ \t -]+/);
  // The longest run of number words at the END.
  let k = words.length;
  while (k > 0 && (NUM_UNITS[words[k - 1]] !== undefined || NUM_TENS[words[k - 1]] !== undefined || /^(?:hundred|thousand|and)$/.test(words[k - 1]))) k--;
  const run = words.slice(k);
  while (run.length && run[0] === "and") run.shift();
  if (!run.length || run[run.length - 1] === "and") return -1;
  let total = 0;
  let cur = 0;
  for (const w of run) {
    if (NUM_UNITS[w] !== undefined) cur += NUM_UNITS[w];
    else if (NUM_TENS[w] !== undefined) cur += NUM_TENS[w];
    else if (w === "hundred") cur = (cur || 1) * 100;
    else if (w === "thousand") {
      total += (cur || 1) * 1000;
      cur = 0;
    }
  }
  return total + cur;
}

/**
 * Legal-citation and quantity words right before a bracket that make a RANGE in it a citation or a quantity:
 * "claims (1-20)", "pages (10–12)", "¶ (12-16)", "about (10–20)", "col. 3, lines (10-20)". Only clear ones:
 * element names ("fluid lines", "support columns", "tube sections", "steps", "examples") and plain prepositions
 * ("each of") are callout positions (fix3e: every one of those dropped a real callout).
 */
const RANGE_STOP_BEFORE =
  /(?:^|[^A-Za-z])(?:claims?|pages?|pp?|paragraphs?|paras?|approximately|approx|about|roughly|circa|ca)\.?[ \t ]*$|[§¶][ \t ]*$|(?:^|[^A-Za-z])col(?:umn)?s?\.?[ \t ]*\d+[ \t ]*,?[ \t ]*(?:lines?|ll\.?)[ \t ]*$/i;
/**
 * A real unit right after the bracket, then a space, punctuation (not a hyphen) or the end: "(10–20) mm wide",
 * "(10–20)%". Never a single letter ("L-shaped", "s-bend", "(30–34) M") and never a count noun ("units",
 * "times"): those followed real callouts.
 */
const RANGE_UNIT_AFTER =
  /^[ \t ]*(?:%|‰|°[CFK]?|(?:nm|µm|μm|um|mm|cm|km|inch(?:es)?|ft|ng|µg|μg|mg|kg|lbs?|ms|sec|min|hrs?|hours?|days?|weeks?|months?|years?|wt\.?[ \t]?%|vol\.?[ \t]?%|mol[ \t]?%|mol|mmol|µmol|μmol|nM|µM|μM|mM|mV|kV|mA|kW|MW|Hz|kHz|MHz|GHz|kPa|MPa|GPa|Pa|psi|bar|rpm|ppm|ppb|mL|ml|µL|μL|nL|kDa|Da|bp|kb|percent|degrees?)(?=[ \t\n.,;:)\]/·⋅\-%⁻]|$))/;

/** Whether the range in the bracket at [start, end) reads as a citation or a quantity: a stop word before it or a unit after it. */
function rangeIsQuantity(text: string, start: number, end: number): boolean {
  if (RANGE_STOP_BEFORE.test(text.slice(Math.max(0, start - 40), start))) return true;
  return RANGE_UNIT_AFTER.test(text.slice(end, end + 40));
}

/** Greatest common divisor of two non-negative integers. */
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Whether a range a–b between two of the table's numerals is a plausible callout of them: the table's numerals in
 * [a, b] fill at least half of the slots on their own spacing (the gcd of their gaps). "(20–24)" over 20/22/24 and
 * "(102–108)" over 102…108 are full; "(10–200)" over 10, 12, 14, 16, 20, 100, 102, 200 fills 8 of 96 slots, a
 * quantity whose ends happen to be numerals.
 */
function rangeIsPlausible(a: number, b: number, sortedKnown: number[]): boolean {
  if (a === b) return true;
  const inside = sortedKnown.filter((k) => k >= a && k <= b);
  let g = 0;
  for (let i = 1; i < inside.length; i++) g = gcd(g, inside[i] - inside[i - 1]);
  if (g <= 0) return false;
  const slots = (b - a) / g + 1;
  // A callout range spans a handful of a figure's parts; one over more than 12 slots is a quantity even when the table
  // is dense ("(10–200) particles" against 10, 12, …, 1000 or 10, 20, …, 1000), unless every slot is a numeral and the
  // span is short ("teeth (100–124)", thirteen parts numbered by twos).
  if (slots > 12 && !(inside.length === slots && b - a <= 50)) return false;
  return inside.length / slots >= 0.5;
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
  // A cleared numeral box (0 / NaN) is no numeral — it must not widen the span.
  const real = (known ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (real.length) {
    const sorted = [...real].sort((a, b) => a - b);
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

  // A numeral the TABLE defines is a callout even when it is shaped like a year:
  // a FIG. 18 numbered 1800/1802/1804 had every callout dropped and the Audit
  // reported all three as "defined but never called out".
  const knownSet = new Set(known ?? []);
  const hasTable = knownSet.size > 0;
  const sortedKnown = [...knownSet].sort((x, y) => x - y);
  while ((m = CALLOUT_RE.exec(documentText)) !== null) {
    // fix3: a RANGE member is a citation or a quantity, not a callout, when its
    // context says so: "see claims (1-20)", "pages (10–12)", "(10–20) mm".
    // Each member is judged on its own: a single "(20, 22–24)" member keeps the
    // plain "(12)" rule whatever happens to the range beside it.
    let rangeQuantity: boolean | undefined;
    const members: string[] = [];
    for (const mm of m[1].matchAll(CALLOUT_MEMBER)) {
      if (mm[2] === undefined) {
        members.push(mm[1]);
        continue;
      }
      rangeQuantity ??= rangeIsQuantity(documentText, m.index, m.index + m[0].length);
      if (rangeQuantity) continue;
      const a = parseInt(mm[1], 10), b = parseInt(mm[2], 10);
      // With a table, a range calls out only between two of ITS numerals that
      // it plausibly spans: "(1-20)" against 10…1000 has an unknown end, and
      // "(10–200)" spans 96 slots holding 8 numerals (fix3e).
      if (hasTable && !(knownSet.has(a) && knownSet.has(b) && rangeIsPlausible(Math.min(a, b), Math.max(a, b), sortedKnown))) continue;
      members.push(mm[1], mm[2]);
      // The table's numerals inside the range are called out by it too.
      if (a < b) for (const k of knownSet) if (k > a && k < b) members.push(String(k));
    }
    for (const raw of members) {
      const n = parseInt(raw, 10);
      // "twenty (20) minutes", "thirty (30) days": a spelled-out number with its
      // figures in parentheses is a quantity, not a reference numeral.
      if (members.length === 1 && spelledNumberBefore(documentText, m.index) === n) continue;
      if (looksLikeYear(n, raw) && !knownSet.has(n)) continue;
      if (n < lo || n > hi) continue;
      seen.add(n);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * The largest reference numeral: five digits, as the figure builders read them (diagramCore.NUMERAL). A numeral
 * past it (a damaged setting, "1e20" typed into the box) is no numeral — counting on from 2⁵³ never moves.
 */
export const MAX_NUMERAL = 99999;

/** A real reference numeral: a positive whole number up to MAX_NUMERAL (a cleared box is 0/NaN). */
export function isValidNumeral(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= MAX_NUMERAL;
}

/**
 * The Numerals table's numeral box as a number: digits only, 1 to MAX_NUMERAL; anything else (blank, "1e20",
 * "12.5", 100000) is 0, the cleared box.
 */
export function parseNumeralInput(raw: string): number {
  const t = raw.trim();
  if (!/^\d{1,5}$/.test(t)) return 0;
  const n = Number(t);
  return isValidNumeral(n) ? n : 0;
}

function hasNumeral(e: NumeralEntry): boolean {
  return isValidNumeral(e.numeral);
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
  // A cleared numeral box arrives as 0 (or NaN): no numeral, so no constraint —
  // it used to anchor the grid at 0 and report false gaps 2, 4, 6, 8 (fix2).
  const defined = entries.filter((e) => e.element.trim() !== "" && hasNumeral(e));

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
  const nums = tableNumerals(entries.filter((e) => e.element.trim() !== "" && hasNumeral(e)));
  if (!nums.length) return 10;
  const max = nums[nums.length - 1];
  const allEven = nums.every((n) => n % 2 === 0);
  const next = max + (allEven ? 2 : 1);
  // At the five-digit cap the next numeral is found by nextFreeNumeral's search, from 10.
  return next <= MAX_NUMERAL ? next : 10;
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
