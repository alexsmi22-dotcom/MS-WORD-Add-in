// Drawing sheets, standards and picking for the CAD canvas
// (docs/SCOPE-CAD-CANVAS.md R1b; values: docs/DRAFTING-STANDARDS-REFERENCE.md).
import { Assembly, Body, BodySpec, box, cylinder, IDENTITY_PLACEMENT, Placement, tessellate, Mesh } from "../cadModel";
import { layoutSheet, pointHidden, ViewSpec } from "../cadSheet";
import { DRAWING_STANDARDS, capMmToPt } from "../cadStandards";
import { STANDARD_VIEWS } from "../cadLines";
import { fitView, pickAt, previewOps } from "../cadPreview";
import { ptToMm, CAP_HEIGHT_EM, USPTO_REQUIRED_CHAR_HEIGHT_MM } from "../figureStyle";

let n = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT, name = `b${++n}`): Body => ({ id: name, name, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};

// An L-shape so the views are distinguishable: 4 wide (X), 2 deep (Y), 3 tall (Z) at the back.
const L = meshOf(body(box(4, 2, 1)), body(box(4, 0.5, 3), { translate: [0, 1.5, 0], rotateDeg: [0, 0, 0] }));
const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }];

/** The centre of each view's title text, by label. */
function titlePositions(svg: string): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle"[^>]*>([A-Z][A-Z .0-9]+)<\/text>/g)) {
    out.set(m[3], { x: +m[1], y: +m[2] });
  }
  return out;
}

describe("projection arrangement", () => {
  it("ASME third-angle: TOP is above FRONT, RIGHT SIDE is to its right, same column / row", () => {
    const sh = layoutSheet(L, { standard: "asme", views });
    const t = titlePositions(sh.svg);
    const front = t.get("FRONT")!, top = t.get("TOP")!, right = t.get("RIGHT SIDE")!;
    expect(top.y).toBeLessThan(front.y);
    expect(Math.abs(top.x - front.x)).toBeLessThan(1); // the top view shares the front view's width and column
    expect(right.x).toBeGreaterThan(front.x);
    expect(Math.abs(right.y - front.y)).toBeLessThan(1); // the side view shares the front view's row
  });

  it("ISO first-angle: TOP is BELOW FRONT, the view from the right is on the LEFT", () => {
    const sh = layoutSheet(L, { standard: "iso", views });
    const t = titlePositions(sh.svg);
    const front = t.get("FRONT")!, top = t.get("TOP")!, right = t.get("RIGHT SIDE")!;
    expect(top.y).toBeGreaterThan(front.y);
    expect(right.x).toBeLessThan(front.x);
  });

  it("the projection symbol is drawn for ISO and ASME, never on a USPTO sheet", () => {
    expect(layoutSheet(L, { standard: "asme", views }).svg).toMatch(/<g fill="none" stroke="#000"><path d="M[^"]+Z"/);
    expect(layoutSheet(L, { standard: "uspto", views }).svg).not.toMatch(/Z" stroke-width/);
  });
});

describe("labels and numbering", () => {
  it("USPTO FIG numbers follow reading order (top row first), not the order asked for", () => {
    const sh = layoutSheet(L, { standard: "uspto", views });
    const t = titlePositions(sh.svg);
    const order = [...t.entries()].sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x).map(([k]) => k);
    expect(order).toEqual(["FIG. 1", "FIG. 2", "FIG. 3", "FIG. 4"]);
    expect(sh.labels).toHaveLength(4);
  });

  it("plain line art carries no labels and no symbol", () => {
    const sh = layoutSheet(L, { standard: "plain", views });
    expect(sh.labels.every((l) => l === "")).toBe(true);
    expect(sh.svg).not.toContain("<text");
  });
});

