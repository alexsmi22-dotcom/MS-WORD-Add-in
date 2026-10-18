/**
 * @jest-environment jsdom
 */
// The DXF import's independent review — every confirmed finding pinned (repros from the reviewer).
import { TextDecoder as NodeTextDecoder } from "util";
import { readDxf, DXF_LIMITS, xmlSafe, wrapLines } from "../dxf";
import { dxfFigure, dxfSketch } from "../dxfOut";
import { sizeRefusal, importedSketch } from "../dxfImport";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

type G = Array<[number, string | number]>;
const NL = String.fromCharCode(13, 10);
const dxf = (entities: G[], blocks: G[] = []): string => {
  const out: Array<string | number> = [];
  const put = (c: number, v: string | number): void => void out.push(c, v);
  put(0, "SECTION"); put(2, "HEADER"); put(9, "$INSUNITS"); put(70, 4); put(0, "ENDSEC");
  if (blocks.length) {
    put(0, "SECTION"); put(2, "BLOCKS");
    for (const b of blocks) for (const [c, v] of b) put(c, v);
    put(0, "ENDSEC");
  }
  put(0, "SECTION"); put(2, "ENTITIES");
  for (const e of entities) for (const [c, v] of e) put(c, v);
  put(0, "ENDSEC"); put(0, "EOF");
  return out.join(NL) + NL;
};
const read = (entities: G[], blocks: G[] = []) => {
  const r = readDxf(dxf(entities, blocks));
  if (!r.ok) throw new Error(r.reason);
  return r.drawing;
};
const line = (x1: number | string, y1: number | string, x2: number | string, y2: number | string): G => [[0, "LINE"], [8, "0"], [10, x1], [20, y1], [11, x2], [21, y2]];
const block = (name: string, ents: G[]): G => [[0, "BLOCK"], [8, "0"], [2, name], [70, 0], [10, 0], [20, 0], [3, name], ...ents.flat(), [0, "ENDBLK"], [8, "0"]];
const fig = (d: ReturnType<typeof read>) => {
  const f = dxfFigure(d, 1);
  if (typeof f === "string") throw new Error(f);
  return f;
};

describe("1. huge angles and parameters are reduced, never looped up to (Word must not freeze)", () => {
  it("an ELLIPSE with start parameter 1e20 returns at once", () => {
    const t = Date.now();
    const d = read([[[0, "ELLIPSE"], [8, "0"], [10, 0], [20, 0], [11, 10], [21, 0], [40, 0.5], [41, 1e20], [42, 1e20 + 1]]]);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(d.items).toHaveLength(1);
  });
  it("an ARC with a start angle of 1e20 inside an unevenly scaled block returns at once", () => {
    const t = Date.now();
    const d = read([[[0, "INSERT"], [8, "0"], [2, "B"], [10, 0], [20, 0], [41, 1], [42, 2]]], [block("B", [[[0, "ARC"], [8, "0"], [10, 0], [20, 0], [40, 5], [50, 1e20], [51, 1e20 + 90]]])]);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(d.items).toHaveLength(1);
  });
});

describe("2. expanding blocks has a work budget (arrays of arrays of points)", () => {
  it("is refused by name, quickly, though nothing in it is ever drawn", () => {
    const blocks = [block("P", [[[0, "POINT"], [8, "0"], [10, 0], [20, 0]]]), block("A", [[[0, "INSERT"], [8, "0"], [2, "P"], [10, 0], [20, 0], [70, 100], [71, 100], [44, 1], [45, 1]]])];
    const t = Date.now();
    const r = readDxf(dxf([[[0, "INSERT"], [8, "0"], [2, "A"], [10, 0], [20, 0], [70, 100], [71, 100], [44, 200], [45, 200]]], blocks));
    expect(Date.now() - t).toBeLessThan(10000);
    expect(r).toEqual({ ok: false, reason: `expanding the drawing's blocks takes more than ${DXF_LIMITS.work.toLocaleString("en-US")} steps (arrays of blocks inside arrays) — this importer stops there` });
  });
});

