// UV-Vis v2.138.0 — every Woodward-Fieser arm is scored, λmax is the maximum,
// and the answer is a property of the MOLECULE, not of how its SMILES is
// written. Quinones and aryl-conjugated enones are refused by name.
//
// Oracles: Woodward-Fieser arithmetic from the textbook tables (base 215 for a
// six-ring / acyclic enone, α-alkyl +10, β-alkyl/ring residue +12; 5-ring base
// 202), docs/SCOPE-SPECTROSCOPY-BATCH.md §D5, and INVARIANCE under random atom
// permutations generated here from OpenChemLib's own graph.

import { Molecule } from "openchemlib";
import { predictUvVis, UvResult } from "../uvvis";
import { randomSmiles, stereoFreeIdcode } from "./randomSmiles";

/** The fields that must not depend on atom order. */
function shape(r: UvResult) {
  return {
    lambda: r.lambdaMax,
    out: r.outOfDomain,
    chromophore: r.chromophore,
    contributions: r.contributions,
    arms: (r.arms ?? []).map((a) => a.ledger),
    caveats: r.caveats,
  };
}

// The §D5 rows, as SMILES (stereo kept where the brief gives it).
const PREDNISONE = "CC12CC(=O)C3C(CCC4=CC(=O)C=CC34C)C1CCC2(O)C(=O)CO";
const ANDROSTADIENEDIONE = "O=C1C=CC2(C)C(=C1)CCC1C2CCC2(C)C1CCC2=O";
const TESTOSTERONE = "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O";
const ROWS: [string, string][] = [
  ["two separate enones, written enone-first", "CC(=O)/C=C/CCCC1=CC(=O)CCC1"],
  ["two separate enones, written ring-first", "O=C1CCCC(CCC/C=C/C(C)=O)=C1"],
  ["prednisone", PREDNISONE],
  ["androsta-1,4-diene-3,17-dione", ANDROSTADIENEDIONE],
  ["mesityl oxide", "CC(=O)C=C(C)C"],
  ["isophorone", "CC1=CC(=O)CC(C)(C)C1"],
  ["cyclohexenone", "O=C1CCCC=C1"],
  ["3-methylcyclopent-2-enone", "CC1=CC(=O)CC1"],
  ["p-benzoquinone", "O=C1C=CC(=O)C=C1"],
  ["2-methyl-p-benzoquinone", "CC1=CC(=O)C=CC1=O"],
  ["duroquinone", "CC1=C(C)C(=O)C(C)=C(C)C1=O"],
  ["benzalacetone", "CC(=O)/C=C/c1ccccc1"],
  ["chalcone", "O=C(/C=C/c1ccccc1)c1ccccc1"],
  ["dibenzylideneacetone", "O=C(/C=C/c1ccccc1)/C=C/c1ccccc1"],
  ["testosterone", TESTOSTERONE],
];

