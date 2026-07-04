// Renders a Word table as a clean *table figure* — the table itself drawn as an
// image, for patent specs where the correct figure is the table (characteristics
// tables, reference matrices), not a chart. Preserves section grouping: a
// group-header row (only the first cell filled) becomes a spanning band, and a
// leading "section" column with blank cells is vertically merged. Honors the
// patent (B&W line-art) style and the optional "FIG. N" label, matching
// tablechart.ts / tablediagram.ts.
//
// Pure logic — no Office.js — fully unit-testable.

import { ChartStyle } from "./tablechart";
import { wrapText } from "./tablediagram";

export interface TableFigureResult {
  svg: string;
  warnings: string[];
}

const CHAR_W = 5.4; // approx advance at font-size 9.5 sans-serif
const LINE_H = 12;
const V_PAD = 7;
const H_PAD = 6;
const MIN_COL = 44;
const MAX_COL = 156;
const MAX_ROWS = 40;
const MAX_LINES = 4;
const PANE_W = 380;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function looksNumeric(cell: string): boolean {
  return /\d/.test(cell) && /^[-+(]?[\d.,$€£¥%\s()]+[%)]?$/.test(cell.trim());
}

/** Row 0 is a header when it has at least two non-numeric cells (or is the only text). */
function detectHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const r0 = rows[0];
  const text = r0.filter((c) => c && !looksNumeric(c)).length;
  return text >= Math.min(2, r0.filter((c) => c).length);
}

type RowKind = "header" | "band" | "data";

/**
 * Renders the table as a figure. `rows` must be pre-cleaned
 * (tablechart.cleanTableRows).
 */
