// Oracle tests for the v2.62.0 energy-depth engines: wind shear, Weibull,
// flue gas, storage/LCOS, solar geometry. Expected values are hand-computed
// or standard textbook figures, never read back from the implementation.

import {
  windShear,
  weibullWind,
  flueGas,
  combustion,
  storageSizing,
  solarGeometry,
  RHO_AIR_SL,
} from "../energy";

const okOrFail = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("wind shear", () => {
  it("1/7 power law from 10 m to 80 m is a 1.346 speed ratio", () => {
    const r = okOrFail(windShear({ refSpeed: 6, refHeight: 10, targetHeight: 80, alpha: 1 / 7 }));
    expect(r.powerLawSpeed! / 6).toBeCloseTo(Math.pow(8, 1 / 7), 10);
    expect(r.powerLawSpeed!).toBeCloseTo(8.0754, 3);
    expect(r.powerRatio).toBeCloseTo(Math.pow(8, 3 / 7), 9);
  });

  it("log law over open grass (z0 = 0.03) lands close to the power law", () => {
    const r = okOrFail(
      windShear({ refSpeed: 6, refHeight: 10, targetHeight: 80, alpha: 1 / 7, roughnessM: 0.03 })
    );
    expect(r.logLawSpeed!).toBeCloseTo((6 * Math.log(80 / 0.03)) / Math.log(10 / 0.03), 9);
    expect(r.disagreement!).toBeLessThan(0.03); // the classic near-agreement case
  });

  it("identity: target height equal to reference returns the same speed", () => {
    const r = okOrFail(windShear({ refSpeed: 7.3, refHeight: 50, targetHeight: 50, alpha: 0.2, roughnessM: 0.1 }));
    expect(r.powerLawSpeed).toBeCloseTo(7.3, 12);
    expect(r.logLawSpeed).toBeCloseTo(7.3, 12);
  });

  it("refuses heights at or below the roughness length, and no model at all", () => {
    expect(windShear({ refSpeed: 6, refHeight: 10, targetHeight: 80 }).ok).toBe(false);
    expect(windShear({ refSpeed: 6, refHeight: 0.02, targetHeight: 80, roughnessM: 0.03 }).ok).toBe(false);
  });
});

describe("Weibull wind resource", () => {
  it("k = 2 is Rayleigh: mean = c·√π/2, and the scale round-trips", () => {
    const r = okOrFail(weibullWind({ shape: 2, scale: 8 }));
    expect(r.meanSpeed).toBeCloseTo(8 * (Math.sqrt(Math.PI) / 2), 9);
    const r2 = okOrFail(weibullWind({ shape: 2, meanSpeed: r.meanSpeed }));
    expect(r2.scale).toBeCloseTo(8, 9);
  });

  it("energy pattern factor at k = 2 is the known 1.91", () => {
    const r = okOrFail(weibullWind({ shape: 2, scale: 8 }));
    // Γ(2.5)/Γ(1.5)³ = (3√π/4)/(√π/2)³ = 6/π^... hand value ≈ 1.9099.
    expect(r.energyPatternFactor).toBeCloseTo(1.9099, 3);
  });

  it("mean power density matches the closed form ½ρc³Γ(1+3/k)", () => {
    const r = okOrFail(weibullWind({ shape: 2, scale: 8 }));
    // Γ(2.5) = 1.32934.
    expect(r.meanPowerDensity).toBeCloseTo(0.5 * RHO_AIR_SL * 512 * 1.32934, 1);
  });

  it("most probable speed at k = 2 is c/√2", () => {
    const r = okOrFail(weibullWind({ shape: 2, scale: 8 }));
    expect(r.mostProbableSpeed!).toBeCloseTo(8 / Math.SQRT2, 9);
  });

  it("capacity factor: degenerate turbine bands bound it correctly", () => {
    // Rated barely above cut-in: CF ≈ P(v in [rated, cutOut]) — the flat band.
    const r = okOrFail(
      weibullWind({ shape: 2, scale: 8, turbine: { cutIn: 3, rated: 3.001, cutOut: 25 } })
    );
    const F = (v: number): number => 1 - Math.exp(-Math.pow(v / 8, 2));
    expect(r.capacityFactor!).toBeCloseTo(F(25) - F(3.001), 3);
    // And CF can never exceed the availability fraction.
    const r2 = okOrFail(
      weibullWind({ shape: 2, scale: 8, turbine: { cutIn: 3, rated: 12, cutOut: 25 } })
    );
    expect(r2.capacityFactor!).toBeLessThan(r2.availabilityFraction!);
    expect(r2.capacityFactor!).toBeGreaterThan(0.2); // a c=8 site is a real site
  });

  it("refuses a shape that determines nothing and a double speed spec", () => {
    expect(weibullWind({ shape: 0.2, scale: 8 }).ok).toBe(false);
    expect(weibullWind({ shape: 2, scale: 8, meanSpeed: 7 }).ok).toBe(false);
    expect(weibullWind({ shape: 2 }).ok).toBe(false);
  });
});

