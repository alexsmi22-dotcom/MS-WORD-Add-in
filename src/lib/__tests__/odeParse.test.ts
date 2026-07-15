// Higher-order ODE parsing / auto-reduction tests.
//
// The reduction has to be right in two ways: structurally (the state vector and
// its derivative chain) and physically (integrating the reduced system must
// reproduce the known analytical solution of the original equation). Both are
// asserted — a structurally plausible but physically wrong reduction is exactly
// the bug this would otherwise ship.

import { parseOdeSystem } from "../odeParse";
import { solveOde } from "../ode";
import { evalFormula } from "../stats";

/** Builds the f(t,y) the solver needs, the same way the pane does. */
function toF(system: { states: { varName: string }[]; rhs: string[] }) {
  return (t: number, y: number[]): number[] =>
    system.rhs.map((expr) => {
      const vars: Record<string, number> = { t };
      system.states.forEach((s, i) => (vars[s.varName] = y[i]));
      return evalFormula(expr, vars);
    });
}

const ok = (r: ReturnType<typeof parseOdeSystem>) => {
  if (!r.ok) throw new Error(`expected parse to succeed: ${r.error}`);
  return r.system;
};

describe("first-order systems still work exactly as before", () => {
  test("the classic hand-reduced pair", () => {
    const s = ok(parseOdeSystem("y1' = y2\ny2' = -y1", "y1 = 1, y2 = 0"));
    expect(s.states.map((x) => x.label)).toEqual(["y1", "y2"]);
    expect(s.y0).toEqual([1, 0]);
    expect(s.reduced).toBe(false);
  });

  test("a single first-order equation", () => {
    const s = ok(parseOdeSystem("y' = -y", "y = 1"));
    expect(s.states).toHaveLength(1);
    expect(s.rhs).toEqual(["-y"]);
  });

  test("semicolons separate equations as well as newlines", () => {
    const s = ok(parseOdeSystem("y1' = y2; y2' = -y1", "y1 = 1, y2 = 0"));
    expect(s.states).toHaveLength(2);
  });
});

describe("higher-order equations are reduced automatically", () => {
  test("y'' = -y becomes a 2-state system with the right derivative chain", () => {
    const s = ok(parseOdeSystem("y'' = -y", "y = 1, y' = 0"));
    expect(s.reduced).toBe(true);
    expect(s.states.map((x) => x.label)).toEqual(["y", "y'"]);
    // d/dt(y) = y'  and  d/dt(y') = -y
    expect(s.rhs[0]).toBe("y__d1");
    expect(s.rhs[1]).toBe("-y");
    expect(s.y0).toEqual([1, 0]);
  });

  test("derivatives inside the RHS are substituted (damped oscillator)", () => {
    const s = ok(parseOdeSystem("y'' = -0.1*y' - y", "y = 1, y' = 0"));
    expect(s.rhs[1]).toBe("-0.1*y__d1 - y");
  });

  test("third order gives three states", () => {
    const s = ok(parseOdeSystem("y''' = -y''- y' - y", "y = 1, y' = 0, y'' = 0"));
    expect(s.states.map((x) => x.label)).toEqual(["y", "y'", "y''"]);
    expect(s.rhs[0]).toBe("y__d1");
    expect(s.rhs[1]).toBe("y__d2");
    expect(s.rhs[2]).toBe("-y__d2- y__d1 - y");
  });

  test("longest-prime-first substitution: y'' is never mangled into y__d1'", () => {
    // Substituting y' before y'' would rewrite y'' as "y__d1'" and leave a stray
    // prime behind. A third-order equation is the smallest valid case that has
    // both y' and y'' available as states to reference.
    const s = ok(parseOdeSystem("y''' = -y'' + 2*y' - y", "y = 1, y' = 0, y'' = 0"));
    expect(s.rhs[2]).toBe("-y__d2 + 2*y__d1 - y");
    expect(s.rhs[2]).not.toContain("'");
  });

  test("several higher-order equations coexist", () => {
    const s = ok(parseOdeSystem("x'' = -x\nz'' = -9.81", "x = 1, x' = 0, z = 0, z' = 5"));
    expect(s.states.map((x) => x.label)).toEqual(["x", "x'", "z", "z'"]);
    expect(s.y0).toEqual([1, 0, 0, 5]);
  });

  test("mixed orders in one system", () => {
    const s = ok(parseOdeSystem("y'' = -y\nw' = -w", "y = 1, y' = 0, w = 2"));
    expect(s.states.map((x) => x.label)).toEqual(["y", "y'", "w"]);
    expect(s.y0).toEqual([1, 0, 2]);
  });

  test("y(0) = 1 style initial values are accepted too", () => {
    const s = ok(parseOdeSystem("y'' = -y", "y(0) = 1, y'(0) = 0"));
    expect(s.y0).toEqual([1, 0]);
  });

  test("variables whose names contain digits reduce correctly", () => {
    const s = ok(parseOdeSystem("x1'' = -x1", "x1 = 1, x1' = 0"));
    expect(s.states.map((x) => x.label)).toEqual(["x1", "x1'"]);
    expect(s.rhs[1]).toBe("-x1");
  });
});

