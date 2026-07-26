// The three expression evaluators must agree on what a function means.
//
// plot.ts, stats.ts and solve.ts each carry their own function table, and they
// had drifted: `log` was the natural log in Plot and base 10 in Stats and Solve,
// so log(100) was 4.605 on a chart and 2 in an uncertainty calculation. `mod`
// was JS's remainder in Plot and true modulo in Stats, so mod(-7, 3) was -1 and
// 2. Nothing warned; both silently succeeded.
//
// This pins the shared vocabulary. Three tables in three modules will drift
// again unless something compares them.

import { evalFormula } from "../stats";
import { samplePlot } from "../plot";
import { solveEquation } from "../solve";

/** Evaluates `expr` at x through the Plot engine, by sampling one point. */
function viaPlot(expr: string, x: number): number {
  // samplePlot returns Point[] directly; two samples so the range is non-empty.
  const pts = samplePlot(expr, x, x + 1, 2).filter((p) => Number.isFinite(p.y));
  expect(pts.length).toBeGreaterThan(0);
  return pts[0].y;
}

const viaStats = (expr: string, x: number): number => evalFormula(expr, { x });

describe("log means the same thing everywhere", () => {
  test("log is base 10 in Stats", () => {
    expect(viaStats("log(100)", 0)).toBeCloseTo(2, 12);
  });

  test("log is base 10 in Plot", () => {
    // Was Math.log here alone, giving 4.60517.
    expect(viaPlot("log(100)", 1)).toBeCloseTo(2, 12);
  });

  test("Plot and Stats agree on log across several values", () => {
    for (const v of [1, 10, 100, 1000, 0.01]) {
      expect(viaPlot(`log(${v})`, 1)).toBeCloseTo(viaStats(`log(${v})`, 1), 12);
    }
  });

  test("ln is the natural log in both", () => {
    expect(viaStats("ln(100)", 0)).toBeCloseTo(Math.log(100), 12);
    expect(viaPlot("ln(100)", 1)).toBeCloseTo(Math.log(100), 12);
  });

  test("log10 and log2 are explicit and agree", () => {
    expect(viaPlot("log10(1000)", 1)).toBeCloseTo(3, 12);
    expect(viaStats("log10(1000)", 0)).toBeCloseTo(3, 12);
    expect(viaPlot("log2(8)", 1)).toBeCloseTo(3, 12);
    expect(viaStats("log2(8)", 0)).toBeCloseTo(3, 12);
  });

  test("Solve agrees too", () => {
    // log(x) = 2 has the root x = 100 only if log is base 10.
    const r = solveEquation("log(x) = 2");
    expect(r).not.toBeNull();
    const roots = r!.roots.map((x) => Number(x.display));
    expect(roots.some((x) => Math.abs(x - 100) < 1e-3)).toBe(true);
  });
});

describe("mod means the same thing everywhere", () => {
  test("mod carries the sign of the divisor in Stats", () => {
    expect(viaStats("mod(-7, 3)", 0)).toBeCloseTo(2, 12);
  });

  test("mod carries the sign of the divisor in Plot", () => {
    // Was JS %, giving -1.
    expect(viaPlot("mod(-7, 3)", 1)).toBeCloseTo(2, 12);
  });

  test("Plot and Stats agree across signs", () => {
    for (const [a, b] of [
      [7, 3],
      [-7, 3],
      [7, -3],
      [-7, -3],
      [10, 5],
    ]) {
      expect(viaPlot(`mod(${a}, ${b})`, 1)).toBeCloseTo(viaStats(`mod(${a}, ${b})`, 1), 12);
    }
  });
});

describe("the shared vocabulary is the same set of names", () => {
  // Not exhaustive — these are the ones a user is most likely to type into more
  // than one tool and expect to behave identically.
  const SHARED = ["sqrt(16)", "abs(-3)", "exp(1)", "sin(1)", "cos(1)", "tan(1)", "cbrt(27)"];

  test.each(SHARED)("%s agrees between Plot and Stats", (expr) => {
    expect(viaPlot(expr, 1)).toBeCloseTo(viaStats(expr, 1), 10);
  });
});
