// The ChemDraw drawing inside a picture pasted from ChemDraw. The pictures are built here the way
// ChemDraw lays them out (chunks starting "CDIF\0" in EMF+ comments, GDI comments, a metafile inside an
// EMF+ image object, a WMF), around a published USPTO drawing (fixtures/).
import * as fs from "fs";
import * as path from "path";
import { cdxFromMetafile, cdxFromFlatOpc, fromBase64 } from "../emfCdx";
import { readCdx } from "../cdx";

const CDX = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "US12128110-C00013.cdx")));
const le32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const le16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const pad4 = (a: number[]): number[] => (a.length % 4 ? [...a, ...new Array(4 - (a.length % 4)).fill(0)] : a);
const CDIF = [0x43, 0x44, 0x49, 0x46, 0];

/** An EMF: a header record, then the given records, then EOF. */
function emf(records: number[][]): Uint8Array {
  const header = new Array(108).fill(0);
  header.splice(0, 8, ...le32(1), ...le32(108));
  header.splice(40, 4, 0x20, 0x45, 0x4d, 0x46); // " EMF"
  const eof = [...le32(14), ...le32(20), 0, 0, 0, 0, 0, 0, 0, 0, ...le32(20)];
  return Uint8Array.from([...header, ...records.flat(), ...eof]);
}
/** EMR_GDICOMMENT around bytes. */
const gdiComment = (data: number[]): number[] => {
  const body = pad4(data);
  return [...le32(70), ...le32(12 + body.length), ...le32(data.length), ...body];
};
/** An EMF+ record. */
const plusRecord = (type: number, flags: number, data: number[]): number[] => {
  const body = pad4(data);
  return [...le16(type), ...le16(flags), ...le32(12 + body.length), ...le32(data.length), ...body];
};
const chunksOf = (b: Uint8Array, n: number): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < b.length; i += n) out.push([...b.subarray(i, i + n)]);
  return out;
};
const same = (a: Uint8Array | null): boolean => !!a && a.length >= CDX.length && CDX.every((v, i) => a[i] === v);

describe("the drawing inside a ChemDraw picture", () => {
  test("EMF+ comments in 4 KB chunks, each starting CDIF\\0, joined in order", () => {
    const plus = chunksOf(CDX, 1000).map((c) => plusRecord(0x4003, 0, [...CDIF, ...c]));
    const pic = emf([gdiComment([0x45, 0x4d, 0x46, 0x2b, ...plus.flat()])]);
    const got = cdxFromMetafile(pic);
    expect(same(got)).toBe(true);
    expect(readCdx(got!).ok).toBe(true);
  });
  test("plain GDI comments", () => {
    const pic = emf(chunksOf(CDX, 700).map((c) => gdiComment([...CDIF, ...c])));
    expect(same(cdxFromMetafile(pic))).toBe(true);
  });
  test("an EMF+ image object that is itself a metafile holding the chunks", () => {
    const inner = emf([gdiComment([...CDIF, ...CDX])]);
    // EmfPlusObject, type 5 (image), id 1: version, image type 2 (metafile), metafile type, size, bytes.
    const obj = plusRecord(0x4008, 0x0501, [...le32(0xdbc01002), ...le32(2), ...le32(3), ...le32(inner.length), ...inner]);
    const pic = emf([gdiComment([0x45, 0x4d, 0x46, 0x2b, ...obj])]);
    expect(same(cdxFromMetafile(pic))).toBe(true);
  });
  test("a WMF with MFCOMMENT escapes", () => {
    const header = [...le16(1), ...le16(9), ...le16(0x300), ...le32(0), ...le16(0), ...le32(0), ...le16(0)];
    const escapes = chunksOf(CDX, 800).flatMap((c) => {
      const data = pad4([...CDIF, ...c]).slice(0, (CDIF.length + c.length + 1) & ~1);
      const words = 5 + data.length / 2;
      return [...le32(words), ...le16(0x0626), ...le16(15), ...le16(CDIF.length + c.length), ...data];
    });
    const pic = Uint8Array.from([...header, ...escapes, ...le32(3), ...le16(0)]);
    expect(same(cdxFromMetafile(pic))).toBe(true);
  });
  test("a picture that is not from ChemDraw holds no drawing; a damaged record stops the walk", () => {
    expect(cdxFromMetafile(emf([gdiComment([1, 2, 3, 4])]))).toBeNull();
    const broken = emf([[...le32(70), ...le32(9999999)]]);
    expect(cdxFromMetafile(broken)).toBeNull();
  });
});

describe("from Word's selection (Flat OPC)", () => {
  const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64").replace(/(.{76})/g, "$1\n");
  const opc = (parts: string): string => `<?xml version="1.0" standalone="yes"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">${parts}</pkg:package>`;
  test("the selected EMF's drawing is found", () => {
    const pic = emf([gdiComment([...CDIF, ...CDX])]);
    const r = cdxFromFlatOpc(opc(`<pkg:part pkg:name="/word/media/image1.emf" pkg:contentType="image/x-emf"><pkg:binaryData>${b64(pic)}</pkg:binaryData></pkg:part>`));
    expect(r.ok && same(r.cdx)).toBe(true);
  });
  test("no picture, or a picture with no ChemDraw drawing: each refused by name", () => {
    expect(cdxFromFlatOpc(opc(`<pkg:part pkg:name="/word/document.xml"><pkg:xmlData/></pkg:part>`))).toEqual({ ok: false, reason: "select a ChemDraw picture in the document first (click it)" });
    expect(cdxFromFlatOpc(opc(`<pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png"><pkg:binaryData>iVBORw0KGgo=</pkg:binaryData></pkg:part>`))).toEqual({
      ok: false,
      reason: "the selected picture holds no ChemDraw drawing — it was not pasted from ChemDraw, or it was saved as a plain image",
    });
  });
  test("base64 decoding ignores line breaks and refuses what is not base64", () => {
    expect([...fromBase64("AQID\nBA==")!]).toEqual([1, 2, 3, 4]);
    expect(fromBase64("not base64!")).toBeNull();
  });
});