describe("3. curves have a points budget, and the flattening size reads every point", () => {
  const spline = (n: number): G => {
    const fit: G = [];
    for (let i = 0; i < n; i++) fit.push([11, i * 0.5], [21, (i % 2) * 3], [31, 0]);
    return [[0, "SPLINE"], [8, "0"], [70, 8], [71, 3], [74, n], ...fit];
  };
  it("a spline with 20 000 fit points starting at the origin is sized by all of them: 8 steps a span, not 10 million points", () => {
    const t = Date.now();
    const d = read([spline(20000)]);
    expect(Date.now() - t).toBeLessThan(5000);
    expect((d.items[0] as { pts: unknown[] }).pts.length).toBeLessThanOrEqual(8 * 19999 + 1);
  });
  it("one past the points budget is refused by name, before the points are made", () => {
    const t = Date.now();
    const r = readDxf(dxf([spline(70000)]));
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r).toEqual({ ok: false, reason: `the drawing's curves need more than ${DXF_LIMITS.points.toLocaleString("en-US")} points to draw — this importer stops there` });
  });
});

describe("4. unreadable or degenerate numbers are skipped and counted, never NaN in the picture or moved to 0", () => {
  it("a comma-decimal LWPOLYLINE vertex: its segments are skipped, the rest drawn, and the note says so", () => {
    const d = read([[[0, "LWPOLYLINE"], [8, "0"], [90, 3], [70, 0], [10, 0], [20, 0], [10, "1,5"], [20, 5], [10, 10], [20, 10]], line(0, 0, 10, 0)]);
    expect(fig(d).svg).not.toContain("NaN");
    expect(d.items).toHaveLength(1);
    expect(d.notes).toContain("2 items with numbers that could not be read (or sizes of zero or less) were skipped.");
  });
  it("a vertex missing its 20 does not hand later vertices the wrong y", () => {
    const d = read([[[0, "LWPOLYLINE"], [8, "0"], [90, 3], [70, 0], [10, 0], [20, 0], [10, 5], [10, 10], [20, 10]]]);
    expect(d.items.every((i) => i.kind !== "line" || !(i.x2 === 5 && i.y2 === 10))).toBe(true);
    expect(d.items).toHaveLength(0);
  });
  it("a LINE whose end is 1e400 is skipped, not drawn to x = 0", () => {
    const d = read([line(0, 0, "1e400", 5), line(0, 0, 1, 1)]);
    expect(d.items).toHaveLength(1);
    expect(d.notes.join(" ")).toMatch(/1 item with a number that could not be read/);
  });
  it("a repeated vertex with a bulge, and an ellipse with no axis, are skipped by count", () => {
    const d = read([
      [[0, "LWPOLYLINE"], [8, "0"], [90, 3], [70, 0], [10, 0], [20, 0], [42, 1], [10, 0], [20, 0], [10, 5], [20, 0]],
      [[0, "ELLIPSE"], [8, "0"], [10, 0], [20, 0], [11, 0], [21, 0], [40, 0.5]],
    ]);
    expect(fig(d).svg).not.toContain("NaN");
    expect(d.notes).toContain("2 items with no size (repeated vertices, ellipses with no axis) were skipped.");
  });
  it("a negative text height or arc radius is skipped, not drawn flipped", () => {
    const d = read([[[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [40, -2], [1, "X"]], [[0, "ARC"], [8, "0"], [10, 0], [20, 0], [40, -5], [50, 0], [51, 90]], line(0, 0, 1, 0)]);
    expect(d.items).toHaveLength(1);
  });
});

describe("5. an ARC from 0° to 360° (or 90° to 90°) is a whole circle, not nothing", () => {
  it.each([[0, 360], [90, 90]])("start %d, end %d", (a, b) => {
    const d = read([[[0, "ARC"], [8, "0"], [10, 0], [20, 0], [40, 5], [50, a], [51, b]]]);
    expect(d.items[0]).toMatchObject({ kind: "arc", full: true });
    const s = dxfSketch(d, 1);
    expect(s.ok && s.sketch.entities[0].kind).toBe("circle");
  });
});

describe("6. merging ends never turns a tiny arc into a circle, or a line into a point", () => {
  it("a 0.001° arc beside a 1000 mm line is left out, counted", () => {
    const d = read([[[0, "ARC"], [8, "0"], [10, 0], [20, 0], [40, 10], [50, 0], [51, 0.001]], line(0, -50, 1000, -50)]);
    const s = dxfSketch(d, 1);
    if (!s.ok) throw new Error(s.reason);
    expect(s.sketch.entities.map((e) => e.kind)).toEqual(["line"]);
    expect(s.notes).toContain("1 line or arc too small to keep (its ends meet) was left out.");
    expect(s.sketch.points).toHaveLength(2); // the arc's points went with it
  });
  it("two short lines that chain into one point are left out", () => {
    const d = read([line(0.0008, 0, 1000, 0), line(0, 0, 0.0016, 0)]);
    const s = dxfSketch(d, 1);
    if (!s.ok) throw new Error(s.reason);
    expect(s.sketch.entities).toHaveLength(1);
    expect(s.sketch.entities.every((e) => e.kind !== "line" || e.a !== e.b)).toBe(true);
  });
});

describe("7. Aligned and Fit TEXT run from point 10 to point 11", () => {
  it.each([3, 5])("72 = %d: starts at x = 0, fitted to 100 units", (h72) => {
    const d = read([[[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [11, 100], [21, 0], [40, 5], [72, h72], [1, "ALIGNED"]]]);
    expect(d.items[0]).toMatchObject({ kind: "text", x: 0, y: 0, anchor: "start", fitWidth: 100, rot: 0 });
    const f = fig(d);
    expect(f.svg).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(f.widthMm).toBeLessThan(110); // not widened past its second point
  });
});

describe("8. MTEXT wraps to its box width (41)", () => {
  it("a 200-character note in a 60 mm box keeps the drawing about 64 mm wide", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const d = read([[[0, "MTEXT"], [8, "0"], [10, 0], [20, 0], [40, 3.5], [41, 60], [71, 1], [1, words]]]);
    const t = d.items[0] as { lines: string[] };
    expect(t.lines.length).toBeGreaterThan(5);
    expect(fig(d).widthMm).toBeLessThan(80);
  });
  it("wrapLines keeps words whole", () => {
    expect(wrapLines(["aa bb cc dd"], 5)).toEqual(["aa bb", "cc dd"]);
    expect(wrapLines(["averylongword x"], 5)).toEqual(["averylongword", "x"]);
  });
});

describe("9. text XML cannot carry is dropped; the picture stays valid", () => {
  it.each(["A\\U+0002B", "A\\U+D800B", "A%%001B", "A%%000B"])("%s", (raw) => {
    const d = read([[[0, "TEXT"], [8, "0"], [10, 0], [20, 0], [40, 2.5], [1, raw]]]);
    const svg = fig(d).svg;
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
    expect(svg).toContain(">AB</tspan>");
  });
  it("xmlSafe keeps a real surrogate pair and tabs", () => {
    const pair = String.fromCharCode(0xd83d, 0xde00);
    expect(xmlSafe("a" + pair + "\tb")).toBe("a" + pair + "\tb");
  });
});

describe("nits", () => {
  it("a file just over the cap says by how much (rounded up)", () => {
    expect(sizeRefusal("big.dxf", DXF_LIMITS.bytes + 1)).toBe("big.dxf: the file is 30.1 MB — this importer reads DXF files up to 30 MB");
  });
  it("the sketch is moved by its outline's corner, not by a note beside it", () => {
    const d = read([line(10, 10, 50, 10), line(50, 10, 50, 30), line(50, 30, 10, 30), line(10, 30, 10, 10), [[0, "TEXT"], [8, "0"], [10, -100], [20, -100], [40, 2.5], [1, "NOTE"]]]);
    const r = importedSketch(d, 1);
    if (!r.ok) throw new Error(r.reason);
    expect(Math.min(...r.sketch.points.map((p) => p.x))).toBe(0);
    expect(Math.min(...r.sketch.points.map((p) => p.y))).toBe(0);
  });
  it("capitals at 5 mm fit inside the picture (the width estimate errs on the side of room)", () => {
    const d = read([line(0, 0, 10, 0), [[0, "TEXT"], [8, "0"], [10, 0], [20, 5], [40, 5], [1, "DRAWING NUMBER WWW"]]]);
    // Arial's advances (D R N U .722, A B E .667, W .944, I .278, G .778, M .833, space .278) sum to
    // 12.55 em; at 5 mm capitals an em is 6.98 mm, so the text is 87.7 mm long, from x = 0.
    expect(fig(d).widthMm).toBeGreaterThan(87.7 + 2);
  });
});
