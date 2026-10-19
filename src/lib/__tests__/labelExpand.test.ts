// Group labels expanded the way ChemDraw expands them (labelExpand.ts). Each label is drawn bonded to a
// CH3 on a page and read through the converter: the formula is pinned (each was checked by hand against
// the group it names — TMS on CH3 is tetramethylsilane C4H12Si, NO2 on CH3 nitromethane CH3NO2 …).
import { readCdxml } from "../cdxml";
import { pageToMolecule } from "../cdxmlMol";
import { groupLabels, groupSmiles, groupSmilesBySide, leftwardOf } from "../labelExpand";

const ON_METHYL: Record<string, string> = {
  "Me": "C2H6",
  "CH3": "C2H6",
  "Et": "C3H8",
  "C2H5": "C3H8",
  "Pr": "C4H10",
  "nPr": "C4H10",
  "n-Pr": "C4H10",
  "iPr": "C4H10",
  "i-Pr": "C4H10",
  "Bu": "C5H12",
  "nBu": "C5H12",
  "n-Bu": "C5H12",
  "iBu": "C5H12",
  "i-Bu": "C5H12",
  "sBu": "C5H12",
  "s-Bu": "C5H12",
  "tBu": "C5H12",
  "t-Bu": "C5H12",
  "Ph": "C7H8",
  "C6H5": "C7H8",
  "Bn": "C8H10",
  "Bzl": "C8H10",
  "Cy": "C7H14",
  "Vinyl": "C3H6",
  "Ac": "C3H6O",
  "Bz": "C8H8O",
  "Boc": "C6H12O2",
  "Cbz": "C9H10O2",
  "Fmoc": "C16H14O2",
  "Ts": "C8H10O2S",
  "Tos": "C8H10O2S",
  "Ms": "C2H6O2S",
  "Tf": "C2H3O2F3S",
  "TMS": "C4H12Si",
  "TBS": "C7H18Si",
  "TBDMS": "C7H18Si",
  "TIPS": "C10H24Si",
  "TBDPS": "C17H22Si",
  "PMB": "C9H12O",
  "THP": "C6H12O",
  "MOM": "C3H8O",
  "SEM": "C7H18OSi",
  "OH": "CH4O",
  "OMe": "C2H6O",
  "OCH3": "C2H6O",
  "OEt": "C3H8O",
  "OPr": "C4H10O",
  "OiPr": "C4H10O",
  "OtBu": "C5H12O",
  "OPh": "C7H8O",
  "OBn": "C8H10O",
  "OAc": "C3H6O2",
  "OBz": "C8H8O2",
  "OTs": "C8H10O3S",
  "OMs": "C2H6O3S",
  "OTf": "C2H3O3F3S",
  "OTMS": "C4H12OSi",
  "OTBS": "C7H18OSi",
  "OCF3": "C2H3OF3",
  "OBoc": "C6H12O3",
  "CHO": "C2H4O",
  "CO2H": "C2H4O2",
  "COOH": "C2H4O2",
  "CO2Me": "C3H6O2",
  "COOMe": "C3H6O2",
  "CO2Et": "C4H8O2",
  "COOEt": "C4H8O2",
  "CO2tBu": "C6H12O2",
  "CONH2": "C2H5NO",
  "COMe": "C3H6O",
  "COCl": "C2H3OCl",
  "CO2Bn": "C9H10O2",
  "NH2": "CH5N",
  "NHMe": "C2H7N",
  "NMe2": "C3H9N",
  "NHEt": "C3H9N",
  "NEt2": "C5H13N",
  "NHAc": "C3H7NO",
  "NHBoc": "C6H13NO2",
  "NHCbz": "C9H11NO2",
  "NHPh": "C7H9N",
  "NHBz": "C8H9NO",
  "NHTs": "C8H11NO2S",
  "NO2": "CH3NO2",
  "CN": "C2H3N",
  "NCO": "C2H3NO",
  "NCS": "C2H3NS",
  "N3": "CH3N3",
  "SH": "CH4S",
  "SMe": "C2H6S",
  "SPh": "C7H8S",
  "SO2Me": "C2H6O2S",
  "SO3H": "CH4O3S",
  "SO2NH2": "CH5NO2S",
  "SO2Cl": "CH3O2ClS",
  "CF3": "C2H3F3",
  "CCl3": "C2H3Cl3",
  "CH2OH": "C2H6O",
  "CH2Cl": "C2H5Cl",
  "CH2Br": "C2H5Br",
  "H3C": "C2H6",
  "H5C2": "C3H8",
  "HO": "CH4O",
  "MeO": "C2H6O",
  "H3CO": "C2H6O",
  "EtO": "C3H8O",
  "PhO": "C7H8O",
  "BnO": "C8H10O",
  "AcO": "C3H6O2",
  "BzO": "C8H8O2",
  "TsO": "C8H10O3S",
  "MsO": "C2H6O3S",
  "TfO": "C2H3O3F3S",
  "F3CO": "C2H3OF3",
  "TBSO": "C7H18OSi",
  "TMSO": "C4H12OSi",
  "tBuO": "C5H12O",
  "BocO": "C6H12O3",
  "OHC": "C2H4O",
  "HO2C": "C2H4O2",
  "HOOC": "C2H4O2",
  "MeO2C": "C3H6O2",
  "MeOOC": "C3H6O2",
  "EtO2C": "C4H8O2",
  "EtOOC": "C4H8O2",
  "tBuO2C": "C6H12O2",
  "H2NOC": "C2H5NO",
  "BnO2C": "C9H10O2",
  "H2N": "CH5N",
  "MeHN": "C2H7N",
  "Me2N": "C3H9N",
  "EtHN": "C3H9N",
  "Et2N": "C5H13N",
  "AcHN": "C3H7NO",
  "BocHN": "C6H13NO2",
  "CbzHN": "C9H11NO2",
  "PhHN": "C7H9N",
  "BzHN": "C8H9NO",
  "TsHN": "C8H11NO2S",
  "O2N": "CH3NO2",
  "NC": "C2H3N",
  "OCN": "C2H3NO",
  "SCN": "C2H3NS",
  "HS": "CH4S",
  "MeS": "C2H6S",
  "PhS": "C7H8S",
  "MeO2S": "C2H6O2S",
  "HO3S": "CH4O3S",
  "H2NO2S": "CH5NO2S",
  "F3C": "C2H3F3",
  "Cl3C": "C2H3Cl3",
  "HOH2C": "C2H6O",
  "ClH2C": "C2H5Cl",
  "BrH2C": "C2H5Br"
};

