// Finite automata engine — textbook oracles, refusals by name, figure contract.

import { tryAutomata, accepts, thompson, determinise, minimise, enumerateStrings, AUTOMATA_CAPS, EPS } from "../automata";
import { DiscreteError, DiscreteResult } from "../discrete";

/** The "ends in 11" DFA from the brief. */
const ENDS_IN_11 = `dfa
states: q0 q1 q2
alphabet: 0 1
start: q0
accept: q2
q0 0 q0
q0 1 q1
q1 0 q0
q1 1 q2
q2 0 q0
q2 1 q2`;

/** Even number of 0s: toggle on 0, stay on 1; accept the even state. */
const EVEN_ZEROS = `dfa
states: e o
alphabet: 0 1
start: e
accept: e
e 0 o
e 1 e
o 0 e
o 1 o`;

/** Sipser example 1.38: an NFA with an ε-move whose subset construction has six reachable states
 *  ({1,3} {2} {2,3} {3} {1,2,3} ∅) — worked by hand in the test below. */
const SIPSER_N4 = `nfa
states: 1 2 3
alphabet: a b
start: 1
accept: 1
1 b 2
1 eps 3
2 a 2
2 a 3
2 b 3
3 a 1`;

/** Two copies of each state of the "ends in 11" machine (A,B ≡ q0; C,D ≡ q1; E,F ≡ q2), all
 *  reachable. By hand: round 0 splits {A,B,C,D} from {E,F}; round 1 separates {C,D} (whose 1-move
 *  lands in the accept class) from {A,B}; round 2 changes nothing. Minimal DFA: 3 states. */
const SIX_TO_THREE = `dfa
states: A B C D E F
alphabet: 0 1
start: A
accept: E F
A 0 B
A 1 C
B 0 A
B 1 D
C 0 B
C 1 E
D 0 A
D 1 F
E 0 A
E 1 F
F 0 B
F 1 E`;

const run = (s: string): DiscreteResult => {
  const r = tryAutomata(s);
  if (!r) throw new Error("engine returned null");
  return r;
};
const text = (r: DiscreteResult) => [...r.display, ...r.steps, ...r.caveats].join("\n");
const refusal = (s: string): string => {
  try {
    tryAutomata(s);
  } catch (e) {
    expect(e).toBeInstanceOf(DiscreteError);
    return (e as Error).message;
  }
  throw new Error("expected a DiscreteError");
};

describe("claiming the input", () => {
  test("null for non-automata text", () => {
    expect(tryAutomata("gcd 84 36")).toBeNull();
    expect(tryAutomata("A-B\nB-C")).toBeNull();
    expect(tryAutomata("10 choose 3")).toBeNull();
    expect(tryAutomata("")).toBeNull();
    expect(tryAutomata("   \n  ")).toBeNull();
  });

  test("keywords are case-insensitive and may follow blank lines", () => {
    expect(run("\n\nDFA\n" + ENDS_IN_11.split("\n").slice(1).join("\n")).title).toBe("Finite automaton — DFA");
    expect(run("Regex a*").title).toBe("Regular expression → DFA");
  });

  test("a keyword that is a prefix of another word does not claim", () => {
    expect(tryAutomata("dfault settings")).toBeNull();
    expect(tryAutomata("regexes are fun")).toBeNull();
  });

  test("a bare keyword with nothing after it is a refusal, not a crash", () => {
    expect(refusal("to dfa")).toMatch(/needs an nfa block/);
    expect(refusal("minimize")).toMatch(/needs a dfa block/);
    expect(refusal("equivalent")).toMatch(/exactly two machines/);
    expect(refusal("regex")).toMatch(/needs a pattern/);
    expect(refusal("dfa")).toMatch(/start:/);
  });
});

