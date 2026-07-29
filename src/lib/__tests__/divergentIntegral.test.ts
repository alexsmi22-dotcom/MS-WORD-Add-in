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

import { integrate } from "../solve";

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
