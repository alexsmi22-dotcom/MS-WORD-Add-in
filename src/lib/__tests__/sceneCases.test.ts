// Scene modelling & pipeline (v2.206.0): the eleven calculators of sceneCalcs.ts and their engines, against
// scripts/scene-oracle.py (geomdl 5.4.0, scipy 1.18.1, trimesh 5.2.0, numpy 2.5.4; fixtures/scene-oracle.json), then
// adversarially: degenerate curves, bad knot vectors and weights, broken meshes and indices, every ray corner case,
// zero-area UVs, a serial fraction of 1, zero nodes and the rest, each refused or explained by name.

import * as fs from "fs";
import * as path from "path";
import { SCENE_CALCS, SCENE_GROUP } from "../sceneCalcs";
import { bezierAnalyse, bezierPoint, bezierSplit, bezierElevate, bernsteinRoots, nurbsAnalyse, nurbsPoint, checkKnots, clampedUniformKnots, insertKnot, type Vec } from "../sceneCurves";
import { parseObj, meshStats, catmullClarkStep, loopStep, countVEF, catmullClarkCounts, loopCounts, eulerFromCounts, MESH_MAX_VERTICES } from "../sceneMesh";
import { raySphere, rayBox, rayTriangle, unitDir, sahCost, bestSahSplit, boundingVolumes } from "../sceneRay";
import { TEX_FORMATS, textureMemory, farm, nodesForDeadline, frameBytes, screenSize, lodBands, pipeline } from "../scenePipeline";
import { readingProblems } from "../calcReading";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scene-oracle.json"), "utf8"));

