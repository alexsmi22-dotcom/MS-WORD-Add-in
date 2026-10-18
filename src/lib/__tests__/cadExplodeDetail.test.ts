// Exploded and detail views (the table release), on the table: a 100 × 60 × 4 top on four
// 5 × 5 × 70 legs at its corners.
import { tessellate, Mesh, Vec3 } from "../cadModel";
import { CadDoc, CadPart, defaultParams, docToAssembly, parseDoc, resolveCallouts, serializeDoc } from "../cadShapes";
import { autoExplode, explodedAnchors, explodedDoc, explodeTrails } from "../cadExplode";
import { clipPolyline, detailDrawing, nextDetailLetter } from "../cadDetail";
import { layoutSheet, ViewSpec } from "../cadSheet";
import { STANDARD_SCALES, scaleLabel as scaleLabelOf } from "../cadStandards";
import { drawLines, STANDARD_VIEWS } from "../cadLines";

const box = (id: string, w: number, d: number, h: number, t: Vec3): CadPart => ({ id, name: id, shape: "box", params: { ...defaultParams("box"), w, d, h }, placement: { translate: t, rotateDeg: [0, 0, 0] } });
const TABLE = (): CadDoc => ({
  v: 1,
  parts: [box("top", 100, 60, 4, [0, 0, 70]), box("leg1", 5, 5, 70, [0, 0, 0]), box("leg2", 5, 5, 70, [95, 0, 0]), box("leg3", 5, 5, 70, [95, 55, 0]), box("leg4", 5, 5, 70, [0, 55, 0])],
  callouts: [],
  standard: "uspto",
  views: [{ kind: "iso" }],
});
const meshOf = (d: CadDoc): Mesh => {
  const a = docToAssembly(d);
  if (!a.ok) throw new Error(a.reason);
  const t = tessellate(a.assembly);
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
};

