// The three classical PDEs (pde.ts).
//
// All three have exact separated-variable solutions on these domains, so every
// accuracy test compares against a closed form rather than against itself:
//
//   HEAT     u(x,0) = sin πx, ends held at 0   ->  u = e^(−απ²t) sin πx
//   WAVE     u(x,0) = sin πx, u_t(x,0) = 0     ->  u = cos(cπt) sin πx
//   LAPLACE  u = sin(πx) sinh(πy) / sinh(π)    ->  harmonic, so the interior
//            solution must reproduce the boundary function exactly
//
// The most important test in the file is the explicit-heat stability one. At
// r = 0.51 — a completely ordinary-looking input — FTCS does not degrade a
// little, it explodes to 1e300 within a few dozen steps. The assertion is that
// this is prevented and DECLARED, not that it merely happens not to occur.

import { solveHeat, solveWave, solveLaplace, PdeResult } from "../pde";

const got = (r: ReturnType<typeof solveHeat>): PdeResult => {
  if (!r.ok) throw new Error("expected a solution, got: " + r.error);
  return r.result;
};

/** Max |u − exact| over the last reported time level. */
const errAtEnd = (r: PdeResult, exact: (x: number, t: number) => number): number => {
  const k = r.u.length - 1;
  const t = r.t![k];
  let m = 0;
  for (let i = 0; i < r.x.length; i++) m = Math.max(m, Math.abs(r.u[k][i] - exact(r.x[i], t)));
  return m;
};

describe("heat equation against its closed form", () => {
  const f = (x: number) => Math.sin(Math.PI * x);
  const exact = (a: number) => (x: number, t: number) => Math.exp(-a * Math.PI ** 2 * t) * Math.sin(Math.PI * x);

  it("Crank-Nicolson matches e^(−π²t) sin πx", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 80, nt: 400 }));
    expect(errAtEnd(r, exact(1))).toBeLessThan(2e-4);
  });

  it("explicit FTCS matches it too, when it is allowed to run", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 40, nt: 2000, scheme: "explicit" }));
    expect(errAtEnd(r, exact(1))).toBeLessThan(2e-3);
  });

  it("a different diffusivity decays at the right rate", () => {
    const r = got(solveHeat(0.25, 1, 0.4, f, 0, 0, { nx: 80, nt: 400 }));
    expect(errAtEnd(r, exact(0.25))).toBeLessThan(2e-4);
  });

  it("heat DECAYS — the peak must shrink monotonically", () => {
    const r = got(solveHeat(1, 1, 0.2, f, 0, 0, { nx: 60 }));
    const peaks = r.u.map((row) => Math.max(...row));
    for (let k = 1; k < peaks.length; k++) expect(peaks[k]).toBeLessThan(peaks[k - 1] + 1e-12);
    expect(peaks[peaks.length - 1]).toBeLessThan(0.2);
  });

  it("the boundary values are held for all time", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 3, -2, { nx: 40 }));
    for (const row of r.u) {
      expect(row[0]).toBeCloseTo(3, 12);
      expect(row[row.length - 1]).toBeCloseTo(-2, 12);
    }
  });

  it("a constant initial profile between equal ends never changes", () => {
    const r = got(solveHeat(1, 1, 5, () => 7, 7, 7, { nx: 30 }));
    for (const row of r.u) for (const v of row) expect(v).toBeCloseTo(7, 9);
  });
});

describe("explicit stability is enforced, not hoped for", () => {
  const f = (x: number) => Math.sin(Math.PI * x);

  it("r > 1/2 is prevented: Δt is reduced and the result SAYS it was", () => {
    // nx=40 -> dx=0.025, so dt must be <= 3.125e-4. Asking for 100 steps over
    // t=0.1 is dt=1e-3, i.e. r = 1.6 — comfortably unstable.
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 40, nt: 100, scheme: "explicit" }));
    expect(r.stepReduced).toBe(true);
    expect(r.stabilityNumber!).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(r.steps.join(" ")).toMatch(/REDUCED/);
  });

  it("and the answer is still correct after the reduction", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 40, nt: 100, scheme: "explicit" }));
    const k = r.u.length - 1;
    const ex = Math.exp(-(Math.PI ** 2) * r.t![k]) * Math.sin(Math.PI * 0.5);
    const mid = r.u[k][Math.round(r.x.length / 2) - 1];
    expect(Math.abs(mid - ex)).toBeLessThan(5e-3);
  });

  it("NOTHING in any reported level is anywhere near a blow-up", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 40, nt: 100, scheme: "explicit" }));
    for (const row of r.u) for (const v of row) expect(Math.abs(v)).toBeLessThan(2);
  });

  it("when stability would need more steps than the budget, it refuses and explains", () => {
    const r = solveHeat(1, 1, 100, f, 0, 0, { nx: 400, scheme: "explicit" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/stability/);
      expect(r.error).toMatch(/Crank-Nicolson/); // it names the way out
    }
  });

  it("Crank-Nicolson has no such restriction and says so", () => {
    const r = got(solveHeat(1, 1, 0.1, f, 0, 0, { nx: 40, nt: 10 }));
    expect(r.stepReduced).toBe(false);
    expect(r.stabilityNumber!).toBeGreaterThan(0.5); // would be illegal for FTCS
    expect(r.steps.join(" ")).toMatch(/unconditionally stable/);
  });
});

