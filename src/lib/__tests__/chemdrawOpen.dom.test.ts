/**
 * @jest-environment jsdom
 */
// Open ChemDraw file… and Open ChemDraw picture over the pane's real markup: refusals by name; the file or
// the picture's drawing opens on the Draw canvas (the one builder); the size a drawing goes into Word at.
import * as fs from "fs";
import * as path from "path";
import { TextDecoder as NodeTextDecoder } from "util";
import { openChemdrawFile } from "../chemdrawOpen";
import { chemdrawFit } from "../insertSize";
import { renderCdx } from "../cdxmlRender";
import { initChemdrawOpen } from "../../taskpane/chemdrawOpen";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const BUILD = /<section id="build-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

// A polymer with a bracket on one bond (the bracket names that bond and its inner atom), its "n"
// beside it, a ⊕ representing an atom's charge, and a second structure far away.
const CDXML = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML CreationProgram="Test" BondLength="30" LineWidth="1" BoldWidth="4" HashSpacing="2.7" MarginWidth="2" BondSpacing="12" LabelSize="10" CaptionSize="12">
<fonttable><font id="3" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">
<fragment id="10"><n id="11" p="100 100"/><n id="12" p="130 100"/><n id="13" p="160 100" Charge="1"/><b id="14" B="11" E="12"/><b id="15" B="12" E="13"/></fragment>
<graphic id="20" BoundingBox="115 90 115 110" GraphicType="Bracket" BracketType="Square"/>
<bracketedgroup id="21" BracketedObjectIDs="12"><bracketattachment id="22" GraphicID="20"><crossingbond id="23" BondID="14" InnerAtomID="12"/></bracketattachment></bracketedgroup>
<t id="24" p="117 118"><s font="3" size="10">n</s></t>
<graphic id="25" BoundingBox="160 88 152 88" GraphicType="Symbol" SymbolType="CirclePlus"><represent attribute="Charge" object="13"/></graphic>
<fragment id="30"><n id="31" p="400 600"/><n id="32" p="430 600"/><b id="33" B="31" E="32"/></fragment>
</page></CDXML>`;
const bytes = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "utf8"));

describe("opening a file", () => {
  test("a CDXML document opens", () => {
    const r = openChemdrawFile("figure.cdxml", bytes(CDXML));
    expect(r.ok && r.doc.objects.length).toBe(5);
  });
  test.each([
    ["figure.cdx", bytes("not a chemdraw file at all, just text"), "figure.cdx: it is not a ChemDraw CDX file (it does not start with VjCD0100)"],
    ["cut.cdx", bytes("VjCD0100\u0004\u0003\u0002\u0001"), "cut.cdx: it is not a ChemDraw CDX file (it does not start with VjCD0100)"],
    ["figure.mol", bytes("x"), "figure.mol: this opens ChemDraw files (.cdx and .cdxml)"],
    ["broken.cdxml", bytes("<CDXML><page>"), "broken.cdxml: it is not well-formed XML (line 1: <page> (line 1) is never closed)"],
    ["empty.cdxml", bytes('<CDXML><page id="1"/></CDXML>'), "empty.cdxml: the page has nothing drawn on it"],
  ])("%s is refused by name", (name, b, why) => {
    expect(openChemdrawFile(name, b)).toEqual({ ok: false, reason: why });
  });
  test("a binary ChemDraw file opens by its first bytes, whatever it is called (a USPTO drawing)", () => {
    const cdx = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "US12128110-C00013.cdx")));
    const r = openChemdrawFile("renamed.cdxml", cdx);
    expect(r.ok && r.doc.program).toBe("ChemDraw 12.0.2.1039");
    expect(openChemdrawFile("drawing.cdx", cdx).ok).toBe(true);
  });
});

describe("fitting a drawing on the page", () => {
  test("a structure goes in at ChemDraw's size; a wide one is fitted; one too large to read is refused", () => {
    expect(chemdrawFit(200, 100)).toEqual({ ok: true, k: 1, note: "It is inserted at ChemDraw's size." });
    expect(chemdrawFit(936, 100)).toEqual({ ok: true, k: 0.5, note: "It is inserted at 50 % to fit the page." });
    expect(chemdrawFit(1066, 8144)).toEqual({
      ok: false,
      reason: "that is 14.8 × 113.1 in — on a page it would be drawn at 7 %, too small to read. Select fewer structures (click one, Shift+click to add)",
    });
  });
});

describe("Open ChemDraw picture (a ChemDraw picture in the document)", () => {
  const opened: Array<{ name: string; html: string }> = [];
  const cdx = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "US12128110-C00013.cdx")));
  const le32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  function emfWith(data: number[]): Uint8Array {
    const header = new Array(108).fill(0);
    header.splice(0, 8, ...le32(1), ...le32(108));
    header.splice(40, 4, 0x20, 0x45, 0x4d, 0x46);
    const body = data.length % 4 ? [...data, ...new Array(4 - (data.length % 4)).fill(0)] : data;
    const comment = [...le32(70), ...le32(12 + body.length), ...le32(data.length), ...body];
    return Uint8Array.from([...header, ...comment, ...le32(14), ...le32(20), ...new Array(8).fill(0), ...le32(20)]);
  }
  const opcOf = (emf: Uint8Array): string =>
    `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/media/image1.emf" pkg:contentType="image/x-emf"><pkg:binaryData>${Buffer.from(emf).toString("base64")}</pkg:binaryData></pkg:part></pkg:package>`;
  async function run(selection: string | null) {
    document.body.innerHTML = BUILD;
    opened.length = 0;
    const status: Array<[string, string]> = [];
    initChemdrawOpen({ setStatus: (m, k) => void status.push([m, k ?? ""]), readSelectionOoxml: async () => selection, openPage: (d, name) => (opened.push({ name, html: renderCdx(d)?.svg ?? "" }), true) });
    document.getElementById("chemdraw-from-doc")!.click();
    await new Promise((r) => setTimeout(r, 10));
    return status;
  }
  test("the selected picture opens on the canvas as its drawing", async () => {
    await run(opcOf(emfWith([0x43, 0x44, 0x49, 0x46, 0, ...cdx])));
    expect(opened.map((o) => o.name)).toEqual(["The ChemDraw picture"]);
    expect(opened[0].html).toContain(">Gln</tspan>");
  });
  test("nothing selected, or a picture not from ChemDraw: said by name", async () => {
    expect((await run(null)).pop()).toEqual(["Select a ChemDraw picture in the document first (click it), then Open ChemDraw picture.", "error"]);
    expect((await run(opcOf(emfWith([1, 2, 3])))).pop()).toEqual([
      "The selected picture holds no ChemDraw drawing — it was not pasted from ChemDraw, or it was saved as a plain image.",
      "error",
    ]);
  });
});

describe("one canvas: files and pictures open on the Draw canvas", () => {
  test("a ChemDraw file opens through openPage; a JurisLab structure picture through openIdcode", async () => {
    document.body.innerHTML = BUILD;
    const pages: string[] = [], ids: string[] = [];
    initChemdrawOpen({
      setStatus: () => undefined,
      openPage: (_d, name) => (pages.push(name), true),
      openIdcode: (id) => (ids.push(id), true),
      readSelectionOoxml: async () =>
        `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document><wp:docPr id="1" descr="2D structure (C2H6O) — C2H6O; OCL-ID gC\x60@Dij@@"/></w:document></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png"><pkg:binaryData>iVBORw0KGgo=</pkg:binaryData></pkg:part></pkg:package>`,
    });
    const input = document.getElementById("chemdraw-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([CDXML], "figure.cdxml")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    expect(pages).toEqual(["figure.cdxml"]);
    document.getElementById("chemdraw-from-doc")!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(ids).toEqual(["gC`@Dij@@"]);
  });
});
