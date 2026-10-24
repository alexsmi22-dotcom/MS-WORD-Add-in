// Emits OMML (Office Math Markup Language) from the shared math AST, wrapped in a
// minimal flat-OPC WordprocessingML package for Word.Range.insertOoxml(). This
// produces a real Word equation object: true fractions, radicals, summations,
// integrals, n-th roots, accents, etc.

import { Node, parseMathAst, isEmptyNode } from "./mathParse";

/** Drops characters XML 1.0 cannot carry at all (C0 controls other than tab/newline/CR, DEL is allowed but dropped). */
function xmlSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f || c === 0xfffe || c === 0xffff) continue;
    out += ch;
  }
  return out;
}

function escapeXml(s: string): string {
  return xmlSafe(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(text: string, plain = false): string {
  const rPr = plain ? `<m:rPr><m:sty m:val="p"/></m:rPr>` : "";
  return `<m:r>${rPr}<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

/** A run of normal (non-math) text: upright, in the text font, with its spaces kept ("if ", "otherwise"). */
function normalRun(text: string): string {
  return `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

const THIN_SPACE = String.fromCharCode(0x2009);

function emit(node: Node): string {
  switch (node.k) {
    case "text":
      // A unit after a number: a thin space, then the unit upright (25 °C, 3 m/s) — the SI way to write a quantity.
      if (node.unit) return run(THIN_SPACE + node.v, true);
      if (node.word) return normalRun(node.v);
      return run(node.v, node.plain);
    case "row":
      return node.items.map(emit).join("");
    case "frac":
      return `<m:f><m:num>${emit(node.num)}</m:num><m:den>${emit(node.den)}</m:den></m:f>`;
    case "binom":
      // A binomial coefficient: a bar-less fraction inside parentheses.
      return `<m:d><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${emit(node.top)}</m:num><m:den>${emit(node.bottom)}</m:den></m:f></m:e></m:d>`;
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
      // An omitted limit is HIDDEN (an indefinite integral ∫ f dx, ∮_C): an empty slot would draw a dotted box in Word.
      const hide = (isEmptyNode(node.sub) ? `<m:subHide m:val="1"/>` : "") + (isEmptyNode(node.sup) ? `<m:supHide m:val="1"/>` : "");
      return (
        `<m:nary><m:naryPr><m:chr m:val="${node.chr}"/><m:limLoc m:val="${limLoc}"/>${hide}</m:naryPr>` +
        `<m:sub>${emit(node.sub)}</m:sub><m:sup>${emit(node.sup)}</m:sup><m:e>${emit(node.body)}</m:e></m:nary>`
      );
    }
    case "func":
      // upright name for known functions, then the parenthesized argument
      return run(node.name, node.known) + emit(node.arg);
    case "lim":
      if (isEmptyNode(node.sub)) return `<m:func><m:fName>${run("lim", true)}</m:fName><m:e>${emit(node.body)}</m:e></m:func>`;
      return (
        `<m:func><m:fName><m:limLow><m:e>${run("lim", true)}</m:e>` +
        `<m:lim>${emit(node.sub)}</m:lim></m:limLow></m:fName><m:e>${emit(node.body)}</m:e></m:func>`
      );
    case "acc":
      // A bar over more than one letter (bar(xy), the mean of a product) is an overbar spanning the whole base: Word
      // draws a combining macron as a short mark centred over the group (seen in Word, 2026-10-24).
      if ((node.chr === "̄" || node.chr === "̅") && !(node.base.k === "text" && [...node.base.v].length === 1)) {
        return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${emit(node.base)}</m:e></m:bar>`;
      }
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
    case "stack":
      // Stacked equations as an equation array (Word aligns at the relation).
      return `<m:eqArr>${node.rows.map((r) => `<m:e>${emit(r)}</m:e>`).join("")}</m:eqArr>`;
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
  /** Instead of `number`: the label as ready WordprocessingML runs (a SEQ field number — captionFields.ts). */
  numberRunsXml?: string;
}

/**
 * Wraps an `<m:oMath>` body in a minimal flat-OPC package that
 * Word.Range.insertOoxml() accepts. The equation is placed inline in a paragraph;
 * when `options.number` is given, a right-aligned number label is appended.
 */
export function buildMathOoxml(ommlBody: string, options: MathOoxmlOptions = {}): string {
  const number = options.number;
  const labelled = !!number || !!options.numberRunsXml;
  // Right tab stop near the page margin so the number flushes right, patent-style.
  const pPr = labelled ? `<w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>` : "";
  const numberRuns = options.numberRunsXml
    ? `<w:r><w:tab/></w:r>${options.numberRunsXml}`
    : number
      ? `<w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">${escapeXml(number)}</w:t></w:r>`
      : "";
  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}">` +
    `<w:body><w:p>${pPr}${ommlBody}${numberRuns}</w:p></w:body></w:document>`;
  return flatOpcPackage(documentXml);
}

/** A WordprocessingML document part as the minimal flat-OPC package Word.Range.insertOoxml() accepts. */
export function flatOpcPackage(documentXml: string): string {
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

/**
 * One line of a multi-paragraph insertion: either prose or an equation.
 * `math` content is linear math (the same grammar Math mode accepts); if it
 * fails to parse the line degrades to plain text rather than failing the whole
 * insertion — a derivation is still useful with one line un-typeset.
 */
export interface DerivationBlock {
  kind: "text" | "math" | "heading";
  content: string;
}

/**
 * Builds a multi-paragraph flat-OPC package mixing prose and REAL Word
 * equations, for inserting a worked derivation.
 *
 * Solve used to insert its derivations as flat ASCII through insertPlainText,
 * even though the pane already typeset them on screen and this OMML engine was
 * driving Math mode the whole time — so `a = F/m` arrived in the document as
 * the literal characters "a = F/m" rather than an editable equation. This is
 * what makes the inserted result a first-class Word object.
 */
export function buildDerivationOoxml(blocks: DerivationBlock[]): string {
  const paragraphs = blocks
    .map((b) => {
      if (b.kind === "math") {
        try {
          return `<w:p>${mathToOmml(b.content)}</w:p>`;
        } catch {
          return textParagraph(b.content, false); // un-parseable: keep the text
        }
      }
      return textParagraph(b.content, b.kind === "heading");
    })
    .join("");

  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}">` +
    `<w:body>${paragraphs}</w:body></w:document>`;

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

function textParagraph(text: string, bold: boolean): string {
  const rPr = bold ? `<w:rPr><w:b/></w:rPr>` : "";
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
