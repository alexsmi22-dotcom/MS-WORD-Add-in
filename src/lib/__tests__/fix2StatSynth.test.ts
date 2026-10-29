/**
 * Stats fix round 2, MAJOR 3 (reviewer S): causal-synth said "did not track" for an excellent pre-period fit whenever
 * the effect was small (the rule was RMSPE ≥ |gap|), and dropped the placebo p. The fit is now judged against the
 * treated series' own pre-period variation (synthPoorFit), and a small gap after a tight fit reads "no clear effect"
 * with the placebo comparison kept. Fresh seeded panels: tight fit + small effect, poor fit, tight fit + large effect.
 */
import { readingProblems } from "../calcReading";
import { synthCalc, synthPoorFit } from "../causalStatCalcs";

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const u1 = (s + 0.5) / 4294967296;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const u2 = (s + 0.5) / 4294967296;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

/** 30 years (1990–2019), treated from 2010; six donors with distinct trends and cycles; treated = a donor mix. */
function panel(seed: number, noise: number, effect: number): string {
  const g = rng(seed);
  const years = Array.from({ length: 30 }, (_, i) => 1990 + i);
  const donors = Array.from({ length: 6 }, (_, j) => years.map((_, t) => 50 + 3 * j + (0.4 + 0.15 * j) * t + 4 * Math.sin(t / (2 + j)) + g()));
  const w = [0.4, 0.3, 0.2, 0.1, 0, 0];
  const treated = years.map((y, t) => donors.reduce((a, d, j) => a + w[j] * d[t], 0) + noise * g() + (y >= 2010 ? effect : 0));
  const head = ["Year", "Treated", ...donors.map((_, j) => `D${j + 1}`)].join("\t");
  return [head, ...years.map((y, t) => [y, treated[t].toFixed(3), ...donors.map((d) => d[t].toFixed(3))].join("\t"))].join("\n");
}
const run = (data: string) => synthCalc((k) => ({ data, period: "Year", treated: "Treated", donors: "", start: "2010", placebo: "yes" })[k] ?? "");
const ok = (r: string | undefined): string => {
  expect(r).toBeDefined();
  expect(readingProblems(r)).toEqual([]);
  return r as string;
};

describe("MAJOR 3: the synthetic control's pre-period fit is judged against the series' own variation", () => {
  test("tight fit, small effect: 'no clear effect', the placebo p kept, never 'did not track'", () => {
    for (const seed of [1, 2, 3]) {
      const o = run(panel(seed, 0.05, 0.02));
      const r = ok(o.reading);
      expect(r).not.toMatch(/did not track/);
      expect(o.text).not.toMatch(/does not track/);
      expect(r).toMatch(/no more than its typical pre-period gap \(RMSPE [\d.]+\), so there is no clear effect; its gap relative to its pre-period fit ranks (only )?\d+ of 7 against placebo units \(permutation p = [\d.]+\)/);
    }
  });
  test("poor fit (noise as large as the series' own movement), small effect: 'did not track'", () => {
    for (const seed of [4, 5]) {
      const o = run(panel(seed, 12, 0.5));
      const r = ok(o.reading);
      expect(r).toMatch(/but the synthetic control did not track it before treatment \(pre-period RMSPE [\d.]+\), so that gap is not a reliable estimate of the effect\.$/);
      expect(o.text).toMatch(/more than half the treated series' own pre-period standard deviation of [\d.]+/);
    }
  });
  test("tight fit, large effect: the estimated effect, with the placebo comparison", () => {
    const o = run(panel(6, 0.05, 5));
    const r = ok(o.reading);
    expect(r).toMatch(/^After treatment, Treated ran on average 5\.\d{3} above its synthetic control \(the estimated effect\); its gap is the largest of the 7 units relative to fit, but with 6 donors the permutation p cannot go below 0\.143/);
  });
  test("the threshold: RMSPE exactly half the SD is not a poor fit; just above it (with RMSPE ≥ |gap|) is", () => {
    const base = { exactPre: false, att: 0.4, sdPre: 2, outside: 0, T0: 20 };
    expect(synthPoorFit({ ...base, pre: 1 })).toEqual({ byFit: false, byRange: false });
    expect(synthPoorFit({ ...base, pre: 1.000001 })).toEqual({ byFit: true, byRange: false });
    // A poor fit whose gap is well beyond its fitting error is not flagged by the fit (the gap is not within the error).
    expect(synthPoorFit({ ...base, pre: 1.5, att: 3 }).byFit).toBe(false);
    // Outside the donors' range in most pre-periods: poor whatever the RMSPE.
    expect(synthPoorFit({ ...base, pre: 0.01, outside: 11 }).byRange).toBe(true);
    expect(synthPoorFit({ ...base, pre: 0.01, outside: 10 }).byRange).toBe(false);
    // A gap of 0, or an exact fit: never flagged.
    expect(synthPoorFit({ ...base, pre: 5, att: 0 })).toEqual({ byFit: false, byRange: false });
    expect(synthPoorFit({ ...base, pre: 5, exactPre: true })).toEqual({ byFit: false, byRange: false });
  });
});
