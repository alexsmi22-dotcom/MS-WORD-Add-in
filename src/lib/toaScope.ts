// What the native Table of Authorities button may SCAN (pure; no Office.js).
//
// The pane reads the brief's text and marks every citation it finds. Three kinds
// of text look like citations and are not: an earlier table this pane built
// (tagged content controls), a table Word built itself (a TOA field), and a
// table typed by hand under a "TABLE OF AUTHORITIES" heading. Each quotes every
// authority, so scanning it marks the table's own page for everything, and its
// last entry becomes the antecedent of the argument's first "Id.".
//
// These helpers find those blocks and blank them out of the scanned text
// WITHOUT changing any offset, so the pane's search plan (which counts Word's
// hits against the real text) still lines up. They live here, not in
// taskpane.ts, because nothing can import the pane in a test.

/** Any whitespace, plus Word's cell / row mark (BEL) and line-break characters. */
const GAP = /[\s\x07]+/;
const GAP_SRC = "[\\s\\x07]+";
/** A paragraph-level separator: what ends a line in Word's body.text. */
const LINE_END = /[\r\n\x07\x0b\f]/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds `block` (a content control's or a field result's text) inside `hay`
 * (body.text), treating every run of whitespace / paragraph / cell marks as
 * equal: Word may report the same table with "\r" in one place and "\n", "\r\n",
 * a tab or a cell mark (BEL) in another. Returns [start, end) in `hay`, or null
 * when it is not there (the caller must REPORT that, not continue silently).
 * A block with no visible text returns null too; check {@link hasVisibleText}.
 */
export function locateBlock(hay: string, block: string): [number, number] | null {
  const parts = block.split(GAP).filter((p) => p.length > 0);
  if (!parts.length) return null;
  const m = new RegExp(parts.map(escapeRe).join(GAP_SRC)).exec(hay);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** True if the text has anything but whitespace and cell marks. */
export function hasVisibleText(s: string): boolean {
  return s.split(GAP).some((p) => p.length > 0);
}

/**
 * Replaces every character inside the spans with a space, keeping paragraph
 * separators where they are, so the length and every offset are unchanged and
 * text on either side of a span is never glued into one paragraph.
 */
export function blankSpans(text: string, spans: Array<[number, number]>): string {
  let out = text;
  for (const [from, to] of spans) {
    const a = Math.max(0, from);
    const b = Math.min(out.length, to);
    if (b <= a) continue;
    out = out.slice(0, a) + out.slice(a, b).replace(/[^\r\n\x07\x0b\f]/g, " ") + out.slice(b);
  }
  return out;
}

/** True for a Word TOA field instruction ("TOA \c 1 \p …"), not TA, not TOC. */
export function isTableOfAuthoritiesFieldCode(code: string): boolean {
  return /^\s*TOA(?:\s|$)/i.test(code);
}

const TOA_HEADING = /^table\s+of\s+authorities:?$/i;

/** Category labels inside a typed TOA ("CASES", "STATUTES   PAGE(S)"), which
 *  are all capitals but do NOT end the table. */
const TOA_CATEGORY =
  /^(?:(?:FEDERAL|STATE|CONSTITUTIONAL|FOREIGN)\s+)?(?:CASES|STATUTES?|RULES|REGULATIONS|OTHER\s+AUTHORITIES|AUTHORITIES|CONSTITUTIONAL\s+PROVISIONS|PROVISIONS|PATENTS(?:\s+AND\s+PUBLICATIONS)?|TREATISES|SECONDARY\s+(?:SOURCES|AUTHORITIES)|ADMINISTRATIVE\s+(?:MATERIALS|DECISIONS|AUTHORITIES)|AGENCY\s+(?:MATERIALS|DECISIONS)|LEGISLATIVE\s+MATERIALS|MISCELLANEOUS|PAGE\(S\)|PAGES?)(?:\s+(?:PAGE\(S\)|PAGES?))?:?$/;

/** A heading that ends a typed TOA: capitals only, no digits, no dot leaders,
 *  not a category label. Entries always carry a lowercase letter or a digit. */
function endsTypedToa(line: string): boolean {
  const t = line.trim();
  return (
    t.length >= 3 &&
    t.length <= 80 &&
    /[A-Z]/.test(t) &&
    !/[a-z]/.test(t) &&
    !/\d/.test(t) &&
    !/\.{3,}|…/.test(t) &&
    !TOA_HEADING.test(t) &&
    !TOA_CATEGORY.test(t)
  );
}

/** A paragraph of prose: long, and not ending in a page reference. No TOA
 *  entry looks like this, so a typed table has certainly ended before it. */
function isProse(line: string): boolean {
  const t = line.trim();
  return t.length > 160 && !/(?:\d|passim|\b[ivxlc]+)\s*$/i.test(t);
}

export interface TypedToaScan {
  /** [start, end) of each typed table: its heading to the next heading. */
  spans: Array<[number, number]>;
  /** What ended each span, for the message: the heading's text, or
   *  "the first paragraph of text" when prose ended it. */
  endedBy: string[];
  /** Typed tables whose END could not be found (no heading after them). They
   *  are NOT blanked, since blanking to the end of the brief would hide every
   *  citation, and the caller must tell the user. */
  unbounded: number;
}

/**
 * Finds tables typed by hand under a paragraph that reads exactly "TABLE OF
 * AUTHORITIES" (any case, optional colon). A Table of Contents line such as
 * "TABLE OF AUTHORITIES ....... ii" is NOT a heading. Each table runs to the
 * next all-capitals heading ("STATEMENT OF THE ISSUES", "ARGUMENT"), or to the
 * first paragraph of prose if that comes sooner (a lowercase heading such as
 * "Statement of the Issues" is not recognised; the prose stop keeps the table
 * from swallowing the brief). The pane names what ended each table.
 */
export function typedToaSpans(text: string): TypedToaScan {
  const lines: Array<{ start: number; text: string }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || LINE_END.test(text.charAt(i))) {
      lines.push({ start, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  const spans: Array<[number, number]> = [];
  const endedBy: string[] = [];
  let unbounded = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!TOA_HEADING.test(lines[i].text.trim())) continue;
    let j = i + 1;
    while (j < lines.length && !endsTypedToa(lines[j].text) && !isProse(lines[j].text)) j++;
    if (j >= lines.length) {
      unbounded++;
      break;
    }
    spans.push([lines[i].start, lines[j].start]);
    endedBy.push(endsTypedToa(lines[j].text) ? lines[j].text.trim() : "the first paragraph of text");
    i = j - 1;
  }
  return { spans, endedBy, unbounded };
}
