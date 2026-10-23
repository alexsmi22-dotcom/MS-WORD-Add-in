// Drawings for the liquid-crystal retarder tools, generated from the SAME numbers the calculators print:
//   lcCellSvg      a cell cross-section: glass, ITO and alignment layers, rows of rod-like molecules whose tilt is
//                  the cell's uniform tilt or the computed θ(z), the tilt angle marked by an arc, the field E
//   lcDirectorSvg  director / index geometry: x, −y, z axes, the molecule at tilt θ, n∥ along it and n⊥ across it
//   lcDeviceSvg    the device along the beam in an oblique view: polariser P, each cell with its optic axis OA and
//                  the angle from x, analyser A
// Angles: tilt θ from the substrate plane (the plane of the glass); in-plane angles from x toward y. Literal hex
// colours and Arial; "bw" draws black on white with no fills (for patent drawings).
//
// Every arc is drawn from the angle it labels, and every molecule's rotate() IS its tilt, so a test can read the
// angle back out of the SVG (data-angle on each arc and molecule).

import { richText, type LcStyle } from "./lcCharts";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const txt = (x: number, y: number, t: string, o: { anchor?: string; size?: number; fill?: string; style?: string; weight?: string } = {}): string =>
  `<text x="${f(x)}" y="${f(y)}" font-family="${FONT}" font-size="${o.size ?? 12}" fill="${o.fill ?? "#111111"}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.style ? ` font-style="${o.style}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}>${richText(t, o.size ?? 12)}</text>`;
/** An angle for a label: whole degrees when within 0.05° of one, else 1 decimal; U+2212 minus. */
export function angleLabel(a: number): string {
  const r = Math.abs(a - Math.round(a)) < 0.05 ? String(Math.round(a)) : a.toFixed(1);
  return `${r.replace(/^-/, "−")}°`;
}
function arrowHead(x: number, y: number, ux: number, uy: number, size: number, colour: string): string {
  // a filled triangle with its tip at (x, y) pointing along (ux, uy)
  const px = -uy;
  const py = ux;
  const bx = x - ux * size;
  const by = y - uy * size;
  return `<path d="M${f(x)} ${f(y)} L${f(bx + px * size * 0.42)} ${f(by + py * size * 0.42)} L${f(bx - px * size * 0.42)} ${f(by - py * size * 0.42)} Z" fill="${colour}" stroke="none"/>`;
}

// ------------------------------------------------------------- cell cross-section

export interface CellDrawing {
  /** tilt (degrees from the substrate plane) of each column of molecules across the gap, left to right */
  tiltsDeg: number[];
  /** a uniform cell: draws 7 columns at this tilt and marks θ on the first molecule */
  uniformTiltDeg: number | null;
  pretiltDeg?: number;
  /** rms volts; draws the field arrow E when above 0 */
  voltage?: number;
  title: string;
  style: LcStyle;
}

