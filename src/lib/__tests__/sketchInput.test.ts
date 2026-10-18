// Sketcher input the Solid Edge way (src/lib/sketchInput.ts): grid, inference, typed sizes, prompts.
import { gridStep, gridLabel, snapCursor, parseTyped, placeTyped, liveSize, promptFor, typedFields } from "../sketchInput";
import { startEdit, click, EditState } from "../sketchEdit";
import { freedom, measure } from "../sketch";
import { sketchToProfile } from "../sketchProfile";

const ok = (r: { ok: boolean; state: EditState; reason?: string }): EditState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const lens = (st: EditState): number[] =>
  st.sketch.entities
    .filter((e) => e.kind === "line")
    .map((e) => {
      const l = e as { a: string; b: string };
      const a = st.sketch.points.find((p) => p.id === l.a)!, b = st.sketch.points.find((p) => p.id === l.b)!;
      return +Math.hypot(b.x - a.x, b.y - a.y).toFixed(9);
    });

describe("the grid", () => {
  it.each([
    [8 / 3, 5],
    [1, 20],
    [12, 1],
    [30, 0.5],
    [100, 0.2],
  ])("at %d px/mm the spacing is %d mm (a round 1-2-5 step at least 12 px apart)", (s, step) => {
    expect(gridStep(s)).toBe(step);
    expect(gridStep(s) * s).toBeGreaterThanOrEqual(12 - 1e-9);
  });
  it("says its spacing in mm", () => {
    expect(gridLabel(0.5)).toBe("grid 0.5 mm");
  });
});

describe("snapping: points beat midpoints beat alignment beat the grid", () => {
  const sk = ok(click(ok(click({ ...startEdit(), tool: "line" }, 0, 0, 0.1)), 40, 0, 0.1)).sketch;
  const s = 8 / 3; // 5 mm grid, 3 mm reach
  it("locks onto an existing point within 8 px", () => {
    expect(snapCursor(sk, 39, 1, s, { grid: true })).toMatchObject({ x: 40, y: 0, kind: "point" });
  });
  it("locks onto a line's midpoint", () => {
    expect(snapCursor(sk, 21, 1.5, s, { grid: true })).toMatchObject({ x: 20, y: 0, kind: "midpoint" });
  });
  it("lines up vertically with a point already drawn, with a guide, and puts the other axis on the grid", () => {
    const r = snapCursor(sk, 41.5, 23, s, { grid: true });
    expect(r).toMatchObject({ x: 40, y: 25, kind: "align" });
    expect(r.guides).toEqual([{ x1: 40, y1: 0, x2: 40, y2: 25 }]);
  });
  it("otherwise rounds to the grid — or, grid off, stays where it is", () => {
    expect(snapCursor(sk, 13.2, 31.9, s, { grid: true })).toMatchObject({ x: 15, y: 30, kind: "grid" });
    expect(snapCursor(sk, 13.2, 31.9, s, { grid: false })).toMatchObject({ x: 13.2, y: 31.9, kind: "free" });
  });
  it("lines up with the tool's own first point", () => {
    expect(snapCursor({ points: [], entities: [], constraints: [] }, 61, 0.9 + 70, s, { grid: false, anchor: { x: 60, y: 10 } })).toMatchObject({ x: 60, kind: "align" });
  });
});

