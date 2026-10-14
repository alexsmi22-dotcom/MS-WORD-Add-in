/**
 * Linear programming — the acceptance audit from docs/SCOPE-LP-SPLINES.md §D
 * (LP rows). Every expected value there was computed independently of the
 * engine (own exact vertex enumeration); the strings are pinned verbatim.
 */
import { parseExpr, evalAst } from "../solve";
import { tryLp, LP_VERB_RE, isLpInput } from "../lp";

const MINUS = "−";

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
  if (v.lines.length) throw new Error("answered, not refused: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const mathLines = (q: string) => run(q).lines.filter((l) => l.math).map((l) => l.text);
/** A math line "name = <number>" (the standard-form line "z = 3x + 2y" is not one). */
const isNumeric = (rhs: string): boolean => {
  try {
    return Number.isFinite(evalAst(parseExpr(rhs), {}));
  } catch {
    return false;
  }
};
/** The value of the FIRST numeric math line "name = …". */
const first = (q: string, name: string): number => {
  const l = mathLines(q).find((m) => m.startsWith(`${name} = `) && isNumeric(m.slice(name.length + 3)));
  if (!l) throw new Error(`no math line ${name} = number in\n${text(q)}`);
  return evalAst(parseExpr(l.slice(name.length + 3)), {});
};
/** The value of the LAST numeric math line "name = …". */
const last = (q: string, name: string): number => {
  const ls = mathLines(q).filter((m) => m.startsWith(`${name} = `) && isNumeric(m.slice(name.length + 3)));
  if (!ls.length) throw new Error(`no math line ${name} = number in\n${text(q)}`);
  return evalAst(parseExpr(ls[ls.length - 1].slice(name.length + 3)), {});
};
/** A hyphen used as a MINUS (not the joiner in "Right-hand-side"). */
const HYPHEN_MINUS = /(^|[\s(=,:])-[\d(A-Za-z]/;
/** Display contract: every math line re-parses (both sides of its "=") and no string mixes minus glyphs. */
const contract = (q: string): void => {
  const v = run(q);
  for (const l of v.lines) {
    expect(HYPHEN_MINUS.test(l.text) && l.text.includes(MINUS)).toBe(false);
    if (!l.math) continue;
    const [lhs, rhs] = l.text.split(" = ");
    expect(() => parseExpr(lhs)).not.toThrow();
    expect(() => parseExpr(rhs)).not.toThrow();
    expect(l.text.includes(MINUS)).toBe(false);
  }
};

const BASE = "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0";

describe("§D — the base problem, pinned", () => {
  it("x = 4, y = 0, z = 12, unique, binding x + y ≤ 4, slacks 0 and 2", () => {
    expect(first(BASE, "x")).toBe(4);
    expect(first(BASE, "y")).toBe(0);
    expect(first(BASE, "z")).toBe(12);
    const t = text(BASE);
    expect(t).toContain("Status: unique optimum.");
    expect(t).toContain("x + y ≤ 4: LHS 4, bound 4, slack 0 — binding");
    expect(t).toContain("x + 3y ≤ 6: LHS 4, bound 6, slack 2 — not binding");
  });
  it("title names the objective and the shape", () => {
    expect(run(BASE).title).toBe("Linear program — maximize 3x + 2y (2 variables, 2 constraints + non-negativity)");
  });
  it("shadow prices (3, 0), reduced cost of y = −1", () => {
    const t = text(BASE);
    expect(t).toContain("Shadow prices (dual values, ∂z*/∂b): x + y ≤ 4 → 3; x + 3y ≤ 6 → 0");
    expect(t).toContain("Reduced costs (c_j − z_j): x: 0 (basic); y: −1");
  });
  it("objective ranges c_x ∈ [2, ∞), c_y ∈ (−∞, 3]; RHS range of 4 is [0, 6]", () => {
    const t = text(BASE);
    expect(t).toContain("c_x ∈ [2, ∞); c_y ∈ (−∞, 3]");
    expect(t).toContain("x + y ≤ 4: b ∈ [0, 6]");
  });
  it("standard form names the slacks s1, s2", () => {
    const m = mathLines(BASE);
    expect(m).toContain("x + y + s1 = 4");
    expect(m).toContain("x + 3y + s2 = 6");
    expect(text(BASE)).toContain("x, y, s1, s2 ≥ 0");
  });
  it("verification is stated, including the independent vertex enumeration", () => {
    const c = run(BASE).caveats.join(" ");
    expect(c).toContain("strong duality cᵀx* = bᵀy* = 12 exact");
    expect(c).toContain("independent vertex enumeration");
  });
  it("a non-binding constraint that still cuts the region is NOT called redundant", () => {
    expect(text(BASE)).toContain("x + 3y ≤ 6 is not binding here (slack 2, shadow price 0), but it does cut the feasible region elsewhere — not redundant.");
  });
});

describe("§D — spellings that must give the identical answer", () => {
  const VARIANTS = [
    "maximize 3x + 2y s.t. x + y <= 4, x + 3y <= 6, x, y >= 0",
    "max 3x + 2y\nx + y <= 4\nx + 3y <= 6\nx, y >= 0",
    "maximize z = 3x + 2y subject to x + y ≤ 4, x + 3y ≤ 6, x, y ≥ 0",
    "maximize 3x + 2y subject to x + y =< 4, x + 3y =< 6, x, y => 0",
    "maximize 3x + 2y subject to x + y ≦ 4, x + 3y ≦ 6, x, y ≧ 0",
    "maximize 3x + 2y subject to x + y <= 4; x + 3y <= 6; x, y >= 0",
    "LP: max 3x+2y st x+y<=4, x+3y<=6, x>=0, y>=0",
    "maximize 3x + 2y such that x + y <= 4, x + 3y <= 6, x, y >= 0",
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, with x, y nonnegative",
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x and y >= 0",
    "Maximise 3x + 2y subject to the constraints x + y <= 4, x + 3y <= 6, x, y >= 0.",
  ];
  const base = run(BASE);
  for (const q of VARIANTS) {
    it(q.replace(/\n/g, " ⏎ "), () => {
      const v = run(q);
      expect(v.lines).toEqual(base.lines);
      expect(v.title).toBe(base.title);
    });
  }
  it("the guard claims every variant on the raw text", () => {
    for (const q of [BASE, ...VARIANTS]) expect(LP_VERB_RE.test(q)).toBe(true);
  });
});

describe("§D — the nouns", () => {
  it("shadow prices for … leads with (3, 0)", () => {
    const v = run("shadow prices for " + BASE);
    const ls = v.lines.map((l) => l.text);
    const shadow = ls.findIndex((l) => l.startsWith("Shadow prices"));
    const table = ls.findIndex((l) => l.startsWith("At the optimum"));
    expect(shadow).toBeGreaterThan(0);
    expect(shadow).toBeLessThan(table);
    expect(ls[shadow]).toBe("Shadow prices (dual values, ∂z*/∂b): x + y ≤ 4 → 3; x + 3y ≤ 6 → 0");
  });
  it("dual of … prints the dual LP in Solve grammar and solves both: z* = w* = 12 at (3, 0)", () => {
    const q = "dual of maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0";
    const t = text(q);
    expect(t).toContain("minimize 4u + 6v subject to u + v >= 3, u + 3v >= 2, u, v >= 0");
    expect(first(q, "u")).toBe(3);
    expect(first(q, "v")).toBe(0);
    expect(first(q, "w")).toBe(12);
    expect(t).toContain("Strong duality: z* = w* = 12");
    // the printed dual re-parses through the LP grammar itself
    expect(first("minimize 4u + 6v subject to u + v >= 3, u + 3v >= 2, u, v >= 0", "z")).toBe(12);
  });
  it("sensitivity analysis / reduced costs lead with their section", () => {
    const s = run("sensitivity analysis " + BASE).lines.map((l) => l.text);
    expect(s.findIndex((l) => l.startsWith("Objective-coefficient ranges"))).toBeLessThan(s.findIndex((l) => l.startsWith("At the optimum")));
    const r = run("reduced costs for " + BASE).lines.map((l) => l.text);
    expect(r.findIndex((l) => l.startsWith("Reduced costs"))).toBeLessThan(r.findIndex((l) => l.startsWith("Shadow prices")));
  });
  it("simplex tableau for … prints the initial and final tableaux, exact", () => {
    const t = text("simplex tableau for " + BASE);
    expect(t).toContain("Initial tableau:");
    expect(t).toContain("Final tableau:");
    expect(t).toMatch(/basis\s+x\s+y\s+s1\s+s2\s+rhs/);
    expect(t).toMatch(/s2\s+0\s+2\s+−1\s+1\s+2/);
    expect(t).toMatch(/z\s+0\s+1\s+3\s+0\s+12/);
  });
  it("graphically solve … forces the figure; refuses 3+ variables by name", () => {
    const v = run("graphically solve " + BASE);
    expect(v.svg).toContain("<svg");
    expect(refusal("graphically solve maximize x + y + z subject to x + y + z <= 1, x, y, z >= 0")).toContain("exactly two variables; this problem has 3 (x, y, z)");
  });
  it("standard form of … converts and STOPS — never \"x ∈ refused\"", () => {
    const q = "standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2";
    const v = run(q);
    const t = text(q);
    expect(t).not.toContain("refused");
    expect(mathLines(q)).toContain("x + y + s1 = 4");
    expect(mathLines(q)).toContain("-x + y + s2 = 2");
    expect(t).toContain("x is free (no sign restriction stated): x = x' − x'' with x', x'' ≥ 0");
    expect(v.caveats.join(" ")).toContain("Conversion only — nothing was solved");
    expect(mathLines(q).some((m) => /^z = -?\d+(\/\d+)?$/.test(m))).toBe(false);
  });
});

describe("§D — minimisation and phase 1", () => {
  const Q = "minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0";
  it("(3, 1), z = 9, duals (3/2, 1/2), phase 1 stated", () => {
    expect(first(Q, "x")).toBe(3);
    expect(first(Q, "y")).toBe(1);
    expect(first(Q, "z")).toBe(9);
    expect(text(Q)).toContain("x + y ≥ 4 → 3/2; x + 3y ≥ 6 → 1/2");
    expect(run(Q).caveats.join(" ")).toContain("Phase 1 ran (artificial variables a1, a2 for the ≥ constraints)");
  });
  it("two phase simplex … shows the phase-1 tableau and the same answer", () => {
    const q = "two phase simplex " + Q;
    expect(text(q)).toContain("Phase 1 — initial tableau (maximise −Σ artificials):");
    expect(text(q)).toContain("Phase 1 — final tableau:");
    expect(first(q, "x")).toBe(3);
    expect(first(q, "z")).toBe(9);
  });
});

describe("§D — three variables, both subscript spellings", () => {
  const Q = "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0";
  it("(0, 100, 230), z = 1350, duals (1, 2, 0), reduced cost of x1 = −4", () => {
    expect(first(Q, "x1")).toBe(0);
    expect(first(Q, "x2")).toBe(100);
    expect(first(Q, "x3")).toBe(230);
    expect(first(Q, "z")).toBe(1350);
    expect(text(Q)).toContain("x1 + 2*x2 + x3 ≤ 430 → 1; 3*x1 + 2*x3 ≤ 460 → 2; x1 + 4*x2 ≤ 420 → 0");
    expect(text(Q)).toContain("x1: −4");
  });
  it("the x_1 spelling is identical in value", () => {
    const q = Q.replace(/x(\d)/g, "x_$1");
    expect(first(q, "x_1")).toBe(0);
    expect(first(q, "x_2")).toBe(100);
    expect(first(q, "x_3")).toBe(230);
    expect(first(q, "z")).toBe(1350);
    expect(text(q)).toContain("x_1: −4");
  });
  it("n ≥ 3 draws the bar chart of x* and the slacks", () => {
    const v = run(Q);
    expect(v.svg).toContain("<svg");
    expect(v.svg).toContain("slack:");
  });
});

describe("§D — unbounded, infeasible, alternative, degenerate, equality", () => {
  it("unbounded: ray (1 + t, t)", () => {
    const q = "maximize x + y subject to x - y <= 1, x >= 0, y >= 0";
    expect(text(q)).toContain("UNBOUNDED: along the ray below (t ≥ 0) the objective 1 + 2t grows without bound.");
    expect(mathLines(q)).toContain("x = 1 + t");
    expect(mathLines(q)).toContain("y = t");
    expect(run(q).svg).toContain("unbounded along this ray");
  });
  it("infeasible: the two constraints named", () => {
    const q = "maximize x + y subject to x + y <= 1, x + y >= 2, x, y >= 0";
    expect(text(q)).toContain("INFEASIBLE: x + y ≤ 1 and x + y ≥ 2 cannot both hold with x, y ≥ 0.");
    const v = run(q);
    expect(v.svg).toContain("feasible region: empty");
    expect(v.svg).not.toContain('<polygon points="');
  });
  it("alternative optima on the edge (1, 3)–(3, 1), z = 8", () => {
    const q = "maximize 2x + 2y subject to x + y <= 4, x <= 3, y <= 3, x, y >= 0";
    expect(first(q, "z")).toBe(8);
    const status = run(q).lines.map((l) => l.text).find((l) => l.startsWith("Status:"))!;
    expect(status).toContain("ALTERNATIVE OPTIMA along the edge from");
    expect(status).toContain("(3, 1)");
    expect(status).toContain("(1, 3)");
    expect(status).toContain("every point on it gives z = 8");
    expect(run(q).svg).toContain('stroke-width="4"');
  });
  it("degenerate vertex (0, 2), z = 18: shadow prices not unique, by name", () => {
    const q = "maximize 3x + 9y subject to x + 4y <= 8, x + 2y <= 4, x, y >= 0";
    expect(first(q, "x")).toBe(0);
    expect(first(q, "y")).toBe(2);
    expect(first(q, "z")).toBe(18);
    const t = text(q);
    expect(t).toContain("DEGENERATE vertex (3 constraints meet at (0, 2)");
    expect(t).toContain("Shadow prices are NOT unique here");
    expect(t).toContain("Sensitivity ranges are not given");
  });
  it("equality constraint: (4, 0), z = 12, artificial variable in phase 1", () => {
    const q = "maximize 3x + 2y subject to x + y = 4, x + 3y <= 6, x, y >= 0";
    expect(first(q, "x")).toBe(4);
    expect(first(q, "z")).toBe(12);
    expect(run(q).caveats.join(" ")).toContain("artificial variable a1 for the = constraints");
    expect(text(q)).toContain("1 artificial variable a1 for phase 1");
  });
});

describe("§D — non-negativity not stated: both answers, labelled", () => {
  for (const q of ["maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6", "maximize 3x + 2y given x + y = 4"]) {
    it(q, () => {
      const t = text(q);
      expect(t).toContain("As stated (no sign restriction): UNBOUNDED");
      expect(mathLines(q)).toContain("x = 4 + t");
      expect(mathLines(q)).toContain("y = -t");
      expect(t).toContain("With x, y ≥ 0 (the textbook convention, which you did not state): optimum (4, 0), z = 12");
      expect(last(q, "x")).toBe(4);
      expect(last(q, "y")).toBe(0);
      expect(last(q, "z")).toBe(12);
      expect(run(q).caveats.join(" ")).toContain("Two answers because the sign restrictions were not stated");
    });
  }
});

describe("§D — Taha, integer, named objective, diet, more variables", () => {
  const TAHA = "maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0";
  it("Taha: (3, 3/2), z = 21, duals (3/4, 1/2, 0, 0)", () => {
    expect(first(TAHA, "x")).toBe(3);
    expect(first(TAHA, "y")).toBe(1.5);
    expect(first(TAHA, "z")).toBe(21);
    expect(mathLines(TAHA)).toContain("y = 3/2");
    expect(text(TAHA)).toContain("6x + 4y ≤ 24 → 3/4; x + 2y ≤ 6 → 1/2; −x + y ≤ 1 → 0; y ≤ 2 → 0");
  });
  it("… x and y integer: relaxation (3, 3/2) z = 21; tree with (3, 1) 19, (2, 2) 18, (4, 0) 20 — integer optimum (4, 0), z = 20", () => {
    const q = TAHA + ", x and y integer";
    const t = text(q);
    expect(t).toContain("LP relaxation (integrality ignored): optimum (3, 3/2), z = 21");
    expect(t).toContain("(3, 1), z = 19");
    expect(t).toContain("(2, 2), z = 18");
    expect(t).toContain("(4, 0), z = 20");
    expect(t).toContain("Integer optimum: (4, 0), z = 20.");
    expect(t).toContain("Verified against an exhaustive search of the integer points");
    expect(last(q, "x")).toBe(4);
    expect(last(q, "y")).toBe(0);
    expect(last(q, "z")).toBe(20);
    expect(run(q).svg).toContain("integer optimum");
  });
  it("Maximize P = 40x + 30y …: (4, 8), P = 400, duals (20, 10)", () => {
    const q = "Maximize P = 40x + 30y subject to x + y ≤ 12, 2x + y ≤ 16, x ≥ 0, y ≥ 0";
    expect(first(q, "x")).toBe(4);
    expect(first(q, "y")).toBe(8);
    expect(first(q, "P")).toBe(400);
    expect(text(q)).toContain("x + y ≤ 12 → 20; 2x + y ≤ 16 → 10");
    expect(mathLines(q)).toContain("P = 40x + 30y");
  });
  it("diet problem: (15/4, 0), z = 9/4, duals (0, 3/20) — decimals read exactly", () => {
    const q = "diet problem: minimize cost 0.6x + 0.35y subject to 5x + 7y >= 8, 4x + 2y >= 15, x, y >= 0";
    expect(mathLines(q)).toContain("x = 15/4");
    expect(mathLines(q)).toContain("y = 0");
    expect(mathLines(q)).toContain("z = 9/4");
    expect(text(q)).toContain("5x + 7y ≥ 8 → 0; 4x + 2y ≥ 15 → 3/20");
    expect(isLpInput(q)).toBe(true);
  });
  it("maximize 3x + 2y + z …: (10, 0, 0), objective 30 (z is a variable, so the objective is named obj)", () => {
    const q = "maximize 3x + 2y + z subject to x + y + z <= 10, x - y >= 2, z <= 4, x, y, z >= 0";
    expect(first(q, "x")).toBe(10);
    expect(first(q, "y")).toBe(0);
    expect(first(q, "z")).toBe(0);
    expect(first(q, "obj")).toBe(30);
  });
  it("six variables: z = 21 with alternative optima (0,3,4,0,0,3) and (0,3,4,0,3,0)", () => {
    const q = "maximize a + 2b + 3c + d + e + f subject to a + b + c + d + e + f <= 10, a + b <= 3, c + d <= 4, e + f <= 5, a, b, c, d, e, f >= 0";
    expect(first(q, "z")).toBe(21);
    const status = run(q).lines.map((l) => l.text).find((l) => l.startsWith("Status:"))!;
    expect(status).toContain("(0, 3, 4, 0, 0, 3)");
    expect(status).toContain("(0, 3, 4, 0, 3, 0)");
    expect(run(q).caveats.join(" ")).toContain("“e” is read as a variable here");
  });
  it("… x <= 5 is redundant (slack 1, shadow price 0)", () => {
    const q = BASE + ", x <= 5";
    expect(first(q, "x")).toBe(4);
    expect(first(q, "z")).toBe(12);
    expect(text(q)).toContain("x ≤ 5 is redundant (slack 1, shadow price 0)");
  });
});

describe("§D — refusals and stand-asides", () => {
  it("maximize 3x + 2y → usage refusal, never \"more than one unknown\"", () => {
    const c = refusal("maximize 3x + 2y");
    expect(c).toContain("No constraints — an LP needs \"subject to …\"");
    expect(isLpInput("maximize 3x + 2y")).toBe(true);
  });
  it("minimize x^2 + y^2 subject to x + y = 1 → null (Lagrange's)", () => {
    expect(tryLp("minimize x^2 + y^2 subject to x + y = 1")).toBeNull();
  });
  it("maximize x*y subject to x + y <= 4 → not linear: x*y, by name", () => {
    expect(refusal("maximize x*y subject to x + y <= 4")).toContain("not linear: x*y");
  });
  it("maximize f(x) = x^2 - 4x stays with calculus: guard false, verb null", () => {
    expect(LP_VERB_RE.test("maximize f(x) = x^2 - 4x")).toBe(false);
    expect(isLpInput("maximize f(x) = x^2 - 4x")).toBe(false);
    expect(tryLp("maximize f(x) = x^2 - 4x")).toBeNull();
  });
  it("the noun openers are claimed by the guard", () => {
    for (const s of ["shadow prices for maximize x", "dual of maximize x", "sensitivity analysis maximize x", "reduced costs for maximize x", "simplex tableau for maximize x", "two phase simplex minimize x", "standard form of maximize x", "graphically solve maximize x"]) expect(LP_VERB_RE.test(s)).toBe(true);
  });
});

describe("§D — display contract on every acceptance input", () => {
  const ALL = [
    BASE,
    "minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0",
    "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0",
    "maximize x + y subject to x - y <= 1, x >= 0, y >= 0",
    "maximize 2x + 2y subject to x + y <= 4, x <= 3, y <= 3, x, y >= 0",
    "maximize 3x + 9y subject to x + 4y <= 8, x + 2y <= 4, x, y >= 0",
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6",
    "maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0, x and y integer",
    "diet problem: minimize cost 0.6x + 0.35y subject to 5x + 7y >= 8, 4x + 2y >= 15, x, y >= 0",
    "dual of maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0",
    "standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2",
  ];
  for (const q of ALL) it(q, () => contract(q));
});

describe("§D — the figure", () => {
  it("2 variables: labelled constraint lines, shaded polygon, the optimum marked with its value", () => {
    const svg = run(BASE).svg!;
    expect(svg).toContain("x + y ≤ 4");
    expect(svg).toContain("x + 3y ≤ 6");
    expect(svg).toContain('<polygon points="');
    expect(svg).toContain("(4, 0), z = 12");
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(run(BASE).alt).toContain("Feasible region");
  });
});