describe("DFA blocks", () => {
  test("ends in 11: summary, table, runs with the state sequence", () => {
    const r = run(ENDS_IN_11 + '\ntest: 0110 1 "" 1011 11');
    expect(r.display[0]).toContain("DFA, 3 states over {0,1}");
    expect(r.display).toContain('"0110" → reject');
    expect(r.display).toContain('"1" → reject');
    expect(r.display).toContain("ε → reject");
    expect(r.display).toContain('"1011" → accept');
    expect(r.display).toContain('"11" → accept');
    const t = text(r);
    expect(t).toContain('"0110": q0 ─0→ q0 ─1→ q1 ─1→ q2 ─0→ q0 — reject');
    expect(t).toContain('"1011": q0 ─1→ q1 ─0→ q0 ─1→ q1 ─1→ q2 — ACCEPT');
    expect(t).toContain("→ q0: 0 → q0, 1 → q1");
    expect(t).toContain("* q2: 0 → q0, 1 → q2");
  });

  test("even number of 0s", () => {
    const r = run(EVEN_ZEROS + "\ntest: 00 0 1 0101 010");
    expect(r.display).toContain('"00" → accept');
    expect(r.display).toContain('"0" → reject');
    expect(r.display).toContain('"1" → accept');
    expect(r.display).toContain('"0101" → accept');
    expect(r.display).toContain('"010" → accept');
  });

  test("all three transition spellings read the same machine", () => {
    const arrows = `dfa
states: q0 q1 q2
alphabet: 0 1
start: q0
accept: q2
q0 --0--> q0
q0, 1 -> q1
q1 0 -> q0
q1 --1--> q2
q2 0 q0
q2 1 q2
test: 011 10`;
    const r = run(arrows);
    expect(r.display).toContain('"011" → accept');
    expect(r.display).toContain('"10" → reject');
  });

  test("a comma-joined symbol list on one line means several transitions", () => {
    const r = run(`dfa
states: a b
alphabet: 0 1
start: a
accept: b
a 0,1 b
b 0,1 b
test: 0 ""`);
    expect(r.display).toContain('"0" → accept');
    expect(r.display).toContain("ε → reject");
  });

  test("states and alphabet are inferred when not declared", () => {
    const r = run(`dfa
start: p
accept: q
p 0 q
q 0 p
test: 0 00`);
    expect(r.display[0]).toContain("2 states over {0}");
    expect(r.display).toContain('"0" → accept');
    expect(r.display).toContain('"00" → reject');
  });

  test("totality refusal names the state and the symbol", () => {
    const missing = ENDS_IN_11.replace("q1 1 q2\n", "");
    expect(refusal(missing)).toBe('DFA is not total: state q1 has no transition on symbol 1 — add a line "q1 1 <state>" (a DFA needs one transition for every state and symbol).');
  });

  test("a duplicate (state, symbol) with two targets is refused by name", () => {
    expect(refusal(ENDS_IN_11 + "\nq1 1 q0")).toMatch(/State q1 has two transitions on symbol 1 \(to q2 and q0\)/);
  });

  test("an identical repeated transition line is harmless", () => {
    expect(run(ENDS_IN_11 + "\nq1 1 q2").display[0]).toContain("3 states");
  });

  test("unknown state and unknown symbol in a transition are refused by name", () => {
    expect(refusal(ENDS_IN_11 + "\nq2 1 q7")).toMatch(/unknown state "q7"/);
    expect(refusal(ENDS_IN_11.replace("q2 1 q2", "q2 2 q2"))).toMatch(/symbol "2", which is not in the alphabet \{0,1\}/);
  });

  test("ε-moves and unknown start/accept states are refused in a DFA", () => {
    expect(refusal(ENDS_IN_11 + "\nq0 eps q1")).toMatch(/cannot have an ε-move/);
    expect(refusal(ENDS_IN_11.replace("start: q0", "start: z"))).toMatch(/Start state "z"/);
    expect(refusal(ENDS_IN_11.replace("accept: q2", "accept: q9"))).toMatch(/Accept state "q9"/);
  });

  test("41 states are refused by the cap; 40 are not", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
    const block = (n: number) => {
      const st = names(n);
      const lines = [`dfa`, `states: ${st.join(" ")}`, `alphabet: a`, `start: s0`, `accept: s${n - 1}`];
      st.forEach((s, i) => lines.push(`${s} a ${st[(i + 1) % n]}`));
      return lines.join("\n");
    };
    expect(refusal(block(41))).toBe("41 states exceed the cap of 40 states.");
    expect(run(block(40)).display[0]).toContain("40 states");
  });

  test("11 alphabet symbols, a multi-character symbol, and too many tests are refused by name", () => {
    expect(refusal("dfa\nstates: a\nalphabet: 0 1 2 3 4 5 6 7 8 9 x\nstart: a\naccept: a")).toMatch(/11 symbols exceed the cap of 10/);
    expect(refusal("dfa\nstates: a\nalphabet: ab\nstart: a\naccept: a\na ab a")).toMatch(/"ab" must be a single character/);
    const tests = Array.from({ length: 51 }, () => "0").join(" ");
    expect(refusal(ENDS_IN_11 + `\ntest: ${tests}`)).toMatch(/51 test strings exceed the cap of 50/);
    expect(refusal(ENDS_IN_11 + `\ntest: ${"0".repeat(201)}`)).toMatch(/201 characters; the cap is 200/);
  });

  test("a test string with a foreign symbol is reported, not fatal", () => {
    const r = run(ENDS_IN_11 + "\ntest: 012 11");
    expect(r.display).toContain('"012" → not run');
    expect(r.display).toContain('"11" → accept');
    expect(text(r)).toMatch(/symbol "2" is not in the alphabet/);
  });

  test("unreachable states are named", () => {
    const r = run(ENDS_IN_11.replace("states: q0 q1 q2", "states: q0 q1 q2 q3") + "\nq3 0 q3\nq3 1 q3");
    expect(r.display.join("\n")).toMatch(/Unreachable from q0: q3/);
  });

  test("a line that is not a transition is refused by quoting it", () => {
    expect(refusal(ENDS_IN_11 + "\nhello world and more")).toMatch(/Line "hello world and more" is not a transition/);
    expect(refusal(ENDS_IN_11 + "\nq0 -> q1")).toMatch(/has no symbol between the two states/);
  });
});

