// Turns a Word table (Table.values → string[][]) into chart-ready data and a
// pure-SVG chart preview (column / bar / line / area / pie / doughnut), for the
// "Table → PPT" mode. Number parsing is tolerant of the formatting commonly
// found in document tables: thousands separators, currency symbols, %,
// accountant-style (negative) parentheses, unit suffixes, and Unicode minus.
//
// Pure logic — no Office.js, no PptxGenJS — fully unit-testable.

import { niceStep, fmtTick } from "./plot";

export type ChartKind = "column" | "bar" | "line" | "area" | "pie" | "doughnut";

export interface ChartSeries {
  name: string;
  /** One entry per category; null where the cell wasn't numeric. */
  values: (number | null)[];
}

export interface TableChart {
  /** Category (x-axis / slice) labels, from the table's first column. */
  categories: string[];
  series: ChartSeries[];
  /** Header of the first column (e.g. "Year") — used as the category-axis title. */
  categoryLabel: string;
  /** Whether the first row of `rows` is a header row. */
  hasHeader: boolean;
  /** The cleaned table text, for the source-table slide. */
  rows: string[][];
  warnings: string[];
}

export const CHART_PALETTE = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#8c564b", "#17becf", "#bcbd22"];

/**
 * Parses one table cell as a number. Handles "1,234.5", "$2,500", "45%",
 * "(1,200)" → −1200, "1.2e3", Unicode minus/dashes, and leading numbers with a
 * unit suffix ("12 kg" → 12). Returns null for anything that doesn't start
 * with a number.
 */
export function parseNumberCell(raw: string): number | null {
  let s = raw.replace(/\s+/g, "");
  if (!s) return null;
  let negative = false;
  const paren = /^\((.+)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  s = s.replace(/^[$€£¥]/, "").replace(/,/g, "").replace(/^[−–]/, "-");
  if (s.endsWith("%")) s = s.slice(0, -1);
  const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);
  if (!m) return null;
  const v = parseFloat(m[0]);
  if (!Number.isFinite(v)) return null;
  return negative ? -v : v;
}

