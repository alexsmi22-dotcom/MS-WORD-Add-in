// v2.137.0 — modified / cyclic / disulfide peptides (SCOPE-CHEMBIO-BATCH §B5, §D4).
// Every whole-peptide value below is the brief's oracle (pyteomics 5.0.1
// composition, RDKit MolFromSequence + Δ as route 2), copied verbatim.
import { Molecule } from "openchemlib";
import { readPeptide, PeptideReading, PeptideRefusal, buildPeptide, peptideSmiles } from "../peptide";
import {
  MODS,
  MONO_MASS,
  RESIDUE_COMPOSITION,
  verifyModDeltas,
  monoMass,
  averageMass,
  parseComposition,
  hillFormula,
  lookupMod,
  pairingCount,
  ModKey,
} from "../peptideMods";

function ok(input: string): PeptideReading {
  const r = readPeptide(input);
  if (!r.ok) throw new Error(`refused ${input}: ${r.message}`);
  return r;
}
function no(input: string): PeptideRefusal {
  const r = readPeptide(input);
  if (r.ok) throw new Error(`accepted ${input}: ${r.formula}`);
  return r;
}
const ocl = (smiles: string): string => Molecule.fromSmiles(smiles).getMolecularFormula().formula;

describe("§D4 modification deltas — Unimod, re-derived from composition", () => {
  // Brief table: composition Δ, mono (6 d.p.), avg (4 d.p.); unimod.org confirmed 2026-10-14.
  const TABLE: [ModKey, number, string, number, number][] = [
    ["Phospho", 21, "HO3P", 79.966331, 79.9799],
    ["Acetyl", 1, "C2H2O", 42.010565, 42.0367],
    ["Amidated", 2, "HNO-1", -0.984016, -0.9848],
    ["Gln->pyro-Glu", 28, "H-3N-1", -17.026549, -17.0305],
    ["Glu->pyro-Glu", 27, "H-2O-1", -18.010565, -18.0153],
    ["Oxidation", 35, "O", 15.994915, 15.9994],
    ["Deamidated", 7, "H-1N-1O", 0.984016, 0.9848],
    ["Dehydro", 374, "H-1", -1.007825, -1.0079],
  ];
  it.each(TABLE)("%s (UNIMOD:%i) composition %s → %f mono", (key, acc, comp, mono, avg) => {
    const d = MODS[key];
    expect(d.accession).toBe(acc);
    expect(d.composition).toEqual(parseComposition(comp));
    expect(d.unimodMono).toBe(mono);
    expect(d.unimodAvg).toBe(avg);
    expect(Math.abs(monoMass(d.composition) - mono)).toBeLessThan(5e-6);
    expect(Math.abs(averageMass(d.composition) - avg)).toBeLessThan(0.002);
  });
  it("the load-time check passes for every entry, and would catch a typo", () => {
    expect(verifyModDeltas().every((c) => c.ok)).toBe(true);
    // A one-digit slip in a stated delta is far outside the tolerance.
    expect(Math.abs(monoMass(MODS.Phospho.composition) - 79.966313)).toBeGreaterThan(5e-6);
  });
  it("disulfide −H₂ per bond: mono −2.015650, avg −2.0159; cyclisation −18.010565", () => {
    expect(monoMass({ H: -2 })).toBeCloseTo(-2.01565, 6);
    expect(monoMass({ H: -2, O: -1 })).toBeCloseTo(-18.010565, 6);
    const r = ok("CC; disulfide 1-2");
    const ss = r.modifications.find((m) => m.accession === "UNIMOD:374")!;
    expect(ss.deltaMono).toBeCloseTo(-2.01565, 6);
    expect(ss.deltaAvg).toBe(-2.0159);
    expect(ss.deltaComposition).toBe("−H₂");
  });
  it("NIST monoisotopic table is the massspec.ts values", () => {
    expect(MONO_MASS).toEqual({ C: 12, H: 1.0078250319, N: 14.0030740052, O: 15.9949146221, S: 31.97207069, P: 30.97376151, Se: 79.9165218 });
  });
  it("lookupMod: names case-insensitive, UNIMOD:n accepted, Dehydro not a bracket name", () => {
    expect(lookupMod("phospho")!.key).toBe("Phospho");
    expect(lookupMod("UNIMOD:35")!.key).toBe("Oxidation");
    expect(lookupMod("Dehydro")).toBeNull();
    expect(lookupMod("Methyl")).toBeNull();
  });
  it("pairingCount = (n−1)!!", () => {
    expect(pairingCount(2)).toBe(1);
    expect(pairingCount(4)).toBe(3);
    expect(pairingCount(6)).toBe(15);
    expect(pairingCount(5)).toBe(0);
  });
});

describe("residue compositions agree with the OCL formula of each free amino acid", () => {
  it.each(Object.keys(RESIDUE_COMPOSITION))("%s", (code) => {
    const free = { ...RESIDUE_COMPOSITION[code] };
    free.H = (free.H || 0) + 2;
    free.O = (free.O || 0) + 1;
    expect(ocl(peptideSmiles([code])!)).toBe(hillFormula(free));
  });
});

