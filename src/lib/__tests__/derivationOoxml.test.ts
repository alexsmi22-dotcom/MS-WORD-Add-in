// Solve inserts REAL Word equations, not flat ASCII (CAS-DESIGN §5.1).
//
// The pane typeset its derivations on screen and the product has carried a
// full OMML engine since Math mode shipped, yet Solve still called
// insertPlainText — so `a = F/m` arrived in the document as literal characters.
// These tests pin the package that fixes it: equation blocks must emit real
// <m:oMath>, prose must stay prose, and an un-parseable line must degrade to
// text rather than taking the whole insertion down with it.

import { buildDerivationOoxml, DerivationBlock } from "../mathOmml";

const build = (blocks: DerivationBlock[]) => buildDerivationOoxml(blocks);

describe("derivation OOXML", () => {
  it("emits a real OMML equation for a math block", () => {
    const xml = build([{ kind: "math", content: "a = F/m" }]);
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:f>"); // F/m is a fraction, not the text "F/m"
    expect(xml).toContain("m:num");
  });

  it("is a valid flat-OPC package Word will accept", () => {
    const xml = build([{ kind: "math", content: "x = 3" }]);
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<?mso-application progid=\"Word.Document\"?>");
    expect(xml).toContain("pkg:package");
    expect(xml).toContain("/word/document.xml");
    expect(xml).toContain("/_rels/.rels");
    // Balanced package parts.
    expect((xml.match(/<pkg:part /g) || []).length).toBe(2);
    expect((xml.match(/<\/pkg:part>/g) || []).length).toBe(2);
  });

  it("keeps prose as prose and headings bold", () => {
    const xml = build([
      { kind: "heading", content: "Solve for a:" },
      { kind: "text", content: "Method: exact (symbolic rearrangement)" },
    ]);
    expect(xml).toContain("<w:b/>"); // the heading
    expect(xml).toContain("Solve for a:");
    expect(xml).toContain("Method: exact (symbolic rearrangement)");
    expect(xml).not.toContain("<m:oMath>"); // no equations here
  });

  it("one un-parseable line degrades to text instead of failing the insertion", () => {
    const xml = build([
      { kind: "math", content: "x = 3" },
      { kind: "math", content: ")( not math at all ((" },
      { kind: "math", content: "y = 4" },
    ]);
    // The two good lines still became equations…
    expect((xml.match(/<m:oMath>/g) || []).length).toBe(2);
    // …and the bad one survived as readable text.
    expect(xml).toContain("not math at all");
  });

  it("escapes XML metacharacters in prose", () => {
    const xml = build([{ kind: "text", content: 'a < b & c > d "quoted"' }]);
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).not.toMatch(/<w:t[^>]*>a < b/);
  });

  it("produces one paragraph per block, in order", () => {
    const xml = build([
      { kind: "heading", content: "Solve for a:" },
      { kind: "math", content: "F = m*a" },
      { kind: "math", content: "a = F/m" },
      { kind: "text", content: "Requires m ≠ 0." },
    ]);
    expect((xml.match(/<w:p>/g) || []).length).toBe(4);
    expect(xml.indexOf("Solve for a:")).toBeLessThan(xml.indexOf("Requires m"));
  });

  it("typesets a definite integral with real limits", () => {
    const xml = build([{ kind: "math", content: "int(0, 3, x^2) = 9" }]);
    expect(xml).toContain("m:nary"); // a real ∫ with limits, not the text "int("
    expect(xml).toContain("∫");
  });

  it("handles every shape Solve actually emits", () => {
    const REAL: DerivationBlock[] = [
      { kind: "heading", content: "Solve for a:" },
      { kind: "math", content: "F = m*a" },
      { kind: "math", content: "a = F/m" },
      { kind: "math", content: "f'(x) = cos(x)^2 - sin(x)^2" },
      { kind: "math", content: "F(x) = x^3/3 + C" },
      { kind: "math", content: "int(0, 3, x^2) = 9" },
      { kind: "text", content: "x = 0 + 1i" }, // complex roots stay text
      { kind: "text", content: "Method: exact (quadratic)" },
    ];
    const xml = build(REAL);
    expect((xml.match(/<w:p>/g) || []).length).toBe(REAL.length);
    // Six of the eight lines are genuine equations…
    expect((xml.match(/<m:oMath>/g) || []).length).toBe(5);
    // …the fraction, the superscript and the integral all survived as real math…
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).toContain('<m:chr m:val="∫"/>');
    // …and a complex root, which is not linear math, stayed readable as text.
    expect(xml).toContain('<w:t xml:space="preserve">x = 0 + 1i</w:t>');
  });
});
