// Inhibition models — and the Cheng-Prusoff misuse they exist to prevent.
//
// WHY THIS EXISTS (punch list #15)
// assay.ts had exactly one Ki path: chengPrusoff(). Cheng-Prusoff is the
// COMPETITIVE relationship, Ki = IC50/(1 + [S]/Km), and the function applied it
// unconditionally under a docstring promising "the true inhibition constant Ki".
//
// On a NON-COMPETITIVE inhibitor, Ki = IC50 exactly — [S] does not enter. Measured:
//
//   [S]/Km      chengPrusoff      true Ki      error
//     1              50.0           100        2x too low
//    10               9.09          100       11x too low
//   100               0.99          100      101x too low
//
// A Ki eleven times too low makes a compound look eleven times more potent than it
// is. In a screening cascade that is a decision-changing error, and nothing about
// the number looks wrong.

import {
  chengPrusoff, kiFromIc50, competitiveV, uncompetitiveV, noncompetitiveV, mixedV,
  substrateInhibitionV, fitInhibition, michaelisMenten, fitMichaelisMenten,
} from "../assay";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("the Ki conversion depends on the MODE, and getting it wrong is not subtle", () => {
  test("competitive matches Cheng-Prusoff exactly", () => {
    expect(kiFromIc50(100, 50, 10, "competitive")).toBeCloseTo(chengPrusoff(100, 50, 10), 9);
  });

  test("non-competitive Ki IS the IC50 — [S] does not enter", () => {
    for (const s of [1, 10, 100, 1000]) expect(kiFromIc50(100, s, 10, "noncompetitive")).toBe(100);
  });

  test("using Cheng-Prusoff on a non-competitive inhibitor is 11x wrong at [S]=10Km", () => {
    // The measured harm, pinned so the docstring's warning stays true.
    const cp = chengPrusoff(100, 100, 10); // [S] = 100, Km = 10
    const real = kiFromIc50(100, 100, 10, "noncompetitive");
    expect(real / cp).toBeCloseTo(11, 0);
  });

  test("uncompetitive is the mirror image of competitive", () => {
    // competitive divides by (1 + S/Km); uncompetitive by (1 + Km/S).
    expect(kiFromIc50(100, 10, 10, "uncompetitive")).toBeCloseTo(50, 6); // S = Km -> both halve
    expect(kiFromIc50(100, 100, 10, "uncompetitive")).toBeCloseTo(100 / 1.1, 6);
    // At high [S] the two modes diverge in OPPOSITE directions.
    expect(kiFromIc50(100, 1000, 10, "uncompetitive")).toBeGreaterThan(
      kiFromIc50(100, 1000, 10, "competitive")
    );
  });

  test("mixed REFUSES rather than returning a plausible wrong number", () => {
    // Two constants, one IC50 — not identifiable. Returning something would be
    // exactly the confident guess this module exists to avoid.
    expect(kiFromIc50(100, 10, 10, "mixed")).toBeNaN();
  });

  test("nonsense input returns NaN, not a number", () => {
    expect(kiFromIc50(0, 10, 10, "competitive")).toBeNaN();
    expect(kiFromIc50(100, 10, 0, "competitive")).toBeNaN();
    expect(kiFromIc50(100, 0, 10, "uncompetitive")).toBeNaN();
  });
});

describe("each model does to Km and Vmax what its biology says", () => {
  // This is the diagnostic a biochemist uses to TELL the modes apart, so the
  // implementations must actually differ in these ways.
  const VMAX = 100, KM = 10, KI = 5;
  const hiS = 1e7; // effectively saturating

  test("competitive raises apparent Km but leaves Vmax reachable", () => {
    // At saturating [S] a competitive inhibitor is out-competed entirely.
    expect(competitiveV(VMAX, KM, KI, hiS, 10)).toBeCloseTo(VMAX, 2);
    // ...but at [S] = Km it bites.
    expect(competitiveV(VMAX, KM, KI, KM, 10)).toBeLessThan(michaelisMenten(VMAX, KM, KM));
  });

  test("uncompetitive CANNOT be out-competed — Vmax falls", () => {
    // The defining contrast with competitive: more substrate makes it worse, not
    // better, because the inhibitor binds ES.
    expect(uncompetitiveV(VMAX, KM, KI, hiS, 10)).toBeLessThan(VMAX * 0.5);
  });

  test("non-competitive lowers Vmax by a factor of (1 + I/Ki), Km untouched", () => {
    const factor = 1 + 10 / KI; // 3
    expect(noncompetitiveV(VMAX, KM, KI, hiS, 10)).toBeCloseTo(VMAX / factor, 2);
    // Km is unchanged: half-maximal velocity still occurs at [S] = Km.
    const vmaxApp = noncompetitiveV(VMAX, KM, KI, hiS, 10);
    expect(noncompetitiveV(VMAX, KM, KI, KM, 10)).toBeCloseTo(vmaxApp / 2, 2);
  });

  test("with no inhibitor every model collapses to Michaelis-Menten", () => {
    // A model that does not reduce correctly at [I]=0 is broken.
    for (const s of [1, 5, 10, 50, 200]) {
      const mm = michaelisMenten(VMAX, KM, s);
      expect(competitiveV(VMAX, KM, KI, s, 0)).toBeCloseTo(mm, 9);
      expect(uncompetitiveV(VMAX, KM, KI, s, 0)).toBeCloseTo(mm, 9);
      expect(noncompetitiveV(VMAX, KM, KI, s, 0)).toBeCloseTo(mm, 9);
      expect(mixedV(VMAX, KM, KI, KI, s, 0)).toBeCloseTo(mm, 9);
    }
  });

  test("mixed with Ki = Ki' IS pure non-competitive", () => {
    // Algebraic identity — a good check that mixedV places its terms correctly.
    for (const s of [1, 10, 100]) {
      expect(mixedV(VMAX, KM, KI, KI, s, 10)).toBeCloseTo(noncompetitiveV(VMAX, KM, KI, s, 10), 9);
    }
  });

  test("more inhibitor always means less velocity, in every mode", () => {
    for (const f of [competitiveV, uncompetitiveV, noncompetitiveV]) {
      let prev = Infinity;
      for (const i of [0, 1, 5, 10, 50]) {
        const v = f(VMAX, KM, KI, 20, i);
        expect(v).toBeLessThan(prev);
        prev = v;
      }
    }
  });
});

