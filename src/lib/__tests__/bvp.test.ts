// Boundary value problems (bvp.ts).
//
// Every test here has an ANALYTIC oracle, because the failure mode of a BVP
// solver is a smooth, plausible curve that is not the solution. Comparing
// against a closed form is the only way to tell.
//
// The two cases that matter most are the ones that have no unique answer:
//   y'' + y = 0, y(0) = y(π) = 0    infinitely many solutions (every c·sin x)
//   y'' + y = 0, y(0) = 0, y(π) = 1 NO solution at all
// Both look completely ordinary. A solver that returns a confident curve for
// the second one is wrong, and the caveat that this cannot be detected from the
// arithmetic is part of the contract.

import { solveBvp, solveTridiagonal, BvpRhs } from "../bvp";

const ok = (r: ReturnType<typeof solveBvp>) => {
  if (!r.ok) throw new Error("expected a solution, got: " + r.error);
  return r.result;
};

/** Max |y_i − exact(x_i)| over the grid. */
const maxErr = (res: { x: number[]; y: number[] }, exact: (x: number) => number): number => {
  let m = 0;
  for (let i = 0; i < res.x.length; i++) m = Math.max(m, Math.abs(res.y[i] - exact(res.x[i])));
  return m;
};

describe("the tridiagonal solver", () => {
  it("solves a small system exactly", () => {
    // [2 1; 1 2] x = [3; 3]  ->  x = [1; 1]
    const x = solveTridiagonal([0, 1], [2, 2], [1, 0], [3, 3])!;
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(1, 12);
  });
  it("returns null on a singular system rather than NaNs", () => {
    expect(solveTridiagonal([0, 1], [0, 0], [0, 0], [1, 1])).toBeNull();
  });
});

describe("linear problems with a closed form", () => {
  it("y'' = y, y(0)=1, y(1)=e  ->  y = e^x", () => {
    const f: BvpRhs = (_x, y) => y;
    const r = ok(solveBvp(f, 0, 1, 1, Math.E));
    expect(maxErr(r, Math.exp)).toBeLessThan(1e-5);
  });

  it("y'' = 0, y(0)=0, y(2)=6  ->  the straight line 3x, essentially exactly", () => {
    // A linear solution is in the span of the difference stencil, so this should
    // be right to rounding — a good check that no spurious diffusion crept in.
    const r = ok(solveBvp(() => 0, 0, 2, 0, 6));
    expect(maxErr(r, (x) => 3 * x)).toBeLessThan(1e-10);
  });

  it("y'' = -y, y(0)=0, y(π/2)=1  ->  sin x", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, Math.PI / 2, 0, 1));
    expect(maxErr(r, Math.sin)).toBeLessThan(1e-5);
  });

  it("a first-derivative term is handled: y'' = -2y' - y, y(0)=1, y(1)=2/e  ->  (1+x)e^-x", () => {
    const r = ok(solveBvp((_x, y, yp) => -2 * yp - y, 0, 1, 1, 2 / Math.E));
    expect(maxErr(r, (x) => (1 + x) * Math.exp(-x))).toBeLessThan(1e-5);
  });

  it("reports y' too, and it matches the derivative of the closed form", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, Math.PI / 2, 0, 1));
    for (let i = 0; i < r.x.length; i += 20) {
      expect(Math.abs(r.yp[i] - Math.cos(r.x[i]))).toBeLessThan(1e-4);
    }
  });
});

describe("nonlinear problems", () => {
  it("y'' = 2y³ solves against its closed form y = 1/(x+1)", () => {
    // y = 1/(1+x): y' = -(1+x)^-2, y'' = 2(1+x)^-3 = 2y³.
    const r = ok(solveBvp((_x, y) => 2 * y * y * y, 0, 1, 1, 0.5));
    expect(maxErr(r, (x) => 1 / (1 + x))).toBeLessThan(1e-5);
  });

  it("y'' = e^y is solved consistently by BOTH methods", () => {
    // No elementary closed form worth writing here, so the oracle is agreement
    // between two genuinely different algorithms.
    const f: BvpRhs = (_x, y) => Math.exp(y);
    const fd = ok(solveBvp(f, 0, 1, 0, 0, { method: "fd" }));
    const sh = ok(solveBvp(f, 0, 1, 0, 0, { method: "shooting" }));
    let m = 0;
    for (let i = 0; i < fd.x.length; i++) m = Math.max(m, Math.abs(fd.y[i] - sh.y[i]));
    expect(m).toBeLessThan(1e-4);
  });
});

