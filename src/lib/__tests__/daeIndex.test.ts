// DAE index reduction (daeIndex.ts) — the §D1 acceptance audit of
// docs/SCOPE-NUMERICS-TOPOLOGY.md, against oracles that are NOT this code:
//
//   * The Cartesian pendulum (L = 1, g = 9.81, from x = 1, y = 0 at rest):
//     SciPy 1.18.1 DOP853 at rtol 1e-13 on θ'' = −g sin θ — a DIFFERENT
//     coordinate system — with x = sin θ, y = −cos θ, λ = u² + v² − g·y.
//     Radau on the Cartesian index-1 reduction agreed to ≤ 3e-8.
//   * The period: 4K(1/2)/√g = 2.3678419476 (scipy.special.ellipk).
//   * Index 2 and 3 chains and the index-1 twins: closed forms.
//
// THE TWO WRONG ANSWERS THIS RELEASE EXISTS FOR:
//   1. The pane bound initial values BY POSITION — `u = 0, x = 1` silently
//      applied x's equation to u. Reordered values must give IDENTICAL output.
//   2. The old solver certified "no drift by construction" while x² + y² fell
//      to 0.54. The drift report must measure the ORIGINAL constraint and every
//      hidden one, before AND after projection.

import { parseDaeSystem } from "../daeParse";
import { solveDaeAuto, DaeAutoOptions, DaeAutoResult, typesetDae } from "../daeIndex";
import { parseExpr, evalAst } from "../solve";

const PEND = "x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = x^2 + y^2 - 1";

function solve(eqs: string, init: string, t0: number, t1: number, opts: DaeAutoOptions = {}, guess = "") {
  const p = parseDaeSystem(eqs, init, guess);
  if (!p.ok) throw new Error("parse: " + p.error);
  return solveDaeAuto(p.system, t0, t1, opts);
}
function got(o: ReturnType<typeof solveDaeAuto>): DaeAutoResult {
  if (!o.ok) throw new Error("expected a solution, got: " + o.error);
  return o.result;
}
function at(r: DaeAutoResult, name: string, t: number): number {
  const k = r.t.findIndex((x) => Math.abs(x - t) < 1e-9);
  if (k < 0) throw new Error(`t = ${t} is not a grid point`);
  return r.states[name][k];
}

// §D1 table (SciPy).
const TABLE: Record<number, Record<string, number>> = {
  0.5: { x: 0.3910487916, y: -0.9203699488, u: -3.911048004, v: -1.6617346075, lam: 27.0864875927 },
  1: { x: -0.9862917511, y: -0.1650108531, u: -0.2969055159, v: 1.7746436411, lam: 4.8562694075 },
  2: { x: 0.7935661953, y: -0.6084839304, u: 2.1024378744, v: 2.741935393, lam: 17.907682073 },
  10: { x: 0.2750874626, y: -0.9614192051, u: -4.175598101, v: -1.1947490546, lam: 28.2945672061 },
};

