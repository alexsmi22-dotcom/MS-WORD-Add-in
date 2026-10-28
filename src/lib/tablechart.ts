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

import { linearAxis, fmtValue, commaGroupLabel } from "./axis";
import { parseCellNumber, SCI_TAIL } from "./dataimport";
import { buildHeatmapSvg } from "./heatmap";
import { buildCandlestickSvg } from "./candlestick";
import { CATEGORICAL_PALETTE, seriesStyle, seriesMarkerSvg } from "./categoricalPalette";

export type ChartKind =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "scatter"
  | "stacked-column"
  | "stacked-bar"
  | "stacked-area"
  | "pie"
  | "doughnut"
  | "heatmap"
  | "candlestick";

export interface ChartStyle {
  /** Black-&-white patent-drawing rendering (hatching, dashed lines, markers). */
  patent?: boolean;
  /** Optional figure label (e.g. "FIG. 1") rendered beneath the chart. */
  figLabel?: string;
  /** Add patent-style reference numerals to figure elements (diagrams/table figure). */
  numerals?: boolean;
  /**
   * "okabe-ito": the validated colour-blind-safe categorical palette
   * (categoricalPalette.ts), with a marker shape and dash per series so the
   * series also separate in greyscale. Used under the journal figure styles.
   * Omitted: the long-standing default colours, byte-identical.
   */
  palette?: "okabe-ito";
  /**
   * "comma": value-axis labels group thousands with commas (1,500,000) instead of thin spaces, for a money axis whose
   * text and tables print commas (the damages figures). Omitted: unchanged.
   */
  grouping?: "comma";
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
  // Scientific notation as the app displays it ("3.3×10⁷", "2.5×10⁻⁷", "−4×10³", "3x10^-4") is read by the ONE
  // reader that knows it (dataimport.parseCellNumber: ×10ⁿ, true minus, superscripts) — this function used to read
  // only the mantissa, so 3.3×10⁷ charted as 3.3.
  if (SCI_TAIL.test(s)) {
    const v = parseCellNumber(s);
    return Number.isFinite(v) ? (negative ? -v : v) : null;
  }
  // Normalize a Unicode minus, then drop a currency symbol whether it comes
  // before or after the sign ("-$300", "$-300", "£300" all work).
  s = s.replace(/^[−–]/, "-").replace(/^([-+]?)[$€£¥]/, "$1");
  // THE DECIMAL-COMMA RULE, as dataimport.parseCellNumber applies it (fix2-paf):
  // every comma used to be stripped, so "3,5" charted as 35 and "0,5" as 5.
  // On the number at the start of the cell: "1,234.5" and "1.234,5" are grouped
  // (1234.5); "1,000" / "12,345,678" are grouping; "3,5" / "0,5" are a decimal
  // comma; any other comma shape is refused rather than guessed.
  {
    const head = /^([-+]?)([\d.,]+)/.exec(s);
    if (head && head[2].includes(",")) {
      const t = head[2];
      let norm: string | null;
      if (t.includes(".")) {
        if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) norm = t.replace(/\./g, "").replace(",", ".");
        else if (/^\d{1,3}(,\d{3})+\.\d*$/.test(t)) norm = t.replace(/,/g, "");
        else norm = null;
      } else if (/^\d{1,3}(,\d{3})+$/.test(t)) norm = t.replace(/,/g, "");
      else if (/^\d+,\d+$/.test(t)) norm = t.replace(",", ".");
      else norm = null;
      if (norm === null) return null;
      s = head[1] + norm + s.slice(head[0].length);
    }
  }
  if (s.endsWith("%")) s = s.slice(0, -1);
  const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);
  if (!m) return null;
  let v = parseFloat(m[0]);
  if (!Number.isFinite(v)) return null;
  // Magnitude suffix, but ONLY when it's the whole remainder — so "1.2K" → 1200
  // while a unit like "12kg" stays 12 (the "kg" is not a lone multiplier).
  const rest = s.slice(m[0].length);
  // A ×10ⁿ tail the reader above could not take ("3.3×10⁷kg", "2×10³×10²") is refused, never read as its mantissa.
  if (/^[×xX·]10(?:[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]|\^)/.test(rest)) return null;
  if (rest && MULTIPLIER[rest] !== undefined) v *= MULTIPLIER[rest];
  return negative ? -v : v;
}

