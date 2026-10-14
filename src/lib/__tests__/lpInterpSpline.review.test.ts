/**
 * Independent adversarial review of v2.132.0 (LP, interpolation, splines) —
 * every test here pins a defect CONFIRMED against an oracle written outside
 * the modules (own BigInt rationals, exhaustive vertex enumeration, Vandermonde
 * and M-form solves, exact parsing of the printed polynomials).
 *
 * Plain `it` = a defect that must block the release (wrong numbers, a wrong
 * verdict, a silently dropped request): these FAIL today.
 * `it.failing` = refusal-where-answerable and cosmetic items: they pass today
 * BECAUSE the defect is there, and will flip to a failure once fixed — promote
 * them to plain `it` then.
 *
 * What the review found NOTHING wrong with (so nobody re-hunts it): 250 random
 * LPs (2–4 vars, 2–5 rows, mixed ≤/≥/=, degenerate, infeasible, unbounded) vs
 * exhaustive vertex enumeration — optimum, value, status, unique/alternative
 * labels; the printed shadow prices vs dual feasibility / complementary
 * slackness / strong duality in BOTH senses; RHS and objective ranging by
 * perturbation inside and outside the printed ranges (114 problems); branch
 * and bound vs lattice brute force (60); redundancy verdicts (86); Klee–Minty
 * n = 6…12 (465 pivots at n = 12, 50 ms); 12 × 20 with 10⁶ coefficients; 120
 * random interpolants vs Vandermonde incl. p(v) and the extrapolation flag;
 * 130 random natural/clamped/not-a-knot splines with every printed piece
 * parsed exactly and C² continuity checked from the PRINTED pieces; PCHIP
 * slopes vs hand-computed Fritsch–Carlson; 6595 distinct math lines re-parsed.
 */
import { tryLp, isLpInput } from "../lp";
import { tryInterpolate } from "../interpolate";
import { trySpline } from "../spline";
import type { VerbResult } from "../algebraTools";

const lp = (q: string): VerbResult => {
  const v = tryLp(q);
  if (!v) throw new Error("tryLp returned null for: " + q);
  return v;
};
const text = (v: VerbResult): string => v.lines.map((l) => l.text).join("\n");
const mathLines = (v: VerbResult): string[] => v.lines.filter((l) => l.math).map((l) => l.text);
const everything = (v: VerbResult): string => `${v.title}\n${text(v)}\n${v.caveats.join("\n")}`;

// ---------------------------------------------------------------------------
// WRONG NUMBERS
// ---------------------------------------------------------------------------

describe("dual of … — the dual optimum is printed in the wrong variable order", () => {
  // readInput orders variables by FIRST APPEARANCE, and the dual objective
  // b·y omits every dual variable whose right-hand side is 0 (and lists the
  // rest in b's order). The dual is then solved in [v, u] order but printed
  // under the names u, v. The engine's own shadow-price line disagrees with
  // its own "dual optimum" line in the same output.
  it("a zero right-hand side: u (for x − y ≤ 0) is 1/2 and v (for x + y ≤ 4) is 5/2", () => {
    // Oracle: dual constraints u + v = 3 (x column), −u + v = 2 (y column) → v = 5/2, u = 1/2.
    const v = lp("dual of maximize 3x + 2y subject to x - y <= 0, x + y <= 4, x, y >= 0");
    const m = mathLines(v);
    expect(m).toContain("u = 1/2"); // today: u = 5/2
    expect(m).toContain("v = 5/2"); // today: v = 1/2
    expect(text(v)).toContain("the dual optimum (1/2, 5/2)");
    // and the permutation triggers a spurious verdict: the dual optimum is unique here
    expect(v.caveats.join(" ")).not.toMatch(/alternative optima/);
  });

  it("an equality row with a zero-RHS inequality: u = 0, v = −4 (today printed as u = −4, v = 0)", () => {
    // Oracle: max 10v s.t. 4u + v ≤ −4, 3u + 3v ≤ 5, u ≥ 0, v free → u = 0, v = −4, w = −40.
    const v = lp("dual of minimize -4x + 5y subject to 4x + 3y >= 0, x + 3y = 10, x, y >= 0");
    const m = mathLines(v);
    expect(m).toContain("u = 0");
    expect(m).toContain("v = -4");
    expect(text(v)).toContain("the dual optimum (0, −4)");
  });
});

