// Tier 1 release B: capability that was written and unreachable, plus the one
// composition that was a correctness hazard.

import * as fs from "fs";
import * as path from "path";
import { fitSubstrateInhibition, substrateInhibitionV, fitMichaelisMenten } from "../assay";
import {
  straightLineDepreciation,
  annuityPV,
  annuityFV,
  perpetuity,
  growingPerpetuity,
  continuousCompound,
  nominalAnnualRate,
  effectiveAnnualRate,
  cagr,
} from "../finance";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");

describe("substrate inhibition: the model that had no fitter", () => {
  const vmax = 100;
  const km = 5;
  const ksi = 50;
  const s = [0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120];
  const v = s.map((x) => substrateInhibitionV(vmax, km, ksi, x));

  it("recovers the generating parameters", () => {
    const f = fitSubstrateInhibition(s, v);
    expect(f.converged).toBe(true);
    expect(f.vmax).toBeCloseTo(vmax, 4);
    expect(f.km).toBeCloseTo(km, 4);
    expect(f.ksi).toBeCloseTo(ksi, 3);
    expect(f.rsquared).toBeGreaterThan(0.9999);
  });

  it("reports the peak, which is what the bench actually needs", () => {
    const f = fitSubstrateInhibition(s, v);
    // s_opt = sqrt(Km * Ksi), derived exactly rather than read off the data.
    expect(f.sOptimal).toBeCloseTo(Math.sqrt(km * ksi), 4);
    expect(f.vPeak).toBeCloseTo(substrateInhibitionV(vmax, km, ksi, Math.sqrt(km * ksi)), 4);
    // The asymptote is well above anything attainable — the point of the caveat.
    expect(f.vPeak).toBeLessThan(f.vmax * 0.8);
  });

  it("MICHAELIS-MENTEN ON THE SAME DATA IS CONFIDENTLY WRONG — the reason this exists", () => {
    const mm = fitMichaelisMenten(s, v);
    expect(mm.converged).toBe(true); // it does not fail...
    expect(mm.vmax).toBeLessThan(vmax * 0.7); // ...it depresses Vmax (≈51.6 vs 100)
    expect(mm.km).toBeLessThan(km * 0.5); // ...and distorts Km (≈1.2 vs 5)
    // And the substrate-inhibition fit is dramatically better on the same points.
    expect(fitSubstrateInhibition(s, v).rsquared).toBeGreaterThan(mm.rsquared + 0.3);
  });

  it("warns when the curve never turns over — inhibition cannot be established", () => {
    const rising = [1, 2, 5, 10, 20, 40];
    const risingV = rising.map((x) => (100 * x) / (5 + x)); // plain MM, no descent
    const f = fitSubstrateInhibition(rising, risingV);
    expect(f.caveats.join(" ")).toMatch(/no descending limb|not actually show inhibition|did not converge/i);
  });

  it("always says Vmax is an asymptote the enzyme never reaches", () => {
    expect(fitSubstrateInhibition(s, v).caveats.join(" ")).toMatch(/never reaches/);
  });

  it("is reachable from the pane", () => {
    expect(pane).toMatch(/id: "substrate-inhibition"/);
    expect(pane).toMatch(/fitSubstrateInhibition\(/);
  });
});

describe("the fatigue notch factor is applied, not delegated to the user", () => {
  it("the hazardous label is gone and a Kf field exists", () => {
    expect(pane).not.toMatch(/already multiplied by Kf/);
    expect(pane).toMatch(/key: "kf", label: "Fatigue notch factor Kf/);
  });

  it("Kf multiplies the alternating stress inside the tool", () => {
    const start = pane.indexOf('id: "fatigue-safety"');
    const body = pane.slice(start, start + 4000);
    expect(body).toMatch(/const saEffective = saNominal \* kf/);
    expect(body).toMatch(/meanStressAnalysis\(\s*saEffective/);
  });

  it("an out-of-range Kf is refused rather than silently used", () => {
    const start = pane.indexOf('id: "fatigue-safety"');
    const body = pane.slice(start, start + 4000);
    expect(body).toMatch(/kf < 1 \|\| kf > 10/);
  });

  it("the report states that Kfm on the mean stress is NOT applied", () => {
    const start = pane.indexOf('id: "fatigue-safety"');
    const body = pane.slice(start, start + 5000);
    expect(body).toMatch(/Kfm/);
  });
});

describe("finance: the functions that shipped with no way to call them", () => {
  it("straight-line depreciation is the plain definition", () => {
    expect(straightLineDepreciation(10000, 1000, 5)).toBeCloseTo(1800, 9);
  });

  it("an annuity's PV and FV are consistent with each other", () => {
    const pmt = 1000;
    const r = 0.05;
    const n = 20;
    // FV = PV compounded forward over the same n periods.
    expect(annuityFV(pmt, r, n)).toBeCloseTo(annuityPV(pmt, r, n) * Math.pow(1 + r, n), 6);
  });

  it("a level perpetuity is the zero-growth case of the growing one", () => {
    expect(growingPerpetuity(1000, 0.08, 0)).toBeCloseTo(perpetuity(1000, 0.08), 9);
    expect(perpetuity(1000, 0.08)).toBeCloseTo(12500, 9);
  });

  it("nominal and effective round-trip", () => {
    const eff = effectiveAnnualRate(0.06, 12);
    expect(nominalAnnualRate(eff, 12)).toBeCloseTo(0.06, 12);
  });

  it("continuous compounding is the ceiling discrete compounding approaches", () => {
    const p = 10000;
    const r = 0.06;
    const y = 10;
    const cont = continuousCompound(p, r, y);
    let prev = 0;
    for (const m of [1, 4, 12, 365, 100000]) {
      const disc = p * Math.pow(1 + r / m, m * y);
      expect(disc).toBeLessThanOrEqual(cont + 1e-6);
      expect(disc).toBeGreaterThan(prev); // monotone toward the ceiling
      prev = disc;
    }
    expect(prev).toBeCloseTo(cont, 1);
  });

  it("CAGR connects the endpoints exactly", () => {
    const g = cagr(10000, 18000, 5);
    expect(10000 * Math.pow(1 + g, 5)).toBeCloseTo(18000, 6);
  });

  it("all five new finance calculators are in the registry", () => {
    for (const id of ["depr-sl", "annuity", "perpetuity", "rate-forms", "cagr"]) {
      expect(pane).toMatch(new RegExp(`id: "${id}"`));
    }
  });

  it("the growing perpetuity refuses g >= r rather than returning a negative value", () => {
    const start = pane.indexOf('id: "perpetuity"');
    const body = pane.slice(start, start + 2000);
    expect(body).toMatch(/g >= rate/);
    expect(body).toMatch(/does not converge/);
  });
});
