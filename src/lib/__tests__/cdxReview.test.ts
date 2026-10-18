// The adversarial review of .cdx reading and the Ring tool (v2.153.0): each confirmed defect, pinned.
// Files are built byte by byte here; Revvity's open-source ChemDraw code is the reference cited.
import { readCdx } from "../cdx";
import { readCdxml, readCdxmlTree, CdxDoc } from "../cdxml";
import { renderCdx } from "../cdxmlRender";
import { addRingOnBond, findById, setAtomLabel, addBondFrom } from "../cdxmlEdit";
import type { XNode } from "../xmlLite";

class W {
  private b: number[] = [];
  constructor() {
    for (const c of "VjCD0100") this.b.push(c.charCodeAt(0));
    this.b.push(4, 3, 2, 1, ...new Array(16).fill(0));
  }
  u16(v: number): this {
    this.b.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    this.b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  obj(tag: number, id: number): this {
    return this.u16(tag).u32(id);
  }
  end(): this {
    return this.u16(0);
  }
  prop(tag: number, data: number[]): this {
    this.u16(tag).u16(data.length);
    this.b.push(...data);
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}
const i16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const i32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const c = (pt: number): number[] => i32(Math.round(pt * 65536));
const f64 = (v: number): number[] => [...new Uint8Array(new Float64Array([v]).buffer)];
const bytesOf = (s: string): number[] => [...Buffer.from(s, "utf8")];
const find = (n: XNode, name: string): XNode | undefined => (n.name === name ? n : n.children.map((k) => find(k, name)).find(Boolean));
const read = (w: W): XNode => {
  const r = readCdx(w.bytes());
  if (!r.ok) throw new Error(r.reason);
  return r.root;
};
/** A string property: no style runs, then bytes. */
const str = (b: number[]): number[] => [...i16(0), ...b];
/** One style run (start 0, font, face 0, 10 pt, colour 3), then bytes. */
const run1 = (font: number, b: number[]): number[] => [...i16(1), ...i16(0), ...i16(font), ...i16(0), ...i16(200), ...i16(3), ...b];

describe("reading .cdx as ChemDraw does", () => {
  test("3D points are x, y, z (CDXIO.h; CDXArrow.cpp) — an arrow lands where it was drawn", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8021, 9).prop(0x0207, [...c(208), ...c(65), ...c(0)]).prop(0x0208, [...c(150), ...c(65), ...c(0)]).end().end().end());
    expect(find(root, "arrow")!.attrs).toMatchObject({ Head3D: "208 65 0", Tail3D: "150 65 0" });
  });
  test("SupersededBy is an object id (CDXGraphicObject.cpp), so the old copy of an arrow is not drawn", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8007, 5).prop(0x0013, i32(9)).end().obj(0x8021, 9).prop(0x0207, [...c(10), ...c(10), ...c(0)]).prop(0x0208, [...c(50), ...c(10), ...c(0)]).end().end().end());
    expect(find(root, "graphic")!.attrs.SupersededBy).toBe("9");
    const d = readCdxmlTree(root);
    expect(d.ok && d.doc.objects.map((o) => o.kind)).toEqual(["arrow"]);
  });
  test("the UTF-8 text (0x0709) replaces the legacy text (CDXText.cpp)", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8006, 7).prop(0x0700, str([0x3f, ...bytesOf("-pinene")])).prop(0x0709, str(bytesOf("α-pinene"))).end().end().end());
    expect(find(root, "t")!.children.map((s) => s.text)).toEqual(["α-pinene"]);
  });
  test("a 4-byte charge is the charge × 2^24 (CDXNode.cpp)", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8003, 2).obj(0x8004, 3).prop(0x0421, i32(1 << 24)).end().obj(0x8004, 4).prop(0x0421, i32(-2 * 16777216)).end().end().end().end());
    const ns: string[] = [];
    const walk = (n: XNode): void => {
      if (n.name === "n") ns.push(n.attrs.Charge);
      n.children.forEach(walk);
    };
    walk(root);
    expect(ns).toEqual(["1", "-2"]);
  });
  test("bond order 0x8000 is threecenter; all-ones (any) is left out (CDXBond.cpp)", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8003, 2).obj(0x8005, 5).prop(0x0600, i16(0x8000)).end().obj(0x8005, 6).prop(0x0600, i16(0xffff)).end().end().end().end());
    const bonds: XNode[] = [];
    const walk = (n: XNode): void => {
      if (n.name === "b") bonds.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    expect(bonds.map((b) => b.attrs.Order)).toEqual(["threecenter", undefined]);
  });
  test("RepeatCount is an 8-byte float (CDXBracketedGroup.cpp); RotationAngle is written as stored", () => {
    const root = read(new W().obj(0x8001, 1).obj(0x8017, 2).prop(0x0a28, f64(2)).end().obj(0x8006, 3).prop(0x0205, i32(90)).end().end().end());
    expect(find(root, "bracketedgroup")!.attrs.RepeatCount).toBe("2");
    expect(find(root, "t")!.attrs.RotationAngle).toBe("90");
  });
  test("text before the first style run is kept (CDXText.cpp writes it unstyled)", () => {
    const w = new W().obj(0x8001, 1).obj(0x8006, 7).prop(0x0700, [...i16(1), ...i16(3), ...i16(3), ...i16(0), ...i16(200), ...i16(3), ...bytesOf("ABCdef")]).end().end().end();
    expect(find(read(w), "t")!.children.map((s) => s.text)).toEqual(["ABC", "def"]);
  });
  test("Symbol-font text is read as the Greek and signs it shows (k¢ → κ′); UTF-16 fonts decode; control bytes are dropped", () => {
    const fonts = [...i16(1), ...i16(2), ...i16(5), ...i16(0), ...i16(6), ...bytesOf("Symbol"), ...i16(6), ...i16(1200), ...i16(5), ...bytesOf("Arial")];
    const root = read(new W().prop(0x0100, fonts).obj(0x8001, 1).obj(0x8006, 7).prop(0x0700, run1(5, [0x6b, 0xa2, 0x61])).end().obj(0x8006, 8).prop(0x0700, run1(6, [0x41, 0, 0xb1, 0x03])).end().obj(0x8006, 9).prop(0x0700, str([0x41, 0x01, 0x42])).end().end().end());
    const texts: string[] = [];
    const walk = (n: XNode): void => {
      if (n.name === "t") texts.push(n.children.map((s) => s.text).join(""));
      n.children.forEach(walk);
    };
    walk(root);
    expect(texts).toEqual(["κ′α", "Aα", "AB"]); // in the Symbol font, k is κ and 0xA2 is ′
  });
});

