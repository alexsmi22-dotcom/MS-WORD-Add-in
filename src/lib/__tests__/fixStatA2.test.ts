/**
 * Stats fixer A, part 2: the 2026-10-28 bug test's R5 findings on the inline econometrics (econ-ols, econ-regtable,
 * econ-logit, iv-2sls, panels, qreg, es-event) and R6 #8/#13/#14 (statPaneModelReadings), pinned to the reviewers'
 * repro inputs (fixtures/fixStatA-repros.json, copied from their cases files by tag).
 */
import * as fs from "fs";
import * as path from "path";
import { readingProblems } from "../calcReading";
import { econOlsCalc, econLogitCalc, econRegTableCalc, logitReading, ameScale, ECON_MAX_ROWS, ECON_TABLE_MAX_ROW_MODELS, LONGLEY_DEFAULT, LOGIT_DEFAULT, LOGIT_SPEC_DEFAULT, olsReading } from "../econCalcs";
import { iv2slsWithReading, macroIslmWithReading, macroSolowWithReading, macroTaylorWithReading } from "../statPaneModelReadings";
import { iv2slsCalc, IV_2SLS_DEFAULTS } from "../ivCalcs";
import { MACRO_ISLM_DEFAULTS, MACRO_SOLOW_DEFAULTS, MACRO_TAYLOR_DEFAULTS } from "../gameMacroCalcs";
import { fitLogit, fmtOddsRatio } from "../logitProbit";
import { panelDidReading, panelReReading, PANEL_PANE_MAX_ROWS } from "../panelCalcs";
import { qregReading } from "../robustCalcs";
import { readIntField } from "../eventStudy";
import type { FittedModel, ModelTerm } from "../regModel";
import type { OlsFit } from "../olsInference";

const FX: Record<string, { calc: string; fields: Record<string, string> }> = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fixStatA-repros.json"), "utf8"));
const rd = (d: Record<string, string>, o: Record<string, string> = {}) => (k: string): string => o[k] ?? d[k] ?? "";
const ok = (r: string | undefined): string => {
  expect(r).toBeDefined();
  expect(readingProblems(r)).toEqual([]);
  return r as string;
};
const term = (name: string, coef: number, p: number): ModelTerm => ({ name, coef, se: 1, stat: coef, p, ciLo: coef - 1, ciHi: coef + 1 });

describe("R5 BLOCKER 1: a logit reading never states a probability change above 1", () => {
  test("or-tiny: the AME −1.331 is quoted per 0.01 of x, and the text prints the scaled value", () => {
    const c = FX["or-tiny"];
    const o = econLogitCalc(rd({}, c.fields));
    const r = ok(o.reading);
    expect(r).toMatch(/^A 0\.01-unit rise in x goes with a fall of about 0\.0133 in the probability that y = 1/);
    expect(r).not.toMatch(/1\.3310 in the probability/);
    expect(o.text).toContain("Per 0.01 of x: the average marginal effect −1.3310 × 0.01 = −0.0133 in P(y = 1).");
  });
  test("the step: per unit while it prints below 1, else the largest power of ten that brings it under 0.1", () => {
    expect(ameScale(0.05)).toEqual({ step: 1, stepText: "1", scaledText: "0.0500" });
    expect(ameScale(0.36).stepText).toBe("1"); // round 2 MAJOR 4: rescaled only when the change prints at 1 or more
    expect(ameScale(-339294).scaledText).toMatch(/^0\.0\d{3}$/);
    expect(ameScale(487).stepText).toBe("0.0001");
  });
});

describe("R5 BLOCKER 2: iv-2sls reads the overidentification test", () => {
  test("iv-overid: Sargan/Basmann/Wooldridge reject, and the reading says the instruments are suspect", () => {
    const r = ok(iv2slsWithReading(rd(IV_2SLS_DEFAULTS, FX["iv-overid"].fields)).reading);
    expect(r).toMatch(/The overidentification test rejects the instruments \(Wooldridge score test p\s<\s0\.001\): at least one looks invalid, so the estimate is suspect\./);
    expect(r).not.toMatch(/pass the usual strength check/);
  });
  test("the default (exactly identified) still passes, and weak instruments still say weak", () => {
    expect(ok(iv2slsWithReading(rd(IV_2SLS_DEFAULTS)).reading)).toMatch(/The instruments pass the usual strength check/);
    expect(ok(iv2slsWithReading(rd(IV_2SLS_DEFAULTS, FX["iv-weak"].fields)).reading)).toMatch(/below the rule-of-thumb 10/);
  });
});

