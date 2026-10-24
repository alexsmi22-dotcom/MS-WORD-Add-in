// BibTeX import (docs/SCOPE-CITATIONS-2026-10.md §C2).
//
// Syntax: @type{key, field = {…} | "…" | 123 | macro # …} with { } or ( ) as entry
// delimiters; @string (macros, case-insensitive, usable in later @strings),
// @preamble (validated, ignored), @comment (skipped). Text between entries is a
// comment, as in BibTeX. Month macros jan…dec are predefined (case-insensitive:
// Crossref writes "month=May").
//
// Refusals carry the entry's first line and the reason: unbalanced braces (with the
// line the brace opened on), an undefined macro, a duplicate key, an unsupported
// type, a malformed name, a DOI that is not a DOI. After a refusal, scanning resumes
// at the next line that starts with "@", so one bad entry never swallows the rest.
// An entry is never dropped without a refusal.
//
// crossref: a child takes every field it lacks from its parent (the parent may come
// later in the file), and the parent's title becomes the child's booktitle. The
// parent is also imported as its own record. A child whose parent is missing is still
// imported (the contract has no warnings channel; reported to the integrator).
// biblatex xdata is out of scope and refused by name.
//
// Patents: the assignee (BibTeX `assignee`, biblatex `holder`) goes in `publisher`,
// because the frozen contract has no assignee field.

import type { BibDate, BibRecord, BibType, ImportResult } from "./bibRecord";
import { MAX_IMPORT_CHARS, lineIndex, nfcRecord, normalizePage, normalizeRichText, parseIsoDate, stripBom } from "./cslJson";
import { normalizeDoi } from "./doi";
import { NameError, parseBibtexNameList, splitBibtexNames } from "./bibNames";
import { latexToPlain, latexToRich } from "./latexUnicode";
import { patentCountryOf } from "./ris";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_MACROS: Record<string, string> = {};
MONTHS.forEach((m, k) => {
  MONTH_MACROS[m.slice(0, 3)] = MONTHS[k][0].toUpperCase() + MONTHS[k].slice(1);
});

/** BibTeX / biblatex entry type → record type. Anything else is refused by name. */
export const BIBTEX_TYPES: Readonly<Record<string, BibType>> = {
  article: "article-journal",
  book: "book", mvbook: "book", booklet: "book", manual: "book", proceedings: "book",
  mvproceedings: "book", collection: "book", mvcollection: "book", reference: "book",
  incollection: "chapter", inbook: "chapter", inreference: "chapter", bookinbook: "chapter",
  inproceedings: "paper-conference", conference: "paper-conference",
  phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis",
  techreport: "report", report: "report",
  online: "webpage", www: "webpage", electronic: "webpage",
  dataset: "dataset",
  patent: "patent",
  misc: "article", unpublished: "article", preprint: "article",
};

const PATENT_TYPES: Record<string, string> = {
  patentus: "US", patrequs: "US", patenteu: "EP", patreqeu: "EP", patentuk: "GB", patrequk: "GB",
  patentde: "DE", patreqde: "DE", patentfr: "FR", patreqfr: "FR", patentjp: "JP", patentwo: "WO",
  patreqwo: "WO", patentcn: "CN", patentkr: "KR",
};

interface RawEntry {
  type: string;
  key: string;
  line: number;
  fields: Map<string, string>;
}

class BibError extends Error {
  constructor(message: string, readonly offset: number) {
    super(message);
  }
}