describe("text heights meet each standard (capitals measured through the font's cap height)", () => {
  const capMm = (pt: number): number => ptToMm(pt) * CAP_HEIGHT_EM.arial;
  it("ASME: 3.0 mm text, 6 mm view titles (Y14.2, validated)", () => {
    expect(capMm(DRAWING_STANDARDS.asme.textPt)).toBeCloseTo(3.0, 6);
    expect(capMm(DRAWING_STANDARDS.asme.headingPt)).toBeCloseTo(6.0, 6);
  });
  it("ISO: 2.5 mm text, 3.5 mm titles (ISO 3098 series)", () => {
    expect(capMm(DRAWING_STANDARDS.iso.textPt)).toBeCloseTo(2.5, 6);
    expect(capMm(DRAWING_STANDARDS.iso.headingPt)).toBeCloseTo(3.5, 6);
  });
  it("USPTO: numerals AND FIG labels clear 1.84(p)(3) with the style's 10 % margin", () => {
    expect(capMm(DRAWING_STANDARDS.uspto.textPt)).toBeGreaterThanOrEqual(USPTO_REQUIRED_CHAR_HEIGHT_MM - 1e-9);
    expect(capMm(DRAWING_STANDARDS.uspto.headingPt)).toBeGreaterThanOrEqual(USPTO_REQUIRED_CHAR_HEIGHT_MM - 1e-9);
  });
  it("line weights keep the 2:1 thick:thin contrast in both engineering standards", () => {
    for (const id of ["asme", "iso"] as const) expect(DRAWING_STANDARDS[id].visibleMm / DRAWING_STANDARDS[id].hiddenMm).toBeGreaterThanOrEqual(2 - 1e-9);
  });
  it("capMmToPt inverts the cap-height conversion", () => {
    expect(capMm(capMmToPt(4.2))).toBeCloseTo(4.2, 9);
  });
});

describe("hidden lines per standard", () => {
  it("ASME draws hidden lines dashed in orthographic views only; USPTO draws none by default", () => {
    const front = layoutSheet(L, { standard: "asme", views: [{ kind: "top" }] });
    expect(front.svg).toContain("stroke-dasharray");
    const pic = layoutSheet(L, { standard: "asme", views: [{ kind: "iso" }] });
    expect(pic.svg.match(/stroke-dasharray/g) ?? []).toHaveLength(1); // only the symbol's centre line
    expect(layoutSheet(L, { standard: "uspto", views }).svg).not.toContain("stroke-dasharray");
  });
});

describe("callouts", () => {
  // A point on the top face of the base, in front of the upright: visible from the top and iso, not from the front.
  const onBaseTop: [number, number, number] = [3, 0.5, 1];
  it("a surface point is visible where it faces the viewer and hidden where it does not", () => {
    expect(pointHidden(L, STANDARD_VIEWS.top, onBaseTop)).toBe(false);
    expect(pointHidden(L, STANDARD_VIEWS.iso, onBaseTop)).toBe(false);
    // From behind, the upright covers it.
    expect(pointHidden(L, STANDARD_VIEWS.back, onBaseTop)).toBe(true);
  });

  it("a callout appears in every view that shows its point, and the sheet says when none does", () => {
    const sh = layoutSheet(L, { standard: "asme", views: [{ kind: "top" }, { kind: "iso" }], callouts: [{ anchor: onBaseTop, label: "7" }] });
    expect(sh.svg.match(/>7<\/text>/g) ?? []).toHaveLength(2);
    const hiddenOnly = layoutSheet(L, { standard: "asme", views: [{ kind: "back" }], callouts: [{ anchor: onBaseTop, label: "7" }] });
    expect(hiddenOnly.notes).toContain("Callout 7 is hidden in every view on this sheet, so it is not drawn.");
  });

  it("callouts in one column never overlap each other", () => {
    const anchors: Array<[number, number, number]> = [[3.9, 0.2, 1], [3.9, 0.3, 1], [3.9, 0.4, 1]];
    const sh = layoutSheet(L, { standard: "asme", views: [{ kind: "top" }], callouts: anchors.map((a, i) => ({ anchor: a, label: String(10 + 2 * i) })) });
    const ys = [...sh.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#fff"/g)].map((m) => ({ y: +m[2], r: +m[3] }));
    expect(ys).toHaveLength(3);
    ys.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i].y - ys[i - 1].y).toBeGreaterThanOrEqual(2 * ys[i].r);
  });
});

