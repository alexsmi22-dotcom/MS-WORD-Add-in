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
    // Stage 3a names oxolan-2-one; a lactone ring that is not a parent still refuses.
    expect(refusalOf("O=C1CCCCCO1")).toMatch(/ring is outside/);
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
    // v2.170.0: naphthalene and quinoline are named; decalin, phenanthrene and bridged systems are not.
    expect(refusalOf("C1CCC2CCCCC2C1")).toMatch(/ring system is outside/);
    expect(refusalOf("c1ccc2c(c1)ccc1ccccc12")).toMatch(/ring system is outside/);
    expect(refusalOf("C1CC2CCC1C2")).toMatch(/ring system is outside/);
    expect(refusalOf("C1CCSC1")).toMatch(/heteroatom ring is outside/);
    expect(refusalOf("C1=CCNCC1")).toMatch(/heteroatom ring is outside/);
    // Stage 3a names pyrrolidin-2-one; a lactam of a ring that is not a parent still refuses.
    expect(refusalOf("O=C1CCN1")).toMatch(/ring is outside/);
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
    expect(nameOf("CC(C)C1CCC(C(C)C)CC1")).toBe("1,4-di(propan-2-yl)cyclohexane");
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
    expect(refusalOf(smiles)).toMatch(/ring system/);
  });
  test("an N-aryl amine has one name however it is drawn", () => {
    const names = ["c1ccc(cc1)Nc1ccccn1", "c1ccnc(c1)Nc1ccccc1", "n1ccccc1Nc1ccccc1"].map(nameOf);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBe("N-phenylpyridin-2-amine");
  });
});

describe("v2.169.0 review round 2", () => {
  // Stage 3d: pyrimidine vs pyridine is no longer a tie — P-44.2.1 (f), more heteroatoms, makes pyrimidine the parent.
  test("pyrimidin-2-yl beside pyridin-2-yl on one N: pyrimidine is the parent by (f), either way round", () => {
    expect(nameOf("c1ccnc(n1)Nc1ccccn1")).toBe("N-(pyridin-2-yl)pyrimidin-2-amine");
    expect(nameOf("c1ccnc(c1)Nc1ncccn1")).toBe("N-(pyridin-2-yl)pyrimidin-2-amine");
  });
  test.each([
    ["c1ccc(nc1)Nc1cccnc1", "c1cncc(c1)Nc1ccccn1"],
  ])("tied heteroaryl branches on one N are refused either way round: %s / %s", (a, b) => {
    expect(refusalOf(a)).toMatch(/equal seniority on one nitrogen/);
    expect(refusalOf(b)).toMatch(/equal seniority on one nitrogen/);
  });
  test("identical branches still name: N-phenylaniline", () => {
    expect(nameOf("c1ccc(cc1)Nc1ccccc1")).toBe("N-phenylaniline");
  });
});

