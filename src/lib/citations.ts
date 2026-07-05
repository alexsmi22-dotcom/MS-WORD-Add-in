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
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const m = Math.min(12, Math.max(1, parseInt(iso[2], 10)));
    return `${MONTHS[m - 1]} ${parseInt(iso[3], 10)}, ${iso[1]}`;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) {
    const m = Math.min(12, Math.max(1, parseInt(us[1], 10)));
    return `${MONTHS[m - 1]} ${parseInt(us[2], 10)}, ${us[3]}`;
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

/**
 * "§" or "§§" depending on whether the section string names more than one.
 * A digit–dash–digit range (101-103, 101–103) is plural; a hyphen inside a
 * single section number (e.g. 2000e-2) is not, so we require digits on both
 * sides of the dash.
 */
function sectionSymbol(section: string): string {
  return /[,&]|\bto\b|\band\b|\d\s*[-–—]\s*\d/.test(section) ? "§§" : "§";
}

/** Joins non-empty pieces with a separator. */
function join(parts: string[], sep = " "): string {
  return parts.filter((p) => p !== "").join(sep);
}

// --- reporter & court abbreviations ------------------------------------------

/** Canonical reporter spellings (federal + regional series). */
export const REPORTER_NAMES: string[] = [
  "U.S.", "S. Ct.", "L. Ed.", "L. Ed. 2d",
  "F.", "F.2d", "F.3d", "F.4th", "F. Supp.", "F. Supp. 2d", "F. Supp. 3d", "F. App'x", "Fed. Cl.", "Fed. Appx.",
  "U.S.P.Q.", "U.S.P.Q.2d",
  "A.", "A.2d", "A.3d", "P.", "P.2d", "P.3d", "N.E.", "N.E.2d", "N.E.3d", "N.W.", "N.W.2d",
  "S.E.", "S.E.2d", "S.W.", "S.W.2d", "S.W.3d", "So.", "So. 2d", "So. 3d", "Cal.", "N.Y.", "N.Y.2d", "N.Y.3d",
];

/** Canonical reporter spellings, keyed by their despaced/lowercased form. */
const REPORTERS: Record<string, string> = {};
for (const r of REPORTER_NAMES) {
  REPORTERS[r.replace(/[\s.]/g, "").toLowerCase()] = r;
}

/** Normalizes a captured reporter to its canonical Bluebook form when known. */
export function normalizeReporter(raw: string): string {
  const key = raw.replace(/[\s.]/g, "").toLowerCase();
  if (REPORTERS[key]) return REPORTERS[key];
  return raw.trim().replace(/\s+/g, " ");
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
  const num = /^(\d{1,2})(?:st|nd|rd|th)?\s*cir/i.exec(t);
  if (num) n = parseInt(num[1], 10);
  else {
    const word = /^([a-z]+)\s*cir/i.exec(t);
    if (word) n = CIRCUIT_WORDS[word[1].toLowerCase()] ?? 0;
  }
  if (n >= 1 && n <= 11) {
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
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
      { key: "vol", label: "Volume", placeholder: "573" },
      { key: "reporter", label: "Reporter", placeholder: "U.S." },
      { key: "page", label: "First page", placeholder: "208" },
      { key: "pin", label: "Pincite", placeholder: "216", optional: true },
      { key: "court", label: "Court", placeholder: "Fed. Cir. (omit for U.S. Sup. Ct.)", optional: true },
      { key: "year", label: "Year", placeholder: "2014" },
    ],
    format: (g, style) => {
      const reporter = normalizeReporter(g("reporter"));
      const court = normalizeCourt(g("court"));
      const loc = join([g("vol"), reporter, g("page")]);
      const withPin = g("pin") ? `${loc}, ${g("pin")}` : loc;
      const paren = `(${join([court, g("year")])})`;
      // Practitioner italicizes the case name; academic full citations set it roman.
      const nameHtml = style === "academic" ? esc(g("name")) : it(g("name"));
      return {
        plain: `${g("name")}, ${withPin} ${paren}`,
        html: `${nameHtml}, ${esc(withPin)} ${esc(paren)}`,
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
    format: (g, style) => {
      const loc = join([g("vol"), g("journal"), g("page")]);
      const withPin = g("pin") ? `${loc}, ${g("pin")}` : loc;
      // Academic sets the journal in large-and-small caps; practitioner roman.
      const locHtml =
        style === "academic"
          ? join([esc(g("vol")), sc(g("journal")), esc(g("page"))]) + (g("pin") ? `, ${esc(g("pin"))}` : "")
          : esc(withPin);
      return {
        plain: `${g("author")}, ${g("title")}, ${withPin} (${g("year")})`,
        html: `${esc(g("author"))}, ${it(g("title"))}, ${locHtml} (${esc(g("year"))})`,
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
      const paren = `(${join([g("edition"), g("year")])})`;
      // Academic sets the author and title in large-and-small caps; practitioner
      // uses roman author + italic title. The volume number stays roman in both.
      const pinHtml = g("pin") ? " " + esc(g("pin")) : "";
      const bodyHtml =
        style === "academic"
          ? `${esc(volPrefix)}${sc(g("author"))}, ${sc(g("title"))}${pinHtml}`
          : `${esc(volPrefix)}${esc(g("author"))}, ${it(g("title"))}${pinHtml}`;
      return {
        plain: `${withPin} ${paren}`,
        html: `${bodyHtml} ${esc(paren)}`,
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
  pharmaceuticals: "Pharm.",
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
      for (const [full, abbr] of T10_MULTI) out = out.replace(new RegExp(`\\b${full}\\b`, "g"), abbr);
      for (const [full, abbr] of T10_SINGLE) out = out.replace(new RegExp(`\\b${full}\\b`, "g"), abbr);
      return out;
    })
    .join("");
}

/**
 * Abbreviates a case name per Bluebook Tables T6 (organizational words —
 * Corporation → Corp., and → &) and T10 (U.S. states — California → Cal.),
 * honoring the T10 named-party exception. "United States" stays intact.
 */
export function abbreviateCaseName(name: string): string {
  const t6ed = name.replace(/[A-Za-z][A-Za-z'’]*/g, (word) => {
    const key = word.toLowerCase().replace(/’/g, "'");
    return T6[key] ?? word;
  });
  return applyT10Geographic(t6ed);
}

/**
 * Derives the case short-form fields from a full-case field map: the short name
 * is the first party (before " v. "), or the whole name for "In re"/"Ex parte".
 * The drafter reviews/adjusts (Rule 10.9 lets you pick the more distinctive
 * party). Reporter/volume/pincite carry over.
 */
export function caseShortForm(fields: Record<string, string>): Record<string, string> {
  const name = (fields.name ?? "").trim();
  const first = /\sv\.\s/i.test(name) ? name.split(/\s+v\.\s+/i)[0].trim() : name;
  return { name: first, vol: (fields.vol ?? "").trim(), reporter: (fields.reporter ?? "").trim(), pin: (fields.pin ?? "").trim() };
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

const detectStatute: Detector = (t) => {
  const m = /(\d+)\s*u\.?\s*s\.?\s*c\.?(?:a\.?)?\s*(?:§{1,2}|sec(?:tion|s)?\.?\s*)?\s*(.+?)\s*(?:\((\d{4}[^)]*)\))?\s*\.?$/i.exec(t);
  if (!m) return null;
  const section = m[2].replace(/\s+/g, " ").trim();
  if (!section) return null;
  return { typeId: "usc", fields: { title: m[1], section, sub: "", year: (m[3] || "").trim() } };
};

const detectCFR: Detector = (t) => {
  const m = /(\d+)\s*c\.?\s*f\.?\s*r\.?\s*(?:§{1,2}|sec(?:tion|s)?\.?\s*)?\s*(.+?)\s*(?:\((\d{4}[^)]*)\))?\s*\.?$/i.exec(t);
  if (!m) return null;
  const section = m[2].replace(/\s+/g, " ").trim();
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

const detectPatent: Detector = (t) => {
  const m = /(?:u\.?\s*s\.?\s*)?pat(?:ent)?\.?\s*(?:no\.?|#)?\s*([A-Za-z]{0,2}[\d,]{5,})/i.exec(t);
  if (!m) return null;
  const pin = /\b(col(?:umn)?\.?\s*\d+.*?(?:ll?\.?\s*[\d–\-, ]+)?)/i.exec(t.replace(m[0], ""));
  const date = /\(\s*(?:issued\s*)?([A-Za-z0-9.,/\s-]+?)\s*\)\s*\.?$/i.exec(t);
  return {
    typeId: "patent",
    fields: { number: formatPatentNumber(m[1]), pin: pin ? pin[1].trim() : "", date: date ? date[1].trim() : "" },
  };
};

const CITE_TAIL = /,\s*(\d+)\s+([A-Za-z0-9.'’ ]+?)\s+(\d+)(?:,\s*(\d+(?:[–-]\d+)?))?\s*\(([^)]*)\)\s*\.?$/;

const detectCase: Detector = (t) => {
  const m = CITE_TAIL.exec(t);
  if (!m) return null;
  const name = t.slice(0, m.index).trim();
  const reporter = normalizeReporter(m[2]);
  const known = REPORTERS[m[2].replace(/[\s.]/g, "").toLowerCase()] !== undefined;
  if (!CASE_NAME_SIGNAL.test(name) && !known) return null; // probably an article
  const { court, year } = splitParen(m[5]);
  return {
    typeId: "case",
    fields: { name, vol: m[1], reporter, page: m[3], pin: m[4] || "", court, year },
  };
};

const detectArticle: Detector = (t) => {
  const m = CITE_TAIL.exec(t);
  if (!m) return null;
  const head = t.slice(0, m.index).trim();
  const comma = head.indexOf(",");
  if (comma < 0) return null; // need "Author, Title"
  const { year } = splitParen(m[5]);
  return {
    typeId: "article",
    fields: {
      author: head.slice(0, comma).trim(),
      title: head.slice(comma + 1).trim(),
      vol: m[1],
      journal: normalizeReporter(m[2]).replace(/\s+/g, " "),
      page: m[3],
      pin: m[4] || "",
      year,
    },
  };
};

const DETECTORS: Detector[] = [detectStatute, detectCFR, detectFedReg, detectMPEP, detectPatentApp, detectPatent, detectCase, detectArticle];

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
