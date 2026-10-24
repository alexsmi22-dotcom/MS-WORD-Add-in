// One package for a whole result (v2.192.0): well-formed, every picture embedded and referenced, tables and
// equations real, nothing chained.
import { DOMParser } from "@xmldom/xmldom";
import { buildResultOoxml } from "../resultOoxml";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function parse(xml: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== "warning") errors.push(msg);
    },
  } as never).parseFromString(xml, "application/xml");
  expect(errors).toEqual([]);
  return doc as unknown as Document;
}

describe("buildResultOoxml", () => {
  const items = [
    { kind: "text" as const, content: "Kalman filter on 3 samples: a & b < c" },
    { kind: "math" as const, content: "x_k = F x_{k-1} + w" },
    { kind: "math" as const, content: "((not math" },
    { kind: "table" as const, label: "Estimates", rows: [["k", "x (m)"], ["1", "−0.5"], ["2", "0.75"]] },
    { kind: "picture" as const, caption: "Estimate and measurements", base64: PNG, widthPt: 330, heightPt: 210, alt: "Kalman \"estimate\"" },
    { kind: "picture" as const, caption: "Innovation", base64: PNG, widthPt: 300, heightPt: 180, alt: "Innovation sequence" },
    { kind: "text" as const, content: "Assumes linear Gaussian noise." },
  ];
  const { ooxml, pictures } = buildResultOoxml(items);
  const doc = parse(ooxml);

  test("it is one well-formed flat-OPC package", () => {
    expect(ooxml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(doc.getElementsByTagName("pkg:package").length).toBe(1);
  });

  test("every picture is a PNG part, referenced by an inline drawing at its size", () => {
    expect(pictures).toBe(2);
    const parts = Array.from(doc.getElementsByTagName("pkg:part")).map((p) => p.getAttribute("pkg:name"));
    expect(parts).toEqual(expect.arrayContaining(["/word/media/figure1.png", "/word/media/figure2.png", "/word/_rels/document.xml.rels"]));
    expect(doc.getElementsByTagName("pkg:binaryData")[0].textContent).toBe(PNG);
    const blips = Array.from(doc.getElementsByTagName("a:blip")).map((b) => b.getAttribute("r:embed"));
    const rels = Array.from(doc.getElementsByTagName("Relationship")).map((r) => r.getAttribute("Id"));
    for (const id of blips) expect(rels).toContain(id);
    expect(doc.getElementsByTagName("wp:extent")[0].getAttribute("cx")).toBe(String(330 * 12700));
    expect(doc.getElementsByTagName("wp:docPr")[0].getAttribute("descr")).toBe('Kalman "estimate"');
  });

  test("the table is a real Word table, followed by a paragraph", () => {
    const tbl = doc.getElementsByTagName("w:tbl");
    expect(tbl.length).toBe(1);
    expect(tbl[0].getElementsByTagName("w:tr").length).toBe(3);
    expect(tbl[0].nextSibling?.nodeName).toBe("w:p");
    expect(ooxml).toContain("−0.5");
  });

  test("an equation is an equation; a line that will not parse stays text", () => {
    expect(doc.getElementsByTagName("m:oMath").length).toBe(1);
    expect(ooxml).toContain("((not math");
  });

  test("text is escaped and kept in order", () => {
    expect(ooxml).toContain("a &amp; b &lt; c");
    const body = ooxml.slice(ooxml.indexOf("<w:body>"));
    const order = ["Kalman filter", "m:oMath", "Estimates", "<w:tbl>", "Estimate and measurements", "figure1.png", "Innovation", "Assumes linear"];
    let at = -1;
    for (const k of order) {
      const i = body.indexOf(k, at + 1);
      expect({ k, found: i > at }).toEqual({ k, found: true });
      at = i;
    }
  });

  test("no pictures: no image parts and no document relationships", () => {
    const r = buildResultOoxml([{ kind: "text", content: "x" }, { kind: "table", label: "", rows: [["1"]] }]);
    expect(r.pictures).toBe(0);
    expect(r.ooxml).not.toContain("document.xml.rels");
    parse(r.ooxml);
  });
});

describe("v2.192.1: fonts, alignment, spacing", () => {
  test("subscript and superscript characters become formatted base characters (Mac fonts lack ₖ, ₐ …)", () => {
    const r = buildResultOoxml([{ kind: "text", content: "sₖ² and Sₐ = 10⁻⁴" }]);
    expect(r.ooxml).not.toMatch(/[ₖₐ²⁻⁴]/);
    expect(r.ooxml).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">k</w:t>');
    expect(r.ooxml).toContain('<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">−4</w:t>');
  });
  test("ket brackets and ⊗ are set in Cambria Math; − and ≈ stay in the text font", () => {
    const r = buildResultOoxml([{ kind: "text", content: "|0⟩ ⊗ |1⟩ − 2 ≈ 3" }]);
    expect(r.ooxml).toMatch(/Cambria Math"\/><\/w:rPr><w:t xml:space="preserve">⟩<\/w:t>/);
    expect(r.ooxml).toContain('<w:t xml:space="preserve"> − 2 ≈ 3</w:t>');
  });
  test("table words are left-aligned, numbers right-aligned", () => {
    const r = buildResultOoxml([{ kind: "table", label: "", rows: [["Quantity", "Value"], ["Rabi frequency Ω/2π", "1 MHz"], ["P₁", "0.5"]] }]);
    const cells = [...r.ooxml.matchAll(/<w:jc w:val="(\w+)"\/>/g)].map((m) => m[1]);
    expect(cells).toEqual(["left", "left", "left", "right", "left", "right"]);
  });
  test("a result ending on a figure ends on an empty paragraph", () => {
    const r = buildResultOoxml([{ kind: "picture", caption: "c", base64: "AA==", widthPt: 10, heightPt: 10, alt: "a" }]);
    expect(r.ooxml).toMatch(/<\/w:drawing><\/w:r><\/w:p><w:p\/><\/w:body>/);
  });
});
