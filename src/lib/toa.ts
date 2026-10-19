// Table of Authorities builder: scans document text for citations, classifies
// and de-duplicates them, and produces a grouped, alphabetized authorities list
// (Cases / Statutes / Regulations / Patents / Other Authorities) ready to insert.
//
// Page numbers: a text scan cannot recover them, so they arrive by one of the
// two routes this module provides rather than being guessed — Word's native
// TA/TOA fields (which paginate themselves on F9), or `parseToaPages`, which
// reads the pages back out of a generated table and feeds them to
// `toaStaticOoxml` for the static brief-template version. This comment used to
// say pages were "intentionally omitted"; that stopped being true when those
// two paths shipped, and a stale refusal is how a capability gets re-refused
// by the next reader.
//
// Pure logic — no Office.js — fully unit-testable.

import {
  REPORTER_ALIASES,
  REPORTER_NAMES,
  abbreviateCaseName,
  caseShortName,
  isCaseNameAbbreviation,
  normalizeReporter,
  sectionSymbol,
} from "./citations";

// One short-name implementation for the form button and the TOA scan (Rule
// 10.9); it lives in citations.ts so that file never has to import this one.
export { caseShortName };

export type ToaCategory = "cases" | "statutes" | "rules" | "regulations" | "patents" | "other";

export interface ToaEntry {
  /** Plain-text entry (case name + reporter cite; no pincite). */
  plain: string;
  /** HTML entry (case names italicized). */
  html: string;
  /** Italic portion (case name); "" for non-cases. */
  name: string;
  /** Roman remainder after the name (", reporter (court year)"). */
  rest: string;
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

/**
 * A reporter spelling as a tolerant regex: any spacing (none, a space, an NBSP)
 * between its parts, and either apostrophe. "F. 3d", "F. 3d", "F.Supp.2d",
 * "S.Ct.", "F. App’x" all match; normalizeReporter files them under the T1 form.
 */
function reporterPattern(r: string): string {
  let out = "";
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (ch === " ") out += "\\s*";
    else if (ch === "'" || ch === "’") out += "['’‘]";
    else if (ch === ".") out += i < r.length - 1 && r[i + 1] !== " " ? "\\.\\s*" : "\\.";
    else out += ch.replace(/[\\^$*+?()[\]{}|]/g, "\\$&");
  }
  return out;
}

/** Reporter alternation for the regex, longest first so "F. Supp. 2d" beats "F.". */
const REPORTER_ALT = [...REPORTER_NAMES, ...Object.keys(REPORTER_ALIASES)]
  .sort((a, b) => b.length - a.length)
  .map(reporterPattern)
  .join("|");

/** Horizontal whitespace only: a party name never crosses a paragraph (\r),
 *  line break (\n, \v) or page break. */
const HS = "[ \\t\\u00a0]+";

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
  `(?:,${HS}(?:Inc|LLC|L\\.L\\.C|Co|Corp|Ltd|L\\.P|N\\.A|LLP|PLLC|P\\.C|P\\.A|S\\.A\\. de C\\.V|S\\.A|S\\. de R\\.L|N\\.V|A\\.G|GmbH|S\\.p\\.A|Ltda|Pty\\. Ltd)\\.?)?`;
// A firm name whose parts are comma-separated ("Hamilton, Brook, Smith &
// Reynolds, P.C."): after the main party, allow comma-separated capitalized
// segments (each may itself be "X & Y"). A comma-then-capital boundary can't be
// reached by the space-delimited NAMEWORD repeat, so the two never overlap (no
// catastrophic backtracking).
const FIRMSEG = `[${UP}]${WORDCH}*(?:${HS}(?:&|[${UP}]${WORDCH}*)){0,3}`;
// A firm segment may not sit immediately before " v." — otherwise a leading
// transition word ("Likewise, Smith v. Jones") is mis-read as part of the first
// party. A genuine firm-name plaintiff ends in a corp form (P.C., LLP), which
// the CORP branch still captures.
const FIRMTAIL = `(?:,${HS}${FIRMSEG}(?!${HS}vs?\\.)){0,4}`;
// The first word of a party. Normally capitalized, but real party names can
// start lowercase: a camel-case brand ("eBay", "iRobot") or a surname particle
// before a capitalized surname ("de Vries", "van Gogh"). Both lowercase forms
// need a left word boundary, so a match can never start in the middle of a
// word; without these branches the scan dropped the leading letters and filed
// "Bay Inc. v. MercExchange" under B.
const NOT_AFTER_LETTER = "(?<![A-Za-zÀ-ÖØ-öø-ÿ'’])";
const PARTY_HEAD =
  `(?:${NOT_AFTER_LETTER}[a-z]{1,2}[${UP}]${WORDCH}*` +
  `|${NOT_AFTER_LETTER}(?:de|del|della|der|den|van|von|du|da|di|dos|das|le|la|ter)${HS}[${UP}]${WORDCH}*` +
  `|[${UP}]${WORDCH}*)`;
const PARTY = `${PARTY_HEAD}(?:${HS}${NAMEWORD}){0,7}${FIRMTAIL}${CORP}`;
// "v." (and the non-Bluebook "vs.", which drafters paste; it is shown as "v.").
const CASE_NAME = `(?:${PARTY}${HS}vs?\\.${HS}${PARTY}|(?:In re|Ex parte|In the Matter of)${HS}${PARTY})`;
// An optional pincite ("573 U.S. 208, 216" or "…, 205–09 n.4") that may sit
// between the first-page cite and the "(court year)" parenthetical.
const PINCITE = "(?:,\\s*\\d+(?:[–—-]\\d+)?(?:\\s*n\\.\\s*\\d+)?)*";
// The "(court year)" parenthetical that closes a full citation, e.g. "(2014)",
// "(Fed. Cir. 2008)", "(D. Mass. 2025)", "(1829)". Any year from 1600 on.
const YEAR_PAREN = `(?:${PINCITE}\\s*\\(([^)]{0,45}(?:1[6-9]|20)\\d{2}[a-z]?)\\))?`;
// Early U.S. Reports carry the nominative reporter: "56 U.S. (15 How.) 62".
const NOMINATIVE = "(?:\\s*\\((\\d+\\s+[A-Z][A-Za-z.]*(?:\\s+[A-Z][A-Za-z.]*)?)\\))?";
// Groups: 1 name, 2 vol, 3 reporter, 4 nominative, 5 page, 6 (court year).
// The page may not run into a letter: "10 F. 3d 5" is never "10 F. 3".
const CASE_RE = new RegExp(
  `(${CASE_NAME}),\\s+(\\d+)\\s+(${REPORTER_ALT})${NOMINATIVE}\\s+(\\d+)(?![\\w])${YEAR_PAREN}`,
  "g",
);

// Unpublished decisions: "Name, [No. …,] YEAR <db> NUMBER" where <db> is a
// commercial database (Westlaw / LexisNexis). These carry no reporter, so they
// are matched separately but classified as cases. The docket number is part of
// the cite (Rule 10.8.1(a)) and is kept.
// Groups: 1 name, 2 docket, 3 year, 4 database, 5 number, 6 (court date).
const UNPUB_DB = "WL|U\\.S\\. Dist\\. LEXIS|U\\.S\\. App\\. LEXIS|U\\.S\\. LEXIS|Fed\\. App['’]x LEXIS|WESTLAW";
const UNPUB_RE = new RegExp(
  `(${CASE_NAME}),\\s+(?:((?:(?:Civ\\.|Civil\\s+Action|Case|Appeal)\\s+)?Nos?\\.\\s+[^,]+),\\s+)?(\\d{4})\\s+(${UNPUB_DB})\\s+(\\d+)(?:,?\\s*(?:at\\s*\\*\\d+\\s*)?\\(([^)]{0,45}(?:1[6-9]|20)\\d{2})\\))?`,
  "g"
);

