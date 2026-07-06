// Table of Authorities builder: scans document text for citations, classifies
// and de-duplicates them, and produces a grouped, alphabetized authorities list
// (Cases / Statutes / Regulations / Patents / Other Authorities) ready to insert.
//
// Page numbers are intentionally omitted — a text scan can't reliably recover
// them from Word; the drafter adds pages or uses Word's native TA/TOA fields.
//
// Pure logic — no Office.js — fully unit-testable.

import { REPORTER_NAMES, normalizeReporter } from "./citations";

export type ToaCategory = "cases" | "statutes" | "rules" | "regulations" | "patents" | "other";

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
  rules: "Rules",
  regulations: "Regulations",
  patents: "Patents",
  other: "Other Authorities",
};

// FRAP 28(a)(3) order: cases, statutes, and other authorities. Rules follow
// statutes; patents fold in just before the catch-all "Other Authorities".
const ORDER: ToaCategory[] = ["cases", "statutes", "rules", "regulations", "patents", "other"];

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
// Letter classes include common Latin-1 diacritics (á, é, ñ, ü, …) and an en/em
// dash so names like "Suárez" or "Israel Bio–Eng'g" aren't truncated mid-name.
const UP = "A-ZÀ-ÖØ-Þ";
const WORDCH = "[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’&()\\-–—]";
const NAMEWORD = `(?:[${UP}]${WORDCH}*|of|the|and|for|&|de|la|van|von|et|al\\.)`;
// A trailing corporate/firm designator set off by a comma. US forms plus a few
// common foreign ones (S.A. de C.V., N.V., A.G., GmbH, S.p.A.) and P.C./P.A.
const CORP =
  "(?:,\\s+(?:Inc|LLC|L\\.L\\.C|Co|Corp|Ltd|L\\.P|N\\.A|LLP|PLLC|P\\.C|P\\.A|S\\.A\\. de C\\.V|S\\.A|S\\. de R\\.L|N\\.V|A\\.G|GmbH|S\\.p\\.A|Ltda|Pty\\. Ltd)\\.?)?";
// A firm name whose parts are comma-separated ("Hamilton, Brook, Smith &
// Reynolds, P.C."): after the main party, allow comma-separated capitalized
// segments (each may itself be "X & Y"). A comma-then-capital boundary can't be
// reached by the space-delimited NAMEWORD repeat, so the two never overlap (no
// catastrophic backtracking).
const FIRMSEG = `[${UP}]${WORDCH}*(?:\\s+(?:&|[${UP}]${WORDCH}*)){0,3}`;
// A firm segment may not sit immediately before " v." — otherwise a leading
// transition word ("Likewise, Smith v. Jones") is mis-read as part of the first
// party. A genuine firm-name plaintiff ends in a corp form (P.C., LLP), which
// the CORP branch still captures.
const FIRMTAIL = `(?:,\\s+${FIRMSEG}(?!\\s+v\\.)){0,4}`;
const PARTY = `[${UP}]${WORDCH}*(?:\\s+${NAMEWORD}){0,7}${FIRMTAIL}${CORP}`;
const CASE_NAME = `(?:${PARTY}\\s+v\\.\\s+${PARTY}|(?:In re|Ex parte|In the Matter of)\\s+${PARTY})`;
// An optional pincite ("573 U.S. 208, 216" or "…, 205–09 n.4") that may sit
// between the first-page cite and the "(court year)" parenthetical.
const PINCITE = "(?:,\\s*\\d+(?:[–—-]\\d+)?(?:\\s*n\\.\\s*\\d+)?)*";
// The "(court year)" parenthetical that closes a full citation, e.g. "(2014)",
// "(Fed. Cir. 2008)", "(D. Mass. 2025)". Captured so the TOA entry is complete.
const YEAR_PAREN = `(?:${PINCITE}\\s*\\(([^)]{0,45}(?:19|20)\\d{2}[a-z]?)\\))?`;
const CASE_RE = new RegExp(`(${CASE_NAME}),\\s+(\\d+)\\s+(${REPORTER_ALT})\\s+(\\d+)${YEAR_PAREN}`, "g");

