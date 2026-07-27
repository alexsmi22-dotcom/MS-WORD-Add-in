// Spectral sequences (A2) and stable homotopy (A3) — spectral.ts.
//
// These are the two entries the design brief deliberately held back, and the
// tests here are mostly about WHAT IS NOT CLAIMED.
//
// The sharpest case is the fibration S¹ → E → S². Its E₂ page has a single
// possible d₂, and that differential genuinely is undetermined by the page:
// for the HOPF fibration it is an isomorphism (E = S³), and for the trivial
// bundle it is zero (E = S¹ × S²). Same E₂, different answer. So a tool that
// handed over H*(E) from this page would be inventing it — and the assertion
// below is that this one refuses to.

import { serreE2, stableStem, SPECTRAL_SPACES, STABLE_RANGE } from "../spectral";

describe("the E₂ page is computed", () => {
  it("S¹ → E → S² has a 3×2 page", () => {
    const r = serreE2("s2", "s1")!;
    expect(r.maxP).toBe(2);
    expect(r.maxQ).toBe(1);
    expect(r.cells.filter((c) => c.nonzero).length).toBe(4);
  });
  it("the grid is drawn with q increasing upward, as it is by hand", () => {
    const g = serreE2("s2", "s1")!.grid;
    expect(g.indexOf("q=1")).toBeLessThan(g.indexOf("q=0"));
    expect(g).toContain("p=0");
  });
  it("E₂ entries are the tensor of the two homologies", () => {
    const r = serreE2("torus", "s1")!;
    // H_1(T²) = Z², tensor H_0(S¹) = Z, gives Z².
    expect(r.cells.find((c) => c.p === 1 && c.q === 0)!.group).toBe("Z^2");
  });
  it("unknown spaces are refused", () => {
    expect(serreE2("nonsense", "s1")).toBeNull();
    expect(serreE2("s2", "nonsense")).toBeNull();
  });
  it("every advertised space actually works", () => {
    for (const s of SPECTRAL_SPACES) {
      expect(`${s}: ${serreE2(s, "s1") ? "ok" : "FAILED"}`).toBe(`${s}: ok`);
    }
  });
});

describe("differentials are MARKED, never computed", () => {
  it("S¹ → E → S² has exactly one possible d₂, and it is undetermined", () => {
    const r = serreE2("s2", "s1")!;
    expect(r.differentials.length).toBe(1);
    const d = r.differentials[0];
    expect(d.r).toBe(2);
    expect(d.from).toEqual({ p: 2, q: 0 });
    expect(d.to).toEqual({ p: 0, q: 1 });
    expect(d.status).toBe("undetermined");
  });
  it("that page therefore yields NO abutment — the Hopf case proves it must not", () => {
    const r = serreE2("s2", "s1")!;
    expect(r.collapses).toBe(false);
    expect(r.abutment).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/THE DIFFERENTIALS ARE NOT COMPUTED/);
    expect(r.caveats.join(" ")).toMatch(/share an E₂ page and differ in d₂/);
  });
  it("the marked entry is flagged in the grid", () => {
    expect(serreE2("s2", "s1")!.grid).toContain("*");
    expect(serreE2("s2", "s1")!.grid).toMatch(/UNDETERMINED differential/);
  });
  it("more differentials on a bigger page", () => {
    const r = serreE2("cp2", "s1")!;
    expect(r.differentials.length).toBeGreaterThan(1);
    expect(r.differentials.every((d) => d.status === "undetermined")).toBe(true);
  });
});

describe("collapse is PROVED before any abutment is read off", () => {
  it("S³ → E → S² collapses: no differential has both ends nonzero", () => {
    const r = serreE2("s2", "s3")!;
    expect(r.differentials.length).toBe(0);
    expect(r.collapses).toBe(true);
    expect(r.steps.join(" ")).toMatch(/this is a proof, not an assumption/);
  });
  it("a collapsed sequence gives the ASSOCIATED GRADED, and says so", () => {
    const r = serreE2("s2", "s3")!;
    expect(r.abutment).toBeTruthy();
    expect(r.abutment!.every((a) => /associated graded/.test(a))).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/EXTENSION PROBLEM remains/);
    expect(r.caveats.join(" ")).toMatch(/Z\/4 and Z\/2 \+ Z\/2/);
  });
  it("S¹ → E → S¹ collapses (it is the torus)", () => {
    expect(serreE2("s1", "s1")!.collapses).toBe(true);
  });
  it("the local-coefficients assumption is stated on every result", () => {
    for (const [b, f] of [["s2", "s1"], ["s2", "s3"], ["torus", "s1"]]) {
      expect(serreE2(b, f)!.caveats.join(" ")).toMatch(/untwisted/);
    }
  });
});

describe("stable homotopy is a CITED TABLE, never a computation", () => {
  const S = (n: number) => stableStem(n)!;
  it("known stems match the literature", () => {
    expect(S(0).group).toBe("Z");
    expect(S(1).group).toBe("Z/2");
    expect(S(3).group).toBe("Z/24");
    expect(S(7).group).toBe("Z/240");
    expect(S(11).group).toBe("Z/504");
  });
  it("the vanishing stems are right", () => {
    expect(S(4).group).toBe("0");
    expect(S(5).group).toBe("0");
    expect(S(12).group).toBe("0");
  });
  it("every result says it is NOT COMPUTED", () => {
    expect(S(3).caveats.join(" ")).toMatch(/NOT COMPUTED/);
    expect(S(3).steps.join(" ")).toMatch(/LOOKUP from a published table/);
  });
  it("the source is named", () => {
    expect(S(3).caveats.join(" ")).toMatch(/Hatcher/);
    expect(S(3).caveats.join(" ")).toMatch(/Toda/);
  });
  it("it warns against extrapolating", () => {
    expect(S(3).caveats.join(" ")).toMatch(/Do not extrapolate/);
  });
  it("outside the tabulated range it says so rather than inventing a group", () => {
    const r = stableStem(STABLE_RANGE.max + 1)!;
    expect(r.group).toBe("not tabulated here");
    expect(r.caveats.join(" ")).toMatch(/NOT COMPUTABLE HERE/);
  });
  it("nonsense input is refused", () => {
    expect(stableStem(-1)).toBeNull();
    expect(stableStem(1.5)).toBeNull();
  });
});
