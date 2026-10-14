// Pushdown automata engine — the §D acceptance values of docs/SCOPE-COMPUTATION-THEORY.md
// pinned verbatim, the four move spellings, both acceptance modes, the grammar construction
// against grammar.ts (CYK + derivation search), refusals by name, display contract.

import { solvePda, parsePdaBlock, pdaBlockLines, parseConfig, configStr, runPda, splitInput, PDA_RE, PDA_CAPS } from "../pda";
import { DiscreteError, DiscreteResult } from "../discrete";
import { lines } from "../automata";

const AB = [
  "pda", "states: q0 q1 q2", "alphabet: a b", "stack: Z A", "start: q0", "accept: q2",
  "q0 a Z -> q0 AZ", "q0 a A -> q0 AA", "q0 b A -> q1 ε", "q1 b A -> q1 ε", "q1 ε Z -> q2 Z",
  'test: aabb ab aab ""',
];
const block = (moves: string[], extra: string[] = []): string =>
  ["pda", "states: q0 q1 q2", "alphabet: a b", "stack: Z A", "start: q0", "accept: q2", ...moves, ...extra, 'test: aabb ab aab ""'].join("\n");

const run = (s: string): DiscreteResult => {
  const r = solvePda(s);
  if (!r) throw new Error("engine returned null");
  return r;
};
const all = (r: DiscreteResult): string => [r.title, ...r.display, ...r.steps, ...r.caveats].join("\n");
const refusal = (s: string): string => {
  try {
    solvePda(s);
  } catch (e) {
    expect(e).toBeInstanceOf(DiscreteError);
    return (e as Error).message;
  }
  throw new Error("expected a DiscreteError");
};

describe("§D — the aⁿbⁿ machine by final state", () => {
  const r = run(AB.join("\n"));
  const t = all(r);
  it("says the acceptance mode", () => {
    expect(r.display[0]).toMatch(/acceptance by final state/);
    expect(r.display[0]).toMatch(/^PDA, 3 states/);
    expect(r.display[0]).toMatch(/stack alphabet \{Z,A\}/);
  });
  it("aabb: the configuration table, accepted in 5 moves", () => {
    expect(t).toContain("(q0, aabb, Z) ⊢ (q0, abb, AZ) ⊢ (q0, bb, AAZ) ⊢ (q1, b, AZ) ⊢ (q1, ε, Z) ⊢ (q2, ε, Z)");
    expect(r.display).toContain('"aabb" → accepted in 5 moves (the only branch)');
  });
  it("ab accepted (3 moves)", () => {
    expect(r.display).toContain('"ab" → accepted in 3 moves (the only branch)');
  });
  it("aab rejected, stuck at (q1, ε, AZ)", () => {
    expect(t).toContain("stuck at (q1, ε, AZ): no move");
    expect(r.display.find((l) => l.startsWith('"aab"'))).toMatch(/rejected: every branch died/);
  });
  it('"" REJECTED with the note that aⁿbⁿ includes it', () => {
    expect(r.display.find((l) => l.startsWith("ε →"))).toMatch(/rejected/);
    expect(t).toContain("q0 has no ε-move: this machine does not accept the empty string although aⁿbⁿ includes it");
  });
  it("draws the state diagram (edge labels a, Z/AZ) and the configuration strip", () => {
    expect(r.svg).toMatch(/^<svg/);
    expect(r.svg).toContain("a, Z/AZ");
    expect(r.svg).toContain("ε, Z/Z");
    expect(r.svg).toContain("translate(");
    expect(r.alt).toMatch(/acceptance by final state/);
  });
});

