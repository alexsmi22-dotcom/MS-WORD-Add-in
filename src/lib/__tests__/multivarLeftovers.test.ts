// v2.136.0 — the v2.130.0 multivariable leftovers (docs/SCOPE-SYMBOLIC-BATCH.md
// §B4, §D "Integration and multivariable", §E.4, §E.17): Lagrange by
// resultants, the near-pole positivity certificate, the arcsine double
// integrals, and the cosmetic folds in multivar's own S wrapper.

import { tryMultivar } from "../multivar";

const raw = (q: string) => {
  const v = tryMultivar(q);
  if (!v) throw new Error("not a verb: " + q);
  return v;
};
const run = (q: string) => {
  const v = raw(q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const timed = <T>(f: () => T): T => {
  const t = Date.now();
  const r = f();
  expect(Date.now() - t).toBeLessThan(4000);
  return r;
};

describe("§D Lagrange", () => {
  test("x*y on x^2 − y^2 = 1: no constrained critical point, by the tangency resultant", () => {
    const v = timed(() => run("lagrange x*y subject to x^2 - y^2 = 1"));
    const t = v.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/^No constrained critical point/);
    expect(t).toMatch(/T = f_x·g_y − f_y·g_x = -2\*x\^2 - 2\*y\^2 = 0/);
    expect(t).toMatch(/∇g ≠ 0 at every point of the curve/);
    expect(t).toMatch(/no local extremum/);
    expect(t).not.toMatch(/Maximum|minimum f/);
    expect(v.caveats.join(" ")).toMatch(/Sturm/);
  });
  for (const q of ["lagrange x*y subject to x^2 + y^2 = pi", "maximize x y subject to x^2 + y^2 = pi"]) {
    test(`${q}: max pi/2 at ±(sqrt(2*pi)/2, sqrt(2*pi)/2), min -pi/2, λ = ±1/2`, () => {
      const t = timed(() => text(q));
      expect(t).toMatch(/Maximum f = pi\/2 at \(sqrt\(2\*pi\)\/2, sqrt\(2\*pi\)\/2\) and \(-sqrt\(2\*pi\)\/2, -sqrt\(2\*pi\)\/2\)/);
      expect(t).toMatch(/minimum f = -pi\/2/);
      expect(t).toMatch(/λ = 1\/2/);
      expect(t).toMatch(/λ = -1\/2/);
    });
  }
  test("twin: maximize x*y subject to x^2 + y^2 = 2 → ±1 (unchanged)", () => {
    const t = text("maximize x*y subject to x^2 + y^2 = 2");
    expect(t).toMatch(/Maximum f = 1 at \(1, 1\) and \(-1, -1\); minimum f = -1/);
  });
});

describe("Lagrange adversarial", () => {
  test("irrational coordinates come out as exact radicals via the resultant", () => {
    const t = timed(() => text("lagrange x + y subject to x^2 + 2y^2 = 1"));
    expect(t).toMatch(/Maximum f = sqrt\(6\)\/2 at \(sqrt\(6\)\/3, sqrt\(6\)\/6\)/);
    expect(t).toMatch(/λ = sqrt\(6\)\/4/);
    const t2 = text("lagrange x*y subject to x^2 + 3*y^2 = 5");
    expect(t2).toMatch(/Maximum f = 5\*sqrt\(3\)\/6 at \(sqrt\(10\)\/2, sqrt\(30\)\/6\)/);
  });
  test("no real critical points on a nonempty curve: refused by name, never a guessed extremum", () => {
    const t = timed(() => text("lagrange x*y subject to x^2 - y^2 = 4"));
    expect(t).toMatch(/^No constrained critical point/);
  });
  test("a curve of critical points (f constant on the constraint) keeps the existing rule: no max/min declared", () => {
    const t = text("minimize x^2 + y^2 subject to x^2 + y^2 = 1");
    expect(t).toMatch(/at every candidate found/);
    expect(t).not.toMatch(/Maximum f/);
  });
  test("infinitely many critical points (a common factor: a whole line of tangency) are refused by name", () => {
    // g = (x − y)(x + y − 2) = 0 and T = 2(x − y): the line x = y is all critical.
    const v = timed(() => raw("lagrange x - y subject to x^2 - y^2 - 2x + 2y = 0"));
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/share a common factor .* continuum of critical points/);
  });
  test("no extremum on the lines y = ±1 for f = x (a degree-0 resultant)", () => {
    expect(text("lagrange x subject to y^2 = 1")).toMatch(/^No constrained critical point/);
  });
  test("an empty constraint set is still named before anything is solved", () => {
    expect(raw("lagrange x + y subject to x^2 + y^2 = -1").caveats[0]).toMatch(/NO real points/);
  });
  test("a higher-degree resultant: numeric coordinates verified, the max declared on the bounded circle", () => {
    const t = timed(() => text("lagrange x^3 + y subject to x^2 + y^2 = 1"));
    expect(t).toMatch(/Maximum f = 1\.172053752/);
    expect(t).toMatch(/\(0, 1\): f = 1, λ = 1\/2/);
  });
  test("an unbounded constraint: candidates only", () => {
    const v = run("lagrange x y subject to x - y = 1");
    expect(v.lines.map((l) => l.text).join("\n")).toMatch(/\(1\/2, -1\/2\): f = -1\/4/);
    expect(v.caveats.join(" ")).toMatch(/boundedness was not established/);
  });
});

