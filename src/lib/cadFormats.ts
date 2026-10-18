/**
 * Drawing sheet formats (docs/SCOPE-CAD-R2.md R2b): sheet sizes, the frame,
 * the grid reference (ISO) or zones (ASME), centring marks and the title block.
 * Geometry only, in millimetres on the trimmed sheet (origin top-left, y down);
 * cadSheet draws it with the line types of cadLineTypes.
 *
 * SOURCES (docs/DRAFTING-STANDARDS-REFERENCE.md "Sheets, borders and zones"):
 *   - ISO 5457:1999 (read as IS 10711:2001): sizes and drawing spaces, A0–A3
 *     landscape only and A4 portrait only, borders 20 mm left / 10 mm elsewhere,
 *     0.7 mm frame, centring marks, the 50 mm grid from the axes of symmetry with
 *     the field counts of its Table 2, 3.5 mm references, 0.35 mm grid lines,
 *     the size designation at the bottom right.
 *   - ISO 7200:2004 (read as IS 11665:2009): the title block's fields, which are
 *     mandatory and their recommended lengths; 180 mm wide on every size; scale
 *     and projection symbol OUTSIDE the block.
 *   - ANSI sizes A–E; margins from DOD-STD-100D Fig. A-4 (which follows ANSI
 *     Y14.1); zone counts and labelling from secondary sources; the ASME title
 *     block's fields from DOD-STD-100D App. A. Every ASME layout dimension is
 *     PRODUCT — not presented as Y14.1's own.
 *   - 37 CFR 1.84(g): no frames around the sight on patent drawings.
 * The ARRANGEMENT of title block cells is a figure in both standards and is a
 * PRODUCT choice here; field names, which are mandatory and lengths are not.
 */
import { StandardId } from "./cadStandards";

export type SheetSizeId = "A0" | "A1" | "A2" | "A3" | "A4" | "ANSI-A" | "ANSI-B" | "ANSI-C" | "ANSI-D" | "ANSI-E";
export type Orientation = "landscape" | "portrait";

export interface SheetSize {
  id: SheetSizeId;
  /** As the pane lists it. */
  name: string;
  /** As the sheet states it (the ISO size designation, the ASME size letter). */
  designation: string;
  family: "iso" | "ansi";
  longMm: number;
  shortMm: number;
  /** The orientations the standard permits, the first the default. */
  orientations: Orientation[];
}

const IN = 25.4;
export const SHEET_SIZES: Record<SheetSizeId, SheetSize> = {
  A4: { id: "A4", name: "A4 (210 × 297 mm, portrait)", designation: "A4", family: "iso", longMm: 297, shortMm: 210, orientations: ["portrait"] },
  A3: { id: "A3", name: "A3 (420 × 297 mm)", designation: "A3", family: "iso", longMm: 420, shortMm: 297, orientations: ["landscape"] },
  A2: { id: "A2", name: "A2 (594 × 420 mm)", designation: "A2", family: "iso", longMm: 594, shortMm: 420, orientations: ["landscape"] },
  A1: { id: "A1", name: "A1 (841 × 594 mm)", designation: "A1", family: "iso", longMm: 841, shortMm: 594, orientations: ["landscape"] },
  A0: { id: "A0", name: "A0 (1189 × 841 mm)", designation: "A0", family: "iso", longMm: 1189, shortMm: 841, orientations: ["landscape"] },
  "ANSI-A": { id: "ANSI-A", name: "A (11 × 8.5 in)", designation: "A", family: "ansi", longMm: 11 * IN, shortMm: 8.5 * IN, orientations: ["landscape", "portrait"] },
  "ANSI-B": { id: "ANSI-B", name: "B (17 × 11 in)", designation: "B", family: "ansi", longMm: 17 * IN, shortMm: 11 * IN, orientations: ["landscape"] },
  "ANSI-C": { id: "ANSI-C", name: "C (22 × 17 in)", designation: "C", family: "ansi", longMm: 22 * IN, shortMm: 17 * IN, orientations: ["landscape"] },
  "ANSI-D": { id: "ANSI-D", name: "D (34 × 22 in)", designation: "D", family: "ansi", longMm: 34 * IN, shortMm: 22 * IN, orientations: ["landscape"] },
  "ANSI-E": { id: "ANSI-E", name: "E (44 × 34 in)", designation: "E", family: "ansi", longMm: 44 * IN, shortMm: 34 * IN, orientations: ["landscape"] },
};

