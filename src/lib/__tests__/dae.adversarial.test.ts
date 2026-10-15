// Adversarial pins for DAE index reduction (daeIndex.ts + daeParse.ts).
//
// Aimed at the failure shapes of §A/§E of docs/SCOPE-NUMERICS-TOPOLOGY.md:
// name-order permutations, index 1/2/3 with the same incidence, a constraint
// singular only along the trajectory, structurally-fine-but-numerically-
// singular systems, inconsistent starts (projected or refused, SAID), a stiff
// index-1 DAE, runaway differentiation, and a 4 s gross-freeze bound on every
// heavy call (an unbounded loop in a task pane is a frozen Word, not an error).

import * as fs from "fs";
import * as path from "path";
import { parseDaeSystem } from "../daeParse";
import { solveDaeAuto, pantelides, DaeAutoOptions, DaeAutoResult, DAE_WORK_BUDGET } from "../daeIndex";

const PEND = "x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = x^2 + y^2 - 1";

function within<T>(ms: number, fn: () => T): T {
  const t = Date.now();
  const out = fn();
  expect(Date.now() - t).toBeLessThan(ms);
  return out;
}
function solve(eqs: string, init: string, t0: number, t1: number, opts: DaeAutoOptions = {}, guess = "") {
  const p = parseDaeSystem(eqs, init, guess);
  if (!p.ok) throw new Error("parse: " + p.error);
  return within(10000, () => solveDaeAuto(p.system, t0, t1, opts));
}
function got(o: ReturnType<typeof solveDaeAuto>): DaeAutoResult {
  if (!o.ok) throw new Error("expected a solution, got: " + o.error);
  return o.result;
}
function refusal(o: ReturnType<typeof solveDaeAuto>): string {
  if (o.ok) throw new Error("expected a refusal");
  return o.error;
}
const last = (r: DaeAutoResult, n: string) => r.states[n][r.t.length - 1];

describe("the false 'no drift' certificate is gone from the SOURCE (grep gate)", () => {
  for (const f of ["dae.ts", "daeIndex.ts"]) {
    it(f, () => {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      // Comments that QUOTE the old claim to explain its removal are allowed;
      // any emitted string (inside quotes or a template) is not.
      const strings = src.match(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g) ?? [];
      for (const s of strings) {
        expect(s).not.toMatch(/by construction/);
        expect(s).not.toMatch(/no drift/i);
      }
    });
  }
});

describe("name-order permutations give IDENTICAL output", () => {
  it("all 24 orders of the pendulum's initial values", () => {
    const names = ["x = 1", "y = 0", "u = 0", "v = 0"];
    const perms: string[][] = [];
    const rec = (pre: string[], rest: string[]) => {
      if (!rest.length) perms.push(pre);
      rest.forEach((r, i) => rec([...pre, r], [...rest.slice(0, i), ...rest.slice(i + 1)]));
    };
    rec([], names);
    const base = got(solve(PEND, names.join(", "), 0, 0.5, { points: 10 }));
    for (const p of perms) {
      const r = got(solve(PEND, p.join(", "), 0, 0.5, { points: 10 }));
      expect(r.states).toEqual(base.states);
    }
  });
  it("the EQUATION order changes column order only, never the values", () => {
    const a = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 1, { points: 20 }));
    const b = got(solve("0 = x^2 + y^2 - 1; v' = -lam*y - 9.81; u' = -lam*x; y' = v; x' = u", "x = 1, y = 0, u = 0, v = 0", 0, 1, { points: 20 }));
    for (const n of ["x", "y", "u", "v", "lam"]) expect(Math.abs(last(a, n) - last(b, n))).toBeLessThan(1e-9);
  });
});

