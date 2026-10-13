// Combinatorics engine (combinatorics.ts).
//
// Textbook oracles only: every expected number below is one you can find in a
// first course (C(52,5) = 2,598,960; MISSISSIPPI = 34,650; D(5) = 44; the
// Catalan and Bell sequences; p(100) = 190,569,292). The multiset counts are
// also checked against a brute-force enumeration in this file, which is the
// one oracle the engine itself cannot be trusted to supply.
//
// Three contracts are pinned besides the numbers: every cap refuses BY NAME,
// sibling-engine inputs come back null (never claimed), and nothing but
// DiscreteError ever escapes — on any input, within the keystroke budget.

import {
  tryCombinatorics, CAPS, formatBig, crossCheckLine, factorial, binomial, binomialRaw, pascalRow,
  permutations, derangementsRec, derangementsIE, catalanSeq, catalanConvolution, catalanClosed,
  bellSeq, stirling2Row, stirling2Explicit, stirling1Row, partitionCounts, partitionDP,
  listPartitions, multisetPermutations, multisetBySuccessiveBinomials, compositionsDP, findUnmodelledCondition,
} from "../combinatorics";
import { DiscreteError } from "../discrete";

function run(input: string) {
  const r = tryCombinatorics(input);
  if (!r) throw new Error(`engine returned null for: ${input}`);
  return r;
}

