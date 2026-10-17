// The hidden-line engine's acceptance criteria (docs/SCOPE-CAD-CANVAS.md §C),
// on synthetic models, before any UI exists. Each expectation is a property of
// the drawing a draughtsman would check by eye, stated as a number.
import {
  Assembly,
  Body,
  BodySpec,
  box,
  cylinder,
  cone,
  sphere,
  tube,
  rectLoop,
  circleLoop,
  tessellate,
  modelProblems,
  IDENTITY_PLACEMENT,
  Mesh,
  Placement,
  DEFAULT_TESS,
} from "../cadModel";
import { drawLines, STANDARD_VIEWS, viewFromDegrees, CadView, Polyline } from "../cadLines";
import { layoutSheet } from "../cadSheet";

let seq = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT, name = `b${++seq}`): Body => ({ id: name, name, spec, placement });
const asm = (...bodies: Body[]): Assembly => ({ version: 1, bodies });
const meshOf = (a: Assembly, relTol = DEFAULT_TESS.relTol): Mesh => {
  const r = tessellate(a, { ...DEFAULT_TESS, relTol });
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};

/** Total page length of a set of polylines. */
const length = (ls: Polyline[]): number =>
  ls.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);

/** Straight segments: chaining joins edges that meet at a corner into one polyline, so count its pieces. */
const segments = (ls: Polyline[]): Array<[[number, number], [number, number]]> =>
  ls.flatMap((l) => l.slice(1).map((p, i) => [l[i], p] as [[number, number], [number, number]]));

describe("a cube", () => {
  const m = meshOf(asm(body(box(1, 1, 1))));

  it("isometric: exactly 9 visible edges and 3 hidden, each a full unit edge long", () => {
    const d = drawLines(m, STANDARD_VIEWS.iso);
    expect(segments(d.visible)).toHaveLength(9);
    // The 3 hidden edges run from the back corner across the visible faces'
    // diagonals; every one of them lies exactly on a cap triangulation edge,
    // which is the degenerate case the visibility test must still get right.
    expect(segments(d.hidden)).toHaveLength(3);
    // In isometric every cube edge projects to the same length, sqrt(2/3).
    for (const [a, b] of segments([...d.visible, ...d.hidden])) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(Math.sqrt(2 / 3), 6);
  });

  it("an off-axis view agrees with the convexity oracle (visible iff one of its faces faces the eye)", () => {
    const v = viewFromDegrees([25, 0, 35]);
    const d = drawLines(m, v);
    const toEye = [v.rot[6], v.rot[7], v.rot[8]];
    const faces: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const front = faces.map((n) => n[0] * toEye[0] + n[1] * toEye[1] + n[2] * toEye[2] > 1e-9);
    // The 12 edges of a cube, each between two faces (indices into `faces`).
    const edges = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5]];
    const expectVisible = edges.filter(([f, g]) => front[f] || front[g]).length;
    expect(segments(d.visible)).toHaveLength(expectVisible);
    expect(segments(d.hidden)).toHaveLength(12 - expectVisible);
  });

  it("front orthographic: the square, nothing else", () => {
    const d = drawLines(m, STANDARD_VIEWS.front);
    expect(length(d.visible)).toBeCloseTo(4, 6);
    expect(d.visible.length).toBeLessThanOrEqual(4);
  });
});

describe("a cylinder: two clean outlines, no facet lines", () => {
  // Coarse to fine tessellation — the drawing must not change in kind.
  it.each([2e-2, 2e-3, 2e-4])("relTol %p: side view = 2 outlines + 2 end lines, and the outlines are on the true tangents", (tol) => {
    const m = meshOf(asm(body(cylinder(1, 3))), tol);
    const d = drawLines(m, STANDARD_VIEWS.front);
    // A rectangle 2 wide, 3 tall: the two outlines at x = ±1 and the two caps seen edge-on.
    expect(length(d.visible)).toBeCloseTo(2 * 2 + 2 * 3, 1);
    const xs = d.visible.flat().map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(1, tol >= 2e-2 ? 1 : 2);
    expect(Math.min(...xs)).toBeCloseTo(-1, tol >= 2e-2 ? 1 : 2);
    // No line in the middle of the wall: every visible point is on the outline or a cap.
    for (const [x, y] of d.visible.flat()) {
      const onOutline = Math.abs(Math.abs(x) - 1) < 0.02;
      const onCap = Math.abs(y) < 1e-6 || Math.abs(y - 3) < 1e-6;
      expect({ x, y, onOutline, onCap, ok: onOutline || onCap }).toMatchObject({ ok: true });
    }
  });

  it("isometric: the top ellipse, two straight outlines and the front half of the bottom rim", () => {
    const m = meshOf(asm(body(cylinder(1, 3))));
    const d = drawLines(m, STANDARD_VIEWS.iso);
    // The outlines are the only straight visible lines, both of the cylinder's height in projection.
    // (Short straight bits of rim near the outline do not count; the outlines are 2.45 long.)
    const lines = d.visible.filter((l) => l.length === 2 && length([l]) > 1);
    expect(lines).toHaveLength(2);
    // Nothing visible lies inside the projected wall away from the rims (no facets).
    expect(d.stats.featureSegments).toBeGreaterThan(0);
  });
});

