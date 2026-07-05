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
    });
  }

  const pushPlain = (re: RegExp, category: ToaCategory, build: (mm: RegExpExecArray) => { text: string; sortKey: string }): void => {
    re.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) {
      const { text: t, sortKey } = build(mm);
      out.push({ category, sortKey, plain: t, html: esc(t) });
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
