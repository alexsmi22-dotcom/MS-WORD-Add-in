/**
 * @jest-environment jsdom
 */
// The canvas's Properties tool, driven as a user drives it: click an atom or a bond, change the panel;
// ChemDraw's attributes are written, the marks drawn, the chemistry read as a query where it is one.
import { TextDecoder as NodeTextDecoder } from "util";
import { Molecule } from "openchemlib/full";
import { createChemCanvas } from "../../taskpane/chemCanvas";
import { findById } from "../cdxmlEdit";
import { readCdxml } from "../cdxml";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

function setup() {
  document.body.innerHTML = '<div id="mount"></div>';
  const status: Array<[string, string]> = [];
  const c = createChemCanvas(document.getElementById("mount")!, { setStatus: (m, k) => void status.push([m, k ?? ""]) });
  const surface = document.querySelector<HTMLElement>(".chem-canvas-surface")!;
  const click = (x: number, y: number): void => {
    const svg = surface.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const at = { clientX: x - vx, clientY: y - vy };
    for (const t of ["pointerdown", "pointerup", "click"]) surface.dispatchEvent(new MouseEvent(t, { ...at, button: 0, bubbles: true }));
  };
  const tool = (t: string): void => document.querySelector<HTMLButtonElement>(`[data-chem-tool="${t}"]`)!.click();
  const atoms = () => c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes.map((n) => ({ id: n.id, p: n.p as [number, number] })) : [])));
  const bonds = () => c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.bonds.map((b) => b.id) : [])));
  const prop = <T extends HTMLElement>(key: string): T => document.querySelector<T>(`[data-chem-prop="${key}"]`)!;
  const set = (key: string, value: string): void => {
    const s = prop<HTMLSelectElement | HTMLInputElement>(key);
    s.value = value;
    s.dispatchEvent(new Event("change"));
  };
  const last = (): [string, string] => status[status.length - 1];
  return { c, click, tool, atoms, bonds, prop, set, last };
}

test("the Properties panel shows only with its tool, and asks for an atom or bond", () => {
  const t = setup();
  const box = document.querySelector<HTMLElement>(".chem-canvas-props")!;
  expect(box.hidden).toBe(true);
  t.tool("props");
  expect(box.hidden).toBe(false);
  expect(t.last()[0]).toMatch(/^Properties: click an atom/);
  t.click(10, 10);
  expect(t.last()).toEqual(["Click an atom or a bond.", "error"]);
});

test("an atom: AND group 1, then a query (exactly 3 substituents, simple ring) — written as ChemDraw's attributes, drawn, undoable", () => {
  const t = setup();
  t.click(100, 100); // ethane
  t.tool("props");
  const a = t.atoms()[0];
  t.click(...a.p);
  expect(document.querySelector<HTMLElement>(".chem-canvas-props-atom")!.hidden).toBe(false);
  expect(t.prop<HTMLInputElement>("group").disabled).toBe(true);
  t.set("stereo", "And");
  expect(findById(t.c.page().root, a.id)!.el.attrs).toMatchObject({ EnhancedStereoType: "And", EnhancedStereoGroupNum: "1" });
  expect(t.prop<HTMLInputElement>("group").disabled).toBe(false);
  t.set("substituents", "e3");
  t.set("ringbonds", "SimpleRing");
  expect(findById(t.c.page().root, a.id)!.el.attrs).toMatchObject({ SubstituentsExactly: "3", RingBondCount: "SimpleRing" });
  const svg = t.c.render(false)!.svg;
  expect(svg).toContain(">&amp;1<");
  expect(svg).toContain(">s3,rb2<");
  // A query structure: no formula claimed, whatever the Markush box says.
  const chem = t.c.chemistry();
  expect(chem.ok && chem.mol.isFragment()).toBe(true);
  expect(t.c.isFragment()).toBe(false);
  // Undo takes the last change back.
  document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
  expect(findById(t.c.page().root, a.id)!.el.attrs.RingBondCount).toBeUndefined();
});

test("a radical on a labelled atom: drawn as a dot, its hydrogens one fewer", () => {
  const t = setup();
  t.click(100, 100);
  t.tool("atom");
  document.querySelector<HTMLButtonElement>('[data-chem-element="N"]')!.click();
  const n = t.atoms()[1];
  t.click(...n.p);
  t.tool("props");
  t.click(...n.p);
  t.set("radical", "Doublet");
  const node = findById(t.c.page().root, n.id)!.el;
  expect(node.attrs.NumHydrogens).toBe("1");
  expect(t.c.render(false)!.svg).toMatch(/<circle [^>]*fill="#000"/);
  const chem = t.c.chemistry();
  expect(chem.ok && chem.mol.getMolecularFormula().formula).toBe("CH4N"); // CH₃–NH•
});

