// Real K-theory KO (kReal.ts) — SCOPE-NUMERICS-TOPOLOGY §D2, the exit test.
//
// Oracles: real Bott periodicity (KO^{-q}(pt) = ℤ, ℤ/2, ℤ/2, 0, ℤ, 0, 0, 0)
// and Adams 1962 Thm 7.4 (K̃O⁰(ℝPⁿ) = ℤ/2^φ(n)), whose φ(1…16) the brief
// lists. The second route for ℝPⁿ — counting nonzero Atiyah–Hirzebruch E₂
// entries from the cellular cochain complex — is checked against φ here too.

import {
  koTheory, adamsPhi, ahssKoEntriesRP, rpCohomology, koOfPoint, isKoQuery, normaliseTopologyText,
} from "../kReal";

const KO = (q: string) => {
  const r = koTheory(q);
  if (!r) throw new Error(`null for ${q}`);
  return r;
};

describe("§D2 spheres by Bott periodicity", () => {
  it("KO of S^1 · real k-theory of s^1 · KO(S^1) → K̃O⁰ = ℤ/2, KO⁰ = ℤ ⊕ ℤ/2", () => {
    for (const q of ["KO of S^1", "real k-theory of s^1", "KO(S^1)", "ko-theory of s^1", "KO of the circle", "K̃O⁰(S¹)"]) {
      expect(`${q}: ${KO(q).reducedK0} | ${KO(q).k0}`).toBe(`${q}: ℤ/2 | ℤ ⊕ ℤ/2`);
    }
  });
  it("S² … S⁹ reduced: ℤ/2 · 0 · ℤ · 0 · 0 · 0 · ℤ · ℤ/2", () => {
    const got = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => KO(`KO of S^${n}`).reducedK0);
    expect(got).toEqual(["ℤ/2", "0", "ℤ", "0", "0", "0", "ℤ", "ℤ/2"]);
  });
  it("KO of S^1000001 → ℤ/2 (1000001 ≡ 1 mod 8)", () => {
    expect(KO("KO of S^1000001").reducedK0).toBe("ℤ/2");
    expect(KO("KO of S^1000001").steps.join(" ")).toMatch(/≡ 1 \(mod 8\)/);
  });
  it("beyond the display limit is refused by name, never parsed wrongly", () => {
    expect(KO("KO of S^99999999999").refused).toMatch(/display limit/);
  });
  it("S⁰ is two points: KO⁰ = ℤ ⊕ ℤ, K̃O⁰ = ℤ", () => {
    expect(KO("KO of S^0").k0).toBe("ℤ ⊕ ℤ");
    expect(KO("KO of S^0").reducedK0).toBe("ℤ");
  });
  it("graded: KO^{-1}(S^1) reduced = KO^{-2}(pt) = ℤ/2; KO^1(S^1) reduced = KO⁰(pt) = ℤ", () => {
    expect(KO("KO^-1(S^1)").reducedK0).toBe("ℤ/2");
    expect(KO("KO^1(S^1)").reducedK0).toBe("ℤ");
  });
  it("the output states the convention and the citation", () => {
    const c = KO("KO of S^4").caveats.join(" ");
    expect(c).toMatch(/K̃O⁻ᵏ\(Sⁿ\) = KO⁻⁽ᵏ⁺ⁿ⁾\(pt\)/); // typeset, no carets (display contract)
    expect(c).not.toMatch(/\^/);
    expect(c).toMatch(/Bott/);
  });
});

describe("§D2 a point", () => {
  it("KO-theory of a point → KO⁰ = ℤ and the row q = 0…7", () => {
    const r = KO("KO-theory of a point");
    expect(r.k0).toBe("ℤ");
    expect(r.display).toEqual([
      "KO⁰(pt) = ℤ", "KO⁻¹(pt) = ℤ/2", "KO⁻²(pt) = ℤ/2", "KO⁻³(pt) = 0",
      "KO⁻⁴(pt) = ℤ", "KO⁻⁵(pt) = 0", "KO⁻⁶(pt) = 0", "KO⁻⁷(pt) = 0",
    ]);
  });
  it("8-periodic in both directions", () => {
    for (let q = -20; q <= 20; q++) expect(koOfPoint(q)).toBe(koOfPoint(q + 8));
  });
  it("KO(RP^0) is a point, and says so", () => {
    const r = KO("KO(RP^0)");
    expect(r.k0).toBe("ℤ");
    // The space prints as ℝP⁰ (it must read back); the step says it is a point.
    expect(r.space).toBe("ℝP⁰");
    expect(r.steps.join(" ")).toMatch(/single point/);
  });
});

