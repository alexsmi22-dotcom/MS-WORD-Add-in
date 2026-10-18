// The sketch canvas's decisions (docs/SCOPE-CAD-R2.md, R2a): tools, snapping, relations
// and dimensions on a selection, dimension text (display is a contract), delete, status.
import { startEdit, click, applyRelation, applyDimension, editDimension, deleteSelection, statusLine, parseDimension, formatDimension, EditState, SketchTool, drag } from "../sketchEdit";
import { Sketch } from "../sketch";
import { sketchOps, frameSketch } from "../sketchRender";

/** The dimension texts the canvas draws (driven ones in parentheses). */
const dimensionLabels = (s: Sketch) =>
  sketchOps(s, frameSketch(s, 400, 300))
    .filter((o) => o.op === "text" && o.kind !== "glyph")
    .map((o) => ({ text: (o as { text: string }).text, driven: (o as { kind: string }).kind === "driven" }));
import { sketchToProfile } from "../sketchProfile";

const tool = (st: EditState, t: SketchTool): EditState => ({ ...st, tool: t, pending: [] });
const clicks = (st: EditState, pts: Array<[number, number]>, tol = 0.5): EditState =>
  pts.reduce((s, [x, y]) => {
    const r = click(s, x, y, tol);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }, st);
const P = (s: Sketch, id: string) => s.points.find((p) => p.id === id)!;
const kinds = (s: Sketch) => s.constraints.map((c) => c.kind).sort();

describe("drawing tools", () => {
  it("a line drawn nearly level gets a horizontal relation, and the next line chains from its end", () => {
    const st = clicks(tool(startEdit(), "line"), [[0, 0], [10, 0.1], [10, 6]]);
    expect(st.sketch.entities).toHaveLength(2);
    expect(kinds(st.sketch)).toEqual(["horizontal", "vertical"]);
    const [l1, l2] = st.sketch.entities as Array<{ a: string; b: string }>;
    expect(l1.b).toBe(l2.a); // shared corner point: chained
    expect(P(st.sketch, l1.a).y).toBeCloseTo(P(st.sketch, l1.b).y, 9); // solved level
  });

  it("a rectangle: four lines on four shared corners, two horizontal and two vertical — a closed profile", () => {
    const st = clicks(tool(startEdit(), "rectangle"), [[0, 0], [40, 25]]);
    expect(st.sketch.points).toHaveLength(4);
    expect(kinds(st.sketch)).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
    expect(sketchToProfile(st.sketch).ok).toBe(true);
    expect(statusLine(st.sketch)).toBe("4 degrees of freedom left — still free: L5, L6, L7, L8. Add relations or dimensions, or drag to see.");
  });

  it("clicking near an existing point reuses it (snapping), so a closed outline closes", () => {
    const st = clicks(tool(startEdit(), "line"), [[0, 0], [10, 0], [5, 8], [0.2, 0.1]]);
    expect(st.sketch.points).toHaveLength(3);
    expect(sketchToProfile(st.sketch).ok).toBe(true);
  });

  it("a circle (centre, then a point on it) and an arc (centre, start, then the end's direction, counter-clockwise)", () => {
    let st = clicks(tool(startEdit(), "circle"), [[0, 0], [3, 4]]);
    expect(st.sketch.entities[0]).toMatchObject({ kind: "circle", r: 5 });
    st = clicks(tool(st, "arc"), [[20, 0], [25, 0], [20, 9]]);
    const arc = st.sketch.entities[1] as { kind: string; a: string; b: string };
    expect(arc.kind).toBe("arc");
    // The end is put exactly on the radius, in the clicked direction.
    expect(P(st.sketch, arc.b)).toMatchObject({ x: expect.closeTo(20, 9), y: expect.closeTo(5, 9) });
  });

  it("degenerate clicks are refused by name", () => {
    const st = tool(startEdit(), "circle");
    const a = click(click(st, 0, 0, 0.5).state, 0.1, 0, 0.5);
    expect(a).toMatchObject({ ok: false, reason: "a circle needs a radius — click farther from the centre" });
    const r = click(click(tool(startEdit(), "rectangle"), 0, 0, 0.5).state, 10, 0.2, 0.5);
    expect(r).toMatchObject({ ok: false, reason: "a rectangle needs width and height — drag the second corner away" });
  });
});

