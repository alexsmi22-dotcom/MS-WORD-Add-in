// v2.193 math fixes: regressions from v2.192.1's mathParse changes, LaTeX import/export gaps, limits refused by
// cancellation, and smaller display defects. Each row pins the outcome seen after the fix.
//
// Oracle (sympy 1.x, jurislab-oracle-venv):
//   x = symbols('x')
//   limit((exp(x)-1-x)/x**2, x, 0)          -> 1/2
//   limit((cos(x)-1+x**2/2)/x**4, x, 0)     -> 1/24
//   limit(1/x, x, 0, '+'), (…, '-')         -> oo, -oo   (two-sided: does not exist)
//   diff(log(x, 10), x)                     -> 1/(x*log(10))
//   diff(2**x, x)                           -> 2**x*log(2)
//   diff(exp(-x**2/2), x)                   -> -x*exp(-x**2/2)
//   catalan(5)                              -> 42

import { parseMathAst, Node } from "../mathParse";
import { astToLatex, latexToDsl } from "../latex";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { limit } from "../analysis";
import { differentiate } from "../solve";
import { formatQuantityHtml } from "../units";
import { tryCombinatorics } from "../combinatorics";

const P = (s: string): Node => parseMathAst(s);
const tex = (s: string): string => astToLatex(P(s));

describe("1. a known function in a superscript keeps its argument", () => {
  test.each([
    ["e^sin(x)", "e^{\\sin\\left( x \\right)}"],
    ["10^log(x)", "10^{\\log\\left( x \\right)}"],
    ["e^cos(t)", "e^{\\cos\\left( t \\right)}"],
    ["e^atan(x)", "e^{\\operatorname{atan}\\left( x \\right)}"],
  ])("%s", (input, latex) => {
    const n = P(input);
    expect(n.k).toBe("sup");
    expect(n.k === "sup" && n.sup.k).toBe("func");
    expect(astToLatex(n)).toBe(latex);
  });
  test("subscripts keep the no-call rule: tr_B(…), r_i(S_k), T_max(x)", () => {
    for (const s of ["tr_B(ket(psi))", "r_i(S_k)", "T_max(x)"]) {
      const n = P(s);
      expect(n.k).toBe("row");
      expect(n.k === "row" && n.items[0].k).toBe("sub");
      expect(n.k === "row" && n.items[1].k).toBe("delim");
    }
  });
});

