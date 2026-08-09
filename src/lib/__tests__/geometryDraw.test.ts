// Draw-to-solve (src/lib/geometryDraw.ts) — the drawing surface's whole model.
//
// The load-bearing claim is the LAST describe block: every request the surface
// can emit is ACCEPTED by the engines it targets. A drawing tool that writes
// text its own solver rejects is the button-shaped bug from solvePalette,
// rebuilt with a mouse.

import {
  DrawState, emptyDrawState, setTool, clickAt, closePolygon, undo, clearAll,
  hitHandle, dragHandle, emitDsl, describePending, renderDrawSvg, snap, snapPt,
  handlesOf, polygonSelfIntersects, compositeReading, circleGrip, WORLD_W, WORLD_H,
} from "../geometryDraw";
import { solveGeometry } from "../geometryParse";
import { solveComposite } from "../compositeGeometry";

const clicks = (state: DrawState, pts: [number, number][]): DrawState =>
  pts.reduce((s, [x, y]) => clickAt(s, { x, y }), state);

describe("snapping", () => {
  test("snaps to the half-unit grid", () => {
    expect(snap(3.24)).toBe(3);
    expect(snap(3.26)).toBe(3.5);
    expect(snap(3.75)).toBe(4);
    expect(snap(-0.2)).toBe(-0);
  });

  test("snapPt clamps into the world", () => {
    expect(snapPt({ x: -3, y: 99 })).toEqual({ x: 0, y: WORLD_H });
    expect(snapPt({ x: WORLD_W + 5, y: -1 })).toEqual({ x: WORLD_W, y: 0 });
  });

  test("a snapped coordinate is exact in halves — no float tails in the DSL", () => {
    const s = clicks(emptyDrawState("triangle"), [[0.24, 0.26], [3.99, 0.01], [0.02, 2.76]]);
    expect(emitDsl(s).text).toBe("triangle (0,0.5) (4,0) (0,3)");
  });
});

describe("gesture state machine", () => {
  test("three clicks make a triangle; a collinear third is refused", () => {
    let s = clicks(emptyDrawState("triangle"), [[0, 0], [4, 0]]);
    s = clickAt(s, { x: 8, y: 0 }); // collinear — not a triangle
    expect(s.shapes).toHaveLength(0);
    expect(s.pending).toHaveLength(2);
    s = clickAt(s, { x: 0, y: 3 });
    expect(s.shapes).toHaveLength(1);
    expect(s.pending).toHaveLength(0);
  });

  test("a repeated click on the same snapped point is a no-op", () => {
    let s = clickAt(emptyDrawState("segment"), { x: 1, y: 1 });
    s = clickAt(s, { x: 1.1, y: 0.9 }); // snaps to the same (1,1)
    expect(s.pending).toHaveLength(1);
    expect(s.shapes).toHaveLength(0);
  });

  test("a zero-width rectangle corner is refused, not stored", () => {
    let s = clicks(emptyDrawState("rectangle"), [[2, 2]]);
    s = clickAt(s, { x: 2, y: 5 }); // same x — no width
    expect(s.shapes).toHaveLength(0);
    expect(s.pending).toEqual([{ x: 2, y: 2 }]);
    s = clickAt(s, { x: 6, y: 5 });
    expect(s.shapes).toHaveLength(1);
  });

  test("the circle's radius comes from the rim click, snapped", () => {
    const s = clicks(emptyDrawState("circle"), [[5, 5], [7.6, 5]]);
    expect(s.shapes).toEqual([{ kind: "circle", c: { x: 5, y: 5 }, r: 2.5 }]);
  });

  test("a polygon needs three vertices to close, and drops a duplicated first=last", () => {
    let s = clicks(emptyDrawState("polygon"), [[0, 0], [4, 0]]);
    expect(closePolygon(s).shapes).toHaveLength(0); // too few
    s = clicks(s, [[4, 4], [0, 0]]); // clicked back on the start
    const closed = closePolygon(s);
    expect(closed.shapes).toHaveLength(1);
    expect((closed.shapes[0] as { pts: unknown[] }).pts).toHaveLength(3);
  });

  test("undo removes the pending click first, then the last shape; clear empties", () => {
    let s = clicks(emptyDrawState("triangle"), [[0, 0], [4, 0], [0, 3]]);
    s = clickAt(s, { x: 9, y: 9 }); // one pending click of a second triangle
    s = undo(s);
    expect(s.pending).toHaveLength(0);
    expect(s.shapes).toHaveLength(1);
    s = undo(s);
    expect(s.shapes).toHaveLength(0);
    expect(clearAll(clicks(emptyDrawState("segment"), [[0, 0], [1, 1]])).shapes).toHaveLength(0);
  });

  test("switching tools abandons the half-built shape", () => {
    const s = setTool(clicks(emptyDrawState("triangle"), [[0, 0], [4, 0]]), "circle");
    expect(s.pending).toHaveLength(0);
    expect(s.tool).toBe("circle");
  });
});