describe("exploded views", () => {
  test("auto explode lifts the top off the legs (the lowest level stays)", () => {
    const d = TABLE();
    expect(autoExplode(d, meshOf(d))).toEqual({ top: [0, 0, 29.6] });
  });
  test("one trail from the top down to each leg it sits on, from its underside (exploded) to the leg top", () => {
    const d = TABLE();
    const m = meshOf(d);
    const trails = explodeTrails(d, m, { top: [0, 0, 29.6] });
    expect(trails.map(([a, b]) => [a.map((x) => +x.toFixed(6)), b.map((x) => +x.toFixed(6))])).toEqual([
      [[2.5, 2.5, 99.6], [2.5, 2.5, 70]],
      [[97.5, 2.5, 99.6], [97.5, 2.5, 70]],
      [[97.5, 57.5, 99.6], [97.5, 57.5, 70]],
      [[2.5, 57.5, 99.6], [2.5, 57.5, 70]],
    ]);
  });
  test("a sideways move gets one trail back to where the part's face was", () => {
    const d = TABLE();
    const trails = explodeTrails(d, meshOf(d), { leg2: [40, 0, 0] });
    expect(trails.map(([a, b]) => [a.map((x) => +x.toFixed(6)), b.map((x) => +x.toFixed(6))])).toEqual([[[135, 2.5, 35], [95, 2.5, 35]]]);
  });
  test("parts at one height cannot be auto-exploded (nothing sits on anything)", () => {
    const d = TABLE();
    d.parts = d.parts.slice(1);
    expect(autoExplode(d, meshOf(d))).toEqual({});
  });
  test("callouts move with their parts; the exploded document leaves the original alone", () => {
    const d = TABLE();
    d.callouts = [{ anchor: [50, 30, 74], label: "10", part: "top", local: [50, 30, 4] }, { anchor: [1, 1, 1], label: "12" }];
    const m = meshOf(d);
    const placed = resolveCallouts(d, m).callouts;
    expect(explodedAnchors(d, placed, { top: [0, 0, 29.6] }).map((a) => a.map((x) => +x.toFixed(6)))).toEqual([[50, 30, 103.6], [1, 1, 1]]);
    const e = explodedDoc(d, { top: [0, 0, 29.6] });
    expect([e.parts[0].placement.translate, d.parts[0].placement.translate]).toEqual([[0, 0, 99.6], [0, 0, 70]]);
  });
  test("on a USPTO sheet with another figure the exploded view is drawn in brackets, with phantom trail lines", () => {
    const d = TABLE();
    const m = meshOf(d);
    const offsets = autoExplode(d, m);
    const em = meshOf(explodedDoc(d, offsets));
    const sh = layoutSheet(m, {
      standard: "uspto",
      views: [{ kind: "iso" }, { kind: "exploded" }],
      exploded: { mesh: em, anchors: [], trails: explodeTrails(d, m, offsets) },
    });
    expect(sh.labels).toEqual(["FIG. 1", "FIG. 2"]);
    expect(sh.notes).toEqual([]);
    // Phantom: ISO 128 type 05 / ASME phantom, long dash and two short.
    const phantom = sh.svg.match(/stroke-dasharray="([\d. ]+)"/g) ?? [];
    expect(phantom.some((p) => p.split(" ").length === 6)).toBe(true);
    // Brackets: two paths each of four points (lip, corner, corner, lip).
    expect(sh.svg).toMatch(/M[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+"/);
  });
  test("an exploded view with nothing apart is left out, and said", () => {
    const d = TABLE();
    const sh = layoutSheet(meshOf(d), { standard: "uspto", views: [{ kind: "iso" }, { kind: "exploded" }] });
    expect(sh.labels).toEqual(["FIG. 1"]);
    expect(sh.notes).toContain("The exploded view needs the parts apart: press Auto explode, or give a part an explode distance.");
  });
});

describe("detail views", () => {
  test("a line through a circle is cut exactly at the circle; one outside is dropped", () => {
    expect(clipPolyline([[-10, 0], [10, 0]], [0, 0], 5)).toEqual([[[-5, 0], [5, 0]]]);
    expect(clipPolyline([[-10, 9], [10, 9]], [0, 0], 5)).toEqual([]);
    // A polyline running in, along, and out stays one piece inside.
    expect(clipPolyline([[-10, 0], [0, 0], [0, 10]], [0, 0], 5)).toEqual([[[-5, 0], [0, 0], [0, 5]]]);
  });
  test("the detail is the parent's lines inside the circle, enlarged about its centre, with the circle as its boundary", () => {
    const d = TABLE();
    const front = drawLines(meshOf(d), STANDARD_VIEWS.front);
    const dt = detailDrawing(front, [2.5, 70], 8, 3);
    expect(dt.bounds).toEqual({ minX: -21.5, minY: 46, maxX: 26.5, maxY: 94 });
    for (const l of [...dt.visible, ...dt.hidden]) for (const [x, y] of l) expect(Math.hypot(x - 2.5, y - 70)).toBeLessThanOrEqual(24 + 1e-6);
    expect(dt.visible.length).toBeGreaterThan(0);
  });
  test("letters run A, B, … skipping I, O and Q", () => {
    expect(nextDetailLetter([])).toBe("A");
    expect(nextDetailLetter(["A", "B", "C", "D", "E", "F", "G", "H"])).toBe("J");
  });
  const withDetail = (standard: CadDoc["standard"]): ReturnType<typeof layoutSheet> => {
    const d = TABLE();
    const views: ViewSpec[] = [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r: 8, factor: 3 }];
    return layoutSheet(meshOf(d), { standard, views });
  };
  test("USPTO: the detail is a figure of its own, and its circle on the parent is named with that figure", () => {
    const sh = withDetail("uspto");
    expect(sh.labels).toEqual(["FIG. 1", "FIG. 2"]);
    expect(sh.svg.match(/>FIG\. 2</g)).toHaveLength(2); // under the detail, and beside its circle
  });
  test("ASME: DETAIL A over SCALE k, k the standard scale nearest the enlargement asked; the circle is lettered A", () => {
    const sh = withDetail("asme");
    const scale = sh.scaleMmPerUnit;
    expect(sh.labels[0]).toBe("FRONT");
    expect(sh.labels[1]).toMatch(/^DETAIL A SCALE /);
    const [a, b] = sh.labels[1].replace("DETAIL A SCALE ", "").split(":").map(Number);
    // A standard scale (ASME's 1-2-5 series), larger than the sheet's.
    expect(STANDARD_SCALES.some((x) => Math.abs(x - a / b) < 1e-9)).toBe(true);
    expect(a / b).toBeGreaterThan(scale);
    // Two lines under the view, as ASME writes them.
    expect(sh.svg).toContain(">DETAIL A</text>");
    expect(sh.svg).toMatch(/>SCALE [\d.]+:[\d.]+<\/text>/);
    expect(sh.svg).toContain(">A</text>");
    // When that is not the enlargement asked, the sheet says so.
    if (Math.abs(a / b / scale - 3) > 1e-9) expect(sh.notes.join(" ")).toMatch(/^Detail A is drawn at /);
  });
  test("ISO: A (k:1)", () => {
    expect(withDetail("iso").labels[1]).toMatch(/^A \([\d.]+:[\d.]+\)$/);
  });
  test("a detail of a view not on the sheet is left out and said (1.84(h)(2): both views are shown)", () => {
    const d = TABLE();
    const sh = layoutSheet(meshOf(d), { standard: "uspto", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "top", at: [2.5, 2.5], r: 8, factor: 2 }] });
    expect(sh.labels).toEqual(["FIG. 1"]);
    expect(sh.notes).toContain("Detail A is of the top view, which is not on this sheet, so it is not drawn: tick that view too.");
  });
  test("a circle larger than its figure, or one holding nothing of it, is refused by name (it would shrink the sheet, or show nothing)", () => {
    const d = TABLE();
    const m = meshOf(d);
    const big = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [50, 37], r: 500, factor: 2 }] });
    expect(big.notes).toContain("Detail A's circle is larger than the figure it enlarges, so it is not drawn: make its radius smaller.");
    expect(big.labels).toEqual(["FIG. 1"]);
    const empty = layoutSheet(m, { standard: "uspto", views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [50, 30], r: 5, factor: 2 }] });
    expect(empty.notes).toContain("Detail A's circle holds nothing of the figure, so it is not drawn: take it again on the part to enlarge.");
  });
  test("ASME, ISO: the sheet settles on a standard scale and the detail's label is a standard scale too (several sizes)", () => {
    const d = TABLE();
    const m = meshOf(d);
    for (const standard of ["asme", "iso"] as const)
      for (const r of [3, 5, 12, 25])
        for (const factor of [2, 3, 4, 5, 10]) {
          const sh = layoutSheet(m, { standard, views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r, factor }] });
          if (!sh.svg) continue;
          const k = /([\d.]+):([\d.]+)/.exec(sh.labels[3])!;
          const val = Number(k[1]) / Number(k[2]);
          expect([standard, r, factor, STANDARD_SCALES.some((x) => Math.abs(x - val) < 1e-9)]).toEqual([standard, r, factor, true]);
          // Any note names the sheet's real scale.
          for (const n of sh.notes.filter((q) => q.startsWith("Detail A is drawn at"))) expect(n).toContain(`this sheet's ${scaleLabelOf(sh.scaleMmPerUnit)}`);
        }
  });
  test("marks drawn on a detail belong to it (by its letter)", () => {
    const d = TABLE();
    const sh = layoutSheet(meshOf(d), {
      standard: "uspto",
      views: [{ kind: "front" }, { kind: "detail", letter: "A", of: "front", at: [2.5, 70], r: 8, factor: 3 }],
      marks: [{ kind: "text", view: "detail:A", at: [0, 60], text: "JOINT" }],
    });
    expect(sh.svg).toContain(">JOINT<");
    expect(sh.frames?.map((f) => f.view)).toEqual(["front", "detail:A"]);
  });
});