/** The sheet sizes a standard offers (none: the drawing is not framed). */
export function sheetsFor(std: StandardId): SheetSizeId[] {
  if (std === "iso") return ["A4", "A3", "A2", "A1", "A0"];
  if (std === "asme") return ["ANSI-A", "ANSI-B", "ANSI-C", "ANSI-D", "ANSI-E"];
  return [];
}

/** Why a sheet size cannot be used with a standard, or null. */
export function sheetRefusal(std: StandardId, size: string, orientation?: string): string | null {
  if (std === "uspto") return "37 CFR 1.84(g): a patent drawing sheet must not have a frame around the sight, so it has no sheet format";
  if (std === "journal" || std === "plain") return "this drawing style has no sheet format — choose ISO or ASME for a framed sheet";
  const s = SHEET_SIZES[size as SheetSizeId];
  if (!s) return `"${size}" is not a sheet size`;
  if (!sheetsFor(std).includes(s.id)) return std === "iso" ? `${s.name} is not an ISO 5457 sheet — choose A4 to A0` : `${s.name} is not an ANSI sheet — choose A to E`;
  if (orientation !== undefined && !s.orientations.includes(orientation as Orientation)) {
    return s.family === "iso"
      ? `ISO 5457 permits ${s.designation} ${s.orientations[0]} only`
      : `${s.name} is used ${s.orientations[0]} only`;
  }
  return null;
}

// ---- title block fields ----------------------------------------------------------------------

export type TitleFieldId =
  | "owner" | "title" | "subtitle" | "number" | "rev" | "date" | "sheetNo" | "sheets" | "lang"
  | "creator" | "approver" | "docType" | "status" | "dept" | "techRef"
  | "cage" | "checker" | "creatorDate" | "checkerDate" | "approverDate";

export interface TitleField {
  id: TitleFieldId;
  /** The field's name as the block prints it. */
  label: string;
  /** Characters allowed (ISO 7200's recommended number where it gives one). */
  max: number;
  mandatory: boolean;
}

/** ISO 7200:2004 Tables 1–3 (paper size and page fields are generated, not typed). */
export const ISO_TITLE_FIELDS: TitleField[] = [
  { id: "owner", label: "Legal owner", max: 40, mandatory: true }, // "unspecified" length: 40 is PRODUCT
  { id: "title", label: "Title", max: 25, mandatory: true },
  { id: "subtitle", label: "Supplementary title", max: 50, mandatory: false }, // 2 × 25
  { id: "number", label: "Identification number", max: 16, mandatory: true },
  { id: "rev", label: "Rev.", max: 2, mandatory: false },
  { id: "date", label: "Date of issue", max: 10, mandatory: true },
  { id: "sheetNo", label: "Sheet", max: 4, mandatory: true },
  { id: "sheets", label: "of", max: 4, mandatory: false },
  { id: "lang", label: "Lang.", max: 4, mandatory: false },
  { id: "creator", label: "Created by", max: 20, mandatory: true },
  { id: "approver", label: "Approved by", max: 20, mandatory: true },
  { id: "docType", label: "Document type", max: 30, mandatory: true },
  { id: "status", label: "Document status", max: 20, mandatory: false },
  { id: "dept", label: "Responsible dept.", max: 10, mandatory: false },
  { id: "techRef", label: "Technical reference", max: 20, mandatory: false },
];

/**
 * The ASME title block (fields per DOD-STD-100D App. A). ASME sets no lengths: each maximum is what
 * its cell holds in capitals (PRODUCT), except the 5-character CAGE code.
 */
export const ASME_TITLE_FIELDS: TitleField[] = [
  { id: "owner", label: "Design activity", max: 26, mandatory: false },
  { id: "title", label: "Title", max: 26, mandatory: false },
  { id: "number", label: "Dwg no.", max: 14, mandatory: false },
  { id: "rev", label: "Rev", max: 2, mandatory: false },
  { id: "cage", label: "CAGE code", max: 5, mandatory: false },
  { id: "creator", label: "Drawn", max: 16, mandatory: false },
  { id: "creatorDate", label: "Date", max: 10, mandatory: false },
  { id: "checker", label: "Checked", max: 16, mandatory: false },
  { id: "checkerDate", label: "Date", max: 10, mandatory: false },
  { id: "approver", label: "Approved", max: 16, mandatory: false },
  { id: "approverDate", label: "Date", max: 10, mandatory: false },
  { id: "sheetNo", label: "Sheet", max: 4, mandatory: false },
  { id: "sheets", label: "of", max: 4, mandatory: false },
];

