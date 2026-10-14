// carbonylKind must not use "ketone" as a dumping ground.
//
// WHY THIS EXISTS (punch list #3)
// The arginine pKa bug was a MISSING GROUP CLASS SILENTLY ROUTED TO A CATCH-ALL
// BRANCH WITH A PLAUSIBLE LABEL ATTACHED. #3 asked whether that shape survived
// elsewhere. It did — carbonylKind ended in a bare `return "ketone"`, and everything
// the branches above failed to recognise landed there, then received a ketone's
// 1715 cm-1 IR band and 205 ppm 13C shift:
//
//   O=C=O      carbon dioxide  -> real IR 2349 cm-1 (off by 634), real 13C ~125 (off by 80)
//   CN=C=O     isocyanate      -> real N=C=O stretch ~2270 cm-1
//   CC(=O)SC   thioester       -> real C=O ~1690 cm-1, 13C ~193
//   O=C=C=C=O  carbon suboxide -> reported as TWO ketones
//
// carbon dioxide is in compounds.json under BOTH "carbon dioxide" and the formula
// "CO2", so this was reachable by typing "CO2" into Spectra.
//
// The fix is not only new classes; it is that the catch-all is gone. A carbonyl the
// function cannot positively name now returns null and gets NO predicted band,
// because a wrong band is worse than no band: an absent prediction is visible, a
// confident wrong one is not.

import { Molecule } from "openchemlib";
import { carbonylKind, CarbonylKind } from "../molgraph";
import { predictIr } from "../ir";
import { predictNmr } from "../nmr";
import { predictUvVis } from "../uvvis";
import { predictFragments } from "../fragment";
import { predictPka } from "../pka";
import { predictHsqc } from "../nmr2d";

/** Every carbonyl classification in a SMILES, in atom order. */
function kinds(smiles: string): (CarbonylKind | null)[] {
  const m = Molecule.fromSmiles(smiles);
  m.ensureHelperArrays(Molecule.cHelperRings);
  const out: CarbonylKind[] = [];
  for (let a = 0; a < m.getAllAtoms(); a++) {
    const k = carbonylKind(m, a);
    if (k) out.push(k);
  }
  return out;
}

describe("the classes that were being called ketones", () => {
  test("a thioester is a thioester — every acyl-CoA in metabolism is one", () => {
    expect(kinds("CC(=O)SC")).toEqual(["thioester"]);
    expect(kinds("CC(=O)SCCN")).toEqual(["thioester"]); // acetyl-CoA thioester core
  });

  test("an isocyanate is an isocyanate", () => {
    expect(kinds("CN=C=O")).toEqual(["isocyanate"]);
    expect(kinds("O=C=Nc1ccccc1")).toEqual(["isocyanate"]); // phenyl isocyanate
  });

  test("carbon dioxide is NOT a ketone and gets no acyl band", () => {
    // The headline case: reachable from the dictionary by typing "CO2".
    expect(kinds("O=C=O")).toEqual([]);
  });

  test("carbon suboxide is not two ketones", () => {
    expect(kinds("O=C=C=C=O")).toEqual([]);
  });

  test("a ketene is not a ketone", () => {
    expect(kinds("C=C=O")).toEqual([]);
  });

  test("acyl silanes and selenoesters get no name rather than a wrong one", () => {
    expect(kinds("CC(=O)[SiH3]")).toEqual([]);
    expect(kinds("CC(=O)[Se]C")).toEqual([]);
  });
});

describe("the real classes still classify correctly — no regression", () => {
  test.each<[string, string, CarbonylKind]>([
    ["acetone", "CC(C)=O", "ketone"],
    ["cyclohexanone", "O=C1CCCCC1", "ketone"],
    ["acetophenone", "CC(=O)c1ccccc1", "ketone"],
    ["acetaldehyde", "CC=O", "aldehyde"],
    ["formaldehyde", "C=O", "aldehyde"],
    ["acetic acid", "CC(=O)O", "acid"],
    ["ethyl acetate", "CC(=O)OCC", "ester"],
    ["acetamide", "CC(=O)N", "amide"],
    ["acetyl chloride", "CC(=O)Cl", "acidHalide"],
    ["urea", "NC(=O)N", "urea"],
    ["dimethyl carbonate", "COC(=O)OC", "carbonate"],
    ["methyl carbamate", "COC(=O)N", "carbamate"],
    ["acetic anhydride", "CC(=O)OC(C)=O", "anhydride"],
  ])("%s -> %s", (_label, smiles, expected) => {
    expect(kinds(smiles)).toContain(expected);
  });

  test("aspirin still reads as an ester plus an acid", () => {
    const k = kinds("CC(=O)Oc1ccccc1C(=O)O");
    expect(k).toContain("ester");
    expect(k).toContain("acid");
    expect(k).not.toContain("ketone");
  });
});