describe("§D4 whole peptides — formula, mono to 4 d.p., avg within 0.03 of pyteomics", () => {
  const ROWS: [string, string, number, number][] = [
    ["GRGDSP", "C22H37N9O10", 587.2663, 587.584],
    ["cyclo(GRGDSP)", "C22H35N9O9", 569.2558, 569.569],
    ["CYIQNCPLG-NH2; disulfide 1-6", "C43H66N12O12S2", 1006.4365, 1007.189],
    ["CYIQNCPLG-NH2", "C43H68N12O12S2", 1008.4521, 1009.204],
    ["CYFQNCPRG-NH2; disulfide 1-6", "C46H65N15O12S2", 1083.4379, 1084.233],
    ["Ac-SYSMEHFRWGKPV-NH2", "C77H109N21O19S", 1663.7929, 1664.886],
    ["pGlu-His-Pro-NH2", "C16H22N6O4", 362.1703, 362.384],
    ["AKS[Phospho]PR", "C23H44N9O10P", 637.2949, 637.624],
    ["M[Oxidation]AK", "C14H28N4O5S", 364.178, 364.461],
    ["CAACGGCAAC; disulfide all", "C28H44N10O11S4", 824.2074, 824.97],
    ["ACDEFGHIKLMNPQRSTVWY", "C107H159N29O30S2", 2394.1249, NaN],
  ];
  it.each(ROWS)("%s → %s, %f", (input, formula, mono, avg) => {
    const r = ok(input);
    expect(r.formula).toBe(formula);
    expect(Math.abs(r.monoisotopic - mono)).toBeLessThan(5e-5);
    if (!Number.isNaN(avg)) expect(Math.abs(r.average - avg)).toBeLessThan(0.03);
    expect(r.stereo).toMatch(/Stereochemistry unspecified/);
  });

  it("every drawable §D4 SMILES has OCL formula = composition formula (the in-product cross-check)", () => {
    for (const [input, formula] of ROWS) {
      const r = ok(input);
      if (r.smiles) expect(ocl(r.smiles)).toBe(formula);
    }
  });

  it("RDKit HELM third route: oxytocin free acid + S–S = C43H65N11O13S2, 1007.4205", () => {
    const r = ok("CYIQNCPLG; disulfide 1-6");
    expect(r.formula).toBe("C43H65N11O13S2");
    expect(r.monoisotopic).toBeCloseTo(1007.4205, 4);
  });

  it("CAACGGCAAC; disulfide all → mass shown, structure refused (4 Cys, 3 pairings)", () => {
    const r = ok("CAACGGCAAC; disulfide all");
    expect(r.smiles).toBeNull();
    expect(r.structureRefusal).toMatch(/4 cysteines admit 3 pairings/);
    expect(r.disulfideCount).toBe(2);
    expect(r.disulfidePairingKnown).toBe(false);
    expect(buildPeptide("CAACGGCAAC; disulfide all")).toBeNull();
  });

  it("the cystine count is exact (for extinctionCoefficient), not ⌊C/2⌋", () => {
    expect(ok("CYIQNCPLG-NH2; disulfide 1-6").cystinePairs).toBe(1);
    expect(ok("CYIQNCPLG-NH2").cystinePairs).toBe(0);
  });
});

describe("the task's shorthand aliases are exact synonyms of the ProForma forms", () => {
  const PAIRS: [string, string][] = [
    ["AKpSPR", "AKS[Phospho]PR"],
    ["AKS(ph)PR", "AKS[Phospho]PR"],
    ["ApTK", "AT[Phospho]K"],
    ["ApYK", "AY[Phospho]K"],
    ["M(ox)AK", "M[Oxidation]AK"],
    ["pE-HP-NH2", "E[Glu->pyro-Glu]HP-NH2"],
    ["pE-HP-NH2", "pGlu-His-Pro-NH2"],
    ["Glp-His-Pro-NH2", "pGlu-His-Pro-NH2"],
    ["Pyr-His-Pro-NH2", "pGlu-His-Pro-NH2"],
    ["[Acetyl]-SYSMEHFRWGKPV-[Amidated]", "Ac-SYSMEHFRWGKPV-NH2"],
    ["Ac-Ser-Tyr-Ser-Met-Glu-His-Phe-Arg-Trp-Gly-Lys-Pro-Val-NH2", "Ac-SYSMEHFRWGKPV-NH2"],
    ["cyclo-GRGDSP", "cyclo(GRGDSP)"],
    ["cyclo-(GRGDSP)", "cyclo(GRGDSP)"],
    ["cyclo[GRGDSP]", "cyclo(GRGDSP)"],
    ["c[GRGDSP]", "cyclo(GRGDSP)"],
    ["cyclo(Gly-Arg-Gly-Asp-Ser-Pro)", "cyclo(GRGDSP)"],
    ["CYIQNCPLG-NH2; disulfide C1-C6", "CYIQNCPLG-NH2; disulfide 1-6"],
    ["CYIQNCPLG-NH2; ss 1-6", "CYIQNCPLG-NH2; disulfide 1-6"],
    ["CYIQNCPLG-NH2; all cysteines paired", "CYIQNCPLG-NH2; disulfide 1-6"],
    ["CYIQNCPLG-NH₂; disulfide 1–6", "CYIQNCPLG-NH2; disulfide 1-6"],
    ["AKS[UNIMOD:21]PR", "AKS[Phospho]PR"],
  ];
  it.each(PAIRS)("%s ≡ %s", (a, b) => {
    const ra = ok(a);
    const rb = ok(b);
    expect(ra.formula).toBe(rb.formula);
    expect(ra.monoisotopic).toBe(rb.monoisotopic);
    expect(ra.smiles).toBe(rb.smiles);
  });
  it("AKpSPR = 637.2949 (the §A-9 live wrong answer was 654.77 as Pro)", () => {
    const r = ok("AKpSPR");
    expect(r.monoisotopic).toBeCloseTo(637.2949, 4);
    expect(r.modifications[0].accession).toBe("UNIMOD:21");
    expect(r.notes.join(" ")).toMatch(/pS read as phospho-Ser/);
  });
  it("all-lowercase keeps p as proline: akpspr = A-K-P-S-P-R", () => {
    expect(ok("akpspr").sequence).toBe("AKPSPR");
    expect(ok("akpspr").modifications).toEqual([]);
  });
  it("deamidation N/Q (UNIMOD:7) = +0.984016, drawn as Asp", () => {
    const r = ok("AN[Deamidated]K");
    expect(r.monoisotopic - ok("ANK").monoisotopic).toBeCloseTo(0.984016, 6);
    expect(r.formula).toBe(ok("ADK").formula);
    expect(r.notes.join(" ")).toMatch(/isoAsp/);
  });
  it("K[Acetyl] side chain", () => {
    expect(ok("AK[Acetyl]G").monoisotopic - ok("AKG").monoisotopic).toBeCloseTo(42.010565, 6);
  });
});

