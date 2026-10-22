/**
 * @jest-environment jsdom
 */
// Importing a DXF into the pane (src/lib/dxfImport.ts): refusals by name, the fitted picture, the sketch.
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";
import { openDxfFile, importedFigure, importedSketch, IMPORTED_ALT_PREFIX, IMPORT_UNITS } from "../dxfImport";
import { DxfDrawing, DXF_LIMITS } from "../dxf";
import { sketchBody } from "../sketchDoc";
import type { Sketch } from "../sketch";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
const PX = 96 / 25.4;
const FIT = { w: 159, h: 229 };

/** A DXF from group-code pairs: optional $INSUNITS, BLOCKS and ENTITIES. */
const dxf = (entities: Array<Array<[number, string | number]>>, opts: { units?: number; blocks?: Array<Array<[number, string | number]>> } = {}): string => {
  const out: string[] = [];
  const put = (c: number, v: string | number): void => void out.push(String(c), String(v));
  if (opts.units !== undefined) {
    put(0, "SECTION"); put(2, "HEADER"); put(9, "$INSUNITS"); put(70, opts.units); put(0, "ENDSEC");
  }
  if (opts.blocks) {
    put(0, "SECTION"); put(2, "BLOCKS");
    for (const b of opts.blocks) for (const [c, v] of b) put(c, v);
    put(0, "ENDSEC");
  }
  put(0, "SECTION"); put(2, "ENTITIES");
  for (const e of entities) for (const [c, v] of e) put(c, v);
  put(0, "ENDSEC"); put(0, "EOF");
  return out.join("\r\n") + "\r\n";
};
const bytes = (s: string): Uint8Array => new Uint8Array(new NodeTextEncoder().encode(s));
const line = (x1: number, y1: number, x2: number, y2: number): Array<[number, string | number]> => [[0, "LINE"], [8, "0"], [10, x1], [20, y1], [11, x2], [21, y2]];
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): Array<[number, string | number]> => [[0, "ARC"], [8, "0"], [10, cx], [20, cy], [40, r], [50, a0], [51, a1]];
const open = (name: string, text: string): DxfDrawing => {
  const r = openDxfFile(name, bytes(text));
  if (!r.ok) throw new Error(r.reason);
  return r.drawing;
};
const sk = (d: DxfDrawing, mm = 1): { sketch: Sketch; notes: string[] } => {
  const r = importedSketch(d, mm);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
/** An arc entity's counter-clockwise sweep a → b, in degrees (the sketch's convention, sketchProfile). */
const sweep = (s: Sketch): number => {
  const a = s.entities.find((e) => e.kind === "arc") as { c: string; a: string; b: string };
  const P = (id: string) => s.points.find((p) => p.id === id)!;
  const c = P(a.c);
  const t0 = Math.atan2(P(a.a).y - c.y, P(a.a).x - c.x), t1 = Math.atan2(P(a.b).y - c.y, P(a.b).x - c.x);
  let d = ((t1 - t0) * 180) / Math.PI;
  while (d <= 0) d += 360;
  return d;
};

describe("opening a file: refused by name with the route", () => {
  it.each([
    ["bracket.par", /^bracket\.par: a Solid Edge part \(\.par\) can only be read by Solid Edge — in Solid Edge, use Save As → STEP/],
    ["sheet.dft", /^sheet\.dft: a Solid Edge draft \(\.dft\) can only be read by Solid Edge — in Solid Edge, use Save As → DXF/],
    ["plan.dwg", /^plan\.dwg: DWG is a closed format/],
    ["part.stp", /^part\.stp: a STEP file is a 3D part or assembly — it is added to the model as parts, not opened as a drawing/],
    ["part.igs", /^part\.igs: an IGES file is a 3D part or assembly/],
    ["part.STL", /^part\.STL: an STL is a 3D part — it is added to the model as a part/],
    ["notes.txt", /^notes\.txt: this is not a DXF file — choose a \.dxf/],
  ])("%s", (name, why) => {
    const r = openDxfFile(name, bytes("0\r\nSECTION\r\n"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(why);
  });
  it("a binary DXF is named, whatever its extension says", () => {
    const r = openDxfFile("a.dxf", bytes("AutoCAD Binary DXF\r\n\x1a\x00"));
    expect(!r.ok && r.reason).toMatch(/^a\.dxf: this is a binary DXF — save it as an ASCII DXF/);
  });
  it("a file over the size cap is refused before it is read", () => {
    const r = openDxfFile("big.dxf", new Uint8Array(DXF_LIMITS.bytes + 1));
    expect(!r.ok && r.reason).toBe("big.dxf: the file is 30.1 MB — this importer reads DXF files up to 30 MB");
  });
  it("a .dxf that is not a DXF says so, with its name", () => {
    const r = openDxfFile("x.dxf", bytes("hello"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^x\.dxf: /);
  });
  it("a good file opens, with its units when it says them and null when it does not", () => {
    expect(open("a.dxf", dxf([line(0, 0, 10, 0)], { units: 4 })).units.mmPerUnit).toBe(1);
    expect(open("a.dxf", dxf([line(0, 0, 10, 0)])).units.mmPerUnit).toBeNull();
  });
  it("offers the common units, millimetres first", () => {
    expect(IMPORT_UNITS.map((u) => [u.id, u.mm])).toEqual([["mm", 1], ["cm", 10], ["m", 1000], ["in", 25.4], ["ft", 304.8]]);
  });
});

describe("the picture for Word", () => {
  it("a small drawing goes in at its true size, and the alt text says what it is", () => {
    const f = importedFigure(open("plate.dxf", dxf([line(0, 0, 50, 0), line(50, 0, 50, 30)], { units: 4 })), 1, "plate.dxf", FIT);
    if (typeof f === "string") throw new Error(f);
    expect(f.k).toBe(1);
    expect(f.widthMm).toBeCloseTo(54, 9); // 50 + 2 mm margins
    expect(f.widthPx).toBeCloseTo(54 * PX, 6);
    expect(f.note).toBe("It is inserted at its true size (54 × 34 mm).");
    expect(f.alt).toBe(`${IMPORTED_ALT_PREFIX}plate.dxf (54 × 34 mm at true size). A picture of the file: import the file again to change it.`);
    expect(f.alt).not.toContain("Model: "); // never mistaken for a model this canvas can open
  });
  it("an A0-sized draft is fitted to the page, never past it, and the note gives its true size", () => {
    const f = importedFigure(open("a0.dxf", dxf([line(0, 0, 1185, 0), line(1185, 0, 1185, 837)], { units: 4 })), 1, "a0.dxf", FIT);
    if (typeof f === "string") throw new Error(f);
    expect(f.widthPx / PX).toBeCloseTo(159, 6);
    expect(f.heightPx / PX).toBeLessThanOrEqual(229 + 1e-9);
    expect(f.note).toBe("It is inserted at 13 % to fit the page; at true size it is 1189 × 841 mm.");
  });
  it("inch units size it in inches; no units refuses until they are chosen", () => {
    const d = open("in.dxf", dxf([line(0, 0, 2, 0), line(2, 0, 2, 1)]));
    expect(importedFigure(d, 0, "in.dxf", FIT)).toBe("choose the drawing's units first");
    const f = importedFigure(d, 25.4, "in.dxf", FIT);
    if (typeof f === "string") throw new Error(f);
    expect(f.widthMm).toBeCloseTo(50.8 + 4, 9);
  });
});

describe("the sketch", () => {
  it("a slice whose line end is 6.2e-6 mm off still closes on the arc's computed end (and makes a solid)", () => {
    // R40 slice 0° → 37°: the arc ends at (31.9454204, 24.0726009); the line's end was written as
    // (31.945425, 24.072605), 6.2e-6 mm off — beyond a ten-millionth of the 40 mm drawing, inside a millionth.
    const d = open("slice.dxf", dxf([line(0, 0, 40, 0), arc(0, 0, 40, 0, 37), line(31.945425, 24.072605, 0, 0)], { units: 4 }));
    const { sketch, notes } = sk(d);
    expect(notes).toEqual([]);
    expect(sketchBody(sketch, { kind: "extrude", depth: 10 }).ok).toBe(true);
  });
  it("a DXF arc 0° → 90° is a quarter in the sketch (both run counter-clockwise a → b)", () => {
    const d = open("q.dxf", dxf([line(0, 0, 10, 0), arc(0, 0, 10, 0, 90), line(0, 10, 0, 0)], { units: 4 }));
    expect(sweep(sk(d).sketch)).toBeCloseTo(90, 9);
  });
  it("…and stays a quarter through a mirrored block (a mirror reverses the arc)", () => {
    const block: Array<[number, string | number]> = [[0, "BLOCK"], [8, "0"], [2, "Q"], [70, 0], [10, 0], [20, 0], [3, "Q"], ...line(0, 0, 10, 0), ...arc(0, 0, 10, 0, 90), ...line(0, 10, 0, 0), [0, "ENDBLK"], [8, "0"]];
    const insert: Array<[number, string | number]> = [[0, "INSERT"], [8, "0"], [2, "Q"], [10, 50], [20, 0], [41, -1], [42, 1]];
    const d = open("m.dxf", dxf([insert], { units: 4, blocks: [block] }));
    const s = sk(d).sketch;
    expect(sweep(s)).toBeCloseTo(90, 9);
    expect(sketchBody(s, { kind: "extrude", depth: 5 }).ok).toBe(true);
  });
  it("is moved so its lower-left corner is the origin (a part far from the drawing's origin)", () => {
    const d = open("far.dxf", dxf([line(1000, 2000, 1040, 2000), line(1040, 2000, 1040, 2020), line(1040, 2020, 1000, 2020), line(1000, 2020, 1000, 2000)], { units: 4 }));
    const s = sk(d).sketch;
    expect(Math.min(...s.points.map((p) => p.x))).toBe(0);
    expect(Math.min(...s.points.map((p) => p.y))).toBe(0);
    expect(Math.max(...s.points.map((p) => p.x))).toBe(40);
  });
  it("an outline that does not close says how many ends meet nothing, and the largest gap", () => {
    const d = open("gap.dxf", dxf([line(0, 0, 40, 0), line(40, 0, 40, 20), line(40, 20, 0, 20), line(0, 20, 0, 0.5)], { units: 4 }));
    expect(sk(d).notes).toEqual(["2 ends meet no other line or arc (largest gap 0.5 mm) — the outline must be closed before Done can make a solid."]);
  });
  it("a drawing too large for a sketch is refused by name, not as a damaged point", () => {
    const d = open("km.dxf", dxf([line(0, 0, 2000, 0)]));
    const r = importedSketch(d, 1000);
    expect(!r.ok && r.reason).toBe("at 1000 mm per unit the drawing is 2000 m across — a sketch is drawn within ±1 000 000 mm; check its units");
  });
});
