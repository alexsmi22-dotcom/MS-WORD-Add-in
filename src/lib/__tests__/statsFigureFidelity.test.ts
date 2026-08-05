// A figure must not contradict the number printed beside it.
//
// Every case here was found by an independent adversarial pass over the batch
// that made all 21 Statistics calculators draw. None of them is a crash; each
// is a picture that is quietly at odds with its own result, which is the worst
// failure mode a chart has — a reader trusts the picture over the prose, and
// nothing in a green suite ever disagrees with them.

import * as fs from "fs";
import * as path from "path";
import { propagateUncertainty } from "../stats";
import { wilcoxonSignedRank } from "../stats2";
import { groupedBarSvg } from "../statchart";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

function calcBody(registry: string, id: string): string {
  const start = PANE.indexOf(`const ${registry}`);
  const end = PANE.indexOf("\n];", start);
  const src = PANE.slice(start, end);
  const at = src.indexOf(`id: "${id}"`);
  expect(at).toBeGreaterThan(0);
  const next = src.indexOf('    id: "', at + 10);
  return src.slice(at, next < 0 ? src.length : next);
}

describe("uncertainty: the bars are in the result's units, not squared", () => {
  // `contribution` is (partial * u)^2 — a VARIANCE, in (result units)^2. Plotted
  // raw it put three bars of 0.16 under a title reading "contribution to
  // combined uncertainty" beside a printed ± of 0.693, and no reader could get
  // from one to the other.
  test("the engine really does report a variance (the hazard is live)", () => {
    const res = propagateUncertainty("a*b/c", {
      a: { value: 10, uncertainty: 0.1 },
      b: { value: 20, uncertainty: 0.2 },
      c: { value: 5, uncertainty: 0.05 },
    });
    // Variances add LINEARLY to the combined variance...
    const sum = res.contributions.reduce((s, c) => s + c.contribution, 0);
    expect(Math.sqrt(sum)).toBeCloseTo(res.uncertainty, 9);
    // ...and each individual contribution is far smaller than the reported ±,
    // which is exactly what made the raw plot unreadable.
    expect(res.contributions[0].contribution).toBeLessThan(res.uncertainty);
  });

  test("the square root puts a bar in the same units as the printed ±", () => {
    const res = propagateUncertainty("a*b/c", {
      a: { value: 10, uncertainty: 0.1 },
      b: { value: 20, uncertainty: 0.2 },
      c: { value: 5, uncertainty: 0.05 },
    });
    const bars = res.contributions.map((c) => Math.sqrt(c.contribution));
    // Quadrature over the bars reproduces the reported uncertainty exactly.
    const combined = Math.sqrt(bars.reduce((s, b) => s + b * b, 0));
    expect(combined).toBeCloseTo(res.uncertainty, 9);
    // And every bar is now the same order as the ±, not a hundredth of it.
    for (const b of bars) expect(b).toBeGreaterThan(res.uncertainty / 10);
  });

  test("the pane takes the root and says so on the axis", () => {
    const body = calcBody("STAT_CALCS", "uncertainty");
    expect(body).toContain("Math.sqrt");
    expect(body).toMatch(/same units as the result/);
  });
});

describe("wilcoxon: the box plot counts the same pairs the test did", () => {
  test("the engine drops tied pairs, so the figure must too", () => {
    // The shipped default has one tied pair, so this fired on the default view:
    // the text read n = 7 and the difference box read n = 8.
    const a = [5, 6, 7, 8, 9, 10, 11, 12];
    const b = [4, 4, 6, 5, 9, 8, 9, 10];
    const res = wilcoxonSignedRank(a, b);
    const drawnAll = a.map((v, i) => v - b[i]);
    const drawnKept = drawnAll.filter((d) => d !== 0);
    expect(drawnAll).toHaveLength(8);
    expect(res.n1).toBe(7);
    expect(drawnKept).toHaveLength(res.n1);
  });

  test("the pane filters the zero differences out", () => {
    const body = calcBody("STAT_CALCS", "wilcoxon");
    expect(body).toMatch(/filter\(\(d\) => d !== 0\)/);
  });
});

describe("chi-square independence refuses a table of zeros", () => {
  // With a zero grand total every expected count is NaN, the engine's guards
  // skip every cell, and it returned chi2 = 0, df = 1, p = 1 with no warning —
  // text carrying no NaN, no Infinity and no em dash, so the insertability gate
  // passed "p = 1" straight into a document as though the data showed no
  // association. The figure beside it drew observed bars, silently skipped every
  // expected bar as non-finite, and still printed a legend promising both.
  test("the pane refuses before computing", () => {
    const body = calcBody("STAT_CALCS", "chiind");
    expect(body).toMatch(/every count is zero/i);
    // The refusal must come BEFORE the engine call, or the bad result is built.
    expect(body.indexOf("Every count is zero")).toBeLessThan(
      body.indexOf("chiSquareIndependence(table)"),
    );
  });
});

describe("grouped bars never give two series the same colour", () => {
  test("eight series get eight distinct colours", () => {
    const svg = groupedBarSvg(
      ["a", "b"],
      Array.from({ length: 8 }, (_, k) => ({ label: `s${k}`, values: [k + 1, k + 2] })),
      { title: "t" },
    );
    const fills = [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
    // Paper background aside, the bar and legend colours must be 8 distinct hues.
    const hues = new Set(fills.filter((f) => f !== "#ffffff"));
    expect(hues.size).toBe(8);
  });

  test("a ninth series is dropped and REPORTED, never drawn in a repeated colour", () => {
    // A two-way ANOVA with six levels of factor B drew levels 1 and 5 in the
    // same blue. On an interaction plot the colour IS the mapping, so a shared
    // colour is not a clash, it is a wrong figure.
    const svg = groupedBarSvg(
      ["a", "b"],
      Array.from({ length: 11 }, (_, k) => ({ label: `s${k}`, values: [k + 1, k + 2] })),
      { title: "t" },
    );
    expect(svg).toMatch(/3 more series not shown/);
    const hues = new Set(
      [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/gi)]
        .map((m) => m[1].toLowerCase())
        .filter((f) => f !== "#ffffff"),
    );
    expect(hues.size).toBe(8);
  });
});

describe("the Stats chart button cannot outlive the text gate", () => {
  // uncertainty with a zero denominator gives an infinite value and a NaN
  // uncertainty: the text is correctly blocked, hBarSvg returns its "no finite
  // values to chart" placeholder, and the chart button stayed enabled — so the
  // one thing a user could still insert was a picture saying the answer does
  // not exist.
  test("the chart button is disabled whenever the result is", () => {
    expect(PANE).toContain("statsInsertChartBtn.disabled = !insertable || !currentStatsSvg");
  });
});

describe("the Q-Q plot is bounded on a per-keystroke path", () => {
  // Every other figure in the registry caps its point count; this one did not,
  // and it recomputes on every keystroke with no debounce. Measured at 40,000
  // pasted values: a 2.1 MB SVG with 40,000 circles per character typed.
  test("assumptions caps its points and reuses the residuals already computed", () => {
    const body = calcBody("STAT_CALCS", "assumptions");
    expect(body).toMatch(/const CAP = \d+/);
    expect(body).toContain("qqPoints(residuals)");
    // A third normalityCheckSample call for the figure would redo an
    // incompleteBeta per element for a value already in scope.
    expect(body.match(/normalityCheckSample\(/g) ?? []).toHaveLength(1);
  });
});
