/**
 * Mechanism arrows on a ChemDraw page: curved electron-pushing arrows (an electron pair, full head) and fishhooks
 * (one electron, half head), as ChemDraw stores them — an `<arrow>` whose shaft is an arc of the ellipse given by
 * Center3D, MajorAxisEnd3D and MinorAxisEnd3D, from Tail3D through AngularSize degrees to Head3D, tied to the atom
 * or bond it starts from and ends at by ArrowSource / ArrowTarget.
 *
 * Format facts, and where each comes from:
 *   - the attribute names, and that ArrowSource / ArrowTarget hold "the id of the source [target] of an electron
 *     pushing arrow": Revvity's open-source ChemDraw format code, github.com/Glysade/chemdraw (CDXConstants.h,
 *     CDXObject.cpp, CDXArrow.cpp; BSD 3-Clause);
 *   - AngularSize is in degrees in CDXML (tenths in CDX): the CDX Format Specification,
 *     https://chemapps.stolaf.edu/iupac/cdx/sdk/properties/Arc_AngularSize.htm ;
 *   - its sign: positive turns the arrow anticlockwise on the page, negative clockwise (ChemDraw's ActiveX reference,
 *     http://www.cambridgesoft.com/services/documentation/sdk/chemdraw/ActiveX11/ChemDrawControl10~Arrow~AngularSize.html,
 *     and, independently, an open-source exporter calibrated on ChemDraw's own sample files: "head = tail turned by
 *     −AngularSize" with y down, github.com/JamesOBrien2/penzene/pull/182);
 *   - a half head's barb lies to the LEFT of the direction of travel for HalfLeft, to the right for HalfRight; and
 *     ChemDraw writes Center3D / MajorAxisEnd3D (centre + (r, 0)) / MinorAxisEnd3D (centre + (0, r)) on every arrow,
 *     straight ones included, where only a non-zero AngularSize makes it curved: measured on a ChemDraw 23.1 file of
 *     every arrow kind (arrows.cdx in github.com/epam/Indigo, api/tests/integration/tests/formats/molecules/cdx/).
 *
 * The shape is drawn as ChemDraw users draw a mechanism: the arrow leaves its source on the side it bows to, clear of
 * the atom's label, and arrives with its tip just short of the target's label, pointing at it; a short arrow takes a
 * rounder arc, so the head never eats the shaft. Every loop here has a fixed bound.
 */
import type { Box, CdxArrow, CdxBond, CdxDoc, CdxFragment, CdxNode, Pt } from "./cdxml";
import { chargeGlyph, labelInk, radicalBox, segBoxDist } from "./cdxGlyphs";
// (A cycle with cdxmlRender, used only inside functions: the planner measures other arrows' heads as they are drawn.)
import { arrowMarkup } from "./cdxmlRender";

export type ArrowEnd = { atom: string } | { bond: string } | { at: Pt };

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const addp = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
/** The normal to the right of direction d on the page (y down). */
const right = (d: Pt): Pt => [-d[1], d[0]];

// ---- the arc ---------------------------------------------------------------------------------

/** A curved arrow's arc: P(φ) = c + a cos φ + b sin φ, from φ0 by dφ (its sign: the way it runs). */
export interface ArcGeom {
  c: Pt;
  a: Pt;
  b: Pt;
  phi0: number;
  dphi: number;
}

export const arcPoint = (g: ArcGeom, phi: number): Pt => [g.c[0] + g.a[0] * Math.cos(phi) + g.b[0] * Math.sin(phi), g.c[1] + g.a[1] * Math.cos(phi) + g.b[1] * Math.sin(phi)];

/** The arc of a curved arrow, or null for a straight one (AngularSize 0, or no ellipse). */
export function arcOf(ar: Pick<CdxArrow, "tail" | "center" | "major" | "minor" | "angularSize"> & { head?: Pt }): ArcGeom | null {
  if (!ar.angularSize || !Number.isFinite(ar.angularSize) || !ar.center || !ar.major || !ar.minor) return null;
  const c = ar.center, a = sub(ar.major, c), b = sub(ar.minor, c);
  const det = cross(a, b);
  if (!(Math.abs(det) > 1e-9)) return null;
  const q = sub(ar.tail, c);
  const phi0 = Math.atan2(cross(a, q) / det, cross(q, b) / det);
  // With b clockwise of a on the page (det > 0) φ runs clockwise; a positive AngularSize runs anticlockwise.
  const deg = Math.max(-360, Math.min(360, ar.angularSize));
  const g: ArcGeom = { c, a, b, phi0, dphi: (-Math.sign(det) * deg * Math.PI) / 180 };
  // The file's own head decides the way round where it can: the sign convention rests on two secondary sources (see
  // above), and an arc drawn the wrong way would end at the mirror point. Only where both ways end about equally near
  // the head (a half turn) does the sign alone decide.
  if (ar.head) {
    const e1 = arcPoint(g, phi0 + g.dphi), e2 = arcPoint(g, phi0 - g.dphi);
    const d1 = Math.hypot(e1[0] - ar.head[0], e1[1] - ar.head[1]), d2 = Math.hypot(e2[0] - ar.head[0], e2[1] - ar.head[1]);
    const scale = Math.max(len(a), len(b));
    if (d2 < d1 - 0.05 * scale) g.dphi = -g.dphi;
  }
  return g;
}

/** Points along the arrow's line: its two ends for a straight arrow, the arc sampled for a curved one. */
export function arrowTrace(ar: Pick<CdxArrow, "tail" | "head" | "center" | "major" | "minor" | "angularSize">, n = 32): Pt[] {
  const g = arcOf(ar);
  if (!g) return [ar.tail, ar.head];
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(arcPoint(g, g.phi0 + (g.dphi * i) / n));
  return out;
}

/** Distance from a point to a polyline. */
export function distToTrace(pts: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], d = sub(pts[i + 1], a), L2 = d[0] * d[0] + d[1] * d[1];
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]));
  }
  return pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) : best;
}

// ---- drawing a mechanism arrow ---------------------------------------------------------------

/**
 * A mechanism arrow's head (hundredths of the line width): 4.8 pt long and 3 pt across at the ACS 1996 line width, a
 * little shorter than the reaction arrow's 6 pt, as a journal's curved arrows are — the reaction head on a one-bond arc
 * ate most of the shaft (walkthrough).
 */
export const CURVED_HEAD = { HeadSize: "700", ArrowheadCenterSize: "610", ArrowheadWidth: "230" } as const;

