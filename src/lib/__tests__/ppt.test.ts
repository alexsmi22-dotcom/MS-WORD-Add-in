/**
 * Smoke tests for the PowerPoint export: builds a real .pptx in-memory and
 * checks the OOXML inside the zip (a .pptx is a zip archive).
 *
 * Runs under jsdom so PptxGenJS takes its browser code path — the same one the
 * task pane uses (its Node path needs dynamic `import("node:fs")`, which Jest
 * can't evaluate without --experimental-vm-modules).
 *
 * @jest-environment jsdom
 */
import JSZip from "jszip";
import { buildTablePptx } from "../ppt";
import { parseTableData } from "../tablechart";

const chart = parseTableData([
  ["Year", "Sales", "Costs"],
  ["2022", "100", "80"],
  ["2023", "150", "90"],
  ["2024", "210", "95"],
]);

async function unzip(blob: Blob): Promise<JSZip> {
  // jsdom's Blob has no arrayBuffer(); JSZip reads Blobs via FileReader.
  return JSZip.loadAsync(blob);
}

describe("buildTablePptx", () => {
  test("produces a valid pptx with a native chart and a table slide", async () => {
    const blob = await buildTablePptx(chart, "column", { title: "Sales by year" });
    const zip = await unzip(blob);

    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide2.xml")).toBeTruthy(); // source table
    expect(zip.file(/ppt\/charts\/chart\d*\.xml/).length).toBeGreaterThan(0);

    const chartXml = await zip.file(/ppt\/charts\/chart\d*\.xml/)[0].async("string");
    expect(chartXml).toContain("barChart");
    expect(chartXml).toContain("Sales");
    expect(chartXml).toContain("2023");

    const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2).toContain("<a:tbl>"); // the reproduced source table
    expect(slide2).toContain("Costs");

    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("Sales by year");
  });

  test("skips the table slide when includeTable is false", async () => {
    const blob = await buildTablePptx(chart, "line", { includeTable: false });
    const zip = await unzip(blob);
    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide2.xml")).toBeNull();
    const chartXml = await zip.file(/ppt\/charts\/chart\d*\.xml/)[0].async("string");
    expect(chartXml).toContain("lineChart");
  });

  test("chartImage replaces the native chart with a picture (patent style)", async () => {
    // 1×1 transparent PNG.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const blob = await buildTablePptx(chart, "column", {
      chartImage: { dataUrl: png, wPx: 380, hPx: 286 },
      includeTable: false,
    });
    const zip = await unzip(blob);
    expect(zip.file(/ppt\/charts\/chart\d*\.xml/).length).toBe(0);
    expect(zip.file(/ppt\/media\/image[\d-]*\.png/).length).toBeGreaterThan(0);
  });

  test("pie chart exports only the first series", async () => {
    const blob = await buildTablePptx(chart, "pie", {});
    const zip = await unzip(blob);
    const chartXml = await zip.file(/ppt\/charts\/chart\d*\.xml/)[0].async("string");
    expect(chartXml).toContain("pieChart");
    expect(chartXml).toContain("Sales");
    expect(chartXml).not.toContain("Costs");
  });
});
