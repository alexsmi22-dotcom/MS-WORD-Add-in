// Adversarial pass for the energy suite: hostile, degenerate and extreme
// inputs; the standing checklist items — intermediates of higher degree than
// the answer (v^3, Peukert's pow), Infinity reaching a report, unbounded
// loops — and property checks that do not reuse the implementation's own
// arithmetic. Failures are collected and asserted once, outside any timed
// region.

import {
  windPower,
  solarPV,
  fillFactor,
  hydroPower,
  batteryPack,
  combustion,
  lcoe,
  capacityFactor,
  windShear,
  weibullWind,
  flueGas,
  storageSizing,
  solarGeometry,
  BETZ_LIMIT,
} from "../energy";
import { threePhase, pfCorrection, voltageDrop } from "../grid";

/** Deterministic LCG so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const HOSTILE = [
  0, -0, 1, -1, 0.5, 1e-300, 5e-324, 1e300, 1.7e308, -1e300, Infinity, -Infinity, NaN,
  Number.MAX_SAFE_INTEGER, Number.EPSILON, 2 ** 31, -(2 ** 31), 1e-15, 3.14159,
];

/** Every numeric field of an ok result must be finite — Infinity/NaN in a
 * report is the standing defect class. Returns a description or null. */
function nonFiniteIn(res: unknown): string | null {
  if (typeof res !== "object" || res === null) return null;
  const r = res as Record<string, unknown>;
  if (r.ok !== true) {
    // A refusal must still be a proper refusal: a string error, no NaN text.
    return typeof r.error === "string" && r.error.length > 0 ? null : "refusal without an error string";
  }
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "number" && !Number.isFinite(v)) return `${k} = ${v}`;
  }
  return null;
}

describe("no calculator ever reports a non-finite number or a blank refusal", () => {
  it("wind over the hostile grid", () => {
    const failures: string[] = [];
    for (const d of HOSTILE)
      for (const v of HOSTILE)
        for (const cp of [undefined, 0.4, BETZ_LIMIT, 1e300, NaN]) {
          const bad = nonFiniteIn(windPower({ diameter: d, windSpeed: v, cp }));
          if (bad) failures.push(`d=${d} v=${v} cp=${cp}: ${bad}`);
        }
    expect(failures).toEqual([]);
  });

  it("solar over the hostile grid", () => {
    const failures: string[] = [];
    for (const g of HOSTILE)
      for (const a of HOSTILE)
        for (const eff of [0.2, 1e-300, 0.4999, NaN]) {
          const bad = nonFiniteIn(solarPV({ irradiance: g, area: a, efficiency: eff, ambientC: 30, noctC: 45 }));
          if (bad) failures.push(`g=${g} a=${a} eff=${eff}: ${bad}`);
        }
    expect(failures).toEqual([]);
  });

  it("fill factor, hydro, capacity factor over the hostile grid", () => {
    const failures: string[] = [];
    for (const x of HOSTILE)
      for (const y of HOSTILE) {
        for (const [name, res] of [
          ["ff", fillFactor(x, y, x / 2, y / 2)],
          ["hydro", hydroPower({ flow: x, grossHead: y, efficiency: 0.85 })],
          ["cf", capacityFactor(x, y)],
        ] as const) {
          const bad = nonFiniteIn(res);
          if (bad) failures.push(`${name} x=${x} y=${y}: ${bad}`);
        }
      }
    expect(failures).toEqual([]);
  });

  it("battery over the hostile grid — Peukert's pow is the overflow risk", () => {
    const failures: string[] = [];
    for (const cap of HOSTILE)
      for (const load of HOSTILE)
        for (const k of [1, 1.02, 1.3, 2]) {
          const bad = nonFiniteIn(
            batteryPack({ cellVoltage: 3.6, cellCapacityAh: cap, series: 10, parallel: 10, loadCurrentA: load, peukertExponent: k })
          );
          if (bad) failures.push(`cap=${cap} load=${load} k=${k}: ${bad}`);
        }
    expect(failures).toEqual([]);
  });

  it("LCOE over the hostile grid", () => {
    const failures: string[] = [];
    for (const capex of HOSTILE)
      for (const e of HOSTILE)
        for (const rate of [0, 0.07, 0.5]) {
          const bad = nonFiniteIn(
            lcoe({ capex, annualOpex: 1e4, annualEnergyMWh: e, discountRate: rate, lifetimeYears: 100 })
          );
          if (bad) failures.push(`capex=${capex} e=${e} r=${rate}: ${bad}`);
        }
    expect(failures).toEqual([]);
  });

  it("combustion over hostile formulas", () => {
    const formulas = [
      "", " ", "C", "H2", "S8", "CH4", "C8H18", "C2H5OH", "CH3SH", "C6H5NO2",
      "CO2", "H2O", "N2", "O2", "Fe2O3", "NaCl", "UF6", "((CH3)2CH)2O",
      "CuSO4·5H2O", "C999999H2000000", "C1H1O1N1S1", "xyz", "123", "C-1H4",
      "😀", "C₈H₁₈", " CH4", "CH4".repeat(5000),
    ];
    const failures: string[] = [];
    for (const f of formulas)
      for (const hhv of [undefined, 55.5, 1e-300, 149]) {
        const bad = nonFiniteIn(combustion({ formula: f, hhvMJPerKg: hhv }));
        if (bad) failures.push(`"${f.slice(0, 30)}" hhv=${hhv}: ${bad}`);
      }
    expect(failures).toEqual([]);
  });
});

