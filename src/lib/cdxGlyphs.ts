/**
 * Where text and small marks on a ChemDraw page are drawn — ONE model shared by the renderer (cdxmlRender), the
 * editor (cdxmlEdit: the label boxes it writes) and the mechanism-arrow planner (cdxArrows), so an arrow is kept off
 * exactly the ink that is drawn and a charge sits a set gap from its label's letters, not from an estimate.
 *
 * Glyph metrics: Arial's own (the face the page's labels are drawn in; Helvetica's advances are identical), read from
 * the glyf / hmtx tables of Windows' arial.ttf (unitsPerEm 2048) with fontTools and scaled to thousandths of an em:
 * advance, then the ink box xMin, yMin, xMax, yMax (y up from the baseline). The advances agree with Adobe's Helvetica
 * AFM table in arialMetrics.ts for every ASCII character.
 */
import type { Box, CdxDoc, CdxNode, CdxRun, CdxStyle, CdxText, Pt } from "./cdxml";

type Metric = readonly [number, number, number, number, number] | readonly [number];
const ARIAL: Record<string, Metric> = {
  " ": [278], "!": [278, 86, 0, 195, 716], '"': [355, 46, 462, 308, 716], "#": [556, 10, -12, 543, 728], $: [556, 36, -103, 509, 782], "%": [889, 58, -26, 828, 728],
  "&": [667, 43, -17, 644, 728], "'": [191, 44, 462, 144, 716], "(": [333, 61, -210, 297, 728], ")": [333, 61, -210, 297, 728], "*": [389, 31, 423, 354, 728],
  "+": [584, 56, 116, 528, 589], ",": [278, 83, -142, 189, 100], "-": [333, 32, 215, 302, 303], ".": [278, 91, 0, 191, 100], "/": [278, 0, -12, 278, 728],
  "0": [556, 42, -12, 508, 719], "1": [556, 109, 0, 373, 719], "2": [556, 29, 0, 503, 719], "3": [556, 42, -13, 511, 719], "4": [556, 13, 0, 508, 716],
  "5": [556, 42, -12, 516, 706], "6": [556, 38, -12, 510, 719], "7": [556, 47, 0, 511, 707], "8": [556, 41, -12, 512, 719], "9": [556, 42, -12, 512, 719],
  ":": [278, 90, 0, 190, 519], ";": [278, 83, -142, 189, 519], "<": [584, 55, 110, 529, 595], "=": [584, 56, 204, 528, 503], ">": [584, 55, 110, 529, 595],
  "?": [556, 44, 0, 506, 728], "@": [1015, 54, -210, 979, 729],
  A: [667, -1, 0, 668, 716], B: [667, 73, 0, 614, 716], C: [722, 50, -12, 683, 728], D: [722, 77, 0, 669, 716], E: [667, 79, 0, 613, 716], F: [611, 82, 0, 565, 716],
  G: [778, 53, -12, 715, 728], H: [722, 80, 0, 642, 716], I: [278, 93, 0, 188, 716], J: [500, 27, -12, 422, 716], K: [667, 73, 0, 665, 716], L: [556, 73, 0, 521, 716],
  M: [833, 74, 0, 757, 716], N: [722, 76, 0, 640, 716], O: [778, 48, -12, 733, 729], P: [667, 77, 0, 624, 716], Q: [778, 43, -56, 741, 729], R: [722, 79, 0, 709, 716],
  S: [667, 45, -12, 615, 728], T: [611, 23, 0, 591, 716], U: [722, 79, -12, 642, 716], V: [667, 4, 0, 659, 716], W: [944, 12, 0, 933, 716], X: [667, 4, 0, 661, 716],
  Y: [667, 3, 0, 659, 716], Z: [611, 20, 0, 586, 716],
  "[": [278, 68, -199, 262, 716], "\\": [278, 0, -12, 278, 728], "]": [278, 19, -199, 213, 716], "^": [469, 26, 337, 443, 728], _: [556, -15, -199, 567, -135], "`": [333, 43, 583, 227, 720],
  a: [556, 36, -12, 514, 530], b: [556, 65, -12, 515, 716], c: [500, 39, -12, 491, 530], d: [556, 34, -12, 484, 716], e: [556, 37, -12, 515, 530], f: [278, 9, 0, 312, 728],
  g: [556, 32, -210, 489, 530], h: [556, 66, 0, 488, 716], i: [222, 66, 0, 154, 716], j: [222, -46, -210, 153, 716], k: [500, 66, 0, 496, 716], l: [222, 64, 0, 152, 716],
  m: [833, 66, 0, 769, 530], n: [556, 66, 0, 487, 530], o: [556, 33, -12, 519, 530], p: [556, 66, -199, 516, 530], q: [556, 35, -199, 484, 530], r: [333, 65, 0, 347, 530],
  s: [500, 31, -12, 461, 530], t: [278, 18, -7, 271, 700], u: [556, 64, -12, 484, 519], v: [500, 13, 0, 488, 519], w: [722, 3, 0, 714, 519], x: [500, 7, 0, 493, 519],
  y: [500, 16, -210, 491, 519], z: [500, 20, 0, 479, 519],
  "{": [334, 28, -210, 311, 728], "|": [260, 92, -210, 168, 728], "}": [334, 23, -210, 306, 728], "~": [584, 42, 272, 542, 432],
  "°": [400, 62, 457, 333, 728], "±": [549, 38, 0, 511, 600], "×": [584, 79, 141, 504, 566], "·": [333, 116, 311, 216, 411], "•": [350, 53, 227, 301, 474],
  "–": [556, -2, 224, 554, 294], "—": [1000, 0, 224, 1000, 294], "−": [584, 56, 312, 528, 394], "′": [188, 62, 462, 194, 716], "″": [354, 62, 462, 333, 716],
  "’": [222, 53, 489, 155, 723], "‘": [222, 62, 494, 165, 728], "→": [1000, 39, 77, 961, 428], "Δ": [668, -1, 0, 669, 716],
  "α": [578, 35, -12, 541, 530], "β": [575, 68, -199, 530, 728], "γ": [500, 12, -199, 488, 519], "δ": [557, 35, -12, 521, 716], "λ": [500, 12, 0, 487, 716],
  "μ": [576, 78, -199, 497, 519], "µ": [576, 78, -199, 497, 519], "π": [690, 22, 0, 668, 519], "σ": [617, 33, -12, 595, 530], "ν": [500, 13, 0, 488, 519], "η": [556, 68, -199, 489, 530],
};
/** A character not in the table: measured as the widest lowercase letter over the full height (long, never short). */
const UNKNOWN: Metric = [833, 0, -210, 833, 729];

