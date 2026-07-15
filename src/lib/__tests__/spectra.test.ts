// IR, UV-Vis and MS-fragmentation prediction tests.
//
// As with nmr.test.ts, these pin the predictors to REAL published values and to
// the honesty guarantees (no fabricated numbers when a model is out of domain).

import { predictIr, irTransmittanceCurve } from "../ir";
import { predictUvVis } from "../uvvis";
import { predictFragments } from "../fragment";

// ---------------------------------------------------------------------------
// IR
// ---------------------------------------------------------------------------
describe("IR group frequencies vs literature", () => {
  function bandNear(smiles: string, wn: number, tol = 30): boolean {
    const r = predictIr(smiles)!;
    return r.bands.some((b) => Math.abs(b.wavenumber - wn) <= tol);
  }

  test("acetone C=O at ~1715", () => expect(bandNear("CC(C)=O", 1715, 15)).toBe(true));
  test("ethyl acetate ester C=O at ~1740", () => expect(bandNear("CC(=O)OCC", 1740, 15)).toBe(true));
  test("acetic acid C=O at ~1710", () => expect(bandNear("CC(=O)O", 1710, 15)).toBe(true));
  test("acetamide amide C=O at ~1660", () => expect(bandNear("CC(N)=O", 1660, 30)).toBe(true));
  test("acetonitrile C≡N at ~2250", () => expect(bandNear("CC#N", 2250, 20)).toBe(true));
  test("ethanol broad O-H at ~3350", () => expect(bandNear("CCO", 3350, 60)).toBe(true));
  test("terminal alkyne ≡C-H at ~3300", () => expect(bandNear("C#CC", 3300, 40)).toBe(true));
  test("nitrobenzene NO2 bands at ~1530 and ~1350", () => {
    expect(bandNear("O=[N+]([O-])c1ccccc1", 1530, 40)).toBe(true);
    expect(bandNear("O=[N+]([O-])c1ccccc1", 1350, 50)).toBe(true);
  });

  test("carbonyl classes are ordered correctly: ester > ketone > amide", () => {
    const co = (smi: string) => predictIr(smi)!.bands.find((b) => b.assignment.startsWith("C=O"))!.wavenumber;
    expect(co("CC(=O)OCC")).toBeGreaterThan(co("CC(C)=O")); // ester above ketone
    expect(co("CC(C)=O")).toBeGreaterThan(co("CC(N)=O")); // ketone above amide
  });

  test("conjugation lowers C=O: acetophenone below acetone", () => {
    const acetone = predictIr("CC(C)=O")!.bands.find((b) => b.assignment.startsWith("C=O"))!;
    const acetophenone = predictIr("CC(=O)c1ccccc1")!.bands.find((b) => b.assignment.startsWith("C=O"))!;
    expect(acetophenone.wavenumber).toBeLessThan(acetone.wavenumber);
    expect(acetophenone.assignment).toMatch(/conjugated/);
  });

  test("carboxylic acid O-H is reported broad and distinct from an alcohol O-H", () => {
    const acid = predictIr("CC(=O)O")!.bands.find((b) => b.assignment.includes("carboxylic acid, very broad"))!;
    expect(acid).toBeDefined();
    expect(acid.broad).toBe(true);
    expect(acid.range[0]).toBeLessThanOrEqual(2500);
  });

  test("an alkane has no C=O and no O-H invented for it", () => {
    const r = predictIr("CCCC")!;
    expect(r.bands.some((b) => b.assignment.includes("C=O"))).toBe(false);
    expect(r.bands.some((b) => b.assignment.includes("O-H"))).toBe(false);
    expect(r.bands.some((b) => b.assignment.includes("C-H stretch (alkyl)"))).toBe(true);
  });

  test("bands are sorted high → low wavenumber, as IR is plotted", () => {
    const r = predictIr("CC(=O)Oc1ccccc1C(=O)O")!;
    const wns = r.bands.map((b) => b.wavenumber);
    expect(wns).toEqual([...wns].sort((a, b) => b - a));
  });

  test("the fingerprint-region limitation is always disclosed", () => {
    expect(predictIr("CCCC")!.caveats.join(" ")).toMatch(/fingerprint/i);
  });

  test("unresolvable input returns null", () => {
    expect(predictIr("!!!not-a-molecule")).toBeNull();
  });

  test("transmittance curve dips at each predicted band and stays in 0-100%", () => {
    const r = predictIr("CC(C)=O")!;
    const curve = irTransmittanceCurve(r.bands);
    expect(curve.length).toBeGreaterThan(100);
    for (const p of curve) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The C=O band must be a local minimum in transmittance.
    const at1715 = curve.reduce((b, p) => (Math.abs(p.x - 1715) < Math.abs(b.x - 1715) ? p : b));
    const at1900 = curve.reduce((b, p) => (Math.abs(p.x - 1900) < Math.abs(b.x - 1900) ? p : b));
    expect(at1715.y).toBeLessThan(at1900.y);
  });
});

