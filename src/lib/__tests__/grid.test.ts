// Oracle tests for grid.ts — every expected value hand-computed from the
// definition or a standard worked example.

import {
  threePhase,
  pfCorrection,
  voltageDrop,
  awgDiameterMm,
  RHO_COPPER_20C,
  RHO_ALUMINIUM_20C,
} from "../grid";

const okOrFail = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("three-phase power", () => {
  it("400 V, 100 A, pf 0.8 — the classic worked example", () => {
    const r = okOrFail(threePhase({ lineVoltage: 400, lineCurrentA: 100, powerFactor: 0.8 }));
    // S = √3·400·100 = 69.282 kVA; P = 55.426 kW; Q = 41.569 kVAR.
    expect(r.apparentPowerVA / 1000).toBeCloseTo(69.282, 3);
    expect(r.realPowerW / 1000).toBeCloseTo(55.426, 3);
    expect(r.reactivePowerVAR / 1000).toBeCloseTo(41.569, 3);
    expect(r.phaseVoltageWye).toBeCloseTo(230.94, 2);
    expect(r.phaseCurrentDelta).toBeCloseTo(57.735, 3);
  });

  it("power triangle closes: P² + Q² = S² exactly", () => {
    const r = okOrFail(threePhase({ lineVoltage: 480, lineCurrentA: 250, powerFactor: 0.87 }));
    const s2 = r.realPowerW ** 2 + r.reactivePowerVAR ** 2;
    expect(Math.sqrt(s2)).toBeCloseTo(r.apparentPowerVA, 6);
  });

  it("the inverse direction recovers the current", () => {
    const fwd = okOrFail(threePhase({ lineVoltage: 400, lineCurrentA: 100, powerFactor: 0.8 }));
    const inv = okOrFail(threePhase({ lineVoltage: 400, realPowerW: fwd.realPowerW, powerFactor: 0.8 }));
    expect(inv.lineCurrentA).toBeCloseTo(100, 9);
  });

  it("refuses pf outside (0,1] and a doubly specified load", () => {
    expect(threePhase({ lineVoltage: 400, lineCurrentA: 10, powerFactor: 80 }).ok).toBe(false);
    expect(threePhase({ lineVoltage: 400, lineCurrentA: 10, realPowerW: 5000, powerFactor: 0.8 }).ok).toBe(false);
  });
});

describe("power factor correction", () => {
  it("100 kW from 0.7 to 0.95 needs 69.2 kVAR — the textbook example", () => {
    const r = okOrFail(pfCorrection({ realPowerW: 100e3, pfBefore: 0.7, pfAfter: 0.95 }));
    // tan(acos 0.7) = 1.0202, tan(acos 0.95) = 0.3287 → Qc = 69.15 kVAR.
    expect(r.bankVAR / 1000).toBeCloseTo(100 * (Math.tan(Math.acos(0.7)) - Math.tan(Math.acos(0.95))), 6);
    expect(Math.abs(r.bankVAR / 1000 - 69.15)).toBeLessThan(0.05);
    expect(r.currentReduction).toBeCloseTo(1 - 0.7 / 0.95, 10);
    expect(r.lossReduction).toBeCloseTo(1 - (0.7 / 0.95) ** 2, 10);
  });

  it("correcting to unity leaves zero reactive power", () => {
    const r = okOrFail(pfCorrection({ realPowerW: 50e3, pfBefore: 0.8, pfAfter: 1 }));
    expect(r.bankVAR / 1000).toBeCloseTo(50 * Math.tan(Math.acos(0.8)), 6);
    // Q after = Q before − bank = 0 at unity.
    expect(50e3 * Math.tan(Math.acos(0.8)) - r.bankVAR).toBeCloseTo(0, 6);
  });

  it("delta bank needs one third the capacitance of wye", () => {
    const r = okOrFail(
      pfCorrection({ realPowerW: 100e3, pfBefore: 0.7, pfAfter: 0.95, lineVoltage: 400, frequencyHz: 50 })
    );
    expect(r.capacitanceWyeF! / r.capacitanceDeltaF!).toBeCloseTo(3, 10);
    // Sanity: delta per phase C = Qc/3 / (ω V²) ≈ 459 µF at 400 V 50 Hz.
    expect(r.capacitanceDeltaF! * 1e6).toBeCloseTo(r.bankVAR / 3 / (2 * Math.PI * 50 * 400 * 400) * 1e6, 6);
  });

  it("refuses a target at or below the present pf", () => {
    expect(pfCorrection({ realPowerW: 1e4, pfBefore: 0.9, pfAfter: 0.9 }).ok).toBe(false);
    expect(pfCorrection({ realPowerW: 1e4, pfBefore: 0.9, pfAfter: 0.8 }).ok).toBe(false);
  });
});

