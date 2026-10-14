/**
 * Routing, not engine (v2.132.0): the pane must REACH the LP verbs (asserted on
 * the taskpane source — it cannot be imported under jest), the LP guard must be
 * decided on the RAW input before the paste fold rewrites 3x1 into 3x^1 and
 * drops the objective line, and the Lagrange-multipliers verb must stand aside
 * for every LP (it used to claim "maximize … subject to x + y <= 4" and return
 * an EMPTY result). SCOPE-LP-SPLINES §E.1–E.4, E.9–E.10, E.15.
 */
import * as fs from "fs";
import * as path from "path";
import { LP_VERB_RE, isLpInput, tryLp } from "../lp";
import { LP_WORDS_RE, tryLpWords } from "../lpWords";
import { tryMultivar } from "../multivar";
import { foldPastedMath } from "../pasteMath";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/** The whole journey a typed LP takes in the pane's equation kind. */
function paneFold(raw: string): string {
  return foldPastedMath(raw, {
    stackedFractions: true,
    bareStackedPairs: true,
    extractFromProse: true,
    lp: isLpInput(raw) || LP_WORDS_RE.test(raw),
  }).text;
}

describe("the pane reaches the LP verbs", () => {
  it("imports both verbs and both guards", () => {
    expect(PANE).toMatch(/import \{ tryLp, LP_VERB_RE, isLpInput \} from "\.\.\/lib\/lp";/);
    expect(PANE).toMatch(/import \{ tryLpWords, LP_WORDS_RE \} from "\.\.\/lib\/lpWords";/);
  });
  it("tries the LP verbs FIRST in the verb chain", () => {
    expect(PANE).toMatch(/const verb =\s*tryLp\(text\) \?\?\s*tryLpWords\(text\) \?\?\s*tryInterpolate\(text\)/);
  });
  it("decides the lp fold flag on the RAW input, in the equation kind", () => {
    expect(PANE).toMatch(/lp: kind === "equation" && \(isLpInput\(solveInput\.value\) \|\| LP_WORDS_RE\.test\(solveInput\.value\)\)/);
  });
  it("the prose-switch guard stands aside for both (labelled lines included)", () => {
    expect(PANE).toMatch(/LP_VERB_RE\.test\(text\) \|\|\s*isLpInput\(text\) \|\|\s*LP_WORDS_RE\.test\(text\)/);
  });
});

describe("the guard claims everything the verb answers, through the pane's own fold", () => {
  const answered = [
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0",
    "maximize 3x + 2y s.t. x + y <= 4, x + 3y <= 6, x, y >= 0",
    "max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0",
    "maximize z = 3x + 2y subject to x + y ≤ 4, x + 3y ≤ 6, x, y ≥ 0",
    "maximize 3x + 2y subject to x + y =< 4, x + 3y =< 6, x, y >= 0",
    "LP: max 3x+2y st x+y<=4, x+3y<=6, x>=0, y>=0",
    "shadow prices for maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
    "dual of maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
    "minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0",
    "two phase simplex minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x, y >= 0",
    "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0",
    "maximize 3x_1 + 2x_2 + 5x_3 subject to x_1 + 2x_2 + x_3 <= 430, 3x_1 + 2x_3 <= 460, x_1 + 4x_2 <= 420, x_1, x_2, x_3 >= 0",
    "maximize x + y subject to x - y <= 1, x >= 0, y >= 0",
    "maximize x + y subject to x + y <= 1, x + y >= 2, x, y >= 0",
    "maximize 2x + 2y subject to x + y <= 4, x <= 3, y <= 3, x, y >= 0",
    "maximize 3x + 9y subject to x + 4y <= 8, x + 2y <= 4, x, y >= 0",
    "maximize 3x + 2y subject to x + y = 4, x + 3y <= 6, x, y >= 0",
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6",
    "maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0, x and y integer",
    "Maximize P = 40x + 30y subject to x + y ≤ 12, 2x + y ≤ 16, x ≥ 0, y ≥ 0",
    "diet problem: minimize cost 0.6x + 0.35y subject to 5x + 7y >= 8, 4x + 2y >= 15, x, y >= 0",
    "standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2",
    "simplex tableau for maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
    "graphically solve maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
  ];
  it.each(answered)("%s", (q) => {
    // A labelled line ("diet problem: minimize …") is claimed by isLpInput,
    // which the pane uses for the fold flag and the guard.
    expect(isLpInput(q)).toBe(true);
    const v = tryLp(paneFold(q));
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
    const all = v!.lines.map((l) => l.text).join("\n");
    // The fold never turned a decision variable into a power.
    expect(all).not.toMatch(/x\^1\b/);
  });
  it("the 3-variable problem keeps x1, x2, x3 as names through the fold", () => {
    const q = "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0";
    expect(paneFold(q)).toBe(q);
    const all = tryLp(paneFold(q))!.lines.map((l) => l.text).join("\n");
    expect(all).toMatch(/1350/);
  });
  it("the one-per-line shape keeps its objective", () => {
    const q = "max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0";
    const all = tryLp(paneFold(q))!.lines.map((l) => l.text).join("\n");
    expect(all).toMatch(/z = 12/);
  });
  it("the products × resources prose template is answered", () => {
    const q = "A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available. How many of each maximize profit?";
    expect(LP_WORDS_RE.test(q)).toBe(true);
    const v = tryLpWords(paneFold(q));
    expect(v).not.toBeNull();
    expect(v!.lines.map((l) => l.text).join("\n")).toMatch(/1900/);
  });
});

describe("the verbs stand aside where they must", () => {
  it("Lagrange multipliers stand aside for every inequality-constrained LP (guard-regression twin)", () => {
    for (const q of [
      "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
      "minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0",
      "maximize 3x + 2y subject to x + y = 4, x + 3y <= 6, x, y >= 0",
      "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6",
    ]) {
      expect(tryMultivar(q)).toBeNull();
      expect(tryLp(q)).not.toBeNull();
    }
  });
  it("a nonlinear objective with an equality constraint is still Lagrange multipliers", () => {
    const q = "minimize x^2 + y^2 subject to x + y = 1";
    expect(tryLp(q)).toBeNull();
    const v = tryMultivar(q);
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
  });
  it("a bare maximize is a usage refusal, never 'more than one unknown (maximize, x, y)'", () => {
    const v = tryLp("maximize 3x + 2y");
    expect(v).not.toBeNull();
    const all = v!.lines.map((l) => l.text).join("\n") + " " + v!.caveats.join(" ");
    expect(all).toMatch(/subject to/i);
    expect(all).not.toMatch(/more than one unknown/);
  });
  it("maximize f(x) = x^2 - 4x (single-variable calculus) is left alone", () => {
    expect(LP_VERB_RE.test("maximize f(x) = x^2 - 4x")).toBe(false);
    expect(tryLp("maximize f(x) = x^2 - 4x")).toBeNull();
  });
  const left = ["x^2 - 5x + 6 = 0", "mean of 3, 5, 8", "laplace t^2", "gradient x^2 y", "interpolate (1, 2), (2, 3), (4, 7)", "binomial n=10 p=0.4 P(X <= 3)", "x + y <= 4", "f(x) = x^2", "solve 2x + 3 = 7", "max of 3, 5, 8"];
  it.each(left)("%s is left alone by both verbs", (q) => {
    expect(tryLp(q)).toBeNull();
    expect(tryLpWords(q)).toBeNull();
  });
});
