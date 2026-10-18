/**
 * Binary ChemDraw files (.cdx) read into the same tree a .cdxml file gives (docs/SCOPE-CHEMDRAW.md,
 * C3) — so drawing, picking, editing and Save as .cdxml work on them unchanged, and a .cdx saves
 * as the .cdxml ChemDraw itself would write for it.
 *
 * The layout (CDX SDK; Revvity's open-source format code, from which cdxTags.ts is generated):
 *   - a 28-byte header "VjCD0100" 04 03 02 01 + 16 zeros; little-endian throughout;
 *   - a tag of 16 bits: bit 15 set = an object (a 32-bit id follows, then its contents, then 00 00);
 *     clear = a property (a 16-bit length follows, 0xFFFF escaping to a 32-bit one, then its data);
 *   - coordinates are 1/65536 point; a point is stored y then x, a rectangle top left bottom right;
 *     CDXML writes points as "x y" in points and boxes as "left top right bottom".
 * Every length is checked against what remains before it is read, the object count and depth are
 * bounded, and the walk is iterative: a damaged file is refused by name, never followed.
 */
import type { XNode } from "./xmlLite";
import { CDX_ENUMS, CDX_FLAG_ENUMS, CDX_OBJECTS, CDX_PROPS, CDX_PROP_ENUM } from "./cdxTags";

export const CDX_LIMITS = { bytes: 40 * 1024 * 1024, objects: 1_000_000, depth: 64 };

const HEADER = "VjCD0100";
const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const coord = (v: number): string => fmt(v / 65536);

/** Windows / Mac code pages a CDX font may name → TextDecoder labels. */
const CODEPAGE: Record<number, string> = {
  1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254",
  1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257", 1258: "windows-1258", 874: "windows-874",
  932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5", 1200: "utf-16le", 1201: "utf-16be", 10000: "macintosh",
  10007: "x-mac-cyrillic", 65001: "utf-8",
};
/** The Symbol font's encoding: its letters are Greek, a few bytes are maths signs (as ChemDraw's text shows them). */
const SYMBOL: Record<number, string> = (() => {
  const t: Record<number, string> = {};
  const up = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ", lo = "αβχδεφγηιϕκλμνοπθρστυϖωξψζ";
  for (let i = 0; i < 26; i++) {
    t[0x41 + i] = up[i];
    t[0x61 + i] = lo[i];
  }
  Object.assign(t, { 0x22: "∀", 0x24: "∃", 0x27: "∋", 0x2d: "−", 0xa2: "′", 0xa3: "≤", 0xa5: "∞", 0xac: "←", 0xad: "↑", 0xae: "→", 0xaf: "↓", 0xb0: "°", 0xb1: "±", 0xb2: "″", 0xb3: "≥", 0xb4: "×", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xba: "≡", 0xbb: "≈", 0xc4: "⊗", 0xc5: "⊕", 0xd6: "√", 0xe5: "∑", 0xf2: "∫" });
  return t;
})();
/** C0 controls other than tab and line breaks cannot be written in XML: they are dropped. */
const clean = (t: string): string => t.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
const decoders = new Map<string, TextDecoder>();
function decode(bytes: Uint8Array, codepage: number, symbolFont = false): string {
  if (symbolFont) return clean([...bytes].map((b) => SYMBOL[b] ?? String.fromCharCode(b)).join(""));
  const label = CODEPAGE[codepage] ?? "windows-1252";
  let d = decoders.get(label);
  if (!d) {
    try {
      d = new TextDecoder(label);
    } catch {
      d = new TextDecoder("windows-1252");
    }
    decoders.set(label, d);
  }
  return clean(d.decode(bytes));
}

