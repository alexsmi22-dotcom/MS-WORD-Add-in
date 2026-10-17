// The CAD canvas part catalogue and drawing document (docs/SCOPE-CAD-CANVAS.md R1b).
import { SHAPES, SHAPE_IDS, defaultParams, partProblems, docToAssembly, serializeDoc, parseDoc, starterDoc, CadDoc, CadPart, ShapeId, attachCallout, resolveCallouts, overlapNotes } from "../cadShapes";
import { tessellate, Mesh, flattenLoop, signedArea, DEFAULT_TESS, ARC_REL_PER_RELTOL } from "../cadModel";
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
    // Review D7: a shape name that is a key of every object is not a shape.
    ...["toString", "__proto__", "constructor", "hasOwnProperty"].map((shape) => [
      JSON.stringify({ v: 1, parts: [{ id: "a", name: "A", shape, params: {}, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }], callouts: [], views: [], standard: "asme" }),
      "a part in the drawing is damaged",
    ]),
    [JSON.stringify({ v: 1, parts: [], callouts: [], views: [{ kind: "sideways" }], standard: "asme" }), "a view in the drawing is damaged"],
    [JSON.stringify({ v: 1, parts: [], callouts: [], views: [{ kind: "orbit", rot: [1, 0, 0] }], standard: "asme" }), "a view in the drawing is damaged"],
    [JSON.stringify({ v: 1, parts: [], callouts: [{ anchor: [0, 0, 0], label: "1", part: "p1" }], views: [], standard: "asme" }), "a callout in the drawing is damaged"],
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

describe("callouts belong to their part (review D2)", () => {
  const meshOfDoc = (d: CadDoc): Mesh => {
    const a = docToAssembly(d);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    return t.mesh;
  };
  const blockDoc = (): CadDoc => ({ ...starterDoc("asme"), parts: [{ ...part("box", { w: 40, d: 30, h: 20 }), id: "blk", name: "Block" }] });

  it("moves and turns with the part", () => {
    const d = blockDoc();
    d.callouts = [attachCallout(d, 0, [40, 15, 10], "12")]; // centre of the +X face
    d.parts[0].placement = { translate: [100, 0, 0], rotateDeg: [0, 0, 90] };
    const r = resolveCallouts(d, meshOfDoc(d));
    expect(r.notes).toEqual([]);
    // Turned 90° about Z then moved: local (40, 15, 10) → (−15, 40, 10) + (100, 0, 0).
    expect(r.callouts).toHaveLength(1);
    r.callouts[0].anchor.forEach((v, i) => expect(v).toBeCloseTo([85, 40, 10][i], 9));
  });

  it("a shape with its own frame (the bracket) keeps the point on the part", () => {
    const d: CadDoc = { ...starterDoc("asme"), parts: [{ ...part("bracket"), id: "br", name: "Bracket" }] };
    const m = meshOfDoc(d);
    // Any vertex of the bracket is on it.
    const p: [number, number, number] = [m.positions[0], m.positions[1], m.positions[2]];
    d.callouts = [attachCallout(d, 0, p, "3")];
    d.parts[0].placement = { translate: [5, 6, 7], rotateDeg: [30, 0, 0] };
    expect(resolveCallouts(d, meshOfDoc(d)).notes).toEqual([]);
  });

  it("is dropped, with a note, when its part is removed", () => {
    const d = blockDoc();
    d.callouts = [attachCallout(d, 0, [40, 15, 10], "12")];
    d.parts.push({ ...part("cylinder"), id: "cyl", name: "Pin", placement: { translate: [100, 0, 0], rotateDeg: [0, 0, 0] } });
    d.parts.shift();
    const r = resolveCallouts(d, meshOfDoc(d));
    expect(r.callouts).toEqual([]);
    expect(r.notes).toEqual(["Callout 12's part was removed, so the callout is not drawn."]);
  });

  it("is dropped, with a note, when the part is resized away from its point — and kept when the point is still on it", () => {
    const d = blockDoc();
    d.callouts = [attachCallout(d, 0, [40, 15, 10], "12"), attachCallout(d, 0, [20, 15, 0], "14")]; // +X face; bottom face
    d.parts[0].params = { w: 30, d: 30, h: 25 }; // narrower: the +X face moved in; the bottom face is still at z = 0
    const r = resolveCallouts(d, meshOfDoc(d));
    expect(r.callouts.map((c) => c.label)).toEqual(["14"]);
    expect(r.notes).toEqual(["Callout 12 no longer touches Block (its dimensions changed), so it is not drawn — place it again."]);
  });

  it("round-trips through the alt text with its part", () => {
    const d = blockDoc();
    d.callouts = [attachCallout(d, 0, [40, 15, 10], "12")];
    expect(parseDoc(serializeDoc(d))).toEqual({ ok: true, doc: d });
  });
});