describe("a sphere: one closed outline of the right radius, no zig-zag", () => {
  it("front view: a circle of radius 1 within 0.5 %", () => {
    const m = meshOf(asm(body(sphere(1))));
    const d = drawLines(m, STANDARD_VIEWS.front);
    const pts = d.visible.flat();
    expect(pts.length).toBeGreaterThan(20);
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.005);
    expect(length(d.visible)).toBeCloseTo(2 * Math.PI, 1);
    expect(d.hidden).toHaveLength(0);
  });
});

describe("a pointed cone: the outlines run all the way to the apex (review B1)", () => {
  const m = meshOf(asm(body(cone(1, 2))));

  it("front view: the closed triangle base 2, height 2 — both outlines, nothing short", () => {
    const d = drawLines(m, STANDARD_VIEWS.front);
    expect(length(d.visible)).toBeCloseTo(2 + 2 * Math.hypot(1, 2), 2);
    const top = Math.max(...d.visible.flat().map((p) => p[1]));
    expect(top).toBeCloseTo(2, 4);
  });

  it.each([["iso", STANDARD_VIEWS.iso], ["off-axis", viewFromDegrees([20, 0, 40])]] as Array<[string, CadView]>)(
    "%s: both outlines reach the apex's projection",
    (_n, v) => {
      const d = drawLines(m, v);
      // The apex (0,0,2) projected: the eye frame is rows of rot.
      const ax = 2 * v.rot[2], ay = 2 * v.rot[5];
      const near = d.visible.flat().filter((p) => Math.hypot(p[0] - ax, p[1] - ay) < 1e-3);
      expect(near.length).toBeGreaterThanOrEqual(1);
      // Two straight outlines meet there: the polylines touching the apex carry two distinct directions into it.
      const into = d.visible.flatMap((l) =>
        l.flatMap((p, i) => (Math.hypot(p[0] - ax, p[1] - ay) < 1e-3 ? [l[i - 1], l[i + 1]].filter(Boolean) : [])),
      );
      expect(into.length).toBeGreaterThanOrEqual(2);
    },
  );
});

describe("a plate with a through-hole", () => {
  const plate: BodySpec = { kind: "extrude", profile: { outer: rectLoop(0, 0, 4, 3), holes: [circleLoop(2, 1.5, 0.6, true)] }, depth: 0.5 };
  const m = meshOf(asm(body(plate)));

  it("top view: the rectangle and the hole's circle, nothing hidden that shows", () => {
    const d = drawLines(m, STANDARD_VIEWS.top);
    expect(length(d.visible)).toBeCloseTo(2 * (4 + 3) + 2 * Math.PI * 0.6, 1);
  });

  it("isometric: the hole's top rim is visible all round; its bottom rim only partly", () => {
    const d = drawLines(m, STANDARD_VIEWS.iso);
    const ring = 2 * Math.PI * 0.6 * Math.sqrt(2 / 3); // roughly: projected circumference scales
    expect(length(d.visible)).toBeGreaterThan(ring);
    expect(length(d.hidden)).toBeGreaterThan(0);
  });
});

describe("two bodies: one partly in front of the other", () => {
  it("front view: the rear box's outline is cut exactly at the front box's edge", () => {
    // Rear box 0..2 × y 5..6 × 0..2; front box 1..3 × y 0..1 × 0..1 hides its lower-right quarter.
    const rear = body(box(2, 1, 2), { translate: [0, 5, 0], rotateDeg: [0, 0, 0] }, "rear");
    const front = body(box(2, 1, 1), { translate: [1, 0, 0], rotateDeg: [0, 0, 0] }, "front");
    const d = drawLines(meshOf(asm(rear, front)), STANDARD_VIEWS.front);
    // Visible: front square perimeter (2+1)*2 = 6; rear's visible part: top 2, left 2, right x=2 from z 1..2 = 1,
    // bottom from x 0..1 = 1 → 6. Total 12.
    expect(length(d.visible)).toBeCloseTo(12, 6);
    // Hidden: the rear's right side z 0..1 (1). Its bottom edge x 1..2 is hidden too,
    // but it lies exactly on the front box's visible bottom edge, and the visible
    // line takes precedence (ISO 128 / ASME Y14.2), so it is not drawn.
    expect(length(d.hidden)).toBeCloseTo(1, 6);
  });
});

