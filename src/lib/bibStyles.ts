// Citation styles: one hand-written BibStyle per StyleId (docs/SCOPE-CITATIONS-2026-10.md
// §C1, §C5, §C6, §E). No CSL processor and no CSL XML (licence: §C5).
//
// EVERY PATTERN HERE IS FROM THE STYLE'S OWN MANUAL OR OFFICIAL GUIDE, fetched 2026-10-14:
//   IEEE        IEEE Reference Guide V 3.28.2025 (journals.ieeeauthorcenter.ieee.org
//               IEEE_Reference_Guide.pdf → Google Doc 1j1L96U2NagwWI9MEVDNVKt9pXxRzTH7h3krI3Mb6wZE)
//   ACS         ACS Guide to Scholarly Communication 4.3.3 "ACS Style Quick Guide"
//               (pubs.acs.org/doi/10.1021/acsguide.40303, last updated April 14, 2026)
//   Nature      nature.com Scientific Reports submission guidelines ("we use the standard Nature
//               referencing style") and Nature Chemistry aip-and-formatting; Nature formatting guide
//               for the author rule
//   Vancouver   NLM "Samples of Formatted References" (nlm.nih.gov/bsd/uniform_requirements.html)
//               and Citing Medicine 2nd ed. (ncbi.nlm.nih.gov/books/NBK7256) chapters 2 and 7
//   APA 7       apastyle.apa.org reference examples (journal, book, edited-book chapter) and
//               "Elements of reference list entries"
//   Chicago     CMOS 18 Citation Quick Guide, author-date and notes-bibliography pages
//   Optica      Optica Publishing Group Journal Style Guide, §3 "References and notes"
//               (opg.optica.org/content/author/portal/item/style-optica-styleguide/, page
//               updatedAt 2026-08-20, fetched 2026-10-22; tests: opticaStyle.test.ts)
// The tests (bibStyles.oracle.test.ts) quote each example verbatim with its URL.
//
// A style claims only the item types for which at least three verbatim examples were found
// and pinned. Any other type is REFUSED BY NAME (BibStyleRefusal / formatReference), never
// guessed. Harvard (Cite Them Right) and MLA 9 have no fetched official source and do not ship.
//
// Display contract: html is built from escaped text plus <i> <b> <sup> <sub>; plain is the
// html with tags stripped and entities decoded. Unicode (H₂O) is never folded, page ranges
// use the en dash (NLM: hyphen, its own rule), and et al. is roman except in Optica, whose
// guide sets it in italics in every formatted example ("J. Chang, <em>et al.</em>,").

import type { BibDate, BibName, BibRecord, BibStyle, BibType, CiteItem, Formatted, StyleId } from "./bibRecord";
import { formatPages, isPageRange } from "./bibPages";
import {
  CHICAGO_SMALL_WORDS, escapeHtml, italicize, normalizeRich, plainOf, sentenceCase, titleCase,
} from "./bibCase";
import { journalTitle } from "./journalAbbrev";

// ======================================================================== refusals & info

export class BibStyleRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BibStyleRefusal";
  }
}

export interface StyleInfo {
  id: StyleId;
  name: string;
  /** False: the style is not offered (no oracle). `reason` says why. */
  shipped: boolean;
  /** Item types with ≥3 pinned manual examples. Every other type is refused. */
  types: BibType[];
  reason?: string;
  /** Why particular types are refused, by type. */
  refusedTypes?: Partial<Record<BibType, string>>;
  /** Set when the style's guide gives no form for a locator in a citation: the reason. */
  noLocator?: string;
  sources: string[];
}

/**
 * Per-style rules the bibliography assembler (Builder 4) needs, so it does not have to
 * re-derive them. `compressRanges`: IEEE V 3.28.2025 says "Reference ranges in text will
 * not include an en dash … “[1]–[4]” will now be “[1], [2], [3], [4]”."
 */
export interface StyleRules {
  refEtAl: { max: number; keep: number } | null; // null = list every author
  citeEtAlMin: number | null; // in-text: this many authors or more → first author et al.
  compressRanges: boolean;
  /** Sort "van Beethoven" under V (true) or B (false). APA 7 9.8 example "van der Waal, P. N.". */
  sortParticleFirst: boolean | null;
}

export const STYLE_RULES: Record<StyleId, StyleRules> = {
  ieee: { refEtAl: { max: 6, keep: 1 }, citeEtAlMin: 3, compressRanges: false, sortParticleFirst: null },
  acs: { refEtAl: null, citeEtAlMin: null, compressRanges: true, sortParticleFirst: null },
  nature: { refEtAl: { max: 5, keep: 1 }, citeEtAlMin: null, compressRanges: true, sortParticleFirst: null },
  vancouver: { refEtAl: { max: 6, keep: 6 }, citeEtAlMin: null, compressRanges: true, sortParticleFirst: null },
  // Optica guide §3: "Always list the first three authors in references and use et al. if there are
  // additional authors"; "three or more consecutive references should be indicated by the bounding
  // numbers and an en dash [1–4]".
  optica: { refEtAl: { max: 3, keep: 3 }, citeEtAlMin: null, compressRanges: true, sortParticleFirst: null },
  apa7: { refEtAl: { max: 20, keep: 19 }, citeEtAlMin: 3, compressRanges: false, sortParticleFirst: true },
  "chicago-ad": { refEtAl: { max: 6, keep: 3 }, citeEtAlMin: 3, compressRanges: false, sortParticleFirst: null },
  "chicago-nb": { refEtAl: { max: 6, keep: 3 }, citeEtAlMin: 3, compressRanges: false, sortParticleFirst: null },
  "harvard-ctr": { refEtAl: null, citeEtAlMin: null, compressRanges: false, sortParticleFirst: null },
  mla9: { refEtAl: null, citeEtAlMin: null, compressRanges: false, sortParticleFirst: null },
};

const NO_ASSIGNEE = "the record contract has no assignee field";

