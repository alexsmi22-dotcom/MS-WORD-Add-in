/** The edges the independent adversarial pass found in power.ts. */
import { nctCdf, powerT, sampleSizeFor } from "../power";

describe("sampleSizeFor searches up to the cap itself", () => {
  it("d = 0.005 needs ~628k per group — found, not 'infeasible'", () => {
    const n = sampleSizeFor((n) => powerT({ design: "two-sample", d: 0.005, n, alpha: 0.05, tails: 2 }), 0.8);
    expect(n).not.toBeNull();
    expect(n!).toBeGreaterThan(600_000);
    expect(n!).toBeLessThan(660_000);
  });
  it("returns null, not 4, when the power function cannot answer", () => {
    expect(sampleSizeFor(() => NaN, 0.8)).toBeNull();
  });
  it("a cap that is reached exactly is returned", () => {
    expect(sampleSizeFor((n) => (n >= 1000 ? 0.9 : 0.1), 0.8, 1000)).toBe(1000);
    expect(sampleSizeFor((n) => (n >= 1001 ? 0.9 : 0.1), 0.8, 1000)).toBeNull();
  });
});

describe("nctCdf past |δ| ≈ 37.6", () => {
  it("uses the normal approximation instead of underflowing to 0", () => {
    expect(nctCdf(40, 100, 40)).toBeGreaterThan(0.4);
    expect(nctCdf(40, 100, 40)).toBeLessThan(0.6);
    expect(nctCdf(100, 100, 40)).toBeGreaterThan(0.99);
    expect(nctCdf(10, 100, 40)).toBeLessThan(0.01);
  });
  it("is continuous across the switch: at fixed t, a larger δ gives a smaller CDF", () => {
    expect(nctCdf(37.5, 200, 37)).toBeGreaterThan(nctCdf(37.5, 200, 38));
    expect(Math.abs(nctCdf(37.5, 200, 37) - nctCdf(37.5, 200, 38))).toBeLessThan(0.3);
  });
});

describe("second pass", () => {
  it("a NaN inside the bracket is null, never 'found'", () => {
    expect(sampleSizeFor((n) => (n > 1000 ? NaN : 0.1), 0.8)).toBeNull();
  });
});