test("a bond: single or double, in a ring — Order lists both, marked S/D ring; one order again is a plain bond", () => {
  const t = setup();
  t.click(100, 100);
  t.tool("props");
  const [a0, a1] = t.atoms();
  t.click((a0.p[0] + a1.p[0]) / 2, (a0.p[1] + a1.p[1]) / 2);
  expect(document.querySelector<HTMLElement>(".chem-canvas-props-bond")!.hidden).toBe(false);
  const dbl = document.querySelector<HTMLInputElement>('[data-chem-prop-order="2"]')!;
  dbl.checked = true;
  dbl.dispatchEvent(new Event("change"));
  t.set("topology", "Ring");
  const b = findById(t.c.page().root, t.bonds()[0])!.el;
  expect(b.attrs).toMatchObject({ Order: "1 2", Topology: "Ring" });
  expect(t.c.render(false)!.svg).toContain(">S/D ring<");
  const one = document.querySelector<HTMLInputElement>('[data-chem-prop-order="1"]')!;
  one.checked = false;
  one.dispatchEvent(new Event("change"));
  t.set("topology", "");
  expect(findById(t.c.page().root, t.bonds()[0])!.el.attrs.Order).toBe("2");
  // None ticked: refused, the bond unchanged.
  dbl.checked = false;
  dbl.dispatchEvent(new Event("change"));
  expect(t.last()).toEqual(["Choose at least one of single, double, triple, aromatic.", "error"]);
  expect(findById(t.c.page().root, t.bonds()[0])!.el.attrs.Order).toBe("2");
});

test("an atom list typed with the Atom tool ([N,O]) reads as a query structure", () => {
  const t = setup();
  t.click(100, 100);
  t.tool("atom");
  const v = document.querySelector<HTMLInputElement>("[data-chem-value]")!;
  v.value = "[N,O]";
  t.click(...t.atoms()[1].p);
  expect(t.last()[0]).toBe("An atom list: any one of N, O — the structure is a query (no single formula).");
  const chem = t.c.chemistry();
  expect(chem.ok && chem.mol.isFragment()).toBe(true);
  expect(t.c.render(false)!.svg).toContain("[N,O]");
});

test("setMolecule with an AND group and a query atom (as the pane reopens a structure) keeps both", () => {
  const t = setup();
  const m = Molecule.fromSmiles("C[C@H](N)C(=O)O");
  m.ensureHelperArrays(Molecule.cHelperParities);
  for (let a = 0; a < m.getAllAtoms(); a++) if (m.isAtomStereoCenter(a)) m.setAtomESR(a, Molecule.cESRTypeAnd, 0);
  m.setFragment(true);
  m.setAtomQueryFeature(0, Molecule.cAtomQFNot2RingBonds | Molecule.cAtomQFNot3RingBonds | Molecule.cAtomQFNot4RingBonds, true);
  const want = m.getIDCode();
  m.inventCoordinates();
  t.c.setMolecule(m);
  const chem = t.c.chemistry();
  expect(chem.ok && chem.mol.getIDCode()).toBe(want);
});

describe("review of the Properties panel", () => {
  test("6. after Undo the panel shows the page as it is: the next change does not bring back what was undone", () => {
    const t = setup();
    t.click(100, 100);
    t.tool("props");
    const a = t.atoms()[0];
    t.click(...a.p);
    t.set("stereo", "And");
    document.querySelector<HTMLButtonElement>('[data-chem-action="undo"]')!.click();
    expect(t.prop<HTMLSelectElement>("stereo").value).toBe("Absolute");
    t.set("unsaturation", "MustBeAbsent");
    const attrs = findById(t.c.page().root, a.id)!.el.attrs;
    expect(attrs.EnhancedStereoType).toBeUndefined();
    expect(attrs.UnsaturatedBonds).toBe("MustBeAbsent");
  });
  test("12. a stereo group number out of range is said, never quietly made 1", () => {
    const t = setup();
    t.click(100, 100);
    t.tool("props");
    const a = t.atoms()[0];
    t.click(...a.p);
    t.set("stereo", "Or");
    t.set("group", "0");
    expect(t.last()).toEqual(["A stereo group is numbered 1 to 32.", "error"]);
    expect(findById(t.c.page().root, a.id)!.el.attrs.EnhancedStereoGroupNum).toBe("1");
  });
  test("11. a dative bond keeps its order; its ring / chain can still be set", () => {
    const t = setup();
    const d = readCdxml('<CDXML BondLength="30"><page id="900"><fragment id="10"><n id="101" p="100 100"/><n id="102" p="130 100" Element="26"/><b id="103" B="101" E="102" Order="dative"/></fragment></page></CDXML>');
    if (!d.ok) throw new Error(d.reason);
    t.c.loadPage(d.doc);
    t.tool("props");
    t.click(115, 100);
    expect(document.querySelector<HTMLInputElement>('[data-chem-prop-order="1"]')!.disabled).toBe(true);
    t.set("topology", "Chain");
    expect(findById(t.c.page().root, "103")!.el.attrs).toMatchObject({ Order: "dative", Topology: "Chain" });
  });
});
