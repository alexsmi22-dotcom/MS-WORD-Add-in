// Inequalities (inequalities.ts).
//
// Two classic traps carry most of the weight here, because both are where
// hand-solving and naive code go wrong:
//
//   1/(x−2) > 0   multiplying through by (x−2) is invalid — its sign is
//                 unknown — and the pole can never be in the solution set even
//                 for a non-strict comparison. Nothing is multiplied through
//                 here; the answer comes from sign analysis.
//   1/x < 1       the naive multiply gives "x > 1" and LOSES the entire
//                 negative branch. The correct answer is (−∞, 0) ∪ (1, ∞).
//
// The probe also caught a wrong answer: x³ + x + 1 > 0 returned the whole real
// line, because only RATIONAL roots were found and that cubic's only real root
// is irrational. Sign changes are now located numerically as well, and the
// result says when an endpoint is approximate.

import { solveInequality, parseInequality } from "../inequalities";

const S = (s: string) => solveInequality(s);
const D = (s: string) => S(s)!.display;

describe("polynomial inequalities", () => {
  it("x² − 4 > 0 splits into two open rays", () => {
    expect(D("x^2 - 4 > 0")).toBe("(−∞, -2) ∪ (2, ∞)");
  });
  it("x² − 4 ≤ 0 is the closed interval between the roots", () => {
    expect(D("x^2 - 4 <= 0")).toBe("[-2, 2]");
  });
  it("x³ − x < 0", () => {
    expect(D("x^3 - x < 0")).toBe("(−∞, -1) ∪ (0, 1)");
  });
  it("a linear inequality", () => {
    expect(D("2*x + 1 < 5")).toBe("(−∞, 2)");
  });
  it("always true and never true are both stated plainly", () => {
    expect(D("x^2 + 1 > 0")).toBe("(−∞, ∞)");
    expect(D("x^2 + 1 < 0")).toBe("no value satisfies this");
    expect(S("x^2 + 1 < 0")!.caveats.join(" ")).toMatch(/NO value/);
  });
  it("touching intervals are merged into one", () => {
    // x² ≥ 0 is the whole line, not two pieces meeting at 0.
    expect(D("x^2 >= 0")).toBe("(−∞, ∞)");
    expect(D("(x-1)^2 >= 0")).toBe("(−∞, ∞)");
  });
  it("a double root excluded by a strict comparison leaves a puncture", () => {
    expect(D("(x-1)^2 > 0")).toBe("(−∞, 1) ∪ (1, ∞)");
  });
  it("≠ punctures the line", () => {
    expect(D("x != 3")).toBe("(−∞, 3) ∪ (3, ∞)");
  });
});

describe("rational inequalities — the poles are the difficulty", () => {
  it("1/(x−2) > 0 excludes the pole", () => {
    const r = S("1/(x-2) > 0")!;
    expect(r.display).toBe("(2, ∞)");
    expect(r.poles).toEqual([2]);
  });
  it("1/x < 1 keeps the NEGATIVE branch that a naive multiply loses", () => {
    // Multiplying through by x gives "x > 1" and silently drops (−∞, 0).
    expect(D("1/x < 1")).toBe("(−∞, 0) ∪ (1, ∞)");
  });
  it("a pole is excluded even for a non-strict comparison", () => {
    const r = S("(x-1)/(x+2) >= 0")!;
    expect(r.display).toBe("(−∞, -2) ∪ [1, ∞)");
    // −2 is a pole: the interval must be OPEN there even though ≥ is non-strict.
    expect(r.intervals[0].hiClosed).toBe(false);
    // 1 is a numerator root: CLOSED, because ≥ includes equality.
    expect(r.intervals[1].loClosed).toBe(true);
  });
  it("the working says nothing was multiplied through", () => {
    expect(S("1/(x-2) > 0")!.caveats.join(" ")).toMatch(/nothing was multiplied through/);
  });
});

