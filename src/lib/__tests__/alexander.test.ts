// Alexander polynomial and K-theory (alexander.ts).
//
// Literature oracles throughout. The most interesting assertion in the file is
// that the TWO TREFOILS SHARE an Alexander polynomial while having different
// Jones polynomials — the documented weakness, demonstrated rather than merely
// claimed, and the reason the tool offers both.
//
// The built-in self-check is symmetry: every Alexander polynomial satisfies
// Δ(t) = Δ(1/t) up to units. It costs nothing and would catch a sign or index
// error in the Burau matrix immediately.

import {
  alexanderPolynomial, kTheory, burauMatrix, normaliseLaurent, lDivide,
} from "../alexander";
import { KNOT_BRAIDS, lMono, lAdd, lOne, lZero, lFormat, jonesPolynomial } from "../knots";

const A = (name: string) => {
  const b = KNOT_BRAIDS[name];
  return alexanderPolynomial({ word: b.word, strands: b.strands })!;
};

describe("Alexander polynomials match published values", () => {
  it("unknot: Δ = 1", () => {
    expect(A("unknot").display).toBe("1");
  });
  it("trefoil: Δ = 1 − t + t² (normalised form of t − 1 + t⁻¹)", () => {
    expect(A("trefoil").display).toBe("1 - t + t^2");
  });
  it("figure-eight: Δ = 1 − 3t + t²", () => {
    expect(A("figure-8").display).toBe("1 - 3t + t^2");
  });
  it("cinquefoil 5₁: Δ = 1 − t + t² − t³ + t⁴", () => {
    expect(A("cinquefoil").display).toBe("1 - t + t^2 - t^3 + t^4");
  });
  it("the Hopf link", () => {
    expect(A("hopf-link").display).toBe("-1 + t");
  });
});

describe("the knot determinant |Δ(−1)| is right, and odd for a knot", () => {
  const CASES: [string, number][] = [
    ["unknot", 1], ["trefoil", 3], ["figure-8", 5], ["cinquefoil", 5],
  ];
  for (const [name, want] of CASES) {
    it(`${name} → ${want}`, () => expect(A(name).determinant).toBe(want));
  }
  it("a knot determinant is always ODD", () => {
    for (const name of ["unknot", "trefoil", "figure-8", "cinquefoil"]) {
      const r = A(name);
      expect(`${name}: ${r.determinant % 2}`).toBe(`${name}: 1`);
    }
  });
});

describe("the built-in symmetry check", () => {
  it("Δ(t) = Δ(1/t) for every built-in knot", () => {
    for (const name of Object.keys(KNOT_BRAIDS)) {
      const r = alexanderPolynomial({ word: KNOT_BRAIDS[name].word, strands: KNOT_BRAIDS[name].strands });
      expect(`${name}: ${r?.symmetric}`).toBe(`${name}: true`);
    }
  });
  it("the working reports the check having passed", () => {
    expect(A("trefoil").steps.join(" ")).toMatch(/Symmetry check/);
  });
});

describe("the documented weakness, demonstrated", () => {
  it("the two trefoils SHARE an Alexander polynomial", () => {
    expect(A("trefoil").display).toBe(A("trefoil-mirror").display);
  });
  it("but their JONES polynomials differ — which is why both are offered", () => {
    const j1 = jonesPolynomial({ word: KNOT_BRAIDS.trefoil.word, strands: 2 });
    const j2 = jonesPolynomial({ word: KNOT_BRAIDS["trefoil-mirror"].word, strands: 2 });
    expect(j1.jonesDisplay).not.toBe(j2.jonesDisplay);
  });
  it("every result states that it cannot see a mirror image", () => {
    expect(A("trefoil").caveats.join(" ")).toMatch(/MIRROR IMAGE/);
  });
  it("and that it fails to detect the unknot", () => {
    expect(A("trefoil").caveats.join(" ")).toMatch(/FAILS TO DETECT THE UNKNOT/);
    expect(A("trefoil").caveats.join(" ")).toMatch(/Kinoshita-Terasaka/);
  });
});

