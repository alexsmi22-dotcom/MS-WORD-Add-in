// Paste-from-anywhere: foldPastedMath must turn what real sources put on the
// clipboard into input the Solve engines accept — and say what it did.

import { foldPastedMath, looksLikeLatex, extractSingleEquation, extractExpression } from "../pasteMath";
import { solveEquation, parseExpr, evalAst, differentiate } from "../solve";
import { solveInequality } from "../inequalities";

/** Fold then solve — the whole journey a paste takes. */
function foldSolve(input: string, variable?: string) {
  const folded = foldPastedMath(input);
  return { folded, result: solveEquation(folded.text, variable) };
}

describe("degraded superscripts from web copy (3x2 → 3x², user workflow)", () => {
  test("the GeeksforGeeks practice questions paste whole and answer correctly", () => {
    // Q1: coefficient shape. Q2: coefficient-less 1/x2 (bare-letter rule).
    const q1 = foldPastedMath("Find the derivative of the function f(x) = 3x2 + 4x - 2.", { stackedFractions: true });
    expect(q1.text).toContain("3x^2 + 4x - 2");
    expect(q1.notes.join(" ")).toMatch(/superscript/);
    expect(differentiate(extractSingleEquation(q1.text)!)!.derivative).toBe("6*x + 4");
    const q2 = foldPastedMath("Find the derivative of g(x) = 1/x2.", { stackedFractions: true });
    expect(differentiate(extractSingleEquation(q2.text)!)!.derivative).toBe("-2/x^3");
    const q3 = foldPastedMath("Find the derivative of f(x) = 5x3 - 2x2 + 7x - 9.", { stackedFractions: true });
    expect(differentiate(extractSingleEquation(q3.text)!)!.derivative).toBe("15*x^2 - 4*x + 7");
  });

  test("a SYSTEM's x1/x2 variables are never rewritten, across lines included", () => {
    // \s* in the repair regex crossed the newline and welded "= 3⏎x1" into
    // "3x^1", destroying both equations — caught before ship, pinned forever.
    const sys = foldPastedMath("x1 + x2 = 3\nx1 - x2 = 1", { stackedFractions: true });
    expect(sys.text).toBe("x1 + x2 = 3\nx1 - x2 = 1");
    expect(sys.notes.join(" ")).not.toMatch(/superscript/);
  });

  test("under an LP the decision variables x1, x2 are NOT powers and the objective line survives (v2.132.0)", () => {
    // SCOPE-LP-SPLINES §E.2/E.3: "maximize 3x1 + 2x2 + 5x3 …" was rewritten
    // to 3x^1 + 2x^2 + 5x^3 (x1 and x^1 then coexisted), and the one-per-line
    // shape lost its objective — "max 3x + 2y" has no comparator, so the
    // prose extraction dropped it as prose.
    const lp = "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1, x2, x3 >= 0";
    const folded = foldPastedMath(lp, { stackedFractions: true, extractFromProse: true, lp: true });
    expect(folded.text).toBe(lp);
    expect(folded.notes.join(" ")).not.toMatch(/superscript/);
    const lines = foldPastedMath("max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0", { stackedFractions: true, extractFromProse: true, lp: true });
    expect(lines.text).toBe("max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0");
    expect(lines.notes.join(" ")).not.toMatch(/prose line/);
    // Without the flag the same text IS rewritten — the flag, not luck, protects it.
    const without = foldPastedMath(lp, { stackedFractions: true, extractFromProse: true });
    expect(without.text).not.toBe(lp);
  });

  test("prose without an equals extracts the trailing expression only", () => {
    const t = foldPastedMath("the derivative of 5x3 - 2x2 + 7x - 9", { stackedFractions: true }).text;
    expect(extractExpression(t)).toBe("5x^3 - 2x^2 + 7x - 9");
    // Prose words never leak into the expression as fake variables.
    expect(extractExpression("only words here")).toBeNull();
  });
});

