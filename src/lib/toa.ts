// Table of Authorities builder: scans document text for citations, classifies
// and de-duplicates them, and produces a grouped, alphabetized authorities list
// (Cases / Statutes / Regulations / Patents / Other Authorities) ready to insert.
//
// Page numbers are intentionally omitted — a text scan can't reliably recover
// them from Word; the drafter adds pages or uses Word's native TA/TOA fields.
//
// Pure logic — no Office.js — fully unit-testable.

import { REPORTER_NAMES, normalizeReporter } from "./citations";

export type ToaCategory = "cases" | "statutes" | "regulations" | "patents" | "other";

export interface ToaEntry {
  /** Plain-text entry (case name + reporter cite; no pincite). */
  plain: string;
  /** HTML entry (case names italicized). */
  html: string;
}

export interface ToaGroup {
  category: ToaCategory;
  heading: string;
  entries: ToaEntry[];
}

export interface TableOfAuthorities {
  groups: ToaGroup[];
  total: number;
}

const HEADINGS: Record<ToaCategory, string> = {
  cases: "Cases",
  statutes: "Statutes",
  regulations: "Regulations",
  patents: "Patents",
  other: "Other Authorities",
};

const ORDER: ToaCategory[] = ["cases", "statutes", "regulations", "patents", "other"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reporter alternation for the regex, longest first so "F. Supp. 2d" beats "F.". */
const REPORTER_ALT = REPORTER_NAMES.slice()
  .sort((a, b) => b.length - a.length)
  .map((r) => r.replace(/[.\\^$*+?()[\]{}|]/g, "\\$&"))
  .join("|");

// A party name: a capitalized first word, then more words that are either
// capitalized or a small set of name-internal connectors — so the pattern can't
// swallow preceding prose ("See also", "The court in …") before the real name.
const NAMEWORD = "(?:[A-Z][A-Za-z0-9.'’&()\\-]*|of|the|and|for|&|de|la|van|von|et|al\\.)";
// An optional trailing corporate suffix set off by a comma (", Inc.", ", LLC").
const CORP = "(?:,\\s+(?:Inc|LLC|L\\.L\\.C|Co|Corp|Ltd|L\\.P|N\\.A|LLP|PLLC)\\.?)?";
const PARTY = `[A-Z][A-Za-z0-9.'’&()\\-]*(?:\\s+${NAMEWORD}){0,7}${CORP}`;
const CASE_NAME = `(?:${PARTY}\\s+v\\.\\s+${PARTY}|(?:In re|Ex parte|In the Matter of)\\s+${PARTY})`;
const CASE_RE = new RegExp(`(${CASE_NAME}),\\s+(\\d+)\\s+(${REPORTER_ALT})\\s+(\\d+)`, "g");

const STATUTE_RE = /\b(\d+)\s+U\.S\.C\.(?:A\.)?\s+§{1,2}\s*([\w.()–—\-]+)/g;
const CFR_RE = /\b(\d+)\s+C\.F\.R\.\s+§{1,2}\s*([\w.()–—\-]+)/g;
const PATENT_RE = /U\.S\.\s+Patent(?:\s+Application\s+Publication)?\s+No\.\s+([\d,\/]+)(?:\s+([A-Z]\d))?/g;
const FEDREG_RE = /\b(\d+)\s+Fed\.\s+Reg\.\s+([\d,]+)/g;
const MPEP_RE = /\bMPEP\s+§{1,2}\s*([\w.()–—\-]+)/g;

/** Trims a trailing sentence period from a captured section number. */
function trimSection(s: string): string {
  return s.replace(/\.+$/, "");
}

interface Raw {
  category: ToaCategory;
  sortKey: string;
  plain: string;
  html: string;
  /** A verbatim substring to search for when marking the cite in the document. */
  locator: string;
}

/** Collects every recognized authority from the text (with duplicates). */
function collect(text: string): Raw[] {
  const out: Raw[] = [];
  let m: RegExpExecArray | null;

  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) {
    // Strip a capitalized leading signal the pattern may have absorbed
    // ("See Ass'n …" → "Ass'n …"). Multi-word signals like "But see" and
    // "See also" are already excluded by the lowercase second word.
    const name = m[1]
      .replace(/\s+/g, " ")
      .replace(/^(?:See|Cf\.|Compare|Accord|Contra|E\.g\.)\s+/, "")
      .trim();
    const cite = `${m[2]} ${normalizeReporter(m[3])} ${m[4]}`;
    out.push({
      category: "cases",
      sortKey: name.toLowerCase().replace(/^(in re|ex parte|in the matter of)\s+/, ""),
      plain: `${name}, ${cite}`,
      html: `<i>${esc(name)}</i>, ${esc(cite)}`,
      locator: cite, // "573 U.S. 208" — appears verbatim even when the name is styled
    });
  }

  const pushPlain = (re: RegExp, category: ToaCategory, build: (mm: RegExpExecArray) => { text: string; sortKey: string }): void => {
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      const { text: t, sortKey } = build(mm);
      out.push({ category, sortKey, plain: t, html: esc(t), locator: t });
    }
  };

  pushPlain(STATUTE_RE, "statutes", (mm) => {
    const sec = trimSection(mm[2]);
    return { text: `${mm[1]} U.S.C. § ${sec}`, sortKey: `${mm[1].padStart(4, "0")} ${sec}` };
  });
  pushPlain(CFR_RE, "regulations", (mm) => {
    const sec = trimSection(mm[2]);
    return { text: `${mm[1]} C.F.R. § ${sec}`, sortKey: `${mm[1].padStart(4, "0")} ${sec}` };
  });
  pushPlain(PATENT_RE, "patents", (mm) => {
    const isApp = /Application\s+Publication/.test(mm[0]);
    const label = isApp ? "U.S. Patent Application Publication No." : "U.S. Patent No.";
    const kind = mm[2] ? ` ${mm[2]}` : "";
    return { text: `${label} ${mm[1]}${kind}`, sortKey: mm[1].replace(/\D/g, "") };
  });
  pushPlain(FEDREG_RE, "other", (mm) => ({
    text: `${mm[1]} Fed. Reg. ${mm[2]}`,
    sortKey: `fedreg ${mm[1].padStart(4, "0")}`,
  }));
  pushPlain(MPEP_RE, "other", (mm) => {
    const sec = trimSection(mm[1]);
    return { text: `MPEP § ${sec}`, sortKey: `mpep ${sec}` };
  });

  return out;
}

