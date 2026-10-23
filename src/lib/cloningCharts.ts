// The cloning figures: a Golden Gate parts diagram, a Gibson parts diagram and
// a PCR amplicon map.
//
// They are built from ONE layout routine, because they are one picture with
// different annotations: a row of parts in assembly order, each junction
// labelled with what holds it together (a 4 nt fusion site, or an overlap with
// its length and Tm). That keeps the proportions identical between the two
// assembly tools, which is what makes a figure look designed rather than
// generated.
//
// Junction labels ALTERNATE between two rows once the parts are narrow enough
// for neighbouring labels to touch. An overlapping label is the single most
// common way a diagram like this stops being publishable, and it is cheap to
// avoid: measure the label, compare it with the gap, and step down a row.
//
// Colours are literal hex, never a CSS variable or the inherited-colour keyword:
// this artwork goes into a Word document and must not follow the pane's theme.

import { trueMinus } from "./axis";
import type { GoldenGateOk, GibsonOk, PcrOk } from "./cloning";

const PAPER = "#ffffff";
const INK = "#111111";
const RULE = "#8a8a8a";
const PART_FILL = "#e8eef7";
const PART_FILL_ALT = "#f3f6fb";
/** The destination-vector body: the one box in the row that is not amplified. */
const VECTOR_FILL = "#e6f0e6";
const VECTOR_EDGE = "#2f5d35";
const PART_EDGE = "#1f3a5f";
const JUNCTION = "#b91c1c";
const OVERLAP_FILL = "#f7dcdc";
const ARROW = "#1d4ed8";
const FONT = "Arial, Helvetica, sans-serif";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Width of a string at a given font size, close enough for collision tests. */
function textWidth(s: string, size: number): number {
  return s.length * size * 0.58;
}

/** Greedy word wrap to a pixel width, so a footer sentence always finishes. */
function wrapText(text: string, width: number, size: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of t.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size) > width && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
    // A single word longer than the line is left long rather than hyphenated.
    if (lines.length > 6) break;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A name that fits a box: shortened with an ellipsis, never clipped by the box. */
function fitName(name: string, boxW: number, size: number): string {
  const max = Math.max(1, Math.floor((boxW - 8) / (size * 0.58)));
  return name.length <= max ? name : name.slice(0, Math.max(1, max - 1)) + "…";
}

export interface DiagramPart {
  name: string;
  length: number;
  /** Drawn in the vector tint: a destination-vector body rather than an amplified part. */
  vector?: boolean;
}

export interface DiagramJunction {
  /** The headline label, e.g. a fusion site or "20 nt". */
  label: string;
  /** A second line, e.g. a Tm. */
  sub?: string;
  /** Draw the junction as a shared overlap block rather than a thin boundary. */
  overlap?: boolean;
}

export interface PartsDiagramOptions {
  title: string;
  /** The last junction closes the circle back to the first part. */
  circular: boolean;
  /** A single line under the diagram (the assembled length, the enzyme). */
  footer?: string;
  /** The word for a junction in the legend ("fusion site", "overlap"). */
  junctionWord: string;
}

const MIN_BOX = 48;
const MAX_WIDTH = 700;
const BOX_H = 30;

/**
 * A row of parts with labelled junctions.
 *
 * Box widths are proportional to part length with a floor, because a 20 bp
 * linker next to a 4 kb backbone would otherwise be a line with a name over it.
 * The caption says so; a diagram whose widths mean something only approximately
 * has to admit it.
 */