describe("flue gas", () => {
  it("round trip: CH4 at 20% excess shows 3.84% dry O2, and inverts exactly", () => {
    // Forward, by hand: a=2, e=0.2 → dry: CO2 1, O2 0.4, N2 9.024 → 10.424
    // total → O2 = 3.837%.
    const r = okOrFail(flueGas({ formula: "CH4", o2DryPct: (0.4 / 10.424) * 100 }));
    expect(r.excessAir).toBeCloseTo(0.2, 9);
    expect(r.dryCO2Pct).toBeCloseTo((1 / 10.424) * 100, 6);
  });

  it("zero flue O2 is exactly stoichiometric, and dry CO2 hits the ultimate", () => {
    const r = okOrFail(flueGas({ formula: "C3H8", o2DryPct: 0 }));
    expect(r.excessAir).toBeCloseTo(0, 12);
    expect(r.dryCO2Pct).toBeCloseTo(r.ultimateCO2Pct, 9);
    expect(r.afrActual).toBeCloseTo(okOrFail(combustion({ formula: "C3H8" })).afrStoich, 9);
  });

  it("ultimate CO2 for methane is the known ~11.7% (dry, 3.76 convention)", () => {
    const r = okOrFail(flueGas({ formula: "CH4", o2DryPct: 3 }));
    // Stoich dry: CO2 1, N2 7.52 → 1/8.52 = 11.74%.
    expect(r.ultimateCO2Pct).toBeCloseTo(11.74, 1);
  });

  it("dry percentages always sum to 100", () => {
    for (const [f, o2] of [["CH4", 4], ["C8H18", 6], ["CH3SH", 2], ["C6H5NO2", 5]] as const) {
      const r = okOrFail(flueGas({ formula: f, o2DryPct: o2 }));
      const sum = r.dryCO2Pct + r.dryO2Pct + r.dryN2Pct + (r.drySO2Pct ?? 0);
      expect(sum).toBeCloseTo(100, 9);
    }
  });

  it("refuses a reading at or above air, and inherits the fuel checks", () => {
    expect(flueGas({ formula: "CH4", o2DryPct: 21.1 }).ok).toBe(false);
    expect(flueGas({ formula: "CO2", o2DryPct: 3 }).ok).toBe(false);
  });
});

