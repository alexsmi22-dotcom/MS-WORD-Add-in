// daeParse.ts — every initial value BY NAME; nothing silently dropped.
//
// The pane used to (1) discard the name in `x' = …` and line equations up with
// initial values BY POSITION, and (2) read initial values with a numbers-only
// regex, silently dropping `z = 1/2`, `y = pi` and `y = −1` and then blaming the
// user for "omitting" them. Both are pinned here, through the parser the pane
// will call.

import { parseDaeSystem, DaeSystem } from "../daeParse";

function ok(eqs: string, init: string, guess = ""): DaeSystem {
  const p = parseDaeSystem(eqs, init, guess);
  if (!p.ok) throw new Error(p.error);
  return p.system;
}
function err(eqs: string, init: string, guess = ""): string {
  const p = parseDaeSystem(eqs, init, guess);
  if (p.ok) throw new Error("expected a refusal");
  return p.error;
}

describe("binding by NAME", () => {
  it("state order comes from the equations, never from the initial values", () => {
    const a = ok("x' = u\nu' = -x - z\n0 = z", "x = 1, u = 0");
    const b = ok("x' = u\nu' = -x - z\n0 = z", "u = 0, x = 1");
    expect(a.states.map((s) => s.varName)).toEqual(["x", "u"]);
    expect(b.states).toEqual(a.states);
    expect(b.init).toEqual({ x: 1, u: 0 });
    expect(b.stateRhs).toEqual(a.stateRhs);
  });
  it("constraints may be mixed into the equation block: 0 = …, … = 0, lhs = rhs, or bare", () => {
    const s = ok("y' = -z\nz - y\nw = 2*y\n0 = q - 1\nr - y = 0\ny' = 1".replace("\ny' = 1", ""), "y = 1");
    expect(s.cons).toHaveLength(4);
    expect(s.alg).toEqual(["z", "w", "q", "r"]);
  });
  it("x'' is reduced to first order with the state x′, and x' may be given an initial value", () => {
    const s = ok("x'' = -lam*x; y'' = -lam*y - 9.81; 0 = x^2 + y^2 - 1", "y' = 0, x = 1, x' = 0, y = 0");
    expect(s.states.map((q) => q.label)).toEqual(["x", "x'", "y", "y'"]);
    expect(s.init).toEqual({ x: 1, x__d1: 0, y: 0, y__d1: 0 });
    expect(s.alg).toEqual(["lam"]);
  });
  it("Unicode primes are read as primes", () => {
    const s = ok("x′ = u; u′ = -x - z; 0 = z", "x = 1, u = 0");
    expect(s.states.map((q) => q.varName)).toEqual(["x", "u"]);
  });
});

describe("§D1 parse twins: constant expressions are accepted, never dropped", () => {
  it("z = 1/2 (as a guess), y = pi, y = −1 (U+2212)", () => {
    expect(ok("y' = -z; 0 = z - y", "y = pi", "z = 1/2").guesses).toEqual({ z: 0.5 });
    expect(ok("y' = -z; 0 = z - y", "y = pi").init.y).toBeCloseTo(Math.PI, 15);
    expect(ok("y' = -z; 0 = z - y", "y = −1").init.y).toBe(-1);
    expect(ok("y' = -z; 0 = z - y", "y = sqrt(2)/2").init.y).toBeCloseTo(Math.SQRT1_2, 15);
  });
  it("an algebraic value in the initial-values field is a guess, and the output says so", () => {
    const s = ok("y' = -z; 0 = z - y", "y = 1, z = 1/2");
    expect(s.guesses).toEqual({ z: 0.5 });
    expect(s.notes.join(" ")).toMatch(/starting guess/);
  });
  it("x = 1, q = 2 with no q' equation and no constraint using q → named", () => {
    expect(err("x' = z; 0 = z - x", "x = 1, q = 2")).toMatch(/q has an initial value but no equation/);
  });
});

describe("refusals by name — a missing, extra or duplicated value", () => {
  it("missing", () => {
    expect(err("x' = u; u' = -x - z; 0 = z", "x = 1")).toMatch(/Missing an initial value for u/);
  });
  it("duplicated", () => {
    expect(err("x' = u; u' = -x - z; 0 = z", "x = 1, u = 0, x = 2")).toMatch(/x is given twice/);
    expect(err("y' = -z; 0 = z - y", "y = 1, z = 1", "z = 2")).toMatch(/z is given twice/);
  });
  it("a value that is not a constant", () => {
    expect(err("y' = -z; 0 = z - y", "y = x + 1")).toMatch(/must be a constant/);
  });
  it("a value that cannot be read is an error, not a skip", () => {
    expect(err("y' = -z; 0 = z - y", "y = 1/")).toMatch(/Couldn't read the value for y/);
    expect(err("y' = -z; 0 = z - y", "y 1")).toMatch(/Couldn't read "y 1"/);
  });
  it("x' given for a first-order x", () => {
    expect(err("x' = z; 0 = z - x", "x = 1, x' = 2")).toMatch(/x' is not a state/);
  });
  it("e, pi and t cannot be states", () => {
    expect(err("e' = z; 0 = z - 1", "e = 1")).toMatch(/Euler's number/);
    expect(err("pi' = z; 0 = z - 1", "pi = 1")).toMatch(/π/);
    expect(err("t' = z; 0 = z - 1", "t = 1")).toMatch(/independent variable/);
  });
  it("lam together with λ or lambda is refused (they would become one variable)", () => {
    expect(err("x' = lam; y' = λ; 0 = x - y; 0 = lam - 1", "x = 0, y = 0")).toMatch(/Both lam and λ/);
  });
  it("two equations for the same name", () => {
    expect(err("x' = z; x' = 1; 0 = z", "x = 0")).toMatch(/more than one differential equation/);
  });
  it("no constraint → the ODE solver; no differential equation → named", () => {
    expect(err("y' = -y", "y = 1")).toMatch(/ODE solver/);
    expect(err("0 = z - 1", "")).toMatch(/no differential equation/);
  });
  it("a derivative that is not a state, inside a constraint", () => {
    expect(err("x' = z; 0 = x' - 1", "x = 0")).toMatch(/x is order 1, so x' is not a state/);
  });
  it("more than 12 unknowns", () => {
    const eqs = Array.from({ length: 12 }, (_x, i) => `a${i}' = z${i}`).join("; ") + "; 0 = z0 - 1";
    expect(err(eqs, "")).toMatch(/cap is 12/);
  });
});