describe("Laurent helpers", () => {
  it("normalisation shifts to degree 0 with a positive leading coefficient", () => {
    // −t⁻¹ + 3 − t  →  1 − 3t + t² after normalising
    let p = lZero();
    p = lAdd(p, lMono(-1, -1));
    p = lAdd(p, lMono(0, 3));
    p = lAdd(p, lMono(1, -1));
    expect(lFormat(normaliseLaurent(p), "t")).toBe("1 - 3t + t^2");
  });
  it("exact division works and refuses when it does not divide", () => {
    // (t² − 1) / (t − 1) = t + 1
    const num = lAdd(lMono(2), lMono(0, -1));
    const den = lAdd(lMono(1), lMono(0, -1));
    expect(lFormat(lDivide(num, den)!, "t")).toBe("1 + t");
    // t / 2 does not divide over the integers.
    expect(lDivide(lMono(1), lMono(0, 2))).toBeNull();
  });
  it("the Burau matrix has the right shape", () => {
    const m = burauMatrix({ word: [1, 1, 1], strands: 2 });
    expect(m.length).toBe(1); // (strands − 1) square
    const m3 = burauMatrix({ word: [1, -2], strands: 3 });
    expect(m3.length).toBe(2);
    expect(m3[0].length).toBe(2);
  });
});

// DISPLAY CONTRACT (v2.139.0): every K-theory pin below used to expect the
// engine's ASCII ("Z + Z", "Z^2", "Z/2"). The product rule is that output is
// typeset — ℤ ⊕ ℤ, ℤ², ℤ/2 — and reads back (see the round-trip block at the
// end). The VALUES are unchanged; each pin was rewritten by hand to the
// typeset spelling of the same group.
describe("K-theory, where Bott periodicity settles it", () => {
  const K = (q: string) => kTheory(q)!;
  it("spheres are 2-periodic: even gives ℤ ⊕ ℤ, odd gives ℤ with K¹ = ℤ", () => {
    expect(K("S^2").k0).toBe("ℤ ⊕ ℤ");
    expect(K("S^2").k1).toBe("0");
    expect(K("S^4").k0).toBe("ℤ ⊕ ℤ");
    expect(K("S^3").k0).toBe("ℤ");
    expect(K("S^3").k1).toBe("ℤ");
    expect(K("S^1").k1).toBe("ℤ");
  });
  it("the reduced K⁰ is ℤ for even spheres and 0 for odd ones", () => {
    expect(K("S^2").reducedK0).toBe("ℤ");
    expect(K("S^3").reducedK0).toBe("0");
  });
  it("periodicity is named as the reason, not a table lookup", () => {
    expect(K("S^6").steps.join(" ")).toMatch(/2-PERIODIC \(Bott periodicity\)/);
  });
  it("complex projective spaces: K⁰(ℂPⁿ) = ℤⁿ⁺¹, K¹ = 0", () => {
    expect(K("CP^1").k0).toBe("ℤ²");
    expect(K("CP^3").k0).toBe("ℤ⁴");
    expect(K("CP^3").k1).toBe("0");
  });
  it("the collapse is explained by the absence of odd cells", () => {
    expect(K("CP^3").steps.join(" ")).toMatch(/no odd cells/);
  });
  it("a point and the torus", () => {
    expect(K("point").k0).toBe("ℤ");
    expect(K("torus").k0).toBe("ℤ²");
    expect(K("torus").k1).toBe("ℤ²");
  });
  // FLIPPED (v2.139.0, SCOPE-NUMERICS-TOPOLOGY §E14): this pin used to read
  // "…and that KO is not computed". KO is now computed (kReal.ts), so the
  // caveat points to it instead; what must stay true is that the complex answer
  // NAMES itself complex and says KO is a different, 8-periodic theory.
  it("says it is COMPLEX K-theory and points to KO, which is 8-periodic and computed separately", () => {
    expect(K("S^2").caveats.join(" ")).toMatch(/COMPLEX K-theory/);
    expect(K("S^2").caveats.join(" ")).toMatch(/8-periodic/);
    expect(K("S^2").caveats.join(" ")).toMatch(/KO of S¹/);
  });
  it("the ring structure is flagged as more than the group", () => {
    expect(K("CP^3").caveats.join(" ")).toMatch(/RING structure/);
  });
  it("anything else is refused rather than guessed", () => {
    expect(kTheory("nonsense")).toBeNull();
    expect(kTheory("")).toBeNull();
  });
  // FLIPPED (v2.139.0): kTheory("S^999") used to be null because of an n > 64
  // cap. Bott periodicity makes K*(Sⁿ) depend only on n mod 2, so the cap was a
  // refusal for the wrong reason (§A "k-theory of s^65"); the brief removes it.
  it("large spheres are answered by periodicity — S^999 and S^65 are odd spheres", () => {
    expect(K("S^999").k0).toBe("ℤ");
    expect(K("S^999").k1).toBe("ℤ");
    expect(K("s^65").reducedK0).toBe("0");
    expect(K("s^65").k1).toBe("ℤ");
  });
});

