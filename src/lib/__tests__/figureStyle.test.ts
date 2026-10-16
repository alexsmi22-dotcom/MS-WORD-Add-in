import * as fs from "fs";
import * as path from "path";
import {
  FIGURE_PRESETS,
  PRESET_IDS,
  FONT_STACK_SANS,
  FONT_STACK_SERIF,
  USPTO_MIN_FONT_PT,
  USPTO_MIN_CHAR_HEIGHT_MM,
  USPTO_REQUIRED_FONT_PT,
  USPTO_REQUIRED_CHAR_HEIGHT_MM,
  USPTO_CHAR_HEIGHT_MARGIN,
  USPTO_FILLS,
  USPTO_DASHES,
  mmToPx,
  pxToMm,
  ptToPx,
  pxToPt,
  ptToMm,
  mmToPt,
  stackCapHeightEm,
  presetWidthMm,
  canvasPx,
  fontPx,
  panelLabel,
  panelLetterSvg,
  usptoPatternDefs,
  usptoMarkerSvg,
  measureSvgText,
  nonBlackWhitePaints,
  checkSvgAgainstPreset,
  physicalSize,
  fitCanvasWidth,
  renderAtPreset,
  getPreset,
  FigureStylePreset,
} from "../figureStyle";
import { buildPlotSvg } from "../plot";
import { boxPlotSvg, groupedBarSvg } from "../statchart";
import { buildChartPreviewSvg, parseTableData, ChartKind } from "../tablechart";
import { prepareFigure } from "../insertCapability";

const close = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("physical units (CSS Values 4: 1in = 96px = 72pt = 25.4mm)", () => {
  test("exact anchors", () => {
    close(mmToPx(25.4), 96);
    close(ptToPx(72), 96);
    close(ptToMm(72), 25.4);
    close(mmToPt(25.4), 72);
    close(pxToPt(4), 3);
  });
  test("round trips", () => {
    for (const v of [0.1, 1, 89, 183, 1000]) {
      close(pxToMm(mmToPx(v)), v, 1e-9);
      close(pxToPt(ptToPx(v)), v, 1e-9);
    }
  });
  test("Nature single column is 336.4 px", () => close(mmToPx(89), 336.3779527559055, 1e-9));
});

