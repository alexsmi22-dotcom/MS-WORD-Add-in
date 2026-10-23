// Measures a curved arrow as it is DRAWN — its arc sampled from the file's own ellipse, its head read from the
// markup the renderer emits — against the page's ink: bond lines (a multiple bond's lines on both sides, as the
// round-3 reviewer measured), the labels' letters (cdxGlyphs' model, which the renderer draws with), charge signs and
// radical dots where the renderer puts them, and every other arrow on the page. Independent of the planner's own
// clash numbers (a port of the reviewer's measure() in review-c3a/scenes.js, with ink boxes in place of the old
// estimated label boxes).
import type { Box, CdxArrow, CdxDoc, CdxNode, Pt } from "../cdxml";
import { arcOf, arrowTrace, distToTrace } from "../cdxArrows";
import { arrowMarkup } from "../cdxmlRender";
import { chargeGlyph, labelInk, radicalBox } from "../cdxGlyphs";

export interface ArrowMeasure {
  id: string;
  /** Clearance problems (empty: clean). */
  issues: string[];
  /** |AngularSize|, degrees. */
  sweep: number;
  /** Signed: +1 bowed to the left of tail→head on the page, −1 to the right. */
  side: number;
  tail: Pt;
  tip: Pt;
  /** Unit direction the head points. */
  dir: Pt;
  /** The arc's middle point. */
  mid: Pt;
  trace: Pt[];
  head: Pt[];
  source?: string;
  target?: string;
}

const dbox = (bx: Box, p: Pt): number => Math.hypot(Math.max(0, bx[0] - p[0], p[0] - bx[2]), Math.max(0, bx[1] - p[1], p[1] - bx[3]));

export function arrowsOf(d: CdxDoc): CdxArrow[] {
  return d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "arrow" ? [it.v] : []));
}
export function nodesOf(d: CdxDoc): Map<string, CdxNode> {
  const m = new Map<string, CdxNode>();
  for (const o of d.objects) for (const it of o.items) if (it.kind === "fragment") for (const n of it.v.nodes) m.set(n.id, n);
  return m;
}
export function bondsOf(d: CdxDoc): Array<{ id: string; b: string; e: string; order: string }> {
  return d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.bonds : []));
}
export function nbrPts(d: CdxDoc, id: string): Pt[] {
  const ns = nodesOf(d);
  return bondsOf(d)
    .filter((b) => b.b === id || b.e === id)
    .map((b) => ns.get(b.b === id ? b.e : b.b)?.p)
    .filter((q): q is Pt => !!q);
}

/** The head polygon(s) of an arrow as the renderer draws it. */
export function headPolygon(d: CdxDoc, ar: CdxArrow): Pt[] {
  const svg = arrowMarkup(d.style, ar, "#000").svg;
  const m = /<path d="M([-\d. L]+)Z"/.exec(svg);
  if (!m) return [];
  return m[1].split("L").map((s) => s.trim().split(/\s+/).map(Number) as Pt);
}

/** Thresholds (ink to ink, points): what a clean arrow keeps. */
export const CLEAR = { bond: 1.0, label: 1.0, ownLabel: 0.6, glyph: 1.0, arrow: 1.5, headBond: 0.15 } as const;

