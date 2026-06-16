// Built-in lookup tables for turning a chemical name or molecular formula into a
// SMILES string, which the structure renderer needs to draw a 2D depiction.
//
// Why this exists: a 2D structure is defined by connectivity, but a bare
// molecular formula (e.g. "C2H6O") does not uniquely determine connectivity —
// it could be ethanol or dimethyl ether. Deriving structure from formula in the
// general case is hard and ambiguous offline, so we ship a curated dictionary of
// common compounds and otherwise accept SMILES directly. For ambiguous formulas
// we map to the most common compound and document the choice in the README.
//
// Keys:
//   NAME_TO_SMILES    — lowercased common names (matched case-insensitively)
//   FORMULA_TO_SMILES — formulas as commonly written (matched case-sensitively,
//                       whitespace removed by the caller)

export const NAME_TO_SMILES: Record<string, string> = {
  water: "O",
  "hydrogen peroxide": "OO",
  ammonia: "N",
  methane: "C",
  ethane: "CC",
  propane: "CCC",
  butane: "CCCC",
  methanol: "CO",
  ethanol: "CCO",
  isopropanol: "CC(O)C",
  "isopropyl alcohol": "CC(O)C",
  "acetic acid": "CC(=O)O",
  "formic acid": "OC=O",
  formaldehyde: "C=O",
  acetaldehyde: "CC=O",
  acetone: "CC(=O)C",
  benzene: "c1ccccc1",
  toluene: "Cc1ccccc1",
  phenol: "Oc1ccccc1",
  aniline: "Nc1ccccc1",
  naphthalene: "c1ccc2ccccc2c1",
  glucose: "OCC1OC(O)C(O)C(O)C1O",
  caffeine: "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
  aspirin: "CC(=O)Oc1ccccc1C(=O)O",
  "acetylsalicylic acid": "CC(=O)Oc1ccccc1C(=O)O",
  ibuprofen: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",
  paracetamol: "CC(=O)Nc1ccc(O)cc1",
  acetaminophen: "CC(=O)Nc1ccc(O)cc1",
  glycine: "NCC(=O)O",
  urea: "NC(=O)N",
  "carbon dioxide": "O=C=O",
  "carbon monoxide": "[C-]#[O+]",
  "sulfuric acid": "OS(=O)(=O)O",
  "nitric acid": "O[N+](=O)[O-]",
  "hydrochloric acid": "Cl",
  "sodium chloride": "[Na+].[Cl-]",
  "sodium hydroxide": "[Na+].[OH-]",
  ethylene: "C=C",
  ethene: "C=C",
  acetylene: "C#C",
  ethyne: "C#C",
  propene: "CC=C",
  methylamine: "CN",
};

export const FORMULA_TO_SMILES: Record<string, string> = {
  H2O: "O",
  H2O2: "OO",
  NH3: "N",
  CH4: "C",
  C2H6: "CC",
  C3H8: "CCC",
  C4H10: "CCCC",
  CH3OH: "CO",
  CH4O: "CO",
  C2H5OH: "CCO",
  C2H6O: "CCO",
  CH3COOH: "CC(=O)O",
  C2H4O2: "CC(=O)O",
  CH2O: "C=O",
  CH3CHO: "CC=O",
  C2H4O: "CC=O",
  CH3COCH3: "CC(=O)C",
  C3H6O: "CC(=O)C",
  C6H6: "c1ccccc1",
  C7H8: "Cc1ccccc1",
  C6H5OH: "Oc1ccccc1",
  C6H6O: "Oc1ccccc1",
  C6H12O6: "OCC1OC(O)C(O)C(O)C1O",
  C10H8: "c1ccc2ccccc2c1",
  CO2: "O=C=O",
  CO: "[C-]#[O+]",
  H2SO4: "OS(=O)(=O)O",
  HNO3: "O[N+](=O)[O-]",
  HCl: "Cl",
  NaCl: "[Na+].[Cl-]",
  NaOH: "[Na+].[OH-]",
  C2H4: "C=C",
  C2H2: "C#C",
  C3H6: "CC=C",
  CH3NH2: "CN",
  CH5N: "CN",
};
