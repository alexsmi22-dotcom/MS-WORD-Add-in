// Cobordism as a ring (cobordism.ts) — the exit test of SCOPE-NUMERICS-TOPOLOGY §D3.
//
// Oracles, none of them the engine agreeing with itself:
//   * Milnor–Stasheff §19's L₁, L₂, L₃ — the L-polynomials here are DERIVED
//     from √z/tanh √z by exp ∘ log, and must reproduce the printed ones;
//   * the brief's SymPy values for the Pontryagin numbers of ℂPⁿ and products,
//     each re-derived there by the signature theorem;
//   * Thom: ℝPⁿ bounds ⇔ n odd; anything × S¹ bounds; the Klein bottle bounds;
//   * the cited table Ω^SO₀…₈ = ℤ, 0, 0, 0, ℤ, ℤ/2, 0, 0, ℤ ⊕ ℤ.

import {
  parseManifold, analyseCobordism, cobordismReport, cobordismQuery, lPolynomials,
  formatLPolynomial, cobordismGroupReport, partitionCount, unorientedRank,
  MAX_COBORDISM_DIM, CobordismElement,
} from "../cobordism";
import { MAX_PARTITION_N, realProjectiveCobordism } from "../topology2";

const el = (s: string): CobordismElement => {
  const r = parseManifold(s);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const A = (s: string) => analyseCobordism(el(s));
const pnums = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const x of A(s).pontryagin ?? []) out[x.label] = String(x.value);
  return out;
};

describe("the L-polynomials are derived, and match Milnor–Stasheff §19", () => {
  it("L₁ = p₁/3", () => expect(formatLPolynomial(1)).toBe("p₁/3"));
  it("L₂ = (7p₂ − p₁²)/45", () => expect(formatLPolynomial(2)).toBe("(7p₂ − p₁²)/45"));
  it("L₃ = (62p₃ − 13p₂p₁ + 2p₁³)/945", () => expect(formatLPolynomial(3)).toBe("(62p₃ − 13p₂p₁ + 2p₁³)/945"));
  it("L₄ = (381p₄ − 71p₃p₁ − 19p₂² + 22p₂p₁² − 3p₁⁴)/14175 (Hirzebruch)", () => {
    expect(formatLPolynomial(4)).toBe("(381p₄ − 71p₃p₁ − 19p₂² + 22p₂p₁² − 3p₁⁴)/14175");
  });
  it("is cached and goes to weight 10 (dimension 40)", () => {
    expect(lPolynomials(10).length).toBe(11);
  });
  it("the dimension cap equals topology2's partition cap", () => {
    expect(MAX_COBORDISM_DIM).toBe(MAX_PARTITION_N);
  });
});

