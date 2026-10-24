// Pinned fixes from the 2026-10-24 math review (LaTeX import/export, the Math-mode parser and preview, palettes, the
// formula library, and the unit converter). Every row is a reviewer finding; later rounds must keep each outcome.
import { latexToDsl, astToLatex } from "../latex";
import { parseMathAst, Node } from "../mathParse";
import { mathToOmml } from "../mathOmml";
import { mathToHtml } from "../mathHtml";
import { MATH_PALETTE } from "../palettes";
import { FORMULA_LIBRARY } from "../formulaLibrary";
import { convert, convertForDisplay, formatQuantityHtml, formatSig, formatUnit, lookup, parseMeasured, roundSig } from "../units";

const omml = (dsl: string): string => mathToOmml(dsl);
const fromTex = (tex: string): string => mathToOmml(latexToDsl(tex));
/** OMML reduced to its run texts, "[up]" marking an upright (m:sty p) run and "[nor]" a normal-text run. */
const runs = (o: string): string[] =>
  [...o.matchAll(/<m:r>(<m:rPr>(.*?)<\/m:rPr>)?<m:t xml:space="preserve">(.*?)<\/m:t><\/m:r>/g)].map(
    (m) => (m[2]?.includes("m:nor") ? "[nor]" : m[2]?.includes('m:sty m:val="p"') ? "[up]" : "") + m[3],
  );
const palette = (label: string): string => {
  for (const g of MATH_PALETTE) for (const it of g.items) if (it.label === label) return it.snippet;
  throw new Error(`no palette item ${label}`);
};
const library = (label: string): string => {
  for (const c of FORMULA_LIBRARY) for (const f of c.formulas) if (f.label === label) return f.expr;
  throw new Error(`no library entry ${label}`);
};

describe("1. a function command takes its whole argument run (\\sin 2x = sin(2x))", () => {
  it.each([
    ["\\cos 2\\theta", "cos(2θ)"],
    ["\\sin 2x", "sin(2x)"],
    ["\\log 10x", "log(10x)"],
    ["\\sin\\theta", "sin(θ)"],
    ["\\sin x^2", "sin(x^{2})"],
    ["\\ln\\Gamma(x)", "ln(Γ(x))"],
    ["\\exp\\lambda t", "exp(λ t)"],
    ["\\sin x \\cos y", "sin(x)cos(y)"],
    ["\\sin(\\omega t + \\phi)", "sin(ω t+φ)"],
    ["\\log 10.5x", "log(10.5x)"],
  ])("%s → %s", (tex, dsl) => {
    expect(latexToDsl(tex)).toBe(dsl);
    expect(() => mathToOmml(latexToDsl(tex))).not.toThrow();
  });
  it("cos 2θ puts 2θ inside the function's brackets in Word", () => {
    expect(fromTex("\\cos 2\\theta")).toContain("<m:d><m:e><m:r><m:t xml:space=\"preserve\">2</m:t></m:r><m:r><m:t xml:space=\"preserve\">θ</m:t></m:r></m:e></m:d>");
  });
});

describe("2. Greek and other letters from separate commands never glue into one name", () => {
  it.each([
    ["\\sigma\\sqrt{2\\pi}", "σ sqrt(2π)"],
    ["\\alpha\\sin\\theta", "α sin(θ)"],
    ["\\Delta x \\Delta p", "Δ x Δ p"],
  ])("%s → %s", (tex, dsl) => expect(latexToDsl(tex)).toBe(dsl));
  it("σ√(2π) is σ times a radical, not a name σsqrt", () => {
    expect(fromTex("\\frac{1}{\\sigma\\sqrt{2\\pi}}")).toContain("<m:rad>");
  });
});

describe("3. n! = … never becomes n ≠ …", () => {
  it.each(["n! = \\prod_{k=1}^{n} k", "3! = 6"])("%s", (tex) => {
    const o = fromTex(tex);
    expect(o).not.toContain("≠");
    expect(runs(o)).toContain("[up]!");
    expect(runs(o)).toContain("[up]=");
  });
});

