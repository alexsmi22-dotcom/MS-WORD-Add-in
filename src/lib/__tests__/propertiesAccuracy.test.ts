// Substantiates the error figures that properties.ts quotes to the user.
//
// WHY THIS EXISTS
// properties.ts tells the user "cLogP RMSE 0.42, worst case 0.97". A claim like
// that is worthless unless something checks it — otherwise it is folklore with a
// decimal point, which is worse than no number at all because it sounds measured.
// This file measures it against tabulated experimental values and fails if either
// the claim or the underlying OpenChemLib model drifts out from under it.
//
// The reference values are standard tabulated octanol/water logP and aqueous
// logS figures. They are literature values, not JurisLab outputs, so this is a
// genuine external check — but they are hand-curated, and a wrong entry here would
// misstate the error rather than cause a false pass. Treat the set as the thing to
// grow when a property claim needs to be tightened.

import { Molecule, MoleculeProperties } from "openchemlib";
import { computeProperties } from "../properties";

/** [name, SMILES, experimental logP] */
const EXP_LOGP: [string, string, number][] = [
  ["benzene", "c1ccccc1", 2.13],
  ["toluene", "Cc1ccccc1", 2.73],
  ["ethanol", "CCO", -0.31],
  ["methanol", "CO", -0.77],
  ["phenol", "Oc1ccccc1", 1.46],
  ["aniline", "Nc1ccccc1", 0.9],
  ["chlorobenzene", "Clc1ccccc1", 2.84],
  ["naphthalene", "c1ccc2ccccc2c1", 3.3],
  ["anthracene", "c1ccc2cc3ccccc3cc2c1", 4.45],
  ["aspirin", "CC(=O)Oc1ccccc1C(=O)O", 1.19],
  ["caffeine", "Cn1cnc2c1c(=O)n(C)c(=O)n2C", -0.07],
  ["acetaminophen", "CC(=O)Nc1ccc(O)cc1", 0.46],
  ["ibuprofen", "CC(C)Cc1ccc(cc1)C(C)C(=O)O", 3.97],
  ["naproxen", "COc1ccc2cc(ccc2c1)C(C)C(=O)O", 3.18],
  ["diazepam", "CN1c2ccc(Cl)cc2C(=NCC1=O)c1ccccc1", 2.82],
  ["nicotine", "CN1CCCC1c1cccnc1", 1.17],
  ["acetic acid", "CC(=O)O", -0.17],
  ["diethyl ether", "CCOCC", 0.89],
  ["chloroform", "ClC(Cl)Cl", 1.97],
  ["testosterone", "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O", 3.32],
];

/** [name, SMILES, experimental logS (log mol/L)] */
const EXP_LOGS: [string, string, number][] = [
  ["benzene", "c1ccccc1", -1.64],
  ["toluene", "Cc1ccccc1", -2.21],
  ["naphthalene", "c1ccc2ccccc2c1", -3.6],
  ["anthracene", "c1ccc2cc3ccccc3cc2c1", -6.35],
  ["phenol", "Oc1ccccc1", -0.04],
  ["aspirin", "CC(=O)Oc1ccccc1C(=O)O", -1.72],
  ["caffeine", "Cn1cnc2c1c(=O)n(C)c(=O)n2C", -0.88],
  ["acetaminophen", "CC(=O)Nc1ccc(O)cc1", -1.03],
  ["ibuprofen", "CC(C)Cc1ccc(cc1)C(C)C(=O)O", -3.62],
  ["testosterone", "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O", -4.02],
];

const stats = (rows: [string, string, number][], get: (p: MoleculeProperties) => number) => {
  const errs = rows.map(([, smi, exp]) => get(new MoleculeProperties(Molecule.fromSmiles(smi))) - exp);
  const abs = errs.map(Math.abs);
  return {
    mae: abs.reduce((a, b) => a + b, 0) / abs.length,
    rmse: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length),
    max: Math.max(...abs),
    n: errs.length,
  };
};

describe("the cLogP error we advertise is the error we have", () => {
  test("cLogP RMSE and worst case match what the caveat claims", () => {
    const s = stats(EXP_LOGP, (p) => p.logP);
    expect(s.n).toBe(20);
    // The caveat says "RMSE 0.42, n=20" and "out by 0.97 at worst". Tight bounds:
    // a drift either way must force the shipped text to be re-examined, not be
    // absorbed silently.
    expect(s.rmse).toBeCloseTo(0.42, 2);
    expect(s.max).toBeCloseTo(0.97, 2);
    expect(s.mae).toBeLessThan(0.4);
  });

  test("logS RMSE and worst case match what the caveat claims", () => {
    const s = stats(EXP_LOGS, (p) => p.logS);
    expect(s.n).toBe(10);
    expect(s.rmse).toBeCloseTo(0.72, 2);
    expect(s.max).toBeCloseTo(1.52, 2); // anthracene
  });

  test("logS really is the weaker model — the caveat says so and must stay true", () => {
    expect(stats(EXP_LOGS, (p) => p.logS).rmse).toBeGreaterThan(stats(EXP_LOGP, (p) => p.logP).rmse);
  });

  test("the aromatic negative bias the caveat warns about is real", () => {
    // "the true cLogP is likely HIGHER than shown" for strongly aromatic input.
    for (const [, smi, exp] of [EXP_LOGP[0], EXP_LOGP[1], EXP_LOGP[6]]) {
      expect(new MoleculeProperties(Molecule.fromSmiles(smi)).logP).toBeLessThan(exp);
    }
  });
});

describe("caveats reach the caller", () => {
  test("every result carries caveats — they are never optional", () => {
    for (const name of ["aspirin", "caffeine", "water", "benzene"]) {
      const r = computeProperties(name);
      expect(r).not.toBeNull();
      expect(r!.caveats.length).toBeGreaterThan(0);
      // The headline point must survive any future editing of the wording.
      expect(r!.caveats.join(" ")).toMatch(/PREDICTION|prediction/);
    }
  });

  test("a non-organic input is told the druglikeness screens do not apply", () => {
    const r = computeProperties("[Au]");
    expect(r).not.toBeNull();
    expect(r!.druglikenessApplicable).toBe(false);
    expect(r!.caveats.join(" ")).toMatch(/not applicable|outside the training space/i);
    expect(r!.caveats.join(" ")).toMatch(/That is not a pass/);
  });

  test("an organic drug gets the Lipinski-is-a-heuristic warning, not the n/a one", () => {
    const r = computeProperties("aspirin")!;
    expect(r.druglikenessApplicable).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/heuristics|not laws/i);
    expect(r.caveats.join(" ")).not.toMatch(/not applicable to this input/);
  });

  test("a strongly aromatic molecule gets the bias warning", () => {
    expect(computeProperties("anthracene")!.caveats.join(" ")).toMatch(/likely HIGHER/);
    // ...and a small aliphatic one does not, so the warning stays meaningful.
    expect(computeProperties("ethanol")!.caveats.join(" ")).not.toMatch(/likely HIGHER/);
  });
});
