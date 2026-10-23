// Scenes drawn through the editor API only (as a user draws them on the canvas), shared by the Release D pin table
// (canvasD.test.ts) and the mechanism-arrow case table (mechanismArrowD.test.ts). A port of the round-3 reviewer's
// scene builder (scratchpad review-c3a/scenes.js), so the table and the reviewer measure the same drawings.
import { readCdxml, readCdxmlTree, CdxDoc, Pt } from "../cdxml";
import {
  addAtomAt, addBondAt, addBondBetween, addBondToward, addCurvedArrow, addRingAt, addArrow, addCaption, blankPageCdxml, deleteInStructure, findById, setAtomLabel, setAtomProps, setBond, setCharge,
} from "../cdxmlEdit";
import type { ArrowEnd } from "../cdxArrows";

export const L = 14.4;
const rad = (d: number): number => (d * Math.PI) / 180;

export interface Scene {
  readonly doc: CdxDoc;
  atom(at: Pt, label: string): string;
  /** A bond from atom `id` toward `deg` (page degrees, y down); optional label for the new atom and order. */
  bond(id: string, deg: number, label?: string | null, order?: string): { b: string; n: string };
  join(a: string, b: string, order?: string): string;
  order(bid: string, order: string): void;
  seed(at: Pt): { b: string; n1: string; n2: string };
  charge(id: string, q: number): void;
  radical(id: string, k?: string): void;
  ring(at: Pt, kind?: "benzene" | "cyclohexane"): void;
  caption(at: Pt, t: string): void;
  straight(t: Pt, h: Pt, kind: "reaction" | "equilibrium" | "retrosynthetic" | "resonance"): void;
  pos(id: string): Pt;
  re(): CdxDoc;
  /** Adds a curved arrow (default bow, or flipped); the arrow's id, or the refusal. */
  curved(from: ArrowEnd, to: ArrowEnd, electrons?: 1 | 2, flip?: boolean): { id: string } | { reason: string };
  nodeNear(p: Pt): string;
  bondOf(a: string, b: string): string;
  del(id: string): void;
  /** The curved arrows added, in order (id, or the refusal). */
  readonly added: Array<{ id?: string; reason?: string; from: ArrowEnd; to: ArrowEnd; electrons: 1 | 2; flip: boolean }>;
}

