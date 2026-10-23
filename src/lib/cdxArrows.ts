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
import type { Box, CdxArrow, CdxDoc, CdxNode, Pt } from "./cdxml";
import { chargeGlyph, radicalBox } from "./cdxGlyphs";

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
/** Turned by `ang` radians, anticlockwise on the page (y points down). */
const turn = (d: Pt, ang: number): Pt => [d[0] * Math.cos(ang) + d[1] * Math.sin(ang), -d[0] * Math.sin(ang) + d[1] * Math.cos(ang)];
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
/** The arc's sweep for a long arrow, and for a short one (degrees). */
const SWEEP_MIN = 75, SWEEP_MAX = 110;

export interface CurvedPlan {
  tail: Pt;
  head: Pt;
  center: Pt;
  r: number;
  /** Degrees, positive anticlockwise on the page (ChemDraw's AngularSize). */
  angularSize: number;
  /** +1: bowed to the left of the way it runs; −1: to the right. */
  bow: 1 | -1;
  /** An ellipse's semi-axes as vectors (a short hop); absent for a circle of radius r with axes along x and y. */
  axes?: { major: Pt; minor: Pt };
  /** How far it runs into other atoms' and bonds' clearance (0 = clear). */
  clash?: number;
  source?: string;
  target?: string;
}

interface EndInfo {
  p: Pt;
  id?: string;
  /** How far the arrow's end sits from p in direction d (clear of a label, off an atom's bonds). */
  reach: (d: Pt) => number;
  kind: "atom" | "bond" | "at";
  /** The label ink boxes at this end: the atom's own, or both of the bond's atoms' (a short hop keeps clear of them). */
  labels: Box[];
  /** Bonds the arrow may run close to at this end (the bond it starts or ends on; an atom's own bonds). */
  ownBonds: string[];
  /** For a double (or aromatic) bond: true when direction d leaves toward its inner line. */
  inner?: (d: Pt) => boolean;
  /** A bond end's own placement for an arrow leaving (or arriving) along d: near the bond's middle, beside its lines. */
  place?: (d: Pt, role: "tail" | "head") => Pt;
}
const labelBox = (n: CdxNode | undefined): Box | null => (n?.label?.box && n.label.runs.some((q) => q.text.trim()) ? n.label.box : null);

function nodesOf(doc: CdxDoc): Map<string, CdxNode> {
  const m = new Map<string, CdxNode>();
  for (const o of doc.objects) for (const it of o.items) if (it.kind === "fragment") for (const n of it.v.nodes) m.set(n.id, n);
  return m;
}

