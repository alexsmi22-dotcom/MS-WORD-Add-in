// Defect 0.31 (roots) and Tier 1.7 (Unicode input) — the display contract for the
// solver: whatever is shown must parse back if the user retypes it, and it must
// use ONE convention for a minus sign.
//
// The reproduction, preserved verbatim: solveEquation("x^3 - 2 = 0") displayed
//   -0.629960525 − 1.091123636i
// an ASCII hyphen on the real part and U+2212 on the imaginary sign, in one
// string. Feeding that back into the product's own parseExpr threw
//   Unexpected character "−".

import { solveEquation, parseExpr, evalAst, normalizeUnicodeMath } from "../solve";
import { formatComplex } from "../linalg";

const MINUS_U2212 = "−";

describe("defect 0.31 — a displayed root re-parses and uses one minus character", () => {
  it('x^3 - 2 = 0: every displayed root feeds back and MEANS THE SAME NUMBER', () => {
    // `not.toThrow()` alone is too weak: `i` is an ordinary free variable to this
    // parser, so almost any identifier would satisfy it. A displayed root is linear
    // in i — re + im·i — so evaluating the re-parsed string at i = 0 and i = 1
    // recovers both parts, and that is what "parses back" has to mean.
    const r = solveEquation("x^3 - 2 = 0");
    expect(r).not.toBeNull();
    const roots = r!.roots.filter((x) => !x.symbolic);
    expect(roots.length).toBe(3);
    for (const root of roots) {
      const ast = parseExpr(root.display);
      const re = evalAst(ast, { i: 0 });
      const im = evalAst(ast, { i: 1 }) - re;
      expect(re).toBeCloseTo(root.re, 8);
      expect(im).toBeCloseTo(root.im, 8);
    }
  });

  it("x^3 - 2 = 0: no root string mixes two different minus characters", () => {
    const r = solveEquation("x^3 - 2 = 0");
    for (const root of r!.roots) {
      const hasAscii = root.display.includes("-");
      const hasUnicode = root.display.includes(MINUS_U2212);
      expect(hasAscii && hasUnicode).toBe(false);
    }
  });

  it("an EXACT root is displayed exactly — no rounding under an exactness flag", () => {
    // Delegating the digits (not just the conventions) to linalg.formatComplex
    // rounded to a significant-figure count: x^2 + 2^94 = 0 displayed
    // 140737488355000i for an imaginary part of 140737488355328, on an object
    // carrying exact: true. A rounded number under an exactness flag is worse than
    // either mistake alone — the flag is what tells the reader not to check.
    const r = solveEquation("x^2 + 2^94 = 0")!;
    for (const root of r.roots) {
      expect(root.exact).toBe(true);
      expect(root.display).toContain(String(Math.abs(root.im)));
    }
    expect(r.roots.map((x) => x.display).sort()).toEqual(
      ["140737488355328i", "-140737488355328i"].sort(),
    );
  });

  it("shares linalg.formatComplex's CONVENTIONS, pinned by test rather than by call", () => {
    // The shape must not drift apart again; the digits are deliberately this file's.
    for (const [re, im] of [[0, 1], [0, -1], [1, 1], [1, -1], [-2, 3]] as [number, number][]) {
      const viaLinalg = formatComplex({ re, im }, 12);
      const root = solveEquation(`x^2 - ${2 * re}*x + ${re * re + im * im} = 0`)!.roots[0];
      expect(typeof root.display).toBe("string");
      // linalg's formatter writes a TRUE minus since v2.193.0 (Analyze output, display contract); Solve's root display
      // keeps its ASCII "-" because it re-parses (below). The shape — sign, digits or i — is what is shared.
      expect(viaLinalg).toMatch(/^−?(\d|i)/);
    }
    expect(formatComplex({ re: 0, im: 1 }, 12)).toBe("i");
    expect(formatComplex({ re: 0, im: -1 }, 12)).toBe("−i");
    expect(formatComplex({ re: 1, im: -2 }, 12)).toBe("1 − 2i");
    expect(solveEquation("x^2 + 1 = 0")!.roots.map((x) => x.display).sort()).toEqual(["-i", "i"]);
  });

  it("keeps exactly the digits it printed before — now EXACT (v2.136.0)", () => {
    // The reproduction printed `-0.629960525 − 1.091123636i`. Precision was never
    // what was wrong with it, and v2.136.0 removed the precision question
    // altogether: the cubic engine prints the pair EXACTLY (binomial x^n = c),
    // `-1/2*cbrt(2) ± sqrt(3)/2*cbrt(2)*i`. Pin rewritten by hand (never -u),
    // against the SymPy 1.14.0 oracle −0.629960524947437 ± 1.09112363597172i.
    const r = solveEquation("x^3 - 2 = 0");
    const pair = r!.roots.filter((x) => Math.abs(x.im) > 1e-9);
    expect(pair.map((x) => x.display).sort()).toEqual([
      "-1/2*cbrt(2) + sqrt(3)/2*cbrt(2)*i",
      "-1/2*cbrt(2) - sqrt(3)/2*cbrt(2)*i",
    ].sort());
    for (const root of pair) {
      expect(root.exact).toBe(true);
      const ast = parseExpr(root.display);
      const re = evalAst(ast, { i: 0 });
      expect(Math.abs(re - -0.629960524947437)).toBeLessThan(1e-12);
      expect(Math.abs(Math.abs(evalAst(ast, { i: 1 }) - re) - 1.09112363597172)).toBeLessThan(1e-12);
    }
  });
});

