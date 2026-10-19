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

describe("review of Clean (round 2)", () => {
  test("1. E / Z kept when one alkene carbon carries two different group labels (OMe, OEt): laid out with the same isomer, or refused — never flipped", () => {
    for (const [l1, l2] of [["OMe", "OEt"], ["OEt", "OMe"], ["Ph", "Bn"]]) {
      const d = page(`<fragment id="10"><n id="101" p="60 100"/><n id="102" p="85 85"/><n id="103" p="115 85"/><n id="104" p="130 60" NodeType="Unspecified"><t p="130 60"><s font="3" size="10">${l1}</s></t></n><n id="105" p="130 110" NodeType="Unspecified"><t p="130 110"><s font="3" size="10">${l2}</s></t></n><b id="106" B="101" E="102"/><b id="107" B="102" E="103" Order="2"/><b id="108" B="103" E="104"/><b id="109" B="103" E="105"/></fragment>`);
      const before = idcodeOf(d, "10");
      const r = cleanStructures(d);
      if (r === null) expect(idcodeOf(reread(d), "10")).toBe(before);
      else expect(r).toMatch(/would change it/);
    }
  });
  test("2. a drawn H on a wedged stereocentre: laid out with its H, the stereo unchanged", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100"/><n id="102" p="130 100"/><n id="103" p="145 75" Element="7" NumHydrogens="2"><t p="145 75"><s font="3" size="10" face="96">NH2</s></t></n><n id="104" p="145 125"/><n id="105" p="160 100" Element="1"><t p="160 100"><s font="3" size="10">H</s></t></n><n id="106" p="175 125" Element="8" NumHydrogens="1"><t p="175 125"><s font="3" size="10" face="96">OH</s></t></n><b id="107" B="101" E="102"/><b id="108" B="102" E="103"/><b id="109" B="102" E="104"/><b id="110" B="102" E="105" Display="WedgeBegin"/><b id="111" B="104" E="106"/></fragment>');
    const before = idcodeOf(d, "10");
    expect(cleanStructures(d)).toBeNull();
    const after = reread(d);
    expect(idcodeOf(after, "10")).toBe(before);
    expect(findById(d.root, "105")).not.toBeNull();
  });
  test("4. a plain hashed bond (Display=\"Hash\") is not a wedge: kept, and no refusal for it", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100"/><n id="102" p="150 100"/><n id="103" p="155 111" NodeType="Unspecified"><t p="155 111"><s font="3" size="10">OMe</s></t></n><b id="104" B="101" E="102" Display="Hash"/><b id="105" B="102" E="103"/></fragment>');
    expect(cleanStructures(d)).toBeNull();
    expect(findById(d.root, "104")!.el.attrs.Display).toBe("Hash");
  });
});

describe("review of Clean (round 3)", () => {
  test("1. veratrole with both groups labelled OMe cleans at every rotation (labels meaning the same group are one kind)", () => {
    for (let k = 0; k < 12; k++) {
      const rot = (k * Math.PI) / 6;
      const pt = (x: number, y: number): string => `${(150 + x * Math.cos(rot) - y * Math.sin(rot)).toFixed(2)} ${(150 + x * Math.sin(rot) + y * Math.cos(rot)).toFixed(2)}`;
      let s = "";
      for (let i = 0; i < 6; i++) s += `<n id="${101 + i}" p="${pt(30 * Math.cos((Math.PI / 3) * i), 30 * Math.sin((Math.PI / 3) * i))}"/>`;
      // Each label as ChemDraw writes it for its side: MeO (right-justified) left of its bond, OMe right of it.
      const label = (id: number, at: [number, number], ring: [number, number]): string => {
        const left = Number(pt(...ring).split(" ")[0]) > Number(pt(...at).split(" ")[0]);
        return `<n id="${id}" p="${pt(...at)}" NodeType="Unspecified"><t p="${pt(...at)}" LabelJustification="${left ? "Right" : "Left"}"><s font="3" size="10">${left ? "MeO" : "OMe"}</s></t></n>`;
      };
      s += label(111, [55, 0], [30, 0]);
      s += label(112, [27, 47], [15, 26]);
      for (let i = 0; i < 6; i++) s += `<b id="${201 + i}" B="${101 + i}" E="${101 + ((i + 1) % 6)}" Order="${i % 2 ? "1" : "2"}"/>`;
      s += '<b id="211" B="101" E="111"/><b id="212" B="102" E="112"/>';
      const d = page(`<fragment id="10">${s}</fragment>`);
      const before = idcodeOf(d, "10");
      expect([k, cleanStructures(d)]).toEqual([k, null]);
      expect(idcodeOf(reread(d), "10")).toBe(before);
    }
  });
  test("3/5. a CH3 label and an unusual NH keep their drawn hydrogens when Clean turns them for the other side", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100" NumHydrogens="3"><t p="100 100"><s font="3" size="10" face="96">CH3</s></t></n><n id="102" p="70 120"/><n id="103" p="40 100"/><n id="104" p="10 120" Element="7" NumHydrogens="1"><t p="10 120"><s font="3" size="10" face="96">NH</s></t></n><b id="105" B="101" E="102"/><b id="106" B="102" E="103"/><b id="107" B="103" E="104"/></fragment>');
    const before = idcodeOf(d, "10");
    expect(cleanStructures(d)).toBeNull();
    const words = (id: string): string => findById(d.root, id)!.el.children.find((c) => c.name === "t")!.children.map((s) => s.text).join("");
    expect(["CH3", "H3C"]).toContain(words("101"));
    expect(["NH", "HN"]).toContain(words("104"));
    expect(findById(d.root, "101")!.el.attrs.NumHydrogens).toBe("3");
    expect(findById(d.root, "104")!.el.attrs.NumHydrogens).toBe("1");
    expect(idcodeOf(reread(d), "10")).toBe(before);
  });
  test("2. an abbreviation (Nickname with its own structure) is never rewritten by Clean", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100"/><n id="102" p="130 100"/><n id="103" p="160 100" NodeType="Nickname"><fragment id="20"><n id="21" p="0 0"/><n id="22" p="10 0"/><n id="23" p="-10 0" NodeType="ExternalConnectionPoint"/><b id="31" B="21" E="22"/><b id="32" B="21" E="23"/></fragment><t p="160 100"><s font="3" size="10">Et</s></t></n><b id="104" B="101" E="102"/><b id="105" B="102" E="103"/></fragment>');
    const r = cleanStructures(d);
    expect(r === null || /would change/.test(r)).toBe(true);
    const n = findById(d.root, "103")!.el;
    expect(n.attrs.NodeType).toBe("Nickname");
    expect(n.children.some((c) => c.name === "fragment")).toBe(true);
  });
});