// Unpublished decisions: "Name, [No. …,] YEAR <db> NUMBER" where <db> is a
// commercial database (Westlaw / LexisNexis). These carry no reporter, so they
// are matched separately but classified as cases.
const UNPUB_DB = "WL|U\\.S\\. Dist\\. LEXIS|U\\.S\\. App\\. LEXIS|U\\.S\\. LEXIS|Fed\\. App'x LEXIS|WESTLAW";
const UNPUB_RE = new RegExp(
  `(${CASE_NAME}),\\s+(?:No\\.\\s+[^,]+,\\s+)?(\\d{4})\\s+(${UNPUB_DB})\\s+(\\d+)(?:,?\\s*(?:at\\s*\\*\\d+\\s*)?\\(([^)]{0,45}(?:19|20)\\d{2})\\))?`,
  "g"
);

const STATUTE_RE = /\b(\d+)\s+U\.S\.C\.(?:A\.)?\s+§{1,2}\s*([\w.()–—\-]+)/g;
const CFR_RE = /\b(\d+)\s+C\.F\.R\.\s+§{1,2}\s*([\w.()–—\-]+)/g;
const PATENT_RE = /U\.S\.\s+Patent(?:\s+Application\s+Publication)?\s+No\.\s+([\d,\/]+)(?:\s+([A-Z]\d))?/g;
const FEDREG_RE = /\b(\d+)\s+Fed\.\s+Reg\.\s+([\d,]+)/g;
const MPEP_RE = /\bMPEP\s+§{1,2}\s*([\w.()–—\-]+)/g;

