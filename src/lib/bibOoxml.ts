// The bibliography block as a flat-OPC OOXML package (docs/SCOPE-CITATIONS-2026-10.md §C4, §D).
//
// PURE: no Office.js. The integrator inserts the result with `insertOoxml` inside a content
// control tagged BIBLIOGRAPHY_TAG (bibStore.ts).
//
// One paragraph per reference, hanging indent (0.5 in by default). Fonts are NOT set, so the
// block takes the document's own body font. The formatted html may contain only the record
// contract's rich text (<i> <b> <sub> <sup> <span class="nocase">) plus a small-caps span;
// each maps to run properties. Unicode (H₂O, Å, µ, Greek) is written verbatim: never folded.
// Titles hold & and < as literal text; the style escapes them into its html, and this module
// decodes that html once and escapes once more for XML.

import type { Formatted } from "./bibRecord";

export interface BibBlockOptions {
  /** A heading paragraph above the list ("References"). Omitted when empty. */
  heading?: string;
  /**
   * Number label for numeric styles, e.g. n => `[${n}]` (IEEE). The styles' `reference()`
   * does not print the number, so the label comes from here, followed by a tab to the indent.
   */
  label?: (n: number) => string;
  /** Hanging indent in twips (1440 = 1 in). Default 720. */
  hangingTwips?: number;
}

interface RunState { i: boolean; b: boolean; sub: boolean; sup: boolean; smallCaps: boolean }

const PLAIN: RunState = { i: false, b: false, sub: false, sup: false, smallCaps: false };

/** XML 1.0 forbids C0 controls other than tab/LF/CR, and the noncharacters FFFE/FFFF. */
function xmlAllowed(c: number): boolean {
  if (c < 0x20) return c === 0x09 || c === 0x0a || c === 0x0d;
  return c !== 0xfffe && c !== 0xffff;
}

// Checked by code point so that no invisible character has to sit in this source file.
function xmlEsc(s: string): string {
  let clean = "";
  for (let i = 0; i < s.length; i++) if (xmlAllowed(s.charCodeAt(i))) clean += s[i];
  return clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: String.fromCharCode(0xa0),
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function rPr(s: RunState): string {
  const p = (s.b ? "<w:b/><w:bCs/>" : "") + (s.i ? "<w:i/><w:iCs/>" : "") + (s.smallCaps ? "<w:smallCaps/>" : "")
    + (s.sup ? '<w:vertAlign w:val="superscript"/>' : s.sub ? '<w:vertAlign w:val="subscript"/>' : "");
  return p ? `<w:rPr>${p}</w:rPr>` : "";
}

function textRun(state: RunState, text: string): string {
  if (!text) return "";
  // A tab inside the text becomes a real tab element; newlines become breaks.
  const parts = text.split(/(\t|\n)/);
  const inner = parts.map((p) => (p === "\t" ? "<w:tab/>" : p === "\n" ? "<w:br/>" : p ? `<w:t xml:space="preserve">${xmlEsc(p)}</w:t>` : "")).join("");
  return `<w:r>${rPr(state)}${inner}</w:r>`;
}

/** WordprocessingML runs for one formatted html fragment. Unknown tags are dropped, their text kept. */
export function htmlToRuns(html: string): string {
  // "roman" is <span style="font-style:normal">: the reverse italics bibCase.italicize puts on a
  // species name inside an italic title. Italic is decided by the INNERMOST i/roman element.
  type Prop = keyof RunState | "roman";
  const stack: Array<Prop | null> = [];
  const state: RunState = { ...PLAIN };
  const sync = (): void => {
    state.b = stack.includes("b");
    state.sub = stack.includes("sub");
    state.sup = stack.includes("sup");
    state.smallCaps = stack.includes("smallCaps");
    let it = false;
    for (const p of stack) if (p === "i") it = true; else if (p === "roman") it = false;
    state.i = it;
  };
  let out = "";
  const re = /<(\/?)([a-z]+)\b([^>]*)>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined || m[5] !== undefined) {
      out += textRun(state, decodeEntities(m[4] ?? m[5]));
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    let prop: Prop | null = null;
    if (tag === "i" || tag === "em") prop = "i";
    else if (tag === "b" || tag === "strong") prop = "b";
    else if (tag === "sub") prop = "sub";
    else if (tag === "sup") prop = "sup";
    else if (tag === "span") {
      prop = /small-caps/i.test(m[3]) ? "smallCaps"
        : /font-style\s*:\s*normal/i.test(m[3]) ? "roman"
          : /font-style\s*:\s*italic/i.test(m[3]) ? "i" : null;
    }
    else if (tag === "br" && !closing) { out += "<w:r><w:br/></w:r>"; continue; }
    else continue;
    if (!closing) {
      if (/\/\s*$/.test(m[3])) continue; // self-closing: no content
      stack.push(prop);
    } else {
      stack.pop();
    }
    sync();
  }
  return out;
}

