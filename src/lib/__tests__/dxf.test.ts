// The DXF reader against ezdxf (MIT): fixtures written by ezdxf with known geometry, and ezdxf's
// own reading of each (fixtures/dxf/expected.json: geometry extents after expanding every block,
// and its arcs in world coordinates) as the oracle.
import * as fs from "fs";
import * as path from "path";
import { readDxf, decodeDxf, importRefusal, dxfText, DxfDrawing, DxfItem, DXF_LIMITS } from "../dxf";

const DIR = path.join(__dirname, "fixtures", "dxf");
const EXPECTED: Record<string, { bounds: number[] | null; kinds: Record<string, number>; arcs: Array<{ c: number[]; r: number; start: number[]; end: number[] }> }> = JSON.parse(
  fs.readFileSync(path.join(DIR, "expected.json"), "utf8"),
);
const load = (name: string): DxfDrawing => {
  const r = readDxf(decodeDxf(new Uint8Array(fs.readFileSync(path.join(DIR, name + ".dxf")))));
  if (!r.ok) throw new Error(r.reason);
  return r.drawing;
};
const geomBounds = (d: DxfDrawing): number[] => {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  const add = (x: number, y: number): void => {
    a = Math.min(a, x);
    b = Math.min(b, y);
    c = Math.max(c, x);
    e = Math.max(e, y);
  };
  for (const it of d.items) {
    if (it.kind === "text") continue;
    if (it.kind === "line") {
      add(it.x1, it.y1);
      add(it.x2, it.y2);
    } else if (it.kind === "arc") {
      for (let k = 0; k <= 720; k++) {
        const t = it.a0 + ((it.a1 - it.a0) * k) / 720;
        add(it.cx + it.r * Math.cos(t), it.cy + it.r * Math.sin(t));
      }
    } else for (const [x, y] of it.pts) add(x, y);
  }
  return [a, b, c, e];
};
const of = <K extends DxfItem["kind"]>(d: DxfDrawing, k: K): Array<Extract<DxfItem, { kind: K }>> => d.items.filter((i) => i.kind === k) as never;

describe("geometry agrees with ezdxf's reading of the same file", () => {
  it.each(["basic", "ocs", "blocks", "uneven", "dims", "inches", "nounits", "r12", "paper", "hatch"])("%s: the drawing's extents", (name) => {
    const d = load(name);
    const want = EXPECTED[name].bounds!;
    const got = geomBounds(d);
    const span = Math.max(want[2] - want[0], want[3] - want[1]);
    for (let i = 0; i < 4; i++) expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(span * 2e-4);
  });
  it("blocks: every block reference expanded — 9 lines and 9 arcs, as ezdxf counts them (rotated, scaled, mirrored, nested, arrayed)", () => {
    const d = load("blocks");
    expect(of(d, "line")).toHaveLength(EXPECTED.blocks.kinds.LINE);
    expect(of(d, "arc").filter((a) => !a.full)).toHaveLength(EXPECTED.blocks.kinds.ARC);
    expect(of(d, "arc").filter((a) => a.full)).toHaveLength(EXPECTED.blocks.kinds.CIRCLE);
  });
  it("blocks: each arc lands where ezdxf puts it — same centre, radius, and the same two ends (a mirror reverses, never moves, an arc)", () => {
    const d = load("blocks");
    const mine = of(d, "arc").filter((a) => !a.full);
    for (const w of EXPECTED.blocks.arcs) {
      const m = mine.find((a) => Math.hypot(a.cx - w.c[0], a.cy - w.c[1]) < 1e-6 && Math.abs(a.r - w.r) < 1e-6);
      expect(m).toBeDefined();
      const ends = [[m!.cx + m!.r * Math.cos(m!.a0), m!.cy + m!.r * Math.sin(m!.a0)], [m!.cx + m!.r * Math.cos(m!.a1), m!.cy + m!.r * Math.sin(m!.a1)]];
      const near = (p: number[], q: number[]): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      expect((near(ends[0], w.start) && near(ends[1], w.end)) || (near(ends[0], w.end) && near(ends[1], w.start))).toBe(true);
    }
  });
  it("OCS: an arc with extrusion (0, 0, −1) is mirrored into place, as ezdxf maps it", () => {
    const w = EXPECTED.ocs.arcs[0];
    const a = of(load("ocs"), "arc").find((x) => !x.full)!;
    expect([a.cx, a.cy, a.r]).toEqual([w.c[0], w.c[1], w.r].map((v) => expect.closeTo(v, 9)));
    // ezdxf: from (−15, 0) to (−10, 5) clockwise in the world = counter-clockwise from (−10, 5) to (−15, 0).
    expect(a.cx + a.r * Math.cos(a.a0)).toBeCloseTo(-10, 9);
    expect(a.cy + a.r * Math.sin(a.a0)).toBeCloseTo(5, 9);
    expect(a.cx + a.r * Math.cos(a.a1)).toBeCloseTo(-15, 9);
  });
  it("an arc scaled unevenly by its block becomes a line within the tolerance, and the note says so", () => {
    const d = load("uneven");
    expect(of(d, "poly")).toHaveLength(1);
    expect(d.notes).toContain("1 arc scaled unevenly by its block was drawn as a line within 0.01 % of the curve.");
  });
  it("R12: a POLYLINE's bulge 1 is a semicircle turning counter-clockwise (below the chord from (20, 0) to (30, 0))", () => {
    const a = of(load("r12"), "arc").find((x) => !x.full)!;
    expect([a.cx, a.cy, a.r]).toEqual([expect.closeTo(25, 9), expect.closeTo(0, 9), expect.closeTo(5, 9)]);
    expect(Math.sin((a.a0 + a.a1) / 2)).toBeLessThan(0);
  });
});

