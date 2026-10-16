// Okabe-Ito categorical palette, with a marker shape and a dash pattern per series so
// a figure still separates its series in greyscale print and for colour-blind readers.
//
// SOURCE OF THE COLOURS. Okabe M. & Ito K., "Color Universal Design (CUD): How to make
// figures and presentations that are friendly to Colorblind people", J*Fly,
// https://jfly.uni-koeln.de/color/ , Fig. 16 "Colorblind barrier-free color pallet"
// (image/pallete.jpg, read 2026-10-14), R,G,B (0-255):
//   Black (0,0,0)        Orange (230,159,0)    Sky Blue (86,180,233)  bluish Green (0,158,115)
//   Yellow (240,228,66)  Blue (0,114,178)      Vermilion (213,94,0)   reddish Purple (204,121,167)
//
// VALIDATION. Run through the `dataviz` skill's validator (scripts/validate_palette.js,
// Machado, Oliveira & Fernandes 2009 CVD matrices at severity 1.0, distances in OKLab
// x100) against the white figure surface, on 2026-10-14. Verbatim, default order below:
//
//   node validate_palette.js "#0072B2,#D55E00,#CC79A7,#E69F00,#56B4E9,#009E73" --mode light --surface "#ffffff"
//     [PASS] Lightness band         all 6 inside L 0.43–0.77
//     [PASS] Chroma floor           all 6 >= 0.1
//     [PASS] CVD separation         worst adjacent #CC79A7↔#D55E00 ΔE 15.8 (deutan) · tritan 8.5
//     [PASS] Normal-vision floor    worst adjacent #CC79A7↔#D55E00 ΔE 16.4 (normal)
//     [WARN] Contrast vs surface    below 3:1 — relief required (visible labels or table view): [["#E69F00",2.25],["#56B4E9",2.31]]
//     → ALL CHECKS PASS
//   ... same, --pairs all:
//     [WARN] CVD separation         worst all-pairs #009E73↔#CC79A7 ΔE 7.6 (deutan) · tritan 8.5
//     [PASS] Normal-vision floor    worst all-pairs #E69F00↔#D55E00 ΔE 15.6 (normal)
//     → ALL CHECKS PASS
//
// MINIMUM PAIRWISE ΔE UNDER CVD SIMULATION: 7.6 (bluish green vs reddish purple, deutan).
// That is inside the validator's 6-8 "floor band", which it calls legal ONLY with
// secondary encoding. This module supplies that encoding: every series gets its own
// marker shape and dash pattern (seriesStyle), so the redundancy is not optional. The
// order above maximises the worst ADJACENT pair (15.8, found by trying all 120 orders
// that start with blue), which is what a legend and neighbouring bars show.
//
// WHY 6, NOT 8. Yellow (#F0E442, OKLCH L 0.902) and black (L 0, chroma 0) FAIL the
// validator's lightness band and chroma floor: yellow is 1.32:1 against white, nearly
// invisible as a line, and black reads as an axis rather than a category. They are kept
// as OKABE_ITO_EXTRAS for callers that need 7-8 series and accept the stated cost.
//
// The ΔE numbers are not just quoted: cvdDeltaE() below reimplements the validator's
// conversion (same sRGB linearisation, same clamping, same OKLab matrices) and the test
// suite recomputes 7.6 and 15.8 from it.

/** The eight Okabe-Ito colours by their published names (Fig. 16, see header). */
export const OKABE_ITO = {
  black: "#000000", // (0,0,0)
  orange: "#E69F00", // (230,159,0)
  skyBlue: "#56B4E9", // (86,180,233)
  bluishGreen: "#009E73", // (0,158,115)
  yellow: "#F0E442", // (240,228,66)
  blue: "#0072B2", // (0,114,178)
  vermilion: "#D55E00", // (213,94,0)
  reddishPurple: "#CC79A7", // (204,121,167)
} as const;

/** Default categorical order: validated above, worst adjacent CVD ΔE 15.8. */
export const CATEGORICAL_PALETTE: readonly string[] = [
  OKABE_ITO.blue,
  OKABE_ITO.vermilion,
  OKABE_ITO.reddishPurple,
  OKABE_ITO.orange,
  OKABE_ITO.skyBlue,
  OKABE_ITO.bluishGreen,
];

/** Slots 7-8 if a caller must exceed six colours. These FAIL the validator; see header. */
export const OKABE_ITO_EXTRAS: readonly string[] = [OKABE_ITO.black, OKABE_ITO.yellow];

export type MarkerShape = "circle" | "square" | "triangle" | "diamond" | "triangleDown" | "cross";

/** Six shapes, distinguishable at 3 px radius without colour. */
export const SERIES_MARKERS: readonly MarkerShape[] = ["circle", "square", "triangle", "diamond", "triangleDown", "cross"];

/**
 * Dash patterns (stroke-dasharray, in units of stroke width at the default 1.5 px).
 * Same six as the patent style's USPTO_DASHES so a series looks alike in both modes.
 */
