// v2.193 chemistry fixes — every confirmed defect pinned by its exact input.
//
// Oracle (RDKit 2024, C:\Users\AlexanderSmith\jurislab-oracle-venv):
//   from rdkit import Chem; from rdkit.Chem.Descriptors import ExactMolWt; from rdkit.Chem.rdMolDescriptors import CalcMolFormula
//   C[N+](C)(C)C      → C4H12N+, ExactMolWt 74.09643 (electron mass counted)
//   CC(=O)[O-].[Na+]  → C2H3NaO2 (Hill)
//   *CC*              → C2H4*2 ; *CC(c1ccccc1)* → C8H8*2 (per repeat unit)
//   C( / CCC(C)(C)(C)C / C[N](C)(C)(C)C → MolFromSmiles returns None (unclosed branch; valence 5 on C and on N)

import { Molecule } from "openchemlib";
import { NAME_TO_SMILES } from "../compounds";
import { renderStructure, resolveStructure, checkSmiles, hillFromOcl, nameForIdcode, STRUCTURE_DRAW_MAX_HEAVY_ATOMS } from "../structures";
import { resolveMassSpec, smilesSpec, computeMassSpec, compositionFromMolecule } from "../massspec";
import { resolveCompound, ionOf } from "../characterization";
import { massSpecText } from "../spectroPane";
import { hillFormula, validateFormula } from "../chemValidate";
import { predictUvVis } from "../uvvis";
import { predictIr } from "../ir";
import { parseChemical } from "../chemParser";
import { segmentsToHtml } from "../segments";
import { readPeptide } from "../peptide";
import { formatBotanicalNameHtml } from "../botanical";
import { physicalLines } from "../characterization";
import { parseTable, parsePeakList } from "../solidform";

beforeAll(() => {
  // Warm OpenChemLib (the first layout of a session is slow in jest).
  renderStructure("smiles:CCO");
  nameForIdcode("warm the dictionary index");
});

