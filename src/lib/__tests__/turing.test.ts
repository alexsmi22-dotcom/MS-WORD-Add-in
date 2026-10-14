// Turing machine engine — the §D acceptance values of docs/SCOPE-COMPUTATION-THEORY.md pinned
// verbatim, the three rule spellings, the verdicts (halt / no rule / LOOPS proven / cap UNKNOWN),
// the templates with their BigInt / count oracles, the busy-beaver citation table, refusals by
// name, the independent second stepper, and the display contract.

import { solveTuring, parseTmBlock, tmBlockLines, simulateTm, simulateTmB, parseStepLine, TM_RE, TM_CAPS, BUSY_BEAVER, INCREMENT_TEMPLATE } from "../turing";
import { DiscreteError, DiscreteResult } from "../discrete";
import { lines } from "../automata";

const INC = ["tm", "states: q0 q1 halt", "start: q0", "accept: halt", "blank: _",
  "q0 0 -> q0 0 R", "q0 1 -> q0 1 R", "q0 _ -> q1 _ L", "q1 1 -> q1 0 L", "q1 0 -> halt 1 R", "q1 _ -> halt 1 R"];

const run = (s: string): DiscreteResult => {
  const r = solveTuring(s);
  if (!r) throw new Error("engine returned null");
  return r;
};
const all = (r: DiscreteResult): string => [r.title, ...r.display, ...r.steps, ...r.caveats].join("\n");
const refusal = (s: string): string => {
  try {
    solveTuring(s);
  } catch (e) {
    expect(e).toBeInstanceOf(DiscreteError);
    return (e as Error).message;
  }
  throw new Error("expected a DiscreteError");
};

describe("§D — the binary increment machine", () => {
  const r = run([...INC, "tape: 1011"].join("\n"));
  const t = all(r);
  it("halted in halt after 8 steps, tape 1100", () => {
    expect(r.display[0]).toBe("Turing machine, 3 states over tape alphabet {_,0,1} (blank _), accept {halt}");
    expect(t).toContain("halted in halt after 8 steps");
    expect(r.display).toContain("Final tape: 1100; head at cell 2; 8 steps.");
  });
  it("one line per step in the §B form", () => {
    expect(r.steps).toContain("  3. (q0) 101[1] → write 1, R");
    expect(r.steps).toContain("  8. (halt) 11[0]0");
  });
  it("the strip is drawn", () => {
    expect(r.svg).toMatch(/^<svg/);
    expect(r.svg).toContain("1/0, L");
    expect(r.alt).toMatch(/tape strip of 9 configurations/);
  });
  it("tape: 111 → 8 steps, 1000", () => {
    const x = run([...INC, "tape: 111"].join("\n"));
    expect(all(x)).toContain("halted in halt after 8 steps");
    expect(x.display).toContain("Final tape: 1000 (starting at cell -1); head at cell 0; 8 steps.");
  });
  it("tm binary increment 1011 → the same machine printed, same result, verified in BigInt", () => {
    const x = run("tm binary increment 1011");
    const tx = all(x);
    for (const l of INCREMENT_TEMPLATE) expect(tx).toContain("  " + l.replace("->", "→"));
    expect(tx).not.toMatch(/->/);
    expect(x.display).toContain("Final tape: 1100; head at cell 2; 8 steps.");
    expect(tx).toContain("1011₂ + 1 = 1100₂ = 12, verified");
  });
});

describe("§D — unary add", () => {
  it("tm unary add 111+11 → 8 steps, 11111, 3 + 2 = 5 verified", () => {
    const r = run("tm unary add 111+11");
    const t = all(r);
    for (const l of ["q0 1 → q0 1 R", "q0 + → q1 1 R", "q1 1 → q1 1 R", "q1 _ → q2 _ L", "q2 1 → halt _ L"]) expect(t).toContain(l);
    expect(t).not.toMatch(/->/);
    expect(t).toContain("halted in halt after 8 steps");
    expect(r.display).toContain("Final tape: 11111; head at cell 4; 8 steps.");
    expect(t).toContain("3 + 2 = 5, verified");
  });
});

