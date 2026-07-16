// The pKa group classes added in v1.73.0 — and the wrong answers they replaced.
//
// WHY THIS EXISTS (punch list #13)
// The audit listed these as MISSING classes. They were worse than missing: four of
// the five were actively MISCLASSIFIED, which is the arginine bug's shape — a group
// the classifier does not know, routed to a branch with a plausible label and a
// confidently wrong number. Measured before the fix:
//
//   benzenesulfonamide   -> "Aliphatic amine" pKa 10.6, net +1.00  (truth: acidic ~10, net ~0)
//   5-phenyltetrazole    -> 3x "Aromatic N (pyridine)" 5.2, net +0.02  (truth: acidic 4.9, net -1)
//   barbituric acid      -> no sites, net 0.00  (truth: acidic 4.0, net -1)
//   methylphosphonic acid-> 2x pKa 2.0, net -2.00  (truth: 2.4 and 8.0, net ~-1.2)
//   benzohydroxamic acid -> no sites  (truth: acidic ~9)
//
// The sulfonamide case is the most serious: a sulfonyl group makes its nitrogen
// ACIDIC, and calling it a base put the net charge a full unit out IN THE WRONG
// DIRECTION on a group present in a large share of marketed drugs.
//
// Net charge at pH 7.4 is the number these tests assert, because that is what the
// pane shows and what a medicinal chemist actually reads.

import { predictPka } from "../pka";

const net = (smiles: string): number => {
  const r = predictPka(smiles);
  if (!r) throw new Error(`no result for ${smiles}`);
  return r.netChargeAt74;
};
const groups = (smiles: string): string => (predictPka(smiles)?.sites ?? []).map((s) => s.group).join(" | ");

describe("sulfonamide: acidic, not a base", () => {
  test("benzenesulfonamide is ~neutral at pH 7.4, not +1", () => {
    // The old answer was +1.00 — a full charge unit, wrong sign.
    expect(net("NS(=O)(=O)c1ccccc1")).toBeCloseTo(0, 1);
    expect(groups("NS(=O)(=O)c1ccccc1")).toContain("Sulfonamide N-H");
    expect(groups("NS(=O)(=O)c1ccccc1")).not.toContain("Aliphatic amine");
  });

  test("a sulfonamide N is never reported as a base", () => {
    const r = predictPka("NS(=O)(=O)c1ccccc1")!;
    for (const s of r.sites) if (/Sulfonamide/.test(s.group)) expect(s.kind).toBe("acid");
  });

  test("sulfamethoxazole-like: the sulfonamide is acidic, the aniline still basic", () => {
    const g = groups("Nc1ccc(S(=O)(=O)Nc2ccon2)cc1");
    expect(g).toContain("Sulfonamide N-H");
    expect(g).toContain("Aniline");
  });

  test("a real aliphatic amine is untouched — the fix did not gut amines", () => {
    expect(net("CCN")).toBeCloseTo(1, 1);
    expect(groups("CCN")).toContain("Aliphatic amine");
  });
});

describe("tetrazole: an acid, not three weak bases", () => {
  test("5-phenyltetrazole is ~fully deprotonated at pH 7.4", () => {
    // Old answer: +0.02. Truth: about -1. Tetrazole is THE carboxylic-acid
    // bioisostere — losartan, valsartan, candesartan.
    expect(net("c1ccc(-c2nnn[nH]2)cc1")).toBeCloseTo(-1, 1);
    expect(groups("c1ccc(-c2nnn[nH]2)cc1")).toContain("Tetrazole");
    expect(groups("c1ccc(-c2nnn[nH]2)cc1")).not.toContain("Aromatic N (pyridine-type)");
  });

  test("it behaves like the carboxylic acid it substitutes for", () => {
    // The point of the bioisostere: both are ~fully ionised at physiological pH.
    expect(net("c1ccc(-c2nnn[nH]2)cc1")).toBeCloseTo(net("OC(=O)c1ccccc1"), 1);
  });

  test("pyridine is still a weak base — imidazole and pyridine unaffected", () => {
    expect(groups("c1ccncc1")).toContain("Aromatic N (pyridine-type)");
    expect(groups("NC(Cc1c[nH]cn1)C(=O)O")).toContain("Imidazole");
  });
});

