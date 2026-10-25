/**
 * Release E3b calculators (ts-arima, ts-ets): worked defaults pinned to statsmodels, the display contract, and the
 * hostile inputs every calculator must survive (too few rows, constant, gaps, extreme scales, overflow, 100,000 rows,
 * rubbish in every parameter field).
 */
import * as fs from "fs";
import * as path from "path";
import type { StatOutput } from "../analyzeBlocks";
import { tsArimaCalc, tsEtsCalc, TS_ARIMA_DEFAULTS, TS_ETS_DEFAULTS, TS_ARIMA_DATA_DEFAULT, TS_ETS_DATA_DEFAULT } from "../tsForecastCalcs";

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-ts-forecast-oracle.json"), "utf8"));
const defA = fx.arima.find((c: { name: string }) => c.name === "default_arima");
const defE = fx.ets.find((c: { name: string }) => c.name === "default_ets");

const reader =
  (base: Record<string, string>, over: Record<string, string> = {}) =>
  (k: string): string =>
    over[k] ?? base[k] ?? "";
const arima = (over: Record<string, string> = {}): StatOutput => tsArimaCalc(reader(TS_ARIMA_DEFAULTS, over));
const ets = (over: Record<string, string> = {}): StatOutput => tsEtsCalc(reader(TS_ETS_DEFAULTS, over));

