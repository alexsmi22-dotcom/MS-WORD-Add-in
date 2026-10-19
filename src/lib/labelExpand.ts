/**
 * Atom labels that stand for groups (OMe, CO₂H, Ph, Boc …), expanded to their structures the way ChemDraw's
 * Expand Label does, so a drawing's formula and SMILES are those of what the label means. Only labels in
 * this table are expanded — a condensed formula is never parsed by rule (C(O)… readings are ambiguous, and a
 * plausible wrong group is worse than none). Each entry is a SMILES whose FIRST atom is the one bonded to
 * the rest of the structure; the abbreviations are the standard ones (ACS Style Guide, IUPAC
 * recommendations; ChemDraw's own list), and every entry's formula is pinned in labelExpand.test.ts.
 * A label written leftward (H₃CO, HOOC, O₂N, F₃C …), as ChemDraw writes it on the left of a bond, is the
 * same group.
 */

/** Label → SMILES (first atom = attachment). Monovalent groups only. */
const GROUPS: Record<string, string> = {
  // Alkyl and aryl
  Me: "C", CH3: "C", Et: "CC", C2H5: "CC", Pr: "CCC", nPr: "CCC", "n-Pr": "CCC", iPr: "C(C)C", "i-Pr": "C(C)C",
  Bu: "CCCC", nBu: "CCCC", "n-Bu": "CCCC", iBu: "CC(C)C", "i-Bu": "CC(C)C", sBu: "C(C)CC", "s-Bu": "C(C)CC",
  tBu: "C(C)(C)C", "t-Bu": "C(C)(C)C", Ph: "c1ccccc1", C6H5: "c1ccccc1", Bn: "Cc1ccccc1", Bzl: "Cc1ccccc1",
  Cy: "C1CCCCC1", Vinyl: "C=C",
  // Acyl and protecting groups
  Ac: "C(C)=O", Bz: "C(=O)c1ccccc1", Boc: "C(=O)OC(C)(C)C", Cbz: "C(=O)OCc1ccccc1", Fmoc: "C(=O)OCC1c2ccccc2-c2ccccc21",
  Ts: "S(=O)(=O)c1ccc(C)cc1", Tos: "S(=O)(=O)c1ccc(C)cc1", Ms: "S(C)(=O)=O", Tf: "S(=O)(=O)C(F)(F)F",
  TMS: "[Si](C)(C)C", TBS: "[Si](C)(C)C(C)(C)C", TBDMS: "[Si](C)(C)C(C)(C)C", TIPS: "[Si](C(C)C)(C(C)C)C(C)C",
  TBDPS: "[Si](c1ccccc1)(c1ccccc1)C(C)(C)C", PMB: "Cc1ccc(OC)cc1", THP: "C1CCCCO1", MOM: "COC", SEM: "COCC[Si](C)(C)C",
  // Oxygen
  OH: "O", OMe: "OC", OCH3: "OC", OEt: "OCC", OPr: "OCCC", OiPr: "OC(C)C", OtBu: "OC(C)(C)C", OPh: "Oc1ccccc1",
  OBn: "OCc1ccccc1", OAc: "OC(C)=O", OBz: "OC(=O)c1ccccc1", OTs: "OS(=O)(=O)c1ccc(C)cc1", OMs: "OS(C)(=O)=O",
  OTf: "OS(=O)(=O)C(F)(F)F", OTMS: "O[Si](C)(C)C", OTBS: "O[Si](C)(C)C(C)(C)C", OCF3: "OC(F)(F)F", OBoc: "OC(=O)OC(C)(C)C",
  // Carbonyl
  CHO: "C=O", CO2H: "C(=O)O", COOH: "C(=O)O", CO2Me: "C(=O)OC", COOMe: "C(=O)OC", CO2Et: "C(=O)OCC", COOEt: "C(=O)OCC",
  CO2tBu: "C(=O)OC(C)(C)C", CONH2: "C(N)=O", COMe: "C(C)=O", COCl: "C(Cl)=O", CO2Bn: "C(=O)OCc1ccccc1",
  // Nitrogen
  NH2: "N", NHMe: "NC", NMe2: "N(C)C", NHEt: "NCC", NEt2: "N(CC)CC", NHAc: "NC(C)=O", NHBoc: "NC(=O)OC(C)(C)C",
  NHCbz: "NC(=O)OCc1ccccc1", NHPh: "Nc1ccccc1", NHBz: "NC(=O)c1ccccc1", NHTs: "NS(=O)(=O)c1ccc(C)cc1",
  NO2: "[N+](=O)[O-]", CN: "C#N", NCO: "N=C=O", NCS: "N=C=S", N3: "N=[N+]=[N-]",
  // Sulfur, halogenated carbon, others
  SH: "S", SMe: "SC", SPh: "Sc1ccccc1", SO2Me: "S(C)(=O)=O", SO3H: "S(=O)(=O)O", SO2NH2: "S(N)(=O)=O", SO2Cl: "S(Cl)(=O)=O",
  CF3: "C(F)(F)F", CCl3: "C(Cl)(Cl)Cl", CH2OH: "CO", CH2Cl: "CCl", CH2Br: "CBr",
};

