// Linear sequence maps — an annotated figure, drawn to SVG.
//
// This is the output people actually need in a paper or an application: the
// construct with its features drawn on it. Today they make it in a separate
// tool and paste a screenshot; this draws it at publication quality and inserts
// it at the cursor like any other JurisLab figure.
//
// Pure: takes a SeqRecord from seqio.ts, returns an SVG string. The existing
// SVG→PNG→Word path does the rest.

import { SeqRecord, SeqFeature } from "./seqio";

export interface MapOptions {
  width?: number;
  height?: number;
  /** Black-and-white line art for patent figures — no fills, hatch-free, print-safe. */
  monochrome?: boolean;
  /** Draw only these feature types (empty = all). */
  types?: string[];
  title?: string;
}

/**
 * Feature colours by GenBank type. Chosen to be distinguishable in print and to
 * match what a molecular biologist expects to see: CDS bold, regulatory warm,
 * primers thin and grey.
 */
const TYPE_COLOR: Record<string, string> = {
  CDS: "#2563eb",
  gene: "#3b82f6",
  mRNA: "#60a5fa",
  promoter: "#059669",
  terminator: "#dc2626",
  regulatory: "#059669",
  RBS: "#10b981",
  rep_origin: "#7c3aed",
  oriT: "#7c3aed",
  primer_bind: "#94a3b8",
  misc_binding: "#94a3b8",
  protein_bind: "#94a3b8",
  misc_feature: "#d97706",
  misc_recomb: "#d97706",
  sig_peptide: "#0891b2",
  mat_peptide: "#0891b2",
  variation: "#a3a3a3",
  repeat_region: "#a3a3a3",
};
const DEFAULT_COLOR = "#64748b";

const featureColor = (f: SeqFeature, mono: boolean): string => (mono ? "#000" : TYPE_COLOR[f.type] ?? DEFAULT_COLOR);

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Rough text width at a given font size — good enough for lane packing. */
const textWidth = (s: string, px: number): number => s.length * px * 0.55;

/** A "nice" tick step for the bp axis: 1, 2, 5 × 10ⁿ. */
function tickStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/** Formats a coordinate compactly: 1, 500, 2.5 kb, 48.5 kb. */
function fmtBp(n: number, span: number): string {
  if (span >= 10000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} kb`;
  return String(n);
}

interface Placed {
  f: SeqFeature;
  lane: number;
  x1: number;
  x2: number;
  /** Where the label sits, and whether it fits inside the feature body. */
  labelX: number;
  labelInside: boolean;
  /** SVG text-anchor for the label: middle inside, else start/end beside it. */
  labelAnchor: "middle" | "start" | "end";
}

/**
 * Packs features into lanes so nothing overlaps.
 *
 * Reserving the LABEL's width, not just the feature's, is the whole job — a
 * feature 3 px wide with a 60 px label needs 60 px of lane, or the labels sit on
 * top of each other and the figure is unusable. That is the difference between
 * a map and a mess.
 */
function packLanes(features: SeqFeature[], toX: (bp: number) => number, fontPx: number, rightEdge: number): Placed[] {
  const placed: Placed[] = [];
  const laneSpans: { from: number; to: number }[][] = [];
  // Longest first: the big features claim the top lanes, which reads better.
  const sorted = [...features].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);

  for (const f of sorted) {
    const x1 = toX(f.start);
    const x2 = Math.max(toX(f.end), x1 + 2); // never invisible
    const lw = textWidth(f.name, fontPx);
    const bodyW = x2 - x1;
    const labelInside = bodyW >= lw + 8;

    // A label that doesn't fit inside goes to the RIGHT — unless that would run
    // it off the canvas, in which case it goes LEFT. Without this, features near
    // the end of the sequence get their labels clipped by the viewport, which is
    // exactly what happened to "AmpR promoter" and "rrnB T1" on a pUC19 map.
    let labelAnchor: Placed["labelAnchor"] = "middle";
    let labelX = (x1 + x2) / 2;
    let from = x1;
    let to = x2;
    if (!labelInside) {
      const fitsRight = x2 + 4 + lw <= rightEdge;
      if (fitsRight) {
        labelAnchor = "start";
        labelX = x2 + 4;
        to = x2 + 4 + lw;
      } else {
        labelAnchor = "end";
        labelX = x1 - 4;
        from = x1 - 4 - lw;
      }
    }

    // Reserve the label's span, not just the body's: a 3px feature with a 60px
    // label needs 60px of lane or the labels collide.
    let lane = 0;
    for (;;) {
      const spans = laneSpans[lane];
      if (!spans) {
        laneSpans[lane] = [];
        break;
      }
      const clash = spans.some((s) => from < s.to + 4 && to + 4 > s.from);
      if (!clash) break;
      lane++;
    }
    laneSpans[lane].push({ from, to });
    placed.push({ f, lane, x1, x2, labelX, labelInside, labelAnchor });
  }
  return placed;
}

/** One feature: an arrow (or a segmented arrow, for a joined CDS). */
function drawFeature(p: Placed, y: number, h: number, mono: boolean): string {
  const { f } = p;
  const color = featureColor(f, mono);
  const fill = mono ? "#fff" : color;
  const stroke = mono ? "#000" : color;
  const tip = Math.min(7, Math.max(3, (p.x2 - p.x1) * 0.25));
  const parts: string[] = [];

  // A joined feature draws each segment separately, with a thin connector for
  // the intron — drawing one solid bar across it would claim the intron is part
  // of the CDS, which is exactly the error the parser works to avoid.
  const segs = f.segments.length > 1 ? f.segments : [{ start: f.start, end: f.end }];
  if (f.segments.length > 1) {
    parts.push(
      `<line x1="${p.x1.toFixed(1)}" y1="${(y + h / 2).toFixed(1)}" x2="${p.x2.toFixed(1)}" y2="${(y + h / 2).toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/>`
    );
  }

  const span = p.x2 - p.x1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Map this segment back into pixels using the same scale as the whole.
    const frac = (v: number) => (f.end === f.start ? 0 : (v - f.start) / (f.end - f.start));
    const sx1 = p.x1 + frac(s.start) * span;
    const sx2 = Math.max(p.x1 + frac(s.end) * span, sx1 + 1.5);
    const isTipSeg = f.strand === 1 ? i === segs.length - 1 : i === 0;
    const t = isTipSeg ? Math.min(tip, sx2 - sx1) : 0;

    let d: string;
    if (f.strand === 1) {
      d = `M${sx1},${y} L${sx2 - t},${y} L${sx2},${y + h / 2} L${sx2 - t},${y + h} L${sx1},${y + h} Z`;
    } else {
      d = `M${sx2},${y} L${sx1 + t},${y} L${sx1},${y + h / 2} L${sx1 + t},${y + h} L${sx2},${y + h} Z`;
    }
    parts.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
  }

  // Label: inside the body when it fits, otherwise just past the end.
  const fontPx = 9;
  const ly = y + h / 2 + 3.2;
  const labelFill = p.labelInside && !mono ? "#fff" : "#1b1b1f";
  const anchor = p.labelAnchor;
  parts.push(
    `<text x="${p.labelX.toFixed(1)}" y="${ly.toFixed(1)}" font-family="sans-serif" font-size="${fontPx}" fill="${labelFill}" text-anchor="${anchor}">${escapeXml(f.name)}</text>`
  );
  return parts.join("");
}

