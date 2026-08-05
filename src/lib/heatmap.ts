// Heat maps: a table of numbers rendered as a grid of shaded cells.
//
// The form is right when the data's job is "compare magnitude across two
// categorical axes at once" — a month × region matrix, a correlation matrix, an
// assay plate. It is the wrong form for a single series over time (that is a line)
// or for parts of a whole (that is a bar), and choosing it for those is the usual
// way a heat map ends up decorative.
//
// WHAT MAKES A HEAT MAP GO WRONG is almost always the colour, which is why the ramps
// live in chartPalette.ts with the validator output recorded beside them, and why
// they are ONE HUE for magnitude and TWO HUES ABOUT A NEUTRAL GREY for polarity. A
// rainbow ramp — the classic error — implies an ordering the eye cannot recover (is
// green more or less than yellow?) and manufactures boundaries the data does not
// have.
//
// Three things this renderer does that a screen chart would not have to:
//
//   1. It prints the NUMBER in each cell wherever it fits. Colour alone is a poor
//      readout of a specific value, these figures get printed and photocopied, and
//      the palette's light end is deliberately close to the paper — so the number is
//      the secondary encoding the colour rules require, not an ornament.
//   2. It always draws a colour bar with numeric ticks. A shaded grid with no scale
//      is unreadable no matter how good the ramp is.
//   3. It supports the black-and-white figure mode the rest of this product has,
//      because a greyscale lightness ramp IS a correct sequential encoding. What it
//      cannot do is show which side of a midpoint a diverging value falls on —
//      lightness has one dimension — and it says so rather than pretending.

import { TableChart } from "./tablechart";
import {
  INK,
  HeatScale,
  heatColour,
  inkOn,
  sampleRamp,
  SEQUENTIAL_BLUE,
  SEQUENTIAL_GREY,
  DIVERGING_MIDPOINT,
  DIVERGING_WARM,
  DIVERGING_COOL,
} from "./chartPalette";
import { fmtTick } from "./plot";

export interface HeatmapOptions {
  /** Sequential (magnitude) or diverging (polarity about a midpoint). */
  scale?: HeatScale;
  /** The midpoint for a diverging scale. Defaults to 0. */
  midpoint?: number;
  /** Black-and-white rendering for print. */
  grey?: boolean;
  /** Suppress the in-cell numbers even where they fit. */
  hideValues?: boolean;
}

