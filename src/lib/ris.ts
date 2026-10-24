// RIS import (docs/SCOPE-CITATIONS-2026-10.md §C2).
//
// A record runs from a TY line to an ER line. Lines are "XX  - value"; real exports
// also write "TY - JOUR" with single spaces (EndNote), "ER  -" with no trailing space
// (Springer), CRLF (Scopus) and untagged continuation lines (EndNote's L1 list, a
// wrapped T1), and all of those are accepted. Free text between records (export
// banners) is ignored like a comment; a tagged line outside a record, a record with
// no ER, and a TY outside the table below are refused by line with the reason.
//
// Tag decisions (each pinned in ris.test.ts against a real export):
//   AU/A1          authors, in file order, repeatable (A1 is not "deprecated": Zotero's
//                  own test says mixing them must keep the order).
//   A2/ED          editors (A3 for books, which is where Zotero puts a book's editors);
//                  for TY PAT, A2 is the issuing authority (Zotero's mapping).
//   TI/T1          title; BT for a book with no TI.
//   T2/JF/JO/JA/J2 JF or T2 is the full container title; JO is the container title only
//                  when neither is present (Springer writes "JO  - Nature"), otherwise
//                  it is the abbreviation (EndNote writes "JO  - Augment Altern Commun"
//                  beside JF); JA/J2/J1 are always the abbreviation. Empty tags (the
//                  ScienceDirect "T2  - ") never override a filled one.
//   PY/DA/Y1       DA wins when it has a year (Zotero: "Y1 should not be used when DA is
//                  present"); then PY; then Y1. "2007///", "2024/03//", "1990/2/27" and
//                  "PY  - 0000" (no date) are handled.
//   Y2             access date (Zotero writes "2008/10/01/21:33:40").
//   SP/EP          SP–EP; an SP that already holds the range (Crossref "1818-1859") is
//                  used as is. IS is an issue and is never treated as a range ("1-2").
//   DO             bare DOI via doi.ts; a URL form (ScienceDirect) is normalised.
//   PAT            number from SN (Zotero) or IS (EndNote); authority from A2, else C3;
//                  assignee from PB into `publisher` (Zotero's mapping, both directions).

import type { BibDate, BibName, BibRecord, BibType, ImportResult } from "./bibRecord";
import { MAX_IMPORT_CHARS, nfcRecord, normalizePage, normalizeRichText, stripBom } from "./cslJson";
import { normalizeDoi } from "./doi";
import { parseRisName } from "./bibNames";

/** RIS TY → record type. Anything else is refused by name. */
export const RIS_TYPES: Readonly<Record<string, BibType>> = {
  JOUR: "article-journal", JFULL: "article-journal", EJOUR: "article-journal",
  BOOK: "book", EBOOK: "book", EDBOOK: "book",
  CHAP: "chapter", ECHAP: "chapter",
  CONF: "paper-conference", CPAPER: "paper-conference",
  THES: "thesis",
  RPRT: "report",
  ELEC: "webpage", WEB: "webpage", BLOG: "webpage",
  DATA: "dataset",
  UNPB: "article",
  PAT: "patent",
};

const TAG_LINE = /^([A-Z][A-Z0-9]) {1,2}-(?: (.*))?$/;

interface RawRecord {
  line: number;
  fields: Array<{ tag: string; value: string; line: number }>;
}

/** Parse "YYYY/MM/DD/other", "YYYY///", "YYYY", "YYYY-MM-DD". Year 0 means no date. */
export function parseRisDate(raw: string): BibDate | undefined {
  const s = raw.trim();
  if (s === "") return undefined;
  const m = /^(\d{1,4})(?:[/-](\d{0,2})(?:[/-](\d{0,2})(?:[/-].*)?)?)?$/.exec(s);
  if (!m) return { literal: s };
  const y = Number(m[1]);
  if (y === 0) return undefined;
  const parts: [number, number?, number?] = [y];
  const mo = m[2] ? Number(m[2]) : NaN;
  if (mo >= 1 && mo <= 12) {
    parts.push(mo);
    const d = m[3] ? Number(m[3]) : NaN;
    if (d >= 1 && d <= 31) parts.push(d);
  }
  return { "date-parts": [parts] };
}

function hasYear(d: BibDate | undefined): boolean {
  return !!d && !!d["date-parts"] && d["date-parts"].length > 0;
}

/** First non-empty value of the first listed tag that has one. */
function first(rec: RawRecord, ...tags: string[]): string | undefined {
  for (const t of tags) {
    for (const f of rec.fields) if (f.tag === t && f.value.trim() !== "") return f.value.trim();
  }
  return undefined;
}

function all(rec: RawRecord, ...tags: string[]): string[] {
  return rec.fields.filter((f) => tags.includes(f.tag) && f.value.trim() !== "").map((f) => f.value.trim());
}

const ISBN_ISSN = /^(?:97[89][-\s]?)?[\dX][-\d\sX]{6,}$/i;

class RecordError extends Error {}

