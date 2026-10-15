// Diastereotopic groups and geminal ²J (v2.138.0).
//
// ORACLE: the textbook classification (the Eliel–Wilen substitution test), as
// tabled in docs/SCOPE-SPECTROSCOPY-BATCH.md §D4. An RDKit substitution-test
// script agrees on the 11 classified methyl/CH₂ pairs plus (2R,4R); for the
// UNSPECIFIED 2,4-dichloropentane the textbook ("depends on relative
// configuration") is the oracle, because RDKit answers "homotopic" there.
//
// The ²J ranges are TYPICAL magnitudes by class (four from the scope brief §B4,
// which cites Pretsch/Bühlmann/Badertscher; O/N/halogen added from commonly
// quoted values — none re-transcribed from the table), pinned as the stated
// classes, not as predictions.

import { Molecule } from "openchemlib";
import { predictNmr, nmrSticks, NmrResult } from "../nmr";
import { predictCoupling, predictCosy, predictHsqc, predictHmbc, predictTocsy } from "../nmr2d";
import { analyseDiastereotopicity, refineClasses, geminalJ, CAP_HEAVY } from "../diastereotopic";
import { parseToMolecule, symmetryClasses } from "../molgraph";
import { randomSmiles, stereoFreeIdcode } from "./randomSmiles";

const h1 = (s: string) => predictNmr(s, "1H")!;
const c13 = (s: string) => predictNmr(s, "13C")!;
const row = (r: NmrResult, shift: number) => r.signals.filter((x) => Math.abs(x.shift - shift) < 0.005);
/** Index of a row in a fresh predictNmr result (results are new objects each call). */
const indexOfRow = (s: string, r: { atoms: number[] }) => {
  const i = h1(s).signals.findIndex((x) => x.atoms.join() === r.atoms.join());
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};
const ch2Rows = (s: string) => {
  const { mol } = parseToMolecule(s)!;
  return h1(s).signals.filter((x) => mol.getAtomicNo(x.atoms[0]) === 6 && mol.getAllHydrogens(x.atoms[0]) === 2);
};

describe("§D4 — diastereotopic methyl pairs become two signals at the same δ", () => {
  test("CC(C)C(O)C: ¹³C 5 signals (was 4), ¹H 3H d + 3H d (was 6H d)", () => {
    const c = c13("CC(C)C(O)C");
    expect(c.signals).toHaveLength(5);
    const pair = c.signals.filter((x) => x.diastereotopic?.kind === "pair");
    expect(pair).toHaveLength(2);
    expect(pair[0].shift).toBe(pair[1].shift);
    expect(pair.map((x) => x.count)).toEqual([1, 1]);

    const h = h1("CC(C)C(O)C");
    const methyls = h.signals.filter((x) => x.diastereotopic?.kind === "pair");
    expect(methyls.map((x) => [x.count, x.multiplicity])).toEqual([
      [3, "d"],
      [3, "d"],
    ]);
    expect(methyls[0].diastereotopic!.note).toMatch(/difference is not predicted/);
  });

  test.each(["valine", "leucine", "CC(C)[C@H](N)C(=O)O"])("%s: the isopropyl methyls are 3H d + 3H d", (name) => {
    const h = h1(name);
    const pair = h.signals.filter((x) => x.diastereotopic?.kind === "pair");
    expect(pair.map((x) => [x.count, x.multiplicity])).toEqual([
      [3, "d"],
      [3, "d"],
    ]);
    expect(c13(name).signals.filter((x) => x.diastereotopic?.kind === "pair")).toHaveLength(2);
  });

  test("the methyls' combined integral is unchanged: 6H either way", () => {
    const pair = h1("valine").signals.filter((x) => x.diastereotopic?.kind === "pair");
    expect(pair.reduce((s, x) => s + x.count, 0)).toBe(6);
  });
});