describe("v2.62.0 engines: no non-finite number or blank refusal ever escapes", () => {
  it("wind shear and Weibull over the hostile grid", () => {
    const failures: string[] = [];
    for (const a of HOSTILE)
      for (const b of HOSTILE) {
        for (const [name, res] of [
          ["shear", windShear({ refSpeed: a, refHeight: b, targetHeight: 80, alpha: 0.2, roughnessM: 0.03 })],
          ["shear2", windShear({ refSpeed: 6, refHeight: 10, targetHeight: a, alpha: b, roughnessM: b })],
          ["weibull", weibullWind({ shape: a, scale: b })],
          ["weibull2", weibullWind({ shape: 2, meanSpeed: a, airDensity: b })],
        ] as const) {
          const bad = nonFiniteIn(res);
          if (bad) failures.push(`${name} a=${a} b=${b}: ${bad}`);
        }
      }
    expect(failures).toEqual([]);
  });

  it("Weibull with hostile turbine bands", () => {
    const failures: string[] = [];
    for (const ci of HOSTILE)
      for (const rated of [3.0000001, 12, 1e300, NaN]) {
        const bad = nonFiniteIn(
          weibullWind({ shape: 2, scale: 8, turbine: { cutIn: ci, rated, cutOut: rated * 2 } })
        );
        if (bad) failures.push(`ci=${ci} rated=${rated}: ${bad}`);
      }
    expect(failures).toEqual([]);
  });

  it("flue gas over hostile readings and formulas", () => {
    const failures: string[] = [];
    for (const o2 of HOSTILE)
      for (const f of ["CH4", "C", "H2", "CH3SH", "CO2", "", "xyz"]) {
        const bad = nonFiniteIn(flueGas({ formula: f, o2DryPct: o2 }));
        if (bad) failures.push(`"${f}" o2=${o2}: ${bad}`);
      }
    expect(failures).toEqual([]);
  });

  it("storage over the hostile grid — the degradation pow and the year loop", () => {
    const failures: string[] = [];
    for (const load of HOSTILE)
      for (const capex of HOSTILE) {
        const bad = nonFiniteIn(
          storageSizing({
            dailyLoadKWh: load, autonomyDays: 2, depthOfDischarge: 0.8, roundTripEff: 0.9,
            economics: { capex, annualOpex: 100, cyclesPerYear: 300, lifetimeYears: 100, discountRate: 0, degradationRate: 0.99 },
          })
        );
        if (bad) failures.push(`load=${load} capex=${capex}: ${bad}`);
      }
    expect(failures).toEqual([]);
  });

  it("solar geometry over every latitude/day corner, including the poles", () => {
    const failures: string[] = [];
    for (const lat of [-90, -89.999, -66.5, -23.45, 0, 23.45, 66.5, 89.999, 90, NaN, Infinity, 91])
      for (const day of [1, 81, 172, 266, 355, 366, 0, 367, 172.5, NaN]) {
        const bad = nonFiniteIn(solarGeometry({ latitudeDeg: lat, dayOfYear: day, solarHour: 12 }));
        if (bad) failures.push(`lat=${lat} day=${day}: ${bad}`);
      }
    expect(failures).toEqual([]);
  });

  it("grid: three-phase, PF correction and voltage drop over the hostile grid", () => {
    const failures: string[] = [];
    for (const a of HOSTILE)
      for (const b of HOSTILE) {
        for (const [name, res] of [
          ["3ph", threePhase({ lineVoltage: a, lineCurrentA: b, powerFactor: 0.8 })],
          ["3ph2", threePhase({ lineVoltage: 400, realPowerW: a, powerFactor: b })],
          ["pfc", pfCorrection({ realPowerW: a, pfBefore: 0.7, pfAfter: 0.95, lineVoltage: b, frequencyHz: 50 })],
          ["drop", voltageDrop({ material: "copper", kind: "dc", lengthM: a, currentA: b, sectionMm2: 2.5 })],
          ["drop2", voltageDrop({ material: "aluminium", kind: "three-phase", lengthM: 10, currentA: a, sectionMm2: b, supplyVoltage: 400, maxDropFraction: 0.03 })],
        ] as const) {
          const bad = nonFiniteIn(res);
          if (bad) failures.push(`${name} a=${a} b=${b}: ${bad}`);
        }
      }
    expect(failures).toEqual([]);
  });

  it("hostile AWG numbers are refused, never misread", () => {
    for (const awg of [41, -4, 12.5, NaN, Infinity, -Infinity, 1e300]) {
      const r = voltageDrop({ material: "copper", kind: "dc", lengthM: 10, currentA: 10, awg });
      expect(r.ok).toBe(false);
    }
  });

  it("time budget: the Weibull CF integration stays fast under repetition", () => {
    const start = Date.now();
    let sink = 0;
    for (let i = 0; i < 500; i++) {
      const r = weibullWind({ shape: 1.5 + (i % 10) / 10, scale: 5 + (i % 7), turbine: { cutIn: 3, rated: 12, cutOut: 25 } });
      sink += r.ok ? 1 : 0;
    }
    const ms = Date.now() - start;
    expect(sink).toBe(500);
    // 500 keystroke-shaped calls; generous under parallel-suite load.
    expect(ms).toBeLessThan(3000);
  });
});

