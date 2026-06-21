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
}

export interface AuditReport {
  sections: AuditSection[];
  issueCount: number;
  ok: boolean;
}

// "FIG. 3" / "FIGS. 1-3" / "Figures 2 or 4".
const FIG_RE = /\bfig(?:ure|s)?\.?\s*(\d+(?:\s*(?:[-–—]|to|and|or|,)\s*\d+)*)/gi;

function parseRefSpan(span: string): number[] {
  const parts = span.match(/\d+|[-–—]|to|and|or|,/gi) || [];
  const out: number[] = [];
  let prev: number | null = null;
  let rangePending = false;
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (rangePending && prev !== null) {
        for (let k = Math.min(prev, n); k <= Math.max(prev, n); k++) out.push(k);
      } else {
        out.push(n);
      }
      rangePending = false;
      prev = n;
    } else if (/^(?:[-–—]|to)$/i.test(p)) {
      rangePending = true;
    } else {
      rangePending = false;
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** Distinct figure numbers referenced in the text, ascending. */
export function extractFigureRefs(text: string): number[] {
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  FIG_RE.lastIndex = 0;
  while ((m = FIG_RE.exec(text)) !== null) {
    for (const n of parseRefSpan(m[1])) nums.add(n);
  }
  return Array.from(nums).sort((a, b) => a - b);
}

/** Runs the full document audit and returns a structured, per-section report. */
export function auditDocument(input: AuditInput): AuditReport {
  const text = input.documentText;
  const sections: AuditSection[] = [];

  // 1. Reference numerals.
  {
    const f = reconcileNumerals(input.numerals, extractNumerals(text));
    const issues: string[] = [];
    for (const c of f.collisions) issues.push(`Numeral (${c.numeral}) reused for: ${c.elements.join(", ")}`);
    if (f.gaps.length) issues.push(`Skipped numerals: ${f.gaps.join(", ")}`);
    if (f.orphans.length) issues.push(`Called out but undefined: ${f.orphans.map((n) => `(${n})`).join(", ")}`);
    if (f.unused.length) issues.push(`Defined but never called out: ${f.unused.map((e) => `(${e.numeral})`).join(", ")}`);
    sections.push({ title: "Reference numerals", issues });
  }

  // 2. Sequences — SEQ ID NO references vs. the listing.
  {
    const refs = extractSeqIdRefs(text);
    const issues: string[] = [];
    if (input.listingCount > 0 || refs.length > 0) {
      const f = reconcileSeqIds(refs, input.listingCount);
      if (f.outOfRange.length) issues.push(`SEQ ID NO out of range (listing has ${input.listingCount}): ${f.outOfRange.join(", ")}`);
      if (f.uncited.length) issues.push(`Listed but never cited: SEQ ID NO ${f.uncited.join(", ")}`);
    }
    sections.push({ title: "Sequences (SEQ ID NO)", issues });
  }

  // 3. Figures — continuity of referenced figure numbers.
  {
    const figs = extractFigureRefs(text);
    const issues: string[] = [];
    if (figs.length >= 2) {
      const gaps: number[] = [];
      for (let n = figs[0]; n <= figs[figs.length - 1]; n++) if (!figs.includes(n)) gaps.push(n);
      if (gaps.length) issues.push(`Figure number(s) referenced with gaps; missing: ${gaps.join(", ")}`);
    }
    sections.push({ title: "Figures", issues });
  }

  // 4. Cross-references — every "Fig. N" / "Table N" should have a caption.
  {
    const issues: string[] = [];
    for (const kind of ["figure", "table"] as RefKind[]) {
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