describe("NFA blocks", () => {
  test("runs show the state sets after each symbol with the ε-closure", () => {
    const r = run(SIPSER_N4 + '\ntest: "" a ba baba');
    const t = text(r);
    expect(r.display[0]).toContain("NFA, 3 states over {a,b}");
    expect(t).toContain("ε: {1} ─ε→ {1,3} — ACCEPT (contains 1)");
    expect(t).toContain('"a": {1} ─ε→ {1,3} ─a→ {1} ─ε→ {1,3} — ACCEPT');
    expect(t).toContain('"ba": {1} ─ε→ {1,3} ─b→ {2} ─a→ {2,3} — reject');
    expect(r.display).toContain('"baba" → accept');
  });

  test("ε in the transition table and several targets per (state, symbol)", () => {
    const t = text(run(SIPSER_N4));
    expect(t).toContain("→* 1: ε → {3}, b → {2}");
    expect(t).toContain("2: a → {2,3}, b → {3}");
  });

  test("a dead run is reported as no live states", () => {
    // {1} ─ε→ {1,3} ─b→ {2} ─b→ {3} ─b→ ∅: the third b has nowhere to go.
    expect(text(run(SIPSER_N4 + "\ntest: bbb"))).toMatch(/"bbb": .*─b→ \{3\} ─b→ ∅ — reject \(no live states\)/);
  });
});

