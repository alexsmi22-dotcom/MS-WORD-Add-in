/**
 * Markov hitting probabilities, expected first-passage times and return
 * times (v2.136.0, scope §A finding 3, §B5, §D "Markov").
 *
 * Before: "probability of reaching 3 before 1 starting from 2" printed the
 * stationary distribution (an answer to another question); "expected steps
 * from state 1 to state 3" was refused as "No absorbing state"; "mean first
 * passage time" and "hitting time" were refused by design.
 *
 * Oracle: §D values (SymPy exact Matrix.inv over ℚ), plus an INDEPENDENT
 * float route written here — Gaussian elimination with partial pivoting on
 * the first-step equations, and value iteration for probabilities — that
 * shares no code with markov.ts (which solves exactly by systems.rref).
 */
import { parseExpr, evalAst } from "../solve";
import { tryMarkov } from "../markov";
import { tryProbability } from "../probability";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 4000) throw new Error(`took ${dt} ms`);
  return r;
};
const run = (q: string) => {
  const v = timed(() => tryMarkov(q));
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const refusal = (q: string) => {
  const v = timed(() => tryMarkov(q));
  if (!v) throw new Error("not a verb: " + q);
  if (v.lines.length) throw new Error("answered: " + v.lines.map((l) => l.text).join(" / "));
  return v.caveats.join(" | ");
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const maths = (q: string): string[] => run(q).lines.filter((l) => l.math).map((l) => l.text);
const firstMath = (q: string): string => maths(q)[0];

const P1 = "[[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]]";
const P2 = "states A, B, C [[1/2,1/3,1/6],[3/4,0,1/4],[0,1,0]]";
const W = "[[0.9,0.1],[0.5,0.5]]";
const RUIN = "[[1,0,0,0,0],[0.5,0,0.5,0,0],[0,0.5,0,0.5,0],[0,0,0.5,0,0.5],[0,0,0,0,1]]";

// ---------------------------------------------------------------------------
// Independent float oracle
// ---------------------------------------------------------------------------
function gauss(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
/** Expected steps to reach j from every state, by float elimination; Infinity where P(reach) < 1 (value iteration decides that). */
function oracleTimes(P: number[][], j: number): number[] {
  const n = P.length;
  // probability of ever reaching j, by value iteration (monotone from below)
  let a: number[] = P.map((_, i) => (i === j ? 1 : 0));
  for (let it = 0; it < 20000; it++) a = a.map((_, i) => (i === j ? 1 : P[i].reduce((s, p, k) => s + p * a[k], 0)));
  const F = a.map((v, i) => i).filter((i) => i !== j && a[i] > 1 - 1e-9);
  const h = gauss(F.map((i) => F.map((k) => (i === k ? 1 : 0) - P[i][k])), F.map(() => 1));
  return P.map((_, i) => (i === j ? 0 : F.includes(i) ? h[F.indexOf(i)] : Infinity));
}
const num = (s: string): number => evalAst(parseExpr(s), {});

describe("§D P₁ = [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]]", () => {
  it("expected hitting time from 1 to 3 → 8 (was refused by design)", () => {
    expect(firstMath(`markov ${P1} expected hitting time from 1 to 3`)).toBe("8");
  });
  it("expected steps from state 1 to state 3 → 8 (was 'No absorbing state')", () => {
    const t = text(`markov ${P1} expected steps from state 1 to state 3`);
    expect(t).toMatch(/Expected steps from S1 to S3: 8/);
    expect(t).not.toMatch(/No absorbing state/);
    expect(firstMath(`markov ${P1} expected steps from state 1 to state 3`)).toBe("8");
  });
  it("from S2 → 6; every start listed (8, 6, 0)", () => {
    expect(firstMath(`markov ${P1} expected steps from 2 to 3`)).toBe("6");
    expect(text(`markov ${P1} expected time to reach 3`)).toMatch(/\(8, 6, 0\)/);
  });
  it("mean first passage time → M = [[4, 2, 8], [6, 2, 6], [8, 2, 4]]; diagonal = 1/π", () => {
    const t = text(`markov ${P1} mean first passage time`);
    expect(t).toMatch(/M = \[\[4, 2, 8\], \[6, 2, 6\], \[8, 2, 4\]\]/);
    expect(run(`markov ${P1} mean first passage time`).caveats.join(" ")).toMatch(/Kac/);
  });
  it("probability of reaching 3 before 1 starting from 2 → 1/2 (was the stationary block)", () => {
    const v = run(`markov ${P1} probability of reaching 3 before 1 starting from 2`);
    expect(v.lines.find((l) => l.math)!.text).toBe("1/2");
    expect(v.lines.map((l) => l.text).join("\n")).not.toMatch(/Stationary distribution/);
  });
  it("expected return time (no state named) → 4, 2, 4", () => {
    expect(maths(`markov ${P1} expected return time`)).toEqual(["4", "2", "4"]);
  });
  it("the target is ringed in the state diagram", () => {
    const v = run(`markov ${P1} expected hitting time from 1 to 3`);
    expect(v.svg).toMatch(/<svg/);
    expect(v.svg).toMatch(/target ringed/);
  });
});

describe("§D P₂ = [[1/2,1/3,1/6],[3/4,0,1/4],[0,1,0]] (A, B, C)", () => {
  it("reach C: from A 16/3, from B 5", () => {
    expect(firstMath(`markov ${P2} expected time to reach C from A`)).toBe("16/3");
    expect(firstMath(`markov ${P2} expected time to reach C from B`)).toBe("5");
  });
  it("reach A: from B 5/3, from C 8/3", () => {
    expect(firstMath(`markov ${P2} expected hitting time from B to A`)).toBe("5/3");
    expect(firstMath(`markov ${P2} expected hitting time from C to A`)).toBe("8/3");
  });
  it("return time to A → 2 (existing irreducible path, 1/π)", () => {
    expect(text(`markov ${P2} expected return time to A`)).toMatch(/return time to A = 1\/π_1 = 2/);
  });
  it("hitting probability of C from A → 1 (irreducible)", () => {
    expect(firstMath(`markov ${P2} hitting probability of C from A`)).toBe("1");
  });
  it("states by 1-based index on a named chain", () => {
    expect(firstMath(`markov ${P2} expected steps from 1 to 3`)).toBe("16/3");
  });
});

describe("§D weather [[0.9,0.1],[0.5,0.5]]", () => {
  it("S1 → S2: 10; S2 → S1: 2", () => {
    expect(firstMath(`markov ${W} expected hitting time from S1 to S2`)).toBe("10");
    expect(firstMath(`markov ${W} expected hitting time from S2 to S1`)).toBe("2");
  });
  it("return times 6/5 and 6", () => {
    expect(maths(`markov ${W} expected return time`)).toEqual(["6/5", "6"]);
  });
  it("mean first passage time from S1 to S2 = 10 (was refused by design — v2.131 pin flipped, oracle: (1−0.9)⁻¹ = 10)", () => {
    expect(firstMath(`markov ${W} mean first passage time from S1 to S2`)).toBe("10");
  });
  it("from S1 to S1 is the return time, said", () => {
    const t = text(`markov ${W} expected steps from S1 to S1`);
    expect(t).toMatch(/is the RETURN time/);
    expect(t).toMatch(/return time to S1 = 6\/5/);
  });
});

describe("§D gambler's ruin 0…4 — the EXISTING absorbing path is unchanged", () => {
  it("expected steps 3, 4, 3; P(reach 4 first) 1/4, 1/2, 3/4", () => {
    const t = text(`absorbing markov chain ${RUIN} expected steps`);
    expect(t).toMatch(/Fundamental matrix/);
    expect(t).toMatch(/Expected steps to absorption from S2: 3\b/);
    expect(t).toMatch(/Expected steps to absorption from S3: 4\b/);
    expect(t).toMatch(/Expected steps to absorption from S4: 3\b/);
    expect(t).toMatch(/From S2: absorbed in S1 with probability 3\/4 ≈ 0\.75, S5 with probability 1\/4/);
    expect(t).toMatch(/From S4: absorbed in S1 with probability 1\/4 ≈ 0\.25, S5 with probability 3\/4/);
  });
  it("the bare absorbing pin [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps is unchanged", () => {
    const t = text("absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps");
    expect(t).toMatch(/Fundamental matrix/);
    expect(t).toMatch(/Expected steps to absorption from S2: 5\/3/);
  });
  it("probability of reaching 5 before 1 from each start = 1/4, 1/2, 3/4 by the new route too", () => {
    expect(text(`markov ${RUIN} probability of reaching 5 before 1`)).toMatch(/\(0, 1\/4, 1\/2, 3\/4, 1\)/);
  });
  it("time to reach S5 from S3 is ∞ (reached only with probability 1/2), never a number", () => {
    const t = text(`markov ${RUIN} expected steps from 3 to 5`);
    expect(t).toMatch(/∞ — from S3 the chain reaches S5 only with probability 1\/2/);
    expect(t).toMatch(/trapped in \{S1\}/);
    expect(maths(`markov ${RUIN} expected steps from 3 to 5`)).toEqual([]);
  });
});

describe("unreachable targets → ∞ BY NAME, never an inverted singular matrix", () => {
  it("§D markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2", () => {
    expect(text("markov [[1,0],[0.5,0.5]] expected hitting time from 1 to 2")).toMatch(/∞ — S2 cannot be reached from S1 \(S1's class \{S1\} is closed\)/);
  });
  it("reachable but not certain: [[1/2,1/4,1/4],[0,1,0],[0,0,1]] from 1 to 2 → ∞, probability 1/2", () => {
    const t = text("markov [[1/2,1/4,1/4],[0,1,0],[0,0,1]] expected steps from 1 to 2");
    expect(t).toMatch(/∞ — from S1 the chain reaches S2 only with probability 1\/2/);
    expect(firstMath("markov [[1/2,1/4,1/4],[0,1,0],[0,0,1]] probability of reaching 2 from 1")).toBe("1/2");
  });
  it("a transient start that can only reach another closed class", () => {
    // S1 → S2 (closed {S2, S3}); S4 is unreachable from S1
    const t = text("markov [[0,1,0,0],[0,0,1,0],[0,1,0,0],[0,0,0,1]] expected steps from 1 to 4");
    expect(t).toMatch(/∞ — S4 cannot be reached from S1 \(from S1 the chain only ever visits \{S1, S2, S3\}\)/);
    expect(firstMath("markov [[0,1,0,0],[0,0,1,0],[0,1,0,0],[0,0,0,1]] probability of reaching 4 from 1")).toBe("0");
  });
  it("transient states have infinite return time; Kac holds on the closed class", () => {
    const t = text("markov [[1/2,1/2,0],[0,1/2,1/2],[0,1/2,1/2]] expected return time");
    expect(t).toMatch(/return time to S1 = ∞ — S1 is transient/);
    expect(t).toMatch(/return time to S2 = 2 steps/);
    expect(t).toMatch(/return time to S3 = 2 steps/);
  });
  it("mean first passage matrix with ∞ entries on a reducible chain", () => {
    const t = text("markov [[1/2,1/2,0],[0,1/2,1/2],[0,1/2,1/2]] mean first passage time");
    expect(t).toMatch(/M = \[\[∞, 2, 4\], \[∞, 2, 2\], \[∞, 2, 2\]\]/);
  });
});

describe("periodic chains", () => {
  it("2-cycle: hitting time 1, return time 2", () => {
    expect(firstMath("markov [[0,1],[1,0]] expected steps from 1 to 2")).toBe("1");
    expect(maths("markov [[0,1],[1,0]] expected return time")).toEqual(["2", "2"]);
  });
  it("4-cycle random walk (period 2): M from the oracle", () => {
    const P = [
      [0, 1 / 2, 0, 1 / 2],
      [1 / 2, 0, 1 / 2, 0],
      [0, 1 / 2, 0, 1 / 2],
      [1 / 2, 0, 1 / 2, 0],
    ];
    const q = "markov [[0,1/2,0,1/2],[1/2,0,1/2,0],[0,1/2,0,1/2],[1/2,0,1/2,0]]";
    for (let j = 0; j < 4; j++) {
      const o = oracleTimes(P, j);
      for (let i = 0; i < 4; i++) if (i !== j) expect(num(firstMath(`${q} expected steps from ${i + 1} to ${j + 1}`))).toBeCloseTo(o[i], 9);
    }
    expect(firstMath(`${q} expected steps from 1 to 3`)).toBe("4");
  });
});

describe("12-state chain (MAX_STATES) against the independent float oracle", () => {
  // a deterministic irreducible 12-state chain with uneven rational rows
  const n = 12;
  const P: number[][] = [];
  const rowsText: string[] = [];
  for (let i = 0; i < n; i++) {
    const w = Array.from({ length: n }, (_, j) => ((i * 7 + j * 3) % 5 === 0 || j === (i + 1) % n ? 1 + ((i + 2 * j) % 4) : 0));
    const s = w.reduce((a, b) => a + b, 0);
    P.push(w.map((x) => x / s));
    rowsText.push(`[${w.map((x) => (x ? `${x}/${s}` : "0")).join(",")}]`);
  }
  const q = `markov [${rowsText.join(",")}]`;
  it("hitting times to S12 from every start agree with float elimination to 1e-9 relative, in < 4 s", () => {
    const o = oracleTimes(P, 11);
    const v = run(`${q} expected time to reach 12`);
    const ms = v.lines.filter((l) => l.math).map((l) => num(l.text));
    expect(ms.length).toBe(12);
    ms.forEach((x, i) => expect(Math.abs(x - o[i])).toBeLessThan(1e-9 * Math.max(1, o[i])));
  });
  it("probability of reaching 6 before 1 from each state agrees with value iteration", () => {
    let a: number[] = P.map((_, i) => (i === 5 ? 1 : 0));
    for (let it = 0; it < 20000; it++) a = a.map((_, i) => (i === 5 ? 1 : i === 0 ? 0 : P[i].reduce((s, p, k) => s + p * a[k], 0)));
    const v = run(`${q} probability of reaching 6 before 1`);
    const ms = v.lines.filter((l) => l.math).map((l) => num(l.text));
    expect(ms.length).toBe(12);
    ms.forEach((x, i) => expect(Math.abs(x - a[i])).toBeLessThan(1e-9));
  });
  it("full mean-first-passage matrix (12 exact solves + Kac) inside 4 s", () => {
    const t = text(`${q} mean first passage time`);
    expect(t).toMatch(/^M = \[\[/m);
  });
});

describe("a finite horizon is a different question — never answered with the unbounded value", () => {
  // Oracle (hand): P1 from S1, S3 absorbing. Within 2 steps S3 is unreachable (S1→S2→S3 needs 2 steps:
  // P = 1/2·1/4 = 1/8). Within 3: paths S1S2S3x … computed by the exact absorbing power; checked against
  // a float power here.
  const P = [
    [0.5, 0.5, 0],
    [0.25, 0.5, 0.25],
    [0, 0, 1],
  ];
  const within = (k: number): number => {
    let v = [1, 0, 0];
    for (let s = 0; s < k; s++) v = [0, 1, 2].map((j) => v.reduce((acc, x, i) => acc + x * P[i][j], 0));
    return v[2];
  };
  it("probability of reaching 3 within 2 steps from 1 = 1/8", () => {
    expect(firstMath(`markov ${P1} probability of reaching 3 within 2 steps starting from 1`)).toBe("1/8");
  });
  it.each([1, 2, 3, 5, 10])("within %d steps matches the float power, and differs from P(ever) = 1", (k) => {
    const v = run(`markov ${P1} probability of reaching 3 within ${k} steps starting from 1`);
    expect(num(v.lines.find((l) => l.math)!.text)).toBeCloseTo(within(k), 12);
    expect(v.caveats.join(" ")).toMatch(/NOT the probability of ever reaching/);
  });
  it("first reach at step exactly 3 = within(3) − within(2)", () => {
    expect(num(firstMath(`markov ${P1} probability of reaching 3 in exactly 3 steps starting from 1`))).toBeCloseTo(within(3) - within(2), 12);
  });
  it("'by step 4' and 'before step 5' are both ≤ 4 steps", () => {
    const a = firstMath(`markov ${P1} probability of reaching 3 by step 4 from 1`);
    expect(firstMath(`markov ${P1} probability of reaching 3 before step 5 from 1`)).toBe(a);
    expect(num(a)).toBeCloseTo(within(4), 12);
  });
  it("an expected time with a horizon is refused by name", () => {
    expect(refusal(`markov ${P1} expected steps from 1 to 3 within 5 steps`)).toMatch(/has no horizon/);
  });
  it("a horizon without a start is refused by name", () => {
    expect(refusal(`markov ${P1} probability of reaching 3 within 5 steps`)).toMatch(/Name the starting state/);
  });
});

describe("routing and refusals", () => {
  it("P(X_n = j | X_0 = i), commute and mixing times stay refused by name", () => {
    expect(refusal(`markov ${W} P(X_3 = S2 | X_0 = S1)`)).toMatch(/Not answered here/);
    expect(refusal(`markov ${W} mixing time`)).toMatch(/mixing times/);
    expect(refusal(`markov ${W} commute time`)).toMatch(/commute times/);
  });
  it("review: a target state that does not exist is refused by name, never the M matrix", () => {
    const r = refusal("markov [[0.5,0.5],[0.5,0.5]] expected hitting time from 1 to 3");
    expect(r).toMatch(/The chain has states S1, S2 — there is no state 3/);
    expect(refusal("markov [[0.5,0.5],[0.5,0.5]] probability of reaching 3 from 1")).toMatch(/there is no state 3/);
    expect(refusal("markov [[0.5,0.5],[0.5,0.5]] expected steps from S1 to S7")).toMatch(/there is no state S7/);
  });
  it("review: '1 step', not '1 steps'", () => {
    const t = text("markov [[1/2,1/2,0],[0,1/2,1/2],[0,0,1]] expected return time");
    expect(t).toMatch(/return time to S3 = 1 step\b/);
    expect(t).not.toMatch(/1 steps/);
  });
  it("an unknown state is refused by name", () => {
    expect(refusal(`markov ${P1} expected steps from 7 to 3`)).toMatch(/"7" is not a state/);
    expect(refusal(`markov ${P1} probability of reaching 3 before 3 from 2`)).toMatch(/both the target and a state to avoid/);
  });
  it("stationary, n-step and the v2.131 return-time path are untouched", () => {
    expect(text(`markov ${W} stationary`)).toMatch(/π = \(5\/6, 1\/6\)/);
    expect(text(`markov ${W} expected return time to S1`)).toMatch(/return time to S1 = 1\/π_1 = 6\/5/);
    expect(text("markov [[0.5,0.5],[0.2,0.8]] after three steps")).toMatch(/\(61\/200, 139\/200\)/);
    expect(text("transition matrix [[0.5,0.5],[0.2,0.8]] after 3 steps from (1,0)")).toMatch(/after 3 steps/);
  });
  it("the probability verbs do not claim a markov line", () => {
    expect(tryProbability(`markov ${P1} probability of reaching 3 before 1 starting from 2`)).toBeNull();
  });
});