describe("editing with handles", () => {
  const tri = clicks(emptyDrawState("triangle"), [[0, 0], [4, 0], [0, 3]]);

  test("hitHandle finds a vertex within tolerance, topmost shape first", () => {
    expect(hitHandle(tri, { x: 4.2, y: 0.1 })).toEqual({ shape: 0, handle: 1 });
    expect(hitHandle(tri, { x: 9, y: 9 })).toBeNull();
    const two = clicks(setTool(tri, "segment"), [[4, 0], [8, 0]]);
    expect(hitHandle(two, { x: 4, y: 0 })!.shape).toBe(1); // the later shape wins
  });

  test("dragging a vertex reshapes and re-emits", () => {
    const dragged = dragHandle(tri, { shape: 0, handle: 2 }, { x: 0, y: 5.1 });
    expect(emitDsl(dragged).text).toBe("triangle (0,0) (4,0) (0,5)");
  });

  test("a drag that would collapse or flatten the triangle is refused", () => {
    expect(dragHandle(tri, { shape: 0, handle: 2 }, { x: 4, y: 0 })).toBe(tri); // onto a vertex
    expect(dragHandle(tri, { shape: 0, handle: 2 }, { x: 8, y: 0 })).toBe(tri); // collinear
  });

  test("the circle's two handles are centre and east radius grip", () => {
    const c = clicks(emptyDrawState("circle"), [[5, 5], [7, 5]]);
    expect(handlesOf(c.shapes[0])).toEqual([{ x: 5, y: 5 }, { x: 7, y: 5 }]);
    const moved = dragHandle(c, { shape: 0, handle: 0 }, { x: 6, y: 6 });
    expect(emitDsl(moved).text).toBe("circle r=2");
    const grown = dragHandle(c, { shape: 0, handle: 1 }, { x: 8.5, y: 5 });
    expect(emitDsl(grown).text).toBe("circle r=3.5");
  });

  test("a rectangle cannot be dragged flat", () => {
    const r = clicks(emptyDrawState("rectangle"), [[1, 1], [5, 4]]);
    expect(dragHandle(r, { shape: 0, handle: 1 }, { x: 1, y: 6 })).toBe(r);
  });
});

