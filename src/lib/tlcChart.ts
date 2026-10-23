// The TLC plate schematic, drawn the way SI figures draw one: a plate outline, a pencil origin line and a dashed
// solvent-front line (named in the margin to the right of the plate, never on it), lane labels under the plate,
// and spots as ellipses at their Rf — outlined (circled under UV light) or filled (stained). No numbers on the
// plate: the Rf values are in the text beside it. One spot size for the whole plate.
//
// tlcLayout() returns the geometry (so a test can prove no label touches a spot or another label); tlcPlateSvg()
// draws it. Colours are literal hex (artwork never follows the pane theme); font Arial as engCharts2026.ts.

import { rf2, type TlcPlate } from "./tlc";
import { typesetLabel } from "./spectrumOverlay";

const FONT = "Arial, Helvetica, sans-serif";
const FS = 11;
/** Advance per character used for label boxes — above the layout audit's 0.58 em, so its boxes fit inside ours. */
const ADV = 0.62;
const INK = "#222222";
const STAIN = "#3d3d3d";
/** The spot half-height (px) on every plate. */
const RY = 5.5;
/** Clear space (px) between two spots in one lane. */
const SPOT_GAP = 2;
/** Tallest an unsized plate is stretched to resolve close spots. */
const MAX_H = 460;
/** Widest plate (px) before the lane labels go to two rows. */
const MAX_W = 480;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TlcLayout {
  width: number;
  height: number;
  plate: Box;
  originY: number;
  frontY: number;
  laneX: number[];
  /** One per drawn spot; `rfs` lists the Rf values a merged (elongated) spot stands for, high first. */
  spots: { cx: number; cy: number; rx: number; ry: number; lane: number; rf: number; rfs: number[]; parts: number[] }[];
  /** Every text: its anchor point and its box (for the overlap tests). */
  texts: { text: string; x: number; y: number; anchor: "start" | "middle"; box: Box; italic?: boolean }[];
  notes: string[];
}

const textW = (s: string): number => s.length * FS * ADV;

function textBox(text: string, x: number, y: number, anchor: "start" | "middle"): Box {
  const w = textW(text);
  return { x: anchor === "middle" ? x - w / 2 : x, y: y - FS * 0.8, w, h: FS };
}

export function tlcLayout(p: TlcPlate): TlcLayout {
  const notes: string[] = [];
  const n = p.lanes.length;
  const widest = Math.max(...p.lanes.map((l) => textW(l.label)));
  // Lane pitch: room for the widest label (with a gap) and for a spot. When that would make the plate wider than
  // MAX_W, the labels alternate between two rows (label i and i + 2 share a row), halving the room each needs.
  let pitch = Math.max(34, widest + 12);
  const stagger = n > 1 && n * pitch + 12 > MAX_W;
  if (stagger) pitch = Math.max(34, (widest + 12) / 2);
  let plateW = n * pitch + 12;
  // A plate is taller than it is wide unless it carries many lanes; never flatter than 2.2 : 1.
  let plateH = Math.max(230, plateW / 2.2);
  // Two spots in one lane closer than a spot height: an unsized plate is drawn taller (up to MAX_H) so they resolve at
  // the normal spot size. The run origin → front is 0.79 of an unsized plate's height (0.13 below, 0.08 above).
  let dMin = Infinity;
  for (const l of p.lanes) for (let k = 1; k < l.spots.length; k++) dMin = Math.min(dMin, l.spots[k - 1].rf - l.spots[k].rf);
  if (!p.size && dMin < Infinity) {
    const needH = Math.ceil((2 * RY + SPOT_GAP) / dMin / 0.79) + 1;
    if (needH > plateH && needH <= MAX_H) plateH = needH;
  }
  if (p.size) {
    plateH = (plateW * p.size.h) / p.size.w;
    if (plateH < 170) {
      // A short, wide plate: keep the proportions by widening it; the lanes spread out evenly.
      plateH = 170;
      plateW = (plateH * p.size.w) / p.size.h;
      pitch = (plateW - 12) / n;
    } else if (plateH > 460) {
      plateH = 460;
      notes.push(`The plate is drawn ${Math.round((plateW / plateH) * p.size.h * 10) / 10} cm wide rather than ${p.size.w} cm: ${n} lane${n > 1 ? "s" : ""} do not fit a ${p.size.w} cm plate at a legible size.`);
    }
  }
  const eluent = p.eluent ? typesetLabel(p.eluent) : "";
  const eluentW = eluent ? textW(eluent) : 0;
  const top = eluent ? 28 : 10;
  const left = 10;
  const plate: Box = { x: left, y: top, w: plateW, h: plateH };
  const bottom = top + plateH;
  // Origin and front: 1 cm from the bottom when the plate size is known (as spotted), else in proportion.
  const pxPerCm = p.size ? plateH / p.size.h : null;
  let originY = bottom - (pxPerCm ? Math.min(Math.max(pxPerCm * 1.0, 22), plateH * 0.2) : plateH * 0.13);
  let frontY = top + Math.max(16, plateH * 0.08);
  if (pxPerCm && p.front !== undefined) {
    const f = originY - p.front * pxPerCm;
    if (f >= top + 12) frontY = f;
    else {
      // The front as measured would sit at the plate's top edge: the origin moves down to keep the front inside.
      frontY = top + 12;
      originY = Math.min(bottom - 14, frontY + p.front * pxPerCm);
    }
  }
  const laneX = p.lanes.map((_, i) => left + 6 + pitch * (i + 0.5));

  // ONE spot size for every plate (never shrunk for a crowded lane elsewhere). Spots in a lane that still cannot be
  // drawn apart at that size (closer than 2·RY + SPOT_GAP px) are drawn as ONE elongated spot spanning them, with a note
  // naming the lane and the Rf values — never as overlapping ellipses.
  const ry = RY;
  const run = originY - frontY;
  const rx = Math.min(ry * 1.65, pitch * 0.3);
  const spots: TlcLayout["spots"] = [];
  p.lanes.forEach((l, i) => {
    let cluster: number[] = [];
    const flush = (): void => {
      if (!cluster.length) return;
      const yTop = originY - cluster[0] * run;
      const yBot = originY - cluster[cluster.length - 1] * run;
      spots.push({ cx: laneX[i], cy: (yTop + yBot) / 2, rx, ry: ry + (yBot - yTop) / 2, lane: i, rf: cluster[0], rfs: cluster.slice(), parts: cluster.map((r) => originY - r * run) });
      if (cluster.length > 1) notes.push(`Lane ${l.label}: the spots at Rf ${cluster.slice(0, -1).map((r) => rf2(r)).join(", ")} and ${rf2(cluster[cluster.length - 1])} are too close to draw apart; drawn as one merged spot.`);
      cluster = [];
    };
    for (const s of l.spots) {
      if (cluster.length && (cluster[cluster.length - 1] - s.rf) * run < 2 * ry + SPOT_GAP) cluster.push(s.rf);
      else {
        flush();
        cluster.push(s.rf);
      }
    }
    flush();
  });

  const texts: TlcLayout["texts"] = [];
  const right = left + plateW;
  const add = (text: string, x: number, y: number, anchor: "start" | "middle", italic?: boolean) => texts.push({ text, x, y, anchor, box: textBox(text, x, y, anchor), italic });
  add("solvent front", right + 6, frontY + 4, "start");
  add("origin", right + 6, originY + 4, "start");
  p.lanes.forEach((l, i) => add(l.label, laneX[i], bottom + 16 + (stagger && i % 2 ? 14 : 0), "middle"));
  let width = right + 6 + textW("solvent front") + 10;
  if (eluent) {
    const cx = Math.max(left + plateW / 2, 8 + eluentW / 2);
    add(eluent, cx, 17, "middle");
    width = Math.max(width, cx + eluentW / 2 + 8);
  }
  const height = bottom + 26 + (stagger ? 14 : 0);
  return { width: Math.ceil(width), height: Math.ceil(height), plate, originY, frontY, laneX, spots, texts, notes };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v: number): string => String(Math.round(v * 10) / 10);