describe("saved and read back", () => {
  test("explode distances and detail views survive the alt text; damaged ones are refused by name", () => {
    const d = TABLE();
    d.explode = { top: [0, 0, 29.6] };
    d.views = [{ kind: "iso" }, { kind: "exploded" }, { kind: "detail", letter: "A", of: "exploded", at: [1, 2], r: 5, factor: 4 }];
    const r = parseDoc(serializeDoc(d));
    expect(r.ok && [r.doc.explode, r.doc.views]).toEqual([d.explode, d.views]);
    const bad = (patch: (x: Record<string, unknown>) => void): string => {
      const x = JSON.parse(serializeDoc(d));
      patch(x);
      const q = parseDoc(JSON.stringify(x));
      return q.ok ? "ok" : q.reason;
    };
    expect(bad((x) => (((x.views as Array<Record<string, unknown>>)[2]).factor = 7))).toBe("a detail view in the drawing is damaged");
    expect(bad((x) => (x.views as unknown[]).push({ kind: "detail", letter: "A", of: "front", at: [0, 0], r: 1, factor: 2 }))).toBe("a detail view in the drawing is damaged");
    expect(bad((x) => (x.explode = { top: [0, "up", 0] }))).toBe("the drawing's exploded view is damaged");
    // A key that names no part is dropped; "__proto__" is never a part.
    const r2 = parseDoc(JSON.stringify({ ...JSON.parse(serializeDoc(d)), explode: JSON.parse('{"__proto__":[1,2,3],"ghost":[1,1,1],"top":[0,0,5]}') }));
    expect(r2.ok && r2.doc.explode).toEqual({ top: [0, 0, 5] });
  });
});
