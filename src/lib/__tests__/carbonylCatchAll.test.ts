// carbonylKind must not use "ketone" as a dumping ground.
//
// WHY THIS EXISTS (punch list #3)
// The arginine pKa bug was a MISSING GROUP CLASS SILENTLY ROUTED TO A CATCH-ALL
// BRANCH WITH A PLAUSIBLE LABEL ATTACHED. #3 asked whether that shape survived
// elsewhere. It did — carbonylKind ended in a bare `return "ketone"`, and everything
// the branches above failed to recognise landed there, then received a ketone's
// 1715 cm-1 IR band and 205 ppm 13C shift:
//
//   O=C=O      carbon dioxide  -> real IR 2349 cm-1 (off by 634), real 13C ~125 (off by 80)
//   CN=C=O     isocyanate      -> real N=C=O stretch ~2270 cm-1
//   CC(=O)SC   thioester       -> real C=O ~1690 cm-1, 13C ~193
//   O=C=C=C=O  carbon suboxide -> reported as TWO ketones
//
// carbon dioxide is in compounds.json under BOTH "carbon dioxide" and the formula
// "CO2", so this was reachable by typing "CO2" into Spectra.
//
// The fix is not only new classes; it is that the catch-all is gone. A carbonyl the
// function cannot positively name now returns null and gets NO predicted band,
// because a wrong band is worse than no band: an absent prediction is visible, a
// confident wrong one is not.

import { Molecule } from "openchemlib";
import { carbonylKind, CarbonylKind } from "../molgraph";
import { predictIr } from "../ir";

/** Every carbonyl classification in a SMILES, in atom order. */
function kinds(smiles: string): (CarbonylKind | null)[] {
  const m = Molecule.fromSmiles(smiles);
  m.ensureHelperArrays(Molecule.cHelperRings);
  const out: CarbonylKind[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const k = carbonylKind(m, a);
    if (k) out.push(k);
  }
  return out;
}

describe("the classes that were being called ketones", () => {
  test("a thioester is a thioester — every acyl-CoA in metabolism is one", () => {
    expect(kinds("CC(=O)SC")).toEqual(["thioester"]);
    expect(kinds("CC(=O)SCCN")).toEqual(["thioester"]); // acetyl-CoA thioester core
  });

  test("an isocyanate is an isocyanate", () => {
    expect(kinds("CN=C=O")).toEqual(["isocyanate"]);
    expect(kinds("O=C=Nc1ccccc1")).toEqual(["isocyanate"]); // phenyl isocyanate
  });

  test("carbon dioxide is NOT a ketone and gets no acyl band", () => {
    // The headline case: reachable from the dictionary by typing "CO2".
    expect(kinds("O=C=O")).toEqual([]);
  });

  test("carbon suboxide is not two ketones", () => {
    expect(kinds("O=C=C=C=O")).toEqual([]);
  });

  test("a ketene is not a ketone", () => {
    expect(kinds("C=C=O")).toEqual([]);
  });

  test("acyl silanes and selenoesters get no name rather than a wrong one", () => {
    expect(kinds("CC(=O)[SiH3]")).toEqual([]);
    expect(kinds("CC(=O)[Se]C")).toEqual([]);
  });
});

describe("the real classes still classify correctly — no regression", () => {
  test.each<[string, string, CarbonylKind]>([
    ["acetone", "CC(C)=O", "ketone"],
    ["cyclohexanone", "O=C1CCCCC1", "ketone"],
    ["acetophenone", "CC(=O)c1ccccc1", "ketone"],
    ["acetaldehyde", "CC=O", "aldehyde"],
    ["formaldehyde", "C=O", "aldehyde"],
    ["acetic acid", "CC(=O)O", "acid"],
    ["ethyl acetate", "CC(=O)OCC", "ester"],
    ["acetamide", "CC(=O)N", "amide"],
    ["acetyl chloride", "CC(=O)Cl", "acidHalide"],
    ["urea", "NC(=O)N", "urea"],
    ["dimethyl carbonate", "COC(=O)OC", "carbonate"],
    ["methyl carbamate", "COC(=O)N", "carbamate"],
    ["acetic anhydride", "CC(=O)OC(C)=O", "anhydride"],
  ])("%s -> %s", (_label, smiles, expected) => {
    expect(kinds(smiles)).toContain(expected);
  });

  test("aspirin still reads as an ester plus an acid", () => {
    const k = kinds("CC(=O)Oc1ccccc1C(=O)O");
    expect(k).toContain("ester");
    expect(k).toContain("acid");
    expect(k).not.toContain("ketone");
  });
});

describe("the predicted IR reflects the fix, in the numbers a user sees", () => {
  const band = (smiles: string, match: RegExp) =>
    predictIr(smiles)?.bands.find((b) => match.test(b.assignment));

  test("a thioester's C=O is predicted BELOW the ketone range, where it belongs", () => {
    const b = band("CC(=O)SC", /thioester/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(1690);
    // The old answer was 1715 — inside the ketone range [1705,1725] and OUTSIDE
    // any thioester range. That is the whole defect in one number.
    expect(b!.wavenumber).toBeLessThan(1705);
  });

  test("an isocyanate is predicted near 2270, not 1715", () => {
    const b = band("CN=C=O", /isocyanate/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(2270);
  });

  test("carbon dioxide gets NO ketone band — the honest outcome", () => {
    const ir = predictIr("carbon dioxide");
    expect(ir).not.toBeNull();
    const text = ir!.bands.map((b) => b.assignment).join(" ");
    expect(text).not.toMatch(/ketone/i);
    // Reachable the way a user reaches it.
    expect(predictIr("CO2")!.bands.map((b) => b.assignment).join(" ")).not.toMatch(/ketone/i);
  });

  test("acetone still gets its ketone band — the fix did not gut real chemistry", () => {
    const b = band("CC(C)=O", /ketone/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(1715);
  });
});
