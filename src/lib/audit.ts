// Document-wide consistency audit — the "Check this application" pass. Runs every
// cross-reference rule at once over the document text and returns one structured
// report: reference numerals, SEQ ID NO references, and figure-number continuity.
//
// Pure aggregation over the focused engines — no Office.js — fully unit-testable.
// The task pane supplies the extracted document text, the numeral table, and the
// sequence-listing count. Advisory: every underlying check is heuristic.

import { NumeralEntry, extractNumerals, reconcileNumerals } from "./numerals";
import { extractSeqIdRefs, reconcileSeqIds } from "./seqid";
import { extractCaptionNumbers, extractRefNumbers, RefKind } from "./refs";
import { looksLikeHeading } from "./paragraphs";

export interface AuditInput {
  /** Full document body text. */
  documentText: string;
  /** The reference-numeral table (from Numerals mode / document settings). */
  numerals: NumeralEntry[];
  /** Number of sequences in the ST.26 listing (0 if none). */
  listingCount: number;
}

export interface AuditSection {
  title: string;
  issues: string[];
  /**
   * Neutral, informational lines: things the reader must know that are NOT defects.
   *
   * A section with no issues used to be indistinguishable from a section that could
   * not be checked, and both rendered as a green "✓". That is a false all-clear, and
   * the sequence check hit it on every fresh Word session. Notes do not count toward
   * `issueCount` and never make `ok` false — a section carrying only notes is
   * "not checked", not "passed" and not "failed".
   */
  notes?: string[];
}

export interface AuditReport {
  sections: AuditSection[];
  issueCount: number;
  ok: boolean;
}

// "FIG. 3" / "FIGS. 1-3" / "Figures 2 or 4" / "FIGS. 1 through 6".
//
// TWO SPELLINGS THAT REAL SPECIFICATIONS USE were missing, and both fail in the
// direction that produces FALSE ALARMS once the brief-description check reads
// this same function:
//   * `fig(?:ure|s)?` did not match the plural word "Figures" — it consumed
//     "figure", then needed a digit and found the "s". "Figures 1-4" parsed to
//     [] , so a brief description written that way listed nothing.
//   * "through" is at least as common as "to" in a drawings list, and was not a
//     range word, so "FIGS. 1 through 6" parsed to [1] and the check reported
//     FIG. 2-6 as missing from a brief description that plainly covers them.
// A patent audit that cries wolf at that volume is one nobody reads.
const FIG_RE = /\bfig(?:ures?|s)?\.?\s*(\d+(?:\s*(?:[-–—]|through|thru|to|and|or|,)\s*\d+)*)/gi;

/**
 * The widest figure range that is expanded ("FIGS. 1-12" → 1…12). A wider one
 * ("FIGS. 1-1000000") froze Word expanding it (fix2); it is reported by name
 * and only its two ends are counted.
 */
export const MAX_FIG_SPAN = 500;

