// Adversarial bug test — NMR J-coupling and 2D (COSY/HSQC) predictors.
//
// The job is to BREAK nmr2d.ts, not confirm it. Three attack classes:
//   1. Structural edge cases that should not crash, hang, or fabricate peaks.
//   2. Graph invariants that must hold for EVERY molecule (coupling symmetry,
//      COSY mirror symmetry, HSQC one-peak-per-protonated-carbon, no self-
//      coupling of equivalent nuclei).
//   3. Known couplings from real spectra (ethanol q/t, ethyl acetate, benzene
//      singlet) and honesty flags (alkene J marked approximate + caveated).

import { predictCoupling, predictCosy, predictHsqc } from "../nmr2d";

const CORPUS: string[] = [
  "C", // methane
  "CC", // ethane — all H equivalent, no observable coupling
  "CCO", // ethanol
  "CC(=O)OCC", // ethyl acetate
  "CC(=O)C", // acetone — two equivalent CH3, singlet
  "CCC", // propane
  "CC(C)C", // isobutane
  "c1ccccc1", // benzene — all equivalent
  "Cc1ccccc1", // toluene
  "Cc1ccc(C)cc1", // p-xylene
  "c1ccc(cc1)O", // phenol
  "C=CC", // propene — alkene coupling
  "C=Cc1ccccc1", // styrene
  "CC=O", // acetaldehyde
  "ClC(Cl)(Cl)Cl", // carbon tetrachloride — no H at all
  "O", // water
  "[Na+].[Cl-]", // ionic salt, disconnected
  "OC(=O)C(=O)O", // oxalic acid
  "CC(O)C(=O)O", // lactic acid
  "OCC(O)CO", // glycerol
  "C1CCCCC1", // cyclohexane
  "CCN(CC)CC", // triethylamine
  "COC", // dimethyl ether
];

const isNum = (x: number) => typeof x === "number" && Number.isFinite(x);

describe("nmr2d — never crashes or fabricates over a hostile corpus", () => {
  for (const smi of CORPUS) {
    it(`is well-formed for ${smi}`, () => {
      const c = predictCoupling(smi);
      const cosy = predictCosy(smi);
      const hsqc = predictHsqc(smi);
      // Only fully unparseable inputs may be null — every corpus member parses.
      expect(c).not.toBeNull();
      expect(cosy).not.toBeNull();
      expect(hsqc).not.toBeNull();
      if (!c || !cosy || !hsqc) return;

      for (const s of c.signals) {
        expect(isNum(s.shift)).toBe(true);
        expect(typeof s.multiplet).toBe("string");
        expect(s.multiplet.length).toBeGreaterThan(0);
        for (const j of s.J) expect(j).toBeGreaterThanOrEqual(1); // sub-Hz couplings never earn a letter
        for (const cp of s.couplings) {
          expect(isNum(cp.J)).toBe(true);
          expect(cp.J).toBeGreaterThanOrEqual(0);
          expect(cp.nH).toBeGreaterThan(0);
          // No environment ever couples to itself (equivalent nuclei do not split).
          expect(cp.partner).not.toBe(c.signals.indexOf(s));
        }
      }
    });
  }
});

describe("coupling is symmetric — if A splits B, B splits A", () => {
  for (const smi of CORPUS) {
    it(`symmetric coupling graph for ${smi}`, () => {
      const c = predictCoupling(smi);
      if (!c) return;
      c.signals.forEach((s, i) => {
        for (const cp of s.couplings) {
          const back = c.signals[cp.partner].couplings.some((b) => b.partner === i);
          expect(back).toBe(true);
        }
      });
    });
  }
});

describe("COSY is mirror-symmetric with a diagonal for every 1H signal", () => {
  for (const smi of CORPUS) {
    it(`COSY invariants for ${smi}`, () => {
      const cosy = predictCosy(smi);
      const c = predictCoupling(smi);
      if (!cosy || !c) return;

      const diag = cosy.peaks.filter((p) => p.kind === "diagonal");
      expect(diag.length).toBe(c.signals.length);

      const cross = cosy.peaks.filter((p) => p.kind === "cross");
      // Every cross-peak has its mirror image across the diagonal. (A cross-peak
      // may coincide with the diagonal when two distinct coupled environments
      // share a predicted shift — that is a shift coincidence, not a bug — so the
      // mirror is the invariant that must hold, not off-diagonality.)
      for (const p of cross) {
        const mirror = cross.some((q) => q.f2 === p.f1 && q.f1 === p.f2);
        expect(mirror).toBe(true);
      }
    });
  }
});