/** Where an end is, and how far its arrow keeps from it. Null when the atom or bond is not on the page. */
function resolve(doc: CdxDoc, end: ArrowEnd, role: "tail" | "head", nodes: Map<string, CdxNode>): EndInfo | null {
  const L = doc.style.bondLength, lw = doc.style.lineWidth;
  if ("at" in end) return end.at.every(Number.isFinite) ? { p: end.at, reach: () => 0, kind: "at", labels: [], ownBonds: [] } : null;
  if ("atom" in end) {
    const n = nodes.get(end.atom);
    if (!n) return null;
    const ownBonds: string[] = [];
    for (const o of doc.objects) for (const it of o.items) if (it.kind === "fragment") for (const b of it.v.bonds) if (b.b === n.id || b.e === n.id) ownBonds.push(b.id);
    const box = n.label?.box && n.label.runs.some((r) => r.text.trim()) ? n.label.box : null;
    if (!box) {
      // A bare vertex: off the bonds that meet there (a head tip a little farther, as it points into them).
      const r = (role === "tail" ? 0.2 : 0.22) * L;
      return { p: n.p, id: n.id, reach: () => r, kind: "atom", labels: [], ownBonds };
    }
    // A labelled atom: where the ray from the atom leaves its label's box, then a clear gap.
    const gap = (role === "tail" ? 0.12 : 0.1) * L + lw;
    return {
      p: n.p,
      id: n.id,
      kind: "atom",
      labels: [box],
      ownBonds,
      reach: (d) => {
        let t = Infinity;
        if (d[0] > 1e-9) t = Math.min(t, (box[2] - n.p[0]) / d[0]);
        if (d[0] < -1e-9) t = Math.min(t, (box[0] - n.p[0]) / d[0]);
        if (d[1] > 1e-9) t = Math.min(t, (box[3] - n.p[1]) / d[1]);
        if (d[1] < -1e-9) t = Math.min(t, (box[1] - n.p[1]) / d[1]);
        return (Number.isFinite(t) ? Math.max(0, t) : 0) + gap;
      },
    };
  }
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind !== "fragment") continue;
      const b = it.v.bonds.find((x) => x.id === end.bond);
      if (!b) continue;
      const pa = nodes.get(b.b)?.p, pb = nodes.get(b.e)?.p;
      if (!pa || !pb) return null;
      const r = (role === "tail" ? 0.2 : 0.16) * L;
      const mid = mul(addp(pa, pb), 0.5);
      // Between two labels the bond's middle can lie inside a label's box (Br–Br): the end leaves that box first.
      const boxes = [nodes.get(b.b), nodes.get(b.e)]
        .map((n) => (n?.label?.box && n.label.runs.some((q) => q.text.trim()) ? n.label.box : null))
        .filter((x): x is [number, number, number, number] => !!x && mid[0] > x[0] && mid[0] < x[2] && mid[1] > x[1] && mid[1] < x[3]);
      // A double bond's second line (as cdxmlRender places it: DoublePosition; else toward the ring's centre; else toward
      // the side with more neighbours; centred otherwise), so the tail starts clear of both lines (review: a tail sat on
      // the inner line of a ring's double bond).
      const order = b.order.split(/\s+/)[0];
      const gap = doc.style.bondGap;
      const dB = unit(sub(pb, pa)), nR = right(dB);
      let side = 0; // +1: the second line lies on nR's side
      if (order === "2" || order === "1.5") {
        if (b.doublePosition === "Right") side = 1;
        else if (b.doublePosition === "Left") side = -1;
        else if (b.doublePosition !== "Center") {
          const ring = ringCentre(it.v, b);
          if (ring) side = Math.sign(cross(dB, sub(ring, pa))) || 0;
          else {
            let sum = 0;
            for (const o2 of it.v.bonds) {
              if (o2 === b) continue;
              const other = o2.b === b.b || o2.b === b.e ? o2.e : o2.e === b.b || o2.e === b.e ? o2.b : null;
              const q = other ? nodes.get(other)?.p : undefined;
              if (q) sum += Math.sign(cross(dB, sub(q, pa)));
            }
            side = Math.sign(sum);
          }
        }
      }
      const multiple = order === "2" || order === "1.5" || order === "3";
      /** How far off the bond's own line the lines on d's side reach (0 for the outer side of an offset double bond). */
      const lineOff = (d: Pt): number => {
        if (!multiple) return 0;
        if (order === "3") return gap;
        if (side === 0) return gap / 2;
        return Math.sign(d[0] * nR[0] + d[1] * nR[1]) === side ? gap : 0;
      };
      const inner = multiple && order !== "3" && side !== 0 ? (d: Pt): boolean => Math.sign(d[0] * nR[0] + d[1] * nR[1]) === side : undefined;
      const reach = (d: Pt): number => {
        let t = 0;
        // Clear of the lines on its side by 1.5 pt (measured across the bond).
        const across = Math.abs(d[0] * nR[0] + d[1] * nR[1]);
        if (multiple) t = Math.min((lineOff(d) + lw / 2 + 1.5) / Math.max(across, 0.3), 0.6 * L);
        for (const box of boxes) {
          let e = Infinity;
          if (d[0] > 1e-9) e = Math.min(e, (box[2] - mid[0]) / d[0]);
          if (d[0] < -1e-9) e = Math.min(e, (box[0] - mid[0]) / d[0]);
          if (d[1] > 1e-9) e = Math.min(e, (box[3] - mid[1]) / d[1]);
          if (d[1] < -1e-9) e = Math.min(e, (box[1] - mid[1]) / d[1]);
          if (Number.isFinite(e)) t = Math.max(t, e + lw);
        }
        return Math.max(r, t);
      };
      const labels = [nodes.get(b.b), nodes.get(b.e)].map(labelBox).filter((x): x is Box => !!x);
      // The end placed by rule (review round 2): within a quarter bond of the middle, measured along the bond; beside
      // the lines on d's side — a tail 1.5 pt clear of the drawn lines, a head's tip 1.1 pt (as a tip stops short of an
      // atom's label) — and out of the bond's atoms' labels.
      const place = (d: Pt, role2: "tail" | "head"): Pt => {
        const sgn = Math.sign(d[0] * nR[0] + d[1] * nR[1]) || 1;
        const along = Math.max(-0.25 * L, Math.min(0.25 * L, (d[0] * dB[0] + d[1] * dB[1]) * 0.2 * L));
        let q = addp(addp(mid, mul(dB, along)), mul(nR, sgn * (lineOff(d) + lw / 2 + (role2 === "tail" ? 1.5 : 1.1))));
        const inBox = (z: Pt): boolean => labels.some((bx) => z[0] > bx[0] - 1.5 && z[0] < bx[2] + 1.5 && z[1] > bx[1] - 1.5 && z[1] < bx[3] + 1.5);
        for (let k = 0; k < 24 && inBox(q); k++) q = addp(q, mul(nR, sgn));
        return q;
      };
      return { p: mid, id: b.id, reach, kind: "bond", labels, ownBonds: [b.id], place, ...(inner ? { inner } : {}) };
    }
  return null;
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

