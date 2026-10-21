// Compound tables from the register: the right compounds in the right order, each column computed from the stored
// structure, the names from the dictionary or the namer (or "—" with the reason), selections and refusals by name.
import { Molecule } from "openchemlib/full";
import { buildCompoundTable, selectLabels, structureName, structureSvg } from "../compoundTable";
import type { CompoundRegister, RegisteredCompound } from "../compoundRegister";
import { formulaText } from "../scheme";

const entry = (label: string, smiles: string, text = smiles): RegisteredCompound => {
  const m = Molecule.fromSmiles(smiles);
  m.inventCoordinates();
  return { label, idcode: m.getIDCode(), smiles: m.toIsomericSmiles(), formula: formulaText(m), text };
};
const REG: CompoundRegister = {
  entries: [
    entry("3", "C[C@@H](O)CC", "(R)-butan-2-ol"),
    entry("1", "CC(=O)Oc1ccccc1C(=O)O", "aspirin"),
    entry("2a", "OC(=O)c1ccc2ccccc2c1"),
    entry("2", "C[N+](C)(C)C"),
    entry("10", "c1ccc2c(c1)C3(C4=CC=CC=C4O3)CC2"),
  ],
};

describe("buildCompoundTable", () => {
  test("rows in compound-number order; the number first, the chosen columns, then the chemist's own", () => {
    const t = buildCompoundTable(REG, { columns: ["name", "formula", "mw", "exact", "mh"], extra: ["IC50 (nM)"] });
    expect(t.errors).toEqual([]);
    expect(t.header).toEqual(["Compound", "Name", "Formula", "MW (g/mol)", "Exact mass (Da)", "[M + H]⁺ (m/z)", "IC50 (nM)"]);
    expect(t.rows.map((r) => r.label)).toEqual(["1", "2", "2a", "3", "10"]);
    const aspirin = t.rows[0].cells;
    expect(aspirin[1]).toMatch(/aspirin|acetylsalicylic|acetyloxy/i);
    expect(aspirin[2]).toBe("C₉H₈O₄");
    expect(aspirin[3]).toBe("180.16");
    expect(aspirin[4]).toBe("180.0423");
    expect(aspirin[5]).toBe("181.0495");
    expect(aspirin[6]).toBe("");
  });
  test("the systematic name keeps its stereodescriptor; a fused parent is named; a charged compound has no [M + H]⁺", () => {
    const t = buildCompoundTable(REG, { columns: ["name", "mh"] });
    const row = (l: string) => t.rows.find((r) => r.label === l)!.cells;
    expect(row("3")[1]).toBe("(2R)-butan-2-ol");
    expect(row("2a")[1]).toBe("naphthalene-2-carboxylic acid");
    expect(row("2")[2]).toBe("—");
    expect(t.notes.join(" ")).toMatch(/Compound 2 carries a charge/);
  });
  test("a structure outside the namer is “—”, and the note names it", () => {
    const t = buildCompoundTable(REG, { columns: ["name"] });
    expect(t.rows.find((r) => r.label === "10")!.cells[1]).toBe("—");
    expect(t.notes.join(" ")).toMatch(/No systematic name for compounds 2, 10 /);
    expect(t.notes.join(" ")).toMatch(/verify them before filing/);
  });
  test("the structure column: an ACS-style drawing per compound, sized in points", () => {
    const t = buildCompoundTable(REG, { columns: ["structure", "formula"], select: "1" });
    expect(t.structureCol).toBe(1);
    const s = t.rows[0].structure!;
    expect(s.svg).toMatch(/^<svg/);
    expect(s.widthPt).toBeGreaterThan(40);
    expect(s.widthPt).toBeLessThan(300);
    expect(s.svg).not.toMatch(/NaN|Infinity/);
  });
  test("selections: ranges take plain numbers, labels by name, primes normalised; unknown labels named", () => {
    expect(selectLabels(REG, "1-3").labels).toEqual(["1", "2", "3"]);
    expect(selectLabels(REG, "2a, 10").labels).toEqual(["2a", "10"]);
    expect(selectLabels(REG, "").labels).toEqual(["1", "2", "2a", "3", "10"]);
    const bad = selectLabels(REG, "1, 99");
    expect(bad.labels).toEqual(["1"]);
    expect(bad.errors.join(" ")).toMatch(/no compound 99/);
    const t = buildCompoundTable(REG, { columns: ["formula"], select: "99" });
    expect(t.errors.join(" ")).toMatch(/no compound 99/);
  });
  test("an empty register says how it fills", () => {
    expect(buildCompoundTable({ entries: [] }, { columns: ["name"] }).errors.join(" ")).toMatch(/Reaction scheme/);
  });
  test("structureName and structureSvg on their own", () => {
    expect(structureName(entry("x", "CCO").idcode).name).toMatch(/ethanol/i);
    expect(structureSvg("not a smiles")).toBeNull();
  });
});