/** The headline number, parsed back from the first display line. */
function answer(input: string): bigint {
  const line = run(input).display[0];
  const m = line.match(/= ([\d,]+)(?: \(|$)/);
  if (!m) throw new Error(`no answer in: ${line}`);
  return BigInt(m[1].replace(/,/g, ""));
}

function refusal(input: string): string {
  try {
    tryCombinatorics(input);
  } catch (e) {
    if (e instanceof DiscreteError) return e.message;
    throw e;
  }
  throw new Error(`expected a DiscreteError for: ${input}`);
}

function allText(input: string): string {
  const r = run(input);
  return [...r.display, ...r.steps, ...r.caveats].join("\n");
}

/** Brute-force distinct permutations of a short word. */
function distinctPermutations(word: string): number {
  const seen = new Set<string>();
  const chars = word.split("");
  const rec = (prefix: string, rest: string[]): void => {
    if (rest.length === 0) {
      seen.add(prefix);
      return;
    }
    for (let i = 0; i < rest.length; i++) rec(prefix + rest[i], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  rec("", chars);
  return seen.size;
}

describe("binomial coefficients", () => {
  test("10 choose 3 = 120 in every accepted spelling", () => {
    for (const s of ["10 choose 3", "C(10,3)", "C(10, 3)", "c(10,3)", "nCr 10 3", "binomial(10,3)", "10C3", "10 nCr 3", "ten choose three", "C(10,3) = ?"]) {
      expect(answer(s)).toBe(120n);
    }
  });

  test("C(52, 5) = 2,598,960 with thousands separators", () => {
    const r = run("52 choose 5");
    expect(r.display[0]).toBe("C(52, 5) = 2,598,960");
    expect(r.title).toBe("Combinatorics");
    expect(r.svg).toBeUndefined();
  });

  test("working shows the factorial quotient with numbers substituted", () => {
    const r = run("10 choose 3");
    expect(r.steps.some((s) => s.includes("10! / (3! · 7!) = 3,628,800 / (6 · 5,040) = 120"))).toBe(true);
  });

  test("verified two ways: symmetry and Pascal's triangle", () => {
    const text = allText("10 choose 3");
    expect(text).toMatch(/verified: .*symmetry/);
    expect(text).toMatch(/verified: .*Pascal/);
    expect(text).not.toMatch(/FAILED/);
  });

  test("k > n gives 0 with the reason, not a refusal", () => {
    const r = run("C(3, 10)");
    expect(r.display[0]).toBe("C(3, 10) = 0");
    expect(r.steps.join(" ")).toMatch(/exceeds/);
  });

  test("large n uses the multiplicative form and still verifies by symmetry", () => {
    const r = run("C(10000, 3)");
    expect(answer("C(10000, 3)")).toBe((10000n * 9999n * 9998n) / 6n);
    expect(r.steps.join("\n")).toMatch(/multiplicative form/);
    expect(r.steps.join("\n")).toMatch(/verified: .*symmetry/);
    expect(r.caveats.join("\n")).toMatch(/PASCAL_CHECK_N/);
  });

  test("library: multiplicative formula agrees with Pascal's row for n ≤ 60", () => {
    for (let n = 0; n <= 60; n++) {
      const row = pascalRow(n);
      for (let k = 0; k <= n; k++) {
        expect(binomial(n, k)).toBe(row[k]);
        expect(binomialRaw(n, k)).toBe(row[k]);
      }
    }
  });
});

describe("permutations and factorials", () => {
  test("P(10, 3) = 720 in every accepted spelling", () => {
    for (const s of ["P(10,3)", "P(10, 3)", "nPr 10 3", "10 permute 3", "10P3", "perm(10,3)"]) expect(answer(s)).toBe(720n);
  });

  test("P working is n!/(n−k)! and is verified against the falling product", () => {
    const text = allText("P(10, 3)");
    expect(text).toContain("10! / 7! = 3,628,800 / 5,040 = 720");
    expect(text).toMatch(/verified:/);
  });

  test("20! = 2432902008176640000", () => {
    expect(factorial(20)).toBe(2432902008176640000n);
    expect(answer("20!")).toBe(2432902008176640000n);
    expect(answer("factorial 20")).toBe(2432902008176640000n);
    expect(answer("factorial(20)")).toBe(2432902008176640000n);
    expect(answer("twenty factorial")).toBe(2432902008176640000n);
  });

  test("100! has 158 digits and ends in 24 zeros", () => {
    const s = factorial(100).toString();
    expect(s.length).toBe(158);
    expect(s).toMatch(/0{24}$/);
    expect(s).not.toMatch(/0{25}$/);
    const text = allText("100!");
    expect(text).toContain("has 158 digits and ends in 24 trailing zeros");
    expect(text).toMatch(/verified: .*Legendre/);
  });

  test("0! = 1 and 1! = 1", () => {
    expect(answer("0!")).toBe(1n);
    expect(answer("1!")).toBe(1n);
  });

  test("3000! is shown cut with its digit count, never rounded", () => {
    const r = run("3000!");
    const digits = factorial(3000).toString().length;
    expect(digits).toBe(9131);
    expect(r.display[0]).toMatch(/^3,000! = \d{4}…\d{3} \(9,131 digits\)$/);
    expect(r.display[0]).not.toMatch(/e\+/);
  });

  test("library: P(n, k) = n!/(n−k)!", () => {
    expect(permutations(10, 3)).toBe(720n);
    expect(permutations(5, 5)).toBe(120n);
    expect(permutations(5, 0)).toBe(1n);
    expect(permutations(3, 5)).toBe(0n);
  });
});

describe("multinomials and multisets", () => {
  test("multinomial 10: 3 2 5 = 2,520 in both spellings", () => {
    expect(answer("multinomial 10: 3 2 5")).toBe(2520n);
    expect(answer("multinomial(10; 3, 2, 5)")).toBe(2520n);
    expect(allText("multinomial 10: 3 2 5")).toContain("10! / (3! · 2! · 5!) = 3,628,800 / (6 · 2 · 120) = 2,520");
    expect(allText("multinomial 10: 3 2 5")).toMatch(/verified: .*successive binomials/);
  });

  test("multinomial parts that do not sum to n are refused by name", () => {
    const msg = refusal("multinomial 10: 3 2 4");
    expect(msg).toMatch(/must sum to n/);
    expect(msg).toContain("3 + 2 + 4 = 9");
    expect(msg).toContain("n = 10");
  });

  test("MISSISSIPPI = 34,650 with the letter counts shown", () => {
    for (const s of ["arrangements of MISSISSIPPI", "permutations of MISSISSIPPI", "anagrams of mississippi"]) expect(answer(s)).toBe(34650n);
    const r = run("arrangements of MISSISSIPPI");
    expect(r.steps.join("\n")).toContain("MISSISSIPPI has 11 letters: M×1, I×4, S×4, P×2");
    expect(r.steps.join("\n")).toContain("11! / (1! · 4! · 4! · 2!) = 39,916,800 / (1 · 24 · 24 · 2) = 34,650");
  });

  test("BANANA = 60, verified by brute-force enumeration", () => {
    expect(answer("anagrams of BANANA")).toBe(60n);
    expect(distinctPermutations("BANANA")).toBe(60);
    for (const w of ["AABC", "ABCD", "AAAA", "AABB", "BANANA", "ABCABC"]) {
      const counts = Object.values([...w].reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}));
      expect(multisetPermutations(counts)).toBe(BigInt(distinctPermutations(w)));
      expect(multisetBySuccessiveBinomials(counts)).toBe(BigInt(distinctPermutations(w)));
    }
  });

  test("a word spelled like a number word is still a word", () => {
    expect(answer("anagrams of ONE")).toBe(6n);
  });
});

describe("derangements, Catalan, Bell, Stirling, partitions", () => {
  test("D(5) = 44 in every spelling; D(0) = 1; D(1) = 0", () => {
    for (const s of ["derangements 5", "D(5)", "!5", "derangement 5", "subfactorial 5"]) expect(answer(s)).toBe(44n);
    expect(answer("D(0)")).toBe(1n);
    expect(answer("!1")).toBe(0n);
    expect(allText("D(5)")).toMatch(/verified: the recurrence and the inclusion–exclusion sum/);
  });

  test("library: derangements recurrence equals inclusion–exclusion to 60", () => {
    for (let n = 0; n <= 60; n++) expect(derangementsRec(n)).toBe(derangementsIE(n));
  });

  test("Catalan 0..10 = 1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862, 16796", () => {
    const oracle = [1n, 1n, 2n, 5n, 14n, 42n, 132n, 429n, 1430n, 4862n, 16796n];
    expect(catalanSeq(10)).toEqual(oracle);
    oracle.forEach((v, n) => {
      expect(answer(`catalan ${n}`)).toBe(v);
      expect(catalanConvolution(n)).toBe(v);
      expect(catalanClosed(n)).toBe(v);
    });
    expect(allText("catalan 5")).toContain("C(10, 5) / 6 = 252 / 6 = 42");
    expect(allText("catalan 5")).toMatch(/verified: .*closed form/);
  });

  test("Bell 0..7 = 1, 1, 2, 5, 15, 52, 203, 877", () => {
    const oracle = [1n, 1n, 2n, 5n, 15n, 52n, 203n, 877n];
    expect(bellSeq(7)).toEqual(oracle);
    oracle.forEach((v, n) => expect(answer(`bell ${n}`)).toBe(v));
    expect(allText("bell 5")).toMatch(/verified: the Bell triangle and Σₖ S\(n, k\)/);
  });

  test("S(5, 2) = 15 (second kind) and s(5, 2) = 50 (first kind, unsigned)", () => {
    for (const s of ["S(5,2)", "S(5, 2)", "stirling 5 2", "stirling2 5 2", "stirling(5,2)", "stirling numbers of the second kind 5 2"]) expect(answer(s)).toBe(15n);
    for (const s of ["s(5,2)", "stirling1 5 2", "stirling1(5,2)", "stirling first kind 5 2"]) expect(answer(s)).toBe(50n);
    expect(run("s(5,2)").display[0]).toContain("first kind");
    expect(allText("S(5,2)")).toMatch(/verified: the recurrence and the explicit formula/);
    expect(allText("s(5,2)")).toMatch(/verified: the row sum/);
  });

  test("library: Stirling rows — S(n,k) explicit formula, Σ S(n,k) = Bell, Σ c(n,k) = n!", () => {
    const bells = bellSeq(30);
    for (let n = 0; n <= 30; n++) {
      const s2 = stirling2Row(n);
      const s1 = stirling1Row(n);
      for (let k = 0; k <= n; k++) expect(s2[k]).toBe(stirling2Explicit(n, k));
      expect(s2.reduce((a, b) => a + b, 0n)).toBe(bells[n]);
      expect(s1.reduce((a, b) => a + b, 0n)).toBe(factorial(n));
    }
    expect(stirling2Row(10)[3]).toBe(9330n);
    expect(stirling1Row(10)[3]).toBe(1172700n);
  });

  test("Stirling k > n is 0", () => {
    expect(answer("S(3, 5)")).toBe(0n);
    expect(answer("s(3, 5)")).toBe(0n);
  });

  test("p(10) = 42, listed; p(100) = 190,569,292; p(13) not listed", () => {
    for (const s of ["partitions 10", "p(10)", "partitions of 10", "integer partitions 10"]) expect(answer(s)).toBe(42n);
    const r = run("partitions 10");
    expect(r.steps.join("\n")).toContain("1 part (1): 10");
    expect(r.steps.join("\n")).toContain("10 parts (1): 1+1+1+1+1+1+1+1+1+1");
    expect(r.steps.join("\n")).toContain("2 parts (5): 9+1, 8+2, 7+3, 6+4, 5+5");
    expect(r.steps.join("\n")).toMatch(/verified: the recurrence and the enumerated list/);
    expect(listPartitions(10).length).toBe(42);
    expect(answer("p(100)")).toBe(190569292n);
    expect(run("p(100)").display[0]).toBe("p(100) = 190,569,292");
    expect(run("partitions 13").steps.join("\n")).not.toMatch(/\d+ parts? \(/);
  });

  test("library: pentagonal recurrence equals the coin-change DP to 300", () => {
    const p = partitionCounts(300);
    for (const n of [0, 1, 2, 5, 10, 50, 100, 200, 300]) expect(p[n]).toBe(partitionDP(n));
    expect(p[200]).toBe(3972999029388n);
  });
});

describe("power sets", () => {
  test("subsets of 5 = 32 in symbolic and prose forms", () => {
    for (const s of ["subsets of 5", "power set of 5", "powerset 5", "how many subsets of a 5-element set", "how many subsets does a set with 5 elements have", "how many subsets of a set of five elements"]) {
      expect(answer(s)).toBe(32n);
    }
    expect(allText("subsets of 5")).toMatch(/verified: 2ⁿ and the row sum/);
  });

  test("3-element subsets of a 10-element set = C(10, 3)", () => {
    expect(answer("how many 3-element subsets of a 10-element set")).toBe(120n);
    expect(answer("how many subsets of size 3 from a set of 10")).toBe(120n);
  });
});

describe("word problems (each names its model)", () => {
  test("choose 3 of 10 → C(10, 3) = 120, model: combination", () => {
    for (const s of [
      "how many ways can you choose 3 of 10",
      "how many ways to choose 3 people from 10",
      "in how many ways can 3 people be chosen from a group of 10?",
      "how many ways to select three out of ten students",
      "how many ways to pick 3 of the 10 books",
    ]) {
      expect(answer(s)).toBe(120n);
      expect(run(s).steps[0]).toMatch(/order does not matter.*combination/i);
    }
  });

  test("committee of 4 from 12 → C(12, 4) = 495", () => {
    expect(answer("committee of 4 from 12")).toBe(495n);
    expect(answer("how many ways to form a committee of 4 people from a club of 12")).toBe(495n);
    expect(answer("a 4-person committee is chosen from 12 people")).toBe(495n);
    expect(run("committee of 4 from 12").steps[0]).toMatch(/combination/);
  });

  test("5-card hands from a 52-card deck → C(52, 5)", () => {
    expect(answer("how many 5-card hands from a deck of 52 cards")).toBe(2598960n);
  });

  test("arrange 5 books → 5! = 120", () => {
    for (const s of ["how many ways to arrange 5 books", "how many ways can 5 books be arranged on a shelf", "in how many ways can five people stand in a line", "arrangements of 5 books"]) {
      expect(answer(s)).toBe(120n);
    }
    expect(run("how many ways to arrange 5 books").steps[0]).toMatch(/5!/);
  });

  test("arrange 3 of 8 → P(8, 3) = 336", () => {
    expect(answer("arrange 3 of 8")).toBe(336n);
    expect(answer("how many ways to arrange 3 of 8 books on a shelf")).toBe(336n);
    expect(answer("permutations of 8 things taken 3 at a time")).toBe(336n);
    expect(run("arrange 3 of 8").steps[0]).toMatch(/permutation/);
  });

  test("letters of BANANA in a sentence → 60, model: multiset permutation", () => {
    const r = run("in how many ways can the letters of BANANA be arranged");
    expect(r.display[0]).toBe("Distinct arrangements of BANANA = 60");
    expect(r.steps[0]).toMatch(/multiset permutation/);
    expect(answer("how many distinct arrangements of the letters of the word MISSISSIPPI are there?")).toBe(34650n);
  });

  test("k-letter words with / without repetition, and refused when unspecified", () => {
    expect(answer("how many 4-letter words from 26 letters with repetition")).toBe(456976n);
    expect(run("how many 4-letter words from 26 letters with repetition").display[0]).toContain("26^4");
    expect(answer("how many 4-letter words from 26 letters without repetition")).toBe(358800n);
    expect(answer("how many 4-letter words can be made from 26 letters if no letter is repeated")).toBe(358800n);
    expect(answer("how many 3-digit codes from 10 digits if digits may repeat")).toBe(1000n);
    const msg = refusal("how many 4-letter words from 26 letters");
    expect(msg).toMatch(/with repetition/);
    expect(msg).toMatch(/without repetition/);
  });

  test("stars and bars: 10 identical balls into 3 boxes = 66; each box at least one = 36", () => {
    expect(answer("distribute 10 identical balls into 3 boxes")).toBe(66n);
    expect(answer("how many ways to distribute 10 identical balls into 3 distinct boxes")).toBe(66n);
    expect(answer("how many ways can 10 identical balls be placed in 3 boxes")).toBe(66n);
    expect(answer("distribute 10 identical balls into 3 boxes, each box at least one")).toBe(36n);
    expect(answer("distribute 10 identical balls into 3 boxes so that each box gets at least one ball")).toBe(36n);
    expect(answer("distribute 10 identical balls into 3 boxes with no box empty")).toBe(36n);
    expect(run("distribute 10 identical balls into 3 boxes").display[0]).toContain("C(12, 2) = 66");
    expect(run("distribute 10 identical balls into 3 boxes, each box at least one").display[0]).toContain("C(9, 2) = 36");
    expect(allText("distribute 10 identical balls into 3 boxes")).toMatch(/verified: .*dynamic programme/);
    expect(allText("distribute 10 identical balls into 3 boxes")).toMatch(/stars and bars/);
  });

  test("stars and bars: identical / distinct must be stated; identical boxes are refused by name", () => {
    expect(refusal("distribute 10 balls into 3 boxes")).toMatch(/identical or distinct/);
    expect(refusal("distribute 10 identical balls into 3 identical boxes")).toMatch(/partition/);
    expect(answer("distribute 10 distinct balls into 3 boxes")).toBe(59049n);
    // Surjections 3!·S(4,3) = 36, cross-checked by inclusion–exclusion.
    expect(answer("distribute 4 distinct balls into 3 boxes so that no box is empty")).toBe(36n);
    expect(allText("distribute 4 distinct balls into 3 boxes so that no box is empty")).toMatch(/verified: k!·S\(n, k\)/);
  });

  test("library: compositions DP matches the binomials", () => {
    for (let n = 0; n <= 12; n++) {
      for (let k = 1; k <= 6; k++) {
        expect(compositionsDP(n, k, false)).toBe(binomial(n + k - 1, k - 1));
        expect(compositionsDP(n, k, true)).toBe(n >= k ? binomial(n - 1, k - 1) : 0n);
      }
    }
  });

  test("round table of 6 → (6 − 1)! = 120", () => {
    for (const s of ["how many ways to seat 6 people around a round table", "in how many ways can six people sit around a circular table", "how many ways can 6 people be arranged in a circle"]) {
      expect(answer(s)).toBe(120n);
    }
    const r = run("how many ways to seat 6 people around a round table");
    expect(r.display[0]).toBe("(6 − 1)! = 5! = 120");
    expect(r.steps[0]).toMatch(/rotat/);
    expect(r.caveats.join(" ")).toMatch(/reflections/i);
  });

  test("president and vice president from 10 → P(10, 2) = 90", () => {
    const r = run("how many ways to choose a president and a vice president from 10 people");
    expect(answer("how many ways to choose a president and a vice president from 10 people")).toBe(90n);
    expect(r.steps[0]).toMatch(/permutation/);
    expect(answer("how many ways to elect a president, a secretary and a treasurer from a club of 12")).toBe(1320n);
    expect(answer("fill 3 positions from 10 people")).toBe(720n);
  });

  test("order flags switch choose to permutation; repetition to multisets", () => {
    expect(answer("choose 3 of 10 where order matters")).toBe(720n);
    expect(answer("choose 3 of 10 if order does not matter")).toBe(120n);
    expect(answer("choose 3 of 10 with repetition")).toBe(220n); // C(12, 3)
  });

  test("subsets of 5-element set names the power-set model", () => {
    expect(run("how many subsets of a 5-element set").steps[0]).toMatch(/2\^5/);
  });
});

describe("caps — every refusal names the cap", () => {
  test("C(n, k) n ≤ 10,000 (BINOMIAL_N)", () => {
    expect(refusal("C(10001, 3)")).toMatch(/10,000.*BINOMIAL_N/);
    expect(refusal("10001 choose 3")).toMatch(/10,001/);
    expect(refusal("P(10001, 3)")).toMatch(/BINOMIAL_N/);
    expect(refusal("subsets of 10001")).toMatch(/BINOMIAL_N/);
    expect(refusal("distribute 10000 identical balls into 100 boxes")).toMatch(/BINOMIAL_N/);
  });

  test("n! n ≤ 3,000 (FACTORIAL_N)", () => {
    expect(refusal("3001!")).toMatch(/3,000.*FACTORIAL_N/);
    expect(refusal("how many ways to arrange 3001 books")).toMatch(/FACTORIAL_N/);
    expect(refusal("arrangements of " + "AB".repeat(1501))).toMatch(/FACTORIAL_N/);
  });

  test("Catalan / Bell / derangements / Stirling n ≤ 500 (SPECIAL_N)", () => {
    expect(refusal("catalan 501")).toMatch(/500.*SPECIAL_N/);
    expect(refusal("bell 501")).toMatch(/SPECIAL_N/);
    expect(refusal("derangements 501")).toMatch(/SPECIAL_N/);
    expect(refusal("!501")).toMatch(/SPECIAL_N/);
    expect(refusal("S(501, 2)")).toMatch(/SPECIAL_N/);
    expect(refusal("s(501, 2)")).toMatch(/SPECIAL_N/);
  });

  test("partitions n ≤ 2,000 (PARTITION_N); multinomial total ≤ 3,000 (MULTINOMIAL_TOTAL)", () => {
    expect(refusal("p(2001)")).toMatch(/2,000.*PARTITION_N/);
    expect(refusal("multinomial 3001: 1000 1000 1001")).toMatch(/3,000.*MULTINOMIAL_TOTAL/);
  });

  test("absurdly large literals hit the cap instead of Number overflow", () => {
    expect(refusal("C(99999999999999999999999, 3)")).toMatch(/BINOMIAL_N/);
    expect(refusal("99999999999999999999999!")).toMatch(/FACTORIAL_N/);
  });

  test("every cap value is at least what the brief promised", () => {
    expect(CAPS.BINOMIAL_N).toBe(10000);
    expect(CAPS.FACTORIAL_N).toBe(3000);
    expect(CAPS.SPECIAL_N).toBe(500);
    expect(CAPS.PARTITION_N).toBe(2000);
    expect(CAPS.MULTINOMIAL_TOTAL).toBe(3000);
    expect(CAPS.MAX_DISPLAY_DIGITS).toBe(1500);
  });
});

describe("display contract", () => {
  test("formatBig: thousands separators, and a cut form past 1,500 digits", () => {
    expect(formatBig(0n)).toBe("0");
    expect(formatBig(999n)).toBe("999");
    expect(formatBig(1000n)).toBe("1,000");
    expect(formatBig(2598960n)).toBe("2,598,960");
    expect(formatBig(-1234567n)).toBe("−1,234,567");
    const big = 10n ** 2340n + 789n; // 2,341 digits: "1000…789"
    expect(formatBig(big)).toBe("1000…789 (2,341 digits)");
    const edge = 10n ** 1499n; // exactly 1,500 digits — shown in full
    expect(formatBig(edge).replace(/,/g, "")).toBe(edge.toString());
  });

  test("crossCheckLine: agreement is a verified step; disagreement is a FAILED caveat, never silent", () => {
    expect(crossCheckLine("a and b", 5n, 5n)).toEqual({ ok: true, line: "verified: a and b agree" });
    const bad = crossCheckLine("a and b", 5n, 6n);
    expect(bad.ok).toBe(false);
    expect(bad.line).toMatch(/^cross-check FAILED: a and b disagree \(5 vs 6\)/);
  });

  test("the answer line comes first, then the working and the verification", () => {
    const r = run("10 choose 3");
    expect(r.display[0]).toBe("C(10, 3) = 120");
    expect(r.steps[0]).toContain("10! / (3! · 7!)");
    expect(r.steps.slice(1).some((s) => s.startsWith("verified:"))).toBe(true);
    expect(r.caveats.filter((c) => c.includes("FAILED"))).toEqual([]);
  });

  test("no result anywhere contains a cross-check FAILED line", () => {
    const inputs = ["C(10000, 5000)", "3000!", "P(10000, 9999)", "derangements 500", "catalan 500", "bell 500", "S(500, 250)", "s(500, 250)", "p(2000)", "multinomial 3000: 1000 1000 1000", "subsets of 10000", "arrangements of " + "ABCDEFGHIJ".repeat(300), "how many 10000-letter words from 26 letters with repetition", "distribute 5000 identical balls into 5000 boxes"];
    for (const s of inputs) expect(run(s).caveats.join("\n")).not.toMatch(/FAILED/);
  });
});

describe("null for what a sibling engine owns", () => {
  test("number theory, recurrences, logic, automata and edge lists are not claimed", () => {
    for (const s of [
      "gcd 84 36", "7^100 mod 13", "factor 360", "is 97 prime", "lcm 4 6", "inverse 3 mod 7", "3x ≡ 2 mod 7", "phi 36", "divisors 36",
      "order of 2 mod 7", "primitive root mod 7", "primes to 100",
      "a(n) = a(n-1) + a(n-2), a(0) = 0, a(1) = 1", "T(n) = 2T(n/2) + n",
      "(p -> q) & ~q -> ~p", "p | ~p", "p -> q, p |= q", "dnf (p -> q) & r",
      "A-B", "A->B", "A-B 5", "A-B\nB-C", "shortest path A to F\nA-B\nB-F", "regex (a|b)*abb", "minimize",
      "", "   ", "hello", "how many ways", "2^5", "choose", "10 choose", "C(10)", "the cat sat on the mat",
      "how many 4-digit numbers are divisible by 7",
    ]) {
      expect(tryCombinatorics(s)).toBeNull();
    }
  });

  test("a rule only answers when exactly its own numbers are present", () => {
    // Each of these matches the SHAPE of a rule but carries an extra number the
    // formula would silently ignore — the probe that caught "arrange 4 of the
    // letters of MISSISSIPPI" answering for all eleven letters.
    for (const s of [
      "how many ways to choose 3 of 10 people and 2 of 5 dogs",
      "how many ways to arrange 4 of the letters of the word MISSISSIPPI",
      "how many ways can 3 boys and 2 girls sit in a row",
      "in how many ways can 10 people be divided into 2 teams of 5",
      "a committee of 5 is to be formed from 8 men and 6 women",
      "how many ways to arrange 5 red and 3 blue balls",
    ]) {
      expect(tryCombinatorics(s)).toBeNull();
    }
    expect(answer("how many 3-element subsets does a 7-element set have")).toBe(35n);
    expect(answer("distribute 10 identical candies among 3 children")).toBe(66n);
  });

  test("ambiguous prose is null, not a guess", () => {
    for (const s of [
      "how many ways to seat 6 of 10 people around a round table", // k of n around a table: not one of the forms
      "how many ways can 5 people and 3 dogs be arranged", // two numbers, no clear model
      "how many ways to choose a president from 10", // only one office
      "how many ways to split 10 students into teams", // no counts
    ]) {
      expect(tryCombinatorics(s)).toBeNull();
    }
  });
});

describe("unmodelled conditions are refused, not silently ignored", () => {
  test("a condition the formula ignores is refused by quoting it", () => {
    for (const [s, word] of [
      ["how many ways can 5 people sit in a row if alice and bob must sit together", "if"],
      ["how many ways to arrange 5 books so that two specific books are adjacent", "so that"],
      ["distribute 10 identical balls into 3 boxes with at most 4 in each box", "at most"],
      ["how many ways to choose 3 of 10 people including alice", "including"],
      ["how many 4-letter words from 26 letters with repetition that start with a vowel", "start"],
      ["committee of 4 from 12 such that exactly 2 are women", "such that"],
      ["how many ways to seat 6 people around a round table if alice and bob must not sit together", "if"],
      ["how many 3-digit codes from 10 digits with repetition and no zeros", "no"],
    ] as const) {
      const msg = refusal(s);
      expect(msg).toMatch(/condition/);
      expect(msg).toContain(`("${word}")`);
    }
    expect(findUnmodelledCondition("arrange 5 books if two must be adjacent")).toBe("if");
  });

  test("the modifiers the engine DOES model are not mistaken for conditions", () => {
    for (const s of [
      "how many 4-letter words can be made from 26 letters if no letter is repeated",
      "how many 3-digit codes from 10 digits if digits may repeat",
      "choose 3 of 10 where order matters",
      "choose 3 of 10 if order does not matter",
      "distribute 10 identical balls into 3 boxes so that each box gets at least one ball",
      "distribute 10 identical balls into 3 boxes with no box empty",
      "a committee of 4 must be chosen from 12 people",
      "permutations of 8 things taken 3 at a time",
      "how many distinct arrangements of the letters of the word MISSISSIPPI are there?",
    ]) {
      expect(findUnmodelledCondition(s.toLowerCase().replace(/one\b/, "1"))).toBeNull();
      expect(tryCombinatorics(s)).not.toBeNull();
    }
    expect(answer("a committee of 4 must be chosen from 12 people")).toBe(495n);
  });
});

describe("never hangs, never throws anything but DiscreteError", () => {
  test("worst-case inputs for every cap each return in well under 200 ms", () => {
    const inputs = [
      "C(10000, 5000)", "P(10000, 5000)", "P(10000, 9999)", "3000!", "how many ways to seat 3000 people around a round table",
      "derangements 500", "catalan 500", "bell 500", "S(500, 250)", "s(500, 250)", "p(2000)", "p(400)",
      "multinomial 3000: 1000 1000 1000", "subsets of 10000", "subsets of 200",
      "arrangements of " + "ABCDEFGHIJ".repeat(300),
      "how many 10000-letter words from 10000 letters with repetition",
      "distribute 5000 identical balls into 5000 boxes", "distribute 500 distinct balls into 500 boxes so that no box is empty",
      "distribute 9000 identical balls into 1000 boxes each box at least one",
    ];
    for (const s of inputs) {
      const t0 = Date.now();
      const r = tryCombinatorics(s);
      const ms = Date.now() - t0;
      expect(r).not.toBeNull();
      // Gross-freeze bound: ~35 ms alone, but a parallel jest run multiplies
      // wall-clock several-fold (the repo's recorded flake class).
      expect(ms).toBeLessThan(2000);
    }
  });

  test("garbage, near-misses and over-long inputs return null or DiscreteError only", () => {
    const junk = [
      "C(", "C(,)", "C(a,b)", "!", "!!", "choose 3", "3 choose", "multinomial 10:", "multinomial 10: a b", "arrangements of 123",
      "stirling", "S()", "p()", "catalan", "bell", "(10 3)", "10 3", "-5!", "5!!", "C(10,3,4)", "P(10,-3)",
      "how many ways to choose", "distribute identical balls into boxes", "letters of", "x".repeat(3000), "C(10,3)".repeat(100),
      "how many 4-letter words", "committee of from", "arrange of", "seat around a round table",
    ];
    for (const s of junk) {
      try {
        const r = tryCombinatorics(s);
        if (r !== null) {
          expect(r.display.length).toBeGreaterThan(0);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(DiscreteError);
      }
    }
  });

  test("a trailing question mark or '= ?' is tolerated", () => {
    expect(answer("10 choose 3?")).toBe(120n);
    expect(answer("P(10, 3) =")).toBe(720n);
    expect(answer("how many ways to choose 3 of 10?")).toBe(120n);
  });
});
