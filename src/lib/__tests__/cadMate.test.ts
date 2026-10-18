// Mates (the table release): click a face of the part to move, then the face it goes against.
// The table case: a top mated onto four legs, corner to corner — flush, and no overlap or crossing
// line along any joint (a mate makes faces exactly coincident; float dust must not show).
import { tessellate, rotationMatrix, Mesh, Vec3 } from "../cadModel";
import { CadDoc, CadPart, defaultParams, docToAssembly, overlapNotes, SHAPES } from "../cadShapes";
import { eulerFromMatrix, faceAt, mate } from "../cadMate";

const part = (id: string, shape: CadPart["shape"], params: Record<string, number>, translate: Vec3 = [0, 0, 0], rotateDeg: Vec3 = [0, 0, 0]): CadPart => ({
  id,
  name: id,
  shape,
  params: { ...defaultParams(shape as "box"), ...params },
  placement: { translate, rotateDeg },
});
const docOf = (parts: CadPart[]): CadDoc => ({ v: 1, parts, callouts: [], standard: "uspto", views: [{ kind: "iso" }] });
const meshOf = (d: CadDoc): Mesh => {
  const a = docToAssembly(d);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
};
/** The triangle of body `b` whose face has normal `n` and contains world point `p`. */
function triAt(mesh: Mesh, b: number, n: Vec3, p: Vec3): number {
  const P = mesh.positions, T = mesh.triangles;
  for (let t = 0; t < T.length / 3; t++) {
    if (mesh.triBody[t] !== b) continue;
    const v = [0, 1, 2].map((k) => [P[3 * T[3 * t + k]], P[3 * T[3 * t + k] + 1], P[3 * T[3 * t + k] + 2]]);
    const e1 = v[1].map((x, i) => x - v[0][i]), e2 = v[2].map((x, i) => x - v[0][i]);
    const m = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ml = Math.hypot(m[0], m[1], m[2]);
    if (Math.abs(Math.abs(m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) / ml - 1) > 1e-9) continue;
    // Barycentric inside test in the face plane.
    const w = p.map((x, i) => x - v[0][i]);
    const d00 = e1[0] ** 2 + e1[1] ** 2 + e1[2] ** 2, d01 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], d11 = e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2;
    const d20 = w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2], d21 = w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2];
    const den = d00 * d11 - d01 * d01;
    const s = (d11 * d20 - d01 * d21) / den, u = (d00 * d21 - d01 * d20) / den;
    const off = Math.abs(w[0] * m[0] + w[1] * m[1] + w[2] * m[2]) / ml;
    if (s >= -1e-9 && u >= -1e-9 && s + u <= 1 + 1e-9 && off < 1e-6) return t;
  }
  throw new Error("no triangle there");
}
const hit = (mesh: Mesh, b: number, n: Vec3, p: Vec3, snap = 0) => {
  const r = faceAt(mesh, triAt(mesh, b, n, p), p, snap);
  if (!r.ok) throw new Error(r.reason);
  return r.hit;
};

describe("degrees from a rotation", () => {
  test("round trip over a grid of angles, including the gimbal-locked ±90° about Y", () => {
    for (const ax of [-170, -90, -30, 0, 45, 90, 180])
      for (const ay of [-90, -60, 0, 30, 90])
        for (const az of [-120, 0, 15, 90]) {
          const R = rotationMatrix([ax, ay, az]);
          const back = rotationMatrix(eulerFromMatrix(R));
          for (let i = 0; i < 9; i++) expect(back[i]).toBeCloseTo(R[i], 9);
        }
  });
  test("whole degrees come back whole, and never −0", () => {
    expect(eulerFromMatrix(rotationMatrix([90, 0, 0]))).toEqual([90, 0, 0]);
    expect(eulerFromMatrix(rotationMatrix([0, 0, 0]))).toEqual([0, 0, 0]);
    expect(eulerFromMatrix(rotationMatrix([180, 0, 0])).map((d) => Object.is(d, -0))).toEqual([false, false, false]);
  });
});