describe("v2.170.0 — fused bicyclic parents (stage 2)", () => {
  test.each([
    ["c1ccc2ccccc2c1", "naphthalene"],
    ["Oc1cccc2ccccc12", "naphthalen-1-ol"],
    ["OC(=O)c1ccc2ccccc2c1", "naphthalene-2-carboxylic acid"],
    ["Clc1ccc2ccccc2c1Cl", "1,2-dichloronaphthalene"],
    ["c1ccc2ncccc2c1", "quinoline"],
    ["Oc1cccc2cccnc12", "quinolin-8-ol"],
    ["c1ccc2cnccc2c1", "isoquinoline"],
    ["c1ccc2ncncc2c1", "quinazoline"],
    ["c1ccc2nccnc2c1", "quinoxaline"],
    ["c1ccc2[nH]ccc2c1", "1H-indole"],
    ["Cn1ccc2ccccc21", "1-methyl-1H-indole"],
    ["Nc1ccc2[nH]ccc2c1", "1H-indol-5-amine"],
    ["NCCc1c[nH]c2ccccc12", "2-(1H-indol-3-yl)ethan-1-amine"],
    ["c1ccc2[nH]ncc2c1", "1H-indazole"],
    ["c1ccc2[nH]cnc2c1", "1H-benzimidazole"],
    ["Cc1ccc2[nH]cnc2c1", "5-methyl-1H-benzimidazole"],
    ["Cc1ccc2nc[nH]c2c1", "6-methyl-1H-benzimidazole"],
    ["OC(=O)c1cc2ccccc2o1", "1-benzofuran-2-carboxylic acid"],
    ["c1ccc2sccc2c1", "1-benzothiophene"],
    ["c1ccc2ocnc2c1", "1,3-benzoxazole"],
    ["Nc1nc2ccccc2s1", "1,3-benzothiazol-2-amine"],
    ["OCCc1ccc2ccccc2c1", "2-(naphthalen-2-yl)ethan-1-ol"],
    ["CC(=O)Oc1ccc2ccccc2c1", "naphthalen-2-yl acetate"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
  test("a quinolinone (ring C=O) and a partly saturated system are refused", () => {
    expect(refusalOf("O=c1ccc2ccccc2[nH]1")).toBeTruthy();
    // Stage 3e names indoline (2,3-dihydro-1H-indole); a partly saturated system it does not number still refuses.
    expect(refusalOf("C1CCc2ccccc2C1")).toMatch(/ring system is outside/);
  });
});

describe("v2.170.0 review round 1", () => {
  test.each(["Cc1ccc(Nc2ccc3ccccc3c2)cc1", "CCCc1ccc(Nc2ccc3[nH]ccc3c2)nc1", "CC(C)(C)c1ccc(Nc2ccc3ncccc3c2)cc1", "CCCCCCCCCCCNc1ccc2ccccc2c1"])("a substituted junior branch never takes the parent: %s refused", (smiles) => {
    expect(refusalOf(smiles)).toBeTruthy();
  });
  test("O before S, and a fused pair before one ring, choose the parent", () => {
    expect(nameOf("C1COCC1Nc1cccs1")).toBe("N-(thiophen-2-yl)oxolan-3-amine");
    expect(nameOf("c1coc(Nc2cc3ccccc3s2)c1")).toBe("N-(1-benzothiophen-2-yl)furan-2-amine");
    expect(nameOf("c1ccc(Nc2ccc3ccccc3c2)cc1")).toBe("N-phenylnaphthalen-2-amine");
  });
});

test("furan before thiophene (O before S): one name either way round", () => {
  expect(nameOf("c1ccc(o1)Nc1cccs1")).toBe("N-(thiophen-2-yl)furan-2-amine");
  expect(nameOf("c1ccc(s1)Nc1ccco1")).toBe("N-(thiophen-2-yl)furan-2-amine");
});

describe("v2.170.0 review round 2", () => {
  test.each([
    ["c1ccnc(c1)Nc1nccs1", "N-(1,3-thiazol-2-yl)pyridin-2-amine"],
    ["c1ccnc(c1)Nc1ncco1", "N-(1,3-oxazol-2-yl)pyridin-2-amine"],
    ["c1ccc2ncccc2c1Nc1nc2ccccc2o1", "N-(1,3-benzoxazol-2-yl)quinolin-5-amine"],
    ["c1ccc2sc(Nc3ncco3)nc2c1", "N-(1,3-oxazol-2-yl)-1,3-benzothiazol-2-amine"],
    ["c1coc(c1)NC1CCOCC1", "N-(furan-2-yl)oxan-4-amine"],
    ["C1CCCCCC1Nc1ccccc1", "N-phenylcycloheptanamine"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
  test("the longer chain is the parent; a 2,2-dimethylpropyl prefix is beyond the subset, so refused, never inverted", () => {
    expect(refusalOf("CC(C)(C)CNCCCC")).toMatch(/Complex branched substituents|plain N-prefix/);
  });
});

describe("stage 3a — lactams, lactones and imides as ketones of the saturated parents (P-66.1.4.1, P-65.6.3.5)", () => {
  test.each([
    ["O=C1CCCN1", "pyrrolidin-2-one"],
    ["O=C1CCCCN1", "piperidin-2-one"],
    ["CN1CCCC1=O", "1-methylpyrrolidin-2-one"],
    ["O=C1COCCN1", "morpholin-3-one"],
    ["O=C1CNCCN1", "piperazin-2-one"],
    ["O=C1CCCO1", "oxolan-2-one"],
    ["O=C1CCCCO1", "oxan-2-one"],
    ["O=C1CCC(=O)N1", "pyrrolidine-2,5-dione"],
    ["O=C1CCCC(=O)N1", "piperidine-2,6-dione"],
    ["O=C1CCC(C)N1", "5-methylpyrrolidin-2-one"],
    ["CC1(C)CC(=O)NC1", "4,4-dimethylpyrrolidin-2-one"],
    ["O=C1CC(O)CO1", "4-hydroxyoxolan-2-one"],
    ["O=C1CCC(C(=O)O)N1", "5-oxopyrrolidine-2-carboxylic acid"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test.each([
    ["a 4-membered lactam (azetidine is not a parent)", "O=C1CCN1"],
    ["a 7-membered lactam (azepane is not a parent)", "O=C1CCCCCN1"],
    ["a cyclic carbamate (oxazolidine is not a parent)", "O=C1OCCN1"],
    ["a cyclic urea", "O=C1NCCN1"],
    ["a thiolactone", "O=C1CCS1"],
    ["an aromatic pyridinone (added hydrogen)", "O=c1cccc[nH]1"],
    ["an N-acyl lactam", "CC(=O)N1CCCC1=O"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
});

describe("stage 3a review — cyclic anhydrides of the parents are their diones (P-65.7.7)", () => {
  test.each([
    ["O=C1CCC(=O)O1", "oxolane-2,5-dione"],
    ["O=C1CCCC(=O)O1", "oxane-2,6-dione"],
    ["CC1CC(=O)OC1=O", "3-methyloxolane-2,5-dione"],
    ["O=C1COC(=O)CN1", "morpholine-2,5-dione"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
  test("an open-chain anhydride is still refused by name", () => {
    expect(refusalOf("CC(=O)OC(C)=O")).toMatch(/anhydride/i);
  });
});

describe("stage 3b — sulfonic acids, sulfonamides and sulfones (P-65.3, P-66.1.1.2, P-65.4.1)", () => {
  test.each([
    ["OS(=O)(=O)c1ccccc1", "benzenesulfonic acid"],
    ["Cc1ccc(cc1)S(O)(=O)=O", "4-methylbenzene-1-sulfonic acid"],
    ["CS(O)(=O)=O", "methanesulfonic acid"],
    ["CCCS(O)(=O)=O", "propane-1-sulfonic acid"],
    ["NS(=O)(=O)c1ccccc1", "benzenesulfonamide"],
    ["CS(N)(=O)=O", "methanesulfonamide"],
    ["Nc1ccc(cc1)S(N)(=O)=O", "4-aminobenzene-1-sulfonamide"],
    ["CCCNS(=O)(=O)c1ccc(C)cc1", "4-methyl-N-propylbenzene-1-sulfonamide"],
    ["CN(C)S(=O)(=O)C", "N,N-dimethylmethanesulfonamide"],
    ["NS(=O)(=O)c1cccnc1", "pyridine-3-sulfonamide"],
    ["NS(=O)(=O)c1ccc(Cl)c(c1)S(N)(=O)=O", "4-chlorobenzene-1,3-disulfonamide"],
    ["NS(=O)(=O)CCN", "2-aminoethane-1-sulfonamide"],
    // Sulfones: the preferred prefix is the acid's acyl name, enclosed (not methylsulfonyl).
    ["CS(=O)(=O)c1ccccc1", "(methanesulfonyl)benzene"],
    ["CCCS(=O)(=O)c1ccccc1", "(propane-1-sulfonyl)benzene"],
    ["CS(=O)(=O)c1ccccc1C(=O)O", "2-(methanesulfonyl)benzoic acid"],
    ["CS(=O)(=O)c1ccccc1S(C)(=O)=O", "1,2-bis(methanesulfonyl)benzene"],
    // Junior: sulfo and sulfamoyl (the preselected prefix).
    ["NS(=O)(=O)c1ccc(cc1)C(=O)O", "4-sulfamoylbenzoic acid"],
    ["OC(=O)c1ccc(cc1)S(O)(=O)=O", "4-sulfobenzoic acid"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test.each([
    ["a sulfonate ester", "COS(=O)(=O)C"],
    ["a sulfonyl chloride", "ClS(=O)(=O)c1ccccc1"],
    ["a sulfoxide", "CS(=O)c1ccccc1"],
    ["a thioether", "CSc1ccccc1"],
    ["a sulfonyl on a ring nitrogen", "CS(=O)(=O)N1CCCCC1"],
    ["sulfuric acid", "OS(=O)(=O)O"],
    ["a sulfamide", "NS(=O)(=O)N"],
    ["an N-acyl sulfonamide", "CC(=O)NS(=O)(=O)c1ccccc1"],
    ["a diaryl sulfone (two ring systems)", "c1ccccc1S(=O)(=O)c1ccccc1"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
});

describe("stage 3b review", () => {
  test.each([
    // A carbonyl or nitrile carbon on the sulfonyl S was read without it: the sulfonyl dropped out ("benzaldehyde"),
    // or became a different compound ("(methanesulfonyl)methanamide" reads as an N-sulfonyl formamide).
    "CS(=O)(=O)C(=O)c1ccccc1", "CCS(=O)(=O)C(=O)c1ccccc1", "CS(=O)(=O)C(=O)c1ccncc1", "CS(=O)(=O)C(=O)C1CCCCC1",
    "CS(=O)(=O)c1ccccc1C(=O)S(C)(=O)=O", "CS(=O)(=O)C(N)=O", "NS(=O)(=O)C(N)=O", "CS(=O)(=O)C(=O)C", "CS(=O)(=O)C(=O)O",
    "OS(=O)(=O)C(=O)O", "CS(=O)(=O)C=O", "N#CS(=O)(=O)C", "CS(=O)(=O)C(=O)OC", "CC(=O)S(N)(=O)=O", "O=CS(N)(=O)=O",
  ])("%s is refused by name", (smiles) => expect(refusalOf(smiles)).toMatch(/bonded to sulfur|outside the namer's subset/));

  test("propane-1- and propane-2-sulfonyl: one name however the structure is drawn, the lower locant cited first", () => {
    expect(nameOf("CCCS(=O)(=O)c1ccc(cc1)S(=O)(=O)C(C)C")).toBe("1-(propane-1-sulfonyl)-4-(propane-2-sulfonyl)benzene");
    expect(nameOf("CC(C)S(=O)(=O)c1ccc(cc1)S(=O)(=O)CCC")).toBe("1-(propane-1-sulfonyl)-4-(propane-2-sulfonyl)benzene");
    expect(nameOf("CC(C)S(=O)(=O)c1ccccc1S(=O)(=O)CCC")).toBe("1-(propane-1-sulfonyl)-2-(propane-2-sulfonyl)benzene");
  });
});

describe("stage 3c — carbamates (P-65.2.1, P-65.1.2.2.2, P-65.6.3.3.1)", () => {
  test.each([
    // On a saturated ring N: the ester of the ring's carboxylic acid (pyrrolidine-1-carboxylic acid is the PIN form).
    ["CC(C)(C)OC(=O)N1CCCCC1", "tert-butyl piperidine-1-carboxylate"],
    ["CC(C)(C)OC(=O)N1CCNCC1", "tert-butyl piperazine-1-carboxylate"],
    ["CC(C)(C)OC(=O)N1CCC(=O)CC1", "tert-butyl 4-oxopiperidine-1-carboxylate"],
    ["CC(C)(C)OC(=O)N1CCC(O)CC1", "tert-butyl 4-hydroxypiperidine-1-carboxylate"],
    ["CN1CCN(CC1)C(=O)OC(C)(C)C", "tert-butyl 4-methylpiperazine-1-carboxylate"],
    ["CC(C)(C)OC(=O)N1CCOCC1", "tert-butyl morpholine-4-carboxylate"],
    ["CC(C)(C)OC(=O)N1CCN(CC1)C(=O)OC(C)(C)C", "di-tert-butyl piperazine-1,4-dicarboxylate"],
    ["OC(=O)N1CCCC1", "pyrrolidine-1-carboxylic acid"],
    // On an open-chain N: "R carbamate", N-substituents without a locant (P-65.2.1.1's own example has none).
    ["CC(C)(C)OC(=O)NC", "tert-butyl methylcarbamate"],
    ["COC(=O)Nc1ccccc1", "methyl phenylcarbamate"],
    ["CCOC(N)=O", "ethyl carbamate"],
    ["CN(C)C(=O)O", "dimethylcarbamic acid"],
    ["CC(C)(C)OC(=O)NC1CCNCC1", "tert-butyl (piperidin-4-yl)carbamate"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test.each([
    ["a Boc on an aromatic ring N (indicated hydrogen moves)", "CC(C)(C)OC(=O)n1ccc2ccccc21"],
    ["Cbz (the benzyl ester's PIN form is not checked)", "O=C(NC1CCCCC1)OCc1ccccc1"],
    ["Boc on a chain that carries its own group", "CC(C)(C)OC(=O)NCCO"],
    ["Boc-glycine (a junior carbamate)", "OC(=O)CNC(=O)OC(C)(C)C"],
    ["a Boc ring beside a free acid", "CC(C)(C)OC(=O)N1CCC(CC1)C(=O)O"],
    ["an N-alkoxy carbamate", "COC(=O)NOC"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
});

describe("stage 3c review", () => {
  test.each([
    // ringAttached now takes a ring N: the carbonitrile suffix on a ring N is the PIN (P-66.5.1.1.3). v2.178.0 wrote
    // "(piperidin-1-yl)methanenitrile".
    ["N#CN1CCCCC1", "piperidine-1-carbonitrile"],
    ["N#CN1CCOCC1", "morpholine-4-carbonitrile"],
    ["N#Cn1cccc1", "1H-pyrrole-1-carbonitrile"],
    // An N-Boc lactam is the ring-N carboxylate (the acid outranks the ketone).
    ["CC(C)(C)OC(=O)N1CCCCC1=O", "tert-butyl 2-oxopiperidine-1-carboxylate"],
    // The carboxylate N takes locant 1; the rest follows lowest locants.
    ["CC1CN(CCN1)C(=O)OC(C)(C)C", "tert-butyl 3-methylpiperazine-1-carboxylate"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
  test("two different N-substituents on a carbamate N are refused (form not confirmed)", () => {
    expect(refusalOf("CCN(C)C(=O)OC")).toMatch(/two different substituents/);
    expect(nameOf("CN(C)C(=O)OC")).toBe("methyl dimethylcarbamate");
  });
});

describe("stage 3d — a ring on a ring (P-44.1.1, P-44.2.1, P-44.4.1.1); assemblies refused (P-28)", () => {
  test.each([
    ["c1ccc(cc1)-c1ccncc1", "4-phenylpyridine"],
    ["c1ccc(cc1)-c1cc2ccccc2[nH]1", "2-phenyl-1H-indole"],
    ["c1ccc(cc1)-c1ccc2ccccc2c1", "2-phenylnaphthalene"],
    // P-44.1.1 before ring seniority: the ring with the principal group is the parent.
    ["OC(=O)c1ccc(cc1)-c1ccccn1", "4-(pyridin-2-yl)benzoic acid"],
    ["Nc1ccc(cc1)-c1ccncc1", "4-(pyridin-4-yl)aniline"],
    ["O=C1CCCN1c1ccccc1", "1-phenylpyrrolidin-2-one"],
    ["CC(C)(C)OC(=O)N1CCN(CC1)c1ccccc1", "tert-butyl 4-phenylpiperazine-1-carboxylate"],
    ["C1CN(CCN1)c1ccccc1", "1-phenylpiperazine"],
    // (f) more heteroatoms: morpholine > pyridine.
    ["c1ccncc1N1CCOCC1", "4-(pyridin-3-yl)morpholine"],
    // (c) O before S: furan > thiophene.
    ["c1coc(c1)-c1cccs1", "2-(thiophen-2-yl)furan"],
    // (e) more skeletal atoms, then P-44.4.1.1 more multiple bonds (benzene > cyclohexane).
    ["c1ccc(cc1)C1CCCCCC1", "phenylcycloheptane"],
    ["c1ccc(cc1)C1CCCCC1", "cyclohexylbenzene"],
    ["C1CCC(C1)c1ccccc1", "cyclopentylbenzene"],
    ["Oc1ccc(cc1)C1CCCCC1", "4-cyclohexylphenol"],
    ["c1ccccc1-c1cccnc1-c1ccccc1", "2,3-diphenylpyridine"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test("the shared ring rank fixes the NH between two rings: morpholine is the parent by (f) (v2.179.0: N-(morpholin-2-yl)pyridin-2-amine)", () => {
    expect(nameOf("c1ccc(nc1)NC1CNCCO1")).toBe("N-(pyridin-2-yl)morpholin-2-amine");
  });

  test.each([
    ["biphenyl with a substituent (an assembly, never 1-methyl-4-phenylbenzene)", "Cc1ccc(cc1)-c1ccccc1"],
    ["4-phenylbenzoic acid (an assembly)", "OC(=O)c1ccc(cc1)-c1ccccc1"],
    ["2,2′-bipyridine", "c1ccc(nc1)-c1ccccn1"],
    ["bi(cyclohexane)", "C1CCC(CC1)C1CCCCC1"],
    ["rings joined through CH₂ (multiplicative)", "c1ccc(cc1)Cc1ccccc1"],
    ["a diaryl ether", "c1ccc(cc1)Oc1ccccn1"],
    ["the senior ring carrying a substituted ring", "Cc1ccc(cc1)-c1ccncc1"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
});

describe("stage 3d review", () => {
  test.each([
    // An NH between two rings where one carries its own ring: ranked by the ring it is attached through, never by all
    // the rings of the branch (was 4-(morpholin-4-yl)-N-(pyridin-2-yl)aniline: aniline is not the senior ring).
    ["an NH beside a phenyl carrying morpholine", "c1ccc(nc1)Nc1ccc(cc1)N1CCOCC1"],
    ["an NH beside a piperidine carrying phenyl", "c1ccc(nc1)NC1CCN(CC1)c1ccccc1"],
    // P-54.3: a ring on its own hydrogenated form is a hydro ring assembly (hexahydro-2,2′-bipyridine).
    ["2-(piperidin-2-yl)pyridine", "c1ccc(nc1)C1CCCCN1"],
    ["1-(pyridin-3-yl)piperidine", "c1ccncc1N1CCCCC1"],
    ["2-(oxolan-2-yl)furan", "c1ccoc1C1CCCO1"],
    // P-31.2.3.3.5.1: only ONE benzene with ONE cyclohexane is substitutive; two cyclohexyls make a hydro terphenyl.
    ["1,4-dicyclohexylbenzene", "C1CCC(CC1)c1ccc(cc1)C1CCCCC1"],
    ["cyclohexenylbenzene (a hydro biphenyl)", "c1ccc(cc1)C1=CCCCC1"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
  test("an NH between pyridine and piperidine: pyridine is the parent by P-44.4.1.1 (not an assembly: not bonded directly)", () => {
    expect(nameOf("c1ccc(nc1)NC1CCCCN1")).toBe("N-(piperidin-2-yl)pyridin-2-amine");
  });
});

describe("stage 3e — partly saturated fused rings (P-31.2: hydro prefixes before indicated hydrogen, not alphabetized)", () => {
  test.each([
    ["C1Cc2ccccc2N1", "2,3-dihydro-1H-indole"],
    ["CN1CCc2ccccc21", "1-methyl-2,3-dihydro-1H-indole"],
    ["Clc1ccc2NCCc2c1", "5-chloro-2,3-dihydro-1H-indole"],
    ["Nc1ccc2NCCc2c1", "2,3-dihydro-1H-indol-5-amine"],
    ["C1CNc2ccccc2C1", "1,2,3,4-tetrahydroquinoline"],
    ["C1Cc2ccccc2CN1", "1,2,3,4-tetrahydroisoquinoline"],
    // The Blue Book's own PIN example (P-93): 1,2,3,4-tetrahydroisoquinoline-3-carboxylic acid.
    ["OC(=O)C1Cc2ccccc2CN1", "1,2,3,4-tetrahydroisoquinoline-3-carboxylic acid"],
    ["C1Cc2ccccc2O1", "2,3-dihydro-1-benzofuran"],
    ["C1Cc2ccccc2C1", "2,3-dihydro-1H-indene"],
    ["OC1CCc2ccccc21", "2,3-dihydro-1H-inden-1-ol"],
    ["c1ccc2c(c1)CCN2c1ccccc1", "1-phenyl-2,3-dihydro-1H-indole"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));

  test.each([
    ["an oxindole (a ring C=O needs added hydrogen)", "O=C1Cc2ccccc2N1"],
    ["a 3,4-dihydroquinolin-2(1H)-one", "O=C1CCc2ccccc2N1"],
    ["a Boc-tetrahydroisoquinoline (added-hydrogen form not confirmed)", "CC(C)(C)OC(=O)N1CCc2ccccc2C1"],
    ["tetralin (its hydro locants follow the suffix: not yet)", "C1CCc2ccccc2C1"],
    ["indoline on indoline (a ring assembly)", "C1Cc2ccccc2N1c1ccc2NCCc2c1"],
  ])("%s is refused by name", (_why, smiles) => expect(refusalOf(smiles)).toMatch(/outside the namer's subset/));
});

describe("stage 3e review", () => {
  test("tetrahydroquinoline against isoquinoline: the skeletons differ and only saturation tells them apart — refused", () => {
    expect(refusalOf("C1CCc2ccccc2N1c1cccc2cnccc12")).toMatch(/equal seniority/);
    expect(refusalOf("c1ccc2NCCCc2c1-c1ccc2cnccc2c1")).toMatch(/equal seniority/);
    expect(refusalOf("c1ccc2NCCCc2c1Nc1cccc2cnccc12")).toMatch(/equal seniority/);
  });
  test.each([
    // OH or NH₂ on a ring N is the ring's suffix (P-63.1.3 "piperidin-1-ol (PIN)", P-62.2.1.3 "piperidin-1-amine (PIN)"):
    // v2.180.0 wrote 1-hydroxypiperidine / 1-aminopiperidine.
    ["ON1CCCCC1", "piperidin-1-ol"],
    ["NN1CCCCC1", "piperidin-1-amine"],
    ["ON1CCc2ccccc21", "2,3-dihydro-1H-indol-1-ol"],
    ["ON1CCc2cc(N)ccc21", "5-amino-2,3-dihydro-1H-indol-1-ol"],
    ["ON1CCCC1O", "pyrrolidine-1,2-diol"],
    ["On1cccc1", "1H-pyrrol-1-ol"],
    // A senior group keeps it a prefix.
    ["OC(=O)C1CCCCN1O", "1-hydroxypiperidine-2-carboxylic acid"],
    ["NN1C(=O)CCCC1=O", "1-aminopiperidine-2,6-dione"],
  ])("%s → %s", (smiles, name) => expect(nameOf(smiles)).toBe(name));
});