describe("the SVG is clean", () => {
  it.each(["asme", "iso", "uspto", "journal", "plain"] as const)("%s: no NaN, black only", (std) => {
    const sh = layoutSheet(L, { standard: std, views, callouts: [{ anchor: [3, 0.5, 1], label: "10" }] });
    expect(sh.svg).not.toMatch(/NaN|Infinity|undefined/);
    const colours = new Set([...sh.svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,6})"/gi)].map((m) => m[1].toLowerCase()));
    for (const c of colours) expect(["#000", "#fff"]).toContain(c);
  });
});

describe("picking on the orbit canvas", () => {
  it("a click on the front face of a box picks that body at the clicked surface point", () => {
    const m = meshOf(body(cylinder(1, 1), { translate: [10, 0, 0], rotateDeg: [0, 0, 0] }, "far"), body(box(2, 2, 2), IDENTITY_PLACEMENT, "near"));
    const fit = fitView(m, STANDARD_VIEWS.front, 400, 300);
    // Screen position of world point (1, 0, 1) — the box's front face centre.
    const R = STANDARD_VIEWS.front.rot;
    const px = fit.ox + (R[0] * 1 + R[1] * 0 + R[2] * 1) * fit.scale;
    const py = fit.oy - (R[3] * 1 + R[4] * 0 + R[5] * 1) * fit.scale;
    const p = pickAt(m, STANDARD_VIEWS.front, fit, px, py)!;
    expect(p.body).toBe(1); // "near" is the second body
    expect(p.point[0]).toBeCloseTo(1, 6);
    expect(p.point[1]).toBeCloseTo(0, 6); // the FRONT face (y = 0), not the back face behind it
    expect(p.point[2]).toBeCloseTo(1, 6);
    expect(pickAt(m, STANDARD_VIEWS.front, fit, 1, 1)).toBeNull();
  });

  it("the preview paints only front-facing faces, far to near", () => {
    const m = meshOf(body(box(1, 1, 1)));
    const ops = previewOps(m, STANDARD_VIEWS.iso, fitView(m, STANDARD_VIEWS.iso, 300, 300));
    expect(ops.length).toBe(6); // 3 visible faces × 2 triangles
    for (let i = 1; i < ops.length; i++) expect(ops[i].depth).toBeGreaterThanOrEqual(ops[i - 1].depth);
  });
});

describe("drawing scale", () => {
  it("engineering sheets snap DOWN to an ISO 5455 scale and state it; patent and journal sheets do not", async () => {
    const { snapScale, scaleLabel } = await import("../cadStandards");
    expect(snapScale(1.35)).toBe(1);
    expect(snapScale(0.6)).toBe(0.5);
    expect(snapScale(0.19)).toBe(0.1);
    expect(snapScale(7)).toBe(5);
    expect(scaleLabel(0.5)).toBe("1:2");
    expect(scaleLabel(5)).toBe("5:1");
    const asme = layoutSheet(L, { standard: "asme", views });
    expect([1 / 1000, 1 / 500, 1 / 200, 1 / 100, 1 / 50, 1 / 20, 1 / 10, 1 / 5, 1 / 2, 1, 2, 5, 10, 20, 50]).toContain(asme.scaleMmPerUnit);
    expect(asme.svg).toContain(`>SCALE ${scaleLabel(asme.scaleMmPerUnit)}<`);
    // 37 CFR 1.84(k): no scale indication on a patent drawing.
    expect(layoutSheet(L, { standard: "uspto", views }).svg).not.toContain("SCALE");
  });
});
