// Organometallic drawing (docs/SCOPE-ORGANOMETALLIC.md): η-bonds written as ChemDraw writes them (MultiAttachment
// centre at the centroid, a plain bond to the metal), kept valid through every edit; Cp rings; BH₄ as drawn;
// metallocene templates. Fixtures are built here from scratch.
import { TextDecoder as NodeTextDecoder } from "util";
import { readCdxml, type CdxDoc } from "../cdxml";
import { addAtomAt, addBondFrom, addRingAt, addRingOnBond, blankPageCdxml, deleteInStructure, deleteObjects, moveObjects, setAtomLabel, setBond, setBondProps, setCharge, writeCdxml } from "../cdxmlEdit";
import { cleanStructures } from "../cdxClean";
import { addHapto, addMetalloceneTemplate, METALLOCENE_TEMPLATES, ringThrough, setRingPerspective } from "../organometal";
import { pageStructures } from "../chemdrawPick";
import { renderCdx } from "../cdxmlRender";
import type { XNode } from "../xmlLite";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

function blank(): CdxDoc {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
/** Written out and read back: what ChemDraw (and the next session) would see. */
function reread(doc: CdxDoc): CdxDoc {
  const r = readCdxml(writeCdxml(doc.root));
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
function all(doc: CdxDoc, name: string): XNode[] {
  const out: XNode[] = [];
  const go = (n: XNode): void => {
    if (n.name === name) out.push(n);
    n.children.forEach(go);
  };
  go(doc.root);
  return out;
}
const atoms = (doc: CdxDoc): XNode[] => all(doc, "n");
const bonds = (doc: CdxDoc): XNode[] => all(doc, "b");
const centres = (doc: CdxDoc): XNode[] => atoms(doc).filter((n) => n.attrs.NodeType === "MultiAttachment");
const byId = (doc: CdxDoc, id: string): XNode | undefined => [...atoms(doc), ...bonds(doc)].find((n) => n.attrs.id === id);
const pos = (n: XNode): [number, number] => n.attrs.p!.split(" ").map(Number) as [number, number];
const listOf = (v: string | undefined): string[] => (v ?? "").split(/\s+/).filter(Boolean);

/**
 * Every η-bond valid — `count` of them (review: with none the check passed vacuously): its listed atoms exist, its
 * centre sits at their centroid, one bond joins it to a labelled atom; and no reference anywhere names a missing id.
 */
function expectHaptoValid(doc: CdxDoc, count: number): void {
  expect(centres(doc)).toHaveLength(count);
  const every = new Set<string>();
  const go = (n: XNode): void => {
    if (n.attrs.id) every.add(n.attrs.id);
    n.children.forEach(go);
  };
  go(doc.root);
  for (const g of all(doc, "bracketedgroup")) for (const i of listOf(g.attrs.BracketedObjectIDs)) expect(every.has(i)).toBe(true);
  for (const c of all(doc, "crossingbond")) expect(every.has(c.attrs.BondID!) && every.has(c.attrs.InnerAtomID!)).toBe(true);
  for (const s of all(doc, "step")) for (const i of listOf(s.attrs.ReactionStepReactants)) expect(every.has(i)).toBe(true);
  for (const c of centres(doc)) {
    const att = listOf(c.attrs.Attachments).map((i) => byId(doc, i));
    expect(att.every((a) => a && a.name === "n")).toBe(true);
    const cx = att.reduce((s, a) => s + pos(a!)[0], 0) / att.length, cy = att.reduce((s, a) => s + pos(a!)[1], 0) / att.length;
    expect(pos(c)[0]).toBeCloseTo(cx, 1);
    expect(pos(c)[1]).toBeCloseTo(cy, 1);
    const to = bonds(doc).filter((b) => b.attrs.B === c.attrs.id || b.attrs.E === c.attrs.id);
    expect(to).toHaveLength(1);
    const metal = byId(doc, to[0].attrs.B === c.attrs.id ? to[0].attrs.E : to[0].attrs.B)!;
    expect(metal.children.some((t) => t.name === "t")).toBe(true);
  }
  // No bond points at a node that is gone.
  const ids = new Set(atoms(doc).map((n) => n.attrs.id));
  for (const b of bonds(doc)) expect(ids.has(b.attrs.B) && ids.has(b.attrs.E)).toBe(true);
}

/** A Cp ring (cyclopentadienyl) and a Zr atom of its own, not yet bound. */
function cpAndZr(): { doc: CdxDoc; ring: string[]; zr: string } {
  const doc = blank();
  expect(addRingAt(doc, [100, 100], "cyclopentadienyl")).toBeNull();
  const ring = atoms(doc).map((n) => n.attrs.id!);
  // The metal as a structure of its own (one labelled atom): addHapto joins the two.
  const m = addAtomAt(doc, [100, 160], "Zr");
  if (!m.ok) throw new Error(m.reason);
  expect(all(doc, "fragment").filter((f) => f.children.some((c) => c.name === "n"))).toHaveLength(2);
  return { doc, ring, zr: m.nodeId };
}

describe("Cp ring and η-bond, as ChemDraw writes them", () => {
  it("the Cp ring: five atoms, five delocalised (1.5) bonds", () => {
    const doc = blank();
    expect(addRingAt(doc, [100, 100], "cyclopentadienyl")).toBeNull();
    expect(atoms(doc)).toHaveLength(5);
    expect(bonds(doc).map((b) => b.attrs.Order)).toEqual(["1.5", "1.5", "1.5", "1.5", "1.5"]);
  });

  it("η⁵: a MultiAttachment centre at the ring's centroid listing its five atoms, one plain bond to the metal; the metal shows no hydrogens", () => {
    const { doc, ring, zr } = cpAndZr();
    const r = addHapto(doc, ring, zr);
    expect(r.ok).toBe(true);
    const back = reread(doc);
    expect(centres(back)).toHaveLength(1);
    expect(listOf(centres(back)[0].attrs.Attachments).sort()).toEqual([...ring].sort());
    expectHaptoValid(back, 1);
    const z = byId(back, zr)!;
    expect(z.attrs.Element).toBe("40");
    expect(z.attrs.NumHydrogens).toBe("0");
    // Ring and metal became one structure.
    expect(all(back, "fragment").filter((f) => f.children.some((c) => c.name === "n"))).toHaveLength(1);
  });

  it("ringThrough: a Cp bond or atom gives its five ring atoms in order; a chain atom, none", () => {
    const { doc, ring, zr } = cpAndZr();
    const b = bonds(doc).find((x) => x.attrs.Order === "1.5")!;
    expect(ringThrough(doc, b.attrs.id!)?.sort()).toEqual([...ring].sort());
    expect(ringThrough(doc, ring[2])?.length).toBe(5);
    expect(ringThrough(doc, zr)).toBeNull();
  });

  it("refused by name: an unlabelled metal, one atom, atoms not joined, the same ring twice, the centre itself", () => {
    const { doc, ring, zr } = cpAndZr();
    const bare = addBondFrom(doc, ring[0]);
    if (!bare.ok) throw new Error(bare.reason);
    expect(addHapto(doc, ring, bare.nodeId)).toEqual({ ok: false, reason: expect.stringMatching(/label the metal first/) });
    expect(addHapto(doc, [ring[0]], zr)).toEqual({ ok: false, reason: expect.stringMatching(/binds 2 to 8 atoms/) });
    expect(addHapto(doc, [ring[0], ring[2]], zr)).toEqual({ ok: false, reason: expect.stringMatching(/joined to one another/) });
    const ok = addHapto(doc, ring, zr);
    expect(ok.ok).toBe(true);
    expect(addHapto(doc, ring, zr)).toEqual({ ok: false, reason: expect.stringMatching(/already bound/) });
    if (ok.ok) expect(addHapto(doc, ring, ok.centreId)).toEqual({ ok: false, reason: expect.stringMatching(/not the centre/) });
  });
});

describe("η-bonds stay valid through every edit", () => {
  function bound(): { doc: CdxDoc; ring: string[]; zr: string; centre: string; hb: string } {
    const s = cpAndZr();
    const r = addHapto(s.doc, s.ring, s.zr);
    if (!r.ok) throw new Error(r.reason);
    return { ...s, centre: r.centreId, hb: r.bondId };
  }

  it("deleting a ring atom (Erase) takes the η-bond with it — no Attachments naming a gone atom", () => {
    const { doc, ring, centre, hb } = bound();
    expect(deleteInStructure(doc, ring[3])).toBeNull();
    expect(byId(doc, centre)).toBeUndefined();
    expect(byId(doc, hb)).toBeUndefined();
    expectHaptoValid(reread(doc), 0);
  });

  it("a selected metallocene deleted (the Delete key: the whole structure) leaves nothing behind", () => {
    const { doc } = bound();
    const frag = all(doc, "fragment").find((f) => f.children.some((c) => c.name === "n"))!;
    deleteObjects(doc, [frag.attrs.id!]);
    expect(atoms(doc)).toHaveLength(0);
    expect(bonds(doc)).toHaveLength(0);
  });

  it("deleting the metal leaves the ring and drops the bond to it; deleting the η-bond's centre leaves both", () => {
    const a = bound();
    deleteInStructure(a.doc, a.zr);
    expect(bonds(a.doc).some((b) => b.attrs.id === a.hb)).toBe(false);
    expect(byId(a.doc, a.centre)).toBeUndefined();
    const b = bound();
    expect(deleteInStructure(b.doc, b.centre)).toBeNull();
    expect(byId(b.doc, b.zr)).toBeDefined();
    expect(atoms(b.doc).filter((n) => b.ring.includes(n.attrs.id!))).toHaveLength(5);
    expect(centres(b.doc)).toHaveLength(0);
  });

  it("moving some of the ring's atoms moves the centre to their new centroid", () => {
    const { doc, ring } = bound();
    moveObjects(doc, [ring[0], ring[1]], 10, -4);
    expectHaptoValid(doc, 1);
  });

  it("moving the whole structure moves the centre with it", () => {
    const { doc } = bound();
    const frag = all(doc, "fragment").find((f) => f.children.length)!;
    moveObjects(doc, [frag.attrs.id!], 25, 25);
    expectHaptoValid(doc, 1);
  });

  it("relabelling a ring atom (C → N) keeps the η-bond", () => {
    const { doc, ring } = bound();
    expect(setAtomLabel(doc, ring[2], "N").ok).toBe(true);
    expect(centres(doc)).toHaveLength(1);
    expectHaptoValid(reread(doc), 1);
  });

  it("the centre is a point, not an atom: no label, no bond, no charge on it — said in words", () => {
    const { doc, centre } = bound();
    const label = setAtomLabel(doc, centre, "N");
    expect(label.ok).toBe(false);
    if (!label.ok) expect(label.reason).toMatch(/centre of an η-bond/);
    const b = addBondFrom(doc, centre);
    expect(b.ok).toBe(false);
    expect(setCharge(doc, centre, 1)).toMatch(/centre of an η-bond/);
  });
});

describe("BH₄ as drawn", () => {
  it("BH4 on a metal: boron with 4 hydrogens (ChemDraw's encoding), kept as drawn when bonds change", () => {
    const { doc, zr } = cpAndZr();
    const l = addBondFrom(doc, zr);
    if (!l.ok) throw new Error(l.reason);
    const r = setAtomLabel(doc, l.nodeId, "BH4");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toMatch(/BH₄: B with 4 hydrogens/);
    const n = byId(doc, l.nodeId)!;
    expect(n.attrs.Element).toBe("5");
    expect(n.attrs.NumHydrogens).toBe("4");
    expect(n.attrs.NodeType).toBeUndefined();
    // A bond added or removed elsewhere on it: still BH4, never BH2.
    addBondFrom(doc, l.nodeId);
    expect(byId(doc, l.nodeId)!.attrs.NumHydrogens).toBe("4");
    expect(writeCdxml(doc.root)).toContain(">BH4</s>");
  });

  it("review: only BH4 / AlH4 / GaH4 — NH3, NH12, BrH2, PH3, SiH4 on a carbon read as before (never a confident wrong H count)", () => {
    const chainEnd = (): { doc: CdxDoc; id: string } => {
      const doc = blank();
      addRingAt(doc, [100, 100], "cyclohexane");
      const f = addBondFrom(doc, atoms(doc)[0].attrs.id!);
      if (!f.ok) throw new Error(f.reason);
      return { doc, id: f.nodeId };
    };
    for (const lab of ["NH3", "NH12", "BrH2", "PH3", "SiH4", "NH2", "OH"]) {
      const { doc, id } = chainEnd();
      setAtomLabel(doc, id, lab);
      const n = byId(doc, id)!;
      // Never a fixed count from the label: an element's hydrogens come from valence, or the label is text / a group.
      if (n.attrs.Element) expect(Number(n.attrs.NumHydrogens ?? 0)).toBeLessThanOrEqual(3);
      expect(writeCdxml(doc.root)).not.toContain("JurisLabFixedH");
    }
    for (const lab of ["AlH4", "GaH4"]) {
      const { doc, zr } = cpAndZr();
      const l = addBondFrom(doc, zr);
      if (!l.ok) throw new Error(l.reason);
      setAtomLabel(doc, l.nodeId, lab);
      expect(byId(doc, l.nodeId)!.attrs.NumHydrogens).toBe("4");
    }
  });

  it("review: a BH4 as ChemDraw writes it (no attribute of JurisLab's) keeps its 4 H through a charge change and back", () => {
    const { doc, zr } = cpAndZr();
    const l = addBondFrom(doc, zr);
    if (!l.ok) throw new Error(l.reason);
    setAtomLabel(doc, l.nodeId, "BH4");
    const back = reread(doc);
    expect(setCharge(back, l.nodeId, -1)).toBeNull();
    expect(byId(back, l.nodeId)!.attrs.NumHydrogens).toBe("4");
    expect(setCharge(back, l.nodeId, 0)).toBeNull();
    expect(byId(back, l.nodeId)!.attrs.NumHydrogens).toBe("4");
  });

  it("relabelled to something else, it is that element", () => {
    const { doc, zr } = cpAndZr();
    const l = addBondFrom(doc, zr);
    if (!l.ok) throw new Error(l.reason);
    setAtomLabel(doc, l.nodeId, "BH4");
    setAtomLabel(doc, l.nodeId, "Cl");
    expect(byId(doc, l.nodeId)!.attrs.Element).toBe("17");
    expect(byId(doc, l.nodeId)!.attrs.NumHydrogens).toBe("0");
  });
});

describe("review findings, pinned", () => {
  const placed = (kind: Parameters<typeof addMetalloceneTemplate>[2]): CdxDoc => {
    const d = blank();
    expect(addMetalloceneTemplate(d, [200, 260], kind)).toBeNull();
    return reread(d);
  };
  const haptoBondOf = (doc: CdxDoc): XNode => {
    const c = centres(doc)[0];
    return bonds(doc).find((b) => b.attrs.B === c.attrs.id || b.attrs.E === c.attrs.id)!;
  };

  it("blocker: Clean refuses a metallocene in words (it laid the η centre out away from its ring)", () => {
    const { doc, ring, zr } = cpAndZr();
    expect(addHapto(doc, ring, zr).ok).toBe(true);
    const f = addBondFrom(doc, zr);
    if (!f.ok) throw new Error(f.reason);
    setAtomLabel(doc, f.nodeId, "Cl");
    const doc2 = reread(doc);
    const before = writeCdxml(doc2.root);
    expect(cleanStructures(doc2)).toMatch(/metallocene .* keeps its layout/);
    expect(writeCdxml(doc2.root)).toBe(before);
  });

  it("erasing a Cp atom of the polymer-bound template leaves no id of the removed η-bond in the repeat unit", () => {
    const doc = placed("polymer-metallocene");
    const c = centres(doc)[0];
    expect(deleteInStructure(doc, listOf(c.attrs.Attachments)[0])).toBeNull();
    expectHaptoValid(reread(doc), 1);
  });

  it("an η-bond joining two structures removes the ring's as an object: a reaction step naming it loses the name", () => {
    const { doc, ring, zr } = cpAndZr();
    const ringFrag = all(doc, "fragment").find((f) => f.children.some((n) => n.attrs.id === ring[0]))!;
    const page = doc.root.children.find((c) => c.name === "page")!;
    page.children.push({ name: "scheme", attrs: { id: "900" }, children: [{ name: "step", attrs: { id: "901", ReactionStepReactants: ringFrag.attrs.id! }, children: [], text: "", line: 0 }], text: "", line: 0 });
    expect(addHapto(doc, ring, zr).ok).toBe(true);
    expectHaptoValid(doc, 1);
  });

  it("no ring is fused onto the η-bond line, and a Cp ring is never fused onto a bond (said why)", () => {
    const doc = placed("half-sandwich");
    const hb = haptoBondOf(doc);
    expect(addRingOnBond(doc, hb.attrs.id!, "benzene")).toMatch(/cannot be fused onto an η-bond/);
    const ringBond = bonds(doc).find((b) => b.attrs.Order === "1.5")!;
    expect(addRingOnBond(doc, ringBond.attrs.id!, "cyclopentadienyl")).toMatch(/Cp ring is placed on its own/);
    expectHaptoValid(doc, 1);
  });

  it("the η-bond takes no order or style (Bond tool, Properties)", () => {
    const doc = placed("half-sandwich");
    const hb = haptoBondOf(doc);
    expect(setBond(doc, hb.attrs.id!, { order: "2" })).toMatch(/one plain line/);
    expect(setBond(doc, hb.attrs.id!, { display: "WedgeBegin" })).toMatch(/one plain line/);
    expect(setBondProps(doc, hb.attrs.id!, { orders: ["1", "2"] })).toMatch(/one plain line/);
    expect(hb.attrs.Order).toBeUndefined();
    expect(hb.attrs.Display).toBeUndefined();
  });

  it("round 2: the η line is drawn broken where it passes under the ring's bold front edge (the code never ran: plain bonds read as \"Solid\")", () => {
    const doc = placed("half-sandwich");
    const c = centres(doc)[0];
    const hb = haptoBondOf(doc);
    const metal = byId(doc, hb.attrs.B === c.attrs.id ? hb.attrs.E : hb.attrs.B)!;
    const bold = bonds(doc).find((b) => b.attrs.Display === "Bold")!;
    const [p, q] = [pos(c), pos(metal)];
    const [a, b] = [pos(byId(doc, bold.attrs.B)!), pos(byId(doc, bold.attrs.E)!)];
    const svg = renderCdx(doc)!.svg;
    // No rendered line along the η-bond passes through the bold edge.
    const crossesEdge = (x1: number, y1: number, x2: number, y2: number): boolean => {
      const cr = (o: number[], u: number[], v: number[]): number => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
      return cr([x1, y1], [x2, y2], a) * cr([x1, y1], [x2, y2], b) < 0 && cr(a, b, [x1, y1]) * cr(a, b, [x2, y2]) < 0;
    };
    const along = (x1: number, y1: number, x2: number, y2: number): boolean => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const off = (x: number, y: number): number => Math.abs((q[0] - p[0]) * (p[1] - y) - (p[0] - x) * (q[1] - p[1])) / d;
      return off(x1, y1) < 0.5 && off(x2, y2) < 0.5;
    };
    let segments = 0;
    for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      if (!along(x1, y1, x2, y2)) continue;
      segments++;
      expect(crossesEdge(x1, y1, x2, y2)).toBe(false);
    }
    expect(segments).toBeGreaterThanOrEqual(2); // broken in two (or more)
  });

  it("round 2: the ansa bridge's Si bonds are near a bond length (they ran to 2.4 L)", () => {
    const doc = placed("ansa-metallocene");
    const L = doc.style.bondLength;
    const si = atoms(doc).find((n) => n.attrs.Element === "14")!;
    for (const b of bonds(doc).filter((x) => x.attrs.B === si.attrs.id || x.attrs.E === si.attrs.id)) {
      const o = byId(doc, b.attrs.B === si.attrs.id ? b.attrs.E : b.attrs.B)!;
      const d = Math.hypot(pos(o)[0] - pos(si)[0], pos(o)[1] - pos(si)[1]) / L;
      expect(d).toBeGreaterThan(0.9);
      expect(d).toBeLessThan(1.6);
    }
  });

  it("round 2: BH4 typed on a boron with two bonds is not a ligand — no confident 4 H", () => {
    const doc = blank();
    addRingAt(doc, [100, 100], "cyclohexane");
    const ring = atoms(doc).map((n) => n.attrs.id!);
    setAtomLabel(doc, ring[0], "BH4");
    expect(byId(doc, ring[0])!.attrs.NumHydrogens).not.toBe("4");
  });

  it("a move re-centres only the η-bonds whose ring moved (an imported centre a hair off is left alone)", () => {
    const a = placed("half-sandwich");
    const c = centres(a)[0];
    c.attrs.p = `${pos(c)[0] + 0.7} ${pos(c)[1]}`; // as a file may hold it
    const kept = c.attrs.p;
    const other = addAtomAt(a, [600, 600], "N");
    if (!other.ok) throw new Error(other.reason);
    moveObjects(a, [other.nodeId], 5, 5);
    expect(centres(a)[0].attrs.p).toBe(kept);
  });
});

