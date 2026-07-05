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
  /** `get(key)` returns the trimmed field value ("" if absent). */
  format: (get: (key: string) => string) => CitationResult;
}

// --- helpers -----------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An italic run for the HTML form. */
function it(s: string): string {
  return `<i>${esc(s)}</i>`;
}

const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

/** "2014-06-19" → "June 19, 2014"; already-formatted or year-only passes through. */
export function formatDate(input: string): string {
  const t = input.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const m = Math.min(12, Math.max(1, parseInt(iso[2], 10)));
    return `${MONTHS[m - 1]} ${parseInt(iso[3], 10)}, ${iso[1]}`;
  }
  return t;
}

/** Groups a run of digits with thousands commas: "10123456" → "10,123,456". */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a U.S. patent number, keeping a letter prefix (D, RE, PP, …). */
export function formatPatentNumber(input: string): string {
  const m = /^\s*([A-Za-z]{0,2})\s*([\d,]+)/.exec(input);
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

/** "§" or "§§" depending on whether the section string names more than one. */
function sectionSymbol(section: string): string {
  return /[,&]|\bto\b|\band\b/.test(section) ? "§§" : "§";
}

/** Joins non-empty pieces with a separator. */
function join(parts: string[], sep = " "): string {
  return parts.filter((p) => p !== "").join(sep);
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
      { key: "vol", label: "Volume", placeholder: "573" },
      { key: "reporter", label: "Reporter", placeholder: "U.S." },
      { key: "page", label: "First page", placeholder: "208" },
      { key: "pin", label: "Pincite", placeholder: "216", optional: true },
      { key: "court", label: "Court", placeholder: "Fed. Cir. (omit for U.S. Sup. Ct.)", optional: true },
      { key: "year", label: "Year", placeholder: "2014" },
    ],
    format: (g) => {
      const loc = join([g("vol"), g("reporter"), g("page")]);
      const withPin = g("pin") ? `${loc}, ${g("pin")}` : loc;
      const paren = `(${join([g("court"), g("year")])})`;
      return {
        plain: `${g("name")}, ${withPin} ${paren}`,
        html: `${it(g("name"))}, ${esc(withPin)} ${esc(paren)}`,
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
    format: (g) => {
      const tail = `${join([g("vol"), g("reporter")])} at ${g("pin")}`;
      return { plain: `${g("name")}, ${tail}`, html: `${it(g("name"))}, ${esc(tail)}` };
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
      const core = `${g("title")} U.S.C. ${sectionSymbol(g("section"))} ${g("section")}${sub}`;
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
      const core = `${g("title")} C.F.R. ${sectionSymbol(g("section"))} ${g("section")}`;
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
      const core = join([`U.S. Patent No. ${formatPatentNumber(g("number"))}`, g("pin")]);
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
      const page = groupDigits(g("page").replace(/,/g, "")) || g("page");
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
      const core = `MPEP ${sectionSymbol(g("section"))} ${g("section")}`;
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
      { key: "year", label: "Year", placeholder: "2013" },
    ],
    format: (g) => {
      const loc = join([g("vol"), g("journal"), g("page")]);
      const withPin = g("pin") ? `${loc}, ${g("pin")}` : loc;
      return {
        plain: `${g("author")}, ${g("title")}, ${withPin} (${g("year")})`,
        html: `${esc(g("author"))}, ${it(g("title"))}, ${esc(withPin)} (${esc(g("year"))})`,
      };
    },
  },
  {
    id: "book",
    name: "Book / treatise",
    fields: [
      { key: "author", label: "Author", placeholder: "Donald S. Chisum" },
      { key: "title", label: "Title", placeholder: "Chisum on Patents" },
      { key: "pin", label: "Section / page", placeholder: "§ 5.04 or at 45", optional: true },
      { key: "edition", label: "Edition", placeholder: "2020 ed.", optional: true },
      { key: "year", label: "Year", placeholder: "2020" },
    ],
    format: (g) => {
      const head = `${g("author")}, ${g("title")}`;
      const withPin = g("pin") ? `${head} ${g("pin")}` : head;
      const paren = `(${join([g("edition"), g("year")])})`;
      return {
        plain: `${withPin} ${paren}`,
        html: `${esc(g("author"))}, ${it(g("title"))}${g("pin") ? " " + esc(g("pin")) : ""} ${esc(paren)}`,
      };
    },
  },
];

/** Looks up a citation type by id. */
export function citationById(id: string): CitationType | undefined {
  return CITATIONS.find((c) => c.id === id);
}