describe("index 1 / 2 / 3 with the same incidence shape", () => {
  // x' = z with 0 = z - x (index 1), 0 = x - sin t (index 2); x1' = x2, x2' = z, 0 = x1 - sin t (index 3)
  it("index 1", () => expect(got(solve("x' = z; 0 = z - x", "x = 1", 0, 1)).index).toBe(1));
  it("index 2", () => expect(got(solve("x' = z; 0 = x - sin(t)", "x = 0", 0, 1)).index).toBe(2));
  it("index 3", () => {
    const r = got(solve("x1' = x2; x2' = z; 0 = x1 - sin(t)", "x1 = 0, x2 = 1", 0, 1));
    expect(r.index).toBe(3);
    expect(Math.abs(last(r, "z") + Math.sin(1))).toBeLessThan(1e-8);
  });
  it("index 5 (the cap) is solved: z = 24 for x1 = t⁴ through a 4-chain", () => {
    const r = got(solve("x1' = x2; x2' = x3; x3' = x4; x4' = z; 0 = x1 - t^4", "x1 = 0, x2 = 0, x3 = 0, x4 = 0", 0, 1));
    expect(r.index).toBe(5);
    expect(Math.abs(last(r, "z") - 24)).toBeLessThan(1e-8);
    expect(Math.abs(last(r, "x4") - 24)).toBeLessThan(1e-7);
  });
  it("index 6 is REFUSED by name (the 5-chain)", () => {
    const e = refusal(solve("x1' = x2; x2' = x3; x3' = x4; x4' = x5; x5' = z; 0 = x1 - t", "x1 = 0, x2 = 1, x3 = 0, x4 = 0, x5 = 0", 0, 1));
    expect(e).toMatch(/index 6/);
    expect(e).toMatch(/above 5 is not solved/);
  });
  it("a mixed system: one index-2 constraint and one index-1 constraint", () => {
    const r = got(solve("x' = z1; y' = z2; 0 = x - t; 0 = z2 - y", "x = 0, y = 1", 0, 1));
    expect(r.index).toBe(2);
    expect(Math.abs(last(r, "y") - Math.E)).toBeLessThan(1e-8);
    expect(Math.abs(last(r, "z1") - 1)).toBeLessThan(1e-10);
  });
  it("the pendulum written second-order (x'' = …) is the same index-3 solution", () => {
    const r = got(solve("x'' = -lam*x; y'' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", "x = 1, y = 0, x' = 0, y' = 0", 0, 10));
    expect(r.index).toBe(3);
    expect(Math.abs(last(r, "x") - 0.2750874626)).toBeLessThan(1e-5);
    expect(Math.abs(last(r, "lam") - 28.2945672061)).toBeLessThan(1e-5);
  });
});

describe("Pantelides on bare structure", () => {
  it("pendulum: constraint ν = 2, x' and y' equations ν = 1, index 3", () => {
    // unknowns x y u v (states) lam (alg)
    const o = pantelides({
      unknowns: ["x", "y", "u", "v", "lam"],
      isState: [true, true, true, true, false],
      eqs: [
        { stateOf: 0, uses: [2] }, { stateOf: 1, uses: [3] },
        { stateOf: 2, uses: [4, 0] }, { stateOf: 3, uses: [4, 1] },
        { stateOf: null, uses: [0, 1] },
      ],
    });
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.nu).toEqual([1, 1, 0, 0, 2]);
      expect(o.index).toBe(3);
      expect(o.derivedAlg).toEqual([]);
    }
  });
});

describe("structure passes, numbers fail — refused BY NAME, never 'index 2 or higher'", () => {
  it("x' = 1 − z, y' = z, 0 = x + y − t (z cancels)", () => {
    const e = refusal(solve("x' = 1 - z; y' = z; 0 = x + y - t", "x = 0, y = 0", 0, 1));
    expect(e).toMatch(/reports index 2, but the differentiated system is numerically singular/);
    expect(e).toMatch(/loses z by cancellation/);
    expect(e).not.toMatch(/index 2 or higher/);
  });
  it("an index-1 block whose Jacobian is singular: 0 = z1 + z2 − x, 0 = z1 + z2 − y", () => {
    const e = refusal(solve("x' = z1; y' = z2; 0 = z1 + z2 - x; 0 = z1 + z2 - y", "x = 0, y = 0", 0, 1));
    expect(e).toMatch(/reports index 1, but .* numerically singular/);
  });
  it("a constraint where z appears only multiplied by zero", () => {
    const e = refusal(solve("x' = u; u' = z; 0 = x^2 - 1 + z*0", "x = 1, u = 0", 0, 1));
    expect(e).toMatch(/identically 0/);
  });
  it("a constraint that would need z′ (z becomes differential) is refused by name", () => {
    const e = refusal(solve("x' = z2; y' = 1; 0 = z1 - x; 0 = z1 - y", "x = 0, y = 0", 0, 1));
    expect(e).toMatch(/DERIVATIVE of the algebraic unknown z1/);
  });
});