describe("barbiturates: C5-H vs the 5,5-disubstituted N-H", () => {
  test("barbituric acid ionises at C5 (pKa 4.0) — essentially fully at pH 7.4", () => {
    expect(net("O=C1CC(=O)NC(=O)N1")).toBeCloseTo(-1, 1);
    expect(groups("O=C1CC(=O)NC(=O)N1")).toContain("C5-H");
  });

  test("phenobarbital has no C5-H, so it ionises at N-H (pKa 7.6)", () => {
    // ~-0.39 at pH 7.4: partly ionised, which is why barbiturate pharmacokinetics
    // are pH-sensitive. Reporting 4.0 here would be a 3.6-unit error.
    const n = net("CCC1(c2ccccc2)C(=O)NC(=O)NC1=O");
    expect(n).toBeGreaterThan(-0.6);
    expect(n).toBeLessThan(-0.2);
    expect(groups("CCC1(c2ccccc2)C(=O)NC(=O)NC1=O")).toContain("5,5-disubstituted");
  });

  test("the pendant PHENYL does not defeat ring detection", () => {
    // The bug that hid phenobarbital: the ring walk accepted any size-6 ring atom,
    // so it leaked from C5 into the phenyl, collected 12 atoms, and the size check
    // rejected the molecule — no site at all. Walking only RING BONDS fixes it,
    // because the bond joining two rings is not itself a ring bond.
    expect(predictPka("CCC1(c2ccccc2)C(=O)NC(=O)NC1=O")!.sites.length).toBeGreaterThan(0);
  });

  test("an ordinary six-ring with a phenyl is not called a barbiturate", () => {
    expect(groups("c1ccc(C2CCCCC2)cc1")).not.toContain("Barbiturate");
    expect(groups("O=C1CCCCC1")).not.toContain("Barbiturate");
  });
});

describe("hydroxamic acid", () => {
  test("benzohydroxamic acid is detected at ~9", () => {
    expect(groups("ONC(=O)c1ccccc1")).toContain("Hydroxamic acid");
    expect(predictPka("ONC(=O)c1ccccc1")!.sites.find((s) => /Hydroxamic/.test(s.group))!.pka).toBeCloseTo(9, 1);
  });

  test("vorinostat (SAHA) — a marketed HDAC inhibitor — is detected", () => {
    expect(groups("ONC(=O)CCCCCCC(=O)Nc1ccccc1")).toContain("Hydroxamic acid");
  });

  test("a plain amide is NOT a hydroxamic acid", () => {
    expect(groups("CC(=O)Nc1ccccc1")).not.toContain("Hydroxamic acid");
  });
});

describe("phosphorus oxo-acids are polyprotic with DIFFERENT successive pKa values", () => {
  test("methylphosphonic acid: 2.4 and 8.0, not 2.0 twice", () => {
    // Old answer: two sites at 2.0 -> net -2.00, i.e. both protons fully gone at
    // pH 7.4. In reality the second is barely ionised there.
    const n = net("CP(=O)(O)O");
    expect(n).toBeGreaterThan(-1.5);
    expect(n).toBeLessThan(-1.0);
    const g = groups("CP(=O)(O)O");
    expect(g).toContain("Phosphonic acid (pKa1)");
    expect(g).toContain("Phosphonic acid (pKa2)");
  });

  test("the two steps are genuinely different values", () => {
    const s = predictPka("CP(=O)(O)O")!.sites.filter((x) => /Phosphonic/.test(x.group));
    expect(s).toHaveLength(2);
    expect(s[0].pka).not.toBe(s[1].pka);
    expect(s[1].pka - s[0].pka).toBeGreaterThan(4); // successive pKa values are far apart
  });

  test("a phosphate ESTER is distinguished from a phosphonate", () => {
    // P-C means phosphonate (pKa1 2.4); P-O-C means a phosphate monoester (~1.5).
    const ester = predictPka("COP(=O)(O)O")!.sites.filter((x) => /Phosphate/.test(x.group));
    expect(ester.length).toBe(2);
    expect(ester[0].pka).toBeLessThan(2);
  });

  test("no phosphorus -OH is double-counted as a plain alcohol", () => {
    const all = predictPka("CP(=O)(O)O")!.sites;
    expect(all.filter((s) => /Alcohol/.test(s.group))).toHaveLength(0);
    expect(all).toHaveLength(2);
  });
});

describe("nothing that already worked was broken", () => {
  test.each<[string, string, number]>([
    ["acetic acid", "CC(=O)O", -1],
    ["ethylamine", "CCN", 1],
    ["arginine", "NC(=N)NCCCC(N)C(=O)O", 1],
    ["phenol", "Oc1ccccc1", 0],
    ["aniline", "Nc1ccccc1", 0],
    ["benzene", "c1ccccc1", 0],
    ["thiophenol", "Sc1ccccc1", 0],
  ])("%s net charge stays %p", (_l, smiles, want) => {
    expect(net(smiles)).toBeCloseTo(want, 1);
  });

  test("arginine still reports ONE guanidinium, not three amines", () => {
    // The bug this whole line of work started from.
    const g = predictPka("NC(=N)NCCCC(N)C(=O)O")!;
    expect(g.sites.filter((s) => /Guanidine/.test(s.group))).toHaveLength(1);
    expect(g.netChargeAt74).toBeCloseTo(1, 1);
  });
});