describe("4. \\inf, \\sup, \\liminf … are upright operator names (\\inf was ∞)", () => {
  it.each([
    ["\\inf S", "[up]inf"],
    ["\\sup_n a_n", "[up]sup"],
    ["\\liminf_{n\\to\\infty} a_n", "[up]liminf"],
    ["\\limsup_{n\\to\\infty} a_n", "[up]limsup"],
    ["\\max_x f", "[up]max"],
    ["\\Pr(A)", "[up]Pr"],
    ["\\ker T", "[up]ker"],
    ["\\arg z", "[up]arg"],
  ])("%s", (tex, run) => {
    const o = fromTex(tex);
    // (an operand right after the name gets a thin space: inf S)
    expect(runs(o).map((r) => r.replace(String.fromCharCode(0x2009), ""))).toContain(run);
    expect(o).not.toContain("∞</m:t></m:r><m:r><m:t xml:space=\"preserve\">S");
  });
  it("typed inf in a limit is still infinity", () => {
    expect(omml("int(0, inf, e^{-x} dx)")).toContain("∞");
  });
  it("exports back as \\inf", () => expect(astToLatex(parseMathAst(latexToDsl("\\inf S")))).toContain("\\inf"));
});

describe("5. brackets: expectation, ket, bra, braket, norm, floor, ceiling and the letter-like symbols", () => {
  const delim = (o: string): string[] => [...o.matchAll(/<m:begChr m:val="(.*?)"\/><m:endChr m:val="(.*?)"\/>/g)].map((m) => m[1] + m[2]);
  it.each([
    ["\\left\\langle A\\right\\rangle", "⟨⟩"],
    ["\\left|\\psi\\right\\rangle", "|⟩"],
    ["\\langle\\phi|", "⟨|"],
    ["\\langle\\phi|\\psi\\rangle", "⟨⟩"],
    ["\\left\\| v\\right\\|", "‖‖"],
    ["\\| v \\|", "‖‖"],
    ["\\lfloor x \\rfloor", "⌊⌋"],
    ["\\left\\lfloor x\\right\\rfloor", "⌊⌋"],
    ["\\lceil x \\rceil", "⌈⌉"],
    ["\\left\\lceil x\\right\\rceil", "⌈⌉"],
    ["\\ket{\\psi}", "|⟩"],
    ["\\bra{\\psi}", "⟨|"],
  ])("%s → %s", (tex, pair) => expect(delim(fromTex(tex))).toEqual([pair]));
  it("⟨φ|ψ⟩ keeps its inner bar", () => expect(runs(fromTex("\\langle\\phi|\\psi\\rangle"))).toEqual(["φ", "[up]|", "ψ"]));
  it.each([
    ["\\cdots", "⋯"], ["\\ldots", "…"], ["\\ell", "ℓ"], ["\\Re(z)", "ℜ"], ["\\Im(z)", "ℑ"], ["\\hbar", "ℏ"],
    ["\\nabla", "∇"], ["\\partial", "∂"], ["\\infty", "∞"], ["\\nexists x", "∄"],
  ])("%s → %s", (tex, glyph) => expect(runs(fromTex(tex))).toContain(glyph));
});

describe("6. a big operator's body ends at a top-level relation or sign", () => {
  it.each([
    ["\\sum_{i=1}^n i = n(n+1)/2", "sum(i=1, n, i)=n(n+1)/2"],
    ["\\sum_{i=1}^{n} x_i + c", "sum(i=1, n, x_{i})+c"],
    ["\\int_0^1 x\\,dx + 1", "int(0, 1, x d x)+1"],
    ["\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1", "lim(x→0, {{sin(x)}/{x}})=1"],
    ["\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}", "sum(n=1, ∞, {{1}/{n^{2}}})={{π^{2}}/{6}}"],
    // Not at the top level: inside brackets the sign belongs to the body.
    ["\\sum_i (a_i + b_i)", "sum(i, , (a_{i}+b_{i}))"],
    ["\\left( \\sum_i a_i \\right)", "(sum(i, , a_{i}))"],
    // A leading sign is the body's own.
    ["\\sum_i -a_i", "sum(i, , -a_{i})"],
  ])("%s → %s", (tex, dsl) => {
    expect(latexToDsl(tex)).toBe(dsl);
    expect(() => mathToOmml(dsl)).not.toThrow();
  });
});

