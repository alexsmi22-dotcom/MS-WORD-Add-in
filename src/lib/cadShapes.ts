/**
 * The CAD canvas's part catalogue and drawing document (docs/SCOPE-CAD-CANVAS.md R1b).
 *
 * A PART is a named shape with dimensions, placed in the assembly. Shapes are
 * the ones patent and engineering figures are usually made of — plates,
 * brackets, shafts, flanges, tubes — each defined by the dimensions a drafter
 * would write on it (diameters, not radii). Each builds a cadModel BodySpec, so
 * the line engine never sees anything but profiles and sweeps.
 *
 * The DOCUMENT is everything needed to redraw a figure: parts, callouts, the
 * standard and the views. It is compact JSON with a version, validated on
 * read, refused by name when it cannot be drawn — it travels in the inserted
 * picture's alt text and to and from the large-canvas dialog.
 */
import {
  Assembly,
  BodySpec,
  circleLoop,
  Loop,
  Placement,
  Pt2,
  rectLoop,
  Vec3,
} from "./cadModel";
import type { StandardId } from "./cadStandards";
import type { Callout, ViewSpec } from "./cadSheet";

export interface ParamDef {
  key: string;
  label: string;
  /** The default value (model units, mm by convention). */
  value: number;
  /** Smallest allowed (exclusive when 0: a dimension must be positive). */
  min: number;
  integer?: boolean;
}

export interface ShapeDef {
  id: ShapeId;
  name: string;
  params: ParamDef[];
  /** Why these dimensions cannot make the shape (null = fine). Checked before build. */
  check(p: Record<string, number>): string | null;
  build(p: Record<string, number>): BodySpec;
  /** The shape's own orientation (cadModel Body.frame); omitted = as built. */
  frame?: number[];
}

export type ShapeId = "box" | "cylinder" | "tube" | "cone" | "sphere" | "plate" | "bracket" | "shaft" | "flange";

const holeRow = (n: number, x0: number, x1: number, y: number, r: number): Loop[] => {
  if (n <= 0) return [];
  if (n === 1) return [circleLoop((x0 + x1) / 2, y, r, true)];
  return Array.from({ length: n }, (_, i) => circleLoop(x0 + ((x1 - x0) * i) / (n - 1), y, r, true));
};