describe("§D2 ℝPⁿ — Adams φ(n), with the Atiyah–Hirzebruch count as second route", () => {
  it("φ(1…16) = 1, 2, 2, 3, 3, 3, 3, 4, 5, 6, 6, 7, 7, 7, 7, 8", () => {
    expect(Array.from({ length: 16 }, (_, i) => adamsPhi(i + 1))).toEqual([1, 2, 2, 3, 3, 3, 3, 4, 5, 6, 6, 7, 7, 7, 7, 8]);
  });
  it("the E₂ count equals φ(n) for n = 1…200, each entry ℤ/2", () => {
    for (let n = 1; n <= 200; n++) {
      const e = ahssKoEntriesRP(n);
      expect(`${n}: ${e.length}`).toBe(`${n}: ${adamsPhi(n)}`);
      expect(e.every((x) => x.group === "ℤ/2")).toBe(true);
    }
  });
  it("cellular cohomology of ℝPⁿ: H*(ℝP³; ℤ) = ℤ, 0, ℤ/2, ℤ; over ℤ/2 every degree is ℤ/2", () => {
    expect([0, 1, 2, 3].map((q) => rpCohomology(3, q, "Z"))).toEqual(["ℤ", "0", "ℤ/2", "ℤ"]);
    expect([0, 1, 2, 3, 4].map((q) => rpCohomology(4, q, "Z"))).toEqual(["ℤ", "0", "ℤ/2", "0", "ℤ/2"]);
    expect([0, 1, 2].map((q) => rpCohomology(2, q, "Z/2"))).toEqual(["ℤ/2", "ℤ/2", "ℤ/2"]);
  });
  it("ℝP¹ → ℤ/2 (equals S¹); ℝP² → ℤ/4; ℝP³ → ℤ/4; ℝP⁴ → ℤ/8; ℝP⁸ → ℤ/16; ℝP⁹ → ℤ/32", () => {
    const got = [1, 2, 3, 4, 8, 9].map((n) => KO(`KO of RP^${n}`).reducedK0);
    expect(got).toEqual(["ℤ/2", "ℤ/4", "ℤ/4", "ℤ/8", "ℤ/16", "ℤ/32"]);
    expect(KO("KO of RP^1").reducedK0).toBe(KO("KO of S^1").reducedK0);
  });
  it("cites Adams 1962 Theorem 7.4", () => {
    expect(KO("KO(RP^4)").caveats.join(" ")).toMatch(/Adams.*1962.*Theorem 7\.4/);
  });
  it("a large ℝPⁿ prints the order as a power of two", () => {
    expect(KO("KO of RP^1000").reducedK0).toBe(`ℤ/2${"⁵⁰⁰"}`);
  });
});

describe("§D2 must refuse by name", () => {
  it("KO^1(RP^3) — graded KO of ℝPⁿ", () => {
    expect(KO("KO^1(RP^3)").refused).toMatch(/needs the full Atiyah–Hirzebruch computation; only K̃O⁰ is a published closed form/);
    expect(KO("KO^-2(RP^5)").refused).toMatch(/Atiyah–Hirzebruch/);
  });
  it("KO of CP^2 — Sanderson, cited, not built", () => {
    expect(KO("KO of CP^2").refused).toMatch(/Sanderson/);
  });
  it("KO of s^1 x s^1 — products, never a factor", () => {
    for (const q of ["KO of s^1 x s^1", "KO of the torus", "ko of s^1 × s^2"]) {
      expect(KO(q).refused).toMatch(/Tor terms/);
    }
  });
  // FLIPPED (review): S⁰ × S⁰ was in the refused list above; it is four
  // points, a discrete space with no Tor term, so it is now answered.
  it("KO(S⁰ × S⁰) is four points: KO⁰ = ℤ⁴, K̃O⁰ = ℤ³", () => {
    expect(KO("KO(S^0 x S^0)").k0).toBe("ℤ⁴");
    expect(KO("KO(S^0 x S^0)").reducedK0).toBe("ℤ³");
    expect(KO("KO^-1(S^0 x S^0)").k0).toBe("(ℤ/2)⁴");
  });
  it("unreadable space → null (the router says what is computed)", () => {
    expect(koTheory("KO of nonsense")).toBeNull();
  });
});

describe("detection and normalisation", () => {
  it("real-K phrasings are KO; complex ones are not", () => {
    for (const q of ["KO of S^1", "KO(S^1)", "ko-theory of s^1", "real k-theory of s^1", "KO^0(pt)", "K̃O⁰(S¹)"]) {
      expect(`${q}: ${isKoQuery(q)}`).toBe(`${q}: true`);
    }
    for (const q of ["k-theory of s^1", "k theory cp^2", "knot trefoil", "homology of the torus"]) {
      expect(`${q}: ${isKoQuery(q)}`).toBe(`${q}: false`);
    }
  });
  it("superscripts, ×, ℝ and the Unicode minus fold to ASCII", () => {
    expect(normaliseTopologyText("ℝP² × S¹⁰")).toBe("rp^2 x s^10");
    expect(normaliseTopologyText("KO⁻²(S¹)")).toBe("ko^-2(s^1)");
  });
});
