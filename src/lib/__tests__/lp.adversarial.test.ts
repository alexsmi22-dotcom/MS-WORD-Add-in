/**
 * Linear programming — the hostile pass (house rule: a separate adversarial
 * suite next to the acceptance audit). Degenerate cycling attempts, redundant
 * and equality-only systems, a 12 × 20 exact LP, enormous coefficients, free
 * variables, negative right-hand sides, vacuous and impossible rows, the
 * paste shape, and every stand-aside. Every input is timed; nothing over 1 s.
 */
import { parseExpr, evalAst } from "../solve";
import { tryLp, LP_VERB_RE, isLpInput } from "../lp";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 1000) throw new Error(`took ${dt} ms`);
  return r;
};
const run = (q: string) => {
  const v = timed(() => tryLp(q));
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = timed(() => tryLp(q));
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const mathLines = (q: string) => run(q).lines.filter((l) => l.math).map((l) => l.text);
const isNumeric = (rhs: string): boolean => {
  try {
    return Number.isFinite(evalAst(parseExpr(rhs), {}));
  } catch {
    return false;
  }
};
const first = (q: string, name: string): number => {
  const l = mathLines(q).find((m) => m.startsWith(`${name} = `) && isNumeric(m.slice(name.length + 3)));
  if (!l) throw new Error(`no ${name} in\n${text(q)}`);
  return evalAst(parseExpr(l.slice(name.length + 3)), {});
};
const last = (q: string, name: string): number => {
  const ls = mathLines(q).filter((m) => m.startsWith(`${name} = `) && isNumeric(m.slice(name.length + 3)));
  if (!ls.length) throw new Error(`no ${name} in\n${text(q)}`);
  return evalAst(parseExpr(ls[ls.length - 1].slice(name.length + 3)), {});
};
const status = (q: string): string => run(q).lines.map((l) => l.text).find((l) => l.startsWith("Status:")) ?? "";

describe("A: degeneracy and cycling", () => {
  it("Beale's cycling example terminates under Bland's rule: z = 5/4 at (1, 0, 1, 0)", () => {
    const q = "maximize 3/4*x4 - 20x5 + 1/2*x6 - 6x7 subject to 1/4*x4 - 8x5 - x6 + 9x7 <= 0, 1/2*x4 - 12x5 - 1/2*x6 + 3x7 <= 0, x6 <= 1, x4, x5, x6, x7 >= 0";
    expect(first(q, "x4")).toBe(1);
    expect(first(q, "x5")).toBe(0);
    expect(first(q, "x6")).toBe(1);
    expect(first(q, "x7")).toBe(0);
    expect(mathLines(q)).toContain("z = 5/4");
    expect(run(q).caveats.join(" ")).toContain("strong duality cᵀx* = bᵀy* = 5/4 exact");
  });
  it("the pivot count of Beale's example is finite and small (shown by the tableau noun)", () => {
    const c = run("simplex tableau for maximize 3/4*x4 - 20x5 + 1/2*x6 - 6x7 subject to 1/4*x4 - 8x5 - x6 + 9x7 <= 0, 1/2*x4 - 12x5 - 1/2*x6 + 3x7 <= 0, x6 <= 1, x4, x5, x6, x7 >= 0").caveats.join(" ");
    const m = /(\d+) pivots?/.exec(c)!;
    expect(Number(m[1])).toBeLessThan(20);
  });
  it("a degenerate 2-variable vertex: the tableau's duals are one valid set, said so", () => {
    const q = "maximize x + y subject to x <= 2, y <= 2, x + y <= 4, x, y >= 0";
    expect(first(q, "z")).toBe(4);
    expect(text(q)).toContain("Shadow prices are NOT unique here");
    expect(status(q)).toContain("DEGENERATE");
  });
});

describe("B: redundant and equality-only systems", () => {
  it("linearly dependent equalities: the duplicate is dropped in phase 1 and named", () => {
    const q = "maximize x + y subject to x + y = 4, 2x + 2y = 8, x, y >= 0";
    expect(first(q, "z")).toBe(4);
    expect(text(q)).toContain("Redundant (linearly dependent) constraint dropped in phase 1: 2x + 2y = 8");
    expect(status(q)).toContain("ALTERNATIVE OPTIMA");
  });
  it("equality-only system with one feasible point: (2, 2), z = 4, unique", () => {
    const q = "maximize x + y subject to x + y = 4, x - y = 0, x, y >= 0";
    expect(first(q, "x")).toBe(2);
    expect(first(q, "y")).toBe(2);
    expect(status(q)).toBe("Status: unique optimum.");
  });
  it("a truly redundant inequality is called redundant; a merely slack one is not", () => {
    const q = "maximize x + y subject to x <= 1, y <= 1, x + y <= 5, x, y >= 0";
    expect(text(q)).toContain("x + y ≤ 5 is redundant (slack 3, shadow price 0): the other constraints already imply it");
    expect(text("maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0")).toContain("x + 3y ≤ 6 is not binding here (slack 2, shadow price 0), but it does cut the feasible region elsewhere — not redundant.");
  });
});

describe("C: size and magnitude", () => {
  it("a 12-variable, 20-constraint LP with pseudo-random coefficients: optimal, exact strong duality, under 1 s", () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const vars = Array.from({ length: 12 }, (_, i) => `x${i + 1}`);
    const obj = vars.map((v) => `${rnd(9) + 1}*${v}`).join(" + ");
    const rows: string[] = [];
    for (let i = 0; i < 8; i++) rows.push(`${vars.map((v) => `${rnd(7) + 1}*${v}`).join(" + ")} <= ${rnd(50) + 50}`);
    for (let i = 0; i < 12; i++) rows.push(`${vars[i]} <= ${rnd(10) + 1}`);
    const q = `maximize ${obj} subject to ${rows.join(", ")}, ${vars.join(", ")} >= 0`;
    const v = run(q);
    expect(v.title).toContain("(12 variables, 20 constraints + non-negativity)");
    expect(v.caveats.join(" ")).toMatch(/strong duality cᵀx\* = bᵀy\* = [-\d/]+ exact/);
    expect(status(q)).toContain("optimum");
    // the optimum re-evaluates: every constraint holds at x* when recomputed here with plain numbers
    const x = vars.map((n) => first(q, n));
    for (const r of rows.slice(0, 8)) {
      const [lhs, rhs] = r.split(" <= ");
      const val = evalAst(parseExpr(lhs), Object.fromEntries(vars.map((n, i) => [n, x[i]])));
      expect(val).toBeLessThanOrEqual(Number(rhs) + 1e-9);
    }
  });
  it("15-digit coefficients stay exact (BigInt denominators in the duals)", () => {
    const q = "maximize 123456789012345x + 987654321098765y subject to 111111111111111x + 222222222222222y <= 999999999999999, 333333333333333x + 444444444444444y <= 888888888888888, x, y >= 0";
    expect(mathLines(q)).toContain("z = 1975308642197530");
    expect(text(q)).toContain("→ 987654321098765/444444444444444");
  });
  it("more than 15 significant digits is refused by name, not rounded", () => {
    expect(refusal("maximize 1234567890123456789x + y subject to x + y <= 4, x, y >= 0")).toContain("1234567890123456789 has more than 15 significant digits");
  });
  it("13 variables and 21 constraints are refused by name", () => {
    const vars = Array.from({ length: 13 }, (_, i) => `x${i + 1}`);
    expect(refusal(`maximize ${vars.join(" + ")} subject to ${vars.join(" + ")} <= 1, ${vars.join(", ")} >= 0`)).toContain("13 variables: up to 12 here");
    const rows = Array.from({ length: 21 }, (_, i) => `x + ${i + 1}y <= ${i + 10}`);
    expect(refusal(`maximize x + y subject to ${rows.join(", ")}, x, y >= 0`)).toContain("21 constraints: up to 20 here");
  });
});

