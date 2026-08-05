// The spectra predictors must refuse rather than invent — the reproductions.
//
// Every test in this file is a MEASURED defect from the 2026-08-05 gap analysis
// (0.11, 0.12, 0.13, 1.10, 0.20), preserved as a named case. Each one shipped a
// confident number with no caveat attached, which is this product's worst failure
// mode: an absent prediction is visible on screen, a wrong one is not.
//
//   0.11  sodium chloride was given a "C-Cl stretch" — the band was keyed on the
//         ELEMENT chlorine, with no check that a carbon was bonded to it.
//   0.12  every carbonyl-like carbon carbonylKind could not NAME fell through to
//         a generic sp2 branch and came back as a confident δ 160.0. carbon
//         dioxide (real ≈125), carbon disulfide (≈193) and phosgene (≈142) all
//         got the same number and the same label. carbon monoxide came back as
//         an alkyne at δ 84 against a real ≈184.
//   0.13  Woodward-Fieser was applied without limit: beta-carotene 534 nm
//         (real ≈450) carrying the caveat "typically ±5 nm within their domain",
//         and anthracene 254 nm (real ≈375) from the benzene B-band table.
//   1.10  IR said nothing at all about azide / isothiocyanate / isocyanide / N=N,
//         all of which sit ABOVE the deliberately-refused fingerprint region.
//   0.20  the sp3 1H path never reported a substituent that contributed nothing,
//         while the 13C path already did.
//
// The regression halves matter as much as the refusals: a fix that guts real
// chemistry to silence a defect is not a fix.

import { predictIr } from "../ir";
import { predictNmr } from "../nmr";
import { predictUvVis } from "../uvvis";

const assignments = (input: string): string => predictIr(input)!.bands.map((b) => b.assignment).join(" | ");
const irCaveats = (input: string): string => predictIr(input)!.caveats.join(" ");
const nmrCaveats = (input: string, nuc: "1H" | "13C"): string => predictNmr(input, nuc)!.caveats.join(" ");
const shifts = (input: string, nuc: "1H" | "13C"): number[] => predictNmr(input, nuc)!.signals.map((s) => s.shift);

// ---------------------------------------------------------------------------
// 0.11 — a C-halogen band needs a CARBON
// ---------------------------------------------------------------------------
describe("0.11 IR C-halogen bands require a carbon-halogen bond", () => {
  test("sodium chloride gets no C-Cl stretch — it has no carbon at all", () => {
    // Reachable exactly as a user reaches it: the dictionary carries this under
    // "sodium chloride", "salt" and "table salt".
    expect(assignments("sodium chloride")).not.toMatch(/C-Cl/);
    expect(predictIr("sodium chloride")!.bands).toHaveLength(0);
  });

  test("an ionic halide says so, rather than returning a silently empty spectrum", () => {
    expect(irCaveats("sodium chloride")).toMatch(/No band is predicted for this structure/);
    expect(irCaveats("sodium chloride")).toMatch(/REFUSAL to predict, not a prediction of a featureless/);
  });

  test("hydrochloric acid gets no C-Cl stretch", () => {
    expect(assignments("hydrochloric acid")).not.toMatch(/C-Cl/);
  });

  test("hexafluorophosphate gets no C-F stretch", () => {
    expect(assignments("F[P-](F)(F)(F)(F)F")).not.toMatch(/C-F/);
  });

  test("REGRESSION: real carbon-halogen bonds still get their bands", () => {
    expect(assignments("ClC(Cl)(Cl)Cl")).toMatch(/C-Cl/); // carbon tetrachloride
    expect(assignments("CCCl")).toMatch(/C-Cl/);
    expect(assignments("Clc1ccccc1")).toMatch(/C-Cl/); // aromatic carbon counts
    expect(assignments("FC(F)(F)C(F)(F)F")).toMatch(/C-F/);
    expect(assignments("CCBr")).toMatch(/C-Br/);
    expect(assignments("CI")).toMatch(/C-I/);
  });
});