describe("§D1 the Cartesian pendulum, typed as an index-3 DAE, is SOLVED", () => {
  const r = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 10, { tEval: [0.5, 1, 2] }));

  it("is index 3 (structural), the constraint differentiated twice", () => {
    expect(r.index).toBe(3);
    expect(r.structural.join(" ")).toMatch(/0 = x² \+ y² − 1: differentiated twice/);
    expect(r.structural.join(" ")).toMatch(/Pantelides/);
  });

  it("reports both hidden constraints: x·u + y·v = 0 and the λ level", () => {
    expect(r.hidden).toHaveLength(2);
    expect(r.hidden[0]).toBe("u·x + v·y = 0");
    expect(r.hidden[1]).toMatch(/lam/);
    expect(r.hidden[1]).toMatch(/9\.81·y/);
  });

  it("the hidden constraints are typeset AND parse back to the right functions (display contract)", () => {
    const pts = [{ x: 0.3, y: -0.7, u: 1.1, v: -0.4, lam: 2.5 }, { x: -1.2, y: 0.5, u: 0.2, v: 3, lam: -1 }];
    for (const p of pts) {
      const h0 = evalAst(parseExpr(r.hidden[0].replace(/ = 0$/, "")), p);
      const h1 = evalAst(parseExpr(r.hidden[1].replace(/ = 0$/, "")), p);
      expect(h0).toBeCloseTo(p.x * p.u + p.y * p.v, 12);
      expect(h1).toBeCloseTo(p.u ** 2 + p.v ** 2 - p.lam * (p.x ** 2 + p.y ** 2) - 9.81 * p.y, 10);
    }
    expect(r.hidden.join(" ")).not.toMatch(/\*|\^|981\/50/);
  });

  for (const t of [0.5, 1, 2, 10]) {
    it(`every value at t = ${t} is within 1e-5 of SciPy`, () => {
      for (const name of ["x", "y", "u", "v", "lam"]) {
        expect(Math.abs(at(r, name, t) - TABLE[t][name])).toBeLessThan(1e-5);
      }
    });
  }

  it("the tightened tolerance is printed (rtol 1e-10)", () => {
    expect(r.rtol).toBe(1e-10);
    expect(r.steps.join(" ")).toMatch(/rtol 1e-10/);
  });

  it("drift AFTER projection ≤ 1e-12 on the position AND the velocity constraint", () => {
    const pos = r.drift.find((d) => d.level === 0);
    const vel = r.drift.find((d) => d.level === 1);
    expect(pos?.constraint).toBe("x² + y² − 1");
    expect(vel?.constraint).toBe("u·x + v·y");
    expect(pos!.after).toBeLessThanOrEqual(1e-12);
    expect(vel!.after).toBeLessThanOrEqual(1e-12);
  });

  it("the drift BEFORE projection is printed and nonzero", () => {
    const pos = r.drift.find((d) => d.level === 0)!;
    expect(pos.before).toBeGreaterThan(0);
    expect(r.steps.join(" ")).toMatch(/Original constraint x² \+ y² − 1 = 0: drift before projection \S+, after \S+/);
  });

  it("the period, from successive downward zero crossings of x, is 4K(1/2)/√g = 2.3678419476 to 1e-6", () => {
    // DEVIATION FROM THE BRIEF'S WORDING, ON PURPOSE: u = x′ has a TRIPLE zero at
    // each turning point (x = ±1, where both θ′ and cos θ vanish), so locating
    // its crossings is ill-conditioned (error ~ interpolation error^(1/3)). x
    // crosses 0 at the bottom with speed |u| ≈ 4.4 — a simple zero, located by a
    // cubic Hermite fit using x′ = u. Same period, well-conditioned measurement.
    const d = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 10, { points: 2000 }));
    const X = d.states.x;
    const U = d.states.u;
    const crossings: number[] = [];
    for (let k = 0; k + 1 < d.t.length; k++) {
      if (X[k] > 0 && X[k + 1] <= 0) {
        const t0 = d.t[k], h = d.t[k + 1] - t0;
        const H = (s: number) => {
          const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s;
          const h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
          return h00 * X[k] + h10 * h * U[k] + h01 * X[k + 1] + h11 * h * U[k + 1];
        };
        let a = 0, b = 1;
        for (let it = 0; it < 60; it++) { const mid = (a + b) / 2; if (H(mid) > 0) a = mid; else b = mid; }
        crossings.push(t0 + ((a + b) / 2) * h);
      }
    }
    const T = 2.3678419476;
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(crossings[0] - T / 4)).toBeLessThan(1e-6);
    expect(Math.abs(crossings[1] - crossings[0] - T)).toBeLessThan(1e-6);
    expect(Math.abs((crossings[3] - crossings[0]) / 3 - T)).toBeLessThan(1e-6);
  });
});

describe("§D1 WRONG #1 twin: initial values are bound BY NAME", () => {
  const base = got(solve(PEND, "x = 1, y = 0, u = 0, v = 0", 0, 2, { points: 40 }));

  it("the same system with the initial values in a different order gives the IDENTICAL table", () => {
    for (const init of ["v = 0, u = 0, y = 0, x = 1", "u = 0; x = 1\ny = 0, v = 0", "y = 0, x = 1, v = 0, u = 0"]) {
      const r = got(solve(PEND, init, 0, 2, { points: 40 }));
      expect(r.t).toEqual(base.t);
      expect(r.states).toEqual(base.states);
    }
  });

  it("λ (and the word lambda) for lam gives the identical table, and says so", () => {
    for (const sys of [PEND.replace(/lam/g, "λ"), PEND.replace(/lam/g, "lambda")]) {
      const r = got(solve(sys, "x = 1, y = 0, u = 0, v = 0", 0, 2, { points: 40 }));
      expect(r.states).toEqual(base.states);
      expect(r.steps.join(" ")).toMatch(/read as the variable lam/);
    }
  });

  it("the pane's own WRONG #1 system: `u = 0, x = 1` now gives cos 1, −sin 1 (it gave 0, 0.368)", () => {
    for (const init of ["x = 1, u = 0", "u = 0, x = 1"]) {
      const r = got(solve("x' = u\nu' = -x - z\n0 = z", init, 0, 1));
      expect(Math.abs(at(r, "x", 1) - Math.cos(1))).toBeLessThan(1e-8);
      expect(Math.abs(at(r, "u", 1) + Math.sin(1))).toBeLessThan(1e-8);
    }
  });
});