describe("presets match the C.2 table and their fetched sources", () => {
  test("Nature (official artwork PDF + research figure guide)", () => {
    const p = FIGURE_PRESETS.nature;
    expect(p.widthsMm).toEqual({ single: 89, oneAndHalf: [120, 136], double: 183 });
    expect(p.maxHeightMm).toBe(247); // PDF: "The full depth of the page is 247 mm." (NOT the brief's 170)
    expect(p.sizesPt.min).toBe(5);
    expect(p.sizesPt.max).toBe(7);
    expect(p.panelLetter).toMatchObject({ letterCase: "lower", weight: "bold", sizePt: 8 });
    expect(p.fontFamily).toBe(FONT_STACK_SANS);
  });
  test("Elsevier (official artwork-sizing page)", () => {
    const p = FIGURE_PRESETS.elsevier;
    expect(p.widthsMm).toEqual({ single: 90, oneAndHalf: [140], double: 190 });
    expect(p.sizesPt.tick).toBe(7);
    // "7 pt for normal text"; the 6 pt floor is for sub/superscripts only, which a run-level
    // checker cannot single out, so every run is held to 7.
    expect(p.sizesPt.min).toBe(7);
    expect(p.lineArtDpi).toBe(1000);
  });
  test("ACS (secondary: 240 pt / 504 pt / 4.5 pt / 9.17 in)", () => {
    const p = FIGURE_PRESETS.acs;
    close(p.widthsMm.single, 84.66666666666667, 1e-9);
    close(p.widthsMm.double, 177.8, 1e-9);
    close(p.maxHeightMm as number, 232.918, 1e-9);
    expect(p.sizesPt.min).toBe(4.5);
  });
  test("Cell (secondary: 85 / 114 / 174 mm, uppercase panel letters)", () => {
    const p = FIGURE_PRESETS.cell;
    expect(p.widthsMm).toEqual({ single: 85, oneAndHalf: [114], double: 174 });
    expect(p.panelLetter.letterCase).toBe("upper");
    expect(p.lineArtDpi).toBe(1000);
  });
  test("Thesis is serif; journals are sans", () => {
    expect(FIGURE_PRESETS.thesis.fontFamily).toBe(FONT_STACK_SERIF);
    for (const id of ["nature", "elsevier", "acs", "cell", "uspto"] as const) {
      expect(FIGURE_PRESETS[id].fontFamily).toBe(FONT_STACK_SANS);
    }
  });
  test("secondary-source presets SAY so in the user-facing name and description; the others do not", () => {
    for (const id of PRESET_IDS) {
      const p = FIGURE_PRESETS[id];
      const secondary = id === "acs" || id === "cell";
      expect(p.secondarySource).toBe(secondary);
      expect(p.name.includes("from secondary source")).toBe(secondary);
      expect(p.description.includes("from secondary source")).toBe(secondary);
    }
  });
  test("every preset's ladder sits inside its own min/max band", () => {
    for (const id of PRESET_IDS) {
      const s = FIGURE_PRESETS[id].sizesPt;
      for (const v of [s.tick, s.label, s.legend, s.title]) {
        expect(v).toBeGreaterThanOrEqual(s.min);
        if (s.max !== null) expect(v).toBeLessThanOrEqual(s.max);
      }
    }
  });
  test("every preset lists at least one source", () => {
    for (const id of PRESET_IDS) expect(FIGURE_PRESETS[id].sources.length).toBeGreaterThan(0);
  });
  test("every numeric preset value has a source comment on its line or within the 3 lines above", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "figureStyle.ts"), "utf8").split(/\r?\n/);
    const start = src.findIndex((l) => l.startsWith("const NATURE"));
    const end = src.findIndex((l) => l.startsWith("export const FIGURE_PRESETS"));
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const numeric = /^\s*(single|double|oneAndHalf|maxHeightMm|min|max|tick|label|legend|title|sizePt|lineArtDpi|minStrokePt|widthsMm|sizesPt):[^/]*\d/;
    const missing: string[] = [];
    for (let i = start; i < end; i++) {
      if (!numeric.test(src[i])) continue;
      const near = [src[i], src[i - 1], src[i - 2], src[i - 3]].some((l) => l !== undefined && l.includes("//"));
      if (!near) missing.push(`${i + 1}: ${src[i].trim()}`);
    }
    expect(missing).toEqual([]);
  });
  test("getPreset", () => {
    expect(getPreset("nature")).toBe(FIGURE_PRESETS.nature);
    expect(getPreset("science")).toBeNull();
  });
  test("canvas and font px", () => {
    close(canvasPx(FIGURE_PRESETS.nature) as number, mmToPx(89));
    close(canvasPx(FIGURE_PRESETS.nature, "double") as number, mmToPx(183));
    expect(presetWidthMm(FIGURE_PRESETS.uspto, "oneAndHalf")).toBeNull();
    close(fontPx(FIGURE_PRESETS.nature, "panelLetter"), ptToPx(8));
    close(fontPx(FIGURE_PRESETS.elsevier, "tick"), ptToPx(7));
  });
});

