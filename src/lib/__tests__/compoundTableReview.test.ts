// The independent review of the compound table, pinned: masses from the structure (not a text lookup), salts and ions,
// dictionary names in the right case and with their stereochemistry, damaged entries, selections, the user's own
// columns, and the cell sizing.
import { Molecule } from "openchemlib/full";
import { buildCompoundTable, selectLabels, structureName } from "../compoundTable";
import type { CompoundRegister, RegisteredCompound } from "../compoundRegister";
import { formulaText } from "../scheme";
import { fitCell, splitHeadings, CELL_MAX_W, CELL_MAX_H } from "../../taskpane/compoundTablePane";

const entry = (label: string, smiles: string): RegisteredCompound => {
  const m = Molecule.fromSmiles(smiles);
  m.inventCoordinates();
  return { label, idcode: m.getIDCode(), smiles: m.toIsomericSmiles(), formula: formulaText(m), text: smiles };
};
const table = (entries: RegisteredCompound[], columns: Parameters<typeof buildCompoundTable>[1]["columns"]) => buildCompoundTable({ entries }, { columns });
const idc = (smiles: string) => entry("x", smiles).idcode;

describe("masses", () => {
  test("methanol (SMILES CO) has methanol's masses, not carbon monoxide's", () => {
    const t = table([entry("1", "CO")], ["mw", "exact", "mh"]);
    expect(t.rows[0].cells).toEqual(["1", "32.04", "32.0262", "33.0335"]);
  });
  test("a salt or mixture: no exact mass or [M + H]⁺, and a note", () => {
    const t = table([entry("1", "CN.Cl"), entry("2", "CC(=O)[O-].[Na+]")], ["exact", "mh"]);
    expect(t.rows.map((r) => r.cells.slice(1))).toEqual([
      ["—", "—"],
      ["—", "—"],
    ]);
    expect(t.notes.join(" ")).toMatch(/Compound 1 has more than one component \(a salt\?\)/);
  });
  test("a cation's exact mass is the ion's (electron mass counted)", () => {
    const t = table([entry("1", "C[N+](C)(C)C")], ["exact", "mh"]);
    expect(t.rows[0].cells[1]).toBe("74.0964");
    expect(t.rows[0].cells[2]).toBe("—");
  });
  test("aspirin still 180.16 / 180.0423 / 181.0495", () => {
    expect(table([entry("1", "CC(=O)Oc1ccccc1C(=O)O")], ["mw", "exact", "mh"]).rows[0].cells).toEqual(["1", "180.16", "180.0423", "181.0495"]);
  });
  test("an empty SMILES has no MW (“—”, not 0.00)", () => {
    const t = buildCompoundTable({ entries: [{ label: "1", idcode: idc("CCO"), smiles: "", formula: "C2H6O", text: "" }] }, { columns: ["mw"] });
    expect(t.rows[0].cells[1]).toBe("—");
  });
  test("headers carry units", () => {
    expect(table([entry("1", "CCO")], ["mw", "exact"]).header).toEqual(["Compound", "MW (g/mol)", "Exact mass (Da)"]);
  });
});

describe("names", () => {
  test("dictionary names in the case chemists write them", () => {
    expect(structureName(idc("Cc1ccccc1C")).name).toBe("o-xylene");
    expect(structureName(idc("CS(C)=O")).name).toMatch(/^(DMSO|dimethyl sulfoxide)$/);
    expect(structureName(idc("CCO")).name).toBe("ethanol");
  });
  test("the two enantiomers of alanine are named alike (both with their descriptor)", () => {
    const l = structureName(idc("C[C@H](N)C(=O)O")).name!, d = structureName(idc("C[C@@H](N)C(=O)O")).name!;
    expect(l).toMatch(/^\(2S\)/);
    expect(d).toMatch(/^\(2R\)/);
  });
  test("an unreadable stored structure says so, not “outside what the namer covers”", () => {
    const t = buildCompoundTable({ entries: [{ label: "1", idcode: "not-an-idcode", smiles: "CCO", formula: "C2H6O", text: "" }] }, { columns: ["name"] });
    expect(t.notes.join(" ")).toMatch(/Compound 1: the stored structure could not be read/);
    expect(t.notes.join(" ")).not.toMatch(/outside what the offline namer covers/);
  });
});

describe("selections, columns, cells", () => {
  const reg: CompoundRegister = { entries: [entry("1", "C"), entry("2", "CC"), entry("3", "CCC"), entry("S1", "CCCC")] };
  test("commas only is an error, not an empty table", () => {
    expect(selectLabels(reg, " , , ").errors[0]).toMatch(/^No compounds chosen/);
  });
  test("a minus-sign range and a lower-case label", () => {
    expect(selectLabels(reg, "1−2, s1").labels).toEqual(["1", "2", "S1"]);
  });
  test("a heading with a comma in brackets stays one; more than eight are named", () => {
    expect(splitHeadings("IC50 (nM, HEK293), Yield (%)")).toEqual(["IC50 (nM, HEK293)", "Yield (%)"]);
    const t = buildCompoundTable(reg, { columns: [], extra: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });
    expect(t.header).toHaveLength(9);
    expect(t.notes.join(" ")).toMatch(/Up to 8 columns of your own: “i” left out/);
  });
  test("fitCell: a size that is not a drawing's gets the cell's own", () => {
    for (const [w, h] of [[0, 0], [-5, 10], [NaN, 4], [Infinity, 3]]) expect(fitCell(w, h)).toEqual({ w: CELL_MAX_W, h: CELL_MAX_H });
  });
});

describe("round 2", () => {
  test("an achiral compound keeps its dictionary name even when the namer's name opens with a bracket", () => {
    expect(structureName(idc("CC(C)c1ccccc1")).name).toBe("cumene");
  });
  test("an E/Z-only structure keeps its common name; R/S still takes the descriptor-bearing name", () => {
    expect(structureName(idc("O=C/C=C/c1ccccc1")).name).toBe("cinnamaldehyde");
    expect(structureName(idc("C[C@H](N)C(=O)O")).name).toMatch(/^\(2S\)/);
  });
});