/** Leftward forms: the same groups as ChemDraw writes them on the left of a bond. */
const LEFTWARD: Record<string, string> = {
  H3C: "C", H5C2: "CC", HO: "O", MeO: "OC", H3CO: "OC", EtO: "OCC", PhO: "Oc1ccccc1", BnO: "OCc1ccccc1", AcO: "OC(C)=O",
  BzO: "OC(=O)c1ccccc1", TsO: "OS(=O)(=O)c1ccc(C)cc1", MsO: "OS(C)(=O)=O", TfO: "OS(=O)(=O)C(F)(F)F", F3CO: "OC(F)(F)F",
  TBSO: "O[Si](C)(C)C(C)(C)C", TMSO: "O[Si](C)(C)C", tBuO: "OC(C)(C)C", BocO: "OC(=O)OC(C)(C)C",
  OHC: "C=O", HO2C: "C(=O)O", HOOC: "C(=O)O", MeO2C: "C(=O)OC", MeOOC: "C(=O)OC", EtO2C: "C(=O)OCC", EtOOC: "C(=O)OCC",
  tBuO2C: "C(=O)OC(C)(C)C", H2NOC: "C(N)=O", BnO2C: "C(=O)OCc1ccccc1",
  H2N: "N", MeHN: "NC", Me2N: "N(C)C", EtHN: "NCC", Et2N: "N(CC)CC", AcHN: "NC(C)=O", BocHN: "NC(=O)OC(C)(C)C",
  CbzHN: "NC(=O)OCc1ccccc1", PhHN: "Nc1ccccc1", BzHN: "NC(=O)c1ccccc1", TsHN: "NS(=O)(=O)c1ccc(C)cc1",
  O2N: "[N+](=O)[O-]", NC: "C#N", OCN: "N=C=O", SCN: "N=C=S",
  HS: "S", MeS: "SC", PhS: "Sc1ccccc1", MeO2S: "S(C)(=O)=O", HO3S: "S(=O)(=O)O", H2NO2S: "S(N)(=O)=O",
  F3C: "C(F)(F)F", Cl3C: "C(Cl)(Cl)Cl", HOH2C: "CO", ClH2C: "CCl", BrH2C: "CBr",
};

/** The structure a group label stands for, as SMILES with the bonded atom first; null when it is not in the table. */
export function groupSmiles(label: string): string | null {
  const key = label.replace(/\s+/g, "");
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(GROUPS, key)) return GROUPS[key];
  if (Object.prototype.hasOwnProperty.call(LEFTWARD, key)) return LEFTWARD[key];
  return null;
}

/** Every label the table knows (for tests and for the canvas's label list). */
export function groupLabels(): string[] {
  return [...Object.keys(GROUPS), ...Object.keys(LEFTWARD)];
}

/**
 * Names that are not written atom by atom (Me, Ph, Boc, TMS …): they mean the same group whichever side
 * of the bond they are written on. Every other label is a formula read from the bonded atom outward, so
 * which side of the bond it sits on decides its reading (SCN right of a bond is thiocyanate, S-bonded;
 * left of a bond it would be read N-bonded).
 */
const NAMED = new Set([
  "Me", "Et", "Pr", "nPr", "n-Pr", "iPr", "i-Pr", "Bu", "nBu", "n-Bu", "iBu", "i-Bu", "sBu", "s-Bu", "tBu", "t-Bu", "Ph", "Bn", "Bzl", "Cy", "Vinyl",
  "Ac", "Bz", "Boc", "Cbz", "Fmoc", "Ts", "Tos", "Ms", "Tf", "TMS", "TBS", "TBDMS", "TIPS", "TBDPS", "PMB", "THP", "MOM", "SEM",
]);

/**
 * The structure a label stands for, read by the side of the bond it is written on: `left` = the label is
 * written to the left of its bond (its LAST atom is bonded), `right` = to the right (its first atom).
 * A named group reads the same either side; a formula only in its own side's table; null otherwise.
 */
export function groupSmilesBySide(label: string, side: "left" | "right"): string | null {
  const key = label.replace(/\s+/g, "");
  if (!key) return null;
  const own = side === "left" ? LEFTWARD : GROUPS;
  if (Object.prototype.hasOwnProperty.call(own, key)) return own[key];
  if (NAMED.has(key) && Object.prototype.hasOwnProperty.call(GROUPS, key)) return GROUPS[key];
  return null;
}

/** The same group written for the left of a bond (OMe → MeO, CO2H → HO2C), or null (a named group, or none). */
export function leftwardOf(label: string): string | null {
  const key = label.replace(/\s+/g, "");
  if (NAMED.has(key) || !Object.prototype.hasOwnProperty.call(GROUPS, key)) return null;
  const smi = GROUPS[key];
  for (const [k, v] of Object.entries(LEFTWARD)) if (v === smi) return k;
  return null;
}

/** The same group written for the right of a bond (MeO → OMe, SCN → NCS), or null when it has none. */
export function rightwardOf(label: string): string | null {
  const key = label.replace(/\s+/g, "");
  if (!Object.prototype.hasOwnProperty.call(LEFTWARD, key)) return null;
  const smi = LEFTWARD[key];
  for (const [k, v] of Object.entries(GROUPS)) if (v === smi && !NAMED.has(k)) return k;
  return null;
}

/** Whether a label is a group this table knows, on either side (a typed label is checked with this). */
export function isGroupLabel(label: string): boolean {
  return groupSmiles(label) !== null;
}
