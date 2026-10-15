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
  // DISPLAY CONTRACT (v2.139.0): the title was "pi_3^s"; it is now typeset
  // π₃ˢ — and the typeset form is itself one of the ways in.
  const WAYS = ["stable pi_3", "stable homotopy 3", "stable stem 3", "pi_3^s", "π₃ˢ"];
  for (const q of WAYS) {
    it(`"${q}" reaches the table`, () => {
      expect(`${q} -> ${ask(q)}`).toBe(`${q} -> advanced:Stable homotopy group π₃ˢ`);
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
    // Display contract: titles typeset the space (was "S^2", "CP^3").
    expect(ask("k-theory S^2")).toBe("advanced:K-theory of S²");
    expect(ask("k-theory CP^3")).toBe("advanced:K-theory of ℂP³");
  });
});

describe("a keyword with a missing argument asks for the argument", () => {
  // Returning null here reads to the user as "I did not understand you", when
  // the truth is "I understood you and need one more thing".
  // FLIPPED TEXT (v2.139.0, §E14): the bare-keyword answer used to say
  // "cobordism is computed here for real projective spaces" with the caveat
  // "Only UNORIENTED cobordism of RP^n is computed". Both are now false — the
  // ring engine takes products, sums and oriented questions — so the pin checks
  // the new examples and that BOTH theories are named.
  it("bare cobordism explains what it needs, naming both theories", () => {
    const r = solveTopology("cobordism") as any;
    expect(r).not.toBeNull();
    expect(r.display.join(" ")).toMatch(/Name a manifold/);
    expect(r.display.join(" ")).toMatch(/ℝP² # ℝP²/);
    expect(r.caveats.join(" ")).toMatch(/UNORIENTED/);
    expect(r.caveats.join(" ")).toMatch(/ORIENTED cobordism by Pontryagin/);
  });
  it("bare KO asks for a space", () => {
    expect(ask("KO")).toBe("advanced:Real K-theory KO");
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

// ---------------------------------------------------------------------------
// v2.139.0 — SCOPE-NUMERICS-TOPOLOGY §A: each phrasing below was WRONG, refused
// for the wrong reason, or returned null ("Couldn't read that as a space").
// ---------------------------------------------------------------------------

const full = (q: string) => solveTopology(q) as any;
const text = (q: string) => {
  const r = full(q);
  return r ? [r.title, ...(r.display ?? [])].join(" | ") : "NULL";
};

describe("WRONG #3: products and connected sums reach the ring engine", () => {
  it("does rp^2 # rp^2 bound → BOUNDS (Klein bottle)", () => {
    expect(text("does rp^2 # rp^2 bound")).toMatch(/Unoriented: ℝP² # ℝP² BOUNDS/);
  });
  it("does rp^2 x s^1 / rp^2 x rp^1 bound → BOUNDS", () => {
    expect(text("does rp^2 x s^1 bound")).toMatch(/BOUNDS/);
    expect(text("does rp^2 x rp^1 bound")).toMatch(/BOUNDS/);
  });
  it("cobordism of rp^2 x rp^2 → the 4-manifold's numbers, not ℝP²'s", () => {
    const r = text("cobordism of rp^2 x rp^2");
    expect(r).toMatch(/ℝP² × ℝP²/);
    expect(r).toMatch(/w₂² = 1/);
  });
  it("stiefel whitney numbers of rp^2 x rp^2 → never the class of one factor", () => {
    expect(text("stiefel whitney numbers of rp^2 x rp^2")).toMatch(/ℝP² × ℝP²/);
    expect(text("w(rp^2 x rp^2)")).toMatch(/product or connected sum — not computed/);
  });
});

describe("returned null before — now answered", () => {
  const CASES: [string, RegExp][] = [
    ["KO of S^1", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["KO(S^1)", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["ko-theory of s^1", /K̃O⁰\(S¹\) = ℤ\/2/],
    ["KO-theory of a point", /KO⁰\(pt\) = ℤ/],
    ["does cp^2 bound", /Oriented: ℂP² does NOT bound/],
    ["signature of cp2", /signature σ = 1/],
    ["pontryagin numbers of cp2", /p₁ = 3/],
    ["does s^2 x s^2 bound", /Oriented: S² × S² BOUNDS/],
    ["does the klein bottle bound", /Unoriented: Klein bottle BOUNDS/],
    ["stiefel whitney numbers of cp2", /w₂² = 1/],
    ["homology of klein bottle over z/3", /𝔽₃/],
    ["homology of klein bottle with coefficients in F3", /𝔽₃/],
    ["homology of rp2 mod 2", /𝔽₂/],
    ["oriented cobordism of cp2", /Oriented cobordism of ℂP²/],
    ["cobordism of cp^2", /ℂP²/],
    ["cobordism group omega_5", /Ω₅ˢᴼ = ℤ\/2/],
  ];
  for (const [q, re] of CASES) {
    it(`"${q}"`, () => expect(text(q)).toMatch(re));
  }
});

describe("WRONG #4/#5 and the refused-for-the-wrong-reason K cases", () => {
  it("k-theory of s^1 x s^1 / s^1 x s^2 → K⁰ = ℤ², K¹ = ℤ²", () => {
    expect(text("k-theory of s^1 x s^1")).toMatch(/K⁰\(S¹ × S¹\) = ℤ² \| K¹\(S¹ × S¹\) = ℤ²/);
    expect(text("k-theory s^1 x s^2")).toMatch(/= ℤ² \| K¹\(S¹ × S²\) = ℤ²/);
  });
  it("real k-theory of s^1 → KO, not complex K", () => {
    expect(text("real k-theory of s^1")).toMatch(/^Real K-theory KO of S¹ \| K̃O⁰\(S¹\) = ℤ\/2/);
  });
  it("k-theory of a point / of point / of the torus", () => {
    expect(text("k-theory of a point")).toMatch(/K⁰\(a point\) = ℤ \| K¹\(a point\) = 0/);
    expect(text("k-theory of point")).toMatch(/K⁰\(a point\) = ℤ/);
    expect(text("k-theory of the torus")).toMatch(/K⁰\(T²\) = ℤ² \| K¹\(T²\) = ℤ²/);
  });
  it("k-theory of s^65 → K̃⁰ = 0, K¹ = ℤ", () => {
    expect(text("k-theory of s^65")).toMatch(/K¹\(S⁶⁵\) = ℤ \| K̃⁰\(S⁶⁵\) = 0/);
  });
  it("must refuse by name: KO^1(RP^3), KO of CP^2, KO of s^1 x s^1", () => {
    expect(text("KO^1(RP^3)")).toMatch(/not computed \| .*Atiyah–Hirzebruch/);
    expect(text("KO of CP^2")).toMatch(/Sanderson/);
    expect(text("KO of s^1 x s^1")).toMatch(/Tor terms/);
  });
});

describe("𝔽p simplicial homology by universal coefficients (§D4 twins)", () => {
  it("Klein bottle over 𝔽₂: 1, 2, 1; over 𝔽₃: 1, 1, 0", () => {
    expect(text("homology of klein bottle over F2")).toMatch(/Betti numbers over 𝔽₂: 1, 2, 1/);
    expect(text("homology of klein bottle over z/3")).toMatch(/Betti numbers over 𝔽₃: 1, 1, 0/);
  });
  it("ℝP² over 𝔽₂: 1, 1, 1; over 𝔽₃: 1, 0, 0", () => {
    expect(text("homology of rp2 mod 2")).toMatch(/Betti numbers over 𝔽₂: 1, 1, 1/);
    expect(text("homology of rp2 over F3")).toMatch(/Betti numbers over 𝔽₃: 1, 0, 0/);
  });
  it("torus over any p: 1, 2, 1", () => {
    for (const p of [2, 3, 5, 7]) expect(text(`homology of torus over F${p}`)).toMatch(/: 1, 2, 1/);
  });
  it("over ℤ: unchanged", () => {
    const r = full("homology of klein bottle over Z");
    expect(r.kind).toBe("homology");
    expect(r.groups).toEqual(full("klein bottle").groups);
  });
  it("refused by name: mod 4 (not a field), over F9 (not prime), over F46349 (cap)", () => {
    expect(text("homology of klein bottle mod 4")).toMatch(/not a field/);
    expect(text("homology of klein bottle over F9")).toMatch(/𝔽₉|not prime|prime/);
    expect(text("homology of klein bottle over F46349")).toMatch(/46[ ,]?337|cap|exact/);
  });
});

describe("WRONG #6: a pasted cloud keeps its header (C's parsePersistenceRequest)", () => {
  const cloud = Array.from({ length: 12 }, (_, k) => `${Math.cos((2 * Math.PI * k) / 12).toFixed(6)} ${Math.sin((2 * Math.PI * k) / 12).toFixed(6)}`).join("\n");
  it("over F3 reaches the outcome as p = 3", () => {
    const r = full(`over F3\n${cloud}`);
    expect(r.kind).toBe("persistence");
    expect(r.p).toBe(3);
  });
  it("no header → p = 2, nothing ignored", () => {
    const r = full(cloud);
    expect(r.p).toBe(2);
    expect(r.ignored).toEqual([]);
  });
  it("an unknown header line is REPORTED in ignored, never dropped", () => {
    const r = full(`my ring data\n${cloud}`);
    expect(r.ignored).toEqual(["my ring data"]);
  });
  it("mod 4 on a cloud is a refusal by name, not an 𝔽₂ answer", () => {
    const r = full(`mod 4\n${cloud}`);
    expect(r.kind).toBe("advanced");
    expect(r.display.join(" ")).toMatch(/not a field/);
  });
  it("scale and compare headers are carried", () => {
    const r = full(`scale 2\ncompare\n${cloud}`);
    expect(r.maxScale).toBe(2);
    expect(r.compare).toBe(true);
  });
  it("ragged digit-only rows still fall through to an explicit complex", () => {
    expect(ask("0,1,2; 1,2")).toMatch(/^homology:/);
  });
});
