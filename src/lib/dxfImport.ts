/**
 * Importing a DXF into the Drawing (CAD) pane (docs/SCOPE-CAD-IMPORT.md, R3a): the
 * decisions the pane's Import button needs, kept here where they can be tested.
 *
 *   - openDxfFile: a picked file → the drawing, or a refusal that names the file
 *     and the route (native Solid Edge, DWG, binary DXF, too large, not yet STEP; an STL is a part).
 *   - importedFigure: the drawing as a picture for Word — true size, fitted to the
 *     page when larger, with the sentence that says so. Not re-editable, and its alt
 *     text says so (the Edit button names it, rather than "not made by this tool").
 *   - importedSketch: lines, arcs and circles as a sketch moved to the origin, with
 *     the ends that meet nothing counted and the largest gap named, before Done
 *     refuses an open outline.
 */
import { DXF_LIMITS, DxfDrawing, decodeDxf, importRefusal, readDxf } from "./dxf";
import { dxfFigure, dxfSketch } from "./dxfOut";
import type { Sketch } from "./sketch";

/** The units a user can give a drawing whose file does not say ($INSUNITS 0 or absent). */
export const IMPORT_UNITS: ReadonlyArray<{ id: string; name: string; mm: number }> = [
  { id: "mm", name: "millimetres", mm: 1 },
  { id: "cm", name: "centimetres", mm: 10 },
  { id: "m", name: "metres", mm: 1000 },
  { id: "in", name: "inches", mm: 25.4 },
  { id: "ft", name: "feet", mm: 304.8 },
];

/** The first words of an imported picture's alt text (Edit recognises it by these). */
export const IMPORTED_ALT_PREFIX = "Imported DXF drawing: ";

/** The sketch's range (sketchDoc MAX_SIZE): every coordinate within ±1 000 000 mm. */
const SKETCH_RANGE_MM = 1e6;

const fmt = (v: number): string => String(+v.toFixed(2));
const mb = (n: number): string => String(+(n / (1024 * 1024)).toFixed(1));

/** A file past the size cap, refused by its size before it is read (or null). */
export function sizeRefusal(fileName: string, size: number): string | null {
  // Rounded up, so a file just over the limit never reads "30 MB … up to 30 MB".
  const up = Math.ceil((size / (1024 * 1024)) * 10) / 10;
  return size > DXF_LIMITS.bytes ? `${fileName}: the file is ${up} MB — this importer reads DXF files up to ${mb(DXF_LIMITS.bytes)} MB` : null;
}

export type OpenResult = { ok: true; drawing: DxfDrawing } | { ok: false; reason: string };

/** A picked file → the drawing, or why not, naming the file. */
export function openDxfFile(fileName: string, bytes: Uint8Array): OpenResult {
  const no = (why: string): OpenResult => ({ ok: false, reason: `${fileName}: ${why}` });
  const native = importRefusal(fileName, bytes.subarray(0, 32));
  if (native) return no(native);
  const ext = (/\.([a-z0-9_]+)$/i.exec(fileName)?.[1] ?? "").toLowerCase();
  if (ext === "stl") return no("an STL is a 3D part — it is added to the model as a part, not opened as a drawing");
  if (["stp", "step", "igs", "iges"].includes(ext))
    return no(`${ext.toUpperCase()} parts are not imported yet — save the part as STL (in Solid Edge, Save As → STL) and import that, or save a draft as DXF`);
  if (ext !== "dxf") return no("this is not a DXF file — choose a .dxf (in Solid Edge or AutoCAD, Save As → DXF)");
  const big = sizeRefusal(fileName, bytes.length);
  if (big) return { ok: false, reason: big };
  let text: string;
  try {
    text = decodeDxf(bytes);
  } catch {
    return no("the file's text could not be read");
  }
  const r = readDxf(text);
  return r.ok ? r : no(r.reason);
}

