// Oracle tests for the thermodynamics engine.
//
// The expected values are standard closed forms and textbook cases worked
// independently of the code. Two checks here are stronger than a formula
// comparison and are the reason this file is worth its length: the first law is
// verified round the whole cycle rather than assumed (heat in minus heat out
// must equal net work), and the Carnot bound is checked to actually bound every
// cycle the module can produce.

import {
  toKelvin,
  GASES,
  idealGasProcess,
  carnot,
  ottoCycle,
  dieselCycle,
  braytonCycle,
  rankineFromEnthalpies,
  refrigerationFromEnthalpies,
  checkAgainstCarnot,
  ProcessResult,
  CarnotResult,
  CycleResult,
  VapourResult,
  RefrigerationResult,
} from "../thermo";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

function proc(inp: Parameters<typeof idealGasProcess>[0]): ProcessResult {
  const r = idealGasProcess(inp);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const AIR = GASES[0];

// ---------------------------------------------------------------------------
describe("absolute temperature is enforced", () => {
  test("the conversions are right", () => {
    near(toKelvin(0, "C") as number, 273.15);
    near(toKelvin(100, "C") as number, 373.15);
    near(toKelvin(300, "K") as number, 300);
    near(toKelvin(32, "F") as number, 273.15);
    near(toKelvin(212, "F") as number, 373.15);
  });

  // The error this module exists to prevent.
  test("a temperature at or below absolute zero is refused with the likely cause", () => {
    for (const [v, u] of [
      [0, "K"],
      [-1, "K"],
      [-300, "C"],
      [-500, "F"],
    ] as [number, "K" | "C" | "F"][]) {
      const r = toKelvin(v, u);
      expect(typeof r === "object" && "ok" in r && r.ok === false).toBe(true);
      if (typeof r === "object" && "error" in r) expect(r.error).toMatch(/absolute zero/);
    }
  });

  test("non-finite temperatures are refused", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(typeof toKelvin(v, "K") === "object").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("ideal gas processes", () => {
  const BASE = { gasId: "air", m: 1, p1: 100000, t1: 300 };

  test("the initial volume comes from the ideal gas law", () => {
    const r = proc({ ...BASE, kind: "isothermal", p2: 200000 });
    near(r.v1, (1 * AIR.R * 300) / 100000);
  });

  test("isothermal: temperature holds, internal energy is unchanged, Q equals W", () => {
    const r = proc({ ...BASE, kind: "isothermal", v2: 2 * ((1 * AIR.R * 300) / 100000) });
    near(r.t2, 300);
    near(r.deltaU, 0, 1e-9);
    near(r.heat, r.work);
    // W = P1*V1*ln(V2/V1) = m*R*T*ln(2)
    near(r.work, 1 * AIR.R * 300 * Math.LN2);
  });

  test("isochoric: zero work, all heat into internal energy", () => {
    const r = proc({ ...BASE, kind: "isochoric", t2: 600 });
    expect(r.work).toBe(0);
    near(r.heat, r.deltaU);
    near(r.deltaU, 1 * AIR.cv * 300);
    near(r.v2, r.v1);
    near(r.p2, 200000);
  });

  test("isobaric: heat equals the enthalpy change", () => {
    const r = proc({ ...BASE, kind: "isobaric", t2: 600 });
    near(r.p2, 100000);
    near(r.heat, r.deltaH);
    near(r.deltaH, 1 * AIR.cp * 300);
    // W = P*dV = m*R*dT
    near(r.work, 1 * AIR.R * 300);
  });

  test("isentropic: the temperature ratio follows the pressure ratio to (k-1)/k", () => {
    const r = proc({ ...BASE, kind: "isentropic", p2: 1000000 });
    near(r.t2, 300 * Math.pow(10, (AIR.k - 1) / AIR.k));
    // Q = 0 by construction.
    expect(Math.abs(r.heat)).toBeLessThan(1e-6 * Math.abs(r.deltaU));
    // ...and the entropy change is zero, which is what isentropic means.
    expect(Math.abs(r.deltaS)).toBeLessThan(1e-6 * Math.abs(r.deltaU / 300));
  });

  test("isentropic work is minus the internal energy change", () => {
    const r = proc({ ...BASE, kind: "isentropic", p2: 1000000 });
    near(r.work, -r.deltaU, 1e-6);
  });

  test("the first law holds for every process kind", () => {
    // Q = dU + W, checked rather than assumed, on every branch.
    const cases: Parameters<typeof idealGasProcess>[0][] = [
      { ...BASE, kind: "isothermal", p2: 250000 },
      { ...BASE, kind: "isobaric", v2: 0.002 },
      { ...BASE, kind: "isochoric", p2: 300000 },
      { ...BASE, kind: "isentropic", p2: 700000 },
      { ...BASE, kind: "polytropic", n: 1.2, p2: 500000 },
      { ...BASE, kind: "polytropic", n: 0.5, v2: 0.0005 },
    ];
    for (const c of cases) {
      const r = proc(c);
      expect(Math.abs(r.heat - (r.deltaU + r.work))).toBeLessThan(1e-6 * Math.max(1, Math.abs(r.heat)));
    }
  });

  test("polytropic with n = 1 reproduces the isothermal result", () => {
    const a = proc({ ...BASE, kind: "isothermal", p2: 300000 });
    const b = proc({ ...BASE, kind: "polytropic", n: 1, p2: 300000 });
    near(b.work, a.work, 1e-9);
    near(b.t2, a.t2, 1e-9);
  });

  test("polytropic with n = k reproduces the isentropic result", () => {
    const a = proc({ ...BASE, kind: "isentropic", p2: 300000 });
    const b = proc({ ...BASE, kind: "polytropic", n: AIR.k, p2: 300000 });
    near(b.work, a.work, 1e-9);
    near(b.t2, a.t2, 1e-9);
  });

  test("an isothermal process cannot be fixed by an end temperature", () => {
    const r = idealGasProcess({ ...BASE, kind: "isothermal", t2: 400 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not define the end state/);
  });

  test("the isentropic caveat about reversibility is stated", () => {
    const r = proc({ ...BASE, kind: "isentropic", p2: 300000 });
    expect(r.notes.join(" ")).toMatch(/adiabatic AND reversible/i);
  });

  test("the constant-specific-heat caveat is always stated", () => {
    expect(proc({ ...BASE, kind: "isobaric", t2: 400 }).notes.join(" ")).toMatch(/rise appreciably with temperature/i);
  });

  test("non-physical inputs are refused", () => {
    expect(idealGasProcess({ ...BASE, m: 0, kind: "isobaric", t2: 400 }).ok).toBe(false);
    expect(idealGasProcess({ ...BASE, p1: 0, kind: "isobaric", t2: 400 }).ok).toBe(false);
    expect(idealGasProcess({ ...BASE, t1: -5, kind: "isobaric", t2: 400 }).ok).toBe(false);
    expect(idealGasProcess({ ...BASE, kind: "isobaric" }).ok).toBe(false);
    expect(idealGasProcess({ ...BASE, kind: "polytropic", p2: 200000 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("Carnot", () => {
  test("efficiency and both COPs match the closed forms", () => {
    const c = carnot(800, 300) as CarnotResult;
    near(c.efficiency, 1 - 300 / 800);
    near(c.copRefrigerator, 300 / 500);
    near(c.copHeatPump, 800 / 500);
  });

  // An identity worth pinning, because it is a good self-check for a reader.
  test("the heat-pump COP is exactly the refrigerator COP plus one", () => {
    for (const [th, tc] of [
      [800, 300],
      [320, 275],
      [1000, 999],
    ]) {
      const c = carnot(th, tc) as CarnotResult;
      near(c.copHeatPump, c.copRefrigerator + 1, 1e-9);
    }
  });

  test("equal or inverted reservoirs are refused with the second law named", () => {
    const r = carnot(300, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/second law/i);
    expect(carnot(300, 400).ok).toBe(false);
  });

  test("a suspiciously high bound warns about the Celsius error", () => {
    const c = carnot(2000, 100) as CarnotResult;
    expect(c.notes.join(" ")).toMatch(/Celsius/);
  });

  test("non-positive temperatures are refused", () => {
    expect(carnot(0, -10).ok).toBe(false);
    expect(carnot(NaN, 300).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("air-standard cycles", () => {
  test("Otto efficiency matches 1 - r^(1-k)", () => {
    const c = ottoCycle(8) as CycleResult;
    // AIR.k, not a hardcoded 1.4: k is DERIVED from cp/cv so the property table
    // is self-consistent, which puts it at 1.39972 rather than the rounded 1.4.
    near(c.efficiency, 1 - Math.pow(8, 1 - AIR.k));
    // Still the familiar textbook figure to the precision anyone quotes it.
    expect(c.efficiency).toBeCloseTo(0.565, 2);
  });

  test("Otto temperatures follow the isentropic relations", () => {
    const c = ottoCycle(8, "air", 300, 1800) as CycleResult;
    near(c.temperatures[1].t, 300 * Math.pow(8, AIR.k - 1));
    near(c.temperatures[3].t, 1800 * Math.pow(8, 1 - AIR.k));
    // Net work must be the efficiency times the heat in, by definition.
    near(c.netWork as number, c.efficiency * (c.heatIn as number));
  });

  test("Diesel efficiency matches its closed form", () => {
    const r = 18,
      rc = 2,
      k = AIR.k;
    const c = dieselCycle(r, rc) as CycleResult;
    const expected = 1 - Math.pow(r, 1 - k) * ((Math.pow(rc, k) - 1) / (k * (rc - 1)));
    near(c.efficiency, expected);
  });

  // The result students find surprising.
  test("at the same compression ratio Otto beats Diesel, and it says so", () => {
    const otto = ottoCycle(18) as CycleResult;
    const diesel = dieselCycle(18, 2) as CycleResult;
    expect(otto.efficiency).toBeGreaterThan(diesel.efficiency);
    expect(diesel.notes.join(" ")).toMatch(/At the SAME compression ratio the Otto cycle is more efficient/i);
    expect(diesel.notes.join(" ")).toMatch(/nothing to knock/i);
  });

  test("as the cut-off ratio approaches 1 the Diesel cycle approaches the Otto cycle", () => {
    const otto = ottoCycle(18) as CycleResult;
    const near1 = dieselCycle(18, 1.0001) as CycleResult;
    expect(Math.abs(near1.efficiency - otto.efficiency)).toBeLessThan(1e-4);
  });

  test("Brayton efficiency depends only on the pressure ratio", () => {
    const a = braytonCycle(10, "air", 300, 1200) as CycleResult;
    const b = braytonCycle(10, "air", 300, 1600) as CycleResult;
    near(a.efficiency, b.efficiency);
    near(a.efficiency, 1 - Math.pow(10, (1 - AIR.k) / AIR.k));
    expect(a.notes.join(" ")).toMatch(/depends ONLY on the pressure ratio/i);
  });

  test("Brayton reports the work-optimum pressure ratio as distinct from the efficiency optimum", () => {
    const c = braytonCycle(10, "air", 300, 1400) as CycleResult;
    expect(c.notes.join(" ")).toMatch(/Maximum NET WORK/i);
    expect(c.notes.join(" ")).toMatch(/NOT the ratio that maximises efficiency/i);
  });

  // The bound that must hold for every cycle this module can produce.
  test("no cycle ever beats Carnot between its own extremes", () => {
    for (const r of [4, 8, 12, 18, 24]) {
      const o = ottoCycle(r, "air", 300, 1800);
      if (o.ok && o.carnotEfficiency !== null) expect(o.efficiency).toBeLessThan(o.carnotEfficiency);
      const d = dieselCycle(r, Math.min(2, r * 0.5), "air", 300);
      if (d.ok && d.carnotEfficiency !== null) expect(d.efficiency).toBeLessThan(d.carnotEfficiency);
    }
    for (const rp of [4, 10, 20, 40]) {
      const b = braytonCycle(rp, "air", 300, 1500);
      if (b.ok && b.carnotEfficiency !== null) expect(b.efficiency).toBeLessThan(b.carnotEfficiency);
    }
  });

  test("a knock-limited compression ratio is flagged", () => {
    expect((ottoCycle(16) as CycleResult).notes.join(" ")).toMatch(/knock/i);
    expect((ottoCycle(9) as CycleResult).notes.join(" ")).not.toMatch(/knock/i);
  });

  test("the air-standard caveat is always stated", () => {
    expect((ottoCycle(8) as CycleResult).notes.join(" ")).toMatch(/Air-standard/);
    expect((ottoCycle(8) as CycleResult).notes.join(" ")).toMatch(/factor of three/i);
  });

  test("impossible cycle geometry is refused", () => {
    expect(ottoCycle(1).ok).toBe(false);
    expect(ottoCycle(0.5).ok).toBe(false);
    expect(dieselCycle(18, 1).ok).toBe(false);
    expect(dieselCycle(18, 20).ok).toBe(false);
    expect(braytonCycle(1).ok).toBe(false);
    // Peak temperature below the end of compression is not a cycle.
    expect(ottoCycle(8, "air", 300, 400).ok).toBe(false);
    expect(braytonCycle(20, "air", 300, 400).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("vapour cycles from supplied enthalpies", () => {
  // A standard textbook Rankine cycle, in kJ/kg.
  const H1 = 191.8; // saturated liquid at the condenser
  const H2 = 195.0; // after the pump
  const H3 = 3214.0; // superheated steam at the turbine inlet
  const H4 = 2100.0; // after the turbine

  test("work, heat and efficiency follow from the four enthalpies", () => {
    const r = rankineFromEnthalpies(H1, H2, H3, H4) as VapourResult;
    near(r.turbineWork, H3 - H4);
    near(r.pumpWork, H2 - H1);
    near(r.netWork, H3 - H4 - (H2 - H1));
    near(r.heatIn, H3 - H2);
    near(r.heatOut, H4 - H1);
    near(r.efficiency, (H3 - H4 - (H2 - H1)) / (H3 - H2));
  });

  // The independent check: energy in must equal energy out.
  test("the cycle energy balance closes", () => {
    const r = rankineFromEnthalpies(H1, H2, H3, H4) as VapourResult;
    expect(Math.abs(r.heatIn - r.heatOut - r.netWork)).toBeLessThan(1e-9 * r.heatIn);
  });

  test("the back-work ratio is small and the reason is explained", () => {
    const r = rankineFromEnthalpies(H1, H2, H3, H4) as VapourResult;
    expect(r.backWorkRatio).toBeLessThan(0.05);
    expect(r.notes.join(" ")).toMatch(/pumping a LIQUID/i);
  });

  test("it says the property data is the reader's, not the tool's", () => {
    const r = rankineFromEnthalpies(H1, H2, H3, H4) as VapourResult;
    expect(r.notes.join(" ")).toMatch(/no steam tables are built into this tool/i);
  });

  test("thermodynamically backwards enthalpies are refused", () => {
    expect(rankineFromEnthalpies(H1, H2, 100, H4).ok).toBe(false); // boiler removes heat
    expect(rankineFromEnthalpies(H1, H2, H3, H3 + 1).ok).toBe(false); // turbine absorbs work
    expect(rankineFromEnthalpies(200, 100, H3, H4).ok).toBe(false); // pump removes energy
    expect(rankineFromEnthalpies(NaN, H2, H3, H4).ok).toBe(false);
  });

  test("refrigeration COPs follow from three enthalpies and differ by exactly one", () => {
    const r = refrigerationFromEnthalpies(239.2, 275.4, 95.5) as RefrigerationResult;
    near(r.compressorWork, 275.4 - 239.2);
    near(r.refrigerationEffect, 239.2 - 95.5);
    near(r.heatRejected, 275.4 - 95.5);
    near(r.copHeatPump, r.copRefrigerator + 1, 1e-9);
  });

  test("the throttle being isenthalpic is explained", () => {
    const r = refrigerationFromEnthalpies(239.2, 275.4, 95.5) as RefrigerationResult;
    expect(r.notes.join(" ")).toMatch(/THROTTLE/);
    expect(r.notes.join(" ")).toMatch(/h4 = h3/);
  });

  test("impossible refrigeration states are refused", () => {
    expect(refrigerationFromEnthalpies(239.2, 200, 95.5).ok).toBe(false);
    expect(refrigerationFromEnthalpies(239.2, 275.4, 300).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the Carnot check", () => {
  test("a possible efficiency is confirmed as possible", () => {
    const r = checkAgainstCarnot(0.4, 800, 300, "efficiency");
    if (!r.ok) throw new Error(r.error);
    expect(r.possible).toBe(true);
    expect(r.message).toMatch(/thermodynamically possible/);
  });

  // The exact scenario the function exists for: 500 C and 20 C in Celsius.
  test("an impossible efficiency is refused and the Celsius cause is named", () => {
    // Bound between 773.15 K and 293.15 K is 0.621. A claim of 0.68 is impossible.
    const r = checkAgainstCarnot(0.68, 773.15, 293.15, "efficiency");
    if (!r.ok) throw new Error(r.error);
    expect(r.possible).toBe(false);
    expect(r.message).toMatch(/IMPOSSIBLE/);
    expect(r.message).toMatch(/Celsius/);
    near(r.bound, 1 - 293.15 / 773.15);
  });

  test("it checks refrigerator and heat-pump COPs against the right bound", () => {
    const ref = checkAgainstCarnot(5, 300, 270, "refrigerator");
    const hp = checkAgainstCarnot(5, 300, 270, "heat-pump");
    if (!ref.ok || !hp.ok) throw new Error("setup");
    near(ref.bound, 270 / 30);
    near(hp.bound, 300 / 30);
    expect(ref.possible).toBe(true);
    expect(hp.possible).toBe(true);
    // A COP above the refrigerator bound is impossible.
    const bad = checkAgainstCarnot(20, 300, 270, "refrigerator");
    if (!bad.ok) throw new Error("setup");
    expect(bad.possible).toBe(false);
  });

  test("bad arguments are refused", () => {
    expect(checkAgainstCarnot(0, 800, 300, "efficiency").ok).toBe(false);
    expect(checkAgainstCarnot(0.4, 300, 800, "efficiency").ok).toBe(false);
    expect(checkAgainstCarnot(NaN, 800, 300, "efficiency").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("gas property data", () => {
  // These three identities are now EXACT rather than approximate, because R and
  // k are derived from cp and cv instead of being quoted independently. That is
  // what stops the isentropic work integral disagreeing with the internal-energy
  // change and producing an apparent first-law violation.
  test("cp minus cv equals R exactly for every gas", () => {
    for (const g of GASES) {
      expect({ gas: g.id, ok: Math.abs(g.cp - g.cv - g.R) < 1e-12 * g.R }).toEqual({ gas: g.id, ok: true });
    }
  });

  test("k equals cp over cv exactly for every gas", () => {
    for (const g of GASES) {
      expect({ gas: g.id, ok: Math.abs(g.k - g.cp / g.cv) < 1e-12 * g.k }).toEqual({ gas: g.id, ok: true });
    }
  });

  test("cv equals R/(k-1) exactly — the identity the work integral needs", () => {
    for (const g of GASES) {
      expect({ gas: g.id, ok: Math.abs(g.cv - g.R / (g.k - 1)) < 1e-9 * g.cv }).toEqual({ gas: g.id, ok: true });
    }
  });

  // The derived R must still agree with the physically independent route,
  // R = R_universal / M, or the cp and cv in the table are wrong.
  test("the derived R agrees with the universal constant over the molar mass", () => {
    for (const g of GASES) {
      const expected = 8314.462618 / g.M;
      expect({ gas: g.id, ok: Math.abs(g.R - expected) < 0.005 * expected }).toEqual({ gas: g.id, ok: true });
    }
  });

  test("the monatomic gases have k = 5/3", () => {
    for (const id of ["he", "ar"]) {
      const g = GASES.find((x) => x.id === id)!;
      expect(Math.abs(g.k - 5 / 3)).toBeLessThan(0.005);
    }
  });

  test("the diatomic gases have k close to 7/5", () => {
    for (const id of ["n2", "o2", "h2", "co"]) {
      const g = GASES.find((x) => x.id === id)!;
      expect(Math.abs(g.k - 1.4)).toBeLessThan(0.02);
    }
  });
});