describe("irrational critical points are found, not skipped", () => {
  it("x³ + x + 1 > 0 does NOT return the whole line", () => {
    const r = S("x^3 + x + 1 > 0")!;
    expect(r.display).not.toBe("(−∞, ∞)");
    expect(r.intervals.length).toBe(1);
    expect(r.intervals[0].lo).toBeCloseTo(-0.6823278, 5);
    expect(r.intervals[0].hi).toBe("inf");
  });
  it("x² − 2 > 0 finds ±√2", () => {
    const r = S("x^2 - 2 > 0")!;
    expect(r.intervals.length).toBe(2);
    expect(r.intervals[0].hi).toBeCloseTo(-Math.SQRT2, 6);
    expect(r.intervals[1].lo).toBeCloseTo(Math.SQRT2, 6);
  });
  it("an approximate endpoint is declared as approximate", () => {
    const r = S("x^2 - 2 > 0")!;
    expect(r.exact).toBe(false);
    expect(r.caveats.join(" ")).toMatch(/located NUMERICALLY/);
  });
  it("a purely rational answer is NOT flagged approximate", () => {
    expect(S("x^2 - 4 > 0")!.exact).toBe(true);
  });
});

describe("every reported interval actually satisfies the inequality", () => {
  const CHECK: [string, (x: number) => boolean][] = [
    ["x^2 - 4 > 0", (x) => x * x - 4 > 0],
    ["x^2 - 4 <= 0", (x) => x * x - 4 <= 0],
    ["1/x < 1", (x) => x !== 0 && 1 / x < 1],
    ["(x-1)/(x+2) >= 0", (x) => x !== -2 && (x - 1) / (x + 2) >= 0],
    ["x^3 - x < 0", (x) => x ** 3 - x < 0],
    ["x^3 + x + 1 > 0", (x) => x ** 3 + x + 1 > 0],
  ];
  for (const [src, pred] of CHECK) {
    it(`${src}: sampled points inside the answer satisfy it, and outside do not`, () => {
      const r = S(src)!;
      const inside = (v: number) =>
        r.intervals.some(
          (iv) =>
            (iv.lo === "-inf" || v > iv.lo || (v === iv.lo && iv.loClosed)) &&
            (iv.hi === "inf" || v < iv.hi || (v === iv.hi && iv.hiClosed))
        );
      for (let v = -6; v <= 6; v += 0.137) {
        const want = pred(v);
        // Skip points within a hair of an endpoint, where rounding decides.
        const nearEdge = r.intervals.some(
          (iv) =>
            (iv.lo !== "-inf" && Math.abs(v - (iv.lo as number)) < 1e-3) ||
            (iv.hi !== "inf" && Math.abs(v - (iv.hi as number)) < 1e-3)
        );
        if (nearEdge) continue;
        expect(`${src} @${v.toFixed(3)}: ${inside(v)}`).toBe(`${src} @${v.toFixed(3)}: ${want}`);
      }
    });
  }
});

describe("what it will not do, it refuses", () => {
  it("a transcendental inequality is refused rather than approximated", () => {
    expect(S("sin(x) > 0")).toBeNull();
    expect(S("exp(x) > x")).toBeNull();
  });
  it("two variables are refused", () => {
    expect(S("x + y > 0")).toBeNull();
  });
  it("malformed input returns null", () => {
    expect(S("x > ")).toBeNull();
    expect(S("no comparison here")).toBeNull();
    expect(S("")).toBeNull();
  });
});

describe("parsing", () => {
  it("reads every comparison, including the unicode ones", () => {
    expect(parseInequality("x < 1")!.cmp).toBe("<");
    expect(parseInequality("x <= 1")!.cmp).toBe("<=");
    expect(parseInequality("x ≥ 1")!.cmp).toBe(">=");
    expect(parseInequality("x ≠ 1")!.cmp).toBe("!=");
  });
  it("refuses a bare expression", () => {
    expect(parseInequality("x + 1")).toBeNull();
  });
});
