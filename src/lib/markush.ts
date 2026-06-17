// Markush definition helpers. Two jobs:
//   1. Expand carbon-range shorthands in a free-text R-group definition, e.g.
//      "C1-6 alkyl" / "C1-C6 alkyl" → "C₁–C₆ alkyl" (subscript counts, en-dash).
//   2. Render the collected R-group definitions as either an inline legend line
//      ("where R1 = …; R2 = …") or a structured two-column Word table.
//
// Pure string logic — no Office.js — so it is fully unit-testable. The table
// output is HTML for Word.Range.insertHtml(); the line output is plain text.

export interface LegendEntry {
  /** R-group label, e.g. "R1". */
  label: string;
  /** User-entered definition, raw (before shorthand expansion). */
  definition: string;
}

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

function toSubscript(digits: string): string {
  return digits.replace(/\d/g, (d) => SUBSCRIPTS[d]);
}

// Carbon-group keywords a count can qualify (gate single-count conversion so we
// don't mangle ordinary formulas like "C2H5" or "CO2H").
const CARBON_GROUP = "alk|cycloalk|aryl|heteroaryl|acyl";

/**
 * Normalizes common Markush shorthands in a definition string:
 *   "C1-6 alkyl" / "C1-C6 alkyl"  →  "C₁–C₆ alkyl"   (subscript counts, en-dash)
 *   "C6 alkyl"                     →  "C₆ alkyl"       (single count before a group word)
 *   "opt sub phenyl"               →  "optionally substituted phenyl"
 *   "n=1-3" / "n = 1-3"            →  "n = 1–3"        (variable-count range)
 *   "4-6 membered"                 →  "4–6 membered"   (plain integer range → en-dash)
 * Everything else is left untouched. Idempotent.
 */
export function expandDefinition(input: string): string {
  let s = input;
  // Carbon ranges first: "C1-6", "C1-C6" (optional spaces) → "C₁–C₆".
  s = s.replace(
    /\bC\s*(\d+)\s*-\s*C?\s*(\d+)\b/gi,
    (_m, a: string, b: string) => `C${toSubscript(a)}–C${toSubscript(b)}`,
  );
  // Single count immediately before a carbon-group keyword: "C6 alkyl" → "C₆ alkyl".
  // (Subscripts produced above are no longer \d, so ranges are not re-touched.)
  s = s.replace(new RegExp(`\\bC(\\d+)(?=\\s*(?:${CARBON_GROUP}))`, "gi"), (_m, n: string) => `C${toSubscript(n)}`);
  // "Optionally substituted" abbreviations: "opt sub", "opt. subst.", "opt substituted".
  s = s.replace(/\bopt\.?\s+sub(?:st(?:ituted)?)?\.?(?![a-z])/gi, "optionally substituted");
  // Variable-count ranges: "n=1-3" → "n = 1–3" (single-letter variable, spaced equals).
  s = s.replace(/\b([a-z])\s*=\s*(\d+)\s*-\s*(\d+)\b/gi, (_m, v: string, a: string, b: string) => `${v} = ${a}–${b}`);
  // Remaining plain integer ranges → en-dash, e.g. "4-6 membered" → "4–6 membered".
  s = s.replace(/\b(\d+)\s*-\s*(\d+)\b/g, (_m, a: string, b: string) => `${a}–${b}`);
  return s;
}

// An R-group-style label referenced inside a definition: "R" + digits (with
// optional trailing sub-letters/primes, e.g. R1a, R1'), or "R" + a single letter
// (Ra). The digit/single-letter requirement keeps ordinary words like "Red" or
// "Ring" from being mistaken for sub-group references.
const RGROUP_REF = /\bR(?:\d+[a-z']*|[a-z])\b/g;

/**
 * Distinct R-group labels referenced inside a definition string, in order of
 * first appearance. e.g. "C1-6 alkyl substituted with R1a or Ra" → ["R1a", "Ra"].
 * Used to surface nested (sub-generic) R-group definitions.
 */
export function referencedRGroups(text: string): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  let m: RegExpExecArray | null;
  RGROUP_REF.lastIndex = 0;
  while ((m = RGROUP_REF.exec(text)) !== null) {
    if (!seen[m[0]]) {
      seen[m[0]] = true;
      out.push(m[0]);
    }
  }
  return out;
}

/** Expands definitions and drops entries whose definition is blank. */
function expandEntries(entries: LegendEntry[]): LegendEntry[] {
  return entries
    .map((e) => ({ label: e.label, definition: expandDefinition(e.definition.trim()) }))
    .filter((e) => e.definition.length > 0);
}

/** Inline legend line "where R1 = …; R2 = …" (empty string if nothing defined). */
export function buildLegendText(entries: LegendEntry[]): string {
  const filled = expandEntries(entries);
  if (!filled.length) return "";
  return "where " + filled.map((e) => `${e.label} = ${e.definition}`).join("; ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CELL = 'style="border:1px solid #000;padding:2px 8px;"';
const HEAD = 'style="border:1px solid #000;padding:2px 8px;font-weight:bold;"';

/**
 * Structured Markush legend as an HTML table (R-group | Definition) for
 * Word.Range.insertHtml(). Returns "" if nothing is defined.
 */
export function buildLegendTableHtml(entries: LegendEntry[]): string {
  const filled = expandEntries(entries);
  if (!filled.length) return "";
  const rows = filled
    .map((e) => `<tr><td ${CELL}>${escapeHtml(e.label)}</td><td ${CELL}>${escapeHtml(e.definition)}</td></tr>`)
    .join("");
  return (
    '<table style="border-collapse:collapse;">' +
    `<tr><td ${HEAD}>R-group</td><td ${HEAD}>Definition</td></tr>` +
    rows +
    "</table>"
  );
}