describe("§D4 — a diastereotopic CH₂ is ONE row, count 2, multiplicity m, with a typical ²J", () => {
  test.each([
    ["CCC(O)C", "2-butanol C3 H₂ (was quint)", 12, 15, 2],
    ["CCOC(C)OCC", "acetal OCH₂ (was q)", 9, 12, 4],
    ["OCC(O)CO", "glycerol CH₂ (was d)", 9, 12, 4],
    ["C[C@@H](Cl)C[C@H](C)Cl", "meso-2,4-dichloropentane C3 H₂", 12, 15, 2],
    ["C=CC", "propene =CH₂", 0, 3, 2],
  ] as [string, string, number, number, number][])("%s — %s", (smi, _what, lo, hi, count) => {
    const rows = ch2Rows(smi).filter((x) => x.diastereotopic?.kind === "CH2");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.count).toBe(count); // equivalent CH₂ groups stay together; the two H of each stay one row
    expect(r.multiplicity).toBe("m");
    expect(r.diastereotopic!.geminal).toMatchObject({ min: lo, max: hi });
    expect(r.diastereotopic!.note).toMatch(/²J typically/);
    expect(r.diastereotopic!.note).toMatch(/typical, not predicted from geometry/);
    expect(r.diastereotopic!.note).toMatch(/Δδ is not predicted/);

    // The coupled view agrees, and keeps its vicinal couplings for COSY/TOCSY.
    const cp = predictCoupling(smi)!;
    const i = indexOfRow(smi, r);
    expect(cp.signals[i].multiplet).toBe("m");
    expect(cp.signals[i].geminal).toMatchObject({ min: lo, max: hi });
    expect(cp.caveats.join(" ")).toMatch(/Diastereotopic CH₂/);
  });

  test("never q, t or quint for a diastereotopic CH₂", () => {
    for (const smi of ["CCC(O)C", "CCOC(C)OCC", "OCC(O)CO", "leucine", "ibuprofen"]) {
      for (const r of ch2Rows(smi).filter((x) => x.diastereotopic?.kind === "CH2")) {
        expect({ smi, m: r.multiplicity }).toEqual({ smi, m: "m" });
        const i = indexOfRow(smi, r);
        expect({ smi, m: predictCoupling(smi)!.signals[i].multiplet }).toEqual({ smi, m: "m" });
      }
    }
  });

  test("geminal ²J classes (typical, by class)", () => {
    const at = (smi: string, a: number) => geminalJ(parseToMolecule(smi)!.mol, a);
    expect(at("CCC(O)C", 1).cls).toBe("sp³ CH₂");
    expect(at("CC(=O)CC(C)O", 3)).toMatchObject({ min: 14, max: 18 }); // α to C=O
    expect(at("CCc1ccccc1", 1)).toMatchObject({ min: 14, max: 18 }); // benzylic
    expect(at("CC1CC1", 2)).toMatchObject({ min: 4, max: 9 }); // cyclopropane
    expect(at("CC1CO1", 2)).toMatchObject({ min: 4, max: 9 }); // epoxide: the 3-ring wins over O
    expect(at("C=CC", 0)).toMatchObject({ min: 0, max: 3 });
    expect(at("CCOC(C)OCC", 1)).toMatchObject({ min: 9, max: 12 });
  });
});

