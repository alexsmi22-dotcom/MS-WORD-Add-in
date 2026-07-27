// Does each question REACH the code that answers it?
//
// Every individual engine in Solve had passing tests while three of them were
// unreachable from the pane, because routing is the one thing a unit test of an
// engine cannot check. Three real bugs motivated this file:
//
//   "alexander trefoil"      answered with the JONES polynomial, because the
//                            word-boundary in /\balexander\b/ had been eaten
//                            and replaced by a literal backspace character —
//                            a regex that can never match, and that neither
//                            tsc nor eslint objects to. See controlchars below.
//   "pi1 trefoil"            answered with the stable homotopy group pi_1^s,
//                            because a newer branch was placed ahead of the
//                            knot branch and its /pi_?\d/ pattern was greedier.
//   "homology of torus"      answered with nothing, because named spaces were
//                            looked up by EXACT string and the framing words
//                            were never stripped.
//
// The assertions are deliberately on the ANSWER'S IDENTITY, not its content —
// content is tested in each engine's own file. What is checked here is only
// that the question arrived at the right door.

import { solveTopology } from "../homology";

const ask = (q: string) => {
  const r = solveTopology(q) as any;
  if (r == null) return "NULL";
  if (r.kind === "homology") return `homology:${r.groups.join(",")}`;
  if (r.kind === "persistence") return "persistence";
  return `advanced:${r.title}`;
};

describe("a named space is found however the question is phrased", () => {
  const PHRASINGS = [
    "torus",
    "homology of torus",
    "homology of the torus",
    "compute the homology of the torus",
    "what is the homology of torus",
    "H_* of the torus",
  ];
  for (const q of PHRASINGS) {
    it(`"${q}" gives the torus`, () => {
      expect(`${q} -> ${ask(q)}`).toBe(`${q} -> homology:Z,Z^2,Z`);
    });
  }
  it("stripping filler does not invent a space", () => {
    expect(ask("homology of the")).toBe("NULL");
    expect(ask("compute the homology of nonsense")).toBe("NULL");
  });
});

describe("knot questions beat the newer topology branches", () => {
  it("alexander asks for the ALEXANDER polynomial, not the Jones one", () => {
    expect(ask("alexander trefoil")).toMatch(/^advanced:Alexander polynomial/);
    expect(ask("alexander polynomial figure-8")).toMatch(/^advanced:Alexander polynomial/);
  });
  it("jones still asks for the Jones polynomial", () => {
    expect(ask("jones trefoil")).toMatch(/^advanced:Jones polynomial/);
  });
  it("pi1 is the fundamental group, NOT the stable stem pi_1^s", () => {
    const r = ask("pi1 trefoil");
    expect(r).toMatch(/π₁ of the complement/);
    expect(r).not.toMatch(/[Ss]table/);
  });
  it("a stem question with no knot in it still reaches the stem table", () => {
    expect(ask("pi_11^s")).toMatch(/^advanced:Stable homotopy/);
  });
});

describe("stable homotopy is reached however the index is written", () => {
  const WAYS = ["stable pi_3", "stable homotopy 3", "stable stem 3", "pi_3^s"];
  for (const q of WAYS) {
    it(`"${q}" reaches the table`, () => {
      expect(`${q} -> ${ask(q)}`).toBe(`${q} -> advanced:Stable homotopy group pi_3^s`);
    });
  }
});

describe("spectral sequences tolerate the filler words people type", () => {
  const WAYS = [
    "serre s2 s1",
    "spectral sequence of s2 s1",
    "serre spectral sequence for s2 s1",
    "fibration s2 s1",
  ];
  for (const q of WAYS) {
    it(`"${q}" builds the E2 page for S^1 → E → S^2`, () => {
      expect(`${q} -> ${ask(q)}`).toBe(`${q} -> advanced:Serre spectral sequence: S^1 → E → S^2`);
    });
  }
  it("base and fibre keep the order they were written in", () => {
    // S^1 → E → S^2 has an undetermined d2; S^3 → E → S^2 collapses. If the
    // two arguments were swapped, these two would trade answers.
    expect(ask("serre s2 s1")).toContain("S^1 → E → S^2");
    expect(ask("serre s2 s3")).toContain("S^3 → E → S^2");
  });
  it("an unknown space is named as unknown rather than silently dropped", () => {
    expect(ask("serre nonsense s1")).toBe("advanced:Serre spectral sequence");
  });
});

describe("cellular homology and K-theory", () => {
  for (const q of ["cellular rp2", "cellular homology rp2", "cellular homology of rp2"]) {
    it(`"${q}" reaches the CW route`, () => {
      expect(ask(q)).toMatch(/^advanced:Cellular homology/);
    });
  }
  it("k-theory reaches Bott periodicity", () => {
    expect(ask("k-theory S^2")).toBe("advanced:K-theory of S^2");
    expect(ask("k-theory CP^3")).toBe("advanced:K-theory of CP^3");
  });
});

describe("a keyword with a missing argument asks for the argument", () => {
  // Returning null here reads to the user as "I did not understand you", when
  // the truth is "I understood you and need one more thing".
  it("bare cobordism explains what it needs", () => {
    const r = solveTopology("cobordism") as any;
    expect(r).not.toBeNull();
    expect(r.display.join(" ")).toMatch(/Name a manifold/);
    expect(r.caveats.join(" ")).toMatch(/UNORIENTED/);
  });
});

describe("the A1 branches still answer after the reordering", () => {
  it("characteristic classes", () => {
    expect(ask("chern classes of cp2")).toMatch(/advanced:/);
    expect(ask("w(RP^5)")).toMatch(/advanced:/);
  });
  it("cobordism with a manifold", () => {
    expect(ask("does RP^5 bound")).toMatch(/advanced:Unoriented cobordism/);
  });
});