describe("§D near-pole double integral (positivity certificate)", () => {
  test("1/((x-0.3)^2 + 1e-8) over the unit square = 31411.1646312692, no longer withheld", () => {
    const v = timed(() => run("double integral 1/((x-0.3)^2 + 1e-8) over x from 0 to 1, y from 0 to 1"));
    expect(v.lines[0].text).toMatch(/^≈ 31411\.1646/);
    expect(v.caveats.join(" ")).toMatch(/Narrow peak: .*≥ 1e-8 > 0 for every real x/);
    expect(v.caveats.join(" ")).toMatch(/adaptive Simpson split at the peak/);
  });
  test("the ε family 1e-2 … 1e-12 all agree with 10000-style closed forms", () => {
    for (let k = 2; k <= 12; k++) {
      const eps = 10 ** -k;
      const s = Math.sqrt(eps);
      const truth = (Math.atan(0.7 / s) + Math.atan(0.3 / s)) / s;
      const v = timed(() => run(`double integral 1/((x-0.3)^2 + 1e-${k}) over x from 0 to 1, y from 0 to 1`));
      const got = Number(/≈\s*(-?[\d.e+]+)/.exec(v.lines[0].text)![1]);
      expect(Math.abs(got - truth)).toBeLessThan(1e-8 * truth);
    }
  });
  test("a vertex landing exactly on a sample point (0.5, ε = 1e-14) is still a peak, not a pole", () => {
    const v = timed(() => run("double integral 1/((x-0.5)^2 + 1e-14) over x from 0 to 1, y from 0 to 1"));
    const s = 1e-7;
    expect(Number(/≈\s*([\d.e+]+)/.exec(v.lines[0].text)![1])).toBeCloseTo((2 * Math.atan(0.5 / s)) / s, -1);
  });
  test("1/x over (−1, 1) still refuses (no certificate for a real pole)", () => {
    expect(raw("double integral 1/x over x from -1 to 1, y from 0 to 1").lines).toHaveLength(0);
  });
  test("a denominator with REAL roots, (x-0.3)^2 − 1e-8, still refuses", () => {
    expect(raw("double integral 1/((x-0.3)^2 - 1e-8) over x from 0 to 1, y from 0 to 1").lines).toHaveLength(0);
  });
});

describe("§D arcsine double integrals", () => {
  test("over [0, 0.5]×[0, 1] → pi/6", () => {
    expect(run("double integral 1/sqrt(1-x^2) over x from 0 to 0.5, y from 0 to 1").lines[0].text).toBe("= pi/6");
  });
  test("over [0, 1]×[0, 1] → pi/2, improper at x = 1 and said", () => {
    const v = run("double integral 1/sqrt(1-x^2) over x from 0 to 1, y from 0 to 1");
    expect(v.lines[0].text).toBe("= pi/2");
    expect(v.caveats.join(" ")).toMatch(/Improper at x = 1: .* converges/);
  });
  test("over [−1, 1]×[0, 1] → pi, improper at both endpoints", () => {
    const v = timed(() => run("double integral 1/sqrt(1-x^2) over x from -1 to 1, y from 0 to 1"));
    expect(v.lines[0].text).toBe("= pi");
    expect(v.caveats.join(" ")).toMatch(/Improper at x = -1 and 1/);
  });
});

describe("§D cosmetics in multivar's S", () => {
  test("jacobian (r*cos(t), r*sin(t)) → det J = r", () => {
    expect(text("jacobian (r*cos(t), r*sin(t))")).toMatch(/det J = r$/m);
  });
  test("gradient x^y at (1, 1) → (1, 0), |∇f| = 1", () => {
    const t = text("gradient x^y at (1, 1)");
    expect(t).toMatch(/∇f\(1, 1\) = \(1, 0\)/);
    expect(t).toMatch(/\|∇f\| = 1$/m);
  });
  test("critical points x^y → (1, 0) saddle, D = -1", () => {
    expect(text("critical points x^y")).toMatch(/\(1, 0\): saddle point, f = 1\s+\(D = -1 < 0\)/);
  });
  test("the Pythagorean fold needs equal cofactors: r*cos(t)^2 + s*sin(t)^2 is left alone", () => {
    expect(text("jacobian (r*cos(t), s*sin(t)) in r, t")).not.toMatch(/det J = r$/m);
  });
});
