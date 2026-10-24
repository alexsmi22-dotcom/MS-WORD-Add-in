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
  groupDigitsRule62,
  isCaseNameAbbreviation,
  isKnownReporter,
  normalizeReporter,
  sectionSymbol,
} from "./citations";

// One short-name implementation for the form button and the TOA scan (Rule
// 10.9); it lives in citations.ts so that file never has to import this one.
export { caseShortName };

export type ToaCategory = "cases" | "constitutional" | "statutes" | "rules" | "regulations" | "patents" | "other";

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
  /** What the scan saw but deliberately did not list, each with its reason
   *  (absent when nothing was skipped). */
  refused?: ToaRefusal[];
}

const HEADINGS: Record<ToaCategory, string> = {
  cases: "Cases",
  constitutional: "Constitutional Provisions",
  statutes: "Statutes",
  rules: "Rules",
  regulations: "Regulations",
  patents: "Patents",
  other: "Other Authorities",
};

// FRAP 28(a)(3) order: cases, statutes, and other authorities. Rules follow
// statutes; patents fold in just before the catch-all "Other Authorities".
// Constitutional provisions sit between cases and statutes (the usual brief
// order; Word's built-in TOA category 7).
const ORDER: ToaCategory[] = ["cases", "constitutional", "statutes", "rules", "regulations", "patents", "other"];

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
// …unless the segment itself ENDS in a corporate word: "Becton, Dickinson & Co.
// v. Tyco" is one party, and dropping "Becton," filed it under D. A transition
// word never ends in "Co." / "Inc." (and LEADING_INTRO_RE strips "However, ").
const CORP_WORD = "(?:Co|Cos|Corp|Inc|Ltd|LLC|L\\.L\\.C|LLP|L\\.P|LP|Grp|Bros|Sons)\\.?";
// The segment must also carry an "&" (Becton, Dickinson & Co.; Sears, Roebuck &
// Co.): "Second, Dow Chem. Co. v. …" is a transition word, not a firm name.
const FIRMSEG_CORP = `[${UP}]${WORDCH}*(?:${HS}[${UP}]${WORDCH}*)?${HS}&(?:${HS}[${UP}]${WORDCH}*)?${HS}${CORP_WORD}(?=${HS}vs?\\.)`;
const FIRMTAIL = `(?:,${HS}(?:${FIRMSEG_CORP}|${FIRMSEG}(?!${HS}vs?\\.))){0,4}`;
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
  // Never from the middle of a word (that also kept a 5 kB run of capitals
  // from costing a full rescan per letter).
  `|(?<![A-Za-zÀ-ÖØ-öø-ÿ])[${UP}]${WORDCH}*)`;
const PARTY = `${PARTY_HEAD}(?:${HS}${NAMEWORD}){0,7}${FIRMTAIL}${CORP}`;
// "v." (and the non-Bluebook "vs.", which drafters paste; it is shown as "v.").
const CASE_NAME = `(?:${PARTY}${HS}vs?\\.${HS}${PARTY}|(?:In re|Ex parte|In the Matter of)${HS}${PARTY})`;
// An optional pincite ("573 U.S. 208, 216" or "…, 205–09 n.4") that may sit
// between the first-page cite and the "(court year)" parenthetical.
const PINCITE = "(?:,\\s*\\d+(?:[–—-]\\d+)?(?:\\s*n\\.\\s*\\d+)?)*";
// The "(court year)" parenthetical that closes a full citation, e.g. "(2014)",
// "(Fed. Cir. 2008)", "(D. Mass. 2025)", "(1829)". Any year from 1600 on.
// Up to three parallel cites ("573 U.S. 208, 134 S. Ct. 2347, 189 L. Ed. 2d 296
// (2014)", "50 Cal. App. 4th 100, 57 Cal. Rptr. 2d 1 (1996)") may sit before the
// parenthetical (fix2: the year was lost and the parallel cite reported as
// unclassifiable). The table lists the first cite, as Rule 10.3.1 prefers.
const PARALLEL = `(?:,\\s*\\d+\\s+(?:${REPORTER_ALT})\\s+\\d+(?![\\w])${PINCITE}){0,3}`;
const YEAR_PAREN = `(?:${PINCITE}${PARALLEL}\\s*\\(([^)]{0,45}(?:1[6-9]|20)\\d{2}[a-z]?)\\))?`;
// Early U.S. Reports carry the nominative reporter: "56 U.S. (15 How.) 62".
const NOMINATIVE = "(?:\\s*\\((\\d+\\s+[A-Z][A-Za-z.]*(?:\\s+[A-Z][A-Za-z.]*)?)\\))?";
// Groups: 1 name, 2 vol, 3 reporter, 4 nominative, 5 page, 6 (court year).
// The page may not run into a letter: "10 F. 3d 5" is never "10 F. 3".
const CASE_RE = new RegExp(
  `(${CASE_NAME}),\\s+(\\d+)\\s+(${REPORTER_ALT})${NOMINATIVE}\\s+(\\d+)(?![\\w])${YEAR_PAREN}`,
  "g",
);

// Subsequent history right after a full case cite (Rule 10.7, T8 phrases),
// sticky at the cite's end: 1 the phrase, 2 vol, 3 reporter, 4 page,
// 5 (court year). "sub nom." takes a bounded name with no comma-free blowup.
const HISTORY_PHRASE =
  "(?:aff['’]d|rev['’]d|vacated|modified|cert\\.\\s+(?:denied|granted|dismissed)|reh['’]g(?:\\s+en\\s+banc)?\\s+denied|appeal\\s+dismissed|overruled\\s+by)(?:\\s+in\\s+part)?(?:\\s+mem\\.)?";
const HISTORY_RE = new RegExp(
  `,[ \\t\\u00a0]*(${HISTORY_PHRASE}(?:,[ \\t\\u00a0]*${HISTORY_PHRASE})?(?:[ \\t\\u00a0]+on[ \\t\\u00a0]+other[ \\t\\u00a0]+grounds)?(?:[ \\t\\u00a0]+sub[ \\t\\u00a0]+nom\\.[ \\t\\u00a0]+[^,()\\n]{1,120})?),[ \\t\\u00a0]+(\\d+)[ \\t\\u00a0]+(${REPORTER_ALT})[ \\t\\u00a0]+(\\d+)(?![\\w])(?:,[ \\t\\u00a0]*\\d+(?:[–—-]\\d+)?)?[ \\t\\u00a0]*\\(([^)]{0,45}(?:1[6-9]|20)\\d{2})\\)`,
  "y",
);

// Unpublished decisions: "Name, [No. …,] YEAR <db> NUMBER" where <db> is a
// commercial database (Westlaw / LexisNexis). These carry no reporter, so they
// are matched separately but classified as cases. The docket number is part of
// the cite (Rule 10.8.1(a)) and is kept.
// Groups: 1 name, 2 docket, 3 year, 4 database, 5 number, 6 (court date).
// Westlaw, Bloomberg Law ("2021 BL 12345") and any "<court words> LEXIS"
// ("U.S. Dist. LEXIS", "Pat. App. LEXIS"). Each LEXIS prefix token holds no
// space, so the split is unique; at most four tokens.
const UNPUB_DB = "WL|BL|WESTLAW|(?:[A-Z][A-Za-z.'’]*\\s+){0,4}LEXIS";
const UNPUB_RE = new RegExp(
  `(${CASE_NAME}),\\s+(?:((?:(?:Civ\\.|Civil\\s+Action|Case|Appeal)\\s+)?Nos?\\.\\s+[^,]+),\\s+)?(\\d{4})\\s+(${UNPUB_DB})\\s+(\\d+)(?:,?\\s*(?:at\\s*\\*\\d+\\s*)?\\(([^)]{0,45}(?:1[6-9]|20)\\d{2})\\))?`,
  "g"
);

