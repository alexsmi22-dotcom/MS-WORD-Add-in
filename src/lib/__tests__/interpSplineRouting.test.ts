/**
 * Routing, not engine (v2.132.0): the pane must REACH the interpolation and
 * spline verbs (taskpane.ts cannot be imported under jest, so the wiring is
 * asserted on the source text), the guard must make the prose switches and the
 * solver stand aside for every input the verbs answer — the solver took
 * "interpolate (1, 2), (2, 3), (4, 7) at x = 1.5" and answered "x = 3/2" — and
 * the Geometry kind must stop reading "polynomial through (0,1), (1,3), (2,2)"
 * as a polygon. SCOPE-LP-SPLINES §E.5–E.8.
 */
import * as fs from "fs";
import * as path from "path";
import { INTERP_VERB_RE, tryInterpolate } from "../interpolate";
import { SPLINE_VERB_RE, trySpline } from "../spline";
import { tryMultivar } from "../multivar";
import { foldPastedMath } from "../pasteMath";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("the pane reaches the interpolation and spline verbs", () => {
  it("imports both verbs and both guards", () => {
    expect(PANE).toMatch(/import \{ tryInterpolate, INTERP_VERB_RE \} from "\.\.\/lib\/interpolate";/);
    expect(PANE).toMatch(/import \{ trySpline, SPLINE_VERB_RE \} from "\.\.\/lib\/spline";/);
  });
  it("tries interpolation and splines right after the LP verbs and before Markov in the verb chain", () => {
    expect(PANE).toMatch(/const verb =\s*tryLp\(text\) \?\?\s*tryLpWords\(text\) \?\?\s*tryInterpolate\(text\) \?\?\s*trySpline\(text\) \?\?\s*tryMarkov\(text\)/);
  });
  it("the prose-switch guard stands aside for both", () => {
    expect(PANE).toMatch(/INTERP_VERB_RE\.test\(text\) \|\|\s*SPLINE_VERB_RE\.test\(text\)/);
  });
  it("the Geometry kind switches to the Equation kind for a named interpolant or spline", () => {
    const geo = PANE.slice(PANE.indexOf('if (kind === "geometry") {'));
    expect(geo.slice(0, 1200)).toMatch(/INTERP_VERB_RE\.test\(text\) \|\| SPLINE_VERB_RE\.test\(text\)/);
    expect(geo.slice(0, 1200)).toMatch(/solveKind\.value = "equation"/);
  });
  it("the pane never prints the inequality sentinel as an answer", () => {
    expect(PANE).toMatch(/iq\.display === "refused"/);
  });
});