function toRecord(rec: RawRecord, tyRaw: string): Omit<BibRecord, "id"> & { idHint?: string } {
  const ty = tyRaw.trim().toUpperCase();
  const type = RIS_TYPES[ty];
  if (!type) {
    throw new RecordError(`RIS type “${ty || "(empty)"}” is not supported (supported: ${Object.keys(RIS_TYPES).join(", ")})`);
  }
  const out: Omit<BibRecord, "id"> & { idHint?: string } = { type };

  // Names. A1 and AU interleave in file order.
  const authorTags = ["AU", "A1"];
  const editorTags = ty === "BOOK" || ty === "EBOOK" ? ["ED", "A3", "A2"] : ty === "PAT" ? ["ED"] : ["ED", "A2"];
  const people = (tags: string[]): BibName[] =>
    rec.fields
      .filter((f) => tags.includes(f.tag) && f.value.trim() !== "")
      .map((f) => parseRisName(f.value))
      .filter((n) => Object.keys(n).length > 0);
  const authors = people(authorTags);
  const editors = people(editorTags);
  if (ty === "EDBOOK") {
    if (authors.length || editors.length) out.editor = [...authors, ...editors];
  } else {
    if (authors.length) out.author = authors;
    if (editors.length) out.editor = editors;
  }

  const title = first(rec, "TI", "T1") ?? (type === "book" ? first(rec, "BT") : undefined) ?? first(rec, "CT");
  if (title) out.title = normalizeRichText(title);

  // Container.
  let container: string | undefined;
  let short: string | undefined;
  if (type === "article-journal" || type === "webpage" || type === "dataset" || type === "article") {
    const full = first(rec, "JF", "T2");
    const jo = first(rec, "JO");
    container = full ?? jo;
    short = first(rec, "JA", "J2", "J1") ?? (full && jo && jo !== full ? jo : undefined);
  } else if (type === "chapter") {
    container = first(rec, "T2", "BT");
  } else if (type === "paper-conference") {
    container = first(rec, "T2", "BT", "C3");
    short = first(rec, "J2");
  }
  if (container) out["container-title"] = normalizeRichText(container);
  if (short) out["container-title-short"] = short;

  // Dates.
  const da = first(rec, "DA");
  const py = first(rec, "PY");
  const y1 = first(rec, "Y1");
  const dDA = da !== undefined ? parseRisDate(da) : undefined;
  const dPY = py !== undefined ? parseRisDate(py) : undefined;
  const dY1 = y1 !== undefined ? parseRisDate(y1) : undefined;
  const issued = hasYear(dDA) ? dDA : hasYear(dPY) ? dPY : hasYear(dY1) ? dY1 : dDA ?? dPY ?? dY1;
  if (issued) out.issued = issued;
  const y2 = first(rec, "Y2");
  if (y2 !== undefined) {
    const acc = parseRisDate(y2);
    if (acc && hasYear(acc)) out.accessed = acc;
  }

  // Locators.
  if (ty !== "PAT") {
    const vl = first(rec, "VL");
    if (vl) out.volume = vl;
    const is = first(rec, "IS");
    if (is) out.issue = is;
  }
  const sp = first(rec, "SP");
  const ep = first(rec, "EP");
  if (sp && ep && ep !== sp) out.page = normalizePage(`${sp}–${ep}`);
  else if (sp) out.page = normalizePage(sp);
  else if (ep) out.page = normalizePage(ep);

  const doi = first(rec, "DO");
  if (doi) {
    const d = normalizeDoi(doi);
    if ("error" in d) throw new RecordError(d.error);
    out.DOI = d.doi;
  }
  // UR is kept as written, including Scopus's own index page (scopus.com/inward/record…),
  // which is not the work: the styles suppress index-page URLs at print time; the
  // importer never drops data.
  const url = first(rec, "UR");
  if (url) out.URL = url;
  const pb = first(rec, "PB");
  // For TY PAT, PB is the assignee (Zotero RIS.js maps PB ↔ assignee for patents, both
  // ways); it goes in `publisher`, where the Vancouver/NLM patent form reads it.
  if (pb) out.publisher = pb;
  const cy = first(rec, "CY", "PP");
  if (cy && ty !== "PAT") out["publisher-place"] = cy;
  const et = first(rec, "ET");
  if (et) out.edition = et;
  if (type === "thesis" || type === "report") {
    const m3 = first(rec, "M3");
    if (m3) out.genre = m3;
  }
  if (type === "report") {
    const sn = first(rec, "SN");
    if (sn && !ISBN_ISSN.test(sn)) out.number = sn;
  }
  if (ty === "PAT") {
    // PN is the patent-number tag several exporters write ("PN  - US7469381B2");
    // it was dropped (fix2). Then SN (Zotero), M1 and IS (EndNote).
    const num = first(rec, "PN", "SN", "M1", "IS");
    if (num) out.number = num;
    // The issuing office: A2 / C3, else the number's own country prefix.
    const auth = first(rec, "A2", "C3") ?? patentCountryOf(num);
    if (auth) out.authority = auth;
  }
  const id = first(rec, "ID");
  if (id) out.idHint = id;
  return out;
}