export interface ImportedFigure {
  svg: string;
  /** The size to insert at (fitted), in CSS px. */
  widthPx: number;
  heightPx: number;
  /** The drawing's true size, mm. */
  widthMm: number;
  heightMm: number;
  /** The fitting factor: 1 = true size. */
  k: number;
  alt: string;
  /** What the status says about the size. */
  note: string;
}

/** The drawing as a picture for Word, fitted to `fitMm` when it is larger (never enlarged). */
export function importedFigure(d: DxfDrawing, mmPerUnit: number, fileName: string, fitMm: { w: number; h: number }): ImportedFigure | string {
  const f = dxfFigure(d, mmPerUnit);
  if (typeof f === "string") return f;
  const k = Math.min(1, fitMm.w / f.widthMm, fitMm.h / f.heightMm);
  const size = `${fmt(f.widthMm)} × ${fmt(f.heightMm)} mm`;
  const note =
    k >= 1
      ? `It is inserted at its true size (${size}).`
      : `It is inserted at ${Math.max(1, Math.round(k * 100))} % to fit the page; at true size it is ${size}.`;
  return {
    svg: f.svg,
    widthPx: f.widthPx * k,
    heightPx: f.heightPx * k,
    widthMm: f.widthMm,
    heightMm: f.heightMm,
    k,
    alt: `${IMPORTED_ALT_PREFIX}${fileName} (${size} at true size). A picture of the file: import the file again to change it.`,
    note,
  };
}

/** A sketch from the drawing: moved so its lower-left corner is the origin; open ends counted. */
export function importedSketch(d: DxfDrawing, mmPerUnit: number): { ok: true; sketch: Sketch; notes: string[] } | { ok: false; reason: string } {
  if (d.bounds && mmPerUnit > 0) {
    const span = Math.max(d.bounds.maxX - d.bounds.minX, d.bounds.maxY - d.bounds.minY) * mmPerUnit;
    if (!(span <= SKETCH_RANGE_MM))
      return { ok: false, reason: `at ${fmt(mmPerUnit)} mm per unit the drawing is ${fmt(span / 1000)} m across — a sketch is drawn within ±1 000 000 mm; check its units` };
  }
  const r = dxfSketch(d, mmPerUnit);
  if (!r.ok) return r;
  // The outline's own lower-left corner (circles by their extent; text is not part of it).
  let dx = Infinity, dy = Infinity;
  for (const p of r.sketch.points) {
    dx = Math.min(dx, p.x);
    dy = Math.min(dy, p.y);
  }
  for (const e of r.sketch.entities) {
    if (e.kind !== "circle") continue;
    const c = r.sketch.points.find((p) => p.id === e.c)!;
    dx = Math.min(dx, c.x - e.r);
    dy = Math.min(dy, c.y - e.r);
  }
  const sketch: Sketch = { ...r.sketch, points: r.sketch.points.map((p) => ({ ...p, x: p.x - dx, y: p.y - dy })) };
  const notes = [...r.notes];
  const open = openEnds(sketch);
  if (open.count)
    notes.push(
      `${open.count} end${open.count === 1 ? " meets" : "s meet"} no other line or arc (largest gap ${fmt(open.gap)} mm) — the outline must be closed before Done can make a solid.`,
    );
  return { ok: true, sketch, notes };
}

/** Ends used by one line or arc only, and the largest distance from one to its nearest fellow. */
function openEnds(sk: Sketch): { count: number; gap: number } {
  const uses = new Map<string, number>();
  for (const e of sk.entities) {
    if (e.construction || e.kind === "circle") continue;
    for (const id of [e.a, e.b]) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const ends = sk.points.filter((p) => uses.get(p.id) === 1);
  let gap = 0;
  for (const p of ends) {
    let near = Infinity;
    for (const q of ends) if (q !== p) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
    if (Number.isFinite(near)) gap = Math.max(gap, near);
  }
  return { count: ends.length, gap };
}
