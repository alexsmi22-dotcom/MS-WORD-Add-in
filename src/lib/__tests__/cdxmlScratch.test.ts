// Drawing from a blank page (docs/SCOPE-CHEM-CANVAS.md, stage 2): a new atom, a bond on empty paper,
// a bond dragged from an atom (to a point, or to another atom — closing a ring or joining two
// structures), a caption. Each drawn structure is read back by the converter: the formula is the drawing's.
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addAtomAt, addBondAt, addBondBetween, addBondToward, addCaption, blankPageCdxml, findById, setAtomLabel } from "../cdxmlEdit";
import { pageToMolecule } from "../cdxmlMol";
import { renderCdx } from "../cdxmlRender";

const blank = (): CdxDoc => {
  const r = readCdxml(blankPageCdxml());
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const formula = (d: CdxDoc): string => {
  const r = pageToMolecule(reread(d));
  return r.ok ? r.value.mol.getMolecularFormula().formula : r.reason;
};
const nodes = (d: CdxDoc): string[] => reread(d).objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => n.id) : [])));

test("a blank page in ChemDraw's ACS 1996 style: empty, bond length 14.4 pt, Arial 10", () => {
  const d = blank();
  expect([d.objects.length, d.style.bondLength, d.style.labelSize]).toEqual([0, 14.4, 10]);
  expect(renderCdx(d)).toBeNull();
});

test("an atom on empty paper: carbon shows as CH₄ (a bare vertex would be invisible); N as NH₃", () => {
  const d = blank();
  const c = addAtomAt(d, [100, 100], "C");
  expect(c.ok && formula(d)).toBe("CH4");
  // Drawn CH with a subscript 4.
  expect(renderCdx(reread(d))!.svg).toMatch(/>CH<\/tspan><tspan[^>]*dy="[\d.]+">4</);
  const n = addAtomAt(d, [200, 100], "N");
  expect(n.ok).toBe(true);
  // Methane and ammonia on one page: one Molecule of two pieces.
  expect(formula(d)).toBe("CH7N");
});

test("draw ethanol: a bond on empty paper, a bond dragged on from its end, the end set to O", () => {
  const d = blank();
  const b = addBondAt(d, [100, 100]);
  expect(b.ok).toBe(true);
  const [a1, a2] = nodes(d);
  const t = addBondToward(d, a2, [160, 120], null);
  expect(t.ok).toBe(true);
  if (!t.ok) return;
  expect(setAtomLabel(d, t.nodeId, "O").ok).toBe(true);
  expect(formula(d)).toBe("C2H6O");
  // The new bond is a bond length long, snapped to 30°.
  const p = (id: string): number[] => findById(d.root, id)!.el.attrs.p.split(" ").map(Number);
  const q2 = p(a2), q3 = p(t.nodeId);
  expect(Math.hypot(q3[0] - q2[0], q3[1] - q2[1])).toBeCloseTo(14.4, 1);
  const ang = (Math.atan2(q3[1] - q2[1], q3[0] - q2[0]) * 180) / Math.PI;
  expect(Math.abs(ang / 30 - Math.round(ang / 30))).toBeLessThan(1e-3); // coordinates are kept to 0.01 pt
  void a1;
});

test("closing a ring: six carbons dragged round, the sixth bonded back to the first — cyclohexane", () => {
  const d = blank();
  addBondAt(d, [100, 100]);
  let [first, last] = nodes(d);
  const dirs = [90, 150, 210, 270];
  for (const deg of dirs) {
    const p = findById(d.root, last)!.el.attrs.p.split(" ").map(Number);
    const r = addBondToward(d, last, [p[0] + 20 * Math.cos((deg * Math.PI) / 180), p[1] + 20 * Math.sin((deg * Math.PI) / 180)], null);
    if (!r.ok) throw new Error(r.reason);
    last = r.nodeId;
  }
  const r = addBondBetween(d, last, first);
  expect(r.ok).toBe(true);
  expect(formula(d)).toBe("C6H12");
  expect(addBondBetween(d, last, first)).toEqual({ ok: false, reason: "those atoms are bonded already — click the bond to change its order" });
  expect(addBondBetween(d, first, first)).toEqual({ ok: false, reason: "a bond joins two different atoms" });
});

test("joining two structures makes one (methane + methane → ethane); a full carbon is refused by name", () => {
  const d = blank();
  const a = addAtomAt(d, [100, 100], "C"), b = addAtomAt(d, [130, 100], "C");
  if (!a.ok || !b.ok) throw new Error("atoms");
  expect(addBondBetween(d, a.nodeId, b.nodeId).ok).toBe(true);
  expect(reread(d).objects).toHaveLength(1);
  expect(formula(d)).toBe("C2H6");
  // Labels re-counted: CH₃ each.
  expect(findById(d.root, a.nodeId)!.el.attrs.NumHydrogens).toBe("3");
  // Four bonds on one carbon, then a fifth: refused.
  const e = blank();
  const c = addAtomAt(e, [100, 100], "C");
  if (!c.ok) throw new Error("c");
  for (const deg of [0, 90, 180, 270]) {
    const r = addBondToward(e, c.nodeId, [100 + 20 * Math.cos((deg * Math.PI) / 180), 100 + 20 * Math.sin((deg * Math.PI) / 180)], null);
    if (!r.ok) throw new Error(r.reason);
  }
  expect(addBondToward(e, c.nodeId, [120, 120], null)).toEqual({ ok: false, reason: "that C has no bond to spare" });
});

test("a caption on empty paper; empty words refused", () => {
  const d = blank();
  expect(addCaption(d, [50, 300], "Scheme 1").ok).toBe(true);
  expect(renderCdx(reread(d))!.svg).toContain(">Scheme 1<");
  expect(addCaption(d, [50, 300], "  ")).toEqual({ ok: false, reason: "type the words first" });
});