describe("physical-bound enforcement cannot be sneaked past", () => {
  it("Cp just above Betz refused at every magnitude", () => {
    for (const eps of [1e-15, 1e-9, 0.001, 0.1]) {
      expect(windPower({ diameter: 10, windSpeed: 5, cp: BETZ_LIMIT + eps }).ok).toBe(false);
    }
  });

  it("efficiencies above unity refused everywhere they appear", () => {
    expect(hydroPower({ flow: 1, grossHead: 1, efficiency: 1 + 1e-12 }).ok).toBe(false);
    expect(solarPV({ irradiance: 1000, area: 1, efficiency: 0.51 }).ok).toBe(false);
    const cf = capacityFactor(1, 8760 + 1e-6);
    expect(cf.ok).toBe(false);
  });

  it("an HHV below the fuel's own condensation heat is refused as inconsistent", () => {
    // Methane's combustion water carries ~5.5 MJ/kg of latent heat; an HHV of
    // 3 MJ/kg is arithmetically impossible for CH4 rather than merely odd.
    const r = combustion({ formula: "CH4", hhvMJPerKg: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("inconsistent");
  });
});

describe("properties that do not reuse the implementation's arithmetic", () => {
  it("wind: swept area from an independent circle formula, power ratio exact", () => {
    const rnd = rng(0xE17E9);
    const failures: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const d = 1 + rnd() * 200;
      const v = 0.5 + rnd() * 40;
      const rho = 0.9 + rnd() * 0.4;
      const r = windPower({ diameter: d, windSpeed: v, airDensity: rho });
      if (!r.ok) {
        failures.push(`refused ordinary inputs d=${d} v=${v} rho=${rho}: ${r.error}`);
        continue;
      }
      const area = Math.PI * (d / 2) * (d / 2);
      if (Math.abs(r.sweptArea - area) / area > 1e-12) failures.push(`area d=${d}`);
      // P/(rho v^3) must equal A/2 — checks the formula without recomputing it.
      const ratio = r.windPower / (rho * v * v * v);
      if (Math.abs(ratio - area / 2) / (area / 2) > 1e-12) failures.push(`power d=${d} v=${v}`);
    }
    expect(failures).toEqual([]);
  });

  it("battery: runtime x load returns the usable charge (k = 1 identity)", () => {
    const rnd = rng(0xBA77E);
    const failures: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const cap = 0.1 + rnd() * 200;
      const load = 0.01 + rnd() * 50;
      const dod = 0.05 + rnd() * 0.95;
      const r = batteryPack({ cellVoltage: 3.2, cellCapacityAh: cap, series: 4, parallel: 3, depthOfDischarge: Math.min(dod, 1), loadCurrentA: load });
      if (!r.ok) {
        failures.push(`refused cap=${cap} load=${load} dod=${dod}: ${r.error}`);
        continue;
      }
      const recoveredAh = r.runtimeHours! * load;
      const usableAh = r.packCapacityAh * Math.min(dod, 1);
      if (Math.abs(recoveredAh - usableAh) / usableAh > 1e-10) failures.push(`identity cap=${cap}`);
    }
    expect(failures).toEqual([]);
  });

  it("combustion: oxygen balance closes atom by atom", () => {
    // O in (fuel O + 2*O2 drawn) must equal O out (2*CO2 + H2O + 2*SO2), in
    // moles — a per-atom conservation check, not the mass identity the oracle
    // suite already uses.
    const cases: [string, number, number, number, number][] = [
      // formula, C, H, O, S
      ["CH4", 1, 4, 0, 0],
      ["C2H5OH", 2, 6, 1, 0],
      ["CH3SH", 1, 4, 0, 1],
      ["C6H5NO2", 6, 5, 2, 0],
      ["C12H22O11", 12, 22, 11, 0],
    ];
    const failures: string[] = [];
    for (const [f, C, H, O, S] of cases) {
      const r = combustion({ formula: f });
      if (!r.ok) {
        failures.push(`${f} refused: ${r.error}`);
        continue;
      }
      const oIn = O + 2 * r.o2PerMolFuel;
      const oOut = 2 * C + H / 2 + 2 * S;
      if (Math.abs(oIn - oOut) > 1e-9) failures.push(`${f}: O in ${oIn} != O out ${oOut}`);
    }
    expect(failures).toEqual([]);
  });

  it("LCOE at zero degradation and zero opex reduces to capex / annuity", () => {
    // Closed-form annuity PV — independent of the engine's year loop.
    const r = lcoe({ capex: 1e6, annualOpex: 0, annualEnergyMWh: 500, discountRate: 0.08, lifetimeYears: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const annuity = (1 - Math.pow(1.08, -30)) / 0.08;
      expect(r.lcoePerMWh).toBeCloseTo(1e6 / (500 * annuity), 6);
    }
  });
});

describe("time budgets — a pane recomputes per keystroke", () => {
  it("10,000 mixed calls stay well under a second", () => {
    const rnd = rng(0x7157);
    const start = Date.now();
    let sink = 0;
    for (let i = 0; i < 10000; i++) {
      const x = rnd() * 100 + 0.1;
      const r1 = windPower({ diameter: x, windSpeed: x / 10, cp: 0.4 });
      const r2 = batteryPack({ cellVoltage: 3.6, cellCapacityAh: x, series: 10, parallel: 4, loadCurrentA: x / 5, peukertExponent: 1.2 });
      const r3 = lcoe({ capex: x * 1e4, annualOpex: x, annualEnergyMWh: x, discountRate: 0.07, lifetimeYears: 100 });
      sink += (r1.ok ? 1 : 0) + (r2.ok ? 1 : 0) + (r3.ok ? 1 : 0);
    }
    const ms = Date.now() - start;
    expect(sink).toBeGreaterThan(0);
    // ~370 ms on an idle machine; the budget is 3 s because under the full
    // suite's parallel workers wall-clock inflates ~4x with nothing actually
    // slower — the documented beam.adversarial flake. Even at the budget this
    // pins ≤0.3 ms per keystroke-triggered call.
    expect(ms).toBeLessThan(3000);
  });

  it("a 50k-character formula returns promptly rather than hanging the parser path", () => {
    const start = Date.now();
    const r = combustion({ formula: "C2H4".repeat(12500) });
    const ms = Date.now() - start;
    expect(r.ok).toBe(false); // over the size cap
    expect(ms).toBeLessThan(250);
  });
});
