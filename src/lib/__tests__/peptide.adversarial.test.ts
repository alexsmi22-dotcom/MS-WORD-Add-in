// v2.137.0 adversarial pass on the peptide notation reader. Rule under test: a
// token the reader does not understand is REFUSED BY NAME with its 1-based
// position in the original input — never mapped to a residue letter — and a
// refusal never carries a mass.
import { Molecule } from "openchemlib";
import { readPeptide, buildPeptide, PeptideRefusal, PeptideReading } from "../peptide";

function no(input: string): PeptideRefusal {
  const r = readPeptide(input);
  if (r.ok) throw new Error(`accepted ${input}: ${r.formula} ${r.sequence}`);
  expect(r.message.length).toBeGreaterThan(10);
  expect(r).not.toHaveProperty("monoisotopic");
  expect(r).not.toHaveProperty("formula");
  return r;
}
function ok(input: string): PeptideReading {
  const r = readPeptide(input);
  if (!r.ok) throw new Error(`refused ${input}: ${r.message}`);
  return r;
}

describe("§A live wrong answers no longer invent residues", () => {
  it("cyclo(GRGDSP) is 569.2558, not Cys-Tyr-Cys-Leu-Pyl… 1307.5", () => {
    const r = ok("cyclo(GRGDSP)");
    expect(r.sequence).toBe("GRGDSP");
    expect(r.monoisotopic).toBeCloseTo(569.2558, 4);
    expect(buildPeptide("cyclo(GRGDSP)")!.sequence).toBe("GRGDSP");
  });
  it("Ac-…-NH2 adds no Ala-Cys / Asn-His", () => {
    expect(ok("Ac-SYSMEHFRWGKPV-NH2").sequence).toBe("SYSMEHFRWGKPV");
    expect(buildPeptide("Ac-SYSMEHFRWGKPV-NH2")!.sequence).toBe("SYSMEHFRWGKPV");
  });
  it("AKpSPR: p is not proline in an uppercase sequence", () => {
    expect(ok("AKpSPR").sequence).toBe("AKSPR");
  });
  it("M(ox): O is not pyrrolysine", () => {
    expect(ok("M(ox)AK").sequence).toBe("MAK");
  });
});