export function partsDiagramSvg(parts: DiagramPart[], junctions: DiagramJunction[], opts: PartsDiagramOptions): string {
  const ps = parts.filter((p) => Number.isFinite(p.length) && p.length > 0);
  if (!ps.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60" viewBox="0 0 320 60"><rect width="320" height="60" fill="${PAPER}"/><text x="12" y="34" font-family="${FONT}" font-size="11" fill="${INK}">No parts to draw</text></svg>`;
  }
  const total = ps.reduce((s, p) => s + p.length, 0);
  const PAD_L = 14;
  const PAD_R = 14;
  const avail = MAX_WIDTH - PAD_L - PAD_R - (ps.length - 1) * 2;
  // Proportional, then lift anything under the floor and take the difference
  // off the boxes that have room — so the row still fits the canvas.
  let widths = ps.map((p) => Math.max(MIN_BOX, (p.length / total) * avail));
  const over = widths.reduce((s, w) => s + w, 0) - avail;
  if (over > 0) {
    const slack = widths.map((w) => Math.max(0, w - MIN_BOX));
    const slackSum = slack.reduce((s, v) => s + v, 0);
    if (slackSum > 0) widths = widths.map((w, i) => w - (slack[i] / slackSum) * Math.min(over, slackSum));
  }
  const rowW = widths.reduce((s, w) => s + w, 0) + (ps.length - 1) * 2;

  // Two label rows when a label would not fit its gap.
  const labelSize = 9;
  const widest = Math.max(0, ...junctions.map((j) => Math.max(textWidth(j.label, labelSize), textWidth(j.sub ?? "", labelSize))));
  const gapNeeded = widest + 8;
  const tight = widths.some((w) => w < gapNeeded) && junctions.length > 1;
  const labelRows = tight ? 2 : 1;
  const subRows = junctions.some((j) => j.sub) ? 1 : 0;

  const TOP = 20;
  const labelBlock = labelRows * (subRows ? 22 : 12) + 6;
  const boxY = TOP + labelBlock;
  const lenY = boxY + BOX_H + 13;
  const W = PAD_L + rowW + PAD_R;
  // The footer WRAPS. One long line ran off the canvas, and a sentence a reader
  // cannot finish is the same defect as a clipped label.
  const footParts = [
    opts.circular ? `The last ${opts.junctionWord} closes onto ${ps[0].name}` : "",
    opts.footer ?? "",
  ].filter(Boolean);
  const footLines = wrapText(footParts.join(" · "), W - PAD_L - PAD_R, 9);
  const footY = lenY + (footLines.length ? 16 : 0);
  const H = footY + (footLines.length ? (footLines.length - 1) * 11 : 0) + 12;

  const x0: number[] = [];
  let x = PAD_L;
  for (const w of widths) {
    x0.push(x);
    x += w + 2;
  }

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">`);
  p.push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${PAPER}"/>`);
  p.push(`<g font-family="${FONT}" font-size="9" fill="${INK}">`);
  p.push(`<text x="${PAD_L}" y="13" font-size="11" fill="${INK}">${esc(opts.title)}</text>`);

  // The parts.
  ps.forEach((part, i) => {
    const w = widths[i];
    p.push(
      `<rect x="${x0[i].toFixed(1)}" y="${boxY}" width="${w.toFixed(1)}" height="${BOX_H}" fill="${part.vector ? VECTOR_FILL : i % 2 ? PART_FILL_ALT : PART_FILL}" stroke="${part.vector ? VECTOR_EDGE : PART_EDGE}" stroke-width="${part.vector ? "1.4" : "0.9"}"/>`,
    );
    p.push(
      `<text x="${(x0[i] + w / 2).toFixed(1)}" y="${boxY + 19}" text-anchor="middle" font-size="10" fill="${INK}">${esc(fitName(part.name, w, 10))}</text>`,
    );
    p.push(
      `<text x="${(x0[i] + w / 2).toFixed(1)}" y="${lenY}" text-anchor="middle" font-size="9" fill="${INK}">${part.length.toLocaleString("en-US")} bp</text>`,
    );
  });

  // The junctions: one per boundary, and the wrap junction drawn at the right
  // edge when the assembly is circular.
  junctions.forEach((j, i) => {
    const last = i >= ps.length - 1;
    const bx = last ? x0[ps.length - 1] + widths[ps.length - 1] : x0[i + 1] - 1;
    const row = labelRows === 2 ? i % 2 : 0;
    const ly = TOP + 2 + row * (subRows ? 22 : 12);
    if (j.overlap) {
      // A shared region: a block straddling the boundary, so "these two
      // fragments have this sequence in common" is what the picture says.
      const ow = Math.min(26, Math.max(10, widths[Math.min(i, widths.length - 1)] * 0.25));
      // Kept inside the row of boxes: the junction that closes a circle sits at
      // the right-hand end, and half a block hanging off the last part reads as
      // a drawing error rather than as a shared sequence.
      const ox = Math.min(Math.max(bx - ow / 2, PAD_L), PAD_L + rowW - ow);
      p.push(
        `<rect x="${ox.toFixed(1)}" y="${boxY}" width="${ow.toFixed(1)}" height="${BOX_H}" fill="${OVERLAP_FILL}" stroke="${JUNCTION}" stroke-width="0.9"/>`,
      );
    } else {
      p.push(`<line x1="${bx.toFixed(1)}" y1="${boxY - 2}" x2="${bx.toFixed(1)}" y2="${boxY + BOX_H + 2}" stroke="${JUNCTION}" stroke-width="1.4"/>`);
    }
    // The label is kept INSIDE the canvas: a junction at the right-hand edge
    // (the one that closes a circular assembly) would otherwise be centred half
    // off the page, which the layout gate reports as clipped.
    const halfLabel = Math.max(textWidth(j.label, labelSize), textWidth(j.sub ?? "", labelSize)) / 2 + 1;
    const tx = Math.min(Math.max(bx, PAD_L + halfLabel), W - PAD_R - halfLabel);
    p.push(`<text x="${tx.toFixed(1)}" y="${(ly + 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="${JUNCTION}">${esc(j.label)}</text>`);
    if (j.sub) {
      p.push(`<text x="${tx.toFixed(1)}" y="${(ly + 18).toFixed(1)}" text-anchor="middle" font-size="9" fill="${INK}">${esc(j.sub)}</text>`);
    }
    // The leader starts BELOW the label it belongs to. Starting it at the
    // label's own baseline drew the line through the text, which the layout gate
    // reports as a strikethrough - and it looks exactly as bad as that sounds.
    const labelBottom = ly + (j.sub ? 21 : 11);
    if (labelBottom < boxY - 3) {
      // A straight drop when the label is over its junction. When the label was
      // clamped inwards (the junction that closes a circle, at the right-hand
      // edge) the leader is a proper dog-leg: down, across at a fixed height,
      // then down to the boundary. The previous version put the diagonal in the
      // last 3 px, which rendered as a tiny crooked stub against the edge.
      const dx = Math.abs(tx - bx);
      if (dx < 0.5) {
        p.push(`<line x1="${bx.toFixed(1)}" y1="${labelBottom.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${boxY - 3}" stroke="${RULE}" stroke-width="0.6"/>`);
      } else {
        const mid = (labelBottom + boxY - 3) / 2;
        p.push(
          `<polyline points="${tx.toFixed(1)},${labelBottom.toFixed(1)} ${tx.toFixed(1)},${mid.toFixed(1)} ${bx.toFixed(1)},${mid.toFixed(1)} ${bx.toFixed(1)},${(boxY - 3).toFixed(1)}" fill="none" stroke="${RULE}" stroke-width="0.6"/>`,
        );
      }
    }
  });

  // The closing junction of a circular assembly is named in the footer, not over
  // the row of part lengths: at the right-hand edge it collided with the last
  // part's length (the layout gate caught it).
  footLines.forEach((line, i) => {
    p.push(`<text x="${PAD_L}" y="${(footY + i * 11).toFixed(1)}" font-size="9" fill="${INK}">${esc(trueMinus(line))}</text>`);
  });
  p.push("</g></svg>");
  return p.join("");
}