describe("§D5 — every enone arm is scored; λmax is the maximum", () => {
  test("two separate enones: 239 for BOTH atom orders, with both arms listed (was 227 / 239)", () => {
    for (const smi of ["CC(=O)/C=C/CCCC1=CC(=O)CCC1", "O=C1CCCC(CCC/C=C/C(C)=O)=C1"]) {
      const r = predictUvVis(smi)!;
      // 215 + β-alkyl/ring residue ×2 (24) = 239 for the ring enone;
      // 215 + β-alkyl ×1 (12) = 227 for the acyclic one.
      expect({ smi, lambda: r.lambdaMax, arms: r.arms!.map((a) => a.lambdaMax) }).toEqual({
        smi,
        lambda: 239,
        arms: [239, 227],
      });
      expect(r.caveats.join(" ")).toMatch(/2 enone arms were each scored \(239, 227 nm\)/);
    }
  });

  test("cross-conjugated dienones: prednisone AND androstadienedione at 239, dienone flag on (was 239 / 227)", () => {
    for (const [name, smi] of [
      ["prednisone", PREDNISONE],
      ["prednisone (dictionary)", "prednisone"],
      ["androstadienedione", ANDROSTADIENEDIONE],
    ]) {
      const r = predictUvVis(smi)!;
      expect({ name, lambda: r.lambdaMax, out: r.outOfDomain }).toEqual({ name, lambda: 239, out: false });
      expect(r.caveats.join(" ")).toMatch(/cross-conjugated dienone/i);
      // The winning ladder IS 215 + 2×12: the more substituted arm.
      expect(r.contributions.map((c) => c.nm)).toEqual([215, 24]);
      expect(r.arms!.map((a) => a.lambdaMax)).toEqual([239, 227]);
    }
  });

  test("in-domain values are unchanged: mesityl oxide 239, isophorone 239, cyclohexenone 227, 3-methylcyclopentenone 226", () => {
    for (const [smi, want] of [
      ["CC(=O)C=C(C)C", 239],
      ["CC1=CC(=O)CC(C)(C)C1", 239],
      ["O=C1CCCC=C1", 227],
      ["CC1=CC(=O)CC1", 226],
    ] as [string, number][]) {
      const r = predictUvVis(smi)!;
      expect({ smi, lambda: r.lambdaMax }).toEqual({ smi, lambda: want });
    }
  });

  test("a single-arm enone lists exactly one arm and no multi-arm caveat", () => {
    const r = predictUvVis("CC(=O)C=C(C)C")!;
    expect(r.arms).toHaveLength(1);
    expect(r.caveats.join(" ")).not.toMatch(/arms were each scored/);
  });
});

describe("extended enones — the full Woodward-Fieser enone table (Pavia/Lampman/Kriz; Silverstein)", () => {
  // Base 215 (6-ring/acyclic ketone), 210 (aldehyde); +30 per extending C=C;
  // +39 homoannular diene component; alkyl/ring residue α 10, β 12, γ+ 18.
  // The chain carbons are PART of the chromophore and never counted as alkyl.
  test("hexa-2,4-dienal 258 = 210 + 30 + δ-CH₃ 18 (was 252)", () => {
    expect(predictUvVis("C/C=C/C=C/C=O")!.lambdaMax).toBe(258);
  });
  test("6,6-dimethylcyclohexa-2,4-dienone 302 = 215 + 30 + 39 + δ ring residue 18 (was 257)", () => {
    const r = predictUvVis("CC1(C)C=CC=CC1=O")!;
    expect(r.lambdaMax).toBe(302);
    expect(r.contributions.map((c) => c.nm)).toEqual([215, 30, 39, 18]);
  });
  test("cholesta-4,6-dien-3-one 275 = 215 + 30 + β 12 + δ 18 (exocyclic +5 held off, D-1; was 269)", () => {
    const r = predictUvVis("C[C@]12CC[C@H]3[C@@H](C=CC4=CC(=O)CC[C@@]43C)[C@@H]1CC[C@@H]2[C@H](C)CCCC(C)C")!;
    expect(r.lambdaMax).toBe(275);
    expect(r.caveats.join(" ")).toMatch(/exocyclic/);
  });
  test("an extended arm never carries the ±5 nm claim; a simple one still does", () => {
    for (const smi of ["C/C=C/C=C/C=O", "CC1(C)C=CC=CC1=O"]) {
      const text = predictUvVis(smi)!.caveats.join(" ");
      expect(text).not.toMatch(/typically ±5 nm within their domain/);
      expect(text).toMatch(/EXTENDED/);
    }
    expect(predictUvVis("CC(=O)C=C(C)C")!.caveats.join(" ")).toMatch(/typically ±5 nm within their domain/);
  });
  test("a C=C conjugated through α is refused by name, not scored", () => {
    const r = predictUvVis("C=CC(=C)C(C)=O")!;
    expect({ lambda: r.lambdaMax, out: r.outOfDomain }).toEqual({ lambda: null, out: true });
    expect(r.caveats.join(" ")).toMatch(/Cross-conjugated extended enone/);
  });
  test("extended values are atom-order invariant", () => {
    for (const smi of ["C/C=C/C=C/C=O", "CC1(C)C=CC=CC1=O"]) {
      const ref = predictUvVis(smi)!.lambdaMax;
      for (let seed = 1; seed <= 20; seed++) expect(predictUvVis(randomSmiles(smi, seed * 31))!.lambdaMax).toBe(ref);
    }
  });
});

