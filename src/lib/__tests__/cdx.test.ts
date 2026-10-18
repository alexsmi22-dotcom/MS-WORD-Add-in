// Binary ChemDraw (.cdx) → the CDXML tree. Exact cases are built byte by byte below; two published
// USPTO patent drawings (fixtures/, public documents, as in RDKit's ChemDraw test data) are read whole.
import * as fs from "fs";
import * as path from "path";
import { readCdx, CDX_LIMITS } from "../cdx";
import { readCdxmlTree } from "../cdxml";
import { renderCdx } from "../cdxmlRender";
import { writeCdxml } from "../cdxmlEdit";
import type { XNode } from "../xmlLite";

/** A little CDX writer: objects and properties, little-endian, as the format lays them out. */
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
    this.u16(tag);
    if (data.length >= 0xffff) this.u16(0xffff).u32(data.length);
    else this.u16(data.length);
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
const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));

function read(w: W): { root: XNode; notes: string[] } {
  const r = readCdx(w.bytes());
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const find = (n: XNode, name: string): XNode | undefined => {
  if (n.name === name) return n;
  for (const k of n.children) {
    const f = find(k, name);
    if (f) return f;
  }
  return undefined;
};

describe("reading the binary layout", () => {
  test("points are stored y then x, boxes top left bottom right; coordinates in 1/65536 pt", () => {
    const w = new W()
      .obj(0x8001, 1)
      .obj(0x8003, 2)
      .obj(0x8004, 3)
      .prop(0x0200, [...c(164.25), ...c(148.5)]) // p: y, x
      .end()
      .end()
      .prop(0x0204, [...c(10), ...c(20), ...c(30), ...c(40)]) // BoundingBox on the page: t l b r
      .end()
      .end();
    const r = read(w);
    expect(find(r.root, "n")!.attrs.p).toBe("148.5 164.25");
    expect(find(r.root, "page")!.attrs.BoundingBox).toBe("20 10 40 30");
  });

  test("enums take ChemDraw's names; flag enums name each bit; booleans are yes / no", () => {
    const w = new W()
      .obj(0x8001, 1)
      .obj(0x8003, 2)
      .obj(0x8005, 5)
      .prop(0x0604, i32(3)) // B
      .prop(0x0605, i32(4)) // E
      .prop(0x0600, i16(0x0003)) // Order: single | double
      .prop(0x0601, i16(3)) // Display: WedgedHashBegin
      .end()
      .end()
      .obj(0x8021, 9) // arrow
      .prop(0x0a35, i16(2)) // ArrowheadHead: Full
      .prop(0x0a2f, i16(1)) // ArrowheadType: Solid
      .prop(0x0011, [0]) // Visible: no
      .end()
      .end();
    const r = read(w);
    expect(find(r.root, "b")!.attrs).toMatchObject({ B: "3", E: "4", Order: "1 2", Display: "WedgedHashBegin" });
    expect(find(r.root, "arrow")!.attrs).toMatchObject({ ArrowheadHead: "Full", ArrowheadType: "Solid", Visible: "no" });
  });

  test("text: one <s> per style run, sizes from 20ths of a point, decoded in the font's code page", () => {
    // Font table: platform 1 (Windows), 1 font: id 3, charset 1252, "Arial".
    const fonts = [...i16(1), ...i16(1), ...i16(3), ...i16(1252), ...i16(5), ...ascii("Arial")];
    // "CH3" — two runs: "CH" plain, "3" subscript (face 0x20); 10 pt = 200 twentieths. 0xB5 is µ in 1252.
    const text = [...i16(2), ...i16(0), ...i16(3), ...i16(0), ...i16(200), ...i16(3), ...i16(2), ...i16(3), ...i16(0x20), ...i16(200), ...i16(3), ...ascii("CH3"), 0xb5];
    const w = new W().prop(0x0100, fonts).obj(0x8001, 1).obj(0x8006, 7).prop(0x0200, [...c(20), ...c(10)]).prop(0x0700, text).end().end().end();
    const r = read(w);
    expect(find(r.root, "font")!.attrs).toEqual({ id: "3", charset: "iso-8859-1", name: "Arial" });
    const t = find(r.root, "t")!;
    expect(t.children.map((s) => [s.text, s.attrs.size, s.attrs.face])).toEqual([
      ["CH", "10", undefined],
      ["3µ", "10", "32"],
    ]);
  });

  test("units ChemDraw writes differently in CDXML: chain angle, bond spacing, label style, line height", () => {
    const w = new W()
      .prop(0x0803, i32(120 * 65536)) // ChainAngle
      .prop(0x0804, i16(180)) // BondSpacing: 18 %
      .prop(0x080a, [...i16(3), ...i16(0x60), ...i16(200), ...i16(3)]) // LabelStyle
      .prop(0x0707, i16(1)) // CaptionLineHeight: automatic
      .obj(0x8001, 1)
      .end()
      .end();
    expect(read(w).root.attrs).toMatchObject({ ChainAngle: "120", BondSpacing: "18", LabelFont: "3", LabelFace: "96", LabelSize: "10", CaptionLineHeight: "auto" });
  });

  test("a symbol's represent link becomes a <represent> naming the property", () => {
    const w = new W().obj(0x8001, 1).obj(0x8007, 7).prop(0x000e, [...i32(42), ...i16(0x0421)]).end().end().end();
    expect(find(read(w).root, "represent")!.attrs).toEqual({ attribute: "Charge", object: "42" });
  });

  test("a property longer than 65,534 bytes uses the 32-bit length", () => {
    const big = new Array(70000).fill(0x41);
    const w = new W().obj(0x8001, 1).prop(0x0009, [...i16(0), ...big]).end().end(); // Comment
    expect(read(w).root.children[0].attrs.Comment).toHaveLength(70000);
  });

  test("with or without a Document object around the contents", () => {
    const inner = (w: W): W => w.obj(0x8001, 1).obj(0x8003, 2).obj(0x8004, 3).prop(0x0200, [...c(1), ...c(2)]).end().end().end();
    const implicit = inner(new W()).end();
    const explicit = inner(new W().obj(0x8000, 0)).end();
    expect(find(read(implicit).root, "n")!.attrs.p).toBe("2 1");
    expect(find(read(explicit).root, "n")!.attrs.p).toBe("2 1");
  });

  test("tags this release does not know are named in a note, not guessed", () => {
    const w = new W().obj(0x8001, 1).prop(0x3f00, [1, 2]).end().end();
    expect(read(w).notes).toEqual(["properties of a kind this release does not know (tag 0x3f00)"]);
  });
});

describe("damaged files are refused by name", () => {
  test("not a CDX file", () => {
    expect(readCdx(Uint8Array.from(ascii("<CDXML/>".padEnd(40))))).toEqual({ ok: false, reason: "it is not a ChemDraw CDX file (it does not start with VjCD0100)" });
  });
  test("a property longer than the file", () => {
    const w = new W().obj(0x8001, 1).u16(0x0200).u16(500);
    const r = readCdx(w.bytes());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^the CDX file is damaged \(at byte \d+: a property says it holds 500 bytes, but 0 remain\)$/);
  });
  test("objects nested deeper than the limit", () => {
    const w = new W();
    for (let i = 0; i <= CDX_LIMITS.depth + 1; i++) w.obj(0x8002, i + 1);
    expect(readCdx(w.bytes())).toEqual({ ok: false, reason: `its objects are nested more than ${CDX_LIMITS.depth} deep` });
  });
});

