// Builds a PowerPoint (.pptx) file from parsed table data using PptxGenJS.
// The chart is a native PowerPoint chart (fully editable after export), with
// the source table optionally reproduced on a second slide. Everything runs
// locally in the task pane; the caller downloads the returned Blob.
//
// This module is loaded lazily (dynamic import) so PptxGenJS stays out of the
// main task-pane bundle.

import pptxgen from "pptxgenjs";
import { ChartKind, TableChart, CHART_PALETTE } from "./tablechart";
import { layoutDiagramPages, DiagramLayout } from "./tablediagram";

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
  /**
   * When set, the main slide is a diagram drawn from NATIVE PowerPoint shapes
   * (rectangles/diamonds + connectors) with editable text — used for the
   * flowchart / block-diagram representations, so the labels stay editable.
   */
  diagramShapes?: { kind: "flowchart" | "hierarchy"; rows: string[][]; numerals: boolean; patent: boolean };
}

/** Inches available for a diagram on the main slide. */
interface DiagramArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Renders a DiagramLayout (the exact geometry shown in the task-pane preview)
 * as native, editable PowerPoint shapes — scaled from layout px into the slide
 * area, preserving every position, so the slide matches the preview.
 */
function addDiagramFromLayout(pptx: pptxgen, slide: pptxgen.Slide, layout: DiagramLayout, area: DiagramArea, patent: boolean): void {
  if (!layout.boxes.length) return;
  const boxFill = patent ? "FFFFFF" : "EAF2FB";
  const accentFill = patent ? "FFFFFF" : "FDF1DC";
  const lineColor = patent ? "000000" : "1F77B4";
  const edgeColor = patent ? "000000" : "555555";
  const ink = patent ? "000000" : "222222";

  // px → inches, uniformly scaled to fit the slide area. The upscale cap keeps
  // sparse pages (e.g. the last page of a paginated flowchart) from ballooning,
  // so consecutive slides stay visually consistent.
  const wIn = layout.W / 96;
  const hIn = layout.H / 96;
  const s = Math.min(area.w / wIn, area.h / hIn, 1.4);
  const ox = area.x + (area.w - wIn * s) / 2;
  const oy = area.y + (area.h - hIn * s) / 2;
  const X = (v: number): number => ox + (v / 96) * s;
  const Y = (v: number): number => oy + (v / 96) * s;
  const D = (v: number): number => (v / 96) * s;
  const F = (px: number): number => Math.max(6, Math.round(px * 0.75 * s * 10) / 10); // px → pt, scaled

  for (const b of layout.boxes) {
    const shape =
      b.kind === "diamond"
        ? pptx.ShapeType.diamond
        : b.kind === "round"
          ? pptx.ShapeType.roundRect
          : b.kind === "circle"
            ? pptx.ShapeType.ellipse
            : pptx.ShapeType.rect;
    slide.addText(b.lines.join("\n"), {
      shape,
      x: X(b.x),
      y: Y(b.y),
      w: D(b.w),
      h: D(b.h),
      fill: { color: b.accent ? accentFill : boxFill },
      line: { color: lineColor, width: Math.max(0.75, s) },
      align: "center",
      valign: "middle",
      fontSize: F(b.fontPx),
      color: ink,
      fit: "shrink",
      margin: 2,
    });
  }

  for (const l of layout.lines) {
    // pptxgen draws a line across its bounding box, top-left → bottom-right;
    // flip when the segment runs the other way.
    const x = Math.min(l.x1, l.x2);
    const y = Math.min(l.y1, l.y2);
    const w = Math.abs(l.x2 - l.x1);
    const h = Math.abs(l.y2 - l.y1);
    const backwardX = l.x2 < l.x1;
    const backwardY = l.y2 < l.y1;
    slide.addShape(pptx.ShapeType.line, {
      x: X(x),
      y: Y(y),
      w: D(w),
      h: D(h),
      flipH: backwardX !== backwardY ? true : undefined,
      line: {
        color: edgeColor,
        width: l.lead ? 0.75 : 1.25,
        ...(l.arrow ? { endArrowType: "triangle" as const } : {}),
      },
    });
  }

  for (const t of layout.texts) {
    const boxWpx = Math.max(30, t.text.length * t.fontPx * 0.62);
    const xPx = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - boxWpx : t.x - boxWpx / 2;
    slide.addText(t.text, {
      x: X(xPx),
      y: Y(t.y - t.fontPx), // SVG y is the baseline; the text frame starts above it
      w: D(boxWpx),
      h: D(t.fontPx * 1.6),
      align: t.anchor === "start" ? "left" : t.anchor === "end" ? "right" : "center",
      valign: "middle",
      fontSize: F(t.fontPx),
      bold: !!t.bold,
      color: ink,
      margin: 0,
    });
  }
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

  if (opts.diagramShapes) {
    // Native, editable diagram (flowchart / block diagram) as PowerPoint
    // shapes, laid out from the same geometry as the task-pane preview.
    // Long/wide diagrams paginate across slides (off-page connector circles
    // for flowcharts; the parent repeated per page for block diagrams) so
    // every slide stays near natural size.
    const { kind, rows, numerals, patent } = opts.diagramShapes;
    const { pages } = layoutDiagramPages(kind, rows, { numerals, patent });
    pages.forEach((page, i) => {
      const target = i === 0 ? slide : pptx.addSlide();
      let y = areaY;
      let h = areaH;
      if (i > 0) {
        if (title) {
          target.addText(`${title} (cont.)`, { x: 0.4, y: 0.2, w: 9.2, h: 0.5, fontSize: 16, bold: true, color: "222222" });
          y = 0.8;
          h = 4.4;
        } else {
          y = 0.4;
          h = 4.8;
        }
      }
      addDiagramFromLayout(pptx, target, page, { x: 0.4, y, w: 9.2, h }, patent);
    });
    return (await pptx.write({ outputType: "blob" })) as Blob;
  }

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