describe("typed sizes", () => {
  it("the box: Rectangle, type 40 and 20, click — a 40 × 20 rectangle with its W and H as driving dimensions, in one state", () => {
    const st0: EditState = { ...startEdit(), tool: "rectangle" };
    const st = ok(placeTyped(st0, [40, 20], { x: 10, y: 5 }, 1));
    expect(lens(st).sort()).toEqual([20, 20, 40, 40]);
    const dims = st.sketch.constraints.filter((c) => c.kind === "length");
    expect(dims.map((c) => (c as { value: number }).value).sort()).toEqual([20, 40]);
    // Width and height driven; only its position is left free.
    expect(freedom(st.sketch).dof).toBe(2);
    expect(sketchToProfile(st.sketch).ok).toBe(true);
    // The first corner is where the user clicked; the box grows up and to the right.
    const xs = st.sketch.points.map((p) => p.x), ys = st.sketch.points.map((p) => p.y);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([10, 5, 50, 25]);
    expect(st.pending).toEqual([]);
  });
  it("after the first corner, typed W and H go toward the cursor (down-left here)", () => {
    const s1 = ok(click({ ...startEdit(), tool: "rectangle" }, 0, 0, 1));
    const st = ok(placeTyped(s1, [30, 10], { x: -5, y: -3 }, 1));
    const xs = st.sketch.points.map((p) => p.x), ys = st.sketch.points.map((p) => p.y);
    expect([Math.min(...xs), Math.min(...ys)]).toEqual([-30, -10]);
  });
  it("only W typed: the first click places the corner and the next click gives the height", () => {
    const st0: EditState = { ...startEdit(), tool: "rectangle" };
    const s1 = ok(placeTyped(st0, [40, null], { x: 0, y: 0 }, 1));
    expect(s1.pending).toHaveLength(1);
    const s2 = ok(placeTyped(s1, [40, null], { x: 12, y: 15 }, 1));
    expect(lens(s2).sort()).toEqual([15, 15, 40, 40]);
    expect(s2.sketch.constraints.filter((c) => c.kind === "length")).toHaveLength(1);
  });
  it("a line of length 25 at 30°, dimensioned, and the chain continues from its end", () => {
    const s1 = ok(click({ ...startEdit(), tool: "line" }, 0, 0, 1));
    const st = ok(placeTyped(s1, [25, 30], { x: 1, y: 1 }, 1));
    const end = st.sketch.points.find((p) => Math.abs(p.x - 25 * Math.cos(Math.PI / 6)) < 1e-9)!;
    expect(end.y).toBeCloseTo(12.5, 9);
    expect(st.sketch.constraints.find((c) => c.kind === "length")).toMatchObject({ value: 25 });
    expect(st.pending).toHaveLength(1);
  });
  it("a circle of Ø 20 placed with one click, its diameter driving", () => {
    const st = ok(placeTyped({ ...startEdit(), tool: "circle" }, [20], { x: 5, y: 5 }, 1));
    const c = st.sketch.constraints.find((k) => k.kind === "diameter")!;
    expect(c).toMatchObject({ value: 20 });
    expect(measure(st.sketch, { ...c, driven: true } as never)).toBeCloseTo(20, 9);
  });
  it("a typed corner never snaps to a nearby point (the typed size wins)", () => {
    let st = ok(click({ ...startEdit(), tool: "point" }, 40.4, 20.3, 1));
    st = ok(placeTyped({ ...st, tool: "rectangle" }, [40, 20], { x: 0, y: 0 }, 1));
    expect(lens(st).sort()).toEqual([20, 20, 40, 40]);
  });
  it.each([
    ["", "length", null],
    ["40", "length", 40],
    ["12,5", "length", 12.5],
    ["Ø20", "length", 20],
    ["45°", "angle", 45],
    ["-30", "angle", -30],
    ["0", "length", "W must be greater than 0"],
    ["abc", "length", 'W: "abc" is not a number'],
  ] as const)("%j as a %s reads as %j", (text, kind, want) => {
    expect(parseTyped(text, kind, "W")).toBe(want);
  });
  it("the fields each tool offers", () => {
    expect(typedFields("rectangle").map((f) => f.label)).toEqual(["W", "H"]);
    expect(typedFields("line").map((f) => f.label)).toEqual(["Length", "Angle °"]);
    expect(typedFields("circle").map((f) => f.label)).toEqual(["Ø"]);
    expect(typedFields("trim")).toEqual([]);
  });
});

describe("live readout and prompts", () => {
  it("shows W × H, length and angle, Ø for the cursor", () => {
    expect(liveSize("rectangle", { x: 0, y: 0 }, { x: -30, y: 12 })).toEqual([30, 12]);
    expect(liveSize("centreRectangle", { x: 0, y: 0 }, { x: 15, y: 5 })).toEqual([30, 10]);
    expect(liveSize("line", { x: 0, y: 0 }, { x: 0, y: -10 })).toEqual([10, 270]);
    expect(liveSize("circle", { x: 0, y: 0 }, { x: 3, y: 4 })).toEqual([10]);
    expect(liveSize("rectangle", undefined, { x: 1, y: 1 })).toEqual([]);
  });
  it("prompts say what to click next, and that sizes can be typed", () => {
    const st: EditState = { ...startEdit(), tool: "rectangle" };
    expect(promptFor(st)).toBe("Rectangle: click the first corner — or type W and H first (Tab between), then click where it goes.");
    expect(promptFor({ ...st, pending: [{ x: 0, y: 0 }] })).toMatch(/^Rectangle: click the opposite corner/);
    expect(promptFor(st, true)).toMatch(/^Smart Dimension/);
  });
});
