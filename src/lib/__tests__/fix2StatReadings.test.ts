/**
 * Stats fix round 2 (reviewer S, findings2-S): MAJOR 8 and the MINOR items, each pinned to the reviewer's repro.
 */
import * as fs from "fs";
import * as path from "path";
import { readingProblems } from "../calcReading";
import { assumptionsReading, multcompReading, multipleRegressionReading } from "../statPaneReadings";
import { fmtOddsRatio, fitLogit } from "../logitProbit";
import { logitReading, LOGIT_DEFAULT } from "../econCalcs";
import * as panelModule from "../panel";
import { panelReCalc, PANEL_RE_DEFAULTS } from "../panelCalcs";
import { macroIslmCalc, MACRO_ISLM_DEFAULTS } from "../gameMacroCalcs";
import { runBootstrap, bootMaxB, bootWork, BOOT_MAX_WORK } from "../bootstrap";
import { polynomialRegression, type MultipleRegressionResult } from "../regression";
import { tsVarCalc } from "../ts2StatCalcs";
import type { NormalityResult, VarianceHomogeneityResult } from "../diagnostics";
import type { FittedModel } from "../regModel";

const ok = (r: string | undefined): string => {
  expect(r).toBeDefined();
  expect(readingProblems(r)).toEqual([]);
  return r as string;
};
const norm = (p: number): NormalityResult => ({ ok: true, n: 30, skewness: 0, kurtosis: 0, k2: 1, p, normal: p >= 0.05 });
const vh = (p: number): VarianceHomogeneityResult => ({ ok: true, f: 1, df1: 1, df2: 28, p, equal: p >= 0.05, varianceRatio: 1.5 });

