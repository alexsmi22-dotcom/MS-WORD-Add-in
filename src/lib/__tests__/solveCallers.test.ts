/**
 * The SIX internal callers of solveEquation (SCOPE-SYMBOLIC-BATCH §E.4), pinned
 * through their public entry points. v2.136.0 changed what solveEquation
 * returns for degree ≥ 3 — exact displays (cbrt, 2*cos(2*pi/9)), one root per
 * distinct value with its multiplicity in `mult`, full-precision re/im — and
 * every caller that read the old shape is checked here, not assumed:
 *
 *   multivar.ts realRootsOne   critical points of a cubic gradient component
 *   recurrence.ts              characteristic roots (multiplicity carried)
 *   odeSymbolic.ts             quadratic characteristic equation
 *   wordproblem.ts             accepts on roots.length > 0
 *   unitSolve.ts               symbolic rearrangement
 *   pasteMath.ts               extractSingleEquation + resolveTaskVerb
 */
import { tryMultivar } from "../multivar";
import { tryRecurrence } from "../recurrence";
import { solveOdeSymbolic } from "../odeSymbolic";
import { solveWordProblem } from "../wordproblem";
import { solveWithUnits } from "../unitSolve";
import { extractSingleEquation, resolveTaskVerb } from "../pasteMath";
import { solveEquation } from "../solve";

const text = (v: { lines: { text: string }[] } | null): string => (v ? v.lines.map((l) => l.text).join("\n") : "");

describe("multivar.ts realRootsOne", () => {
  it("an irreducible cubic component (x^3 - 3x + 1) yields all three critical points at full precision", () => {
    const out = text(tryMultivar("critical points x^4/4 - 3*x^2/2 + x + y^2"));
    // 2cos(2π/9), 2cos(4π/9), 2cos(8π/9) — SymPy 1.14.0.
    expect(out).toContain("(1.53208888624, 0)");
    expect(out).toContain("(0.347296355334, 0)");
    expect(out).toContain("(-1.87938524157, 0)");
    expect(out).toMatch(/0\.347296355334, 0\)[^|\n]*saddle point/);
  });
  it("a rational cubic component keeps its exact root (4x^3 - 4 → x = 1 only, real)", () => {
    const out = text(tryMultivar("critical points x^4 - 4*x + y^2"));
    expect(out).toContain("(1, 0): local minimum, f = -3");
    expect(out.match(/\(.*?, 0\):/g)?.length).toBe(1);
  });
  it("a quadratic component is unchanged (±1)", () => {
    const out = text(tryMultivar("critical points x^3 - 3*x + y^2"));
    expect(out).toContain("(1, 0): local minimum");
    expect(out).toContain("(-1, 0): saddle point");
  });
});

describe("recurrence.ts characteristic roots", () => {
  it("a triple root keeps its multiplicity — the n and n² terms do not vanish", () => {
    const r = tryRecurrence("a(n) = 3a(n-1) - 3a(n-2) + a(n-3), a(0)=1, a(1)=2, a(2)=4")!;
    const all = JSON.stringify(r);
    expect(all).toContain("C₂·n·(1)ⁿ + C₃·n²·(1)ⁿ");
    expect(all).toContain("First terms: 1, 2, 4, 7, 11, 16, 22, 29, 37, 46, 56, 67");
    expect(all).toContain("reproduces a(0) … a(15) from direct iteration exactly");
  });
  it("tribonacci (irreducible cubic, one real root) is Newton-polished from full-precision re/im", () => {
    const all = JSON.stringify(tryRecurrence("a(n) = a(n-1) + a(n-2) + a(n-3), a(0) = 0, a(1) = 0, a(2) = 1"));
    expect(all).toContain("1.839286755"); // the tribonacci constant, SymPy 1.83928675521416
    expect(all).toContain("First terms: 0, 0, 1, 1, 2, 4, 7, 13, 24, 44, 81, 149");
    expect(all).toMatch(/reproduces a\(0\) … a\(15\)/);
    // All three roots' exact Cardano forms are SHOWN (the complex pair as
    // ω·u + ω̄·v since A's review fixes); the closed form carries them
    // numerically and says so — the stale "beyond quadratics" line is gone.
    expect(all).toContain("1.839286755 = 1/3 + cbrt(19/27 + sqrt(33)/9) + cbrt(19/27 - sqrt(33)/9)");
    expect(all).toContain("(-0.4196433776 + 0.6062907292i) = 1/3 + (-1/2 + sqrt(3)/2*i)*cbrt(19/27 + sqrt(33)/9) + (-1/2 - sqrt(3)/2*i)*cbrt(19/27 - sqrt(33)/9)");
    expect(all).toContain("the degree-3 factor's roots have exact forms in radicals (shown); the closed form carries them numerically");
    expect(all).not.toContain("beyond quadratics");
    expect(all).not.toContain("runs past the display cap");
  });
  it("three real roots are shown in the trigonometric form beside their values", () => {
    const all = JSON.stringify(tryRecurrence("a(n) = 3a(n-1) - a(n-3), a(0)=1, a(1)=1, a(2)=1"));
    expect(all).toContain("2.879385242 = 1 + 2*cos(pi/9)");
    expect(all).toContain("the degree-3 factor's roots have exact forms in radicals (shown); the closed form carries them numerically");
  });
  it("a quartic needing complex cube roots, and a complex quadratic, say why they are numeric", () => {
    expect(JSON.stringify(tryRecurrence("a(n) = -a(n-4) - a(n-3), a(0)=1, a(1)=1, a(2)=1, a(3)=1"))).toContain("a closed form would need cube roots of complex numbers");
    expect(JSON.stringify(tryRecurrence("a(n) = -a(n-2), a(0)=1, a(1)=0"))).toContain("a quadratic factor with complex roots is carried numerically");
  });
});

describe("odeSymbolic.ts (quadratic characteristic equation)", () => {
  it("distinct real roots", () => {
    expect(solveOdeSymbolic("y'' + 3y' + 2y = 0")!.solution).toBe("y = C1 * exp(-1 x) + C2 * exp(-2 x)");
  });
  it("a repeated root", () => {
    expect(solveOdeSymbolic("y'' + 2y' + y = 0")!.solution).toBe("y = (C1 + C2 x) * exp(-1 x)");
  });
});

describe("wordproblem.ts and unitSolve.ts", () => {
  it("a linear number sentence still solves", () => {
    expect(solveWordProblem("five more than a number is twelve")!.answer).toBe("7");
  });
  it("a units formula still rearranges and derives the unit", () => {
    const u = solveWithUnits("F = m a\nm = 3 kg\na = 2 m/s^2")!;
    expect(u.unknown).toBe("F");
    expect(u.value).toBe(6);
    expect(u.namedUnit).toBe("N");
  });
});

describe("pasteMath.ts", () => {
  it("extractSingleEquation still digs the equation out of a sentence", () => {
    expect(extractSingleEquation("A function f is defined by f(x) = 3x^2 + 4x - 2. For what x is it zero?")).toBe("f(x) = 3x^2 + 4x - 2");
  });
  it("resolveTaskVerb re-solves an exact cubic read out of task prose", () => {
    const t = "find the roots of x^3 - 3x + 1";
    const tv = resolveTaskVerb(t, solveEquation(t))!;
    expect(tv.text).toBe("x^3 - 3x + 1 = 0");
    expect(tv.result.method).toBe("exact (cubic — trigonometric form, three real roots)");
    expect(tv.result.roots.map((r) => r.display)).toEqual(["2*cos(2*pi/9)", "2*cos(4*pi/9)", "2*cos(8*pi/9)"]);
  });
});