describe("§D — the four move spellings are identical", () => {
  const base = run(AB.join("\n"));
  const variants: [string, (m: string) => string][] = [
    ["(q0, a, Z) -> (q0, AZ)", (m) => { const [f, i, z, , to, push] = m.split(/\s+/); return `(${f}, ${i}, ${z}) -> (${to}, ${push})`; }],
    ["q0, a, Z -> q0, AZ", (m) => { const [f, i, z, , to, push] = m.split(/\s+/); return `${f}, ${i}, ${z} -> ${to}, ${push}`; }],
    ["q0 a Z / AZ -> q0", (m) => { const [f, i, z, , to, push] = m.split(/\s+/); return `${f} ${i} ${z} / ${push} -> ${to}`; }],
    ["δ(q0, a, Z) = (q0, AZ)", (m) => { const [f, i, z, , to, push] = m.split(/\s+/); return `δ(${f}, ${i}, ${z}) = (${to}, ${push})`; }],
  ];
  for (const [name, fn] of variants) {
    it(name, () => {
      const moves = AB.slice(6, 11).map(fn);
      const r = run([...AB.slice(0, 6), ...moves, AB[11]].join("\n"));
      expect(r.display).toEqual(base.display);
    });
  }
});

describe("§D — acceptance by empty stack", () => {
  it("accept: empty stack + q1 ε Z -> q1 ε accepts aabb", () => {
    const r = run(["pda", "states: q0 q1", "alphabet: a b", "stack: Z A", "start: q0", "accept: empty stack",
      "q0 a Z -> q0 AZ", "q0 a A -> q0 AA", "q0 b A -> q1 ε", "q1 b A -> q1 ε", "q1 ε Z -> q1 ε", "test: aabb"].join("\n"));
    expect(r.display[0]).toMatch(/acceptance by empty stack/);
    expect(r.display).toContain('"aabb" → accepted in 5 moves (the only branch)');
    expect(all(r)).toContain("(q1, ε, Z) ⊢ (q1, ε, ε)");
  });
  it("both modes declared → said", () => {
    const r = run(block(["q0 a Z -> q0 AZ", "q0 a A -> q0 AA", "q0 b A -> q1 ε", "q1 b A -> q1 ε", "q1 ε Z -> q2 ε"]).replace("accept: q2", "accept: q2 and empty stack"));
    expect(r.display[0]).toMatch(/acceptance by final state AND empty stack/);
    expect(r.display).toContain('"aabb" → accepted in 5 moves (the only branch)');
  });
});

describe("§D — cfg to pda", () => {
  const r = run("cfg to pda S -> aSb | ε\ntest: aabb");
  const t = all(r);
  it("the one-state PDA, accept by empty stack, the 7-move run", () => {
    expect(r.title).toBe("Context-free grammar → pushdown automaton");
    expect(r.display[0]).toMatch(/^PDA, 1 state/);
    expect(r.display[0]).toMatch(/acceptance by empty stack/);
    expect(t).toContain("(q, aabb, S) ⊢ (q, aabb, aSb) ⊢ (q, abb, Sb) ⊢ (q, abb, aSbb) ⊢ (q, bb, Sbb) ⊢ (q, bb, bb) ⊢ (q, b, b) ⊢ (q, ε, ε)");
    expect(r.display.find((l) => l.startsWith('"aabb"'))).toMatch(/accepted in 7 moves/);
  });
  it("cross-checked against CYK (grammar.ts) and the derivation search", () => {
    // §D says "agrees with CYK on 4 of 4 test strings"; with ONE test string (aabb) the honest count is 1 of 1.
    expect(t).toContain("verified: agrees with CYK on 1 of 1 test string.");
    expect(t).toMatch(/agrees with a leftmost-derivation search on 31 of 31 strings of length ≤ 4/);
    const four = all(run('cfg to pda S -> aSb | ε\ntest: aabb ab aab ""'));
    expect(four).toContain("verified: agrees with CYK on 4 of 4 test strings.");
  });
  it("the grammar spellings and a production on the following lines", () => {
    for (const g of ["cfg to pda S → aSb | λ", "cfg to pda S -> aSb | eps", "to pda S ::= aSb | epsilon", "cfg to pda\nS -> aSb | ε"]) {
      expect(all(run(g + "\ntest: aabb"))).toContain("(q, aabb, S) ⊢ (q, aabb, aSb)");
    }
  });
  it("S -> aSb | ab: terminals a and b separately (not one terminal ab)", () => {
    const x = run("cfg to pda S -> aSb | ab\ntest: aabb ab abab");
    // S ⇒ aSb ⇒ aabb: expand S, match a, expand S → ab, match a, b, b = 6 moves.
    expect(x.display.find((l) => l.startsWith('"aabb"'))).toMatch(/accepted in 6 moves/);
    expect(x.display.find((l) => l.startsWith('"ab"'))).toMatch(/accepted/);
    expect(x.display.find((l) => l.startsWith('"abab"'))).toMatch(/rejected/);
    expect(all(x)).toContain("verified: agrees with CYK on 3 of 3 test strings.");
  });
});