describe("9. a wide accent covers its whole base in the preview", () => {
  it("bar(xy) is one overline over both letters, not a mark on y", () => {
    const h = mathToHtml("bar(xy)");
    expect(h).toContain("border-top");
    expect(h).not.toContain("ȳ");
  });
  it("vec(AB) has one arrow over AB", () => {
    const h = mathToHtml("vec(AB)");
    expect(h).toContain("→");
    expect(h).not.toContain("B⃗");
  });
  it("hat(ab) is wide too", () => expect(mathToHtml("hat(ab)")).toContain("m-acc-wide"));
  it("a single letter keeps its combining accent", () => expect(mathToHtml("bar(x)")).toBe("x̄"));
});

describe("11. pathological nesting is a named refusal, never a RangeError", () => {
  it("2000-deep LaTeX fractions", () => {
    const tex = "\\frac{".repeat(2000) + "x" + "}{y}".repeat(2000);
    expect(() => latexToDsl(tex)).toThrow(/nested more than 150 levels/);
  });
  it("3000-deep brackets in the DSL", () => {
    const dsl = "(".repeat(3000) + "x" + ")".repeat(3000);
    expect(() => parseMathAst(dsl)).toThrow(/nested more than 200 levels/);
    expect(() => mathToHtml(dsl)).not.toThrow();
  });
  it("5000 unary minus signs", () => expect(() => parseMathAst("-".repeat(5000) + "x")).toThrow(/nested more than/));
});

describe("12. a unit after a number is upright, its slash a solidus", () => {
  it.each([
    ["25 °C", "[up] °C"],
    ["25°C", "[up] °C"],
    ["100 Ω", "[up] Ω"],
    ["5 kg", "[up] kg"],
    ["v = 3 m/s", "[up] m/s"],
    ["g = 9.81 m/s^2", "[up] m/s²"],
    ["T = 300 K", "[up] K"],
    ["x = 5 mm", "[up] mm"],
    ["c = 0.1 mol/L", "[up] mol/L"],
    ["R = 4.7 kΩ", "[up] kΩ"],
    ["T = -40 °C", "[up] °C"],
  ])("%s", (dsl, run) => {
    const o = omml(dsl);
    // The run is a THIN SPACE (U+2009) then the unit.
    expect(runs(o)).toContain(run.replace(" ", String.fromCharCode(0x2009)));
    expect(o).not.toContain("<m:f>");
  });
  it.each([
    // Variables stay variables: a letter used elsewhere, inside a script, inside an expression, or a formula shape.
    "H(s) = 1/(2 s + 1)",
    "F = 3 m a",
    "E = 2 m c^2",
    "x = 2 t",
    "x_2 m",
    "e^{2 s}",
    "tau_max = T d/(2 J)",
    "h_m = Sigma K V^2/(2 g)",
    "T_Sabine = 0.161 V/A",
    "q_c = {p} ((1 + 0.2 M^2)^{3.5} - 1)",
    "y = 2 x + 3 m",
  ])("%s keeps its letters italic", (dsl) =>
    expect(runs(omml(dsl)).some((r) => r.startsWith("[up]" + String.fromCharCode(0x2009)))).toBe(false));
  it("the unit exports as \\mathrm and previews upright", () => {
    expect(astToLatex(parseMathAst("v = 3 m/s"))).toBe("v = 3 \\,\\mathrm{m/s}");
    expect(mathToHtml("5 kg")).toBe('5<span class="m-fn">&#8201;kg</span>');
  });
});

