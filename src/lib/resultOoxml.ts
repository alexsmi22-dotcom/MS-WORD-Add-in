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
  | { kind: "picture"; caption: string; base64: string; widthPt: number; heightPt: number; alt: string };

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

/** 1 pt = 12 700 EMU. */
const EMU_PER_PT = 12700;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const textPara = (text: string, jc?: "center" | "right"): string =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

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
      return `<w:tr>${cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${textPara(c, "right")}</w:tc>`).join("")}</w:tr>`;
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

/** The package, and how many pictures it carries (the host checks Word's own count against it). */
export function buildResultOoxml(items: ResultPackageItem[]): { ooxml: string; pictures: number } {
  const body: string[] = [];
  const images: Array<{ id: string; name: string; base64: string }> = [];
  for (const it of items) {
    if (it.kind === "text") body.push(textPara(it.content));
    else if (it.kind === "math") {
      try {
        body.push(`<w:p>${mathToOmml(it.content)}</w:p>`);
      } catch {
        body.push(textPara(it.content)); // the caller passes the readable fallback for a line that will not parse
      }
    } else if (it.kind === "table") {
      if (it.label) body.push(textPara(it.label));
      if (it.rows.length) body.push(tableXml(it.rows));
      // A table is always followed by a paragraph: Word needs one between a table and whatever comes next.
      body.push(`<w:p/>`);
    } else {
      const n = images.length + 1;
      const id = `rIdFig${n}`;
      images.push({ id, name: `figure${n}.png`, base64: it.base64 });
      if (it.caption) body.push(textPara(it.caption));
      body.push(`<w:p>${pictureRun(id, n, it.widthPt, it.heightPt, it.alt)}</w:p>`);
    }
  }
  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${body.join("")}</w:body></w:document>`;
  const part = (name: string, type: string, inner: string): string => `<pkg:part pkg:name="${name}" pkg:contentType="${type}">${inner}</pkg:part>`;
  const relsXml = `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/></Relationships>`;
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