// A section token, munched maximally (the lookahead stops a backtrack from
// shortening "35" to "3").
const SEC_TOK = "[\\w.()–—\\-]+(?![\\w.()–—\\-])";
// "35 U.S.C. § 101", "35 USC § 101", "35 U.S.C. 101". Groups: 1 title, 2 "§"/"§§"
// (undefined when omitted), 3 the first section. A "§§" list is walked by
// readSectionList, not by the regex, so its end is decided by grammar.
const STATUTE_RE = new RegExp(`\\b(\\d+)\\s+(?:U\\.S\\.C\\.(?:A\\.)?|USCA?)(?:\\s*(§{1,2})\\s*|\\s+(?=\\d))(${SEC_TOK})`, "g");
const CFR_RE = new RegExp(`\\b(\\d+)\\s+(?:C\\.F\\.R\\.|CFR)(?:\\s*(§{1,2})\\s*|\\s+(?=\\d))(${SEC_TOK})`, "g");
// "U.S. Patent No. 7,469,381", "U.S. Pat. No. RE45,678", "U.S. Patent Nos. A and B",
// "U.S. Patent Application Publication No. 2020/0123456". Groups: 1 "Application
// Publication" (or undefined), 2 "No."/"Nos.", 3 the number, 4 a kind code.
const PATNUM = "(?:RE|PP|AI|[DHTX])?\\d[\\d,\\/]*\\d";
const PATENT_RE = new RegExp(
  `U\\.S\\.\\s+Pat(?:ent|\\.)(?:\\s+(Application\\s+Publication|App(?:l)?\\.\\s+Pub\\.))?\\s+(Nos?\\.)\\s+(${PATNUM})(?:\\s+([A-Z]\\d))?`,
  "g",
);
const FEDREG_RE = /\b(\d+)\s+Fed\.\s+Reg\.\s+([\d,]+)/g;
// Groups: 1 "§"/"§§", 2 the first section.
const MPEP_RE = new RegExp(`\\bMPEP\\s+(§{1,2})\\s*(${SEC_TOK})`, "g");