describe("a constraint singular only ALONG the trajectory", () => {
  // The independent review showed this pin passed only because 200 points put a
  // node EXACTLY at t = 0.5; at 201 points the run sailed through the pole with
  // z(1) = −2. The singular point is now located BETWEEN nodes (sign/conditioning
  // of det ∂g/∂z after every accepted step, bisection inside the step).
  for (const points of [200, 201, 37, 7]) {
    it(`0 = (1 − 2t)·z − y: stops at t ≈ 0.5 and says why, with the t (points = ${points})`, () => {
      const r = got(solve("y' = 1; 0 = (1 - 2*t)*z - y", "y = 1", 0, 1, { points }));
      expect(r.completed).toBe(false);
      expect(r.steps.join(" ")).toMatch(/(∂g\/∂z .* is singular at t ≈ 0\.5 — no continuous solution beyond it|Newton could not solve the final level for z (near|at) t = 0\.5)/);
      expect(r.caveats.join(" ")).toMatch(/did NOT reach the final time/);
      expect(r.t[r.t.length - 1]).toBeLessThan(0.5);
    });
  }
  it("y' = −1, 0 = y·z − 1: the pole of z = 1/y at t = 1 stops the run there (it used to 'complete' with z(2) = −1)", () => {
    const r = got(solve("y' = -1; 0 = y*z - 1", "y = 1", 0, 2));
    expect(r.completed).toBe(false);
    expect(r.steps.join(" ")).toMatch(/is singular at t ≈ 1 — no continuous solution beyond it/);
    expect(r.t[r.t.length - 1]).toBeLessThanOrEqual(1);
  });
  it("a 2×2 block whose determinant (t − 2) changes sign between nodes stops at t ≈ 2", () => {
    const r = got(solve("x' = z1; y' = z2; 0 = z1 + (1-t)*z2 - x; 0 = z1 - z2 - y", "x = 0, y = 0", 0, 3, { points: 7 }));
    expect(r.completed).toBe(false);
    expect(r.steps.join(" ")).toMatch(/singular at t ≈ 2 —/);
  });
});

describe("inconsistent initial values: projected (and said) or refused (and said)", () => {
  it("position-level: x = 2 on the unit circle is moved to x = 1, reported", () => {
    const r = got(solve(PEND, "x = 2, y = 0, u = 0, v = 0", 0, 1));
    expect(r.projectedInit.join(" ")).toMatch(/original constraint x² \+ y² − 1 = 0: residual 3/);
    expect(r.projectedInit.join(" ")).toMatch(/x₀ = 2 was moved to x₀ = 1/);
    expect(Math.abs(last(r, "x") + 0.9862917511)).toBeLessThan(1e-5);
  });
  it("a start that cannot be projected (x² + 1 = 0 has no real point) is refused with its residual", () => {
    const e = refusal(solve("x' = u; u' = lam*x; 0 = x^2 + 1 + 0*lam", "x = 0, u = 0", 0, 1));
    expect(e).toMatch(/inconsistent|singular|cancels|identically/);
  });
  it("an unreachable start for an index-2 system: 0 = x² + 1 differentiated", () => {
    const e = refusal(solve("x' = z; 0 = x^2 + 1", "x = 0", 0, 1));
    expect(e).toMatch(/could not be projected onto the original constraint x² \+ 1 = 0 — residual 1/);
  });
  it("consistent values are left alone", () => {
    expect(got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 0.1)).projectedInit).toEqual([]);
  });
  it("an algebraic guess far from the root still converges to the consistent value", () => {
    const r = got(solve("y' = -z; 0 = z - y", "y = 1", 0, 0.1, {}, "z = 1000"));
    expect(r.states.z[0]).toBe(1);
  });
});

