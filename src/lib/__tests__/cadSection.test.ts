// Section views (cadSection.ts): the plane, the view, the cut, its caps and its hatching — 37 CFR 1.84(h)(3).
import { Assembly, Body, BodySpec, box, cone, cylinder, IDENTITY_PLACEMENT, Mesh, Placement, tessellate, tube } from "../cadModel";
import { drawLines, lineBudget, STANDARD_VIEWS } from "../cadLines";
import { cutMesh, hatchRegions, HATCH_STYLES, sectionPlane, sectionView, CutRegion } from "../cadSection";

let seq = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++seq}`, name: `b${seq}`, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
const front = STANDARD_VIEWS.front;
const areaOf = (r: CutRegion): number => {
  const a = (p: Array<[number, number]>): number => {
    let s = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
    return s / 2;
  };
  return a(r.outer) - r.holes.reduce((s, h) => s + Math.abs(a(h)), 0);
};

describe("sectionPlane and sectionView", () => {
  it("a vertical line on the front view: the plane x = 20, looking along +X, the part standing upright", () => {
    const pl = sectionPlane(front, [20, -5], [20, 15])!;
    expect(pl.sight.map((v) => +v.toFixed(12))).toEqual([1, 0, 0]);
    expect(pl.point[0]).toBeCloseTo(20, 12);
    const v = sectionView(front, pl, "A");
    // Looking along +X: toward-eye is −X, up stays world +Z.
    expect(v.rot.slice(6).map((x) => +x.toFixed(12))).toEqual([-1, 0, 0]);
    expect(v.rot.slice(3, 6).map((x) => +x.toFixed(12))).toEqual([0, 0, 1]);
  });

  it("flip looks the other way", () => {
    const pl = sectionPlane(front, [20, -5], [20, 15], true)!;
    expect(pl.sight.map((v) => +v.toFixed(12))).toEqual([-1, 0, 0]);
  });

  it("a horizontal line on the front view looks down, and reads like the top view", () => {
    const pl = sectionPlane(front, [-5, 5], [45, 5])!;
    expect(pl.sight.map((v) => +v.toFixed(12))).toEqual([0, 0, -1]);
    const v = sectionView(front, pl, "A");
    expect(v.rot.map((x) => +x.toFixed(12))).toEqual(STANDARD_VIEWS.top.rot.map((x) => +x.toFixed(12)));
  });

  it("a line of no length is no plane", () => {
    expect(sectionPlane(front, [3, 3], [3, 3])).toBeNull();
  });
});

describe("cutMesh", () => {
  it("a box cut through its middle: one rectangular cut face of exact area, the near half gone", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const pl = sectionPlane(front, [20, -5], [20, 15])!;
    const v = sectionView(front, pl, "A");
    const r = cutMesh(m, pl, v, lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(1);
    expect(areaOf(r.regions[0])).toBeCloseTo(20 * 10, 9);
    // Nothing is left on the viewer's side.
    for (let i = 0; i < r.mesh.positions.length; i += 3) expect(r.mesh.positions[i]).toBeGreaterThanOrEqual(20 - 1e-9);
  });

  it("a tube cut along its axis: two cut faces, each a rectangle, nothing in the bore", () => {
    const m = meshOf(body(tube(10, 6, 30)));
    // The front view's vertical line through the axis (x = 0).
    const pl = sectionPlane(front, [0, -5], [0, 35])!;
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(2);
    // 4 × 30 within the flattening of the circles (the cut runs through their facets).
    for (const reg of r.regions) expect(areaOf(reg) / (4 * 30)).toBeCloseTo(1, 2);
  });

  it("a tube cut across its axis: one annulus — a hole in the cut face", () => {
    const m = meshOf(body(tube(10, 6, 30)));
    const pl = sectionPlane(front, [-15, 12], [15, 12])!;
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].holes).toHaveLength(1);
    // π(10² − 6²) within the flattening of the circles.
    expect(areaOf(r.regions[0]) / (Math.PI * 64)).toBeCloseTo(1, 2);
  });

  it("a plane along a face cuts nothing (no slivers, no refusal)", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const pl = sectionPlane(front, [0, -5], [0, 15])!; // x = 0, looking +X: the whole box is beyond it
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(0);
    expect(r.mesh.triangles.length).toBe(m.triangles.length);
  });

  it("an open surface where the plane cuts it is refused by name", () => {
    const m = meshOf(body(box(40, 20, 10)));
    // Take the box's top and bottom away: an open sleeve.
    const keep: number[] = [], kn: number[] = [], kb: number[] = [];
    for (let t = 0; t < m.triangles.length / 3; t++) {
      const zs = [0, 1, 2].map((c) => m.positions[3 * m.triangles[3 * t + c] + 2]);
      if (zs.every((z) => Math.abs(z - zs[0]) < 1e-9)) continue;
      keep.push(m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]);
      kn.push(...m.cornerNormals.slice(9 * t, 9 * t + 9));
      kb.push(m.triBody[t]);
    }
    const open: Mesh = { ...m, triangles: keep, cornerNormals: kn, triBody: kb };
    // A horizontal cut would still close (a sleeve's ring); a vertical one runs off the open ends.
    const pl = sectionPlane(front, [20, -5], [20, 15])!;
    const r = cutMesh(open, pl, sectionView(front, pl, "A"), lineBudget(60000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^part 1 is not a closed solid/);
  });

  it("the cut face hides what lies behind it: the section of a box shows no hidden line inside the cut", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const pl = sectionPlane(front, [20, -5], [20, 15])!;
    const v = sectionView(front, pl, "A");
    const r = cutMesh(m, pl, v, lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    const dr = drawLines(r.mesh, v, lineBudget(60000));
    // The far face (x = 40) is exactly behind the cut face: every one of its edges is hidden, none visible inside.
    expect(dr.visible.length).toBeGreaterThan(0);
    const inside = (x: number, y: number): boolean => x > 1e-6 && x < 10 - 1e-6 && y > 1e-6 && y < 20 - 1e-6;
    for (const l of dr.visible) for (let i = 0; i + 1 < l.length; i++) {
      const mx = (l[i][0] + l[i + 1][0]) / 2, my = (l[i][1] + l[i + 1][1]) / 2;
      expect(inside(mx, my)).toBe(false);
    }
  });
});

describe("hatchRegions", () => {
  const square = (x0: number, y0: number, s: number, body: number): CutRegion => ({
    body,
    outer: [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]],
    holes: [],
  });

  it("regularly spaced 45° lines, all inside the cut face", () => {
    const h = hatchRegions([square(0, 0, 10, 0)]);
    expect(h.lines.length).toBeGreaterThan(8);
    for (const [[x1, y1], [x2, y2]] of h.lines) {
      expect(Math.abs(Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI))).toBeCloseTo(45, 9);
      for (const [x, y] of [[x1, y1], [x2, y2]]) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(10 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(10 + 1e-9);
      }
    }
  });

  it("no hatching in a hole", () => {
    const ring: CutRegion = { body: 0, outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [[[3, 3], [3, 7], [7, 7], [7, 3]]] };
    const h = hatchRegions([ring]);
    for (const [[x1, y1], [x2, y2]] of h.lines) {
      for (let k = 1; k < 20; k++) {
        const x = x1 + ((x2 - x1) * k) / 20, y = y1 + ((y2 - y1) * k) / 20;
        expect(x > 3 + 1e-6 && x < 7 - 1e-6 && y > 3 + 1e-6 && y < 7 - 1e-6).toBe(false);
      }
    }
  });

  it("touching parts are hatched at different angles; the same part in two pieces the same way", () => {
    const h = hatchRegions([square(0, 0, 10, 0), square(10, 0, 10, 1), square(40, 0, 10, 0)]);
    expect(HATCH_STYLES[h.styleOf.get(0)!].deg).not.toBe(HATCH_STYLES[h.styleOf.get(1)!].deg);
  });
});

describe("review fixes", () => {
  const top = STANDARD_VIEWS.top;
  const r12 = (v: number[]): number[] => v.map((x) => +x.toFixed(12) + 0);

  it("a cut across a top view stands the part upright (world +Z up), flipped or not", () => {
    for (const [a, b] of [[[0, 0], [1, 0]], [[0, 0], [0, 1]]] as Array<[[number, number], [number, number]]>) {
      for (const flip of [false, true]) {
        const v = sectionView(top, sectionPlane(top, a, b, flip)!, "A");
        expect(r12(v.rot.slice(3, 6))).toEqual([0, 0, 1]);
      }
    }
  });

  it("a plane on a face with the part on the viewer's side has no cut face (it hatched a false one)", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const pl = sectionPlane(front, [0, -5], [0, 15], true)!; // x = 0 looking −X: the whole box is taken away
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(0);
    const c = meshOf(body(cylinder(5, 30)));
    const up = sectionPlane(front, [10, 30], [-10, 30])!; // z = 30 looking up: the cylinder is all below
    expect(up.sight[2]).toBeCloseTo(1, 12);
    const rc = cutMesh(c, up, sectionView(front, up, "A"), lineBudget(60000));
    if (!rc.ok) throw new Error(rc.reason);
    expect(rc.regions).toHaveLength(0);
  });

  it("two boxes cut at their joint: the removed one leaves no cut face over the other", () => {
    const m = meshOf(body(box(10, 10, 10)), body(box(10, 10, 10), { translate: [10, 0, 0], rotateDeg: [0, 0, 0] }));
    const pl = sectionPlane(front, [10, -5], [10, 15])!; // x = 10 looking +X
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions).toHaveLength(0);
  });

  it("a cone cut through its apex is cut, not refused (its tip is a ring of microscopic radius)", () => {
    const m = meshOf(body(cone(10, 20)));
    const pl = sectionPlane(front, [0, -5], [0, 25])!;
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.regions.length).toBeGreaterThanOrEqual(1);
    const area = r.regions.reduce((t, g) => t + areaOf(g), 0);
    // The cone's whole profile through its axis: a triangle of base 20 and height 20, area 200, within the flattening.
    expect(area / 200).toBeCloseTo(1, 2);
  });

  it("three touching parts take three different angles before any spacing variant", () => {
    const sq = (x0: number, b: number): CutRegion => ({ body: b, outer: [[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10]], holes: [] });
    // A middle part touching both others, and the two outer ones touching each other's corner region via a fourth.
    const h = hatchRegions([sq(0, 0), sq(10, 1), sq(5, 2)]);
    const degs = [0, 1, 2].map((b) => HATCH_STYLES[h.styleOf.get(b)!].deg);
    expect(new Set(degs).size).toBe(3);
  });
});

describe("review fixes, second round", () => {
  it("an open IMPORTED part is refused even when its own sag estimate is coarse (its gap is not joined)", () => {
    const m = meshOf(body(box(10, 10, 10)));
    // Take away one triangle of the face at y = 0 that the plane x = 3 crosses, and mark the part as imported with
    // a coarse sag (a 12-facet curved STL estimates ~0.3 of 10).
    let drop = -1;
    for (let t = 0; t < m.triangles.length / 3 && drop < 0; t++) {
      const vs = [0, 1, 2].map((c) => m.triangles[3 * t + c]);
      const ys = vs.map((v) => m.positions[3 * v + 1]), xs = vs.map((v) => m.positions[3 * v]);
      if (ys.every((y) => Math.abs(y) < 1e-9) && Math.min(...xs) < 3 && Math.max(...xs) > 3) drop = t;
    }
    expect(drop).toBeGreaterThanOrEqual(0);
    const keep = (a: number[], per: number): number[] => a.filter((_, i) => Math.floor(i / per) !== drop);
    const open: Mesh = { ...m, triangles: keep(m.triangles, 3), cornerNormals: keep(m.cornerNormals, 9), triBody: keep(m.triBody, 1), bodySag: [20], bodyNoise: [1e-6] };
    const pl = sectionPlane(front, [3, -5], [3, 15])!;
    const r = cutMesh(open, pl, sectionView(front, pl, "A"), lineBudget(60000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a closed solid.*or repair the file$/);
    // The same gap on a GENERATED part with that flattening is joined: the test discriminates.
    const asGenerated = cutMesh({ ...open, bodyNoise: [0] }, pl, sectionView(front, pl, "A"), lineBudget(60000));
    expect(asGenerated.ok).toBe(true);
  });

  it("a part taken away entirely leaves nothing behind, not even its face on the plane", () => {
    const m = meshOf(body(box(40, 20, 10)));
    const pl = sectionPlane(front, [0, -5], [0, 15], true)!;
    const r = cutMesh(m, pl, sectionView(front, pl, "A"), lineBudget(60000));
    if (!r.ok) throw new Error(r.reason);
    expect(r.mesh.triangles).toHaveLength(0);
    expect(r.mesh.edges).toHaveLength(0);
  });
});