describe("text, units, spaces, notes", () => {
  it("TEXT codes show as the characters they mean: %%c → Ø, %%d → °, %%p → ±", () => {
    const t = of(load("basic"), "text").find((x) => x.lines[0].startsWith("Ø20"))!;
    expect(t.lines).toEqual(["Ø20 Ø20 45° ±0.1"]);
  });
  it("MTEXT: \\P breaks the line, formatting codes are stripped to the words", () => {
    const t = of(load("basic"), "text").find((x) => x.lines[0] === "FIRST")!;
    expect(t.lines).toEqual(["FIRST", "SECOND BOLD"]);
  });
  it("an R12 file's text is decoded by its code page (café)", () => {
    expect(of(load("r12"), "text")[0].lines).toEqual(["café Ø5"]);
  });
  it("units: millimetres and inches are read; a file that does not say is 'unknown', never assumed", () => {
    expect(load("basic").units).toEqual({ code: 4, name: "millimetres", mmPerUnit: 1 });
    expect(load("inches").units.mmPerUnit).toBe(25.4);
    const n = load("nounits");
    expect(n.units.mmPerUnit).toBeNull();
    expect(n.notes).toContain("The file does not say its units ($INSUNITS is 0, unitless) — choose them before it is sized.");
  });
  it("…and the note says why: no $INSUNITS at all, or a code this importer does not know", () => {
    const ents = ["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0", "0", "ENDSEC", "0", "EOF"].join("\r\n") + "\r\n";
    const none = readDxf(ents), odd = readDxf(["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "99", "0", "ENDSEC"].join("\r\n") + "\r\n" + ents);
    expect(none.ok && none.drawing.notes).toContain("The file does not say its units (it has no $INSUNITS) — choose them before it is sized.");
    expect(odd.ok && odd.drawing.notes).toContain("The file does not say its units ($INSUNITS 99 is not a unit this importer knows) — choose them before it is sized.");
  });
  it("a drawing only in paper space is read from there, and the note says so", () => {
    const d = load("paper");
    expect(d.space).toBe("paper");
    expect(of(d, "line")).toHaveLength(1);
    expect(d.notes[0]).toBe("The drawing is in paper space (the model space is empty); paper space was read.");
  });
  it("hatching and point markers are named, not silently dropped", () => {
    expect(load("hatch").notes).toEqual(["1 hatch pattern (section hatching) is not drawn yet.", "1 point marker was not drawn."]);
  });
  it("a dimension is drawn from its own block (its lines and its text)", () => {
    const d = load("dims");
    expect(of(d, "text").some((t) => /50/.test(t.lines.join("")))).toBe(true);
    expect(of(d, "line").length).toBeGreaterThanOrEqual(4);
  });
  it.each([
    ["%%c10", ["Ø10"]],
    ["50%%%", ["50%"]],
    ["\\U+00B1x", ["±x"]],
  ])("dxfText(%j) is %j", (raw, want) => {
    expect(dxfText(raw, false)).toEqual(want);
  });
  it("MTEXT stacking a^b shows as a/b; escaped braces stay", () => {
    expect(dxfText("H\\S1^2;O \\{x\\}", true)).toEqual(["H1/2O {x}"]);
  });
});

describe("refusals by name, and bounds", () => {
  it.each([
    ["part.par", "a Solid Edge part (.par) can only be read by Solid Edge — in Solid Edge, use Save As → STEP (.stp) and import that"],
    ["sheet.dft", "a Solid Edge draft (.dft) can only be read by Solid Edge — in Solid Edge, use Save As → DXF (.dxf) and import that"],
    ["unit.asm", "a Solid Edge assembly (.asm) can only be read by Solid Edge — in Solid Edge, use Save As → STEP (.stp) and import that"],
    ["plan.dwg", "DWG is a closed format this offline tool cannot read — save the drawing as DXF (.dxf) and import that"],
  ])("%s: %s", (name, why) => {
    expect(importRefusal(name, new Uint8Array(0))).toBe(why);
  });
  it("a binary DXF is refused by name", () => {
    const head = new TextEncoder().encode("AutoCAD Binary DXF\r\n\x1a\x00");
    expect(importRefusal("x.dxf", head)).toBe("this is a binary DXF — save it as an ASCII DXF (the default in Solid Edge's and AutoCAD's Save As) and import that");
  });
  it("something that is not a DXF is refused by name", () => {
    expect(readDxf("hello\nworld\n")).toEqual({ ok: false, reason: 'line 1 should hold a group code, not "hello" — this is not a DXF file, or it is damaged' });
    expect(readDxf("0\nEOF\n")).toEqual({ ok: false, reason: "this is not a DXF file (it has no sections)" });
  });
  it("a block that inserts itself stops at the depth cap, named, and never hangs", () => {
    const loop = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", "LOOP", "10", "0", "20", "0", "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0", "0", "INSERT", "8", "0", "2", "LOOP", "10", "1", "20", "0", "0", "ENDBLK", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "INSERT", "8", "0", "2", "LOOP", "10", "0", "20", "0", "0", "ENDSEC", "0", "EOF"].join("\n");
    const r = readDxf(loop);
    if (!r.ok) throw new Error(r.reason);
    expect(of(r.drawing, "line")).toHaveLength(DXF_LIMITS.depth);
    expect(r.drawing.notes).toContain("1 block nested deeper than 16 levels was not drawn.");
  });
  it("an array that would expand past the item cap is refused, not drawn for minutes", () => {
    const big = ["0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "2", "B", "10", "0", "20", "0", "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0", "0", "ENDBLK", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
      ...Array.from({ length: 30 }, () => ["0", "INSERT", "8", "0", "2", "B", "10", "0", "20", "0", "70", "100", "71", "100", "44", "1", "45", "1"]).flat(),
      "0", "ENDSEC", "0", "EOF"].join("\n");
    expect(readDxf(big)).toEqual({ ok: false, reason: "the drawing has more than 200,000 items once its blocks are expanded — this importer stops there" });
  });
});

describe("curves lie on ezdxf's own curves", () => {
  const distToPoly = (p: number[], pts: Array<[number, number]>): number => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const L = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-30;
      const u = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L));
      best = Math.min(best, Math.hypot(p[0] - (ax + u * (bx - ax)), p[1] - (ay + u * (by - ay))));
    }
    return best;
  };
  const exp = EXPECTED.basic as unknown as { splinePts: number[][]; ellipsePts: number[][] };
  it("the fit-point spline: every one of ezdxf's 200 samples is within 0.02 mm of the drawn curve", () => {
    const polys = of(load("basic"), "poly");
    const spline = polys.find((q) => q.pts.some(([x]) => x > 89 && x < 106) && q.pts.every(([x]) => x >= 89.9))!;
    for (const p of exp.splinePts) expect(distToPoly(p, spline.pts)).toBeLessThan(0.02);
  });
  it("the ellipse: ezdxf's 64 points are within 0.02 mm of the drawn curve", () => {
    const polys = of(load("basic"), "poly");
    const ell = polys.find((q) => q.closed)!;
    for (const p of exp.ellipsePts) expect(distToPoly(p, ell.pts)).toBeLessThan(0.02);
  });
});
