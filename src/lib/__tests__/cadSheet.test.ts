// Drawing sheets, standards and picking for the CAD canvas
// (docs/SCOPE-CAD-CANVAS.md R1b; values: docs/DRAFTING-STANDARDS-REFERENCE.md).
import { Assembly, Body, BodySpec, box, cylinder, circleLoop, rectLoop, IDENTITY_PLACEMENT, Placement, tessellate, Mesh } from "../cadModel";
import { layoutSheet, pointHidden, ViewSpec } from "../cadSheet";
import { DRAWING_STANDARDS, capMmToPt } from "../cadStandards";
import { STANDARD_VIEWS } from "../cadLines";
import { fitView, pickAt, previewOps, shadeRaster } from "../cadPreview";
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

  // ISO 5456-2 / ASME Y14.3 (review B2): the frustum is the same in both symbols; third
  // angle's short side points TOWARD the circles, first angle's AWAY from them.
  it.each([["asme", "third"], ["iso", "first"]] as const)("%s (%s angle): the frustum's short side points the right way", (std, angle) => {
    const svg = layoutSheet(L, { standard: std, views }).svg;
    const path = /<g fill="none" stroke="#000"><path d="M([^"]+)Z"/.exec(svg)![1];
    const pts = path.split("L").map((s) => s.split(" ").map(Number));
    const cx = +/<circle cx="([\d.]+)"/.exec(svg.slice(svg.indexOf('<g fill="none" stroke="#000"><path')))![1];
    // The frustum's two vertical sides: x of each, and its height.
    const sides = new Map<number, number[]>();
    for (const [x, y] of pts) sides.set(x, [...(sides.get(x) ?? []), y]);
    expect(sides.size).toBe(2);
    const [[xa, ya], [xb, yb]] = [...sides.entries()].sort((a, b) => a[0] - b[0]);
    const hA = Math.abs(ya[0] - ya[1]), hB = Math.abs(yb[0] - yb[1]);
    expect(hA).toBeLessThan(hB); // narrow end on the LEFT in both
    const shortX = xa, longX = xb;
    const towardCircles = Math.abs(shortX - cx) < Math.abs(longX - cx);
    expect(towardCircles).toBe(angle === "third");
    expect(cx < xa).toBe(angle === "third"); // third: circles on the left; first: on the right
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

  it("a point exactly behind the edge of a nearer face is hidden (inclusive, as the line engine — review D5)", () => {
    const m = meshOf(body(box(2, 2, 2)), body(box(4, 1, 4), { translate: [-1, 5, -1], rotateDeg: [0, 0, 0] }));
    // On the rear block's front face, straight behind the near block's left edge (x = 0) in the front view.
    expect(pointHidden(m, STANDARD_VIEWS.front, [0, 5, 1])).toBe(true);
    expect(pointHidden(m, STANDARD_VIEWS.front, [-0.5, 5, 1])).toBe(false);
  });

  it("a balloon appears ONCE (pictorial first); a patent numeral in every figure that shows it; the sheet says when none does", () => {
    const sh = layoutSheet(L, { standard: "asme", views: [{ kind: "top" }, { kind: "iso" }], callouts: [{ anchor: onBaseTop, label: "7" }] });
    expect(sh.svg.match(/>7<\/text>/g) ?? []).toHaveLength(1);
    // …and in the isometric: its balloon sits right of the top view's column.
    const iso = titlePositions(sh.svg).get("ISOMETRIC")!;
    const b = [...sh.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#fff"/g)][0];
    expect(Math.abs(+b[1] - iso.x)).toBeLessThan(Math.abs(+b[1] - titlePositions(sh.svg).get("TOP")!.x));
    const pat = layoutSheet(L, { standard: "uspto", views: [{ kind: "top" }, { kind: "iso" }], callouts: [{ anchor: onBaseTop, label: "7" }] });
    expect(pat.svg.match(/>7<\/text>/g) ?? []).toHaveLength(2);
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

/** Balloons and view-title boxes of a sheet (px), for collision checks. */
function sheetBoxes(svg: string): { balloons: Array<{ x: number; y: number; r: number }>; titles: Array<{ x0: number; x1: number; y0: number; y1: number; t: string }> } {
  const balloons = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#fff"/g)].map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }));
  const titles = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" font-family="[^"]*" font-size="([\d.]+)"[^>]*>([A-Z][A-Z .0-9]+)<\/text>/g)].map((m) => {
    const x = +m[1], y = +m[2], f = +m[3], w = m[4].length * 0.62 * f;
    return { x0: x - w / 2, x1: x + w / 2, y0: y - 0.75 * f, y1: y + 0.25 * f, t: m[4] };
  });
  return { balloons, titles };
}
const sheetSize = (svg: string): { w: number; h: number } => {
  const m = /<svg [^>]*width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
  return { w: +m[1], h: +m[2] };
};

describe("callouts and titles stay on the sheet and clear of each other (review D3, D4)", () => {
  // A thin plate: its front view is a sliver, far shorter than a stack of balloons.
  const plate = meshOf(body(box(40, 30, 1)));
  const anchors: Array<[number, number, number]> = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [39.5, 1 + i * 3.5, 1]);
  it.each(["asme", "iso", "uspto"] as const)("%s: 8 callouts on a thin plate, four views", (std) => {
    const sh = layoutSheet(plate, { standard: std, views, callouts: anchors.map((a, i) => ({ anchor: a, label: String(10 + 2 * i) })) });
    const { w, h } = sheetSize(sh.svg);
    const { balloons, titles } = sheetBoxes(sh.svg);
    if (std !== "uspto") expect(balloons.length).toBeGreaterThanOrEqual(8);
    for (const b of balloons) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.y - b.r).toBeGreaterThanOrEqual(0);
      expect(b.x + b.r).toBeLessThanOrEqual(w);
      expect(b.y + b.r).toBeLessThanOrEqual(h);
      for (const t of titles) {
        const clear = b.x + b.r <= t.x0 || b.x - b.r >= t.x1 || b.y + b.r <= t.y0 || b.y - b.r >= t.y1;
        expect({ balloon: b, title: t.t, clear }).toMatchObject({ clear: true });
      }
    }
    for (let i = 0; i < balloons.length; i++)
      for (let j = i + 1; j < balloons.length; j++) {
        const [p, q] = [balloons[i], balloons[j]];
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r - 1e-6);
      }
    // USPTO numerals: every one inside the sheet too.
    for (const m of sh.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(\d+)<\/text>/g)) {
      expect(+m[1]).toBeGreaterThanOrEqual(0);
      expect(+m[1]).toBeLessThanOrEqual(w);
      expect(+m[2]).toBeGreaterThanOrEqual(0);
      expect(+m[2]).toBeLessThanOrEqual(h);
    }
  });

  it.each(["asme", "iso", "uspto"] as const)("%s: a slender rod's view titles never overlap one another", (std) => {
    const rod = meshOf(body(box(0.4, 0.4, 20)));
    const { titles } = sheetBoxes(layoutSheet(rod, { standard: std, views }).svg);
    expect(titles).toHaveLength(4);
    for (let i = 0; i < titles.length; i++)
      for (let j = i + 1; j < titles.length; j++) {
        const [p, q] = [titles[i], titles[j]];
        const clear = p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0;
        expect({ a: p.t, b: q.t, clear }).toMatchObject({ clear: true });
      }
  });
});