describe("1 — long SMILES are refused by name BEFORE any 2D layout", () => {
  const chain3000 = "C".repeat(3000);

  it("Structure refuses a 3000-carbon chain by name, without a coordinate-inventing parse", () => {
    const spy = jest.spyOn(Molecule, "fromSmiles");
    try {
      const r = resolveStructure(chain3000);
      expect(r.kind).toBe("none");
      if (r.kind === "none") expect(r.message).toMatch(/3000 heavy atoms is above the 250-atom drawing limit/);
      // Every parse was coordinate-free.
      for (const call of spy.mock.calls) expect(call[1]).toEqual(expect.objectContaining({ noCoordinates: true }));
      expect(renderStructure(`smiles:${chain3000}`)).toBeNull();
      expect(renderStructure(chain3000)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("is fast: a refused 3000-C chain and a branched 400-atom SMILES take well under 2 s", () => {
    const t = Date.now();
    resolveStructure(chain3000);
    resolveStructure("C(C)".repeat(200));
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("Mass Spec and Characterization read a long chain without layout (masses kept)", () => {
    const spy = jest.spyOn(Molecule, "fromSmiles");
    try {
      const ms = resolveMassSpec(`smiles:${chain3000}`);
      expect(ms.kind).toBe("ok");
      if (ms.kind === "ok") expect(ms.result.formula).toBe("C3000H6002");
      const c = resolveCompound(`smiles:${chain3000}`);
      expect("refusal" in c).toBe(false);
      if (!("refusal" in c)) {
        expect(c.counts).toEqual({ C: 3000, H: 6002 });
        expect(c.mol).toBeNull();
        expect(c.note).toMatch(/Above 250 heavy atoms/);
      }
      for (const call of spy.mock.calls) expect(call[1]).toEqual(expect.objectContaining({ noCoordinates: true }));
      expect(computeMassSpec(chain3000)?.formula).toBe("C3000H6002");
    } finally {
      spy.mockRestore();
    }
  });

  it("every dictionary compound still draws (tannic acid, 122 heavy atoms, is the largest)", () => {
    expect(STRUCTURE_DRAW_MAX_HEAVY_ATOMS).toBe(250);
    const failed: string[] = [];
    for (const name of Object.keys(NAME_TO_SMILES)) if (!renderStructure(name, 120, 90)) failed.push(name);
    expect(failed).toEqual([]);
  });

  it("a 250-atom chain is drawn; 251 is refused", () => {
    expect(resolveStructure(`smiles:${"C".repeat(250)}`).kind).toBe("ok");
    expect(resolveStructure(`smiles:${"C".repeat(251)}`).kind).toBe("none");
  });
});

describe("2 — attachment points (*) are never counted as carbon", () => {
  it("*CC* draws as a repeat unit: C₂H₄ per unit, * labels, no ?", () => {
    const r = resolveStructure("*CC*");
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.result.formula).toBe("C2H4");
    expect(r.result.repeatUnit).toBe(true);
    expect(r.result.mw).toBeCloseTo(28.05, 2);
    expect(r.result.smiles).not.toMatch(/Og/);
    expect(r.result.svg).toMatch(/>\*</);
    expect(r.result.svg).not.toMatch(/>\?</);
    expect(r.note).toMatch(/per repeat unit/);
  });

  it("polystyrene's unit *CC(c1ccccc1)* is C₈H₈; [*] brackets work too", () => {
    const r = resolveStructure("smiles:*CC(c1ccccc1)*");
    expect(r.kind === "ok" && r.result.formula).toBe("C8H8");
    const b = resolveStructure("smiles:[*]CC[*]");
    expect(b.kind === "ok" && b.result.formula).toBe("C2H4");
  });

  it("one or three attachment points are refused by name", () => {
    const one = resolveStructure("smiles:C*");
    expect(one.kind).toBe("none");
    if (one.kind === "none") expect(one.message).toMatch(/1 attachment point/);
    const three = resolveStructure("smiles:*C(*)C*");
    expect(three.kind).toBe("none");
  });

  it("Mass Spec and Characterization refuse * by name (no C₄)", () => {
    const ms = resolveMassSpec("smiles:*CC*");
    expect(ms.kind).toBe("none");
    if (ms.kind === "none") expect(ms.message).toMatch(/attachment points/);
    expect(typeof smilesSpec("*CC*")).toBe("string");
    expect(computeMassSpec("*CC*")).toBeNull();
    // Even a fragment parsed elsewhere (OpenChemLib's own * reading) is refused, never summed as carbon.
    expect(typeof compositionFromMolecule(Molecule.fromSmiles("*CC*", { noCoordinates: true }))).toBe("string");
    const c = resolveCompound("smiles:*CC*");
    expect("refusal" in c).toBe(true);
  });
});

describe("5 — a charged species' m/z counts the electron mass, in both modes", () => {
  it("tetramethylammonium: 74.0964 (RDKit 74.09643) in Mass Spec and Characterization [M]", () => {
    const ms = resolveMassSpec("smiles:C[N+](C)(C)C");
    expect(ms.kind).toBe("ok");
    if (ms.kind !== "ok") return;
    expect(ms.result.ionMz).not.toBeNull();
    expect(ms.result.ionMz as number).toBeCloseTo(74.09643, 5);
    const c = resolveCompound("smiles:C[N+](C)(C)C");
    if ("refusal" in c) throw new Error(c.refusal);
    const line = ionOf(c, "M+");
    if ("refusal" in line) throw new Error(line.refusal);
    expect(line.mz.toFixed(4)).toBe((ms.result.ionMz as number).toFixed(4));
    const text = massSpecText(ms.result);
    expect(text).toMatch(/m\/z of the ion \(1\+, electron mass counted\): 74\.0964/);
  });

  it("a doubly charged anion divides by |z|; a neutral molecule has no ion m/z", () => {
    const ms = resolveMassSpec("smiles:[O-]C(=O)C(=O)[O-]");
    if (ms.kind !== "ok") throw new Error("expected ok");
    const M = ms.result.monoisotopicMass;
    expect(ms.result.ionMz as number).toBeCloseTo((M + 2 * 0.000548579909) / 2, 9);
    const n = resolveMassSpec("smiles:CCO");
    expect(n.kind === "ok" && n.result.ionMz).toBeNull();
  });
});

describe("8 — invalid SMILES are refused by name, never drawn", () => {
  it.each([
    ["C(", /unbalanced parentheses/],
    ["CC(C", /unbalanced parentheses/],
    ["CC)C", /closes no branch/],
    ["CCC(C)(C)(C)C", /atom 3 \(C\) has 5 bonds, above its valence of 4/],
    ["C[N](C)(C)(C)C", /atom 2 \(N\) has 5 bonds, above its valence of 3/],
  ])("%s", (smi, why) => {
    for (const input of [smi, `smiles:${smi}`]) {
      const r = resolveStructure(input);
      expect(r.kind).not.toBe("ok");
      const msg = r.kind === "none" || r.kind === "formula" ? r.message : "";
      expect(msg).toMatch(why);
      expect(renderStructure(`smiles:${smi}`)).toBeNull();
    }
    const ms = resolveMassSpec(`smiles:${smi}`);
    expect(ms.kind).toBe("none");
    if (ms.kind === "none") expect(ms.message).toMatch(why);
  });

  it.each(["C[N+](C)(C)C", "[NH4+]", "[BH4-]", "C[C-](C)C", "CS(=O)(=O)C", "[CH3]", "C[N+](=O)[O-]", "OP(=O)(O)O", "F[P-](F)(F)(F)(F)F", "C[H]", "[2H]C([2H])([2H])Cl"])(
    "valid %s passes the gate",
    (smi) => {
      expect(checkSmiles(smi).ok).toBe(true);
    }
  );
});

describe("9 — Hill order in Structure and Mass Spec formula rows", () => {
  it("sodium acetate C₂H₃NaO₂; ammonium borohydride BH₄N", () => {
    const s = resolveStructure("smiles:CC(=O)[O-].[Na+]");
    expect(s.kind === "ok" && s.result.formula).toBe("C2H3NaO2");
    const ms = resolveMassSpec("smiles:CC(=O)[O-].[Na+]");
    expect(ms.kind === "ok" && ms.result.formula).toBe("C2H3NaO2");
    const b = resolveMassSpec("smiles:[BH4-].[NH4+]");
    expect(b.kind === "ok" && b.result.formula).toBe("BH8N");
    expect(hillFromOcl("H4NB")).toBe("BH4N");
  });

  it("deuterium follows hydrogen when carbon is present (CDCl₃), alphabetical otherwise", () => {
    expect(hillFormula({ C: 1, D: 1, Cl: 3 })).toBe("CDCl3");
    expect(hillFormula({ C: 2, H: 5, D: 1, O: 1 })).toBe("C2H5DO");
    expect(hillFormula({ Na: 1, Cl: 1 })).toBe("ClNa");
    expect(hillFormula({ H: 2, O: 1 })).toBe("H2O");
  });
});

describe("3 — isolated carbonyl n→π* by class (Silverstein / Pavia)", () => {
  it.each([
    ["CC(=O)O", 204, /carboxylic acid/],
    ["CC(=O)OCC", 207, /ester/],
    ["CC(N)=O", 214, /amide/],
    ["CC(C)=O", 280, /ketone/],
    ["CC=O", 290, /aldehyde/],
    ["CC(=O)CCC(=O)OC", 280, /ketone/], // keto ester: the ketone's band is the longest
  ])("%s → %d nm", (smi, nm, what) => {
    const r = predictUvVis(smi)!;
    expect(r.lambdaMax).toBe(nm);
    expect(r.chromophore).toMatch(what);
  });

  it("classes with no tabulated band are named, not given 280 nm", () => {
    for (const smi of ["CC(=O)OC(C)=O", "CC(=O)Cl", "COC(=O)OC", "CC(=O)SC"]) {
      const r = predictUvVis(smi)!;
      expect({ smi, l: r.lambdaMax }).toEqual({ smi, l: null });
      expect(r.chromophore).toMatch(/no tabulated band/);
    }
  });
});

describe("4 — IR: alkyl C–H only from an sp³ carbon; the aldehyde Fermi doublet", () => {
  const assigns = (smi: string): string[] => predictIr(smi)!.bands.map((b) => `${b.wavenumber} ${b.assignment}`);

  it.each(["O=Cc1ccccc1", "C=CC=O"])("%s (no sp³ carbon) has no alkyl C–H, and both doublet bands", (smi) => {
    const a = assigns(smi);
    expect(a.some((x) => /alkyl/.test(x))).toBe(false);
    expect(a).toContain("2820 C-H stretch (aldehyde, Fermi doublet, upper)");
    expect(a).toContain("2720 C-H stretch (aldehyde, Fermi doublet, lower)");
  });

  it("propanal keeps its alkyl C–H; a dialdehyde still lists the doublet once", () => {
    expect(assigns("CCC=O").some((x) => x.startsWith("2925 C-H stretch (alkyl)"))).toBe(true);
    expect(assigns("O=CCCC=O").filter((x) => /Fermi/.test(x))).toHaveLength(2);
  });
});

describe("6/7 — chemParser: true-minus charges, U+2212 read, one-digit monatomic charges", () => {
  const html = (s: string) => segmentsToHtml(parseChemical(s));
  it.each([
    ["Cl-", "Cl<sup>−</sup>"],
    ["Cl−", "Cl<sup>−</sup>"],
    ["e−", "e<sup>−</sup>"],
    ["OH−", "OH<sup>−</sup>"],
    ["SO4^2−", "SO<sub>4</sub><sup>2−</sup>"],
    ["SO4^2-", "SO<sub>4</sub><sup>2−</sup>"],
    ["PO4^3−", "PO<sub>4</sub><sup>3−</sup>"],
    ["PO43−", "PO<sub>43</sub><sup>−</sup>"], // polyatomic, no caret: the digits are a count (unchanged rule)
    ["[Fe(CN)6]3−", "[Fe(CN)<sub>6</sub>]<sup>3−</sup>"],
    ["S2−", "S<sup>2−</sup>"],
    ["Fe3+", "Fe<sup>3+</sup>"],
    ["Hg22+", "Hg<sub>2</sub><sup>2+</sup>"],
    ["O22-", "O<sub>2</sub><sup>2−</sup>"],
    ["O22−", "O<sub>2</sub><sup>2−</sup>"],
    ["C60-", "C<sub>60</sub><sup>−</sup>"],
    ["NH4+", "NH<sub>4</sub><sup>+</sup>"],
  ])("%s", (input, out) => {
    expect(html(input)).toBe(out);
  });

  it("validateFormula reads the same ions the same way (Hg₂²⁺, O₂²⁻, C₆₀⁻; U+2212 accepted)", () => {
    expect(validateFormula("Hg22+")).toMatchObject({ valid: true, counts: { Hg: 2 }, charge: 2 });
    expect(validateFormula("O22-")).toMatchObject({ valid: true, counts: { O: 2 }, charge: -2 });
    expect(validateFormula("O22−")).toMatchObject({ valid: true, counts: { O: 2 }, charge: -2 });
    expect(validateFormula("C60-")).toMatchObject({ valid: true, counts: { C: 60 }, charge: -1 });
    expect(validateFormula("Fe3+")).toMatchObject({ valid: true, counts: { Fe: 1 }, charge: 3 });
    expect(validateFormula("S2-")).toMatchObject({ valid: true, counts: { S: 1 }, charge: -2 });
  });

  it("no ASCII hyphen is ever a superscript", () => {
    for (const s of ["Cl-", "NO3-", "[Fe(CN)6]4-", "Fe + O2 -> Fe2O3", "2Cr3+ + 3e- -> 2Cr"]) {
      for (const seg of parseChemical(s)) if (seg.type === "sup") expect(seg.text).not.toMatch(/-/);
    }
  });
});

describe("minor fixes", () => {
  it("peptide: E[Glu->pyro-Glu]HPG three-letter is pGlu-His-Pro-Gly", () => {
    const r = readPeptide("E[Glu->pyro-Glu]HPG");
    if (!r.ok) throw new Error(r.message);
    expect(r.threeLetter).toBe("pGlu-His-Pro-Gly-OH");
  });

  it("peptide: a ProForma mass delta is refused by name with the matching named modification", () => {
    const r = readPeptide("PEPT[+79.966]IDE");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Mass delta “\[\+79\.966\]” at position \d+ is not read.*matches Phospho.*T\[Phospho\]/);
  });

  it("botanical: a zoological trinomial's third word is italic; authors stay roman", () => {
    expect(formatBotanicalNameHtml("Panthera tigris altaica")).toBe("<i>Panthera</i> <i>tigris</i> <i>altaica</i>");
    expect(formatBotanicalNameHtml("Homo sapiens sapiens Linnaeus, 1758")).toBe("<i>Homo</i> <i>sapiens</i> <i>sapiens</i> Linnaeus, 1758");
    expect(formatBotanicalNameHtml("Rosa canina L.")).toBe("<i>Rosa</i> <i>canina</i> L.");
    expect(formatBotanicalNameHtml("Rosa canina var. alba hort")).toBe("<i>Rosa</i> <i>canina</i> var. <i>alba</i> hort");
    expect(formatBotanicalNameHtml("Abies alba de Candolle")).toBe("<i>Abies</i> <i>alba</i> de Candolle");
  });

  it("characterization: Rf messages say Rf (no R_f); the line keeps R with a real subscript f", () => {
    const bad = physicalLines(null, { rf: "1.5" });
    expect("refusal" in bad && bad.refusal).toMatch(/^Rf “1\.5”/);
    const ok = physicalLines(null, { rf: "0.35" });
    if ("refusal" in ok) throw new Error(ok.refusal);
    expect(ok.lines[0]).toBe("<i>R</i><sub>f</sub> = 0.35.");
    expect(ok.messages.map((m) => m.text).join(" ")).toMatch(/An Rf without its eluent/);
    expect(JSON.stringify(ok)).not.toMatch(/R_f/);
  });

  it("XRPD: rows mixing tabs and spaces are all read", () => {
    const t = parseTable("2θ (deg)\tIntensity\n5.20\t100\n10.40 85\n15.60\t40\n20.80  22");
    expect(t.rows).toEqual([[5.2, 100], [10.4, 85], [15.6, 40], [20.8, 22]]);
    expect(t.header).toEqual(["2θ (deg)", "Intensity"]);
    const dc = parseTable("5,20\t100\n10,40 85\n15,60\t40");
    expect(dc.rows).toEqual([[5.2, 100], [10.4, 85], [15.6, 40]]);
    expect(parsePeakList("5.20\t100\n10.40 85\n15.60\t40", 1.540598).peaks.map((p) => p.twoTheta)).toEqual([5.2, 10.4, 15.6]);
  });
});
