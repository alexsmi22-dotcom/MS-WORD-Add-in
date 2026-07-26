// Survival analysis.
//
// Censoring is the thing to get right, so most of these compare a censored
// dataset against the uncensored one where the answer is known exactly. The
// dangerous failure is treating a censored subject as an event — the curve then
// drops when nobody died, and the estimate is pessimistic in a way that looks
// perfectly reasonable on screen.

import { kaplanMeier, logRankTest, survivalCurvePoints } from "../survival";

describe("Kaplan-Meier with no censoring reduces to the empirical curve", () => {
  test("every subject has an event: S(t) is just the proportion left", () => {
    const r = kaplanMeier([1, 2, 3, 4], [1, 1, 1, 1]);
    expect(r.ok).toBe(true);
    expect(r.points.map((p) => p.survival)).toEqual([0.75, 0.5, 0.25, 0]);
    expect(r.events).toBe(4);
    expect(r.censored).toBe(0);
  });

  test("tied event times drop the curve once, by the right amount", () => {
    // Two events at t=2 out of 4 at risk: S goes 1 -> 0.5 in one step.
    const r = kaplanMeier([2, 2, 5, 6], [1, 1, 1, 1]);
    expect(r.points[0].time).toBe(2);
    expect(r.points[0].events).toBe(2);
    expect(r.points[0].atRisk).toBe(4);
    expect(r.points[0].survival).toBeCloseTo(0.5, 12);
  });
});

describe("censoring", () => {
  test("a censored subject does NOT step the curve", () => {
    // The failure that matters: treating censoring as an event.
    const r = kaplanMeier([1, 2, 3], [1, 0, 1]);
    const atTwo = r.points.find((p) => p.time === 2)!;
    expect(atTwo.censored).toBe(1);
    expect(atTwo.events).toBe(0);
    // S is unchanged across the censoring.
    expect(atTwo.survival).toBeCloseTo(r.points[0].survival, 12);
  });

  test("but it DOES leave the risk set afterwards", () => {
    // 3 subjects: event at 1, censored at 2, event at 3.
    // t=1: 3 at risk, S = 2/3.  t=3: only 1 at risk, so S = 2/3 * 0 = 0.
    const r = kaplanMeier([1, 2, 3], [1, 0, 1]);
    expect(r.points[0].survival).toBeCloseTo(2 / 3, 12);
    const atThree = r.points.find((p) => p.time === 3)!;
    expect(atThree.atRisk).toBe(1);
    expect(atThree.survival).toBeCloseTo(0, 12);
  });

  test("censoring gives HIGHER survival at a given time than calling them events", () => {
    // Compared at t = 4, not at the end: with the last subject having an event
    // the curve reaches 0 either way, so the final point cannot show this. (An
    // earlier version of this test compared the last points and failed for that
    // reason — my expectation, not the estimator.)
    const censored = kaplanMeier([1, 2, 3, 4, 5], [1, 0, 0, 0, 1]);
    const asEvents = kaplanMeier([1, 2, 3, 4, 5], [1, 1, 1, 1, 1]);
    const at = (r: ReturnType<typeof kaplanMeier>, t: number): number =>
      r.points.filter((p) => p.time <= t).slice(-1)[0].survival;

    expect(at(censored, 4)).toBeCloseTo(0.8, 12); // one event out of five, then nothing
    expect(at(asEvents, 4)).toBeCloseTo(0.2, 12); // four events out of five
    expect(at(censored, 4)).toBeGreaterThan(at(asEvents, 4));
  });

  test("all subjects censored: the curve never falls", () => {
    const r = kaplanMeier([1, 2, 3], [0, 0, 0]);
    expect(r.ok).toBe(true);
    expect(r.events).toBe(0);
    for (const p of r.points) expect(p.survival).toBeCloseTo(1, 12);
    expect(r.medianSurvival).toBeNull();
  });
});

describe("median survival", () => {
  test("is the first time S(t) reaches or passes 0.5", () => {
    const r = kaplanMeier([1, 2, 3, 4], [1, 1, 1, 1]);
    expect(r.medianSurvival).toBe(2); // S(2) = 0.5
  });

  test("is NOT REACHED when the curve stays above 0.5, and says so", () => {
    // Reporting the longest observed time here would understate survival, which
    // is the common spreadsheet error.
    const r = kaplanMeier([5, 10, 15, 20], [1, 0, 0, 0]);
    expect(r.medianSurvival).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/NOT REACHED/);
  });
});

describe("Greenwood intervals", () => {
  test("the interval is centred on S(t) and stays inside [0,1]", () => {
    const r = kaplanMeier([1, 2, 3, 4, 5, 6, 7, 8], [1, 0, 1, 0, 1, 0, 1, 0]);
    for (const p of r.points) {
      if (!Number.isFinite(p.standardError)) continue;
      expect(p.ci95[0]).toBeGreaterThanOrEqual(0);
      expect(p.ci95[1]).toBeLessThanOrEqual(1);
      expect(p.ci95[0]).toBeLessThanOrEqual(p.survival + 1e-12);
      expect(p.ci95[1]).toBeGreaterThanOrEqual(p.survival - 1e-12);
    }
  });

  test("the standard error is zero before any event and grows after", () => {
    const r = kaplanMeier([1, 2, 3, 4, 5, 6], [1, 1, 1, 1, 1, 1]);
    const ses = r.points.map((p) => p.standardError).filter((v) => Number.isFinite(v));
    expect(ses[0]).toBeGreaterThan(0);
    // Uncertainty grows as the risk set shrinks.
    expect(ses[1]).toBeGreaterThan(ses[0]);
  });
});

