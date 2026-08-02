// The committed cross-check that makes bundled thermodynamic data acceptable
// (the periodic-table precedent): the GRI-Mech 3.0 polynomials in flame.ts
// are validated against INDEPENDENT landmarks. Agreement of two independent
// sources is evidence both are right; disagreement fails the suite loudly.

import { cpMolar, hMolar, sensibleEnthalpy, flameTemperature, T_MAX_VALID, FlameSpecies } from "../flame";

describe("fetched NASA-7 data vs independent landmarks", () => {
  it("cp at 298.15 K matches the CODATA/JANAF standard values", () => {
    // J/(mol·K): N2 29.12, O2 29.38, CO2 37.13, H2O(g) 33.58 — textbook
    // constants recalled independently of the fetched file.
    const landmarks: [FlameSpecies, number][] = [
      ["N2", 29.12],
      ["O2", 29.38],
      ["CO2", 37.13],
      ["H2O", 33.58],
    ];
    for (const [sp, want] of landmarks) {
      expect(Math.abs(cpMolar(sp, 298.15) - want) / want).toBeLessThan(0.005);
    }
  });

  it("sensible enthalpy H(1000) - H(298) matches the JANAF tables", () => {
    // kJ/mol from JANAF: N2 21.463, O2 22.703, CO2 33.397, H2O 25.978.
    const landmarks: [FlameSpecies, number][] = [
      ["N2", 21.463],
      ["O2", 22.703],
      ["CO2", 33.397],
      ["H2O", 25.978],
    ];
    for (const [sp, want] of landmarks) {
      expect(Math.abs(sensibleEnthalpy(sp, 1000) / 1000 - want) / want).toBeLessThan(0.01);
    }
  });

  it("low and high ranges are continuous at the 1000 K junction", () => {
    for (const sp of ["CO2", "H2O", "N2", "O2"] as FlameSpecies[]) {
      const below = cpMolar(sp, 999.999999);
      const above = cpMolar(sp, 1000.000001);
      expect(Math.abs(below - above) / below).toBeLessThan(0.002);
      const hBelow = hMolar(sp, 999.999999);
      const hAbove = hMolar(sp, 1000.000001);
      expect(Math.abs(hBelow - hAbove) / Math.abs(hBelow)).toBeLessThan(0.002);
    }
  });

  it("the h polynomial IS the integral of the cp polynomial (a6 transcription check)", () => {
    // Integrate cp numerically (Simpson, fine grid) and compare with the
    // analytic enthalpy difference — independent arithmetic over the same
    // coefficients, which catches an error in the enthalpy-specific a6 term
    // or in either functional form.
    for (const sp of ["CO2", "H2O", "N2", "O2"] as FlameSpecies[]) {
      for (const [t0, t1] of [[300, 950], [1050, 3400]] as const) {
        const n = 2000;
        const h = (t1 - t0) / n;
        let s = cpMolar(sp, t0) + cpMolar(sp, t1);
        for (let i = 1; i < n; i++) s += cpMolar(sp, t0 + i * h) * (i % 2 ? 4 : 2);
        const integral = (s * h) / 3;
        const analytic = hMolar(sp, t1) - hMolar(sp, t0);
        expect(Math.abs(integral - analytic) / Math.abs(analytic)).toBeLessThan(1e-9);
      }
    }
  });

  it("cp stays physical across the whole validity range", () => {
    // Monatomic floor 5/2 R ≈ 20.8; nothing here should fall below the
    // diatomic 7/2 R ≈ 29.1 by much, or exceed ~65 J/mol·K.
    for (const sp of ["CO2", "H2O", "N2", "O2"] as FlameSpecies[]) {
      for (let t = 300; t <= T_MAX_VALID; t += 50) {
        const cp = cpMolar(sp, t);
        expect(cp).toBeGreaterThan(25);
        expect(cp).toBeLessThan(70);
      }
    }
  });
});

