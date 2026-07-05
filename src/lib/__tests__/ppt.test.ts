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
import { prepareTableFigure } from "../tablefigure";

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

  test("mainTable exports a native editable PowerPoint table, not a chart or picture", async () => {
    const prepared = prepareTableFigure([
      ["Section", "Characteristic", "n", "Percent"],
      ["Demographics", "", "", ""],
      ["", "Female", "8,408", "75.0%"],
      ["", "Male", "2,803", "25.0%"],
    ]);
    const blob = await buildTablePptx(
      { categories: [], series: [], categoryLabel: "", hasHeader: true, rows: [], warnings: [] },
      "column",
      { title: "Baseline", mainTable: { grid: prepared.grid, kinds: prepared.kinds, numericCol: prepared.numericCol } }
    );
    const zip = await unzip(blob);
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("<a:tbl>"); // a real table on the main slide
    expect(slide1).toContain("Female");
    expect(zip.file(/ppt\/charts\/chart\d*\.xml/).length).toBe(0); // no chart
    expect(zip.file(/ppt\/media\/image[\d-]*\.png/).length).toBe(0); // no picture
    expect(zip.file("ppt/slides/slide2.xml")).toBeNull(); // no redundant data slide
    expect(slide1).toContain('gridSpan="3"'); // section band spans the row
  });

  test("flowchart exports as native editable shapes with editable text", async () => {
    const rows = [
      ["Receive the input signal"],
      ["Filter the signal"],
      ["Signal above threshold?"],
      ["Store the result"],
    ];
    const blob = await buildTablePptx(
      { categories: [], series: [], categoryLabel: "", hasHeader: false, rows, warnings: [] },
      "column",
      { title: "Method", diagramShapes: { kind: "flowchart", rows, numerals: true, patent: true } }
    );
    const zip = await unzip(blob);
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("<p:sp>"); // native shapes
    expect(slide1).toContain("Filter the signal"); // editable text run
    expect(slide1).toContain('prst="diamond"'); // decision step is a diamond
    expect(slide1).toContain(">102<"); // reference numeral
    expect(zip.file(/ppt\/media\/image[\d-]*\.png/).length).toBe(0); // not a picture
    expect(zip.file(/ppt\/charts\/chart\d*\.xml/).length).toBe(0);
  });

  test("block diagram exports as native editable shapes with shrink-to-fit text", async () => {
    const longLabel =
      "Most recent prior GLP-1 within 365 days including oral Wegovy initiators and all other switchers in the cohort";
    const rows = [
      ["System", "Controller", "CPU"],
      ["System", "Controller", "Memory"],
      ["System", longLabel, ""],
    ];
    const blob = await buildTablePptx(
      { categories: [], series: [], categoryLabel: "", hasHeader: false, rows, warnings: [] },
      "column",
      { diagramShapes: { kind: "hierarchy", rows, numerals: false, patent: false } }
    );
    const zip = await unzip(blob);
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("<p:sp>");
    expect(slide1).toContain("Controller");
    // Text auto-shrinks to stay inside the box…
    expect(slide1).toContain("<a:normAutofit");
    // …and paragraph-long labels are truncated with an ellipsis.
    expect(slide1).toContain("…");
    expect(slide1).not.toContain("switchers in the cohort");
    expect(zip.file(/ppt\/media\/image[\d-]*\.png/).length).toBe(0);
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
