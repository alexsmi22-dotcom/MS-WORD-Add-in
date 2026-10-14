/**
 * Abstract algebra must not STEAL (v2.134.0). The engine is meant to run
 * FIRST in ENGINES, so every input the other discrete engines own must come
 * back null from tryAlgebra — including the strings those engines' own test
 * files use. This file scans those test files for every string literal and
 * feeds each one to tryAlgebra; a non-null answer (or a refusal) is a steal.
 *
 * It also pins the number-theory boundary in BOTH directions (number theory
 * still answers; algebra returns null) and the Dₙ / derangement split.
 */
import * as fs from "fs";
import * as path from "path";
import { tryAlgebra, ALGEBRA_RE } from "../algebra";
import { tryNumberTheory } from "../numtheory";
import { tryCombinatorics } from "../combinatorics";
import { ENGINES, DiscreteError, foldSuperscripts } from "../discrete";

/**
 * Does any OTHER engine answer or refuse this text? Iterates ENGINES directly
 * (not solveDiscrete), skipping the algebra entry by name, so this test stays
 * correct after the integrator registers { name: "abstract algebra", … } first.
 */
function claimedByOthers(s0: string): boolean {
  const s = foldSuperscripts(s0.replace(/\r/g, "")).trim();
  if (!s) return false;
  for (const e of ENGINES) {
    if (e.name === "abstract algebra") continue;
    try {
      if (e.run(s)) return true;
    } catch (err) {
      if (err instanceof DiscreteError || err instanceof RangeError) return true;
      throw err;
    }
  }
  return false;
}

const DIR = __dirname;
const FILES = [
  "numtheory.test.ts", "combinatorics.test.ts", "recurrence.test.ts", "proplogic.test.ts", "graphs.test.ts", "graphs.hamilton.test.ts",
  "grammar.test.ts", "grammar.adversarial.test.ts", "pda.test.ts", "turing.test.ts", "fol.test.ts", "sat.test.ts", "automata.test.ts",
  "discrete.test.ts", "discrete.adversarial.test.ts",
];

/** Every string literal in a TS source: "…", '…', and `…` without ${}. Escapes decoded. */
function literals(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    // Decode the escapes: re-quote as a JSON string (raw quotes and newlines escaped, \' and \` unescaped).
    let json = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "\\" && i + 1 < body.length) {
        const d = body[i + 1];
        json += d === "'" || d === "`" || d === "$" ? d : c + d;
        i++;
      } else if (c === '"') json += '\\"';
      else if (c === "\n") json += "\\n";
      else json += c;
    }
    let s: string;
    try {
      s = JSON.parse('"' + json + '"');
    } catch {
      s = body;
    }
    if (s.trim().length >= 2 && s.length < 3000) out.push(s);
  }
  return out;
}

/**
 * Number theory's own display lines, typed back. Today propositional logic
 * REFUSES them for the wrong reason (≡ read as ⟺: '"7" is not a propositional
 * variable'); algebra, placed first, answers them as true statements. Pinned
 * below as answered — a deliberate improvement, not a steal.
 */
const IMPROVED = new Set(["7¹⁰⁰ ≡ 9 (mod 13)", "2⁻¹ ≡ 4 (mod 7)", "3⁻¹ ≡ 5 (mod 7)"]);

describe("number theory's printed congruences read back (display contract)", () => {
  for (const s of IMPROVED) {
    it(`${s} → TRUE`, () => {
      expect(tryAlgebra(s)!.display[0]).toMatch(/TRUE/);
    });
  }
});

const timed =<T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 1000) throw new Error(`took ${dt} ms`);
  return r;
};

