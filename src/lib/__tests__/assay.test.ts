import {
  linearRegression,
  levenbergMarquardt,
  michaelisMenten,
  fitMichaelisMenten,
  hillEquation,
  fitHill,
  kcat,
  catalyticEfficiency,
  lineweaverBurk,
  eadieHofstee,
  hanesWoolf,
  fourPL,
  fitDoseResponse,
  chengPrusoff,
  oneSiteBinding,
  fitSaturationBinding,
  hendersonHasselbalch,
  bufferRatioForPh,
  beerLambert,
  stockVolumeNeeded,
  serialDilution,
  nucleicAcidConc,
  proteinConcFromA280,
} from "../assay";

// Noise-free samples of a model over a set of x values — used to check that
// each fit recovers the parameters it was generated from.
function sample(xs: number[], f: (x: number) => number): number[] {
  return xs.map(f);
}

describe("linearRegression", () => {
  it("recovers a known line and reports R² = 1", () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((xi) => 3 * xi + 2);
    const lr = linearRegression(x, y);
    expect(lr.slope).toBeCloseTo(3, 9);
    expect(lr.intercept).toBeCloseTo(2, 9);
    expect(lr.rsquared).toBeCloseTo(1, 9);
  });
});

describe("levenbergMarquardt", () => {
  it("recovers parameters of a noise-free Michaelis-Menten curve", () => {
    const s = [0.5, 1, 2, 4, 8, 16, 32];
    const v = sample(s, (x) => michaelisMenten(2.5, 4, x));
    const fit = levenbergMarquardt(s, v, ([vmax, km], x) => michaelisMenten(vmax, km, x), [1, 1]);
    expect(fit.converged).toBe(true);
    expect(fit.params[0]).toBeCloseTo(2.5, 4); // Vmax
    expect(fit.params[1]).toBeCloseTo(4, 4); // Km
    expect(fit.rsquared).toBeCloseTo(1, 6);
    expect(fit.predict(4)).toBeCloseTo(1.25, 4); // v at [S] = Km is Vmax/2
  });
});

describe("enzyme kinetics", () => {
  const s = [1, 2, 5, 10, 20, 50];
  const trueVmax = 12;
  const trueKm = 8;
  const v = sample(s, (x) => michaelisMenten(trueVmax, trueKm, x));

  it("fitMichaelisMenten recovers Vmax and Km", () => {
    const fit = fitMichaelisMenten(s, v);
    expect(fit.vmax).toBeCloseTo(trueVmax, 3);
    expect(fit.km).toBeCloseTo(trueKm, 3);
    expect(fit.rsquared).toBeCloseTo(1, 6);
  });

  it("the three linearizations agree on noise-free data", () => {
    for (const lin of [lineweaverBurk(s, v), eadieHofstee(s, v), hanesWoolf(s, v)]) {
      expect(lin.vmax).toBeCloseTo(trueVmax, 3);
      expect(lin.km).toBeCloseTo(trueKm, 3);
    }
  });

  it("fitHill recovers a cooperative coefficient", () => {
    const sv = sample(s, (x) => hillEquation(10, 6, 2, x));
    const fit = fitHill(s, sv);
    expect(fit.vmax).toBeCloseTo(10, 2);
    expect(fit.k).toBeCloseTo(6, 2);
    expect(fit.hill).toBeCloseTo(2, 2);
  });

  it("fitMichaelisMenten is robust to measurement noise", () => {
    // Fixed deterministic ±noise so the test is reproducible (no RNG).
    const noise = [0.31, -0.42, 0.18, -0.27, 0.35, -0.15];
    const noisy = s.map((x, i) => michaelisMenten(trueVmax, trueKm, x) + noise[i]);
    const fit = fitMichaelisMenten(s, noisy);
    expect(fit.vmax).toBeCloseTo(trueVmax, 0); // within ~1 unit
    expect(fit.km).toBeCloseTo(trueKm, 0);
    expect(fit.rsquared).toBeGreaterThan(0.98);
    expect(fit.vmaxSE).toBeGreaterThan(0); // standard errors are reported
    expect(fit.kmSE).toBeGreaterThan(0);
  });

  it("kcat and catalytic efficiency", () => {
    expect(kcat(12, 0.001)).toBeCloseTo(12000, 6); // Vmax 12 µM/s, [E] 1 nM
    expect(catalyticEfficiency(12000, 8)).toBeCloseTo(1500, 6);
  });
});

