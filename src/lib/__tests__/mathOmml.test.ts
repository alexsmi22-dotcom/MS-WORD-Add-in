import { mathToOmml, mathToOoxml } from "../mathOmml";
import { FORMULA_LIBRARY } from "../formulaLibrary";

describe("mathToOmml", () => {
  it("emits a fraction", () => {
    expect(mathToOmml("a/b")).toContain("<m:f>");
  });
  it("emits a radical", () => {
    expect(mathToOmml("sqrt(x)")).toContain("<m:rad>");
  });
  it("emits a summation with limits", () => {
    const omml = mathToOmml("sum(i=1, n, i)");
    expect(omml).toContain("<m:nary>");
    expect(omml).toContain("∑");
  });
  it("emits an integral", () => {
    expect(mathToOmml("int(a, b, x)")).toContain("∫");
  });
  it("parses literal Greek and implicit multiplication", () => {
    expect(() => mathToOmml("π r^2")).not.toThrow();
    expect(() => mathToOmml("2x + 3y")).not.toThrow();
  });
  it("supports factorial", () => {
    expect(() => mathToOmml("n!/(k!(n-k)!)")).not.toThrow();
  });
  it("throws on unparseable input", () => {
    expect(() => mathToOmml("(")).toThrow();
  });

  it("emits a matrix with the right column count and bracket delimiters", () => {
    const omml = mathToOmml("matrix(a, b; c, d)");
    expect(omml).toContain("<m:m>");
    expect(omml).toContain('<m:count m:val="2"/>');
    expect(omml).toContain('<m:begChr m:val="["/>');
    expect(omml).toContain('<m:endChr m:val="]"/>');
    // two rows
    expect(omml.match(/<m:mr>/g)).toHaveLength(2);
  });

  it("uses parentheses for pmatrix and bars for vmatrix", () => {
    expect(mathToOmml("pmatrix(1; 2)")).toContain('<m:begChr m:val="("/>');
    expect(mathToOmml("vmatrix(a, b; c, d)")).toContain('<m:begChr m:val="|"/>');
  });

  it("rejects a ragged matrix", () => {
    expect(() => mathToOmml("matrix(a, b; c)")).toThrow(/same number/);
  });

  it("emits piecewise cases with a left brace and 2-column left-aligned matrix", () => {
    const omml = mathToOmml("cases(x, if x > 0; -x, otherwise)");
    expect(omml).toContain('<m:begChr m:val="{"/>');
    expect(omml).toContain('<m:endChr m:val=""/>');
    expect(omml).toContain('<m:mcJc m:val="left"/>');
    expect(omml).toContain('<m:count m:val="2"/>');
  });

  it("allows a case with no condition", () => {
    expect(() => mathToOmml("cases(0; 1, otherwise)")).not.toThrow();
  });

  it("rejects a case with too many parts", () => {
    expect(() => mathToOmml("cases(x, a, b)")).toThrow(/value and an optional condition/);
  });

  it("emits floor, ceil, and norm as delimiters", () => {
    expect(mathToOmml("floor(x)")).toContain('<m:begChr m:val="⌊"/>');
    expect(mathToOmml("ceil(x)")).toContain('<m:begChr m:val="⌈"/>');
    expect(mathToOmml("norm(v)")).toContain('<m:begChr m:val="‖"/>');
  });

  it("parses square brackets (e.g. bio concentrations)", () => {
    const omml = mathToOmml("v = (V_max [S])/(K_m + [S])");
    expect(omml).toContain('<m:begChr m:val="["/>');
    expect(omml).toContain("<m:f>"); // the fraction
  });

  it("maps named symbols and number sets to glyphs", () => {
    expect(mathToOmml("forall x in ZZ")).toContain("∀");
    expect(mathToOmml("forall x in ZZ")).toContain("ℤ");
    expect(mathToOmml("a xor b")).toContain("⊕");
    expect(mathToOmml("partial f")).toContain("∂");
  });

  it("parses pasted prefix/operand glyphs", () => {
    expect(() => mathToOmml("∀ x ∈ ℤ")).not.toThrow();
    expect(() => mathToOmml("¬ p ∨ q")).not.toThrow();
    expect(() => mathToOmml("90°")).not.toThrow();
  });

  it("renders mod upright when used infix", () => {
    expect(mathToOmml("a mod n")).toContain('<m:sty m:val="p"/>');
  });

  it("emits Dirac bra-ket notation as delimiters", () => {
    expect(mathToOmml("bra(psi)")).toContain('<m:begChr m:val="⟨"/>');
    expect(mathToOmml("ket(psi)")).toContain('<m:endChr m:val="⟩"/>');
    const ip = mathToOmml("braket(φ, ψ)");
    expect(ip).toContain('<m:begChr m:val="⟨"/>');
    expect(ip).toContain('<m:endChr m:val="⟩"/>');
  });

  it("emits contour and multiple integrals", () => {
    expect(mathToOmml("oint(a, b, f)")).toContain("∮");
    expect(mathToOmml("iint(a, b, f)")).toContain("∬");
  });

  it("maps EE/physics symbols (angle, hbar, Laplace)", () => {
    expect(mathToOmml("V angle θ")).toContain("∠");
    expect(mathToOmml("E = hbar ω")).toContain("ℏ");
    expect(mathToOmml("laplace f")).toContain("ℒ");
  });
});

describe("formula library", () => {
  const all: Array<[string, string, string]> = [];
  for (const c of FORMULA_LIBRARY) {
    for (const f of c.formulas) all.push([c.name, f.label, f.expr]);
  }

  it.each(all)("%s / %s parses to OMML", (_cat, _label, expr) => {
    expect(() => mathToOmml(expr)).not.toThrow();
  });
});

describe("numbered equation OOXML", () => {
  it("adds a right-tab and the number label", () => {
    const ooxml = mathToOoxml("a/b", { number: "(IV)" });
    expect(ooxml).toContain("<w:tab/>");
    expect(ooxml).toContain("(IV)");
    expect(ooxml).toContain('w:val="right"');
  });
  it("omits numbering when not requested", () => {
    expect(mathToOoxml("a/b")).not.toContain("<w:tab/>");
  });
});