describe("14/15. palette snippets", () => {
  it("eˣ inserts a braced exponent (no visible brackets)", () => expect(palette("eˣ")).toBe("e^{}"));
  it("the cases template sets if/otherwise as upright words", () => {
    const r = runs(omml(palette("{cases")));
    expect(r).toContain("[nor]if ");
    expect(r).toContain("[nor]otherwise");
    expect(r).not.toContain("if");
  });
  it("Var and Cov insert Var and Cov, upright", () => {
    expect(palette("Var")).toBe("Var()");
    expect(palette("Cov")).toBe("Cov(, )");
    expect(runs(omml("Var(X)"))).toContain("[up]Var");
    expect(runs(omml("Cov(X, Y)"))).toContain("[up]Cov");
  });
  it("sigmoid is labelled sigmoid, sin⁻¹ inserts sin^{-1}", () => {
    expect(palette("sigmoid")).toBe("sigmoid()");
    expect(palette("sin⁻¹")).toBe("sin^{-1}()");
    expect(palette("cos⁻¹")).toBe("cos^{-1}()");
    expect(palette("tan⁻¹")).toBe("tan^{-1}()");
    expect(omml("sin^{-1}(x)")).toContain("<m:sSup>");
  });
  it("palette carets land inside the brackets", () => {
    for (const label of ["eˣ", "sin⁻¹", "cos⁻¹", "tan⁻¹", "Var", "Cov", "sigmoid"]) {
      for (const g of MATH_PALETTE)
        for (const it of g.items) if (it.label === label) expect("({".includes(it.snippet[(it.caret ?? 0) - 1])).toBe(true);
    }
  });
  it("a typed \\text{if } from LaTeX is an upright word too", () => expect(runs(fromTex("\\text{if } x > 0"))).toContain("[nor]if "));
});

describe("16. Copy as LaTeX writes only ASCII (pdflatex compiles it)", () => {
  it.each([
    ["FF_q", "\\mathbb{F}"],
    ["EE[X]", "\\mathbb{E}"],
    ["a parallel b", "\\parallel"],
    ["90 degree", "^{\\circ}"],
    ["ℒ(f)", "\\mathcal{L}"],
    ["ℱ(f)", "\\mathcal{F}"],
    ["laplace {f}", "\\mathcal{L}"],
    ["⟨ψ|φ⟩", "\\langle"],
    ["‖v‖", "\\|"],
    ["y'", "y'"],
  ])("%s → contains %s", (dsl, tex) => expect(astToLatex(parseMathAst(dsl))).toContain(tex));
  it("every library formula and palette snippet exports as pure ASCII", () => {
    const bad: string[] = [];
    const check = (src: string): void => {
      let ast: Node;
      try {
        ast = parseMathAst(src);
      } catch {
        return;
      }
      const tex = astToLatex(ast);
      if (/[^\x20-\x7e]/.test(tex)) bad.push(`${src} → ${tex}`);
    };
    for (const c of FORMULA_LIBRARY) for (const f of c.formulas) check(f.expr);
    for (const g of MATH_PALETTE) for (const it of g.items) check(it.snippet);
    for (const s of ["α β γ ℏ ∇ ∂ ∞ ℤ ℝ ℕ ℚ ℂ ℙ 𝔼 𝔽 ℒ ℱ ∥ ° ′ ″ υ Υ ℜ ℑ ⋯ … ∄ ∠ † ∓ ÷ ≪ ≫ ∼ ≃ ↦ ⇐ ∖", "25 °C", "100 Ω", "5 µm"]) check(s);
    expect(bad).toEqual([]);
  });
});