describe("§D2 complex K-theory: products, the framing words, ℝPⁿ", () => {
  const K = (q: string) => kTheory(q)!;
  it("k-theory of s^1 x s^1 and s^1 x s^2 → K⁰ = ℤ², K¹ = ℤ² (Künneth), never a factor", () => {
    for (const q of ["of s^1 x s^1", "s^1 x s^2", "S¹ × S¹", "s^1xs^1", "s^1 * s^2"]) {
      expect(`${q}: ${K(q).k0} | ${K(q).k1}`).toBe(`${q}: ℤ² | ℤ²`);
    }
    expect(K("s^1 x s^1").space).toBe("S¹ × S¹");
  });
  it("Künneth parity: S² × S² → ℤ⁴, 0; S¹ × S¹ × S¹ → ℤ⁴, ℤ⁴; ℂP² × S¹ → ℤ³, ℤ³", () => {
    expect([K("s^2 x s^2").k0, K("s^2 x s^2").k1]).toEqual(["ℤ⁴", "0"]);
    expect([K("s^1 x s^1 x s^1").k0, K("s^1 x s^1 x s^1").k1]).toEqual(["ℤ⁴", "ℤ⁴"]);
    expect([K("cp^2 x s^1").k0, K("cp^2 x s^1").k1]).toEqual(["ℤ³", "ℤ³"]);
  });
  it("S⁰ × S⁰ is four points: K⁰ = ℤ⁴", () => {
    expect([K("s^0 x s^0").k0, K("s^0 x s^0").k1]).toEqual(["ℤ⁴", "0"]);
  });
  it("k-theory of a point / of point → ℤ, 0; of the torus → ℤ², ℤ²", () => {
    for (const q of ["of a point", "of point", "point", "a point"]) expect(`${q}: ${K(q).k0}, ${K(q).k1}`).toBe(`${q}: ℤ, 0`);
    expect([K("of the torus").k0, K("of the torus").k1]).toEqual(["ℤ²", "ℤ²"]);
  });
  it("K̃⁰(ℝPⁿ) = ℤ/2 to the power ⌊n/2⌋ (Adams): ℝP² → ℤ/2, ℝP⁵ → ℤ/4; K¹ = ℤ exactly for n odd", () => {
    expect(K("RP^2").reducedK0).toBe("ℤ/2");
    expect(K("RP^5").reducedK0).toBe("ℤ/4");
    expect(K("RP^5").k1).toBe("ℤ");
    expect(K("RP^2").k1).toBe("0");
    expect(K("RP^1").reducedK0).toBe("0"); // ℝP¹ = S¹, consistent with the sphere answer
    expect(K("RP^2").caveats.join(" ")).toMatch(/Adams/);
  });
  it("a product with ℝPⁿ is refused by name (Tor term), not reduced to a factor", () => {
    expect(K("rp^2 x s^1").refused).toMatch(/Tor term/);
  });
});

describe("adversarial: degenerate and hostile braids", () => {
  const CASES: [string, number[], number][] = [
    ["empty on 2 strands", [], 2],
    ["single crossing", [1], 2],
    ["cancelling pair", [1, -1], 2],
    ["all negative", [-1, -1, -1], 2],
    ["three strands", [1, -2, 1, -2], 3],
    ["four strands", [1, 2, 3], 4],
    ["repeated far generator", [3, 3, 3], 4],
  ];
  for (const [name, word, strands] of CASES) {
    it(`${name}: returns a symmetric polynomial or an honest null`, () => {
      const t0 = Date.now();
      const r = alexanderPolynomial({ word, strands });
      expect(Date.now() - t0).toBeLessThan(5000);
      if (r) {
        expect(r.symmetric).toBe(true);
        expect(r.display).not.toMatch(/NaN|Infinity|undefined/);
        for (const [, c] of r.polynomial) expect(Number.isInteger(c)).toBe(true);
      }
    });
  }
  it("a larger braid still finishes quickly", () => {
    const t0 = Date.now();
    alexanderPolynomial({ word: [1, 2, 3, 4, -1, -2, 3], strands: 5 });
    expect(Date.now() - t0).toBeLessThan(10000);
  });
});