describe("refusals name the token and its position", () => {
  const CASES: [string, string, number | null, RegExp][] = [
    // [input, kind, position, message]
    ["cycloGRGDSP", "cyclo", 1, /cyclo\(GRGDSP\)/],
    ["CYCLOGRGDSP", "cyclo", 1, /Cys-Tyr-Cys-Leu-Pyl/],
    ["AKxSPR", "mixed-case", 3, /Lowercase “x” at position 3/],
    ["AKpAPR", "mixed-case", 3, /Lowercase “p” at position 3/],
    ["GRGDfK", "mixed-case", 5, /D-amino acid/],
    ["C1YIQNC1", "digit", 2, /Digit “1” at position 2/],
    ["GGNH2", "digit", 5, /Digit “2” at position 5/],
    ["AKS]PR", "bracket", 4, /Stray “]” at position 4/],
    ["AKS[PhosphoPR", "bracket", 4, /Unclosed “\[” at position 4/],
    ["AK)PR", "bracket", 3, /Stray “\)”/],
    ["[Phospho]AK", "bracket", 1, /does not follow a residue letter/],
    ["AKS[Methyl]PR", "unknown-mod", 4, /Unknown modification “\[Methyl\]”.*Phospho/],
    ["A[Phospho]K", "mod-site", 2, /Phospho on A at position 2.*S, T, Y/],
    ["S[Oxidation]K", "mod-site", 2, /Oxidation on S/],
    ["A(ox)K", "unknown-mod", 2, /Parenthesised modifier “\(ox\)”/],
    ["M(ph)K", "unknown-mod", 2, /Parenthesised modifier/],
    ["S[Acetyl]K", "mod-site", 2, /Ac- or \[Acetyl\]-/],
    ["GS[Amidated]", "mod-site", 3, /C-terminal/],
    ["AQ[Gln->pyro-Glu]K", "mod-site", 3, /only at the N-terminus/],
    ["ApEK", "mod-site", 2, /only at the N-terminus/],
    ["E[Gln->pyro-Glu]K", "mod-site", 2, /applies to Q only/],
    ["AS[Phospho][Phospho]K", "mod-site", 12, /one modification per residue/],
    ["pS[Phospho]K", "mod-site", 1, /already carries/],
    ["AXG", "unknown-letter", 2, /“X” at position 2 is not an amino-acid code/],
    ["Ac-GBG", "unknown-letter", 5, /“B” at position 5/],
    ["Ac-GGxG-NH2", "mixed-case", 6, /position 6/],
    ["Ala-Xyz-Gly", "three-letter", 5, /“Xyz” at position 5/],
    ["Ala-D-Phe", "stereo", 5, /D-\/L- configuration/],
    ["pGlu-HP-NH2", "three-letter", 6, /“HP” at position 6/],
    ["Ala-pGlu", "mod-site", 5, /only at the N-terminus/],
    ["cyclo(Ac-GRG)", "cyclo", 7, /no N-terminus/],
    ["cyclo(GRG-NH2)", "cyclo", 11, /no C-terminus/],
    ["cyclo(GRG)-NH2", "cyclo", 11, /no termini/],
    ["cyclo(pE-GRG)", "cyclo", 7, /no(ne)?/],
    ["cyclo(G)", "cyclo", 7, /at least 2 residues/],
    ["cyclo(GRGcyclo(G))", "cyclo", 10, /second “cyclo”/],
    ["GR-Ac-GD", "termini", 4, /terminal group/],
    ["Ac-pE-HP", "termini", 1, /no free amine/],
    ["H-GRGDSP", "ambiguous", 1, /ambiguous/],
    ["GG*", "character", 3, /“\*” at position 3/],
    ["", "empty", null, /No peptide/],
    ["GRGDSP; banana", "disulfide", 9, /not a recognised clause/],
  ];
  it.each(CASES)("%s → %s at %p", (input, kind, position, msg) => {
    const r = no(input);
    expect(r.kind).toBe(kind);
    expect(r.position).toBe(position);
    expect(r.message).toMatch(msg);
    // buildPeptide never guesses — except the pinned legacy path (plain,
    // single-case input whose only fault is an unknown letter: dropped + listed).
    if (input === "AXG") expect(buildPeptide(input)!.invalid).toEqual(["X"]);
    else expect(buildPeptide(input)).toBeNull();
  });

  it("a position after an Ac- prefix indexes the ORIGINAL string", () => {
    const r = no("  Ac-SYSZEH-NH2");
    expect(r.position).toBe(9);
    expect(r.token).toBe("Z");
  });
});

