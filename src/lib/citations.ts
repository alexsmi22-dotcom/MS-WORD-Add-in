// Bluebook-style legal citation formatting for patent practice and STEM/legal
// writing. Config-driven: each citation type declares its input fields and a
// format() that returns both a plain-text form and an HTML form (with <i> runs
// for the italicized parts — case names, article/book titles, signals), which
// the task pane inserts via insertHtml.
//
// Drafting aid — always verify against the current Bluebook / court rules.
//
// Pure logic — no Office.js — fully unit-testable.

export interface CitationField {
  key: string;
  label: string;
  placeholder?: string;
  /** Optional fields may be left blank. */
  optional?: boolean;
}

export interface CitationResult {
  plain: string;
  html: string;
}

export interface CitationType {
  id: string;
  name: string;
  fields: CitationField[];
  /**
   * `get(key)` returns the trimmed field value ("" if absent). `style` selects
   * practitioner (briefs/office actions — the default) vs academic (law-review
   * footnote) typography, which differ mainly in case-name italics and the use
   * of large-and-small caps for authors/journals.
   */
  format: (get: (key: string) => string, style?: CitationStyle) => CitationResult;
}

/** Bluebook typeface convention. */
export type CitationStyle = "practitioner" | "academic";

// --- helpers -----------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An italic run for the HTML form. */
function it(s: string): string {
  return `<i>${esc(s)}</i>`;
}

/** A large-and-small-caps run (academic style for authors, titles, journals). */
function sc(s: string): string {
  return `<span style="font-variant: small-caps">${esc(s)}</span>`;
}

const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

/** "2014-06-19" or "6/19/2014" → "June 19, 2014"; other forms pass through. */
export function formatDate(input: string): string {
  const t = input.trim();
  // Pass an out-of-range or impossible calendar date through unchanged rather
  // than fabricating one — "2014-13-40" is not coerced to "Dec. 40, 2014", and
  // a day beyond the month's length ("2019-02-31" → Feb. 31) is rejected too,
  // accounting for leap years so "2020-02-29" is valid but "2019-02-29" is not.
  const daysInMonth = (year: number, mo: number): number => {
    if (mo === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  };
  const valid = (year: number, mo: number, day: number): boolean =>
    mo >= 1 && mo <= 12 && day >= 1 && day <= daysInMonth(year, mo);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    if (valid(y, m, d)) return `${MONTHS[m - 1]} ${d}, ${iso[1]}`;
    return t;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) {
    const m = parseInt(us[1], 10);
    const d = parseInt(us[2], 10);
    const y = parseInt(us[3], 10);
    if (valid(y, m, d)) return `${MONTHS[m - 1]} ${d}, ${us[3]}`;
    return t;
  }
  // A spelled month ("September 20, 1983", "Sep 20 1983", "sept. 20, 1983") →
  // the Table T12 form ("Sept. 20, 1983"; May, June and July stay whole).
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (named) {
    const mo = monthFromName(named[1]);
    const d = parseInt(named[2], 10);
    const y = parseInt(named[3], 10);
    if (mo && valid(y, mo, d)) return `${MONTHS[mo - 1]} ${d}, ${named[3]}`;
  }
  return t;
}

/** 1–12 for a month name or a common abbreviation of it ("Sept", "Sep"), else 0. */
function monthFromName(word: string): number {
  const w = word.toLowerCase();
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const i = full.findIndex((f) => f === w || (w.length >= 3 && f.startsWith(w)));
  return i + 1;
}

/** Groups a run of digits with thousands commas: "10123456" → "10,123,456". */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Bluebook Rule 6.2(a): commas only in numbers of FIVE or more digits — "1076",
 * "12,345". (Patent numbers keep their own comma convention: groupDigits.)
 */
export function groupDigitsRule62(digits: string): string {
  return digits.length >= 5 ? groupDigits(digits) : digits;
}

/**
 * Formats a U.S. patent number, keeping a letter prefix (D, RE, PP, …). The
 * Google Patents display forms "US10123456B2" / "US 10,123,456 B2" lose their
 * "US" country prefix and their kind code — a Bluebook patent cite carries
 * neither ("U.S. Patent No." already names the country).
 */
export function formatPatentNumber(input: string): string {
  const s = input.trim().replace(/^U\.?\s?S\.?\s*(?=(?:RE|PP|AI|[DHTX])?\s*\d)/i, "");
  const m = /^\s*([A-Za-z]{0,2})\s*([\d,]+)/.exec(s);
  if (!m || !m[2]) return input.trim();
  const prefix = m[1].toUpperCase();
  return prefix + groupDigits(m[2].replace(/,/g, ""));
}

/** Normalizes a publication number to "YYYY/NNNNNNN". */
export function formatPublicationNumber(input: string): string {
  const t = input.trim();
  if (/^\d{4}\/\d{5,7}$/.test(t)) return t;
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 11) return `${digits.slice(0, 4)}/${digits.slice(4, 11)}`;
  return t;
}

/**
 * "§" or "§§" depending on whether the section string names more than one.
 * A digit–dash–digit range (101-103, 101–103) is plural; a hyphen inside a
 * single section number is not. That hyphen can follow a letter (2000e-2) or a
 * digit of a *dotted* compound section (a Treasury reg like 1.6011-4, 1.482-7),
 * so the range branch only fires when the digits before the dash are NOT part of
 * a dotted number — otherwise a single tax reg would wrongly read "§§".
 */
export function sectionSymbol(section: string): string {
  // Plural §§ for multiple *sections* — a comma/ampersand/"and"/"to" followed by
  // another section number, or an integer range whose left operand isn't the tail
  // of a dotted compound number. A comma before a subsection like "1.84(a), (b)"
  // is one section, so it stays singular §. A range between two DOTTED numbers
  // ("1.97–1.98") is plural too: a Treasury-reg hyphen joins a dotted number to
  // a plain one ("1.6011-4"), never to another dotted number.
  return /,\s*\d|&\s*\d|\s(?:to|and)\s+\d|(?:^|[^.\d])\d+\s*[-–—]\s*\d|\d+\.\d+\s*[-–—]\s*\d+\.\d/.test(section)
    ? "§§"
    : "§";
}

/**
 * A page / line span with an en dash (Rule 3.2(a): "216–18", "ll. 15–20"): any
 * digit-hyphen-digit in a PINCITE. Not for section numbers — see sectionRanges.
 */
export function dashRanges(pin: string): string {
  return pin.replace(/(\d)\s*[-—]\s*(?=\d)/g, "$1–");
}

/**
 * Section ranges with an en dash ("101-103" → "101–103", "1.97-1.98" →
 * "1.97–1.98", Rule 3.3(b)) — but never the hyphen INSIDE one section number
 * ("1.6011-4", "2000e-2"): a token is a range only when sectionSymbol calls
 * it plural, the same test the Table of Authorities uses.
 */
export function sectionRanges(section: string): string {
  return section.replace(/(^|[^\w.])(\d+(?:\.\d+)?)\s*[-—]\s*(\d+(?:\.\d+)?)(?![\w.])/g, (all, pre: string, a: string, b: string) =>
    sectionSymbol(`${a}-${b}`) === "§§" ? `${pre}${a}–${b}` : all,
  );
}

/** Joins non-empty pieces with a separator. */
function join(parts: string[], sep = " "): string {
  return parts.filter((p) => p !== "").join(sep);
}

// --- reporter & court abbreviations ------------------------------------------

