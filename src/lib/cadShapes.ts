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
import { parseMarks, SheetMark } from "./cadMarks";
import { DETAIL_FACTORS } from "./cadDetail";
import { PERSPECTIVE_DISTANCES } from "./cadPerspective";
import {
  apply3,
  Assembly,
  BodySpec,
  circleLoop,
  Loop,
  Mesh,
  mul3,
  Placement,
  Pt2,
  rectLoop,
  rotationMatrix,
  Vec3,
} from "./cadModel";
import type { StandardId } from "./cadStandards";
import type { Sketch } from "./sketch";
import { isMeshRef, MeshRef, meshFor } from "./cadMeshStore";
import { SketchOp, sketchBody, parseSketch, parseOp } from "./sketchDoc";
import type { Callout, ViewSpec } from "./cadSheet";
import { Orientation, SHEET_SIZES, SheetSizeId, sheetRefusal, TitleFieldId, TitleValues } from "./cadFormats";

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
  /** A catalogue shape is made from a profile (never an imported mesh). */
  build(p: Record<string, number>): Exclude<BodySpec, { kind: "mesh" }>;
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
  /** A catalogue shape, "sketch": a part made from its own sketch (R2a), or "mesh": an imported STL (R3b). */
  shape: ShapeId | "sketch" | "mesh";
  params: Record<string, number>;
  placement: Placement;
  /** A sketched part's sketch and how it becomes a solid. */
  sketch?: Sketch;
  op?: SketchOp;
  /** An imported part's file (its triangles are held by cadMeshStore, never in the drawing). */
  mesh?: MeshRef;
}

/** What a part is called in the parts list. */
export function shapeName(p: CadPart): string {
  if (p.shape === "mesh") return "Imported STL";
  return p.shape === "sketch" ? (p.op?.kind === "revolve" ? "Sketch, revolved" : "Sketch, extruded") : SHAPES[p.shape].name;
}

/**
 * A callout in the document. One placed on a part carries the part's id and the
 * point in the PART'S own coordinates, so it moves and turns with the part
 * (review D2); `anchor` is where it was when placed.
 */
export interface DocCallout extends Callout {
  part?: string;
  local?: Vec3;
  /** The chord error of the part's facets when the point was picked on them (Mesh.bodySag). */
  sag?: number;
}

export interface CadDoc {
  v: 1;
  parts: CadPart[];
  callouts: DocCallout[];
  standard: StandardId;
  views: ViewSpec[];
  /** Overrides the standard's hidden-line rule on every view; omitted = as the standard says. */
  hidden?: "show" | "hide";
  /** A framed sheet (R2b): size, orientation and the title block's fields; omitted = no frame. */
  sheet?: DocSheet;
  /** Layers switched off (false); omitted = all on. */
  layers?: Partial<Record<"frame" | "titleBlock" | "callouts" | "titles", boolean>>;
  /** Hand-drawn marks on the figures (cadMarks); omitted = none. */
  marks?: SheetMark[];
  /** How far each part is moved apart in the exploded view (part id → [dx, dy, dz]); omitted = not exploded. */
  explode?: Record<string, Vec3>;
}

export interface DocSheet {
  size: SheetSizeId;
  orientation?: Orientation;
  title?: TitleValues;
}

const TITLE_KEYS: TitleFieldId[] = [
  "owner", "title", "subtitle", "number", "rev", "date", "sheetNo", "sheets", "lang", "creator", "approver",
  "docType", "status", "dept", "techRef", "cage", "checker", "creatorDate", "checkerDate", "approverDate",
];
const LAYER_KEYS = ["frame", "titleBlock", "callouts", "titles"] as const;

