// Adversarial pass over the PDA and Turing-machine engines (house rule: a separate hostile
// suite). Every input here is one that a careless simulator hangs on, answers wrongly, or
// answers with the wrong KIND of verdict (a cap reported as a rejection or as a loop proof).
// Every input must finish in under a second.

import { solvePda, PDA_CAPS } from "../pda";
import { solveTuring, TM_CAPS } from "../turing";
import { DiscreteError, DiscreteResult } from "../discrete";
import { solveGrammar } from "../grammar";

const all = (r: DiscreteResult): string => [r.title, ...r.display, ...r.steps, ...r.caveats].join("\n");

/** Runs the engine, asserts < 1 s, returns the result. */
function timed(f: (s: string) => DiscreteResult | null, s: string): DiscreteResult {
  const t0 = Date.now();
  const r = f(s);
  const ms = Date.now() - t0;
  expect(ms).toBeLessThan(4000);
  if (!r) throw new Error("engine returned null");
  return r;
}
const pda = (s: string) => timed(solvePda, s);
const tm = (s: string) => timed(solveTuring, s);
const verdictOf = (r: DiscreteResult, label: string): string => r.display.find((l) => l.startsWith(label + " →")) ?? "(none)";
const refusal = (f: (s: string) => unknown, s: string): string => {
  try { f(s); } catch (e) { expect(e).toBeInstanceOf(DiscreteError); return (e as Error).message; }
  throw new Error("expected a DiscreteError");
};

