// fix2-cad: pinned reviewer findings on PowerPoint charts, the USPTO sheet, block diagrams, numerals, OBJ faces,
// state and schematic diagrams, DXF reading, sketch dimensions and the numeral extractor. Each describe names the
// finding; every row keeps its outcome in later rounds.
import { DRAWING_STANDARDS, USPTO_VIEW_NUMBER_RATIO } from "../cadStandards";
import { USPTO_REQUIRED_FONT_PT } from "../figureStyle";
import { FONT_PT } from "../diagramCore";
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Mesh, Placement, tessellate } from "../cadModel";
import { layoutSheet, ViewSpec } from "../cadSheet";
import { buildTree } from "../tablediagram";
import { nextFreeNumeral } from "../cadShapes";
import { MAX_NUMERAL, extractNumerals, parseNumeralInput, suggestNextNumeral } from "../numerals";
import { faceTriangles, readObj } from "../obj";
import { layoutFlow, parseFlow } from "../diagramFlow";
import { buildDiagram } from "../diagram";
import { MAX_BULGE, readDxf } from "../dxf";
import { parseDimension } from "../sketchEdit";
import { decimalComma, parseTyped } from "../sketchInput";

// 1. PowerPoint blanks: cad2FixesDom.dom.test.ts (PptxGenJS needs its browser path under jsdom).

