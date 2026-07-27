// Adversarial bug test — systems of equations (systems.ts).
//
// Run before shipping. It found two defects, one of them a textbook confident
// wrong answer:
//
//   1. SPURIOUS DUPLICATE ROOTS. Where the Jacobian is singular at a root the
//      equations are FLAT there, so a residual under 1e-9 is satisfied by
//      points ~1e-4 away. Merging only at 1e-6 meant sin(x) = x — which has
//      exactly ONE real root — was reported as TWENTY-EIGHT distinct solutions,
//      and x^2 = y^2 = 0 reported the origin three times. Telling someone there
//      are 28 solutions when there is one is worse than finding none.
//   2. `e` and `pi` are CONSTANTS in this grammar, so `e = 4` quietly vanished
//      from the unknowns and the failure was then blamed on Newton needing as
//      many equations as unknowns. It now names the real problem.

import { solveSystem, splitEquations } from "../systems";

const S = (...eqs: string[]) => solveSystem(eqs);

describe("a single root is reported ONCE, however flat the equations are there", () => {
  it("sin(x) = x has one real root, not twenty-eight", () => {
    const r = S("sin(x) + y = 1", "x + y = 1")!;
    expect(r.kind).toBe("nonlinear");
    expect(r.numeric!.length).toBe(1);
  });
  it("x^2 = 0, y^2 = 0 is the origin, once", () => {
    const r = S("x^2 = 0", "y^2 = 0")!;
    expect(r.numeric!.length).toBe(1);
  });
  it("but genuinely DISTINCT roots are still kept apart", () => {
    const a = S("x^2 + y^2 = 25", "x + y = 7")!;
    expect(a.numeric!.length).toBe(2);
    const pts = a.numeric!.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort();
    expect(pts).toEqual(["3,4", "4,3"]);

    const b = S("x*y = 6", "x + y = 5")!;
    expect(b.numeric!.length).toBe(2);
  });
  it("the merge tolerance is disclosed rather than hidden", () => {
    expect(S("x^2 + y^2 = 25", "x + y = 7")!.caveats.join(" "))
      .toMatch(/closer together than about 1e-3 are reported as ONE/);
  });
});

describe("reserved constants are named, not silently dropped", () => {
  it("e as an unknown is refused with the real reason", () => {
    const r = S("a = 0", "e = 4")!;
    expect(r.kind).toBe("unsolved");
    expect(r.caveats.join(" ")).toMatch(/built-in CONSTANT/);
    expect(r.caveats.join(" ")).toMatch(/2\.71828/);
    expect(r.caveats.join(" ")).not.toMatch(/Newton/);
  });
  it("pi likewise", () => {
    expect(S("pi = 3", "x = 1")!.caveats.join(" ")).toMatch(/built-in CONSTANT/);
  });
  it("ordinary variable names are unaffected", () => {
    expect(S("a = 0", "b = 4")!.kind).toBe("unique");
  });
});

describe("degenerate linear systems are classified, not crashed on", () => {
  const CASES: [string, string[], string][] = [
    ["identity", ["x = x"], "infinite"],
    ["duplicate equations", ["x + y = 3", "x + y = 3"], "infinite"],
    ["all-zero coefficients", ["0*x + 0*y = 0"], "infinite"],
    ["zero coefficient, nonzero rhs", ["0*x = 5"], "none"],
    ["overdetermined but consistent", ["x = 1", "2*x = 2", "3*x = 3"], "unique"],
    ["overdetermined inconsistent", ["x = 1", "x = 2"], "none"],
    ["huge coefficients", ["1000000*x + y = 1000001", "x - y = 0"], "unique"],
    ["negative coefficients", ["-x - y = -3", "-x + y = -1"], "unique"],
  ];
  for (const [name, eqs, want] of CASES) {
    it(`${name} → ${want}`, () => {
      const r = solveSystem(eqs);
      expect(`${name}: ${r?.kind}`).toBe(`${name}: ${want}`);
    });
  }
  it("fractional coefficients stay exact through the reduction", () => {
    const r = S("x/7 + y/11 = 1/13", "x/3 - y/5 = 1/2")!;
    expect(r.kind).toBe("unique");
    // Exact rationals, not decimals.
    for (const v of Object.values(r.exact!)) expect(v).toMatch(/^-?\d+(\/\d+)?$/);
  });
});

describe("every solution is verified independently", () => {
  it("linear answers satisfy their own equations", () => {
    const CASES: string[][] = [
      ["x + y = 3", "x - y = 1"],
      ["x/3 + y/7 = 1", "x/3 - y/7 = 0"],
      ["x + y + z = 6", "2*x - y + z = 3", "x + 2*y - z = 2"],
    ];
    for (const eqs of CASES) {
      const r = solveSystem(eqs)!;
      expect(r.kind).toBe("unique");
      const sol = r.numeric![0];
      for (const eq of eqs) {
        const [l, rr] = eq.split("=");
        const env = Object.entries(sol).map(([k, v]) => `const ${k}=${v};`).join("");
        const resid = new Function(`${env}return (${l})-(${rr});`)() as number;
        expect(Math.abs(resid)).toBeLessThan(1e-9);
      }
    }
  });
  it("nonlinear answers satisfy their own equations", () => {
    for (const eqs of [["x^2 + y^2 = 25", "x + y = 7"], ["x*y = 6", "x + y = 5"]]) {
      const r = solveSystem(eqs)!;
      for (const sol of r.numeric!) {
        for (const eq of eqs) {
          const [l, rr] = eq.split("=");
          const env = Object.entries(sol).map(([k, v]) => `const ${k}=${v};`).join("");
          const resid = new Function(`${env}return (${l.replace(/\^/g, "**")})-(${rr.replace(/\^/g, "**")});`)() as number;
          expect(Math.abs(resid)).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe("timing and hostile input", () => {
  it("stays fast on larger linear systems", () => {
    const names = "abcdfghjkmnpqrstuvw".split("");
    const eqs = names.slice(0, 12).map((n, i) => `${n} = ${i}`);
    const t0 = Date.now();
    const r = solveSystem(eqs)!;
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.kind).toBe("unique");
  });
  it("nonlinear searches terminate", () => {
    for (const eqs of [
      ["x^2 + y^2 = 1", "x^2 + y^2 = 9"],
      ["exp(x) + y = 3", "x - y = 0"],
      ["x^2 + y + z = 3", "x + y^2 + z = 3", "x + y + z^2 = 3"],
    ]) {
      const t0 = Date.now();
      expect(() => solveSystem(eqs)).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(10000);
    }
  });
  it("an inconsistent nonlinear system finds nothing, and says why", () => {
    const r = S("x^2 + y^2 = 1", "x^2 + y^2 = 9")!;
    expect(r.kind).toBe("unsolved");
    expect(r.caveats.join(" ")).toMatch(/does NOT mean the system has no solution/);
  });
  it("malformed input returns null rather than guessing", () => {
    expect(solveSystem(["x == 1"])).toBeNull();
    expect(solveSystem(["x + = 3"])).toBeNull();
    expect(solveSystem([])).toBeNull();
    expect(splitEquations("   ")).toEqual([]);
  });
});
