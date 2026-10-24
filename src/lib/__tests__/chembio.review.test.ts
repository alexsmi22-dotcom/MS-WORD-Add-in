// Independent adversarial review of the v2.137.0 chemistry / molecular-biology
// batch (SCOPE-CHEMBIO-BATCH). Every pin below was confirmed against an oracle
// OUTSIDE the engine under test:
//   SymPy null spaces + PuLP LP feasibility (balancing), hand arithmetic with
//   IUPAC conventional weights (stoichiometry), RDKit 2026.09.1 (SMILES
//   formulas / exact masses), chempy 0.10.2 formula_to_composition (ion
//   readings), Biopython 1.88 + INSDC qualifier rules (genetic codes / ST.26).
//
// Convention (house rule):
//   it(...)          FAILS today — a wrong answer, a silent mislabel, or a hang.
//   it.failing(...)  PASSES today (jest inverts it) — a refusal where an answer
//                    exists, or a cosmetic defect. When the defect is fixed the
//                    it.failing turns red: flip it to a plain it.

import { balanceReaction, balanceText, chemistryKindFor, parseSpecies } from "../balance";
import { stoichiometry } from "../stoich";
import { resolveMassSpec } from "../massspec";
import { readPeptide, buildPeptide } from "../peptide";
import { buildSt26Xml, type SequenceEntry } from "../sequence";
import { computationKindFor } from "../ctSwitch";
import { validateFormula } from "../chemValidate";

const META = { applicantName: "Test Applicant", inventionTitle: "Test Invention", applicantFileReference: "R1", productionDate: "2026-10-14" };

function translationOf(xml: string): string | null {
  const m = /<INSDQualifier_name>translation<\/INSDQualifier_name><INSDQualifier_value>([^<]*)</.exec(xml);
  return m ? m[1] : null;
}

// ============================================================ WRONG ANSWERS