let seq = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++seq}`, name: `b${seq}`, spec, placement });
const at = (x: number, y: number, z: number): Placement => ({ translate: [x, y, z], rotateDeg: [0, 0, 0] });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};

describe("2. USPTO view numbers are larger than the reference numerals (37 CFR 1.84(u)(2))", () => {
  test("headingPt is 1.6 × textPt, the diagram figures' FIG. 22.4 pt over 14 pt numerals", () => {
    const u = DRAWING_STANDARDS.uspto;
    expect(u.headingPt).toBeCloseTo(u.textPt * 1.6, 9);
    expect(u.textPt).toBe(USPTO_REQUIRED_FONT_PT);
    expect(USPTO_VIEW_NUMBER_RATIO).toBeCloseTo((FONT_PT * 1.6) / FONT_PT, 9);
    // The dead figurePreset field is gone.
    expect(Object.keys(u)).not.toContain("figurePreset");
  });
  test("on a sheet with a section: FIG. labels and the cutting-line view numbers at heading size, numerals at text size, all inside 170 × 244 mm", () => {
    const m = meshOf(body(box(40, 20, 10)), body(box(10, 10, 20), at(0, 0, 10)));
    const views: ViewSpec[] = [{ kind: "front" }, { kind: "section", label: "A", of: "front", a: [5, -5], b: [5, 40] }];
    const s = layoutSheet(m, { standard: "uspto", lineBudgetMs: 600000, views, callouts: [{ label: "10", anchor: [20, 0, 5] }] });
    expect(s.labels).toEqual(["FIG. 1", "FIG. 2"]);
    const sizeOf = (re: RegExp): number[] => [...s.svg.matchAll(re)].map((x) => Number(x[1]));
    const figSizes = sizeOf(/font-size="([\d.]+)"[^>]*>FIG\. \d/g);
    const cutSizes = sizeOf(/data-cutting-label="A"[^>]*font-size="([\d.]+)"/g);
    const numSizes = sizeOf(/font-size="([\d.]+)"[^>]*>10</g);
    expect(figSizes.length).toBe(2);
    expect(cutSizes.length).toBe(2);
    expect(numSizes.length).toBeGreaterThan(0);
    for (const f of [...figSizes, ...cutSizes]) expect(f).toBeCloseTo(numSizes[0] * 1.6, 1);
    expect(s.widthMm!).toBeLessThanOrEqual(170 + 1e-6);
    expect(s.heightMm!).toBeLessThanOrEqual(244 + 1e-6);
    expect(s.notes).toEqual([]);
  });
});

describe("3. Block diagram: one box per node", () => {
  const labels = (ns: Array<{ label: string; children: unknown[] }>): unknown => ns.map((n) => [n.label, labels(n.children as never)]);
  test("a root repeated after another root is one box", () => {
    const t = buildTree([
      ["Robot", "Arm"],
      ["Car", "Wheel"],
      ["Robot", "Base"],
    ]);
    expect(labels(t.roots)).toEqual([
      ["Robot", [["Arm", []], ["Base", []]]],
      ["Car", [["Wheel", []]]],
    ]);
  });
  test("a Parent | Child table is a list of edges (one tree, Arm once)", () => {
    const t = buildTree([
      ["Parent", "Child"],
      ["Robot", "Arm"],
      ["Arm", "Gripper"],
      ["Robot", "Base"],
      ["Base", "Motor"],
    ]);
    expect(labels(t.roots)).toEqual([["Robot", [["Arm", [["Gripper", []]]], ["Base", [["Motor", []]]]]]]);
  });
  test("…recognised without the header when a child is a parent elsewhere; a forest only when disconnected", () => {
    const t = buildTree([
      ["Arm", "Gripper"],
      ["Robot", "Arm"],
      ["Pump", "Valve"],
    ]);
    expect(labels(t.roots)).toEqual([
      ["Robot", [["Arm", [["Gripper", []]]]]],
      ["Pump", [["Valve", []]]],
    ]);
  });
  test("a loop is refused by name; a second parent and a self-edge are said", () => {
    const loop = buildTree([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ]);
    expect(loop.roots).toEqual([]);
    expect(loop.warnings.join(" ")).toMatch(/form a loop \(A → B → C → A\)/);
    const two = buildTree([
      ["Parent", "Child"],
      ["A", "C"],
      ["B", "C"],
      ["C", "C"],
    ]);
    expect(labels(two.roots)).toEqual([["A", [["C", []]]], ["B", []]]);
    expect(two.warnings.join(" ")).toMatch(/“C” has two parents \(A and B\)/);
    expect(two.warnings.join(" ")).toMatch(/cannot be its own child/);
  });
  test("numerals stay unique per node", async () => {
    const { layoutHierarchy } = await import("../tablediagram");
    const L = layoutHierarchy(
      [
        ["Parent", "Child"],
        ["Robot", "Arm"],
        ["Arm", "Gripper"],
        ["Robot", "Base"],
      ],
      "",
      { numerals: true },
    );
    const nums = L.texts.map((t) => t.text).filter((t) => /^\d+$/.test(t));
    expect(nums.length).toBe(4);
    expect(new Set(nums).size).toBe(4);
  });
});

describe("4. Numerals are at most five digits; the next-numeral search always ends", () => {
  test.each([
    [10, [], 10],
    [10, [10, 12], 14],
    [2 ** 53, [], 10],
    [2 ** 53, [10], 12],
    [Number.MAX_SAFE_INTEGER, [], 10],
    [99998, [99998], 10],
    [99999, [99999], 10],
    [Infinity, [], 10],
  ])("nextFreeNumeral(%p, %p) = %p", (base, taken, want) => expect(nextFreeNumeral(base as number, taken as number[])).toBe(want));
  test("every numeral taken from 10 to 99999 still returns (a free one below 10)", () => {
    const taken = Array.from({ length: MAX_NUMERAL - 9 }, (_, i) => i + 10);
    expect(nextFreeNumeral(50, taken)).toBe(1);
  });
  test.each([
    ["12", 12],
    ["99999", 99999],
    ["100000", 0],
    ["1e20", 0],
    ["9007199254740992", 0],
    ["12.5", 0],
    ["", 0],
    ["-4", 0],
  ])("the Numerals box %p reads %p", (raw, want) => expect(parseNumeralInput(raw)).toBe(want));
  test("a numeral past 99999 in the table is ignored by the suggestion; at the cap the suggestion restarts at 10", () => {
    expect(suggestNextNumeral([{ numeral: 2 ** 53, element: "x" }, { numeral: 12, element: "y" }])).toBe(14);
    expect(suggestNextNumeral([{ numeral: 99998, element: "x" }])).toBe(10);
  });
});

describe("5. OBJ: a concave face is ear-clipped, a convex one keeps its fan", () => {
  // An L-shaped face in the z = 0 plane: (0,0) (2,0) (2,1) (1,1) (1,2) (0,2), counter-clockwise from +z.
  const L6 = [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0];
  const area2 = (tris: Array<[number, number, number]>, v: number[], ax = 0, ay = 1): number[] =>
    tris.map(([a, b, c]) => (v[3 * b + ax] - v[3 * a + ax]) * (v[3 * c + ay] - v[3 * a + ay]) - (v[3 * b + ay] - v[3 * a + ay]) * (v[3 * c + ax] - v[3 * a + ax]));
  test("the L face: 4 triangles, all wound as the face, covering its area (3) exactly", () => {
    const t = faceTriangles([0, 1, 2, 3, 4, 5], L6);
    expect(t.length).toBe(4);
    const a = area2(t, L6);
    for (const x of a) expect(x).toBeGreaterThan(0);
    expect(a.reduce((s, x) => s + x, 0) / 2).toBeCloseTo(3, 12);
  });
  test("the same face wound the other way (normal −z) stays wound that way", () => {
    const t = faceTriangles([5, 4, 3, 2, 1, 0], L6);
    expect(t.length).toBe(4);
    for (const x of area2(t, L6)) expect(x).toBeLessThan(0);
    expect(area2(t, L6).reduce((s, x) => s + x, 0) / 2).toBeCloseTo(-3, 12);
  });
  test("in a tilted plane (x = 5, face in y–z): 4 triangles, total area 3", () => {
    const v = [5, 0, 0, 5, 2, 0, 5, 2, 1, 5, 1, 1, 5, 1, 2, 5, 0, 2];
    const t = faceTriangles([0, 1, 2, 3, 4, 5], v);
    expect(t.length).toBe(4);
    expect(Math.abs(area2(t, v, 1, 2).reduce((s, x) => s + x, 0)) / 2).toBeCloseTo(3, 12);
    for (const x of area2(t, v, 1, 2)) expect(x).toBeGreaterThan(0);
  });
  test("a convex quad is the fan from its first corner, unchanged", () => {
    expect(faceTriangles([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });
  test("readObj: the L face as facets — no facet outside the face (the fan from corner 1 spilled into the notch)", () => {
    const r = readObj(new TextEncoder().encode(["v 0 0 0", "v 2 0 0", "v 2 1 0", "v 1 1 0", "v 1 2 0", "v 0 2 0", "f 1 2 3 4 5 6"].join("\n")));
    if (!r.ok) throw new Error(r.reason);
    expect(r.stl.count).toBe(4);
    const c = Array.from(r.stl.corners);
    // Every facet's centroid lies inside the L (not in the square 1..2 × 1..2).
    for (let i = 0; i < c.length; i += 9) {
      const cx = (c[i] + c[i + 3] + c[i + 6]) / 3, cy = (c[i + 1] + c[i + 4] + c[i + 7]) / 3;
      expect(cx > 1 && cy > 1).toBe(false);
    }
  });
  test("a self-crossing face keeps the fan (no refusal, no hang)", () => {
    const bow = [0, 0, 0, 2, 2, 0, 2, 0, 0, 0, 2, 0, 1, 3, 0];
    expect(faceTriangles([0, 1, 2, 3, 4], bow).length).toBe(3);
  });
});

describe("6a. State diagram: edges from one box never share a segment", () => {
  const src = "[*] -> A\nA -> B : go\nB -> A : back\nA -> C : skip\nB -> C : next\nC -> C : self\nC -> A : reset with a long label text\nC -> [*]";
  test("C -> A and C -> [*] leave C from different points", () => {
    const L = layoutFlow("state", parseFlow("state", src));
    const fromC = L.routes.filter((r) => r.edge.from === "C" && r.edge.to !== "C");
    expect(fromC.length).toBe(2);
    const [p, q] = fromC.map((r) => r.pts[0]);
    expect(Math.abs(p[0] - q[0])).toBeGreaterThanOrEqual(10);
    // No two routes overlap along a collinear segment (other than a shared fan-out bus).
    type Seg = { x1: number; y1: number; x2: number; y2: number; k: number };
    const segs: Seg[] = [];
    L.routes.forEach((r, k) => r.pts.slice(1).forEach((b, i) => segs.push({ x1: r.pts[i][0], y1: r.pts[i][1], x2: b[0], y2: b[1], k })));
    for (const a of segs)
      for (const b of segs) {
        if (a.k >= b.k) continue;
        const vert = a.x1 === a.x2 && b.x1 === b.x2 && Math.abs(a.x1 - b.x1) < 0.5;
        const horiz = a.y1 === a.y2 && b.y1 === b.y2 && Math.abs(a.y1 - b.y1) < 0.5;
        const overlap = vert
          ? Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2))
          : horiz
            ? Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2))
            : 0;
        expect([L.routes[a.k].edge.from, L.routes[a.k].edge.to, L.routes[b.k].edge.from, L.routes[b.k].edge.to, overlap > 0.5]).toEqual([
          L.routes[a.k].edge.from,
          L.routes[a.k].edge.to,
          L.routes[b.k].edge.from,
          L.routes[b.k].edge.to,
          false,
        ]);
      }
  });
});

describe("6b. Schematic: labels clear of other parts' symbols", () => {
  const boxOf = (svg: string, label: string): number[] => {
    const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)" text-anchor="(start|middle|end)"[^>]*>${label}</text>`).exec(svg);
    if (!m) throw new Error(`no label ${label}`);
    return [Number(m[1]), Number(m[2])];
  };
  test("LED1 beside a battery: LED1 no longer sits on the battery's “+”", () => {
    const r = buildDiagram("schematic", "LED1 led 17,0 17,-2\nB1 battery 19,0 19,-2 9V");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.notes.filter((n) => /overlap/.test(n))).toEqual([]);
    const [, ly] = boxOf(r.svg, "LED1");
    const plus = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>\+<\/text>/.exec(r.svg)!;
    // The label's line and the "+"'s line do not share a band of text height.
    expect(Math.abs(ly - Number(plus[2]))).toBeGreaterThan(FONT_PT * 0.8);
  });
  test("two parts too close for any spot: said, never shrunk", () => {
    const r = buildDiagram("schematic", "Q2 pnp 30,0\nM2 pmos 32,0\nlabel OUT 28,0");
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.notes).toContain("The label of Q2 overlaps the symbol of M2 — place the parts further apart.");
  });
  test("a label moved to the left of a vertical part stays on the figure", () => {
    const r = buildDiagram("schematic", "R1 resistor 0,0 0,-2 10k\nR2 resistor 1,0 1,-2 22k");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const [x] = boxOf(r.svg, "R1 10k");
    expect(x).toBeGreaterThanOrEqual(0);
  });
});