/**
 * The planner (Release D, rebuilt table-first after three rounds of tuning one cost sum failed). Every candidate arc is
 * CONSTRUCTED to land right and then FILTERED by hard clearances; only clean candidates are scored:
 *   - the tail: beside its bond's middle (clear of the drawn lines), round its atom's letters, or its page point;
 *   - the head: round its target's letters (or vertex, or beside its bond) pointing at it — the circle through the
 *     tail and the tip whose drawn head (laid along the chord of its last head length, as the renderer draws it) points
 *     that way is unique, so "pointing at its atom" holds by construction, and the sweep follows from it;
 *   - kept only if the sweep is SWEEP_LO…SWEEP_HI, the shaft has room beyond its head, the tail leaves away from its
 *     atom or bond, and nothing is in the way: other bonds' lines, letters, charge signs and radical dots, captions,
 *     and the arrows already on the page (CLEAR, below; every distance measured from the ink as drawn);
 *   - scored: the sweep nearest the one its length reads best at, the head square on its target, the tail nearest its
 *     bond's middle, the most room; on a tie, over the top.
 * Both bows come from one pass. A side with no clean arc is refused by name — a curve through a bond or a label is
 * never drawn. A bond to one of its own atoms (a homolysis, a leaving group) bows by default to the side of the bond
 * with fewer neighbours (up on a tie), decided by the bond alone, so the two fishhooks of a homolysis share a side.
 * Obstacles are binned in a grid of bond-length cells; every loop has a fixed bound.
 */

/** Rejection counts, for a diagnostic run (null: not counted). */
export const planDebug: { counts: Record<string, number> | null; seen?: Array<{ T: Pt; H: Pt; D: Pt; sweep: number; r: number }> } = { counts: null };
const dbg = (k: string): number => {
  if (planDebug.counts) planDebug.counts[k] = (planDebug.counts[k] ?? 0) + 1;
  return -1;
};

/** The sweep (degrees): the range kept, and the one aimed at for a short and a long arrow. */
const SWEEP_LO = 30, SWEEP_HI = 110, SWEEP_SHORT = 95, SWEEP_LONG = 65;
/** Clearances (points), centre line to ink: what a candidate must keep (each a little over what the table measures). */
const CLEAR = {
  /** Another bond's line: its ink 1.2 pt clear, and its main line at least 0.2 bond length from the shaft's centre. */
  bondInk: 1.2,
  bondMain: 0.2,
  /** The head: 0.15 bond length (centre to centre) from every bond but its target. */
  headBond: 0.15,
  /** Letters: 1.2 pt; the arrow's own atoms' letters 0.7 pt; charge signs, radical dots, captions 1.25 pt. */
  label: 1.2,
  ownLabel: 0.7,
  glyph: 1.25,
  /** Another arrow: 1.7 pt, ink to ink. */
  arrow: 1.7,
} as const;
/** Gaps (points, ink to ink): a tail from its atom's letters, a tip from its target's letters, a tail from its bond's lines, a tip from a bond's lines. */
const GAP = { tailLabel: 1.0, tipLabel: 1.1, tailBond: 1.5, tipBond: 1.1 } as const;

export interface CurvedPlan {
  tail: Pt;
  head: Pt;
  center: Pt;
  r: number;
  /** Degrees, positive anticlockwise on the page (ChemDraw's AngularSize). */
  angularSize: number;
  /** +1: bowed to the left of the way it runs (clockwise on the page); −1: to the right. */
  bow: 1 | -1;
  /** An ellipse's semi-axes as vectors; absent for a circle of radius r with axes along x and y. */
  axes?: { major: Pt; minor: Pt };
  /** How far it runs into other ink's clearance: always 0 for a plan returned (a candidate that clashes is refused). */
  clash?: number;
  source?: string;
  target?: string;
}

/** Options: `exclude` an arrow already on the page that this plan replaces (a flip, a re-plan); `quick` a coarse plan (a drag's preview). */
export interface PlanOptions {
  exclude?: string;
  quick?: boolean;
  /** 1 for a fishhook: a fishhook from a bond to one of its own atoms is half a homolysis (its tail on that atom's half; its partner's side kept). */
  electrons?: 1 | 2;
}

type Seg = { a: Pt; b: Pt; bond?: string; main?: boolean; arrow?: string };
type BoxItem = { bx: Box; node?: string; kind: "label" | "glyph" | "caption" };

/** Obstacles binned by bond-length cells. */
class Grid {
  private cells = new Map<number, { segs: Seg[]; boxes: BoxItem[] }>();
  constructor(private cell: number) {}
  private key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  private range(x0: number, y0: number, x1: number, y1: number, f: (k: number) => void): void {
    const c = this.cell;
    const i0 = Math.max(-4000, Math.floor(x0 / c)), i1 = Math.min(4000, Math.floor(x1 / c)), j0 = Math.max(-4000, Math.floor(y0 / c)), j1 = Math.min(4000, Math.floor(y1 / c));
    // A bounded walk: an item spans at most 64 × 64 cells (a damaged coordinate cannot freeze Word).
    for (let i = i0; i <= i1 && i <= i0 + 64; i++) for (let j = j0; j <= j1 && j <= j0 + 64; j++) f(this.key(i, j));
  }
  private at(k: number): { segs: Seg[]; boxes: BoxItem[] } {
    let v = this.cells.get(k);
    if (!v) this.cells.set(k, (v = { segs: [], boxes: [] }));
    return v;
  }
  addSeg(s: Seg): void {
    this.range(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1]), (k) => this.at(k).segs.push(s));
  }
  addBox(b: BoxItem): void {
    this.range(b.bx[0], b.bx[1], b.bx[2], b.bx[3], (k) => this.at(k).boxes.push(b));
  }
  query(x0: number, y0: number, x1: number, y1: number): { segs: Set<Seg>; boxes: Set<BoxItem> } {
    const segs = new Set<Seg>(), boxes = new Set<BoxItem>();
    this.range(x0, y0, x1, y1, (k) => {
      const v = this.cells.get(k);
      if (v) {
        for (const s of v.segs) segs.add(s);
        for (const b of v.boxes) boxes.add(b);
      }
    });
    return { segs, boxes };
  }
}

interface BondInfo {
  id: string;
  b: string;
  e: string;
  order: string;
  /** +1 / −1: the side (of right(dB)) a double bond's second line lies on; 0 centred or single. */
  side: number;
  multiple: boolean;
  triple: boolean;
}

/** What a page holds for the planner: its atoms, bonds, letters and every obstacle, binned. */
interface PlanCtx {
  L: number;
  labelSize: number;
  lw: number;
  gap: number;
  nodes: Map<string, CdxNode>;
  bonds: Map<string, BondInfo>;
  /** The bonds at each atom. */
  atBonds: Map<string, string[]>;
  ink: Map<string, Box>;
  grid: Grid;
  /** The tips of the curved arrows on the page (a shared target point: their heads may meet there). */
  tips: Map<string, Pt>;
  /** Curved arrows from a bond to one of its atoms: which side of the bond each bows to. */
  hooks: Array<{ source: string; target: string; side: number }>;
}

const ctxCache = new WeakMap<CdxDoc, { objects: unknown; exclude: string | undefined; ctx: PlanCtx }>();