describe("many callouts never collapse the scale (second review)", () => {
  const blk = meshOf(body(box(40, 30, 10)));
  const many = (k: number) => Array.from({ length: k }, (_, i) => ({ anchor: [40, 1 + (28 * i) / k, 10] as [number, number, number], label: String(i + 1) }));
  it.each([8, 9, 10, 14])("ASME, %i callouts: still 1:1, every balloon on the sheet", (k) => {
    const sh = layoutSheet(blk, { standard: "asme", views, callouts: many(k) });
    expect(sh.scaleMmPerUnit).toBe(1);
    const { w, h } = sheetSize(sh.svg);
    for (const b of sheetBoxes(sh.svg).balloons) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(0);
      expect(b.y + b.r).toBeLessThanOrEqual(h);
      expect(b.x + b.r).toBeLessThanOrEqual(w);
    }
  });
  it("too many to set beside a view: refused with the reason, nothing to insert — never shrunk to 1:1000", () => {
    const sh = layoutSheet(blk, { standard: "uspto", views, callouts: many(40) });
    expect(sh.svg).toBe("");
    expect(sh.notes[0]).toMatch(/^\d+ callouts beside one view do not fit on the sheet; use fewer callouts or fewer views\.$/);
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

describe("the shaded preview shows the NEAREST surface at every pixel", () => {
  it("a pin through a plate: pin colour exactly where the exact picker finds the pin (the painter showed it through the plate)", () => {
    const m = meshOf(body(box(80, 50, 8)), body(cylinder(5, 40), { translate: [40, 25, -10], rotateDeg: [0, 0, 0] }));
    for (const v of [STANDARD_VIEWS.iso, STANDARD_VIEWS.front]) {
      const fit = fitView(m, v, 200, 160);
      const img = shadeRaster(previewOps(m, v, fit), 200, 160, 1, new Set([1]));
      let tested = 0, wrong = 0;
      for (let py = 2; py < 160; py += 3)
        for (let px = 2; px < 200; px += 3) {
          const k = 4 * (py * 200 + px);
          const shadedPin = img.data[k] !== img.data[k + 2]; // the tint makes the pin bluish
          const hit = pickAt(m, v, fit, px + 0.5, py + 0.5);
          if (!hit) continue;
          tested++;
          if (shadedPin !== (hit.body === 1)) wrong++;
        }
      expect(tested).toBeGreaterThan(300);
      expect(wrong / tested).toBeLessThan(0.02); // pixel edges only
    }
  });

  it("a 200-hole plate shades a large high-DPI canvas inside a freeze budget (a bound, not a speed claim)", () => {
    const holes = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 20; c++) holes.push(circleLoop(40 + c * 48, 40 + r * 57, 10, true));
    const m = meshOf(body({ kind: "extrude", profile: { outer: rectLoop(0, 0, 1000, 600), holes }, depth: 8 }));
    const fit = fitView(m, STANDARD_VIEWS.iso, 900, 760);
    const t0 = Date.now();
    const img = shadeRaster(previewOps(m, STANDARD_VIEWS.iso, fit), 900, 760, 2);
    expect(img.width).toBe(1800);
    expect(Date.now() - t0).toBeLessThan(3000);
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
