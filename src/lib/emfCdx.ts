/**
 * The ChemDraw drawing inside a picture pasted from ChemDraw (docs/SCOPE-CHEMDRAW.md, C4). ChemDraw's
 * clipboard picture is an EMF (sometimes a WMF) that carries the whole drawing as CDX, in comment
 * records each starting "CDIF\0" — in EMF+ comment records (chunks of up to 4 KB, in order), in GDI
 * comments, or inside an EMF+ image object that is itself a metafile. Joined, the chunks are a .cdx
 * file (cdx.ts reads it). Every record size is checked against what remains; nesting is bounded.
 *
 * Word keeps the picture as pasted, so a ChemDraw picture in a document opens as the drawing it was
 * made from — no separate file needed. Office.js hands the selection over as Flat OPC (getOoxml),
 * the picture as base64 inside it (cdxFromFlatOpc).
 */
import { parseXml, XNode } from "./xmlLite";

const MAX_DEPTH = 4;
const CDIF = [0x43, 0x44, 0x49, 0x46, 0x00]; // "CDIF\0"

const startsWith = (b: Uint8Array, s: number[], at = 0): boolean => b.length >= at + s.length && s.every((v, i) => b[at + i] === v);
const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const EMF_PLUS = [0x45, 0x4d, 0x46, 0x2b]; // "EMF+"

/** Comment payloads in drawing order (EMF: GDI comments, EMF+ comments, and metafiles inside EMF+ images). */
function emfChunks(b: Uint8Array, depth: number, out: Uint8Array[]): void {
  let pos = 0;
  while (pos + 8 <= b.length) {
    const type = u32(b, pos), size = u32(b, pos + 4);
    if (size < 8 || pos + size > b.length) return;
    if (type === 70 && size >= 12) {
      // EMR_GDICOMMENT: a data size, then the data.
      const ds = Math.min(u32(b, pos + 8), size - 12);
      const data = b.subarray(pos + 12, pos + 12 + ds);
      if (startsWith(data, EMF_PLUS)) plusChunks(data.subarray(4), depth, out);
      else out.push(data);
    }
    if (type === 14) return; // EMR_EOF
    pos += size;
  }
}

function plusChunks(d: Uint8Array, depth: number, out: Uint8Array[]): void {
  let p = 0;
  const pending = new Map<number, { total: number; parts: Uint8Array[]; have: number }>();
  while (p + 12 <= d.length) {
    const rt = u16(d, p), fl = u16(d, p + 2), rs = u32(d, p + 4), ds = u32(d, p + 8);
    if (rs < 12 || p + rs > d.length) return;
    let data = d.subarray(p + 12, p + 12 + Math.min(ds, rs - 12));
    if (rt === 0x4003) out.push(data); // EmfPlusComment
    else if (rt === 0x4008 && depth < MAX_DEPTH) {
      // EmfPlusObject; a large one comes in continued records (flag 0x8000, total size first).
      const type = (fl >> 8) & 0x7f, id = fl & 0xff;
      let whole: Uint8Array | null = data;
      if (fl & 0x8000) {
        whole = null;
        const total = u32(data, 0);
        const cur = pending.get(id) ?? { total, parts: [], have: 0 };
        cur.parts.push(data.subarray(4));
        cur.have += data.length - 4;
        if (cur.have >= cur.total || cur.have > 64 * 1024 * 1024) {
          pending.delete(id);
          const buf = new Uint8Array(cur.have);
          let k = 0;
          for (const part of cur.parts) {
            buf.set(part, k);
            k += part.length;
          }
          whole = buf;
        } else pending.set(id, cur);
      }
      // An image object (type 5) holding a metafile (image type 2): its EMF or WMF.
      if (whole && type === 5 && whole.length >= 16 && u32(whole, 4) === 2) {
        data = whole;
        const msize = Math.min(u32(data, 12), data.length - 16);
        const meta = data.subarray(16, 16 + msize);
        if (u32(meta, 0) === 1 && meta[40] === 0x20 && meta[41] === 0x45 && meta[42] === 0x4d && meta[43] === 0x46) emfChunks(meta, depth + 1, out);
        else wmfChunks(meta, out);
      }
    }
    p += rs;
  }
}

