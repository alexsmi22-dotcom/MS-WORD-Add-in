// Differential-algebraic equations (dae.ts).
//
// The two assertions that carry this file are both REFUSALS:
//
//   INDEX >= 2 IS REFUSED. The Cartesian pendulum — x'=u, y'=v, u'=-λx,
//   v'=-λy-g, 0=x²+y²-L² — is index 3, because ∂g/∂λ is identically zero: the
//   constraint never mentions λ. An index-1 method run on it does not fail
//   loudly; it can produce a plausible-looking pendulum that drifts steadily off
//   its own constraint. So ∂g/∂z is checked and a singular one is refused BY
//   NAME, with the reformulation that does work.
//
//   INCONSISTENT INITIAL VALUES ARE MOVED, AND SAID SO. A DAE does not accept
//   arbitrary initial data the way an ODE does: (y0, z0) must already satisfy
//   g = 0. z0 is projected onto the constraint and the result reports both the
//   original residual and the point it actually started from.
//
// The accuracy oracle is a linear index-1 system with a closed form, so a
// wrong answer cannot hide behind a plausible curve.

import { solveDae, DaeF, DaeG } from "../dae";

const got = (r: ReturnType<typeof solveDae>) => {
  if (!r.ok) throw new Error("expected a solution, got: " + r.error);
  return r.result;
};

describe("a linear index-1 system with a closed form", () => {
  // y' = -z,  0 = z - y   =>   y' = -y  =>  y = e^-t, z = e^-t.
  const f: DaeF = (_t, _y, z) => [-z[0]];
  const g: DaeG = (_t, y, z) => [z[0] - y[0]];

  it("reproduces y = e^-t", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [1], { steps: 4000 }));
    const last = r.y[r.y.length - 1][0];
    expect(Math.abs(last - Math.exp(-1))).toBeLessThan(2e-4);
  });

  it("z tracks y, because the constraint says it must", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [1], { steps: 500 }));
    for (let k = 0; k < r.t.length; k++) {
      expect(Math.abs(r.z[k][0] - r.y[k][0])).toBeLessThan(1e-9);
    }
  });

  it("the constraint holds to machine precision at EVERY step", () => {
    const r = got(solveDae(f, g, 0, 2, [1], [1], { steps: 800 }));
    expect(r.maxConstraintResidual).toBeLessThan(1e-9);
  });

  it("first-order convergence: halving the step halves the error", () => {
    const exact = Math.exp(-1);
    const e1 = Math.abs(got(solveDae(f, g, 0, 1, [1], [1], { steps: 200 })).y.slice(-1)[0][0] - exact);
    const e2 = Math.abs(got(solveDae(f, g, 0, 1, [1], [1], { steps: 400 })).y.slice(-1)[0][0] - exact);
    expect(e2).toBeLessThan(e1);
    expect(e1 / e2).toBeGreaterThan(1.6); // ~2 for a first-order method
    expect(e1 / e2).toBeLessThan(2.6);
  });

  it("says plainly that it is first-order", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [1]));
    expect(r.caveats.join(" ")).toMatch(/FIRST-order/);
  });
});

describe("a nonlinear constraint", () => {
  // y' = -y·z, 0 = z² − y  (y > 0, so z = √y).
  const f: DaeF = (_t, y, z) => [-y[0] * z[0]];
  const g: DaeG = (_t, y, z) => [z[0] * z[0] - y[0]];

  it("z stays on the constraint, z = sqrt(y), throughout", () => {
    const r = got(solveDae(f, g, 0, 1, [4], [2], { steps: 800 }));
    for (let k = 0; k < r.t.length; k++) {
      expect(Math.abs(r.z[k][0] - Math.sqrt(r.y[k][0]))).toBeLessThan(1e-7);
    }
  });
  it("and the solution actually moves", () => {
    const r = got(solveDae(f, g, 0, 1, [4], [2], { steps: 800 }));
    expect(r.y[r.y.length - 1][0]).toBeLessThan(3.9);
  });
});

describe("index >= 2 is refused, by name", () => {
  it("the Cartesian pendulum (index 3) is rejected because ∂g/∂λ ≡ 0", () => {
    // states y = [x, y, u, v], algebraic z = [lambda]
    const f: DaeF = (_t, Y, Z) => [Y[2], Y[3], -Z[0] * Y[0], -Z[0] * Y[1] - 9.81];
    const g: DaeG = (_t, Y) => [Y[0] * Y[0] + Y[1] * Y[1] - 1];
    const r = solveDae(f, g, 0, 1, [1, 0, 0, 0], [0]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/NOT index 1/);
      expect(r.error).toMatch(/index 2 or higher/);
    }
  });

  it("the refusal names the pendulum and the way out, rather than just failing", () => {
    const f: DaeF = (_t, Y, Z) => [Y[2], Y[3], -Z[0] * Y[0], -Z[0] * Y[1] - 9.81];
    const g: DaeG = (_t, Y) => [Y[0] * Y[0] + Y[1] * Y[1] - 1];
    const r = solveDae(f, g, 0, 1, [1, 0, 0, 0], [0]);
    if (!r.ok) {
      expect(r.error).toMatch(/pendulum/);
      expect(r.error).toMatch(/index reduction/);
      expect(r.error).toMatch(/angle/);
    }
  });

  it("any constraint that ignores z is caught the same way", () => {
    const f: DaeF = () => [1];
    const g: DaeG = (_t, y) => [y[0] - 1]; // no z anywhere
    const r = solveDae(f, g, 0, 1, [1], [0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/singular/);
  });

  it("an index-1 system with the SAME shape is accepted", () => {
    // Same four differential states, but a constraint that does involve z.
    const f: DaeF = (_t, Y, Z) => [Y[2], Y[3], -Z[0] * Y[0], -Z[0] * Y[1]];
    const g: DaeG = (_t, Y, Z) => [Z[0] - (Y[0] * Y[0] + Y[1] * Y[1])];
    const r = solveDae(f, g, 0, 0.5, [1, 0, 0, 1], [1], { steps: 200 });
    expect(r.ok).toBe(true);
  });
});