describe("real patent drawings (USPTO, ChemDraw 8 and 12)", () => {
  const load = (f: string) => {
    const b = readCdx(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", f))));
    if (!b.ok) throw new Error(b.reason);
    const d = readCdxmlTree(b.root);
    if (!d.ok) throw new Error(d.reason);
    return { notes: b.notes, doc: d.doc };
  };
  const labels = (doc: ReturnType<typeof load>["doc"]): string[] =>
    doc.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.nodes.filter((n) => n.label).map((n) => n.label!.runs.map((r) => r.text).join("")) : []));

  test("a Markush fragment (ChemDraw 8): its atoms, bonds and labels", () => {
    const { notes, doc } = load("US08262949-C00020.cdx");
    expect(notes).toEqual([]);
    expect(doc.program).toBe("ChemDraw 8.0");
    const fr = doc.objects.flatMap((o) => o.items).find((it) => it.kind === "fragment");
    expect(fr && fr.kind === "fragment" && [fr.v.nodes.length, fr.v.bonds.length]).toEqual([7, 6]);
    expect(labels(doc).sort()).toEqual(["N", "R102", "X12", "Y12"]);
  });

  test("a peptide fragment (ChemDraw 12) draws, and saves as CDXML that reads back the same", () => {
    const { doc } = load("US12128110-C00013.cdx");
    expect(labels(doc).sort()).toEqual(["(Aax)m", "B", "Gln", "Lys"]);
    const svg = renderCdx(doc)!.svg;
    expect(svg).toContain(">Gln</tspan>");
    const again = readCdxmlTree(doc.root);
    const xml = writeCdxml(doc.root);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8" \?>/);
    expect(again.ok && labels(again.doc).sort()).toEqual(["(Aax)m", "B", "Gln", "Lys"]);
  });
});