/** One hanging-indent paragraph. */
export function referenceParagraph(f: Formatted, label?: string, hangingTwips = 720): string {
  const pPr = `<w:pPr><w:spacing w:after="120"/><w:ind w:left="${hangingTwips}" w:hanging="${hangingTwips}"/></w:pPr>`;
  const lead = label ? `${textRun(PLAIN, label)}<w:r><w:tab/></w:r>` : "";
  return `<w:p>${pPr}${lead}${htmlToRuns(f.html)}</w:p>`;
}

function wrapPackage(body: string): string {
  return (
    '<?xml version="1.0" standalone="yes"?>'
    + '<?mso-application progid="Word.Document"?>'
    + '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">'
    + '<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">'
    + "<pkg:xmlData>"
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + "</Relationships></pkg:xmlData></pkg:part>"
    + '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">'
    + "<pkg:xmlData>"
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`
  );
}

/**
 * Plain paragraphs from formatted html fragments (<i>, <b>, <sub>, <sup>), with no paragraph
 * properties: they take the style of the paragraph they land in. The Characterization tool's
 * insert, so the text in Word is the text its preview showed.
 */
export function inlineParagraphsOoxml(htmls: string[]): string {
  const paras = htmls.filter((h) => h.trim()).map((h) => `<w:p>${htmlToRuns(h)}</w:p>`);
  return wrapPackage(paras.length ? paras.join("") : "<w:p/>");
}

/**
 * A scheme's title paragraph, as ACS sets it above the scheme: bold "Scheme N." (N a Word
 * SEQ Scheme field, so Word renumbers it on field update; `n` is its shown value until then),
 * then the title html. Caption style, kept with the picture that follows it.
 */
export function schemeCaptionOoxml(n: number, titleHtml: string): string {
  const num = Number.isInteger(n) && n > 0 ? n : 1;
  const field =
    '<w:fldSimple w:instr=" SEQ Scheme \\* ARABIC ">'
    + `<w:r>${rPr({ ...PLAIN, b: true })}<w:t>${num}</w:t></w:r></w:fldSimple>`;
  const title = titleHtml.trim() ? `${textRun(PLAIN, " ")}${htmlToRuns(titleHtml.trim())}` : "";
  return wrapPackage(
    `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:keepNext/></w:pPr>${textRun({ ...PLAIN, b: true }, "Scheme ")}${field}${textRun({ ...PLAIN, b: true }, ".")}${title}</w:p>`,
  );
}

/**
 * The bibliography block. `entries` is `RenumberPlan.entries` (refused records, whose
 * `formatted` is null, are skipped: the plan reports them) or a plain Formatted[].
 */
export function bibliographyOoxml(
  entries: ReadonlyArray<Formatted | { formatted: Formatted | null; n?: number }>,
  opts: BibBlockOptions = {},
): string {
  const hang = opts.hangingTwips && opts.hangingTwips > 0 ? Math.round(opts.hangingTwips) : 720;
  const paras: string[] = [];
  if (opts.heading && opts.heading.trim()) {
    paras.push(`<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>${textRun({ ...PLAIN, b: true }, opts.heading.trim())}</w:p>`);
  }
  for (const e of entries) {
    const f = "formatted" in e ? e.formatted : (e as Formatted);
    if (!f) continue;
    const n = "formatted" in e ? e.n : undefined;
    const label = opts.label && typeof n === "number" ? opts.label(n) : undefined;
    paras.push(referenceParagraph(f, label, hang));
  }
  if (!paras.length) paras.push("<w:p/>");
  return wrapPackage(paras.join(""));
}