describe("equation extraction from a pasted sentence (user-reported)", () => {
  test("prose before the equation is dug out, not the user's deletion job", () => {
    const paste = "A function f is defined by f(x) = 3x² + 4x - 2. For what values of x does f(x) = 0?";
    const folded = foldPastedMath(paste, { extractFromProse: true }).text;
    const ex = extractSingleEquation(folded);
    expect(ex).toBe("f(x) = 3x² + 4x - 2");
    const r = solveEquation(ex!);
    expect(r!.method).toBe("exact (symbolic rearrangement)");
    expect(r!.roots).toHaveLength(2);
  });

  test("a DEFINITION with no closed-form solve still extracts (the |x+4| case)", () => {
    const ex = extractSingleEquation("A function f is defined by f(x) = |x + 4|.");
    expect(ex).toBe("f(x) = |x + 4|");
  });

  test("pure prose with no equation extracts nothing", () => {
    expect(extractSingleEquation("For what values of x is the graph not differentiable?")).toBeNull();
  });
});

describe("trailing sentence punctuation (user-reported: 'f(x)=|x+ 4|.' answered NOTHING)", () => {
  test("a full stop pasted from a problem statement is stripped, with a note", () => {
    const f = foldPastedMath("f(x)=|x+ 4|.");
    expect(f.text).toBe("f(x)=|x+ 4|");
    expect(f.notes.join(" ")).toMatch(/punctuation/);
    // …and the whole pipeline answers now.
    expect(solveEquation(f.text)).not.toBeNull();
    expect(solveEquation(foldPastedMath("x^2 = 4.").text)!.roots.map((r) => r.display)).toEqual(["2", "-2"]);
  });

  test("decimals and interior punctuation are untouched", () => {
    expect(foldPastedMath("x = 4.5").text).toBe("x = 4.5");
    expect(foldPastedMath("f(2.5, 3.5)").text).toBe("f(2.5, 3.5)");
    // Only the END is stripped — a lone period input degrades to empty-safe.
    expect(foldPastedMath("x = 4.5;").text).toBe("x = 4.5");
  });
});

describe("math-italic letters (what a rendered equation copies as)", () => {
  test("𝑥² − 5𝑥 + 6 = 0 solves to 3 and 2", () => {
    // U+1D465 MATHEMATICAL ITALIC SMALL X, U+2212 minus — a Word-equation paste.
    const { folded, result } = foldSolve("\u{1D465}² − 5\u{1D465} + 6 = 0");
    expect(folded.notes.some((n) => n.includes("styled letter"))).toBe(true);
    expect(result).not.toBeNull();
    const roots = result!.roots.map((r) => r.display).sort();
    expect(roots).toEqual(["2", "3"]);
  });

  test("every style folds: bold, script, fraktur, double-struck, sans, mono digits", () => {
    // 𝐀 (bold A), 𝒷 (script b), 𝔠 (fraktur c), 𝕕 (double-struck d), 𝟑 (bold digit 3)
    const folded = foldPastedMath("\u{1D400} + \u{1D4B7} + \u{1D520} + \u{1D555} + \u{1D7D1}");
    expect(folded.text.replace(/\s+/g, " ").trim()).toBe("A + b + c + d + 3");
  });

  test("letterlike holes: ℎ and ℯ fold; ℏ folds with its warning", () => {
    expect(foldPastedMath("E = ℎ f").text).toContain("h f");
    const hbar = foldPastedMath("E = ℏ ω");
    expect(hbar.text).toContain("h");
    expect(hbar.notes.some((n) => n.includes("ℏ"))).toBe(true);
  });
});

describe("Greek variables solve symbolically", () => {
  test("A = θ r² solves for θ", () => {
    const { folded, result } = foldSolve("A = θ r²", "theta");
    expect(folded.notes.some((n) => n.includes("θ → theta"))).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.roots[0].display).toBe("A/r^2");
  });

  test("v = f λ offers λ as a solvable symbol", () => {
    const { result } = foldSolve("v = f λ");
    expect(result).not.toBeNull();
    expect(result!.unknowns).toContain("lambda");
  });

  test("Greek never glues onto neighbours: 2θ and rθ stay products", () => {
    const t = foldPastedMath("2θ + rθ").text;
    expect(evalAst(parseExpr(t), { theta: 3, r: 2 })).toBe(12);
  });

  test("math-italic Greek (𝜃, U+1D703) folds through both layers", () => {
    const { result } = foldSolve("A = \u{1D703} r", "theta");
    expect(result).not.toBeNull();
  });
});

