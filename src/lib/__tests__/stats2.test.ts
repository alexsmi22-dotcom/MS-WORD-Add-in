import {
  erf,
  normalCdf,
  chiSquareP,
  mannWhitneyU,
  wilcoxonSignedRank,
  chiSquareGoodnessOfFit,
  chiSquareIndependence,
  twoWayAnova,
  adjustPValues,
} from "../stats2";

describe("special functions", () => {
  it("erf and normal CDF match known values", () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427, 4);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("chi-square upper-tail p matches critical values", () => {
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3); // χ²₀.₀₅,₁
    expect(chiSquareP(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(0, 3)).toBe(1);
  });
});

describe("Mann–Whitney U", () => {
  it("fully separated samples give U = 0 and a small p", () => {
    const r = mannWhitneyU([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(r.statistic).toBe(0);
    expect(r.p).toBeLessThan(0.05);
  });
  it("identical distributions give a large p", () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(r.p).toBeGreaterThan(0.5);
  });
});

describe("Wilcoxon signed-rank", () => {
  it("consistent one-directional differences give W = 0", () => {
    const r = wilcoxonSignedRank([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]); // all negative diffs
    expect(r.statistic).toBe(0);
    expect(r.p).toBeLessThan(0.1);
  });
  it("drops zero differences", () => {
    const r = wilcoxonSignedRank([5, 6, 7], [5, 6, 7]); // all zero → n=0
    expect(r.n1).toBe(0);
  });
});

describe("chi-square", () => {
  it("goodness of fit: perfect fit → 0, and a known deviation", () => {
    expect(chiSquareGoodnessOfFit([10, 10, 10, 10], [10, 10, 10, 10]).chi2).toBeCloseTo(0, 9);
    const r = chiSquareGoodnessOfFit([20, 10, 10, 10], [12.5, 12.5, 12.5, 12.5]);
    expect(r.chi2).toBeCloseTo(6, 6);
    expect(r.df).toBe(3);
  });
  it("independence: known 2x2 table", () => {
    const r = chiSquareIndependence([
      [10, 20],
      [30, 40],
    ]);
    expect(r.chi2).toBeCloseTo(0.7937, 3);
    expect(r.df).toBe(1);
    expect(r.expected[0][0]).toBeCloseTo(12, 6);
    expect(r.expected[1][1]).toBeCloseTo(42, 6);
  });
});

describe("two-way ANOVA", () => {
  it("decomposes sums of squares (SS_A + SS_B + SS_AB + SS_error = SS_total)", () => {
    const cells = [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 9],
      ],
    ];
    const r = twoWayAnova(cells);
    const sum = r.factorA.ss + r.factorB.ss + r.interaction.ss + r.error.ss;
    expect(sum).toBeCloseTo(r.total.ss, 6);
    expect(r.factorA.df + r.factorB.df + r.interaction.df + r.error.df).toBe(r.total.df);
  });
  it("detects a strong factor-A main effect", () => {
    const cells = [
      [
        [1, 2, 3],
        [2, 1, 3],
      ],
      [
        [101, 102, 103],
        [100, 102, 101],
      ],
    ];
    const r = twoWayAnova(cells);
    expect(r.factorA.p).toBeLessThan(0.001);
    expect(r.factorA.F).toBeGreaterThan(r.factorB.F);
  });
  it("throws on an unbalanced design", () => {
    expect(() =>
      twoWayAnova([
        [[1, 2], [3]],
        [[5, 6], [7, 8]],
      ]),
    ).toThrow();
  });
});

describe("multiple-comparison correction", () => {
  const p = [0.01, 0.02, 0.03, 0.04];
  it("Bonferroni multiplies by m and caps at 1", () => {
    expect(adjustPValues(p, "bonferroni")).toEqual([0.04, 0.08, 0.12, 0.16]);
    expect(adjustPValues([0.5, 0.6], "bonferroni")).toEqual([1, 1]);
  });
  it("Holm is step-down and monotone", () => {
    const adj = adjustPValues(p, "holm");
    expect(adj[0]).toBeCloseTo(0.04, 9);
    expect(adj[1]).toBeCloseTo(0.06, 9);
    expect(adj[2]).toBeCloseTo(0.06, 9);
    expect(adj[3]).toBeCloseTo(0.06, 9);
  });
  it("Benjamini–Hochberg controls FDR (all 0.04 here)", () => {
    const adj = adjustPValues(p, "bh");
    for (const a of adj) expect(a).toBeCloseTo(0.04, 9);
  });
  it("preserves input order", () => {
    const adj = adjustPValues([0.04, 0.01, 0.03, 0.02], "bonferroni");
    expect(adj).toEqual([0.16, 0.04, 0.12, 0.08]);
  });
});
