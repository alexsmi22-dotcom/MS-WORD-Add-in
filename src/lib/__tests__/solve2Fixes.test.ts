// Solve review round 2 (2026-10-24): every confirmed defect pinned, with oracle values.
//
// Oracles (C:\Users\AlexanderSmith\jurislab-oracle-venv, mpmath 30 digits / sympy):
//   from mpmath import mp, quad, quadosc, sin, sqrt, fabs, inf, erfi, pi, log, cos, mpf; mp.dps = 30
//   quadosc(lambda u: sin(u)/u**2, [1, inf], omega=1)        # ∫₀¹ sin(1/x)      = 0.504067061906928371989856117741
//   quad(lambda x: 1/sqrt(fabs(x)), [-1, 0, 1])               # ∫₋₁¹ 1/√|x|       = 4
//   quad(lambda x: 1/sqrt(fabs(x-1)), [0, 1, 2])              # ∫₀² 1/√|x − 1|    = 4
//   quad(lambda x: x**-0.5, [0, 1])                           # ∫₀¹ x^(−½)        = 2
//   quad(log, [0, 1])                                         # ∫₀¹ ln x          = −1
//   quad(lambda x: cos(x)/sqrt(x), [0, 2])                    # = 1.88824903369451413222979027056
//   quad(lambda x: 1/fabs(x**2-1)**(mpf(1)/3), [0, 1, 2])     # = 2.41772745472583386344529794302
//   quad(lambda x: log(fabs(x-1)), [0, 1, 3])                 # = −1.61370563888010938116553575708
//   quadosc(lambda u: sin(u)/u**3, [1, inf], omega=1)         # ∫₀¹ x·sin(1/x)    = 0.378530017124161309881735275628
//   sqrt(pi)/2*erfi(30)                                       # ∫₀³⁰ e^(x²)       = 1.22×10³⁸⁹ (past the double range)
//   1/cos, 1/cos², 1/sin, x/sin, 1/(sin x − ½), 1/(eˣ − 2) on the reviewer's intervals: non-integrable (order ≥ 1) poles.
// Conics: sympy — centre from the gradient system, semi-axes from the eigenvalues of [[A, B/2], [B/2, C]], foci along
// the eigenvector (script in the commit's review notes; values below to 12 figures).

import { integrate, solveEquation, parseBound } from "../solve";
import { parseCalculusTask } from "../calcTask";
import { classifyConic } from "../geometry";
import { ratInt } from "../cas";
import { solveGeometry } from "../geometryParse";
import { foldPastedMath } from "../pasteMath";
import { solveDiscrete } from "../discrete";
import { tryProbability, momentQuestionReorder } from "../probability";
import { solveIvpLaplace, tryLaplace } from "../laplace";
import { taylorSeries } from "../analysis";
import { solveInequality } from "../inequalities";
import { tryFourierSeries } from "../fourier";
import { computationKindFor } from "../ctSwitch";
import { solveFirstOrderIvp, solveOdeSymbolic } from "../odeSymbolic";
import { sciDisplay, sciMath, eNotationToText, solveToTypesetDsl } from "../solveTypeset";
import { mathToOmml } from "../mathOmml";