export interface HeatmapResult {
  svg: string;
  /** Anything the reader needs told — an empty grid, a bad midpoint, missing cells. */
  notes: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Short numeric label for inside a cell — narrow, because the cell is narrow. */
function cellLabel(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace("e+", "e");
  if (Number.isInteger(v)) return String(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Renders `chart` as a heat map.
 *
 * Rows are the table's categories, columns are its series — which is the matrix the
 * table already is, so no reshaping and no assumption about orientation.
 */
export function buildHeatmapSvg(
  chart: TableChart,
  title: string,
  opts: HeatmapOptions = {},
  W = 620,
  H = 420,
): HeatmapResult {
  const notes: string[] = [];
  const scale: HeatScale = opts.scale ?? "sequential";
  const grey = opts.grey === true;
  const rows = chart.categories;
  const cols = chart.series;

  if (!rows.length || !cols.length) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`,
      notes: ["There is nothing to draw: the table has no numeric rows or columns."],
    };
  }

  // Range over every numeric cell. Non-numeric cells are NOT treated as zero —
  // that would invent data and shift the whole scale. They are drawn as blanks and
  // counted, so the reader is told how many there were.
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  let present = 0;
  for (const s of cols) {
    for (let r = 0; r < rows.length; r++) {
      const v = s.values[r];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        missing++;
        continue;
      }
      present++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (present === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`,
      notes: ["Every cell in this table is non-numeric, so there is no magnitude to shade."],
    };
  }
  if (missing > 0) {
    notes.push(
      missing === 1
        ? "One cell is not numeric and is left blank rather than shaded. It is NOT counted as " +
          "zero — doing that would move the colour scale and invent data that is not in the table."
        : `${missing} cells are not numeric and are left blank rather than shaded. They are NOT ` +
          "counted as zero — doing that would move the colour scale and invent data that is not " +
          "in the table.",
    );
  }

  const midpoint = opts.midpoint ?? 0;
  if (scale === "diverging") {
    if (min >= midpoint || max <= midpoint) {
      notes.push(
        `A diverging scale shows which side of ${fmtTick(midpoint)} each value falls on, but every ` +
          `value in this table is on the same side of it (range ${fmtTick(min)} to ${fmtTick(max)}). ` +
          "A sequential scale would show the same data with the full ramp instead of half of it.",
      );
    }
    if (grey) {
      notes.push(
        "In black and white a diverging scale can only show HOW FAR each value is from the " +
          "midpoint, not which side it is on — lightness has a single dimension. The numbers in " +
          "the cells carry the sign.",
      );
    }
  }

  // Layout. Row labels need real width or they truncate; column labels are rotated
  // when there are enough columns that horizontal ones would collide.
  const PAD = 10;
  const titleH = title ? 22 : 0;
  const legendH = 34;
  const longestRow = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const rowLabelW = Math.min(110, Math.max(38, longestRow * 6 + 8));
  const rotateCols = cols.length > 6;
  const colLabelH = rotateCols ? 54 : 20;

  const gridX = PAD + rowLabelW;
  const gridY = PAD + titleH + colLabelH;
  const gridW = W - gridX - PAD;
  const gridH = H - gridY - legendH - PAD;
  if (gridW <= 20 || gridH <= 20) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`,
      notes: ["The figure is too small to draw this many rows and columns legibly."],
    };
  }
  const cw = gridW / cols.length;
  const rh = gridH / rows.length;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${INK.surface}"/>`);
  if (title) {
    parts.push(
      `<text x="${PAD}" y="${PAD + 15}" font-family="Segoe UI, Arial, sans-serif" font-size="13" ` +
        `font-weight="600" fill="${INK.primary}">${esc(title)}</text>`,
    );
  }