describe("LaTeX pastes", () => {
  test("looksLikeLatex detects commands, not ordinary input", () => {
    expect(looksLikeLatex("\\frac{a}{b}")).toBe(true);
    expect(looksLikeLatex("x^2 - 5x + 6 = 0")).toBe(false);
    expect(looksLikeLatex("rectangle 10 x 5")).toBe(false);
  });

  test("\\frac{1}{x} + \\frac{1}{x+1} = 1 solves", () => {
    const { folded, result } = foldSolve("\\frac{1}{x} + \\frac{1}{x+1} = 1");
    expect(folded.notes).toContain("Read as LaTeX.");
    expect(result).not.toBeNull();
  });

  test("x^{2} - 5x + 6 = 0 via LaTeX braces solves to 3 and 2", () => {
    const { result } = foldSolve("$x^{2} - 5x + 6 = 0$");
    expect(result).not.toBeNull();
    expect(result!.roots.map((r) => r.display).sort()).toEqual(["2", "3"]);
  });

  test("\\sqrt, \\pi and Greek commands come through", () => {
    const folded = foldPastedMath("\\sqrt{x+1} = \\pi \\alpha");
    const r = solveEquation(folded.text, "alpha");
    expect(r).not.toBeNull();
  });

  test("\\le solves as an inequality", () => {
    const folded = foldPastedMath("x^{2} \\le 4");
    expect(solveInequality(folded.text)).not.toBeNull();
  });
});

describe("clipboard punctuation", () => {
  test("fraction slash ⁄ and typographic spaces fold", () => {
    const folded = foldPastedMath("1⁄2 x = 3");
    const r = solveEquation(folded.text, "x");
    expect(r).not.toBeNull();
    expect(r!.roots[0].display).toBe("6");
  });

  test("curly quotes become straight (inch marks survive for geometry)", () => {
    expect(foldPastedMath("10” x 5”").text).toContain('"');
  });
});

describe("what has no single reading is named, never guessed", () => {
  test("± stays put with an explanatory note", () => {
    const folded = foldPastedMath("x = (-b ± √(b²-4ac))/(2a)");
    expect(folded.text).toContain("±");
    expect(folded.notes.some((n) => n.includes("±"))).toBe(true);
  });

  test("number-set symbols and ∂ are named", () => {
    expect(foldPastedMath("x ∈ ℝ").notes.some((n) => n.includes("ℝ"))).toBe(true);
    expect(foldPastedMath("∂f/∂x").notes.some((n) => n.includes("∂"))).toBe(true);
  });

  test("clean input passes through untouched with zero notes", () => {
    const folded = foldPastedMath("x^2 - 5x + 6 = 0");
    expect(folded.text).toBe("x^2 - 5x + 6 = 0");
    expect(folded.notes).toEqual([]);
  });
});

