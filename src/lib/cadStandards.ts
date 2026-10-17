/**
 * Drawing standards for the CAD canvas (docs/SCOPE-CAD-CANVAS.md §0).
 *
 * One hidden-line engine makes every view; a STANDARD decides how the result is
 * dressed: line weights, whether hidden lines show, how views are arranged and
 * labelled, how parts are numbered, the text height and the drawing area.
 *
 * SOURCES.
 *   - USPTO: 37 CFR 1.84 and the v2.143.0 USPTO figure preset (figureStyle.ts),
 *     which already enforces the 1.84(p)(3) text height with a 10 % margin.
 *   - ISO / ASME: the user's references (2026-10-17), VALIDATED against
 *     published sources — see docs/DRAFTING-STANDARDS-REFERENCE.md for each
 *     value, its source and its confidence. Confirmed: ASME Y14.2 thick 0.6 /
 *     thin 0.3 mm minimums, 3.0 mm general text, 6 mm (0.24 in) view titles
 *     (the references said 4–5 and 5–6 mm; sources say 0.24 in); ISO 128 √2
 *     width series in 2:1 groups; ISO 3098 √2 height series. Disputed: the ASME
 *     hidden-line gap (1 mm in the reference, 1.5 mm in a course text).
 *   Values that are a CHOICE within a standard are marked PRODUCT. Every number
 *   is a field the user can see, never a hidden assumption.
 * Text heights in drafting are CAPITAL heights, so sizes are converted to a
 * font size through the font's measured cap height (figureStyle.CAP_HEIGHT_EM).
 */
import { CAP_HEIGHT_EM, FONT_STACK_SANS, USPTO_REQUIRED_FONT_PT, ptToMm } from "./figureStyle";

/** The font size (pt) whose CAPITALS are `mm` tall in Arial, the worst member of the sans stack. */
export function capMmToPt(mm: number): number {
  return mm / ptToMm(1) / CAP_HEIGHT_EM.arial;
}

export type StandardId = "asme" | "iso" | "uspto" | "journal" | "plain";

/** How orthographic views are arranged around the front view. */
export type Projection = "third" | "first";

export interface DrawingStandard {
  id: StandardId;
  name: string;
  description: string;
  projection: Projection;
  /** Visible (thick) and hidden (thin) line widths, mm at printed size. */
  visibleMm: number;
  hiddenMm: number;
  /** Hidden lines in orthographic views / in pictorial (isometric, orbit) views. */
  hiddenInOrthographic: boolean;
  hiddenInPictorial: boolean;
  /** Hidden-line dash and gap, in multiples of the hidden line width (ISO 128 states it that way). */
  dash: [number, number];
  /** Or in absolute mm, which ASME Y14.2 uses; wins over `dash` when set. */
  dashMm?: [number, number];
  /** Text: the font stack; callout / note text and view-title text, font size in pt at printed size. */
  font: string;
  textPt: number;
  headingPt: number;
  /** How views are labelled: "FIG. 1" (patent and journal numbering) or by the view's name. */
  viewLabels: "fig" | "name" | "none";
  /** How parts are called out: a numeral on a lead line, or a numbered balloon. */
  callouts: "leader" | "balloon";
  /** The largest drawing area, mm (the sheet's usable area for the views). */
  areaMm: { w: number; h: number };
  /** Draw the projection symbol (first/third angle) on the sheet. */
  projectionSymbol: boolean;
  /** The figure-style preset the insert goes through (uspto = 1.84 checks enforced). */
  figurePreset: "uspto" | "asdrawn";
}