/** The sheet and layers of a document read back: checked field by field, unknown fields dropped. */
function parseSheetAndLayers(d: Record<string, unknown>): string | null {
  if (d.sheet !== undefined) {
    const s = d.sheet as Record<string, unknown>;
    if (!s || typeof s !== "object" || Array.isArray(s)) return "the drawing's sheet is damaged";
    // Own keys only: "__proto__", "constructor" or "toString" are not sheet sizes (review B1).
    if (typeof s.size !== "string" || !Object.prototype.hasOwnProperty.call(SHEET_SIZES, s.size)) return "the drawing names a sheet size this release does not have";
    if (s.orientation !== undefined && s.orientation !== "landscape" && s.orientation !== "portrait") return "the drawing's sheet orientation is damaged";
    const out: DocSheet = { size: s.size as SheetSizeId, ...(s.orientation ? { orientation: s.orientation as Orientation } : {}) };
    if (s.title !== undefined) {
      const t = s.title as Record<string, unknown>;
      if (!t || typeof t !== "object" || Array.isArray(t)) return "the drawing's title block is damaged";
      const title: TitleValues = {};
      for (const k of TITLE_KEYS) {
        if (t[k] === undefined) continue;
        // Bounded so a damaged picture cannot carry pages of text; the lengths the fields hold are checked when drawn.
        // eslint-disable-next-line no-control-regex
        if (typeof t[k] !== "string" || (t[k] as string).length > 200 || /[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/.test(t[k] as string)) return "the drawing's title block is damaged";
        title[k] = t[k] as string;
      }
      out.title = title;
    }
    // A sheet its standard cannot draw would leave the pane stuck with it (review D9): refused by name.
    const why = sheetRefusal(d.standard as StandardId, out.size, out.orientation);
    if (why) return `the drawing's ${SHEET_SIZES[out.size].designation} sheet does not suit its standard (${why})`;
    d.sheet = out;
  }
  if (d.layers !== undefined) {
    const l = d.layers as Record<string, unknown>;
    if (!l || typeof l !== "object" || Array.isArray(l)) return "the drawing's layers are damaged";
    const out: Partial<Record<(typeof LAYER_KEYS)[number], boolean>> = {};
    for (const k of LAYER_KEYS) {
      if (l[k] === undefined) continue;
      if (typeof l[k] !== "boolean") return "the drawing's layers are damaged";
      out[k] = l[k] as boolean;
    }
    d.layers = out;
  }
  return null;
}

export function defaultParams(shape: ShapeId): Record<string, number> {
  return Object.fromEntries(SHAPES[shape].params.map((p) => [p.key, p.value]));
}

/** Every reason a part's dimensions cannot be drawn, in words. */
export function partProblems(part: CadPart): string[] {
  if (part.shape === "mesh") {
    if (!part.mesh) return ["its file is missing"];
    const r = meshFor(part.mesh);
    return r.ok ? [] : [r.reason];
  }
  if (part.shape === "sketch") {
    if (!part.sketch || !part.op) return ["the sketch is missing"];
    const r = sketchBody(part.sketch, part.op);
    return r.ok ? [] : [r.reason];
  }
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
  if (!doc.parts.length) return { ok: false, reason: "Add a part to start a drawing, or tick Blank figure (under Views on the sheet) to draw freehand." };
  return {
    ok: true,
    assembly: {
      version: 1,
      bodies: doc.parts.map((p) => {
        if (p.shape === "mesh") {
          const r = meshFor(p.mesh!);
          if (!r.ok) throw new Error(r.reason); // partProblems refused it above
          return { id: p.id, name: p.name, spec: { kind: "mesh" as const, mesh: r.mesh }, placement: p.placement };
        }
        if (p.shape === "sketch") {
          const r = sketchBody(p.sketch!, p.op!);
          if (!r.ok) throw new Error(r.reason); // partProblems refused it above
          return { id: p.id, name: p.name, spec: r.spec, placement: p.placement };
        }
        const def = SHAPES[p.shape];
        return { id: p.id, name: p.name, spec: def.build(p.params), placement: p.placement, ...(def.frame ? { frame: def.frame } : {}) };
      }),
    },
  };
}

// ---- callouts that belong to parts ------------------------------------------------------------

/** A catalogue shape's own frame (none for a sketched or imported part). */
export function partFrame(p: CadPart): number[] | undefined {
  return p.shape === "sketch" || p.shape === "mesh" ? undefined : SHAPES[p.shape].frame;
}

/** The part's rotation (its shape's frame, then its turn) and translation: world = R·local + T. */
function partTransform(p: CadPart): { R: number[]; T: Vec3 } {
  const frame = partFrame(p);
  const turn = rotationMatrix(p.placement.rotateDeg);
  return { R: frame ? mul3(turn, frame) : turn, T: p.placement.translate };
}

/**
 * A callout on part `partIndex` at world point `world` (from pickAt on `mesh`, the
 * mesh of this document), stored in the part's coordinates.
 */
export function attachCallout(doc: CadDoc, partIndex: number, world: Vec3, label: string, mesh?: Mesh): DocCallout {
  const p = doc.parts[partIndex];
  if (!p) return { anchor: world, label };
  const { R, T } = partTransform(p);
  const d: Vec3 = [world[0] - T[0], world[1] - T[1], world[2] - T[2]];
  // R is a rotation (orthonormal): its inverse is its transpose.
  const local: Vec3 = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
  const sag = mesh?.bodySag[partIndex];
  return { anchor: world, label, part: p.id, local, ...(sag !== undefined ? { sag } : {}) };
}

function closestOnTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  // Ericson, Real-Time Collision Detection §5.1.5.
  const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const along = (o: Vec3, u: Vec3, t: number): Vec3 => [o[0] + t * u[0], o[1] + t * u[1], o[2] + t * u[2]];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

/**
 * Where each callout is now (world points for the sheet), and why any is not
 * drawn: its part was removed, or the part's dimensions changed so the point is
 * no longer on it — a leader to empty space would be a wrong drawing.
 * `mesh` must be tessellated from this document (body i = part i).
 */
export function resolveCallouts(doc: CadDoc, mesh: Mesh): { callouts: Callout[]; notes: string[] } {
  const out: Callout[] = [];
  const notes: string[] = [];
  const P = mesh.positions, Tr = mesh.triangles;
  const V = (i: number): Vec3 => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  for (const [src, c] of doc.callouts.entries()) {
    if (!c.part || !c.local) {
      out.push({ anchor: c.anchor, label: c.label, src });
      continue;
    }
    const bi = doc.parts.findIndex((p) => p.id === c.part);
    if (bi < 0) {
      notes.push(`Callout ${c.label}'s part was removed, so the callout is not drawn.`);
      continue;
    }
    // The point was on the part's facets when picked, and those were within c.sag of
    // the true surface; today's facets are within bodySag of it. So a point still on
    // the part is within the sum of the two (plus rounding) — and one farther is off it.
    const tol = (c.sag ?? mesh.diag * 1e-3) + (mesh.bodySag[bi] ?? 0) + mesh.diag * 1e-7;
    const { R, T } = partTransform(doc.parts[bi]);
    const w = apply3(R, c.local);
    const at: Vec3 = [w[0] + T[0], w[1] + T[1], w[2] + T[2]];
    let best = Infinity;
    for (let t = 0; t < Tr.length / 3 && best > tol; t++) {
      if (mesh.triBody[t] !== bi) continue;
      const q = closestOnTri(at, V(Tr[3 * t]), V(Tr[3 * t + 1]), V(Tr[3 * t + 2]));
      best = Math.min(best, Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]));
    }
    if (best > tol) {
      notes.push(`Callout ${c.label} no longer touches ${doc.parts[bi].name} (its dimensions changed), so it is not drawn — place it again.`);
      continue;
    }
    out.push({ anchor: at, label: c.label, src });
  }
  return { callouts: out, notes };
}

