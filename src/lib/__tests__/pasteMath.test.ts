// Paste-from-anywhere: foldPastedMath must turn what real sources put on the
// clipboard into input the Solve engines accept — and say what it did.

import { foldPastedMath, looksLikeLatex } from "../pasteMath";
import { solveEquation, parseExpr, evalAst } from "../solve";
import { solveInequality } from "../inequalities";

/** Fold then solve — the whole journey a paste takes. */
function foldSolve(input: string, variable?: string) {
  const folded = foldPastedMath(input);
  return { folded, result: solveEquation(folded.text, variable) };
}

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