describe("storage sizing + LCOS", () => {
  it("the loss chain compounds upstream, hand-checked", () => {
    // 10 kWh/day, 2 days, DoD 0.8, rt 0.9 (discharge √0.9), inverter 0.95.
    const r = okOrFail(
      storageSizing({ dailyLoadKWh: 10, autonomyDays: 2, depthOfDischarge: 0.8, roundTripEff: 0.9, inverterEff: 0.95 })
    );
    const usable = (10 * 2) / (0.95 * Math.sqrt(0.9));
    expect(r.bankKWh).toBeCloseTo(usable / 0.8, 9);
    expect(r.usableKWh).toBeCloseTo(usable, 9);
    expect(r.dailyChargeKWh).toBeCloseTo(10 / (0.95 * 0.9), 9);
  });

  it("Ah at the bus voltage", () => {
    const r = okOrFail(
      storageSizing({ dailyLoadKWh: 4.8, autonomyDays: 1, depthOfDischarge: 1, roundTripEff: 1, busVoltage: 48 })
    );
    expect(r.bankAh).toBeCloseTo(100, 9);
  });

  it("LCOS at zero discount reduces to costs over lifetime throughput", () => {
    const r = okOrFail(
      storageSizing({
        dailyLoadKWh: 10, autonomyDays: 1, depthOfDischarge: 0.9, roundTripEff: 0.81,
        economics: { capex: 10000, annualOpex: 100, cyclesPerYear: 300, lifetimeYears: 10, discountRate: 0 },
      })
    );
    const dischargedPerCycle = r.bankKWh * 0.9 * Math.sqrt(0.81);
    expect(r.lcosPerKWh!).toBeCloseTo((10000 + 1000) / (300 * 10 * dischargedPerCycle), 9);
  });

  it("degradation raises LCOS", () => {
    const base = { dailyLoadKWh: 10, autonomyDays: 1, depthOfDischarge: 0.9, roundTripEff: 0.85 };
    const ec = { capex: 10000, annualOpex: 0, cyclesPerYear: 300, lifetimeYears: 10, discountRate: 0.05 };
    const a = okOrFail(storageSizing({ ...base, economics: { ...ec } }));
    const b = okOrFail(storageSizing({ ...base, economics: { ...ec, degradationRate: 0.03 } }));
    expect(b.lcosPerKWh!).toBeGreaterThan(a.lcosPerKWh!);
  });
});

describe("solar geometry", () => {
  it("June solstice at 40°N: declination 23.45, day 14.9 h, noon sun 73.4°", () => {
    const r = okOrFail(solarGeometry({ latitudeDeg: 40, dayOfYear: 172 }));
    expect(r.declinationDeg).toBeCloseTo(23.45, 1);
    expect(r.dayLengthHours).toBeCloseTo(14.85, 1);
    expect(r.noonElevationDeg).toBeCloseTo(90 - (40 - r.declinationDeg), 6);
  });

  it("equinox: 12-hour day at EVERY latitude, and H0 ≈ 10.4 kWh/m² at the equator", () => {
    // Day 81 gives declination ≈ 0 by Cooper's equation.
    for (const lat of [-60, -30, 0, 30, 60]) {
      const r = okOrFail(solarGeometry({ latitudeDeg: lat, dayOfYear: 81 }));
      expect(Math.abs(r.dayLengthHours - 12)).toBeLessThan(0.1);
    }
    const eq = okOrFail(solarGeometry({ latitudeDeg: 0, dayOfYear: 81 }));
    expect(eq.extraterrestrialKWhM2).toBeCloseTo(10.4, 0);
  });

  it("polar night and polar day are answers, not errors", () => {
    const night = okOrFail(solarGeometry({ latitudeDeg: 78, dayOfYear: 355 }));
    expect(night.dayLengthHours).toBe(0);
    expect(night.extraterrestrialKWhM2).toBe(0);
    const day = okOrFail(solarGeometry({ latitudeDeg: 78, dayOfYear: 172 }));
    expect(day.dayLengthHours).toBe(24);
    expect(day.extraterrestrialKWhM2).toBeGreaterThan(0);
  });

  it("hourly elevation at solar noon equals the noon elevation", () => {
    const r = okOrFail(solarGeometry({ latitudeDeg: 35, dayOfYear: 100, solarHour: 12 }));
    expect(r.hourElevationDeg!).toBeCloseTo(r.noonElevationDeg, 6);
    // Northern-hemisphere noon sun is due south.
    expect(r.hourAzimuthDeg!).toBeCloseTo(180, 4);
  });

  it("morning sun is in the east", () => {
    const r = okOrFail(solarGeometry({ latitudeDeg: 40, dayOfYear: 172, solarHour: 8 }));
    expect(r.hourAzimuthDeg!).toBeGreaterThan(45);
    expect(r.hourAzimuthDeg!).toBeLessThan(135);
  });
});
