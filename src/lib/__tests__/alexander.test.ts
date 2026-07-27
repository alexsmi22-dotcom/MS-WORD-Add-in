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

describe("K-theory, where Bott periodicity settles it", () => {
  const K = (q: string) => kTheory(q)!;
  it("spheres are 2-periodic: even gives Z ⊕ Z, odd gives Z with K¹ = Z", () => {
    expect(K("S^2").k0).toBe("Z + Z");
    expect(K("S^2").k1).toBe("0");
    expect(K("S^4").k0).toBe("Z + Z");
    expect(K("S^3").k0).toBe("Z");
    expect(K("S^3").k1).toBe("Z");
    expect(K("S^1").k1).toBe("Z");
  });
  it("the reduced K⁰ is Z for even spheres and 0 for odd ones", () => {
    expect(K("S^2").reducedK0).toBe("Z");
    expect(K("S^3").reducedK0).toBe("0");
  });
  it("periodicity is named as the reason, not a table lookup", () => {
    expect(K("S^6").steps.join(" ")).toMatch(/2-PERIODIC \(Bott periodicity\)/);
  });
  it("complex projective spaces: K⁰(ℂPⁿ) = Z^{n+1}, K¹ = 0", () => {
    expect(K("CP^1").k0).toBe("Z^2");
    expect(K("CP^3").k0).toBe("Z^4");
    expect(K("CP^3").k1).toBe("0");
  });
  it("the collapse is explained by the absence of odd cells", () => {
    expect(K("CP^3").steps.join(" ")).toMatch(/no odd cells/);
  });
  it("a point and the torus", () => {
    expect(K("point").k0).toBe("Z");
    expect(K("torus").k0).toBe("Z^2");
    expect(K("torus").k1).toBe("Z^2");
  });
  it("says it is COMPLEX K-theory and that KO is not computed", () => {
    expect(K("S^2").caveats.join(" ")).toMatch(/COMPLEX K-theory/);
    expect(K("S^2").caveats.join(" ")).toMatch(/8-periodic/);
  });
  it("the ring structure is flagged as more than the group", () => {
    expect(K("CP^3").caveats.join(" ")).toMatch(/RING structure/);
  });
  it("anything else is refused rather than guessed", () => {
    expect(kTheory("nonsense")).toBeNull();
    expect(kTheory("")).toBeNull();
    expect(kTheory("S^999")).toBeNull();
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
