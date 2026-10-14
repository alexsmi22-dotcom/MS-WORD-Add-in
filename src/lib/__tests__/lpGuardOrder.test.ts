/**
 * LP guard ORDER (v2.136.0, scope §A finding 5 / §E.14). lp.ts refused on the
 * name `pi` (and `lambda`) BEFORE its own linearity test, so the Lagrange
 * problem `maximize x y subject to x^2 + y^2 = pi` was answered with "“pi”
 * cannot appear in an exact linear program" (a v2.132 regression; with `= 2`
 * it reached Lagrange). Now: nonlinear even with π read as a number and only
 * equality constraints → null (not ours). Pinned in BOTH directions — a
 * linear LP that uses π still refuses by name. Routing only: the Lagrange
 * answer itself belongs to multivar.ts (builder D).
 */
import { tryLp } from "../lp";
import { tryLpWords } from "../lpWords";
import { tryInterpolate } from "../interpolate";
import { trySpline } from "../spline";
import { tryMarkov } from "../markov";
import { tryProbability } from "../probability";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 4000) throw new Error(`took ${dt} ms`);
  return r;
};
const lpRefusal = (q: string): string => {
  const v = timed(() => tryLp(q));
  if (!v) throw new Error("not claimed: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};

describe("nonlinear with pi / lambda and only equalities → null (Lagrange takes it)", () => {
  const lagrange = [
    "maximize x y subject to x^2 + y^2 = pi",
    "maximize x*y subject to x^2 + y^2 = pi",
    "minimize x*y subject to x^2 + y^2 = pi",
    "maximize x + y subject to x^2 + y^2 = pi", // linear objective, nonlinear constraint
    "maximize x^2 + y^2 subject to x + y = pi", // nonlinear objective, linear constraint
    "maximize pi*x*y subject to x^2 + y^2 = 1", // pi as a coefficient of a nonlinear term
    "maximize x*y subject to x^2 + y^2 = 2*pi",
    "maximize lambda*x subject to lambda^2 + x^2 = 1",
  ];
  it.each(lagrange)("%s: tryLp → null", (q) => {
    expect(timed(() => tryLp(q))).toBeNull();
  });
  it.each(lagrange)("%s: no verb earlier in the pane chain claims it", (q) => {
    expect(tryLp(q) ?? tryLpWords(q) ?? tryInterpolate(q) ?? trySpline(q) ?? tryMarkov(q) ?? tryProbability(q)).toBeNull();
  });
  it("the = 2 twin was already null and stays null", () => {
    expect(tryLp("maximize x y subject to x^2 + y^2 = 2")).toBeNull();
  });
});

describe("linear programs that use pi / lambda still refuse BY NAME", () => {
  it("maximize 3x + 2y subject to x + y <= pi (scope §D twin)", () => {
    expect(lpRefusal("maximize 3x + 2y subject to x + y <= pi")).toContain("“pi” (the constant π) cannot appear");
  });
  it("pi as a coefficient of a linear term, with inequalities (existing pin, unchanged)", () => {
    expect(lpRefusal("maximize pi*x + y subject to x + y <= 4, x, y >= 0")).toContain("“pi” (the constant π) cannot appear");
  });
  it("equality-only but LINEAR once π is a number: still the π refusal, not null", () => {
    expect(lpRefusal("maximize 3x + 2y subject to x + y = pi")).toContain("“pi” (the constant π) cannot appear");
    expect(lpRefusal("minimize pi*x + y subject to x + y = 4")).toContain("“pi” (the constant π) cannot appear");
  });
  it("lambda as an LP variable (linear) is still reserved by name", () => {
    expect(lpRefusal("maximize lambda + y subject to lambda + y <= 4, lambda, y >= 0")).toContain("“lambda” is a reserved name");
    expect(lpRefusal("maximize lambda + y subject to lambda + y = 4")).toContain("“lambda” is a reserved name");
  });
  it("review: a NONLINEAR objective with π and inequalities is not an LP — null, never the π refusal", () => {
    expect(tryLp("maximize x^2 subject to x <= pi")).toBeNull();
    expect(tryLp("maximize x*y subject to x^2 + y^2 <= pi")).toBeNull();
  });
  it("linear objective, nonlinear constraint, inequality, π: still claimed and refused (not silently dropped)", () => {
    const v = tryLp("maximize x + y subject to x^2 + y^2 <= pi");
    expect(v).not.toBeNull();
    expect(v!.lines.length).toBe(0);
  });
  it("without π the nonlinear-programming refusal is unchanged", () => {
    expect(lpRefusal("maximize x*y subject to x + y <= 4, x, y >= 0")).toMatch(/objective is not linear/);
  });
});