describe("D: stand-asides and refusals by name", () => {
  it("maximize 3x + 2y with no constraints → usage refusal", () => {
    expect(refusal("maximize 3x + 2y")).toContain("No constraints");
    expect(refusal("max 3x + 2y")).toContain("No constraints");
  });
  it("nonlinear objective with equality constraints → null (Lagrange takes it)", () => {
    expect(tryLp("minimize x^2 + y^2 subject to x + y = 1")).toBeNull();
    expect(tryLp("maximize x*y subject to x + y = 4")).toBeNull();
    expect(tryLp("maximize x + y subject to x^2 + y^2 = 1")).toBeNull();
  });
  it("nonlinear with an inequality → refused by name", () => {
    expect(refusal("maximize x*y subject to x + y <= 4")).toContain("not linear: x*y");
    expect(refusal("maximize x^2 subject to x <= 3")).toContain("not linear: x^2");
    expect(refusal("maximize x + y subject to x*y <= 4, x, y >= 0")).toContain("This constraint is not linear: x*y (in “x*y <= 4”)");
    expect(refusal("maximize x + y subject to sin(x) <= 4, x, y >= 0")).toContain("not linear: sin(x)");
  });
  it("maximize f(x) = x^2 - 4x and bare calculus phrasings are not ours", () => {
    expect(tryLp("maximize f(x) = x^2 - 4x")).toBeNull();
    expect(tryLp("maximize x^2 - 4x")).toBeNull();
    expect(tryLp("minimum of x^2 + 1")).toBeNull();
    expect(tryLp("x + y <= 4")).toBeNull();
  });
  it("pi and lambda are reserved; e is a variable with a caveat", () => {
    expect(refusal("maximize pi*x + y subject to x + y <= 4, x, y >= 0")).toContain("“pi” (the constant π) cannot appear");
    expect(refusal("maximize lambda + y subject to lambda + y <= 4, lambda, y >= 0")).toContain("“lambda” is a reserved name");
    expect(run("maximize e + y subject to e + y <= 4, e, y >= 0").caveats.join(" ")).toContain("“e” is read as a variable here");
  });
  it("x1 and x_1 in one problem are two variables, said so", () => {
    const q = "maximize 3x1 + 2x_1 subject to x1 + x_1 <= 4, x1, x_1 >= 0";
    expect(run(q).caveats.join(" ")).toContain("Both spellings x1 and x_1 appear");
    expect(first(q, "x1")).toBe(4);
  });
  it("strict inequalities and ≠ are refused by name", () => {
    expect(refusal("maximize x + y subject to x + y < 4, x, y >= 0")).toContain("strict inequality (<)");
    expect(refusal("maximize x + y subject to x + y != 4, x, y >= 0")).toContain("uses ≠");
  });
  it("a noun without an LP, a chained mixed direction, a bare name without a relation", () => {
    // a noun with no objective after it belongs to another engine: stand aside, never refuse
    expect(tryLp("shadow prices for the problem above")).toBeNull();
    expect(isLpInput("shadow prices for the problem above")).toBe(false);
    expect(refusal("maximize x + y subject to 1 <= x >= 0, y >= 0")).toContain("mixes comparator directions");
    expect(refusal("maximize x + y subject to x + y <= 4, x, y")).toContain("was listed without a relation");
    expect(refusal("maximize x + y subject to x + y <= 4, x, y >= 0, w integer")).toContain("“w” is declared integer but does not appear");
  });
  it("a maximum-of-a-list request is NOT an LP: isLpInput false and tryLp null, both directions", () => {
    for (const q of ["max of 3, 5, 8", "max 3, 5, 8", "minimum of the list 4 2 9", "max 5", "min of 2 and 7", "maximize of 1, 2", "max 3 5 8"]) {
      expect(isLpInput(q)).toBe(false);
      expect(tryLp(q)).toBeNull();
    }
    for (const q of ["maximize 3x + 2y", "max 3x + 2y", "minimize 2x", "maximize z = 3x + 2y", "maximize profit 30x + 50y"]) {
      expect(isLpInput(q)).toBe(true);
      const v = tryLp(q);
      expect(v).not.toBeNull();
      expect(v!.lines.length).toBe(0);
      expect(v!.caveats.join(" ")).toContain("No constraints");
    }
  });
  it("graphically with 3 variables is refused by name; the guard is honest about bare objectives", () => {
    expect(refusal("graphically solve maximize x + y + z subject to x + y + z <= 1, x, y, z >= 0")).toContain("exactly two variables");
    expect(LP_VERB_RE.test("maximize 3x + 2y")).toBe(false);
    expect(isLpInput("maximize 3x + 2y")).toBe(true);
    expect(isLpInput("maximize x*y")).toBe(false);
    expect(tryLp("maximize x*y")).toBeNull();
  });
});