describe("subset construction (to dfa)", () => {
  test("Sipser N4 → 6 reachable DFA states with set names and the dead state marked", () => {
    const r = run("to dfa\n" + SIPSER_N4);
    expect(r.display[0]).toContain("6 reachable states over {a,b}");
    expect(r.display[0]).toContain("start {1,3}");
    expect(r.display[0]).toContain("accept {{1,3},{1,2,3}}");
    const t = text(r);
    expect(t).toContain("∅ (dead state)");
    expect(t).toContain("→* {1,3}: a → {1,3}, b → {2}");
    expect(t).toContain("{2}: a → {2,3}, b → {3}");
    expect(t).toContain("{2,3}: a → {1,2,3}, b → {3}");
    expect(t).toContain("{3}: a → {1,3}, b → ∅");
    expect(t).toContain("* {1,2,3}: a → {1,2,3}, b → {2,3}");
    expect(t).toMatch(/verified: the DFA and the original NFA agree on all 127 strings up to length 6 over \{a,b\}/);
  });

  test("the pasted-back block of the subset DFA is accepted by the engine and agrees with the NFA", () => {
    const r = run("to dfa\n" + SIPSER_N4);
    const start = r.steps.findIndex((s) => s.startsWith("As a block"));
    const block = r.steps.slice(start + 1).map((s) => s.trim()).join("\n");
    const again = run(block + "\ntest: baba a bb");
    expect(again.display).toContain('"baba" → accept');
    expect(again.display).toContain('"a" → accept');
    expect(again.display).toContain('"bb" → reject');
  });

  test("to dfa also takes a regex line", () => {
    const r = run("to dfa\nregex (a|b)*abb\ntest: abb ab");
    expect(r.title).toBe("NFA → DFA (subset construction)");
    expect(r.display).toContain('"abb" → accept');
    expect(r.display).toContain('"ab" → reject');
  });

  test("the subset-state cap is named when exceeded, and 128 states just below it go through", () => {
    // L_n = (a|b)* a (a|b)^n needs 2^(n+1) DFA states; n = 8 asks for 512 > 256.
    expect(refusal("to dfa\nregex (a|b)*a(a|b)(a|b)(a|b)(a|b)(a|b)(a|b)(a|b)(a|b)")).toMatch(/more than 256 DFA states/);
    // n = 6: the minimal DFA has 2^7 = 128 states; the raw subset construction has one more,
    // because the Thompson start closure (which contains the star's entry state) is a set no
    // later input reaches again. Both numbers are pinned.
    const t0 = Date.now();
    const r = run("to dfa\nregex (a|b)*a(a|b)(a|b)(a|b)(a|b)(a|b)(a|b)");
    expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    expect(r.display[0]).toContain("129 reachable states");
    const m = run("minimize\nregex (a|b)*a(a|b)(a|b)(a|b)(a|b)(a|b)(a|b)");
    expect(m.display[0]).toContain("Minimal DFA: 128 states (from 129)");
    expect(text(m)).toMatch(/verified: both machines agree on all 127 strings/);
  });
});