describe("overlapping parts are named (review B3)", () => {
  it("says which parts pass through each other, and how they are drawn", () => {
    const d: CadDoc = {
      ...starterDoc("asme"),
      parts: [
        { ...part("box", { w: 40, d: 40, h: 10 }), id: "a", name: "Base" },
        { ...part("cylinder", { dia: 10, h: 30 }), id: "b", name: "Pin", placement: { translate: [20, 20, -10], rotateDeg: [0, 0, 0] } },
      ],
    };
    const a = docToAssembly(d);
    const t = a.ok ? tessellate(a.assembly) : null;
    if (!t || !t.ok) throw new Error("no mesh");
    expect(overlapNotes(d, t.mesh)).toEqual(["Base and Pin overlap: they are drawn as separate parts passing through each other, with the line where their surfaces meet."]);
  });
});

describe("the cap triangulation covers exactly the outline minus its holes (review D6)", () => {
  it.each([
    [2, 1, 8, 80, 50],
    [20, 10, 20, 1000, 600],
    [7, 3, 9, 120, 60],
  ])("plate with %i × %i holes of Ø%i on %i × %i: top-cap area exact, every triangle wound outward, inside a freeze budget", (n, rows, hd, w, d) => {
    const p = part("plate", { ...defaultParams("plate"), w, d, t: 8, n, rows, hd, edge: Math.max(12, hd) });
    expect(partProblems(p)).toEqual([]);
    const a = docToAssembly(doc(p));
    if (!a.ok) throw new Error(a.reason);
    const t0 = Date.now();
    const t = tessellate(a.assembly);
    expect(Date.now() - t0).toBeLessThan(5000);
    if (!t.ok) throw new Error(t.reason);
    const { positions: P, triangles: T, cornerNormals: N } = t.mesh;
    let area = 0;
    for (let k = 0; k < T.length / 3; k++) {
      if (N[9 * k + 2] !== 1) continue; // top cap triangles only
      const [i, j, l] = [T[3 * k], T[3 * k + 1], T[3 * k + 2]];
      const s = ((P[3 * j] - P[3 * i]) * (P[3 * l + 1] - P[3 * i + 1]) - (P[3 * l] - P[3 * i]) * (P[3 * j + 1] - P[3 * i + 1])) / 2;
      expect(s).toBeGreaterThan(-1e-9); // counter-clockwise seen from above: wound outward
      area += s;
    }
    // Exactly the plate minus the holes AS FLATTENED (the same loops, the same tolerance).
    const spec = SHAPES.plate.build(p.params);
    expect(spec.profile.holes).toHaveLength(n * rows);
    const tol = t.mesh.diag * DEFAULT_TESS.relTol;
    const holeArea = spec.profile.holes.reduce((sum, h) => sum - signedArea(flattenLoop(h, tol, DEFAULT_TESS.relTol * ARC_REL_PER_RELTOL).points), 0);
    expect(area).toBeCloseTo(w * d - holeArea, 6);
  });
});

describe("the catalogue cone, as the user adds it (review B1)", () => {
  it("defaults (pointed): the front view is the closed triangle, both outlines reaching the apex", () => {
    const p = part("cone");
    expect(p.params.d2).toBe(0);
    const a = docToAssembly(doc(p));
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    const d = drawLines(t.mesh, STANDARD_VIEWS.front);
    const pts = d.visible.flat();
    const { d1, h: hh } = p.params;
    expect(Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]))).toBeCloseTo(hh, 4);
    const len = d.visible.reduce((s, l) => s + l.slice(1).reduce((u, q, i) => u + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0), 0);
    expect(len).toBeCloseTo(d1 + 2 * Math.hypot(d1 / 2, hh), 1); // within faceting; a missing outline is ~36 short
  });
});

