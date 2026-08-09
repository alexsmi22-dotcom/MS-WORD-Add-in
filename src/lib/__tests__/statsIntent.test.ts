// Statistics questions pasted as prose (src/lib/statsIntent.ts) — oracles
// computed by hand, refusals named, transparency lines present.

import { tryStatsIntent } from "../statsIntent";
import { normalizeTaskProse } from "../pasteMath";
import { trySum, tryAlgebraVerb } from "../algebraTools";
import { parseLimitRequest } from "../analysis";

describe("descriptive statistics from prose", () => {
  test("mean of 3, 5, 8 and 12 — the classic paste", () => {
    const r = tryStatsIntent("Find the mean of 3, 5, 8 and 12.")!;
    expect(r.lines[0]).toBe("mean = 7"); // (3+5+8+12)/4
    expect(r.steps[0]).toContain("3, 5, 8, 12"); // the values read, listed back
  });

  test("sample SD divides by n − 1, and SAYS so with the population value alongside", () => {
    // Values 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population SD 2, sample SD ≈ 2.13809
    const r = tryStatsIntent("standard deviation of 2, 4, 4, 4, 5, 5, 7, 9")!;
    expect(r.lines[0]).toContain("2.1380899");
    expect(r.lines[0]).toContain("population: 2");
    expect(r.caveats.join(" ")).toMatch(/n − 1/);
  });

  test("median, mode and range answer correctly, mode honestly", () => {
    const r = tryStatsIntent("median of 1, 3, 3, 6, 7, 8, 9")!;
    expect(r.lines[0]).toBe("median = 6");
    const m = tryStatsIntent("mode of 1, 2, 2, 3, 3, 4")!;
    expect(m.lines[0]).toContain("multimodal: 2, 3");
    const none = tryStatsIntent("mode of 1, 2, 3")!;
    expect(none.lines[0]).toContain("no mode");
    const rg = tryStatsIntent("range of 4, 9, 1, 7")!;
    expect(rg.lines[0]).toBe("range = 8 (min 1, max 9)");
  });

  test("the asked statistic leads; the rest follows as context", () => {
    const r = tryStatsIntent("What is the variance of 2, 4, 6, 8?")!;
    expect(r.lines[0]).toContain("variance");
    expect(r.lines.join(" ")).toContain("mean = 5");
  });

  test("named refusals: no list; a single value is not a list", () => {
    expect(tryStatsIntent("find the mean of the sample")!.caveats.join(" ")).toMatch(/comma-separated list/);
    expect(tryStatsIntent("standard deviation of 5")!.caveats.join(" ")).toMatch(/comma-separated list/);
  });

  test("non-stats text returns null — no theft", () => {
    expect(tryStatsIntent("x^2 - 4 = 0")).toBeNull();
    expect(tryStatsIntent("sum k^2 from 1 to n")).toBeNull();
  });

  test("THEFT GUARD (independent pass): algebra keeps its equations", () => {
    // Every one of these was answered with confident wrong statistics.
    expect(tryStatsIntent("x - mean = 4")).toBeNull();
    expect(tryStatsIntent("range of the function f(x) = x^2")).toBeNull();
    expect(tryStatsIntent("Verify the mean value theorem for f(x) = x^2 on [1, 3]")).toBeNull();
    expect(tryStatsIntent("find the range of x if 2*x + 3 < 11")).toBeNull();
    // Stats-worded WORD PROBLEMS (no listed values) refuse by name, pointing
    // at the Word problem kind — never "mean = 9" computed from the strays.
    const wp = tryStatsIntent("The mean of 5 numbers is 12. If one number is removed the mean becomes 10. What was removed?")!;
    expect(wp.lines).toEqual([]);
    expect(wp.caveats.join(" ")).toMatch(/word problem/i);
  });

  test("prose-embedded stray numbers never join the list (the date leak)", () => {
    const r = tryStatsIntent("mean of sales on March 5: 10, 20, 30")!;
    expect(r.lines[0]).toBe("mean = 20"); // the 5 stays out of the run
    expect(r.steps[0]).toContain("10, 20, 30");
    expect(r.steps[0]).not.toMatch(/\b5,/);
  });

  test("zero-variance correlation refuses by name — never r = 0 beside r² = 1", () => {
    expect(tryStatsIntent("correlation between x: 1, 2, 3 and y: 5, 5, 5")!.caveats.join(" ")).toMatch(/never varies/);
    expect(tryStatsIntent("correlation between x: 5, 5, 5 and y: 1, 2, 3")!.caveats.join(" ")).toMatch(/never varies/);
  });
});

describe("two-group questions", () => {
  test("Welch t-test from labelled groups, verified against a hand-checked case", () => {
    const r = tryStatsIntent("Is A: 1, 2, 3, 4, 5 significantly different from B: 6, 7, 8, 9, 10?")!;
    expect(r.title).toContain("Welch");
    expect(r.lines[1]).toContain("mean 3");
    expect(r.lines[1]).toContain("mean 8");
    // Means differ by 5 with SD ≈ 1.58 each — decisively significant.
    expect(r.lines[0]).toMatch(/p < \.001|p = \.00/);
  });

  test("paired requires equal lengths, by name", () => {
    const r = tryStatsIntent("paired t-test A: 1, 2, 3 B: 4, 5")!;
    expect(r.caveats.join(" ")).toMatch(/same length/);
  });

  test("correlation: perfect line gives r = 1; mismatched lengths refuse", () => {
    const r = tryStatsIntent("correlation between x: 1, 2, 3, 4 and y: 2, 4, 6, 8")!;
    expect(r.lines[0]).toContain("r = 1");
    expect(r.lines[1]).toContain("2·x + 0");
    const bad = tryStatsIntent("correlation between x: 1, 2, 3 and y: 1, 2")!;
    expect(bad.caveats.join(" ")).toMatch(/same length/);
  });

  test("comparison intent with no groups refuses with instructions", () => {
    const r = tryStatsIntent("are the two groups significantly different?")!;
    expect(r.caveats.join(" ")).toMatch(/TWO groups/);
  });
});

describe("task-prose normalisation routes the word-led engines", () => {
  test("Find the sum of 1 to 100 reaches the series engine", () => {
    expect(trySum(normalizeTaskProse("Find the sum of 1 to 100"))!.display).toBe("5050");
  });

  test("Factor the expression x^2 - 5x + 6 factors", () => {
    const r = tryAlgebraVerb(normalizeTaskProse("Factor the expression x^2 - 5*x + 6"))
      ?? tryAlgebraVerb("factor the expression x^2 - 5*x + 6");
    expect(r!.lines[0].text).toBe("(x - 2)*(x - 3)");
  });

  test("Evaluate the limit of sin(x)/x as x approaches 0 parses as a limit", () => {
    const lim = parseLimitRequest(normalizeTaskProse("Evaluate the limit of sin(x)/x as x approaches 0"));
    expect(lim).not.toBeNull();
    expect(lim!.expr).toBe("sin(x)/x");
    expect(lim!.point).toBe(0);
  });

  test("normalisation never mangles a plain equation", () => {
    expect(normalizeTaskProse("x^2 - 4 = 0")).toBe("x^2 - 4 = 0");
  });
});