/** A character's advance and ink box in ems (ink null for a space). */
export function glyph(ch: string): { adv: number; ink: [number, number, number, number] | null } {
  const m = ARIAL[ch] ?? UNKNOWN;
  return { adv: m[0] / 1000, ink: m.length === 5 ? [m[1] / 1000, m[2] / 1000, m[3] / 1000, m[4] / 1000] : null };
}

/** Is a font (by its name in the font table; none: the renderer's Arial) one these metrics describe? */
const arialLike = (name: string | undefined): boolean => name === undefined || /^\s*(arial|helvetica)\b/i.test(name);

// ---- text as the renderer sets it ----------------------------------------------------------------

/** Runs split into lines at CR / LF (a run may span lines). */
export function linesOf(runs: CdxRun[]): CdxRun[][] {
  const lines: CdxRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split(/\r\n|\r|\n/);
    parts.forEach((p, i) => {
      if (i) lines.push([]);
      if (p) lines[lines.length - 1].push({ ...run, text: p });
    });
  }
  return lines;
}

/**
 * One run's pieces as they are set: formula face (0x60) sets digits as subscripts and a trailing charge as a
 * superscript; 0x20 / 0x40 are plain subscript / superscript. shift 1 = subscript, −1 = superscript.
 */
export function textPieces(run: CdxRun): Array<{ text: string; shift: 0 | 1 | -1 }> {
  const pieces: Array<{ text: string; shift: 0 | 1 | -1 }> = [];
  const face = run.face & 0x60;
  if (face === 0x60) {
    // Formula: digits after a letter or bracket are counts (subscript); + / − at the end, charges.
    const re = /(\d+)|([+\-−]+)$|([^\d+\-−]+|[+\-−])/g;
    for (const m of run.text.matchAll(re)) {
      if (m[1]) pieces.push({ text: m[1], shift: 1 });
      else if (m[2]) pieces.push({ text: m[2].replace(/-/g, "−"), shift: -1 });
      else pieces.push({ text: m[0], shift: 0 });
    }
  } else pieces.push({ text: run.text, shift: face === 0x20 ? 1 : face === 0x40 ? -1 : 0 });
  return pieces;
}
/** A piece's font size and its baseline offset (down positive) for its run. */
export const pieceSize = (run: CdxRun, shift: 0 | 1 | -1): number => (shift ? run.size * 0.75 : run.size);
export const pieceDrop = (run: CdxRun, shift: 0 | 1 | -1): number => (shift === 1 ? run.size * 0.25 : shift === -1 ? -run.size * 0.4 : 0);