export const SHAPES: Record<ShapeId, ShapeDef> = {
  box: {
    id: "box",
    name: "Block",
    params: [
      { key: "w", label: "Width (X)", value: 40, min: 0 },
      { key: "d", label: "Depth (Y)", value: 30, min: 0 },
      { key: "h", label: "Height (Z)", value: 20, min: 0 },
    ],
    check: () => null,
    build: (p) => ({ kind: "extrude", profile: { outer: rectLoop(0, 0, p.w, p.d), holes: [] }, depth: p.h }),
  },
  cylinder: {
    id: "cylinder",
    name: "Cylinder / pin",
    params: [
      { key: "dia", label: "Diameter", value: 20, min: 0 },
      { key: "h", label: "Length (Z)", value: 40, min: 0 },
    ],
    check: () => null,
    build: (p) => ({ kind: "extrude", profile: { outer: circleLoop(0, 0, p.dia / 2), holes: [] }, depth: p.h }),
  },
  tube: {
    id: "tube",
    name: "Tube / bushing",
    params: [
      { key: "od", label: "Outside diameter", value: 30, min: 0 },
      { key: "id", label: "Inside diameter", value: 20, min: 0 },
      { key: "h", label: "Length (Z)", value: 40, min: 0 },
    ],
    check: (p) => (p.id >= p.od ? "the inside diameter must be smaller than the outside diameter" : null),
    build: (p) => ({ kind: "extrude", profile: { outer: circleLoop(0, 0, p.od / 2), holes: [circleLoop(0, 0, p.id / 2, true)] }, depth: p.h }),
  },
  cone: {
    id: "cone",
    name: "Cone / frustum",
    params: [
      { key: "d1", label: "Base diameter", value: 30, min: 0 },
      { key: "d2", label: "Top diameter (0 = point)", value: 0, min: -1 },
      { key: "h", label: "Height (Z)", value: 30, min: 0 },
    ],
    check: (p) => (p.d2 < 0 ? "the top diameter cannot be negative" : null),
    build: (p) => {
      const segs: Loop["segs"] = [{ kind: "line", to: [p.d1 / 2, 0] }];
      if (p.d2 > 0) segs.push({ kind: "line", to: [p.d2 / 2, p.h] }, { kind: "line", to: [0, p.h] });
      else segs.push({ kind: "line", to: [0, p.h] });
      segs.push({ kind: "line", to: [0, 0] });
      return { kind: "revolve", profile: { outer: { start: [0, 0], segs }, holes: [] } };
    },
  },
  sphere: {
    id: "sphere",
    name: "Sphere / ball",
    params: [{ key: "dia", label: "Diameter", value: 30, min: 0 }],
    check: () => null,
    build: (p) => ({
      kind: "revolve",
      profile: {
        outer: { start: [0, -p.dia / 2], segs: [{ kind: "arc", to: [0, p.dia / 2], center: [0, 0] }, { kind: "line", to: [0, -p.dia / 2] }] },
        holes: [],
      },
    }),
  },
  plate: {
    id: "plate",
    name: "Plate with holes",
    params: [
      { key: "w", label: "Width (X)", value: 80, min: 0 },
      { key: "d", label: "Depth (Y)", value: 50, min: 0 },
      { key: "t", label: "Thickness (Z)", value: 8, min: 0 },
      { key: "n", label: "Holes per row", value: 2, min: -1, integer: true },
      { key: "rows", label: "Rows of holes", value: 1, min: -1, integer: true },
      { key: "hd", label: "Hole diameter", value: 8, min: 0 },
      { key: "edge", label: "Hole centre from edge", value: 12, min: 0 },
    ],
    check: (p) => {
      if (p.n < 0 || p.rows < 0) return "the hole counts cannot be negative";
      if (p.n > 0 && p.rows > 0) {
        if (p.hd / 2 >= p.edge) return "the holes break through the edge: make the hole diameter smaller or move the holes in";
        if (2 * p.edge > p.w || 2 * p.edge > p.d) return "the hole centres from the edge do not fit inside the plate";
        const pitchX = p.n > 1 ? (p.w - 2 * p.edge) / (p.n - 1) : Infinity;
        const pitchY = p.rows > 1 ? (p.d - 2 * p.edge) / (p.rows - 1) : Infinity;
        if (Math.min(pitchX, pitchY) <= p.hd) return "the holes overlap: fewer holes, smaller holes, or a larger plate";
      }
      if (p.n * p.rows > 200) return "more than 200 holes — draw a simpler plate";
      return null;
    },
    build: (p) => {
      const holes: Loop[] = [];
      if (p.n > 0 && p.rows > 0) {
        for (let r = 0; r < p.rows; r++) {
          const y = p.rows === 1 ? p.d / 2 : p.edge + ((p.d - 2 * p.edge) * r) / (p.rows - 1);
          holes.push(...holeRow(p.n, p.edge, p.w - p.edge, y, p.hd / 2));
        }
      }
      return { kind: "extrude", profile: { outer: rectLoop(0, 0, p.w, p.d), holes }, depth: p.t };
    },
  },
  bracket: {
    id: "bracket",
    name: "L-bracket",
    params: [
      { key: "w", label: "Width (X)", value: 60, min: 0 },
      { key: "a", label: "Base leg (Y)", value: 40, min: 0 },
      { key: "b", label: "Upright leg (Z)", value: 40, min: 0 },
      { key: "t", label: "Thickness", value: 6, min: 0 },
    ],
    check: (p) => (p.t >= p.a || p.t >= p.b ? "the thickness must be less than both legs" : null),
    // The L section is sketched with the base leg along sketch-x and the upright
    // along sketch-y, and swept the bracket's width along sketch-z. The frame
    // maps sketch x→Y, y→Z, z→X, so the bracket stands on its base leg with its
    // width across the front view, the way it is normally drawn.
    frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
    build: (p) => ({
      kind: "extrude",
      profile: {
        outer: {
          start: [0, 0],
          segs: [
            { kind: "line", to: [p.a, 0] },
            { kind: "line", to: [p.a, p.t] },
            { kind: "line", to: [p.t, p.t] },
            { kind: "line", to: [p.t, p.b] },
            { kind: "line", to: [0, p.b] },
            { kind: "line", to: [0, 0] },
          ],
        },
        holes: [],
      },
      depth: p.w,
    }),
  },
  shaft: {
    id: "shaft",
    name: "Stepped shaft",
    params: [
      { key: "d1", label: "Large diameter", value: 30, min: 0 },
      { key: "l1", label: "Large length", value: 30, min: 0 },
      { key: "d2", label: "Small diameter", value: 18, min: 0 },
      { key: "l2", label: "Small length", value: 50, min: 0 },
    ],
    check: (p) => (p.d2 >= p.d1 ? "the small diameter must be smaller than the large one" : null),
    build: (p) => ({
      kind: "revolve",
      profile: {
        outer: {
          start: [0, 0],
          segs: [
            { kind: "line", to: [p.d1 / 2, 0] },
            { kind: "line", to: [p.d1 / 2, p.l1] },
            { kind: "line", to: [p.d2 / 2, p.l1] },
            { kind: "line", to: [p.d2 / 2, p.l1 + p.l2] },
            { kind: "line", to: [0, p.l1 + p.l2] },
            { kind: "line", to: [0, 0] },
          ],
        },
        holes: [],
      },
    }),
  },
  flange: {
    id: "flange",
    name: "Flange (bolt circle)",
    params: [
      { key: "od", label: "Outside diameter", value: 80, min: 0 },
      { key: "id", label: "Bore diameter", value: 30, min: 0 },
      { key: "t", label: "Thickness (Z)", value: 10, min: 0 },
      { key: "bc", label: "Bolt circle diameter", value: 60, min: 0 },
      { key: "n", label: "Number of bolt holes", value: 4, min: -1, integer: true },
      { key: "hd", label: "Bolt hole diameter", value: 8, min: 0 },
    ],
    check: (p) => {
      if (p.id >= p.od) return "the bore must be smaller than the outside diameter";
      if (p.n < 0) return "the number of bolt holes cannot be negative";
      if (p.n > 0) {
        if (p.bc / 2 + p.hd / 2 >= p.od / 2) return "the bolt holes break through the outside edge";
        if (p.bc / 2 - p.hd / 2 <= p.id / 2) return "the bolt holes break into the bore";
        if (p.n > 1 && 2 * (p.bc / 2) * Math.sin(Math.PI / p.n) <= p.hd) return "the bolt holes overlap on that bolt circle";
        if (p.n > 64) return "more than 64 bolt holes — draw a simpler flange";
      }
      return null;
    },
    build: (p) => {
      const holes: Loop[] = [circleLoop(0, 0, p.id / 2, true)];
      for (let i = 0; i < p.n; i++) {
        const a = (2 * Math.PI * i) / p.n + Math.PI / 2;
        holes.push(circleLoop((p.bc / 2) * Math.cos(a), (p.bc / 2) * Math.sin(a), p.hd / 2, true));
      }
      return { kind: "extrude", profile: { outer: circleLoop(0, 0, p.od / 2), holes }, depth: p.t };
    },
  },
};

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