describe("USPTO preset: 37 CFR 1.84", () => {
  const p = FIGURE_PRESETS.uspto;
  test("(p)(3): the minimum font size gives a 3.2 mm cap height in the worst font of the stack", () => {
    expect(USPTO_MIN_CHAR_HEIGHT_MM).toBe(3.2);
    const cap = stackCapHeightEm(p.fontFamily) as number;
    close(cap, 1466 / 2048); // Arial Bold, measured
    close(ptToMm(USPTO_MIN_FONT_PT) * cap, 3.2, 1e-9);
    close(USPTO_MIN_FONT_PT, 12.672, 1e-3);
    // v2.143.0: the style keeps a 10 % margin over the rule, so its floor is 3.52 mm.
    expect(USPTO_CHAR_HEIGHT_MARGIN).toBe(0.1);
    close(USPTO_REQUIRED_CHAR_HEIGHT_MM, 3.52, 1e-12);
    close(USPTO_REQUIRED_FONT_PT, USPTO_MIN_FONT_PT * 1.1, 1e-12);
    expect(p.sizesPt.min).toBe(USPTO_REQUIRED_FONT_PT);
    expect(p.panelLetter.sizePt).toBeGreaterThanOrEqual(USPTO_REQUIRED_FONT_PT);
  });
  test("(p)(3) margin: every text size the style draws at clears 3.2 mm by at least 10 %", () => {
    const cap = stackCapHeightEm(p.fontFamily) as number;
    for (const pt of [p.sizesPt.tick, p.sizesPt.label, p.sizesPt.legend, p.sizesPt.title, p.panelLetter.sizePt]) {
      const mm = ptToMm(pt) * cap;
      expect({ pt, marginPct: ((mm - 3.2) / 3.2) * 100 >= 10 }).toEqual({ pt, marginPct: true });
    }
  });
  test("(g): fits the narrower A4 sight, 170 x 244 mm across both sheet sizes", () => {
    expect(p.widthsMm.double).toBe(170);
    expect(p.widthsMm.single).toBe(170); // no columns on a patent sheet: the default width is the sight
    expect(p.maxHeightMm).toBe(244);
  });
  test("cap height is rated over EVERY family in a stack; an unknown family makes it unknown", () => {
    close(stackCapHeightEm("'Segoe UI', Arial, sans-serif") as number, 1434 / 2048);
    expect(stackCapHeightEm("'Segoe UI Variable', Arial, sans-serif")).toBeNull();
    expect(stackCapHeightEm("Wingdings")).toBeNull();
    expect(stackCapHeightEm("monospace")).toBeNull();
    close(stackCapHeightEm(FONT_STACK_SERIF) as number, 1356 / 2048);
    const W = mmToPx(170);
    const svg = `<svg viewBox="0 0 ${W} 100"><text font-family="'Segoe UI Variable', Arial" font-size="${ptToPx(20)}">10</text></svg>`;
    const c = checkSvgAgainstPreset(svg, p);
    expect(c.ok).toBe(false);
    expect(c.problems.join(" ")).toMatch(/character height is unknown/);
  });
  test("(a)(1) black and white; no title; (u)(1) FIG. 1A view labels", () => {
    expect(p.color).toBe("bw");
    expect(p.allowTitle).toBe(false);
    expect(panelLabel(p, 0)).toBe("FIG. 1A");
    expect(panelLabel(p, 1, 3)).toBe("FIG. 3B");
  });
  test("everything the preset itself emits is black and white", () => {
    expect(nonBlackWhitePaints(usptoPatternDefs())).toEqual([]);
    for (let i = 0; i < 12; i++) expect(nonBlackWhitePaints(usptoMarkerSvg(i, 10, 10))).toEqual([]);
    for (const f of USPTO_FILLS) expect(nonBlackWhitePaints(`<rect fill="${f}"/>`)).toEqual([]);
    expect(nonBlackWhitePaints(panelLetterSvg(p, 0, 5, 20))).toEqual([]);
    expect(USPTO_DASHES[0]).toBe("");
  });
  test("pattern ids are the ones tablechart's figures reference", () => {
    const defs = usptoPatternDefs();
    for (const f of USPTO_FILLS.filter((x) => x.startsWith("url("))) {
      const id = f.slice(5, -1);
      expect(defs.includes(`id="${id}"`)).toBe(true);
    }
  });
});

