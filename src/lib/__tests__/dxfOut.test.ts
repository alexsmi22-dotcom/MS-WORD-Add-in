/**
 * @jest-environment jsdom
 */
// What an imported DXF becomes: a true-size figure, or an editable sketch (fixtures from ezdxf).
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { readDxf, decodeDxf, DxfDrawing } from "../dxf";
import { dxfFigure, dxfSketch, DEFAULT_WEIGHT_MM } from "../dxfOut";
import { sketchBody } from "../sketchDoc";

// jsdom has no TextDecoder (every browser and Word's webview do).
(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
const DIR = path.join(__dirname, "fixtures", "dxf");
const PX = 96 / 25.4;
const load = (name: string): DxfDrawing => {
  const r = readDxf(decodeDxf(new Uint8Array(fs.readFileSync(path.join(DIR, name + ".dxf")))));
  if (!r.ok) throw new Error(r.reason);
  return r.drawing;
};
const fig = (d: DxfDrawing, mm = 1) => {
  const f = dxfFigure(d, mm);
  if (typeof f === "string") throw new Error(f);
  return f;
};

describe("the figure", () => {
  it("is the drawing at its true size (its extent + 2 mm margins), well-formed SVG", () => {
    const f = fig(load("basic"));
    const b = load("basic").bounds!;
    // basic has notes whose lines run below and beside their insertion points: the picture grows to hold them.
    expect(f.widthMm).toBeGreaterThanOrEqual(b.maxX - b.minX + 4 - 1e-9);
    expect(f.heightMm).toBeGreaterThanOrEqual(b.maxY - b.minY + 4 - 1e-9);
    // Without text, exactly the geometry plus the margins.
    const g = fig(load("profile"));
    const pb = load("profile").bounds!;
    expect(g.widthMm).toBeCloseTo(pb.maxX - pb.minX + 4, 9);
    expect(g.heightMm).toBeCloseTo(pb.maxY - pb.minY + 4, 9);
    const doc = new DOMParser().parseFromString(f.svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });
  it("no line of text runs off the picture (the browser found a two-line note cut off at the bottom)", () => {
    const f = fig(load("basic"));
    const doc = new DOMParser().parseFromString(f.svg, "image/svg+xml");
    const H = f.heightPx;
    const texts = Array.from(doc.getElementsByTagName("text"));
    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) {
      const fsz = Number(t.getAttribute("font-size"));
      for (const sp of Array.from(t.getElementsByTagName("tspan"))) {
        const y = Number(sp.getAttribute("y"));
        expect(y + 0.21 * fsz).toBeLessThanOrEqual(H);
        expect(y - 0.716 * fsz).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("prints text as the characters it means (Ø, °, ±)", () => {
    expect(fig(load("basic")).svg).toContain(">Ø20 Ø20 45° ±0.1</tspan>");
  });
  it("draws inch drawings in inches (2 × 1 in is 50.8 × 25.4 mm), and refuses without units", () => {
    const f = fig(load("inches"), 25.4);
    expect(f.widthMm - 4).toBeCloseTo(50.8, 9);
    expect(dxfFigure(load("nounits"), NaN)).toBe("choose the drawing's units first");
  });
  it("keeps the file's line type (DASHED 1.27 / 0.254 mm) and weight (0.50 mm); plain lines get 0.25 mm", () => {
    const svg = fig(load("ltype")).svg;
    const f = (v: number): string => String(Math.round(v * PX * 100) / 100);
    expect(svg).toContain(`stroke-width="${f(0.5)}" stroke-dasharray="${f(1.27)} ${f(0.254)}"`);
    expect(svg).toContain(`stroke-width="${f(DEFAULT_WEIGHT_MM)}" stroke-linecap="round"`);
  });
  it("draws an arc counter-clockwise as the file means it (30° to 120°, the short way)", () => {
    const d = load("basic");
    const a = d.items.find((i) => i.kind === "arc" && !i.full)!;
    const svg = fig(d).svg;
    // Small arc, sweep 0 (counter-clockwise in the drawing is clockwise on screen).
    expect(a.kind === "arc" && a.a1 - a.a0).toBeCloseTo(Math.PI / 2, 9);
    expect(svg).toMatch(/A[\d.]+ [\d.]+ 0 0 0 /);
  });
  it("a drawing whose units make it kilometres wide is refused, by name", () => {
    expect(dxfFigure(load("basic"), 1e6)).toMatch(/^at 1000000 mm per unit the drawing is .* m — check its units$/);
  });
});

describe("the sketch", () => {
  it("a flat profile (outline with a rounded end, a hole) becomes sketch geometry with shared corners, and extrudes", () => {
    const r = dxfSketch(load("profile"), 1);
    if (!r.ok) throw new Error(r.reason);
    const sk = r.sketch;
    expect(sk.entities.map((e) => e.kind).sort()).toEqual(["arc", "circle", "line", "line", "line"]);
    // 4 corners + the arc's centre + the circle's centre: ends that meet share one point.
    expect(sk.points).toHaveLength(6);
    expect(sketchBody(sk, { kind: "extrude", depth: 5 }).ok).toBe(true);
  });
  it("ellipses and splines are refused by name, with the way forward", () => {
    expect(dxfSketch(load("basic"), 1)).toEqual({ ok: false, reason: "the drawing has 2 ellipses or splines — a sketch holds lines, arcs and circles; insert it as a drawing instead" });
  });
  it("a drawing past the sketch's 150 points is refused by name", () => {
    const d = load("blocks");
    const many: DxfDrawing = { ...d, items: Array.from({ length: 200 }, (_, i) => ({ kind: "line", x1: i, y1: 0, x2: i, y2: 1, layer: "0", dash: [], weightMm: null }) as never) };
    expect(dxfSketch(many, 1)).toEqual({ ok: false, reason: "the drawing has more than 150 points — a sketch holds 150; insert it as a drawing instead, or a smaller part of it" });
  });
  it("text and fills are named as left out", () => {
    const r = dxfSketch(load("r12"), 1);
    expect(r.ok && r.notes).toEqual(["1 text item was left out of the sketch."]);
  });
});
