// STEP and IGES import (docs/SCOPE-STEP-IMPORT.md) against the REAL reader: occt-import-js runs in a child process
// (fixtures/occtRun.js — 190 MB and 7.6 MB of WebAssembly, kept out of the jest worker), on STEP files written by
// fixtures/stepFixture.ts. Small solids only (QC memory).
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { stepFile, type FixtureSolid } from "./fixtures/stepFixture";
import { STEP_LIMITS, stepBodies, stepFormat, stepPartNames, type OcctResult } from "../step";
import { stlBody, type StlFacets } from "../stl";
import { hasMeshFile, isMeshRef, meshFor, meshKey, rememberStep, type MeshRef } from "../cadMeshStore";
import { STEP_ENGINE_DIR } from "../../taskpane/stepEngine";

const RUN = path.join(__dirname, "fixtures", "occtRun.js");
function read(text: string, format: "step" | "iges" = "step"): OcctResult {
  return JSON.parse(execFileSync(process.execPath, [RUN], { input: JSON.stringify({ format, base64: Buffer.from(text).toString("base64") }), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));
}
const bounds = (f: StlFacets): number[] => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < f.corners.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], f.corners[i]);
    hi[i % 3] = Math.max(hi[i % 3], f.corners[i]);
  }
  return [...lo, ...hi].map((x) => +x.toFixed(3) + 0);
};

const ASSEMBLY: FixtureSolid[] = [
  { name: "plate", kind: "box", at: [0, 0, 0], size: [60, 40, 5] },
  { name: "pin", kind: "cylinder", at: [15, 20, 5], r: 4, h: 20 },
  { name: "pin", kind: "cylinder", at: [45, 20, 5], r: 4, h: 20 },
];