/** An enum value as CDXML names it: its name, or the names of its bits for a flag enum, or the number. */
function enumName(e: string, v: number): string {
  const tab = CDX_ENUMS[e];
  if (!tab) return String(v);
  if (Object.prototype.hasOwnProperty.call(tab, v)) return tab[v];
  if (CDX_FLAG_ENUMS.has(e) && v > 0) {
    const parts: string[] = [];
    for (let bit = 1; bit <= v && bit <= 0x8000; bit <<= 1) if (v & bit) {
      if (!Object.prototype.hasOwnProperty.call(tab, bit)) return String(v);
      parts.push(tab[bit]);
    }
    return parts.join(" ");
  }
  return String(v);
}

const el = (name: string, attrs: Record<string, string> = {}): XNode => ({ name, attrs, children: [], text: "", line: 0 });

/**
 * A .cdx file's bytes → the CDXML tree (root <CDXML>), with notes naming what was not read (by
 * property name), or a refusal that says what is wrong with the file.
 */
export function readCdx(bytes: Uint8Array): { ok: true; root: XNode; notes: string[] } | { ok: false; reason: string } {
  if (bytes.length > CDX_LIMITS.bytes) return { ok: false, reason: `the file is larger than ${CDX_LIMITS.bytes / 1048576} MB` };
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 8)) !== HEADER) return { ok: false, reason: "it is not a ChemDraw CDX file (it does not start with VjCD0100)" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let pos = 28;
  const end = bytes.length;
  const notes = new Map<string, number>();
  const note = (k: string): void => void notes.set(k, (notes.get(k) ?? 0) + 1);
  const bad = (why: string): { ok: false; reason: string } => ({ ok: false, reason: `the CDX file is damaged (at byte ${pos}: ${why})` });

  const root = el("CDXML");
  const stack: XNode[] = [root];
  let objects = 0;
  // Fonts by id: their code page decodes text set in them.
  const fontCodepage = new Map<number, number>();
  const symbolFonts = new Set<number>();
  // A Document object may wrap the contents, or (as in some ChemDraw files) be implicit.
  if (end - pos >= 6 && dv.getUint16(pos, true) === 0x8000) pos += 6;

  while (pos < end) {
    if (end - pos < 2) return bad("a tag is cut off");
    const tag = dv.getUint16(pos, true);
    pos += 2;
    if (tag === 0) {
      // End of an object (the last one ends the document).
      if (stack.length === 1) break;
      stack.pop();
      continue;
    }
    if (tag & 0x8000) {
      if (end - pos < 4) return bad("an object's id is cut off");
      const id = dv.getUint32(pos, true);
      pos += 4;
      if (++objects > CDX_LIMITS.objects) return { ok: false, reason: `it has more than ${CDX_LIMITS.objects.toLocaleString("en-US")} objects` };
      if (stack.length > CDX_LIMITS.depth) return { ok: false, reason: `its objects are nested more than ${CDX_LIMITS.depth} deep` };
      const name = CDX_OBJECTS[tag] ?? (tag & 0x4000 ? "userobject" : "unknown");
      if (!CDX_OBJECTS[tag]) note(`objects of a kind this release does not know (tag 0x${tag.toString(16)})`);
      const node = el(name, id ? { id: String(id) } : {});
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    // A property.
    if (end - pos < 2) return bad("a property's length is cut off");
    let len = dv.getUint16(pos, true);
    pos += 2;
    if (len === 0xffff) {
      if (end - pos < 4) return bad("a long property's length is cut off");
      len = dv.getUint32(pos, true);
      pos += 4;
    }
    if (len > end - pos) return bad(`a property says it holds ${len} bytes, but ${end - pos} remain`);
    const data = bytes.subarray(pos, pos + len);
    const at = pos;
    pos += len;
    const owner = stack[stack.length - 1];
    const r = property(tag, data, at, owner);
    if (r) note(r);
  }
  if (stack.length > 1 && pos >= end) note("objects the file did not close (it may be cut short)");
  else if (end - pos > 2 && bytes.subarray(pos).some((b) => b !== 0)) note("more data after the drawing's end (a second drawing?) was not read");

  /** Reads one property onto its object; a returned string names something not read. */
  function property(tag: number, d: Uint8Array, at: number, owner: XNode): string | null {
    const v = new DataView(d.buffer, d.byteOffset, d.length);
    const int = (signed: boolean): number | null => {
      if (d.length === 1) return signed ? v.getInt8(0) : v.getUint8(0);
      if (d.length === 2) return signed ? v.getInt16(0, true) : v.getUint16(0, true);
      if (d.length === 4) return signed ? v.getInt32(0, true) : v.getUint32(0, true);
      return null;
    };
    const ids = (from: number): string => {
      const out: string[] = [];
      for (let k = from; k + 4 <= d.length; k += 4) out.push(String(v.getUint32(k, true)));
      return out.join(" ");
    };
    // Tables and styles that become elements or several attributes.
    if (tag === 0x0100) {
      // Font table: platform, count, then id, charset, name length, name.
      if (d.length < 4) return "a damaged font table";
      const n = v.getUint16(2, true);
      const ft = el("fonttable");
      let k = 4;
      for (let i = 0; i < n; i++) {
        if (k + 6 > d.length) return "a damaged font table";
        const id = v.getUint16(k, true), cs = v.getUint16(k + 2, true), nl = v.getUint16(k + 4, true);
        k += 6;
        if (k + nl > d.length) return "a damaged font table";
        const name = decode(d.subarray(k, k + nl), cs);
        k += nl;
        fontCodepage.set(id, cs);
        if (/^symbol$/i.test(name.trim())) symbolFonts.add(id);
        ft.children.push(el("font", { id: String(id), ...(cs === 1252 ? { charset: "iso-8859-1" } : {}), name }));
      }
      root.children.unshift(ft);
      return null;
    }
    if (tag === 0x0300) {
      if (d.length < 2) return "a damaged colour table";
      const n = v.getUint16(0, true);
      if (2 + n * 6 > d.length) return "a damaged colour table";
      const ct = el("colortable");
      for (let i = 0; i < n; i++) {
        const c = (j: number): string => fmt(v.getUint16(2 + i * 6 + j * 2, true) / 65535);
        ct.children.push(el("color", { r: c(0), g: c(1), b: c(2) }));
      }
      root.children.unshift(ct);
      return null;
    }
    if (tag === 0x080a || tag === 0x080b) {
      // LabelStyle / CaptionStyle: font, face, size (20ths of a point), colour.
      if (d.length < 8) return null;
      const which = tag === 0x080a ? "Label" : "Caption";
      const font = v.getInt16(0, true), face = v.getInt16(2, true), size = v.getInt16(4, true);
      if (font !== -1) owner.attrs[`${which}Font`] = String(font);
      if (face !== -1) owner.attrs[`${which}Face`] = String(face);
      if (size !== -1) owner.attrs[`${which}Size`] = fmt(size / 20);
      return null;
    }
    if (tag === 0x000e) {
      // Represents: an object id and the property it shows.
      if (d.length < 6) return "a damaged represent link";
      const what = CDX_PROPS[v.getUint16(4, true)]?.[0] ?? String(v.getUint16(4, true));
      owner.children.push(el("represent", { attribute: what, object: String(v.getUint32(0, true)) }));
      return null;
    }
    const spec = CDX_PROPS[tag];
    if (!spec) return tag & 0x4000 ? null : `properties of a kind this release does not know (tag 0x${tag.toString(16)})`;
    const [name, type] = spec;
    const set = (val: string): null => {
      owner.attrs[name] = val;
      return null;
    };
    const en = CDX_PROP_ENUM[tag];
    switch (type) {
      case "INT8":
      case "INT16":
      case "INT32":
      case "UINT8":
      case "UINT16":
      case "UINT32": {
        // Flag enums (BondOrder: 0x8000 is "threecenter") are read unsigned.
        const n = int(type.startsWith("INT") && !(en && CDX_FLAG_ENUMS.has(en)));
        if (n === null) return `${name} values of an unexpected size`;
        // Bond order all-ones = "any" (a query bond, CDXBond.cpp).
        if (tag === 0x0600 && ((d.length === 1 && n === 0xff) || (d.length === 2 && n === 0xffff) || (d.length === 4 && n === 0xffffffff))) return set("any");
        // A 4-byte charge is the charge × 2^24 (fractional charges, CDXNode.cpp).
        if (tag === 0x0421 && d.length === 4) return set(fmt(v.getInt32(0, true) / 16777216));
        // Units CDX and CDXML write differently (as Revvity's own writer converts them).
        if (tag === 0x0803) return set(fmt(d.length === 2 ? n / 10 : n / 65536)); // ChainAngle: degrees × 65536 (old files: tenths)
        if (tag === 0x0d07) return set(fmt(n / 65536)); // PositioningAngle in degrees (RotationAngle is written raw, as ChemDraw does)
        if (tag === 0x0804 || tag === 0x0a21) return set(fmt(n / 10)); // BondSpacing (‰ → %), AngularSize (tenths of a degree)
        if (tag === 0x0702 || tag === 0x0706 || tag === 0x0707) return set(n === 0 ? "variable" : n === 1 ? "auto" : d.length === 4 ? coord(n) : fmt(n / 20)); // line heights: 1/20 pt (4-byte: a coordinate)
        return set(en ? enumName(en, n) : String(n));
      }
      case "CDXCoordinate": {
        const n = int(true);
        return n === null ? `${name} values of an unexpected size` : set(coord(n));
      }
      case "CDXPoint2D":
        if (d.length < 8) return `damaged ${name} points`;
        return set(`${coord(v.getInt32(4, true))} ${coord(v.getInt32(0, true))}`);
      case "CDXPoint3D":
        if (d.length < 12) return `damaged ${name} points`;
        // Unlike a 2D point (y then x), a 3D point is stored x, y, z (Revvity's CDXIO.h, CDXArrow.cpp).
        return set(`${coord(v.getInt32(0, true))} ${coord(v.getInt32(4, true))} ${coord(v.getInt32(8, true))}`);
      case "CDXRectangle":
        if (d.length < 16) return `damaged ${name} boxes`;
        return set([4, 0, 12, 8].map((k) => coord(v.getInt32(k, true))).join(" "));
      case "CDXBoolean":
        // Present with no data means true (ChemDraw writes some flags that way).
        return set(!d.length || d[0] ? "yes" : "no");
      case "CDXBooleanImplied":
        return set("yes");
      case "CDXObjectID": {
        const n = int(false);
        return n === null ? `${name} values of an unexpected size` : set(String(n));
      }
      case "CDXObjectIDArray":
        return set(ids(0));
      case "CDXObjectIDArrayWithCounts":
        return set(ids(2));
      case "INT16ListWithCounts": {
        const out: string[] = [];
        for (let k = 2; k + 2 <= d.length; k += 2) out.push(String(v.getInt16(k, true)));
        return set(out.join(" "));
      }
      case "FLOAT64": {
        if (d.length >= 8) return set(String(v.getFloat64(0, true)));
        // A short form (an integer) is read as one, rather than dropped.
        const n = int(true);
        return n === null ? `damaged ${name} numbers` : set(String(n));
      }
      case "CDXElementList":
      case "CDXGenericList": {
        // A count (negative: a NOT list), then atomic numbers.
        if (d.length < 2) return `damaged ${name}`;
        const n = v.getInt16(0, true);
        if (type === "CDXGenericList" || 2 + Math.abs(n) * 2 > d.length) return `${name} values were not read`;
        const els: string[] = [];
        for (let i = 0; i < Math.abs(n); i++) els.push(String(v.getInt16(2 + i * 2, true)));
        return set((n < 0 ? "NOT " : "") + els.join(" "));
      }
      case "CDXCurvePoints":
      case "CDXCurvePoints3D": {
        const per = type === "CDXCurvePoints" ? 8 : 12;
        if (d.length < 2) return `damaged ${name}`;
        const n = v.getUint16(0, true);
        if (2 + n * per !== d.length) return `damaged ${name}`;
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const o = 2 + i * per;
          if (per === 8) out.push(coord(v.getInt32(o + 4, true)), coord(v.getInt32(o, true)));
          else out.push(coord(v.getInt32(o, true)), coord(v.getInt32(o + 4, true)), coord(v.getInt32(o + 8, true)));
        }
        return set(out.join(" "));
      }
      case "CDXString": {
        // Style runs (start, font, face, size in 20ths, colour), then the text.
        let runs: Array<{ start: number; font: number; face: number; size: number; color: number }> = [];
        let textAt = 0;
        if (d.length >= 2) {
          const n = v.getUint16(0, true);
          if (2 + n * 10 <= d.length) {
            for (let i = 0; i < n; i++) {
              const o = 2 + i * 10;
              runs.push({ start: v.getUint16(o, true), font: v.getUint16(o + 2, true), face: v.getUint16(o + 4, true), size: v.getUint16(o + 6, true), color: v.getUint16(o + 8, true) });
            }
            textAt = 2 + n * 10;
          } else runs = [];
        }
        const raw = d.subarray(textAt);
        if (tag === 0x0700 || tag === 0x0709) {
          // A text object's words: one <s> per style run, each decoded in its font's code page — or,
          // for the UTF-8 form ChemDraw also writes (0x0709), as UTF-8, replacing the legacy text.
          const utf8 = tag === 0x0709;
          if (utf8) owner.children = owner.children.filter((c) => c.name !== "s");
          else if (owner.children.some((c) => c.name === "s" && c.attrs["data-utf8"] !== undefined)) return null; // the UTF-8 text came first: it stands
          const dec = (b: Uint8Array, font: number): string => (utf8 ? decode(b, 65001) : decode(b, fontCodepage.get(font) ?? 1252, symbolFonts.has(font)));
          const push = (s: XNode): void => {
            if (utf8) s.attrs["data-utf8"] = "";
            owner.children.push(s);
          };
          if (!runs.length) {
            push({ ...el("s"), text: dec(raw, -1) });
            return null;
          }
          // Text before the first run is kept, unstyled (as Revvity's writer does).
          if (runs[0].start > 0) push({ ...el("s"), text: dec(raw.subarray(0, Math.min(runs[0].start, raw.length)), -1) });
          runs.forEach((run, i) => {
            const stop = i + 1 < runs.length ? runs[i + 1].start : raw.length;
            const part = raw.subarray(Math.min(run.start, raw.length), Math.min(Math.max(stop, run.start), raw.length));
            const s = el("s", { font: String(run.font), size: fmt(run.size / 20), ...(run.face ? { face: String(run.face) } : {}), ...(run.color !== 3 ? { color: String(run.color) } : {}) });
            s.text = dec(part, run.font);
            push(s);
          });
          return null;
        }
        return set(decode(raw, runs.length ? (fontCodepage.get(runs[0].font) ?? 1252) : 1252, runs.length > 0 && symbolFonts.has(runs[0].font)).replace(/\n/g, " "));
      }
      case "Unformatted":
        // Print settings and embedded pictures (PNG/EMF/OLE…): not drawn here.
        return /PrintInfo/.test(name) ? null : `${name} data (embedded pictures and the like) was not read`;
      default:
        return `${name} values (${type || "of a kind this release does not read"}) were not read`;
    }
  }
  const unmark = (n: XNode): void => {
    if (n.name === "s") delete n.attrs["data-utf8"];
    n.children.forEach(unmark);
  };
  unmark(root);
  return { ok: true, root, notes: [...notes].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)) };
}