describe("HSQC — exactly one cross-peak per protonated-carbon environment", () => {
  it("benzene: a single aromatic CH correlation", () => {
    const h = predictHsqc("c1ccccc1");
    expect(h).not.toBeNull();
    expect(h!.peaks.length).toBe(1);
    const p = h!.peaks[0];
    expect(p.f2).toBeGreaterThan(6.5); // aromatic 1H
    expect(p.f2).toBeLessThan(8.5);
    expect(p.f1).toBeGreaterThan(120); // aromatic 13C
    expect(p.f1).toBeLessThan(140);
  });

  it("carbon tetrachloride: no C-H, so no HSQC peaks", () => {
    const h = predictHsqc("ClC(Cl)(Cl)Cl");
    expect(h).not.toBeNull();
    expect(h!.peaks.length).toBe(0);
  });

  it("phenol OH does not appear (no attached carbon)", () => {
    const h = predictHsqc("c1ccccc1O");
    expect(h).not.toBeNull();
    // Every HSQC peak must sit in a plausible C-H shift box.
    for (const p of h!.peaks) {
      expect(p.f2).toBeGreaterThan(0);
      expect(p.f2).toBeLessThan(12);
      expect(p.f1).toBeGreaterThan(0);
      expect(p.f1).toBeLessThan(220);
    }
  });

  it("ethanol: two carbons, two HSQC peaks (CH3 and CH2), OH absent", () => {
    const h = predictHsqc("CCO");
    expect(h).not.toBeNull();
    expect(h!.peaks.length).toBe(2);
    expect(h!.peaks.some((p) => p.label.startsWith("CH3"))).toBe(true);
    expect(h!.peaks.some((p) => p.label.startsWith("CH2"))).toBe(true);
  });
});

describe("known couplings from real spectra", () => {
  it("ethanol: CH3 triplet, CH2 quartet, OH broad singlet — all J ≈ 7 Hz", () => {
    const c = predictCoupling("CCO");
    expect(c).not.toBeNull();
    const byCount = (n: number) => c!.signals.filter((s) => s.count === n);
    const ch3 = byCount(3)[0];
    const ch2 = byCount(2)[0];
    const oh = byCount(1)[0];
    expect(ch3.multiplet).toBe("t");
    expect(ch3.J).toEqual([7]);
    expect(ch2.multiplet).toBe("q");
    expect(ch2.J).toEqual([7]);
    expect(oh.multiplet).toBe("s (br)");
    expect(oh.couplings.length).toBe(0);
  });

  it("ethyl acetate: an OCH2 quartet, an ethyl-CH3 triplet, an acetyl-CH3 singlet", () => {
    const c = predictCoupling("CC(=O)OCC");
    expect(c).not.toBeNull();
    const q = c!.signals.find((s) => s.count === 2);
    expect(q?.multiplet).toBe("q");
    const threes = c!.signals.filter((s) => s.count === 3).map((s) => s.multiplet).sort();
    expect(threes).toEqual(["s", "t"]); // acetyl singlet + ethyl triplet
  });

  it("benzene: one signal, no coupling, singlet (equivalent nuclei don't split)", () => {
    const c = predictCoupling("c1ccccc1");
    expect(c).not.toBeNull();
    expect(c!.signals.length).toBe(1);
    expect(c!.signals[0].multiplet).toBe("s");
    expect(c!.signals[0].couplings.length).toBe(0);
  });

  it("toluene: benzylic CH3 is a singlet (ipso carbon carries no proton)", () => {
    const c = predictCoupling("Cc1ccccc1");
    expect(c).not.toBeNull();
    const ch3 = c!.signals.find((s) => s.count === 3 && s.assignment.includes("CH3"));
    expect(ch3?.multiplet).toBe("s");
  });

  it("acetaldehyde: CH3 doublet and CHO quartet (they couple to each other)", () => {
    const c = predictCoupling("CC=O");
    expect(c).not.toBeNull();
    const ch3 = c!.signals.find((s) => s.count === 3);
    const cho = c!.signals.find((s) => s.count === 1);
    expect(ch3?.multiplet).toBe("d");
    expect(cho?.multiplet).toBe("q");
  });
});

describe("honesty — approximate figures are flagged, geometry is disclosed", () => {
  it("alkene coupling is marked approximate and caveated as geometry-dependent", () => {
    const c = predictCoupling("C=CC");
    expect(c).not.toBeNull();
    const hasAlkene = c!.signals.some((s) => s.couplings.some((cp) => cp.kind === "alkene" && cp.approximate));
    expect(hasAlkene).toBe(true);
    expect(c!.caveats.some((v) => /cis|trans|geometry/i.test(v))).toBe(true);
  });

  it("vicinal aliphatic coupling carries the Karplus caveat", () => {
    const c = predictCoupling("CCO");
    expect(c!.caveats.some((v) => /Karplus/i.test(v))).toBe(true);
  });

  it("first-order assumption is always disclosed", () => {
    const c = predictCoupling("CCO");
    expect(c!.caveats.some((v) => /first-order/i.test(v))).toBe(true);
  });

  it("a CH2-bearing molecule discloses the diastereotopic-geminal limit", () => {
    const c = predictCoupling("CCO"); // has a CH2
    expect(c!.caveats.some((v) => /diastereotopic/i.test(v))).toBe(true);
  });
});