describe("the real reader: bodies, names, units", () => {
  const asm = stepBodies(read(stepFile(ASSEMBLY)));
  test("an assembly gives one body per solid, named from the file, each where the file puts it", () => {
    expect(asm.ok).toBe(true);
    if (!asm.ok) return;
    expect(asm.bodies.map((b) => b.name)).toEqual(["plate", "pin", "pin"]);
    expect(stepPartNames(asm.bodies, "rig.step")).toEqual(["plate", "pin 1", "pin 2"]);
    expect(bounds(asm.bodies[0].facets)).toEqual([0, 0, 0, 60, 40, 5]);
    const pin2 = bounds(asm.bodies[2].facets);
    expect(pin2[0]).toBeCloseTo(41, 3);
    expect(pin2[2]).toBeCloseTo(5, 6);
    expect(pin2[5]).toBeCloseTo(25, 6);
  });
  test.each([
    ["millimetres", "mm" as const, [40, 30, 20]],
    ["inches", "inch" as const, [25.4, 50.8, 76.2]],
    ["metres", "m" as const, [1000, 2000, 3000]],
  ])("a file in %s is read in millimetres, as the file says", (_u, unit, size) => {
    const s = unit === "mm" ? [40, 30, 20] : [1, 2, 3];
    const r = stepBodies(read(stepFile([{ name: "block", kind: "box", at: [0, 0, 0], size: s as [number, number, number] }], unit)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(bounds(r.bodies[0].facets).slice(3)).toEqual(size);
  });
  test("a cylinder is drawn with its two circles only — no facet lines, no seam (the model's faces, not an angle)", () => {
    if (!asm.ok) throw new Error("no assembly");
    const b = stlBody(asm.bodies[1].facets, 1, 30);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.body.mesh.closed).toBe(true);
    const P = b.body.mesh.positions, E = b.body.mesh.edges;
    // Every edge lies on the bottom or the top circle (z = 0 or 20 once moved to the origin).
    for (let i = 0; i < E.length; i += 2) {
      const za = P[3 * E[i] + 2], zb = P[3 * E[i + 1] + 2];
      expect(za).toBeCloseTo(zb, 9);
      expect([0, 20].some((z) => Math.abs(za - z) < 1e-9)).toBe(true);
    }
    // The same facets read as an STL at a 1° edge angle would draw a line between every pair of side facets.
    const plain = stlBody({ ...asm.bodies[1].facets, faceOf: undefined }, 1, 1);
    expect(plain.ok && plain.body.mesh.edges.length).toBeGreaterThan(E.length);
  });
  test("a file that is not STEP is refused by name; so is an answer with no solid", () => {
    expect(stepBodies(read("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"))).toEqual({ ok: false, reason: expect.stringMatching(/no solid bodies|could not be read/) });
    expect(stepBodies(read("this is not a step file"))).toMatchObject({ ok: false });
  });
});

describe("step.ts reads the answer field by field", () => {
  const tri = (faces?: unknown): OcctResult => ({
    success: true,
    meshes: [{ name: "a", attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, index: { array: [0, 1, 2] }, brep_faces: faces }],
  });
  test.each([
    ["a failed read", { success: false }],
    ["no meshes", { success: true }],
    ["an index past the vertices", { success: true, meshes: [{ attributes: { position: { array: [0, 0, 0] } }, index: { array: [0, 1, 2] } }] }],
    ["a NaN coordinate", { success: true, meshes: [{ attributes: { position: { array: [0, 0, NaN, 1, 0, 0, 0, 1, 0] } }, index: { array: [0, 1, 2] } }] }],
    ["positions not in threes", { success: true, meshes: [{ attributes: { position: { array: [0, 0] } }, index: { array: [0, 1, 2] } }] }],
  ])("%s is refused", (_why, r) => {
    expect(stepBodies(r as OcctResult).ok).toBe(false);
  });
  test("damaged face ranges leave the faces out (the body is drawn by edge angle), never a wrong face", () => {
    for (const faces of [[{ first: 0, last: 5 }], [{ first: 1, last: 0 }], "x", []]) {
      const r = stepBodies(tri(faces));
      expect(r.ok && r.bodies[0].facets.faceOf).toBeUndefined();
    }
    const good = stepBodies(tri([{ first: 0, last: 0 }]));
    expect(good.ok && Array.from(good.bodies[0].facets.faceOf!)).toEqual([0]);
  });
  test("a body with no triangles (a curve) is left out and said; too many bodies or facets is refused by name", () => {
    const withCurve: OcctResult = { success: true, meshes: [...(tri([]).meshes as object[]), { name: "curve", attributes: { position: { array: [] } }, index: { array: [] } }] };
    const r = stepBodies(withCurve);
    expect(r.ok && r.notes).toEqual(["1 item with no surface (curves or points) was left out."]);
    const many: OcctResult = { success: true, meshes: Array.from({ length: STEP_LIMITS.bodies + 1 }, () => (tri([]).meshes as object[])[0]) };
    expect(stepBodies(many)).toEqual({ ok: false, reason: expect.stringMatching(/more than 200 solid bodies/) });
  });
  test("file names: .stp .step → STEP, .igs .iges → IGES, others not", () => {
    expect(["a.stp", "a.STEP", "a.igs", "a.IGES", "a.stl", "a.dxf"].map(stepFormat)).toEqual(["step", "step", "iges", "iges", null, null]);
  });
  test("a body with no name, or the exporter's '(Unsaved)', is named after the file", () => {
    const b = (name: string) => ({ name, facets: {} as StlFacets });
    expect(stepPartNames([b(""), b("(Unsaved)"), b("rod")], "bracket.stp")).toEqual(["bracket 1", "bracket 2", "rod"]);
    // Never two parts alike, even when a body's own name looks like a number given to another.
    expect(stepPartNames([b("nut"), b("nut"), b("nut 1")], "x.stp")).toEqual(["nut 2", "nut 3", "nut 1"]);
  });
});

describe("faces and tangent edges in stlBody (judged from the facets, not the engine's averaged normals)", () => {
  /** Facets from quads (each split into two triangles) with a face id per quad. */
  const quads = (qs: { q: number[][]; face: number }[]): StlFacets => {
    const c: number[] = [], f: number[] = [];
    for (const { q, face } of qs) {
      c.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
      f.push(face, face);
    }
    return { format: "binary", corners: Float64Array.from(c), count: c.length / 9, unreadable: 0, faceOf: Int32Array.from(f) };
  };
  const edgesWhere = (r: ReturnType<typeof stlBody>, test: (a: number[], b: number[]) => boolean): number => {
    if (!r.ok) throw new Error(r.reason);
    const P = r.body.mesh.positions, E = r.body.mesh.edges;
    let n = 0;
    for (let i = 0; i < E.length; i += 2) {
      const a = [P[3 * E[i]], P[3 * E[i] + 1], P[3 * E[i] + 2]], b = [P[3 * E[i + 1]], P[3 * E[i + 1] + 1], P[3 * E[i + 1] + 2]];
      if (test(a, b)) n++;
    }
    return n;
  };
  test("a cylinder written as two half-faces (as Parasolid writes it) has no line down either split, tangent edges or not", () => {
    const n = 24, r = 10, h = 10;
    const at = (k: number, z: number): number[] => [r * Math.cos((2 * Math.PI * (k % n)) / n), r * Math.sin((2 * Math.PI * (k % n)) / n), z];
    const side = Array.from({ length: n }, (_, k) => ({ q: [at(k, 0), at(k + 1, 0), at(k + 1, h), at(k, h)], face: k < n / 2 ? 0 : 1 }));
    const f = quads(side);
    const vertical = (a: number[], b: number[]): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    for (const tangentEdges of [false, true]) expect(edgesWhere(stlBody(f, 1, 30, { tangentEdges }), vertical)).toBe(0);
    // The same halves meeting at a real corner (one half turned 90° away) would be a crease: the rule is not "never".
  });
  test("a flat face running into a fillet and on into a wall: the two tangent lines only when asked for", () => {
    // Profile in x–z, extruded 0..5 in y: flat z = 0 for x −10..0, a quarter round of radius 5 about (0, 5) up to
    // (5, 5), then the wall x = 5 up to z = 15. Faces: flat 0, fillet 1, wall 2.
    const steps = 8, R = 5;
    const p = (x: number, z: number, y: number): number[] => [x, y, z];
    const qs: { q: number[][]; face: number }[] = [{ q: [p(-10, 0, 0), p(0, 0, 0), p(0, 0, 5), p(-10, 0, 5)], face: 0 }];
    for (let k = 0; k < steps; k++) {
      const a0 = -Math.PI / 2 + (k * Math.PI) / 2 / steps, a1 = -Math.PI / 2 + ((k + 1) * Math.PI) / 2 / steps;
      const x0 = k === 0 ? 0 : R * Math.cos(a0), z0 = k === 0 ? 0 : R + R * Math.sin(a0);
      const x1 = k === steps - 1 ? 5 : R * Math.cos(a1), z1 = k === steps - 1 ? 5 : R + R * Math.sin(a1);
      qs.push({ q: [p(x0, z0, 0), p(x1, z1, 0), p(x1, z1, 5), p(x0, z0, 5)], face: 1 });
    }
    qs.push({ q: [p(5, 5, 0), p(5, 15, 0), p(5, 15, 5), p(5, 5, 5)], face: 2 });
    const f = quads(qs);
    const along = (x: number, z: number) => (a: number[], b: number[]): boolean =>
      [a, b].every((v) => Math.abs(v[0] - x) < 1e-9 && Math.abs(v[2] - z) < 1e-9) && Math.abs(a[1] - b[1]) > 1;
    const lines = (tangentEdges: boolean): number[] => {
      const r = stlBody(f, 1, 30, { tangentEdges });
      return [edgesWhere(r, along(10, 0)), edgesWhere(r, along(15, 5))];
    };
    // stlBody moves the part so its lowest corner is the origin: x shifts by +10.
    expect(lines(false)).toEqual([0, 0]);
    expect(lines(true)).toEqual([1, 1]);
  });
  // Second review: solids of revolution, tessellated as OCCT does (n facets round), the faces decided per pair.
  /** A profile (r, z) revolved n times round the z axis; face(segment, k) gives each quad's face. */
  const revolve = (pts: [number, number][], n: number, face: (seg: number, k: number) => number): StlFacets => {
    const at = (r: number, z: number, k: number): number[] => [r * Math.cos((2 * Math.PI * (k % n)) / n), r * Math.sin((2 * Math.PI * (k % n)) / n), z];
    const qs: { q: number[][]; face: number }[] = [];
    for (let s = 0; s + 1 < pts.length; s++)
      for (let k = 0; k < n; k++) {
        const [r0, z0] = pts[s], [r1, z1] = pts[s + 1];
        qs.push({ q: [at(r0, z0, k), at(r0, z0, k + 1), at(r1, z1, k + 1), at(r1, z1, k)], face: face(s, k) });
      }
    return quads(qs);
  };
  /** Edges lying on the circle of radius r at height z (the part is moved so its lowest corner is the origin). */
  const onCircle = (rMax: number, zMin: number, r: number, z: number) => (a: number[], b: number[]): boolean =>
    [a, b].every((v) => Math.abs(Math.hypot(v[0] - rMax, v[1] - rMax) - r) < 1e-6 && Math.abs(v[2] - zMin - z) < 1e-6);
  test.each([7.5, 15, 45])("a cylinder meeting a cone at %s° is a whole circle, never a dashed one", (deg) => {
    const n = 68, r2 = 10 + 10 * Math.tan((deg * Math.PI) / 180);
    const f = revolve([[10, 0], [10, 10], [r2, 20]], n, (s) => s);
    for (const tangentEdges of [false, true]) expect(edgesWhere(stlBody(f, 1, 30, { tangentEdges }), onCircle(r2, 0, 10, 10))).toBe(n);
  });
  test("a fillet running into a cylinder (a filleted shoulder): both of its tangent circles, whole, only when asked for", () => {
    const n = 68, rf = 5, steps = 8;
    const pts: [number, number][] = [[20, 0], [10 + rf, 0]];
    for (let k = 1; k < steps; k++) {
      const a = -Math.PI / 2 - (k * Math.PI) / 2 / steps;
      pts.push([10 + rf + rf * Math.cos(a), rf + rf * Math.sin(a)]);
    }
    pts.push([10, rf], [10, 20]);
    const f = revolve(pts, n, (s) => (s === 0 ? 0 : s <= steps ? 1 : 2));
    const count2 = (tangentEdges: boolean): number[] => {
      const r = stlBody(f, 1, 30, { tangentEdges });
      return [edgesWhere(r, onCircle(20, 0, 10 + rf, 0)), edgesWhere(r, onCircle(20, 0, 10, rf))];
    };
    expect(count2(false)).toEqual([0, 0]);
    expect(count2(true)).toEqual([n, n]);
  });
  test("a revolved part written in halves — side and caps split — has no line down a split, tangent edges or not", () => {
    const n = 48;
    const f = revolve([[0.001, 0], [10, 0], [10, 10], [0.001, 10]], n, (s, k) => 2 * s + (k < n / 2 ? 0 : 1));
    const radial = (a: number[], b: number[]): boolean => Math.abs(Math.atan2(a[1] - 10, a[0] - 10) - Math.atan2(b[1] - 10, b[0] - 10)) < 1e-6;
    for (const tangentEdges of [false, true]) {
      const r = stlBody(f, 1, 30, { tangentEdges });
      expect(edgesWhere(r, radial)).toBe(0);
      expect(edgesWhere(r, onCircle(10, 0, 10, 0)) + edgesWhere(r, onCircle(10, 0, 10, 10))).toBe(2 * n);
    }
  });
  // Third review: coarse circles, a fan to a point, and one pair of faces meeting two ways.
  test("a 10° taper on a coarse 12-facet hole is drawn whole (the bend round the circle is not counted across it)", () => {
    const n = 12, r2 = 5 + 10 * Math.tan((10 * Math.PI) / 180);
    const f = revolve([[5, 0], [5, 10], [r2, 20]], n, (s) => s);
    for (const tangentEdges of [false, true]) expect(edgesWhere(stlBody(f, 1, 30, { tangentEdges }), onCircle(r2, 0, 5, 10))).toBe(n);
  });
  test.each([15, 31, 59])("a drill point — one fan of facets to its tip — meets its hole at a %s° crease, drawn whole", (deg) => {
    const n = 24, r = 5, dz = r / Math.tan((deg * Math.PI) / 180);
    const f = revolve([[r, 0], [r, 10], [0, 10 + dz]], n, (s) => s);
    for (const tangentEdges of [false, true]) expect(edgesWhere(stlBody(f, 1, 30, { tangentEdges }), onCircle(r, 0, r, 10))).toBe(n);
  });
  test("one pair of faces meeting tangentially along one line and at a crease along another: each decided on its own", () => {
    // Face 1 in two pieces (a flat at z = 0 for x 0..10, and a flat at z = 5 for x 15..25); face 0 a quarter round of
    // radius 5 about (10, 5) joining them — tangent at x = 10, a 90° crease at x = 15. Extruded 0..8 in y, 4 sides each.
    const steps = 8, R = 5;
    const p = (x: number, z: number, y: number): number[] => [x, y, z];
    const qs: { q: number[][]; face: number }[] = [];
    for (let j = 0; j < 4; j++) {
      const y0 = 2 * j, y1 = 2 * j + 2;
      qs.push({ q: [p(0, 0, y0), p(10, 0, y0), p(10, 0, y1), p(0, 0, y1)], face: 1 });
      for (let k = 0; k < steps; k++) {
        const a0 = -Math.PI / 2 + (k * Math.PI) / 2 / steps, a1 = -Math.PI / 2 + ((k + 1) * Math.PI) / 2 / steps;
        const x0 = k === 0 ? 10 : 10 + R * Math.cos(a0), z0 = k === 0 ? 0 : R + R * Math.sin(a0);
        const x1 = k === steps - 1 ? 15 : 10 + R * Math.cos(a1), z1 = k === steps - 1 ? 5 : R + R * Math.sin(a1);
        qs.push({ q: [p(x0, z0, y0), p(x1, z1, y0), p(x1, z1, y1), p(x0, z0, y1)], face: 0 });
      }
      qs.push({ q: [p(15, 5, y0), p(25, 5, y0), p(25, 5, y1), p(15, 5, y1)], face: 1 });
    }
    const f = quads(qs);
    const line = (x: number, z: number) => (a: number[], b: number[]): boolean => [a, b].every((v) => Math.abs(v[0] - x) < 1e-9 && Math.abs(v[2] - z) < 1e-9);
    const both = (tangentEdges: boolean): number[] => {
      const r = stlBody(f, 1, 30, { tangentEdges });
      return [edgesWhere(r, line(10, 0)), edgesWhere(r, line(15, 5))];
    };
    expect(both(false)).toEqual([0, 4]);
    expect(both(true)).toEqual([4, 4]);
  });
  test("two flat faces meeting at a corner are an edge either way; a face's inside never is", () => {
    const f = quads([
      { q: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], face: 0 },
      { q: [[10, 0, 0], [10, 0, 10], [10, 10, 10], [10, 10, 0]], face: 1 },
    ]);
    const corner = (a: number[], b: number[]): boolean => a[0] === 10 && b[0] === 10 && a[2] === 0 && b[2] === 0;
    for (const tangentEdges of [false, true]) {
      const r = stlBody(f, 1, 30, { tangentEdges });
      expect(edgesWhere(r, corner)).toBe(1);
      // No diagonal inside either square.
      expect(edgesWhere(r, (a, b) => a[0] !== b[0] && a[1] !== b[1])).toBe(0);
    }
  });
});