/** What an arrow must keep clear of: every bond and label on the page but its own ends' (near the chord only). */
interface Obstacles {
  segs: Array<[Pt, Pt]>;
  /** For the head: every line but its target bond's — the source's bonds and the target atom's own included (review
   * round 2: a head between two adjacent bonds lay on the source's lines). */
  headSegs: Array<[Pt, Pt]>;
  boxes: Box[];
}
function obstaclesFor(doc: CdxDoc, A: EndInfo, B: EndInfo, nodes: Map<string, CdxNode>): Obstacles {
  const own = new Set([...A.ownBonds, ...B.ownBonds]);
  const ownBoxes = new Set<Box>([...A.labels, ...B.labels]);
  const c = len(sub(B.p, A.p)), L = doc.style.bondLength;
  const m = c * 0.75 + L;
  const lo: Pt = [Math.min(A.p[0], B.p[0]) - m, Math.min(A.p[1], B.p[1]) - m], hi: Pt = [Math.max(A.p[0], B.p[0]) + m, Math.max(A.p[1], B.p[1]) + m];
  const inside = (q: Pt): boolean => q[0] >= lo[0] && q[0] <= hi[0] && q[1] >= lo[1] && q[1] <= hi[1];
  const segs: Array<[Pt, Pt]> = [], headSegs: Array<[Pt, Pt]> = [], boxes: Box[] = [];
  // Charges and radicals a symbol on the page draws are boxed as that symbol, below.
  const chargeDrawn = new Set<string>(), radicalDrawn = new Set<string>();
  for (const o of doc.objects)
    for (const it of o.items)
      if (it.kind === "graphic")
        for (const c of it.v.el.children)
          if (c.name === "represent" && c.attrs.object) (c.attrs.attribute === "Charge" ? chargeDrawn : c.attrs.attribute === "Radical" ? radicalDrawn : new Set<string>()).add(c.attrs.object);
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind !== "fragment") continue;
      for (const b of it.v.bonds) {
        if (B.kind === "bond" && b.id === B.id) continue;
        const pa = nodes.get(b.b)?.p, pb = nodes.get(b.e)?.p;
        if (!pa || !pb || (!inside(pa) && !inside(pb))) continue;
        const lines: Array<[Pt, Pt]> = [[pa, pb]];
        // A multiple bond's other lines are ink too (either side: the clearance is measured to what is drawn).
        const ord = b.order.split(/\s+/)[0];
        if (ord === "2" || ord === "1.5" || ord === "3") {
          const n = mul(right(unit(sub(pb, pa))), doc.style.bondGap);
          lines.push([addp(pa, n), addp(pb, n)], [sub(pa, n), sub(pb, n)]);
        }
        headSegs.push(...lines);
        if (!own.has(b.id)) segs.push(...lines);
      }
      for (const n of it.v.nodes) {
        const bx = labelBox(n);
        if (bx && !ownBoxes.has(bx) && inside(n.p)) boxes.push(bx);
        // Its charge sign and radical dots, the target's own included: a head must not land on E⁺ (review round 2).
        if (n.charge && !chargeDrawn.has(n.id) && inside(n.p)) boxes.push(chargeGlyph(doc.style, n).box);
        const rad = n.el.attrs.Radical;
        if (rad && rad !== "None" && !radicalDrawn.has(n.id) && inside(n.p)) boxes.push(radicalBox(doc.style, n, rad));
      }
    }
  // Captions and symbols (⊕, ⊖, lone pairs) on the page.
  for (const o of doc.objects)
    for (const it of o.items) {
      if (it.kind === "text" && it.v.box && (inside([it.v.box[0], it.v.box[1]]) || inside([it.v.box[2], it.v.box[3]]))) boxes.push(it.v.box);
      if (it.kind === "graphic" && it.v.kind === "Symbol" && inside(it.v.p1)) {
        const rr = Math.max(len(sub(it.v.p2, it.v.p1)) / 3, doc.style.labelSize * 0.25);
        boxes.push([it.v.p1[0] - rr, it.v.p1[1] - rr, it.v.p1[0] + rr, it.v.p1[1] + rr]);
      }
    }
  return { segs, headSegs, boxes };
}

