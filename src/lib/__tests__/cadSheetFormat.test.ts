// Framed sheets through layoutSheet (docs/SCOPE-CAD-R2.md R2b): the views in the
// frame's view area at a standard scale, the title block, the scale and symbol
// outside it (ISO 7200) or in its SCALE field (ASME), layers left out when off.
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Placement, tessellate, Mesh } from "../cadModel";
import { layoutSheet, ViewSpec } from "../cadSheet";
import { buildFrame } from "../cadFormats";

let n = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++n}`, name: `b${n}`, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
const L = meshOf(body(box(40, 20, 10)), body(box(40, 5, 30), { translate: [0, 15, 0], rotateDeg: [0, 0, 0] }));
const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }];
const PX = 96 / 25.4;
/** Every coordinate pair drawn in a layer group, px. */
function layerPoints(svg: string, id: string): Array<[number, number]> {
  const g = new RegExp(`<g data-layer="${id}">([\\s\\S]*?)</g>(?=<g data-layer|</svg>)`).exec(svg);
  if (!g) return [];
  const pts: Array<[number, number]> = [];
  for (const m of g[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) pts.push([+m[1], +m[2]]);
  for (const m of g[1].matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) pts.push([+m[1], +m[2]]);
  for (const m of g[1].matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) pts.push([+m[1], +m[2]]);
  return pts;
}

describe("a framed ISO A3 sheet", () => {
  const title = { owner: "Caldwell", title: "Bracket", number: "CE-1", date: "2026-10-17", sheetNo: "1", creator: "A. Smith", approver: "B. Jones", docType: "Detail drawing" };
  const sh = layoutSheet(L, { standard: "iso", views, format: { size: "A3", title }, callouts: [{ anchor: [20, 0, 5], label: "1" }] });
  const fr = buildFrame("iso", "A3", undefined, title, null);
  if (!fr.ok) throw new Error(fr.reason);
  const f = fr.frame;
  it("is the trimmed A3 sheet, 420 × 297 mm, at a standard scale", () => {
    expect(sh.widthMm).toBeCloseTo(420, 6);
    expect(sh.heightMm).toBeCloseTo(297, 6);
    expect(sh.sizeName).toBe("A3");
    expect([1, 2, 5].includes(sh.scaleMmPerUnit) || [0.5, 0.2, 0.1].includes(sh.scaleMmPerUnit)).toBe(true);
  });
  it("draws every view, callout and title inside the view area — none on the title block", () => {
    const v = f.viewArea;
    for (const id of ["visible", "callouts", "titles"]) {
      const pts = layerPoints(sh.svg, id);
      expect(pts.length).toBeGreaterThan(3);
      for (const [x, y] of pts) {
        expect(x / PX).toBeGreaterThanOrEqual(v.x - 1e-6);
        expect(x / PX).toBeLessThanOrEqual(v.x + v.w + 1e-6);
        expect(y / PX).toBeGreaterThanOrEqual(v.y - 1e-6);
        expect(y / PX).toBeLessThanOrEqual(v.y + v.h + 1e-6);
      }
    }
  });
  it("prints the title block and the frame, the scale and the projection symbol outside the block", () => {
    expect(sh.svg).toContain('data-layer="frame"');
    expect(sh.svg).toContain(">Bracket</text>");
    expect(sh.svg).toMatch(/>SCALE \d+:\d+<\/text>/);
    const scale = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="end"[^>]*>SCALE/.exec(sh.svg)!;
    expect(+scale[1] / PX).toBeLessThanOrEqual(f.titleBlock.x);
  });
  it("names the 0.7 mm frame and the ISO type 04 axis of the symbol in its strokes", () => {
    expect(sh.svg).toContain(`stroke-width="${Math.round(0.7 * PX * 100) / 100}"`);
    const d = Math.round(0.25 * PX * 24 * 100) / 100;
    expect(sh.svg).toContain(`stroke-dasharray="${d} `);
  });
});

describe("ASME and the rules", () => {
  it("an ASME B sheet prints the scale in the title block's SCALE field, not loose on the sheet", () => {
    const sh = layoutSheet(L, { standard: "asme", views, format: { size: "ANSI-B" } });
    expect(sh.svg).not.toMatch(/>SCALE /);
    const tb = /<g data-layer="titleBlock">([\s\S]*?)<\/g>/.exec(sh.svg)![1];
    expect(tb).toMatch(/>\d+:\d+<\/text>/);
    expect(sh.widthMm).toBeCloseTo(431.8, 6);
  });
  it("a patent drawing asked for a frame is refused by name, with nothing drawn", () => {
    const sh = layoutSheet(L, { standard: "uspto", views, format: { size: "A4" } });
    expect(sh.svg).toBe("");
    expect(sh.notes).toEqual(["37 CFR 1.84(g): a patent drawing sheet must not have a frame around the sight, so it has no sheet format."]);
  });
  it("a title too long for its field refuses the sheet by name", () => {
    const sh = layoutSheet(L, { standard: "iso", views, format: { size: "A3", title: { number: "X".repeat(20) } } });
    expect(sh.svg).toBe("");
    expect(sh.notes).toEqual(["Identification number is 20 characters — the field holds 16."]);
  });
  it("a layer switched off is left out of the SVG entirely (what inserts is what shows)", () => {
    const sh = layoutSheet(L, { standard: "iso", views, format: { size: "A3" }, layers: { frame: false, titleBlock: false, titles: false }, callouts: [{ anchor: [20, 0, 5], label: "1" }] });
    expect(sh.svg).not.toContain('data-layer="frame"');
    expect(sh.svg).not.toContain('data-layer="titleBlock"');
    expect(sh.svg).not.toContain('data-layer="titles"');
    expect(sh.svg).toContain('data-layer="callouts"');
    expect(sh.svg).toContain('data-layer="visible"');
  });
  it("a drawing too big for A4 at the smallest standard scale is refused, not shrunk off-standard", () => {
    const huge = meshOf(body(box(400000, 1000, 1000)));
    const sh = layoutSheet(huge, { standard: "iso", views: [{ kind: "front" }], format: { size: "A4" } });
    expect(sh.svg).toBe("");
    expect(sh.notes[0]).toMatch(/^The drawing does not fit the sheet at any standard scale/);
  });
});