describe("E: rows that are not what they look like", () => {
  it("0x + 0y <= 5 is vacuous and dropped, said so", () => {
    const q = "maximize x + y subject to 0x + 0y <= 5, x + y <= 3, x, y >= 0";
    expect(first(q, "z")).toBe(3);
    expect(run(q).caveats.join(" ")).toContain("“0x + 0y ≤ 5” has no variable left once simplified (it reads 0 ≤ 5) — vacuous, dropped.");
    expect(run(q).title).toContain("1 constraint + non-negativity");
  });
  it("0x + 0y <= -1 is infeasible by name", () => {
    expect(text("maximize x + y subject to 0x + 0y <= -1, x + y <= 3, x, y >= 0")).toContain("INFEASIBLE: “0x + 0y ≤ −1” has no variable left once simplified and reads 0 ≤ −1, which never holds.");
  });
  it("a negative right-hand side is flipped for the tableau and the standard form says so", () => {
    const q = "maximize x + y subject to -x - y >= -4, x, y >= 0";
    expect(first(q, "z")).toBe(4);
    expect(text(q)).toContain("multiplied through by −1");
    expect(mathLines(q)).toContain("x + y + s1 = 4");
    expect(text(q)).not.toContain("artificial");
    expect(text(q)).toContain("−x − y ≥ −4 → −1");
  });
  it("x >= 2 is a constraint row, x >= 0 is a sign restriction, 0 <= x <= 3 is two rows", () => {
    const q = "maximize x + y subject to 0 <= x <= 3, 0 <= y <= 2";
    expect(first(q, "z")).toBe(5);
    expect(run(q).title).toContain("(2 variables, 2 constraints + non-negativity)");
    const q2 = "maximize x + y subject to x >= 2, x + y <= 4, x, y >= 0";
    expect(run(q2).title).toContain("2 constraints");
    expect(first(q2, "z")).toBe(4);
  });
  it("infeasible with 4+ constraints: the phase-1 wording", () => {
    const q = "maximize x + y subject to x + y <= 1, x + y >= 2, x - y <= 1, x - y >= -1, x, y >= 0";
    expect(text(q)).toContain("INFEASIBLE: phase 1 ended at w = 1 > 0 — the artificial variable a1 cannot be driven to 0");
    expect(run(q).caveats.join(" ")).toContain("no pair of constraint lines meets at a feasible point");
    expect(run(q).caveats.join(" ")).not.toContain("then phase 2");
  });
  it("infeasible against the sign restriction alone: one constraint named", () => {
    expect(text("maximize x + y subject to x + y <= -1, x, y >= 0")).toContain("INFEASIBLE: x + y ≤ −1 cannot hold with x, y ≥ 0.");
  });
});