export function scene(): Scene {
  const st = { doc: open(blankPageCdxml()) };
  const re = (): CdxDoc => {
    const r = readCdxmlTree(st.doc.root);
    if (!r.ok) throw new Error(r.reason);
    st.doc = r.doc;
    return st.doc;
  };
  const pos = (id: string): Pt => {
    const v = findById(st.doc.root, id)!.el.attrs.p.split(/\s+/).map(Number);
    return [v[0], v[1]];
  };
  const must = <T,>(r: T, what: string): T => {
    if (r && typeof r === "object" && (r as { ok?: boolean }).ok === false) throw new Error(what + ": " + (r as unknown as { reason: string }).reason);
    if (typeof r === "string") throw new Error(what + ": " + r);
    return r;
  };
  const added: Scene["added"] = [];
  const api: Scene = {
    added,
    get doc() {
      return st.doc;
    },
    atom(at, label) {
      const r = must(addAtomAt(st.doc, at, label), "atom " + label);
      return (r as { nodeId: string }).nodeId;
    },
    bond(id, deg, label, order) {
      const p = pos(id);
      const r = must(addBondToward(st.doc, id, [p[0] + L * Math.cos(rad(deg)), p[1] + L * Math.sin(rad(deg))], null), "bond") as { bondId: string; nodeId: string };
      if (label) must(setAtomLabel(st.doc, r.nodeId, label), "label " + label);
      if (order) must(setBond(st.doc, r.bondId, { order }), "order");
      return { b: r.bondId, n: r.nodeId };
    },
    join(a, b, order) {
      const r = must(addBondBetween(st.doc, a, b), "join") as { bondId: string };
      if (order) must(setBond(st.doc, r.bondId, { order }), "order");
      return r.bondId;
    },
    order(bid, order) {
      must(setBond(st.doc, bid, { order }), "order");
    },
    seed(at) {
      const r = must(addBondAt(st.doc, at), "seed") as { bondId: string };
      const b = findById(st.doc.root, r.bondId)!.el.attrs;
      return { b: r.bondId, n1: b.B, n2: b.E };
    },
    charge(id, q) {
      must(setCharge(st.doc, id, q), "charge");
    },
    radical(id, k = "Doublet") {
      must(setAtomProps(st.doc, id, { radical: k as never }), "radical");
    },
    ring(at, kind = "benzene") {
      must(addRingAt(st.doc, at, kind), "ring");
    },
    caption(at, t) {
      must(addCaption(st.doc, at, t), "caption");
    },
    straight(t, h, kind) {
      must(addArrow(st.doc, t, h, kind), "arrow");
    },
    pos,
    re,
    curved(from, to, electrons = 2, flip = false) {
      re();
      const r = addCurvedArrow(st.doc, from, to, { electrons, flip });
      re();
      added.push(r.ok ? { id: r.arrowId, from, to, electrons, flip } : { reason: r.reason, from, to, electrons, flip });
      return r.ok ? { id: r.arrowId } : { reason: r.reason };
    },
    nodeNear(p) {
      re();
      let best = "", bd = 1e9;
      for (const o of st.doc.objects)
        for (const it of o.items)
          if (it.kind === "fragment")
            for (const n of it.v.nodes) {
              const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
              if (d < bd) (bd = d), (best = n.id);
            }
      return best;
    },
    bondOf(a, b) {
      re();
      for (const o of st.doc.objects) for (const it of o.items) if (it.kind === "fragment") for (const x of it.v.bonds) if ((x.b === a && x.e === b) || (x.b === b && x.e === a)) return x.id;
      throw new Error(`no bond ${a}-${b}`);
    },
    del(id) {
      must(deleteInStructure(st.doc, id), "delete");
    },
  };
  return api;
}

export function open(src: string): CdxDoc {
  const r = readCdxml(src);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}

export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export { rad };

// ---- the mechanism scenes (the round-3 reviewer's, review-c3a/scenes.js; all drawn with the editor) ----------------

const bondNear = (m: Scene, at: Pt, order?: string): string => {
  m.re();
  let best = "", bd = 1e9;
  for (const o of m.doc.objects)
    for (const it of o.items)
      if (it.kind === "fragment") {
        const pos = new Map(it.v.nodes.map((q) => [q.id, q.p]));
        for (const b of it.v.bonds) {
          const pa = pos.get(b.b), pb = pos.get(b.e);
          if (!pa || !pb || (order && b.order.split(" ")[0] !== order)) continue;
          const d = Math.hypot((pa[0] + pb[0]) / 2 - at[0], (pa[1] + pb[1]) / 2 - at[1]);
          if (d < bd) (bd = d), (best = b.id);
        }
      }
  return best;
};

