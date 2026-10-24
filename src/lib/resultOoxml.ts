/**
 * A whole result — prose, equations, tables and pictures — as ONE flat-OPC package, inserted by a single
 * insertOoxml call (v2.192.0).
 *
 * WHY: the result used to be played as a chain of inserts, each anchored on the range the previous one returned. Word
 * does not give a usable insertion point after an inserted OOXML package or after a table, so everything past the
 * first equation run or table silently failed to land — "only the formula was inserted" (a poles/zeros report, long
 * ago), and in v2.191.0, which gave 142 tools their governing equations and 85 their results tables, "only a few
 * lines inserted but nothing else, even the table" (Kalman filter, run on data) and "Word kept 0 of 1 figures"
 * (Combined loading and most quantum tools), on Mac and PC alike. One package has no chain to break.
 *
 * Pictures are embedded as PNG parts (word/media/imageN.png) referenced from inline drawings; tables are real Word
 * tables with single borders and right-aligned cells, as the chained path made them.
 */
import { mathToOmml } from "./mathOmml";

export type ResultPackageItem =
  | { kind: "text"; content: string }
  | { kind: "math"; content: string }
  | { kind: "table"; label: string; rows: string[][] }
  /** `caption` is set above the picture; `below` (optional) is a caption line under it (Statistics' bracket legend). */
  | { kind: "picture"; caption: string; base64: string; widthPt: number; heightPt: number; alt: string; below?: string }
  /**
   * Body XML written as given: one or more complete <w:p>/<w:tbl> elements in the w: namespace (v2.193.0), for
   * content another builder already formats — a scheme caption's SEQ field, a footnote's italic runs — so it goes in
   * the SAME package instead of a second insert chained off the first (which Word silently drops).
   */
  | { kind: "xml"; content: string };

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const PKG_NS = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

/**
 * The body of a flat-OPC package another builder made (bibOoxml's wrapPackage and friends): what sits between
 * <w:body> and </w:body> of its document part, or "" when there is none. For the "xml" item kind.
 */
export function packageBodyXml(pkg: string): string {
  const m = /<w:body>([\s\S]*?)<\/w:body>/.exec(pkg);
  return m ? m[1] : "";
}

/** 1 pt = 12 700 EMU. */
const EMU_PER_PT = 12700;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Unicode sub- and superscript characters, written as the base character with Word's own subscript/superscript
// formatting: fonts on the Mac lack many of them (ₖ, ₐ, ₜ, ᵢ…) and Word drew "?" (user, 2026-10-23).
const SUBSCRIPT: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "−", "₌": "=", "₍": "(", "₎": ")",
  "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₒ": "o", "ₚ": "p",
  "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ᵤ": "u", "ᵥ": "v", "ₓ": "x", "ᵦ": "β", "ᵧ": "γ", "ᵨ": "ρ", "ᵩ": "φ", "ᵪ": "χ",
};
const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "−", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i", "ᵀ": "T", "ᵉ": "e", "ᵏ": "k", "ᵖ": "p",
};
// Mathematical symbols outside the text fonts' usual repertoire (angle brackets of kets, ⊗, ∏, ‖, ∓, ≪, √ …): set in
// Cambria Math, which Office installs on Mac and PC alike.
// Common symbols every text font carries stay in the text font: − ≈ ≠ ≤ ≥ → ← ↔ √ ∞ ∑ ∂ ∆ ∫ ±.
const TEXT_FONT_SYMBOLS = new Set([0x2212, 0x2248, 0x2260, 0x2264, 0x2265, 0x2192, 0x2190, 0x2194, 0x221a, 0x221e, 0x2211, 0x2202, 0x2206, 0x222b]);
const isMathSymbol = (c: string): boolean => {
  const u = c.codePointAt(0) ?? 0;
  if (TEXT_FONT_SYMBOLS.has(u)) return false;
  return (u >= 0x2190 && u <= 0x22ff) || (u >= 0x27c0 && u <= 0x27ef) || (u >= 0x2980 && u <= 0x2aff) || u === 0x2016 || u === 0x210f;
};