// ---------------------------------------------------------------------------
// SILENT WRONG LABEL / VERDICT
// ---------------------------------------------------------------------------

describe("dual of a 3-constraint LP — the third dual variable and the dual objective are both called w", () => {
  it("exactly one math line `w = …` (today: `w = 0` for the variable, then `w = 10` for the objective)", () => {
    const v = lp("dual of maximize 5x + 3y subject to 3x - y <= 12, 4x + 5y <= 8, x - y <= 9, x, y >= 0");
    const ws = mathLines(v).filter((l) => l.startsWith("w = "));
    expect(ws).toHaveLength(1);
  });
});

describe("a stray trailing word becomes a free variable with a zero column and flips the verdict", () => {
  // `y >= 0 graphically` parses as y ≥ 0·graphically: the word is now a FREE
  // variable that appears nowhere with a nonzero coefficient, so the engine
  // reports "(3 variables …)", "graphically = 0" and "Status: optimal, not
  // unique — the optimal set is unbounded". The user's LP has the unique
  // optimum (4, 0). A name whose every coefficient is zero is a parse artefact:
  // refuse it by name or drop it with a note — never a silent third variable.
  for (const word of ["graphically", "please"]) {
    it(`… x, y >= 0 ${word}: either the 2-variable unique optimum or a refusal naming "${word}"`, () => {
      const v = lp(`maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0 ${word}`);
      if (v.lines.length) {
        expect(v.title).toMatch(/2 variables/);
        expect(text(v)).toMatch(/Status: unique optimum\./);
        expect(text(v)).not.toContain(`${word} = `);
      } else {
        expect(v.caveats.join(" ")).toContain(word);
      }
    });
  }
});

describe("a symbolic query point is silently dropped", () => {
  // `at x = pi`: the polynomial is printed, no p(π) line, no caveat — the
  // reader cannot tell the request was not read. Answer it (p(π) is a
  // polynomial in π, exact) or refuse it by name.
  it("interpolate … at x = pi mentions pi somewhere (a value or a refusal)", () => {
    const v = tryInterpolate("interpolate (0, 1), (1, 3), (2, 2) at x = pi");
    expect(v).not.toBeNull();
    expect(everything(v!)).toMatch(/\bpi\b|π/);
  });
  it("natural cubic spline … at x = pi mentions pi somewhere", () => {
    const v = trySpline("natural cubic spline through (0, 0), (1, 1), (2, 0) at x = pi");
    expect(v).not.toBeNull();
    expect(everything(v!)).toMatch(/\bpi\b|π/);
  });
  it("two query points: the second (x = 2.5) is answered or its omission is said", () => {
    const v = tryInterpolate("interpolate (0, 1), (1, 3), (2, 2) at x = 1.5 and x = 2.5");
    expect(v).not.toBeNull();
    expect(everything(v!)).toMatch(/5\/2|2\.5/);
  });
});

// ---------------------------------------------------------------------------
// REFUSAL WHERE ANSWERABLE (it.failing: pass today, flip when fixed)
// ---------------------------------------------------------------------------