export function lcCellSvg(o: CellDrawing): string {
  const bw = o.style === "bw";
  const W = 440;
  const top = 58;
  const bot = 258;
  const glassW = 34;
  const L0 = 28;
  const R1 = W - 28;
  const ito = 4;
  const align = 4;
  const gapL = L0 + glassW + ito + align;
  const gapR = R1 - glassW - ito - align;
  const hasField = (o.voltage ?? 0) > 0;
  const H = hasField ? 352 : 304;
  const glassFill = bw ? "#ffffff" : "#e0f2fe";
  const glassStroke = bw ? "#000000" : "#7dd3fc";
  const itoFill = bw ? "#000000" : "#b91c1c";
  const alFill = bw ? "#bdbdbd" : "#f59e0b";
  const molFill = bw ? "#ffffff" : "#3b82f6";
  const molStroke = bw ? "#000000" : "#1e40af";
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // substrates: glass, ITO, alignment (left mirrored on the right)
  p.push(`<rect x="${L0}" y="${top}" width="${glassW}" height="${bot - top}" fill="${glassFill}" stroke="${glassStroke}" stroke-width="1"/>`);
  p.push(`<rect x="${R1 - glassW}" y="${top}" width="${glassW}" height="${bot - top}" fill="${glassFill}" stroke="${glassStroke}" stroke-width="1"/>`);
  p.push(`<rect x="${L0 + glassW}" y="${top}" width="${ito}" height="${bot - top}" fill="${itoFill}"/>`);
  p.push(`<rect x="${R1 - glassW - ito}" y="${top}" width="${ito}" height="${bot - top}" fill="${itoFill}"/>`);
  p.push(`<rect x="${L0 + glassW + ito}" y="${top}" width="${align}" height="${bot - top}" fill="${alFill}"${bw ? ` stroke="#000000" stroke-width="0.5"` : ""}/>`);
  p.push(`<rect x="${R1 - glassW - ito - align}" y="${top}" width="${align}" height="${bot - top}" fill="${alFill}"${bw ? ` stroke="#000000" stroke-width="0.5"` : ""}/>`);
  // labels with leaders (above the right substrate, like a journal figure)
  const itoX = R1 - glassW - ito / 2;
  const alX = R1 - glassW - ito - align / 2;
  p.push(txt(itoX + 6, 22, "ITO", { size: 12, anchor: "start", style: "italic" }));
  p.push(`<path d="M${f(itoX + 4)} 27 L${f(itoX)} ${top - 2}" fill="none" stroke="#111111" stroke-width="1"/>`);
  p.push(arrowHead(itoX, top - 1, -4 / Math.hypot(4, top - 29), (top - 29) / Math.hypot(4, top - 29), 6, "#111111"));
  p.push(txt(alX - 30, 38, "Alignment layer", { size: 12, anchor: "end", style: "italic" }));
  p.push(`<path d="M${f(alX - 28)} 36 L${f(alX - 2)} ${top - 2}" fill="none" stroke="#111111" stroke-width="1"/>`);
  p.push(arrowHead(alX - 1, top - 1, 26 / Math.hypot(26, top - 37), (top - 37) / Math.hypot(26, top - 37), 6, "#111111"));
  p.push(txt(L0 + glassW / 2, bot + 16, "Glass", { size: 11, anchor: "middle" }));

  // molecules
  const tilts = o.uniformTiltDeg !== null ? Array(7).fill(o.uniformTiltDeg) : o.tiltsDeg;
  const nCol = Math.max(1, tilts.length);
  const span = gapR - gapL;
  const dx = span / nCol;
  const nRow = 5;
  const dy = (bot - top) / nRow;
  const ry = Math.min(17, dx * 0.46, dy * 0.4);
  const rx = ry * 0.36;
  const molAt = (cx: number, cy: number, t: number): string =>
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f(t)} ${f(cx)} ${f(cy)})" data-angle="${f(t)}" fill="${molFill}" stroke="${molStroke}" stroke-width="${bw ? 1 : 0.8}"${bw ? "" : ` fill-opacity="0.9"`}/>`;
  // a staggered lattice: odd columns sit half a row lower and carry one molecule fewer, so no two molecules touch
  for (let c = 0; c < nCol; c++) {
    const cx = gapL + dx * (c + 0.5);
    const odd = c % 2 === 1;
    for (let rI = 0; rI < (odd ? nRow - 1 : nRow); rI++) {
      const cy = top + dy * (rI + (odd ? 1 : 0.5));
      p.push(molAt(cx, cy, tilts[c]));
    }
  }
  // the angle arc: on the bottom molecule of the first column for a uniform cell, the middle column otherwise
  const col = o.uniformTiltDeg !== null ? 0 : Math.floor(nCol / 2);
  const t = tilts[col];
  const acx = gapL + dx * (col + 0.5);
  const acy = top + dy * (nRow - 0.5);
  const ar = ry + 7;
  const sweep = (t * Math.PI) / 180;
  // reference: the substrate direction (vertical) through the molecule, dashed
  const refCol = bw ? "#000000" : "#111111";
  p.push(`<path d="M${f(acx)} ${f(acy - ar - 6)} L${f(acx)} ${f(acy + ar * 0.2)}" fill="none" stroke="${refCol}" stroke-width="0.9" stroke-dasharray="3 2"/>`);
  if (t > 0.05) {
    const ex = acx + ar * Math.sin(sweep);
    const ey = acy - ar * Math.cos(sweep);
    p.push(
      `<path d="M${f(acx)} ${f(acy - ar)} A${f(ar)} ${f(ar)} 0 0 1 ${f(ex)} ${f(ey)}" fill="none" stroke="${refCol}" stroke-width="1.2" data-angle="${f(t)}" data-cx="${f(acx)}" data-cy="${f(acy)}"/>`,
    );
  }
  const lab = o.uniformTiltDeg !== null ? `θ = ${angleLabel(t)}` : `θₘ = ${angleLabel(t)}`;
  // below the cell, under the marked molecule (the gap between molecules is too narrow for a label)
  p.push(txt(acx, bot + 18, lab, { size: 12, anchor: col === 0 ? "start" : "middle" }));

  if (hasField) {
    const yA = bot + 46;
    p.push(`<path d="M${f(gapL + 18)} ${yA} L${f(gapR - 24)} ${yA}" fill="none" stroke="#111111" stroke-width="1.4"/>`);
    p.push(arrowHead(gapR - 16, yA, 1, 0, 9, "#111111"));
    p.push(txt((gapL + gapR) / 2, yA + 18, `E   (V = ${trimNum(o.voltage as number)} V rms)`, { size: 12, anchor: "middle" }));
  }
  p.push(txt(W / 2, H - 8, o.title, { size: 12, anchor: "middle", weight: "bold" }));
  p.push(`</svg>`);
  return p.join("");
}