describe("dose-response (4PL)", () => {
  const conc = [0.01, 0.1, 0.3, 1, 3, 10, 100];

  it("recovers EC50 for an agonist curve", () => {
    const resp = sample(conc, (x) => fourPL(0, 100, 2, 1, x));
    const fit = fitDoseResponse(conc, resp);
    expect(fit.ec50).toBeCloseTo(2, 3);
    expect(fit.top).toBeCloseTo(100, 2);
    expect(fit.bottom).toBeCloseTo(0, 2);
    expect(fit.rsquared).toBeCloseTo(1, 5);
  });

  it("recovers IC50 for an inhibition curve", () => {
    // Inhibition: response falls from 100 to 0 with a negative Hill slope.
    const resp = sample(conc, (x) => fourPL(100, 0, 5, 1, x));
    const fit = fitDoseResponse(conc, resp);
    expect(fit.ec50).toBeCloseTo(5, 2);
    expect(fit.rsquared).toBeCloseTo(1, 5);
  });

  it("Cheng-Prusoff converts IC50 to Ki", () => {
    // IC50 100 nM, [S] = Km → Ki = IC50 / 2.
    expect(chengPrusoff(100, 8, 8)).toBeCloseTo(50, 6);
    expect(chengPrusoff(100, 0, 8)).toBeCloseTo(100, 6);
  });
});

describe("saturation binding", () => {
  it("recovers Bmax and Kd", () => {
    const l = [1, 2, 5, 10, 25, 50, 100];
    const bound = sample(l, (x) => oneSiteBinding(500, 12, x));
    const fit = fitSaturationBinding(l, bound);
    expect(fit.bmax).toBeCloseTo(500, 2);
    expect(fit.kd).toBeCloseTo(12, 3);
  });
});

describe("lab calculators", () => {
  it("Henderson-Hasselbalch and the inverse ratio", () => {
    // Equal base/acid → pH = pKa.
    expect(hendersonHasselbalch(4.76, 0.1, 0.1)).toBeCloseTo(4.76, 6);
    // 10:1 base:acid raises pH by exactly 1.
    expect(hendersonHasselbalch(4.76, 1, 0.1)).toBeCloseTo(5.76, 6);
    expect(bufferRatioForPh(4.76, 5.76)).toBeCloseTo(10, 6);
  });

  it("Beer-Lambert solves both directions", () => {
    expect(beerLambert({ epsilon: 10000, c: 1e-4, l: 1 })).toBeCloseTo(1, 9); // A
    expect(beerLambert({ a: 1, epsilon: 10000, l: 1 })).toBeCloseTo(1e-4, 12); // c
  });

  it("dilution and serial dilution", () => {
    // 1 M stock → 10 mL of 0.1 M needs 1 mL stock.
    expect(stockVolumeNeeded(1, 0.1, 10)).toBeCloseTo(1, 9);
    const series = serialDilution(100, 10, 4);
    expect(series.map((s) => s.concentration)).toEqual([100, 10, 1, 0.1]);
  });

  it("nucleic-acid and protein quantitation", () => {
    expect(nucleicAcidConc(1, "dsDNA")).toBeCloseTo(50, 6);
    expect(nucleicAcidConc(0.5, "RNA", 20)).toBeCloseTo(400, 6); // 0.5 × 40 × 20
    expect(proteinConcFromA280(1, 43824)).toBeCloseTo(1 / 43824, 12);
  });
});
