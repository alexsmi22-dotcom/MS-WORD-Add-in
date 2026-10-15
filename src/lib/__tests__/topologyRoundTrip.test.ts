// DISPLAY IS A CONTRACT — topology output (K, KO, cobordism, Ω groups, stable
// stems, characteristic classes, 𝔽p homology).
//
// Two halves, both over every result string these engines print for a broad
// corpus of questions:
//   1. TYPOGRAPHY: no caret exponents, no ASCII "Z" for the integers, no
//      "RP"/"CP" for ℝP/ℂP — anywhere in title, display, steps or caveats.
//   2. ROUND TRIP: print → read → the same object. Every answer line
//      "LHS = RHS" fed back in returns a result that prints the SAME line; every
//      answer title fed back in returns the same title; every group on the
//      right-hand side parses back (parseGroup) to the group the engine meant;
//      every manifold and space name re-parses to itself.

import { solveTopology } from "../homology";
import {
  parseGroup, typesetGroup, parseSpaceFactor, factorName, normaliseTopologyText, koTheory,
} from "../kReal";
import { kTheory } from "../alexander";
import { parseManifold, cobordismQuery } from "../cobordism";

const CORPUS = [
  // complex K
  "k-theory of a point", "k-theory S^2", "k-theory of s^3", "k-theory of s^65", "k-theory CP^3", "k-theory of cp^1",
  "k-theory of the torus", "k-theory of t^3", "k-theory of s^1 x s^1", "k-theory s^1 x s^2", "k-theory of s^2 x s^2",
  "k-theory of cp^2 x s^1", "k-theory of RP^2", "k-theory of rp^5", "k-theory of rp^1", "k-theory of s^0 x s^0",
  // KO
  "KO of S^1", "KO of S^2", "KO of S^4", "KO of S^8", "KO of S^1000001", "KO-theory of a point", "KO(RP^0)",
  "KO of RP^1", "KO of RP^2", "KO of RP^4", "KO of RP^9", "KO of RP^1000", "KO^1(S^1)", "KO^-1(S^1)", "KO of S^0",
  // cobordism and groups
  "does rp^2 # rp^2 bound", "does the klein bottle bound", "does rp^2 x s^1 bound", "cobordism of rp^2 x rp^2",
  "does cp^2 bound", "oriented cobordism of cp2", "signature of cp^4", "pontryagin numbers of cp^2 x cp^2",
  "does K3 bound", "does wu bound", "oriented cobordism of CP^2 # CP^2bar", "does rp^4 bound", "does rp^5 bound",
  "cobordism of cp^6", "oriented cobordism of S^4 x S^6", "is CP^2 x CP^2 cobordant to CP^4",
  "Omega^SO_0", "Omega^SO_4", "Omega^SO_5", "Omega^SO_8", "Omega^SO_9", "Omega^SO_12", "unoriented cobordism group 5",
  // stems, classes, 𝔽p homology
  "stable pi_3", "stable stem 7", "w(RP^5)", "w(RP^4)", "chern class cp^3",
  "homology of klein bottle over z/3", "homology of klein bottle over F2", "homology of rp2 mod 2",
  "homology of rp2 over F3", "homology of torus over F5",
  "cellular rp2",
];

const results = CORPUS.map((q) => ({ q, r: solveTopology(q) as any }));

describe("every corpus question is answered (never null)", () => {
  for (const { q, r } of results) it(q, () => expect(r).not.toBeNull());
});

describe("TYPOGRAPHY — no caret, ASCII ℤ or RP/CP in any string", () => {
  for (const { q, r } of results) {
    it(q, () => {
      const all: string[] = [r.title, ...(r.display ?? []), ...(r.steps ?? []), ...(r.caveats ?? [])];
      for (const s of all) {
        expect(`${s}`).not.toMatch(/\^/);
        expect(`${s}`).not.toMatch(/(^|[\s(,:=⊕+])Z($|[\s)/,⊕+^0-9])/);
        expect(`${s}`).not.toMatch(/\b[RC]P\d|\b[RC]P\b/);
        expect(`${s}`).not.toMatch(/\bpi_\d/);
      }
    });
  }
});