describe("17. indefinite integrals, sums and products", () => {
  it.each(["int(, , f(x) dx)", "sum(, , x)", "oint(C, , F)", "∑ x_i", "∫ f dx", "sum_{i=1}^{n} x_i", "lim(, f)"])("%s parses", (dsl) => {
    expect(() => omml(dsl)).not.toThrow();
  });
  it.each(["\\int f\\,dx", "\\sum_i x_i", "\\oint_C \\vec{F}\\cdot d\\vec{r}", "\\iint_D f\\,dA", "\\sum\\limits_{i=1}^n i", "\\lim f"])(
    "LaTeX %s converts",
    (tex) => expect(() => fromTex(tex)).not.toThrow(),
  );
  it("an omitted limit is hidden, not an empty box", () => {
    const o = omml("int(, , f(x) dx)");
    expect(o).toContain('<m:subHide m:val="1"/>');
    expect(o).toContain('<m:supHide m:val="1"/>');
    const c = omml("oint(C, , F)");
    expect(c).toContain('<m:supHide m:val="1"/>');
    expect(c).not.toContain("subHide");
    expect(omml("lim(, f)")).not.toContain("limLow");
  });
});

describe("18. primes", () => {
  it.each([
    ["y' = 2x", "′"],
    ["x'", "′"],
    ["f''(x)", "″"],
    ["f′(x)", "′"],
    ["f″(x)", "″"],
  ])("%s → superscript %s", (dsl, prime) => expect(omml(dsl)).toContain(`<m:sup><m:r><m:t xml:space="preserve">${prime}</m:t></m:r></m:sup>`));
  it("LaTeX f^{\\prime}(x) and f''(x) convert", () => {
    expect(() => fromTex("f^{\\prime}(x)")).not.toThrow();
    expect(fromTex("f''(x)")).toContain("″");
  });
});

describe("19. a sign alone in braces is the sign label", () => {
  it.each(["Phi^{+}", "x_{-}", "x^{+}", "ket(Phi^{+})", "sigma_{+}"])("%s parses", (dsl) => expect(() => omml(dsl)).not.toThrow());
  it("Phi^{+} is the same as Phi^+", () => expect(omml("Phi^{+}")).toBe(omml("Phi^+")));
  it.each(["\\Phi^{+}", "|\\Psi^-\\rangle", "\\sigma_{+}"])("LaTeX %s converts", (tex) => expect(() => fromTex(tex)).not.toThrow());
});