/** Named mechanism scenes; `flip` bows every curved arrow the other way. */
export const MECH: Record<string, (m: Scene, flip?: boolean) => void> = {
  sn2: (m, f = false) => {
    const o = m.atom([60, 100], "O");
    m.charge(o, -1);
    const br = m.atom([114.4, 100], "Br");
    const c = m.bond(br, 180).n;
    m.curved({ atom: o }, { atom: c }, 2, f);
    m.curved({ bond: m.bondOf(c, br) }, { atom: br }, 2, f);
  },
  sn2label: (m, f = false) => {
    const o = m.atom([55, 100], "O");
    m.charge(o, -1);
    const br = m.atom([114.4, 100], "Br");
    const c = m.bond(br, 180, "CH3").n;
    m.curved({ atom: o }, { atom: c }, 2, f);
    m.curved({ bond: m.bondOf(c, br) }, { atom: br }, 2, f);
  },
  // E2 on a straight (collinear) C–C with H up and Br down (review round 3, R3-05).
  e2: (m, f = false) => {
    const s = m.seed([90, 110]);
    const c1 = s.n1, c2 = s.n2;
    const h = m.bond(c1, 270, "H").n;
    const br = m.bond(c2, 90, "Br").n;
    m.bond(c1, 150);
    m.bond(c2, 330);
    const o = m.atom([60, 78], "O");
    m.charge(o, -1);
    m.curved({ atom: o }, { atom: h }, 2, f);
    m.curved({ bond: m.bondOf(c1, h) }, { bond: s.b }, 2, f);
    m.curved({ bond: m.bondOf(c2, br) }, { atom: br }, 2, f);
  },
  // HO⁻ up-left of a C=O drawn with O up (R3-04): the second arrow must keep off the first.
  carbonylAdd: (m, f = false) => {
    const s = m.seed([90, 115]);
    const cb = s.n2;
    m.bond(cb, 330);
    const ox = m.bond(cb, 270, "O", "2");
    const o = m.atom([62, 88], "O");
    m.charge(o, -1);
    m.curved({ atom: o }, { atom: cb }, 2, f);
    m.curved({ bond: ox.b }, { atom: ox.n }, 2, f);
  },
  acylCollapse: (m, f = false) => {
    const o = m.atom([100, 85.6], "O");
    m.charge(o, -1);
    const co = m.bond(o, 90);
    const c = co.n;
    m.bond(c, 180);
    const ome = m.bond(c, 90, "O");
    m.bond(ome.n, 150);
    const cl = m.bond(c, 0, "Cl");
    m.curved({ atom: o }, { bond: co.b }, 2, f);
    m.curved({ bond: cl.b }, { atom: cl.n }, 2, f);
  },
  eas1: (m, f = false) => {
    m.ring([100, 100], "benzene");
    const n = m.atom([138, 72], "NO2");
    m.charge(n, 1);
    m.curved({ bond: bondNear(m, [138, 72], "2") }, { atom: n }, 2, f);
  },
  // Arenium (EAS step 2), C⁺ at the upper-left vertex, NO2 on the sp3 carbon (R3-01b).
  eas2: (m, f = false) => {
    m.ring([100, 100], "cyclohexane");
    const top = m.nodeNear([107.2, 87.53]), c6 = m.nodeNear([114.4, 100]), c7 = m.nodeNear([107.2, 112.47]), c8 = m.nodeNear([92.8, 112.47]), c9 = m.nodeNear([85.6, 100]), ul = m.nodeNear([92.8, 87.53]);
    m.order(m.bondOf(c6, c7), "2");
    m.order(m.bondOf(c8, c9), "2");
    m.charge(ul, 1);
    const h = m.bond(top, 270, "H");
    m.bond(top, 330, "NO2");
    m.curved({ bond: h.b }, { bond: m.bondOf(top, ul) }, 2, f);
  },
  // Arenium with C⁺ at the right vertex, E on the sp3 carbon (R3-01).
  eas2b: (m, f = false) => {
    m.ring([100, 100], "cyclohexane");
    const ns = ([[107.2, 87.53], [114.4, 100], [107.2, 112.47], [92.8, 112.47], [85.6, 100], [92.8, 87.53]] as Pt[]).map((p) => m.nodeNear(p));
    m.order(m.bondOf(ns[2], ns[3]), "2");
    m.order(m.bondOf(ns[4], ns[5]), "2");
    m.charge(ns[1], 1);
    const h = m.bond(ns[0], 270, "H");
    m.bond(ns[0], 330, "E");
    m.curved({ bond: h.b }, { bond: m.bondOf(ns[0], ns[1]) }, 2, f);
  },
  dielsAlderAtoms: (m, f = false) => da(m, false, f),
  dielsAlderGaps: (m, f = false) => da(m, true, f),
  homolysisBr2: (m, f = false) => {
    const a = m.atom([100, 100], "Br");
    const b = m.bond(a, 0, "Br");
    m.curved({ bond: b.b }, { atom: a }, 1, f);
    m.curved({ bond: b.b }, { atom: b.n }, 1, f);
  },
  // Peroxide C–O–O–C zigzag (R3-02).
  homolysisPeroxide: (m, f = false) => {
    const s = m.seed([80, 110]);
    const o1 = m.bond(s.n2, 330, "O");
    const o2 = m.bond(o1.n, 30, "O");
    const c = m.bond(o2.n, 330);
    m.bond(c.n, 30);
    m.curved({ bond: o2.b }, { atom: o1.n }, 1, f);
    m.curved({ bond: o2.b }, { atom: o2.n }, 1, f);
  },
  radicalAdd: (m, f = false) => {
    const s = m.seed([95, 110]);
    m.order(s.b, "2");
    m.bond(s.n2, 330);
    const br = m.atom([62, 96], "Br");
    m.radical(br);
    const gap = mid(m.pos(br), m.pos(s.n1));
    m.curved({ atom: br }, { at: gap }, 1, f);
    m.curved({ bond: s.b }, { at: gap }, 1, f);
    m.curved({ bond: s.b }, { atom: s.n2 }, 1, f);
  },
  enolateAlkyl: (m, f = false) => {
    const o = m.atom([80, 85.6], "O");
    m.charge(o, -1);
    const oc = m.bond(o, 90);
    const c1 = oc.n;
    m.bond(c1, 150);
    const cc = m.bond(c1, 30, null, "2");
    const i = m.atom([140, 107.2], "I");
    const ci = m.bond(i, 180);
    m.curved({ atom: o }, { bond: oc.b }, 2, f);
    m.curved({ bond: cc.b }, { atom: ci.n }, 2, f);
    m.curved({ bond: ci.b }, { atom: i }, 2, f);
  },
  e2zig: (m, f = false) => {
    const s = m.seed([90, 110]);
    const c1 = s.n1, c2 = s.n2;
    m.bond(c1, 210);
    m.bond(c2, 30);
    const h = m.bond(c1, 90, "H").n;
    const br = m.bond(c2, 270, "Br").n;
    const o = m.atom([58, 140], "O");
    m.charge(o, -1);
    m.curved({ atom: o }, { atom: h }, 2, f);
    m.curved({ bond: m.bondOf(c1, h) }, { bond: s.b }, 2, f);
    m.curved({ bond: m.bondOf(c2, br) }, { atom: br }, 2, f);
  },
  // Radical addition on a propene zigzag (R3-07): the third hook lands on C2.
  radicalAddZig: (m, f = false) => {
    const s = m.seed([95, 110]);
    m.order(s.b, "2");
    m.bond(s.n2, 30);
    const br = m.atom([62, 96], "Br");
    m.radical(br);
    const gap = mid(m.pos(br), m.pos(s.n1));
    m.curved({ atom: br }, { at: gap }, 1, f);
    m.curved({ bond: s.b }, { at: gap }, 1, f);
    m.curved({ bond: s.b }, { atom: s.n2 }, 1, f);
  },
  allylZig: (m, f = false) => {
    const a = m.seed([60, 110]);
    m.order(a.b, "2");
    const a3 = m.bond(a.n2, 30);
    m.charge(a3.n, 1);
    m.curved({ bond: a.b }, { bond: a3.b }, 2, f);
    m.straight([100, 104], [130, 104], "resonance");
    const b = m.seed([140, 110]);
    m.bond(b.n2, 30, null, "2");
    m.charge(b.n1, 1);
    m.curved({ atom: b.n1 }, { bond: b.b }, 2, f);
  },
  carbonylAddSym: (m, f = false) => {
    const ox = m.atom([100, 85.6], "O");
    const c = m.bond(ox, 90, null, "2");
    m.bond(c.n, 150);
    m.bond(c.n, 30);
    const o = m.atom([65, 92], "O");
    m.charge(o, -1);
    m.curved({ atom: o }, { atom: c.n }, 2, f);
    m.curved({ bond: c.b }, { atom: ox }, 2, f);
  },
  carbonylAddRight: (m, f = false) => {
    const ox = m.atom([100, 85.6], "O");
    const c = m.bond(ox, 90, null, "2");
    m.bond(c.n, 150);
    m.bond(c.n, 30);
    const o = m.atom([60, 105], "O");
    m.charge(o, -1);
    m.curved({ atom: o }, { atom: c.n }, 2, f);
    m.curved({ bond: c.b }, { atom: ox }, 2, f);
  },
};