describe("voltage drop", () => {
  it("AWG geometry is the exact 92^(1/39) progression", () => {
    // Anchors of the definition: #36 = 0.005 in = 0.127 mm; 4/0 (=-3) = 0.46 in.
    expect(awgDiameterMm(36)).toBeCloseTo(0.127, 10);
    expect(awgDiameterMm(-3)!).toBeCloseTo(0.46 * 25.4, 6);
    // #12 is the canonical 2.053 mm / 3.31 mm².
    expect(awgDiameterMm(12)!).toBeCloseTo(2.053, 3);
  });

  it("DC drop on 20 m of 2.5 mm² copper at 16 A", () => {
    const r = okOrFail(
      voltageDrop({ material: "copper", kind: "dc", lengthM: 20, currentA: 16, sectionMm2: 2.5, supplyVoltage: 230 })
    );
    // R = 1.7241e-8/2.5e-6 = 6.8964 mΩ/m; drop = 2·20·16·R = 4.414 V.
    expect(r.dropV).toBeCloseTo(2 * 20 * 16 * (RHO_COPPER_20C / 2.5e-6), 9);
    expect(r.dropV).toBeCloseTo(4.414, 3);
    expect(r.dropFraction).toBeCloseTo(4.414 / 230, 3);
    // Loss = I × drop for a series resistance.
    expect(r.lossW).toBeCloseTo(r.dropV * 16, 9);
  });

  it("three-phase drop is √3/2 of the single-phase drop, same conductor", () => {
    const single = okOrFail(voltageDrop({ material: "copper", kind: "single-phase", lengthM: 50, currentA: 30, sectionMm2: 6 }));
    const three = okOrFail(voltageDrop({ material: "copper", kind: "three-phase", lengthM: 50, currentA: 30, sectionMm2: 6 }));
    expect(three.dropV / single.dropV).toBeCloseTo(Math.sqrt(3) / 2, 10);
  });

  it("aluminium is copper at 61% conductivity, derived not typed", () => {
    expect(RHO_ALUMINIUM_20C * 0.61).toBeCloseTo(RHO_COPPER_20C, 15);
  });

  it("minimum section scales exactly inversely with the target", () => {
    const r = okOrFail(
      voltageDrop({ material: "copper", kind: "dc", lengthM: 20, currentA: 16, sectionMm2: 2.5, supplyVoltage: 230, maxDropFraction: 0.03 })
    );
    // Re-run at the recommended section: the drop must equal the target.
    const check = okOrFail(
      voltageDrop({ material: "copper", kind: "dc", lengthM: 20, currentA: 16, sectionMm2: r.minSectionMm2!, supplyVoltage: 230 })
    );
    expect(check.dropFraction).toBeCloseTo(0.03, 9);
  });

  it("refuses an impossible run and a doubly specified section", () => {
    expect(voltageDrop({ material: "copper", kind: "dc", lengthM: 5000, currentA: 100, sectionMm2: 1, supplyVoltage: 12 }).ok).toBe(false);
    expect(voltageDrop({ material: "copper", kind: "dc", lengthM: 10, currentA: 10, sectionMm2: 2.5, awg: 12 }).ok).toBe(false);
  });
});