/** How far into the clearance of bonds (0.2 bond length) and labels (1.5 pt) the arc's middle runs: 0 when clear. */
function clashOf(ob: Obstacles, P: (t: number) => Pt, L: number, head: Pt[] = []): number {
  let s = 0;
  const bondClear = 0.2 * L, boxClear = 1.5, headClear = 0.15 * L;
  const qs: Pt[] = [];
  for (let i = 1; i < 20; i++) qs.push(P(0.08 + (0.84 * i) / 20));
  // Only what lies near the arc's own box is measured.
  const m = bondClear + boxClear, pts = [...qs, ...head];
  const x0 = Math.min(...pts.map((q) => q[0])) - m, x1 = Math.max(...pts.map((q) => q[0])) + m;
  const y0 = Math.min(...pts.map((q) => q[1])) - m, y1 = Math.max(...pts.map((q) => q[1])) + m;
  const near = ([a, b]: [Pt, Pt]): boolean => Math.max(a[0], b[0]) >= x0 && Math.min(a[0], b[0]) <= x1 && Math.max(a[1], b[1]) >= y0 && Math.min(a[1], b[1]) <= y1;
  const segs = ob.segs.filter(near), headSegs = ob.headSegs.filter(near);
  const boxes = ob.boxes.filter((bx) => bx[2] >= x0 && bx[0] <= x1 && bx[3] >= y0 && bx[1] <= y1);
  if (!segs.length && !headSegs.length && !boxes.length) return 0;
  // The head too (its tip, barbs and middle): clear of other bonds by 0.15 bond length, of labels by 1.5 pt (review:
  // a head inside a ring crowded the next double bond's inner line).
  for (const q of head) {
    for (const sg of headSegs) s += 3 * Math.max(0, headClear - distToTrace(sg, q));
    for (const bx of boxes) s += Math.max(0, boxClear - Math.hypot(Math.max(0, bx[0] - q[0], q[0] - bx[2]), Math.max(0, bx[1] - q[1], q[1] - bx[3])));
  }
  for (const q of qs) {
    for (const sg of segs) s += Math.max(0, bondClear - distToTrace(sg, q));
    for (const bx of boxes) s += Math.max(0, boxClear - Math.hypot(Math.max(0, bx[0] - q[0], q[0] - bx[2]), Math.max(0, bx[1] - q[1], q[1] - bx[3])));
  }
  return s;
}