export interface TextLayout {
  lines: CdxRun[][];
  /** The anchor's x (text-anchor), the first line's baseline, the line pitch. */
  x: number;
  anchor: "start" | "middle" | "end";
  y0: number;
  pitch: number;
  /** The largest run size. */
  size: number;
}

/**
 * Where a text object is set: left / centre / right edge of its box (by its justification), first baseline at p.
 * A stacked atom label ("NH" with its H below, "H2C" above) is split into the element symbol's line and the rest,
 * the element's line on the baseline at p (as ChemDraw places it on its atom). Null when there is no text.
 */
export function textLayout(tx: CdxText, node?: CdxNode): TextLayout | null {
  let lines = linesOf(tx.runs);
  if (!lines.some((ln) => ln.length)) return null;
  const size = tx.runs.reduce((m, q) => Math.max(m, q.size), 1);
  const pitch = tx.lineHeight ?? size * 1.15;
  let elemLine = 0;
  // (Only where ChemDraw stacked it: its box is taller than one line — one-line boxes are under 1 × size, stacked ones about 1.45 ×.)
  const oneLineBox = !!tx.box && tx.box[3] - tx.box[1] < size * 1.2;
  if (node && lines.length === 1 && (tx.align === "Below" || tx.align === "Above") && !oneLineBox) {
    const all = lines[0].map((q) => q.text).join("");
    const m = /^([A-Z][a-z]?)(.+)$/.exec(all);
    if (m) {
      const base = lines[0][0];
      const elem: CdxRun = { ...base, text: m[1] };
      const rest: CdxRun = { ...base, text: m[2] };
      lines = tx.align === "Below" ? [[elem], [rest]] : [[rest], [elem]];
      elemLine = tx.align === "Below" ? 0 : 1;
    }
  }
  const just = tx.justify.toLowerCase();
  const anchor = just === "right" ? "end" : just === "center" ? "middle" : "start";
  const bx = tx.box;
  const x = bx ? (anchor === "end" ? bx[2] : anchor === "middle" ? (bx[0] + bx[2]) / 2 : bx[0]) : (tx.p?.[0] ?? node?.p[0] ?? 0);
  const y0 = (tx.p?.[1] ?? (bx ? bx[3] - size * 0.25 : (node?.p[1] ?? 0) + size * 0.35)) - elemLine * pitch;
  return { lines, x, anchor, y0, pitch, size };
}

/** A line's advance width and its ink box, set from x = 0 on baseline 0 (null ink when it has none), in points. */
function lineInk(line: CdxRun[]): { adv: number; ink: Box | null } {
  let pen = 0;
  let ink: Box | null = null;
  for (const run of line)
    for (const p of textPieces(run)) {
      const s = pieceSize(run, p.shift), dy = pieceDrop(run, p.shift);
      for (const ch of p.text) {
        const g = glyph(ch);
        if (g.ink) {
          const b: Box = [pen + g.ink[0] * s, dy - g.ink[3] * s, pen + g.ink[2] * s, dy - g.ink[1] * s];
          ink = ink ? [Math.min(ink[0], b[0]), Math.min(ink[1], b[1]), Math.max(ink[2], b[2]), Math.max(ink[3], b[3])] : b;
        }
        pen += g.adv * s;
      }
    }
  return { adv: pen, ink };
}

/**
 * The ink of a text object as the renderer draws it (the letters' own outlines, not the file's box). Null where the
 * model does not describe what is drawn — a face other than Arial / Helvetica, bold or italic runs — or there is no
 * ink; callers then fall back to the file's box.
 */
export function textInk(fonts: ReadonlyMap<number, string> | undefined, tx: CdxText, node?: CdxNode): Box | null {
  if (tx.runs.some((r) => (r.face & 3) !== 0 || !arialLike(fonts?.get(r.font)))) return null;
  const lay = textLayout(tx, node);
  if (!lay) return null;
  let out: Box | null = null;
  lay.lines.forEach((ln, i) => {
    const { adv, ink } = lineInk(ln);
    if (!ink) return;
    const x0 = lay.anchor === "end" ? lay.x - adv : lay.anchor === "middle" ? lay.x - adv / 2 : lay.x;
    const y = lay.y0 + i * lay.pitch;
    const b: Box = [x0 + ink[0], y + ink[1], x0 + ink[2], y + ink[3]];
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : b;
  });
  return out;
}