// ---------------------------------------------------------------------------
// 0.12 — no invented shift for a carbon the model cannot name
// ---------------------------------------------------------------------------
describe("0.12 13C omits the carbonyl-like carbons it cannot name", () => {
  test("carbon dioxide gets no δ 160 sp2 carbon", () => {
    const r = predictNmr("carbon dioxide", "13C")!;
    expect(r.signals.map((s) => s.assignment).join(" ")).not.toMatch(/C=N|C=S/);
    expect(r.signals).toHaveLength(0);
    expect(r.caveats.join(" ")).toMatch(/omitted/i);
  });

  test("carbon disulfide gets no δ 160 sp2 carbon", () => {
    expect(shifts("carbon disulfide", "13C")).toHaveLength(0);
    expect(nmrCaveats("carbon disulfide", "13C")).toMatch(/omitted/i);
  });

  test("phosgene gets no δ 160 sp2 carbon", () => {
    expect(shifts("O=C(Cl)Cl", "13C")).toHaveLength(0);
    expect(nmrCaveats("O=C(Cl)Cl", "13C")).toMatch(/omitted/i);
  });

  test("methyl isothiocyanate: the N=C=S carbon is omitted, the methyl survives", () => {
    const r = predictNmr("CN=C=S", "13C")!;
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0].dept).toBe("CH3");
    expect(r.caveats.join(" ")).toMatch(/omitted/i);
  });

  test("an acyl silane and a selenoester lose only the acyl carbon", () => {
    for (const smi of ["CC(=O)[SiH3]", "CC(=O)[Se]C"]) {
      const r = predictNmr(smi, "13C")!;
      expect(r.signals.map((s) => s.assignment).join(" ")).not.toMatch(/C=N|C=S/);
      expect(r.caveats.join(" ")).toMatch(/omitted/i);
    }
  });

  test("carbon monoxide is not an alkyne — no δ 84", () => {
    const r = predictNmr("carbon monoxide", "13C")!;
    expect(r.signals).toHaveLength(0);
    expect(r.caveats.join(" ")).toMatch(/carbon monoxide|triple-bonded/i);
  });

  test("ketene's protons are not alkene protons — no δ 5.25", () => {
    const r = predictNmr("C=C=O", "1H")!;
    expect(r.signals).toHaveLength(0);
    expect(r.caveats.join(" ")).toMatch(/omitted/i);
  });

  test("allene: the cumulated carbons are omitted in both nuclei", () => {
    expect(shifts("C=C=C", "13C")).toHaveLength(0);
    expect(shifts("C=C=C", "1H")).toHaveLength(0);
  });

  test("REGRESSION: the named carbonyls, nitriles and alkynes still predict", () => {
    expect(shifts("CC(C)=O", "13C").some((s) => s > 195)).toBe(true); // ketone ~205
    expect(shifts("CC#N", "13C").some((s) => Math.abs(s - 118) < 1)).toBe(true); // nitrile
    expect(shifts("C#CC", "13C").some((s) => s > 60 && s < 90)).toBe(true); // alkyne
    expect(shifts("CC(=O)OCC", "13C").some((s) => s > 165 && s < 180)).toBe(true); // ester
    // A genuine C=N imine still reaches the generic sp2 branch — the guard must
    // remove the cumulenes, not the real one-double-bond sp2 heteroatom cases.
    expect(shifts("CC=NC", "13C").some((s) => s > 150)).toBe(true);
  });

  test("REGRESSION: ordinary alkene protons and carbons are untouched", () => {
    expect(shifts("C=CC", "1H").some((s) => s > 4.5 && s < 6.5)).toBe(true);
    expect(shifts("C=CC", "13C").some((s) => s > 110 && s < 140)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 0.20 — the sp3 1H path names what it ignored, as 13C already does
// ---------------------------------------------------------------------------
describe("0.20 sp3 1H reports substituents that contributed nothing", () => {
  test("an acyl silane's methyl protons carry the same warning the carbons do", () => {
    expect(nmrCaveats("CC(=O)[SiH3]", "1H")).toMatch(/contributed NOTHING/);
    expect(nmrCaveats("CC(=O)[SiH3]", "13C")).toMatch(/contributed NOTHING/);
  });

  test("a selenoester's methyl protons do too", () => {
    expect(nmrCaveats("CC(=O)[Se]C", "1H")).toMatch(/contributed NOTHING/);
  });

  test("methyl isothiocyanate's methyl is flagged — its real δ is ≈3.1, not 0.87", () => {
    expect(nmrCaveats("CN=C=S", "1H")).toMatch(/contributed NOTHING/);
  });

  test("REGRESSION: ordinary molecules are NOT flagged", () => {
    for (const smi of ["CCO", "Cc1ccccc1", "CC(C)=O", "CCCC", "CC(=O)OCC", "CCN"]) {
      expect(nmrCaveats(smi, "1H")).not.toMatch(/contributed NOTHING/);
    }
  });
});

// ---------------------------------------------------------------------------
// 0.13 — Woodward-Fieser has a domain, and the header claims it is enforced
// ---------------------------------------------------------------------------
describe("0.13 UV-Vis refuses outside the Woodward-Fieser domain", () => {
  test("beta-carotene gets no λmax — 534 nm against a real ≈450 was the defect", () => {
    const r = predictUvVis("beta-carotene")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
    // It is NOT transparent: it is orange. The refusal must not be reported as
    // "absorbs below 200 nm".
    expect(r.transparent).toBe(false);
    // The shipped accuracy CLAIM must be gone. (The refusal may still mention
    // ±5 nm to say it does not apply — what must not survive is the assertion
    // that this answer is good to ±5 nm.)
    expect(r.caveats.join(" ")).not.toMatch(/typically ±5 nm/);
    expect(r.caveats.join(" ")).toMatch(/calibrat/i);
  });

  test("lycopene gets no λmax either", () => {
    const r = predictUvVis("lycopene")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
    expect(r.transparent).toBe(false);
  });

  test("anthracene is not given the benzene B-band at 254 nm", () => {
    const r = predictUvVis("anthracene")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/fused/i);
  });

  test("naphthalene is not given the benzene B-band at 254 nm", () => {
    const r = predictUvVis("naphthalene")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
  });

  test("a BRANCHED polyene is refused — the increments are additive along one chain", () => {
    const r = predictUvVis("C=CC(=C)C=C")!; // 3-methylene-1,4-pentadiene
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/cross-conjugat/i);
  });

  test("a refusal carries no arithmetic to audit", () => {
    for (const smi of ["beta-carotene", "anthracene", "C=CC(=C)C=C"]) {
      expect(predictUvVis(smi)!.contributions).toHaveLength(0);
    }
  });

  // The adversarial pass on this fix caught the first version REFUSING these —
  // and the refusal's stated reason was wrong, because Woodward-Fieser really
  // does tabulate the cross-conjugated dienone. Losing a 1 nm-accurate answer is
  // not honesty, it is a regression wearing honesty's clothes.
  test("a cross-conjugated dienone keeps its value and is FLAGGED, not refused", () => {
    for (const [name, real] of [
      ["prednisone", 238],
      ["dexamethasone", 239],
    ] as [string, number][]) {
      const r = predictUvVis(name)!;
      expect({ name, out: r.outOfDomain }).toEqual({ name, out: false });
      expect(Math.abs(r.lambdaMax! - real)).toBeLessThanOrEqual(5);
      expect(r.caveats.join(" ")).toMatch(/cross-conjugated dienone/i);
    }
  });

  test("the domain test is a property of the MOLECULE, not of the SMILES ordering", () => {
    // Same molecular class, written two ways: a short diene and a pentaene in
    // one molecule. Reading only the first conjugated system in atom order gave
    // a confident 219 nm for one ordering and a refusal for the other.
    //
    // Asserting "both are refused" would also pass if a future change refused
    // EVERYTHING, so the assertion is that the two answers AGREE, field for
    // field, and separately that the in-domain regressions above still hold.
    const dieneFirst = predictUvVis("C=CC=CCCCCCC=CC=CC=CC=CC=CC=C")!;
    const polyeneFirst = predictUvVis("C=CC=CC=CC=CC=CC=CCCCCCC=CC=C")!;
    const shape = (r: typeof dieneFirst) => ({
      out: r.outOfDomain,
      lambda: r.lambdaMax,
      transparent: r.transparent,
      chromophore: r.chromophore,
      caveats: r.caveats,
    });
    expect(shape(dieneFirst)).toEqual(shape(polyeneFirst));
    expect(dieneFirst.outOfDomain).toBe(true);
  });

  // THE REGRESSION THE FIRST VERSION OF THIS FIX SHIPPED. `conjugatedSystems`
  // counted every carbonyl bonded to the chromophore as a chain EXTENSION, so a
  // decorated single C=C was refused as a five-unit polyene. Nothing in this
  // file exercised a carbonyl-decorated system, which is exactly why it got out.
  test("a DECORATED chromophore is not mistaken for an extended one", () => {
    // Ethylenetetracarboxylic acid: ONE C=C carrying four -COOH. Only two of
    // them can lie on the chain (one at each end); the others decorate it.
    const tetra = predictUvVis("OC(=O)C(C(=O)O)=C(C(=O)O)C(=O)O")!;
    expect(tetra.outOfDomain).toBe(false);
    expect(tetra.lambdaMax).not.toBeNull();

    const decorated = predictUvVis("OC(=O)C(C(=O)O)=CC=CC(=O)O")!; // 2 C=C, 3 COOH
    expect(decorated.outOfDomain).toBe(false);

    // Muconic acid: 2 C=C with a -COOH on each END — those DO extend it, to 4
    // units, which is the limit and still inside it.
    const muconic = predictUvVis("OC(=O)C=CC=CC(=O)O")!;
    expect(muconic.outOfDomain).toBe(false);
  });

  test("a carbonyl on the END of a long chain still counts toward the limit", () => {
    // Retinal: 5 conjugated C=C plus a terminal CHO = 6 units. The extension
    // rule must not become a licence to ignore carbonyls altogether.
    const r = predictUvVis("CC1=C(C(CC1)(C)C)C=CC(=CC=CC(=CC=O)C)C")!;
    expect(r).not.toBeNull();
    expect(r.outOfDomain).toBe(true);
    // And the boundary from both sides: 4 C=C + terminal CHO = 5 units is the
    // limit and is kept; 5 C=C + CHO = 6 is over it and is refused.
    expect(predictUvVis("C=CC=CC=CC=CC=O")!.outOfDomain).toBe(false);
    expect(predictUvVis("C=CC=CC=CC=CC=CC=O")!.outOfDomain).toBe(true);
  });

  test("a conjugated RING system is refused for the right reason, not as a polyene", () => {
    // Azulene is a non-benzenoid aromatic that OCL does not perceive as
    // aromatic, so it reaches the polyene path by its Kekulé bonds. Refusing it
    // is right; calling it an extended polyene is not.
    const az = predictUvVis("c1ccc2cccc2cc1")!;
    expect(az).not.toBeNull();
    expect(az.outOfDomain).toBe(true);
    expect(az.caveats.join(" ")).toMatch(/closes a RING|annulene|azulene/i);
    expect(az.chromophore).not.toMatch(/polyene/i);

    // heme is a dictionary entry, so this reaches users by name. Its porphyrin
    // nitrogens are aromatic, so the heteroaromatic gate now claims it first —
    // a more precise reason than either ring rule, and the assertion that
    // matters is that it is never described as a polyene.
    const heme = predictUvVis("heme")!;
    expect(heme).not.toBeNull();
    expect(heme.outOfDomain).toBe(true);
    expect(heme.chromophore).not.toMatch(/polyene/i);
    expect(heme.caveats.join(" ")).toMatch(/heteroaromatic|closes a RING|porphyrin/i);
  });

  test("the dienone flag stays OFF an ordinary single enone", () => {
    for (const name of ["testosterone", "progesterone", "CC(=O)C=C(C)C"]) {
      const r = predictUvVis(name);
      if (!r) continue;
      expect({ name, flagged: /cross-conjugated dienone/i.test(r.caveats.join(" ")) }).toEqual({
        name,
        flagged: false,
      });
    }
  });

  test("a refusal never carries a caveat written for a value that was not produced", () => {
    // The multi-enone caveat says "λmax is computed for one of them … the one
    // below". If a refusal fires afterwards there is nothing below, and the
    // result contradicts itself. The gates therefore run BEFORE anything is
    // added to the caveat set — which is load-bearing ordering, so it is pinned.
    const r = predictUvVis("O=CC=CC=CC=CC=CC=O")!;
    expect(r.outOfDomain).toBe(true);
    expect(r.caveats.join(" ")).not.toMatch(/the one below/);
    expect(r.caveats.join(" ")).not.toMatch(/computed for one of them/);
  });

  test("an in-domain enone does not let a long polyene slip past the limit", () => {
    // The enone branch runs first and only ever looks at one enone; the size
    // check has to happen before it.
    const r = predictUvVis("CC(=O)C=CCCCCCC=CC=CC=CC=CC=CC=C")!;
    expect(r.lambdaMax).toBeNull();
    expect(r.outOfDomain).toBe(true);
  });

  test("REGRESSION: real in-domain molecules keep their λmax", () => {
    // Not a toy SMILES among them — the first version of this fix passed every
    // toy case in this file while refusing two real drugs.
    //
    // NO `if (!r) continue` HERE. That guard was in this test and it silently
    // disabled the chalcone row entirely, because "chalcone" is not a dictionary
    // name and predictUvVis returned null: the assertion passed having checked
    // nothing at all. An input that does not resolve is a broken test, not a
    // skipped one, so it now fails loudly and chalcone is given as SMILES.
    for (const [name, input, lo, hi] of [
      ["vitamin D3", "vitamin d3", 240, 290],
      ["chalcone", "O=C(/C=C/c1ccccc1)c1ccccc1", 200, 400],
      ["testosterone", "testosterone", 200, 300],
      ["progesterone", "progesterone", 200, 300],
      ["cinnamaldehyde", "cinnamaldehyde", 200, 400],
    ] as [string, string, number, number][]) {
      const r = predictUvVis(input);
      expect({ name, resolved: r !== null }).toEqual({ name, resolved: true });
      expect({ name, out: r!.outOfDomain }).toEqual({ name, out: false });
      expect({ name, ok: r!.lambdaMax !== null && r!.lambdaMax >= lo && r!.lambdaMax <= hi }).toEqual({
        name,
        ok: true,
      });
    }
  });

  // -------------------------------------------------------------------------
  // D2 — where the size limit goes is a MEASURED question
  // -------------------------------------------------------------------------
  test("retinol keeps its λmax — the limit must not refuse answers better than the ones it keeps", () => {
    // At a limit of 4 conjugated units this was REFUSED (9 nm from the real
    // ≈325) while octatetraene's 26 nm answer was printed. A gate calibrated so
    // that accuracy and acceptance run in opposite directions is not a domain
    // boundary. Both dictionary spellings reach it.
    for (const name of ["retinol", "vitamin a"]) {
      const r = predictUvVis(name);
      expect({ name, resolved: r !== null }).toEqual({ name, resolved: true });
      expect({ name, out: r!.outOfDomain }).toEqual({ name, out: false });
      expect({ name, near: Math.abs(r!.lambdaMax! - 325) <= 15 }).toEqual({ name, near: true });
    }
  });

  test("the extended-conjugation increment is pinned to values, and its real error is disclosed", () => {
    // Was `triene - diene === 30`, which asserts the +30 constant against
    // itself and would survive any change to either endpoint. These are the
    // absolute numbers, next to the literature values they are being compared
    // with — which is where the ±5 claim visibly stops holding.
    const diene = predictUvVis("C=CC=C")!; // real ≈217
    const triene = predictUvVis("C=CC=CC=C")!; // real ≈258
    const tetraene = predictUvVis("C=CC=CC=CC=C")!; // real ≈300
    // Predicted 214 / 244 / 274 against literature 217 / 258 / 300: the error
    // grows −3, −14, −26 as the chain extends. That is the curve the size limit
    // is calibrated against and the reason the ±5 claim is withdrawn past a
    // simple diene.
    expect({ diene: diene.lambdaMax, triene: triene.lambdaMax, tetraene: tetraene.lambdaMax }).toEqual({
      diene: 214,
      triene: 244,
      tetraene: 274,
    });
    // A simple diene may still claim ±5. An extended one must not, and must say so.
    expect(diene.caveats.join(" ")).not.toMatch(/EXTENDED|about 14 nm low/);
    for (const r of [triene, tetraene]) {
      expect(r.caveats.join(" ")).toMatch(/EXTENDED/);
      expect(r.caveats.join(" ")).toMatch(/14 nm low on a triene/);
    }
  });

  // -------------------------------------------------------------------------
  // D3 — a ring that is not benzene must not be given benzene's B-band
  // -------------------------------------------------------------------------
  test("a heteroaromatic ring is never reported as a benzene B-band", () => {
    for (const [name, input] of [
      ["pyridine", "c1ccncc1"],
      ["furan", "c1ccoc1"], // real ≈208
      ["thiophene", "c1ccsc1"],
      ["pyrrole", "c1cc[nH]c1"],
      ["imidazole", "c1c[nH]cn1"],
      ["pyrimidine", "c1ccncn1"],
      ["caffeine", "caffeine"], // real ≈273; OCL sees only the imidazole as aromatic
      ["guanine", "guanine"], // real ≈246
      ["histidine", "histidine"],
      ["nicotine", "nicotine"],
    ] as [string, string][]) {
      const r = predictUvVis(input);
      expect({ name, resolved: r !== null }).toEqual({ name, resolved: true });
      expect({ name, out: r!.outOfDomain, lambda: r!.lambdaMax }).toEqual({ name, out: true, lambda: null });
      expect({ name, benzene: /benzene/i.test(r!.chromophore) }).toEqual({ name, benzene: false });
      expect(r!.caveats.join(" ")).toMatch(/heteroaromatic/i);
    }
  });

  test("an aromatic ring fused into a second CONJUGATED ring is not a benzene B-band either", () => {
    // isFusedAromatic only sees fusion OpenChemLib perceives as one aromatic
    // system, so it misses both of these — the same blind spot that let azulene
    // through — and both were being handed benzene's 254 nm.
    for (const [name, input] of [
      ["anthraquinone", "O=C1c2ccccc2C(=O)c2ccccc21"], // real ≈325
      ["riboflavin", "riboflavin"], // real 445/375/267 — it is bright yellow
      ["coumarin", "O=c1ccc2ccccc2o1"],
    ] as [string, string][]) {
      const r = predictUvVis(input);
      expect({ name, resolved: r !== null }).toEqual({ name, resolved: true });
      expect({ name, out: r!.outOfDomain, lambda: r!.lambdaMax }).toEqual({ name, out: true, lambda: null });
      expect({ name, benzene: /benzene/i.test(r!.chromophore) }).toEqual({ name, benzene: false });
    }
  });

  test("REGRESSION: an isolated benzene ring — however substituted — keeps its tabulated band", () => {
    // The gate must catch rings that are not benzene, not benzene rings that
    // carry things. tetralin and indane are the discriminating pair: a benzene
    // fused to a SATURATED ring extends nothing. morphine and strychnine are
    // the real-molecule version of the same test — an earlier draft refused
    // them because their second ring holds a saturated O or N, while phenol and
    // anisole, the same donating group attached acyclically, were kept.
    for (const [name, input] of [
      ["benzene", "c1ccccc1"],
      ["toluene", "Cc1ccccc1"],
      ["phenol", "Oc1ccccc1"],
      ["anisole", "COc1ccccc1"],
      ["acetophenone", "CC(=O)c1ccccc1"],
      ["benzophenone", "O=C(c1ccccc1)c1ccccc1"],
      ["biphenyl", "c1ccc(-c2ccccc2)cc1"],
      ["styrene", "C=Cc1ccccc1"],
      ["tetralin", "C1CCc2ccccc2C1"],
      ["indane", "C1Cc2ccccc2C1"],
      ["morphine", "morphine"],
      ["strychnine", "strychnine"], // real ≈254 — the exact value a wider gate threw away
    ] as [string, string][]) {
      const r = predictUvVis(input);
      expect({ name, resolved: r !== null }).toEqual({ name, resolved: true });
      expect({ name, out: r!.outOfDomain, lambda: r!.lambdaMax }).toEqual({ name, out: false, lambda: 254 });
    }
  });

  test("REGRESSION: the in-domain cases are unchanged and NOT flagged", () => {
    const butadiene = predictUvVis("C=CC=C")!;
    expect(butadiene.outOfDomain).toBe(false);
    expect(Math.abs(butadiene.lambdaMax! - 217)).toBeLessThanOrEqual(6);

    const triene = predictUvVis("C=CC=CC=C")!;
    expect(triene.outOfDomain).toBe(false);
    expect(triene.lambdaMax! - butadiene.lambdaMax!).toBe(30);

    const mesityl = predictUvVis("CC(=O)C=C(C)C")!;
    expect(mesityl.outOfDomain).toBe(false);
    expect(Math.abs(mesityl.lambdaMax! - 237)).toBeLessThanOrEqual(5);

    const benzene = predictUvVis("c1ccccc1")!;
    expect(benzene.outOfDomain).toBe(false);
    expect(benzene.lambdaMax).toBe(254);

    const alkane = predictUvVis("CCCC")!;
    expect(alkane.outOfDomain).toBe(false);
    expect(alkane.transparent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.10 — IR names the groups it cannot assign, as NMR already does
// ---------------------------------------------------------------------------
describe("1.10 IR discloses groups it has no band for", () => {
  test("phenyl azide: the azide is named, not silently dropped — and not called an azo", () => {
    const r = predictIr("c1ccccc1N=[N+]=[N-]")!;
    expect(r.caveats.join(" ")).toMatch(/azide/i);
    // An azide contains N=N-N; calling it an azo compound would name a group the
    // molecule does not have.
    expect(r.caveats.join(" ")).not.toMatch(/azo \(N=N\)/);
    // The aromatic bands it CAN assign are still there — this is a disclosure,
    // not a refusal to predict the rest.
    expect(r.bands.some((b) => b.assignment.includes("aromatic"))).toBe(true);
  });

  test("an isothiocyanate is named", () => {
    expect(irCaveats("CN=C=S")).toMatch(/isothiocyanate/i);
  });

  test("an isocyanide gets no nitrile band and is named", () => {
    // C≡N with a SUBSTITUTED nitrogen is an isocyanide (ν ≈ 2150), not a nitrile
    // (≈2245) — the old code gave it the nitrile band.
    expect(assignments("C[N+]#[C-]")).not.toMatch(/nitrile/i);
    expect(irCaveats("C[N+]#[C-]")).toMatch(/isocyanide/i);
  });

  test("an azo compound is named", () => {
    expect(irCaveats("c1ccccc1N=Nc1ccccc1")).toMatch(/azo \(N=N\)/);
  });

  test("a diazo group and nitrous oxide are NOT called azo — they have no N=N", () => {
    // [N-]=[N+]=O is a dictionary entry, so this reached users.
    for (const smi of ["nitrous oxide", "C=[N+]=[N-]", "CCOC(=O)C=[N+]=[N-]"]) {
      const c = irCaveats(smi);
      expect({ smi, azo: /azo \(N=N\)/.test(c) }).toEqual({ smi, azo: false });
      expect({ smi, named: /diazo|cumulated nitrogen/i.test(c) }).toEqual({ smi, named: true });
    }
  });

  test("a nitro group is never announced as a diazo — in either SMILES form", () => {
    // CN(=O)=O is the pentavalent form of nitromethane: a cumulated NITROGEN by
    // bond count, but its two double bonds go to OXYGEN. Calling that a diazo
    // group would contradict the nitro bands the same result correctly predicts.
    for (const smi of ["CN(=O)=O", "C[N+](=O)[O-]", "O=[N+]([O-])c1ccccc1", "O=N(=O)c1ccccc1"]) {
      const c = irCaveats(smi);
      expect({ smi, diazo: /diazo|cumulated nitrogen/i.test(c) }).toEqual({ smi, diazo: false });
      expect({ smi, bands: /N=O stretch \(nitro/.test(assignments(smi)) }).toEqual({ smi, bands: true });
    }
  });

  test("the no-band caveat does not assert far-IR absorptions for an IR-INACTIVE molecule", () => {
    // N2 and O2 are rigorously IR-inactive: the one case where "no spectrum" is
    // literally true. The first version of this caveat told the user they still
    // had "real absorptions".
    for (const smi of ["nitrogen", "oxygen", "sodium chloride"]) {
      const c = irCaveats(smi);
      expect({ smi, refuses: /REFUSAL to predict/.test(c) }).toEqual({ smi, refuses: true });
      expect({ smi, claims: /still ha[sv]e? real absorptions/i.test(c) }).toEqual({ smi, claims: false });
    }
  });

  test("a ketene and an allene get no ordinary alkene C=C band", () => {
    // ν(C=C=O) is 2151 and ν(C=C=C) 1957 — the alkene branch was printing 1650.
    for (const smi of ["C=C=O", "C=C=C"]) {
      expect({ smi, band: /C=C stretch \(alkene\)/.test(assignments(smi)) }).toEqual({ smi, band: false });
      expect({ smi, named: /cumulated/i.test(irCaveats(smi)) }).toEqual({ smi, named: true });
    }
    // An ordinary alkene still has it.
    expect(assignments("C=CC")).toMatch(/C=C stretch \(alkene\)/);
  });

  test("IR and ¹³C agree about carbon disulfide and carbon monoxide too", () => {
    // ¹³C names both classes and refuses a shift; IR used to say nothing at all,
    // so the two modules disagreed about whether a namable group was present.
    expect(irCaveats("carbon disulfide")).toMatch(/cumulated C=S/);
    expect(nmrCaveats("carbon disulfide", "13C")).toMatch(/S=C=S/);
    expect(irCaveats("carbon monoxide")).toMatch(/C≡O/);
    expect(nmrCaveats("carbon monoxide", "13C")).toMatch(/carbon monoxide/i);
    // A thioamide/thioketone C=S is not cumulated and is not swept up.
    expect(irCaveats("CC(=S)C")).not.toMatch(/cumulated C=S/);
  });

  test("IR and ¹³C agree about an isocyanide — neither calls it a nitrile", () => {
    expect(assignments("C[N+]#[C-]")).not.toMatch(/nitrile/i);
    const c = predictNmr("C[N+]#[C-]", "13C")!;
    expect(c.signals.map((s) => s.assignment).join(" ")).not.toMatch(/nitrile/i);
    expect(c.caveats.join(" ")).toMatch(/isocyanide/i);
    // The nitrile itself is untouched.
    expect(predictNmr("CC#N", "13C")!.signals.some((s) => Math.abs(s.shift - 118) < 1)).toBe(true);
  });

  test("a C=O the classifier will not name is disclosed rather than passed over in silence", () => {
    expect(irCaveats("carbon dioxide")).toMatch(/C=O this model will not classify/);
    // The disclosure lists the refused CLASSES; it must not read as a claim that
    // the structure on screen is one named example (a phosgene user was being
    // told about carbon dioxide).
    expect(irCaveats("O=C(Cl)Cl")).toMatch(/one of:/);
  });

  test("a nitrile is found whichever end of the triple bond is written first", () => {
    // "N#Cc1ccccc1" is as valid a way to write benzonitrile as "c1ccccc1C#N",
    // and the band must not depend on which atom got the lower index.
    expect(assignments("N#Cc1ccccc1")).toMatch(/nitrile/);
    expect(assignments("c1ccccc1C#N")).toMatch(/nitrile/);
  });

  test("REGRESSION: a real nitrile keeps its band and raises no disclosure", () => {
    expect(assignments("CC#N")).toMatch(/nitrile/);
    expect(irCaveats("CC#N")).not.toMatch(/no tabulated band/i);
    expect(irCaveats("CC(C)=O")).not.toMatch(/no tabulated band/i);
  });
});
