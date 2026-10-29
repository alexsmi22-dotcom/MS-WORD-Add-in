/**
 * Stats fix round 2, MAJOR 5 (reviewer S): ts-garch refused five years of daily returns (about 1,260) on the default
 * GJR-t (cap 1,200) and still took about 3 s at 1,200. The time was the likelihood loops' global lookups of Math (12×
 * slower in the sandboxed test runner); with them module constants, every model takes up to 2,600 returns and the
 * pass budget (never the clock) bounds the search: about 0.36 s for GJR-t and 1.05 s for EGARCH-t at worst over 600
 * seeded fits.
 */
import { budget } from "./timeBudget";
import { fitGarch, garchMaxN, garchPassBudget, GARCH_MAX_N, type GarchSpec } from "../ts2";
import { tsGarchCalc } from "../ts2StatCalcs";

/** GJR-GARCH(1,1,1) returns with Student-t(6) shocks, in percent (seeded xorshift). */
function gjrT(n: number, seed: number): number[] {
  let s = seed >>> 0 || 1;
  const u = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s + 0.5) / 4294967296;
  };
  const norm = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const out: number[] = [];
  let s2 = 1;
  let prev = 0;
  for (let t = 0; t < n + 200; t++) {
    let c = 0;
    for (let i = 0; i < 6; i++) c += norm() ** 2;
    const z = norm() / Math.sqrt(c / 6) / Math.sqrt(1.5);
    s2 = 0.02 + 0.03 * prev * prev + (prev < 0 ? 0.1 * prev * prev : 0) + 0.9 * s2;
    prev = Math.sqrt(s2) * z;
    if (t >= 200) out.push(+(0.04 + prev).toFixed(4));
  }
  return out;
}

describe("MAJOR 5: GARCH takes ten years of daily returns on every model", () => {
  test("the cap is 2,600 for every model", () => {
    expect(GARCH_MAX_N).toBe(2600);
    for (const vol of ["garch", "gjr", "egarch"] as const) for (const dist of ["normal", "t"] as const) expect(garchMaxN({ vol, dist })).toBe(2600);
  });
  test("the search is bounded by passes, not time: EGARCH (dearer per pass) gets fewer", () => {
    expect(garchPassBudget({ vol: "gjr" }, 2600)).toBe(7272);
    expect(garchPassBudget({ vol: "egarch" }, 2600)).toBe(5387);
    expect(garchPassBudget({ vol: "garch" }, 100)).toBe(16000);
  });
  test("five years (1,260 returns) on the default GJR-t: estimated, not refused", () => {
    const y = gjrT(1260, 11);
    const data = "Return\n" + y.join("\n");
    const o = tsGarchCalc((k) => ({ data, model: "gjr", dist: "t", mean: "constant", h: "10", column: "" })[k] ?? "");
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/^GJR-GARCH\(1,1,1\) with Student-t errors and a constant mean for Return \(n = 1,260\)/);
  });
  test("2,600 returns on GJR-t: converged in about a second at most, the same answer twice", () => {
    const y = gjrT(2600, 5);
    const spec: GarchSpec = { vol: "gjr", dist: "t", mean: "constant" };
    const t0 = performance.now();
    const a = fitGarch(y, spec);
    const ms = performance.now() - t0;
    const b = fitGarch(y, spec);
    expect(a.ok && a.converged).toBe(true);
    expect(b.ok && b.converged).toBe(true);
    if (a.ok && b.ok) {
      expect(b.llf).toBe(a.llf);
      expect(b.params).toEqual(a.params);
    }
    // Measured 0.2–0.4 s; generous for a loaded test machine.
    expect(ms).toBeLessThan(budget(2000));
  });
});