describe("§D — the template and design refusals", () => {
  it("pda for a^n b^n → the template printed, then run", () => {
    const r = run("pda for a^n b^n\ntest: aabb ab aab \"\"");
    const t = all(r);
    expect(t).toContain("The machine used (a template, not a design computed from the language):");
    expect(t).toContain("  q0 a Z → q0 AZ");
    expect(t).not.toMatch(/->/);
    expect(r.display).toContain('"aabb" → accepted in 5 moves (one of 2 branches)');
    expect(r.display.find((l) => l.startsWith('"aab"'))).toMatch(/rejected/);
    expect(r.display.find((l) => l.startsWith("ε →"))).toMatch(/accepted/);
    expect(t).not.toMatch(/more than one unknown/);
  });
  it("aⁿbⁿ spellings", () => {
    for (const s of ["pda for aⁿbⁿ", "pda for {a^n b^n | n >= 0}", "pda for a^n b^n"]) expect(run(s).title).toBe("Pushdown automaton");
  });
  it("pda for palindromes over {a,b} → refusal by name", () => {
    expect(refusal("pda for palindromes over {a,b}")).toMatch(/design is not computed — type the machine|design is not computed; type the machine/);
    expect(refusal("pda for palindromes over {a,b}")).toMatch(/palindromes/);
    expect(refusal("pda for a^n b^2n")).toMatch(/not designed here/);
  });
  it("undeclared stack symbol B → refusal naming B", () => {
    const msg = refusal(AB.join("\n").replace("q0 a Z -> q0 AZ", "q0 a Z -> q0 BZ"));
    expect(msg).toMatch(/"B" is not a declared stack symbol/);
  });
  it("a DPDA claim with two moves on one (state, input, top) → refusal", () => {
    const msg = refusal(["dpda", "stack: Z A", "start: q0", "accept: q1", "q0 a Z -> q0 AZ", "q0 a Z -> q1 Z"].join("\n"));
    expect(msg).toMatch(/Claimed deterministic \(dpda\), but q0 has two moves on \(q0, a, Z\)/);
    expect(refusal(["dpda", "stack: Z", "start: q0", "accept: q1", "q0 a Z -> q0 Z", "q0 ε Z -> q1 Z"].join("\n"))).toMatch(/both an ε-move and a move on "a"/);
  });
});

describe("refusals by name", () => {
  it("missing heads", () => {
    expect(refusal("pda\nstack: Z\naccept: q1\nq0 a Z -> q1 Z")).toMatch(/needs a "start: <state>" line/);
    expect(refusal("pda\nstack: Z\nstart: q0\nq0 a Z -> q1 Z")).toMatch(/needs an "accept:" line/);
    expect(refusal("pda\nstart: q0\naccept: q1\nq0 a Z -> q1 Z")).toMatch(/needs a "stack: Z A …" line/);
    expect(refusal("pda")).toMatch(/needs lines after the keyword/);
  });
  it("unknown states and symbols", () => {
    expect(refusal(block(["q0 a Z -> q9 AZ"]))).toMatch(/unknown state "q9"/);
    expect(refusal(block(["q0 c Z -> q0 AZ"]))).toMatch(/input symbol "c", which is not in the alphabet/);
    expect(refusal(block(["q0 a X -> q0 AZ"]))).toMatch(/stack symbol "X", which is not in the stack alphabet/);
    expect(refusal(block(["q0 a Z"]))).toMatch(/is not a move/);
    expect(refusal(block(["q0 a -> q0 AZ"]))).toMatch(/needs three things on the left/);
  });
  it("a test string with a symbol outside the alphabet is not run (said)", () => {
    const r = run(AB.join("\n").replace('test: aabb ab aab ""', "test: abc"));
    expect(r.display).toContain('"abc" → not run (symbol outside the alphabet)');
  });
});

