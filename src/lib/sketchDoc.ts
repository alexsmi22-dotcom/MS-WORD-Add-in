/**
 * A sketched part in the drawing document (docs/SCOPE-CAD-R2.md, R2a): its
 * sketch, how it becomes a solid (extrude a depth, or revolve about one of its
 * lines), and reading both back from saved JSON — field by field, so a damaged
 * or edited drawing is refused by name instead of crashing the solver.
 */
import type { BodySpec } from "./cadModel";
import { Sketch, SConstraint, SEntity, SPoint, sketchProblems, MAX_POINTS } from "./sketch";
import { sketchToProfile, sketchToRevolve } from "./sketchProfile";

export type SketchOp = { kind: "extrude"; depth: number } | { kind: "revolve"; axis: string };

/** Most a dimension or depth may be (as the catalogue's dimensions). */
const MAX_SIZE = 1e6;

/** The body a sketched part makes, or why it cannot. */
export function sketchBody(sketch: Sketch, op: SketchOp): { ok: true; spec: BodySpec } | { ok: false; reason: string } {
  const bad = sketchProblems(sketch);
  if (bad.length) return { ok: false, reason: bad[0] };
  if (op.kind === "extrude") {
    if (!(Number.isFinite(op.depth) && op.depth > 0)) return { ok: false, reason: "the extrude depth must be greater than 0" };
    if (op.depth > MAX_SIZE) return { ok: false, reason: "the extrude depth is larger than this canvas draws (1,000,000)" };
    const r = sketchToProfile(sketch);
    return r.ok ? { ok: true, spec: { kind: "extrude", profile: r.profile, depth: op.depth } } : r;
  }
  const r = sketchToRevolve(sketch, op.axis);
  return r.ok ? { ok: true, spec: { kind: "revolve", profile: r.profile } } : r;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isSide = (v: unknown): v is 1 | -1 => v === 1 || v === -1;
const optBool = (v: unknown): boolean => v === undefined || typeof v === "boolean";

/** Each constraint kind and the fields it must carry (beyond id and kind). */
const SHAPES: Record<SConstraint["kind"], Record<string, (v: unknown) => boolean>> = {
  coincident: { p: isStr, q: isStr },
  horizontal: { line: isStr },
  vertical: { line: isStr },
  parallel: { l1: isStr, l2: isStr },
  perpendicular: { l1: isStr, l2: isStr },
  tangent: { e1: isStr, e2: isStr, side: (v) => v === undefined || isSide(v), inner: optBool },
  equal: { e1: isStr, e2: isStr },
  concentric: { e1: isStr, e2: isStr },
  onLine: { p: isStr, line: isStr },
  onCircle: { p: isStr, curve: isStr },
  midpoint: { p: isStr, line: isStr },
  symmetric: { p: isStr, q: isStr, line: isStr },
  fix: { p: isStr, x: isNum, y: isNum },
  distance: { p: isStr, q: isStr, value: isNum, driven: optBool },
  pointLine: { p: isStr, line: isStr, value: isNum, side: isSide, driven: optBool },
  hdist: { p: isStr, q: isStr, value: isNum, side: isSide, driven: optBool },
  vdist: { p: isStr, q: isStr, value: isNum, side: isSide, driven: optBool },
  length: { line: isStr, value: isNum, driven: optBool },
  angle: { l1: isStr, l2: isStr, value: isNum, sign: isSide, driven: optBool },
  radius: { curve: isStr, value: isNum, driven: optBool },
  diameter: { curve: isStr, value: isNum, driven: optBool },
};

/** Which entity kinds each reference field of a constraint must name. */
function refKinds(c: SConstraint): Array<[string, "point" | "line" | "curve" | "any"]> {
  switch (c.kind) {
    case "coincident": return [[c.p, "point"], [c.q, "point"]];
    case "fix": return [[c.p, "point"]];
    case "horizontal": case "vertical": case "length": return [[c.line, "line"]];
    case "parallel": case "perpendicular": case "angle": return [[c.l1, "line"], [c.l2, "line"]];
    case "tangent": case "equal": return [[c.e1, "any"], [c.e2, "any"]];
    case "concentric": return [[c.e1, "curve"], [c.e2, "curve"]];
    case "onLine": case "midpoint": case "pointLine": return [[c.p, "point"], [c.line, "line"]];
    case "onCircle": return [[c.p, "point"], [c.curve, "curve"]];
    case "symmetric": return [[c.p, "point"], [c.q, "point"], [c.line, "line"]];
    case "distance": case "hdist": case "vdist": return [[c.p, "point"], [c.q, "point"]];
    case "radius": case "diameter": return [[c.curve, "curve"]];
  }
}

/** A sketch read back from JSON, or the reason it is damaged. */
export function parseSketch(raw: unknown): { ok: true; sketch: Sketch } | { ok: false; reason: string } {
  const damaged = (what: string) => ({ ok: false as const, reason: `the sketch is damaged (${what})` });
  if (!raw || typeof raw !== "object") return damaged("not a sketch");
  const s = raw as { points?: unknown; entities?: unknown; constraints?: unknown };
  if (!Array.isArray(s.points) || !Array.isArray(s.entities) || !Array.isArray(s.constraints)) return damaged("missing points, lines or relations");
  if (s.points.length > MAX_POINTS) return { ok: false, reason: `the sketch has more than ${MAX_POINTS} points` };
  if (s.entities.length > 4 * MAX_POINTS || s.constraints.length > 8 * MAX_POINTS) return damaged("too many items");
  const points: SPoint[] = [];
  for (const p of s.points as Array<Record<string, unknown>>) {
    if (!p || !isStr(p.id) || !isNum(p.x) || !isNum(p.y) || Math.abs(p.x) > MAX_SIZE || Math.abs(p.y) > MAX_SIZE) return damaged("a point");
    points.push({ id: p.id, x: p.x, y: p.y });
  }
  const pointIds = new Set(points.map((p) => p.id));
  const entities: SEntity[] = [];
  for (const e of s.entities as Array<Record<string, unknown>>) {
    if (!e || !isStr(e.id) || !optBool(e.construction)) return damaged("a line or curve");
    const construction = e.construction === true ? { construction: true } : {};
    if (e.kind === "line" && isStr(e.a) && isStr(e.b) && pointIds.has(e.a) && pointIds.has(e.b)) entities.push({ id: e.id, kind: "line", a: e.a, b: e.b, ...construction });
    else if (e.kind === "circle" && isStr(e.c) && pointIds.has(e.c) && isNum(e.r) && e.r > 0 && e.r <= MAX_SIZE) entities.push({ id: e.id, kind: "circle", c: e.c, r: e.r, ...construction });
    else if (e.kind === "arc" && isStr(e.c) && isStr(e.a) && isStr(e.b) && [e.c, e.a, e.b].every((id) => pointIds.has(id as string)))
      entities.push({ id: e.id, kind: "arc", c: e.c, a: e.a, b: e.b, ...construction });
    else return damaged(`${String(e.id)}`);
  }
  const ents = new Map(entities.map((e) => [e.id, e]));
  const constraints: SConstraint[] = [];
  for (const c of s.constraints as Array<Record<string, unknown>>) {
    if (!c || !isStr(c.id) || typeof c.kind !== "string" || !Object.prototype.hasOwnProperty.call(SHAPES, c.kind)) return damaged("a relation");
    const fields = SHAPES[c.kind as SConstraint["kind"]];
    for (const [k, ok] of Object.entries(fields)) if (!ok(c[k])) return damaged(`relation ${c.id}`);
    // Keep only the known fields: nothing else rides along.
    const clean: Record<string, unknown> = { id: c.id, kind: c.kind };
    for (const k of Object.keys(fields)) if (c[k] !== undefined) clean[k] = c[k];
    const con = clean as unknown as SConstraint;
    for (const [id, want] of refKinds(con)) {
      if (want === "point") {
        if (!pointIds.has(id)) return damaged(`relation ${c.id} names a missing point`);
        continue;
      }
      const e = ents.get(id);
      if (!e) return damaged(`relation ${c.id} names a missing line or curve`);
      if (want === "line" && e.kind !== "line") return damaged(`relation ${c.id} needs a line`);
      if (want === "curve" && e.kind === "line") return damaged(`relation ${c.id} needs a circle or arc`);
    }
    if (con.kind === "tangent" || con.kind === "equal") {
      const k1 = ents.get(con.e1)!.kind === "line", k2 = ents.get(con.e2)!.kind === "line";
      if (con.kind === "equal" && k1 !== k2) return damaged(`relation ${c.id} compares a line with a curve`);
      if (con.kind === "tangent" && k1 && k2) return damaged(`relation ${c.id} makes two lines tangent`);
    }
    constraints.push(con);
  }
  const sketch: Sketch = { points, entities, constraints };
  const bad = sketchProblems(sketch);
  if (bad.length) return { ok: false, reason: bad[0] };
  return { ok: true, sketch };
}

/** A sketch operation read back from JSON. */
export function parseOp(raw: unknown, sketch: Sketch): SketchOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "extrude" && isNum(o.depth) && o.depth > 0 && o.depth <= MAX_SIZE) return { kind: "extrude", depth: o.depth };
  if (o.kind === "revolve" && isStr(o.axis) && sketch.entities.some((e) => e.id === o.axis && e.kind === "line")) return { kind: "revolve", axis: o.axis };
  return null;
}
