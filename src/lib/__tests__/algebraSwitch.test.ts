/**
 * The Equation-kind switch for abstract algebra and number theory (v2.134.0):
 * one decision function shared by the pane and the tests (algebraSwitch.ts).
 * Every §D algebra input switches; the number-theory lines that were "mod = 0"
 * switch; ordinary equations — including every string literal in the
 * Equation kind's own test files — do not.
 */
import * as fs from "fs";
import * as path from "path";
import { algebraKindFor, algebraSwitchNote, algebraSwitchReason, ALGEBRA_SWITCH_NOTE, NUMBER_THEORY_SWITCH_NOTE } from "../algebraSwitch";

const SWITCH_ALGEBRA = [
  "Z/6", "ℤ/6ℤ", "Z_6", "Z6", "U(8)", "is U(8) cyclic?", "S3", "Sym(3)", "D4", "D_8", "Z/2 × Z/4", "Z/2 x Z/4", "klein four group", "cayley table of S3",
  "order of 2 in Z/6", "subgroups of Z/12", "lagrange: subgroups of order 4 in Z/12", "cosets of <3> in Z/12", "<4> in Z/12", "quotient Z/12 / <4>",
  "is A3 normal in S3", "center of D4", "conjugacy classes of S4", "is Z/8 isomorphic to Z/2 x Z/4", "Z/6 ≅ Z/2 × Z/3", "find all groups of order 6",
  "(1 2 3)(4 5)", "(1 2 3) * (1 2)", "compose (1 2 3) and (1 2)", "inverse of (1 2 3 4)", "permutation 2 3 1", "[2 3 1]",
  "sigma = (1 2 3), tau = (1 2), sigma * tau", "is f(x) = 2x a homomorphism from Z/4 to Z/8", "kernel of x -> 2x from Z/6 to Z/6",
  "7 * 9 mod 12", "7 + 9 mod 12", "3 * 5 = 1 mod 7", "inverse of 5 in Z/12", "units of Z/12", "is Z/7 a field", "solve 3x = 2 in Z/7",
  "x^2 + 1 = 0 in Z/5", "x^2 + 1 = 0 mod 3", "(x^2 + 1)(x + 2) mod 3", "factor x^2 + 1 over F_2", "is x^2 + 1 irreducible over F_3",
  "gcd of x^3 + 1 and x^2 + 1 over F_2", "GF(9)", "F_9 = F_3[x]/(x^2 + 1)", "minimal polynomial of a^3 in GF(8)", "(a + 1)(2a + 2) in GF(9)",
];
// Refusals switch too: the refusal names the fix, where the Equation kind printed a wrong answer.
it("a Cayley table with its heading switches; named permutations on lines switch", () => {
  expect(algebraKindFor("group with cayley table\ne a b\na b e\nb e a")).toBe("discrete");
  expect(algebraKindFor("sigma = (1 2 3)\ntau = (1 2)\nsigma tau")).toBe("discrete");
});
const SWITCH_REFUSALS = ["subgroups of S6", "GF(6)", "GF(2^11)", "find all groups of order 16", "a^2 = e, b^3 = e", "a * b = e", "(1 2 3)(4 5) in S4", "S3 / {e, (1 2)}"];
const SWITCH_NT = ["order of 3 mod 7", "primitive roots mod 10", "inverse 5 mod 12", "7^100 mod 13", "3^-1 mod 7", "x^2 = 2 mod 7", "17 mod 5", "inverse 4 mod 12", "3x = 2 mod 7"];
const STAY = [
  "x^2 - 5x + 6 = 0", "2x + 3 = 7", "y = 2x + 1", "Z = 6", "S3 = 5", "F_2 = m*a", "z/6 = 3", "x^2 = e", "E = mc^2", "A = pi r^2", "D = b^2 - 4ac",
  "f(x) = x^2 mod 5", "sin(x) = 0.5", "x^2 + y^2 = 25", "factor x^2 + 1", "factor x^2 - 5x + 6", "solve x^2 = 4", "interpolate (1, 2), (2, 3), (4, 7)",
  "derivative of x^3", "limit of sin(x)/x as x -> 0", "F = ma", "V = IR", "PV = nRT", "a + b = c", "(1, 2), (3, 4)", "x = 2 mod",
  "1 0\n0 1", "1 2\n2 1", "0 1 2\n1 2 0\n2 0 1", "(12)", "(1, 2) (2, 3) (4, 7)", "[0, 1]", "klein",
];

describe("switches", () => {
  it.each(SWITCH_ALGEBRA)("algebra: %s", (q) => {
    expect(algebraKindFor(q)).toBe("discrete");
    expect(algebraSwitchNote(q)).toBe(ALGEBRA_SWITCH_NOTE);
  });
  it.each(SWITCH_REFUSALS)("algebra refusal: %s", (q) => {
    expect(algebraSwitchReason(q)).toBe("algebra");
  });
  it.each(SWITCH_NT)("number theory: %s", (q) => {
    expect(algebraKindFor(q)).toBe("discrete");
    expect(algebraSwitchNote(q)).toBe(NUMBER_THEORY_SWITCH_NOTE);
  });
  it.each(STAY)("stays in the Equation kind: %s", (q) => {
    expect(algebraKindFor(q)).toBeNull();
  });
});

/** Every string literal in a TS source (escapes decoded). */
function literals(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    let json = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "\\" && i + 1 < body.length) { const d = body[i + 1]; json += d === "'" || d === "`" || d === "$" ? d : c + d; i++; }
      else if (c === '"') json += '\\"';
      else if (c === "\n") json += "\\n";
      else json += c;
    }
    try { out.push(JSON.parse('"' + json + '"')); } catch { out.push(body); }
  }
  return out.filter((s) => s.trim().length >= 2 && s.length < 3000);
}

/**
 * The Equation kind's own inputs. A literal that switches must be one an
 * algebra or number-theory reader legitimately owns; the list below is every
 * such literal found, each checked by hand (they are maths the Equation kind
 * answered wrongly — "mod = 0" — or display strings of those answers).
 */
const EQUATION_FILES = ["equationSuite.test.ts", "solve.adversarial.test.ts", "solveBaseline.test.ts", "solveDisplayContract.test.ts", "algebraTools.test.ts", "inequalities.test.ts", "systems.test.ts", "wordproblem.test.ts", "pasteMath.test.ts", "interpolate.test.ts"];

describe("no Equation-kind input is stolen", () => {
  for (const f of EQUATION_FILES) {
    it(`literals in ${f}`, () => {
      const p = path.join(__dirname, f);
      if (!fs.existsSync(p)) return;
      const hits: string[] = [];
      for (const s of new Set(literals(fs.readFileSync(p, "utf8")))) {
        const r = algebraSwitchReason(s);
        if (r && !ALLOWED.has(s)) hits.push(`${JSON.stringify(s)} → ${r}`);
      }
      expect(hits).toEqual([]);
    });
  }
});

/** Literals in the Equation kind's tests that legitimately switch (hand-checked). */
const ALLOWED = new Set<string>([]);
