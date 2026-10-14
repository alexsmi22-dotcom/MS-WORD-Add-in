// §D2 of docs/SCOPE-CHEMBIO-BATCH.md — every stoichiometry value verbatim.
// Route 1 = this product's PERIODIC weights; route 2 (RDKit weights) agreed
// to ≤ 0.0002 g on every line (brief).

import { stoichiometry, StoichOk, StoichResult } from "../stoich";

function ok(r: StoichResult): StoichOk {
  if (!r.ok) throw new Error(r.message);
  return r;
}
const prod = (r: StoichOk, s: string) => r.products.find((p) => p.species === s)!;
const reac = (r: StoichOk, s: string) => r.reactants.find((p) => p.species === s)!;

describe("§D2 stoichiometry", () => {
  test("2 H₂ + O₂ → 2 H₂O; 10.0 g + 10.0 g", () => {
    const r = ok(stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "10.0 g" }, { species: "O2", amount: "10.0 g" }] }));
    expect(r.limiting).toEqual(["O₂"]);
    expect(r.extent).toBeCloseTo(0.31252, 5);
    expect(prod(r, "H₂O").mass).toBeCloseTo(11.26, 2);
    expect(reac(r, "H₂").excessMass).toBeCloseTo(8.74, 3);
    expect(r.percentYield).toBeNull();
    expect(r.lines).toContain("Limiting reagent: O₂ (ξ = 0.313 mol).");
    expect(r.chart).toEqual([
      expect.objectContaining({ species: "H₂", limiting: false }),
      expect.objectContaining({ species: "O₂", limiting: true }),
    ]);
  });

  test("Fe₂O₃ + 3 CO → 2 Fe + 3 CO₂; 100 g + 50 g; 55 g Fe → 82.76 %", () => {
    const r = ok(
      stoichiometry({
        reaction: "Fe2O3 + CO -> Fe + CO2",
        amounts: [{ species: "Fe2O3", amount: "100 g" }, { species: "CO", amount: "50 g" }],
        actual: { species: "Fe", amount: "55 g" },
      }),
    );
    expect(r.limiting).toEqual(["CO"]);
    expect(r.extent).toBeCloseTo(0.59503, 5);
    expect(prod(r, "Fe").mass).toBeCloseTo(66.458, 3);
    expect(prod(r, "CO₂").mass).toBeCloseTo(78.559, 3);
    expect(reac(r, "Fe₂O₃").excessMass).toBeCloseTo(4.982, 3);
    expect(r.percentYield!.value).toBeCloseTo(82.76, 2);
  });

  test("aspirin: 2.00 g C₇H₆O₃ + 5.0 mL C₄H₆O₃ at 1.082 g/mL; 2.10 g → 80.50 %", () => {
    const r = ok(
      stoichiometry({
        reaction: "C7H6O3 + C4H6O3 -> C9H8O4 + C2H4O2",
        amounts: [
          { species: "C7H6O3", amount: "2.00 g" },
          { species: "C4H6O3", amount: "5.0 mL", density: "1.082 g/mL" },
        ],
        actual: { species: "C9H8O4", amount: "2.10 g" },
      }),
    );
    expect(r.limiting).toEqual(["C₇H₆O₃"]);
    expect(r.extent).toBeCloseTo(0.01448, 6);
    expect(prod(r, "C₉H₈O₄").mass).toBeCloseTo(2.6087, 4);
    expect(reac(r, "C₄H₆O₃").excessMass).toBeCloseTo(3.932, 3);
    expect(r.percentYield!.value).toBeCloseTo(80.5, 2);
    // By formula alone the aspirin equation has 2 balancings (H:O is 2:1 in every
    // species); the equation as written is one of them and is used, said.
    expect(r.notes.join(" ")).toMatch(/formulas alone allow more than one balancing/);
  });

  test("2 KMnO₄ + 16 HCl …; 5.00 g + 10.0 g", () => {
    const r = ok(
      stoichiometry({
        reaction: "KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O",
        amounts: [{ species: "KMnO4", amount: "5.00 g" }, { species: "HCl", amount: "10.0 g" }],
      }),
    );
    expect(r.limiting).toEqual(["KMnO₄"]);
    expect(prod(r, "Cl₂").mass).toBeCloseTo(5.608, 3);
    expect(reac(r, "HCl").excessMass).toBeCloseTo(0.772, 3);
  });

  test("4 Fe + 3 O₂ → 2 Fe₂O₃; 10.0 L O₂ — 46.875 g (IUPAC) / 47.496 g (1 atm)", () => {
    const base = { reaction: "Fe + O2 -> Fe2O3", amounts: [{ species: "O2", amount: "10.0 L", phase: "gas" as const }] };
    const iupac = ok(stoichiometry({ ...base, gas: "IUPAC-STP" }));
    expect(iupac.limiting).toEqual(["O₂"]);
    expect(prod(iupac, "Fe₂O₃").mass).toBeCloseTo(46.875, 3);
    expect(iupac.notes.join(" ")).toMatch(/No amount was given for Fe; it is assumed to be in excess/);
    expect(reac(iupac, "O₂").how).toMatch(/IUPAC STP \(273\.15 K, 100 kPa\).*22\.711 L\/mol/);
    const atm = ok(stoichiometry({ ...base, gas: "STP-1atm" }));
    expect(prod(atm, "Fe₂O₃").mass).toBeCloseTo(47.496, 3);
    expect(reac(atm, "O₂").how).toMatch(/22\.414 L\/mol/);
    // the same through PV = nRT at a stated T and P
    const tp = ok(stoichiometry({ ...base, gas: { T: "0 °C", P: "100 kPa" } }));
    expect(prod(tp, "Fe₂O₃").mass).toBeCloseTo(46.875, 3);
  });
});