type RunKind = "plain" | "sub" | "sup" | "math";
const kindOf = (c: string): RunKind => (c in SUBSCRIPT ? "sub" : c in SUPERSCRIPT ? "sup" : isMathSymbol(c) ? "math" : "plain");

/** Text as runs: plain, subscript, superscript, and Cambria Math for symbols. */
export function textRuns(text: string): string {
  const out: string[] = [];
  let cur = "";
  let kind: RunKind = "plain";
  const flush = (): void => {
    if (!cur) return;
    const rPr =
      kind === "sub" ? `<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>`
      : kind === "sup" ? `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>`
      : kind === "math" ? `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/></w:rPr>`
      : "";
    out.push(`<w:r>${rPr}<w:t xml:space="preserve">${esc(cur)}</w:t></w:r>`);
    cur = "";
  };
  for (const c of text) {
    const k = kindOf(c);
    if (k !== kind) {
      flush();
      kind = k;
    }
    cur += k === "sub" ? SUBSCRIPT[c] : k === "sup" ? SUPERSCRIPT[c] : c;
  }
  flush();
  return out.join("");
}

const textPara = (text: string, jc?: "center" | "right" | "left"): string =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ""}${textRuns(text)}</w:p>`;

/** A table cell that reads as a number (−5.2, 1.4×10⁻⁴, ½, 2/9 ≈ 0.22, 45 %) is right-aligned; words are left. */
const looksNumeric = (c: string): boolean => /^[\s+\-−±≈~]*[\d.,½¼¾⅓⅔]/.test(c) && !/[A-Za-z]{5,}/.test(c);

function tableXml(rows: string[][]): string {
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  const tblPr =
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${Array.from({ length: nCols }, () => `<w:gridCol/>`).join("")}</w:tblGrid>`;
  const body = rows
    .map((r) => {
      const cells = Array.from({ length: nCols }, (_, j) => r[j] ?? "");
      return `<w:tr>${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${textPara(c, looksNumeric(c) ? "right" : "left")}</w:tc>`).join("")}</w:tr>`;
    })
    .join("");
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>`;
}