describe("MAJOR 8: the assumptions reading is on the one p rule", () => {
  test("p = 0.0496 and 0.0503 both print .050 and both get the borderline words", () => {
    for (const p of [0.0496, 0.0503]) {
      const r = ok(assumptionsReading(norm(p), vh(0.4), 2));
      expect(r).toMatch(/^The normality test \(p = \.050\) is right at the conventional 5% threshold, so the evidence is borderline; no evidence of unequal variances/);
      expect(r).toMatch(/A rank test or Welch's version is the cautious choice\.$/);
      const r2 = ok(assumptionsReading(norm(0.4), vh(p), 2));
      expect(r2).toMatch(/the equal-variance test \(p = \.050\) is right at the conventional 5% threshold/);
    }
  });
  test("either side of the boundary as printed", () => {
    expect(ok(assumptionsReading(norm(0.0494), vh(0.4), 2))).toMatch(/^The residuals look non-normal \(p = \.049\)/);
    expect(ok(assumptionsReading(norm(0.0506), vh(0.4), 2))).toMatch(/^No evidence against normal residuals \(p = \.051\)/);
  });
});

describe("MINOR: Hausman text decided on the printed p", () => {
  test("p printed 0.050 is borderline in the text, not 'rejected'", () => {
    const spy = jest.spyOn(panelModule, "hausman").mockReturnValue({ stat: 3.84, df: 1, p: 0.0499, names: ["x"], form: "classic", why: "V_FE − V_RE is positive definite", s2Fe: 1, s2Re: 1 });
    try {
      const o = panelReCalc((k) => PANEL_RE_DEFAULTS[k] ?? "");
      expect(o.text).toMatch(/Hausman χ²\(1\) = 3\.840, p = 0\.050 \(classic form\): right at the conventional 5% threshold, so the evidence is borderline \(the fixed-effects estimates are the cautious ones to report\)\./);
      expect(o.text).not.toMatch(/random-effects assumption is rejected/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("MINOR: multcomp, an adjusted p printed 0.05 is borderline", () => {
  test("one comparison", () => {
    const r = ok(multcompReading([0.025], [0.04998], "Bonferroni"));
    expect(r).toBe("After the Bonferroni correction the p-value is 0.05, right at the conventional 5% threshold, so the evidence is borderline.");
  });
  test("several: the borderline one is named as such, not as lost", () => {
    const r = ok(multcompReading([0.01, 0.025, 0.3], [0.03, 0.04997, 0.9], "Holm"));
    expect(r).toMatch(/^After the Holm correction one of the three p-values stays below 0\.05 \(raw 0\.01\); one is exactly 0\.05 as printed, right at the conventional 5% threshold/);
    expect(r).not.toMatch(/does not survive/);
    const none = ok(multcompReading([0.025, 0.3], [0.05, 0.6], "Bonferroni"));
    expect(none).toMatch(/neither of the two p-values stays below 0\.05; one is exactly 0\.05 as printed/);
  });
});

describe("MINOR: multiregress, overall not clear but one predictor is", () => {
  test("its own wording, not 'none is clearly related'", () => {
    const res = {
      ok: true,
      rSquared: 0.21,
      pOverall: 0.12,
      exactFit: false,
      coefficients: [
        { name: "Intercept", estimate: 1, se: 1, t: 1, p: 0.3 },
        { name: "x1", estimate: 2.5, se: 1, t: 2.5, p: 0.03 },
        { name: "x2", estimate: 0.1, se: 1, t: 0.1, p: 0.9 },
        { name: "x3", estimate: 0.2, se: 1, t: 0.2, p: 0.8 },
      ],
    } as unknown as MultipleRegressionResult;
    const r = ok(multipleRegressionReading(res));
    expect(r).toMatch(/so together they are not clearly related to it; x1 on its own is \(p = \.030\), but with several predictors tested one small p can be chance\.$/);
    expect(r).not.toMatch(/none is clearly related/);
  });
});

describe("MINOR: ts-var with three series, no link", () => {
  test("conditions on every series' past in the wording", () => {
    let hits = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let s = seed * 7919;
      const u = (): number => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647 - 0.5;
      };
      const rows = ["t A B C", ...Array.from({ length: 120 }, (_, i) => `${i + 1} ${u().toFixed(4)} ${u().toFixed(4)} ${u().toFixed(4)}`)];
      const o = tsVarCalc((k) => ({ data: rows.join("\n"), columns: "A, B, C", p: "1", maxlags: "4" })[k] ?? "");
      const r = ok(o.reading);
      if (/^No series helps predict another/.test(r)) {
        hits++;
        expect(r).toMatch(/^No series helps predict another beyond what its own past and the other series' pasts already predict at the 5% level/);
        expect(r).not.toMatch(/beyond its own past at/);
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe("MINOR: odds ratios to 4 significant figures on both sides of 1", () => {
  test("[0.99995, 1) prints 1.000, like 1.00001", () => {
    expect(fmtOddsRatio(0.99996)).toBe("1.000");
    expect(fmtOddsRatio(0.99995)).toBe("1.000");
    expect(fmtOddsRatio(1.00001)).toBe("1.000");
    expect(fmtOddsRatio(0.99994)).toBe("0.9999");
    expect(fmtOddsRatio(9.99996)).toBe("10.00");
    expect(fmtOddsRatio(0.12345)).toBe("0.1235");
  });
  test("so the reading never says 'odds about 1.0000 times as high'", () => {
    const rows = LOGIT_DEFAULT.split("\n").slice(1).map((l) => l.split(" ").map(Number));
    const base = fitLogit(rows.map((r) => r[0]), rows.map((r) => [r[1]]), ["x"], { constant: true, depName: "y" });
    const coef = Math.log(0.99996);
    const m: FittedModel = {
      ...base,
      terms: base.terms.map((t) => (t.name === "x" ? { ...t, coef, ciLo: coef - 1e-3, ciHi: coef + 1e-3 } : t)),
      marginalEffects: [{ name: "x", coef: 0.03, se: 0.01, stat: 3, p: 0.001, ciLo: 0.01, ciHi: 0.05 }],
    };
    const r = ok(logitReading(m));
    expect(r).not.toMatch(/odds about/);
  });
});

describe("MINOR: boot-ci names the replicates that would run", () => {
  test("median, 2,000 replicates on 2,500 rows: refused with the most replicates for those rows", () => {
    const y = Float64Array.from({ length: 2500 }, (_, i) => ((i * 7919) % 1000) / 10);
    const r = runBootstrap({ stat: "median", y, B: 2000, confidence: 0.95, seed: 1 });
    expect(r.ok).toBe(false);
    const maxB = bootMaxB("median", 2500);
    expect(maxB).toBeGreaterThanOrEqual(100);
    expect(bootWork("median", 2500, maxB)).toBeLessThanOrEqual(BOOT_MAX_WORK);
    expect(bootWork("median", 2500, maxB + 100)).toBeGreaterThan(BOOT_MAX_WORK);
    if (!r.ok) expect(r.reason).toMatch(new RegExp(`Use at most ${maxB.toLocaleString("en-US")} replicates for these 2,500 rows, or a sample of the rows\\.$`));
  });
});

describe("MINOR: macro-islm, Δr = 1 percentage point (singular)", () => {
  test("the default (ΔG = 50 moves r by exactly 1)", () => {
    const o = macroIslmCalc((k) => MACRO_ISLM_DEFAULTS[k] ?? "");
    expect(o.text).toMatch(/Δr = 1 percentage point\)/);
    expect(o.text).not.toMatch(/1 percentage points/);
    const o2 = macroIslmCalc((k) => ({ ...MACRO_ISLM_DEFAULTS, dG: "100" })[k] ?? "");
    expect(o2.text).toMatch(/Δr = 2 percentage points\)/);
  });
});

describe("MINOR: polyregress degree 5 or 6 is refused, not silently degree 4", () => {
  test("the reviewer's x in the hundreds (S2\\poly.json)", () => {
    const P = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fix2StatPoly.json"), "utf8")) as { xs: number[]; ys: number[] };
    for (const d of [5, 6]) {
      const r = polynomialRegression(P.xs, P.ys, d);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(`The degree must be a whole number from 1 to 4; ${d} is not offered (a higher degree overfits, and its powers of x are numerically unstable).`);
    }
    const r4 = polynomialRegression(P.xs, P.ys, 4);
    expect(r4.ok).toBe(true);
    expect(r4.degree).toBe(4);
  });
});