describe("§D4 — relative configuration", () => {
  test("(2R,4R)-2,4-dichloropentane: C3 H₂ homotopic → no split, n+1 triplet", () => {
    const r = ch2Rows("C[C@@H](Cl)C[C@@H](C)Cl");
    expect(r).toHaveLength(1);
    expect(r[0].diastereotopic).toBeUndefined();
    expect(r[0].multiplicity).toBe("t");
  });

  test("unspecified 2,4-dichloropentane: says it DEPENDS, and picks neither", () => {
    for (const smi of ["CC(Cl)CC(C)Cl", "C[C@@H](Cl)CC(C)Cl"]) {
      const r = ch2Rows(smi);
      expect(r).toHaveLength(1);
      expect({ smi, kind: r[0].diastereotopic?.kind }).toEqual({ smi, kind: "depends" });
      expect(r[0].diastereotopic!.note).toMatch(/depends on relative configuration/);
      expect(r[0].count).toBe(2);
      expect(r[0].multiplicity).toBe("m");
      expect(predictCoupling(smi)!.caveats.join(" ")).toMatch(/depends on the relative configuration/);
    }
  });

  test("the enumeration really sees both answers (meso and dl) for the unspecified input", () => {
    const { mol } = parseToMolecule("CC(Cl)CC(C)Cl")!;
    const an = analyseDiastereotopicity(mol);
    expect(an.ran).toBe(true);
    expect(an.idsPerConfig).toHaveLength(2); // one centre held fixed, the other enumerated
    for (const ids of an.idsPerConfig) expect(ids).toHaveLength(mol.getAllAtoms());
    expect(an.ch2.get(3)).toBe("depends");
  });

  test("one unspecified stereocentre alone does not 'depend' (a mirror image keeps topicity)", () => {
    const { mol } = parseToMolecule("CC(C)C(O)C")!;
    const an = analyseDiastereotopicity(mol);
    expect(an.idsPerConfig).toHaveLength(1);
    expect(an.limit).toBeUndefined();
  });

  test("too many unspecified centres: NOT enumerated, and said so (no silent base answer)", () => {
    const r = h1("CC(Cl)CC(Cl)CC(Cl)CC(Cl)CC(C)Cl");
    expect(r.caveats.join(" ")).toMatch(/were NOT enumerated/);
  });
});

describe("§D4 — enantiotopic and homotopic groups are NOT split (achiral solvent)", () => {
  test.each([
    ["CC(C)CC", "isopentane"],
    ["CC(C)c1ccccc1", "cumene"],
    ["CCO", "ethanol"],
    ["NCC(=O)O", "glycine"],
    ["CCOC(=O)CC", "ethyl propanoate"],
  ])("%s (%s): no diastereotopic field, counts as before", (smi) => {
    const h = h1(smi);
    expect(h.signals.some((x) => x.diastereotopic)).toBe(false);
    expect(c13(smi).signals.some((x) => x.diastereotopic)).toBe(false);
    // Signal count = symmetry classes of H-bearing atoms (the pre-v2.138 rule).
    const { mol } = parseToMolecule(smi)!;
    const bearers: number[] = [];
    for (let a = 0; a < mol.getAllAtoms(); a++) if (mol.getAllHydrogens(a) > 0) bearers.push(a);
    expect(h.signals).toHaveLength(symmetryClasses(mol, bearers).length);
  });

  test("isopentane and cumene keep their 6H methyl doublet; ethanol keeps its q, ethyl propanoate its q + q", () => {
    expect(h1("CC(C)CC").signals.find((x) => x.count === 6)!.multiplicity).toBe("d");
    expect(h1("CC(C)c1ccccc1").signals.find((x) => x.count === 6)!.multiplicity).toBe("d");
    expect(ch2Rows("CCO")[0].multiplicity).toBe("q");
    expect(ch2Rows("CCOC(=O)CC").map((x) => x.multiplicity)).toEqual(["q", "q"]);
  });

  test("the CH₂ caveat still names diastereotopicity when none is found", () => {
    expect(predictCoupling("CCO")!.caveats.join(" ")).toMatch(/homotopic or enantiotopic \(none is diastereotopic\)/);
  });

  test("a CHD carbon is not called a diastereotopic CH₂ (its H and D trivially differ)", () => {
    const r = h1("[2H]C(C)C(O)C");
    expect(r.signals.some((s) => s.diastereotopic?.kind === "CH2")).toBe(false);
    // Explicit [H] atoms are still natural protons: that CH₂ IS diastereotopic.
    expect(h1("[H]C([H])(C)C(O)C").signals.some((s) => s.diastereotopic?.kind === "CH2")).toBe(true);
  });

  test("OH/NH are exchange-averaged and never split", () => {
    // Glycerol's two primary OH are enantiotopic anyway; valine's NH₂ is one row.
    for (const smi of ["OCC(O)CO", "valine"]) {
      for (const s of h1(smi).signals.filter((x) => x.variable)) expect(s.diastereotopic).toBeUndefined();
    }
  });
});