/** Arc length of a circular arc on chord c sweeping θ (radians). */
const arcLen = (c: number, th: number): number => (c * (th / 2)) / Math.sin(th / 2);

/**
 * The arrow from one end to the other, bowed to `bow`'s side: its ends set back from the atoms along the way the arc
 * leaves and arrives, the sweep the smallest from SWEEP_MIN that gives the shaft room beyond its head. A reason when
 * the ends coincide or lie too close for an arrow.
 */
export function planCurved(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd, bow: 1 | -1): CurvedPlan | string {
  const nodes = nodesOf(doc);
  const A = resolve(doc, from, "tail", nodes), B = resolve(doc, to, "head", nodes);
  if (!A || !B) return "that atom or bond is no longer on the page";
  if (A.id && A.id === B.id) return "a curved arrow runs from one atom or bond to another — it starts and ends on the same one here";
  const L = doc.style.bondLength, lw = doc.style.lineWidth;
  const chord0 = sub(B.p, A.p);
  if (!(len(chord0) > L * 0.2)) return "drag further: the arrow's two ends are in the same place";
  const headLen = (Number(CURVED_HEAD.HeadSize) / 100) * lw;
  // The shaft at least as long again as its head, and the arc no tighter than the head is long: on a tighter arc the
  // head (laid along its last head length) points off the curve (walkthrough: a C–Br bond to its Br).
  const need = Math.max(headLen * 2, headLen + L * 0.3), rmin = headLen * 0.9;
  const d0 = unit(chord0), c0 = len(chord0);
  const deg = Math.PI / 180;
  // The sweep: SWEEP_MAX° across a bond or two, flattening to SWEEP_MIN° by four bonds (a long arrow that bowed as much
  // would tower over the scheme).
  const th = Math.max(SWEEP_MIN, Math.min(SWEEP_MAX, SWEEP_MAX - ((c0 - 2 * L) / (2 * L)) * (SWEEP_MAX - SWEEP_MIN))) * deg;
  // Candidates: the tail set back from its atom along the way the arc leaves (θ/2 off the chord toward the bow, or
  // steeper), the head set back the way it arrives (or farther round, landing on the far side of its atom), and the
  // arc through them at the sweep θ or rounder. Kept: an arc with room for its head and no tighter than the head is
  // long. Chosen: the one whose head points most nearly at its atom (or point), then the sweep nearest θ. Bounded:
  // 6 × 10 × 8 candidates. (A head aimed within 15° of its atom counts as aimed: a leaving group's arrow lands beside
  // its atom, heading on past it, as journals draw it.)
  let best: CurvedPlan | null = null, bestCost = Infinity;
  if (c0 < 1.2 * L && B.kind === "atom" && A.kind !== "at") {
    const hop = shortHop(A, B, d0, bow, L, lw, headLen * 1.6);
    if (hop) {
      if (A.id) hop.source = A.id;
      if (B.id) hop.target = B.id;
      return hop;
    }
  }
  const ob = obstaclesFor(doc, A, B, nodes);
  const headW = (Number(CURVED_HEAD.ArrowheadWidth) / 100) * lw;
  for (let i = 0; i < 6; i++) {
    // Never leaving backward, past square to the chord: two arrows from one bond (a homolysis) would cross.
    const bt = th / 2 + i * 12 * deg;
    if (bt > Math.PI / 2 + 1e-9) break;
    const out = turn(d0, bow * bt);
    const T = A.place ? A.place(out, "tail") : addp(A.p, mul(out, A.reach(out)));
    // Arrivals from θ/2 round to far beyond — and, nearer square-on (down to 12° off the chord), for a head that must
    // fit between other bonds (inside a ring).
    for (let j = -3; j < 10; j++) {
      const bh = th / 2 + j * 12 * deg;
      if (bh < 12 * deg) continue;
      const back = turn(mul(d0, -1), -bow * bh);
      const H = B.place ? B.place(back, "head") : addp(B.p, mul(back, B.reach(back)));
      const c = len(sub(H, T));
      if (!(c > lw)) continue;
      const d = unit(sub(H, T)), mid = mul(addp(T, H), 0.5);
      for (let k = 0; k < 8; k++) {
        const sw = th + k * 15 * deg;
        // Never past a half turn: a rounder arc curls back over its own tail (two from one bond cross).
        if (sw > Math.PI + 1e-9) break;
        const r = c / 2 / Math.sin(sw / 2);
        if (r < rmin || r * sw < need) continue;
        // Bowed left of the way it runs: the centre lies to the right of the chord (to the left past a half circle).
        const C = addp(mid, mul(right(d), bow * (c / 2 / Math.tan(sw / 2))));
        // The head lies along the chord of the arc's last head length: where it points.
        const aH = Math.atan2(H[1] - C[1], H[0] - C[0]), al = Math.min(sw, headLen / r);
        const aB = aH - bow * al; // clockwise (bow +1) runs with the angle increasing on the page
        const P: Pt = [C[0] + r * Math.cos(aB), C[1] + r * Math.sin(aB)];
        const hd = unit(sub(H, P)), toB = unit(sub(B.p, H));
        const aim = B.kind === "at" ? 0 : Math.acos(Math.max(-1, Math.min(1, hd[0] * toB[0] + hd[1] * toB[1])));
        // An arc that runs into another atom, label or bond is rejected in all but name (a rounder one that clears is
        // always cheaper); leaving a double bond toward its inner line costs a little (the outer side is the clean one).
        const innerCost = A.inner?.(out) ? 0.4 : 0;
        const base = 2 * Math.max(0, aim - 15 * deg) + 0.35 * (sw - th) + 0.15 * (bt - th / 2) + 0.1 * Math.abs(bh - th / 2) + innerCost;
        if (base >= bestCost) continue; // the clash can only add
        const aT = Math.atan2(T[1] - C[1], T[0] - C[0]);
        const hn = right(hd), base2 = sub(H, mul(hd, headLen));
        const headPts: Pt[] = [H, addp(base2, mul(hn, headW)), sub(base2, mul(hn, headW)), sub(H, mul(hd, headLen / 2))];
        const clash = clashOf(ob, (t) => [C[0] + r * Math.cos(aT + bow * t * sw), C[1] + r * Math.sin(aT + bow * t * sw)], L, headPts);
        const cost = base + 25 * clash;
        if (cost < bestCost) {
          bestCost = cost;
          best = { tail: T, head: H, center: C, r, angularSize: (-bow * sw * 180) / Math.PI, bow, clash };
        }
      }
    }
  }
  if (!best) return "the two ends are too close for a curved arrow to show its head — drag farther, or draw it to an atom or bond farther away";
  const plan = best;
  if (A.id) plan.source = A.id;
  if (B.id) plan.target = B.id;
  return plan;
}