describe("a STEP file's bodies in the store, and in a saved drawing", () => {
  const asm = stepBodies(read(stepFile(ASSEMBLY)));
  const ref = (body: number, tangent = true): MeshRef => ({ file: "rig.step", hash: "0123456789abcdef-77", body, facets: 12, mmPerUnit: 1, creaseDeg: 30, size: [1, 1, 1], tangent });
  test("each body is its own part: its own facets, its own key; the tangent choice is in the key", () => {
    if (!asm.ok) throw new Error("no assembly");
    expect(hasMeshFile(ref(0))).toBe(false);
    rememberStep("0123456789abcdef-77", asm.bodies.map((b) => b.facets));
    expect([0, 1, 2].map((k) => hasMeshFile(ref(k)))).toEqual([true, true, true]);
    expect(hasMeshFile(ref(3))).toBe(false);
    const a = meshFor(ref(0)), b = meshFor(ref(1));
    expect(a.ok && b.ok && a.mesh !== b.mesh).toBe(true);
    expect(a.ok && a.mesh.positions.length).toBe(72); // a box: 24 corners (split per face for shading)
    expect(new Set([meshKey(ref(0)), meshKey(ref(1)), meshKey(ref(1, false))]).size).toBe(3);
  });
  test("a missing body names the file to import", () => {
    expect(meshFor({ ...ref(0), hash: "00000000000000ff-1" })).toEqual({ ok: false, reason: "its file rig.step is not open — import rig.step again (Import DXF / STL / OBJ / STEP…) to put it back" });
  });
  test.each([
    ["a body index", { body: 0 }, true],
    ["a body with its tangent choice", { body: 3, tangent: false }, true],
    ["a negative body", { body: -1 }, false],
    ["a fractional body", { body: 1.5 }, false],
    ["a body past the limit", { body: 200 }, false],
    ["a tangent choice on an STL", { tangent: true }, false],
    ["a tangent choice that is not a boolean", { body: 0, tangent: "yes" }, false],
  ])("a saved part record with %s is %s", (_why, extra, ok) => {
    expect(isMeshRef({ file: "rig.step", hash: "0123456789abcdef-77", facets: 12, mmPerUnit: 1, creaseDeg: 30, size: [1, 1, 1], ...extra })).toBe(ok);
  });
  test("the store's body limit is the importer's", () => {
    expect(isMeshRef({ file: "a", hash: "0123456789abcdef-1", facets: 1, mmPerUnit: 1, creaseDeg: 30, size: [1, 1, 1], body: STEP_LIMITS.bodies - 1 })).toBe(true);
  });
});

test("the engine folder names the installed occt-import-js version (a new engine is a new URL)", () => {
  const v = JSON.parse(fs.readFileSync(require.resolve("occt-import-js/package.json"), "utf8")).version;
  expect(STEP_ENGINE_DIR).toBe(`engines/occt-${v}/`);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"));
  expect(pkg.dependencies["occt-import-js"]).toBe(v);
  const wp = fs.readFileSync(path.join(__dirname, "..", "..", "..", "webpack.config.js"), "utf8");
  expect(wp).toContain(`engines/occt-${v}/`);
});