describe("panel letters", () => {
  test("case, wrapping and bijective base-26", () => {
    expect(panelLabel(FIGURE_PRESETS.nature, 0)).toBe("a");
    expect(panelLabel(FIGURE_PRESETS.nature, 25)).toBe("z");
    expect(panelLabel(FIGURE_PRESETS.nature, 26)).toBe("aa");
    expect(panelLabel(FIGURE_PRESETS.cell, 2)).toBe("C");
    expect(panelLabel(FIGURE_PRESETS.thesis, 1)).toBe("(b)");
  });
  test("refuses nonsense indices", () => {
    expect(() => panelLabel(FIGURE_PRESETS.nature, NaN)).toThrow(RangeError);
    expect(() => panelLabel(FIGURE_PRESETS.nature, -1)).toThrow(RangeError);
    expect(() => panelLabel(FIGURE_PRESETS.nature, Infinity)).toThrow(RangeError);
    expect(() => panelLabel(FIGURE_PRESETS.uspto, 0, 0)).toThrow(RangeError);
  });
  test("panelLetterSvg is measured at the preset's panel size and bold", () => {
    const p = FIGURE_PRESETS.nature;
    const W = mmToPx(89);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="100" viewBox="0 0 ${W} 100">${panelLetterSvg(p, 0, 2, 12)}</svg>`;
    const m = measureSvgText(svg, 89);
    expect(m.texts).toHaveLength(1);
    close(m.texts[0].pt, 8, 1e-4);
    expect(m.texts[0].bold).toBe(true);
    expect(checkSvgAgainstPreset(svg, p).ok).toBe(true); // 8 pt exceeds the 7 pt max, but it IS a panel letter
  });
});

describe("the measuring harness reports itself first (known-bad and known-tricky SVG)", () => {
  // 200 user units placed 100 mm wide: 1 unit = 0.5 mm.
  const tricky =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 200 50" font-size="10">` +
    `<defs><text font-size="1">hidden in defs</text></defs>` +
    `<title>not drawn</title>` +
    `<g font-size="8"><g><text x="0" y="10">inherited8</text></g></g>` +
    `<text style="font-size: 6px" font-size="20">styleWins6</text>` +
    `<g font-size="12"><text font-size="0.5em">half12is6</text></g>` +
    `<g transform="translate(5,5) scale(0.5)"><text font-size="10">scaled5</text></g>` +
    `<text font-size="10"><tspan font-size="2">tspan2</tspan></text>` +
    `<svg x="0" y="0" width="100" height="25" viewBox="0 0 200 50"><text font-size="10">nested5</text></svg>` +
    `<text font-size="3pt">pt4</text>` +
    `<text display="none" font-size="1">hidden</text>` +
    `</svg>`;
  const m = measureSvgText(tricky, 100);
  const byText = new Map(m.texts.map((t) => [t.text, t]));
  const mmFor = (userUnits: number): number => userUnits * 0.5;
  const ptFor = (userUnits: number): number => mmToPt(mmFor(userUnits));

  test("skips text that is not drawn", () => {
    expect(byText.has("hidden in defs")).toBe(false);
    expect(byText.has("not drawn")).toBe(false);
    expect(byText.has("hidden")).toBe(false);
  });
  test("resolves inheritance, style= over attribute, em, transforms, tspans, nested viewports and pt", () => {
    close(byText.get("inherited8")!.pt, ptFor(8), 1e-9);
    close(byText.get("styleWins6")!.pt, ptFor(6), 1e-9);
    close(byText.get("half12is6")!.pt, ptFor(6), 1e-9);
    close(byText.get("scaled5")!.pt, ptFor(5), 1e-9);
    close(byText.get("tspan2")!.pt, ptFor(2), 1e-9);
    close(byText.get("nested5")!.pt, ptFor(5), 1e-9);
    close(byText.get("pt4")!.pt, ptFor(4), 1e-9);
    expect(m.texts).toHaveLength(7);
    expect(m.unresolved).toEqual([]);
  });
  test("a known-too-small figure FAILS, with the run named", () => {
    const c = checkSvgAgainstPreset(tricky, FIGURE_PRESETS.nature, 100);
    expect(c.ok).toBe(false);
    // 2 units x 0.5 mm = 1 mm = 2.83 pt, under Nature's 5 pt minimum; nothing else is.
    expect(c.tooSmall.map((t) => t.text)).toEqual(["tspan2"]);
    expect(c.problems.join(" ")).toMatch(/below 5\.00 pt/);
  });
  test("a figure with no text does not pass vacuously", () => {
    const c = checkSvgAgainstPreset(`<svg viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`, FIGURE_PRESETS.nature);
    expect(c.ok).toBe(false);
    expect(c.textCount).toBe(0);
  });
  test("an unresolvable size or a <style> sheet is reported, never silently passed", () => {
    const c = checkSvgAgainstPreset(
      `<svg viewBox="0 0 336 100"><style>.t{font-size:3px}</style><text class="t" font-size="small">x</text></svg>`,
      FIGURE_PRESETS.nature,
    );
    expect(c.ok).toBe(false);
    expect(c.unresolved.length).toBe(2);
    const shorthand = checkSvgAgainstPreset(
      `<svg viewBox="0 0 336 100"><text style="font: 3px Arial">x</text></svg>`,
      FIGURE_PRESETS.nature,
    );
    expect(shorthand.ok).toBe(false);
    expect(shorthand.unresolved.join(" ")).toMatch(/"font:" shorthand/);
  });
  test("a title the same size as a panel letter is NOT exempt from the maximum", () => {
    const W = mmToPx(85);
    const big = ptToPx(8);
    const svg = `<svg viewBox="0 0 ${W} 100"><text font-size="${ptToPx(7)}">ok</text><text font-size="${big}">Title</text><text font-size="${big}" font-weight="bold">A</text></svg>`;
    const c = checkSvgAgainstPreset(svg, { ...FIGURE_PRESETS.nature, panelLetter: { ...FIGURE_PRESETS.nature.panelLetter } }, 85);
    expect(c.tooLarge.map((t) => t.text)).toEqual(["Title"]);
  });
  test("USPTO: greys, colours, opacity, gradients and images are all caught", () => {
    const bad =
      `<svg><rect fill="#333"/><line stroke="#888"/><rect fill="#000" fill-opacity="0.35"/><circle style="fill:red"/>` +
      `<linearGradient id="g"/><image href="x.png"/><rect fill="url(#p)" opacity="50%"/></svg>`;
    expect(nonBlackWhitePaints(bad)).toHaveLength(7);
    // A class-based paint cannot be resolved, so it is reported rather than passed.
    expect(nonBlackWhitePaints(`<svg><style>.s{fill:#888}</style><rect class="s"/></svg>`)).toHaveLength(1);
    expect(nonBlackWhitePaints(`<svg><rect fill="#FFF" stroke="black"/><path fill="none" stroke="#000000"/></svg>`)).toEqual([]);
  });
  test("USPTO: 12 pt is under 3.2 mm; 13 pt clears the rule by only 2.6 % and is refused; 14 pt passes", () => {
    const W = mmToPx(170);
    const mk = (pt: number): string => `<svg viewBox="0 0 ${W} 100"><text font-family="Arial, Helvetica, sans-serif" font-size="${ptToPx(pt)}">10</text></svg>`;
    expect(checkSvgAgainstPreset(mk(12), FIGURE_PRESETS.uspto, 170).ok).toBe(false);
    const c13 = checkSvgAgainstPreset(mk(13), FIGURE_PRESETS.uspto, 170);
    expect(c13.ok).toBe(false);
    expect(c13.problems.join(" ")).toContain("under 3.52 mm high (37 CFR 1.84(p)(3) requires 3.2 mm; this style keeps a 10 % margin)");
    expect(checkSvgAgainstPreset(mk(14), FIGURE_PRESETS.uspto, 170).ok).toBe(true);
  });
  test("refuses a non-positive width", () => {
    expect(() => measureSvgText("<svg/>", 0)).toThrow(RangeError);
    expect(() => measureSvgText("<svg/>", NaN)).toThrow(RangeError);
  });
});

describe("physicalSize and fitCanvasWidth", () => {
  test("keeps the aspect ratio and flags an over-tall figure", () => {
    const s = physicalSize(`<svg width="380" height="260" viewBox="0 0 380 260"></svg>`, 89, FIGURE_PRESETS.nature)!;
    close(s.heightMm, (89 * 260) / 380);
    expect(s.exceedsMaxHeight).toBe(false);
    expect(physicalSize(`<svg viewBox="0 0 100 400"></svg>`, 89, FIGURE_PRESETS.nature)!.exceedsMaxHeight).toBe(true);
    expect(physicalSize(`<svg></svg>`, 89)).toBeNull();
  });
  test("refuses a size spread wider than the band (10-13 px = 1.3:1 fits Nature's 5-7 pt = 1.4:1; 9-13 px = 1.44:1 does not)", () => {
    expect(fitCanvasWidth(FIGURE_PRESETS.nature, 89, { min: 10, max: 13 }).ok).toBe(true);
    expect(fitCanvasWidth(FIGURE_PRESETS.nature, 89, { min: 9, max: 13 }).ok).toBe(false);
    const r = fitCanvasWidth(FIGURE_PRESETS.nature, 89, { min: 6, max: 13 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no single scale fits both ends/);
    expect(fitCanvasWidth(FIGURE_PRESETS.nature, 89, { min: 0, max: 0 }).ok).toBe(false);
  });
  test("reports a builder that ignores the width it is given", () => {
    const fixed = (): string => `<svg viewBox="0 0 380 260"><text font-size="4">tiny</text></svg>`;
    const r = renderAtPreset(fixed, FIGURE_PRESETS.thesis, 75);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ignored the requested canvas width/);
  });
});

// ACCEPTANCE (brief D, Builder 2): at preset width the smallest text is >= the preset
// minimum, MEASURED on the SVG real builders render. Each builder is driven through
// renderAtPreset (canvas chosen from the measured sizes), and the check is re-measured
// on the returned SVG.
describe("acceptance: real builders rendered at every journal preset, measured", () => {
  const journal: FigureStylePreset[] = ["nature", "elsevier", "acs", "cell", "thesis"].map((id) => FIGURE_PRESETS[id as "nature"]);
  const builders: Record<string, (w: number) => string> = {
    plot: (w) =>
      buildPlotSvg(
        [
          { type: "line", points: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 4.5 }], label: "control" },
          { type: "scatter", points: [{ x: 0, y: 2 }, { x: 1, y: 2.5 }, { x: 2, y: 3.1 }], label: "treated" },
        ],
        { width: w, height: Math.round(w * 0.7), xlabel: "Time (s)", ylabel: "Voltage (mV)", title: "Response" },
      ),
    boxPlot: (w) =>
      boxPlotSvg(
        [
          { label: "WT", values: [1.2, 2.3, 3.1, 4.4, 5.0, 3.3] },
          { label: "KO", values: [2.1, 3.4, 4.2, 6.6, 8.1, 5.5] },
        ],
        { w, h: Math.round(w * 0.7), ylabel: "Expression", title: "Box" },
      ),
    groupedBar: (w) =>
      groupedBarSvg(
        ["Day 1", "Day 2", "Day 3"],
        [
          { label: "Control", values: [1, 2, 3] },
          { label: "Drug", values: [2, 3, 5] },
        ],
        { w, h: Math.round(w * 0.7), ylabel: "Count" },
      ),
  };
  for (const p of journal) {
    for (const which of ["single", "double"] as const) {
      for (const [name, render] of Object.entries(builders)) {
        test(`${name} at ${p.id} ${which}`, () => {
          const mm = presetWidthMm(p, which) as number;
          const r = renderAtPreset(render, p, mm);
          const again = checkSvgAgainstPreset(r.svg, p, mm); // re-measure the returned SVG
          expect(again.textCount).toBeGreaterThan(3);
          expect(again.minPt as number).toBeGreaterThanOrEqual(p.sizesPt.min - 0.005);
          if (p.sizesPt.max !== null) expect(again.tooLarge).toEqual([]);
          expect(again.problems).toEqual([]);
          expect(r.ok).toBe(true);
        });
      }
    }
  }
});

