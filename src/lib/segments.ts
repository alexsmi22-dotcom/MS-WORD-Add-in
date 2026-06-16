// Shared types and helpers for turning a formula string into formatted runs.
//
// A formula is represented as an ordered list of `Segment`s. Each segment is a
// chunk of text plus how it should render in Word: as normal text, a subscript,
// or a superscript. The Word insertion code (taskpane.ts) walks this list and
// applies the matching font settings to each inserted run.

export type SegmentType = "normal" | "sub" | "sup";

export interface Segment {
  text: string;
  type: SegmentType;
}

/**
 * Appends text to a segment list, merging with the previous segment when it has
 * the same type. Keeping adjacent same-type text in one segment means fewer
 * Word runs to insert and a cleaner result.
 */
export function pushSegment(segments: Segment[], text: string, type: SegmentType): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === type) {
    last.text += text;
  } else {
    segments.push({ text, type });
  }
}

/** Escapes text for safe inclusion in HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders segments to an HTML fragment using <sub>/<sup>. Both the live preview
 * and the Word insertion use this single function, so what you see in the
 * preview is exactly what gets inserted into the document.
 */
export function segmentsToHtml(segments: Segment[]): string {
  return segments
    .map((seg) => {
      const text = escapeHtml(seg.text);
      if (seg.type === "sub") return `<sub>${text}</sub>`;
      if (seg.type === "sup") return `<sup>${text}</sup>`;
      return text;
    })
    .join("");
}