/** The Golden Gate diagram: parts in order, each junction's fusion site named. */
export function goldenGateSvg(r: GoldenGateOk): string {
  // A destination vector is drawn as one of the boxes — it IS a piece of the
  // product — but in its own tint, because it is the one box that is not
  // amplified. Its two overhangs are already the labels on its two boundaries
  // (the fusion site of a box is drawn at its left edge, and the one that closes
  // the circle at the right-hand end), so the footer only has to name the
  // dropout that left.
  const vecName = r.destination?.name;
  const parts: DiagramPart[] = r.order.map((name, i) => ({
    name,
    length: r.partLengths[i],
    vector: vecName !== undefined && name === vecName,
  }));
  // Junction i joins part i to part i+1, and its fusion site is the FIRST
  // part's own 5′ end for the junction that closes the circle.
  const junctions: DiagramJunction[] = r.overhangs.map((_o, i) => ({
    label: r.overhangs[(i + 1) % r.overhangs.length].seq,
  }));
  const d = r.destination;
  const dest = d
    ? `destination vector “${d.name}” (green): body ${d.body.length.toLocaleString("en-US")} bp kept, ` +
      `dropout ${d.dropout.length.toLocaleString("en-US")} bp cut out with both ${r.enzyme.name} sites, ` +
      `vector overhangs ${d.overhang5} (5′) and ${d.overhang3} (3′) · `
    : "";
  return partsDiagramSvg(parts, junctions, {
    title: `Golden Gate with ${r.enzyme.name} (${r.enzyme.site})`,
    circular: true,
    junctionWord: "fusion site",
    footer: `${dest}Assembled product ${r.productLength.toLocaleString("en-US")} bp · ${r.overhangLength} nt fusion sites · box widths proportional to part length (short parts drawn at a minimum width)`,
  });
}

