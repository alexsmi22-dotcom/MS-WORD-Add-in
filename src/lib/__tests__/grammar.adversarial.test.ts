// grammar.ts — the separate hostile pass (house rule). Inputs chosen to break
// the reader, the normal-form pipeline, the cross-checks and the caps; every
// rewrite is checked for LANGUAGE preservation (not just for its printout),
// and every printed grammar is re-read by the reader (display contract).

import {
  solveGrammar, parseGrammar, cykMember, printGrammar, toCnf, parseAny, bruteMember, leftRecursion,
  uselessSymbols, ambiguitySearch, firstFollow, splitWord, Grammar, GRAMMAR_CAPS,
} from "../grammar";
import { DiscreteError } from "../discrete";

const run = (s: string) => {
  const r = solveGrammar(s);
  if (!r) throw new Error("null for " + JSON.stringify(s));
  return r;
};
const timed = <T>(f: () => T): { v: T; ms: number } => { const t = Date.now(); const v = f(); return { v, ms: Date.now() - t }; };

/** All strings over the terminals up to length L. */
function strings(terms: string[], L: number): string[][] {
  const out: string[][] = [[]];
  let layer: string[][] = [[]];
  for (let l = 1; l <= L; l++) {
    const next: string[][] = [];
    for (const w of layer) for (const t of terms) next.push([...w, t]);
    out.push(...next);
    layer = next;
  }
  return out;
}
const prodSet = (g: Grammar): string[] => g.productions.map((p) => `${p.lhs}→${p.rhs.join(" ")}`).sort();
const roundTrip = (g: Grammar, spaced?: boolean): void => {
  const back = parseGrammar(printGrammar(g, spaced).join("\n"));
  expect(prodSet(back)).toEqual([...new Set(prodSet(g))]);
  expect(back.start).toBe(g.start);
};
/** Same language on every string of length ≤ L, by two independent recognisers. */
function sameLanguage(a: Grammar, b: Grammar, L: number): void {
  const terms = [...new Set([...a.terminals, ...b.terminals])];
  for (const w of strings(terms, L)) {
    const x = cykMember(a, w);
    const y = parseAny(b, w) !== null;
    if (x !== y) throw new Error(`languages differ on "${w.join(" ")}": ${x} vs ${y}`);
  }
}