// Federal rules in the qualified form ("Fed. R. Civ. P. 19(a)"). The base rule
// number (19) is what the table lists; subsections collapse into it.
const RULE_ABBR: Record<string, string> = { Civ: "Civ.", App: "App.", Evid: "Evid.", Crim: "Crim.", Bankr: "Bankr." };
const RULE_RE = /\bFed\.\s+R\.\s+(Civ|App|Evid|Crim|Bankr)\.\s+P\.\s+(\d+)(?:\([\w'.]+\))*/g;
// Bare "Rule 12(b)(7)" references. Only trusted when the document also uses the
// qualified "Fed. R. Civ. P." form (so we know the ruleset) — then a bare rule
// in a federal civil brief is treated as Fed. R. Civ. P.
const HAS_FRCP_RE = /\bFed\.\s+R\.\s+Civ\.\s+P\./;
const BARE_RULE_RE = /\bRules?\s+(\d+)(?:\([\w)(]+\))?/g;
/**
 * Words that, immediately before "Rule", mean it is NOT a Federal Rule of Civil
 * Procedure: a local rule, a patent local rule, a bankruptcy rule and so on.
 */
const RULE_QUALIFIER_RE =
  /(?:\b(?:local|patent|civil|criminal|bankruptcy|appellate|evidence)|[snew]\.\s?d\.|l\.\s?r\.)\s*$/i;
/**
 * USPTO practice rules, always written "Rule 131" / "Rule 132" and never FRCP.
 * 37 C.F.R. 1.131 (swear-behind) and 1.132 (declaration) are the two a patent
 * attorney types most often, which is exactly why this mattered here.
 */
const USPTO_PRACTICE_RULES = new Set([130, 131, 132]);

/** Trims a trailing sentence period (and an unbalanced ")" swallowed from
 *  surrounding prose, as in "(see 35 U.S.C. § 101).") from a captured section. */
function trimSection(s: string): string {
  let out = s;
  for (;;) {
    const before = out;
    out = out.replace(/\.+$/, "");
    if (out.endsWith(")") && (out.match(/\)/g) || []).length > (out.match(/\(/g) || []).length) out = out.slice(0, -1);
    if (out === before) return out;
  }
}

/** A positional occurrence: exactly where in the text, and the verbatim text. */
interface Span {
  index: number;
  text: string;
}

/** Something the scanner saw and deliberately did NOT use, said by name. */
export interface ToaRefusal {
  index: number;
  text: string;
  reason: string;
}

/**
 * Walks a list after its first member ("§§ 102, 103, and 112"; "Patent Nos. A
 * and B"). Grammar:
 *  - members are joined by ", " / " and " / " & " / ", and ";
 *  - an "and"/"&" join CLOSES the list ("§§ 102 and 103, and 11–20 under …" stops
 *    at 103 — the ", and 11–20" is the next clause);
 *  - a member that is the title of the next cite ("…, 35 U.S.C. § 112") ends it;
 *  - a third-or-later member joined by a bare comma and followed by a WORD
 *    ("§§ 102, 103, 12 claims remain") is ambiguous — a count, not a section —
 *    and is REFUSED by name rather than guessed at.
 * Returns the further members (not the first) and any refusal.
 */
function readList(
  text: string,
  from: number,
  token: string,
  what: string,
): { members: Span[]; refusal: ToaRefusal | null } {
  const step = new RegExp(`(\\s*,\\s*(?:and\\s+|&\\s*)?|\\s+(?:and|&)\\s+|\\s*&\\s*)(?:§+\\s*)?(${token})`, "y");
  const members: Span[] = [];
  let pos = from;
  for (;;) {
    step.lastIndex = pos;
    const m = step.exec(text);
    if (!m) break;
    const tokIndex = m.index + m[0].length - m[2].length;
    const after = text.slice(tokIndex + m[2].length, tokIndex + m[2].length + 24);
    if (/^\s+(?:U\.?\s?S\.?\s?C|USC|C\.?\s?F\.?\s?R|CFR|Fed\.|F\.|U\.S\.|S\.\s?Ct|MPEP)/.test(after)) break;
    const joinedByAnd = /and|&/.test(m[1]);
    if (!joinedByAnd && /^[ \t ]+[A-Za-z]/.test(after) && members.length >= 1) {
      return {
        members,
        refusal: {
          index: tokIndex,
          text: m[2],
          reason: `"${m[2]}" follows a ${what} list but reads as a number in the sentence, not a list member — not listed`,
        },
      };
    }
    members.push({ index: tokIndex, text: m[2] });
    pos = tokIndex + m[2].length;
    if (joinedByAnd) break;
  }
  return { members, refusal: null };
}

/** A section as shown in the table: whitespace collapsed, and a numeric range
 *  printed with an en dash ("1.97-1.98" → "1.97–1.98", Rule 3.3(b)) — but never
 *  the hyphen INSIDE one section number ("1.6011-4", "2000e-2"). */
function normalizeSection(raw: string): string {
  const sec = trimSection(raw).replace(/\s+/g, " ");
  const r = /^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/.exec(sec);
  return r && sectionSymbol(sec) === "§§" ? `${r[1]}–${r[2]}` : sec;
}

interface ListedCite {
  /** Table text per member, in order. */
  texts: string[];
  sortKeys: string[];
  /** The verbatim document text per member: the whole cite for a single
   *  section; for a list, the head through member 1, then each member token. */
  spans: Span[];
  /** The cite as one string ("35 U.S.C. §§ 102, 103"), for findPrecedingAuthority. */
  whole: string;
  refusal: ToaRefusal | null;
}

/**
 * A statute / regulation / MPEP cite at a regex match whose last group is the
 * first section and whose `signGroup` is "§"/"§§". After "§§" each listed
 * section becomes its OWN row (FRAP 28(a)(3): every page where each authority is
 * cited); a single "§" is never extended into a list ("§ 112, ¶ 6").
 */
function listedSections(text: string, mm: RegExpExecArray, signs: string | undefined, prefixOf: (sec: string) => string, sortOf: (sec: string) => string): ListedCite {
  const first = mm[mm.length - 1];
  const firstIndex = mm.index + mm[0].length - first.length;
  const firstSec = trimSection(first);
  const members: Span[] = [{ index: mm.index, text: text.slice(mm.index, firstIndex + firstSec.length) }];
  let refusal: ToaRefusal | null = null;
  const secs = [firstSec];
  // A list only after "§§", and only if the first token did not end the sentence.
  if (signs === "§§" && firstSec === first) {
    const more = readList(text, firstIndex + first.length, "\\d[\\w.()–—\\-]*(?![\\w.()–—\\-])", "section");
    refusal = more.refusal;
    for (const s of more.members) {
      const t = trimSection(s.text);
      members.push({ index: s.index, text: t });
      secs.push(t);
    }
  }
  const shown = secs.map(normalizeSection);
  if (shown.length === 1) {
    return {
      texts: [`${prefixOf(shown[0])}`],
      sortKeys: [sortOf(shown[0])],
      spans: members,
      whole: `${prefixOf(shown[0])}`,
      refusal,
    };
  }
  const head = prefixOf("1").replace(/§+\s*1$/, "");
  return {
    texts: shown.map((s) => prefixOf(s)),
    sortKeys: shown.map(sortOf),
    spans: members,
    whole: `${head}§§ ${shown.join(", ")}`,
    refusal,
  };
}

/** "35 U.S.C. § 102" for a title + code + section. */
const codeCite = (title: string, code: string) => (sec: string): string => `${title} ${code} ${sectionSymbol(sec)} ${sec}`;

/** Folds curly quotes to straight ones (same length, so offsets survive). Word
 *  autocorrects ' to ’ while pasted text keeps ', and both are one authority. */
function foldQuotes(s: string): string {
  return s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

/** Groups a run of digits with thousands commas: "7469381" → "7,469,381". */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** One patent number as a row: "U.S. Patent No. RE45,678" — a patent number
 *  is shown with Bluebook commas (letter prefix kept) and keyed on prefix +
 *  digits, so "7,469,381" and "7469381" are one row. */
function patentRow(num: string, isApp: boolean, kind: string): { text: string; sortKey: string; key: string } {
  const label = isApp ? "U.S. Patent Application Publication No." : "U.S. Patent No.";
  const prefix = (/^[A-Z]+/.exec(num) ?? [""])[0];
  const digits = num.replace(/\D/g, "");
  const shown = isApp ? num : prefix + groupDigits(digits);
  return {
    text: `${label} ${shown}${kind ? ` ${kind}` : ""}`,
    sortKey: `${prefix}${digits.padStart(12, "0")}`,
    key: `patents|${label.toLowerCase()}|${prefix}${digits}`,
  };
}

/** The "(the '381 patent)" short name of a patent row: its last three digits. */
function patentShortDigits(long: string): string | null {
  const m = /^U\.S\. Patent No\. [A-Z]*([\d,]+)/.exec(long);
  if (!m) return null;
  const d = m[1].replace(/\D/g, "");
  return d.length >= 3 ? d.slice(-3) : null;
}

// Capitalized sentence-opener words that a greedy party-name match can absorb
// when they run straight into a case name with no comma ("In Alice Corp. v. …",
// "Applying Mayo v. …", "Whether Bilski v. …"). "In" is guarded so the genuine
// "In re" / "In the Matter of" case forms survive. "Under" is deliberately NOT
// listed: real litigants start with it ("Under Armour", "Under Seal"), and a
// wrong strip would corrupt an actual party name — worse than leaving it.
const LEADING_INTRO_RE =
  /^(?:In(?!\s+re\b)(?!\s+the\s+Matter\b)|Applying|Citing|Quoting|Following|Whether|Because|Although|Though|Since|When|Where|While|Unlike|Given|Assuming|Consider|Accordingly|Moreover|Nevertheless|Nonetheless|Likewise|Similarly|Conversely|Instead|Notably|Finally|Here|Thus|Therefore|Hence|However|Indeed|After|Before|Even|Both|Only|Recently|Later|Earlier|Yet|Still|Also|Again|Specifically|Importantly|Ultimately|Then|Next|Per)\s+/;

/**
 * Cuts a name at the last SENTENCE end inside it: the greedy party grammar
 * accepts "Court." / "Circuit." / "Id." as capitalised name words, so "…by the
 * Supreme Court. Mayo Collaborative Servs. v. …" would otherwise keep the
 * previous sentence. A period ends a sentence when its word is not a case-name
 * abbreviation (isCaseNameAbbreviation: "Corp.", "Servs.", "Cal." are kept).
 */
function cutAtSentenceEnd(name: string): string {
  const vAt = name.search(/\svs?\.\s/);
  const firstParty = vAt < 0 ? name : name.slice(0, vAt);
  const words = firstParty.split(" ");
  let cut = -1;
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.endsWith(".") && !isCaseNameAbbreviation(w) && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(words[i + 1])) cut = i;
  }
  if (cut < 0) return name;
  return words.slice(cut + 1).join(" ") + (vAt < 0 ? "" : name.slice(vAt));
}

/**
 * Normalizes a captured case name: collapse whitespace, cut at a sentence end
 * glued on from the previous sentence, drop a leading Bluebook signal, write
 * "vs." as "v." (Rule 10.2.1), and — for a "Party v. Party" citation only —
 * drop a leading prose word the greedy regex glued on from the introducing
 * sentence. The " v. " gate keeps the "In re" / "Ex parte" / "In the Matter of"
 * forms untouched (they have no " v. "), so their leading "In"/"Ex" is never
 * mistaken for prose.
 */
function cleanCaseName(rawName: string): string {
  let name = cutAtSentenceEnd(rawName.replace(/\s+/g, " ").trim())
    .replace(/\svs\.\s/, " v. ")
    .replace(/^(?:See(?:\s+also|\s+generally)?|Cf\.|Compare|Accord|Contra|E\.g\.,?|But\s+see|But\s+cf\.)\s+/, "")
    .trim();
  if (/\sv\.\s/.test(name)) name = name.replace(LEADING_INTRO_RE, "").trim();
  return name;
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
  /** Every verbatim spelling of this authority seen in the document (the
   *  first is `locator`). Merged across duplicates, so "7469381" and
   *  "7,469,381" both get their pages. */
  locators: string[];
  /** Dedup key that ignores the court/year parenthetical (name + core cite),
   *  curly-vs-straight quotes and T6 spelling ("International" = "Int'l"). */
  dedupe: string;
  /** Document extent of the whole citation as matched (for Id. resolution). */
  start: number;
  end: number;
  /** Positional occurrences a locator search cannot find (members 2+ of a
   *  "§§ 102, 103" or "Patent Nos. A and B" list, and member 1's head). */
  spans?: Span[];
  /** Members of one list cite share a group number. */
  group?: number;
  /** For findPrecedingAuthority: the cite as one string when it is a list. */
  wholeText?: string;
}

/**
 * Builds a case Raw, splitting the italic name from the roman cite + (court year).
 * `verbatimCore` is the core cite exactly as the document spells it (whitespace
 * included), which is what a search has to look for.
 */
function caseRaw(
  rawName: string,
  coreCite: string,
  courtYear: string | undefined,
  verbatimCore: string,
  start: number,
  end: number,
  docket = "",
): Raw {
  const name = cleanCaseName(rawName);
  const cy = courtYear ? courtYear.replace(/\s+/g, " ").trim() : "";
  const dk = docket ? `${docket.replace(/\s+/g, " ").trim()}, ` : "";
  const rest = `, ${dk}${coreCite}${cy ? ` (${cy})` : ""}`;
  const locators = [coreCite]; // "573 U.S. 208" — appears verbatim even when the name is styled
  if (verbatimCore && verbatimCore !== coreCite) locators.push(verbatimCore);
  return {
    category: "cases",
    sortKey: foldQuotes(name).toLowerCase().replace(/^(in re|ex parte|in the matter of)\s+/, ""),
    name,
    rest,
    plain: `${name}${rest}`,
    html: `<i>${esc(name)}</i>, ${esc(dk)}${esc(coreCite)}${cy ? ` (${esc(cy)})` : ""}`,
    locator: coreCite,
    locators,
    dedupe: `cases|${foldQuotes(abbreviateCaseName(name)).toLowerCase()}|${coreCite.toLowerCase()}`,
    start,
    end,
  };
}

/** The verbatim text from the first group to the last (inclusive) inside a match. */
function verbatimBetween(m: RegExpExecArray, after: number, firstGroup: number, lastGroup: number): string {
  const s = m[0];
  const v = s.indexOf(m[firstGroup], after);
  if (v < 0) return "";
  let p = v + m[firstGroup].length;
  for (let g = firstGroup + 1; g <= lastGroup; g++) {
    if (!m[g]) continue;
    p = s.indexOf(m[g], p);
    if (p < 0) return "";
    if (g === lastGroup) return v < 0 ? "" : s.slice(v, p + m[g].length);
    p += m[g].length;
  }
  return "";
}

/** Collects every recognized authority from the text (with duplicates), plus
 *  what it deliberately refused. */
function collectAll(text: string): { raws: Raw[]; refusals: ToaRefusal[] } {
  const out: Raw[] = [];
  const refusals: ToaRefusal[] = [];
  let group = 0;
  let m: RegExpExecArray | null;

  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) {
    const reporter = normalizeReporter(m[3]);
    const core = `${m[2]} ${reporter}${m[4] ? ` (${m[4].replace(/\s+/g, " ")})` : ""} ${m[5]}`;
    out.push(caseRaw(m[1], core, m[6], verbatimBetween(m, m[1].length, 2, 5), m.index, m.index + m[0].length));
  }

  // Unpublished decisions (Westlaw / LexisNexis) — no reporter, still cases.
  UNPUB_RE.lastIndex = 0;
  while ((m = UNPUB_RE.exec(text))) {
    out.push(
      caseRaw(m[1], `${m[3]} ${m[4].replace(/['’]/g, "'")} ${m[5]}`, m[6], verbatimBetween(m, m[1].length + (m[2] ? m[2].length : 0), 3, 5), m.index, m.index + m[0].length, m[2] || ""),
    );
  }

  const plain = (
    category: ToaCategory,
    t: string,
    sortKey: string,
    start: number,
    end: number,
    extra: { span?: string; key?: string; spans?: Span[]; group?: number; wholeText?: string } = {},
  ): void => {
    const locators = [t];
    if (extra.span && extra.span !== t) locators.push(extra.span);
    out.push({
      category,
      sortKey,
      name: "",
      rest: t,
      plain: t,
      html: esc(t),
      locator: t,
      locators,
      dedupe: extra.key ?? `${category}|${foldQuotes(t).toLowerCase()}`,
      start,
      end,
      spans: extra.spans,
      group: extra.group,
      wholeText: extra.wholeText,
    });
  };

  // Statutes, regulations, MPEP: one row per listed section.
  const sections = (re: RegExp, category: ToaCategory, signGroup: number, prefixOf: (mm: RegExpExecArray) => (s: string) => string, sortOf: (mm: RegExpExecArray) => (s: string) => string): void => {
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      const lc = listedSections(text, mm, mm[signGroup], prefixOf(mm), sortOf(mm));
      if (lc.refusal) refusals.push(lc.refusal);
      const last = lc.spans[lc.spans.length - 1];
      const end = last.index + last.text.length;
      if (lc.texts.length === 1) {
        plain(category, lc.texts[0], lc.sortKeys[0], mm.index, end, { span: lc.spans[0].text });
      } else {
        group++;
        lc.texts.forEach((t, i) =>
          plain(category, t, lc.sortKeys[i], mm!.index, end, { spans: [lc.spans[i]], group, wholeText: lc.whole }),
        );
      }
      re.lastIndex = Math.max(re.lastIndex, end);
    }
  };
  sections(STATUTE_RE, "statutes", 2, (mm) => codeCite(mm[1], "U.S.C."), (mm) => (s) => `${mm[1].padStart(4, "0")} ${s}`);
  sections(CFR_RE, "regulations", 2, (mm) => codeCite(mm[1], "C.F.R."), (mm) => (s) => `${mm[1].padStart(4, "0")} ${s}`);

  // Patents: "No." is one row; "Nos. A and B" is a row per number.
  PATENT_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PATENT_RE.exec(text))) {
    const isApp = !!pm[1];
    const num = pm[3].replace(/[,/]+$/, "");
    const numIndex = pm.index + pm[0].indexOf(pm[3], pm[0].indexOf(pm[2]) + pm[2].length);
    const kind = pm[4] && num === pm[3] ? pm[4] : "";
    const headEnd = kind ? pm.index + pm[0].length : numIndex + num.length;
    const head = text.slice(pm.index, headEnd);
    if (pm[2] === "Nos." && !kind) {
      const more = readList(text, numIndex + num.length, PATNUM, "patent number");
      if (more.refusal) refusals.push(more.refusal);
      if (more.members.length) {
        group++;
        const all = [{ index: pm.index, text: head, num }, ...more.members.map((s) => ({ index: s.index, text: s.text, num: s.text }))];
        const end = all[all.length - 1].index + all[all.length - 1].text.length;
        for (const a of all) {
          const row = patentRow(a.num, isApp, "");
          plain("patents", row.text, row.sortKey, pm.index, end, { key: row.key, spans: [{ index: a.index, text: a.text }], group });
        }
        PATENT_RE.lastIndex = Math.max(PATENT_RE.lastIndex, end);
        continue;
      }
    }
    const row = patentRow(num, isApp, kind);
    plain("patents", row.text, row.sortKey, pm.index, headEnd, { key: row.key, span: head });
  }

  FEDREG_RE.lastIndex = 0;
  while ((m = FEDREG_RE.exec(text))) {
    const page = m[2].replace(/,+$/, ""); // "12,345, which …" — the comma is prose
    const span = m[0].slice(0, m[0].length - (m[2].length - page.length));
    plain("other", `${m[1]} Fed. Reg. ${page}`, `fedreg ${m[1].padStart(4, "0")}`, m.index, m.index + span.length, { span });
  }
  sections(MPEP_RE, "other", 1, () => (s) => `MPEP ${sectionSymbol(s)} ${s}`, () => (s) => `mpep ${s}`);

  // Federal rules — qualified "Fed. R. Civ. P. 19" form (authoritative).
  const ruleText = (abbr: string, num: string): { text: string; sortKey: string } => ({
    text: `Fed. R. ${RULE_ABBR[abbr]} P. ${num}`,
    sortKey: `${abbr.toLowerCase()} ${num.padStart(4, "0")}`,
  });
  RULE_RE.lastIndex = 0;
  while ((m = RULE_RE.exec(text))) {
    const r = ruleText(m[1], m[2]);
    plain("rules", r.text, r.sortKey, m.index, m.index + m[0].length);
  }
  // Bare "Rule 12(b)(7)" — trusted only in a document that also uses the
  // qualified Fed. R. Civ. P. form; then treated as a civil rule.
  if (HAS_FRCP_RE.test(text)) {
    // A bare rule number is a civil rule only when nothing in front of it says
    // otherwise. Without these guards a patent brief produced entries for rules
    // the drafter never cited: "a Rule 132 declaration" became
    // "Fed. R. Civ. P. 132", and "Local Rule 7.1" became "Fed. R. Civ. P. 7".
    BARE_RULE_RE.lastIndex = 0;
    while ((m = BARE_RULE_RE.exec(text))) {
      if (USPTO_PRACTICE_RULES.has(parseInt(m[1], 10))) continue;
      if (RULE_QUALIFIER_RE.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
      const r = ruleText("Civ", m[1]);
      plain("rules", r.text, r.sortKey, m.index, m.index + m[0].length);
    }
  }

  return { raws: out, refusals };
}

