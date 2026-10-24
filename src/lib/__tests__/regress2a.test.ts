// Round-2 regression fixes (2026-10-24 regression review, items 2, 6, 7, 8). Each row was right on e34ce0b (v2.193.0)
// and wrong after the round-2 fixes; each block pins BOTH the base-correct outcome and the round-2 fix's intent.
import { checkSmiles, renderStructure, resolveChemInput, resolveStructure } from "../structures";
import { smilesSpec } from "../massspec";
import { balanceText, BalanceResult, BalanceOk } from "../balance";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";

const THIN = String.fromCharCode(0x2009);

function ok(r: BalanceResult): BalanceOk {
  if (!r.ok) throw new Error(`refused (${r.kind}): ${r.message}`);
  return r;
}

/** Element counts of a formula string, Hill order and charge marks ignored. */
function counts(f: string): Record<string, number> {
  const c: Record<string, number> = {};
  for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) c[m[1]] = (c[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  return c;
}

describe("2 — porphyrin-type aromatic SMILES kekulise (a real matching decides, not OpenChemLib's radical flag)", () => {
  // Formulas from RDKit 2024 (CalcMolFormula); the SMILES are RDKit canonical / NCI forms, which RDKit kekulises.
  test.each([
    ["porphine", "C1=Cc2cc3ccc(cc4ccc(cc5nc(cc1n2)C=C5)[nH]4)[nH]3", "C20H14N4"],
    ["porphine, all aromatic", "c1cc2cc3ccc(cc4ccc(cc5ccc(cc1n2)[nH]5)n4)[nH]3", "C20H14N4"],
    ["tetraphenylporphyrin", "C1=Cc2nc1c(-c1ccccc1)c1ccc([nH]1)c(-c1ccccc1)c1nc(c(-c3ccccc3)c3ccc([nH]3)c2-c2ccccc2)C=C1", "C44H30N4"],
    ["zinc porphyrin", "c1cc2cc3ccc4n3[Zn]n3c(cc5ccc(cc1n2)n5)ccc3c4", "C20H12N4Zn"],
    ["phthalocyanine", "c1ccc2c(c1)-c1nc3nc(nc4[nH]c(nc5[nH]c(nc-2n1)c1ccccc51)c1ccccc41)-c1ccccc1-3", "C32H18N8"],
    ["protoporphyrin IX", "C=CC1=C(C)c2cc3[nH]c(cc4nc(cc5[nH]c(cc1n2)c(C)c5C=C)C(C)=C4CCC(=O)O)c(CCC(=O)O)c3C", "C34H34N4O4"],
    ["heme, RDKit canonical", "C=CC1=C(C)c2cc3[n-]c(cc4nc(cc5[n-]c(cc1n2)c(C)c5C=C)C(C)=C4CCC(=O)O)c(CCC(=O)O)c3C.[Fe+2]", "C34H32FeN4O4"],
    [
      "chlorophyll a, RDKit canonical",
      "C=Cc1c(C)c2cc3nc(c4c5[n-]c(cc6nc(cc1[n-]2)C(C)=C6CC)c(C)c5C(=O)[C@@H]4C(=O)OC)[C@@H](CCC(=O)OC/C=C(\\C)CCC[C@H](C)CCC[C@H](C)CCCC(C)C)[C@@H]3C.[Mg+2]",
      "C55H72MgN4O5",
    ],
  ])("%s", (_name, smiles, formula) => {
    const c = checkSmiles(smiles);
    if (!c.ok) throw new Error(c.message);
    expect(counts(c.mol.getMolecularFormula().formula)).toEqual(counts(formula));
    const r = renderStructure(`smiles:${smiles}`);
    expect(r).not.toBeNull();
    expect(counts(r!.formula.replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, ""))).toEqual(counts(formula));
    expect(resolveStructure(smiles).kind).toBe("ok");
  });

  test("the drawing is repaired too: porphine has no leftover radical carbon (base drew a 'CH' label)", () => {
    const r = renderStructure("smiles:C1=Cc2cc3ccc(cc4ccc(cc5nc(cc1n2)C=C5)[nH]4)[nH]3")!;
    expect(r.svg).not.toMatch(/>C<\/text>/);
    expect(r.svg).not.toMatch(/\[nH\]/);
  });

  test("round-2 intent kept: aromatic SMILES with no Kekulé form are still refused by name", () => {
    for (const s of ["c1ccnc1", "n1cccc1", "c1cccc1", "c1cccccc1", "c1ccc2c(c1)ccc2"]) {
      const c = checkSmiles(s);
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.message).toMatch(/does not kekulise/);
    }
    for (const s of ["c1ccccc1c", "c1cccnc1c"]) {
      const c = checkSmiles(s);
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.message).toMatch(/in no ring/);
    }
  });

  test("ordinary aromatics, charged rings and exocyclic C=O are unchanged", () => {
    for (const [s, f] of [
      ["Cn1cnc2c1c(=O)n(C)c(=O)n2C", "C8H10N4O2"],
      ["O=c1cc[nH]c(=O)[nH]1", "C4H4N2O2"],
      ["C[n+]1ccccc1", "C6H8N"],
      ["[cH+]1cccccc1", "C7H7"],
      ["c1cc[n-]c1", "C4H4N"],
      ["c1cc2ccc3cccc4ccc(c1)c2c34", "C16H10"],
    ]) {
      const c = checkSmiles(s);
      if (!c.ok) throw new Error(c.message);
      expect(counts(c.mol.getMolecularFormula().formula)).toEqual(counts(f));
    }
  });
});