function parseRefSpan(span: string, oversized?: string[]): number[] {
  const parts = span.match(/\d+|[-–—]|through|thru|to|and|or|,/gi) || [];
  const out = new Set<number>();
  let prev: number | null = null;
  let rangePending = false;
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (rangePending && prev !== null) {
        const lo = Math.min(prev, n);
        const hi = Math.max(prev, n);
        if (hi - lo > MAX_FIG_SPAN) {
          oversized?.push(`${prev}–${n}`);
          out.add(n);
        } else {
          for (let k = lo; k <= hi; k++) out.add(k);
        }
      } else {
        out.add(n);
      }
      rangePending = false;
      prev = n;
    } else if (/^(?:[-–—]|through|thru|to)$/i.test(p)) {
      rangePending = true;
    } else {
      rangePending = false;
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * The figure numbers one FIG_RE match names. A SINGULAR head ("FIG.",
 * "Figure") names one figure, so a comma ends it: "As shown in FIG. 2, 10
 * sensors (18) …" is FIG. 2, never FIG. 10 (fix2). A plural head ("FIGS.
 * 1, 2 and 4") keeps its comma list.
 */
function figureSpan(m: RegExpExecArray): string {
  const head = m[0].slice(0, m[0].length - m[1].length);
  return /^fig(?:ure)?\.?\s*$/i.test(head) ? m[1].split(",")[0] : m[1];
}

function figureRefsDetailed(text: string): { nums: number[]; oversized: string[] } {
  const nums = new Set<number>();
  const oversized: string[] = [];
  let m: RegExpExecArray | null;
  FIG_RE.lastIndex = 0;
  while ((m = FIG_RE.exec(text)) !== null) {
    for (const n of parseRefSpan(figureSpan(m), oversized)) nums.add(n);
  }
  return { nums: Array.from(nums).sort((a, b) => a - b), oversized };
}

/** Distinct figure numbers referenced in the text, ascending. */
export function extractFigureRefs(text: string): number[] {
  return figureRefsDetailed(text).nums;
}

/**
 * Figure numbers listed in the Brief Description of the Drawings, or null when the
 * document has no such section.
 *
 * Figure continuity used to be checked against the PROSE alone — the interior gaps
 * in the set of `FIG. N` references — which cannot see the commonest figure defect
 * there is: a specification that discusses FIG. 1 through 6 while the brief
 * description covers only 1 through 5. Both sets are contiguous, so nothing fired.
 *
 * Word's `body.text` separates paragraphs with a CARRIAGE RETURN on some hosts and
 * a newline on others, so splitting on "\n" alone would find no headings at all —
 * a silent no-op that every "\n" test fixture would happily pass.
 *
 * Returns null rather than a warning when the heading is absent: this module is
 * conservative by design, and plenty of documents legitimately have no drawings
 * section (a brief, a draft, a provisional).
 */
const BRIEF_DESCRIPTION_RE = /^brief descriptions?\s+of\b.*\b(drawings?|figures?|views?)\b/i;

// A HEADING IS STILL A HEADING WITH A COLON ON IT. looksLikeHeading rejects any
// line ending in punctuation — right for its own job (deciding what to number),
// wrong here, where "BRIEF DESCRIPTION OF THE DRAWINGS:" is one of the two forms
// everybody writes. The trailing colon is dropped before asking.
const asHeading = (t: string): string => t.replace(/[:.]\s*$/, "");
// Finding THIS heading and finding ANY heading are different questions.
//
// looksLikeHeading is the right test for the section's END, where anything at all
// may follow. For the start it is too strict: it accepts a non-standard heading
// only when it is fully upper-case, so "Brief Description of Drawings" — title
// case, no "the" — was not a heading and the whole check silently did not run.
// BRIEF_DESCRIPTION_RE is anchored and specific enough to carry the start on its
// own; the length bound is what keeps a prose sentence that happens to open with
// those words from being mistaken for the list.
// A HEADING DOES NOT CITE A FIGURE. A sentence about the drawings does.
//
// Reproduced on a CORRECT specification: a summary paragraph opening
// "Brief description of the drawings with reference to FIG. 1" won the section
// start, because it matches the regex, is under 80 characters, and — ending in
// a digit rather than a full stop — `looksLikeHeading` accepts it. The body
// then became the single line beneath it, so only FIG. 1 counted as described
// and FIG. 2 was reported missing from a document that describes it perfectly.
// That is the maximal false alarm on a correct document, on the surface where
// false alarms teach an attorney to ignore the whole audit.
//
// Testing for a figure CITATION rather than tightening the punctuation rule
// keeps legitimate headings that carry a comma ("…DRAWINGS, FIGURES AND
// VIEWS") working: FIG_REF needs digits after the word, which a heading has
// and a citation does not.
const FIG_REF = /\bfig(?:ures?|s)?\.?\s*\d/i;
const isBriefDescriptionHeading = (t: string): boolean =>
  BRIEF_DESCRIPTION_RE.test(t) && t.length <= 80 && !FIG_REF.test(t) && (looksLikeHeading(t) || !/[.;,]/.test(t));

/** Index of the Brief Description of the Drawings heading line, or -1. */
function briefDescriptionStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = asHeading(lines[i].trim());
    if (t && isBriefDescriptionHeading(t)) return i;
  }
  return -1;
}

/** True when the document has a Brief Description of the Drawings heading —
 *  i.e. it is a patent application, whose figures are captioned by that
 *  section and by the drawing sheets, never by in-text "Figure N:" captions. */
function hasBriefDescriptionHeading(text: string): boolean {
  return briefDescriptionStart(text.split(/\r\n|\r|\n/)) >= 0;
}

function briefDescriptionFigures(text: string): number[] | null {
  const lines = text.split(/\r\n|\r|\n/);
  const start = briefDescriptionStart(lines);
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (looksLikeHeading(asHeading(t))) break;
    body.push(t);
  }
  const figures = extractFigureRefs(body.join("\n"));
  // NO FIGURES FOUND IS NOT "NO FIGURES DESCRIBED".
  //
  // Returning [] here and testing it with `if (described)` reported EVERY figure in
  // the document as undescribed — the maximal false alarm, from two reachable
  // inputs: the heading as the last line, and a body whose first line is itself
  // heading-shaped ("IN THE DRAWINGS" is all-caps, so the scan stops immediately
  // with the real FIG. lines sitting right underneath). Either way this read
  // nothing, and the honest report of having read nothing is silence.
  return figures.length ? figures : null;
}

