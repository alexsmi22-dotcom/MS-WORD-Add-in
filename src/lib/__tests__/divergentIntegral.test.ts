// A divergent integral must be refused, not given a number.
//
// The defect: `integrate("1/((x-1)^2)", 0, 2)` returned **-2**, method
// "exact (symbolic)", caveats **[]**. The integrand is strictly positive
// everywhere on that interval and the integral diverges to +infinity, so the
// answer was not merely imprecise — its SIGN was impossible, and nothing noticed.
//
// The singularity scan had two independent blind spots, and it took both being
// understood to fix it:
//
//   (a) GRID ALIGNMENT. The scan sampled a + (b-a)*i/129, so the pole at x = 1 in
//       [0, 2] needs i = 64.5 and was never visited. The control that proves it:
//       the same pole over [0, 2.58] lands on i = 50 and WAS caught. A pole that
//       is invisible over one interval and visible over another is not a
//       tolerance problem, it is a sampling problem, and no threshold fixes it.
//   (b) STRUCTURAL INVISIBILITY. tan is FINITE at every representable double
//       near pi/2 — Number.isFinite is true at all 130 samples no matter how the
//       grid is spaced. `integrate("tan(x)", 0, 3)` returned 0.01005 as "exact".
//       Extra sampling can never find this one.
//
// So poles are now located from the STRUCTURE of the expression: real roots of a
// polynomial denominator, and the known pole sets of tan/cot/sec/csc. Sampling
// remains only as a backstop for domain errors (sqrt and ln of the wrong sign),
// which really are non-finite and which sampling does find.
//
// The other half of this file matters as much: the fix must not refuse anything
// legitimate. `1/((x-1)^2)` over [2, 3] is a perfectly ordinary integral equal to
// 0.5, and every case in "still exact" below was checked against its true value.

import { integrate, parseExpr, evalAst } from "../solve";

const M = (s: string, a: number, b: number) => integrate(s, a, b)!;

describe("divergent integrals are refused", () => {
  // The comment on each line is the wrong value it used to report as "exact".
  test.each([
    ["1/((x-1)^2)", 0, 2],   // -2, for a strictly positive integrand
    ["1/((x-2)^2)", 0, 4],   // -1, likewise
    ["1/(x-1)", 0, 2],       // 0
    ["tan(x)", 0, 3],        // 0.010057915073692936
    ["1/(x^2-4)", 0, 3],     // pole at x = 2 inside the interval
    ["1/(3*x-6)", 0, 5],     // pole at x = 2, reached through a coefficient
  ] as [string, number, number][])("%s over [%s, %s]", (input, a, b) => {
    const r = M(input, a, b);
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.method).toBe("does not exist on this interval");
    // The refusal must SAY WHY, and must not claim a cause it has not
    // established. A message that is false is its own defect class here.
    expect(r.caveats.join(" ")).toMatch(/POLE|UNDEFINED/);
    expect(r.caveats.join(" ")).toMatch(/fundamental theorem/i);
    // And it should still show what it found, so the user can see the near miss.
    expect(r.antiderivative).toBeTruthy();
  });

  test("the impossible sign is what made this urgent", () => {
    // 1/(x-1)^2 > 0 for every x != 1. A negative area under a positive curve is
    // not a rounding error.
    const r = M("1/((x-1)^2)", 0, 2);
    expect(r.value).not.toBe(-2);
    expect(Number.isNaN(r.value)).toBe(true);
  });

  test("a pole exactly at an endpoint is also improper", () => {
    for (const [s, a, b] of [["1/x", 0, 1], ["1/(x-1)", 1, 2]] as [string, number, number][]) {
      const r = M(s, a, b);
      expect({ s, finite: Number.isFinite(r.value) }).toEqual({ s, finite: false });
    }
  });
});