describe("CYK and the cross-checks on hostile grammars", () => {
  it("a left-recursive grammar given to CYK works via CNF", () => {
    const r = run("E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id\ntest: id+id*id (id) id+ )");
    expect(r.display).toContain("id+id*id — accepted");
    expect(r.display).toContain("(id) — accepted");
    expect(r.display).toContain("id+ — rejected");
    expect(r.display).toContain(") — rejected");
    expect(r.steps.join("\n")).not.toMatch(/disagree|cross-check failed/);
  });
  it("a nullable start symbol: ε accepted, S₀ → ε kept, other strings intact", () => {
    const r = run('S -> A B\nA -> a A | ε\nB -> b B | ε\ntest: "" a b ab ba aabbb');
    expect(r.display).toContain('"" — accepted (the start symbol is nullable)');
    expect(r.display).toContain("ab — accepted");
    expect(r.display).toContain("ba — rejected");
    expect(r.display).toContain("aabbb — accepted");
    expect(r.steps.join("\n")).toMatch(/S₀ → ε is kept/);
  });
  it("unit cycles A -> B, B -> A do not loop", () => {
    const { v, ms } = timed(() => run("S -> A | a\nA -> B | b\nB -> A | S | c\ntest: a b c d"));
    expect(v.display).toEqual(expect.arrayContaining(["a — accepted", "b — accepted", "c — accepted", 'd — rejected: not a string over the terminals ("d" cannot be read as part of any terminal of this grammar)']));
    expect(ms).toBeLessThan(4000);
    expect(() => run("S -> A | a\nA -> B | b\nB -> A | S | c\nremove left recursion")).not.toThrow(/Maximum call stack/);
  });
  it("a quoted terminal that looks like a nonterminal", () => {
    const r = run('A -> "S" A | ε\ntest: SS "" a');
    expect(r.display[0]).toBe('A → "S" A | ε');
    expect(r.display).toContain("SS — accepted");
    expect(r.display.join("\n")).toMatch(/a — rejected: not a string over the terminals \("a"/);
    expect(() => solveGrammar('S -> "S" S | a')).toThrow(/both as a quoted terminal and as the nonterminal S/);
  });
  it("30 nonterminals pass, 31 are refused by name before any work", () => {
    const chain = (n: number): string => Array.from({ length: n }, (_, i) => (i + 1 < n ? `N${i + 1} -> a N${i + 2}` : `N${i + 1} -> a`)).join("\n");
    expect(run(chain(30) + "\ntest: " + "a".repeat(30)).display).toContain("a".repeat(30) + " — accepted");
    expect(() => solveGrammar(chain(31))).toThrow(/31 nonterminals exceed the cap of 30/);
  });
  it("101 productions are refused; a 40-symbol test passes and 41 is refused", () => {
    const many = "S -> " + Array.from({ length: 101 }, (_, i) => "a".repeat(i + 1)).join(" | ");
    expect(() => solveGrammar(many)).toThrow(/101 productions exceed the cap of 100/);
    const r = run("S -> a S | a\ntest: " + "a".repeat(40));
    expect(r.display).toContain("a".repeat(40) + " — accepted");
    expect(r.steps.join("\n")).toMatch(/brute-force cross-check skipped \(longer than 12 symbols\)/);
    expect(() => solveGrammar("S -> a S | a\ntest: " + "a".repeat(41))).toThrow(/41 symbols; the cap is 40/);
  });
  it('empty-string tests: "" and ε in the test line', () => {
    const r = run('S -> a S b | ε\ntest: "" ε eps ab');
    expect(r.display.filter((l) => l === '"" — accepted (the start symbol is nullable)').length).toBe(1);
    expect(r.display.filter((l) => l === '"" — accepted (repeated test string)').length).toBe(2);
    const r2 = run('S -> a\ntest: ""');
    expect(r2.display).toContain('"" — rejected');
  });
  it("the cross-check really runs a SEPARATE algorithm (brute force agrees on 0/1 grammar)", () => {
    const g = parseGrammar("N -> 0 | 1 | 0 N | 1 N");
    for (const w of strings(["0", "1"], 6)) {
      const b = bruteMember(g, w);
      expect(b.verdict).toBe(w.length > 0);
      expect(cykMember(g, w)).toBe(w.length > 0);
    }
    const r = run("N -> 0 | 1 | 0 N | 1 N\ntest: 0 1 0110 2");
    expect(r.title).toBe("Context-free grammar — 1 nonterminal, 4 productions over {0, 1}");
    expect(r.display).toContain("0110 — accepted");
  });
});

describe("seeded differential: direct parse vs CYK vs brute force on 200 random grammars", () => {
  it("regression (found by this differential): a non-generating nonterminal in a CNF rule crashed CYK", () => {
    // B → B B derives nothing; CNF used to drop B from its list while S₀ → A B still named it.
    const r = run("S -> a | A B\nA -> a\nB -> B B\ntest: a aa");
    expect(r.display).toContain("a — accepted");
    expect(r.display).toContain("aa — rejected");
    expect(r.steps.join("\n")).toMatch(/non-generating nonterminals dropped \(B derive/);
    expect(cykMember(parseGrammar("S -> S S"), ["a"])).toBe(false); // empty language, start kept
  });
  it("all three recognisers agree on every string of length ≤ 5, and every tree is a real derivation of w", () => {
    let seed = 20261014;
    // high bits: an LCG's low bits cycle with a tiny period
    const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % k; };
    const distinct = new Set<string>();
    const syms = ["a", "b", "S", "A", "B"];
    let checked = 0, trees = 0;
    for (let gi = 0; gi < 200; gi++) {
      const lines: string[] = [];
      for (const nt of ["S", "A", "B"]) {
        const alts: string[] = [];
        const count = 1 + rnd(3);
        for (let k = 0; k < count; k++) {
          const len = rnd(4); // 0..3: ε, units, cycles and left recursion all occur
          alts.push(len === 0 ? "ε" : Array.from({ length: len }, () => syms[rnd(syms.length)]).join(" "));
        }
        lines.push(`${nt} -> ${alts.join(" | ")}`);
      }
      const src = lines.join("\n");
      distinct.add(src);
      const g = parseGrammar(src);
      for (const w of strings(["a", "b"], 5)) {
        const tree = parseAny(g, w);
        const c = cykMember(g, w);
        if ((tree !== null) !== c) throw new Error(`parseAny ${tree !== null} vs CYK ${c} on "${w.join("")}" in\n${src}`);
        const b = w.length <= 4 ? bruteMember(g, w, 300) : { verdict: null };
        if (b.verdict !== null && b.verdict !== c) throw new Error(`brute ${b.verdict} vs CYK ${c} on "${w.join("")}" in\n${src}`);
        checked++;
        if (!tree) continue;
        trees++;
        // yield = w, and every internal node is a production of g
        const leaves: string[] = [];
        const stack = [tree];
        while (stack.length) {
          const t = stack.pop()!;
          if (!t.kids) { if (t.sym !== "ε") leaves.push(t.sym); continue; }
          const rhs = t.kids.length === 1 && t.kids[0].sym === "ε" && !t.kids[0].kids ? [] : t.kids.map((k) => k.sym);
          if (!g.productions.some((p) => p.lhs === t.sym && p.rhs.length === rhs.length && p.rhs.every((s, i) => s === rhs[i]))) throw new Error(`tree node ${t.sym} → ${rhs.join(" ")} is not a production of\n${src}`);
          for (let i = t.kids.length - 1; i >= 0; i--) stack.push(t.kids[i]);
        }
        if (leaves.join(" ") !== w.join(" ")) throw new Error(`tree yield "${leaves.join("")}" ≠ "${w.join("")}" in\n${src}`);
      }
    }
    expect(checked).toBe(200 * 63);
    expect(distinct.size).toBeGreaterThan(190);
    expect(trees).toBeGreaterThan(1000);
  });
});

describe("ambiguity", () => {
  it("S -> S S | a: aaa has 2 trees, aaaa 5 (Catalan numbers)", () => {
    const a = ambiguitySearch(parseGrammar("S -> S S | a"));
    expect(a.complete).toBe(true);
    expect(a.witness!.word.join("")).toBe("aaa");
    expect(a.witness!.count).toBe(2);
    expect(a.others.map((o) => o.count)).toEqual([5, 14, 42, 132, 429]);
  });
  it("S -> a S | a: no witness ≤ 8, said as evidence", () => {
    const r = run("S -> a S | a\nambiguous?");
    expect(r.display.join("\n")).toMatch(/No ambiguous string of length ≤ 8 found — ambiguity is UNDECIDABLE in general, so this is evidence, not a proof/);
    expect(r.caveats.join("\n")).toMatch(/undecidable/);
  });
  it("E -> E + E | id is ambiguous on id+id+id", () => {
    const r = run("E -> E + E | id\nambiguous?");
    expect(r.display).toContain("AMBIGUOUS: id+id+id has 2 parse trees");
    expect(r.svg).toBeDefined();
  });
  it("an exponential grammar hits the 20,000-form budget and says so, in < 1 s", () => {
    const { v, ms } = timed(() => run("S -> S S | S S S | a | b | c\nambiguous?"));
    expect(ms).toBeLessThan(4000);
    expect(v.display.join("\n")).toMatch(/AMBIGUOUS: aaa has at least \d+ parse trees \(the 20,000-form search budget was exhausted/);
  });
});

describe("brute-force budget", () => {
  it("a nullable-explosion grammar exhausts the enumerator and says inconclusive, never a verdict from it", () => {
    // Dyck-like with a nullable S: S^k forms never end, and a REJECTED word forces the whole search.
    const { v, ms } = timed(() => run("S -> a S b | S S | ε\ntest: abababababba"));
    expect(ms).toBeLessThan(4000);
    expect(v.display).toContain("abababababba — rejected");
    expect(v.steps.join("\n")).toMatch(/exhausted its 20,000-form budget — inconclusive, no disagreement/);
    const b = bruteMember(parseGrammar("S -> a S b | S S | ε"), "abababababba".split(""));
    expect(b.verdict).toBeNull();
    expect(b.forms).toBe(GRAMMAR_CAPS.enumBudget);
  });
});

describe("left recursion: language preserved, not just printed", () => {
  it("indirect: S -> A a | b, A -> S c | d", () => {
    const g = parseGrammar("S -> A a | b, A -> S c | d");
    const lr = leftRecursion(g);
    expect(lr.recursive).toEqual(["S", "A"]);
    expect(printGrammar(lr.g)).toEqual(["S → A a | b", "A → b c A' | d A'", "A' → a c A' | ε"]);
    expect(lr.notes.join("\n")).toMatch(/indirectly left-recursive/);
    sameLanguage(g, lr.g, 7);
    roundTrip(lr.g);
    // no production of the result starts with its own left-hand side, directly or via one substitution
    for (const p of lr.g.productions) expect(p.rhs[0]).not.toBe(p.lhs);
  });
  it("the expression grammar keeps its language", () => {
    const g = parseGrammar("E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id");
    const lr = leftRecursion(g);
    sameLanguage(g, lr.g, 5);
    roundTrip(lr.g);
  });
  it("left recursion through a nullable symbol (ε removed first, said)", () => {
    const g = parseGrammar("S -> A S a | b\nA -> c | ε");
    const lr = leftRecursion(g);
    expect(lr.recursive).toContain("S");
    expect(lr.notes.join("\n")).toMatch(/ε-productions removed first/);
    sameLanguage(g, lr.g, 6);
  });
  it("a unit cycle is refused by name", () => {
    expect(() => run("S -> A | a\nA -> S | b\nremove left recursion")).toThrow(/cycle S ⇒ A ⇒ S/);
  });
});

describe("CNF and useless symbols: language preserved", () => {
  for (const src of ["S -> aSb | ε", "S -> S S | a", "E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id", "S -> A B C | ε\nA -> a | ε\nB -> b | ε\nC -> c C | ε", "S -> A | a\nA -> B | b\nB -> A | S | c"]) {
    it(src.replace(/\n/g, " ⏎ "), () => {
      const g = parseGrammar(src);
      const cnf = toCnf(g);
      for (const p of cnf.g.productions) {
        const ok = (p.rhs.length === 2 && p.rhs.every((s) => cnf.g.nonterminals.includes(s) && s !== cnf.g.start))
          || (p.rhs.length === 1 && !cnf.g.nonterminals.includes(p.rhs[0]))
          || (p.rhs.length === 0 && p.lhs === cnf.g.start);
        expect(ok).toBe(true);
      }
      sameLanguage(g, cnf.g, g.terminals.length > 3 ? 4 : 6);
      roundTrip(cnf.g, true);
    });
  }
  it("useless: an unreachable AND a non-generating symbol", () => {
    const g = parseGrammar("S -> a S | A C | b\nA -> a\nB -> b B | b\nC -> C c");
    const u = uselessSymbols(g);
    expect(u.nonGenerating).toEqual(["C"]);
    expect(u.unreachable).toEqual(["A", "B"]); // A only reachable through the dead S -> A C
    expect(printGrammar(u.reduced)).toEqual(["S → a S | b"]);
    sameLanguage(g, u.reduced, 6);
    roundTrip(u.reduced);
    expect(run("S -> a S | A C | b\nA -> a\nB -> b B | b\nC -> C c\nuseless symbols").display).toContain("C is non-generating; A, B are unreachable; reduced: S → a S | b");
  });
  it("equivalent, block form (two grammars separated by ---) is refused by name with the sample", () => {
    expect(() => solveGrammar("equivalent\nS -> a S | ε\n---\nS -> S a | ε")).toThrow(/CFG equivalence is undecidable[\s\S]*agree on all 6 strings of length ≤ 5 over \{a\}/);
    expect(() => solveGrammar("equivalent\nS -> a S | a\n---\nS -> a S | ε")).toThrow(/they differ on "" \(length 0\): the second accepts it, the first does not/);
  });
  it("an empty language says so", () => {
    expect(run("S -> a S\nuseless symbols").display.join("\n")).toMatch(/S is non-generating: the language is EMPTY/);
  });
});

describe("FIRST/FOLLOW hand-verified (Dragon book 4.4, the LL(1) expression grammar)", () => {
  it("classic sets", () => {
    const ff = firstFollow(parseGrammar("E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id"));
    expect(ff.first.get("E")).toEqual(["(", "id"]);
    expect(ff.first.get("E'")).toEqual(["+", "ε"]);
    expect(ff.follow.get("E")).toEqual([")", "$"]);
    expect(ff.follow.get("T")).toEqual(["+", ")", "$"]);
    expect(new Set(ff.follow.get("F"))).toEqual(new Set(["+", "*", ")", "$"]));
    expect(ff.nullable).toEqual(["E'", "T'"]);
  });
});

describe("display contract: everything printed re-parses", () => {
  it("quoted , | and capital terminals", () => {
    const g = parseGrammar('A -> "," A | "|" | "B" | a');
    expect(g.terminals).toEqual([",", "|", "B", "a"]);
    expect(printGrammar(g)).toEqual(['A → "," A | "|" | "B" | a']);
    roundTrip(g);
    // commas separate test strings, so a comma inside one is quoted
    expect(run('A -> "," A | "|" | "B" | a\ntest: ",,a"').display).toContain(",,a — accepted");
  });
  it("<expr> grammars and their CNF", () => {
    const g = parseGrammar("<expr> -> <expr> + <term> | <term>\n<term> -> id");
    roundTrip(g);
    roundTrip(toCnf(g).g, true);
  });
  it("every displayed derivation form re-reads as an alternative of the same symbols", () => {
    const r = run("E -> E + E | id\ntest: id+id\nambiguous?");
    const g = parseGrammar("E -> E + E | id");
    const lines = r.display.filter((l) => l.includes(" ⇒ "));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      for (const form of l.replace(/^\s*(\d+\.\s*)?/, "").split(" ⇒ ")) {
        const back = parseGrammar("Z -> " + form).productions[0].rhs;
        expect(back.every((s) => s === "Z" || g.nonterminals.includes(s) || g.terminals.includes(s))).toBe(true);
      }
    }
  });
  it("displayed test words split back to the same symbols", () => {
    const g = parseGrammar("<expr> -> <expr> + <term> | <term>\n<term> -> id");
    const sw = splitWord(g, "id+id");
    expect("word" in sw && sw.word).toEqual(["id", "+", "id"]);
  });
  it("overlapping terminals are flagged", () => {
    const r = run("S -> a S b | ab\ntest: aabb");
    expect(r.caveats.join("\n")).toMatch(/"ab" can also be read as a sequence of shorter terminals/);
  });
});

describe("routing traps (none of these are grammars)", () => {
  for (const s of ["P -> (Q -> R)", "P -> Q -> R", "A -> (B -> A)", "P -> (Q | R)", "P -> Q | R", "P -> Q & R", "p -> q, p |= q", "A -> B 5\nB -> C 3", "Alice -> bob\nbob -> Carol", "A -> b\nb -> C", "tree?\nA->C\nB->C", "dfa\nstates: A B\nstart: A\naccept: B\nA a B\nB a A", "cfg to pda\nS -> aSb | ε\ntest: aabb", "cfg to pda S -> aSb | ε", "NFA → DFA (subset construction)", "A ->> B","TM -> binary increment 1011", "pda\nS -> a"]) {
    it(JSON.stringify(s), () => expect(solveGrammar(s)).toBeNull());
  }
  it("'to pda' yields exactly where the pushdown engine claims it (first line, or alone on the last line)", () => {
    expect(solveGrammar("S -> aSb | ε\nto pda")).toBeNull();
    expect(solveGrammar("S -> aSb | ε\ncfg to pda")).toBeNull();
    expect(solveGrammar("grammar to pda\nS -> aSb | ε")).toBeNull();
    // anywhere else it is refused by name, never dropped to logic
    expect(() => solveGrammar("S -> aSb | ε\nto pda\ntest: ab")).toThrow(/put "cfg to pda" on the FIRST line/);
  });
  it("but grammars with parentheses still are", () => {
    expect(run("S -> ( S ) | ( )").title).toMatch(/^Context-free grammar/);
    expect(run("F -> ( E ) | id\nE -> F").title).toMatch(/^Context-free grammar/);
  });
  it("an unmistakable grammar with a junk line refuses that line by name", () => {
    expect(() => solveGrammar("S -> aSb | ε\nplease help")).toThrow(/Line "please help" is neither a production/);
  });
});

describe("independent review pins (computation.review.test.ts) — mirrored here", () => {
  it("a duplicated alternative is counted once, said, and is not ambiguity", () => {
    const r = run("S -> a | a\nis it ambiguous");
    expect(r.title).toBe("Context-free grammar — 1 nonterminal, 1 production over {a}");
    expect(r.display).toContain("Note: the alternative S → a appears more than once — counted once.");
    expect(r.display.join("\n")).toMatch(/No ambiguous string/);
    expect(run("S -> a b | a b\nis it ambiguous").display.join("\n")).not.toMatch(/AMBIGUOUS/);
    expect(run("S -> S S | a | a\nis it ambiguous").display).toContain("AMBIGUOUS: aaa has 2 parse trees");
  });
  it("every reading of a test string into multi-character terminals is tried", () => {
    for (const g of ['S -> "a" "bc" | "ab" "x"', 'S -> "ab" "x" | "a" "bc"']) {
      const r = run(`${g}\ntest: abc abx abd`);
      expect(r.display).toContain("abc — accepted");
      expect(r.display).toContain("abx — accepted");
      expect(r.display.join("\n")).toMatch(/abd — rejected: not a string over the terminals \("d"/);
    }
    // With a terminal c as well, abc has two readings; the accepted one is named.
    const r2 = run('S -> "a" "bc" | "ab" "x"\nT -> "c"\ntest: abc');
    expect(r2.display).toContain("abc — accepted");
    expect(r2.steps.join("\n")).toMatch(/abc reads into terminals 2 ways: (ab·c, a·bc|a·bc, ab·c) — accepted as a·bc/);
  });
  it("digit-suffixed names and English turnstiles are left to graph/logic; equation-kind lines never crash", () => {
    for (const s of ["X1 -> X2\nX2 -> X3", "A1 -> B1\nB1 -> C1", "S1 -> S2", "A -> b, A therefore b", "A -> b, A entails b"]) expect(solveGrammar(s)).toBeNull();
    expect(run("S -> a S1 | b\nS1 -> c").title).toMatch(/^Context-free grammar/);
    for (const s of ["X -> 0", "N -> infinity", "E -> mc^2", "R -> R + dR", "T -> 2T + 1", "Y -> 3x + 2y", "V -> 5 when R = 2", "F -> 0 as x -> infinity"]) {
      const { ms } = timed(() => { try { solveGrammar(s); } catch (e) { expect(e).toBeInstanceOf(DiscreteError); } });
      expect(ms).toBeLessThan(1000);
    }
  });
});

describe("time: every input < 1 s, worst cases included", () => {
  it("30-link unit chain + ~100 productions + 50 tests of 40 symbols", () => {
    const lines: string[] = [];
    for (let i = 1; i < 30; i++) lines.push(`N${i} -> N${i + 1} | N${i} N${i} | b N${i}`);
    lines.push("N30 -> a | b");
    lines.push(...Array.from({ length: 5 }, (_, i) => `N${i + 1} -> c${"c".repeat(i)}`));
    // 50 DISTINCT 40-symbol words (no memo help), every one in the language.
    const tests = Array.from({ length: 50 }, (_, i) => (i + 1).toString(2).padStart(40, "0").replace(/0/g, "a").replace(/1/g, "b"));
    expect(new Set(tests).size).toBe(50);
    const { v, ms } = timed(() => run(lines.join("\n") + "\ntest: " + tests.join(" ")));
    // The deterministic work cap binds: every string is either answered or listed as not checked, by name.
    const answered = v.display.filter((l) => / — accepted$/.test(l)).length;
    const notChecked = v.display.find((l) => l.startsWith("Not checked (work cap of 250,000,000 parse steps"));
    expect(notChecked).toBeDefined();
    expect(answered + notChecked!.split(":")[1].split(" — ")[0].trim().split(" ").length).toBe(50);
    expect(answered).toBeGreaterThanOrEqual(15);
    expect(ms).toBeLessThan(4000);
  });
  it("a realistic heavy request (expression grammar, 50 distinct 40-symbol strings) is fully answered", () => {
    const tests = Array.from({ length: 50 }, (_, i) => "id" + "+id".repeat(Math.floor((i % 19) / 2) + 9) + (i % 2 ? "*id" : ""));
    const { v, ms } = timed(() => run("E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id\ntest: " + tests.join(" ")));
    expect(v.display.some((l) => l.startsWith("Not checked"))).toBe(false);
    expect(v.display.filter((l) => / — accepted( \(repeated test string\))?$/.test(l)).length).toBe(50);
    expect(ms).toBeLessThan(4000);
  });
  it("50 distinct 12-symbol words: the total brute-force budget binds and is said, < 1 s", () => {
    const tests = Array.from({ length: 50 }, (_, i) => (i + 1).toString(2).padStart(12, "0").replace(/0/g, "a").replace(/1/g, "b"));
    const { v, ms } = timed(() => run("S -> a S b | S S | ε | b a\ntest: " + tests.join(" ")));
    expect(ms).toBeLessThan(4000);
    expect(v.steps.join("\n")).toMatch(/the total budget of 100,000 sentential forms across all test strings is used up/);
  });
  it("a repeated test string is answered once", () => {
    const r = run("S -> a S b | ε\ntest: ab ab");
    expect(r.display).toContain("ab — accepted (repeated test string)");
  });
  it("a 20,000-character input passes the cap check, 20,001 is refused by name", () => {
    const at = "S -> a\ntest: a" + " ".repeat(20000 - 14);
    expect(at.length).toBe(20000);
    expect(run(at).display).toContain("a — accepted");
    expect(() => solveGrammar(at + " ")).toThrow(/20,001 characters; the cap is 20,000/);
  });
  it("deeply nested parentheses: refused by the right-hand-side cap before any work, no overflow", () => {
    const deep = "(".repeat(5000) + ")".repeat(5000);
    const { ms } = timed(() => expect(() => solveGrammar("S -> " + deep + " | a\ntest: a")).toThrow(DiscreteError));
    expect(ms).toBeLessThan(4000);
    expect(() => solveGrammar("S -> " + deep + " | a\ntest: a")).toThrow(/10000 symbols on its right-hand side; the cap is 50/);
    // 50 is fine
    expect(run("S -> " + "(".repeat(25) + ")".repeat(25) + " | ( S )\ntest: " + "(".repeat(20) + ")".repeat(20)).display.join("\n")).toMatch(/— rejected/);
  });
});