describe("§D1 inconsistent hidden constraint: u = 1", () => {
  const r = got(solve(PEND, "x = 1, y = 0, u = 1, v = 0", 0, 2, { tEval: [1] }));

  it("says u₀ = 1 violates x·u + y·v = 0 with residual 1, and moves u to 0", () => {
    const txt = r.projectedInit.join(" ");
    expect(txt).toMatch(/violate the hidden constraint u·x \+ v·y = 0/);
    expect(txt).toMatch(/residual 1 at the values given/);
    expect(txt).toMatch(/u₀ = 1 was moved to u₀ = 0/);
    expect(txt).not.toMatch(/v₀/); // v is kept at 0
    expect(txt).not.toMatch(/x₀/); // x is fixed by the position level and kept
    expect(r.states.u[0]).toBe(0);
    expect(r.states.v[0]).toBe(0);
    expect(r.states.x[0]).toBe(1);
  });

  it("the solution then equals the table", () => {
    for (const name of ["x", "y", "u", "v", "lam"]) {
      expect(Math.abs(at(r, name, 1) - TABLE[1][name])).toBeLessThan(1e-5);
    }
  });

  it("the caveat says the entered values were MOVED", () => {
    expect(r.caveats.join(" ")).toMatch(/MOVED/);
  });
});

describe("§D1 the user-reduced index-1 form (the WRONG #2 input)", () => {
  const r = got(solve(
    "x' = u; y' = v; u' = -lam*x; v' = -lam*y - 9.81; 0 = u^2 + v^2 - lam*(x^2+y^2) - 9.81*y",
    "x = 1, y = 0, u = 0, v = 0", 0, 10,
  ));

  it("is solved as index 1", () => {
    expect(r.index).toBe(1);
    expect(r.completed).toBe(true);
  });

  it("says the ORIGINAL constraint is not among the equations and its drift cannot be checked", () => {
    // DEVIATION FROM THE BRIEF'S WORDING, ON PURPOSE: an index-1 input carries
    // no trace of the constraint it was differentiated from, so the engine
    // cannot name x² + y² − 1 specifically. The caveat is always on for index 1
    // and names the pendulum's case as the example.
    const c = r.caveats.join(" ");
    expect(c).toMatch(/original constraint is not among the equations and its drift cannot be checked/);
  });

  it("never says 'by construction' or 'no drift' (grep gate over the whole output)", () => {
    const all = [...r.steps, ...r.caveats, ...r.structural, ...r.reduced].join(" ");
    expect(all).not.toMatch(/by construction/);
    expect(all).not.toMatch(/no drift/i);
  });
});

describe("§D1 index 2: x' = z, 0 = x − sin t", () => {
  const r = got(solve("x' = z; 0 = x - sin(t)", "x = 0", 0, 1, { tEval: [0.5] }));
  it("is index 2", () => expect(r.index).toBe(2));
  it("z = cos t: z(1) = 0.5403023059, z(0.5) = 0.8775825619 to 1e-8", () => {
    expect(Math.abs(at(r, "z", 1) - 0.5403023059)).toBeLessThan(1e-8);
    expect(Math.abs(at(r, "z", 0.5) - 0.8775825619)).toBeLessThan(1e-8);
  });
});

describe("§D1 index 3, linear chain: x1' = x2, x2' = z, 0 = x1 − t³", () => {
  const r = got(solve("x1' = x2; x2' = z; 0 = x1 - t^3", "x1 = 0, x2 = 0", 0, 1));
  it("is index 3", () => expect(r.index).toBe(3));
  it("z(1) = 6 and x2(1) = 3 to 1e-8", () => {
    expect(Math.abs(at(r, "z", 1) - 6)).toBeLessThan(1e-8);
    expect(Math.abs(at(r, "x2", 1) - 3)).toBeLessThan(1e-8);
  });
});

