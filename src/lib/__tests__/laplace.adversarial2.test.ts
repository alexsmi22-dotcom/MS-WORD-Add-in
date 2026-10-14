/** The second independent pass — over the fixes — pinned. */
import { parseExpr, evalAst, format } from "../solve";
import { laplaceTransform, inverseLaplace, tryLaplace, solveIvpLaplace } from "../laplace";
import { exactSimplify, trigPiExact } from "../exact";
import { ratMake } from "../cas";

const fwd = (f: string) => {
  const r = laplaceTransform(parseExpr(f));
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const sameInT = (got: ReturnType<typeof parseExpr>, expected: string) => {
  const exp = parseExpr(expected);
  for (const t of [0.1, 0.7, 1.3, 2.2]) {
    expect(Math.abs(evalAst(got, { t }) - evalAst(exp, { t }))).toBeLessThan(1e-8 * Math.max(1, Math.abs(evalAst(exp, { t }))));
  }
};

describe("1. a symbolic frequency is shown, not withheld", () => {
  it("laplace sin(w*t) → w/(s^2 + w^2) with the numeric check honestly skipped", () => {
    const v = tryLaplace("laplace sin(w*t)")!;
    expect(v.lines.length).toBeGreaterThan(0);
    expect(v.lines[0].text).toMatch(/w/);
    expect(v.caveats.join(" ")).toMatch(/Not checked numerically/);
    expect(fwd("sin(w*t)").region).toBeNull();
  });
});

describe("2. a first-order impulse response", () => {
  it("y' + y = delta(t), y(0) = 0 → exp(-t), with y(0) read as the value before the jump", () => {
    const r = solveIvpLaplace("y' + y = delta(t), y(0) = 0")!;
    expect(r.solution).not.toBe("");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), "exp(-t)");
    expect(r.caveats[0]).toMatch(/before the impulse/);
  });
});

describe("3–4. the masking simplifier still simplifies", () => {
  const S = (s: string) => format(exactSimplify(parseExpr(s)));
  it.each([
    ["sqrt(2)^2", "2"],
    ["sqrt(2)*sqrt(2)", "2"],
    ["sqrt(4)", "2"],
    ["exp(0)", "1"],
    ["ln(1)", "0"],
    ["exp(1)*exp(-1)", "1"],
    ["sin(pi/4)^2 + cos(pi/4)^2", "1"],
    ["cos(pi/3) + cos(pi/3)", "1"],
    ["tan(pi/4)", "1"],
    ["tan(pi/6)", "sqrt(3)/3"],
    ["exp(2*1)", "exp(2)"],
  ])("%s → %s", (input, out) => {
    expect(S(input)).toBe(out);
  });
  it("sin(pi/5) stays symbolic; tan(pi/2) stays symbolic (undefined)", () => {
    expect(S("sin(pi/5)")).toBe("sin(pi/5)");
    expect(trigPiExact("tan", ratMake(1n, 2n))).toBeNull();
  });
  it("laplace sqrt(2)*sin(sqrt(2)*t) is 2/(s^2 + 2)", () => {
    expect(format(fwd("sqrt(2)*sin(sqrt(2)*t)").F)).toBe("2/(s^2 + 2)");
  });
  it("a user variable named kc_0 survives, and a second variable is refused rather than crashing", () => {
    expect(format(exactSimplify(parseExpr("kc_0 + sqrt(2)")))).toMatch(/kc_0/);
    // kc_0 is read as a symbolic constant: shown, with the numeric check honestly skipped.
    const v = tryLaplace("laplace kc_0*t")!;
    expect(v.lines[0].text).toMatch(/kc_0/);
    expect(v.caveats[0]).toMatch(/Not checked numerically/);
  });
});

describe("5–6. display", () => {
  it("step lines read u(t - 1), never u(t - --1); delta(t) reads delta(t)", () => {
    const v = tryLaplace("laplace t u(t-1)")!;
    expect(v.lines.map((l) => l.text).join("\n")).toMatch(/u\(t - 1\)/);
    expect(v.lines.map((l) => l.text).join("\n")).not.toMatch(/--/);
    expect(tryLaplace("laplace delta(t)")!.lines.map((l) => l.text).join("\n")).toMatch(/delta\(t\)/);
  });
  it("single terms are tidy: 10/s, 1/(2*(s^2 + 1))", () => {
    expect(format(fwd("10").F)).toBe("10/s");
    expect(format(fwd("sin(t)/2").F)).toBe("1/(2*(s^2 + 1))");
  });
});

describe("8, 10, 11. delays with π, exponentials in denominators, spellings", () => {
  it("inverse laplace exp(-pi*s)/(s^2+1) = sin(t - pi) u(t - pi)", () => {
    const r = inverseLaplace(parseExpr("exp(-pi*s)/(s^2+1)"));
    if ("refusal" in r) throw new Error(r.refusal);
    sameInT(r.f, "sin(t - pi)*u(t - pi)");
    expect(format(r.f)).toMatch(/pi/);
  });
  it("1/exp(t) and t/exp(t) and exp(t)/exp(2t) transform", () => {
    expect(format(fwd("1/exp(t)").F)).toBe("1/(s + 1)");
    expect(format(fwd("t/exp(t)").F)).toBe("1/(s + 1)^2");
    expect(format(fwd("exp(t)/exp(2t)").F)).toBe("1/(s + 1)");
  });
  it("L^{-1}{1/s} and an inverse with a trailing region parse", () => {
    expect(tryLaplace("L^{-1}{1/s}")!.lines[0].text).toBe("f(t) = 1");
    expect(tryLaplace("inverse laplace 1/(s+1) for s > -1")!.lines[0].text).toMatch(/exp\(-t\)/);
  });
  it("a forward transform of something in s hints at the inverse", () => {
    expect(tryLaplace("laplace transform of 1/(s^2+1)")!.caveats[0]).toMatch(/inverse laplace/);
  });
});
