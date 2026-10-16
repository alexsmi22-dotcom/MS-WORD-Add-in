// composePanels: one flat SVG (no nested <svg>), letters per preset, ids namespaced.
import { composePanels, flattenNestedSvgs, namespaceIds } from "../panels";
import { buildPlotSvg, combineSvgs } from "../plot";
import { boxPlotSvg } from "../statchart";
import { FIGURE_PRESETS, PRESET_IDS, measureSvgText, isPanelLetterRun, mmToPx, usptoPatternDefs, panelLabel } from "../figureStyle";

const plot = (title: string) =>
  buildPlotSvg([{ type: "scatter", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#000" }], { width: 300, height: 190, title });
const box = () => boxPlotSvg([{ label: "a", values: [1, 2, 3] }, { label: "b", values: [2, 4, 5] }], {});

const svgCount = (s: string) => s.split("<svg").length - 1;
const ids = (s: string) => Array.from(s.matchAll(/\sid="([^"]+)"/g), (m) => m[1]);

describe("one flat document", () => {
  test("three panels → exactly one <svg>, panels as translate groups", () => {
    const c = composePanels([plot("a"), box(), plot("c")], { preset: "nature", cols: 2 });
    expect(svgCount(c.svg)).toBe(1);
    expect(c.svg.split("</svg>").length - 1).toBe(1);
    // The audit's own pattern (figure-layout-audit.js): translate with plain numbers.
    const audit = /<g\b([^>]*\btransform="translate\(\s*(-?[\d.]+)(?:[,\s]+(-?[\d.]+))?\s*\)"[^>]*)>/g;
    expect(Array.from(c.svg.matchAll(audit))).toHaveLength(3);
    expect(c.svg).not.toMatch(/NaN|Infinity|e[+-]\d/);
  });

  test("a child that itself nests <svg> (the old combineSvgs output) is flattened too", () => {
    const old =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
      `<svg x="10" y="5" width="20" height="20" viewBox="0 0 10 10" font-family="Arial"><circle id="c" cx="5" cy="5" r="4"/>` +
      `<svg width="4" height="4"><rect width="4" height="4"/></svg></svg></svg>`;
    const c = composePanels([old, plot("b")]);
    expect(svgCount(c.svg)).toBe(1);
    expect(c.svg).toContain(`<g transform="translate(10,5)"><g transform="scale(2)" font-family="Arial">`);
  });

  test("flattenNestedSvgs maps viewBox with preserveAspectRatio", () => {
    const g = flattenNestedSvgs(`<svg x="0" y="0" width="100" height="50" viewBox="0 0 10 10"><rect/></svg>`);
    // meet: uniform scale 5, centred in x by (100 - 50) / 2.
    expect(g).toBe(`<g transform="translate(0,0)"><g transform="translate(25,0) scale(5)"><rect/></g></g>`);
    const n = flattenNestedSvgs(`<svg width="100" height="50" viewBox="0 0 10 10" preserveAspectRatio="none"><rect/></svg>`);
    expect(n).toContain("scale(10,5)");
  });

  test("combineSvgs keeps its signature and dimensions, now flat", () => {
    const r = combineSvgs([plot("a"), plot("b")], 8);
    expect(r.width).toBe(300);
    expect(r.height).toBe(388);
    expect(svgCount(r.svg)).toBe(1);
  });

  test("the real layout auditor measures a composed figure as one picture", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audit = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (n: string, s: string) => { found: string[]; textCount: number } };
    const a = plot("a");
    const b = box();
    const alone = audit.auditSvg("a", a).textCount + audit.auditSvg("b", b).textCount;
    const r = audit.auditSvg("combined", combineSvgs([a, b]).svg);
    expect(r.textCount).toBe(alone);
    expect(r.found).toEqual([]);
  });

  test("garbage and empties are refused", () => {
    expect(() => composePanels([])).toThrow(/no panels/);
    expect(() => composePanels(["<div/>"])).toThrow(TypeError);
    expect(() => composePanels([plot("a") + plot("b")])).toThrow(/after its root/);
    expect(() => composePanels([plot("a"), plot("b")], { cols: 3 })).toThrow(/cols/);
    expect(() => composePanels([plot("a")], { letters: true })).toThrow(/preset/);
    expect(() => composePanels([plot("a")], { preset: "vogue" as never })).toThrow(/unknown/);
  });
});

describe("ids are namespaced per panel", () => {
  test("the same panel twice: every id unique, every url(#) resolves", () => {
    // A y limit that clips data makes buildPlotSvg emit a clipPath (an id).
    const p = buildPlotSvg([{ type: "scatter", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#000" }], { width: 300, height: 190, yLimits: { max: 0.5 } });
    expect(ids(p).length).toBeGreaterThan(0);
    const c = composePanels([p, p, p], { preset: "cell", cols: 3 });
    const all = ids(c.svg);
    expect(new Set(all).size).toBe(all.length);
    for (const m of c.svg.matchAll(/url\(#([^)]+)\)/g)) expect(all).toContain(m[1]);
  });

  test("USPTO hatch patterns (fi-diag …) in two panels no longer collide", () => {
    const hatched = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60">${usptoPatternDefs()}<rect width="50" height="50" fill="url(#fi-diag)" stroke="#000"/></svg>`;
    const c = composePanels([hatched, hatched], { preset: "uspto", cols: 2 });
    const all = ids(c.svg);
    expect(all.length).toBeGreaterThan(2);
    expect(new Set(all).size).toBe(all.length);
    expect(c.svg).toContain("url(#p0-fi-diag)");
    expect(c.svg).toContain("url(#p1-fi-diag)");
  });

  test("exact references only: clip1 is not clip10, foreign ids are untouched", () => {
    const m =
      `<clipPath id="clip1"/><clipPath id="clip10"/>` +
      `<g clip-path="url(#clip1)"/><g clip-path="url('#clip10')"/><use href="#clip1"/><use xlink:href="#clip10"/><g fill="url(#elsewhere)"/>`;
    const out = namespaceIds(m, "p3-");
    expect(out).toContain(`id="p3-clip1"`);
    expect(out).toContain(`id="p3-clip10"`);
    expect(out).toContain(`url(#p3-clip1)`);
    expect(out).toContain(`url('#p3-clip10')`);
    expect(out).toContain(`href="#p3-clip1"`);
    expect(out).toContain(`xlink:href="#p3-clip10"`);
    expect(out).toContain(`url(#elsewhere)`);
  });

  test("xlink references get the namespace declared on the root", () => {
    const child = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><path id="d" d="M0,0"/></defs><use xlink:href="#d"/></svg>`;
    expect(composePanels([child, child]).svg).toContain(`xmlns:xlink="http://www.w3.org/1999/xlink"`);
  });
});

describe("panel letters follow the preset: case, weight, size", () => {
  test.each(PRESET_IDS.map((id) => [id]))("%s", (id) => {
    const preset = FIGURE_PRESETS[id];
    const c = composePanels([plot("a"), box(), plot("c")], { preset, cols: 2 });
    expect(c.width).toBeCloseTo(mmToPx(preset.widthsMm.single), 6);
    // Measured at the printed width, by the same instrument the preset checker uses.
    const meas = measureSvgText(c.svg, preset.widthsMm.single);
    const letters = meas.texts.filter((t) => isPanelLetterRun(t, preset) || /^FIG\./.test(t.text));
    const want = [0, 1, 2].map((k) => panelLabel(preset, k));
    expect(letters.map((t) => t.text)).toEqual(want);
    for (const t of letters) {
      expect(t.pt).toBeCloseTo(preset.panelLetter.sizePt, 3);
      expect(t.bold).toBe(preset.panelLetter.weight === "bold");
    }
    if (!preset.panelLetter.figurePrefix) {
      const isUpper = preset.panelLetter.letterCase === "upper";
      for (const l of want) expect(/[A-Z]/.test(l)).toBe(isUpper);
    }
  });

  test("letters sit in a band above the panel, not on it", () => {
    const c = composePanels([plot("a"), plot("b")], { preset: "nature", cols: 2 });
    for (const pl of c.panels) {
      const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*font-weight="bold"[^>]*>${pl.label}</text>`).exec(c.svg);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(pl.x, 2);
      // Baseline at or above the panel's top edge: the glyph is in the band.
      expect(Number(m![2])).toBeLessThanOrEqual(pl.y);
    }
  });

  test("the preset width is honoured and panels scale into their cells", () => {
    const c = composePanels([plot("a"), plot("b"), plot("c"), plot("d")], { preset: "nature", width: "double", cols: 2, gap: 10 });
    expect(c.widthMm).toBe(183);
    expect(c.cellWidth).toBeCloseTo((mmToPx(183) - 10) / 2, 9);
    for (const pl of c.panels) expect(pl.w).toBeCloseTo(c.cellWidth, 9);
    expect(c.svg).toContain("scale(");
  });

  test("a figure taller than the preset allows says so", () => {
    const tall = Array.from({ length: 12 }, (_, k) => plot(String(k)));
    expect(composePanels(tall, { preset: "nature", cols: 1 }).exceedsMaxHeight).toBe(true);
    expect(composePanels(tall.slice(0, 2), { preset: "nature", cols: 2 }).exceedsMaxHeight).toBe(false);
  });
});