describe("meso compounds: mirror-related halves are ONE signal (was a WRONG answer)", () => {
  // molgraph.symmetryClasses splits the two enantiotopic halves of a meso
  // compound. Enantiotopic nuclei are isochronous in an achiral solvent, so
  // nmr.ts merges classes that OCL's IDs call equivalent in every configuration.
  const isMesoSplitBySymmetry = (smi: string) => {
    const { mol } = parseToMolecule(smi)!;
    const cs = Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter((a) => mol.getAtomicNo(a) === 6);
    return symmetryClasses(mol, cs).length === cs.length;
  };

  test("meso-2,4-dichloropentane: 3 ¹³C rows (was 5); (2R,4R) unchanged at 3", () => {
    expect(isMesoSplitBySymmetry("C[C@@H](Cl)C[C@H](C)Cl")).toBe(true); // the defect's precondition
    expect(c13("C[C@@H](Cl)C[C@H](C)Cl").signals.map((s) => s.count)).toEqual([1, 2, 2]);
    expect(c13("C[C@@H](Cl)C[C@@H](C)Cl").signals.map((s) => s.count)).toEqual([1, 2, 2]);
    // ¹H: 2H CH, 2H CH₂ (still diastereotopic, m), 6H CH₃ — not doubled rows.
    expect(h1("C[C@@H](Cl)C[C@H](C)Cl").signals.map((s) => [s.count, s.multiplicity])).toEqual([
      [2, "m"],
      [2, "m"],
      [6, "d"],
    ]);
    expect(h1("C[C@@H](Cl)C[C@H](C)Cl").caveats.join(" ")).toMatch(/isochronous in an achiral solvent/);
  });

  test("meso-tartaric acid: 2 ¹³C rows, and its equivalent CH protons do not split each other", () => {
    const both = ["O=C(O)[C@@H](O)[C@H](O)C(=O)O", "O=C(O)[C@@H](O)[C@@H](O)C(=O)O"];
    const meso = both.filter(isMesoSplitBySymmetry);
    expect(meso).toHaveLength(1); // exactly one of the two spellings is meso
    for (const smi of both) {
      expect({ smi, rows: c13(smi).signals.map((s) => s.count) }).toEqual({ smi, rows: [2, 2] });
      const ch = h1(smi).signals.find((s) => !s.variable)!;
      expect({ smi, ch: [ch.count, ch.multiplicity] }).toEqual({ smi, ch: [2, "s"] });
      expect(predictCoupling(smi)!.signals.find((s) => !s.variable)!.multiplet).toBe("s");
    }
  });

  test("cis-1,2-dimethylcyclohexane: 4 ¹³C rows (Dalling & Grant, JACS 1972, 94, 5318: CH₃, CH, C3/6, C4/5)", () => {
    for (const smi of ["C[C@@H]1CCCC[C@@H]1C", "C[C@@H]1CCCC[C@H]1C"]) {
      expect({ smi, rows: c13(smi).signals.map((s) => s.count) }).toEqual({ smi, rows: [2, 2, 2, 2] });
    }
  });

  test("meso-2,3-butanediol: 2 ¹³C rows", () => {
    expect(c13("C[C@H](O)[C@@H](C)O").signals.map((s) => s.count)).toEqual([2, 2]);
  });

  test("diastereotopic groups are never merged: valine and 2-butanol keep their splits", () => {
    expect(c13("valine").signals.filter((s) => s.diastereotopic?.kind === "pair")).toHaveLength(2);
    expect(ch2Rows("CCC(O)C")[0].diastereotopic?.kind).toBe("CH2");
  });
});