/** The plate as an SVG, with its size. */
export function tlcPlateSvg(p: TlcPlate): { svg: string; width: number; height: number; notes: string[] } {
  const L = tlcLayout(p);
  const { plate } = L;
  const x0 = plate.x;
  const x1 = plate.x + plate.w;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">`,
    `<rect width="${L.width}" height="${L.height}" fill="#ffffff"/>`,
    `<rect x="${r1(x0)}" y="${r1(plate.y)}" width="${r1(plate.w)}" height="${r1(plate.h)}" rx="2" fill="#ffffff" stroke="${INK}" stroke-width="1.2"/>`,
    `<line x1="${r1(x0)}" y1="${r1(L.originY)}" x2="${r1(x1)}" y2="${r1(L.originY)}" stroke="${INK}" stroke-width="0.9"/>`,
    `<line x1="${r1(x0)}" y1="${r1(L.frontY)}" x2="${r1(x1)}" y2="${r1(L.frontY)}" stroke="${INK}" stroke-width="0.9" stroke-dasharray="4 3"/>`,
  ];
  for (const s of L.spots) {
    if (s.parts.length === 1) {
      parts.push(
        p.style === "stain"
          ? `<ellipse cx="${r1(s.cx)}" cy="${r1(s.cy)}" rx="${r1(s.rx)}" ry="${r1(s.ry)}" fill="${STAIN}" stroke="${STAIN}" stroke-width="0.6"/>`
          : `<ellipse cx="${r1(s.cx)}" cy="${r1(s.cy)}" rx="${r1(s.rx)}" ry="${r1(s.ry)}" fill="#ffffff" stroke="${INK}" stroke-width="1.1"/>`,
      );
      continue;
    }
    // A merged spot: ONE outline around its unresolved components (their union), no line inside it. Filled: the
    // components in one colour. Outlined: each component stroked at double width on radii 0.55 px in, then all of them
    // filled white without a stroke, which leaves exactly the outer 1.1 px — the same line as a single spot.
    const ry0 = RY;
    if (p.style === "stain") {
      for (const cy of s.parts) parts.push(`<ellipse cx="${r1(s.cx)}" cy="${r1(cy)}" rx="${r1(s.rx)}" ry="${r1(ry0)}" fill="${STAIN}" stroke="${STAIN}" stroke-width="0.6"/>`);
    } else {
      for (const cy of s.parts) parts.push(`<ellipse cx="${r1(s.cx)}" cy="${r1(cy)}" rx="${r1(s.rx - 0.55)}" ry="${r1(ry0 - 0.55)}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
      for (const cy of s.parts) parts.push(`<ellipse cx="${r1(s.cx)}" cy="${r1(cy)}" rx="${r1(s.rx - 0.55)}" ry="${r1(ry0 - 0.55)}" fill="#ffffff" stroke="none"/>`);
    }
  }
  for (const t of L.texts) {
    parts.push(`<text x="${r1(t.x)}" y="${r1(t.y)}" font-family="${FONT}" font-size="${FS}" fill="${INK}"${t.anchor === "middle" ? ' text-anchor="middle"' : ""}>${esc(t.text)}</text>`);
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width: L.width, height: L.height, notes: L.notes };
}