describe("the predicted IR reflects the fix, in the numbers a user sees", () => {
  const band = (smiles: string, match: RegExp) =>
    predictIr(smiles)?.bands.find((b) => match.test(b.assignment));

  test("a thioester's C=O is predicted BELOW the ketone range, where it belongs", () => {
    const b = band("CC(=O)SC", /thioester/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(1690);
    // The old answer was 1715 — inside the ketone range [1705,1725] and OUTSIDE
    // any thioester range. That is the whole defect in one number.
    expect(b!.wavenumber).toBeLessThan(1705);
  });

  test("an isocyanate is predicted near 2270, not 1715", () => {
    const b = band("CN=C=O", /isocyanate/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(2270);
  });

  test("carbon dioxide gets NO ketone band — the honest outcome", () => {
    const ir = predictIr("carbon dioxide");
    expect(ir).not.toBeNull();
    const text = ir!.bands.map((b) => b.assignment).join(" ");
    expect(text).not.toMatch(/ketone/i);
    // Reachable the way a user reaches it.
    expect(predictIr("CO2")!.bands.map((b) => b.assignment).join(" ")).not.toMatch(/ketone/i);
  });

  test("acetone still gets its ketone band — the fix did not gut real chemistry", () => {
    const b = band("CC(C)=O", /ketone/);
    expect(b).toBeDefined();
    expect(b!.wavenumber).toBe(1715);
  });
});

// ===========================================================================
// CHARGE-AWARE CLASSES — what the six consumers EMIT.
//
// molgraph.adversarial.test.ts pins what the CLASSIFIER says (a carboxylate is
// "carboxylate", a phenoxide is "O-"). This section pins what the consumers
// emit for those classes, because a classifier fix that no consumer acts on
// changes nothing on screen, and a consumer that silently maps a new class onto
// an old row is the bug in a new coat.
//
// Every expectation here failed on the charge-blind code: acetate had an ester's
// 1740 cm-1 and 171 ppm, acrylate had the acid/ester enone base, butanoate had a
// McLafferty ion, phenoxide had anisole's increments, anilinium had aniline's,
// and 4-(trimethylammonio)benzoic acid had a DONATING σ applied.
// ===========================================================================

const bandsOf = (smi: string) => predictIr(smi)!.bands;
const hasBandIn = (smi: string, lo: number, hi: number) =>
  bandsOf(smi).some((b) => b.wavenumber >= lo && b.wavenumber <= hi);
const assignments = (smi: string) => bandsOf(smi).map((b) => b.assignment);
const caveatText = (r: { caveats: string[] } | null) => (r ? r.caveats.join("\n") : "");

describe("IR: a carboxylate has COO⁻ stretches, not an ester C=O", () => {
  test.each([
    ["acetate", "CC(=O)[O-]"],
    ["benzoate", "[O-]C(=O)c1ccccc1"],
    ["glycine zwitterion", "[NH3+]CC(=O)[O-]"],
  ])("%s %s", (_label, smi) => {
    // No C=O band of any class in the 1690-1760 window an acid/ester/ketone occupies.
    expect(hasBandIn(smi, 1690, 1760)).toBe(false);
    expect(assignments(smi).some((a) => /C=O stretch/.test(a))).toBe(false);
    expect(assignments(smi)).not.toContain("C-O stretch");
    // The two COO⁻ stretches, inside the published ranges.
    const asym = bandsOf(smi).find((b) => /COO⁻ asym/.test(b.assignment))!;
    const sym = bandsOf(smi).find((b) => /COO⁻ sym/.test(b.assignment))!;
    expect(asym.wavenumber).toBeGreaterThanOrEqual(1550);
    expect(asym.wavenumber).toBeLessThanOrEqual(1610);
    expect(sym.wavenumber).toBeGreaterThanOrEqual(1400);
    expect(sym.wavenumber).toBeLessThanOrEqual(1450);
    expect(asym.intensity).toBe("strong");
    // No carboxylic-acid O-H: there is no acid H.
    expect(assignments(smi).some((a) => /carboxylic acid/.test(a))).toBe(false);
  });

  test("the neutral acid and the ester are unchanged: 1710 / 1740 and a C-O stretch", () => {
    expect(hasBandIn("CC(=O)O", 1700, 1725)).toBe(true);
    expect(hasBandIn("CC(=O)OCC", 1730, 1750)).toBe(true);
    expect(assignments("CC(=O)OCC")).toContain("C-O stretch");
    expect(assignments("CC(=O)O").some((a) => /carboxylic acid, very broad/.test(a))).toBe(true);
    expect(assignments("CC(=O)O").some((a) => /COO⁻/.test(a))).toBe(false);
  });

  test("a half-neutralised diacid shows BOTH an acid C=O and the COO⁻ pair", () => {
    const a = assignments("OC(=O)CC(=O)[O-]");
    expect(a.some((x) => /C=O stretch \(carboxylic acid\)/.test(x))).toBe(true);
    expect(a.some((x) => /COO⁻ asym/.test(x))).toBe(true);
  });
});

describe("13C NMR: the carboxylate carbon is near an acid's shift, not an ester's", () => {
  test("acetate: COO⁻ ≈182 ppm, labelled as a carboxylate; ethyl acetate stays 171", () => {
    const r = predictNmr("CC(=O)[O-]", "13C")!;
    const coo = r.signals.find((s) => /carboxylate/.test(s.assignment))!;
    expect(coo).toBeDefined();
    expect(coo.shift).toBeGreaterThanOrEqual(175);
    expect(coo.shift).toBeLessThanOrEqual(185);
    expect(r.signals.some((s) => /ester/.test(s.assignment))).toBe(false);
    const ester = predictNmr("CC(=O)OCC", "13C")!.signals.find((s) => /ester/.test(s.assignment))!;
    expect(ester.shift).toBe(171);
    // The acid stays where it was and is a DIFFERENT value from the anion.
    const acid = predictNmr("CC(=O)O", "13C")!.signals.find((s) => /carboxylic acid/.test(s.assignment))!;
    expect(acid.shift).toBe(178);
    expect(coo.shift).not.toBe(acid.shift);
  });

  test("the carbon α to a carboxylate gets NO ester/acid sp3 increment — it is named as untabulated", () => {
    // The CH3 of acetate: no COO⁻ row exists in the sp3 table this module
    // carries, so the ester increment it used to receive is withheld and the
    // group is named in the caveat, by its own name.
    const r = predictNmr("CC(=O)[O-]", "13C")!;
    expect(caveatText(r)).toMatch(/COO⁻ \(carboxylate\)/);
    expect(caveatText(r)).toMatch(/no tabulated sp3 increment/);
    // Ethyl acetate's methyl still gets its ester increment with no such caveat.
    expect(caveatText(predictNmr("CC(=O)OCC", "13C"))).not.toMatch(/no tabulated sp3 increment/);
  });

  test("1H: acetate's CH3 is named as lacking a ¹H increment; no COOH proton is invented", () => {
    const r = predictNmr("CC(=O)[O-]", "1H")!;
    expect(r.signals.some((s) => /COOH/.test(s.assignment))).toBe(false);
    expect(caveatText(r)).toMatch(/COO⁻ \(carboxylate\)/);
    expect(caveatText(r)).toMatch(/no tabulated ¹H increment/);
  });

  test("nmr2d inherits the same signals: no ester label for benzoate, the carboxylate label carried through", () => {
    const r = predictHsqc("[O-]C(=O)c1ccccc1")!;
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/\(ester\)/);
    expect(text).toMatch(/carboxylate/);
  });
});

describe("UV-Vis: no acid/ester base and no 280 nm C=O line for a carboxylate", () => {
  test("acrylate is refused by name; acrylic acid keeps the 195 nm acid/ester base", () => {
    const anion = predictUvVis("C=CC(=O)[O-]")!;
    expect(anion.outOfDomain).toBe(true);
    expect(anion.lambdaMax).toBeNull();
    expect(anion.chromophore).toMatch(/carboxylate/);
    expect(caveatText(anion)).toMatch(/COO⁻/);
    const acid = predictUvVis("C=CC(=O)O")!;
    expect(acid.outOfDomain).toBe(false);
    expect(acid.contributions[0].nm).toBe(195);
  });

  test("acetate alone is not an 'isolated carbonyl at 280 nm'", () => {
    const r = predictUvVis("CC(=O)[O-]")!;
    expect(r.lambdaMax).not.toBe(280);
    expect(r.outOfDomain).toBe(true);
    expect(r.chromophore).toMatch(/carboxylate/);
    // Acetone keeps its 280.
    expect(predictUvVis("CC(C)=O")!.lambdaMax).toBe(280);
  });

  test("a charged auxochrome on an enone is NAMED as omitted, not silently priced", () => {
    // Enolate-type β-O⁻ on a conjugated ketone: Woodward-Fieser has no entry.
    const r = predictUvVis("CC(=O)C=C[O-]")!;
    expect(r.outOfDomain).toBe(false);
    expect(caveatText(r)).toMatch(/O⁻ \(phenoxide \/ alkoxide\)/);
    expect(caveatText(r)).toMatch(/OMITTED/);
    // Its neutral parent gets the tabulated β-OH increment and no such caveat.
    const oh = predictUvVis("CC(=O)C=CO")!;
    expect(oh.contributions.some((c) => /β-OH/.test(c.label))).toBe(true);
    expect(caveatText(oh)).not.toMatch(/OMITTED/);
  });
});

describe("MS fragmentation: no carbonyl pathway is applied to a carboxylate", () => {
  test("butanoate: no McLafferty, no acylium, no decarboxylation; butanoic acid keeps all three", () => {
    const anion = predictFragments("CCCC(=O)[O-]")!;
    const paths = anion.fragments.map((f) => f.pathway).join("\n");
    expect(paths).not.toMatch(/McLafferty/);
    expect(paths).not.toMatch(/acylium/);
    expect(paths).not.toMatch(/decarboxylation/);
    expect(paths).not.toMatch(/oxocarbenium/);
    expect(caveatText(anion)).toMatch(/carboxylate anion \(COO⁻\)/);

    const acid = predictFragments("CCCC(=O)O")!;
    const acidPaths = acid.fragments.map((f) => f.pathway).join("\n");
    expect(acidPaths).toMatch(/McLafferty/);
    expect(acidPaths).toMatch(/acylium/);
    expect(acidPaths).toMatch(/decarboxylation/);
    expect(caveatText(acid)).not.toMatch(/carboxylate anion/);
  });

  test("the molecular-ion mass is still the anion as drawn (exact arithmetic unchanged)", () => {
    const anion = predictFragments("CC(=O)[O-]")!;
    // C2H3O2: 12*2 + 3*1.0078250319 + 2*15.9949146221 = 59.0133 (minus an electron)
    expect(anion.molecularIon).toBeCloseTo(59.01276, 3);
    expect(anion.formula).toBe("C2H3O2");
  });
});

describe("pKa: a carboxylate is the conjugate base and is never offered an acid pKa", () => {
  test("acetate has no carboxylic-acid site; acetic acid has one", () => {
    const anion = predictPka("CC(=O)[O-]")!;
    expect(anion.sites.some((s) => /Carboxylic/.test(s.group))).toBe(false);
    const acid = predictPka("CC(=O)O")!;
    expect(acid.sites.some((s) => /Carboxylic/.test(s.group))).toBe(true);
  });

  test("the glycine zwitterion as drawn offers neither site a neutral pKa (both already charged)", () => {
    const z = predictPka("[NH3+]CC(=O)[O-]")!;
    expect(z.sites.filter((s) => /Carboxylic|amine/i.test(s.group))).toEqual([]);
  });
});

describe("13C NMR: charged substituents are not priced with the neutral parent's increments", () => {
  const paraShift = (smi: string): number => {
    const r = predictNmr(smi, "13C")!;
    // Monosubstituted benzene: ipso, ortho, meta, para → the para carbon is the
    // aromatic CH signal whose class holds ONE atom and is not ipso.
    const ring = r.signals.filter((s) => /aromatic/.test(s.assignment));
    const singles = ring.filter((s) => s.count === 1 && /CH/.test(s.assignment));
    expect(singles).toHaveLength(1);
    return singles[0].shift;
  };

  test("phenoxide: anisole's OR increments are NOT applied, and the phenoxide is named", () => {
    const r = predictNmr("[O-]c1ccccc1", "13C")!;
    expect(caveatText(r)).toMatch(/O⁻ \(phenoxide \/ alkoxide\)/);
    expect(caveatText(r)).toMatch(/no tabulated benzene increment/);
    // Para carbon: 128.5 with no increment (anisole would give 120.8).
    expect(paraShift("[O-]c1ccccc1")).toBeCloseTo(128.5, 5);
    expect(paraShift("COc1ccccc1")).toBeCloseTo(120.8, 5);
    expect(caveatText(predictNmr("COc1ccccc1", "13C"))).not.toMatch(/no tabulated benzene increment/);
  });

  test("anilinium / trimethylanilinium: aniline's donating increments are NOT applied", () => {
    for (const smi of ["[NH3+]c1ccccc1", "C[N+](C)(C)c1ccccc1"]) {
      const r = predictNmr(smi, "13C")!;
      expect(caveatText(r)).toMatch(/ammonio/);
      expect(paraShift(smi)).toBeCloseTo(128.5, 5);
    }
    // Aniline itself is unchanged: para 118.7.
    expect(paraShift("Nc1ccccc1")).toBeCloseTo(118.7, 5);
  });

  test("¹H: the same refusal on the proton side (phenoxide ortho H is not anisole's)", () => {
    const r = predictNmr("[O-]c1ccccc1", "1H")!;
    expect(caveatText(r)).toMatch(/phenoxide/);
    for (const s of r.signals.filter((s) => /aromatic/.test(s.assignment))) expect(s.shift).toBeCloseTo(7.26, 5);
  });

  test("benzamidine: the C=N carbon is NOT an alkyl substituent, and is named", () => {
    const r = predictNmr("N=C(N)c1ccccc1", "13C")!;
    expect(caveatText(r)).toMatch(/C=N \(imine \/ amidine carbon\)/);
    expect(paraShift("N=C(N)c1ccccc1")).toBeCloseTo(128.5, 5);
    // Ethylbenzene's alkyl increment (−2.8 para) still applies to ethylbenzene.
    expect(paraShift("CCc1ccccc1")).toBeCloseTo(125.7, 5);
  });
});

describe("pKa Hammett: charged ring substituents", () => {
  test("4-(trimethylammonio)benzoic acid: σp +0.82 (Hansch–Leo) is applied — the acid gets STRONGER", () => {
    const r = predictPka("OC(=O)c1ccc([N+](C)(C)C)cc1")!;
    const site = r.sites.find((s) => /Benzoic/.test(s.group))!;
    expect(site.pka).toBeCloseTo(4.2 - 0.82, 2);
    expect(site.note).toMatch(/NR3\+ para σ=\+0\.82/);
    // The old classification ("NR2", σp −0.83) made it WEAKER than benzoic acid.
    expect(site.pka).toBeLessThan(4.2);
  });

  test("4-phenoxide and 4-ammonio on benzoic acid: no sourced σ, so EXCLUDED and said so", () => {
    for (const [smi, name] of [
      ["OC(=O)c1ccc([O-])cc1", /phenoxide/],
      ["OC(=O)c1ccc([NH3+])cc1", /NH₃⁺ \(ammonio\)/],
    ] as [string, RegExp][]) {
      const site = predictPka(smi)!.sites.find((s) => /Benzoic/.test(s.group))!;
      expect(site.pka).toBe(4.2);
      expect(site.note).toMatch(/EXCLUDED, no σ tabulated here/);
      expect(site.note).toMatch(name);
    }
  });

  test("4-carboxylatobenzoic acid (hydrogen terephthalate): COO⁻ σp 0.00 applied, note shows it", () => {
    const site = predictPka("OC(=O)c1ccc(C(=O)[O-])cc1")!.sites.find((s) => /Benzoic/.test(s.group))!;
    expect(site.pka).toBeCloseTo(4.2, 2);
    expect(site.note).toMatch(/COO- para σ=\+0\.00/);
  });
});

describe("nitrile oxide is neither a nitrile nor an isocyanide, in IR and NMR", () => {
  test("IR: no 2245 nitrile band; the group is named as untabulated", () => {
    const r = predictIr("CC#[N+][O-]")!;
    expect(r.bands.some((b) => /nitrile/.test(b.assignment))).toBe(false);
    expect(caveatText(r)).toMatch(/nitrile oxide/);
    expect(caveatText(r)).not.toMatch(/isocyanide/);
    // Acetonitrile and methyl isocyanide are unchanged.
    expect(predictIr("CC#N")!.bands.some((b) => /C≡N stretch \(nitrile\)/.test(b.assignment))).toBe(true);
    expect(caveatText(predictIr("C[N+]#[C-]"))).toMatch(/isocyanide/);
  });

  test("13C: the C≡N carbon is omitted and named; the isocyanide text is not used for it", () => {
    const r = predictNmr("CC#[N+][O-]", "13C")!;
    expect(r.signals.some((s) => /nitrile/.test(s.assignment))).toBe(false);
    expect(r.signals.some((s) => s.shift === 118)).toBe(false);
    expect(caveatText(r)).toMatch(/nitrile oxide/);
    expect(caveatText(r)).not.toMatch(/isocyanide carbon/);
    expect(predictNmr("CC#N", "13C")!.signals.some((s) => s.shift === 118)).toBe(true);
  });

  test("benzonitrile oxide on a ring: the CN increments are not applied and the group is named", () => {
    const r = predictNmr("[O-][N+]#Cc1ccccc1", "13C")!;
    expect(caveatText(r)).toMatch(/no tabulated benzene increment/);
    const bn = predictNmr("N#Cc1ccccc1", "13C")!;
    expect(caveatText(bn)).not.toMatch(/no tabulated benzene increment/);
  });
});