function planContext(doc: CdxDoc, exclude?: string): PlanCtx {
  const hit = ctxCache.get(doc);
  if (hit && hit.objects === doc.objects && hit.exclude === exclude) return hit.ctx;
  const st = doc.style, L = st.bondLength, lw = st.lineWidth, gap = st.bondGap;
  const nodes = new Map<string, CdxNode>(), bonds = new Map<string, BondInfo>(), atBonds = new Map<string, string[]>(), ink = new Map<string, Box>();
  const grid = new Grid(Math.max(L, 1));
  const frags: CdxFragment[] = [];
  for (const o of doc.objects) for (const it of o.items) if (it.kind === "fragment") frags.push(it.v);
  for (const f of frags) for (const n of f.nodes) nodes.set(n.id, n);
  // Charges and radicals a symbol on the page draws are boxed as that symbol.
  const drawnBySymbol = new Set<string>();
  for (const o of doc.objects) for (const it of o.items) if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.object) drawnBySymbol.add(c.attrs.object);
  for (const f of frags) {
    for (const bd of f.bonds) {
      const pa = nodes.get(bd.b)?.p, pb = nodes.get(bd.e)?.p;
      if (!pa || !pb) continue;
      const ord = bd.order.split(/\s+/)[0];
      const multiple = ord === "2" || ord === "1.5" || ord === "3";
      bonds.set(bd.id, { id: bd.id, b: bd.b, e: bd.e, order: ord, side: multiple && ord !== "3" ? doubleSide(f, bd, nodes) : 0, multiple, triple: ord === "3" });
      (atBonds.get(bd.b) ?? atBonds.set(bd.b, []).get(bd.b)!).push(bd.id);
      (atBonds.get(bd.e) ?? atBonds.set(bd.e, []).get(bd.e)!).push(bd.id);
      grid.addSeg({ a: pa, b: pb, bond: bd.id, main: true });
      // A multiple bond's other lines where they are drawn (a centred double bond's two lie within its main line's clearance).
      if (multiple) {
        const info = bonds.get(bd.id)!;
        const n = mul(right(unit(sub(pb, pa))), gap);
        for (const sgn of info.triple ? [1, -1] : info.side ? [info.side] : []) grid.addSeg({ a: addp(pa, mul(n, sgn)), b: addp(pb, mul(n, sgn)), bond: bd.id, main: false });
      }
    }
  }
  for (const n of nodes.values()) {
    const bx = labelInk(doc.fonts, n);
    if (bx) {
      ink.set(n.id, bx);
      grid.addBox({ bx, node: n.id, kind: "label" });
    }
    const nb = (atBonds.get(n.id) ?? []).map((id) => bonds.get(id)!).map((b) => nodes.get(b.b === n.id ? b.e : b.b)!.p);
    if (n.charge && !drawnBySymbol.has(n.id)) grid.addBox({ bx: chargeGlyph(st, n, { nbrs: nb, fonts: doc.fonts, doc }).box, node: n.id, kind: "glyph" });
    const rad = n.el.attrs.Radical;
    if (rad && rad !== "None" && !drawnBySymbol.has(n.id)) grid.addBox({ bx: radicalBox(st, n, rad), node: n.id, kind: "glyph" });
  }
  const tips = new Map<string, Pt>();
  const hooks: PlanCtx["hooks"] = [];
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind === "text" && it.v.box) grid.addBox({ bx: it.v.box, kind: "caption" });
      if (it.kind === "graphic" && it.v.kind === "Symbol") {
        const rr = Math.max(len(sub(it.v.p2, it.v.p1)) / 3, st.labelSize * 0.25);
        grid.addBox({ bx: [it.v.p1[0] - rr, it.v.p1[1] - rr, it.v.p1[0] + rr, it.v.p1[1] + rr], kind: "glyph" });
      }
      if (it.kind === "arrow" && it.v.id !== exclude) {
        const ar = it.v;
        const tr = arrowTrace(ar, 24);
        for (let i = 0; i + 1 < tr.length; i++) grid.addSeg({ a: tr[i], b: tr[i + 1], arrow: ar.id });
        // Its heads and any second shaft, as drawn (straight segments of the markup).
        for (const poly of arrowInk(st, ar)) for (let i = 0; i + 1 < poly.length; i++) grid.addSeg({ a: poly[i], b: poly[i + 1], arrow: ar.id });
        if (arcOf(ar)) {
          tips.set(ar.id, ar.head);
          const sb = bonds.get(ar.el.attrs.ArrowSource ?? ""), tg = ar.el.attrs.ArrowTarget;
          if (sb && tg && (tg === sb.b || tg === sb.e)) {
            const pa = nodes.get(sb.b)!.p, pb = nodes.get(sb.e)!.p, mid = tr[Math.floor(tr.length / 2)];
            hooks.push({ source: sb.id, target: tg, side: Math.sign(cross(unit(sub(pb, pa)), sub(mid, mul(addp(pa, pb), 0.5)))) });
          }
        }
      }
    }
  const ctx: PlanCtx = { L, labelSize: st.labelSize, lw, gap, nodes, bonds, atBonds, ink, grid, tips, hooks };
  ctxCache.set(doc, { objects: doc.objects, exclude, ctx });
  return ctx;
}

/** The straight pieces of an arrow's drawn ink (heads, shafts): polylines read from the renderer's markup. */
function arrowInk(st: CdxDoc["style"], ar: CdxArrow): Pt[][] {
  const svg = arrowMarkup(st, ar, "#000").svg;
  const out: Pt[][] = [];
  for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) out.push([[+m[1], +m[2]], [+m[3], +m[4]]]);
  for (const m of svg.matchAll(/<path d="M([-\d. L]+?)(Z?)"/g)) {
    const pts = m[1].split("L").map((s) => s.trim().split(/\s+/).map(Number) as Pt).filter((p) => p.length === 2 && p.every(Number.isFinite));
    if (m[2] && pts.length) pts.push(pts[0]);
    if (pts.length > 1) out.push(pts);
  }
  return out;
}
/** A double bond's second line side, as cdxmlRender places it (DoublePosition; else the ring's centre; else the side with more neighbours; else centred). */
function doubleSide(f: CdxFragment, b: CdxBond, nodes: Map<string, CdxNode>): number {
  if (b.doublePosition === "Right") return 1;
  if (b.doublePosition === "Left") return -1;
  if (b.doublePosition === "Center") return 0;
  const pa = nodes.get(b.b)!.p, pb = nodes.get(b.e)!.p, dB = unit(sub(pb, pa));
  const ring = ringCentre(f, b);
  if (ring) return Math.sign(cross(dB, sub(ring, pa))) || 0;
  // Centred on a bond to a labelled atom with no other bond (C=O), as the renderer draws it.
  const lonely = (id: string): boolean => !f.bonds.some((o) => o !== b && (o.b === id || o.e === id));
  const labelled = (id: string): boolean => !!nodes.get(id)?.label?.runs.some((q) => q.text.trim());
  if ((lonely(b.b) && labelled(b.b)) || (lonely(b.e) && labelled(b.e))) return 0;
  let sum = 0;
  for (const o2 of f.bonds) {
    if (o2 === b) continue;
    const other = o2.b === b.b || o2.b === b.e ? o2.e : o2.e === b.b || o2.e === b.e ? o2.b : null;
    const q = other ? nodes.get(other)?.p : undefined;
    if (q) sum += Math.sign(cross(dB, sub(q, pa)));
  }
  return Math.sign(sum);
}