/** Collects every recognized authority from the text (with duplicates). */
function collect(text: string): Raw[] {
  return collectAll(text).raws;
}

/**
 * De-duplicates raws by their court/year-insensitive key, keeping the richest
 * occurrence (the one that carries the (court year) parenthetical), in first-
 * seen order.
 */
function dedupeBest(raws: Raw[]): Raw[] {
  const best = new Map<string, Raw>();
  const order: string[] = [];
  const spellings = new Map<string, string[]>();
  for (const r of raws) {
    const cur = best.get(r.dedupe);
    const seen = spellings.get(r.dedupe) ?? [];
    for (const l of r.locators) if (!seen.includes(l)) seen.push(l);
    spellings.set(r.dedupe, seen);
    // A case is "richer" only for carrying the (court year) parenthetical — a
    // longer SPELLING ("International" vs "Int'l") never displaces the first.
    const richer = (a: Raw, b: Raw): boolean =>
      a.category === "cases" ? /\)$/.test(a.rest) && !/\)$/.test(b.rest) : a.plain.length > b.plain.length;
    if (!cur) {
      best.set(r.dedupe, r);
      order.push(r.dedupe);
    } else if (richer(r, cur)) {
      best.set(r.dedupe, r);
    }
  }
  return order.map((k) => {
    const r = best.get(k)!;
    const all = spellings.get(k)!;
    // The kept entry's own locator stays first (it is what `locator` reports).
    return { ...r, locators: [r.locator, ...all.filter((l) => l !== r.locator)] };
  });
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
    groups.push({ category, heading: HEADINGS[category], entries: list.map((r) => ({ plain: r.plain, html: r.html, name: r.name, rest: r.rest })) });
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

