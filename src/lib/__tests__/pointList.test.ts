/**
 * The shared point-list reader — every shape a human TYPES (docs/SCOPE-LP-SPLINES.md
 * §B / §C.1). Coordinates must be exact rationals read as typed: 0.1 is 1/10.
 */
import { readPointList, isPointRefusal, readCoordinate, sampleFunction, PointList } from "../pointList";
import { ratInt, parseRatLiteral } from "../cas";

const pts = (q: string): PointList => {
  const r = readPointList(q);
  if (!r) throw new Error("no points read from: " + q);
  if (isPointRefusal(r)) throw new Error("refused: " + r.refusal);
  return r;
};
const refusal = (q: string): string => {
  const r = readPointList(q);
  if (!r) throw new Error("returned null, not a refusal: " + q);
  if (!isPointRefusal(r)) throw new Error("read points, not refused: " + q);
  return r.refusal;
};
const fr = (r: { n: bigint; d: bigint }): string => (r.d === 1n ? String(r.n) : `${r.n}/${r.d}`);
const xy = (p: PointList): string => p.xs.map((x, i) => `(${fr(x)}, ${fr(p.ys[i])})`).join(" ");

describe("pairs", () => {
  it("(1, 2), (2, 3), (4, 7)", () => {
    const p = pts("interpolate (1, 2), (2, 3), (4, 7)");
    expect(p.shape).toBe("pairs");
    expect(xy(p)).toBe("(1, 2) (2, 3) (4, 7)");
    expect(p.notes).toEqual([]);
  });
  it("(1,2) (2,3) — no commas between pairs, no spaces inside", () => {
    expect(xy(pts("(1,2) (2,3) (4,7)"))).toBe("(1, 2) (2, 3) (4, 7)");
  });
  it("between (1, 10) and (3, 20)", () => {
    expect(xy(pts("linear interpolation between (1, 10) and (3, 20)"))).toBe("(1, 10) (3, 20)");
  });
  it("negative, decimal, fraction and scientific coordinates are exact", () => {
    const p = pts("(-1, 0.1), (1/2, 3/4), (2e1, -2.50)");
    expect(xy(p)).toBe("(-1, 1/10) (1/2, 3/4) (20, -5/2)");
  });
  it("0.1 becomes 1/10, never the nearest double", () => {
    const p = pts("(0.1, 1), (0.2, 2)");
    expect(p.xs[0]).toEqual(parseRatLiteral("1/10"));
    expect(p.xs[0].d).toBe(10n);
  });
  it("Unicode minus and semicolon separators", () => {
    expect(xy(pts("(−1, 2); (0, −3); (1, 4)"))).toBe("(-1, 2) (0, -3) (1, 4)");
  });
  it("a constant expression as a coordinate goes through the CAS", () => {
    expect(xy(pts("(2^3, 1/2 + 1/3), (0, 1)"))).toBe("(0, 1) (8, 5/6)");
  });
  it("a non-numeric coordinate is refused by name", () => {
    expect(refusal("(a, 2), (1, 3)")).toMatch(/coordinate a .*not a number/);
    expect(refusal("(pi, 2), (1, 3)")).toMatch(/pi/);
    expect(refusal("(sqrt(2), 2), (1, 3)")).toMatch(/sqrt\(2\)/);
  });
});

describe("columns", () => {
  it("x: 0, 1, 2; y: 1, 3, 2", () => {
    const p = pts("x: 0, 1, 2; y: 1, 3, 2");
    expect(p.shape).toBe("columns");
    expect(xy(p)).toBe("(0, 1) (1, 3) (2, 2)");
  });
  it("x = 0, 1, 2; y = 1, 3, 2 (equals signs)", () => {
    expect(xy(pts("x = 1, 2, 3, 4; y = 1, 4, 9, 16 interpolating polynomial"))).toBe("(1, 1) (2, 4) (3, 9) (4, 16)");
  });
  it("x 1 2 4 y 2 3 7 (bare, space-separated)", () => {
    expect(xy(pts("interpolation table x 1 2 4 y 2 3 7"))).toBe("(1, 2) (2, 3) (4, 7)");
  });
  it("x values / y values on two lines", () => {
    expect(xy(pts("x values: 0 1 2\ny values: 1 3 2"))).toBe("(0, 1) (1, 3) (2, 2)");
  });
  it("decimals in columns are exact", () => {
    expect(xy(pts("x: 0.5, 1.5; y: 0.25, 2.25"))).toBe("(1/2, 1/4) (3/2, 9/4)");
  });
  it("unequal columns are refused by name", () => {
    expect(refusal("x: 0, 1, 2; y: 1, 3")).toMatch(/x has 3 values but y has 2/);
  });
});

