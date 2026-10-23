// Reading ONE worksheet of an Excel workbook (.xlsx, and .xlsm read as data only) into the grid a pane data field
// takes, so "Open CSV…" also opens a spreadsheet. The grid is text: dataBlock.readDataBlock stays the one number
// reader, so a number here is written as text exactly enough to read back to the stored double.
//
// LOADED LAZILY. This module and jszip are pulled in by a dynamic import (webpackChunkName "xlsx") on the first
// spreadsheet opened; nobody who never opens one downloads them. The chunk is an ordinary .js file, so the service
// worker precaches it with every other chunk (scripts/sw-manifest.js) and it works offline.
//
// What is refused, by name (a wrong number is worse than a refusal):
//   - legacy .xls (an OLE2/CFB container), and a password-protected workbook (the same container holding an
//     EncryptionInfo/EncryptedPackage stream); .ods; .numbers; .xlsb; a zip that is not a workbook; a corrupt zip;
//   - a cell holding an error value (#DIV/0!, #N/A …), a formula with no saved value, a date or time (a date-format
//     style, a t="d" cell): a date is not a measurement, and its serial number would read as one;
//   - an empty sheet.
// Zip-bomb caps, checked on the DECLARED sizes in the central directory before anything is inflated, and on the
// REAL inflated size while reading (a lying header is caught as it inflates): ≤ 2 000 entries, ≤ 20 MB in all;
// then ≤ 200 000 cells and ≤ 1 MB of resulting text. Every loop is bounded by those caps.
//
// The XML is read with bounded regular expressions, not a DOM parser: the parts are machine-written by Excel (and
// the other writers of the format), the reader must run in the pane and under jest's node environment alike, and
// only five element kinds are needed. Element names may carry a namespace prefix (x:c), which some writers use.

import JSZip from "jszip";

export const XLSX_MAX_ENTRIES = 2000;
export const XLSX_MAX_BYTES = 20 * 1024 * 1024;
export const XLSX_MAX_CELLS = 200_000;
export const XLSX_MAX_TEXT = 1024 * 1024;

export interface XlsxSheet {
  ok: true;
  /** The sheet as rows of cell text, trailing empty cells and rows trimmed, leading empty rows/columns dropped. */
  rows: string[][];
  /** The same grid as tab-separated text, one row per line. */
  text: string;
  /** The sheet read. */
  sheet: string;
  /** The other sheets in the file, in workbook order. */
  otherSheets: string[];
  /** One line for the status bar: "sheet 'Run 1'; also in the file: 'Run 2', 'Blank'". */
  note: string;
  /** The range read, A1 style ("B3:D20"). */
  range: string;
}
export interface XlsxRefusal {
  ok: false;
  error: string;
}