describe("DSL emission", () => {
  test("each single shape maps to its natural request", () => {
    expect(emitDsl(clicks(emptyDrawState("triangle"), [[0, 0], [4, 0], [0, 3]])).text)
      .toBe("triangle (0,0) (4,0) (0,3)");
    expect(emitDsl(closePolygon(clicks(emptyDrawState("polygon"), [[0, 0], [4, 0], [4, 4], [0, 4]]))).text)
      .toBe("polygon (0,0) (4,0) (4,4) (0,4)");
    expect(emitDsl(clicks(emptyDrawState("rectangle"), [[1, 1], [7.5, 5]])).text)
      .toBe("rectangle a=6.5 b=4");
    expect(emitDsl(clicks(emptyDrawState("circle"), [[5, 5], [7.5, 5]])).text)
      .toBe("circle r=2.5");
    expect(emitDsl(clicks(emptyDrawState("segment"), [[0, 0], [3, 4]])).text)
      .toBe("distance (0,0) (3,4)");
  });

  test("two segments become a line-intersection request", () => {
    const s = clicks(clicks(emptyDrawState("segment"), [[0, 0], [4, 4]]), [[0, 4], [4, 0]]);
    expect(emitDsl(s).text).toBe("line (0,0) (4,4) (0,4) (4,0)");
  });

  test("a rectangle base with a circle fully inside reads as a composite cutout", () => {
    let s = clicks(emptyDrawState("rectangle"), [[1, 1], [9, 7]]);
    s = clicks(setTool(s, "circle"), [[4, 4], [5.5, 4]]);
    expect(emitDsl(s).text).toBe("rectangle 8 x 6 minus circle r=1.5");
  });

  test("a circle base takes rectangle cutouts, checked corner by corner", () => {
    let s = clicks(emptyDrawState("circle"), [[8, 5], [12, 5]]);
    s = clicks(setTool(s, "rectangle"), [[7, 4], [9, 6]]);
    expect(emitDsl(s).text).toBe("circle r=4 minus rectangle 2 x 2");
  });

  test("a shape NOT fully inside the base falls back to first-shape-only, and says so", () => {
    let s = clicks(emptyDrawState("rectangle"), [[1, 1], [6, 5]]);
    s = clicks(setTool(s, "circle"), [[6, 3], [8, 3]]); // pokes out of the base
    const emitted = emitDsl(s);
    expect(emitted.text).toBe("rectangle a=5 b=4");
    expect(emitted.note).toMatch(/FIRST shape/);
  });

  test("a cutout touching the base edge does not count as inside", () => {
    let s = clicks(emptyDrawState("rectangle"), [[0, 0], [8, 6]]);
    s = clicks(setTool(s, "circle"), [[4, 3], [7, 3]]); // r=3 touches y=0 and y=6
    expect(emitDsl(s).text).toBe("rectangle a=8 b=6");
  });

  test("empty state emits nothing, with the invitation note", () => {
    const emitted = emitDsl(emptyDrawState());
    expect(emitted.text).toBe("");
    expect(emitted.note).toMatch(/Click to draw/);
  });
});