export const STYLE_INFO: Record<StyleId, StyleInfo> = {
  ieee: {
    id: "ieee", name: "IEEE", shipped: true,
    types: ["article-journal", "book", "chapter", "paper-conference", "thesis", "report"],
    refusedTypes: {
      patent: "the IEEE Reference Guide (V 3.28.2025) has only two internally consistent patent examples "
        + "(Wilkinson, Black and Clavin); a third (Voinigescu) is missing its opening quotation mark",
      webpage: "the guide's website examples disagree on punctuation (“[Online.]” vs “[Online].”)",
    },
    sources: ["IEEE Reference Guide V 3.28.2025"],
  },
  acs: {
    id: "acs", name: "ACS", shipped: true,
    types: ["article-journal", "book", "chapter", "thesis"],
    refusedTypes: {
      patent: "the ACS Style Quick Guide (2026) shows only two patent examples (Lois-Caballe US7732193B2 and "
        + "US2003/0068821A1)",
    },
    sources: ["ACS Guide to Scholarly Communication 4.3.3, ACS Style Quick Guide (updated 2026-04-14)"],
  },
  nature: {
    id: "nature", name: "Nature", shipped: true,
    types: ["article-journal"],
    refusedTypes: {
      book: "nature.com guides give one book example (Jones, Soft Machines)",
      chapter: "nature.com guides give one chapter example (Smith, How to reference books)",
      patent: "nature.com guides give no patent example",
    },
    sources: ["nature.com Scientific Reports and Nature Chemistry author guidelines; Nature formatting guide"],
  },
  optica: {
    id: "optica", name: "Optica (Optics Letters, Optics Express, JOSA)", shipped: true,
    types: ["article-journal"],
    refusedTypes: {
      book: "the Optica style guide has one clean book example (Almond, Photothermal Science and Techniques)",
      chapter: "the Optica style guide's three chapter examples (Meola, Gaussorgues, Maldague) each have a "
        + "different shape, and one needs a chapter number (\"Chap. 3\") the record contract cannot hold",
      "paper-conference": "the Optica style guide has two conference examples, both the same Balageas paper; "
        + "a Proc. SPIE or Proc. IEEE paper is set like a journal article, so enter it as a journal article "
        + "with the journal abbreviation \"Proc. SPIE\"",
      patent: "the Optica style guide has two patent examples, both the same Sun patent",
      thesis: "the Optica style guide has one dissertation example (McKay)",
      report: "the Optica style guide has one report example (Lang and Bradley)",
      dataset: "the Optica style guide has two data examples (Partridge, Radosheich)",
      article: "the Optica style guide's three preprint examples (Optica Open, arXiv, university EPrint) "
        + "each have a different shape",
      webpage: "the Optica style guide has no web page example",
    },
    noLocator: "the Optica style guide gives no form for a page, figure or equation inside the citation "
      + "brackets. Cite the reference without a locator and name the place in the sentence (for example, "
      + "“Fig. 3 of [2]”)",
    sources: ["Optica Publishing Group Journal Style Guide §3 References and notes (updated 2026-08-20)"],
  },
  vancouver: {
    id: "vancouver", name: "Vancouver (NLM)", shipped: true,
    types: ["article-journal", "book", "chapter", "patent"],
    refusedTypes: {
      thesis: "NLM thesis examples carry an extent (\"436 p.\") the record contract cannot hold; only one "
        + "example (Borkowski) has none",
    },
    sources: ["NLM Samples of Formatted References (ICMJE)", "Citing Medicine, 2nd ed., chapters 2 and 7"],
  },
  apa7: {
    id: "apa7", name: "APA 7", shipped: true,
    types: ["article-journal", "book", "chapter"],
    refusedTypes: {
      thesis: "APA dissertation examples need the database name and publication number, which the record "
        + "contract cannot hold",
      patent: "apastyle.apa.org has no patent example page",
    },
    sources: ["apastyle.apa.org reference examples and elements of reference list entries"],
  },
  "chicago-ad": {
    id: "chicago-ad", name: "Chicago author-date (CMOS 18)", shipped: true,
    types: ["article-journal", "book"],
    refusedTypes: { chapter: "the CMOS 18 quick guide has one chapter example (Doyle)" },
    sources: ["CMOS 18 Citation Quick Guide, author-date"],
  },
  "chicago-nb": {
    id: "chicago-nb", name: "Chicago notes-bibliography (CMOS 18)", shipped: true,
    types: ["article-journal", "book"],
    refusedTypes: { chapter: "the CMOS 18 quick guide has one chapter example (Doyle)" },
    sources: ["CMOS 18 Citation Quick Guide, notes and bibliography"],
  },
  "harvard-ctr": {
    id: "harvard-ctr", name: "Harvard (Cite Them Right)", shipped: false, types: [],
    reason: "Cite Them Right (12th ed.) is a paid book and subscription site; no official examples could "
      + "be fetched to pin, so the style is not offered.",
    sources: [],
  },
  mla9: {
    id: "mla9", name: "MLA 9", shipped: false, types: [],
    reason: "No examples from the MLA Handbook or style.mla.org were fetched and pinned; a secondary guide "
      + "(Purdue OWL) is not the style's own manual, so the style is not offered.",
    sources: [],
  },
};

// ======================================================================== small helpers

const esc = escapeHtml;
const EN = String.fromCharCode(0x2013);

function out(html: string): Formatted {
  return { html, plain: plainOf(html) };
}

/** Text ending, looking through trailing tags: "…</i>" → last visible character. */
function lastVisible(html: string): string {
  const body = plainOf(html).replace(/\s+$/, "");
  return body.slice(-2);
}

/** True when the visible text already ends a sentence (". ? !", possibly inside a closing quote). */
function endsSentence(html: string): boolean {
  return /[.?!]["”’]?$/.test(lastVisible(html));
}

/** Add a period unless the text already ends a sentence; a closing ” gets the period inside. */
function period(html: string): string {
  if (!html) return html;
  if (endsSentence(html)) return html;
  const m = /(”)((?:<\/[a-z]+>)*)$/.exec(html);
  if (m) return html.slice(0, m.index) + "." + m[1] + m[2];
  return html + ".";
}

function joinNonEmpty(parts: Array<string | undefined | false | null>, sep: string): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(sep);
}

function yearOf(d: BibDate | undefined): string | null {
  const y = d?.["date-parts"]?.[0]?.[0];
  if (typeof y === "number" && Number.isFinite(y)) return String(y);
  if (d?.literal && d.literal.trim()) return d.literal.trim();
  return null;
}

function monthDay(d: BibDate | undefined): { m?: number; day?: number } {
  const p = d?.["date-parts"]?.[0];
  return { m: typeof p?.[1] === "number" ? p[1] : undefined, day: typeof p?.[2] === "number" ? p[2] : undefined };
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** "2" → "2nd", "3rd digital" → "3rd digital", "2nd ed." → "2nd". Caller appends " ed.". */
function editionText(ed: string | undefined): string {
  if (!ed) return "";
  const t = ed.trim().replace(/\s*(?:ed\.?|edn\.?|edition)$/i, "");
  if (/^\d+$/.test(t)) return ordinal(Number(t));
  return t;
}

function bareDoi(doi: string | undefined): string {
  if (!doi) return "";
  return doi.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
}

const richTitle = (s: string | undefined): string => normalizeRich(s);
const asSentence = (s: string | undefined, capSub: boolean): string =>
  normalizeRich(sentenceCase(s, { capitalizeSubtitle: capSub }));
const asHeadline = (s: string | undefined): string => normalizeRich(titleCase(s, { smallWords: CHICAGO_SMALL_WORDS }));

// ======================================================================== names

function initialsOf(given: string, mode: "dotted" | "nlm"): string {
  const parts = given.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const raw of parts) {
    // Already-initialised forms: "G.H.", "P.J.M.", "SD" (NLM-style initials, 2–3 capitals).
    if (/^(?:\p{Lu}\.){2,}$/u.test(raw) || /^\p{Lu}\.$/u.test(raw)) {
      for (const ch of raw.replace(/\./g, "")) out.push(mode === "dotted" ? `${ch}.` : ch);
      continue;
    }
    if (/^\p{Lu}{2,3}$/u.test(raw)) {
      for (const ch of raw) out.push(mode === "dotted" ? `${ch}.` : ch);
      continue;
    }
    // Hyphenated given names: Jean-Paul → J.-P. (dotted) / JP (NLM).
    // Each part's initial is a capital, whatever the romanisation's case ("Min-jun" → M.-J.).
    const hy = raw.split(/-/).filter(Boolean).map((h) => (Array.from(h.replace(/\./g, ""))[0] ?? "").toUpperCase());
    if (mode === "dotted") out.push(hy.map((c) => `${c}.`).join("-"));
    else out.push(hy.join(""));
  }
  return mode === "dotted" ? out.join(" ") : out.join("");
}

const familyOf = (n: BibName): string => joinNonEmpty([n["non-dropping-particle"], n.family], " ");

function nlmSuffix(s: string): string {
  const t = s.trim().replace(/\.$/, "");
  const map: Record<string, string> = { II: "2nd", III: "3rd", IV: "4th", V: "5th" };
  return map[t] ?? t;
}

type NameForm = "initials-first" | "inverted-initials" | "nlm" | "inverted-full" | "full";