/** Column letters → 1-based index ("A" 1, "AA" 27); 0 when malformed or past XFD (16 384). */
export function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length && i < 4; i++) {
    const c = letters.charCodeAt(i) - 64;
    if (c < 1 || c > 26) return 0;
    n = n * 26 + c;
  }
  return letters.length <= 3 && n <= 16384 ? n : 0;
}
/** 1-based column index → letters. */
export function colLetters(n: number): string {
  let s = "";
  for (let k = n; k > 0 && s.length < 4; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
const REF = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
function parseRef(ref: string): { row: number; col: number } | null {
  const m = REF.exec(ref.replace(/\$/g, "").toUpperCase());
  if (!m) return null;
  const col = colIndex(m[1]);
  const row = Number(m[2]);
  return col && row <= 1048576 ? { row, col } : null;
}

/**
 * A stored double as plain decimal text that reads back to the same double: the shortest round-trip digits
 * (String's), with any exponent written out ("1e-7" → "0.0000001"). Past 32 characters the e-form is kept, which
 * dataBlock reads ("1e-300"). −0 is "0".
 */
export function numberText(v: number): string {
  if (Object.is(v, -0) || v === 0) return "0";
  const s = String(v);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2] + (m[3] ?? "");
  const e = Number(m[4]);
  const plain = e < 0 ? `${m[1]}0.${"0".repeat(-e - 1)}${digits}` : `${m[1]}${digits}${"0".repeat(Math.max(0, e - (m[3]?.length ?? 0)))}`;
  return plain.length <= 32 ? plain : s;
}

/** XML entities and OOXML's _xHHHH_ escapes decoded; tabs and line breaks inside a cell become spaces. */
function xmlText(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_m, e: string) => {
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "amp") return "&";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[\t\r\n\v\f]+/g, " ");
}
const ATTR_RE = new Map<string, RegExp>();
const attr = (attrs: string, name: string): string | null => {
  let re = ATTR_RE.get(name);
  if (!re) ATTR_RE.set(name, (re = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`)));
  const m = re.exec(attrs);
  return m ? (m[2] ?? m[3] ?? "") : null;
};
/** Thrown by the scanner on XML it cannot read safely (an element never closed, a tag never ended). */
export class MalformedXml extends Error {}

const isNameEnd = (ch: string | undefined): boolean => ch === undefined || ch === ">" || ch === "/" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
const isWordCh = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/**
 * Every element <name ...> or <name .../> or <name ...>body</name> (optional namespace prefix), bounded by `cap`.
 *
 * ONE FORWARD PASS. The earlier regex form ([\s\S]*?</c> per candidate) rescanned to the end of the text for every
 * opening tag whose close was missing: 40 000 unclosed cells in a 4 KB file took 9.5 s and froze Word. Here every
 * search (next "<", next close tag, the end of a tag) only moves forward, and an element whose close is missing, or
 * that is followed by another opening tag of its own name before its close, throws MalformedXml, so a corrupt part
 * is refused by name instead of being read slowly or wrongly. None of the elements read here nest in themselves.
 */
function* elements(xml: string, name: string, cap: number): Generator<{ attrs: string; body: string | null; start: number; end: number }> {
  /** If an opening tag of `name` starts at xml[i] === "<", the index just past the name; else −1. */
  const openAt = (i: number): number => {
    let j = i + 1;
    if (xml[j] === "/" || xml[j] === "?" || xml[j] === "!") return -1;
    if (xml.startsWith(name, j) && isNameEnd(xml[j + name.length])) return j + name.length;
    let k = j;
    while (k < j + 32 && isWordCh(xml[k])) k++;
    j = k + 1;
    return xml[k] === ":" && k > i + 1 && xml.startsWith(name, j) && isNameEnd(xml[j + name.length]) ? j + name.length : -1;
  };
  /** If a closing tag of `name` starts at xml[i] === "<", the index just past its ">"; else −1. */
  const closeAt = (i: number): number => {
    if (xml[i + 1] !== "/") return -1;
    let j = i + 2;
    if (!xml.startsWith(name, j) || !isNameEnd(xml[j + name.length])) {
      let k = j;
      while (k < j + 32 && isWordCh(xml[k])) k++;
      if (xml[k] !== ":" || k === j) return -1;
      j = k + 1;
      if (!xml.startsWith(name, j) || !isNameEnd(xml[j + name.length])) return -1;
    }
    let e = j + name.length;
    while (xml[e] === " " || xml[e] === "\t" || xml[e] === "\n" || xml[e] === "\r") e++;
    return xml[e] === ">" ? e + 1 : -1;
  };
  // Cached forward searches: each is asked only for positions at or after its last answer's start.
  let openCache: { from: number; at: number; nameEnd: number } | null = null;
  const findOpen = (from: number): { at: number; nameEnd: number } | null => {
    if (openCache && from >= openCache.from && (openCache.at < 0 || from <= openCache.at)) return openCache.at < 0 ? null : openCache;
    let i = xml.indexOf("<", from);
    while (i >= 0) {
      const e = openAt(i);
      if (e >= 0) {
        openCache = { from, at: i, nameEnd: e };
        return openCache;
      }
      i = xml.indexOf("<", i + 1);
    }
    openCache = { from, at: -1, nameEnd: -1 };
    return null;
  };
  let closeCache: { from: number; at: number; end: number } | null = null;
  const findClose = (from: number): { at: number; end: number } | null => {
    if (closeCache && from >= closeCache.from && (closeCache.at < 0 || from <= closeCache.at)) return closeCache.at < 0 ? null : closeCache;
    let i = xml.indexOf("</", from);
    while (i >= 0) {
      const e = closeAt(i);
      if (e >= 0) {
        closeCache = { from, at: i, end: e };
        return closeCache;
      }
      i = xml.indexOf("</", i + 2);
    }
    closeCache = { from, at: -1, end: -1 };
    return null;
  };
  let pos = 0;
  let n = 0;
  while (n++ < cap) {
    const o = findOpen(pos);
    if (!o) return;
    // The end of the tag: the first ">" outside a quoted attribute value.
    let g = o.nameEnd;
    let quote = "";
    for (; g < xml.length; g++) {
      const ch = xml[g];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    if (g >= xml.length) throw new MalformedXml(`a <${name}> tag is never ended`);
    const raw = xml.slice(o.nameEnd, g);
    if (raw.endsWith("/")) {
      yield { attrs: raw.slice(0, -1), body: null, start: o.at, end: g + 1 };
      pos = g + 1;
      continue;
    }
    const bodyStart = g + 1;
    const c = findClose(bodyStart);
    if (!c) throw new MalformedXml(`a <${name}> element is never closed`);
    const next = findOpen(bodyStart);
    if (next && next.at < c.at) throw new MalformedXml(`a <${name}> element is not closed before the next one opens`);
    yield { attrs: raw, body: xml.slice(bodyStart, c.at), start: o.at, end: c.end };
    pos = c.end;
  }
}
/** The first element of `name`, or null. */
function firstElement(xml: string, name: string): { attrs: string; body: string | null } | null {
  for (const e of elements(xml, name, 1)) return e;
  return null;
}
/** The text of all <t> elements in a string item, phonetic runs (<rPh>) left out. */
function itemText(body: string): string {
  let clean = "";
  let from = 0;
  for (const r of elements(body, "rPh", 100000)) {
    clean += body.slice(from, r.start);
    from = r.end;
  }
  clean += body.slice(from);
  let out = "";
  for (const t of elements(clean, "t", 100000)) out += t.body ?? "";
  return xmlText(out);
}

// ------------------------------------------------------------------ the container

const startsWith = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v);
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const utf16 = (s: string): number[] => [...s].flatMap((c) => [c.charCodeAt(0), 0]);
function contains(b: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The zip's central directory, read and capped BEFORE anything is inflated. */
function centralDirectory(b: Uint8Array): { names: Map<string, number> } | string {
  const u16 = (o: number): number => b[o] | (b[o + 1] << 8);
  const u32 = (o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  if (eocd < 0) return "the file is not a complete zip archive (it may be truncated or corrupt)";
  const count = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOff = u32(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) return "the workbook uses the ZIP64 format, which this reader does not open (a workbook under 8 MB never needs it; re-save it in Excel)";
  if (count > XLSX_MAX_ENTRIES) return `the zip holds ${count} entries, more than the ${XLSX_MAX_ENTRIES} a workbook this size could need, so it was not opened`;
  if (cdOff + cdSize > b.length) return "the zip's directory points past the end of the file (corrupt or truncated)";
  const names = new Map<string, number>();
  let total = 0;
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || u32(p) !== 0x02014b50) return "the zip's directory is damaged (corrupt file)";
    const usize = u32(p + 24);
    const nlen = u16(p + 28);
    const elen = u16(p + 30);
    const clen = u16(p + 32);
    if (p + 46 + nlen > b.length) return "the zip's directory is damaged (corrupt file)";
    let name = "";
    for (let i = 0; i < nlen; i++) name += String.fromCharCode(b[p + 46 + i]);
    total += usize;
    if (usize === 0xffffffff || total > XLSX_MAX_BYTES)
      return `the zip would inflate to more than ${XLSX_MAX_BYTES / 1024 / 1024} MB, far more than its data could need, so it was not opened`;
    names.set(name, usize);
    p += 46 + nlen + elen + clen;
  }
  return { names };
}

/** Reads one part, counting the REAL inflated bytes against its declared size and the running total. */
async function readPart(zip: JSZip, name: string, declared: Map<string, number>, budget: { used: number }): Promise<string | { error: string }> {
  const f = zip.file(name);
  if (!f) return { error: `the workbook part ${name} is missing` };
  const limit = Math.min(declared.get(name) ?? 0, XLSX_MAX_BYTES - budget.used);
  const chunks: Uint8Array[] = [];
  let got = 0;
  type Helper = { on(ev: string, fn: (d: Uint8Array) => void): Helper; resume(): Helper; pause(): Helper };
  const helper = (f as unknown as { internalStream(t: string): Helper }).internalStream("uint8array");
  try {
    await new Promise<void>((resolve, reject) => {
      helper
        .on("data", (d: Uint8Array) => {
          got += d.length;
          if (got > limit) {
            helper.pause();
            reject(new Error("bomb"));
            return;
          }
          chunks.push(d);
        })
        .on("error", (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))))
        .on("end", () => resolve())
        .resume();
    });
  } catch (e) {
    if (e instanceof Error && e.message === "bomb")
      return { error: `the workbook part ${name} inflates to more than its declared size or the ${XLSX_MAX_BYTES / 1024 / 1024} MB cap, so reading stopped` };
    return { error: `the zip could not be inflated (${e instanceof Error ? e.message : "corrupt data"})` };
  }
  budget.used += got;
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder("utf-8").decode(all);
}

/**
 * Built-in number formats that are dates or times when the file defines no <numFmt> for the id: 14–22 and 45–47
 * (ECMA-376 §18.8.30), and the locale built-ins a Japanese, Chinese or Korean Excel writes (27–36, 50–58) and a Thai
 * Excel writes (71–81), all date/time formats in those locales (the SheetJS SSF table lists them the same way).
 */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81]);
/** Built-in percent formats (0%, 0.00%). */
const BUILTIN_PERCENT = new Set([9, 10]);
/** What a format does to the DISPLAYED value that the stored number does not show: percent (×100) or scaling (÷1000 per trailing comma). */
export function displayScaling(code: string): "percent" | "scaled" | null {
  const first = code.split(";")[0].replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\[[^\]]*\]/g, "");
  if (first.includes("%")) return "percent";
  if (/[0#?](,+)(?![0#?,])/.test(first)) return "scaled";
  return null;
}
/**
 * True when a custom number format shows a date or time: d, m, y, h or s outside quoted text, escaped
 * characters (\x, _x, *x) and bracketed modifiers ([Red], [$-409], [>=100]); the elapsed-time brackets [h], [mm],
 * [ss] ARE times. "General" has none of those letters.
 */
export function isDateFormat(code: string): boolean {
  if (/\[(h+|m+|s+)\]/i.test(code)) return true;
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(stripped);
}

/** Opens a workbook's bytes and reads its first worksheet. `fileName` names the file in messages. */
async function readXlsxInner(bytes: Uint8Array, fileName: string): Promise<XlsxSheet | XlsxRefusal> {
  const refuse = (why: string): XlsxRefusal => ({ ok: false, error: `${fileName}: ${why}.` });
  const lower = fileName.toLowerCase();
  if (bytes.length < 8) return refuse("this is not an Excel workbook (the file is empty or too short)");
  if (startsWith(bytes, CFB)) {
    if (contains(bytes, utf16("EncryptedPackage")) || contains(bytes, utf16("EncryptionInfo")))
      return refuse("the workbook is password-protected (encrypted); open it in Excel, remove the password (File ▸ Info ▸ Protect Workbook), save, and load it again");
    return refuse("this is a legacy Excel 97–2003 workbook (.xls), which this reader does not open; open it in Excel and save it as .xlsx, or save the sheet as CSV");
  }
  if (lower.endsWith(".numbers")) return refuse("Apple Numbers files are not read; in Numbers use File ▸ Export To ▸ Excel (.xlsx) or CSV");
  if (lower.endsWith(".ods")) return refuse("OpenDocument spreadsheets (.ods) are not read; save the sheet as .xlsx or CSV");
  if (lower.endsWith(".xlsb")) return refuse("binary Excel workbooks (.xlsb) are not read; save it as .xlsx or CSV");
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return refuse("this is not an Excel workbook (.xlsx): it is not a zip archive");
  const cd = centralDirectory(bytes);
  if (typeof cd === "string") return refuse(cd);
  const declared = cd.names;
  if (declared.has("mimetype") && !declared.has("[Content_Types].xml")) return refuse("this looks like an OpenDocument file (.ods), which is not read; save the sheet as .xlsx or CSV");
  if ([...declared.keys()].some((n) => n.startsWith("Index/") && n.endsWith(".iwa"))) return refuse("Apple Numbers files are not read; in Numbers use File ▸ Export To ▸ Excel (.xlsx) or CSV");
  if (declared.has("xl/workbook.bin")) return refuse("binary Excel workbooks (.xlsb) are not read; save it as .xlsx or CSV");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    return refuse(`the zip archive is corrupt (${e instanceof Error ? e.message : "unreadable"})`);
  }
  const budget = { used: 0 };
  const read = async (name: string): Promise<string | XlsxRefusal> => {
    const r = await readPart(zip, name, declared, budget);
    return typeof r === "string" ? r : refuse(r.error);
  };

  // The workbook part, from the package relationships (xl/workbook.xml in practice).
  let wbPath = "xl/workbook.xml";
  if (declared.has("_rels/.rels")) {
    const rels = await read("_rels/.rels");
    if (typeof rels !== "string") return rels;
    for (const r of elements(rels, "Relationship", 200)) {
      const type = attr(r.attrs, "Type") ?? "";
      const target = attr(r.attrs, "Target") ?? "";
      if (/\/officeDocument$/.test(type) && target) wbPath = target.replace(/^\//, "");
    }
  }
  if (!declared.has(wbPath)) return refuse("this zip is not an Excel workbook (it has no workbook part)");
  const wb = await read(wbPath);
  if (typeof wb !== "string") return wb;
  const base = wbPath.includes("/") ? wbPath.slice(0, wbPath.lastIndexOf("/") + 1) : "";
  const relsPath = `${base}_rels/${wbPath.slice(base.length)}.rels`;
  const targets = new Map<string, { target: string; type: string }>();
  let sharedPath: string | null = null;
  let stylesPath: string | null = null;
  const resolve = (t: string): string => {
    if (t.startsWith("/")) return t.slice(1);
    const parts = (base + t).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p !== ".") out.push(p);
    }
    return out.join("/");
  };
  if (declared.has(relsPath)) {
    const rels = await read(relsPath);
    if (typeof rels !== "string") return rels;
    for (const r of elements(rels, "Relationship", 5000)) {
      const id = attr(r.attrs, "Id") ?? "";
      const type = attr(r.attrs, "Type") ?? "";
      const target = resolve(attr(r.attrs, "Target") ?? "");
      targets.set(id, { target, type });
      if (/\/sharedStrings$/.test(type)) sharedPath = target;
      if (/\/styles$/.test(type)) stylesPath = target;
    }
  }
  sharedPath ??= declared.has(`${base}sharedStrings.xml`) ? `${base}sharedStrings.xml` : null;
  stylesPath ??= declared.has(`${base}styles.xml`) ? `${base}styles.xml` : null;

  // Sheets in workbook order; the first WORKSHEET (a chart sheet has no cells) that is not hidden.
  const sheets: Array<{ name: string; path: string | null; hidden: boolean }> = [];
  for (const s of elements(wb, "sheet", 5000)) {
    const name = xmlText(attr(s.attrs, "name") ?? "");
    const rid = attr(s.attrs, "id") ?? "";
    const t = targets.get(rid);
    const isWorksheet = t ? /\/worksheet$/.test(t.type) || /worksheets\//.test(t.target) : false;
    const state = attr(s.attrs, "state") ?? "visible";
    sheets.push({ name, path: isWorksheet && t ? t.target : null, hidden: state !== "visible" });
  }
  const pick = sheets.find((s) => s.path && !s.hidden) ?? sheets.find((s) => s.path);
  if (!pick || !pick.path) return refuse("the workbook has no worksheet to read");
  if (!declared.has(pick.path)) return refuse(`the sheet '${pick.name}' is listed but its part is missing (corrupt file)`);
  const others = sheets.filter((s) => s !== pick).map((s) => s.name);
  // The note marks what the first visible worksheet passed over: a hidden sheet, or a chart sheet (no cells).
  const othersShown = sheets.filter((s) => s !== pick).map((s) => `'${s.name}'${s.hidden ? " (hidden)" : !s.path ? " (chart)" : ""}`);

  // Shared strings.
  const shared: string[] = [];
  if (sharedPath && declared.has(sharedPath)) {
    const ss = await read(sharedPath);
    if (typeof ss !== "string") return ss;
    for (const si of elements(ss, "si", XLSX_MAX_CELLS)) shared.push(itemText(si.body ?? ""));
  }
  // Styles: which cell style indices show a date or time.
  const dateStyle: boolean[] = [];
  const shownAs: Array<"percent" | "scaled" | null> = [];
  if (stylesPath && declared.has(stylesPath)) {
    const st = await read(stylesPath);
    if (typeof st !== "string") return st;
    const custom = new Map<number, string>();
    for (const nf of elements(st, "numFmt", 5000)) custom.set(Number(attr(nf.attrs, "numFmtId")), xmlText(attr(nf.attrs, "formatCode") ?? ""));
    const xfs = firstElement(st, "cellXfs")?.body ?? "";
    for (const xf of elements(xfs, "xf", 65000)) {
      const id = Number(attr(xf.attrs, "numFmtId") ?? "0");
      const code = custom.get(id);
      dateStyle.push(code !== undefined ? isDateFormat(code) : BUILTIN_DATE.has(id));
      shownAs.push(code !== undefined ? displayScaling(code) : BUILTIN_PERCENT.has(id) ? "percent" : null);
    }
  }

  // The sheet.
  const xml = await read(pick.path);
  if (typeof xml !== "string") return xml;
  const sheetName = pick.name;
  const where = (ref: string): string => `cell ${ref} of sheet '${sheetName}'`;
  const cells = new Map<number, Map<number, string>>();
  /** Per column, the first percent- or thousands-formatted number: the stored value is read, and the note says so. */
  const formatNotes = new Map<number, string>();
  let count = 0;
  let rowNo = 0;
  const data = firstElement(xml, "sheetData")?.body ?? "";
  for (const row of elements(data, "row", 1048576)) {
    const rAttr = attr(row.attrs, "r");
    rowNo = rAttr !== null && /^\d+$/.test(rAttr) ? Number(rAttr) : rowNo + 1;
    if (rowNo < 1 || rowNo > 1048576) return refuse(`a row number in sheet '${sheetName}' is out of range (corrupt file)`);
    let colNo = 0;
    for (const c of elements(row.body ?? "", "c", XLSX_MAX_CELLS + 1)) {
      if (++count > XLSX_MAX_CELLS) return refuse(`sheet '${sheetName}' has more than ${XLSX_MAX_CELLS.toLocaleString("en-US")} cells, more than the pane reads`);
      const ref = attr(c.attrs, "r");
      if (ref !== null) {
        const p = parseRef(ref);
        if (!p) return refuse(`the cell reference '${ref}' in sheet '${sheetName}' is not valid (corrupt file)`);
        if (p.row !== rowNo) return refuse(`cell ${ref} sits in row ${rowNo} of sheet '${sheetName}' (corrupt file)`);
        colNo = p.col;
      } else colNo += 1;
      if (colNo > 16384) return refuse(`a column in sheet '${sheetName}' is past XFD (corrupt file)`);
      const at = `${colLetters(colNo)}${rowNo}`;
      const t = attr(c.attrs, "t") ?? "n";
      const body = c.body ?? "";
      const vEl = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>|<(?:\w+:)?v(?:\s[^>]*)?\/>/.exec(body);
      const v = vEl ? xmlText(vEl[1] ?? "") : null;
      const hasFormula = /<(?:\w+:)?f[\s/>]/.test(body);
      let text: string;
      if (t === "inlineStr") {
        const is = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body);
        text = is ? itemText(is[1]) : "";
      } else if (t === "e") {
        return refuse(`${where(at)} holds the error ${v ?? "value"}${hasFormula ? " (from its formula)" : ""}; fix it in Excel, or clear the cell, and load the file again`);
      } else if (t === "d") {
        return refuse(`${where(at)} holds a date or time, which is not a measurement; convert it to a number of hours, days or minutes in Excel, or clear it`);
      } else if (hasFormula && v === null) {
        return refuse(`${where(at)} is a formula with no saved value; open and save the file in Excel first`);
      } else if (t === "s") {
        const k = Number(v);
        if (!Number.isInteger(k) || k < 0 || k >= shared.length) return refuse(`${where(at)} points to a shared string that is missing (corrupt file)`);
        text = shared[k];
      } else if (t === "str") {
        text = v ?? "";
      } else if (t === "b") {
        text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        if (!text) return refuse(`${where(at)} holds a TRUE/FALSE value that is not readable (corrupt file)`);
      } else {
        if (v === null || v.trim() === "") {
          if (hasFormula) return refuse(`${where(at)} is a formula with no saved value; open and save the file in Excel first`);
          continue; // a styled empty cell
        }
        const s = Number(attr(c.attrs, "s") ?? "0");
        if (dateStyle[s]) return refuse(`${where(at)} is formatted as a date or time, which is not a measurement; format it as a number in Excel (or clear it) and load the file again`);
        // Only a decimal number as the format writes it: Number() would also take "0x10" (16), "0b1", "Infinity".
        const n = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
        if (!Number.isFinite(n)) return refuse(`${where(at)} holds a number this reader cannot read ("${v.trim().slice(0, 30)}")`);
        text = numberText(n);
        // A percent or thousands-scaled format shows a value the stored number does not: read as stored, and said.
        const kind = shownAs[s];
        if (kind && formatNotes.size < 6 && !formatNotes.has(colNo)) formatNotes.set(colNo, `column ${colLetters(colNo)} is formatted ${kind === "percent" ? "as a percentage" : "to show thousands or millions"}; read as stored (${text} in ${at})`);
      }
      if (text === "") continue;
      let r = cells.get(rowNo);
      if (!r) cells.set(rowNo, (r = new Map()));
      r.set(colNo, text);
    }
  }
  // Merged cells: only the top-left keeps its value (Excel stores nothing else there, but other writers may).
  const merges = firstElement(xml, "mergeCells")?.body ?? "";
  let mergeWork = 0;
  for (const m of elements(merges, "mergeCell", 20000)) {
    const [a, b] = (attr(m.attrs, "ref") ?? "").split(":");
    const p = parseRef(a ?? ""), q = parseRef(b ?? a ?? "");
    if (!p || !q) continue;
    // The work counter counts rows AND the cells visited in them, so the cap bounds the real work (a few thousand
    // full-height merges over a wide sheet would otherwise be billions of key visits under a row-only count).
    for (const [rn, r] of cells) {
      if (++mergeWork > 4_000_000) return refuse(`sheet '${sheetName}' has too many merged ranges to read`);
      if (rn < p.row || rn > q.row) continue;
      mergeWork += r.size;
      if (mergeWork > 4_000_000) return refuse(`sheet '${sheetName}' has too many merged ranges to read`);
      for (const cn of [...r.keys()]) if (cn >= p.col && cn <= q.col && !(rn === p.row && cn === p.col)) r.delete(cn);
    }
  }

  // The used range, checked BEFORE any text is built (one value at XFD1048576 must not materialise a huge grid).
  let r0 = Infinity, r1 = 0, c0 = Infinity, c1 = 0, chars = 0;
  for (const [rn, r] of cells)
    for (const [cn, v] of r) {
      r0 = Math.min(r0, rn);
      r1 = Math.max(r1, rn);
      c0 = Math.min(c0, cn);
      c1 = Math.max(c1, cn);
      chars += v.length;
    }
  if (!r1) return refuse(`sheet '${sheetName}' is empty`);
  const range = `${colLetters(c0)}${r0}:${colLetters(c1)}${r1}`;
  const nRows = r1 - r0 + 1, nCols = c1 - c0 + 1;
  if (nRows * nCols > XLSX_MAX_CELLS) return refuse(`the used range of sheet '${sheetName}' (${range}) spans more than ${XLSX_MAX_CELLS.toLocaleString("en-US")} cells, more than the pane reads`);
  if (chars + nRows * nCols > XLSX_MAX_TEXT) return refuse(`sheet '${sheetName}' holds more than 1 MB of text, more than a pane field takes`);
  const rows: string[][] = [];
  for (let rn = r0; rn <= r1; rn++) {
    const r = cells.get(rn);
    const row: string[] = [];
    if (r) {
      let last = 0;
      for (const cn of r.keys()) last = Math.max(last, cn);
      for (let cn = c0; cn <= last; cn++) row.push(r.get(cn) ?? "");
    }
    rows.push(row);
  }
  const text = rows.map((r) => r.join("\t")).join("\n");
  const q = (s: string): string => `'${s}'`;
  const fmt = [...formatNotes.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const note = `sheet ${q(sheetName)}${r0 > 1 || c0 > 1 ? `, ${range}` : ""}${othersShown.length ? `; also in the file: ${othersShown.join(", ")}` : ""}${fmt.length ? `; ${fmt.join("; ")}` : ""}`;
  return { ok: true, rows, text, sheet: sheetName, otherSheets: others, note, range };
}

/** Opens a workbook's bytes and reads its first visible worksheet. `fileName` names the file in messages. */
export async function readXlsx(bytes: Uint8Array, fileName = "the file"): Promise<XlsxSheet | XlsxRefusal> {
  try {
    return await readXlsxInner(bytes, fileName);
  } catch (e) {
    if (e instanceof MalformedXml) return { ok: false, error: `${fileName}: the workbook's XML is malformed (${e.message}); the file is corrupt. Open it in Excel and save it again.` };
    throw e;
  }
}