// ---- the drawing document ------------------------------------------------------------

export interface CadPart {
  id: string;
  name: string;
  shape: ShapeId;
  params: Record<string, number>;
  placement: Placement;
}

export interface CadDoc {
  v: 1;
  parts: CadPart[];
  callouts: Callout[];
  standard: StandardId;
  views: ViewSpec[];
}

export function defaultParams(shape: ShapeId): Record<string, number> {
  return Object.fromEntries(SHAPES[shape].params.map((p) => [p.key, p.value]));
}

/** Every reason a part's dimensions cannot be drawn, in words. */
export function partProblems(part: CadPart): string[] {
  const def = SHAPES[part.shape];
  if (!def) return [`"${part.shape}" is not a shape this release knows`];
  const out: string[] = [];
  for (const pd of def.params) {
    const v = part.params[pd.key];
    if (typeof v !== "number" || !Number.isFinite(v)) out.push(`${pd.label} is not a number`);
    else if (pd.min === 0 ? !(v > 0) : v <= pd.min) out.push(`${pd.label} must be ${pd.min === 0 ? "greater than 0" : `at least ${pd.min + 1}`}`);
    else if (pd.integer && !Number.isInteger(v)) out.push(`${pd.label} must be a whole number`);
    else if (Math.abs(v) > 1e6) out.push(`${pd.label} is larger than this canvas draws (1,000,000)`);
  }
  if (!out.length) {
    const c = def.check(part.params);
    if (c) out.push(c);
  }
  return out;
}