describe("adversarial regressions — silent wrong readings the review caught", () => {
  test("E = mc² via LaTeX keeps m·c a PRODUCT, never the variable 'mc'", () => {
    const { result } = foldSolve("$E = mc^2$", "m");
    expect(result).not.toBeNull();
    expect(result!.roots[0].display).toBe("E/c^2");
    // And the unknown list holds m and c separately, no invented 'mc'.
    const all = foldSolve("$E = mc^2$");
    expect(all.result!.unknowns).toEqual(expect.arrayContaining(["E", "m", "c"]));
    expect(all.result!.unknowns).not.toContain("mc");
  });

  test("\\sin x becomes sin(x), not the product sin·x", () => {
    const folded = foldPastedMath("\\sin x");
    expect(evalAst(parseExpr(folded.text), { x: Math.PI / 2 })).toBeCloseTo(1, 12);
    // Parenthesised arguments keep their own brackets.
    const f2 = foldPastedMath("\\sin(x + 1)");
    expect(evalAst(parseExpr(f2.text), { x: -1 })).toBeCloseTo(0, 12);
  });

  test("v = u + at via LaTeX offers a and t, not 'at'", () => {
    const { result } = foldSolve("$v = u + at$");
    expect(result!.unknowns).toEqual(expect.arrayContaining(["v", "u", "a", "t"]));
  });

  test("precomposed vulgar fractions fold, mixed numbers included", () => {
    // Word autoformat writes ½, not 1⁄2.
    const { result } = foldSolve("½ x = 3", "x");
    expect(result!.roots[0].display).toBe("6");
    // 10½ is ten-and-a-half — folding it to 10·(1/2)=5 was the trap.
    expect(evalAst(parseExpr(foldPastedMath("10 ½").text), {})).toBe(10.5);
    expect(evalAst(parseExpr(foldPastedMath("10 1⁄2").text), {})).toBe(10.5);
  });

  test("bold digamma is NOT misread as Alpha/Beta (Greek run bound)", () => {
    const folded = foldPastedMath("\u{1D7CA} + \u{1D7CB}");
    expect(folded.text).not.toMatch(/Alpha|Beta|Α|Β/);
  });

  test("x_θ keeps its subscript binding (no minted 'x_' variable)", () => {
    const folded = foldPastedMath("x_θ + 1");
    expect(folded.text).toContain("x_theta");
    expect(() => parseExpr(folded.text)).not.toThrow();
  });

  test("adjacent Greek letters stay separate variables", () => {
    const folded = foldPastedMath("θλ");
    expect(evalAst(parseExpr(folded.text), { theta: 2, lambda: 3 })).toBe(6);
  });

  test("geometry inputs don't get the equation-side ″/° advice", () => {
    const geo = foldPastedMath('rectangle 10″ x 5″', { geometry: true });
    expect(geo.notes.every((n) => !n.includes("″"))).toBe(true);
    const eq = foldPastedMath("x″ = 2");
    expect(eq.notes.some((n) => n.includes("″"))).toBe(true);
  });
});

describe("a pasted problem statement keeps its equation, drops the prose", () => {
  const SAT =
    "C=59(F−32)\n\n" +
    "The equation above shows how temperature F, measured in degrees Fahrenheit, " +
    "relates to a temperature C, measured in degrees Celsius. Based on the equation, " +
    "which of the following must be true?\n\n" +
    "A temperature increase of 1 degree Fahrenheit is equivalent to a temperature increase of 59 degree Celsius.\n" +
    "A temperature increase of 1 degree Celsius is equivalent to a temperature increase of 1.8 degrees Fahrenheit.\n" +
    "A temperature increase of 59 degree Fahrenheit is equivalent to a temperature increase of 1 degree Celsius.";

  test("the SAT paste that failed: the equation is found and solves", () => {
    const folded = foldPastedMath(SAT, { extractFromProse: true, stackedFractions: true });
    expect(folded.text).toBe("C=59(F−32)".normalize());
    expect(folded.notes.some((n) => n.includes("Found the equation"))).toBe(true);
    expect(folded.notes.some((n) => n.includes("ignored"))).toBe(true);
    // …and the kept equation actually solves, chips for C and F.
    const r = solveEquation(folded.text);
    expect(r).not.toBeNull();
    expect(r!.unknowns).toEqual(expect.arrayContaining(["C", "F"]));
  });

  test("a genuine system is never filtered (nothing dropped, no note)", () => {
    const folded = foldPastedMath("x + y = 3\nx - y = 1", { extractFromProse: true });
    expect(folded.text).toBe("x + y = 3\nx - y = 1");
    expect(folded.notes).toEqual([]);
  });

  test("prose with no equation at all is left alone for the normal error path", () => {
    const folded = foldPastedMath("no math here\njust words", { extractFromProse: true });
    expect(folded.text).toContain("no math here");
    expect(folded.notes).toEqual([]);
  });

  test("two equations amid prose both survive (a solvable system)", () => {
    const folded = foldPastedMath("Given that\nx + y = 3\nand also\nx - y = 1\nfind x and y.", {
      extractFromProse: true,
    });
    expect(folded.text).toBe("x + y = 3\nx - y = 1");
    expect(folded.notes.some((n) => n.includes("2 equations"))).toBe(true);
  });

  test("single-line input is untouched (no lines to drop)", () => {
    const folded = foldPastedMath("C = (5/9)(F - 32)", { extractFromProse: true });
    expect(folded.notes).toEqual([]);
  });

  test("stacked-fraction option still composes (extraction leaves it alone)", () => {
    const folded = foldPastedMath("3\nx+3\n​\n =8", { extractFromProse: true, stackedFractions: true });
    expect(folded.notes.some((n) => n.includes("stacked fraction"))).toBe(true);
  });

  test("a deliberately-REFUSED equation is kept, never silently deleted", () => {
    // y = 1/2x trips the ambiguity gate on purpose; deleting it and solving
    // the leftover x = 3 would be a confident answer to the wrong problem.
    const folded = foldPastedMath("y = 1/2x\nx = 3\nfind y.", { extractFromProse: true });
    expect(folded.text).toContain("y = 1/2x");
    expect(folded.text).toContain("x = 3");
    expect(folded.text).not.toContain("find y");
  });

  test("textbook framing strips: 'Let y = 2x + 1 / and x = 3' becomes a solvable system", () => {
    const folded = foldPastedMath("Let y = 2x + 1\nand x = 3\nfind y.", { extractFromProse: true });
    expect(folded.text).toBe("y = 2x + 1\nx = 3");
    const eqs = folded.text.split("\n");
    expect(eqs).toHaveLength(2);
  });

  test("prose around a bare < is not certified as an equation", () => {
    const folded = foldPastedMath("x < 3 means x is small\nx + 1 = 4", { extractFromProse: true });
    expect(folded.text).toBe("x + 1 = 4");
  });

  test("a genuine strict inequality amid prose IS kept", () => {
    const folded = foldPastedMath("Solve the following inequality.\nx^2 - 4 > 0", { extractFromProse: true });
    expect(folded.text).toBe("x^2 - 4 > 0");
  });
});