describe("acceptance: USPTO preset with Table->Chart patent mode at 170 mm, measured", () => {
  const p = FIGURE_PRESETS.uspto;
  const series = parseTableData([
    ["Month", "Control", "Treated"],
    ["Jan", "12.5", "14.1"],
    ["Feb", "13.2", "16.8"],
    ["Mar", "15.0", "19.3"],
  ]);
  const ohlc = parseTableData([
    ["Day", "Open", "High", "Low", "Close"],
    ["Mon", "10", "12", "9", "11"],
    ["Tue", "11", "13", "10", "12.5"],
    ["Wed", "12.5", "13", "11", "11.5"],
  ]);
  const kinds: ChartKind[] = [
    "column",
    "bar",
    "line",
    "area",
    "scatter",
    "stacked-column",
    "stacked-bar",
    "stacked-area",
    "pie",
    "doughnut",
    "heatmap",
    "candlestick",
  ];
  // A pie draws ONE column; it is fed the one-column table a user would give it. The
  // two-column case is pinned separately below as a known defect.
  const share = parseTableData([
    ["Part", "Share"],
    ["Housing", "40"],
    ["Rotor", "35"],
    ["Seal", "25"],
  ]);
  const dataFor = (kind: ChartKind): ReturnType<typeof parseTableData> =>
    kind === "candlestick" ? ohlc : kind === "pie" || kind === "doughnut" ? share : series;
  for (const kind of kinds) {
    test(`${kind}: black and white exactly when the preset does not refuse it`, () => {
      const svg = buildChartPreviewSvg(dataFor(kind), kind, "", { patent: true }).svg;
      const bw = nonBlackWhitePaints(svg).length === 0;
      // Both directions: a refused kind that has become pure black and white must leave
      // the list, and an allowed kind must never emit grey or colour.
      expect(p.refusedChartKinds.includes(kind)).toBe(!bw);
    });
  }
  test("allowed kinds, as the pane inserts them (prepareFigure + re-render), clear 1.84(p)(3) by >= 10 % at 170 mm", () => {
    for (const kind of kinds.filter((k) => !p.refusedChartKinds.includes(k))) {
      const render = (w: number): string => buildChartPreviewSvg(dataFor(kind), kind, "", { patent: true }, w).svg;
      const prep = prepareFigure({ svg: render(380), preset: "uspto", width: "single", render, chartKind: kind });
      expect({ kind, ok: prep.ok, why: prep.ok ? "" : prep.problems }).toEqual({ kind, ok: true, why: "" });
      if (!prep.ok) continue;
      // MEASURED on the SVG prepareFigure returns, never computed from the preset.
      const c = checkSvgAgainstPreset(prep.svg, p, 170);
      expect(c.minCharHeightMm as number).toBeGreaterThanOrEqual(3.52 - 1e-6);
      expect(((c.minCharHeightMm as number) - 3.2) / 3.2).toBeGreaterThanOrEqual(0.1 - 1e-6);
    }
  });
  test("as drawn, with NO re-render (the check alone), every allowed kind also clears 3.2 mm by >= 10 % at 170 mm", () => {
    // The margin is enforced by the CHECK, so it holds on a path that cannot
    // re-render too; the synthetic 13 pt case above proves the check refuses
    // a figure that merely complies.
    for (const kind of kinds.filter((k) => !p.refusedChartKinds.includes(k))) {
      const svg = buildChartPreviewSvg(dataFor(kind), kind, "", { patent: true }).svg;
      const prep = prepareFigure({ svg, preset: "uspto", width: "single", chartKind: kind });
      expect({ kind, ok: prep.ok }).toEqual({ kind, ok: true });
      const c = checkSvgAgainstPreset(svg, p, 170);
      expect(((c.minCharHeightMm as number) - 3.2) / 3.2).toBeGreaterThanOrEqual(0.1 - 1e-6);
    }
  });
  // WAS A KNOWN DEFECT (measured 2026-10-14): a pie fed two data columns printed the
  // note "first data column only" in #999 at 9 px, grey and 2.88 mm high at 170 mm, in
  // patent mode. Fixed in tablechart.ts (black, at the patent lower-case size); the
  // test.failing flipped, so it is a plain test now. The note is still IN the figure.
  test("two-column pie in patent mode: the 'first data column only' note is black, large enough, and still drawn", () => {
    const svg = buildChartPreviewSvg(series, "pie", "", { patent: true }).svg;
    expect(svg).toContain("first data column only");
    expect(checkSvgAgainstPreset(svg, p, 170).problems).toEqual([]);
  });
});

describe("source hygiene", () => {
  test("no invisible characters (U+FEFF, U+200B-U+200D) in Builder 2's files", () => {
    const bad = [0xfeff, 0x200b, 0x200c, 0x200d].map((c) => String.fromCharCode(c));
    const files = [
      path.join(__dirname, "..", "figureStyle.ts"),
      path.join(__dirname, "..", "categoricalPalette.ts"),
      path.join(__dirname, "figureStyle.test.ts"),
      path.join(__dirname, "categoricalPalette.test.ts"),
    ];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const ch of bad) expect({ file: path.basename(f), found: text.includes(ch) }).toEqual({ file: path.basename(f), found: false });
    }
  });
  test("font stacks quote with single quotes so they fit in a double-quoted attribute", () => {
    for (const id of PRESET_IDS) expect(FIGURE_PRESETS[id].fontFamily.includes('"')).toBe(false);
  });
});