describe("function values and pasted rows", () => {
  it("f(2) = 4, f(3) = 9", () => {
    const p = pts("estimate given f(2) = 4, f(3) = 9 by linear interpolation");
    expect(p.shape).toBe("values");
    expect(xy(p)).toBe("(2, 4) (3, 9)");
  });
  it("g(0.5) = 1/4 with a different letter", () => {
    expect(xy(pts("g(0.5) = 1/4, g(1) = 1"))).toBe("(1/2, 1/4) (1, 1)");
  });
  it("f(2.5) without a value is not a point", () => {
    const p = pts("estimate f(2.5) given f(2) = 4, f(3) = 9");
    expect(xy(p)).toBe("(2, 4) (3, 9)");
  });
  it("table rows, one point per line, optional x y header", () => {
    const p = pts("x y\n1 2\n2 3\n4 7");
    expect(p.shape).toBe("rows");
    expect(xy(p)).toBe("(1, 2) (2, 3) (4, 7)");
    expect(xy(pts("1, 2\n2, 3\n4, 7"))).toBe("(1, 2) (2, 3) (4, 7)");
    expect(xy(pts("1\t2\n2\t3"))).toBe("(1, 2) (2, 3)");
  });
});

describe("a function sampled at nodes", () => {
  it("f(x) = 1/x at x = 1, 2, 4 — exact through the CAS", () => {
    const p = pts("interpolating polynomial for f(x) = 1/x at x = 1, 2, 4");
    expect(p.shape).toBe("function");
    expect(xy(p)).toBe("(1, 1) (2, 1/2) (4, 1/4)");
    expect(p.fn?.text).toBe("1/x");
    expect(p.fn?.variable).toBe("x");
  });
  it("a different variable name and a decimal node", () => {
    expect(xy(pts("g(t) = t^2 + 1 at t = 0.5, 1, 2"))).toBe("(1/2, 5/4) (1, 2) (2, 5)");
  });
  it("sqrt(4) at a node folds to the rational 2", () => {
    expect(xy(pts("f(x) = sqrt(x) at x = 4, 9"))).toBe("(4, 2) (9, 3)");
  });
  it("a node whose value is not rational is refused BY NAME, never replaced by a double", () => {
    expect(refusal("f(x) = sin(x) at x = 0, 1, 2")).toMatch(/x = 1: the value of sin\(x\) there is not a rational number/);
    expect(refusal("f(x) = sqrt(x) at x = 1, 2")).toMatch(/x = 2/);
  });
  it("a function of two symbols is refused by name", () => {
    expect(refusal("f(x) = a*x at x = 1, 2")).toMatch(/other symbols \(a\)/);
  });
  it("sampleFunction refuses a node beyond 2^53 instead of substituting a double", () => {
    const r = sampleFunction("x^2", "x", [ratInt(BigInt("123456789012345678901"))]);
    expect("refusal" in r && r.refusal).toMatch(/too large/);
  });
});

describe("duplicates and order", () => {
  it("same x, different y → refusal naming the x and both y's", () => {
    expect(refusal("(1, 2), (1, 3), (2, 4)")).toBe("x = 1 appears twice (y = 2 and y = 3): no function passes through both.");
    expect(refusal("(0, 0), (0, 1), (1, 2)")).toMatch(/^x = 0 appears twice \(y = 0 and y = 1\)/);
  });
  it("same x, same y → dropped and SAID", () => {
    const p = pts("(1, 2), (2, 3), (1, 2)");
    expect(xy(p)).toBe("(1, 2) (2, 3)");
    expect(p.notes).toEqual(["(1, 2) was listed twice — kept once."]);
  });
  it("unsorted → sorted and SAID", () => {
    const p = pts("(2, 3), (1, 2), (4, 7)");
    expect(xy(p)).toBe("(1, 2) (2, 3) (4, 7)");
    expect(p.notes).toEqual(["Points sorted by x (typed order was x = 2, 1, 4)."]);
  });
  it("decimal and fraction spellings of the same x are the same x", () => {
    expect(refusal("(0.5, 1), (1/2, 2)")).toMatch(/x = 1\/2 appears twice/);
  });
});

describe("nothing to read", () => {
  it("returns null, not a refusal, when there is no point list", () => {
    expect(readPointList("interpolate")).toBeNull();
    expect(readPointList("x^2 - 5x + 6 = 0")).toBeNull();
    expect(readPointList("spline")).toBeNull();
    expect(readPointList("S'(0) = 1, S'(2) = -1")).toBeNull();
  });
  it("readCoordinate", () => {
    expect(readCoordinate("2.5")).toEqual(parseRatLiteral("5/2"));
    expect(readCoordinate("−3")).toEqual(ratInt(-3));
    expect(readCoordinate("x")).toBeNull();
  });
});