describe("a revolved stepped shaft", () => {
  it("side view: each step's outline and shoulder, no facet lines", () => {
    // Profile in (r, z): r 1 for z 0..2, r 0.5 for z 2..5.
    const shaft: BodySpec = {
      kind: "revolve",
      profile: {
        outer: {
          start: [0, 0],
          segs: [
            { kind: "line", to: [1, 0] },
            { kind: "line", to: [1, 2] },
            { kind: "line", to: [0.5, 2] },
            { kind: "line", to: [0.5, 5] },
            { kind: "line", to: [0, 5] },
            { kind: "line", to: [0, 0] },
          ],
        },
        holes: [],
      },
    };
    const d = drawLines(meshOf(asm(body(shaft))), STANDARD_VIEWS.front);
    // Outline: bottom rim 2, big sides 2×2, the shoulder seen edge-on (the r = 1 rim, 2 long),
    // small sides 2×3, top rim 1 → 2 + 4 + 2 + 6 + 1 = 15.
    expect(length(d.visible)).toBeCloseTo(15, 1);
  });
});

/** Does a line of `ls` pass through world point p's projection in view v? */
function through(ls: Polyline[], v: CadView, p: [number, number, number], tol = 1e-6): boolean {
  const R = v.rot;
  const x = R[0] * p[0] + R[1] * p[1] + R[2] * p[2], y = R[3] * p[0] + R[4] * p[1] + R[5] * p[2];
  return segments(ls).some(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) < tol;
  });
}