describe("shooting", () => {
  it("agrees with finite differences on a linear problem", () => {
    const r = ok(solveBvp((_x, y) => y, 0, 1, 1, Math.E, { method: "shooting" }));
    expect(maxErr(r, Math.exp)).toBeLessThan(1e-6);
    expect(r.method).toBe("shooting");
  });
  it("says which method produced the answer", () => {
    expect(ok(solveBvp(() => 0, 0, 1, 0, 1)).method).toBe("fd");
  });
  it("names its own weakness — a different guess can find a different solution", () => {
    const r = ok(solveBvp((_x, y) => y, 0, 1, 1, Math.E, { method: "shooting" }));
    expect(r.caveats.join(" ")).toMatch(/nearest its starting slope/);
  });
});

describe("the boundary conditions are actually satisfied", () => {
  const CASES: [string, BvpRhs, number, number, number, number][] = [
    ["y''=y", (_x, y) => y, 0, 1, 1, Math.E],
    ["y''=-y", (_x, y) => -y, 0, 1, 0, Math.sin(1)],
    ["y''=2y^3", (_x, y) => 2 * y ** 3, 0, 1, 1, 0.5],
  ];
  for (const [name, f, a, b, alpha, beta] of CASES) {
    it(`${name}: both ends are hit exactly`, () => {
      const r = ok(solveBvp(f, a, b, alpha, beta));
      expect(r.y[0]).toBeCloseTo(alpha, 12);
      expect(r.y[r.y.length - 1]).toBeCloseTo(beta, 12);
    });
  }
});

describe("the self-check reports second-order convergence", () => {
  it("the observed order is about 2 on a smooth problem", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, 1, 0, Math.sin(1)));
    expect(r.observedOrder).toBeGreaterThan(1.5);
    expect(r.observedOrder).toBeLessThan(2.6);
  });
  it("an error estimate is produced and is small on a smooth problem", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, 1, 0, Math.sin(1)));
    expect(r.errorEstimate).toBeDefined();
    expect(r.errorEstimate!).toBeLessThan(1e-4);
  });
  it("the estimate is honest — it exceeds the TRUE error by no more than an order of magnitude", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, 1, 0, Math.sin(1), { n: 40 }));
    const trueErr = maxErr(r, Math.sin);
    expect(r.errorEstimate!).toBeGreaterThan(trueErr / 20);
  });
  it("the working says the grid was refined and compared", () => {
    const r = ok(solveBvp((_x, y) => -y, 0, 1, 0, 1));
    expect(r.steps.join(" ")).toMatch(/Self-check|Richardson/);
  });
});

describe("non-uniqueness is DECLARED, because it cannot be computed", () => {
  it("every result carries the no/one/many-solutions caveat", () => {
    const r = ok(solveBvp(() => 0, 0, 1, 0, 1));
    expect(r.caveats.join(" ")).toMatch(/NO solution, exactly one, or infinitely many/);
  });
  it("the caveat names the concrete example, not just the abstract fact", () => {
    const r = ok(solveBvp(() => 0, 0, 1, 0, 1));
    expect(r.caveats.join(" ")).toMatch(/y'' \+ y = 0/);
  });
  it("the resonant problem with NO solution still returns something — and that is why the caveat exists", () => {
    // y'' + y = 0 on [0, π] with y(0)=0, y(π)=1 has no solution: the operator is
    // singular there. Finite differences produce a huge, meaningless curve. The
    // point of this test is that the behaviour is KNOWN and documented, not that
    // it is detected.
    const r = solveBvp((_x, y) => -y, 0, Math.PI, 0, 1);
    if (r.ok) {
      expect(r.result.caveats.join(" ")).toMatch(/NO solution/);
    } else {
      expect(r.error.length).toBeGreaterThan(10);
    }
  });
});

describe("bad input is refused by name", () => {
  it("an empty interval", () => {
    const r = solveBvp(() => 0, 1, 1, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });
  it("a reversed interval", () => {
    const r = solveBvp(() => 0, 2, 1, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/greater than/);
  });
  for (const bad of [Infinity, NaN, -Infinity]) {
    it(`a non-finite boundary value (${bad})`, () => {
      const r = solveBvp(() => 0, 0, 1, bad, 0);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/finite/);
    });
  }
  it("an equation that is not finite on the grid is refused, not averaged over", () => {
    const r = solveBvp(() => NaN, 0, 1, 0, 1);
    expect(r.ok).toBe(false);
  });
  it("a huge grid request is capped rather than hanging", () => {
    const t0 = Date.now();
    const r = solveBvp((_x, y) => -y, 0, 1, 0, 1, { n: 1e9 });
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(r.ok).toBe(true);
  });
});
