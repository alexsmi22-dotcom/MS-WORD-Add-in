import { parseMarks, simplifyStroke, markSvg, markDistance, marksExtent, MARK_LIMITS, SheetMark, MarkStyle } from "../cadMarks";
import { layoutSheet } from "../cadSheet";
import { tessellate, box, IDENTITY_PLACEMENT, Mesh } from "../cadModel";
import { parseDoc, serializeDoc, starterDoc } from "../cadShapes";

const style: MarkStyle = { X: (x) => 100 + 2 * x, Y: (y) => 200 - 2 * y, strokePx: 1, fontPx: 10, font: "Arial" };

function blockMesh(): Mesh {
  const t = tessellate({ version: 1, bodies: [{ id: "b", name: "Block", spec: box(40, 30, 20), placement: IDENTITY_PLACEMENT }] });
  if (!t.ok) throw new Error(t.reason);
  return t.mesh;
}

describe("saved marks are read field by field", () => {
  test("every kind round-trips; none saved is none", () => {
    const marks: SheetMark[] = [
      { kind: "pen", view: "front", pts: [[0, 0], [1, 2], [3, 1]] },
      { kind: "line", view: "top", a: [0, 0], b: [5, 5], arrow: true },
      { kind: "line", view: "top", a: [0, 0], b: [5, 0] },
      { kind: "text", view: "iso", at: [1, 1], text: "TABLE TOP" },
      { kind: "numeral", view: "iso", tip: [2, 2], at: [9, 9], label: "14" },
    ];
    expect(parseMarks(JSON.parse(JSON.stringify(marks)))).toEqual({ ok: true, marks });
    expect(parseMarks(undefined)).toEqual({ ok: true, marks: [] });
  });
  test.each([
    ["an unknown kind", { kind: "blob", view: "front" }],
    ["a stroke of one point", { kind: "pen", view: "front", pts: [[0, 0]] }],
    ["a number that is not one", { kind: "line", view: "front", a: [0, null], b: [1, 1] }],
    ["empty text", { kind: "text", view: "front", at: [0, 0], text: "" }],
    ["no view", { kind: "text", at: [0, 0], text: "A" }],
    ["a numeral with no label", { kind: "numeral", view: "front", tip: [0, 0], at: [1, 1] }],
  ])("%s is refused by its number", (_why, m) => {
    expect(parseMarks([{ kind: "text", view: "front", at: [0, 0], text: "ok" }, m])).toEqual({ ok: false, reason: "hand-drawn mark 2 is damaged" });
  });
  test("too many marks, or not a list", () => {
    expect(parseMarks(new Array(MARK_LIMITS.marks + 1).fill({ kind: "text", view: "front", at: [0, 0], text: "a" }))).toEqual({ ok: false, reason: `it has more than ${MARK_LIMITS.marks} hand-drawn marks` });
    expect(parseMarks({})).toEqual({ ok: false, reason: "its hand-drawn marks are damaged" });
  });
});