/** One laid-out line's ink box (null when it has none). */
function lineBox(lay: TextLayout, i: number): Box | null {
  const { adv, ink } = lineInk(lay.lines[i]);
  if (!ink) return null;
  const x0 = lay.anchor === "end" ? lay.x - adv : lay.anchor === "middle" ? lay.x - adv / 2 : lay.x;
  const y = lay.y0 + i * lay.pitch;
  return [x0 + ink[0], y + ink[1], x0 + ink[2], y + ink[3]];
}

/** An atom label's ink box (the model's), else its file box; null for a bare vertex. */
export function labelInk(fonts: ReadonlyMap<number, string> | undefined, nd: Pick<CdxNode, "label" | "p">): Box | null {
  const t = nd.label;
  if (!t || !t.runs.some((q) => q.text.trim())) return null;
  return textInk(fonts, t, nd as CdxNode) ?? t.box;
}

/**
 * The geometry of a label the editor stacks — the element on its atom, its hydrogens centred below (or above) it, as
 * ChemDraw stacks a label whose bonds leave both sides (LabelAlignment Below / Above, centre-justified): p on the
 * element's baseline at the atom, the box round both lines. Null when the text is not an element and the rest.
 */
export function stackedLabelGeometry(atom: Pt, run: { text: string; face: number; size: number }, below: boolean): { p: Pt; box: Box } | null {
  const m = /^([A-Z][a-z]?)(.+)$/.exec(run.text);
  if (!m) return null;
  const r = (text: string): CdxRun[] => [{ text, face: run.face, size: run.size, font: 0, color: 3 }];
  const e = lineInk(r(m[1])), rest = lineInk(r(m[2]));
  const size = run.size, pitch = size * 1.15, base = atom[1] + 0.35 * size;
  const w = Math.max(e.adv, rest.adv);
  const eTop = e.ink ? e.ink[1] : -0.716 * size, eBot = e.ink ? Math.max(0, e.ink[3]) : 0;
  const rTop = rest.ink ? rest.ink[1] : -0.716 * size, rBot = rest.ink ? Math.max(0, rest.ink[3]) : 0;
  const top = below ? base + eTop : base - pitch + rTop, bottom = below ? base + pitch + rBot : base + eBot;
  return { p: [atom[0], base], box: [atom[0] - w / 2, top, atom[0] + w / 2, bottom] };
}

/**
 * The geometry the editor writes for a one-line atom label of these runs (each {text, face, size}): the letter at
 * `centreAt` (a character index, counting every run's text) centred on the atom; p the first baseline's left end, 0.35
 * label size below the atom (the cap height's middle on the atom); the box ChemDraw's way — from the text's start to
 * its advance end across, the letters' ink top to their ink bottom (a subscript's included) down. Right-justified
 * labels keep p at the left end too, as the editor always wrote it.
 */
export function labelGeometry(atom: Pt, runs: Array<{ text: string; face: number; size: number }>, centreAt: number): { p: Pt; box: Box } {
  const rr: CdxRun[] = runs.map((r) => ({ text: r.text, face: r.face, size: r.size, font: 0, color: 3 }));
  const size = runs.reduce((m, r) => Math.max(m, r.size), 1);
  // The advance before the centred letter, and the letter's own.
  let pen = 0, before = 0, own = 0, k = 0;
  for (const run of rr)
    for (const p of textPieces(run)) {
      const s = pieceSize(run, p.shift);
      for (const ch of p.text) {
        const a = glyph(ch).adv * s;
        if (k === centreAt) (before = pen), (own = a);
        pen += a;
        k++;
      }
    }
  const { adv, ink } = lineInk(rr);
  const left = atom[0] - before - own / 2;
  const base = atom[1] + 0.35 * size;
  const top = ink ? ink[1] : -0.716 * size, bottom = ink ? Math.max(0, ink[3]) : 0;
  return { p: [left, base], box: [left, base + top, left + adv, base + bottom] };
}

// ---- charges and radicals -----------------------------------------------------------------------

/** The gap between a label's letters and its charge sign, ink to ink (a fraction of the label size). */
export const CHARGE_GAP = 0.12;
/**
 * A charge sign's place is free when no bond of its atom comes nearer its ink than this (a fraction of the bond
 * length): nearer, a minus beside a bond reads as a second line of it ("O=" — review round 3).
 */
const CHARGE_CLEAR = 0.22;