describe("2–3. a bracketed fraction keeps its brackets after a number and before !", () => {
  test.each(["2(1/2)", "-2(1/2)", "3.5(1/4)"])("%s is not a mixed number", (s) => {
    expect(mathToHtml(s)).toMatch(/\(<span class="m-frac">/);
    expect(tex(s)).toContain("\\left( \\frac{");
  });
  test("(a/b)! keeps its brackets", () => {
    expect(tex("(a/b)!")).toBe("\\left( \\frac{a}{b} \\right) !");
  });
  test("a lone fraction is still unbracketed: (1/2)(a+b), x (1/2)", () => {
    expect(tex("(1/2)(a+b)")).toBe("\\frac{1}{2} \\left( a + b \\right)");
    expect(tex("x (1/2)")).toBe("x \\frac{1}{2}");
  });
});

describe("4. ∂ glues to its variable inside a fraction", () => {
  test.each([
    ["∂u/∂t", "\\frac{\\partial u}{\\partial t}"],
    ["∂^2u/∂x^2", "\\frac{\\partial^{2} u}{\\partial x^{2}}"],
    ["partial^2 u/partial x^2", "\\frac{\\partial^{2} u}{\\partial x^{2}}"],
    ["partial f/partial x", "\\frac{\\partial f}{\\partial x}"],
  ])("%s", (input, latex) => {
    expect(P(input).k).toBe("frac");
    expect(tex(input)).toBe(latex);
  });
});

describe("5. dot is an accent only with exactly one bracketed argument", () => {
  test("nabla dot E = rho/epsilon_0 → ∇·E", () => {
    expect(tex("nabla dot E = rho/epsilon_0")).toBe("\\nabla \\cdot E = \\frac{\\rho}{\\epsilon_{0}}");
  });
  test("dot(a, b) is a function as before; dot(x) is ẋ", () => {
    const f = P("dot(a, b)");
    expect(f.k === "func" && f.name).toBe("dot");
    expect(P("dot(x)").k).toBe("acc");
    expect(tex("dot(x)")).toBe("\\dot{x}");
  });
});

describe("6. deg is the degree sign; re^(iθ) is italic letters", () => {
  test("90 deg → 90°", () => {
    expect(mathToHtml("90 deg")).toBe("90°");
  });
  test("re^(i theta) and a bare re are italic; re z and Re(z) stay upright", () => {
    const polar = P("re^(i theta)");
    expect(polar.k === "sup" && polar.base.k === "text" && polar.base.plain).toBeFalsy();
    expect(mathToOmml("re^(i theta)")).not.toContain('<m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">re<');
    const bare = P("z = re");
    expect(bare.k === "row" && bare.items[2].k === "text" && bare.items[2].plain).toBeFalsy();
    const applied = P("re z");
    expect(applied.k === "row" && applied.items[0].k === "text" && applied.items[0].plain).toBe(true);
    expect(P("Re(z)").k).toBe("func");
  });
  test("sin x, log x and sin^2 x + cos^2 x = 1 stay upright", () => {
    expect(tex("sin x")).toBe("\\sin x");
    expect(tex("log x")).toBe("\\log x");
    expect(tex("sin^2 x + cos^2 x = 1")).toBe("\\sin^{2} x + \\cos^{2} x = 1");
  });
});

describe("7. astToLatex", () => {
  test("accents: tilde, ddot, overline, dot", () => {
    expect(tex("tilde(x)")).toBe("\\tilde{x}");
    expect(tex("ddot(x)")).toBe("\\ddot{x}");
    expect(tex("overline(y)")).toBe("\\overline{y}");
    expect(tex("dot(q)")).toBe("\\dot{q}");
  });
  test("known functions without a LaTeX command export as \\operatorname", () => {
    expect(tex("erf(x)")).toBe("\\operatorname{erf}\\left( x \\right)");
    expect(tex("sgn(x)")).toBe("\\operatorname{sgn}\\left( x \\right)");
    expect(tex("softmax(z)")).toBe("\\operatorname{softmax}\\left( z \\right)");
    expect(tex("tr_B(rho)")).toBe("\\operatorname{tr}_{B} \\left( \\rho \\right)");
    expect(tex("sin(x)")).toBe("\\sin\\left( x \\right)");
    expect(tex("gcd(a, b)")).toBe("\\gcd\\left( a , b \\right)");
  });
  test("upright words: log_2 x → \\log_{2}, x mod n → \\operatorname{mod}, Pr → \\Pr", () => {
    expect(tex("log_2 x")).toBe("\\log_{2} x");
    expect(tex("x mod n")).toBe("x \\operatorname{mod} n");
    expect(astToLatex({ k: "text", v: "Pr", plain: true })).toBe("\\Pr");
  });
  test("% is escaped", () => {
    expect(astToLatex({ k: "text", v: "50%" })).toBe("50\\%");
  });
});

describe("8. latexToDsl", () => {
  test("\\binom{n}{k} → binom(n, k): stacked, no bar, in parentheses", () => {
    const dsl = latexToDsl("\\binom{n}{k}");
    expect(dsl).toBe("binom(n, k)");
    expect(P(dsl).k).toBe("binom");
    expect(astToLatex(P(dsl))).toBe("\\binom{n}{k}");
    const omml = mathToOmml(dsl);
    expect(omml).toContain('<m:type m:val="noBar"/>');
    expect(omml).toContain("<m:d><m:e><m:f>");
    expect(mathToHtml(dsl)).toContain("m-frac-nobar");
  });
  test("a binomial keeps its parentheses in a fraction and alone", () => {
    expect(tex("binom(n, k)/2")).toBe("\\frac{\\binom{n}{k}}{2}");
  });
  test("\\tilde, \\dot, \\ddot → accents", () => {
    const dsl = latexToDsl("\\tilde{x} + \\dot{x} + \\ddot{x}");
    expect(astToLatex(P(dsl))).toBe("\\tilde{x} + \\dot{x} + \\ddot{x}");
  });
  test("\\operatorname{erf}(x) → erf(x), one name", () => {
    expect(latexToDsl("\\operatorname{erf}(x)")).toBe("erf(x)");
  });
  test("\\mid → the divides sign ∣ (an operator; a bare | would open an absolute value)", () => {
    const dsl = latexToDsl("P(A \\mid B)");
    expect(dsl).toBe("P(A∣B)");
    expect(astToLatex(P(dsl))).toBe("P\\left( A \\mid B \\right)");
  });
  test("\\left\\{ … \\right\\} keeps visible braces", () => {
    const dsl = latexToDsl("\\left\\{ x \\mid x > 0 \\right\\}");
    expect(dsl).toBe("braces(x∣x>0)");
    expect(mathToHtml(dsl)).toMatch(/^\{.*\}$/);
    expect(astToLatex(P(dsl))).toBe("\\left\\{ x \\mid x > 0 \\right\\}");
    expect(latexToDsl("\\left( a \\right)")).toBe("(a)");
  });
});

describe("9. limits refused by cancellation now resolve; divergent limits stay refused", () => {
  test("(e^x − 1 − x)/x² → 1/2", () => {
    const r = limit("(e^x - 1 - x)/x^2", "x", 0)!;
    expect(r.kind).toBe("finite");
    expect(r.value).toBeCloseTo(0.5, 12);
  });
  test("(cos x − 1 + x²/2)/x⁴ → 1/24", () => {
    const r = limit("(cos(x) - 1 + x^2/2)/x^4", "x", 0)!;
    expect(r.kind).toBe("finite");
    expect(r.value).toBeCloseTo(1 / 24, 12);
  });
  test("1/x at 0, two-sided: does not exist", () => {
    expect(limit("1/x", "x", 0)!.kind).toBe("does-not-exist");
  });
  test("1/x² at 0 is not given a finite value", () => {
    expect(limit("1/x^2", "x", 0)!.kind).not.toBe("finite");
  });
  test("(x + 1e-10)/x at 0 (only nearly 0/0) is not given the value 1", () => {
    expect(limit("(x + 1e-10)/x", "x", 0)!.kind).not.toBe("finite");
  });
  test("sin(1/x)/x at 0 is not given a finite value", () => {
    expect(limit("sin(1/x)/x", "x", 0)!.kind).not.toBe("finite");
  });
  test("limit steps never show the internal variable _t", () => {
    const r = limit("x*sin(1/x)", "x", "inf")!;
    expect(r.value).toBe(1);
    expect(r.steps.join(" ")).not.toContain("_t");
    expect(r.steps.join(" ")).toContain("(cos(t))");
    const u = limit("t*sin(1/t)", "t", "inf")!;
    expect(u.steps.join(" ")).not.toContain("_t");
    expect(u.steps.join(" ")).toContain("t = 1/u");
  });
});

describe("smaller fixes", () => {
  test("exact derivatives keep ln(10), ln(2) and drop ln(e)", () => {
    expect(differentiate("log(x)")!.derivative).toBe("1/(x*ln(10))");
    expect(differentiate("2^x")!.derivative).toBe("2^x*ln(2)");
    expect(differentiate("e^(-x^2/2)")!.derivative).toBe("-x*e^(-x^2/2)");
    expect(differentiate("exp(-x^2/2)")!.derivative).toBe("-x*exp(-x^2/2)");
  });
  test("L'Hôpital working shows no ln(e)", () => {
    expect(limit("(e^x - 1)/x", "x", 0)!.steps.join(" ")).not.toContain("ln(e)");
  });
  test("negative quantities take the true minus", () => {
    expect(formatQuantityHtml("-40 °F")).toMatch(/^−40/);
    expect(formatQuantityHtml("-1.2e-3 mol/L")).toMatch(/^−1\.2 × 10⁻³/);
  });
  test("e-notation in Math mode is one number: 1.5e-3 → 1.5×10⁻³", () => {
    expect(tex("1.5e-3")).toBe("1.5 \\times 10^{- 3}");
    expect(mathToHtml("1.5e-3")).toBe('1.5<span class="m-op">×</span>10<sup><span class="m-op">−</span>3</sup>');
    expect(tex("2E5")).toBe("2 \\times 10^{5}");
  });
  test("e stays Euler's number when no digit follows it: 2e^x, 2e − 3, 2e", () => {
    expect(tex("2e^x")).toBe("2 e^{x}");
    expect(tex("2e - 3")).toBe("2 e - 3");
    expect(tex("2e")).toBe("2 e");
  });
  test("Catalan/Bell sequence label has its last subscript", () => {
    expect(tryCombinatorics("catalan 5")!.steps.join("\n")).toContain("Sequence C₀..C₅: 1, 1, 2, 5, 14, 42");
    expect(tryCombinatorics("bell 4")!.steps.join("\n")).toContain("Sequence B₀..B₄:");
    expect(tryCombinatorics("catalan 12")!.steps.join("\n")).toContain("Sequence C₀..C₁₀:");
  });
});