/** Runs the full document audit and returns a structured, per-section report. */
export function auditDocument(input: AuditInput): AuditReport {
  const text = input.documentText;
  const sections: AuditSection[] = [];

  // 1. Reference numerals.
  {
    // Pass the table so extractNumerals can discard citation years and
    // enumeration far outside the numbering range.
    const known = input.numerals.map((e) => e.numeral);
    // The text goes to reconcileNumerals too, so the "housing 12" house style
    // (no parentheses) counts as a use — without it every such numeral was
    // reported "defined but never called out".
    const f = reconcileNumerals(input.numerals, extractNumerals(text, known), text);
    const issues: string[] = [];
    for (const c of f.collisions) issues.push(`Numeral (${c.numeral}) reused for: ${c.elements.join(", ")}`);
    for (const d of f.duplicates) {
      issues.push(`"${d.element}" is numbered ${d.numerals.map((n) => `(${n})`).join(" and ")}`);
    }
    if (f.gaps.length) issues.push(`Skipped numerals: ${f.gaps.join(", ")}`);
    if (f.orphans.length) issues.push(`Called out but undefined: ${f.orphans.map((n) => `(${n})`).join(", ")}`);
    if (f.unused.length) issues.push(`Defined but never called out: ${f.unused.map((e) => `(${e.numeral})`).join(", ")}`);
    sections.push({ title: "Reference numerals", issues });
  }

  // 2. Sequences — SEQ ID NO references vs. the listing.
  //
  // NO LISTING IS NOT AN EMPTY LISTING.
  //
  // `listingCount` is read live from the pane's sequence cards, and nothing persists
  // them: reopen Word the next day and it is 0. The reconciliation then flagged
  // every reference as `n > 0`, so a CORRECT specification citing SEQ ID NO: 1 and
  // NOs: 2-40 reported forty out-of-range errors in the red block. False alarms at
  // that volume teach the user to ignore the whole audit, including the numeral and
  // figure sections that were right.
  //
  // With nothing to reconcile against, the honest report is neither "✓" nor forty
  // errors — it is "not checked", which is what a note says.
  {
    const refs = extractSeqIdRefs(text);
    const issues: string[] = [];
    const notes: string[] = [];
    if (input.listingCount > 0) {
      const f = reconcileSeqIds(refs, input.listingCount);
      if (f.outOfRange.length) issues.push(`SEQ ID NO out of range (listing has ${input.listingCount}): ${f.outOfRange.join(", ")}`);
      if (f.uncited.length) issues.push(`Listed but never cited: SEQ ID NO ${f.uncited.join(", ")}`);
    } else if (refs.length > 0) {
      const span = refs.length === 1 ? `${refs[0]}` : `${refs[0]}-${refs[refs.length - 1]}`;
      notes.push(
        `NOT CHECKED: the document cites ${refs.length} SEQ ID NO reference${refs.length === 1 ? "" : "s"} ` +
          `(${span}), but no sequence listing is loaded in this session, so there is nothing to reconcile them ` +
          `against. Load or rebuild the listing in Sequence mode and run the audit again.`,
      );
    }
    sections.push({ title: "Sequences (SEQ ID NO)", issues, ...(notes.length ? { notes } : {}) });
  }

  // 3. Figures — continuity of referenced figure numbers, and cover against the
  //    Brief Description of the Drawings.
  {
    const { nums: figs, oversized } = figureRefsDetailed(text);
    const issues: string[] = [];
    for (const r of oversized) {
      issues.push(`FIGS. ${r} spans more than ${MAX_FIG_SPAN} figures — not expanded; check for a mistyped number`);
    }
    if (figs.length >= 2) {
      const first = figs[0];
      const last = figs[figs.length - 1];
      if (last - first > MAX_FIG_SPAN) {
        issues.push(`Figure numbers run from FIG. ${first} to FIG. ${last} (more than ${MAX_FIG_SPAN} apart) — gaps not listed; check for a mistyped number`);
      } else {
        const have = new Set(figs);
        const gaps: number[] = [];
        for (let n = first; n <= last; n++) if (!have.has(n)) gaps.push(n);
        if (gaps.length) issues.push(`Figure number(s) referenced with gaps; missing: ${gaps.join(", ")}`);
      }
    }
    const described = briefDescriptionFigures(text);
    if (described) {
      // The brief description is part of `text`, so everything described is also
      // referenced — only the one direction can be non-empty, and it is the one
      // that matters: a figure discussed in the body with no entry in the list.
      const undescribed = figs.filter((n) => !described.includes(n));
      if (undescribed.length) {
        issues.push(
          `Referenced but missing from the Brief Description of the Drawings: ` +
            `${undescribed.map((n) => `FIG. ${n}`).join(", ")}`,
        );
      }
    }
    sections.push({ title: "Figures", issues });
  }

  // 4. Cross-references — every "Fig. N" / "Table N" should have a caption.
  {
    const issues: string[] = [];
    // A patent application captions its figures in the Brief Description of
    // the Drawings and on the drawing sheets, not with in-text "Figure 1:"
    // captions — checking them flagged EVERY "FIG. 1" as uncaptioned. Tables
    // are still checked.
    const kinds: RefKind[] = hasBriefDescriptionHeading(text) ? ["table"] : ["figure", "table"];
    for (const kind of kinds) {
      const caps = new Set(extractCaptionNumbers(text, kind));
      const refs = extractRefNumbers(text, kind);
      const dangling = refs.filter((n) => !caps.has(n));
      if (dangling.length) {
        const word = kind === "figure" ? "Fig." : "Table";
        issues.push(`Referenced without a caption: ${dangling.map((n) => `${word} ${n}`).join(", ")}`);
      }
    }
    sections.push({ title: "Cross-references", issues });
  }

  const issueCount = sections.reduce((sum, s) => sum + s.issues.length, 0);
  return { sections, issueCount, ok: issueCount === 0 };
}