describe("§D3 Pontryagin numbers and signature", () => {
  it("ℂP²: p₁ = 3, σ = 1, does not bound, generates Ω₄", () => {
    const a = A("CP^2");
    expect(pnums("CP^2")).toEqual({ "p₁": "3" });
    expect(a.signature).toBe(1n);
    expect(a.orientedBounds).toBe(false);
    expect(a.coordinates).toMatch(/1·\[ℂP²\]/);
  });
  it("ℂP² # ℂP²: p₁ = 6, σ = 2, = 2·[ℂP²]", () => {
    expect(pnums("CP^2 # CP^2")).toEqual({ "p₁": "6" });
    expect(A("CP^2 # CP^2").signature).toBe(2n);
    expect(A("CP^2 # CP^2").coordinates).toMatch(/2·\[ℂP²\]/);
  });
  it("ℂP² # ℂP²bar: p₁ = 0, σ = 0, BOUNDS (oriented)", () => {
    for (const s of ["CP^2 # CP^2bar", "CP^2 # CP^2 bar", "CP^2 # -CP^2", "CP^2 - CP^2", "ℂP² # −ℂP²"]) {
      const a = A(s);
      expect(a.pontryagin).toEqual([]);
      expect(a.signature).toBe(0n);
      expect(a.orientedBounds).toBe(true);
    }
  });
  it("S² × S²: p₁ = 0, σ = 0, BOUNDS", () => {
    const a = A("S^2 x S^2");
    expect(a.signature).toBe(0n);
    expect(a.orientedBounds).toBe(true);
    expect(a.unorientedBounds).toBe(true);
  });
  it("ℂP⁴: p₁² = 25, p₂ = 10, σ = 1", () => {
    expect(pnums("CP^4")).toEqual({ "p₁²": "25", "p₂": "10" });
    expect(A("CP^4").signature).toBe(1n);
    expect(A("CP^4").coordinates).toMatch(/1·\[ℂP⁴\] \+ 0·/);
  });
  it("ℂP² × ℂP²: p₁² = 18, p₂ = 9, σ = 1 — not cobordant to ℂP⁴", () => {
    expect(pnums("CP^2 x CP^2")).toEqual({ "p₁²": "18", "p₂": "9" });
    expect(A("CP^2 x CP^2").signature).toBe(1n);
    expect(A("CP^2 x CP^2").coordinates).toMatch(/0·\[ℂP⁴\] \+ 1·/);
    const r = cobordismQuery("is CP^2 x CP^2 cobordant to CP^4")!;
    expect(r.display.join(" ")).toMatch(/Oriented: NOT cobordant/);
  });
  it("ℂP⁶: p₃ = 35, p₂p₁ = 147, p₁³ = 343, σ = 1; numbers only (n = 12)", () => {
    expect(pnums("CP^6")).toEqual({ "p₃": "35", "p₂p₁": "147", "p₁³": "343" });
    const a = A("CP^6");
    expect(a.signature).toBe(1n);
    expect(a.orientedBounds).toBe(false); // a nonzero number is an obstruction in any dimension
  });
  it("ℂP² × ℂP⁴: p₃ = 30, p₂p₁ = 105, p₁³ = 225, σ = 1", () => {
    expect(pnums("CP^2 x CP^4")).toEqual({ "p₃": "30", "p₂p₁": "105", "p₁³": "225" });
    expect(A("CP^2 x CP^4").signature).toBe(1n);
  });
  it("K3 (cited): p₁ = −48, σ = −16, does not bound (oriented), = −16·[ℂP²]", () => {
    const a = A("K3");
    expect(pnums("K3")).toEqual({ "p₁": "-48" });
    expect(a.signature).toBe(-16n);
    expect(a.orientedBounds).toBe(false);
    expect(a.coordinates).toMatch(/−16·\[ℂP²\]/); // true minus U+2212 (review cosmetic fix)
    expect(a.caveats.join(" ")).toMatch(/CITED/);
  });
  it("Wu: no Pontryagin numbers (n = 5); w₂w₃ = 1; does NOT bound; generator of Ω₅", () => {
    const a = A("wu");
    expect(a.sw!.map((x) => x.label)).toEqual(["w₃w₂"]);
    expect(a.orientedBounds).toBe(false);
    expect(a.unorientedBounds).toBe(false);
    expect(a.steps.join(" ")).toMatch(/de Rham invariant w₂w₃\[M\] = 1/);
  });
  it("ℂP⁸ and ℂP¹⁰: σ = 1 by the derived L₄, L₅", () => {
    expect(A("CP^8").signature).toBe(1n);
    expect(A("CP^10").signature).toBe(1n);
    expect(A("CP^8").contradiction).toBeUndefined();
  });
});

describe("§D3 unoriented verdicts (Thom)", () => {
  const bounds = (q: string) => cobordismQuery(q)!.display[0];
  it("does rp^2 # rp^2 bound / does the klein bottle bound → BOUNDS", () => {
    expect(bounds("does rp^2 # rp^2 bound")).toMatch(/BOUNDS/);
    expect(bounds("does the klein bottle bound")).toMatch(/BOUNDS/);
    const r = cobordismQuery("does rp^2 # rp^2 bound")!;
    expect(r.steps.join(" ")).toMatch(/Klein bottle/);
  });
  it("does rp^2 x s^1 bound, rp^2 x rp^1 → BOUNDS", () => {
    expect(bounds("does rp^2 x s^1 bound")).toMatch(/BOUNDS/);
    expect(bounds("does rp^2 x rp^1 bound")).toMatch(/BOUNDS/);
  });
  it("rp^2 x rp^2 → does NOT (w₂² = 1, w₁⁴ = 0)", () => {
    const a = A("rp^2 x rp^2");
    expect(a.unorientedBounds).toBe(false);
    const labels = a.sw!.map((x) => x.label);
    expect(labels).toContain("w₂²");
    expect(labels).not.toContain("w₁⁴");
  });
  it("does rp^3 x rp^2 bound → BOUNDS", () => {
    expect(bounds("does rp^3 x rp^2 bound")).toMatch(/BOUNDS/);
  });
  it("twins: ℝPⁿ bounds ⇔ n odd, n = 1…12, through the ring engine", () => {
    for (let n = 1; n <= 12; n++) {
      expect(`RP^${n}: ${A(`RP^${n}`).unorientedBounds}`).toBe(`RP^${n}: ${n % 2 === 1}`);
    }
  });
  it("cobordism of cp^2 (unoriented) → does NOT bound (w₂² = 1)", () => {
    const r = cobordismQuery("unoriented cobordism of cp^2")!;
    expect(r.display[0]).toMatch(/does NOT bound/);
    expect(r.display[0]).toMatch(/w₂² = 1/);
  });
  it("RP^2 # CP^2 → dimension 2 vs 4 — connected sum needs equal dimensions", () => {
    const r = parseManifold("RP^2 # CP^2");
    expect("error" in r && r.error).toMatch(/Dimension 2 vs 4 — a connected sum needs equal dimensions/);
  });
});