function trimNum(x: number): string {
  return String(Number(x.toPrecision(4))).replace(/^-/, "−");
}

// ------------------------------------------------------------- director geometry

export function lcDirectorSvg(o: { tiltDeg: number; style: LcStyle }): string {
  const bw = o.style === "bw";
  const W = 380;
  const H = 340;
  const ox = 150;
  const oy = 120;
  const ink = "#111111";
  const dashCol = bw ? "#000000" : "#b91c1c";
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  const axis = (x2: number, y2: number, label: string, lx: number, ly: number, anchor = "middle"): void => {
    const L = Math.hypot(x2 - ox, y2 - oy);
    const ux = (x2 - ox) / L;
    const uy = (y2 - oy) / L;
    p.push(`<path d="M${ox} ${oy} L${f(x2 - ux * 8)} ${f(y2 - uy * 8)}" fill="none" stroke="${ink}" stroke-width="1.6"/>`);
    p.push(arrowHead(x2, y2, ux, uy, 10, ink));
    p.push(txt(lx, ly, label, { size: 15, anchor, weight: "bold" }));
  };
  axis(ox, 24, "x", ox + 12, 32, "start");
  axis(345, oy, "z", 352, oy + 5, "start");
  axis(62, 66, "−y", 52, 62, "end");
  // the −x half of the substrate-plane axis, plain
  p.push(`<path d="M${ox} ${oy} L${ox} ${H - 30}" fill="none" stroke="${ink}" stroke-width="1.6"/>`);

  // the molecule: long axis at θ from the substrate plane (the x axis here), leaning toward +z
  const th = (o.tiltDeg * Math.PI) / 180;
  const ux = Math.sin(th);
  const uy = Math.cos(th); // downward along −x for θ = 0
  const Lm = 130;
  const cx = ox + (ux * Lm) / 2;
  const cy = oy + (uy * Lm) / 2;
  const rot = -o.tiltDeg; // ellipse drawn with its long axis vertical, rotated so that it leans toward +z
  p.push(
    `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="22" ry="${Lm / 2}" transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})" data-angle="${f(o.tiltDeg)}" fill="${bw ? "#ffffff" : "#3b82f6"}"${bw ? "" : ` fill-opacity="0.85"`} stroke="${bw ? "#000000" : "#1e40af"}" stroke-width="1"/>`,
  );
  // n∥ along the director (dash-dot), past the end of the molecule
  const e1x = ox + ux * (Lm + 30);
  const e1y = oy + uy * (Lm + 30);
  p.push(`<path d="M${ox} ${oy} L${f(e1x - ux * 8)} ${f(e1y - uy * 8)}" fill="none" stroke="${dashCol}" stroke-width="1.4" stroke-dasharray="7 3 2 3"/>`);
  p.push(arrowHead(e1x, e1y, ux, uy, 9, dashCol));
  // beside the arrow tip, on the side away from the axes: toward +z for a low tilt, toward −x for a high one
  const [nx, ny] = o.tiltDeg <= 45 ? [uy, -ux] : [-uy, ux];
  p.push(txt(e1x + nx * 14, e1y + ny * 14 + 5, "n∥", { size: 15, weight: "bold", anchor: nx < -0.3 ? "end" : nx > 0.3 ? "start" : "middle" }));
  // n⊥ across it, from the origin, always into the empty x–z quadrant (up and toward +z), so it never meets the θ
  // label (left of the −x axis) or n∥ (below). At θ = 0 it lies on +z and at θ = 90° on +x: its label is then offset
  // off the axis line, clear of the axis's own label.
  const px = uy;
  const py = -ux;
  const Lp = 70;
  const e2x = ox + px * Lp;
  const e2y = oy + py * Lp;
  p.push(`<path d="M${ox} ${oy} L${f(e2x - px * 8)} ${f(e2y - py * 8)}" fill="none" stroke="${dashCol}" stroke-width="1.4" stroke-dasharray="7 3 2 3"/>`);
  p.push(arrowHead(e2x, e2y, px, py, 9, dashCol));
  if (o.tiltDeg < 4) p.push(txt(e2x - 6, e2y - 10, "n⊥", { size: 15, weight: "bold", anchor: "middle" }));
  else if (o.tiltDeg > 86) p.push(txt(e2x + 10, e2y + 8, "n⊥", { size: 15, weight: "bold", anchor: "start" }));
  else p.push(txt(e2x + px * 12 + 2, e2y + py * 12 + 5, "n⊥", { size: 15, weight: "bold", anchor: "start" }));
  // θ arc from the −x axis (straight down) to the director
  const ar = 52;
  if (o.tiltDeg > 0.05) {
    p.push(
      `<path d="M${ox} ${oy + ar} A${ar} ${ar} 0 0 0 ${f(ox + ar * ux)} ${f(oy + ar * uy)}" fill="none" stroke="${ink}" stroke-width="1.4" data-angle="${f(o.tiltDeg)}" data-cx="${ox}" data-cy="${oy}"/>`,
    );
  }
  // label on the far side of the −x axis from the molecule, at the arc's height
  p.push(txt(ox - 30, oy + ar + 6, `θ = ${angleLabel(o.tiltDeg)}`, { size: 14, anchor: "end", weight: "bold" }));
  p.push(txt(W / 2, H - 6, "θ from the substrate plane (x–y)", { size: 11, anchor: "middle" }));
  p.push(`</svg>`);
  return p.join("");
}

