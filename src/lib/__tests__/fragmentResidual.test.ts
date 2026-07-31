// Neutral-loss fragments must report a REAL formula, not a bracket description.
//
// Reported from the pane: aspirin's EI fragmentation listed "[M-H2O]" and
// "[M-CO2]" in a formula column where every other row held a proper formula. The
// code's own comment said it rebuilt the residual formula by subtracting the lost
// atoms; it did not.

import { predictFragments } from "../fragment";

describe("neutral-loss fragments carry a real molecular formula", () => {
  test("aspirin: water and CO2 losses subtract from C9H8O4", () => {
    const r = predictFragments("aspirin")!;
    expect(r.formula).toBe("C9H8O4");

    const water = r.fragments.find((f) => f.neutralLoss === "H2O");
    expect(water).toBeDefined();
    // C9H8O4 - H2O = C9H6O3.
    expect(water!.formula).toBe("C9H6O3");

    const co2 = r.fragments.find((f) => f.neutralLoss === "CO2");
    expect(co2).toBeDefined();
    // C9H8O4 - CO2 = C8H8O2.
    expect(co2!.formula).toBe("C8H8O2");
  });

  test("no fragment reports a bracket pseudo-formula for a parseable loss", () => {
    for (const name of ["aspirin", "paracetamol", "caffeine", "ibuprofen", "benzoic acid"]) {
      const r = predictFragments(name);
      if (!r) continue;
      for (const f of r.fragments) {
        // Any bracket left over must be a loss this parser genuinely cannot handle.
        if (f.formula.startsWith("[")) {
          expect(f.neutralLoss).not.toMatch(/^[A-Z][a-z]?\d*([A-Z][a-z]?\d*)*$/);
        }
      }
    }
  });

  test("the ENGINE emits plain ASCII; the PANE is what adds the sub/superscripts", () => {
    // This assertion previously said the formula must never be subscripted, which
    // encoded my MISREADING of the first report — "list as plain text, i.e. H2O"
    // meant the formula should be a plain formula rather than a "[M-H2O]"
    // placeholder, not that it should stay unformatted. The engine is still plain
    // ASCII, which is correct for a data layer, but the INSERT now runs it through
    // parseChemical/segmentsToHtml so Word receives real <sub> markup.
    // See msFormulaFormatting.test.ts for that half.
    const r = predictFragments("aspirin")!;
    for (const f of r.fragments) {
      expect(f.formula).toMatch(/^[A-Za-z0-9[\]\-+•]+$/);
    }
  });

  test("the residual formula's mass is consistent with the reported m/z", () => {
    const r = predictFragments("aspirin")!;
    const water = r.fragments.find((f) => f.neutralLoss === "H2O")!;
    // m/z is the molecular ion minus the loss mass; check it lines up with the
    // molecular ion rather than being computed from an unrelated path.
    expect(r.molecularIon - water.mz).toBeCloseTo(water.lossMass, 6);
  });

  test("a loss bigger than the molecule keeps the bracket rather than going negative", () => {
    // Methanol cannot lose CO2; if such a rule ever fires, the formula must not
    // come back as a negative-count nonsense string.
    const r = predictFragments("methanol");
    if (r) {
      for (const f of r.fragments) expect(f.formula).not.toMatch(/-\d/);
    }
  });
});