function nameText(n: BibName, form: NameForm): string {
  if (n.literal && n.literal.trim()) return n.literal.trim();
  const fam = familyOf(n);
  const given = n.given?.trim() ?? "";
  const dp = n["dropping-particle"]?.trim();
  const suf = n.suffix?.trim();
  if (!fam) return given;
  switch (form) {
    case "initials-first": {
      const ini = given ? initialsOf(given, "dotted") : "";
      return joinNonEmpty([ini, dp, fam, suf], " ");
    }
    case "inverted-initials": {
      const ini = given ? initialsOf(given, "dotted") : "";
      const g = joinNonEmpty([ini, dp], " ");
      return joinNonEmpty([fam, g, suf], ", ");
    }
    case "nlm": {
      const ini = given ? initialsOf(given, "nlm") : "";
      return joinNonEmpty([joinNonEmpty([dp, fam], " "), ini, suf ? nlmSuffix(suf) : ""], " ");
    }
    case "inverted-full": {
      const g = joinNonEmpty([given, dp], " ");
      return joinNonEmpty([fam, g, suf], ", ");
    }
    case "full":
      // CMOS 17 §6.43: "Jr.", "III" take no comma in normal order ("Martin
      // Luther King Jr."); the inverted form keeps one ("King, Martin Luther,
      // Jr."). Used by Chicago only; citeproc's chicago CSL agrees.
      return joinNonEmpty([given, dp, fam, suf], " ");
    default:
      return fam;
  }
}

/** Family-name form for in-text citations and short notes. */
const citeName = (n: BibName): string => (n.literal && n.literal.trim() ? n.literal.trim() : familyOf(n) || n.given || "");

/** "A, B, and C" / "A and B" (serial comma). */
function serialAnd(items: string[], word = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${word} ${items[items.length - 1]}`;
}

/** The people a reference is "by": authors, or the editors when there are none. */
function creators(rec: BibRecord): { names: BibName[]; editors: boolean } {
  if (rec.author && rec.author.length) return { names: rec.author, editors: false };
  if (rec.editor && rec.editor.length) return { names: rec.editor, editors: true };
  return { names: [], editors: false };
}

// ======================================================================== locators

function locatorText(item: CiteItem, style: "ieee" | "apa" | "chicago" | "plain"): string {
  const loc = item.locator?.trim();
  if (!loc) return "";
  const range = isPageRange(loc);
  switch (item.label) {
    case "figure":
      return style === "apa" ? `Figure ${loc}` : style === "chicago" ? `fig. ${loc}` : `Fig. ${loc}`;
    case "equation":
      return style === "ieee" ? `eq. (${loc})` : style === "apa" ? `Equation ${loc}` : `eq. ${loc}`;
    case "chapter":
      return style === "apa" ? `Chapter ${loc}` : style === "chicago" ? `chap. ${loc}` : `Ch. ${loc}`;
    case "page":
    case undefined:
      if (item.label === undefined && !/^[\divxlcdm\-–—,\s]+$/i.test(loc)) return loc; // free text ("chap. 10, doc. 19")
      if (style === "chicago") return formatPages(loc, "chicago");
      return `${range ? "pp." : "p."} ${formatPages(loc, "full")}`;
    default:
      return loc;
  }
}

// ======================================================================== numeric markers

function numbersOf(items: Array<{ n?: number }>): number[] {
  return items.map((i) => i.n).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** "1,3–5" — runs of three or more consecutive numbers become ranges (§C3). */
export function compressNumbers(nums: number[], sep = ","): string {
  const s = Array.from(new Set(nums)).sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    if (j - i >= 2) parts.push(`${s[i]}${EN}${s[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(s[k]));
    i = j + 1;
  }
  return parts.join(sep);
}

function superscriptMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>): Formatted {
  const nums = compressNumbers(numbersOf(items));
  const locs = items.map((i) => locatorText(i.item, "plain")).filter(Boolean);
  const html = `<sup>${esc(nums)}</sup>` + (locs.length ? ` (${esc(locs.join("; "))})` : "");
  return out(html);
}

// ======================================================================== shared guards

/** The reader's name for a CSL type ("article" is CSL's preprint/unpublished article). */
const TYPE_LABEL: Record<BibType, string> = {
  "article-journal": "journal article", book: "book", chapter: "book chapter", "paper-conference": "conference paper",
  thesis: "thesis", report: "report", webpage: "web page", dataset: "dataset", article: "preprint", patent: "patent",
};

/** "a patent", "an article": the type label with its indefinite article. */
export function typePhrase(t: BibType): string {
  const label = TYPE_LABEL[t] ?? String(t);
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

function guard(id: StyleId, rec: BibRecord): void {
  const info = STYLE_INFO[id];
  if (!info.shipped) throw new BibStyleRefusal(`${info.name} is not available: ${info.reason}`);
  if (!info.types.includes(rec.type)) {
    const why = info.refusedTypes?.[rec.type];
    throw new BibStyleRefusal(
      `${info.name} cannot format ${typePhrase(rec.type)} reference${why ? `: ${why}` : ": no examples of this type were "
        + "found in the style's own guide"}. Choose another style for this reference.`,
    );
  }
}

// ======================================================================== IEEE

const IEEE_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];

/** IEEE date. A periodical (journal article) gives "Abbrev. Month year" only —
 *  IEEE Reference Guide, Periodicals; citeproc's ieee.csl agrees ("Feb. 2013")
 *  — so `withDay` is false there; other types keep the day. */
function ieeeDate(d: BibDate | undefined, withDay = true): string {
  const y = yearOf(d);
  if (!y) return "(n.d.)";
  const { m, day } = monthDay(d);
  if (!m || m < 1 || m > 12) return y;
  return day && withDay ? `${IEEE_MONTHS[m - 1]} ${day}, ${y}` : `${IEEE_MONTHS[m - 1]} ${y}`;
}

function ieeeNames(names: BibName[], etAl: boolean): string {
  if (!names.length) return "";
  const r = STYLE_RULES.ieee.refEtAl!;
  if (etAl || names.length > r.max) return `${esc(nameText(names[0], "initials-first"))} et al.`;
  return esc(serialAnd(names.map((n) => nameText(n, "initials-first"))));
}

// Database index pages describe a record; they are not where the work is available.
const INDEX_HOSTS = /(?:^|\.)(?:scopus\.com|webofscience\.com|webofknowledge\.com|isiknowledge\.com|scholar\.google\.[a-z.]+|semanticscholar\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov)$/i;

/**
 * The URL worth printing next to the record's DOI, or "" when the URL adds nothing: a doi.org
 * link to the same DOI (Crossref, Mendeley and Zotero exports carry one), or, when a DOI exists,
 * a bibliographic-database index page (Scopus, Web of Science, PubMed …).
 */
export function usefulUrl(rec: BibRecord): string {
  const url = rec.URL?.trim() ?? "";
  if (!url) return "";
  const doi = bareDoi(rec.DOI).toLowerCase();
  if (!doi) return url;
  if (bareDoi(url).toLowerCase() === doi) return "";
  let host = "";
  try { host = new URL(url).hostname; } catch { host = ""; }
  if (/(?:^|\.)doi\.org$/i.test(host)) return "";
  if (INDEX_HOSTS.test(host)) return "";
  return url;
}

function ieeeOnline(rec: BibRecord): string {
  const url = usefulUrl(rec);
  return url ? ` [Online]. Available: ${esc(url)}` : "";
}

/**
 * A title printed inside double quotes takes SINGLE quotes for any quotation of its own
 * (“The ‘Hello World’ Program,”): every style here that quotes titles follows that rule. Straight
 * and curly double quotes in the title text become ‘ and ’; quotes inside HTML tags (attribute
 * values) are left alone.
 */
