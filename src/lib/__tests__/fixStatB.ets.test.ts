/**
 * Fix round (R6 #1, BLOCKER): ts-ets fits reached a local minimum. The fit now scores the grid with three initial
 * trends, scouts the best grid points AND the best point of every face class of the smoothing box (each coordinate
 * at 0, at 1 or inside), then fits the best scouts to convergence. Gate: SSE ≤ statsmodels' best (its default and
 * brute optimisers) + 0.01% on the reviewer's repro cases.
 */
import { fitHoltWinters, hwForecast, type HwSpec } from "../holtWinters";
import { tsEtsCalc, TS_ETS_DEFAULTS } from "../tsForecastCalcs";

// r6\data_a.json, s3 (the reviewer's repro): statsmodels α = 1, β = 0, SSE 4,271.39, forecast at h = 12 of 272.99.
const S3 = [
  201.86, 217.05, 217.41, 214.57, 224.18, 208.74, 207.17, 200.33, 190.77, 196.39, 196.07, 203.01, 207.57, 221.81, 221.61, 221.66, 230.07, 219.82, 214.53,
  213.47, 206.42, 203.7, 207.82, 208.72, 221.46, 230.83, 236.06, 235.99, 224.15, 232.37, 224.34, 216.19, 214.94, 212.2, 214.82, 216.05, 224.42, 238.21,
  243.62, 246.62, 245.49, 241.53, 233.71, 227.37, 222.98, 223.79, 222.27, 232.46, 240.31, 247.02, 251.57, 256.91, 257.18, 246.68, 243.39, 236.69, 229.83,
  228.74, 228.76, 236.39, 243.39, 254.45, 260.91, 263.78, 265.31, 258.94, 250.61, 243.93, 238.02, 239.61, 242.37, 254.17, 262.2, 270.33, 278.43, 271.35,
  275.81, 271.38, 263.83, 262.08, 258.62, 252.74, 254.57, 255.53, 263.84, 277.6, 281.56, 280.61, 283.02, 279.78, 274.81, 264.98, 259.8, 259.42, 262.73,
  265.01,
];
// r6\data_c.json, h2: a smooth series whose multiplicative Holt–Winters optimum is the corner α = β = 1, γ = 0 (statsmodels
// brute 4.2571; its default optimiser stops at 13.2685, which is where the pane stopped too).
const H2 = [
  50.21, 50.9, 51.71, 52.29, 52.97, 53.64, 54.25, 54.64, 55.15, 55.75, 56.32, 56.82, 56.94, 56.91, 57.25, 57.53, 57.37, 57.62, 58.02, 59.06, 60.12, 61.04,
  61.52, 62.4, 64.05, 65.46, 66.67, 68.06, 69.2, 70.26, 71.21, 72.23, 73.57, 74.92, 76.54, 78.04, 79.63, 80.59, 81.1, 81.86, 82.44, 83.2, 84.12, 85.43,
  86.99, 88.85, 90.68, 92.3, 93.7, 94.95, 95.87, 96.62, 97.34, 98.14, 98.84, 98.96, 99.06, 99.22, 99.71, 100.38, 100.85, 101.1, 101.96, 103.04,
];

function fit(y: number[], spec: HwSpec) {
  const f = fitHoltWinters(y, spec);
  if (!f.ok) throw new Error(f.reason);
  return f;
}

describe("R6 #1: Holt–Winters reaches the global least-squares fit", () => {
  test("s3, Holt additive trend: SSE ≤ statsmodels' 4,271.3866 and the h = 12 forecast is about 272.99", () => {
    const spec: HwSpec = { trend: "add", damped: false, seasonal: "none", m: 0 };
    const f = fit(S3, spec);
    expect(f.sse).toBeLessThanOrEqual(4271.3866 * 1.0001);
    expect(f.params.alpha).toBeGreaterThan(0.999);
    expect(f.params.beta).toBeLessThan(1e-6);
    const fc = hwForecast(S3, spec, f.params, 12);
    expect(Math.abs(fc[11] - 272.99)).toBeLessThan(0.05);
  });
  test("the pane prints the corrected fit (SSE 4,271.4, not 4,287.7)", () => {
    const data = "Period\tSales\n" + S3.map((v, i) => `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}\t${v}`).join("\n");
    const over: Record<string, string> = { data, trend: "add", damped: "no", seasonal: "none", h: "12" };
    const o = tsEtsCalc((k) => over[k] ?? TS_ETS_DEFAULTS[k] ?? "");
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("SSE = 4,271.4");
    expect(o.text).not.toContain("4,287.7");
  });
  test("h2, multiplicative Holt–Winters: SSE ≤ statsmodels brute 4.2571 (was 13.27)", () => {
    const f = fit(H2, { trend: "add", damped: false, seasonal: "mul", m: 12 });
    expect(f.sse).toBeLessThanOrEqual(4.2571 * 1.0001);
  });
  test("h2, additive Holt–Winters: SSE ≤ statsmodels brute 4.2263 (was 13.20)", () => {
    const f = fit(H2, { trend: "add", damped: false, seasonal: "add", m: 12 });
    expect(f.sse).toBeLessThanOrEqual(4.2263 * 1.0001);
  });
});