/** The centre of the smallest ring (up to 7 bonds) a bond is in, as cdxmlRender finds it; null outside a ring. */
function ringCentre(fr: { nodes: CdxNode[]; bonds: Array<{ b: string; e: string }> }, bd: { b: string; e: string }): Pt | null {
  const nbrs = new Map<string, string[]>();
  for (const x of fr.bonds) {
    (nbrs.get(x.b) ?? nbrs.set(x.b, []).get(x.b)!).push(x.e);
    (nbrs.get(x.e) ?? nbrs.set(x.e, []).get(x.e)!).push(x.b);
  }
  if ((nbrs.get(bd.b)?.length ?? 0) > 12 || (nbrs.get(bd.e)?.length ?? 0) > 12) return null;
  const pos = new Map(fr.nodes.map((n) => [n.id, n.p]));
  const prev = new Map<string, string>([[bd.b, ""]]);
  let frontier = [bd.b];
  for (let depth = 0; depth < 7 && frontier.length; depth++) {
    const next: string[] = [];
    for (const v of frontier)
      for (const w of nbrs.get(v) ?? []) {
        if ((v === bd.b && w === bd.e) || prev.has(w)) continue;
        prev.set(w, v);
        if (w === bd.e) {
          const ring: Pt[] = [];
          for (let k: string = w, g = 0; k && g < 16; k = prev.get(k) ?? "", g++) {
            const q = pos.get(k);
            if (q) ring.push(q);
          }
          return ring.length ? mul(ring.reduce((s, q) => addp(s, q), [0, 0] as Pt), 1 / ring.length) : null;
        }
        next.push(w);
      }
    frontier = next;
  }
  return null;
}

// ---- the ends ------------------------------------------------------------------------------------

interface TailCand {
  T: Pt;
  /** The way the arc must leave (away from its atom or bond); null for a page point. */
  out: Pt | null;
  /** How far from its ideal place (0 = ideal), for the score. */
  cost: number;
  /** For a bond tail: which side of the bond (of right(dB)); and whether that is a double bond's inner side. */
  side?: number;
  inner?: boolean;
}
interface HeadCand {
  H: Pt;
  /** The way the drawn head points (at its target). */
  D: Pt;
  cost: number;
}
interface End {
  kind: "atom" | "bond" | "at";
  id?: string;
  p: Pt;
  /** The atoms this end is: the atom, or the bond's two (their letters are its own). */
  atoms: string[];
  /** The bond this end is (its lines are its own). */
  bond?: string;
}

const rot = (d: Pt, a: number): Pt => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
const boxDist = (bx: Box, p: Pt): number => Math.hypot(Math.max(0, bx[0] - p[0], p[0] - bx[2]), Math.max(0, bx[1] - p[1], p[1] - bx[3]));
const nearestInBox = (bx: Box, p: Pt): Pt => [Math.max(bx[0], Math.min(bx[2], p[0])), Math.max(bx[1], Math.min(bx[3], p[1]))];
/** Where the ray from inside a box leaves it. */
const exitT = (bx: Box, c: Pt, u: Pt): number => {
  let t = Infinity;
  if (u[0] > 1e-9) t = Math.min(t, (bx[2] - c[0]) / u[0]);
  if (u[0] < -1e-9) t = Math.min(t, (bx[0] - c[0]) / u[0]);
  if (u[1] > 1e-9) t = Math.min(t, (bx[3] - c[1]) / u[1]);
  if (u[1] < -1e-9) t = Math.min(t, (bx[1] - c[1]) / u[1]);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
};
/**
 * What a head aims at on a label: its letters' ink, widened to at least 0.6 label size each way (a head pointing just
 * past a thin I or l reads as pointing at it). Shared with the case table's measure.
 */
export function aimBox(bx: Box, labelSize: number): Box {
  const m = 0.6 * labelSize, cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2;
  const hw = Math.max((bx[2] - bx[0]) / 2, m / 2), hh = Math.max((bx[3] - bx[1]) / 2, m / 2);
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}
/** Does the ray p + t·d (t ≥ 0) pass through box b grown by m? */
function rayHits(p: Pt, d: Pt, b: Box, m: number): boolean {
  let t0 = 0, t1 = 1e6;
  const axes: Array<[number, number, number, number]> = [[p[0], d[0], b[0] - m, b[2] + m], [p[1], d[1], b[1] - m, b[3] + m]];
  for (const [o, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-12) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / dd, c = (hi - o) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  }
  return t0 <= t1;
}
const rayPointDist = (p: Pt, d: Pt, q: Pt): number => {
  const t = Math.max(0, dot(sub(q, p), d));
  return len(sub(addp(p, mul(d, t)), q));
};

function endOf(ctx: PlanCtx, end: ArrowEnd): End | null {
  if ("at" in end) return end.at.every(Number.isFinite) ? { kind: "at", p: end.at, atoms: [] } : null;
  if ("atom" in end) {
    const n = ctx.nodes.get(end.atom);
    return n ? { kind: "atom", id: n.id, p: n.p, atoms: [n.id] } : null;
  }
  const b = ctx.bonds.get(end.bond);
  if (!b) return null;
  const pa = ctx.nodes.get(b.b)!.p, pb = ctx.nodes.get(b.e)!.p;
  return { kind: "bond", id: b.id, p: mul(addp(pa, pb), 0.5), atoms: [b.b, b.e], bond: b.id };
}

/** How far off a bond's own line its drawn lines on side s reach. */
function lineOff(ctx: PlanCtx, b: BondInfo, s: number): number {
  if (!b.multiple) return 0;
  if (b.triple) return ctx.gap;
  if (b.side === 0) return ctx.gap / 2;
  return s === b.side ? ctx.gap : 0;
}

