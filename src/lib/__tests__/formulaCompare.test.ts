// Tests for the compound verifier's composition comparison.
//
// This logic decides whether a compound is reported as a WRONG MOLECULE, and it
// shipped untested because it lived inside a top-level script that runs the
// whole verification on import. It is now its own module so it can be checked.
//
// The two directions matter equally: ordering differences must NOT be flagged
// (that was 32 false positives), and genuinely different compositions MUST
// still be flagged (that is the alpha-tocopherol class the check exists for).

import * as path from "path";

type FormulaModule = {
  parseFormula: (f: unknown) => Record<string, number> | null;
  sameComposition: (a: unknown, b: unknown) => boolean;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod: FormulaModule = require(path.join(__dirname, "..", "..", "..", "scripts", "formula-compare.cjs"));

describe("parseFormula", () => {
  test("counts elements regardless of order", () => {
    expect(mod.parseFormula("H2O")).toEqual({ H: 2, O: 1 });
    expect(mod.parseFormula("NH3")).toEqual({ N: 1, H: 3 });
    expect(mod.parseFormula("H3N")).toEqual({ H: 3, N: 1 });
  });

  test("two-letter elements are not split into two one-letter ones", () => {
    // "Na" must not become N + a, and "Fe" must not become F + e.
    expect(mod.parseFormula("NaCl")).toEqual({ Na: 1, Cl: 1 });
    expect(mod.parseFormula("C34H32FeN4O4")).toEqual({ C: 34, H: 32, Fe: 1, N: 4, O: 4 });
  });

  test("a repeated element accumulates rather than overwriting", () => {
    expect(mod.parseFormula("CH3CH3")).toEqual({ C: 2, H: 6 });
  });

  test("charge suffixes are stripped, not treated as composition", () => {
    expect(mod.parseFormula("NaO4P-2")).toEqual({ Na: 1, O: 4, P: 1 });
    expect(mod.parseFormula("NH4+")).toEqual({ N: 1, H: 4 });
  });

  test("non-formulas return null rather than a partial guess", () => {
    for (const bad of ["", "  ", "not a formula", "H2O!", "2H", "cO", null, undefined]) {
      expect({ input: String(bad), parsed: mod.parseFormula(bad) }).toEqual({
        input: String(bad),
        parsed: null,
      });
    }
  });
});

describe("sameComposition — ordering must not matter", () => {
  const equivalent: [string, string][] = [
    ["NH3", "H3N"],
    ["NaCl", "ClNa"],
    ["H2SO4", "H2O4S"],
    ["C34H32N4O4Fe", "C34H32FeN4O4"], // heme, reported as a wrong molecule
    ["OCa", "CaO"],
    ["CH2O3", "H2CO3"],
  ];
  for (const [a, b] of equivalent) {
    test(`${a} === ${b}`, () => {
      expect({ pair: `${a}/${b}`, same: mod.sameComposition(a, b) }).toEqual({
        pair: `${a}/${b}`,
        same: true,
      });
    });
  }
});

describe("sameComposition — real differences must STILL be caught", () => {
  const different: [string, string][] = [
    ["C29H50O2", "C28H48O2"], // alpha-tocopherol vs the beta/gamma vitamer actually shipped
    ["MgSO4", "MgSO4H14O7"], // anhydrous vs the epsom-salt heptahydrate
    ["C8H11NO3", "C8H10NO5P"], // pyridoxine vs pyridoxal phosphate
    ["O3Fe2", "FeO2"], // Fe2O3 vs FeO2
    ["H2O", "H2O2"], // one atom apart
    ["CO", "Co"], // carbon monoxide vs cobalt — case is load-bearing
  ];
  for (const [a, b] of different) {
    test(`${a} !== ${b}`, () => {
      expect({ pair: `${a}/${b}`, same: mod.sameComposition(a, b) }).toEqual({
        pair: `${a}/${b}`,
        same: false,
      });
    });
  }

  test("an unparseable side is never a match", () => {
    // Treating "could not read this" as agreement is how a check goes quiet.
    expect(mod.sameComposition("H2O", null)).toBe(false);
    expect(mod.sameComposition(null, null)).toBe(false);
    expect(mod.sameComposition("H2O", "nonsense here")).toBe(false);
  });

  // Promoted from the adversarial probe. These are not inputs a real formula
  // produces; they are ways to make the comparison say "same" when it is not.
  test("a count too long to hold precisely is refused, not collapsed", () => {
    // 300 digits parses to 1.11e299, and so does a DIFFERENT 300-digit count —
    // so without this both would compare equal.
    const a = "C" + "1".repeat(300);
    const b = "C" + "2".repeat(300);
    expect(mod.parseFormula(a)).toBeNull();
    expect(mod.sameComposition(a, b)).toBe(false);
    // A realistic large molecule still parses; the bound is nowhere near it.
    expect(mod.parseFormula("C169719H270466N45688O52238S911")).not.toBeNull();
  });

  test("a homoglyph cannot pass as an element", () => {
    // Cyrillic С (U+0421) is not Latin C. Accepting it would let two visually
    // identical formulas differ, or worse, compare equal by accident.
    expect(mod.parseFormula("СO")).toBeNull();
    expect(mod.sameComposition("СO", "CO")).toBe(false);
  });

  test("a long formula parses in linear time", () => {
    const big = Array.from({ length: 5000 }, (_, i) => "C" + ((i % 9) + 1)).join("");
    const started = Date.now();
    expect(mod.parseFormula(big)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("comparison is reflexive and symmetric", () => {
    expect(mod.sameComposition("C6H12O6", "C6H12O6")).toBe(true);
    expect(mod.sameComposition("C6H12O6", "O6C6H12")).toBe(true);
    expect(mod.sameComposition("O6C6H12", "C6H12O6")).toBe(true);
  });
});
