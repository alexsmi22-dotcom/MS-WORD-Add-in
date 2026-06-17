// Emits OMML (Office Math Markup Language) from the shared math AST, wrapped in a
// minimal flat-OPC WordprocessingML package for Word.Range.insertOoxml(). This
// produces a real Word equation object: true fractions, radicals, summations,
// integrals, n-th roots, accents, etc.

import { Node, parseMathAst } from "./mathParse";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(text: string, plain = false): string {
  const rPr = plain ? `<m:rPr><m:sty m:val="p"/></m:rPr>` : "";
  return `<m:r>${rPr}<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

function emit(node: Node): string {
  switch (node.k) {
    case "text":
      return run(node.v, node.plain);
    case "row":
      return node.items.map(emit).join("");
    case "frac":
      return `<m:f><m:num>${emit(node.num)}</m:num><m:den>${emit(node.den)}</m:den></m:f>`;
    case "sup":
      return `<m:sSup><m:e>${emit(node.base)}</m:e><m:sup>${emit(node.sup)}</m:sup></m:sSup>`;
    case "sub":
      return `<m:sSub><m:e>${emit(node.base)}</m:e><m:sub>${emit(node.sub)}</m:sub></m:sSub>`;
    case "subsup":
      return (
        `<m:sSubSup><m:e>${emit(node.base)}</m:e>` +
        `<m:sub>${emit(node.sub)}</m:sub><m:sup>${emit(node.sup)}</m:sup></m:sSubSup>`
      );
    case "rad":
      if (node.degree) {
        return `<m:rad><m:deg>${emit(node.degree)}</m:deg><m:e>${emit(node.radicand)}</m:e></m:rad>`;
      }
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${emit(node.radicand)}</m:e></m:rad>`;
    case "delim": {
      const pr =
        node.open === "(" && node.close === ")"
          ? ""
          : `<m:dPr><m:begChr m:val="${escapeXml(node.open)}"/><m:endChr m:val="${escapeXml(node.close)}"/></m:dPr>`;
      return `<m:d>${pr}<m:e>${emit(node.inner)}</m:e></m:d>`;
    }
    case "nary": {
      const limLoc = node.underOver ? "undOvr" : "subSup";
      return (
        `<m:nary><m:naryPr><m:chr m:val="${node.chr}"/><m:limLoc m:val="${limLoc}"/></m:naryPr>` +
        `<m:sub>${emit(node.sub)}</m:sub><m:sup>${emit(node.sup)}</m:sup><m:e>${emit(node.body)}</m:e></m:nary>`
      );
    }
    case "func":
      // upright name for known functions, then the parenthesized argument
      return run(node.name, node.known) + emit(node.arg);
    case "lim":
      return (
        `<m:func><m:fName><m:limLow><m:e>${run("lim", true)}</m:e>` +
        `<m:lim>${emit(node.sub)}</m:lim></m:limLow></m:fName><m:e>${emit(node.body)}</m:e></m:func>`
      );
    case "acc":
      return `<m:acc><m:accPr><m:chr m:val="${node.chr}"/></m:accPr><m:e>${emit(node.base)}</m:e></m:acc>`;
    case "matrix": {
      const cols = node.rows[0].length;
      const core = matrixCore(node.rows, cols, "center");
      return (
        `<m:d><m:dPr><m:begChr m:val="${escapeXml(node.open)}"/>` +
        `<m:endChr m:val="${escapeXml(node.close)}"/></m:dPr><m:e>${core}</m:e></m:d>`
      );
    }
    case "cases": {
      // Piecewise: a left brace with a 2-column, left-aligned matrix (value | condition).
      const padded = node.rows.map((r) => [r[0], r[1] ?? { k: "row" as const, items: [] }]);
      const core = matrixCore(padded, 2, "left");
      return `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>${core}</m:e></m:d>`;
    }
  }
}

/** Emits an `<m:m>` matrix body with `cols` columns justified `jc`. */
function matrixCore(rows: Node[][], cols: number, jc: "center" | "left"): string {
  const mcPr = `<m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="${jc}"/></m:mcPr></m:mc></m:mcs>`;
  const body = rows.map((row) => `<m:mr>${row.map((cell) => `<m:e>${emit(cell)}</m:e>`).join("")}</m:mr>`).join("");
  return `<m:m><m:mPr>${mcPr}</m:mPr>${body}</m:m>`;
}

/** Parses `input` and returns the `<m:oMath>…</m:oMath>` body. Throws on parse errors. */
export function mathToOmml(input: string): string {
  const ast = parseMathAst(input);
  return `<m:oMath>${emit(ast)}</m:oMath>`;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const PKG_NS = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

export interface MathOoxmlOptions {
  /** When set, appends a right-aligned label (e.g. "(I)") — patent-style equation numbering. */
  number?: string;
}

/**
 * Wraps an `<m:oMath>` body in a minimal flat-OPC package that
 * Word.Range.insertOoxml() accepts. The equation is placed inline in a paragraph;
 * when `options.number` is given, a right-aligned number label is appended.
 */
export function buildMathOoxml(ommlBody: string, options: MathOoxmlOptions = {}): string {
  const number = options.number;
  // Right tab stop near the page margin so the number flushes right, patent-style.
  const pPr = number ? `<w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>` : "";
  const numberRuns = number
    ? `<w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">${escapeXml(number)}</w:t></w:r>`
    : "";
  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}">` +
    `<w:body><w:p>${pPr}${ommlBody}${numberRuns}</w:p></w:body></w:document>`;

  const relsXml =
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/>` +
    `</Relationships>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<?mso-application progid="Word.Document"?>` +
    `<pkg:package xmlns:pkg="${PKG_NS}">` +
    `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">` +
    `<pkg:xmlData>${relsXml}</pkg:xmlData></pkg:part>` +
    `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
    `<pkg:xmlData>${documentXml}</pkg:xmlData></pkg:part>` +
    `</pkg:package>`
  );
}

/** Convenience: parse linear math and return the full insertable OOXML package. */
export function mathToOoxml(input: string, options: MathOoxmlOptions = {}): string {
  return buildMathOoxml(mathToOmml(input), options);
}