describe("minimisation", () => {
  test("the 6-state machine minimises to 3 with the rounds shown", () => {
    const r = run("minimize\n" + SIX_TO_THREE);
    expect(r.display[0]).toContain("Minimal DFA: 3 states (from 6)");
    const t = text(r);
    expect(t).toContain("round 0 (accept vs non-accept): {A,B,C,D}  {E,F}");
    expect(t).toContain("round 1 (split by where each symbol leads): {A,B}  {C,D}  {E,F}");
    expect(t).toContain("round 2 (no change — stable): {A,B}  {C,D}  {E,F}");
    expect(t).toContain("Merged (indistinguishable) classes: {A,B}, {C,D}, {E,F}.");
    expect(t).toContain("→ {A,B}: 0 → {A,B}, 1 → {C,D}");
    expect(t).toContain("* {E,F}: 0 → {A,B}, 1 → {E,F}");
    expect(t).toMatch(/verified: both machines agree on all 127 strings up to length 6 over \{0,1\} \(exhaustive, including the empty string\)/);
  });

  test("British spelling works and an already-minimal DFA says so", () => {
    const r = run("minimise\n" + ENDS_IN_11);
    expect(r.display[0]).toContain("already minimal: 3 states");
  });

  test("unreachable states are removed first and named", () => {
    const r = run("minimize\n" + ENDS_IN_11.replace("states: q0 q1 q2", "states: q0 q1 q2 q3") + "\nq3 0 q3\nq3 1 q3");
    expect(r.display).toContain("Removed unreachable: q3");
    expect(r.display[0]).toContain("3 states (from 4)");
  });

  test("the minimal DFA's block parses back and matches the original on tests", () => {
    const r = run("minimize\n" + SIX_TO_THREE);
    const start = r.steps.findIndex((s) => s.startsWith("As a block"));
    const block = r.steps.slice(start + 1).map((s) => s.trim()).join("\n");
    const again = run(block + "\ntest: 11 011 10");
    expect(again.display[0]).toContain("3 states");
    expect(again.display).toContain('"11" → accept');
    expect(again.display).toContain('"011" → accept');
    expect(again.display).toContain('"10" → reject');
  });

  test("minimize accepts an nfa block too, by determinising first", () => {
    const r = run("minimize\n" + SIPSER_N4);
    expect(text(r)).toMatch(/first made deterministic by subset construction \(6 states\)/);
    expect(r.title).toBe("DFA minimisation");
  });
});

describe("regular expressions", () => {
  test("(a|b)*abb → the minimal 4-state DFA; textbook strings", () => {
    const r = run("regex (a|b)*abb\ntest: abb aabb babb ab abba");
    expect(r.display[0]).toContain("Minimal DFA for (a|b)*abb: 4 states over {a,b}");
    expect(r.display).toContain('"abb" → accept');
    expect(r.display).toContain('"aabb" → accept');
    expect(r.display).toContain('"babb" → accept');
    expect(r.display).toContain('"ab" → reject');
    expect(r.display).toContain('"abba" → reject');
    const t = text(r);
    expect(t).toMatch(/Thompson NFA: \d+ states, \d+ transitions \(\d+ ε-moves\)/);
    expect(t).toMatch(/verified: the minimal DFA and the Thompson NFA agree on all 127 strings up to length 6 over \{a,b\}/);
  });

  test("the Thompson NFA of (a|b)*abb has the expected size", () => {
    // Dragon-book Fig. 3.34 has 11 states; this construction glues each concatenation with an
    // ε-move instead of merging states. By hand: 5 literals × 2 states + 2 (alt) + 2 (star) = 14
    // states; ε-moves: 4 (alt) + 4 (star) + 3 (concatenations) = 11.
    const t = thompson("(a|b)*abb");
    expect(t.nfa.states.length).toBe(14);
    expect(t.epsMoves).toBe(11);
    expect(t.transitions).toBe(16);
    expect(accepts(t.nfa, "abb")).toBe(true);
    expect(accepts(t.nfa, "ab")).toBe(false);
  });

  test("+ ? ε ∅ and implicit concatenation", () => {
    expect(run("regex ab+\ntest: a ab abbb").display.slice(1)).toEqual(['"a" → reject', '"ab" → accept', '"abbb" → accept']);
    expect(run("regex ab?\ntest: a ab abb").display.slice(1)).toEqual(['"a" → accept', '"ab" → accept', '"abb" → reject']);
    // A regex's alphabet is its literals, so "a" is outside the alphabet of ε and is not run.
    expect(run('regex ε\ntest: "" a').display.slice(1)).toEqual(["ε → accept", '"a" → not run']);
    expect(run('regex eps|a\ntest: "" a').display.slice(1)).toEqual(["ε → accept", '"a" → accept']);
    expect(run('regex ∅\ntest: ""').display.slice(1)).toEqual(["ε → reject"]);
  });

  test("regex syntax errors are refused in plain English", () => {
    expect(refusal("regex (a|b")).toMatch(/unclosed parenthesis/);
    expect(refusal("regex a)")).toMatch(/closing parenthesis with no opening one/);
    expect(refusal("regex *a")).toMatch(/starts with "\*"/);
    expect(refusal("regex a.b")).toMatch(/character "\." is not allowed/);
    expect(refusal("regex " + "a".repeat(201))).toMatch(/201 characters; the cap is 200/);
  });

  test("a long but harmless regex returns quickly", () => {
    const src = "(" + "a|b|c|d|".repeat(10) + "e)*" + "ab".repeat(58);
    expect(src.length).toBeLessThanOrEqual(AUTOMATA_CAPS.regexLength);
    const t0 = Date.now();
    const r = run("regex " + src);
    // Gross-freeze bound: ~70 ms alone, but a parallel jest run multiplies
    // wall-clock several-fold (the repo's recorded flake class).
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.svg).toContain("<svg");
  });
});