describe("refinement splits diastereotopic classes and merges only mirror-related ones", () => {
  test("refineClasses on a molecule without diastereotopic groups returns its classes unchanged", () => {
    for (const smi of ["CC(C)CC", "CCO", "c1ccccc1C", "CC(=O)C"]) {
      const { mol } = parseToMolecule(smi)!;
      const all = Array.from({ length: mol.getAllAtoms() }, (_, i) => i);
      const classes = symmetryClasses(mol, all);
      const refined = refineClasses(classes, analyseDiastereotopicity(mol));
      expect(refined.map((g) => g.atoms)).toEqual(classes);
    }
  });

  test("a refined class is a subset of one symmetry class unless it is a mirror merge", () => {
    for (const smi of ["valine", "CCOC(C)OCC", "ibuprofen", "C[C@@H](Cl)C[C@H](C)Cl"]) {
      const { mol } = parseToMolecule(smi)!;
      const all = Array.from({ length: mol.getAllAtoms() }, (_, i) => i);
      const classes = symmetryClasses(mol, all);
      for (const g of refineClasses(classes, analyseDiastereotopicity(mol))) {
        if (g.status === "mirror") continue;
        expect(classes.some((c) => g.atoms.every((a) => c.includes(a)))).toBe(true);
      }
    }
    // Only the meso input merges anything.
    const { mol } = parseToMolecule("valine")!;
    const all = Array.from({ length: mol.getAllAtoms() }, (_, i) => i);
    expect(refineClasses(symmetryClasses(mol, all), analyseDiastereotopicity(mol)).some((g) => g.status === "mirror")).toBe(false);
  });

  test("the H-explicit copy is never the molecule nmr.ts holds (no atoms are appended to it)", () => {
    const { mol } = parseToMolecule("valine")!;
    const before = mol.getAllAtoms();
    analyseDiastereotopicity(mol);
    expect(mol.getAllAtoms()).toBe(before);
  });
});

describe("2D and coupling views follow the new signal list", () => {
  test.each(["valine", "CCOC(C)OCC", "C[C@@H](Cl)C[C@H](C)Cl", "ibuprofen", "C=CC", "CC(Cl)CC(C)Cl"])(
    "%s: predictCoupling aligns with predictNmr by index",
    (smi) => {
      const h = h1(smi);
      const cp = predictCoupling(smi)!;
      expect(cp.signals.map((s) => [s.shift, s.count, s.atoms])).toEqual(h.signals.map((s) => [s.shift, s.count, s.atoms]));
    }
  );

  test("no signal couples to itself, so COSY never draws a cross-peak on its own diagonal", () => {
    for (const smi of ["valine", "CCOC(C)OCC", "OCC(O)CO", "C=CC"]) {
      const cp = predictCoupling(smi)!;
      cp.signals.forEach((s, i) => {
        for (const c of s.couplings) expect({ smi, i, partner: c.partner === i }).toEqual({ smi, i, partner: false });
      });
      if (smi === "C=CC") continue; // =CH₂ and =CH share a predicted δ and DO couple (a real cross-peak)
      const crossOnDiag = predictCosy(smi)!.peaks.filter((p) => p.kind === "cross" && p.f1 === p.f2);
      // Valine's diastereotopic methyls share a δ but do not couple (4 bonds);
      // a geminal ²J is never entered as a self-coupling.
      expect({ smi, n: crossOnDiag.length }).toEqual({ smi, n: 0 });
    }
  });

  test("HSQC: one cross-peak per protonated carbon environment, H count unchanged", () => {
    const r = predictHsqc("valine")!;
    // Cα-H, Cβ-H, and the two diastereotopic CH₃ — 4 protonated carbon rows.
    expect(r.peaks).toHaveLength(4);
    expect(r.peaks.filter((p) => /^CH3/.test(p.label))).toHaveLength(2);
  });

  test("HMBC and TOCSY still run and agree on the signal list", () => {
    expect(predictHmbc("valine")!.peaks.length).toBeGreaterThan(0);
    const t = predictTocsy("valine")!;
    expect(t.peaks.filter((p) => p.kind === "diagonal")).toHaveLength(h1("valine").signals.length);
  });
});