describe("inconsistent initial values are projected, and reported", () => {
  const f: DaeF = (_t, _y, z) => [-z[0]];
  const g: DaeG = (_t, y, z) => [z[0] - y[0]];

  it("z0 is moved onto the constraint", () => {
    // z0 = 5 is inconsistent: the constraint demands z = y = 1.
    const r = got(solveDae(f, g, 0, 1, [1], [5], { steps: 200 }));
    expect(r.projectedInitial).toBe(true);
    expect(r.z[0][0]).toBeCloseTo(1, 9);
  });

  it("the original residual is reported, not hidden", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [5], { steps: 200 }));
    expect(r.initialResidual).toBeCloseTo(4, 9);
    expect(r.steps.join(" ")).toMatch(/INCONSISTENT/);
  });

  it("the caveat says the entered values were MOVED", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [5], { steps: 200 }));
    expect(r.caveats.join(" ")).toMatch(/MOVED/);
  });

  it("y0 is NOT moved — it is the free data", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [5], { steps: 200 }));
    expect(r.y[0][0]).toBe(1);
  });

  it("consistent values are left alone and say so", () => {
    const r = got(solveDae(f, g, 0, 1, [1], [1], { steps: 200 }));
    expect(r.projectedInitial).toBe(false);
    expect(r.steps.join(" ")).toMatch(/no projection was needed/);
  });

  it("after projection the answer is the same as starting consistent", () => {
    const a = got(solveDae(f, g, 0, 1, [1], [5], { steps: 400 })).y.slice(-1)[0][0];
    const b = got(solveDae(f, g, 0, 1, [1], [1], { steps: 400 })).y.slice(-1)[0][0];
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
});

describe("a 2x2 algebraic block", () => {
  // y' = z1 + z2,  0 = z1 − y,  0 = z2 + y   =>  y' = 0, y constant.
  const f: DaeF = (_t, _y, z) => [z[0] + z[1]];
  const g: DaeG = (_t, y, z) => [z[0] - y[0], z[1] + y[0]];

  it("solves a coupled constraint and keeps y constant", () => {
    const r = got(solveDae(f, g, 0, 3, [2], [2, -2], { steps: 300 }));
    for (const yv of r.y) expect(yv[0]).toBeCloseTo(2, 8);
    expect(r.z[r.z.length - 1][0]).toBeCloseTo(2, 8);
    expect(r.z[r.z.length - 1][1]).toBeCloseTo(-2, 8);
  });
});

describe("bad input is refused by name", () => {
  const f: DaeF = (_t, _y, z) => [-z[0]];
  const g: DaeG = (_t, y, z) => [z[0] - y[0]];

  it("an empty interval", () => {
    const r = solveDae(f, g, 1, 1, [1], [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });
  it("no constraint at all points at the ODE solver", () => {
    const r = solveDae(f, g, 0, 1, [1], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ODE solver/);
  });
  it("no differential equation", () => {
    const r = solveDae(f, g, 0, 1, [], [1]);
    expect(r.ok).toBe(false);
  });
  it("a mismatch between constraints and algebraic unknowns is named", () => {
    const g2: DaeG = (_t, y, z) => [z[0] - y[0], 0]; // 2 equations, 1 unknown
    const r = solveDae(f, g2, 0, 1, [1], [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly as many constraints/);
  });
  for (const bad of [Infinity, NaN]) {
    it(`non-finite initial values (${bad})`, () => {
      expect(solveDae(f, g, 0, 1, [bad], [1]).ok).toBe(false);
      expect(solveDae(f, g, 0, bad, [1], [1]).ok).toBe(false);
    });
  }
  it("equations that go non-finite are reported with the time", () => {
    const bad: DaeF = (t) => [t > 0.5 ? NaN : 1];
    const r = solveDae(bad, g, 0, 1, [1], [1], { steps: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/finite/);
  });
  it("a hostile step count is clamped rather than hanging", () => {
    const t0 = Date.now();
    const r = solveDae(f, g, 0, 1, [1], [1], { steps: 1e9 });
    expect(Date.now() - t0).toBeLessThan(60000);
    expect(r.ok).toBe(true);
  });
});