describe("§D5 — refusals by name", () => {
  test("quinones are refused: not a Woodward-Fieser enone (was 227 / 239 / 249)", () => {
    for (const smi of ["O=C1C=CC(=O)C=C1", "CC1=CC(=O)C=CC1=O", "CC1=C(C)C(=O)C(C)=C(C)C1=O"]) {
      const r = predictUvVis(smi)!;
      expect({ smi, lambda: r.lambdaMax, out: r.outOfDomain }).toEqual({ smi, lambda: null, out: true });
      expect(r.chromophore).toMatch(/quinone/i);
      expect(r.caveats.join(" ")).toMatch(/not a Woodward-Fieser enone/);
      expect(r.contributions).toHaveLength(0);
    }
  });

  test("non-quinone controls keep their values: one C=O, or a ring with sp³ carbons", () => {
    expect(predictUvVis("O=C1C=CCC=C1")!.lambdaMax).toBe(227); // cyclohexa-2,5-dienone, two arms of 227
    expect(predictUvVis("O=C1C=CC(=O)CC1")!.outOfDomain).toBe(false); // cyclohex-2-ene-1,4-dione
    expect(predictUvVis(PREDNISONE)!.chromophore).not.toMatch(/quinone/);
  });

  test("aryl-conjugated enones are refused: no value (was 227 ×3 and 222 for cinnamaldehyde, really ≈60-100 nm higher)", () => {
    for (const smi of [
      "CC(=O)/C=C/c1ccccc1", // benzalacetone
      "O=C(/C=C/c1ccccc1)c1ccccc1", // chalcone
      "O=C(/C=C/c1ccccc1)/C=C/c1ccccc1", // dibenzylideneacetone
      "cinnamaldehyde",
      "CC(=O)C(c1ccccc1)=CC", // α-aryl: the ring conjugates through α
    ]) {
      const r = predictUvVis(smi)!;
      expect({ smi, lambda: r.lambdaMax, out: r.outOfDomain }).toEqual({ smi, lambda: null, out: true });
      expect(r.caveats.join(" ")).toMatch(/Aryl-conjugated enone — Woodward-Fieser does not apply; no value is given/);
    }
  });

  test("a NON-conjugated phenyl does not refuse the enone (control)", () => {
    // 5-phenylpent-3-en-2-one: the ring hangs off an sp³ CH₂, not the π system.
    const r = predictUvVis("CC(=O)C=CCc1ccccc1")!;
    expect(r.outOfDomain).toBe(false);
    expect(r.lambdaMax).toBe(227); // 215 + β-alkyl 12
    expect(r.caveats.join(" ")).toMatch(/not conjugated to the enone/);
    expect(r.caveats.join(" ")).not.toMatch(/Scott's rules rather than/);
  });

  test("a refusal carries no caveat written for a value it did not produce", () => {
    for (const smi of ["O=C1C=CC(=O)C=C1", "O=C(/C=C/c1ccccc1)/C=C/c1ccccc1"]) {
      const text = predictUvVis(smi)!.caveats.join(" ");
      expect(text).not.toMatch(/arms were each scored|±5 nm within their domain|cross-conjugated dienone|exocyclic/i);
    }
  });
});

describe("§D5 / D-1 — the exocyclic caveat is true, and the increment is NOT applied", () => {
  test("testosterone stays 239 and now carries the exocyclic caveat", () => {
    for (const smi of [TESTOSTERONE, "testosterone"]) {
      const r = predictUvVis(smi)!;
      expect(r.lambdaMax).toBe(239);
      const text = r.caveats.join(" ");
      expect(text).toMatch(/exocyclic C=C/);
      expect(text).toMatch(/NOT applied/);
      expect(text).not.toMatch(/3D ring context/);
    }
  });

  test("mesityl oxide and cyclohexenone have no exocyclic C=C and no such caveat", () => {
    for (const smi of ["CC(=O)C=C(C)C", "O=C1CCCC=C1"]) {
      expect(predictUvVis(smi)!.caveats.join(" ")).not.toMatch(/exocyclic/i);
    }
  });

  test("the diene branch no longer claims the increment needs 3D context", () => {
    // 3-methylenecyclohexene: the =CH₂ is exocyclic to the ring.
    const exo = predictUvVis("C=C1CCCC=C1")!;
    expect(exo.caveats.join(" ")).toMatch(/exocyclic C=C/);
    expect(exo.caveats.join(" ")).not.toMatch(/3D ring context/);
    // Butadiene has none, and says nothing about it.
    const bd = predictUvVis("C=CC=C")!;
    expect(bd.lambdaMax).toBe(214);
    expect(bd.caveats.join(" ")).not.toMatch(/exocyclic|3D ring context/i);
  });
});

describe("invariance — 20 random atom orders per molecule give the same answer", () => {
  test("the permutation harness itself: distinct strings, same molecule", () => {
    const smis = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = randomSmiles(ANDROSTADIENEDIONE, seed);
      expect(stereoFreeIdcode(s)).toBe(stereoFreeIdcode(ANDROSTADIENEDIONE));
      smis.add(s);
    }
    expect(smis.size).toBeGreaterThan(10);
  });

  test("the harness DETECTS order dependence (a deliberately order-dependent reading differs)", () => {
    // Self-test on a known-bad predicate: "the first enone carbonyl's atom
    // index" is order-dependent by construction, so the harness must see more
    // than one value for it. A harness that cannot fail proves nothing.
    const firstCarbonyl = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const m = Molecule.fromSmiles(randomSmiles(ANDROSTADIENEDIONE, seed));
      for (let a = 0; a < m.getAllAtoms(); a++) {
        if (m.getAtomicNo(a) === 8) {
          firstCarbonyl.add(a);
          break;
        }
      }
    }
    expect(firstCarbonyl.size).toBeGreaterThan(1);
  });

  test.each(ROWS)("%s: every permutation matches the canonical answer", (_name, smi) => {
    const ref = shape(predictUvVis(smi)!);
    for (let seed = 1; seed <= 20; seed++) {
      const perm = randomSmiles(smi, seed * 7919);
      const r = predictUvVis(perm);
      expect({ seed, perm, ok: r !== null }).toEqual({ seed, perm, ok: true });
      expect({ seed, perm, ...shape(r!) }).toEqual({ seed, perm, ...ref });
    }
  });

  test("cross-conjugated and separate-diene systems are order-invariant too", () => {
    for (const smi of [
      "O=C1C=CCC=C1", // two equal arms on one carbonyl
      "CC(=O)C(C)=CC(=O)C", // an enedione: two carbonyls on one C=C
      "C=CC=CCCCCC(C)=CC(C)=C", // two separate dienes, different sums
      "C=C(C)C(=O)C=C", // divinyl ketone: arms 225 and 215
    ]) {
      const ref = shape(predictUvVis(smi)!);
      for (let seed = 1; seed <= 20; seed++) {
        const perm = randomSmiles(smi, seed * 104729);
        expect({ seed, perm, ...shape(predictUvVis(perm)!) }).toEqual({ seed, perm, ...ref });
      }
    }
  });

  test("two separate dienes: λmax is the larger system's, whichever is written first", () => {
    // butadienyl (214) vs 2,4-dimethyl-1,3-diene (214 + 3 alkyl = 229 incl. the
    // chain residue) — the answer is the max, listed with both systems.
    const a = predictUvVis("C=CC=CCCCCC(C)=CC(C)=C")!;
    const b = predictUvVis("C=C(C)C=C(C)CCCCC=CC=C")!;
    expect(a.lambdaMax).toBe(b.lambdaMax);
    expect(a.arms!.length).toBe(2);
    expect(a.lambdaMax).toBe(Math.max(...a.arms!.map((x) => x.lambdaMax)));
  });
});

describe("bounds — no input runs away", () => {
  test("every row predicts within 4 s, permutations included", () => {
    const t0 = Date.now();
    for (const [, smi] of ROWS) predictUvVis(randomSmiles(smi, 99));
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
