// Clean on a page that is more than its structures: each structure laid out again in place, its chemistry
// (stereo included) unchanged, everything else where it was; group labels stay labels; refusals by name.
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { addBrackets, findById } from "../cdxmlEdit";
import { cleanStructures } from "../cdxClean";
import { moleculeToPage, pageToMolecule } from "../cdxmlMol";

const page = (inner: string): CdxDoc => {
  const r = readCdxml(`<CDXML BondLength="30" LabelSize="10" LabelFont="3"><fonttable><font id="3" name="Arial"/></fonttable><page id="1">${inner}</page></CDXML>`);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const idcodeOf = (d: CdxDoc, id: string): string => {
  const r = pageToMolecule(d, new Set([id]));
  return r.ok ? r.value.mol.getIDCode() : r.reason;
};
const p = (d: CdxDoc, id: string): [number, number] => findById(d.root, id)!.el.attrs.p.split(" ").map(Number) as [number, number];
const centre = (d: CdxDoc, fragId: string): [number, number] => {
  const ns = findById(d.root, fragId)!.el.children.filter((c) => c.name === "n");
  const xs = ns.map((n) => Number(n.attrs.p.split(" ")[0])), ys = ns.map((n) => Number(n.attrs.p.split(" ")[1]));
  return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
};
/** A crooked propanol: badly drawn (one bond 50 pt, one 12 pt). */
const crooked = '<fragment id="10"><n id="101" p="100 100"/><n id="102" p="150 100"/><n id="103" p="155 111"/><n id="104" p="190 140" Element="8" NumHydrogens="1"><t p="190 140"><s font="3" size="10" face="96">OH</s></t></n><b id="105" B="101" E="102"/><b id="106" B="102" E="103"/><b id="107" B="103" E="104"/></fragment>';
const caption = '<t id="20" p="40 200" BoundingBox="40 192 90 202"><s font="3" size="10" face="0">Scheme 1</s></t>';
const arrow = '<arrow id="30" Head3D="300 100 0" Tail3D="240 100 0" ArrowheadHead="Full" ArrowheadType="Solid"/>';

test("a structure with a caption and an arrow: laid out at the page's bond length, its centre kept, its chemistry unchanged; the caption and arrow untouched", () => {
  const d = page(crooked + caption + arrow);
  const before = idcodeOf(d, "10");
  const c0 = centre(d, "10");
  expect(cleanStructures(d)).toBeNull();
  const again = reread(d);
  expect(idcodeOf(again, "10")).toBe(before);
  const c1 = centre(d, "10");
  expect(Math.hypot(c1[0] - c0[0], c1[1] - c0[1])).toBeLessThan(0.01);
  const len = (a: string, b: string): number => Math.hypot(p(d, a)[0] - p(d, b)[0], p(d, a)[1] - p(d, b)[1]);
  for (const [a, b] of [["101", "102"], ["102", "103"], ["103", "104"]]) expect(len(a, b)).toBeCloseTo(30, 0);
  expect(findById(d.root, "20")!.el.attrs.p).toBe("40 200");
  expect(findById(d.root, "30")!.el.attrs.Head3D).toBe("300 100 0");
  // The OH label moved with its atom.
  const t = findById(d.root, "104")!.el.children.find((c) => c.name === "t")!;
  const [ax, ay] = findById(d.root, "104")!.el.attrs.p.split(" ").map(Number);
  const box = (t.attrs.BoundingBox ?? `${t.attrs.p} ${t.attrs.p}`).split(" ").map(Number);
  expect(box[0] - 1 <= ax && ax <= box[2] + 1 && box[1] - 1 <= ay && ay <= box[3] + 1).toBe(true);
});

test("stereo is kept: a wedged centre drawn badly comes back with the same idcode (wedges drawn again)", () => {
  const m = Molecule.fromSmiles("C[C@H](N)C(=O)O");
  const want = m.getIDCode();
  m.inventCoordinates();
  const d = page("");
  expect(moleculeToPage(d, m).ok).toBe(true);
  const r = reread(d);
  const fragId = r.objects[0].id;
  // Squash it: every atom pushed toward one corner (geometry ruined, wedge kept).
  for (const n of findById(r.root, fragId)!.el.children.filter((c) => c.name === "n")) {
    const [x, y] = n.attrs.p.split(" ").map(Number);
    n.attrs.p = `${x * 0.6 + 7} ${y * 1.4}`;
  }
  const squashed = reread(r);
  expect(idcodeOf(squashed, fragId)).toBe(want);
  expect(cleanStructures(squashed)).toBeNull();
  expect(idcodeOf(reread(squashed), fragId)).toBe(want);
});

test("group labels stay labels (never expanded); one now on the other side of its bond is written for it", () => {
  const d = page('<fragment id="10"><n id="101" p="100 100"/><n id="102" p="130 100"/><n id="103" p="90 120" NodeType="Unspecified"><t p="90 120" LabelJustification="Left"><s font="3" size="10">OMe</s></t></n><b id="104" B="101" E="102"/><b id="105" B="101" E="103"/></fragment>');
  const before = idcodeOf(d, "10");
  expect(cleanStructures(d)).toBeNull();
  const after = reread(d);
  expect(idcodeOf(after, "10")).toBe(before);
  const n3 = findById(d.root, "103")!.el;
  expect(n3.attrs.NodeType).toBe("Unspecified");
  const words = n3.children.find((c) => c.name === "t")!.children.map((s) => s.text).join("");
  expect(["OMe", "MeO"]).toContain(words);
});

test("only the selected structure moves; the other keeps its exact place", () => {
  const second = '<fragment id="40"><n id="41" p="300 300"/><n id="42" p="370 300"/><b id="43" B="41" E="42"/></fragment>';
  const d = page(crooked + second);
  expect(cleanStructures(d, new Set(["10"]))).toBeNull();
  expect(p(d, "41")).toEqual([300, 300]);
  expect(p(d, "42")).toEqual([370, 300]);
});

test("refused by name: a structure inside brackets (made with the Brackets tool's own edit)", () => {
  const d = page('<fragment id="10"><n id="101" p="100 100"/><n id="102" p="130 100"/><n id="103" p="160 100"/><n id="104" p="190 100"/><b id="105" B="101" E="102"/><b id="106" B="102" E="103"/><b id="107" B="103" E="104"/></fragment>');
  expect(addBrackets(d, [118, 85, 172, 115])).toBeNull();
  const r = reread(d);
  expect(r.brackets.length).toBe(1);
  expect(cleanStructures(r)).toBe("a structure inside brackets keeps its layout (the brackets would no longer fit it) — move its atoms by hand");
});

test("a wedged structure with a label this cannot read is refused, never laid out without its stereo", () => {
  const d = page('<fragment id="10"><n id="1" p="100 100"/><n id="2" p="130 100"/><n id="3" p="145 75" NodeType="Unspecified"><t p="145 75"><s font="3" size="10">Xyz</s></t></n><n id="4" p="145 125"/><b id="5" B="1" E="2"/><b id="6" B="2" E="3" Display="WedgeBegin"/><b id="7" B="2" E="4"/></fragment>');
  expect(cleanStructures(d)).toMatch(/^a structure with wedges keeps its layout here, since its stereo could not be read/);
});

test("an empty page: nothing to clean", () => {
  expect(cleanStructures(page(caption))).toBe("there is no structure to clean");
});

test("browser check: an OH that Clean moves to the left of its bond is written HO, right-aligned on the atom", () => {
  const d = page(crooked);
  expect(cleanStructures(d)).toBeNull();
  const n = findById(d.root, "104")!.el;
  const t = n.children.find((c) => c.name === "t")!;
  const words = t.children.map((s) => s.text).join("");
  const otherX = Number(findById(d.root, "103")!.el.attrs.p.split(" ")[0]);
  const x = Number(n.attrs.p.split(" ")[0]);
  if (otherX > x) {
    expect(words).toBe("HO");
    expect(t.attrs.LabelJustification).toBe("Right");
  } else expect(words).toBe("OH");
  expect(idcodeOf(reread(d), "10")).toBe(idcodeOf(page(crooked), "10"));
});