describe("the surface renders honestly", () => {
  test("the SVG carries the grid, the shapes and no NaN", () => {
    const s = clicks(emptyDrawState("triangle"), [[0, 0], [4, 0], [0, 3]]);
    const svg = renderDrawSvg(s, { x: 2, y: 2 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain("(2, 2)"); // the live coordinate readout
    expect(svg).not.toContain("NaN");
  });

  test("cutouts are painted as cutouts EXACTLY when emitDsl reads them so", () => {
    let s = clicks(emptyDrawState("rectangle"), [[1, 1], [9, 7]]);
    s = clicks(setTool(s, "circle"), [[4, 4], [5.5, 4]]);
    expect(renderDrawSvg(s, null)).toContain("#b91c1c"); // cutout red
    // Move the circle out of the base: same shapes, no composite reading —
    // and the paint must agree.
    const out = dragHandle(setTool(s, "select"), { shape: 1, handle: 0 }, { x: 12, y: 4 });
    expect(emitDsl(out).note).toMatch(/FIRST shape/);
    expect(renderDrawSvg(out, null)).not.toContain("#b91c1c");
  });

  test("the rubber preview follows the hover point", () => {
    const s = clicks(emptyDrawState("circle"), [[5, 5]]);
    const svg = renderDrawSvg(s, { x: 7, y: 5 });
    expect(svg).toContain("stroke-dasharray");
  });

  test("describePending narrates every tool", () => {
    for (const tool of ["select", "triangle", "rectangle", "circle", "polygon", "segment"] as const) {
      expect(describePending(emptyDrawState(tool)).length).toBeGreaterThan(8);
    }
    expect(describePending(clicks(emptyDrawState("triangle"), [[0, 0]]))).toMatch(/1 of 3/);
  });
});

describe("defects found by the independent adversarial pass (v2.107.0), pinned", () => {
  const rectBase = clicks(emptyDrawState("rectangle"), [[0, 0], [12, 8]]);

  test("1: OVERLAPPING cutouts refuse the composite reading — no double subtraction", () => {
    let s = clicks(setTool(rectBase, "circle"), [[4, 4], [6, 4]]);
    s = clicks(s, [[5, 4], [7, 4]]); // second circle overlapping the first
    expect(compositeReading(s.shapes)).toBe("overlap");
    const emitted = emitDsl(s);
    expect(emitted.text).toBe("rectangle a=12 b=8"); // first shape only
    expect(emitted.note).toMatch(/OVERLAP/);
    expect(emitted.note).toMatch(/twice/);
    // And the paint agrees: nothing is colored as a cutout.
    expect(renderDrawSvg(s, null)).not.toContain("#b91c1c");
  });

  test("1b: a NESTED cutout is the starker case, equally refused", () => {
    let s = clicks(setTool(rectBase, "circle"), [[6, 4], [9, 4]]); // r=3
    s = clicks(s, [[6, 4.5], [6, 5.5]]); // r=1 wholly inside the r=3 cutout
    expect(compositeReading(s.shapes)).toBe("overlap");
    expect(emitDsl(s).text).toBe("rectangle a=12 b=8");
  });

  test("1c: TANGENT cutouts share zero area and stay a composite", () => {
    let s = clicks(setTool(rectBase, "circle"), [[3, 4], [4, 4]]); // r=1 at x=3
    s = clicks(s, [[5, 4], [6, 4]]); // r=1 at x=5 — touching at x=4
    expect(compositeReading(s.shapes)).toBe("composite");
    expect(emitDsl(s).text).toBe("rectangle 12 x 8 minus circle r=1 minus circle r=1");
  });

  test("1d: overlapping rectangle cutouts and circle-rect overlaps also refuse", () => {
    let s = clicks(setTool(rectBase, "rectangle"), [[2, 2], [6, 6]]);
    s = clicks(s, [[5, 3], [8, 7]]);
    expect(compositeReading(s.shapes)).toBe("overlap");
    let t = clicks(setTool(rectBase, "rectangle"), [[2, 2], [6, 6]]);
    t = clicks(setTool(t, "circle"), [[6, 4], [7.5, 4]]); // pokes into the rect cutout
    expect(compositeReading(t.shapes)).toBe("overlap");
  });

  test("2: a self-crossing polygon WITHHOLDS its request and is painted hollow", () => {
    const bowtie = closePolygon(clicks(emptyDrawState("polygon"), [[0, 0], [4, 4], [4, 0], [0, 4]]));
    expect(polygonSelfIntersects((bowtie.shapes[0] as { pts: { x: number; y: number }[] }).pts)).toBe(true);
    const emitted = emitDsl(bowtie);
    expect(emitted.text).toBe("");
    expect(emitted.note).toMatch(/CROSSES ITSELF/);
    const svg = renderDrawSvg(bowtie, null);
    expect(svg).toContain('fill="none"'); // no asserted enclosed region
    expect(svg).toContain("stroke-dasharray");
  });

  test("2b: a repeated NON-consecutive vertex is self-intersection too", () => {
    const s = closePolygon(clicks(emptyDrawState("polygon"), [[0, 0], [4, 4], [0, 0], [4, 0]]));
    // The consecutive-click dedup does not fire for a return visit.
    if (s.shapes.length) {
      expect(emitDsl(s).text).toBe("");
    }
  });

  test("2c: a simple concave polygon is NOT falsely flagged", () => {
    const l = closePolygon(clicks(emptyDrawState("polygon"), [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]]));
    expect(polygonSelfIntersects((l.shapes[0] as { pts: { x: number; y: number }[] }).pts)).toBe(false);
    expect(emitDsl(l).text).toContain("polygon");
  });

  test("2d: the engine's zero-area caveat no longer calls a bowtie collinear", () => {
    const r = solveGeometry("polygon (0,0) (4,4) (4,0) (0,4)")!;
    expect(r.caveats.join(" ")).toMatch(/crosses itself/);
    expect(r.caveats.join(" ")).not.toMatch(/collinear/);
    const line = solveGeometry("polygon (0,0) (1,1) (2,2) (3,3)")!;
    expect(line.caveats.join(" ")).toMatch(/collinear/);
  });

  test("3: the circle's radius grip always stays inside the world", () => {
    // Near the east wall the grip flips to the WEST side.
    const c = clicks(emptyDrawState("circle"), [[15, 5], [16, 5]]);
    let s = dragHandle(setTool(c, "select"), { shape: 0, handle: 1 }, { x: 16, y: 10 });
    const grown = s.shapes[0] as { c: { x: number; y: number }; r: number };
    expect(grown.r).toBe(5);
    const grip = handlesOf(s.shapes[0])[1];
    expect(grip.x).toBeGreaterThanOrEqual(0);
    expect(grip.x).toBeLessThanOrEqual(WORLD_W);
    // …and hitHandle can still reach it, so the circle stays resizable.
    expect(hitHandle(setTool(s, "select"), grip)).toEqual({ shape: 0, handle: 1 });
  });

  test("3b: creation clamps a radius no compass grip could survive", () => {
    const s = clicks(emptyDrawState("circle"), [[0, 0], [16, 10]]);
    const c = s.shapes[0] as { r: number };
    expect(c.r).toBe(16); // maxGripR((0,0)) — east grip lands exactly on the wall
    expect(circleGrip({ x: 0, y: 0 }, 16)).toEqual({ x: 16, y: 0 });
  });

  test("3c: a centre move that would strand the grip on every side is refused", () => {
    const sel = setTool(clicks(emptyDrawState("circle"), [[1, 5], [16, 5]]), "select"); // r=15
    const moved = dragHandle(sel, { shape: 0, handle: 0 }, { x: 8, y: 5 });
    expect(moved).toBe(sel); // the identical state object — a refused drag
  });

  test("NaN coordinates are pinned, not propagated", () => {
    expect(snapPt({ x: NaN, y: 3 })).toEqual({ x: 0, y: 3 });
    expect(renderDrawSvg(emptyDrawState(), { x: NaN, y: NaN } as never)).not.toContain("NaN");
  });

  test("the drawn two-line slope arrives reduced (4/4 was shown before)", () => {
    const r = solveGeometry("line (0,0) (4,4)")!;
    const slope = r.values.find((v) => v.label === "slope");
    expect(slope!.exact).toBe("1");
  });
});

describe("EVERY emittable request is accepted by the engines (anti button-shaped-bug)", () => {
  const states: [string, DrawState][] = [
    ["triangle", clicks(emptyDrawState("triangle"), [[0, 0], [4, 0], [0, 3]])],
    ["half-unit triangle", clicks(emptyDrawState("triangle"), [[0.5, 0.5], [4.5, 0.5], [0.5, 3.5]])],
    ["polygon", closePolygon(clicks(emptyDrawState("polygon"), [[0, 0], [5, 0], [6, 3], [2, 5]]))],
    ["rectangle", clicks(emptyDrawState("rectangle"), [[1, 1], [7.5, 5]])],
    ["circle", clicks(emptyDrawState("circle"), [[5, 5], [7.5, 5]])],
    ["segment", clicks(emptyDrawState("segment"), [[0, 0], [3, 4]])],
    ["two segments", clicks(clicks(emptyDrawState("segment"), [[0, 0], [4, 4]]), [[0, 4], [4, 0]])],
    ["composite rect minus circle", clicks(setTool(clicks(emptyDrawState("rectangle"), [[1, 1], [9, 7]]), "circle"), [[4, 4], [5.5, 4]])],
    ["composite rect minus two", clicks(setTool(clicks(setTool(clicks(emptyDrawState("rectangle"), [[0, 0], [12, 8]]), "circle"), [[3, 4], [4, 4]]), "rectangle"), [[7, 3], [9, 5]])],
    ["composite circle minus rect", clicks(setTool(clicks(emptyDrawState("circle"), [[8, 5], [12, 5]]), "rectangle"), [[7, 4], [9, 6]])],
    ["composite with halves", clicks(setTool(clicks(emptyDrawState("rectangle"), [[0.5, 0.5], [7, 6]]), "circle"), [[3.5, 3], [5, 3]])],
  ];

  test.each(states.map(([name, s]) => [name, s] as const))("%s", (_name, state) => {
    const { text } = emitDsl(state);
    expect(text).not.toBe("");
    const composite = solveComposite(text);
    if (composite) {
      expect(composite.incomplete).toBeUndefined();
      expect(composite.values.length).toBeGreaterThan(0);
      return;
    }
    const g = solveGeometry(text);
    expect(g).not.toBeNull();
    expect(g!.degenerate).toBeUndefined();
  });

  test("dragging never emits an unsolvable request (sweep over every handle)", () => {
    for (const [, base] of states) {
      for (let si = 0; si < base.shapes.length; si++) {
        const handles = handlesOf(base.shapes[si]);
        for (let h = 0; h < handles.length; h++) {
          const moved = dragHandle(base, { shape: si, handle: h }, { x: handles[h].x + 0.5, y: handles[h].y + 0.5 });
          const { text } = emitDsl(moved);
          if (!text) continue;
          const ok = solveComposite(text) !== null || solveGeometry(text) !== null;
          expect(ok).toBe(true);
        }
      }
    }
  });
});