function nestQuotes(html: string): string {
  // Direction by context, as typesetters do: a quote right after a letter, digit or closing
  // punctuation closes; anywhere else (start, space, opening bracket) it opens. The context
  // is the previous VISIBLE character, so a tag between (“<i>lac</i>”) does not reset it.
  let prev = "";
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<")) return part;
      let out = "";
      for (const ch of part) {
        if (ch === "“") out += "‘";
        else if (ch === "”") out += "’";
        else if (ch === '"') out += prev && !/[\s([{—–-]/.test(prev) ? "’" : "‘";
        else out += ch;
        prev = ch;
      }
      return out;
    })
    .join("");
}

function ieeeReference(rec: BibRecord): Formatted {
  guard("ieee", rec);
  const etAl = !!rec["et-al-in-source"];
  const { names, editors } = creators(rec);
  const by = ieeeNames(names, etAl);
  const t = nestQuotes(richTitle(rec.title));
  const quoted = t ? `“${t},”` : "";
  const doi = bareDoi(rec.DOI);
  const pages = rec.page ? `${isPageRange(rec.page) ? "pp." : "p."} ${formatPages(rec.page, "full")}` : "";
  const place = rec["publisher-place"] ? esc(rec["publisher-place"].trim()) : "";
  const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
  const year = yearOf(rec.issued) ?? "(n.d.)";
  const ed = editionText(rec.edition);
  let html = "";
  switch (rec.type) {
    case "article-journal": {
      const j = journalTitle(rec, "abbrev").text;
      const tail = joinNonEmpty([
        j ? italicize(normalizeRich(j)) : "",
        rec.volume ? `vol. ${esc(rec.volume)}` : "",
        rec.issue ? `no. ${esc(rec.issue)}` : "",
        rec["article-number"] ? "" : pages,
        ieeeDate(rec.issued, false),
        rec["article-number"] ? `Art. no. ${esc(rec["article-number"])}` : "",
        doi ? `doi: ${esc(doi)}` : "",
      ], ", ");
      html = joinNonEmpty([by ? `${by},` : "", quoted, tail], " ") + ".";
      break;
    }
    case "paper-conference": {
      const c = journalTitle(rec, "abbrev").text;
      const tail = joinNonEmpty([
        c ? `in ${italicize(normalizeRich(c))}` : "",
        place,
        ieeeDate(rec.issued),
        pages,
        doi ? `doi: ${esc(doi)}` : "",
      ], ", ");
      html = joinNonEmpty([by ? `${by},` : "", quoted, tail], " ") + ".";
      break;
    }
    case "book": {
      const who = editors ? `${by}, ${names.length > 1 && !etAl ? "Eds." : "Ed."}` : by ? `${by},` : "";
      const head = editors ? `${who} ${italicize(t)}` : joinNonEmpty([who, italicize(t)], " ");
      const titled = ed ? `${head}, ${esc(ed)} ed.` : head;
      const imprint = joinNonEmpty([place && pub ? `${place}: ${pub}` : place || pub, year], ", ");
      // "3rd ed." already ends the element — never "3rd ed.." (IEEE Reference Guide).
      html = `${titled}${/[.?!]$/.test(titled) ? "" : "."} ${imprint}.`;
      break;
    }
    case "chapter": {
      const book = italicize(richTitle(rec["container-title"]));
      const eds = rec.editor && rec.editor.length
        ? `${ieeeNames(rec.editor, false)}, ${rec.editor.length > 1 ? "Eds." : "Ed."},` : "";
      let inPart = `in ${book}${rec.volume ? `, vol. ${esc(rec.volume)}` : ""}`;
      if (eds) inPart += `, ${eds}`;
      if (ed) inPart += `${eds ? " " : ", "}${esc(ed)} ed.`;
      const sep = (eds && !ed) || /[.?!]$/.test(inPart) ? " " : ". ";
      const imprint = joinNonEmpty([place && pub ? `${place}: ${pub}` : place || pub, year, pages], ", ");
      html = joinNonEmpty([by ? `${by},` : "", quoted, inPart], " ") + sep + imprint + ".";
      break;
    }
    case "thesis": {
      const tail = joinNonEmpty([esc(rec.genre?.trim() || "Thesis"), pub, place, year], ", ");
      html = joinNonEmpty([by ? `${by},` : "", quoted, tail], " ") + ".";
      break;
    }
    case "report": {
      const num = joinNonEmpty([esc(rec.genre?.trim() || "Rep."), rec.number ? esc(rec.number.trim()) : ""], " ");
      const tail = joinNonEmpty([pub, place, num, ieeeDate(rec.issued), rec.volume ? `vol. ${esc(rec.volume)}` : ""], ", ");
      html = joinNonEmpty([by ? `${by},` : "", quoted, tail], " ") + ".";
      break;
    }
    default:
      throw new BibStyleRefusal(`IEEE cannot format ${typePhrase(rec.type)} reference.`);
  }
  return out(html + ieeeOnline(rec));
}

function ieeeMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>): Formatted {
  // IEEE V 3.28.2025: "[2], [4], [5]"; never "[1]–[4]"; locators "[3, pp. 5–10]", "[3, Fig. 1]".
  // Ascending, as in the guide's own examples; unnumbered items keep their place at the end.
  const sorted = items.map((x, i) => ({ x, i })).sort((a, b) =>
    (a.x.n ?? Infinity) - (b.x.n ?? Infinity) || a.i - b.i).map((e) => e.x);
  const parts = sorted.map(({ n, item }) => {
    const loc = locatorText(item, "ieee");
    return `[${n ?? "?"}${loc ? `, ${loc}` : ""}]`;
  });
  return out(esc(parts.join(", ")));
}

// ======================================================================== ACS

function acsNames(names: BibName[], etAl: boolean): string {
  if (!names.length) return "";
  const list = names.map((n) => nameText(n, "inverted-initials"));
  if (etAl) list.push("et al.");
  return period(esc(list.join("; ")));
}

function acsReference(rec: BibRecord): Formatted {
  guard("acs", rec);
  const by = acsNames(rec.author ?? [], !!rec["et-al-in-source"]);
  const t = richTitle(rec.title);
  const year = yearOf(rec.issued);
  const doi = bareDoi(rec.DOI);
  const doiTail = doi ? ` DOI: ${esc(doi)}` : rec.URL ? ` ${esc(rec.URL.trim())}` : "";
  const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
  const place = rec["publisher-place"] ? esc(rec["publisher-place"].trim()) : "";
  const imprint = joinNonEmpty([pub && place ? `${pub}: ${place}` : pub || place, year ?? ""], ", ");
  const ed = editionText(rec.edition);
  const pp = rec.page ? `${isPageRange(rec.page) ? "pp" : "p"} ${formatPages(rec.page, "full")}` : "";
  let html: string;
  switch (rec.type) {
    case "article-journal": {
      const j = journalTitle(rec, "full").text;
      const vol = rec.volume ? `<i>${esc(rec.volume)}</i>${rec.issue ? ` (${esc(rec.issue)})` : ""}` : "";
      const loc = rec["article-number"] ? esc(rec["article-number"]) : rec.page ? formatPages(rec.page, "full") : "";
      const src = joinNonEmpty([
        joinNonEmpty([j ? italicize(normalizeRich(j)) : "", year ? `<b>${esc(year)}</b>` : ""], " "),
        vol, loc,
      ], ", ");
      html = joinNonEmpty([by, period(t), period(src)], " ") + doiTail;
      break;
    }
    case "book": {
      const head = `${italicize(t)}${ed ? `, ${esc(ed)} ed.` : ""}`;
      const eds = !by && rec.editor?.length
        ? `${esc(rec.editor.map((n) => nameText(n, "inverted-initials")).join(", "))}, ${rec.editor.length > 1 ? "Eds." : "Ed."}` : "";
      html = joinNonEmpty([by, `${joinNonEmpty([head, eds, imprint], "; ")}.`], " ") + doiTail;
      break;
    }
    case "chapter": {
      const book = `${italicize(richTitle(rec["container-title"]))}${ed ? `, ${esc(ed)} ed.` : ""}`;
      const eds = rec.editor?.length
        ? `${esc(rec.editor.map((n) => nameText(n, "inverted-initials")).join(", "))}, ${rec.editor.length > 1 ? "Eds." : "Ed."}` : "";
      const where = joinNonEmpty([rec.volume ? `Vol. ${esc(rec.volume)}` : "", pp], ", ");
      html = joinNonEmpty([by, period(t), `${joinNonEmpty([book, eds, imprint, where], "; ")}.`], " ") + doiTail;
      break;
    }
    case "thesis": {
      const tail = joinNonEmpty([esc(rec.genre?.trim() || "Thesis"), pub, year ?? ""], ", ");
      html = joinNonEmpty([by, period(t), `${tail}.`], " ") + doiTail;
      break;
    }
    default:
      throw new BibStyleRefusal(`ACS cannot format ${typePhrase(rec.type)} reference.`);
  }
  return out(html);
}