describe("F: free variables, minimisation, the paste shape", () => {
  it("a free variable in a minimisation with = and ≥: (3, 1), z = 4", () => {
    const q = "minimize x + y subject to x - y = 2, x + y >= 4, x >= 0";
    expect(first(q, "x")).toBe(3);
    expect(first(q, "y")).toBe(1);
    expect(first(q, "z")).toBe(4);
    expect(text(q)).toContain("y is free (no sign restriction stated)");
    expect(run(q).title).toContain("partial sign restrictions");
  });
  it("minimize with every constraint ≥ requires phase 1 and says so", () => {
    const q = "minimize 3x + 2y subject to x + y >= 4, x + 3y >= 6, x, y >= 0, x <= 1";
    expect(first(q, "x")).toBe(0);
    expect(first(q, "y")).toBe(4);
    expect(first(q, "z")).toBe(8);
    expect(run(q).caveats.join(" ")).toContain("Phase 1 ran (artificial variables a1, a2 for the ≥ constraints)");
  });
  it("the dual of a minimisation, and a dual with a free variable for an equality row", () => {
    const q = "dual of minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0";
    expect(text(q)).toContain("maximize 4u + 6v subject to u + v <= 2, u + 3v <= 3, u, v >= 0");
    expect(first(q, "w")).toBe(9);
    const q2 = "dual of maximize 3x + 2y subject to x + y = 4, x + 3y <= 6, x, y >= 0";
    expect(text(q2)).toContain("minimize 4u + 6v subject to u + v >= 3, u + 3v >= 2, v >= 0, u free");
    expect(first(q2, "w")).toBe(12);
  });
  it("free variables with an optimal face that is a whole line: said, not called unique", () => {
    const q = "maximize x + y subject to x + y <= 4";
    expect(status(q)).toContain("the optimal set is unbounded");
    expect(first(q, "z")).toBe(4);
  });
  it("one per line, trailing sentence period, 'and' between constraints", () => {
    const q = "max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0.";
    expect(first(q, "x")).toBe(4);
    expect(first(q, "z")).toBe(12);
    const q2 = "maximize 3x + 2y subject to x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0";
    expect(first(q2, "z")).toBe(12);
    expect(LP_VERB_RE.test(q)).toBe(true);
  });
  it("the two-part answer is only given when sign restrictions are absent AND the problem is unbounded as typed", () => {
    expect(text("maximize x subject to x <= 4")).not.toContain("As stated");
    expect(run("maximize x subject to x <= 4").caveats.join(" ")).toContain("treated as free");
  });
});