describe("§D3 groups", () => {
  it("Ω^SO_n, n = 0…8 is the cited table", () => {
    const got = Array.from({ length: 9 }, (_, n) => cobordismGroupReport(n).display[0].split("= ")[1]);
    expect(got).toEqual(["ℤ", "0", "0", "0", "ℤ", "ℤ/2", "0", "0", "ℤ ⊕ ℤ"]);
  });
  it("generators: ℂP² (4), Wu (5), ℂP⁴ and ℂP² × ℂP² (8)", () => {
    expect(cobordismGroupReport(4).display[1]).toMatch(/ℂP²/);
    expect(cobordismGroupReport(5).display[1]).toMatch(/Wu/);
    expect(cobordismGroupReport(8).display[1]).toMatch(/ℂP⁴ and ℂP² × ℂP²/);
  });
  it("rank p(n/4): n = 12 → 3, 16 → 5, 40 → 42", () => {
    expect(partitionCount(3)).toBe(3);
    expect(partitionCount(4)).toBe(5);
    expect(partitionCount(10)).toBe(42);
    expect(cobordismGroupReport(40).display[0]).toMatch(/= 42 = p\(10\)/);
  });
  it("n ≥ 9: the torsion is refused by name, the rank is given", () => {
    for (const n of [9, 10, 11, 13]) {
      const r = cobordismGroupReport(n);
      expect(r.display.join(" ")).toMatch(/TORSION .* is not given/);
      expect(r.display[0]).toMatch(/Rank of Ω[₀-₉]+ˢᴼ = 0/); // display contract: Ω₉ˢᴼ, not Ω^SO
    }
  });
  it("the unoriented ranks are Thom's count: 𝔑₀…𝔑₈ = 1, 0, 1, 0, 2, 1, 3, 1, 5", () => {
    expect(Array.from({ length: 9 }, (_, n) => unorientedRank(n))).toEqual([1, 0, 1, 0, 2, 1, 3, 1, 5]);
  });
  // Display contract: the group prints as Ω₅ˢᴼ (was "Ω^SO₅"), and the printed
  // form is itself one of the accepted inputs.
  it("typed: Omega^SO_5, omega_5, cobordism group omega_5, Ω^SO₅, Ω₅ˢᴼ", () => {
    for (const q of ["Omega^SO_5", "omega_5", "cobordism group omega_5", "Ω^SO₅", "Ω₅ˢᴼ", "oriented cobordism group dimension 5"]) {
      expect(`${q}: ${cobordismQuery(q)!.display[0]}`).toBe(`${q}: Ω₅ˢᴼ = ℤ/2`);
    }
    expect(cobordismQuery("𝔑₅")!.display[0]).toBe("𝔑₅ = ℤ/2");
  });
});

describe("the old route is now a thin call into the ring engine", () => {
  it("realProjectiveCobordism keeps its shape and its answers", () => {
    expect(realProjectiveCobordism(4).boundsAManifold).toBe(false);
    expect(realProjectiveCobordism(5).boundsAManifold).toBe(true);
    expect(realProjectiveCobordism(4).numbers.length).toBe(5);
  });
  it("RP^42 does NOT bound (the old loop said BOUNDS over an empty list)", () => {
    const r = realProjectiveCobordism(42);
    expect(r.boundsAManifold).toBe(false);
    expect(r.steps.join(" ")).toMatch(/χ\(ℝP⁴²\) mod 2 = 1/);
    expect(realProjectiveCobordism(43).boundsAManifold).toBe(true);
  });
  it("n is never clamped: ℝP⁵¹³ bounds, ℝP⁵¹² does not, ℝP⁰ (a point) does not", () => {
    expect(realProjectiveCobordism(513).boundsAManifold).toBe(true);
    expect(realProjectiveCobordism(512).boundsAManifold).toBe(false);
    expect(realProjectiveCobordism(0).boundsAManifold).toBe(false);
    expect(() => realProjectiveCobordism(Infinity)).toThrow(/whole number/);
  });
});

