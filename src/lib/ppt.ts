// Builds a PowerPoint (.pptx) file from parsed table data using PptxGenJS.
// The chart is a native PowerPoint chart (fully editable after export), with
// the source table optionally reproduced on a second slide. Everything runs
// locally in the task pane; the caller downloads the returned Blob.
//
// This module is loaded lazily (dynamic import) so PptxGenJS stays out of the
// main task-pane bundle.

import pptxgen from "pptxgenjs";
import { ChartKind, TableChart, CHART_PALETTE } from "./tablechart";
import { parseSteps, buildTree, numberTree, countLeaves, depthOf, TreeNode } from "./tablediagram";

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

/** Caps a label so a paragraph-long table cell can't drown a small shape. */
function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Draws a flowchart from native, editable PowerPoint shapes. */
function addFlowchartShapes(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  rows: string[][],
  area: DiagramArea,
  numerals: boolean,
  patent: boolean
): void {
  const { steps } = parseSteps(rows);
  if (!steps.length) return;
  const boxFill = patent ? "FFFFFF" : "EAF2FB";
  const decisionFill = patent ? "FFFFFF" : "FDF1DC";
  const lineColor = patent ? "000000" : "1F77B4";
  const edgeColor = patent ? "000000" : "555555";
  const ink = patent ? "000000" : "222222";

  const n = steps.length;
  const gap = 0.22;
  const boxW = Math.min(3.6, area.w * 0.55);
  const cx = area.x + area.w / 2;
  // Height per box from wrapped line estimate; scale to fit the area.
  const linesFor = (t: string): number => Math.max(1, Math.ceil(t.length / 34));
  const rawH = steps.map((s) => Math.max(0.5, linesFor(s.text) * 0.22 + 0.18));
  const totalRaw = rawH.reduce((a, b) => a + b, 0) + gap * (n - 1);
  const scale = totalRaw > area.h ? area.h / totalRaw : 1;
  const h = rawH.map((v) => v * scale);
  const g = gap * scale;

  let y = area.y;
  const centers: number[] = [];
  steps.forEach((s, i) => {
    const shape = s.decision ? pptx.ShapeType.diamond : s.terminator ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
    slide.addText(truncateLabel(s.text, 140), {
      shape,
      x: cx - boxW / 2,
      y,
      w: boxW,
      h: h[i],
      fill: { color: s.decision ? decisionFill : boxFill },
      line: { color: lineColor, width: 1 },
      align: "center",
      valign: "middle",
      fontSize: 11,
      color: ink,
      fit: "shrink", // PowerPoint shrinks the text to stay inside the shape
      margin: 3,
    });
    centers.push(y + h[i] / 2);
    // Reference numeral with a lead line, alternating sides.
    const refId = s.id || (numerals ? String(102 + i * 2) : "");
    if (refId) {
      const right = i % 2 === 0;
      const edgeX = cx + (right ? boxW / 2 : -boxW / 2);
      const numX = cx + (right ? boxW / 2 + 0.5 : -boxW / 2 - 0.5);
      slide.addShape(pptx.ShapeType.line, {
        x: Math.min(edgeX, numX),
        y: y + h[i] / 2,
        w: Math.abs(numX - edgeX),
        h: 0,
        line: { color: edgeColor, width: 0.75 },
      });
      slide.addText(refId, {
        x: right ? numX : numX - 0.5,
        y: y + h[i] / 2 - 0.15,
        w: 0.5,
        h: 0.3,
        align: right ? "left" : "right",
        fontSize: 10,
        color: ink,
      });
    }
    if (i < n - 1) {
      const arrowY = y + h[i];
      slide.addShape(pptx.ShapeType.line, {
        x: cx,
        y: arrowY,
        w: 0,
        h: g,
        line: { color: edgeColor, width: 1.25, endArrowType: "triangle" },
      });
    }
    y += h[i] + g;
  });
}

/** Draws a block-diagram hierarchy from native, editable PowerPoint shapes. */
function addHierarchyShapes(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  rows: string[][],
  area: DiagramArea,
  numerals: boolean,
  patent: boolean
): void {
  const { roots } = buildTree(rows);
  if (!roots.length) return;
  if (numerals) numberTree(roots);
  const leaves = Math.max(1, roots.reduce((acc, r) => acc + countLeaves(r), 0));
  const depth = Math.max(...roots.map(depthOf));

  const boxFill = patent ? "FFFFFF" : "EAF2FB";
  const rootFill = patent ? "FFFFFF" : "FDF1DC";
  const lineColor = patent ? "000000" : "1F77B4";
  const edgeColor = patent ? "000000" : "555555";
  const ink = patent ? "000000" : "222222";

  const slotW = area.w / leaves;
  const boxW = Math.min(slotW * 0.92, 2.6);
  const levelH = area.h / Math.max(1, depth);
  const boxH = Math.min(0.9, levelH * 0.55);

  let cursor = area.x;
  const layout = (node: TreeNode, level: number): number => {
    const y = area.y + level * levelH;
    let cx: number;
    if (!node.children.length) {
      cx = cursor + slotW / 2;
      cursor += slotW;
    } else {
      const centers = node.children.map((c) => layout(c, level + 1));
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      const busY = y + boxH + (levelH - boxH) / 2;
      slide.addShape(pptx.ShapeType.line, { x: cx, y: y + boxH, w: 0, h: busY - (y + boxH), line: { color: edgeColor, width: 1 } });
      if (centers.length > 1) {
        slide.addShape(pptx.ShapeType.line, { x: Math.min(...centers), y: busY, w: Math.abs(centers[centers.length - 1] - centers[0]), h: 0, line: { color: edgeColor, width: 1 } });
      }
      for (const ccx of centers) {
        slide.addShape(pptx.ShapeType.line, { x: ccx, y: busY, w: 0, h: y + levelH - busY, line: { color: edgeColor, width: 1 } });
      }
    }
    const label = node.num ? `${node.num} ${node.label}` : node.label;
    slide.addText(truncateLabel(label, 70), {
      shape: pptx.ShapeType.rect,
      x: cx - boxW / 2,
      y,
      w: boxW,
      h: boxH,
      fill: { color: level === 0 ? rootFill : boxFill },
      line: { color: lineColor, width: 1 },
      align: "center",
      valign: "middle",
      fontSize: 10,
      color: ink,
      fit: "shrink", // PowerPoint shrinks the text to stay inside the box
      margin: 2,
    });
    return cx;
  };
  roots.forEach((r) => layout(r, 0));
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
    // Native, editable diagram (flowchart / block diagram) as PowerPoint shapes.
    const area: DiagramArea = { x: 0.4, y: areaY, w: 9.2, h: areaH };
    const { kind, rows, numerals, patent } = opts.diagramShapes;
    if (kind === "flowchart") addFlowchartShapes(pptx, slide, rows, area, numerals, patent);
    else addHierarchyShapes(pptx, slide, rows, area, numerals, patent);
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
