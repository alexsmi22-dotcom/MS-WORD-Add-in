import { latexToDsl, astToLatex } from "../latex";
import { parseMathAst } from "../mathParse";
import { mathToOmml } from "../mathOmml";

/** A translated DSL string should parse and emit OMML without throwing. */
function expectRenders(latex: string): string {
  const dsl = latexToDsl(latex);
  expect(() => mathToOmml(dsl)).not.toThrow();
  return dsl;
}

describe("latexToDsl", () => {
  it("translates fractions", () => {
    // The whole fraction is wrapped in an invisible group so a trailing script
    // binds to it (see "binds a trailing script to the whole fraction" below).
    expect(latexToDsl("\\frac{a}{b}")).toBe("{{a}/{b}}");
    expect(latexToDsl("\\frac12")).toBe("{{1}/{2}}");
  });

  it("binds a trailing script to the whole fraction, not the denominator", () => {
    // (a/b)² — the group wraps the fraction so ^2 applies to it, not to b.
    expect(latexToDsl("\\frac{a}{b}^2")).toBe("{{a}/{b}}^{2}");
    expect(() => mathToOmml(latexToDsl("\\frac{a}{b}^2"))).not.toThrow();
  });

  it("renders bare delimiter commands as their glyphs, not literal words", () => {
    expect(latexToDsl("\\langle x \\rangle")).toBe("⟨x⟩");
    expect(latexToDsl("\\lfloor x \\rfloor")).toBe("⌊x⌋");
    expect(latexToDsl("\\lceil x \\rceil")).toBe("⌈x⌉");
    expect(latexToDsl("\\langle \\psi | \\phi \\rangle")).toBe("⟨ψ|φ⟩");
  });

  it("translates roots", () => {
    expect(latexToDsl("\\sqrt{x}")).toBe("sqrt(x)");
    expect(latexToDsl("\\sqrt[3]{x}")).toBe("root(3, x)");
  });

  it("keeps scripts and braces", () => {
    expect(latexToDsl("x^{n+1}")).toBe("x^{n+1}");
    expect(latexToDsl("a_{i}")).toBe("a_{i}");
  });

  it("keeps multi-digit numbers and decimals intact", () => {
    expect(latexToDsl("\\frac{10}{20}")).toBe("{{10}/{20}}");
    expect(latexToDsl("x^{100}")).toBe("x^{100}");
    expect(latexToDsl("3.14r")).toBe("3.14r");
    expect(mathToOmml(latexToDsl("\\frac{100}{25}"))).toContain("100");
  });

  it("translates Greek letters to glyphs", () => {
    expect(latexToDsl("\\alpha + \\beta")).toBe("α+β");
    expect(latexToDsl("\\Omega")).toBe("Ω");
  });

  it("translates a big operator with limits", () => {
    expect(latexToDsl("\\sum_{i=1}^{n} i^2")).toBe("sum(i=1, n, i^{2})");
  });

  it("strips math delimiters", () => {
    expect(latexToDsl("$x^2$")).toBe("x^{2}");
    expect(latexToDsl("\\(a+b\\)")).toBe("a+b");
  });

  it("translates \\left \\right delimiters", () => {
    expect(latexToDsl("\\left( a \\right)")).toBe("(a)");
  });

  it("translates a pmatrix environment", () => {
    expect(latexToDsl("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}")).toBe("pmatrix(a, b; c, d)");
  });

  it("translates the quadratic formula and it renders", () => {
    const dsl = expectRenders("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
    expect(dsl).toContain("/");
    expect(dsl).toContain("sqrt(");
    expect(dsl).toContain("±");
  });

  it("renders sums, integrals, fractions, matrices end-to-end", () => {
    expectRenders("\\sum_{i=1}^{n} \\frac{1}{i^2}");
    expectRenders("\\int_{0}^{1} x^2 \\, dx");
    expectRenders("\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}");
  });

  it("imports aligned multi-line equations to an equation array", () => {
    const dsl = latexToDsl("\\begin{align} x &= 1 \\\\ y &= 2 \\end{align}");
    expect(dsl.startsWith("align(")).toBe(true);
    expect(mathToOmml(dsl)).toContain("<m:eqArr>");
  });

  it("supports the align() DSL directly", () => {
    expect(mathToOmml("align(a = b; c = d)")).toContain("<m:eqArr>");
  });

  it("degrades an empty environment to an empty string (no unparseable output)", () => {
    expect(latexToDsl("\\begin{align} \\end{align}")).toBe("");
    expect(latexToDsl("\\begin{pmatrix}\\end{pmatrix}")).toBe("");
  });
});

describe("astToLatex", () => {
  it("renders a fraction back to LaTeX", () => {
    expect(astToLatex(parseMathAst("a/b"))).toBe("\\frac{a}{b}");
  });

  it("renders scripts and roots", () => {
    expect(astToLatex(parseMathAst("x^{2}"))).toBe("x^{2}");
    expect(astToLatex(parseMathAst("sqrt(x)"))).toBe("\\sqrt{x}");
  });

  it("maps glyphs back to commands", () => {
    expect(astToLatex(parseMathAst("alpha"))).toBe("\\alpha");
  });

  it("round-trips the quadratic formula through DSL → LaTeX → DSL", () => {
    const dsl1 = latexToDsl("\\frac{-b + \\sqrt{b^2-4ac}}{2a}");
    const latex = astToLatex(parseMathAst(dsl1));
    // The re-imported LaTeX should still render.
    expect(() => mathToOmml(latexToDsl(latex))).not.toThrow();
  });
});