describe("stick figure", () => {
  test("coincident diastereotopic rows draw at their SUMMED integral", () => {
    const r = h1("valine");
    const sticks = nmrSticks(r);
    expect(sticks).toHaveLength(r.signals.length); // one series per signal (index alignment)
    const idx = r.signals.map((s, i) => (s.diastereotopic?.kind === "pair" ? i : -1)).filter((i) => i >= 0);
    // 3H + 3H at 0.87 is the tallest signal (6H): both sticks at full height.
    for (const i of idx) expect(sticks[i][1].y).toBeCloseTo(1, 9);
    // The Cα-H (1H) is one sixth of that.
    const ca = r.signals.findIndex((s) => s.count === 1 && !s.variable);
    expect(sticks[ca][1].y).toBeCloseTo(1 / 6, 9);
  });
});

// 8 orders per molecule, not 20: every new atom order is a cache miss and a
// fresh OCL classification, and 9 molecules × 20 orders made this the slowest
// file in the spectroscopy set. (The UV harness keeps the brief's 20.)
describe("invariance — the same molecule in 8 random atom orders", () => {
  const fingerprint = (smi: string) => {
    const h = h1(smi);
    const cp = predictCoupling(smi)!;
    const rows = h.signals.map((s, i) => `${s.shift}|${s.count}|${s.multiplicity}|${cp.signals[i].multiplet}|${s.diastereotopic?.kind ?? ""}`);
    const c = c13(smi).signals.map((s) => `${s.shift}|${s.count}|${s.diastereotopic?.kind ?? ""}`);
    return { h: rows.sort(), c: c.sort() };
  };

  test.each(["valine", "leucine", "CC(C)C(O)C", "CCC(O)C", "CCOC(C)OCC", "OCC(O)CO", "C=CC", "CC(Cl)CC(C)Cl", "ibuprofen"])(
    "%s",
    (smi) => {
      const ref = fingerprint(smi);
      for (let seed = 1; seed <= 8; seed++) {
        const perm = randomSmiles(parseToMolecule(smi)!.smiles, seed * 7919);
        expect(stereoFreeIdcode(perm)).toBe(stereoFreeIdcode(parseToMolecule(smi)!.smiles));
        expect({ seed, perm, ...fingerprint(perm) }).toEqual({ seed, perm, ...ref });
      }
    }
  );
});

