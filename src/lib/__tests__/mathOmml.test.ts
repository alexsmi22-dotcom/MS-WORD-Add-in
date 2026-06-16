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