function pictureRun(relId: string, n: number, widthPt: number, heightPt: number, alt: string): string {
  const cx = Math.max(1, Math.round(widthPt * EMU_PER_PT));
  const cy = Math.max(1, Math.round(heightPt * EMU_PER_PT));
  const d = esc(alt);
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${n}" name="Figure ${n}" descr="${d}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="figure${n}.png" descr="${d}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/**
 * The LAST paragraph of `xml` kept on the page of whatever follows it (<w:keepNext/>, fix2-plat): a caption or table
 * label above a figure or table was stranded at the bottom of a page with its figure on the next (measured via COM).
 * keepNext follows pStyle in CT_PPr's sequence. Body XML holding a table, or a paragraph already kept, is unchanged.
 */
export function keepWithNext(xml: string): string {
  if (!xml.startsWith("<w:p") || xml.includes("<w:tbl") || xml.includes("<w:keepNext")) return xml;
  const at = Math.max(xml.lastIndexOf("<w:p>"), xml.lastIndexOf("<w:p "));
  if (at < 0) return xml;
  const open = xml.indexOf(">", at) + 1;
  const tail = xml.slice(open);
  if (tail.startsWith("<w:pPr>")) {
    const style = /^<w:pPr>(<w:pStyle [^>]*\/>)?/.exec(tail)!;
    return xml.slice(0, open) + style[0] + "<w:keepNext/>" + tail.slice(style[0].length);
  }
  if (xml.slice(at, open).endsWith("/>")) return xml; // <w:p/>: an empty paragraph is no caption
  return xml.slice(0, open) + "<w:pPr><w:keepNext/></w:pPr>" + tail;
}

/** The package, and how many pictures it carries (the host checks Word's own count against it). */
export function buildResultOoxml(items: ResultPackageItem[]): { ooxml: string; pictures: number } {
  const body: string[] = [];
  const images: Array<{ id: string; name: string; base64: string }> = [];
  for (const it of items) {
    // ONE PARAGRAPH PER LINE (fix2-paf): a text item's embedded newlines went
    // into a single <w:t>, where Word reads a newline as a space — a Finance
    // summary's three lines landed as one run-on line.
    if (it.kind === "text") for (const line of it.content.split(/\r\n?|\n/)) body.push(line ? textPara(line) : "<w:p/>");
    else if (it.kind === "xml") {
      if (it.content.trim()) body.push(it.content);
    }
    else if (it.kind === "math") {
      try {
        body.push(`<w:p>${mathToOmml(it.content)}</w:p>`);
      } catch {
        body.push(textPara(it.content)); // the caller passes the readable fallback for a line that will not parse
      }
    } else if (it.kind === "table") {
      // A label stays on the page of its table (keepNext); a label with no table is plain text.
      if (it.label) body.push(it.rows.length ? keepWithNext(textPara(it.label)) : textPara(it.label));
      if (it.rows.length) body.push(tableXml(it.rows));
      // A table is always followed by a paragraph: Word needs one between a table and whatever comes next.
      body.push(`<w:p/>`);
    } else {
      const n = images.length + 1;
      const id = `rIdFig${n}`;
      images.push({ id, name: `figure${n}.png`, base64: it.base64 });
      // A caption above its figure is kept on the figure's page; a caption below keeps the figure with it.
      if (it.caption) body.push(keepWithNext(textPara(it.caption)));
      const pic = `<w:p>${pictureRun(id, n, it.widthPt, it.heightPt, it.alt)}</w:p>`;
      body.push(it.below ? keepWithNext(pic) : pic);
      if (it.below) for (const line of it.below.split(/\r\n?|\n/)) if (line) body.push(textPara(line));
    }
  }
  // A result that ends on a figure or table ends on an empty paragraph too, so the next insert starts on its own line
  // (one began on the same line as the figure above it in the user's demo document).
  if (body.length && !body[body.length - 1].startsWith("<w:p/>") && /<w:drawing>|<w:tbl>/.test(body[body.length - 1])) body.push(`<w:p/>`);
  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${body.join("")}</w:body></w:document>`;
  const part = (name: string, type: string, inner: string): string => `<pkg:part pkg:name="${name}" pkg:contentType="${type}">${inner}</pkg:part>`;
  const relsXml = `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/></Relationships>`;
  // NO styles part. A package-carried Caption definition (v2.193.0) REWROTE the document's own Caption style (Aptos 9,
  // no base — measured in Word via COM). A caption paragraph keeps its <w:pStyle w:val="Caption"/>, but without a
  // styles part Word lands it as Normal even in a document that uses Caption (measured via COM); the host applies the
  // built-in Caption style by name after the insert (ResultLayoutItem captionPrefix), which uses the document's own.
  const docRels =
    `<Relationships xmlns="${REL_NS}">` +
    images.map((im) => `<Relationship Id="${im.id}" Type="${IMAGE_REL}" Target="media/${im.name}"/>`).join("") +
    `</Relationships>`;
  const ooxml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<?mso-application progid="Word.Document"?>` +
    `<pkg:package xmlns:pkg="${PKG_NS}">` +
    part("/_rels/.rels", "application/vnd.openxmlformats-package.relationships+xml", `<pkg:xmlData>${relsXml}</pkg:xmlData>`) +
    part("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", `<pkg:xmlData>${documentXml}</pkg:xmlData>`) +
    (images.length
      ? part("/word/_rels/document.xml.rels", "application/vnd.openxmlformats-package.relationships+xml", `<pkg:xmlData>${docRels}</pkg:xmlData>`) +
        images.map((im) => part(`/word/media/${im.name}`, "image/png", `<pkg:binaryData>${im.base64}</pkg:binaryData>`)).join("")
      : "") +
    `</pkg:package>`;
  return { ooxml, pictures: images.length };
}