function tailCands(ctx: PlanCtx, A: End, quick: boolean, wide: boolean, own: { target: string; half: boolean } | null, toward: Pt): TailCand[] {
  const { L, lw } = ctx;
  if (A.kind === "at") return [{ T: A.p, out: null, cost: 0 }];
  const out: TailCand[] = [];
  if (A.kind === "atom") {
    const bx = ctx.ink.get(A.id!);
    const N = quick ? 12 : 24;
    const own = (ctx.atBonds.get(A.id!) ?? []).map((id) => ctx.bonds.get(id)!).map((b) => [A.p, ctx.nodes.get(b.b === A.id ? b.e : b.b)!.p] as [Pt, Pt]);
    for (let k = 0; k < N; k++) {
      const u: Pt = [Math.cos((2 * Math.PI * k) / N), Math.sin((2 * Math.PI * k) / N)];
      if (bx) {
        const c: Pt = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
        out.push({ T: addp(c, mul(u, exitT(bx, c, u) + GAP.tailLabel + lw / 2)), out: u, cost: (1 - dot(u, toward)) / 2 });
      } else {
        // A bare vertex: a fifth of a bond off it, between its bonds.
        const T = addp(A.p, mul(u, 0.2 * L));
        if (own.every((sg) => distToTrace(sg, T) >= 0.12 * L)) out.push({ T, out: u, cost: 0 });
      }
    }
    return out;
  }
  const b = ctx.bonds.get(A.bond!)!;
  const pa = ctx.nodes.get(b.b)!.p, pb = ctx.nodes.get(b.e)!.p, dB = unit(sub(pb, pa)), nR = right(dB);
  const inks = A.atoms.map((id) => ctx.ink.get(id)).filter((x): x is Box => !!x);
  // A bond to one of its own atoms (a homolysis, a leaving group): the tail in the bond's middle, just off its line
  // (farther out, in steps of 1 pt, only where letters crowd it).
  // On the target's half of the bond: the two fishhooks of a homolysis start apart, each toward its own atom.
  const toEnd = own?.half ? (own.target === b.e ? 1 : -1) : 0;
  const alongs = own?.half
    ? (quick ? [0.08, 0.2] : [0.06, 0.12, 0.18, 0.24, 0.3]).map((t) => t * toEnd)
    : own
      ? alongsFor(quick, true)
      : alongsFor(quick, wide);
  const step = own ? 1 : 1.5;
  // (Between two labels the middle may be crowded: up to 4 pt farther out; else 1 pt — a leaving group's tail stays
  // within 3 pt of its bond. Never beyond a third of a bond from the middle.)
  const steps = quick ? 3 : own ? (inks.length === 2 ? 5 : 3) : 5;
  for (const s of [1, -1]) {
    const base = lineOff(ctx, b, s) + lw / 2 + GAP.tailBond;
    for (const t of alongs) {
      // Off the line by the gap; where the bond's letters crowd its middle (Br–Br), farther out until clear of them.
      for (let k = 0; k < steps; k++) {
        const T = addp(addp(A.p, mul(dB, t * L)), mul(nR, s * (base + k * step)));
        if (inks.some((bx) => boxDist(bx, T) < GAP.tailLabel + lw / 2)) continue;
        if (own?.half && len(sub(T, A.p)) > 0.35 * L) continue;
        out.push({ T, out: mul(nR, s), cost: 0.4 * (Math.abs(t) / 0.25) + 0.25 * k, side: s, inner: b.multiple && b.side !== 0 && s === b.side });
      }
    }
  }
  return out;
}

/**
 * Places along a bond (fractions of a bond length from its middle) a tail or tip may take: within a quarter bond — or,
 * for a short hop between ends that share an atom, within 0.4 bond (a longer arc fits there).
 */
const alongsFor = (quick: boolean, wide: boolean): number[] =>
  wide ? (quick ? [-0.3, 0, 0.3] : [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4]) : quick ? [-0.15, 0, 0.15] : [-0.25, -0.125, 0, 0.125, 0.25];

function headCands(ctx: PlanCtx, B: End, quick: boolean, wide: boolean): HeadCand[] {
  const { L, lw } = ctx;
  const out: HeadCand[] = [];
  if (B.kind === "at") {
    const N = quick ? 12 : 36;
    for (let k = 0; k < N; k++) out.push({ H: B.p, D: [Math.cos((2 * Math.PI * k) / N), Math.sin((2 * Math.PI * k) / N)], cost: 0 });
    return out;
  }
  const deg = Math.PI / 180;
  if (B.kind === "atom") {
    const bx = ctx.ink.get(B.id!);
    const M = quick ? 16 : 32;
    for (let k = 0; k < M; k++) {
      const u: Pt = [Math.cos((2 * Math.PI * k) / M), Math.sin((2 * Math.PI * k) / M)];
      if (bx) {
        const c: Pt = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
        const H = addp(c, mul(u, exitT(bx, c, u) + GAP.tipLabel + lw / 2));
        const D0 = unit(sub(nearestInBox(bx, H), H));
        for (const dd of quick ? [0, -25, 25, -50, 50] : [0, -15, 15, -30, 30, -45, 45, -60, 60]) {
          const D = rot(D0, dd * deg);
          if (rayHits(H, D, aimBox(bx, ctx.labelSize), 0.3)) out.push({ H, D, cost: 0.6 * (Math.abs(dd) / 30) });
        }
      } else {
        // A bare vertex: the tip a little off it (farther where its bonds crowd the way in), pointing at it.
        for (const rr of quick ? [0.24] : [0.22, 0.3]) {
          const H = addp(B.p, mul(u, rr * L));
          for (const dd of quick ? [0] : [0, -10, 10]) {
            const D = rot(mul(u, -1), dd * deg);
            if (rayPointDist(H, D, B.p) <= 0.08 * L) out.push({ H, D, cost: 0.6 * (Math.abs(dd) / 30) + (rr > 0.25 ? 0.15 : 0) });
          }
        }
      }
    }
    return out;
  }
  const b = ctx.bonds.get(B.bond!)!;
  const pa = ctx.nodes.get(b.b)!.p, pb = ctx.nodes.get(b.e)!.p, dB = unit(sub(pb, pa)), nR = right(dB);
  for (const s of [1, -1])
    for (const t of alongsFor(quick, wide)) {
      const H = addp(addp(B.p, mul(dB, t * L)), mul(nR, s * (lineOff(ctx, b, s) + lw / 2 + GAP.tipBond)));
      for (const dd of quick ? [0, -25, 25, -50, 50] : [0, -20, 20, -35, 35, -50, 50]) {
        const D = rot(mul(nR, -s), dd * deg);
        let best = Infinity;
        for (let i = 0; i <= 12; i++) best = Math.min(best, rayPointDist(H, D, addp(pa, mul(sub(pb, pa), i / 12))));
        if (best <= 1.0) out.push({ H, D, cost: 0.6 * (Math.abs(dd) / 30) + 0.2 * (Math.abs(t) / 0.25) });
      }
    }
  return out;
}

// ---- the arc through a tail and a tip ------------------------------------------------------------

interface Arc {
  C: Pt;
  r: number;
  aT: number;
  /** +1: the angle increases from tail to tip (clockwise on the page). */
  dir: 1 | -1;
  sweep: number;
}