describe("faces", () => {
  test("a flat face: its outward normal; a click near a corner snaps to it, near the centre to the centre", () => {
    const m = meshOf(docOf([part("a", "box", { w: 40, d: 30, h: 20 })]));
    const top = hit(m, 0, [0, 0, 1], [38, 28, 20], 3);
    expect(top.normal.map((x) => Math.round(x))).toEqual([0, 0, 1]);
    expect([top.snap, top.point]).toEqual(["corner", [40, 30, 20]]);
    const mid = hit(m, 0, [0, 0, 1], [19, 16, 20], 3);
    expect(mid.snap).toBe("centre");
    expect(mid.point.map((x) => +x.toFixed(9))).toEqual([20, 15, 20]);
    expect(hit(m, 0, [0, 0, 1], [10, 10, 20], 1).snap).toBe("none");
    const bottom = hit(m, 0, [0, 0, -1], [10, 10, 0]);
    expect(bottom.normal.map((x) => Math.round(x))).toEqual([0, 0, -1]);
  });
  test("a curved surface is refused by name", () => {
    const m = meshOf(docOf([part("c", "cylinder", { dia: 20, h: 40 })]));
    // A side triangle: its corner normals differ.
    let side = -1;
    for (let t = 0; t < m.triangles.length / 3 && side < 0; t++) if (Math.abs(m.cornerNormals[9 * t + 2]) < 0.5) side = t;
    const P = m.positions, i = m.triangles[3 * side];
    expect(faceAt(m, side, [P[3 * i], P[3 * i + 1], P[3 * i + 2]], 0)).toEqual({ ok: false, reason: "that is a curved surface — a mate needs a flat face (a side, top or end of a part)" });
  });
});