describe("output: Hill formula, typeset, modification list, display round-trip", () => {
  it("α-MSH lists acetyl and amide with accessions and true-minus deltas", () => {
    const r = ok("Ac-SYSMEHFRWGKPV-NH2");
    expect(r.formulaTypeset).toBe("C₇₇H₁₀₉N₂₁O₁₉S");
    expect(r.nTerminus).toBe("acetyl");
    expect(r.cTerminus).toBe("amide");
    const names = r.modifications.map((m) => `${m.accession} ${m.deltaComposition}`);
    expect(names).toEqual(["UNIMOD:1 +C₂H₂O", "UNIMOD:2 +HN −O"]);
    expect(r.display).toBe("Ac-SYSMEHFRWGKPV-NH₂");
    expect(r.threeLetter).toBe("Ac-Ser-Tyr-Ser-Met-Glu-His-Phe-Arg-Trp-Gly-Lys-Pro-Val-NH₂");
  });
  it("cyclic shows the cyclisation with no accession", () => {
    const r = ok("cyclo(GRGDSP)");
    expect(r.nTerminus).toMatch(/none/);
    const c = r.modifications.find((m) => m.accession === null)!;
    expect(c.deltaComposition).toBe("−H₂O");
    expect(c.deltaMono).toBeCloseTo(-18.010565, 6);
  });
  const INPUTS = [
    "GRGDSP",
    "cyclo(GRGDSP)",
    "CYIQNCPLG-NH2; disulfide 1-6",
    "CYFQNCPRG-NH2; disulfide 1-6",
    "Ac-SYSMEHFRWGKPV-NH2",
    "pGlu-His-Pro-NH2",
    "pE-HP-NH2",
    "AKS[Phospho]PR",
    "M[Oxidation]AK",
    "CAACGGCAAC; disulfide all",
    "cyclo(CRGDC); disulfide 1-5",
    "H-Gly-Gly-OH",
    "AN[Deamidated]K[Acetyl]",
  ];
  it.each(INPUTS)("display and three-letter forms of %s re-parse to the same reading", (input) => {
    const r = ok(input);
    for (const shown of [r.display, r.threeLetter]) {
      const back = ok(shown);
      expect(back.formula).toBe(r.formula);
      expect(back.smiles).toBe(r.smiles);
      expect(back.disulfideCount).toBe(r.disulfideCount);
    }
  });
});

describe("pinned as today", () => {
  it("H-Gly-Gly-OH → GG with no warning", () => {
    const r = ok("H-Gly-Gly-OH");
    expect(r.sequence).toBe("GG");
    expect(r.notes.filter((n) => /H-|-OH/.test(n))).toEqual([]);
    const b = buildPeptide("H-Gly-Gly-OH")!;
    expect(b.sequence).toBe("GG");
    expect(b.invalid).toEqual([]);
  });
  it("SEC → U; plain sequences give the legacy SMILES byte for byte", () => {
    expect(ok("SEC").sequence).toBe("U");
    for (const s of ["ACDEFGHIKLMNPQRSTVWY", "UO", "PPG", "acg", "AC-DE", "Ala-Gly-Ser"]) {
      const legacy = peptideSmiles(ok(s).sequence.split(""));
      expect(buildPeptide(s)!.smiles).toBe(legacy);
    }
  });
});
