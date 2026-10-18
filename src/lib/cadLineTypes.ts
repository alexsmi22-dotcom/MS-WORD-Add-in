/**
 * Line types as style objects (docs/SCOPE-CAD-R2.md R2b). Every stroke the sheet
 * draws names one of these; nothing picks a width or a dash pattern inline.
 *
 * SOURCES (docs/DRAFTING-STANDARDS-REFERENCE.md):
 *   - ISO 128-20:1996 (read as IS 10714-20:2001): basic types 01 continuous,
 *     02 dashed, 04 long-dashed dotted, 05 long-dashed double-dotted; elements in
 *     multiples of the width d — dot ≤ 0.5d, gap 3d, dash 12d, long dash 24d.
 *   - ISO 5457:1999 (read as IS 10711:2001): frame and centring marks 0.7 mm,
 *     grid reference lines 0.35 mm.
 *   - ASME Y14.2 (secondary sources): thick 0.6 / thin 0.3 mm; hidden dashes
 *     3 mm with a disputed gap (1.5 mm used). Centre and phantom element lengths
 *     are UNVERIFIED product defaults.
 * A dot is no longer than half the line width, so every non-continuous line is
 * drawn with butt caps: a round cap would lengthen each element by d.
 */
import { DrawingStandard } from "./cadStandards";

export type LineTypeId = "visible" | "hidden" | "centre" | "phantom" | "frame" | "grid" | "centring" | "tbOuter" | "tbInner";

export interface LineType {
  id: LineTypeId;
  /** What the line is for, as the pane lists it. */
  name: string;
  /** The standard's own designation, when it has one ("ISO 128-20 type 02"). */
  designation: string;
  widthMm: number;
  /** Dash pattern in mm at printed size; empty = continuous. */
  dashMm: number[];
  cap: "round" | "butt";
  /** PRODUCT when the value is a choice within (or beyond) the standard. */
  product: boolean;
}

const lt = (id: LineTypeId, name: string, designation: string, widthMm: number, dashMm: number[], product = false): LineType => ({
  id,
  name,
  designation,
  widthMm,
  dashMm,
  cap: dashMm.length ? "butt" : "round",
  product,
});

/** The line types of a standard's sheets. */
export function lineTypesFor(std: DrawingStandard): Record<LineTypeId, LineType> {
  const wide = std.visibleMm, narrow = std.hiddenMm;
  // The hidden pattern every release so far has drawn: ASME in absolute mm, the others in multiples of d.
  const hidden = std.dashMm ? [...std.dashMm] : [std.dash[0] * narrow, std.dash[1] * narrow];
  if (std.id === "asme") {
    return {
      visible: lt("visible", "Visible outlines", "ASME Y14.2 visible (thick)", wide, []),
      hidden: lt("hidden", "Hidden lines", "ASME Y14.2 hidden (thin)", narrow, hidden),
      centre: lt("centre", "Centre lines", "ASME Y14.2 center (thin)", narrow, [20, 1.5, 3, 1.5], true),
      phantom: lt("phantom", "Phantom lines", "ASME Y14.2 phantom (thin)", narrow, [20, 1.5, 3, 1.5, 3, 1.5], true),
      frame: lt("frame", "Border", "border (thick)", wide, [], true),
      grid: lt("grid", "Zone marks", "zone marks (thin)", narrow, [], true),
      centring: lt("centring", "Centring marks", "centring marks (thick)", wide, [], true),
      tbOuter: lt("tbOuter", "Title block outline", "title block (thick)", wide, [], true),
      tbInner: lt("tbInner", "Title block cells", "title block (thin)", narrow, [], true),
    };
  }
  const isoD = (d: number, ...k: number[]): number[] => k.map((m) => m * d);
  return {
    visible: lt("visible", "Visible outlines", "ISO 128-20 type 01 (wide)", wide, []),
    hidden: lt("hidden", "Hidden lines", "ISO 128-20 type 02 (narrow)", narrow, hidden),
    // 04: long dash 24d, gap 3d, dot 0.5d, gap 3d.
    centre: lt("centre", "Centre lines", "ISO 128-20 type 04 (narrow)", narrow, isoD(narrow, 24, 3, 0.5, 3)),
    // 05: long dash, gap, dot, gap, dot, gap.
    phantom: lt("phantom", "Phantom lines", "ISO 128-20 type 05 (narrow)", narrow, isoD(narrow, 24, 3, 0.5, 3, 0.5, 3)),
    frame: lt("frame", "Frame", "ISO 5457 frame, 0.7 mm", 0.7, []),
    grid: lt("grid", "Grid reference lines", "ISO 5457 grid, 0.35 mm", 0.35, []),
    centring: lt("centring", "Centring marks", "ISO 5457 centring marks, 0.7 mm", 0.7, []),
    tbOuter: lt("tbOuter", "Title block outline", "as the frame, 0.7 mm", 0.7, [], true),
    tbInner: lt("tbInner", "Title block cells", "0.35 mm", 0.35, [], true),
  };
}

/** SVG stroke attributes for a line type at `pxPerMm`. */
export function strokeAttrs(t: LineType, pxPerMm: number): string {
  const f = (v: number): string => (Math.round(v * pxPerMm * 100) / 100).toString();
  return (
    `fill="none" stroke="#000" stroke-width="${f(t.widthMm)}"` +
    (t.dashMm.length ? ` stroke-dasharray="${t.dashMm.map(f).join(" ")}" stroke-linecap="butt"` : ` stroke-linecap="round" stroke-linejoin="round"`)
  );
}