// ---------------------------------------------------------------------------
// UV-Vis
// ---------------------------------------------------------------------------
describe("UV-Vis Woodward-Fieser", () => {
  test("1,3-butadiene ~214-217 nm", () => {
    const r = predictUvVis("C=CC=C")!;
    expect(r.lambdaMax).not.toBeNull();
    expect(Math.abs(r.lambdaMax! - 217)).toBeLessThanOrEqual(6);
  });

  test("mesityl oxide ~237 nm (base 215 + two β-alkyl)", () => {
    const r = predictUvVis("CC(=O)C=C(C)C")!;
    expect(Math.abs(r.lambdaMax! - 237)).toBeLessThanOrEqual(5);
  });

  test("methyl vinyl ketone ~215 nm", () => {
    const r = predictUvVis("CC(=O)C=C")!;
    expect(Math.abs(r.lambdaMax! - 215)).toBeLessThanOrEqual(8);
  });

  test("extended conjugation adds 30 nm per unit", () => {
    const diene = predictUvVis("C=CC=C")!.lambdaMax!;
    const triene = predictUvVis("C=CC=CC=C")!.lambdaMax!;
    expect(triene - diene).toBe(30);
  });

  test("an unconjugated alkane is transparent — no λmax is invented", () => {
    const r = predictUvVis("CCCC")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.transparent).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/below ~200 nm|vacuum UV/i);
  });

  test("an isolated alkene is not treated as a diene", () => {
    const r = predictUvVis("CCC=C")!;
    expect(r.transparent).toBe(true);
  });

  test("benzene is reported from tabulated benzenoid bands, not Woodward-Fieser", () => {
    const r = predictUvVis("c1ccccc1")!;
    expect(r.lambdaMax).toBe(254);
    expect(r.chromophore).toMatch(/benzene/i);
    expect(r.caveats.join(" ")).toMatch(/not Woodward-Fieser/i);
  });

  test("isolated carbonyl reports only the weak n→π* band, flagged as weak", () => {
    const r = predictUvVis("CC(C)=O")!;
    expect(r.lambdaMax).toBe(280);
    expect(r.caveats.join(" ")).toMatch(/weak/i);
  });

  test("contributions are auditable and sum to the reported λmax", () => {
    const r = predictUvVis("CC(=O)C=C(C)C")!;
    const sum = r.contributions.reduce((s, c) => s + c.nm, 0);
    expect(sum).toBe(r.lambdaMax);
  });

  test("unresolvable input returns null", () => {
    expect(predictUvVis("!!!nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MS fragmentation
// ---------------------------------------------------------------------------
describe("EI fragmentation vs known base peaks", () => {
  /** The highest-likelihood fragments, as exact m/z. */
  function highMz(smiles: string): number[] {
    return predictFragments(smiles)!
      .fragments.filter((f) => f.likelihood === "high")
      .map((f) => f.mz);
  }
  const hasMz = (list: number[], mz: number, tol = 0.01) => list.some((m) => Math.abs(m - mz) <= tol);

  test("toluene: tropylium m/z 91 is predicted and ranked high (its real base peak)", () => {
    expect(hasMz(highMz("Cc1ccccc1"), 91.0542)).toBe(true);
  });

  test("toluene: phenyl m/z 77 is present but NOT ranked high", () => {
    const r = predictFragments("Cc1ccccc1")!;
    const phenyl = r.fragments.find((f) => Math.abs(f.mz - 77.0386) < 0.01)!;
    expect(phenyl).toBeDefined();
    expect(phenyl.likelihood).not.toBe("high");
    // It must not be mislabelled as tropylium — that was a real bug once.
    expect(phenyl.pathway).not.toMatch(/tropylium/i);
  });

  test("ethylbenzene: benzylic cleavage to m/z 91 (its real base peak)", () => {
    expect(hasMz(highMz("CCc1ccccc1"), 91.0542)).toBe(true);
  });

  test("ethanol: α-cleavage to m/z 31 (its real base peak)", () => {
    expect(hasMz(highMz("CCO"), 31.0178)).toBe(true);
  });

  test("ethanol: no bare HO+ cation is invented", () => {
    const r = predictFragments("CCO")!;
    expect(r.fragments.some((f) => Math.abs(f.mz - 17.0022) < 0.01)).toBe(false);
  });

  test("butylamine: α-cleavage to iminium m/z 30 (its real base peak)", () => {
    expect(hasMz(highMz("CCCCN"), 30.0338)).toBe(true);
  });

  test("2-pentanone: acylium m/z 43 and McLafferty m/z 58 both predicted", () => {
    const high = highMz("CCCC(=O)C");
    expect(hasMz(high, 43.0178)).toBe(true); // CH3CO+
    expect(hasMz(high, 58.0413)).toBe(true); // McLafferty enol ion
  });

  test("McLafferty requires a γ-hydrogen — 3-pentanone has none, so none is claimed", () => {
    const r = predictFragments("CCC(=O)CC")!;
    expect(r.fragments.some((f) => f.pathway.includes("McLafferty"))).toBe(false);
  });

  test("molecular ion is the exact monoisotopic mass less one electron", () => {
    // Toluene C7H8 monoisotopic = 92.0626; M+• loses one electron.
    const r = predictFragments("Cc1ccccc1")!;
    expect(r.molecularIon).toBeCloseTo(92.0626 - 0.00054858, 3);
  });

  test("fragment m/z agrees with the massspec module's exact-mass scale", () => {
    // Both modules must place the molecular ion identically, or a user comparing
    // the MS readout with the fragment list would see two different masses.
    const r = predictFragments("CC(=O)Oc1ccccc1C(=O)O")!;
    expect(r.formula).toBe("C9H8O4");
    expect(r.molecularIon).toBeCloseTo(180.0423 - 0.00054858, 2);
  });

  test("neutral losses are only claimed when the enabling group is present", () => {
    // No OH → no dehydration.
    const alkane = predictFragments("CCCC")!;
    expect(alkane.fragments.some((f) => f.neutralLoss === "H2O")).toBe(false);
    // OH present → dehydration predicted.
    const alcohol = predictFragments("CCCCO")!;
    expect(alcohol.fragments.some((f) => f.neutralLoss === "H2O")).toBe(true);
    // No COOH → no decarboxylation.
    expect(alcohol.fragments.some((f) => f.neutralLoss === "CO2")).toBe(false);
    // COOH present → decarboxylation predicted.
    const acid = predictFragments("CCC(=O)O")!;
    expect(acid.fragments.some((f) => f.neutralLoss === "CO2")).toBe(true);
  });

  test("every fragment is lighter than the molecular ion", () => {
    for (const smi of ["Cc1ccccc1", "CCCC(=O)C", "CCO", "CCCCN", "CC(=O)Oc1ccccc1C(=O)O"]) {
      const r = predictFragments(smi)!;
      for (const f of r.fragments) {
        expect(f.mz).toBeLessThan(r.molecularIon + 0.001);
        expect(f.mz).toBeGreaterThan(0);
        expect(Number.isFinite(f.mz)).toBe(true);
      }
    }
  });

  test("ring bonds alone do not produce fragments (they need two cleavages)", () => {
    // Cyclohexane: every C-C is in the ring, so no single-bond cleavage applies.
    const r = predictFragments("C1CCCCC1")!;
    expect(r.fragments.every((f) => !f.pathway.includes("simple C-C cleavage"))).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/two bond cleavages/i);
  });

  test("likelihood is disclosed as a ranking, never as an intensity", () => {
    const r = predictFragments("CCO")!;
    expect(r.caveats.join(" ")).toMatch(/not a predicted intensity/i);
  });

  test("fragments are sorted by descending m/z", () => {
    const r = predictFragments("CCCC(=O)C")!;
    const mz = r.fragments.map((f) => f.mz);
    expect(mz).toEqual([...mz].sort((a, b) => b - a));
  });

  test("unresolvable input returns null", () => {
    expect(predictFragments("!!!nope")).toBeNull();
  });
});