/** Canonical reporter spellings (federal + regional series). */
export const REPORTER_NAMES: string[] = [
  "U.S.", "S. Ct.", "L. Ed.", "L. Ed. 2d",
  "F.", "F.2d", "F.3d", "F.4th", "F. Supp.", "F. Supp. 2d", "F. Supp. 3d", "F. App'x", "Fed. Cl.", "Fed. Appx.", "F.R.D.",
  "U.S.P.Q.", "U.S.P.Q.2d",
  "A.", "A.2d", "A.3d", "P.", "P.2d", "P.3d", "N.E.", "N.E.2d", "N.E.3d", "N.W.", "N.W.2d",
  "S.E.", "S.E.2d", "S.W.", "S.W.2d", "S.W.3d", "So.", "So. 2d", "So. 3d", "Cal.", "N.Y.", "N.Y.2d", "N.Y.3d",
];

/**
 * Non-Bluebook spellings that real documents carry, mapped to the Bluebook (T1)
 * form: Westlaw's "Fed.Appx." and the Federal Circuit / PTAB "USPQ2d".
 * (Spacing, periods and curly apostrophes are already folded by the key.)
 */
export const REPORTER_ALIASES: Record<string, string> = {
  "Fed. Appx.": "F. App'x",
  "USPQ2d": "U.S.P.Q.2d",
  "USPQ": "U.S.P.Q.",
};

/** The lookup key for a reporter: no spaces or periods, straight apostrophes, lowercase. */
function reporterKey(raw: string): string {
  return raw.replace(/[\s.]/g, "").replace(/[’‘]/g, "'").toLowerCase();
}

/** Canonical reporter spellings, keyed by their despaced/lowercased form. */
const REPORTERS: Record<string, string> = {};
for (const r of REPORTER_NAMES) {
  REPORTERS[reporterKey(r)] = r;
}
for (const [alias, canon] of Object.entries(REPORTER_ALIASES)) REPORTERS[reporterKey(alias)] = canon;

/** Normalizes a captured reporter to its canonical Bluebook form when known
 *  ("F. 3d", "F.Supp.2d", "S.Ct.", "F. App’x", "Fed.Appx.", "USPQ2d"). */
export function normalizeReporter(raw: string): string {
  const key = reporterKey(raw);
  if (REPORTERS[key]) return REPORTERS[key];
  return raw.trim().replace(/\s+/g, " ");
}

/** True if `raw` matches a known reporter abbreviation (any spacing/casing). */
export function isKnownReporter(raw: string): boolean {
  return REPORTERS[reporterKey(raw)] !== undefined;
}

/** Canonical court abbreviations + a few aliases (CAFC → Fed. Cir.). */
const COURTS: Record<string, string> = {};
for (const c of [
  "Fed. Cir.", "D.C. Cir.", "Fed. Cl.",
  "S.D.N.Y.", "E.D.N.Y.", "N.D. Cal.", "C.D. Cal.", "S.D. Cal.", "E.D. Va.", "N.D. Ill.", "E.D. Tex.",
  "W.D. Tex.", "N.D. Tex.", "D. Del.", "D. Mass.", "W.D. Wis.", "D.N.J.", "E.D. Pa.", "D. Colo.", "D. Minn.",
]) {
  COURTS[c.replace(/[\s.]/g, "").toLowerCase()] = c;
}
COURTS["cafc"] = "Fed. Cir.";

const CIRCUIT_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
};

/** Normalizes a court to its Bluebook abbreviation (e.g. "9th cir" → "9th Cir."). */
export function normalizeCourt(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const key = t.replace(/[\s.]/g, "").toLowerCase();
  if (COURTS[key]) return COURTS[key];
  // Numbered federal circuits: "9th cir", "9 Cir.", "ninth circuit".
  let n = 0;
  const num = /^(\d{1,2})(?:st|nd|rd|th|d)?\s*cir/i.exec(t);
  if (num) n = parseInt(num[1], 10);
  else {
    const word = /^([a-z]+)\s*cir/i.exec(t);
    if (word) n = CIRCUIT_WORDS[word[1].toLowerCase()] ?? 0;
  }
  if (n >= 1 && n <= 11) {
    // Bluebook T7 writes the Second and Third Circuits "2d" / "3d", never
    // "2nd" / "3rd" (Rule 6.2(b) ordinals).
    const suffix = n === 1 ? "st" : n === 2 ? "d" : n === 3 ? "d" : "th";
    return `${n}${suffix} Cir.`;
  }
  return t;
}

// --- Bluebook introductory signals (italicized) ------------------------------

export const SIGNALS: { value: string; label: string }[] = [
  { value: "", label: "(no signal)" },
  { value: "See", label: "See" },
  { value: "See also", label: "See also" },
  { value: "See, e.g.,", label: "See, e.g.," },
  { value: "E.g.,", label: "E.g.," },
  { value: "Cf.", label: "Cf." },
  { value: "Compare", label: "Compare" },
  { value: "But see", label: "But see" },
  { value: "But cf.", label: "But cf." },
  { value: "Accord", label: "Accord" },
  { value: "Contra", label: "Contra" },
];

/** Prepends an italicized Bluebook signal to a citation (both forms). */
export function applySignal(signal: string, cite: CitationResult): CitationResult {
  const s = signal.trim();
  if (!s) return cite;
  return { plain: `${s} ${cite.plain}`, html: `${it(s)} ${cite.html}` };
}

// --- citation types ----------------------------------------------------------

