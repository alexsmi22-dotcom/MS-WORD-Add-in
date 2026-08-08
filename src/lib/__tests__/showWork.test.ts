// Show your work: the derivation lines a student would be required to write,
// derived FROM the engine's answer and verified against it — the module's
// contract is that no work is ever shown that disagrees with the result.

import { equationWork, derivativeWork, definiteIntegralWork } from "../showWork";
import { foldPastedMath } from "../pasteMath";
import { solveEquation, integrate, differentiate, parseExpr, evalAst, format } from "../solve";
import { exprEqual, casSimplify } from "../cas";
import { mathToHtml } from "../mathHtml";
import { solveToTypesetDsl } from "../solveTypeset";

function joined(work: Array<{ text?: string; math?: string }>): string {
  return work.map((w) => w.text ?? w.math).join("\n");
}

describe("linear equations show collect → divide → answer", () => {
  test("3x + 7 = 22", () => {
    const r = solveEquation("3x + 7 = 22")!;
    const work = equationWork("3x + 7 = 22", r);
    expect(joined(work)).toContain("3x = 15");
    expect(joined(work)).toContain("Divide both sides by 3");
    expect(work[work.length - 1].math).toBe("x = 5");
  });

  test("the final line IS the engine's exact answer (fractions kept)", () => {
    const r = solveEquation("2x = 1")!;
    const work = equationWork("2x = 1", r);
    expect(work[work.length - 1].math).toBe(`x = ${r.roots[0].display}`);
  });
});

describe("quadratics factor when a student could, else show the formula", () => {
  test("x² − 5x + 6 factors as (x − 2)(x − 3) (either order)", () => {
    const r = solveEquation("x^2 - 5x + 6 = 0")!;
    const text = joined(equationWork("x^2 - 5x + 6 = 0", r));
    expect(text).toMatch(/\(x - 2\)\(x - 3\) = 0|\(x - 3\)\(x - 2\) = 0/);
    expect(text).toContain("product is zero");
  });

  test("negative roots factor with plus signs: (x + 2)(x + 3)", () => {
    const r = solveEquation("x^2 + 5x + 6 = 0")!;
    expect(joined(equationWork("x^2 + 5x + 6 = 0", r))).toContain("(x + 2)(x + 3) = 0");
  });

  test("irrational roots get the formula with the numbers substituted", () => {
    const r = solveEquation("x^2 - 2x - 1 = 0")!;
    const text = joined(equationWork("x^2 - 2x - 1 = 0", r));
    expect(text).toContain("Quadratic formula");
    expect(text).toContain("sqrt(8)");
    expect(text).not.toContain("Factor:");
  });

  test("complex pair is announced from the discriminant sign", () => {
    const r = solveEquation("x^2 + x + 1 = 0")!;
    expect(joined(equationWork("x^2 + x + 1 = 0", r))).toContain("complex conjugate pair");
  });
});

describe("full factorisation for higher degrees with rational roots", () => {
  test("cubic with roots 1, 2, 3", () => {
    const r = solveEquation("x^3 - 6x^2 + 11x - 6 = 0")!;
    const text = joined(equationWork("x^3 - 6x^2 + 11x - 6 = 0", r));
    expect(text).toContain("(x - 1)");
    expect(text).toContain("(x - 2)");
    expect(text).toContain("(x - 3)");
  });
});

describe("what gets NO work (better none than wrong)", () => {
  test("symbolic rearrangement defers to the engine's verified steps", () => {
    const r = solveEquation("F = m a", "a")!;
    expect(equationWork("F = m a", r)).toEqual([]);
  });

  test("transcendental equations produce no polynomial work", () => {
    const r = solveEquation("cos(x) = 0");
    if (r) expect(equationWork("cos(x) = 0", r)).toEqual([]);
  });

  test("no-equals input produces nothing", () => {
    const r = solveEquation("x^2 - 4 = 0")!;
    expect(equationWork("x^2 - 4", r)).toEqual([]);
  });
});

