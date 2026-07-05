// Renders a Word table as a clean *table figure* — the table itself drawn as an
// image, for patent specs where the correct figure is the table (characteristics
// tables, reference matrices), not a chart. Preserves section grouping: a
// group-header row (only the first cell filled) becomes a spanning band, and a
// leading "section" column with blank cells is vertically merged. Honors the
// patent (B&W line-art) style and the optional "FIG. N" label, matching
// tablechart.ts / tablediagram.ts.
//
// Pure logic — no Office.js — fully unit-testable.

import { ChartStyle, parseNumberCell } from "./tablechart";
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

  // Which columns are numeric — they get tighter widths and right alignment.
  const numericCol = Array.from({ length: ncols }, (_, j) => {
    const cells = grid.filter((_, i) => kinds[i] === "data").map((r) => r[j]).filter((c) => c !== "");
    return cells.length > 0 && cells.filter((c) => parseNumberCell(c) !== null).length / cells.length >= 0.6;
  });

  // Column widths from the widest cell in each column (bands span all columns,
  // so they don't drive column width). Numeric columns are capped tighter.
  const colW: number[] = [];
  for (let j = 0; j < ncols; j++) {
    let maxChars = 0;
    grid.forEach((r, i) => {
      if (kinds[i] === "band") return;
      for (const word of r[j].split(/\s+/)) maxChars = Math.max(maxChars, word.length);
      maxChars = Math.max(maxChars, Math.min(r[j].length, numericCol[j] ? 14 : 26));
    });
    const cap = numericCol[j] ? 96 : MAX_COL;
    colW.push(Math.max(MIN_COL, Math.min(cap, maxChars * CHAR_W + 2 * H_PAD)));
  }

  // Optional left margin holding free-standing reference numerals + lead lines
  // (patent callouts). The table body starts after the margin.
  const numerals = !!style.numerals;
  const numW = numerals ? 46 : 0;
  const totalW = numW + colW.reduce((a, b) => a + b, 0);
  const colX: number[] = [numW];
  for (let j = 0; j < ncols; j++) colX.push(colX[j] + colW[j]);

  // Wrap every cell and compute row heights.
  const bandW = totalW - numW;
  const maxCharsFor = (w: number): number => Math.max(4, Math.floor((w - 2 * H_PAD) / CHAR_W));
  const wrapped: string[][][] = grid.map((r, i) => {
    if (kinds[i] === "band") {
      const only = bandText[i] || (r.find((c) => c !== "") ?? "");
      return [wrapText(only, maxCharsFor(bandW), 2)];
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
  const headFill = patent ? "#fff" : "#e7eef6";
  const bandFill = patent ? "#efefef" : "#dbe6f2";
  const zebraFill = patent ? "#fff" : "#f6f9fc";
  const figLabel = (style.figLabel ?? "").trim();
  const bandsExist = kinds.some((k) => k === "band");

  // Reference numerals: sections number by hundreds; rows step by two within a
  // section (100 → 102, 104…). Flat tables number rows 102, 104, …
  const numeral: string[] = [];
  {
    let section = 0;
    let inSection = 0;
    let flat = 100;
    for (let i = 0; i < grid.length; i++) {
      if (kinds[i] === "header") {
        numeral.push("");
      } else if (kinds[i] === "band") {
        section += 100;
        inSection = 0;
        numeral.push(String(section));
      } else if (bandsExist) {
        if (section === 0) section = 100;
        inSection += 2;
        numeral.push(String(section + inSection));
      } else {
        flat += 2;
        numeral.push(String(flat));
      }
    }
  }

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

  const cellText = (lines: string[], cx: number, cyTop: number, h: number, anchor: "start" | "middle" | "end", bold: boolean): string => {
    const y0 = cyTop + h / 2 - ((lines.length - 1) * LINE_H) / 2 + 3.5;
    return lines
      .map(
        (ln, li) =>
          `<text x="${cx.toFixed(1)}" y="${(y0 + li * LINE_H).toFixed(1)}" text-anchor="${anchor}" font-family="sans-serif" font-size="9.5"${bold ? ' font-weight="bold"' : ""} fill="${ink}">${esc(ln)}</text>`
      )
      .join("");
  };

  let headerBottom = -1;
  let zebraToggle = 0;
  // Reference numerals are collected and drawn after the grid so the lead lines
  // sit on top; { text, y } per numbered row.
  const numeralHits: { text: string; cy: number }[] = [];
  grid.forEach((r, i) => {
    const y = top + rowY[i];
    const h = rowH[i];
    if (kinds[i] === "header") headerBottom = y + h;
    if (kinds[i] === "band") {
      parts.push(`<rect x="${numW}" y="${y.toFixed(1)}" width="${bandW.toFixed(1)}" height="${h.toFixed(1)}" fill="${bandFill}" stroke="${line}" stroke-width="1"/>`);
      parts.push(cellText(wrapped[i][0], numW + H_PAD + 2, y, h, "start", true));
      if (numerals && numeral[i]) numeralHits.push({ text: numeral[i], cy: y + h / 2 });
      zebraToggle = 0;
      return;
    }
    const isHeader = kinds[i] === "header";
    if (numerals && !isHeader && numeral[i]) numeralHits.push({ text: numeral[i], cy: y + h / 2 });
    const zebra = !isHeader && !sectionMerged && zebraFill !== "#fff" && zebraToggle % 2 === 1;
    if (!isHeader) zebraToggle++;
    for (let j = 0; j < ncols; j++) {
      if (j === 0 && contCol0[i]) continue; // absorbed into the span above
      const ch = j === 0 ? spanH[i] : h;
      const fill = isHeader ? headFill : zebra ? zebraFill : "#fff";
      parts.push(
        `<rect x="${colX[j].toFixed(1)}" y="${y.toFixed(1)}" width="${colW[j].toFixed(1)}" height="${ch.toFixed(1)}" fill="${fill}" stroke="${line}" stroke-width="1"/>`
      );
      const lines = wrapped[i][j];
      if (lines.length && lines[0]) {
        const rightAlign = numericCol[j] && !isHeader;
        const anchor = rightAlign ? "end" : "start";
        const tx = rightAlign ? colX[j + 1] - H_PAD : colX[j] + H_PAD;
        parts.push(cellText(lines, tx, y, ch, anchor, isHeader || (j === 0 && sectionMerged)));
      }
    }
  });

  // Heavier rule under the header row (table body only).
  if (headerBottom > 0) {
    parts.push(`<line x1="${numW}" y1="${headerBottom.toFixed(1)}" x2="${LW.toFixed(1)}" y2="${headerBottom.toFixed(1)}" stroke="${patent ? "#000" : "#8aa4c0"}" stroke-width="1.4"/>`);
  }
  // Outer border a touch heavier for a crisp figure edge (around the table body).
  parts.push(`<rect x="${(numW + 0.5).toFixed(1)}" y="${(top + 0.5).toFixed(1)}" width="${(bandW - 1).toFixed(1)}" height="${(tableH - 1).toFixed(1)}" fill="none" stroke="${patent ? "#000" : "#7f97b3"}" stroke-width="1.3"/>`);

  // Free-standing reference numerals in the left margin, each with a straight
  // lead line to the row's left edge. Two lanes stagger the numbers so they
  // don't line up in a rigid column (37 CFR 1.84(q)). Auto-placed — a starting
  // point the drafter can reposition.
  numeralHits.forEach((hit, k) => {
    const lane = k % 2;
    const numX = lane === 0 ? 5 : 21;
    const textW = hit.text.length * 5.6;
    parts.push(
      `<line class="fi-lead" x1="${(numX + textW + 2).toFixed(1)}" y1="${hit.cy.toFixed(1)}" x2="${numW.toFixed(1)}" y2="${hit.cy.toFixed(1)}" stroke="${patent ? "#000" : "#8aa4c0"}" stroke-width="0.9"/>` +
        `<text x="${numX}" y="${(hit.cy + 3.5).toFixed(1)}" text-anchor="start" font-family="sans-serif" font-size="10" fill="${ink}">${esc(hit.text)}</text>`
    );
  });

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