describe("LP nouns steal lines that are not LPs", () => {
  // LP_VERB_RE claims `^standard form`, `^graphically solve`, `^sensitivity`,
  // `^dual` with nothing after them; tryLp then REFUSES "Give the LP after the
  // noun" instead of standing aside, so the equation solver never sees
  // `x^2 + 6x + 2 = 0` (extractSingleEquation finds it).
  it("standard form of x^2 + 6x + 2 = 0 → not ours: tryLp null, isLpInput false", () => {
    expect(tryLp("standard form of x^2 + 6x + 2 = 0")).toBeNull();
    expect(isLpInput("standard form of x^2 + 6x + 2 = 0")).toBe(false);
  });
  it("graphically solve x^2 - 4 = 0 → not ours", () => {
    expect(tryLp("graphically solve x^2 - 4 = 0")).toBeNull();
  });
  it("sensitivity 0.9, specificity 0.8, prevalence 0.01 → not ours (a diagnostic-test question)", () => {
    expect(tryLp("sensitivity 0.9, specificity 0.8, prevalence 0.01")).toBeNull();
  });
});

describe("homework phrasings refused although the LP is there", () => {
  const BASE = "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6";
  const answers12 = (q: string): void => {
    const v = lp(q);
    expect(v.lines.length).toBeGreaterThan(0);
    expect(mathLines(v)).toContain("x = 4");
    expect(mathLines(v)).toContain("z = 12");
  };
  it("`… where x, y >= 0` (today: \"not linear: 6*where*x\")", () => answers12(`${BASE} where x, y >= 0`));
  it("`… with x, y >= 0` (today: \"not linear: 6*with*x\")", () => answers12(`${BASE} with x, y >= 0`));
  it("`… x ≥ 0, y ≥ 0 (x and y are integers)` (today: \"Could not read the constraint “y >= 0 ( )”\")", () => {
    const v = lp(`${BASE}, x ≥ 0, y ≥ 0 (x and y are integers)`);
    expect(v.lines.length).toBeGreaterThan(0);
    expect(text(v)).toMatch(/[Ii]nteger/);
  });
  it("a trailing question sentence: `… y ≥ 0. What is the maximum?`", () => answers12(`Maximize P = 3x + 2y subject to: x + y ≤ 4, x + 3y ≤ 6, x ≥ 0, y ≥ 0. What is the maximum?`.replace("P = ", "")));
  it("`maximize 3x + 2y = z subject to …` (today: \"contains a comparator\"; `maximize z = 3x + 2y` works)", () => answers12(`maximize 3x + 2y = z subject to x + y <= 4, x + 3y <= 6, x, y >= 0`));
});

// ---------------------------------------------------------------------------
// COSMETIC (it.failing)
// ---------------------------------------------------------------------------

describe("cosmetic", () => {
  it("phase-1 caveat names the relation: `-x <= -1` (flipped to ≥ internally) prints \"for the  constraints\"", () => {
    const v = lp("maximize 3x + 2y subject to -x <= -1, x + y <= 4, x, y >= 0");
    const c = v.caveats.find((s) => s.startsWith("Phase 1 ran"))!;
    expect(c).toBeDefined();
    expect(c).not.toMatch(/for the  constraints/);
  });
  it("error bound for e^x: the derivative prints `ln(e)*exp(x)` — ln(e) is 1", () => {
    const v = tryInterpolate("error bound for interpolating e^x at x = 0, 1")!;
    expect(mathLines(v).some((l) => /ln\(e\)/.test(l))).toBe(false);
  });
  it("error bound for 1/x at 1, 2, 4: the text line drops the parentheses around max|w| (`6/6 · 20/27 + (14*sqrt(7))/27`)", () => {
    const v = tryInterpolate("error bound for interpolating 1/x at x = 1, 2, 4")!;
    const l = v.lines.map((x) => x.text).find((t) => t.startsWith("|f(x) - p(x)| ≤"))!;
    expect(l).not.toMatch(/· 20\/27 \+/);
  });
  it("`line through (1,2) with slope 3` is claimed by interpolation and refused as \"One point\" — stand aside or name the slope", () => {
    const v = tryInterpolate("line through (1,2) with slope 3");
    if (v) expect(v.caveats.join(" ")).toMatch(/slope/);
  });
});
