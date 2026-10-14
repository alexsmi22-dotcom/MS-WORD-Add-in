/**
 * The independent adversarial pass over laplace.ts: every confirmed defect,
 * pinned. The pattern of the findings — a freeze on t^10, a dropped factor
 * hidden by an impulse, the inverse pattern stealing "laplace 10", decimals
 * leaking into "exact" results — is what the module header now promises
 * against.
 */
import { parseExpr, evalAst, format } from "../solve";
import { laplaceTransform, inverseLaplace, tryLaplace, solveIvpLaplace, numericCheck } from "../laplace";

const fwd = (f: string) => {
  const r = laplaceTransform(parseExpr(f));
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const inv = (F: string) => {
  const r = inverseLaplace(parseExpr(F));
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const sameInS = (got: ReturnType<typeof parseExpr>, expected: string, from = 4) => {
  const exp = parseExpr(expected);
  for (const s of [from, from + 1.7, from + 3.3]) {
    expect(Math.abs(evalAst(got, { s }) - evalAst(exp, { s }))).toBeLessThan(1e-9 * Math.max(1, Math.abs(evalAst(exp, { s }))));
  }
};
const sameInT = (got: ReturnType<typeof parseExpr>, expected: string) => {
  const exp = parseExpr(expected);
  for (const t of [0.1, 0.7, 1.3, 2.2, 3.1]) {
    expect(Math.abs(evalAst(got, { t }) - evalAst(exp, { t }))).toBeLessThan(1e-8 * Math.max(1, Math.abs(evalAst(exp, { t }))));
  }
};

describe("1. no freeze on high powers", () => {
  it("t^10 and t^12 return at once with the closed form", () => {
    const t0 = Date.now();
    sameInS(fwd("t^10").F, "3628800/s^11");
    sameInS(fwd("t^12 exp(-t)").F, "479001600/(s+1)^13");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("t^7 e^{-t} is 5040/(s+1)^8 in a short form, not a degree-120 rational", () => {
    const r = fwd("t^7 exp(-t)");
    sameInS(r.F, "5040/(s+1)^8");
    expect(format(r.F).length).toBeLessThan(60);
  });
  it("t^6 sin(t) differentiates with simplification between steps, in bounded time", () => {
    const t0 = Date.now();
    const r = fwd("t^6 sin(t)");
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(numericCheck(parseExpr("t^6 sin(t)"), r.F, r.region)).toBe("verified");
  });
  it("powers above 12 are refused by name", () => {
    const r = laplaceTransform(parseExpr("t^13"));
    expect("refusal" in r && r.refusal).toMatch(/above 12/);
  });
});

describe("2. triple products keep every factor (the impulse used to hide the loss)", () => {
  it("sin(t) sin(2t) sin(3t) delta(t-1) = sin1·sin2·sin3·e^{-s}", () => {
    const r = fwd("sin(t)*sin(2t)*sin(3t)*delta(t-1)");
    const expected = Math.sin(1) * Math.sin(2) * Math.sin(3);
    for (const s of [1, 2.5]) expect(evalAst(r.F, { s })).toBeCloseTo(expected * Math.exp(-s), 10);
  });
  it("sin(t)^2 sin(2t)^2 delta(t-1) = sin²1·sin²2·e^{-s}", () => {
    const r = fwd("sin(t)^2*sin(2t)^2*delta(t-1)");
    const expected = Math.sin(1) ** 2 * Math.sin(2) ** 2;
    expect(evalAst(r.F, { s: 1 })).toBeCloseTo(expected * Math.exp(-1), 10);
  });
  it("sin(t) sin(2t) sin(3t) without the impulse transforms and verifies", () => {
    const r = fwd("sin(t)*sin(2t)*sin(3t)");
    expect(numericCheck(parseExpr("sin(t)*sin(2t)*sin(3t)"), r.F, r.region)).toBe("verified");
  });
});

describe("3. 'laplace 10' is a forward transform", () => {
  it.each([
    ["laplace 10", "10/s"],
    ["laplace 1 + t", "1/s + 1/s^2"],
    ["laplace 12 t", "12/s^2"],
    ["laplace 1 - exp(-t)", "1/s - 1/(s+1)"],
    ["laplace (1/2) exp(t)", "1/(2*(s-1))"],
  ])("%s", (q, F) => {
    const v = tryLaplace(q)!;
    expect(v.lines.length).toBeGreaterThan(0);
    const got = parseExpr(v.lines[0].text.replace(/^F\(s\) = /, "").replace(/, for s > .*$/, ""));
    sameInS(got, F, 3);
  });
  it("the inverse still needs its marker: laplace^-1, L^-1, ℒ⁻¹, inverse laplace", () => {
    for (const q of ["laplace^-1 1/(s^2+1)", "L^-1 1/(s^2+1)", "ℒ⁻¹ 1/(s^2+1)", "inverse laplace 1/(s^2+1)"]) {
      expect(tryLaplace(q)!.lines[0].text).toMatch(/^f\(t\) = sin\(t\)/);
    }
  });
});

describe("5. correct transforms are no longer withheld by a weak numeric check", () => {
  it.each(["sin(50t)", "sin(377t)", "exp(-t)*sin(1000t)", "exp(100t)", "exp(-100t)", "t^8", "t^5 exp(-t) cos(t)"])(
    "%s verifies against the defining integral",
    (f) => {
      const r = fwd(f);
      expect(numericCheck(parseExpr(f), r.F, r.region)).toBe("verified");
    },
  );
  it("a wrong F still fails: a 1% error, a sign error, and an extra term", () => {
    const f = parseExpr("t^2");
    expect(numericCheck(f, parseExpr("2.02/s^3"), 0)).toBe("failed");
    expect(numericCheck(f, parseExpr("-2/s^3"), 0)).toBe("failed");
    expect(numericCheck(f, parseExpr("2/s^3 + (s-1)*(s-2)*(s-3.5)"), 0)).toBe("failed");
  });
});

describe("6–7. impulse and pulse forcings in initial-value problems", () => {
  const solve = (s: string) => {
    const r = solveIvpLaplace(s)!;
    if (!r.solution) throw new Error("refused: " + r.caveats.join(" "));
    return r;
  };
  it("y'' + y = delta(t-1): the impulse response sin(t-1)u(t-1)", () => {
    const r = solve("y'' + y = delta(t-1), y(0)=0, y'(0)=0");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), "sin(t-1) u(t-1)");
  });
  it("y'' + y = delta(t): sin(t)", () => {
    const r = solve("y'' + y = delta(t), y(0)=0, y'(0)=0");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), "sin(t)");
  });
  it("a pulse u(t-1) - u(t-2) is inverted term by term", () => {
    const r = solve("y'' + y = u(t-1) - u(t-2), y(0)=0, y'(0)=0");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), "(1 - cos(t-1)) u(t-1) - (1 - cos(t-2)) u(t-2)");
  });
  it("inverse laplace (exp(-s) - exp(-2s))/s is u(t-1) - u(t-2)", () => {
    sameInT(inv("(exp(-s) - exp(-2s))/s").f, "u(t-1) - u(t-2)");
  });
  it("y''(t) + y(t) = 0 spelled with the argument is read", () => {
    const r = solve("y''(t) + y(t) = 0, y(0)=1, y'(0)=0");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), "cos(t)");
  });
  it("duplicate and surplus initial conditions are named", () => {
    expect(solveIvpLaplace("y' + y = 0, y(0)=1, y(0)=2")!.caveats.join(" ")).toMatch(/given twice/);
    const r = solve("y' + y = 0, y(0)=1, y'(0)=5");
    expect(r.caveats.join(" ")).toMatch(/was not used/);
  });
});