export function measureArrow(d: CdxDoc, id: string): ArrowMeasure {
  const st = d.style, L = st.bondLength, lw = st.lineWidth;
  const ar = arrowsOf(d).find((a) => a.id === id);
  if (!ar || !arcOf(ar)) throw new Error("no curved arrow " + id);
  const nodes = nodesOf(d), bonds = bondsOf(d);
  const src = ar.el.attrs.ArrowSource, tgt = ar.el.attrs.ArrowTarget;
  const ownB = new Set<string>(), ownN = new Set<string>();
  for (const e of [src, tgt]) {
    if (!e) continue;
    if (nodes.has(e)) ownN.add(e);
    const b = bonds.find((x) => x.id === e);
    if (b) (ownB.add(b.id), ownN.add(b.b), ownN.add(b.e));
  }
  const lines: Array<{ id: string; a: Pt; b: Pt; main: boolean }> = [];
  for (const b of bonds) {
    const pa = nodes.get(b.b)!.p, pb = nodes.get(b.e)!.p;
    lines.push({ id: b.id, a: pa, b: pb, main: true });
    const ord = b.order.split(/\s+/)[0];
    if (ord === "2" || ord === "1.5" || ord === "3") {
      // Where the renderer draws the other lines: a triple's both sides; a double's on its side (as cdxmlRender
      // decides it: DoublePosition, else inside its ring, else toward its neighbours; centred on a bond to a lone
      // labelled atom), or both half-gap lines for a centred one.
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], n = Math.hypot(dx, dy), g = st.bondGap;
      const off: Pt = [(-dy / n) * g, (dx / n) * g];
      const side = ord === "3" ? 2 : doubleSideOf(d, b.id);
      const offs = side === 2 ? [1, -1] : side === 0 ? [0.5, -0.5] : [side];
      for (const k of offs) lines.push({ id: b.id, a: [pa[0] + off[0] * k, pa[1] + off[1] * k], b: [pb[0] + off[0] * k, pb[1] + off[1] * k], main: false });
    }
  }
  const boxes: Array<{ what: string; node?: string; bx: Box; glyph: boolean }> = [];
  const chargeDrawn = new Set<string>();
  for (const o of d.objects) for (const it of o.items) if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.object) chargeDrawn.add(c.attrs.object);
  for (const n of nodes.values()) {
    const ink = labelInk(d.fonts, n);
    if (ink) boxes.push({ what: "label " + n.id + " " + n.label!.runs.map((r) => r.text).join(""), node: n.id, bx: ink, glyph: false });
    if (n.charge && !chargeDrawn.has(n.id)) boxes.push({ what: "charge " + n.id, node: n.id, bx: chargeGlyph(st, n, { nbrs: nbrPts(d, n.id), fonts: d.fonts, doc: d }).box, glyph: true });
    const r = n.el.attrs.Radical;
    if (r && r !== "None" && !chargeDrawn.has(n.id)) boxes.push({ what: "radical " + n.id, node: n.id, bx: radicalBox(st, n, r), glyph: true });
  }
  for (const o of d.objects) for (const it of o.items) if (it.kind === "text" && it.v.box) boxes.push({ what: "caption " + it.v.id, bx: it.v.box, glyph: false });
  const trace = arrowTrace(ar, 96), head = headPolygon(d, ar);
  const pts = [...trace, ...head];
  const issues: string[] = [];
  for (const ln of lines) {
    if (ownB.has(ln.id)) continue;
    const bd = bonds.find((x) => x.id === ln.id)!;
    let m = Infinity;
    for (const p of pts) {
      // An atom end's own bonds meet the end: not measured within 0.35 bond length of that atom.
      const nearOwn = [bd.b, bd.e].some((nid) => ownN.has(nid) && Math.hypot(p[0] - nodes.get(nid)!.p[0], p[1] - nodes.get(nid)!.p[1]) < 0.35 * L);
      if (!nearOwn) m = Math.min(m, distToTrace([ln.a, ln.b], p));
    }
    if (m - lw < CLEAR.bond) issues.push(`bond ${ln.id}${ln.main ? "" : "'"} ${(m - lw).toFixed(2)}pt`);
    // Crossing a bond is never exempt (an arc swung round its own atom must not run over that atom's other bonds).
    else if (ln.main && trace.some((p, i) => i > 0 && segsCross(trace[i - 1], p, ln.a, ln.b))) issues.push(`crosses bond ${ln.id}`);
  }
  // The head keeps 0.15 bond length (centre to centre) from every bond line but its target bond.
  for (const ln of lines) {
    if (!ln.main || ln.id === tgt) continue;
    const m = Math.min(Infinity, ...head.map((q) => distToTrace([ln.a, ln.b], q)));
    if (m < CLEAR.headBond * L - 0.05) issues.push(`head on bond ${ln.id} ${m.toFixed(2)}pt`);
  }
  for (const bx of boxes) {
    const own = !!bx.node && ownN.has(bx.node) && !bx.glyph;
    let m = Infinity;
    for (const p of pts) m = Math.min(m, dbox(bx.bx, p));
    m -= lw / 2;
    if (m < (own ? CLEAR.ownLabel : bx.glyph ? CLEAR.glyph : CLEAR.label)) issues.push(`${own ? "OWN " : ""}${bx.what} ${m.toFixed(2)}pt`);
  }
  for (const o of arrowsOf(d)) {
    if (o === ar) continue;
    let ot = arrowTrace(o, 96), oh = arcOf(o) ? headPolygon(d, o) : [];
    let mine = pts;
    // Two hooks meeting at one page point (forming a bond there): their heads meet; measured beyond 5 pt of it.
    const shared = !tgt && !o.el.attrs.ArrowTarget && Math.hypot(o.head[0] - ar.head[0], o.head[1] - ar.head[1]) < 1;
    if (shared) {
      const far = (q: Pt): boolean => Math.hypot(q[0] - ar.head[0], q[1] - ar.head[1]) >= 5;
      mine = pts.filter(far);
      ot = ot.filter(far);
      oh = oh.filter(far);
    }
    let m = Infinity;
    for (const p of mine) m = Math.min(m, ot.length > 1 ? distToTrace(ot, p) : Infinity, ...oh.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
    for (const q of oh) m = Math.min(m, distToTrace(mine, q));
    m -= lw;
    if (m < CLEAR.arrow) issues.push(`arrow ${o.id} ${m.toFixed(2)}pt`);
  }
  const sweep = Math.abs(ar.angularSize);
  if (sweep > 110 + 1e-6) issues.push(`sweep ${sweep.toFixed(0)}°`);
  const tip = head[0] ?? ar.head, notch = head[2] ?? trace[trace.length - 2];
  const dl = Math.hypot(tip[0] - notch[0], tip[1] - notch[1]) || 1;
  const midP = trace[48];
  const ch: Pt = [ar.head[0] - ar.tail[0], ar.head[1] - ar.tail[1]];
  const side = Math.sign(ch[0] * (midP[1] - ar.tail[1]) - ch[1] * (midP[0] - ar.tail[0])) * -1;
  return { id, issues, sweep, side, tail: ar.tail, tip, dir: [(tip[0] - notch[0]) / dl, (tip[1] - notch[1]) / dl], mid: midP, trace, head, source: src, target: tgt };
}

