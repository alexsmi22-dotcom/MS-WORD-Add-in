// The CAD canvas part catalogue and drawing document (docs/SCOPE-CAD-CANVAS.md R1b).
import { SHAPES, SHAPE_IDS, defaultParams, partProblems, docToAssembly, serializeDoc, parseDoc, starterDoc, CadDoc, CadPart, ShapeId } from "../cadShapes";
import { tessellate } from "../cadModel";
import { drawLines, STANDARD_VIEWS } from "../cadLines";
import { layoutSheet } from "../cadSheet";

const part = (shape: ShapeId, params: Record<string, number> = defaultParams(shape)): CadPart => ({
  id: shape,
  name: SHAPES[shape].name,
  shape,
  params,
  placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] },
});
const doc = (...parts: CadPart[]): CadDoc => ({ ...starterDoc("asme"), parts });

/** World bounding box of a tessellated document. */
function bbox(d: CadDoc): { x: number; y: number; z: number } {
  const a = docToAssembly(d);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  const P = t.mesh.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], P[i]);
    hi[i % 3] = Math.max(hi[i % 3], P[i]);
  }
  return { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] };
}

describe("every shape in the catalogue draws from its defaults", () => {
  it.each(SHAPE_IDS)("%s: valid defaults, tessellates, draws visible lines in every standard view", (id) => {
    const p = part(id);
    expect(partProblems(p)).toEqual([]);
    const a = docToAssembly(doc(p));
    expect(a.ok).toBe(true);
    const t = tessellate((a as { ok: true; assembly: never }).assembly);
    expect(t.ok).toBe(true);
    const mesh = (t as { ok: true; mesh: never }).mesh;
    for (const v of ["front", "top", "right", "iso"] as const) {
      const d = drawLines(mesh, STANDARD_VIEWS[v]);
      expect(d.visible.length).toBeGreaterThan(0);
    }
  });
});

describe("dimensions mean what they say", () => {
  it("a block is W × D × H along X, Y, Z", () => {
    expect(bbox(doc(part("box", { w: 40, d: 30, h: 20 })))).toEqual({ x: 40, y: 30, z: 20 });
  });
  it("diameters, not radii: a 20 mm cylinder is 20 mm across", () => {
    const b = bbox(doc(part("cylinder", { dia: 20, h: 5 })));
    expect(b.x).toBeCloseTo(20, 6);
    expect(b.z).toBeCloseTo(5, 6);
  });
  it("the L-bracket STANDS: width along X, base leg along Y, upright along Z (its frame, not the user, does that)", () => {
    const b = bbox(doc(part("bracket", { w: 60, a: 40, b: 30, t: 5 })));
    expect(b.x).toBeCloseTo(60, 6);
    expect(b.y).toBeCloseTo(40, 6);
    expect(b.z).toBeCloseTo(30, 6);
  });
  it("a stepped shaft is as long as its two steps together", () => {
    expect(bbox(doc(part("shaft", { d1: 30, l1: 20, d2: 10, l2: 35 }))).z).toBeCloseTo(55, 6);
  });
});

describe("impossible dimensions are refused by name, never drawn", () => {
  it.each([
    ["tube", { od: 20, id: 25, h: 10 }, "the inside diameter must be smaller than the outside diameter"],
    ["plate", { w: 80, d: 50, t: 8, n: 2, rows: 1, hd: 30, edge: 12 }, "the holes break through the edge: make the hole diameter smaller or move the holes in"],
    ["plate", { w: 80, d: 50, t: 8, n: 9, rows: 1, hd: 8, edge: 12 }, "the holes overlap: fewer holes, smaller holes, or a larger plate"],
    ["flange", { od: 80, id: 30, t: 10, bc: 75, n: 4, hd: 8 }, "the bolt holes break through the outside edge"],
    ["flange", { od: 80, id: 50, t: 10, bc: 55, n: 4, hd: 8 }, "the bolt holes break into the bore"],
    ["bracket", { w: 60, a: 40, b: 30, t: 40 }, "the thickness must be less than both legs"],
    ["shaft", { d1: 10, l1: 20, d2: 12, l2: 35 }, "the small diameter must be smaller than the large one"],
  ] as Array<[ShapeId, Record<string, number>, string]>)("%s %j → %s", (shape, params, reason) => {
    expect(partProblems(part(shape, params))).toEqual([reason]);
    const a = docToAssembly(doc(part(shape, params)));
    expect(a.ok).toBe(false);
  });

  it("a zero, negative, fractional-count or non-number dimension is named", () => {
    expect(partProblems(part("box", { w: 0, d: 30, h: 20 }))).toEqual(["Width (X) must be greater than 0"]);
    expect(partProblems(part("plate", { ...defaultParams("plate"), n: 2.5 }))).toEqual(["Holes per row must be a whole number"]);
    expect(partProblems(part("box", { w: NaN, d: 30, h: 20 }))).toEqual(["Width (X) is not a number"]);
    expect(partProblems(part("box", { w: 1e7, d: 30, h: 20 }))).toEqual(["Width (X) is larger than this canvas draws (1,000,000)"]);
  });

  it("an empty drawing says how to start", () => {
    const a = docToAssembly(doc());
    expect(a).toEqual({ ok: false, reason: "Add a part to start a drawing." });
  });
});

describe("the document round-trips, and damage is refused", () => {
  it("serialize → parse gives the same document, which draws the same sheet", () => {
    const d: CadDoc = { ...doc(part("flange"), part("shaft")), callouts: [{ anchor: [0, 0, 10], label: "10" }] };
    const back = parseDoc(serializeDoc(d));
    expect(back.ok).toBe(true);
    expect((back as { ok: true; doc: CadDoc }).doc).toEqual(d);
    const a = docToAssembly(d);
    const t = a.ok ? tessellate(a.assembly) : null;
    expect(t && t.ok).toBe(true);
    if (t && t.ok) expect(layoutSheet(t.mesh, { standard: d.standard, views: d.views, callouts: d.callouts }).svg).toMatch(/^<svg/);
  });

  it.each([
    ["not JSON", "this is not a drawing this canvas saved (not JSON)"],
    [JSON.stringify({ v: 2, parts: [], callouts: [], views: [], standard: "asme" }), "this drawing was saved by a version this release cannot read"],
    [JSON.stringify({ v: 1, parts: [{ id: "a", name: "A", shape: "gear", params: {}, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }], callouts: [], views: [], standard: "asme" }), "a part in the drawing is damaged"],
    [JSON.stringify({ v: 1, parts: [], callouts: [{ anchor: [0, 0], label: "1" }], views: [], standard: "asme" }), "a callout in the drawing is damaged"],
    [JSON.stringify({ v: 1, parts: [], callouts: [], views: [], standard: "din" }), "the drawing names a standard this release does not have"],
  ])("%s → refused", (text, reason) => {
    expect(parseDoc(text)).toEqual({ ok: false, reason });
  });
});

describe("re-opening a drawing from its alt text (Edit drawing at cursor)", () => {
  it("the model written into the alt text is the model read back", async () => {
    const { modelFromAlt } = await import("../../taskpane/cadPane");
    const d: CadDoc = { ...doc(part("flange")), callouts: [{ anchor: [1, 2, 3], label: "10" }] };
    const alt = `Drawing (Engineering drawing — ASME (third-angle)): FRONT, TOP. Model: ${serializeDoc(d)}`;
    const json = modelFromAlt(alt);
    expect(json).not.toBeNull();
    expect(parseDoc(json as string)).toEqual({ ok: true, doc: d });
    expect(modelFromAlt("A photo of a pump")).toBeNull();
  });
});