describe("DXF: $INSUNITS 21, truncated entities, huge bulges", () => {
  const dxf = (header: string[], ents: string[]): string =>
    [...(header.length ? ["0", "SECTION", "2", "HEADER", ...header, "0", "ENDSEC"] : []), "0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"].join("\r\n") + "\r\n";
  const LINE = ["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0"];
  test("$INSUNITS 21 is the US survey foot, 1200/3937 m", () => {
    const r = readDxf(dxf(["9", "$INSUNITS", "70", "21"], LINE));
    if (!r.ok) throw new Error(r.reason);
    expect(r.drawing.units).toEqual({ code: 21, name: "US survey feet", mmPerUnit: 1200000 / 3937 });
    expect(r.drawing.units.mmPerUnit).toBeCloseTo(304.8006096, 7);
  });
  test("a LINE cut short (no end point) is refused by name, not drawn to the origin", () => {
    const r = readDxf(dxf([], ["0", "LINE", "5", "2A", "8", "0", "10", "3", "20", "4"]));
    expect(r).toEqual({ ok: false, reason: "a LINE (handle 2A) has no end point (group code 11) — the file may be cut short; save it again from the CAD program" });
    const c = readDxf(dxf([], ["0", "CIRCLE", "8", "0", "10", "3", "20", "4"]));
    expect(c.ok).toBe(false);
  });
  test("an ARC with its 0° start angle left out is still read", () => {
    const r = readDxf(dxf([], ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "5", "51", "90"]));
    expect(r.ok).toBe(true);
  });
  test.each([1e9, 1e300])("a bulge of %p is capped at MAX_BULGE, finite, and said", (b) => {
    const r = readDxf(dxf([], ["0", "LWPOLYLINE", "8", "0", "90", "2", "70", "0", "10", "0", "20", "0", "42", String(b), "10", "1", "20", "0"]));
    if (!r.ok) throw new Error(r.reason);
    const bb = r.drawing.bounds!;
    for (const v of Object.values(bb)) expect(Number.isFinite(v)).toBe(true);
    // Capped: a near-full circle of radius about chord × MAX_BULGE / 4 (250 for a chord of 1), never 10¹⁶.
    expect(Math.max(...Object.values(bb).map(Math.abs))).toBeLessThan(1000);
    expect(r.drawing.notes.join(" ")).toMatch(new RegExp(`bulge larger than ${MAX_BULGE}`));
  });
});