describe("the reduction is PHYSICALLY correct, not just structurally", () => {
  test("y'' = -y reproduces cos(t)", () => {
    const s = ok(parseOdeSystem("y'' = -y", "y = 1, y' = 0"));
    const r = solveOde(toF(s), s.y0, 0, 2 * Math.PI, { rtol: 1e-10, atol: 1e-12 });
    expect(r.completed).toBe(true);
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(Math.cos(2 * Math.PI), 6);
    expect(r.y[r.y.length - 1][1]).toBeCloseTo(-Math.sin(2 * Math.PI), 5);
  });

  test("a hand-reduced system and its auto-reduced twin agree exactly", () => {
    const manual = ok(parseOdeSystem("y1' = y2\ny2' = -y1", "y1 = 1, y2 = 0"));
    const auto = ok(parseOdeSystem("y'' = -y", "y = 1, y' = 0"));
    const a = solveOde(toF(manual), manual.y0, 0, 5, { rtol: 1e-10, atol: 1e-12 });
    const b = solveOde(toF(auto), auto.y0, 0, 5, { rtol: 1e-10, atol: 1e-12 });
    expect(b.y[b.y.length - 1][0]).toBeCloseTo(a.y[a.y.length - 1][0], 8);
    expect(b.y[b.y.length - 1][1]).toBeCloseTo(a.y[a.y.length - 1][1], 8);
  });

  test("damped oscillator matches its analytical solution", () => {
    // y'' + 2*z*w*y' + w^2*y = 0 with w=1, z=0.1, y(0)=1, y'(0)=0
    // → y(t) = e^(-z*w*t) * (cos(wd*t) + (z/sqrt(1-z^2))*sin(wd*t)),  wd = w*sqrt(1-z^2)
    const s = ok(parseOdeSystem("y'' = -0.2*y' - y", "y = 1, y' = 0"));
    const r = solveOde(toF(s), s.y0, 0, 8, { rtol: 1e-10, atol: 1e-12 });
    const z = 0.1;
    const wd = Math.sqrt(1 - z * z);
    const t = 8;
    const exact = Math.exp(-z * t) * (Math.cos(wd * t) + (z / wd) * Math.sin(wd * t));
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(exact, 6);
  });

  test("projectile: z'' = -9.81 matches the closed form", () => {
    const s = ok(parseOdeSystem("z'' = -9.81", "z = 0, z' = 20"));
    const r = solveOde(toF(s), s.y0, 0, 2, { rtol: 1e-10, atol: 1e-12 });
    // z(t) = 20t - 4.905t^2 ; z'(t) = 20 - 9.81t
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(20 * 2 - 4.905 * 4, 6);
    expect(r.y[r.y.length - 1][1]).toBeCloseTo(20 - 9.81 * 2, 6);
  });

  test("third-order equation integrates to its analytical solution", () => {
    // y''' = -y with y(0)=1, y'(0)=0, y''(0)=0 has no simple closed form, so use
    // y''' = 0 instead: y(t) = 1 + 2t + 1.5t^2 (from y''(0)=3).
    const s = ok(parseOdeSystem("y''' = 0", "y = 1, y' = 2, y'' = 3"));
    const r = solveOde(toF(s), s.y0, 0, 4, { rtol: 1e-10, atol: 1e-12 });
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(1 + 2 * 4 + 1.5 * 16, 5);
  });

  test("a stiff higher-order equation still auto-reduces and solves", () => {
    // y'' = -1001*y' - 1000*y  →  roots -1 and -1000: genuinely stiff.
    const s = ok(parseOdeSystem("y'' = -1001*y' - 1000*y", "y = 1, y' = 0"));
    const r = solveOde(toF(s), s.y0, 0, 10, { rtol: 1e-8, atol: 1e-12 });
    expect(r.completed).toBe(true);
    // y(t) = (1000e^-t - e^-1000t)/999 → at t=10, ~ (1000 e^-10)/999
    expect(r.y[r.y.length - 1][0]).toBeCloseTo((1000 * Math.exp(-10)) / 999, 6);
  });
});

describe("errors are specific and actionable", () => {
  const err = (r: ReturnType<typeof parseOdeSystem>) => (r.ok ? "" : r.error);

  test("an equation with no derivative says so", () => {
    expect(err(parseOdeSystem("y = -y", "y = 1"))).toMatch(/no derivative/i);
  });

  test("a missing initial value names what is missing and how many are needed", () => {
    const e = err(parseOdeSystem("y'' = -y", "y = 1"));
    expect(e).toMatch(/y'/);
    expect(e).toMatch(/needs 2/i);
  });

  test("an RHS referring to a non-state is caught by name", () => {
    const e = err(parseOdeSystem("y' = -k*y", "y = 1"));
    expect(e).toMatch(/"k"/);
    expect(e).toMatch(/isn't a state/i);
  });

  test("a derivative used in the RHS above the equation's own order is caught", () => {
    // y' = -y'' : y is order 1, so y'' is not a state.
    expect(err(parseOdeSystem("y' = -y''", "y = 1"))).toMatch(/isn't a state/i);
  });

  test("two equations for the same function are rejected", () => {
    expect(err(parseOdeSystem("y' = -y\ny'' = y", "y = 1, y' = 0"))).toMatch(/more than one equation/i);
  });

  test("an initial value for a non-state is caught", () => {
    expect(err(parseOdeSystem("y' = -y", "y = 1, q = 3"))).toMatch(/isn't a state/i);
  });

  test("an absurd order is refused rather than attempted", () => {
    expect(err(parseOdeSystem("y''''''' = 0", "y = 1"))).toMatch(/order 7/i);
  });

  test("empty input asks for an equation", () => {
    expect(err(parseOdeSystem("", "y = 1"))).toMatch(/at least one equation/i);
  });

  test("t is always allowed in a right-hand side", () => {
    expect(parseOdeSystem("y' = -y + sin(t)", "y = 1").ok).toBe(true);
  });

  test("function calls in the RHS are not mistaken for unknown states", () => {
    expect(parseOdeSystem("y' = -y + exp(-t)*max(t, 1)", "y = 1").ok).toBe(true);
    expect(parseOdeSystem("y' = if(t < 1, 1, 0)", "y = 0").ok).toBe(true);
  });
});