export const CITATIONS: CitationType[] = [
  {
    id: "case",
    name: "Case (full)",
    fields: [
      { key: "name", label: "Case name", placeholder: "Alice Corp. v. CLS Bank Int’l" },
      // Unreported decisions (Westlaw / Lexis) carry the docket number between
      // the name and the database cite (Rule 10.8.1). It is roman, not italic.
      { key: "docket", label: "Docket no. (unreported cases)", placeholder: "No. 13-cv-1", optional: true },
      { key: "vol", label: "Volume", placeholder: "573" },
      { key: "reporter", label: "Reporter", placeholder: "U.S." },
      { key: "page", label: "First page", placeholder: "208" },
      { key: "pin", label: "Pincite", placeholder: "216", optional: true },
      { key: "parallel", label: "Parallel cite(s)", placeholder: "134 S. Ct. 2347, 189 L. Ed. 2d 296", optional: true },
      { key: "court", label: "Court", placeholder: "Fed. Cir. (omit for U.S. Sup. Ct.)", optional: true },
      { key: "year", label: "Year", placeholder: "2014" },
      // Rule 10.6.1: "(en banc)", "(per curiam)", "(quoting …)" follow the
      // court/year parenthetical and are part of the citation.
      { key: "explan", label: "Parenthetical(s)", placeholder: "(en banc)", optional: true },
    ],
    format: (g, style) => {
      const reporter = normalizeReporter(g("reporter"));
      const court = normalizeCourt(g("court"));
      const loc = join([g("vol"), reporter, g("page")]);
      const pinText = dashRanges(g("pin"));
      const withPin = pinText ? `${loc}, ${pinText}` : loc;
      // Parallel reporters (Rule 10.3.1) follow the primary cite, before the year.
      const withParallel = g("parallel") ? `${withPin}, ${g("parallel")}` : withPin;
      const withDocket = g("docket") ? `${g("docket")}, ${withParallel}` : withParallel;
      // No court and no year: no parenthetical at all, never an empty "()".
      const inner = join([court, g("year")]);
      const explan = g("explan");
      const paren = (inner ? ` (${inner})` : "") + (explan ? ` ${/^\(/.test(explan) ? explan : `(${explan})`}` : "");
      // Practitioner italicizes the case name; academic full citations set it roman.
      const nameHtml = style === "academic" ? esc(g("name")) : it(g("name"));
      return {
        plain: `${g("name")}, ${withDocket}${paren}`,
        html: `${nameHtml}, ${esc(withDocket)}${esc(paren)}`,
      };
    },
  },
  {
    id: "case-short",
    name: "Case (short form)",
    fields: [
      { key: "name", label: "Short name", placeholder: "Alice" },
      { key: "vol", label: "Volume", placeholder: "573" },
      { key: "reporter", label: "Reporter", placeholder: "U.S." },
      { key: "pin", label: "Pincite", placeholder: "217" },
    ],
    // Short-form case names are italicized in both styles.
    format: (g) => {
      const tail = `${join([g("vol"), normalizeReporter(g("reporter"))])} at ${g("pin")}`;
      return { plain: `${g("name")}, ${tail}`, html: `${it(g("name"))}, ${esc(tail)}` };
    },
  },
  {
    id: "id",
    name: "Id. (same as previous cite)",
    fields: [{ key: "pin", label: "Pincite", placeholder: "217", optional: true }],
    // "Id." (italic, including the period) refers to the immediately preceding
    // authority; add a pincite when the page differs. Rule 4.1.
    format: (g) => {
      const pin = g("pin");
      return {
        plain: pin ? `Id. at ${pin}` : "Id.",
        html: pin ? `<i>Id.</i> at ${esc(pin)}` : "<i>Id.</i>",
      };
    },
  },
  {
    id: "supra",
    name: "Supra (earlier source)",
    fields: [
      { key: "name", label: "Author / short title", placeholder: "Lemley" },
      { key: "note", label: "Footnote no. (academic)", placeholder: "15", optional: true },
      { key: "pin", label: "Pincite", placeholder: "912", optional: true },
    ],
    // "supra" (italic) points back to an earlier source. Rule 4.2 limits it to
    // secondary sources (books, articles, …) — not cases, statutes, or regs.
    format: (g) => {
      const note = g("note") ? ` note ${g("note")}` : "";
      const pin = g("pin") ? `, at ${g("pin")}` : "";
      return {
        plain: `${g("name")}, supra${note}${pin}`,
        html: `${esc(g("name"))}, <i>supra</i>${esc(note)}${esc(pin)}`,
      };
    },
  },
  {
    id: "usc",
    name: "Statute (U.S.C.)",
    fields: [
      { key: "title", label: "Title", placeholder: "35" },
      { key: "section", label: "Section(s)", placeholder: "101" },
      { key: "sub", label: "Subsection", placeholder: "a", optional: true },
      { key: "year", label: "Year / edition", placeholder: "2018", optional: true },
    ],
    format: (g) => {
      const sub = g("sub") ? `(${g("sub")})` : "";
      const core = `${g("title")} U.S.C. ${sectionSymbol(g("section"))} ${sectionRanges(g("section"))}${sub}`;
      const plain = g("year") ? `${core} (${g("year")})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "cfr",
    name: "Regulation (C.F.R.)",
    fields: [
      { key: "title", label: "Title", placeholder: "37" },
      { key: "section", label: "Section(s)", placeholder: "1.84" },
      { key: "year", label: "Year", placeholder: "2023", optional: true },
    ],
    format: (g) => {
      const core = `${g("title")} C.F.R. ${sectionSymbol(g("section"))} ${sectionRanges(g("section"))}`;
      const plain = g("year") ? `${core} (${g("year")})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "patent",
    name: "Patent (U.S.)",
    fields: [
      { key: "number", label: "Patent number", placeholder: "10,123,456" },
      { key: "pin", label: "Pincite", placeholder: "col. 3 ll. 15–20", optional: true },
      { key: "date", label: "Issue date", placeholder: "2019-05-14 or May 14, 2019", optional: true },
    ],
    format: (g) => {
      const core = join([`U.S. Patent No. ${formatPatentNumber(g("number"))}`, dashRanges(g("pin"))]);
      const plain = g("date") ? `${core} (issued ${formatDate(g("date"))})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "patent-app",
    name: "Patent app. publication",
    fields: [
      { key: "number", label: "Publication number", placeholder: "2020/0123456 or 20200123456" },
      { key: "kind", label: "Kind code", placeholder: "A1", optional: true },
      { key: "date", label: "Publication date", placeholder: "2020-04-23", optional: true },
    ],
    format: (g) => {
      const core = join([`U.S. Patent Application Publication No. ${formatPublicationNumber(g("number"))}`, g("kind")]);
      const plain = g("date") ? `${core} (published ${formatDate(g("date"))})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "fedreg",
    name: "Federal Register",
    fields: [
      { key: "vol", label: "Volume", placeholder: "85" },
      { key: "page", label: "Page", placeholder: "12,345" },
      { key: "date", label: "Date", placeholder: "2020-03-01" },
      { key: "codified", label: "To be codified at", placeholder: "37 C.F.R. pt. 1", optional: true },
    ],
    format: (g) => {
      const page = groupDigitsRule62(g("page").replace(/,/g, "")) || g("page");
      const core = `${g("vol")} Fed. Reg. ${page} (${formatDate(g("date"))})`;
      const plain = g("codified") ? `${core} (to be codified at ${g("codified")})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "mpep",
    name: "MPEP section",
    fields: [
      { key: "section", label: "Section", placeholder: "2106.05(a)" },
      { key: "edition", label: "Edition", placeholder: "9th ed. Rev. 10.2019, June 2020", optional: true },
    ],
    format: (g) => {
      const core = `MPEP ${sectionSymbol(g("section"))} ${sectionRanges(g("section"))}`;
      const plain = g("edition") ? `${core} (${g("edition")})` : core;
      return { plain, html: esc(plain) };
    },
  },
  {
    id: "article",
    name: "Law review article",
    fields: [
      { key: "author", label: "Author", placeholder: "Mark A. Lemley" },
      { key: "title", label: "Title", placeholder: "Software Patents and the Return of Functional Claiming" },
      { key: "vol", label: "Volume", placeholder: "2013" },
      { key: "journal", label: "Journal", placeholder: "Wis. L. Rev." },
      { key: "page", label: "First page", placeholder: "905" },
      { key: "pin", label: "Pincite", placeholder: "912", optional: true },
      { key: "year", label: "Year (omitted when the volume is the year)", placeholder: "2013", optional: true },
    ],
    format: (g, style) => {
      const loc = join([g("vol"), g("journal"), g("page")]);
      const withPin = g("pin") ? `${loc}, ${g("pin")}` : loc;
      // Academic sets the journal in large-and-small caps; practitioner roman.
      const locHtml =
        style === "academic"
          ? join([esc(g("vol")), sc(g("journal")), esc(g("page"))]) + (g("pin") ? `, ${esc(g("pin"))}` : "")
          : esc(withPin);
      // A journal whose volumes are designated by year ("2013 Wis. L. Rev.")
      // takes no date parenthetical — the year is already the volume (Bluebook
      // R16; rule number to be confirmed against R16.4 in the current edition).
      const year = g("year");
      const showYear = year !== "" && year !== g("vol");
      return {
        plain: `${g("author")}, ${g("title")}, ${withPin}${showYear ? ` (${year})` : ""}`,
        html: `${esc(g("author"))}, ${it(g("title"))}, ${locHtml}${showYear ? ` (${esc(year)})` : ""}`,
      };
    },
  },
  {
    id: "book",
    name: "Book / treatise",
    fields: [
      { key: "vol", label: "Volume", placeholder: "1 (for a multi-volume treatise)", optional: true },
      { key: "author", label: "Author", placeholder: "Donald S. Chisum" },
      { key: "title", label: "Title", placeholder: "Chisum on Patents" },
      { key: "pin", label: "Section / page", placeholder: "§ 3.02 or at 45", optional: true },
      { key: "edition", label: "Edition", placeholder: "2020 ed.", optional: true },
      { key: "year", label: "Year", placeholder: "2023" },
    ],
    format: (g, style) => {
      // A multi-volume work cites the volume before the author (Rule 3.2).
      const volPrefix = g("vol") ? `${g("vol")} ` : "";
      const withPin = g("pin") ? `${volPrefix}${g("author")}, ${g("title")} ${g("pin")}` : `${volPrefix}${g("author")}, ${g("title")}`;
      // Nothing to put in the parenthetical → no "()" at all.
      const innerParen = join([g("edition"), g("year")]);
      const paren = innerParen ? `(${innerParen})` : "";
      // Academic sets the author and title in large-and-small caps; practitioner
      // uses roman author + italic title. The volume number stays roman in both.
      const pinHtml = g("pin") ? " " + esc(g("pin")) : "";
      const bodyHtml =
        style === "academic"
          ? `${esc(volPrefix)}${sc(g("author"))}, ${sc(g("title"))}${pinHtml}`
          : `${esc(volPrefix)}${esc(g("author"))}, ${it(g("title"))}${pinHtml}`;
      return {
        plain: paren ? `${withPin} ${paren}` : withPin,
        html: paren ? `${bodyHtml} ${esc(paren)}` : bodyHtml,
      };
    },
  },
];

/** Looks up a citation type by id. */
export function citationById(id: string): CitationType | undefined {
  return CITATIONS.find((c) => c.id === id);
}

/**
 * Bluebook Table T6 — the common words abbreviated in case names (Rule 10.2.2).
 * Singular and frequent plural forms; values are the canonical abbreviations.
 */
const T6: Record<string, string> = {
  and: "&",
  academy: "Acad.",
  administration: "Admin.",
  administrative: "Admin.",
  agricultural: "Agric.",
  agriculture: "Agric.",
  america: "Am.",
  american: "Am.",
  associate: "Assoc.",
  associates: "Assocs.",
  association: "Ass'n",
  associations: "Ass'ns",
  authority: "Auth.",
  automobile: "Auto.",
  board: "Bd.",
  brothers: "Bros.",
  building: "Bldg.",
  business: "Bus.",
  center: "Ctr.",
  central: "Cent.",
  commission: "Comm'n",
  committee: "Comm.",
  communication: "Commc'n",
  communications: "Commc'ns",
  company: "Co.",
  companies: "Cos.",
  corporation: "Corp.",
  department: "Dep't",
  development: "Dev.",
  distribution: "Distrib.",
  district: "Dist.",
  division: "Div.",
  education: "Educ.",
  electric: "Elec.",
  electronic: "Elec.",
  electronics: "Elecs.",
  engineering: "Eng'g",
  enterprise: "Enter.",
  enterprises: "Enters.",
  environment: "Env't",
  environmental: "Envtl.",
  equipment: "Equip.",
  federal: "Fed.",
  finance: "Fin.",
  financial: "Fin.",
  foundation: "Found.",
  general: "Gen.",
  government: "Gov't",
  group: "Grp.",
  hospital: "Hosp.",
  incorporated: "Inc.",
  industries: "Indus.",
  industry: "Indus.",
  institute: "Inst.",
  institution: "Inst.",
  insurance: "Ins.",
  international: "Int'l",
  laboratory: "Lab.",
  laboratories: "Labs.",
  limited: "Ltd.",
  machine: "Mach.",
  machines: "Machs.",
  machinery: "Mach.",
  management: "Mgmt.",
  manufacturer: "Mfr.",
  manufacturers: "Mfrs.",
  manufacturing: "Mfg.",
  medical: "Med.",
  medicine: "Med.",
  national: "Nat'l",
  number: "No.",
  organization: "Org.",
  pharmaceutical: "Pharm.",
  // T6 plurals add "s" before the period (Rule 10.2.2): "Teva Pharms. USA".
  pharmaceuticals: "Pharms.",
  products: "Prods.",
  public: "Pub.",
  publishing: "Publ'g",
  research: "Rsch.",
  resources: "Res.",
  savings: "Sav.",
  science: "Sci.",
  scientific: "Sci.",
  securities: "Sec.",
  security: "Sec.",
  service: "Serv.",
  services: "Servs.",
  society: "Soc'y",
  system: "Sys.",
  systems: "Sys.",
  technology: "Tech.",
  technologies: "Techs.",
  telecommunications: "Telecomm.",
  telephone: "Tel.",
  transportation: "Transp.",
  university: "Univ.",
  utility: "Util.",
  // v2.193 T6 audit — words that were missing, so "Dow Chemical Co." and "Dow
  // Chem. Co." were two Table of Authorities rows and "Abbreviate" left them
  // whole. Compass words are the "-ern" adjectives only: a bare "West"/"North"
  // would break "West Virginia" / "North Carolina" (T10, applied after T6).
  accounting: "Acct.",
  advertising: "Advert.",
  affair: "Aff.",
  affairs: "Affs.",
  african: "Afr.",
  amendment: "Amend.",
  appellate: "App.",
  arbitration: "Arb.",
  atlantic: "Atl.",
  attorney: "Att'y",
  attorneys: "Att'ys",
  avenue: "Ave.",
  bankruptcy: "Bankr.",
  broadcasting: "Broad.",
  brotherhood: "Bhd.",
  casualty: "Cas.",
  catholic: "Cath.",
  chemical: "Chem.",
  chemicals: "Chems.",
  college: "Coll.",
  commissioner: "Comm'r",
  community: "Cmty.",
  compensation: "Comp.",
  computer: "Comput.",
  condominium: "Condo.",
  consolidated: "Consol.",
  construction: "Constr.",
  continental: "Cont'l",
  cooperative: "Coop.",
  county: "Cnty.",
  defence: "Def.",
  defense: "Def.",
  director: "Dir.",
  distributor: "Distrib.",
  distributors: "Distribs.",
  eastern: "E.",
  economic: "Econ.",
  economics: "Econ.",
  educational: "Educ.",
  electrical: "Elec.",
  employee: "Emp.",
  employees: "Emps.",
  employer: "Emp.",
  employers: "Emps.",
  employment: "Emp.",
  engineer: "Eng'r",
  engineers: "Eng'rs",
  entertainment: "Ent.",
  examiner: "Exam'r",
  exchange: "Exch.",
  executive: "Exec.",
  federation: "Fed'n",
  fidelity: "Fid.",
  guaranty: "Guar.",
  housing: "Hous.",
  indemnity: "Indem.",
  independent: "Indep.",
  industrial: "Indus.",
  information: "Info.",
  intellectual: "Intell.",
  investment: "Inv.",
  investments: "Invs.",
  liability: "Liab.",
  litigation: "Litig.",
  maintenance: "Maint.",
  marketing: "Mktg.",
  mechanical: "Mech.",
  memorial: "Mem'l",
  merchant: "Merch.",
  merchants: "Merchs.",
  metropolitan: "Metro.",
  municipal: "Mun.",
  mutual: "Mut.",
  natural: "Nat.",
  northeastern: "Ne.",
  northern: "N.",
  northwestern: "Nw.",
  pacific: "Pac.",
  partnership: "P'ship",
  partnerships: "P'ships",
  product: "Prod.",
  professional: "Pro.",
  property: "Prop.",
  properties: "Props.",
  protection: "Prot.",
  publication: "Publ'n",
  publications: "Publ'ns",
  railroad: "R.R.",
  railway: "Ry.",
  regional: "Reg'l",
  rehabilitation: "Rehab.",
  restaurant: "Rest.",
  restaurants: "Rests.",
  retirement: "Ret.",
  road: "Rd.",
  school: "Sch.",
  schools: "Schs.",
  secretary: "Sec'y",
  shareholder: "S'holder",
  shareholders: "S'holders",
  southeastern: "Se.",
  southern: "S.",
  southwestern: "Sw.",
  street: "St.",
  subcommittee: "Subcomm.",
  surety: "Sur.",
  temporary: "Temp.",
  township: "Twp.",
  transcontinental: "Transcon.",
  trust: "Tr.",
  trustee: "Tr.",
  trustees: "Trs.",
  turnpike: "Tpk.",
  uniform: "Unif.",
  village: "Vill.",
  western: "W.",
};

/**
 * Abbreviates the words in a case name per Bluebook Table T6 (Rule 10.2.2) —
 * Corporation → Corp., International → Int'l, and → &, etc. "United States" is
 * left intact (it isn't abbreviated as a party name).
 */
/** Bluebook Table T10 — multi-word U.S. state abbreviations (matched first). */
const T10_MULTI: [string, string][] = [
  ["New Hampshire", "N.H."], ["New Jersey", "N.J."], ["New Mexico", "N.M."], ["New York", "N.Y."],
  ["North Carolina", "N.C."], ["North Dakota", "N.D."], ["Rhode Island", "R.I."],
  ["South Carolina", "S.C."], ["South Dakota", "S.D."], ["West Virginia", "W. Va."],
];
/** Bluebook Table T10 — single-word U.S. state abbreviations. */
const T10_SINGLE: [string, string][] = [
  ["Alabama", "Ala."], ["Arizona", "Ariz."], ["Arkansas", "Ark."], ["California", "Cal."], ["Colorado", "Colo."],
  ["Connecticut", "Conn."], ["Delaware", "Del."], ["Florida", "Fla."], ["Georgia", "Ga."], ["Illinois", "Ill."],
  ["Indiana", "Ind."], ["Kansas", "Kan."], ["Kentucky", "Ky."], ["Louisiana", "La."], ["Maine", "Me."],
  ["Maryland", "Md."], ["Massachusetts", "Mass."], ["Michigan", "Mich."], ["Minnesota", "Minn."], ["Mississippi", "Miss."],
  ["Missouri", "Mo."], ["Montana", "Mont."], ["Nebraska", "Neb."], ["Nevada", "Nev."], ["Oklahoma", "Okla."],
  ["Oregon", "Or."], ["Pennsylvania", "Pa."], ["Tennessee", "Tenn."], ["Texas", "Tex."], ["Vermont", "Vt."],
  ["Virginia", "Va."], ["Washington", "Wash."], ["Wisconsin", "Wis."], ["Wyoming", "Wyo."],
];
/** Full state names (incl. the never-abbreviated ones) for the named-party test. */
const STATE_NAMES = new Set(
  [...T10_MULTI, ...T10_SINGLE]
    .map(([full]) => full.toLowerCase())
    .concat(["alaska", "hawaii", "idaho", "iowa", "ohio", "utah"])
);
const GEO_PARTY_PREFIX = /^(?:State|Commonwealth|People|City|County|Town|Village|Borough|Parish|Township)\s+of\b/i;

/**
 * Applies Table T10 state abbreviations with the named-party exception
 * (Rule 10.2.1(f)): a geographic unit that is itself a party — a bare state
 * name, or a "State of X" / "City of X" government party — stays unabbreviated.
 */
function applyT10Geographic(name: string): string {
  return name
    .split(/(\s+v\.\s+)/)
    .map((seg) => {
      if (/^\s+v\.\s+$/.test(seg)) return seg;
      const core = seg.replace(/^(?:In re|Ex parte|In the Matter of)\s+/i, "").trim();
      if (STATE_NAMES.has(core.toLowerCase()) || GEO_PARTY_PREFIX.test(core)) return seg;
      let out = seg;
      // Don't abbreviate a state name that is the first half of a hyphenated
      // compound proper name (e.g. "Georgia-Pacific", "Roussel-UCLAF") — the
      // `(?!-)` guard keeps those intact. (A state used as an adjective in a
      // spaced company name, e.g. "Washington Mutual", is a harder case left
      // as-is to avoid wrongly suppressing government units like "Mass. Bd.".)
      for (const [full, abbr] of T10_MULTI) out = out.replace(new RegExp(`\\b${full}\\b(?!-)`, "g"), abbr);
      for (const [full, abbr] of T10_SINGLE) out = out.replace(new RegExp(`\\b${full}\\b(?!-)`, "g"), abbr);
      return out;
    })
    .join("");
}

/** Abbreviations that end in a period inside a case name — T6, T10 and the
 *  corporate designators — so a period after them is NOT a sentence end. */
// Built from EVERY T6 value (and its "s" plural), every T10 value, and the
// abbreviations reporters print in case names that T6 does not list ("Pats.",
// "Petrol."). A missing entry is not cosmetic: cutAtSentenceEnd treated
// "Chem." as a sentence end and the Table of Authorities listed "Dow Chem. Co.
// v. Mee Indus." as "Co. v. Mee Indus." under C. Abbreviations that are also
// ordinary capitalised words ("All.", "Child.", "Coal.", "Rest.") are left out:
// those CAN end the previous sentence.
const T6_PLURALS = Object.values(T6)
  .filter((a) => /^[A-Z][a-z]+\.$/.test(a))
  .map((a) => `${a.slice(0, -1)}s.`);
const NOT_NAME_ABBREVIATIONS = new Set(["all.", "alls.", "child.", "coal.", "coals.", "rest.", "rests.", "sur.", "comps.", "pros."]);
const NAME_ABBREVIATIONS = new Set<string>(
  [
    ...Object.values(T6),
    ...T6_PLURALS,
    "Chem.", "Chems.", "Pat.", "Pats.", "Petrol.", "Consol.", "Constr.", "Intell.", "Lab'y.", "Lab'ys.", "Cir.",
    "Ams.", "Holdings.", "Bancorp.", "Bankcorp.", "Ry.", "Tr.", "Trs.",
    ...T10_MULTI.map(([, a]) => a),
    ...T10_SINGLE.map(([, a]) => a),
    "Inc.", "Corp.", "Co.", "Cos.", "Ltd.", "Bros.", "Labs.", "Servs.", "Sys.", "Techs.", "Assocs.", "Mfg.",
    "Pharms.", "Prods.", "Indus.", "Elecs.", "Machs.", "Enters.", "Holdings.", "Grp.", "Ins.", "Fin.",
    "Sav.", "Mut.", "Coop.", "Ry.", "R.R.", "Mktg.", "Comput.", "Cmty.", "Cnty.", "Twp.", "Hous.",
    "Ret.", "Sch.", "Sec.", "Admin.", "Ctr.", "Dist.", "Div.", "Gen.", "Hosp.", "Inst.", "Mgmt.",
    "Org.", "Pub.", "Rsch.", "Res.", "Sci.", "Serv.", "Tel.", "Transp.", "Univ.", "Util.", "Educ.",
    "Distrib.", "Envtl.", "Equip.", "Found.", "Telecomm.", "Comm.", "Auth.", "Auto.", "Bldg.", "Bus.",
    "Cent.", "Dev.", "Elec.", "Fed.", "Agric.", "Acad.", "Assoc.", "Mach.", "Med.", "Pharm.", "Bd.",
    "Jr.", "Sr.", "Mfrs.", "Mfr.", "Bancorp.", "Int'l.", "Nat'l.", "Am.", "Cal.", "No.", "Nos.", "St.",
  ]
    .map((a) => a.toLowerCase())
    .filter((a) => !NOT_NAME_ABBREVIATIONS.has(a)),
);

/**
 * True if `word` (a token ending in ".") is an abbreviation that can sit inside
 * a case name ("Corp.", "Servs.", "Cal.", "L.L.C.", "Ass'n.", "A."), and false
 * if its period ends a sentence ("Court.", "Circuit.", "Id."). Short tokens
 * (≤ 3 letters) and tokens with an inner period or apostrophe are treated as
 * abbreviations; "Id." never is.
 */
export function isCaseNameAbbreviation(word: string): boolean {
  if (!word.endsWith(".")) return true;
  const w = word.replace(/[’‘]/g, "'");
  if (/^id\.$/i.test(w)) return false;
  if (NAME_ABBREVIATIONS.has(w.toLowerCase())) return true;
  const core = w.slice(0, -1);
  if (/[.']/.test(core)) return true;
  return core.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length <= 3;
}

/**
 * Abbreviates a case name per Bluebook Tables T6 (organizational words —
 * Corporation → Corp., and → &) and T10 (U.S. states — California → Cal.),
 * honoring the T10 named-party exception. "United States" stays intact.
 */
export function abbreviateCaseName(name: string): string {
  // Rule 10.2.2: the United States as a party is "United States", never
  // "United States of America" — and never "United States of Am." (T6 would
  // otherwise abbreviate the "America" it should have dropped).
  const us = name.replace(/\bUnited\s+States\s+of\s+America\b/g, "United States");
  // Place names whose compass word is part of the NAME, not a T6 adjective;
  // T10 has no form for them here, so they pass through whole rather than as
  // a half-abbreviated "N. Mariana Islands".
  const keep: Array<[number, number]> = [];
  const placeRe = /\b(?:Northern\s+(?:Mariana\s+Islands|Ireland|Territory)|Western\s+(?:Australia|Sahara)|Eastern\s+Cape|Northern\s+Cape|Western\s+Cape)\b/g;
  let pm: RegExpExecArray | null;
  while ((pm = placeRe.exec(us))) keep.push([pm.index, pm.index + pm[0].length]);
  const t6ed = us.replace(/[A-Za-z][A-Za-z'’]*/g, (word: string, at: number, whole: string) => {
    // Half of a hyphenated proper name ("Western-Pacific", "Mutual-Benefit")
    // is a name, not a T6 word.
    if (whole[at - 1] === "-" || whole[at + word.length] === "-") return word;
    if (keep.some(([a, b]) => at >= a && at < b)) return word;
    const key = word.toLowerCase().replace(/’/g, "'");
    return T6[key] ?? word;
  });
  return applyT10Geographic(t6ed);
}

/** Name particles that belong to the following surname ("de Vries", "van Gogh"). */
const NAME_PARTICLE = /^(?:de|del|della|der|den|van|von|du|da|di|dos|das|le|la|ter)$/;

/**
 * The party name a short-form cite uses — the ONE implementation, shared by the
 * Citations form's "→ Short form" button ({@link caseShortForm}) and the Table of
 * Authorities short-form scan (toa.ts re-exports it).
 *
 * Bluebook Rule 10.9 uses one party, normally the first — but not when the first
 * would not distinguish the case, which is why "United States v. Alvarez"
 * shortens to "Alvarez" and never to "United States". For a procedural caption
 * ("In re Wands", "Ex parte Jones") the short name is the party after the
 * procedural phrase: "Wands, 858 F.2d at 740".
 *
 * Returns null when the name has no party to shorten to.
 */
export function caseShortName(name: string): string | null {
  const t = name.replace(/\s+/g, " ").trim();
  // Trailing corporate designators ("…, Inc.", "… Co.", "… Grp. LP"), repeated
  // until none is left; a trailing comma goes too. Periods of abbreviations
  // stay ("Gen. Elec.", never "Gen").
  const strip = (p: string): string => {
    let s = p.trim();
    for (let k = 0; k < 4; k++) {
      const before = s;
      s = s
        .replace(
          /,?\s+(?:Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Corp\.|Co\.|Cos\.|Corporation|Company|Ass['’]n|Assoc\.|N\.A\.|P\.C\.|LLP|L\.L\.P\.|LP|L\.P\.|PLLC|P\.A\.|S\.A\.|N\.V\.|AG|A\.G\.|GmbH|plc|PLC)$/i,
          "",
        )
        .replace(/,$/, "")
        .trim();
      if (s === before) break;
    }
    return s;
  };

  let pick: string;
  const proc = /^(?:In re|Ex parte|In the Matter of|Matter of)\s+(.+)$/i.exec(t);
  if (proc && !/\sv\.?\s/i.test(proc[1])) {
    pick = strip(proc[1]);
  } else {
    const parts = t.split(/\s+vs?\.?\s+/i);
    if (parts.length < 2) return null;
    // Parties too common to identify a case on their own.
    const GENERIC =
      /^(united states( of america)?|u\.s\.|state|people|commissioner|comm'r|secretary|sec'y|director|dir\.)$/i;
    // A first party that OPENS with a generic organisational word ("Ass’n for
    // Molecular Pathology", "Univ. of Cal.", "Bd. of Regents") is not what a
    // brief writes either: "Myriad, 569 U.S. at 590", "Bakke, 438 U.S. at 307".
    const GENERIC_LEAD =
      /^(?:Ass['’]ns?|Bd\.|Board|Dep['’]t|Comm['’]n|Soc['’]y|Gov['’]t|Univ\.|University|Regents|Trs\.|Trustees)(?:\s|$)/i;
    // Rule 10.9(a)(i): a geographic or governmental unit, or a government
    // officer, as first party sends the short form to the other party —
    // "City of Los Angeles v. Lyons" → "Lyons", "Texas v. Johnson" → "Johnson",
    // "Comm'r of Internal Revenue v. Banks" → "Banks". Two states ("Kansas v.
    // Colorado") keep the first.
    const OFFICER_OF = /^(?:Commissioner|Comm['’]r|Secretary|Sec['’]y|Attorney\s+General|Att['’]y\s+Gen\.)\s+of\b/i;
    const isState = (p: string): boolean => STATE_NAMES.has(p.toLowerCase());
    const first = strip(parts[0]);
    const second = strip(parts[1]);
    const generic =
      GENERIC.test(first) || GENERIC_LEAD.test(first) || GEO_PARTY_PREFIX.test(first) || OFFICER_OF.test(first) || (isState(first) && !isState(second));
    pick = generic && second ? second : first;
  }
  if (!pick) return null;
  // Rule 10.9(a)(i): the short form is the first party's name, shortened only
  // as far as it still identifies the party, in its T6/T10-abbreviated form
  // ("State Street Bank" → "State St. Bank"). The distinctive leading word is
  // what briefs write ("Alice", "Teva", "KSR"), but a leading abbreviation, a
  // two-letter word or a generic geographic word does not identify anyone on
  // its own, so it is kept together with what follows: "Gen. Elec.", "Int'l
  // Bus. Machs.", "TC Heartland", "J.E.M. Ag Supply", "State St. Bank". The run
  // stops at "&" and at "of"/"for" ("Lab. Corp. of Am." → "Lab. Corp."),
  // except straight after a lone abbreviation ("Dir. of Revenue").
  const words = strip(abbreviateCaseName(pick)).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // An in-word "&" stays ("AT&T", never "ATT").
  const clean = (w: string): string => w.replace(/[^\wÀ-ÖØ-öø-ÿ'’.&-]/g, "");
  const isAbbrev = (w: string): boolean => /\.$/.test(w) || /['’]/.test(w);
  const isShort = (w: string): boolean => /^[A-Za-z]{1,2}$/.test(w);
  const GEO_WORD = /^(?:State|United|City|County|Cnty\.|Commonwealth|People|Town|Village|Vill\.)$/;
  const out: string[] = [clean(words[0])];
  let i = 1;
  if (NAME_PARTICLE.test(out[0]) && words.length > 1) out.push(clean(words[i++]));
  while (i < words.length && out.length < 6) {
    const last = out[out.length - 1];
    const chain = isAbbrev(last) || isShort(last) || (out.length === 1 && GEO_WORD.test(last));
    if (!chain) break;
    const next = words[i];
    if (/^(?:&|and)$/i.test(next)) break;
    if (/^(?:of|for|the)$/i.test(next)) {
      // After a lone abbreviation, the whole capitalised run after "of"
      // ("Dir. of Revenue", "Dir. of Internal Revenue"), then stop.
      if (out.length === 1 && i + 1 < words.length && /^[A-Z]/.test(words[i + 1])) {
        out.push(next);
        i++;
        while (i < words.length && /^[A-Z]/.test(words[i]) && out.length < 8) out.push(clean(words[i++]));
      }
      break;
    }
    out.push(clean(next));
    i++;
  }
  const word = out.join(" ").replace(/,$/, "");
  return word.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]/g, "").length >= 2 ? word : null;
}

/**
 * Derives the case short-form fields from a full-case field map, using
 * {@link caseShortName} (Rule 10.9) so the button and the Table of Authorities
 * agree. When no short party can be derived, the typed name is kept rather than
 * blanking the field — the drafter reviews/adjusts. Reporter/volume/pincite
 * carry over.
 */
export function caseShortForm(fields: Record<string, string>): Record<string, string> {
  const name = (fields.name ?? "").trim();
  const short = caseShortName(name) ?? name;
  return { name: short, vol: (fields.vol ?? "").trim(), reporter: (fields.reporter ?? "").trim(), pin: (fields.pin ?? "").trim() };
}

// --- paste-and-fix parser ----------------------------------------------------

export interface ParsedCitation {
  typeId: string;
  fields: Record<string, string>;
  signal: string;
}

const CASE_NAME_SIGNAL = /(\bv\.\s)|(^in re\b)|(^ex parte\b)|(^matter of\b)|(^in the matter of\b)/i;

/** Splits a case/patent parenthetical into court (may be "") and year. */
function splitParen(paren: string): { court: string; year: string } {
  const y = /\b(\d{4})\b\s*$/.exec(paren.trim());
  const year = y ? y[1] : "";
  const court = year ? paren.trim().replace(/\s*\b\d{4}\b\s*$/, "").trim() : paren.trim();
  return { court, year };
}

/** Strips a leading Bluebook signal, returning it (canonical) and the rest. */
function extractSignal(t: string): { signal: string; rest: string } {
  // Longest signal first so "See also" / "See, e.g.," win over "See".
  const ordered = SIGNALS.filter((s) => s.value).sort((a, b) => b.value.length - a.value.length);
  for (const s of ordered) {
    const re = new RegExp("^" + s.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+", "i");
    if (re.test(t)) return { signal: s.value, rest: t.replace(re, "") };
  }
  return { signal: "", rest: t };
}

type Detector = (t: string) => Omit<ParsedCitation, "signal"> | null;

// A section string: one section number, then more joined by a list connector
// (", " / " and " / " & " / " to " / a range dash), a subsection list
// ("1.84(a), (b)") or a paragraph ("§ 112, ¶ 6"). It stops at the first token
// that is not part of a section — "37 C.F.R. § 1.56 and Rule 132" is § 1.56.
const SEC_TOK = "\\d[\\w.()\\-–—]*";
const SECTION_GRAMMAR =
  `(${SEC_TOK}(?:` +
  `\\s*(?:,|&)\\s*(?:and\\s+|&\\s*)?(?:§+\\s*)?(?!\\d+\\s+(?:U\\.?\\s*S\\.?\\s*C|C\\.?\\s*F\\.?\\s*R))${SEC_TOK}` +
  `|\\s+(?:and|to)\\s+(?:§+\\s*)?${SEC_TOK}` +
  `|\\s*,\\s*¶+\\s*\\d+` +
  `|\\s*,\\s*\\([a-z0-9]+\\)` +
  `)*)`;
const YEAR_TAIL = "(?:\\s*\\((\\d{4}[^)]*)\\))?";

/** Collapses whitespace and drops a sentence period or an unbalanced ")" the
 *  section token swallowed from surrounding prose ("(see § 101).") */
function trimSectionTail(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  for (;;) {
    const before = s;
    s = s.replace(/\.+$/, "");
    const opens = (s.match(/\(/g) || []).length;
    const closes = (s.match(/\)/g) || []).length;
    if (closes > opens && s.endsWith(")")) s = s.slice(0, -1);
    if (s === before) return s.trim();
  }
}

const detectStatute: Detector = (t) => {
  const m = new RegExp(
    `(\\d+)\\s*u\\.?\\s*s\\.?\\s*c\\.?(?:a\\.?)?\\s*(?:§{1,2}|sec(?:tion|s)?\\.?\\s*)?\\s*${SECTION_GRAMMAR}${YEAR_TAIL}`,
    "i",
  ).exec(t);
  if (!m) return null;
  const section = trimSectionTail(m[2]);
  if (!section) return null;
  return { typeId: "usc", fields: { title: m[1], section, sub: "", year: (m[3] || "").trim() } };
};

const detectCFR: Detector = (t) => {
  const m = new RegExp(
    `(\\d+)\\s*c\\.?\\s*f\\.?\\s*r\\.?\\s*(?:§{1,2}|sec(?:tion|s)?\\.?\\s*)?\\s*${SECTION_GRAMMAR}${YEAR_TAIL}`,
    "i",
  ).exec(t);
  if (!m) return null;
  const section = trimSectionTail(m[2]);
  if (!section) return null;
  return { typeId: "cfr", fields: { title: m[1], section, year: (m[3] || "").trim() } };
};

const detectFedReg: Detector = (t) => {
  const m = /(\d+)\s*fed\.?\s*reg\.?\s*([\d,]+)\s*\(([^)]*)\)/i.exec(t);
  if (!m) return null;
  let date = m[3].trim();
  let codified = "";
  const cod = /to be codified at\s+(.+)$/i.exec(t);
  if (cod) codified = cod[1].replace(/[).]+$/, "").trim();
  date = date.replace(/\s*\(?to be codified.*$/i, "").trim();
  return { typeId: "fedreg", fields: { vol: m[1], page: m[2], date, codified } };
};

const detectMPEP: Detector = (t) => {
  const m = /\bmpep\b\s*(?:§{1,2}|sec(?:tion)?\.?\s*)?\s*([\dA-Za-z.()\-]+)\s*(?:\(([^)]*)\))?/i.exec(t);
  if (!m) return null;
  return { typeId: "mpep", fields: { section: m[1], edition: (m[2] || "").trim() } };
};

const detectPatentApp: Detector = (t) => {
  const m = /((?:\d{4}\/\d{5,7})|\b\d{11}\b)\s*(A\d|B\d)?/i.exec(t);
  if (!m) return null;
  if (!/pub|application|\d{4}\/\d/i.test(t)) return null; // avoid matching plain patent numbers
  const date = /\(\s*(?:published\s*)?([A-Za-z0-9.,/\s-]+?)\s*\)\s*\.?$/.exec(t);
  return {
    typeId: "patent-app",
    fields: { number: formatPublicationNumber(m[1]), kind: (m[2] || "").toUpperCase(), date: date ? date[1].trim() : "" },
  };
};

/**
 * A patent pincite in Bluebook form: "col. 3 ll. 15–20" (en-dash range), from
 * any of "col. 3, ll. 15-20", "column 3 lines 15–20", "col. 3 l. 7".
 */
function patentPin(t: string): string {
  const m = /\bcol(?:umn|s?\.)?\s*(\d+)(?:\s*,?\s*(?:(ll?)\.|(lines?))\s*(\d+)(?:\s*[–—-]\s*(\d+))?)?/i.exec(t);
  if (!m) return "";
  let pin = `col. ${m[1]}`;
  if (m[4]) {
    const plural = m[5] !== undefined || m[2] === "ll" || /^lines$/i.test(m[3] || "");
    pin += ` ${plural ? "ll." : "l."} ${m[4]}${m[5] ? `–${m[5]}` : ""}`;
  }
  return pin;
}

const detectPatent: Detector = (t) => {
  const m = /(?:u\.?\s*s\.?\s*)?pat(?:ent)?\.?\s*(?:no\.?|#)?\s*([A-Za-z]{0,2}[\d,]{5,})/i.exec(t);
  if (!m) return null;
  const pin = patentPin(t.replace(m[0], ""));
  const date = /\(\s*(?:issued\s*)?([A-Za-z0-9.,/\s-]+?)\s*\)\s*\.?$/i.exec(t);
  return {
    typeId: "patent",
    fields: { number: formatPatentNumber(m[1].replace(/,+$/, "")), pin, date: date ? date[1].trim() : "" },
  };
};

/**
 * A bare Google-Patents-style number with its country code: "US 10,123,456 B2",
 * "US10123456B2" (a patent) or "US 2020/0123456 A1", "US20200123456A1" (an
 * application publication). Only the whole pasted string — never prose.
 */
const detectBarePatent: Detector = (t): Omit<ParsedCitation, "signal"> | null => {
  const s = t.replace(/\.$/, "").trim();
  const pub = /^US\s*(\d{4})\s*\/?\s*(\d{7})\s*([AB]\d)?$/i.exec(s);
  if (pub) {
    return { typeId: "patent-app", fields: { number: `${pub[1]}/${pub[2]}`, kind: (pub[3] || "").toUpperCase(), date: "" } };
  }
  const pat = /^US\s*((?:RE|PP|AI|[DHTX])?\s*\d{1,2},?\d{3},?\d{3})\s*([A-Z]\d?)?$/i.exec(s);
  if (pat) return { typeId: "patent", fields: { number: formatPatentNumber(pat[1]), pin: "", date: "" } };
  return null;
};

/**
 * "Name, VOL REPORTER PAGE[, pin…][, parallel cite…] (court year)". The name is
 * everything before the FIRST "vol reporter page" run, so a parallel cite
 * ("573 U.S. 208, 134 S. Ct. 2347") is never glued into the italic name. What
 * sits between the first cite and the parenthetical is split by commas into
 * pincites ("216", "216 n.3", "at *3") and parallel cites (anything that is
 * itself "vol Reporter page").
 */
//
// FREEZE FIX (v2.193): the middle group used to be `(?:\s*,\s*[^,()]+?)*`, whose
// `[^,()]` also matches spaces — so "\s*" and the segment could split the same
// run of characters in exponentially many ways, and with no closing ")" the
// engine tried them all: 22 commas took 2 s, doubling per comma, which froze
// Word on the Citations "Parse" button. Every repeated piece is now
// unambiguous: a reporter is space-separated tokens that contain no space, and
// a middle segment starts AND ends with a non-space character, so "\s*" around
// the comma is the only place a space can go. The segment count is capped (10
// pins/parallels is far beyond any real cite).
const CITE_SEG = "[^,()\\s](?:[^,()]*[^,()\\s])?";
const CITE_HEAD = new RegExp(
  "^(.+?),\\s*(\\d+)\\s+([A-Za-z][A-Za-z0-9.'’]*(?: [A-Za-z0-9.'’]+)*?)\\s+(\\d+)" +
    `((?:\\s*,\\s*${CITE_SEG}){0,10})\\s*\\(([^()]*)\\)\\s*\\.?$`,
);
const PARALLEL_TOKEN = /^\d+\s+[A-Z][A-Za-z0-9.'’ ]*?\s+\d+$/;

function splitMiddle(middle: string): { pin: string; parallel: string } {
  const pins: string[] = [];
  const parallels: string[] = [];
  for (const tok of middle.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (parallels.length || PARALLEL_TOKEN.test(tok)) parallels.push(tok);
    else pins.push(tok);
  }
  return { pin: pins.join(", "), parallel: parallels.join(", ") };
}

/**
 * Splits trailing parentheticals that FOLLOW the "(court year)" one — "(en
 * banc)", "(per curiam)", "(quoting Mayo …, 566 U.S. 66, 72 (2012))" — off a
 * case cite. Rule 10.6.1 makes them part of the citation, so they are kept (in
 * the case form's "explan" field), not dropped. Parens are matched by a
 * balanced scan (a "quoting" parenthetical nests a whole cite). A group is
 * peeled only while what remains still ends in ")" — the court/year group
 * itself is never peeled. At most 3 groups.
 */
function peelParentheticals(t: string): { core: string; explan: string } {
  let core = t.replace(/\.\s*$/, "").trimEnd();
  const peeled: string[] = [];
  for (let k = 0; k < 3 && core.endsWith(")"); k++) {
    let depth = 0;
    let open = -1;
    for (let i = core.length - 1; i >= 0; i--) {
      const ch = core[i];
      if (ch === ")") depth++;
      else if (ch === "(") {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    if (open <= 0) break;
    const rest = core.slice(0, open).trimEnd();
    if (!rest.endsWith(")")) break;
    peeled.unshift(core.slice(open));
    core = rest;
  }
  return { core: peeled.length ? core : t, explan: peeled.join(" ") };
}

const detectCase: Detector = (t) => {
  const { core, explan } = peelParentheticals(t);
  const m = CITE_HEAD.exec(core);
  if (!m) return null;
  let name = m[1].trim();
  // An unreported decision's docket number sits between the name and the
  // database cite: "Acme Corp. v. Widget Co., No. 13-cv-1, 2015 WL 123456".
  let docket = "";
  const dk = /^(.*?),\s*((?:Nos?\.|Civ\.\s*No\.|Civil Action No\.|Case No\.|Appeal No\.)\s.+)$/i.exec(name);
  if (dk) {
    name = dk[1].trim();
    docket = dk[2].trim();
  }
  const reporter = normalizeReporter(m[3]);
  const known = isKnownReporter(m[3]);
  if (!CASE_NAME_SIGNAL.test(name) && !known) return null; // probably an article
  const { court, year } = splitParen(m[6]);
  const { pin, parallel } = splitMiddle(m[5]);
  const fields: Record<string, string> = { name, vol: m[2], reporter, page: m[4], pin, parallel, court, year };
  if (docket) fields.docket = docket;
  if (explan) fields.explan = explan;
  return { typeId: "case", fields };
};

const detectArticle: Detector = (t) => {
  const m = CITE_HEAD.exec(t);
  if (!m) return null;
  const head = m[1].trim();
  const comma = head.indexOf(",");
  if (comma < 0) return null; // need "Author, Title"
  const { year } = splitParen(m[6]);
  return {
    typeId: "article",
    fields: {
      author: head.slice(0, comma).trim(),
      title: head.slice(comma + 1).trim(),
      vol: m[2],
      journal: normalizeReporter(m[3]).replace(/\s+/g, " "),
      page: m[4],
      pin: splitMiddle(m[5]).pin,
      year,
    },
  };
};

// Federal Register runs FIRST: its "(to be codified at 37 C.F.R. pt. 1)"
// parenthetical would otherwise be read as a C.F.R. (or U.S.C.) cite.
const DETECTORS: Detector[] = [
  detectFedReg,
  detectStatute,
  detectCFR,
  detectMPEP,
  detectPatentApp,
  detectPatent,
  detectBarePatent,
  detectCase,
  detectArticle,
];

/**
 * Best-effort parse of a messy pasted citation into a type + field values that
 * the existing formatters can clean up. Returns null when nothing matches.
 * This is heuristic — the user reviews the filled form before inserting.
 */
export function parseCitation(raw: string): ParsedCitation | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const { signal, rest } = extractSignal(collapsed);
  for (const d of DETECTORS) {
    const hit = d(rest);
    if (hit) return { ...hit, signal };
  }
  return null;
}
