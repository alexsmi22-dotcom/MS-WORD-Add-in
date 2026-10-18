// Sketched parts in the drawing document (docs/SCOPE-CAD-R2.md, R2a): they build,
// they round-trip, and a damaged or edited one is refused by name, field by field.
import { Sketch } from "../sketch";
import { parseSketch, sketchBody } from "../sketchDoc";
import { CadDoc, CadPart, docToAssembly, parseDoc, serializeDoc, starterDoc, partProblems } from "../cadShapes";
import { tessellate } from "../cadModel";

const plateSketch = (): Sketch => ({
  points: [
    { id: "p1", x: 0, y: 0 },
    { id: "p2", x: 60, y: 0 },
    { id: "p3", x: 60, y: 40 },
    { id: "p4", x: 0, y: 40 },
    { id: "o", x: 30, y: 20 },
  ],
  entities: [
    { id: "L1", kind: "line", a: "p1", b: "p2" },
    { id: "L2", kind: "line", a: "p2", b: "p3" },
    { id: "L3", kind: "line", a: "p3", b: "p4" },
    { id: "L4", kind: "line", a: "p4", b: "p1" },
    { id: "C", kind: "circle", c: "o", r: 8 },
  ],
  constraints: [
    { id: "h1", kind: "horizontal", line: "L1" },
    { id: "w", kind: "length", line: "L1", value: 60 },
    { id: "d", kind: "diameter", curve: "C", value: 16 },
  ],
});
const sketchPart = (sketch: Sketch = plateSketch(), depth = 6): CadPart => ({
  id: "s1",
  name: "Plate",
  shape: "sketch",
  params: {},
  placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] },
  sketch,
  op: { kind: "extrude", depth },
});
const docWith = (...parts: CadPart[]): CadDoc => ({ ...starterDoc("asme"), parts });

describe("a sketched part builds and round-trips", () => {
  it("extruded: a 60 × 40 × 6 plate with its hole", () => {
    const a = docToAssembly(docWith(sketchPart()));
    if (!a.ok) throw new Error(a.reason);
    expect(a.assembly.bodies[0].spec).toMatchObject({ kind: "extrude", depth: 6 });
    expect((a.assembly.bodies[0].spec as { profile: { holes: unknown[] } }).profile.holes).toHaveLength(1);
    const t = tessellate(a.assembly);
    expect(t.ok).toBe(true);
  });
  it("serialize → parse gives the same document", () => {
    const d = docWith(sketchPart());
    expect(parseDoc(serializeDoc(d))).toEqual({ ok: true, doc: d });
  });
  it("a sketch that cannot make a solid is refused naming the part", () => {
    const open = plateSketch();
    open.entities = open.entities.filter((e) => e.id !== "L4");
    expect(partProblems(sketchPart(open))).toEqual(["the outline is open at (0, 0) — close it, or make the loose line construction"]);
    expect(docToAssembly(docWith(sketchPart(open)))).toEqual({ ok: false, reason: "Plate: the outline is open at (0, 0) — close it, or make the loose line construction" });
    expect(partProblems(sketchPart(plateSketch(), 0))).toEqual(["the extrude depth must be greater than 0"]);
  });
  it("revolved about one of its lines", () => {
    const s = plateSketch();
    s.entities = s.entities.filter((e) => e.kind !== "circle");
    const r = sketchBody(s, { kind: "revolve", axis: "L4" });
    expect(r.ok).toBe(true);
  });
});

describe("damage is refused by name, field by field", () => {
  const withSketch = (mutate: (s: Record<string, unknown>) => void): string => {
    const d = JSON.parse(serializeDoc(docWith(sketchPart())));
    mutate(d.parts[0].sketch);
    return JSON.stringify(d);
  };
  it.each([
    ["a point with no position", (s: Record<string, unknown>) => ((s.points as Array<Record<string, unknown>>)[0].x = "zero")],
    ["a line to a missing point", (s: Record<string, unknown>) => ((s.entities as Array<Record<string, unknown>>)[0].b = "nowhere")],
    ["a relation of an unknown kind", (s: Record<string, unknown>) => (s.constraints as unknown[]).push({ id: "x", kind: "glue", p: "p1" })],
    ["a relation naming a missing line", (s: Record<string, unknown>) => ((s.constraints as Array<Record<string, unknown>>)[0].line = "L9")],
    ["a horizontal relation on a circle", (s: Record<string, unknown>) => ((s.constraints as Array<Record<string, unknown>>)[0].line = "C")],
    ["a dimension with a text value", (s: Record<string, unknown>) => ((s.constraints as Array<Record<string, unknown>>)[1].value = "60")],
    ["a prototype key as a kind", (s: Record<string, unknown>) => (s.constraints as unknown[]).push({ id: "x", kind: "toString" })],
    ["two lines made tangent", (s: Record<string, unknown>) => (s.constraints as unknown[]).push({ id: "x", kind: "tangent", e1: "L1", e2: "L2" })],
    ["a circle with a negative radius", (s: Record<string, unknown>) => ((s.entities as Array<Record<string, unknown>>)[4].r = -8)],
  ])("%s", (_n, mutate) => {
    const r = parseDoc(withSketch(mutate as (s: Record<string, unknown>) => void));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^part Plate: the sketch is damaged \(|^part Plate: /);
  });
  it("a missing or damaged extrude is refused", () => {
    const d = JSON.parse(serializeDoc(docWith(sketchPart())));
    d.parts[0].op = { kind: "extrude", depth: -1 };
    expect(parseDoc(JSON.stringify(d))).toEqual({ ok: false, reason: "part Plate has a damaged extrude or revolve" });
    d.parts[0].op = { kind: "revolve", axis: "C" };
    expect(parseDoc(JSON.stringify(d))).toEqual({ ok: false, reason: "part Plate has a damaged extrude or revolve" });
  });
  it("unknown fields do not ride along", () => {
    const s = JSON.parse(JSON.stringify(plateSketch()));
    s.constraints[0].evil = "x";
    const r = parseSketch(s);
    if (!r.ok) throw new Error(r.reason);
    expect(r.sketch.constraints[0]).toEqual({ id: "h1", kind: "horizontal", line: "L1" });
  });
});