/**
 * A page list: arabic and/or roman numerals separated by commas ("6, 8",
 * "iv, 13"), or Word's "passim" — which the `\p` switch that toaFieldsOoxml
 * emits prints for an authority cited on five or more pages. Rejecting it left
 * the MOST-cited authority with a blank page slot.
 */
const PAGE_LIST_RE = /^(?:passim|[ivxlcdm\d]+(?:\s*[,–—-]\s*[ivxlcdm\d]+)*(?:\s*,\s*passim)?)$/i;

/**
 * Parses page references out of a built Table of Authorities. Word renders each
 * TOA entry as "Authority Name<tab>p1, p2, …", so this reads the visible text
 * and returns a map from authority (via {@link toaEntryKey}) to its page string.
 * Only meaningful after the native TOA has been inserted and updated (F9);
 * returns an empty map otherwise.
 */
export function parseToaPages(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/[\r\n\v]+/)) {
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
  let lastHtmlHeading = "";
  for (const g of toa.groups) {
    // Patents fold into "Other Authorities"; don't repeat the heading when the
    // separate "other" group follows.
    const h = g.category === "patents" ? "Other Authorities" : g.heading;
    if (h !== lastHtmlHeading) {
      parts.push(`<p style="${font}"><b>${esc(h)}</b></p>`);
      lastHtmlHeading = h;
    }
    for (const e of g.entries) {
      const m = e.html.match(/^<i>([\s\S]*?)<\/i>,\s*([\s\S]*)$/);
      const style = `${font};margin-left:0.5in;text-indent:-0.5in`;
      parts.push(m ? `<p style="${style}"><i>${m[1]}</i>,<br>${m[2]}</p>` : `<p style="${style}">${e.html}</p>`);
    }
  }
  return parts.join("");
}

/**
 * Builds a fully-formatted **static** Table of Authorities as OOXML (not a Word
 * field), so the add-in controls every detail: Times New Roman 12, centered
 * bold-underlined title, bold category headings, and each case as two lines —
 * the italic name ending in a comma, then the reporter + (court year) on an
 * indented second line with a dot-leader right tab out to the page list. Word
 * fields can't produce this layout; OOXML renders it exactly.
 *
 * @param pages optional map (from {@link parseToaPages}) of authority → page list.
 */
export function toaStaticOoxml(toa: TableOfAuthorities, pages?: Map<string, string>): string {
  const TAB = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>';
  const pageOf = (e: ToaEntry): string => {
    if (!pages) return "";
    return pages.get(toaEntryKey(e.plain)) ?? pages.get(toaEntryKey(e.plain.replace(/\s*\([^)]*\)\s*$/, ""))) ?? "";
  };
  const t = (s: string): string => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
  const run = (rpr: string, inner: string): string => `<w:r><w:rPr>${rpr}</w:rPr>${inner}</w:r>`;

  const heading = (h: string): string =>
    `<w:p><w:pPr><w:spacing w:before="120" w:after="60"/><w:rPr>${RPR_HEADING}</w:rPr></w:pPr>${run(RPR_HEADING, t(h))}</w:p>`;

  const entryPara = (e: ToaEntry): string => {
    const pPr = `<w:pPr><w:ind w:left="720" w:hanging="720"/>${TAB}<w:spacing w:after="120"/><w:rPr>${RPR_BASE}</w:rPr></w:pPr>`;
    const pageRun = run(RPR_BASE, `<w:tab/>${t(pageOf(e))}`);
    if (e.name) {
      const cite = e.rest.replace(/^,\s*/, "");
      return `<w:p>${pPr}${run(`${RPR_BASE}<w:i/><w:iCs/>`, t(`${e.name},`))}${run(RPR_BASE, `<w:br/>${t(cite)}`)}${pageRun}</w:p>`;
    }
    return `<w:p>${pPr}${run(RPR_BASE, t(e.plain))}${pageRun}</w:p>`;
  };

  const body = [titlePara("TABLE OF AUTHORITIES")];
  let lastHeading = "";
  for (const g of toa.groups) {
    // Patents fold into "Other Authorities"; emit that heading once even when a
    // separate "other" group follows (avoids two consecutive identical headings).
    const h = g.category === "patents" ? "Other Authorities" : g.heading;
    if (h !== lastHeading) {
      body.push(heading(h));
      lastHeading = h;
    }
    for (const e of g.entries) body.push(entryPara(e));
  }
  return wrapOoxml(body.join(""));
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
  // The same scanner (and the same §§-list grammar) as the table, so the
  // Insert-Id. confirmation and the TOA can never disagree about a cite.
  let best: Raw | null = null;
  for (const r of collect(text)) if (!best || r.start > best.start) best = r;
  if (!best) return null;
  const b: Raw = best;
  const plain = b.wholeText ?? (b.category === "cases" ? `${b.name}, ${b.locator}` : b.plain);
  return { plain, category: b.category };
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
  /**
   * Every verbatim spelling of the authority in the document, `locator` first
   * ("U.S. Patent No. 7,469,381" and "U.S. Patent No. 7469381"; a curly- and a
   * straight-apostrophe cite). {@link toaOccurrences} searches all of them.
   * Optional so a hand-built mark still works (then only `locator` is used).
   */
  locators?: string[];
  /** The scanner's identity for this authority. {@link toaOccurrences} uses it
   *  to place list members ("§§ 102, 103") that no locator search can find. */
  key?: string;
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
    locators: r.locators,
    key: r.dedupe,
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