/** Every string an ok result can put in a document. */
function allText(r: StatOutput): string {
  return [r.text, ...(r.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
}

function expectDisplayContract(r: StatOutput): void {
  expect(r.ok).not.toBe(false);
  const s = allText(r);
  expect(s).not.toMatch(/NaN|Infinity|undefined|null/);
  expect(s).not.toMatch(/\d[eE][+-]?\d/); // no e-notation
  expect(s).not.toMatch(/(^|[\s(\[;=])-\d/m); // true minus, never a hyphen
  expect(s).not.toContain("—"); // no em dash
  for (const t of r.tables ?? []) for (const row of t.rows) expect(row.length).toBe(t.rows[0].length);
  expect(r.svg).toMatch(/^<svg/);
}

/** Lines of a series with optional dates. */
function seriesText(values: number[], header = "Value"): string {
  return [header, ...values.map((v) => String(v))].join("\n");
}
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}
function arimaSeries(n: number, seed: number, scale = 1, offset = 100): number[] {
  const rnd = lcg(seed);
  const out: number[] = [];
  let lvl = 0;
  let e1 = 0;
  for (let i = 0; i < n; i++) {
    const e = rnd();
    lvl += 0.4 * e1 + e;
    e1 = e;
    out.push((lvl + offset) * scale);
  }
  return out;
}
function seasonalSeries(n: number, seed: number): number[] {
  const rnd = lcg(seed);
  const out: number[] = [];
  let lvl = 200;
  for (let i = 0; i < n; i++) {
    lvl += 0.05 + rnd();
    out.push(lvl + 8 * Math.sin((2 * Math.PI * i) / 12) + rnd());
  }
  return out;
}

describe("worked defaults", () => {
  it("the shipped default data are the oracle's", () => {
    expect(TS_ARIMA_DATA_DEFAULT).toBe(defA.text);
    expect(TS_ETS_DATA_DEFAULT).toBe(defE.text);
  });
  it("ts-arima default: ARIMA(1, 1, 1) on the quarterly rate, at least statsmodels' maximum, forecasts dated", () => {
    const r = arima();
    expectDisplayContract(r);
    expect(r.text).toMatch(/^ARIMA\(1, 1, 1\) for Rate \(n = 80; 79 differenced observations\)/);
    const llf = Number(/log likelihood = (\S+)/.exec(r.text)![1].replace("−", "-"));
    expect(llf).toBeGreaterThanOrEqual(Math.round(defA.llf * 1000) / 1000 - 0.0011);
    const fc = r.tables![1];
    expect(fc.rows[0]).toEqual(["h", "Period", "Forecast", "SE", "95% lower", "95% upper"]);
    expect(fc.rows[1][1]).toBe("2026 Q1");
    expect(fc.rows[8][1]).toBe("2027 Q4");
    // Forecast at our optimum vs statsmodels' at its optimum: the optimiser gap is far below the printed digits' scale.
    expect(Math.abs(Number(fc.rows[1][2]) - defA.forecast[0])).toBeLessThan(1e-3);
    expect(r.text).toContain("Simple differencing");
    expect(r.text).toContain("Ljung–Box on the standardized residuals: Q(10)");
  });
  it("ts-ets default: additive Holt–Winters, m = 12 from the monthly dates, intervals present", () => {
    const r = ets();
    expectDisplayContract(r);
    expect(r.text).toMatch(/^Holt–Winters, additive trend, additive seasonality \(m = 12\) for Sales \(n = 120\)/);
    expect(r.text).toContain("Seasonal period m = 12 from the monthly dates.");
    // SSE is printed to 5 significant digits; never above statsmodels' beyond that rounding.
    const sse = Number(/SSE = ([\d.,]+)/.exec(r.text)![1].replace(/,/g, ""));
    expect(sse).toBeLessThanOrEqual(defE.sse * (1 + 1e-6) + 0.05);
    const fc = r.tables![1];
    expect(fc.rows[0]).toEqual(["h", "Period", "Forecast", "95% lower", "95% upper"]);
    expect(fc.rows[1][1]).toBe("January 2026");
  });
  it("multiplicative seasonality prints no interval and says why; simple and damped Holt run", () => {
    const m = ets({ seasonal: "mul" });
    expectDisplayContract(m);
    expect(m.text).toContain("No prediction intervals: multiplicative seasonality");
    expect(m.tables![1].rows[0]).toEqual(["h", "Period", "Forecast"]);
    expectDisplayContract(ets({ seasonal: "none", trend: "none" }));
    const d = ets({ seasonal: "none", damped: "yes" });
    expectDisplayContract(d);
    expect(d.text).toMatch(/^Holt's method, damped additive trend/);
  });
  it("ARIMA variants: d = 0 with a mean, drift, d = 2, pure AR and MA", () => {
    const variants: Record<string, string>[] = [
      { d: "0" },
      { trend: "constant" },
      { d: "2", p: "0", q: "2" },
      { p: "2", q: "0" },
      { p: "0", q: "1", d: "0", trend: "none" },
    ];
    for (const over of variants) {
      const r = arima(over);
      expectDisplayContract(r);
    }
    expect(arima({ d: "0" }).tables![0].rows[1][0]).toBe("Mean");
    expect(arima({ trend: "constant" }).tables![0].rows[1][0]).toBe("Drift");
  });
});

describe("hostile inputs", () => {
  it("too few rows", () => {
    const short = seriesText([1, 2, 3, 4, 5, 6, 7]);
    const a = arima({ data: short });
    expect(a.ok).toBe(false);
    expect(a.text).toMatch(/at least \d+ are needed/);
    const e = ets({ data: seriesText(seasonalSeries(20, 1)), m: "12" });
    expect(e.ok).toBe(false);
    expect(e.text).toContain("two full seasonal cycles");
  });
  it("constant series and a straight line (constant after differencing)", () => {
    const c = seriesText(new Array(40).fill(5));
    expect(arima({ data: c, d: "0" }).text).toContain("constant");
    expect(arima({ data: c, d: "0" }).ok).toBe(false);
    const line = seriesText(Array.from({ length: 40 }, (_, i) => 3 + 2 * i));
    const r = arima({ data: line, d: "1" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("straight line");
    expect(ets({ data: c, seasonal: "none" }).ok).toBe(false);
  });
  it("a gap in the periods (irregular) is refused by naming it", () => {
    const rows = ["Quarter Value"];
    const v = arimaSeries(30, 3);
    let k = 0;
    for (let y = 2010; y < 2018; y++) {
      for (let qq = 1; qq <= 4; qq++) {
        if (y === 2012 && qq === 3) continue;
        if (k < 30) rows.push(`${y}-Q${qq} ${v[k++]}`);
      }
    }
    for (const r of [arima({ data: rows.join("\n") }), ets({ data: rows.join("\n") })]) {
      expect(r.ok).toBe(false);
      expect(r.text).toContain("2012 Q2 is followed by 2012 Q4");
    }
  });
  it("tiny and huge scales give the same model, scaled (1e−12, 1e12)", () => {
    const base = arimaSeries(150, 11);
    const r1 = arima({ data: seriesText(base) });
    const coef = (r: StatOutput): number[] =>
      r.tables![0].rows.filter((x) => /^(AR|MA)/.test(x[0])).map((x) => Number(x[1].replace("−", "-")));
    for (const s of [1e-12, 1e12]) {
      const r = arima({ data: seriesText(base.map((v) => v * s)) });
      expectDisplayContract(r);
      // Same maximum (the optimiser path may differ in the last printed digit).
      coef(r).forEach((v, i) => expect(Math.abs(v - coef(r1)[i])).toBeLessThan(2e-4));
      const e = ets({ data: seriesText(seasonalSeries(96, 5).map((v) => v * s)), m: "12" });
      expectDisplayContract(e);
    }
  });
  it("overflowing values are refused, never printed as Infinity", () => {
    const v = arimaSeries(60, 4).map((x, i) => (i % 2 ? 1.5e308 : -1.5e308) + x);
    const a = arima({ data: seriesText(v) });
    expect(a.ok).toBe(false);
    expect(a.text).toContain("differences of the values overflow double precision");
    expect(a.text).not.toMatch(/NaN|Infinity/);
    const e = ets({ data: seriesText(v), seasonal: "none" });
    expect(e.ok).toBe(false);
    expect(e.text).toContain("overflows double precision");
    expect(e.text).not.toMatch(/NaN|Infinity/);
  });
  it("values near 10¹⁶⁰ (σ² and SSE beyond double precision) are refused for overflow, never as a constant series", () => {
    const base = arimaSeries(150, 11);
    const r = arima({ data: seriesText(base.map((x) => x * 1e160)), d: "0" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("extreme scale");
    expect(r.text).not.toContain("constant");
    const e = ets({ data: seriesText(base.map((x) => x * 1e160)), seasonal: "none" });
    expect(e.ok).toBe(false);
    expect(e.text).toContain("overflows double precision");
    // Just inside the range both fit.
    expectDisplayContract(arima({ data: seriesText(base.map((x) => x * 1e150)), d: "0" }));
    expectDisplayContract(ets({ data: seriesText(base.map((x) => x * 1e150)), seasonal: "none" }));
  });
  it("multiplicative seasonality refuses a zero or negative value by row and date", () => {
    const lines = TS_ETS_DATA_DEFAULT.split("\n");
    lines[5] = "2016-05 0";
    const r = ets({ data: lines.join("\n"), seasonal: "mul" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("Row 5 (May 2016) is 0");
    lines[5] = "2016-05 −12.5";
    expect(ets({ data: lines.join("\n"), seasonal: "mul" }).text).toContain("is −12.5");
  });
  it("seasonal model without monthly or quarterly dates needs m", () => {
    const r = ets({ data: seriesText(seasonalSeries(60, 2)) });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("enter the seasonal period m");
    expectDisplayContract(ets({ data: seriesText(seasonalSeries(60, 2)), m: "12" }));
  });
  it("rubbish in every parameter field is refused by name; blank means the default", () => {
    for (const bad of ["abc", "−1", "-1", "1e400", "2.5", "999"]) {
      for (const key of ["p", "d", "q", "h"]) {
        const r = arima({ [key]: bad });
        expect(r.ok).toBe(false);
        expect(r.text).toMatch(/is not a whole number from/);
        expect(r.text).not.toMatch(/NaN|Infinity/);
      }
      for (const key of ["m", "h"]) {
        const r = ets({ [key]: bad });
        expect(r.ok).toBe(false);
        expect(r.text).toMatch(/is not a whole number from/);
      }
    }
    expect(arima({ trend: "abc" }).ok).toBe(false);
    expect(arima({ trend: "constant", d: "2" }).text).toContain("drift term needs d = 1");
    expect(ets({ trend: "mul" }).ok).toBe(false);
    expect(ets({ seasonal: "xyz" }).ok).toBe(false);
    expect(ets({ damped: "maybe" }).ok).toBe(false);
    for (const key of ["p", "d", "q", "h", "trend"]) expect(arima({ [key]: "" }).ok).not.toBe(false);
    expect(ets({ h: "" }).ok).not.toBe(false);
    expect(arima({ column: "Nope" }).text).toContain("No column is named");
  });
});

describe("100,000 rows do not freeze the pane", () => {
  // Bounds are 3× or more the times measured on the build machine (see the release report), because QC runs jest
  // with four workers.
  const big = arimaSeries(100000, 21);
  it("ts-arima, ARIMA(1, 1, 1)", () => {
    const t0 = Date.now();
    const r = arima({ data: seriesText(big) });
    const ms = Date.now() - t0;
    expectDisplayContract(r);
    expect(r.text).toContain("n = 100,000");
    expect(r.text).toContain("The figure shows the last 240 of 100,000 observations.");
    expect(ms).toBeLessThan(ARIMA_100K_BOUND_MS);
  });
  it("ts-arima, ARIMA(5, 1, 5): refused by name up front (work budget), not ground through", () => {
    const t0 = Date.now();
    const r = arima({ data: seriesText(big), p: "5", q: "5" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("needs more computation than the pane allows; use at most");
    expect(Date.now() - t0).toBeLessThan(REFUSE_100K_BOUND_MS);
  });
  it("ts-ets, damped Holt", () => {
    const s = big.map((v) => v + 300);
    const t0 = Date.now();
    const r = ets({ data: seriesText(s), seasonal: "none", damped: "yes" });
    const ms = Date.now() - t0;
    expectDisplayContract(r);
    expect(ms).toBeLessThan(ETS_100K_BOUND_MS);
  });
  it("ts-ets, Holt–Winters m = 12: refused by name up front (work budget)", () => {
    const s = big.map((v, i) => v + 300 + 5 * Math.sin((2 * Math.PI * i) / 12));
    const t0 = Date.now();
    const r = ets({ data: seriesText(s), m: "12" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("needs more computation than the pane allows; use at most");
    expect(Date.now() - t0).toBeLessThan(REFUSE_100K_BOUND_MS);
  });
});

const ARIMA_100K_BOUND_MS = 4000;
const ETS_100K_BOUND_MS = 3500;
const REFUSE_100K_BOUND_MS = 1500;

describe("E3 review round: integer fields", () => {
  test("hex, exponent and fractional orders and horizons are refused; 8.0 is 8", () => {
    for (const bad of ["0x3", "1e1", "2.5", "abc"]) {
      expect(tsArimaCalc((k) => ({ h: bad } as Record<string, string>)[k] ?? TS_ARIMA_DEFAULTS[k] ?? "").ok).toBe(false);
    }
    expect(tsArimaCalc((k) => ({ h: "8.0" } as Record<string, string>)[k] ?? TS_ARIMA_DEFAULTS[k] ?? "").ok).not.toBe(false);
  });
});

describe("E3 review round: ARIMA work is charged as it is done", () => {
  // Differenced white noise puts θ at −1, where the filter's covariance never settles (no steady-state shortcut), and
  // ARIMA(5, 0, 5) on a short series is dominated by the Lyapunov solve. Both used to run for minutes (140 s, 16 s);
  // measured now at 3.4 s and 2.5 s alone before refusing. Bounds allow for QC's four jest workers.
  const noise = (n: number, seed: number): string => {
    let s = seed;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      out.push(((s / 2147483648 - 0.5) * 3).toFixed(4));
    }
    return out.join("\n");
  };
  test("ARIMA(1, 1, 1) on 100,000 rows of noise answers within the limit", () => {
    const t0 = Date.now();
    arima({ data: noise(100000, 11), p: "1", d: "1", q: "1" });
    expect(Date.now() - t0).toBeLessThan(12000);
  });
  test("ARIMA(5, 0, 5) on 60 rows answers within the limit", () => {
    const t0 = Date.now();
    arima({ data: noise(60, 11), p: "5", d: "0", q: "5" });
    expect(Date.now() - t0).toBeLessThan(9000);
  });
});
