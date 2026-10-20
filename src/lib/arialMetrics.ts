/**
 * Advance widths of Arial / Helvetica (metric-compatible faces), in thousandths of an em, from
 * Adobe's Helvetica AFM (Helvetica.afm / Helvetica-Bold.afm, the Core 14 metrics). A pure library
 * cannot measure a font, and an estimate of "0.55 em a character" is how condition text overruns the
 * arrow it sits on: the scheme layout (scheme.ts) sizes its arrows and captions from these widths.
 *
 * Characters not in the table count as the widest lowercase letter (m), so an unknown glyph makes
 * text measure long, never short.
 */

const REGULAR: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
  "°": 400, "±": 584, "×": 584, "÷": 584, "µ": 556, "μ": 556, "·": 278, "–": 556, "—": 1000, "−": 584, "′": 191, "″": 355, "’": 222, "‘": 222, "“": 333, "”": 333, "→": 1000, "Δ": 612, "α": 578, "β": 575, "γ": 500, "δ": 556, "λ": 500, "π": 556, "σ": 556, "ν": 500, "η": 556, "χ": 500,
};

/** Helvetica-Bold differs from the regular face; the scheme labels are bold digits, letters and primes. */
const BOLD: Record<string, number> = {
  ...REGULAR,
  " ": 278, "(": 333, ")": 333, ",": 278, "-": 333, ".": 278, "'": 238, "′": 238, "″": 474,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};

const UNKNOWN = 833;

/** The advance width of `text` set in Arial at `sizePt`, in points. */
export function textWidthPt(text: string, sizePt: number, bold = false): number {
  const table = bold ? BOLD : REGULAR;
  let w = 0;
  for (const ch of text) w += table[ch] ?? UNKNOWN;
  return (w / 1000) * sizePt;
}