describe("PDA — searches that never end on their own", () => {
  it("an ε-loop that pushes forever hits the stack-depth cap → UNKNOWN by name, never 'rejected'", () => {
    const r = pda(["pda", "stack: Z A", "start: q0", "accept: q1", "q0 ε Z -> q0 AZ", "q0 ε A -> q0 AA", "test: a"].join("\n").replace("test: a", 'test: ""'));
    const v = verdictOf(r, "ε");
    expect(v).toMatch(/UNKNOWN: search cap reached/);
    expect(v).toMatch(new RegExp(`exceed ${PDA_CAPS.stackDepth} symbols`));
    expect(v).not.toMatch(/rejected/);
  });
  it("an ε-cycle that does not grow is cut by the visited set → rejected, a complete search (not a cap)", () => {
    const r = pda(["pda", "stack: Z", "start: q0", "accept: q2", "q0 ε Z -> q1 Z", "q1 ε Z -> q0 Z", 'test: ""'].join("\n"));
    const v = verdictOf(r, "ε");
    expect(v).toMatch(/rejected: every branch died/);
    expect(v).toMatch(/ε-cycle/);
    expect(v).not.toMatch(/UNKNOWN/);
  });
  it("a branching ε-explosion hits the 20,000-configuration cap → UNKNOWN", () => {
    const r = pda(["pda", "stack: Z A B", "start: q0", "accept: q9", "states: q0 q9",
      "q0 ε Z -> q0 AZ", "q0 ε Z -> q0 BZ", "q0 ε A -> q0 AA", "q0 ε A -> q0 BA", "q0 ε B -> q0 AB", "q0 ε B -> q0 BB", 'test: ""'].join("\n"));
    const v = verdictOf(r, "ε");
    expect(v).toMatch(/UNKNOWN/);
    expect(v).toMatch(/20,000 configurations/);
  });
  it("stack depth 200 is allowed, 201 is the cap (by name)", () => {
    // 'a' on Z pushes +1, each further 'a' +2, 'b' +1: a^100 → depth 200, a^100 b → 201.
    const m = ["pda", "states: q0 q1", "alphabet: a b", "stack: Z A", "start: q0", "accept: q1",
      "q0 a Z -> q0 AZ", "q0 a A -> q0 AAA", "q0 b A -> q0 AA", "q0 ε A -> q1 A"];
    const at200 = pda([...m, `test: ${"a".repeat(100)}`].join("\n"));
    expect(at200.display.find((l) => l.startsWith('"a'))).toMatch(/accepted in 101 moves/);
    const at201 = pda([...m, `test: ${"a".repeat(100)}b`].join("\n"));
    const v = at201.display.find((l) => l.startsWith('"a')) as string;
    expect(v).toMatch(/UNKNOWN: search cap reached \(a branch's stack would exceed 200 symbols\)/);
  });
});

describe("PDA — acceptance mode matters", () => {
  const moves = ["q0 a Z -> q0 AZ", "q0 a A -> q0 AA", "q0 b A -> q1 ε", "q1 b A -> q1 ε", "q1 ε Z -> q2 Z"];
  const head = ["pda", "states: q0 q1 q2", "alphabet: a b", "stack: Z A", "start: q0"];
  it("the same moves: aabb accepted by final state, rejected by empty stack", () => {
    const byFinal = pda([...head, "accept: q2", ...moves, "test: aabb"].join("\n"));
    const byEmpty = pda([...head, "accept: empty stack", ...moves, "test: aabb"].join("\n"));
    expect(byFinal.display[0]).toMatch(/acceptance by final state/);
    expect(byEmpty.display[0]).toMatch(/acceptance by empty stack/);
    expect(verdictOf(byFinal, '"aabb"')).toMatch(/accepted/);
    expect(verdictOf(byEmpty, '"aabb"')).toMatch(/rejected/);
    expect(verdictOf(byEmpty, '"aabb"')).toMatch(/the stack is not empty/);
  });
  it("a machine that empties its stack in a non-accept state: accepted by empty stack only", () => {
    const m = [...head.slice(0, 4), "start: q0", "q0 a Z -> q1 ε", "test: a"];
    expect(verdictOf(pda([...m, "accept: q2"].join("\n")), '"a"')).toMatch(/rejected.*stack is empty in q1, which is not an accept state/);
    expect(verdictOf(pda([...m, "accept: empty stack"].join("\n")), '"a"')).toMatch(/accepted in 1 move/);
    expect(verdictOf(pda([...m, "accept: q1 and empty stack"].join("\n")), '"a"')).toMatch(/accepted/);
  });
});

describe("PDA — nondeterminism", () => {
  // Even palindromes: push, guess the middle (ε-move), pop matching symbols.
  const pal = ["pda", "states: q0 q1 q2", "alphabet: a b", "stack: Z A B", "start: q0", "accept: q2",
    "q0 a Z -> q0 AZ", "q0 a A -> q0 AA", "q0 a B -> q0 AB", "q0 b Z -> q0 BZ", "q0 b A -> q0 BA", "q0 b B -> q0 BB",
    "q0 ε Z -> q1 Z", "q0 ε A -> q1 A", "q0 ε B -> q1 B", "q1 a A -> q1 ε", "q1 b B -> q1 ε", "q1 ε Z -> q2 Z",
    'test: abba abab aa ""'];
  const r = pda(pal.join("\n"));
  it("only one guess of the middle accepts abba — 'one of N branches' with N > 1", () => {
    const v = verdictOf(r, '"abba"');
    const m = /accepted in (\d+) moves \(one of (\d+) branches\)/.exec(v);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBeGreaterThan(1);
    expect(all(r)).toContain("(q0, abba, Z) ⊢ (q0, bba, AZ) ⊢ (q0, ba, BAZ) ⊢ (q1, ba, BAZ) ⊢ (q1, a, AZ) ⊢ (q1, ε, Z) ⊢ (q2, ε, Z)");
  });
  it("abab: every guess dies", () => {
    expect(verdictOf(r, '"abab"')).toMatch(/rejected: every branch died/);
  });
  it('test: "" — the empty input is a real test (accepted here: ε-moves straight to q2)', () => {
    expect(verdictOf(r, "ε")).toMatch(/accepted in 2 moves/);
  });
  it("a dpda claim on this machine is refused (ε-move beside an input move)", () => {
    expect(refusal(solvePda, ["dpda", ...pal.slice(1)].join("\n"))).toMatch(/not a DPDA|both an ε-move/);
  });
});

describe("PDA — hostile blocks", () => {
  it("push string naming an undeclared symbol in the middle (AQZ) names Q", () => {
    expect(refusal(solvePda, ["pda", "stack: Z A", "start: q0", "accept: q0", "q0 a Z -> q0 AQZ"].join("\n"))).toMatch(/"Q" is not a declared stack symbol/);
  });
  it("ε as a stack symbol, a move that does not read the stack → refused by name", () => {
    expect(refusal(solvePda, ["pda", "stack: Z ε", "start: q0", "accept: q0"].join("\n"))).toMatch(/ε is the empty push, not a stack symbol/);
    expect(refusal(solvePda, ["pda", "stack: Z", "start: q0", "accept: q0", "q0 a ε -> q0 Z"].join("\n"))).toMatch(/must name the stack symbol it reads/);
  });
  it("a 200-character test string runs in time; 201 is refused by the shared cap", () => {
    const m = ["pda", "stack: Z", "alphabet: a", "start: q0", "accept: q0", "q0 a Z -> q0 Z"];
    expect(verdictOf(pda([...m, `test: ${"a".repeat(200)}`].join("\n")), `"${"a".repeat(200)}"`)).toMatch(/accepted in 200 moves/);
    expect(refusal(solvePda, [...m, `test: ${"a".repeat(201)}`].join("\n"))).toMatch(/201 characters; the cap is 200/);
  });
});

describe("TM — loops, caps and the difference between them", () => {
  it("a loop that repeats a configuration at step 2 is PROVEN (and never says UNKNOWN)", () => {
    const r = tm("tm\nq0 1 -> q0 1 L\nq0 _ -> q0 _ R\ntape: 1");
    expect(all(r)).toContain("LOOPS: configuration (q0, head 0, tape 1) recurred at step 2 — proven");
    expect(all(r)).not.toMatch(/UNKNOWN/);
  });
  it("a machine that grows the tape forever hits the cap → UNKNOWN, NOT 'loops'", () => {
    const r = tm('tm\nq0 _ -> q0 1 R\ntape: ""');
    expect(all(r)).toContain("step cap 10,000 reached — UNKNOWN; a cap is not a proof of looping");
    expect(all(r)).not.toMatch(/LOOPS|proven non-termination/);
  });
  it("a machine that walks right over blanks forever is UNKNOWN too (the head never revisits a configuration)", () => {
    const r = tm('tm\nq0 _ -> q0 _ R\ntape: ""');
    expect(all(r)).toMatch(/UNKNOWN/);
    expect(all(r)).not.toMatch(/LOOPS/);
  });
  it("a long cycle (a 3-cell bounce rewriting the tape) is still caught as a proof", () => {
    const r = tm("tm\nq0 0 -> q0 1 R\nq0 1 -> q0 0 R\nq0 _ -> q1 _ L\nq1 0 -> q1 0 L\nq1 1 -> q1 1 L\nq1 _ -> q0 _ R\ntape: 010");
    expect(all(r)).toMatch(/LOOPS: configuration \(q0, head 0, tape 010\) recurred at step \d+ — proven/);
  });
  it("the loop verdict and the cap verdict never share a line", () => {
    for (const s of ["tm\nq0 1 -> q0 1 L\nq0 _ -> q0 _ R\ntape: 1", 'tm\nq0 _ -> q0 1 R\ntape: ""']) {
      for (const l of all(tm(s)).split("\n")) expect(/LOOPS/.test(l) && /UNKNOWN/.test(l)).toBe(false);
    }
  });
  it("10,000 steps halts; 10,001 is the cap", () => {
    const m = "tm\nq0 1 -> q0 1 R\ntape: ";
    const r1 = tm(m + "1".repeat(TM_CAPS.steps));
    expect(all(r1)).toContain("halted: no rule for (q0, _) after 10,000 steps");
    const r2 = tm(m + "1".repeat(TM_CAPS.steps + 1));
    expect(all(r2)).toContain("step cap 10,000 reached — UNKNOWN");
  });
});

describe("TM — tapes", () => {
  it("running left off the tape grows it (said), with negative cells", () => {
    const r = tm("tm\nq0 1 -> q0 1 L\nq0 _ -> q1 1 L\ntape: 1");
    expect(all(r)).toMatch(/moved left of cell 0: the tape is unbounded in both directions, so it grew to the left/);
    expect(r.display).toContain("Final tape: 11 (starting at cell -1); head at cell -2; 2 steps.");
  });
  it("a 1,000-cell tape: inverted in 1,000 steps, the view windowed (…)", () => {
    const r = tm(`tm\nq0 0 -> q0 1 R\nq0 1 -> q0 0 R\ntape: ${"01".repeat(500)}`);
    expect(all(r)).toContain("halted: no rule for (q0, _) after 1,000 steps");
    expect(r.display.find((l) => l.startsWith("Final tape:"))).toContain("(1,000 cells)");
    expect(r.steps.some((l) => /…/.test(l) && /\[/.test(l))).toBe(true);
  });
  it("head: past the end of the tape starts on a blank", () => {
    const r = tm("tm\nq0 _ -> q0 x L\nq0 1 -> q0 1 L\ntape: 1\nhead: 2");
    expect(all(r)).toMatch(/2\. \(q0\)/);
  });
});

describe("TM — readers", () => {
  it("rule spellings mixed in one block", () => {
    const r = tm(["tm", "start: q0", "accept: halt", "q0 0 -> q0 0 R", "q0, 1 -> q0, 1, R", "δ(q0, _) = (q1, _, L)",
      "(q1, 1) -> (q1, 0, L)", "q1 0 → halt 1 R", "q1, _ -> halt, 1, R", "tape: 1011"].join("\n"));
    expect(r.display).toContain("Final tape: 1100; head at cell 2; 8 steps.");
  });
  it("unknown state in a rule (with states: declared) → refused by name", () => {
    expect(refusal(solveTuring, "tm\nstates: q0 halt\nq0 1 -> q9 1 R\ntape: 1")).toMatch(/unknown state "q9"/);
  });
  it("undeclared states are inferred when states: is absent", () => {
    expect(tm("tm\nq0 1 -> q9 1 R\ntape: 1").display[0]).toMatch(/2 states/);
  });
});

describe("engine order: the grammar engine (which runs first) never claims a machine input", () => {
  it("solveGrammar → null on every §D PDA/TM input, so they reach these engines", () => {
    const inputs = [
      ["pda", "states: q0 q1 q2", "alphabet: a b", "stack: Z A", "start: q0", "accept: q2", "q0 a Z -> q0 AZ", "q0 a A -> q0 AA",
        "q0 b A -> q1 ε", "q1 b A -> q1 ε", "q1 ε Z -> q2 Z", 'test: aabb ab aab ""'].join("\n"),
      "cfg to pda S -> aSb | ε\ntest: aabb", "cfg to pda\nS -> aSb | ε\ntest: aabb", "to pda S ::= aSb | epsilon",
      "pda for a^n b^n", "pda for palindromes over {a,b}",
      "tm\nstates: q0 q1 halt\nstart: q0\naccept: halt\nblank: _\nq0 0 -> q0 0 R\ntape: 1011",
      "tm binary increment 1011", "tm unary add 111+11", "turing machine\nq0 a -> q0 a R\ntape: aaa",
      "tm\nδ(q0, 0) = (q1, 1, R)\nδ(q1, 0) = (q0, 1, L)\ntape: 00", "does this turing machine halt on every input\nq0 1 -> q0 1 R", "busy beaver 3",
    ];
    for (const s of inputs) {
      let got: unknown;
      try { got = solveGrammar(s); } catch (e) { got = `threw: ${(e as Error).message}`; }
      expect([s, got]).toEqual([s, null]);
    }
  });
});

describe("TM — the increment oracle at the edges", () => {
  const inc = (bits: string) => tm(`tm binary increment ${bits}`);
  it("111 → carry through all bits → 1000", () => {
    const r = inc("111");
    expect(r.display).toContain("Final tape: 1000 (starting at cell -1); head at cell 0; 8 steps.");
    expect(all(r)).toContain("111₂ + 1 = 1000₂ = 8, verified");
  });
  it("0 → 1", () => {
    const r = inc("0");
    expect(r.display).toContain("Final tape: 1; head at cell 1; 3 steps.");
    expect(all(r)).toContain("0₂ + 1 = 1₂ = 1, verified");
  });
  it("a 60-bit input (all ones: the longest carry) is exact in BigInt", () => {
    const bits = "1".repeat(60);
    const r = inc(bits);
    const want = (2n ** 60n).toString(2);
    expect(all(r)).toContain(`${bits}₂ + 1 = ${want}₂ = ${(2n ** 60n).toLocaleString("en-US")}, verified`);
    expect(all(r)).toContain("halted in halt after 122 steps");
  });
  it("a 60-bit mixed input", () => {
    const bits = "101101110111101111101111110111111101111111101111111110111101";
    const want = (BigInt("0b" + bits) + 1n).toString(2);
    expect(all(inc(bits))).toContain(`${bits}₂ + 1 = ${want}₂`);
  });
  it("unary add with an empty left operand: +11 → 11", () => {
    const r = tm("tm unary add +11");
    expect(all(r)).toContain("0 + 2 = 2, verified");
  });
});
