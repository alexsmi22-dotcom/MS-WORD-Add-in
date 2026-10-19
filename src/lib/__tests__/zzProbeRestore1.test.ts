/**
 * @jest-environment jsdom
 */
import { TextDecoder as NodeTextDecoder } from "util";
import { Molecule } from "openchemlib/full";
import { readCdxml } from "../cdxml";
import { pageStructures } from "../chemdrawPick";
import { pageToMolecule } from "../cdxmlMol";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: () => null });
(CSSStyleSheet.prototype as any).replaceSync = function () {};
Object.defineProperty(Document.prototype, "adoptedStyleSheets", { value: [], writable: true });
Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", { value: [], writable: true });
(globalThis as any).ImageData = class { constructor(public data: any, public width: number, public height: number) {} };
(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const page = (inner: string) => {
  const d = readCdxml(`<CDXML BondLength="30"><fonttable><font id="3" name="Arial"/></fonttable><page id="900">${inner}</page></CDXML>`);
  if (!d.ok) throw new Error(d.reason);
  return d.doc;
};

test("polymer brackets bypassed", () => {
  const d = page(`<fragment id="2"><n id="3" p="10 10"/><n id="4" p="40 10"/><b id="5" B="3" E="4"/></fragment>
      <graphic id="7" BoundingBox="25 2 25 18" GraphicType="Bracket" BracketType="Square"/>
      <bracketedgroup id="8" BracketedObjectIDs="4"><bracketattachment id="9" GraphicID="7"><crossingbond id="10" BondID="5" InnerAtomID="4"/></bracketattachment></bracketedgroup>`);
  console.log("brackets", d.brackets.length);
  const { structures } = pageStructures(d);
  console.log("POLY", structures.map((s) => [s.id, [...s.ids], !!s.mol, s.reason, s.mol?.getMolecularFormula().formula]));
});

test("OMe nickname", () => {
  const d = page('<fragment id="40"><n id="41" p="40 120"/><n id="42" p="70 120" NodeType="Unspecified"><t p="70 120"><s font="3" size="10">OMe</s></t></n><b id="43" B="41" E="42"/></fragment>');
  const { structures } = pageStructures(d);
  console.log("OME", structures.map((s) => [!!s.mol, s.reason, s.mol?.getAllAtoms()]));
});

test("R2' label", () => {
  const rn = (id: string, x: number, label: string) => `<n id="${id}" p="${x} 0" NodeType="GenericNickname" GenericNickname="R"><t p="${x} 3"><s font="3" size="10">${label}</s></t></n>`;
  const d = page(`<fragment id="10">${rn("101", 0, "R1")}<n id="102" p="30 0"/>${rn("103", 60, "R2'")}<b id="111" B="101" E="102"/><b id="112" B="102" E="103"/></fragment>`);
  const r = pageToMolecule(d);
  console.log("R2'", r.ok ? [0, 1, 2].map((i) => r.value.mol.getAtomicNo(i)) : r.reason);
});


test("model refusal keeps old page", async () => {
  document.body.innerHTML = '<div id="m"></div>';
  const { createChemCanvas } = await import("../../taskpane/chemCanvas");
  const msgs: string[] = [];
  const model = createChemCanvas(document.getElementById("m")!, { setStatus: (m) => void msgs.push(m) });
  const a = Molecule.fromSmiles("CC(O)CC");
  a.inventCoordinates();
  model.setMolecule(a);
  const p1 = model.render(false)!;
  const b = Molecule.fromSmiles("C[C@H](O)CCCCCC");
  b.inventCoordinates();
  b.ensureHelperArrays(Molecule.cHelperParities);
  let sa = -1;
  for (let i = 0; i < b.getAtoms(); i++) if (b.getAtomParity(i) !== 0 && b.getAtomParity(i) !== 3) sa = i;
  b.setAtomESR(sa, Molecule.cESRTypeAnd, 0);
  b.ensureHelperArrays(Molecule.cHelperParities);
  console.log("esr atom", sa, b.getAtomESRType(sa));
  model.setMolecule(b);
  const p2 = model.render(false)!;
  console.log("SAME PAGE after ESR edit?", p2.svg === p1.svg, msgs);
  const c = Molecule.fromSmiles("CCCO");
  c.inventCoordinates();
  c.setAtomCustomLabel(3, "OMe2");
  model.setMolecule(c);
  console.log("SAME PAGE after custom label?", model.render(false)!.svg === p1.svg, msgs.slice(-1));
});

test("selectedPart logic", () => {
  const mol = Molecule.fromSmiles("OCCCN");
  mol.inventCoordinates();
  mol.setAtomSelection(0, true);
  mol.setAtomSelection(1, true);
  const n = mol.getAllAtoms();
  const part = mol.getCompactCopy();
  for (let i = n - 1; i >= 0; i--) if (!mol.isSelectedAtom(i)) part.deleteAtom(i);
  console.log("PART", part.getMolecularFormula().formula, part.getAllAtoms(), part.getAllBonds());
});

test("which editor-reachable features moleculeToPage refuses", async () => {
  const { moleculeToPage } = await import("../cdxmlMol");
  const { blankPageCdxml } = await import("../cdxmlEdit");
  const M = Molecule as any;
  const tries: Array<[string, (m: Molecule) => void]> = [
    ["radical T", (m) => m.setAtomRadical(1, M.cAtomRadicalStateT)],
    ["radical S", (m) => m.setAtomRadical(1, M.cAtomRadicalStateS)],
    ["QF ring size", (m) => { m.setFragment(true); m.setAtomQueryFeature(1, M.cAtomQFRingSize, true); }],
    ["QF pi", (m) => { m.setFragment(true); m.setAtomQueryFeature(1, M.cAtomQFPiElectrons, true); }],
    ["QF heteroneighbours", (m) => { m.setFragment(true); m.setAtomQueryFeature(1, M.cAtomQFHeteroAromatic ?? 0, true); }],
    ["QF exclude group", (m) => { m.setFragment(true); m.setAtomQueryFeature(1, M.cAtomQFExcludeGroup, true); }],
    ["QF matchStereo", (m) => { m.setFragment(true); m.setAtomQueryFeature(1, M.cAtomQFMatchStereo, true); }],
    ["bond QF ring size", (m) => { m.setFragment(true); m.setBondQueryFeature(0, M.cBondQFRingSize, true); }],
    ["bond QF bridge", (m) => { m.setFragment(true); m.setBondQueryFeature(0, M.cBondQFBridge, true); }],
    ["metal bond", (m) => m.setBondType(0, M.cBondTypeMetalLigand)],
    ["atom ? (0)", (m) => m.setAtomicNo(2, 0)],
    ["isotope D", (m) => m.setAtomMass(2, 2)],
    ["abnormal valence", (m) => m.setAtomAbnormalValence(1, 5)],
  ];
  for (const [name, f] of tries) {
    const m = Molecule.fromSmiles("CCCO");
    m.inventCoordinates();
    try { f(m); } catch (e) { console.log(name, "setup threw", (e as Error).message); continue; }
    const d = readCdxml(blankPageCdxml());
    if (!d.ok) throw new Error();
    const r = moleculeToPage(d.doc, m);
    console.log("FEAT", name, r.ok ? "ok" : r.reason);
  }
});

test("url length of idcode+coords", () => {
  for (const [n, smi] of [["taxol", "CC1=C2[C@@]([C@]([C@H]([C@@H]3[C@]4([C@H](OC4)C[C@@H]([C@]3(C(=O)[C@@H]2OC(=O)C)C)O)OC(=O)C)OC(=O)c5ccccc5)(C[C@@H]1OC(=O)[C@H](O)[C@@H](NC(=O)c6ccccc6)c7ccccc7)O)(C)C"], ["vanco-ish", "CC1C(C(CC(O1)OC2C(C(C(OC2OC3=C4C=C5C=C3OC6=C(C=C(C=C6)C(C(C(=O)NC(C(=O)NC5C(=O)NC7C8=CC(=CC(=C8)O)C(=C(C=C7O)O)C9=C(C=CC(=C9)C(C(=O)N4)NC(=O)C(CC(=O)N)NC(=O)C(CC(C)C)NC)O)O)C(=O)O)O)Cl)CO)O)O)(C)N)O"]]) {
    const m = Molecule.fromSmiles(smi);
    m.inventCoordinates();
    const e = m.getIDCodeAndCoordinates();
    console.log("URLLEN", n, m.getAllAtoms(), ("https://x.github.io/word-chem-formula/drawdialog.html?mol=" + encodeURIComponent(`${e.idCode} ${e.coordinates}`)).length);
  }
});