// Standalone magnitude suffixes. Lowercase "m" is intentionally excluded
// (ambiguous with metres); million requires "M"/"MM"/"mn".
const MULTIPLIER: Record<string, number> = {
  k: 1e3, K: 1e3, M: 1e6, MM: 1e6, mn: 1e6, b: 1e9, B: 1e9, bn: 1e9, BN: 1e9,
};

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

  // AMBIGUOUS COMMAS ARE REFUSED (fix2-paf). A cell's comma rule alone reads a
  // table holding both "3,5" and "1,000" as 3.5 and 1000 — but beside decimal
  // commas, "1,000" may just as well be 1.000. When any cell uses a decimal
  // comma, cells shaped like grouping (1,000 / 12,345,678) are left blank and
  // counted in a warning rather than guessed.
  const squash = (c: string): string => c.replace(/\s+/g, "").replace(/^\(|\)$/g, "").replace(/^[-+−–]?[$€£¥]?/, "");
  const DECIMAL_COMMA = /^\d+,(?:\d{1,2}|\d{4,})(?![\d,.])/;
  const GROUPING = /^\d{1,3}(?:,\d{3})+(?![\d,.])/;
  const decimalCommaSeen = rows.some((r) => r.some((c) => DECIMAL_COMMA.test(squash(c))));
  let ambiguous = 0;
  const num = (c: string): number | null => {
    if (decimalCommaSeen && GROUPING.test(squash(c))) {
      ambiguous++;
      return null;
    }
    return parseNumberCell(c);
  };
  const ambiguityNote = (): void => {
    if (ambiguous) {
      warnings.push(
        `${ambiguous} cell${ambiguous === 1 ? " like" : "s like"} “1,000” ${ambiguous === 1 ? "is" : "are"} ambiguous beside decimal commas (“3,5”) and ${ambiguous === 1 ? "is" : "are"} left blank; write 1000 or 1,0 to say which.`,
      );
    }
  };

  // A lone row reads as one series across generated categories.
  if (rows.length === 1 && cols >= 2) {
    const first = rows[0][0];
    const firstIsLabel = parseNumberCell(first) === null;
    const cells = firstIsLabel ? rows[0].slice(1) : rows[0];
    const series = [{ name: firstIsLabel && first ? first : "Values", values: cells.map(num) }];
    ambiguityNote();
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
      { name: headerish && rows[0][0] ? rows[0][0] : "Values", values: dataRows.map((r) => num(r[0])) },
    ];
    ambiguityNote();
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
  // A HEADER OF YEARS (fix2-paf): "Region | 2021 | 2022 | 2023" is numeric past
  // the corner, so it was charted as a data row. A first row whose cells are
  // all distinct four-digit years (1800–2200) is a header when the body holds
  // numbers that are not years.
  const yearLike = (c: string): boolean => /^\d{4}$/.test(c.trim()) && +c >= 1800 && +c <= 2200;
  const yearCells = probe.filter((c) => c !== "");
  const yearHeader =
    rows.length >= 2 &&
    yearCells.length >= 2 &&
    yearCells.every(yearLike) &&
    new Set(yearCells.map((c) => c.trim())).size === yearCells.length &&
    parseNumberCell(rows[0][0]) === null &&
    rows.slice(1).some((r) => r.slice(1).some((c) => c !== "" && parseNumberCell(c) !== null && !yearLike(c)));
  const hasHeader = rows.length >= 2 && (nonEmptyRow0 === 0 || numericInRow0 / nonEmptyRow0 < 0.5 || yearHeader);

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
    const vals = dataRows.map((r) => num(r[j]));
    const numeric = vals.filter((v) => v !== null).length;
    if (numeric === 0) {
      warnings.push(`Column “${name}” has no numbers — skipped.`);
      continue;
    }
    skippedCells += dataRows.filter((r, i) => r[j] !== "" && vals[i] === null).length;
    series.push({ name, values: vals });
  }

  ambiguityNote();
  if (!series.length) {
    throw new Error("No numeric data found — the table needs at least one column of numbers after the label column.");
  }
  // The ambiguous-comma cells have their own warning above.
  const unreadable = skippedCells - ambiguous;
  if (unreadable > 0) {
    warnings.push(
      `${unreadable} cell${unreadable === 1 ? "" : "s"} couldn't be read as a number and will be blank in the chart.`
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

// ---- BEGIN Builder 2 (journal figures, brief D): patent style -> USPTO preset ----
// The patent style's fills (solid black, white, then hatch patterns; bars/slices
// get a black outline), dash patterns, hatch <defs> and series markers now live in
// figureStyle.ts as the USPTO preset's own drawing parts, extracted BY FUNCTION and
// byte-identical (pattern ids fi-diag ... unchanged). The local names are kept so
// no call site in this file changes.
import {
  USPTO_FILLS as PATENT_FILLS,
  USPTO_DASHES as PATENT_DASHES,
  usptoPatternDefs as patentDefs,
  usptoMarkerSvg as markerSvg,
} from "./figureStyle";
// ---- END Builder 2 ----

/**
 * Renders the chart as SVG — the task-pane preview, the inserted Word figure,
 * and the patent-style PPT image all use this.
 */
/**
 * A figure that SAYS why it is empty.
 *
 * A refusal rendered as a blank frame is indistinguishable from a bug, and the reader
 * has no way to act on it. The message goes into the picture so it survives being
 * inserted into the document.
 */
function errorSvg(message: string, W: number, H: number): string {
  const words = message.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  const perLine = Math.max(20, Math.floor((W - 40) / 6.2));
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ` ${w}`;
  }
  if (cur.trim()) lines.push(cur.trim());
  const esc2 = (t: string): string =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = lines
    .slice(0, 12)
    .map((t, i) => `<text x="20" y="${44 + i * 15}" font-family="Segoe UI, Arial, sans-serif" font-size="11" fill="#52514e">${esc2(t)}</text>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fcfcfb"/>` +
    `<text x="20" y="26" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="600" fill="#0b0b0b">This chart cannot be drawn</text>` +
    body +
    `</svg>`
  );
}

/**
 * A rendered chart AND anything the renderer needs the reader told.
 *
 * `warnings` USED TO BE THROWN AWAY. The candlestick and heat-map renderers both
 * compute notes about what they could not draw — "3 rows could not be drawn
 * because the high is not the largest of its four values", "7 cells are not
 * numeric and are left blank; they are NOT counted as zero", "the columns are not
 * named, so the first four were read positionally" — and this function returned
 * `r.svg`, dropping every one of them. Rows silently vanished from a chart the
 * user then inserted into a document.
 *
 * These are the RENDERER's notes only. `TableChart.warnings` (from parsing) is a
 * separate list the caller already has and must surface itself; returning it here
 * too would only get it printed twice.
 */
export interface ChartPreview {
  svg: string;
  warnings: string[];
  /** The figure is a refusal that explains itself (fix2-paf: a pie of negative values): shown, never inserted. */
  refused?: boolean;
}

/**
 * `width` is the canvas width in user units. It used to be fixed at 380, so a
 * journal or USPTO figure style could not fit the chart to a column: the only
 * knob that moves every text size together is the canvas width
 * (figureStyle.renderAtPreset). The height keeps the 380 × 260 aspect, so the
 * default (380) is byte-identical to before.
 */
export function buildChartPreviewSvg(chart: TableChart, kind: ChartKind, title = "", style: ChartStyle = {}, width = 380): ChartPreview {
  const W = Number.isFinite(width) && width >= 120 && width <= 4000 ? Math.round(width * 100) / 100 : 380;
  const figLabel = (style.figLabel ?? "").trim();
  const H = Math.round((260 * W) / 380) + (figLabel ? 26 : 0);
  if (kind === "candlestick") {
    // Four numeric columns per row, not one value per series, so it has its own
    // renderer and its own column identification.
    const r = buildCandlestickSvg(chart, title, { grey: style.patent === true }, W, H);
    if (r.error) {
      // A refusal must be VISIBLE in the figure, not swallowed into a blank frame.
      // The notes still travel: the refusal explains the frame, and the notes
      // explain what was already known about the data before it was refused.
      return { svg: errorSvg(r.error, W, H), warnings: r.notes };
    }
    return { svg: r.svg, warnings: r.notes };
  }
  if (kind === "heatmap") {
    // A heat map is neither an axis chart nor a pie: rows AND columns are both
    // categorical and the value is the fill, so it has its own renderer.
    const r = buildHeatmapSvg(chart, title, { grey: style.patent === true }, W, H);
    return { svg: r.svg, warnings: r.notes };
  }
  if (kind === "pie" || kind === "doughnut") {
    // A NEGATIVE SLICE IS REFUSED BY NAME (fix2-paf): it was filtered out with
    // nothing said, so the remaining slices' percentages silently changed
    // meaning. Zeros draw nothing and are said so.
    const s0 = chart.series[0];
    const fmt = fmtValue;
    const neg = chart.categories.map((c, i) => ({ c, v: s0?.values[i] })).filter((e) => e.v !== null && e.v !== undefined && e.v < 0);
    if (neg.length) {
      const named = neg.slice(0, 3).map((e) => `“${e.c}” (${fmt(e.v as number)})`).join(", ");
      return {
        svg: errorSvg(
          `A pie chart cannot show negative values: ${named}${neg.length > 3 ? ` and ${neg.length - 3} more` : ""}. ` +
            "A slice is a share of a whole; use a column or bar chart for data with negatives.",
          W,
          H,
        ),
        warnings: [],
        refused: true,
      };
    }
    const zeros = chart.categories.filter((_, i) => s0?.values[i] === 0);
    const warnings = zeros.length
      ? [`${zeros.length === 1 ? `“${zeros[0]}” is` : `${zeros.length} categories are`} zero and ${zeros.length === 1 ? "has" : "have"} no slice.`]
      : [];
    return { svg: buildPieSvg(chart, kind, title, style, W, H), warnings };
  }
  return { svg: buildAxisSvg(chart, kind, title, style, W, H), warnings: [] };
}

function svgShell(W: number, H: number, style: ChartStyle, inner: string): string {
  const defs = style.patent ? patentDefs() : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}<rect width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`;
}

// --- Patent-mode type sizes (v2.143.0) ---------------------------------------
// 37 CFR 1.84(p)(3): "Numbers, letters, and reference characters must measure at
// least .32 cm. (1/8 inch) in height." The patent style used 10 px text on a 380-unit
// canvas, which at the full 170 mm sight width is 3.202 mm of capital — 0.002 mm
// over the rule, and at Word's natural insert width (100 mm) only 1.9 mm. A
// LOWERCASE letter is shorter still: "Control" stood 2.3 mm. So the sizes are set
// per run, by what the run contains, with a 10 % margin at 170 mm (0.4474 mm/unit):
//   numerals and capitals  12 px: cap 0.7158 em -> 3.84 mm (+20 %)
//   any lowercase letter   17 px: x-height 0.5186 em -> 3.94 mm (+23 %)
// (Arial's measured OS/2 heights; figureStyle.ts X_HEIGHT_EM / CAP_HEIGHT_EM.)
// The user's own text is never re-cased: "mg" in capitals is a megagram.
const PATENT_CAPS_PX = 12;
const PATENT_LOWER_PX = 17;
const HAS_LOWER = /\p{Ll}/u;

/** Font size for a run of `text`: the colour style's own size, or the patent size for what it contains. */
function runPx(patent: boolean, text: string, base: number): number {
  if (!patent) return base;
  return HAS_LOWER.test(text) ? PATENT_LOWER_PX : PATENT_CAPS_PX;
}

/** Rough advance width of `text` at `px` (sans-serif), for thinning labels. */
function estW(text: string, px: number): number {
  return text.length * px * 0.62;
}

const SUPER_TO_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "−",
};

/**
 * The axis multiplier ("×10⁴"). In patent mode the exponent is drawn as full-size
 * digits raised on a <tspan>, not as Unicode superscript glyphs: those are drawn
 * smaller than the run's font-size, so a superscript "4" would be the one
 * character on the sheet under 3.2 mm.
 */
function multiplierText(mult: string, patent: boolean, x: number, y: number, anchor: string, ink: string): string {
  if (!patent) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="9" fill="${ink}">${esc(mult)}</text>`;
  }
  const m = /^(.*?10)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)$/.exec(mult);
  if (!m) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${PATENT_CAPS_PX}" fill="${ink}">${esc(mult)}</text>`;
  }
  const exp = [...m[2]].map((c) => SUPER_TO_ASCII[c] ?? c).join("");
  return (
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="sans-serif" font-size="${PATENT_CAPS_PX}" fill="${ink}">` +
    `${esc(m[1])}<tspan dy="-5">${esc(exp)}</tspan></text>`
  );
}

function titleText(title: string, W: number, ink: string, patent = false): string {
  if (!title) return "";
  const t = truncate(title, 48);
  // data-figure-title: figureStyle finds the title by this mark (USPTO: none in the artwork).
  return `<text data-figure-title="1" x="${W / 2}" y="16" text-anchor="middle" font-family="sans-serif" font-size="${runPx(patent, t, 13)}" font-weight="bold" fill="${ink}">${esc(t)}</text>`;
}

/** Centered "FIG. N" label beneath the chart (patent-drawing convention). */
function figLabelText(figLabel: string, W: number, H: number, patent = false): string {
  if (!figLabel) return "";
  const t = truncate(figLabel, 24);
  // "FIG. 1" stays 14; a lowercase "Fig. 1" in patent mode gets the lowercase size.
  const px = patent && HAS_LOWER.test(t) ? PATENT_LOWER_PX : 14;
  return `<text x="${W / 2}" y="${H - 9}" text-anchor="middle" font-family="sans-serif" font-size="${px}" fill="#000">${esc(t)}</text>`;
}

/** Per-entry legend swatch: the small graphic left of the legend text. */
type SwatchFn = (i: number, x: number, cy: number) => string;

function colorSwatch(colors: readonly string[]): SwatchFn {
  return (i, x, cy) => `<rect x="${x}" y="${cy - 7}" width="10" height="10" fill="${colors[i % colors.length]}"/>`;
}

/** Okabe-Ito line/scatter swatch: the series' dash and marker, so the legend matches the plot. */
function okabeLineSwatch(markersOnly: boolean): SwatchFn {
  return (i, x, cy) => {
    const s = seriesStyle(i);
    const line = markersOnly
      ? ""
      : `<line x1="${x}" y1="${cy - 2}" x2="${x + 14}" y2="${cy - 2}" stroke="${s.color}" stroke-width="1.8"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
    return line + seriesMarkerSvg(s, x + 7, cy - 2, 2.6);
  };
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