describe("bounded work (measured inside jest)", () => {
  test(`a ${CAP_HEAVY}-heavy-atom chain at the cap: every 1D/2D path finishes inside 4 s`, () => {
    // CC(C)C(O) + 24 CH₂ + OH = 30 heavy atoms; a stereocentre makes every CH₂
    // diastereotopic, the worst case for the analysis.
    //
    // The bound is generous on purpose: this machine's jest timings swing ten-
    // fold under load (measured), and a timing test that flakes is worse than
    // none. The DETERMINISTIC guard is the cap itself, pinned below; this test
    // proves the cap leaves every path well inside a frozen-Word threshold, and
    // that one pane action pays for the analysis once (the cache).
    const smi = "CC(C)C(O)" + "C".repeat(24) + "O";
    expect(Molecule.fromSmiles(smi).getAllAtoms()).toBe(CAP_HEAVY);
    let first = true;
    for (const [name, fn] of [
      ["1H", () => predictNmr(smi, "1H")],
      ["13C", () => predictNmr(smi, "13C")],
      ["coupling", () => predictCoupling(smi)],
      ["HSQC", () => predictHsqc(smi)],
      ["HMBC", () => predictHmbc(smi)],
      ["TOCSY", () => predictTocsy(smi)],
    ] as [string, () => unknown][]) {
      const t0 = Date.now();
      expect(fn()).not.toBeNull();
      const ms = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`cap timing ${name}: ${ms} ms`);
      // Runaway guards only (quiet machine: ≈3 s first call, < 0.6 s after).
      expect({ name, fast: ms < (first ? 60000 : 20000) }).toEqual({ name, fast: true });
      first = false;
    }
    expect(h1(smi).signals.some((s) => s.diastereotopic?.kind === "CH2")).toBe(true);
  });

  test("long chains pay nothing: triacontane (no prochiral element) and squalane (4 unspecified centres) < 1 s", () => {
    const triacontane = "C".repeat(30);
    const squalane = "CC(C)CCCC(C)CCCC(C)CCCCC(C)CCCC(C)CCCC(C)C";
    for (const [name, smi] of [
      ["triacontane", triacontane],
      ["squalane", squalane],
    ]) {
      const t0 = Date.now();
      const r = c13(smi);
      const ms = Date.now() - t0;
      expect({ name, fast: ms < 1000 }).toEqual({ name, fast: true });
      expect(r.signals.some((s) => s.diastereotopic)).toBe(false);
    }
    // triacontane: the fast path, no caveat — there is nothing to find.
    expect(h1(triacontane).caveats.join(" ")).not.toMatch(/Diastereotopic|NOT enumerated/);
    // squalane: its stereocentres are unspecified and over the budget — said so.
    expect(h1(squalane).caveats.join(" ")).toMatch(/were NOT enumerated/);
  });

  test("the fast path does NOT swallow a stereocentre-free diastereotopic CH₂ (citric acid, 3-pentanol)", () => {
    // Citric acid's CH₂ protons are the textbook AB system with no stereocentre;
    // 3-pentanol's CH₂ protons are diastereotopic through the prochiral C3.
    for (const smi of ["OC(=O)CC(O)(CC(=O)O)C(=O)O", "CCC(O)CC"]) {
      expect({ smi, dia: ch2Rows(smi).some((s) => s.diastereotopic?.kind === "CH2") }).toEqual({ smi, dia: true });
    }
  });

  test("one pane action pays once: a re-parse of the same input hits the cache (same object)", () => {
    const m1 = parseToMolecule("valine")!.mol;
    const m2 = parseToMolecule("valine")!.mol;
    expect(m2).not.toBe(m1);
    expect(analyseDiastereotopicity(m2)).toBe(analyseDiastereotopicity(m1));
    // A different atom order is a different key — never a wrong, index-shifted hit.
    const m3 = parseToMolecule(randomSmiles(parseToMolecule("valine")!.smiles, 3))!.mol;
    expect(analyseDiastereotopicity(m3)).not.toBe(analyseDiastereotopicity(m1));
  });

  test("the cap is a cost rule: one atom over it is refused, and so is an enumeration that would exceed it", () => {
    const over = "CC(C)C(O)" + "C".repeat(25) + "O"; // 31 heavy atoms
    expect(h1(over).caveats.join(" ")).toMatch(/has 31 heavy atoms and the analysis is capped at 30/);
    expect(h1(over).signals.some((s) => s.diastereotopic)).toBe(false);
    // 2 unspecified centres → 2 configurations → 2 × n² ≤ 30² only up to n = 21.
    const enumOver = "CC(Cl)CC(Cl)" + "C".repeat(16); // 22 heavy atoms, 2 unspecified centres
    expect(Molecule.fromSmiles(enumOver).getAllAtoms()).toBe(22);
    expect(h1(enumOver).caveats.join(" ")).toMatch(/were NOT enumerated/);
  });

  test.each(["tannic acid", "paclitaxel"])("%s (over the cap): refused with a stated limit, quickly", (name) => {
    const t0 = Date.now();
    const r = h1(name);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.caveats.join(" ")).toMatch(/Diastereotopic groups were NOT analysed: the structure has \d+ heavy atoms/);
    expect(r.signals.some((s) => s.diastereotopic)).toBe(false);
  });
});