describe("metallocene templates", () => {
  it.each(METALLOCENE_TEMPLATES.map((t) => t.id))("%s: η-bonds valid, metal Zr, Cp rings delocalised and in perspective; reads back; renders; opens on the page canvas", (kind) => {
    const doc = blank();
    expect(addMetalloceneTemplate(doc, [200, 200], kind)).toBeNull();
    const back = reread(doc);
    const want = kind === "half-sandwich" ? 1 : 2;
    expect(centres(back)).toHaveLength(want);
    expectHaptoValid(back, want);
    const zr = atoms(back).filter((n) => n.attrs.Element === "40");
    expect(zr).toHaveLength(1);
    expect(zr[0].attrs.NumHydrogens).toBe("0");
    for (const c of centres(back)) {
      const ring = new Set(listOf(c.attrs.Attachments));
      const rb = bonds(back).filter((b) => ring.has(b.attrs.B) && ring.has(b.attrs.E));
      expect(rb).toHaveLength(5);
      expect(rb.every((b) => b.attrs.Order === "1.5")).toBe(true);
      expect(rb.filter((b) => b.attrs.Display === "Bold")).toHaveLength(1);
      expect(rb.filter((b) => /^Wedge(Begin|End)$/.test(b.attrs.Display ?? ""))).toHaveLength(2);
    }
    expect(renderCdx(back)).not.toBeNull();
    const ps = pageStructures(back);
    expect(ps.structures).toHaveLength(1);
    expect(ps.structures[0].mol).toBeNull(); // not a single molecule: the page canvas
  });

  it("dichloride: two Cl on Zr; borohydride: two BH4 (boron, 4 H)", () => {
    const d = blank();
    addMetalloceneTemplate(d, [200, 200], "metallocene-dichloride");
    expect(atoms(d).filter((n) => n.attrs.Element === "17")).toHaveLength(2);
    const b = blank();
    addMetalloceneTemplate(b, [200, 200], "metallocene-borohydride");
    const bh = atoms(b).filter((n) => n.attrs.Element === "5");
    expect(bh).toHaveLength(2);
    expect(bh.every((n) => n.attrs.NumHydrogens === "4")).toBe(true);
  });

  it("ansa: one Si bonded to a carbon of each ring and two methyls, no hydrogens shown on Si", () => {
    const doc = blank();
    addMetalloceneTemplate(doc, [200, 200], "ansa-metallocene");
    const si = atoms(doc).filter((n) => n.attrs.Element === "14");
    expect(si).toHaveLength(1);
    expect(bonds(doc).filter((b) => b.attrs.B === si[0].attrs.id || b.attrs.E === si[0].attrs.id)).toHaveLength(4);
    expect(si[0].attrs.NumHydrogens).toBe("0");
    // The bridge can be relabelled to C or a generic Z.
    expect(setAtomLabel(doc, si[0].attrs.id!, "Z").ok).toBe(true);
    expect(byId(doc, si[0].attrs.id!)!.attrs.NodeType).toBe("GenericNickname");
  });

  it("polymer-bound: the brackets cross the two backbone bonds; the repeat unit holds the whole metallocene (η centres included), the outside atoms not", () => {
    const doc = reread((() => {
      const d = blank();
      expect(addMetalloceneTemplate(d, [200, 260], "polymer-metallocene")).toBeNull();
      return d;
    })());
    const g = all(doc, "bracketedgroup");
    expect(g).toHaveLength(1);
    expect(g[0].attrs.SRULabel).toBe("n");
    const inside = new Set(listOf(g[0].attrs.BracketedObjectIDs));
    for (const c of centres(doc)) expect(inside.has(c.attrs.id!)).toBe(true);
    expect(atoms(doc).filter((n) => n.attrs.Element === "40").every((n) => inside.has(n.attrs.id!))).toBe(true);
    const crossings = all(doc, "crossingbond");
    expect(crossings).toHaveLength(2);
    for (const c of crossings) {
      const b = byId(doc, c.attrs.BondID!)!;
      expect(b.name).toBe("b");
      expect(inside.has(c.attrs.InnerAtomID!)).toBe(true);
      const outer = b.attrs.B === c.attrs.InnerAtomID ? b.attrs.E : b.attrs.B;
      expect(inside.has(outer)).toBe(false);
    }
    expect(all(doc, "graphic").filter((x) => x.attrs.GraphicType === "Bracket")).toHaveLength(2);
    expect(renderCdx(doc)).not.toBeNull();
  });

  it("an unknown template or a non-finite place is refused by name", () => {
    expect(addMetalloceneTemplate(blank(), [NaN, 0], "half-sandwich")).toMatch(/not a place/);
    expect(addMetalloceneTemplate(blank(), [0, 0], "nope" as never)).toMatch(/not a template/);
  });

  it("setRingPerspective refuses what is not a closed ring", () => {
    const doc = blank();
    addRingAt(doc, [100, 100], "cyclopentadienyl");
    const ids = atoms(doc).map((n) => n.attrs.id!);
    expect(setRingPerspective(doc, [ids[0], ids[2], ids[4]])).toMatch(/closed ring/);
  });
});
