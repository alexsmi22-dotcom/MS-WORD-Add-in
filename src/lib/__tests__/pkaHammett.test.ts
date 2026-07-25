// Validation gate for the substituent-corrected pKa (Hammett for aromatics,
// inductive for aliphatic acids). Each case is checked against the EXPERIMENTAL
// literature pKa — this is what makes the estimate trustworthy: the correction is
// held to real numbers, not just asserted to run.

import { predictPka } from "../pka";

/** pKa of the first site matching `re` for the given input. */
function pka(input: string, re: RegExp): number {
  const r = predictPka(input);
  const s = r?.sites.find((x) => re.test(x.group));
  if (!s) throw new Error(`no site matching ${re} for ${input}`);
  return s.pka;
}

describe("aromatic acids/bases match literature via Hammett (within ±0.5)", () => {
  // [name, SMILES, group regex, experimental pKa]
  const cases: [string, string, RegExp, number][] = [
    ["benzoic acid", "OC(=O)c1ccccc1", /Benzoic/, 4.2],
    ["p-nitrobenzoic acid", "OC(=O)c1ccc([N+](=O)[O-])cc1", /Benzoic/, 3.44],
    ["p-methoxybenzoic acid", "OC(=O)c1ccc(OC)cc1", /Benzoic/, 4.47],
    ["phenol", "Oc1ccccc1", /Phenol/, 9.99],
    ["p-nitrophenol", "Oc1ccc([N+](=O)[O-])cc1", /Phenol/, 7.15],
    ["p-cresol", "Cc1ccc(O)cc1", /Phenol/, 10.26],
    ["p-chlorophenol", "Oc1ccc(Cl)cc1", /Phenol/, 9.38],
    ["3,5-dinitrophenol", "Oc1cc([N+](=O)[O-])cc([N+](=O)[O-])c1", /Phenol/, 6.7],
    ["aniline (pKaH)", "Nc1ccccc1", /Aniline/, 4.6],
    ["p-nitroaniline (pKaH)", "Nc1ccc([N+](=O)[O-])cc1", /Aniline/, 1.0],
    ["p-toluidine (pKaH)", "Nc1ccc(C)cc1", /Aniline/, 5.08],
  ];
  for (const [name, smi, re, lit] of cases) {
    it(`${name} ≈ ${lit}`, () => {
      expect(Math.abs(pka(smi, re) - lit)).toBeLessThan(0.5);
    });
  }
});

describe("aliphatic acids: α-inductive correction matches literature", () => {
  const cases: [string, string, number][] = [
    ["acetic acid", "CC(=O)O", 4.76],
    ["chloroacetic acid", "OC(=O)CCl", 2.87],
    ["dichloroacetic acid", "OC(=O)C(Cl)Cl", 1.29],
    ["glycolic acid", "OC(=O)CO", 3.83],
    ["fluoroacetic acid", "OC(=O)CF", 2.59],
  ];
  for (const [name, smi, lit] of cases) {
    it(`${name} ≈ ${lit}`, () => {
      expect(Math.abs(pka(smi, /Carboxylic/) - lit)).toBeLessThan(0.6);
    });
  }
});

describe("the correction is shown, and hard cases stay honest", () => {
  it("reports the derivation (parent + Hammett term) in the note", () => {
    const r = predictPka("Oc1ccc([N+](=O)[O-])cc1")!; // p-nitrophenol
    const s = r.sites.find((x) => /Phenol/.test(x.group))!;
    expect(s.note).toMatch(/parent 9\.99/);
    expect(s.note).toMatch(/Hammett/);
    expect(s.note).toMatch(/NO2 para/);
  });
  it("net charge of p-nitrophenol at pH 7.4 is clearly negative (mostly ionised)", () => {
    // pKa ~7.15 < 7.4, so it should be >50% deprotonated → net < -0.5
    expect(predictPka("Oc1ccc([N+](=O)[O-])cc1")!.netChargeAt74).toBeLessThan(-0.5);
  });
  it("bare benzoic acid gets no correction term", () => {
    const s = predictPka("OC(=O)c1ccccc1")!.sites.find((x) => /Benzoic/.test(x.group))!;
    expect(s.pka).toBeCloseTo(4.2, 1);
    expect(s.note).toMatch(/no meta\/para substituents/);
  });
});
