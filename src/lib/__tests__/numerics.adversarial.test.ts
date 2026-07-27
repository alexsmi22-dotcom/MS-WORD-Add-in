// Adversarial pass on the BVP / PDE / DAE solvers.
//
// These three shipped in v2.19.0 with 84 tests of their own and three real bugs
// that none of those tests could have found, because they were tests written
// alongside the implementation — they covered what the author thought of.
//
// The generic whole-library fuzzer could not find them either, and the reason is
// worth recording: it fills at most three arguments, and every solver here takes
// a CALLBACK first. Any hostile scalar in argument one threw at validation and
// the loops inside were never entered. "Zero hangs" from that run was not
// evidence of anything. Reaching these required a probe that passes well-formed
// callbacks and hostile everything-else — plus callbacks that are themselves
// hostile, which is exactly what a user produces by typing a bad formula.
//
// The three, all shipped:
//
//   solveLaplace(nx = Infinity) ran for 91 SECONDS. The clamp was
//   Math.min(nx, 400), which bounds MEMORY and not TIME — and worse, it made
//   nonsense input buy the LARGEST grid on offer. Cost is ~4n³ (SOR needs ~4n
//   sweeps of n² work): 48 ms at n=40, 3.3 s at n=160, 8.0 s at n=200.
//
//   nx = NaN threw "Invalid array length". Math.floor(NaN) is NaN,
//   Math.min(NaN, 400) is NaN, and new Array(NaN) throws — an uncaught
//   exception rather than a refusal.
//
//   A callback that THROWS escaped the solver. A formula that is fine at the
//   left endpoint but fails elsewhere produced an unhandled exception rather
//   than an error message naming the equation.
//
// Every timing assertion here is the point of the file, not decoration: in a
// task pane an unbounded loop is a frozen Word, with the user's document behind
// it and no way back.

import { solveBvp } from "../bvp";
import { solveHeat, solveWave, solveLaplace } from "../pde";
import { solveDae } from "../dae";
import { gridSize } from "../numguard";

/** Every solver call must return inside this, however hostile the input. */
const BUDGET_MS = 15000;

const HOSTILE = [Infinity, -Infinity, NaN, 1e308, -1e308, Number.MAX_SAFE_INTEGER, 0, -1];

const within = (label: string, fn: () => unknown): unknown => {
  const t0 = Date.now();
  const r = fn();
  const ms = Date.now() - t0;
  expect(`${label}: ${ms < BUDGET_MS ? "fast" : `TOO SLOW ${ms}ms`}`).toBe(`${label}: fast`);
  return r;
};

describe("gridSize is a real bound, unlike Math.min", () => {
  it("a non-finite request falls back to the DEFAULT, not the maximum", () => {
    // This is the direction that matters: nonsense input must be CHEAP.
    expect(gridSize(Infinity, 40, 3, 200)).toBe(40);
    expect(gridSize(NaN, 40, 3, 200)).toBe(40);
    expect(gridSize(-Infinity, 40, 3, 200)).toBe(40);
    expect(gridSize(undefined, 40, 3, 200)).toBe(40);
  });
  it("a real request is honoured, and clamped at the ends", () => {
    expect(gridSize(80, 40, 3, 200)).toBe(80);
    expect(gridSize(1e9, 40, 3, 200)).toBe(200);
    expect(gridSize(1, 40, 3, 200)).toBe(3);
    expect(gridSize(-5, 40, 3, 200)).toBe(3);
  });
  it("never returns something new Array() would reject", () => {
    for (const v of HOSTILE) {
      const n = gridSize(v, 40, 3, 200);
      expect(`${v}: ${Number.isInteger(n) && n >= 3 && n <= 200}`).toBe(`${v}: true`);
      expect(() => new Array(n)).not.toThrow();
    }
  });
});

describe("a hostile grid size never throws and never hangs", () => {
  for (const v of HOSTILE) {
    it(`bvp n=${v}`, () => {
      const r = within(`bvp n=${v}`, () => solveBvp((_x, y) => -y, 0, 1, 0, 1, { n: v })) as { ok: boolean };
      expect(r.ok).toBe(true);
    });
    it(`heat nx=${v} / nt=${v}`, () => {
      within(`heat nx=${v}`, () => solveHeat(1, 1, 0.1, (x) => x, 0, 0, { nx: v }));
      within(`heat nt=${v}`, () => solveHeat(1, 1, 0.1, (x) => x, 0, 0, { nt: v }));
    });
    it(`wave nx=${v} / C=${v}`, () => {
      within(`wave nx=${v}`, () => solveWave(1, 1, 1, (x) => x, () => 0, 0, 0, { nx: v }));
      within(`wave C=${v}`, () => solveWave(1, 1, 1, (x) => x, () => 0, 0, 0, { courant: v }));
    });
    it(`laplace nx=${v}`, () => {
      within(`laplace nx=${v}`, () => solveLaplace(1, 1, (x) => x, { nx: v, ny: v }));
    });
    it(`dae steps=${v}`, () => {
      within(`dae steps=${v}`, () =>
        solveDae(
          (_t, _y, z) => [-z[0]],
          (_t, y, z) => [z[0] - y[0]],
          0, 1, [1], [1], { steps: v }
        ));
    });
  }
});

