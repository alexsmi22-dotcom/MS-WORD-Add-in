/**
 * insertCapability (v2.143.0): the pure decisions behind every figure insert —
 * which route (vector or PNG), which picture Word inserted, what dpi the PNG has,
 * what a figure style does to a figure, and how the panel tray composes. The pane
 * (taskpane.ts) cannot be imported under jest, so everything it decides lives here.
 */
import {
  decideInsertRoute,
  findInsertedPicture,
  pngPixelSize,
  rasterDpi,
  rasterTarget,
  insertedDescription,
  prepareFigure,
  figureStyleNote,
  refusalText,
  composePanelFigure,
  svgRootSize,
  FIGURE_PRESET_CHOICES,
  type HostCapability,
  type PictureSignature,
} from "../insertCapability";
import { checkSvgAgainstPreset, FIGURE_PRESETS, mmToPt } from "../figureStyle";
import { buildPlotSvg } from "../plot";
import { buildChartPreviewSvg, parseTableData } from "../tablechart";
import { figurePoints } from "../figures";

const cap = (o: Partial<HostCapability>): HostCapability => ({
  platform: "PC",
  imageCoercion12: true,
  hasSetSelectedData: true,
  vectorRequested: true,
  ...o,
});

describe("decideInsertRoute: an unknown capability is raster", () => {
  test("vector only when asked for, on Word for Windows/Mac, with ImageCoercion 1.2 reported TRUE and the function present", () => {
    expect(decideInsertRoute(cap({})).route).toBe("svg");
    expect(decideInsertRoute(cap({ platform: "Mac" })).route).toBe("svg");
  });
  test("not asked for (the default): PNG, and no vector excuse on the status line", () => {
    expect(decideInsertRoute(cap({ vectorRequested: false }))).toEqual({ route: "png", reason: "" });
  });
  test("web, tablets, unknown platforms, a thrown or false capability check, a missing function: all PNG with a reason", () => {
    const cases: Partial<HostCapability>[] = [
      { platform: "OfficeOnline" },
      { platform: "iOS" },
      { platform: "Android" },
      { platform: "Universal" },
      { platform: null },
      { imageCoercion12: null }, // the check threw — NOT optimistic, unlike wordApiSupported()
      { imageCoercion12: false },
      { hasSetSelectedData: false },
    ];
    for (const c of cases) {
      const r = decideInsertRoute(cap(c));
      expect({ c, route: r.route }).toEqual({ c, route: "png" });
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });
  test("a truthy non-boolean does not count as asked for or supported", () => {
    expect(decideInsertRoute({ ...cap({}), vectorRequested: 1 as unknown as boolean }).route).toBe("png");
    expect(decideInsertRoute({ ...cap({}), imageCoercion12: "yes" as unknown as boolean }).route).toBe("png");
  });
});

describe("findInsertedPicture: the ONE new picture, or a refusal", () => {
  const A: PictureSignature = { width: 285, height: 210, alt: "Plot: sin(x)" };
  const B: PictureSignature = { width: 100, height: 50, alt: "logo" };
  const NEW: PictureSignature = { width: 300, height: 200, alt: "" };
  test("appended at the end, inserted at the start, inserted in the middle", () => {
    expect(findInsertedPicture([A, B], [A, B, NEW])).toEqual({ ok: true, index: 2 });
    expect(findInsertedPicture([A, B], [NEW, A, B])).toEqual({ ok: true, index: 0 });
    expect(findInsertedPicture([A, B], [A, NEW, B])).toEqual({ ok: true, index: 1 });
    expect(findInsertedPicture([], [NEW])).toEqual({ ok: true, index: 0 });
  });
  test("REGRESSION: a new picture identical to its neighbour is ambiguous and refused (the old loop returned the neighbour)", () => {
    const r = findInsertedPicture([A, NEW], [A, NEW, NEW]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cannot be told apart/);
    expect(findInsertedPicture([NEW], [NEW, NEW]).ok).toBe(false);
    // Different neighbours on both sides: unique again.
    expect(findInsertedPicture([A, B], [A, NEW, B])).toEqual({ ok: true, index: 1 });
  });
  test("nothing new, two new, fewer, or another picture changed: refused", () => {
    expect(findInsertedPicture([A], [A])).toMatchObject({ ok: false, inserted: 0 });
    expect(findInsertedPicture([A], [A, NEW, NEW])).toMatchObject({ ok: false, inserted: 2 });
    expect(findInsertedPicture([A, B], [A])).toMatchObject({ ok: false, inserted: 0 });
    expect(findInsertedPicture([A, B], [NEW, A, { ...B, width: 101 }])).toMatchObject({ ok: false, inserted: 1 });
  });
  test("exhaustive: for every position in a run of identical pictures, a unique answer is never wrong", () => {
    for (let n = 0; n < 5; n++) {
      for (let at = 0; at <= n; at++) {
        const before = Array.from({ length: n }, (_, i) => (i % 2 ? A : B));
        const after = [...before.slice(0, at), NEW, ...before.slice(at)];
        const r = findInsertedPicture(before, after);
        if (r.ok) expect(after[r.index]).toBe(NEW);
      }
    }
  });
});

/** A real PNG header (signature + IHDR) for a w × h image, base64. */
function pngHeader(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  b[25] = 6;
  return b.toString("base64");
}

describe("the dpi comes from the PNG that was inserted", () => {
  test("pngPixelSize reads IHDR, including widths above 65 535 and 2^31", () => {
    expect(pngPixelSize(pngHeader(1520, 1120))).toEqual({ width: 1520, height: 1120 });
    expect(pngPixelSize(pngHeader(70000, 3))).toEqual({ width: 70000, height: 3 });
    expect(pngPixelSize(pngHeader(3000000000, 1))).toEqual({ width: 3000000000, height: 1 });
  });
  test("not a PNG, truncated, or not base64: null (no dpi is claimed)", () => {
    expect(pngPixelSize("")).toBeNull();
    expect(pngPixelSize(pngHeader(10, 10).slice(0, 20))).toBeNull();
    expect(pngPixelSize(Buffer.from("GIF89a" + "x".repeat(40)).toString("base64"))).toBeNull();
    expect(pngPixelSize("!".repeat(40))).toBeNull();
    expect(pngPixelSize(pngHeader(0, 10))).toBeNull();
  });
  test("rasterDpi: pixels over inches at the inserted width; 4× a 380 px figure is 384 dpi", () => {
    expect(rasterDpi(1520, figurePoints(380))).toBe(384);
    expect(rasterDpi(380, figurePoints(380))).toBe(96);
    expect(rasterDpi(0, 100)).toBeNull();
    expect(rasterDpi(100, NaN)).toBeNull();
  });
  test("the status words", () => {
    expect(insertedDescription("png", 384)).toBe("PNG at 384 dpi");
    expect(insertedDescription("png", null)).toBe("PNG");
    expect(insertedDescription("svg", 384)).toBe("vector SVG");
  });
});

describe("rasterTarget: as drawn is the old raster exactly; a style rasterises at its printed size", () => {
  test("as drawn: the SVG's own px times the site's supersampling, with no pt round trip", () => {
    const p = { widthPt: figurePoints(383.3), heightPt: figurePoints(271), pxW: 383.3, pxH: 271, presetNote: "" };
    expect(rasterTarget(p)).toEqual({ w: 383.3, h: 271 });
    expect(rasterTarget(p, 2)).toEqual({ w: 766.6, h: 542 });
  });
  test("a style: the printed width in CSS px, whatever the canvas was drawn at", () => {
    const p = { widthPt: mmToPt(89), heightPt: mmToPt(60), pxW: 512, pxH: 345, presetNote: "Nature, 89 mm" };
    const t = rasterTarget(p);
    expect(t.w).toBeCloseTo(336.378, 3);
    expect(rasterTarget(p, 9).w).toBeCloseTo(336.378, 3); // out-of-range supersampling is ignored, not trusted
  });
});

const plotRender = (w: number): string =>
  buildPlotSvg([{ type: "line", label: "sin x", points: Array.from({ length: 50 }, (_, i) => ({ x: i / 5, y: Math.sin(i / 5) })) }], {
    title: "A plot",
    xlabel: "x",
    ylabel: "y",
    width: w,
    height: Math.round((270 * w) / 380),
  });

describe("prepareFigure: what each figure style inserts", () => {
  test("as drawn returns the SAME string at its natural size (0.75 pt per px) — byte-identical to before styles", () => {
    const svg = plotRender(380);
    const p = prepareFigure({ svg, preset: "asdrawn", width: "single", render: plotRender });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.svg).toBe(svg);
    const d = svgRootSize(svg, 0, 0);
    expect(p.widthPt).toBe(figurePoints(d.w));
    expect(p.heightPt).toBe(figurePoints(d.h));
    expect(p.presetNote).toBe("");
  });
  test("every journal style: inserted at the column width, text MEASURED inside the band on the returned SVG", () => {
    for (const id of ["nature", "elsevier", "acs", "cell", "thesis"] as const) {
      const p = prepareFigure({ svg: plotRender(380), preset: id, width: "single", render: plotRender });
      expect({ id, ok: p.ok, why: p.ok ? [] : p.problems }).toEqual({ id, ok: true, why: [] });
      if (!p.ok) continue;
      const preset = FIGURE_PRESETS[id];
      expect(p.widthPt).toBeCloseTo(mmToPt(preset.widthsMm.single), 6);
      const c = checkSvgAgainstPreset(p.svg, preset, preset.widthsMm.single);
      expect(c.ok).toBe(true);
      expect(p.presetNote.startsWith(preset.name)).toBe(true);
    }
  });
  test("USPTO refuses a heat map and a candlestick by name, citing 1.84(a)(1)", () => {
    const p = prepareFigure({ svg: plotRender(380), preset: "uspto", width: "single", chartKind: "heatmap" });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/heat map.*1\.84\(a\)\(1\)/);
  });
  test("a width the style does not have is refused, not guessed", () => {
    const p = prepareFigure({ svg: plotRender(380), preset: "uspto", width: "oneAndHalf", render: plotRender });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/no 1\.5-column width/);
  });
  test("a figure that cannot be redrawn and misses the rule is refused with the rule named", () => {
    // A colour plot as drawn under USPTO: colour and small text both named.
    const p = prepareFigure({ svg: plotRender(380), preset: "uspto", width: "single" });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      const t = refusalText(p);
      expect(t).toMatch(/USPTO/);
      expect(t).toMatch(/1\.84/);
      expect(t).toMatch(/cannot be redrawn/);
    }
  });
  test("the Table→Chart patent chart under USPTO, re-rendered as the pane does, passes and is black and white", () => {
    const chart = parseTableData([
      ["Month", "Control", "Treated"],
      ["Jan", "12.5", "14.1"],
      ["Feb", "13.2", "16.8"],
    ]);
    const render = (w: number): string => buildChartPreviewSvg(chart, "column", "", { patent: true }, w).svg;
    const p = prepareFigure({ svg: render(380), preset: "uspto", width: "single", render, chartKind: "column" });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.presetNote).toMatch(/characters at least 3\.\d\d mm high/);
  });
});