// Answer lines are "LHS = RHS" where the LHS is a K/KO group, a stem, a class
// or an 𝔽p homology group of a named space: those must read back.
const ANSWER_LINE = /^(K̃?[⁰¹]\(|K̃?O[⁰¹⁻]|π[₀-₉]+ˢ|w\(T|c\(T|Ω[₀-₉]+ˢᴼ|𝔑[₀-₉]+|H[₀-₉]+\((?!the complex))/;

describe("ROUND TRIP — every answer line read back prints the same line", () => {
  let n = 0;
  for (const { q, r } of results) {
    for (const line of (r?.display ?? []) as string[]) {
      if (!ANSWER_LINE.test(line) || !line.includes(" = ")) continue;
      n++;
      it(`${q} ⟶ "${line}"`, () => {
        const back = solveTopology(line) as any;
        expect(back).not.toBeNull();
        expect(back.display).toContain(line);
      });
    }
  }
  it("the corpus produced a meaningful number of answer lines", () => expect(n).toBeGreaterThan(60));
});

describe("ROUND TRIP — every answer title read back gives the same title", () => {
  for (const { q, r } of results) {
    if (!r || /not computed|— |Cellular|^Is /.test(r.title)) continue;
    it(`${q} ⟶ "${r.title}"`, () => {
      const back = solveTopology(r.title) as any;
      expect(back?.title).toBe(r.title);
    });
  }
});

describe("ROUND TRIP — groups: parseGroup(printed) is the group the engine meant", () => {
  it("every right-hand side in the corpus that is a group parses", () => {
    let parsed = 0;
    for (const { r } of results) {
      for (const line of (r?.display ?? []) as string[]) {
        const m = / = ([ℤ0][^,;:.]*)$/.exec(line); // sentences ending "= 0." are prose, not a group
        if (!m || /[a-z]/i.test(m[1])) continue;
        expect(`${line} → ${parseGroup(m[1]) ? "ok" : "UNREAD"}`).toBe(`${line} → ok`);
        parsed++;
      }
    }
    expect(parsed).toBeGreaterThan(40);
  });
  it("typesetGroup and parseGroup agree with the ASCII engines", () => {
    const CASES: [string, string, { free: bigint; torsion: bigint[] }][] = [
      ["Z", "ℤ", { free: 1n, torsion: [] }],
      ["Z^2", "ℤ²", { free: 2n, torsion: [] }],
      ["Z + Z/2", "ℤ ⊕ ℤ/2", { free: 1n, torsion: [2n] }],
      ["Z/2^5", "ℤ/2⁵", { free: 0n, torsion: [32n] }],
      ["Z^10 + Z/3 + Z/4", "ℤ¹⁰ ⊕ ℤ/3 ⊕ ℤ/4", { free: 10n, torsion: [3n, 4n] }],
      ["0", "0", { free: 0n, torsion: [] }],
    ];
    for (const [ascii, typeset, shape] of CASES) {
      expect(typesetGroup(ascii)).toBe(typeset);
      expect(parseGroup(typeset)).toEqual(shape);
      expect(parseGroup(ascii)).toEqual(shape);
    }
    expect(parseGroup("(ℤ/2)³")).toEqual({ free: 0n, torsion: [2n, 2n, 2n] });
    expect(parseGroup("ℤ ⊕ banana")).toBeNull();
  });
  it("a user pasting ℤ² or S² is read", () => {
    expect(parseGroup("ℤ²")).toEqual({ free: 2n, torsion: [] });
    expect(kTheory("S²")!.k0).toBe("ℤ ⊕ ℤ");
    expect(koTheory("KO of S²")!.reducedK0).toBe("ℤ/2");
    expect((solveTopology("k-theory of ℂP² × S¹") as any).display[0]).toBe("K⁰(ℂP² × S¹) = ℤ³");
  });
});

describe("ROUND TRIP — spaces and manifolds re-parse to themselves", () => {
  it("every space factor name", () => {
    const fs = [
      { kind: "point" }, { kind: "sphere", n: 0 }, { kind: "sphere", n: 7 }, { kind: "sphere", n: 1000001 },
      { kind: "rp", n: 4 }, { kind: "cp", n: 12 }, { kind: "torus", n: 3 },
    ] as const;
    for (const f of fs) {
      const name = factorName(f as any);
      const back = parseSpaceFactor(normaliseTopologyText(name).replace(/^a /, ""));
      expect(back).toEqual(f);
    }
  });
  it("every cobordism element name", () => {
    for (const s of [
      "RP^2 # RP^2", "CP^2 # CP^2bar", "rp^2 x rp^2 x s^1", "(CP^2 # CP^2) x S^4", "K3 - CP^2", "wu x T^3",
      "3 CP^2", "S^0 x S^0", "-(CP^2 # K3)", "klein x klein", "CP^2 - (CP^2 # CP^2)",
    ]) {
      const a = parseManifold(s);
      if ("error" in a) throw new Error(a.error);
      const b = parseManifold(a.name);
      if ("error" in b) throw new Error(`${a.name}: ${b.error}`);
      expect(`${s}: ${b.name}`).toBe(`${s}: ${a.name}`);
      expect(String(b.sigma)).toBe(String(a.sigma));
      expect(String(b.chi)).toBe(String(a.chi));
    }
  });
  it("the bare-keyword examples are themselves readable questions", () => {
    for (const q of ["does ℝP² # ℝP² bound", "oriented cobordism of ℂP² × ℂP²", "signature of ℂP⁴", "Ω₅ˢᴼ"]) {
      expect(cobordismQuery(q)!.display.join(" ")).not.toMatch(/not a manifold|Name a manifold/);
    }
  });
});