export function titleFieldsFor(std: StandardId): TitleField[] {
  return std === "iso" ? ISO_TITLE_FIELDS : std === "asme" ? ASME_TITLE_FIELDS : [];
}

export type TitleValues = Partial<Record<TitleFieldId, string>>;

/** Over-length or malformed fields (each refused by name) and empty mandatory ones (named, never invented). */
export function checkTitleFields(std: StandardId, values: TitleValues): { problems: string[]; missing: string[] } {
  const problems: string[] = [];
  const missing: string[] = [];
  for (const f of titleFieldsFor(std)) {
    const v = (values[f.id] ?? "").trim();
    if (!v) {
      if (f.mandatory) missing.push(f.label);
      continue;
    }
    // A control character (or a non-character) makes the sheet's SVG unreadable.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/.test(v)) problems.push(`${f.label} contains a control character`);
    if ([...v].length > f.max) problems.push(`${f.label} is ${[...v].length} characters — the field holds ${f.max}`);
    if (f.id === "cage" && !/^[A-Z0-9]{5}$/.test(v)) problems.push("a CAGE code is five letters or digits");
    if ((f.id === "sheetNo" || f.id === "sheets") && !/^[1-9]\d*$/.test(v)) problems.push(`${f.label === "of" ? "Number of sheets" : "Sheet"} must be a whole number from 1`);
    if (f.id === "rev" && std === "iso" && /[IO]/.test(v)) problems.push("ISO 7200: a revision index avoids the letters I and O (they read as 1 and 0)");
  }
  const a = Number(values.sheetNo), b = Number(values.sheets);
  if (values.sheetNo && values.sheets && Number.isFinite(a) && Number.isFinite(b) && a > b) problems.push(`sheet ${a} of ${b} is past the last sheet`);
  return { problems, missing };
}

/**
 * Text no wider than this in Arial / Helvetica at font size `sizeMm` (an em,
 * in mm) — a conservative per-character advance (wide letters at a full em),
 * so a text that passes never overruns its cell in any sans of the stack.
 */
export function textWidthMm(text: string, sizeMm: number): number {
  let em = 0;
  for (const ch of text) em += /[MWmw@%]/.test(ch) ? 1 : /[A-Z&#]/.test(ch) ? 0.78 : /[\x20-\x7e]/.test(ch) ? 0.6 : 1;
  return em * sizeMm;
}

// ---- the frame ------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type FrameLineType = "frame" | "grid" | "centring" | "tbOuter" | "tbInner";
export interface FrameLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: FrameLineType;
}
export interface FrameText {
  x: number;
  y: number;
  text: string;
  /** Font size, mm (an em, not a capital height). */
  sizeMm: number;
  anchor: "start" | "middle" | "end";
  layer: "frame" | "titleBlock";
}
export interface Frame {
  size: SheetSize;
  orientation: Orientation;
  /** The trimmed sheet, mm. */
  W: number;
  H: number;
  frame: Rect;
  titleBlock: Rect;
  /** Where the views, callouts and their titles go. */
  viewArea: Rect;
  /** The bottom-right corner of the room left for the scale and the projection symbol (outside the block). */
  infoAt: { x: number; y: number; w: number; h: number };
  lines: FrameLine[];
  texts: FrameText[];
}

/** ISO 5457 Table 2: fields along the long and the short side. */
export const ISO_FIELDS: Record<"A0" | "A1" | "A2" | "A3" | "A4", [number, number]> = { A0: [24, 16], A1: [16, 12], A2: [12, 8], A3: [8, 6], A4: [6, 4] };
/** Zones (rows × columns) — secondary sources. */
export const ANSI_ZONES: Record<"ANSI-A" | "ANSI-B" | "ANSI-C" | "ANSI-D" | "ANSI-E", [number, number]> = {
  "ANSI-A": [2, 2],
  "ANSI-B": [2, 4],
  "ANSI-C": [4, 4],
  "ANSI-D": [4, 8],
  "ANSI-E": [8, 8],
};
/** Side and top-bottom margins, inches (DOD-STD-100D Fig. A-4; A from secondary sources; the larger taken as the side: PRODUCT). */
export const ANSI_MARGINS_IN: Record<"ANSI-A" | "ANSI-B" | "ANSI-C" | "ANSI-D" | "ANSI-E", [number, number]> = {
  "ANSI-A": [0.38, 0.25],
  "ANSI-B": [0.62, 0.38],
  "ANSI-C": [0.75, 0.5],
  "ANSI-D": [1.0, 0.5],
  "ANSI-E": [1.0, 0.5],
};