/** The circle through T and H whose tangent at H is D (null when D runs along the chord). */
function arcTangent(T: Pt, H: Pt, D: Pt): Arc | null {
  const p: Pt = [-D[1], D[0]];
  const hT = sub(H, T), den = 2 * dot(p, hT);
  if (Math.abs(den) < 1e-9) return null;
  const k = -dot(hT, hT) / den;
  const C = addp(H, mul(p, k)), r = Math.abs(k);
  const aT = Math.atan2(T[1] - C[1], T[0] - C[0]), aH = Math.atan2(H[1] - C[1], H[0] - C[0]);
  const vH: Pt = [-Math.sin(aH), Math.cos(aH)];
  const dir: 1 | -1 = dot(vH, D) >= 0 ? 1 : -1;
  let sweep = dir > 0 ? aH - aT : aT - aH;
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { C, r, aT, dir, sweep };
}
const onArc = (g: Arc, t: number): Pt => [g.C[0] + g.r * Math.cos(g.aT + g.dir * t * g.sweep), g.C[1] + g.r * Math.sin(g.aT + g.dir * t * g.sweep)];

/**
 * The arc whose DRAWN head points along Dh: the head lies along the chord of the arc's last head length, which leans
 * out from the tangent (away from the centre) by asin(head / 2r); so the tangent is Dh turned that much toward the centre (four passes).
 */
function arcForHead(T: Pt, H: Pt, Dh: Pt, headLen: number): Arc | null {
  let D = Dh, g: Arc | null = null;
  for (let i = 0; i < 4; i++) {
    g = arcTangent(T, H, D);
    if (!g) return null;
    const beta = Math.asin(Math.min(1, headLen / (2 * g.r)));
    // Turned toward the centre (which lies at the tangent turned by dir × 90°).
    D = rot(Dh, g.dir * beta);
  }
  return g;
}

/** The drawn head (tip, barbs, notch) of an arc, as cdxmlRender draws it. */
function headOf(g: Arc, headLen: number, centre: number, width: number): Pt[] {
  const tip = onArc(g, 1);
  const back = (d: number): Pt => {
    // The point on the arc a chord of d back from the tip.
    const a = 2 * Math.asin(Math.min(1, d / (2 * g.r)));
    const t = Math.max(0, 1 - a / g.sweep);
    return onArc(g, t);
  };
  const P = back(headLen), Cn = back(Math.min(centre, headLen));
  const u = unit(sub(tip, P)), nn = right(u), base = sub(tip, mul(u, headLen));
  return [tip, addp(base, mul(nn, width)), Cn, sub(base, mul(nn, width))];
}

interface Scored {
  plan: CurvedPlan;
  cost: number;
  side: number;
}

/**
 * Every clean arc from one end to the other, best first per bow. `hopSide`: for a bond to one of its own atoms, the
 * side its default bows to (0: no such rule).
 */
function search(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, o: PlanOptions): { best: Map<1 | -1, Scored>; hopSide: number; partner?: number; reason?: string } {
  const ctx = planContext(doc, o.exclude);
  const A = endOf(ctx, from), B = endOf(ctx, to);
  const none = { best: new Map<1 | -1, Scored>(), hopSide: 0 };
  if (!A || !B) return { ...none, reason: "that atom or bond is no longer on the page" };
  if (A.id && A.id === B.id) return { ...none, reason: "a curved arrow runs from one atom or bond to another — it starts and ends on the same one here" };
  const { L, lw } = ctx;
  if (!(len(sub(B.p, A.p)) > L * 0.2)) return { ...none, reason: "drag further: the arrow's two ends are in the same place" };
  const quick = !!o.quick;
  const headLen = (Number(CURVED_HEAD.HeadSize) / 100) * lw, centreLen = (Number(CURVED_HEAD.ArrowheadCenterSize) / 100) * lw, headW = (Number(CURVED_HEAD.ArrowheadWidth) / 100) * lw;
  // A bond to one of its own atoms (or an atom to its own bond): the side decided by the bond alone — or, for the
  // second fishhook of a homolysis, the side its partner (from the same bond to the other atom) already took.
  const toOwnAtom = A.kind === "bond" && B.kind === "atom" && A.atoms.includes(B.id!);
  let hopSide = 0, hopBond: BondInfo | null = null, partner = 0;
  if (toOwnAtom) hopBond = ctx.bonds.get(A.bond!)!;
  if (B.kind === "bond" && A.kind === "atom" && B.atoms.includes(A.id!)) hopBond = ctx.bonds.get(B.bond!)!;
  if (hopBond) hopSide = freeSide(ctx, hopBond);
  if (toOwnAtom && o.electrons === 1) {
    const h = ctx.hooks.find((x) => x.source === A.bond && x.target !== B.id && A.atoms.includes(x.target));
    if (h) hopSide = partner = h.side;
  }
  // The shaft at least as long again as its head (a bond to its own atom: 0.6 of it), the arc no tighter than the head is long.
  const need = toOwnAtom ? headLen * 1.6 : Math.max(headLen * 2, headLen + L * 0.3), rmin = headLen * 0.9;
  const c0 = len(sub(B.p, A.p));
  const ideal = (Math.max(SWEEP_LONG, Math.min(SWEEP_SHORT, SWEEP_SHORT - ((c0 - 1.5 * L) / (2.5 * L)) * (SWEEP_SHORT - SWEEP_LONG))) * Math.PI) / 180;
  const lo = (SWEEP_LO * Math.PI) / 180, hi = (SWEEP_HI * Math.PI) / 180;
  // Ends that share an atom (a bond to its own atom or the next bond, an atom to its own bond): a short hop.
  const wide = A.atoms.some((x) => B.atoms.includes(x));
  // A fishhook from a bond between two labelled atoms (Br–Br, O–O) to one of them: half a homolysis, its tail on that atom's half.
  const own = toOwnAtom ? { target: B.id!, half: o.electrons === 1 && A.atoms.every((x) => ctx.ink.has(x)) } : null;
  // (A tail round its atom's letters is best on the side facing its target.)
  const tails = tailCands(ctx, A, quick, wide, own, unit(sub(B.p, A.p))), heads = headCands(ctx, B, quick, wide);
  // Every construction first (cheap), then the clearance checks in order of score, stopping once none can win.
  type Cand = { g: Arc; T: Pt; H: Pt; base: number; tc: TailCand };
  const cands: Cand[] = [];
  for (const tc of tails)
    for (const hc of heads) {
      const chord = len(sub(hc.H, tc.T));
      if (!(chord > lw * 4)) continue;
      const g = arcForHead(tc.T, hc.H, hc.D, headLen);
      if (planDebug.seen && planDebug.counts && g) planDebug.seen.push({ T: tc.T, H: hc.H, D: hc.D, sweep: (g.sweep * 180) / Math.PI, r: g.r });
      if (!g) { dbg("nocircle"); continue; }
      if (g.sweep < lo) { dbg("sweepLo"); continue; }
      if (g.sweep > hi) { dbg("sweepHi"); continue; }
      if (g.r < rmin || g.r * g.sweep < need) { dbg("short"); continue; }
      if (tc.out) {
        const vT: Pt = [-Math.sin(g.aT) * g.dir, Math.cos(g.aT) * g.dir];
        if (dot(vT, tc.out) < (A.kind === "bond" ? 0.25 : 0.15)) { dbg("tailDir"); continue; }
      }
      const mid = onArc(g, 0.5), cm = mul(addp(tc.T, hc.H), 0.5);
      const bulge = unit(sub(mid, cm));
      const base = Math.abs(g.sweep - ideal) / ((30 * Math.PI) / 180) + tc.cost + hc.cost + (tc.inner ? 0.3 : 0) + 0.15 * bulge[1] * (Math.abs(bulge[1]) > 0.3 ? 1 : 0);
      cands.push({ g, T: tc.T, H: hc.H, base, tc });
    }
  cands.sort((x, y) => x.base - y.base);
  // The best clean arc per (side of a hop's bond, bow).
  const bests = new Map<string, Scored>();
  const sideOf = (g: Arc): number => {
    if (!hopBond) return 0;
    const pa = ctx.nodes.get(hopBond.b)!.p, pb = ctx.nodes.get(hopBond.e)!.p;
    return Math.sign(cross(unit(sub(pb, pa)), sub(onArc(g, 0.5), mul(addp(pa, pb), 0.5))));
  };
  const ROOM = 0.3;
  let checked = 0;
  for (const c of cands) {
    const bow = c.g.dir;
    const side = sideOf(c.g);
    const key = side + "|" + bow;
    const cur = bests.get(key);
    if (cur && c.base - ROOM >= cur.cost) continue;
    if (++checked > (quick ? 400 : 4000)) break;
    const room = clearance(ctx, c.g, headOf(c.g, headLen, centreLen, headW), A, B, c.H, quick);
    if (room < 0) continue;
    const cost = c.base - ROOM * Math.min(1, room / 2);
    if (!cur || cost < cur.cost) {
      const plan: CurvedPlan = { tail: c.T, head: c.H, center: c.g.C, r: c.g.r, angularSize: (-bow * c.g.sweep * 180) / Math.PI, bow, clash: 0 };
      if (A.id) plan.source = A.id;
      if (B.id) plan.target = B.id;
      bests.set(key, { plan, cost, side });
    }
  }
  const all = [...bests.values()];
  const bestOf = (f: (v: Scored) => boolean): Scored | undefined => all.filter(f).sort((x, y) => x.cost - y.cost)[0];
  const out = new Map<1 | -1, Scored>();
  // A hop: its default side's best stands for its bow; the other bow takes its own best.
  const hs = hopBond ? bestOf((v) => v.side === hopSide) : undefined;
  if (hs) out.set(hs.plan.bow, hs);
  for (const b of [1, -1] as const) {
    if (out.has(b)) continue;
    const v = bestOf((x) => x.plan.bow === b);
    if (v) out.set(b, v);
  }
  return { best: out, hopSide: hs ? hopSide : 0, partner };
}