describe("R5 BLOCKER 3: econ-ols without a constant never calls the uncentered R² 'variation explained'", () => {
  test("ols1-nocons", () => {
    const c = FX["ols1-nocons"];
    const r = ok(econOlsCalc(rd({ se: "classical", decimals: "3" }, c.fields)).reading);
    expect(r).toMatch(/has no constant, so its R² is the uncentered one/);
    expect(r).not.toMatch(/explain(s)? (most|a moderate share|little) of the variation/);
  });
});

describe("R5 BLOCKER 4 and MAJOR 3: logit odds ratios, associational and printed to 4 significant figures", () => {
  test("the default reading: 'goes with odds about … times as high'", () => {
    const o = econLogitCalc(rd({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT }));
    const r = ok(o.reading);
    expect(r).toMatch(/goes with odds about 14\.45 times as high/);
    expect(r).not.toMatch(/multiplies/);
  });
  test("a ratio that prints as 1.000 is not quoted; tiny ratios print in ×10ⁿ, never 0.0000", () => {
    expect(fmtOddsRatio(1.0000004)).toBe("1.000");
    expect(fmtOddsRatio(3.706e-6)).toBe("3.706×10⁻⁶");
    expect(fmtOddsRatio(0.004)).toBe("0.004000");
    expect(fmtOddsRatio(16.92)).toBe("16.92");
    expect(fmtOddsRatio(123456.7)).toBe("123,457");
    const rows = LOGIT_DEFAULT.split("\n").slice(1).map((l) => l.split(" ").map(Number));
    const base = fitLogit(rows.map((r) => r[0]), rows.map((r) => [r[1]]), ["x"], { constant: true, depName: "y" });
    const flat: FittedModel = { ...base, terms: base.terms.map((t) => (t.name === "x" ? { ...t, coef: 4e-7, ciLo: -1e-3, ciHi: 1e-3 } : t)), marginalEffects: [term("x", 0.03, 0.001)] };
    expect(ok(logitReading(flat))).not.toMatch(/odds about/);
  });
});

describe("R5 MAJOR 2: iv hc0 with small-sample t no longer claims linearmodels' debiased=True", () => {
  test("iv2-hc0-t", () => {
    const o = iv2slsCalc(rd(IV_2SLS_DEFAULTS, FX["iv2-hc0-t"].fields));
    expect(o.text).toContain("This is not linearmodels' debiased=True, which also multiplies a robust covariance by n/(n − k): choose HC1 for that.");
    expect(o.text).not.toMatch(/Small-sample mode \(linearmodels debiased=True\)/);
  });
});

describe("R5 MAJOR 6: econ-ols with one predictor", () => {
  test("no lowercase start and no 'others'", () => {
    const r = ok(econOlsCalc(rd({ data: LONGLEY_DEFAULT, spec: "TOTEMP ~ GNP", constant: "yes", se: "classical", decimals: "3" })).reading);
    expect(r).toMatch(/\(R² = 0\.967\)\. A one-unit rise in GNP goes with a change of about 0\.035 in TOTEMP/);
    expect(r).not.toMatch(/others|holding/i);
  });
  test("count words: 'Both are', 'One of the two is', 'All three are'", () => {
    const mk = (ps: number[]): OlsFit =>
      ({ r2: 0.5, model: { depName: "y", terms: [...ps.map((p, i) => term(`x${i + 1}`, 1, p)), term("Constant", 1, 0.5)] } }) as unknown as OlsFit;
    expect(ok(olsReading(mk([0.001, 0.002]), 3))).toMatch(/Both are statistically significant/);
    expect(ok(olsReading(mk([0.001, 0.4]), 3))).toMatch(/One of the two is statistically significant/);
    expect(ok(olsReading(mk([0.001, 0.002, 0.003]), 3))).toMatch(/All three are statistically significant/);
  });
});