/**
 * Builds a Table of Authorities from document text: extract, de-duplicate
 * (by displayed text), sort within each category, and group.
 */
export function buildTableOfAuthorities(text: string): TableOfAuthorities {
  const raws = collect(text);
  const seen = new Set<string>();
  const byCat = new Map<ToaCategory, Raw[]>();
  for (const r of raws) {
    const key = r.category + "|" + r.plain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }

  const groups: ToaGroup[] = [];
  let total = 0;
  for (const category of ORDER) {
    const list = byCat.get(category);
    if (!list || !list.length) continue;
    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "en", { numeric: true }));
    groups.push({ category, heading: HEADINGS[category], entries: list.map((r) => ({ plain: r.plain, html: r.html })) });
    total += list.length;
  }
  return { groups, total };
}

/** Renders the Table of Authorities as HTML for insertion (case names italic). */
export function toaToHtml(toa: TableOfAuthorities): string {
  const parts: string[] = [`<p style="text-align:center"><b>TABLE OF AUTHORITIES</b></p>`];
  for (const g of toa.groups) {
    parts.push(`<p><b>${esc(g.heading)}</b></p>`);
    for (const e of g.entries) parts.push(`<p>${e.html}</p>`);
  }
  return parts.join("");
}

export interface PrecedingAuthority {
  plain: string;
  category: ToaCategory;
}

/**
 * Finds the last authority cited in `text` — used to confirm what an "Id."
 * would refer to (the immediately preceding authority, Rule 4.1). Returns the
 * citation with the greatest position, or null if the text has none.
 */