describe("a manifold typed ALONE gets its standard summary (was NULL: \"Couldn't read\")", () => {
  // Through the real topology entry point, as the pane calls it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { solveTopology } = require("../homology");
  const show = (q: string) => {
    const r = solveTopology(q);
    return r ? `${r.title} :: ${(r.display ?? []).join(" | ")}` : "NULL";
  };
  it("rp^2 x rp^2: dim 4, non-orientable, χ = 1, w₂² = 1, does NOT bound", () => {
    const s = show("rp^2 x rp^2");
    expect(s).toMatch(/^Manifold summary: ℝP² × ℝP²/);
    expect(s).toContain("Dimension 4; not orientable; Euler characteristic χ = 1.");
    expect(s).toContain("w₂² = 1");
    expect(s).toMatch(/Unoriented: ℝP² × ℝP² does NOT bound/);
  });
  it("K3: dim 4, orientable, χ = 24, p₁ = −48, σ = −16; bounds unoriented, not oriented", () => {
    const s = show("K3");
    expect(s).toContain("Dimension 4; orientable; Euler characteristic χ = 24.");
    expect(s).toContain("p₁ = −48; signature σ = −16");
    expect(s).toMatch(/Unoriented: K3 BOUNDS/);
    expect(s).toMatch(/Oriented: K3 does NOT bound/);
  });
  it("CP^2 # CP^2bar: χ = 4, σ = 0, bounds in both theories", () => {
    const s = show("CP^2 # CP^2bar");
    expect(s).toContain("Euler characteristic χ = 4.");
    expect(s).toContain("signature σ = 0");
    expect(s).toMatch(/Oriented: ℂP² # −ℂP² BOUNDS/);
  });
  it("CP^2 (χ = 3, σ = 1), wu (dim 5, w₃w₂ = 1), RP^3 x S^2 (χ = 0)", () => {
    expect(show("CP^2")).toContain("χ = 3.");
    expect(show("CP^2")).toContain("σ = 1");
    expect(show("wu")).toContain("Dimension 5; orientable");
    expect(show("wu")).toContain("w₃w₂ = 1");
    expect(show("RP^3 x S^2")).toContain("χ = 0");
  });
  it("the printed title reads back to the same summary", () => {
    for (const q of ["rp^2 x rp^2", "K3", "CP^2 # CP^2bar"]) {
      const t = solveTopology(q).title;
      expect(solveTopology(t).title).toBe(t);
    }
  });
  it("named homology spaces keep their homology answer; non-manifolds are untouched", () => {
    expect(solveTopology("torus").kind).toBe("homology");
    expect(solveTopology("rp2").kind).toBe("homology");
    expect(solveTopology("klein bottle").kind).toBe("homology");
    expect(solveTopology("banana")).toBeNull();
    expect(solveTopology("2")).toBeNull();
  });
});

describe("ℝPⁿ above the ring engine's cap is decided by the theorem (realProjectiveCobordism)", () => {
  it("does rp^100 bound → does NOT (even); rp^101 → BOUNDS (odd)", () => {
    expect(cobordismQuery("does rp^100 bound")!.display[0]).toBe("Unoriented: ℝP¹⁰⁰ does NOT bound.");
    expect(cobordismQuery("does rp^101 bound")!.display[0]).toBe("Unoriented: ℝP¹⁰¹ BOUNDS.");
    expect(cobordismQuery("does rp^101 bound")!.steps.join(" ")).toMatch(/Hopf/);
  });
});

describe("display parses back", () => {
  it("every element name re-parses to the same numbers", () => {
    for (const s of ["CP^2 # CP^2bar", "rp^2 x rp^2", "(CP^2 # CP^2) x S^1", "2 cp^2", "K3 # -CP^2", "wu x s^3"]) {
      const a = el(s);
      const b = el(a.name);
      expect(b.name).toBe(a.name);
      expect(String(analyseCobordism(b).signature)).toBe(String(analyseCobordism(a).signature));
      expect(analyseCobordism(b).unorientedBounds).toBe(analyseCobordism(a).unorientedBounds);
    }
  });
});

describe("report wording", () => {
  it("unoriented and oriented verdicts are separate lines", () => {
    const r = cobordismReport(el("K3"));
    expect(r.display[0]).toMatch(/^Unoriented: K3 BOUNDS/);
    expect(r.display.join(" ")).toMatch(/Oriented: K3 does NOT bound/);
  });
});