// PTAB / BPAI decisions (listed with the cases, as briefs list them): "Apple
// Inc. v. Fintiv, Inc., IPR2020-00019, Paper 11, at 5 (P.T.A.B. Mar. 20, 2020)",
// "Ex parte Smith, Appeal No. 2019-001234 (P.T.A.B. Jan. 2, 2020)".
// Groups: 1 name, 2 proceeding no., 3 paper, 4 (tribunal date).
const PTAB_RE = new RegExp(
  `(${CASE_NAME}),\\s+((?:IPR|PGR|CBM|DER)\\d{4}-\\d{5}|Appeal\\s+No\\.\\s+\\d{4}-\\d{4,6})(?:,\\s+(Paper\\s+(?:No\\.\\s+)?\\d+))?(?:,\\s*\\d{4}\\s+(?:WL|BL)\\s+\\d+)?(?:,?\\s*at\\s+\\d+(?:[–—-]\\d+)?)?\\s*\\(((?:P\\.\\s?T\\.\\s?A\\.\\s?B\\.|PTAB|B\\.\\s?P\\.\\s?A\\.\\s?I\\.|BPAI)[^()]{0,30}(?:19|20)\\d{2})\\)`,
  "g",
);

// Constitutional provisions (Rule 11): "U.S. Const. art. I, § 8, cl. 8",
// "U.S. Const. amend. XIV, § 1", "U.S. Const. pmbl.", "Cal. Const. art. I, § 7".
// Groups: 1 jurisdiction, 2 "art."/"amend.", 3 roman number, 4 §, 5 cl., or
// 6 "pmbl.".
const CONST_RE =
  /(?<![\w.])(U\.\s?S\.|[A-Z]\.\s?[A-Z]\.|[A-Z][a-z]{1,6}\.(?:\s[A-Z][a-z]{0,6}\.)?)\s+Const\.\s+(?:(art\.|amend\.)\s+([IVXL]{1,7}|\d{1,2})(?![\w])(?:,\s*§\s*(\d{1,3}))?(?:,\s*cl\.\s*(\d{1,3}))?|(pmbl\.))/g;

// Session laws: "Pub. L. No. 112-29, § 3, 125 Stat. 284, 285 (2011)", with the
// act's name when it is written in front. Groups: 1 name, 2 law no., 3 vol,
// 4 page, 5 year. The name is capitalised words and short connectors only.
const ACT_WORD = "(?:[A-Z][\\w'’.\\-]*|of|the|and|for|to|on|in|&|(?:17|18|19|20)\\d{2})";
const PUBL_RE = new RegExp(
  `(?:(?<![\\w'’.\\-])([A-Z][\\w'’.\\-]*(?:[ \\t\\u00a0]+${ACT_WORD}){0,9}),[ \\t\\u00a0]+)?Pub\\.\\s?L\\.\\s+No\\.\\s+(\\d{1,3}[-–]\\d{1,4})(?:,\\s*§{1,2}\\s*[\\w.()]+)?(?:,\\s*(\\d{1,3})\\s+Stat\\.\\s+(\\d[\\d,]*\\d|\\d)(?:,\\s*\\d[\\d,]*)?)?(?:\\s*\\(((?:17|18|19|20)\\d{2})\\))?`,
  "g",
);
const STAT_RE = /\b(\d{1,3})\s+Stat\.\s+(\d[\d,]*\d|\d)/g;

// State codes (T1 abbreviations): "Cal. Civ. Proc. Code § 425.16", "Fla. Stat.
// § 768.79", "N.Y. Gen. Bus. Law § 349", "Tex. Civ. Prac. & Rem. Code Ann.
// § 16.003", "Del. Code Ann. tit. 8, § 102". Groups: 1 the code name, 2 §, 3 section.
const STATE_ABBR =
  "Ala\\.|Alaska|Ariz\\.|Ark\\.|Cal\\.|Colo\\.|Conn\\.|Del\\.|D\\.C\\.|Fla\\.|Ga\\.|Haw\\.|Idaho|Ill\\.|Ind\\.|Iowa|Kan\\.|Ky\\.|La\\.|Me\\.|Md\\.|Mass\\.|Mich\\.|Minn\\.|Miss\\.|Mo\\.|Mont\\.|Neb\\.|Nev\\.|N\\.H\\.|N\\.J\\.|N\\.M\\.|N\\.Y\\.|N\\.C\\.|N\\.D\\.|Ohio|Okla\\.|Or\\.|Pa\\.|R\\.I\\.|S\\.C\\.|S\\.D\\.|Tenn\\.|Tex\\.|Utah|Vt\\.|Va\\.|Wash\\.|W\\. Va\\.|Wis\\.|Wyo\\.";
/**
 * States whose codes number sections with hyphens (title-section or title-chapter-section, Bluebook T1): "Ala. Code
 * § 6-2-38", "Ariz. Rev. Stat. Ann. § 12-341", "Va. Code Ann. § 8.01-243", "N.J. Stat. Ann. § 2A:14-1". There a
 * hyphen is inside the section number. The others (Cal., N.Y., Tex., Fla., Ohio, Mich., Wash., …) number plainly or
 * with dots, so a hyphen between two numbers is a range.
 */
const HYPHEN_SECTION_STATE_RE =
  /^(?:Ala\.|Ariz\.|Ark\.|Colo\.|Conn\.|D\.C\.|Ga\.|Haw\.|Idaho|Ill\.|Ind\.|Kan\.|Md\.|Miss\.|Mont\.|Neb\.|N\.J\.|N\.M\.|N\.C\.|N\.D\.|R\.I\.|S\.C\.|S\.D\.|Tenn\.|Utah|Va\.|W\. Va\.|Wyo\.)/;
const STATE_CODE_RE = new RegExp(
  `(?<![\\w.])((?:${STATE_ABBR})(?:[ \\t\\u00a0]+(?:[A-Z][a-z]{0,8}\\.?|&)){0,5}?[ \\t\\u00a0]+(?:Code|Law|Stat\\.|Rev\\.[ \\t\\u00a0]+Stat\\.|Comp\\.[ \\t\\u00a0]+Laws|Gen\\.[ \\t\\u00a0]+Laws)(?:[ \\t\\u00a0]+Ann\\.)?(?:[ \\t\\u00a0]+tit\\.[ \\t\\u00a0]+\\d+,)?)[ \\t\\u00a0]*(§{1,2})[ \\t\\u00a0]*(${"[\\w.()–—\\-]+(?::\\d[\\w.()–—\\-]*)*(?![\\w.()–—\\-]|:\\d)"})`,
  "g",
);