describe("the table", () => {
  // A 100 × 60 × 4 top and four 5 × 5 × 70 legs, laid out side by side as parts are added.
  const TOP = { w: 100, d: 60, h: 4 }, LEG = { w: 5, d: 5, h: 70 };
  test("each leg's top face mated to the underside of the top, corner to corner: flush, no overlap, no crossing line", () => {
    const d = docOf([
      part("top", "box", TOP, [0, 0, 0]),
      part("leg1", "box", LEG, [150, 0, 0]),
      part("leg2", "box", LEG, [170, 0, 0]),
      part("leg3", "box", LEG, [190, 0, 0]),
      part("leg4", "box", LEG, [210, 0, 0]),
    ]);
    const corners: Array<[Vec3, Vec3]> = [
      // [leg top corner (in the leg's own frame), top underside corner]
      [[0, 0, 70], [0, 0, 0]],
      [[5, 0, 70], [100, 0, 0]],
      [[5, 5, 70], [100, 60, 0]],
      [[0, 5, 70], [0, 60, 0]],
    ];
    corners.forEach(([legCorner, topCorner], k) => {
      const m = meshOf(d);
      const leg = d.parts[k + 1];
      const p: Vec3 = [legCorner[0] + leg.placement.translate[0], legCorner[1], legCorner[2]];
      // Clicks a little inside each face, snapped to the corners.
      const inward = (q: Vec3, c: Vec3): Vec3 => q.map((x, i) => x + Math.sign(c[i] - x) * 0.4) as Vec3;
      const mv = hit(m, k + 1, [0, 0, 1], inward(p, [leg.placement.translate[0] + 2.5, 2.5, 70]), 1);
      const tg = hit(m, 0, [0, 0, -1], inward(topCorner, [50, 30, 0]), 1);
      expect([mv.snap, tg.snap]).toEqual(["corner", "corner"]);
      // The leg's top faces up and the underside down: already opposite, so the leg only moves.
      const r = mate(mv, tg, leg.placement);
      if (!r.ok) throw new Error(r.reason);
      leg.placement = r.placement;
    });
    // Legs hang below the top, each flush at a corner, inside the top's outline.
    expect(d.parts.slice(1).map((p) => p.placement)).toEqual([
      { translate: [0, 0, -70], rotateDeg: [0, 0, 0] },
      { translate: [95, 0, -70], rotateDeg: [0, 0, 0] },
      { translate: [95, 55, -70], rotateDeg: [0, 0, 0] },
      { translate: [0, 55, -70], rotateDeg: [0, 0, 0] },
    ]);
    const m = meshOf(d);
    expect(overlapNotes(d, m)).toEqual([]);
    expect(m.crossings).toHaveLength(0);
  });
  test("a leg lying on its side is turned upright to mate (its end face onto the underside)", () => {
    const d = docOf([part("top", "box", TOP), part("leg", "box", LEG, [150, 0, 0], [0, 90, 0])]);
    const m = meshOf(d);
    // Turned 90° about Y, the leg's top end (local +Z) faces +X.
    const R = rotationMatrix([0, 90, 0]);
    const end: Vec3 = [R[2] * 70 + 150 + R[0] * 2.5 + R[1] * 2.5, R[5] * 70 + R[3] * 2.5 + R[4] * 2.5, R[8] * 70 + R[6] * 2.5 + R[7] * 2.5];
    const mv = hit(m, 1, [1, 0, 0], end, 1);
    expect(mv.normal.map((x) => Math.round(x))).toEqual([1, 0, 0]);
    const tg = hit(m, 0, [0, 0, -1], [50, 30, 0], 1);
    const r = mate(mv, tg, d.parts[1].placement);
    if (!r.ok) throw new Error(r.reason);
    d.parts[1].placement = r.placement;
    const m2 = meshOf(d);
    // Now upright, hanging from the centre of the underside, flush.
    let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < m2.triangles.length; t++) {
      const i = m2.triangles[t];
      if (m2.triBody[Math.floor(t / 3)] !== 1) continue;
      for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], m2.positions[3 * i + k])), (hi[k] = Math.max(hi[k], m2.positions[3 * i + k]));
    }
    expect([hi[2], lo[2]].map((x) => +x.toFixed(6))).toEqual([0, -70]);
    expect([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2].map((x) => +x.toFixed(6))).toEqual([50, 30]);
    expect(overlapNotes(d, m2)).toEqual([]);
  });
  test("two faces of one part are refused by name", () => {
    const m = meshOf(docOf([part("top", "box", TOP)]));
    const a = hit(m, 0, [0, 0, 1], [10, 10, 4]), b = hit(m, 0, [0, 0, -1], [10, 10, 0]);
    expect(mate(a, b, { translate: [0, 0, 0], rotateDeg: [0, 0, 0] })).toEqual({ ok: false, reason: "both faces are on the same part — click a face of the part to move, then a face of the part it goes against" });
  });
  test("a part with a shape frame (the L-bracket), turned oddly, mates any flat face flush onto the top", () => {
    expect(SHAPES.bracket.frame).toBeDefined();
    const d = docOf([part("top", "box", TOP), part("br", "bracket", {}, [200, 10, 5], [20, -35, 50])]);
    const m = meshOf(d);
    // Every flat face of the bracket, one at a time: the face's centre goes to the top's centre, flush.
    const tg = hit(m, 0, [0, 0, 1], [50, 30, 4], 1);
    let tried = 0;
    for (let t = 0; t < m.triangles.length / 3 && tried < 6; t++) {
      if (m.triBody[t] !== 1) continue;
      const P = m.positions, T = m.triangles;
      const c = [0, 1, 2].map((k) => [0, 1, 2].reduce((a, j) => a + P[3 * T[3 * t + j] + k] / 3, 0)) as Vec3;
      const f = faceAt(m, t, c, 0);
      if (!f.ok) continue;
      tried++;
      const r = mate(f.hit, tg, d.parts[1].placement, SHAPES.bracket.frame);
      if (!r.ok) throw new Error(r.reason);
      const d2 = docOf([d.parts[0], { ...d.parts[1], placement: r.placement }]);
      const m2 = meshOf(d2);
      // The mated face now lies in the top's top plane (z = 4), facing down, over the top's centre.
      // (An inner face of the L has the other arm beyond it, so the part may pass into the top: real.)
      const back = faceAt(m2, triAt(m2, 1, [0, 0, -1], [50, 30, 4]), [50, 30, 4], 0);
      expect(back.ok && back.hit.normal.map((x) => +x.toFixed(9) + 0)).toEqual([0, 0, -1]);
    }
    expect(tried).toBe(6);
  });
});