/** The side of a bond (of right(dB)) with fewer neighbours of its two atoms; on a tie the upper side, then the right. */
function freeSide(ctx: PlanCtx, b: BondInfo): number {
  const pa = ctx.nodes.get(b.b)!.p, pb = ctx.nodes.get(b.e)!.p, dB = unit(sub(pb, pa)), nR = right(dB);
  let sum = 0;
  for (const at of [b.b, b.e])
    for (const id of ctx.atBonds.get(at) ?? []) {
      if (id === b.id) continue;
      const o = ctx.bonds.get(id)!;
      const q = ctx.nodes.get(o.b === at ? o.e : o.b)!.p;
      sum += Math.sign(cross(dB, sub(q, ctx.nodes.get(at)!.p)));
    }
  if (sum) return -Math.sign(sum);
  if (Math.abs(nR[1]) > 1e-6) return nR[1] < 0 ? 1 : -1;
  return nR[0] > 0 ? 1 : -1;
}

/**
 * How much room an arc leaves (the smallest margin over every clearance, points), or a negative number when it runs
 * into anything: other bonds' lines, letters, charge signs and radical dots, captions, other arrows; its own bond (it
 * must not cross it) and its own atoms' letters (it may pass close).
 */
function clearance(ctx: PlanCtx, g: Arc, head: Pt[], A: End, B: End, H: Pt, quick: boolean): number {
  const { L, lw } = ctx;
  const n = quick ? 12 : 24;
  const shaft: Pt[] = [];
  for (let i = 0; i <= n; i++) shaft.push(onArc(g, i / n));
  const T = shaft[0];
  // The ink as segments: the shaft, and the head's outline (tip, barb, notch, barb).
  const sSegs: Array<[Pt, Pt]> = [];
  for (let i = 0; i < n; i++) sSegs.push([shaft[i], shaft[i + 1]]);
  const hSegs: Array<[Pt, Pt]> = head.map((q, i) => [q, head[(i + 1) % head.length]] as [Pt, Pt]);
  const all = [...sSegs, ...hSegs];
  const ownAtoms = new Set([...A.atoms, ...B.atoms]);
  // First, fast: does the shaft's middle run across another bond (each segment against its own cells only)? Most
  // arcs that fail fail there, and a long arc over a crowded page would otherwise gather hundreds of obstacles.
  const reqMain = Math.max(lw + CLEAR.bondInk, CLEAR.bondMain * L);
  for (let i = Math.floor(n / 4); i < Math.ceil((3 * n) / 4); i++) {
    const [p, q] = sSegs[i];
    const hit = ctx.grid.query(Math.min(p[0], q[0]) - reqMain, Math.min(p[1], q[1]) - reqMain, Math.max(p[0], q[0]) + reqMain, Math.max(p[1], q[1]) + reqMain);
    for (const sg of hit.segs) {
      if (!sg.main || sg.arrow) continue;
      const bd = ctx.bonds.get(sg.bond!)!;
      if (ownAtoms.has(bd.b) || ownAtoms.has(bd.e)) continue;
      if (segSegDist(p, q, sg.a, sg.b) < reqMain) return dbg("fastShaft");
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of [...shaft, ...head]) (x0 = Math.min(x0, q[0])), (y0 = Math.min(y0, q[1])), (x1 = Math.max(x1, q[0])), (y1 = Math.max(y1, q[1]));
  const m = CLEAR.bondMain * L + 2;
  const near = ctx.grid.query(x0 - m, y0 - m, x1 + m, y1 + m);
  const ownBonds = new Set([A.bond, B.bond].filter((x): x is string => !!x));
  let room = Infinity;
  const need = (d: number, req: number): boolean => {
    room = Math.min(room, d - req);
    return d >= req;
  };
  // A shared target point (two hooks meeting to form a bond): their heads may meet there.
  const meet = new Set([...ctx.tips.entries()].filter(([, tp]) => B.kind === "at" && len(sub(tp, H)) < 1).map(([id]) => id));
  // (The heads' own region: within 5 pt of the shared point.)
  const nearH = (s: [Pt, Pt]): boolean => Math.min(len(sub(s[0], H)), len(sub(s[1], H))) < 5;
  for (const sg of near.segs) {
    if (sg.arrow) {
      const shared = meet.has(sg.arrow) && Math.min(len(sub(sg.a, H)), len(sub(sg.b, H))) < 5;
      for (const s of all) {
        if (shared && nearH(s)) continue;
        if (!need(segSegDist(s[0], s[1], sg.a, sg.b), lw + CLEAR.arrow)) return dbg("arrow");
      }
      continue;
    }
    const bd = ctx.bonds.get(sg.bond!)!;
    if (ownBonds.has(bd.id)) {
      // Its own bond: never crossed (the tail starts beside it; the tip stops short of it).
      for (let i = 1; i < sSegs.length - 1; i++) if (!need(segSegDist(sSegs[i][0], sSegs[i][1], sg.a, sg.b), lw / 2 + 0.6)) return dbg("ownBond");
      // A head kept 0.15 bond length off its own source bond as off any other.
      if (sg.main && bd.id !== B.bond) for (const q of head) if (!need(distToTrace([sg.a, sg.b], q), CLEAR.headBond * L + 0.1)) return dbg("headBond");
      continue;
    }
    const ends = [bd.b, bd.e].filter((id) => ownAtoms.has(id)).map((id) => ctx.nodes.get(id)!.p);
    // An end's own bonds meet the end: not measured within 0.35 bond length of that atom, near the arrow's own end
    // (an arc swinging round a shared atom further along must still not cross its other bonds).
    const exempt = (q: Pt): boolean => ends.some((e) => len(sub(q, e)) < 0.35 * L) && (len(sub(q, T)) < 0.35 * L || len(sub(q, H)) < 0.35 * L);
    const req = sg.main ? Math.max(lw + CLEAR.bondInk, CLEAR.bondMain * L) : lw + CLEAR.bondInk;
    for (const s of sSegs) {
      // (Exempt from the clearance, never from crossing: an arc may pass close by its own atom's other bonds, not over them.)
      if (exempt(s[0]) && exempt(s[1])) {
        if (sg.main && !need(segSegDist(s[0], s[1], sg.a, sg.b), lw + 0.3)) return dbg("crossNearEnd");
        continue;
      }
      if (!need(segSegDist(s[0], s[1], sg.a, sg.b), req)) return dbg(planDebug.counts ? "bondShaft:" + bd.id + (sg.main ? "" : "'") : "");
    }
    for (const q of head) {
      if (sg.main && bd.id !== B.bond) {
        if (!need(distToTrace([sg.a, sg.b], q), CLEAR.headBond * L + 0.1)) return dbg("headBond");
      } else if (!sg.main && !exempt(q) && !need(distToTrace([sg.a, sg.b], q), lw + CLEAR.bondInk)) return dbg("head2nd");
    }
  }
  for (const bi of near.boxes) {
    const own = bi.kind === "label" && !!bi.node && ownAtoms.has(bi.node);
    const req = lw / 2 + (bi.kind === "glyph" || bi.kind === "caption" ? CLEAR.glyph : own ? CLEAR.ownLabel : CLEAR.label);
    for (const s of all) if (!need(segBoxDist(s[0], s[1], bi.bx), req)) return dbg(planDebug.counts ? "box-" + bi.kind + (own ? "-own" : "") : "");
  }
  return Number.isFinite(room) ? room : 10;
}

/** Distance between two segments (0 when they cross). */
function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(distToTrace([c, d], a), distToTrace([c, d], b), distToTrace([a, b], c), distToTrace([a, b], d));
}