/**
 * Where an atom's charge is set when no symbol on the page draws it, and the box its ink takes: shared with the
 * mechanism-arrow planner, which keeps arrows off it. A superscript beside the label's letters (CHARGE_GAP from their
 * ink), upper right as ChemDraw sets it — unless one of the atom's bonds comes within CHARGE_CLEAR of it there, when it
 * goes to the first free place of upper left, above, lower right, lower left, below (a plus is first raised, still upper right, up to 3 pt). A bare vertex's sign: up and
 * right with no bonds, else 0.3 bond length out on the bisector of the widest opening between its bonds (outside a
 * ring, opposite a chain's bond), its ink at least 1 pt clear of every bond line.
 * `ctx.nbrs`: the positions of the atom's bonded neighbours (none: upper right); `ctx.fonts`: the page's font table.
 */
export function chargeGlyph(
  st: CdxStyle,
  nd: Pick<CdxNode, "charge" | "label" | "p">,
  ctx: { nbrs?: readonly Pt[]; fonts?: ReadonlyMap<number, string>; doc?: CdxDoc; others?: { boxes: Box[]; segs: Array<[Pt, Pt]> } } = {},
): { at: Pt; txt: string; size: number; box: Box } {
  // On a page: every sign placed together, each kept off the others and off every other atom's letters (pageCharges).
  if (ctx.doc && !ctx.others && (nd as CdxNode).id !== undefined) {
    const g = pageCharges(ctx.doc).get((nd as CdxNode).id);
    if (g) return g;
  }
  const q = nd.charge, txt = (Math.abs(q) > 1 ? String(Math.abs(q)) : "") + (q > 0 ? "+" : "−");
  const size = st.labelSize * 0.75;
  // The sign's own ink, set from x = 0 on baseline 0.
  let pen = 0, sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const ch of txt) {
    const g = glyph(ch);
    if (g.ink) {
      sx0 = Math.min(sx0, pen + g.ink[0] * size);
      sx1 = Math.max(sx1, pen + g.ink[2] * size);
      sy0 = Math.min(sy0, -g.ink[3] * size);
      sy1 = Math.max(sy1, -g.ink[1] * size);
    }
    pen += g.adv * size;
  }
  const signW = sx1 - sx0, signMidY = (sy0 + sy1) / 2;
  const at0 = (inkLeft: number, centreY: number): Pt => [inkLeft - sx0, centreY - signMidY];
  const boxAt = (at: Pt): Box => [at[0] + sx0, at[1] + sy0, at[0] + sx1, at[1] + sy1];
  const segs = (ctx.nbrs ?? []).map((o) => [nd.p, o] as [Pt, Pt]);
  const need = CHARGE_CLEAR * st.bondLength;
  // A minus beside a level bond reads as a second line of it (B=F): such a bond needs 0.35 bond length.
  const level = segs.map(([p, r]) => q < 0 && Math.abs(Math.sin(Math.atan2(r[1] - p[1], r[0] - p[0]))) < 0.5);
  /** How far the sign's ink keeps from the atom's bonds (their centre lines), as a fraction of what each needs. */
  const clearOf = (b: Box): number => Math.min(Infinity, ...segs.map(([p, r], i) => (segBoxDist(p, r, b) * need) / (level[i] ? 0.35 * st.bondLength : need)));
  // (A stacked label's sign also keeps off its own other line's letters.)
  let avoid: Box | null = null;
  const off = (b: Box): boolean => !!avoid && Math.hypot(Math.max(0, avoid[0] - b[2], b[0] - avoid[2]), Math.max(0, avoid[1] - b[3], b[1] - avoid[3])) < 0.5 * CHARGE_GAP * st.labelSize;
  // Other ink on the page (another atom's letters, a sign already placed, a bond not its own): 1 pt clear of it.
  const oBoxes = ctx.others?.boxes ?? [], oSegs = ctx.others?.segs ?? [];
  const otherClear = (b: Box): number =>
    Math.min(Infinity, ...oBoxes.map((o) => Math.hypot(Math.max(0, o[0] - b[2], b[0] - o[2]), Math.max(0, o[1] - b[3], b[1] - o[3]))), ...oSegs.map(([p, r]) => segBoxDist(p, r, b) - st.lineWidth / 2));
  /**
   * The first candidate clear of its own bonds (by needBond), its own other line, and all other ink; where none is,
   * each candidate stepped outward from the atom (up to 8 pt, bounded); where still none, the clearest.
   */
  const pick = (cands: Pt[], needBond = need): Pt => {
    const score = (at: Pt): number => {
      const b = boxAt(at);
      if (off(b)) return -1;
      return Math.min(segs.length ? clearOf(b) / needBond : Infinity, otherClear(b) / 1);
    };
    if (!segs.length && !oBoxes.length && !oSegs.length) return cands.find((c) => !off(boxAt(c))) ?? cands[0];
    const outward = [1.5, 3, 4.5, 6, 8].flatMap((k) =>
      cands.map((c): Pt => {
        const b = boxAt(c), mid: Pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const u = unitOf([mid[0] - nd.p[0], mid[1] - nd.p[1]]);
        return [c[0] + u[0] * k, c[1] + u[1] * k];
      }),
    );
    // First where other ink is well clear (2 pt: a sign 1 pt from the next ion's sign reads as one), then 1 pt.
    let best = cands[0], bestScore = -Infinity;
    for (const roomy of [2, 1])
      for (const at of [...cands, ...outward]) {
        const sc = score(at), oc = otherClear(boxAt(at));
        if (sc >= 1 && oc >= roomy) return at;
        if (roomy === 1 && sc > bestScore) (bestScore = sc), (best = at);
      }
    return best;
  };
  /** Sign places on the bisectors of the openings between the bonds (widest first), its ink a gap off the box I and farther. */
  const openings = (I: Box, gap: number): Pt[] => {
    if (segs.length < 2) return [];
    const ds = segs.map(([, o]) => Math.atan2(o[1] - nd.p[1], o[0] - nd.p[0])).sort((x, y) => x - y);
    const gs = ds.map((d, i) => ({ mid: d + ((i + 1 < ds.length ? ds[i + 1] : ds[0] + 2 * Math.PI) - d) / 2, width: (i + 1 < ds.length ? ds[i + 1] : ds[0] + 2 * Math.PI) - d })).sort((x, y) => y.width - x.width);
    const out: Pt[] = [];
    const hw = (sx1 - sx0) / 2, hh = (sy1 - sy0) / 2;
    for (const g of gs) {
      const u: Pt = [Math.cos(g.mid), Math.sin(g.mid)];
      // From the atom along u to where the sign's box (centred on the ray) clears I by the gap.
      const ex = u[0] > 1e-9 ? (I[2] + gap + hw - nd.p[0]) / u[0] : u[0] < -1e-9 ? (I[0] - gap - hw - nd.p[0]) / u[0] : Infinity;
      const ey = u[1] > 1e-9 ? (I[3] + gap + hh - nd.p[1]) / u[1] : u[1] < -1e-9 ? (I[1] - gap - hh - nd.p[1]) / u[1] : Infinity;
      const r0 = Math.min(ex, ey);
      for (const k of [0, 1.5, 3]) out.push([nd.p[0] + u[0] * (r0 + k) - (sx0 + sx1) / 2, nd.p[1] + u[1] * (r0 + k) - signMidY]);
    }
    return out;
  };
  const bx = nd.label?.box && nd.label.runs.some((r) => r.text.trim()) ? nd.label.box : null;
  let at: Pt;
  if (bx) {
    const ink = textInk(ctx.fonts, nd.label!, nd as CdxNode);
    const lay = ink ? textLayout(nd.label!, nd as CdxNode) : null;
    // The superscript's centre: as a formula's trailing charge is set (its baseline 0.4 label size up).
    const ls = st.labelSize;
    let I: Box, upY: number, gap: number;
    // A stacked label (NH with its H below): the sign beside the element's own line, its baseline at p.
    const elemLine = lay && lay.lines.length === 2 ? (nd.label!.align === "Above" ? 1 : 0) : 0;
    const elemInk = ink && lay ? lineBox(lay, elemLine) : null;
    const modelled = !!(elemInk && lay && lay.lines.length <= 2);
    const baseY = lay ? lay.y0 + elemLine * lay.pitch : 0;
    if (modelled) {
      I = elemInk!;
      if (lay!.lines.length === 2) avoid = lineBox(lay!, 1 - elemLine);
      gap = CHARGE_GAP * ls;
      upY = baseY - 0.4 * ls + signMidY;
    } else {
      // A label the model does not describe (another face, bold, stacked): beside its file box, as before.
      I = bx;
      gap = size * 0.35 + sx0;
      upY = bx[1] + size * 0.6 + signMidY;
    }
    const cy = modelled ? baseY - 0.358 * ls : (bx[1] + bx[3]) / 2;
    const lowY = 2 * cy - upY;
    const cx = nd.p[0] - signW / 2;
    at = pick([
      at0(I[2] + gap, upY),
      // A plus over a bond leaving sideways: raised clear of it, still upper right (beside the bond it read ±; on the
      // far side, +H3N); a minus moves instead (raised it still reads as a second line).
      ...(q > 0 ? [0.75, 1.5, 2.25, 3].map((k) => at0(I[2] + gap, upY - k)) : []),
      // (Right-justified, H3N: upper left is past the hydrogens, far from its N — above the N first.)
      // (A minus centred over a letter reads as a bar over it, Ō: tried after the lower corners.)
      ...(nd.label!.justify === "Right" && q > 0 ? [at0(cx, I[1] - gap - (sy1 - sy0) / 2), at0(I[0] - gap - signW, upY)] : q > 0 ? [at0(I[0] - gap - signW, upY), at0(cx, I[1] - gap - (sy1 - sy0) / 2)] : [at0(I[0] - gap - signW, upY)]),
      at0(I[2] + gap, lowY),
      at0(I[0] - gap - signW, lowY),
      ...(q < 0 ? [at0(cx, I[1] - gap - (sy1 - sy0) / 2)] : []),
      at0(cx, I[3] + gap + (sy1 - sy0) / 2),
      // Bonds on three or four sides: in the middle of the widest openings between them, just off the letters.
      ...openings(I, gap),
      // Every place crowded (four bonds): diagonally farther out, between the bonds.
      ...[1.5, 3].flatMap((k) => [
        at0(I[2] + gap + k, upY - k),
        at0(I[0] - gap - signW - k, upY - k),
        at0(I[2] + gap + k, lowY + k),
        at0(I[0] - gap - signW - k, lowY + k),
      ]),
    ]);
  } else {
    // A bare vertex with no bonds: up and right of it (a quarter bond across, a fifth up).
    const base: Pt = [nd.p[0] + st.bondLength * 0.25, nd.p[1] - st.bondLength * 0.2];
    const c0: Pt = [base[0] + (sx0 + sx1) / 2 - nd.p[0], base[1] + signMidY - nd.p[1]];
    const t0 = Math.atan2(c0[1], c0[0]);
    // With bonds: on the bisector of the widest opening between them (up and right on a near tie), 0.3 bond length out
    // — farther only as needed to keep its ink 1 pt clear of every bond line — so it reads as the atom's.
    const dirs = segs.map(([, o]) => Math.atan2(o[1] - nd.p[1], o[0] - nd.p[0])).sort((x, y) => x - y);
    const gaps = dirs.map((d, i) => {
      const next = i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + 2 * Math.PI;
      return { mid: d + (next - d) / 2, width: next - d };
    });
    const widest = Math.max(...gaps.map((g) => g.width));
    const near = (x: number): number => Math.abs(Math.atan2(Math.sin(x - t0), Math.cos(x - t0)));
    const t = gaps.filter((g) => g.width >= widest - (10 * Math.PI) / 180).sort((x, y) => near(x.mid) - near(y.mid))[0]?.mid ?? t0;
    const placeAt = (rr: number): Pt => [nd.p[0] + rr * Math.cos(t) - (sx0 + sx1) / 2, nd.p[1] + rr * Math.sin(t) - signMidY];
    let rr = 0.3 * st.bondLength;
    for (let i = 0; i < 40 && segs.length && clearOf(boxAt(placeAt(rr))) < 1 + st.lineWidth / 2; i++) rr += 0.25;
    const first = !segs.length ? base : placeAt(rr);
    // Then, if other ink is in the way, the other openings' bisectors (and the free-standing turns) at that distance.
    const alts: Pt[] = [first];
    const rad = !segs.length ? Math.hypot(c0[0], c0[1]) : rr;
    const angs = segs.length ? gaps.sort((x, y) => y.width - x.width).flatMap((g) => [g.mid, g.mid - g.width / 4, g.mid + g.width / 4]) : [t0, Math.PI - t0, -t0, Math.PI + t0, -Math.PI / 2, Math.PI / 2, 0, Math.PI];
    for (const a of angs) alts.push([nd.p[0] + rad * Math.cos(a) - (sx0 + sx1) / 2, nd.p[1] + rad * Math.sin(a) - signMidY]);
    at = pick(alts, 1 + st.lineWidth / 2);
  }
  return { at, txt, size, box: boxAt(at) };
}

