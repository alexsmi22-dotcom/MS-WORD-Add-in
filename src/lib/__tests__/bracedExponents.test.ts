// Tier 1.8 — eleven library formulas typeset a spurious parenthesised exponent.
//
// `parseBase` on "(" builds a delimiter node that KEEPS the brackets; the braced
// form does not. Measured:
//
//   "e^(-x)"  -> HTML "e(-x)"   OMML sup contains <m:d>…</m:d>
//   "e^{-x}"  -> HTML "e-x"     clean
//
// The app's own help teaches the braced idiom and the Finance categories use it,
// so this is the library being inconsistent with itself. Pick Computer science /
// ML -> Sigmoid and Word showed sigma(x) = 1/(1 + e^((-x))).
//
// Also folded in: the math palette's superscript item was { snippet: "^", caret: 1 }
// with no braced-group snippet anywhere in palettes.ts, so a user who clicked it
// and typed "n-1" got x^n - 1.

import { FORMULA_LIBRARY } from "../formulaLibrary";
import { MATH_PALETTE } from "../palettes";
import { mathToHtml } from "../mathHtml";

const ALL: Record<string, string> = {};
for (const cat of FORMULA_LIBRARY) for (const f of cat.formulas) ALL[f.label] = f.expr;

describe("Tier 1.8 — the two exponent forms really do differ", () => {
  it("the paren form keeps its brackets and the braced form does not", () => {
    const braced = mathToHtml("e^{-x}");
    const parened = mathToHtml("e^(-x)");
    expect(parened).not.toBe(braced);
    expect(parened).toContain("(");
    expect(braced).not.toContain("(");
  });
});

describe("Tier 1.8 — no library entry uses the parenthesised exponent form", () => {
  it("sweeps every category", () => {
    const offenders: string[] = [];
    for (const cat of FORMULA_LIBRARY) {
      for (const f of cat.formulas) {
        if (/\^\s*\(/.test(f.expr)) offenders.push(`${cat.name} / ${f.label}: ${f.expr}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the eleven named entries now read in the braced idiom", () => {
    expect(ALL["Normal distribution (PDF)"]).toBe(
      "f(x) = (1/(sigma sqrt(2 pi))) e^{-(x - mu)^2/(2 sigma^2)}",
    );
    expect(ALL["Product of powers"]).toBe("a^m a^n = a^{m + n}");
    expect(ALL["Power rule"]).toBe("(d/dx) x^n = n x^{n - 1}");
    expect(ALL["Birthday bound"]).toBe("p ≈ 1 - e^{-(k^2)/(2 N)}");
    expect(ALL["Sigmoid"]).toBe("σ(x) = 1/(1 + e^{-x})");
    expect(ALL["Softmax"]).toBe("softmax(x_i) = e^{x_i}/sum(j=1, n, e^{x_j})");
    expect(ALL["Sinh"]).toBe("sinh(x) = (e^x - e^{-x})/2");
    expect(ALL["Cosh"]).toBe("cosh(x) = (e^x + e^{-x})/2");
    expect(ALL["Logistic / sigmoid"]).toBe("σ(x) = 1/(1 + e^{-x})");
    expect(ALL["Error function"]).toBe("erf(x) = (2/sqrt(π)) int(0, x, e^{-t^2})");
    expect(ALL["Binomial theorem"]).toBe("(x + y)^n = sum(k=0, n, C(n, k) x^{n - k} y^k)");
  });

  it("Sigmoid renders with no bracket around its exponent", () => {
    const html = mathToHtml(ALL["Sigmoid"]);
    // The only brackets left belong to sigma(x) and to (1 + …), not to the exponent.
    expect(html).not.toContain("((");
    expect(mathToHtml(ALL["Sigmoid"])).toBe(mathToHtml("σ(x) = 1/(1 + e^{-x})"));
  });

  it("every entry still parses and renders", () => {
    for (const cat of FORMULA_LIBRARY) {
      for (const f of cat.formulas) {
        expect(() => mathToHtml(f.expr)).not.toThrow();
      }
    }
  });
});

describe("Tier 1.8 — the math palette offers a braced group", () => {
  const items = MATH_PALETTE.flatMap((g) => g.items);

  it("the superscript item inserts a braced group with the caret INSIDE it", () => {
    const sup = items.find((i) => i.label === "xⁿ");
    expect(sup).toBeDefined();
    expect(sup!.snippet).toBe("^{}");
    expect(sup!.caret).toBe(2);
    // The reproduction: click it, type "n-1".
    const typed = sup!.snippet.slice(0, sup!.caret) + "n-1" + sup!.snippet.slice(sup!.caret);
    expect(typed).toBe("^{n-1}");
    expect(mathToHtml("x" + typed)).toBe(mathToHtml("x^{n-1}"));
  });
});
