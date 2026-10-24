/**
 * @jest-environment jsdom
 */
// fix2-cad, the findings that need the DOM: (1) PowerPoint blanks — PptxGenJS takes its browser path, as in
// ppt.test.ts; (2, insert side) a USPTO sheet wider than Word's text column is fitted to it while its lettering
// stays at least 3.2 mm (37 CFR 1.84(p)(3)), and the status says so — cadPane needs the DOM to load.
import JSZip from "jszip";
import { buildTablePptx } from "../ppt";
import { parseTableData } from "../tablechart";
import { fitNote, FIT_MM } from "../../taskpane/cadPane";
import { USPTO_MIN_CHAR_HEIGHT_MM, USPTO_REQUIRED_CHAR_HEIGHT_MM } from "../figureStyle";

// PptxGenJS sniffs process.release / versions.node for its Node path (see ppt.test.ts): masked, as in the browser.
const realRelease = process.release;
const realVersions = process.versions;
beforeAll(() => {
  Object.defineProperty(process, "release", { value: undefined, configurable: true });
  Object.defineProperty(process, "versions", { value: { ...realVersions, node: undefined }, configurable: true });
});
afterAll(() => {
  Object.defineProperty(process, "release", { value: realRelease, configurable: true });
  Object.defineProperty(process, "versions", { value: realVersions, configurable: true });
});

describe("1. PowerPoint: a blank cell is a gap, not 0", () => {
  const chart = parseTableData([
    ["Quarter", "Sales", "Cost"],
    ["Q1", "10", "4"],
    ["Q2", "", "5"],
    ["Q3", "14", "6"],
  ]);
  test.each(["line", "column"] as const)("%s chart: Q2 is an empty point and the chart shows blanks as gaps", async (kind) => {
    expect(chart.series[0].values).toEqual([10, null, 14]);
    const zip = await JSZip.loadAsync(await buildTablePptx(chart, kind, { includeTable: false }));
    const xml = await zip.file(/ppt\/charts\/chart\d*\.xml/)[0].async("string");
    expect(xml).toContain('<c:dispBlanksAs val="gap"/>');
    const sales = /<c:val>.*?<\/c:val>/s.exec(xml)![0];
    expect(sales).toContain('<c:pt idx="1"><c:v></c:v></c:pt>');
    expect(sales).not.toContain('<c:pt idx="1"><c:v>0</c:v></c:pt>');
  });
});

describe("USPTO sheet insert fits Word's text column", () => {
  test("insert: a sheet wider than Word's column is fitted (lettering stays ≥ 3.2 mm) and says so; engineering sheets unchanged", () => {
    const f = fitNote({ standard: "uspto", wMm: 170, hMm: 244, scale: 1 });
    expect(f.k).toBeCloseTo(Math.min(FIT_MM.w / 170, FIT_MM.h / 244), 9);
    expect(f.k * USPTO_REQUIRED_CHAR_HEIGHT_MM).toBeGreaterThanOrEqual(USPTO_MIN_CHAR_HEIGHT_MM);
    expect(f.note).toMatch(/inserted at 94 % to fit the page's text column; its lettering stays at least 3\.2 mm/);
    expect(fitNote({ standard: "uspto", wMm: 150, hMm: 200, scale: 1 })).toEqual({ k: 1, note: "" });
    // So wide that fitting would break the 3.2 mm floor: inserted as drawn, and said.
    const wide = fitNote({ standard: "uspto", wMm: 400, hMm: 244, scale: 1 });
    expect(wide.k).toBe(1);
    expect(wide.note).toMatch(/under 3\.2 mm.*inserted at full size/);
    expect(fitNote({ standard: "journal", wMm: 180, hMm: 200, scale: 1 })).toEqual({ k: 1, note: "" });
  });
});