/** The document as a cadModel assembly; refused by part name when a part cannot be built. */
export function docToAssembly(doc: CadDoc): { ok: true; assembly: Assembly } | { ok: false; reason: string } {
  const bad = doc.parts.flatMap((p) => partProblems(p).map((r) => `${p.name}: ${r}`));
  if (bad.length) return { ok: false, reason: bad.join("; ") };
  if (!doc.parts.length) return { ok: false, reason: "Add a part to start a drawing." };
  return {
    ok: true,
    assembly: {
      version: 1,
      bodies: doc.parts.map((p) => ({
        id: p.id,
        name: p.name,
        spec: SHAPES[p.shape].build(p.params),
        placement: p.placement,
        ...(SHAPES[p.shape].frame ? { frame: SHAPES[p.shape].frame } : {}),
      })),
    },
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Compact JSON for the alt text and the dialog. */
export function serializeDoc(doc: CadDoc): string {
  return JSON.stringify(doc);
}

/** Reads a document back, refusing anything malformed by name rather than drawing a guess. */
export function parseDoc(text: string): { ok: true; doc: CadDoc } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "this is not a drawing this canvas saved (not JSON)" };
  }
  const d = raw as Partial<CadDoc>;
  if (!d || typeof d !== "object" || d.v !== 1) return { ok: false, reason: "this drawing was saved by a version this release cannot read" };
  if (!Array.isArray(d.parts) || !Array.isArray(d.callouts) || !Array.isArray(d.views)) return { ok: false, reason: "the drawing is missing its parts, callouts or views" };
  for (const p of d.parts as CadPart[]) {
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !(p.shape in SHAPES)) return { ok: false, reason: "a part in the drawing is damaged" };
    if (!p.placement || !isVec(p.placement.translate) || !isVec(p.placement.rotateDeg)) return { ok: false, reason: `part ${p.name} has a damaged placement` };
    if (!p.params || typeof p.params !== "object") return { ok: false, reason: `part ${p.name} has no dimensions` };
  }
  for (const c of d.callouts as Callout[]) if (!c || !isVec(c.anchor) || typeof c.label !== "string") return { ok: false, reason: "a callout in the drawing is damaged" };
  const stds = ["asme", "iso", "uspto", "journal", "plain"];
  if (!stds.includes(String(d.standard))) return { ok: false, reason: "the drawing names a standard this release does not have" };
  return { ok: true, doc: d as CadDoc };
}

/** A starting document: one plate, the default standard's four views. */
export function starterDoc(standard: StandardId): CadDoc {
  return {
    v: 1,
    parts: [{ id: "p1", name: "Plate", shape: "plate", params: defaultParams("plate"), placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }],
    callouts: [],
    standard,
    views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }],
  };
}

export type { Pt2 };