describe("known-limit fixes: bare pairs and the 59 nudge", () => {
  test("two bare lines reassemble WHERE the caller says pairs are safe (pane kinds)", () => {
    const folded = foldPastedMath("3\nx+3", { stackedFractions: true, bareStackedPairs: true });
    expect(folded.text).toBe("(3)/(x+3)");
    expect(folded.notes.some((n) => n.includes("stacked fraction"))).toBe(true);
  });

  test("without the option (the graphing canvas), two lines stay two curves", () => {
    const folded = foldPastedMath("sin(x)\ncos(x)", { stackedFractions: true });
    expect(folded.text).toContain("\n");
  });

  test("the 59 collapse gets a NUDGE, never a rewrite — and only on paste-artifact input", () => {
    // The pasted SAT equation carries a unicode minus (a paste artifact),
    // so the two-digit coefficient earns the heads-up.
    const folded = foldPastedMath("C=59(F−32)\nprose about an increase\nmore prose", {
      extractFromProse: true,
      stackedFractions: true,
    });
    expect(folded.text).toContain("59(F−32)"); // NOT rewritten
    expect(folded.notes.some((n) => n.includes("59") && n.includes("5/9"))).toBe(true);
    // Clean typed input with no other fold notes stays nudge-free: a typed
    // 12(x+1) is almost certainly twelve.
    const clean = foldPastedMath("y = 12(x+1)");
    expect(clean.notes).toEqual([]);
  });
});

describe("ode-kind notes (adversarial regression)", () => {
  test("y′ with a unicode prime gets neither the false no-reading note nor the nudge", () => {
    const folded = foldPastedMath("y′ = 23y", { ode: true });
    expect(folded.notes.every((n) => !n.includes("′"))).toBe(true);
    expect(folded.notes.every((n) => !n.includes("2/3"))).toBe(true);
  });

  test("a lone ± note does not arm the 59 nudge (named characters aren't paste evidence)", () => {
    const folded = foldPastedMath("x = 23(y ± 1)");
    expect(folded.notes.some((n) => n.includes("±"))).toBe(true);
    expect(folded.notes.every((n) => !n.includes("2/3"))).toBe(true);
  });
});

describe("the fold never throws", () => {
  test("garbage, lone surrogates, huge input", () => {
    for (const probe of ["\\frac{", "{{{", "\uD835", "𝕏".repeat(5000), "\\unknowncmd{x}", ""]) {
      expect(() => foldPastedMath(probe)).not.toThrow();
    }
  });
});