// ======================================================================== Nature

function natureNames(names: BibName[], etAl: boolean): string {
  if (!names.length) return "";
  const r = STYLE_RULES.nature.refEtAl!;
  const list = names.map((n) => nameText(n, "inverted-initials"));
  if (etAl || names.length > r.max) return period(esc(`${list[0]} et al.`));
  if (list.length === 1) return period(esc(list[0]));
  return period(esc(`${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`));
}

function natureReference(rec: BibRecord): Formatted {
  guard("nature", rec);
  const by = natureNames(rec.author ?? [], !!rec["et-al-in-source"]);
  const t = period(richTitle(rec.title)); // "written exactly as it appears in the work cited"
  const j = journalTitle(rec, "abbrev").text;
  const year = yearOf(rec.issued);
  const doi = bareDoi(rec.DOI);
  const loc = rec["article-number"]
    ? `${esc(rec["article-number"])}${doi ? `; ${esc(doi)}` : ""}`
    : rec.page ? formatPages(rec.page, "full") : "";
  const vol = rec.volume ? `<b>${esc(rec.volume)}${loc ? "," : ""}</b>` : "";
  const src = joinNonEmpty([j ? italicize(normalizeRich(j)) : "", vol, loc, year ? `(${esc(year)})` : ""], " ");
  return out(period(joinNonEmpty([by, t, src], " ")));
}

// ======================================================================== Optica (formerly OSA)
//
// Optica Publishing Group Journal Style Guide §3 "References and notes", the one guide for all
// Optica journals (Optics Letters, Optics Express, Optica, JOSA A/B, Applied Optics …):
//   T. Wang, Y. Ge, J. Chang, <em>et al.</em>, "Wavelength-interrogation …," IEEE Photon. Technol.
//     Lett. <strong>28,</strong> 3-6 (2016).
//   C. Gomez, R. Su, P. de Groot, <em>et al.</em>, "Noise reduction …," Nanomanuf. Metrol.
//     <strong>3</strong>(2), 1-12 (2020).
//   L. Deck and J. A. Soobitsky, "Phase-shifting …," Proc. SPIE <strong>3782,</strong> 432-442 (1999).
//   5. W. S. Haddad, D. Cullen, J. C. Solem, et al., Appl. Opt. 31, 4973-4980 (1992).
// So: initials first; "A and B" / "A, B, and C"; more than three → first three, et al. (italic in
// the formatted examples); title as given in quotes with the comma inside; journal abbreviation
// in roman (never invented: container-title-short or the full title plus a warning); volume bold
// with the comma inside the bold, or "<b>3</b>(2)," with an issue; pages or article number;
// "(year)". The guide's journal examples print no DOI or URL, so none is printed. The web page is
// typed in ASCII (hyphen ranges, straight quotes, "--" for a dash); the output uses the en dash
// (display contract) and curly quotes, as the journals print them.

function opticaNames(names: BibName[], etAl: boolean): string {
  if (!names.length) return "";
  const r = STYLE_RULES.optica.refEtAl!;
  const list = names.map((n) => esc(nameText(n, "initials-first")));
  if (names.length > r.max) return `${list.slice(0, r.keep).join(", ")}, <i>et al.</i>`;
  if (etAl) return `${list.join(", ")}, <i>et al.</i>`;
  return serialAnd(list);
}

function opticaReference(rec: BibRecord): Formatted {
  guard("optica", rec);
  const by = opticaNames(rec.author ?? [], !!rec["et-al-in-source"]);
  const t = richTitle(rec.title);
  const j = journalTitle(rec, "abbrev").text;
  const year = yearOf(rec.issued);
  const loc = rec["article-number"]?.trim() ? esc(rec["article-number"].trim()) : rec.page ? formatPages(rec.page, "full") : "";
  const vol = rec.volume?.trim() ? esc(rec.volume.trim()) : "";
  const iss = rec.issue?.trim() ? esc(rec.issue.trim()) : "";
  // "<b>28,</b> 3–6" / "<b>3</b>(2), 1–12" / "<b>31</b>" / "Optica Open, 100004" (no volume).
  let volLoc: string;
  if (vol) {
    if (iss) volLoc = `<b>${vol}</b>(${iss})${loc ? `, ${loc}` : ""}`;
    else volLoc = loc ? `<b>${vol},</b> ${loc}` : `<b>${vol}</b>`;
  } else {
    volLoc = loc;
  }
  const jPart = j ? normalizeRich(j) : "";
  const src = vol ? joinNonEmpty([jPart, volLoc], " ") : joinNonEmpty([jPart, volLoc], ", ");
  const tail = joinNonEmpty([src, year ? `(${esc(year)})` : ""], " ");
  const tq = nestQuotes(t);
  const quoted = tq ? (tail ? (/[?!]$/.test(plainOf(tq)) ? `“${tq}”` : `“${tq},”`) : period(`“${tq}”`)) : "";
  const head = joinNonEmpty([quoted, tail], " ");
  const html = by ? (head ? `${by}, ${head}` : by) : head;
  return out(period(html));
}

function opticaMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>): Formatted {
  // Optica guide §3: "Two references [2,3] should be included together, separated by a comma, and
  // three or more consecutive references should be indicated by the bounding numbers and an en
  // dash [1–4]." The guide gives no form for a page or figure locator inside the brackets, so none
  // is invented: a new citation with a locator is refused at insert (bibPane planInsert, via
  // STYLE_INFO.optica.noLocator), and a locator carried over from another style is left out of the
  // marker, which still gets its CORRECT number (refusing here would leave a stale number in the
  // document), and is reported by name (bibPane planUpdate).
  const nums = compressNumbers(numbersOf(items));
  const unknown = items.some((i) => typeof i.n !== "number" || !Number.isFinite(i.n));
  return out(esc(`[${joinNonEmpty([nums, unknown ? "?" : ""], ",")}]`));
}

// ======================================================================== Vancouver / NLM

const NLM_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function nlmDate(d: BibDate | undefined): string {
  const y = yearOf(d);
  if (!y) return "";
  const { m, day } = monthDay(d);
  if (!m || m < 1 || m > 12) return y;
  return joinNonEmpty([y, NLM_MONTHS[m - 1], day ? String(day) : ""], " ");
}