describe("wave equation against its closed form", () => {
  const f = (x: number) => Math.sin(Math.PI * x);
  const g = () => 0;
  const exact = (c: number) => (x: number, t: number) => Math.cos(c * Math.PI * t) * Math.sin(Math.PI * x);

  it("matches cos(cπt) sin πx", () => {
    const r = got(solveWave(1, 1, 0.5, f, g, 0, 0, { nx: 100 }));
    expect(errAtEnd(r, exact(1))).toBeLessThan(5e-3);
  });

  it("a wave does NOT decay — the amplitude is preserved", () => {
    const r = got(solveWave(1, 1, 2, f, g, 0, 0, { nx: 100 }));
    const peaks = r.u.map((row) => Math.max(...row.map(Math.abs)));
    // After a full period the amplitude must still be ~1, not decayed toward 0.
    expect(Math.max(...peaks)).toBeGreaterThan(0.97);
    expect(Math.max(...peaks)).toBeLessThan(1.03);
  });

  it("returns to its initial shape after one period (T = 2L/c = 2)", () => {
    const r = got(solveWave(1, 1, 2, f, g, 0, 0, { nx: 100 }));
    const last = r.u[r.u.length - 1];
    for (let i = 0; i < r.x.length; i += 10) {
      expect(Math.abs(last[i] - f(r.x[i]))).toBeLessThan(5e-3);
    }
  });

  it("an initial velocity moves the string", () => {
    const r = got(solveWave(1, 1, 0.2, () => 0, (x) => Math.sin(Math.PI * x), 0, 0, { nx: 80 }));
    expect(Math.max(...r.u[r.u.length - 1].map(Math.abs))).toBeGreaterThan(0.05);
  });

  it("a Courant number above 1 is clamped, and the reason is stated", () => {
    const r = got(solveWave(1, 1, 0.5, f, g, 0, 0, { nx: 50, courant: 2.5 }));
    expect(r.stabilityNumber).toBeLessThanOrEqual(1);
    expect(r.steps.join(" ")).toMatch(/unconditionally unstable/);
  });

  it("C = 1 is flagged as exact, which is the reason it is the default", () => {
    const r = got(solveWave(1, 1, 0.5, f, g, 0, 0, { nx: 50 }));
    expect(r.stabilityNumber).toBeCloseTo(1, 12);
    expect(r.steps.join(" ")).toMatch(/EXACT/);
  });

  it("reflection off the fixed ends is declared", () => {
    const r = got(solveWave(1, 1, 0.5, f, g, 0, 0, { nx: 50 }));
    expect(r.caveats.join(" ")).toMatch(/REFLECT/);
  });
});

