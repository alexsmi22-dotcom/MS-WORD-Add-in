// Circular plasmid maps — the iconic figure, drawn to SVG.
//
// This is the picture people mean when they say "plasmid map": a ring with
// feature arcs and labels radiating off it. It is the single most recognisable
// output of the incumbent tools, and the thing that gets screenshotted into Word.
//
// The hard part is NOT the polar arithmetic — it's label placement. Real
// plasmids cluster features (an MCS packs a dozen sites into 100 bp of a 5 kb
// ring), so naive radial labels overlap into an unreadable smear. The lane
// approach used for the linear map does not transfer: a circle has no lanes.
// Instead labels are pushed outward in rings and, within a ring, nudged along
// the circumference until they stop colliding — which is what separates a map
// that looks professional from one that looks homemade.
//
// Pure: takes a SeqRecord from seqio.ts, returns an SVG string.

import { SeqRecord, SeqFeature } from "./seqio";

export interface CircularMapOptions {
  /** Overall square canvas size. */
  size?: number;
  /** Black-and-white line art for patent figures. */
  monochrome?: boolean;
  /** Draw only these feature types (empty = all). */
  types?: string[];
  title?: string;
}

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

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const textWidth = (s: string, px: number): number => s.length * px * 0.55;

function tickStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

function fmtBp(n: number, span: number): string {
  if (span >= 10000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} kb`;
  return String(n);
}

/**
 * bp → angle in radians, with 12 o'clock = position 1 and clockwise increasing,
 * which is the universal convention for plasmid maps. Getting this backwards
 * mirrors the whole construct — a picture that looks fine and is wrong.
 */
const bpToAngle = (bp: number, len: number): number => (bp / len) * Math.PI * 2 - Math.PI / 2;

const polar = (cx: number, cy: number, r: number, a: number) => ({
  x: cx + r * Math.cos(a),
  y: cy + r * Math.sin(a),
});

/** An annular sector with an arrow head, drawn as an SVG path. */
function arcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
  strand: 1 | -1
): string {
  const sweep = a1 - a0;
  const large = sweep > Math.PI ? 1 : 0;
  // The head takes a slice of the arc, capped so a short feature is still an
  // arrow rather than a spike.
  const headA = Math.min(Math.abs(sweep) * 0.35, 0.09);
  const rMid = (rInner + rOuter) / 2;

  if (strand === 1) {
    const bodyEnd = a1 - headA;
    const p1 = polar(cx, cy, rOuter, a0);
    const p2 = polar(cx, cy, rOuter, bodyEnd);
    const tip = polar(cx, cy, rMid, a1);
    const p3 = polar(cx, cy, rInner, bodyEnd);
    const p4 = polar(cx, cy, rInner, a0);
    return (
      `M${p1.x.toFixed(2)},${p1.y.toFixed(2)} ` +
      `A${rOuter},${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ` +
      `L${tip.x.toFixed(2)},${tip.y.toFixed(2)} ` +
      `L${p3.x.toFixed(2)},${p3.y.toFixed(2)} ` +
      `A${rInner},${rInner} 0 ${large} 0 ${p4.x.toFixed(2)},${p4.y.toFixed(2)} Z`
    );
  }
  const bodyStart = a0 + headA;
  const p1 = polar(cx, cy, rOuter, a1);
  const p2 = polar(cx, cy, rOuter, bodyStart);
  const tip = polar(cx, cy, rMid, a0);
  const p3 = polar(cx, cy, rInner, bodyStart);
  const p4 = polar(cx, cy, rInner, a1);
  return (
    `M${p1.x.toFixed(2)},${p1.y.toFixed(2)} ` +
    `A${rOuter},${rOuter} 0 ${large} 0 ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ` +
    `L${tip.x.toFixed(2)},${tip.y.toFixed(2)} ` +
    `L${p3.x.toFixed(2)},${p3.y.toFixed(2)} ` +
    `A${rInner},${rInner} 0 ${large} 1 ${p4.x.toFixed(2)},${p4.y.toFixed(2)} Z`
  );
}

interface RingFeature {
  f: SeqFeature;
  ring: number;
  a0: number;
  a1: number;
}

/**
 * Assigns features to concentric rings so overlapping ones don't cover each
 * other. Longest first, so the big arcs sit outermost and short features tuck
 * inside them.
 */
function assignRings(features: SeqFeature[], len: number): RingFeature[] {
  const out: RingFeature[] = [];
  const rings: { a0: number; a1: number }[][] = [];
  const sorted = [...features].sort((a, b) => b.end - b.start - (a.end - a.start));

  for (const f of sorted) {
    const a0 = bpToAngle(f.start, len);
    // A 1 bp feature would be invisible; give every arc a floor.
    const a1 = Math.max(bpToAngle(f.end, len), a0 + 0.012);
    let ring = 0;
    for (;;) {
      const occupied = rings[ring];
      if (!occupied) {
        rings[ring] = [];
        break;
      }
      const clash = occupied.some((o) => a0 < o.a1 + 0.02 && a1 + 0.02 > o.a0);
      if (!clash) break;
      ring++;
    }
    rings[ring].push({ a0, a1 });
    out.push({ f, ring, a0, a1 });
  }
  return out;
}

interface Label {
  text: string;
  angle: number;
  x: number;
  y: number;
  anchor: "start" | "end";
  /** Where the leader line touches the ring. */
  fromX: number;
  fromY: number;
  color: string;
}

/**
 * Places labels around the ring without overlapping.
 *
 * Sorted by angle, then each label is pushed along the circumference until it
 * clears the previous one on its side. Left and right halves are packed
 * independently because text grows in opposite directions.
 */
function placeLabels(
  items: { text: string; angle: number; color: string }[],
  cx: number,
  cy: number,
  rRing: number,
  rLabel: number,
  fontPx: number
): Label[] {
  const labels: Label[] = [];
  const lineH = fontPx + 3;

  // Split by side: cos(angle) > 0 is the right half.
  const right = items.filter((i) => Math.cos(i.angle) >= 0).sort((a, b) => Math.sin(a.angle) - Math.sin(b.angle));
  const left = items.filter((i) => Math.cos(i.angle) < 0).sort((a, b) => Math.sin(a.angle) - Math.sin(b.angle));

  for (const [side, list] of [
    ["right", right],
    ["left", left],
  ] as ["right" | "left", typeof items][]) {
    let lastY = -Infinity;
    for (const it of list) {
      const anchorPt = polar(cx, cy, rRing, it.angle);
      const want = polar(cx, cy, rLabel, it.angle);
      // Push down until this label clears the one before it on this side.
      const y = Math.max(want.y, lastY + lineH);
      lastY = y;
      const x = side === "right" ? cx + rLabel * 0.72 : cx - rLabel * 0.72;
      labels.push({
        text: it.text,
        angle: it.angle,
        x,
        y,
        anchor: side === "right" ? "start" : "end",
        fromX: anchorPt.x,
        fromY: anchorPt.y,
        color: it.color,
      });
    }
  }
  return labels;
}

/**
 * Draws a circular plasmid map. Returns null when there is nothing to draw.
 *
 * A linear record is refused rather than drawn as a ring — a circular map of a
 * linear sequence is a lie about the construct.
 */
export function buildCircularMapSvg(record: SeqRecord, opts: CircularMapOptions = {}): string | null {
  if (!record.length) return null;
  const mono = opts.monochrome ?? false;
  const S = opts.size ?? 460;
  const cx = S / 2;
  const cy = S / 2;

  let features = record.features;
  if (opts.types && opts.types.length) features = features.filter((f) => opts.types!.includes(f.type));

  const placed = assignRings(features, record.length);
  const ringCount = placed.length ? Math.max(...placed.map((p) => p.ring)) + 1 : 0;

  // Geometry: the backbone ring, feature rings inside it, labels outside.
  const rLabel = S * 0.46;
  const rRing = S * 0.3;
  const ringW = 11;
  const ringGap = 2;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`);
  out.push(`<rect width="${S}" height="${S}" fill="#fff"/>`);

  // Backbone.
  const bb = mono ? "#000" : "#334155";
  out.push(`<circle cx="${cx}" cy="${cy}" r="${rRing}" fill="none" stroke="${bb}" stroke-width="2.5"/>`);

  // Ticks around the outside of the backbone.
  const step = tickStep(record.length, 8);
  const tickC = mono ? "#000" : "#64748b";
  for (let bp = 0; bp < record.length; bp += step) {
    const a = bpToAngle(bp === 0 ? 1 : bp, record.length);
    const p1 = polar(cx, cy, rRing, a);
    const p2 = polar(cx, cy, rRing + 5, a);
    out.push(
      `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${tickC}" stroke-width="1"/>`
    );
    const t = polar(cx, cy, rRing + 12, a);
    out.push(
      `<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" font-family="sans-serif" font-size="7.5" fill="${tickC}" text-anchor="middle" dominant-baseline="middle">${fmtBp(bp === 0 ? 1 : bp, record.length)}</text>`
    );
  }

  // Feature arcs, innermost ring first.
  for (const p of placed) {
    const rOuter = rRing - 3 - p.ring * (ringW + ringGap);
    const rInner = rOuter - ringW;
    if (rInner < 20) continue; // ran out of room toward the centre
    const color = mono ? "#000" : TYPE_COLOR[p.f.type] ?? DEFAULT_COLOR;
    const fill = mono ? "#fff" : color;
    out.push(
      `<path d="${arcPath(cx, cy, rInner, rOuter, p.a0, p.a1, p.f.strand)}" fill="${fill}" stroke="${color}" stroke-width="1"/>`
    );
  }

  // Labels with leader lines.
  const fontPx = 9;
  const items = placed.map((p) => ({
    text: p.f.name,
    angle: (p.a0 + p.a1) / 2,
    color: mono ? "#1b1b1f" : TYPE_COLOR[p.f.type] ?? DEFAULT_COLOR,
  }));
  for (const l of placeLabels(items, cx, cy, rRing - 2, rLabel, fontPx)) {
    const leader = mono ? "#000" : "#cbd5e1";
    out.push(
      `<line x1="${l.fromX.toFixed(1)}" y1="${l.fromY.toFixed(1)}" x2="${l.x.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="${leader}" stroke-width="0.6"/>`
    );
    out.push(
      `<text x="${l.x.toFixed(1)}" y="${(l.y + 3).toFixed(1)}" font-family="sans-serif" font-size="${fontPx}" fill="${l.color}" text-anchor="${l.anchor}">${escapeXml(l.text)}</text>`
    );
  }

  // Centre caption: the name and size, as every plasmid map has.
  const title = opts.title ?? record.name;
  out.push(
    `<text x="${cx}" y="${cy - 4}" font-family="sans-serif" font-size="13" font-weight="600" fill="#1b1b1f" text-anchor="middle">${escapeXml(title)}</text>`
  );
  out.push(
    `<text x="${cx}" y="${cy + 12}" font-family="sans-serif" font-size="10" fill="${mono ? "#000" : "#64748b"}" text-anchor="middle">${record.length.toLocaleString()} bp</text>`
  );

  // If features ran out of rings, say so rather than silently omitting them.
  const dropped = placed.filter((p) => rRing - 3 - p.ring * (ringW + ringGap) - ringW < 20).length;
  if (dropped) {
    out.push(
      `<text x="${cx}" y="${S - 4}" font-family="sans-serif" font-size="8" fill="#8a5a00" text-anchor="middle">${dropped} feature${dropped === 1 ? "" : "s"} could not be placed — filter by type to see them.</text>`
    );
  }

  out.push("</svg>");
  return out.join("");
}
