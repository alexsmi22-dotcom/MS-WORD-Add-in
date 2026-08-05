// Regression: the two most-used pharmacology fits shipped with no
// model-specific caveat at all (defect 0.21), and ε₂₈₀ had to be typed in by
// hand when the sequence already determines it (Tier 1.9).
//
// `assay.ts` states the contract on FitResult.caveats — "conditions that make
// these numbers untrustworthy. The UI must show them." Four of six LM fits
// honoured it. `fitDoseResponse` and `fitSaturationBinding` — the IC50/EC50 and
// Kd tools, the two most used in the mode — added nothing of their own, while
// `fitMichaelisMenten` catches the identical "plateau never reached, the
// parameter is an extrapolation" failure via `kineticsCaveats`.
//
// The failure is invisible by construction: it converges, R² comes back ≈ 0.998,
// and the standard error is larger than the estimate.

import {
  fitDoseResponse,
  fitSaturationBinding,
  fourPL,
  oneSiteBinding,
  extinctionCoefficient,
  proteinConcFromA280,
  EPSILON_280,
} from "../assay";

const modelSpecific = (caveats: string[], re: RegExp) => caveats.filter((c) => re.test(c));

describe("fitDoseResponse caveats — defect 0.21", () => {
  // A truncated inhibition curve: the true IC50 is 1000, every dose tested is
  // 100x below it, so the data is all upper shoulder.
  const conc = [0.1, 0.3, 1, 3, 10, 30];
  const response = conc.map((c) => fourPL(0, 100, 1000, 1, c));

  test("REPRODUCTION: an EC50 above the highest dose is called out", () => {
    const fit = fitDoseResponse(conc, response);
    expect(fit.ec50).toBeGreaterThan(Math.max(...conc));
    const hit = modelSpecific(fit.caveats, /ABOVE the highest concentration tested/);
    expect(hit.length).toBe(1);
    expect(hit[0]).toMatch(/extrapolation past the end of your data/);
  });

  test("the caveat fires DESPITE an excellent R²", () => {
    // This is the whole point: R² does not carry the signal, so it cannot be the
    // gate. A user reading "R² = 0.999, great fit" gets an extrapolated IC50.
    const fit = fitDoseResponse(conc, response);
    expect(fit.rsquared).toBeGreaterThan(0.99);
    expect(fit.caveats.length).toBeGreaterThan(0);
  });

  test("design caveats come FIRST, as in fitMichaelisMenten", () => {
    const fit = fitDoseResponse(conc, response);
    expect(fit.caveats[0]).toMatch(/concentration tested|not a positive concentration|tested range spans/);
  });

  test("an EC50 below the lowest dose is called out too", () => {
    const c = [100, 300, 1000, 3000, 10000, 30000];
    const y = c.map((x) => fourPL(0, 100, 1, 1, x));
    const fit = fitDoseResponse(c, y);
    expect(modelSpecific(fit.caveats, /BELOW the lowest concentration tested/).length).toBe(1);
  });

  test("a well-designed curve gets no range complaint, but still gets the model note", () => {
    const c = [0.01, 0.1, 1, 10, 100, 1000, 10000];
    const y = c.map((x) => fourPL(0, 100, 10, 1, x));
    const fit = fitDoseResponse(c, y);
    expect(modelSpecific(fit.caveats, /ABOVE the highest|BELOW the lowest|tested range spans/).length).toBe(0);
    expect(modelSpecific(fit.caveats, /IC50|EC50/).length).toBeGreaterThan(0);
    expect(modelSpecific(fit.caveats, /must be LINEAR here, not log-transformed/).length).toBe(1);
  });

  test("orientation is named, so the number is not read as the wrong statistic", () => {
    const c = [0.01, 0.1, 1, 10, 100, 1000, 10000];
    const rising = fitDoseResponse(c, c.map((x) => fourPL(0, 100, 10, 1, x)));
    const falling = fitDoseResponse(c, c.map((x) => fourPL(100, 0, 10, 1, x)));
    expect(modelSpecific(rising.caveats, /INCREASING curve/).length).toBe(1);
    expect(modelSpecific(falling.caveats, /DECREASING curve/).length).toBe(1);
  });

  test("the generic LM caveats are still there", () => {
    const fit = fitDoseResponse(conc, response);
    expect(modelSpecific(fit.caveats, /R² is a poor guide for a nonlinear fit/).length).toBe(1);
    expect(modelSpecific(fit.caveats, /LOCAL optimiser/).length).toBe(1);
  });
});