const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// ---------------------------------------------------------------------------
// 1. Conic centre sign
// ---------------------------------------------------------------------------
describe("1 · classifyConic centre and rotated conics (sympy)", () => {
  const R = (n: number) => ratInt(n);
  const pairClose = (got: { x: number; y: number }[], want: [number, number][]) => {
    for (const w of want) expect(got.some((g) => close(g.x, w[0], 1e-9) && close(g.y, w[1], 1e-9))).toBe(true);
  };
  it("x² + y² − 2x − 3 = 0 → circle, centre (1, 0), r = 2", () => {
    const g = solveGeometry("x^2+y^2-2x-3=0")!;
    expect(g.title).toMatch(/circle/i);
    const v = Object.fromEntries(g.values.map((x) => [x.label, x.value]));
    expect(v["centre x"]).toBeCloseTo(1, 12);
    expect(v["centre y"]).toBeCloseTo(0, 12);
    expect(v["semi-axis a"]).toBeCloseTo(2, 12);
  });
  it("(x − 2)² + (y + 3)² = 16 → circle r = 4 (was 'empty' at (−2, 3))", () => {
    const g = solveGeometry("(x-2)^2+(y+3)^2=16")!;
    expect(g.title).toMatch(/circle/i);
    const v = Object.fromEntries(g.values.map((x) => [x.label, x.value]));
    expect([v["centre x"], v["centre y"], v["semi-axis a"]]).toEqual([2, -3, 4]);
  });
  it("x² − 4y² − 2x − 3 = 0 → hyperbola, centre (1, 0), a = 2, b = 1", () => {
    const r = classifyConic(R(1), R(0), R(-4), R(-2), R(0), R(-3));
    expect(r.kind).toBe("hyperbola");
    expect(r.centre!.x).toBeCloseTo(1, 12);
    expect(r.a).toBeCloseTo(2, 12);
    expect(r.b).toBeCloseTo(1, 12);
    pairClose(r.foci!, [[3.23606797749979, 0], [-1.23606797749979, 0]]);
  });
  it.each([
    // A, B, C, D, E, F, kind, centre, a, b, foci
    [1, 1, 1, -3, 0, 0, "ellipse", [2, -1], 2.44948974278318, 1.4142135623731, [[0.585786437626905, 0.414213562373095], [3.41421356237309, -2.41421356237309]]],
    [5, 4, 2, -6, -4, -10, "ellipse", [1 / 3, 2 / 3], 3.51188458428425, 1.43372087784044, [[-1.1003875445071, 3.53410842234754], [1.76705421117377, -2.20077508901421]]],
    [1, 4, 1, -2, 0, -5, "hyperbola", [-1 / 3, 2 / 3], 1.24721912892465, 2.16024689946929, [[1.43050087404306, 2.43050087404306], [-2.09716754070973, -1.09716754070973]]],
  ] as const)("rotated %d x² + %d xy + %d y² + %d x + %d y + %d = 0", (A, B, C, D, E, F, kind, c, a, b, foci) => {
    const r = classifyConic(R(A), R(B), R(C), R(D), R(E), R(F));
    expect(r.kind).toBe(kind);
    expect(close(r.centre!.x, c[0], 1e-12) && close(r.centre!.y, c[1], 1e-12)).toBe(true);
    expect(r.a).toBeCloseTo(a, 10);
    expect(r.b).toBeCloseTo(b, 10);
    pairClose(r.foci!, foci as unknown as [number, number][]);
  });
  it("the geometry kind reads a rotated conic written with x*y", () => {
    const g = solveGeometry("x^2 + x*y + y^2 - 3x = 0")!;
    expect(g.title).toMatch(/ellipse/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Definite integrals across singularities (mpmath)
// ---------------------------------------------------------------------------
describe("2 · integrate: poles refused by name, integrable singularities integrated", () => {
  it.each([
    ["1/cos(x)", 0, 2, Math.PI / 2],
    ["1/cos(x)^2", 0, 2, Math.PI / 2],
    ["1/sin(x)", 1, 4, Math.PI],
    ["x/sin(x)", 1, 4, Math.PI],
    ["1/(sin(x)-0.5)", 0, 1, Math.PI / 6],
    ["1/(e^x-2)", 0, 1, Math.LN2],
    ["tan(x)", 0, 3, Math.PI / 2],
    ["1/x", 0, 1, 0],
  ])("∫ %s over [%d, %d] DIVERGES at the pole", (f, a, b, at) => {
    const r = integrate(f, a, b)!;
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.noValue).toMatch(/DIVERGES/);
    expect(r.method).not.toMatch(/exact|removable|Simpson|Gauss/);
    const m = /≈ (-?[\d.]+)/.exec(r.noValue!);
    expect(Number(m![1])).toBeCloseTo(at, 9);
  });
  it("1/(eˣ − 2): the fundamental theorem is NOT applied across the pole (was 'exact' −0.665)", () => {
    const r = integrate("1/(e^x-2)", 0, 1)!;
    expect(r.method).toBe("does not exist on this interval");
    expect(r.caveats.join(" ")).toMatch(/fundamental theorem/);
  });
  it.each([
    ["1/abs(x)^0.5", -1, 1, 4],
    ["1/sqrt(abs(x-1))", 0, 2, 4],
    ["1/x^0.5", 0, 1, 2],
    ["ln(x)", 0, 1, -1],
    ["cos(x)/sqrt(x)", 0, 2, 1.88824903369451413],
    ["1/abs(x^2-1)^(1/3)", 0, 2, 2.41772745472583386],
    ["ln(abs(x-1))", 0, 3, -1.61370563888010938],
    ["abs(x)/x", -1, 2, 1],
  ])("∫ %s over [%d, %d] = %d (integrable singularity, mpmath)", (f, a, b, want) => {
    const r = integrate(f, a, b)!;
    expect(r.value).toBeCloseTo(want as number, 8);
    expect(r.method).not.toMatch(/removable/);
  });
  it("a reversed interval flips the sign of a split integral", () => {
    expect(integrate("1/abs(x)^0.5", 1, -1)!.value).toBeCloseTo(-4, 8);
  });
  it("sin(1/x) on [0, 1]: an error-bounded value, never 0.49987547", () => {
    const r = integrate("sin(1/x)", 0, 1)!;
    expect(r.errorBound).toBeDefined();
    expect(r.errorBound!).toBeLessThanOrEqual(1.01e-4);
    expect(Math.abs(r.value - 0.504067061906928)).toBeLessThanOrEqual(r.errorBound!);
    expect(r.method).toMatch(/error bound/);
  });
  it("x·sin(1/x) on [0, 1]: the limit exists but oscillates — error-bounded, within the bound of 0.378530017", () => {
    const r = integrate("x*sin(1/x)", 0, 1)!;
    expect(r.errorBound).toBeDefined();
    expect(Math.abs(r.value - 0.378530017124161)).toBeLessThanOrEqual(r.errorBound! + 1e-9);
  });
  it("eˣ² on [0, 30] OVERFLOWS — said by name, not called a pole", () => {
    const r = integrate("e^(x^2)", 0, 30)!;
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.noValue).toMatch(/OVERFLOWS/);
    expect(r.caveats.join(" ")).toMatch(/not a pole/i);
    expect(r.caveats.join(" ")).not.toMatch(/\de[+-]?\d/);
  });
  it("removable points keep their answers (sin x/x, (1 − cos x)/x², (x² − 1)/(x − 1))", () => {
    expect(integrate("sin(x)/x", -1, 1)!.value).toBeCloseTo(1.8921661407343662, 10);
    expect(integrate("(1-cos(x))/x^2", -1, 1)!.value).toBeCloseTo(0.9727707524706, 9);
    expect(integrate("(x^2-1)/(x-1)", 0, 2)!.value).toBe(4);
    expect(integrate("sqrt(x)", 0, 4)!.method).toBe("exact (symbolic)");
  });
  it("regressions the review batches caught in this round stay fixed", () => {
    // p = 0.999 < 1 converges: the exact antiderivative x^0.001/0.001 is finite AT 0 (∫ = 1000).
    expect(integrate("x^(-0.999)", 0, 1)!.value).toBeCloseTo(1000, 6);
    // A fast but smooth integrand at an endpoint is not an "oscillatory singularity".
    const s = integrate("sin(100*x)", 0, Math.PI)!;
    expect(s.method).toBe("exact (symbolic)");
    expect(Math.abs(s.value)).toBeLessThan(1e-12);
    // Odd about an integrable singularity: the pieces cancel to exactly 0, not −1.2×10⁻¹³.
    expect(integrate("1/(x-1)^(1/3)", 0, 2)!.value).toBe(0);
    // tan at the double nearest π/2 is finite; its antiderivative there means nothing — still a divergence.
    expect(integrate("tan(x)", 0, Math.PI / 2)!.noValue).toMatch(/DIVERGES/);
  });
  it("bounded work: every case above finishes (no unbounded loop on an oscillating integrand)", () => {
    for (const f of ["sin(1/x)", "sin(1/(x-0.5))", "cos(1/x^2)"]) {
      const r = integrate(f, 0, 1);
      expect(r).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. e-notation is a number, not a degraded superscript
// ---------------------------------------------------------------------------
describe("3 · e-notation survives the paste fold", () => {
  const fold = (s: string) => foldPastedMath(s, { stackedFractions: true, bareStackedPairs: true, extractFromProse: true }).text;
  it.each([
    ["x = 2e3", 2000],
    ["x^2 = 1E6", 1000],
  ])("%s", (s, root) => {
    const t = fold(s);
    expect(t).not.toMatch(/e\^|E\^/);
    const r = solveEquation(t)!;
    expect(r.roots.map((x) => x.re)).toContain(root);
  });
  it("a genuine degraded power still folds (3x2 → 3x^2)", () => {
    expect(fold("3x2 + 1 = 13")).toContain("3x^2");
  });
  it("poisson lambda = 1e6 is λ = 10⁶", () => {
    const r = tryProbability(fold("poisson lambda = 1e6"))!;
    expect(r.title).toMatch(/1000000/);
  });
  it("triangle 1.5e2 2e2 2.5e2 is the 150-200-250 right triangle", () => {
    const g = solveGeometry("triangle 1.5e2 2e2 2.5e2")!;
    const v = Object.fromEntries(g.values.map((x) => [x.label, x.value]));
    expect([v.a, v.b, v.c, v.area]).toEqual([150, 200, 250, 15000]);
  });
});

// ---------------------------------------------------------------------------
// 4. Stirling numbers
// ---------------------------------------------------------------------------
describe("4 · stirling n k keeps every digit of n", () => {
  const head = (s: string) => solveDiscrete(s)!.display[0];
  it.each([
    ["stirling 10 3", /^S\(10, 3\) = 9,330/],
    ["stirling 12 4", /^S\(12, 4\) = 611,501/],
    ["stirling 25 3", /^S\(25, 3\) = 141,197,991,025/],
    ["stirling2 10 3", /^S\(10, 3\) = 9,330/],
    ["stirling1 10 3", /^s\(10, 3\) = 1,172,700/],
    ["stirling 5 2", /^S\(5, 2\) = 15/],
  ])("%s", (s, re) => expect(head(s)).toMatch(re));
});

// ---------------------------------------------------------------------------
// 5. Calculus task prose
// ---------------------------------------------------------------------------
describe("5 · parseCalculusTask strips the task before the engines", () => {
  it.each([
    ["integrate x^2 from 0 to 3", "integral", { expr: "x^2", from: "0", to: "3" }],
    ["integrate sin(x)", "integral", { expr: "sin(x)" }],
    ["x^2 dx", "integral", { expr: "x^2", variable: "x" }],
    ["∫ (x^2) dx", "integral", { expr: "x^2", variable: "x" }],
    ["the integral of t^2 dt from 0 to pi/2", "integral", { expr: "t^2", variable: "t", from: "0", to: "pi/2" }],
    ["integral from 1 to 2 of 1/x", "integral", { expr: "1/x", from: "1", to: "2" }],
    ["derivative of x^3", "derivative", { expr: "x^3" }],
    ["d/dx sin(x)", "derivative", { expr: "sin(x)", variable: "x" }],
    ["find the derivative of t^2 with respect to t", "derivative", { expr: "t^2", variable: "t" }],
    ["differentiate x^2*sin(x)", "derivative", { expr: "x^2*sin(x)" }],
  ] as const)("%s", (s, kind, want) => {
    const r = parseCalculusTask(s, kind);
    expect(r && r.ok).toBe(true);
    if (r && r.ok) expect(r).toMatchObject(want);
  });
  it("a bare expression is left alone (null), parameter names included", () => {
    expect(parseCalculusTask("sin(x^2)", "derivative")).toBeNull();
    expect(parseCalculusTask("Vmax*x/(Km + x)", "integral")).toBeNull();
  });
  it("dy/dx of y = x^2 reads x^2; an infinite limit is refused by name", () => {
    expect(parseCalculusTask("dy/dx of y = x^2", "derivative")).toMatchObject({ ok: true, expr: "x^2", variable: "x" });
    const inf = parseCalculusTask("integrate e^(-x) from 0 to infinity", "integral");
    expect(inf && !inf.ok && inf.reason).toMatch(/infinite limit/);
  });
  it.each([
    ["integrate x^2 then square it", "integral"],
    ["derivative of x^3 from 0 to 1", "derivative"],
    ["d/dx x^2", "integral"],
    ["x^2 of the", "integral"],
  ] as const)("refuses a stray word: %s", (s, kind) => {
    const r = parseCalculusTask(s, kind);
    expect(r && !r.ok).toBe(true);
  });
  it("the stripped expression reaches the real answer", () => {
    const t = parseCalculusTask("integrate x^2 from 0 to 3", "integral");
    if (!t || !t.ok) throw new Error("no task");
    expect(integrate(t.expr, parseBound(t.from!), parseBound(t.to!), t.variable)!.value).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 6. Underflow is not a root
// ---------------------------------------------------------------------------
describe("6 · spurious roots from underflow", () => {
  it("3^(x+1) = 5^x has ONE real root, ln 3/(ln 5 − ln 3)", () => {
    const r = solveEquation("3^(x+1) = 5^x")!;
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0].re).toBeCloseTo(Math.log(3) / (Math.log(5) - Math.log(3)), 9);
  });
  it("eˣ = e²ˣ has ONE real root, 0", () => {
    const r = solveEquation("e^x = e^(2x)")!;
    expect(r.roots.map((x) => x.re)).toEqual([0]);
  });
  it("sin(x) = x keeps its root at 0 (both sides 0 there, but not underflow)", () => {
    const r = solveEquation("sin(x) = x")!;
    expect(r.roots.some((x) => Math.abs(x.re) < 1e-6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Distribution moments asked first
// ---------------------------------------------------------------------------
describe("7 · mean and variance of binomial(20, 0.3)", () => {
  it("reorders to the distribution grammar and answers 6 and 4.2", () => {
    const re = momentQuestionReorder("mean and variance of binomial(20, 0.3)")!;
    expect(re).toBe("binomial(20, 0.3) mean and variance");
    const r = tryProbability(re)!;
    const txt = r.lines.map((l) => l.text).join(" | ");
    expect(txt).toMatch(/mean E\[X\] = 6\b/);
    expect(txt).toMatch(/Var\(X\) = 21\/5 {2}≈ 4\.2/);
  });
  it("leaves data alone", () => {
    expect(momentQuestionReorder("mean of 3, 5, 8")).toBeNull();
    expect(momentQuestionReorder("variance of 20, 0.3")).toBeNull();
  });
  it("P(X = 3) for binomial(10, 0.5): the parameters are read (was 'p is required')", () => {
    const r = tryProbability("P(X = 3) for binomial(10, 0.5)")!;
    expect(r.lines[0].text).toMatch(/15\/128/);
    expect(tryProbability("P(X > 110) for normal(100, 15)")!.lines[0].text).toMatch(/0\.252493/);
  });
});

// ---------------------------------------------------------------------------
// 8 & 9. SAS labels; exact forms only where they are exact
// ---------------------------------------------------------------------------
describe("8/9 · triangle labels and exact forms", () => {
  const vals = (s: string) => Object.fromEntries(solveGeometry(s)!.values.map((v) => [v.label, v]));
  it("triangle a=5 b=7 C=60 keeps a, b, C and gives c = √39, area 35√3/4, R = √13", () => {
    const v = vals("triangle a=5 b=7 C=60");
    expect(v.a.value).toBe(5);
    expect(v.b.value).toBe(7);
    expect(v.C.value).toBeCloseTo(60, 9);
    expect(v.c.value).toBeCloseTo(Math.sqrt(39), 12);
    expect(v.c.exact).toBe("sqrt(39)");
    expect(v.area.exact).toBe("(35*sqrt(3))/4");
    expect(v.area.value).toBeCloseTo((35 * Math.sqrt(3)) / 4, 12);
    expect(v.circumradius.exact).toBe("sqrt(13)");
    expect(v.inradius.exact).toBeUndefined();
  });
  it("SSA in other letters keeps them too: b=6 c=8 B=30", () => {
    const v = vals("triangle b=6 c=8 B=30");
    expect(v["b (solution 1)"].value).toBe(6);
    expect(v["c (solution 1)"].value).toBe(8);
    expect(v["B (solution 1)"].value).toBeCloseTo(30, 9);
  });
  it.each([
    // given (user letters) → law of sines in the same letters
    ["triangle B=40 C=60 a=5", { A: 80, B: 40, C: 60, a: 5, b: (5 * Math.sin((40 * Math.PI) / 180)) / Math.sin((80 * Math.PI) / 180), c: (5 * Math.sin(Math.PI / 3)) / Math.sin((80 * Math.PI) / 180) }],
    ["triangle A=30 C=45 b=4", { A: 30, B: 105, C: 45, b: 4, a: (4 * 0.5) / Math.sin((105 * Math.PI) / 180), c: (4 * Math.SQRT1_2) / Math.sin((105 * Math.PI) / 180) }],
    ["triangle A=30 B=60 c=10", { A: 30, B: 60, C: 90, c: 10, a: 5, b: 5 * Math.sqrt(3) }],
  ] as const)("ASA/AAS keeps the user's letters: %s", (s, want) => {
    const v = vals(s);
    for (const [k, w] of Object.entries(want)) expect(v[k].value).toBeCloseTo(w as number, 9);
  });
  it("a computed side never earns a fake exact Heron surd", () => {
    const v = vals("triangle b=2 c=3 A=40");
    expect(v.area.exact).toBeUndefined();
  });
  it("1/(x − 1) + 1/(x + 1) = 1 → 1 ± √2, exact — and with real values the figure can mark", () => {
    const r = solveEquation("1/(x-1)+1/(x+1)=1")!;
    const d = r.roots.map((x) => x.display).join(" ; ");
    expect(d).toMatch(/sqrt\(2\)/);
    expect(d).not.toMatch(/\d\.\d{5}/);
    expect(r.roots.map((x) => x.re).sort((p, q) => p - q)).toEqual([1 - Math.SQRT2, 1 + Math.SQRT2].map((v) => expect.closeTo(v, 12)));
    expect(r.roots.every((x) => x.im === 0 && x.exact)).toBe(true);
    const r4 = solveEquation("1/x + 1/(x+2) = 1/3")!;
    expect(r4.roots.every((x) => Number.isFinite(x.re))).toBe(true);
    // A root with another symbol in it stays symbolic (no number to mark).
    expect(Number.isNaN(solveEquation("F = m*a", "a")!.roots[0].re)).toBe(true);
  });
  it.each(["x^2 + 2x + 5 = 0", "x^4 + 4 = 0", "x^4 + x + 1 = 0", "x^30 - 1 = 0", "x^2 + 1 = 0"])(
    "complex roots of %s typeset (the pane now inserts them as equations)",
    (eq) => {
      const r = solveEquation(eq)!;
      for (const root of r.roots) {
        if (/×/.test(root.display)) continue; // multiplicity marker: stays text
        expect(() => mathToOmml(solveToTypesetDsl(`x = ${root.display}`))).not.toThrow();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 10. Laplace IVP work line
// ---------------------------------------------------------------------------
describe("10 · Laplace IVP brackets the characteristic polynomial", () => {
  it.each([
    ["y'' + 3y' + 2y = 0, y(0) = 1, y'(0) = 0", "(s^2 + 3s + 2) * Y - (s + 3) = 0"],
    ["y'' + 4y = 0, y(0) = 1, y'(0) = 0", "(s^2 + 4) * Y - (s) = 0"],
  ])("%s", (ode, line) => {
    const r = solveIvpLaplace(ode)!;
    expect(r.steps.map((s) => s.math).filter(Boolean)).toContain(line);
  });
  it("the partial fractions are a MATH line (typeset), signs folded", () => {
    const r = tryLaplace("inverse laplace 1/(s^2+3s+2)")!;
    const pf = r.lines.find((l) => /^1\/\(s\^2/.test(l.text))!;
    expect(pf.math).toBe(true);
    expect(pf.text).toBe("1/(s^2 + 3*s + 2) = 1/(s + 1) - 1/(s + 2)");
    expect(() => mathToOmml(pf.text)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 11. Indefinite integral insert string
// ---------------------------------------------------------------------------
describe("11 · indefinite integral typesets through int(, , f dx)", () => {
  it("the pane's insert form parses as an n-ary integral", () => {
    const omml = mathToOmml("int(, , (x^2) dx) = x^3/3 + C");
    expect(omml).toMatch(/m:nary/);
    expect(omml).not.toMatch(/int\(/);
  });
  it("the definite forms the pane now inserts typeset too (×10ⁿ value, error-bounded value)", () => {
    expect(sciMath(2.1408763380345e298)).toBe("2.1408763×10^{298}");
    for (const s of [`int(0, 2, x^1000) = ${sciMath(2.1408763380345e298)}`, `int(0, 1, sin(1/x)) ≈ 0.5041 +- ${sciMath(1e-4, 1)}`]) {
      const omml = mathToOmml(s);
      expect(omml).toMatch(/m:nary/);
      expect(omml).not.toMatch(/e\+|NaN/);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Taylor coefficients stay exact; the cap is stated
// ---------------------------------------------------------------------------
describe("12 · Taylor coefficients", () => {
  it("eˣ to order 10 has 1/40320 x⁸ … 1/3628800 x¹⁰", () => {
    const r = taylorSeries("e^x", "x", 0, 10)!;
    expect(r.display).toContain("1/40320*x^8");
    expect(r.display).toContain("1/3628800*x^10");
    expect(r.display).not.toMatch(/\de-|0\.0000/);
  });
  it("cos to order 12: 1/479001600 x¹²; order 15 states the cap", () => {
    expect(taylorSeries("cos(x)", "x", 0, 12)!.display).toContain("1/479001600*x^12");
    const r = taylorSeries("sin(x)", "x", 0, 15)!;
    expect(r.caveats.join(" ")).toMatch(/Order 15 was asked for; this engine expands to order 12/);
  });
});

// ---------------------------------------------------------------------------
// 13. Overflowing constants
// ---------------------------------------------------------------------------
describe("13 · 10^400 is refused by name, never 'x = NaN, exact'", () => {
  it.each(["10^400 * x = 1", "x + exp(1000) = 0"])("%s", (s) => {
    const r = solveEquation(s)!;
    expect(r.roots).toHaveLength(0);
    expect(r.method).not.toMatch(/exact/);
    expect(r.caveats.join(" ")).toMatch(/too large to represent/);
  });
  it("x² = 1e308: b² − 4ac overflows, the roots ±10¹⁵⁴ do not (was 'x = Infinity')", () => {
    const r = solveEquation("x^2 = 1e308")!;
    expect(r.roots.map((x) => x.re).sort((p, q) => p - q)).toEqual([-1e154, 1e154]);
    expect(r.steps.join(" ")).not.toMatch(/Infinity|NaN/);
  });
  it("a triangle with sides past 10¹⁵⁰ is refused by name, never angles of NaN", () => {
    const g = solveGeometry("triangle 1e308 1e308 1e308")!;
    expect(g.degenerate).toMatch(/overflow/);
  });
  it("an ordinary huge-but-finite coefficient still solves (6.02e23·x = 1)", () => {
    expect(solveEquation("6.02e23*x = 1")!.roots[0].re).toBeCloseTo(1 / 6.02e23, 30);
  });
});

// ---------------------------------------------------------------------------
// Display and refusal items
// ---------------------------------------------------------------------------
describe("display contract and wrong refusals", () => {
  it("sciDisplay / eNotationToText: never e-notation", () => {
    expect(sciDisplay(5.22e-7)).toBe("5.22×10⁻⁷");
    expect(sciDisplay(2.1408763380345e298)).toBe("2.1408763×10²⁹⁸");
    expect(sciDisplay(0.5)).toBe("0.5");
    expect(sciDisplay(NaN)).not.toMatch(/NaN/);
    expect(eNotationToText("x = 1.70463116806e-11")).toBe("x = 1.70463116806×10⁻¹¹");
    expect(eNotationToText("agrees to 9.3e-14.")).toBe("agrees to 9.3×10⁻¹⁴.");
    expect(eNotationToText("c = -2.14088*10^(298):")).toBe("c = -2.14088×10²⁹⁸:");
    expect(eNotationToText("x2e3y")).toBe("x2e3y");
  });
  it("an e-notation root typesets as ×10ⁿ (OMML has no 'e+')", () => {
    const dsl = solveToTypesetDsl("x = 7.50194007667e+64");
    expect(dsl).toBe("x = 7.50194007667×10^{64}");
    expect(mathToOmml(dsl)).not.toMatch(/e\+/);
  });
  it("recurrences: n/2 + n²/2 and √5/5, never 1/2n or 1/5√5", () => {
    const tri = solveDiscrete("a(n) = a(n-1) + n, a(0) = 0")!.display[0];
    expect(tri).toBe("a(n) = n/2 + n²/2");
    const fib = solveDiscrete("a(n) = a(n-1) + a(n-2), a(0) = 0, a(1) = 1")!;
    expect(fib.display[0]).toBe("a(n) = √5/5·(1/2 + √5/2)ⁿ − √5/5·(1/2 − √5/2)ⁿ");
    expect(fib.display.join(" ")).not.toMatch(/\(\(/);
  });
  it("an empty inequality set reads ∅ (no solution)", () => {
    expect(solveInequality("x^2 + 1 < 0")!.display).toBe("∅ (no solution)");
  });
  it("cos(2x) = 1/2 → x = ±π/6 + πn (no 2*pi/2)", () => {
    const r = solveEquation("cos(2x) = 1/2")!;
    const all = [...r.steps, ...r.caveats].join(" ");
    expect(all).toContain("x = ±pi/6 + pi*n");
    expect(all).not.toContain("2*pi/2");
  });
  it("Fourier series accepts [−π, π]", () => {
    const r = tryFourierSeries("fourier series of x on [-pi, pi]")!;
    expect(r.caveats.join(" ")).not.toMatch(/multiples of pi/);
    expect(r.lines.map((l) => l.text).join(" ")).toMatch(/b_n = -2\*\(-1\)\^n\/n/);
  });
  it("y' = x·y, y(0) = 1 → y = e^(x²/2) by separation (the transform table refuses it)", () => {
    const r = solveFirstOrderIvp("y' = x*y, y(0) = 1")!;
    expect(r.particular).toBe("y = exp(x^2/2)");
    expect(solveFirstOrderIvp("y' = x*y\ny(0) = 2")!.particular).toBe("y = 2*exp(x^2/2)");
    expect(solveFirstOrderIvp("y'' + y = 0, y(0) = 1")).toBeNull();
  });
  it("x·y' + y = x² → y = x²/3 + C/x (integrating factor x, not exp(ln|x|))", () => {
    const r = solveOdeSymbolic("x*y' + y = x^2")!;
    expect(r.verified).toBe("verified");
    expect(r.solution).toBe("y = (x^3/3 + C) / (x)");
  });
  it("log_2(x) = 5 → x = 32; log_3(x) = 2 → x = 9 (not function definitions)", () => {
    expect(solveEquation("log_2(x) = 5")!.roots[0].re).toBeCloseTo(32, 10);
    expect(solveEquation("log_3(x) = 2")!.roots[0].re).toBeCloseTo(9, 9);
  });
  it("type λx.λy.x in the default kind routes to λ-calculus; λ = 5 does not", () => {
    expect(computationKindFor("type λx.λy.x")).toBe("lambda");
    expect(computationKindFor("λx.λy.x")).toBe("lambda");
    expect(computationKindFor("λ = 5")).toBeNull();
    expect(computationKindFor("poisson lambda = 3")).toBeNull();
  });
  it("0 = 0 is an identity, 1 = 2 has no solution", () => {
    expect(solveEquation("0 = 0")!.method).toBe("identity");
    expect(solveEquation("1 = 2")!.method).toBe("no-solution");
  });
});
