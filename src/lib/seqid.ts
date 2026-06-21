// SEQ ID NO cross-reference linkage. Closes the loop between the ST.26 sequence
// listing (Sequence mode) and the specification text: format in-text references
// consistently and reconcile them against the number of sequences in the listing.
//
// Pure string logic — no Office.js — fully unit-testable.

// "SEQ ID NO: 1" / "SEQ ID NO. 1" / "SEQ ID NO 1" / "SEQ ID NOs: 1 and 2".
const SEQID_RE = /SEQ\s+ID\s+NOs?\b\s*[:.]?\s*(\d+(?:\s*(?:[-–—]|to|or|and|,)\s*\d+)*)/gi;

function parseRefSpan(span: string): number[] {
  const parts = span.match(/\d+|[-–—]|to|or|and|,/gi) || [];
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

/** Distinct SEQ ID NO numbers referenced in a block of text, ascending. */
export function extractSeqIdRefs(text: string): number[] {
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  SEQID_RE.lastIndex = 0;
  while ((m = SEQID_RE.exec(text)) !== null) {
    for (const n of parseRefSpan(m[1])) nums.add(n);
  }
  return Array.from(nums).sort((a, b) => a - b);
}

/** Formats a single, canonical in-text reference, e.g. "SEQ ID NO: 1". */
export function formatSeqIdRef(n: number): string {
  return `SEQ ID NO: ${n}`;
}

/**
 * Formats a multi-reference. Contiguous runs of 3+ collapse to "a-b"; shorter
 * runs are listed. e.g. [1,2,3] → "SEQ ID NOs: 1-3"; [1,3] → "SEQ ID NOs: 1 and
 * 3"; [1,2,4,5] → "SEQ ID NOs: 1, 2, 4 and 5".
 */
export function formatSeqIdRefs(nums: number[]): string {
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  if (!sorted.length) return "";
  if (sorted.length === 1) return formatSeqIdRef(sorted[0]);

  const tokens: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = (): void => {
    const runLen = prev - start + 1;
    if (runLen >= 3) tokens.push(`${start}-${prev}`);
    else for (let k = start; k <= prev; k++) tokens.push(String(k));
  };
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      flush();
      start = sorted[i];
      prev = sorted[i];
    }
  }
  const joined =
    tokens.length === 1 ? tokens[0] : tokens.slice(0, -1).join(", ") + " and " + tokens[tokens.length - 1];
  return `SEQ ID NOs: ${joined}`;
}

export interface SeqIdFindings {
  /** Referenced numbers that exceed the listing size (no such sequence). */
  outOfRange: number[];
  /** Listing sequences (1..count) never cited in the text. */
  uncited: number[];
  ok: boolean;
}

/**
 * Reconciles in-text SEQ ID NO references against the listing. `listingCount` is
 * the number of sequences in the ST.26 listing (sequences are 1..listingCount).
 */
export function reconcileSeqIds(refs: number[], listingCount: number): SeqIdFindings {
  const refSet = new Set(refs);
  const outOfRange = Array.from(refSet)
    .filter((n) => n < 1 || n > listingCount)
    .sort((a, b) => a - b);
  const uncited: number[] = [];
  for (let i = 1; i <= listingCount; i++) if (!refSet.has(i)) uncited.push(i);
  return { outOfRange, uncited, ok: outOfRange.length === 0 && uncited.length === 0 };
}