/**
 * The side a curved arrow bows to by default — the one whose arc clears other atoms and bonds (then passes fewer of
 * them; over the top on a tie) — and the arrow planned each way (each planned once: the preview runs this on every
 * pointer move).
 */
export function bowAndPlans(doc: CdxDoc, from: ArrowEnd, to: ArrowEnd): { bow: 1 | -1; plans: Map<1 | -1, CurvedPlan | string> } {
  const plans = new Map<1 | -1, CurvedPlan | string>([[1, planCurved(doc, from, to, 1)], [-1, planCurved(doc, from, to, -1)]]);
  const L = doc.style.bondLength;
  const traceOf = (p: CurvedPlan): Pt[] => arrowTrace({ tail: p.tail, head: p.head, ...planAxes(p), angularSize: p.angularSize }, 16);
  const score = (bow: 1 | -1): number => {
    const p = plans.get(bow)!;
    if (typeof p === "string") return Infinity;
    const tr = traceOf(p);
    // Only what lies near the arc's box is measured.
    const xs = tr.map((q) => q[0]), ys = tr.map((q) => q[1]);
    const bx = [Math.min(...xs) - L, Math.min(...ys) - L, Math.max(...xs) + L, Math.max(...ys) + L];
    const near = (q: Pt): boolean => q[0] >= bx[0] && q[0] <= bx[2] && q[1] >= bx[1] && q[1] <= bx[3];
    let s = 0;
    for (const o of doc.objects)
      for (const it of o.items) {
        if (it.kind !== "fragment") continue;
        const pos = new Map(it.v.nodes.map((n) => [n.id, n.p]));
        for (const n of it.v.nodes) {
          if (n.id === p.source || n.id === p.target || !near(n.p)) continue;
          const dd = distToTrace(tr, n.p);
          if (dd < L * 0.6) s += 1 + (L * 0.6 - dd) / L;
        }
        for (const b of it.v.bonds) {
          if (b.id === p.source || b.id === p.target) continue;
          const pa = pos.get(b.b), pb = pos.get(b.e);
          if (!pa || !pb || (!near(pa) && !near(pb))) continue;
          const dd = Math.min(...tr.map((q) => distToTrace([pa, pb], q)));
          if (dd < L * 0.25) s += 1;
        }
      }
    return s;
  };
  const clash = (bow: 1 | -1): number => {
    const p = plans.get(bow)!;
    return typeof p === "string" ? Infinity : (p.clash ?? 0);
  };
  const cl = clash(1), cr = clash(-1);
  if (Math.abs(cl - cr) > 0.05) return { bow: cr < cl ? -1 : 1, plans };
  const left = score(1), rightS = score(-1);
  if (rightS !== left) return { bow: rightS < left ? -1 : 1, plans };
  // A tie (nothing in the way either side): over the top, as a mechanism is drawn — the side whose arc rises higher.
  const top = (bow: 1 | -1): number => {
    const p = plans.get(bow)!;
    return typeof p === "string" ? Infinity : Math.min(...traceOf(p).map((q) => q[1]));
  };
  return { bow: top(-1) < top(1) - 1e-6 ? -1 : 1, plans };
}