const unitOf = (v: Pt): Pt => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

const pageCache = new WeakMap<CdxDoc, { objects: unknown; map: Map<string, ReturnType<typeof chargeGlyph>> }>();
/**
 * Every charge sign on a page, placed in a fixed order (by atom id) so the renderer, the arrow planner and the tests
 * agree: each one beside its own atom as chargeGlyph places it, kept 1 pt clear of every other atom's letters, every
 * sign already placed and every bond not its own (a salt's Na⁺ and the acetate's O⁻ drew on top of each other).
 * Atoms whose charge a symbol on the page draws are left out.
 */
export function pageCharges(doc: CdxDoc): Map<string, ReturnType<typeof chargeGlyph>> {
  const hit = pageCache.get(doc);
  if (hit && hit.objects === doc.objects) return hit.map;
  const nodes: CdxNode[] = [], bonds: Array<{ b: string; e: string }> = [];
  for (const o of doc.objects) for (const it of o.items) if (it.kind === "fragment") (nodes.push(...it.v.nodes), bonds.push(...it.v.bonds));
  const drawn = new Set<string>();
  for (const o of doc.objects) for (const it of o.items) if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.attribute === "Charge" && c.attrs.object) drawn.add(c.attrs.object);
  const pos = new Map(nodes.map((n) => [n.id, n.p]));
  const inks = new Map<string, Box>();
  for (const n of nodes) {
    const b = labelInk(doc.fonts, n);
    if (b) inks.set(n.id, b);
  }
  const map = new Map<string, ReturnType<typeof chargeGlyph>>();
  const placed: Box[] = [];
  const reach = 3 * doc.style.bondLength;
  const charged = nodes.filter((n) => n.charge && !drawn.has(n.id)).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0) || (a.id < b.id ? -1 : 1));
  for (const n of charged) {
    const near = (p: Pt): boolean => Math.abs(p[0] - n.p[0]) < reach && Math.abs(p[1] - n.p[1]) < reach;
    const nbrs: Pt[] = [], segs: Array<[Pt, Pt]> = [];
    for (const b of bonds) {
      const pa = pos.get(b.b), pb = pos.get(b.e);
      if (!pa || !pb) continue;
      if (b.b === n.id) nbrs.push(pb);
      else if (b.e === n.id) nbrs.push(pa);
      else if (near(pa) || near(pb)) segs.push([pa, pb]);
    }
    const boxes = [...[...inks].filter(([id, b]) => id !== n.id && near([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])).map(([, b]) => b), ...placed];
    const g = chargeGlyph(doc.style, n, { nbrs, fonts: doc.fonts, others: { boxes, segs } });
    map.set(n.id, g);
    placed.push(g.box);
  }
  pageCache.set(doc, { objects: doc.objects, map });
  return map;
}

