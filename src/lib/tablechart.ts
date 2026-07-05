// Turns a Word table (Table.values → string[][]) into chart-ready data and a
// pure-SVG chart rendering (column / bar / line / area / pie / doughnut), for
// the "Table → Chart" mode. Number parsing is tolerant of the formatting
// commonly found in document tables: thousands separators, currency symbols,
// %, accountant-style (negative) parentheses, unit suffixes, and Unicode minus.
//
// Two rendering styles: the default color style (task-pane preview + PPT), and
// a black-&-white "patent figure" style (37 CFR 1.84-friendly line art) where
// series are distinguished by hatching, dash patterns, and marker shapes
// instead of color, with an optional "FIG. N" label beneath the chart.
//
// Pure logic — no Office.js, no PptxGenJS — fully unit-testable.

import { niceStep, fmtTick } from "./plot";

export type ChartKind = "column" | "bar" | "line" | "area" | "pie" | "doughnut";

export interface ChartStyle {
  /** Black-&-white patent-drawing rendering (hatching, dashed lines, markers). */
  patent?: boolean;
  /** Optional figure label (e.g. "FIG. 1") rendered beneath the chart. */
  figLabel?: string;
  /** Add patent-style reference numerals to figure elements (diagrams/table figure). */
  numerals?: boolean;
}

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
  // Accountant-style negative parentheses — but NOT a bare percentage like
  // "(75.0%)", which in patent/clinical tables means +75%, not −75.
  const paren = /^\((.+)\)$/.exec(s);
  if (paren && !paren[1].endsWith("%")) {
    negative = true;
    s = paren[1];
  } else if (paren) {
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
 * Cleans raw Table.values: strips control characters, pads ragged rows, and
 * drops fully empty rows/columns. Shared by the chart parser and the diagram
 * renderers (tablediagram.ts).
 */
export function cleanTableRows(values: string[][]): string[][] {
  let rows = values.map((r) => r.map(cleanCell));
  const width = Math.max(0, ...rows.map((r) => r.length));
  rows = rows
    .map((r) => (r.length < width ? r.concat(Array(width - r.length).fill("")) : r))
    .filter((r) => r.some((c) => c !== ""));
  const keepCols: number[] = [];
  for (let j = 0; j < width; j++) {
    if (rows.some((r) => r[j] !== "")) keepCols.push(j);
  }
  return rows.map((r) => keepCols.map((j) => r[j]));
}

/**
 * Interprets a table as chart data. Conventions: the first column holds the
 * category labels; the first row is treated as a header (series names) when it
 * is mostly non-numeric. Every other column becomes a series. Throws with a
 * user-facing message when no chart can be made.
 */
export function parseTableData(values: string[][]): TableChart {
  const rows = cleanTableRows(values);

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

  // Pick the label (category) column. Real tables often lead with a row-index
  // (1,2,3…) or a mostly-blank "section" grouping column; the useful labels sit
  // in the first *text* column that isn't one of those.
  const isTextCol = (j: number): boolean => {
    const nonEmpty = dataRows.filter((r) => r[j] !== "");
    if (!nonEmpty.length) return false;
    return nonEmpty.filter((r) => parseNumberCell(r[j]) === null).length / nonEmpty.length >= 0.5;
  };
  const isRowIndexCol = (j: number): boolean =>
    dataRows.every((r, i) => r[j].trim() === "" || parseNumberCell(r[j]) === i + 1 || parseNumberCell(r[j]) === i);
  const blankFraction = (j: number): number => dataRows.filter((r) => r[j] === "").length / Math.max(1, dataRows.length);

  let labelCol = 0;
  let sectionCol = -1; // a grouping column forward-filled into the labels
  const skipCols = new Set<number>(); // columns that are neither labels nor series
  if (cols >= 2 && isRowIndexCol(0) && isTextCol(1)) {
    // Leading numeric row-index column — use the text column for labels, and
    // drop the index entirely (it isn't a grouping or a data series).
    labelCol = 1;
    skipCols.add(0);
  } else if (cols >= 2 && blankFraction(0) >= 0.4 && isTextCol(1)) {
    // Leading mostly-blank "section" column — group the label column by it.
    labelCol = 1;
    sectionCol = 0;
  }
  let lastSection = "";
  const categories = dataRows.map((r, i) => {
    if (sectionCol >= 0 && r[sectionCol]) lastSection = r[sectionCol];
    const base = r[labelCol] || `Row ${i + 1}`;
    return sectionCol >= 0 && lastSection && r[labelCol] ? `${lastSection} — ${base}` : base;
  });
  if (labelCol === 1) {
    warnings.push(
      isRowIndexCol(0)
        ? `Used the “${headers[1] || "second"}” column for labels (the first column looks like a row index).`
        : `Grouped by the “${headers[0] || "first"}” column; labels come from “${headers[1] || "the second column"}”.`
    );
  }

  const series: ChartSeries[] = [];
  let skippedCells = 0;
  for (let j = 0; j < cols; j++) {
    if (j === labelCol || j === sectionCol || skipCols.has(j)) continue;
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
  if (categories.length > 24) {
    warnings.push(`${categories.length} rows — a chart will be dense; the “Table figure” view may read better.`);
  }

  return {
    categories,
    series,
    categoryLabel: hasHeader ? headers[labelCol] : "",
    hasHeader,
    rows,
    warnings,
  };
}

// --- SVG rendering -----------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Fills for the patent style: solid black, white, then hatch patterns. Series
 * beyond the list cycle. Bars/slices always get a black outline so white and
 * pattern fills read as closed shapes.
 */
const PATENT_FILLS = [
  "#000",
  "#fff",
  "url(#fi-diag)",
  "url(#fi-rdiag)",
  "url(#fi-cross)",
  "url(#fi-horiz)",
  "url(#fi-vert)",
  "url(#fi-dots)",
];

/** Dash patterns distinguishing line/area series in the patent style. */
const PATENT_DASHES = ["", "7 3", "2.5 2.5", "9 3 2.5 3", "12 4", "5 4 1.5 4"];

/** SVG <defs> with the hatch patterns used by PATENT_FILLS. */
function patentDefs(): string {
  const line = (rot: number): string =>
    `<pattern id="fi-${rot === 45 ? "diag" : "rdiag"}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(${rot})"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="1.1"/></pattern>`;
  return (
    "<defs>" +
    line(45) +
    line(-45) +
    `<pattern id="fi-cross" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="0.9"/><line x1="0" y1="0" x2="5" y2="0" stroke="#000" stroke-width="0.9"/></pattern>` +
    `<pattern id="fi-horiz" patternUnits="userSpaceOnUse" width="5" height="5"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="2.5" x2="5" y2="2.5" stroke="#000" stroke-width="1.1"/></pattern>` +
    `<pattern id="fi-vert" patternUnits="userSpaceOnUse" width="5" height="5"><rect width="5" height="5" fill="#fff"/><line x1="2.5" y1="0" x2="2.5" y2="5" stroke="#000" stroke-width="1.1"/></pattern>` +
    `<pattern id="fi-dots" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#fff"/><circle cx="3" cy="3" r="1.1" fill="#000"/></pattern>` +
    "</defs>"
  );
}

/** Marker shape for patent-style line/area series i, centered on (cx, cy). */
function markerSvg(i: number, cx: number, cy: number): string {
  const x = cx.toFixed(1);
  const y = cy.toFixed(1);
  const r = 3;
  switch (i % 6) {
    case 0:
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`;
    case 1:
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#000" stroke-width="1"/>`;
    case 2:
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="#000"/>`;
    case 3:
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="#fff" stroke="#000" stroke-width="1"/>`;
    case 4:
      return `<path d="M${x},${(cy - r - 0.5).toFixed(1)} L${(cx + r + 0.5).toFixed(1)},${(cy + r).toFixed(1)} L${(cx - r - 0.5).toFixed(1)},${(cy + r).toFixed(1)} Z" fill="#000"/>`;
    default:
      return `<path d="M${x},${(cy - r - 0.5).toFixed(1)} L${(cx + r + 0.5).toFixed(1)},${(cy + r).toFixed(1)} L${(cx - r - 0.5).toFixed(1)},${(cy + r).toFixed(1)} Z" fill="#fff" stroke="#000" stroke-width="1"/>`;
  }
}

/**
 * Renders the chart as SVG — the task-pane preview, the inserted Word figure,
 * and the patent-style PPT image all use this.
 */
export function buildChartPreviewSvg(chart: TableChart, kind: ChartKind, title = "", style: ChartStyle = {}): string {
  const W = 380;
  const figLabel = (style.figLabel ?? "").trim();
  const H = 260 + (figLabel ? 26 : 0);
  if (kind === "pie" || kind === "doughnut") return buildPieSvg(chart, kind, title, style, W, H);
  return buildAxisSvg(chart, kind, title, style, W, H);
}

function svgShell(W: number, H: number, style: ChartStyle, inner: string): string {
  const defs = style.patent ? patentDefs() : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}<rect width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`;
}

function titleText(title: string, W: number, ink: string): string {
  return title
    ? `<text x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="${ink}">${esc(truncate(title, 48))}</text>`
    : "";
}

/** Centered "FIG. N" label beneath the chart (patent-drawing convention). */
function figLabelText(figLabel: string, W: number, H: number): string {
  return figLabel
    ? `<text x="${W / 2}" y="${H - 9}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${esc(truncate(figLabel, 24))}</text>`
    : "";
}

/** Per-entry legend swatch: the small graphic left of the legend text. */
type SwatchFn = (i: number, x: number, cy: number) => string;

function colorSwatch(colors: string[]): SwatchFn {
  return (i, x, cy) => `<rect x="${x}" y="${cy - 7}" width="10" height="10" fill="${colors[i % colors.length]}"/>`;
}

function patentFillSwatch(): SwatchFn {
  return (i, x, cy) =>
    `<rect x="${x}" y="${cy - 7}" width="10" height="10" fill="${PATENT_FILLS[i % PATENT_FILLS.length]}" stroke="#000" stroke-width="0.8"/>`;
}

function patentLineSwatch(): SwatchFn {
  return (i, x, cy) => {
    const dash = PATENT_DASHES[i % PATENT_DASHES.length];
    return (
      `<line x1="${x}" y1="${cy - 2}" x2="${x + 14}" y2="${cy - 2}" stroke="#000" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
      markerSvg(i, x + 7, cy - 2)
    );
  };
}

function legend(names: string[], swatch: SwatchFn, x: number, y: number, maxRows: number, ink: string): string {
  const lh = 14;
  const parts: string[] = [];
  names.slice(0, maxRows).forEach((n, i) => {
    const cy = y + i * lh;
    parts.push(swatch(i, x, cy));
    parts.push(`<text x="${x + 18}" y="${cy + 2}" font-family="sans-serif" font-size="10" fill="${ink}">${esc(truncate(n, 15))}</text>`);
  });
  if (names.length > maxRows) {
    parts.push(`<text x="${x}" y="${y + maxRows * lh + 2}" font-family="sans-serif" font-size="10" fill="${ink}">+${names.length - maxRows} more</text>`);
  }
  return parts.join("");
}

function buildAxisSvg(chart: TableChart, kind: ChartKind, title: string, style: ChartStyle, W: number, H: number): string {
  const patent = !!style.patent;
  const ink = patent ? "#000" : "#333";
  const frame = patent ? "#000" : "#888";
  const figLabel = (style.figLabel ?? "").trim();
  const showLegend = chart.series.length > 1;
  const ml = 48;
  const mr = showLegend ? 100 : 14;
  const mt = title ? 26 : 12;
  const mb = 34 + (figLabel ? 26 : 0);
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const nums: number[] = [];
  for (const s of chart.series) for (const v of s.values) if (v !== null) nums.push(v);
  if (!nums.length) {
    return svgShell(
      W,
      H,
      style,
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

  const parts: string[] = [titleText(title, W, patent ? "#000" : "#222")];
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${frame}" stroke-width="1"/>`);

  // Value-axis ticks. The patent style keeps tick marks but drops the interior
  // gridlines — patent drawings want clean line art.
  const step = niceStep(vmax - vmin, horizontal ? 6 : 5);
  for (let t = Math.ceil(vmin / step) * step; t <= vmax + 1e-9; t += step) {
    if (horizontal) {
      const px = ml + vPos(t);
      if (!patent) {
        parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      } else if (t === 0 && vmin < 0) {
        parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#000" stroke-width="0.7"/>`);
      }
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="${frame}"/>`);
      parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + 15}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${ink}">${fmtTick(t)}</text>`);
    } else {
      const py = mt + ph - vPos(t);
      if (!patent) {
        parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      } else if (t === 0 && vmin < 0) {
        parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#000" stroke-width="0.7"/>`);
      }
      parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="${frame}"/>`);
      parts.push(`<text x="${ml - 6}" y="${(py + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${ink}">${fmtTick(t)}</text>`);
    }
  }

  // Category tick labels (thinned so they never overlap).
  const labelEvery = Math.ceil(n / (horizontal ? Math.floor(ph / 14) || 1 : 7));
  chart.categories.forEach((c, i) => {
    if (i % labelEvery) return;
    const label = esc(truncate(c, horizontal ? 7 : 9));
    if (horizontal) {
      const cy = mt + slot * (i + 0.5);
      parts.push(`<text x="${ml - 6}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${ink}">${label}</text>`);
    } else {
      const cx = ml + slot * (i + 0.5);
      parts.push(`<text x="${cx.toFixed(1)}" y="${mt + ph + 15}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${ink}">${label}</text>`);
    }
  });

  const zero = vPos(Math.max(vmin, Math.min(vmax, 0)));

  if (kind === "column" || kind === "bar") {
    const groupW = slot * 0.72;
    const barW = groupW / chart.series.length;
    chart.series.forEach((s, si) => {
      const fill = patent ? PATENT_FILLS[si % PATENT_FILLS.length] : CHART_PALETTE[si % CHART_PALETTE.length];
      const outline = patent ? ` stroke="#000" stroke-width="1"` : "";
      s.values.forEach((v, i) => {
        if (v === null) return;
        const c0 = slot * (i + 0.5) - groupW / 2 + si * barW;
        const a = Math.min(vPos(v), zero);
        const b = Math.max(vPos(v), zero);
        if (horizontal) {
          parts.push(`<rect x="${(ml + a).toFixed(1)}" y="${(mt + c0).toFixed(1)}" width="${(b - a).toFixed(1)}" height="${Math.max(1, barW - 1).toFixed(1)}" fill="${fill}"${outline}/>`);
        } else {
          parts.push(`<rect x="${(ml + c0).toFixed(1)}" y="${(mt + ph - b).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${(b - a).toFixed(1)}" fill="${fill}"${outline}/>`);
        }
      });
    });
  } else {
    // line / area (vertical orientation only — kind "bar" handled above).
    chart.series.forEach((s, si) => {
      const color = patent ? "#000" : CHART_PALETTE[si % CHART_PALETTE.length];
      const dash = patent ? PATENT_DASHES[si % PATENT_DASHES.length] : "";
      const coords: { x: number; y: number }[] = [];
      s.values.forEach((v, i) => {
        if (v !== null) coords.push({ x: ml + slot * (i + 0.5), y: mt + ph - vPos(v) });
      });
      if (!coords.length) return;
      const pts = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      if (kind === "area") {
        const y0 = (mt + ph - zero).toFixed(1);
        const fill = patent ? PATENT_FILLS[(si + 2) % PATENT_FILLS.length] : color;
        const opacity = patent ? "" : ` fill-opacity="0.25"`;
        parts.push(`<path d="M${coords[0].x.toFixed(1)},${y0} L${pts.join(" L")} L${coords[coords.length - 1].x.toFixed(1)},${y0} Z" fill="${fill}"${opacity} stroke="none"/>`);
      }
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
      // Patent lines need markers to stay distinguishable; the color style
      // only dots sparse series.
      if (patent || coords.length <= 30) {
        const every = Math.ceil(coords.length / 30);
        coords.forEach((p, i) => {
          if (i % every) return;
          parts.push(patent ? markerSvg(si, p.x, p.y) : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4" fill="${color}"/>`);
        });
      }
    });
  }

  if (showLegend) {
    const swatch = patent
      ? kind === "line"
        ? patentLineSwatch()
        : patentFillSwatch()
      : colorSwatch(CHART_PALETTE);
    parts.push(legend(chart.series.map((s) => s.name), swatch, W - mr + 8, mt + 10, Math.floor(ph / 14), ink));
  }
  parts.push(figLabelText(figLabel, W, H));
  return svgShell(W, H, style, parts.join(""));
}