  // Cells. A 1px surface-coloured gap between them is what makes the grid read as
  // cells rather than as a continuous field, and it is the same 2px-spacer idea the
  // rest of the chart code uses between adjacent fills.
  const showValues = opts.hideValues !== true && cw >= 34 && rh >= 15;
  for (let c = 0; c < cols.length; c++) {
    for (let r = 0; r < rows.length; r++) {
      const v = cols[c].values[r];
      const x = gridX + c * cw;
      const y = gridY + r * rh;
      if (v === null || v === undefined || !Number.isFinite(v)) {
        // A blank, marked with a hairline so it is visibly EMPTY rather than
        // ambiguously pale.
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cw - 1).toFixed(1)}" ` +
            `height="${(rh - 1).toFixed(1)}" fill="${INK.surface}" stroke="${INK.gridline}" stroke-width="1"/>`,
        );
        parts.push(
          `<line x1="${x.toFixed(1)}" y1="${(y + rh - 1).toFixed(1)}" x2="${(x + cw - 1).toFixed(1)}" ` +
            `y2="${y.toFixed(1)}" stroke="${INK.gridline}" stroke-width="1"/>`,
        );
        continue;
      }
      const fill = heatColour(v, min, max, scale, midpoint, grey);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cw - 1).toFixed(1)}" ` +
          `height="${(rh - 1).toFixed(1)}" fill="${fill}"/>`,
      );
      if (showValues) {
        parts.push(
          `<text x="${(x + cw / 2).toFixed(1)}" y="${(y + rh / 2 + 3.5).toFixed(1)}" ` +
            `text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="9.5" ` +
            `fill="${inkOn(fill)}">${esc(cellLabel(v))}</text>`,
        );
      }
    }
  }

  // Row labels.
  for (let r = 0; r < rows.length; r++) {
    const y = gridY + r * rh + rh / 2 + 3.5;
    if (rh < 11) continue; // would overlap; the axis title and legend still orient the reader
    parts.push(
      `<text x="${(gridX - 5).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${INK.secondary}">` +
        `${esc(rows[r].length > 18 ? `${rows[r].slice(0, 17)}…` : rows[r])}</text>`,
    );
  }

  // Column labels, rotated when there are many.
  for (let c = 0; c < cols.length; c++) {
    const cx = gridX + c * cw + cw / 2;
    const name = cols[c].name.length > 14 ? `${cols[c].name.slice(0, 13)}…` : cols[c].name;
    if (rotateCols) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(gridY - 6).toFixed(1)}" ` +
          `transform="rotate(-45 ${cx.toFixed(1)} ${(gridY - 6).toFixed(1)})" text-anchor="start" ` +
          `font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${INK.secondary}">${esc(name)}</text>`,
      );
    } else if (cw >= 26) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(gridY - 6).toFixed(1)}" text-anchor="middle" ` +
          `font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${INK.secondary}">${esc(name)}</text>`,
      );
    }
  }

  // The colour bar. A shaded grid without a scale cannot be read, so this is not
  // optional. Drawn as discrete swatches rather than a gradient: a gradient in an
  // inserted figure is one more thing that can fail to render, and swatches make the
  // step boundaries honest about the resolution the eye actually has.
  const barY = H - legendH + 6;
  const barH = 10;
  const barX = gridX;
  const barW = Math.max(80, Math.min(gridW, 240));
  const SWATCHES = 24;
  for (let i = 0; i < SWATCHES; i++) {
    const t = i / (SWATCHES - 1);
    let fill: string;
    if (scale === "diverging" && !grey) {
      fill = t < 0.5
        ? sampleRamp([DIVERGING_MIDPOINT, ...DIVERGING_COOL], (0.5 - t) * 2)
        : sampleRamp([DIVERGING_MIDPOINT, ...DIVERGING_WARM], (t - 0.5) * 2);
    } else {
      fill = sampleRamp(grey ? SEQUENTIAL_GREY : SEQUENTIAL_BLUE, t);
    }
    parts.push(
      `<rect x="${(barX + (i * barW) / SWATCHES).toFixed(1)}" y="${barY}" ` +
        `width="${(barW / SWATCHES + 0.6).toFixed(1)}" height="${barH}" fill="${fill}"/>`,
    );
  }
  parts.push(
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="none" ` +
      `stroke="${INK.baseline}" stroke-width="1"/>`,
  );

  // Ticks: the ends always, and the midpoint for a diverging scale because that is
  // the number the whole scale is about.
  const tickText = (x: number, label: string, anchor: string): string =>
    `<text x="${x.toFixed(1)}" y="${(barY + barH + 11).toFixed(1)}" text-anchor="${anchor}" ` +
    `font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="${INK.muted}">${esc(label)}</text>`;
  if (scale === "diverging") {
    const half = Math.max(Math.abs(max - midpoint), Math.abs(midpoint - min));
    parts.push(tickText(barX, fmtTick(midpoint - half), "start"));
    parts.push(tickText(barX + barW / 2, fmtTick(midpoint), "middle"));
    parts.push(tickText(barX + barW, fmtTick(midpoint + half), "end"));
  } else {
    parts.push(tickText(barX, fmtTick(min), "start"));
    parts.push(tickText(barX + barW, fmtTick(max), "end"));
  }
  parts.push(
    `<text x="${(barX + barW + 10).toFixed(1)}" y="${(barY + barH - 1).toFixed(1)}" ` +
      `font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="${INK.muted}">` +
      `${esc(scale === "diverging" ? `diverging about ${fmtTick(midpoint)}` : "low to high")}</text>`,
  );

  parts.push("</svg>");

  if (!showValues && opts.hideValues !== true) {
    notes.push(
      "The cells are too small to print their values in, so the colour is the only readout. The " +
        "colour bar below gives the scale; for exact figures keep the source table alongside the " +
        "figure, or use fewer rows and columns.",
    );
  }

  return { svg: parts.join(""), notes };
}