// --- short forms -------------------------------------------------------------
//
// WHY THIS EXISTS
// The native TOA marked only FULL-form citations, because it searched the
// document for each authority's full core cite. So a brief citing Alice in full
// on page 4, then as "Alice, 573 U.S. at 216" on 9, 11 and 14, and as "Id. at
// 217" on 15, produced a table listing page 4 alone.
//
// That table LOOKS finished. Under most local rules an incomplete page list is a
// defective TOA, and this is the single job Best Authority is bought for.

// caseShortName (the party a short form uses, Rule 10.9) lives in citations.ts
// and is re-exported at the top of this file.

export interface ToaOccurrence {
  /** Character offset in the source text. */
  index: number;
  /** The exact substring to mark. */
  text: string;
  /** Index into the `marks` array this occurrence belongs to. */
  markIndex: number;
  kind: "full" | "short" | "id";
  /** Members of one list cite ("§§ 102, 103") share a group number. */
  group?: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A regex source for `s` in which every apostrophe matches ' ’ or ‘. */
function quoteFlexible(escaped: string): string {
  return escaped.replace(/['’‘]/g, "['’‘]");
}

/**
 * A whole-cite regex for a locator: it may not begin right after a letter or
 * digit, nor end right before one — nor before ".97" / ",345", which continue a
 * number. "10 F.3d 5" is not a hit inside "110 F.3d 512", nor "35 U.S.C. § 10"
 * inside "§ 101", nor "§ 1" inside "§ 1.97".
 */
function wholeCiteRe(locator: string): RegExp {
  const startsAlnum = CITE_CHAR.test(locator.charAt(0));
  const endsAlnum = CITE_CHAR.test(locator.charAt(locator.length - 1));
  return new RegExp(
    (startsAlnum ? `(?<!${CITE_CHAR.source})` : "") +
      quoteFlexible(escapeRe(locator)) +
      (endsAlnum ? `(?!${CITE_CHAR.source}|[.,]\\d)` : ""),
    "g",
  );
}

/** A letter or digit — a character that would continue a cite. */
const CITE_CHAR = /[A-Za-z0-9À-ÖØ-öø-ÿ]/;

/** A Bluebook signal (Rule 1.2) right before a lowercase "id." ("See id. at 5"). */
const ID_SIGNAL_BEFORE =
  /(?:^|[^A-Za-z])(?:[Ss]ee(?:\s+also|\s+generally|,\s+e\.g\.,)?|[Cc]f\.|[Aa]ccord|[Bb]ut\s+(?:see|cf\.)|[Cc]ompare|[Cc]ontra|e\.g\.,)\s+$/;

/**
 * A citation the table does not list, in the text between an Id. and the
 * occurrence before it: record cites (Appx12, J.A. 34, A123, ECF No., Dkt.,
 * Ex. 5), a patent column / line cite or "'381 patent", a "(… 2010)" date
 * parenthetical (treatises, articles, unrecognised cases), "vol Name page",
 * supra / infra, a bare § or ¶, or an "at N" pincite. If one is there, that is
 * what the Id. refers to (Rule 4.1) — so it is not given to the earlier authority.
 */
const UNREAD_CITATION =
  /\bAppx\.?\s?\d|\bJ\.\s?A\.\s?\d|\bS\.\s?A\.\s?\d|\bECF\b|\bDkt\.?(?:\s|$)|\bD\.I\.\s?\d|\bEx\.\s?\d|\bA\d{2,}\b|\bR\.\s?\d|['’‘]\d{3}\s+(?:patent|pat\.)|\bcol(?:umn|s?\.)\s*\d|\bll?\.\s*\d|\b\d+\s+[A-Z][A-Za-z.'’&]*(?:\s+[A-Z][A-Za-z.'’&]*){0,5}\s+\d+|\([^()]*\b(?:1[6-9]|20)\d{2}\)|\bsupra\b|\binfra\b|§|¶|\bat\s+\*?\d/;

/** The short names a case can be cited by: caseShortName's choice, plus the
 *  leading word of the other party (vol + reporter + "at" already pin the case,
 *  so "Myriad, 569 U.S. at 590" is found for "Ass’n … v. Myriad Genetics"). */
function caseShortCandidates(name: string): string[] {
  const out: string[] = [];
  const s = caseShortName(name);
  if (s) out.push(s);
  const parts = name.split(/\s+v\.\s+/);
  if (parts.length === 2) {
    for (const p of parts) {
      const w = p.trim().split(/\s+/)[0].replace(/[^\wÀ-ÖØ-öø-ÿ'’-]/g, "");
      if (w.length >= 3 && !out.includes(w) && !/^(?:United|State|People|Commissioner|Comm['’]r|Secretary|Director)$/i.test(w)) out.push(w);
    }
  }
  return out;
}

/**
 * Every place each authority is cited — {@link toaOccurrenceReport} without the
 * refusals.
 */
export function toaOccurrences(text: string, marks: ToaMark[]): ToaOccurrence[] {
  return toaOccurrenceReport(text, marks).occurrences;
}

/**
 * Every place each authority is cited — full form, short form and `Id.` — and,
 * by name, every Id. (or list member) deliberately NOT placed.
 *
 * `Id.` refers to the IMMEDIATELY preceding citation (Rule 4.1). It is placed
 * only when that citation is a listed authority; it is refused (reported, never
 * guessed) when the citation before it is one the table does not list (record
 * cite, patent column cite, treatise …), a string cite of several authorities,
 * a "§§" list, a refused Id., or nothing at all. An authority inside a
 * parenthetical ("(quoting Mayo …)") is skipped: the Id. refers to the citing
 * case. "Id. § 102" goes to the § 102 row of the same code, or is refused.
 */
export function toaOccurrenceReport(
  text: string,
  marks: ToaMark[],
): { occurrences: ToaOccurrence[]; refused: ToaRefusal[] } {
  const found: ToaOccurrence[] = [];
  const { raws, refusals } = collectAll(text);
  const refused: ToaRefusal[] = [...refusals];

  // List members ("§§ 102, 103"; "Patent Nos. A and B") are placed by position.
  const byKey = new Map<string, number>();
  marks.forEach((mk, i) => {
    if (mk.key && !byKey.has(mk.key)) byKey.set(mk.key, i);
  });
  for (const r of raws) {
    if (!r.spans) continue;
    const mi = byKey.get(r.dedupe);
    if (mi === undefined) continue;
    for (const s of r.spans) found.push({ index: s.index, text: s.text, markIndex: mi, kind: "full", group: r.group });
  }

  // "'381 patent" short names, only where the three digits name ONE patent.
  const patentShort = new Map<string, number[]>();
  marks.forEach((mk, i) => {
    if (mk.category !== "patents") return;
    const d = patentShortDigits(mk.long);
    if (d) patentShort.set(d, [...(patentShort.get(d) ?? []), i]);
  });

  marks.forEach((mark, markIndex) => {
    // Full form: every occurrence of every verbatim spelling of the core cite,
    // not merely the first — and only as a WHOLE cite (see wholeCiteRe).
    const spellings = (mark.locators && mark.locators.length ? mark.locators : [mark.locator]).filter(Boolean);
    for (const loc of spellings) {
      const re = wholeCiteRe(loc);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        found.push({ index: m.index, text: m[0], markIndex, kind: "full" });
      }
    }

    // Short form: "Alice, 573 U.S. at 216"; "Wands, 858 F.2d at 740" for In re Wands.
    const lm = /^(\d+)\s+(.+?)\s+(\d+)$/.exec(mark.locator || "");
    if (lm) {
      const vol = lm[1];
      const reporter = lm[2];
      for (const short of caseShortCandidates(mark.name)) {
        const re = new RegExp(
          `(?<!${CITE_CHAR.source})` +
            quoteFlexible(escapeRe(short)) +
            "[^,\\n]{0,40}?,\\s*" +
            escapeRe(vol) +
            "\\s+" +
            escapeRe(reporter) +
            "\\s+at\\s+\\d+(?:[-\\u2013]\\d+)?",
          "g",
        );
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          found.push({ index: m.index, text: m[0], markIndex, kind: "short" });
        }
      }
    }

    // "the '381 patent" — but not the "(the '381 patent)" that DEFINES the short
    // name right after the full cite, which is the same citation.
    const d = mark.category === "patents" ? patentShortDigits(mark.long) : null;
    if (d && patentShort.get(d)?.length === 1) {
      const re = new RegExp(`(?<![\\w])['’‘]${d}\\s+patent\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (/\(\s*(?:the\s+)?["“]?$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) continue;
        found.push({ index: m.index, text: m[0], markIndex, kind: "short" });
      }
    }
  });

  // Drop an occurrence contained inside another: a short cite's reporter span
  // can sit inside a longer full-form match.
  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const kept: ToaOccurrence[] = [];
  for (const o of found) {
    const last = kept[kept.length - 1];
    if (last && o.index < last.index + last.text.length) continue;
    kept.push(o);
  }

  // "Id." — capitalised, or lowercase "id." straight after a signal ("See id.
  // at 5", Rule 4.1). Never the "id." that ends "said." / "paid." / "valid.".
  // "Id. § 102(a)" keeps its section (it names a different authority).
  const idRe = /(?<![A-Za-z0-9])[Ii]d\.(?:\s+at\s+\d+(?:[-–]\d+)?|\s+§{1,2}\s*\d[\w.()–—\-]*)?/g;
  const ids: Array<{ index: number; text: string }> = [];
  let im: RegExpExecArray | null;
  while ((im = idRe.exec(text)) !== null) {
    if (im[0].startsWith("id.") && !ID_SIGNAL_BEFORE.test(text.slice(Math.max(0, im.index - 24), im.index))) continue;
    ids.push({ index: im.index, text: /§/.test(im[0]) ? trimSection(im[0]) : im[0] });
  }

  // Everything the scanner READ, blanked out of the text, so what is left
  // between an Id. and the citation before it is only what it did not read.
  const covered = new Uint8Array(text.length);
  const cover = (a: number, b: number): void => {
    for (let i = Math.max(0, a); i < Math.min(text.length, b); i++) covered[i] = 1;
  };
  for (const r of raws) cover(r.start, r.end);
  for (const o of kept) cover(o.index, o.index + o.text.length);
  for (const i of ids) cover(i.index, i.index + i.text.length);
  const residual = (a: number, b: number): string => {
    let s = "";
    for (let i = a; i < b; i++) s += covered[i] ? " " : text[i];
    return s;
  };
  const unread = (a: number, b: number): boolean => UNREAD_CITATION.test(residual(a, b));
  const depth = (a: number, b: number): number => {
    let d = 0;
    for (let i = a; i < b; i++) d += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    return d;
  };
  const end = (o: ToaOccurrence): number => o.index + o.text.length;

  const all: ToaOccurrence[] = [
    ...kept,
    ...ids.map((i) => ({ index: i.index, text: i.text, markIndex: -1, kind: "id" as const })),
  ];
  all.sort((a, b) => a.index - b.index);

  const resolved: Array<{ o: ToaOccurrence; mark: number }> = [];
  const out: ToaOccurrence[] = [];

  /** The mark an Id. refers to, or the reason it is refused. */
  const resolveId = (o: ToaOccurrence): number | string => {
    if (!resolved.length) return "no citation precedes it";
    const p = resolved[resolved.length - 1];
    if (unread(end(p.o), o.index)) {
      return "the citation right before it (a record cite, patent column, treatise or other source the table does not list) is what it refers to (Rule 4.1)";
    }
    let target: number;
    if (p.o.kind === "id") {
      if (p.mark < 0) return "it follows an Id. that was not placed";
      target = p.mark;
    } else {
      // Step out of a parenthetical: in "Alice … (quoting Mayo …). Id." the Id.
      // refers to Alice, the citing case.
      let k = resolved.length - 1;
      while (k > 0 && resolved[k - 1].o.kind !== "id" && depth(end(resolved[k - 1].o), resolved[k].o.index) > 0) k--;
      const e = resolved[k];
      if (e.o.group !== undefined && resolved.some((r) => r.o.group === e.o.group && r.mark !== e.mark)) {
        return "it follows a list of several authorities, so it does not name one (Rule 4.1)";
      }
      if (k > 0) {
        const seg = residual(end(resolved[k - 1].o), e.o.index);
        const semi = seg.lastIndexOf(";");
        if (semi >= 0 && !/[.!?]["”’)]*\s+[A-Z]/.test(seg.slice(semi))) {
          return "it follows a string citation of several authorities, so it does not name one (Rule 4.1)";
        }
      }
      target = e.mark;
      if (target < 0) return "it follows an Id. that was not placed";
    }
    const sm = /§{1,2}\s*(.+)$/.exec(o.text);
    if (sm) {
      const head = /^(.*?)\s§§?\s/.exec(marks[target]?.long ?? "");
      if (!head || !/U\.S\.C\.|C\.F\.R\.|^MPEP$/.test(head[1])) return "Id. § … follows an authority that has no sections";
      const sec = normalizeSection(sm[1]);
      const cands = [sec, sec.replace(/\(.*$/, "")];
      const hit = marks.findIndex((mk) => cands.some((c) => mk.long === `${head[1]} ${sectionSymbol(c)} ${c}`));
      if (hit < 0) return `Id. ${sm[0]} names a section that is not in the table`;
      target = hit;
    }
    return target;
  };

  for (const o of all) {
    if (o.kind !== "id") {
      resolved.push({ o, mark: o.markIndex });
      out.push(o);
      continue;
    }
    const r = resolveId(o);
    if (typeof r === "string") {
      refused.push({ index: o.index, text: o.text, reason: `Not placed: ${r}.` });
      resolved.push({ o, mark: -1 });
    } else {
      resolved.push({ o, mark: r });
      out.push({ ...o, markIndex: r });
    }
  }
  refused.sort((a, b) => a.index - b.index);
  return { occurrences: out, refused };
}

// --- pane helpers: placing TA fields without Word's substring search ---------
//
// WHY THESE EXIST
// The pane marks the TOA by `body.search(needle)`, which is a SUBSTRING search:
// "10 F.3d 5" also hits inside "110 F.3d 512" (Doe v. Roe got Smith v. Jones's
// pages), and "Id." with matchCase:false hits the "id." in "said." / "paid.".
// toaOccurrences already knows exactly WHERE each cite is; these helpers turn
// that into something Office.js can act on — Word returns search hits as ranges
// in document order, not offsets, so the plan is ORDINAL: "the k-th hit of this
// needle belongs to mark m, or is skipped".

/** The Word search options every step of a {@link taSearchPlan} assumes. */
export const TA_SEARCH_OPTIONS = { matchCase: true, matchWholeWord: false, matchWildcards: false } as const;

/** Word's search refuses needles over 255 characters; stay under it. */
const WORD_SEARCH_MAX = 240;

export interface TaSearchStep {
  /** The exact text to pass to `body.search`. */
  needle: string;
  /** The options to pass with it (always {@link TA_SEARCH_OPTIONS}). */
  options: typeof TA_SEARCH_OPTIONS;
  /** How many hits Word should return. If it returns a different number, the
   *  document and the scanned text disagree: skip this needle and report it. */
  expectedHits: number;
  /** `assign[k]` = the mark index for the k-th hit in document order, or
   *  `null` to leave that hit alone (a substring of a longer cite, the "id." in
   *  "said.", or a hit owned by another step's needle). */
  assign: Array<number | null>;
}

export interface TaSearchPlan {
  steps: TaSearchStep[];
  /** Occurrences that cannot be searched for (needle too long for Word). */
  unplaced: ToaOccurrence[];
}

/**
 * Turns {@link toaOccurrences} into an ordinal Word-search plan. Hits are
 * counted the way Word's Find counts them with {@link TA_SEARCH_OPTIONS}:
 * case-sensitive, non-overlapping, left to right, with straight and curly
 * quotes treated as the same character. Each hit is assigned to the occurrence
 * that starts at exactly that offset with exactly that text, or skipped.
 *
 * Because ownership is per HIT rather than per needle, an "Id." that means Alice
 * on page 3 and Mayo on page 9 is now placed under both, instead of being
 * written off as unattributed.
 */
export function taSearchPlan(text: string, occurrences: ToaOccurrence[]): TaSearchPlan {
  const folded = foldQuotes(text);
  const byNeedle = new Map<string, ToaOccurrence[]>();
  for (const o of occurrences) {
    const list = byNeedle.get(o.text) ?? [];
    list.push(o);
    byNeedle.set(o.text, list);
  }
  const steps: TaSearchStep[] = [];
  const unplaced: ToaOccurrence[] = [];
  for (const [needle, occ] of byNeedle) {
    if (!needle || needle.length > WORD_SEARCH_MAX) {
      unplaced.push(...occ);
      continue;
    }
    const fn = foldQuotes(needle);
    const owner = new Map<number, number>();
    for (const o of occ) owner.set(o.index, o.markIndex);
    const assign: Array<number | null> = [];
    const placed = new Set<number>();
    for (let at = folded.indexOf(fn); at !== -1; at = folded.indexOf(fn, at + fn.length)) {
      const m = owner.get(at);
      // Same offset AND the same verbatim text: a curly-apostrophe needle's hit
      // on a straight-apostrophe occurrence belongs to that occurrence's step.
      if (m !== undefined && text.slice(at, at + needle.length) === needle) {
        assign.push(m);
        placed.add(at);
      } else {
        assign.push(null);
      }
    }
    for (const o of occ) if (!placed.has(o.index)) unplaced.push(o);
    steps.push({ needle, options: TA_SEARCH_OPTIONS, expectedHits: assign.length, assign });
  }
  return { steps, unplaced };
}

/**
 * True if a found range is a WHOLE cite rather than part of a longer one —
 * for a caller that has the range's neighbouring text instead of a plan.
 * `before` / `after` are the characters immediately before / after the hit
 * (any length; only the nearest one or two are read).
 *
 * A hit that starts with a letter/digit may not follow one; a hit that ends
 * with one may not precede one, nor precede ".9" / ",9" (a dotted or grouped
 * number continuing: "§ 1" in "§ 1.97", "Reg. 12" in "Reg. 12,345").
 */
// Not exported: the pane places TA fields with taSearchPlan, which decides
// ownership by offset and needs neither predicate (v2.141.0 integration).
function isWholeCiteHit(before: string, hit: string, after: string): boolean {
  if (!hit) return false;
  const b = before.charAt(before.length - 1);
  if (CITE_CHAR.test(hit.charAt(0)) && b && CITE_CHAR.test(b)) return false;
  const last = hit.charAt(hit.length - 1);
  if (CITE_CHAR.test(last)) {
    const a0 = after.charAt(0);
    if (a0 && CITE_CHAR.test(a0)) return false;
    if (/\d/.test(last) && /[.,]/.test(a0) && /\d/.test(after.charAt(1))) return false;
  }
  return true;
}

/**
 * True if a found "Id." range is a genuine Id. citation: "Id." capitalised, or
 * lowercase "id." straight after a signal ("See id."), and not the tail of a
 * word ("said.", "paid.", "valid."). `before` / `after` as in
 * {@link isWholeCiteHit}; pass at least ~24 characters of `before` so the
 * signal test can see "See also ".
 */
// Not exported (see isWholeCiteHit); kept for a caller that has a range's
// neighbours instead of a plan.
function isIdHit(before: string, hit: string, after: string): boolean {
  if (/^Id\./.test(hit)) return isWholeCiteHit(before, hit, after);
  if (/^id\./.test(hit) && ID_SIGNAL_BEFORE.test(before)) return isWholeCiteHit(before, hit, after);
  return false;
}

/** Plain-text rendering of a citation register (for display and copying). */
export function registerToText(reg: CitationRegister, pages: Map<string, string>): string {
  const pg = (plain: string): string => {
    const p = pages.get(toaEntryKey(plain));
    return p ? `  — p. ${p}` : "";
  };
  const head = `Found ${reg.authorities} authorit${reg.authorities === 1 ? "y" : "ies"} in ${reg.citations} citation${reg.citations === 1 ? "" : "s"}.`;
  const lines = [pages.size ? head : head + " (build the field-based TOA and press F9, then Find again to see pages)"];
  if (reg.repeated.length) {
    lines.push("", `Cited more than once (${reg.repeated.length}):`);
    for (const e of reg.repeated) lines.push(`  ${e.plain}  ×${e.count}${pg(e.plain)}`);
  }
  let lastHeading = "";
  lines.push("", "All authorities:");
  for (const e of reg.entries) {
    if (e.heading !== lastHeading) {
      lines.push(`— ${e.heading} —`);
      lastHeading = e.heading;
    }
    lines.push(`  ${e.plain}  ×${e.count}${pg(e.plain)}`);
  }
  return lines.join("\n");
}