describe("disulfides", () => {
  it("2 Cys with 'all paired' → the one pairing, drawn", () => {
    const r = ok("CAAC; disulfide all");
    expect(r.disulfides).toEqual([[1, 4]]);
    expect(r.smiles).not.toBeNull();
  });
  it("3 Cys with 'all paired' → refused (odd)", () => {
    const r = no("CYIQNCPLGC; disulfide all");
    expect(r.kind).toBe("disulfide");
    expect(r.message).toMatch(/3 cysteines — one is unpaired/);
  });
  it("1 Cys → 'a single cysteine cannot form a disulfide' (no self-bond suggestion)", () => {
    const r = no("ACD; all cysteines paired");
    expect(r.message).toMatch(/single cysteine cannot form a disulfide/);
    expect(r.message).not.toContain("2-2");
  });
  it("5 Cys → refused naming the count", () => {
    expect(no("CCCCC; disulfide all").message).toMatch(/^5 cysteines/);
  });
  it("no Cys with 'all'", () => {
    expect(no("GGG; disulfide all").message).toMatch(/no cysteines/);
  });
  it("6 Cys 'all' → mass, 15 pairings, no structure", () => {
    const r = ok("CCCCCC; disulfide all");
    expect(r.smiles).toBeNull();
    expect(r.structureRefusal).toMatch(/15 pairings/);
    expect(r.monoisotopic).toBeCloseTo(ok("CCCCCC; disulfide 1-2, 3-4, 5-6").monoisotopic, 9);
  });
  const BAD: [string, RegExp, number][] = [
    ["CYIQNCPLG; disulfide 1-4", /Residue 4 is Gln, not Cys/, 22],
    ["CYIQNCPLG; disulfide C2-C6", /Residue 2 is Tyr/, 22],
    ["CCCC; disulfide 1-2, 2-3", /Cys2 is already bonded/, 22],
    ["CC; disulfide 1-1", /to itself/, 15],
    ["CC; disulfide 1-9", /outside the 2-residue/, 15],
    ["CU; disulfide 1-2", /selenocysteine/, 15],
    ["CC; disulfide one-two", /not a disulfide pair/, 15],
    ["CC; disulfide 1-2; ss 1-2", /second disulfide clause/, 20],
  ];
  it.each(BAD)("%s refused", (input, msg, pos) => {
    const r = no(input);
    expect(r.kind).toBe("disulfide");
    expect(r.message).toMatch(msg);
    expect(r.position).toBe(pos);
  });

  it("cyclic AND disulfide-bridged: −H₂O and −H₂, structure drawn and cross-checked", () => {
    const lin = ok("CRGDC");
    const r = ok("cyclo(CRGDC); disulfide 1-5");
    expect(r.monoisotopic - lin.monoisotopic).toBeCloseTo(-18.010565 - 2.01565, 6);
    expect(r.smiles).toMatch(/%10/);
    expect(r.smiles).toMatch(/%11/);
    expect(Molecule.fromSmiles(r.smiles!).getMolecularFormula().formula).toBe(r.formula);
  });
  it("cyclic with Pro first, a bridge across aromatics, two bridges — ring labels never collide", () => {
    for (const s of [
      "cyclo(PCFWYHC); disulfide 2-7",
      "cyclo(CPFCWYCHC); disulfide 1-9, 4-7",
      "CFCWCYCH; disulfide 1-5, 3-7",
      "CFCWCYCH; disulfide 1-7, 3-5",
    ]) {
      const r = ok(s);
      expect(Molecule.fromSmiles(r.smiles!).getMolecularFormula().formula).toBe(r.formula);
    }
  });
  it("Pro first in a ring: N%10 then the proline ring label", () => {
    expect(ok("cyclo(PG)").smiles!.startsWith("N%101CCCC1")).toBe(true);
  });
  it("ring labels are reused: 60 sequential disulfides still draw", () => {
    const seq = "CGC".repeat(60);
    const pairs = Array.from({ length: 60 }, (_, k) => `${3 * k + 1}-${3 * k + 3}`).join(", ");
    const r = ok(`${seq}; disulfide ${pairs}`);
    expect(r.disulfideCount).toBe(60);
    const mol = Molecule.fromSmiles(r.smiles!, { noCoordinates: true, noStereo: true });
    expect(mol.getMolecularFormula().formula).toBe(r.formula);
  });
});

