// Expression-evaluator function library tests.
//
// evalFormula backs the ODE right-hand sides, the optimizer objective, plot
// expressions and uncertainty propagation, so a regression here is felt in four
// places at once. The old vocabulary (sqrt/exp/ln/log/sin/cos/tan/abs) is
// re-asserted alongside the new to keep this backward compatible.

import { evalFormula, EXPR_FUNCTIONS } from "../stats";

const ev = (s: string, v: Record<string, number> = {}) => evalFormula(s, v);

describe("original vocabulary still works exactly as before", () => {
  test.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["2^3^2", 512], // right-associative
    ["-2^2", -4], // unary minus binds looser than ^
    ["2^-1", 0.5],
    ["sqrt(16)", 4],
    ["exp(0)", 1],
    ["ln(1)", 0],
    ["log(100)", 2],
    ["abs(-3)", 3],
    ["10/4", 2.5],
  ])("%s = %p", (expr, want) => expect(ev(expr)).toBeCloseTo(want, 10));

  test("variables and constants", () => {
    expect(ev("x*y", { x: 3, y: 4 })).toBe(12);
    expect(ev("pi")).toBeCloseTo(Math.PI, 12);
    expect(ev("e")).toBeCloseTo(Math.E, 12);
  });

  test("user variables still shadow the built-in constants", () => {
    expect(ev("e", { e: 1.602 })).toBe(1.602);
    expect(ev("pi", { pi: 3 })).toBe(3);
  });

  test("unknown names still throw", () => {
    expect(() => ev("nope")).toThrow(/Unknown variable/);
    expect(() => ev("frobnicate(1)")).toThrow(/Unknown function/);
    expect(() => ev("(1+2")).toThrow(/Unbalanced/);
  });
});

describe("new: inverse trig and hyperbolics", () => {
  test.each([
    ["asin(1)", Math.PI / 2],
    ["acos(1)", 0],
    ["atan(1)", Math.PI / 4],
    ["sinh(0)", 0],
    ["cosh(0)", 1],
    ["tanh(0)", 0],
    ["asinh(0)", 0],
    ["acosh(1)", 0],
    ["atanh(0)", 0],
  ])("%s = %p", (expr, want) => expect(ev(expr)).toBeCloseTo(want, 10));

  test("tanh saturates as expected — a real ODE right-hand side", () => {
    expect(ev("tanh(10)")).toBeCloseTo(1, 6);
    expect(ev("tanh(-10)")).toBeCloseTo(-1, 6);
  });
});

describe("new: logs, roots, rounding", () => {
  test.each([
    ["cbrt(27)", 3],
    ["log2(8)", 3],
    ["log10(1000)", 3],
    ["logbase(8, 2)", 3],
    ["logbase(81, 3)", 4],
    ["floor(2.7)", 2],
    ["ceil(2.1)", 3],
    ["round(2.5)", 3],
    ["trunc(-2.7)", -2],
    ["sign(-5)", -1],
    ["sgn(5)", 1],
  ])("%s = %p", (expr, want) => expect(ev(expr)).toBeCloseTo(want, 10));
});

describe("new: multi-argument functions", () => {
  test.each([
    ["min(3, 5)", 3],
    ["max(3, 5)", 5],
    ["max(0, -2)", 0], // the ReLU idiom
    ["hypot(3, 4)", 5],
    ["pow(2, 10)", 1024],
    ["atan2(1, 1)", Math.PI / 4],
    ["clamp(15, 0, 10)", 10],
    ["clamp(-5, 0, 10)", 0],
    ["clamp(5, 0, 10)", 5],
  ])("%s = %p", (expr, want) => expect(ev(expr)).toBeCloseTo(want, 10));

  test("mod is a TRUE modulo — the sign follows the divisor, unlike JS %", () => {
    expect(ev("mod(7, 3)")).toBe(1);
    expect(ev("mod(-1, 3)")).toBe(2); // JS -1 % 3 would give -1
    expect(ev("mod(5.5, 2)")).toBeCloseTo(1.5, 10);
  });

  test("arity is enforced with a clear message", () => {
    expect(() => ev("min(1)")).toThrow(/takes 2 arguments/);
    expect(() => ev("sqrt(1, 2)")).toThrow(/takes 1 argument/);
    expect(() => ev("clamp(1, 2)")).toThrow(/takes 3 arguments/);
  });

  test("nested and composed calls", () => {
    expect(ev("max(min(5, 3), 1)")).toBe(3);
    expect(ev("sqrt(pow(3, 2) + pow(4, 2))")).toBe(5);
    expect(ev("min(x, y) + max(x, y)", { x: 2, y: 7 })).toBe(9);
  });
});

describe("new: comparisons and piecewise definitions", () => {
  test.each([
    ["1 < 2", 1],
    ["2 < 1", 0],
    ["2 > 1", 1],
    ["1 <= 1", 1],
    ["1 >= 2", 0],
    ["1 == 1", 1],
    ["1 != 1", 0],
    ["2 != 1", 1],
  ])("%s = %p", (expr, want) => expect(ev(expr)).toBe(want));

  test("two-character operators are not mis-split into one-character ones", () => {
    // "<=" must not parse as "<" then a stray "="
    expect(ev("2 <= 2")).toBe(1);
    expect(ev("3 >= 4")).toBe(0);
  });

  test("comparisons have lower precedence than arithmetic", () => {
    expect(ev("1 + 1 == 2")).toBe(1);
    expect(ev("2 * 3 > 5")).toBe(1);
  });

  test("if(cond, a, b) drives piecewise right-hand sides", () => {
    expect(ev("if(1, 10, 20)")).toBe(10);
    expect(ev("if(0, 10, 20)")).toBe(20);
    expect(ev("if(t < 2, 1, 0)", { t: 1 })).toBe(1);
    expect(ev("if(t < 2, 1, 0)", { t: 3 })).toBe(0);
  });

  test("step() is a Heaviside function", () => {
    expect(ev("step(-0.1)")).toBe(0);
    expect(ev("step(0)")).toBe(1);
    expect(ev("step(5)")).toBe(1);
  });

  test("a realistic switching input composes cleanly", () => {
    // A pulse: on between t=1 and t=3.
    const pulse = "if(t >= 1, 1, 0) * if(t <= 3, 1, 0)";
    expect(ev(pulse, { t: 0 })).toBe(0);
    expect(ev(pulse, { t: 2 })).toBe(1);
    expect(ev(pulse, { t: 4 })).toBe(0);
  });
});

describe("the advertised function list is real", () => {
  test("every name in EXPR_FUNCTIONS actually evaluates", () => {
    // Guards against documenting a function the evaluator does not have.
    const arity1Arg = "0.5";
    for (const name of EXPR_FUNCTIONS) {
      const tries = [`${name}(${arity1Arg})`, `${name}(${arity1Arg}, 2)`, `${name}(${arity1Arg}, 0, 2)`];
      const anyWorks = tries.some((t) => {
        try {
          const v = evalFormula(t, {});
          return typeof v === "number";
        } catch {
          return false;
        }
      });
      expect(anyWorks).toBe(true);
    }
  });

  test("the list is non-trivial and sorted", () => {
    expect(EXPR_FUNCTIONS.length).toBeGreaterThan(25);
    expect([...EXPR_FUNCTIONS].sort()).toEqual(EXPR_FUNCTIONS);
  });
});