describe("parts that only touch are not called overlapping", () => {
  it("TEST-SCRIPT §0ck Assemble: the default flange set on the starter plate (Move Z 8, X 40)", () => {
    const d = starterDoc("asme");
    d.parts.push({ ...part("flange"), id: "f", name: "Flange", placement: { translate: [40, 0, 8], rotateDeg: [0, 0, 0] } });
    const a = docToAssembly(d);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    expect(overlapNotes(d, t.mesh)).toEqual([]);
    expect(t.mesh.crossings).toEqual([]);
  });
});

describe("a callout's on-the-part test uses the facets' real error (second review)", () => {
  const meshFor = (d: CadDoc): Mesh => {
    const a = docToAssembly(d);
    if (!a.ok) throw new Error(a.reason);
    const t = tessellate(a.assembly);
    if (!t.ok) throw new Error(t.reason);
    return t.mesh;
  };
  /** The centroid of the first wall facet of body `bi` (the farthest a facet point sits from the true surface). */
  const facetCentroid = (m: Mesh, bi: number): [number, number, number] => {
    for (let t = 0; t < m.triangles.length / 3; t++) {
      if (m.triBody[t] !== bi || Math.abs(m.cornerNormals[9 * t + 2]) > 1e-9) continue; // a wall: horizontal normal
      const c = [0, 1, 2].map((k) => (m.positions[3 * m.triangles[3 * t] + k] + m.positions[3 * m.triangles[3 * t + 1] + k] + m.positions[3 * m.triangles[3 * t + 2] + k]) / 3);
      return c as [number, number, number];
    }
    throw new Error("no wall facet");
  };
  const assembly = (): CadDoc => ({
    ...starterDoc("asme"),
    parts: [
      { ...part("box", { w: 2000, d: 1000, h: 50 }), id: "big", name: "Big" },
      { ...part("cylinder", { dia: 20, h: 20 }), id: "pin", name: "Pin", placement: { translate: [3000, 0, 0], rotateDeg: [0, 0, 0] } },
    ],
  });

  it("removing an unrelated part (the pin re-faceted finer) keeps the pin's callout", () => {
    const d = assembly();
    d.callouts = [attachCallout(d, 1, facetCentroid(meshFor(d), 1), "5", meshFor(d))];
    d.parts.shift();
    const r = resolveCallouts(d, meshFor(d));
    expect(r.notes).toEqual([]);
    expect(r.callouts).toHaveLength(1);
  });

  it("in a large assembly, a 2 mm pin halved drops its callout (the old 0.1 %-of-model tolerance, 2.2 mm, kept it)", () => {
    const d = assembly();
    d.parts[1].params = { dia: 2, h: 20 };
    d.callouts = [attachCallout(d, 1, facetCentroid(meshFor(d), 1), "5", meshFor(d))];
    expect(resolveCallouts(d, meshFor(d)).callouts).toHaveLength(1); // on it before the change
    d.parts[1].params = { dia: 1, h: 20 };
    const r = resolveCallouts(d, meshFor(d));
    expect(r.callouts).toEqual([]);
    expect(r.notes).toEqual(["Callout 5 no longer touches Pin (its dimensions changed), so it is not drawn — place it again."]);
  });
});

describe("damaged documents the second review found accepted", () => {
  const withViews = (views: unknown[]) => JSON.stringify({ ...starterDoc("asme"), views });
  it.each([
    [[0, 0, 0, 0, 0, 0, 0, 0, 0], "all zeros"],
    [[5, 0, 0, 0, 5, 0, 0, 0, 5], "a scaling"],
    [[-1, 0, 0, 0, 1, 0, 0, 0, 1], "a mirror"],
  ])("an orbit view that is not a rotation (%j, %s) is refused", (rot) => {
    expect(parseDoc(withViews([{ kind: "orbit", rot }]))).toEqual({ ok: false, reason: "a view in the drawing is damaged" });
  });
  it("a turned view is accepted", () => {
    const c = Math.SQRT1_2;
    expect(parseDoc(withViews([{ kind: "orbit", rot: [c, -c, 0, c, c, 0, 0, 0, 1] }])).ok).toBe(true);
  });
  it("two parts with one id are refused (callouts could not tell them apart)", () => {
    const d = { ...starterDoc("asme") };
    d.parts = [d.parts[0], { ...d.parts[0] }];
    expect(parseDoc(JSON.stringify(d))).toEqual({ ok: false, reason: "two parts in the drawing share one id" });
  });
});
