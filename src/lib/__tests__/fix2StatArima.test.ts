/**
 * Stats fix round 2, MAJOR 6 (reviewer S): ARIMA computed for 2.3 s and then refused on a 3 s wall clock, so the same
 * fit could print on one machine and refuse on a slower one. Now no clock: a deterministic work charge (recalibrated
 * on 300 timed fits) with an up-front refusal from the typical need (15·k³ evaluations), and the filter's Math calls as
 * module constants (5× faster in the test runner).
 */
import { budget } from "./timeBudget";
import * as fs from "fs";
import * as path from "path";
import { fitArima, arimaTypicalEvals, type ArimaSpec } from "../arima";

/** A seeded Gaussian random walk (the reviewer's Y: σ² about 0.9–1 after one difference). */
function walk(n: number, seed: number): number[] {
  let s = seed >>> 0 || 1;
  const u = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s + 0.5) / 4294967296;
  };
  let y = 100;
  return Array.from({ length: n }, () => {
    y += Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    return +y.toFixed(3);
  });
}

describe("MAJOR 6: ARIMA never depends on the clock", () => {
  test("arima.ts reads no clock", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "arima.ts"), "utf8");
    expect(src).not.toMatch(/Date\.now|performance\.now/);
  });
  test("the typical need grows as k³", () => {
    expect(arimaTypicalEvals(4)).toBe(960);
    expect(arimaTypicalEvals(8)).toBe(7680);
  });
  test("ARIMA(3, 1, 3) on 500-row random walks: the same outcome twice, bounded by work, not a clock", () => {
    // Over-parametrised on a random walk: of ten seeds 7 estimate, 2 do not converge in 400 iterations and 1 runs out
    // of work (seed 2), each the same on every run and machine.
    for (const [seed, ok] of [
      [5, true],
      [2, false],
    ] as const) {
      const y = walk(500, seed);
      const spec: ArimaSpec = { p: 3, d: 1, q: 3, trend: "none" };
      const t0 = performance.now();
      const a = fitArima(y, spec);
      const ms = performance.now() - t0;
      const b = fitArima(y, spec);
      expect(a.ok).toBe(ok);
      expect(b.ok).toBe(ok);
      if (a.ok && b.ok) expect(b.llf).toBe(a.llf);
      if (!a.ok && !b.ok) {
        expect(b.reason).toBe(a.reason);
        expect(a.reason).toMatch(/computation limit for ARIMA\(3, 1, 3\) on 499 observations/);
      }
      expect(ms).toBeLessThan(budget(5000)); // measured 0.4 s (seed 5) and 2.1 s (seed 2); generous for a loaded machine
    }
  });
  test("ordinary fits on 2,000 rows converge", () => {
    const y = walk(2000, 7);
    for (const spec of [
      { p: 2, d: 1, q: 2, trend: "none" },
      { p: 5, d: 1, q: 1, trend: "none" },
      { p: 4, d: 0, q: 2, trend: "mean" },
    ] as ArimaSpec[]) {
      const f = fitArima(spec.d === 0 ? y.map((v, i) => (i ? v - y[i - 1] : 0)).slice(1) : y, spec);
      expect(f.ok).toBe(true);
    }
  });
  test("a fit whose typical need exceeds the budget is refused up front, by name, before any work", () => {
    const y = walk(10000, 11).map((v, i, a) => (i ? v - a[i - 1] : 0)).slice(1);
    const t0 = performance.now();
    const f = fitArima(y, { p: 5, d: 0, q: 1, trend: "mean" });
    expect(performance.now() - t0).toBeLessThan(budget(100));
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.reason).toMatch(/^ARIMA\(5, 0, 1\) on 9,999 observations needs more computation than the pane allows; use at most 9,576 rows for these orders, or smaller p and q\.$/);
  });
});