/** A plan's ellipse as ChemDraw's Center3D / MajorAxisEnd3D / MinorAxisEnd3D points. */
export function planAxes(p: CurvedPlan): { center: Pt; major: Pt; minor: Pt } {
  const a = p.axes?.major ?? [p.r, 0], b = p.axes?.minor ?? [0, p.r];
  return { center: p.center, major: addp(p.center, a), minor: addp(p.center, b) };
}

/**
 * A short hop (a bond to its own atom, an atom to its neighbour, a homolysis): the arrow does not shrink to the chord.
 * It is a flat arc over the labels, as textbook mechanism figures draw a bond to its leaving group:
 *   - the tail at the bond's middle, HOP_CLEAR above the bond line and HOP_CLEAR clear of every label's box — or, where
 *     the visible bond is too short for that (Br–Br), above the middle at the labels' top; nudged HOP_SPLIT toward its
 *     target, so the two arrows of a homolysis start apart, mirror images;
 *   - the tip over the target label's outer shoulder (HOP_LAND bond lengths past the atom, away from the tail),
 *     HOP_TIP above the label's top;
 *   - the apex HOP_APEX above the tallest label's top (higher where the arc would be flatter than HOP_ASPECT): a circle
 *     through tail and tip with its top there.
 * Worked in the frame along the chord (x, toward the target) and across it (y, toward the bow: "up").
 */