/** Distance from a segment to a box (0 when they meet). */
export function segBoxDist(p: Pt, r: Pt, b: Box): number {
  const inside = (q: Pt): boolean => q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
  if (inside(p) || inside(r)) return 0;
  const corners: Pt[] = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  const cr = (o: Pt, u: Pt, v: Pt): number => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  for (let i = 0; i < 4; i++) {
    const e0 = corners[i], e1 = corners[(i + 1) % 4];
    if (cr(p, r, e0) * cr(p, r, e1) < 0 && cr(e0, e1, p) * cr(e0, e1, r) < 0) return 0;
  }
  const ptSeg = (q: Pt, a: Pt, c: Pt): number => {
    const d: Pt = [c[0] - a[0], c[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1];
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / L2)) : 0;
    return Math.hypot(q[0] - a[0] - t * d[0], q[1] - a[1] - t * d[1]);
  };
  const boxPt = (q: Pt): number => Math.hypot(Math.max(0, b[0] - q[0], q[0] - b[2]), Math.max(0, b[1] - q[1], q[1] - b[3]));
  return Math.min(boxPt(p), boxPt(r), ...corners.map((c) => ptSeg(c, p, r)));
}

/** The dots of a radical drawn above an atom (its label): their box. */
export function radicalBox(st: CdxStyle, nd: Pick<CdxNode, "label" | "p">, kind: string): Box {
  const bx = nd.label?.box;
  const r = st.labelSize * 0.09;
  const cx = bx ? (bx[0] + bx[2]) / 2 : nd.p[0];
  const cy = (bx ? bx[1] : nd.p[1] - st.labelSize * 0.3) - r * 2.5;
  const half = kind === "Doublet" ? r : r * 2.8;
  return [cx - half, cy - r, cx + half, cy + r];
}
