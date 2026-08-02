// Oracle tests for the energy suite: every expected value is hand-computed
// from the definition or is a published textbook figure, never read back from
// the implementation.

import {
  windPower,
  solarPV,
  fillFactor,
  hydroPower,
  batteryPack,
  combustion,
  lcoe,
  capacityFactor,
  formatFormula,
  BETZ_LIMIT,
  G_STANDARD,
} from "../energy";
import { npv } from "../finance";

const okOrFail = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("wind", () => {
  it("matches the hand calculation for a 100 m rotor at 10 m/s", () => {
    const r = okOrFail(windPower({ diameter: 100, windSpeed: 10 }));
    // A = pi/4 * 100^2 = 7853.98 m^2; P = 0.5 * 1.225 * A * 1000 = 4.8106 MW
    expect(r.sweptArea).toBeCloseTo(7853.98, 1);
    expect(r.windPower / 1e6).toBeCloseTo(4.8106, 3);
    expect(r.betzPower / r.windPower).toBeCloseTo(16 / 27, 12);
    expect(r.outputPower).toBeNull();
  });

  it("computes tip-speed ratio from rpm", () => {
    // 15 rpm on a 100 m rotor at 10 m/s: omega = 1.5708 rad/s, tip = 78.54 m/s.
    const r = okOrFail(windPower({ diameter: 100, windSpeed: 10, rpm: 15 }));
    expect(r.tipSpeedRatio).toBeCloseTo(7.854, 3);
  });

  it("annual energy follows P * 8760 * CF", () => {
    const r = okOrFail(windPower({ diameter: 100, windSpeed: 10, cp: 0.45, capacityFactor: 0.35 }));
    const expected = ((0.45 * 4.8106e6) / 1000) * 8760 * 0.35;
    expect(r.annualEnergyKWh! / expected).toBeCloseTo(1, 3);
  });

  it("accepts Cp exactly at the Betz limit and refuses just above", () => {
    expect(windPower({ diameter: 10, windSpeed: 5, cp: BETZ_LIMIT }).ok).toBe(true);
    const r = windPower({ diameter: 10, windSpeed: 5, cp: 0.594 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Betz");
  });

  it("cube law: doubling the wind speed gives 8x the power", () => {
    const p1 = okOrFail(windPower({ diameter: 50, windSpeed: 6 })).windPower;
    const p2 = okOrFail(windPower({ diameter: 50, windSpeed: 12 })).windPower;
    expect(p2 / p1).toBeCloseTo(8, 10);
  });
});

describe("solar PV", () => {
  it("STC self-consistency: 1000 W/m^2, 25 C ambient-free case", () => {
    const r = okOrFail(solarPV({ irradiance: 1000, area: 10, efficiency: 0.2 }));
    expect(r.powerStc).toBeCloseTo(2000, 6);
    expect(r.cellTempC).toBeNull();
  });

  it("NOCT derating matches the hand calculation", () => {
    // Tc = 25 + (45-20)/800*1000 = 56.25 C; P = 2000*(1 - 0.004*31.25) = 1750 W.
    const r = okOrFail(
      solarPV({ irradiance: 1000, area: 10, efficiency: 0.2, ambientC: 25, noctC: 45, tempCoeffPctPerC: -0.4 })
    );
    expect(r.cellTempC).toBeCloseTo(56.25, 6);
    expect(r.powerDerated).toBeCloseTo(1750, 3);
  });

  it("daily energy: PSH is defined against 1000 W/m^2", () => {
    // 2 kW array, 5 PSH, PR 0.8 -> 8 kWh/day regardless of the instantaneous G.
    const r = okOrFail(
      solarPV({ irradiance: 800, area: 10, efficiency: 0.2, peakSunHours: 5, performanceRatio: 0.8 })
    );
    expect(r.dailyEnergyKWh).toBeCloseTo(8, 6);
  });

  it("refuses a percentage typed as the fraction", () => {
    const r = solarPV({ irradiance: 1000, area: 10, efficiency: 21 });
    expect(r.ok).toBe(false);
  });
});

describe("fill factor", () => {
  it("FF from a realistic c-Si datasheet", () => {
    const r = okOrFail(fillFactor(40, 10, 33, 9.5));
    expect(r.pMax).toBeCloseTo(313.5, 6);
    expect(r.fillFactor).toBeCloseTo(313.5 / 400, 10);
  });

  it("refuses Vmp >= Voc and Imp >= Isc", () => {
    expect(fillFactor(33, 10, 40, 9.5).ok).toBe(false);
    expect(fillFactor(40, 9.5, 33, 10).ok).toBe(false);
  });
});

describe("hydro", () => {
  it("one m^3/s falling one metre at eta=1 is 9.80665 kW", () => {
    const r = okOrFail(hydroPower({ flow: 1, grossHead: 1, efficiency: 1 }));
    expect(r.outputPower).toBeCloseTo(9806.65, 2);
    expect(G_STANDARD).toBe(9.80665);
  });

  it("textbook small hydro: 2 m^3/s, 25 m, eta 0.85", () => {
    const r = okOrFail(hydroPower({ flow: 2, grossHead: 25, efficiency: 0.85 }));
    expect(r.outputPower / 1000).toBeCloseTo(416.8, 1);
  });

  it("head loss reduces net head, and a loss >= gross head is refused", () => {
    const r = okOrFail(hydroPower({ flow: 2, grossHead: 25, headLoss: 5, efficiency: 0.85 }));
    expect(r.netHead).toBe(20);
    expect(hydroPower({ flow: 2, grossHead: 25, headLoss: 25, efficiency: 0.85 }).ok).toBe(false);
  });
});

describe("battery pack", () => {
  it("13S4P of 3.6 V / 5 Ah cells", () => {
    const r = okOrFail(
      batteryPack({ cellVoltage: 3.6, cellCapacityAh: 5, series: 13, parallel: 4, depthOfDischarge: 0.9, loadCurrentA: 10 })
    );
    expect(r.packVoltage).toBeCloseTo(46.8, 10);
    expect(r.packCapacityAh).toBeCloseTo(20, 10);
    expect(r.packEnergyWh).toBeCloseTo(936, 10);
    expect(r.usableEnergyWh).toBeCloseTo(842.4, 10);
    expect(r.cRate).toBeCloseTo(0.5, 10);
    expect(r.runtimeHours).toBeCloseTo(1.8, 10);
    expect(r.runtimePeukertHours).toBeNull();
  });

  it("Peukert is exact at the rated point: discharging at C/H gives H hours", () => {
    // 20 Ah pack at the 20-hour rate current (1 A), k = 1.2, full DoD.
    const r = okOrFail(
      batteryPack({ cellVoltage: 2, cellCapacityAh: 20, series: 6, parallel: 1, loadCurrentA: 1, peukertExponent: 1.2, ratedHours: 20 })
    );
    expect(r.runtimePeukertHours).toBeCloseTo(20, 10);
    expect(r.runtimeHours).toBeCloseTo(20, 10);
  });

  it("Peukert above the rated rate delivers less than nameplate", () => {
    const r = okOrFail(
      batteryPack({ cellVoltage: 2, cellCapacityAh: 20, series: 6, parallel: 1, loadCurrentA: 10, peukertExponent: 1.2, ratedHours: 20 })
    );
    // t = 20*(20/200)^1.2 = 20*10^-1.2 = 1.2619 h < uncorrected 2 h.
    expect(r.runtimePeukertHours).toBeCloseTo(20 * Math.pow(0.1, 1.2), 8);
    expect(r.runtimePeukertHours!).toBeLessThan(r.runtimeHours!);
  });

  it("refuses fractional cell counts and a load given both ways", () => {
    expect(batteryPack({ cellVoltage: 3.6, cellCapacityAh: 5, series: 1.5, parallel: 1 }).ok).toBe(false);
    expect(
      batteryPack({ cellVoltage: 3.6, cellCapacityAh: 5, series: 1, parallel: 1, loadCurrentA: 1, loadPowerW: 10 }).ok
    ).toBe(false);
  });
});

describe("combustion", () => {
  it("methane: AFR ~17.1, CO2 2.74 kg/kg (textbook figures)", () => {
    const r = okOrFail(combustion({ formula: "CH4" }));
    expect(r.molarMass).toBeCloseTo(16.04, 2);
    expect(r.o2PerMolFuel).toBe(2);
    expect(r.afrStoich).toBeCloseTo(17.1, 0.5);
    expect(Math.abs(r.afrStoich - 17.12)).toBeLessThan(0.15);
    expect(r.co2PerKgFuel).toBeCloseTo(2.74, 1);
  });

  it("octane: AFR ~15.0 (the gasoline number everyone quotes)", () => {
    const r = okOrFail(combustion({ formula: "C8H18" }));
    expect(r.o2PerMolFuel).toBeCloseTo(12.5, 10);
    expect(Math.abs(r.afrStoich - 15.03)).toBeLessThan(0.15);
    expect(r.co2PerKgFuel).toBeCloseTo(3.08, 1);
  });

  it("ethanol (oxygenated fuel): AFR ~9.0", () => {
    const r = okOrFail(combustion({ formula: "C2H5OH" }));
    expect(r.o2PerMolFuel).toBeCloseTo(3, 10);
    expect(Math.abs(r.afrStoich - 8.95)).toBeLessThan(0.15);
  });

  it("methane LHV from HHV recovers the published 50.0 MJ/kg", () => {
    const r = okOrFail(combustion({ formula: "CH4", hhvMJPerKg: 55.5 }));
    expect(r.lhvMJPerKg).toBeCloseTo(50.0, 0);
    expect(Math.abs(r.lhvMJPerKg! - 50.0)).toBeLessThan(0.2);
  });

  it("excess air scales the AFR linearly and only the AFR", () => {
    const s = okOrFail(combustion({ formula: "C3H8" }));
    const e = okOrFail(combustion({ formula: "C3H8", excessAir: 0.2 }));
    expect(e.afrActual / s.afrStoich).toBeCloseTo(1.2, 10);
    expect(e.co2PerKgFuel).toBe(s.co2PerKgFuel);
  });

  it("mass balance: products + N2-side account for fuel + stoichiometric air", () => {
    // CO2 + H2O + SO2 out per kg fuel must equal 1 kg fuel + the O2 taken from
    // the air (the N2 passes through). Checked without reusing the AFR path.
    for (const f of ["CH4", "C8H18", "C2H5OH", "CH3SH"]) {
      const r = okOrFail(combustion({ formula: f }));
      const o2Mass = (r.o2PerMolFuel * 2 * 15.999) / r.molarMass;
      const products = r.co2PerKgFuel + r.h2oPerKgFuel + (r.so2PerKgFuel ?? 0);
      expect(products).toBeCloseTo(1 + o2Mass, 6);
    }
  });

  it("refuses non-fuels, metals, and oxygen-saturated formulas", () => {
    for (const f of ["CO2", "H2O", "N2", "Fe2O3", "NaCl", "", "xyz"]) {
      expect(combustion({ formula: f }).ok).toBe(false);
    }
  });

  it("a formula typed WITH subscripts round-trips to the same answer", () => {
    // The pane displays CH₄; pasting that display back in must not be refused.
    const ascii = okOrFail(combustion({ formula: "C8H18" }));
    const sub = okOrFail(combustion({ formula: "C₈H₁₈" }));
    expect(sub.afrStoich).toBe(ascii.afrStoich);
    expect(sub.molarMass).toBe(ascii.molarMass);
  });
});

describe("formula display", () => {
  it("subscripts counts, and only counts", () => {
    expect(formatFormula("CH4")).toBe("CH₄");
    expect(formatFormula("C8H18")).toBe("C₈H₁₈");
    expect(formatFormula("C2H5OH")).toBe("C₂H₅OH");
    expect(formatFormula("(NH4)2SO4")).toBe("(NH₄)₂SO₄");
  });

  it("a hydrate coefficient stays full size — 5H2O is five waters, not H52O", () => {
    expect(formatFormula("CuSO4·5H2O")).toBe("CuSO₄·5H₂O");
    expect(formatFormula("CuSO4.5H2O")).toBe("CuSO₄·5H₂O");
  });

  it("already-subscripted and non-formula text pass through unmangled", () => {
    expect(formatFormula("C₈H₁₈")).toBe("C₈H₁₈");
    expect(formatFormula("123")).toBe("123");
    expect(formatFormula("")).toBe("");
  });
});

describe("LCOE", () => {
  it("zero discount rate: plain totals", () => {
    const r = okOrFail(
      lcoe({ capex: 1000, annualOpex: 100, annualEnergyMWh: 100, discountRate: 0, lifetimeYears: 10 })
    );
    expect(r.presentValueCosts).toBeCloseTo(2000, 10);
    expect(r.presentValueMWh).toBeCloseTo(1000, 10);
    expect(r.lcoePerMWh).toBeCloseTo(2, 10);
  });

  it("agrees with finance.npv on both numerator and denominator", () => {
    // Independent cross-check through the finance module's own discounting.
    const inp = { capex: 1.5e6, annualOpex: 3e4, annualEnergyMWh: 3500, discountRate: 0.07, lifetimeYears: 25, degradationRate: 0.005 };
    const r = okOrFail(lcoe(inp));
    const opexFlows = [0, ...Array.from({ length: 25 }, () => inp.annualOpex)];
    const energyFlows = [0, ...Array.from({ length: 25 }, (_, i) => inp.annualEnergyMWh * Math.pow(1 - 0.005, i))];
    const pvCosts = inp.capex + npv(0.07, opexFlows);
    const pvEnergy = npv(0.07, energyFlows);
    expect(r.presentValueCosts).toBeCloseTo(pvCosts, 6);
    expect(r.presentValueMWh).toBeCloseTo(pvEnergy, 6);
  });

  it("degradation lowers generation and raises the LCOE", () => {
    const base = okOrFail(lcoe({ capex: 1e6, annualOpex: 0, annualEnergyMWh: 1000, discountRate: 0.05, lifetimeYears: 20 }));
    const deg = okOrFail(
      lcoe({ capex: 1e6, annualOpex: 0, annualEnergyMWh: 1000, discountRate: 0.05, lifetimeYears: 20, degradationRate: 0.01 })
    );
    expect(deg.lcoePerMWh).toBeGreaterThan(base.lcoePerMWh);
  });

  it("refuses a fractional or out-of-range lifetime", () => {
    expect(lcoe({ capex: 1, annualOpex: 0, annualEnergyMWh: 1, discountRate: 0.05, lifetimeYears: 12.5 }).ok).toBe(false);
    expect(lcoe({ capex: 1, annualOpex: 0, annualEnergyMWh: 1, discountRate: 0.05, lifetimeYears: 0 }).ok).toBe(false);
    expect(lcoe({ capex: 1, annualOpex: 0, annualEnergyMWh: 1, discountRate: 0.05, lifetimeYears: 101 }).ok).toBe(false);
  });
});

describe("capacity factor", () => {
  it("2 MW making 6132 MWh in a year is CF 0.35", () => {
    const r = okOrFail(capacityFactor(2, 6132));
    expect(r.capacityFactor).toBeCloseTo(0.35, 10);
    expect(r.equivalentFullLoadHours).toBeCloseTo(3066, 8);
  });

  it("refuses CF > 1 with the arithmetic in the message", () => {
    const r = capacityFactor(2, 20000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("17520");
  });
});