describe("fitSaturationBinding caveats — defect 0.21", () => {
  // Every ligand concentration far below Kd: the curve never bends, so Bmax is
  // pure extrapolation and only Bmax/Kd is determined.
  const ligand = [0.1, 0.2, 0.5, 1, 2, 5];
  const bound = ligand.map((l) => oneSiteBinding(100, 500, l));

  test("REPRODUCTION: a Kd above the tested ligand range is called out", () => {
    const fit = fitSaturationBinding(ligand, bound);
    expect(modelSpecific(fit.caveats, /LIGAND RANGE TOO LOW/).length).toBe(1);
    expect(modelSpecific(fit.caveats, /Bmax and Kd are NOT\s+separately determined/).length).toBe(1);
  });

  test("the Bmax standard error is reported as a fraction of itself", () => {
    // Noiseless data fits perfectly, so the SE is ~0 even on a hopeless design —
    // the standard error only becomes a signal once there is real scatter. A few
    // percent of deterministic wobble on the same truncated range is what a real
    // plate gives you.
    const wobble = [1.03, 0.97, 1.04, 0.96, 1.05, 0.95];
    const noisy = ligand.map((l, i) => oneSiteBinding(100, 500, l) * wobble[i]);
    const fit = fitSaturationBinding(ligand, noisy);
    expect(Math.abs(fit.bmaxSE / fit.bmax)).toBeGreaterThan(0.2);
    expect(fit.rsquared).toBeGreaterThan(0.9); // and R² still looks fine
    expect(modelSpecific(fit.caveats, /Bmax has a standard error of/).length).toBe(1);
  });

  test("a marginal range is distinguished from a hopeless one", () => {
    const l = [1, 2, 5, 10, 20, 25];
    const fit = fitSaturationBinding(l, l.map((x) => oneSiteBinding(100, 12, x)));
    expect(modelSpecific(fit.caveats, /LIGAND RANGE TOO LOW/).length).toBe(0);
    expect(modelSpecific(fit.caveats, /marginal/).length).toBe(1);
  });

  test("a good design still gets the one-site/specific-binding caveat", () => {
    const l = [1, 2, 5, 10, 20, 50, 100];
    const fit = fitSaturationBinding(l, l.map((x) => oneSiteBinding(100, 10, x)));
    expect(modelSpecific(fit.caveats, /LIGAND RANGE TOO LOW|marginal/).length).toBe(0);
    expect(modelSpecific(fit.caveats, /ONE-SITE model on SPECIFIC binding/).length).toBe(1);
    expect(modelSpecific(fit.caveats, /non-specific/).length).toBe(1);
  });

  test("the generic LM caveats survive the override", () => {
    const fit = fitSaturationBinding(ligand, bound);
    expect(modelSpecific(fit.caveats, /Least squares always returns an answer/).length).toBe(1);
  });
});

describe("extinctionCoefficient — Tier 1.9", () => {
  test("Gill & von Hippel: 5500·W + 1490·Y + 125·cystine", () => {
    expect(EPSILON_280).toEqual({ tryptophan: 5500, tyrosine: 1490, cystine: 125 });
    const e = extinctionCoefficient("WWYYCC");
    expect(e.counts).toEqual({ W: 2, Y: 2, C: 2, cystinePairs: 1 });
    expect(e.reduced).toBe(2 * 5500 + 2 * 1490);
    expect(e.cystines).toBe(2 * 5500 + 2 * 1490 + 125);
  });

  test("cross-check on hen lysozyme: 37 970 computed against ~38 940 measured", () => {
    // P00698 mature chain: 6 Trp, 3 Tyr, 8 Cys (4 disulfides).
    // 6*5500 + 3*1490 + 4*125 = 33000 + 4470 + 500 = 37970, which is what Expasy
    // ProtParam gives for the same chain. The EXPERIMENTAL value is ~38 940 — a
    // 2.5% gap, inside Gill & von Hippel's own ±5% and exactly the reason the
    // caveats say this is calibrated on denatured protein.
    const LYSOZYME =
      "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL";
    const e = extinctionCoefficient(LYSOZYME);
    expect(e.counts.W).toBe(6);
    expect(e.counts.Y).toBe(3);
    expect(e.counts.C).toBe(8);
    expect(e.cystines).toBe(6 * 5500 + 3 * 1490 + 4 * 125);
    expect(Math.abs(e.cystines - 38940) / 38940).toBeLessThan(0.05);
    expect(e.caveats.some((c) => /DENATURED protein/.test(c))).toBe(true);
  });

  test("the cysteine assumption is STATED, not silently chosen", () => {
    const e = extinctionCoefficient("WWYYCC");
    expect(e.reduced).not.toBe(e.cystines);
    expect(e.caveats.some((c) => /CYSTEINE STATE changes the answer/.test(c))).toBe(true);
  });

  test("a protein with no Trp and no Tyr refuses to pretend A280 can measure it", () => {
    const e = extinctionCoefficient("AAAAGGGGKKKK");
    expect(e.reduced).toBe(0);
    expect(e.caveats.some((c) => /NO TRYPTOPHAN AND NO TYROSINE/.test(c))).toBe(true);
  });

  test("it feeds proteinConcFromA280 directly", () => {
    const e = extinctionCoefficient("WWYYCC");
    expect(proteinConcFromA280(1, e.reduced)).toBeCloseTo(1 / 13980, 12);
  });

  test("an ambiguity code is reported as a HOLE in ε", () => {
    const e = extinctionCoefficient("WWXXYY");
    expect(e.skipped).toEqual(["X"]);
    expect(e.caveats.some((c) => /Ignored X/.test(c) && /too low by 5 500/.test(c))).toBe(true);
  });

  test("Sec and Pyl are not reported as a hole — they genuinely do not absorb", () => {
    const e = extinctionCoefficient("WWUOYY");
    expect(e.reduced).toBe(2 * 5500 + 2 * 1490);
    expect(e.caveats.some((c) => /Trp or a Tyr/.test(c))).toBe(false);
    expect(e.caveats.some((c) => /correct, not an omission/.test(c))).toBe(true);
  });

  test("the 1 mg/mL absorbance is given for both assumptions or not at all", () => {
    expect(extinctionCoefficient("WWYYCC").a280_1mgPerMl).toBeNull();
    const withMw = extinctionCoefficient("WWYYCC", 1000);
    expect(withMw.a280_1mgPerMl!.reduced).toBeCloseTo(13.98, 6);
    expect(withMw.a280_1mgPerMl!.cystines).toBeCloseTo(14.105, 6);
  });
});