describe("v2.136.0 — the exact cubic/quartic forms honour the contract", () => {
  // Every printed root re-parses through parseExpr and MEANS its own re/im:
  // the trigonometric form, Cardano's real radicals, nested square roots, the
  // fourth root, and the multiplicity marker (whose value part re-parses; the
  // marker itself is the documented " (×m)" suffix). Values: SymPy 1.14.0.
  const valueOf = (display: string): { re: number; im: number } => {
    const ast = parseExpr(display.replace(/\s*\(×\d+\)$/, ""));
    const re = evalAst(ast, { i: 0 });
    return { re, im: evalAst(ast, { i: 1 }) - re };
  };
  const cases: [string, string, number][] = [
    ["x^3 - 3x + 1 = 0", "2*cos(2*pi/9)", 1.53208888623796],
    ["x^3 - 3x + 1 = 0", "2*cos(8*pi/9)", -1.87938524157182],
    ["x^3 - 2x - 5 = 0", "cbrt(5/2 + sqrt(1929)/18) + cbrt(5/2 - sqrt(1929)/18)", 2.09455148154233],
    ["x^3 + x + 1 = 0", "cbrt(-1/2 + sqrt(93)/18) + cbrt(-1/2 - sqrt(93)/18)", -0.682327803828019],
    ["x^4 + 4x - 1 = 0", "-sqrt(2)/2 + sqrt(sqrt(2) - 1/2)", 0.249038376398374],
    ["x^4 - 2 = 0", "2^(1/4)", 1.18920711500272],
    ["x^3 = 1/2", "cbrt(4)/2", 0.793700525984100],
  ];
  it.each(cases)("%s prints %s, which re-parses to its value", (eq, display, value) => {
    const r = solveEquation(eq)!;
    const root = r.roots.find((x) => x.display === display);
    expect(root).toBeDefined();
    expect(root!.exact).toBe(true);
    const v = valueOf(display);
    expect(Math.abs(v.re - value)).toBeLessThan(1e-12 * Math.max(1, Math.abs(value)));
    expect(Math.abs(v.re - root!.re)).toBeLessThan(1e-9 * Math.max(1, Math.abs(value)));
    expect(display).not.toContain("^(1/3)"); // (neg)^(1/3) is NaN — cbrt is the real cube root
  });
  // Complex roots printed exactly: Cardano's pair as ω·u + ω̄·v (A's review
  // fixes brought it under the 120-character cap) and degree ≥ 5 factored over
  // ℚ into cyclotomic pieces. Values: SymPy 1.14.0 / cos(π/5) = (1 + √5)/4.
  const complexCases: [string, string, number, number][] = [
    ["x^3 - 2x - 5 = 0", "(-1/2 + sqrt(3)/2*i)*cbrt(5/2 + sqrt(1929)/18) + (-1/2 - sqrt(3)/2*i)*cbrt(5/2 - sqrt(1929)/18)", -1.04727574077116, 1.13593988908893],
    ["x^3 + x + 1 = 0", "(-1/2 + sqrt(3)/2*i)*cbrt(-1/2 + sqrt(93)/18) + (-1/2 - sqrt(3)/2*i)*cbrt(-1/2 - sqrt(93)/18)", 0.34116390191401, 1.16154139999725],
    ["x^6 + 1 = 0", "sqrt(3)/2 + 1/2*i", 0.866025403784439, 0.5],
    ["x^8 - 1 = 0", "-sqrt(2)/2 + sqrt(2)/2*i", -0.707106781186548, 0.707106781186548],
    ["x^10 - 1 = 0", "1/4 + sqrt(5)/4 + sqrt(5/8 - sqrt(5)/8)*i", 0.809016994374947, 0.587785252292473],
  ];
  it.each(complexCases)("%s prints %s exactly, and it re-parses to its value", (eq, display, re, im) => {
    const r = solveEquation(eq)!;
    expect(r.method.startsWith("exact")).toBe(true);
    const root = r.roots.find((x) => x.display === display);
    expect(root).toBeDefined();
    expect(root!.exact).toBe(true);
    const v = valueOf(display);
    expect(Math.abs(v.re - re)).toBeLessThan(1e-12);
    expect(Math.abs(v.im - im)).toBeLessThan(1e-12);
  });
  it("x^6 + 1, x^8 − 1, x^10 − 1: every root exact, count = degree", () => {
    for (const [eq, n] of [["x^6 + 1 = 0", 6], ["x^8 - 1 = 0", 8], ["x^10 - 1 = 0", 10]] as [string, number][]) {
      const r = solveEquation(eq)!;
      expect(r.roots.length).toBe(n);
      expect(r.roots.every((x) => x.exact)).toBe(true);
    }
  });
  it("(x - 1)^4 = 0 prints 1 (×4) — one root, no complex shrapnel", () => {
    const r = solveEquation("(x-1)^4 = 0")!;
    expect(r.roots.map((x) => x.display)).toEqual(["1 (×4)"]);
    expect(valueOf(r.roots[0].display)).toEqual({ re: 1, im: 0 });
  });
  it("every root of every case above re-parses to its own re/im, and uses one minus glyph", () => {
    for (const eq of [...new Set(cases.map((c) => c[0]))].concat(["x^4 + 1 = 0", "x^3 - 2 = 0", "x^6 - 9x^3 + 8 = 0", "x^6 + 1 = 0", "x^8 - 1 = 0", "x^10 - 1 = 0"])) {
      for (const root of solveEquation(eq)!.roots) {
        const v = valueOf(root.display);
        expect(Math.abs(v.re - root.re)).toBeLessThan(1e-9 * Math.max(1, Math.abs(root.re)));
        expect(Math.abs(v.im - root.im)).toBeLessThan(1e-9 * Math.max(1, Math.abs(root.im)));
        expect(root.display.includes(MINUS_U2212)).toBe(false);
      }
    }
  });
});