/** Do two segments cross? */
export function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** The side (+1: right of begin→end, y down) a double bond's second line is drawn on; 0 centred (cdxmlRender's rule). */
export function doubleSideOf(d: CdxDoc, bondId: string): number {
  for (const o of d.objects)
    for (const it of o.items) {
      if (it.kind !== "fragment") continue;
      const f = it.v, bd = f.bonds.find((x) => x.id === bondId);
      if (!bd) continue;
      if (bd.doublePosition === "Right") return 1;
      if (bd.doublePosition === "Left") return -1;
      if (bd.doublePosition === "Center") return 0;
      const pos = new Map(f.nodes.map((n) => [n.id, n]));
      const pa = pos.get(bd.b)!.p, pb = pos.get(bd.e)!.p, dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      const cr = (q: Pt): number => Math.sign(dx * (q[1] - pa[1]) - dy * (q[0] - pa[0]));
      // A ring (a path back of at most 7 bonds): toward its centre.
      const nb = new Map<string, string[]>();
      for (const x of f.bonds) {
        (nb.get(x.b) ?? nb.set(x.b, []).get(x.b)!).push(x.e);
        (nb.get(x.e) ?? nb.set(x.e, []).get(x.e)!).push(x.b);
      }
      const prev = new Map<string, string>([[bd.b, ""]]);
      let frontier = [bd.b];
      for (let depth = 0; depth < 7 && frontier.length; depth++) {
        const next: string[] = [];
        for (const v of frontier)
          for (const w of nb.get(v) ?? []) {
            if ((v === bd.b && w === bd.e) || prev.has(w)) continue;
            prev.set(w, v);
            if (w === bd.e) {
              const ring: Pt[] = [];
              for (let k: string = w; k; k = prev.get(k) ?? "") ring.push(pos.get(k)!.p);
              const c: Pt = [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
              return cr(c) || 0;
            }
            next.push(w);
          }
        frontier = next;
      }
      const others = (v: string, w: string): string[] => (nb.get(v) ?? []).filter((k) => k !== w);
      const ob = others(bd.b, bd.e), oe = others(bd.e, bd.b);
      const lab = (id: string): boolean => !!pos.get(id)?.label?.runs.some((q) => q.text.trim());
      if ((ob.length === 0 && lab(bd.b)) || (oe.length === 0 && lab(bd.e))) return 0;
      const s = [...ob, ...oe].reduce((acc, k) => acc + cr(pos.get(k)!.p), 0);
      return Math.sign(s);
    }
  return 0;
}

/** Does the ray from p along unit d pass through box b (grown by m)? */
export function rayHitsBox(p: Pt, d: Pt, b: Box, m = 0): boolean {
  let t0 = 0, t1 = 1e6;
  for (const [o, dd, lo, hi] of [[p[0], d[0], b[0] - m, b[2] + m], [p[1], d[1], b[1] - m, b[3] + m]] as const) {
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

/** Distance from the ray p + t d (t ≥ 0) to a point. */
export function rayDist(p: Pt, d: Pt, q: Pt): number {
  const t = Math.max(0, (q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]);
  return Math.hypot(p[0] + t * d[0] - q[0], p[1] + t * d[1] - q[1]);
}

export { dbox };