describe("8. delta, step, heaviside stay usable as variables; u(x) = … is a definition", () => {
  it("k*delta parses as a product of variables", () => {
    expect(() => parseExpr("k*delta")).not.toThrow();
    expect(() => parseExpr("step + 1")).not.toThrow();
  });
  it("delta(t-1) is still the impulse", () => {
    sameInS(fwd("delta(t-1)").F, "exp(-s)", 1);
  });
});

describe("9. exact display: no decimals where the answer has none", () => {
  it("sin(2t+1): cos(1) and sin(1) stay symbolic", () => {
    const F = format(fwd("sin(2t+1)").F);
    expect(F).not.toMatch(/0\.84|1\.08/);
    expect(F).toMatch(/cos\(1\)|sin\(1\)/);
  });
  it("u(t-pi) sin(t): π stays π and sin(π) is 0, not 1.2e-16", () => {
    const F = format(fwd("u(t-pi)*sin(t)").F);
    expect(F).not.toMatch(/3141592|e-16/);
    expect(F).toMatch(/pi/);
  });
  it("inverse laplace sqrt(2)/(s^2+2) is sin(sqrt(2) t)", () => {
    const f = format(inv("sqrt(2)/(s^2+2)").f);
    expect(f).not.toMatch(/14142135/);
    sameInT(parseExpr(f), "sin(sqrt(2) t)");
  });
  it("laplace sqrt(2) exp(t) keeps sqrt(2); cos(sqrt(2) t) keeps it in s^2 + 2", () => {
    expect(format(fwd("sqrt(2)*exp(t)").F)).toMatch(/sqrt\(2\)/);
    expect(format(fwd("cos(sqrt(2) t)").F)).not.toMatch(/e\+30/);
    sameInS(fwd("cos(sqrt(2) t)").F, "s/(s^2+2)");
  });
  it("delta(t) carries no 'for s > -Infinity'", () => {
    expect(tryLaplace("laplace delta(t)")!.lines[0].text).not.toMatch(/Infinity/);
  });
  it("delta(t-1)*t^2 is e^{-s}, not 1^2*e^{-s}; cos(t + pi/2) is -1/(s^2+1)", () => {
    expect(format(fwd("delta(t-1)*t^2").F)).not.toMatch(/1\^2/);
    const r = fwd("cos(t + pi/2)");
    expect(format(r.F)).not.toMatch(/cos\(pi|sin\(pi/);
    sameInS(r.F, "-1/(s^2+1)");
  });
});

describe("11–12. the s(s+1) spelling gets a hint; constants and bare delays invert", () => {
  it("'Unknown function s' comes with the fix", () => {
    const v = tryLaplace("inverse laplace 1/(s(s+1))")!;
    expect(v.caveats[0]).toMatch(/write s\*\(…\)/);
  });
  it("ℒ⁻¹{1} = δ(t), ℒ⁻¹{5} = 5δ(t), ℒ⁻¹{e^{-2s}} = δ(t-2)", () => {
    expect(format(inv("1").f)).toBe("delta(t)");
    expect(format(inv("5").f)).toMatch(/5\*delta\(t\)/);
    expect(format(inv("exp(-2s)").f)).toBe("delta(t - 2)");
  });
});

describe("16–17. routing and reductions", () => {
  it("'laplace t^2 for s > 2.5' drops the trailing condition", () => {
    const v = tryLaplace("laplace t^2 for s > 2.5")!;
    expect(v.lines[0].text).toMatch(/^F\(s\) = 2\/s\^3/);
  });
  it("L{t^2} is a spelling", () => {
    expect(tryLaplace("L{t^2}")!.lines[0].text).toMatch(/^F\(s\) = 2\/s\^3/);
  });
  it("sin(t)^3 and cos(t)^4 reduce", () => {
    sameInS(fwd("sin(t)^3").F, "6/((s^2+1)*(s^2+9))");
    sameInS(fwd("cos(t)^4").F, "(s^4 + 16 s^2 + 24)/(s*(s^2+4)*(s^2+16))");
  });
  it("u(t-2) u(t-3) = u(t-3)", () => {
    sameInS(fwd("u(t-2)*u(t-3)").F, "exp(-3s)/s", 1);
  });
  it("exp(a t) and sin(w t) with symbolic constants transform, with the numeric check honestly skipped", () => {
    const a = fwd("exp(a*t)");
    expect(format(a.F)).toMatch(/s - a|a - s|-a \+ s|s-a/);
    expect(a.region).toBeNull();
    const w = fwd("sin(w*t)");
    expect(format(w.F)).toMatch(/w/);
  });
});