describe("§D1 structural failure: x' = 1 − z, y' = z, 0 = x + y − t is REFUSED BY NAME", () => {
  const o = solve("x' = 1 - z; y' = z; 0 = x + y - t", "x = 0, y = 0", 0, 1);
  it("refuses", () => expect(o.ok).toBe(false));
  it("as structurally index 2 but numerically singular, naming the cancellation of z", () => {
    if (o.ok) return;
    expect(o.error).toMatch(/Structural analysis \(Pantelides\) reports index 2/);
    expect(o.error).toMatch(/numerically singular at t₀/);
    expect(o.error).toMatch(/loses z by cancellation/);
    expect(o.error).toMatch(/may not determine z at all/);
  });
  it("and never says 'index 2 or higher'", () => {
    if (!o.ok) expect(o.error).not.toMatch(/index 2 or higher/);
  });
});

describe("§D1 index-1 twins (method change: ode.ts RK45 replaces implicit Euler)", () => {
  // Today's implicit Euler (500 steps) gave y(1) = 0.3682470142 — first order.
  // The pins tighten to 1e-8 BECAUSE the method changed; that is the reason.
  const r = got(solve("y' = -z; 0 = z - y", "y = 1", 0, 2, { tEval: [1] }, "z = 1"));
  it("y(1) = e⁻¹ = 0.3678794412 to 1e-8", () => {
    expect(Math.abs(at(r, "y", 1) - 0.3678794412)).toBeLessThan(1e-8);
  });
  it("y(2) = e⁻² = 0.1353352832 to 1e-8 (the pane default example, 0.1358762635 under implicit Euler)", () => {
    expect(Math.abs(at(r, "y", 2) - 0.1353352832)).toBeLessThan(1e-8);
  });
  it("the pane's EXACT default input (eqs + \\n + cons, y0 field, z0 field as guesses) gives e⁻² at t = 2", () => {
    const p = parseDaeSystem("y' = -z" + "\n" + "z - y", "y = 1", "z = 1");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = got(solveDaeAuto(p.system, 0, 2, { points: 500 }));
    expect(Math.abs(at(d, "y", 2) - Math.exp(-2))).toBeLessThan(1e-8);
  });
  it("is index 1 and z tracks y", () => {
    expect(r.index).toBe(1);
    r.t.forEach((_t, k) => expect(Math.abs(r.states.z[k] - r.states.y[k])).toBeLessThan(1e-12));
  });
});

describe("display contract: every printed reduced system re-parses with the same initial values", () => {
  const CASES: [string, string][] = [
    [PEND, "x = 1, y = 0, u = 0, v = 0"],
    ["x'' = -lam*x; y'' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", "x = 1, y = 0, x' = 0, y' = 0"],
    ["x' = z; 0 = x - sin(t)", "x = 0"],
    ["x1' = x2; x2' = z; 0 = x1 - t^3", "x1 = 0, x2 = 0"],
    ["y' = -z; 0 = z - y", "y = 1"],
    ["x' = u\nu' = -x - z\n0 = z", "x = 1, u = 0"],
    ["x' = z1; y' = z2; 0 = x - t; 0 = z2 - y", "x = 0, y = 1"],
  ];
  for (const [eqs, init] of CASES) {
    it(eqs.replace(/\n/g, "; "), () => {
      const r = got(solve(eqs, init, 0, 0.1));
      const back = parseDaeSystem(r.reduced.join("; "), init);
      if (!back.ok) throw new Error(back.error);
      // The re-read system must have the same unknowns and integrate to the same point.
      const again = got(solveDaeAuto(back.system, 0, 0.1));
      expect(again.names).toEqual(r.names);
      for (const n of r.names) expect(Math.abs(again.states[n][again.t.length - 1] - r.states[n][r.t.length - 1])).toBeLessThan(1e-8);
    });
  }
  it("the second-order pendulum prints x′′ = −lam·x, never the internal x′ = x′", () => {
    const r = got(solve("x'' = -lam*x; y'' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", "x = 1, y = 0, x' = 0, y' = 0", 0, 0.1));
    expect(r.reduced[0]).toBe("x′′ = −lam·x");
    expect(r.reduced.join(" ")).not.toMatch(/x′ = x′/);
  });
});

describe("typesetDae", () => {
  it("superscripts, middle dots, true minus signs", () => {
    expect(typesetDae(parseExpr("x^2 + y^2 - 1"))).toBe("x² + y² − 1");
    expect(typesetDae(parseExpr("-lam*x"))).toBe("−lam·x");
    expect(typesetDae(parseExpr("x__d1 + 1"))).toBe("x′ + 1");
  });
});
