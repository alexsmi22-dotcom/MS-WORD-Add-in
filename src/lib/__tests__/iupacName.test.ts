// The subset namer (src/lib/iupacName.ts): every generated name here is a
// hand-verified IUPAC name (2013 locant style), and every boundary of the
// subset is pinned as a NAMED refusal — a confident wrong name for a patent
// document is the one output this suite exists to make impossible.

import { Molecule } from "openchemlib/full";
import { iupacName, nameWithDescriptors } from "../iupacName";

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
    // v2.168.0: the retained PINs (P-65.1.1.1).
    expect(nameOf("C(=O)O")).toBe("formic acid");
    expect(nameOf("CC(=O)O")).toBe("acetic acid");
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
    // v2.168.0: a lone principal group on a ring takes no locant (PIN cyclohexanol); with a prefix it does.
    expect(nameOf("OC1CCCCC1")).toBe("cyclohexanol");
    expect(nameOf("O=C1CCCCC1")).toBe("cyclohexanone");
    expect(nameOf("CC1CCCCC1O")).toBe("2-methylcyclohexan-1-ol");
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
  test("esters beyond v2.168.0's: lactones, two alcohols, anhydrides, an ester beside a free acid", () => {
    expect(refusalOf("O=C1CCCO1")).toMatch(/Lactones/);
    expect(refusalOf("CCOC(=O)CC(=O)OC")).toMatch(/two different alcohols/);
    expect(refusalOf("CC(=O)OC(C)=O")).toMatch(/anhydride/i);
    expect(refusalOf("CCOC(=O)CC(=O)O")).toMatch(/ester alongside a free acid/);
    expect(refusalOf("CC(=O)OCCO")).toMatch(/alcohol part/);
  });

  test("N-substituents beyond v2.168.0's", () => {
    expect(refusalOf("CNCCNC")).toMatch(/Two substituted nitrogens/);
    expect(refusalOf("CNCC(=O)O")).toMatch(/substituted amino group alongside a more senior group/);
    expect(refusalOf("CN(CCO)CCO")).toMatch(/nitrogen/);
  });

  test("fused rings, and heterorings beyond stage 1b's", () => {
    expect(refusalOf("c1ccc2ccccc2c1")).toMatch(/Fused or multiple rings/);
    expect(refusalOf("c1ccc2ncccc2c1")).toMatch(/Fused or multiple rings/);
    expect(refusalOf("C1CCSC1")).toMatch(/heteroatom ring is outside/);
    expect(refusalOf("C1=CCNCC1")).toMatch(/heteroatom ring is outside/);
    expect(refusalOf("O=C1CCCN1")).toMatch(/Lactams and lactones/);
    expect(refusalOf("O=c1cccc[nH]1")).toMatch(/ring/);
    expect(refusalOf("CSc1ccccc1")).toMatch(/Sulfur outside a thiophene or thiazole ring/);
    expect(refusalOf("CC(=O)N1CCCCC1")).toMatch(/N-substituted amides/);
  });

  test("benzene principal groups beyond v2.168.0's", () => {
    expect(refusalOf("OC(=O)c1ccc(C=O)cc1")).toMatch(/aldehyde group alongside a more senior group/i);
    expect(refusalOf("OCc1ccc(cc1)C(=O)O")).toMatch(/carries its own group/);
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

describe("v2.168.0 — carbocycles with principal groups, esters, N-substituents (stage 1a)", () => {
  test.each([
    ["Oc1ccccc1", "phenol"],
    ["Nc1ccccc1", "aniline"],
    ["OC(=O)c1ccccc1", "benzoic acid"],
    ["O=Cc1ccccc1", "benzaldehyde"],
    ["N#Cc1ccccc1", "benzonitrile"],
    ["NC(=O)c1ccccc1", "benzamide"],
    ["Clc1ccc(O)cc1", "4-chlorophenol"],
    ["Nc1ccc(O)cc1", "4-aminophenol"],
    ["OC(=O)c1ccccc1O", "2-hydroxybenzoic acid"],
    ["OC(=O)c1cccc(c1)[N+](=O)[O-]", "3-nitrobenzoic acid"],
    ["Oc1ccccc1O", "benzene-1,2-diol"],
    ["OC(=O)c1ccc(cc1)C(=O)O", "benzene-1,4-dicarboxylic acid"],
    ["OC(=O)C1CCCCC1", "cyclohexanecarboxylic acid"],
    ["O=CC1CCCCC1", "cyclohexanecarbaldehyde"],
    ["CC1CCCC(C1)C(=O)O", "3-methylcyclohexane-1-carboxylic acid"],
    ["OC1CCCCC1O", "cyclohexane-1,2-diol"],
    ["ClCC(=O)O", "chloroacetic acid"],
    ["OC(=O)Cc1ccccc1", "phenylacetic acid"],
    ["CC(N)=O", "acetamide"],
    ["CC(=O)OCC", "ethyl acetate"],
    ["COC(=O)c1ccc(cc1)[N+](=O)[O-]", "methyl 4-nitrobenzoate"],
    ["CC(=O)Oc1ccccc1", "phenyl acetate"],
    ["CCOC(=O)CCC(=O)OCC", "diethyl butanedioate"],
    ["CCOC(=O)CC(C)=O", "ethyl 3-oxobutanoate"],
    ["CC(C)OC(=O)C", "propan-2-yl acetate"],
    ["COC=O", "methyl formate"],
    ["CNC", "N-methylmethanamine"],
    ["CCN(CC)CC", "N,N-diethylethanamine"],
    ["CN(C)c1ccccc1", "N,N-dimethylaniline"],
    ["CNc1ccc(Cl)cc1", "4-chloro-N-methylaniline"],
    ["CNC1CCCCC1", "N-methylcyclohexanamine"],
    ["CC(=O)NC", "N-methylacetamide"],
    ["CN(C)C=O", "N,N-dimethylformamide"],
    ["CC(=O)Nc1ccccc1", "N-phenylacetamide"],
    ["OCC1CCCCC1", "cyclohexylmethanol"],
    ["CC(O)C1CCCCC1", "1-cyclohexylethan-1-ol"],
    ["CCCCCCc1ccccc1", "hexylbenzene"],
  ])("%s → %s", (smiles, name) => {
    expect(nameOf(smiles)).toBe(name);
  });
});

describe("v2.168.0 review round 1", () => {
  test.each([
    ["OC(=O)C(Cl)OC", "chloro(methoxy)acetic acid"],
    ["OC(=O)C(Cl)c1ccccc1", "chloro(phenyl)acetic acid"],
    ["OC(Cl)c1ccccc1", "chloro(phenyl)methanol"],
    ["NC(OC)Cl", "chloro(methoxy)methanamine"],
    ["CNCc1ccccc1", "N-methyl-1-phenylmethanamine"],
    ["CNC(=O)CCN", "3-amino-N-methylpropanamide"],
    ["CC(C)(C)OC(=O)CCC(=O)OC(C)(C)C", "di-tert-butyl butanedioate"],
    ["Cc1ccc(C(C)(C)C)cc1C(C)(C)C", "2,4-di-tert-butyl-1-methylbenzene"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
  test.each(["CNCCC(N)=O", "CNc1ccc(cc1)C(N)=O", "[13CH3]OC(C)=O", "CC(=O)O[CH2-]", "CC(=O)O[CH2]", "CN[13CH3]"])("%s is refused", (smiles) => {
    expect(refusalOf(smiles)).toBeTruthy();
  });
  test("stereo in a part cut off for naming is said; descriptors go before an ester's acid part", () => {
    const r = iupacName(Molecule.fromSmiles("CC[C@@H](C)OC(C)=O"));
    expect(r.caveats.join(" ")).toMatch(/stereodescriptors/);
    const e = iupacName(Molecule.fromSmiles("C[C@@H](Cl)C(=O)OC"));
    expect(e.name).toBe("methyl 2-chloropropanoate");
    expect(nameWithDescriptors(e.name!, "(2R)-", e.descriptorAt)).toBe("methyl (2R)-2-chloropropanoate");
    expect(nameWithDescriptors("butan-2-ol", "(2R)-", undefined)).toBe("(2R)-butan-2-ol");
  });
});

test("a name with no numbered positions takes its descriptor without a locant", () => {
  expect(nameWithDescriptors("chloro(phenyl)acetic acid", "(2S)-")).toBe("(S)-chloro(phenyl)acetic acid");
  expect(nameWithDescriptors("butan-2-ol", "(2R)-")).toBe("(2R)-butan-2-ol");
  expect(nameWithDescriptors("methyl chlorofluoroacetate", "(2R)-", 7)).toBe("methyl (R)-chlorofluoroacetate");
});

describe("v2.169.0 — heteromonocycles (stage 1b)", () => {
  test.each([
    ["c1ccncc1", "pyridine"],
    ["Cc1ccccn1", "2-methylpyridine"],
    ["Nc1ccccn1", "pyridin-2-amine"],
    ["OC(=O)c1cccnc1", "pyridine-3-carboxylic acid"],
    ["Oc1ccccn1", "pyridin-2-ol"],
    ["O=Cc1ccco1", "furan-2-carbaldehyde"],
    ["OC(=O)c1cccs1", "thiophene-2-carboxylic acid"],
    ["c1cc[nH]c1", "1H-pyrrole"],
    ["Cn1cccc1", "1-methyl-1H-pyrrole"],
    ["c1c[nH]cn1", "1H-imidazole"],
    ["Cc1c[nH]cn1", "4-methyl-1H-imidazole"],
    ["Cc1cnc[nH]1", "5-methyl-1H-imidazole"],
    ["c1cn[nH]c1", "1H-pyrazole"],
    ["c1cocn1", "1,3-oxazole"],
    ["c1conc1", "1,2-oxazole"],
    ["Nc1nccs1", "1,3-thiazol-2-amine"],
    ["c1cnccn1", "pyrazine"],
    ["c1ccnnc1", "pyridazine"],
    ["Clc1ncccn1", "2-chloropyrimidine"],
    ["C1CCNCC1", "piperidine"],
    ["CN1CCCCC1", "1-methylpiperidine"],
    ["O=C1CCNCC1", "piperidin-4-one"],
    ["C1COCCN1", "morpholine"],
    ["CN1CCOCC1", "4-methylmorpholine"],
    ["CCN1CCN(C)CC1", "1-ethyl-4-methylpiperazine"],
    ["C1CCOC1", "oxolane"],
    ["C1CCOCC1", "oxane"],
    ["OCCc1ccccn1", "2-(pyridin-2-yl)ethan-1-ol"],
    ["OCCN1CCOCC1", "2-(morpholin-4-yl)ethan-1-ol"],
    ["OC(=O)CCN1CCCCC1", "3-(piperidin-1-yl)propanoic acid"],
    ["OCCn1ccnc1", "2-(1H-imidazol-1-yl)ethan-1-ol"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
});

describe("v2.169.0 review round 1", () => {
  test.each(["CC(=O)NC1CC2CC1N2", "CC(=O)OC1CC2CCN12", "CC(=O)OC1C2COC1C2", "CC(=O)NC1C2NC2C1"])("a bicyclic part cut off for naming is refused: %s", (smiles) => {
    expect(refusalOf(smiles)).toMatch(/Fused or multiple rings/);
  });
  test("an N-aryl amine has one name however it is drawn", () => {
    const names = ["c1ccc(cc1)Nc1ccccn1", "c1ccnc(c1)Nc1ccccc1", "n1ccccc1Nc1ccccc1"].map(nameOf);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBe("N-phenylpyridin-2-amine");
  });
});

describe("v2.169.0 review round 2", () => {
  test.each([
    ["c1ccnc(n1)Nc1ccccn1", "c1ccnc(c1)Nc1ncccn1"],
    ["c1ccc(nc1)Nc1cccnc1", "c1cncc(c1)Nc1ccccn1"],
    ["c1ccc(o1)Nc1cccs1", "c1ccc(s1)Nc1ccco1"],
  ])("tied heteroaryl branches on one N are refused either way round: %s / %s", (a, b) => {
    expect(refusalOf(a)).toMatch(/equal seniority on one nitrogen/);
    expect(refusalOf(b)).toMatch(/equal seniority on one nitrogen/);
  });
  test("identical branches still name: N-phenylaniline", () => {
    expect(nameOf("c1ccc(cc1)Nc1ccccc1")).toBe("N-phenylaniline");
  });
});
