// The Solve composer's buttons must produce input the solvers actually accept.
// A palette that inserts syntax its own engine rejects is a button-shaped bug —
// same family as the routing-vs-engine traps: the engine being green proves
// nothing about what the pane feeds it.

import { SOLVE_SYMBOLS, SOLVE_EQUATIONS, SOLVE_SHAPES, SOLVE_CALCULUS } from "../palettes";
import { solveEquation, differentiate, normalizeUnicodeMath, parseExpr } from "../solve";
import { parseLimitRequest, parseSeriesRequest } from "../analysis";
import { foldPastedMath } from "../pasteMath";
import { solveInequality } from "../inequalities";
import { splitEquations, solveSystem } from "../systems";
import { solveGeometry } from "../geometryParse";
import { solveComposite } from "../compositeGeometry";

describe("every equation-library template solves", () => {
  const all = SOLVE_EQUATIONS.flatMap((g) => g.items.map((i) => ({ group: g.name, ...i })));
  test.each(all.map((i) => [i.label, i.snippet] as const))("%s: %s", (_label, snippet) => {
    // Templates ride the SAME pipeline as typed/pasted input: fold first.
    // Greek in a formula (v = f λ) is the paste-folding layer's job.
    const text = foldPastedMath(snippet).text;
    if (/[<>]=?|!=|[≤≥≠]/.test(text)) {
      expect(solveInequality(text)).not.toBeNull();
      return;
    }
    if (text.includes("\n")) {
      const eqs = splitEquations(text);
      expect(eqs.length).toBeGreaterThan(1);
      const sys = solveSystem(eqs);
      expect(sys).not.toBeNull();
      return;
    }
    const r = solveEquation(text);
    expect(r).not.toBeNull();
    // A formula template's whole point is the solve-for chips: several unknowns.
    expect((r!.unknowns ?? [r!.variable]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("every calculus template is read as the prose it is", () => {
  const all = SOLVE_CALCULUS.flatMap((g) => g.items);
  test.each(all.map((i) => [i.label, i.snippet] as const))("%s: %s", (_label, snippet) => {
    expect(parseLimitRequest(snippet) !== null || parseSeriesRequest(snippet) !== null).toBe(true);
  });
});

describe("Greek palette characters fold into solvable variables", () => {
  test("every Greek button's character survives fold → parse", () => {
    const greek = SOLVE_SYMBOLS.find((g) => g.name === "Greek")!;
    for (const item of greek.items) {
      const folded = foldPastedMath(`${item.snippet} + 1`);
      expect(() => parseExpr(normalizeUnicodeMath(folded.text))).not.toThrow();
    }
  });
});

describe("every shape template resolves in one of the two geometry engines", () => {
  const all = SOLVE_SHAPES.flatMap((g) => g.items);
  test.each(all.map((i) => [i.label, i.snippet] as const))("%s: %s", (_label, snippet) => {
    const composite = solveComposite(snippet);
    if (composite) {
      expect(composite.incomplete).toBeUndefined();
      expect(composite.values.length).toBeGreaterThan(0);
      return;
    }
    expect(solveGeometry(snippet)).not.toBeNull();
  });
});

describe("symbol snippets are the Solve grammar, not the Math-mode DSL", () => {
  test("structure snippets with their caret placeholders filled parse", () => {
    // What a user gets after clicking the button and typing "x" in the gap.
    // The structure buttons insert REAL glyphs (√, ², ³) — the parser reads
    // them natively, which is the whole point of symbols over plain english.
    const filled: Record<string, string> = {
      "()/()": "(x)/(2)",
      "^()": "x^(2)",
      "√()": "√(x)",
      "²": "x²",
      "³": "x³",
      "abs()": "abs(x)",
      "()": "(x)",
      "sin()": "sin(x)",
      "cos()": "cos(x)",
      "tan()": "tan(x)",
      "ln()": "ln(x)",
      "log()": "log(x)",
      "exp()": "exp(x)",
    };
    for (const g of SOLVE_SYMBOLS) {
      for (const item of g.items) {
        const probe = filled[item.snippet];
        if (probe) {
          expect(() => parseExpr(normalizeUnicodeMath(probe))).not.toThrow();
        }
      }
    }
  });

  test("π and ∞ ride through normalizeUnicodeMath with their own spacing", () => {
    // The buttons insert the CHARACTERS because the normalizer pads them —
    // "2π" can never glue into an identifier the way a bare "pi" could.
    expect(normalizeUnicodeMath("2π")).toMatch(/2\s*\*?\s*pi/);
    expect(() => parseExpr(normalizeUnicodeMath("2πr"))).not.toThrow();
    const eq = solveEquation("A = πr^2", "r");
    expect(eq).not.toBeNull();
  });

  test("relation snippets solve as inequalities when wrapped around an expression", () => {
    // The buttons now insert the real glyphs — the inequality engine reads
    // both spellings, and the pane's dispatch regex recognises ≤ ≥ ≠.
    for (const probe of ["x^2 - 4 ≥ 0", "x < 3", "x ≠ 2", "x^3 - x ≤ 0", "x > -1", "x^2 - 4 >= 0"]) {
      expect(solveInequality(probe)).not.toBeNull();
    }
  });

  test("no snippet uses Math-DSL brace syntax (^{} binds nothing in parseExpr)", () => {
    for (const g of [...SOLVE_SYMBOLS, ...SOLVE_EQUATIONS, ...SOLVE_SHAPES]) {
      for (const item of g.items) {
        expect(item.snippet).not.toMatch(/\^\{|_\{/);
      }
    }
  });
});

describe("every λ-calculus template is accepted by the λ engine", () => {
  const { SOLVE_LAMBDA, SOLVE_LAMBDA_SYMBOLS } = require("../palettes") as typeof import("../palettes");
  const { solveLambda, parseTerm } = require("../lambda") as typeof import("../lambda");
  const all = SOLVE_LAMBDA.flatMap((g) => g.items.map((i) => ({ group: g.name, ...i })));
  test.each(all.map((i) => [i.label, i.snippet] as const))("%s: %s", (_label, snippet) => {
    // Must not throw (a syntax error is a thrown LambdaSyntaxError) and must answer.
    const r = solveLambda(snippet);
    expect(r).not.toBeNull();
    expect(r!.display.length).toBeGreaterThan(0);
    // No template may trip the reducer's own cross-check.
    expect(r!.verified).not.toBe(false);
  });
  it("the λ symbol snippet is the glyph the parser reads as a binder", () => {
    const lam = SOLVE_LAMBDA_SYMBOLS[0].items.find((i) => i.label === "λ")!;
    expect(parseTerm(`${lam.snippet}x.x`).kind).toBe("lam");
  });
});

describe("every Discrete-math template is answered by its engine", () => {
  const { SOLVE_DISCRETE } = require("../palettes") as typeof import("../palettes");
  const { solveDiscrete } = require("../discrete") as typeof import("../discrete");
  const all = SOLVE_DISCRETE.flatMap((g) => g.items.map((i) => ({ group: g.name, ...i })));
  test.each(all.map((i) => [`${i.group}: ${i.label}`, i.snippet] as const))("%s", (_label, snippet) => {
    const r = solveDiscrete(snippet);
    expect(r).not.toBeNull();
    // A template must never land on the "not recognised" fallback or a failed cross-check.
    expect(r!.title).not.toBe("Not recognised");
    expect(r!.caveats.join(" ")).not.toMatch(/FAILED/);
    expect(r!.display.length).toBeGreaterThan(0);
  });
});

describe("every transform, multivariable and probability template is answered by its verb (v2.129.0–v2.131.0)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SOLVE_TRANSFORMS, SOLVE_ODES } = require("../palettes");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryLaplace, solveIvpLaplace, hasInitialConditions } = require("../laplace");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryFourierSeries } = require("../fourier");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryMultivar } = require("../multivar");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryProbability } = require("../probability");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryMarkov } = require("../markov");
  const all = SOLVE_TRANSFORMS.flatMap((g: { items: { label: string; snippet: string }[] }) => g.items);
  const rows: [string, string][] = all.map((i: { label: string; snippet: string }) => [i.label, i.snippet]);
  test.each(rows)("%s: %s", (_label: string, snippet: string) => {
    const text = foldPastedMath(snippet).text;
    const v = tryMarkov(text) ?? tryProbability(text) ?? tryMultivar(text) ?? tryLaplace(text) ?? tryFourierSeries(text);
    expect(v).not.toBeNull();
    // A template must produce a RESULT line, not a refusal.
    expect(v!.lines.length).toBeGreaterThan(0);
  });
  const ivps = SOLVE_ODES.flatMap((g: { items: { label: string; snippet: string }[] }) => g.items).filter((i: { snippet: string }) =>
    hasInitialConditions(i.snippet),
  );
  const ivpRows: [string, string][] = ivps.map((i: { label: string; snippet: string }) => [i.label, i.snippet]);
  test.each(ivpRows)("IVP %s: %s", (_label: string, snippet: string) => {
    const r = solveIvpLaplace(foldPastedMath(snippet).text);
    expect(r).not.toBeNull();
    expect(r!.solution).not.toBe("");
    expect(r!.verified).toBe("verified");
  });
});
