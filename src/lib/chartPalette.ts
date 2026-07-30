// Colour ramps for magnitude and polarity, taken from a validated palette.
//
// These are NOT hand-picked. Every value below is a documented step from the
// reference palette in the `dataviz` skill, and the ramp was run through that
// skill's validator rather than eyeballed. What it reported, verbatim, for the
// seven sequential steps on the light chart surface in ordinal mode:
//
//     [PASS] Lightness monotone     steps read light->dark
//     [PASS] Adjacent ΔL            all gaps >= 0.06
//     [PASS] Single hue             hue spread 4°
//     [FAIL] Light-end contrast     #cde2fb at 1.29:1 vs surface — below 2:1 floor
//
// That last one is expected and permitted HERE, and the distinction matters. The
// palette's own note: "The full 100→700 range is for sequential encoding
// (continuous magnitude — heatmaps, choropleths) where the lightest step means
// 'near zero' and is allowed to recede toward the surface. For an ordinal ramp
// (discrete ordered marks — funnel stages, tiers) the step nearest the surface must
// still clear 2:1." A heat map is the sequential case. The relief the skill requires
// for a sub-3:1 mark is secondary encoding, which the renderer provides: the numeric
// value is printed in each cell where it fits, and a colour bar with numeric ticks
// always accompanies the grid.
//
// Running the validator in its default (categorical) mode also reports failures —
// lightness band, chroma floor, normal-vision ΔE. Those are the checks for colours
// that carry IDENTITY, and the validator says so itself on its last line: "scope:
// categorical palettes only ... for a sequential ramp, lightness monotonicity."
// A ramp encoding magnitude is deliberately low-chroma at one end and deliberately
// has small steps between neighbours; that is what continuous means.
//
// THE RULE THAT MATTERS MOST, and the one a heat map usually breaks: sequential is
// ONE HUE, light to dark. Diverging is TWO hues with a NEUTRAL GREY midpoint. Never
// a rainbow, and never a hue at the diverging midpoint — a rainbow ramp implies
// ordering the eye cannot recover (is green more or less than yellow?) and invents
// boundaries where the data has none.

/** Sequential: blue, steps 100 → 700. Magnitude, light = low. */
export const SEQUENTIAL_BLUE = [
  "#cde2fb", // 100
  "#b7d3f6", // 150
  "#9ec5f4", // 200
  "#86b6ef", // 250
  "#6da7ec", // 300
  "#5598e7", // 350
  "#3987e5", // 400
  "#2a78d6", // 450
  "#256abf", // 500
  "#1c5cab", // 550
  "#184f95", // 600
  "#104281", // 650
  "#0d366b", // 700
] as const;

/**
 * Diverging: blue ↔ red about a NEUTRAL GREY midpoint.
 *
 * The midpoint `#f0efec` is the documented neutral, and it has to be neutral: a hue
 * in the middle of a diverging ramp reads as a third category rather than as
 * "nothing", which is why the palette records that blue↔aqua was rejected — both
 * cool, so the middle did not read as zero.
 *
 * The warm arm is anchored on the documented red `#e34948` and continued to a dark
 * red by matching the blue arm's lightness progression, so the two arms are
 * symmetric in lightness — equal visual weight either side of zero, which is the
 * whole point of a diverging scale. Computed from the documented anchors, not
 * sampled by eye.
 */
export const DIVERGING_MIDPOINT = "#f0efec";
export const DIVERGING_WARM = [
  "#f7d8d2",
  "#f3bdb4",
  "#eea296",
  "#e9877a",
  "#e66b60",
  "#e34948", // documented red anchor
  "#c93c3d",
  "#ae3033",
  "#932528",
  "#781a1e",
] as const;
export const DIVERGING_COOL = [
  "#d9e7fb",
  "#bcd5f7",
  "#9ec5f4",
  "#7fb0f0",
  "#5f9beb",
  "#3987e5", // documented blue anchor
  "#2f72c4",
  "#265ea3",
  "#1c4a82",
  "#133661",
] as const;

/**
 * Greyscale, for the black-and-white figure mode this product already supports.
 *
 * A printed heat map is the ordinary case here, not an edge case: these figures go
 * into documents that get photocopied. Lightness alone carries the whole encoding,
 * which is exactly what a sequential ramp is for — and it is why the ramp above is
 * chosen for monotone lightness rather than for hue variety.
 */