describe("G: integers", () => {
  it("binary variables become 0 ≤ x ≤ 1 and integer, said so", () => {
    const q = "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0, x, y binary";
    expect(first(q, "z")).toBe(5);
    expect(run(q).caveats.join(" ")).toContain("x binary: read as 0 ≤ x ≤ 1 and integer");
  });
  it("branch-and-bound on a fractional relaxation, cross-checked by lattice search", () => {
    const q = "maximize x + y subject to x + y <= 3.5, x, y >= 0, x and y integer";
    expect(text(q)).toContain("LP relaxation (integrality ignored): optimum (7/2, 0), z = 7/2");
    expect(text(q)).toContain("Integer optimum: (3, 0), z = 3. Verified against an exhaustive search");
    expect(last(q, "z")).toBe(3);
  });
  it("integer with more than 4 variables: relaxation only, by name", () => {
    const q = "maximize a + 2b + 3c + d + e subject to a + b + c + d + e <= 7/2, a, b, c, d, e >= 0, a, b, c, d, e integer";
    expect(text(q)).toContain("LP relaxation only; the integer optimum was not searched");
  });
  it("x in Z and 'x integer, y integer' spellings; an already-integral relaxation is the answer", () => {
    for (const q of ["maximize 2x + 3y subject to x + y <= 4, x, y >= 0, x, y integer", "maximize 2x + 3y subject to x + y <= 4, x, y >= 0, x integer, y integer", "maximize 2x + 3y subject to x + y <= 4, x, y >= 0, x, y in Z"]) {
      expect(text(q)).toContain("the LP relaxation is already integral, so it is the integer optimum");
      expect(first(q, "z")).toBe(12);
    }
  });
});