describe("Sketch dimensions: the decimal-comma rule, ambiguous refused", () => {
  test.each([
    ["2,5", "2.5"],
    ["Ø20", "Ø20"],
    ["1,000", null],
    ["1,000 mm", null],
    ["Ø1,000", null],
    ["1,0000", "1.0000"],
    ["12,25", "12.25"],
  ])("decimalComma(%p) = %p", (t, want) => expect(decimalComma(t)).toBe(want));
  test("parseTyped and parseDimension refuse “1,000” by name and read “2,5”", () => {
    expect(parseTyped("1,000", "length", "Width")).toBe('Width: "1,000" is ambiguous — type 1000 for a thousand, or 1.000 with a point');
    expect(parseTyped("2,5", "length", "Width")).toBe(2.5);
    expect(parseDimension("1,000", "distance" as never)).toBe('"1,000" is ambiguous — type 1000 for a thousand, or 1.000 with a point');
    expect(parseDimension("2,5", "distance" as never)).toBe(2.5);
  });
});

describe("Numeral extractor: ranges and the double prime", () => {
  test.each([
    ["walls (30-34) and (36)", [30, 34, 36], [30, 32, 34, 36]],
    ["walls (30–34)", [30, 34], [30, 32, 34]],
    ["the tab (12″)", [12], [12]],
    ["(12, 14–18)", [12, 14, 18], [12, 14, 16, 18]],
  ])("%p", (text, bare, withTable) => {
    expect(extractNumerals(text)).toEqual(bare);
    expect(extractNumerals(text, [10, 12, 14, 16, 18, 30, 32, 34, 36])).toEqual(withTable);
  });
  test("a year range is not a callout; an unclosed long list stays fast", () => {
    expect(extractNumerals("as in (2014–2015)")).toEqual([]);
    // Every separator reads its spaces one way, so this returns (an exponential scan would hang the suite).
    expect(extractNumerals("(" + "12 - ".repeat(5000))).toEqual([]);
  });
});

