// The agarose gel figure.
//
// It has to read as a PUBLISHED GEL SCHEMATIC, not as a bar chart turned
// sideways: straight parallel lanes of equal width, wells in a row at the top
// with clear gel below them, uniform band height, the ladder sizes labelled
// down the left with leader lines that never touch a band, and a caption that
// says the positions are interpolated. Two styles, because both are what
// people paste into a paper: dark bands on light lanes (line art, which is what
// a patent figure wants) and light bands on a dark lane ("ethidium", which is
// what the camera shows).
//
// No two band rectangles in one lane ever overlap: gel.ts merges anything
// closer than GEL_MIN_BAND_GAP_PX before this file sees it (a printed doublet
// such as NEB's "500/517" is one band, labelled as NEB prints it), and
// cloningCases.test.ts parses this SVG to prove it.
//
// Colours are literal hex, never a CSS variable or the inherited-colour keyword:
// this artwork goes into a Word document and must not follow the pane's theme.

import { GEL_BAND_PX, GEL_RUN_PX, GelModel, PlacedLane, bandText, ladderBandLabel } from "./gel";

const PAPER = "#ffffff";
const INK = "#111111";
const RULE = "#888888";
const LANE_LIGHT = "#f4f4f4";
const LANE_DARK = "#17181a";
const BAND_DARK = "#111111";
const BAND_LIGHT = "#f2f2f2";
const WELL = "#555555";
const FONT = "Arial, Helvetica, sans-serif";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Geometry, in one place so the caption and the drawing cannot disagree. */
const LABEL_W = 60;
const LANE_W = 34;
const LANE_GAP = 9;
const RIGHT_PAD = 16;
const TITLE_H = 30;
const WELL_TOP = 2;
const WELL_H = 6;
/** Clear gel between the bottom of the well and the top of the highest band. */
const WELL_CLEARANCE = 6;
const BAND_H = GEL_BAND_PX;
/** Room under the lowest band for an off-scale marker. */
const BOTTOM_ROOM = 12;
/** Lane height: well, clearance, the full run, the bottom room. */
const RUN_H = WELL_TOP + WELL_H + WELL_CLEARANCE + BAND_H / 2 + GEL_RUN_PX + BAND_H / 2 + BOTTOM_ROOM;
/** Smallest gap between two ladder LABELS; closer than this and the label is offset. */
const LABEL_PITCH = 11;
const LANE_FONT = 9;
/** Width per character at 9 px Arial, the figure-layout auditor's own estimate. */
const CHAR_W = LANE_FONT * 0.58;

export interface GelSvgOptions {
  /** Figure title above the gel. */
  title?: string;
}

const DEFAULT_TITLE = "Agarose gel (schematic)";

/** The text over each lane: "Ladder" for the ladder, the user's name, never truncated. */
function laneLabels(model: GelModel): string[] {
  return model.lanes.map((l) => (l.isLadder ? "Ladder" : l.name.trim()));
}

/**
 * Lane labels go vertical when ANY of them is wider than its slot (the lane
 * plus the gap beside it) — all of them, so the row reads as one row. This is
 * statchart.ts's rule: -90 degrees, centred on the anchor, so the layout auditor
 * measures the rectangle a reader sees. Nothing is truncated: a name the user
 * typed is part of the figure.
 */
function headLayout(model: GelModel): { rotate: boolean; head: number } {
  const labels = laneLabels(model);
  const widest = Math.max(0, ...labels.map((s) => s.length * CHAR_W));
  const rotate = widest > LANE_W + LANE_GAP - 2;
  // Horizontal: one text row. Vertical: the longest label's length.
  const head = rotate ? Math.ceil(widest) + 12 : 18;
  return { rotate, head };
}

function canvas(model: GelModel, title: string): { W: number; H: number; gelTop: number; rotate: boolean } {
  const n = Math.max(1, model.lanes.length);
  const { rotate, head } = headLayout(model);
  const W = Math.max(LABEL_W + n * LANE_W + (n - 1) * LANE_GAP + RIGHT_PAD, Math.ceil(title.length * 11 * 0.58) + 2 * LANE_GAP + 8);
  const gelTop = TITLE_H + head;
  return { W, H: gelTop + RUN_H + 22, gelTop, rotate };
}