describe("termini edge cases (decided and pinned)", () => {
  it("H-A-C-G is hyphenated one-letter starting with His", () => {
    expect(ok("H-A-C-G").sequence).toBe("HACG");
  });
  it("GG-OH is Gly-Gly free acid (said), not Gly-Gly-Pyl-His", () => {
    const r = ok("GG-OH");
    expect(r.sequence).toBe("GG");
    expect(r.notes.join(" ")).toMatch(/-OH read as the free C-terminal acid/);
  });
  it("H-GRGDSP-OH reads both termini as free, said", () => {
    const r = ok("H-GRGDSP-OH");
    expect(r.sequence).toBe("GRGDSP");
    expect(r.notes.join(" ")).toMatch(/H- read as the free N-terminal amine/);
  });
  it.each(["hyp", "orn", "nle", "Hyp-Orn", "abu", "AIB", "Ala-Sar-Gly", "cit"])(
    "non-standard three-letter code %s is refused by name, never split into one-letter codes",
    (s) => {
      const r = no(s);
      expect(r.kind).toBe("nonstandard");
      expect(r.message).toMatch(/not one of the 20 standard residues/);
      expect(buildPeptide(s)).toBeNull();
    }
  );
  it("hyp names hydroxyproline at position 1; hyp-orn names the first", () => {
    expect(no("hyp").message).toMatch(/Hyp \(hydroxyproline\)/);
    expect(no("hyp-orn").position).toBe(1);
  });
  it("all-lowercase STANDARD one-letter sequences stay accepted", () => {
    expect(ok("akpspr").sequence).toBe("AKPSPR");
    expect(ok("acdef").sequence).toBe("ACDEF");
    expect(ok("h y p").sequence).toBe("HYP");
  });
  it("AC-DE stays Ala-Cys-Asp-Glu (Ac is case-sensitive)", () => {
    expect(ok("AC-DE").sequence).toBe("ACDE");
  });
  it("legacy unknown-letter path kept for plain input only", () => {
    expect(buildPeptide("MGZKL")!.invalid).toEqual(["Z"]);
    expect(buildPeptide("MGZKl")).toBeNull();
    expect(buildPeptide("123")).toBeNull();
  });
  it("the legacy path still reads termini as termini (no Pyl-His from -OH)", () => {
    const a = buildPeptide("GXG-OH")!;
    expect(a.sequence).toBe("GG");
    expect(a.invalid).toEqual(["X"]);
    const b = buildPeptide("H-GXGDSP-OH")!;
    expect(b.sequence).toBe("GGDSP");
    expect(b.sequence).not.toMatch(/O/);
    expect(buildPeptide("MGZKL")!.smiles).toBe(buildPeptide("MGKL")!.smiles);
  });
  it("a typeset arrow in a modification name re-parses (Q[Gln→pyro-Glu])", () => {
    expect(ok("Q[Gln→pyro-Glu]HP-NH₂").formula).toBe("C16H22N6O4");
  });
});

describe("caps and speed", () => {
  it("a 200-residue peptide reads under 1 s (4 s bound)", () => {
    const aa = "ACDEFGHIKLMNPQRSTVWY";
    const seq = Array.from({ length: 200 }, (_, i) => aa[(i * 7) % 20]).join("");
    const t0 = Date.now();
    const r = ok(`Ac-${seq}-NH2`);
    const dt = Date.now() - t0;
    expect(r.length).toBe(200);
    expect(dt).toBeLessThan(4000);
  });
  it("an ACCEPTED 1000-residue peptide (the residue cap) reads within the 4 s bound", () => {
    const aa = "ACDEFGHIKLMNPQRSTVWY";
    const seq = Array.from({ length: 1000 }, (_, i) => aa[(i * 7) % 20]).join("");
    const t0 = Date.now();
    const r = ok(seq);
    expect(r.length).toBe(1000);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it("time is bounded by ATOMS: cyclo(W×998) answers with a mass, no structure, inside 4 s", () => {
    const t0 = Date.now();
    const r = ok("cyclo(" + "W".repeat(998) + ")");
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.smiles).toBeNull();
    expect(r.structureRefusal).toMatch(/heavy atoms/);
    // composition arithmetic still exact: 998 × Trp residue (C11H10N2O), cyclic
    expect(r.formula).toBe("C10978H9980N1996O998");
  });
  it("the atom limit does not touch ordinary peptides (200 mixed residues still drawn)", () => {
    const aa = "ACDEFGHIKLMNPQRSTVWY";
    expect(ok(Array.from({ length: 200 }, (_, i) => aa[(i * 7) % 20]).join("")).smiles).not.toBeNull();
  });
  it("input over the cap is refused before any work", () => {
    const r = no("G".repeat(5001));
    expect(r.kind).toBe("too-long");
  });
  it("more than 1000 residues refused by name", () => {
    expect(no("G".repeat(1001)).kind).toBe("too-long");
  });
});