function da(m: Scene, gaps: boolean, f: boolean): void {
  const v = (k: number, dx = 0): Pt => [100 + L * Math.cos(rad(-90 + 60 * k)) + dx, 100 + L * Math.sin(rad(-90 + 60 * k))];
  const s = m.seed(v(3));
  const v3 = s.n1, v2 = s.n2;
  m.order(s.b, "2");
  const b21 = m.bond(v2, 270);
  const v1 = b21.n;
  const b10 = m.bond(v1, 210, null, "2");
  const v0 = b10.n;
  const p4 = v(4, -0.6 * L);
  const e = m.seed([p4[0] - L * Math.cos(rad(30)), p4[1] + L * Math.sin(rad(30))]);
  const up = m.bond(e.n2, 270, null, "2");
  m.del(e.n1);
  m.re();
  const e4 = e.n2, e5 = up.n;
  m.curved({ bond: s.b }, gaps ? { at: mid(m.pos(v3), m.pos(e4)) } : { atom: e4 }, 2, f);
  m.curved({ bond: up.b }, gaps ? { at: mid(m.pos(e5), m.pos(v0)) } : { atom: v0 }, 2, f);
  m.curved({ bond: b10.b }, { bond: b21.b }, 2, f);
}

/** The 12-direction cells (k = 0…11, 30° apart), each drawn at `at`. */
export const GRID: Record<string, (m: Scene, k: number, at: Pt, flip?: boolean) => void> = {
  // C–Br → Br (a leaving group); the bond leaves Br at k × 30° + 180° (R3-03).
  gridHopBr: (m, k, at, f = false) => {
    const br = m.atom(at, "Br");
    const c = m.bond(br, k * 30 + 180);
    m.bond(c.n, k * 30 + 180 + 60);
    m.curved({ bond: c.b }, { atom: br }, 2, f);
  },
  gridHomoBr2: (m, k, at, f = false) => {
    const a = m.atom(at, "Br");
    const b = m.bond(a, k * 30, "Br");
    m.curved({ bond: b.b }, { atom: a }, 1, f);
    m.curved({ bond: b.b }, { atom: b.n }, 1, f);
  },
  gridHomoOO: (m, k, at, f = false) => {
    const a = m.atom(at, "O");
    const b = m.bond(a, k * 30, "O");
    m.bond(a, k * 30 + 180 - 60);
    m.bond(b.n, k * 30 - 60);
    m.curved({ bond: b.b }, { atom: a }, 1, f);
    m.curved({ bond: b.b }, { atom: b.n }, 1, f);
  },
  // An alkoxide O⁻ lone pair → its own C–O bond (R3-06).
  gridLoneToBond: (m, k, at, f = false) => {
    const o = m.atom(at, "O");
    m.charge(o, -1);
    const c = m.bond(o, k * 30 + 90);
    m.bond(c.n, k * 30 + 90 + 60);
    m.bond(c.n, k * 30 + 90 - 60);
    m.curved({ atom: o }, { bond: c.b }, 2, f);
  },
};
export const gridCell = (k: number): Pt => [60 + (k % 4) * 70, 60 + Math.floor(k / 4) * 70];