describe("equivalence", () => {
  test("(a|b)* vs (a*b*)* is YES, exhaustively cross-checked", () => {
    const r = run("equivalent\nregex (a|b)*\n\nregex (a*b*)*");
    expect(r.display[0]).toMatch(/^Equivalent: YES/);
    expect(text(r)).toMatch(/verified: machine 1 and machine 2 agree on all 127 strings/);
  });

  test("a* vs (aa)* is NO with the shortest distinguishing string a", () => {
    const r = run("equivalent\nregex a*\n---\nregex (aa)*");
    expect(r.display[0]).toBe('Equivalent: NO — shortest distinguishing string "a": accepted by machine 1, rejected by machine 2.');
  });

  test("a DFA block against the regex it implements", () => {
    const r = run("equivalent\n" + ENDS_IN_11 + "\n---\nregex (0|1)*11");
    expect(r.display[0]).toMatch(/^Equivalent: YES/);
    const no = run("equivalent\n" + ENDS_IN_11 + "\n---\nregex (0|1)*1");
    expect(no.display[0]).toContain('shortest distinguishing string "1": rejected by machine 1, accepted by machine 2');
  });

  test("the distinguishing string is the shortest, ties in alphabet order", () => {
    // Machine 1 accepts strings ending in 11; machine 2 accepts strings ending in 0 1 or 11.
    const r = run("equivalent\nregex (0|1)*11\n\nregex (0|1)*(0|1)1");
    expect(r.display[0]).toContain('string "01"');
  });

  test("differing alphabets are unioned and the caveat says so", () => {
    const r = run("equivalent\nregex a*\n\nregex (a|b)*");
    expect(r.display[0]).toContain('string "b": rejected by machine 1, accepted by machine 2');
    expect(r.caveats.join(" ")).toMatch(/dead state/);
  });

  test("a 10-symbol alphabet at the regex length cap stays fast", () => {
    const a = "(a|b|c|d|e|f|g|h|i|j)*".repeat(8), b = "(j|i|h|g|f|e|d|c|b|a)*".repeat(8);
    const t0 = Date.now();
    const r = run(`equivalent\nregex ${a}\n\nregex ${b}`);
    expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    expect(r.display[0]).toMatch(/^Equivalent: YES/);
    expect(text(r)).toMatch(/agree on all 1111 strings up to length 3/);
  });

  test("three parts are refused by count", () => {
    expect(refusal("equivalent\nregex a\n\nregex b\n\nregex c")).toMatch(/found 3/);
  });
});