/** Plain words for parts that pass through each other (cadModel Mesh.overlaps; body i = part i). */
export function overlapNotes(doc: CadDoc, mesh: Mesh): string[] {
  return mesh.overlaps.map(
    ([i, j]) => `${doc.parts[i]?.name ?? "A part"} and ${doc.parts[j]?.name ?? "a part"} overlap: they are drawn as separate parts passing through each other, with the line where their surfaces meet.`,
  );
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);
/** A 3×3 rotation (rows orthonormal, determinant +1): a view, not a shear or a mirror. */
const isRotation = (m: unknown): m is number[] => {
  if (!Array.isArray(m) || m.length !== 9 || !m.every(isNum)) return false;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const d = m[3 * i] * m[3 * j] + m[3 * i + 1] * m[3 * j + 1] + m[3 * i + 2] * m[3 * j + 2];
      if (Math.abs(d - (i === j ? 1 : 0)) > 1e-6) return false;
    }
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return det > 0;
};

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
  const ids = new Set<string>();
  for (const p of d.parts as CadPart[]) {
    if (p && typeof p.id === "string") {
      if (ids.has(p.id)) return { ok: false, reason: "two parts in the drawing share one id" };
      ids.add(p.id);
    }
    const known = p && (p.shape === "sketch" || p.shape === "mesh" || Object.prototype.hasOwnProperty.call(SHAPES, p.shape));
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !known) return { ok: false, reason: "a part in the drawing is damaged" };
    if (!p.placement || !isVec(p.placement.translate) || !isVec(p.placement.rotateDeg)) return { ok: false, reason: `part ${p.name} has a damaged placement` };
    if (!p.params || typeof p.params !== "object") return { ok: false, reason: `part ${p.name} has no dimensions` };
    if (p.shape === "sketch") {
      // Read field by field: a damaged sketch is refused here, never handed to the solver.
      const sk = parseSketch(p.sketch);
      if (!sk.ok) return { ok: false, reason: `part ${p.name}: ${sk.reason}` };
      const op = parseOp(p.op, sk.sketch);
      if (!op) return { ok: false, reason: `part ${p.name} has a damaged extrude or revolve` };
      p.sketch = sk.sketch;
      p.op = op;
    }
    if (p.shape === "mesh") {
      // Read field by field: the reference only (the triangles never travel in a drawing).
      if (!isMeshRef(p.mesh)) return { ok: false, reason: `part ${p.name} has a damaged imported-file record` };
      const m = p.mesh;
      p.mesh = { file: m.file, hash: m.hash, facets: m.facets, mmPerUnit: m.mmPerUnit, creaseDeg: m.creaseDeg, size: [m.size[0], m.size[1], m.size[2]] };
    }
  }
  for (const c of d.callouts as DocCallout[]) {
    if (!c || !isVec(c.anchor) || typeof c.label !== "string") return { ok: false, reason: "a callout in the drawing is damaged" };
    if ((c.part !== undefined || c.local !== undefined) && (typeof c.part !== "string" || !isVec(c.local))) return { ok: false, reason: "a callout in the drawing is damaged" };
    if (c.sag !== undefined && !(isNum(c.sag) && c.sag >= 0)) return { ok: false, reason: "a callout in the drawing is damaged" };
  }
  const kinds = ["front", "top", "right", "left", "back", "bottom", "iso", "orbit", "blank", "exploded", "detail", "section", "perspective"];
  const letters = new Set<string>();
  const sectionLabels = new Set<string>();
  for (const v of d.views as ViewSpec[]) {
    if (!v || typeof v !== "object" || !kinds.includes(String(v.kind))) return { ok: false, reason: "a view in the drawing is damaged" };
    if (v.kind === "orbit" && ((v.rot !== undefined && !isRotation(v.rot)) || (v.deg !== undefined && !isVec(v.deg)))) {
      return { ok: false, reason: "a view in the drawing is damaged" };
    }
    if (v.kind === "detail") {
      const ok =
        typeof v.letter === "string" && /^[A-Z]$/.test(v.letter) && !letters.has(v.letter) &&
        ["front", "top", "right", "left", "back", "bottom", "iso", "exploded"].includes(String(v.of)) &&
        Array.isArray(v.at) && v.at.length === 2 && v.at.every(isNum) && Math.abs(v.at[0]) <= 1e7 && Math.abs(v.at[1]) <= 1e7 &&
        isNum(v.r) && v.r > 0 && v.r <= 1e7 && DETAIL_FACTORS.includes(v.factor);
      if (!ok) return { ok: false, reason: "a detail view in the drawing is damaged" };
      letters.add(v.letter);
    }
    if (v.kind === "section") {
      const pt = (p: unknown): boolean => Array.isArray(p) && p.length === 2 && p.every(isNum) && Math.abs(p[0]) <= 1e7 && Math.abs(p[1]) <= 1e7;
      const ok =
        typeof v.label === "string" && /^[A-Za-z0-9]{1,4}$/.test(v.label) && !sectionLabels.has(v.label) &&
        ["front", "top", "right", "left", "back", "bottom"].includes(String(v.of)) &&
        pt(v.a) && pt(v.b) && (v.flip === undefined || typeof v.flip === "boolean");
      // Named by its label when the label itself can be read.
      if (!ok) return { ok: false, reason: `${typeof v.label === "string" && /^[A-Za-z0-9]{1,4}$/.test(v.label) ? `section view ${v.label}` : "a section view"} in the drawing is damaged` };
      sectionLabels.add(v.label);
    }
    if (v.kind === "perspective" && v.distance !== undefined) {
      const lo = Math.min(...PERSPECTIVE_DISTANCES), hi = Math.max(...PERSPECTIVE_DISTANCES);
      if (!(isNum(v.distance) && v.distance >= lo && v.distance <= hi)) return { ok: false, reason: "the perspective view in the drawing is damaged" };
    }
  }
  if (d.explode !== undefined) {
    const e = d.explode as unknown;
    if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, reason: "the drawing's exploded view is damaged" };
    const out: Record<string, Vec3> = {};
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      // Own keys naming a part only ("__proto__" is not a part).
      if (k === "__proto__" || !ids.has(k)) continue;
      if (!isVec(v) || v.some((x) => Math.abs(x) > 1e7)) return { ok: false, reason: "the drawing's exploded view is damaged" };
      out[k] = [v[0], v[1], v[2]];
    }
    if (Object.keys(out).length) d.explode = out;
    else delete d.explode;
  }
  const stds = ["asme", "iso", "uspto", "journal", "plain"];
  if (!stds.includes(String(d.standard))) return { ok: false, reason: "the drawing names a standard this release does not have" };
  if (d.hidden !== undefined && d.hidden !== "show" && d.hidden !== "hide") return { ok: false, reason: "the drawing's hidden-line setting is damaged" };
  const sheetWhy = parseSheetAndLayers(d);
  if (sheetWhy) return { ok: false, reason: sheetWhy };
  const mk = parseMarks(d.marks);
  if (!mk.ok) return { ok: false, reason: mk.reason };
  if (mk.marks.length) d.marks = mk.marks;
  else delete d.marks;
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

/**
 * The next patent reference numeral for a new callout: `base` (the document's
 * Numerals table suggestion, numerals.suggestNextNumeral) or the first after it,
 * in its parity's steps, not already on this drawing. One rule for the pane and
 * the large canvas.
 */
export function nextFreeNumeral(base: number, taken: number[]): number {
  let n = Number.isInteger(base) && base > 0 ? base : 10;
  const step = n % 2 === 0 ? 2 : 1;
  while (taken.includes(n)) n += step;
  return n;
}