/** The Gibson diagram: fragments in order with the shared overlaps drawn. */
export function gibsonSvg(r: GibsonOk): string {
  const parts: DiagramPart[] = r.order.map((name, i) => ({ name, length: r.partLengths[i] }));
  const junctions: DiagramJunction[] = r.junctions.map((j) => ({
    label: `${j.length} nt`,
    sub: `${j.tm.refusal ? "no Tm" : `${j.tm.tm.toFixed(1)} °C`}`,
    overlap: true,
  }));
  return partsDiagramSvg(parts, junctions, {
    title: `Gibson / NEBuilder HiFi assembly, ${r.circular ? "circular" : "linear"}`,
    circular: r.circular,
    junctionWord: "overlap",
    footer: `Assembled product ${r.productLength.toLocaleString("en-US")} bp · red blocks are the shared overlaps · box widths proportional to fragment length`,
  });
}

/** The PCR amplicon map: the template, the region, and the two primers as arrows. */
export function primerMapSvg(r: PcrOk, templateLength: number): string {
  const W = 420;
  const H = 150;
  // Room at each end for the strand labels, so they never sit under a primer
  // arrow (an arrow starting at the region's first base used to cross the 5' of
  // the top strand).
  const PAD = 40;
  const span = Math.max(1, templateLength);
  const X = (bp: number): number => PAD + ((bp - 1) / span) * (W - 2 * PAD);
  const yT = 52;
  const xs = X(r.region.start);
  const xe = X(r.region.end);
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="${FONT}" font-size="9" fill="${INK}">`);
  p.push(`<text x="${PAD}" y="16" font-size="11" fill="${INK}">PCR primers: ${r.region.start.toLocaleString("en-US")}–${r.region.end.toLocaleString("en-US")} of a ${templateLength.toLocaleString("en-US")} bp template</text>`);

  // The template as a double line (two strands), the region shaded.
  p.push(`<rect x="${xs.toFixed(1)}" y="${yT - 7}" width="${Math.max(1, xe - xs).toFixed(1)}" height="14" fill="${PART_FILL}" stroke="none"/>`);
  p.push(`<line x1="${PAD}" y1="${yT - 4}" x2="${W - PAD}" y2="${yT - 4}" stroke="${INK}" stroke-width="1.1"/>`);
  p.push(`<line x1="${PAD}" y1="${yT + 4}" x2="${W - PAD}" y2="${yT + 4}" stroke="${INK}" stroke-width="1.1"/>`);
  // Strand labels OUTSIDE the drawn strands, vertically on the line they name.
  p.push(`<text x="${PAD - 6}" y="${yT - 1}" text-anchor="end" font-size="9" fill="${INK}">5′</text>`);
  p.push(`<text x="${PAD - 6}" y="${yT + 11}" text-anchor="end" font-size="9" fill="${INK}">3′</text>`);
  p.push(`<text x="${W - PAD + 6}" y="${yT - 1}" font-size="9" fill="${INK}">3′</text>`);
  p.push(`<text x="${W - PAD + 6}" y="${yT + 11}" font-size="9" fill="${INK}">5′</text>`);

  // Forward primer: an arrow on the top strand pointing right from the region start.
  const fw = Math.max(16, ((r.forward.anneal.length / span) * (W - 2 * PAD)) || 16);
  arrow(p, xs, yT - 16, Math.min(fw, (W - PAD) - xs), 1);
  p.push(placedLabel(`F ${r.forward.anneal.length} nt · ${r.forward.tm.tm.toFixed(1)} °C`, xs + 3, yT - 20, W, ARROW));
  // Reverse primer: an arrow on the bottom strand pointing left from the region end.
  const rw = Math.max(16, ((r.reverse.anneal.length / span) * (W - 2 * PAD)) || 16);
  arrow(p, xe, yT + 16, Math.min(rw, xe - PAD), -1);
  p.push(placedLabel(`R ${r.reverse.anneal.length} nt · ${r.reverse.tm.tm.toFixed(1)} °C`, xe - 3, yT + 30, W, ARROW, "end"));

  // The amplicon measure, under everything it measures.
  const yA = yT + 48;
  p.push(`<line x1="${xs.toFixed(1)}" y1="${yA}" x2="${xe.toFixed(1)}" y2="${yA}" stroke="${RULE}" stroke-width="0.9"/>`);
  p.push(`<line x1="${xs.toFixed(1)}" y1="${yA - 4}" x2="${xs.toFixed(1)}" y2="${yA + 4}" stroke="${RULE}" stroke-width="0.9"/>`);
  p.push(`<line x1="${xe.toFixed(1)}" y1="${yA - 4}" x2="${xe.toFixed(1)}" y2="${yA + 4}" stroke="${RULE}" stroke-width="0.9"/>`);
  p.push(placedLabel(`amplicon ${r.ampliconLength.toLocaleString("en-US")} bp`, (xs + xe) / 2, yA + 15, W, INK, "middle"));
  p.push(
    `<text x="${PAD}" y="${H - 8}" font-size="9" fill="${INK}">ΔTm ${trueMinus(r.deltaTm.toFixed(1))} °C · target ${r.targetTm.toFixed(0)} °C · nearest-neighbour, 50 mM Na⁺, 0.25 µM</text>`,
  );
  p.push("</g></svg>");
  return p.join("");
}

/**
 * A label that stays on the canvas.
 *
 * The PCR map's F, R and amplicon labels are anchored to the region, and a
 * region at either end of the template pushed them off the 420 px canvas (the
 * reviewer's repro: a region at 3,900–4,000 of a 4 kb template). The junction
 * labels in partsDiagramSvg were already clamped; these were not. The anchor is
 * FLIPPED near an edge rather than the text being slid along, so the label
 * still points at the thing it names: a start-anchored label that would run off
 * the right edge becomes end-anchored at the edge, and the mirror for the left.
 */
function placedLabel(
  text: string,
  x: number,
  y: number,
  W: number,
  colour: string,
  anchor: "start" | "middle" | "end" = "start",
  size = 9,
  pad = 4,
): string {
  const w = textWidth(text, size);
  let a = anchor;
  let px = x;
  const left = (ax: "start" | "middle" | "end", v: number): number => (ax === "start" ? v : ax === "middle" ? v - w / 2 : v - w);
  if (left(a, px) < pad) {
    a = "start";
    px = pad;
  }
  if (left(a, px) + w > W - pad) {
    a = "end";
    px = W - pad;
    if (left(a, px) < pad) {
      // Wider than the canvas: start it at the margin and let it be long
      // rather than silently centred somewhere it does not belong.
      a = "start";
      px = pad;
    }
  }
  return `<text x="${px.toFixed(1)}" y="${y.toFixed(1)}"${a === "start" ? "" : ` text-anchor="${a}"`} font-size="${size}" fill="${colour}">${esc(text)}</text>`;
}

/** A primer arrow: a shaft and a solid head, pointing right (+1) or left (−1). */
function arrow(p: string[], xFrom: number, y: number, len: number, dir: 1 | -1): void {
  const xTo = xFrom + dir * Math.max(12, len);
  const head = dir * 6;
  p.push(`<line x1="${xFrom.toFixed(1)}" y1="${y}" x2="${(xTo - head).toFixed(1)}" y2="${y}" stroke="${ARROW}" stroke-width="1.6"/>`);
  p.push(
    `<path d="M ${xTo.toFixed(1)} ${y} L ${(xTo - head).toFixed(1)} ${y - 3.4} L ${(xTo - head).toFixed(1)} ${y + 3.4} Z" fill="${ARROW}"/>`,
  );
}