/** Strips control characters Word can leave in cell text (\x07 cell marks, \r, \n) and trims. */
function cleanCell(raw: string): string {
  return raw
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Interprets a table as chart data. Conventions: the first column holds the
 * category labels; the first row is treated as a header (series names) when it
 * is mostly non-numeric. Every other column becomes a series. Throws with a
 * user-facing message when no chart can be made.
 */
export function parseTableData(values: string[][]): TableChart {
  // Clean cells, then drop fully empty rows and columns.
  let rows = values.map((r) => r.map(cleanCell));
  const width = Math.max(0, ...rows.map((r) => r.length));
  rows = rows
    .map((r) => (r.length < width ? r.concat(Array(width - r.length).fill("")) : r))
    .filter((r) => r.some((c) => c !== ""));
  const keepCols: number[] = [];
  for (let j = 0; j < width; j++) {
    if (rows.some((r) => r[j] !== "")) keepCols.push(j);
  }
  rows = rows.map((r) => keepCols.map((j) => r[j]));

  if (!rows.length || !rows[0].length) {
    throw new Error("The selected table is empty.");
  }

  const warnings: string[] = [];
  const cols = rows[0].length;

  // A lone row reads as one series across generated categories.
  if (rows.length === 1 && cols >= 2) {
    const first = rows[0][0];
    const firstIsLabel = parseNumberCell(first) === null;
    const cells = firstIsLabel ? rows[0].slice(1) : rows[0];
    const series = [{ name: firstIsLabel && first ? first : "Values", values: cells.map(parseNumberCell) }];
    if (!series[0].values.some((v) => v !== null)) {
      throw new Error("No numeric data found — the table needs at least one row or column of numbers.");
    }
    return {
      categories: cells.map((_, i) => String(i + 1)),
      series,
      categoryLabel: "",
      hasHeader: false,
      rows,
      warnings,
    };
  }

  // A lone column reads as one series down generated categories.
  if (cols === 1) {
    const headerish = parseNumberCell(rows[0][0]) === null && rows.length >= 2;
    const dataRows = headerish ? rows.slice(1) : rows;
    const series = [
      { name: headerish && rows[0][0] ? rows[0][0] : "Values", values: dataRows.map((r) => parseNumberCell(r[0])) },
    ];
    if (!series[0].values.some((v) => v !== null)) {
      throw new Error("No numeric data found — the table needs at least one row or column of numbers.");
    }
    return {
      categories: dataRows.map((_, i) => String(i + 1)),
      series,
      categoryLabel: "",
      hasHeader: headerish,
      rows,
      warnings,
    };
  }

  // General case: header row detection — mostly-text first row (past the
  // corner cell) means series names.
  const probe = rows[0].slice(1);
  const numericInRow0 = probe.filter((c) => c !== "" && parseNumberCell(c) !== null).length;
  const nonEmptyRow0 = probe.filter((c) => c !== "").length;
  const hasHeader = rows.length >= 2 && (nonEmptyRow0 === 0 || numericInRow0 / nonEmptyRow0 < 0.5);

  const headers = hasHeader ? rows[0] : rows[0].map(() => "");
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const categories = dataRows.map((r, i) => r[0] || `Row ${i + 1}`);

  const series: ChartSeries[] = [];
  let skippedCells = 0;
  for (let j = 1; j < cols; j++) {
    const name = headers[j] || `Series ${j}`;
    const vals = dataRows.map((r) => parseNumberCell(r[j]));
    const numeric = vals.filter((v) => v !== null).length;
    if (numeric === 0) {
      warnings.push(`Column “${name}” has no numbers — skipped.`);
      continue;
    }
    skippedCells += dataRows.filter((r, i) => r[j] !== "" && vals[i] === null).length;
    series.push({ name, values: vals });
  }

  if (!series.length) {
    throw new Error("No numeric data found — the table needs at least one column of numbers after the label column.");
  }
  if (skippedCells > 0) {
    warnings.push(
      `${skippedCells} cell${skippedCells === 1 ? "" : "s"} couldn't be read as a number and will be blank in the chart.`
    );
  }

  return {
    categories,
    series,
    categoryLabel: hasHeader ? headers[0] : "",
    hasHeader,
    rows,
    warnings,
  };
}

// --- SVG preview -------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Renders a preview of the chart that will be placed in the .pptx. */
export function buildChartPreviewSvg(chart: TableChart, kind: ChartKind, title = ""): string {
  const W = 380;
  const H = 260;
  if (kind === "pie" || kind === "doughnut") return buildPieSvg(chart, kind, title, W, H);
  return buildAxisSvg(chart, kind, title, W, H);
}

function svgShell(W: number, H: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`;
}

function titleText(title: string, W: number): string {
  return title
    ? `<text x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#222">${esc(truncate(title, 48))}</text>`
    : "";
}

function legend(names: string[], colors: string[], x: number, y: number, maxRows: number): string {
  const lh = 14;
  const parts: string[] = [];
  names.slice(0, maxRows).forEach((n, i) => {
    const cy = y + i * lh;
    parts.push(`<rect x="${x}" y="${cy - 7}" width="10" height="10" fill="${colors[i % colors.length]}"/>`);
    parts.push(`<text x="${x + 14}" y="${cy + 2}" font-family="sans-serif" font-size="10" fill="#333">${esc(truncate(n, 16))}</text>`);
  });
  if (names.length > maxRows) {
    parts.push(`<text x="${x}" y="${y + maxRows * lh + 2}" font-family="sans-serif" font-size="10" fill="#999">+${names.length - maxRows} more</text>`);
  }
  return parts.join("");
}

function buildAxisSvg(chart: TableChart, kind: ChartKind, title: string, W: number, H: number): string {
  const showLegend = chart.series.length > 1;
  const ml = 48;
  const mr = showLegend ? 96 : 14;
  const mt = title ? 26 : 12;
  const mb = 34;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const nums: number[] = [];
  for (const s of chart.series) for (const v of s.values) if (v !== null) nums.push(v);
  if (!nums.length) {
    return svgShell(
      W,
      H,
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No data to chart</text>`
    );
  }
  let vmin = Math.min(0, ...nums);
  let vmax = Math.max(0, ...nums);
  if (vmin === vmax) {
    vmin -= 1;
    vmax += 1;
  }
  const pad = (vmax - vmin) * 0.06;
  if (vmax > 0) vmax += pad;
  if (vmin < 0) vmin -= pad;

  const n = chart.categories.length;
  const horizontal = kind === "bar";
  // Value axis maps to y for column/line/area and to x for horizontal bars.
  const vLen = horizontal ? pw : ph;
  const cLen = horizontal ? ph : pw;
  const vPos = (v: number): number => ((v - vmin) / (vmax - vmin)) * vLen;
  const slot = cLen / n;

  const parts: string[] = [titleText(title, W)];
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="#888" stroke-width="1"/>`);

  // Value-axis gridlines + tick labels.
  const step = niceStep(vmax - vmin, horizontal ? 6 : 5);
  for (let t = Math.ceil(vmin / step) * step; t <= vmax + 1e-9; t += step) {
    if (horizontal) {
      const px = ml + vPos(t);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 14}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(t)}</text>`);
    } else {
      const py = mt + ph - vPos(t);
      parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      parts.push(`<text x="${ml - 6}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">${fmtTick(t)}</text>`);
    }
  }

  // Category tick labels (thinned so they never overlap).
  const labelEvery = Math.ceil(n / (horizontal ? Math.floor(ph / 14) || 1 : 7));
  chart.categories.forEach((c, i) => {
    if (i % labelEvery) return;
    const label = esc(truncate(c, horizontal ? 7 : 9));
    if (horizontal) {
      const cy = mt + slot * (i + 0.5);
      parts.push(`<text x="${ml - 6}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">${label}</text>`);
    } else {
      const cx = ml + slot * (i + 0.5);
      parts.push(`<text x="${cx.toFixed(1)}" y="${mt + ph + 14}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${label}</text>`);
    }
  });

  const zero = vPos(Math.max(vmin, Math.min(vmax, 0)));

  if (kind === "column" || kind === "bar") {
    const groupW = slot * 0.72;
    const barW = groupW / chart.series.length;
    chart.series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length];
      s.values.forEach((v, i) => {
        if (v === null) return;
        const c0 = slot * (i + 0.5) - groupW / 2 + si * barW;
        const a = Math.min(vPos(v), zero);
        const b = Math.max(vPos(v), zero);
        if (horizontal) {
          parts.push(`<rect x="${(ml + a).toFixed(1)}" y="${(mt + c0).toFixed(1)}" width="${(b - a).toFixed(1)}" height="${Math.max(1, barW - 1).toFixed(1)}" fill="${color}"/>`);
        } else {
          parts.push(`<rect x="${(ml + c0).toFixed(1)}" y="${(mt + ph - b).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${(b - a).toFixed(1)}" fill="${color}"/>`);
        }
      });
    });
  } else {
    // line / area (vertical orientation only — kind "bar" handled above).
    chart.series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length];
      const pts = s.values
        .map((v, i) => (v === null ? null : `${(ml + slot * (i + 0.5)).toFixed(1)},${(mt + ph - vPos(v)).toFixed(1)}`))
        .filter((p): p is string => p !== null);
      if (!pts.length) return;
      if (kind === "area") {
        const first = pts[0].split(",")[0];
        const last = pts[pts.length - 1].split(",")[0];
        const y0 = (mt + ph - zero).toFixed(1);
        parts.push(`<path d="M${first},${y0} L${pts.join(" L")} L${last},${y0} Z" fill="${color}" fill-opacity="0.25" stroke="none"/>`);
      }
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8"/>`);
      if (s.values.filter((v) => v !== null).length <= 30) {
        for (const p of pts) {
          const [px, py] = p.split(",");
          parts.push(`<circle cx="${px}" cy="${py}" r="2.4" fill="${color}"/>`);
        }
      }
    });
  }

  if (showLegend) {
    parts.push(legend(chart.series.map((s) => s.name), CHART_PALETTE, W - mr + 8, mt + 10, Math.floor(ph / 14)));
  }
  return svgShell(W, H, parts.join(""));
}

