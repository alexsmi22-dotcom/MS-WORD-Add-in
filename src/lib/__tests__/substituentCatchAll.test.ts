// classifySubstituent must not hand a WRONG-SIGN increment to a group it does not
// recognise.
//
// WHY THIS EXISTS (punch list #3, second half)
// The audit flagged classifySubstituent's `"other"` fallback and asked what lands
// there. The answer turned out to be the less interesting half of the problem.
// "other" is at least SAFE: nmr.ts finds no increment and skips it, so an unknown
// group contributes zero (silently — now caveated, see below).
//
// The dangerous half was groups that never reached "other" because an earlier
// branch claimed them with a plausible-looking label. Measured:
//
//   benzenesulfonic acid  -> "SR"   (thioether)
//   benzenesulfonamide    -> "SR"
//   nitrosobenzene        -> "NR2"  (dialkylamine)
//   phenyl azide          -> "NR2"
//
// These are not near misses. -SO3H and -N=O are strongly ELECTRON-WITHDRAWING;
// -SR and -NR2 are DONATING. The increments differ in SIGN, so the predicted shift
// moved the wrong way along the axis — the exact arginine shape, where a missing
// class was routed to a catch-all wearing a believable label.

import { Molecule } from "openchemlib";
import { classifySubstituent, aromaticSubstituents, SubstKey } from "../molgraph";
import { predictNmr } from "../nmr";

/** Every aromatic substituent classification in a SMILES. */
function subs(smiles: string): SubstKey[] {
  const m = Molecule.fromSmiles(smiles);
  m.ensureHelperArrays(Molecule.cHelperRings);
  const out: SubstKey[] = [];
  for (let b = 0; b < m.getAllAtoms(); b++) {
    if (!m.isAromaticAtom(b)) continue;
    for (const s of aromaticSubstituents(m, b)) out.push(classifySubstituent(m, s, b));
  }
  return out;
}

describe("oxidised sulfur is not a thioether", () => {
  test.each([
    ["benzenesulfonic acid", "OS(=O)(=O)c1ccccc1"],
    ["benzenesulfonamide", "NS(=O)(=O)c1ccccc1"],
    ["methyl phenyl sulfone", "CS(=O)(=O)c1ccccc1"],
    ["methyl phenyl sulfoxide", "CS(=O)c1ccccc1"],
  ])("%s does NOT classify as SR", (_l, smiles) => {
    expect(subs(smiles)).not.toContain("SR");
    expect(subs(smiles)).toContain("other");
  });

  test("a real thioether still classifies as SR", () => {
    expect(subs("CSc1ccccc1")).toContain("SR"); // thioanisole
  });

  test("a real thiol still classifies as SH", () => {
    expect(subs("Sc1ccccc1")).toContain("SH"); // thiophenol
  });
});

describe("nitroso, azide and isocyanate are not amines", () => {
  test.each([
    ["nitrosobenzene", "O=Nc1ccccc1"],
    ["phenyl azide", "[N-]=[N+]=Nc1ccccc1"],
    ["phenyl isocyanate", "O=C=Nc1ccccc1"],
  ])("%s does NOT classify as NR2", (_l, smiles) => {
    expect(subs(smiles)).not.toContain("NR2");
    expect(subs(smiles)).toContain("other");
  });

  test("real amines still classify correctly — the fix did not gut them", () => {
    expect(subs("Nc1ccccc1")).toContain("NH2"); // aniline
    expect(subs("CN(C)c1ccccc1")).toContain("NR2"); // N,N-dimethylaniline
    expect(subs("CC(=O)Nc1ccccc1")).toContain("NHAc"); // acetanilide
    expect(subs("O=[N+]([O-])c1ccccc1")).toContain("NO2"); // nitrobenzene
  });
});

describe("the controls still work — no regression in ordinary chemistry", () => {
  test.each<[string, string, SubstKey]>([
    ["toluene", "Cc1ccccc1", "CH3"],
    ["phenol", "Oc1ccccc1", "OH"],
    ["anisole", "COc1ccccc1", "OR"],
    ["benzonitrile", "N#Cc1ccccc1", "CN"],
    ["benzaldehyde", "O=Cc1ccccc1", "CHO"],
    ["benzoic acid", "OC(=O)c1ccccc1", "COOH"],
    ["chlorobenzene", "Clc1ccccc1", "Cl"],
    ["phenyl acetate", "CC(=O)Oc1ccccc1", "OAc"],
    ["biphenyl", "c1ccc(-c2ccccc2)cc1", "Ph"],
    ["styrene", "C=Cc1ccccc1", "vinyl"],
  ])("%s -> %s", (_l, smiles, expected) => {
    expect(subs(smiles)).toContain(expected);
  });
});

describe("a group that contributes nothing now SAYS it contributed nothing", () => {
  // Before: an unknown substituent got no increment and no warning, so the shift
  // came out as though the ring were unsubstituted there. Silent, and wrong by
  // tens of ppm for a strongly donating/withdrawing group.
  const caveatText = (input: string): string => {
    const r = predictNmr(input, "13C");
    return (r?.caveats ?? []).join(" ");
  };

  test("phenylboronic acid warns that its substituent was ignored", () => {
    expect(caveatText("OB(O)c1ccccc1")).toMatch(/no tabulated benzene increment/);
    expect(caveatText("OB(O)c1ccccc1")).toMatch(/as if they were absent/);
  });

  test("nitrosobenzene — now unrecognised rather than mislabelled — warns", () => {
    expect(caveatText("O=Nc1ccccc1")).toMatch(/no tabulated benzene increment/);
  });

  test("benzenesulfonic acid warns", () => {
    expect(caveatText("OS(=O)(=O)c1ccccc1")).toMatch(/no tabulated benzene increment/);
  });

  test("toluene does NOT warn — or the caveat is noise", () => {
    expect(caveatText("Cc1ccccc1")).not.toMatch(/no tabulated benzene increment/);
  });

  test("nitrobenzene does NOT warn — NO2 has a real increment", () => {
    expect(caveatText("O=[N+]([O-])c1ccccc1")).not.toMatch(/no tabulated benzene increment/);
  });
});