describe("figureStyleNote", () => {
  test("as drawn says nothing changes; a style states its width and its palette's MEASURED separation", () => {
    expect(figureStyleNote("asdrawn", "single")).toMatch(/as drawn/i);
    const n = figureStyleNote("nature", "single");
    expect(n).toMatch(/Inserted 89 mm wide/);
    expect(n).toMatch(/Okabe–Ito/);
    expect(n).toMatch(/ΔE \d+\.\d/);
    expect(figureStyleNote("uspto", "single")).toMatch(/Black and white only/);
    expect(figureStyleNote("uspto", "oneAndHalf")).toMatch(/no 1\.5-column width/);
  });
  test("display contract: no hyphen-minus between two numbers in any note (ranges use an en dash)", () => {
    for (const c of FIGURE_PRESET_CHOICES) {
      for (const w of ["single", "oneAndHalf", "double"] as const) {
        expect({ c, w, bad: /\d-\d/.test(figureStyleNote(c, w)) }).toEqual({ c, w, bad: false });
      }
    }
  });
});

describe("composePanelFigure: the panel tray", () => {
  const items = [
    { svg: plotRender(380), render: plotRender, source: "Plot" },
    { svg: plotRender(380), render: plotRender, source: "Plot", caption: "p < 0.05" },
  ];
  test("fewer than two figures is refused", () => {
    expect(composePanelFigure([items[0]], "nature", "single", 2).ok).toBe(false);
    expect(composePanelFigure([], "asdrawn", "single", 1).ok).toBe(false);
  });
  test("as drawn: flat SVG (no nested <svg>), no invented letters, captions labelled by panel number", () => {
    const f = composePanelFigure(items, "asdrawn", "single", 2);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect((f.svg.match(/<svg\b/g) ?? []).length).toBe(1);
    expect(f.labels).toEqual(["Panel 1", "Panel 2"]);
    expect(f.caption).toBe("Panel 2: p < 0.05");
  });
  test("Nature, single column, two across: each panel redrawn for its cell, the whole figure passes, letters a and b", () => {
    const f = composePanelFigure(items, "nature", "single", 2);
    expect({ ok: f.ok, why: f.ok ? [] : f.problems }).toEqual({ ok: true, why: [] });
    if (!f.ok) return;
    expect(f.labels).toEqual(["a", "b"]);
    expect(checkSvgAgainstPreset(f.svg, FIGURE_PRESETS.nature, 89).ok).toBe(true);
    expect((f.svg.match(/<svg\b/g) ?? []).length).toBe(1);
    expect(f.caption).toBe("b: p < 0.05");
    // It is what prepareFigure will insert, unchanged, at 89 mm.
    const p = prepareFigure({ svg: f.svg, preset: "nature", width: "single" });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.widthPt).toBeCloseTo(mmToPt(89), 6);
  });
  test("a panel that cannot be redrawn and fails at its cell width refuses the whole figure, naming the panel", () => {
    const fixed = { svg: plotRender(380), source: "Finance" };
    const f = composePanelFigure([items[0], fixed], "nature", "single", 2);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.problems.join(" ")).toMatch(/panel b \(Finance\) cannot be redrawn/);
  });
  test("USPTO panels are labelled FIG. 1A, FIG. 1B", () => {
    const chart = parseTableData([
      ["k", "A"],
      ["x", "1"],
      ["y", "2"],
    ]);
    const render = (w: number): string => buildChartPreviewSvg(chart, "column", "", { patent: true }, w).svg;
    const f = composePanelFigure(
      [
        { svg: render(380), render, source: "Table → Chart" },
        { svg: render(380), render, source: "Table → Chart" },
      ],
      "uspto",
      "single",
      2,
    );
    expect({ ok: f.ok, why: f.ok ? [] : f.problems }).toEqual({ ok: true, why: [] });
    if (f.ok) expect(f.labels).toEqual(["FIG. 1A", "FIG. 1B"]);
  });
  test("stacked one above the other the same two USPTO panels exceed the 244 mm sight and are refused with the remedy", () => {
    const chart = parseTableData([
      ["k", "A"],
      ["x", "1"],
      ["y", "2"],
    ]);
    const render = (w: number): string => buildChartPreviewSvg(chart, "column", "", { patent: true }, w).svg;
    const f = composePanelFigure(
      [
        { svg: render(380), render, source: "Table → Chart" },
        { svg: render(380), render, source: "Table → Chart" },
      ],
      "uspto",
      "single",
      1,
    );
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.problems.join(" ")).toMatch(/above the 244 mm maximum height; use more columns/);
  });
});