describe("R5 MAJOR 9: the one p rule in the econometrics readings", () => {
  test("econ-ols, panel RE / DiD and qreg at a printed 0.050", () => {
    const fit = { r2: 0.5, model: { depName: "y", terms: [term("x", 2, 0.0501), term("Constant", 1, 0.5)] } } as unknown as OlsFit;
    expect(ok(olsReading(fit, 3))).toMatch(/is right at the conventional 5% threshold, so the evidence is borderline/);
    const m = { depName: "y", terms: [term("x", 2, 0.001)] } as unknown as FittedModel;
    expect(ok(panelReReading(m, { stat: 6, p: 0.0499, df: 1 }))).toMatch(/The Hausman test \(p = 0\.050\) is right at the conventional 5% threshold/);
    expect(ok(panelDidReading(term("treated × post", 1.2, 0.0504), "y", "policy", false))).toMatch(/p = 0\.050\), right at the conventional 5% threshold/);
    const run = { fits: [{ tau: 0.5, r1: 0.2, model: { terms: [term("x", 1, 0.0496), term("Constant", 1, 0.5)] } }], depName: "y" } as unknown as Parameters<typeof qregReading>[0];
    expect(ok(qregReading(run))).toMatch(/\(p = 0\.050\), an association right at the conventional 5% threshold/);
  });
});

describe("R5 MAJOR 10/11: row caps and one IV fit", () => {
  test("econ-ols, regtable and logit refuse past the cap by name", () => {
    const big = ["y\tx", ...Array.from({ length: ECON_MAX_ROWS + 1 }, (_, i) => `${i % 7}\t${i % 5}`)].join("\n");
    expect(econOlsCalc(rd({ data: big, spec: "y ~ x" })).text).toMatch(/^The table has 50,001 rows; OLS regression takes at most 50,000 here/);
    expect(econLogitCalc(rd({ data: big, spec: "y ~ x" })).text).toMatch(/^The table has 50,001 rows; the logit model takes at most 50,000 here/);
    const mid = ["y\tx", ...Array.from({ length: 20000 }, (_, i) => `${i % 7}\t${i % 5}`)].join("\n");
    const specs = Array.from({ length: 11 }, () => "y ~ x").join("\n");
    expect(20000 * 11).toBeGreaterThan(ECON_TABLE_MAX_ROW_MODELS);
    expect(econRegTableCalc(rd({ data: mid, specs })).text).toMatch(/^20,000 rows × 11 models is more than one table fits here/);
    expect(PANEL_PANE_MAX_ROWS).toBe(50000);
  });
  test("iv2slsWithReading gives the calculator's own output plus the reading", () => {
    const a = iv2slsWithReading(rd(IV_2SLS_DEFAULTS));
    const b = iv2slsCalc(rd(IV_2SLS_DEFAULTS));
    expect(a.text).toBe(b.text);
    expect(a.tables).toEqual(b.tables);
  });
});

describe("R5 minor: es-event window refusal names the range", () => {
  test("−99999999 is out of range, not 'not a whole number'", () => {
    expect(readIntField("−99999999", "Leads", 0, 30)).toEqual({ error: "Leads: “−99999999” is outside 0 to 30." });
    expect(readIntField("2.5", "Leads", 0, 30)).toEqual({ error: "Leads: “2.5” is not a whole number." });
  });
});

describe("R6 #8 / #13 / #14", () => {
  test("Solow at its exact steady state says so", () => {
    for (const tag of ["solow-k0-exact", "solow-at-ss"]) {
      const r = ok(macroSolowWithReading(rd(MACRO_SOLOW_DEFAULTS, FX[tag].fields)).reading);
      expect(r).toMatch(/capital per effective worker is already at a steady state of/);
      expect(r).not.toMatch(/(rises|falls) from .* toward/);
      expect(r).not.toMatch(/half of any remaining gap/);
    }
    expect(ok(macroSolowWithReading(rd(MACRO_SOLOW_DEFAULTS, FX["solow-1"].fields)).reading)).toMatch(/falls from 10\.0000 toward a steady state of 7\.4107/);
  });
  test("IS–LM with a vertical AS: output RETURNS to full employment; the old price level is named as the pre-policy long run", () => {
    const r = ok(macroIslmWithReading(rd(MACRO_ISLM_DEFAULTS, FX["islm-vert"].fields)).reading);
    expect(r).toMatch(/output returns to full employment \(800\); the price level rises from 2\.2222 \((long run, before the policy|pre-policy)\) to 3\.3333\./);
    expect(r).not.toMatch(/stays at full employment/);
  });
  test("Taylor over a long series groups the count", () => {
    const series = ["Period\tInflation\tGap", ...Array.from({ length: 10000 }, (_, i) => `${i + 1}\t2.5\t0.5`)].join("\n");
    const o = macroTaylorWithReading(rd(MACRO_TAYLOR_DEFAULTS, { series }));
    expect(ok(o.reading)).toMatch(/^As a benchmark over 10,000 periods/);
    expect(o.text).toContain("Taylor rule over 10,000 periods");
  });
});
