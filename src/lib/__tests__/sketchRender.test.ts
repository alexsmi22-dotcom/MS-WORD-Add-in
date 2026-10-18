// What the sketch canvas draws (docs/SCOPE-CAD-R2.md, R2a).
import { sketchOps, frameSketch, toCanvas, toSketch } from "../sketchRender";
import { startEdit, click, applyDimension, EditState } from "../sketchEdit";
import { freedom, Sketch } from "../sketch";

const rect = (): EditState => {
  let st: EditState = { ...startEdit(), tool: "rectangle" };
  for (const [x, y] of [[0, 0], [40, 25]]) {
    const r = click(st, x, y, 0.5);
    if (!r.ok) throw new Error(r.reason);
    st = r.state;
  }
  return st;
};

describe("the view", () => {
  it("frames the sketch inside the canvas, and canvas ↔ sketch round-trips", () => {
    const st = rect();
    const v = frameSketch(st.sketch, 400, 300);
    for (const p of st.sketch.points) {
      const [cx, cy] = toCanvas(v, p.x, p.y);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(400);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(300);
      const [x, y] = toSketch(v, cx, cy);
      expect(x).toBeCloseTo(p.x, 9);
      expect(y).toBeCloseTo(p.y, 9);
    }
  });
  it("sketch y is up: a higher point is drawn nearer the top of the canvas", () => {
    const v = frameSketch({ points: [], entities: [], constraints: [] }, 400, 300);
    expect(toCanvas(v, 0, 10)[1]).toBeLessThan(toCanvas(v, 0, 0)[1]);
  });
});

describe("what is drawn", () => {
  it("a free rectangle draws blue; dimensioned and anchored it draws black, with its dimension text", () => {
    let st = rect();
    const v = frameSketch(st.sketch, 400, 300);
    const lines = (s: Sketch) => sketchOps(s, v, { free: freedom(s).free }).filter((o) => o.op === "line");
    expect(lines(st.sketch).every((o) => o.op === "line" && o.style === "free")).toBe(true);
    for (const [sel, val] of [["L5", "60"], ["L6", "30"]] as const) {
      const r = applyDimension({ ...st, selection: [sel] }, val);
      if (!r.ok) throw new Error(r.reason);
      st = r.state;
    }
    // Fully defined apart from position: nothing is free.
    expect(lines(st.sketch).every((o) => o.op === "line" && o.style === "defined")).toBe(true);
    const texts = sketchOps(st.sketch, v).filter((o) => o.op === "text" && o.kind === "dimension").map((o) => (o as { text: string }).text);
    expect(texts.sort()).toEqual(["30", "60"]);
  });
  it("construction is dashed-style, the selection is highlighted, and H / V glyphs are shown", () => {
    const st = rect();
    const sk: Sketch = { ...st.sketch, entities: st.sketch.entities.map((e, i) => (i === 0 ? { ...e, construction: true } : e)) };
    const ops = sketchOps(sk, frameSketch(sk, 400, 300), { selection: ["L6"] });
    expect(ops.find((o) => o.id === "L5")).toMatchObject({ style: "construction" });
    expect(ops.find((o) => o.id === "L6")).toMatchObject({ style: "selected" });
    expect(ops.filter((o) => o.op === "text" && o.kind === "glyph").map((o) => (o as { text: string }).text).sort()).toEqual(["H", "H", "V", "V"]);
  });
  it("a counter-clockwise arc is drawn clockwise on the canvas (y runs down): same sweep", () => {
    const sk: Sketch = {
      points: [{ id: "o", x: 0, y: 0 }, { id: "a", x: 10, y: 0 }, { id: "b", x: 0, y: 10 }],
      entities: [{ id: "A", kind: "arc", c: "o", a: "a", b: "b" }],
      constraints: [],
    };
    const arc = sketchOps(sk, frameSketch(sk, 400, 300)).find((o) => o.op === "arc") as { a0: number; a1: number };
    expect(arc.a0).toBeCloseTo(0, 12);
    expect(arc.a1).toBeCloseTo(-Math.PI / 2, 12); // a quarter turn, counter-clockwise on screen = negative canvas angle
  });
  it("the tool in progress draws a rubber band to the cursor", () => {
    const st = { ...startEdit(), tool: "rectangle" as const };
    const v = frameSketch(st.sketch, 400, 300);
    const ops = sketchOps(st.sketch, v, { pending: [{ x: 0, y: 0 }, { x: 10, y: 5 }], tool: "rectangle" });
    expect(ops.filter((o) => o.op !== "text" && o.style === "pending")).toHaveLength(4);
  });
});