describe("WRONG: stoichiometry — a molarity written as mol/L is read 1000× too large", () => {
  // units.convert(0.08, "mol/L", "M") returns 80 (also mmol/mL → 80, mol/mL → 1e6).
  // The root is units.ts, but stoich.ts routes every "mol/L" molarity through it.
  // Hand: NaOH 25.0 mL × 0.100 M = 2.50 mmol; HCl 30.0 mL × 0.0800 mol/L = 2.40 mmol
  // → HCl limiting, NaCl 2.40 mmol × 58.44 = 0.140 g, NaOH left 0.10 mmol.
  // Engine today: HCl 2.4 mol, NaOH "limiting", "HCl left over: 2.4 mol = 87.4 g".
  it("30.0 mL × 0.0800 mol/L HCl is 2.40 mmol and HCl is limiting", () => {
    const r = stoichiometry({
      reaction: "NaOH + HCl -> NaCl + H2O",
      amounts: [
        { species: "NaOH", amount: "25.0 mL", molarity: "0.100 M" },
        { species: "HCl", amount: "30.0 mL", molarity: "0.0800 mol/L" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hcl = r.reactants.find((x) => x.species === "HCl")!;
    expect(hcl.moles!).toBeCloseTo(0.0024, 6);
    expect(r.limiting).toEqual(["HCl"]);
    const nacl = r.products.find((p) => p.species === "NaCl")!;
    expect(nacl.mass).toBeCloseTo(0.14026, 4);
  });
});

describe("WRONG: Mass Spec reads a ring-closure digit ≥ 2 as a formula count", () => {
  // looksWrittenAsFormula treats any digit run ≠ "1" after an atom as a count, so
  // every polycyclic SMILES with a second ring label is read as a carbon formula.
  // (The authors' own pin C2CC2 → C5 is the same rule; these are real molecules.)
  // Oracle: RDKit CalcMolFormula / CalcExactMolWt.
  const cases: Array<[string, string, string, number]> = [
    ["decalin", "C1CCC2CCCCC2C1", "C10H18", 138.1409], // engine: C12, 144.000
    ["norbornane", "C1CC2CCC1C2", "C7H12", 96.0939], // engine: C9, 108.000
    ["adamantane", "C1C2CC3CC1CC(C2)C3", "C10H16", 136.1252], // engine: C16, 192.000
    ["cubane", "C12C3C4C1C5C2C3C45", "C8H8", 104.0626], // engine: C75, 900.000
  ];
  for (const [name, smiles, formula, mono] of cases) {
    it(`${name} ${smiles} → ${formula}, ${mono}`, () => {
      const r = resolveMassSpec(smiles, "auto");
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.result.formula).toBe(formula);
      expect(r.result.monoisotopicMass).toBeCloseTo(mono, 3);
    });
  }
});

describe("WRONG: chemistryKindFor steals subscripted physics equations", () => {
  // Rule 3 accepts any species with a digit, so a "1" subscript (never written in
  // a chemical formula) qualifies. Today: "P1V1 = P2V2" → "2 P₁V₁ → P₂V₂".
  for (const s of ["P1V1 = P2V2", "C1V1 = C2V2", "V1 + V2 = V3", "V1 = V2"]) {
    it(`${JSON.stringify(s)} is not routed to chemistry`, () => {
      expect(chemistryKindFor(s)).toBeNull();
    });
  }
  // Routing conflict: ctSwitch claims this graph edge list ("discrete"), and
  // chemistryKindFor claims it as a redox pair ("half-reaction"). The scope runs
  // the chemistry switch first, so the graph would be stolen.
  it("an edge list ctSwitch already owns is not claimed as a redox pair", () => {
    const s = "S -> B\nB -> C";
    expect(computationKindFor(s)).toBe("discrete");
    expect(chemistryKindFor(s)).toBeNull();
  });
});

describe("WRONG: homonuclear polyatomic ions read as monatomic (I3- → I³⁻, H2- → H²⁻)", () => {
  // chempy formula_to_composition: I3- = {I: 3, charge −1}; H2- = {H: 2, charge −1}.
  // I³⁻ and H²⁻ do not exist; triiodide is a textbook ion.
  it("I2 + I- -> I3- balances 1, 1, 1 (today: refused 'only with I₂ on the other side')", () => {
    const r = balanceReaction("I2 + I- -> I3-");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.coefficients).toEqual([1, 1, 1]);
  });
  it("H2 + e- -> H2- never prints the non-existent H²⁻ (today: H₂ + 4 e⁻ → 2 H²⁻)", () => {
    const r = balanceReaction("H2 + e- -> H2-");
    expect(r.ok && r.equation.includes("H²⁻")).toBe(false);
  });
});

describe("WRONG: a decimal subscript is read as a hydrate dot (Cu1.8S → Cu·8S)", () => {
  // Digenite-type Cu1.8S. chempy: {Cu: 1.8, S: 1} → 146.443 g/mol. Today the new
  // species reader returns Cu₁·8S = CuS₈, 320.026 g/mol, no warning. An explicit
  // count of 1 before "." is never written in a stoichiometric formula.
  it("parseSpecies(Cu1.8S) is refused or 146.443, never CuS₈ 320.026", () => {
    const p = parseSpecies("Cu1.8S");
    if (p.ok) expect(p.species.molarMass).toBeCloseTo(146.443, 2);
  });
  it("validateFormula(Cu1.8S) is not 'valid CuS8, 320.026' (pre-existing at HEAD, same class)", () => {
    const v = validateFormula("Cu1.8S");
    expect(v.valid && v.hill === "CuS8").toBe(false);
  });
});

describe("WRONG: ST.26 initiator rule overrides an explicit /transl_except", () => {
  // INSDC: /transl_except=(pos:1..3,aa:Val) fixes codon 1 as Val. Before v2.137.0
  // the record read VKPG (consistent); the new initiator rule emits MKPG next to
  // a qualifier that says Val — the listing contradicts itself.
  it("/transl_table=11 + /transl_except=(pos:1..3,aa:Val) never emits M at residue 1", () => {
    const e: SequenceEntry = {
      moltype: "DNA",
      residues: "GTGAAACCCGGGTAA",
      organism: "Escherichia coli",
      features: [{
        key: "CDS",
        location: "1..15",
        qualifiers: [{ name: "transl_table", value: "11" }, { name: "transl_except", value: "(pos:1..3,aa:Val)" }],
      }],
    };
    const t = translationOf(buildSt26Xml(META, [e]));
    expect(t === null || t.startsWith("V")).toBe(true);
  });
});

// ==================================================================== HANGS

describe("HANG: the 1000-residue peptide cap bounds residues, not time", () => {
  // Cap comment: "1000 residues 0.9 s" — true for Gly. The OCL cross-check is
  // superlinear in ring atoms: measured (node, warm) cyclo(W×998) 14.1 s,
  // pY×1000 7.7 s, Trp×1000 (three-letter) 7.5 s, W×1000 5.6 s. Gross-freeze
  // bound is 4 s; a refusal by name is also acceptable.
  it("cyclo(W×998) answers or refuses within 4 s", () => {
    const t0 = Date.now();
    readPeptide("cyclo(" + "W".repeat(998) + ")");
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 60000);
  it("cyclo(pY×998) answers or refuses within 4 s", () => {
    const t0 = Date.now();
    readPeptide("cyclo(" + "pY".repeat(998) + ")");
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 60000);
});

// ========================================================= SILENT MISLABELS

describe("SILENT: lowercase non-proteinogenic codes become invented peptides", () => {
  // Judgment call (chosen: defect). A lone lowercase 3-letter token that IS a
  // code is read as that residue ("ala" → Ala), so "hyp"/"orn"/"nle" read as
  // tripeptides (His-Tyr-Pro, Pyl-Arg-Asn, Asn-Leu-Glu) with no note, and the
  // B/J/X/Z drop rule turns "abu" (aminobutyric acid) into Ala-Sec.
  for (const s of ["hyp", "orn", "nle", "hyp-orn"]) {
    it(`${JSON.stringify(s)} is not read as a one-letter peptide`, () => {
      expect(readPeptide(s).ok).toBe(false);
    });
  }
  it("buildPeptide('abu') does not build Ala-Sec", () => {
    const b = buildPeptide("abu");
    expect(b && b.sequence).not.toBe("AU");
  });
});

// ============================================ REFUSALS WHERE AN ANSWER EXISTS

describe("REFUSAL: textbook half-reactions with H₂O₂ → O₂", () => {
  // Textbook (acid): H₂O₂ → O₂ + 2 H⁺ + 2 e⁻; with MnO₄⁻:
  // 2 MnO₄⁻ + 5 H₂O₂ + 6 H⁺ → 2 Mn²⁺ + 5 O₂ + 8 H₂O. Today both are refused
  // "2 independent balancings" (H₂O is a free column and H₂O₂ disproportionates).
  it("half-reaction H2O2 -> O2 in acid is answered", () => {
    expect(balanceText("half-reaction H2O2 -> O2 in acid").ok).toBe(true);
  });
  it("the MnO4-/H2O2 redox pair in acid is answered", () => {
    expect(balanceText("balance in acid: MnO4- -> Mn2+; H2O2 -> O2").ok).toBe(true);
  });
});

describe("REFUSAL: dictionary names with a locant are unreachable", () => {
  // lookupSmiles("1-butanol") hits (CCCCO), but the leading "1" is eaten as a
  // coefficient and "-butanol" is refused as a misplaced charge sign.
  it("parseSpecies('1-butanol') resolves to C₄H₁₀O", () => {
    const p = parseSpecies("1-butanol");
    expect(p.ok && p.species.hillDisplay).toBe("C₄H₁₀O");
  });
});

describe("REFUSAL: common volume units", () => {
  it("1.50 cm3 at 2.13 g/cm3 is a liquid amount", () => {
    const r = stoichiometry({ reaction: "NaOH + HCl -> NaCl + H2O", amounts: [{ species: "NaOH", amount: "1.50 cm3", density: "2.13 g/cm3" }] });
    expect(r.ok).toBe(true);
  });
});

// ================================================================= COSMETIC

describe("COSMETIC", () => {
  it("a species typed twice is named, not reported as '2 independent balancings' with identical rows", () => {
    const r = balanceReaction("H2 + H2 + O2 -> H2O");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/twice|more than once|duplicate|repeated/i);
  });
  it("an input under the 2,000-char cap whose display exceeds it is a cap refusal, not 'internal'", () => {
    const r = balanceReaction("H".repeat(1991) + " -> H2");
    expect(r.ok === false && r.kind).toBe("cap");
  });
  // validateFormula('1.5O2'): mass 47.997 (= 1.5 × O₂) is right, but the label is
  // the bare "O3" (reads as ozone) while the sibling 0.5H2O is labelled ½H2O.
  it("the Hill label of 1.5O2 states the coefficient (not the bare O3)", () => {
    const v = validateFormula("1.5O2");
    expect(v.valid && v.hill !== "O3").toBe(true);
  });
  it("'all cysteines paired' on one Cys does not suggest the self-bond 'disulfide 2-2'", () => {
    const r = readPeptide("ACD; all cysteines paired");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("2-2");
  });
});
