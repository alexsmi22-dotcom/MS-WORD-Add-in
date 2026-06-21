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

export type RefKind = "figure" | "table";

const STYLE: Record<RefKind, { caption: string; abbr: string }> = {
  figure: { caption: "Figure", abbr: "Fig." },
  table: { caption: "Table", abbr: "Table" },
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

/** Caption numbers found at the start of a line ("Figure 3", "Table 1"), in order. */
export function extractCaptionNumbers(text: string, kind: RefKind): number[] {
  const word = STYLE[kind].caption;
  const re = new RegExp(`(?:^|\\n)\\s*${word}\\s+(\\d+)`, "g");
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
      : /\btables?\s+(\d+(?:\s*(?:[-–—]|to|and|or|,)\s*\d+)*)/gi;
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) for (const n of parseRefSpan(m[1])) nums.add(n);
  return Array.from(nums).sort((a, b) => a - b);
}

export interface CaptionFindings {
  gaps: number[];
  duplicates: number[];
  ok: boolean;
}

/** Flags skipped or duplicated caption numbers for a kind (1..max expected). */
export function checkCaptions(text: string, kind: RefKind): CaptionFindings {
  const nums = extractCaptionNumbers(text, kind);
  const seen = new Map<number, number>();
  for (const n of nums) seen.set(n, (seen.get(n) ?? 0) + 1);
  const duplicates = Array.from(seen.entries())
    .filter(([, c]) => c > 1)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  if (nums.length) {
    const max = Math.max(...nums);
    for (let i = 1; i <= max; i++) if (!seen.has(i)) gaps.push(i);
  }
  return { gaps, duplicates, ok: gaps.length === 0 && duplicates.length === 0 };
}