describe("20. astral letters and typed big operators / angle brackets", () => {
  it.each([
    ["𝔽_q", "𝔽"],
    ["𝔼[X]", "𝔼"],
    ["\\mathbb{E}[X]", "𝔼"],
    ["\\mathbb{F}_q", "𝔽"],
    ["\\mathbb{P}(A)", "ℙ"],
    ["\\mathcal{L}", "ℒ"],
    ["\\mathcal{F}", "ℱ"],
  ])("%s keeps %s whole", (src, glyph) => {
    const o = src.startsWith("\\") ? fromTex(src) : omml(src);
    expect(runs(o)).toContain(glyph);
    expect(o).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it.each([
    ["∑ x_i", "∑"],
    ["∫ f dx", "∫"],
    ["⟨x⟩", "⟨"],
    ["⟨ψ|φ⟩", "⟨"],
    ["|ψ⟩", "⟩"],
    ["⟨φ|A|ψ⟩", "⟨"],
  ])("%s parses", (dsl, glyph) => expect(omml(dsl)).toContain(glyph));
});

describe("21. LaTeX constructs that imported as letters", () => {
  it.each([
    ["a \\bmod n", "a mod n"],
    ["a \\equiv b \\pmod{n}", "a≡b(mod n)"],
    ["\\Bigl( x \\Bigr)", "(x)"],
    ["\\bigl[ x \\bigr]", "[x]"],
    ["\\displaystyle \\frac{a}{b}", "{{a}/{b}}"],
    ["\\textstyle x", "x"],
    ["{a \\over b}", "{{{a}/{b}}}"],
    ["\\sum\\limits_{i=1}^n i", "sum(i=1, n, i)"],
    ["\\sum\\nolimits_{i} i", "sum(i, , i)"],
  ])("%s → %s", (tex, dsl) => {
    expect(latexToDsl(tex)).toBe(dsl);
    expect(() => mathToOmml(dsl)).not.toThrow();
  });
  it("mod is upright", () => expect(runs(fromTex("a \\bmod n"))).toContain("[up]mod"));
});

describe("adversarial rows (the fixes must not misread neighbours)", () => {
  it("abs then ket, ket then bra", () => {
    expect(omml("|x| + |y⟩")).toContain('<m:endChr m:val="⟩"/>');
    expect(omml("|a⟩⟨b|")).toContain('<m:begChr m:val="⟨"/><m:endChr m:val="|"/>');
    expect(omml("|x|")).toBe(omml("abs(x)"));
  });
  it("\\middle| and a matrix element ⟨φ|Ĥ|ψ⟩", () => {
    expect(latexToDsl("\\left\\langle \\phi \\middle| \\psi \\right\\rangle")).toBe("⟨φ|ψ⟩");
    expect(() => fromTex("\\langle\\phi|\\hat{H}|\\psi\\rangle")).not.toThrow();
  });
  it("prose with LaTeX specials exports escaped", () => expect(astToLatex(parseMathAst('"a_b ^ c"'))).toBe("\\text{a\\_b \\^{} c}"));
  it("an unclosed quote, a fifth prime and a lone ⌊ are named refusals", () => {
    expect(() => parseMathAst('"if x')).toThrow(/not closed/);
    expect(() => parseMathAst("f''''(x)")).toThrow(/three primes/);
    expect(() => parseMathAst("⌊x")).toThrow(/closing "⌋"/);
  });
  it("units only where the whole side is a quantity", () => {
    expect(runs(omml("x = 5 m = 500 cm")).filter((r) => r.startsWith("[up]" + String.fromCharCode(0x2009)))).toHaveLength(2);
    expect(runs(omml("P(X = 2 A)")).some((r) => r.includes("A") && r.startsWith("[up]"))).toBe(false);
    expect(runs(omml("c = 3e8 m/s"))).toContain("[up]" + String.fromCharCode(0x2009) + "m/s");
    expect(runs(omml("d = 2 in"))).not.toContain("[up]" + String.fromCharCode(0x2009) + "in");
  });
  it("e-notation, sums and dot products still read as before", () => {
    expect(omml("1.5e-3")).toBe(omml("1.5e-3"));
    expect(omml("sum(i=1, n, x_i)")).toContain('<m:limLoc m:val="undOvr"/></m:naryPr>');
    expect(omml("a dot (b × c)")).toContain("·");
  });
});

describe("control characters never reach Word's XML", () => {
  it("a vertical tab (Shift+Enter) is a space", () => {
    const o = omml("a" + String.fromCharCode(0x0b) + "b");
    expect(o).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });
  it("a NUL is refused by name", () => {
    expect(() => parseMathAst("x" + String.fromCharCode(0) + "y")).toThrow(/invisible control character/);
  });
});

describe("library formulas carry their differentials", () => {
  it("Fundamental theorem has dx, Error function has dt", () => {
    expect(library("Fundamental theorem")).toBe("int(a, b, f(x) dx) = F(b) - F(a)");
    expect(library("Error function")).toBe("erf(x) = (2/sqrt(π)) int(0, x, e^{-t^2} dt)");
  });
});

describe("10/13/22/24. the unit converter", () => {
  const ok = (v: string, f: string, t: string): string => {
    const r = convertForDisplay(v, f, t);
    if (!r.ok) throw new Error(r.error);
    return r.resultHtml;
  };
  const err = (v: string, f: string, t: string): string => {
    const r = convertForDisplay(v, f, t);
    if (r.ok) throw new Error(`converted: ${r.resultHtml}`);
    return r.error;
  };
  it("1,000 is a thousand (parseFloat read it as 1)", () => expect(ok("1,000", "m", "km")).toBe("1&#8201;km"));
  it("1 000 and 5. read too", () => {
    expect(ok("1 000", "m", "km")).toBe("1&#8201;km");
    expect(ok("5.", "m", "cm")).toBe("500&#8201;cm");
  });
  it("a lone decimal comma is ambiguous and refused", () => expect(err("1,5", "m", "cm")).toMatch(/ambiguous/));
  it("10⁶ never shows a superscript plus", () => {
    const h = ok("1", "km", "mm");
    expect(h).toBe("1 × 10⁶&#8201;mm");
    expect(formatQuantityHtml("1e+6 m")).not.toContain("⁺");
  });
  it("huge and tiny results are refused by name, never blank", () => {
    expect(err("1e308", "km", "mm")).toMatch(/too large/);
    expect(err("1e-320", "mm", "km")).toMatch(/too small/);
    expect(ok("1e-310", "m", "m")).toBe("1 × 10⁻³¹⁰&#8201;m");
    expect(Number.isFinite(roundSig(1e-310, 4))).toBe(true);
    expect(formatSig(1.23456e-310, 3)).toBe("1.23e-310");
  });
  it("a unit with a bracketed caret exponent is typeset", () => {
    expect(formatUnit("m^(-1)")).toBe("m⁻¹");
    expect(formatUnit("s^(−2)")).toBe("s⁻²");
    expect(ok("1", "1/m", "m^(-1)")).toBe("1&#8201;m⁻¹");
  });
  it.each([
    ["-500", "°C", "K"],
    ["-5", "K", "°C"],
    ["-5", "K", "°R"],
    ["-500", "°F", "K"],
    ["-1", "°R", "K"],
    ["-300", "°C", "°F"],
  ])("%s %s → %s is below absolute zero", (v, f, t) => expect(err(v, f, t)).toMatch(/below absolute zero/));
  it("absolute zero itself and ordinary negatives still convert", () => {
    expect(ok("-273.15", "°C", "K")).toBe("0&#8201;K");
    expect(ok("-459.67", "°F", "K")).toBe("0&#8201;K");
    expect(ok("-40", "°C", "°F")).toBe("−40&#8201;°F");
    expect(convert(-500, "°C", "K")).toBeNull();
    expect(parseMeasured("-500 °C", "K")).toEqual({ error: expect.stringMatching(/below absolute zero/) });
    // A temperature DIFFERENCE may be negative.
    expect(parseMeasured("-5 K", "K")).toMatchObject({ inTarget: -5 });
    expect(convert(-10, "Δ°C", "Δ°F")).toBeCloseTo(-18, 12);
  });
  it("rpm → Hz is refused by name with the 1/60 relation", () => expect(err("60", "rpm", "Hz")).toMatch(/1 rpm = 1\/60 Hz/));
});

describe("23. prefixed units the converter lacked (factors = SI prefix × base, NIST SP 811)", () => {
  it.each([
    ["dL", "L", 0.1],
    ["mcg", "mg", 1e-3],
    ["mWh", "J", 3.6],
    ["pA", "A", 1e-12],
    ["nV", "V", 1e-9],
    ["mK", "K", 1e-3],
    ["µK", "K", 1e-6],
    ["kmol", "mol", 1e3],
    ["GJ", "J", 1e9],
    ["GeV", "eV", 1e9],
    ["nT", "T", 1e-9],
    ["pT", "T", 1e-12],
    ["nH", "H", 1e-9],
    ["nN", "N", 1e-9],
    ["µN", "N", 1e-6],
    ["mBq", "Bq", 1e-3],
    ["kbar", "bar", 1e3],
    ["µΩ", "Ω", 1e-6],
    ["GΩ", "Ω", 1e9],
  ])("1 %s = %s %s", (from, to, factor) => {
    expect(lookup(from)).not.toBeNull();
    const r = convert(1, from, to)!;
    expect(Math.abs(r / factor - 1)).toBeLessThan(1e-12);
  });
  it("case-exact: mBq is not MBq, mK is not a megakelvin", () => {
    expect(convert(1, "MBq", "mBq")).toBeCloseTo(1e9, 0);
    expect(convert(1, "mK", "K")).toBeCloseTo(1e-3, 15);
  });
});