describe("figure", () => {
  test("every answer carries an SVG with a caption, a white background and alt text", () => {
    for (const src of [ENDS_IN_11, SIPSER_N4, "regex (a|b)*abb", "to dfa\n" + SIPSER_N4, "minimize\n" + SIX_TO_THREE, "equivalent\nregex a*\n\nregex (aa)*"]) {
      const r = run(src);
      expect(r.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="460" height="320"/);
      expect(r.svg).toContain('<rect width="460" height="320" fill="#fff"/>');
      expect(r.svg).toContain("Georgia,serif");
      expect(r.svg).not.toContain("<script");
      expect(r.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      expect(r.alt).toMatch(/^State diagram: /);
      // The caption is the last text element, centred at the bottom.
      expect(r.svg).toMatch(/<text x="230" y="308" text-anchor="middle" font-size="11" fill="#1A1A1A">[^<]+<\/text><\/svg>$/);
    }
  });

  test("the DFA figure has a double circle for the accept state, a start arrow and merged labels", () => {
    const r = run(ENDS_IN_11);
    const svg = r.svg as string;
    expect(svg).toContain("DFA, 3 states over {0,1}");
    // Accept state q2: outer and inner circle in the accent colour.
    const accent = svg.match(/<circle [^>]*stroke="#0C4A6E"/g) || [];
    expect(accent).toHaveLength(2);
    expect(svg).toContain('marker-end="url(#aut-arrow)"');
    expect(svg).toContain("<marker id=\"aut-arrow\"");
    // q1 ─0→ q0 and q0 ─1→ q1 are an opposite-direction pair: both drawn as curves.
    expect((svg.match(/ Q[\d.]+ [\d.]+ /g) || []).length).toBeGreaterThanOrEqual(2);
    // Self-loops on q0 (0) and q2 (1): cubic arcs.
    expect((svg.match(/ C[\d.]+ /g) || []).length).toBe(2);
  });

  test("a typed name goes into the caption", () => {
    const r = run(ENDS_IN_11.replace("dfa", "dfa\nname: accepts strings ending in 11"));
    expect(r.svg).toContain("DFA, 3 states over {0,1} — accepts strings ending in 11");
  });

  test("special characters in state names are escaped", () => {
    const r = run('dfa\nstates: a<b "c"\nalphabet: 0\nstart: a<b\naccept: "c"\na<b 0 "c"\n"c" 0 a<b');
    expect(r.svg).toContain("a&lt;b");
    expect(r.svg).toContain("&quot;c&quot;");
    expect(r.svg).not.toContain("a<b");
  });

  test("a single-state machine draws at the centre", () => {
    const r = run("dfa\nstates: s\nalphabet: a\nstart: s\naccept: s\ns a s");
    expect(r.svg).toContain('cx="230.0" cy="160.0"');
  });
});

describe("internals", () => {
  test("enumerateStrings respects both caps", () => {
    expect(enumerateStrings(["0", "1"])).toMatchObject({ maxLen: 6 });
    expect(enumerateStrings(["0", "1"]).strings).toHaveLength(127);
    const ten = enumerateStrings("0123456789".split(""));
    expect(ten.maxLen).toBe(3);
    expect(ten.strings).toHaveLength(1111);
    expect(enumerateStrings([]).strings).toEqual([""]);
    expect(enumerateStrings(["a"]).strings).toHaveLength(7);
  });

  test("determinise and minimise agree with the direct simulation of the NFA", () => {
    const { nfa } = thompson("(a|b)*abb");
    const d = determinise(nfa, nfa.alphabet).dfa;
    const m = minimise(d).dfa;
    expect(m.states).toHaveLength(4);
    for (const s of enumerateStrings(["a", "b"]).strings) {
      expect(accepts(d, s)).toBe(accepts(nfa, s));
      expect(accepts(m, s)).toBe(accepts(nfa, s));
    }
  });

  test("EPS is the display form of the empty string", () => {
    expect(EPS).toBe("ε");
  });

  test("the cap table matches the stated caveat", () => {
    const r = run(ENDS_IN_11);
    expect(r.caveats.join(" ")).toContain(`≤ ${AUTOMATA_CAPS.states} states`);
    expect(r.caveats.join(" ")).toContain(`regex ≤ ${AUTOMATA_CAPS.regexLength} characters`);
  });
});
