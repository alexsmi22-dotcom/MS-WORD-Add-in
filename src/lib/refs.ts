// Figure/table captions, equation cross-references, and a numbering consistency
// check. Auto-numbered captions (per-document running counters, managed by the
// task pane) plus "see Fig. 3" / "Eq. (2)" cross-references — the staple of every
// paper, thesis, and report. The check scans for skipped or duplicated caption
// numbers.
//
// Pure string logic — no Office.js — fully unit-testable. Deterministic formatting
// and a regex scan; like the rest of the engine, the check is advisory. (For true
// auto-renumbering, Word's own cross-reference fields remain the authority; this is
// the lightweight authoring aid.)

import { maxOf } from "./minmax";

export type RefKind = "figure" | "table" | "scheme";

const STYLE: Record<RefKind, { caption: string; abbr: string }> = {
  figure: { caption: "Figure", abbr: "Fig." },
  table: { caption: "Table", abbr: "Table" },
  scheme: { caption: "Scheme", abbr: "Scheme" },
};

/** A numbered caption, e.g. "Figure 1. A widget" (or "Figure 1" with no text). */
export function formatCaption(kind: RefKind, n: number, text = ""): string {
  const base = `${STYLE[kind].caption} ${n}`;
  const t = text.trim();
  return t ? `${base}. ${t}` : base;
}

/** An in-text cross-reference, e.g. "Fig. 3" / "Table 2". */
export function formatRef(kind: RefKind, n: number): string {
  return `${STYLE[kind].abbr} ${n}`;
}

/** An equation cross-reference, e.g. "Eq. (3)". */
export function formatEqRef(n: number): string {
  return `Eq. (${n})`;
}

/**
 * Caption numbers found at the start of a line ("Figure 3", "Table 1"), in order.
 *
 * The line anchor must accept \r, not just \n. Word's `body.text` delimits
 * paragraphs with a carriage return, so anchoring on \n alone matched nothing in
 * any real document: "Check captions" reported clean even when captions were
 * duplicated or skipped, and the Audit reported every figure reference as having
 * no caption. \v is accepted too — Word uses it for a line break within a
 * paragraph — matching how toa.ts:359 already splits text.
 */
export function extractCaptionNumbers(text: string, kind: RefKind): number[] {
  const word = STYLE[kind].caption;
  const re = new RegExp(`(?:^|[\\r\\n\\v])[^\\S\\r\\n\\v]*${word}\\s+(\\d+)`, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(parseInt(m[1], 10));
  return out;
}

function parseRefSpan(span: string): number[] {
  const parts = span.match(/\d+|[-–—]|to|and|or|,/gi) || [];
  const out: number[] = [];
  let prev: number | null = null;
  let rangePending = false;
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (rangePending && prev !== null) for (let k = Math.min(prev, n); k <= Math.max(prev, n); k++) out.push(k);
      else out.push(n);
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

/**
 * Distinct numbers referenced anywhere as cross-references ("Fig. 3", "Figure 5",
 * "Figs. 1-3" / "Table 2"). Unlike extractCaptionNumbers this is not anchored to
 * line start — it includes both prose references and the caption lines.
 */
export function extractRefNumbers(text: string, kind: RefKind): number[] {
  const re =
    kind === "figure"
      ? /\bfig(?:ure|s|\.)?\.?\s*(\d+(?:\s*(?:[-–—]|to|and|or|,)\s*\d+)*)/gi
      : kind === "scheme"
        ? /\bschemes?\s+(\d+(?:\s*(?:[-–—]|to|and|or|,)\s*\d+)*)/gi
        : /\btables?\s+(\d+(?:\s*(?:[-–—]|to|and|or|,)\s*\d+)*)/gi;
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) for (const n of parseRefSpan(m[1])) nums.add(n);
  return Array.from(nums).sort((a, b) => a - b);
}

export interface CaptionFindings {
  /** Numbers skipped: 3, or "2.2" for chapter-numbered captions. */
  gaps: Array<number | string>;
  duplicates: Array<number | string>;
  ok: boolean;
}

/**
 * Chapter-numbered caption labels at the start of a line ("Figure 2.3" → "2.3"), in order; empty when the captions
 * are numbered plainly. Word's chapter captions (STYLEREF + SEQ … \s 1) restart at each chapter, so the check is
 * per chapter (release A review: "Figure 1.1, 1.2, 2.1" read as a duplicated 1).
 */
export function extractChapterCaptions(text: string, kind: RefKind): string[] {
  const word = STYLE[kind].caption;
  // A caption, not a sentence: the number is followed by caption punctuation (". ", ":", a spaced dash), the end of
  // the line, or — after a dotted number — a capitalised title. "Figure 2–4 show the results" (a range) and
  // "Table 1.5 mg of x" (a quantity) are prose (fix-round review: either switched the whole check to chapters).
  const re = new RegExp(
    `(?:^|[\\r\\n\\v])[^\\S\\r\\n\\v]*${word}\\s+(\\d+)([.\\-–])(\\d+)(?=[.:]|[^\\S\\r\\n\\v]+[-–—][^\\S\\r\\n\\v]|[^\\S\\r\\n\\v]*(?:[\\r\\n\\v]|$)|([^\\S\\r\\n\\v]+\\p{Lu}))`,
    "gu",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[4] !== undefined && m[2] !== ".") continue; // "Figure 2–4 Results" is a range; only 2.4 may take a bare title
    out.push(`${parseInt(m[1], 10)}.${parseInt(m[3], 10)}`);
  }
  return out;
}

/** Line-start captions numbered plainly ("Figure 3. …"), counted to tell a chapter-numbered document from one that only mentions a 2.1. */
function plainCaptionCount(text: string, kind: RefKind): number {
  const re = new RegExp(`(?:^|[\\r\\n\\v])[^\\S\\r\\n\\v]*${STYLE[kind].caption}\\s+\\d+(?![.\\-–]\\d)`, "g");
  return (text.match(re) ?? []).length;
}

/** Flags skipped or duplicated caption numbers for a kind (1..max expected; per chapter for chapter numbering). */
export function checkCaptions(text: string, kind: RefKind): CaptionFindings {
  const chapter = extractChapterCaptions(text, kind);
  // Chapter numbering only when chapter captions are the document's form, not one stray "Figure 1.2" among plain ones.
  if (chapter.length && chapter.length >= plainCaptionCount(text, kind)) {
    const seen = new Map<string, number>();
    for (const l of chapter) seen.set(l, (seen.get(l) ?? 0) + 1);
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([l]) => l);
    const byChapter = new Map<number, number[]>();
    for (const l of seen.keys()) {
      const [ch, n] = l.split(".").map(Number);
      (byChapter.get(ch) ?? byChapter.set(ch, []).get(ch)!).push(n);
    }
    const gaps: string[] = [];
    for (const [ch, ns] of [...byChapter].sort((a, b) => a[0] - b[0])) {
      const max = maxOf(ns);
      for (let i = 1; i <= max; i++) if (!ns.includes(i)) gaps.push(`${ch}.${i}`);
    }
    return { gaps, duplicates, ok: !gaps.length && !duplicates.length };
  }
  const nums = extractCaptionNumbers(text, kind);
  const seen = new Map<number, number>();
  for (const n of nums) seen.set(n, (seen.get(n) ?? 0) + 1);
  const duplicates = Array.from(seen.entries())
    .filter(([, c]) => c > 1)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  if (nums.length) {
    const max = maxOf(nums);
    for (let i = 1; i <= max; i++) if (!seen.has(i)) gaps.push(i);
  }
  return { gaps, duplicates, ok: gaps.length === 0 && duplicates.length === 0 };
}