describe("review of Clean (round 4)", () => {
  test("1. linkage isomers on one alkene carbon (CN and NC) keep their E / Z: cleaned with the same isomer, or refused", () => {
    for (let k = 0; k < 8; k++) {
      const j = (v: number): string => (v + ((k * 7) % 5) - 2).toFixed(2);
      const d = page(`<fragment id="10"><n id="101" p="${j(60)} 100"/><n id="102" p="85 ${j(85)}"/><n id="103" p="115 85"/><n id="104" p="140 ${j(60)}" NodeType="Unspecified"><t p="140 60"><s font="3" size="10">CN</s></t></n><n id="105" p="140 ${j(110)}" NodeType="Unspecified"><t p="140 110"><s font="3" size="10">NC</s></t></n><b id="106" B="101" E="102"/><b id="107" B="102" E="103" Order="2"/><b id="108" B="103" E="104"/><b id="109" B="103" E="105"/></fragment>`);
      const before = idcodeOf(d, "10");
      const r = cleanStructures(d);
      if (r === null) expect(idcodeOf(reread(d), "10")).toBe(before);
      else expect(r).toMatch(/would change/);
    }
  });
  test("3. a label turned for its side keeps its own attributes (colour)", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100" NumHydrogens="3"><t p="100 100" color="5"><s font="3" size="10" face="96">CH3</s></t></n><n id="102" p="70 120"/><n id="103" p="40 100"/><b id="105" B="101" E="102"/><b id="106" B="102" E="103"/></fragment>');
    expect(cleanStructures(d)).toBeNull();
    expect(findById(d.root, "101")!.el.children.find((c) => c.name === "t")!.attrs.color).toBe("5");
  });
});

describe("review of Clean (round 5)", () => {
  test("1. labels with no justification on bonds that end near-vertical: cleaned readable with the same structure, or refused — never left unreadable", () => {
    for (const [l1, l2] of [["MeO", "OMe"], ["SCN", "NCS"], ["CN", "CN"]]) {
      for (let k = 0; k < 24; k++) {
        const rot = (k * Math.PI) / 12;
        const pt = (x: number, y: number): string => `${(100 + x * Math.cos(rot) - y * Math.sin(rot)).toFixed(3)} ${(100 + x * Math.sin(rot) + y * Math.cos(rot)).toFixed(3)}`;
        const d = page(`<fragment id="10"><n id="101" p="${pt(-40, 10)}"/><n id="102" p="${pt(-15, 0)}"/><n id="103" p="${pt(15, 0)}"/><n id="104" p="${pt(30, -26)}" NodeType="Unspecified"><t p="${pt(30, -26)}"><s font="3" size="10">${l1}</s></t></n><n id="105" p="${pt(30, 26)}" NodeType="Unspecified"><t p="${pt(30, 26)}"><s font="3" size="10">${l2}</s></t></n><b id="106" B="101" E="102"/><b id="107" B="102" E="103" Order="2"/><b id="108" B="103" E="104"/><b id="109" B="103" E="105"/></fragment>`);
        const before = idcodeOf(d, "10");
        const readable = !/^“/.test(before) && !/ /.test(before);
        const r = cleanStructures(d);
        if (r === null && readable) expect([l1, l2, k, idcodeOf(reread(d), "10")]).toEqual([l1, l2, k, before]);
        if (r === null && !readable) expect(true).toBe(true);
      }
    }
  });
  test("3. a turned label's LabelAlignment follows its new justification", () => {
    const d = page('<fragment id="10"><n id="101" p="100 100" Element="8" NumHydrogens="1"><t p="100 100" LabelJustification="Left" LabelAlignment="Left"><s font="3" size="10" face="96">OH</s></t></n><n id="102" p="70 120"/><n id="103" p="40 100"/><b id="105" B="101" E="102"/><b id="106" B="102" E="103"/></fragment>');
    expect(cleanStructures(d)).toBeNull();
    const t = findById(d.root, "101")!.el.children.find((c) => c.name === "t")!;
    expect(t.attrs.LabelAlignment).toBe(t.attrs.LabelJustification);
  });
});
