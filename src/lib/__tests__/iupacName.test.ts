// The subset namer (src/lib/iupacName.ts): every generated name here is a
// hand-verified IUPAC name (2013 locant style), and every boundary of the
// subset is pinned as a NAMED refusal — a confident wrong name for a patent
// document is the one output this suite exists to make impossible.

import { Molecule } from "openchemlib/full";
import { iupacName } from "../iupacName";

const nameOf = (smiles: string): string => {
  const r = iupacName(Molecule.fromSmiles(smiles));
  if (r.refusal) throw new Error(`refused: ${r.refusal}`);
  return r.name!;
};

const refusalOf = (smiles: string): string => {
  const r = iupacName(Molecule.fromSmiles(smiles));
  if (r.name) throw new Error(`named: ${r.name}`);
  return r.refusal!;
};

describe("alkanes", () => {
  test("straight chains", () => {
    expect(nameOf("C")).toBe("methane");
    expect(nameOf("CC")).toBe("ethane");
    expect(nameOf("CCC")).toBe("propane");
    expect(nameOf("CCCCCCCC")).toBe("octane");
    expect(nameOf("CCCCCCCCCCCC")).toBe("dodecane");
  });

  test("branched, with correct low locants and alphabetical order", () => {
    expect(nameOf("CC(C)C")).toBe("2-methylpropane");
    expect(nameOf("CC(C)(C)C")).toBe("2,2-dimethylpropane");
    expect(nameOf("CC(C)CC")).toBe("2-methylbutane"); // never 3-methylbutane
    expect(nameOf("CCC(C)C(C)CC")).toBe("3,4-dimethylhexane");
    expect(nameOf("CCC(CC)C(C)C")).toBe("3-ethyl-2-methylpentane"); // e before m
    expect(nameOf("CC(C)CC(C)(C)C")).toBe("2,2,4-trimethylpentane"); // isooctane
  });

  test("chain choice prefers the longest", () => {
    expect(nameOf("CCCC(C)CCC")).toBe("4-methylheptane");
  });

  test("beyond C12 refuses by name", () => {
    expect(refusalOf("C".repeat(13))).toMatch(/C12/);
  });
});

describe("unsaturation", () => {
  test("enes and ynes with lowest locants", () => {
    expect(nameOf("C=C")).toBe("ethene");
    expect(nameOf("CC=C")).toBe("prop-1-ene");
    expect(nameOf("CC=CC")).toBe("but-2-ene");
    expect(nameOf("C=CC=C")).toBe("buta-1,3-diene");
    expect(nameOf("CC=CC=C")).toBe("penta-1,3-diene");
    expect(nameOf("C#C")).toBe("ethyne");
    expect(nameOf("CC#C")).toBe("prop-1-yne");
  });

  test("stereo-drawn alkenes name constitutionally WITH the caveat", () => {
    const r = iupacName(Molecule.fromSmiles("C/C=C\\C"));
    expect(r.name).toBe("but-2-ene");
    expect(r.caveats.join(" ")).toMatch(/stereodescriptors/i);
  });

  test("substituted alkenes", () => {
    expect(nameOf("CC(C)=C")).toBe("2-methylprop-1-ene");
  });
});

describe("principal characteristic groups", () => {
  test("alcohols", () => {
    expect(nameOf("CO")).toBe("methanol");
    expect(nameOf("CCO")).toBe("ethanol");
    expect(nameOf("CC(O)C")).toBe("propan-2-ol");
    expect(nameOf("CCCO")).toBe("propan-1-ol");
    expect(nameOf("OCCCO")).toBe("propane-1,3-diol");
  });

  test("ketones and aldehydes", () => {
    expect(nameOf("CC(=O)C")).toBe("propan-2-one");
    expect(nameOf("CC(=O)CC(=O)C")).toBe("pentane-2,4-dione");
    expect(nameOf("CC=O")).toBe("ethanal");
    expect(nameOf("CCCC=O")).toBe("butanal");
  });

  test("acids, amides, nitriles", () => {
    expect(nameOf("C(=O)O")).toBe("methanoic acid");
    expect(nameOf("CC(=O)O")).toBe("ethanoic acid");
    expect(nameOf("CCCC(=O)O")).toBe("butanoic acid");
    expect(nameOf("OC(=O)CCCCC(=O)O")).toBe("hexanedioic acid");
    expect(nameOf("CCC(N)=O")).toBe("propanamide");
    expect(nameOf("CCC#N")).toBe("propanenitrile");
  });

  test("amines", () => {
    expect(nameOf("CN")).toBe("methanamine");
    expect(nameOf("CCN")).toBe("ethanamine");
    expect(nameOf("CC(N)C")).toBe("propan-2-amine");
  });

  test("seniority: the junior group becomes a prefix", () => {
    expect(nameOf("CC(=O)CCO")).toBe("4-hydroxybutan-2-one");
    expect(nameOf("CC(=O)CC(=O)O")).toBe("3-oxobutanoic acid");
    expect(nameOf("NCCO")).toBe("2-aminoethan-1-ol");
  });

  test("suffix + unsaturation compose", () => {
    expect(nameOf("OCC=C")).toBe("prop-2-en-1-ol");
  });
});

