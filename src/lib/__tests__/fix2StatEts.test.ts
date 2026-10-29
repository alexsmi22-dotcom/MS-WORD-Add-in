/**
 * Stats fix round 2, MAJOR 2 (ts-ets): the fit is never worse than the pre-round-1 engine (git e8d23c4) nor
 * statsmodels' best (its default and brute optimisers). Fixture fix2StatEts.json: every series where either engine
 * lost the optimum on the round-2 gate (S2\hw_data.json, the reviewer's 72 series × 7 specs, and 330 fresh seeded
 * series × 3 specs), with statsmodels' SSE, the old engine's, and the target min(both). The whole gate (1,815 fits)
 * ran clean at a relative tolerance of 10⁻⁵, long series included, and so did a fresh adversarial set of 600 fits. One
 * known miss on a further 120 fits at m = 4–52: damped additive Holt–Winters at m = 24 (SSE 7,926.7), where only
 * statsmodels' non-brute SLSQP (with a ConvergenceWarning) reaches 7,200.9; its default brute fit, and the old engine,
 * stop at 7,926.7 as this one does.
 */
import { budget } from "./timeBudget";
import * as fs from "fs";
import * as path from "path";
import { fitHoltWinters, hwFilter, hwForecast, type HwSpec } from "../holtWinters";
import { tsEtsCalc, TS_ETS_DEFAULTS } from "../tsForecastCalcs";

interface Fx {
  id: string;
  y: number[];
  trend: "none" | "add";
  damped: "yes" | "no";
  seasonal: "none" | "add" | "mul";
  m: number;
  statsmodels: number;
  oldEngine: number | null;
  target: number;
}
const FX: Fx[] = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fix2StatEts.json"), "utf8"));
const specOf = (c: Fx): HwSpec => ({ trend: c.trend, damped: c.damped === "yes" && c.trend === "add", seasonal: c.seasonal, m: c.seasonal === "none" ? 0 : c.m });

describe("MAJOR 2: Holt–Winters never worse than the old engine and statsmodels", () => {
  test.each(FX.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const f = fitHoltWinters(c.y, specOf(c));
    if (!f.ok) throw new Error(f.reason);
    // 4 decimals in the fixture: allow that rounding and 10⁻⁶ relative.
    expect(f.sse).toBeLessThanOrEqual(c.target * (1 + 1e-6) + 1e-4);
  });

  test("the reviewer's s5 in the pane: SSE 3,008.0 (not 3,067.3), forecasts rising", () => {
    const c = FX.find((x) => x.id === "as5|add|no|add|12")!;
    const data = "Month\tV\n" + c.y.map((v, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}\t${v}`).join("\n");
    const over: Record<string, string> = { data, trend: "add", damped: "no", seasonal: "add", h: "12", m: "", column: "" };
    const o = tsEtsCalc((k) => over[k] ?? TS_ETS_DEFAULTS[k] ?? "");
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("SSE = 3,008.0");
    expect(o.text).not.toContain("3,067");
    // The reviewer's visible symptom: the pane's forecast fell where statsmodels' and the old engine's rose.
    expect(o.reading).toMatch(/^Holt–Winters forecasts V at about 227\.286 for January 2015, rising to about 230\.323 by December 2015/);
    const spec = specOf(c);
    const f = fitHoltWinters(c.y, spec);
    if (!f.ok) throw new Error(f.reason);
    expect(hwFilter(c.y, spec, f.params).trend).toBeGreaterThan(0);
    const fc = hwForecast(c.y, spec, f.params, 24);
    expect(fc[23]).toBeGreaterThan(fc[11]);
    expect(fc[11]).toBeGreaterThan(fc[0]);
  });

  test("a long series (6,000 monthly rows, damped multiplicative) fits within the pane's time", () => {
    const n = 6000;
    let s = 7;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647 - 0.5;
    };
    let w = 0;
    const y = Array.from({ length: n }, (_, t) => {
      w += rnd();
      return 200 + 0.05 * t + 15 * Math.sin((2 * Math.PI * t) / 12) + w + 2 * rnd();
    });
    const t0 = performance.now();
    const f = fitHoltWinters(y, { trend: "add", damped: true, seasonal: "mul", m: 12 });
    const ms = performance.now() - t0;
    expect(f.ok).toBe(true);
    // The old engine took about 0.3–0.7 s on such series, round 1 about 2.2 s; generous for a slow test machine.
    expect(ms).toBeLessThan(budget(2500));
  });
});