function buildPieSvg(chart: TableChart, kind: ChartKind, title: string, style: ChartStyle, W: number, H: number): string {
  const patent = !!style.patent;
  const ink = patent ? "#000" : "#333";
  const figLabel = (style.figLabel ?? "").trim();
  const s = chart.series[0];
  const entries = chart.categories
    .map((c, i) => ({ label: c, value: s.values[i] ?? 0 }))
    .filter((e) => e.value > 0);
  if (!entries.length) {
    return svgShell(
      W,
      H,
      style,
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">A pie chart needs positive numbers</text>`
    );
  }
  const total = entries.reduce((acc, e) => acc + e.value, 0);
  const mt = title ? 26 : 12;
  const mb = 12 + (figLabel ? 26 : 0);
  const cx = 118;
  const cy = mt + (H - mt - mb) / 2;
  const R = Math.min(100, (H - mt - mb - 12) / 2);
  const r0 = kind === "doughnut" ? R * 0.55 : 0;
  const stroke = patent ? "#000" : "#fff";

  const parts: string[] = [titleText(title, W, patent ? "#000" : "#222")];
  let angle = -Math.PI / 2;
  entries.forEach((e, i) => {
    const sweep = (e.value / total) * Math.PI * 2;
    const a1 = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(angle);
    const y0 = cy + R * Math.sin(angle);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const fill = patent ? PATENT_FILLS[i % PATENT_FILLS.length] : CHART_PALETTE[i % CHART_PALETTE.length];
    if (entries.length === 1) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
    } else if (r0 > 0) {
      const xi0 = cx + r0 * Math.cos(a1);
      const yi0 = cy + r0 * Math.sin(a1);
      const xi1 = cx + r0 * Math.cos(angle);
      const yi1 = cy + r0 * Math.sin(angle);
      parts.push(
        `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi0.toFixed(1)},${yi0.toFixed(1)} A${r0},${r0} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`
      );
    } else {
      parts.push(
        `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`
      );
    }
    angle = a1;
  });
  if (r0 > 0 && entries.length === 1) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r0}" fill="#fff" stroke="${patent ? "#000" : "none"}"/>`);
  }
  const names = entries.map((e) => `${e.label} (${Math.round((e.value / total) * 1000) / 10}%)`);
  const swatch = patent ? patentFillSwatch() : colorSwatch(CHART_PALETTE);
  parts.push(legend(names, swatch, 236, mt + 14, Math.floor((H - mt - mb - 8) / 14), ink));
  if (chart.series.length > 1) {
    parts.push(`<text x="${W - 6}" y="${H - 6}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#999">first data column only</text>`);
  }
  parts.push(figLabelText(figLabel, W, H));
  return svgShell(W, H, style, parts.join(""));
}