// Federal rules in the qualified form ("Fed. R. Civ. P. 19(a)"). The base rule
// number (19) is what the table lists; subsections collapse into it.
const RULE_ABBR: Record<string, string> = { Civ: "Civ.", App: "App.", Evid: "Evid.", Crim: "Crim.", Bankr: "Bankr." };
const RULE_RE = /\bFed\.\s+R\.\s+(Civ|App|Evid|Crim|Bankr)\.\s+P\.\s+(\d+)(?:\([\w'.]+\))*/g;
// Bare "Rule 12(b)(7)" references. Only trusted when the document also uses the
// qualified "Fed. R. Civ. P." form (so we know the ruleset) — then a bare rule
// in a federal civil brief is treated as Fed. R. Civ. P.
const HAS_FRCP_RE = /\bFed\.\s+R\.\s+Civ\.\s+P\./;
const BARE_RULE_RE = /\bRules?\s+(\d+)(?:\([\w)(]+\))?/g;

/** Trims a trailing sentence period from a captured section number. */
function trimSection(s: string): string {
  return s.replace(/\.+$/, "");
}

interface Raw {
  category: ToaCategory;
  sortKey: string;
  /** Italic portion of the entry (the case name); "" for non-cases. */
  name: string;
  /** Roman remainder after the name (", reporter page (court year)"); for a
   *  non-case this is the whole entry and `name` is "". */
  rest: string;
  /** Full plain-text entry (`name` + `rest`). */
  plain: string;
  html: string;
  /** A verbatim substring to search for when marking the cite in the document. */
  locator: string;
  /** Dedup key that ignores the court/year parenthetical (name + core cite). */
  dedupe: string;
}

/** Builds a case Raw, splitting the italic name from the roman cite + (court year). */
function caseRaw(rawName: string, coreCite: string, courtYear: string | undefined): Raw {
  const name = rawName
    .replace(/\s+/g, " ")
    .replace(/^(?:See|Cf\.|Compare|Accord|Contra|E\.g\.)\s+/, "")
    .trim();
  const cy = courtYear ? courtYear.replace(/\s+/g, " ").trim() : "";
  const rest = `, ${coreCite}${cy ? ` (${cy})` : ""}`;
  return {
    category: "cases",
    sortKey: name.toLowerCase().replace(/^(in re|ex parte|in the matter of)\s+/, ""),
    name,
    rest,
    plain: `${name}${rest}`,
    html: `<i>${esc(name)}</i>, ${esc(coreCite)}${cy ? ` (${esc(cy)})` : ""}`,
    locator: coreCite, // "573 U.S. 208" — appears verbatim even when the name is styled
    dedupe: `cases|${name.toLowerCase()}|${coreCite.toLowerCase()}`,
  };
}

/** Collects every recognized authority from the text (with duplicates). */
function collect(text: string): Raw[] {
  const out: Raw[] = [];
  let m: RegExpExecArray | null;

  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) {
    out.push(caseRaw(m[1], `${m[2]} ${normalizeReporter(m[3])} ${m[4]}`, m[5]));
  }

  // Unpublished decisions (Westlaw / LexisNexis) — no reporter, still cases.
  UNPUB_RE.lastIndex = 0;
  while ((m = UNPUB_RE.exec(text))) {
    out.push(caseRaw(m[1], `${m[2]} ${m[3]} ${m[4]}`, m[5]));
  }

  const pushPlain = (re: RegExp, category: ToaCategory, build: (mm: RegExpExecArray) => { text: string; sortKey: string }): void => {
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      const { text: t, sortKey } = build(mm);
      out.push({ category, sortKey, name: "", rest: t, plain: t, html: esc(t), locator: t, dedupe: `${category}|${t.toLowerCase()}` });
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

  // Federal rules — qualified "Fed. R. Civ. P. 19" form (authoritative).
  const ruleText = (abbr: string, num: string): { text: string; sortKey: string } => ({
    text: `Fed. R. ${RULE_ABBR[abbr]} P. ${num}`,
    sortKey: `${abbr.toLowerCase()} ${num.padStart(4, "0")}`,
  });
  pushPlain(RULE_RE, "rules", (mm) => ruleText(mm[1], mm[2]));
  // Bare "Rule 12(b)(7)" — trusted only in a document that also uses the
  // qualified Fed. R. Civ. P. form; then treated as a civil rule.
  if (HAS_FRCP_RE.test(text)) {
    pushPlain(BARE_RULE_RE, "rules", (mm) => ruleText("Civ", mm[1]));
  }

  return out;
}

/**
 * De-duplicates raws by their court/year-insensitive key, keeping the richest
 * occurrence (the one that carries the (court year) parenthetical), in first-
 * seen order.
 */
function dedupeBest(raws: Raw[]): Raw[] {
  const best = new Map<string, Raw>();
  const order: string[] = [];
  for (const r of raws) {
    const cur = best.get(r.dedupe);
    if (!cur) {
      best.set(r.dedupe, r);
      order.push(r.dedupe);
    } else if (r.plain.length > cur.plain.length) {
      best.set(r.dedupe, r);
    }
  }
  return order.map((k) => best.get(k)!);
}

/**
 * Builds a Table of Authorities from document text: extract, de-duplicate
 * (by displayed text), sort within each category, and group.
 */
export function buildTableOfAuthorities(text: string): TableOfAuthorities {
  const byCat = new Map<ToaCategory, Raw[]>();
  for (const r of dedupeBest(collect(text))) {
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

export interface RegisterEntry {
  /** The authority as it will read in the table. */
  plain: string;
  category: ToaCategory;
  heading: string;
  /** How many times the authority is cited in full form (see note below). */
  count: number;
}

export interface CitationRegister {
  /** All distinct authorities, in Table-of-Authorities order (category, then A–Z). */
  entries: RegisterEntry[];
  /** Distinct authority count. */
  authorities: number;
  /** Total full-form citations detected. */
  citations: number;
  /** The subset cited more than once. */
  repeated: RegisterEntry[];
}

/**
 * Scans text and returns a citation register: every distinct authority with a
 * usage count, so repeated authorities are visible before the table is built.
 *
 * The count reflects full-form citations (name + reporter, or a statute/rule/
 * patent as written). Short forms — "Id.", "supra", and "…, 925 F.3d at 1237" —
 * are not counted, since they carry no reporter+page to key on; the same is true
 * of Word's own citation marking.
 */
export function citationRegister(text: string): CitationRegister {
  const map = new Map<string, RegisterEntry & { sortKey: string }>();
  let citations = 0;
  for (const r of collect(text)) {
    citations++;
    const existing = map.get(r.dedupe);
    if (existing) {
      existing.count++;
      if (r.plain.length > existing.plain.length) existing.plain = r.plain; // keep the (court year) form
    } else {
      map.set(r.dedupe, { plain: r.plain, category: r.category, heading: HEADINGS[r.category], count: 1, sortKey: r.sortKey });
    }
  }
  const rank = (c: ToaCategory): number => ORDER.indexOf(c);
  const entries = [...map.values()]
    .sort((a, b) => rank(a.category) - rank(b.category) || a.sortKey.localeCompare(b.sortKey, "en", { numeric: true }))
    .map(({ plain, category, heading, count }) => ({ plain, category, heading, count }));
  return { entries, authorities: entries.length, citations, repeated: entries.filter((e) => e.count > 1) };
}

/** Normalizes an authority name for matching between a scan and a built table. */
export function toaEntryKey(name: string): string {
  return name
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[.,;\s]+$/, "")
    .trim()
    .toLowerCase();
}

/** A page list: arabic and/or roman numerals separated by commas ("6, 8", "iv, 13"). */
const PAGE_LIST_RE = /^[ivxlcdm\d]+(?:\s*[,–—-]\s*[ivxlcdm\d]+)*$/i;

/**
 * Parses page references out of a built Table of Authorities. Word renders each
 * TOA entry as "Authority Name<tab>p1, p2, …", so this reads the visible text
 * and returns a map from authority (via {@link toaEntryKey}) to its page string.
 * Only meaningful after the native TOA has been inserted and updated (F9);
 * returns an empty map otherwise.
 */
export function parseToaPages(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/[\r\n\v]+/)) {
    const ti = line.lastIndexOf("\t");
    if (ti < 1) continue;
    const name = line.slice(0, ti).replace(/[\t.\s]+$/, "");
    const pages = line.slice(ti + 1).trim();
    if (!name || !PAGE_LIST_RE.test(pages)) continue;
    out.set(toaEntryKey(name), pages);
  }
  return out;
}

/** Renders the Table of Authorities as HTML for insertion (case names italic). */
export function toaToHtml(toa: TableOfAuthorities): string {
  // Court-brief convention (matches a standard legal template): Times New Roman
  // 12 pt; the title centered, bold, and underlined; category headings bold.
  // Each case entry is two lines — the italic name ending in a comma, then the
  // reporter + (court year) on an indented second line (hanging indent).
  const font = "font-family:'Times New Roman',serif;font-size:12pt";
  const parts: string[] = [`<p style="text-align:center;${font}"><b><u>TABLE OF AUTHORITIES</u></b></p>`];
  for (const g of toa.groups) {
    parts.push(`<p style="${font}"><b>${esc(g.heading)}</b></p>`);
    for (const e of g.entries) {
      const m = e.html.match(/^<i>([\s\S]*?)<\/i>,\s*([\s\S]*)$/);
      const style = `${font};margin-left:0.5in;text-indent:-0.5in`;
      parts.push(m ? `<p style="${style}"><i>${m[1]}</i>,<br>${m[2]}</p>` : `<p style="${style}">${e.html}</p>`);
    }
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
  UNPUB_RE.lastIndex = 0;
  while ((m = UNPUB_RE.exec(text))) {
    const name = m[1]
      .replace(/\s+/g, " ")
      .replace(/^(?:See|Cf\.|Compare|Accord|Contra|E\.g\.)\s+/, "")
      .trim();
    consider(m.index, { plain: `${name}, ${m[2]} ${m[3]} ${m[4]}`, category: "cases" });
  }
  scan(STATUTE_RE, "statutes", (mm) => `${mm[1]} U.S.C. § ${trimSection(mm[2])}`);
  scan(CFR_RE, "regulations", (mm) => `${mm[1]} C.F.R. § ${trimSection(mm[2])}`);
  scan(RULE_RE, "rules", (mm) => `Fed. R. ${RULE_ABBR[mm[1]]} P. ${mm[2]}`);
  scan(PATENT_RE, "patents", (mm) => {
    const isApp = /Application\s+Publication/.test(mm[0]);
    const label = isApp ? "U.S. Patent Application Publication No." : "U.S. Patent No.";
    return `${label} ${mm[1]}${mm[2] ? ` ${mm[2]}` : ""}`;
  });
  scan(FEDREG_RE, "other", (mm) => `${mm[1]} Fed. Reg. ${mm[2]}`);
  scan(MPEP_RE, "other", (mm) => `MPEP § ${trimSection(mm[1])}`);
  return best;
}

// --- supra: detect an earlier secondary source (law-review article) ----------

// "Author, Title, VOL JOURNAL PAGE (YEAR)". The journal must carry a law-journal
// marker (L. Rev. / L.J. / Rev. / J. …) so a case reporter isn't mistaken for one.
const AUTHOR = "[A-Z][A-Za-z.'’-]+(?:\\s+[A-Z][A-Za-z.'’-]*){1,3}";
const ARTICLE_RE = new RegExp(
  `(${AUTHOR}(?:\\s+&\\s+${AUTHOR})?),\\s+[A-Z][^,]{2,180}?,\\s+\\d+\\s+` +
    `(?:[A-Z][A-Za-z.'’&]*\\s+){0,4}(?:L\\.\\s?Rev\\.|L\\.\\s?J\\.|Rev\\.|J\\.(?:\\s?[A-Z][A-Za-z.'’&]*)*)\\s+` +
    `\\d+(?:,\\s*\\d+)?\\s*\\((?:19|20)\\d{2}\\)`,
  "g"
);

export interface SecondarySource {
  /** The author(s) as written, e.g. "Mark A. Lemley". */
  author: string;
  /** The Bluebook supra short form — surname(s), e.g. "Lemley" or "Lemley & O'Brien". */
  short: string;
  /** The full matched citation. */
  plain: string;
}

/** Author surname(s) for a supra short form: "Mark A. Lemley" → "Lemley". */
function supraShort(author: string): string {
  return author
    .split(/\s*&\s*/)
    .map((a) => a.trim().split(/\s+/).slice(-1)[0])
    .join(" & ");
}

/**
 * Finds the last law-review article cited in `text` — for building a `supra`
 * reference back to it (Rule 4.2 limits supra to secondary sources). Returns
 * null if none is found. Treatises/books are too ambiguous to detect reliably.
 */
export function findPrecedingSecondarySource(text: string): SecondarySource | null {
  let best: SecondarySource | null = null;
  let bestIdx = -1;
  ARTICLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARTICLE_RE.exec(text))) {
    if (m.index > bestIdx) {
      bestIdx = m.index;
      const author = m[1].replace(/\s+/g, " ").trim();
      best = { author, short: supraShort(author), plain: m[0].replace(/\s+/g, " ").trim() };
    }
  }
  return best;
}

// --- native Word Table of Authorities (TA/TOA fields, real page numbers) ------

/**
 * Word's built-in Table of Authorities category numbers (1 Cases, 2 Statutes,
 * 3 Other Authorities, 4 Rules, 6 Regulations). Word has no native "Patents"
 * category, so patents share "Other Authorities" (3) with Fed. Reg. and MPEP.
 */
const CATEGORY_NUM: Record<ToaCategory, number> = {
  cases: 1,
  statutes: 2,
  rules: 4,
  regulations: 6,
  patents: 3,
  other: 3,
};

/** The category headings/numbers to emit TOA fields for, in Bluebook order. */
export const TOA_FIELD_CATEGORIES: { num: number; heading: string }[] = [
  { num: 1, heading: "Cases" },
  { num: 2, heading: "Statutes" },
  { num: 4, heading: "Rules" },
  { num: 6, heading: "Regulations" },
  { num: 3, heading: "Other Authorities" },
];

export interface ToaMark {
  /** Long-form entry text that Word lists in the table (the `\l` value). */
  long: string;
  /** Italic portion of the entry (the case name); "" for non-cases. */
  name: string;
  /** Roman remainder after the name (", reporter (court year)"). */
  rest: string;
  category: ToaCategory;
  categoryNum: number;
  /** Verbatim substring to search the document for, to place the TA field. */
  locator: string;
}

/** De-duplicated authorities to mark for a native Word Table of Authorities. */
export function authoritiesForToa(text: string): ToaMark[] {
  return dedupeBest(collect(text)).map((r) => ({
    long: r.plain,
    name: r.name,
    rest: r.rest,
    category: r.category,
    categoryNum: CATEGORY_NUM[r.category],
    locator: r.locator,
  }));
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

// Court-brief run properties: Times New Roman 12 pt (matches a standard legal
// template). Titles add bold + single underline; category headings add bold.
const RPR_BASE = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/>';
const RPR_TITLE = `${RPR_BASE}<w:b/><w:bCs/><w:u w:val="single"/>`;
const RPR_HEADING = `${RPR_BASE}<w:b/><w:bCs/>`;

/** A centered, bold, underlined Times New Roman title paragraph. */
function titlePara(text: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:rPr>${RPR_TITLE}</w:rPr></w:pPr><w:r><w:rPr>${RPR_TITLE}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/**
 * True if a Word field instruction is a TA (Table of Authorities Entry) mark.
 * The instruction begins with "TA " (a TOA field begins with "TOA " and is
 * excluded). Used to clear existing citation marks before rebuilding.
 */
export function isTaFieldCode(code: string | null | undefined): boolean {
  return /^\s*TA\s/i.test(code || "");
}

/**
 * True if a Word field instruction is a generated table — a Table of Contents
 * ("TOC …") or Table of Authorities ("TOA …") field. Used to clear the tables
 * themselves for a full reset (distinct from the per-citation TA marks).
 */
export function isTableFieldCode(code: string | null | undefined): boolean {
  return /^\s*TO[AC]\b/i.test(code || "");
}

/**
 * OOXML package for one TA (Table of Authorities Entry) marker field.
 *
 * When `name` is given (a case), the long-citation value is split across
 * instrText runs so the case-name portion carries italic run properties — this
 * is how Word's "Keep original formatting" preserves an italicized case name in
 * the generated table. `rest` (", reporter (court year)") stays roman. For a
 * non-case, pass name = "" and the whole entry in `rest`.
 */
export function taFieldOoxml(name: string, rest: string, categoryNum: number): string {
  const q = '<w:instrText xml:space="preserve">';
  let runs: string;
  if (name) {
    runs =
      `<w:r>${q} TA \\l "</w:instrText></w:r>` +
      `<w:r><w:rPr><w:i/><w:iCs/></w:rPr>${q}${escField(name)}</w:instrText></w:r>` +
      `<w:r>${q}${escField(rest)}" \\c ${categoryNum} </w:instrText></w:r>`;
  } else {
    runs = `<w:r>${q} TA \\l "${escField(rest)}" \\c ${categoryNum} </w:instrText></w:r>`;
  }
  return wrapOoxml(`<w:p>${FLD_BEGIN}${runs}${FLD_END}</w:p>`);
}

/** OOXML package for the Table of Authorities heading + one TOA field per category. */
export function toaFieldsOoxml(categoryNums: number[]): string {
  const wanted = TOA_FIELD_CATEGORIES.filter((c) => categoryNums.includes(c.num));
  const title = titlePara("TABLE OF AUTHORITIES");
  const blocks = wanted
    .map((c) => {
      const heading = `<w:p><w:pPr><w:rPr>${RPR_HEADING}</w:rPr></w:pPr><w:r><w:rPr>${RPR_HEADING}</w:rPr><w:t xml:space="preserve">${esc(c.heading)}</w:t></w:r></w:p>`;
      const instr = `<w:r><w:rPr>${RPR_BASE}</w:rPr><w:instrText xml:space="preserve"> TOA \\c "${c.num}" \\p </w:instrText></w:r>`;
      const placeholder = `<w:r><w:rPr>${RPR_BASE}</w:rPr><w:t>Update field (select all, press F9) to build.</w:t></w:r>`;
      const field = `<w:p><w:pPr><w:rPr>${RPR_BASE}</w:rPr></w:pPr>${FLD_BEGIN}${instr}${FLD_SEP}${placeholder}${FLD_END}</w:p>`;
      return heading + field;
    })
    .join("");
  return wrapOoxml(title + blocks);
}

// --- native Word Table of Contents (TOC field, real page numbers) -------------

/**
 * OOXML package for a "TABLE OF CONTENTS" heading + a native Word TOC field
 * built from the document's heading styles (FRAP 28(a)(2): a table of contents
 * with page references). Field switches: `\o "1-N"` builds from Heading 1..N,
 * `\h` makes entries clickable, `\z` hides the leader/page number in web view,
 * `\u` uses the paragraph outline level. The user presses F9 to populate it.
 *
 * @param levels how many heading levels to include (1–9); defaults to 3.
 */
export function tocFieldOoxml(levels = 3): string {
  const n = Math.min(9, Math.max(1, Math.floor(levels)));
  const title = titlePara("TABLE OF CONTENTS");
  const instr = `<w:r><w:rPr>${RPR_BASE}</w:rPr><w:instrText xml:space="preserve"> TOC \\o "1-${n}" \\h \\z \\u </w:instrText></w:r>`;
  const placeholder = `<w:r><w:rPr>${RPR_BASE}</w:rPr><w:t>Update field (select all, press F9) to build the table of contents.</w:t></w:r>`;
  const field = `<w:p><w:pPr><w:rPr>${RPR_BASE}</w:rPr></w:pPr>${FLD_BEGIN}${instr}${FLD_SEP}${placeholder}${FLD_END}</w:p>`;
  return wrapOoxml(title + field);
}