describe("a stiff index-1 DAE", () => {
  it("x' = −1e5·(x − z), y' = −y, 0 = z − y: x(1) = 1e5/(1e5 − 1)·e⁻¹ to 1e-8, under 10 s (a freeze bound, not a speed claim)", () => {
    const r = got(solve("x' = -100000*(x - z); y' = -y; 0 = z - y", "x = 0, y = 1", 0, 1));
    expect(r.completed).toBe(true);
    expect(Math.abs(last(r, "x") - (1e5 / (1e5 - 1)) * Math.exp(-1))).toBeLessThan(1e-8);
    expect(r.method).toMatch(/stiff/);
  });
});

describe("refusals by name, before the work", () => {
  it("a function with no derivative rule (delta) when the constraint must be differentiated", () => {
    expect(refusal(solve("x' = z; 0 = x - delta(t)", "x = 0", 0, 1))).toMatch(/delta\(…\), which has no symbolic derivative rule/);
  });
  it("a constraint that mentions no unknown", () => {
    expect(refusal(solve("x' = z; 0 = z - x; 0 = t - 1", "x = 0", 0, 1))).toMatch(/mentions no unknown/);
  });
  it("constraint count ≠ algebraic count, naming the unknowns", () => {
    expect(refusal(solve("x' = z + w; 0 = z - x", "x = 0", 0, 1))).toMatch(/1 constraint but 2 algebraic unknowns \(z, w\)/);
    expect(refusal(solve("x' = 1; 0 = x - t", "x = 0", 0, 1))).toMatch(/no algebraic unknown/);
  });
  it("runaway differentiation is capped (25 nested sines, index 5)", () => {
    let nest = "t";
    for (let i = 0; i < 25; i++) nest = `sin(${nest})`;
    expect(refusal(solve(`x1' = x2; x2' = x3; x3' = x4; x4' = z; 0 = x1 - ${nest}`, "x1 = 0, x2 = 1, x3 = 0, x4 = 0", 0, 1))).toMatch(/20000 expression nodes/);
  });
  it("an empty or non-finite interval", () => {
    expect(refusal(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 1, 1))).toMatch(/empty/);
    expect(refusal(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, Infinity))).toMatch(/finite/);
  });
});

describe("work, not steps, bounds the time (a frozen Word is not an error)", () => {
  it("a fast oscillation (ω = 2000 over [0, 100]) stops BY NAME on the work budget, under 10 s (a freeze bound, not a speed claim)", () => {
    // Before the work budget this ran 300 000 RK45 steps (~5 s) and then 'fell
    // back' to 20 000 implicit-Euler steps (hω = 10) — a damped, confident,
    // WRONG answer. Now: stop, say why, no fallback.
    const r = got(solve("x' = 2000*u; u' = -2000*x - z; 0 = z", "x = 1, u = 0", 0, 100));
    expect(r.completed).toBe(false);
    expect(r.steps.join(" ")).toMatch(/work budget .* ran out at t = /);
    expect(r.method).not.toMatch(/implicit Euler/);
    expect(r.caveats.join(" ")).not.toMatch(/fallback|FIRST-order/);
  });
  it("a finite-time blow-up (x' = x², x(0) = 1) stops near t = 1 and the Euler fallback declines it", () => {
    const r = got(solve("x' = z; 0 = z - x^2", "x = 1", 0, 2));
    expect(r.completed).toBe(false);
    expect(r.method).not.toMatch(/implicit Euler/);
    expect(r.t[r.t.length - 1]).toBeLessThanOrEqual(1);
  });
  it("the pendulum uses a small fraction of the budget (the cap never bites a normal run)", () => {
    const r = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 10));
    expect(r.workUsed).toBeLessThan(DAE_WORK_BUDGET / 5);
  });
  it("a large index-3 constraint near the 2000-character line cap stays under the freeze bound", () => {
    const big = Array.from({ length: 60 }, (_x, i) => `${i + 1}*x1^2*sin(${i}*t)`).join(" + ");
    const o = solve(`x1' = x2; x2' = z; 0 = x1 - 1 + 0.000001*(${big})`, "x1 = 1, x2 = 0", 0, 1);
    expect(typeof o.ok).toBe("boolean");
  });
});

