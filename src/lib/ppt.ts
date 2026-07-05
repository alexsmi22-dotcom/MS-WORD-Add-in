// Builds a PowerPoint (.pptx) file from parsed table data using PptxGenJS.
// The chart is a native PowerPoint chart (fully editable after export), with
// the source table optionally reproduced on a second slide. Everything runs
// locally in the task pane; the caller downloads the returned Blob.
//
// This module is loaded lazily (dynamic import) so PptxGenJS stays out of the
// main task-pane bundle.

import pptxgen from "pptxgenjs";
import { ChartKind, TableChart, CHART_PALETTE } from "./tablechart";

export interface TablePptOptions {
  /** Slide + chart title; omitted when blank. */
  title?: string;
  /** Reproduce the source table on a second slide (default true). */
  includeTable?: boolean;
  /**
   * Pre-rendered chart image (PNG data URL + pixel size). When set — used for
   * the patent (B&W) style, which PowerPoint's native charts can't draw
   * (no hatch patterns) — the slide gets this picture instead of a chart.
   */
  chartImage?: { dataUrl: string; wPx: number; hPx: number };
  /**
   * When set, the main slide is a native, editable PowerPoint TABLE (not a
   * chart or picture) — used for the "table figure" representation, so the
   * text stays editable. Overrides chartImage/chart. `kinds` mark header/band
   * rows for shading; `numericCol` right-aligns numeric columns.
   */
  mainTable?: { grid: string[][]; kinds: ("header" | "band" | "data")[]; numericCol: boolean[] };
}

/** PptxGenJS wants hex colors without the leading "#". */
const PPT_COLORS = CHART_PALETTE.map((c) => c.replace("#", "").toUpperCase());

export async function buildTablePptx(chart: TableChart, kind: ChartKind, opts: TablePptOptions = {}): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_16x9";
  const title = (opts.title ?? "").trim();
  if (title) pptx.title = title;

  const slide = pptx.addSlide();
  if (title) {
    slide.addText(title, { x: 0.4, y: 0.2, w: 9.2, h: 0.6, fontSize: 20, bold: true, color: "222222" });
  }

  const areaY = title ? 0.9 : 0.4;
  const areaH = title ? 4.3 : 4.8;

  if (opts.mainTable) {
    // Native, editable PowerPoint table (the "table figure" representation).
    const { grid, kinds, numericCol } = opts.mainTable;
    const rows: pptxgen.TableRow[] = grid.map((r, i) => {
      const kind = kinds[i];
      if (kind === "band") {
        const label = r.find((c) => c !== "") ?? "";
        // A section band spans the whole row (colspan on the first cell).
        return [
          { text: label, options: { bold: true, fill: { color: "DBE6F2" }, color: "222222", colspan: Math.max(1, r.length) } },
        ];
      }
      return r.map((c, j) => ({
        text: c,
        options:
          kind === "header"
            ? { bold: true, fill: { color: "E7EEF6" }, color: "222222", align: "left" as const }
            : { color: "333333", align: (numericCol[j] ? "right" : "left") as "right" | "left" },
      }));
    });
    slide.addTable(rows, {
      x: 0.4,
      y: areaY,
      w: 9.2,
      fontSize: 12,
      border: { type: "solid", pt: 0.5, color: "BBBBBB" },
      autoPage: true,
      autoPageRepeatHeader: kinds[0] === "header",
    });
    return (await pptx.write({ outputType: "blob" })) as Blob;
  }

  if (opts.chartImage) {
    // Fit the pre-rendered figure inside the chart area, preserving aspect.
    const wIn = opts.chartImage.wPx / 96;
    const hIn = opts.chartImage.hPx / 96;
    const scale = Math.min(9.2 / wIn, areaH / hIn);
    const w = wIn * scale;
    const h = hIn * scale;
    slide.addImage({
      data: opts.chartImage.dataUrl,
      x: 0.4 + (9.2 - w) / 2,
      y: areaY + (areaH - h) / 2,
      w,
      h,
    });
  } else {
    const pie = kind === "pie" || kind === "doughnut";
    // Pie/doughnut charts show a single series — the first data column.
    const source = pie ? chart.series.slice(0, 1) : chart.series;
    const data = source.map((s) => ({
      name: s.name,
      labels: chart.categories,
      values: s.values.map((v) => v ?? 0),
    }));

    const typeMap: Record<ChartKind, pptxgen.CHART_NAME> = {
      column: pptx.ChartType.bar,
      bar: pptx.ChartType.bar,
      line: pptx.ChartType.line,
      area: pptx.ChartType.area,
      pie: pptx.ChartType.pie,
      doughnut: pptx.ChartType.doughnut,
    };

    slide.addChart(typeMap[kind], data, {
      x: 0.4,
      y: areaY,
      w: 9.2,
      h: areaH,
      barDir: kind === "bar" ? "bar" : "col",
      chartColors: PPT_COLORS,
      showLegend: pie || chart.series.length > 1,
      legendPos: "b",
      showTitle: false,
      ...(chart.categoryLabel && !pie
        ? { showCatAxisTitle: true, catAxisTitle: chart.categoryLabel }
        : {}),
      ...(pie ? { showPercent: true } : {}),
    });
  }

  if (opts.includeTable !== false && chart.rows.length) {
    const tableSlide = pptx.addSlide();
    tableSlide.addText(title ? `${title} — data` : "Source table", {
      x: 0.4,
      y: 0.2,
      w: 9.2,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: "222222",
    });
    const tableRows: pptxgen.TableRow[] = chart.rows.map((r, i) =>
      r.map((c) => ({
        text: c,
        options:
          chart.hasHeader && i === 0
            ? { bold: true, fill: { color: "1F77B4" }, color: "FFFFFF" }
            : { color: "333333" },
      }))
    );
    tableSlide.addTable(tableRows, {
      x: 0.4,
      y: 0.9,
      w: 9.2,
      fontSize: 12,
      border: { type: "solid", pt: 0.5, color: "BBBBBB" },
      autoPage: true,
      autoPageRepeatHeader: chart.hasHeader,
    });
  }

  return (await pptx.write({ outputType: "blob" })) as Blob;
}