describe("the elliptic solve is bounded in TIME, not only in memory", () => {
  it("the largest grid it will build still finishes in a few seconds", () => {
    const r = within("laplace max grid", () =>
      solveLaplace(1, 1, (x, y) => Math.sin(Math.PI * x) * y, { nx: 1e9, ny: 1e9 })) as { ok: boolean };
    expect(r.ok).toBe(true);
  });
  it("and it still CONVERGES at that size — the bound did not cost correctness", () => {
    const r = solveLaplace(1, 1, (x, y) => (Math.sin(Math.PI * x) * Math.sinh(Math.PI * y)) / Math.sinh(Math.PI), {
      nx: 1e9, ny: 1e9,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.converged).toBe(true);
  });
  it("a run stopped by the work budget says so instead of looking converged", () => {
    const r = solveLaplace(1, 1, (x, y) => Math.sin(9 * x) * Math.cos(9 * y), { nx: 120, ny: 120, maxIter: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.converged).toBe(false);
      expect(r.result.caveats.join(" ")).toMatch(/not a solution/);
    }
  });
});

describe("a user callback that throws is reported, not propagated", () => {
  const boom = () => {
    throw new Error("unknown function qux");
  };

  it("BVP names the equation as the problem", () => {
    const r = solveBvp(boom, 0, 1, 0, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be evaluated/);
  });
  it("BVP by shooting too", () => {
    const r = solveBvp(boom, 0, 1, 0, 1, { method: "shooting" });
    expect(r.ok).toBe(false);
  });
  it("heat, wave and Laplace", () => {
    expect(solveHeat(1, 1, 0.1, boom, 0, 0).ok).toBe(false);
    expect(solveWave(1, 1, 1, boom, () => 0, 0, 0).ok).toBe(false);
    expect(solveWave(1, 1, 1, (x) => x, boom, 0, 0).ok).toBe(false);
    expect(solveLaplace(1, 1, boom).ok).toBe(false);
    expect(solveLaplace(1, 1, () => 0, { source: boom }).ok).toBe(false);
  });
  it("DAE, in both the differential part and the constraint", () => {
    const g = (_t: number, y: number[], z: number[]) => [z[0] - y[0]];
    const f = (_t: number, _y: number[], z: number[]) => [-z[0]];
    expect(solveDae(boom as never, g, 0, 1, [1], [1]).ok).toBe(false);
    expect(solveDae(f, boom as never, 0, 1, [1], [1]).ok).toBe(false);
  });
  it("the original message survives, so the user can fix the formula", () => {
    const r = solveBvp(boom, 0, 1, 0, 1);
    if (!r.ok) expect(r.error).toMatch(/unknown function qux/);
  });
  it("a callback that throws only PART WAY along is still caught", () => {
    // The classic case: the formula is fine at the left endpoint, which is the
    // only place a cheap up-front probe would look.
    const late = (x: number) => {
      if (x > 0.5) throw new Error("late failure");
      return 1;
    };
    expect(solveHeat(1, 1, 0.1, late, 0, 0).ok).toBe(false);
    const r = solveBvp((x) => late(x), 0, 1, 0, 1);
    expect(r.ok).toBe(false);
  });
});

describe("a callback returning non-finite values is refused, not integrated", () => {
  const CASES: [string, (x: number) => number][] = [
    ["always NaN", () => NaN],
    ["always Infinity", () => Infinity],
    ["NaN past the midpoint", (x) => (x > 0.5 ? NaN : 1)],
    ["Infinity past the midpoint", (x) => (x > 0.5 ? Infinity : 1)],
  ];
  for (const [name, cb] of CASES) {
    it(`heat, ${name}`, () => {
      const r = within(`heat ${name}`, () => solveHeat(1, 1, 0.1, cb, 0, 0)) as { ok: boolean };
      expect(r.ok).toBe(false);
    });
    it(`wave, ${name}`, () => {
      const r = within(`wave ${name}`, () => solveWave(1, 1, 1, cb, () => 0, 0, 0)) as { ok: boolean };
      expect(r.ok).toBe(false);
    });
    it(`bvp, ${name}`, () => {
      const r = within(`bvp ${name}`, () => solveBvp((x) => cb(x), 0, 1, 0, 1)) as { ok: boolean };
      expect(r.ok).toBe(false);
    });
  }
});

describe("pathological but legitimate problems still terminate", () => {
  it("a wildly oscillating right-hand side", () => {
    within("bvp oscillating", () => solveBvp((x) => Math.sin(1e6 * x) * 1e6, 0, 1, 0, 1));
  });
  it("a very stiff right-hand side", () => {
    within("bvp stiff", () => solveBvp((_x, y) => -1e12 * y, 0, 1, 1, 1));
  });
  it("an unstable problem over a long interval, by both methods", () => {
    within("bvp unstable fd", () => solveBvp((_x, y) => 1e4 * y, 0, 50, 1, 1));
    within("bvp unstable shooting", () => solveBvp((_x, y) => 1e4 * y, 0, 50, 1, 1, { method: "shooting" }));
  });
  it("an enormous diffusivity", () => {
    within("heat huge alpha", () => solveHeat(1e12, 1, 0.1, (x) => Math.sin(x), 0, 0));
  });
  it("a DAE whose constraint goes singular part way along", () => {
    const r = within("dae singular mid-run", () =>
      solveDae(
        (_t, y) => [y[0]],
        (t, _y, z) => [(1 - 2 * t) * z[0]],
        0, 1, [1], [1], { steps: 200 }
      )) as { ok: boolean };
    // Either it refuses or it stops early — both are honest; a hang is not.
    expect(typeof r.ok).toBe("boolean");
  });
  it("a DAE with twenty coupled states", () => {
    const n = 20;
    const r = within("dae 20 states", () =>
      solveDae(
        (_t, _y, z) => Array.from({ length: n }, (_, i) => -z[i]),
        (_t, y, z) => Array.from({ length: n }, (_, i) => z[i] - y[i]),
        0, 1, new Array(n).fill(1), new Array(n).fill(1), { steps: 200 }
      )) as { ok: boolean };
    expect(r.ok).toBe(true);
  });
  it("integrating a DAE backwards in time", () => {
    const r = within("dae backwards", () =>
      solveDae(
        (_t, _y, z) => [-z[0]],
        (_t, y, z) => [z[0] - y[0]],
        1, 0, [1], [1], { steps: 200 }
      )) as { ok: boolean };
    expect(r.ok).toBe(true);
  });
});

describe("the ordinary answers survived all of the above", () => {
  it("BVP still solves y'' = -y to sin x", () => {
    const r = solveBvp((_x, y) => -y, 0, Math.PI / 2, 0, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      let m = 0;
      for (let i = 0; i < r.result.x.length; i++) {
        m = Math.max(m, Math.abs(r.result.y[i] - Math.sin(r.result.x[i])));
      }
      expect(m).toBeLessThan(1e-5);
    }
  });
  it("heat still decays at the analytic rate", () => {
    const r = solveHeat(1, 1, 0.1, (x) => Math.sin(Math.PI * x), 0, 0, { nx: 80, nt: 400 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const k = r.result.u.length - 1;
      const t = r.result.t![k];
      const mid = Math.round((r.result.x.length - 1) / 2);
      const exact = Math.exp(-(Math.PI ** 2) * t) * Math.sin(Math.PI * r.result.x[mid]);
      expect(Math.abs(r.result.u[k][mid] - exact)).toBeLessThan(1e-3);
    }
  });
  it("Laplace still reproduces a harmonic boundary function", () => {
    const h = (x: number, y: number) => (Math.sin(Math.PI * x) * Math.sinh(Math.PI * y)) / Math.sinh(Math.PI);
    const r = solveLaplace(1, 1, h, { nx: 40, ny: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      let m = 0;
      for (let j = 0; j < r.result.y!.length; j++) {
        for (let i = 0; i < r.result.x.length; i++) {
          m = Math.max(m, Math.abs(r.result.u[j][i] - h(r.result.x[i], r.result.y![j])));
        }
      }
      expect(m).toBeLessThan(3e-3);
    }
  });
  it("the DAE still reproduces e^-t", () => {
    const r = solveDae(
      (_t, _y, z) => [-z[0]],
      (_t, y, z) => [z[0] - y[0]],
      0, 1, [1], [1], { steps: 4000 }
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.result.y.slice(-1)[0][0] - Math.exp(-1))).toBeLessThan(2e-4);
  });
});