describe("a stroke is kept as drawn", () => {
  test("points closer than the step go; the ends stay", () => {
    expect(simplifyStroke([[0, 0], [0.1, 0], [0.2, 0], [1, 0], [1.05, 0], [2, 0]], 0.5)).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(simplifyStroke([[0, 0], [0.1, 0]], 0.5)).toEqual([[0, 0], [0.1, 0]]);
  });
  test("a very long stroke is thinned to the limit, never refused", () => {
    const pts: Array<[number, number]> = Array.from({ length: 20000 }, (_, i) => [i, Math.sin(i)]);
    const out = simplifyStroke(pts, 0);
    expect(out.length).toBeLessThanOrEqual(MARK_LIMITS.points);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe("marks as SVG", () => {
  test("an arrowhead ends exactly at the point shown", () => {
    const svg = markSvg({ kind: "line", view: "front", a: [0, 0], b: [10, 0], arrow: true }, style);
    // b → (120, 200); the head is a filled triangle whose first corner is the tip.
    expect(svg).toContain('<path d="M100 200L120 200"');
    expect(svg).toMatch(/<path d="M120 200L110 203\.33L110 196\.67Z" fill="#000"/);
  });
  test("a numeral's lead line stops short of the number (37 CFR 1.84(q)) and reaches the point", () => {
    const svg = markSvg({ kind: "numeral", view: "front", tip: [0, 0], at: [10, 0], label: "10" }, style);
    expect(svg).toContain('<path d="M112 200L100 200"');
    expect(svg).toContain(">10</text>");
  });
  test("text is escaped", () => {
    expect(markSvg({ kind: "text", view: "front", at: [0, 0], text: 'A<B & "C"' }, style)).toContain(">A&lt;B &amp; &quot;C&quot;</text>");
  });
  test("the eraser finds a mark by its distance on the sheet", () => {
    const m: SheetMark = { kind: "pen", view: "front", pts: [[0, 0], [10, 0]] };
    expect(markDistance(m, style, 110, 201)).toBeCloseTo(1);
    expect(markDistance(m, style, 110, 230)).toBeCloseTo(30);
    expect(markDistance({ kind: "text", view: "front", at: [0, 0], text: "AB" }, style, 105, 197)).toBe(0);
  });
  test("the extent holds text at its size", () => {
    expect(marksExtent([{ kind: "text", view: "front", at: [0, 0], text: "AB" }], 10)).toEqual({ minX: 0, minY: -2.5, maxX: 16, maxY: 8 });
    expect(marksExtent([], 10)).toBeNull();
  });
});

describe("marks on the sheet", () => {
  const views = [{ kind: "front" as const }, { kind: "top" as const }, { kind: "iso" as const }];
  test("drawn in their own layer, on their own view, with each view's frame returned", () => {
    const sh = layoutSheet(blockMesh(), { standard: "uspto", views, marks: [{ kind: "text", view: "iso", at: [0, 0], text: "TOP" }] });
    expect(sh.svg).toContain('<g data-layer="markup">');
    expect(sh.svg).toContain(">TOP</text>");
    expect(sh.frames!.map((f) => f.view).sort()).toEqual(["front", "iso", "top"]);
  });
  test("a click on the sheet maps into the view and back to the same place", () => {
    const sh = layoutSheet(blockMesh(), { standard: "uspto", views });
    const f = sh.frames!.find((q) => q.view === "front")!;
    const px = f.cell.x + 13, py = f.cell.y + 7;
    const v = [(px - f.ox) / f.k + f.minX, (f.oyBottom - py) / f.k + f.minY];
    expect(f.ox + (v[0] - f.minX) * f.k).toBeCloseTo(px, 9);
    expect(f.oyBottom - (v[1] - f.minY) * f.k).toBeCloseTo(py, 9);
  });
  test("a mark beyond its figure gets room, and the front and top views stay aligned", () => {
    const sh = layoutSheet(blockMesh(), { standard: "uspto", views, marks: [{ kind: "line", view: "front", a: [-60, 10], b: [0, 10], arrow: true }] });
    const front = sh.frames!.find((q) => q.view === "front")!, top = sh.frames!.find((q) => q.view === "top")!;
    expect(front.minX).toBeCloseTo(-60, 6);
    expect(top.minX).toBe(front.minX);
    expect(top.ox).toBeCloseTo(front.ox, 9);
  });
  test("marks on a view not on the sheet are named in a note", () => {
    const sh = layoutSheet(blockMesh(), { standard: "uspto", views, marks: [{ kind: "text", view: "right", at: [0, 0], text: "X" }, { kind: "text", view: "right", at: [1, 0], text: "Y" }] });
    expect(sh.notes).toContain("2 hand-drawn marks belong to the right view, which is not on this sheet.");
  });
});

describe("marks travel with the drawing", () => {
  test("they are saved in the model and read back; an empty list is not saved", () => {
    const d = { ...starterDoc("uspto"), marks: [{ kind: "numeral", view: "front", tip: [1, 1], at: [5, 5], label: "10" }] as SheetMark[] };
    const r = parseDoc(serializeDoc(d));
    expect(r.ok && r.doc.marks).toEqual(d.marks);
    const e = parseDoc(serializeDoc({ ...starterDoc("uspto"), marks: [] }));
    expect(e.ok && "marks" in e.doc).toBe(false);
  });
  test("a damaged mark refuses the drawing by name", () => {
    expect(parseDoc(JSON.stringify({ ...starterDoc("uspto"), marks: [{ kind: "pen", view: "front", pts: "x" }] }))).toEqual({ ok: false, reason: "hand-drawn mark 1 is damaged" });
  });
});

describe("a blank figure: no model, only what is drawn on it", () => {
  const EMPTY: Mesh = { positions: [], triangles: [], cornerNormals: [], triBody: [], edges: [], diag: 1, crossings: [], overlaps: [], bodySag: [] };
  test("with no parts, only the blank figure is laid out, and the note says why", () => {
    const sh = layoutSheet(EMPTY, { standard: "uspto", views: [{ kind: "front" }, { kind: "blank" }], marks: [{ kind: "pen", view: "blank", pts: [[10, 10], [50, 40]] }] });
    expect(sh.frames!.map((f) => f.view)).toEqual(["blank"]);
    expect(sh.labels).toEqual(["FIG. 1"]);
    expect(sh.notes).toContain("There are no parts yet, so only the blank figure is drawn.");
    expect(sh.svg).toContain('<g data-layer="markup">');
  });
  test("with no parts and no blank figure there is no sheet, and it says what to do", () => {
    const sh = layoutSheet(EMPTY, { standard: "uspto", views: [{ kind: "front" }] });
    expect(sh.svg).toBe("");
    expect(sh.notes).toEqual(["Add a part, or tick Blank figure to draw freehand."]);
  });
  test("beside a model it takes the model's size, and callouts never land on it", () => {
    const sh = layoutSheet(blockMesh(), { standard: "uspto", views: [{ kind: "front" }, { kind: "blank" }], callouts: [{ anchor: [20, 0, 10], label: "10" }] });
    const blank = sh.frames!.find((f) => f.view === "blank")!;
    expect(blank.minX).toBe(0);
    expect((sh.svg.match(/>10<\/text>/g) ?? []).length).toBe(1); // in the front view only
  });
  test("a saved blank figure reopens", () => {
    const r = parseDoc(serializeDoc({ ...starterDoc("uspto"), parts: [], views: [{ kind: "blank" }] }));
    expect(r.ok && r.doc.views).toEqual([{ kind: "blank" }]);
  });
});
