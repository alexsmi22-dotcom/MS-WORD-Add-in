/**
 * Abstract algebra (v2.135.0) — INDEPENDENT adversarial review. Every expected
 * value below comes from the reviewer's own oracle (BigInt arithmetic, a
 * brute-force group builder / isomorphism search, a trial-division 𝔽p[x]
 * factoriser), never from the module's helpers.
 *
 *  - plain `it`       — a WRONG answer, a STEAL or a HANG: fails today, passes when fixed.
 *  - `it.failing`     — a refusal where the question is answerable, or a cosmetic
 *                       defect: passes today (the expectation fails); flip to
 *                       `it` when fixed.
 */
import { tryAlgebra } from "../algebra";
import { DiscreteError, DiscreteResult } from "../discrete";
import { tryNumberTheory } from "../numtheory";

const GROSS = 4000;
const timed = <T>(f: () => T): { r: T; ms: number } => {
  const t0 = Date.now();
  const r = f();
  return { r, ms: Date.now() - t0 };
};
const run = (q: string): DiscreteResult => {
  const r = tryAlgebra(q);
  if (!r) throw new Error("not claimed: " + q);
  return r;
};
const all = (r: DiscreteResult): string => [r.title, ...r.display, ...r.steps, ...r.caveats].join("\n");
const outcome = (q: string): { text: string; refused: boolean } => {
  try {
    const r = tryAlgebra(q);
    return { text: r ? all(r) : "NULL", refused: false };
  } catch (err) {
    if (err instanceof DiscreteError) return { text: err.message, refused: true };
    throw err;
  }
};

// ---------------------------------------------------------------------------
// WRONG answers (plain `it`: fail today)

describe("W1: a modulus of more than 40 digits is silently replaced by 10^41 − 1", () => {
  // Either fix is accepted: the right answer, or a refusal BY NAME (a digit cap)
  // that never computes with — or prints — the substituted 99…9 (41 nines).
  const TEN52 = "1" + "0".repeat(52);
  const answeredOrCapped = (q: string, answered: (text: string) => void): void => {
    const { text, refused } = outcome(q);
    expect(text).not.toMatch(/9{41}/);
    if (refused) expect(text).toMatch(/digit|cap|too large|above/i);
    else answered(text);
  };
  it("Z/(2^521 − 1) — a Mersenne PRIME — is a field (engine: 'ℤ/99…9ℤ is NOT a field: 3 · 333… ≡ 0')", () => {
    answeredOrCapped(`is Z/${(2n ** 521n - 1n).toString()} a field`, (t) => { expect(t).not.toMatch(/NOT/); expect(t).toMatch(/is a field/); });
  });
  it("2^200 * 1 mod 10^52 = 2^200 mod 10^52 (engine reduces mod 10^41 − 1 instead)", () => {
    answeredOrCapped(`2^200 * 1 mod ${TEN52}`, (t) => expect(t).toContain((2n ** 200n % 10n ** 52n).toString()));
  });
  it("inverse of 3 in Z/10^52 exists (= (2·10^52 + 1)/3); engine says 'none: gcd(3, 999…9) = 3'", () => {
    answeredOrCapped(`inverse of 3 in Z/${TEN52}`, (t) => expect(t.replace(/,/g, "")).toContain(((2n * 10n ** 52n + 1n) / 3n).toString()));
  });
  it("is 3 a unit in Z/10^52 → yes (engine: no)", () => {
    answeredOrCapped(`is 3 a unit in Z/${TEN52}`, (t) => expect(t).toMatch(/yes/));
  });
  it("solve 3x = 1 in Z/10^52 has a solution (engine: NO solution)", () => {
    answeredOrCapped(`solve 3x = 1 in Z/${TEN52}`, (t) => expect(t).not.toMatch(/NO solution/));
  });
  it("even the group-cap refusal names the wrong group: Z/10^52 → 'ℤ/99…9ℤ has order 99,…,999'", () => {
    expect(outcome(`Z/${TEN52}`).text).not.toMatch(/9{41}/);
  });
});