const HOP_CLEAR = 1.8, HOP_SPLIT = 1.2, HOP_LAND = 0.3, HOP_TIP = 1.2, HOP_APEX = 4.5, HOP_ASPECT = 0.52;
function shortHop(A: EndInfo, B: EndInfo, d0: Pt, bow: 1 | -1, L: number, lw: number, need: number): CurvedPlan | null {
  const w = turn(d0, bow * (Math.PI / 2)); // across the chord, on the side it bows to
  const O = A.p;
  const loc = (q: Pt): Pt => [(q[0] - O[0]) * d0[0] + (q[1] - O[1]) * d0[1], (q[0] - O[0]) * w[0] + (q[1] - O[1]) * w[1]];
  const page = (x: number, y: number): Pt => addp(O, addp(mul(d0, x), mul(w, y)));
  /** A page box in the chord's frame (its corners' extent). */
  const lbox = (bx: Box): Box => {
    const cs = [loc([bx[0], bx[1]]), loc([bx[2], bx[1]]), loc([bx[0], bx[3]]), loc([bx[2], bx[3]])];
    return [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))];
  };
  const boxesA = A.labels.map(lbox), boxesB = B.labels.map(lbox), all = [...boxesA, ...boxesB];
  const distBox = (p: Pt, bx: Box): number => Math.hypot(Math.max(0, bx[0] - p[0], p[0] - bx[2]), Math.max(0, bx[1] - p[1], p[1] - bx[3]));
  const top = (bxs: Box[]): number => Math.max(-Infinity, ...bxs.map((bx) => bx[3]));
  // The tail.
  let T: Pt;
  if (A.kind === "bond") {
    T = [HOP_SPLIT, lw / 2 + HOP_CLEAR];
    if (all.some((bx) => distBox(T, bx) < HOP_CLEAR)) T = [HOP_SPLIT, Math.max(T[1], top(boxesA) + HOP_CLEAR)];
  } else {
    const own = top(boxesA);
    T = [HOP_SPLIT, Number.isFinite(own) ? own + HOP_CLEAR : 0.22 * L];
  }
  // The tip.
  const b = loc(B.p);
  const tTop = top(boxesB);
  const H: Pt = [b[0] + HOP_LAND * L, Number.isFinite(tTop) ? tTop + HOP_TIP : b[1] + 0.25 * L];
  if (!(H[0] - T[0] > lw * 4)) return null;
  // The apex over the tallest label; never lower than a little above both ends.
  // And high enough for the arc's height to be about half its width (flatter reads as a line; taller as a hairpin).
  const span = H[0] - T[0];
  const apex = Math.max(Number.isFinite(top(all)) ? top(all) + HOP_APEX : -Infinity, Math.max(T[1], H[1]) + 1.5, Math.min(T[1], H[1]) + HOP_ASPECT * span);
  const dT = apex - T[1], dH = apex - H[1];
  // The circle with its top at the apex through both ends: (x − cx)² = 2r·d − d² at each end; r by bisection (bounded).
  const f = (r: number): number => Math.sqrt(Math.max(0, 2 * r * dT - dT * dT)) + Math.sqrt(Math.max(0, 2 * r * dH - dH * dH)) - span;
  let lo = Math.max(dT, dH) / 2, hi = Math.max(lo * 2, span * 4 + 1);
  if (f(lo) > 0) return null; // the apex is too high for so short a span
  for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < 0) lo = m;
    else hi = m;
  }
  const r = (lo + hi) / 2;
  const cx = T[0] + Math.sqrt(Math.max(0, 2 * r * dT - dT * dT)), cy = apex - r;
  const aT = Math.atan2(T[1] - cy, T[0] - cx), aH = Math.atan2(H[1] - cy, H[0] - cx);
  let sweep = aT - aH; // over the top, from the tail (left) to the tip (right)
  if (sweep <= 0) sweep += 2 * Math.PI;
  if (r * sweep < need) return null;
  // Over the top, bowed left of the way it runs: clockwise on the page, a negative AngularSize.
  return { tail: page(T[0], T[1]), head: page(H[0], H[1]), center: page(cx, cy), r, angularSize: (-bow * sweep * 180) / Math.PI, bow };
}

/** The barb of a fishhook on the outside of its curve: left of the way it runs when it bows left. */
export const fishhookSide = (bow: 1 | -1): "HalfLeft" | "HalfRight" => (bow === 1 ? "HalfLeft" : "HalfRight");