export const SEQUENTIAL_GREY = [
  "#f2f2f0", "#e2e2df", "#d0d0cc", "#bcbcb7", "#a7a7a1",
  "#91918b", "#7a7a74", "#63635e", "#4d4d49", "#373734", "#232321",
] as const;

/** Chart chrome, from the same palette instance. */
export const INK = {
  surface: "#fcfcfb",
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
} as const;

/** Relative luminance, for deciding whether text on a cell should be light or dark. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const to = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * to(0) + 0.7152 * to(2) + 0.0722 * to(4);
}

/**
 * Ink that stays legible on a given cell colour.
 *
 * Not a nicety: a heat map prints its numbers INSIDE the cells, and the dark end of
 * a sequential ramp is dark enough that black text on it is unreadable.
 *
 * THE THRESHOLD IS DERIVED, NOT CHOSEN. White wins when 1.05/(L+0.05) exceeds
 * (L+0.05)/0.05, and the two are equal at (L+0.05)^2 = 0.0525, so the crossover is
 * L = sqrt(0.0525) - 0.05 = 0.1791. Anything above it takes black.
 *
 * The first version of this used 0.36, picked by eye, and it was wrong in the middle
 * of the ramp: the mid-blue #5598e7 has L = 0.302, so it took WHITE text at 2.98:1
 * where black would have given 7.04:1. Caught by this file's own test asserting every
 * step of every ramp clears 3:1 — which is the kind of check that only works if it
 * sweeps the whole ramp rather than its ends.
 */
const INK_CROSSOVER_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

export function inkOn(hex: string): string {
  return relativeLuminance(hex) > INK_CROSSOVER_LUMINANCE ? INK.primary : "#ffffff";
}

/** Linear interpolation between two hex colours, in sRGB. */
function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const ch = (p: string, i: number): number => parseInt(p.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => {
    const v = Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

/** Samples a ramp at `t` in [0, 1], interpolating between its documented steps. */
export function sampleRamp(ramp: readonly string[], t: number): string {
  if (!ramp.length) return INK.muted;
  if (!Number.isFinite(t)) return INK.muted;
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (ramp.length - 1);
  const i = Math.floor(pos);
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  return mixHex(ramp[i], ramp[i + 1], pos - i);
}

export type HeatScale = "sequential" | "diverging";

/**
 * The colour for one value, given the scale in use and the data's range.
 *
 * A DIVERGING SCALE MUST BE SYMMETRIC ABOUT ITS MIDPOINT. If the arms are scaled
 * independently — low mapped across the cool arm, high across the warm arm — then
 * −1 and +100 come out equally saturated and the reader is told they are equally
 * extreme. So the half-range is the larger of |min| and |max| and both arms use it,
 * which means an asymmetric data set correctly shows one arm barely used.
 */
export function heatColour(
  value: number,
  min: number,
  max: number,
  scale: HeatScale,
  midpoint: number,
  grey: boolean,
): string {
  if (!Number.isFinite(value)) return INK.surface;

  if (scale === "diverging") {
    const half = Math.max(Math.abs(max - midpoint), Math.abs(midpoint - min));
    if (!(half > 0)) return grey ? SEQUENTIAL_GREY[0] : DIVERGING_MIDPOINT;
    const t = (value - midpoint) / half; // -1 .. +1
    if (grey) {
      // In greyscale a diverging scale cannot show WHICH side of the midpoint a
      // value is on — lightness has only one dimension. Magnitude of the deviation
      // is the honest thing to encode, and the renderer says so in the legend.
      return sampleRamp(SEQUENTIAL_GREY, Math.abs(t));
    }
    if (t >= 0) return sampleRamp([DIVERGING_MIDPOINT, ...DIVERGING_WARM], t);
    return sampleRamp([DIVERGING_MIDPOINT, ...DIVERGING_COOL], -t);
  }

  const span = max - min;
  const t = span > 0 ? (value - min) / span : 0.5;
  return sampleRamp(grey ? SEQUENTIAL_GREY : SEQUENTIAL_BLUE, t);
}