describe("algebra does not steal other engines' inputs", () => {
  for (const file of FILES) {
    it(`every string literal in ${file} → null`, () => {
      const p = path.join(DIR, file);
      if (!fs.existsSync(p)) return;
      const lits = [...new Set(literals(fs.readFileSync(p, "utf8")))];
      expect(lits.length).toBeGreaterThan(5);
      const steals: string[] = [];
      for (const s of lits) {
        try {
          const r = timed(() => tryAlgebra(s));
          // A claim is a STEAL when another engine owns the text. A line no
          // engine reads (e.g. number theory's own display "7¹⁰⁰ ≡ 9 (mod 13)",
          // which algebra re-reads as a TRUE statement) is not stolen.
          if (r && claimedByOthers(s) && !IMPROVED.has(s)) steals.push(`${JSON.stringify(s)} → ${r.title}: ${r.display[0]}`);
        } catch (err) {
          if (err instanceof RangeError) steals.push(`${JSON.stringify(s)} → RangeError`);
          else if (/took \d+ ms/.test((err as Error).message)) steals.push(`${JSON.stringify(s)} → ${(err as Error).message}`);
          else if (!(err instanceof DiscreteError) || claimedByOthers(s)) steals.push(`${JSON.stringify(s)} → REFUSED: ${(err as Error).message}`);
        }
      }
      expect(steals).toEqual([]);
    });
  }
});

describe("the number-theory boundary, both directions", () => {
  const NT: [string, RegExp][] = [
    ["order of 3 mod 7", /6/], ["primitive roots mod 10", /3/], ["inverse 5 mod 12", /5/], ["7^100 mod 13", /9/],
    ["3^-1 mod 7", /5/], ["x^2 = 2 mod 7", /3|4/], ["5 = 2 mod 3", /TRUE/], ["17 mod 5", /2/],
  ];
  for (const [q, want] of NT) {
    it(`${q}: number theory answers, algebra stands aside`, () => {
      const nt = tryNumberTheory(q);
      expect(nt).not.toBeNull();
      expect(nt!.display.join(" ")).toMatch(want);
      expect(ALGEBRA_RE.test(q)).toBe(false);
      expect(tryAlgebra(q)).toBeNull();
    });
  }
  it("an operator before mod is algebra", () => {
    for (const q of ["7 * 9 mod 12", "7 + 9 mod 12", "3 * 5 = 1 mod 7", "(x^2 + 1)(x + 2) mod 3"]) {
      expect(ALGEBRA_RE.test(q)).toBe(true);
      expect(tryAlgebra(q)).not.toBeNull();
      expect(tryNumberTheory(q)).toBeNull();
    }
  });
  it("number-theory forms that only look like algebra stay there", () => {
    for (const q of ["gcd 84 36", "3x = 2 mod 7", "3*x = 2 mod 7", "x = 2 mod 3, x = 3 mod 5", "factor 360", "phi 36", "order of 2 mod 7"]) {
      expect(tryAlgebra(q)).toBeNull();
    }
  });
});

describe("D4 is dihedral; d4, D(4) and derangements 4 stay derangements", () => {
  it("D4 and D_4 are the dihedral group", () => {
    expect(tryAlgebra("D4")!.title).toMatch(/D₄ \(order 8/);
    expect(tryAlgebra("D_4")!.title).toMatch(/D₄ \(order 8/);
  });
  it("lower-case and parenthesised forms are not claimed", () => {
    for (const q of ["d4", "D(4)", "derangements 4", "d(4)"]) {
      expect(tryAlgebra(q)).toBeNull();
      expect(tryCombinatorics(q)).not.toBeNull();
    }
  });
});

describe("lagrange is not interpolation here; <> is not an inequality", () => {
  it("pinned inputs reach the engine", () => {
    for (const q of ["lagrange: subgroups of order 4 in Z/12", "lagrange's theorem for Z/12", "cosets of <3> in Z/12", "<4> in Z/12", "kernel of x -> 2x from Z/6 to Z/6", "minimal polynomial of a^3 in GF(8)"]) {
      expect(tryAlgebra(q)).not.toBeNull();
    }
  });
});

describe("equations and ordinary maths are not algebra", () => {
  it("name = number and plain equations stay null", () => {
    for (const q of ["Z = 6", "S3 = 5", "F_2 = m*a", "z/6 = 3", "x^2 - 5x + 6 = 0", "y = 2x + 1", "A = 5", "D = b^2 - 4ac", "2 + 2", "a(n) = a(n-1) + 2, a(0) = 1"]) {
      expect(tryAlgebra(q)).toBeNull();
    }
  });
});