/** WMF comments: META_ESCAPE (0x0626) with MFCOMMENT (15). */
function wmfChunks(b: Uint8Array, out: Uint8Array[]): void {
  let pos = u32(b, 0) === 0x9ac6cdd7 ? 22 : 0; // a placeable header first
  if (pos + 18 > b.length) return;
  pos += u16(b, pos + 2) * 2;
  while (pos + 6 <= b.length) {
    const size = u32(b, pos) * 2, fn = u16(b, pos + 4);
    if (size < 6 || pos + size > b.length) return;
    if (fn === 0x0626 && size >= 10 && u16(b, pos + 6) === 15) {
      const cnt = Math.min(u16(b, pos + 8), size - 10);
      out.push(b.subarray(pos + 10, pos + 10 + cnt));
    }
    if (fn === 0) return;
    pos += size;
  }
}

/** The .cdx bytes inside a ChemDraw picture (EMF or WMF), or null when it holds none. */
export function cdxFromMetafile(b: Uint8Array): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  if (u32(b, 0) === 1 && b.length > 44 && b[40] === 0x20 && b[41] === 0x45) emfChunks(b, 0, chunks);
  else wmfChunks(b, chunks);
  const parts = chunks.filter((c) => startsWith(c, CDIF)).map((c) => c.subarray(5));
  if (!parts.length) return null;
  const total = parts.reduce((a, c) => a + c.length, 0);
  const buf = new Uint8Array(total);
  let k = 0;
  for (const c of parts) {
    buf.set(c, k);
    k += c.length;
  }
  // The joined data starts at the CDX header.
  for (let i = 0; i + 8 <= buf.length && i < 64; i++) if (buf[i] === 0x56 && buf[i + 1] === 0x6a && buf[i + 2] === 0x43 && buf[i + 3] === 0x44) return buf.subarray(i);
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();
/** Base64 (whitespace ignored) to bytes; null when it is not base64. */
export function fromBase64(s: string): Uint8Array | null {
  const clean = s.replace(/[\s]/g, "").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(clean)) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, bits = 0, k = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64_INDEX[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[k++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, k);
}

/**
 * The ChemDraw drawing in a selection given as Flat OPC (Office.js getOoxml): the first picture
 * part that carries one. A refusal says whether there was no picture at all, or pictures without
 * a ChemDraw drawing in them.
 */
export function cdxFromFlatOpc(flatOpc: string): { ok: true; cdx: Uint8Array } | { ok: false; reason: string } {
  const x = parseXml(flatOpc);
  if (!x.ok) return { ok: false, reason: "Word gave the selection in a form this cannot read" };
  let pictures = 0;
  let found: Uint8Array | null = null;
  const walk = (n: XNode): void => {
    if (found) return;
    if (n.name === "pkg:part") {
      const name = (n.attrs["pkg:name"] ?? "").toLowerCase();
      const type = (n.attrs["pkg:contentType"] ?? "").toLowerCase();
      if (/\.(emf|wmf)$/.test(name) || /x-emf|x-wmf/.test(type)) {
        pictures++;
        const bin = n.children.find((c) => c.name === "pkg:binaryData");
        const bytes = bin ? fromBase64(bin.text) : null;
        if (bytes) found = cdxFromMetafile(bytes);
      } else if (/\.(png|jpe?g|gif|bmp|tiff?)$/.test(name)) pictures++;
      return;
    }
    n.children.forEach(walk);
  };
  walk(x.root);
  if (found) return { ok: true, cdx: found };
  if (!pictures) return { ok: false, reason: "select a ChemDraw picture in the document first (click it)" };
  return { ok: false, reason: "the selected picture holds no ChemDraw drawing — it was not pasted from ChemDraw, or it was saved as a plain image" };
}