const calc = (id: string) => {
  const c = SCENE_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}: ${o.text}`);
  return e.value;
};
const near = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const nearV = (a: Vec, b: number[], tol = 1e-12) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => near(v, b[i], tol));
};

/** The display contract on every ok result. */
function displayClean(o: AnalyzeOutput): void {
  const t = o.text;
  expect(t).not.toMatch(/\d[eE][-+]?\d/);
  expect(t).not.toMatch(/NaN|Infinity|undefined|not finite/);
  expect(t).not.toMatch(/—/);
  expect(t).not.toMatch(/(^|[\s(,=[])-\d/m);
  for (const b of o.blocks ?? []) {
    if (b.kind === "plot") {
      expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(b.svg).not.toMatch(/>[^<]*\d[eE][-+]?\d[^<]*</);
      expect(b.svg.startsWith("<svg")).toBe(true);
    }
  }
}
const ok = (o: AnalyzeOutput): AnalyzeOutput => {
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  displayClean(o);
  expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
  return o;
};
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined|—/);
  expect(o.text).toMatch(re);
};
/** The first report line: the plain-language reading. */
const reading = (o: AnalyzeOutput): string => {
  const first = (o.blocks ?? []).find((b) => b.kind === "line");
  return first && first.kind === "line" ? first.text : "";
};

// ---------------------------------------------------------------------------------------------------------------
// Registry and contract
// ---------------------------------------------------------------------------------------------------------------

describe("registry", () => {
  test("eleven calculators, unique ids, one group", () => {
    expect(SCENE_CALCS.map((c) => c.id)).toEqual([
      "scene-bezier", "scene-nurbs", "scene-mesh", "scene-subdiv", "scene-lod", "scene-ray", "scene-bvol", "scene-texture", "scene-farm", "scene-storage", "scene-pipeline",
    ]);
    for (const c of SCENE_CALCS) expect(c.group).toBe(SCENE_GROUP);
    expect(SCENE_GROUP).toBe("Scene modelling & pipeline");
  });
  test("the pane's group order has the heading right after Light & camera", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const i = pane.indexOf("const ENG_GROUP_ORDER");
    const order = [...pane.slice(i, pane.indexOf("] as const", i)).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(order[order.indexOf("Light & camera") + 1]).toBe(SCENE_GROUP);
    expect(pane).toMatch(/^\s*\.\.\.SCENE_CALCS,$/m);
  });
});

describe("every calculator on its defaults: a reading, a figure, a table, an assumes note, typeset equations", () => {
  test.each(SCENE_CALCS.map((c) => [c.id] as const))("%s", (id) => {
    const o = ok(run(id));
    const rd = reading(o);
    expect(readingProblems(rd)).toEqual([]);
    expect(rd).toMatch(/\d/);
    expect(o.text).toMatch(/Assumes: /);
    expect((o.blocks ?? []).some((b) => b.kind === "table")).toBe(true);
    const maths = (o.blocks ?? []).filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const b of maths) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    expect((o.outputs ?? []).length).toBeGreaterThan(0);
    for (const e of o.outputs ?? []) expect(Number.isFinite(e.value)).toBe(true);
  });
});

describe("every dropdown option computes and draws (one at a time, the rest at defaults)", () => {
  const rows: Array<[string, string, string]> = [];
  for (const c of SCENE_CALCS) for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) rows.push([c.id, f.key, o.value]);
  test.each(rows)("%s %s = %s", (id, key, value) => {
    // Loop needs a triangle mesh; the 0-based index base needs 0-based indices.
    const over: Record<string, string> = { [key]: value };
    if (id === "scene-subdiv" && value === "loop") over.obj = ORACLE.fixtures.tetrahedron;
    if (id === "scene-mesh" && key === "base" && value === "zero") over.obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2";
    if (id === "scene-bvol" && key === "axis" && value !== "x") over.pos = value === "y" ? "0.7" : "0.25";
    const o = ok(run(id, over));
    expect(readingProblems(reading(o))).toEqual([]);
  });
});

describe("the reading follows the numbers", () => {
  test("a different input gives a different reading", () => {
    expect(reading(run("scene-bezier"))).not.toEqual(reading(run("scene-bezier", { t: "0.25" })));
    expect(reading(run("scene-farm"))).not.toEqual(reading(run("scene-farm", { nodes: "5" })));
    expect(reading(run("scene-farm", { nodes: "5" }))).toMatch(/missing the 24 h deadline; 7 nodes would make it/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Oracle agreement
// ---------------------------------------------------------------------------------------------------------------

describe("Bézier against scipy (BSpline on a clamped knot vector, quad, brentq)", () => {
  test.each(Object.keys(ORACLE.bezier))("%s", (name) => {
    const c = ORACLE.bezier[name];
    const r = bezierAnalyse(c.P, c.t);
    if (!r.ok) throw new Error(r.error);
    nearV(r.point, c.point, 1e-13);
    nearV(r.d1, c.d1, 1e-12);
    nearV(r.d2, c.d2, 1e-12);
    near(r.curvature as number, c.curvature, 1e-12);
    near(r.arcLength, c.arc, 1e-11);
    nearV(r.bounds.min, c.bmin, 1e-12);
    nearV(r.bounds.max, c.bmax, 1e-12);
  });
  test("split halves and the elevated curve trace the same curve", () => {
    const P = ORACLE.bezier.degree7.P as Vec[];
    const { left, right } = bezierSplit(P, 0.61);
    const E = bezierElevate(P);
    for (let i = 0; i <= 50; i++) {
      const s = i / 50;
      nearV(bezierPoint(left, s), bezierPoint(P, 0.61 * s), 1e-12);
      nearV(bezierPoint(right, s), bezierPoint(P, 0.61 + 0.39 * s), 1e-12);
      nearV(bezierPoint(E, s), bezierPoint(P, s), 1e-12);
    }
  });
  test("the calculator prints the oracle's arc length and curvature", () => {
    const o = ok(run("scene-bezier"));
    near(out(o, "arc"), ORACLE.bezier.cubic.arc, 1e-11);
    near(out(o, "kappa"), ORACLE.bezier.cubic.curvature, 1e-12);
    expect(o.text).toMatch(/The whole curve is 5\.26837 long/);
    expect(o.text).toMatch(/radius of curvature 1\.6875/);
  });
  test("Bernstein root isolation finds close and double-sign roots", () => {
    // (t − 0.3)(t − 0.31)(t − 0.9) in Bernstein form via sampling its power form.
    const f = (t: number) => (t - 0.3) * (t - 0.31) * (t - 0.9);
    // Degree-3 Bernstein coefficients from the polynomial's values (exact for a cubic): solve via de Casteljau inverse.
    const p0 = f(0), p3 = f(1);
    const d0 = 0.3 * 0.31 + 0.3 * 0.9 + 0.31 * 0.9; // f'(0)
    const d1 = (1 - 0.3) * (1 - 0.31) + (1 - 0.3) * (1 - 0.9) + (1 - 0.31) * (1 - 0.9); // f'(1)
    const c = [p0, p0 + d0 / 3, p3 - d1 / 3, p3];
    const roots = bernsteinRoots(c);
    expect(roots.length).toBe(3);
    near(roots[0], 0.3, 1e-12);
    near(roots[1], 0.31, 1e-12);
    near(roots[2], 0.9, 1e-12);
  });
});

describe("NURBS against geomdl and scipy (homogeneous BSpline)", () => {
  test.each(Object.keys(ORACLE.nurbs))("%s", (name) => {
    const c = ORACLE.nurbs[name];
    const r = nurbsAnalyse({ P: c.P, w: c.w, p: c.p, U: c.U, u: c.u, insert: c.ins ? c.ins[0] : null, times: c.ins ? c.ins[1] : 1 });
    if (!r.ok) throw new Error(r.error);
    nearV(r.point, c.point, 1e-13);
    nearV(r.point, c.scipy_point, 1e-13);
    nearV(r.d1, c.d1, 1e-12);
    nearV(r.d1, c.scipy_d1, 1e-12);
    if (c.ins) {
      const ins = r.inserted!;
      nearV(ins.U, c.ins_knots, 0);
      nearV(ins.P.flat(), c.ins_ctrlpts.flat(), 1e-13);
      nearV(ins.w, c.ins_weights, 1e-13);
      expect(r.insertionDeviation as number).toBeLessThan(1e-13);
    }
  });
  test("the quarter circle (weights 1, √2/2, 1) is exact: radial error at rounding level, as geomdl finds", () => {
    const o = ok(run("scene-nurbs"));
    expect(reading(o)).toMatch(/exact circular arc: 90° of a circle of radius 1 about \(0, 0\)/);
    expect(out(o, "radialErr")).toBeLessThan(1e-15);
    expect(ORACLE.nurbs.quarter_circle.max_radial_err).toBeLessThan(1e-15);
    // Half-way, the point is (√2/2, √2/2).
    near(out(o, "x"), Math.SQRT1_2, 1e-15);
    near(out(o, "y"), Math.SQRT1_2, 1e-15);
  });
  test("a wrong middle weight is a conic but not the circle", () => {
    const o = ok(run("scene-nurbs", { w: "1, 0.5, 1", ins: "" }));
    expect(o.text).toMatch(/does not, so the curve is a conic but not this circle/);
  });
  test("the default clamped uniform knot vector", () => {
    expect(clampedUniformKnots(6, 3)).toEqual([0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1]);
    expect(clampedUniformKnots(3, 2)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe("meshes against trimesh (process=False, fan-triangulated)", () => {
  test.each(Object.keys(ORACLE.fixtures))("%s", (name) => {
    const m = parseObj(ORACLE.fixtures[name], "obj");
    if (!("V" in m)) throw new Error(m.error);
    const s = meshStats(m);
    const t = ORACLE.trimesh[name];
    // trimesh's euler_number counts the vertices faces reference, as ours does (isolated ones are reported apart).
    expect(s.chi).toBe(t.euler);
    near(s.area, t.area, 1e-12);
    expect(s.closed).toBe(t.watertight);
    expect(s.inconsistentEdges.length === 0).toBe(t.winding_consistent);
    expect(s.triangulated).toBe(t.triangles);
    if (t.center_mass) {
      near(s.volume, t.volume, 1e-12);
      nearV(s.volumeCentroid as Vec, t.center_mass, 1e-12);
    }
    if (name !== "isolated_vertex") {
      nearV(s.bmin, t.bounds[0], 0);
      nearV(s.bmax, t.bounds[1], 0);
    }
  });
  test("topology verdicts: genus, orientability, holes", () => {
    const st = (n: string) => meshStats(parseObj(ORACLE.fixtures[n], "obj") as never);
    expect(st("cube").genus).toBe(0);
    expect(st("torus").genus).toBe(1);
    expect(st("open_box").boundaryLoops).toBe(1);
    expect(st("open_box").genus).toBeNull();
    expect(st("miswound").orientable).toBe(true);
    expect(st("miswound").flipsNeeded).toBe(1);
    expect(st("mobius").orientable).toBe(false);
    expect(st("nonmanifold").nonManifoldEdges.length).toBe(1);
    expect(st("nonmanifold").orientable).toBeNull();
    expect(st("isolated_vertex").isolated).toBe(1);
    expect(st("inside_out").volume).toBeCloseTo(-8, 12);
  });
  test("the calculator names each defect in its reading", () => {
    expect(reading(ok(run("scene-mesh", { obj: ORACLE.fixtures.open_box })))).toMatch(/This mesh is open: 4 boundary edges form 1 hole/);
    expect(reading(ok(run("scene-mesh", { obj: ORACLE.fixtures.miswound })))).toMatch(/wound inconsistently .*flipping 1 face fixes it/);
    expect(reading(ok(run("scene-mesh", { obj: ORACLE.fixtures.nonmanifold })))).toMatch(/not a manifold surface: 1 edge is shared by three or more faces/);
    expect(reading(ok(run("scene-mesh", { obj: ORACLE.fixtures.mobius })))).toMatch(/non-orientable/);
    expect(reading(ok(run("scene-mesh", { obj: ORACLE.fixtures.torus })))).toMatch(/genus 1/);
    expect(ok(run("scene-mesh", { obj: ORACLE.fixtures.inside_out })).text).toMatch(/inside-out/);
    const iso = ok(run("scene-mesh", { obj: ORACLE.fixtures.isolated_vertex }));
    expect(iso.text).toMatch(/1 isolated: used by no face, left out of χ; counting them, V − E \+ F = 3/);
  });
});

describe("subdivision: the count formulas against a real subdivision and trimesh", () => {
  test("Catmull–Clark on the cube: 6 → 24 → 96 quads, the corner moves to 5/9", () => {
    let m = parseObj(ORACLE.fixtures.cube, "obj") as { V: Vec[]; F: number[][] };
    m = catmullClarkStep(m);
    expect(countVEF(m)).toEqual({ V: 26, E: 48, F: 24 });
    nearV(m.V[0], [-5 / 9, -5 / 9, -5 / 9], 1e-15);
    m = catmullClarkStep(m);
    expect(countVEF(m)).toEqual({ V: 98, E: 192, F: 96 });
    const f = catmullClarkCounts(8, 12, 6, 24, 12, 3);
    expect(f.map((x) => [Number(x.V), Number(x.E), Number(x.F)])).toEqual([[8, 12, 6], [26, 48, 24], [98, 192, 96], [386, 768, 384]]);
  });
  test("Catmull–Clark on a pentagonal prism: F₁ = Σ face valences = 30", () => {
    const m = parseObj(ORACLE.fixtures.pentagonal_prism, "obj") as { V: Vec[]; F: number[][] };
    const s = meshStats({ ...m, ignored: [] });
    expect(s.corners).toBe(30);
    expect(countVEF(catmullClarkStep(m))).toEqual({ V: 10 + 15 + 7, E: 2 * 15 + 30, F: 30 });
  });
  test("Loop on a tetrahedron matches trimesh.remesh.subdivide_loop: counts, area, volume, extent", () => {
    let m = parseObj(ORACLE.fixtures.tetrahedron, "obj") as { V: Vec[]; F: number[][] };
    const f = loopCounts(4, 6, 4, 3);
    for (let l = 1; l <= 3; l++) {
      m = loopStep(m);
      const t = ORACLE.loop[`level${l}`];
      const s = meshStats({ ...m, ignored: [] });
      expect([s.vertices, s.edges, s.faces]).toEqual([t.V, t.E, t.F]);
      expect([Number(f[l].V), Number(f[l].E), Number(f[l].F)]).toEqual([t.V, t.E, t.F]);
      near(s.area, t.area, 1e-12);
      near(s.volume, t.volume, 1e-12);
      nearV(s.bmax, t.bmax, 1e-12);
    }
  });
  test("the calculator verifies its own counts and finds the budget level", () => {
    const o = ok(run("scene-subdiv"));
    expect(o.text).toMatch(/Verified: the mesh was subdivided for real through level 6/);
    expect(reading(o)).toMatch(/10,000-triangle budget is exceeded at level 5, so level 4 is the deepest that fits/);
    expect(out(o, "faces")).toBe(6 * 4 ** 6);
    // Memory: V·32 + 3T·4 at level 6: V = 24,578, T = 49,152.
    expect(out(o, "memory")).toBe(24578 * 32 + 3 * 49152 * 4);
  });
  test("deep levels use the formulas alone and stay exact (BigInt)", () => {
    const o = ok(run("scene-subdiv", { levels: "10", budget: "" }));
    expect(o.text).toMatch(/deeper levels pass 60,000 faces and are counted by the formulas alone/);
    expect(out(o, "faces")).toBe(6 * 4 ** 10);
  });
});

describe("rays against independent numpy / trimesh barycentrics", () => {
  const d = (v: number[]) => unitDir(v) as Vec;
  test("sphere", () => {
    const a = raySphere([0, 0.3, -5], d([0, 0, 1]), [0, 0, 0], 1);
    near(a.tNear as number, ORACLE.ray.sphere_default.tNear, 1e-14);
    near(a.tFar as number, ORACLE.ray.sphere_default.tFar, 1e-14);
    nearV(a.point as Vec, ORACLE.ray.sphere_default.point, 1e-14);
    const b = raySphere([-3, 2, 1], d([1, -0.5, -0.2]), [0.5, 0.2, 0.1], 1.3);
    near(b.tNear as number, ORACLE.ray.sphere_oblique.tNear, 1e-13);
    nearV(b.point as Vec, ORACLE.ray.sphere_oblique.point, 1e-13);
  });
  test("box (slabs)", () => {
    const a = rayBox([0, 0.3, -5], d([0, 0, 1]), [-1, -1, -1], [1, 1, 1]);
    near(a.tNear as number, 4, 1e-15);
    const b = rayBox([-4, -3, 0.5], d([2, 1.5, 0.1]), [-1, -1, -1], [1, 2, 1]);
    near(b.tNear as number, ORACLE.ray.box_oblique.tNear, 1e-13);
    near(b.tFar as number, ORACLE.ray.box_oblique.tFar, 1e-13);
    nearV(b.point as Vec, ORACLE.ray.box_oblique.point, 1e-13);
  });
  test("triangle (Möller–Trumbore against plane + barycentric)", () => {
    const a = rayTriangle([0, 0.3, -5], d([0, 0, 1]), [-1, -1, 0], [1, -1, 0], [0, 1, 0]);
    nearV(a.bary as Vec, ORACLE.ray.tri_default.bary, 1e-14);
    expect(a.backFace).toBe(ORACLE.ray.tri_default.back);
    const b = rayTriangle([0.2, -2, 3], d([0.1, 0.6, -1]), [-1, -1, 0.5], [2, -0.5, 0], [0, 1.5, -0.2]);
    near(b.tNear as number, ORACLE.ray.tri_oblique.t, 1e-13);
    nearV(b.bary as Vec, ORACLE.ray.tri_oblique.bary, 1e-13);
    nearV(b.point as Vec, ORACLE.ray.tri_oblique.point, 1e-13);
    expect(b.backFace).toBe(false);
  });
});

describe("pipeline numbers against independent re-implementations", () => {
  test.each(Object.keys(ORACLE.pipeline.texture))("texture %s", (key) => {
    const [size, id] = key.split("_");
    const [w, h] = size.split("x").map(Number);
    const f = TEX_FORMATS.find((x) => x.id === id)!;
    const m = textureMemory(w, h, f, true);
    expect({ base: m.base, chain: m.chain, levels: m.levels }).toEqual(ORACLE.pipeline.texture[key]);
  });
  test("exact block rates: BC1/BC4 4 bpp, BC3/5/6H/7 8 bpp, ASTC 4×4 8 bpp to 12×12 0.888… bpp", () => {
    const bpp = (id: string) => TEX_FORMATS.find((f) => f.id === id)!.bpp;
    expect([bpp("bc1"), bpp("bc4"), bpp("bc3"), bpp("bc5"), bpp("bc6h"), bpp("bc7")]).toEqual([4, 4, 8, 8, 8, 8]);
    expect(bpp("astc4x4")).toBe(8);
    expect(bpp("astc12x12")).toBeCloseTo(0.888888889, 9);
  });
  test("texel density and the calculator", () => {
    const o = ok(run("scene-texture"));
    near(out(o, "density"), ORACLE.pipeline.texel_density, 1e-14);
    expect(out(o, "memory")).toBe(ORACLE.pipeline.texture["2048x2048_bc7"].chain);
  });
  test("farm: Amdahl, whole-frame rounds, the deadline scan, LPT", () => {
    const o = ok(run("scene-farm"));
    const F = ORACLE.pipeline.farm_default;
    near(out(o, "speedup"), F.speedup, 1e-14);
    near(out(o, "wall") * 3600, F.wall, 1e-12);
    expect(out(o, "nodesNeeded")).toBe(F.nodes_for_24h);
    const lp = ok(run("scene-farm", { times: "3 h\n9 h\n6 h\n12 h\n2 h\n8 h\n7 h\n4 h", nodes: "3" }));
    near(out(lp, "wall") * 3600, ORACLE.pipeline.farm_lpt.wall, 1e-12);
    expect(lp.text).toMatch(/LPT scheduling/);
  });
  test("storage: DPX 10-bit packing and EXR half", () => {
    expect(frameBytes(4096, 2160, 3, "int10dpx")).toBe(ORACLE.pipeline.dpx10_4096x2160x3);
    expect(frameBytes(1920, 1080, 4, "int10dpx")).toBe(ORACLE.pipeline.dpx10_1920x1080x4);
    expect(frameBytes(4096, 2160, 4, "half")).toBe(ORACLE.pipeline.exr_half_4096x2160x4);
    const o = ok(run("scene-storage"));
    expect(out(o, "frame")).toBe(ORACLE.pipeline.exr_half_4096x2160x4);
    // 203,843,174,400 bytes at 7 Gbps effective: 232.96 s.
    near(out(o, "transfer") * 3600, (203843174400 * 8) / 7e9, 1e-12);
  });
  test("SAH", () => {
    const P = [[0, 0, 0], [1, 0.5, 0.2], [0.5, 1.5, 0], [2, 0.2, 0.4], [6, 1, 0.1], [6.5, 0.4, 0.3], [7, 1.2, 0], [7.2, 0.1, 0.5]];
    near(sahCost(P, 0, 3, 1, 1)!.cost, ORACLE.pipeline.sah_x3, 1e-14);
    near(sahCost(P, 1, 0.7, 1, 1)!.cost, ORACLE.pipeline.sah_y07, 1e-14);
    expect(bestSahSplit(P, 1, 1)!.cost).toBeLessThanOrEqual(sahCost(P, 0, 3, 1, 1)!.cost);
    const bv = boundingVolumes(P);
    for (const p of P) expect(Math.hypot(...p.map((v, i) => v - bv.ritter.c[i]))).toBeLessThanOrEqual(bv.ritter.r * (1 + 1e-12));
  });
  test("LOD", () => {
    const o = ok(run("scene-lod"));
    const L = ORACLE.pipeline.lod;
    near(out(o, "focal"), L.focal, 1e-14);
    near(out(o, "diameterPx"), L.diameter, 1e-14);
    near(out(o, "switch1"), L.switch[1], 1e-14);
    near(out(o, "switch3"), L.switch[3], 1e-14);
    expect(reading(o)).toMatch(/LOD2 is the coarsest level/);
  });
  test("pipeline: the bottleneck and Little's law", () => {
    const o = ok(run("scene-pipeline"));
    expect(out(o, "bottleneckCapacity")).toBe(0.25);
    expect(out(o, "throughput")).toBe(0.2);
    expect(out(o, "lead")).toBe(60);
    expect(reading(o)).toMatch(/Texturing is the bottleneck/);
    expect(reading(o)).toMatch(/60 working hours/);
    expect(o.text).toMatch(/hold work in progress to L = λW = 8 items/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial
// ---------------------------------------------------------------------------------------------------------------

describe("curves: degenerate and malformed input", () => {
  test("all control points equal: a single point, no tangent, curvature refused by name", () => {
    const o = ok(run("scene-bezier", { pts: "1, 1\n1, 1\n1, 1\n1, 1" }));
    expect(reading(o)).toMatch(/single point \(1, 1\): its length is 0 and it has no tangent, normal or curvature/);
    expect((o.outputs ?? []).some((e) => e.key === "kappa")).toBe(false);
  });
  test("coincident end points: C′(0) = 0, curvature undefined there, tangent from the next derivative", () => {
    const r = bezierAnalyse([[0, 0], [0, 0], [1, 1], [2, 0]], 0);
    if (!r.ok) throw new Error(r.error);
    expect(r.curvature).toBeNull();
    expect(r.tangentOrder).toBe(2);
    nearV(r.tangent as Vec, [Math.SQRT1_2, Math.SQRT1_2], 1e-15);
    expect(r.curvatureNote).toMatch(/C′\(t\) = 0 at t = 0/);
  });
  test("a straight Bézier has zero curvature and no principal normal, said so", () => {
    const o = ok(run("scene-bezier", { pts: "0, 0\n1, 1\n2, 2" }));
    expect(o.text).toMatch(/straight at this t \(curvature 0\)/);
  });
  test("caps and ranges refused by name", () => {
    refused(run("scene-bezier", { pts: Array.from({ length: 22 }, (_, i) => `${i}, 0`).join("\n") }), /degree 21; the cap is degree 20/);
    refused(run("scene-bezier", { t: "1.5" }), /outside \[0, 1\]/);
    refused(run("scene-bezier", { pts: "0, 0\n1, 1, 1" }), /same number of coordinates/);
    refused(run("scene-bezier", { pts: "0, 0" }), /at least two control points/);
    refused(run("scene-bezier", { pts: "0 m, 0 m\n1, 1" }), /line 1: "0 m, 0 m" is not a list of numbers/);
  });
  test("knot vectors: length, order, full-multiplicity interior knots, C⁰ joints", () => {
    refused(run("scene-nurbs", { U: "0 0 0 1 1" }), /5 knots; 3 control points of degree 2 need n \+ p \+ 1 = 6/);
    refused(run("scene-nurbs", { U: "0 0 1 0 1 1" }), /decreases at position 4/);
    const four = "0, 0\n1, 1\n2, 0\n3, 1\n4, 0\n5, 1";
    refused(run("scene-nurbs", { pts: four, w: "", U: "0 0 0 0.5 0.5 0.5 1 1 1", ins: "" }), /interior knot 0\.5 has multiplicity 3 = p \+ 1: the curve breaks into two separate pieces/);
    const c0 = ok(run("scene-nurbs", { pts: "0, 0\n1, 1\n2, 0\n3, 1\n4, 0", w: "", U: "0 0 0 0.5 0.5 1 1 1", ins: "" }));
    expect(c0.text).toMatch(/multiplicity equals p, so the curve is only C⁰ there/);
    expect(checkKnots([0, 0, 0, 0, 1, 1, 1], 3, 2)).toMatchObject({ ok: false });
  });
  test("zero and negative weights refused with the reason", () => {
    refused(run("scene-nurbs", { w: "1, 0, 1" }), /Weight 2 is 0\. A zero weight puts that control point at infinity, and the curve's denominator/);
    refused(run("scene-nurbs", { w: "1, -0.5, 1" }), /Weight 2 is negative .* denominator Σ Nᵢ\(u\)wᵢ can pass through zero/);
    refused(run("scene-nurbs", { w: "1, 1" }), /2 weights for 3 control points/);
  });
  test("knot insertion past multiplicity p is refused; Boehm keeps the curve", () => {
    refused(run("scene-nurbs", { ins: "0.5", times: "3" }), /above p = 2/);
    const U = [0, 0, 0, 0, 0.3, 0.7, 1, 1, 1, 1];
    const P = [[0, 0], [1, 2], [2, -1], [3, 3], [4, 0], [5, 1]];
    const w = [1, 2, 1, 0.5, 1, 1];
    const ins = insertKnot(U, P, w, 3, 0.45, 3);
    for (let i = 0; i <= 100; i++) nearV(nurbsPoint(ins.U, ins.P, ins.w, 3, i / 100), nurbsPoint(U, P, w, 3, i / 100), 1e-13);
  });
  test("u outside the domain and a degree too high for the points", () => {
    refused(run("scene-nurbs", { u: "1.2" }), /outside the curve's domain \[0, 1\]/);
    refused(run("scene-nurbs", { deg: "3", U: "" }), /Degree 3 needs at least p \+ 1 = 4 control points; 3 given/);
  });
});

describe("meshes: indices, caps and counts", () => {
  test("OBJ index 0 is named as 0-based; the 0-based base reads it", () => {
    refused(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2" }), /index 0\. OBJ indices are 1-based .* looks 0-based/);
    expect(ok(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2", base: "zero" })).text).toMatch(/3 vertices, 3 edges and 1 faces|3 vertices, 3 edges and 1 face/);
  });
  test("negative OBJ indices count back from the last vertex", () => {
    const a = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1", "obj");
    expect("V" in a && a.F[0]).toEqual([0, 1, 2]);
    refused(run("scene-mesh", { obj: "v 0 0 0\nf -1 -2 -3" }), /reaches back past the first vertex/);
    refused(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3", base: "zero" }), /index 3 is out of range; there are 3 vertices \(0 to 2\)/);
  });
  test("out-of-range, repeated-vertex and short faces refused with their line", () => {
    refused(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4" }), /Line 4: index 4 is out of range; there are 3 vertices \(1 to 3\)/);
    refused(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 2" }), /uses one vertex twice/);
    refused(run("scene-mesh", { obj: "v 0 0 0\nv 1 0 0\nf 1 2" }), /at least 3 vertices/);
    refused(run("scene-mesh", { obj: "v 0 0 0\nq 1 2 3" }), /"q" is not an OBJ keyword/);
  });
  test("vt/vn/s/g lines and slashed indices are read past", () => {
    const o = ok(run("scene-mesh", { obj: "o tri\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\ns off\nf 1/1/1 2//1 3/1" }));
    expect(o.text).toMatch(/Skipped: 1 o line, 1 vt line, 1 vn line, 1 s line/);
  });
  test("the input cap is refused by name, not run", () => {
    const big = Array.from({ length: MESH_MAX_VERTICES + 1 }, (_, i) => `v ${i} 0 0`).join("\n") + "\nf 1 2 3";
    refused(run("scene-mesh", { obj: big }), /More than 20,000 vertices: the cap/);
  });
  test("counts form: genus from V, E, F; impossible counts named", () => {
    expect(eulerFromCounts(48, 96, 48, 1)).toEqual({ chi: 0, genus: 1, note: null });
    expect(reading(ok(run("scene-mesh", { mode: "counts", vef: "48, 96, 48" })))).toMatch(/genus 1 \(1 handle, like a torus\)/);
    expect(ok(run("scene-mesh", { mode: "counts", vef: "5, 5, 1" })).text).toMatch(/2c − χ = 1 is odd/);
    refused(run("scene-mesh", { mode: "counts", vef: "8, 12" }), /three whole numbers/);
  });
  test("subdivision refuses Loop on quads and non-manifold meshes by name", () => {
    refused(run("scene-subdiv", { scheme: "loop" }), /Loop subdivision works on triangles only, and this mesh has 6 faces with 4 or more sides/);
    refused(run("scene-subdiv", { obj: ORACLE.fixtures.nonmanifold }), /non-manifold edge .* defined on manifold meshes/);
    refused(run("scene-subdiv", { bpv: "32 B" }), /not a plain number \(this field takes no unit\)/);
    refused(run("scene-subdiv", { levels: "11" }), /above the cap of 10/);
  });
});

describe("rays: the corner cases, by name", () => {
  test("a ray starting inside the sphere exits once", () => {
    const o = ok(run("scene-ray", { o: "0, 0, 0" }));
    expect(reading(o)).toMatch(/starts INSIDE the sphere/);
    expect(out(o, "tsphere")).toBeCloseTo(1, 14);
  });
  test("a ray parallel to the triangle, and one in its plane", () => {
    expect(reading(ok(run("scene-ray", { prim: "triangle", o: "0, 0, 1", d: "1, 0, 0" })))).toMatch(/parallel to the triangle's plane \(d · n = 0\), 1 away from it/);
    expect(reading(ok(run("scene-ray", { prim: "triangle", o: "-5, 0, 0", d: "1, 0, 0" })))).toMatch(/lies IN the triangle's plane/);
  });
  test("tangent sphere, grazing box, parallel slab, behind, back face, edge hit", () => {
    expect(raySphere([-5, 1, 0], [1, 0, 0], [0, 0, 0], 1).note).toBe("tangent");
    expect(reading(ok(run("scene-ray", { o: "-5, 1, 0", d: "1, 0, 0" })))).toMatch(/grazes the sphere/);
    expect(reading(ok(run("scene-ray", { prim: "box", o: "-5, 1, 1", d: "1, 0, 0" })))).toMatch(/grazes the box/);
    expect(reading(ok(run("scene-ray", { prim: "box", o: "-5, 3, 0", d: "1, 0, 0" })))).toMatch(/parallel to the y slabs \(direction y = 0\) and its y = 3 is outside −1 to 1/);
    expect(reading(ok(run("scene-ray", { d: "0, 0, -1" })))).toMatch(/behind the origin/);
    expect(rayTriangle([0, 0, -1], [0, 0, 1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]).backFace).toBe(true);
    expect(rayTriangle([0, -1, -1], [0, 0, 1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]).note).toBe("edge");
  });
  test("bad ray and primitive input", () => {
    refused(run("scene-ray", { d: "0, 0, 0" }), /has no direction/);
    refused(run("scene-ray", { box: "1, 1, 1, -1, -1, -1" }), /max corner's x \(−1\) is below the min corner's \(1\)/);
    refused(run("scene-ray", { sph: "0, 0, 0, 0" }), /radius 0 must be greater than 0/);
    refused(run("scene-ray", { tri: "0, 0, 0\n1, 0, 0" }), /exactly three vertices/);
    expect(rayTriangle([0, 0, -1], [0, 0, 1], [0, 0, 0], [1, 1, 0], [2, 2, 0]).note).toBe("degenerate");
  });
});

describe("bounding volumes and SAH: refusals", () => {
  test("a split with an empty side is not a split", () => {
    refused(run("scene-bvol", { pos: "100" }), /every point on the left/);
    refused(run("scene-bvol", { pos: "-1" }), /every point on the right/);
  });
  test("collinear or coincident points have no box area", () => {
    refused(run("scene-bvol", { pts: "0, 0, 0\n1, 0, 0\n2, 0, 0" }), /zero surface area .* collinear/);
    refused(run("scene-bvol", { pts: "1, 1, 1\n1, 1, 1" }), /every point coincides/);
  });
});

describe("pipeline tools: refusals and edge cases by name", () => {
  test("zero-area UVs and zero surface area", () => {
    refused(run("scene-texture", { uv: "0" }), /zero area in UV space, so no texel maps to the surface/);
    refused(run("scene-texture", { area: "0 m^2" }), /zero-area surface has no texel density/);
    refused(run("scene-texture", { uv: "70" }), /70 is above 1\. .* 70 % if a percentage was meant/);
    expect(ok(run("scene-texture", { uv: "70 %" })).text).toMatch(/856\.74 texels per metre/);
  });
  test("texture list errors and budget overrun", () => {
    refused(run("scene-texture", { list: "Albedo, 4096, 4096, dxt9" }), /"dxt9" is not a format id/);
    expect(ok(run("scene-texture", { budget: "32 MiB" })).text).toMatch(/OVER/);
    refused(run("scene-texture", { budget: "64 kg" }), /Memory budget/);
  });
  test("non-power-of-two and partial blocks are explained", () => {
    const o = ok(run("scene-texture", { w: "1000", h: "600", fmt: "astc12x12" }));
    expect(o.text).toMatch(/not a power of two/);
    expect(o.text).toMatch(/not a whole number of 12 × 12 blocks: the top level is padded to 1008 × 600/);
  });
  test("a serial fraction of 1: no speed-up from cores, still a valid farm", () => {
    const o = ok(run("scene-farm", { serial: "1" }));
    expect(out(o, "speedup")).toBe(1);
    expect(o.text).toMatch(/does not parallelise at all/);
    expect(farm({ frameTimes: null, meanTime: 100, frames: 10, nodes: 2, coresPerNode: 64, serial: 1, overhead: 0 }).wall).toBe(500);
  });
  test("0 nodes, 0 cores and a deadline no farm can meet", () => {
    refused(run("scene-farm", { nodes: "0" }), /Render nodes: 0 is below 1 \(0 nodes render nothing/);
    refused(run("scene-farm", { cores: "0" }), /Cores per node: 0 is below 1/);
    const o = ok(run("scene-farm", { deadline: "30 min" }));
    expect(reading(o)).toMatch(/no node count makes it, because one frame alone takes longer than the deadline/);
    expect(nodesForDeadline({ frameTimes: null, meanTime: 3600, frames: 4, nodes: 1, coresPerNode: 1, serial: 0, overhead: 0 }, 1800).nodes).toBeNull();
    // Equal frames: ⌈F/⌊D/t⌋⌉ exactly. Measured frames: the fewest from ⌈work/D⌉, checked against a brute-force LPT scan.
    expect(nodesForDeadline({ frameTimes: null, meanTime: 3600, frames: 10, nodes: 1, coresPerNode: 1, serial: 0, overhead: 0 }, 3 * 3600)).toMatchObject({ nodes: 4, how: "rounds" });
    const ft = [5, 3, 3, 2, 2, 2, 1, 1, 7, 4].map((h) => h * 3600);
    const inp = { frameTimes: ft, meanTime: 0, frames: ft.length, nodes: 1, coresPerNode: 1, serial: 0, overhead: 0 };
    for (const D of [7, 8, 10, 15, 30]) {
      let brute = 0;
      for (let n = 1; n <= ft.length && !brute; n++) if (farm({ ...inp, nodes: n }).wall <= D * 3600 * (1 + 1e-12)) brute = n;
      expect(nodesForDeadline(inp, D * 3600)).toMatchObject({ nodes: brute, how: "scan" });
    }
  });
  test("farm units: a time in a mass unit is refused; minutes convert", () => {
    refused(run("scene-farm", { t: "8 kg" }), /Render time per frame/);
    expect(ok(run("scene-farm", { t: "480 min" })).text).toMatch(/Render time per frame: 480 min = 28800 s|Render time per frame: 480 min = 28,800 s/);
  });
  test("storage refusals: ratio below 1, zero efficiency, a DPX layout that does not exist", () => {
    refused(run("scene-storage", { comp: "0.5" }), /a ratio under 1 would mean the file grows/);
    refused(run("scene-storage", { eff: "0" }), /0 means nothing gets through/);
    refused(run("scene-storage", { depth: "int10dpx", ch: "2" }), /not a DPX layout/);
  });
  test("LOD refusals: inside the bounding sphere, out-of-order errors, a 180° camera", () => {
    refused(run("scene-lod", { d: "0.5 m" }), /inside the object's bounding sphere/);
    refused(run("scene-lod", { lods: "A, 2 mm, 100\nB, 1 mm, 50" }), /B's error .* is not larger than A's/);
    refused(run("scene-lod", { fov: "180°" }), /outside the 0° to 180°/);
    expect(ok(run("scene-lod", { fov: "1.0472 rad" })).text).toMatch(/Field of view: 1\.0472 rad = 60\.0001 °|Field of view: 1\.0472 rad = 60\.0001°/);
  });
  test("an overloaded pipeline has no steady-state lead time", () => {
    const o = ok(run("scene-pipeline", { every: "2 h" }));
    expect(reading(o)).toMatch(/backlog grows/);
    expect(o.text).toMatch(/no lead time is given/);
    expect((o.outputs ?? []).some((e) => e.key === "lead")).toBe(false);
    refused(run("scene-pipeline", { stages: "Layout, 2 h, 0" }), /a stage with nobody on it never finishes anything/);
    refused(run("scene-pipeline", { stages: "Layout, 2 kg, 1" }), /Stages, line 1, time/);
  });
  test("a WIP below the touch-time floor is questioned", () => {
    expect(ok(run("scene-pipeline", { wip: "1" })).text).toMatch(/below the touch time/);
  });
  test("engines are bounded and pure", () => {
    expect(pipeline([{ name: "a", hoursPerItem: 1, workers: 1 }], null).throughput).toBe(1);
    expect(screenSize(1, 10, Math.PI / 2, 1000).radiusPx).toBeCloseTo(50, 12);
    expect(lodBands([{ name: "a", error: 0.01, triangles: 10 }], 1000, 1)[0].switchDistance).toBe(10);
    expect(catmullClarkCounts(8, 12, 6, 24, 12, 0).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Work is bounded: every calculator at its own input caps finishes well inside the 2.5 s figure re-render budget
// (a calculation that runs away freezes Word), and the figures stay a reasonable size.
// ---------------------------------------------------------------------------------------------------------------

describe("work is bounded at the input caps", () => {
  const grid = (n: number): string => {
    const L: string[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) L.push(`v ${i} ${j} ${Math.sin(i / 7) * Math.cos(j / 5)}`);
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) {
      const a = i * n + j + 1;
      L.push(`f ${a} ${a + n} ${a + n + 1} ${a + 1}`);
    }
    return L.join("\n");
  };
  const soup = (m: number): string => {
    const L: string[] = [];
    for (let k = 0; k < m; k++) L.push(`v ${k} 0 0`, `v ${k} 1 0`, `v ${k} 0 1`);
    for (let k = 0; k < m; k++) L.push(`f ${3 * k + 1} ${3 * k + 2} ${3 * k + 3}`);
    return L.join("\n");
  };
  let seed = 1;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const times = Array.from({ length: 10000 }, () => `${(1 + rnd() * 10).toFixed(3)} h`).join("\n");
  const cases: Array<[string, string, Record<string, string>]> = [
    ["degree-20 Bézier", "scene-bezier", { pts: Array.from({ length: 21 }, (_, i) => `${i}, ${Math.sin(i) * 5}, ${Math.cos(i)}`).join("\n"), t: "0.37" }],
    ["200-point degree-10 NURBS, knot inserted 9 times", "scene-nurbs", { deg: "10", pts: Array.from({ length: 200 }, (_, i) => `${i}, ${Math.sin(i / 3) * 5}`).join("\n"), w: "", U: "", u: "0.5", ins: "0.501", times: "9" }],
    ["19,600-quad grid mesh", "scene-mesh", { obj: grid(141) }],
    ["6,666-triangle soup (every edge a boundary)", "scene-mesh", { obj: soup(6666) }],
    ["9,801-quad grid, 10 levels", "scene-subdiv", { obj: grid(100), levels: "10", budget: "" }],
    ["5,000 points and the SAH sweep", "scene-bvol", { pts: Array.from({ length: 5000 }, () => `${rnd() * 10}, ${rnd() * 3}, ${rnd()}`).join("\n"), pos: "5" }],
    ["10,000 frame times, impossible deadline", "scene-farm", { times, deadline: "30 min" }],
    ["10,000 frame times, tight deadline", "scene-farm", { times, deadline: "12 h", nodes: "50" }],
    ["100,000 equal frames", "scene-farm", { frames: "100000", deadline: "1 h" }],
    ["65,536² ASTC 12×12", "scene-texture", { w: "65536", h: "65536", fmt: "astc12x12" }],
  ];
  test.each(cases)("%s", (_name, id, over) => {
    const t0 = Date.now();
    const o = ok(run(id, over));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2500);
    const svgBytes = (o.blocks ?? []).reduce((s, b) => s + (b.kind === "plot" ? b.svg.length : 0), 0);
    expect(svgBytes).toBeLessThan(1_500_000);
  });
  test("the problem-edge cap is said in the key", () => {
    const o = ok(run("scene-mesh", { obj: soup(600) }));
    const svg = (o.blocks ?? []).find((b) => b.kind === "plot");
    expect(svg && svg.kind === "plot" && svg.svg).toMatch(/problem edges: first 1,500 of each kind/);
  });
});