describe("the guard claims everything the verbs answer", () => {
  const interp = [
    "interpolate (1, 2), (2, 3), (4, 7)",
    "interpolate (1, 2), (2, 3), (4, 7) at x = 3",
    "lagrange polynomial through (0, 1), (1, 3), (2, 2)",
    "lagrange polynomial through (0, 1), (1, 3), (2, 2) at x = 1.5",
    "neville's method (0, 1), (1, 3), (2, 2) at x = 1.5",
    "newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)",
    "x: 0, 1, 2, 3; y: 1, 2, 5, 10 interpolating polynomial",
    "polynomial through (0, 0), (1, 1), (2, 4), (3, 9)",
    "degree 3 polynomial through (-1, 0), (0, 1), (1, 0), (2, 5)",
    "interpolating polynomial for f(x) = 1/x at x = 1, 2, 4",
    "linear interpolation between (1, 10) and (3, 20) at x = 2",
    "estimate f(2.5) given f(2) = 4, f(3) = 9 by linear interpolation",
    "error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic",
    "fit a polynomial through (0,1), (1,3), (2,2)",
    "line through (1, 2) and (3, 8)",
  ];
  it.each(interp)("%s", (q) => {
    expect(INTERP_VERB_RE.test(q)).toBe(true);
    const v = tryInterpolate(foldPastedMath(q).text);
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
  });
  const spline = [
    "natural cubic spline through (0, 0), (1, 1), (2, 0)",
    "natural cubic spline through (0, 0), (1, 1), (2, 0) evaluate at x = 0.5",
    "spline (0,0), (1,1), (2,0) at 1.5",
    "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1",
    "cubic spline (0, 1), (1, 3), (2, 2) with end slopes 0 and 0",
    "not-a-knot spline through (0,1), (1,3), (2,2), (3,4)",
    "cubic spline (1, 2), (2, 3), (4, 7) second derivative zero at the ends",
    "cubic spline interpolation x: 0, 1, 2; y: 1, 2, 0",
    "S(x) natural cubic spline (0,1), (1,2), (2,0) find S(1.5)",
    "smooth curve through the points (0, 0), (1, 2), (2, 1), (3, 3)",
    "linear spline through (0, 0), (1, 2), (3, 1)",
    "pchip (0, 0), (1, 1), (2, 1), (3, 2)",
  ];
  it.each(spline)("%s", (q) => {
    expect(SPLINE_VERB_RE.test(q)).toBe(true);
    const v = trySpline(foldPastedMath(q).text);
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBeGreaterThan(0);
  });
  it("the name=number steal is gone: 'at x = 1.5' is a query, not an equation", () => {
    const v = tryInterpolate("lagrange polynomial through (0, 1), (1, 3), (2, 2) at x = 1.5")!;
    const all = v.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");
    expect(all).toMatch(/23\/8/);
    expect(all).not.toMatch(/^x = 3\/2$/m);
  });
});

describe("the verbs stand aside where they must", () => {
  it("Lagrange MULTIPLIERS still belong to the multivariable engine (guard-regression twin)", () => {
    // First wiring: the bare `lagrange` prefix stole the Multivariable palette's
    // own template and refused it. A constraint word means multipliers.
    for (const q of ["lagrange x y subject to x^2 + y^2 = 1", "lagrange multipliers x + y subject to x^2 + y^2 = 1", "lagrange x y s.t. x + y = 1"]) {
      expect(INTERP_VERB_RE.test(q)).toBe(false);
      expect(tryInterpolate(q)).toBeNull();
      expect(tryMultivar(q)).not.toBeNull();
    }
  });
  const left = [
    "x^2 - 5x + 6 = 0",
    "mean of 3, 5, 8",
    "laplace t^2",
    "gradient x^2 y",
    "binomial n=10 p=0.4 P(X <= 3)",
    "markov [[0.9, 0.1], [0.5, 0.5]] stationary",
    "polygon (0,0) (4,0) (4,4)",
    "f(x) = x^2",
    "solve 2x + 3 = 7",
  ];
  it.each(left)("%s is left alone by both verbs", (q) => {
    expect(tryInterpolate(q)).toBeNull();
    expect(trySpline(q)).toBeNull();
  });
  it("a least-squares FIT is refused by name, never interpolated", () => {
    const v = tryInterpolate("least squares line through (1,2), (2,3), (3,5)");
    expect(v).not.toBeNull();
    const all = v!.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + " " + (v!.caveats ?? []).join(" ");
    expect(all).toMatch(/least[- ]squares|FIT/i);
    expect(all).not.toMatch(/p\(x\) =/);
  });
  it("bare 'spline' and bare 'interpolate' are usage refusals, never 'spline = 0'", () => {
    for (const q of ["spline", "interpolate"]) {
      const v = tryInterpolate(q) ?? trySpline(q);
      expect(v).not.toBeNull();
      const all = v!.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + " " + (v!.caveats ?? []).join(" ");
      expect(v!.lines.some((l) => /^(?:spline|interpolate) = 0$/.test(l.text))).toBe(false);
      expect(all).toMatch(/\(1, 2\)|\(0, 0\)/);
    }
  });
});
