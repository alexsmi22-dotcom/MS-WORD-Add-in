// Page ranges for the citation styles (docs/SCOPE-CITATIONS-2026-10.md §E "Page ranges").
//
// Three rules, each taken from its own manual:
//   "full"    — every digit of both numbers, joined by an EN DASH (U+2013).
//               IEEE, APA, ACS and Nature print full numbers ("2787–2793", "345–359").
//               A range the user typed already elided ("284-7") is EXPANDED, because those
//               styles never print an elided range.
//   "nlm"     — NLM / ICMJE (Citing Medicine): a HYPHEN, with the repeated leading digits
//               dropped ("284-7", "1151-68", "93-113").
//   "chicago" — CMOS 9.64 inclusive numbers, EN DASH ("1818–59", "307–13", "9–10").
//
// Never elided, in any style (§E): alphanumeric pages ("A635–A646", "S93-S99", "e0318239",
// "iii-v"). NLM itself elides "S93-9"; we deliberately do not (brief rule: never elide
// alphanumeric pages), so an NLM alphanumeric range keeps both ends, joined by a hyphen.
//
// A single page or an article number is not a range and is returned unchanged.

export type PageRule = "full" | "nlm" | "chicago";

const EN_DASH = String.fromCharCode(0x2013);

// Separators people (and importers) put between the two ends of a range.
// "--" is BibTeX; U+2212 is what the ACS website renders; U+2010/2011 are Unicode hyphens.
// Built from escapes so no look-alike dash is typed into the source.
const STRONG_SEP = new RegExp("\\s*(?:--+|[\\u2013\\u2014\\u2212\\u2012\\u2015])\\s*");
const HYPHEN_SEP = new RegExp("\\s*[-\\u2010\\u2011]\\s*");

/** Split one range "a–b" into its two ends, or null when it is not a range. */
export function splitRange(s: string): [string, string] | null {
  const t = s.trim();
  if (!t) return null;
  // A strong separator wins: "2.2-1–2.2-6" is the range 2.2-1 to 2.2-6.
  const strong = t.split(STRONG_SEP);
  if (strong.length === 2 && strong[0] && strong[1]) return [strong[0], strong[1]];
  if (strong.length > 2) return null;
  const parts = t.split(HYPHEN_SEP);
  if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
  return null;
}

/** True when the page field holds a range (decides IEEE "p." vs "pp."). */
export function isPageRange(page: string | undefined): boolean {
  if (!page) return false;
  return page.split(/\s*[,;]\s*/).some((p) => splitRange(p) !== null);
}

const isDigits = (s: string): boolean => /^\d+$/.test(s);

/** "284","7" → "287". Returns null when the second end cannot be an elided form of the first. */
function expandSecond(a: string, b: string): string | null {
  if (!isDigits(a) || !isDigits(b)) return null;
  if (b.length >= a.length) return b;
  const full = a.slice(0, a.length - b.length) + b;
  return Number(full) >= Number(a) ? full : null;
}

/** NLM elision: drop the leading digits the second number shares with the first. */
function elideNlm(a: string, b: string): string {
  if (a.length !== b.length) return b;
  let i = 0;
  while (i < a.length - 1 && a[i] === b[i]) i++;
  return b.slice(i);
}

/**
 * CMOS 9.64. The eight quick-guide pairs (1818–59, 471–85, 307–13, 225–51, 117–18, 1842–43,
 * 9–10, 104–5) are the oracle; the remaining branches follow the CMOS 9.64 table and are an
 * implementation of that table, not separately pinned by a fetched example.
 */
function elideChicago(a: string, b: string): string {
  const x = Number(a);
  if (x < 100 || x % 100 === 0) return b; // all digits: 3–10, 71–72, 96–117, 100–104, 1100–1113
  if (a.length !== b.length) return b; // 96–117 style growth, 998–1003: all digits
  // Four-digit numbers where three or more digits change use all four (1496–1504, 2787–2816).
  let common = 0;
  while (common < a.length && a[common] === b[common]) common++;
  const changed = b.slice(common);
  if (a.length === 4 && changed.length >= 3) return b;
  const rem = x % 100;
  if (rem >= 1 && rem <= 9) return changed.length ? changed : b.slice(-1); // 101–8, 808–33, 1103–4
  // 110–199 etc.: two digits, or more as needed (321–28, 498–532, 1087–89).
  return changed.length >= 2 ? changed : b.slice(-2);
}

function formatOne(piece: string, rule: PageRule): string {
  const range = splitRange(piece);
  if (!range) return piece.trim();
  const [a0, b0] = range;
  const sep = rule === "nlm" ? "-" : EN_DASH;
  if (!isDigits(a0) || !isDigits(b0)) return a0 + sep + b0; // alphanumeric: never elided
  const b = expandSecond(a0, b0);
  if (b === null) return a0 + sep + b0; // "300-20"? not a valid elision; print as given
  if (rule === "full") return a0 + sep + b;
  if (rule === "nlm") return a0 + sep + elideNlm(a0, b);
  return a0 + sep + elideChicago(a0, b);
}

/** Format a page field ("284-287", "1–5, 7–9", "e0318239") under one style's rule. */
export function formatPages(page: string | undefined, rule: PageRule): string {
  if (!page) return "";
  const t = page.trim();
  if (!t) return "";
  // Several ranges: "1-5, 7-9" or "1-5; 7-9". The separator is kept as written.
  return t.split(/(\s*[,;]\s*)/).map((p, i) => (i % 2 ? p : formatOne(p, rule))).join("");
}