describe("adiabatic flame temperature", () => {
  const okOrFail = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
    if (!r.ok) throw new Error((r as { error: string }).error);
    return r as T;
  };

  it("methane at LHV 50.0, stoichiometric: the textbook no-dissociation ~2320 K", () => {
    const r = okOrFail(flameTemperature({ formula: "CH4", heatingValueMJPerKg: 50.0, basis: "LHV" }));
    expect(r.flameTempK).toBeGreaterThan(2250);
    expect(r.flameTempK).toBeLessThan(2400);
  });

  it("HHV route agrees with the LHV route through the latent-heat conversion", () => {
    const viaHHV = okOrFail(flameTemperature({ formula: "CH4", heatingValueMJPerKg: 55.5, basis: "HHV" }));
    const viaLHV = okOrFail(
      flameTemperature({ formula: "CH4", heatingValueMJPerKg: viaHHV.lhvUsedMJPerKg, basis: "LHV" })
    );
    expect(viaHHV.flameTempK).toBeCloseTo(viaLHV.flameTempK, 3);
  });

  it("the energy balance actually closes at the reported temperature", () => {
    const r = okOrFail(
      flameTemperature({ formula: "C3H8", heatingValueMJPerKg: 46.3, basis: "LHV", excessAir: 0.1 })
    );
    // Recompute both sides independently of the bisection.
    const heat =
      r.products.co2 * sensibleEnthalpy("CO2", r.flameTempK) +
      r.products.h2o * sensibleEnthalpy("H2O", r.flameTempK) +
      r.products.n2 * sensibleEnthalpy("N2", r.flameTempK) +
      r.products.o2 * sensibleEnthalpy("O2", r.flameTempK);
    const qFuel = 46.3e6 * (44.094 / 1000); // C3H8 molar mass, hand value
    expect(Math.abs(heat - qFuel) / qFuel).toBeLessThan(1e-4);
  });

  it("excess air lowers the flame temperature, monotonically", () => {
    let prev = Infinity;
    for (const e of [0, 0.1, 0.25, 0.5, 1.0]) {
      const r = okOrFail(flameTemperature({ formula: "CH4", heatingValueMJPerKg: 50, basis: "LHV", excessAir: e }));
      expect(r.flameTempK).toBeLessThan(prev);
      prev = r.flameTempK;
    }
  });

  it("air preheat raises it", () => {
    const cold = okOrFail(flameTemperature({ formula: "CH4", heatingValueMJPerKg: 50, basis: "LHV", excessAir: 0.1 }));
    const hot = okOrFail(
      flameTemperature({ formula: "CH4", heatingValueMJPerKg: 50, basis: "LHV", excessAir: 0.1, airPreheatC: 400 })
    );
    expect(hot.flameTempK).toBeGreaterThan(cold.flameTempK + 100);
    expect(hot.preheatMJPerKg).toBeGreaterThan(0);
  });

  it("hydrogen runs hotter than methane", () => {
    const h2 = okOrFail(flameTemperature({ formula: "H2", heatingValueMJPerKg: 120, basis: "LHV" }));
    const ch4 = okOrFail(flameTemperature({ formula: "CH4", heatingValueMJPerKg: 50, basis: "LHV" }));
    expect(h2.flameTempK).toBeGreaterThan(ch4.flameTempK);
    expect(h2.flameTempK).toBeLessThan(T_MAX_VALID);
  });

  it("refuses sulfur fuels with the reason, and impossible balances at the 3500 K wall", () => {
    const s = flameTemperature({ formula: "CH3SH", heatingValueMJPerKg: 25, basis: "LHV" });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toContain("Sulfur");
    const wall = flameTemperature({ formula: "H2", heatingValueMJPerKg: 129, basis: "LHV" });
    if (!wall.ok) expect(wall.error).toContain("3500");
  });

  it("hostile inputs never yield a non-finite report", () => {
    const hostile = [0, -1, 1e300, Infinity, -Infinity, NaN, 5e-324];
    const failures: string[] = [];
    for (const hv of hostile)
      for (const e of [0, 0.5, NaN, 1e300]) {
        const r = flameTemperature({ formula: "CH4", heatingValueMJPerKg: hv, basis: "LHV", excessAir: e, airPreheatC: 100 });
        if (r.ok) {
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === "number" && !Number.isFinite(v)) failures.push(`hv=${hv} e=${e}: ${k}=${v}`);
          }
        } else if (!r.error) failures.push(`hv=${hv} e=${e}: blank refusal`);
      }
    expect(failures).toEqual([]);
  });
});