export const DRAWING_STANDARDS: Record<StandardId, DrawingStandard> = {
  asme: {
    id: "asme",
    name: "Engineering drawing — ASME (third-angle)",
    description:
      "ASME Y14.3 third-angle projection: the top view above the front, the right side to its right. " +
      "Two line widths (ASME Y14.2: thick 0.6 mm, thin 0.3 mm), hidden lines dashed in the orthographic " +
      "views, 3.0 mm text and 6 mm view titles in capitals, numbered balloons, the third-angle symbol.",
    projection: "third",
    visibleMm: 0.6,
    hiddenMm: 0.3,
    hiddenInOrthographic: true,
    hiddenInPictorial: false,
    dash: [10, 5],
    // ASME Y14.2 hidden line: dashes about 3 mm; the gap is DISPUTED between
    // sources (1 mm vs 1.5 mm) — 1.5 mm until the standard's own figure is read.
    dashMm: [3, 1.5],
    font: FONT_STACK_SANS,
    textPt: capMmToPt(3), // ASME Y14.2 general text minimum, 3.0 mm
    headingPt: capMmToPt(6), // ASME Y14.2: titles, view and section letters 0.24 in (6 mm)
    viewLabels: "name",
    callouts: "balloon",
    areaMm: { w: 254, h: 178 }, // PRODUCT: ANSI A (11 × 8.5 in) landscape inside a border
    projectionSymbol: true,
    figurePreset: "asdrawn",
  },
  iso: {
    id: "iso",
    name: "Engineering drawing — ISO (first-angle)",
    description:
      "ISO 5456-2 first-angle projection: the top view below the front, the view from the right on its left. " +
      "ISO 128 lines in a 2:1 ratio (0.5 / 0.25 mm), hidden lines dashed in the orthographic views, " +
      "2.5 mm text and 3.5 mm view titles (ISO 3098), numbered balloons, the first-angle symbol.",
    projection: "first",
    visibleMm: 0.5,
    hiddenMm: 0.25,
    hiddenInOrthographic: true,
    hiddenInPictorial: false,
    dash: [12, 3], // ISO 128 hidden line: dash 12d, gap 3d
    font: FONT_STACK_SANS,
    textPt: capMmToPt(2.5), // ISO 3098 general notes and dimensions
    headingPt: capMmToPt(3.5), // ISO 3098 secondary titles
    viewLabels: "name",
    callouts: "balloon",
    areaMm: { w: 267, h: 180 }, // A4 landscape inside a 20 mm filing margin and 10 mm borders (ISO 5457)
    projectionSymbol: true,
    figurePreset: "asdrawn",
  },
  uspto: {
    id: "uspto",
    name: "Patent drawing — USPTO 37 CFR 1.84",
    description:
      "Black lines on white only (1.84(a)), views labelled FIG. 1, FIG. 2 (1.84(u)), reference numerals at least " +
      "3.2 mm high on lead lines that touch the part (1.84(p), (q)), inside the 170 × 244 mm sight (1.84(g)). " +
      "Hidden lines off by default.",
    projection: "third",
    visibleMm: 0.4, // PRODUCT: 1.84(l) asks for lines "uniformly thick and well-defined", no width
    hiddenMm: 0.25,
    hiddenInOrthographic: false,
    hiddenInPictorial: false,
    dash: [10, 4],
    font: FONT_STACK_SANS,
    textPt: USPTO_REQUIRED_FONT_PT, // 3.2 mm + the 10 % margin the USPTO figure style requires
    headingPt: USPTO_REQUIRED_FONT_PT, // FIG. labels are characters too: the same 1.84(p)(3) floor
    viewLabels: "fig",
    callouts: "leader",
    areaMm: { w: 170, h: 244 },
    projectionSymbol: false,
    figurePreset: "uspto",
  },
  journal: {
    id: "journal",
    name: "Journal / technical figure",
    description: "A clean line figure for papers, theses and reports: thin lines, no hidden lines, panels labelled FIG. 1.",
    projection: "third",
    visibleMm: 0.3,
    hiddenMm: 0.18,
    hiddenInOrthographic: false,
    hiddenInPictorial: false,
    dash: [8, 4],
    font: FONT_STACK_SANS,
    textPt: 8,
    headingPt: 9, // PRODUCT
    viewLabels: "fig",
    callouts: "leader",
    areaMm: { w: 180, h: 200 },
    projectionSymbol: false,
    figurePreset: "asdrawn",
  },
  plain: {
    id: "plain",
    name: "Plain line art",
    description: "Just the drawing: no labels, no symbol, hidden lines off.",
    projection: "third",
    visibleMm: 0.35,
    hiddenMm: 0.2,
    hiddenInOrthographic: false,
    hiddenInPictorial: false,
    dash: [8, 4],
    font: FONT_STACK_SANS,
    textPt: 9,
    headingPt: 9, // PRODUCT (no titles are drawn)
    viewLabels: "none",
    callouts: "leader",
    areaMm: { w: 170, h: 170 },
    projectionSymbol: false,
    figurePreset: "asdrawn",
  },
};

/** The default for engineering drawings: ASME (US practice). ISO is one choice away. */
export const DEFAULT_STANDARD: StandardId = "asme";
