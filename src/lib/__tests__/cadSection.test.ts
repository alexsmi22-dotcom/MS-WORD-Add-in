// Section views (cadSection.ts): the plane, the view, the cut, its caps and its hatching — 37 CFR 1.84(h)(3).
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Mesh, Placement, tessellate, tube } from "../cadModel";
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