describe("prefix substituents", () => {
  test("halogens and nitro", () => {
    expect(nameOf("ClC(Cl)Cl")).toBe("trichloromethane");
    expect(nameOf("ClCCCl")).toBe("1,2-dichloroethane");
    expect(nameOf("CC(Br)(C)C")).toBe("2-bromo-2-methylpropane");
    expect(nameOf("C[N+](=O)[O-]")).toBe("nitromethane");
    expect(nameOf("CC(C)[N+](=O)[O-]")).toBe("2-nitropropane");
  });

  test("ethers as methoxy/ethoxy", () => {
    expect(nameOf("COCC")).toBe("methoxyethane");
    expect(nameOf("COCCCl")).toBe("1-chloro-2-methoxyethane");
  });

  test("named branched alkyl substituents", () => {
    expect(nameOf("CCCCCC(C(C)C)CC")).toBe("3-ethyl-2-methyloctane");
    expect(nameOf("CC(C)(C)CCCCCC")).toBe("2,2-dimethyloctane");
  });
});

describe("rings", () => {
  test("cycloalkanes", () => {
    expect(nameOf("C1CC1")).toBe("cyclopropane");
    expect(nameOf("C1CCCCC1")).toBe("cyclohexane");
    expect(nameOf("CC1CCCCC1")).toBe("methylcyclohexane");
    expect(nameOf("CC1CCCCC1C")).toBe("1,2-dimethylcyclohexane");
    expect(nameOf("OC1CCCCC1")).toBe("cyclohexan-1-ol");
    expect(nameOf("O=C1CCCCC1")).toBe("cyclohexan-1-one");
  });

  test("benzene with prefix substituents", () => {
    expect(nameOf("c1ccccc1")).toBe("benzene");
    expect(nameOf("Clc1ccccc1")).toBe("chlorobenzene");
    expect(nameOf("Clc1ccccc1Cl")).toBe("1,2-dichlorobenzene");
    expect(nameOf("Clc1ccc(Cl)cc1")).toBe("1,4-dichlorobenzene");
    expect(nameOf("Cc1ccccc1")).toBe("methylbenzene");
    expect(nameOf("Clc1ccc([N+](=O)[O-])cc1")).toBe("1-chloro-4-nitrobenzene");
  });

  test("phenyl as a substituent on a functionalised chain", () => {
    expect(nameOf("OCCc1ccccc1")).toBe("2-phenylethan-1-ol");
  });
});

describe("refusals — every boundary is NAMED", () => {
  test("esters, by name", () => {
    expect(refusalOf("CC(=O)OCC")).toMatch(/ester/i);
  });

  test("N-substituted amines and amides", () => {
    expect(refusalOf("CCNCC")).toMatch(/amine/i);
    expect(refusalOf("CC(=O)NC")).toMatch(/amide/i);
  });

  test("hetero and fused rings", () => {
    expect(refusalOf("c1ccncc1")).toMatch(/ring/i);
    expect(refusalOf("c1ccc2ccccc2c1")).toMatch(/ring/i);
  });

  test("benzene principal groups defer to the dictionary's retained names", () => {
    expect(refusalOf("Oc1ccccc1")).toMatch(/dictionary/i);
    expect(refusalOf("Nc1ccccc1")).toMatch(/dictionary/i);
  });

  test("other elements, charges, isotopes", () => {
    expect(refusalOf("CCS")).toMatch(/subset/);
    expect(refusalOf("CC([O-])=O")).toMatch(/charge/i);
    expect(refusalOf("[13CH4]")).toMatch(/isotope/i);
  });

  test("two separate molecules", () => {
    expect(refusalOf("CCO.CC")).toMatch(/separate/i);
  });

  test("complex substituents refuse rather than guess", () => {
    // A neopentyl branch on a RING cannot be absorbed into a longer chain —
    // it must be named as a substituent, and it is outside the named set.
    expect(refusalOf("CC(C)(C)CC1CCCCC1")).toMatch(/subset/i);
  });

  test("every result carries the verify-before-filing caveat", () => {
    const r = iupacName(Molecule.fromSmiles("CCO"));
    expect(r.caveats.join(" ")).toMatch(/verify/i);
  });
});