describe("the grid-alignment control, both ways round", () => {
  // The pole is the same pole. Before the fix, one of these was caught and the
  // other was not, purely because of where 129 evenly spaced samples landed.
  test("[0, 2] and [0, 2.58] now agree that x = 1 is a pole", () => {
    expect(Number.isNaN(M("1/((x-1)^2)", 0, 2).value)).toBe(true);
    expect(Number.isNaN(M("1/((x-1)^2)", 0, 2.58).value)).toBe(true);
  });

  test("moving the pole off any round number does not hide it", () => {
    for (const c of [0.5, 1.25, 1.7320508, 2.4142135, 0.3333333333, 1, 2, 2.9999]) {
      const r = M(`1/(x-${c})`, 0, 3);
      expect({ c, nan: Number.isNaN(r.value) }).toEqual({ c, nan: true });
    }
  });

  test("the NUMERIC path is guarded too, not only the symbolic one", () => {
    // Guarding just the symbolic branch left the same wrong number reachable by
    // another road: 1/(x-0.5) finds no antiderivative rule, falls through to
    // adaptive Simpson, and Simpson straddled the pole at 0.5 without ever
    // sampling it — returning a confident 5.0355 for a divergent integral. Its
    // stock caveat about singularities appears on EVERY numeric integral, so it
    // said nothing about this one.
    const r = M("1/(x-0.5)", 0, 3);
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.method).toBe("does not exist on this interval");
    expect(r.caveats.join(" ")).toMatch(/step straight over a pole|POLE/);
    // and a numeric integral with no pole still returns its approximation
    const ok = M("sin(x)/x", 1, 5);
    expect(ok.method).toBe("adaptive Simpson");
    expect(ok.value).toBeCloseTo(0.6038481, 6);
  });
});

describe("legitimate integrals are still exact", () => {
  // Every expected value here is independent of this code: elementary calculus.
  test.each([
    ["1/((x-1)^2)", 2, 3, 0.5],                     // 1/(2-1) - 1/(3-1)
    ["x^2", 0, 2, 8 / 3],
    ["1/(x^2+1)", 0, 1, Math.PI / 4],
    ["exp(x)", 0, 10, Math.exp(10) - 1],
    ["1/x", 1, 2, Math.LN2],
    ["ln(x)", 1, 2, 2 * Math.LN2 - 1],
    ["sqrt(x)", 0, 4, 16 / 3],
    ["tan(x)", 0, 1, -Math.log(Math.cos(1))],
    ["1/(x^2-4)", 0, 1, Math.log(1 / 3) / 4],        // pole at ±2, outside [0,1]
    ["1/(3*x-6)", 0, 1, Math.log(1 / 2) / 3],        // pole at 2, outside [0,1]
    ["sin(x)", 0, Math.PI, 2],
  ])("%s over [%s, %s]", (input, a, b, expected) => {
    const r = M(input as string, a as number, b as number);
    expect(r.method).toBe("exact (symbolic)");
    expect(r.value).toBeCloseTo(expected as number, 9);
  });

  test("a sign-changing integrand that legitimately integrates to zero", () => {
    // The sign-contradiction backstop must not fire here: sin over a full period
    // is genuinely 0, and the integrand takes both signs.
    const r = M("sin(x)", 0, 4 * Math.PI);
    expect(r.method).toBe("exact (symbolic)");
    expect(r.value).toBeCloseTo(0, 9);
  });

  test("a negative integrand integrating to a negative value is not refused", () => {
    const r = M("-1/(x^2+1)", 0, 1);
    expect(r.value).toBeCloseTo(-Math.PI / 4, 9);
  });

  test("reversed limits still work and keep their sign", () => {
    expect(M("x^2", 2, 0).value).toBeCloseTo(-8 / 3, 9);
    expect(M("1/(x^2+1)", 1, 0).value).toBeCloseTo(-Math.PI / 4, 9);
  });
});