export const SERIES_DASHES: readonly string[] = ["", "7 3", "2.5 2.5", "9 3 2.5 3", "12 4", "5 4 1.5 4"];

export interface SeriesStyle {
  color: string;
  marker: MarkerShape;
  /** false = hollow marker (white fill, coloured outline). */
  filled: boolean;
  /** "" = solid. */
  dash: string;
}

/**
 * Style of series i. Colour, marker and dash all cycle with period 6 and the fill flips
 * every 6, so series 0-11 are all distinct even in greyscale; colour is never the only cue.
 * `grey` drops the colour to black (greyscale-safe print preview) and keeps the rest.
 */
export function seriesStyle(i: number, opts: { grey?: boolean } = {}): SeriesStyle {
  const k = Number.isFinite(i) && i >= 0 ? Math.floor(i) : 0;
  return {
    color: opts.grey ? "#000000" : CATEGORICAL_PALETTE[k % CATEGORICAL_PALETTE.length],
    marker: SERIES_MARKERS[k % SERIES_MARKERS.length],
    filled: Math.floor(k / SERIES_MARKERS.length) % 2 === 0,
    dash: SERIES_DASHES[k % SERIES_DASHES.length],
  };
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** SVG for a series marker centred on (cx, cy), radius r. */
export function seriesMarkerSvg(style: SeriesStyle, cx: number, cy: number, r = 3): string {
  const fill = style.filled ? style.color : "#fff";
  const paint = `fill="${fill}" stroke="${style.color}" stroke-width="1"`;
  const x = cx;
  const y = cy;
  switch (style.marker) {
    case "circle":
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" ${paint}/>`;
    case "square":
      return `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${2 * r}" height="${2 * r}" ${paint}/>`;
    case "triangle":
      return `<path d="M${f1(x)},${f1(y - r - 0.5)} L${f1(x + r + 0.5)},${f1(y + r)} L${f1(x - r - 0.5)},${f1(y + r)} Z" ${paint}/>`;
    case "triangleDown":
      return `<path d="M${f1(x)},${f1(y + r + 0.5)} L${f1(x + r + 0.5)},${f1(y - r)} L${f1(x - r - 0.5)},${f1(y - r)} Z" ${paint}/>`;
    case "diamond":
      return `<path d="M${f1(x)},${f1(y - r - 0.8)} L${f1(x + r + 0.8)},${f1(y)} L${f1(x)},${f1(y + r + 0.8)} L${f1(x - r - 0.8)},${f1(y)} Z" ${paint}/>`;
    default: {
      // A cross has no area; "hollow" is drawn thinner so the fill flip still shows.
      const sw = style.filled ? 1.6 : 0.9;
      return `<path d="M${f1(x - r)},${f1(y - r)} L${f1(x + r)},${f1(y + r)} M${f1(x - r)},${f1(y + r)} L${f1(x + r)},${f1(y - r)}" fill="none" stroke="${style.color}" stroke-width="${sw}"/>`;
    }
  }
}

// ---------------------------------------------------------------------------
// CVD simulation and ΔE, matching the dataviz validator exactly
// ---------------------------------------------------------------------------

export type CvdKind = "protan" | "deutan" | "tritan";

/** Machado, Oliveira & Fernandes (2009), severity 1.0, linear RGB (as in validate_palette.js). */
const MACHADO: Record<CvdKind, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function hexToLinear(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new RangeError(`not a #rrggbb colour: "${hex}"`);
  const s2l = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [0, 2, 4].map((i) => s2l(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

/** Björn Ottosson's OKLab from linear sRGB (same constants as the validator). */
function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(hex: string, kind?: CvdKind): [number, number, number] {
  const c = hexToLinear(hex);
  if (!kind) return c;
  const M = MACHADO[kind];
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  return M.map((row) => clamp(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])) as [number, number, number];
}

/** OKLab Euclidean distance x100 between two colours, optionally under simulated CVD. */
export function cvdDeltaE(a: string, b: string, kind?: CvdKind): number {
  const p = oklab(simulate(a, kind));
  const q = oklab(simulate(b, kind));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export interface WorstPair {
  a: string;
  b: string;
  kind: CvdKind | "normal";
  deltaE: number;
}

/** Worst pair over all pairs (or adjacent pairs only) under the given simulations. */
export function worstPair(palette: readonly string[], kinds: (CvdKind | "normal")[], pairs: "all" | "adjacent" = "all"): WorstPair | null {
  let worst: WorstPair | null = null;
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      if (pairs === "adjacent" && j !== i + 1) continue;
      for (const k of kinds) {
        const d = cvdDeltaE(palette[i], palette[j], k === "normal" ? undefined : k);
        if (!worst || d < worst.deltaE) worst = { a: palette[i], b: palette[j], kind: k, deltaE: d };
      }
    }
  }
  return worst;
}