export function buildTableFigureSvg(rows: string[][], title = "", style: ChartStyle = {}): TableFigureResult {
  const warnings: string[] = [];
  if (!rows.length || !rows[0].length) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${PANE_W}" height="80"><rect width="${PANE_W}" height="80" fill="#fff"/><text x="${PANE_W / 2}" y="44" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">Empty table</text></svg>`,
      warnings,
    };
  }

  let body = rows;
  if (rows.length > MAX_ROWS) {
    warnings.push(`Only the first ${MAX_ROWS} of ${rows.length} rows are drawn.`);
    body = rows.slice(0, MAX_ROWS);
  }
  let ncols = Math.max(...body.map((r) => r.length));
  let grid = body.map((r) => (r.length < ncols ? r.concat(Array(ncols - r.length).fill("")) : r));

  let hasHeader = detectHeader(grid);
  let kinds: RowKind[] = grid.map((r, i) => {
    if (i === 0 && hasHeader) return "header";
    const filled = r.filter((c) => c !== "").length;
    return filled === 1 && ncols >= 2 ? "band" : "data";
  });

  // The band text (a section header on its own row) lives in that row's single
  // filled cell — capture it before any column is dropped.
  const bandText: string[] = grid.map((r, i) => (kinds[i] === "band" ? (r.find((c) => c !== "") ?? "") : ""));

  // Drop a leading "section" column that only ever carries the band text: with
  // the sections rendered as full-width bands, that column is empty in every
  // data row and would otherwise render as a dead column down the left edge.
  if (
    ncols >= 2 &&
    kinds.some((k) => k === "band") &&
    grid.every((r, i) => kinds[i] !== "data" || r[0] === "")
  ) {
    grid = grid.map((r) => r.slice(1));
    ncols -= 1;
    hasHeader = detectHeader(grid);
    kinds = grid.map((r, i) => {
      if (i === 0 && hasHeader) return "header";
      // A band row is now all-empty in the grid; it's still a band (bandText).
      if (bandText[i]) return "band";
      const filled = r.filter((c) => c !== "").length;
      return filled === 1 && ncols >= 2 ? "band" : "data";
    });
  }

  // Column widths from the widest cell in each column (bands span all columns,
  // so they don't drive column width).
  const colW: number[] = [];
  for (let j = 0; j < ncols; j++) {
    let maxChars = 0;
    grid.forEach((r, i) => {
      if (kinds[i] === "band") return;
      for (const word of r[j].split(/\s+/)) maxChars = Math.max(maxChars, word.length);
      maxChars = Math.max(maxChars, Math.min(r[j].length, 26));
    });
    colW.push(Math.max(MIN_COL, Math.min(MAX_COL, maxChars * CHAR_W + 2 * H_PAD)));
  }
  const totalW = colW.reduce((a, b) => a + b, 0);
  const colX: number[] = [0];
  for (let j = 0; j < ncols; j++) colX.push(colX[j] + colW[j]);

  // Wrap every cell and compute row heights.
  const maxCharsFor = (w: number): number => Math.max(4, Math.floor((w - 2 * H_PAD) / CHAR_W));
  const wrapped: string[][][] = grid.map((r, i) => {
    if (kinds[i] === "band") {
      const only = bandText[i] || (r.find((c) => c !== "") ?? "");
      return [wrapText(only, maxCharsFor(totalW), 2)];
    }
    return r.map((c, j) => (c ? wrapText(c, maxCharsFor(colW[j]), MAX_LINES) : [""]));
  });
  const rowH = wrapped.map((cells) => Math.max(...cells.map((lines) => lines.length)) * LINE_H + V_PAD);
  const rowY: number[] = [];
  {
    let acc = 0;
    for (let i = 0; i < grid.length; i++) {
      rowY.push(acc);
      acc += rowH[i];
    }
    rowY.push(acc);
  }

  // Vertical merge of the leading "section" column: a filled cell followed by
  // blank cells in consecutive data rows renders as one tall cell. Bands and
  // the header break a span. `topOfSpan[i]` gives the span height at its start;
  // continuation rows are marked to suppress their col-0 border + text.
  const contCol0: boolean[] = grid.map(() => false);
  const spanH: number[] = grid.map((_, i) => rowH[i]);
  let sectionMerged = false;
  if (ncols >= 2) {
    for (let i = 0; i < grid.length; i++) {
      if (kinds[i] !== "data" || grid[i][0] === "") continue;
      let k = i + 1;
      let h = rowH[i];
      while (k < grid.length && kinds[k] === "data" && grid[k][0] === "") {
        contCol0[k] = true;
        h += rowH[k];
        k++;
      }
      if (k > i + 1) sectionMerged = true;
      spanH[i] = h;
    }
  }

  const patent = !!style.patent;
  const ink = patent ? "#000" : "#222";
  const line = patent ? "#000" : "#c4c4c4";
  const headFill = patent ? "#fff" : "#eef3f8";
  const bandFill = patent ? "#f0f0f0" : "#dfe8f2";
  const figLabel = (style.figLabel ?? "").trim();

  const top = title ? 26 : 8;
  const tableH = rowY[grid.length];
  const LH = top + tableH + 8 + (figLabel ? 26 : 0);
  const LW = totalW;

  const parts: string[] = [];
  if (title) {
    parts.push(
      `<text x="${LW / 2}" y="17" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="${ink}">${esc(title.length > 60 ? title.slice(0, 59) + "…" : title)}</text>`
    );
  }

  const cellText = (lines: string[], cx: number, cyTop: number, h: number, anchor: "start" | "middle", bold: boolean): string => {
    const y0 = cyTop + h / 2 - ((lines.length - 1) * LINE_H) / 2 + 3.5;
    return lines
      .map(
        (ln, li) =>
          `<text x="${cx.toFixed(1)}" y="${(y0 + li * LINE_H).toFixed(1)}" text-anchor="${anchor}" font-family="sans-serif" font-size="9.5"${bold ? ' font-weight="bold"' : ""} fill="${ink}">${esc(ln)}</text>`
      )
      .join("");
  };

  grid.forEach((r, i) => {
    const y = top + rowY[i];
    const h = rowH[i];
    if (kinds[i] === "band") {
      parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${LW.toFixed(1)}" height="${h.toFixed(1)}" fill="${bandFill}" stroke="${line}" stroke-width="1"/>`);
      parts.push(cellText(wrapped[i][0], H_PAD + 2, y, h, "start", true));
      return;
    }
    for (let j = 0; j < ncols; j++) {
      if (j === 0 && contCol0[i]) continue; // absorbed into the span above
      const isHeader = kinds[i] === "header";
      const ch = j === 0 ? spanH[i] : h;
      const fill = isHeader ? headFill : "#fff";
      parts.push(
        `<rect x="${colX[j].toFixed(1)}" y="${y.toFixed(1)}" width="${colW[j].toFixed(1)}" height="${ch.toFixed(1)}" fill="${fill}" stroke="${line}" stroke-width="1"/>`
      );
      const lines = wrapped[i][j];
      if (lines.length && lines[0]) {
        parts.push(cellText(lines, colX[j] + H_PAD, y, ch, "start", isHeader || (j === 0 && sectionMerged)));
      }
    }
  });

  // Outer border a touch heavier for a crisp figure edge.
  parts.push(`<rect x="0.5" y="${(top + 0.5).toFixed(1)}" width="${(LW - 1).toFixed(1)}" height="${(tableH - 1).toFixed(1)}" fill="none" stroke="${patent ? "#000" : "#999"}" stroke-width="1.2"/>`);

  if (figLabel) {
    parts.push(`<text x="${LW / 2}" y="${(LH - 9).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${esc(figLabel)}</text>`);
  }

  if (totalW > 900) warnings.push("Wide table — text is scaled down to fit; consider splitting it.");

  const scale = LW > PANE_W ? PANE_W / LW : 1;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(LW * scale)}" height="${Math.round(LH * scale)}" viewBox="0 0 ${Math.round(LW)} ${Math.round(LH)}">` +
    `<rect width="${Math.round(LW)}" height="${Math.round(LH)}" fill="#fff"/>${parts.join("")}</svg>`;
  return { svg, warnings };
}