// Legislative history (Rule 13.4): "H.R. Rep. No. 112-98, pt. 1, at 40 (2011)",
// "S. Rep. No. 82-1979 (1952)", "H.R. Conf. Rep. No. …", "S. Doc. No. …".
// Groups: 1 chamber, 2 kind, 3 number, 4 year.
const LEGHIST_RE =
  /(?<![\w.])(H\.\s?R\.|S\.)\s+(Rep\.|Doc\.|Conf\.\s+Rep\.)\s+No\.\s+(\d{1,3}[-–]\d{1,5})(?:,\s*pt\.\s*\d+)?(?:,\s*at\s+\d+(?:[–—-]\d+)?)?(?:\s*\(((?:17|18|19|20)\d{2})\))?/g;

// Local rules (FRAP 28 lists them with the rules): patent local rules
// ("Patent L.R. 3-1", "P.R. 3-1", "L.P.R. 2.1", "Local Patent Rule 3-1"), and
// "Civ. L.R. 7-3" / "Local Rule 7.1". Subsections collapse into the rule.
// Groups: 1 an optional district ("N.D. Cal.", "D. Del.", "D.N.J."), 2 the
// rule-set words, 3 the number.
const LOCAL_RULE_RE =
  /(?<![\w.])(?:((?:[NESCWM]\.D\.\s?[A-Z][a-z]{1,5}\.)|D\.\s?(?:[A-Z][a-z]{1,5}\.|[A-Z]\.[A-Z]\.))\s+)?(Patent\s+L\.\s?R\.|P\.\s?R\.|L\.\s?P\.\s?R\.|Local\s+Patent\s+Rules?|Civ\.\s+L\.\s?R\.|Civil\s+L\.\s?R\.|Local\s+(?:Civil\s+)?Rules?)\s+(\d{1,3}(?:[.-]\d{1,3}){0,3})(?![\d])/g;

/**
 * Something shaped like a citation — "VOL Source PAGE (… YEAR)" — that no
 * pattern above read. It is reported in the skipped list by name rather than
 * silently missing from the table. Every token holds no space and the counts
 * are capped, so the scan is linear.
 */
