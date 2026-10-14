/**
 * The products × resources word-problem template (docs/SCOPE-LP-SPLINES.md
 * §B "LP word problem", §D chairs-and-tables). One template, every clause it
 * did not read refused BY NAME, the named LP families refused by name.
 */
import { parseExpr, evalAst } from "../solve";
import { tryLpWords, LP_WORDS_RE } from "../lpWords";

const CHAIRS =
  "A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available. How many of each maximize profit?";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  if (Date.now() - t0 > 1000) throw new Error("over 1 s");
  return r;
};
const run = (q: string) => {
  const v = timed(() => tryLpWords(q));
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = timed(() => tryLpWords(q));
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const isNumeric = (rhs: string): boolean => {
  try {
    return Number.isFinite(evalAst(parseExpr(rhs), {}));
  } catch {
    return false;
  }
};
const value = (q: string, name: string): number => {
  const l = run(q).lines.find((x) => x.math && x.text.startsWith(`${name} = `) && isNumeric(x.text.slice(name.length + 3)));
  if (!l) throw new Error(`no ${name} in\n${text(q)}`);
  return evalAst(parseExpr(l.text.slice(name.length + 3)), {});
};

describe("chairs and tables (§D)", () => {
  it("builds maximize 30x + 50y subject to 2x + 3y <= 120, x + 2y <= 70, x, y >= 0 and prints it", () => {
    expect(text(CHAIRS)).toContain("LP built: maximize 30x + 50y subject to 2x + 3y <= 120, x + 2y <= 70, x, y >= 0");
    expect(text(CHAIRS)).toContain("Reading: x = number of chairs, y = number of tables");
    expect(text(CHAIRS)).toContain("labor: 2x + 3y ≤ 120 hours");
    expect(text(CHAIRS)).toContain("wood: x + 2y ≤ 70 units");
  });
  it("solves it: (30, 20), profit 1900", () => {
    expect(value(CHAIRS, "x")).toBe(30);
    expect(value(CHAIRS, "y")).toBe(20);
    expect(value(CHAIRS, "z")).toBe(1900);
    expect(run(CHAIRS).svg).toContain("<svg");
    expect(run(CHAIRS).caveats.join(" ")).toContain("products × resources template");
  });
  it("the guard claims the prose and not a typed LP", () => {
    expect(LP_WORDS_RE.test(CHAIRS)).toBe(true);
    expect(tryLpWords("maximize 30x + 50y subject to 2x + 3y <= 120, x + 2y <= 70, x, y >= 0")).toBeNull();
    expect(tryLpWords("x^2 - 5x + 6 = 0")).toBeNull();
  });
  it("every math line re-parses", () => {
    for (const l of run(CHAIRS).lines.filter((x) => x.math)) {
      const [a, b] = l.text.split(" = ");
      expect(() => parseExpr(a)).not.toThrow();
      expect(() => parseExpr(b)).not.toThrow();
    }
  });
});

describe("a second instance of the same template", () => {
  const BAKERY = "A bakery makes cakes and pies. Each cake uses 3 cups of flour and 2 eggs and earns $8; each pie uses 2 cups of flour and 1 egg and earns $5. There are 60 cups of flour and 30 eggs available. How many of each maximize profit?";
  it("cakes and pies: maximize 8x + 5y, 3x + 2y <= 60, 2x + y <= 30 → (0, 30), 150", () => {
    expect(text(BAKERY)).toContain("LP built: maximize 8x + 5y subject to 3x + 2y <= 60, 2x + y <= 30, x, y >= 0");
    expect(value(BAKERY, "z")).toBe(150);
  });
  it("number words and 'requires … yields' spellings", () => {
    const q = "A workshop produces desks and shelves. Each desk requires four hours of carpentry and two hours of finishing and yields a profit of 40; each shelf requires two hours of carpentry and one hour of finishing and yields 25. There are forty hours of carpentry and sixteen hours of finishing available. How many of each maximize profit?";
    expect(text(q)).toContain("LP built: maximize 40x + 25y subject to 4x + 2y <= 40, 2x + y <= 16, x, y >= 0");
    expect(value(q, "z")).toBe(400);
  });
});

describe("clauses the template did not read are refused BY NAME", () => {
  const base = "A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available.";
  it("at least 10 chairs", () => {
    expect(refusal(`${base} At least 10 chairs must be made. How many of each maximize profit?`)).toContain("“at least 10 chairs must be made”");
  });
  it("demand", () => {
    expect(refusal(`${base} Demand for tables is 15. How many of each maximize profit?`)).toContain("“demand for tables is 15”");
  });
  it("setup cost", () => {
    expect(refusal(`${base} Each table has a setup cost of $100. How many of each maximize profit?`)).toContain("setup cost");
  });
  it("a number the template did not use is not silently dropped", () => {
    const c = refusal(`${base} The company also pays 500 in rent each week. How many of each maximize profit?`);
    expect(c).toContain("500");
    expect(c).toContain("was not used by the template");
  });
  it("a minimisation in prose is not this template", () => {
    expect(refusal("A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available. How many of each minimize waste?")).toContain("maximises profit");
  });
});

describe("named families are refused by name with the typed-LP form shown", () => {
  it("transportation", () => {
    const c = refusal("transportation problem: supplies 20, 30; demands 25, 25; costs 2, 3, 4, 1 — ship to minimize cost");
    expect(c).toContain("Transportation problems are not read from prose");
    expect(c).toContain("minimize 2x11 + 3x12");
  });
  it("assignment", () => {
    expect(refusal("assignment problem: assign 3 workers to 3 jobs so that each worker takes one job and each job gets one worker at minimum total cost")).toContain("Assignment problems are not read from prose");
  });
  it("diet", () => {
    expect(refusal("A diet problem: each unit of food A has 5 units of protein and costs 0.6; food B has 7 and costs 0.35; at least 8 units of protein are needed. Minimize cost.")).toContain("Diet problems are not read from prose");
  });
  it("blending", () => {
    expect(refusal("blending problem: an alloy must contain at least 30% copper; ore A is 20% copper at 3 per ton, ore B 50% at 5 per ton; blend 100 tons at minimum cost")).toContain("Blending problems are not read from prose");
  });
});