/**
 * The arrow from one end to the other, bowed to `bow`'s side: the best clean arc that way, or a reason (the ends
 * coincide, lie too close, or no clean arc bows that way here).
 */
export function planCurved(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, bow: 1 | -1, o: PlanOptions = {}): CurvedPlan | string {
  const s = search(doc, from, to, o);
  if (s.reason) return s.reason;
  return s.best.get(bow)?.plan ?? noArc(s.best.size > 0);
}

const noArc = (otherSide: boolean): string =>
  otherSide
    ? "no clean curve bows that way here — it would cross a bond, a label or another arrow; the arrow keeps the other side"
    : "no clean curve fits between these two — every arc would cross a bond, a label or another arrow; move the structures apart a little, or draw it to the bond or atom beside";

/**
 * The side a curved arrow bows to by default — its cleanest, best-shaped arc (a bond to its own atom: the bond's freer
 * side) — and the arrow planned each way, from one search (the preview runs this on every pointer move).
 */
export function bowAndPlans(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, o: PlanOptions = {}): { bow: 1 | -1; plans: Map<1 | -1, CurvedPlan | string> } {
  const s = search(doc, from, to, o);
  const plans = new Map<1 | -1, CurvedPlan | string>();
  for (const b of [1, -1] as const) plans.set(b, s.reason ?? s.best.get(b)?.plan ?? noArc(s.best.size > 0));
  const p = s.best.get(1), q = s.best.get(-1);
  let bow: 1 | -1 = 1;
  if (s.partner && p?.side !== s.partner && q?.side !== s.partner) {
    // The partner fishhook's side has no clean arc: refused rather than drawn on the other side (a homolysis's two
    // fishhooks share a side).
    const r = "no clean fishhook fits on its partner's side of this bond — the two fishhooks of a homolysis share a side; move the neighbouring atoms or labels a little";
    return { bow: 1, plans: new Map<1 | -1, CurvedPlan | string>([[1, r], [-1, s.best.get(-1)?.plan ?? r]]) };
  }
  if (s.hopSide && (p?.side === s.hopSide || q?.side === s.hopSide)) bow = p?.side === s.hopSide ? 1 : -1;
  else if (p && q) bow = q.cost < p.cost - 1e-9 ? -1 : 1;
  else if (q) bow = -1;
  return { bow, plans };
}

/** A plan's ellipse as ChemDraw's Center3D / MajorAxisEnd3D / MinorAxisEnd3D points. */
export function planAxes(p: CurvedPlan): { center: Pt; major: Pt; minor: Pt } {
  const a = p.axes?.major ?? [p.r, 0], b = p.axes?.minor ?? [0, p.r];
  return { center: p.center, major: addp(p.center, a), minor: addp(p.center, b) };
}

/** The barb of a fishhook on the outside of its curve: left of the way it runs when it bows left. */
export const fishhookSide = (bow: 1 | -1): "HalfLeft" | "HalfRight" => (bow === 1 ? "HalfLeft" : "HalfRight");