function nlmNames(names: BibName[], etAl: boolean, max: number): string {
  if (!names.length) return "";
  const list = names.map((n) => nameText(n, "nlm"));
  if (names.length > max) return esc(`${list.slice(0, max).join(", ")}, et al`);
  if (etAl) return esc(`${list.join(", ")}, et al`);
  return esc(list.join(", "));
}

const NLM_COUNTRY: Record<string, string> = { US: "United States", "U.S.": "United States", USA: "United States",
  GB: "United Kingdom", UK: "United Kingdom", "U.K.": "United Kingdom" };

export interface VancouverOptions {
  /** List this many authors, then "et al." (ICMJE sample page: six; NLM itself now lists all). */
  maxAuthors?: number;
}

function vancouverReferenceWith(max: number) {
  return (rec: BibRecord): Formatted => {
    guard("vancouver", rec);
    const etAl = !!rec["et-al-in-source"];
    const auth = rec.author ?? [];
    const by = nlmNames(auth, etAl, max);
    const t = asSentence(rec.title, false);
    const place = rec["publisher-place"] ? esc(rec["publisher-place"].trim()) : "";
    const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
    const year = yearOf(rec.issued) ?? "";
    const ed = editionText(rec.edition);
    const edPart = ed ? `${esc(ed)} ed.` : "";
    const imprintCore = joinNonEmpty([joinNonEmpty([place, pub], ": "), esc(year)], "; ");
    const imprint = imprintCore ? `${imprintCore}.` : "";
    const edsOf = (eds: BibName[]): string =>
      `${esc(eds.map((n) => nameText(n, "nlm")).join(", "))}, ${eds.length > 1 ? "editors" : "editor"}.`;
    let html: string;
    switch (rec.type) {
      case "article-journal": {
        const j = journalTitle(rec, "abbrev-nlm").text;
        const vol = `${rec.volume ? esc(rec.volume) : ""}${rec.issue ? `(${esc(rec.issue)})` : ""}`;
        const loc = rec["article-number"] ? esc(rec["article-number"]) : rec.page ? formatPages(rec.page, "nlm") : "";
        const date = nlmDate(rec.issued);
        const core = `${date}${vol ? `${date ? ";" : ""}${vol}` : ""}${loc ? `:${loc}` : ""}`;
        html = joinNonEmpty([by ? `${by}.` : "", period(t), j ? period(normalizeRich(j)) : "", core ? `${core}.` : ""], " ");
        break;
      }
      case "book": {
        const who = by ? `${by}.` : rec.editor?.length ? edsOf(rec.editor) : "";
        const eds = by && rec.editor?.length ? edsOf(rec.editor) : "";
        html = joinNonEmpty([who, period(t), edPart, eds, imprint], " ");
        break;
      }
      case "chapter": {
        const book = period(asSentence(rec["container-title"], false));
        const eds = rec.editor?.length ? `In: ${edsOf(rec.editor)}` : "In:";
        const pages = rec.page ? ` p. ${formatPages(rec.page, "nlm")}.` : "";
        html = joinNonEmpty([by ? `${by}.` : "", period(t), eds, book, edPart, imprint], " ") + pages;
        break;
      }
      case "patent": {
        // Contract convention (no assignee field): the ASSIGNEE is carried in `publisher`.
        const inv = by ? `${by}, ${auth.length > 1 ? "inventors" : "inventor"};` : "";
        const asg = pub ? `${pub}, assignee.` : "";
        const who = inv && !asg ? `${inv.slice(0, -1)}.` : joinNonEmpty([inv, asg], " ");
        const auth2 = rec.authority?.trim() ?? "";
        const country = NLM_COUNTRY[auth2] ?? auth2;
        const num = rec.number ? esc(rec.number.trim()) : "";
        const pat = `${joinNonEmpty([esc(country), "patent", num], " ")}.`;
        html = joinNonEmpty([who, period(t), pat, nlmDate(rec.issued) ? `${nlmDate(rec.issued)}.` : ""], " ");
        break;
      }
      default:
        throw new BibStyleRefusal(`Vancouver cannot format ${typePhrase(rec.type)} reference.`);
    }
    return out(html);
  };
}

function vancouverMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>): Formatted {
  const nums = compressNumbers(numbersOf(items));
  const locs = items.map((i) => locatorText(i.item, "plain")).filter(Boolean);
  return out(esc(`(${nums}${locs.length ? `, ${locs.join("; ")}` : ""})`));
}

// ======================================================================== APA 7

function apaNames(names: BibName[], etAl: boolean): string {
  const list = names.map((n) => nameText(n, "inverted-initials"));
  if (!list.length) return "";
  const r = STYLE_RULES.apa7.refEtAl!;
  // apastyle.apa.org: "21 or more authors, include the first 19 authors’ names, insert an
  // ellipsis (but no ampersand), and then add the final author’s name."
  if (list.length > r.max) return `${list.slice(0, r.keep).join(", ")}, . . . ${list[list.length - 1]}`;
  if (etAl) return `${list.join(", ")}, et al.`;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
}

/** "R. F. Subotnik, P. Olszewski-Kubilius, & F. C. Worrell" / "E. Hygum & P. M. Pedersen". */
function apaEditorsInline(eds: BibName[]): string {
  const list = eds.map((n) => nameText(n, "initials-first"));
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
}

function apaLink(rec: BibRecord): string {
  const doi = bareDoi(rec.DOI);
  if (doi) return ` https://doi.org/${esc(doi)}`;
  return rec.URL ? ` ${esc(rec.URL.trim())}` : "";
}

function apaReference(rec: BibRecord): Formatted {
  guard("apa7", rec);
  const { names, editors } = creators(rec);
  let who = esc(apaNames(names, !!rec["et-al-in-source"]));
  if (editors && who) who += ` (${names.length > 1 ? "Eds." : "Ed."})`;
  const head = `${who ? `${period(who)} ` : ""}(${esc(yearOf(rec.issued) ?? "n.d.")}).`;
  const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
  const ed = editionText(rec.edition);
  let body: string;
  switch (rec.type) {
    case "article-journal": {
      const t = period(asSentence(rec.title, true));
      const j = journalTitle(rec, "full").text;
      const vol = rec.volume ? `<i>${esc(rec.volume)}</i>${rec.issue ? `(${esc(rec.issue)})` : ""}` : "";
      const loc = rec["article-number"] ? `Article ${esc(rec["article-number"])}` : rec.page ? formatPages(rec.page, "full") : "";
      const src = joinNonEmpty([j ? italicize(normalizeRich(j)) : "", vol, loc], ", ");
      body = joinNonEmpty([t, src ? `${src}.` : ""], " ");
      break;
    }
    case "book": {
      const t = italicize(asSentence(rec.title, true));
      const titled = `${t}${ed ? ` (${esc(ed)} ed.)` : ""}`;
      body = joinNonEmpty([period(titled), pub ? `${pub}.` : ""], " ");
      break;
    }
    case "chapter": {
      const t = period(asSentence(rec.title, true));
      const eds = rec.editor?.length
        ? `In ${esc(apaEditorsInline(rec.editor))} (${rec.editor.length > 1 ? "Eds." : "Ed."}),` : "In";
      const pages = rec.page ? `${isPageRange(rec.page) ? "pp." : "p."} ${formatPages(rec.page, "full")}` : "";
      const paren = joinNonEmpty([ed ? `${esc(ed)} ed.` : "", pages], ", ");
      const book = `${italicize(asSentence(rec["container-title"], true))}${paren ? ` (${paren})` : ""}`;
      body = joinNonEmpty([t, eds, period(book), pub ? `${pub}.` : ""], " ");
      break;
    }
    default:
      throw new BibStyleRefusal(`APA 7 cannot format ${typePhrase(rec.type)} reference.`);
  }
  return out(`${joinNonEmpty([head, body], " ")}${apaLink(rec)}`);
}