describe("I: the dual is mapped back by NAME, never by position", () => {
  it("dual of … with b_i = 0 and an equality row: the review's two cases", () => {
    const q1 = "dual of maximize 3x + 2y subject to x - y <= 0, x + y <= 4, x, y >= 0";
    expect(mathLines(q1)).toContain("u = 1/2");
    expect(mathLines(q1)).toContain("v = 5/2");
    expect(text(q1)).toContain("0u + 4v");
    expect(run(q1).caveats.join(" ")).not.toMatch(/alternative optima/);
    const q2 = "dual of minimize -4x + 5y subject to 4x + 3y >= 0, x + 3y = 10, x, y >= 0";
    expect(mathLines(q2)).toContain("u = 0");
    expect(mathLines(q2)).toContain("v = -4");
  });
  it("three rows: dual variables u1, u2, u3 and ONE objective line w", () => {
    const q = "dual of maximize 5x + 3y subject to 3x - y <= 12, 4x + 5y <= 8, x - y <= 9, x, y >= 0";
    expect(mathLines(q).filter((l) => l.startsWith("w = "))).toHaveLength(1);
    expect(mathLines(q).some((l) => l.startsWith("u3 = "))).toBe(true);
    // a primal variable called w: the dual objective steps aside
    const q3 = "dual of maximize w + y subject to w + y <= 4, w, y >= 0";
    expect(mathLines(q3).some((l) => l.startsWith("w_dual = "))).toBe(true);
  });
  it("60 random LPs with zeros in b and mixed row types: the printed dual vector equals the printed shadow prices, by constraint", () => {
    let seed = 777;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    let compared = 0;
    for (let k = 0; k < 400 && compared < 80; k++) {
      const n = 2 + rnd(2);
      const m = 2 + rnd(2);
      const vars = ["x", "y", "z"].slice(0, n);
      const sense = rnd(2) ? "maximize" : "minimize";
      const c = vars.map(() => rnd(7) - 3);
      const rows: string[] = [];
      // a bounding box keeps most problems feasible and bounded; the other rows mix ≤ / ≥ / = with zeros in b
      rows.push(`${vars.map((v) => `1*${v}`).join(" + ")} <= ${4 + rnd(6)}`);
      for (let i = 1; i < m; i++) {
        const a = vars.map(() => rnd(7) - 3);
        const rel = ["<=", ">=", "=", "<="][rnd(4)];
        const b = rnd(3) === 0 ? 0 : rnd(7);
        rows.push(`${vars.map((v, j) => `${a[j]}*${v}`).join(" + ")} ${rel} ${b}`);
      }
      const q = `dual of ${sense} ${vars.map((v, j) => `${c[j]}*${v}`).join(" + ")} subject to ${rows.join(", ")}, ${vars.join(", ")} >= 0`;
      const v = timed(() => tryLp(q));
      if (!v || !v.lines.length) continue;
      const t = v.lines.map((l) => l.text).join("\n");
      if (!/Dual optimum:/.test(t) || !/Status: unique optimum\.$/m.test(t)) continue;
      const shadow = /Shadow prices \(dual values[^)]*\): (.*)/.exec(t)![1].split("; ").map((s) => s.split(" → ")[1]);
      const dualOpt = /the dual optimum \(([^)]*)\)/.exec(t)![1].split(", ");
      expect(dualOpt).toEqual(shadow);
      expect(v.caveats.join(" ")).not.toMatch(/alternative optima/);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(50);
  });
});

describe("H: the figure under every status", () => {
  it("unbounded: the ray; infeasible: half-planes and 'empty'; equality: the segment", () => {
    expect(run("maximize x + y subject to x - y <= 1, x >= 0, y >= 0").svg).toContain("unbounded along this ray");
    const inf = run("maximize x + y subject to x + y <= 1, x + y >= 2, x, y >= 0").svg!;
    expect(inf).toContain("feasible region: empty");
    expect(inf).toContain("x + y ≤ 1");
    expect(inf).toContain("x + y ≥ 2");
    expect(run("maximize 3x + 2y subject to x + y = 4, x + 3y <= 6, x, y >= 0").svg).toContain("<polyline");
  });
  it("the standard-form noun draws nothing", () => {
    expect(run("standard form of maximize 3x + 2y subject to x + y <= 4, x, y >= 0").svg).toBeUndefined();
  });
});