describe("drawing never crashes on a damaged structure", () => {
  test("a bond to an atom that is not in the structure", () => {
    const r = readCdxml(`<CDXML BondLength="30"><page id="1"><fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><b id="5" B="3" E="99" Order="2"/><b id="6" B="3" E="4" Order="2"/></fragment></page></CDXML>`);
    expect(r.ok && (() => renderCdx(r.doc))).not.toThrow();
  });
});

describe("the Ring tool refuses rings it cannot draw truthfully", () => {
  const doc = (frag: string): CdxDoc => {
    const r = readCdxml(`<CDXML BondLength="30" LabelSize="10" LabelFont="3" LabelFace="96"><page id="1"><fragment id="10">${frag}</fragment></page></CDXML>`);
    if (!r.ok) throw new Error(r.reason);
    return r.doc;
  };
  test("benzene onto a saturated N–C bond: no neutral alternating pattern, refused by name", () => {
    // A pyrrolidine N (three single bonds would leave no room for a double).
    const d = doc(`<n id="1" p="0 0" Element="7" NumHydrogens="0"><t p="-3 3"><s font="3" size="10" face="96">N</s></t></n><n id="2" p="30 0"/><n id="3" p="-15 -26"/><n id="4" p="-15 26"/><b id="5" B="1" E="2"/><b id="6" B="1" E="3"/><b id="7" B="1" E="4"/>`);
    const r = addRingOnBond(d, "5", "benzene");
    expect(r).toBe("a benzene ring cannot go there: its double bonds cannot alternate with the bonds already there — choose Cyclohexane, or change the neighbouring bonds first");
  });
  test("the same ring fused onto the same bond twice: the second is refused", () => {
    const d = doc(`<n id="1" p="0 0"/><n id="2" p="30 0"/><b id="5" B="1" E="2"/>`);
    expect(addRingOnBond(d, "5", "cyclohexane")).toBeNull();
    expect(addRingOnBond(d, "5", "cyclohexane")).toBeNull(); // the other side
    expect(addRingOnBond(reread(d), "5", "cyclohexane")).toBe("that ring is already there");
  });
  test("a labelled CH3 given a new bond reads CH2", () => {
    const d = doc(`<n id="1" p="0 0"/><n id="2" p="30 0" NumHydrogens="3"><t p="27 3"><s font="3" size="10" face="96">CH3</s></t></n><b id="5" B="1" E="2"/>`);
    addBondFrom(d, "2");
    expect(findById(d.root, "2")!.el.children.find((c) => c.name === "t")!.children[0].text).toBe("CH2");
    void setAtomLabel;
  });
});

function reread(d: CdxDoc): CdxDoc {
  const r = readCdxmlTree(d.root);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