/**
 * Draws a linear map of `record`. Returns an SVG string, or null when there is
 * nothing to draw.
 */
export function buildLinearMapSvg(record: SeqRecord, opts: MapOptions = {}): string | null {
  if (!record.length) return null;
  const mono = opts.monochrome ?? false;
  const W = opts.width ?? 640;
  const ml = 14;
  const mr = 14;
  const pw = W - ml - mr;
  const toX = (bp: number) => ml + (Math.min(Math.max(bp, 1), record.length) / record.length) * pw;

  let features = record.features.filter((f) => !f.wraps); // a wrapped feature has no honest linear span
  if (opts.types && opts.types.length) features = features.filter((f) => opts.types!.includes(f.type));

  const placed = packLanes(features, toX, 9, W - mr);
  const lanes = placed.length ? Math.max(...placed.map((p) => p.lane)) + 1 : 0;

  const laneH = 13;
  const laneGap = 3;
  const titleH = 22;
  const axisH = 26;
  const backboneY = titleH + lanes * (laneH + laneGap) + 6;
  const H = opts.height ?? backboneY + axisH + 10;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);

  // Title: name, length, topology — the caption a reader needs.
  const title = opts.title ?? `${record.name} · ${record.length.toLocaleString()} bp · ${record.circular ? "circular" : "linear"}`;
  out.push(
    `<text x="${ml}" y="14" font-family="sans-serif" font-size="11" font-weight="600" fill="#1b1b1f">${escapeXml(title)}</text>`
  );

  // Features, tallest lane first so lane 0 sits nearest the backbone.
  for (const p of placed) {
    const y = titleH + (lanes - 1 - p.lane) * (laneH + laneGap);
    out.push(drawFeature(p, y, laneH, mono));
  }

  // Backbone.
  const bbColor = mono ? "#000" : "#334155";
  out.push(
    `<line x1="${ml}" y1="${backboneY}" x2="${W - mr}" y2="${backboneY}" stroke="${bbColor}" stroke-width="${record.circular ? 3 : 2}" stroke-linecap="round"/>`
  );
  if (!record.circular) {
    // Blunt ends make "linear" visible at a glance.
    for (const x of [ml, W - mr]) {
      out.push(`<line x1="${x}" y1="${backboneY - 4}" x2="${x}" y2="${backboneY + 4}" stroke="${bbColor}" stroke-width="2"/>`);
    }
  }

  // Axis ticks.
  const step = tickStep(record.length, 8);
  const tickColor = mono ? "#000" : "#64748b";
  for (let bp = step; bp < record.length; bp += step) {
    const x = toX(bp);
    out.push(`<line x1="${x.toFixed(1)}" y1="${backboneY}" x2="${x.toFixed(1)}" y2="${backboneY + 4}" stroke="${tickColor}" stroke-width="1"/>`);
    out.push(
      `<text x="${x.toFixed(1)}" y="${backboneY + 15}" font-family="sans-serif" font-size="8.5" fill="${tickColor}" text-anchor="middle">${fmtBp(bp, record.length)}</text>`
    );
  }
  // Always label both ends.
  out.push(`<text x="${ml}" y="${backboneY + 15}" font-family="sans-serif" font-size="8.5" fill="${tickColor}" text-anchor="start">1</text>`);
  out.push(
    `<text x="${W - mr}" y="${backboneY + 15}" font-family="sans-serif" font-size="8.5" fill="${tickColor}" text-anchor="end">${record.length.toLocaleString()}</text>`
  );

  // If a circular plasmid has features crossing the origin, say so rather than
  // dropping them silently.
  const dropped = record.features.filter((f) => f.wraps).length;
  if (dropped) {
    out.push(
      `<text x="${ml}" y="${H - 2}" font-family="sans-serif" font-size="8" fill="#8a5a00">${dropped} feature${dropped === 1 ? "" : "s"} cross the origin and are not shown on a linear map.</text>`
    );
  }

  out.push("</svg>");
  return out.join("");
}

/** Feature types present in a record, most common first — for a filter UI. */
export function featureTypes(record: SeqRecord): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of record.features) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