describe("defect 0.31 — one complex convention, shared with linalg.formatComplex", () => {
  it("x^2 + 1 = 0 displays i and -i, not 0 + 1i", () => {
    const r = solveEquation("x^2 + 1 = 0");
    const shown = r!.roots.map((x) => x.display).sort();
    expect(shown).toEqual(["-i", "i"]);
    expect(shown.join(" ")).not.toContain("1i");
    expect(shown.join(" ")).not.toContain("0 +");
  });

  it("a unit imaginary part with a real part drops the redundant 1", () => {
    // x^2 - 2x + 2 = 0 has roots 1 ± i.
    const r = solveEquation("x^2 - 2*x + 2 = 0");
    const shown = r!.roots.map((x) => x.display).sort();
    expect(shown).toEqual(["1 + i", "1 - i"].sort());
    for (const root of r!.roots) {
      const ast = parseExpr(root.display);
      const re = evalAst(ast, { i: 0 });
      expect(re).toBeCloseTo(root.re, 8);
      expect(evalAst(ast, { i: 1 }) - re).toBeCloseTo(root.im, 8);
    }
  });
});

describe("Tier 1.7 — Unicode operators and constants are accepted", () => {
  const val = (s: string, vars: Record<string, number> = {}): number => evalAst(parseExpr(s), vars);

  it("accepts π and 2π", () => {
    expect(val("π")).toBeCloseTo(Math.PI, 12);
    expect(val("2π")).toBeCloseTo(2 * Math.PI, 12);
    expect(val("π r^2", { r: 2 })).toBeCloseTo(4 * Math.PI, 12);
  });

  it("accepts √4, √x and √(x + 1)", () => {
    expect(val("√4")).toBe(2);
    expect(val("√x", { x: 9 })).toBe(3);
    expect(val("√(x + 1)", { x: 8 })).toBe(3);
  });

  it("√ scopes ONE radicand, including a function call and a nested radical", () => {
    // A regex that grabbed the following identifier made √sin(x) into sqrt(sin)(x),
    // and the error it produced ("sin is a function, so it needs brackets") named a
    // problem the user did not have. √√4 became the unknown function "sqrtsqrt".
    expect(val("√sin(x)", { x: Math.PI / 2 })).toBe(1);
    expect(val("√cos(x)", { x: 0 })).toBe(1);
    expect(val("√√16")).toBe(2);
    expect(val("√√(16)")).toBe(2);
    // ONE atom, like an exponent: √2x is sqrt(2)·x, not sqrt(2x).
    expect(val("√4x", { x: 3 })).toBe(6);
    expect(val("√x_1", { x_1: 25 })).toBe(5);
    expect(val("√ pi")).toBeCloseTo(Math.sqrt(Math.PI), 12);
  });

  it("a pasted wall of radicals neither overflows the stack nor freezes the pane", () => {
    // Two separate failures, both introduced by the √ scanner and both invisible to
    // every scoping test above. One recursion per √ threw RangeError at about 6,000
    // of them in Node — an unhandled crash, not a parse error, and a Word WebView
    // stack is smaller. And the per-radical work was quadratic: 200,000 characters
    // of "√(" took 13 s SYNCHRONOUSLY, before the parser ever ran. 200,000
    // characters is one paste.
    expect(() => normalizeUnicodeMath("√".repeat(20000) + "4")).not.toThrow();
    const t0 = Date.now();
    normalizeUnicodeMath("√(".repeat(100000));
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a √ with nothing usable after it is refused BY NAME", () => {
    expect(() => parseExpr("√")).toThrow(/needs brackets/);
    expect(() => parseExpr("√ + 1")).toThrow(/needs brackets/);
  });

  it("a subscript binds on either side of π", () => {
    // "π₁" folds to "π_1" before the padding runs, and blanket padding made it
    // " pi _1" — π times an invented variable "_1". In solveEquation that "_1"
    // could then be picked as the unknown, solving an equation nobody wrote.
    expect(evalAst(parseExpr("π₁"), { pi_1: 7 })).toBe(7);
    expect(normalizeUnicodeMath("π₁").trim()).toBe("pi_1");
    // Unsubscripted π is still a separate factor, not glued to its neighbour.
    expect(evalAst(parseExpr("2π"), {})).toBeCloseTo(2 * Math.PI, 12);
  });

  it("a subscripted π stays part of the NAME, not a factor", () => {
    // Unconditional space-padding made x_π into "x_ pi", which parses silently as a
    // variable called x_ times pi — a made-up name with no error.
    expect(val("x_π + 1", { x_pi: 4 })).toBe(5);
    expect(() => parseExpr("x_π")).not.toThrow();
    expect(normalizeUnicodeMath("x_π")).toBe("x_pi ");
  });

  it("accepts × ÷ · as multiplication and division", () => {
    expect(val("2 × 3")).toBe(6);
    expect(val("2 ÷ 3")).toBeCloseTo(2 / 3, 12);
    expect(val("2 · 3")).toBe(6);
  });

  it("accepts U+2212 and en/em dashes as a minus sign", () => {
    expect(val("5 − 3")).toBe(2);
    expect(val("5 – 3")).toBe(2);
    expect(val("5 — 3")).toBe(2);
    expect(val("−3")).toBe(-3);
  });

  it("a Unicode fold cannot carry an expression AROUND the ambiguity refusal", () => {
    // KNOWN-DEFECTS B11 is a DELIBERATE refusal: 1/2x has no settled reading, so it
    // is refused rather than guessed at. The fold used to run inside the Parser,
    // i.e. after the gate — so `1/2pi` was refused while `1/2π` quietly returned
    // 1.5707963267948966, having picked the (1/2)·π reading the refusal exists to
    // say is not settled. π is precisely what Word's Symbol dialog inserts, so the
    // notation that defeated the gate was the one the gate was written for.
    for (const s of ["1/2π", "x/2π", "1/2 pi", "1/2pi", "1/2x"]) {
      expect(() => parseExpr(s)).toThrow(/ambiguous/);
    }
    // Unambiguous π expressions are untouched.
    expect(evalAst(parseExpr("2π"), {})).toBeCloseTo(2 * Math.PI, 12);
    expect(evalAst(parseExpr("(1/2)π"), {})).toBeCloseTo(Math.PI / 2, 12);
    expect(evalAst(parseExpr("1/(2π)"), {})).toBeCloseTo(1 / (2 * Math.PI), 12);
  });

  it("∞ is refused BY NAME rather than as an unexpected character", () => {
    // The deliberate refusal at solve.ts:217 stays intact — this only improves the
    // message a student sees; ∞ is NOT given a value.
    expect(() => parseExpr("∞")).toThrow(/is not a value this can solve for/);
    expect(() => parseExpr("∞")).not.toThrow(/Unexpected character/);
  });

  it("does not regress the super/subscript forms already supported", () => {
    expect(val("x²", { x: 3 })).toBe(9);
    expect(val("x⁴", { x: 2 })).toBe(16);
    expect(val("x⁻¹", { x: 4 })).toBe(0.25);
    expect(normalizeUnicodeMath("x²")).toBe("x^(2)");
    expect(val("x_1 + 1", { x_1: 5 })).toBe(6);
    expect(val("x₁ + 1", { x_1: 5 })).toBe(6);
  });
});