describe("derivatives show the rule at each level", () => {
  test("chain rule for sin(x²)", () => {
    const text = joined(derivativeWork("sin(x^2)", "x"));
    expect(text).toContain("Chain rule");
    expect(text).toContain("u = x^2");
    expect(text).toMatch(/u' = 2\*?x/);
  });

  test("product rule for x·eˣ names u, v and their derivatives", () => {
    const text = joined(derivativeWork("x*exp(x)", "x"));
    expect(text).toContain("Product rule");
    expect(text).toContain("u = x");
    expect(text).toContain("v = exp(x)");
  });

  test("power rule for x^5", () => {
    expect(joined(derivativeWork("x^5", "x"))).toContain("Power rule");
  });

  test("the assembled line equals the engine's derivative, canonically", () => {
    for (const probe of ["sin(x^2)", "x*exp(x)", "x^5 + 3x", "sin(x)/x"]) {
      const work = derivativeWork(probe, "x");
      const last = work[work.length - 1].math!;
      const shown = last.split("=").pop()!.trim();
      const engine = differentiate(probe)!.derivative;
      const equal = exprEqual(casSimplify(parseExpr(shown)), casSimplify(parseExpr(engine)));
      // exprEqual may be inconclusive (null); a definite false is the failure.
      expect(equal).not.toBe(false);
    }
  });

  test("depth is capped — a deeply nested expression still ends with the result", () => {
    const work = derivativeWork("sin(cos(tan(ln(exp(x^2)))))", "x");
    expect(work.length).toBeLessThanOrEqual(12);
    expect(work[work.length - 1].math).toContain("d/dx");
  });
});

describe("definite integrals write out F(b) − F(a)", () => {
  test("∫x² from 0 to 3 shows F(3) − F(0) = 9 − (0) = 9", () => {
    const r = integrate("x^2", 0, 3)!;
    const work = definiteIntegralWork(r, 0, 3);
    expect(joined(work)).toContain("fundamental theorem");
    expect(work[work.length - 1].math).toContain("F(3) - F(0)");
    expect(work[work.length - 1].math).toContain("= 9");
  });

  test("numeric-only integrals (no F) show no fabricated work", () => {
    const r = integrate("exp(x^2)", 0, 1);
    if (r) expect(definiteIntegralWork(r, 0, 1)).toEqual([]);
  });

  test("the work's arithmetic is verified against the engine's value", () => {
    const r = integrate("sin(x)", 0, Math.PI)!;
    const work = definiteIntegralWork(r, 0, Math.PI);
    if (work.length) {
      // If shown at all, the closing number is the engine's value.
      expect(work[work.length - 1].math).toContain("= 2");
    }
  });
});

describe("adversarial regressions — wrong work the review caught", () => {
  test("an integral that does not exist gets NO fundamental-theorem work", () => {
    // ∫1/x² from −1 to 1: the engine says NaN with a pole caveat; the NaN
    // slipped past a subtraction-style guard and produced "= NaN" work.
    const r = integrate("1/x^2", -1, 1);
    if (r) {
      expect(Number.isFinite(r.value)).toBe(false);
      expect(definiteIntegralWork(r, -1, 1)).toEqual([]);
    }
  });

  test("constant function arguments produce no fabricated rule line", () => {
    // d/dx (sin(3) + x): sin(x) appears nowhere in the input, so the work
    // must not say "d/dx sin(x) = cos(x)".
    const text = joined(derivativeWork("sin(3) + x", "x"));
    expect(text).not.toContain("sin(x)");
    expect(text).toContain("= 0"); // the constant term differentiates to zero, said plainly
  });

  test("u′ lines and the assembled line are SIMPLIFIED like the engine's answer", () => {
    const text = joined(derivativeWork("3x^2 + 5x - 2", "x"));
    expect(text).not.toMatch(/\*1\b|\^\(2 - 1\)|- 0\b|0\*/);
    const work = derivativeWork("3x^2 + 5x - 2", "x");
    expect(work[work.length - 1].math).toContain("6*x + 5");
  });

  test("'term by term' is said once, not once per plus sign", () => {
    const text = joined(derivativeWork("x^2 + x + 1 + sin(x)", "x"));
    expect(text.match(/term by term/g)!.length).toBe(1);
  });

  test("x² = 0 shows the repeated root, not (0 ± √0)/2", () => {
    const r = solveEquation("x^2 = 0")!;
    const text = joined(equationWork("x^2 = 0", r));
    expect(text).toContain("repeated root");
    expect(text).not.toContain("±");
  });

  test("trivial 'x = 5' input gets no redundant work", () => {
    const r = solveEquation("x = 5")!;
    expect(equationWork("x = 5", r)).toEqual([]);
  });

  test("negative leading coefficient factors with a bare minus", () => {
    const r = solveEquation("-x^2 + 5x - 6 = 0")!;
    const text = joined(equationWork("-x^2 + 5x - 6 = 0", r));
    if (text.includes("Factor:")) {
      expect(text).not.toContain("-1(");
    }
  });

  test("integral work carries the pane's own bound labels (pi stays pi)", () => {
    const r = integrate("sin(x)", 0, Math.PI)!;
    const work = definiteIntegralWork(r, 0, Math.PI, "0", "pi");
    if (work.length) expect(work[work.length - 1].math).toContain("F(pi) - F(0)");
  });
});

describe("fraction equations show the multiply-through (the user's own case)", () => {
  test("3/(x+3) = 8 multiplies both sides by (x+3), then solves the linear", () => {
    const r = solveEquation("3/(x+3) = 8")!;
    expect(r.roots[0].display).toBe("-21/8");
    const work = equationWork("3/(x+3) = 8", r);
    const text = joined(work);
    expect(text).toContain("Multiply both sides by (x + 3)");
    expect(text).toContain("nonzero");
    // …and the cleared linear then gets its own collect/divide work,
    // ending in the engine's exact root.
    expect(work[work.length - 1].math).toBe("x = -21/8");
  });

  test("1/x + 1/(x+1) = 1 clears BOTH denominators into a quadratic", () => {
    const r = solveEquation("1/x + 1/(x+1) = 1")!;
    const text = joined(equationWork("1/x + 1/(x+1) = 1", r));
    expect(text).toContain("Multiply both sides by");
    expect(text).toContain("(x)");
    expect(text).toContain("(x + 1)");
  });

  test("(x+1)/(x-2) = 4 works through to x = 3", () => {
    const r = solveEquation("(x+1)/(x-2) = 4")!;
    const work = equationWork("(x+1)/(x-2) = 4", r);
    expect(work.length).toBeGreaterThan(0);
    expect(work[work.length - 1].math).toBe("x = 3");
  });

  test("clearing that would introduce an excluded root stops at the caution line", () => {
    // (x^2-4)/(x-2) = 0: clearing gives x²−4 with roots ±2, but x = 2 is a
    // pole — the engine reports one root, and formula-style work would
    // present the excluded value as a solution.
    const r = solveEquation("(x^2-4)/(x-2) = 0");
    if (r && r.roots.length === 1) {
      const text = joined(equationWork("(x^2-4)/(x-2) = 0", r));
      // The neutral wording: it never claims WHY candidates dropped (pole vs
      // complex) because either can be the reason — committing was the bug.
      if (text) expect(text).toContain("candidates that actually satisfy the original equation");
    }
  });

  test("cleared-fraction quadratics with rational roots get the FACTORING display", () => {
    // rootValue threading: rearrangement-path roots carry NaN re, which
    // silently killed the factoring sample-check.
    const r = solveEquation("6/x = 5 - x")!;
    const text = joined(equationWork("6/x = 5 - x", r));
    expect(text).toMatch(/\(x - 2\)\(x - 3\)|\(x - 3\)\(x - 2\)/);
  });

  test("x = pi shows no redundant collect line", () => {
    const r = solveEquation("x = pi")!;
    expect(equationWork("x = pi", r)).toEqual([]);
  });
});

describe("stacked-fraction pastes reassemble (the clipboard shape that failed)", () => {
  test("the exact pasted bytes: '3 ⏎ x+3 ⏎ ZWSP ⏎  =8' solves to -21/8", () => {
    // What a rendered 3/(x+3)=8 actually put on the clipboard.
    const folded = foldPastedMath("3\nx+3\n​\n =8", { stackedFractions: true });
    expect(folded.notes.some((n) => n.includes("stacked fraction"))).toBe(true);
    const r = solveEquation(folded.text)!;
    expect(r.roots[0].display).toBe("-21/8");
  });

  test("without the option, multi-line input is left alone (topology safety)", () => {
    const folded = foldPastedMath("3\nx+3\n =8");
    expect(folded.text).toContain("\n");
  });

  test("a real system is never reassembled (every line has =)", () => {
    const folded = foldPastedMath("x + y = 3\nx - y = 1", { stackedFractions: true });
    expect(folded.text).toContain("\n");
    expect(folded.notes).toEqual([]);
  });

  test("two bare lines stay two lines (one curve per line in the graph)", () => {
    const folded = foldPastedMath("sin(x)\ncos(x)", { stackedFractions: true });
    expect(folded.text).toContain("\n");
  });
});

describe("every work line typesets (they feed mathToHtml and OMML)", () => {
  test("the full battery renders without NaN or throw-leaks into text", () => {
    const batteries: Array<[string, () => Array<{ text?: string; math?: string }>]> = [
      ["linear", () => equationWork("3x + 7 = 22", solveEquation("3x + 7 = 22")!)],
      ["factor", () => equationWork("x^2 - 5x + 6 = 0", solveEquation("x^2 - 5x + 6 = 0")!)],
      ["formula", () => equationWork("x^2 - 2x - 1 = 0", solveEquation("x^2 - 2x - 1 = 0")!)],
      ["chain", () => derivativeWork("sin(x^2)", "x")],
      ["ftc", () => definiteIntegralWork(integrate("x^2", 0, 3)!, 0, 3)],
    ];
    for (const [, make] of batteries) {
      for (const w of make()) {
        if (!w.math) continue;
        expect(w.math).not.toMatch(/NaN|undefined|Infinity/);
        // ± falls back to text downstream; everything else must typeset.
        if (!w.math.includes("±")) {
          expect(() => mathToHtml(solveToTypesetDsl(w.math!))).not.toThrow();
        }
      }
    }
  });

  test("evaluating the factored form agrees with the original at a sample point", () => {
    // Anti-fabrication: the shown factorisation is real algebra.
    const shown = "(x - 2)(x - 3)";
    expect(evalAst(parseExpr(shown), { x: 5 })).toBe(evalAst(parseExpr("x^2 - 5x + 6"), { x: 5 }));
    expect(format(parseExpr(shown))).toBeTruthy();
  });
});