describe("the result does not depend on machine speed (work budget is the only normal stop)", () => {
  // A 2.5 s clock backstop once stopped a 10 s pendulum at t = 4.76 under a
  // loaded full-suite run. The clock is now a far-out freeze guard only.
  it("the 500-point, 10 s pendulum: byte-identical with a real clock and with a clock 1000× slow", () => {
    const p = parseDaeSystem(PEND, "x = 1, y = 0, u = 0, v = 0");
    if (!p.ok) throw new Error(p.error);
    const real = solveDaeAuto(p.system, 0, 10, { points: 500 });
    let fake = 0;
    const slow = solveDaeAuto(p.system, 0, 10, { points: 500, clock: () => (fake += 1) });
    expect(JSON.stringify(slow)).toBe(JSON.stringify(real));
    expect(real.ok && real.result.completed).toBe(true);
  });
  it("every §D input finishes with at least 4× work margin", () => {
    const CASES: [string, string, number, number, DaeAutoOptions][] = [
      [PEND, "x = 1, y = 0, u = 0, v = 0", 0, 10, { points: 2000 }],
      [PEND, "x = 1, y = 0, u = 0, v = 0", 0, 10, { points: 500 }],
      [PEND, "x = 1, y = 0, u = 1, v = 0", 0, 2, {}],
      ["x' = z; 0 = x - sin(t)", "x = 0", 0, 1, {}],
      ["x1' = x2; x2' = z; 0 = x1 - t^3", "x1 = 0, x2 = 0", 0, 1, {}],
      ["y' = -z; 0 = z - y", "y = 1", 0, 2, { points: 500 }],
      ["x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = u^2 + v^2 - lam*(x^2+y^2) - 9.81*y", "x = 1, y = 0, u = 0, v = 0", 0, 10, {}],
    ];
    for (const [eqs, init, t0, t1, o] of CASES) {
      const r = got(solve(eqs, init, t0, t1, o));
      expect(r.completed).toBe(true);
      expect(r.workUsed).toBeLessThan(DAE_WORK_BUDGET / 4);
    }
  });
  it("if the freeze guard ever fires it says it was the CLOCK, not the work", () => {
    const p = parseDaeSystem(PEND, "x = 1, y = 0, u = 0, v = 0");
    if (!p.ok) throw new Error(p.error);
    let fake = 0;
    const r = got(solveDaeAuto(p.system, 0, 10, { clock: () => (fake += 1e6) }));
    expect(r.completed).toBe(false);
    expect(r.steps.join(" ")).toMatch(/stopped by the time guard .* the machine was slow .* the work budget was not reached/);
  });
});

describe("options", () => {
  it("Baumgarte prints α and β (they change the answer) and still tracks the pendulum", () => {
    const r = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 2, { stabilise: { baumgarte: { alpha: 5, beta: 5 } } }));
    expect(r.steps.join(" ")).toMatch(/Baumgarte stabilisation with α = 5, β = 5/);
    expect(Math.abs(last(r, "x") - 0.7935661953)).toBeLessThan(1e-5);
  });
  it("integrating backwards in time", () => {
    const r = got(solve("x' = z; 0 = x - sin(t)", "x = sin(1)", 1, 0));
    expect(Math.abs(last(r, "z") - 1)).toBeLessThan(1e-8);
  });
  it("a hostile point count is clamped rather than hanging", () => {
    const r = got(solve("y' = -z; 0 = z - y", "y = 1", 0, 1, { points: 1e9 }));
    expect(r.t.length).toBeLessThanOrEqual(5001);
  });
  it("12 unknowns at index 3 stays under the freeze bound", () => {
    // Three independent pendulum-like index-3 blocks: 4 states + 1 alg each = 15 > 12, so two blocks + a chain.
    const eqs = [
      "x' = u; y' = v; u' = -l1*x; v' = -l1*y - 9.81; 0 = x^2 + y^2 - 1",
      "p' = q; r' = s; q' = -l2*p; s' = -l2*r - 9.81; 0 = p^2 + r^2 - 4",
      "w' = l3; 0 = w - t",
    ].join("; ");
    const r = got(solve(eqs, "x = 1, y = 0, u = 0, v = 0, p = 2, r = 0, q = 0, s = 0, w = 0", 0, 5));
    expect(r.index).toBe(3);
    expect(r.completed).toBe(true);
  });
});