describe("it stays fast enough for a task pane", () => {
  // The pane recomputes on every keystroke. Root-finding over a 2048-point grid
  // per denominator is the cost added here; this pins it.
  test("a high-degree denominator does not stall", () => {
    const t0 = Date.now();
    for (const s of [
      "1/(x^6+x^5+x^4+x^3+x^2+x+1)",
      "1/((x^2+1)*(x^2+2)*(x^2+3))",
      "1/(x^8-1)",
      "tan(3*x+1)",
    ]) {
      integrate(s, 0, 1);
      integrate(s, -100, 100);
    }
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  test("an enormous trig coefficient does not enumerate billions of poles", () => {
    const t0 = Date.now();
    integrate("tan(1e12*x)", 0, 1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("a zero of the denominator is NOT necessarily a pole", () => {
  // The first version of this fix reported every real root of a denominator
  // inside the interval and refused five CORRECT integrals. Trading a wrong
  // number for a refused correct one is a smaller harm, not an acceptable one —
  // so the boundary between the two cases is pinned here in both directions.
  //
  // The discriminator: at a genuine pole of order n >= 1, |f| grows like h^-n, so
  // shrinking h by 1e6 multiplies |f| by at least 1e6. At a removable singularity
  // |f| converges to its limit and the ratio is about 1. Three orders of
  // magnitude of daylight, not a tuned threshold.
  test.each([
    ["(x^2-1)/(x-1)", 0, 2, 4],        // integrand IS x + 1; root at 1 is removable
    ["(x^2-1)/(x+1)", -2, 0, -4],      // and on the other side of zero
    ["(x^2-4)/(x-2)", 0, 3, 10.5],     // 129 samples land EXACTLY on x = 2 here
    ["x/x", 0, 2, 2],                  // undefined at the ENDPOINT, which is fine
    ["(x-2)/(x-2)", 0, 4, 4],
  ] as [string, number, number, number][])("%s over [%s, %s] = %s", (input, a, b, expected) => {
    const r = M(input, a, b);
    expect(r.value).toBeCloseTo(expected, 9);
    expect(r.method).toBe("exact (symbolic)");
  });

  test("an endpoint the integrand misses is not a reason to refuse", () => {
    // x/x is undefined at x = 0 and the integral over [0, 2] is still 2. Before
    // the interior test, the sampled scan reported the endpoint as fatal.
    expect(M("x/x", 0, 2).value).toBeCloseTo(2, 9);
    expect(M("(x^2-1)/(x-1)", 1, 3).value).toBeCloseTo(6, 9); // endpoint AT the root
  });

  test("the genuine cases are all still refused", () => {
    // The removable test must not have loosened the fix it protects.
    for (const [s, a, b] of [
      ["1/(x-1)", 0, 2], ["1/((x-1)^2)", 0, 2], ["tan(x)", 0, 3],
      ["1/(x-0.5)", 0, 3], ["1/(x^2-4)", 0, 3],
      ["sqrt(x)^2", -1, 1], ["ln(x)", -1, 2],
    ] as [string, number, number][]) {
      expect({ s, nan: Number.isNaN(M(s, a, b).value) }).toEqual({ s, nan: true });
    }
  });
});

describe("the worked examples we PUBLISH still work", () => {
  // engineeringDocs.test.ts checks that every <code> fragment in the help panel
  // round-trips through its real parser. That cannot catch this: a now-refused
  // integral parses perfectly. So a guard that tightens a refusal can silently
  // falsify a published example, and the landing page is live the moment it is
  // pushed. These are the exact examples in src/lib/examples.ts and
  // landing/*.html — if one is changed there, change it here.
  test.each([
    ["x^2", 0, 3, 9],
    ["x*exp(x)", 0, 1, 1],
    ["ln(x)", 1, 2, 2 * Math.LN2 - 1],
    ["1/(x^2+4)", 0, 1, Math.atan(0.5) / 2],
  ] as [string, number, number, number][])("%s over [%s, %s] = %s", (input, a, b, expected) => {
    const r = M(input, a, b);
    expect(r.method).toBe("exact (symbolic)");
    expect(r.value).toBeCloseTo(expected, 9);
  });

  test("the one the landing page says has NO integral still says so", () => {
    // landing/manual.html: "ln(x) from -1 to 2 has no integral, and it says so
    // rather than returning a number." That sentence has to stay true.
    const r = M("ln(x)", -1, 2);
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/UNDEFINED|POLE/);
  });
});

describe("the printed antiderivative is the function that was integrated", () => {
  // It used to be rounded to 6 DECIMAL PLACES, so
  // integrate("1/(x^2+x+1)", 0, 1).antiderivative printed
  // `1.154701*atan(1.154701*x + 0.57735)` where the coefficient is
  // 2/sqrt(3) = 1.1547005383792515. The `value` was exact; the closed form shown
  // was not. Anyone copying that expression out of their document — which is the
  // whole point of showing it — got a different function from the one integrated.
  //
  // The test is a ROUND TRIP, not a string comparison: re-parse what was printed,
  // evaluate it at the two limits, and require the difference to reproduce the
  // reported value. That is the property a reader actually depends on, and a
  // string check would pass on any consistent rounding.
  test.each([
    ["1/(x^2+x+1)", 0, 1],
    ["1/(x^2+4)", 0, 1],
    ["1/(x^2-2)", 2, 5],
    ["exp(2*x)", 0, 1],
    ["x*exp(x)", 0, 1],
    ["1/(x^2+1)", 0, 1],
    ["sin(3*x)", 0, 1],
    ["ln(x)", 1, 2],
  ] as [string, number, number][])("%s over [%s, %s] re-parses to its own value", (f, a, b) => {
    const r = M(f, a, b);
    expect(r.antiderivative).toBeTruthy();
    const F = parseExpr(r.antiderivative!);
    const viaString = evalAst(F, { x: b }) - evalAst(F, { x: a });
    expect(viaString).toBeCloseTo(r.value, 10);
  });

  test("the coefficient really is 2/sqrt(3), to the precision shown", () => {
    // An external anchor: 2/sqrt(3) = 1.1547005383792515.
    const F = M("1/(x^2+x+1)", 0, 1).antiderivative!;
    const m = /^([\d.]+)\*atan/.exec(F);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeCloseTo(2 / Math.sqrt(3), 11);
  });
});

describe("C0: a removable singularity is integrated, a pole is still refused", () => {
  // Closed in v2.46.0 by composite Gauss-Legendre, whose nodes lie strictly inside
  // each panel — so an interval endpoint or panel boundary is NEVER evaluated, and a
  // point where the integrand is merely undefined is simply never visited.
  //
  // Two earlier attempts averaged two neighbours across the singularity instead. The
  // first was reverted for supposedly giving 0.9728 against "a true 0.9896" for
  // (1-cos x)/x^2 over [-1,1] — and that reference figure was WRONG. The series
  // (1-cos x)/x^2 = 1/2 - x^2/24 + x^4/720 - ... gives 2*(1/2 - 1/72 + 1/3600 - ...)
  // = 0.9727708, so the reverted fix had been correct all along. Using an unverified
  // hand figure as the oracle to judge a fix is what went wrong, and it cost a working
  // one. Every expected value below is derived, not guessed:
  //
  //   integral of sin(x)/x over [0,1]  = Si(1) = 0.9460830704
  //   integral of (1-cos x)/x^2 over [0,1] = 1/2 - 1/72 + 1/3600 - 1/282240 ...
  //   integral of (exp(x)-1)/x over [0,1]  = Ein-type series, sum 1/(n*n!) = 1.3179022
  test.each([
    ["sin(x)/x", -1, 1, 2 * 0.9460830703671830],
    ["sin(x)/x", 0, 1, 0.9460830703671830],
    ["sin(x)/x", -1, 0, 0.9460830703671830],
    ["(1-cos(x))/x^2", 0, 1, 0.4863853764],
    ["(1-cos(x))/x^2", -1, 1, 2 * 0.4863853764],
    ["(exp(x)-1)/x", 0, 1, 1.3179021514544038],
  ] as [string, number, number, number][])("%s over [%s, %s]", (f, a, b, want) => {
    const r = M(f, a, b);
    expect(Number.isFinite(r.value)).toBe(true);
    expect(Math.abs(r.value / want - 1)).toBeLessThan(1e-6);
    expect(r.method).toBe("Gauss-Legendre (removable singularity)");
    // It must SAY the integrand is undefined somewhere, not quietly hand over a number.
    expect(r.caveats.join(" ")).toMatch(/removable singularity/);
  });

  test("a POLE at an endpoint is still refused — the trap in this approach", () => {
    // Gauss-Legendre never evaluates an endpoint, which is exactly why it can rescue a
    // removable singularity there — and exactly why it would otherwise hand back a
    // confident finite number for a divergent integral. The structural pole search
    // only reports poles strictly INSIDE, so endpoints needed their own check. Caught
    // by the existing test above, not by foresight.
    for (const [f, a, b] of [
      ["1/x", 0, 1], ["1/(x-1)", 1, 2], ["1/x^2", 0, 1],
      ["1/(2-x)", 0, 2], ["1/sqrt(x)^2", 0, 1],
    ] as [string, number, number][]) {
      const r = M(f, a, b);
      expect({ f, finite: Number.isFinite(r.value) }).toEqual({ f, finite: false });
    }
  });

  test("interior poles and domain errors are unaffected", () => {
    for (const [f, a, b] of [
      ["1/(x-1)", 0, 2], ["1/((x-1)^2)", 0, 2], ["tan(x)", 0, 3],
      ["1/x", -1, 1], ["ln(x)", -1, 2], ["sqrt(x)^2", -1, 1], ["1/(x-0.5)", 0, 3],
    ] as [string, number, number][]) {
      const r = M(f, a, b);
      expect({ f, nan: Number.isNaN(r.value) }).toEqual({ f, nan: true });
    }
  });

  test("ordinary numeric integrals still use adaptive Simpson", () => {
    // The new rule is confined to the previously-refused path, so nothing that already
    // had an answer changes how it is computed.
    for (const [f, a, b] of [["sin(x)/x", 1, 5], ["x^x", 0, 1], ["exp(-x^2)", 0, 1]] as [string, number, number][]) {
      expect({ f, m: M(f, a, b).method }).toEqual({ f, m: "adaptive Simpson" });
    }
  });

  test("the value carries convergence evidence, not a promise", () => {
    // Refined until two panel counts agree to eleven significant figures; the caveat
    // says so, because "numeric integral" alone tells the reader nothing about whether
    // it converged.
    const r = M("sin(x)/x", -1, 1);
    expect(r.caveats.join(" ")).toMatch(/two different panel counts agreed/);
  });
});