/** Legend row pitch: 14 units in the colour style; patent rows are taller (17 px lowercase). */
function legendPitch(patent: boolean): number {
  return patent ? 20 : 14;
}

/** Characters a legend name keeps before the ellipsis. */
function legendChars(patent: boolean): number {
  return patent ? 9 : 15;
}

function legend(names: string[], swatch: SwatchFn, x: number, y: number, maxRows: number, ink: string, patent = false, chars?: number): string {
  const lh = legendPitch(patent);
  const parts: string[] = [];
  names.slice(0, maxRows).forEach((n, i) => {
    const cy = y + i * lh;
    const t = truncate(n, chars ?? legendChars(patent));
    parts.push(swatch(i, x, cy));
    parts.push(`<text x="${x + 18}" y="${cy + 2}" font-family="sans-serif" font-size="${runPx(patent, t, 10)}" fill="${ink}">${esc(t)}</text>`);
  });
  if (names.length > maxRows) {
    const t = `+${names.length - maxRows} more`;
    parts.push(`<text x="${x}" y="${y + maxRows * lh + 2}" font-family="sans-serif" font-size="${runPx(patent, t, 10)}" fill="${ink}">${t}</text>`);
  }
  return parts.join("");
}

function buildAxisSvg(chart: TableChart, kind: ChartKind, title: string, style: ChartStyle, W: number, H: number): string {
  const patent = !!style.patent;
  const ink = patent ? "#000" : "#333";
  const frame = patent ? "#000" : "#888";
  const figLabel = (style.figLabel ?? "").trim();
  const showLegend = chart.series.length > 1;
  // Patent text is larger (see PATENT_CAPS_PX), so its margins are too.
  const ml = patent ? 62 : 48;
  const mr = showLegend ? (patent ? 132 : 100) : 14;
  let mt = title ? (patent ? 30 : 26) : 12;
  let mb = (patent ? 40 : 34) + (figLabel ? 26 : 0);
  const okabe = !patent && style.palette === "okabe-ito";
  const pal: readonly string[] = okabe ? CATEGORICAL_PALETTE : CHART_PALETTE;
  const pw = W - ml - mr;
  let ph = H - mt - mb;

  const stacked = kind === "stacked-column" || kind === "stacked-bar" || kind === "stacked-area";
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
  let vmin: number;
  let vmax: number;
  if (stacked) {
    // The value axis spans the per-category cumulative sums (positive stack up,
    // negative stack down), so the tallest stacked bar fits.
    let maxPos = 0;
    let minNeg = 0;
    for (let i = 0; i < chart.categories.length; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of chart.series) {
        const v = s.values[i];
        if (v === null) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      maxPos = Math.max(maxPos, pos);
      minNeg = Math.min(minNeg, neg);
    }
    vmin = minNeg;
    vmax = maxPos;
  } else {
    vmin = Math.min(0, ...nums);
    vmax = Math.max(0, ...nums);
  }
  if (vmin === vmax) {
    vmin -= 1;
    vmax += 1;
  }
  const pad = (vmax - vmin) * 0.06;
  if (vmax > 0) vmax += pad;
  if (vmin < 0) vmin -= pad;

  const n = chart.categories.length;
  const horizontal = kind === "bar" || kind === "stacked-bar";
  // Value-axis ticks and labels from the shared engine (axis.ts): extended
  // Wilkinson positions, decimals from the step and constant along the axis,
  // U+2212, thin-space grouping, and a ×10ⁿ multiplier instead of e-notation
  // (every Table→Chart kind used to print `5.0e+5`). Bounded there: at most
  // AXIS_TICK_CAP ticks on any input, femtosecond tables included.
  // Patent tick labels are 12 px, so a horizontal value axis asks for fewer.
  const valueAxis0 = linearAxis(vmin, vmax, { target: horizontal ? (patent ? 4 : 6) : 5 });
  // Comma grouping is for money and counts: a big axis prints in grouped fixed point ("12,500,000"), never with a
  // ×10⁷ multiplier on a money axis (2026-10-28). A small axis (×10⁻⁴) keeps its multiplier.
  // (Past a trillion the grouped figure is longer than the axis can hold, and the multiplier stays.)
  const bigMult = /^×10[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(valueAxis0.multiplier) && valueAxis0.values.every((v) => Math.abs(v) < 1e12);
  const fixedLabels = (): string[] => {
    const st = valueAxis0.step > 0 && Number.isFinite(valueAxis0.step) ? valueAxis0.step : 1;
    const dp = Math.max(0, Math.min(6, Math.ceil(-Math.log10(st) - 1e-9)));
    return valueAxis0.values.map((v) => {
      const s = (Math.abs(v) < st * 1e-6 ? 0 : v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
      return s.startsWith("-") ? "−" + s.slice(1) : s;
    });
  };
  const valueAxis =
    style.grouping === "comma"
      ? bigMult
        ? { ...valueAxis0, labels: fixedLabels(), multiplier: "" }
        : { ...valueAxis0, labels: valueAxis0.labels.map(commaGroupLabel) }
      : valueAxis0;
  // The multiplier is stated once, at the end of the value axis, in room made
  // for it INSIDE the fixed canvas (the canvas size is what Word inserts at).
  if (valueAxis.multiplier) {
    if (horizontal) mb += patent ? 16 : 11;
    else mt += patent ? 16 : 11;
    ph = H - mt - mb;
  }
  // PATENT CATEGORY LABELS ARE STAGGERED OR TURNED, NOT DROPPED (fix2-paf). At
  // USPTO lettering (12–17 px) a column or line chart of ordinary month names
  // kept only every other label. When the widest label does not fit its slot:
  // if it fits two slots, alternate labels drop to a second row; otherwise the
  // labels are set vertically (reading upward, each centred just below the
  // axis). Both in room taken from the plot height, so every category keeps its
  // name (up to 30 categories; beyond that, thinned as before).
  const catText = (c: string): string => truncate(c, horizontal ? 7 : 9);
  let catMode: "flat" | "stagger" | "vertical" = "flat";
  if (patent && !horizontal && n <= 30) {
    const widest = Math.max(...chart.categories.map((c) => estW(catText(c), runPx(true, catText(c), 10))));
    const slotEst = pw / n;
    if (widest + 6 > slotEst) {
      catMode = widest + 6 <= 2 * slotEst ? "stagger" : "vertical";
      mb += catMode === "stagger" ? 20 : Math.min(110, Math.ceil(widest)) - 10;
      ph = H - mt - mb;
    }
  }
  const rotateCats = catMode === "vertical";
  const tickDy = patent ? 18 : 15;
  // Value axis maps to y for column/line/area and to x for horizontal bars.
  const vLen = horizontal ? pw : ph;
  const cLen = horizontal ? ph : pw;
  const vPos = (v: number): number => ((v - vmin) / (vmax - vmin)) * vLen;
  const slot = cLen / n;

  const parts: string[] = [titleText(title, W, patent ? "#000" : "#222", patent)];
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${frame}" stroke-width="1"/>`);

  // Value-axis ticks. The patent style keeps tick marks but drops the interior
  // gridlines — patent drawings want clean line art.
  // BOUNDED: the row is a capped array from axis.ts. (This loop once had the
  // absolute `t <= vmax + 1e-9` form with no count cap, so a table of
  // femtosecond pulse widths produced 2,000,011 tick labels and a 510 MB SVG —
  // not an ugly chart, a frozen Word.)
  valueAxis.values.forEach((t, ti) => {
    const tickLabel = esc(valueAxis.labels[ti]);
    if (horizontal) {
      const px = ml + vPos(t);
      if (!patent) {
        parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      } else if (t === 0 && vmin < 0) {
        parts.push(`<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${mt + ph}" stroke="#000" stroke-width="0.7"/>`);
      }
      parts.push(`<line x1="${px.toFixed(1)}" y1="${mt + ph}" x2="${px.toFixed(1)}" y2="${mt + ph + 4}" stroke="${frame}"/>`);
      parts.push(`<text x="${px.toFixed(1)}" y="${mt + ph + tickDy}" text-anchor="middle" font-family="sans-serif" font-size="${runPx(patent, valueAxis.labels[ti], 10)}" fill="${ink}">${tickLabel}</text>`);
    } else {
      const py = mt + ph - vPos(t);
      if (!patent) {
        parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="${t === 0 ? "#bbb" : "#eee"}"/>`);
      } else if (t === 0 && vmin < 0) {
        parts.push(`<line x1="${ml}" y1="${py.toFixed(1)}" x2="${ml + pw}" y2="${py.toFixed(1)}" stroke="#000" stroke-width="0.7"/>`);
      }
      parts.push(`<line x1="${ml - 4}" y1="${py.toFixed(1)}" x2="${ml}" y2="${py.toFixed(1)}" stroke="${frame}"/>`);
      parts.push(`<text x="${ml - 6}" y="${(py + (patent ? 4 : 3)).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="${runPx(patent, valueAxis.labels[ti], 10)}" fill="${ink}">${tickLabel}</text>`);
    }
  });
  if (valueAxis.multiplier) {
    parts.push(
      horizontal
        ? multiplierText(valueAxis.multiplier, patent, ml + pw, mt + ph + (patent ? 34 : 27), "end", ink)
        : multiplierText(valueAxis.multiplier, patent, ml, mt - 4, "start", ink),
    );
  }

  // Category tick labels (thinned so they never overlap).
  let labelEvery = Math.ceil(n / (horizontal ? Math.floor(ph / 14) || 1 : 7));
  if (rotateCats) {
    // Vertical, the pitch a label needs along the axis is its glyph height.
    const fmax = Math.max(...chart.categories.map((c) => runPx(true, catText(c), 10)));
    labelEvery = Math.max(1, Math.ceil((fmax * 1.05) / Math.max(1e-9, slot)));
  } else if (catMode === "stagger") {
    labelEvery = 1;
  } else if (patent) {
    // Patent labels are 12-17 px, so thin by what they actually need: a row
    // pitch of 20 across, or the widest label's estimated width along.
    const need = horizontal ? 20 : Math.max(...chart.categories.map((c) => estW(catText(c), runPx(true, catText(c), 10)) + 6));
    labelEvery = Math.max(labelEvery, Math.ceil(need / Math.max(1e-9, slot)));
  }
  chart.categories.forEach((c, i) => {
    if (i % labelEvery) return;
    const raw = catText(c);
    const label = esc(raw);
    const fsz = runPx(patent, raw, 10);
    if (horizontal) {
      const cy = mt + slot * (i + 0.5);
      parts.push(`<text x="${ml - 6}" y="${(cy + (patent ? 4 : 3)).toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="${fsz}" fill="${ink}">${label}</text>`);
    } else if (rotateCats) {
      // Centred on its own half-length below the axis, so every label starts
      // just under the axis; x nudged so the glyphs centre on the slot.
      const cx = ml + slot * (i + 0.5) + fsz * 0.35;
      const cy = mt + ph + 8 + estW(raw, fsz) / 2;
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" transform="rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})" font-family="sans-serif" font-size="${fsz}" fill="${ink}">${label}</text>`,
      );
    } else {
      const cx = ml + slot * (i + 0.5);
      const dy = catMode === "stagger" && i % 2 === 1 ? 20 : 0;
      parts.push(`<text x="${cx.toFixed(1)}" y="${mt + ph + tickDy + dy}" text-anchor="middle" font-family="sans-serif" font-size="${fsz}" fill="${ink}">${label}</text>`);
    }
  });

  const zero = vPos(Math.max(vmin, Math.min(vmax, 0)));

  if (kind === "column" || kind === "bar" || kind === "stacked-column" || kind === "stacked-bar") {
    if (stacked) {
      // Segments stack from the zero line: positives up (or right), negatives down.
      const barW = slot * 0.72;
      const posOff = new Array<number>(n).fill(0);
      const negOff = new Array<number>(n).fill(0);
      chart.series.forEach((s, si) => {
        const fill = patent ? PATENT_FILLS[si % PATENT_FILLS.length] : pal[si % pal.length];
        const outline = patent ? ` stroke="#000" stroke-width="1"` : "";
        s.values.forEach((v, i) => {
          if (v === null || v === 0) return;
          let start: number;
          let end: number;
          if (v >= 0) {
            start = posOff[i];
            end = (posOff[i] += v);
          } else {
            end = negOff[i];
            start = (negOff[i] += v);
          }
          const lo = Math.min(vPos(start), vPos(end));
          const hi = Math.max(vPos(start), vPos(end));
          const c0 = slot * (i + 0.5) - barW / 2;
          if (horizontal) {
            parts.push(`<rect x="${(ml + lo).toFixed(1)}" y="${(mt + c0).toFixed(1)}" width="${Math.max(1, hi - lo).toFixed(1)}" height="${Math.max(1, barW - 1).toFixed(1)}" fill="${fill}"${outline}/>`);
          } else {
            parts.push(`<rect x="${(ml + c0).toFixed(1)}" y="${(mt + ph - hi).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${Math.max(1, hi - lo).toFixed(1)}" fill="${fill}"${outline}/>`);
          }
        });
      });
    } else {
      const groupW = slot * 0.72;
      const barW = groupW / chart.series.length;
      chart.series.forEach((s, si) => {
        const fill = patent ? PATENT_FILLS[si % PATENT_FILLS.length] : pal[si % pal.length];
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
    }
  } else if (kind === "stacked-area") {
    // Each series' band sits on the running cumulative (nulls treated as 0).
    const cum = new Array<number>(n).fill(0);
    chart.series.forEach((s, si) => {
      const color = patent ? "#000" : pal[si % pal.length];
      const fill = patent ? PATENT_FILLS[(si + 2) % PATENT_FILLS.length] : color;
      const opacity = patent ? "" : ` fill-opacity="0.35"`;
      const upper: string[] = [];
      const lower: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = ml + slot * (i + 0.5);
        const base = cum[i];
        const top = base + (s.values[i] ?? 0);
        lower.push(`${x.toFixed(1)},${(mt + ph - vPos(base)).toFixed(1)}`);
        upper.push(`${x.toFixed(1)},${(mt + ph - vPos(top)).toFixed(1)}`);
        cum[i] = top;
      }
      parts.push(`<path d="M${upper.join(" L")} L${lower.reverse().join(" L")} Z" fill="${fill}"${opacity} stroke="${color}" stroke-width="1"/>`);
    });
  } else {
    // line / area (vertical orientation only — kind "bar" handled above).
    chart.series.forEach((s, si) => {
      const color = patent ? "#000" : okabe ? seriesStyle(si).color : CHART_PALETTE[si % CHART_PALETTE.length];
      const dash = patent ? PATENT_DASHES[si % PATENT_DASHES.length] : okabe ? seriesStyle(si).dash : "";
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
      // Scatter shows markers only — no connecting line.
      if (kind !== "scatter") {
        parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
      }
      // Patent lines need markers to stay distinguishable; the color style dots
      // sparse series; scatter always dots every point.
      // The Okabe-Ito style marks every series with its own shape too, so the
      // series still separate in greyscale and for colour-blind readers.
      if (patent || okabe || kind === "scatter" || coords.length <= 30) {
        const every = kind === "scatter" ? 1 : Math.ceil(coords.length / 30);
        coords.forEach((p, i) => {
          if (i % every) return;
          parts.push(
            patent
              ? markerSvg(si, p.x, p.y)
              : okabe
                ? seriesMarkerSvg(seriesStyle(si), p.x, p.y, 2.6)
                : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4" fill="${color}"/>`,
          );
        });
      }
    });
  }

  if (showLegend) {
    // THE LEGEND DRAWS WHAT THE PLOT DRAWS (fix2-paf): a USPTO scatter's legend
    // showed hatched squares beside data drawn as ●○■□▲△, and an area chart's
    // swatches were two patterns off from its fills (PATENT_FILLS[si + 2]).
    const swatch = patent
      ? kind === "line"
        ? patentLineSwatch()
        : kind === "scatter"
          ? ((i: number, x: number, cy: number) => markerSvg(i, x + 7, cy - 3)) as SwatchFn
          : kind === "area"
            ? ((i: number, x: number, cy: number) =>
                `<rect x="${x}" y="${cy - 7}" width="10" height="10" fill="${PATENT_FILLS[(i + 2) % PATENT_FILLS.length]}" stroke="#000" stroke-width="0.8"/>`) as SwatchFn
            : patentFillSwatch()
      : okabe && (kind === "line" || kind === "scatter")
        ? okabeLineSwatch(kind === "scatter")
        : colorSwatch(pal);
    parts.push(legend(chart.series.map((s) => s.name), swatch, W - mr + 8, mt + 10, Math.floor(ph / legendPitch(patent)), ink, patent));
  }
  parts.push(figLabelText(figLabel, W, H, patent));
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
  // Positions scale with the canvas (k = 1 at the default 380, byte-identical).
  // Patent mode draws the pie smaller and the legend further left, because its
  // 17 px lowercase legend needs ~160 units for "Housing (40%)".
  const k = W / 380;
  const mt = title ? (patent ? 30 : 26) : 12;
  const mb = 12 + (figLabel ? 26 : 0);
  const cx = (patent ? 98 : 118) * k;
  const cy = mt + (H - mt - mb) / 2;
  const R = Math.min((patent ? 84 : 100) * k, (H - mt - mb - 12) / 2);
  const r0 = kind === "doughnut" ? R * 0.55 : 0;
  const stroke = patent ? "#000" : "#fff";
  const okabe = !patent && style.palette === "okabe-ito";
  const pal: readonly string[] = okabe ? CATEGORICAL_PALETTE : CHART_PALETTE;

  const parts: string[] = [titleText(title, W, patent ? "#000" : "#222", patent)];
  let angle = -Math.PI / 2;
  entries.forEach((e, i) => {
    const sweep = (e.value / total) * Math.PI * 2;
    const a1 = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(angle);
    const y0 = cy + R * Math.sin(angle);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const fill = patent ? PATENT_FILLS[i % PATENT_FILLS.length] : pal[i % pal.length];
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
  const swatch = patent ? patentFillSwatch() : colorSwatch(pal);
  parts.push(legend(names, swatch, (patent ? 196 : 236) * k, mt + 14, Math.floor((H - mt - mb - 8) / legendPitch(patent)), ink, patent, 15));
  if (chart.series.length > 1) {
    // Patent mode: black and full size — a grey 9 px note was the one mark on the
    // sheet that broke both 1.84(a)(1) and 1.84(p)(3).
    parts.push(
      patent
        ? `<text x="${W - 6}" y="${H - 6}" text-anchor="end" font-family="sans-serif" font-size="${PATENT_LOWER_PX}" fill="#000">first data column only</text>`
        : `<text x="${W - 6}" y="${H - 6}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#999">first data column only</text>`,
    );
  }
  parts.push(figLabelText(figLabel, W, H, patent));
  return svgShell(W, H, style, parts.join(""));
}
