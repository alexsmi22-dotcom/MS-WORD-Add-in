// The adversarial review of the ChemDraw import (v2.152.0): each confirmed defect, pinned. Every
// document is written by hand.
import { parseXml } from "../xmlLite";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { renderCdx } from "../cdxmlRender";
import { objectBoxes } from "../cdxmlSelect";
import { addBondFrom, deleteInStructure, findById, setAtomLabel, setBond, setCharge, setText, writeCdxml } from "../cdxmlEdit";

const wrap = (body: string, rootAttrs = ""): string =>
  `<?xml version="1.0" encoding="UTF-8" ?><CDXML BondLength="30" LineWidth="1" BoldWidth="4" ${rootAttrs.includes("HashSpacing") ? "" : "HashSpacing=\"2.7\""} MarginWidth="2" LabelSize="10" LabelFont="3" LabelFace="96" CaptionSize="12" ${rootAttrs}><fonttable><font id="3" name="Arial"/></fonttable><page id="1">${body}</page></CDXML>`;
const open = (body: string, rootAttrs = ""): CdxDoc => {
  const r = readCdxml(wrap(body, rootAttrs));
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const reread = (d: CdxDoc): CdxDoc => {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const svg = (d: CdxDoc): string => renderCdx(reread(d))!.svg;
const label = (d: CdxDoc, id: string): string =>
  findById(d.root, id)!.el.children.find((c) => c.name === "t")?.children.map((s) => s.text).join("") ?? "";

describe("D1: a damaged hash spacing cannot freeze Word", () => {
  test.each(["Hash", "WedgedHashBegin", "Wavy"])("HashSpacing 0 with a %s bond: drawn at once, with a bounded number of strokes", (disp) => {
    const d = open(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><b id="5" B="3" E="4" Display="${disp}"/></fragment>`, 'HashSpacing="0"');
    const t0 = Date.now();
    const s = svg(d);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((s.match(/<line|Q/g) ?? []).length).toBeLessThanOrEqual(202);
  });
  test("a bond 10,000,000 points long is drawn with the same bound", () => {
    const d = open(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="10000000 0"/><b id="5" B="3" E="4" Display="Hash"/></fragment>`);
    expect(svg(d).length).toBeLessThan(100_000);
  });
});

describe("D2: a charge is drawn, and its symbol follows it", () => {
  const chain = `<fragment id="2"><n id="3" p="0 0"/><n id="4" p="26 15" Element="7" NumHydrogens="2"><t p="22 18.5" BoundingBox="22 10 40 20"><s font="3" size="10" face="96">NH2</s></t></n><b id="5" B="3" E="4"/></fragment>`;
  test("a labelled N given +1: NH3 with a + drawn", () => {
    const d = open(chain);
    setCharge(d, "4", 1);
    expect(label(d, "4")).toBe("NH3");
    expect(svg(d)).toMatch(/>\+<\/text>/);
  });
  test("a bare carbon given −2: 2− drawn by it", () => {
    const d = open(chain);
    setCharge(d, "3", -2);
    expect(svg(d)).toContain(">2−</text>");
  });
  test("a ⊕ that shows the charge: updated to ⊖, removed at 0 (no + drawn twice, none left over)", () => {
    const d = open(chain.replace('Element="7"', 'Element="7" Charge="1"') + `<graphic id="9" BoundingBox="40 5 32 5" GraphicType="Symbol" SymbolType="CirclePlus"><represent attribute="Charge" object="4"/></graphic>`);
    expect(svg(d)).not.toMatch(/>\+<\/text>/); // the symbol draws it
    setCharge(d, "4", -1);
    expect(findById(d.root, "9")!.el.attrs.SymbolType).toBe("CircleMinus");
    setCharge(d, "4", 0);
    expect(findById(d.root, "9")).toBeNull();
  });
  test("erasing a charged atom takes its ⊕ with it", () => {
    const d = open(chain.replace('Element="7"', 'Element="7" Charge="1"') + `<graphic id="9" BoundingBox="40 5 32 5" GraphicType="Symbol" SymbolType="CirclePlus"><represent attribute="Charge" object="4"/></graphic>`);
    deleteInStructure(d, "4");
    expect(findById(d.root, "9")).toBeNull();
  });
});

describe("D3, D4: hydrogens follow bonds and charges", () => {
  const two = (order = "", charge = ""): string =>
    `<fragment id="2"><n id="3" p="0 0"/><n id="4" p="26 15" ${charge}/><b id="5" B="3" E="4" ${order}/></fragment>`;
  test("C–OH made C=O: the label becomes O", () => {
    const d = open(two());
    setAtomLabel(d, "4", "O");
    expect(label(d, "4")).toBe("OH");
    setBond(d, "5", { order: "2" });
    expect(label(d, "4")).toBe("O");
    expect(findById(d.root, "4")!.el.attrs.NumHydrogens).toBe("0");
  });
  test.each([
    ["O", 'Charge="1"', "", "OH2"],
    ["S", 'Charge="1"', "", "SH2"],
    ["N", 'Charge="1"', "", "NH3"],
    ["O", 'Charge="-1"', "", "O"],
    ["P", "", 'Order="2"', "PH"],
    ["S", "", 'Order="2"', "S"],
    ["O", "", 'Order="hydrogen"', "OH2"],
  ])("%s %s %s → %s", (sym, charge, order, want) => {
    const d = open(two(order, charge));
    setAtomLabel(d, "4", sym);
    expect(label(d, "4")).toBe(want);
  });
  test("B⁻ alone: BH4", () => {
    const d = open(`<fragment id="2"><n id="4" p="0 0" Charge="-1"/></fragment>`);
    setAtomLabel(d, "4", "B");
    expect(label(d, "4")).toBe("BH4");
  });
});

describe("D5, D13: Save writes what is drawn, as XML ChemDraw reads", () => {
  test("a run of one space survives", () => {
    const d = open(`<t id="9" p="10 20"><s font="3" size="12">Compound</s><s font="3" size="12"> </s><s font="3" size="12">1</s></t>`);
    const again = readCdxml(writeCdxml(d.root));
    expect(again.ok && again.doc.objects[0].items[0].kind === "text" && again.doc.objects[0].items[0].v.runs.map((r) => r.text)).toEqual(["Compound", " ", "1"]);
  });
  test("a reference to a character XML forbids is refused; a line break in an attribute round-trips", () => {
    expect(parseXml('<a x="&#x1;"/>')).toEqual({ ok: false, reason: "it is not well-formed XML (line 1: the reference &#x1; is not one XML defines)" });
    const d = open(`<t id="9" p="10 20" Warning="line one&#10;line two"><s font="3" size="12">x</s></t>`);
    const out = writeCdxml(d.root);
    expect(out).toContain('Warning="line one&#10;line two"');
    const again = readCdxml(out);
    expect(again.ok && findById(again.doc.root, "9")!.el.attrs.Warning).toBe("line one\nline two");
  });
});

describe("D6, D10, D11: large or damaged documents stay fast and never throw", () => {
  test("2,000 bracketed structures: every box in under a second", () => {
    let body = "";
    for (let i = 0; i < 2000; i++) {
      const id = 10 * i + 10, x = (i % 40) * 50, y = Math.floor(i / 40) * 50;
      body += `<fragment id="${id}"><n id="${id + 1}" p="${x} ${y}"/><n id="${id + 2}" p="${x + 30} ${y}"/><b id="${id + 3}" B="${id + 1}" E="${id + 2}"/></fragment>`;
      body += `<graphic id="${id + 4}" BoundingBox="${x + 15} ${y - 8} ${x + 15} ${y + 8}" GraphicType="Bracket" BracketType="Square"/>`;
      body += `<bracketedgroup id="${id + 5}" BracketedObjectIDs="${id + 2}"><bracketattachment id="${id + 6}" GraphicID="${id + 4}"><crossingbond id="${id + 7}" BondID="${id + 3}" InnerAtomID="${id + 2}"/></bracketattachment></bracketedgroup>`;
    }
    const d = open(body);
    const t0 = Date.now();
    expect(objectBoxes(d).size).toBe(4000);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test("one atom with 3,000 double bonds: drawn in under two seconds", () => {
    let body = `<fragment id="1"><n id="2" p="0 0"/>`;
    for (let i = 0; i < 3000; i++) body += `<n id="${10 + i}" p="${30 * Math.cos(i)} ${30 * Math.sin(i)}"/><b id="${100000 + i}" B="2" E="${10 + i}" Order="2"/>`;
    const d = open(body + "</fragment>");
    const t0 = Date.now();
    expect(renderCdx(d)).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  test("a caption of 200,000 runs is drawn, not thrown on", () => {
    const d = open(`<t id="9" p="10 20">${"<s font=\"3\" size=\"12\">a</s>".repeat(200000)}</t>`);
    expect(() => renderCdx(d)).not.toThrow();
  });
});

describe("D8, D12, D14, D15, D16", () => {
  test("a caption can be edited twice (its box follows its words)", () => {
    const d = open(`<t id="9" p="10 20" BoundingBox="10 10 60 23"><s font="3" size="12">first</s></t>`);
    expect(setText(d, "9", "second words")).toBeNull();
    const box = findById(d.root, "9")!.el.attrs.BoundingBox!.split(" ").map(Number);
    expect(box[2]).toBeGreaterThan(60);
    expect(setText(d, "9", "third")).toBeNull();
  });
  test("a bond order drawn as a single line is named", () => {
    const d = open(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><b id="5" B="3" E="4" Order="4"/></fragment>`);
    expect(d.notes).toEqual(['bonds of order "4" are drawn as single lines']);
  });
  test("ids past 2^53: a new atom and its bond get different ids", () => {
    const d = open(`<fragment id="2"><n id="9007199254740993" p="0 0"/></fragment>`);
    const r = addBondFrom(d, "9007199254740993");
    expect(r.ok && r.nodeId !== r.bondId).toBe(true);
    expect(r.ok && r.nodeId).toBe("9007199254740994");
  });
  test("a symbol named like an object property draws nothing (no JavaScript text in the SVG)", () => {
    const d = open(`<graphic id="7" BoundingBox="100 100 88 100" GraphicType="Symbol" SymbolType="constructor"/><t id="8" p="0 0"><s font="3" size="12">x</s></t>`);
    expect(renderCdx(d)!.svg).not.toContain("function");
  });
  test("a [ or > inside the DOCTYPE's quoted identifier is not a subset", () => {
    expect(parseXml('<!DOCTYPE CDXML SYSTEM "http://x/y[1].dtd"><CDXML/>').ok).toBe(true);
    expect(parseXml('<!DOCTYPE CDXML SYSTEM "a>b"><CDXML/>').ok).toBe(true);
    expect(parseXml('<!DOCTYPE CDXML [<!ENTITY e "x">]><CDXML/>').ok).toBe(false);
  });
});