describe("W5: in a PRIME field GF(p) the name a silently means 0 (a = the class of x in 𝔽p[x]/(x))", () => {
  // GF(7) is displayed as 𝔽₇ = ℤ/7ℤ — it has no element a. Refuse by name; never compute with a = 0.
  it("minimal polynomial of a in GF(7) → refused by name, not 'x … conjugates: a = 0'", () => {
    expect(outcome("minimal polynomial of a in GF(7)").text).not.toMatch(/a = 0/);
  });
  it("order of a in GF(7) → not '0 has no multiplicative order'", () => {
    expect(outcome("order of a in GF(7)").text).not.toMatch(/^0 has no/);
  });
});

describe("W2/W3: 'of order k' after Dₙ is eaten by the dihedral-convention hint", () => {
  it("subgroups of D4 of order 4 → ⟨r⟩, ⟨r², s⟩, ⟨r², rs⟩ in D₄ (engine answers about D₂, the Klein group)", () => {
    const { text } = outcome("subgroups of D4 of order 4");
    expect(text).not.toMatch(/D₂/);
    expect(text).toContain("{e, r, r², r³}");
    expect(text).toContain("{e, r², s, r²s}");
  });
  it("subgroups of D4 of order 2 → only the five of order 2 (engine lists all ten, order-4 ones included)", () => {
    const { text } = outcome("subgroups of D4 of order 2");
    expect(text).not.toContain("{e, r, r², r³}");
    expect(text).not.toMatch(/10 subgroups/);
  });
});