describe("substrate inhibition — the curve that Michaelis-Menten cannot represent", () => {
  test("velocity rises then FALLS", () => {
    const v = (s: number) => substrateInhibitionV(100, 10, 50, s);
    expect(v(10)).toBeGreaterThan(v(1)); // ascending limb
    expect(v(1000)).toBeLessThan(v(50)); // descending limb
  });

  test("with Ksi huge it collapses to Michaelis-Menten", () => {
    for (const s of [1, 10, 100]) {
      expect(substrateInhibitionV(100, 10, 1e12, s)).toBeCloseTo(michaelisMenten(100, 10, s), 6);
    }
  });

  test("fitting substrate-inhibited data with plain MM fails SILENTLY", () => {
    // The reason this model matters. MM has no descending limb, so it cannot
    // represent the data — but it does not complain. It converges, reports a
    // depressed Vmax, and looks fine.
    const S = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const v = S.map((s) => substrateInhibitionV(100, 10, 50, s));
    const bad = fitMichaelisMenten(S, v);
    expect(bad.converged).toBe(true); // no complaint...
    expect(bad.vmax).toBeLessThan(70); // ...but Vmax is far below the true 100
  });
});

describe("fitInhibition recovers the constants it was given", () => {
  const VMAX = 100, KM = 10, KI = 5;
  /** A realistic grid: several [S] at several [I], which is what identifies Ki. */
  const grid = (f: (s: number, i: number) => number, noise = 0) => {
    const r = rng(7);
    const S: number[] = [], I: number[] = [], V: number[] = [];
    for (const i of [0, 2, 5, 10]) {
      for (const s of [1, 2, 5, 10, 20, 50, 100]) {
        S.push(s); I.push(i);
        V.push(f(s, i) * (1 + noise * (r() * 2 - 1)));
      }
    }
    return { S, I, V };
  };

  test.each(["competitive", "uncompetitive", "noncompetitive"] as const)(
    "%s: clean data recovers Vmax, Km and Ki",
    (mode) => {
      const f =
        mode === "competitive" ? (s: number, i: number) => competitiveV(VMAX, KM, KI, s, i)
        : mode === "uncompetitive" ? (s: number, i: number) => uncompetitiveV(VMAX, KM, KI, s, i)
        : (s: number, i: number) => noncompetitiveV(VMAX, KM, KI, s, i);
      const { S, I, V } = grid(f);
      const fit = fitInhibition(S, I, V, mode)!;
      expect(fit).not.toBeNull();
      expect(fit.vmax).toBeCloseTo(VMAX, 0);
      expect(fit.km).toBeCloseTo(KM, 0);
      expect(fit.ki).toBeCloseTo(KI, 0);
    }
  );

  test("with 5% noise the constants are still recovered within 20%", () => {
    const { S, I, V } = grid((s, i) => competitiveV(VMAX, KM, KI, s, i), 0.05);
    const fit = fitInhibition(S, I, V, "competitive")!;
    expect(Math.abs(fit.ki - KI) / KI).toBeLessThan(0.2);
    expect(Math.abs(fit.vmax - VMAX) / VMAX).toBeLessThan(0.2);
  });

  test("too few points returns null rather than fitting noise", () => {
    expect(fitInhibition([1, 2], [0, 1], [10, 5], "competitive")).toBeNull();
  });

  test("every fit says the MODE was the user's choice, not the data's", () => {
    const { S, I, V } = grid((s, i) => competitiveV(VMAX, KM, KI, s, i));
    const fit = fitInhibition(S, I, V, "competitive")!;
    expect(fit.caveats.join(" ")).toMatch(/YOU chose that, the data did not/);
    expect(fit.caveats.join(" ")).toMatch(/Compare the modes/);
  });

  test("mixed warns that its two constants may not be identifiable", () => {
    const { S, I, V } = grid((s, i) => mixedV(VMAX, KM, KI, 20, s, i));
    const fit = fitInhibition(S, I, V, "mixed")!;
    expect(fit.caveats[0]).toMatch(/TWO constants/);
    expect(fit.caveats[0]).toMatch(/not identifiable/);
  });

  test("a wrong mode still CONVERGES with a plausible Ki — which is why the caveat exists", () => {
    // Generate competitive data, fit it as non-competitive. The fitter does not
    // object; it returns numbers. Only comparing modes reveals the truth.
    const { S, I, V } = grid((s, i) => competitiveV(VMAX, KM, KI, s, i));
    const wrong = fitInhibition(S, I, V, "noncompetitive")!;
    const right = fitInhibition(S, I, V, "competitive")!;
    expect(wrong.converged).toBe(true);
    expect(wrong.ki).toBeGreaterThan(0); // a perfectly plausible-looking Ki
    // The right model fits materially better — that IS the diagnostic.
    expect(right.rmse).toBeLessThan(wrong.rmse);
  });
});