export function gelSvg(model: GelModel, opts: GelSvgOptions = {}): string {
  const lanes = model.lanes;
  const title = opts.title ?? DEFAULT_TITLE;
  const { W, H, gelTop, rotate } = canvas(model, title);
  const dark = model.style === "ethidium";
  const laneFill = dark ? LANE_DARK : LANE_LIGHT;
  const bandColour = dark ? BAND_LIGHT : BAND_DARK;
  const wellBottom = gelTop + WELL_TOP + WELL_H;
  // The highest band CENTRE: below the well by the clearance plus half a band,
  // so even the largest ladder band never touches the well.
  const firstCentre = wellBottom + WELL_CLEARANCE + BAND_H / 2;
  const laneX = (i: number): number => LABEL_W + i * (LANE_W + LANE_GAP);
  const bandY = (pos: number): number => firstCentre + Math.max(0, Math.min(1, pos)) * GEL_RUN_PX;
  const labels = laneLabels(model);

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="${FONT}" font-size="9" fill="${INK}">`);
  p.push(`<text x="${LANE_GAP}" y="16" font-size="11" fill="${INK}">${esc(title)}</text>`);

  // The lanes: equal width, equal spacing.
  lanes.forEach((_lane, i) => {
    const x = laneX(i);
    const cx = x + LANE_W / 2;
    p.push(`<rect x="${x}" y="${gelTop}" width="${LANE_W}" height="${RUN_H}" fill="${laneFill}" stroke="${RULE}" stroke-width="0.6"/>`);
    // The well, drawn as an outlined slot at the top of the lane.
    p.push(
      `<rect class="well" x="${x + 3}" y="${gelTop + WELL_TOP}" width="${LANE_W - 6}" height="${WELL_H}" fill="${WELL}" fill-opacity="${dark ? 0.75 : 0.22}" stroke="${RULE}" stroke-width="0.6"/>`,
    );
    if (rotate) {
      const len = labels[i].length * CHAR_W;
      const ly = gelTop - 6 - len / 2;
      p.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="${LANE_FONT}" fill="${INK}" ` +
          `transform="rotate(-90 ${cx.toFixed(1)} ${ly.toFixed(1)})">${esc(labels[i])}</text>`,
      );
    } else {
      p.push(`<text x="${cx}" y="${gelTop - 6}" text-anchor="middle" font-size="${LANE_FONT}" fill="${INK}">${esc(labels[i])}</text>`);
    }
    // Lane number under the gel: the figure is referred to by lane number in the text.
    p.push(`<text x="${cx}" y="${gelTop + RUN_H + 14}" text-anchor="middle" font-size="9" fill="${INK}">${i + 1}</text>`);
  });

  // The bands.
  lanes.forEach((lane, i) => {
    const x = laneX(i);
    for (const b of lane.bands) {
      // An off-scale band is nudged clear of the well (above) or the gel's
      // bottom edge (below) so its marker triangle has room; its POSITION is
      // already declared not to scale, and the nudge is only legibility.
      const nudge = b.offScale === "above" ? 5 : b.offScale === "below" ? -2 : 0;
      const y = bandY(b.pos) - BAND_H / 2 + nudge;
      const op = Math.max(0.25, Math.min(1, b.intensity)).toFixed(2);
      p.push(
        `<rect class="band" x="${x + 2}" y="${y.toFixed(2)}" width="${LANE_W - 4}" height="${BAND_H}" fill="${bandColour}" fill-opacity="${op}"/>`,
      );
      // An off-scale band is marked, so nobody reads its position as a measurement.
      if (b.offScale) {
        const cx = x + LANE_W / 2;
        const ty = b.offScale === "above" ? y - 2 : y + BAND_H + 2;
        const dir = b.offScale === "above" ? -1 : 1;
        p.push(
          `<path d="M ${cx} ${(ty + dir * 4.5).toFixed(1)} L ${cx - 3.2} ${ty.toFixed(1)} L ${cx + 3.2} ${ty.toFixed(1)} Z" fill="${dark ? BAND_LIGHT : INK}"/>`,
        );
      }
    }
  });

  // Ladder labels down the left, with leader lines. Labels are pushed apart
  // when two ladder bands are closer than the type can be, and the leader line
  // then shows which band each label belongs to — a label touching a band, or
  // two labels overlapping, is the defect this avoids.
  const ladder = lanes[0];
  if (ladder?.isLadder) {
    const rows = ladder.bands.map((b) => ({ y: bandY(b.pos), text: ladderBandLabel(b.sizes) })).sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const r of rows) {
      const ly = Math.max(r.y, prev + LABEL_PITCH);
      prev = ly;
      p.push(`<text x="${LABEL_W - 13}" y="${(ly + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${INK}">${esc(r.text)}</text>`);
      // A leader from the label to the band's own height, kinked when offset.
      const x0 = LABEL_W - 10;
      const x1 = LABEL_W - 2;
      p.push(
        Math.abs(ly - r.y) < 0.5
          ? `<line x1="${x0}" y1="${r.y.toFixed(1)}" x2="${x1}" y2="${r.y.toFixed(1)}" stroke="${RULE}" stroke-width="0.7"/>`
          : `<polyline points="${x0},${ly.toFixed(1)} ${(x0 + 4).toFixed(1)},${ly.toFixed(1)} ${(x1 - 1).toFixed(1)},${r.y.toFixed(1)} ${x1},${r.y.toFixed(1)}" fill="none" stroke="${RULE}" stroke-width="0.7"/>`,
      );
    }
    p.push(`<text x="${LABEL_W - 13}" y="${gelTop - 6}" text-anchor="end" font-size="9" fill="${INK}">bp</text>`);
  }

  p.push("</g></svg>");
  return p.join("");
}

/** The alt text: a figure a screen reader cannot read is not accessible artwork. */
export function gelAlt(model: GelModel): string {
  const parts = model.lanes.map((l: PlacedLane, i) =>
    l.isLadder
      ? `lane ${i + 1} ${l.name}`
      : `lane ${i + 1} ${l.name}: ${l.bands.length ? l.bands.map((b) => bandText(b)).join(", ") : "no bands"}`,
  );
  return `Schematic agarose gel. ${parts.join("; ")}.`;
}

/** Figure size, for the caller that sizes the inserted image. Same arithmetic as the drawing. */
export function gelSize(model: GelModel, title = DEFAULT_TITLE): { width: number; height: number } {
  const { W, H } = canvas(model, title);
  return { width: W, height: H };
}