describe("6 — a typed formula gets no false ring-bond SMILES error", () => {
  test.each(["SF6", "CO2", "BF3", "PCl5", "S8", "P4O10", "N2O4", "C3O2", "CS2", "CCl4", "OF2", "Cl2O7"])("%s", (f) => {
    expect(smilesSpec(f)).toBeNull();
    const c = checkSmiles(f);
    if (!c.ok) expect(c.message).not.toMatch(/ring bond/);
    const r = resolveChemInput(f);
    expect(JSON.stringify(r)).not.toMatch(/ring bond|As SMILES/);
  });

  test("round-2 intent kept: an unclosed ring in SMILES is still refused", () => {
    for (const s of ["C1CC", "C1CCC", "N1CC", "O1CC"]) {
      const c = checkSmiles(s);
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.message).toMatch(/ring bond 1 is opened but never closed/);
    }
  });
});

describe("7 — a full equation in a medium names only what was added, and electrons only for a redox", () => {
  test("AgNO3 + NaCl in acid: nothing added, no redox, no dash", () => {
    const r = ok(balanceText("AgNO3 + NaCl -> AgCl + NaNO3 in acid"));
    expect(r.equation).toBe("AgNO₃ + NaCl → AgCl + NaNO₃");
    const notes = r.notes.join(" ");
    expect(notes).not.toMatch(/were added|was added/);
    expect(notes).not.toMatch(/electron/);
    expect(notes).not.toContain("—");
  });

  test("Zn + Cu²⁺ in acid: nothing added, but it IS a redox", () => {
    const r = ok(balanceText("Zn + Cu^2+ -> Zn^2+ + Cu in acid"));
    expect(r.equation).toBe("Zn + Cu²⁺ → Zn²⁺ + Cu");
    const notes = r.notes.join(" ");
    expect(notes).not.toMatch(/were added|was added/);
    expect(notes).toMatch(/no free electrons/);
  });

  test("HCl + NaOH in acid: the typed H₂O is not called added", () => {
    const notes = ok(balanceText("HCl + NaOH -> NaCl + H2O in acid")).notes.join(" ");
    expect(notes).not.toMatch(/added where needed/);
    expect(notes).not.toMatch(/electron/);
  });

  test("round-2 intent kept: MnO₄⁻ + Fe²⁺ in acid names H⁺ and H₂O and keeps the electron sentence, no dash", () => {
    const r = ok(balanceText("MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+ in acid"));
    expect(r.equation).toBe("MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O");
    const notes = r.notes.join(" ");
    expect(notes).toMatch(/H⁺ and H₂O were added where needed/);
    expect(notes).toMatch(/no free electrons/);
    expect(notes).not.toContain("—");
  });
});

describe("8 — the plane-angle degree sign sits against its number; the degree scales keep their thin space", () => {
  test.each(["alpha = 45°", "alpha = 45 °", "30 deg"])("%s", (dsl) => {
    expect(mathToHtml(dsl)).toMatch(/(45|30)°/);
    expect(mathToHtml(dsl)).not.toContain("&#8201;");
    expect(mathToOmml(dsl)).not.toContain(THIN);
  });

  test.each([
    ["25 °C", "°C"],
    ["25°C", "°C"],
    ["25 deg C", "°C"],
    ["-40 °F", "°F"],
  ])("%s keeps U+2009 before %s (SI: 25 °C)", (dsl, unit) => {
    expect(mathToHtml(dsl)).toContain(`&#8201;${unit}`);
    expect(mathToOmml(dsl)).toContain(THIN + unit);
  });
});