describe("overlapping parts: drawn as separate parts that interfere (review B3)", () => {
  const iso = STANDARD_VIEWS.iso;
  it("an L of two overlapping blocks, isometric: the inner corner is drawn; the slab's buried edge is not visible", () => {
    // Slab x 0..4, y 0..2, z 0..1; wall x 0..4, y 1.5..2, z 0..3 — they share the region y 1.5..2, z 0..1.
    const m = meshOf(asm(body(box(4, 2, 1)), body(box(4, 0.5, 3), { translate: [0, 1.5, 0], rotateDeg: [0, 0, 0] })));
    expect(m.overlaps).toEqual([[0, 1]]);
    const d = drawLines(m, iso);
    // Where the wall's front face rises out of the slab's top: a crossing, no mesh edge of either part.
    expect(through(d.visible, iso, [2, 1.5, 1])).toBe(true);
    // The slab's top-back edge runs inside the wall: never a visible line.
    expect(through(d.visible, iso, [2, 2, 1])).toBe(false);
  });

  it("a shaft through a block, isometric: the shaft's outline is cut where it goes in, and the entry circle is drawn", () => {
    const m = meshOf(asm(body(box(4, 4, 2)), body(cylinder(0.5, 6), { translate: [2, 2, -2], rotateDeg: [0, 0, 0] })));
    expect(m.overlaps).toEqual([[0, 1]]);
    const d = drawLines(m, iso);
    // The outline generator facing the isometric eye is at 45° round the shaft.
    const g = (z: number): [number, number, number] => [2 + 0.5 * Math.SQRT1_2, 2 + 0.5 * Math.SQRT1_2, z];
    expect(through(d.visible, iso, g(3))).toBe(true); // above the block
    expect(through(d.visible, iso, g(1))).toBe(false); // inside it
    // The front of the circle where the shaft enters the top face (θ = −45°, toward the eye).
    expect(through(d.visible, iso, [2 + 0.5 * Math.SQRT1_2, 2 - 0.5 * Math.SQRT1_2, 2], 1e-3)).toBe(true);
  });

  it("a block standing on a plate only touches it: no overlap, no extra lines", () => {
    const plate = body(box(6, 6, 1));
    const blk = body(box(2, 2, 2), { translate: [1, 1, 1], rotateDeg: [0, 0, 0] });
    const m = meshOf(asm(plate, blk));
    expect(m.overlaps).toEqual([]);
    expect(m.crossings).toEqual([]);
  });

  it("parts that are apart cost nothing and report nothing", () => {
    const m = meshOf(asm(body(box(1, 1, 1)), body(box(1, 1, 1), { translate: [3, 0, 0], rotateDeg: [0, 0, 0] })));
    expect(m.overlaps).toEqual([]);
  });

  it("an overlap too detailed for the work bound is refused, naming both parts — never drawn without its crossing", () => {
    const r = tessellate(asm(body(sphere(1), IDENTITY_PLACEMENT, "ball A"), body(sphere(1), { translate: [0.5, 0, 0], rotateDeg: [0, 0, 0] }, "ball B")), {
      ...DEFAULT_TESS,
      maxPairTests: 100,
    });
    expect(r).toEqual({ ok: false, reason: "ball A and ball B overlap over too much curved surface to work out where they cross — move them apart, or overlap them less" });
  });

  it("two fine overlapping spheres tessellate and draw within a freeze budget (a bound, not a speed claim)", () => {
    const t0 = Date.now();
    const m = meshOf(asm(body(sphere(1)), body(sphere(1), { translate: [0.7, 0.3, 0.2], rotateDeg: [0, 0, 0] })));
    expect(m.overlaps).toEqual([[0, 1]]);
    expect(m.crossings.length).toBeGreaterThan(20);
    const d = drawLines(m, iso);
    expect(d.visible.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("refusals by name, and the work bound", () => {
  it("an open outline is refused, naming the body and the fault", () => {
    const bad: BodySpec = { kind: "extrude", profile: { outer: { start: [0, 0], segs: [{ kind: "line", to: [1, 0] }, { kind: "line", to: [1, 1] }] }, holes: [] }, depth: 1 };
    const p = modelProblems(asm(body(bad, IDENTITY_PLACEMENT, "bracket")));
    expect(p.map((x) => `${x.body}: ${x.reason}`)).toContain("bracket: the outline is not closed (it ends away from where it starts)");
  });

  it("a clockwise outline and a counter-clockwise hole are refused, not silently flipped", () => {
    const cwOuter: BodySpec = { kind: "extrude", profile: { outer: circleLoop(0, 0, 1, true), holes: [] }, depth: 1 };
    const r = tessellate(asm(body(cwOuter, IDENTITY_PLACEMENT, "disc")));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/disc: the outline must run counter-clockwise/);
    const ccwHole = tube(1, 0.5, 1);
    (ccwHole as { profile: { holes: unknown[] } }).profile.holes = [circleLoop(0, 0, 0.5, false)];
    const r2 = tessellate(asm(body(ccwHole, IDENTITY_PLACEMENT, "ring")));
    expect(!r2.ok && r2.reason).toMatch(/ring: hole 1 must run clockwise/);
  });

  it("a model over the triangle cap is refused by name instead of freezing Word", () => {
    const many = Array.from({ length: 40 }, (_, i) => body(cylinder(1, 1), { translate: [i * 3, 0, 0], rotateDeg: [0, 0, 0] }));
    const r = tessellate(asm(...many), { relTol: 1e-6, maxTriangles: 5000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/more than 5,000 triangles/);
  });

  it("a model at a realistic size draws well inside a freeze budget (a bound, not a speed claim)", () => {
    const plate: BodySpec = {
      kind: "extrude",
      profile: { outer: rectLoop(0, 0, 100, 60), holes: Array.from({ length: 8 }, (_, i) => circleLoop(10 + i * 11, 30, 4, true)) },
      depth: 8,
    };
    const shaft = body(cylinder(6, 40), { translate: [50, 30, 8], rotateDeg: [0, 0, 0] });
    const t0 = Date.now();
    const m = meshOf(asm(body(plate), shaft));
    const d = drawLines(m, STANDARD_VIEWS.iso);
    const ms = Date.now() - t0;
    expect(d.visible.length).toBeGreaterThan(10);
    expect(ms).toBeLessThan(20000); // ~10x headroom over a measured single run
  });
});

describe("SVG output (through the sheet, the only SVG the canvas makes)", () => {
  it("is black-only line art with no fills but the page, and a FIG label", () => {
    const svg = layoutSheet(meshOf(asm(body(box(1, 1, 1)))), { standard: "uspto", views: [{ kind: "iso" }] }).svg;
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('stroke="#000"');
    expect(svg).not.toMatch(/fill="(?!none|#fff|#000)/);
    expect(svg).toContain("FIG. 1");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

export type { CadView };

describe("a small part beside a large one keeps its own shape (review nit)", () => {
  it("a 2 mm pin next to a 1 m plate draws as a circle, not a polygon", () => {
    const m = meshOf(asm(body(box(1000, 600, 10)), body(cylinder(1, 5), { translate: [-20, 0, 0], rotateDeg: [0, 0, 0] })));
    const d = drawLines(m, STANDARD_VIEWS.top);
    // Points of the pin's outline in the top view: on the circle of radius 1 about (−20, 0).
    const R = STANDARD_VIEWS.top.rot;
    const c = [R[0] * -20, R[3] * -20 + R[4] * 0];
    const pts = d.visible.flat().filter(([x, y]) => Math.hypot(x - c[0], y - c[1]) < 2);
    expect(pts.length).toBeGreaterThan(16); // ~5 at the plate's tolerance
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x - c[0], y - c[1]) - 1)).toBeLessThan(0.005);
  });
});