// ------------------------------------------------------------- device schematic

/** The oblique projection of the element plane: in-plane x goes up the page, in-plane y goes left and down. */
export const DEVICE_EX: [number, number] = [0, -1];
export const DEVICE_EY: [number, number] = [-0.55, 0.14];

/** The widest the device drawing is inserted (px; 480 pt). */
export const DEVICE_MAX_W = 640;
/** The most cells the device drawing shows: beyond it the labels would print below 10 px at the inserted width. */
export const DEVICE_MAX_CELLS = 4;
/** The smallest text, in px, as inserted. */
const DEVICE_MIN_TEXT = 10.2;

export function lcDeviceSvg(o: { polDeg: number; cellsOaDeg: number[]; anaDeg: number; style: LcStyle }): string {
  const bw = o.style === "bw";
  const R = 52;
  const step = 150;
  const oas = o.cellsOaDeg.slice(0, DEVICE_MAX_CELLS);
  const n = oas.length;
  const x0 = 70;
  const W = x0 + step * (n + 1) + 90;
  const H = 320;
  const cy = 162;
  const ink = "#111111";
  const plateFill = bw ? "#ffffff" : "#f1f5f9";
  const cellFill = bw ? "#ffffff" : "#e0f2fe";
  const cellStroke = bw ? "#000000" : "#0284c7";
  const oaCol = bw ? "#000000" : "#111111";
  const P = (cx: number, ax: number, ay: number): [number, number] => [cx + (DEVICE_EX[0] * ax + DEVICE_EY[0] * ay) * R, cy + (DEVICE_EX[1] * ax + DEVICE_EY[1] * ay) * R];
  const dirOf = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const p: string[] = [];
  // Word sizes a picture from the SVG's own width: a long stack is scaled to DEVICE_MAX_W, and every font grows by
  // the same factor so no text prints below DEVICE_MIN_TEXT px as inserted.
  const k = Math.min(1, DEVICE_MAX_W / W);
  // the smallest glyphs are the OA subscripts (0.72 of the 14 px label) and the 11 px caption
  const grow = Math.max(1, DEVICE_MIN_TEXT / (Math.min(11, 0.72 * 14) * k));
  const sz = (base: number): number => Math.round(base * grow * 10) / 10;
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * k)}" height="${Math.round(H * k)}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // the beam axis
  p.push(`<path d="M20 ${cy} L${W - 30} ${cy}" fill="none" stroke="${ink}" stroke-width="1.1" stroke-dasharray="6 4"/>`);
  p.push(arrowHead(W - 22, cy, 1, 0, 9, ink));
  p.push(txt(W - 14, cy - 12, "z", { size: sz(14), weight: "bold", anchor: "middle" }));

  const face = (cx: number, h: number, w: number): string => {
    const a = P(cx, h, w);
    const b = P(cx, h, -w);
    const c = P(cx, -h, -w);
    const d = P(cx, -h, w);
    return `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])} L${f(c[0])} ${f(c[1])} L${f(d[0])} ${f(d[1])} Z`;
  };
  /**
   * The arc from x to `deg` AS TYPED (135° sweeps to 135°, not to −45°) in the element plane (radius rr × R); the
   * angle label sits above the tip of the x reference arrow, on the side the arc opens toward, and "x" on the other.
   */
  const arc = (cx: number, deg: number, rr: number, label: string, withX: boolean): void => {
    const tip = P(cx, 1.18, 0);
    // the arc leaves x toward +y (projected left) for a positive angle, toward −y (right) for a negative one
    const left = deg > 0 ? P(cx, 0, 1)[0] < cx : P(cx, 0, -1)[0] < cx;
    if (Math.abs(deg) >= 0.5) {
      const N = Math.max(8, Math.ceil(Math.abs(deg) / 3));
      const pts: string[] = [];
      for (let i = 0; i <= N; i++) {
        const a = ((deg * i) / N) * (Math.PI / 180);
        const q = P(cx, rr * Math.cos(a), rr * Math.sin(a));
        pts.push(`${i ? "L" : "M"}${f(q[0])} ${f(q[1])}`);
      }
      const end = P(cx, rr * Math.cos((deg * Math.PI) / 180), rr * Math.sin((deg * Math.PI) / 180));
      p.push(`<path d="${pts.join(" ")}" fill="none" stroke="${ink}" stroke-width="1.2" data-angle="${f(deg)}" data-cx="${f(cx)}" data-cy="${f(cy)}" data-ex="${f(end[0])}" data-ey="${f(end[1])}"/>`);
    }
    p.push(txt(tip[0] + (left ? -3 : 3), tip[1] - 16 - sz(8), label, { size: sz(12), anchor: left ? "end" : "start" }));
    if (withX) p.push(txt(tip[0] + (left ? 7 : -7), tip[1] + 3, "x", { size: sz(13), weight: "bold", anchor: left ? "start" : "end" }));
  };
  const xRef = (cx: number): void => {
    const t = P(cx, 1.18, 0);
    p.push(`<path d="M${f(cx)} ${cy} L${f(t[0])} ${f(t[1] + 6)}" fill="none" stroke="${ink}" stroke-width="1.1"/>`);
    p.push(arrowHead(t[0], t[1], 0, -1, 7, ink));
  };
  const doubleArrow = (cx: number, deg: number): void => {
    const [ux, uy] = dirOf(deg);
    const a = P(cx, 0.95 * ux, 0.95 * uy);
    const b = P(cx, -0.95 * ux, -0.95 * uy);
    const L = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const sx = (a[0] - b[0]) / L;
    const sy = (a[1] - b[1]) / L;
    p.push(`<path d="M${f(b[0] + sx * 9)} ${f(b[1] + sy * 9)} L${f(a[0] - sx * 9)} ${f(a[1] - sy * 9)}" fill="none" stroke="${ink}" stroke-width="2"/>`);
    p.push(arrowHead(a[0], a[1], sx, sy, 11, ink));
    p.push(arrowHead(b[0], b[1], -sx, -sy, 11, ink));
  };

  // polariser
  const px = x0;
  p.push(`<path d="${face(px, 1.02, 0.7)}" fill="${plateFill}" stroke="${bw ? "#000000" : "#94a3b8"}" stroke-width="1"/>`);
  doubleArrow(px, o.polDeg);
  if (Math.abs(normAngle(o.polDeg)) >= 0.5) {
    xRef(px);
    arc(px, o.polDeg, 0.5, angleLabel(o.polDeg), true);
  }
  p.push(txt(px, cy + R * 1.5 + 22, "P", { size: sz(15), weight: "bold", anchor: "middle" }));
  // cells
  oas.forEach((oa, i) => {
    const cx = x0 + step * (i + 1);
    p.push(`<path d="${face(cx + 12, 1.02, 0.7)}" fill="${cellFill}" stroke="${cellStroke}" stroke-width="1"/>`);
    for (const [h, w] of [
      [1.02, 0.7],
      [1.02, -0.7],
      [-1.02, -0.7],
      [-1.02, 0.7],
    ]) {
      const a = P(cx, h, w);
      p.push(`<path d="M${f(a[0])} ${f(a[1])} L${f(a[0] + 12)} ${f(a[1])}" fill="none" stroke="${cellStroke}" stroke-width="1"/>`);
    }
    p.push(`<path d="${face(cx, 1.02, 0.7)}" fill="${cellFill}" fill-opacity="${bw ? 1 : 0.85}" stroke="${cellStroke}" stroke-width="1.2"/>`);
    xRef(cx);
    const [ux, uy] = dirOf(oa);
    const a = P(cx, 1.1 * ux, 1.1 * uy);
    const b = P(cx, -1.1 * ux, -1.1 * uy);
    p.push(`<path d="M${f(b[0])} ${f(b[1])} L${f(a[0])} ${f(a[1])}" fill="none" stroke="${oaCol}" stroke-width="1.5" stroke-dasharray="6 3"/>`);
    arc(cx, oa, 0.5, angleLabel(oa), true);
    // The OA label goes beyond the end of the optic-axis line that points UP the page (whatever the sign of the
    // angle), never on the dashed line or the x arrow. Nearly along x, that end is the x arrow's tip, so the label
    // sits beside the line at mid-height instead; nearly across x (horizontal), above the upper end.
    const lab = `OA${subDigit(i + 1)}`;
    const up = a[1] <= b[1] ? a : b;
    const fold = Math.abs(normAngle(oa));
    if (fold < 25) {
      // right of the slab (its face reaches 0.385 R from the centre, its depth 12 px more), level with the upper line
      p.push(txt(cx + 0.385 * R + 18, cy - R * 0.62, lab, { size: sz(14), weight: "bold", anchor: "start" }));
    } else if (fold > 72) {
      const right = up[0] > cx;
      p.push(txt(up[0] + (right ? 16 : -4), up[1] - 10, lab, { size: sz(14), weight: "bold", anchor: right ? "start" : "end" }));
    } else {
      const L = Math.hypot(up[0] - cx, up[1] - cy) || 1;
      const right = up[0] > cx + 3;
      if (right) {
        // on the right the next cell's label is near, so the label sits ABOVE the upper end, clear of the slab top
        const topY = Math.min(up[1], cy - 1.02 * R - 0.14 * 0.7 * R) - 7;
        // when the x label sits right of the arrow (a positive angle opens left), start the OA label past it
        const xRight = oa > 0;
        p.push(txt(xRight ? Math.max(up[0] - 6, cx + 8 + sz(13) * 0.7) : up[0] + 4, topY, lab, { size: sz(14), weight: "bold", anchor: xRight ? "start" : "middle" }));
        return;
      }
      const lx = up[0] + ((up[0] - cx) / L) * 10 + (right ? 14 : 0);
      const ly = up[1] + ((up[1] - cy) / L) * 10;
      p.push(txt(lx, ly + 5, lab, { size: sz(14), weight: "bold", anchor: right ? "start" : "end" }));
    }
  });
  // analyser
  const ax = x0 + step * (n + 1);
  p.push(`<path d="${face(ax, 1.02, 0.7)}" fill="${plateFill}" stroke="${bw ? "#000000" : "#94a3b8"}" stroke-width="1"/>`);
  xRef(ax);
  doubleArrow(ax, o.anaDeg);
  arc(ax, o.anaDeg, 0.5, `φ = ${angleLabel(o.anaDeg)}`, true);
  p.push(txt(ax, cy + R * 1.5 + 22, "A", { size: sz(15), weight: "bold", anchor: "middle" }));
  p.push(txt(W / 2, H - 8, "Angles from x toward y; the light travels along z", { size: sz(11), anchor: "middle" }));
  p.push(`</svg>`);
  return p.join("");
}

/** An axis angle folded into (−90°, 90°] for drawing its arc (a polariser axis has no sense). */
function normAngle(a: number): number {
  let x = ((a % 180) + 180) % 180;
  if (x > 90) x -= 180;
  return x;
}
function subDigit(k: number): string {
  return String(k)
    .split("")
    .map((c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)])
    .join("");
}