describe("§D — halting verdicts", () => {
  it("halted: no rule for (q0, _) after 3 steps — not accepting (no accept state declared), NOT loops", () => {
    const r = run("turing machine\nq0 a -> q0 a R\ntape: aaa");
    expect(all(r)).toContain("halted: no rule for (q0, _) after 3 steps — not accepting (no accept state declared)");
    expect(all(r)).not.toMatch(/LOOPS/);
  });
  it("LOOPS: configuration (q0, head 0, tape 1) recurred at step 2 — proven", () => {
    const r = run("tm\nstart: q0\nq0 1 -> q0 1 L\nq0 _ -> q0 _ R\ntape: 1");
    expect(all(r)).toContain("LOOPS: configuration (q0, head 0, tape 1) recurred at step 2 — proven");
    expect(all(r)).not.toMatch(/UNKNOWN/);
  });
  it("δ spelling: 2 steps, tape 11, no rule for (q0, 1)", () => {
    const r = run("tm\nδ(q0, 0) = (q1, 1, R)\nδ(q1, 0) = (q0, 1, L)\ntape: 00");
    const t = all(r);
    expect(t).toContain("no rule for (q0, 1) after 2 steps");
    expect(r.display).toContain("Final tape: 11; head at cell 0; 2 steps.");
    expect(t).not.toMatch(/Couldn't parse that system/);
  });
  it("step cap 10,000 reached — UNKNOWN; a cap is not a proof of looping", () => {
    const r = run('tm\nq0 _ -> q0 1 R\ntape: ""');
    expect(all(r)).toContain("step cap 10,000 reached — UNKNOWN; a cap is not a proof of looping");
    expect(all(r)).not.toMatch(/LOOPS/);
  });
});

describe("§D — the three rule spellings are identical", () => {
  const base = run([...INC, "tape: 1011"].join("\n"));
  const spell = (f: (from: string, read: string, to: string, w: string, d: string) => string): string[] =>
    INC.slice(5).map((l) => { const [from, read, , to, w, d] = l.split(/\s+/); return f(from, read, to, w, d); });
  for (const [name, f] of [
    ["q0, 1 -> q1, 0, L", (a: string, b: string, c: string, d: string, e: string) => `${a}, ${b} -> ${c}, ${d}, ${e}`],
    ["δ(q0, 1) = (q1, 0, L)", (a: string, b: string, c: string, d: string, e: string) => `δ(${a}, ${b}) = (${c}, ${d}, ${e})`],
    ["(q0, 1) → (q1, 0, L)", (a: string, b: string, c: string, d: string, e: string) => `(${a}, ${b}) → (${c}, ${d}, ${e})`],
  ] as [string, (a: string, b: string, c: string, d: string, e: string) => string][]) {
    it(name, () => {
      const r = run([...INC.slice(0, 5), ...spell(f), "tape: 1011"].join("\n"));
      expect(r.display).toEqual(base.display);
    });
  }
});

describe("§D — refusals and citations", () => {
  it("does this turing machine halt on every input → the halting problem, by name", () => {
    const msg = refusal("does this turing machine halt on every input\nq0 1 -> q0 1 R");
    expect(msg).toMatch(/halting problem/);
    expect(msg).toMatch(/undecidable/);
    expect(msg).toContain("give me a tape: and I will run it");
    expect(refusal("tm does it halt?\nq0 1 -> q0 1 R")).toMatch(/halting problem/);
  });
  it("…but with a tape it runs, saying the general question is undecidable", () => {
    const r = run("does this turing machine halt on every input\nq0 1 -> q0 1 R\ntape: 11");
    expect(all(r)).toMatch(/halting problem \(undecidable\)/);
    expect(all(r)).toContain("halted: no rule for (q0, _) after 2 steps");
  });
  it("busy beaver 3 → the citation table, nothing computed", () => {
    for (const s of ["busy beaver 3", "tm busy beaver 3"]) {
      const r = run(s);
      const t = all(r);
      expect(t).toContain("Σ(3) = 6, S(3) = 21");
      expect(t).toMatch(/nothing computed/);
      expect(t).not.toMatch(/Normal form/);
    }
    const t = all(run("busy beaver 5"));
    expect(t).toContain("Σ(5) = 4,098, S(5) = 47,176,870");
    expect(t).toMatch(/proven 2024/);
    expect(all(run("busy beaver 6"))).toMatch(/NOT KNOWN/);
  });
  it("the cited table: Σ(1..4) = 1, 4, 6, 13; S(1..4) = 1, 6, 21, 107", () => {
    expect(BUSY_BEAVER.map((r) => r.sigma)).toEqual(["1", "4", "6", "13", "4,098"]);
    expect(BUSY_BEAVER.map((r) => r.s)).toEqual(["1", "6", "21", "107", "47,176,870"]);
  });
  it("any machine without tape: → needs a tape: line", () => {
    expect(refusal("tm\nq0 1 -> q0 1 R")).toContain("needs a tape: line");
  });
  it("multi-tape, 2-D, probabilistic, nondeterministic → refused by name", () => {
    expect(refusal("tm two-tape copy\nq0 1 -> q0 1 R\ntape: 1")).toMatch(/Multi-tape Turing machines are not simulated/);
    expect(refusal("tm\nq0 1 -> q0 1 R\ntape: 1\ntape 2: 0")).toMatch(/Multi-tape/);
    expect(refusal("tm 2-d walker\nq0 1 -> q0 1 R\ntape: 1")).toMatch(/Two-dimensional/);
    expect(refusal("tm probabilistic\nq0 1 -> q0 1 R\ntape: 1")).toMatch(/Probabilistic/);
    expect(refusal("tm\nq0 1 -> q0 1 R\nq0 1 -> q1 0 L\ntape: 1")).toMatch(/Two rules for \(q0, 1\)/);
  });
  it("prose design → refused by name; template needs its argument", () => {
    expect(refusal("tm palindrome checker")).toMatch(/design is not computed/);
    expect(refusal("tm binary increment")).toMatch(/needs the binary numeral/);
    expect(refusal("tm unary add 111")).toMatch(/needs two unary numbers/);
  });
  it("bad rules", () => {
    expect(refusal("tm\nq0 1 -> q0 1 X\ntape: 1")).toMatch(/the last field is the move: L, R/);
    expect(refusal("tm\nq0 1 -> q0 1\ntape: 1")).toMatch(/needs three things after the arrow/);
    expect(refusal("tm\nq0 10 -> q0 1 R\ntape: 1")).toMatch(/tape symbols are single characters/);
    expect(refusal("tm\nstates: q0\nq0 1 -> q7 1 R\ntape: 1")).toMatch(/unknown state "q7"/);
    expect(refusal("tm\nhello world\ntape: 1")).toMatch(/is not a rule/);
    expect(refusal("tm\nq0 1 -> q0 1 R\ntest: 1")).toMatch(/runs on a "tape: …" line/);
  });
});

describe("routing guard", () => {
  it("claims keyword-led input and the two prose forms; nothing else", () => {
    for (const s of ["tm", "TM", "turing machine", "dtm", "tm binary increment 1011", "busy beaver 3", "does this turing machine halt on every input"]) expect(TM_RE.test(s)).toBe(true);
    for (const s of ["tmp file", "html", "S -> aSb", "p -> q", "pda", "dfa", "the busy road"]) expect(TM_RE.test(s)).toBe(false);
    expect(solveTuring("p -> q")).toBeNull();
    expect(solveTuring("")).toBeNull();
  });
});

describe("the independent second stepper", () => {
  it("agrees with the first on every state and head, and on the tape at its checkpoints", () => {
    const m = parseTmBlock(lines([...INC, "tape: 1011"].join("\n")).slice(1), "");
    const a = simulateTm(m);
    const b = simulateTmB(m, a.steps, a.checkpoints.keys());
    expect(b.states).toEqual(a.trace.map((r) => r.state));
    expect(b.heads).toEqual(a.trace.map((r) => r.head));
    for (const [k, c] of a.checkpoints) expect(b.contents.get(k)).toEqual(c);
    expect(all(run([...INC, "tape: 1011"].join("\n")))).toMatch(/independent second stepper .* agrees on the state and head position at every one of the 9 configurations/);
  });
});

describe("display contract", () => {
  it("the printed machine re-parses to the same run", () => {
    const r1 = run([...INC, "tape: 1011"].join("\n"));
    const at = r1.steps.indexOf("As a block you can paste back:");
    const r2 = run(r1.steps.slice(at + 1).map((l) => l.trim()).join("\n"));
    expect(r2.display).toEqual(r1.display);
  });
  it("tmBlockLines round-trips through parseTmBlock (incl. head: and an empty tape)", () => {
    for (const extra of [["tape: 1011", "head: 2"], ['tape: ""']]) {
      const m = parseTmBlock(lines([...INC, ...extra].join("\n")).slice(1), "");
      const back = parseTmBlock(tmBlockLines(m).slice(1), "");
      const strip = (x: typeof m) => ({ ...x, rules: x.rules.map(({ line, ...r }) => (void line, r)) });
      expect(strip(back)).toEqual(strip(m));
    }
  });
  it("every printed step line re-reads through parseStepLine to the same state, cells and head", () => {
    for (const s of [[...INC, "tape: 1011"].join("\n"), [...INC, "tape: 111"].join("\n"), "tm unary add 111+11"]) {
      const m = /^tm unary/.test(s) ? null : parseTmBlock(lines(s).slice(1), "");
      const r = run(s);
      const trace = m ? simulateTm(m).trace : null;
      const stepLines = r.steps.filter((l) => /^\s+\d+\. \(/.test(l));
      expect(stepLines.length).toBeGreaterThan(0);
      stepLines.forEach((l, i) => {
        const back = parseStepLine(l);
        expect(back).not.toBeNull();
        expect(back!.step).toBe(i);
        expect(back!.windowed).toBe(false);
        if (trace) {
          expect(back!.state).toBe(trace[i].state);
          expect(back!.cells).toEqual(trace[i].snap.cells);
          expect(back!.headIdx).toBe(trace[i].snap.headIdx);
        }
      });
    }
    expect(parseStepLine("  3. (q0) 101[1] → write 1, R")).toEqual({ step: 3, state: "q0", cells: ["1", "0", "1", "1"], headIdx: 3, windowed: false });
    expect(parseStepLine("9991. (q0) …111[_] → write 1, R")!.windowed).toBe(true);
    expect(parseStepLine("3. (q0) 1011 → write 1, R")).toBeNull();
  });
  it("caps are stated by number", () => {
    expect(all(run([...INC, "tape: 1"].join("\n")))).toContain(`≤ ${TM_CAPS.steps.toLocaleString("en-US")} steps`);
  });
});