export function findPrecedingAuthority(text: string): PrecedingAuthority | null {
  let best: PrecedingAuthority | null = null;
  let bestIdx = -1;
  const consider = (idx: number, value: PrecedingAuthority): void => {
    if (idx > bestIdx) {
      bestIdx = idx;
      best = value;
    }
  };

  let m: RegExpExecArray | null;
  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) {
    const name = m[1]
      .replace(/\s+/g, " ")
      .replace(/^(?:See|Cf\.|Compare|Accord|Contra|E\.g\.)\s+/, "")
      .trim();
    consider(m.index, { plain: `${name}, ${m[2]} ${normalizeReporter(m[3])} ${m[4]}`, category: "cases" });
  }
  const scan = (re: RegExp, category: ToaCategory, build: (mm: RegExpExecArray) => string): void => {
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) consider(mm.index, { plain: build(mm), category });
  };
  scan(STATUTE_RE, "statutes", (mm) => `${mm[1]} U.S.C. § ${trimSection(mm[2])}`);
  scan(CFR_RE, "regulations", (mm) => `${mm[1]} C.F.R. § ${trimSection(mm[2])}`);
  scan(PATENT_RE, "patents", (mm) => {
    const isApp = /Application\s+Publication/.test(mm[0]);
    const label = isApp ? "U.S. Patent Application Publication No." : "U.S. Patent No.";
    return `${label} ${mm[1]}${mm[2] ? ` ${mm[2]}` : ""}`;
  });
  scan(FEDREG_RE, "other", (mm) => `${mm[1]} Fed. Reg. ${mm[2]}`);
  scan(MPEP_RE, "other", (mm) => `MPEP § ${trimSection(mm[1])}`);
  return best;
}

// --- native Word Table of Authorities (TA/TOA fields, real page numbers) ------

/**
 * Word's built-in Table of Authorities category numbers. Word has no native
 * "Patents" category, so patents share "Other Authorities" (3) with Fed. Reg.
 * and MPEP.
 */
const CATEGORY_NUM: Record<ToaCategory, number> = {
  cases: 1,
  statutes: 2,
  regulations: 6,
  patents: 3,
  other: 3,
};

/** The category headings/numbers to emit TOA fields for, in Bluebook order. */
export const TOA_FIELD_CATEGORIES: { num: number; heading: string }[] = [
  { num: 1, heading: "Cases" },
  { num: 2, heading: "Statutes" },
  { num: 6, heading: "Regulations" },
  { num: 3, heading: "Other Authorities" },
];

export interface ToaMark {
  /** Long-form entry text that Word lists in the table (the `\l` value). */
  long: string;
  category: ToaCategory;
  categoryNum: number;
  /** Verbatim substring to search the document for, to place the TA field. */
  locator: string;
}

/** De-duplicated authorities to mark for a native Word Table of Authorities. */
export function authoritiesForToa(text: string): ToaMark[] {
  const seen = new Set<string>();
  const out: ToaMark[] = [];
  for (const r of collect(text)) {
    const key = r.category + "|" + r.plain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ long: r.plain, category: r.category, categoryNum: CATEGORY_NUM[r.category], locator: r.locator });
  }
  return out;
}

/** Wraps WordprocessingML body content in a flat-OPC package for insertOoxml. */
function wrapOoxml(body: string): string {
  return (
    '<?xml version="1.0" standalone="yes"?>' +
    '<?mso-application progid="Word.Document"?>' +
    '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">' +
    '<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">' +
    "<pkg:xmlData>" +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships></pkg:xmlData></pkg:part>" +
    '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">' +
    "<pkg:xmlData>" +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>` +
    "</pkg:xmlData></pkg:part></pkg:package>"
  );
}

/** Escapes a field-instruction value: XML-escape, and swap `"` for `'`. */
function escField(s: string): string {
  return esc(s).replace(/"/g, "'");
}

const FLD_BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const FLD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const FLD_SEP = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';

/** OOXML package for one TA (Table of Authorities Entry) marker field. */
export function taFieldOoxml(long: string, categoryNum: number): string {
  const instr = `<w:r><w:instrText xml:space="preserve"> TA \\l "${escField(long)}" \\c ${categoryNum} </w:instrText></w:r>`;
  return wrapOoxml(`<w:p>${FLD_BEGIN}${instr}${FLD_END}</w:p>`);
}

/** OOXML package for the Table of Authorities heading + one TOA field per category. */
export function toaFieldsOoxml(categoryNums: number[]): string {
  const wanted = TOA_FIELD_CATEGORIES.filter((c) => categoryNums.includes(c.num));
  const title = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>TABLE OF AUTHORITIES</w:t></w:r></w:p>';
  const blocks = wanted
    .map((c) => {
      const heading = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${esc(c.heading)}</w:t></w:r></w:p>`;
      const instr = `<w:r><w:instrText xml:space="preserve"> TOA \\c "${c.num}" \\p </w:instrText></w:r>`;
      const placeholder = '<w:r><w:t>Update field (select all, press F9) to build.</w:t></w:r>';
      const field = `<w:p>${FLD_BEGIN}${instr}${FLD_SEP}${placeholder}${FLD_END}</w:p>`;
      return heading + field;
    })
    .join("");
  return wrapOoxml(title + blocks);
}