describe("routing guard", () => {
  it("claims keyword-led input and cfg to pda; nothing else", () => {
    for (const s of ["pda", "PDA", "npda", "dpda", "pushdown automaton", "pda for a^n b^n", "cfg to pda S -> aSb", "to pda S -> ab"]) expect(PDA_RE.test(s)).toBe(true);
    for (const s of ["S -> aSb | ε", "p -> q", "dfa", "tm", "update the pdas", "A-B"]) expect(PDA_RE.test(s)).toBe(false);
    expect(solvePda("S -> aSb | ε")).toBeNull();
    expect(solvePda("")).toBeNull();
  });
});

describe("display contract", () => {
  it("the printed block re-parses to the same machine and the same verdicts", () => {
    const r1 = run(AB.join("\n"));
    const at = r1.steps.indexOf("As a block you can paste back:");
    const printed = r1.steps.slice(at + 1).map((l) => l.trim());
    const r2 = run(printed.join("\n"));
    expect(r2.display).toEqual(r1.display);
  });
  it("the cfg-to-pda block re-parses as a typed PDA with the same verdicts", () => {
    const r1 = run('cfg to pda S -> aSb | ε\ntest: aabb ab aab ""');
    const at = r1.steps.indexOf("As a block you can paste back:");
    const r2 = run(r1.steps.slice(at + 1).map((l) => l.trim()).join("\n"));
    const verdicts = (r: DiscreteResult) => r.display.filter((l) => / → /.test(l));
    expect(verdicts(r2)).toEqual(verdicts(r1).filter((l) => / → (accepted|rejected)/.test(l)));
  });
  it("every printed configuration re-reads through parseConfig", () => {
    const p = parsePdaBlock(lines(AB.join("\n")).slice(1), "", false);
    const input = splitInput(p, "aabb") as string[];
    const r = runPda(p, input);
    for (const e of r.path) {
      const text = configStr(p, input, e.config);
      const back = parseConfig(p, text);
      expect(back).not.toBeNull();
      expect(back!.state).toBe(e.config.state);
      expect(back!.input).toEqual(input.slice(e.config.pos));
      expect(back!.stack).toEqual(e.config.stack);
    }
    expect(parseConfig(p, "(q9, ab, Z)")).toBeNull();
    expect(parseConfig(p, "(q0, ab, ZQ)")).toBeNull();
  });
  it("pdaBlockLines round-trips through parsePdaBlock", () => {
    const p = parsePdaBlock(lines(AB.join("\n")).slice(1), "", false);
    const q = parsePdaBlock(pdaBlockLines(p).slice(1), "", false);
    expect([q.states, q.alphabet, q.stack, q.bottom, q.start, q.acceptStates, q.tests]).toEqual([p.states, p.alphabet, p.stack, p.bottom, p.start, p.acceptStates, p.tests]);
    expect(q.moves.map((m) => [m.from, m.input, m.top, m.to, m.push.join("")])).toEqual(p.moves.map((m) => [m.from, m.input, m.top, m.to, m.push.join("")]));
    expect(q.mode).toBe(p.mode);
  });
  it("caps are stated by number", () => {
    const t = all(run(AB.join("\n")));
    expect(t).toContain(`${PDA_CAPS.configurations.toLocaleString("en-US")} configurations`);
    expect(t).toContain(`exceed ${PDA_CAPS.stackDepth} symbols`);
  });
});