function apaCiteNames(rec: BibRecord, narrative: boolean): string {
  const { names } = creators(rec);
  const fams = names.map(citeName);
  if (!fams.length) return plainOf(richTitle(rec.title));
  if (fams.length >= 3 || rec["et-al-in-source"]) return `${fams[0]} et al.`;
  if (fams.length === 2) return `${fams[0]} ${narrative ? "and" : "&"} ${fams[1]}`;
  return fams[0];
}

function apaMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>, opts?: { narrative?: boolean }): Formatted {
  const narrative = !!opts?.narrative;
  const parts = items.map(({ rec, item }) => {
    const year = yearOf(rec.issued) ?? "n.d.";
    const loc = locatorText(item, "apa");
    if (narrative) {
      const inner = joinNonEmpty([year, loc], ", ");
      return joinNonEmpty([item.prefix, item.suppressAuthor ? `(${inner})` : `${apaCiteNames(rec, true)} (${inner})`, item.suffix], " ");
    }
    const core = joinNonEmpty([item.suppressAuthor ? "" : apaCiteNames(rec, false), year, loc], ", ");
    return joinNonEmpty([item.prefix, core, item.suffix], " ");
  });
  if (narrative) return out(esc(serialAnd(parts)));
  return out(esc(`(${parts.join("; ")})`));
}

// ======================================================================== Chicago (AD and NB)

function chicagoBibNames(names: BibName[], etAl: boolean, editors: boolean): string {
  if (!names.length) return "";
  const r = STYLE_RULES["chicago-ad"].refEtAl!;
  const inv = nameText(names[0], "inverted-full");
  const rest = names.slice(1).map((n) => nameText(n, "full"));
  let s: string;
  if (etAl || names.length > r.max) {
    s = `${[inv, ...rest.slice(0, r.keep - 1)].join(", ")}, et al.`;
  } else if (names.length === 1) {
    s = inv;
  } else if (names.length === 2) {
    s = `${inv}, and ${rest[0]}`;
  } else {
    s = `${[inv, ...rest.slice(0, -1)].join(", ")}, and ${rest[rest.length - 1]}`;
  }
  if (editors) s += names.length > 1 ? ", eds" : ", ed";
  return period(esc(s));
}

function chicagoQuoted(title: string): string {
  // Period inside the closing quote, unless the title ends in ? or !.
  const t = nestQuotes(title);
  return /[?!]$/.test(plainOf(t)) ? `“${t}”` : `“${t}.”`;
}

function chicagoLink(rec: BibRecord): string {
  const doi = bareDoi(rec.DOI);
  if (doi) return ` https://doi.org/${esc(doi)}.`;
  return rec.URL ? ` ${esc(rec.URL.trim())}.` : "";
}

/**
 * A non-numeric date in Chicago: CMOS uses "forthcoming" for in-press work. In author-date the
 * date stands as its own sentence, so it is capitalised ("Forthcoming.", "N.d." is kept as "n.d.").
 */
function chicagoYear(year: string, system: "ad" | "nb"): string {
  if (/^\d/.test(year) || year === "n.d.") return year;
  const y = /^(?:in press|forthcoming)$/i.test(year.trim()) ? "forthcoming" : year.trim();
  return system === "ad" ? y.charAt(0).toUpperCase() + y.slice(1) : y;
}

function chicagoReference(rec: BibRecord, system: "ad" | "nb"): Formatted {
  guard(system === "ad" ? "chicago-ad" : "chicago-nb", rec);
  const { names, editors } = creators(rec);
  const by = chicagoBibNames(names, !!rec["et-al-in-source"], editors);
  const year = chicagoYear(yearOf(rec.issued) ?? "n.d.", system);
  const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
  const ed = editionText(rec.edition);
  let html: string;
  switch (rec.type) {
    case "article-journal": {
      const t = rec.title ? chicagoQuoted(asHeadline(rec.title)) : "";
      const jt = journalTitle(rec, "full").text;
      const j = jt ? italicize(normalizeRich(jt)) : "";
      const loc = rec["article-number"] ? esc(rec["article-number"]) : rec.page ? formatPages(rec.page, "chicago") : "";
      let src: string;
      if (system === "ad") {
        const vol = `${rec.volume ? esc(rec.volume) : ""}${rec.issue ? `${rec.volume ? " " : ""}(${esc(rec.issue)})` : ""}`;
        src = joinNonEmpty([j, vol], " ") + (loc ? `: ${loc}` : "");
        html = joinNonEmpty([by, period(esc(year)), t, src ? period(src) : ""], " ");
      } else {
        const vol = joinNonEmpty([rec.volume ? esc(rec.volume) : "", rec.issue ? `no. ${esc(rec.issue)}` : ""], ", ");
        src = `${joinNonEmpty([j, vol, `(${esc(year)})`], " ")}${loc ? `: ${loc}` : ""}`;
        html = joinNonEmpty([by, t, period(src)], " ");
      }
      break;
    }
    case "book": {
      const t = rec.title ? period(italicize(asHeadline(rec.title))) : "";
      const edPart = ed ? `${esc(ed)} ed.` : "";
      if (system === "ad") {
        html = joinNonEmpty([by, period(esc(year)), t, edPart, pub ? `${pub}.` : ""], " ");
      } else {
        html = joinNonEmpty([by, t, edPart, `${joinNonEmpty([pub, esc(year)], ", ")}.`], " ");
      }
      break;
    }
    default:
      throw new BibStyleRefusal(`Chicago cannot format ${typePhrase(rec.type)} reference.`);
  }
  return out(html + chicagoLink(rec));
}

function chicagoCiteNames(rec: BibRecord): string {
  const fams = creators(rec).names.map(citeName);
  if (!fams.length) return plainOf(richTitle(rec.title));
  if (fams.length >= 3 || rec["et-al-in-source"]) return `${fams[0]} et al.`;
  return fams.join(" and ");
}

function chicagoAdMarker(items: Array<{ rec: BibRecord; n?: number; item: CiteItem }>, opts?: { narrative?: boolean }): Formatted {
  const parts = items.map(({ rec, item }) => {
    const year = yearOf(rec.issued) ?? "n.d.";
    const loc = locatorText(item, "chicago");
    const yl = joinNonEmpty([year, loc], ", ");
    if (opts?.narrative) return joinNonEmpty([item.prefix, item.suppressAuthor ? `(${yl})` : `${chicagoCiteNames(rec)} (${yl})`, item.suffix], " ");
    return joinNonEmpty([item.prefix, item.suppressAuthor ? yl : `${chicagoCiteNames(rec)} ${yl}`, item.suffix], " ");
  });
  if (opts?.narrative) return out(esc(serialAnd(parts)));
  return out(esc(`(${parts.join("; ")})`));
}

const LEADING_ARTICLE = /^(?:The|A|An)\s+/;

/**
 * CMOS short title for shortened notes, made mechanically: the main title (before ":" or
 * ";"), without a leading article; if that is longer than four words, the words before the
 * first lowercase small word, at most four. CMOS lets the author choose the short title, so
 * some guide examples ("Fact-Checking" for "The Chicago Guide to Fact-Checking") are
 * editorial choices this rule does not reproduce.
 */