describe("§D2 refusals", () => {
  test("mL without a density", () => {
    const r = stoichiometry({
      reaction: "C7H6O3 + C4H6O3(l) -> C9H8O4 + C2H4O2",
      amounts: [{ species: "C4H6O3(l)", amount: "5.0 mL" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/give its density in g\/mL/);
  });
  test("a gas condition on the request never turns a liquid volume into a gas", () => {
    const r = stoichiometry({
      reaction: "C7H6O3 + C4H6O3 -> C9H8O4 + C2H4O2",
      amounts: [{ species: "C7H6O3", amount: "2.00 g" }, { species: "C4H6O3", amount: "5.0 mL" }],
      gas: "IUPAC-STP",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/is it a liquid, a solution or a gas\? Give its density/);
  });
  test("a gas volume with no conditions, or bare STP, names both standards", () => {
    for (const gas of [undefined, "STP"]) {
      const r = stoichiometry({ reaction: "Fe + O2(g) -> Fe2O3", amounts: [{ species: "O2", amount: "10.0 L" }], gas });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(/22\.711 L\/mol/);
        expect(r.message).toMatch(/22\.414 L\/mol/);
      }
    }
  });
  test("a reaction that fails to balance", () => {
    const r = stoichiometry({ reaction: "C + O2 -> CO + CO2", amounts: [{ species: "C", amount: "1 g" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/must balance first.*independent balancings/);
  });
  test("an amount given for a product", () => {
    const r = stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2O", amount: "1 g" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/is a product/);
  });
  test.each(["0 g", "-1 g", "0 mol"])("zero or negative amount: %s", (amount) => {
    const r = stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/must be positive/);
  });
  test("a bare number is not an amount; an unknown unit is named", () => {
    expect(stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "4" }] }).ok).toBe(false);
    const r = stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "4 furlongs" }] });
    expect(r.ok).toBe(false);
  });
  test("a species not in the reaction", () => {
    const r = stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "N2", amount: "4 g" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/N₂ is not in this reaction/);
  });
  test("half-reactions with free electrons", () => {
    const r = stoichiometry({ reaction: "Fe^3+ + e- -> Fe^2+", amounts: [{ species: "Fe3+", amount: "1 mol" }] });
    expect(r.ok).toBe(false);
  });
});

describe("more stoichiometry", () => {
  test("solution volume × molarity (with units through convert)", () => {
    const r = ok(
      stoichiometry({
        reaction: "HCl + NaOH -> NaCl + H2O",
        amounts: [
          { species: "HCl", amount: "25.0 mL", molarity: "0.100 M" },
          { species: "NaOH", amount: "20.0 mL", molarity: "100. mM" },
        ],
      }),
    );
    expect(r.limiting).toEqual(["NaOH"]);
    expect(reac(r, "HCl").moles).toBeCloseTo(0.0025, 10);
    expect(reac(r, "HCl").excessMoles).toBeCloseTo(0.0005, 10);
    expect(prod(r, "NaCl").mass).toBeCloseTo(0.002 * 58.44, 4);
  });
  test("a tie names both: 2 H₂ + O₂ with 4.032 g + 31.998 g", () => {
    const r = ok(stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "4.032 g" }, { species: "O2", amount: "31.998 g" }] }));
    expect(r.limiting).toEqual(["H₂", "O₂"]);
    expect(r.lines.join("\n")).toMatch(/H₂ and O₂ are both exhausted/);
  });
  test("mmol and mg convert", () => {
    const r = ok(stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "2 mmol" }, { species: "O2", amount: "1000 mg" }] }));
    expect(r.limiting).toEqual(["H₂"]);
    expect(prod(r, "H₂O").moles).toBeCloseTo(0.002, 10);
  });
  test("gas at stated T and P (25 °C, 1 atm, torr)", () => {
    const r = ok(stoichiometry({ reaction: "Fe + O2 -> Fe2O3", amounts: [{ species: "O2", amount: "24.465 L", phase: "gas" }], gas: { T: "298.15 K", P: "760 torr" } }));
    expect(reac(r, "O₂").moles).toBeCloseTo(1.0, 3);
  });
  test("percent yield above 100 % is a caveat, not a refusal", () => {
    const r = ok(stoichiometry({ reaction: "H2 + O2 -> H2O", amounts: [{ species: "H2", amount: "2.016 g" }], actual: { species: "H2O", amount: "20.0 g" } }));
    expect(r.percentYield!.value).toBeGreaterThan(100);
    expect(r.percentYield!.caveat).toMatch(/above 100 %/);
  });
  test("an unbalanced typed equation is balanced first and said", () => {
    const r = ok(stoichiometry({ reaction: "H2 + O2 -> 2 H2O", amounts: [{ species: "H2", amount: "1 mol" }] }));
    expect(r.equation).toBe("2 H₂ + O₂ → 2 H₂O");
    expect(r.notes.join(" ")).toMatch(/As written it is NOT balanced/);
  });
  test("species matched by any spelling (typeset, state)", () => {
    const r = ok(stoichiometry({ reaction: "H2(g) + O2(g) -> H2O(l)", amounts: [{ species: "H₂", amount: "1 mol" }], gas: "IUPAC-STP" }));
    expect(r.limiting).toEqual(["H₂(g)"]);
  });
});
