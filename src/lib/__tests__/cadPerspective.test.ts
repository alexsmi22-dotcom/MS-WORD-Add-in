// Perspective views (cadPerspective.ts): the projective map, drawn by the orthographic hidden-line engine.
import { Assembly, Body, BodySpec, box, cylinder, IDENTITY_PLACEMENT, Mesh, Placement, tessellate } from "../cadModel";
import { drawLines, lineBudget, STANDARD_VIEWS } from "../cadLines";
import { MAPPED_VIEW, perspectiveMesh } from "../cadPerspective";

let seq = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++seq}`, name: `b${seq}`, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
const boundsOf = (lines: Array<Array<[number, number]>>): { w: number; h: number } => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of lines) for (const [x, y] of l) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  return { w: x1 - x0, h: y1 - y0 };
};

describe("perspectiveMesh", () => {
  it("a cube seen straight on: the near face is larger than the far one, by exactly d / (d ∓ 5)", () => {
    const m = meshOf(body(box(10, 10, 10)));
    const r = perspectiveMesh(m, STANDARD_VIEWS.front, 3);
    if (!r.ok) throw new Error(r.reason);
    const d = 3 * m.diag;
    const dr = drawLines(r.mesh, MAPPED_VIEW, lineBudget(60000));
    // What is seen is the near face (5 nearer than the centre); the far face and the receding edges are behind it.
    const seen = boundsOf(dr.visible);
    expect(seen.w).toBeCloseTo((10 * d) / (d - 5), 9);
    expect(seen.h).toBeCloseTo((10 * d) / (d - 5), 9);
    // The far face is drawn hidden, smaller: 10·d/(d + 5).
    const far = dr.hidden.flat().filter(([x, y]) => Math.abs(Math.abs(x) - (5 * d) / (d + 5)) < 1e-9 && Math.abs(Math.abs(y) - (5 * d) / (d + 5)) < 1e-9);
    expect(far.length).toBeGreaterThan(0);
  });

  it("the receding edges converge: from the iso direction, the cube's vertical edges are not parallel", () => {
    const m = meshOf(body(box(10, 10, 10)));
    const r = perspectiveMesh(m, STANDARD_VIEWS.iso, 2);
    if (!r.ok) throw new Error(r.reason);
    const map = r.map;
    // Two vertical edges, at the box's left and right corners.
    const e1 = [map([0, 0, 0]), map([0, 0, 10])], e2 = [map([10, 10, 0]), map([10, 10, 10])];
    const dir = (e: number[][]): number => Math.atan2(e[1][1] - e[0][1], e[1][0] - e[0][0]);
    expect(Math.abs(dir(e1) - dir(e2))).toBeGreaterThan(1e-3);
  });

  it("a cylinder's outline is where the eye's rays graze it (normals through the Jacobian)", () => {
    const m = meshOf(body(cylinder(5, 20)));
    const r = perspectiveMesh(m, STANDARD_VIEWS.top, 2);
    if (!r.ok) throw new Error(r.reason);
    // Looking down the axis from above: the outline is the near (top) circle; the bottom circle, smaller, is hidden
    // inside it. The drawing's width is the top circle's diameter, scaled by d / (d − 10).
    const d = 2 * m.diag;
    const dr = drawLines(r.mesh, MAPPED_VIEW, lineBudget(60000));
    const w = boundsOf(dr.visible).w;
    expect(w / ((10 * d) / (d - 10))).toBeCloseTo(1, 2);
  });

  it("an eye inside the model is refused by name", () => {
    const m = meshOf(body(box(10, 10, 10)));
    const r = perspectiveMesh(m, STANDARD_VIEWS.front, 0.25);
    expect(r).toEqual({ ok: false, reason: "the eye would be inside the model at this distance — choose a farther perspective" });
  });
});