describe("what it refuses", () => {
  test("mismatched lengths", () => {
    expect(kaplanMeier([1, 2, 3], [1, 1]).ok).toBe(false);
  });
  test("an indicator that is not 0 or 1", () => {
    expect(kaplanMeier([1, 2], [1, 2]).ok).toBe(false);
  });
  test("a negative time", () => {
    expect(kaplanMeier([-1, 2], [1, 1]).ok).toBe(false);
  });
  test("no data", () => {
    expect(kaplanMeier([], []).ok).toBe(false);
  });
});

describe("the log-rank test", () => {
  test("identical groups give chi-square near zero", () => {
    const g = { times: [1, 2, 3, 4, 5], events: [1, 1, 1, 1, 1] };
    const r = logRankTest([g, { ...g }]);
    expect(r.ok).toBe(true);
    expect(r.chi2).toBeCloseTo(0, 6);
    expect(r.p).toBeGreaterThan(0.9);
  });

  test("completely separated groups are significant", () => {
    const early = { times: [1, 2, 3, 4, 5, 6], events: [1, 1, 1, 1, 1, 1] };
    const late = { times: [20, 21, 22, 23, 24, 25], events: [1, 1, 1, 1, 1, 1] };
    const r = logRankTest([early, late]);
    expect(r.p).toBeLessThan(0.01);
  });

  test("observed and expected each sum to the total number of events", () => {
    const a = { times: [1, 3, 5, 7], events: [1, 1, 0, 1] };
    const b = { times: [2, 4, 6, 8], events: [1, 0, 1, 1] };
    const r = logRankTest([a, b]);
    const totalObs = r.observed.reduce((x, y) => x + y, 0);
    const totalExp = r.expected.reduce((x, y) => x + y, 0);
    expect(totalExp).toBeCloseTo(totalObs, 8);
  });

  test("the hazard ratio points the right way", () => {
    // Group 2 dies sooner, so its hazard is HIGHER: HR > 1.
    const good = { times: [20, 21, 22, 23, 24, 25], events: [1, 1, 1, 1, 1, 1] };
    const bad = { times: [1, 2, 3, 4, 5, 6], events: [1, 1, 1, 1, 1, 1] };
    const r = logRankTest([good, bad]);
    expect(r.hazardRatio).not.toBeNull();
    expect(r.hazardRatio!).toBeGreaterThan(1);
    // And the interval excludes 1 for a difference this stark.
    expect(r.hazardRatioCI![0]).toBeGreaterThan(1);
  });

  test("identical groups give a hazard ratio near 1 whose interval spans 1", () => {
    const g = { times: [1, 2, 3, 4, 5, 6], events: [1, 1, 1, 1, 1, 1] };
    const r = logRankTest([g, { ...g }]);
    expect(r.hazardRatio!).toBeCloseTo(1, 6);
    expect(r.hazardRatioCI![0]).toBeLessThan(1);
    expect(r.hazardRatioCI![1]).toBeGreaterThan(1);
  });

  test("three groups get a chi-square with 2 df and no single hazard ratio", () => {
    // One ratio has no meaning across three groups, so none is offered.
    const g = (o: number) => ({ times: [1 + o, 2 + o, 3 + o], events: [1, 1, 1] });
    const r = logRankTest([g(0), g(5), g(10)]);
    expect(r.df).toBe(2);
    expect(r.hazardRatio).toBeNull();
  });

  test("refuses fewer than two groups, and a dataset with no events", () => {
    expect(logRankTest([{ times: [1, 2], events: [1, 1] }]).ok).toBe(false);
    const noEvents = logRankTest([
      { times: [1, 2], events: [0, 0] },
      { times: [3, 4], events: [0, 0] },
    ]);
    expect(noEvents.ok).toBe(false);
    expect(noEvents.reason).toMatch(/No events/);
  });

  test("it names the proportional-hazards assumption it rests on", () => {
    const r = logRankTest([
      { times: [1, 2, 3], events: [1, 1, 1] },
      { times: [4, 5, 6], events: [1, 1, 1] },
    ]);
    expect(r.caveats.join(" ")).toMatch(/PROPORTIONAL HAZARDS/);
    expect(r.caveats.join(" ")).toMatch(/curves cross/);
  });
});

describe("the drawn curve", () => {
  test("starts at S = 1 and steps down only at events", () => {
    const r = kaplanMeier([1, 2, 3], [1, 0, 1]);
    const pts = survivalCurvePoints(r);
    expect(pts[0]).toEqual({ x: 0, y: 1 });
    // Two vertices per event (across, then down); one event at t=1, one at t=3.
    expect(pts.filter((p) => p.x === 2)).toHaveLength(0); // the censoring adds none
    expect(pts.length).toBe(1 + 2 * 2);
  });

  test("the curve is non-increasing", () => {
    const r = kaplanMeier([1, 2, 3, 4, 5, 6], [1, 0, 1, 1, 0, 1]);
    const pts = survivalCurvePoints(r);
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeLessThanOrEqual(pts[i - 1].y + 1e-12);
  });
});