/** Field / zone letters: no I, no O (ISO 5457 4.4). */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const GRID_TEXT_MM = 3.5; // ISO 5457 4.4: 3.5 mm characters
const ASME_TEXT_MM = 3.0; // ASME Y14.2 general text minimum
const LABEL_EM = 1.8; // ISO 3098's smallest height, for field names (PRODUCT)
const VALUE_EM = 2.5;
const BIG_EM = 3.5;
/** Text heights here are CAPITAL heights; a font's em is larger (Arial caps ≈ 0.716 em). */
const em = (capMm: number): number => capMm / 0.716;

interface Cell {
  r: Rect;
  label: string;
  /** Field ids printed in the cell (joined), or a fixed value. */
  value: string;
  big?: boolean;
  /** Title + supplementary title (two lines). */
  lines2?: boolean;
  /** Wrapped into up to two lines at the value size (the legal owner, whose length ISO 7200 leaves open). */
  wrap2?: boolean;
}

/** Builds the frame of `size` for `std`, with `values` in its title block. */
export function buildFrame(
  std: "iso" | "asme",
  sizeId: SheetSizeId,
  orientation: Orientation | undefined,
  values: TitleValues,
  scaleText: string | null,
): { ok: true; frame: Frame } | { ok: false; reason: string } {
  const why = sheetRefusal(std, sizeId, orientation);
  if (why) return { ok: false, reason: why };
  const size = SHEET_SIZES[sizeId];
  const o = orientation ?? size.orientations[0];
  const W = o === "landscape" ? size.longMm : size.shortMm;
  const H = o === "landscape" ? size.shortMm : size.longMm;
  const check = checkTitleFields(std, values);
  if (check.problems.length) return { ok: false, reason: check.problems[0] };
  const lines: FrameLine[] = [];
  const texts: FrameText[] = [];
  const L = (x1: number, y1: number, x2: number, y2: number, type: FrameLineType): void => {
    lines.push({ x1, y1, x2, y2, type });
  };
  const rect = (r: Rect, type: FrameLineType): void => {
    L(r.x, r.y, r.x + r.w, r.y, type);
    L(r.x + r.w, r.y, r.x + r.w, r.y + r.h, type);
    L(r.x + r.w, r.y + r.h, r.x, r.y + r.h, type);
    L(r.x, r.y + r.h, r.x, r.y, type);
  };

  let frame: Rect;
  if (std === "iso") {
    // ISO 5457 4.2: 20 mm left (filing margin), 10 mm elsewhere.
    frame = { x: 20, y: 10, w: W - 30, h: H - 20 };
    const g: Rect = { x: 15, y: 5, w: W - 20, h: H - 10 }; // grid reference border, 5 mm outside the frame (PRODUCT)
    rect(frame, "frame");
    rect(g, "grid");
    const [nLong, nShort] = ISO_FIELDS[sizeId as keyof typeof ISO_FIELDS];
    const nX = o === "landscape" ? nLong : nShort, nY = o === "landscape" ? nShort : nLong;
    // The table and the rule (50 mm from the axes) must agree, or nothing is drawn.
    if (nX !== 2 * Math.round(W / 2 / 50) || nY !== 2 * Math.round(H / 2 / 50)) return { ok: false, reason: `the ISO 5457 field table and its 50 mm rule disagree for ${size.designation}` };
    const bounds = (lo: number, hi: number, axis: number, n: number): number[] => {
      const out = [lo];
      for (let k = n / 2 - 1; k >= 1; k--) out.push(axis - 50 * k);
      out.push(axis);
      for (let k = 1; k <= n / 2 - 1; k++) out.push(axis + 50 * k);
      out.push(hi);
      return out;
    };
    const xs = bounds(frame.x, frame.x + frame.w, W / 2, nX);
    const ys = bounds(frame.y, frame.y + frame.h, H / 2, nY);
    const both = sizeId !== "A4"; // A4: references at the top and the right only
    const fs = em(GRID_TEXT_MM);
    for (let i = 1; i < xs.length - 1; i++) {
      L(xs[i], g.y, xs[i], frame.y, "grid");
      L(xs[i], frame.y + frame.h, xs[i], g.y + g.h, "grid");
    }
    for (let i = 1; i < ys.length - 1; i++) {
      L(g.x, ys[i], frame.x, ys[i], "grid");
      L(frame.x + frame.w, ys[i], g.x + g.w, ys[i], "grid");
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      texts.push({ x: cx, y: (g.y + frame.y) / 2 + fs * 0.35, text: String(i + 1), sizeMm: fs, anchor: "middle", layer: "frame" });
      if (both) texts.push({ x: cx, y: (frame.y + frame.h + g.y + g.h) / 2 + fs * 0.35, text: String(i + 1), sizeMm: fs, anchor: "middle", layer: "frame" });
    }
    for (let i = 0; i < ys.length - 1; i++) {
      const cy = (ys[i] + ys[i + 1]) / 2 + fs * 0.35;
      texts.push({ x: (frame.x + frame.w + g.x + g.w) / 2, y: cy, text: LETTERS[i], sizeMm: fs, anchor: "middle", layer: "frame" });
      if (both) texts.push({ x: (g.x + frame.x) / 2, y: cy, text: LETTERS[i], sizeMm: fs, anchor: "middle", layer: "frame" });
    }
    // ISO 5457 4.3: centring marks from the grid reference border to 10 mm past the frame.
    L(W / 2, g.y, W / 2, frame.y + 10, "centring");
    L(W / 2, g.y + g.h, W / 2, frame.y + frame.h - 10, "centring");
    L(g.x, H / 2, frame.x + 10, H / 2, "centring");
    L(g.x + g.w, H / 2, frame.x + frame.w - 10, H / 2, "centring");
    // ISO 5457 3.1: the size designation in the bottom border, at the right corner.
    texts.push({ x: frame.x + frame.w - 1, y: H - 1.2, text: size.designation, sizeMm: em(2.5), anchor: "end", layer: "frame" });
  } else {
    const [side, tb] = ANSI_MARGINS_IN[sizeId as keyof typeof ANSI_MARGINS_IN].map((m) => m * IN);
    frame = { x: side, y: tb, w: W - 2 * side, h: H - 2 * tb };
    rect(frame, "frame");
    const [rows, cols] = ANSI_ZONES[sizeId as keyof typeof ANSI_ZONES];
    const zw = frame.w / cols, zh = frame.h / rows;
    const fs = em(ASME_TEXT_MM);
    // Zone marks run from the border into the margin; A1 is at the lower right.
    for (let c = 1; c < cols; c++) {
      const x = frame.x + c * zw;
      L(x, frame.y, x, frame.y - tb / 2, "grid");
      L(x, frame.y + frame.h, x, frame.y + frame.h + tb / 2, "grid");
    }
    for (let r = 1; r < rows; r++) {
      const y = frame.y + r * zh;
      L(frame.x, y, frame.x - side / 2, y, "grid");
      L(frame.x + frame.w, y, frame.x + frame.w + side / 2, y, "grid");
    }
    for (let c = 0; c < cols; c++) {
      const x = frame.x + frame.w - (c + 0.5) * zw;
      texts.push({ x, y: tb / 2 + fs * 0.35, text: String(c + 1), sizeMm: fs, anchor: "middle", layer: "frame" });
      texts.push({ x, y: H - tb / 2 + fs * 0.35, text: String(c + 1), sizeMm: fs, anchor: "middle", layer: "frame" });
    }
    for (let r = 0; r < rows; r++) {
      const y = frame.y + frame.h - (r + 0.5) * zh + fs * 0.35;
      texts.push({ x: side / 2, y, text: LETTERS[r], sizeMm: fs, anchor: "middle", layer: "frame" });
      texts.push({ x: W - side / 2, y, text: LETTERS[r], sizeMm: fs, anchor: "middle", layer: "frame" });
    }
  }

  // ---- the title block: bottom right inside the frame, 180 mm wide (ISO 7200; ASME PRODUCT) ----
  const tbW = 180;
  const v = (id: TitleFieldId): string => (values[id] ?? "").trim();
  const sheetOf = (): string => (v("sheetNo") ? (v("sheets") ? `${v("sheetNo")} / ${v("sheets")}` : v("sheetNo")) : "");
  const cells: Cell[] = [];
  let tbH: number;
  const x0 = frame.x + frame.w - tbW;
  if (std === "iso") {
    const r = [9, 9, 16, 9];
    tbH = r.reduce((a, b) => a + b, 0);
    const y0 = frame.y + frame.h - tbH;
    const row = (k: number): [number, number] => [y0 + r.slice(0, k).reduce((a, b) => a + b, 0), r[k]];
    const put = (k: number, spec: Array<[number, string, string, boolean?, boolean?, boolean?]>): void => {
      const [y, h] = row(k);
      let x = x0;
      for (const [w, label, value, big, two, wrapped] of spec) {
        cells.push({ r: { x, y, w, h }, label, value, big, lines2: two, wrap2: wrapped });
        x += w;
      }
    };
    // Widths hold each field's ISO 7200 length in capitals (2.72 mm a capital at 2.5 mm; 3.81 at 3.5 mm).
    put(0, [[60, "Created by", v("creator")], [60, "Approved by", v("approver")], [60, "Technical reference", v("techRef")]]);
    put(1, [[90, "Document type", v("docType")], [60, "Document status", v("status")], [15, "Rev.", v("rev")], [15, "Lang.", v("lang")]]);
    put(2, [[80, "Legal owner", v("owner"), false, false, true], [100, "Title", v("title") || v("subtitle") ? `${v("title")}\n${v("subtitle")}` : "", true, true]]);
    put(3, [[65, "Identification number", v("number"), true], [35, "Responsible dept.", v("dept")], [35, "Date of issue", v("date")], [25, "Sheet", sheetOf()], [20, "Paper size", size.designation]]);
  } else {
    const r = [9, 9, 9, 9];
    tbH = 36;
    const y0 = frame.y + frame.h - tbH;
    const at = (k: number): number => y0 + 9 * k;
    const c = (x: number, k: number, w: number, label: string, value: string, big?: boolean): void => {
      cells.push({ r: { x: x0 + x, y: at(k), w, h: r[k] }, label, value, big });
    };
    c(0, 0, 50, "Drawn", v("creator"));
    c(50, 0, 25, "Date", v("creatorDate"));
    c(0, 1, 50, "Checked", v("checker"));
    c(50, 1, 25, "Date", v("checkerDate"));
    c(0, 2, 50, "Approved", v("approver"));
    c(50, 2, 25, "Date", v("approverDate"));
    c(75, 0, 105, "Design activity", v("owner"), true);
    c(75, 1, 105, "Title", v("title"), true);
    c(75, 2, 13, "Size", size.designation);
    c(88, 2, 22, "CAGE code", v("cage"));
    c(110, 2, 58, "Dwg no.", v("number"), true);
    c(168, 2, 12, "Rev", v("rev"));
    c(0, 3, 90, "Scale", scaleText ?? "");
    c(90, 3, 90, "Sheet", sheetOf());
  }
  const titleBlock: Rect = { x: x0, y: frame.y + frame.h - tbH, w: tbW, h: tbH };
  rect(titleBlock, "tbOuter");
  for (const cell of cells) {
    const { x, y, w, h } = cell.r;
    if (x > titleBlock.x + 1e-9) L(x, y, x, y + h, "tbInner");
    if (y > titleBlock.y + 1e-9) L(x, y, x + w, y, "tbInner");
    const pad = 1;
    texts.push({ x: x + pad, y: y + pad + LABEL_EM, text: cell.label, sizeMm: em(LABEL_EM), anchor: "start", layer: "titleBlock" });
    if (!cell.value) continue;
    const vs = em(cell.big ? BIG_EM : VALUE_EM);
    const room = w - 2 * pad;
    if (cell.lines2) {
      // Title on the first line (large), the supplementary title in up to two smaller lines.
      // The title, then the supplementary title — each in its own place, either may be empty.
      const nl = cell.value.indexOf("\n");
      const title = cell.value.slice(0, nl), sub = cell.value.slice(nl + 1);
      const subFs = em(VALUE_EM);
      const subLines = sub ? wrap(sub, room, subFs, 2) : [];
      if (subLines === null) return { ok: false, reason: `Supplementary title does not fit its two lines` };
      if (textWidthMm(title, vs) > room) return { ok: false, reason: `Title does not fit its field` };
      // Baselines from capital heights: the label, 0.6 mm, the title's capitals, then lines 1.4 × their height apart.
      const yTitle = y + pad + LABEL_EM + 0.6 + BIG_EM;
      if (title) texts.push({ x: x + pad, y: yTitle, text: title, sizeMm: vs, anchor: "start", layer: "titleBlock" });
      // The first smaller line clears the title's descenders (0.25 em) by 0.4 mm.
      const ySub = yTitle + 0.25 * vs + 0.4 + VALUE_EM;
      (subLines ?? []).forEach((ln, i) => texts.push({ x: x + pad, y: ySub + i * VALUE_EM * 1.4, text: ln, sizeMm: subFs, anchor: "start", layer: "titleBlock" }));
      continue;
    }
    if (cell.wrap2) {
      const ls = wrap(cell.value, room, vs, 2);
      if (ls === null) return { ok: false, reason: `${cell.label} does not fit its two lines` };
      ls.forEach((ln, i) => texts.push({ x: x + pad, y: y + pad + LABEL_EM + 0.6 + VALUE_EM + i * VALUE_EM * 1.4, text: ln, sizeMm: vs, anchor: "start", layer: "titleBlock" }));
      continue;
    }
    if (textWidthMm(cell.value, vs) > room) return { ok: false, reason: `${cell.label} does not fit its field` };
    // The baseline a descender (0.25 em) above the cell's foot; its capitals clear the label (checked in the tests).
    texts.push({ x: x + pad, y: y + h - 0.25 * vs - 0.4, text: cell.value, sizeMm: vs, anchor: "start", layer: "titleBlock" });
  }

  // A centring mark never runs into the title block (on A4 the block spans the sheet's axis).
  for (const l of lines) {
    if (l.type !== "centring" || l.x1 !== l.x2) continue;
    const bottom = Math.max(l.y1, l.y2) > H / 2;
    if (bottom && l.x1 >= titleBlock.x && l.x1 <= titleBlock.x + titleBlock.w) {
      if (l.y1 > l.y2) l.y2 = frame.y + frame.h;
      else l.y1 = frame.y + frame.h;
    }
  }
  // Room for the scale and the projection symbol, OUTSIDE the block (ISO 7200 4): beside it if the
  // band to its left is wide enough, else a strip above it. Beside it, they sit above the 10 mm
  // the bottom centring mark reaches into the frame.
  // PRODUCT: the views keep 4 mm from the frame and the block — 11 mm on ISO sheets, whose centring
  // marks reach 10 mm into the drawing space.
  const clear = std === "iso" ? 11 : 4;
  let infoAt: Frame["infoAt"];
  let viewArea: Rect;
  const besideW = titleBlock.x - frame.x;
  if (besideW >= 60) {
    infoAt = { x: titleBlock.x - 2, y: frame.y + frame.h - 12, w: besideW - 4, h: tbH - 14 };
    viewArea = { x: frame.x + clear, y: frame.y + clear, w: frame.w - 2 * clear, h: frame.h - tbH - 2 * clear };
  } else {
    const strip = 16;
    infoAt = { x: frame.x + frame.w - 2, y: titleBlock.y - 2, w: tbW - 4, h: strip - 4 };
    viewArea = { x: frame.x + clear, y: frame.y + clear, w: frame.w - 2 * clear, h: frame.h - tbH - strip - 2 * clear };
  }
  return { ok: true, frame: { size, orientation: o, W, H, frame, titleBlock, viewArea, infoAt, lines, texts } };
}

/** Greedy word wrap into at most `maxLines` lines no wider than `room`; null when it does not fit. */
function wrap(text: string, room: number, fs: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidthMm(next, fs) <= room) cur = next;
    else {
      if (!cur) return null; // one word wider than the line
      out.push(cur);
      cur = w;
      if (textWidthMm(cur, fs) > room) return null;
    }
  }
  if (cur) out.push(cur);
  return out.length <= maxLines ? out : null;
}