describe("W4: a Cayley table whose first element is named x is refused as 'not a group'", () => {
  it("x y / y x (identity x) is ℤ/2ℤ — engine: 'Closure fails: y · y = \"x\"… not a group'", () => {
    const { text, refused } = outcome("group with cayley table\nx y\ny x");
    expect(refused).toBe(false);
    expect(text).toMatch(/order 2/);
  });
  it("x y z / y z x / z x y is ℤ/3ℤ", () => {
    const { refused } = outcome("cayley table:\nx y z\ny z x\nz x y");
    expect(refused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HANGS (plain `it`: fail today) — a frozen task pane is a frozen Word

describe("H: work bounded by n, not by n × degree / output size", () => {
  it("x^300 + x + 1 = 0 mod 999983 answers or refuses by name in < 4 s (x^1000: 23 s, x^4000 in Z/999983: 91 s)", () => {
    const { ms } = timed(() => outcome("x^300 + x + 1 = 0 mod 999983"));
    expect(ms).toBeLessThan(GROSS);
  }, 120000);
  it("(x + 1)^4096 mod 2 (= x^4096 + 1) in < 4 s and without the engine's own 'Display check failed' (today 7.4 s, then that refusal)", () => {
    const { r, ms } = timed(() => outcome("(x + 1)^4096 mod 2"));
    // Booleans, not the text: today's refusal message is a 3.5 MB echo of the ℤ expansion.
    expect(/Display check failed/.test(r.text)).toBe(false);
    expect(ms).toBeLessThan(GROSS);
  }, 120000);
});

// ---------------------------------------------------------------------------
// REFUSAL where the question is answerable (it.failing: passes today)

describe("R: refused or unclaimed although answerable", () => {
  it("(x + 1)^100 mod 7 → x^100 + 2x^99 + x^98 + 2x^51 + 4x^50 + 2x^49 + x^2 + 2x + 1 (today: 'Display check failed — a defect in this tool', from the over-ℤ aside)", () => {
    expect(run("(x + 1)^100 mod 7").display[0]).toContain("x^100 + 2x^99 + x^98 + 2x^51 + 4x^50 + 2x^49 + x^2 + 2x + 1");
  });
  it("factor x^4 + x + 1 over F_1031 → irreducible (… mod 1031 answers; 'over F_p' for 1024 < p ≤ 10⁶ hits the GF(q) element-list cap)", () => {
    expect(run("factor x^4 + x + 1 over F_1031").display[0]).toMatch(/irreducible over/);
  });
  it("is S3 x Z/3 isomorphic to Z/3 x S3 → isomorphic (swap the factors); today 'cannot be decided'", () => {
    const d = run("is S3 x Z/3 isomorphic to Z/3 x S3").display.join(" ");
    expect(d).not.toMatch(/cannot be decided/);
  });
  it("is GF(9) a field → yes (today: null)", () => {
    expect(run("is GF(9) a field").display[0]).toMatch(/field/);
  });
  it("a^-1 in GF(8) → a^2 + 1 (modulus x³ + x + 1); today 'A negative power is not a polynomial'", () => {
    expect(run("a^-1 in GF(8)").display[0]).toContain("a^2 + 1");
  });
  it("group of units mod 8 → U(8) (the reader's branch is dead: 'group ' is stripped first)", () => {
    expect(run("group of units mod 8").title).toContain("U(8)");
  });
  it("x^2 = 1 mod 8 → x = 1, 3, 5, 7: number theory refuses ('primes only') and algebra's stand-aside leaves it an orphan", () => {
    let text = "";
    try { const r = tryNumberTheory("x^2 = 1 mod 8"); if (r) text = all(r); } catch (err) { if (!(err instanceof DiscreteError)) throw err; }
    if (!/1, 3, 5, 7/.test(text)) text = outcome("x^2 = 1 mod 8").text;
    expect(text).toMatch(/1, 3, 5, 7/);
  });
  it("7 / 2 mod 9 → 8 and 2**10 * 3 mod 7 → 6 (no engine reads / or **, so the Equation kind keeps 'mod' as a variable, §E.2)", () => {
    expect(run("7 / 2 mod 9").display[0]).toMatch(/≡ 8/);
    expect(run("2**10 * 3 mod 7").display[0]).toMatch(/≡ 6/);
  });
});

// ---------------------------------------------------------------------------
// COSMETIC (it.failing: passes today)

describe("C: cosmetic", () => {
  it("'has none elements of order 8' / '1 elements of order 2'", () => {
    expect(run("is Z/4 x Z/4 isomorphic to Z/2 x Z/8").display.join(" ")).not.toMatch(/none elements/);
    expect(run("isomorphism type of Q8").display.join(" ")).not.toMatch(/\b1 elements\b/);
  });
  it("inverse of 0 in Z/1 is right (0 = 1) but prints 'CROSS-CHECK FAILED … a defect in this tool'", () => {
    expect(all(run("inverse of 0 in Z/1"))).not.toMatch(/CROSS-CHECK FAILED/);
  });
  it("is x^2 irreducible over F_2 → 'no: x^2 = x^2' (should show x · x)", () => {
    expect(run("is x^2 irreducible over F_2").display[0]).not.toMatch(/x\^2 = x\^2/);
  });
  it("'Is ℤ/4ℤ a integral domain?'", () => {
    expect(all(run("is Z/4 an integral domain"))).not.toMatch(/a integral/);
  });
  it("quotient names re-read (display contract): 'D₄ / Z' (Z = ℤ?) and 'ℤ/12ℤ / H' are printed but read back as nothing", () => {
    // Fixed by printing names that read back: the centre is Z(D₄) (and a bare Z in a
    // subgroup slot is read as the centre); a typed set is printed as the set, not "H".
    expect(run("D₄ / Z")).toBeTruthy();
    const q1 = run("D4 / center").title.replace(/^Quotient /, "");
    expect(q1).toBe("D₄ / Z(D₄)");
    expect(run(q1).title).toBe("Quotient D₄ / Z(D₄)");
    const q2 = run("Z/12 / {0, 4, 8}").title.replace(/^Quotient /, "");
    expect(q2).toBe("ℤ/12ℤ / {0, 4, 8}");
    expect(run(q2).display[1]).toMatch(/≅ ℤ\/4ℤ/);
    // An undefined name is not invented: "ℤ/12ℤ / H" names no subgroup.
    expect(tryAlgebra("ℤ/12ℤ / H")).toBeNull();
  });
  it("GF(16) multiplication-table figure: 17-character labels widen the grid to ~2300 units, scaled to 460 → ~2.4 px text", () => {
    const svg = run("GF(16) multiplication table").svg!;
    const w = Number(/width="([\d.]+)"/.exec(svg)![1]);
    const vw = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)![1]);
    expect((12 * w) / vw).toBeGreaterThanOrEqual(6);
  });
});