const CITE_SHAPE_RE = /(?<![\w.])(\d{1,4})\s+([A-Z][A-Za-z.'’&]*(?:\s+[A-Z0-9][A-Za-z0-9.'’&]*){0,5})\s+(\d{1,6})(?:,\s*\d{1,6}(?:[–—-]\d{1,6})?)?\s*\(([^()\n]{0,50}(?:1[6-9]|20)\d{2})\)/g;

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
// "Fed. R. Evid. 702" has no "P." (it is not a procedure rule) — the old
// pattern demanded one, so the Rules of Evidence were never listed at all.
// Groups: 1 Evid, 2 Civ/App/Crim/Bankr, 3 the rule number.
const RULE_RE = /\bFed\.\s+R\.\s+(?:(Evid)\.|(Civ|App|Crim|Bankr)\.\s+P\.)\s+(\d+(?:\.\d+)?)(?:\([\w'.]+\))*/g;
// Spelled-out forms: "Rule 702 of the Federal Rules of Evidence", "Federal
// Rule of Civil Procedure 12(b)(6)". Groups: (A) 1 number, 2 set; (B) 3 set, 4 number.
// SINGULAR "Rule"/"Federal Rule" only: the plural "Federal Rules of Civil Procedure 2015 amendments" names the
// rule set and a year, not Rule 2015. A number outside the set's range (RULE_RANGE) is not a rule either.
const RULE_WORDS_RE =
  /\bRule\s+(\d+(?:\.\d+)?)(?:\([\w'.]+\))*\s+of\s+the\s+Federal\s+Rules\s+of\s+(Evidence|Civil\s+Procedure|Criminal\s+Procedure|Appellate\s+Procedure|Bankruptcy\s+Procedure)\b|\bFederal\s+Rule\s+of\s+(Evidence|Civil\s+Procedure|Criminal\s+Procedure|Appellate\s+Procedure|Bankruptcy\s+Procedure)\s+(\d+(?:\.\d+)?)(?![\d.]*\d)/g;
const RULE_SET_OF: Record<string, string> = { evidence: "Evid", civil: "Civ", criminal: "Crim", appellate: "App", bankruptcy: "Bankr" };
/** The numbers each federal rule set actually uses (base rule number): FRE 101–1103, Bankr. 1001–9037. */
const RULE_RANGE: Record<string, [number, number]> = {
  Civ: [1, 86],
  Evid: [101, 1103],
  Crim: [1, 61],
  App: [1, 48],
  Bankr: [1001, 9037],
};
function ruleInRange(set: string, num: string): boolean {
  const n = parseInt(num, 10);
  const r = RULE_RANGE[set];
  return !!r && n >= r[0] && n <= r[1];
}
// Court rules (FRAP 28(a)(3) lists them with the rules): "Fed. Cir. R. 36",
// "Sup. Ct. R. 10", "D.C. Cir. R. 28", "9th Cir. R. 36-3". Groups: 1 court, 2 number.
const COURT_RULE_RE = /\b(Fed\.\s+Cir\.|Sup\.\s+Ct\.|D\.C\.\s+Cir\.|(?:1st|2d|3d|[4-9]th|1[01]th)\s+Cir\.)\s+R\.\s+(\d+(?:[.-]\d+)*)/g;
/** The Federal Rules of Civil Procedure stop at Rule 86. */
const FRCP_MAX = 86;
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
// "In re" / "In the Matter of" case forms survive.
//
// "Under" (docs2 review, fix2 — reverses the earlier decision to keep it): "Under Alice Corp. … v. CLS Bank" was filed
// under U and its short form "Alice, 573 U.S. at 218" was never found — the
// commonest way a patent brief introduces Alice. "Under" is now stripped EXCEPT
// before the real parties that start with it (Under Armour, Under Seal, Under
// Sea), which stay whole.
const LEADING_INTRO_RE =
  /^(?:In(?!\s+re\b)(?!\s+the\s+Matter\b)|Under(?!\s+(?:Armour|Seal|Seas?)\b)|Applying|Citing|Quoting|Following|Whether|Because|Although|Though|Since|When|Where|While|Unlike|Given|Assuming|Consider|Accordingly|Moreover|Nevertheless|Nonetheless|Likewise|Similarly|Conversely|Instead|Notably|Finally|Here|Thus|Therefore|Hence|However|Indeed|After|Before|Even|Both|Only|Recently|Later|Earlier|Yet|Still|Also|Again|Specifically|Importantly|Ultimately|Then|Next|Per),?\s+/;

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
    // A token ending ")." closes a parenthesised sub-part and a sentence:
    // "§ 1295(a)(4)(A). Smith v. Jones", "step (C). Acme Corp. v. …". Its
    // short tail ("(A).", "A).") passes the ≤ 3-letter abbreviation test, so it
    // needs saying explicitly (docs2 review, fix2).
    const sentenceEnd = w.endsWith(").") || (w.endsWith(".") && !isCaseNameAbbreviation(w));
    if (sentenceEnd && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(words[i + 1])) cut = i;
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
  let name = cutAtSentenceEnd(rawName.replace(/\s+/g, " ").trim()).replace(/\svs\.\s/, " v. ").trim();
  // Strip what is glued on in front, in any order, until nothing changes: a
  // signal ("See", "See also", "See, e.g.,"), a record pointer ("Ex. B.",
  // "Exhibit 4,") and — for a "Party v. Party" name only — a prose opener
  // ("Under", "In", "Applying"). "In re" / "Ex parte" have no " v. " and
  // keep their leading word. Bounded: each pass removes at least one word.
  for (let k = 0; k < 6; k++) {
    const before = name;
    name = name
      .replace(/^(?:See(?:\s+also|\s+generally|,\s+e\.g\.,)?|Cf\.|Compare|Accord|Contra|E\.g\.,?|But\s+see|But\s+cf\.)\s+/, "")
      .replace(/^(?:Exs?\.|Exhibits?)\s+[A-Z0-9]{1,4}[.,]?\s+(?=[A-Za-zÀ-ÖØ-öø-ÿ])/, "")
      .trim();
    if (/\sv\.\s/.test(name)) name = name.replace(LEADING_INTRO_RE, "").trim();
    if (name === before) break;
  }
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
    // Sorted by the entry text as written, "In re Wands" under I (fix2): Word's
    // native TOA sorts a TA field by its \l text and has no separate sort key,
    // so the static table sorting it under W made the two tables disagree.
    sortKey: foldQuotes(name).toLowerCase(),
    name,
    rest,
    plain: `${name}${rest}`,
    html: `<i>${esc(name)}</i>, ${esc(dk)}${esc(coreCite)}${cy ? ` (${esc(cy)})` : ""}`,
    locator: coreCite,
    locators,
    // "Lab'ys" (21st ed. T6) and "Labs." (earlier editions) are one party.
    dedupe: `cases|${foldQuotes(abbreviateCaseName(name)).toLowerCase().replace(/\blab'ys(?![\w.])/g, "labs.").replace(/\blab'y(?![\w.'])/g, "lab.")}|${coreCite.toLowerCase()}`,
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
    let end = m.index + m[0].length;
    // Subsequent history (Rule 10.7) belongs to the full cite, so the table
    // entry carries it as first cited: "Thaler v. Vidal, 43 F.4th 1207 (Fed.
    // Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023)". Up to two steps; the
    // scan then resumes after it, so a "sub nom." case is not a second row.
    let history = "";
    if (m[6]) {
      for (let k = 0; k < 2; k++) {
        HISTORY_RE.lastIndex = end;
        const h = HISTORY_RE.exec(text);
        if (!h) break;
        history += `, ${h[1].replace(/\s+/g, " ")}, ${h[2]} ${normalizeReporter(h[3])} ${h[4]} (${h[5].replace(/\s+/g, " ").trim()})`;
        end = h.index + h[0].length;
      }
    }
    const raw = caseRaw(m[1], core, m[6], verbatimBetween(m, m[1].length, 2, 5), m.index, end);
    if (history) {
      raw.rest += history;
      raw.plain += history;
      raw.html += esc(history).replace(/\b(cert\. (?:denied|granted|dismissed)|aff['’]d|rev['’]d|vacated|sub nom\.)/g, "<i>$1</i>");
      CASE_RE.lastIndex = Math.max(CASE_RE.lastIndex, end);
    }
    out.push(raw);
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
    // One authority however its page is comma'd ("1076" = "1,076"), shown per
    // Rule 6.2(a): commas only from five digits ("1076", "50,057").
    const digits = page.replace(/\D/g, "");
    plain("other", `${m[1]} Fed. Reg. ${groupDigitsRule62(digits)}`, `fedreg ${m[1].padStart(4, "0")} ${digits.padStart(8, "0")}`, m.index, m.index + span.length, {
      span,
      key: `other|fedreg|${m[1]}|${digits}`,
    });
  }
  sections(MPEP_RE, "other", 1, () => (s) => `MPEP ${sectionSymbol(s)} ${s}`, () => (s) => `mpep ${s}`);

  // PTAB / BPAI decisions — listed with the cases.
  PTAB_RE.lastIndex = 0;
  while ((m = PTAB_RE.exec(text))) {
    const proc = m[2].replace(/\s+/g, " ");
    const core = m[3] ? `${proc}, ${m[3].replace(/\s+/g, " ")}` : proc;
    const s0 = m[0].indexOf(m[2], m[1].length);
    const e0 = m[3] ? m[0].indexOf(m[3], s0) + m[3].length : s0 + m[2].length;
    const verb = m[0].slice(s0, e0);
    out.push(caseRaw(m[1], core, m[4], verb, m.index, m.index + m[0].length));
  }

  // Constitutional provisions. Sorted by the entry text, as Word's native TOA
  // sorts a TA field (checked in real Word: "amend. V" before "art. I"), so the
  // static and the native tables list them in the same order.
  CONST_RE.lastIndex = 0;
  while ((m = CONST_RE.exec(text))) {
    const jur = m[1].replace(/\s+/g, "");
    const t = m[6]
      ? `${jur} Const. pmbl.`
      : `${jur} Const. ${m[2]} ${m[3]}${m[4] ? `, § ${m[4]}` : ""}${m[5] ? `, cl. ${m[5]}` : ""}`;
    plain("constitutional", t, t.toLowerCase(), m.index, m.index + m[0].length, { span: m[0] });
  }

  // Session laws and Statutes at Large.
  const publSpans: Array<[number, number]> = [];
  PUBL_RE.lastIndex = 0;
  while ((m = PUBL_RE.exec(text))) {
    let name = (m[1] ?? "").replace(/\s+/g, " ").trim();
    // An act's name is written out in full (Rule 12.4), so a whole word ending
    // in "." before a capital ends the previous sentence: "The 1952 Act.
    // Patent Act of 1952, Pub. L. …" names the Patent Act of 1952.
    const sentence = /^.*\b[A-Z][a-z]+\.\s+(?=[A-Z])/.exec(name);
    if (sentence) name = name.slice(sentence[0].length);
    // A name whose start follows a comma or "and" is the TAIL of a longer
    // name ("Federal Food, Drug, and Cosmetic Act") — never shown half; the
    // row is then the bare "Pub. L. No. …".
    if (m[1] && /(?:,|\band|\bor|&)\s*$/.test(text.slice(Math.max(0, m.index - 6), m.index))) name = "";
    for (let k = 0; k < 4; k++) {
      const before = name;
      name = name.replace(/^(?:The|See(?:\s+also|\s+generally)?|Cf\.|Under|In|Compare|Accord|Contra|But\s+see)\s+/, "");
      if (name === before) break;
    }
    const lead = m[1] ? m[0].indexOf(m[1]) + m[1].length - name.length : 0;
    const start = m.index + (m[1] ? lead : 0);
    const law = m[2].replace("–", "-");
    const stat = m[3] ? `, ${m[3]} Stat. ${m[4].replace(/,+$/, "")}` : "";
    const yr = m[5] ? ` (${m[5]})` : "";
    const t = `${name ? `${name}, ` : ""}Pub. L. No. ${law}${stat}${yr}`;
    plain("statutes", t, t.toLowerCase(), start, m.index + m[0].length, {
      span: text.slice(m.index + m[0].indexOf("Pub"), m.index + m[0].length),
      key: `statutes|publ|${law}`,
    });
    // The table lists the law by its own name; the plain locator is the
    // "Pub. L. No. …" text, which is what a search finds.
    const last = out[out.length - 1];
    last.locator = `Pub. L. No. ${m[2]}`;
    last.locators = [last.locator];
    publSpans.push([m.index, m.index + m[0].length]);
  }
  STAT_RE.lastIndex = 0;
  while ((m = STAT_RE.exec(text))) {
    const at = m.index;
    if (publSpans.some(([a, b]) => at >= a && at < b)) continue;
    const page = m[2].replace(/\D/g, "");
    plain("statutes", `${m[1]} Stat. ${groupDigitsRule62(page)}`, `${m[1]} stat. ${groupDigitsRule62(page)}`, at, at + m[0].length, {
      span: m[0],
      key: `statutes|stat|${m[1]}|${page}`,
    });
  }

  // State codes.
  STATE_CODE_RE.lastIndex = 0;
  while ((m = STATE_CODE_RE.exec(text))) {
    const code = m[1].replace(/\s+/g, " ");
    // fix3: in a state whose code numbers its sections with hyphens ("Ga. Code Ann. § 9-11-12", "N.J. Stat. Ann.
    // § 2A:14-1", "Ariz. Rev. Stat. Ann. § 12-341") the section is ONE number: the sign is the one written and the
    // hyphen is kept. fix3e: in a plain-number code (Cal., N.Y., Tex., …) a hyphen between two numbers is a RANGE,
    // as in a federal cite: "§ 1714-1716" → "§§ 1714–1716", and "§§ 1714-1715" / "§§ 1714–1715" merge (base).
    const raw = trimSection(m[3]).replace(/\s+/g, " ");
    const hyphenated = HYPHEN_SECTION_STATE_RE.test(code) || /-.*-/.test(raw) || /\d:\d/.test(raw);
    const sec = hyphenated ? raw : normalizeSection(m[3]);
    const sign = hyphenated ? m[2] : sectionSymbol(sec);
    plain("statutes", `${code} ${sign} ${sec}`, `${code} ${sign} ${sec}`.toLowerCase(), m.index, m.index + m[0].length - (m[3].length - trimSection(m[3]).length), {
      span: text.slice(m.index, m.index + m[0].length - (m[3].length - trimSection(m[3]).length)),
    });
  }

  // Legislative history — "Other Authorities".
  LEGHIST_RE.lastIndex = 0;
  while ((m = LEGHIST_RE.exec(text))) {
    const chamber = m[1].replace(/\s+/g, "");
    const kind = m[2].replace(/\s+/g, " ");
    const num = m[3].replace("–", "-");
    const t = `${chamber} ${kind} No. ${num}${m[4] ? ` (${m[4]})` : ""}`;
    plain("other", t, t.toLowerCase(), m.index, m.index + m[0].length, {
      span: text.slice(m.index, m.index + m[0].indexOf(m[3]) + m[3].length),
      key: `other|leg|${chamber}|${kind}|${num}`,
    });
  }

  // Secondary sources — "Other Authorities" (FRAP 28(a)(3)). Conservative
  // shapes only; anything that LOOKS like one but is not read is reported in
  // the refusals below instead of silently missing from the table.
  const secondary: Array<[number, number]> = [];
  const pushSecondary = (t: string, html: string, sortKey: string, start: number, end: number, key: string, span: string): void => {
    plain("other", t, sortKey, start, end, { key, span });
    out[out.length - 1].html = html;
    secondary.push([start, end]);
  };
  TOA_ARTICLE_RE.lastIndex = 0;
  while ((m = TOA_ARTICLE_RE.exec(text))) {
    const lead = (LEADING_SIGNAL_RE.exec(m[0]) ?? [""])[0];
    const author = m[1].slice(lead.length).replace(/\s+/g, " ").trim();
    const title = m[2].replace(/\s+/g, " ").trim();
    const journal = m[4].replace(/\s+/g, " ").trim();
    const yr = m[7] === m[3] ? "" : ` (${m[7]})`;
    const cite = `${m[3]} ${journal} ${m[5]}${yr}`;
    const start = m.index + lead.length;
    pushSecondary(
      `${author}, ${title}, ${cite}`,
      `${esc(author)}, <i>${esc(title)}</i>, ${esc(cite)}`,
      `zz2 ${author.split(" ").slice(-1)[0].toLowerCase()} ${title.toLowerCase()}`,
      start,
      m.index + m[0].length,
      `other|article|${m[3]}|${journal.toLowerCase()}|${m[5]}`,
      text.slice(start, m.index + m[0].length),
    );
  }
  RESTATEMENT_RE.lastIndex = 0;
  while ((m = RESTATEMENT_RE.exec(text))) {
    const ed = m[1] ? ` (${m[1]})` : "";
    const subject = m[2].replace(/\s+/g, " ");
    const sec = normalizeSection(m[4]);
    const paren = m[5] ? ` (${m[5].replace(/\s+/g, " ")})` : "";
    const t = `Restatement${ed} of ${subject} ${sectionSymbol(sec)} ${sec}${paren}`;
    pushSecondary(t, `<i>${esc(`Restatement${ed} of ${subject}`)}</i> ${esc(`${sectionSymbol(sec)} ${sec}${paren}`)}`, `zz1 restatement ${subject.toLowerCase()} ${ed} ${sec}`, m.index, m.index + m[0].length, `other|restatement|${(m[1] ?? "").toLowerCase()}|${subject.toLowerCase()}|${sec.toLowerCase()}`, m[0]);
  }
  TREATISE_RE.lastIndex = 0;
  while ((m = TREATISE_RE.exec(text))) {
    if (secondary.some(([a, b]) => m!.index < b && m!.index + m![0].length > a)) continue;
    const lead = (LEADING_SIGNAL_RE.exec(m[2]) ?? [""])[0];
    if (!m[1] && lead && m[2].slice(lead.length).trim().split(/\s+/).length < 2) continue; // "See Chisum, …": one-word author
    const vol = m[1] ? `${m[1]} ` : "";
    const author = m[2].slice(lead.length).replace(/\s+/g, " ").trim();
    const title = m[3].replace(/\s+/g, " ");
    const pin = m[4].replace(/\s+/g, " ").replace(/^(§+)(?=\d)/, "$1 ");
    const paren = m[5].replace(/\s+/g, " ");
    const start = m[1] ? m.index : m.index + lead.length;
    pushSecondary(
      `${vol}${author}, ${title} ${pin} (${paren})`,
      `${esc(vol)}${esc(author)}, <i>${esc(title)}</i> ${esc(`${pin} (${paren})`)}`,
      `zz3 ${title.toLowerCase()} ${pin}`,
      start,
      m.index + m[0].length,
      `other|treatise|${vol}${author.toLowerCase()}|${title.toLowerCase()}|${pin}`,
      text.slice(start, m.index + m[0].length),
    );
  }
  // Shapes the table could not read — reported by name.
  const unreadShape = (re: RegExp, what: string): void => {
    re.lastIndex = 0;
    let u: RegExpExecArray | null;
    while ((u = re.exec(text))) {
      const at = u.index;
      if (secondary.some(([a, b]) => at >= a && at < b)) continue;
      refusals.push({ index: at, text: u[0], reason: `"${u[0]}" looks like ${what}, but its full citation could not be read — not listed in the table; check its form` });
    }
  };
  // Only a CITATION-shaped Restatement (a § within the clause), never the word
  // in prose ("as the Restatement explains").
  unreadShape(/\bRestatement\b[^.;§\n]{0,60}§+\s*\d[\w.]*/g, "a Restatement");
  unreadShape(/\b\d+\s+(?:[A-Z][A-Za-z.'’&]*\s+){0,4}(?:L\.\s?Rev\.|L\.\s?J\.)\s+\d+/g, "a law-review article");

  // Federal rules — qualified "Fed. R. Civ. P. 19" form (authoritative).
  // Evidence rules are "Fed. R. Evid. 702" (no "P."); the others "Fed. R. Civ. P. 12".
  const ruleText = (abbr: string, num: string): { text: string; sortKey: string } => ({
    text: abbr === "Evid" ? `Fed. R. Evid. ${num}` : `Fed. R. ${RULE_ABBR[abbr]} P. ${num}`,
    sortKey: `${abbr.toLowerCase()} ${num.padStart(4, "0")}`,
  });
  RULE_RE.lastIndex = 0;
  while ((m = RULE_RE.exec(text))) {
    const r = ruleText(m[1] || m[2], m[3]);
    plain("rules", r.text, r.sortKey, m.index, m.index + m[0].length);
  }
  // "Rule 702 of the Federal Rules of Evidence" / "Federal Rule of Civil
  // Procedure 12" — the set is named, so no FRCP guess. Their spans are kept so
  // the bare-rule pass below does not ALSO read that "Rule 702" as FRCP.
  const spelledRuleSpans: Array<[number, number]> = [];
  RULE_WORDS_RE.lastIndex = 0;
  while ((m = RULE_WORDS_RE.exec(text))) {
    const num = m[1] ?? m[4];
    const set = RULE_SET_OF[(m[2] ?? m[3]).split(/\s+/)[0].toLowerCase()];
    if (!ruleInRange(set, num)) {
      spelledRuleSpans.push([m.index, m.index + m[0].length]);
      const [lo, hi] = RULE_RANGE[set];
      refusals.push({ index: m.index, text: m[0], reason: `"${m[0]}" — that rule set runs from Rule ${lo} to Rule ${hi}; not listed` });
      continue;
    }
    const r = ruleText(set, num);
    plain("rules", r.text, r.sortKey, m.index, m.index + m[0].length, { span: m[0] });
    spelledRuleSpans.push([m.index, m.index + m[0].length]);
  }
  // Court rules: "Fed. Cir. R. 36", "Sup. Ct. R. 10".
  COURT_RULE_RE.lastIndex = 0;
  while ((m = COURT_RULE_RE.exec(text))) {
    const court = m[1].replace(/\s+/g, " ");
    const t = `${court} R. ${m[2]}`;
    plain("rules", t, `zz ${court.toLowerCase()} ${m[2].padStart(4, "0")}`, m.index, m.index + m[0].length);
  }
  // Local rules: "Patent L.R. 3-1", "P.R. 3-1", "Civ. L.R. 7-3", "Local Rule 7.1".
  LOCAL_RULE_RE.lastIndex = 0;
  while ((m = LOCAL_RULE_RE.exec(text))) {
    const court = m[1] ? `${m[1].replace(/\s+/g, " ")} ` : "";
    const set = m[2]
      .replace(/\s+/g, " ")
      .replace(/L\. R\./g, "L.R.")
      .replace(/P\. R\./g, "P.R.")
      .replace(/^Local Patent Rules$/, "Local Patent Rule")
      .replace(/^Local (Civil )?Rules$/, "Local $1Rule");
    const t = `${court}${set} ${m[3]}`;
    plain("rules", t, t.toLowerCase(), m.index, m.index + m[0].length, { span: m[0] });
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
      const at = m.index;
      if (spelledRuleSpans.some(([a, b]) => at >= a && at < b)) continue;
      const n = parseInt(m[1], 10);
      if (USPTO_PRACTICE_RULES.has(n)) continue;
      if (RULE_QUALIFIER_RE.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
      // There is no Fed. R. Civ. P. above 86: "Rule 403" / "Rule 702" are
      // evidence rules (or something else) — said by name, never listed as FRCP.
      if (n > FRCP_MAX) {
        refusals.push({
          index: m.index,
          text: m[0],
          reason: `"${m[0]}" names no rule set and the Federal Rules of Civil Procedure end at Rule ${FRCP_MAX} — not listed; write it as "Fed. R. Evid. ${n}" (or the rule set it belongs to)`,
        });
        continue;
      }
      const r = ruleText("Civ", m[1]);
      plain("rules", r.text, r.sortKey, m.index, m.index + m[0].length);
    }
  }

  // Anything still shaped like "VOL Source PAGE (… YEAR)" that nothing above
  // read is an authority the table would silently omit: say so by name.
  const read: Array<[number, number]> = out.map((r) => [r.start, r.end]);
  for (const r of out) for (const s of r.spans ?? []) read.push([s.index, s.index + s.text.length]);
  read.sort((a, b) => a[0] - b[0]);
  // Merged into disjoint extents, so one binary search answers "overlaps?".
  const merged: Array<[number, number]> = [];
  for (const [a, b] of read) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const isRead = (a: number, b: number): boolean => {
    let lo = 0;
    let hi = merged.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (merged[mid][0] < b) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return k >= 0 && merged[k][1] > a;
  };
  CITE_SHAPE_RE.lastIndex = 0;
  while ((m = CITE_SHAPE_RE.exec(text))) {
    if (isRead(m.index, m.index + m[0].length)) continue;
    if (refusals.some((r) => r.index >= m!.index && r.index < m!.index + m![0].length)) continue;
    refusals.push({
      index: m.index,
      text: m[0],
      reason: isKnownReporter(m[2])
        ? `"${m[0]}" is a ${normalizeReporter(m[2])} cite, but no case name the table could read goes with it — not listed; check the citation's form`
        : `"${m[0]}" looks like a citation, but "${m[2]}" is not a source the table can classify — not listed; check it and add it by hand if it is an authority`,
    });
  }

  mergeCaseSpellings(out, refusals);
  return { raws: out, refusals };
}

/**
 * One case, one row (docs2 review, fix2): two cites of the same volume +
 * reporter + first page whose names differ only by words glued on in front
 * ("A). Smith v. Jones" / "Smith v. Jones") are one authority. The longer name
 * takes the shorter one's name and key, so the table, the register and the
 * occurrence report all agree.
 *
 * Any OTHER difference in the name for the same cite ("Alice Corp. Pty. Ltd. v.
 * …" and "Alice Corp. v. …", 573 U.S. 208) is still one row — under the first
 * spelling — so the native TOA does not split its pages across two \l texts;
 * each other spelling is reported by name in the skipped list, so a mistyped
 * cite or two decisions on one table page are checked, never silently merged.
 */
function mergeCaseSpellings(raws: Raw[], refusals: ToaRefusal[]): void {
  const byCore = new Map<string, Raw[]>();
  for (const r of raws) {
    if (r.category !== "cases") continue;
    const core = r.locator.toLowerCase();
    const list = byCore.get(core) ?? [];
    list.push(r);
    byCore.set(core, list);
  }
  for (const list of byCore.values()) {
    if (list.length < 2) continue;
    // One spelling per dedupe key, normalised ONCE (abbreviateCaseName is the
    // costly part), with where it is first seen.
    const spell = new Map<string, { raw: Raw; norm: string; first: number; into?: string }>();
    for (const r of list) {
      const s = spell.get(r.dedupe);
      if (!s) spell.set(r.dedupe, { raw: r, norm: foldQuotes(abbreviateCaseName(r.name)).toLowerCase(), first: r.start });
      else if (r.start < s.first) s.first = r.start;
    }
    if (spell.size < 2) continue;
    // 1. A longer name that ENDS with a shorter one (at a word boundary) is the
    //    same case with prose glued on: it takes the shorter name, silently.
    const keys = [...spell.keys()].sort((a, b) => spell.get(a)!.norm.length - spell.get(b)!.norm.length);
    for (let i = 0; i < keys.length; i++) {
      const s = spell.get(keys[i])!;
      if (s.into) continue;
      for (let j = i + 1; j < keys.length; j++) {
        const l = spell.get(keys[j])!;
        if (l.into) continue;
        if (l.norm.length > s.norm.length && l.norm.endsWith(s.norm) && /\s$/.test(l.norm.slice(0, l.norm.length - s.norm.length))) {
          l.into = keys[i];
          s.first = Math.min(s.first, l.first);
        }
      }
    }
    // 2. Whatever spellings remain: one row, under the first seen, each other
    //    spelling reported by name.
    const left = keys.filter((k) => !spell.get(k)!.into).sort((a, b) => spell.get(a)!.first - spell.get(b)!.first);
    for (const k of left.slice(1)) {
      const o = spell.get(k)!;
      o.into = left[0];
      refusals.push({
        index: o.first,
        text: o.raw.name,
        reason: `"${o.raw.name}" cites the same ${o.raw.locator} as "${spell.get(left[0])!.raw.name}" — listed once, under the first spelling; check the case name`,
      });
    }
    const target = (k: string): string => {
      let t = k;
      for (let g = 0; g < 8 && spell.get(t)!.into; g++) t = spell.get(t)!.into!;
      return t;
    };
    for (const r of list) {
      const t = spell.get(target(r.dedupe))!.raw;
      if (r.dedupe === t.dedupe) continue;
      r.name = t.name;
      r.plain = `${t.name}${r.rest}`;
      r.html = r.html.replace(/^<i>[\s\S]*?<\/i>/, `<i>${esc(t.name)}</i>`);
      r.sortKey = t.sortKey;
      r.dedupe = t.dedupe;
    }
  }
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
  const { raws, refusals } = collectAll(text);
  for (const r of dedupeBest(raws)) {
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
  return refusals.length ? { groups, total, refused: refusals.sort((a, b) => a.index - b.index) } : { groups, total };
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
      // Italic parts after the name ("cert. denied", "aff'd") stay italic, as in the native TOA (fix2).
      const restHtml = e.html.replace(/^<i>[\s\S]*?<\/i>,\s*/, "");
      const citeRuns = /<i>/.test(restHtml)
        ? restHtml
            .split(/(<i>[\s\S]*?<\/i>)/)
            .filter(Boolean)
            .map((p, k) => {
              const im = /^<i>([\s\S]*)<\/i>$/.exec(p);
              const unesc = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
              return run(im ? `${RPR_BASE}<w:i/><w:iCs/>` : RPR_BASE, `${k === 0 ? "<w:br/>" : ""}${t(unesc(im ? im[1] : p))}`);
            })
            .join("")
        : run(RPR_BASE, `<w:br/>${t(cite)}`);
      return `<w:p>${pPr}${run(`${RPR_BASE}<w:i/><w:iCs/>`, t(`${e.name},`))}${citeRuns}${pageRun}</w:p>`;
    }
    // A non-case entry with italic parts (an article or treatise title) keeps
    // them italic here too, run by run.
    if (/<i>/.test(e.html)) {
      const unesc = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const runs = e.html
        .split(/(<i>[\s\S]*?<\/i>)/)
        .filter(Boolean)
        .map((p) => {
          const im = /^<i>([\s\S]*)<\/i>$/.exec(p);
          return run(im ? `${RPR_BASE}<w:i/><w:iCs/>` : RPR_BASE, t(unesc(im ? im[1] : p)));
        })
        .join("");
      return `<w:p>${pPr}${runs}${pageRun}</w:p>`;
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
  /** Set when an Id. here would NOT name one authority (Rule 4.1) — the
   *  reason, said by name; `plain` is then "". */
  refused?: string;
}

/**
 * What an "Id." typed at the end of `text` would refer to (Rule 4.1: the
 * immediately preceding authority). It is resolved by the SAME logic that
 * places Id. in the Table of Authorities ({@link toaOccurrenceReport}), so a
 * short form ("Alice, 573 U.S. at 218") or an earlier Id. counts, and a
 * preceding patent column cite, record cite, string cite of several
 * authorities or "§§" list is REFUSED by name (fix2: the helper used to read
 * full cites only and named an authority two citations back). Null when no
 * citation precedes the cursor at all.
 */
export function findPrecedingAuthority(text: string): PrecedingAuthority | null {
  const marks = authoritiesForToa(text);
  const sep = text === "" || /\s$/.test(text) ? "" : " ";
  const probe = `${text}${sep}Id.`;
  const at = text.length + sep.length;
  const rep = toaOccurrenceReport(probe, marks);
  const hit = rep.occurrences.find((o) => o.kind === "id" && o.index === at);
  if (hit) {
    const mk = marks[hit.markIndex];
    const plain = mk.category === "cases" ? `${mk.name}, ${mk.locator}` : mk.long;
    return { plain, category: mk.category };
  }
  const no = rep.refused.find((r) => r.index === at);
  if (!no || /no citation precedes it/.test(no.reason)) return null;
  // A "§§ 102, 103" list is ONE citation of one code — Id. may refer to it as
  // a whole (the table only refuses it because it cannot pick one row).
  if (/list of several authorities/.test(no.reason)) {
    let best: Raw | null = null;
    for (const r of collect(text)) if (!best || r.start > best.start) best = r;
    if (best && best.wholeText) return { plain: best.wholeText, category: best.category };
  }
  return { plain: "", category: "other", refused: no.reason.replace(/^Not placed:\s*/, "") };
}

// --- supra: detect an earlier secondary source (law-review article) ----------

// "Author, Title, VOL JOURNAL PAGE (YEAR)". The journal must carry a law-journal
// marker (L. Rev. / L.J. / Rev. / J. …) so a case reporter isn't mistaken for one.
// Starts at a word start only (never mid-word).
const AUTHOR = "(?<![A-Za-z])[A-Z][A-Za-z.'’-]+(?:\\s+[A-Z][A-Za-z.'’-]*){1,3}";
// The journal's law-journal marker. The "J." tail used to be
// `(?:\s?[A-Z][A-Za-z.'’&]*)*` — with the space optional, "J.ABCDEFGH…" splits
// into tokens in exponentially many ways (a freeze on a long capitalised run).
// Each token now starts with a capital and continues in lower case, so the
// split is unique, and the repeat is capped.
const LAW_JOURNAL = "(?:[A-Z][A-Za-z.'’&]*\\s+){0,4}(?:L\\.\\s?Rev\\.|L\\.\\s?J\\.|Rev\\.|J\\.(?:\\s?(?:[A-Z][a-z.'’]*|&)){0,6})";
const ARTICLE_RE = new RegExp(
  `(${AUTHOR}(?:\\s+&\\s+${AUTHOR})?),\\s+[A-Z][^,]{2,180}?,\\s+\\d+\\s+` +
    `${LAW_JOURNAL}\\s+` +
    `\\d+(?:,\\s*\\d+)?\\s*\\((?:19|20)\\d{2}\\)`,
  "g"
);
/** The same article shape with every part captured, for the table: 1 author,
 *  2 title, 3 volume, 4 journal, 5 first page, 6 pincite, 7 year. */
const TOA_ARTICLE_RE = new RegExp(
  `(${AUTHOR}(?:\\s+&\\s+${AUTHOR})?),\\s+([A-Z][^,]{2,180}?),\\s+(\\d+)\\s+(${LAW_JOURNAL})\\s+` +
    `(\\d+)(?:,\\s*(\\d+(?:[–—-]\\d+)?))?\\s*\\(((?:19|20)\\d{2})\\)`,
  "g",
);
/** A Bluebook signal an author-shaped match can swallow ("See Mark A. Lemley"). */
const LEADING_SIGNAL_RE = /^(?:See(?:\s+also|\s+generally)?|Cf\.|Accord|Contra|Compare)\s+/;
/** "Restatement (Second) of Torts § 402A (Am. L. Inst. 1965)": 1 edition,
 *  2 subject, 3 "§"/"§§", 4 section, 5 the parenthetical. */
const RESTATEMENT_RE =
  /\bRestatement\s+(?:\((First|Second|Third|Fourth)\)\s+)?of\s+((?:the\s+)?[A-Z][A-Za-z]*(?:\s+(?:of|and|the|&|[A-Z][A-Za-z]*)){0,5}?)\s+(§{1,2})\s*(\d[\w.]*)(?:\s*\(([^()]{0,40}?\d{4})\))?/g;
/** A treatise: "[vol] Author, Title § N (… year)" — "5 Donald S. Chisum,
 *  Chisum on Patents § 18.02 (2020)". A § / ¶ pin and a dated parenthetical
 *  are required, so prose is not read as a book. 1 volume, 2 author, 3 title,
 *  4 pin, 5 parenthetical. */
const TREATISE_RE = new RegExp(
  `(?:\\b(\\d+[A-Z]?)\\s+)?(${AUTHOR}(?:\\s+&\\s+${AUTHOR})?),\\s+([A-Z][A-Za-z'’]*(?:\\s+(?:on|of|the|and|in|for|to|&|[A-Z][A-Za-z.'’]*)){1,8})\\s+` +
    `(§{1,2}\\s*\\d[\\w.()-]*\\w|¶\\s*\\d[\\w.]*\\w|§{1,2}\\s*\\d|¶\\s*\\d)(?:,\\s*at\\s+\\d+)?\\s*\\(([^()]{0,40}?(?:1[6-9]|20)\\d{2})\\)`,
  "g",
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
 * 3 Other Authorities, 4 Rules, 6 Regulations, 7 Constitutional Provisions —
 * the last verified in real Word, fix2). Word has no native "Patents"
 * category, so patents share "Other Authorities" (3) with Fed. Reg. and MPEP.
 */
const CATEGORY_NUM: Record<ToaCategory, number> = {
  cases: 1,
  constitutional: 7,
  statutes: 2,
  rules: 4,
  regulations: 6,
  patents: 3,
  other: 3,
};

/** The category headings/numbers to emit TOA fields for, in Bluebook order. */
export const TOA_FIELD_CATEGORIES: { num: number; heading: string }[] = [
  { num: 1, heading: "Cases" },
  { num: 7, heading: "Constitutional Provisions" },
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
  /** The entry as HTML with its italic parts in <i> (same text as `long`). */
  html?: string;
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
    html: r.html,
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
export function taFieldOoxml(name: string, rest: string, categoryNum: number, html?: string): string {
  const q = '<w:instrText xml:space="preserve">';
  let runs: string;
  // A case whose only italic part is its name keeps the original runs below
  // (byte-identical TA fields); the html path is for every other italic part.
  const italics = html ? (html.match(/<i>/g) ?? []).length : 0;
  if (html && italics > 0 && (!name || italics > 1)) {
    // Every italic part of the entry keeps its italics in the generated table —
    // an article or treatise title, a Restatement, "cert. denied" (fix2: an
    // article title used to come out roman in the native TOA).
    const unesc = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const parts = html.split(/(<i>[\s\S]*?<\/i>)/).filter(Boolean);
    runs =
      `<w:r>${q} TA \\l "</w:instrText></w:r>` +
      parts
        .map((p) => {
          const im = /^<i>([\s\S]*)<\/i>$/.exec(p);
          const txt = escField(unesc(im ? im[1] : p));
          return im ? `<w:r><w:rPr><w:i/><w:iCs/></w:rPr>${q}${txt}</w:instrText></w:r>` : `<w:r>${q}${txt}</w:instrText></w:r>`;
        })
        .join("") +
      `<w:r>${q}" \\c ${categoryNum} </w:instrText></w:r>`;
  } else if (name) {
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
  if (s) {
    out.push(s);
    // Every shorter word-prefix too: a brief may cut "State St. Bank" to
    // "State St." or "Gen. Elec." to "Gen." — vol + reporter + "at" still pin
    // the case. A lone generic word ("State", "United") is never a candidate.
    // …and the same words AS WRITTEN in the document's first party ("State
    // Street", when the T6 short name is "State St. Bank").
    const ws = s.split(" ");
    const lead = name.replace(/^(?:In re|Ex parte|In the Matter of|Matter of)\s+/i, "").split(/\s+vs?\.\s+/)[0].trim().split(/\s+/);
    const asWritten = lead.slice(0, ws.length).join(" ").replace(/,$/, "");
    const pushPrefixes = (words: string[]): void => {
      for (let k = words.length; k >= 1; k--) {
        const p = words.slice(0, k).join(" ").replace(/,$/, "");
        if (p.replace(/[^A-Za-z]/g, "").length >= 2 && !/^(?:of|for|the|State|United|City|County|Commonwealth|People)$/i.test(p) && !/\s(?:of|for|the|&)$/i.test(p) && !out.includes(p)) out.push(p);
      }
    };
    pushPrefixes(ws);
    // Only when the short name IS the first party (not the second, chosen
    // because the first was generic).
    const samePartyAs = (a: string, b: string): boolean => a.slice(0, 3).toLowerCase() === b.slice(0, 3).toLowerCase();
    if (asWritten && asWritten !== s && samePartyAs(lead[0] ?? "", ws[0])) pushPrefixes(asWritten.split(" "));
  }
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
  // Members of one list share one extent — cover it once, not once per member
  // (a 1,700-member "§§" list was 1,700 × the list length).
  const coveredExtents = new Set<string>();
  for (const r of raws) {
    const k = `${r.start}:${r.end}`;
    if (coveredExtents.has(k)) continue;
    coveredExtents.add(k);
    cover(r.start, r.end);
  }
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