export function chicagoShortTitle(titleHtml: string): string {
  // Split at a real ":" or ";", never at the ";" that ends an entity such as "&amp;".
  const main = titleHtml.split(/:|(?<!&#?[A-Za-z0-9]+);/)[0].trim().replace(/[?!.]$/, "");
  const noArt = main.replace(LEADING_ARTICLE, "");
  const words = noArt.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return noArt;
  // Words up to the first small word, but a small word met before two key words is kept
  // ("Can the Application", not "Can").
  const out: string[] = [];
  let key = 0;
  for (const w of words) {
    const small = CHICAGO_SMALL_WORDS.has(plainOf(w).toLowerCase());
    if (small && key >= 2) break;
    out.push(w);
    if (!small) key++;
    if (out.length === 4) break;
  }
  while (out.length && CHICAGO_SMALL_WORDS.has(plainOf(out[out.length - 1]).toLowerCase())) out.pop();
  return out.join(" ");
}

function chicagoNoteNames(rec: BibRecord): { text: string; editors: boolean; count: number } {
  const { names, editors } = creators(rec);
  const full = names.map((n) => nameText(n, "full"));
  let text = "";
  if (full.length >= 3 || (full.length && rec["et-al-in-source"])) text = `${full[0]} et al.`;
  else if (full.length === 2) text = `${full[0]} and ${full[1]}`;
  else text = full[0] ?? "";
  return { text, editors, count: names.length };
}

function chicagoNote(rec: BibRecord, item: CiteItem, first: boolean): Formatted {
  guard("chicago-nb", rec);
  const loc = locatorText(item, "chicago");
  const isBook = rec.type === "book";
  const titleHtml = asHeadline(rec.title);
  if (!first) {
    // "Yu, *Interior Chinatown*, 48."  "Kwon, “Inclusion Work,” 1851."  "Marks and Parkin, *Book by Design*."
    const short = chicagoShortTitle(titleHtml);
    const who = esc(chicagoCiteNames(rec));
    if (isBook) return out(`${who}, ${italicize(short)}${loc ? `, ${esc(loc)}` : ""}.`);
    const sq = nestQuotes(short);
    return out(loc ? `${who}, “${sq},” ${esc(loc)}.` : `${who}, “${sq}.”`);
  }
  const { text, editors, count } = chicagoNoteNames(rec);
  const who = esc(text) + (editors ? (count > 1 ? ", eds.," : ", ed.,") : text ? "," : "");
  const year = esc(yearOf(rec.issued) ?? "n.d.");
  const doi = bareDoi(rec.DOI);
  const link = doi ? `https://doi.org/${esc(doi)}` : rec.URL ? esc(rec.URL.trim()) : "";
  if (isBook) {
    const ed = editionText(rec.edition);
    const t = italicize(titleHtml) + (ed ? `, ${esc(ed)} ed.` : "");
    const pub = rec.publisher ? esc(rec.publisher.trim()) : "";
    const tail = joinNonEmpty([`${t} (${joinNonEmpty([pub, year], ", ")})`, loc ? esc(loc) : "", link], ", ");
    return out(`${joinNonEmpty([who, tail], " ")}.`);
  }
  const j = italicize(normalizeRich(journalTitle(rec, "full").text));
  const vol = joinNonEmpty([rec.volume ? esc(rec.volume) : "", rec.issue ? `no. ${esc(rec.issue)}` : ""], ", ");
  const pages = rec.page ? formatPages(rec.page, "chicago") : "";
  const art = rec["article-number"] ? esc(rec["article-number"]) : "";
  const where = loc ? joinNonEmpty([esc(loc), art], ", ") : art || pages;
  const src = `${j} ${vol} (${year})${where ? `: ${where}` : ""}`;
  // CMOS: no comma after a title's closing ? or !.
  const tq = nestQuotes(titleHtml);
  const qt = /[?!]$/.test(plainOf(tq)) ? `“${tq}”` : `“${tq},”`;
  return out(`${joinNonEmpty([who, qt, joinNonEmpty([src, link], ", ")], " ")}.`);
}

// ======================================================================== the styles

export function makeVancouver(opts: VancouverOptions = {}): BibStyle {
  const max = opts.maxAuthors && opts.maxAuthors > 0 ? Math.floor(opts.maxAuthors) : STYLE_RULES.vancouver.refEtAl!.max;
  return {
    id: "vancouver", name: STYLE_INFO.vancouver.name, kind: "numeric", order: "citation",
    reference: vancouverReferenceWith(max),
    marker: vancouverMarker,
  };
}

export const STYLES: Partial<Record<StyleId, BibStyle>> = {
  ieee: { id: "ieee", name: "IEEE", kind: "numeric", order: "citation", reference: ieeeReference, marker: ieeeMarker },
  acs: { id: "acs", name: "ACS", kind: "numeric", order: "citation", reference: acsReference, marker: superscriptMarker },
  nature: { id: "nature", name: "Nature", kind: "numeric", order: "citation", reference: natureReference, marker: superscriptMarker },
  optica: {
    id: "optica", name: STYLE_INFO.optica.name, kind: "numeric", order: "citation",
    reference: opticaReference, marker: opticaMarker,
  },
  vancouver: makeVancouver(),
  apa7: { id: "apa7", name: "APA 7", kind: "author-date", order: "alphabetical", reference: apaReference, marker: apaMarker },
  "chicago-ad": {
    id: "chicago-ad", name: STYLE_INFO["chicago-ad"].name, kind: "author-date", order: "alphabetical",
    reference: (r) => chicagoReference(r, "ad"), marker: chicagoAdMarker,
  },
  "chicago-nb": {
    id: "chicago-nb", name: STYLE_INFO["chicago-nb"].name, kind: "note", order: "alphabetical",
    reference: (r) => chicagoReference(r, "nb"),
    // A notes style has no in-text marker; the marker text is the first-note form, for
    // callers that need something to show. Footnote placement is the integrator's (§C4).
    marker: (items) => out(items.map(({ rec, item }) => chicagoNote(rec, item, true).html.replace(/\.$/, "")).join("; ") + "."),
    note: chicagoNote,
  },
};

/** The style, or null with the reason when it does not ship. */
export function getStyle(id: StyleId): BibStyle | null {
  return STYLE_INFO[id]?.shipped ? STYLES[id] ?? null : null;
}

export type FormatResult = { ok: true; value: Formatted } | { ok: false; reason: string };

/** Format one reference, turning a refusal into a reason the pane can show. */
export function formatReference(id: StyleId, rec: BibRecord, n?: number): FormatResult {
  const info = STYLE_INFO[id];
  if (!info) return { ok: false, reason: `Unknown style "${String(id)}".` };
  const style = getStyle(id);
  if (!style) return { ok: false, reason: `${info.name} is not available: ${info.reason ?? "no oracle"}` };
  try {
    return { ok: true, value: style.reference(rec, n) };
  } catch (e) {
    if (e instanceof BibStyleRefusal) return { ok: false, reason: e.message };
    throw e;
  }
}

/** Non-fatal notes about a formatted reference (missing abbreviation, missing year). */
export function referenceWarnings(id: StyleId, rec: BibRecord): string[] {
  const w: string[] = [];
  const wantsAbbrev = (id === "ieee" && (rec.type === "article-journal" || rec.type === "paper-conference"))
    || ((id === "nature" || id === "vancouver" || id === "optica") && rec.type === "article-journal");
  if (wantsAbbrev) {
    const j = journalTitle(rec, id === "vancouver" ? "abbrev-nlm" : "abbrev");
    if (j.warning) w.push(j.warning);
  }
  if (rec.type === "article-journal" && !rec["container-title"]?.trim() && !rec["container-title-short"]?.trim()) {
    w.push("No journal name in the record; the reference prints without one. Add the journal (container-title).");
  }
  if (!yearOf(rec.issued)) w.push("No year in the record.");
  if (!STYLE_INFO[id]?.types.includes(rec.type)) {
    w.push(`${STYLE_INFO[id]?.name ?? id} does not format ${rec.type} references.`);
  }
  return w;
}