describe("relations and dimensions on the selection", () => {
  const rectangle = (): EditState => clicks(tool(startEdit(), "rectangle"), [[0, 0], [40, 25]]);
  it("width and height dimensions, then anchoring: from 4 degrees of freedom to fully defined", () => {
    let st = rectangle();
    let r = applyDimension({ ...st, selection: ["L5"] }, "60");
    if (!r.ok) throw new Error(r.reason);
    st = r.state;
    r = applyDimension({ ...st, selection: ["L6"] }, "30");
    if (!r.ok) throw new Error(r.reason);
    st = r.state;
    expect(statusLine(st.sketch)).toBe("Fully defined apart from position — fix a point to anchor it.");
    r = applyRelation({ ...st, selection: [st.sketch.points[0].id] }, "fix");
    if (!r.ok) throw new Error(r.reason);
    expect(statusLine(r.state.sketch)).toBe("Fully defined.");
    expect(Math.hypot(P(r.state.sketch, "p2").x - P(r.state.sketch, "p1").x, 0)).toBeCloseTo(60, 9);
  });
  it("a third, redundant dimension is refused and offered as a driven one", () => {
    let st = rectangle();
    st = (applyDimension({ ...st, selection: ["L5"] }, "60") as { state: EditState }).state;
    const r = applyDimension({ ...st, selection: ["L7"] }, "60");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("the 60 length of L7 is already fixed by the sketch's other relations. Add it as a driven (reference) dimension instead?");
    const d = applyDimension({ ...st, selection: ["L7"] }, "", true);
    if (!d.ok) throw new Error(d.reason);
    expect(dimensionLabels(d.state.sketch).find((x) => x.driven)).toMatchObject({ text: "(60)" });
  });
  it("a circle takes Ø, an arc R, two lines an angle in degrees", () => {
    let st = clicks(tool(startEdit(), "circle"), [[0, 0], [5, 0]]);
    const bad = applyDimension({ ...st, selection: [st.sketch.entities[0].id] }, "R4");
    expect(bad).toMatchObject({ ok: false, reason: "this is a diameter (Ø) — type Ø, or the number alone" });
    const ok = applyDimension({ ...st, selection: [st.sketch.entities[0].id] }, "Ø12");
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.state.sketch.entities[0]).toMatchObject({ r: expect.closeTo(6, 9) });
    expect(dimensionLabels(ok.state.sketch)[0].text).toBe("Ø12");
    st = clicks(tool(startEdit(), "line"), [[0, 0], [10, 3]]);
    st = clicks(tool(st, "line"), [[0, 0], [3, 10]]);
    const ang = applyDimension({ ...st, selection: [st.sketch.entities[0].id, st.sketch.entities[1].id] }, "45°");
    if (!ang.ok) throw new Error(ang.reason);
    expect(dimensionLabels(ang.state.sketch)[0].text).toBe("45°");
  });
  it("a relation that does not fit the selection says what to select", () => {
    const st = rectangle();
    expect(applyRelation({ ...st, selection: ["L5"] }, "parallel")).toMatchObject({ ok: false, reason: "select two lines for parallel" });
    expect(applyRelation({ ...st, selection: ["L5", "L7"] }, "parallel")).toMatchObject({ ok: false }); // already parallel through H/H: redundant
  });
  it("editing a dimension re-solves; deleting a line takes its relations with it", () => {
    let st = rectangle();
    st = (applyDimension({ ...st, selection: ["L5"] }, "60") as { state: EditState }).state;
    const dim = st.sketch.constraints.find((c) => c.kind === "length")!;
    const e = editDimension(st, dim.id, "80");
    if (!e.ok) throw new Error(e.reason);
    expect(Math.abs(P(e.state.sketch, "p2").x - P(e.state.sketch, "p1").x)).toBeCloseTo(80, 9);
    const d = deleteSelection({ ...e.state, selection: ["L5"] });
    if (!d.ok) throw new Error(d.reason);
    expect(d.state.sketch.entities).toHaveLength(3);
    expect(d.state.sketch.constraints.some((c) => "line" in c && c.line === "L5")).toBe(false);
  });
  it("dragging a rectangle's corner keeps it a rectangle", () => {
    const st = rectangle();
    const r = drag(st, st.sketch.points[2].id, 50, 30);
    if (!r.ok) throw new Error(r.reason);
    const [p1, p2, p3, p4] = r.state.sketch.points;
    expect(p1.y).toBeCloseTo(p2.y, 9);
    expect(p2.x).toBeCloseTo(p3.x, 9);
    expect(p3.y).toBeCloseTo(p4.y, 9);
  });
});

describe("dimension text: display is a contract", () => {
  it.each([
    ["20", "length", 20],
    ["20 mm", "length", 20],
    ["2,5", "length", 2.5],
    ["Ø20", "diameter", 20],
    ["⌀20", "diameter", 20],
    ["20", "diameter", 20],
    ["R5", "radius", 5],
    ["r5", "radius", 5],
    ["45°", "angle", Math.PI / 4],
    ["45", "angle", Math.PI / 4],
  ] as const)("%j as %s → %p", (text, kind, want) => {
    expect(parseDimension(text, kind)).toBeCloseTo(want, 12);
  });
  it.each([
    ["Ø20", "length", "this dimension is a length — type the number alone"],
    ["45°", "length", "that dimension is a length, not an angle"],
    ["0", "length", "a dimension must be greater than 0 (use a coincident relation for 0)"],
    ["180°", "angle", "an angle must be between 0° and 180°"],
    ["abc", "length", "\"abc\" is not a number"],
    ["", "length", "type a value"],
  ] as const)("%j as %s is refused: %s", (text, kind, why) => {
    expect(parseDimension(text, kind)).toBe(why);
  });
  it("shows Ø, R and ° — and what it shows parses back to the same value", () => {
    for (const [kind, v] of [["diameter", 12.5], ["radius", 3], ["angle", 0.6], ["length", 40]] as const) {
      const c = { id: "x", kind, value: v, ...(kind === "angle" ? { l1: "a", l2: "b", sign: 1 } : kind === "length" ? { line: "L" } : { curve: "C" }) } as never;
      const shown = formatDimension(c);
      expect(parseDimension(shown, kind)).toBeCloseTo(v, 4);
    }
  });
});

describe("sketcher review B2: a dimension's label shows its value as typed", () => {
  it("a 45° angle shows as 45° (not 0.7854) and parses back", () => {
    const c = { id: "a", kind: "angle", value: Math.PI / 4, l1: "a", l2: "b", sign: 1 } as never;
    expect(formatDimension(c)).toBe("45°");
    expect(parseDimension("45°", "angle")).toBeCloseTo(Math.PI / 4, 12);
  });
});