class Scanner {
  i = 0;
  constructor(readonly s: string, readonly lineAt: (o: number) => number) {}
  get eof(): boolean {
    return this.i >= this.s.length;
  }
  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  ident(): string {
    const m = /^[^\s"#%'(),={}]+/.exec(this.s.slice(this.i, this.i + 256));
    if (!m) return "";
    this.i += m[0].length;
    return m[0];
  }
  /**
   * A {…} value starting at this.i (which is "{"). Returns the inner text. Refuses a
   * value that runs into a line starting with "@type{" before closing: that is the
   * classic missing "}" and would otherwise eat the next entry.
   */
  braced(field: string): string {
    const open = this.i;
    let depth = 0;
    const s = this.s;
    for (let j = this.i; j < s.length; j++) {
      const ch = s[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          this.i = j + 1;
          return s.slice(open + 1, j);
        }
      } else if (ch === "\n" && /^[ \t]*@[A-Za-z]+[ \t]*[{(]/.test(s.slice(j + 1, j + 80))) {
        throw new BibError(`unbalanced braces in field “${field}”: the “{” opened on line ${this.lineAt(open)} is still open when the next entry starts on line ${this.lineAt(j + 1)}`, open);
      }
    }
    throw new BibError(`unbalanced braces in field “${field}”: the “{” opened on line ${this.lineAt(open)} never closes`, open);
  }
  quoted(field: string): string {
    const open = this.i;
    let depth = 0;
    const s = this.s;
    for (let j = this.i + 1; j < s.length; j++) {
      const ch = s[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < 0) throw new BibError(`unbalanced braces in field “${field}”: a “}” on line ${this.lineAt(j)} has no “{”`, j);
      } else if (ch === '"' && depth === 0) {
        this.i = j + 1;
        return s.slice(open + 1, j);
      } else if (ch === "\n" && /^[ \t]*@[A-Za-z]+[ \t]*[{(]/.test(s.slice(j + 1, j + 80))) {
        throw new BibError(`unterminated quoted value in field “${field}” (opened on line ${this.lineAt(open)})`, open);
      }
    }
    throw new BibError(`unterminated quoted value in field “${field}” (opened on line ${this.lineAt(open)})`, open);
  }
}

/** A value: pieces joined by #. Macros resolve against @string definitions, then months. */
function readValue(sc: Scanner, field: string, macros: Map<string, string>): string {
  let out = "";
  for (;;) {
    sc.ws();
    const ch = sc.s[sc.i];
    if (ch === "{") out += sc.braced(field);
    else if (ch === '"') out += sc.quoted(field);
    else if (ch !== undefined && /[0-9]/.test(ch)) {
      const m = /^[0-9]+/.exec(sc.s.slice(sc.i, sc.i + 64))!;
      out += m[0];
      sc.i += m[0].length;
    } else {
      const at = sc.i;
      const name = sc.ident();
      if (!name) {
        throw new BibError(ch === undefined ? `field “${field}” has no value before the end of the input` : `field “${field}” has no value (found “${ch}”)`, at);
      }
      const low = name.toLowerCase();
      const v = macros.get(low) ?? MONTH_MACROS[low];
      if (v === undefined) throw new BibError(`undefined @string macro “${name}” in field “${field}”`, at);
      out += v;
    }
    sc.ws();
    if (sc.s[sc.i] === "#") {
      sc.i++;
      continue;
    }
    return out;
  }
}

/** Skip one balanced {…} or (…) group at sc.i, or throw. */
function skipGroup(sc: Scanner, what: string): void {
  const open = sc.s[sc.i];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  const start = sc.i;
  for (let j = sc.i; j < sc.s.length; j++) {
    const ch = sc.s[j];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        sc.i = j + 1;
        return;
      }
    }
  }
  throw new BibError(`unbalanced ${open === "(" ? "parentheses" : "braces"} in ${what} (opened on line ${sc.lineAt(start)})`, start);
}

interface ParseState {
  entries: RawEntry[];
  refused: ImportResult["refused"];
  macros: Map<string, string>;
}

/** Parse one @… construct at sc.i (pointing at "@"). Throws BibError on malformed input. */
function parseAt(sc: Scanner, st: ParseState): void {
  const start = sc.i;
  const line = sc.lineAt(start);
  sc.i++; // "@"
  sc.ws();
  const typeRaw = sc.ident();
  const type = typeRaw.toLowerCase();
  sc.ws();
  const open = sc.s[sc.i];
  if (type === "comment") {
    if (open === "{" || open === "(") {
      try {
        skipGroup(sc, "@comment");
      } catch {
        // An unbalanced @comment is skipped to the end of its line, like BibTeX.
        const nl = sc.s.indexOf("\n", sc.i);
        sc.i = nl < 0 ? sc.s.length : nl + 1;
      }
    }
    return;
  }
  if (open !== "{" && open !== "(") {
    // "@" not followed by an entry (an e-mail address in a comment): not an entry.
    sc.i = start + 1;
    return;
  }
  const close = open === "(" ? ")" : "}";
  sc.i++;
  if (type === "preamble") {
    readValue(sc, "@preamble", st.macros);
    sc.ws();
    if (sc.s[sc.i] !== close) throw new BibError(`@preamble on line ${line} is not closed by “${close}”`, sc.i);
    sc.i++;
    return;
  }
  if (type === "string") {
    sc.ws();
    const nameAt = sc.i;
    const name = sc.ident();
    if (!name) throw new BibError("@string has no macro name", nameAt);
    sc.ws();
    if (sc.s[sc.i] !== "=") throw new BibError(`@string “${name}” has no “=”`, sc.i);
    sc.i++;
    const v = readValue(sc, name, st.macros);
    sc.ws();
    if (sc.s[sc.i] !== close) throw new BibError(`@string “${name}” is not closed by “${close}”`, sc.i);
    sc.i++;
    st.macros.set(name.toLowerCase(), v);
    return;
  }
  // Regular entry: key, then fields.
  sc.ws();
  const keyAt = sc.i;
  const keyM = /^[^\s,{}()="#%']*/.exec(sc.s.slice(sc.i, sc.i + 512))!;
  const key = keyM[0];
  sc.i += key.length;
  sc.ws();
  if (sc.s[sc.i] === "=" || key === "") {
    throw new BibError(`@${typeRaw} entry has no citation key`, keyAt);
  }
  const fields = new Map<string, string>();
  // The last field whose value spanned lines: when an entry never closes, an extra "{"
  // inside that value (which then swallowed the entry's own "}") is the usual culprit.
  let spanning: { name: string; from: number; to: number } | null = null;
  const unclosed = (where: string): BibError => {
    const hint = spanning
      ? `unbalanced braces in field “${spanning.name}”: its “{” opened on line ${spanning.from} only closes on line ${spanning.to}, so entry “${key}” is still open ${where}`
      : `entry “${key}” is not closed by “${close}” ${where}`;
    return new BibError(hint, start);
  };
  for (;;) {
    sc.ws();
    const ch = sc.s[sc.i];
    if (ch === close) {
      sc.i++;
      break;
    }
    if (ch === ",") {
      sc.i++;
      continue;
    }
    if (ch === undefined) throw unclosed("at the end of the input");
    if (ch === "@") throw unclosed(`when the next entry starts on line ${sc.lineAt(sc.i)}`);
    const fAt = sc.i;
    const fname = sc.ident().toLowerCase();
    if (!fname) throw new BibError(`unexpected “${ch}” on line ${sc.lineAt(fAt)} in entry “${key}”`, fAt);
    sc.ws();
    if (sc.s[sc.i] !== "=") throw new BibError(`field “${fname}” on line ${sc.lineAt(fAt)} has no “=”`, sc.i);
    sc.i++;
    sc.ws();
    const vFrom = sc.lineAt(sc.i);
    const value = readValue(sc, fname, st.macros);
    const vTo = sc.lineAt(Math.max(0, sc.i - 1));
    if (vTo > vFrom) spanning = { name: fname, from: vFrom, to: vTo };
    if (!fields.has(fname)) fields.set(fname, value);
    sc.ws();
    const after = sc.s[sc.i];
    if (after === undefined) throw unclosed("at the end of the input");
    if (after === "@") throw unclosed(`when the next entry starts on line ${sc.lineAt(sc.i)}`);
    if (after !== "," && after !== close) {
      throw new BibError(`expected “,” or “${close}” after field “${fname}” on line ${sc.lineAt(sc.i)}, found “${after}”`, sc.i);
    }
  }
  st.entries.push({ type, key, line, fields });
}

/**
 * Where to resume after a refused entry: the next "@type{" or "@type(" after its "@"
 * (on the same line too, so a one-line file with several entries loses only the bad
 * one). Every later entry is then either imported or refused on its own line.
 */
function resync(s: string, from: number): number {
  const re = /@[A-Za-z]+[ \t\r\n]*[{(]/g;
  re.lastIndex = from + 1;
  const m = re.exec(s);
  return m ? m.index : s.length;
}

function parseEntries(src: string): ParseState & { lineAt: (o: number) => number } {
  const lineAt = lineIndex(src);
  const sc = new Scanner(src, lineAt);
  const st: ParseState = { entries: [], refused: [], macros: new Map() };
  while (!sc.eof) {
    const at = src.indexOf("@", sc.i);
    if (at < 0) break;
    sc.i = at;
    try {
      parseAt(sc, st);
    } catch (e) {
      if (!(e instanceof BibError)) throw e;
      const line = lineAt(at);
      const m = /^@\s*([^\s{(]*)\s*[{(]\s*([^\s,{}()=]*)/.exec(src.slice(at, at + 300));
      const label = m && m[2] && !/^(string|preamble)$/i.test(m[1]) ? `@${m[1]}{${m[2]}}: ` : m ? `@${m[1]}: ` : "";
      st.refused.push({ line, reason: label + e.message });
      sc.i = resync(src, at);
    }
    if (sc.i <= at) sc.i = at + 1; // every pass consumes input
  }
  return { ...st, lineAt };
}

/** Minimal unescape for URL-like fields: braces dropped, \_ \% \& \# \~ restored, no other LaTeX. */
function urlish(raw: string): string {
  return raw
    .replace(/\\url\{([^}]*)\}/g, (_m, u: string) => u)
    .replace(/\\([_%&#~$])/g, (_m, c: string) => c)
    .replace(/[{}]/g, () => "")
    .replace(/\s+/g, () => "")
    .trim();
}

function monthNumber(raw: string): number | undefined {
  const s = latexToPlain(raw).trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n : undefined;
  }
  const k = MONTHS.findIndex((m) => m === s || m.slice(0, 3) === s || (s.length >= 3 && m.startsWith(s)));
  return k >= 0 ? k + 1 : undefined;
}

function issuedFrom(f: Map<string, string>): BibDate | undefined {
  const date = f.get("date");
  if (date !== undefined) {
    const d = parseIsoDate(latexToPlain(date));
    if (d) return d;
    const lit = latexToPlain(date);
    if (lit) return { literal: lit };
  }
  const yearRaw = f.get("year");
  if (yearRaw === undefined) return undefined;
  const year = latexToPlain(yearRaw).trim();
  if (!/^-?\d{1,4}$/.test(year) || Number(year) === 0) return year ? { literal: year } : undefined;
  const parts: [number, number?, number?] = [Number(year)];
  const mo = f.get("month");
  const m = mo !== undefined ? monthNumber(mo) : undefined;
  if (m !== undefined) {
    parts.push(m);
    const dayRaw = f.get("day");
    if (dayRaw !== undefined && /^\d{1,2}$/.test(latexToPlain(dayRaw)) && Number(latexToPlain(dayRaw)) >= 1 && Number(latexToPlain(dayRaw)) <= 31) {
      parts.push(Number(latexToPlain(dayRaw)));
    }
  }
  return { "date-parts": [parts] };
}

class EntryError extends Error {}

/**
 * A patent's assignee goes in `publisher` (the contract has no assignee field; the
 * Vancouver/NLM patent form prints it from there). Zotero's BibTeX export writes
 * `assignee = {Kao Corp}`, its biblatex export `holder = {Kao Corp}` (a name list, so
 * several holders are joined with "; ").
 */
function patentAssignee(f: Map<string, string>): string | undefined {
  const raw = f.get("assignee") ?? f.get("holder");
  if (raw === undefined) return undefined;
  const parts = splitBibtexNames(raw)
    .map((p) => latexToPlain(p))
    .filter((p) => p !== "");
  return parts.length ? parts.join("; ") : undefined;
}

function toRecord(e: RawEntry, fieldsIn: Map<string, string>): BibRecord {
  const type = BIBTEX_TYPES[e.type];
  if (!type) {
    throw new EntryError(`BibTeX entry type @${e.type} is not supported (supported: ${Object.keys(BIBTEX_TYPES).map((t) => "@" + t).join(", ")})`);
  }
  const f = fieldsIn;
  if (f.has("xdata")) throw new EntryError("biblatex “xdata” inheritance is not supported; paste the entry with its fields written out");
  const plain = (k: string): string | undefined => {
    const v = f.get(k);
    if (v === undefined) return undefined;
    const p = latexToPlain(v);
    return p === "" ? undefined : p;
  };
  const rich = (k: string): string | undefined => {
    const v = f.get(k);
    if (v === undefined) return undefined;
    const r = normalizeRichText(latexToRich(v));
    return r === "" ? undefined : r;
  };

  let recType: BibType = type;
  if (e.type === "misc") {
    if (f.has("eprint") || f.has("archiveprefix") || f.has("eprinttype")) recType = "article";
    else if (f.has("url") || /\\url\{/.test(f.get("howpublished") ?? "")) recType = "webpage";
  }
  if (e.type === "inbook" && !f.has("booktitle")) recType = "book";

  const rec: BibRecord = { id: e.key.normalize("NFC"), type: recType };

  const title = rich("title");
  if (title) rec.title = title;
  let container: string | undefined;
  if (recType === "chapter" || recType === "paper-conference") container = rich("booktitle") ?? rich("journal");
  else if (recType === "article-journal" || recType === "article" || recType === "webpage" || recType === "dataset") {
    container = rich("journaltitle") ?? rich("journal");
  } else if (recType === "book") container = undefined;
  if (container) rec["container-title"] = container;
  // Source-supplied abbreviations only (never invented): biblatex shortjournal, Zotero /
  // Better BibTeX journalabbreviation, Web of Science Journal-ISO, Scopus abbrev_source_title.
  const short =
    plain("shortjournal") ?? plain("journalabbreviation") ?? plain("journal-abbreviation") ?? plain("journalabbr") ??
    plain("journal-iso") ?? plain("abbrev_source_title");
  if (short) rec["container-title-short"] = short;

  // et-al-in-source means "the AUTHOR list is truncated". "and others" in the editor list
  // sets it only when there is no author list (styles then promote editors to the author
  // slot); otherwise an editor's et al. would print after a complete author list.
  const etAlBy: Partial<Record<"author" | "editor", boolean>> = {};
  for (const role of ["author", "editor"] as const) {
    const raw = f.get(role);
    if (raw === undefined) continue;
    try {
      const { names, etAl: more } = parseBibtexNameList(raw);
      if (names.length) rec[role] = names;
      if (more) etAlBy[role] = true;
    } catch (err) {
      if (err instanceof NameError) throw new EntryError(`${role}: ${err.message}`);
      throw err;
    }
  }
  if (etAlBy.author || (etAlBy.editor && !rec.author)) rec["et-al-in-source"] = true;

  const issued = issuedFrom(f);
  if (issued) rec.issued = issued;

  const volume = plain("volume");
  if (volume) rec.volume = volume;
  const number = plain("number");
  const issue = plain("issue");
  if (recType === "report" || recType === "patent") {
    if (number) rec.number = number;
    if (issue) rec.issue = issue;
  } else if (recType === "article-journal" || recType === "article") {
    if (issue ?? number) rec.issue = (issue ?? number)!;
  } else if (issue) rec.issue = issue;

  const pages = plain("pages");
  if (pages) rec.page = normalizePage(pages);
  // Article numbers: biblatex eid, ACM articleno, Scopus art_number. Often the only locator.
  const eid = plain("eid") ?? plain("articleno") ?? plain("article-number") ?? plain("art_number");
  if (eid) rec["article-number"] = eid;

  const doiRaw = f.get("doi");
  if (doiRaw !== undefined && urlish(doiRaw) !== "") {
    const d = normalizeDoi(urlish(doiRaw));
    if ("error" in d) throw new EntryError(d.error);
    rec.DOI = d.doi;
  }
  const url = f.get("url") ?? (/\\url\{/.test(f.get("howpublished") ?? "") ? f.get("howpublished") : undefined);
  if (url !== undefined && urlish(url)) rec.URL = urlish(url);

  const publisher =
    recType === "thesis" ? plain("school") ?? plain("institution") ?? plain("publisher")
    : recType === "report" ? plain("institution") ?? plain("publisher") ?? plain("organization")
    : recType === "patent" ? patentAssignee(f)
    : plain("publisher") ?? plain("organization") ?? (e.type === "manual" ? plain("organization") : undefined);
  if (publisher) rec.publisher = publisher;
  const place = recType === "patent" ? undefined : plain("address") ?? plain("location");
  if (place) rec["publisher-place"] = place;
  const edition = plain("edition");
  if (edition) rec.edition = edition;

  const typeField = plain("type");
  if (recType === "thesis") {
    rec.genre = typeField ?? (e.type === "phdthesis" ? "PhD thesis" : e.type === "mastersthesis" ? "Master's thesis" : undefined);
    if (rec.genre === undefined) delete rec.genre;
  } else if (recType === "report" && typeField) rec.genre = typeField;
  if (recType === "patent") {
    const t = (typeField ?? "").toLowerCase();
    // …else the number's own country prefix: number = {US 7,469,381} is a US patent (fix2).
    const authority = PATENT_TYPES[t] ?? plain("nationality") ?? plain("location") ?? plain("address") ?? patentCountryOf(number);
    if (authority) rec.authority = authority;
  }

  const urldate = plain("urldate");
  if (urldate) {
    const d = parseIsoDate(urldate);
    if (d) rec.accessed = d;
  }
  return nfcRecord(rec);
}

/**
 * Identifiers name ONE object: the proceedings volume's DOI or URL is not the paper's.
 * BibTeX would copy them; a citation must not (it would link to the wrong work).
 */
const NOT_INHERITED = new Set(["crossref", "xdata", "doi", "url", "urldate", "eprint", "eprinttype", "archiveprefix", "eid", "isbn", "issn", "pmid", "pmcid", "key", "ids"]);

/** Fields a crossref child inherits from its parent: every missing field except identifiers. */
function inherit(child: Map<string, string>, parent: Map<string, string>): Map<string, string> {
  const out = new Map(child);
  for (const [k, v] of parent) {
    if (NOT_INHERITED.has(k)) continue;
    if (k === "title") {
      if (!out.has("booktitle") && !parent.has("booktitle")) out.set("booktitle", v);
      continue;
    }
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}

/** Import BibTeX / biblatex text. */
export function parseBibtex(src: string): ImportResult {
  const result: ImportResult = { records: [], refused: [] };
  const text = stripBom(src ?? "");
  if (text.length > MAX_IMPORT_CHARS) {
    result.refused.push({ line: 1, reason: `input is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_IMPORT_CHARS.toLocaleString("en-US")}` });
    return result;
  }
  const st = parseEntries(text);
  result.refused.push(...st.refused);

  // Duplicate keys (BibTeX compares keys case-insensitively): the second is refused by name.
  const byKey = new Map<string, RawEntry>();
  const kept: RawEntry[] = [];
  for (const e of st.entries) {
    const k = e.key.toLowerCase();
    const prior = byKey.get(k);
    if (prior) {
      result.refused.push({ line: e.line, reason: `duplicate key “${e.key}” (first defined on line ${prior.line})` });
      continue;
    }
    byKey.set(k, e);
    kept.push(e);
  }

  for (const e of kept) {
    try {
      let fields = e.fields;
      const xref = e.fields.get("crossref");
      if (xref !== undefined) {
        const parent = byKey.get(urlish(xref).toLowerCase());
        if (parent && parent !== e) {
          fields = inherit(e.fields, parent.fields);
        }
      }
      result.records.push(toRecord(e, fields));
    } catch (err) {
      if (err instanceof EntryError) result.refused.push({ line: e.line, reason: `@${e.type}{${e.key}}: ${err.message}` });
      else throw err;
    }
  }
  result.refused.sort((a, b) => a.line - b.line);
  return result;
}