function buildPieSvg(chart: TableChart, kind: ChartKind, title: string, W: number, H: number): string {
  const s = chart.series[0];
  const entries = chart.categories
    .map((c, i) => ({ label: c, value: s.values[i] ?? 0 }))
    .filter((e) => e.value > 0);
  if (!entries.length) {
    return svgShell(
      W,
      H,
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">A pie chart needs positive numbers</text>`
    );
  }
  const total = entries.reduce((acc, e) => acc + e.value, 0);
  const mt = title ? 26 : 12;
  const cx = 118;
  const cy = mt + (H - mt - 12) / 2;
  const R = Math.min(100, (H - mt - 24) / 2);
  const r0 = kind === "doughnut" ? R * 0.55 : 0;

  const parts: string[] = [titleText(title, W)];
  let angle = -Math.PI / 2;
  entries.forEach((e, i) => {
    const sweep = (e.value / total) * Math.PI * 2;
    const a1 = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(angle);
    const y0 = cy + R * Math.sin(angle);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    if (entries.length === 1) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}"/>`);
    } else if (r0 > 0) {
      const xi0 = cx + r0 * Math.cos(a1);
      const yi0 = cy + r0 * Math.sin(a1);
      const xi1 = cx + r0 * Math.cos(angle);
      const yi1 = cy + r0 * Math.sin(angle);
      parts.push(
        `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi0.toFixed(1)},${yi0.toFixed(1)} A${r0},${r0} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z" fill="${color}" stroke="#fff" stroke-width="1"/>`
      );
    } else {
      parts.push(
        `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${color}" stroke="#fff" stroke-width="1"/>`
      );
    }
    angle = a1;
  });
  if (r0 > 0 && entries.length === 1) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r0}" fill="#fff"/>`);
  }
  const names = entries.map((e) => `${e.label} (${Math.round((e.value / total) * 1000) / 10}%)`);
  parts.push(legend(names, CHART_PALETTE, 236, mt + 14, Math.floor((H - mt - 20) / 14)));
  if (chart.series.length > 1) {
    parts.push(`<text x="${W - 6}" y="${H - 6}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#999">first data column only</text>`);
  }
  return svgShell(W, H, parts.join(""));
}