describe("Laplace and Poisson", () => {
  it("reproduces a harmonic boundary function in the interior", () => {
    // sin(πx) sinh(πy)/sinh(π) is harmonic, so the solution IS that function.
    const h = (x: number, y: number) => (Math.sin(Math.PI * x) * Math.sinh(Math.PI * y)) / Math.sinh(Math.PI);
    const r = got(solveLaplace(1, 1, h, { nx: 40, ny: 40 }));
    expect(r.converged).toBe(true);
    let m = 0;
    for (let j = 0; j < r.y!.length; j++) {
      for (let i = 0; i < r.x.length; i++) m = Math.max(m, Math.abs(r.u[j][i] - h(r.x[i], r.y![j])));
    }
    expect(m).toBeLessThan(3e-3);
  });

  it("constant boundary data gives that constant everywhere (the maximum principle)", () => {
    const r = got(solveLaplace(1, 1, () => 5, { nx: 20, ny: 20 }));
    for (const row of r.u) for (const v of row) expect(v).toBeCloseTo(5, 8);
  });

  it("the interior never exceeds the boundary extremes — the maximum principle again", () => {
    const h = (x: number, y: number) => Math.sin(3 * x) + Math.cos(2 * y);
    const r = got(solveLaplace(1, 1, h, { nx: 30, ny: 30 }));
    const edge: number[] = [];
    for (let i = 0; i < r.x.length; i++) { edge.push(r.u[0][i], r.u[r.y!.length - 1][i]); }
    for (let j = 0; j < r.y!.length; j++) { edge.push(r.u[j][0], r.u[j][r.x.length - 1]); }
    const lo = Math.min(...edge), hi = Math.max(...edge);
    for (const row of r.u) for (const v of row) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("Poisson: ∇²u = −2π² sin πx sin πy with zero edges  ->  sin πx sin πy", () => {
    const src = (x: number, y: number) => -2 * Math.PI ** 2 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    const r = got(solveLaplace(1, 1, () => 0, { nx: 40, ny: 40, source: src }));
    const exact = (x: number, y: number) => Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    let m = 0;
    for (let j = 0; j < r.y!.length; j++) {
      for (let i = 0; i < r.x.length; i++) m = Math.max(m, Math.abs(r.u[j][i] - exact(r.x[i], r.y![j])));
    }
    expect(m).toBeLessThan(2e-3);
  });

  it("says whether it converged, and in how many sweeps", () => {
    const r = got(solveLaplace(1, 1, (x) => x, { nx: 20, ny: 20 }));
    expect(r.converged).toBe(true);
    expect(r.iterations!).toBeGreaterThan(0);
    expect(r.steps.join(" ")).toMatch(/Converged in \d+ sweeps/);
  });

  it("an unconverged relaxation is called what it is", () => {
    const r = got(solveLaplace(1, 1, (x, y) => Math.sin(9 * x) * Math.cos(9 * y), { nx: 60, ny: 60, maxIter: 2 }));
    expect(r.converged).toBe(false);
    expect(r.caveats.join(" ")).toMatch(/not a solution/);
  });

  it("an elliptic problem has no time, and the caveat says so", () => {
    const r = got(solveLaplace(1, 1, () => 0, { nx: 10, ny: 10 }));
    expect(r.t).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/no time/);
  });
});

describe("bad input is refused by name, in every equation", () => {
  const f = (x: number) => x;
  it("non-positive or non-finite parameters", () => {
    expect(solveHeat(0, 1, 1, f, 0, 0).ok).toBe(false);
    expect(solveHeat(-1, 1, 1, f, 0, 0).ok).toBe(false);
    expect(solveHeat(Infinity, 1, 1, f, 0, 0).ok).toBe(false);
    expect(solveHeat(1, 0, 1, f, 0, 0).ok).toBe(false);
    expect(solveHeat(1, 1, 0, f, 0, 0).ok).toBe(false);
    expect(solveWave(0, 1, 1, f, () => 0, 0, 0).ok).toBe(false);
    expect(solveWave(1, 1, NaN, f, () => 0, 0, 0).ok).toBe(false);
    expect(solveLaplace(0, 1, () => 0).ok).toBe(false);
    expect(solveLaplace(1, -1, () => 0).ok).toBe(false);
  });
  it("a non-finite initial condition is refused rather than propagated", () => {
    expect(solveHeat(1, 1, 0.1, () => NaN, 0, 0).ok).toBe(false);
    expect(solveWave(1, 1, 0.1, () => Infinity, () => 0, 0, 0).ok).toBe(false);
  });
  it("a non-finite boundary or source is refused", () => {
    expect(solveHeat(1, 1, 0.1, f, NaN, 0).ok).toBe(false);
    expect(solveLaplace(1, 1, () => NaN).ok).toBe(false);
    expect(solveLaplace(1, 1, () => 0, { source: () => Infinity }).ok).toBe(false);
  });
  it("hostile grid sizes are clamped, not obeyed", () => {
    const t0 = Date.now();
    const r = got(solveHeat(1, 1, 0.1, (x) => Math.sin(Math.PI * x), 0, 0, { nx: 1e9, nt: 1e9 }));
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(r.x.length).toBeLessThanOrEqual(401);
  });
});