describe("ADVERSARIAL PASS — wrong names made impossible, garbling made refusals", () => {
  test("imines are REFUSED, never silently stripped to the alkane", () => {
    // Ethanimine was named "ethane" — a different molecular formula.
    expect(refusalOf("CC=N")).toMatch(/imine|C=N/i);
    expect(refusalOf("C=N")).toMatch(/imine|C=N/i);
    expect(refusalOf("CC=NC")).toMatch(/imine|C=N/i);
  });

  test("urea and carbonic acid refuse — the carbonyl is never dropped", () => {
    expect(refusalOf("NC(N)=O")).toMatch(/carbonyl|urea/i);
    expect(refusalOf("OC(O)=O")).toMatch(/carbonyl|carbonic/i);
  });

  test("methylidene on a ring is not 'methyl' — exocyclic C=C refuses", () => {
    // Methylidenecyclohexane was named methylcyclohexane (wrong formula).
    expect(refusalOf("C=C1CCCCC1")).toMatch(/exocyclic/i);
    expect(refusalOf("CC=C1CCCCC1")).toMatch(/exocyclic/i);
  });

  test("acyl halides, phosgene and ketene refuse — never '-al' without the H", () => {
    expect(refusalOf("CC(=O)Cl")).toMatch(/acyl halide/i);
    expect(refusalOf("ClC(Cl)=O")).toMatch(/acyl halide/i);
    expect(refusalOf("C=C=O")).toMatch(/keten|cumulated/i);
    expect(refusalOf("OC(=O)Cl")).toMatch(/acyl halide/i);
  });

  test("multiplier overflow refuses instead of emitting '7-fold-' or 'undefined'", () => {
    expect(refusalOf("ClC(Cl)(Cl)C(Cl)(Cl)C(Cl)Cl")).toMatch(/identical substituents/i);
    expect(refusalOf("OCC(O)C(O)C(O)C(O)C(O)CO")).toMatch(/identical principal groups/i);
  });

  test("one-carbon parents drop ALL locants cleanly", () => {
    expect(nameOf("OCc1ccccc1")).toBe("phenylmethanol");
    expect(nameOf("NCc1ccccc1")).toBe("phenylmethanamine");
    expect(nameOf("ClC(Cl)(Cl)Cl")).toBe("tetrachloromethane");
    expect(nameOf("FC(F)Cl")).toBe("chlorodifluoromethane");
  });

  test("ene/yne tie: the double bond takes the lower locant from EITHER input order", () => {
    expect(nameOf("C=CCC#C")).toBe("pent-1-en-4-yne");
    expect(nameOf("C#CCC=C")).toBe("pent-1-en-4-yne");
    expect(nameOf("C#CCCC=C")).toBe("hex-1-en-5-yne");
  });

  test("substituents that carry locants get enclosing marks and bis/tris", () => {
    expect(nameOf("CCCC(C(C)C)CCC")).toBe("4-(propan-2-yl)heptane");
    expect(nameOf("CC(C)C1CCC(C(C)C)CC1")).toBe("1,4-bis(propan-2-yl)cyclohexane");
  });

  test("rings beyond OCL's 7-ring perception refuse by the honest boundary", () => {
    expect(refusalOf("C1CCCCCCC1")).toMatch(/cycloheptane/i);
    expect(refusalOf("OC1CCCCCCC1")).toMatch(/cycloheptane/i);
  });

  test("formaldehyde stays in coverage as methanal", () => {
    expect(nameOf("C=O")).toBe("methanal");
  });

  test("cycloheptane itself still names", () => {
    expect(nameOf("C1CCCCCC1")).toBe("cycloheptane");
  });
});