/** The issuing office from a patent number's WIPO ST.3 prefix ("US7469381B2",
 *  "EP 1674995", "WO 2020/123456"), or undefined. */
export function patentCountryOf(num: string | undefined): string | undefined {
  const m = /^\s*(US|EP|WO|JP|CN|KR|DE|GB|FR|CA|AU|CH|NL|SE|IT|ES|IN|BR|RU|TW|IL|DK|AT|BE|FI|NO|NZ|MX|SG)(?=\s*[\d/A-Z])/i.exec(num ?? "");
  return m ? m[1].toUpperCase() : undefined;
}

/** Family name + year, then a, b, … z, aa, ab … on collision. `next` remembers each base's counter. */
function makeId(r: Omit<BibRecord, "id">, taken: { has(k: string): boolean }, next: Map<string, number>): string {
  const a = r.author?.[0] ?? r.editor?.[0];
  const base0 = (a?.family ?? a?.literal ?? "ref").normalize("NFC");
  const base = (base0.replace(/[^\p{L}\p{N}]+/gu, () => "") || "ref") + (r.issued?.["date-parts"]?.[0]?.[0] ?? "");
  if (!taken.has(base)) return base;
  for (let k = next.get(base) ?? 0; ; k++) {
    let suffix = "";
    let x = k;
    do {
      suffix = String.fromCharCode(97 + (x % 26)) + suffix;
      x = Math.floor(x / 26) - 1;
    } while (x >= 0);
    if (!taken.has(base + suffix)) {
      next.set(base, k + 1);
      return base + suffix;
    }
  }
}

/** Import RIS text (any line endings). */
export function parseRis(src: string): ImportResult {
  const result: ImportResult = { records: [], refused: [] };
  const text = stripBom(src ?? "");
  if (text.length > MAX_IMPORT_CHARS) {
    result.refused.push({ line: 1, reason: `input is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_IMPORT_CHARS.toLocaleString("en-US")}` });
    return result;
  }
  const lines = text.split(/\r\n|\n|\r/);
  const raws: Array<{ rec: RawRecord; ty: string }> = [];
  let cur: { rec: RawRecord; ty: string } | null = null;
  let lastField: { value: string } | null = null;

  lines.forEach((rawLine, k) => {
    const lineNo = k + 1;
    const line = rawLine.replace(/\s+$/, () => "");
    const m = TAG_LINE.exec(line);
    if (!m) {
      if (line.trim() === "") return;
      if (cur && lastField) {
        lastField.value += " " + line.trim();
        return;
      }
      return; // free text outside a record: an export banner, ignored like a comment
    }
    const tag = m[1];
    const value = (m[2] ?? "").trim();
    if (tag === "TY") {
      if (cur) {
        result.refused.push({ line: cur.rec.line, reason: `record has no ER line before the next TY on line ${lineNo}` });
      }
      cur = { rec: { line: lineNo, fields: [] }, ty: value };
      lastField = null;
      return;
    }
    if (tag === "ER") {
      if (!cur) {
        result.refused.push({ line: lineNo, reason: "ER line with no TY line before it" });
        return;
      }
      raws.push(cur);
      cur = null;
      lastField = null;
      return;
    }
    if (!cur) {
      result.refused.push({ line: lineNo, reason: `${tag} line outside a record (no TY line before it)` });
      return;
    }
    const f = { tag, value, line: lineNo };
    cur.rec.fields.push(f);
    lastField = f;
  });
  if (cur) {
    const open = cur as { rec: RawRecord; ty: string };
    result.refused.push({ line: open.rec.line, reason: "record ends without an ER line" });
  }

  // Convert, then assign ids: the file's own ID tags first, generated ids after, so a
  // generated "Smith2020" can never collide with an ID the file states.
  const converted: Array<{ line: number; body: Omit<BibRecord, "id">; idHint?: string; id?: string }> = [];
  for (const { rec, ty } of raws) {
    try {
      const { idHint, ...body } = toRecord(rec, ty);
      converted.push({ line: rec.line, body, idHint });
    } catch (e) {
      if (e instanceof RecordError) result.refused.push({ line: rec.line, reason: e.message });
      else throw e;
    }
  }
  const taken = new Map<string, number>();
  const nextSuffix = new Map<string, number>();
  const dropped = new Set<number>();
  converted.forEach((c, k) => {
    if (!c.idHint) return;
    const prior = taken.get(c.idHint);
    if (prior !== undefined) {
      result.refused.push({ line: c.line, reason: `duplicate ID “${c.idHint}” (first used on line ${prior})` });
      dropped.add(k);
      return;
    }
    taken.set(c.idHint, c.line);
    c.id = c.idHint;
  });
  converted.forEach((c, k) => {
    if (dropped.has(k)) return;
    if (!c.id) {
      c.id = makeId(c.body, taken, nextSuffix);
      taken.set(c.id, c.line);
    }
    result.records.push(nfcRecord({ id: c.id, ...c.body } as BibRecord));
  });
  result.refused.sort((a, b) => a.line - b.line);
  return result;
}
