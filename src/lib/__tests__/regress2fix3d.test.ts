// Round-2 regression fixes (fix3d): defects in the porphyrin kekulisation (909d251) and its balance note. Each block
// pins BOTH the behaviour that was right before (RDKit's verdict; base 69a5275) AND the round-2 fix's intent
// (porphyrins, heme and chlorophyll still draw). Verdicts and formulas checked against RDKit 2024 (MolFromSmiles).
import { Molecule } from "openchemlib";
import { checkSmiles, renderStructure, resolveStructure } from "../structures";
import { balanceText, BalanceResult, BalanceOk } from "../balance";

function counts(f: string): Record<string, number> {
  const c: Record<string, number> = {};
  for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) c[m[1]] = (c[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
  return c;
}

function radicals(m: Molecule): number {
  let n = 0;
  for (let i = 0; i < m.getAllAtoms(); i++) if (m.getAtomRadical(i)) n++;
  return n;
}

/** Accepted with RDKit's formula, and neither the checked nor the DRAWN molecule (re-read from `parsed`) has a radical. */
function accepted(smiles: string, formula: string): void {
  const c = checkSmiles(smiles);
  if (!c.ok) throw new Error(`${smiles}: ${c.message}`);
  expect(counts(c.mol.getMolecularFormula().formula)).toEqual(counts(formula));
  expect(radicals(c.mol)).toBe(0);
  expect(radicals(Molecule.fromSmiles(c.parsed))).toBe(0);
}

function refused(smiles: string): string {
  const c = checkSmiles(smiles);
  expect(c.ok).toBe(false);
  return c.ok ? "" : c.message;
}

function ms(f: () => unknown): number {
  const t = performance.now();
  f();
  return performance.now() - t;
}

// Benzenoids built on a honeycomb (RDKit wrote the SMILES). The "minus" ones are odd or have no perfect matching, with
// every atom still in a ring, so only a real matching can refuse them; the old 200000-step backtracking ran out of
// budget on them and ACCEPTED OpenChemLib's radical after 1–2.6 s.
const FLAKE96 =
  "c12c3ccc4c1c1c5c(c4)cc4c6c5c5c7c1c1c2c2c(c3)cc3c8c2c2c1c1c7c7c9c5c5c6c(cc4)cc4c5c5c9c6c9c7c7c1c1c2c2c8c(cc3)cc3c2c2c1c1c7c7c9c8c9c6c6c5c(c4)ccc6cc9cc4c8c5c7c6c1c1c2c(c3)ccc1cc6cc5cc4";
const FLAKE96_MINUS_CH =
  "c12cccc3c1c1c4c(c3)cc3c5c4c4c6c1c1c2c2ccc7c8c2c2c1c1c6c6c9c4c4c5c(cc3)cc3c4c4c9c5c9c6c6c1c1c2c2c8c(cc7)cc7c2c2c1c1c6c6c9c8c9c5c5c4c(c3)ccc5cc9cc3c8c4c6c5c1c1c2c(c7)ccc1cc5cc4cc3";
const RHOMBUS198 =
  "c12c3cccc1cc1c4c2c2c(c3)cc3c5c2c2c4c4c(c1)cc1c6c4c4c2c2c5c5c(c3)cc3c7c5c5c2c2c4c4c6c6c(c1)cc1c8c6c6c4c4c2c2c5c5c7c7c(c3)cc3c9c7c7c5c5c2c2c4c4c6c6c8c8c(c1)cc1c%10c8c8c6c6c4c4c2c2c5c5c7c7c9c9c(c3)ccc3c9c9c7c7c5c5c2c2c4c4c6c6c8c8c%10c(cc1)cc1c8c8c6c6c4c4c2c2c5c5c7c7c9c(c3)cc3c7c7c5c5c2c2c4c4c6c6c8c(c1)cc1c6c6c4c4c2c2c5c5c7c(c3)cc3c5c5c2c2c4c4c6c(c1)cc1c4c4c2c2c5c(c3)cc3c2c2c4c(c1)cc1c2c(c3)ccc1";
const RHOMBUS_MINUS_TWO =
  "c12ccc3c4c1c1c(cc2)cc2c5c1c1c4c4c(c3)cc3c6c4c4c1c1c5c5c(c2)cc2c7c5c5c1c1c4c4c6c6c(c3)cc3c8c6c6c4c4c1c1c5c5c7c7c(c2)cc2c9c7c7c5c5c1c1c4c4c6c6c8c8c(c3)ccc3c8c8c6c6c4c4c1c1c5c5c7c7c9c9c(c2)ccc2c9c9c7c7c5c5c1c1c4c4c6c6c8c8c3ccc3c8c8c6c6c4c4c1c1c5c5c7c7c9c(c2)cc2c7c7c5c5c1c1c4c4c6c6c8c(c3)cc3c6c6c4c4c1c1c5c5c7c(c2)cc2c5c5c1c1c4c4c6c(c3)cc3c4c4c1c1c5c(c2)cc2c1c1c4c(c3)cc3c1c(c2)ccc3";

describe("1: kekulisation is an exact matching: no search budget, no radical accepted, fast", () => {
  test.each([
    ["C₉₆ flake minus one CH (95 atoms, all in rings)", FLAKE96_MINUS_CH],
    ["C₉₆ flake + cyclopentadienyl", `${FLAKE96}.c1cccc1`],
    ["C₉₆ flake bonded to a C₅ ring", `${FLAKE96}-c%96cccc%96`],
    ["C₁₉₈ rhombus + cyclopentadienyl", `${RHOMBUS198}.c1cccc1`],
    ["C₁₉₈ rhombus minus two same-colour CH (even, no perfect matching)", RHOMBUS_MINUS_TWO],
  ])("%s is refused (RDKit: Can't kekulize) in well under the old 1–2.6 s", (_name, smiles) => {
    const t = ms(() => expect(refused(smiles)).toMatch(/does not kekulise/));
    const tr = ms(() => expect(renderStructure(`smiles:${smiles}`)).toBeNull());
    const ts = ms(() => expect(resolveStructure(smiles).kind).not.toBe("ok"));
    expect(t).toBeLessThan(300);
    expect(tr).toBeLessThan(300);
    expect(ts).toBeLessThan(300);
  });

  test("triangulenes (non-Kekulé) and an odd annulene are refused", () => {
    refused("c12c3cccc1cc1c4c2c2c(c3)cccc2cc4ccc1");
    refused("c1ccc2cccc3cccc1c23");
    refused(`c1${"c".repeat(197)}c1`);
  });

  test("base-correct acceptances kept: big benzenoids, C₆₀, [200]annulene, polythiophene", () => {
    accepted(FLAKE96, "C96H24");
    accepted(RHOMBUS198, "C198H38");
    accepted("c12c3c4c5c1c1c6c7c2c2c8c3c3c9c4c4c%10c5c5c1c1c6c6c%11c7c2c2c7c8c3c3c8c9c4c4c9c%10c5c5c1c1c6c6c%11c2c2c7c3c3c8c4c4c9c5c1c1c6c2c3c41", "C60");
    accepted(`c1${"c".repeat(198)}c1`, "C200H200");
    accepted(`c1ccc(s1)${"-c1ccc(s1)".repeat(28)}-c1cccs1`, "C120H62S30");
  });
});

describe("2: a bond between aromatic atoms that is in no ring is single", () => {
  test("c1cccc1c1cccc1 is refused, not drawn as fulvalene (RDKit and base refuse)", () => {
    expect(refused("c1cccc1c1cccc1")).toMatch(/does not kekulise/);
  });
  test("biphenyl, written either way, is unchanged", () => {
    accepted("c1ccccc1c1ccccc1", "C12H10");
    accepted("c1ccccc1-c1ccccc1", "C12H10");
  });
});

describe("3: charged aromatic atoms follow RDKit's kekulisation rules", () => {
  test.each(["[c-]1cccc1", "[cH]1cccc1", "[n+]1cccc1", "[nH+]1cccc1", "c1ccc[n+]1C"])("%s is refused (RDKit: Can't kekulize)", (s) => {
    const c = checkSmiles(s);
    expect(c.ok).toBe(false);
  });
  test.each([
    ["[cH-]1cccc1", "C5H5"],
    ["[cH-]1cccc1.[cH-]1cccc1.[Fe+2]", "C10H10Fe"],
    ["c1cc[nH+]cc1", "C5H6N"],
    ["C[n+]1ccccc1", "C6H8N"],
    ["[O-][n+]1ccccc1", "C5H5NO"],
    ["[o+]1ccccc1", "C5H5O"],
    ["[s+]1ccccc1", "C5H5S"],
    ["[cH+]1cccccc1", "C7H7"],
    ["c1cc[n-]c1", "C4H4N"],
    ["C[n+]1cc[nH]c1", "C4H7N2"],
  ])("%s is accepted as %s", (s, f) => accepted(s, f));
});

describe("8: an explicit [H] atom is counted, so porphine draws with no radical", () => {
  test.each([
    ["[H]c1cc2cc3ccc(cc4ccc(cc5ccc(cc1n2)[nH]5)n4)[nH]3", "C20H14N4"],
    ["[H]c1cc2cc3ccc(cc4ccc(cc5ccc(cc1n2)[nH]5)n4)[nH]3.[H][H]", "C20H16N4"],
    ["c%10cc2cc3ccc(cc4ccc(cc5ccc(cc%10n2)[nH]5)n4)[nH]3", "C20H14N4"],
    ["c1:c:c2:c:c3:c:c:c(:c:c4:c:c:c(:c:c5:c:c:c(:c:c:1:n:2):[nH]:5):n:4):[nH]:3", "C20H14N4"],
    ["[13cH]1cc2cc3ccc(cc4ccc(cc5ccc(cc1n2)[nH]5)n4)[nH]3", "C20H14N4"],
    ["c1cc2cc3ccc(cc4ccc(cc5ccc(cc1[nH+]2)[nH]5)n4)[nH]3", "C20H15N4"],
    ["C[C@H](O)c1cc2cc3ccc(cc4ccc(cc5ccc(cc1n2)[nH]5)n4)[nH]3", "C22H18N4O"],
    ["c1ccc(-c2c3ccc(n3)c(-c3ccccc3)c3ccc([nH]3)c(-c3ccccc3)c3ccc(n3)c(-c3ccccc3)c3ccc2[nH]3)cc1", "C44H30N4"],
    ["[pH]1cccc1", "C4H5P"],
  ])("%s", (s, f) => {
    accepted(s, f);
    const r = renderStructure(`smiles:${s}`);
    expect(r).not.toBeNull();
    // A lone "C" label is OpenChemLib marking a radical carbon (the ¹³C row is labelled for its isotope instead).
    if (!s.includes("13c")) expect(r!.svg).not.toMatch(/>C<\/text>/);
  });
  test("a deliberate bracket radical beside an aromatic ring keeps its base reading (benzyl radical)", () => {
    const c = checkSmiles("[CH2]c1ccccc1");
    if (!c.ok) throw new Error(c.message);
    expect(counts(c.mol.getMolecularFormula().formula)).toEqual(counts("C7H7"));
  });
});

function ok(r: BalanceResult): BalanceOk {
  if (!r.ok) throw new Error(`refused (${r.kind}): ${r.message}`);
  return r;
}
const ELECTRONS = /electrons lost and gained/;

describe("6: the electron sentence only where a redox is shown (a mixed-valence average proves nothing)", () => {
  test.each([
    ["Fe3O4 + H+ -> Fe^2+ + Fe^3+ + H2O in acid", "Fe₃O₄ + 8 H⁺ → Fe²⁺ + 2 Fe³⁺ + 4 H₂O"],
    ["Pb3O4 + H+ -> Pb^2+ + PbO2 + H2O in acid", "Pb₃O₄ + 4 H⁺ → 2 Pb²⁺ + PbO₂ + 2 H₂O"],
    ["Fe2+ + Fe3+ + H2O -> Fe3O4 + H+ in acid", "Fe²⁺ + 2 Fe³⁺ + 4 H₂O → Fe₃O₄ + 8 H⁺"],
    ["AgNO3 + NaCl -> AgCl + NaNO3 in acid", "AgNO₃ + NaCl → AgCl + NaNO₃"],
  ])("%s: no electron sentence", (input, eq) => {
    const r = ok(balanceText(input));
    expect(r.equation).toBe(eq);
    expect(r.notes.join(" ")).not.toMatch(ELECTRONS);
  });
  test.each([
    ["MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+ in acid", "MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O"],
    ["Cl2 -> Cl^- + ClO3^- in base", "3 Cl₂ + 6 OH⁻ → 5 Cl⁻ + ClO₃⁻ + 3 H₂O"],
    ["Zn + Cu^2+ -> Zn^2+ + Cu in acid", "Zn + Cu²⁺ → Zn²⁺ + Cu"],
    ["Fe3O4 + H2 -> Fe + H2O in acid", "Fe₃O₄ + 4 H₂ → 3 Fe + 4 H₂O"],
    ["Pb3O4 + HCl -> PbCl2 + Cl2 + H2O in acid", "Pb₃O₄ + 8 HCl → 3 PbCl₂ + Cl₂ + 4 H₂O"],
  ])("%s: a redox, so the sentence stays", (input, eq) => {
    const r = ok(balanceText(input));
    expect(r.equation).toBe(eq);
    expect(r.notes.join(" ")).toMatch(ELECTRONS);
  });
});
