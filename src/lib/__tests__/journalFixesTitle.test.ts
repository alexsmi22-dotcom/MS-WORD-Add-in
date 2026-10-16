// v2.143.0 review, item 2: "no title in the artwork" (37 CFR 1.84, the USPTO
// preset's allowTitle: false) was enforced only by the pane blanking the
// Table→Chart title box. The library never read allowTitle, so a titled figure
// went in under USPTO through prepareFigure, and the panel tray — whose render
// closure captured the title under As drawn — put it in too.

import { checkSvgAgainstPreset, FIGURE_PRESETS, stripFigureTitles } from "../figureStyle";
import { prepareFigure, composePanelFigure, type PanelItem } from "../insertCapability";
import { buildChartPreviewSvg, parseTableData } from "../tablechart";
import { buildPlotSvg } from "../plot";
import { boxPlotSvg } from "../statchart";
import { buildTableFigureSvg } from "../tablefigure";

const chart = parseTableData([
  ["Quarter", "Revenue", "Costs"],
  ["Q1", "12.5", "14.1"],
  ["Q2", "13.2", "16.8"],
]);
const TITLE = "QUARTERLY RESULTS";
const titled = (w: number): string => buildChartPreviewSvg(chart, "column", TITLE, { patent: true }, w).svg;
const visibleText = (svg: string): string => svg.replace(/<[^>]*>/g, " ");

describe("USPTO: no title in the artwork, enforced in the library", () => {
  test("checkSvgAgainstPreset flags a drawn title under USPTO, and not under a journal that allows titles", () => {
    const svg = titled(380);
    const us = checkSvgAgainstPreset(svg, FIGURE_PRESETS.uspto);
    expect(us.ok).toBe(false);
    expect(us.problems.join(" ")).toMatch(/title/i);
    expect(us.problems.join(" ")).toContain(TITLE);
    const nat = checkSvgAgainstPreset(buildChartPreviewSvg(chart, "column", TITLE, {}, 380).svg, FIGURE_PRESETS.nature);
    expect(nat.problems.join(" ")).not.toMatch(/title in the artwork/i);
  });

  test("the FIG. label is not a title", () => {
    const svg = buildChartPreviewSvg(chart, "column", "", { patent: true, figLabel: "FIG. 1" } as never, 380).svg;
    expect(stripFigureTitles(svg)).toBe(svg);
  });

  test("prepareFigure under USPTO never inserts the title (repro: ok:true with the title)", () => {
    const p = prepareFigure({ svg: titled(380), preset: "uspto", width: "single", render: titled, chartKind: "column" });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(visibleText(p.svg)).not.toContain(TITLE);
      expect(p.presetNote).toMatch(/title left out/);
    }
    const q = prepareFigure({ svg: titled(380), preset: "uspto", width: "single" });
    expect(q.ok).toBe(true);
    if (q.ok) expect(visibleText(q.svg)).not.toContain(TITLE);
  });

  test("composePanelFigure under USPTO never inserts a title captured As drawn (repro: ok:true with the title)", () => {
    const item: PanelItem = { svg: titled(380), render: titled, source: "Table → Chart" };
    const f = composePanelFigure([item, item], "uspto", "single", 2);
    expect(f.ok).toBe(true);
    if (f.ok) expect(visibleText(f.svg)).not.toContain(TITLE);
    // A panel with no re-render is stripped too.
    const g = composePanelFigure([{ svg: titled(380), source: "Table → Chart" }, item], "uspto", "single", 2);
    if (g.ok) expect(visibleText(g.svg)).not.toContain(TITLE);
    else expect(g.problems.join(" ")).not.toMatch(/title/i);
    const asDrawn = composePanelFigure([item, item], "asdrawn", "single", 2);
    expect(asDrawn.ok && visibleText(asDrawn.svg).includes(TITLE)).toBe(true);
  });

  test("As drawn and the journal styles keep the title", () => {
    const p = prepareFigure({ svg: titled(380), preset: "asdrawn", width: "single" });
    expect(p.ok && p.svg.includes(TITLE)).toBe(true);
  });

  test.each([
    ["plot", () => buildPlotSvg([{ points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }] as never, { title: TITLE } as never)],
    ["box plot", () => boxPlotSvg([{ label: "a", values: [1, 2, 3] }, { label: "b", values: [2, 3, 5] }], { title: TITLE })],
    ["table figure", () => buildTableFigureSvg([["A", "B"], ["1", "2"]], TITLE, {}).svg as string],
  ])("%s: its title is marked, so the check sees it", (_n, make) => {
    const svg = make();
    expect(svg).toContain(TITLE);
    expect(visibleText(stripFigureTitles(svg))).not.toContain(TITLE);
  });
});