const formulaOf = (label: string, nodeType: string): string => {
  // A label written for the left of a bond is drawn left of its methyl (its neighbour to its right).
  if (!groupSmilesBySide(label, "right") && groupSmilesBySide(label, "left")) {
    const d2 = readCdxml(`<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="30 0"/><n id="2" p="0 0" NodeType="${nodeType}"><t p="0 0"><s font="3" size="10">${label}</s></t></n><b id="3" B="1" E="2"/></fragment></page></CDXML>`);
    if (!d2.ok) throw new Error(d2.reason);
    const r2 = pageToMolecule(d2.doc);
    return r2.ok ? r2.value.mol.getMolecularFormula().formula : r2.reason;
  }
  const d = readCdxml(`<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0" NodeType="${nodeType}"><t p="30 0"><s font="3" size="10">${label}</s></t></n><b id="3" B="1" E="2"/></fragment></page></CDXML>`);
  if (!d.ok) throw new Error(d.reason);
  const r = pageToMolecule(d.doc);
  return r.ok ? r.value.mol.getMolecularFormula().formula : r.reason;
};

test("every group in the table, bonded to a methyl, gives the formula of the group it names", () => {
  expect(Object.keys(ON_METHYL).sort()).toEqual(groupLabels().sort());
  for (const [label, formula] of Object.entries(ON_METHYL)) expect([label, formulaOf(label, "Unspecified")]).toEqual([label, formula]);
});
test("an abbreviation node (Nickname) with no structure inside is expanded the same way", () => {
  expect(formulaOf("Boc", "Nickname")).toBe("C6H12O2");
});
test("labels not in the table are refused by name, never parsed by rule; a group drawn with two bonds is refused", () => {
  expect(formulaOf("CH2CH2OH", "Unspecified")).toBe("“CH2CH2OH” is not an element, an R-group or a group label this knows (OMe, Ph, Boc, CO2H …)");
  expect(groupSmiles("__proto__")).toBeNull();
  const d = readCdxml('<CDXML BondLength="30"><page id="1"><fragment id="10"><n id="1" p="0 0"/><n id="2" p="30 0" NodeType="Unspecified"><t p="30 0"><s font="3" size="10">OMe</s></t></n><n id="4" p="60 0"/><b id="3" B="1" E="2"/><b id="5" B="2" E="4"/></fragment></page></CDXML>');
  const r = d.ok ? pageToMolecule(d.doc) : null;
  expect(r && !r.ok && r.reason).toBe("“OMe” stands for a group with one bond, but it is drawn with 2");
});

test("a formula label is read by the side of its bond (review: SCN right of a bond is thiocyanate, not isothiocyanate); named groups read either side", () => {
  // Right of the bond: bonded at its first letter.
  expect(groupSmilesBySide("SCN", "right")).toBeNull(); // thiocyanate is not in the table: refused, never the wrong isomer
  expect(groupSmilesBySide("NCS", "right")).toBe("N=C=S");
  expect(groupSmilesBySide("SCN", "left")).toBe("N=C=S"); // written left of a bond, SCN is N-bonded: isothiocyanate
  expect(groupSmilesBySide("CN", "right")).toBe("C#N");
  expect(groupSmilesBySide("CN", "left")).toBeNull();
  expect(groupSmilesBySide("Ph", "left")).toBe("c1ccccc1");
  expect(leftwardOf("OMe")).toBe("MeO");
  expect(leftwardOf("Ph")).toBeNull();
});
